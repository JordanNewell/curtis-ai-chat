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
import { buildToolParametersSchema } from '../core/tools';
import { isRecord } from '../core/types/json-helpers';

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
	readonly endpoint = 'https://api.anthropic.com/v1/messages';
	models = ANTHROPIC_MODELS;  // mutable so auto-discovery can update in place
	readonly supportsStreaming = true;
	readonly supportsVision = true;

	private apiKey: string;
	/** Captured from message_start; emitted with output_tokens in message_delta. */
	private pendingInputTokens = 0;

	constructor(apiKey: string) {
		this.apiKey = apiKey;
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
		const chatMessages = toAnthropicMessages(messages);

		const body: Record<string, unknown> = {
			model: options.model,
			max_tokens: options.maxTokens,
			temperature: options.temperature,
			system,
			messages: chatMessages,
			stream: options.stream ?? false,
		};

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
		// Claude returns a content-block array where text and tool_use blocks
		// interleave. Join all text; collect every tool_use as a canonical
		// ToolCall (input arrives as an object, not a JSON string).
		const texts: string[] = [];
		const toolCalls: ToolCall[] = [];
		for (const block of raw.content) {
			if (block.type === 'text' && block.text) {
				texts.push(block.text);
			} else if (block.type === 'tool_use') {
				toolCalls.push({
					id: block.id,
					name: block.name,
					arguments: isRecord(block.input) ? block.input : {},
				});
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
		// Reset per-stream; the message_start handler sets this.
		this.pendingInputTokens = 0;

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					if (!line.trim() || !line.startsWith('data: ')) continue;
					const data = line.slice(6);
					if (data === '[DONE]') continue;

					try {
						const rawEvent: unknown = JSON.parse(data);
						if (!isAnthropicStreamEvent(rawEvent)) continue;
						switch (rawEvent.type) {
							case 'content_block_delta':
								if (rawEvent.delta.type === 'text_delta') {
									if (rawEvent.delta.text) onChunk(rawEvent.delta.text);
								}
								// input_json_delta is tool-call incremental JSON — not
								// surfaced in this implementation; fall through silently.
								break;
							case 'message_delta':
								if (onUsage) {
									// output_tokens here is cumulative; input_tokens lives on
									// message_start, so use the saved value.
									const inputTokens = this.pendingInputTokens;
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
								this.pendingInputTokens = rawEvent.message.usage.input_tokens || 0;
								break;
							case 'error':
								if (onError) {
									// Mid-stream error event — surface and stop.
									const errMsg = rawEvent.error.message || 'Anthropic stream error';
									onError(new Error(errMsg));
								}
								break;
							case 'message_stop':
							case 'ping':
							case 'content_block_start':
							case 'content_block_stop':
								// no-op for these event types in this implementation
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
				}
			}
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
 */
function toAnthropicMessages(messages: AIMessage[]): Array<{ role: 'user' | 'assistant'; content: string | Array<Record<string, unknown>> }> {
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
