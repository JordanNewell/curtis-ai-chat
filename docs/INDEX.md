# Curtis AI Chat docs

Reference documentation for every feature. Start here, follow links to the detail you need.

> [!TIP]
> New to the plugin? The [README](../README.md#quick-start) has a 60-second quick start. Come back here when you need the details.

## Features

| Doc | What it covers |
|---|---|
| 🤖 **[AGENT.md](AGENT.md)** | Curtis Agent — AI tools that read, create, edit vault notes. Nine built-in tools, OpenAI-compat providers. |
| ⚔️ **[ARENA.md](ARENA.md)** | Multi-model arena — stream one prompt to 2–5 models in parallel. Promote-to-chat workflow. |
| 🎨 **[DIFF_REWRITE.md](DIFF_REWRITE.md)** | Inline diff rewrite — Cursor-style Accept/Reject diff modal. `Ctrl+Shift+R`. |
| 🎙️ **[VOICE.md](VOICE.md)** | Voice I/O — Whisper STT + browser TTS. Auto-speak toggle. |
| @ **[MENTIONS.md](MENTIONS.md)** | `@`-mention vault notes — fuzzy-search, attach as context. Active-note pill. |
| 🖼️ **[IMAGES.md](IMAGES.md)** | Image attachments — paste, drag, or paperclip. Vision-capable models. |
| 🧠 **[MEMORY.md](MEMORY.md)** | Long-term memory — markdown-file-backed. Auto-capture, manual recall, edit UI. |
| ✂️ **[SELECTION_ACTIONS.md](SELECTION_ACTIONS.md)** | Inline note transformations — explain, summarize, refactor, etc. Right-click in any note. |
| ⌨️ **[SLASH_COMMANDS.md](SLASH_COMMANDS.md)** | 16 slash commands — `/clear`, `/regen`, `/model`, `/memory`, `/export`, etc. |

## Configuration

| Doc | What it covers |
|---|---|
| 🔌 **[PROVIDERS.md](PROVIDERS.md)** | 30+ built-in providers, custom endpoints, per-provider auth and quirks. Agent compatibility column. |

## Project

| Doc | What it covers |
|---|---|
| 📦 **[README](../README.md)** | Overview, install, quick start, feature summary, mobile notes. |
| 📝 **[CHANGELOG](../CHANGELOG.md)** | All notable changes per release. Keep-a-Changelog format. |
| 🛠️ **[CONTRIBUTING](../CONTRIBUTING.md)** | Dev setup, project structure, code style, audit checklist, how to add providers/tools/commands. |
| 💸 **[MONETIZATION](MONETIZATION.md)** | Strategy: plugin stays free, adjacent products fund the line. Triggers, timeline, what charges. |
| ⚖️ **[LICENSE](../LICENSE)** | MIT. |

## By use case

**"I want to chat with my notes."**
→ [MENTIONS.md](MENTIONS.md) for `@`-attaching notes, [AGENT.md](AGENT.md) for vault-modifying tools

**"I want to compare models."**
→ [ARENA.md](ARENA.md) for parallel streaming, [PROVIDERS.md](PROVIDERS.md) for the full provider list

**"I want AI to edit my writing."**
→ [DIFF_REWRITE.md](DIFF_REWRITE.md) for diff-reviewed rewrites, [SELECTION_ACTIONS.md](SELECTION_ACTIONS.md) for direct-write transformations

**"I want fully offline AI."**
→ [PROVIDERS.md](PROVIDERS.md#local-providers-ollama-lm-studio) for Ollama / LM Studio setup

**"I want voice input/output."**
→ [VOICE.md](VOICE.md)

**"I want Curtis to remember things about me."**
→ [MEMORY.md](MEMORY.md)

**"I'm developing the plugin."**
→ [CONTRIBUTING.md](../CONTRIBUTING.md)
