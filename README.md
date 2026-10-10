<div align="center">
  <img src="https://raw.githubusercontent.com/JordanNewell/curtis-ai-chat/master/assets/hero.png" alt="Curtis AI — polyglot AI chat for Obsidian. 50+ providers, one sidebar." width="100%">
</div>

<p align="center">
  <strong>Polyglot AI chat for Obsidian.</strong><br>
  Fifty-three providers, one sidebar. Your data stays in your vault.
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/JordanNewell/curtis-ai-chat/master/assets/demo-arena-cloud-vs-cloud.gif" alt="The arena in motion — one prompt typed once, streaming in parallel to Gemini via OpenRouter and DeepSeek via its official API, per-column stop, then Promote-to-chat keeps the winner" width="720">
</p>

<p align="center"><em>The arena, live: same prompt through two APIs — OpenRouter vs DeepSeek — stop one column, promote the winner.</em></p>

<p align="center">
  <a href="https://jordannewell.github.io/curtis-ai-chat/"><img src="https://img.shields.io/badge/website-live-00FF41" alt="Live site"></a>
  <a href="https://github.com/JordanNewell/curtis-ai-chat/releases"><img src="https://img.shields.io/github/v/release/JordanNewell/curtis-ai-chat?label=release&color=0A0A0A" alt="Latest release"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-1F1F1F" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/Obsidian-1.13%2B-0A0A0A?logo=obsidian&logoColor=00FF41" alt="Obsidian 1.13+">
  <img src="https://img.shields.io/badge/providers-53-00FF41" alt="53 built-in providers">
  <img src="https://img.shields.io/badge/build-0%20warnings-00FF41" alt="Zero lint warnings">
  <a href="https://github.com/JordanNewell/curtis-ai-chat/discussions"><img src="https://img.shields.io/github/discussions/JordanNewell/curtis-ai-chat?label=discussions&color=0A0A0A" alt="GitHub Discussions"></a>
</p>

<p align="center">
  <a href="https://jordannewell.github.io/curtis-ai-chat/">Website ↗</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#highlights">What's new</a> ·
  <a href="#features">Features</a> ·
  <a href="docs/INDEX.md">Docs</a> ·
  <a href="CHANGELOG.md">Changelog</a> ·
  <a href="https://github.com/JordanNewell/curtis-ai-chat/discussions">Feedback</a>
</p>

---

## Screenshots

Real captures, regenerated any time with `npm run shots && npm run mockups` (general set), `node scripts/capture-arena-shots.mjs` (arena set, both themes + phone), and `node scripts/record-arena-demo.mjs` (demo GIFs/MP4s).

| | |
|---|---|
| <img src="https://raw.githubusercontent.com/JordanNewell/curtis-ai-chat/master/assets/screenshots/arena-streaming-dark.png" alt="Arena — one prompt streaming to two models side by side, per-column Stop while streaming" width="100%"> | |
| <img src="https://raw.githubusercontent.com/JordanNewell/curtis-ai-chat/master/assets/screenshots/arena-final-light.png" alt="Arena, light theme — both answers complete, Promote to chat on each column" width="100%"> | <img src="https://raw.githubusercontent.com/JordanNewell/curtis-ai-chat/master/assets/screenshots/phone-arena-framed-dark.png" alt="Arena on a phone — columns stack vertically" width="220"> |
| <img src="https://raw.githubusercontent.com/JordanNewell/curtis-ai-chat/master/assets/screenshots/multipane-tabs-dark.png" alt="Multi-pane chat — two titled chat tabs in the center tab strip, each its own conversation and model; the pane menu renames, opens new tabs and windows" width="100%"> | |
| <img src="https://raw.githubusercontent.com/JordanNewell/curtis-ai-chat/master/assets/demo-memory.gif" alt="Memory — after a turn, proposed facts appear with Save/Skip; nothing persists until you tap Save" width="720"> | |
| <img src="https://raw.githubusercontent.com/JordanNewell/curtis-ai-chat/master/assets/screenshots/desktop-chat.png" alt="Desktop — vault open, agent conversation on a local Ollama model with tool call and result" width="100%"> | <img src="https://raw.githubusercontent.com/JordanNewell/curtis-ai-chat/master/assets/screenshots/phone-chat-framed.png" alt="Phone — the agent conversation at phone width" width="220"> |

---

## Quick start

**60 seconds to your first message.**

1. **Install** — download the [latest release][releases] (`main.js`, `manifest.json`, `styles.css`) into `<vault>/.obsidian/plugins/curtis-ai-chat/`, then enable it under **Settings → Community plugins**. Or use [BRAT][brat] for auto-updates during the beta.

2. **Configure one provider** — open **Settings → Curtis AI → Provider Configuration**, enable a provider, paste an API key. Keys are stored in your OS keychain via the Obsidian `SecretStorage` API.

3. **Send a message** — click the **robot icon** in the ribbon, pick a model from the header dropdown, type, hit Enter. (All commands are hotkey-assignable under Obsidian's Settings → Hotkeys — none are bound by default.)

> [!TIP]
> **Want fully private, free, offline AI?** Install [Ollama](https://ollama.com), run `ollama pull qwen2.5:7b-instruct`, then enable **Ollama (Local)** in provider settings. No API key. Nothing leaves your machine.

[releases]: ../../releases
[brat]: https://github.com/TfTHacker/obsidian42-brat

---

## Highlights

The flagship features. Full details in [CHANGELOG.md](CHANGELOG.md) and the per-feature docs.

| | Feature | What it does |
|---|---|---|
| 🤖 | **[Curtis Agent](docs/AGENT.md)** | AI calls tools to read, create, and edit your vault notes. Eleven built-in tools, every provider. |
| 🎭 | **[Named agents](docs/AGENTS.md)** | Give any model a role: persona + model routing + tool ceilings, bound to any chat with `/agent` — or spawned as swarm specialists. |
| 🔌 | **[MCP servers](docs/AGENT.md#mcp-servers)** | Connect MCP servers you already run — any tool they expose joins the agent's toolset, namespaced `mcp__<server>__<tool>`. |
| ⚔️ | **[Multi-model arena](docs/ARENA.md)** | Stream one prompt to 2–4 models in parallel, side-by-side. Pick a winner, promote to chat. |
| 🪟 | **[Multi-pane chat](docs/MULTIPANE.md)** | Open another chat as a tab or its own OS window. Each keeps its own conversation, provider, and model — titled, so you can tell them apart. |
| 🎨 | **[Inline diff rewrite](docs/DIFF_REWRITE.md)** | Cursor-style rewrite with an Accept/Reject diff modal. Assignable hotkey. |
| ✍️ | **[Inline autocomplete](docs/AUTOCOMPLETE.md)** | Ghost-text suggestions while you type in any note. Pause, Tab to accept. Small and local models work. |
| @ | **[@-mention vault notes](docs/MENTIONS.md)** | Type `@` in chat → fuzzy-search your vault → attach note content as context. |
| 🎙️ | **[Voice I/O](docs/VOICE.md)** | Whisper speech-to-text on the mic button. Browser TTS on every assistant message. |
| 🔍 | **Cross-conversation search** | Assignable hotkey opens a fuzzy-matched picker across all conversations and messages. |
| 📝 | **Markdown export** | Download any conversation as `.md`. `/export` slash command or download icon. |
| 📥 | **[Chat import + `.curt`](docs/IMPORT.md)** | Bring ChatGPT, Claude, or any role-labeled chat history into Curtis — exports auto-detected, imports land as normal vault files. One `.curt` file = one portable conversation. |
| 🧠 | **[Memory](docs/MEMORY.md)** | Ask-before-saving capture with provenance: every fact records the conversation it came from, and replies show a "N memories" chip with the fact list behind it. |
| 📓 | **Recaps + Curtis Journal** | `/recap` writes a terse session summary into the chat and an append-only journal note — plus a "discussed in …" hint when your open note matches a past conversation. |
| 🗂️ | **Conversations as vault files** | Every chat persists as a markdown note in `AI/Conversations/` — synced across devices, in native Obsidian search, and readable by the agent. Old localStorage history imports itself. |

Plus a full type-safety pass: every AI provider response shape is strictly typed, with type-guard narrowing at every JSON boundary. Zero lint warnings on `npm run build`.

---

## Features

### 🤖 Curtis Agent

The AI can now call tools to modify your vault. Eleven built-in tools: `read_note`, `search_notes`, `semantic_search`, `create_note`, `edit_note`, `list_notes`, `get_tags`, `get_backlinks`, `get_current_note`, `get_current_date`, `calculator`.

- **Every major provider** — Anthropic via native tool use, OpenAI-compatible endpoints (OpenAI, Gemini, Ollama, Groq, DeepSeek, custom). The model must support tool calling.
- **`agentMaxTurns` safety cap** (default 5) prevents runaway tool loops
- **MCP servers** — connect your existing [Model Context Protocol](https://modelcontextprotocol.io) servers (Settings → MCP servers) and every tool they expose becomes callable alongside the built-ins. Streamable HTTP transport — local stdio servers need an HTTP bridge such as `mcp-proxy` or `supergateway`.
- **Opt-in** via Settings → Agent → Enable

→ [docs/AGENT.md](docs/AGENT.md)

### 🎭 Named agents

Create reusable workers — an Editor on Claude that can read but not write, a Researcher with web access and a read-only vault, a Librarian on local Ollama that never touches the network — and bind them to any chat with `/agent` or the header pill.

- **Model routing per role** — the agent picks the provider/model; the pane picker stays yours
- **Tool ceilings** — vault / web / MCP toggles that can only narrow what the global settings allow
- **Memory you can sever** — a memory-off agent's facts never reach the shared memory file, so local-only lanes stay private end to end
- **Swarm specialists** — a leader chat can spawn any agent by name as a follower with its own model and permissions

→ [docs/AGENTS.md](docs/AGENTS.md)

### ⚔️ Multi-model arena

Pick 2–4 models, send one prompt, watch responses stream side-by-side. Click **Promote to chat** on any column to continue with that model.

- Compare quality, latency, and cost live
- All providers supported (mind per-provider rate limits)
- Stacks vertically on mobile

→ [docs/ARENA.md](docs/ARENA.md)

### 🎨 Inline diff rewrite

Select text in any note → right-click → **Rewrite with AI (diff)** (or assign a hotkey under Settings → Hotkeys). The AI generates an improved version and a modal shows line-by-line green/red diff. Accept or reject.

- Cursor-style review workflow
- Reuses your active provider and model
- Word-level diff and inline editor decorations planned for v1.1

→ [docs/DIFF_REWRITE.md](docs/DIFF_REWRITE.md)

### @ @-mention vault notes

Type `@` in the chat input → fuzzy-search your vault → click a result to attach. Note content is prepended to your message as invisible context. Chips above the input show what's attached.

- Active-note pill in the chat header for one-click attach of the current note
- AI uses attached content as the source of truth — no re-searching
- Works with or without the Agent enabled

→ [docs/MENTIONS.md](docs/MENTIONS.md)

### ✍️ Inline autocomplete

Keep typing — when you pause mid-word, a dimmed continuation appears after the cursor. **Tab** accepts, **Escape** dismisses, one undo removes it.

- Works in every note, with any provider — including local Ollama models
- Requests are debounced, cached, and capped at 60 tokens; the model picker steers you to small fast models
- Tab only takes over while a suggestion is visible — vim users keep their indent
- Off by default; session token spend is visible in `/stats`

→ [docs/AUTOCOMPLETE.md](docs/AUTOCOMPLETE.md)

### 🎙️ Voice I/O

- **Speech-to-text** via OpenAI Whisper — click the mic button, talk, transcribed text lands in the chat input
- **Text-to-speech** via browser `speechSynthesis` — speaker button on every assistant message, no API key needed
- **Auto-speak toggle** in the header for hands-free listening
- Markdown is stripped before synthesis so the voice reads naturally

→ [docs/VOICE.md](docs/VOICE.md)

### 🪟 Multi-pane chat

Open another chat as a tab beside the active one, or pop one out into its own OS window. Every pane is a full, independent chat that starts fresh.

- **Open new chat tab** and **Open chat in new window** in the command palette
- Also the always-visible new-tab icon on the pane header, the popout icon (carries that chat into the window), and the pane's "..." menu
- Tabs and windows are titled with their conversation — click the title in the chat header, or the pane menu, to rename
- Per-pane conversation, provider, and model — two models at once with no cross-talk
- Popout windows are desktop-only

→ [docs/MULTIPANE.md](docs/MULTIPANE.md)

### 💬 Chat that gets out of the way

- Terminal-style transcript — your messages echo as `❯` prompt lines, replies type out under the streaming neon caret
- Model picker with capability pills (vision 👁, tools 🔧, context length)
- Per-message hover actions: copy, quote-into-input, save-as-note, insert-into-active-note, regenerate, edit-and-resend
- Conversation history dropdown
- Cross-conversation search (assignable hotkey)

### 🖼️ Image attachments

- **Paste** (`Ctrl+V`), **drag-and-drop**, or **paperclip** — three ways to attach
- Images save as real vault files (not base64 blobs in `localStorage`)
- Vision-capable models see them automatically; non-vision models get a clear "switch to a vision model" notice
- Transcripts via `/save-all` embed images as `![[wikilinks]]`

→ [docs/IMAGES.md](docs/IMAGES.md)

### ✂️ Inline selection actions

Right-click any selection in a note for **Explain · ELI5 · Summarize · TL;DR · Improve · Fix grammar · Shorten · Translate · Make a table · Pros & cons · Code review · Refactor · Add tests**. Each writes the result directly back into the note — replace or insert-below.

→ [docs/SELECTION_ACTIONS.md](docs/SELECTION_ACTIONS.md)

### 🧠 Long-term memory

Curtis remembers durable facts about you across conversations — preferences, identity, projects, standing instructions. Facts live in a markdown file in your vault.

- **Ask before saving**: after each turn the model proposes up to 3 facts — Save/Skip each, nothing persists without your tap
- **Provenance**: every captured fact records the conversation it was learned from; Settings → Memory shows "learned <date> · from <conversation>" with a jump button
- **Memory chips**: assistant replies show how many facts were in context; click to open the list with learned dates and source-conversation links. Removed facts say so instead of showing stale text
- **Manual**: `/remember <fact>` or right-click selection → **Save to memory**
- **Edit UI**: edit/delete individual facts from Settings → Memory
- **Recall**: every prompt includes a `## What you know about the user` block

→ [docs/MEMORY.md](docs/MEMORY.md)

### 📓 Session recaps + Curtis Journal

Close out a working session with a summary you can find later.

- **`/recap`** or Export → **Recap conversation**: 2-3 terse bullets — worked on, decided, left open — appended to the chat and logged to `AI/Curtis Journal.md`
- The journal is plain append-only markdown in your vault, one entry per recap with a link back to the conversation
- **Relevance pulse**: open a note that closely matches a past conversation and a quiet "discussed in …" hint appears under the chat header — click to jump straight back into it. Local similarity over your vault index, no API calls (Settings → Vault retrieval)

### 🔎 Vault retrieval (RAG)

Ask about your vault in plain language — the most relevant note excerpts are retrieved and injected into the prompt automatically.

- **Any embeddings provider** — OpenAI, Gemini, Z.ai, or fully local via Ollama/LM Studio (Anthropic and Azure are excluded — no embeddings API / deployment-specific URL scheme)
- **Automatic injection** — top-k excerpts in every prompt; skipped when you `@`-attach a note, because curated context wins
- **Live index** — edits re-embed in the background; rebuilds are incremental and cheap
- **`semantic_search` tool** — the agent queries the vault by meaning, not just keywords
- **Your index stays yours** — int8-quantized JSON in the plugin folder; nothing uploaded beyond the embeddings provider you configure

Enable in Settings → Vault retrieval, then **Rebuild index**.

### ⌨️ Slash commands

Type `/` in the chat input for an autocomplete menu of 19 commands — `/clear`, `/regen` (alias `/regenerate`), `/title`, `/leader`, `/agent`, `/copy`, `/note`, `/save-all`, `/paste`, `/model`, `/provider`, `/system`, `/stats`, `/remember`, `/forget`, `/memory`, `/recap`, `/export`, `/help`.

→ [docs/SLASH_COMMANDS.md](docs/SLASH_COMMANDS.md)

### ⚙️ Customizable

- Chat panel position (left/right), background (theme default or a wallpaper image from your vault)
- Configurable system prompt, temperature, max tokens — with per-provider and per-model overrides for advanced request parameters
- Enter-to-send (default) or Enter-for-newline
- Auto-save assistant responses to a folder of your choice
- Show or hide token counts after each response

### 🎛️ Advanced request parameters

Every provider card — and each of its models — takes overrides for temperature, max tokens, top-p/top-k/min-p, seed, stop sequences, and penalties, plus a reasoning-effort control mapped to each provider's dialect, an omit-temperature escape hatch for models that reject sampling params, and an "Extra body JSON" passthrough. Fields a provider's API rejects are dropped before the request goes out. Ollama adds hardware knobs — context window, GPU layers, CPU threads, keep-alive — over its native `/api/chat` dialect. Per-model beats per-provider beats the global Generation settings.

→ [docs/PROVIDERS.md](docs/PROVIDERS.md#advanced-request-parameters)

---

## Why Curtis AI

Curtis AI is the **agent layer for Obsidian**. Where other plugins focus on a single workflow (chat, RAG, or text generation), Curtis ships all three with a polyglot provider model and a native Obsidian feel.

| | Curtis AI | Smart Connections | Text Generator | Copilot for Obsidian |
|---|---|---|---|---|
| **All features free (no subscription)** | ✅ | ✅ | ✅ | Core only — advanced features need Copilot Plus |
| **Agent tools (vault-modifying)** | ✅ 11 built-in + MCP | ❌ | ❌ | ✅ v4 agent chat |
| **Semantic vault retrieval (RAG)** | ✅ any embeddings provider | ✅ | ❌ | ✅ |
| **Provider count** | 53 | 1–2 | 1–2 | 10+ |
| **Local-first (Ollama, LM Studio)** | ✅ | ❌ | ✅ | ✅ |
| **Multi-model arena** | ✅ | ❌ | ❌ | ❌ |
| **Inline diff rewrite** | ✅ | ❌ | ❌ | ❌ |
| **Voice I/O** | ✅ | ❌ | ❌ | ❌ |
| **Long-term memory** | ✅ Markdown-file | Vector index | ❌ | ✅ JSON |
| **Native Obsidian rendering** | ✅ `MarkdownRenderer` | Partial | ❌ | Partial |

> [!NOTE]
> Comparison refreshed 2026-10-03. Other plugins ship fast — Copilot's v4 agent chat is real and actively developed, Smart Connections remains the gold standard for RAG (Curtis' own retrieval is new; theirs is battle-tested), Text Generator excels at template-driven writing. Curtis aims to be the free, polyglot, local-first agent layer that ties chat, tools, and memory together.

### Principles

- **Your data stays yours.** Conversations as markdown files in your vault (`AI/Conversations/` by default) — synced across devices, searchable in native Obsidian search, and readable by the agent. Images as real vault files. Memory as a markdown file you can read and edit. No telemetry, no tracking, no phone-home.
- **No vendor lock-in.** Twenty-seven providers ship built-in. Add any OpenAI-compatible endpoint as a custom provider in 30 seconds. Switch models mid-conversation.
- **Local-first when you need it.** Enable Ollama and nothing ever leaves your machine. Useful for private notes, air-gapped machines, or when you just don't want to pay per token.
- **Native Obsidian feel.** Real Obsidian setting components. Messages render through `MarkdownRenderer`. Themes respected — light, dark, Things, Minimal, all of them.

---

## Configuration

Full configuration reference lives in the docs:

- [Providers (API keys, endpoints, custom providers)](docs/PROVIDERS.md)
- [Slash commands](docs/SLASH_COMMANDS.md)
- [Memory](docs/MEMORY.md)
- [Curtis Agent](docs/AGENT.md)
- [Voice I/O](docs/VOICE.md)
- [Image attachments](docs/IMAGES.md)
- [Selection actions](docs/SELECTION_ACTIONS.md)
- [@-mentions](docs/MENTIONS.md)
- [Inline diff rewrite](docs/DIFF_REWRITE.md)
- [Inline autocomplete](docs/AUTOCOMPLETE.md)
- [Multi-model arena](docs/ARENA.md)

Or start at the [docs index](docs/INDEX.md).

---

## Privacy & security

Curtis AI accesses your vault files only in user-initiated cases:

1. **Agent vault-search tool** — when you explicitly invoke a tool in chat, the plugin enumerates markdown files. The agent sees file paths and contents you ask it to read.
2. **Image picker** — when you click the paperclip, the plugin lists image files.
3. **Folder picker** — when you configure auto-save or wallpaper folders.
4. **@-mention autocomplete** — when you type `@`, the plugin fuzzy-searches note names. Note contents are only read when you actually attach and send.

No file contents are sent to AI providers except message text, attached images, attached note contents, and tool-call results. API keys are stored in your OS keychain (Windows Credential Manager / macOS Keychain / Linux Secret Service), never in the vault.

**Clipboard:** the plugin reads the system clipboard only when you paste into the chat input (Ctrl+V / long-press → Paste), and writes to it only when you click copy on a message. Nothing is read from or written to the clipboard in the background.

> [!IMPORTANT]
> Tool calls go to your AI provider. Vault contents read by agent tools are sent to the provider as part of the conversation. If you're on a cloud provider, that content leaves your machine. Switch to Ollama for fully offline operation.

### Network access

Curtis is vault-first — no background telemetry, no analytics, no auto-update checks. Every outbound request is user-initiated. The plugin may contact these domains:

| When | Domain | Why |
|------|--------|-----|
| You send a message (cloud providers) | Your provider's API (e.g. `api.anthropic.com`, `api.openai.com`, `generativelanguage.googleapis.com`) | Chat completion / streaming |
| Vault retrieval builds or queries the index (opt-in) | Your embeddings provider's API | Note chunks and queries are sent for embedding |
| You send a message (Ollama / LM Studio) | `localhost` / your custom endpoint | Local model inference |
| You click "Test connection" or "Refresh models" | Your provider's API | Auth + reachability check, model list |
| You use voice transcription | `api.openai.com` | Whisper API (only when voice input is on) |
| The agent calls `web_search` (opt-in) | `html.duckduckgo.com` | DuckDuckGo search |
| The agent calls `read_url` (opt-in) | `r.jina.ai` | URL → markdown reader |
| The agent calls MCP tools (opt-in) | your own MCP servers | User-configured endpoints (Settings → MCP servers) |

The two web tools (`web_search`, `read_url`), voice transcription, MCP, and vault retrieval are off by default. Without them, the only external calls are to whichever AI provider you configured — or none, if you're on Ollama. MCP tool calls go only to the server URLs you entered; tool results travel through your AI provider like any other tool result.

---

## Installation

> [!TIP]
> Curtis AI is in the [community plugin directory](https://community.obsidian.md/plugins/curtis-ai-chat). Install from there, manually (below), or via [BRAT](https://github.com/TfTHacker/obsidian42-brat) for beta-channel updates.

### Manual install

1. Download the [latest release](../../releases) `main.js`, `manifest.json`, and `styles.css`.
2. In your vault, create `.obsidian/plugins/curtis-ai-chat/`.
3. Copy the three files into that folder.
4. Open **Settings → Community plugins**, refresh the list, enable **Curtis AI**.

### From source (developers)

```bash
git clone https://github.com/JordanNewell/curtis-ai-chat.git
cd curtis-ai-chat
npm install
npm run build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup, code style, and the audit checklist.

---

## Mobile

Curtis AI works on iOS and Android with a few caveats:

- Hover-only elements (per-message toolbar, code-block copy) are always visible on touch at reduced opacity
- Touch targets sized to Apple HIG minimums (44pt send button, 40pt header icons)
- Wallpaper background auto-disabled on phones for scroll performance
- `/paste` may fail if the OS blocks clipboard read — use `Ctrl+V` / long-press → Paste
- Streaming falls back to buffered responses automatically when a provider blocks mobile CORS
- Local providers work over LAN (`http://192.168.1.50:11434/api/chat`)

---

## Roadmap

- [x] Curtis Agent: Anthropic, Gemini, and Ollama provider support (v1.1)
- [ ] Inline diff rewrite: word-level diff and inline editor decorations
- [x] Settings: declarative `getSettingDefinitions()` — shipped in v1.2.0 (see [ADR: settings API](#settings-api))
- [x] Vault retrieval (RAG): embedding index over the vault, auto-injected context, `semantic_search` agent tool (v1.4.0)
- [x] MCP client: connect external MCP servers, their tools join the agent toolset (v1.4.0)
- [x] Conversations as vault markdown files with automatic localStorage import (v1.4.0)
- [x] Named agents + swarm mode: persona/model-routing/tool-ceiling workers, leader chats spawning follower agents (v2.0.0)
- [x] Terminal pane + opt-in `run_command` agent tool with per-command approval (v2.0.0)
- [x] Scheduled runs: a prompt or agent on a daily/interval cadence, headless, results as notes (v2.0.0)
- [x] MCP server mode: serve the vault and your agents to external AI apps on localhost (v2.0.0)
- [x] Public plugin API for other Obsidian plugins (v2.0.0)
- [x] GCP connector: read-only Cloud Storage as agent tools (v2.0.0)
- [x] Inline autocomplete: ghost text in any note, off by default (v2.0.0)
- [x] Voice settings: persisted voice/rate/pitch, karaoke highlight, auto-speak (v2.0.0)
- [x] Desktop notifications when a response finishes or fails (v2.0.0)
- [ ] Voice: streaming TTS, wake-word detection
- [ ] Conversation branching UI
- [ ] Plugin settings import/export
- [ ] Semantic memory retrieval via sqlite-vec (when memory exceeds ~150 facts)

See the [open issues](../../issues) for the live list.

---

## Contributing

PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup, code style, and the audit checklist every change goes through before merge.

> [!NOTE]
> Not accepting external PRs yet while the v1 line stabilizes. Bug reports and feature requests via [Issues](../../issues) are very welcome.

## Architecture decisions

### Settings API

Since v1.2.0 Curtis targets Obsidian **1.13.0+** and uses the **declarative `getSettingDefinitions()` API** for its settings tab. Every section and row is indexed by Obsidian's settings search; dynamic re-renders go through the sanctioned `SettingTab.update()`.

History: through v1.1.x the floor was 1.11.4 (set by the `SecretStorage` API for per-provider key storage) and the tab used the imperative `display()` API, which Obsidian 1.13 deprecated. The dual-path (`getSettingDefinitions()` + `display()` fallback) was evaluated and rejected — the declarative path's `SettingTab.update()` is 1.13-only, so supporting both meant either shipping a broken tab on older versions or tripping the `no-unsupported-api` lint rule. When Obsidian 1.13.6 reached the stable channel for all desktop and mobile users (August 2026), the migration shipped as v1.2.0: a single declarative path, zero deprecation warnings, and settings search that actually finds things.

## 💬 Feedback

All feedback is public and lives on GitHub:

- **Bug found?** [Open an issue](https://github.com/JordanNewell/curtis-ai-chat/issues)
- **Feature idea?** [Start a discussion](https://github.com/JordanNewell/curtis-ai-chat/discussions/categories/ideas)
- **Love it?** [Share in Show & Tell](https://github.com/JordanNewell/curtis-ai-chat/discussions/categories/show-and-tell)
- **Stuck?** [Ask in Q&A](https://github.com/JordanNewell/curtis-ai-chat/discussions/categories/q-a)

No GitHub account? Email [hello@jordannewell.com](mailto:hello@jordannewell.com) and it gets posted publicly for you.

---

## License

[MIT](LICENSE) © Jordan Newell. MIT for the code. The Curtis name and logo are trademarks of Jordan Newell.

<p align="right">
  <a href="https://jordannewell.com" title="Built by Jordan Newell">
    <img src="https://raw.githubusercontent.com/JordanNewell/curtis-ai-chat/master/assets/newell-badge.png" alt="Built by Jordan Newell" width="48" height="48">
  </a>
</p>