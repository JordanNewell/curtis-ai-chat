// Anthropic Messages API — https://docs.anthropic.com/en/api/messages

export type AnthropicStreamEvent =
  | { type: 'message_start'; message: AnthropicMessage }
  | { type: 'message_delta'; delta: { stop_reason?: string; stop_sequence?: string | null }; usage: { output_tokens: number } }
  | { type: 'message_stop' }
  | { type: 'content_block_start'; index: number; content_block: AnthropicContentBlock }
  | { type: 'content_block_delta'; index: number; delta: AnthropicContentDelta }
  | { type: 'content_block_stop'; index: number }
  | { type: 'ping' }
  | { type: 'error'; error: { type: string; message: string } };

export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown };

export type AnthropicContentDelta =
  | { type: 'text_delta'; text: string }
  | { type: 'input_json_delta'; partial_json: string };

export interface AnthropicMessage {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: AnthropicContentBlock[];
  stop_reason: string | null;
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
