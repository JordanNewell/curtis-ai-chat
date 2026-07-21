# Changelog

All notable changes to Curtis are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/).

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
