# Headless Core: Package Boundary & Migration Plan

**Author:** Cameron · **Date:** 2026-10-10 · **Task:** fleet-cabinet #723 (from #720/#703)
**REVIEW BY:** Lucy

## Goal

Extract the "brain" of curtis-ai-chat — AI logic, tool routing, memory parsing,
provider configs — into a pure, platform-agnostic TypeScript package
(working name `@jordannewell/curtis-core`). Obsidian becomes a shell: UI,
vault adapter, plugin lifecycle. The same core later powers a VS Code
extension, browser extension, CLI, or desktop app.

## Current state (verified on disk)

- `feat/core-package` local branch exists but is **stale** — sits at pre-1.6
  master, contains no package work. Safe to reset/reuse; nothing to preserve.
- `feat/ambient-voice` has uncommitted WIP (`src/voice/ambient.ts`, edits to
  main/settings/types/commands). **Do not touch this branch.** Coordination
  notes at bottom.
- Already clean of `obsidian` imports today: `core/events.ts`,
  `core/hooks.ts`, `core/system-prompt.ts`, `core/migration.ts`,
  `providers/base.ts`, `providers/stream-shim.ts`, `providers/anthropic.ts`,
  `mcp/client.ts`, `mcp/manager.ts`, `mcp/types.ts`, `rag/chunker.ts`,
  `rag/retrieval.ts`, all of `src/providers/types/`. That's ~40% of the brain
  already portable with zero changes.

## Dependency inventory — every `obsidian` import in core-candidate modules

| Module | Imports | Abstraction needed |
|---|---|---|
| `providers/registry.ts` | `requestUrl` | Inject `HttpFetcher` port |
| `providers/transport.ts` | `Platform`, `requestUrl`, `RequestUrlResponse` | The big one — see "Transport" below |
| `providers/…` (base/anthropic/stream-shim) | none | none |
| `core/tools.ts` | `App`, `TFile` (type+value) | `ToolContext` already carries runtime deps; replace `App` with a narrow `VaultReader` interface |
| `core/secrets.ts` | `App` (type only) | `SecretStore` port; plugin passes an adapter over `app.secretStorage` |
| `core/web-tools.ts` | `requestUrl` | `HttpFetcher` port |
| `memory/memory.ts` | `App`, `Notice`, `TFile` | `VaultAdapter` port (read/write/exists/list); `Notice` → `Notifier` port (shell shows toasts) |
| `rag/embeddings.ts` | `requestUrl` | `HttpFetcher` |
| `rag/index-manager.ts` | `TFile`, `debounce`, `App`, `PluginManifest` | `VaultAdapter` + scheduler injected from shell (`debounce` is a shell concern) |
| `mcp/server.ts` | `App`, `Notice`, `TFile` | `VaultAdapter` + `Notifier` |
| `chat/conversation-store.ts` | `App`, `Notice`, `TFile`, `parseYaml`, `stringifyYaml` | `VaultAdapter` + swap obsidian YAML helpers for `js-yaml` (pure, identical semantics for our subset) |

**Three ports cover everything:** `HttpFetcher` (requestUrl), `VaultAdapter`
(TFile/vault ops), `Notifier` (Notice) — plus `SecretStore` and a scheduler
callback. Five small interfaces, <100 lines total. Everything else is pure TS
already.

## Transport (providers/transport.ts) — the one real design decision

Today it picks between node-https (desktop-only), fetch, and obsidian
`requestUrl` (CORS-immune because it runs through the host app). The core
can't know about any of these. Design:

- Core declares `HttpFetcher { post(url, headers, body, signal): Promise<HttpResponse> }`.
- Core owns the **selection policy** (streaming vs fallback, retry, abort) —
  that's brain logic.
- Shell supplies the implementation: obsidian adapter wraps `requestUrl`;
  CLI/browser/VS Code adapters wrap `fetch`/node-https.
- `Platform.isDesktopApp` branching moves to the shell adapter factory.

## Package boundary

**Moves to `curtis-core`** (pure, no platform imports):
`providers/*` (all), `core/{tools,system-prompt,migration,events,hooks,web-tools,secrets}`,
`memory/*`, `mcp/{client,manager,server,transport,types}` (server keeps running
on plain Node http — it already avoids plugin APIs except vault reads),
`rag/chunker`, `rag/retrieval`, `rag/embeddings` (logic), `utils/{base64,diff}`,
provider type defs.

**Stays in Obsidian shell:**
`main.ts`, `settings.ts` (plugin UI lifecycle), `chat/view.ts` +
`chat/message-{renderer,actions}.ts`, all `ui/modals/*`, `commands/*`,
`icons.ts`, `styles.css`, `voice/*` (ambient audio uses plugin APIs),
`rag/index-manager` shell wiring (debounce/timing), vault adapters.

**Shared but adapter-bound** (core gets interface, shell gets impl):
`conversation-store` (logic moves; YAML/vault IO via adapter),
`rag/index-manager` (indexing logic moves; scheduling/vault stay).

## Migration sequence — plugin shippable at every step

Each step is one PR, green build, releasable. No big-bang.

1. **Ports package skeleton.** Add `packages/core/` (or separate repo —
   recommend separate repo `JordanNewell/curtis-core` once stable; start
   in-monorepo to keep CI simple). Define the five ports. Shell passes
   itself. Zero behavior change.
2. **Move already-clean modules.** events, hooks, system-prompt, migration,
   providers/base + anthropic + stream-shim, mcp/client+manager+types,
   rag/chunker+retrieval, utils. Pure moves, re-export shims in `src/` so
   plugin imports don't churn.
3. **Port `requestUrl` call sites.** registry, embeddings, web-tools take
   `HttpFetcher`. Shell adapter = requestUrl wrapper. Small diffs, easy
   review.
4. **Port vault-coupled modules.** tools.ts → VaultReader; memory, mcp/server,
   conversation-store, index-manager logic → VaultAdapter/Notifier.
5. **Transport split** per design above. Providers become
   transport-agnostic; shell registers the requestUrl-backed fetcher.
6. **Build wiring.** esbuild bundles core into the plugin as today (no
   runtime change); `tsc --build` project refs for typecheck; core gets its
   own vitest suite — this is where the first real tests land (provider
   fixtures, tool routing, memory parsing, migration table).
7. **Extract to standalone package/repo** once 1–6 soak. Publish
   `@jordannewell/curtis-core`; plugin consumes via workspace/npm dep.

Sequence note: tests-first applies at step 6 for logic that currently has no
seams; for steps 2–5 the existing plugin is the harness — each move must keep
`npm run build` + manual smoke green.

## Coordination with feat/ambient-voice

Wake-word work touches `src/voice/ambient.ts` + settings/types/commands — all
shell-side files. It does **not** touch any module moving to core. Safe to
proceed in parallel **provided** the core work lands as its own branch off
`master` (not rebasing ambient-voice), and voice/ stays out of packages/core.
If wake-word later needs memory/provider calls, it consumes core through the
same ports the plugin uses — which is exactly the seam this refactor creates.

## Tests (what I'll write, per step)

- Port adapters: fetcher/vault/notifier contract tests against the obsidian
  adapter impls (shell-side).
- Core unit: tool schema building, memory parsing, migration round-trips,
  provider request/response fixtures per family (openai-compat, anthropic,
  gemini, ollama), transport selection policy with a fake fetcher.
- Contract: core compiles with **zero** `obsidian` imports — enforced by an
  eslint `no-restricted-imports` rule scoped to packages/core, in CI. This is
  the regression guard that keeps the boundary honest.
