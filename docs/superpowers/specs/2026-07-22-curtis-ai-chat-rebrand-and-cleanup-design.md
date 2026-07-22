# Curtis AI Chat v4.0.0 — Rebrand and Type-Safety Cleanup

**Date:** 2026-07-22
**Status:** Design approved, ready for implementation planning
**Author:** Jordan Newell (paired with Claude Code)

## Goal

Ship `curtis-ai-chat` v4.0.0 — a polish-and-rebrand release that takes the Curtis Obsidian plugin from "shipped but linter-noisy" to pristine: zero Obsidian plugin linter warnings, full TypeScript type safety on every external JSON surface, modern Obsidian 1.13.0+ APIs, and a clean rebrand from "Curtis" to "Curtis AI Chat".

## Locked decisions

| Decision | Value | Rationale |
|---|---|---|
| Plugin name | `Curtis AI Chat` | Search-discoverable for "chat" keyword in Obsidian directory. |
| Plugin ID | `curtis-ai-chat` | Breaks existing installs (accepted). Signals major version. |
| minAppVersion | `1.13.0` | Unlocks `getSettingDefinitions()` + `setDestructive()`. Drops 1.11.4-1.12.x users (accepted). |
| Version | `4.0.0` | Semver-honest — breaking install ID + minAppVersion jump. |
| Typing strategy | Full per-provider schemas | "No shortcuts, only the best code for review." |
| Vault enumeration flag | README transparency only | All calls are legitimate features (search tool, image picker, folder picker). |
| Execution model | Sequential file-by-file subagents | Zero conflict risk, every diff reviewable. |

## Scope

### In scope

- Plugin ID change `curtis` → `curtis-ai-chat`
- minAppVersion bump `1.11.4` → `1.13.0`
- Version bump `3.0.1` → `4.0.0`
- Full TypeScript schemas for every external JSON surface (~50 `unsafe-*` warnings)
- Migration from `PluginSettingTab.display()` to declarative `getSettingDefinitions()` API
- Migration from `ButtonComponent.setWarning()` to `setDestructive()` / `setDestructive().setCta()`
- Floating-promise cleanup (`void` operator + `.catch` handlers)
- Removal of unnecessary type assertions
- `fetch()` in `src/providers/transport.ts`: retained with eslint-disable + architectural-rationale comment (mobile streaming requires it; `requestUrl` does not stream)
- Privacy section added to README
- Repo rename `JordanNewell/curtis-chat` → `JordanNewell/curtis-ai-chat`
- Local folder rename `E:/dev/projects/obsidian-glm-plugin/` → `E:/dev/projects/curtis-ai-chat/`
- community.obsidian.md submission updated

### Out of scope

- Functional changes to plugin behavior (this is a polish release, not a feature release)
- Folder-scope privacy setting (deferred)
- Removal of vault-search tools (kept as user-facing features)
- Renaming the local folder before the final ship step (Windows can't rename folders in active use)

## Architecture: typing boundary

Every external JSON surface gets a typed entry point. Internal code never sees `any`.

```
HTTP response → unknown → type guard at boundary → typed shape → internal code
```

### New files

- `src/providers/types/sse.ts` — discriminated union for SSE event shapes
- `src/providers/types/openai-responses.ts` — OpenAI ChatCompletion + streaming chunk shapes (also covers ~24 OpenAI-compatible providers)
- `src/providers/types/anthropic-responses.ts` — Anthropic Message + stream event shapes (extends partial work from 3.0.1)
- `src/providers/types/gemini-responses.ts` — Gemini GenerateContentResponse + chunks
- `src/providers/types/ollama-responses.ts` — Ollama ChatResponse + tags + version
- `src/core/types/json-helpers.ts` — `isRecord`, `hasStringProp`, `hasNumberProp`, `asStringArray`, etc.

### Provider shape families

The 30+ providers in `registry.ts` mostly share 4 shapes:

1. **OpenAI-compatible** — OpenRouter, Groq, Together, Fireworks, Mistral, DeepSeek, Cohere, Vercel, xAI, Perplexity, Novita, DeepInfra, Hyperbolic, Chutes, Replicate, Lepton, Lambda, HF, Azure, GitHub Models, Cerebras, SambaNova, Requesty, fal
2. **Anthropic-native** — Anthropic
3. **Gemini-native** — Gemini
4. **Ollama-native** — Ollama, LM Studio (shares `/api/tags`)

Actual schema-writing work: ~4 canonical shapes + per-vendor deviations (model lists, auth quirks).

### Type guard convention

```typescript
function isOpenAIChunk(v: unknown): v is OpenAIStreamChunk {
  return isRecord(v) && hasStringProp(v, 'id') && hasArrayProp(v, 'choices');
}
```

## Subagent sequence

Eleven sequential runs. Each owns its files to completion, full build + lint passes before next agent starts. Jordan reviews every diff before the next subagent is invoked (the reason sequential was chosen over parallel).

| # | Subagent | Owns | LOC | Notes |
|---|---|---|---|---|
| 1 | Foundation | `manifest.json`, `package.json`, `versions.json`, `tsconfig.json` | small | Metadata + version baseline. |
| 2 | Provider spine typing | `src/providers/transport.ts`, `stream-shim.ts`, `base.ts` | ~644 | Establishes type contract for all providers. |
| 3 | Provider registry typing | `src/providers/registry.ts` + new `src/providers/types/*` | ~712 + new | Biggest single chunk. Defines per-vendor interfaces. |
| 4 | Anthropic provider | `src/providers/anthropic.ts` | ~263 | Finish the partial typing from 3.0.1. |
| 5 | Core modules | `src/core/tools.ts`, `secrets.ts`, `migration.ts` | ~674 | Replace `Record<string, any>` patterns. |
| 6 | Memory + vault | `src/memory/memory.ts`, `src/vault/notes.ts`, `active-note.ts` | ~572 | Memory parser `any` cleanup. |
| 7 | Chat view + UI modals | `src/chat/*`, `src/ui/modals/*`, `src/commands/context-menu.ts` | varies | Promise warnings + modal `any`. |
| 8 | Settings modernization | `src/settings.ts` | ~733 | Biggest API migration: `display` → `getSettingDefinitions`, `setWarning` → `setDestructive`. |
| 9 | Promise + assertion sweep | all files | n/a | Mechanical residue cleanup. |
| 10 | Rebrand | manifest strings, README, CHANGELOG, docs, settings headings | varies | Code is frozen by now. |
| 11 | Ship | repo rename, folder rename, tag, release, submit | n/a | Folder rename last. |

**Gating between agents:** after each agent lands, run `npm run build` (tsc + esbuild) and the linter. Zero new warnings allowed before next agent starts. Commit after each gate passes.

**Estimated total:** ~3,500 LOC across 25+ files. Wallclock with sequential + careful review: ~6-10 hours of agent work.

## Rebrand surface area

### Code changes (subagent 10)

- `manifest.json`: `"id": "curtis"` → `"curtis-ai-chat"`, `"name": "Curtis"` → `"Curtis AI Chat"`, description stays compliant
- `package.json`: `"name": "curtis"` → `"curtis-ai-chat"`
- Settings UI headings: any heading containing "Curtis" must be reviewed against the Obsidian rule "settings headings can't contain the plugin name". Replace with "AI Chat" / "Assistant" / similar.
- Slash command help text: brand references
- Empty-state brand orb: label updates

### Doc changes

- `README.md`: hero, h1, intro paragraph, badges
- `CHANGELOG.md`: new `## [4.0.0] — 2026-07-22` entry
- `docs/PROVIDERS.md`, `MEMORY.md`, `SLASH_COMMANDS.md`, `SELECTION_ACTIONS.md`, `IMAGES.md`: brand references
- `CONTRIBUTING.md`, `LICENSE` (copyright holder unchanged)

### Repo rename

- `gh repo rename curtis-ai-chat --repo JordanNewell/curtis-chat` (GitHub auto-redirects)
- Update README clone URL, package.json `repository` field
- Update community.obsidian.md submission URL

### Folder rename

- Close all editors/terminals pointing at `E:/dev/projects/obsidian-glm-plugin/`
- `mv E:/dev/projects/obsidian-glm-plugin E:/dev/projects/curtis-ai-chat`
- Reopen
- Obsidian deployment path: deploy to `<vault>/.obsidian/plugins/curtis-ai-chat/` (matches new plugin ID)

## Ship & verification

### Pre-tag checklist

1. `npm run build` clean (tsc + esbuild)
2. Linter run — zero warnings
3. Manual smoke test in Obsidian: open chat, send to Anthropic + OpenAI + Ollama, image attachment, slash command, memory write, vault-search tool
4. Mobile smoke test (or document as deferred)
5. Deploy `main.js` + `manifest.json` + `styles.css` to test vault, reload Obsidian, verify plugin loads clean

### Tag + release

- Tag `4.0.0` (no 'v' prefix — Obsidian rule)
- Push tag → triggers `release.yml` → builds + attests all 3 assets
- `gh release upload 4.0.0 main.js manifest.json styles.css --clobber` if workflow doesn't auto-attach
- Verify release shows 3 assets with attestation badges

### Post-release

- Update community.obsidian.md submission (bump version, update repo URL, resubmit for review)
- Update COLLAB.md session summary
- Memory update: save `project_curtis-ai-chat-v4-0-0-ship-2026-07-22.md`

## Risks

| Risk | Mitigation |
|---|---|
| Provider schema over-typing breaks on upstream API drift | Schemas live in `src/providers/types/`, individually replaceable. Type guards fail open with runtime fallback. |
| `getSettingDefinitions()` migration subtly changes settings UI behavior | Subagent 8 produces before/after screenshots of every settings tab for review before squash-merge. |
| Repo rename breaks community.obsidian.md auto-update webhook | Update submission URL immediately after rename, resubmit. |
| Local folder rename fails (Windows file lock) | Subagent 11 closes all editor/terminal sessions pointing at the folder first; instructions include `taskkill` for any lingering node/esbuild processes. |
| Existing install base confusion ("where did Curtis go?") | CHANGELOG entry explains rebrand; README hero mentions "formerly Curtis"; pinned issue on GitHub. |

## Success criteria

- `npm run build` exits 0
- `npm run lint` reports zero warnings
- Tag `4.0.0` pushed, release assets attested
- Submission updated at community.obsidian.md
- Local folder renamed, working tree clean
- Plugin loads in fresh Obsidian 1.13.0+ vault with no console warnings
