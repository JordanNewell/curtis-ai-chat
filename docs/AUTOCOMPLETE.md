# Inline autocomplete

> Type in any note, pause, and a dimmed continuation appears after the cursor. Tab accepts.

## What it does

Ghost-text suggestions while you write. After a short pause in typing, Curtis sends the text around your cursor to the configured provider and renders the continuation inline, dimmed, exactly where you would type it.

- **Tab** accepts the suggestion
- **Escape** dismisses it
- Any further typing dismisses it and starts a new request
- One undo step removes an accepted suggestion

Off by default — see [Privacy](#privacy).

## Quick start

1. Settings → Curtis AI → Autocomplete → enable **Inline suggestions**
2. **Choose model** and pick a small, fast model (Haiku-class, GPT-mini-class, or a local Ollama model)
3. Open any note and type a sentence — pause mid-word
4. Tab to accept, Escape to dismiss

## Settings

| Setting | Default | What it does |
|---|---|---|
| Inline suggestions | Off | Master toggle |
| Autocomplete model | Follows active chat model | Dedicated provider/model for suggestions; small fast models work best |
| Accept key | Tab | Tab, Alt+Tab, or Ctrl+→. Tab is captured only while a suggestion is visible, so vim-style indent is untouched otherwise |
| Debounce | 500 ms | How long typing must pause before a request fires (200–1000 ms) |
| Minimum characters | 4 | Characters since the last space before suggestions start |

## How it works

- **Trigger** — end of a line, single cursor, after the debounce elapses with enough characters since the last space. The rule is whitespace-agnostic: CJK text has no spaces, so any four characters qualify.
- **Staleness guard** — a response renders only if the text that produced it is still the text at the cursor. Typing, undo, or moving the cursor mid-request drops the reply instead of rendering it.
- **Cost guards** — requests cap at 60 tokens and stop at paragraph breaks; identical prefixes are served from an LRU cache; a sliding window throttles to 20 requests/minute; a failed provider pauses suggestions for a minute (two on a rate limit) and shows one notice instead of an error per keystroke.
- **Same transport as chat** — suggestions go through the same request pipeline, so API keys, OAuth, and local models (Ollama) behave exactly as they do in chat. Token spend this session shows in `/stats`.

## Privacy

Off by default, and each request sends up to ~2,000 characters before the cursor plus ~300 after to the selected provider — nothing else. For fully local suggestions, point the autocomplete model at Ollama.

## Known limitations

- **Desktop only** — ghost text is suppressed on mobile keyboards.
- **End of line only** — mid-line completions (fill-in-the-middle) are not v1.
- **Other suggestion plugins** — plugins that also render inline suggestions (Completer, Text Generator, Copilot-style tools) will compete for the same space; use one at a time.
