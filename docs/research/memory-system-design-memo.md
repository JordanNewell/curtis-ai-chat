# Memory System Design Memo

Status: v0 draft · October 2026 · Curtis AI

## Abstract

Curtis AI Chat ships a long-term memory layer built on a deliberately small bet: facts live in one human-editable markdown file inside the user's vault, recall is full injection into every system prompt, and the only intelligence sits at capture time — a background LLM pass over each completed chat turn. There is no retrieval, no ranking, no consolidation, and no forgetting except by hand. This memo describes what actually ships in v1.2.0 (with file references), the tradeoffs that design accepts, and what we intend to measure before changing it. It is written against the code, not the roadmap: RAG settings and embedding types exist in the codebase, but `src/rag/` is empty and nothing implements them.

## Problem

A chat agent embedded in someone's vault is long-running but stateless per conversation. For Curtis, memory has to solve five things at once:

1. **Persistence across conversations** without a hidden database — the data lives in the user's vault, not in an opaque `data.json` blob.
2. **Capture without nagging** — the user should not have to curate by hand, but also should not have facts silently invented.
3. **Recall that personalizes answers** without consuming the context window or resurrecting stale facts.
4. **User control** — the user must be able to see, edit, and delete what the assistant "knows," with the same editor they use for everything else.
5. **A scale bound** — this is a single-user plugin. The design assumes fact counts in the tens to low hundreds, not millions of rows.

The current design answers those with one markdown file and a strict capture prompt. Everything else — selection, decay, consolidation — is deferred on purpose.

## Current design

**Storage.** `MemoryStore` in `src/memory/memory.ts` (311 lines, the entire memory system). Facts live in a single markdown file, default `AI/Curtis Memory.md`, path configurable via `memoryFilePath` in settings. One bullet per fact:

```
- Prefers terse commit messages [preference] <!-- id:2f0a... updated:1759460000000 -->
```

Five valid categories — `preference`, `identity`, `project`, `instruction`, `other` — validated during parse so arbitrary bracketed text (wikilinks, say) is not misread as a category. The file is auto-created with a header that explains the contract: "Delete a line to forget; edit a line to correct." (The shipped default is visible at `demo-vault/AI/Curtis Memory.md`.) An in-memory cache is rebuilt on Obsidian `modify` events for that path, so hand edits reach the next prompt; a `writing` flag suppresses the modify event the store itself triggers. File creation checks the filesystem adapter rather than the vault index, because a cold-boot index lag once made `vault.create()` throw and killed the entire plugin `onload` (fixed; see CHANGELOG).

**Data model.** `MemoryFact` in `src/types.ts` (line 326): `id`, `content`, `category?`, `timestamp`, `accessCount`, `lastAccessed`. The last two are dead: `accessCount` is always 0 and `lastAccessed` only mirrors `timestamp`. They anticipate a usage-based ranking that was never built.

**Capture.** Three paths, all funneling into `addFact` (exact, case-insensitive content dedupe; a match refreshes the timestamp but keeps the old wording — there is no semantic dedupe):

1. **Auto-extraction.** After each completed generation — normal sends (`sendMessage`, `src/chat/view.ts` line ~1694) and regenerations/edit-resends (`streamAssistantResponse`, line ~2061) — `maybeExtractFacts` hands the last user/assistant pair to `extractAndStoreFacts` in `src/main.ts` (line 612). That makes a background call on the **active provider and model** (no dedicated cheap extractor) with a strict prompt: 0–3 durable facts as a JSON array with a category each, "durable = true across future conversations," nothing ephemeral. User and assistant text are each truncated to 2,000 characters. Parsing is tolerant (`extractJsonArray`, handles code fences); failures log to `console.debug` and never surface. Defaults are `enableMemory: true` and `memoryCaptureMode: 'auto'` (`src/settings.ts` lines 57–58), so auto-capture is on out of the box.
2. **`/remember <fact>`** slash command (`src/chat/slash-commands.ts`).
3. **"Save to memory"** in the editor context menu — stores the selection verbatim, no model call, gated on `enableMemory` (`src/commands/context-menu.ts`).

**Recall.** Full injection. `formatFactsForPrompt()` renders every fact as a `## What you know about the user` bullet block, and `buildMessagesArray` (`src/chat/view.ts` lines 1736–1748) appends it to the system prompt on every request when `enableMemory` is on. No selection, no scoring, no cap, no token budget. The design comment at the top of `src/memory/memory.ts` states the load-bearing assumption outright: capture is signal-gated, so the fact set stays small enough that retrieval would be wasted work. That assumption has never been measured.

**User controls.** Settings → Memory (`src/settings.ts` lines 800–914): enable toggle, capture-mode dropdown (off/auto), file path with browse/open/clear, and a per-fact list with Edit (content + category, via `src/ui/modals/edit-fact-modal.ts`) and Delete. Slash commands: `/memory` (summary of the last 8 facts, `open`, `clear`), `/forget <substring>` (deletes the first substring match). Hand-editing the file is a first-class path, not a workaround.

**Provenance.** The file header says the design is lifted from obsidian-copilot's user-memory layer (reference checkout in `_research/copilot/`).

**Not in the build.** Two things the codebase implies but does not deliver:

- `src/rag/` is empty. `enableRag`, `ragChunkSize`, `ragTopK`, embedding provider/model settings (`src/types.ts` lines 269–274; defaults at `src/settings.ts` lines 65–70) and the `EmbeddingChunk`/`RetrievalResult` types exist, but no embeddings call, vector store, or chunk retrieval ships. RAG is a settings shell, default off.
- `memory:fact:stored` and `memory:fact:recalled` are declared in the EventBus type map (`src/core/events.ts` lines 51–52) and never emitted. Nothing in `src/` listens to `provider:response` either. There is currently **zero telemetry on memory behavior** — not even fact counts over time.

## Tradeoffs

What the design buys:

- **Total inspectability.** Storage is a plain note in the vault: readable, greppable, synced by whatever syncs the vault, editable in the user's editor. "Delete a line to forget" is the literal deletion story, and it works.
- **Zero retrieval infrastructure.** No embedding dependency (works fully offline with a local provider), no index to invalidate, no schema migration. Recall is O(n) string concatenation and deterministic — the model sees the same facts every time, which makes behavior reproducible and debuggable.
- **A small correctness surface.** One 311-line file; the parse/serialize round-trip is the only invariant to maintain.

What it costs — all visible in the code:

- **Unbounded prompt growth.** Every fact is injected into every request until manually deleted. Nothing caps fact count or the memory block's share of the prompt.
- **Duplicates and contradictions accumulate.** Dedupe is exact-match, and the extractor sees only one turn (2,000 chars per side), so it cannot know the existing fact set, merge paraphrases, or retire facts that stopped being true. The site copy frames this research arm as "extract, consolidate, and deliberately forget" — only extraction ships; consolidation and deliberate forgetting are open problems, and we should say so.
- **Silent per-turn overhead.** Auto mode adds a second API call per turn on the active model — possibly an expensive one — with no review gate before a fact lands in the file, and no notification that capture happened. The token usage flows through the same `callAI` path as normal turns, but since nothing consumes the events, the user cannot see this cost anywhere.
- **Dead schema.** `accessCount`/`lastAccessed` are written but never read — a ranking layer that was sketched, not built.
- **Small inconsistencies.** The core system prompt hardcodes `AI/Curtis Memory.md` (`src/core/system-prompt.ts` line 20) even when the user changes the path in settings. `/remember` and `addFact` work with `enableMemory` off (facts are stored but never injected); only the context menu respects the flag. The parser is line-oriented: paste a nested list into the file and every line becomes a fact, and a fact whose text happens to end in a bracketed valid-category word (e.g. "...the [project] folder") gets silently reclassified on the next hand-edit reload.

None of these are fatal at the assumed scale. All of them get worse with time, which is the property the measurements below target.

## Open questions

1. **Growth.** Does the signal-gated-capture assumption hold? What fact count does a real single-user vault reach in 30 days of daily use, and at what point does full injection cost more than it returns?
2. **Capture quality.** What fraction of auto-extracted facts would the user themselves keep? Nothing today measures extractor precision, and the failure mode is quiet clutter.
3. **Duplication rate.** How fast do near-duplicates and stale facts accumulate under exact-match dedupe plus single-turn extraction?
4. **Consolidation within the constraint.** Can a periodic compaction pass rewrite the memory file (merging paraphrases, retiring contradicted facts) with a user-visible diff, without introducing hidden state outside the vault?
5. **Selection vs. cap.** If fact sets do grow, is per-prompt selection (recency/category) ever worth its complexity, or is a hard cap plus compaction strictly better?
6. **Extraction cost.** Is reusing the active model acceptable, or does a dedicated cheaper extractor pay for its configuration surface?

## What we're measuring next

Concrete, falsifiable, in order:

1. **Instrument first.** Fire the already-declared `memory:fact:stored`/`memory:fact:recalled` events (`src/core/events.ts` lines 51–52) and log fact count plus the memory block's share of prompt tokens per conversation. Falsifiable claim: a single-user vault stabilizes under 50 facts in 30 days of daily use. If false, full injection has a clock on it.
2. **Label extractor output.** Hand-label at least 200 auto-captured facts from real usage as keep/discard. Hypothesis: keeper rate ≥ 0.8, near-duplicate rate < 10% within the first 7 days.
3. **Price the background call.** Measure tokens and cost of `extractAndStoreFacts` per turn across three provider tiers. Hypothesis: under 5% of per-turn spend at current prompt sizes.
4. **Injection dose-response.** Run a fixed personalized-task battery with the memory block artificially loaded to 0 / 25 / 100 facts. Hypothesis: no measurable answer-quality regression at 100 facts with current models. If false, cap + compaction moves up the queue.
