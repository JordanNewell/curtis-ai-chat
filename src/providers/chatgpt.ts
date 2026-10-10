// ChatGPT Provider — "Sign in with ChatGPT" (plan usage) over the OpenAI
// Responses API.
//
// Distinct from the OpenAI provider in two ways:
//   1. Auth — an OAuth access token (~1h) + refresh token (~30d) from OpenAI's
//      "Sign in with ChatGPT" program, NOT an API key. Requests bill against
//      the user's ChatGPT Plus/Pro plan allowance. Tokens live in the OS
//      keychain via the ChatGPTTokenStore the host supplies.
//   2. Dialect — POST /v1/responses: `input` items instead of `messages`,
//      `instructions` instead of a system message, `max_output_tokens`, and
//      typed SSE events (response.output_text.delta / response.completed)
//      instead of chat.completion chunks.
//
// formatRequest builds headers synchronously, so the live access token is a
// sync snapshot refreshed by prepare() — the host awaits it right before
// dispatching (see main.ts call sites).

import type {
	AIProvider,
	AIMessage,
	AIModel,
	AIRequestOptions,
	AIResponse,
	StreamCallback,
	UsageCallback,
	ErrorCallback,
	TokenUsage,
	StreamResponse,
	ToolCall,
	ToolDefinition,
} from '../types';
import {
	isResponsesResponse,
	isResponsesStreamEvent,
	isResponsesOutputMessage,
	isResponsesFunctionCall,
} from './types/openai-responses';
import { TRUNCATION_MARKER, mergeExtraBody, mergeReasoningBody } from './base';
import { buildToolParametersSchema } from '../core/tool-schema';
import { isRecord } from '../core/types/json-helpers';

/** Default Responses API endpoint for plan-usage requests. */
export const CHATGPT_ENDPOINT = 'https://api.openai.com/v1/responses';

/** OAuth token blob persisted under the provider config (keychain/plaintext). */
export interface ChatGPTTokens {
	access_token: string;
	/** Absent only if OpenAI granted no offline_access scope — treated as a
	 *  non-renewable session; the user signs in again on expiry. */
	refresh_token?: string;
	/** Absolute epoch ms when the access token dies (issued + expires_in). */
	expires_at: number;
	/** Client id OpenAI's dynamic registration issued during sign-in. */
	client_id?: string;
	/** ChatGPT account id from the ID token, when present (informational). */
	account_id?: string;
}

/** Parse a stored token blob; null when absent or malformed. */
export function parseTokenBlob(json: string): ChatGPTTokens | null {
	if (!json) return null;
	try {
		const raw: unknown = JSON.parse(json);
		if (!isRecord(raw) || typeof raw.access_token !== 'string' || !raw.access_token) return null;
		const t: ChatGPTTokens = {
			access_token: raw.access_token,
			expires_at: typeof raw.expires_at === 'number' ? raw.expires_at : 0,
		};
		if (typeof raw.refresh_token === 'string' && raw.refresh_token) t.refresh_token = raw.refresh_token;
		if (typeof raw.client_id === 'string' && raw.client_id) t.client_id = raw.client_id;
		if (typeof raw.account_id === 'string' && raw.account_id) t.account_id = raw.account_id;
		return t;
	} catch {
		return null;
	}
}

/**
 * Persistence + refresh seam the host implements (chatgpt-signin.ts wires it
 * to the keychain + Obsidian requestUrl). Kept interface-only here so the
 * provider stays node-free and unit-testable.
 */
export interface ChatGPTTokenStore {
	/** Synchronous read of the stored tokens (keychain getSecret is sync). */
	loadTokens(): ChatGPTTokens | null;
	/** Persist or clear (null) the tokens, and persist settings. */
	saveTokens(tokens: ChatGPTTokens | null): Promise<void>;
	/** Exchange the refresh token for a fresh token pair. Throws on failure. */
	refresh(tokens: ChatGPTTokens): Promise<ChatGPTTokens>;
}

/** Refresh when the access token dies within two minutes — covers a request
 *  that leaves right now and the clock skew between us and OpenAI. */
const TOKEN_EXPIRY_SKEW_MS = 120_000;

export class ChatGPTProvider implements AIProvider {
	readonly id = 'chatgpt';
	readonly name = 'ChatGPT (Sign in)';
	readonly endpoint: string;
	models: AIModel[];  // mutable so auto-discovery can update in place
	readonly supportsStreaming = true;
	readonly supportsVision = true;

	private store: ChatGPTTokenStore | null;
	// Sync credential snapshot — the only state formatRequest may read.
	private accessToken = '';
	private refreshToken = '';
	private expiresAt = 0;
	/** Single-flight guard so concurrent requests share one refresh call. */
	private refreshing: Promise<void> | null = null;

	constructor(store: ChatGPTTokenStore | null, endpoint = CHATGPT_ENDPOINT, models: AIModel[] = []) {
		this.store = store;
		this.endpoint = endpoint;
		this.models = models;
		this.seedFromStore();
	}

	private seedFromStore(): void {
		const tokens = this.store?.loadTokens() ?? null;
		this.accessToken = tokens?.access_token ?? '';
		this.refreshToken = tokens?.refresh_token ?? '';
		this.expiresAt = tokens?.expires_at ?? 0;
	}

	/** Re-read tokens from the store (after sign-in / sign-out in settings). */
	reloadTokens(): void {
		this.refreshing = null;
		this.seedFromStore();
	}

	/** Current access token — empty when signed out. Exposed for discovery. */
	getAccessToken(): string {
		return this.accessToken;
	}

	hasRefreshToken(): boolean {
		return this.refreshToken.length > 0;
	}

	/** True when signed in (a live or refreshable credential exists). */
	isAuthenticated(): boolean {
		return this.accessToken.length > 0 || this.refreshToken.length > 0;
	}

	/**
	 * Bring the credential snapshot up to date before a dispatch. Throws when
	 * a needed refresh fails — callers surface it as a provider error.
	 */
	async prepare(): Promise<void> {
		if (!this.needsRefresh()) {
			if (this.accessToken) return;
			// Snapshot empty but store may hold tokens written after our
			// construction (sign-in while running) — re-seed once.
			this.seedFromStore();
			if (!this.needsRefresh()) return;
		}
		if (!this.refreshToken) {
			throw new Error('ChatGPT session expired — sign in again in Settings → Curtis AI → ChatGPT (Sign in).');
		}
		// Single-flight: concurrent callers await the same refresh.
		if (!this.refreshing) {
			const store = this.store;
			if (!store) throw new Error('ChatGPT token store unavailable');
			this.refreshing = (async () => {
				const fresh = await store.refresh({
					access_token: this.accessToken,
					refresh_token: this.refreshToken,
					expires_at: this.expiresAt,
				});
				if (!fresh.refresh_token) {
					// Some issuers omit refresh_token on rotation — keep the old one.
					fresh.refresh_token = this.refreshToken;
				}
				this.accessToken = fresh.access_token;
				this.refreshToken = fresh.refresh_token ?? '';
				this.expiresAt = fresh.expires_at;
				await store.saveTokens(fresh);
			})();
			try {
				await this.refreshing;
			} finally {
				this.refreshing = null;
			}
		} else {
			await this.refreshing;
		}
	}

	private needsRefresh(): boolean {
		return this.accessToken.length === 0 || this.expiresAt - Date.now() < TOKEN_EXPIRY_SKEW_MS;
	}

	setModels(models: AIModel[]): void {
		this.models = models;
	}

	supportsToolCalls(): boolean {
		return true;
	}

	formatRequest(messages: AIMessage[], options: AIRequestOptions): RequestInit {
		// Responses API: system prompt rides the top-level `instructions`
		// field; everything else becomes `input` items.
		const systemText = messages
			.filter((m) => m.role === 'system')
			.map((m) => contentToText(m.content))
			.filter(Boolean)
			.join('\n\n');

		const body: Record<string, unknown> = {
			model: options.model,
			input: toResponsesInput(messages),
			stream: options.stream ?? false,
		};
		if (systemText) body.instructions = systemText;

		// max_output_tokens is the Responses wire name (always sent — the
		// parameter is the loop cap, same posture as Anthropic's max_tokens).
		body.max_output_tokens = options.maxTokens;
		// Temperature/top_p only when set — reasoning models reject temperature
		// alongside a reasoning request (dropped upstream by dropSampling).
		if (options.temperature !== undefined) body.temperature = options.temperature;
		if (options.topP !== undefined) body.top_p = options.topP;

		// Reasoning dialect ({reasoning:{effort}}) merged before the user's
		// passthrough so an explicit extra-body value still wins.
		mergeReasoningBody(body, options.reasoningBody);
		mergeExtraBody(body, options.extra);

		// Agent mode: Responses function tools are flat (name/description/
		// parameters at the top level), unlike Chat Completions' nested
		// `function` object.
		if (options.tools && options.tools.length > 0) {
			body.tools = options.tools.map((t) => toolDefToResponses(t));
			body.tool_choice = 'auto';
		}

		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (this.accessToken) headers['Authorization'] = `Bearer ${this.accessToken}`;

		return {
			method: 'POST',
			headers,
			body: JSON.stringify(body),
		};
	}

	async parseResponse(response: StreamResponse): Promise<AIResponse> {
		const raw: unknown = await response.json();
		if (!isResponsesResponse(raw)) {
			throw new Error('ChatGPT: unexpected response shape');
		}
		if (raw.status === 'failed' && raw.error?.message) {
			throw new Error(`ChatGPT: ${raw.error.message}`);
		}
		const texts: string[] = [];
		const toolCalls: ToolCall[] = [];
		for (const item of raw.output) {
			if (isResponsesOutputMessage(item)) {
				for (const part of item.content) {
					if (part.text) texts.push(part.text);
				}
			} else if (isResponsesFunctionCall(item)) {
				toolCalls.push({
					id: item.call_id || item.id || '',
					name: item.name,
					arguments: parseArguments(item.arguments),
				});
			}
		}
		const usage = raw.usage ? responsesUsage(raw.usage) : undefined;
		const ai: AIResponse = { content: texts.join('\n\n'), usage };
		if (toolCalls.length > 0) ai.tool_calls = toolCalls;
		return ai;
	}

	async parseStream(
		response: StreamResponse,
		onChunk: StreamCallback,
		onUsage?: UsageCallback,
		onError?: ErrorCallback
	): Promise<void> {
		const reader = response.body?.getReader();
		if (!reader) throw new Error('No response body');

		const decoder = new TextDecoder();
		let buffer = '';
		let truncationSent = false;

		const processLine = (line: string): void => {
			const clean = line.endsWith('\r') ? line.slice(0, -1) : line;
			if (!clean.trim() || !clean.startsWith('data:')) return;
			const data = clean.charAt(5) === ' ' ? clean.slice(6) : clean.slice(5);
			if (data === '[DONE]') return;

			try {
				const rawEvent: unknown = JSON.parse(data);
				if (!isResponsesStreamEvent(rawEvent)) return;
				// The Responses event family is wide and still growing
				// (response.created, reasoning summaries, output_item.added…).
				// Handle the ones that carry user-visible content and ignore
				// the rest — no exhaustive switch here.
				switch (rawEvent.type) {
					case 'response.output_text.delta':
						if (rawEvent.delta) onChunk(rawEvent.delta);
						break;
					case 'response.completed':
					case 'response.incomplete': {
						const r = rawEvent.response;
						if (onUsage && r.usage) onUsage(responsesUsage(r.usage));
						if (
							!truncationSent
							&& r.incomplete_details?.reason === 'max_output_tokens'
						) {
							truncationSent = true;
							onChunk(TRUNCATION_MARKER);
						}
						break;
					}
					case 'response.failed':
						if (onError) {
							onError(new Error(r0Message(rawEvent)));
							return;
						}
						break;
					case 'error':
						if (onError) {
							onError(new Error(rawEvent.message || 'ChatGPT stream error'));
							return;
						}
						break;
					default:
						break;
				}
			} catch (e) {
				if (onError) onError(e as Error);
			}
		};

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';
				for (const line of lines) processLine(line);
			}
			// Flush a final event delivered without a trailing newline.
			if (buffer.trim()) processLine(buffer);
		} finally {
			reader.releaseLock();
		}
	}

	getModelPricing(modelId: string): { inputPrice: number; outputPrice: number } | null {
		const model = this.models.find((m) => m.id === modelId);
		if (!model || model.inputPrice === undefined || model.outputPrice === undefined) return null;
		return { inputPrice: model.inputPrice, outputPrice: model.outputPrice };
	}
}

/** Failed-response error text, pulled out to keep parseStream's switch flat. */
function r0Message(evt: { response: { error?: { message?: string; code?: string } | null } }): string {
	return evt.response.error?.message || 'ChatGPT request failed';
}

function responsesUsage(u: { input_tokens: number; output_tokens: number; total_tokens?: number }): TokenUsage {
	const promptTokens = u.input_tokens || 0;
	const completionTokens = u.output_tokens || 0;
	return {
		promptTokens,
		completionTokens,
		totalTokens: u.total_tokens || promptTokens + completionTokens,
	};
}

/** Convert our ToolDefinition to the Responses tools[] entry shape. */
function toolDefToResponses(t: ToolDefinition): { type: 'function'; name: string; description: string; parameters: Record<string, unknown> } {
	return {
		type: 'function',
		name: t.name,
		description: t.description,
		parameters: buildToolParametersSchema(t),
	};
}

/** Tool-call arguments arrive as a JSON string; malformed → empty record. */
function parseArguments(raw: string): Record<string, unknown> {
	if (!raw) return {};
	try {
		const parsed: unknown = JSON.parse(raw);
		if (isRecord(parsed)) return parsed;
	} catch {
		// fall through
	}
	return {};
}

function contentToText(content: AIMessage['content']): string {
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return '';
	return content
		.map((p) => (p.type === 'text' ? p.text ?? '' : ''))
		.filter(Boolean)
		.join('\n');
}

/**
 * Map canonical AIMessage[] to Responses `input` items. Key differences from
 * the Chat Completions wire shape:
 *   - system messages never appear here (they ride `instructions`)
 *   - assistant tool_calls become flat `function_call` items (arguments as a
 *     JSON string, paired by call_id)
 *   - role:'tool' results become `function_call_output` items
 *   - text content parts are input_text on user turns, output_text on
 *     assistant turns (the API distinguishes the two)
 */
function toResponsesInput(messages: AIMessage[]): Array<Record<string, unknown>> {
	const out: Array<Record<string, unknown>> = [];
	for (const m of messages) {
		if (m.role === 'system') continue;

		if (m.role === 'tool') {
			out.push({
				type: 'function_call_output',
				call_id: m.tool_call_id ?? '',
				output: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
			});
			continue;
		}

		if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
			const text = typeof m.content === 'string' ? m.content : '';
			if (text) {
				out.push({ role: 'assistant', content: [{ type: 'output_text', text }] });
			}
			for (const call of m.tool_calls) {
				out.push({
					type: 'function_call',
					call_id: call.id,
					name: call.name,
					arguments: JSON.stringify(call.arguments ?? {}),
				});
			}
			continue;
		}

		out.push({
			role: m.role,
			content: toResponsesContent(m.content, m.role === 'assistant'),
		});
	}
	return out;
}

/**
 * Convert unified message content into Responses content parts: input_text/
 * input_image on user turns, output_text on assistant turns. Image parts ride
 * `image_url` as-is (Responses accepts data: URLs).
 */
function toResponsesContent(content: AIMessage['content'], assistant: boolean): Array<Record<string, unknown>> {
	if (typeof content === 'string') {
		return [{ type: assistant ? 'output_text' : 'input_text', text: content }];
	}
	if (!Array.isArray(content)) {
		return [{ type: assistant ? 'output_text' : 'input_text', text: '' }];
	}
	const parts: Array<Record<string, unknown>> = [];
	for (const p of content) {
		if (p.type === 'text' && p.text) {
			parts.push({ type: assistant ? 'output_text' : 'input_text', text: p.text });
		} else if (p.type === 'image_url' && p.image_url?.url && !assistant) {
			parts.push({ type: 'input_image', image_url: p.image_url.url });
		}
	}
	if (parts.length === 0) {
		// All parts filtered out (e.g. image-only assistant echo or an
		// unsupported image format) — the API rejects empty content arrays.
		return [{ type: 'input_text', text: '[content removed — unsupported format]' }];
	}
	return parts;
}
