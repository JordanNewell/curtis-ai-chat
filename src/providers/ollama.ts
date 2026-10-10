// Ollama Provider — native /api/chat dialect
//
// Curtis speaks Ollama's native protocol rather than its OpenAI-compatible
// shim because the local-server "hardware" knobs only exist there: context
// window (options.num_ctx), GPU layer offload (options.num_gpu), compute
// threads (options.num_thread), and model residency (keep_alive). Ollama's
// docs are explicit that the OpenAI-compat endpoint has no way to set these.
//
// Wire differences from OpenAI handled here:
//   - sampling/lifetime params live under `options{}` / top-level `keep_alive`
//   - streaming is NDJSON (one JSON object per line), not SSE `data:` lines
//   - tool_calls arrive as {function:{name, arguments: object}} with no id —
//     Curtis synthesizes ids for its canonical ToolCall shape
//   - images ride on the message as `images: [<base64>]`, not content parts

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
} from '../types';
import { TRUNCATION_MARKER, mergeExtraBody, mergeReasoningBody } from './base';
import { buildToolParametersSchema } from '../core/tool-schema';

export const DEFAULT_OLLAMA_ENDPOINT = 'http://localhost:11434/api/chat';

/**
 * Map whatever is configured for the Ollama provider onto the native chat
 * path. Accepts the current native URL, the legacy OpenAI-compat default
 * (`http://host:11434/v1/chat/completions`), or a bare origin.
 */
export function normalizeOllamaEndpoint(endpoint: string): string {
	const trimmed = (endpoint || '').trim();
	if (!trimmed) return DEFAULT_OLLAMA_ENDPOINT;
	if (/\/api\/chat\/?(\?.*)?$/.test(trimmed)) return trimmed;
	const origin = trimmed.replace(/\/(v1|api)\/.*$/, '');
	return origin + '/api/chat';
}

type OllamaNativeMessage = {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
	images?: string[];
	tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
};

export class OllamaProvider implements AIProvider {
	readonly id = 'ollama';
	readonly name = 'Ollama (Local)';
	readonly endpoint: string;
	models: AIModel[] = [];  // mutable so auto-discovery can update in place
	readonly supportsStreaming = true;
	readonly supportsVision = true;

	constructor(endpoint: string = DEFAULT_OLLAMA_ENDPOINT) {
		this.endpoint = endpoint;
	}

	/** Replace this provider's model list (used by auto-discovery). */
	setModels(models: AIModel[]): void {
		this.models = models;
	}

	// Keyless local server — always authenticated, never sends auth headers.
	isAuthenticated(): boolean {
		return true;
	}

	/** Native /api/chat advertises tools in Ollama's OpenAI-like shape. */
	supportsToolCalls(): boolean {
		return true;
	}

	formatRequest(messages: AIMessage[], options: AIRequestOptions): RequestInit {
		const body: Record<string, unknown> = {
			model: options.model,
			messages: toOllamaMessages(messages),
			stream: options.stream ?? false,
		};

		// Sampling + hardware knobs under `options{}` — only set what the user
		// (or global generation settings) actually provided, so the server's
		// own defaults stay in charge of everything else.
		const ollamaOptions: Record<string, unknown> = {};
		if (options.temperature !== undefined) ollamaOptions.temperature = options.temperature;
		ollamaOptions.num_predict = options.maxTokens;
		if (options.topP !== undefined) ollamaOptions.top_p = options.topP;
		if (options.topK !== undefined) ollamaOptions.top_k = options.topK;
		if (options.minP !== undefined) ollamaOptions.min_p = options.minP;
		if (options.seed !== undefined) ollamaOptions.seed = options.seed;
		if (options.repetitionPenalty !== undefined) ollamaOptions.repeat_penalty = options.repetitionPenalty;
		if (options.stop && options.stop.length > 0) ollamaOptions.stop = options.stop;
		const hw = options.ollama;
		if (hw?.numCtx !== undefined) ollamaOptions.num_ctx = hw.numCtx;
		if (hw?.numGpu !== undefined) ollamaOptions.num_gpu = hw.numGpu;
		if (hw?.numThread !== undefined) ollamaOptions.num_thread = hw.numThread;
		if (Object.keys(ollamaOptions).length > 0) body.options = ollamaOptions;

		if (hw?.keepAlive !== undefined && hw.keepAlive !== '') body.keep_alive = hw.keepAlive;

		// Tools use Ollama's native shape (same skeleton as OpenAI's — the
		// canonical ToolDefinition maps 1:1).
		if (options.tools && options.tools.length > 0) {
			body.tools = options.tools.map((t) => ({
				type: 'function',
				function: {
					name: t.name,
					description: t.description,
					parameters: buildToolParametersSchema(t),
				},
			}));
		}

		// Reasoning-effort dialect (think: false | true | level) — merged before
		// the user's passthrough so an explicit extra-body value still wins.
		mergeReasoningBody(body, options.reasoningBody);

		// Raw passthrough last — escape hatch for `think`, `format`, and any
		// option the structured fields don't cover yet (e.g.
		// {"options": {"repeat_last_n": 128}} merges recursively).
		mergeExtraBody(body, options.extra);

		return {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		};
	}

	async parseResponse(response: StreamResponse): Promise<AIResponse> {
		const raw: unknown = await response.json();
		if (!isOllamaChatResponse(raw)) {
			throw new Error(`${this.name}: unexpected response shape`);
		}
		const content = raw.message?.content || '';
		const usage: TokenUsage = {
			promptTokens: raw.prompt_eval_count || 0,
			completionTokens: raw.eval_count || 0,
			totalTokens: (raw.prompt_eval_count || 0) + (raw.eval_count || 0),
		};
		const ai: AIResponse = { content, usage };
		const toolCalls = parseOllamaToolCalls(raw.message?.tool_calls);
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

		// NDJSON: each complete line is one independent JSON object. The final
		// line carries done:true plus token counts (prompt_eval_count/eval_count).
		const processLine = (line: string): void => {
			const clean = line.endsWith('\r') ? line.slice(0, -1) : line;
			if (!clean.trim()) return;
			try {
				const parsed: unknown = JSON.parse(clean);
				if (!isOllamaChatResponse(parsed)) return;
				const delta = parsed.message?.content || '';
				if (delta) onChunk(delta);

				if (parsed.done && onUsage) {
					onUsage({
						promptTokens: parsed.prompt_eval_count || 0,
						completionTokens: parsed.eval_count || 0,
						totalTokens: (parsed.prompt_eval_count || 0) + (parsed.eval_count || 0),
					});
				}
				if (parsed.done && parsed.done_reason === 'length' && !truncationSent) {
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
			// Flush a final line delivered without a trailing newline.
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

// ---------------------------------------------------------------------------
// Wire mapping helpers
// ---------------------------------------------------------------------------

/** True for a /api/chat response object (streamed chunk or final message). */
function isOllamaChatResponse(v: unknown): v is {
	message?: { role?: string; content?: string; tool_calls?: Array<{ function: { name: string; arguments: unknown } }> };
	done?: boolean;
	done_reason?: string;
	prompt_eval_count?: number;
	eval_count?: number;
} {
	return typeof v === 'object' && v !== null && ('message' in v || 'done' in v || 'error' in v);
}

/**
 * Native tool_calls have no id and carry arguments as a JSON object.
 * Synthesize ids so the canonical ToolCall shape (and the tool-result
 * pairing in the agent loop) works unchanged — Ollama ignores ids when the
 * conversation is replayed, so synthetic values are safe.
 */
function parseOllamaToolCalls(raw: Array<{ function: { name: string; arguments: unknown } }> | undefined): ToolCall[] {
	if (!raw || !Array.isArray(raw) || raw.length === 0) return [];
	const out: ToolCall[] = [];
	raw.forEach((tc, i) => {
		if (!tc?.function || typeof tc.function.name !== 'string') return;
		const args = tc.function.arguments;
		out.push({
			id: `call_${i}`,
			name: tc.function.name,
			arguments: args && typeof args === 'object' && !Array.isArray(args)
				? args as Record<string, unknown>
				: {},
		});
	});
	return out;
}

/**
 * Map canonical AIMessage[] to Ollama's native message shape. Roles map
 * directly (system stays in the messages array); image_url content parts
 * become the message-level `images[]` array of base64 payloads; assistant
 * tool_calls drop the synthetic ids (native shape is function+arguments only).
 */
function toOllamaMessages(messages: AIMessage[]): OllamaNativeMessage[] {
	return messages.map((m) => {
		const out: OllamaNativeMessage = { role: m.role, content: '' };

		if (typeof m.content === 'string') {
			out.content = m.content;
		} else if (Array.isArray(m.content)) {
			const texts: string[] = [];
			const images: string[] = [];
			for (const part of m.content) {
				if (part.type === 'text' && part.text) texts.push(part.text);
				else if (part.type === 'image_url' && part.image_url?.url) {
					const base64 = parseDataUrl(part.image_url.url);
					if (base64) images.push(base64);
				}
			}
			out.content = texts.join('\n\n');
			if (images.length > 0) out.images = images;
		}

		if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
			out.tool_calls = m.tool_calls.map((tc) => ({
				function: { name: tc.name, arguments: tc.arguments ?? {} },
			}));
		}

		return out;
	});
}

/** Extract the base64 payload from a `data:<mime>;base64,<data>` URL. */
function parseDataUrl(url: string): string | null {
	const m = url.trim().match(/^data:[^;]+;base64,(.+)$/);
	return m ? m[1] : null;
}
