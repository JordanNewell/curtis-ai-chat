# GitHub Release 1.0.0 — Curated Notes

**Use:** After tag push triggers `release.yml`, the workflow creates the release with `--generate-notes` (auto). Edit the release and paste this body in. Or: push tag → wait for workflow → `gh release edit 1.0.0 --notes-file marketing/v1.0.0-launch/10-release-notes.md`.

**Title:** `Curtis AI Chat 1.0.0` (workflow defaults to just `1.0.0`; bump it manually via `gh release edit 1.0.0 --title "Curtis AI Chat 1.0.0"`)

---

## Body

**Polyglot AI chat for Obsidian. Thirty-plus providers, one sidebar. Your data stays in your vault.**

Initial public release. Eight flagship features, full TypeScript type-safety at every provider boundary, and build-provenance attestation on every release asset.

### At a glance

| | |
|---|---|
| **Version** | `1.0.0` (manifest + tag match, no `v` prefix) |
| **minAppVersion** | `1.13.0` |
| **Plugin ID** | `curtis-ai-chat` |
| **Providers** | 30+ built-in (Anthropic, OpenAI, Gemini, Ollama, OpenRouter, Groq, and 24 more) |
| **License** | MIT |
| **Repo** | https://github.com/JordanNewell/curtis-ai-chat |
| **Changelog** | [CHANGELOG.md](https://github.com/JordanNewell/curtis-ai-chat/blob/master/CHANGELOG.md) |

### Highlights

#### 🤖 Curtis Agent
AI calls tools to read, create, and edit your vault notes. Nine built-in tools: `read_note`, `search_notes`, `create_note`, `edit_note`, `list_notes`, `get_tags`, `get_backlinks`, `get_current_note`, `calculator`. OpenAI-compat providers for v1.0 (Anthropic/Gemini/Ollama agent support lands in v1.1). Opt-in via Settings → Agent → Enable.

#### ⚔️ Multi-model arena
Wand icon in the chat header. Pick 2–5 models, send one prompt, watch responses stream side-by-side. Click **Promote to chat** on any column to continue with that model. Compare quality, latency, and cost live.

#### 🎨 Inline diff rewrite
Select text in any note → `Ctrl+Shift+R` (or right-click → **Rewrite with AI (diff)**). AI generates an improved version and a modal shows line-by-line green/red diff. Accept or reject. Cursor-style review workflow.

#### @ @-mention vault notes
Type `@` in the chat input → fuzzy-search your vault → click a result to attach. Note content is prepended to your message as invisible context. The active note also gets a one-click pill in the chat header.

#### 🎙️ Voice I/O
Mic button uses `MediaRecorder` + OpenAI Whisper for speech-to-text. Speaker button on every assistant message uses browser `speechSynthesis` (no API key). Auto-speak toggle in the header for hands-free listening.

#### 🔍 Cross-conversation search
`Ctrl+Shift+F` opens a fuzzy-matched picker across every conversation and every message. Click a result to jump.

#### 📝 Markdown export
`/export` slash command or download icon in the chat header. Provider display names, timestamps, image references preserved.

#### 🧠 Memory editing UI
Facts live in an editable list under Settings → Memory. Delete or edit individual facts.

#### 🔒 Type-safety + provenance
Full TypeScript schemas for every AI provider response shape. Type-guard narrowing at every JSON boundary. Internal code never sees `any`. Zero lint warnings on `npm run build`. Build-provenance attestations on every release asset so you can verify what you download was built from public source.

### Install

**Option 1 — Obsidian community directory** (once the v1.0.0 submission clears review):
Settings → Community plugins → Browse → search "Curtis AI Chat" → Install → Enable.

**Option 2 — Manual**:
1. Download [`main.js`](https://github.com/JordanNewell/curtis-ai-chat/releases/latest/download/main.js), [`manifest.json`](https://github.com/JordanNewell/curtis-ai-chat/releases/latest/download/manifest.json), and [`styles.css`](https://github.com/JordanNewell/curtis-ai-chat/releases/latest/download/styles.css).
2. Create `<vault>/.obsidian/plugins/curtis-ai-chat/`.
3. Copy the three files in.
4. Settings → Community plugins → refresh → enable **Curtis AI Chat**.

**Option 3 — BRAT** (beta channel):
1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat).
2. BRAT settings → Add Beta plugin → `JordanNewell/curtis-ai-chat`.
3. BRAT installs the latest release and keeps you updated.

### Verify build provenance

Each release asset has a Sigstore attestation proving it was built from public source by GitHub Actions. Verify with [gh attestation](https://cli.github.com/manual/gh_attestation_verify):

```bash
gh attestation verify main.js \
  --repo JordanNewell/curtis-ai-chat \
  --bundle attestation.json
```

Or download `attestation.json` from the release assets and verify offline. Requires `gh` 2.12+.

### What's next

- **v1.1** — Curtis Agent support for Anthropic, Gemini, Ollama
- **v1.1** — Word-level diff + inline editor decorations for rewrite
- Voice: streaming TTS, wake-word detection
- Conversation branching UI
- Plugin settings import/export

[Open issues](https://github.com/JordanNewell/curtis-ai-chat/issues) · [Discussions](https://github.com/JordanNewell/curtis-ai-chat/discussions) · [Full changelog](https://github.com/JordanNewell/curtis-ai-chat/blob/master/CHANGELOG.md)

---

## Social proof block (append if helpful)

If Curtis AI Chat saves you time, consider [sponsoring](https://github.com/sponsors/jordannewell) or [buying me a coffee](https://www.buymeacoffee.com/jordannewell). The plugin is and will remain free and open source under MIT — sponsorship is voluntary and never required for any feature.
