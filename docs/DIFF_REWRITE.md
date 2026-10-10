# Inline diff rewrite

> Cursor-style AI rewrite with an Accept/Reject diff modal.

Select text in any note, trigger a rewrite, and review the AI's changes line-by-line before they land. Green for additions, red for deletions, plain for unchanged. Accept to apply, reject to discard.

## What it is

Replace-mode selection actions never write silently — every result opens in the diff modal first ([SELECTION_ACTIONS.md](SELECTION_ACTIONS.md)). The dedicated diff rewrite is that same review flow running the built-in "improve writing" prompt: it shows the original and rewritten versions as a diff, and only writes to the note if you click **Accept**.

This is the right tool when you want to keep tight control over edits — when the original wording matters, when the AI might over-rewrite, or when you're reviewing substantial changes.

## How to invoke

Three entry points for the improve rewrite:

| Method | How |
|---|---|
| **Hotkey** | Assignable under Settings → Hotkeys → "Curtis AI: Rewrite with AI (diff)" (no default, to avoid conflicts) |
| **Context menu** | Right-click a selection → **Rewrite with AI (diff)** |
| **Command palette** | `Ctrl+P` → "Curtis AI: Rewrite with AI (diff)" |

Other replace-mode actions (summarize, fix grammar, custom actions, …) land in the same modal — trigger them their usual way. Everything uses your **currently active model and provider** — whatever's selected in the chat header.

## Workflow

1. **Select** the text you want to rewrite in any note
2. **Trigger** the rewrite via any of the three methods above
3. The AI generates a result (the improve prompt here, the action's own prompts elsewhere)
4. The **diff modal** opens, showing line-by-line changes:
   - `+` green lines — additions
   - `-` red lines — deletions
   - ` ` (space) plain lines — unchanged
5. **Review** the diff
6. Click **Accept** to replace the selection with the rewritten text, or **Reject** to close the modal without changes

## Custom prompts

The rewrite entry itself uses a built-in prompt tuned for "improve clarity, fix grammar, preserve meaning." For your own prompts, define a [custom selection action](SELECTION_ACTIONS.md#custom-actions) with insert mode **replace** — it gets the same diff review.

## Diff algorithm

Line-level diff via longest-common-subsequence (LCS) dynamic programming. O(n*m) time and space, which is fast enough for typical AI rewrite sizes (under ~200 lines).

For very large selections, the diff still works but may take a moment to compute. The modal stays responsive during computation.

## Future work

Planned for v1.1 and beyond:

- **Word-level diff** — currently diff is line-granular. A word-level mode would show intra-line changes (like GitHub's split diff).
- **Inline editor decorations** — show the diff directly in the editor (like Cursor or GitLens inline blame) instead of a modal. Faster review loop for small changes.
- **Multi-turn refinement** — "make it more concise" without re-selecting
- **Partial accept** — accept some hunks, reject others
