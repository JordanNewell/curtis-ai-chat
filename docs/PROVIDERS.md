# Providers

Curtis AI ships with 53 built-in providers and supports any OpenAI-compatible endpoint as a custom provider. This doc covers what's built-in, how each one authenticates, per-provider setup quirks, agent compatibility, and the advanced request parameters each card exposes.

> [!TIP]
> Look for the **👁 vision** marker next to a model in the picker — that model can read images. The **🔧 tools** marker means the model supports function calling (required for the [Curtis Agent](AGENT.md)).

## Built-in providers

| Provider | Auth | Auto-discovery | Agent (tools) | Notes |
|---|---|---|---|---|
| **Anthropic Claude** | `x-api-key` | No | ✅ | Native Anthropic message format (auto-converted). Agent via native tool use. Vision on Opus/Sonnet/Haiku. |
| **OpenAI** | Bearer | Yes (`/v1/models`) | ✅ | GPT-6 family at 1.05M context. Vision on most models. |
| **ChatGPT (Sign in)** | OAuth | Yes (`/v1/models`) | ✅ | ChatGPT Plus/Pro plan billing via OpenAI's official sign-in — no API key. Speaks the Responses API; desktop sign-in, tokens renew automatically. See [Subscription plans](#subscription-plans-and-sign-in). |
| **Google Gemini** | Bearer | Yes (`/v1beta/models`) | ✅ | Gemini's OpenAI-compat endpoint. Vision on Pro/Flash. |
| **Z.ai Coding Plan** | Bearer | Yes | ✅ | Coding plan endpoint — text-only on the coding endpoint even for vision models. For pay-as-you-go use the **Z.ai GLM** provider instead. |
| **Ollama (Local)** | None | Yes (`/api/tags`) | ✅ | Native `/api/chat` dialect. Set a custom endpoint if your Ollama lives elsewhere. Agent needs a tool-capable model. |
| **LM Studio (Local)** | None | Yes | ✅ | Same as Ollama — custom endpoint supported. Agent needs a tool-capable model. |
| **OpenRouter** | Bearer | Yes | ✅ | 400+ models via one key. Model IDs are namespaced (`openai/gpt-5`, `anthropic/claude-...`). |
| **Groq** | Bearer | Yes | ✅ | Fastest inference available. GPT-OSS models; Llama tiers moved to enterprise-only. |
| **Together AI** | Bearer | Yes | ✅ | Llama, Qwen, DeepSeek hosted. |
| **Fireworks** | Bearer | Yes | ✅ | Similar to Together. |
| **Mistral** | Bearer | Yes | ✅ | Mistral Large 4, Medium 3.5, Codestral. |
| **DeepSeek** | Bearer | Yes | ✅ | V4 Pro/Flash. Function calling supported. |
| **Cohere** | Bearer | Yes | ✅ | Command A family (A Plus flagship), R7B budget. |
| **Meta Muse** | Bearer | Yes | ✅ | Muse Spark 1.3 / 1.2 / 1.1 — 1.05M context, one price across the family. Vision + tools. |
| **Vercel AI Gateway** | Bearer | Yes | ✅ | One key, 20+ upstream providers, namespaced model IDs. |
| **xAI Grok** | Bearer | Yes | ✅ | Grok 4.7 / 4.6 / 4.3, Grok Build. |
| **Perplexity** | Bearer | Yes | ✅ | Sonar models with web search baked in. Served via the Router endpoint, which rejects unknown request fields. |
| **Novita AI** | Bearer | Yes | ✅ | Discount DeepSeek/Llama hosting. |
| **DeepInfra** | Bearer | Yes | ✅ | Similar to Novita. |
| **Chutes AI** | Bearer | Yes | ✅ | DeepSeek, Qwen Coder. |
| **Replicate** | Bearer | Yes | ✅ | Image-gen roots but supports chat now. |
| **Hugging Face** | Bearer | Yes | ✅ | Inference endpoints — any HF model. |
| **Azure OpenAI** | Bearer | No | ✅ | Requires a full deployment URL — see below. |
| **fal.ai** | `Key <key>` | Yes | ✅ | Chat routes through fal's OpenRouter passthrough at `fal.run`. Auth header is `Authorization: Key <key>`, not Bearer. |
| **Cerebras** | Bearer | Yes | ✅ | Fastest inference after Groq. GPT-OSS 120B, Qwen 3.8 27B. |
| **SambaNova** | Bearer | Yes | ✅ | DeepSeek V3, Llama 3.3. |
| **Requesty** | Bearer | Yes | ✅ | Router across many providers. |
| **NVIDIA NIM** | Bearer | Yes | ✅ | Free-credits hosted catalog (100+ models); production pricing is self-host NIM. |
| **Moonshot Kimi** | Bearer | Yes | ✅ | Kimi K3 at 1M context. Temperature/top_p are pinned server-side and never sent. Keys from platform.kimi.ai and .com are not interchangeable. |
| **Kimi for Coding** | Bearer | Yes | ✅ | Kimi's subscription coding plan at `api.kimi.com/coding/v1`. Plan keys from kimi.com — not interchangeable with platform keys. Quota is calls per 5-hour window. |
| **MiniMax** | Bearer | Yes | ✅ | M3 at 1M context, multimodal. `reasoning_effort` is honored by M3.1-Flash-Preview only. |
| **Alibaba Qwen** | Bearer | Yes | ✅ | International (Singapore) DashScope compatible-mode. Keys are region-locked. Reasoning via `enable_thinking`. |
| **Alibaba Coding Plan** | Bearer | Yes | ✅ | Fixed-monthly Model Studio plan. Plan keys are served by the dedicated `coding-intl` host — standard DashScope keys are rejected there (and vice versa). |
| **AI21 Jamba** | Bearer | Yes | ✅ | Jamba Mini/Large, 256K context. Endpoint requires the `/studio` prefix. Max tokens hard-capped at 4096. |
| **Upstage Solar** | Bearer | Yes | ✅ | Solar Pro/Mini 4 at 512K context, reasoning + tools. |
| **Nebius** | Bearer | Yes | ✅ | Token Factory (ex AI Studio) — open-weight hosting; full vLLM parameter set. |
| **Baseten** | Bearer | Yes | ✅ | Managed Model APIs — DeepSeek/Kimi/GLM/GPT-OSS at 1M context where offered. |
| **Inference.net** | Bearer | Yes | ✅ | Open-weight catalog plus proxied first-party models; per-token pricing published on `/v1/models`. |
| **OVHcloud AI Endpoints** | Bearer | Yes | ✅ | European hosting (EU coverage). Catalog prices are EUR; anonymous tier is 2 req/min. |
| **FriendliAI** | Bearer | Yes | ✅ | Serverless open-weight hosting; richest sampling dialect (top_k/min_p/repetition_penalty all real). |
| **GMI Cloud** | Bearer | Yes | ✅ | GPU-cloud inference; contexts/prices live in their console, discovery fills them. |
| **StepFun** | Bearer | Yes | ✅ | Step 5/3.x models, multimodal. This is the international endpoint (USD); CN keys don't work here. |
| **Tencent Hunyuan** | Bearer | Yes | ✅ | TokenHub international — activate models in the console first or calls return 402. |
| **Z.ai GLM** | Bearer | Yes | ✅ | Pay-as-you-go platform endpoint (`api.z.ai`) — separate key and billing from the Coding Plan. Temperature is 0–1; GLM-5.3 cannot disable thinking. The CN platform (`open.bigmodel.cn`) speaks the same dialect via a custom endpoint. |
| **BytePlus ModelArk** | Bearer | Yes | ✅ | ByteDance international (Doubao's Seed family, plus hosted DeepSeek/GLM). Keys are region-scoped; model ids carry date suffixes and retire with named replacements. CN region: `ark.cn-beijing.volces.com` via custom endpoint. |
| **Baidu Qianfan** | Bearer | Yes | ✅ | ERNIE family plus hosted open weights. `/v2/models` is the richest discovery of any built-in — context, pricing, and features per model. CN platform: real-name verification and CNY billing. |
| **SiliconFlow** | Bearer | Yes | ✅ | International open-weight aggregator (DeepSeek/GLM/Kimi/Qwen at 1M context). The CN site (`api.siliconflow.cn`) is a separate account/key universe via custom endpoint. `enable_thinking` is always sent — it defaults to on server-side. |
| **Crusoe Cloud** | Bearer | Yes | ✅ | GPU-cloud inference at aggressive prices. Catalog rotates hard — discovery is authoritative. |
| **Poe** | Bearer | Yes | ✅ | One key, every frontier bot (GPT, Claude, Gemini, Grok, Kimi, …) billed in Poe compute points — prices show 0 because it's point-metered. Unsupported fields are ignored, not rejected. |
| **Featherless** | Bearer | Yes | ✅ | 22k+ open-weight models and the richest documented sampling set (top_k/min_p/repetition_penalty all real). Prepaid subscription credits ($50/mo Developer floor); listed prices are the credit rates. |
| **Scaleway** | Bearer | Yes | ✅ | European hosting (GDPR angle). Per-token prices live in the console cost estimator, so cost estimates show as unknown. `frequency_penalty` is unsupported and dropped. |
| **Reka** | Bearer | Yes | ✅ | Small first-party catalog — Reka Flash 3 has no tool calling, so agent mode needs one of the hosted partner models discovery picks up. Prepaid credits; `/v1/models` publishes per-model pricing. |

### Agent compatibility legend

- ✅ — works with the [Curtis Agent](AGENT.md). Anthropic uses its native tool-use API; everything else speaks OpenAI-style function calling (Gemini via its OpenAI-compatible endpoint, Ollama via its native `/api/chat`).

## Setting up a provider

1. **Settings → Curtis AI → Provider Configuration**
2. Find the provider, toggle **Enable**
3. Paste your API key — it's stored in your OS keychain on Obsidian 1.13+
4. (Optional) Click the **refresh icon** to auto-discover available models
5. (Optional) Click the **crosshair icon** to test the connection
6. Pick a default model from the dropdown

The provider now appears in the chat header's model picker.

## Advanced request parameters

Every provider card (built-in and custom) has a collapsed **Advanced request parameters** group. Everything in it is optional — an empty field falls back to the global Generation settings, and an untouched card sends nothing extra. Scope an override to the provider default or to a single model: per-model wins over per-provider, which wins over the global Generation settings.

Controls: Temperature, Max tokens, Top P, Top K, Min P, Seed, Stop sequences (comma-separated), Frequency/Presence/Repetition penalty, an **Omit temperature** toggle, a **Reasoning-effort** selector, and **Extra body JSON**. Omit temperature drops `temperature` from the request entirely — required for models that reject sampling params (OpenAI reasoning models, Claude released after Opus 4.6). Reasoning effort (off/minimal/low/medium/high/max) is mapped to each provider's dialect: `reasoning_effort` for OpenAI-style APIs, `thinking.budget_tokens` for Anthropic, a `thinking` on/off toggle for DeepSeek and Z.ai, `think` for Ollama.

- **Capability gating** — a per-provider capability matrix drops any field that provider's API doesn't accept before the request is sent, so strict APIs (OpenAI, Azure, the Perplexity Router, Fireworks) never see an unknown field. Unsupported controls render disabled in Settings.
- **Ollama hardware knobs** — Context window, GPU layers, CPU threads, and Keep-alive ride the native `/api/chat` body as `options.num_ctx` / `options.num_gpu` / `options.num_thread` and top-level `keep_alive`. Ollama's OpenAI-compatible endpoint can't express them, which is why Curtis speaks the native dialect.
- **Extra body JSON** — deep-merged into the request body last. Reserved keys: `model`, `messages`, `stream`, `stream_options`. Everything else is settable — the escape hatch for provider-specific fields Curtis doesn't structure (thinking toggles, `reasoning_effort`, routing, LM Studio's `ttl`).
- **Copy last request JSON** — a debug button on each provider card that copies the exact request body of the last send.

## Anthropic Claude

### Extended thinking

The Anthropic card's **Extended thinking** toggle has Claude reason before answering. Reasoning streams into a collapsible "Thinking" block above the reply and never mixes into the answer text; the block collapses once the answer arrives. **Thinking budget** caps the reasoning in tokens (floor 1024). The budget must sit below the request's max tokens — Curtis raises the cap automatically when it doesn't leave room for an answer.

Supported on Claude 3.7 and the Claude 4 family; for unrecognized model ids (custom endpoints, new releases) the toggle is still honored, and a model that rejects it surfaces the API's own error message. In agent mode, thinking blocks are replayed with each tool result as the API requires. A per-provider or per-model **Reasoning-effort** value (above) takes precedence over the global toggle, and **Extra body JSON** wins over both.

## Subscription plans and sign-in

Some vendors sell subscriptions whose allowance can be used outside their own apps; others explicitly forbid it. Curtis supports the ones that allow it and deliberately not the rest — the cost of a violation is the user's suspended account, not a broken feature.

**Works with your subscription:**

- **ChatGPT Plus/Pro — Sign in with ChatGPT.** The **ChatGPT (Sign in)** provider uses OpenAI's official OAuth flow — no API key, no client secret. Press **Sign in** on the provider card, authorize Curtis in the browser window that opens, and requests bill against your plan allowance instead of API credits. Access tokens last about an hour and renew automatically; tokens live in your OS keychain. Desktop only (the sign-in runs a local loopback listener — mobile hides the provider). Requests speak OpenAI's Responses API, and the model catalog is the plan's codex-flavored lineup, which differs from the API-key catalog. OpenAI currently limits plan usage to open-source and local apps — which Curtis is.
- **Z.ai Coding Plan** — the built-in **Z.ai Coding Plan** provider *is* the coding-plan endpoint; paste the plan key from your Z.ai dashboard. The separate **Z.ai GLM** provider is the pay-as-you-go platform — a subscription plan key will not bill there.
- **Poe subscription** — the **Poe** provider bills your Poe compute points through an ordinary API key (create one at poe.com/api/keys); per-token rates match the underlying providers, so a subscriber's points just get spent.
- **Kimi for Coding** — use the **Kimi for Coding** provider with a plan key from kimi.com. Plan keys and Moonshot platform keys are not interchangeable.
- **Alibaba Coding Plan** — use the **Alibaba Coding Plan** provider with a plan key from the Model Studio console. Plan keys are served by a dedicated endpoint; standard DashScope keys are rejected there.
- **MiniMax coding plans** — no separate provider: MiniMax plan keys work on the standard MiniMax endpoint.
- **Perplexity Pro / Chutes subscriptions** — these include monthly API credits delivered as ordinary API keys; paste them into the existing provider.
- **Google AI Studio** — not a subscription at all: AI Studio issues standard Gemini API keys with a free tier. Paste one into the existing **Google Gemini** provider — no OAuth involved, nothing to sign into.

**Does not work — by design:**

- **Claude Pro/Max.** Anthropic blocks subscription access from third-party apps outright — the tokens are refused at the API level, and Anthropic has suspended accounts that route them through other tools. Curtis uses standard Anthropic API keys only. Pasting a Claude Code OAuth token anywhere will not work and puts your account at risk.
- **GitHub Copilot** — licensed for first-party clients only.
- **Gemini CLI / Code Assist OAuth.** Google states that routing the Gemini CLI's OAuth login through third-party tools is a policy-violating use case subject to abuse detection, and has flagged exactly that pattern in third-party apps. The free path that *is* sanctioned is an AI Studio API key (above) — free tier included, no Google subscription or OAuth required.

## Local providers (Ollama, LM Studio)

**No API key required.** Just enable the provider and ensure the server is running:

```bash
# Ollama
ollama serve                              # starts on localhost:11434
ollama pull qwen2.5:7b-instruct           # grab a model

# LM Studio — start the local server from the app UI (default :1234)
```

> [!TIP]
> If your Ollama lives on a different machine (e.g. a home server), set the **Custom endpoint** field to `http://your-server:11434/api/chat`. Endpoints saved under the old `/v1/chat/completions` path migrate automatically.

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

Custom providers are agent-compatible as long as the upstream server implements OpenAI function-calling.

## Switching providers mid-conversation

Click the **model picker button** at the top of the chat. The picker shows every enabled provider and their models. Switching is instant — the next message uses the new model. The conversation continues seamlessly.

## Per-conversation provider tracking

Every assistant message records which provider and model produced it. Hover an assistant message to see the model name in the meta row above the bubble.

## Troubleshooting

**"No AI provider configured"** — enable at least one provider in settings and ensure it has a valid API key.

**"Auth failed"** — the API key is wrong, expired, or lacks the required scope. Re-paste it in settings.

**"ChatGPT session expired — sign in again"** — the refresh token timed out (roughly a month of no use) or was revoked. Press **Sign in** on the ChatGPT (Sign in) card once and everything resumes.

**"This model rejected the image"** — you sent an image to a non-vision model. Switch to a vision-capable model via the picker (look for 👁).

**"Provider is having issues (5xx)"** — the provider is down. Try again or switch providers.

**"Tool calls not working"** — the [agent](AGENT.md) works with all providers, but the **model** must support tool calling. On Ollama/LM Studio, pull a tool-capable model (e.g. `qwen2.5`, `llama3.1`); models without tool support will ignore the tools silently.

**Discovery returns no models** — the `/models` endpoint may require a different auth header or path. File an issue with the provider name + endpoint.
