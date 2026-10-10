# MCP server

Curtis is an MCP [client](AGENT.md#mcp-servers) — it calls tools from servers you run. Server mode is the reverse: **Curtis serves your vault as MCP tools** so external AI apps (Claude Desktop, coding agents, anything that speaks MCP) can list, read, and search your notes without a line of Curtis chat.

## Enable

Settings → Curtis AI → MCP server → **Enable MCP server**. Desktop only — mobile Obsidian has no listening sockets, so the toggle is disabled there.

The server binds to **127.0.0.1** (never the network) and requires a bearer token, generated on first start. Copy the ready-made registration command from the settings row:

```
claude mcp add --transport http curtis-vault http://127.0.0.1:24783/mcp --header "Authorization: Bearer <token>"
```

Any MCP client that speaks Streamable HTTP works: point it at `http://127.0.0.1:<port>/mcp` with an `Authorization: Bearer <token>` header. The transport matches the MCP `2025-06-18` protocol, stateless — no session handling client-side.

## Tools

| Tool | What it does |
|---|---|
| `list_notes` | Paths, alphabetically, optionally under a folder. Paginated. |
| `read_note` | Full note text; large notes truncate with a marker. |
| `search_notes` | Case-insensitive text search with line-numbered excerpts. |
| `semantic_search` | Meaning-based search over the vault's embedding index. Present when RAG is on — this is the one generic vault servers can't match. |
| `get_memory` | The user's saved memory facts — durable preferences and project context. |
| `write_note` | Create / overwrite / append. **Only exists when Allow writes is on** — off by default, so a fresh install is read-only. |
| `list_agents` | The user's named [agents](AGENTS.md) — name, emoji, short description, and model per agent. |
| `run_agent` | Run one named agent headlessly: `{ name, task, max_turns? }` → the agent's final answer as text. **Only agents with Remote invocation on.** |

## Agents as tools

The server also serves the user's named agents as callable tools: `list_agents` to browse them, `run_agent` to hire one. Every agent carries a **Remote invocation** gate in the agent editor — off by default, so an agent can only ever run in chats the user started until it's switched on. One toggle gates both this tool and the plugin API's `runAgent`.

A `run_agent` call is a fresh engagement: no conversation history, the task text is the whole prompt, and the agent's persona is the system prompt. The run routes through the agent's own provider/model on the user's own key — cost lands where the user already configured it, and the agent's tool ceilings still apply. Call `list_agents` first and pass an exact name; unknown names and gate-off agents are refused.

Remote runs are capped at 2 concurrent — extra calls are rejected with a busy error — and every run is recorded: a completion Notice, plus a "Recent remote runs" list under Settings → Curtis AI → MCP server.

## Security

A localhost server that can read (and optionally write) a vault is a real surface. The defenses, in order of what they stop:

- **Bearer token on every request** — constant-time compared; a process without the token gets 401.
- **127.0.0.1 bind + Host check** — the server is unreachable from the network and ignores DNS-rebinding requests that arrive with a non-loopback Host.
- **Origin allowlist** — a web page in any browser is refused (403) before auth; drive-by pages cannot probe the port.
- **Writes are a separate toggle** — and `write_note` stays out of the advertised catalog entirely while off, so clients never even see it.
- **Every path passes a vault-jail** — absolute paths, drive letters, and `..` segments are rejected before a file is touched.

Treat the token like a key to your vault: it lives in `data.json`, and **Regenerate** (settings) invalidates the old one for every client at once.

## See also

- [PLUGIN_API.md](PLUGIN_API.md) — the in-vault direction: other Obsidian plugins calling Curtis.
- [AGENT.md#mcp-servers](AGENT.md#mcp-servers) — the outbound direction: Curtis calling your MCP servers.
