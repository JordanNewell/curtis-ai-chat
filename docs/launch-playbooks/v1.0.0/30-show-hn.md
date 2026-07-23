# Show HN — Hacker News submission

**Use:** Post to https://news.ycombinator.com/submit (or use `hn` CLI). Best window: Tue–Thu 7:30–9:30am PT (pre-US-east-coast-coffee to post-US-west-coast-coffee). Avoid Friday afternoon, weekend, Monday morning.

**Account:** post from your own HN handle (NOT dev23xyz-oss).

---

## Title (≤80 chars)

```
Show HN: Curtis AI Chat – 30+ AI providers, agent tools, and voice in Obsidian
```

Alternates if first choice is taken or feels off:
- `Show HN: Curtis AI Chat – an agent layer for Obsidian (30+ LLM providers, MIT)`
- `Show HN: I built a polyglot AI chat plugin for Obsidian with 30+ providers`

## URL

```
https://github.com/JordanNewell/curtis-ai-chat
```

(Leave the URL field as the repo. The first comment is the body, below.)

---

## First comment (the "show" text)

Hi HN — Jordan here, sole author. Curtis AI Chat is a free MIT-licensed AI chat plugin for Obsidian with 30+ providers supported out of the box: Anthropic, OpenAI, Gemini, Ollama, OpenRouter, Groq, Together, DeepSeek, Mistral, Cohere, Cerebras, SambaNova, and about 18 more OpenAI-compatible endpoints. You can also add any custom OpenAI-compatible endpoint in 30 seconds.

The v1.0.0 release ships eight features I needed and couldn't get from a single plugin:

1. **Curtis Agent** — the AI calls nine built-in tools to read, create, and edit notes in your vault. `read_note`, `search_notes`, `create_note`, `edit_note`, `list_notes`, `get_tags`, `get_backlinks`, `get_current_note`, `calculator`. Opt-in only.
2. **Multi-model arena** — pick 2–5 models, send one prompt, watch responses stream side-by-side. Promote any column to main chat. Useful for "which of these is least wrong about my code".
3. **Inline diff rewrite** — select any text in a note, hit Ctrl+Shift+R, the AI generates an improved version and shows a green/red diff modal. Cursor-style.
4. **@-mention vault notes** — type `@`, fuzzy-search your vault, attach note content as context.
5. **Voice I/O** — Whisper STT on the mic button, browser `speechSynthesis` TTS on every assistant reply.
6. **Cross-conversation search** — Ctrl+Shift+F fuzzy picker across all conversations.
7. **Markdown export** — `/export` slash command or download icon.
8. **Memory editing UI** — durable facts about you stored in a markdown file you can read and edit; now also editable from Settings.

**Why I built it:** every existing Obsidian AI plugin I tried nailed one workflow — chat, RAG, or templates. I wanted all three in one sidebar, with a provider model that doesn't lock me in. Curtis is the result. Local-first via Ollama if you don't want anything to leave your machine; cloud providers if you want frontier models; same plugin, same vault, same conversation history.

**Type-safety:** v1.0.0 also wipes out every `any` in the provider code. Every external JSON response shape (OpenAI, Anthropic, Gemini, Ollama, plus the ~24 OpenAI-compat derivatives) is fully typed, and narrowing happens at the boundary via type guards. Zero lint warnings. Boring on paper; the difference between shipping fixes at 2am and not.

**Build provenance:** release assets (`main.js`, `manifest.json`, `styles.css`) each get a Sigstore attestation from GitHub Actions. `gh attestation verify main.js --repo JordanNewell/curtis-ai-chat` confirms what you install was built from public source.

**Install:** community plugin directory (review pending for v4), manual download from releases, or via BRAT for beta channel. README has the recipes.

**Honest tradeoffs:**

- v1.0.0 changes the plugin ID from `curtis` to `curtis-ai-chat`. Existing v3 installs need to reinstall; conversation history is keyed under the old ID and will not carry over. I took the breaking change rather than ship two more years of legacy.
- Agent mode is OpenAI-compatible providers only for v1.0.0. Anthropic/Gemini/Ollama agent support is written but needs more soak time — lands in v4.1.0.
- No semantic RAG. Memory is plain markdown facts (durable, editable, portable). SQLite-vec retrieval is on the roadmap once memory exceeds ~150 facts per user.
- Not accepting external PRs yet while v4 stabilizes. Bug reports and feature requests welcome.

MIT, no telemetry, no account, no SaaS. Source: https://github.com/JordanNewell/curtis-ai-chat

Happy to answer anything.
