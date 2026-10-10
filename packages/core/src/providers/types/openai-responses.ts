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

// Model listing
export interface OpenAIModel {
  id: string;
  // 'model' in practice; string allows provider variants.
  object: string;
  created?: number;
  owned_by?: string;
}

export interface OpenAIModelList {
  object: 'list';
  data: OpenAIModel[];
}

// Type guards
import { isRecord, hasStringProp, hasArrayProp } from '../../core/types/json-helpers';

export function isOpenAIChatCompletion(v: unknown): v is OpenAIChatCompletion {
  return isRecord(v) && hasStringProp(v, 'id') && hasArrayProp(v, 'choices');
}

export function isOpenAIChunk(v: unknown): v is OpenAIChatCompletionChunk {
  return isRecord(v) && hasStringProp(v, 'id') && hasArrayProp(v, 'choices');
}

export function isOpenAIModelList(v: unknown): v is OpenAIModelList {
  return isRecord(v) && hasStringProp(v, 'object') && hasArrayProp(v, 'data');
}
