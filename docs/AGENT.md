# Curtis Agent

> AI tools that read, create, and edit your vault notes.

The Curtis Agent lets the AI call **tools** during a conversation. Instead of only answering from its training data, the model can search your vault, read specific notes, create new ones, and edit existing ones — all in service of your prompt.

## What it is

When the agent is enabled, every chat message can trigger tool calls. The model decides which tool to invoke based on your prompt, the plugin executes the tool locally against your vault, and the result is fed back to the model. This loop continues until the model produces a final answer or hits the `agentMaxTurns` cap.

Think of it as giving the AI a small set of hands inside your vault.

## Enabling the agent

Opt-in — the agent is **off by default**.

1. **Settings → Curtis AI Chat → Agent**
2. Toggle **Enable agent**
3. (Optional) Adjust **Max turns per response** — the cap on tool-call iterations per message (default 5)

Once enabled, the model picker will show a 🔧 **Tools** pill next to function-calling-capable models on supported providers.

## Provider compatibility

The agent uses OpenAI-style function calling. For v1.0, only **OpenAI-compatible providers** are supported.

| Provider | Agent support |
|---|---|
| OpenAI | ✅ |
| OpenRouter | ✅ |
| Groq | ✅ |
| Together / Fireworks / DeepInfra / Novita | ✅ |
| Mistral | ✅ |
| DeepSeek | ✅ |
| Cohere | ✅ |
| Custom OpenAI-compat endpoints | ✅ |
| **Anthropic** | ⚠️ v1.1 |
| **Google Gemini** | ⚠️ v1.1 |
| **Ollama / LM Studio** | ⚠️ v1.1 |

> [!NOTE]
> Anthropic, Gemini, and Ollama use different function-calling shapes. Wiring them in is tracked for v1.1. For now, route through OpenRouter if you need Claude/Gemini with tools.

## Built-in tools

Nine tools ship with the plugin, all read/write against your vault. Two additional **web tools** (`web_search`, `read_url`) are available but opt-in — see [Web tools](#web-tools) below.

| Tool | Description | Parameters |
|---|---|---|
| `read_note` | Read the content of a specific note | `path` (string, required) |
| `search_notes` | Search notes by filename or content | `query` (string, required), `max_results` (number, default 10) |
| `create_note` | Create a new note with title and content | `title` (required), `content`, `folder` (default `/`) |
| `edit_note` | Append, prepend, or replace content in a note | `path` (required), `action` (`append`/`prepend`/`replace`, required), `content` (required), `old_content` (for replace) |
| `list_notes` | List notes in a folder or the whole vault | `folder` (default `/`), `max_results` (default 20) |
| `get_tags` | List all tags in the vault, sorted by frequency | (none) |
| `get_backlinks` | Get notes that link to a given note | `path` (required) |
| `get_current_note` | Get content + metadata of the note open in the editor | (none) |
| `calculator` | Evaluate a math expression | `expression` (string, required) |

## Web tools

Two network tools let the AI look things up outside your vault. **Off by default** — Curtis is vault-first. Opt in at **Settings → Curtis AI Chat → Agent → Enable web tools**. The toggle hot-reloads; no Obsidian restart needed.

| Tool | Description | Parameters |
|---|---|---|
| `web_search` | Search the web via DuckDuckGo (free, no API key) | `query` (string, required), `max_results` (number, default 5) |
| `read_url` | Fetch a URL's main content as clean text via the Jina reader proxy | `url` (string, required) |

**Privacy:** `web_search` queries DuckDuckGo. `read_url` proxies through `r.jina.ai` to extract article content. Both leak the query/URL to those services. Vault contents are never sent — only the query string the model decides to issue.

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
- For fully offline agent use, switch to Ollama once v1.1 lands. Until then, the agent requires a cloud OpenAI-compatible provider.

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

- Anthropic, Gemini, Ollama provider support (v1.1)
- Web search tool
- URL fetch tool
- Per-call confirmation mode (opt-in human-in-the-loop)
- Task management tool
- Semantic memory query tool
