# Inline diff rewrite

> Cursor-style AI rewrite with an Accept/Reject diff modal.

Select text in any note, trigger a rewrite, and review the AI's changes line-by-line before they land. Green for additions, red for deletions, plain for unchanged. Accept to apply, reject to discard.

## What it is

Standard selection actions ([see SELECTION_ACTIONS.md](SELECTION_ACTIONS.md)) write the AI's result directly back into the note — either replacing the selection or inserting below. The diff rewrite is different: it opens a modal showing the original and rewritten versions side-by-side as a diff, and only writes to the note if you click **Accept**.

This is the right tool when you want to keep tight control over edits — when the original wording matters, when the AI might over-rewrite, or when you're reviewing substantial changes.

## How to invoke

Three entry points:

| Method | How |
|---|---|
| **Hotkey** | `Ctrl+Shift+R` (default; rebindable under Settings → Hotkeys → "Curtis AI Chat: Rewrite with AI (diff)") |
| **Context menu** | Right-click a selection → **Rewrite with AI (diff)** |
| **Command palette** | `Ctrl+P` → "Curtis AI Chat: Rewrite with AI (diff)" |

The rewrite uses your **currently active model and provider** — whatever's selected in the chat header.

## Workflow

1. **Select** the text you want to rewrite in any note
2. **Trigger** the rewrite via any of the three methods above
3. The AI generates an improved version using a built-in rewrite prompt
4. The **diff modal** opens, showing line-by-line changes:
   - `+` green lines — additions
   - `-` red lines — deletions
   - ` ` (space) plain lines — unchanged
5. **Review** the diff
6. Click **Accept** to replace the selection with the rewritten text, or **Reject** to close the modal without changes

## Custom prompts

For v4.0.0, the rewrite uses a single built-in system prompt tuned for "improve clarity, fix grammar, preserve meaning." There's no UI to customize it yet.

If you want a custom rewrite prompt:

- Use a regular [selection action](SELECTION_ACTIONS.md#adding-custom-actions) — those are fully customizable but write directly back without a diff review
- Or wait for v4.1.0, which adds a settings field for the diff-rewrite system prompt

## Diff algorithm

Line-level diff via longest-common-subsequence (LCS) dynamic programming. O(n*m) time and space, which is fast enough for typical AI rewrite sizes (under ~200 lines).

For very large selections, the diff still works but may take a moment to compute. The modal stays responsive during computation.

## Future work

Planned for v4.1.0 and beyond:

- **Word-level diff** — currently diff is line-granular. A word-level mode would show intra-line changes (like GitHub's split diff).
- **Inline editor decorations** — show the diff directly in the editor (like Cursor or GitLens inline blame) instead of a modal. Faster review loop for small changes.
- **Customizable system prompt** — settings field for the rewrite prompt
- **Multi-turn refinement** — "make it more concise" without re-selecting
- **Partial accept** — accept some hunks, reject others
