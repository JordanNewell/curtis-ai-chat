// Anthropic Claude Provider — separate API format from OpenAI

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
import { isAnthropicMessage, isAnthropicStreamEvent } from './types/anthropic-responses';
import type { AnthropicRedactedThinkingBlock, AnthropicThinkingBlock } from './types/anthropic-responses';
import { TRUNCATION_MARKER, mergeExtraBody, mergeReasoningBody } from './base';
import { buildToolParametersSchema } from '../core/tool-schema';
import { isRecord } from '../core/types/json-helpers';

// ---------------------------------------------------------------------------
// Extended thinking (interleaved reasoning) support
// ---------------------------------------------------------------------------

/** Wire floor the API enforces on thinking.budget_tokens. */
const MIN_THINKING_BUDGET = 1024;
/** Default when the stored setting is missing/invalid (matches the settings
 *  default). */
const DEFAULT_THINKING_BUDGET = 8000;
/** Answer headroom added to the budget when max_tokens has to be raised. */
const THINKING_MAX_HEADROOM = 1024;
/** Stash cap for thinking blocks awaiting their tool-result round trip. */
const THINKING_STASH_CAP = 64;

/**
 * Extended-thinking request hints, written by the chat view from plugin
 * settings before each send. Module-level rather than a constructor/setter
 * dependency because the registry builds AnthropicProvider with just
 * (apiKey, endpoint) — threading settings through it would touch every
 * construction site for one boolean. Consumers: formatRequest only.
 */
export interface AnthropicThinkingHints {
	enabled: boolean;
	budgetTokens: number;
}

let thinkingHints: AnthropicThinkingHints = { enabled: false, budgetTokens: DEFAULT_THINKING_BUDGET };

export function setAnthropicThinkingHints(hints: AnthropicThinkingHints): void {
	thinkingHints = {
		enabled: hints.enabled === true,
		budgetTokens:
			typeof hints.budgetTokens === 'number' && Number.isFinite(hints.budgetTokens) && hints.budgetTokens > 0
				? Math.floor(hints.budgetTokens)
				: DEFAULT_THINKING_BUDGET,
	};
}

/**
 * Conservative heuristic for extended-thinking support by model id. Returns
 * false only for lines known to REJECT the thinking parameter (Claude 1/2,
 * Instant, and 3.x before 3.7 — incl. the dotted 3.5 alias shape); anything
 * unrecognized (custom gateways, future ids) returns true so the toggle is
 * still honored. A model that genuinely can't think 400s and the API's own
 * error text surfaces through the normal error path.
 */
export function supportsExtendedThinking(modelId: string): boolean {
	return !/claude-(1|2|instant)|claude-3[.-](opus|sonnet|haiku|[0-5])/i.test(modelId);
}

/**
 * Extended-thinking stream sentinels. parseStream emits each tag as a
 * STANDALONE onChunk call (never glued to payload text) so the chat view's
 * splitter can route chunks by exact match with no cross-chunk stitching.
 * They ride the normal onChunk channel because every layer between
 * parseStream and the view (transport, callAI) forwards chunks verbatim;
 * thinking must never mix into the answer buffer, so the view splits here.
 */
export const THINKING_OPEN_TAG = '<think>';
export const THINKING_CLOSE_TAG = '</think>';

/**
 * Route a sentinel-tagged chunk stream into thinking vs answer text.
 * One instance per streamed reply (per chat bubble / arena column) — the
 * open/closed state is the stream's, not the provider's.
 */
export class ThinkingStreamSplitter {
	private inThinking = false;
	private readonly thinkingParts: string[] = [];

	/** Consume one onChunk payload; returns the thinking and answer text it
	 *  contributed (either side may be ''). */
	push(chunk: string): { thinking: string; answer: string } {
		if (chunk === THINKING_OPEN_TAG) {
			this.inThinking = true;
			return { thinking: '', answer: '' };
		}
		if (chunk === THINKING_CLOSE_TAG) {
			this.inThinking = false;
			return { thinking: '', answer: '' };
		}
		if (this.inThinking) {
			this.thinkingParts.push(chunk);
			return { thinking: chunk, answer: '' };
		}
		return { thinking: '', answer: chunk };
	}

	/** Full thinking text seen so far (for the final collapsed render). */
	getThinking(): string {
		return this.thinkingParts.join('');
	}
}

const ANTHROPIC_MODELS: AIModel[] = [
	{
		id: 'claude-opus-4-6',
		name: 'Claude Opus 4.6',
		contextLength: 200000,
		inputPrice: 15.0,
		outputPrice: 75.0,
		visionSupported: true,
		functionCallingSupported: true,
	},
	{
		id: 'claude-sonnet-4-5-20250929',
		name: 'Claude Sonnet 4.5',
		contextLength: 200000,
		inputPrice: 3.0,
		outputPrice: 15.0,
		visionSupported: true,
		functionCallingSupported: true,
	},
	{
		id: 'claude-haiku-4-5-20251001',
		name: 'Claude Haiku 4.5',
		contextLength: 200000,
		inputPrice: 0.8,
		outputPrice: 4.0,
		visionSupported: true,
		functionCallingSupported: true,
	},
];

export function getAnthropicModels(): AIModel[] {
	return ANTHROPIC_MODELS;
}

export class AnthropicProvider implements AIProvider {
	readonly id = 'anthropic';
	readonly name = 'Anthropic Claude';
	readonly endpoint: string;
	models = ANTHROPIC_MODELS;  // mutable so auto-discovery can update in place
	readonly supportsStreaming = true;
	readonly supportsVision = true;

	private apiKey: string;

	/**
	 * Thinking blocks from recent assistant turns, keyed by each tool_use id
	 * of the SAME turn. When extended thinking is on, Anthropic requires a
	 * tool_result turn to replay the preceding assistant message's thinking
	 * blocks verbatim (signatures intact) — but the agent loop rebuilds
	 * assistant turns from the canonical AIMessage shape (plain text +
	 * tool_calls), which cannot carry them. The provider therefore remembers
	 * them here (see parseResponse) and toAnthropicMessages re-attaches them.
	 */
	private thinkingStash = new Map<string, Array<AnthropicThinkingBlock | AnthropicRedactedThinkingBlock>>();

	constructor(apiKey: string, endpoint = 'https://api.anthropic.com/v1/messages') {
		this.apiKey = apiKey;
		this.endpoint = endpoint;
	}

	/** Replace this provider's model list (used by auto-discovery). */
	setModels(models: AIModel[]): void {
		this.models = models;
	}

	isAuthenticated(): boolean {
		return this.apiKey.length > 0;
	}

	/** Native tool use (agent mode) — Claude speaks its own tools dialect. */
	supportsToolCalls(): boolean {
		return true;
	}

	formatRequest(messages: AIMessage[], options: AIRequestOptions): RequestInit {
		// Claude requires system message as a separate top-level param
		const systemMessage = messages.find((m) => m.role === 'system');
		const system = typeof systemMessage?.content === 'string' ? systemMessage.content : '';
		const chatMessages = toAnthropicMessages(messages, this.thinkingStash);

		const body: Record<string, unknown> = {
			model: options.model,
			max_tokens: options.maxTokens,
			system,
			messages: chatMessages,
			stream: options.stream ?? false,
		};
		// Sampling knobs that exist in Claude's dialect. temperature is omitted
		// entirely when unset — post-Opus-4.6 models 400 on any value != 1.0.
		// Anthropic has no frequency/presence penalty, seed, top_p-and-temperature
		// interplay caveats beyond range (0..1), so unsupported overrides are
		// dropped upstream by the capability matrix before they get here.
		if (options.temperature !== undefined) body.temperature = options.temperature;
		if (options.topP !== undefined) body.top_p = options.topP;
		if (options.topK !== undefined) body.top_k = options.topK;
		if (options.stop && options.stop.length > 0) body.stop_sequences = options.stop;

		// Reasoning-effort dialect (thinking{budget_tokens}) — merged before the
		// user's passthrough so an explicit extra-body value still wins.
		mergeReasoningBody(body, options.reasoningBody);

		// Extended-thinking toggle (Settings → Anthropic). Applied only when
		// the request carries no thinking config yet — a reasoning-effort dial
		// value is the more specific request, and the user's raw passthrough
		// (merged next) still wins over everything.
		if (!body.thinking && thinkingHints.enabled && supportsExtendedThinking(options.model)) {
			// Clamp: budget_tokens must be >= 1024 and STRICTLY below max_tokens
			// — raise the cap when the budget wouldn't leave room for an answer.
			let budget = Math.max(MIN_THINKING_BUDGET, thinkingHints.budgetTokens);
			let maxTokens = options.maxTokens;
			if (!(maxTokens > budget)) maxTokens = budget + THINKING_MAX_HEADROOM;
			body.max_tokens = maxTokens;
			body.thinking = { type: 'enabled', budget_tokens: budget };
		}

		// Raw passthrough — the escape hatch for Claude-only params
		// (thinking{budget_tokens}, output_config, metadata, …).
		mergeExtraBody(body, options.extra);

		// Agent mode: advertise tools in Anthropic's native shape. Tool calls
		// come back as tool_use content blocks (see parseResponse); results go
		// back as tool_result user blocks (see toAnthropicMessages).
		if (options.tools && options.tools.length > 0) {
			body.tools = options.tools.map((t) => ({
				name: t.name,
				description: t.description,
				input_schema: buildToolParametersSchema(t),
			}));
			body.tool_choice = { type: 'auto' };
		}

		return {
			method: 'POST',
			headers: {
				'x-api-key': this.apiKey,
				'anthropic-version': '2023-06-01',
				'content-type': 'application/json',
			},
			body: JSON.stringify(body),
		};
	}

	async parseResponse(response: StreamResponse): Promise<AIResponse> {
		const raw: unknown = await response.json();
		if (!isAnthropicMessage(raw)) {
			throw new Error('Anthropic: unexpected response shape');
		}
		// Claude returns a content-block array where text, thinking, and
		// tool_use blocks interleave. Join all text; collect every tool_use as
		// a canonical ToolCall (input arrives as an object, not a JSON string);
		// keep thinking blocks for the tool-result round trip and expose the
		// readable ones as ai.reasoning.
		const texts: string[] = [];
		const toolCalls: ToolCall[] = [];
		const reasoningParts: string[] = [];
		const thinkingBlocks: Array<AnthropicThinkingBlock | AnthropicRedactedThinkingBlock> = [];
		for (const block of raw.content) {
			if (block.type === 'text' && block.text) {
				texts.push(block.text);
			} else if (block.type === 'tool_use') {
				toolCalls.push({
					id: block.id,
					name: block.name,
					arguments: isRecord(block.input) ? block.input : {},
				});
			} else if (block.type === 'thinking') {
				thinkingBlocks.push(block);
				reasoningParts.push(block.thinking);
			} else if (block.type === 'redacted_thinking') {
				thinkingBlocks.push(block);
				reasoningParts.push('[reasoning redacted by Anthropic]');
			}
		}
		const u = raw.usage;
		const usage: TokenUsage = {
			promptTokens: u.input_tokens || 0,
			completionTokens: u.output_tokens || 0,
			totalTokens: (u.input_tokens || 0) + (u.output_tokens || 0),
		};
		const ai: AIResponse = { content: texts.join('\n\n'), usage };
		if (toolCalls.length > 0) ai.tool_calls = toolCalls;
		if (reasoningParts.length > 0) ai.reasoning = reasoningParts.join('\n\n');
		// Stash per tool_use id so the follow-up tool_result turn can replay
		// the thinking blocks (see thinkingStash). FIFO-capped — only recent
		// turns can be the "current" turn a tool round must answer.
		if (thinkingBlocks.length > 0 && toolCalls.length > 0) {
			for (const call of toolCalls) {
				this.thinkingStash.set(call.id, thinkingBlocks);
			}
			while (this.thinkingStash.size > THINKING_STASH_CAP) {
				const oldest = this.thinkingStash.keys().next();
				if (oldest.done) break;
				this.thinkingStash.delete(oldest.value);
			}
		}
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
		// Captured from message_start; local to this stream so two concurrent
		// streams on the shared provider instance never cross-contaminate.
		let pendingInputTokens = 0;
		let truncationSent = false;
		// Extended-thinking state, local like the counters above. Sentinels go
		// out as standalone onChunk calls (see THINKING_OPEN_TAG) so the chat
		// view can split thinking away from the answer text.
		let thinkingOpen = false;
		const openThinking = (): void => {
			if (thinkingOpen) return;
			thinkingOpen = true;
			onChunk(THINKING_OPEN_TAG);
		};
		const closeThinking = (): void => {
			if (!thinkingOpen) return;
			thinkingOpen = false;
			onChunk(THINKING_CLOSE_TAG);
		};

		const processLine = (line: string): void => {
			const clean = line.endsWith('\r') ? line.slice(0, -1) : line;
			if (!clean.trim() || !clean.startsWith('data:')) return;
			const data = clean.charAt(5) === ' ' ? clean.slice(6) : clean.slice(5);
			if (data === '[DONE]') return;

			try {
				const rawEvent: unknown = JSON.parse(data);
				if (!isAnthropicStreamEvent(rawEvent)) return;
				switch (rawEvent.type) {
					case 'content_block_delta':
						if (rawEvent.delta.type === 'text_delta') {
							closeThinking();
							if (rawEvent.delta.text) onChunk(rawEvent.delta.text);
						} else if (rawEvent.delta.type === 'thinking_delta') {
							openThinking();
							if (rawEvent.delta.thinking) onChunk(rawEvent.delta.thinking);
						}
						// signature_delta is the thinking block's opaque integrity
						// HMAC — metadata, never displayable. input_json_delta is
						// tool-call incremental JSON — not surfaced in this
						// implementation. Both fall through silently.
						break;
					case 'content_block_start':
						if (rawEvent.content_block.type === 'redacted_thinking') {
							// Redacted blocks carry no deltas — emit a placeholder so
							// the reasoning panel isn't silently empty.
							openThinking();
							onChunk('[reasoning redacted by Anthropic]');
						}
						break;
					case 'content_block_stop':
						// No-op unless a thinking block just closed (also a safe
						// no-op for text/tool blocks — closeThinking guards).
						closeThinking();
						break;
					case 'message_delta':
						if (!truncationSent && rawEvent.delta.stop_reason === 'max_tokens') {
							truncationSent = true;
							onChunk(TRUNCATION_MARKER);
						}
						if (onUsage) {
							// output_tokens here is cumulative; input_tokens lives on
							// message_start, so use the saved value.
							const inputTokens = pendingInputTokens;
							const outputTokens = rawEvent.usage.output_tokens || 0;
							onUsage({
								promptTokens: inputTokens,
								completionTokens: outputTokens,
								totalTokens: inputTokens + outputTokens,
							});
						}
						break;
					case 'message_start':
						// Initial event carries input_tokens (prompt size) under
						// message.usage. Save it; the final usage comes from
						// message_delta which only carries output_tokens.
						pendingInputTokens = rawEvent.message.usage.input_tokens || 0;
						break;
					case 'error':
						if (onError) {
							// Mid-stream error event — surface and stop.
							const errMsg = rawEvent.error.message || 'Anthropic stream error';
							onError(new Error(errMsg));
							return;
						}
						break;
					case 'message_stop':
						closeThinking();
						break;
					case 'ping':
						// no-op event type in this implementation
						break;
					default: {
						// exhaustive — if Anthropic adds a new event type, TS
						// will flag this assignment as non-assignable to never.
						const _exhaustive: never = rawEvent;
						void _exhaustive;
					}
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

/**
 * Map canonical AIMessage[] to Anthropic message turns. Key differences from
 * the OpenAI wire shape:
 *   - assistant tool_calls become tool_use content blocks (input as object)
 *   - role:'tool' results become *user* turns with tool_result blocks
 *   - consecutive tool results are grouped into one user turn (Anthropic
 *     requires every tool_use to be answered in the immediately following
 *     user message)
 *
 * `thinkingStash` carries the extended-thinking blocks of recent assistant
 * turns (keyed by tool_use id, captured in parseResponse). When a rebuilt
 * assistant turn matches a stashed turn, the blocks are replayed FIRST in the
 * content array — with extended thinking on, Anthropic rejects a tool_result
 * round whose assistant message dropped its thinking blocks.
 */
function toAnthropicMessages(
	messages: AIMessage[],
	thinkingStash?: ReadonlyMap<string, ReadonlyArray<AnthropicThinkingBlock | AnthropicRedactedThinkingBlock>>
): Array<{ role: 'user' | 'assistant'; content: string | Array<Record<string, unknown>> }> {
	const out: Array<{ role: 'user' | 'assistant'; content: string | Array<Record<string, unknown>> }> = [];
	for (const m of messages) {
		if (m.role === 'system') continue;

		if (m.role === 'tool') {
			const block: Record<string, unknown> = {
				type: 'tool_result',
				tool_use_id: m.tool_call_id ?? '',
				content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
			};
			if (m.is_error) block.is_error = true;
			// Group into the previous user turn if it is a pure tool_result turn.
			const prev = out[out.length - 1];
			if (
				prev &&
				prev.role === 'user' &&
				Array.isArray(prev.content) &&
				prev.content.length > 0 &&
				prev.content.every((b) => b.type === 'tool_result')
			) {
				prev.content.push(block);
			} else {
				out.push({ role: 'user', content: [block] });
			}
			continue;
		}

		if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
			const blocks: Array<Record<string, unknown>> = [];
			// Replay this turn's thinking blocks before text/tool_use — the API
			// requires them first and signatures intact. All tool calls of a
			// turn share one block list, so the first hit supplies it.
			for (const call of m.tool_calls) {
				const stashed = thinkingStash?.get(call.id);
				if (stashed) {
					for (const tb of stashed) blocks.push({ ...tb });
					break;
				}
			}
			const text = typeof m.content === 'string' ? m.content : '';
			if (text) blocks.push({ type: 'text', text });
			for (const call of m.tool_calls) {
				blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments });
			}
			out.push({ role: 'assistant', content: blocks });
			continue;
		}

		out.push({ role: m.role, content: toAnthropicContent(m.content) });
	}
	return out;
}

/**
 * Convert our unified message content (string | MessageContent[]) into the
 * Anthropic API's content-block shape. Pure strings pass through; image_url
 * parts (assumed to be data: URLs of the form `data:<mime>;base64,<data>`)
 * are converted into `{type:'image', source:{type:'base64', media_type, data}}`.
 */
function toAnthropicContent(content: AIMessage['content']): string | Array<Record<string, unknown>> {
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return '';
	const blocks: Array<Record<string, unknown>> = [];
	for (const part of content) {
		if (part.type === 'text' && part.text) {
			blocks.push({ type: 'text', text: part.text });
		} else if (part.type === 'image_url' && part.image_url?.url) {
			const parsed = parseDataUrl(part.image_url.url);
			if (parsed) {
				blocks.push({
					type: 'image',
					source: {
						type: 'base64',
						media_type: parsed.mime,
						data: parsed.data,
					},
				});
			}
		}
	}
	if (blocks.length === 0) {
		// All parts filtered out (e.g. image-only message with non-data-URL).
		// Anthropic rejects empty content blocks — fall back to a placeholder.
		return [{ type: 'text', text: '[image removed — unsupported format]' }];
	}
	return blocks;
}

function parseDataUrl(url: string): { mime: string; data: string } | null {
	const trimmed = url.trim();
	const m = trimmed.match(/^data:([^;]+);base64,(.+)$/);
	if (!m) return null;
	return { mime: m[1], data: m[2] };
}
