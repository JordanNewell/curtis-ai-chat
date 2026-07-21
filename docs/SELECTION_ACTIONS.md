# Selection actions

Right-click any text selection in a note for AI-powered transformations. Each action runs the selection through your active model and writes the result back into the note — either replacing the selection or inserting below.

## Access

1. Open any note in the editor
2. Highlight some text
3. Right-click → **AI** menu items appear at the top of the context menu

Or use the command palette (`Ctrl+P`) — every action is registered as a command with the prefix *"ObsiBuddi"*.

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
| **Translate** | Translate to English (configurable per-action) |
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

- **`replace`** — the selection is replaced with the result (most actions)
- **`insert-below`** — the original text stays, the result is appended below (used by `Add tests`, `Extract wikilinks`)

The insert mode is fixed per action — you can't change it from the UI. If you want to keep the original AND get the rewrite, use `insert-below` actions, or undo (`Ctrl+Z`) after a `replace`.

## Adding custom actions

The selection actions are defined in `src/commands/selection.ts` as a `Record<string, SelectionAction>`:

```ts
'my-action': {
  systemPrompt: 'You are a pirate. Rewrite everything in pirate speak.',
  userPrompt: (text) => `Rewrite this:\n\n${text}`,
  insertMode: 'replace',
}
```

Then register a command in `src/commands/index.ts` and optionally add it to the context menu in `src/commands/context-menu.ts`.

## Tips

- **Hotkeys** — bind any action via Obsidian's Hotkeys settings. Look for commands starting with *"ObsiBuddi: "*.
- **Multiple selections** — Obsidian supports multiple cursors; each selection gets its own AI call when you trigger an action.
- **Long selections** — there's no hard cap, but extremely long selections may exceed your model's context window. Chunk them.
