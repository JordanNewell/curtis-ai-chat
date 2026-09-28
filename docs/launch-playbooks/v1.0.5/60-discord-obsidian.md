# Obsidian Discord — announcement

**Use:** [Obsidian Discord](https://discord.gg/obsidian-md), `#plugins` channel (check pinned messages for channel conventions before posting; if `#plugins` is read-only for announcements, use the channel the pins direct you to).

**Etiquette:** one message, one channel. No cross-posting. Stick around for replies.

---

## Message

v1.0.5 of Curtis AI Chat is out — local AI on mobile is fixed. Ollama and LM Studio providers no longer ask for an API key on iOS/Android (they never needed one; the mobile settings flow demanded it anyway and blocked saving). Run the model on your desktop, point the app at it over LAN (`http://<desktop-ip>:11434/v1/chat/completions`), chat against your own model with no key and no cloud. Also in this release: routine CI/dependency maintenance.

If you're new to it: Curtis AI Chat is a polyglot AI chat sidebar — 30+ providers (Anthropic, OpenAI, Gemini, OpenRouter, Groq, DeepSeek, ~24 more OpenAI-compat), agent mode with nine vault tools, multi-model arena, inline diff rewrite, @-mentions, voice I/O, and long-term memory stored as a markdown file in your vault. MIT, no telemetry, API keys in the OS keychain.

Repo: https://github.com/JordanNewell/curtis-ai-chat
Directory: https://community.obsidian.md/plugins/curtis-ai-chat

Bug reports and feature requests → GitHub Issues. Happy to answer questions here.

---

## Author notes

- If someone reported the mobile key-prompt bug in Discord earlier, reply to them directly first, then post the general announcement.
- Keep it to this one message; detail questions go to threads under it, not to a second post in another channel.
