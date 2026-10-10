# Selection actions

Right-click any text selection in a note for AI-powered transformations. Each action runs the selection through your active model — replace-mode actions open a diff review before anything is written, insert-below actions append directly.

## Access

1. Open any note in the editor
2. Highlight some text
3. Right-click → **AI** menu items appear at the top of the context menu

Or use the command palette (`Ctrl+P`) — every action is registered as a command with the prefix *"Curtis AI"*.

## Writing actions

| Action | What it does |
|---|---|
| **Summarize** | Concise bullet-point summary |
| **Explain** | Clear, simple explanation of complex concepts |
| **ELI5** | Explain like the reader is 5 years old |
| **TL;DR** | One-sentence TL;DR plus 3 bullet points |
| **Improve writing** | Fix grammar, enhance clarity and flow, preserve meaning |
| **Fix grammar** | Spelling, punctuation, grammar only — no rewrite |
| **Shorten** | Cut to roughly half the length, keep key info |
| **Translate** | Translate to any language — Curtis asks for the target and remembers the last one |
| **Extract key points** | Structured list of main ideas |
| **Extract wikilinks** | Comma-separated `[[wikilinks]]` for entities worth linking |
| **Make a table** | Convert free-form text into a clean markdown table |
| **Pros & cons** | Two-section breakdown |
| **Convert to callout** | Wrap as an Obsidian `> [!note]` callout |

## Code actions

| Action | What it does |
|---|---|
| **Review code** | Bugs, security, performance, best practices |
| **Explain code** | Step-by-step what it does |
| **Refactor** | Improve structure without changing behavior |
| **Add tests** | Generate unit tests for the selection |

## Insert behavior

Each action has an **insert mode**:

- **`replace`** — the result is shown as a line-by-line diff first ([review modal](DIFF_REWRITE.md)); nothing is written until you accept (most actions)
- **`insert-below`** — the original text stays, the result is appended below (used by `Add tests`, `Extract wikilinks`)

The insert mode is fixed for built-in actions; custom actions choose it in their editor.

## Custom actions

Define your own actions under **Settings → Curtis AI → Custom selection actions**. Each has:

- **Name** — shown in the context menu, command palette and hotkeys list
- **System prompt** — how the model should behave
- **User prompt template** — `{{selection}}` marks where the selected text goes; without it the selection is not sent
- **Insert mode** — replace (diff review first) or insert-below

Custom actions appear alongside the built-ins everywhere selection actions are surfaced. Palette commands are registered at startup — reload after adding one; the context menu picks up changes immediately.

Developers: the built-in prompts live in `src/commands/selection.ts` (`SELECTION_ACTIONS`).

## Tips

- **Hotkeys** — bind any action, custom included, via Obsidian's Hotkeys settings. Look for commands starting with *"Curtis AI: "*.
- **Multiple selections** — Obsidian supports multiple cursors; each selection gets its own AI call when you trigger an action.
- **Long selections** — there's no hard cap, but extremely long selections may exceed your model's context window. Chunk them.
