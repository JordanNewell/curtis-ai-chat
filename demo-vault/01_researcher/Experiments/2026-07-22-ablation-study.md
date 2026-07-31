---
title: "Step granularity ablation"
date: 2026-07-22
status: in-progress
tags: [experiment, ablation, reasoning, cot]
models: ["claude-opus-4.7"]
---

# 2026-07-22 — Step granularity ablation

## Hypothesis

Detailed reasoning steps (verbose, ~50 words each) hurt frontier model accuracy on hard problems. Short, terse steps (~10 words each) force the model to internalize computation rather than narrate it.

## Setup

- **Model:** Claude Opus 4.7 (single model — testing prompt structure, not model comparison).
- **Benchmark:** MATH dataset (12,500 competition problems), 500-problem random subset.
- **Conditions:**
  - A: Verbose CoT — "explain each step in 1-2 sentences"
  - B: Terse CoT — "state each step in ≤10 words"
  - C: Hybrid — terse for arithmetic, verbose for conceptual
  - D: Adaptive — model chooses per step
- **N:** 500 problems × 4 conditions = 2,000 evaluations.
- **Decoding:** greedy (temperature 0).

## Preliminary results (first 100 problems)

| Condition | Accuracy | Avg tokens/problem |
|---|---|---|
| A: Verbose | 41.0 | 820 |
| B: Terse | 47.0 | 240 |
| C: Hybrid | 48.0 | 380 |
| D: Adaptive | 49.0 | 410 |

## Early read

**Terse > Verbose by 6 points on accuracy and uses 3.4× fewer tokens.** If this holds across the full 500, it's a strong result.

The hybrid (C) is marginally better than pure terse but costs 58% more tokens. Diminishing returns.

Adaptive (D) is the most promising — better than hybrid at lower cost. Worth a follow-up.

## What I want to investigate next

1. **Per-category breakdown.** Does terse win across algebra/geometry/number-theory, or only some?
2. **Error mode analysis.** When terse fails, is it arithmetic or reasoning? Conjecture: arithmetic (forced to compute in-head).
3. **Cross-model generalization.** Run the same conditions on GPT-4.6 and Gemini 3 Pro. If terse wins everywhere, the effect is about prompting, not model.

## Blockers

- Cost: 2,000 evaluations at $0.015/1K tokens (input+output) ≈ $400. Have budget.
- Time: Claude Opus 4.7 is rate-limited at my tier (~50 req/min). Full run takes ~40 minutes.

## Related

- Builds on [[2026-07-15-reasoning-benchmark]]
- Background: [[chain-of-thought-prompting]]
