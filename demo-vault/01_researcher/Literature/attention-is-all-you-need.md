---
title: "Attention Is All You Need"
authors: ["Vaswani et al."]
venue: NeurIPS 2017
year: 2017
tags: [paper, transformers, attention, foundational]
read: 2026-07-12
rating: 5/5
---

# Attention Is All You Need

> Vaswani, A., et al. (2017). *Attention Is All You Need.* NeurIPS.

## TL;DR

Introduced the **Transformer** architecture — fully attention-based, no recurrence or convolution. Set SOTA on translation tasks while training significantly faster than RNN/LSTM approaches.

## Key contributions

1. **Scaled dot-product attention** — `softmax(QK^T / sqrt(d_k)) V`. The `1/sqrt(d_k)` factor prevents softmax from saturating in high dimensions.
2. **Multi-head attention** — attend to different representation subspaces in parallel. `head_i = Attention(QW_i^Q, KW_i^K, VW_i^V)`.
3. **Positional encoding** — sinusoidal, allows the model to attend by relative position without recurrence.
4. **Encoder-decoder structure** — N=6 stacked layers, each with self-attention + feed-forward.

## What holds up in 2026

The core attention mechanism is unchanged in modern LLMs (GPT, Claude, Gemini all use variants). What changed:
- Decoder-only became dominant (encoder-decoder is now niche outside translation)
- Multi-head → multi-query → grouped-query attention for inference efficiency
- Learned positional embeddings replaced sinusoidal
- Scale: 64M → 1T+ params

## Limitations the authors acknowledge

- Quadratic attention cost in sequence length (`O(n^2)`). Section 4 explicitly notes this as future work.
- Limited interpretability of attention heads (Section 5.4 shows some head specialization but it's anecdotal).

## My take

The `1/sqrt(d_k)` detail is the most underappreciated. Without it, attention scores explode in high dimensions and gradients vanish. Most papers that "improve" attention skip this and report inconsistent results — usually because they forgot the scaling.

## Related

- [[chain-of-thought-prompting]] — builds on transformers for reasoning
- [[retrieval-augmented-generation]] — addresses the quadratic cost problem
