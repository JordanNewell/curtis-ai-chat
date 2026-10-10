# The Curtis Markdown File Protocol

Curtis AI Chat stores everything as plain markdown in a local folder. No proprietary database, no cloud lock-in, no export step. This document specifies that storage layer — the **Curtis Markdown File Protocol** — so that any app which can read and write a directory of `.md` files can act as a Curtis-compatible frontend.

## Why a protocol, not a feature

Most chat tools keep your history in a SQLite file or a server you don't control. Curtis keeps it in your vault, in markdown you can open in any editor. That's not an implementation detail — it's the product. The protocol turns "Obsidian vault" into "local folder of markdown files":

- **VS Code**, **Logseq**, **Obsidian**, **Zettlr**, or a custom Electron app reading the same folder is a Curtis frontend.
- Your conversation history outlives the app. Delete Curtis tomorrow; every chat is still on disk, readable forever.
- Sync is whatever you already use — git, Syncthing, iCloud, Dropbox. The format has no opinions about transport.

## Folder layout

```
<vault>/
└── AI/
    ├── Curtis Memory.md        # long-term facts (see MEMORY.md)
    └── Conversations/          # one .md file per conversation
        ├── 2026-07-22-refactoring-aurora.md
        ├── 2026-07-23-0430-rust-borrow-checker.md
        └── ...
```

Both paths are configurable in Settings. The defaults above are the canonical layout this spec describes.

## Conversation file schema

Each conversation is one markdown file. The format is what `formatConversationAsMarkdown` (v1.0 export) emits, promoted from an export format to the live storage format:

```markdown
# Refactoring the Aurora scheduler

Provider: openai (GPT-4o)
Model: gpt-4o
Started: 2026-07-22 4:54 PM
Messages: 6

---

## User
*2026-07-22 4:54 PM*

Why does the spawn loop deadlock under load?

## Assistant
*2026-07-22 4:54 PM · gpt-4o*

The worker channel is unbounded, so backpressure never signals...
```

### Rules

1. **H1 is the title.** The first `# ` line is the conversation title; everything after is content.
2. **Metadata block.** Immediately after the title: `Provider:`, `Model:`, `Started:`, `Messages:` lines. Parsers treat missing metadata as defaults (unknown provider/model), never as errors.
3. **One section per message.** `## User`, `## Assistant`, or `## <role>` — followed by an italic timestamp line (`*YYYY-MM-DD h:MM AM/PM*`, plus ` · <model>` on assistant turns when known), a blank line, then the message body.
4. **Bodies are markdown.** Images use `![](path)` with vault-relative paths; they travel with the file.
5. **The `---` separator** after metadata is conventional. Parsers should skip blank lines and horizontal rules when scanning for message sections.
6. **Filenames** are `<YYYY-MM-DD>-<slug>.md`. The date is conversation start (UTC); the slug is a human-readable title slug. Uniqueness is per-folder; suffix `-2`, `-3` on collision.

## Memory file schema

`AI/Curtis Memory.md` — one bullet per durable fact, with hidden HTML-comment metadata:

```markdown
# Curtis Memory

Long-term facts about the user, captured during chat and editable by hand.
Delete a line to forget; edit a line to correct.

- I prefer concise answers without preamble [preference] <!-- id:abc123 updated:1784594521 -->
- My main project is Aurora, a Rust async runtime [project] <!-- id:def456 updated:1784594600 -->
```

- The bracketed category is one of `preference | identity | project | instruction | other`. It may be omitted; parsers default to `other`.
- The HTML comment carries `id` (stable across edits) and `updated` (unix seconds). Third-party tools must preserve both when editing a line.
- Full details: [MEMORY.md](MEMORY.md).

## Compatibility contract

A Curtis-compatible frontend is any program that:

1. Reads the folder layout above without requiring app-specific state.
2. Treats all files as user-owned data — creates and edits, never locks.
3. Preserves unknown content. A parser that doesn't understand a line keeps it.
4. Writes only well-formed files per the schemas above.

Anything meeting these four rules can read Curtis history, display conversations, edit memory, and be read back by Curtis without loss.

## Versioning

This is protocol **v1**. Additions (new metadata lines, new section types) must be additive: old parsers ignore what they don't recognize. Breaking changes require a protocol version bump and a migration note here.

## Status

Conversation files are currently produced by export (`/export`) in exactly this format; live storage and folder-watched sync to `AI/Conversations/` are the roadmap path to making this the default store. The schema above is stable and safe to build against today.
