// OpenAI ChatCompletion response shapes. Also covers ~24 OpenAI-compatible
// providers (OpenRouter, Groq, Together, Fireworks, Mistral, DeepSeek, Cohere,
// Vercel, xAI, Perplexity, Novita, DeepInfra, Hyperbolic, Chutes, Replicate,
// Lepton, Lambda, HF, Azure, GitHub Models, Cerebras, SambaNova, Requesty, fal).

export interface OpenAIChoiceMessage {
  // 'assistant' | 'tool' in practice; string allows provider variants.
  role: string;
  content: string | null;
  tool_calls?: OpenAIToolCall[];
}

export interface OpenAIChoice {
  index: number;
  message: OpenAIChoiceMessage;
  finish_reason: string | null;
}

export interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface OpenAIChatCompletion {
  id: string;
  // 'chat.completion' in practice; string allows provider variants.
  object: string;
  created: number;
  model: string;
  choices: OpenAIChoice[];
  usage?: OpenAIUsage;
}

// Streaming chunk — note `delta` instead of `message`, partial content.
export interface OpenAIChunkDelta {
  role?: string;
  content?: string;
  tool_calls?: OpenAIToolCall[];
}

export interface OpenAIChunkChoice {
  index: number;
  delta: OpenAIChunkDelta;
  finish_reason: string | null;
}

export interface OpenAIChatCompletionChunk {
  id: string;
  // 'chat.completion.chunk' in practice; string allows provider variants.
  object: string;
  choices: OpenAIChunkChoice[];
  usage?: OpenAIUsage;
}

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

// Type guards
import { isRecord, hasStringProp, hasArrayProp } from '../../core/types/json-helpers';

export function isOpenAIChatCompletion(v: unknown): v is OpenAIChatCompletion {
  return isRecord(v) && hasStringProp(v, 'id') && hasArrayProp(v, 'choices');
}

export function isOpenAIChunk(v: unknown): v is OpenAIChatCompletionChunk {
  return isRecord(v) && hasStringProp(v, 'id') && hasArrayProp(v, 'choices');
}

// ---------------------------------------------------------------------------
// OpenAI Responses API (POST /v1/responses) — the surface Sign in with
// ChatGPT plan-usage tokens call. Distinct wire shape from Chat Completions:
// output is a flat item array (message / function_call), usage uses
// input_tokens/output_tokens, and streams are typed events, not chunks.
// ---------------------------------------------------------------------------

export interface ResponsesUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens?: number;
}

export interface ResponsesOutputTextPart {
  type: 'output_text';
  text: string;
}

export interface ResponsesOutputMessage {
  type: 'message';
  role: string;
  content: ResponsesOutputTextPart[];
}

export interface ResponsesFunctionCall {
  type: 'function_call';
  /** call_id pairs the call with its function_call_output on the next turn. */
  call_id?: string;
  id?: string;
  name: string;
  /** JSON-encoded arguments string, same convention as Chat Completions. */
  arguments: string;
}

export type ResponsesOutputItem = ResponsesOutputMessage | ResponsesFunctionCall;

export interface ResponsesResponse {
  id: string;
  object?: string;  // 'response'
  model?: string;
  /** 'completed' | 'failed' | 'incomplete' (streaming final states and the
   *  non-streaming body share this field). */
  status?: string;
  error?: { message?: string; code?: string } | null;
  incomplete_details?: { reason?: string } | null;
  output: ResponsesOutputItem[];
  usage?: ResponsesUsage;
}

export type ResponsesStreamEvent =
  | { type: 'response.output_text.delta'; delta: string }
  | { type: 'response.output_item.done'; item: ResponsesOutputItem }
  | { type: 'response.completed'; response: ResponsesResponse }
  | { type: 'response.incomplete'; response: ResponsesResponse }
  | { type: 'response.failed'; response: ResponsesResponse }
  | { type: 'error'; message?: string; code?: string };

export function isResponsesResponse(v: unknown): v is ResponsesResponse {
  return isRecord(v) && hasStringProp(v, 'id') && hasArrayProp(v, 'output');
}

export function isResponsesStreamEvent(v: unknown): v is ResponsesStreamEvent {
  return isRecord(v) && hasStringProp(v, 'type');
}

export function isResponsesOutputMessage(v: ResponsesOutputItem): v is ResponsesOutputMessage {
  return v.type === 'message';
}

export function isResponsesFunctionCall(v: ResponsesOutputItem): v is ResponsesFunctionCall {
  return v.type === 'function_call';
}
