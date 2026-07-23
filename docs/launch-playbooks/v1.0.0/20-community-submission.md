# community.obsidian.md Submission Update

**Use:** Text to paste into the [community plugin submission dashboard](https://community.obsidian.md/plugins/curtis-ai-chat) (or submit fresh, since the plugin ID changed).

**Context:** Plugin ID changed from `curtis` → `curtis-ai-chat`. The old `curtis` submission (v3.0.1) stays in the directory; the new ID is a separate submission.

---

## Submission fields

**Plugin name:** Curtis AI Chat

**Repository URL:** https://github.com/JordanNewell/curtis-ai-chat

**Author:** Jordan Newell ([@JordanNewell](https://github.com/JordanNewell))

**Manifest version:** 1.0.2

**minAppVersion:** 1.13.0

**Discussion thread:** (link the forum "Plugin Releases" thread once created)

**Funding URL:**
- Buy Me a Coffee: https://www.buymeacoffee.com/jordannewell
- GitHub Sponsors: https://github.com/sponsors/jordannewell

---

## Short submission blurb (for the directory listing)

Polyglot AI chat with 30+ providers (Anthropic, OpenAI, Gemini, Ollama, OpenRouter, and 25+ more), multi-model arena, agent tools that read and edit your vault notes, voice I/O, long-term memory, slash commands, image attachments, and inline selection actions.

---

## Long description (plugin page body, ~940 chars)

Polyglot AI chat in your sidebar. Thirty-plus providers — Anthropic, OpenAI, Gemini, Ollama, OpenRouter, Groq, and more — one consistent interface. Your API keys, your vault, your data.

**Agent mode** — AI calls tools to read, create, edit your notes (search, create, edit, get_tags, get_backlinks, calculator). Opt-in.

**Multi-model arena** — stream one prompt to 2–5 models side-by-side. Compare quality, latency, cost live.

**Inline diff rewrite** — select text, AI generates an improved version, Accept/Reject diff.

**Voice I/O** — Whisper STT on the mic, browser TTS on assistant messages, auto-speak toggle.

**@-mention vault notes** — fuzzy-search and attach as invisible context.

**Cross-conversation search** — assignable hotkey across every message in every conversation.

**Memory** — markdown-file-backed, edit/delete facts from Settings.

API keys in OS keychain. MIT, no telemetry, attested per release.

---

## Submission cover letter (paste into the submission form body)

Hi Obsidian team,

Submitting **Curtis AI Chat** for directory review. This is a rebrand of my existing `curtis` plugin (v3.0.1, listed at community.obsidian.md/plugins/curtis) — the plugin ID changed because v1.0.0 is a breaking release (new ID required for clean migration, since install state cannot auto-carry over).

**What's new in v1.0.0:**

- Curtis Agent — AI calls nine built-in tools to read/create/edit vault notes (opt-in)
- Multi-model arena — stream one prompt to 2–5 models side-by-side
- Inline diff rewrite — select text → right-click → Rewrite with AI (diff), or assign a hotkey → AI rewrite with Accept/Reject diff modal
- @-mention vault notes — fuzzy-search and attach note content as context
- Voice I/O — Whisper speech-to-text on the mic button, browser TTS on every assistant message
- Cross-conversation search — assignable hotkey fuzzy picker
- Markdown export — `/export` slash or header download icon
- Memory editing UI — edit/delete individual memory facts from Settings → Memory

**Compliance with submission rules (verified):**

- Repo name doesn't start with `obsidian-` ✓
- Plugin name contains no Obsidian derivatives ✓
- Manifest description doesn't contain "Obsidian" and doesn't start with the plugin name ✓
- Settings headings don't contain "settings" or the plugin name ✓
- Release tag matches manifest version exactly (`1.0.0`, no `v` prefix) ✓
- No `obsidian-` prefix on plugin ID ✓
- Min Obsidian version: 1.13.0 (uses `setDestructive()`, `loadLocalStorage`/`saveLocalStorage`)
- Artifact attestations generated for release assets
- MIT licensed

**Privacy:** All vault access is user-initiated (agent tools, image picker, folder picker, @-mention autocomplete). API keys stored in OS keychain via Obsidian 1.13+. No telemetry, no tracking, no phone-home. Documented in the README Privacy section.

Repo: https://github.com/JordanNewell/curtis-ai-chat

Happy to address any feedback. Thanks for the review.

— Jordan
