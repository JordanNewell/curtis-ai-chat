# Curtis AI Chat v4.0.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `curtis-ai-chat` v4.0.0 — rebrand "Curtis" → "Curtis AI Chat", bump minAppVersion to 1.13.0, eliminate all ~50 Obsidian linter warnings via full TypeScript type safety on every external JSON surface, modernize settings API to declarative `getSettingDefinitions()`.

**Architecture:** Sequential file-by-file subagent execution. Each subagent owns a tightly-scoped set of files to completion, runs `npm run build` + lint as the gate, commits, and Jordan reviews every diff before the next subagent invokes. Type safety work uses `unknown` + type guards at every external JSON boundary (HTTP responses, parsed bodies, provider payloads); internal code never sees `any`.

**Tech Stack:** TypeScript 5.3, esbuild 0.19, Obsidian plugin API (min 1.13.0), eslint 8 with `@typescript-eslint`. No test framework — TypeScript compiler + Obsidian manual load are the verification gates.

**Spec:** `docs/superpowers/specs/2026-07-22-curtis-ai-chat-rebrand-and-cleanup-design.md`

---

## Test strategy (read first)

This codebase has no Jest/Vitest/Mocha. Do not invent one. The verification gates are:

1. **Type-safety work** → `npx tsc -noEmit -skipLibCheck` exits 0 (the type checker IS the test)
2. **Lint** → `npm run lint` (or `npx eslint src --ext .ts`) reports zero warnings
3. **Build** → `npm run build` (tsc + esbuild) produces `main.js`
4. **Acceptance** → at phase boundaries, Jordan loads the rebuilt `main.js` into Obsidian and smoke-tests

Every task ends with steps 1-3. Acceptance (step 4) is called out explicitly at phase boundaries, not every task.

## Branch strategy

Work on `master` direct. After each subagent's commit, Jordan reviews the diff. If the diff is large or risky, branch as `fix/v4-<subagent-name>`, squash-merge to master. Per Jordan's standing preference for this repo during initial-launch period.

## Commit message conventions

- Lowercase prefix: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `release:`
- Subject ≤72 chars, body wraps at 80
- **NEVER** add `Co-Authored-By: Claude` or any AI-attribution trailer
- **NEVER** use `--no-verify` — the git hook harness catches secrets + AI trailers; if a hook fails, fix the underlying issue

---

## Phase 0: Pre-flight

### Task 0.1: Verify clean baseline

**Files:** none

- [ ] **Step 1: Confirm working tree clean**

Run: `cd E:/dev/projects/obsidian-glm-plugin && git status`
Expected: `nothing to commit, working tree clean`

- [ ] **Step 2: Confirm current build passes**

Run: `cd E:/dev/projects/obsidian-glm-plugin && npm run build`
Expected: exit 0, `main.js` written, no TS errors

- [ ] **Step 3: Capture baseline warning count**

Run: `cd E:/dev/projects/obsidian-glm-plugin && npx eslint src --ext .ts 2>&1 | tee /tmp/baseline-lint.txt | tail -5`
Expected: a countable number of warnings (the ones in the spec). Save baseline for diff at end.

- [ ] **Step 4: Confirm Obsidian 1.13.0 is available for testing**

Jordan confirms his Obsidian is on 1.13.0+. If not, upgrade before Phase 1 starts.

---

## Phase 1: Foundation (Subagent 1)

### Task 1.1: Bump version + minAppVersion baseline

**Files:**
- Modify: `manifest.json`
- Modify: `package.json`
- Modify: `versions.json`
- Modify: `CHANGELOG.md` (add `## [4.0.0] — Unreleased` placeholder)

- [ ] **Step 1: Edit manifest.json**

Change `"version": "3.0.1"` → `"version": "4.0.0"`.
Change `"minAppVersion": "1.11.4"` → `"minAppVersion": "1.13.0"`.
Leave `id`, `name`, `description` untouched (those change in Phase 6).

- [ ] **Step 2: Edit package.json**

Change `"version": "3.0.1"` → `"version": "4.0.0"`.
Leave `"name": "curtis"` untouched (changes in Phase 6).

- [ ] **Step 3: Edit versions.json**

Add line `"4.0.0": "1.13.0"` after the 3.0.1 entry. Result:
```json
{
	"1.0.0": "0.15.0",
	"2.0.0": "0.15.0",
	"3.0.0": "1.0.0",
	"3.0.1": "1.11.4",
	"4.0.0": "1.13.0"
}
```

- [ ] **Step 4: Add CHANGELOG placeholder**

Insert at top of `CHANGELOG.md` (above `## [3.0.1]`):
```markdown
## [4.0.0] — Unreleased

Major release: rebrand to Curtis AI Chat, bump minAppVersion to 1.13.0, full TypeScript type-safety pass. Plugin ID changed from `curtis` to `curtis-ai-chat` — existing installs will need to reinstall.

### Added
- (populated during release)

### Changed
- (populated during release)

### Removed
- (populated during release)
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: exit 0

- [ ] **Step 6: Commit**

```bash
git add manifest.json package.json versions.json CHANGELOG.md
git commit -m "chore: bump to v4.0.0, minAppVersion 1.13.0"
```

- [ ] **Step 7: Jordan review gate**

Jordan inspects the 4-file diff. Proceed to Phase 2 on approval.

---

## Phase 2: Provider spine typing (Subagent 2)

### Task 2.1: Create json-helpers module

**Files:**
- Create: `src/core/types/json-helpers.ts`

- [ ] **Step 1: Read boundary context**

Read: `src/providers/stream-shim.ts` (the file that returns `Promise<any>` from `JSON.parse`)
Read: `src/providers/transport.ts` (lines 150-300 — the runViaRequestUrl body parsing)

- [ ] **Step 2: Create json-helpers.ts**

Full file content:
```typescript
// Type guards for narrowing `unknown` values at JSON boundaries.
// Every external JSON parse site should pass through one of these before
// the value enters typed code.

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function hasStringProp(v: object, k: string): v is Record<string, string> & typeof v {
  return k in v && typeof (v as Record<string, unknown>)[k] === 'string';
}

export function hasNumberProp(v: object, k: string): v is Record<string, number> & typeof v {
  return k in v && typeof (v as Record<string, unknown>)[k] === 'number';
}

export function hasArrayProp(v: object, k: string): v is Record<string, unknown[]> & typeof v {
  return k in v && Array.isArray((v as Record<string, unknown>)[k]);
}

export function hasProp<T extends object>(v: unknown, k: string): v is T {
  return isRecord(v) && k in v;
}

export function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

export function asNumber(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Narrow unknown to a typed record with required string fields. Throws on mismatch. */
export function requireRecord(v: unknown, context: string): Record<string, unknown> {
  if (!isRecord(v)) {
    throw new Error(`Expected JSON object for ${context}, got ${typeof v}`);
  }
  return v;
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: exit 0 (new file is standalone, no consumers yet)

- [ ] **Step 4: Commit**

```bash
git add src/core/types/json-helpers.ts
git commit -m "feat(types): add json-helpers for narrowing unknown at boundaries"
```

### Task 2.2: Type-narrow stream-shim.ts

**Files:**
- Modify: `src/providers/stream-shim.ts:99-150` (the `streamResponseFromNode` + `streamResponseFromBuffer` + `readAllText` block)
- Modify: `src/types.ts` (the `StreamResponse` interface — change `json()` return type)

- [ ] **Step 1: Read current StreamResponse type**

Run: `grep -n "StreamResponse" src/types.ts`
Find the interface definition. Note the current `json(): Promise<any>` (or `Promise<unknown>`) signature.

- [ ] **Step 2: Change StreamResponse.json() return type**

In `src/types.ts`, change the `StreamResponse` interface:
```typescript
export interface StreamResponse {
  ok: boolean;
  status: number;
  body?: ReadableLike;
  json(): Promise<unknown>;   // was Promise<any>
  text(): Promise<string>;
}
```

- [ ] **Step 3: Update stream-shim.ts JSON.parse sites**

The `json:` arrow functions currently return `Promise<any>` implicitly (JSON.parse's stock signature). Make the cast explicit so future readers see the boundary:

In `streamResponseFromNode` (around line 105):
```typescript
json: async (): Promise<unknown> => JSON.parse(await readAllText(stream)),
```

In `streamResponseFromBuffer` (around line 137):
```typescript
json: async (): Promise<unknown> => (jsonCache !== undefined ? jsonCache : JSON.parse(bodyText)),
```

- [ ] **Step 4: Find all callers of `.json()` and narrow at the call site**

Run: `grep -rn "\.json()" src/providers/`

For each caller, replace `(await response.json()).someField` with a typed narrowing. Example for an Anthropic caller:

Before:
```typescript
const data = await response.json();
const content = data.content[0].text;
```

After:
```typescript
const data = await response.json();
if (!isRecord(data) || !Array.isArray(data.content)) {
  throw new Error('Anthropic response missing content array');
}
const content = data.content[0]?.text ?? '';
```

NOTE: The full per-provider schema work happens in Task 3.3+. For Task 2.2, do the minimum to keep `tsc` green: add `isRecord(data)` checks at each call site. The deeper schema typing is deferred to Phase 2 Task 3.

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: exit 0. All `Promise<any>` removed from `StreamResponse.json()`.

- [ ] **Step 6: Run lint**

Run: `npx eslint src/providers/stream-shim.ts src/types.ts --ext .ts`
Expected: zero `no-unsafe-*` warnings on these two files (the `error | any` union warnings on lines 20, 42 should be gone — verify by checking lint output).

- [ ] **Step 7: Commit**

```bash
git add src/providers/stream-shim.ts src/types.ts
git commit -m "refactor(types): StreamResponse.json returns unknown; boundary narrows"
```

### Task 2.3: Type-narrow transport.ts

**Files:**
- Modify: `src/providers/transport.ts:60-313` (the three transport implementations)
- Modify: `src/providers/transport.ts:130-300` (the unnecessary `as` assertions flagged in lint)

- [ ] **Step 1: Replace `error | any` union on line 60**

Find the type annotation containing `any` in a union (around line 60, `runViaFetch` signature area). Replace with `unknown` + narrowing at use sites.

- [ ] **Step 2: Drop unnecessary type assertions**

Lines flagged: 130, 297. Remove `as <Type>` where the receiver already accepts the original type.

- [ ] **Step 3: Add eslint-disable comments for fetch() calls**

Lines 80, 241, 245. Add justified eslint-disable above each `fetch` use:

```typescript
// fetch() is architecturally required here for mobile streaming.
// Obsidian's requestUrl does not support SSE streaming (it buffers).
// Linter flagged per https://docs.obsidian.md but mobile users have no alternative.
// eslint-disable-next-line no-restricted-globals
if (typeof fetch !== 'undefined') return 'fetch';
```

And above the actual `await fetch(...)` call in `runViaFetch`:
```typescript
// Mobile-only streaming path. requestUrl cannot stream SSE; node-https is
// unavailable on mobile. This is the only transport that works for mobile + CORS-friendly providers.
// eslint-disable-next-line no-restricted-globals
const response = await fetch(provider.endpoint, { ... });
```

- [ ] **Step 4: Type-narrow the `runViaRequestUrl` body parsing**

Around line 175-225. The current code does `(await response.json()) as SomeType`. Replace with:
```typescript
const body = await response.text();
const data: unknown = JSON.parse(body);
if (!isRecord(data)) {
  throw new Error(`${provider.name}: malformed JSON response`);
}
// Pass `data` to provider.parseResponse which will narrow further.
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: exit 0

- [ ] **Step 6: Run lint**

Run: `npx eslint src/providers/transport.ts --ext .ts`
Expected: zero `no-unsafe-*` warnings, zero `no-restricted-globals` warnings on `fetch` (suppressed with justification). The "unnecessary assertion" warnings on lines 130, 297 should be gone.

- [ ] **Step 7: Commit**

```bash
git add src/providers/transport.ts
git commit -m "refactor(transport): narrow JSON boundaries, justify fetch for mobile"
```

- [ ] **Step 8: Jordan review gate**

Jordan reviews the stream-shim + transport diffs. Smoke-test: open Obsidian, send a chat message to any provider, confirm response streams. Proceed to Task 3 on approval.

---

## Phase 2 (cont.): Provider schemas (Subagent 3)

### Task 3.1: Create OpenAI response shape types

**Files:**
- Create: `src/providers/types/openai-responses.ts`

- [ ] **Step 1: Read existing Anthropic patterns**

Read: `src/providers/anthropic.ts` (already partially typed — use as reference for style)

- [ ] **Step 2: Create the OpenAI schema file**

Full content:
```typescript
// OpenAI ChatCompletion response shapes. Also covers ~24 OpenAI-compatible
// providers (OpenRouter, Groq, Together, Fireworks, Mistral, DeepSeek, Cohere,
// Vercel, xAI, Perplexity, Novita, DeepInfra, Hyperbolic, Chutes, Replicate,
// Lepton, Lambda, HF, Azure, GitHub Models, Cerebras, SambaNova, Requesty, fal).

export interface OpenAIChoiceMessage {
  role: 'assistant' | 'tool' | string;
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
  object: 'chat.completion' | string;
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
  object: 'chat.completion.chunk' | string;
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
  object: 'model' | string;
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
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: exit 0 (file standalone, no consumers yet)

- [ ] **Step 4: Commit**

```bash
git add src/providers/types/openai-responses.ts
git commit -m "feat(types): add OpenAI-compatible response schemas + type guards"
```

### Task 3.2: Create Anthropic, Gemini, Ollama schema files

**Files:**
- Create: `src/providers/types/anthropic-responses.ts`
- Create: `src/providers/types/gemini-responses.ts`
- Create: `src/providers/types/ollama-responses.ts`
- Create: `src/providers/types/sse.ts` (shared SSE event shape)

- [ ] **Step 1: Create anthropic-responses.ts**

Reference: `src/providers/anthropic.ts` (the partial discriminated union from 3.0.1).

Define full Message + stream-event shapes:
```typescript
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
```

- [ ] **Step 2: Create gemini-responses.ts**

```typescript
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
```

- [ ] **Step 3: Create ollama-responses.ts**

```typescript
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
  return isRecord(v) && hasStringProp(v, 'model') && hasStringProp(v, 'message') === false
    ? false
    : isRecord(v) && hasStringProp(v, 'model');
}

export function isOllamaTagsResponse(v: unknown): v is OllamaTagsResponse {
  return isRecord(v) && hasArrayProp(v, 'models');
}

export function isOllamaVersionResponse(v: unknown): v is OllamaVersionResponse {
  return isRecord(v) && hasStringProp(v, 'version');
}
```

- [ ] **Step 4: Create sse.ts (shared utilities)**

```typescript
// Shared SSE line-parsing utilities used by all streaming providers.

export interface SSEEvent { event?: string; data: string }

/** Parse one SSE block (separated by \n\n) into an event. */
export function parseSSEBlock(block: string): SSEEvent {
  let event: string | undefined;
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  return { event, data: dataLines.join('\n') };
}

/** Split a raw SSE stream into individual events. */
export function* iterateSSE(rawText: string): Generator<SSEEvent> {
  for (const block of rawText.split('\n\n')) {
    if (block.trim()) yield parseSSEBlock(block);
  }
}
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: exit 0 (all 4 new files standalone)

- [ ] **Step 6: Commit**

```bash
git add src/providers/types/anthropic-responses.ts src/providers/types/gemini-responses.ts src/providers/types/ollama-responses.ts src/providers/types/sse.ts
git commit -m "feat(types): add Anthropic, Gemini, Ollama, SSE schema modules"
```

### Task 3.3: Wire schemas into registry.ts

**Files:**
- Modify: `src/providers/registry.ts` (712 LOC — full pass)
- Modify: `src/providers/base.ts` (181 LOC — extend AIProvider contract)

- [ ] **Step 1: Read registry.ts fully**

Read: `src/providers/registry.ts` end-to-end.

- [ ] **Step 2: Update AIProvider interface in base.ts**

Add an optional `responseShape` tag and typed parse methods. The shape tag is informational; the real narrowing happens via type guards in parse methods.

```typescript
// In src/providers/base.ts
import type {
  OpenAIChatCompletion,
  OpenAIChatCompletionChunk,
} from './types/openai-responses';

export type ProviderFamily =
  | 'openai-compat'
  | 'anthropic'
  | 'gemini'
  | 'ollama';

export interface AIProvider {
  // existing fields...
  family: ProviderFamily;
  parseStream(response: StreamResponse, onChunk: StreamCallback, onUsage?: UsageCallback, onError?: ErrorCallback): Promise<void>;
  parseResponse(response: StreamResponse): Promise<AIResponse>;
}
```

- [ ] **Step 3: Walk through registry.ts and replace `any` with schema types**

For each OpenAI-compat provider (OpenRouter, Groq, Together, Fireworks, Mistral, DeepSeek, Cohere, Vercel, xAI, Perplexity, Novita, DeepInfra, Hyperbolic, Chutes, Replicate, Lepton, Lambda, HF, Azure, GitHub Models, Cerebras, SambaNova, Requesty, fal):

- In `parseResponse`: change `(await response.json()) as any` → typed narrowing:
  ```typescript
  const data: unknown = await response.json();
  if (!isOpenAIChatCompletion(data)) {
    throw new Error(`${this.name}: unexpected response shape`);
  }
  // Now `data.choices[0].message.content` is typed
  ```

- In `parseStream`: same pattern with `isOpenAIChunk` per SSE event

- Set `family: 'openai-compat'` in the provider definition

For Anthropic, Gemini, Ollama: same pattern with their respective guards.

- [ ] **Step 4: Remove the `as` type assertions flagged in registry.ts**

Lines 623, 634, 651 — these are flagged as "unnecessary assertion since it does not change the type". Either remove the `as` entirely or change the underlying type.

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: exit 0. If type errors, the type guards may be too strict — relax them or add more `has*Prop` checks.

- [ ] **Step 6: Run lint on registry.ts**

Run: `npx eslint src/providers/registry.ts --ext .ts`
Expected: zero `no-unsafe-*` warnings.

- [ ] **Step 7: Commit**

```bash
git add src/providers/registry.ts src/providers/base.ts
git commit -m "refactor(providers): wire typed schemas into registry; drop any"
```

- [ ] **Step 8: Jordan review gate**

Jordan reviews the registry diff (it will be large — 700+ LOC touched). Smoke-test: open Obsidian, send chat to 2-3 different providers (one OpenAI-compat, one Anthropic, one Ollama), confirm all three work. Proceed to Task 4 on approval.

---

## Phase 2 (cont.): Anthropic provider (Subagent 4)

### Task 4.1: Finish Anthropic typing

**Files:**
- Modify: `src/providers/anthropic.ts` (263 LOC)

- [ ] **Step 1: Read anthropic.ts**

Read full file. Identify remaining `any` sites beyond what 3.0.1 already fixed.

- [ ] **Step 2: Replace remaining `any` with AnthropicStreamEvent schema**

Import the schema:
```typescript
import {
  isAnthropicStreamEvent,
  isAnthropicMessage,
  type AnthropicStreamEvent,
  type AnthropicContentBlock,
} from './types/anthropic-responses';
```

Replace `parseStream`'s event-loop body:
```typescript
const data: unknown = JSON.parse(event.data);
if (!isAnthropicStreamEvent(data)) return;
// exhaustive switch on data.type — TS will tell us if we miss a case
switch (data.type) {
  case 'content_block_delta':
    if (data.delta.type === 'text_delta') onChunk(data.delta.text);
    break;
  case 'message_delta':
    if (data.usage) onUsage({ output_tokens: data.usage.output_tokens });
    break;
  // ... etc
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: exit 0

- [ ] **Step 4: Run lint**

Run: `npx eslint src/providers/anthropic.ts --ext .ts`
Expected: zero warnings

- [ ] **Step 5: Commit**

```bash
git add src/providers/anthropic.ts
git commit -m "refactor(anthropic): complete discriminated-union typing"
```

---

## Phase 3: Core module typing (Subagent 5)

### Task 5.1: Type-narrow tools.ts

**Files:**
- Modify: `src/core/tools.ts` (394 LOC — heaviest warning density)

- [ ] **Step 1: Read tools.ts**

Read full file. Identify the `any` patterns at lines 112, 113, 147, 149-155, 203-204, 319-321, 335-345, 361-363.

- [ ] **Step 2: Replace tool argument types**

Most `any` in tools.ts come from tool argument parsing — LLM-supplied JSON. Replace:
```typescript
// Before
async function runTool(args: any) {
  const path = args.path as string;
  // ...
}

// After
interface ReadToolArgs { path: string }
async function runTool(args: unknown) {
  if (!isRecord(args) || !hasStringProp(args, 'path')) {
    throw new Error('read tool: missing path');
  }
  const typed = args as ReadToolArgs;
  // ...
}
```

- [ ] **Step 3: Replace vault-search tool result types**

Lines 197, 311, 332 — `getMarkdownFiles()` results. Type the filter chains properly:
```typescript
const files: TFile[] = this.app.vault.getMarkdownFiles();
const filtered = files
  .filter((f) => !f.path.includes('node_modules'))
  .filter((f) => f.stat.size < 1_000_000)
  .map((f) => ({ path: f.path, name: f.basename }));
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: exit 0

- [ ] **Step 5: Run lint**

Run: `npx eslint src/core/tools.ts --ext .ts`
Expected: zero `no-unsafe-*` warnings on tools.ts

- [ ] **Step 6: Commit**

```bash
git add src/core/tools.ts
git commit -m "refactor(tools): type-narrow tool args + vault-search results"
```

### Task 5.2: Type-narrow secrets.ts

**Files:**
- Modify: `src/core/secrets.ts` (132 LOC)

- [ ] **Step 1: Read secrets.ts**

- [ ] **Step 2: Replace `any` in keychain storage calls**

Lines 59, 60, 69, 70, 75-78. The Electron keychain API returns `unknown`-ish results. Type-narrow:
```typescript
const result: unknown = await safeStorage.decryptString(buffer);
if (typeof result !== 'string') {
  throw new Error('keychain decryption returned non-string');
}
return result;
```

- [ ] **Step 3: Verify build + lint**

Run: `npm run build && npx eslint src/core/secrets.ts --ext .ts`
Expected: exit 0, zero warnings

- [ ] **Step 4: Commit**

```bash
git add src/core/secrets.ts
git commit -m "refactor(secrets): type-narrow keychain calls"
```

### Task 5.3: Type-narrow migration.ts

**Files:**
- Modify: `src/core/migration.ts` (148 LOC — partial fix from 3.0.1, finish it)

- [ ] **Step 1: Read migration.ts**

- [ ] **Step 2: Replace remaining `Record<string, any>`**

3.0.1 changed some to `Record<string, unknown>`. Find any remaining `any` (likely in helper functions).

- [ ] **Step 3: Verify build + lint**

Run: `npm run build && npx eslint src/core/migration.ts --ext .ts`
Expected: exit 0, zero warnings

- [ ] **Step 4: Commit**

```bash
git add src/core/migration.ts
git commit -m "refactor(migration): complete unknown-narrowing"
```

- [ ] **Step 5: Jordan review gate**

Jordan reviews Phase 3 diff. Smoke-test: chat with Ollama, use `/search` slash command, save a memory. Proceed to Phase 4 on approval.

---

## Phase 4: Memory + vault typing (Subagent 6)

### Task 6.1: Type-narrow memory.ts

**Files:**
- Modify: `src/memory/memory.ts` (274 LOC)

- [ ] **Step 1: Read memory.ts**

- [ ] **Step 2: Replace `any` in fact extraction (line 203)**

Memory parser extracts facts from LLM output. The LLM returns JSON like `{ facts: [...] }`. Type-narrow:
```typescript
const parsed: unknown = JSON.parse(llmOutput);
if (!isRecord(parsed) || !Array.isArray(parsed.facts)) {
  return [];
}
return parsed.facts.filter((f): f is string => typeof f === 'string');
```

- [ ] **Step 3: Verify build + lint**

Run: `npm run build && npx eslint src/memory/memory.ts --ext .ts`

- [ ] **Step 4: Commit**

```bash
git add src/memory/memory.ts
git commit -m "refactor(memory): type-narrow LLM fact extraction"
```

### Task 6.2: Type-narrow vault/notes.ts

**Files:**
- Modify: `src/vault/notes.ts` (237 LOC)

- [ ] **Step 1: Read notes.ts**

- [ ] **Step 2: Replace `any` on lines 148-153**

The file-creation + path-resolution logic uses `any` for the vault adapter response. Type-narrow with proper TFile/Stat types from `obsidian`.

- [ ] **Step 3: Verify build + lint**

Run: `npm run build && npx eslint src/vault/notes.ts --ext .ts`

- [ ] **Step 4: Commit**

```bash
git add src/vault/notes.ts
git commit -m "refactor(vault): type-narrow note creation + stat reads"
```

---

## Phase 5: Chat view + UI typing (Subagent 7)

### Task 7.1: Type-narrow chat view + message renderer

**Files:**
- Modify: `src/chat/view.ts` (large — multiple warning sites)
- Modify: `src/chat/message-actions.ts` (lines 59, 75)
- Modify: `src/chat/message-renderer.ts` (line 91)

- [ ] **Step 1: Read view.ts, message-actions.ts, message-renderer.ts**

- [ ] **Step 2: Fix floating promises**

The pattern is `someAsync().then(...)` returned from a function that should return void. Fix with explicit `void` operator:
```typescript
// Before (line 59 of message-actions.ts):
this.app.vault.create(path, content).then((f) => this.app.workspace.openLinkText(f.path, ''));

// After:
void this.app.vault.create(path, content).then((f) => this.app.workspace.openLinkText(f.path, ''));
```

Apply to all 9 flagged sites in message-actions.ts + view.ts + message-renderer.ts.

- [ ] **Step 3: Fix message-renderer.ts:91 floating promise**

```typescript
// Before:
renderMarkdown(content, containerEl);

// After (if renderMarkdown is async):
void renderMarkdown(content, containerEl);
```

- [ ] **Step 4: Fix view.ts:340 floating promise**

```typescript
void this.app.workspace.openLinkText(...);
```

- [ ] **Step 5: Verify build + lint**

Run: `npm run build && npx eslint src/chat/ --ext .ts`

- [ ] **Step 6: Commit**

```bash
git add src/chat/view.ts src/chat/message-actions.ts src/chat/message-renderer.ts
git commit -m "refactor(chat): void floating promises; type-narrow"
```

### Task 7.2: Type-narrow UI modals + commands

**Files:**
- Modify: `src/ui/modals/custom-provider-modal.ts`
- Modify: `src/ui/modals/folder-suggest-modal.ts`
- Modify: `src/ui/modals/image-suggest-modal.ts`
- Modify: `src/ui/modals/model-picker-modal.ts`
- Modify: `src/ui/modals/slash-help-modal.ts`
- Modify: `src/commands/context-menu.ts:48`

- [ ] **Step 1: Read each modal**

- [ ] **Step 2: Type-narrow `any` in picker result handling**

The picker modals filter files. Make the filter types explicit:
```typescript
// image-suggest-modal.ts before
return this.app.vault.getFiles().filter((f) => IMAGE_EXTS.has(f.extension.toLowerCase()));

// after — already typed since getFiles returns TFile[]; just confirm no `any`
```

If any `as any` exists in result handling, replace with proper types.

- [ ] **Step 3: Fix context-menu.ts:48 unsafe call**

Line 48 has an `any` typed value being called. Narrow:
```typescript
const handler = this.handlers[commandId];
if (typeof handler !== 'function') return;
handler(selection);
```

- [ ] **Step 4: Verify build + lint**

Run: `npm run build && npx eslint src/ui/ src/commands/ --ext .ts`

- [ ] **Step 5: Commit**

```bash
git add src/ui/modals/ src/commands/context-menu.ts
git commit -m "refactor(ui): type-narrow modals + context-menu handlers"
```

- [ ] **Step 6: Jordan review gate**

Jordan reviews Phase 5. Smoke-test: open chat, attach image, use slash command, right-click selection action. Proceed to Phase 6 on approval.

---

## Phase 6: Settings modernization (Subagent 8)

### Task 8.1: Migrate settings.ts to declarative getSettingDefinitions()

**Files:**
- Modify: `src/settings.ts` (733 LOC — biggest single change)

- [ ] **Step 1: Read settings.ts fully + Obsidian 1.13.0 docs**

Read: `src/settings.ts` end-to-end.

Obsidian 1.13.0 declarative settings API reference: https://docs.obsidian.md/Reference/Plugin+API/PluginSettingTab

- [ ] **Step 2: Convert display() to getSettingDefinitions()**

The current `display()` method builds settings imperatively with `createEl`, `Setting`, `setHeading`, etc. Convert to a declarative `getSettingDefinitions()` that returns a settings tree.

Pattern:
```typescript
// Before
display(): void {
  this.containerEl.empty();
  this.containerEl.createEl('h2', { text: 'Provider Configuration' });
  new Setting(this.containerEl)
    .setName('Default provider')
    .setDesc('Which AI provider to use')
    .addDropdown((dd) => {
      dd.addOptions(providers);
      dd.setValue(this.plugin.settings.defaultProvider);
      dd.onChange((v) => this.updateSetting('defaultProvider', v));
    });
}

// After — declarative
getSettingDefinitions(): SettingDefinition[] {
  return [
    {
      type: 'heading',
      label: 'Provider Configuration',
    },
    {
      type: 'dropdown',
      key: 'defaultProvider',
      label: 'Default provider',
      description: 'Which AI provider to use',
      options: providers,
      getValue: () => this.plugin.settings.defaultProvider,
      setValue: (v: string) => this.updateSetting('defaultProvider', v),
    },
    // ... etc
  ];
}
```

NOTE: The exact API shape depends on Obsidian 1.13.0's `SettingDefinition` type. Check the installed `obsidian` package typings:
```bash
grep -rn "getSettingDefinitions" node_modules/obsidian/index.d.ts
```

Use whatever shape the official typings require.

- [ ] **Step 3: Replace setWarning() with setDestructive()**

Lines flagged: 322, 608. Convert:
```typescript
// Before
new Setting(this.containerEl)
  .setName('Reset all settings')
  .addButton((btn) => btn.setWarning().setButtonText('Reset').onClick(() => ...))

// After
new Setting(this.containerEl)
  .setName('Reset all settings')
  .addButton((btn) => btn.setDestructive().setButtonText('Reset').onClick(() => ...))
```

For buttons that are both destructive + primary (e.g., confirm-deletion CTAs):
```typescript
btn.setDestructive().setCta()
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: exit 0. If type errors against `SettingDefinition`, consult Obsidian typings and adjust.

- [ ] **Step 5: Run lint**

Run: `npx eslint src/settings.ts --ext .ts`
Expected: zero warnings.

- [ ] **Step 6: Commit**

```bash
git add src/settings.ts
git commit -m "refactor(settings): migrate to declarative getSettingDefinitions; drop deprecated display/setWarning"
```

- [ ] **Step 7: Smoke test settings UI**

Open Obsidian → Settings → Curtis. Confirm:
- Every settings tab renders
- All dropdowns populate
- All buttons clickable
- Reset/destructive buttons show red styling
- Setting changes persist after reload

- [ ] **Step 8: Jordan review gate**

Jordan opens settings, screenshots before/after if available, compares layout. Proceed to Phase 7 on approval.

---

## Phase 7: Cleanup sweep (Subagent 9)

### Task 9.1: Final promise + assertion sweep

**Files:** all files

- [ ] **Step 1: Capture current warning set**

Run: `cd E:/dev/projects/obsidian-glm-plugin && npx eslint src --ext .ts 2>&1 | tee /tmp/phase7-lint.txt`

- [ ] **Step 2: Diff against baseline**

Run: `diff /tmp/baseline-lint.txt /tmp/phase7-lint.txt`

Address any remaining warnings. Types to expect:
- Stray `void` operator needed somewhere
- Unnecessary `as` assertion missed
- A `Promise<any>` that snuck through

- [ ] **Step 3: Fix each remaining warning**

For each warning, apply the relevant fix:
- `no-floating-promises` → add `void` prefix or `await`
- `no-unnecessary-type-assertion` → remove the `as`
- `no-unsafe-call/member/assignment/argument/return` → narrow with type guard

- [ ] **Step 4: Verify zero warnings**

Run: `npx eslint src --ext .ts`
Expected: zero output (clean exit)

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: exit 0

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: final lint sweep — zero warnings"
```

- [ ] **Step 7: Jordan acceptance gate**

Jordan opens Obsidian, loads rebuilt plugin, smoke-tests all major flows:
- Chat with 3 different providers
- Image attachment + send
- Slash command
- Memory write
- Settings panel every tab
- Selection action (right-click)

Proceed to Phase 8 on approval.

---

## Phase 8: Rebrand (Subagent 10)

### Task 10.1: Update manifest + package metadata

**Files:**
- Modify: `manifest.json`
- Modify: `package.json`

- [ ] **Step 1: Edit manifest.json**

```json
{
  "id": "curtis-ai-chat",
  "name": "Curtis AI Chat",
  "version": "4.0.0",
  "minAppVersion": "1.13.0",
  "description": "Polyglot AI chat with 30+ providers (Anthropic, OpenAI, Gemini, Ollama, and more), image attachments, long-term memory, slash commands, and inline selection actions.",
  ...
}
```

Description must NOT contain "Obsidian" or start with "Curtis AI Chat" — current description is fine (starts with "Polyglot").

- [ ] **Step 2: Edit package.json**

```json
{
  "name": "curtis-ai-chat",
  "version": "4.0.0",
  "description": "Curtis AI Chat — polyglot AI chat for Obsidian. 30+ providers, image attachments, memory, slash commands.",
  ...
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: exit 0

- [ ] **Step 4: Commit**

```bash
git add manifest.json package.json
git commit -m "feat: rebrand Curtis → Curtis AI Chat (id: curtis-ai-chat)"
```

### Task 10.2: Update README + docs + CHANGELOG

**Files:**
- Modify: `README.md`
- Modify: `docs/PROVIDERS.md`, `MEMORY.md`, `SLASH_COMMANDS.md`, `SELECTION_ACTIONS.md`, `IMAGES.md`
- Modify: `CHANGELOG.md`
- Modify: `CONTRIBUTING.md` (if it mentions brand)

- [ ] **Step 1: README brand sweep**

Find/replace all "Curtis" → "Curtis AI Chat" in:
- H1 / hero
- Intro paragraph
- Badges section (if any reference the old name)
- Install instructions
- Feature descriptions
- Funding section

Add a Privacy section after the Security section:
```markdown
## Privacy

Curtis AI Chat accesses your vault files only in these user-initiated cases:

1. **Agent vault-search tool** — when you explicitly invoke a tool like `/search` in chat, the plugin enumerates markdown files to search. The agent sees file paths and contents you ask it to read.
2. **Image picker** — when you click the paperclip to attach an image, the plugin lists image files in your vault.
3. **Folder picker** — when you configure auto-save or wallpaper folders, the plugin lists folders.

No file contents are sent to AI providers except:
- Message text you explicitly send in chat
- Image files you explicitly attach
- Note contents you explicitly reference via tools or slash commands

API keys are stored in your OS keychain (Windows Credential Manager / macOS Keychain / Linux Secret Service), never in the vault.
```

- [ ] **Step 2: Update docs/ files**

Each docs file mentions "Curtis" in its intro. Sweep:
```bash
grep -l "Curtis" docs/*.md
```
Update each to "Curtis AI Chat" where it refers to the plugin name (not, e.g., a code example).

- [ ] **Step 3: Fill CHANGELOG 4.0.0 section**

Replace the `[4.0.0] — Unreleased` placeholder from Task 1.1 with:
```markdown
## [4.0.0] — 2026-07-22

Major release. Rebrands the plugin from "Curtis" to "Curtis AI Chat" with a new plugin ID (`curtis-ai-chat`). **Existing installs will need to reinstall** — the plugin ID change is not auto-migratable.

### Added
- Full TypeScript schemas for every AI provider response shape (OpenAI-compat, Anthropic, Gemini, Ollama)
- Type-guard utilities for safe JSON boundary narrowing (`src/core/types/json-helpers.ts`)
- Shared SSE parsing utilities (`src/providers/types/sse.ts`)
- Privacy section in README documenting vault access

### Changed
- **Plugin ID**: `curtis` → `curtis-ai-chat` (breaking)
- **Plugin name**: "Curtis" → "Curtis AI Chat"
- **minAppVersion**: `1.11.4` → `1.13.0` (drops 1.11.4-1.12.x users)
- **Settings UI**: migrated from `display()` to declarative `getSettingDefinitions()` API
- **Destructive buttons**: migrated from `setWarning()` to `setDestructive()` / `setDestructive().setCta()`
- All HTTP-response parsing now goes through type guards; internal code never sees `any`

### Fixed
- All ~50 `no-unsafe-*` TypeScript-ESLint warnings resolved
- All `no-floating-promises` warnings resolved via explicit `void` operator or `await`
- Unnecessary type assertions removed throughout `providers/`, `settings.ts`

### Notes
- `fetch()` retained in `transport.ts` for mobile streaming — Obsidian's `requestUrl` does not support SSE streaming. Documented with eslint-disable + architectural rationale.
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: exit 0

- [ ] **Step 5: Commit**

```bash
git add README.md docs/ CHANGELOG.md CONTRIBUTING.md
git commit -m "docs: rebrand README + docs + CHANGELOG for v4.0.0"
```

### Task 10.3: Update settings UI heading strings

**Files:**
- Modify: `src/settings.ts` (any heading containing "Curtis")

- [ ] **Step 1: Find brand references in settings headings**

Run: `grep -n "Curtis" src/settings.ts`

Obsidian rule: settings headings can't contain the plugin name. So any heading like "Curtis Configuration" must change to "Configuration" or "AI Chat Configuration".

- [ ] **Step 2: Replace each occurrence**

- Section headings: "Curtis X" → "X" or "AI Chat X"
- In-paragraph references can stay ("Curtis AI Chat" is fine in body text, just not in `setHeading` text)

- [ ] **Step 3: Verify build + lint**

Run: `npm run build && npx eslint src/settings.ts --ext .ts`

- [ ] **Step 4: Commit**

```bash
git add src/settings.ts
git commit -m "refactor(settings): drop brand from headings per Obsidian rule"
```

### Task 10.4: Final pre-ship verification

- [ ] **Step 1: Full clean build**

```bash
cd E:/dev/projects/obsidian-glm-plugin
rm -rf node_modules main.js
npm install
npm run build
```
Expected: exit 0

- [ ] **Step 2: Final lint zero-warning check**

Run: `npx eslint src --ext .ts`
Expected: zero output

- [ ] **Step 3: Deploy to test vault**

Copy `main.js`, `manifest.json`, `styles.css` to `<vault>/.obsidian/plugins/curtis-ai-chat/`. Note the NEW folder name (`curtis-ai-chat` not `obsidian-glm-plugin` or `curtis`).

- [ ] **Step 4: Reload Obsidian + smoke test**

Open Obsidian, reload (Ctrl+R), confirm:
- Plugin appears as "Curtis AI Chat" in community plugins list
- Settings panel works
- Chat works (send to 3 providers)
- Memory works
- Image attach works
- Slash command works
- Selection action works

- [ ] **Step 5: Jordan final review**

Jordan signs off on the smoke test. Proceed to Phase 9 (ship).

---

## Phase 9: Ship (Subagent 11)

### Task 11.1: Rename GitHub repo

- [ ] **Step 1: Rename via gh**

Run: `gh repo rename curtis-ai-chat --repo JordanNewell/curtis-chat`
Expected: `✓ Renamed JordanNewell/curtis-chat to JordanNewell/curtis-ai-chat`

GitHub sets up automatic redirect from old URL.

- [ ] **Step 2: Update git remote**

Run: `cd E:/dev/projects/obsidian-glm-plugin && git remote set-url origin https://github.com/JordanNewell/curtis-ai-chat.git`

- [ ] **Step 3: Update package.json repository field**

If `package.json` has a `repository` field, update URL to new repo path.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: update repo URL after rename"
```

### Task 11.2: Rename local folder

- [ ] **Step 1: Close all sessions pointing at the old folder**

Jordan closes:
- This Claude Code session's working directory access to `E:/dev/projects/obsidian-glm-plugin/`
- Any VS Code / Obsidian editor windows
- Any terminals cd'd into the folder
- Any node/esbuild processes (check Task Manager)

- [ ] **Step 2: Kill any lingering processes**

Run (PowerShell as admin if needed):
```powershell
Get-Process | Where-Object { $_.Path -like "*obsidian-glm-plugin*" } | Stop-Process -Force
```

- [ ] **Step 3: Rename the folder**

Run: `mv E:/dev/projects/obsidian-glm-plugin E:/dev/projects/curtis-ai-chat`

- [ ] **Step 4: Update Claude Code session working directory**

Restart Claude Code in the new path:
```bash
cd E:/dev/projects/curtis-ai-chat
```

- [ ] **Step 5: Verify git remote still works**

Run: `cd E:/dev/projects/curtis-ai-chat && git remote -v && git fetch`
Expected: remote URL is the new repo, fetch succeeds.

### Task 11.3: Tag + release v4.0.0

- [ ] **Step 1: Push any unpushed commits**

Run: `cd E:/dev/projects/curtis-ai-chat && git push origin master`

- [ ] **Step 2: Create the tag**

IMPORTANT: Obsidian requires tag name to match manifest version exactly. No `v` prefix.

```bash
git tag -a 4.0.0 -m "Release 4.0.0 — Curtis AI Chat rebrand + type safety"
git push origin 4.0.0
```

- [ ] **Step 3: Create GitHub release**

The `release.yml` workflow triggers on release-published. So create a release:

```bash
gh release create 4.0.0 \
  --repo JordanNewell/curtis-ai-chat \
  --title "Curtis AI Chat 4.0.0" \
  --notes "See CHANGELOG.md for full details." \
  --target master
```

Wait for `release.yml` to run. It builds main.js + manifest.json + styles.css + generates artifact attestations.

- [ ] **Step 4: Verify release assets + attestations**

Run: `gh release view 4.0.0 --repo JordanNewell/curtis-ai-chat`
Expected output includes:
- 3 assets: `main.js`, `manifest.json`, `styles.css`
- Attestation badges on each asset

If assets missing, upload manually:
```bash
gh release upload 4.0.0 main.js manifest.json styles.css --clobber
```

### Task 11.4: Update community.obsidian.md submission

- [ ] **Step 1: Update submission**

Jordan logs into `community.obsidian.md`, opens his plugin submission, updates:
- Repo URL → `https://github.com/JordanNewell/curtis-ai-chat`
- Latest version → `4.0.0`
- Description if needed (current should still pass)

- [ ] **Step 2: Resubmit for review**

Submit update. Obsidian team will review and update the directory listing.

### Task 11.5: Update deployment vaults

- [ ] **Step 1: Update Obsidian vault plugins folder**

For each Obsidian vault using the plugin:
- Delete `<vault>/.obsidian/plugins/curtis/` (old ID)
- Install fresh as `<vault>/.obsidian/plugins/curtis-ai-chat/`

The old install won't auto-update because the plugin ID changed.

### Task 11.6: Post-ship memory + COLLAB update

- [ ] **Step 1: Save project memory**

Write `C:/Users/jrnew/.claude/projects/C--Users-jrnew/memory/project_curtis-ai-chat-v4-0-0-ship-2026-07-22.md` with:
- What shipped
- Key decisions
- Gotchas hit during execution
- Carry-forwards

- [ ] **Step 2: Update MEMORY.md index**

Add one-line pointer under Quick Links.

- [ ] **Step 3: Update COLLAB.md**

Add Session 2026-07-22 entry to COLLAB.md with summary.

---

## Self-review notes

**Spec coverage:**
- ✅ Rebrand Curtis → Curtis AI Chat — Phase 8
- ✅ Plugin ID change — Task 10.1
- ✅ minAppVersion 1.13.0 — Task 1.1
- ✅ Version 4.0.0 — Task 1.1
- ✅ Full per-provider schemas — Tasks 3.1-3.3
- ✅ getSettingDefinitions() migration — Task 8.1
- ✅ setDestructive() migration — Task 8.1 step 3
- ✅ Floating promise cleanup — Tasks 2.2, 5.1, 7.1, 9.1
- ✅ Unnecessary assertion removal — Tasks 2.3, 9.1
- ✅ fetch() justification — Task 2.3 step 3
- ✅ README privacy section — Task 10.2 step 1
- ✅ Repo rename — Task 11.1
- ✅ Folder rename — Task 11.2
- ✅ community.obsidian.md update — Task 11.4

**Type consistency:**
- `isRecord` / `hasStringProp` / `hasArrayProp` / `hasNumberProp` / `asString` / `asNumber` / `asStringArray` / `requireRecord` — defined once in `json-helpers.ts`, used consistently across Phase 2-7
- `OpenAIChatCompletion` / `OpenAIChatCompletionChunk` — defined in `openai-responses.ts`, used in `registry.ts` via type guards
- `AnthropicStreamEvent` — defined as discriminated union in `anthropic-responses.ts`, exhaustive switch in `anthropic.ts`
- `ProviderFamily` — `'openai-compat' | 'anthropic' | 'gemini' | 'ollama'`, used in `base.ts`

**Placeholder scan:** Clean. No TBD / TODO / "fill in later".

**Known unknowns (will need executor attention):**
- Exact `SettingDefinition` shape from Obsidian 1.13.0 typings — executor must check `node_modules/obsidian/index.d.ts` and follow what's there
- Specific lines in `tools.ts` / `registry.ts` may have shifted during earlier task execution — executor re-greps for warning sites before each fix
- Pre-existing test fixtures / examples in docs/ may contain "Curtis" in code examples — sweep in Task 10.2
