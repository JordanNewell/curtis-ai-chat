# Slash commands

Type `/` in the chat input to open the autocomplete menu. Arrow keys to navigate, Enter/Tab to pick, Esc to dismiss.

Unknown commands (e.g. `/typo hello`) fall through and get sent as a literal user message — useful when you actually want to send text starting with `/`.

## Conversation management

### `/clear`

Start a new chat. Clears the message list, attachments, and image strip. The previous conversation stays in history (click the **history icon** in the header to find it).

### `/regen` · `/regenerate`

Regenerate the last assistant response. Drops the trailing assistant message and re-runs the last user prompt for a fresh answer.

### `/title <new name>`

Rename the current conversation. The title shows up in the history dropdown.

```
/title Q3 planning notes
```

### `/stats`

Show a Notice with conversation stats: total conversations, total messages, total tokens used.

## Saving & exporting

### `/copy`

Copy the last assistant response to your clipboard.

### `/note [name]`

Save the last assistant response as a new note in your configured Note save folder.

- Without a name: the basename is derived from the first line of the response
- With a name: uses what you provide
- Opens the note in a new split
- Frontmatter records `source: ObsiBuddi`, `provider`, `model`, `created`
- Embeds any attached images as `![[filename.png]]`

```
/note Q3 Strategy Draft
```

### `/save-all [name]`

Export the entire current conversation as a single structured markdown note. Each message becomes a section:

```markdown
# Conversation title

## 🧑 You
*provider / model*

Your message here.

## 🤖 Assistant
*provider / model*

Assistant response here.
```

Great for archiving a useful conversation into your vault.

## Input helpers

### `/paste`

Paste from the system clipboard into the chat input. Useful when you've copied text from elsewhere and want to ask about it.

> [!NOTE]
> Requires clipboard-read permission. If Obsidian blocks it, you can still paste normally with `Ctrl+V`.

### `/model <query>`

Switch the active model via fuzzy match. Searches both model name and ID across all enabled providers.

```
/model sonnet       → Claude Sonnet 4.5
/model gpt-5-mini   → GPT-5 Mini
/model llama        → Llama 3.3 70B (via Groq, Together, etc.)
```

### `/provider <query>`

Switch the active provider via fuzzy match. Sets the provider's first available model as active.

```
/provider anthropic
/provider groq
/provider ollama
```

### `/system <text>`

Set the system prompt for the session. Without an argument, resets to the default.

```
/system You are a senior Rust engineer. Always explain ownership and lifetimes.
/system                            ← resets to default
```

## Memory

### `/remember <fact>`

Manually save a durable fact to long-term memory. The fact is added to `AI/ObsiBuddi Memory.md` and injected into every future prompt.

```
/remember I prefer concise answers without preamble
/remember My main project is "Aurora" — a Rust async runtime
```

### `/forget <substring>`

Delete the first memory whose content contains the substring. Returns a Notice showing what was removed.

```
/forget Aurora
```

### `/memory`

Without an argument: show a Notice summarizing the last 8 facts.

With arguments:
- `/memory open` — open the memory file in Obsidian
- `/memory clear` — wipe all facts

See [MEMORY.md](MEMORY.md) for how memory works.

## Reference

### `/help`

Open a modal listing every slash command. Use this when you forget the syntax.
