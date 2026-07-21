# Memory

ObsiBuddi remembers durable facts about you across conversations. This doc explains what gets stored, where, how it's used, and how to manage it.

## What memory is for

Facts the model should know in every future chat:

- **Preferences** — *"I prefer concise answers without preamble"*
- **Identity** — *"My name is Jordan, I work primarily in Rust"*
- **Projects** — *"My main project is Aurora, a Rust async runtime"*
- **Instructions** — *"Always cite sources as wikilinks when you reference a note"*

What it's **not** for:

- The topic of this particular chat (that's conversation history)
- Ephemeral requests ("summarize this for me right now")
- Things the model is doing this turn

## Where facts live

By default: `AI/ObsiBuddi Memory.md` in your vault. Configurable in **Settings → Memory → Memory file path**.

The file is plain markdown — one bullet per fact, with hidden HTML-comment metadata for id + timestamp:

```markdown
# ObsiBuddi Memory

Long-term facts about the user, captured during chat and editable by hand.
Delete a line to forget; edit a line to correct.

- I prefer concise answers without preamble [preference] <!-- id:abc123 updated:1784594521 -->
- My main project is Aurora, a Rust async runtime [project] <!-- id:def456 updated:1784594600 -->
- Always cite sources as wikilinks [instruction] <!-- id:ghi789 updated:1784594700 -->
```

You can edit this file directly — add bullets, delete them, rewrite them. The plugin watches the file and reloads on save.

> [!TIP]
> The category in brackets must be one of: `preference`, `identity`, `project`, `instruction`, `other`. Arbitrary bracketed text (like `[[wikilinks]]` inside a fact) is preserved as content, not mistaken for a category.

## How facts get in

### Auto-capture (default)

After each assistant turn, ObsiBuddi fires a background call to the active model with a strict extraction prompt:

> *"Extract 0-3 durable facts about the user from this chat turn. A durable fact is something true across future conversations: a preference, identity trait, long-lived project detail, or standing instruction. Do NOT capture ephemeral requests. Respond with ONLY a JSON array."*

The model decides what's worth remembering. Failures are silent and non-fatal.

Toggle in **Settings → Memory → Auto-capture facts**. Set to `Off` for manual-only.

### Manual

- **`/remember <fact>`** — type it in chat
- **Right-click any selection in a note → Save to memory** — stores the highlighted text verbatim

Manual facts go through the same `addFact` API and dedupe against existing facts (case-insensitive exact match).

## How facts get out

Every prompt includes a `## What you know about the user` block appended to the system prompt:

```
## What you know about the user
- I prefer concise answers without preamble [preference]
- My main project is Aurora, a Rust async runtime [project]
- Always cite sources as wikilinks [instruction]
```

**Full injection, not retrieval.** Every fact goes in every prompt. This works because capture is signal-gated (the model only stores durable facts) so the set stays small — typically tens of facts, not thousands.

> [!NOTE]
> If you accumulate more than ~150 facts, full injection starts eating into your context window. At that point, semantic retrieval (sqlite-vec with local embeddings) becomes the right move. That's on the roadmap.

## Managing memory

| Action | How |
|---|---|
| List recent facts | `/memory` (shows last 8 in a Notice) |
| Open the file | `/memory open` or Settings → Memory → Open |
| Forget one fact | `/forget <substring>` |
| Clear everything | `/memory clear` or Settings → Memory → Clear |
| Edit a fact | Open the file and edit the bullet directly |
| Add a fact by hand | Open the file and add a new bullet (use a valid category) |

## Privacy

- The memory file lives in your vault — readable, editable, syncable via Syncthing/git like any other note.
- Facts are injected into the system prompt of every chat. If your active provider is a cloud API (OpenAI, Anthropic, etc.), facts are sent to that provider along with your message.
- For fully private memory, switch to a local provider (Ollama, LM Studio).
- Facts never leave your machine except via the active AI provider. No telemetry, no analytics.

> [!WARNING]
> Memory injection cuts both ways. If you `/remember` something malicious (or import a note that tricks you into saving it as a memory), it gets injected into every future prompt. Audit `AI/ObsiBuddi Memory.md` if you're unsure what's in there.

## Design notes

The memory system is modeled on obsidian-copilot's user-memory layer (see the design doc in their `src/memory/`). Key choices:

- **Markdown over JSON** — user-editable, survives plugin uninstall, no corruption risk
- **LLM-gated capture over regex** — the model decides what's durable, so recall can be trivial (full injection)
- **Full injection over retrieval** — at the scale of personal facts (tens, not thousands), retrieval adds complexity for no benefit
- **Categories as enum** — `preference | identity | project | instruction | other`. Keeps the file parseable even with hand-edits.

See the codebase audit (`src/memory/memory.ts`) for implementation details.
