# Multi-model arena

> Send one prompt to 2–5 models in parallel. Pick a winner.

The arena lets you compare model responses side-by-side, live, as they stream. Useful for picking the right model for a task, tuning prompts, or just exploring cost/quality tradeoffs.

## What it is

Click the **wand icon** in the chat header to open the arena picker. Select 2–5 models from any providers you have configured. Your next prompt streams to all of them in parallel, each in its own column.

## Quick start

1. Click the **wand icon** 🪄 in the chat header
2. Pick 2–5 models (use the capability pills to filter — 👁 vision, 🔧 tools, context length)
3. Click **Start arena**
4. Type your prompt and send
5. Responses stream into side-by-side columns
6. Click **Promote to chat** on the column you like best — that model becomes the active chat model and the conversation continues normally

## Provider compatibility

All providers work in the arena. A few caveats:

- **Rate limits apply per provider.** If you fire 5 concurrent requests at a free-tier Groq key, some may 429. Stagger across providers if you need breadth.
- **Ollama / LM Studio** — local servers can usually handle 2–3 concurrent requests on a single GPU. More than that and they'll queue.
- **OpenRouter** — excellent for the arena because one key unlocks hundreds of models across providers. Recommended for cross-provider comparisons.
- **Vision** — every selected model needs vision capability if you're sending images. Non-vision models in the arena will show a clear rejection notice.

## Promote to chat

When you find a column whose response you like, click **Promote to chat** at the bottom of that column. The arena closes, the chosen model becomes the active chat model, and the prompt + response are carried into a normal single-model conversation.

This is the fastest way to find the right model for a task: arena a representative prompt across candidates, promote the winner, keep working.

## Cancelling mid-stream

Each arena column streams independently. If one column is stuck or you've already seen enough, you can stop it without affecting the others:

- A **Stop** button replaces the **Send** button while any column is streaming. Click it to abort all in-flight columns.
- Individual abort per column isn't exposed in the UI yet — coming in v1.1. Today the abort is all-or-nothing.

Under the hood, each column has its own `AbortController` keyed by `${providerId}:${modelId}`. The controller is released in the response's `finally` block so arena rounds don't accumulate stale references.

## Mobile

On phones, the arena stacks columns vertically rather than side-by-side. You'll scroll to compare responses. The layout is usable but desktop is the natural home for this feature.

## Use cases

**Model selection**

> "Pick the model that writes the cleanest Rust." — arena a refactor task across Claude Sonnet, GPT-5, DeepSeek V4, and Llama 405B. Promote the winner.

**Prompt tuning**

> Trying to get a model to produce a specific output format? Run the same prompt across 3 instances of the same model (via different providers if needed) to see variance.

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
