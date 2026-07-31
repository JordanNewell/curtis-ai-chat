# Curtis AI Chat — Demo Vault

A staged Obsidian vault for screenshots, video demos, and live walkthroughs of Curtis AI Chat. Uses Ollama (fully local — no API keys to leak), four persona folders for visual variety, and a curated shot list in [SHOTS.md](./SHOTS.md).

## What this is

- **Not a real vault.** Every note is staged content. No real people, no real companies. Personas are fictional composites.
- **Committed to the public repo.** Anyone can clone `JordanNewell/curtis-ai-chat` and open `demo-vault/` as a vault to explore the plugin with realistic content.
- **Uses Ollama by default.** Cleanest for screenshots (no API key redaction), on-brand with the local-first pitch, works offline during video recording.

## Setup (5 minutes)

### 1. Install Ollama + pull the demo model

```bash
# macOS / Linux
curl -fsSL https://ollama.com/install.sh | sh

# Windows: download the installer from https://ollama.com/download/windows

# Pull the default demo model (~4.7 GB, one-time)
ollama pull qwen2.5:7b-instruct

# Optional: pull a second model for arena demos
ollama pull qwen2.5:3b-instruct
ollama pull llama3.2:3b-instruct
```

Verify Ollama is serving: `curl http://localhost:11434/api/tags` should return JSON.

### 2. Build the plugin + sync into the demo vault

From the repo root:

```bash
npm install
npm run build
./scripts/sync-demo-plugin.sh     # macOS/Linux) or .\scripts\sync-demo-plugin.ps1 (Windows)
```

This copies `main.js`, `manifest.json`, `styles.css` from the repo root into `demo-vault/.obsidian/plugins/curtis-ai-chat/`.

### 3. Open the vault in Obsidian

Open Obsidian → **Open folder as vault** → select `demo-vault/`.

Enable **Curtis AI Chat** under Settings → Community plugins if it isn't already enabled.

### 4. Verify

Click the robot icon in the left ribbon (or `Ctrl+Shift+G`). The chat sidebar opens on the right. Type "hello" — Ollama should respond in 3-5 seconds.

## What's in the vault

Four persona folders, each with realistic staged content. Use the persona that fits the feature you're demoing:

| Folder | Persona | Best for |
|---|---|---|
| `01_researcher/` | Dr. Elena Vasquez, MIT CSAIL postdoc working on LLM reasoning | Memory facts, RAG-style @-mention, multi-model arena (compare model quality) |
| `02_pm/` | Marcus Chen, Sr PM at Anchor (B2B SaaS) | Agent tools (create/edit notes), @-mention meetings, slash commands |
| `03_writer/` | Priya Shah, freelance writer | Inline diff rewrite, selection actions (improve / fix grammar / shorten) |
| `04_founder/` | Alex Okafor, solo founder of Pylon (devtools) | Agent tools (read decisions, create notes), memory facts, voice I/O |

Plus:
- `AI/Curtis Memory.md` — pre-staged memory facts (persona-agnostic so they work in any shot)
- `SHOTS.md` — shot list with persona + prompt + framing notes per scenario

## Taking screenshots

See [SHOTS.md](./SHOTS.md) for the full shot list. Quick guidance:

- **Window size:** 1440×900 (standard laptop) or 1920×1080 (desktop). Pick one and stick to it across all shots.
- **Theme:** Default Obsidian dark (already configured). Accent color is set to the Curtis green `#34D399`.
- **Font size:** 15pt body, JetBrains Mono for code (configured in `.obsidian/appearance.json`).
- **Clean frame:** Close the file explorer for narrow shots. Show it for "vault context" shots.
- **Hide UI:** `Cmd/Ctrl+P` → "Toggle sidebar" hides the left ribbon for ultra-clean shots.

## Refreshing the plugin after code changes

```bash
# From repo root
npm run build
./scripts/sync-demo-plugin.sh
# In Obsidian: Cmd/Ctrl+P → "Reload app without saving"
```

## Resetting to a clean state

If the chat history or memory gets cluttered during a demo session:

```bash
# Clear conversation history (in plugin UI): /clear slash command
# Reset memory to defaults:
git checkout demo-vault/AI/"Curtis Memory.md"
# Reset plugin settings:
git checkout demo-vault/.obsidian/plugins/curtis-ai-chat/data.json
```

## License

Demo content is MIT (same as the plugin). Persona names and companies are fictional; any resemblance to real people or orgs is coincidental.
