// Ollama Chat API — https://github.com/ollama/ollama/blob/main/docs/api.md

export interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: { role: string; content: string };
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

export interface OllamaTagsResponse {
  models: Array<{ name: string; model: string; modified_at: string; size: number }>;
}

export interface OllamaVersionResponse { version: string }

import { isRecord, hasStringProp, hasArrayProp } from '../../core/types/json-helpers';

export function isOllamaChatResponse(v: unknown): v is OllamaChatResponse {
  return isRecord(v) && hasStringProp(v, 'model') && hasStringProp(v, 'message');
}

export function isOllamaTagsResponse(v: unknown): v is OllamaTagsResponse {
  return isRecord(v) && hasArrayProp(v, 'models');
}

export function isOllamaVersionResponse(v: unknown): v is OllamaVersionResponse {
  return isRecord(v) && hasStringProp(v, 'version');
}
