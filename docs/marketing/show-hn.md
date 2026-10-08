# Show HN — Curtis AI Chat

**Submit as:** a link post to https://github.com/JordanNewell/curtis-ai-chat with this title (78 chars):

**Title:** Show HN: Curtis – BYOK AI chat for Obsidian (30+ providers, multi-model arena)

HN doesn't embed images; the repo README autoplays the arena demo GIF on load, which is the point of linking the repo. If you want a direct link in the body, use: https://raw.githubusercontent.com/JordanNewell/curtis-ai-chat/master/assets/demo-arena-cloud-vs-cloud.gif (local copy: `assets/demo-arena-cloud-vs-cloud.gif`)

---

## Post body

Hi HN — I'm Jordan. I built Curtis because I wanted one chat sidebar inside Obsidian that could talk to any model I have a key for, and specifically because I kept wanting to run the same prompt through two models and compare. That comparison is built in as the "arena": pick two models, one prompt fans out into two streaming columns, each column is independently abortable, and promoting the winner converts it into a normal single-model chat.

Technical shape: it's a TypeScript plugin bundled with esbuild to a single `main.js` (one runtime dependency, `fflate`, for zip import/export). API keys go into the OS keychain through Obsidian's SecretStorage, not into files. Every conversation persists as a markdown note in the user's vault rather than a database, and hand edits to those notes round-trip through the vault's file watcher. The agent mode gives the model 11 vault tools (read/search/create/edit notes, backlinks, tags, semantic search) plus any MCP server you already run. Local-first throughout: Ollama and LM Studio are built-in providers, and the retrieval index (int8-quantized embeddings over your notes) can run on a local embeddings model. No telemetry, no analytics, no background requests — the README enumerates every domain the plugin can contact. Mobile works, with a buffered fallback when a provider's CORS blocks streaming.

Honest limits: it's BYOK, so you manage keys and providers' rate limits apply (the arena can trip a free-tier 429 with two columns firing at once). Speech-to-text is OpenAI Whisper only because the browser stack gives me recording and Whisper's API takes care of the rest. MCP support is Streamable HTTP — local stdio servers need an HTTP bridge.

Repo: https://github.com/JordanNewell/curtis-ai-chat
Docs: https://jordannewell.github.io/curtis-ai-chat

## First comment (post it yourself, right after submitting)

Author here. Anticipating a few questions:

**Why a plugin and not a standalone app?** The vault is the product. The chat's whole job is reading and writing the user's actual notes — files on disk, with whatever structure they already have. Obsidian gives me the file system context, markdown rendering through the user's own theme, settings search, keychain storage, and mobile for free. A standalone app would mean rebuilding a worse file browser and getting worse trust properties (people already audit what their Obsidian plugins can touch).

**Why not just use the vendor apps?** Partly the juggling — one sidebar, any model, keys I control, pay-per-token instead of per-seat subscriptions. But the real answer is the arena: model choice is usually vibes, and a head-to-head on your actual prompt makes it empirical. The other part is that the vendor apps don't know your vault. Curtis' agent tools and retrieval are vault-native, and chats themselves land as markdown notes, so the AI's output is where your other notes are.

**What actually leaves my machine?** With a cloud provider: message text, attached images/notes, and tool-call results — same as pasting into the vendor's site, and keys never leave the keychain. With Ollama/LM Studio: nothing. There's no telemetry at all; every outbound request is user-initiated, and the README has the full domain table (provider APIs, optionally DuckDuckGo/Jina for the agent's opt-in web tools, optionally your own MCP servers).

**Why should I trust a random plugin with API keys?** Fair. Keys go to the OS keychain via Obsidian's SecretStorage API — never into the vault, never into localStorage. Source is MIT and small enough to read in an afternoon; releases ship with build-provenance attestation, and the plugin directory's automated review is clean (that process is partly why the network-access table exists in the README).
