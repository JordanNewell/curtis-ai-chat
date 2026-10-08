# Forum post — Obsidian Forum, "Share & showcase"

**Suggested title:** Curtis AI Chat — bring-your-own-keys AI chat, 30+ providers, two-model arena (free, MIT)

**Category:** Share & showcase
**Images:** drag the files referenced below straight into the Discourse editor (paths are relative to the repo root). The GIF is ~0.9 MB, fine for a direct upload.

---

I kept a ChatGPT tab, a Claude tab, and a Gemini tab open to compare answers on the same prompt, then copied the best one back into my notes. That copy-paste loop is why I built Curtis AI Chat.

It's a bring-your-own-key AI chat that lives in an Obsidian sidebar. Thirty providers are built in — Anthropic, OpenAI, Gemini, OpenRouter, Ollama, LM Studio, Groq, DeepSeek, xAI and more — plus any OpenAI-compatible endpoint as a custom provider. You paste your own API keys (they go into your OS keychain, not the vault), so there's no subscription and no account. MIT licensed.

The arena is the part I use most. Pick two models, send one prompt, and both answers stream side by side. There's a Stop button per column, and **Promote to chat** turns the winner into a normal conversation with that model.

**[drag in: `assets/demo-arena-cloud-vs-cloud.gif`]**
*Same prompt through two APIs — Gemini via OpenRouter vs DeepSeek. Stop one column, promote the winner.*

Since this crowd in particular tends to care about local models: Ollama and LM Studio are first-class providers. Point Curtis at `localhost` and nothing leaves your machine — no API key, no network. Vault retrieval (semantic search over your notes) can also run its embeddings through Ollama, so the whole loop can stay offline.

The rest, briefly:

- **Agent mode** (opt-in) — reads, creates, and edits notes with 11 built-in tools; connects to MCP servers you already run
- **Vault-aware chat** — `@`-mention any note as context, semantic vault retrieval, every conversation saved as a markdown note in your vault (synced, searchable, agent-readable)
- **Inline diff rewrite** — select text, rewrite with AI, review a line-by-line diff, accept or reject
- **Voice** — Whisper speech-to-text on the mic button (uses your OpenAI key), browser text-to-speech on every reply (no key)
- **Memory** — the model proposes facts after a turn; nothing is saved until you tap Save or Skip
- **Chat import** (new in 2.0) — bring your ChatGPT or Claude data export in and continue the conversation here; portable `.curt` files move a chat between machines
- **Images, 17 slash commands, cross-conversation search**, and it works on mobile

Under the hood it's TypeScript bundled with esbuild, messages rendered through Obsidian's own `MarkdownRenderer`, and it inherits your theme. No telemetry — every outbound request is one you triggered, and the README lists every domain it can contact.

- Plugin page: https://obsidian.md/plugins/curtis-ai-chat
- GitHub: https://github.com/JordanNewell/curtis-ai-chat
- Docs: https://jordannewell.github.io/curtis-ai-chat
- During the beta you can also install via BRAT for auto-updates.

I'm the developer and I'd genuinely like feedback — especially from Ollama/LM Studio users, since that's how I run it too. What's missing before this replaces your vendor app for good? Bug reports and feature ideas in GitHub Issues/Discussions, or right here in the thread.
