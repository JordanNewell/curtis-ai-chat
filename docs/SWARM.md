# Swarm mode

> One leader chat, many follower agents. The leader delegates; you watch the vault work.

Mark any chat as a **leader** and it gains one new tool: `spawn_agent`. Ask for parallel work and the leader spawns **follower agents** — real, separate chats that each research, read, or draft one subtask with the full vault toolset, then report back. Every follower opens in its own pane (or window) so you can watch each one work.

Leaders are how you say "divide this up". Followers are how it gets done.

## Making a leader

Either path, one step:

- The pane's **"..." menu** → **Make leader (spawn agents)** — a crown appears by the title
- The input box → **`/leader`** (repeat either to turn it off)

A leader chat always runs with tools enabled — no other setup. The setting **Settings → Agent → Max follower agents** (1–4, default 3) caps how many followers one message may spawn.

## What a follower is

- A **real conversation** — its own vault file, its own transcript, resumable and exportable like any chat. It inherits the leader's model.
- **One task** — the leader writes complete, standalone instructions; the follower can't see the leader's chat. It works with the vault tools (read/search/create/edit notes, web tools if enabled) and returns a full report.
- **Watchable** — the run opens in a pane next to the leader. Each step lands as it happens. Close the pane whenever; the run keeps going and the transcript keeps writing.
- **Not a leader** — followers cannot spawn further agents. One level of delegation, by design.

Followers run **one at a time**. That keeps cost predictable and means two followers never edit the same note simultaneously. The leader collects each report, then synthesizes.

## Stopping

**Stop on the leader stops everything** — the leader's response and every follower it started. Each follower's transcript records where it was stopped. A follower's own pane is read-only while its leader owns it; the composer unlocks when the run ends.

## Where the transcripts live

Everything is ordinary history: leader chat, each follower chat, every tool call and report — searchable, exportable, and hand-editable in `AI/Conversations`. A follower's report is capped at what the leader receives (8,000 characters); the full text always stays in the follower's own transcript.

## Swarm vs agent mode vs the arena

- [Agent mode](AGENT.md) — one chat using tools, one step at a time. The leader is agent mode **plus delegation**.
- The [arena](ARENA.md) — one prompt to two models, pick a winner. Comparison, not cooperation.
- Swarm — a task divided into subtasks, each done by its own agent, results combined.

## Good fits

**Vault-wide research**

> "Find every note that mentions project Falcon, read them, and summarize the state of the project" — one follower reads, the leader synthesizes; or several followers split folders.

**Drafting from sources**

> "Draft an outline from my interview notes" — a follower digs through the source notes while the leader holds the conversation and shapes the structure.

**Parallel reading**

> "Compare these three papers' methodologies" — one follower per paper, reports come back side by side.

## Deliberate limits (v1)

- **Followers inherit the leader's model** — per-follower models are not offered yet.
- **No follower-to-follower messaging** — the leader coordinates; followers report to it. This is the shape of multi-agent work that actually holds up: isolated, read-heavy subtasks, one synthesizer.
- **Serial execution** — followers queue rather than run simultaneously.
- **Shared vault** — followers can create and edit notes like any agent chat. Leader-delegated edits are serialized (one follower at a time), but a follower and your own edits can still meet in the same note — same as two panes today.

## See also

→ [AGENT.md](AGENT.md) for the tool loop followers run on
→ [MULTIPANE.md](MULTIPANE.md) for the pane and window system followers appear in
→ [SLASH_COMMANDS.md](SLASH_COMMANDS.md) for `/leader`
