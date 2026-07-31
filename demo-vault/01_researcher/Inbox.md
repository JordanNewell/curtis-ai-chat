---
tags: [inbox, research]
---

# Inbox

Stuff to triage. Items move to `Literature/` (after reading), `Experiments/` (after running), or get archived.

## To read

- [ ] "Self-Consistency Improves Chain of Thought Reasoning" — Wang et al. 2022. Already mostly absorbed via [[chain-of-thought-prompting]] notes; formalize.
- [ ] "Tree of Thoughts" — Yao et al. 2023. Curious if the tree-search framing actually beats majority vote, or if it's a re-skin.
- [ ] "Quiet-STaR" — Zelikman et al. 2024. Reasoning during pretraining, not just at inference. Big if true.
- [ ] The recent DeepMind paper on process reward models — does PRM > ORM at frontier scale?

## To run

- [ ] **React vs. CoT comparison on code generation.** Hypothesis: React wins when search is needed, CoT wins when it isn't. Test on HumanEval+.
- [ ] **Replicate the "self-correction doesn't work" result** (Huang et al. 2023). Newer models might have moved the needle.

## Ideas (rough)

- **Reasoning trace compression.** Distill a verbose CoT trace into a terse one post-hoc, train on the terse version. Can we get terse performance with verbose training signal?
- **Tool-augmented CoT.** Replace the "compute in head" step with a calculator tool call. Does this close the arithmetic error gap from [[2026-07-22-ablation-study]]?
- **Calibration audit.** When models say "I'm 90% sure" in CoT, are they actually 90% right? Worth a small study.

## Conversations to schedule

- [ ] ask Prof. Khanna about the MATH subset selection methodology — heard she has a cleaned version
- [ ] ping the TEAL reading group about Tree of Thoughts — has anyone read it carefully?
