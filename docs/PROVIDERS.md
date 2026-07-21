# Providers

ObsiBuddi ships with 30+ built-in providers and supports any OpenAI-compatible endpoint as a custom provider. This doc covers what's built-in, how each one authenticates, and per-provider setup quirks.

> [!TIP]
> Look for the **👁 vision** marker next to a model in the picker — that model can read images. Models without it will reject image attachments with a clear Notice.

## Built-in providers

| Provider | Auth | Auto-discovery | Notes |
|---|---|---|---|
| **Anthropic Claude** | `x-api-key` | No | Uses Anthropic's native message format (auto-converted from OpenAI shape). Vision on Opus/Sonnet/Haiku. |
| **OpenAI** | Bearer | Yes (`/v1/models`) | Full GPT-5 family. Vision on most models. |
| **Google Gemini** | Bearer | Yes (`/v1beta/models`) | Uses Gemini's OpenAI-compat endpoint. Vision on Pro/Flash. |
| **Z.ai GLM** | Bearer | Yes | Coding plan endpoint — text-only on the coding endpoint even for vision models. Use the full GLM endpoint for vision. |
| **Ollama (Local)** | None | Yes (`/api/tags`) | Set a custom endpoint if your Ollama lives elsewhere (e.g. `http://your-server:11434/v1/chat/completions`). |
| **LM Studio (Local)** | None | Yes | Same as Ollama — custom endpoint supported. |
| **OpenRouter** | Bearer | Yes | 400+ models via one key. Model IDs are namespaced (`openai/gpt-5`, `anthropic/claude-...`). |
| **Groq** | Bearer | Yes | Fastest inference available. Llama 3.3, GPT-OSS, etc. |
| **Together AI** | Bearer | Yes | Llama, Qwen, DeepSeek hosted. |
| **Fireworks** | Bearer | Yes | Similar to Together. |
| **Mistral** | Bearer | Yes | Mistral Large, Codestral, Devstral. |
| **DeepSeek** | Bearer | Yes | V4 Pro/Flash. Function calling supported. |
| **Cohere** | Bearer | Yes | Command A / R+ / R. |
| **Vercel AI Gateway** | Bearer | Yes | One key, 20+ upstream providers, namespaced model IDs. |
| **xAI Grok** | Bearer | Yes | Grok 4 / 4 fast / 2 vision. |
| **Perplexity** | Bearer | Yes | Sonar models with web search baked in. |
| **Novita AI** | Bearer | Yes | Discount DeepSeek/Llama hosting. |
| **DeepInfra** | Bearer | Yes | Similar to Novita. |
| **Hyperbolic** | Bearer | Yes | Llama 3.1 405B, Qwen 72B. |
| **Chutes AI** | Bearer | Yes | DeepSeek, Qwen Coder. |
| **Replicate** | Bearer | Yes | Image-gen roots but supports chat now. |
| **Lepton AI** | Bearer | Yes | DeepSeek, Llama. |
| **Lambda Labs** | Bearer | Yes | Llama 3.3, DeepSeek V3. |
| **Hugging Face** | Bearer | Yes | Inference endpoints — any HF model. |
| **Azure OpenAI** | Bearer | No | Requires a full deployment URL in the "Deployment URL" field — see below. |
| **GitHub Models** | Bearer | Yes | Free tier with your GitHub token. GPT-5, Mistral, etc. |
| **fal.ai** | Bearer | Yes | Primarily image gen, but supports chat. |
| **Cerebras** | Bearer | Yes | Fastest inference after Groq. Llama 3.3 70B. |
| **SambaNova** | Bearer | Yes | DeepSeek V3, Llama 3.3. |
| **Requesty** | Bearer | Yes | Router across many providers. |

## Setting up a provider

1. **Settings → ObsiBuddi → Provider Configuration**
2. Find the provider, toggle **Enable**
3. Paste your API key — it's stored in your OS keychain on Obsidian 1.11.4+
4. (Optional) Click the **refresh icon** to auto-discover available models
5. (Optional) Click the **crosshair icon** to test the connection
6. Pick a default model from the dropdown

The provider now appears in the chat header's model picker.

## Local providers (Ollama, LM Studio)

**No API key required.** Just enable the provider and ensure the server is running:

```bash
# Ollama
ollama serve                              # starts on localhost:11434
ollama pull qwen2.5:7b-instruct           # grab a model

# LM Studio — start the local server from the app UI (default :1234)
```

> [!TIP]
> If your Ollama lives on a different machine (e.g. a home server), set the **Custom endpoint** field to `http://your-server:11434/v1/chat/completions`.

## Azure OpenAI

Azure uses a per-deployment URL, not a global endpoint. The plugin can't auto-discover models — you must supply the full URL:

```
https://<resource>.openai.azure.com/openai/deployments/<deployment-name>/chat/completions?api-version=2024-10-21
```

1. Enable **Azure OpenAI** in provider config
2. Paste the deployment URL into **Deployment URL**
3. Paste your Azure API key into the key field
4. Add models manually if needed (no auto-discovery)

## Custom providers

Any OpenAI-compatible endpoint works as a custom provider. Common use cases:

- **LiteLLM proxy** — one local server routing to many providers
- **llama.cpp server** — self-hosted, fully offline
- **Portkey / Helicone** — observability gateways in front of OpenAI/Anthropic
- **Corporate gateways** — internal OpenAI-compat proxies

### Adding a custom provider

1. **Settings → Custom Providers → + Add**
2. Fill in name, endpoint URL, auth type (`bearer` or `none`), API key
3. Optionally set a default model
4. Auto-discovery runs if the endpoint exposes `/v1/models`

## Switching providers mid-conversation

Click the **model picker button** at the top of the chat. The picker shows every enabled provider and their models. Switching is instant — the next message uses the new model. The conversation continues seamlessly.

## Per-conversation provider tracking

Every assistant message records which provider and model produced it. Hover an assistant message to see the model name in the meta row above the bubble.

## Troubleshooting

**"No AI provider configured"** — enable at least one provider in settings and ensure it has a valid API key.

**"Auth failed"** — the API key is wrong, expired, or lacks the required scope. Re-paste it in settings.

**"This model rejected the image"** — you sent an image to a non-vision model. Switch to a vision-capable model via the picker (look for 👁).

**"Provider is having issues (5xx)"** — the provider is down. Try again or switch providers.

**Discovery returns no models** — the `/models` endpoint may require a different auth header or path. File an issue with the provider name + endpoint.
