# Reddit — r/ObsidianMD post

**Use:** Post to https://www.reddit.com/r/ObsidianMD/submit. Best window: Tue–Thu morning US time. Use your own Reddit account.

**Flair:** "Showcase" or "Plugin Release" if the sub offers it on submit.

---

## Title (≤300 chars, Reddit allows 300)

```
Curtis AI Chat v1.0.0 — 30+ AI providers, agent tools, voice I/O, multi-model arena (free, open source, MIT)
```

## Body

Hey r/ObsidianMD — author here. Just shipped v1.0.0 of Curtis AI Chat and wanted to share since it's a big one: eight new features, full rebrand, type-safety overhaul.

**Repo:** https://github.com/JordanNewell/curtis-ai-chat
**License:** MIT, no telemetry, no SaaS, no account
**Install:** community plugin directory (v4 review pending), manual, or BRAT

# What Curtis AI Chat is

A polyglot AI chat sidebar for Obsidian. 30+ providers ship built-in — Anthropic, OpenAI, Gemini, Ollama, OpenRouter, Groq, Together, DeepSeek, Cerebras, SambaNova, and 20+ more. Any OpenAI-compatible endpoint can be added as a custom provider. Switch models mid-conversation. Same conversation history follows you across providers.

Local-first via Ollama if you don't want anything to leave your machine.

# What's new in v1.0.0

Eight flagship features:

- **Curtis Agent** — AI calls nine built-in tools to read/create/edit your vault notes (`read_note`, `search_notes`, `create_note`, `edit_note`, `list_notes`, `get_tags`, `get_backlinks`, `get_current_note`, `calculator`). Opt-in via Settings → Agent.
- **Multi-model arena** — pick 2–5 models, send one prompt, stream responses side-by-side. Promote any column to main chat.
- **Inline diff rewrite** — select any text → Ctrl+Shift+R → AI generates improved version → green/red diff modal with Accept/Reject.
- **@-mention vault notes** — type `@`, fuzzy-search your vault, attach note content as context. The active note also gets a one-click pill in the chat header.
- **Voice I/O** — mic button (Whisper STT), speaker button on every assistant message (browser TTS, no API key), auto-speak toggle in header.
- **Cross-conversation search** — Ctrl+Shift+F fuzzy picker across all conversations.
- **Markdown export** — `/export` slash command or download icon.
- **Memory editing UI** — edit/delete individual memory facts from Settings → Memory.

Plus a full type-safety pass (no `any` at provider boundaries) and Sigstore build-provenance attestations on every release asset.

# How it compares

I get asked this a lot so here's an honest table:

| Feature | Curtis AI Chat | Smart Connections | Text Generator | Copilot for Obsidian |
|---|---|---|---|---|
| Agent tools (vault-modifying) | 9 built-in | — | — | Partial |
| Provider count | 30+ | 1–2 | 1–2 | 5–10 |
| Local-first (Ollama, LM Studio) | yes | — | yes | yes |
| Multi-model arena | yes | — | — | — |
| Inline diff rewrite | yes | — | — | — |
| Voice I/O | yes | — | — | — |
| Long-term memory | markdown file | vector index | — | JSON |
| Native Obsidian rendering | yes | partial | — | partial |

Smart Connections is still the gold standard for RAG. Text Generator is excellent for template-driven writing. Copilot is great out-of-the-box. Curtis aims to be the agent layer that ties chat, tools, and memory together — not a replacement for any of the above.

# Heads-up if you're on v3

Plugin ID changed from `curtis` to `curtis-ai-chat`. v3 installs need to reinstall — the ID change is not auto-migratable. Conversation history keyed under the old ID won't carry over (I took the breaking change rather than carry legacy indefinitely). API keys live in the OS keychain per-provider, so they'll need to be re-entered once under the new plugin's settings.

# Privacy

Vault access is user-initiated only: agent tools when you invoke them, image picker when you click the paperclip, folder picker when you configure auto-save/wallpaper, @-mention when you type `@`. No file contents are sent anywhere except message text you send, images you attach, and note contents you explicitly reference. API keys in OS keychain. No telemetry, no tracking, no phone-home.

Tool calls do go to your AI provider — if you're on a cloud provider, vault contents read by agent tools leave your machine. Switch to Ollama for fully offline operation.

# Install

**BRAT (beta channel):** Install [BRAT](https://github.com/TfTHacker/obsidian42-brat), BRAT settings → Add Beta plugin → `JordanNewell/curtis-ai-chat`.

**Manual:** Download `main.js`, `manifest.json`, `styles.css` from the [latest release](https://github.com/JordanNewell/curtis-ai-chat/releases/latest), drop them in `<vault>/.obsidian/plugins/curtis-ai-chat/`, enable under Community plugins.

**Community directory:** Listed at community.obsidian.md/plugins/curtis-ai-chat — v1.0.0 submission is in review.

Roadmap, full changelog, and source at the repo. Happy to answer questions or take feature requests in the comments.
