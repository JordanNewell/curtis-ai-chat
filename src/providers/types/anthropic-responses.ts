// Anthropic Messages API — https://docs.anthropic.com/en/api/messages

/** Why the model stopped. `pause_turn` means the server paused a long turn
 *  (possible under extended thinking) — the client may re-issue the request
 *  with the partial turn appended. */
export type AnthropicStopReason =
	| 'end_turn'
	| 'max_tokens'
	| 'stop_sequence'
	| 'tool_use'
	| 'pause_turn'
	| 'refusal'
	| null;

/** Extended-thinking block: the model's visible reasoning plus a `signature`
 *  (opaque HMAC) that must be echoed back verbatim when the block is replayed
 *  in a follow-up turn. */
export interface AnthropicThinkingBlock {
	type: 'thinking';
	thinking: string;
	signature: string;
}

/** Opaque encrypted reasoning — emitted instead of a thinking block when
 *  Anthropic declines to expose the raw text. `data` must be passed back
 *  unmodified, like a thinking block's signature. */
export interface AnthropicRedactedThinkingBlock {
	type: 'redacted_thinking';
	data: string;
}

export type AnthropicStreamEvent =
	| { type: 'message_start'; message: AnthropicMessage }
	| { type: 'message_delta'; delta: { stop_reason?: AnthropicStopReason; stop_sequence?: string | null }; usage: { output_tokens: number } }
	| { type: 'message_stop' }
	| { type: 'content_block_start'; index: number; content_block: AnthropicContentBlock }
	| { type: 'content_block_delta'; index: number; delta: AnthropicContentDelta }
	| { type: 'content_block_stop'; index: number }
	| { type: 'ping' }
	| { type: 'error'; error: { type: string; message: string } };

export type AnthropicContentBlock =
	| { type: 'text'; text: string }
	| { type: 'tool_use'; id: string; name: string; input: unknown }
	| AnthropicThinkingBlock
	| AnthropicRedactedThinkingBlock;

export type AnthropicContentDelta =
	| { type: 'text_delta'; text: string }
	| { type: 'input_json_delta'; partial_json: string }
	| { type: 'thinking_delta'; thinking: string }
	| { type: 'signature_delta'; signature: string };

export interface AnthropicMessage {
	id: string;
	type: 'message';
	role: 'assistant';
	model: string;
	content: AnthropicContentBlock[];
	stop_reason: AnthropicStopReason;
	stop_sequence: string | null;
	usage: { input_tokens: number; output_tokens: number };
}

// Type guards
import { isRecord, hasStringProp } from '../../core/types/json-helpers';

export function isAnthropicStreamEvent(v: unknown): v is AnthropicStreamEvent {
	return isRecord(v) && hasStringProp(v, 'type');
}

export function isAnthropicMessage(v: unknown): v is AnthropicMessage {
	return isRecord(v) && hasStringProp(v, 'id') && (v as { type: unknown }).type === 'message';
}
