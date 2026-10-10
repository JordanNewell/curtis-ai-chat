# Agent tools

> AI tools that read, create, and edit your vault notes. This is the tool **loop** — the harness every chat runs on. For named workers (persona + model + permissions), see [AGENTS.md](AGENTS.md).

The Curtis Agent lets the AI call **tools** during a conversation. Instead of only answering from its training data, the model can search your vault, read specific notes, create new ones, and edit existing ones — all in service of your prompt.

## What it is

When the agent is enabled, every chat message can trigger tool calls. The model decides which tool to invoke based on your prompt, the plugin executes the tool locally against your vault, and the result is fed back to the model. This loop continues until the model produces a final answer or hits the `agentMaxTurns` cap.

Think of it as giving the AI a small set of hands inside your vault.

## Enabling the agent

Opt-in — the agent is **off by default**.

1. **Settings → Curtis AI → Agent**
2. Toggle **Enable agent**
3. (Optional) Adjust **Max turns per response** — the cap on tool-call iterations per message (default 5)

Once enabled, the model picker will show a 🔧 **Tools** pill next to function-calling-capable models on supported providers.

## A different model for agent turns

Chat and agent turns don't have to run on the same model. **Settings → Curtis AI → Agent → Agent model** picks a dedicated provider/model for tool-calling turns — agent mode, leader chats, and the terminal `run_command` tool — while plain chat stays on the chat model. Chat on something light and fast; run the tool loop on something heavier.

- Empty (default) follows the chat model — exactly the old behavior.
- Message bubbles attribute the model that actually answered, so a transcript mixing both reads truthfully.
- A [named agent](AGENTS.md) bound to a chat keeps **its** model — the override only routes the default assistant.
- Swarm followers inherit the leader's effective model (the override) unless they were spawned as a named agent.
- If the override model doesn't support tool calling, Curtis notices and runs the tools on the chat model instead of silently losing them.

## Provider compatibility

The agent works with every major provider. OpenAI-compatible endpoints use OpenAI-style function calling; Anthropic uses its native tool-use API (`tool_use` / `tool_result` blocks).

| Provider | Agent support |
|---|---|
| OpenAI | ✅ |
| **Anthropic** | ✅ native tool use |
| **Google Gemini** | ✅ via Gemini's OpenAI-compatible endpoint |
| OpenRouter | ✅ |
| Groq | ✅ |
| Together / Fireworks / DeepInfra / Novita | ✅ |
| Mistral | ✅ |
| DeepSeek | ✅ |
| Cohere | ✅ |
| **Ollama / LM Studio** | ✅ — requires a tool-capable model (e.g. `qwen2.5`, `llama3.1`) |
| Custom OpenAI-compat endpoints | ✅ — if the upstream server implements function calling |

> [!NOTE]
> Agent mode requires a model that supports tool calling. On local providers, pull a tool-capable model — e.g. `ollama pull qwen2.5:7b-instruct` — or the model will ignore the tools.

## Built-in tools

Eleven tools ship with the plugin — ten work out of the box, and `semantic_search` joins the set when the vault retrieval index is on (**Settings → Vault retrieval**). Two additional **web tools** (`web_search`, `read_url`) are available but opt-in — see [Web tools](#web-tools) below.

| Tool | Description | Parameters |
|---|---|---|
| `read_note` | Read the content of a specific note | `path` (string, required) |
| `search_notes` | Search notes by filename or content | `query` (string, required), `max_results` (number, default 10) |
| `semantic_search` | Meaning-based search over the vault's embedding index — prefer for conceptual queries | `query` (string, required), `max_results` (number, default 5). Requires the vault retrieval index. |
| `create_note` | Create a new note with title and content | `title` (required), `content`, `folder` (default `/`) |
| `edit_note` | Append, prepend, or replace content in a note | `path` (required), `action` (`append`/`prepend`/`replace`, required), `content` (required), `old_content` (for replace) |
| `list_notes` | List notes in a folder or the whole vault | `folder` (default `/`), `max_results` (default 20) |
| `get_tags` | List all tags in the vault, sorted by frequency | (none) |
| `get_backlinks` | Get notes that link to a given note | `path` (required) |
| `get_current_note` | Get content + metadata of the note open in the editor | (none) |
| `get_current_date` | Get the current date, day of week, and time in the user's timezone | (none) |
| `calculator` | Evaluate a math expression | `expression` (string, required) |

## Web tools

Two network tools let the AI look things up outside your vault. **Off by default** — Curtis is vault-first. Opt in at **Settings → Curtis AI → Agent → Enable web tools**. The toggle hot-reloads; no Obsidian restart needed.

| Tool | Description | Parameters |
|---|---|---|
| `web_search` | Search the web via DuckDuckGo (free, no API key) | `query` (string, required), `max_results` (number, default 5) |
| `read_url` | Fetch a URL's main content as clean text via the Jina reader proxy | `url` (string, required) |

**Privacy:** `web_search` queries DuckDuckGo. `read_url` proxies through `r.jina.ai` to extract article content. Both leak the query/URL to those services. Vault contents are never sent — only the query string the model decides to issue.

## MCP servers

The agent's toolset isn't limited to what ships with Curtis. Through the [Model Context Protocol](https://modelcontextprotocol.io) (MCP), Curtis connects to MCP servers you already run — a browser controller, a database client, a GitHub integration — and offers every tool they expose to the model alongside the built-ins.

- **Enable:** Settings → Curtis AI → MCP servers → toggle **Enable MCP**, then **Add server** with a name and its Streamable HTTP URL. Static headers (e.g. `Authorization: Bearer …`) are configurable per server.
- **Requires agent mode** — MCP tools ride the same loop and `agentMaxTurns` cap as the built-ins.
- **Transport:** Streamable HTTP only, on desktop and mobile. Local stdio servers (the `npx some-mcp-server` kind) have no child process to attach to — bridge them with [`mcp-proxy`](https://github.com/sparfenyuk/mcp-proxy) or [`supergateway`](https://github.com/supercorp/supergateway) and point Curtis at the HTTP URL.
- **Naming:** server tools are namespaced `mcp__<server>__<tool>` (e.g. `mcp__github__create_issue`), so they can never collide with the built-in vault tools.

**Privacy:** MCP tool calls go to the server URLs you configure, with the headers you configure. Tool results travel through your AI provider like any other tool result. Curtis performs no MCP OAuth — use static headers against servers you trust.

The direction reverses too: Curtis's MCP server can serve your named agents as tools for outside clients — see [MCP_SERVER.md](MCP_SERVER.md#agents-as-tools).

## GCP connector

Curtis can browse a Google Cloud project's Cloud Storage as agent tools — list buckets, list objects, read files. **Read-only**: the requested OAuth scope is `devstorage.read_only`, and binaries are never inlined (the model sees content type, size, and URI only).

- **Enable:** Settings → Curtis AI → GCP → toggle **Enable GCP connector**, then **Add key** with a service-account JSON key (grant it `roles/storage.objectViewer`, plus bucket-listing permission such as `roles/storage.viewer`). The key is stored in the OS keychain when available.
- **Requires agent mode** — GCP tools ride the same loop and `agentMaxTurns` cap as the built-ins.
- **Naming:** `gcp__storage__list_buckets`, `gcp__storage__list_objects`, `gcp__storage__read_object` — the `gcp__` prefix keeps them clear of vault and MCP tools, and per-agent tool ceilings can exclude them.

See [GCP.md](GCP.md) for setup details.

## Example use cases

**Research synthesis**

> Read my notes tagged `#ai-safety` and draft a 500-word synthesis of the main arguments.

**Daily journaling**

> Create a new note in `Journal/2026/` titled today's date with sections for gratitude, priorities, and reflection. Pre-fill the priorities section with my open tasks from `Tasks/Inbox.md`.

**Cleanup**

> Find all notes in my vault with the `#draft` tag that haven't been modified in 90 days. List them with their last-modified dates so I can decide what to archive.

**Backlink audit**

> Show me all backlinks to `Projects/Aurora.md` and summarize which ones are stale (the linking note hasn't been touched in 6 months).

**Reorganization**

> Search for notes matching "rust async" and create a new index note at `Indexes/rust-async.md` that wikilinks to all of them.

## Safety

The agent is powerful but bounded:

- **`agentMaxTurns` cap** (default 5) — prevents infinite tool loops. If the model is still calling tools after 5 turns, the conversation stops with a notice.
- **No per-call confirmation** — tool calls auto-execute. There's no "approve this tool call?" prompt. If you want human-in-the-loop, leave the agent disabled and use selection actions instead.
- **Vault writes are immediate** — `create_note` and `edit_note` modify your vault the moment the model invokes them. Use Obsidian's File Recovery (Settings → File recovery) if you need to roll back.

> [!WARNING]
> The agent auto-approves tool calls. Treat it like giving a junior collaborator write access to your vault: great for well-scoped tasks, risky for vague prompts. Be specific about what you want created or changed.

### Disabling the agent

Toggle it off at **Settings → Agent → Enable**. When disabled, the plugin never advertises tools to the model — function-calling is fully inert.

## Privacy

- **Tool calls go to your AI provider.** The model sees the tool definitions (name, description, parameter schema) as part of the request. When a tool executes, the result string is sent back to the provider in the next turn.
- **Vault contents are sent when read.** If the model calls `read_note("Projects/Aurora.md")`, the contents of that note leave your machine (on a cloud provider).
- **Tool definitions themselves are not sensitive** — they're standard schema descriptions, no user data.
- For fully offline agent use, enable Ollama with a tool-capable model (e.g. `qwen2.5:7b-instruct`). Nothing leaves your machine.

## Adding custom tools

Tools are registered via `ToolRegistry` in `src/core/tools.ts`. See [CONTRIBUTING.md](../CONTRIBUTING.md#how-to-add-a-new-tool) for the step-by-step.

The shape is:

```ts
registry.register({
  name: 'my_tool',
  description: 'What this tool does, so the model knows when to call it',
  parameters: {
    input: { type: 'string', description: 'The input', required: true },
  },
  execute: async (params, context) => {
    return `Result: ${params.input}`;
  },
});
```

## Context precedence

When you attach notes via [@-mentions](MENTIONS.md), those notes are prepended to your message as context **before** the agent's tools run. The model sees both:

1. The attached note contents (from `@`)
2. Whatever it reads via `read_note` / `search_notes` / `get_current_note`

There's no conflict resolution — the model just sees more context. If attachments and tool reads disagree, the model decides what to trust.

## Roadmap

- ~~Anthropic, Gemini, Ollama provider support~~ — shipped in v1.1
- ~~Web search tool~~ / ~~URL fetch tool~~ — shipped (opt-in)
- Per-call confirmation mode (opt-in human-in-the-loop)
- Task management tool
- Semantic memory query tool

## See also

→ [AGENTS.md](AGENTS.md) — named agents: personas, model routing, and tool ceilings on top of this loop
→ [SWARM.md](SWARM.md) — leader chats that spawn this loop as follower agents
