// Gemini GenerateContent API — https://ai.google.dev/api/rest/v1beta/models/generateContent

export interface GeminiTextPart { text: string }

export interface GeminiCandidate {
  content: { parts: GeminiTextPart[]; role: string };
  finishReason?: string;
  index?: number;
}

export interface GeminiUsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

export interface GeminiGenerateContentResponse {
  candidates: GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
}

// Streaming chunk — same shape, partial.
export interface GeminiStreamChunk {
  candidates: GeminiCandidate[];
}

export interface GeminiModelListResponse {
  models: Array<{ name: string; displayName?: string; supportedGenerationMethods?: string[] }>;
}

import { isRecord, hasArrayProp } from '../../core/types/json-helpers';

export function isGeminiResponse(v: unknown): v is GeminiGenerateContentResponse {
  return isRecord(v) && hasArrayProp(v, 'candidates');
}

export function isGeminiModelList(v: unknown): v is GeminiModelListResponse {
  return isRecord(v) && hasArrayProp(v, 'models');
}
