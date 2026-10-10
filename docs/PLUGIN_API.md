# Plugin API

Curtis exposes a small programmatic surface so **other Obsidian plugins** can use it as the vault's AI layer — one place configures the providers, keys, memory, and tools; every integration inherits them.

## Access

Once Curtis is loaded (enabled in Community plugins):

```ts
const curtis = (window as any).app.plugins.plugins['curtis-ai-chat'];
if (curtis?.api) {
	const reply = await curtis.api.chat('Summarize the note the user is editing');
}
```

Guard for `undefined` — the `api` property exists only while the plugin is loaded and past `onload`.

## Surface

| Member | What it does |
|---|---|
| `version` | Curtis plugin version (manifest). |
| `chat(prompt, options?)` | One headless agent run: returns the final text. Runs the same tool loop as chat — vault tools, MCP tools, memory — but touches no conversation and no UI. Rejects with the provider error when no authenticated provider is available. |
| `runAgent(name, task, options?)` | Run one of the user's named agents headlessly and resolve with its final answer as text. Throws on an unknown name or when the agent's Remote invocation gate is off. |
| `searchNotes(query, limit?)` | Case-insensitive text search. Returns `{ path, line, excerpt }` hits, filename matches ranked first. |
| `semanticSearch(query, topK?)` | Meaning-based search over the RAG index. Rejects when RAG is off. Returns `{ path, snippet, score }`. |
| `readNote(path)` | Full note text, or `null` when the path doesn't resolve. Paths are vault-relative. |
| `listNotes(folder?, limit?)` | Note paths under an optional folder, alphabetically. |
| `getMemory()` | The user's saved memory facts (copies — mutating them does nothing). |

## `chat()` options

```ts
interface CurtisApiChatOptions {
	system?: string;          // replaces Curtis's default system prompt
	history?: AIMessage[];    // prior turns
	model?: string;           // default: active chat model
	providerId?: string;      // default: active chat provider
	maxTurns?: number;        // agent-loop cap; default: settings.agentMaxTurns
	allowRunCommand?: boolean; // opt-in shell access (default: excluded)
	signal?: AbortSignal;     // cancel mid-loop
	onChunk?: (chunk: string) => void; // stream the output
	onUsage?: (usage: TokenUsage) => void; // per-request token usage from the loop (each tool turn reports its own)
}
```

Two tools are removed from the headless loop by design: `run_command` (unless you pass `allowRunCommand: true` — the user's confirmation setting still applies on top) and `spawn_agent` (swarm followers open panes; a background caller can't frame that).

## `runAgent()`

```ts
interface CurtisApiRunAgentOptions {
	maxTurns?: number;         // agent-loop cap
	signal?: AbortSignal;      // cancel mid-run
	onChunk?: (chunk: string) => void; // stream the output
	onUsage?: (usage: TokenUsage) => void; // per-request token usage from the loop (each tool turn reports its own)
	allowRunCommand?: boolean; // opt-in shell access (default: excluded)
}
```

Resolves with the named agent's final answer as text. Throws on an unknown agent name or when its **Remote invocation** toggle is off — the same gate as the MCP server's `run_agent` ([MCP_SERVER.md](MCP_SERVER.md#agents-as-tools)), so one switch covers both inbound surfaces. Resolution errors distinguish a clean miss (`Unknown agent: X — use list_agents for exact names`) from an ambiguous substring reference, which lists the matching agent names. A run is a fresh engagement: no conversation history, `task` is the whole prompt, the agent's persona is the system prompt, and the agent's own model routing picks the provider — cost lands on the user's key as configured.

## Example

```ts
// A plugin that turns meeting notes into action items
const curtis = app.plugins.plugins['curtis-ai-chat'];
const items = await curtis.api.chat(
	'Extract action items as a markdown checklist.',
	{
		history: [{ role: 'user', content: `Meeting notes:\n\n${await curtis.api.readNote('Meetings/2026-10-09.md')}` }],
		onChunk: (c) => streamIntoMyPane(c),
	}
);
```

## Stability

This object is a public contract: members are added, never renamed or removed, and breaking behavior changes ride a major version. Check `api.version` if you depend on a specific member.

Desktop and mobile both expose the API — it is pure in-process TypeScript, no sockets involved. The separate [MCP server](MCP_SERVER.md) covers the out-of-vault case (external AI apps).
