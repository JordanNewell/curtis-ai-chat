# Reddit — r/ObsidianMD post

**Use:** https://www.reddit.com/r/ObsidianMD/submit. Best window: Tue–Thu morning US time. Author's own account.

**Self-promo norms for r/ObsidianMD:** plugin releases are welcome but should be flaired, posted at most around each meaningful release (this is the first since 1.0.0's run — fine), and the author must actually engage in the comments. Never delete critical comments; answer them. Include the repo and license up front so it doesn't read as an ad.

**Do not post until both screenshots are captured.** Text-only release posts underperform hard on this sub.

---

## Title (119 chars, limit 300)

```
Curtis AI Chat v1.0.5 — local AI (Ollama / LM Studio) now works on mobile, no API-key prompts [free & open source, MIT]
```

## Body

Hey r/ObsidianMD — author here. v1.0.5 is a small release, but it unblocks the thing I get asked about most: fully local AI on mobile.

**The fix:** local providers (Ollama, LM Studio) no longer require an API key on mobile. Previously the mobile settings flow demanded a key before you could save a local provider — and local servers have no keys — so the offline path was effectively desktop-only. The requirement is now gone on every platform.

The setup that works end to end as of this release:

1. Desktop: `ollama serve` (or LM Studio's local server)
2. Phone on the same network
3. Curtis on mobile: enable Ollama, base URL `http://<desktop-ip>:11434/v1/chat/completions`
4. Chat — nothing leaves your LAN

**Screenshots (captured — in `assets/screenshots/`):**

- `desktop-chat.png` — full desktop window: vault with daily note open, chat sidebar running the seeded agent conversation (Ollama + qwen2.5, tool call + result visible, token count).
- `chat-panel.png` — tight 300×760 crop of the chat panel alone; good as the hero image.
- `desktop-settings-providers.png` — settings on the Provider configuration section.
- `ollama-provider-settings.png` — the Ollama provider section: enabled toggle, **no API key field by design**.

<!-- TODO(author): the two on-a-phone shots still need a real device —
     1. [SCREENSHOT: phone: provider settings showing Ollama enabled with no key field]
     2. [SCREENSHOT: phone: chat running against the local model, model name visible in the header]
     30 seconds each with the phone on the same LAN as a desktop running Ollama/LM Studio. -->

If you hit the key prompt before and gave up on local mobile — that's this bug. Update and it should save clean.

**What Curtis AI Chat is, if you haven't seen it:** a polyglot AI chat sidebar for Obsidian. 30+ providers built in (Anthropic, OpenAI, Gemini, OpenRouter, Groq, DeepSeek, and ~24 more OpenAI-compat endpoints), any custom OpenAI-compatible endpoint addable in 30 seconds, models switchable mid-conversation. On top of the chat:

- **Agent mode** — nine built-in tools that read/create/edit vault notes (`read_note`, `search_notes`, `create_note`, `edit_note`, `list_notes`, `get_tags`, `get_backlinks`, `get_current_note`, `calculator`). Opt-in via Settings → Agent.
- **Multi-model arena** — one prompt, 2–5 models streaming side by side; promote any column to the main chat.
- **Inline diff rewrite** — select text, get an improved version in a green/red Accept/Reject modal.
- **@-mentions** — type `@`, fuzzy-search the vault, attach note content as context; active note is a one-click pill in the header.
- **Voice I/O** — Whisper STT on the mic, browser TTS on replies.
- **Long-term memory** — durable facts in a markdown file in your vault, editable from Settings and by hand.

**Privacy:** no telemetry, no account. Vault access is user-initiated only (agent tool calls you make, image picker, folder picker, @-mentions). API keys live in the OS keychain, not the vault. On Ollama/LM Studio, no data leaves your machine. Full domain-by-domain network table in the README.

**Install:**

- Community directory: https://community.obsidian.md/plugins/curtis-ai-chat
- Manual: `main.js`, `manifest.json`, `styles.css` from the [latest release](https://github.com/JordanNewell/curtis-ai-chat/releases/latest) into `<vault>/.obsidian/plugins/curtis-ai-chat/`
- BRAT: `JordanNewell/curtis-ai-chat`

**Links:** [repo](https://github.com/JordanNewell/curtis-ai-chat) · [site](https://jordannewell.github.io/curtis-ai-chat/) · [changelog](https://github.com/JordanNewell/curtis-ai-chat/blob/master/CHANGELOG.md)

v1.0.5 also carries routine CI/dependency maintenance — nothing user-visible beyond the fix above. Full history in the changelog. Happy to answer questions here; bug reports and feature requests go to GitHub Issues.

---

## Author notes for the thread

- **TODO(author):** if there is a real anecdote (e.g., trying to use local AI from a phone on the couch and hitting the key wall), open the post with it in one or two sentences. First-person stories outperform feature lists on this sub.
- Likely top questions — prepare answers: "Does the agent work with Ollama?" (chat yes; agent tools are OpenAI-compat providers only for now, next release), "Why not just use Copilot/Smart Connections?" (different jobs; README has the comparison table — link it, don't paste it all; if pressed: Curtis has no paid tier — every feature works with your own keys, no Copilot-Plus-style subscription — and the multi-model arena doesn't exist anywhere else), "Battery/data usage of LAN calls?" (plain HTTP requests to your desktop; no more than any chat use).
- Scoop angle for comments: anyone mentioning BMO Chatbot (last release July 2024, effectively abandoned) can be told Curtis is actively maintained, does local-first chat, and is MIT — keep it respectful, no trashing.
- Reply to every substantive comment in the first 3–4 hours; the sub's algorithm and norms both reward it.
