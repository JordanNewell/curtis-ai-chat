# Intent-Based Model Router — Build Plan

> Task fleet-cabinet #713 / BIG LOOP #708. Status: plan ( scoped 2026-10-10 ).
> Owner: Lucy (architecture). Implementation to be delegated to Angela (frontend wiring) + Cameron (classifier/telemetry core).

## 0. Problem & premise check

**Goal:** the user never picks a model manually. Every send is classified by intent and routed to the cheapest model that wins that intent class, with a fallback chain.

**Premise gap found while scoping:** the arena today **does not persist any data**. The promote-to-chat click is the only verdict signal and it is discarded (`promoteArenaColumn` in `src/chat/view.ts` just deletes the loser). The ARENA.md roadmap confirms "Save arena results" is unbuilt. So there is no ground-truth dataset to train rules on yet. **Phase 0 (data capture) is a hard prerequisite**, not an optional extra.

## 1. Architecture overview

Three layers, shipped in order:

```
[send] → [Intent Classifier] → [Route Table] → [provider/model]
                 ↓ (async)                          ↓
            [Arena Verdict Log]  ←──────────  [Telemetry: tokens, latency, cost]
                                          ↓
                                   [Fallback chain on failure/low-quality]
```

New module: `src/router/` — `classify.ts`, `route-table.ts`, `verdicts.ts`, `router.ts`. Keeps the router out of `view.ts` except for one call site.

## 2. Phase 0 — Arena verdict telemetry (prereq, ~1 IC-day)

- Log every arena round to `<vault>/.curtis/router/verdicts.jsonl`:
  `{ts, prompt (first 2KB), models: [{providerId, modelId, msFirstToken, msTotal, tokensIn, tokensOut, cost}], winner, verdictSource}`
- `verdictSource`: `promote` (user clicked promote — strong signal), `abandoned` (no promote — weak/negative).
- Cost from the existing `getModelPricing()` on the provider interface (already implemented).
- Add a Settings toggle "Record arena results" (default on, plain-language note about local-only storage).
- Export command: "Export router dataset" → copies the JSONL to a vault note for inspection.

Without this phase the router is just vibes. Ship it first, alone.

## 3. Phase 1 — Intent classifier (`src/router/classify.ts`)

Two-stage, cheap-first:

1. **Heuristic pass (free, local, ~µs).** Regex/keyword rules into the taxonomy below. Covers the 70% case: code blocks/``` or "refactor|write a function" → `code`; "summarize|tldr|bullet" → `summarize`; image attachment → `vision`; long system prompt + tools → `agent`; "why|prove|step by step|strategy" + >N chars → `reasoning`.
2. **Tiny-model pass (fallback for ambiguous).** If heuristics score below threshold, send the first 1KB to the user's cheapest configured local model (Ollama default) with a fixed 5-way classification prompt, 128 max tokens. Cost ≈ free. If no local model configured, fall back to `general` tier.

**Intent taxonomy (v1, keep it to 6):**

| Intent | Examples | Default tier |
|---|---|---|
| `code` | write/refactor/explain code | strong coder |
| `reasoning` | analysis, math, planning, tradeoffs | frontier reasoner |
| `summarize` | tldr, digest, extract | cheap/local |
| `vision` | image input | any vision model |
| `agent` | tool-calling threads | tool-capable |
| `general` | everything else | mid-tier |

Resist a bigger taxonomy until verdict data justifies splits.

## 4. Phase 2 — Route table & mapping (`src/router/route-table.ts`)

- Settings section "Router": per-intent dropdown of `(provider, model)` picked from enabled providers, with a **tier default** (cheap / mid / premium) so it works before the user configures anything.
- Sensible out-of-box mapping derived from what's enabled: DeepSeek → `code`, Claude/GPT-class → `reasoning`, local Ollama → `summarize`, `general` → cheapest cloud with tools.
- Capability guard: never route `vision` to a non-vision model, `agent` to a non-tool model — reuse the capability pills' data source.
- Persisted in plugin settings; a "Learn from arena" button (Phase 3) rewrites it.

## 5. Phase 3 — The router itself (`src/router/router.ts`)

- New entry in the model dropdown: **"Auto (router)"**. When active, the send path calls `route(prompt, attachments)` instead of the fixed model. One insertion point in `view.ts`'s send flow; arena mode bypasses the router entirely.
- Visual affordance: a small badge on the sent message showing `intent → model` so routing is observable, not magic. Clickable → "route via X always" shortcut.
- **Fallback chain** per intent: `[preferred, mid, cheap]`. Triggers:
  - provider error / 429 / timeout → next in chain, transparently;
  - *quality* fallback is **manual-only in v1** (a "not good? try stronger model" affordance on the reply) — auto-retry on quality doubles cost silently and we don't yet have the data to trust it. Revisit after ≥200 verdicts.
- Cold-start: with <50 verdicts for an intent class, router uses tier defaults and quietly logs what happened.

## 6. Phase 4 — Learning loop & measurement

- `learn(arena verdicts)`: winner-frequency per intent class updates the route table (with a confidence floor; needs ≥5 verdicts per class before it overrides a default).
- **Cost-saving metric**, surfaced in Settings → Router: "Routed sends: N. Estimated cost $X vs always-premium $Y (saved $Z / %)." Computed from logged tokens × pricing at send time. Also log the counterfactual (what the premium model would have cost) on every routed send.
- Success criterion for the feature overall: ≥60% of sends routed to non-premium models with no measurable rise in manual model overrides.

## 7. Sequencing & delegation

| Phase | Who | Est. | Ship gate |
|---|---|---|---|
| 0 telemetry | Cameron | 1d | verdicts.jsonl populated by real arena use |
| 1 classifier | Cameron | 2d | ≥85% intent accuracy on hand-labeled set of 50 prompts |
| 2 route table | Angela | 1d | Settings UI + capability guards |
| 3 router + fallback | Angela | 2d | Auto mode end-to-end, badge, error fallback |
| 4 learning + metrics | Cameron | 2d | learn button, savings readout |

Phases 0–1 and 2 are parallelizable after 0's schema lands. Branch naming: `feat/router-<phase>`. Each phase independently releasable.

## 8. Risks

- **Misrouting is user-visible.** Mitigation: the intent badge + one-click override; router is opt-in (Auto entry), never replaces explicit model choice.
- **Privacy.** Verdict log stores prompts locally only; never leaves the vault. Documented in settings copy.
- **Dataset sparsity.** v1 routes are curated defaults; learning only kicks in with enough verdicts. No fake precision.
