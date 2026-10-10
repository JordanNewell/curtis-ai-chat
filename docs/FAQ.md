# FAQ & troubleshooting

> Quick answers to the questions that actually come up. Every answer links to the full story.

## Setup

**The model never calls tools / ignores my vault.**
Agent mode needs a model that supports tool calling — most cloud models do; on local providers pull a tool-capable one (`ollama pull qwen2.5:7b-instruct`). Agent mode must also be enabled (Settings → Agent → Enable). If your "Agent model" override doesn't support tools, Curtis falls back to the chat model with a notice. → [AGENT.md](AGENT.md)

**The model picker is empty or missing a model I know exists.**
Most providers auto-discover their catalog from `/v1/models` at runtime; the built-in list is only a fallback. If discovery lags a provider's real lineup, use **Add model** on the provider card — manually added ids are always offered and never pruned. → [PROVIDERS.md](PROVIDERS.md)

**A provider returns 400 "unsupported field".**
Strict APIs reject unknown request fields. Curtis gates known ones per provider; if a field still leaks through, check **Copy last request JSON** on the provider card to see exactly what hit the wire, and remove overrides (or use per-provider resets) until it's clean. → [PROVIDERS.md](PROVIDERS.md#advanced-request-parameters)

**Where did my API key go / where is it stored?**
In the OS keychain (Obsidian 1.13+), never in `data.json`. ChatGPT sign-in tokens live there too. → [PROVIDERS.md](PROVIDERS.md)

## Chats & data

**Where are my conversations stored?**
Every chat is a markdown note in `AI/Conversations/` — plain files, synced and searchable like any note. History from before this system (localStorage) imported itself once on upgrade. Deleting the file deletes the chat. → [IMPORT.md](IMPORT.md#where-chats-live)

**I deleted a chat / broke a conversation file by editing it.**
There is no database and no trash for conversation files — the file is the storage. Edit carefully: the `<!-- curtis:msg -->` markers carry machine metadata; keep them intact. Restore from a vault sync/backup if you have one, or re-import a `.curt` export. → [IMPORT.md](IMPORT.md)

**How do I move chats to another vault or machine?**
Copy the `AI/Conversations/` folder, or use **Export all chats as .curt (zip)** and import the zip on the other side — re-importing skips what's already there. → [IMPORT.md](IMPORT.md#bulk-export)

## Privacy

**What leaves my machine?**
By default: only what you send to the AI provider you configured. Everything networked beyond that is opt-in and listed in one sentence in [llms.txt](llms.txt) — web tools (DuckDuckGo/Jina), MCP server URLs, GCP, ChatGPT sign-in, dictation (Whisper), and link favicons (one toggle, off = fully local rendering). Local providers + web tools off + favicons off = nothing leaves the machine. → [PROVIDERS.md](PROVIDERS.md), [VOICE.md](VOICE.md#privacy), [LINK_PREVIEWS.md](LINK_PREVIEWS.md)

**Can a local-only agent leak my notes to the cloud?**
Not through chat — but through shared memory it could, which is exactly what the per-agent **memory: off** tri-state severs. A memory-off agent's facts never enter the shared memory file. → [AGENTS.md](AGENTS.md)

## Features behaving unexpectedly

**The mic button does nothing.**
Your environment lacks `MediaRecorder` support or mic permission. All desktop Obsidian is fine; iOS 16+ and modern Android need explicit per-app permission (granted once, it persists). → [VOICE.md](VOICE.md#mobile-considerations)

**Text-to-speech is silent or uses the wrong voice.**
Voice lists load asynchronously — the settings dropdown fills in when the OS delivers them. A voice picked on one machine that doesn't exist on another silently falls back to auto. → [VOICE.md](VOICE.md)

**A scheduled run didn't fire.**
Curtis is an Obsidian plugin — nothing runs while Obsidian is closed. Due-checks run every 30 seconds while it's open; a daily job missed while closed fires once on next launch. Mobile needs the app in the foreground. → [SCHEDULED_RUNS.md](SCHEDULED_RUNS.md)

**Claude Desktop can't connect to the Curtis MCP server.**
The server binds 127.0.0.1 only, requires the bearer token from Settings → MCP server, and refuses non-loopback hosts and browser origins. Desktop only. The settings page has a copy-ready `claude mcp add` command. → [MCP_SERVER.md](MCP_SERVER.md)

**My arena run cost 4× what a normal message costs.**
Arena streams one prompt to every selected model — 2–4 columns means 2–4 full request streams, each billed by its provider. The picker warns; `/stats` shows spend. → [ARENA.md](ARENA.md)

**Autocomplete is sending my notes somewhere?**
Only if you turned it on — it's off by default. When enabled, each suggestion sends the text around your cursor to its configured provider. Dedicated model picker, throttled, cached. → [AUTOCOMPLETE.md](AUTOCOMPLETE.md)

**Semantic search returns nothing / the agent says the index is missing.**
Build it: Settings → Vault retrieval → **Rebuild index**. If you changed the embedding provider or model, the old vectors don't mix — rebuild again. → [VAULT_RETRIEVAL.md](VAULT_RETRIEVAL.md)

## Still stuck

Check the dev console (`Ctrl+Shift+I`) for errors, then [file an issue](https://github.com/JordanNewell/curtis-ai-chat/issues) with your Obsidian version, plugin version, provider + model, and the console output. Security issues go to [security@jordannewell.com](mailto:security@jordannewell.com) — never a public issue. → [CONTRIBUTING.md](../CONTRIBUTING.md#filing-issues)
