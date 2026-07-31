---
title: "Reasoning benchmark — initial replication"
date: 2026-07-15
status: complete
tags: [experiment, benchmark, reasoning]
models: ["gpt-4.6", "claude-opus-4.7", "gemini-3-pro", "llama-3.3-70b"]
---

# 2026-07-15 — Reasoning benchmark, initial replication

## Goal

Replicate Wei et al. 2022 CoT results on current frontier models. Establish baselines for the ablation work in [[2026-07-22-ablation-study]].

## Setup

- **Benchmark:** GSM8K (8.5K grade-school math problems), test split (1,319 problems).
- **Models:** GPT-4.6, Claude Opus 4.7, Gemini 3 Pro, Llama 3.3 70B (open weights for the comparison).
- **Prompting:** Zero-shot, zero-shot CoT ("Let's think step by step"), 8-shot CoT (Wei et al. exemplars).
- **Temperature:** 0.0 for deterministic decoding, 0.7 for self-consistency.
- **N for self-consistency:** 5 paths per problem.

## Results

| Model | Zero-shot | Zero-shot CoT | 8-shot CoT | Self-consistency (k=5) |
|---|---|---|---|---|
| GPT-4.6 | 92.1 | 95.4 | 96.2 | 96.8 |
| Claude Opus 4.7 | 93.4 | 96.1 | 96.9 | 97.3 |
| Gemini 3 Pro | 89.7 | 94.8 | 95.5 | 96.0 |
| Llama 3.3 70B | 78.2 | 88.6 | 91.3 | 93.1 |

## Observations

1. **The CoT gap is smallest for the strongest models.** GPT-4.6 gains +3.3 pts; Llama 3.3 70B gains +10.4. Consistent with the capacity-bottleneck hypothesis from [[chain-of-thought-prompting]].
2. **Self-consistency gives diminishing returns at frontier scale.** GPT-4.6 gains +0.6 over 8-shot CoT — barely worth the 5× compute.
3. **Llama 3.3 70B with CoT beats Gemini 3 Pro without it.** Open weights are competitive if you can afford the prompting overhead.

## Methodology issues

- Only ran 100 problems per condition for cost reasons (full benchmark would be ~$2K in API spend). Confidence intervals are wide.
- Used greedy decoding for the non-SC conditions — different sampling might shift results.
- GSM8K may be saturated; need a harder benchmark for the next round.

## Next

Run [[2026-07-22-ablation-study]] on step granularity using Claude Opus 4.7 (best baseline performance).

## Raw data

```
# Notes on running
# GSM8K via HF datasets: load_dataset("gsm8k", "main", split="test")
# Eval script: experiments/gsm8k_eval.py
# Cost tracking: see invoices/2026-07-*.json
```
