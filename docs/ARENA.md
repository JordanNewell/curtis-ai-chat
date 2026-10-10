# Multi-model arena

> Send one prompt to 2–4 models in parallel. Pick a winner.

The arena lets you compare model responses side-by-side, live, as they stream. Useful for picking the right model for a task, tuning prompts, or just exploring cost/quality tradeoffs.

## What it is

Click the **wand icon** in the chat header to open the arena picker. Select 2–4 models from any providers you have configured. Your next prompt streams to all of them in parallel, each in its own column.

Arena sends are context-parity with a normal send: the system prompt, memory block, vault retrieval, `@`-mention attachments, and images all ride along exactly as they would in a regular chat. The one difference is deliberate — no prior conversation history. Arena is single-shot, so the comparison reflects how each model answers your prompt fresh, and promoting the winner carries the prompt + winning answer into a normal conversation.

## Quick start

1. Click the **wand icon** 🪄 in the chat header
2. Pick 2–4 models (capability pills show 👁 vision, 🔧 tools, and context length per model)
3. Click **Start arena**
4. Type your prompt and send
5. Responses stream into side-by-side columns
6. Click **Promote to chat** on the column you like best — that model becomes the active chat model and the conversation continues normally

## Provider compatibility

All providers work in the arena. A few caveats:

- **Rate limits apply per provider.** Both columns firing at once can trip a free-tier key (Groq especially). Stagger across providers if you hit 429s.
- **Ollama / LM Studio** — local servers can usually handle 2–3 concurrent requests on a single GPU. More than that and they'll queue.
- **OpenRouter** — excellent for the arena because one key unlocks hundreds of models across providers. Recommended for cross-provider comparisons.
- **Vision** — every selected model needs vision capability if you're sending images. Non-vision models in the arena will show a clear rejection notice.

## Promote to chat

When you find a column whose response you like, click **Promote to chat** at the bottom of that column. The arena closes, the chosen model becomes the active chat model, and the conversation continues with the winner only — the losing column is stopped and its answer removed from the conversation, so subsequent turns are a clean single-model thread.

This is the fastest way to find the right model for a task: arena a representative prompt across two candidates, promote the winner, keep working.

## Cancelling mid-stream

Each arena column streams independently, and stopping is per-column:

- Every column footer has a **Stop** button while it streams. Click it to halt that column only — the other keeps going.
- The main **Stop** button (which replaces **Send** while anything is streaming) aborts all in-flight columns at once.

A stopped column keeps whatever it had already streamed, and **Promote to chat** stays available for it.

Under the hood, each column has its own `AbortController` keyed by `${providerId}:${modelId}`. The controller is released in the response's `finally` block so arena rounds don't accumulate stale references.

## Mobile

On phones, the arena stacks columns vertically rather than side-by-side. You'll scroll to compare responses. The layout is usable but desktop is the natural home for this feature.

## Use cases

**Model selection**

> "Pick the model that writes the cleanest Rust." — arena a refactor task across Claude Sonnet and GPT-5. Promote the winner.

**Prompt tuning**

> Trying to get a model to produce a specific output format? Run the same prompt through the same model via two different providers to see variance.

**Cost / quality tradeoff**

> Compare a cheap model (GPT-5 Mini, Haiku) against a premium one (GPT-5, Sonnet) on the same task. Often the cheap one is good enough.

**Provider reliability**

> Same model, different providers — e.g. Llama 3.3 70B via Groq vs Together vs Fireworks. Spot the provider that's fastest or most reliable for your workload.

## Limitations

- **One arena at a time.** The arena is a single mode — you can't run two arenas in parallel.
- **Agent not available in arena.** Tool-calling is disabled during arena runs; the agent is a single-model feature.
- **Memory injection still applies.** Every arena column sees your full memory block, same as normal chat.
- **Attachments work per column.** If you attach an image or `@`-mention a note, every column sees it. Non-vision models will reject images individually.

## Roadmap

- Save arena results as a comparison note
- Per-column token / cost tracking
- Blind mode (hide model names until you promote)
- Vote-based ranking across multiple prompts
