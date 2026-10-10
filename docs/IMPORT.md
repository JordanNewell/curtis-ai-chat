# Chat import & the `.curt` format

Move your chat history from other AI tools into Curtis and continue without missing a beat. New in v2.0.

Curtis chats are plain markdown files in your vault, so "importing" means writing those files — imported conversations land in `AI/Conversations/` like any other chat: searchable in Obsidian, synced across devices, and readable by the agent. Continuing an imported chat sends its full history to **whatever provider you have active** — the original provider/model is kept as display metadata on each message.

## Where chats live

Every conversation — new, imported, or spawned by the [swarm](SWARM.md) — persists as one markdown note in **`AI/Conversations/`** (change the folder under Settings → Conversations). The file is the storage: there is no database. Edit it by hand and Curtis picks up your edits; delete it and the chat is gone.

The layout is stable and human-readable:

- **Frontmatter** — `curtis: conversation`, plus the id, created/updated timestamps, and the provider/model the chat is currently on ([swarm](SWARM.md) chats record `role: leader` / `follower`, and a follower keeps its `leaderId`)
- **`# Title`** — the conversation title
- **One section per message** — `## You`, `## AI`, `## Tool`, or `## System`, each opening with a small `<!-- curtis:msg {...} -->` HTML comment that carries the machine metadata: id, timestamp, role, and where applicable the provider/model, token and cost figures, image and attachment references, tool-call records, and which memories a reply used

The serializer/parser for this format is deliberately Obsidian-free, so external tools can read and write it — [Curtis Porter](https://github.com/JordanNewell/curtis-ai-chat-porter) does exactly that. History that predates conversation files (the old localStorage store) imports itself into the folder once on upgrade; the original copy is left in place.

## Supported sources (auto-detected)

You never pick a format. Drop or select a file and Curtis figures out what it is:

| Source | What it looks like | Notes |
|---|---|---|
| **ChatGPT export** | `conversations.json`, plain or still zipped | From [chat.openai.com](https://chat.openai.com) → Settings → Data controls → Export. Branch artifacts and platform system prompts are dropped; the model used is recorded per answer. |
| **Claude export** | `conversations.json` | From [claude.ai](https://claude.ai) → Settings → Privacy → Export data. |
| **`.curt` file** | Curtis's portable format | Full fidelity — ids, token stats, images survive byte-perfect. |
| **Curtis markdown** | A transcript with `curtis: conversation` frontmatter | Move chats between vaults by copying files. |
| **Generic JSON** | `[{"role": "user", "content": ...}, ...]` or `{messages: [...]}` | Also accepts `from: human/bot/gpt` style keys. |
| **Generic markdown** | Role headings (`## You`) or bold labels (`**User:**`) | Best-effort. Documents without a confident user+assistant split are rejected, not guessed. |

Tool-call output from foreign transcripts is not imported — without tool-calls linkage those messages would make providers reject the request when Curtis re-sends the history.

## Four ways to import

1. **Command** — "Import chats from other AI tools" in the command palette (multi-select picker, works for whole export zips).
2. **Drag-and-drop** — drop a supported file onto the chat view.
3. **`.curt` in the vault** — double-click a `.curt` file for a one-click import page.
4. **Right-click** — "Import into Curtis" on any `.curt` / `.json` / `.zip` / `.md` / `.txt` file in the file explorer.

Also in **Settings → Conversations → Import chats from other AI tools**.

Re-running an import is idempotent: conversations already present are skipped, so you can't double-import an export.

## Bulk export

"Export all chats as .curt (zip)" — command palette, or Settings → Conversations — writes every conversation as a `.curt` file into one zip (`curtis-chats-<date>.zip`, named `<date> <title> <id6>.curt` inside). Whole-history backup, vault-to-vault move, machine-to-machine transfer. The zip is itself importable: drop it into another vault's import flow and it's auto-detected as a batch of `.curt` files — already-present conversations are skipped, so re-importing is safe.

The zip also feeds [Curtis Porter](https://github.com/JordanNewell/curtis-ai-chat-porter), the standalone converter for people not in Obsidian yet — it turns any export into `.curt` and vault-ready markdown, local-first.

## The `.curt` format

One `.curt` file = one conversation. Export any chat via the header download icon → **Save as .curt (portable)**.

It's JSON with a magic field and version:

```json
{
	"curt": "curtis-conversation",
	"version": 1,
	"conversation": {
		"id": "conv_...",
		"title": "Weekly review",
		"createdAt": 1791032809819,
		"updatedAt": 1791032900000,
		"provider": "anthropic",
		"model": "claude-sonnet-4-5",
		"messages": [ ... ]
	}
}
```

Why JSON instead of the markdown+markers layout used inside the vault: a portable file must be byte-robust — no marker-escaping edge cases, and base64 images or tool-call metadata survive verbatim. Inside the vault the markdown files stay human-readable; `.curt` is the shipping container.

Use cases: moving chats between vaults or machines, archiving conversations outside the vault, sharing a chat with another Curtis user, keeping one-off copies of a conversation before a risky experiment.
