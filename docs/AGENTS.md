# Named agents

> Every agent gets its own lane; Curtis coordinates. A lane is a persona + a model + a tool ceiling — bind it to any chat, or hand it to a swarm leader as a specialist.

An agent is a **named, reusable worker config**: what the model is (persona), where it runs (provider + model), and what it may touch (tool access). Not a separate runtime — it resolves inside Curtis's normal [agent loop](AGENT.md) at send time.

This doc is about the workers. For the tool loop itself — the thing every agent runs on — see [AGENT.md](AGENT.md).

## Creating agents

**Settings → Curtis AI Chat → Agents → New agent…**

| Field | What it does |
|---|---|
| Name · emoji | How the agent appears in pickers, the header pill, and the swarm roster |
| Model routing | This agent's requests always go to this provider/model — regardless of the pane's picker |
| Persona | The role. Layered after the core harness prompt and your global system prompt — the role wins ties; your standing orders survive it |
| Tool access | Three ceilings: vault tools, web tools, MCP. An agent can only **narrow** what the global toggles allow, never widen |
| Remote invocation | **Off by default.** When on, MCP clients and plugins may run the agent headlessly (`run_agent` / `runAgent`) — see [MCP_SERVER.md](MCP_SERVER.md#agents-as-tools) |
| Memory | `Follow global` · `always on` · **`off`** — see the privacy note below |
| Profile claims | Consent policy for the [claims profile](#claims-profile) — which claim classes this agent may see |
| Max tool turns | Optional override of the global agent loop cap |

## Binding an agent

Any of these, one step:

- The **pill in the chat header** (next to the model picker) — appears once the chat has an agent, click to change
- **`/agent`** — bare opens a picker; `/agent editor` fuzzy-matches a name; `/agent off` clears
- The pane's **"..." menu → Set agent…**
- Command palette → **New chat with agent…** — opens a fresh pane already bound

Switching agents mid-conversation works: the transcript records which agent wrote each turn, and history stays intact.

## What a binding changes

- **Model routing** — an Editor can run on Claude, a Librarian on local Ollama, regardless of what the rest of the app uses. Cost estimate and token counts follow the agent's model.
- **Persona** — appended after the CORE prompt and your global extension, so harness behavior (tool honesty, context precedence) is never overridable by a role.
- **Tool ceiling** — a no-vault agent cannot read or edit notes, run commands, or spawn swarm followers; a no-web agent never sees `web_search` / `read_url`; no-MCP hides every `mcp__` tool. Tools the global settings never enabled stay absent regardless.
- **Memory** — **privacy, not just preference**: a fact a memory-`off` agent learns never enters `AI/Curtis Memory.md`, so it cannot ride a later cloud conversation out of your machine. Local-only agents (Ollama + no web + memory off) are private end to end.

## Swarm specialists

A [leader chat](SWARM.md) sees the roster in its system prompt and can spawn any agent as a follower:

> spawn_agent({ task: "compare these three papers' methodologies", agent: "Researcher" })

The specialist brings its own model, persona, and tool ceilings; a vault-less leader cannot spawn vault work at all. Omitting `agent` keeps today's behavior — a follower inheriting the leader's model.

## Claims profile

Settings → Agents → **Claims profile** opens (or creates) `AI/PCP.md` — a personal context profile with one section per claim class:

```markdown
## PEP-P — Personality
- voice: direct, technical

## PEP-D — Developer
- languages: TypeScript, Rust
```

Each agent's **Profile claims** field is a consent policy: a comma-separated list of the classes it may see (`PEP-P, PEP-D`; `*` = all; empty = none). At send time Curtis injects only the consented sections into that agent's context, labeled as self-reported facts — never instructions. Sections without a `PEP-` heading token are never injected, and nothing is read at all for agents without a policy. This is consent-governed identity: your Researcher can see your developer claims while being denied your health ones, provably, per lane.

## Deliberate limits (v1)

- **No per-tool allowlists** — three tool-class toggles, not per-tool or per-MCP-server grants.
- **No per-agent memory stores** — memory is one shared file; the tri-state only gates participation.
- **Agents don't talk to each other** — every collaboration path runs through Curtis: you switching lanes, a leader delegating, or the [arena](ARENA.md) comparing. No free agent-to-agent channels.
- **Sampling overrides** — persona, routing, ACL, and loop cap are per-agent; temperature/maxTokens still come from the provider/model override layers.
- **Claims are chat-injection only** — swarm followers don't inherit the profile yet; networked claims (resolver/federation) live in the PCP project and will arrive as an MCP server, not plugin code.

## See also

→ [AGENT.md](AGENT.md) for the tool loop every agent runs on
→ [SWARM.md](SWARM.md) for leader mode and follower agents
→ [PROVIDERS.md](PROVIDERS.md) for the provider list agents can route to
