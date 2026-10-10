# Vault retrieval (RAG)

> Curtis embeds your notes once, then quietly hands the model the relevant excerpts with every message — and `semantic_search` becomes an agent tool.

Vault retrieval is how Curtis answers questions about notes it hasn't been pointed at. Your notes are chunked, embedded, and indexed; on each send, excerpts from the notes most relevant to your message are injected into the prompt automatically. Meaning-based, not keyword-based — "that thread about the Kepler launch" finds the note titled *Rocketry log*.

**Off by default.** Settings → Curtis AI → **Vault retrieval** → enable. Building the index is a separate, explicit step (below).

## The two halves

| Piece | What it does |
|---|---|
| **Auto-injected context** | Every send (with the feature on and an index built), Curtis searches the index for your latest message and injects the top excerpts into the system prompt — path-addressed, marked as partial, with an instruction to use `read_note` for the full file. Notes already attached via `@`-mention are skipped (their full contents are already there). Low-scoring chunks are dropped as noise, and at most 2 chunks per note are taken so one long file can't crowd out the rest. |
| **`semantic_search` agent tool** | The model can also search the index itself when a question is conceptual — prefer it over `search_notes` for meaning-based queries. Appears and disappears with the toggle (hot-reloads; no restart). |

## Building and maintaining the index

Press **Rebuild index** in the settings group. Progress shows per note; the status row reports notes, chunks, and when it was built.

- **Rebuilds are incremental** — unchanged notes are skipped, so a warm rebuild only pays embeddings for edited notes.
- **Edits are followed live** — save a note and it re-embeds after a short debounce. With retrieval disabled or no index built, nothing ever runs in the background: zero idle token spend.
- **Changed embedding provider/model?** Curtis detects the mismatch and the status row tells you to rebuild — vectors from different models don't mix.

## Settings

| Setting | What it does |
|---|---|
| **Enable vault retrieval** | Master toggle. Hot-reloads the agent tool. |
| **Relevance pulse** | When the note you open closely matches a past conversation, a "discussed in …" hint appears under the chat header. Local-only similarity — no API calls. Deliberately tuned for precision: a false "we discussed this" is worse than a missed one. |
| **Embedding provider** | Any OpenAI-compatible `/embeddings` endpoint. **Ollama and LM Studio work fully offline.** Anthropic has no embeddings API and is excluded. |
| **Embedding model** | Model ID sent to the endpoint (default `text-embedding-3-small`). |
| **Chunk size / overlap** | Characters per chunk (default 500) and overlap between chunks (default 50). |
| **Results per query** | How many excerpts to inject per send: 3 / 5 / 8 / 12. |

## Storage & privacy

The index lives in `<plugin dir>/rag-index.json` next to `data.json` — a single file, vectors int8-quantized to keep real vaults viable. It is not a vault note: invisible to Obsidian search, never synced as content, never merged into settings.

- **Embedding sends note contents to the embedding endpoint you configure.** That is the one egress — pick Ollama/LM Studio and the whole pipeline is local.
- Injected excerpts travel to your chat provider like any other prompt text.
- Excerpts are always partial and path-labeled; the model is told to read the full note when it needs more.

## See also

→ [AGENT.md](AGENT.md) — the `semantic_search` tool in the agent toolset
→ [MCP_SERVER.md](MCP_SERVER.md) — the MCP server exposes the same semantic search to external clients
→ [MEMORY.md](MEMORY.md) — facts Curtis remembers vs. notes it retrieves
