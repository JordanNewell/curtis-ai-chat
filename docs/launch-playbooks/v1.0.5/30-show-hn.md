# Show HN — Hacker News submission

**Use:** https://news.ycombinator.com/submit. Best window: Tue–Thu 7:30–9:30am PT. Post from the author's own handle.

**Pre-check:** only submit if no Show HN has run for Curtis AI Chat before. If one has, do not resubmit — HN penalizes repeat Show HNs for the same project. Instead, post the "what changed" paragraph below as a comment in the original thread and answer any new questions there.

**HN norms the draft follows:** short and factual, no marketing superlatives, limitations stated plainly, author stays in the thread and answers comments for the first few hours.

---

## Title (71 chars, limit 80)

```
Show HN: Curtis AI Chat – private AI chat and vault agents for Obsidian
```

Alternates:

- `Show HN: Curtis AI Chat – 30+ providers and vault agents for Obsidian` (69)
- `Show HN: Curtis AI Chat – AI chat for Obsidian that can run fully local` (71)
- `Show HN: I put 30 AI providers and a vault agent inside Obsidian` (64)

Pick the first unless a link-only title reads better on the day; the third works if the personal angle fits the author's comment style.

## URL

```
https://github.com/JordanNewell/curtis-ai-chat
```

Leave the text field empty. The first comment is the body.

---

## First comment (the "show" text)

Hi HN — Jordan here, sole author. Curtis AI Chat is a free, MIT-licensed AI chat plugin for Obsidian. Thirty-plus providers built in — OpenAI, Anthropic, Gemini, OpenRouter, Groq, DeepSeek, and about 24 more OpenAI-compatible endpoints — plus any custom endpoint you point it at.

The release that just went out (1.0.5) fixes the local path on mobile: Ollama and LM Studio providers no longer ask for an API key. They never needed one — local servers have no keys — but the mobile settings flow demanded one before a local provider could be saved, which quietly made fully-offline chat a desktop-only feature. Now the setup is: run the model on your desktop, put the phone on the same network, point the plugin at `http://<desktop-ip>:11434/v1/chat/completions`, and chat against your own model. No key, no cloud, nothing leaves the LAN.

The rest of the plugin, briefly:

- Agent mode — nine tools the model can call to read, create, and edit notes in your vault (`read_note`, `search_notes`, `create_note`, `edit_note`, `list_notes`, `get_tags`, `get_backlinks`, `get_current_note`, `calculator`). Opt-in, turn-capped.
- Multi-model arena — one prompt, 2–5 models streaming side by side; promote the winner to the main chat.
- Inline diff rewrite — select text in a note, get an improved version in a green/red accept-reject modal.
- @-mentions — type `@`, fuzzy-search the vault, attach notes as context.
- Voice I/O — Whisper speech-to-text on the mic, browser TTS on replies.
- Long-term memory — durable facts about you in a plain markdown file inside the vault, human-editable, injected into each prompt.

Privacy posture: no telemetry, no account, no SaaS. Conversations stay in local storage; images are saved as real vault files; memory is a markdown file you can open and edit; API keys go into the OS keychain, never the vault. On Ollama, nothing leaves the machine at all.

Honest limitations: agent mode currently works on OpenAI-compatible providers only (Anthropic/Gemini/Ollama agent support is next); memory is plain markdown facts, not vector RAG; streaming can degrade to buffered responses on some providers on mobile due to CORS.

Obsidian 1.11.4+, MIT. Source and install instructions: https://github.com/JordanNewell/curtis-ai-chat

Happy to answer anything.

---

## Author notes for the thread

- **TODO(author):** If a personal "why I built this" anecdote comes up, add one short paragraph — HN responds to origin stories. Keep it under five sentences.
- Expect the recurring HN questions, and answer from the repo facts: where keys live (OS keychain via Obsidian SecretStorage), whether it phones home (no; README has a full table of every domain contacted), why not a standalone app (the vault is the data model), and provider lock-in (switch models mid-conversation; any OpenAI-compat endpoint in 30 seconds).
- Do not edit the title after submission; reply in threads instead.
- If the thread goes quiet, do not bump it. One substantive follow-up comment per topic is plenty.
