# Reddit post — r/ObsidianMD

**Suggested title** (78 chars): I built a BYOK AI chat for Obsidian — 30+ providers, side-by-side model arena

**Notes:** disclose authorship in the first line (rule-compliant). Drag `assets/demo-arena-cloud-vs-cloud.gif` straight into the post body. Don't mention download counts.

---

**Title:** I built a BYOK AI chat for Obsidian — 30+ providers, side-by-side model arena

I'm Jordan, I wrote this plugin, so weigh my enthusiasm accordingly.

For the last few months I've been scratching an itch: my notes live in Obsidian, but every time I wanted an AI's help I was copy-pasting into a browser tab — a different tab per provider, a subscription per tab, and the answer never ended up anywhere useful. The trigger for the whole project was dumber than that: I kept wanting to ask two models the same question and compare. That's six tabs and a lot of scrolling for one answer.

So I built Curtis AI Chat. It's a bring-your-own-key AI chat panel for Obsidian. Thirty providers are built in (Anthropic, OpenAI, Gemini, OpenRouter, Groq, DeepSeek, xAI, Mistral, Perplexity...), plus any OpenAI-compatible endpoint you paste in. Your keys go into your OS keychain. No subscription, no account, MIT.

The feature I'm proudest of is the arena. You pick two models, type one prompt, and both answers stream in side-by-side columns:

**[drag in: `assets/demo-arena-cloud-vs-cloud.gif`]**

*(Same prompt, Gemini via OpenRouter vs DeepSeek via its own API. There's a Stop button per column, and "Promote to chat" promotes the winner into a normal conversation.)*

It's changed how I pick models — instead of vibes, I run a representative prompt through the two candidates and promote whichever one shows up.

A few things I wanted to be true that other plugins I tried weren't:

- **Local models are first-class.** Ollama and LM Studio are built-in providers — no API key, nothing leaves your machine. If you want to stay fully offline, vault retrieval (semantic search over your notes) can run its embeddings through Ollama too. That's how I run it for anything private.
- **Your chats are files in your vault.** Every conversation saves as a markdown note in `AI/Conversations/`, so it syncs, shows up in normal Obsidian search, and the agent can read it. Long-term memory is a markdown file you can open and edit. And the model asks before saving anything about you — proposed facts show a Save/Skip bar.
- **It can act on the vault.** Agent mode (opt-in) has 11 built-in tools — read, search, create, edit notes — and connects to MCP servers you already run.
- **No telemetry.** No analytics, no update pings, nothing in the background. The README lists every domain the plugin can contact and when.

Also in there: `@`-mention any note as context, inline rewrite-with-diff on selections, image attachments, voice input (Whisper) and read-aloud replies (browser TTS), and it works on mobile. New in 2.0: import your ChatGPT or Claude data export and keep those conversations going here — chats move around as portable `.curt` files.

Honest caveats: speech-to-text needs an OpenAI key (Whisper's API is the only STT I've wired up — TTS is local browser synthesis); the agent needs a tool-calling model; and the arena respects per-provider rate limits, so two columns on a free-tier key can trip a 429.

- Plugin page: https://obsidian.md/plugins/curtis-ai-chat
- GitHub: https://github.com/JordanNewell/curtis-ai-chat
- Docs: https://jordannewell.github.io/curtis-ai-chat

Happy to answer questions here — and if you run local models, I'd especially like to hear how the Ollama setup works for you.
