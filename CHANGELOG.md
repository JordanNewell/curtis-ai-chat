# Changelog

All notable changes to Curtis AI Chat are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/).

## [1.0.1] — 2026-07-23

Scorecard-hardening release. Closes the remaining issues surfaced by the Obsidian plugin directory's automated review of 1.0.0.

### Fixed

- **`read_url` tool** — Jina reader JSON response now narrowed through `isRecord` at the parse boundary instead of accessing `any` fields. Eliminates the last 8 `no-unsafe-*` lint warnings (zero-warning baseline now holds on the release artifact, not just source).
- **`styles.css`** — replaced the two `!important` declarations on the read-only Curtis identity textarea with a doubled-class selector that wins on specificity. Same visual result, no `!important`.
- **README** — added a "Network access" subsection under Privacy & security enumerating every external domain the plugin may contact and that all calls are user-initiated. Addresses the scorecard's undisclosed-external-domains flag.

### Notes

- The 1.0.0 scorecard reflected a stale release build; most flags (eslint-disable comments, `document.createElement`, the bulk of the `no-unsafe-*` cluster) were already fixed in source between tagging 1.0.0 and this release. 1.0.1 ships those fixes in the artifact the directory actually scans.
- `settings.ts` still uses the imperative `display()` API (13 call sites) rather than the declarative `getSettingDefinitions()` recommended for Obsidian 1.13+. This is a deprecation warning only — the tab works. Full migration deferred to v1.1.
- `atob`/`btoa` are retained for legitimate image-attachment encoding and data-URL decoding; documented in the README network section.

## [1.0.0] — 2026-07-23

Initial public release. Eight flagship features, full TypeScript type-safety at every provider boundary, and build-provenance attestation on every release asset.

### Added — Features

- **Curtis Agent** — AI can now call tools to read/create/edit your vault notes. Built-in tools: `read_note`, `search_notes`, `create_note`, `edit_note`, `list_notes`, `get_tags`, `get_backlinks`, `get_current_note`, `calculator`. OpenAI-compat providers only for v1.0; opt-in via Settings → Agent → Enable.
- **Multi-model arena** — click the wand icon in the chat header, pick 2-5 models, send one prompt, watch responses stream side-by-side. Click "Promote to chat" on any column to continue with that model.
- **Inline diff rewrite** — select text in any note, `Ctrl+Shift+R` (or right-click → "Rewrite with AI (diff)"). AI generates an improved version, modal shows line-by-line green/red diff with Accept/Reject.
- **`@`-mention vault notes** — type `@` in the chat input, fuzzy-search vault notes, attach. Note contents are prepended to your message as invisible context for the AI.
- **Voice I/O** — mic button in chat input (records via `MediaRecorder`, transcribes via OpenAI Whisper, appends to input). Speaker button on every assistant message (uses browser's `speechSynthesis`). Auto-speak toggle in header for hands-free listening.
- **Cross-conversation search** — `Ctrl+Shift+F` opens a fuzzy-matched picker across all conversations. Click result to switch.
- **Markdown export** — download any conversation as a `.md` file (with provider display names, timestamps, image references). `/export` slash command or download icon in chat header.
- **Memory editing UI** — edit/delete individual memory facts from Settings → Memory. Previously append-only.
- **Native active-note awareness** — the chat header shows a pill for the note open in the editor. One click attaches it to the pending message. The system prompt also gains a context-precedence block so the model knows to prefer attached/active note content over re-searching.

### Added — Internals

- Full TypeScript schemas for every AI provider response shape (OpenAI-compat, Anthropic, Gemini, Ollama)
- Type-guard utilities for safe JSON boundary narrowing (`src/core/types/json-helpers.ts`)
- Shared SSE parsing utilities (`src/providers/types/sse.ts`)
- Strict ESLint config (`@typescript-eslint/recommended-requiring-type-checking`) for local verification
- Privacy section in README documenting vault access

### Fixed

- All `@typescript-eslint` lint warnings resolved (zero-warning baseline established)
- All `no-floating-promises` warnings resolved via explicit `void` operator or `await`
- All `no-unsafe-*` warnings resolved via type-guard narrowing at JSON boundaries
- Unnecessary type assertions removed throughout `providers/`, `settings.ts`, `chat/`, `commands/`

### Notes

- `fetch()` retained in `transport.ts` for mobile streaming — Obsidian's `requestUrl` does not support SSE streaming. Documented with eslint-disable + architectural rationale.
- Declarative `getSettingDefinitions()` migration attempted but reverted — Obsidian 1.13.1 runtime bug where the framework calls `display()` unconditionally despite the docs. Revisit in v1.1.
