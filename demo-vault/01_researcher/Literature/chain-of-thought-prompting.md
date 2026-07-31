---
title: "Chain-of-Thought Prompting Elicits Reasoning in Large Language Models"
authors: ["Wei et al."]
venue: NeurIPS 2022
year: 2022
tags: [paper, reasoning, prompting, foundational]
read: 2026-07-14
rating: 5/5
---

# Chain-of-Thought Prompting

> Wei, J., et al. (2022). *Chain-of-Thought Prompting Elicits Reasoning in Large Language Models.* NeurIPS.

## TL;DR

Showing the model a few exemplars with **step-by-step reasoning** before the answer ("Let's think step by step") dramatically improves performance on arithmetic, commonsense, and symbolic reasoning tasks — but only in models ≥60B parameters.

## Key findings

| Model size | GSM8K accuracy (standard prompting) | GSM8K accuracy (CoT) |
|---|---|---|
| 8B | 17.7 | 17.7 |
| 62B | 21.5 | 45.1 |
| 540B | 56.9 | 74.4 |

The "emergent ability" framing — CoT works above a scale threshold but not below — kicked off a debate that's still ongoing.

## My critique

The paper frames CoT as emergent, but the threshold correlates with the model's ability to **hold intermediate state in context**. Below 60B, the working memory is too noisy to preserve a multi-step derivation. That's not emergence — it's a capacity constraint.

Evidence: if you give a small model an external scratchpad (Chain-of-Thought with explicit `tools`), it recovers most of the gap. The reasoning isn't absent, it's bottlenecked by representational precision.

## Open questions I'm working on

1. **When does CoT hurt?** Observed cases: rhetorical questions, creative writing, anything where explicit reasoning makes output feel mechanical. Want to characterize this.
2. **Step granularity.** Long, detailed steps vs. short, terse ones — which is better? Hypothesis: depends on model scale (small models need more granular).
3. **Self-consistency.** Sample N CoT paths, majority vote — known to help. Why? Is it calibration or coverage?

## Experiments

- [[2026-07-15-reasoning-benchmark]] — initial benchmark replication
- [[2026-07-22-ablation-study]] — step granularity ablation

## Related

- [[attention-is-all-you-need]] — the substrate that makes CoT possible
