# Scheduled runs

> Put an agent on a cadence. A task fires headlessly, a note lands in your vault.

A **scheduled run** is a saved prompt — optionally run through one of your [named agents](AGENTS.md) — that Curtis fires on a schedule: **daily at a time**, or **every N minutes**. Each run executes through the same agent loop chat uses (vault tools, MCP tools, memory), touches no conversation, and writes its result as one markdown note. Nothing runs until you create a job, and each run is a fresh engagement — no history from your chats or from previous runs goes in.

## The honest constraint

An Obsidian plugin only runs while Obsidian is open (on mobile, while it's in the foreground). Scheduled runs are therefore best-effort by construction:

- **Due-checks run every 30 seconds** — the first one waits ~20 seconds after launch while provider discovery and vault indexing settle. A run lands within half a minute of its scheduled moment, never to the second.
- **A daily job missed while closed fires once on the next launch** — late, never skipped.
- **Interval jobs re-anchor**: after a missed stretch you get one catch-up run, and the next one is one interval later. Missed runs don't stack up retroactively.
- **One run per job at a time** — a tick while a job's run is in flight skips that job; different jobs may run at the same time. The attempt is recorded before the run starts, so a crash mid-run can't turn into a re-fire loop.
- **Reloading or quitting mid-run aborts the run** — the job records an error ("Aborted (Curtis reloaded)"), and no run note is written for an aborted attempt.

## Creating one

**Settings → Curtis AI → Scheduled runs → New scheduled run…**

| Field | What it does |
|---|---|
| Name | Your label — also names the run note (`Weekly review 2026-10-12 09-00.md`). |
| Task | The prompt. The agent keeps its vault tools, so it can read, search, and write notes. |
| Run as | Default assistant (runs on your current chat model), or a named agent (its persona, model routing, and tool ceilings apply). |
| Schedule | **Daily at a time** (local 24-hour `HH:MM`) or **on a repeating interval** (5 min – 1 week). |
| Enabled | Paused jobs keep their history and can still be run manually. |

An agent used here must have **Remote invocation** enabled in the [agent editor](AGENTS.md) — the same switch that admits MCP clients. The picker marks agents without it (⚠); runs against them fail with a clear error in the run note until you flip it.

## Where results land

Every run writes one note into the run-notes folder (default `AI/Scheduled`, configurable in the same settings section). Frontmatter carries the identity and outcome — `job`, `job_id`, `agent`, `trigger` (schedule/manual), `schedule`, `status`, `ran_at`, `duration_ms`, plus a `curtis: scheduled-run` marker for filtering — and the body is the agent's answer. **Failed runs write a note too**: the error plus the original task, so the note is the audit trail.

Each job gets a card in settings — schedule, runner, and last outcome, with **Run now**, edit, and delete buttons. A manual run counts as a real fire: it resets the interval window and marks today's daily occurrence done. Jobs themselves persist in Curtis's plugin settings (`data.json`), not as vault files — only the run notes land in your vault.

## Cost and safety

Runs bill to your configured providers exactly like chat does — an interval of "every 30 minutes" means 48 agent loops a day, so pick intervals with that in mind. Shell access is always excluded: a run with nobody at the keyboard never executes commands. A named agent's tool ceilings apply on top. One completion notice per run; full detail is always in the note. The run's traffic is exactly chat's — the prompt, the system prompt (memory included), and tool results go to your configured provider, and nothing is sent anywhere else.

## Related

- [AGENTS.md](AGENTS.md) — named agents: persona, model routing, tool ceilings.
- [MCP_SERVER.md](MCP_SERVER.md) — the same Remote invocation gate serves MCP clients.
- [PLUGIN_API.md](PLUGIN_API.md) — the headless `chat()` / `runAgent()` calls scheduled runs ride.
