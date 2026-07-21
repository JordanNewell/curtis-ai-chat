<h1 align="center">ObsiBuddi</h1>

<p align="center">A genuinely agnostic AI chat for Obsidian. Thirty-plus providers, one sidebar. Local-first when you want it, cloud when you don't.</p>

<p align="center">
  <a href="#installation">Installation</a> ·
  <a href="docs/PROVIDERS.md">Providers</a> ·
  <a href="docs/SLASH_COMMANDS.md">Slash Commands</a> ·
  <a href="docs/MEMORY.md">Memory</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

---

> [!NOTE]
> **v3.0.0** ships a redesigned chat panel, 30+ built-in providers, image attachments, a real memory system, and a slash-command language. The plugin was rewritten end-to-end from v2 — see [CHANGELOG.md](CHANGELOG.md).

## What is this

ObsiBuddi is an AI chat that lives in your Obsidian sidebar. Ask anything; the answer streams back into the panel. Right-click a selection in any note and improve, summarize, TL;DR, refactor, or convert it in place. Drag an image in and ask about it. The chat history, your preferences, and your attachments all stay in your vault.

It works with **any provider you have a key for** — Anthropic, OpenAI, Gemini, Z.ai, Mistral, Groq, xAI, Perplexity, Cohere, DeepSeek, OpenRouter, and 18 more — plus **Ollama and LM Studio** for fully local, offline AI. Switch providers from the header; the chat keeps going.

## Why ObsiBuddi

- **Your data stays yours.** Conversations live in `localStorage`. Image attachments are saved as real files in your `attachments/` folder — visible, auditable, deletable. Memory is a markdown file you can read and edit. No telemetry. No tracking. No "phone home."
- **No vendor lock-in.** Thirty providers ship built-in. Add any OpenAI-compatible endpoint as a custom provider in 30 seconds. Switch models mid-conversation.
- **Local-first when you need it.** Enable Ollama and nothing ever leaves your machine. Useful for private notes, air-gapped machines, or when you just don't want to pay per token.
- **Native Obsidian feel.** Settings use the real Obsidian setting components. Messages render through Obsidian's `MarkdownRenderer` so code blocks, wikilinks, and callouts look right. Themes are respected — light, dark, Things, Minimal, all of them.

> [!IMPORTANT]
> **API keys are stored in your OS keychain** (Windows Credential Manager, macOS Keychain, Linux Secret Service) on Obsidian 1.11.4+. Plaintext fallback only exists for older Obsidian versions and is never committed to git.

## Features

### Chat that gets out of your way

- Streaming responses with a clean Telegram-style bubble layout
- Model picker with capability pills (vision 👁, tools 🔧, context length)
- Per-message hover actions: copy, quote-into-input, save-as-note, insert-into-active-note, regenerate, edit-and-resend
- Conversation history with search

### Image attachments

- **Paste** (Ctrl+V), **drag-and-drop**, or **paperclip** — three ways to attach
- Images save as real vault attachments (not base64 blobs in localStorage)
- Vision-capable models see them automatically; non-vision models get a clear "switch to a vision model" notice
- Transcripts via `/save-all` embed images as `![[wikilinks]]`

### Inline selection actions

Right-click any selection in a note for:

- **Explain · ELI5 · Summarize · TL;DR · Improve · Fix grammar · Shorten**
- **Translate · Extract key points · Extract wikilinks · Make a table · Pros & cons · Convert to callout**
- **Code review · Explain code · Refactor · Add tests**

Each writes the result directly back into the note — replace the selection or insert below.

### Slash commands

Type `/` in the chat input for an autocomplete menu:

```
/clear          /regen          /title <text>     /copy
/note [name]    /save-all       /paste            /model <name>
/provider <x>   /system <text>  /stats            /remember <fact>
/forget <x>     /memory         /help
```

See [docs/SLASH_COMMANDS.md](docs/SLASH_COMMANDS.md) for the full reference.

### Long-term memory

ObsiBuddi remembers durable facts about you across conversations — preferences, identity, projects, standing instructions. Facts live in a markdown file in your vault (`AI/ObsiBuddi Memory.md` by default) so you can read, edit, and correct them by hand.

- **Auto-capture**: after each turn, a background model call extracts 0–3 durable facts as JSON
- **Manual**: `/remember <fact>` or right-click any selection → **Save to memory**
- **Recall**: every prompt includes a `## What you know about the user` block — full injection, no naive substring matching
- **Manage**: `/memory` to list, `/memory open` to jump to the file, `/memory clear` to wipe

See [docs/MEMORY.md](docs/MEMORY.md) for the design and file format.

### Customizable

- Chat panel position (left/right), width, background (theme default or a wallpaper image from your vault)
- Configurable system prompt, temperature, max tokens
- Enter-key behavior: Enter-to-send (default) or Enter-for-newline
- Auto-save assistant responses to a folder of your choice
- Show or hide token counts after each response

## Installation

> [!TIP]
> ObsiBuddi isn't in the community plugin store yet. For now, install manually (below) or via [BRAT](https://github.com/TfTHacker/obsidian42-brat).

### Manual install

1. Download the [latest release](../../releases) `main.js`, `manifest.json`, and `styles.css`.
2. In your vault, create `.obsidian/plugins/obsi-buddi/`.
3. Copy the three files into that folder.
4. Open **Settings → Community plugins**, refresh the list, and enable **ObsiBuddi**.

### From source (developers)

```bash
git clone https://github.com/jordannewell/obsidian-buddi.git
cd obsidian-buddi
npm install
npm run build
```

Copy `main.js`, `manifest.json`, `styles.css` into `<vault>/.obsidian/plugins/obsi-buddi/`.

### First-run setup

1. Open the chat panel via the **ribbon icon** (robot) or `Ctrl+Shift+G`.
2. In **Settings → ObsiBuddi → Provider Configuration**, enable a provider and paste your API key.
3. Pick a model from the header dropdown.
4. Start typing.

> [!TIP]
> **Want fully private, free, offline AI?** Install [Ollama](https://ollama.com), run `ollama pull qwen2.5:7b-instruct`, then enable the **Ollama (Local)** provider in settings. No API key. Nothing leaves your machine.

## Usage

### Mobile

ObsiBuddi works on iOS and Android with a few caveats:

- Hover-only elements (per-message action toolbar, code-block copy buttons) are always visible on touch devices at reduced opacity. Tap them directly.
- Touch targets are sized to Apple HIG minimums (44pt send button, 40pt header icons).
- Wallpaper background is auto-disabled on phones for scroll performance — theme colors are used instead.
- `/paste` may fail if the OS blocks clipboard read. Use regular paste (`Ctrl+V` / long-press → Paste) instead.
- Streaming may degrade to buffered responses on some providers due to mobile CORS restrictions. The message still arrives — it just appears all at once instead of token-by-token.
- Local providers (Ollama, LM Studio) work if you point at a LAN host via the custom endpoint field (e.g. `http://192.168.1.50:11434/v1/chat/completions`).

### Basic chat

Type a question. Press Enter (or `Ctrl+Enter` if you switched to newline mode). The response streams in. Hover any assistant message for actions.

### Ask about an image

Drag a PNG onto the chat panel → type *"what's in this?"* → send. The image is saved to `attachments/` and the model (if vision-capable) reads it.

### Save a response as a note

Hover an assistant message → click the **file-plus** icon → a new note opens in a split, with frontmatter recording the provider/model/timestamp.

Or type `/save-all` to export the entire conversation as one structured note.

### Ask about the active note

Highlight a passage in any note → right-click → **Explain with AI** / **Summarize** / **Improve** / etc. The result writes back into the note at the cursor.

## Providers

**30+ built-in**: Anthropic Claude · OpenAI · Google Gemini · Z.ai GLM · Ollama · LM Studio · OpenRouter · Groq · Together AI · Fireworks · Mistral · DeepSeek · Cohere · Vercel AI Gateway · xAI Grok · Perplexity · Novita · DeepInfra · Hyperbolic · Chutes · Replicate · Lepton · Lambda · Hugging Face · Azure OpenAI · GitHub Models · fal.ai · Cerebras · SambaNova · Requesty

Plus any OpenAI-compatible endpoint as a custom provider (LiteLLM, llama.cpp, Novita, Portkey, Helicone, self-hosted servers).

See [docs/PROVIDERS.md](docs/PROVIDERS.md) for the full list with endpoints, auth, and per-provider setup notes.

## Privacy

- **Cloud providers** (Anthropic, OpenAI, Gemini, etc.) send your chat content to their servers. That's how they work.
- **Local providers** (Ollama, LM Studio) run entirely on your machine. Nothing leaves.
- **API keys** are stored in your OS keychain on Obsidian 1.11.4+.
- **Conversations** are stored in `localStorage` under the plugin's key — same threat model as Obsidian itself.
- **Image attachments** are saved as real files in your vault's `attachments/` folder — visible, auditable, deletable.
- **Memory** is a markdown file in your vault — readable, editable, never sent anywhere except the active provider.

> [!WARNING]
> Memory injection is inherent to any AI memory feature. If you `/remember` malicious text (or import a malicious note that tricks you into saving it), it gets injected into every future prompt. Audit `AI/ObsiBuddi Memory.md` if you're unsure.

## Roadmap

- [ ] Inline-note AI mode (write at the cursor, response lands in the note)
- [ ] Conversation branching UI
- [ ] Per-provider OAuth flows (Gemini native, GitHub, etc.)
- [ ] Plugin settings import/export

See the [open issues](../../issues) for the live list.

## Feedback & support

- 🐛 [Report a bug](../../issues/new?template=bug.md)
- 💡 [Request a feature](../../issues/new?template=feature.md)
- 💬 [Discussions](../../discussions)

## Contributing

PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup, code style, and the audit checklist all changes go through.

## 🙏 Support ObsiBuddi

If ObsiBuddi saves you time, consider sponsoring the project or buying me a coffee. Every contribution funds the servers, the late-night audits, and the next feature.

- ☕ [Buy Me a Coffee](https://www.buymeacoffee.com/jordannewell)
- 💛 [GitHub Sponsors](https://github.com/sponsors/jordannewell)

The donate button is also available in **Settings → ObsiBuddi** inside Obsidian.

> [!NOTE]
> ObsiBuddi is and will remain **free and open source** under the MIT license. Every feature — 30+ providers, memory, image attachments, slash commands — works with your own API keys. Sponsorship is voluntary and appreciated, never required.

## License

[MIT](LICENSE) © Jordan Newell
