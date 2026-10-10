# Curtis CLI — Build Plan

> Task fleet-cabinet #714 / BIG LOOP #709. Status: plan (scoped 2026-10-10).
> Owner: Lucy (architecture). Implementation delegated to Cameron (core transport) + Angela (REPL/UX).

## 0. Premise check — there is no headless core yet

The task says "wrap your new headless core." Scoping found: **no standalone headless core exists**. What does exist, as of commit 13b7bd1 ("built-in MCP server — expose vault, memory, and chat history over loopback Streamable HTTP"):

1. The Obsidian plugin already speaks **Streamable HTTP MCP on loopback** — vault reads, memory, and chat history are callable from outside Obsidian today.
2. The plugin's provider layer (`src/providers/`), message pipeline, and settings are importable outside Obsidian — the smoke tests (`scripts/obsidian-stub.ts`, `models-smoke.mjs`) already run the code under an Obsidian API stub.

That gives two architectures. **Recommendation: Option A.**

## 1. Architecture — two options, pick A

**Option A (recommended): CLI = MCP client to the running plugin.**
`curtis` in the terminal connects to the plugin's existing loopback MCP server (`http://127.0.0.1:<port>/mcp`). The Obsidian app stays the single source of truth: providers, keys (OS keychain — *not* exportable to a bare CLI without re-plumbing SecretStorage), memory, vault, and router settings.

- ✅ Zero credential duplication. API keys never leave the keychain; the CLI holds only the loopback token.
- ✅ Router (#713) comes free: CLI sends ride the same routing layer once Phase 3 lands.
- ❌ Requires Obsidian running. Acceptable — Curtis *is* the Obsidian plugin; the CLI is a terminal *front-end*, not a daemon replacement.

**Option B (rejected for v1): standalone headless extraction.**
Extract provider+memory core into a npm package usable without Obsidian. Requires re-implementing SecretStorage, vault access, and settings outside the app — a multi-week detour that forks the product. Revisit only if CLI usage justifies a daemon mode.

## 2. Command surface (v1)

```
curtis "summarize my last 3 daily notes"    # one-shot prompt → stdout
curtis --chat                               # streaming REPL, history to active conversation
curtis --model deepseek/deepseek-chat "..." # pin a model (bypasses router)
curtis --auto "..."                         # force router mode (default once #713 P3 ships)
curtis models                               # list enabled models w/ capability pills
curtis status                               # plugin reachable? MCP port, router stats
curtis config                               # open plugin settings / show loopback token
```

- Output: plain markdown to stdout; `--json` for scripting.
- Streaming: SSE from the plugin's MCP transport, rendered with a minimal ANSI renderer. No heavy TUI dependency.
- REPL: readline-based, `/model`, `/intent` (show router decision), `/exit`. Keep it boring.

## 3. Config & credentials

- CLI auth = the plugin's loopback MCP token (Settings → MCP server → "Pair CLI" button prints `curtis auth <token>`; token stored in `~/.config/curtis/cli.json`, 0600).
- No API keys in the CLI, ever. If Obsidian isn't running: friendly error + `curtis status` diagnosis, not silent failure.
- One binary via `npx` first (`npx curtis-cli`), no global install needed for v1.

## 4. Packaging & install path

- **npm package `curtis-cli`** (Node ≥18): the codebase is already TS/esbuild; ship a bundled `bin/curtis`. `npm i -g curtis-cli` or `npx`.
- Homebrew tap: defer until npm adoption justifies it (a tap is maintenance surface).
- pip: no — wrong ecosystem for this codebase.
- Versioned in lockstep question: **no** — separate semver, but CLI declares `minPluginVersion` and `curtis status` surfaces mismatches plainly.

## 5. Pairing with the #713 router

- The loopback MCP path means CLI sends enter the exact same send pipeline as sidebar sends → router Phase 3 (`Auto (router)`) applies automatically, including the intent→model badge (rendered as a `# code → deepseek` line above the reply in the terminal).
- Router Phase 0 telemetry (verdicts.jsonl) also captures CLI traffic — the CLI is a *better* data source than the UI because terminal prompts are more intent-typical (summarize notes, quick code). Explicitly wire CLI prompt-type hints into the heuristic classifier input.
- Sequencing: **ship CLI after router Phase 3**, or ship with `--model` only and add `--auto` when the router lands. Either way the CLI repo work can start now against the MCP server.

## 6. Sequencing & delegation

| Phase | Who | Est. | Gate |
|---|---|---|---|
| A: pair/auth flow (plugin "Pair CLI" + token handshake) | Cameron | 1d | `curtis status` round-trips |
| B: one-shot send over MCP + streaming render | Cameron | 2d | one-shot prompt streams to stdout |
| C: REPL + slash commands | Angela | 2d | `--chat` usable, history lands in conversation |
| D: packaging (npm bin, npx flow, version check) | Angela | 1d | `npx curtis-cli "hi"` works on clean machine |
| E: router integration (`--auto`, intent badge) | Cameron | 1d | blocked on #713 Phase 3 |

New package lives at `curtis-ai-chat/packages/cli/` (monorepo, shares types) — avoids a second repo drifting from plugin types.

## 7. Risks

- **Loopback MCP surface gaps** — chat *send* may not be exposed yet (current server exposes vault/memory/history reads). First implementation task: extend the plugin MCP server with a `send` tool (streaming). ~1d, Cameron.
- **Obsidian-not-running UX** — the #1 support issue this CLI will have. Invest in the error copy early.
- **Token hygiene** — loopback token is bearer auth on localhost; bind strictly to 127.0.0.1, rotate from settings, never in shell history docs (pair via copy-paste button).
