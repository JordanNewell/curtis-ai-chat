// OpenAI-Compatible Provider Base — covers 80%+ of all AI providers

import type {
	AIProvider,
	AIMessage,
	AIModel,
	AIRequestOptions,
	AIResponse,
	StreamCallback,
	UsageCallback,
	ErrorCallback,
	AuthType,
	StreamResponse,
	ToolCall,
	ToolDefinition,
} from '../types';
import { isOpenAIChatCompletion, isOpenAIChunk, OpenAIToolCall } from './types/openai-responses';
import { buildToolParametersSchema } from '../core/tools';

/**
 * Discriminated tag for the protocol family a provider speaks. Informational
 * for now — AIProvider doesn't require it. Lets downstream code branch on
 * transport shape without ad-hoc string matching on `id`.
 */
export type ProviderFamily =
	| 'openai-compat'
	| 'anthropic'
	| 'gemini'
	| 'ollama';

/** Appended to a streamed reply that hit the provider's max-tokens limit,
 *  so the user can see the reply was cut short rather than just odd. */
export const TRUNCATION_MARKER = '\n\n*[Truncated — hit the max-tokens limit]*';

export abstract class BaseProvider implements AIProvider {
	abstract readonly id: string;
	abstract readonly name: string;
	abstract readonly endpoint: string;
	abstract models: AIModel[];  // mutable so discoverModels can update in place
	abstract readonly authType: AuthType;

	readonly supportsStreaming = true;
	readonly supportsVision = true;

	/** Family tag — defaults to openai-compat for BaseProvider subclasses.
	 *  AnthropicProvider overrides this to 'anthropic'. Used by supportsToolCalls(). */
	readonly family: ProviderFamily = 'openai-compat';

	/**
	 * True when the provider accepts `stream_options: { include_usage: true }`.
	 * Set by the registry only for OpenAI-dialect providers known to support
	 * the field — strict/local compat servers may 400 on unknown fields.
	 */
	protected supportsStreamUsage = false;

	protected abstract getAuthHeaders(): Record<string, string>;

	/**
	 * True when this provider speaks the OpenAI tool-calling dialect.
	 * v1 agent mode is gated on this — Anthropic/Gemini/Ollama shapes differ
	 * and are not yet wired in.
	 */
	supportsToolCalls(): boolean {
		return this.family === 'openai-compat';
	}

	formatRequest(messages: AIMessage[], options: AIRequestOptions): RequestInit {
		// Normalize our flat internal ToolCall shape {id, name, arguments} back
		// to the OpenAI wire format {id, type: 'function', function: {...}} on
		// assistant messages. Without this, providers that strictly enforce the
		// spec (Z.ai GLM, etc.) reject the second turn of an agent loop with
		// "Tool type cannot be empty".
		const wireMessages = messages.map((m) => {
			if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
				return {
					...m,
					tool_calls: m.tool_calls.map((tc) => ({
						id: tc.id,
						type: 'function' as const,
						function: {
							name: tc.name,
							arguments: JSON.stringify(tc.arguments ?? {}),
						},
					})),
				};
			}
			return m;
		});

		const body: Record<string, unknown> = {
			model: options.model,
			messages: wireMessages,
			temperature: options.temperature,
			max_tokens: options.maxTokens,
			stream: options.stream ?? false,
		};

		// Usage reporting for streamed requests — without this OpenAI-family
		// servers never send the usage-only final chunk.
		if (options.stream && this.supportsStreamUsage) {
			body.stream_options = { include_usage: true };
		}

		// Tool advertisement — only when the caller provided tools AND this
		// provider speaks the OpenAI function-calling dialect. Other families
		// silently drop the tools and behave as plain chat.
		if (options.tools && options.tools.length > 0 && this.supportsToolCalls()) {
			body.tools = options.tools.map((t) => toolDefToOpenAI(t));
			body.tool_choice = 'auto';
		}

		return {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...this.getAuthHeaders(),
			},
			body: JSON.stringify(body),
		};
	}

	async parseResponse(response: StreamResponse): Promise<AIResponse> {
		const raw: unknown = await response.json();
		if (!isOpenAIChatCompletion(raw)) {
			throw new Error(`${this.name}: unexpected response shape`);
		}
		const data = raw;
		const choice = data.choices[0];
		const content = choice?.message?.content || '';
		const u = data.usage;
		const usage = u
			? {
					promptTokens: u.prompt_tokens || 0,
					completionTokens: u.completion_tokens || 0,
					totalTokens: u.total_tokens || 0,
				}
			: undefined;
		const toolCalls = parseOpenAIToolCalls(choice?.message?.tool_calls);
		return { content, usage, tool_calls: toolCalls };
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
				const parsed: unknown = JSON.parse(data);
				if (!isOpenAIChunk(parsed)) return;
				const delta = parsed.choices[0]?.delta?.content || '';
				if (delta) onChunk(delta);

				if (parsed.usage && onUsage) {
					onUsage({
						promptTokens: parsed.usage.prompt_tokens || 0,
						completionTokens: parsed.usage.completion_tokens || 0,
						totalTokens: parsed.usage.total_tokens || 0,
					});
				}

				if (!truncationSent && parsed.choices[0]?.finish_reason === 'length') {
					truncationSent = true;
					onChunk(TRUNCATION_MARKER);
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
			// Flush a final chunk delivered without a trailing newline.
			if (buffer.trim()) processLine(buffer);
		} finally {
			reader.releaseLock();
		}
	}

	abstract isAuthenticated(): boolean;
	abstract getModelPricing(modelId: string): { inputPrice: number; outputPrice: number } | null;
}

// Concrete OpenAI-compatible provider — instantiate for any OpenAI-format API
export class OpenAICompatibleProvider extends BaseProvider {
	readonly id: string;
	readonly name: string;
	readonly endpoint: string;
	models: AIModel[];  // mutable so discoverModels can update in place
	readonly authType: AuthType;

	private apiKey: string;

	constructor(config: {
		id: string;
		name: string;
		endpoint: string;
		models: AIModel[];
		apiKey: string;
		authType?: AuthType;
		/** Accepts `stream_options: { include_usage: true }` on streamed requests. */
		supportsStreamUsage?: boolean;
	}) {
		super();
		this.id = config.id;
		this.name = config.name;
		this.endpoint = config.endpoint;
		this.models = config.models;
		this.apiKey = config.apiKey;
		this.authType = config.authType ?? 'bearer';
		if (config.supportsStreamUsage) this.supportsStreamUsage = true;
	}

	/** Replace this provider's model list (used by auto-discovery). */
	setModels(models: AIModel[]): void {
		this.models = models;
	}

	getAuthHeaders(): Record<string, string> {
		// Keyless auth never sends a header — some local proxies reject
		// unexpected Authorization values outright.
		if (this.authType === 'none' || !this.apiKey) return {};
		return { Authorization: `Bearer ${this.apiKey}` };
	}

	isAuthenticated(): boolean {
		// Keyless providers (Ollama, LM Studio, 'none'-auth custom endpoints)
		// are always authenticated; they never send an Authorization header.
		return this.authType === 'none' || this.apiKey.length > 0;
	}

	getModelPricing(modelId: string): { inputPrice: number; outputPrice: number } | null {
		const model = this.models.find((m) => m.id === modelId);
		if (!model || model.inputPrice === undefined || model.outputPrice === undefined) return null;
		return { inputPrice: model.inputPrice, outputPrice: model.outputPrice };
	}
}

// ---------------------------------------------------------------------------
// Tool-call helpers
// ---------------------------------------------------------------------------

/** Convert our ToolDefinition to the OpenAI tools[] entry shape. */
function toolDefToOpenAI(t: ToolDefinition): { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } } {
	return {
		type: 'function',
		function: {
			name: t.name,
			description: t.description,
			parameters: buildToolParametersSchema(t),
		},
	};
}

/**
 * Parse the OpenAI `message.tool_calls` array into our canonical ToolCall[].
 * Returns undefined when absent or empty. Arguments arrive as a JSON string
 * that we parse into a record; malformed JSON yields an empty record and the
 * tool's own required-param check surfaces the error.
 */
function parseOpenAIToolCalls(raw: OpenAIToolCall[] | undefined): ToolCall[] | undefined {
	if (!raw || !Array.isArray(raw) || raw.length === 0) return undefined;
	const out: ToolCall[] = [];
	for (const tc of raw) {
		if (!tc || typeof tc.id !== 'string' || !tc.function) continue;
		let args: Record<string, unknown> = {};
		try {
			const parsed: unknown = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				args = parsed as Record<string, unknown>;
			}
		} catch {
			args = {};
		}
		out.push({ id: tc.id, name: tc.function.name, arguments: args });
	}
	return out.length > 0 ? out : undefined;
}
