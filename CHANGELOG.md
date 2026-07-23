# Changelog

All notable changes to Curtis AI Chat are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/).

## [4.0.0] — 2026-07-22

Major release. Rebrands the plugin from "Curtis" to "Curtis AI Chat" with a new plugin ID (`curtis-ai-chat`). **Existing installs will need to reinstall** — the plugin ID change is not auto-migratable. Also adds 8 major features and a full type-safety pass.

### Added — Features

- **Curtis Agent** — AI can now call tools to read/create/edit your vault notes. Built-in tools: `read_note`, `search_notes`, `create_note`, `edit_note`, `list_notes`, `get_tags`, `get_backlinks`, `get_current_note`, `calculator`. OpenAI-compat providers only for v4.0.0; opt-in via Settings → Agent → Enable.
- **Multi-model arena** — click the wand icon in the chat header, pick 2-5 models, send one prompt, watch responses stream side-by-side. Click "Promote to chat" on any column to continue with that model.
- **Inline diff rewrite** — select text in any note, `Ctrl+Shift+R` (or right-click → "Rewrite with AI (diff)"). AI generates an improved version, modal shows line-by-line green/red diff with Accept/Reject.
- **`@`-mention vault notes** — type `@` in the chat input, fuzzy-search vault notes, attach. Note contents are prepended to your message as invisible context for the AI. The v2-deferred feature, finally shipped.
- **Voice I/O** — mic button in chat input (records via `MediaRecorder`, transcribes via OpenAI Whisper, appends to input). Speaker button on every assistant message (uses browser's `speechSynthesis`). Auto-speak toggle in header for hands-free listening.
- **Cross-conversation search** — `Ctrl+Shift+F` opens a fuzzy-matched picker across all conversations. Click result to switch.
- **Markdown export** — download any conversation as a `.md` file (with provider display names, timestamps, image references). `/export` slash command or download icon in chat header.
- **Memory editing UI** — edit/delete individual memory facts from Settings → Memory. Previously append-only.
- **Native active-note awareness** — the chat header now shows a pill for the note open in the editor. One click attaches it to the pending message. The system prompt also gains a context-precedence block so the model knows to prefer attached/active note content over re-searching.

### Added — Internals
- Full TypeScript schemas for every AI provider response shape (OpenAI-compat, Anthropic, Gemini, Ollama)
- Type-guard utilities for safe JSON boundary narrowing (`src/core/types/json-helpers.ts`)
- Shared SSE parsing utilities (`src/providers/types/sse.ts`)
- Strict ESLint config (`@typescript-eslint/recommended-requiring-type-checking`) for local verification
- Privacy section in README documenting vault access

### Changed
- **Plugin ID**: `curtis` → `curtis-ai-chat` (breaking — existing installs must reinstall)
- **Plugin name**: "Curtis" → "Curtis AI Chat"
- **minAppVersion**: `1.11.4` → `1.13.0` (drops 1.11.4-1.12.x users)
- **Destructive buttons**: migrated from `setWarning()` to `setDestructive()` / `setDestructive().setCta()`
- All HTTP-response parsing now goes through type guards; internal code never sees `any`

### Fixed
- All 28 `@typescript-eslint` lint warnings resolved (zero-warning baseline established)
- All `no-floating-promises` warnings resolved via explicit `void` operator or `await`
- All `no-unsafe-*` warnings resolved via type-guard narrowing at JSON boundaries
- Unnecessary type assertions removed throughout `providers/`, `settings.ts`, `chat/`, `commands/`

### Notes
- `fetch()` retained in `transport.ts` for mobile streaming — Obsidian's `requestUrl` does not support SSE streaming. Documented with eslint-disable + architectural rationale.
- Declarative `getSettingDefinitions()` migration attempted but reverted — Obsidian 1.13.1 runtime bug where the framework calls `display()` unconditionally despite the docs. Revisit in v4.1.0.
- **System prompt migration** — two patches ship to smooth the v3 → v4 transition: (1) the legacy default system prompt is auto-upgraded to the v4 capability-aware version on first load (no user action needed), and (2) context-precedence rules (`@`-attached notes and the active note take priority over re-searching) are injected into any non-default system prompt so users with customized prompts still get correct agent behavior.

## [3.0.1] — 2026-07-21

Maintenance release addressing Obsidian community plugin review feedback. No user-facing behavior changes; the plugin is functionally identical to 3.0.0.

### Changed

- **Manifest description** rewritten to drop the word "Obsidian" (implied by directory context) and to not start with the plugin name
- **Settings UI**: 12 hand-rolled HTML headings replaced with `Setting.setHeading()` for consistent styling; deprecated `setDynamicTooltip` removed
- **Conversation storage** migrated from raw `localStorage` to `App#saveLocalStorage` / `App#loadLocalStorage` for proper per-vault isolation
- **Active note resolver** migrated off deprecated `workspace.activeLeaf` to `workspace.activeEditor`
- **Build**: `builtin-modules` npm dependency replaced with Node's built-in `module.builtinModules`

### Removed

- Default hotkeys on `Open AI Chat` and `Explain selection` commands (let users bind their own to avoid conflicts)
- Unused imports and dead variables across the codebase

### Added

- **Artifact attestations**: GitHub Actions workflow generates build-provenance attestations for release assets (`main.js`, `manifest.json`, `styles.css`), letting users cryptographically verify release files were built from the public source

### Fixed

- **Type safety**: ~30 `any` types in provider implementations replaced with proper TypeScript interfaces (Anthropic stream events as discriminated union, OpenAI chat response shapes, Node `IncomingMessage` minimal surface, model discovery endpoint shapes, Electron `window.require` typing). `StreamResponse.json()` now returns `Promise<unknown>` instead of `Promise<any>`, forcing callers to narrow.
- **DOM safety**: `innerHTML` writes in settings replaced with `createEl` chain; static style assignments converted to CSS classes throughout the chat view

## [3.0.0] — 2026-07-20

Complete rewrite from v2. New chat panel, new providers, new features, new internals. Not backwards-compatible with v2 conversation history.

### Added

- **Redesigned chat panel** — Telegram-style bubbles, model picker with capability pills, hover actions on every assistant message
- **30+ built-in providers** (up from 3): Anthropic, OpenAI, Gemini, Z.ai, Ollama, LM Studio, OpenRouter, Groq, Together, Fireworks, Mistral, DeepSeek, Cohere, Vercel AI Gateway, xAI, Perplexity, Novita, DeepInfra, Hyperbolic, Chutes, Replicate, Lepton, Lambda, Hugging Face, Azure OpenAI, GitHub Models, fal.ai, Cerebras, SambaNova, Requesty
- **Custom providers** — any OpenAI-compatible endpoint
- **Image attachments** — paste (Ctrl+V), drag-and-drop, or paperclip. Saved as real vault files in `attachments/`. Vision-capable models read them; non-vision models get a clear error.
- **Long-term memory** — markdown file in the vault (`AI/Curtis Memory.md`). Auto-capture via background LLM extraction + manual `/remember`. Full-injection recall.
- **Slash commands** — `/clear`, `/regen`, `/title`, `/copy`, `/note`, `/save-all`, `/paste`, `/model`, `/provider`, `/system`, `/stats`, `/remember`, `/forget`, `/memory`, `/help`
- **Slash autocomplete** — type `/` for a fuzzy dropdown
- **10 new selection actions** — fix-grammar, shorten, TL;DR, refactor, add-tests, convert-callout, extract-links, ELI5, table-from-text, pros-cons
- **15 new prompt templates** — refactor, add-tests, add-types, add-docs, security-audit, convert-language, fix-grammar, shorten, formal/casual tone rewrites, proofread, TL;DR, table-from-text, extract-links, pros-cons, root-cause
- **Per-message hover actions** — copy, quote-into-input, save-as-note, insert-into-active-note, regenerate, edit-and-resend
- **Enter-key behavior setting** — Enter-to-send (default) or Enter-for-newline with Ctrl/Cmd+Enter to send
- **Chat background** — theme default or a wallpaper image from your vault
- **Auto-save assistant responses** to a configurable folder
- **Conversation history dropdown** with search
- **OS keychain storage** for API keys on Obsidian 1.11.4+ (Windows Credential Manager, macOS Keychain, Linux Secret Service)
- **Auto model discovery** via `/v1/models`, `/api/tags` (Ollama), `/v1beta/models` (Gemini)
- **Cost tracking** with per-model pricing in provider definitions
- **Image-rejection auto-retry** — if a provider rejects an image, Curtis retries as text-only with a Notice

### Changed

- **Anthropic stream handling** — `message_start` is now parsed for prompt token counts (was always 0 before)
- **Conversation storage** uses paths instead of base64 for images — `localStorage` quota no longer an issue
- **CSS uses real Obsidian tokens** (`--size-4-N` instead of made-up `--size-N-x`)
- **Brand orb** renders as part of the empty state (appears on new chat, disappears with first message)

### Fixed

- Memory parser no longer drops facts containing wikilinks or bracketed text
- Memory persist→modify→reload race no longer causes silent data loss
- Image-only messages no longer produce empty content strings (provider 400 errors)
- Azure OpenAI with no endpoint no longer crashes on first request
- Ollama and LM Studio endpoint field now shows for `authType: 'none'`
- `currentSendHasImagesFlag` global leak across sends
- History dropdown can no longer switch conversations mid-stream (was corrupting the new conversation)
- `friendlyError` regex false positives (`/401/` matched any "401" substring)
- Paperclip button event propagation (input is now a sibling of the button, not a child)

### Removed

- **Note-focused mode** (chat sidebar) — flawed UX, deferred to v2 inline-note-mode
- **`@`-mention attachment** — same family, also deferred
- **`/read-note` slash command** — same
- **Vault indexer** (`VaultIndexer` class) — ran on every file change, never queried by anything. Pure overhead.
- **Daily notes assistant stub** — declared, never implemented
- **RAG settings block** — declared, no implementation
- **Link suggestions setting** — UI existed, code never called
- v2-era docs (ENHANCEMENTS, QUICKSTART, IMPLEMENTATION_SUMMARY, TESTING_CHECKLIST)

### Security

- `.gitignore` now blocks `data.json` and `.zcode/`
- Privacy notice added to Provider Configuration settings
- Allotment of outbound HTTPS endpoints audited — no plaintext HTTP except localhost (Ollama/LM Studio)
- No `eval`, no `new Function`, no `innerHTML` with user input
- API keys never appear in error messages or logs

## [2.x] — earlier

Pre-rewrite versions. Not documented here. See git history if you need details.
