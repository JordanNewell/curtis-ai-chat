# GitHub Release 1.4.0 — Curated Notes

**Use:** After the tag push triggers `release.yml` (build + provenance attestation + auto-notes), replace the body with this file:
`gh release edit 1.4.0 --notes-file docs/launch-playbooks/v1.4.0/10-release-notes.md`
Style matches the live 1.1.x/1.2.0 releases: changelog-derived, terse, no emoji, plain title (no rename needed).

---

MCP client support: ten built-in tools becomes any tool the user already runs. Plus vault retrieval (RAG) behind the existing settings, and the storage promise made literal — conversations now live as markdown files in your vault. Ships after a full-codebase audit pass: every line reviewed, ~40 defects fixed, all dead code removed.

## Added

- **Conversations as vault files** — every chat persists as one markdown note in `AI/Conversations/` (folder configurable) instead of `localStorage`: YAML frontmatter for metadata, readable `## You` / `## AI` sections with hidden per-message metadata, chronological filenames. Native Obsidian search indexes history; hand edits round-trip; deleting a conversation (new delete action in the history dropdown) trashes its file; legacy localStorage history imports automatically.
- **MCP client** — connect any number of Streamable HTTP MCP servers under Settings -> MCP servers. Every tool they expose joins the agent toolset as `mcp__<server>__<tool>` (collision-safe, 64-char provider-safe naming), requires agent mode, and is off by default. Speaks protocol 2025-06-18, negotiates down for older servers, re-initializes transparently on session loss, answers server pings, and skips tool negotiation for tool-less servers. Tools render text/structured results and truncate at 20k chars. No MCP OAuth — servers you enter are servers you trust.
- **Vault retrieval (RAG)** — notes are chunked and embedded via any OpenAI-compatible `/embeddings` endpoint (local Ollama/LM Studio work offline; Anthropic and Azure are excluded), stored int8-quantized in the plugin dir, and the top-k excerpts for your message are injected into the system prompt. Explicit `@`-mention attachments win over retrieval, and retrieval failures never block a send.
- **Incremental indexing** — rebuilds skip unchanged files; edits/deletes/renames update the index live (edits made during a rebuild are queued and indexed after). The index file is written atomically, so a crash can't force a full re-embed.
- **`semantic_search` agent tool** — meaning-based vault search alongside keyword `search_notes`.
- **Settings** — MCP servers group and Vault retrieval group (both indexed by Obsidian's settings search), plus a "Rebuild vault index" command.

## Fixed

Highlights from the audit pass (full list in the changelog):

- Local HTTP providers (Ollama, LM Studio, llama.cpp) stream again — streaming requests were routed through Node's `https` module regardless of protocol.
- Mobile: a CORS-blocked stream now retries buffered via `requestUrl` instead of failing; aborting no longer surfaces spurious errors.
- `/paste` inserts the clipboard instead of erasing it; edit-resend restores a message's image and note attachments.
- Editing a custom provider no longer wipes its keychain-stored API key or leaves a stale duplicate registry entry.
- Regenerate no longer deletes the reply before checking the provider is authenticated; mid-stream conversation switches can't deposit a response into the wrong chat.
- Streaming token usage is real for OpenAI/Azure/OpenRouter (`stream_options.include_usage`); responses cut off by max-tokens say so; per-message and `/stats` costs are computed from provider pricing.
- MCP hardening: 64-char tool-name cap actually enforced, disable-mid-connect races fixed, wrong-id responses rejected, HTML error bodies surfaced properly.
- Cross-conversation search covers all conversations (older ones were invisible past the newest 200 messages).
- Failed settings migrations retry next boot instead of being marked done; a v5 migration purges settings that never had a reader.

## Removed

- The never-wired prompt-templates module and dead settings (panel width, hotkeys, budget limit, cost-tracking toggle, daily-notes trio). No user-facing behavior lost — none of it was reachable.

## Upgrade

Update via **Settings -> Community plugins -> Check for updates**, or download main.js, manifest.json, and styles.css from the assets below into `<vault>/.obsidian/plugins/curtis-ai-chat/`. Requires Obsidian 1.13.0 or later.
