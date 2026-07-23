# @-mention vault notes

> Type `@` in chat → fuzzy-search your vault → attach note content as context.

The `@`-mention feature was [deferred from v3.0.0](../CHANGELOG.md) and finally shipped in v4.0.0. It's the fastest way to give the AI specific vault context without copy-pasting.

## What it does

When you type `@` in the chat input (preceded by whitespace or at the start of the input), a fuzzy-search dropdown opens with your vault's notes. Click a result to attach it. The note's content is prepended to your message as invisible context when you send.

Attached notes show as chips above the input — click the `×` on a chip to remove it before sending.

## Quick start

1. Click into the chat input
2. Type `@` (or start a message and add a space, then `@`)
3. The fuzzy-search dropdown opens
4. Type to filter, arrow keys to navigate, Enter or click to select
5. The note attaches — a chip appears above the input showing the note name
6. Continue typing your message, or attach more notes
7. Send as normal

## Active-note pill

The chat header shows a pill with the **currently active note's name** (the note open in the editor). Click the pill to attach that note instantly — same as typing `@` and selecting it, but one click.

This reuses the same attachment pipeline as `@`-mention selection, so everything below applies equally.

## How attachments work

When you attach a note via `@` or the active-note pill:

1. The plugin stores the **vault path** of the note (not its contents — contents are read at send time)
2. The chip above the input reflects the attachment
3. At send time, the plugin reads the note's current contents from the vault
4. The contents are prepended to your message as a context block:

```
[Attached note: Projects/Aurora.md]
<full note content here>

<your actual message>
```

5. The AI sees this as part of your user message

> [!NOTE]
> Contents are read **at send time**, not at attach time. If you edit the note after attaching but before sending, the AI sees the edited version. Useful for iterative workflows.

## Multiple attachments

Attach as many notes as you want. Each gets its own `[Attached note: path]` block, in the order you attached them.

## AI behavior

When notes are attached:

- The AI **treats the attached content as the source of truth** for that note
- The AI does **not** automatically re-search the vault (unless you have the [Agent](AGENT.md) enabled and the model decides to call `search_notes` or `read_note`)
- If you ask "summarize this" with one note attached, the AI summarizes the attached note — it doesn't go hunting for other notes

### Context precedence

When both `@`-mentions and agent tools are in play, the model sees (in order):

1. Your system prompt (with memory block)
2. Previous conversation history
3. `@`-attached note contents (prepended to your message)
4. Whatever tool calls return (if the agent is enabled and the model invokes tools)

There's no deduplication. If you `@`-attach a note and the agent also reads it, the model sees the content twice. Usually harmless, occasionally wasteful on tokens.

## Privacy

- **Attached note contents are sent to your AI provider.** When you send a message with `@`-attachments, the prepended block (with full note content) leaves your machine on cloud providers.
- This is the same data flow as pasting the note into your message by hand — `@` is just a shortcut.
- The autocomplete dropdown enumerates note filenames locally. Filenames aren't sent anywhere until you attach and send.
- For fully private `@`-mentions, switch to a local provider (Ollama, LM Studio).

## Limitations

- **Filenames only in the dropdown.** The fuzzy-search dropdown shows note titles, not content previews. You can't preview a note from the dropdown — use the active-note pill or the editor if you need to peek first.
- **No fuzzy content search in the dropdown.** The dropdown filters by filename/basename only. To search note contents, use `/` slash commands or the agent's `search_notes` tool.
- **No inline expansion.** The chip shows the note name; it doesn't expand to show contents inline. Send the message to see what the AI sees.
- **No drag-and-drop from the file explorer (yet).** Use `@` or the active-note pill.

## Roadmap

- Content previews in the dropdown
- Drag-and-drop attachment from Obsidian's file explorer
- Inline expansion of attachment chips
- Attachment chip shows a content snippet on hover
- "Attach all notes tagged #X" bulk operation
