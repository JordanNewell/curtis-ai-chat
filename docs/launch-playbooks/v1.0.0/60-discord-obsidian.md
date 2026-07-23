# Obsidian Discord — announce message

**Use:** Post to the [Obsidian Discord](https://discord.gg/obsidian-md) in `#showcase` (if it exists) or `#general`. Check pinned messages first for showcase conventions; some servers want a specific format.

**Etiquette:** Don't cross-post to multiple channels. One message, the right channel, then engage with replies.

---

## Message

Hey all — sharing v1.0.0 of my plugin Curtis AI Chat, just shipped today.

**Repo:** https://github.com/JordanNewell/curtis-ai-chat
**License:** MIT, no telemetry
**Install:** community directory (v4 review pending), manual, or BRAT (`JordanNewell/curtis-ai-chat`)

It's a polyglot AI chat sidebar — 30+ providers built in (Anthropic, OpenAI, Gemini, Ollama, OpenRouter, Groq, Together, DeepSeek, Cerebras, SambaNova, plus ~20 more OpenAI-compat endpoints). Any custom OpenAI-compat endpoint also works.

**v1.0.0 ships:**

- **Curtis Agent** — AI calls tools to read/create/edit your vault notes. Nine built-ins. Opt-in.
- **Multi-model arena** — 2–5 models, one prompt, side-by-side streaming.
- **Inline diff rewrite** — select text → Ctrl+Shift+R → green/red diff modal.
- **@-mention vault notes** — type `@`, fuzzy-search, attach.
- **Voice I/O** — Whisper STT + browser TTS.
- **Cross-conversation search** — Ctrl+Shift+F.
- **Markdown export** — `/export`.
- **Memory editing UI** — edit/delete facts from Settings.

**Heads up if you were on v3:** plugin ID changed `curtis` → `curtis-ai-chat`. v3 installs need a fresh install; history keyed under the old ID doesn't carry. Took the breaking change rather than carry legacy.

**Local-first:** Ollama support means nothing leaves your machine if you don't want it to.

**Privacy:** all vault access is user-initiated (agent tool invocation, image picker, folder picker, @-mention). API keys in OS keychain. No telemetry.

Comparison vs Smart Connections / Text Generator / Copilot in the README — not trying to replace any of them, just filling the "agent layer that ties chat + tools + memory together" gap.

Happy to answer questions here or in GitHub Issues. Roadmap and full changelog at the repo.
