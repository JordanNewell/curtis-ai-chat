// Provider Registry — manages all AI provider instances

import { requestUrl } from 'obsidian';
import type { AIProvider, AIModel, ProviderDefinition, ProviderConfig, ReasoningEffort } from '../types';
import { OpenAICompatibleProvider } from './base';
import type { ParamCaps } from './base';
import { AnthropicProvider, getAnthropicModels } from './anthropic';
import { OllamaProvider, normalizeOllamaEndpoint } from './ollama';
import { ChatGPTProvider, CHATGPT_ENDPOINT } from './chatgpt';
import type { ChatGPTTokenStore } from './chatgpt';

/**
 * Model-listing response shapes we know how to parse. The discovery endpoint
 * varies by provider; we match against the field that's present at runtime.
 */
interface OpenAIModelsResponse {
	data?: Array<{
		id: string;
		context_length?: number;
		context_window?: number;
	}>;
}

interface OllamaModelsResponse {
	models?: Array<{
		name?: string;
		model?: string;
	}>;
}

interface GeminiModelsResponse {
	models?: Array<{
		name?: string;
		displayName?: string;
		inputTokenLimit?: number;
		supportedGenerationMethods?: string[];
	}>;
}

/** Minimal record shared by every fallback shape. */
interface GenericModelEntry {
	id?: string;
	name?: string;
	context_length?: number;
}

interface GenericModelsResponse {
	models?: GenericModelEntry[];
}

type ModelsResponse = OpenAIModelsResponse | OllamaModelsResponse | GeminiModelsResponse | GenericModelsResponse;

/**
 * OpenAI-dialect providers known to accept `stream_options.include_usage` on
 * streamed requests. Deliberately not enabled for custom/user-defined
 * endpoints — strict-compat local servers may 400 on the unknown field.
 */
const STREAM_USAGE_PROVIDER_IDS = new Set(['openai', 'azure-openai', 'openrouter', 'moonshot', 'minimax', 'upstage', 'nebius', 'baseten', 'friendli', 'tencent', 'qianfan', 'poe']);

/**
 * Which advanced sampling parameters a provider's API actually accepts.
 * Drives both the wire format (unsupported fields are dropped, never sent —
 * strict APIs like OpenAI/Azure/Perplexity-Router/Fireworks reject unknown
 * fields with 4xx) and the settings UI (unsupported rows are disabled).
 * Verified against official docs 2026-10-09 — see the vault note
 * "Provider Parameter Matrix" for the full research and sources.
 * Shape defined in ./base (imported here) to keep the dependency direction
 * registry → base, never the reverse.
 */
/** Everything on — the vLLM/llama.cpp-style "extended" posture. Default for
 *  custom/user-defined endpoints, which are overwhelmingly local servers. */
const CAPS_EXTENDED: ParamCaps = {
	topP: true, topK: true, minP: true, repetitionPenalty: true,
	frequencyPenalty: true, presencePenalty: true, seed: true, stop: true,
};

/** OpenAI's reference dialect: no top_k/min_p/repetition_penalty (400 on
 *  unknown args), but penalties/seed/stop exist. */
const CAPS_OPENAI: ParamCaps = {
	topP: true, topK: false, minP: false, repetitionPenalty: false,
	frequencyPenalty: true, presencePenalty: true, seed: true, stop: true,
};

const CAPS_BY_PROVIDER: Record<string, ParamCaps> = {
	// OpenAI-family: max_tokens is deprecated for max_completion_tokens.
	'openai': { ...CAPS_OPENAI, maxTokensWireName: 'max_completion_tokens' },
	'azure-openai': { ...CAPS_OPENAI, maxTokensWireName: 'max_completion_tokens' },
	'anthropic': {
		topP: true, topK: true, minP: false, repetitionPenalty: false,
		frequencyPenalty: false, presencePenalty: false, seed: false, stop: true,
	},
	'google': {
		// Compat layer maps temperature/top_p/stop; penalties are 400-prone and
		// seed/top_k are native-generationConfig-only.
		topP: true, topK: false, minP: false, repetitionPenalty: false,
		frequencyPenalty: false, presencePenalty: false, seed: false, stop: true,
	},
	'zai-glm': {
		// No penalties/seed/top_k; temperature range is 0..1 server-side.
		topP: true, topK: false, minP: false, repetitionPenalty: false,
		frequencyPenalty: false, presencePenalty: false, seed: false, stop: true,
	},
	'xai': { ...CAPS_OPENAI, maxTokensWireName: 'max_completion_tokens' },
	'deepseek': {
		// Penalties are documented deprecated-inert; no seed parameter.
		topP: true, topK: false, minP: false, repetitionPenalty: false,
		frequencyPenalty: false, presencePenalty: false, seed: false, stop: true,
	},
	'mistral': {
		topP: true, topK: false, minP: false, repetitionPenalty: false,
		frequencyPenalty: true, presencePenalty: true, seed: true, stop: true,
		seedWireName: 'random_seed',
	},
	'cohere': CAPS_OPENAI,
	'meta': {
		// stop → 400 on reasoning models; top_p 0 → 400. max_tokens deprecated.
		topP: true, topK: false, minP: false, repetitionPenalty: false,
		frequencyPenalty: true, presencePenalty: true, seed: true, stop: false,
		maxTokensWireName: 'max_completion_tokens',
	},
	'perplexity': {
		// Router rejects ANY unknown top-level field with 400 (seed included);
		// penalties accepted but currently no-ops; stop allows 1-4 sequences.
		// max_tokens deprecated for max_completion_tokens.
		topP: true, topK: false, minP: false, repetitionPenalty: false,
		frequencyPenalty: true, presencePenalty: true, seed: false, stop: true,
		maxTokensWireName: 'max_completion_tokens',
	},
	'ollama': {
		topP: true, topK: true, minP: true, repetitionPenalty: true,
		frequencyPenalty: true, presencePenalty: true, seed: true, stop: true,
		repetitionPenaltyWireName: 'repeat_penalty',
	},
	'lmstudio': {
		topP: true, topK: true, minP: false, repetitionPenalty: true,
		frequencyPenalty: true, presencePenalty: true, seed: true, stop: true,
		repetitionPenaltyWireName: 'repeat_penalty',
	},
	// Open-compat passthrough routers.
	'openrouter': CAPS_EXTENDED,
	'vercel-ai-gateway': CAPS_EXTENDED,
	'requesty': CAPS_EXTENDED,
	'huggingface': CAPS_EXTENDED,
	'fal': CAPS_EXTENDED,
	// Open-weight clouds.
	'together': CAPS_EXTENDED,
	'fireworks': CAPS_EXTENDED,
	'deepinfra': CAPS_EXTENDED,
	'novita': CAPS_EXTENDED,
	'sambanova': CAPS_EXTENDED,
	'chutes': CAPS_EXTENDED,
	'groq': {
		// top_k/min_p not documented; penalties "not yet supported by any model"
		// but schema-accepted (kept on so tinkerers aren't blocked if that lands).
		// max_tokens is deprecated for max_completion_tokens.
		topP: true, topK: false, minP: false, repetitionPenalty: false,
		frequencyPenalty: true, presencePenalty: true, seed: true, stop: true,
		maxTokensWireName: 'max_completion_tokens',
	},
	'cerebras': {
		// max_tokens is only an alias of max_completion_tokens — never send both
		// (the schema rejects the pairing).
		topP: true, topK: false, minP: false, repetitionPenalty: false,
		frequencyPenalty: true, presencePenalty: true, seed: true, stop: true,
		maxTokensWireName: 'max_completion_tokens',
	},
	// --- 2026-10 batch: internationals + open-weight clouds (verified
	// 2026-10-09; see each definition for sources) ---
	'moonshot': {
		// Temperature and top_p are pinned per model — any other value errors,
		// so neither is ever sent. Penalties are pinned to 0; no seed/top_k.
		temperature: false,
		topP: false, topK: false, minP: false, repetitionPenalty: false,
		frequencyPenalty: false, presencePenalty: false, seed: false, stop: true,
		maxTokensWireName: 'max_completion_tokens',
	},
	'kimi-coding': {
		// Nothing on the coding-plan endpoint is parameter-verified yet (the
		// docs only itemize the quota model) — drop everything rather than
		// risk 400s; loosen after live probing.
		temperature: false,
		topP: false, topK: false, minP: false, repetitionPenalty: false,
		frequencyPenalty: false, presencePenalty: false, seed: false, stop: false,
	},
	'minimax': {
		// Schema carries only temperature/top_p; stop, penalties, seed, top_k
		// are not in it.
		topP: true, topK: false, minP: false, repetitionPenalty: false,
		frequencyPenalty: false, presencePenalty: false, seed: false, stop: false,
		maxTokensWireName: 'max_completion_tokens',
	},
	'qwen': {
		// Compatible-mode docs only verify temperature/top_p/enable_thinking;
		// everything else is unverified → dropped rather than risk 400s.
		topP: true, topK: false, minP: false, repetitionPenalty: false,
		frequencyPenalty: false, presencePenalty: false, seed: false, stop: true,
	},
	'qwen-coding': {
		// Same compatible-mode dialect as the pay-as-you-go endpoint, served
		// from the coding-plan host — same caps posture.
		topP: true, topK: false, minP: false, repetitionPenalty: false,
		frequencyPenalty: false, presencePenalty: false, seed: false, stop: true,
	},
	'chatgpt': {
		// OpenAI Responses API (plan-usage requests): temperature/top_p exist
		// but reasoning models reject temperature while reasoning is active —
		// getReasoningWire drops it. No penalties/seed/stop/top_k in the
		// Responses schema at all. Max tokens is max_output_tokens.
		topP: true, topK: false, minP: false, repetitionPenalty: false,
		frequencyPenalty: false, presencePenalty: false, seed: false, stop: false,
		maxTokensWireName: 'max_output_tokens',
	},
	'ai21': {
		// Jamba: temperature/top_p/stop documented; penalties/seed/top_k are
		// not. max_tokens has a hard 4096 cap on Jamba models.
		topP: true, topK: false, minP: false, repetitionPenalty: false,
		frequencyPenalty: false, presencePenalty: false, seed: false, stop: true,
	},
	'upstage': {
		// Penalties documented ±2; top_k/min_p/seed/stop not itemized in the
		// request schema → dropped.
		topP: true, topK: false, minP: false, repetitionPenalty: false,
		frequencyPenalty: true, presencePenalty: true, seed: false, stop: false,
	},
	'inference-net': {
		// Quickstart documents temperature/top_p/penalties; top_k/min_p/seed/
		// stop/stream_options are not documented.
		topP: true, topK: false, minP: false, repetitionPenalty: false,
		frequencyPenalty: true, presencePenalty: true, seed: false, stop: false,
	},
	'ovh': {
		// Router OpenAPI spec documents temperature/top_p/seed/stop/penalties;
		// no top_k/min_p/repetition_penalty. Docs warn backend support is
		// inconsistent per model — the catalog lists only temperature/stop/
		// top_p/seed as universally supported.
		topP: true, topK: false, minP: false, repetitionPenalty: false,
		frequencyPenalty: true, presencePenalty: true, seed: true, stop: true,
	},
	'gmi': {
		// LLM API reference documents temperature/top_p/top_k/stop; penalties/
		// seed/min_p/repetition_penalty are not in it.
		topP: true, topK: true, minP: false, repetitionPenalty: false,
		frequencyPenalty: false, presencePenalty: false, seed: false, stop: true,
	},
	'stepfun': {
		// API reference documents temperature/top_p/frequency_penalty/stop;
		// frequency_penalty caps at 1.0 (not ±2), presence/seed/top_k are not
		// in the schema.
		topP: true, topK: false, minP: false, repetitionPenalty: false,
		frequencyPenalty: true, presencePenalty: false, seed: false, stop: true,
	},
	'tencent': {
		// TokenHub protocol spec documents temperature/top_p/penalties/seed/
		// stop; top_k/repetition_penalty are documented silently-ignored
		// (dropped here — inert knobs would just confuse the settings UI).
		topP: true, topK: false, minP: false, repetitionPenalty: false,
		frequencyPenalty: true, presencePenalty: true, seed: true, stop: true,
		maxTokensWireName: 'max_completion_tokens',
	},
	// nvidia/nebius/baseten/friendli: full vLLM-style posture — top_k/min_p/
	// repetition_penalty/seed all documented (nvidia per model cards, nebius
	// "full set of vLLM parameters", baseten/friendli in their OpenAPI
	// specs) → CAPS_EXTENDED below via the fallback.
	// --- 2026-10-10 batch: platforms + clouds (verified 2026-10-10; see each
	// definition for sources) ---
	'zai': {
		// Same wire dialect as the coding-plan endpoint (zai-glm): temperature
		// range 0..1 server-side, penalties/seed/top_k rejected, stop on.
		topP: true, topK: false, minP: false, repetitionPenalty: false,
		frequencyPenalty: false, presencePenalty: false, seed: false, stop: true,
	},
	'modelark': {
		// Chat API reference (updated 2026-10-06) documents temperature/top_p/
		// penalties/stop; top_k/seed/repetition_penalty are absent from the
		// parameter list → dropped.
		topP: true, topK: false, minP: false, repetitionPenalty: false,
		frequencyPenalty: true, presencePenalty: true, seed: false, stop: true,
	},
	'qianfan': {
		// v2 API documents the full classic set including repetition_penalty
		// (rejected on DeepSeek/ERNIE-4.5/X1-Turbo models) and seed (rejected
		// on some models) — kept on, Groq-style; top_k is not in the v2 list.
		topP: true, topK: false, minP: false, repetitionPenalty: true,
		frequencyPenalty: true, presencePenalty: true, seed: true, stop: true,
	},
	'siliconflow': {
		// temperature/top_p/top_k/penalties/stop documented; min_p is Qwen-only
		// but schema-accepted. presence_penalty/seed/repetition_penalty are
		// not documented on either docs site → dropped.
		topP: true, topK: true, minP: true, repetitionPenalty: false,
		frequencyPenalty: true, presencePenalty: false, seed: false, stop: true,
	},
	'crusoe': {
		// Docs publish no parameter table beyond temperature/top_p/max_tokens
		// via the OpenAI SDK compat — everything else is unverified → dropped.
		topP: true, topK: false, minP: false, repetitionPenalty: false,
		frequencyPenalty: false, presencePenalty: false, seed: false, stop: false,
	},
	'poe': {
		// temperature/top_p/stop documented; seed/penalties/top_k are absent
		// from the spec (silently ignored, not 400s) → off.
		topP: true, topK: false, minP: false, repetitionPenalty: false,
		frequencyPenalty: false, presencePenalty: false, seed: false, stop: true,
	},
	// featherless: every advanced knob is documented (top_k/min_p/
	// repetition_penalty/penalties/stop; seed accepted but "not reliable" on
	// their multi-server fleet) → CAPS_EXTENDED via the fallback.
	'scaleway': {
		// OpenAI-compatibility doc (rev 2026-04-24) lists temperature/top_p/
		// presence_penalty/seed/stop; frequency_penalty is explicitly
		// unsupported; top_k/min_p/repetition_penalty not offered.
		topP: true, topK: false, minP: false, repetitionPenalty: false,
		frequencyPenalty: false, presencePenalty: true, seed: true, stop: true,
	},
	'reka': {
		// Per-model supported_sampling_parameters list temperature/top_p/top_k/
		// stop/seed/penalties (verified for reka-edge-2603); min_p/
		// repetition_penalty unknown → dropped.
		topP: true, topK: true, minP: false, repetitionPenalty: false,
		frequencyPenalty: true, presencePenalty: true, seed: true, stop: true,
	},
};

/** Caps for a built-in provider id. Unknown/custom ids get the extended
 *  posture (local vLLM/llama.cpp-style servers accept the full set). */
export function getParamCaps(providerId: string): ParamCaps {
	return CAPS_BY_PROVIDER[providerId] ?? CAPS_EXTENDED;
}

// ============================================================================
// REASONING EFFORT — provider wire dialects
// ============================================================================

/** Sampling knobs a provider rejects while a reasoning request is active —
 *  dropped from the options after layering so they never reach the wire. */
export type SamplingKey = 'temperature' | 'topP' | 'penalties' | 'stop';

export interface ReasoningWire {
	/** Body fragment for the provider's reasoning dialect, or null when the
	 *  effort can't be expressed on this provider (caller sends nothing). */
	body: Record<string, unknown> | null;
	/** Sampling keys to strip from the resolved options. */
	dropSampling: SamplingKey[];
}

/** Anthropic thinking budgets per effort level. Must stay strictly below
 *  max_tokens or the API rejects the request. */
const ANTHROPIC_THINKING_BUDGETS: Record<string, number> = {
	minimal: 2048,
	low: 2048,
	medium: 8192,
	high: 16384,
	max: 32768,
};

/**
 * Translate a reasoning-effort level into a provider's wire dialect.
 * Pure mapping — the caller merges `body` into the request (before the user's
 * extra-body passthrough, so it stays overridable) and strips every
 * `dropSampling` field from the resolved options.
 *
 * Per-provider quirks (see the matrix note for sources):
 *  - deepseek toggles via thinking{type} and its effort enum skips 'medium'
 *    (minimal→low, medium→high).
 *  - anthropic needs thinking.budget_tokens < max_tokens — the budget is
 *    dropped when the request's max tokens is too small to fit it.
 *  - ollama uses `think` (boolean or a model-defined string level).
 *  - cohere's compat layer accepts only 'none'/'high'.
 *  - fireworks can't disable thinking on some models ('off' sends nothing).
 *  - lmstudio/chutes/replicate: not documented on their compat endpoints —
 *    always null.
 */
export function getReasoningWire(providerId: string, effort: ReasoningEffort, maxTokens: number): ReasoningWire {
	// No documented reasoning control on the compat endpoint — send nothing.
	if (providerId === 'lmstudio' || providerId === 'chutes' || providerId === 'replicate' || providerId === 'ai21' || providerId === 'gmi'
		|| providerId === 'crusoe' || providerId === 'poe' || providerId === 'featherless' || providerId === 'scaleway' || providerId === 'reka') {
		return { body: null, dropSampling: [] };
	}

	const active = effort !== 'off';
	// Sampling params these providers reject alongside a reasoning request.
	// OpenAI GPT-6 migration guide: drop temperature, top_p, penalties and
	// stop when effort is active. xAI: penalties + stop. Meta: stop.
	const dropSampling: SamplingKey[] = [];
	if (active) {
		if (providerId === 'openai' || providerId === 'azure-openai' || providerId === 'chatgpt') {
			dropSampling.push('temperature', 'topP', 'penalties', 'stop');
		} else if (providerId === 'xai') {
			dropSampling.push('penalties', 'stop');
		} else if (providerId === 'meta') {
			dropSampling.push('stop');
		}
	}

	switch (providerId) {
		case 'chatgpt':
			// Responses API: reasoning{effort} — documented enum is low/medium/
			// high (no minimal/max). No documented way to disable reasoning,
			// so 'off' sends nothing. Same sampling-drop posture as the
			// chat-completions OpenAI provider: reasoning models reject
			// temperature/top_p alongside a reasoning request.
			return {
				body: !active ? null : {
					reasoning: { effort: effort === 'minimal' ? 'low' : effort === 'max' ? 'high' : effort },
				},
				dropSampling,
			};
		case 'deepseek':
			return {
				body: effort === 'off'
					? { thinking: { type: 'disabled' } }
					: {
						thinking: { type: 'enabled' },
						// Its enum is none/low/high/max — no 'minimal' or 'medium'.
						reasoning_effort: effort === 'minimal' ? 'low' : effort === 'medium' ? 'high' : effort,
					},
				dropSampling,
			};
		case 'moonshot':
			// kimi-k3 enum is low/high/max (default max) — no minimal/medium, and
			// no documented way to disable thinking, so 'off' sends nothing. The
			// k2.x models use a thinking{} dialect instead: leave effort off
			// there and pass thinking via the extra-body passthrough.
			return {
				body: !active ? null : {
					reasoning_effort: effort === 'minimal' ? 'low' : effort === 'medium' ? 'high' : effort,
				},
				dropSampling,
			};
		case 'minimax':
			// reasoning_effort (low/medium/high/xhigh/max) is honored by
			// M3.1-Flash-Preview only; 'none' → HTTP 400, so 'off' sends nothing.
			return {
				body: !active ? null : { reasoning_effort: effort === 'minimal' ? 'low' : effort },
				dropSampling,
			};
		case 'qwen':
			// Qwen dialect on compatible-mode is enable_thinking, not
			// reasoning_effort (unverified there). 3.6+ defaults to thinking on.
			return {
				body: { enable_thinking: active },
				dropSampling,
			};
		case 'nvidia':
			// Documented for gpt-oss-*: low/medium/high. 'off' unverified → send
			// nothing; minimal/max fold onto the nearest documented level.
			return {
				body: !active ? null : {
					reasoning_effort: effort === 'minimal' ? 'low' : effort === 'max' ? 'high' : effort,
				},
				dropSampling,
			};
		case 'friendli':
			// reasoning_effort enum is minimal..max/ultracode — no 'none', so
			// 'off' sends nothing rather than an unsupported value.
			return {
				body: !active ? null : { reasoning_effort: effort },
				dropSampling,
			};
		case 'stepfun':
			// reasoning_effort is low/medium/high — no 'none'/'minimal', and
			// 'off' is unverified, so it sends nothing.
			return {
				body: !active ? null : { reasoning_effort: effort === 'minimal' ? 'low' : effort },
				dropSampling,
			};
		case 'modelark':
			// Both thinking{type} and reasoning_effort are documented; the
			// native toggle handles 'off', effort levels fold onto the enum.
			return {
				body: !active
					? { thinking: { type: 'disabled' } }
					: { thinking: { type: 'enabled' }, reasoning_effort: effort === 'minimal' ? 'low' : effort === 'max' ? 'high' : effort },
				dropSampling,
			};
		case 'qianfan':
			// thinking.enable_thinking defaults false; reasoning_effort enum
			// is high|max (low/medium fold to high, per Baidu's own mapping).
			return {
				body: !active
					? { thinking: { enable_thinking: false } }
					: { thinking: { enable_thinking: true }, reasoning_effort: effort === 'max' ? 'max' : 'high' },
				dropSampling,
			};
		case 'siliconflow':
			// enable_thinking defaults TRUE on the international platform —
			// 'off' must send false explicitly or hybrid models surprise-CoT.
			// reasoning_effort enum is high|max (same folding as Qianfan).
			return {
				body: !active
					? { enable_thinking: false }
					: { enable_thinking: true, reasoning_effort: effort === 'max' ? 'max' : 'high' },
				dropSampling,
			};
		case 'tencent':
			// reasoning_effort (low/medium/high, internal mapping) is accepted,
			// but 'none' is unverified — 'off' uses the documented native
			// thinking toggle instead.
			return {
				body: !active
					? { thinking: { type: 'disabled' } }
					: { reasoning_effort: effort === 'minimal' ? 'low' : effort === 'max' ? 'high' : effort },
				dropSampling,
			};
		case 'anthropic': {
			// Disabled thinking is Claude's default — 'off' sends nothing.
			if (!active) return { body: null, dropSampling };
			const budget = ANTHROPIC_THINKING_BUDGETS[effort];
			// budget_tokens must be strictly less than max_tokens; when the
			// request's cap is too small, enabling thinking would 400.
			if (budget === undefined || budget >= maxTokens) return { body: null, dropSampling };
			return { body: { thinking: { type: 'enabled', budget_tokens: budget } }, dropSampling };
		}
		case 'ollama':
			return {
				// Boolean toggle, or a model-defined string level.
				body: effort === 'off' ? { think: false } : effort === 'max' ? { think: true } : { think: effort },
				dropSampling,
			};
		case 'google':
			return {
				body: { reasoning_effort: effort === 'off' ? 'none' : effort === 'max' ? 'high' : effort },
				dropSampling,
			};
		case 'cohere':
			// Compat layer accepts only 'none' and 'high' — collapse the scale.
			return { body: { reasoning_effort: effort === 'off' ? 'none' : 'high' }, dropSampling };
		case 'fireworks':
			// Some models cannot disable thinking — 'off' sends nothing.
			return { body: active ? { reasoning_effort: effort } : null, dropSampling };
		default:
			// OpenAI-style reasoning_effort, 'off' → 'none'. Unknown/custom ids
			// land here too and never accumulate dropSampling entries (only the
			// strict schemas above do), matching the extended posture.
			return { body: { reasoning_effort: effort === 'off' ? 'none' : effort }, dropSampling };
	}
}

/**
 * Append user-added model ids (Settings → "Add model") to a seed list as bare
 * entries. Returns the input array unchanged when there are no extras — never
 * mutates it, because def.models arrays are shared across provider instances.
 */
function applyExtraModels(models: AIModel[], config?: ProviderConfig): AIModel[] {
	const extras = config?.extraModels;
	if (!extras || extras.length === 0) return models;
	const seen = new Set(models.map((m) => m.id));
	const merged = [...models];
	for (const id of extras) {
		if (!id || seen.has(id)) continue;
		seen.add(id);
		merged.push({ id, name: id, contextLength: 0, inputPrice: 0, outputPrice: 0 });
	}
	return merged;
}

// ============================================================================
// BUILT-IN PROVIDER DEFINITIONS
// ============================================================================

export const PROVIDER_DEFINITIONS: ProviderDefinition[] = [
	{
		id: 'anthropic',
		name: 'Anthropic Claude',
		endpoint: 'https://api.anthropic.com/v1/messages',
		authType: 'anthropic',
		// Fallback list — auto-discovered from /v1/models at runtime.
		models: getAnthropicModels(),
		autoDiscoverModels: true,
	},
	{
		id: 'openai',
		name: 'OpenAI',
		endpoint: 'https://api.openai.com/v1/chat/completions',
		authType: 'bearer',
		// Fallback list — auto-discovered from /v1/models at runtime.
		// Verified 2026-10-09 via developers.openai.com/api/docs/models (+/deprecations).
		// GPT-6 generation is the current lineup; GPT-5.x chat models shut down
		// Aug-Oct 2026 (gpt-5.1 follows 2027-04-01). Context is the docs'
		// "1.05M" window, max output 128k.
		models: [
			{ id: 'gpt-6-astra', name: 'GPT-6 Astra', contextLength: 1048576, inputPrice: 10.0, outputPrice: 50.0, visionSupported: true, functionCallingSupported: true },
			{ id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', contextLength: 1048576, inputPrice: 2.0, outputPrice: 10.0, visionSupported: true, functionCallingSupported: true },
			{ id: 'gpt-6-luna', name: 'GPT-6 Luna', contextLength: 1048576, inputPrice: 0.1, outputPrice: 0.5, visionSupported: true, functionCallingSupported: true },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'chatgpt',
		name: 'ChatGPT (Sign in)',
		endpoint: 'https://api.openai.com/v1/responses',
		authType: 'oauth',
		// Sign in with ChatGPT (developers.openai.com cookbook, verified
		// 2026-10-09): ChatGPT Plus/Pro plans spend their allowance on the
		// standard Responses API via an OAuth access token — no API key, no
		// client secret. Plan availability is currently limited to open-source
		// and local apps, which Curtis is. Model catalog differs from the
		// API-key surface (plan serves the codex-flavored models); the seed
		// list below is a fallback — discovery via /v1/models fills actuals.
		// Subscription quota, not per-token billing → priced 0.
		models: [
			{ id: 'gpt-6.1-codex-max', name: 'GPT-6.1 Codex Max', contextLength: 1048576, inputPrice: 0, outputPrice: 0, visionSupported: true, functionCallingSupported: true },
			{ id: 'gpt-6-codex', name: 'GPT-6 Codex', contextLength: 1048576, inputPrice: 0, outputPrice: 0, visionSupported: true, functionCallingSupported: true },
			{ id: 'gpt-6-codex-mini', name: 'GPT-6 Codex Mini', contextLength: 1048576, inputPrice: 0, outputPrice: 0, functionCallingSupported: true },
			{ id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', contextLength: 1048576, inputPrice: 0, outputPrice: 0, visionSupported: true, functionCallingSupported: true },
			{ id: 'gpt-6-luna', name: 'GPT-6 Luna', contextLength: 1048576, inputPrice: 0, outputPrice: 0, visionSupported: true, functionCallingSupported: true },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'google',
		name: 'Google Gemini',
		endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
		authType: 'bearer',
		// Verified 2026-10-09 via ai.google.dev/gemini-api/docs/models (+/pricing).
		// No GA Pro right now: 3.1 Pro is preview-only and 2.5 Pro is
		// legacy-protected (prior users only, priced at the <=200k-prompt tier).
		// 3.x Flash prices are introductory through 2026-12-31 and double on
		// 2027-01-01. Seeds gemini-3-pro/gemini-3-flash dropped: gone from the
		// model index (gemini-3-pro-preview deprecated outright).
		models: [
			{ id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', contextLength: 1048576, inputPrice: 0.75, outputPrice: 3.75, visionSupported: true, functionCallingSupported: true },
			{ id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite', contextLength: 1048576, inputPrice: 0.3, outputPrice: 2.5, visionSupported: true, functionCallingSupported: true },
			{ id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash-Lite', contextLength: 1048576, inputPrice: 0.25, outputPrice: 1.5, visionSupported: true, functionCallingSupported: true },
			{ id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextLength: 1048576, inputPrice: 1.25, outputPrice: 10.0, visionSupported: true, functionCallingSupported: true },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'zai-glm',
		name: 'Z.ai Coding Plan',
		endpoint: 'https://api.z.ai/api/coding/paas/v4/chat/completions',
		authType: 'bearer',
		// Verified 2026-07-19 via GET /models on Coding Plan endpoint; glm-5.3
		// added 2026-10-04 — plan routing served 5.3 before /models listed it.
		models: [
			{ id: 'glm-5.3', name: 'GLM-5.3 (Latest)', contextLength: 128000, inputPrice: 0, outputPrice: 0 },
			{ id: 'glm-5.2', name: 'GLM-5.2', contextLength: 128000, inputPrice: 0, outputPrice: 0 },
			{ id: 'glm-5.1', name: 'GLM-5.1', contextLength: 128000, inputPrice: 0, outputPrice: 0 },
			{ id: 'glm-5', name: 'GLM-5', contextLength: 128000, inputPrice: 0, outputPrice: 0 },
			{ id: 'glm-5-turbo', name: 'GLM-5 Turbo', contextLength: 128000, inputPrice: 0, outputPrice: 0 },
			{ id: 'glm-4.7', name: 'GLM-4.7', contextLength: 128000, inputPrice: 0, outputPrice: 0 },
			{ id: 'glm-4.6', name: 'GLM-4.6', contextLength: 128000, inputPrice: 0, outputPrice: 0 },
			{ id: 'glm-4.5', name: 'GLM-4.5', contextLength: 128000, inputPrice: 0, outputPrice: 0 },
			{ id: 'glm-4.5-air', name: 'GLM-4.5 Air', contextLength: 128000, inputPrice: 0, outputPrice: 0 },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'ollama',
		name: 'Ollama (Local)',
		// Native dialect — hardware knobs (options.num_ctx, keep_alive) only
		// exist on /api/chat; the OpenAI-compat endpoint can't set them.
		endpoint: 'http://localhost:11434/api/chat',
		authType: 'none',
		models: [],
		autoDiscoverModels: true,
	},
	{
		id: 'lmstudio',
		name: 'LM Studio (Local)',
		endpoint: 'http://localhost:1234/v1/chat/completions',
		authType: 'none',
		models: [],
		autoDiscoverModels: true,
	},
	{
		id: 'openrouter',
		name: 'OpenRouter',
		endpoint: 'https://openrouter.ai/api/v1/chat/completions',
		authType: 'bearer',
		// 400+ models available; auto-discovery is mandatory for this provider.
		models: [
			{ id: 'openrouter/auto', name: 'Auto (Cheapest)', contextLength: 200000, inputPrice: 0.0, outputPrice: 0.0 },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'groq',
		name: 'Groq',
		endpoint: 'https://api.groq.com/openai/v1/chat/completions',
		authType: 'bearer',
		// Verified 2026-10-09 via console.groq.com/docs/models. Only the two
		// GPT-OSS models are self-serve with published prices now: the Llama
		// entries (3.3 70b versatile, 3.1 8b instant) moved to enterprise-only
		// on 2026-08-26 with contact-sales pricing, so they are dropped from
		// the seeds — enterprise keys get them back via discovery. Preview
		// tier (qwen3.8-27b, minimax-m2.7) excluded.
		models: [
			{ id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', contextLength: 131072, inputPrice: 0.15, outputPrice: 0.6 },
			{ id: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B', contextLength: 131072, inputPrice: 0.075, outputPrice: 0.3 },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'together',
		name: 'Together AI',
		endpoint: 'https://api.together.xyz/v1/chat/completions',
		authType: 'bearer',
		models: [
			{ id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', name: 'Llama 3.3 70B', contextLength: 128000, inputPrice: 0.88, outputPrice: 0.88 },
			{ id: 'Qwen/Qwen3-235B-Instruct-Turbo', name: 'Qwen3 235B', contextLength: 128000, inputPrice: 1.2, outputPrice: 1.2 },
			{ id: 'deepseek-ai/DeepSeek-V3.1-Instruct', name: 'DeepSeek V3.1', contextLength: 128000, inputPrice: 1.0, outputPrice: 1.0 },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'fireworks',
		name: 'Fireworks',
		endpoint: 'https://api.fireworks.ai/inference/v1/chat/completions',
		authType: 'bearer',
		models: [
			{ id: 'accounts/fireworks/models/llama-v3p3-70b-instruct', name: 'Llama 3.3 70B', contextLength: 131072, inputPrice: 0.9, outputPrice: 0.9 },
			{ id: 'accounts/fireworks/models/qwen3-235b-instruct', name: 'Qwen3 235B', contextLength: 131072, inputPrice: 1.2, outputPrice: 1.2 },
			{ id: 'accounts/fireworks/models/deepseek-v3-instruct', name: 'DeepSeek V3', contextLength: 131072, inputPrice: 1.0, outputPrice: 1.0 },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'mistral',
		name: 'Mistral',
		endpoint: 'https://api.mistral.ai/v1/chat/completions',
		authType: 'bearer',
		// Verified 2026-10-09 via docs.mistral.ai/inference/pricing (+/models and
		// /inference/model-selection-guide). Ids are the versioned slugs the
		// pricing page documents — aggregator data suggests -latest aliases lag
		// (large-latest still priced like Large 3). Large 4 is on sale; list is
		// 1.36/4.18. Devstral retired — removed.
		models: [
			{ id: 'mistral-large-4-0', name: 'Mistral Large 4', contextLength: 1048576, inputPrice: 0.68, outputPrice: 2.09, visionSupported: true, functionCallingSupported: true },
			{ id: 'mistral-medium-3-5-26-04', name: 'Mistral Medium 3.5', contextLength: 128000, inputPrice: 1.5, outputPrice: 7.5, functionCallingSupported: true },
			{ id: 'mistral-small-4-0-26-03', name: 'Mistral Small 4', contextLength: 128000, inputPrice: 0.15, outputPrice: 0.6 },
			{ id: 'ministral-3-8b-25-12', name: 'Ministral 3 8B', contextLength: 128000, inputPrice: 0.15, outputPrice: 0.15, visionSupported: true },
			{ id: 'codestral-25-08', name: 'Codestral', contextLength: 32768, inputPrice: 0.3, outputPrice: 0.9 },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'deepseek',
		name: 'DeepSeek',
		endpoint: 'https://api.deepseek.com/v1/chat/completions',
		authType: 'bearer',
		// Verified 2026-10-08 via api-docs.deepseek.com (pricing + chat-completion
		// reference). deepseek-flash serves DeepSeek-V4.1-Flash; the legacy
		// deepseek-v4-flash slug still routes there but is retired for naming.
		// Prices are off-peak (peak is 2x: 01:00-04:00, 06:00-10:00 UTC Mon-Fri).
		// NOTE: the server defaults these models to thinking mode, which ignores
		// temperature and delays first content token — see the capture scripts
		// for the thinking:disabled override used in demos.
		models: [
			{ id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash', contextLength: 1048576, inputPrice: 0.15, outputPrice: 0.6, functionCallingSupported: true },
			{ id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', contextLength: 1048576, inputPrice: 0.66, outputPrice: 1.98, functionCallingSupported: true },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'cohere',
		name: 'Cohere',
		endpoint: 'https://api.cohere.ai/compatibility/v1/chat/completions',
		authType: 'bearer',
		// Endpoint is the OpenAI-compat path. Verified 2026-10-09 via
		// docs.cohere.com/docs/models (+cohere.com/pricing).
		// Command A Plus (05-2026) is the current flagship — first Cohere MoE
		// model, unifies vision/agentic/reasoning. command-r / command-r-plus
		// are still served but 2024-era and superseded by the A family —
		// dropped; r7b stays as the budget option. A-family price is 2.5/10 on
		// Cohere's own API; Cohere's price page is now FAQ-only for legacy ids.
		models: [
			{ id: 'command-a-plus-05-2026', name: 'Command A Plus', contextLength: 128000, inputPrice: 2.5, outputPrice: 10.0, visionSupported: true, functionCallingSupported: true },
			{ id: 'command-a-03-2025', name: 'Command A', contextLength: 256000, inputPrice: 2.5, outputPrice: 10.0, functionCallingSupported: true },
			{ id: 'command-a-reasoning-08-2025', name: 'Command A Reasoning', contextLength: 256000, inputPrice: 2.5, outputPrice: 10.0, functionCallingSupported: true },
			{ id: 'command-r7b-12-2024', name: 'Command R7B', contextLength: 128000, inputPrice: 0.1, outputPrice: 0.4 },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'vercel-ai-gateway',
		name: 'Vercel AI Gateway',
		endpoint: 'https://ai-gateway.vercel.sh/v1/chat/completions',
		authType: 'bearer',
		// One key, 20+ providers (OpenAI, Anthropic, Google, xAI, Mistral, etc.)
		// Model IDs are namespaced: openai/gpt-5.x, anthropic/claude-*, google/gemini-*
		models: [],
		autoDiscoverModels: true,
	},
	{
		id: 'meta',
		name: 'Meta Muse',
		endpoint: 'https://api.meta.ai/v1/chat/completions',
		authType: 'bearer',
		// Verified 2026-10-09 via ai.developer.meta.com (getting-started/overview,
		// models, pricing-rate-limits). OpenAI-compatible /v1/chat/completions;
		// Bearer key. One price for all Muse Spark models, no long-context premium.
		models: [
			{ id: 'muse-spark-1.3', name: 'Muse Spark 1.3', contextLength: 1048576, inputPrice: 1.25, outputPrice: 4.25, visionSupported: true, functionCallingSupported: true },
			{ id: 'muse-spark-1.2', name: 'Muse Spark 1.2', contextLength: 1048576, inputPrice: 1.25, outputPrice: 4.25, visionSupported: true, functionCallingSupported: true },
			{ id: 'muse-spark-1.1', name: 'Muse Spark 1.1', contextLength: 1048576, inputPrice: 1.25, outputPrice: 4.25, visionSupported: true, functionCallingSupported: true },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'xai',
		name: 'xAI Grok',
		endpoint: 'https://api.x.ai/v1/chat/completions',
		authType: 'bearer',
		// Verified 2026-10-09 via docs.x.ai/developers/models (pricing table +
		// per-model pages). Prices are base (<200k prompt tokens); requests
		// reaching 200k bill all tokens at 2x. Discovery merges anything
		// omitted here (grok-4.5 superseded by 4.6; imagine/voice excluded).
		models: [
			{ id: 'grok-4.7', name: 'Grok 4.7', contextLength: 500000, inputPrice: 2.0, outputPrice: 6.0, visionSupported: true, functionCallingSupported: true },
			{ id: 'grok-4.6', name: 'Grok 4.6', contextLength: 500000, inputPrice: 2.0, outputPrice: 6.0, visionSupported: true, functionCallingSupported: true },
			{ id: 'grok-4.3', name: 'Grok 4.3', contextLength: 1000000, inputPrice: 1.25, outputPrice: 2.5, visionSupported: true, functionCallingSupported: true },
			{ id: 'grok-build-0.1', name: 'Grok Build 0.1', contextLength: 256000, inputPrice: 1.0, outputPrice: 2.0, visionSupported: true, functionCallingSupported: true },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'perplexity',
		name: 'Perplexity',
		// Router endpoint — the legacy /chat/completions Sonar path was deleted
		// from the docs and is being migrated away.
		endpoint: 'https://api.perplexity.ai/router/v1/chat/completions',
		authType: 'bearer',
		// Verified 2026-10-09 via docs.perplexity.ai/getting-started/models.
		// Token prices unchanged from prior verification; docs no longer
		// publish context windows, so prior values are retained (deep-research
		// 128k corroborated by third-party trackers of the model card).
		// Token prices exclude per-request search fees ($5-14 /1k requests).
		models: [
			{ id: 'sonar-pro', name: 'Sonar Pro', contextLength: 200000, inputPrice: 3.0, outputPrice: 15.0, functionCallingSupported: true },
			{ id: 'sonar-reasoning-pro', name: 'Sonar Reasoning Pro', contextLength: 127000, inputPrice: 2.0, outputPrice: 8.0 },
			{ id: 'sonar-deep-research', name: 'Sonar Deep Research', contextLength: 128000, inputPrice: 2.0, outputPrice: 8.0 },
			{ id: 'sonar', name: 'Sonar', contextLength: 127000, inputPrice: 1.0, outputPrice: 1.0 },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'novita',
		name: 'Novita AI',
		endpoint: 'https://api.novita.ai/v3/openai/chat/completions',
		authType: 'bearer',
		models: [
			{ id: 'deepseek/deepseek-v3-0324', name: 'DeepSeek V3 0324', contextLength: 64000, inputPrice: 0.2, outputPrice: 0.5 },
			{ id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', contextLength: 64000, inputPrice: 0.4, outputPrice: 0.8 },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'deepinfra',
		name: 'DeepInfra',
		endpoint: 'https://api.deepinfra.com/v1/openai/chat/completions',
		authType: 'bearer',
		models: [
			{ id: 'meta-llama/Llama-3.3-70B-Instruct', name: 'Llama 3.3 70B', contextLength: 64000, inputPrice: 0.35, outputPrice: 0.4 },
			{ id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3', contextLength: 64000, inputPrice: 0.27, outputPrice: 1.1 },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'chutes',
		name: 'Chutes AI',
		endpoint: 'https://api.chutes.ai/v1/chat/completions',
		authType: 'bearer',
		models: [
			{ id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3', contextLength: 64000 },
			{ id: 'Qwen/Qwen2.5-Coder-32B-Instruct', name: 'Qwen 2.5 Coder 32B', contextLength: 32768 },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'replicate',
		name: 'Replicate',
		endpoint: 'https://api.replicate.com/v1/chat/completions',
		authType: 'bearer',
		models: [
			{ id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', contextLength: 128000 },
			{ id: 'deepseek-ai/deepseek-r1', name: 'DeepSeek R1', contextLength: 128000 },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'huggingface',
		name: 'Hugging Face',
		endpoint: 'https://api.endpoints.huggingface.co/v1/chat/completions',
		authType: 'bearer',
		models: [
			{ id: 'meta-llama/Llama-3.3-70B-Instruct', name: 'Llama 3.3 70B', contextLength: 131072 },
			{ id: 'Qwen/Qwen2.5-72B-Instruct', name: 'Qwen 2.5 72B', contextLength: 32768 },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'azure-openai',
		name: 'Azure OpenAI',
		// User must supply full deployment URL in customEndpoint:
		// https://<resource>.openai.azure.com/openai/deployments/<deployment>/chat/completions?api-version=2024-10-21
		endpoint: '',
		authType: 'bearer',
		models: [],
		autoDiscoverModels: false,
	},
	{
		id: 'fal',
		name: 'fal.ai',
		// api.fal.ai serves no LLM chat — the OpenAI-compatible endpoint is an
		// OpenRouter passthrough on fal.run, using fal's `Key` auth scheme
		// (Authorization: Key <FAL_KEY>, not Bearer). See the vault note
		// "Provider Parameter Matrix" (2026-10-09).
		endpoint: 'https://fal.run/openrouter/router/openai/v1/chat/completions',
		authType: 'key',
		models: [],
		autoDiscoverModels: true,
	},
	{
		id: 'cerebras',
		name: 'Cerebras',
		endpoint: 'https://api.cerebras.ai/v1/chat/completions',
		authType: 'bearer',
		// Verified 2026-10-09 via inference-docs.cerebras.ai/models/overview.
		// Shared-inference GA catalog is now gpt-oss-120b + qwen-3.8-27b; the
		// old llama-3.3-70b / llama3.1-8b seeds are gone from the catalog.
		// Contexts are paid-tier limits (free tier is roughly half). Per-token
		// prices are no longer published on the pricing page (credits/tiers),
		// so they stay 0.
		models: [
			{ id: 'gpt-oss-120b', name: 'GPT-OSS 120B', contextLength: 131072, inputPrice: 0, outputPrice: 0 },
			{ id: 'qwen-3.8-27b', name: 'Qwen 3.8 27B', contextLength: 128000, inputPrice: 0, outputPrice: 0 },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'sambanova',
		name: 'SambaNova',
		endpoint: 'https://api.sambanova.ai/v1/chat/completions',
		authType: 'bearer',
		models: [
			{ id: 'Meta-Llama-3.3-70B-Instruct', name: 'Llama 3.3 70B', contextLength: 64000 },
			{ id: 'DeepSeek-V3', name: 'DeepSeek V3', contextLength: 64000 },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'requesty',
		name: 'Requesty',
		endpoint: 'https://router.requesty.ai/v1/chat/completions',
		authType: 'bearer',
		models: [
			{ id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat', contextLength: 128000 },
			{ id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', contextLength: 200000 },
		],
		autoDiscoverModels: true,
	},
	// --- 2026-10 batch: internationals + open-weight clouds. All verified
	// 2026-10-09 against official docs (plus live endpoint probes where the
	// researcher could reach them); five candidates researched at the same
	// time were already dead (GitHub Models retired 2026-07-30, Hyperbolic
	// inference decommissioned, Lambda Inference winding down, kluster.ai
	// defunct, 01.AI discontinued 2026-09-03) — if one of these rows ever
	// 401s on a fresh key, check the vendor is still serving before
	// debugging the plugin.
	{
		id: 'nvidia',
		name: 'NVIDIA NIM',
		endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions',
		authType: 'bearer',
		// build.nvidia.com quickstart + docs.api.nvidia.com/nim/reference/llm-apis.
		// Hosted API is a free-credits tier — per-token prices not published.
		// Catalog churns constantly (partner-hosted models); /v1/models at
		// runtime is authoritative, seeds are just the two verified model cards.
		models: [
			{ id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', contextLength: 131072, inputPrice: 0, outputPrice: 0, functionCallingSupported: true },
			{ id: 'qwen/qwen3-next-80b-a3b-instruct', name: 'Qwen3 Next 80B', contextLength: 262144, inputPrice: 0, outputPrice: 0, functionCallingSupported: true },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'moonshot',
		name: 'Moonshot Kimi',
		endpoint: 'https://api.moonshot.ai/v1/chat/completions',
		authType: 'bearer',
		// Verified 2026-10-09 via platform.kimi.ai/docs (chat, models-overview,
		// pricing, list-models). Keys from platform.kimi.ai and platform.kimi.com
		// are NOT interchangeable. Temperature/top_p are pinned per model — the
		// caps matrix never sends ours.
		models: [
			{ id: 'kimi-k3', name: 'Kimi K3', contextLength: 1048576, inputPrice: 3.0, outputPrice: 15.0, visionSupported: true, functionCallingSupported: true },
			{ id: 'kimi-k2.6', name: 'Kimi K2.6', contextLength: 262144, inputPrice: 0.95, outputPrice: 4.0, functionCallingSupported: true },
			{ id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code', contextLength: 262144, inputPrice: 0.95, outputPrice: 4.0, functionCallingSupported: true },
			{ id: 'kimi-k2.7-code-highspeed', name: 'Kimi K2.7 Code Highspeed', contextLength: 262144, inputPrice: 1.9, outputPrice: 8.0, functionCallingSupported: true },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'kimi-coding',
		name: 'Kimi for Coding',
		endpoint: 'https://api.kimi.com/coding/v1/chat/completions',
		authType: 'bearer',
		// Kimi's subscription coding plan (kimi.com/code/docs, verified
		// 2026-10-09): OpenAI-compatible chat-completions at /coding/v1, plan
		// keys issued from kimi.com — NOT interchangeable with platform keys
		// (same split as the platform endpoints above). Quota is calls per
		// 5-hour window, not per-token billing, so plan models are priced 0.
		// Seed list mirrors the platform catalog; discovery fills actuals.
		models: [
			{ id: 'kimi-k3', name: 'Kimi K3', contextLength: 1048576, inputPrice: 0, outputPrice: 0, visionSupported: true, functionCallingSupported: true },
			{ id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code', contextLength: 262144, inputPrice: 0, outputPrice: 0, functionCallingSupported: true },
			{ id: 'kimi-k2.7-code-highspeed', name: 'Kimi K2.7 Code Highspeed', contextLength: 262144, inputPrice: 0, outputPrice: 0, functionCallingSupported: true },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'minimax',
		name: 'MiniMax',
		endpoint: 'https://api.minimax.io/v1/chat/completions',
		authType: 'bearer',
		// Verified 2026-10-09 via platform.minimax.io/docs (api-reference,
		// pricing-paygo, models-intro). Pricing page is authoritative over the
		// API-reference overview (M3 standard tier is a permanent 50% off,
		// ≤512k input; 2x above that). M2.x contexts no longer published.
		models: [
			{ id: 'MiniMax-M3', name: 'MiniMax M3', contextLength: 1000000, inputPrice: 0.3, outputPrice: 1.2, visionSupported: true, functionCallingSupported: true },
			{ id: 'MiniMax-M2.7', name: 'MiniMax M2.7', contextLength: 0, inputPrice: 0.3, outputPrice: 1.2, functionCallingSupported: true },
			{ id: 'MiniMax-M2.5', name: 'MiniMax M2.5', contextLength: 0, inputPrice: 0.3, outputPrice: 1.2, functionCallingSupported: true },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'qwen',
		name: 'Alibaba Qwen',
		endpoint: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
		authType: 'bearer',
		// Verified 2026-10-09 via alibabacloud.com/help/en/model-studio. The
		// dashscope-intl shared domain is legacy-but-supported; workspace-
		// dedicated domains exist and can be set as a custom endpoint. Keys are
		// region-locked (Singapore ≠ Beijing ≠ US). Contexts for Plus/Flash
		// tiers not republished — discovery fills them.
		models: [
			{ id: 'qwen3.8-max', name: 'Qwen3.8 Max', contextLength: 1000000, inputPrice: 2.0, outputPrice: 6.0, visionSupported: true, functionCallingSupported: true },
			{ id: 'qwen3.7-plus', name: 'Qwen3.7 Plus', contextLength: 0, inputPrice: 0.4, outputPrice: 1.6, functionCallingSupported: true },
			{ id: 'qwen3.8-flash', name: 'Qwen3.8 Flash', contextLength: 0, inputPrice: 0.15, outputPrice: 0.47, visionSupported: true, functionCallingSupported: true },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'qwen-coding',
		name: 'Alibaba Coding Plan',
		endpoint: 'https://coding-intl.dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
		authType: 'bearer',
		// Model Studio Coding Plan (alibabacloud.com, verified 2026-10-09): a
		// fixed-monthly subscription whose plan keys are served by the
		// dedicated coding-intl host — standard DashScope keys 401 there, and
		// plan keys 401 on the regular endpoint. China (Beijing) plan accounts
		// use the CN coding host via a custom endpoint. The plan bundles
		// Qwen/GLM/Kimi/MiniMax models; discovery fills what the account
		// actually serves. Plan quota, not per-token billing → priced 0.
		models: [
			{ id: 'qwen3.5-plus', name: 'Qwen3.5 Plus', contextLength: 0, inputPrice: 0, outputPrice: 0, functionCallingSupported: true },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'ai21',
		name: 'AI21 Jamba',
		endpoint: 'https://api.ai21.com/studio/v1/chat/completions',
		authType: 'bearer',
		// Verified 2026-10-09 via docs.ai21.com (jamba api-ref, foundation
		// models, pricing) + live probe: /v1/chat/completions 404s — the
		// /studio prefix is required. Versionless aliases resolve to the
		// current snapshots. max_tokens hard-capped at 4096 server-side.
		models: [
			{ id: 'jamba-mini', name: 'Jamba Mini', contextLength: 256000, inputPrice: 0.2, outputPrice: 0.4, functionCallingSupported: true },
			{ id: 'jamba-large', name: 'Jamba Large', contextLength: 256000, inputPrice: 2.0, outputPrice: 8.0, functionCallingSupported: true },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'upstage',
		name: 'Upstage Solar',
		endpoint: 'https://api.upstage.ai/v1/chat/completions',
		authType: 'bearer',
		// Verified 2026-10-09 via console.upstage.ai/docs. Current base is /v1 —
		// the old /v1/solar/ segment still resolves but is legacy. Aliases
		// resolve to dated snapshots (solar-pro4-260806, solar-mini4-260922).
		models: [
			{ id: 'solar-pro4', name: 'Solar Pro 4', contextLength: 512000, inputPrice: 0.3, outputPrice: 1.2, functionCallingSupported: true },
			{ id: 'solar-mini4', name: 'Solar Mini 4', contextLength: 512000, inputPrice: 0.1, outputPrice: 0.4, functionCallingSupported: true },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'nebius',
		name: 'Nebius',
		endpoint: 'https://api.tokenfactory.nebius.com/v1/chat/completions',
		authType: 'bearer',
		// Verified 2026-10-09 via docs.tokenfactory.nebius.com — AI Studio
		// rebranded to Token Factory (Nov 2025); the old api.studio.nebius.ai
		// host still resolves but docs reference only tokenfactory. Per-model
		// prices/contexts not published in docs (discovery can read them from
		// /v1/models?verbose=true); seed ids are the documented examples.
		models: [
			{ id: 'moonshotai/Kimi-K2.5', name: 'Kimi K2.5', contextLength: 0, inputPrice: 0, outputPrice: 0 },
			{ id: 'meta-llama/Llama-3.3-70B-Instruct', name: 'Llama 3.3 70B', contextLength: 0, inputPrice: 0, outputPrice: 0 },
			{ id: 'deepseek-ai/DeepSeek-V4-Flash', name: 'DeepSeek V4 Flash', contextLength: 0, inputPrice: 0, outputPrice: 0 },
			{ id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', contextLength: 131072, inputPrice: 0, outputPrice: 0 },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'baseten',
		name: 'Baseten',
		endpoint: 'https://inference.baseten.co/v1/chat/completions',
		authType: 'bearer',
		// Verified 2026-10-09 via docs.baseten.co (inference-api reference +
		// OpenAPI spec) and baseten.co/pricing. Server default max_tokens is
		// 4096 — we always send ours explicitly. Extended sampling params
		// (top_k/min_p/repetition_penalty/seed) are in the OpenAPI spec.
		models: [
			{ id: 'deepseek-ai/DeepSeek-V4.1-Flash', name: 'DeepSeek V4.1 Flash', contextLength: 1048576, inputPrice: 0.3, outputPrice: 1.2, functionCallingSupported: true },
			{ id: 'moonshotai/Kimi-K3', name: 'Kimi K3', contextLength: 1048576, inputPrice: 3.0, outputPrice: 15.0, functionCallingSupported: true },
			{ id: 'zai-org/GLM-5.3', name: 'GLM-5.3', contextLength: 1048576, inputPrice: 1.4, outputPrice: 4.4, functionCallingSupported: true },
			{ id: 'zai-org/GLM-5.3-Flash', name: 'GLM-5.3 Flash', contextLength: 1048576, inputPrice: 0.15, outputPrice: 0.5, functionCallingSupported: true },
			{ id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', contextLength: 131072, inputPrice: 0.1, outputPrice: 0.5, functionCallingSupported: true },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'inference-net',
		name: 'Inference.net',
		endpoint: 'https://api.inference.net/v1/chat/completions',
		authType: 'bearer',
		// Verified 2026-10-09 against the live /v1/models (public) and
		// docs.inference.net. Most ids carry no publisher prefix; both
		// kimi-k3-fast and moonshotai/kimi-k3-fast exist as DIFFERENT ids
		// with different contexts — don't "normalize" them.
		models: [
			{ id: 'glm-5.3', name: 'GLM-5.3', contextLength: 1048576, inputPrice: 0.9, outputPrice: 3.0, functionCallingSupported: true },
			{ id: 'glm-5.3-flash', name: 'GLM-5.3 Flash', contextLength: 1048576, inputPrice: 0.1, outputPrice: 0.45, visionSupported: true, functionCallingSupported: true },
			{ id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', contextLength: 1040000, inputPrice: 0.3, outputPrice: 1.0, visionSupported: true, functionCallingSupported: true },
			{ id: 'moonshotai/kimi-k3', name: 'Kimi K3', contextLength: 1048576, inputPrice: 3.0, outputPrice: 15.0, visionSupported: true, functionCallingSupported: true },
			{ id: 'gpt-5-mini', name: 'GPT-5 Mini', contextLength: 400000, inputPrice: 0.25, outputPrice: 2.0, visionSupported: true, functionCallingSupported: true },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'ovh',
		name: 'OVHcloud AI Endpoints',
		endpoint: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions',
		authType: 'bearer',
		// Verified 2026-10-09 via docs.ovhcloud.com AI Endpoints guides + live
		// /v1/models (public). Seed prices are the catalog's EUR list prices —
		// the live /models endpoint returns USD equivalents, so discovery
		// supersedes them. Catalog id quirks are real: underscores in the
		// Llama id, dots in the Qwen ids.
		models: [
			{ id: 'gpt-oss-120b', name: 'GPT-OSS 120B', contextLength: 131072, inputPrice: 0.08, outputPrice: 0.4, functionCallingSupported: true },
			{ id: 'Qwen3.5-397B-A17B', name: 'Qwen3.5 397B', contextLength: 262144, inputPrice: 0.6, outputPrice: 3.6, visionSupported: true, functionCallingSupported: true },
			{ id: 'Qwen3.6-27B', name: 'Qwen3.6 27B', contextLength: 262144, inputPrice: 0.4, outputPrice: 2.7, visionSupported: true, functionCallingSupported: true },
			{ id: 'Meta-Llama-3_3-70B-Instruct', name: 'Llama 3.3 70B', contextLength: 131072, inputPrice: 0.67, outputPrice: 0.67, functionCallingSupported: true },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'friendli',
		name: 'FriendliAI',
		endpoint: 'https://api.friendli.ai/serverless/v1/chat/completions',
		authType: 'bearer',
		// Verified 2026-10-09 via friendli.ai/docs (OpenAPI spec + guides) and
		// a live /serverless/v1/models probe. Dedicated endpoints use
		// /dedicated/v1 — settable as a custom endpoint. The old
		// inference.churros.friendli.ai host no longer resolves. Length knob
		// is max_tokens only (no max_completion_tokens in the schema).
		models: [
			{ id: 'zai-org/GLM-5.3', name: 'GLM-5.3', contextLength: 1048576, inputPrice: 1.4, outputPrice: 4.4, functionCallingSupported: true },
			{ id: 'zai-org/GLM-5.3-Flash', name: 'GLM-5.3 Flash', contextLength: 1048576, inputPrice: 0.15, outputPrice: 0.5, visionSupported: true, functionCallingSupported: true },
			{ id: 'zai-org/GLM-5.2', name: 'GLM-5.2', contextLength: 1048576, inputPrice: 1.4, outputPrice: 4.4, functionCallingSupported: true },
			{ id: 'google/gemma-4-31B-it', name: 'Gemma 4 31B', contextLength: 262144, inputPrice: 0.14, outputPrice: 0.4, visionSupported: true, functionCallingSupported: true },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'gmi',
		name: 'GMI Cloud',
		endpoint: 'https://api.gmi-serving.com/v1/chat/completions',
		authType: 'bearer',
		// Verified 2026-10-09 via docs.gmicloud.ai + live /v1/models probe
		// (401 without key — endpoint exists). Contexts/prices live in the
		// console Model Hub, not the docs — DeepSeek-V4-Flash's 1M context is
		// the one documented number. Proprietary ids in their library are
		// router-proxied; the open-weight seeds below are served directly.
		models: [
			{ id: 'deepseek-ai/DeepSeek-V4-Flash', name: 'DeepSeek V4 Flash', contextLength: 1048576, inputPrice: 0, outputPrice: 0, functionCallingSupported: true },
			{ id: 'moonshotai/Kimi-K2.6', name: 'Kimi K2.6', contextLength: 0, inputPrice: 0, outputPrice: 0, functionCallingSupported: true },
			{ id: 'Qwen/Qwen3.6-Plus', name: 'Qwen3.6 Plus', contextLength: 0, inputPrice: 0, outputPrice: 0 },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'stepfun',
		name: 'StepFun',
		endpoint: 'https://api.stepfun.ai/v1/chat/completions',
		authType: 'bearer',
		// Verified 2026-10-09 via platform.stepfun.ai docs (api-reference,
		// models, pricing, OpenAI guide) + live probes on both platforms.
		// This is the INTERNATIONAL endpoint (USD billing) — the CN platform
		// is api.stepfun.com and keys are not interchangeable across the two
		// (a CN key here fails with a misleading 401).
		models: [
			{ id: 'step-5-preview', name: 'Step 5 Preview', contextLength: 1048576, inputPrice: 1.0, outputPrice: 2.7, visionSupported: true, functionCallingSupported: true },
			{ id: 'step-3.7-flash', name: 'Step 3.7 Flash', contextLength: 262144, inputPrice: 0.2, outputPrice: 1.15, visionSupported: true, functionCallingSupported: true },
			{ id: 'step-3.5-flash', name: 'Step 3.5 Flash', contextLength: 262144, inputPrice: 0.1, outputPrice: 0.3, functionCallingSupported: true },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'tencent',
		name: 'Tencent Hunyuan',
		endpoint: 'https://tokenhub-intl.tencentcloudmaas.com/v1/chat/completions',
		authType: 'bearer',
		// Verified 2026-10-09 via tencentcloud.com TokenHub docs (model list,
		// chat protocol, pricing). TokenHub is the international path — no CN
		// real-name verification. Models must be activated in the console
		// first or calls 402; the CN open-platform endpoint is migrating into
		// TokenHub and needs CN identity verification — don't switch defaults.
		models: [
			{ id: 'hy4-preview', name: 'Hunyuan 4 Preview', contextLength: 1048576, inputPrice: 0.834, outputPrice: 2.501, functionCallingSupported: true },
			{ id: 'hy3', name: 'Hunyuan 3', contextLength: 262144, inputPrice: 0.132, outputPrice: 0.528, functionCallingSupported: true },
		],
		autoDiscoverModels: true,
	},
	// --- 2026-10-10 batch: nine more verified providers (44 → 53). All
	// verified 2026-10-10 against official docs plus live endpoint probes
	// (401 challenge = route exists); candidates rejected in the same pass:
	// Nscale (entire legacy catalog retires 2026-11-02), Cloudflare Workers
	// AI (account-id embedded in the URL, no OpenAI-shaped /models), Writer
	// (chat lives at /v1/chat, not /v1/chat/completions), iFlow (chat
	// endpoint is an undocumented backend for their own assistant), SenseNova
	// (opaque pricing/docs), Liquid AI (hosted API gone — on-device only).
	{
		id: 'zai',
		name: 'Z.ai GLM',
		endpoint: 'https://api.z.ai/api/paas/v4/chat/completions',
		authType: 'bearer',
		// Verified 2026-10-10 via docs.z.ai (chat-completion reference,
		// pricing, GLM-5.3 guide) + live /models probe. Pay-as-you-go sibling
		// of the coding-plan provider (zai-glm) — separate keys and billing.
		// Wire dialect is identical: temperature 0..1, no penalties/seed/
		// top_k, max_tokens only. GLM-5.3 cannot disable thinking (thinking
		// accepts only 'enabled'); reasoning_effort enum includes 'none'.
		// The CN platform (open.bigmodel.cn/api/paas/v4) is byte-compatible —
		// CN users can set it as a custom endpoint.
		models: [
			{ id: 'glm-5.3', name: 'GLM-5.3', contextLength: 1048576, inputPrice: 1.4, outputPrice: 4.4, functionCallingSupported: true },
			{ id: 'glm-5.3-flash', name: 'GLM-5.3 Flash', contextLength: 1048576, inputPrice: 0.15, outputPrice: 0.5, visionSupported: true, functionCallingSupported: true },
			{ id: 'glm-5.3-flashx', name: 'GLM-5.3 FlashX', contextLength: 0, inputPrice: 0.37, outputPrice: 1.25, visionSupported: true, functionCallingSupported: true },
			{ id: 'glm-5.2', name: 'GLM-5.2', contextLength: 0, inputPrice: 1.4, outputPrice: 4.4, functionCallingSupported: true },
			{ id: 'glm-4.7', name: 'GLM-4.7', contextLength: 0, inputPrice: 0.6, outputPrice: 2.2, functionCallingSupported: true },
			{ id: 'glm-4.7-flash', name: 'GLM-4.7 Flash (Free)', contextLength: 0, inputPrice: 0, outputPrice: 0, functionCallingSupported: true },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'modelark',
		name: 'BytePlus ModelArk',
		endpoint: 'https://ark.ap-southeast.bytepluses.com/api/v3/chat/completions',
		authType: 'bearer',
		// Verified 2026-10-10 via docs.byteplus.com ModelArk (text generation,
		// chat API reference updated 2026-10-06, model list, pricing) + live
		// /api/v3/models probe (OpenAI-style 401). ByteDance's international
		// ModelArk — the Doubao family ships here as Seed models. Keys are
		// region-scoped (ap-southeast; eu-west region has a smaller catalog
		// at ark.eu-west.bytepluses.com via custom endpoint). Model ids carry
		// date suffixes and retire with named replacements; tiered pricing by
		// prompt length (seeds list the base tier). CN sibling
		// ark.cn-beijing.volces.com speaks the identical wire format.
		models: [
			{ id: 'dola-seed-2-1-turbo-260628', name: 'Dola Seed 2.1 Turbo', contextLength: 262144, inputPrice: 0.5, outputPrice: 2.5, visionSupported: true, functionCallingSupported: true },
			{ id: 'seed-2-0-pro-260328', name: 'Seed 2.0 Pro', contextLength: 262144, inputPrice: 0.5, outputPrice: 3.0, visionSupported: true, functionCallingSupported: true },
			{ id: 'seed-2-0-lite-260428', name: 'Seed 2.0 Lite', contextLength: 262144, inputPrice: 0.25, outputPrice: 2.0, visionSupported: true, functionCallingSupported: true },
			{ id: 'seed-2-0-mini-260428', name: 'Seed 2.0 Mini', contextLength: 262144, inputPrice: 0.1, outputPrice: 0.4, visionSupported: true, functionCallingSupported: true },
			{ id: 'deepseek-v4-1-flash-260910', name: 'DeepSeek V4.1 Flash', contextLength: 1048576, inputPrice: 0.15, outputPrice: 0.6, visionSupported: true, functionCallingSupported: true },
			{ id: 'glm-5-3-flash-260828', name: 'GLM-5.3 Flash', contextLength: 1048576, inputPrice: 0.15, outputPrice: 0.5, visionSupported: true, functionCallingSupported: true },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'qianfan',
		name: 'Baidu Qianfan',
		endpoint: 'https://qianfan.baidubce.com/v2/chat/completions',
		authType: 'bearer',
		// Verified 2026-10-10 via cloud.baidu.com qianfan-api docs (text
		// generation 2026-09-29, GET /v2/models 2026-10-09, auth, pricing) +
		// live probe. The v2 API is OpenAI-compatible and its /v2/models is
		// the richest discovery surface of any built-in: context, features,
		// and per-token pricing per model. No separate intl host exists — CN
		// real-name verification and CNY billing apply; seed prices are USD
		// conversions of the published CNY list (at ¥7.1/$, noted per model
		// in Qianfan's pricing page). Also hosts qwen/glm/kimi/deepseek.
		// stream_options.include_usage is documented (final-chunk usage).
		models: [
			{ id: 'ernie-5.1', name: 'ERNIE 5.1', contextLength: 131072, inputPrice: 0.56, outputPrice: 2.54, functionCallingSupported: true },
			{ id: 'ernie-4.5-turbo-128k', name: 'ERNIE 4.5 Turbo 128K', contextLength: 131072, inputPrice: 0.11, outputPrice: 0.45, functionCallingSupported: true },
			{ id: 'ernie-4.5-turbo-vl', name: 'ERNIE 4.5 Turbo VL', contextLength: 131072, inputPrice: 0.42, outputPrice: 1.27, visionSupported: true, functionCallingSupported: true },
			{ id: 'ernie-x1.1', name: 'ERNIE X1.1 (thinking)', contextLength: 65536, inputPrice: 0.14, outputPrice: 0.56, functionCallingSupported: true },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'siliconflow',
		name: 'SiliconFlow',
		endpoint: 'https://api.siliconflow.com/v1/chat/completions',
		authType: 'bearer',
		// Verified 2026-10-10 via docs.siliconflow.com (chat completions,
		// get-model-list) + siliconflow.com/pricing + live probes on both
		// platforms. The INTERNATIONAL platform (USD, $1 free credit) — the
		// CN site api.siliconflow.cn is a separate account/key universe, set
		// via custom endpoint. /v1/models returns no context or pricing
		// metadata, so seed metadata survives discovery. max_tokens excludes
		// chain-of-thought (docs advise a ~10k buffer on thinking models).
		// enable_thinking defaults TRUE here — Curtis always sends it.
		models: [
			{ id: 'deepseek-ai/DeepSeek-V4.1-Flash', name: 'DeepSeek V4.1 Flash', contextLength: 1048576, inputPrice: 0.15, outputPrice: 0.6, functionCallingSupported: true },
			{ id: 'deepseek-ai/DeepSeek-V4-Pro-0813', name: 'DeepSeek V4 Pro', contextLength: 1048576, inputPrice: 1.32, outputPrice: 3.96, functionCallingSupported: true },
			{ id: 'zai-org/GLM-5.3', name: 'GLM-5.3', contextLength: 1048576, inputPrice: 1.4, outputPrice: 4.4, functionCallingSupported: true },
			{ id: 'zai-org/GLM-5.3-Flash', name: 'GLM-5.3 Flash', contextLength: 1048576, inputPrice: 0.15, outputPrice: 0.5, functionCallingSupported: true },
			{ id: 'moonshotai/Kimi-K3', name: 'Kimi K3', contextLength: 1048576, inputPrice: 2.7, outputPrice: 13.5, functionCallingSupported: true },
			{ id: 'Qwen/Qwen3.8-2.4T-A95B', name: 'Qwen3.8 2.4T', contextLength: 1048576, inputPrice: 2.0, outputPrice: 6.0, functionCallingSupported: true },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'crusoe',
		name: 'Crusoe Cloud',
		endpoint: 'https://api.inference.crusoecloud.com/v1/chat/completions',
		authType: 'bearer',
		// Verified 2026-10-10 via docs.crusoecloud.com (serverless inference
		// quickstart, available-models, pricing) + live /v1/models probe.
		// Crusoe's Intelligence API keys (console Admin → Security) — not
		// cloud account keys. Engine is their own stack (not vLLM); no
		// parameter table is published, so caps stay conservative. They
		// rotate the catalog hard (recently deprecated the Llama/GLM-5.1/
		// Kimi-K2.6 tiers in favor of DeepSeek-V4/GLM-5.3) — discovery is
		// authoritative. Aggressive prices: gpt-oss-120b at $0.05/$0.20.
		models: [
			{ id: 'zai/GLM-5.3', name: 'GLM-5.3', contextLength: 1048576, inputPrice: 1.4, outputPrice: 4.4, functionCallingSupported: true },
			{ id: 'zai/GLM-5.3-Flash', name: 'GLM-5.3 Flash', contextLength: 1048576, inputPrice: 0.15, outputPrice: 0.5, visionSupported: true, functionCallingSupported: true },
			{ id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', contextLength: 131072, inputPrice: 0.05, outputPrice: 0.2, functionCallingSupported: true },
			{ id: 'deepseek-ai/DeepSeek-V4-Pro', name: 'DeepSeek V4 Pro', contextLength: 1048576, inputPrice: 1.74, outputPrice: 3.48, functionCallingSupported: true },
			{ id: 'deepseek-ai/DeepSeek-V4-Flash', name: 'DeepSeek V4 Flash', contextLength: 1048576, inputPrice: 0.14, outputPrice: 0.28, functionCallingSupported: true },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'poe',
		name: 'Poe',
		endpoint: 'https://api.poe.com/v1/chat/completions',
		authType: 'bearer',
		// Verified 2026-10-10 against the live public /v1/models (338 entries,
		// unauthenticated — contexts and per-token point pricing per model)
		// + creator.poe.com API reference. One Poe key spend-subscription
		// compute points across every frontier bot (GPT-5.4, Claude Opus
		// 4.8, Gemini 3.1 Pro, Grok 4.7, Kimi K3, …) — point-metered, so
		// seeds are priced 0 like the other plan-billed providers. Choices
		// are always length 1; unsupported fields are silently ignored, not
		// 400s; response_format/json_schema unsupported on chat completions.
		// stream_options.include_usage is in the supported list.
		models: [
			{ id: 'gpt-5.4', name: 'GPT-5.4', contextLength: 1050000, inputPrice: 0, outputPrice: 0, functionCallingSupported: true },
			{ id: 'claude-opus-4.8', name: 'Claude Opus 4.8', contextLength: 1048576, inputPrice: 0, outputPrice: 0, functionCallingSupported: true },
			{ id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro', contextLength: 1048576, inputPrice: 0, outputPrice: 0, functionCallingSupported: true },
			{ id: 'grok-4.7', name: 'Grok 4.7', contextLength: 500000, inputPrice: 0, outputPrice: 0, functionCallingSupported: true },
			{ id: 'kimi-k3', name: 'Kimi K3', contextLength: 1000000, inputPrice: 0, outputPrice: 0, functionCallingSupported: true },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'featherless',
		name: 'Featherless',
		endpoint: 'https://api.featherless.ai/v1/chat/completions',
		authType: 'bearer',
		// Verified 2026-10-10 against the live public /v1/models (22k+
		// entries with context_length and USD per-token pricing — seed rows
		// below were read off it directly) + featherless.ai/docs. Serverless
		// hosting for the long tail of open weights (plus fine-tune fleets).
		// Subscription credits, not pay-as-you-go: the Developer plan starts
		// at $50/mo prepaid; only successful requests are charged. Richest
		// documented sampling set of any built-in (top_k/min_p/
		// repetition_penalty/penalties/stop all real; seed accepted but
		// "not reliable" across their fleet). Cached-input discount applies
		// automatically from ~1k-token prefix reuse.
		models: [
			{ id: 'zai-org/GLM-5.3', name: 'GLM-5.3', contextLength: 262144, inputPrice: 1.4, outputPrice: 4.4, functionCallingSupported: true },
			{ id: 'zai-org/GLM-5.3-Flash', name: 'GLM-5.3 Flash', contextLength: 262144, inputPrice: 0.15, outputPrice: 0.5, functionCallingSupported: true },
			{ id: 'deepseek-ai/DeepSeek-V4.1-Flash', name: 'DeepSeek V4.1 Flash', contextLength: 262144, inputPrice: 0.3, outputPrice: 1.2, functionCallingSupported: true },
			{ id: 'deepseek-ai/DeepSeek-V4-Pro', name: 'DeepSeek V4 Pro', contextLength: 262144, inputPrice: 1.6, outputPrice: 3.2, functionCallingSupported: true },
			{ id: 'moonshotai/Kimi-K3', name: 'Kimi K3', contextLength: 262144, inputPrice: 3.0, outputPrice: 15.0, functionCallingSupported: true },
			{ id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', contextLength: 131072, inputPrice: 0.15, outputPrice: 0.6, functionCallingSupported: true },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'scaleway',
		name: 'Scaleway',
		endpoint: 'https://api.scaleway.ai/v1/chat/completions',
		authType: 'bearer',
		// Verified 2026-10-10 via scaleway.com/en/docs generative-apis
		// (openai-compatibility rev 2026-04-24, supported-models validated
		// 2026-08-14) + live /v1/models probe (401 challenge). Strictly
		// European hosting (GDPR angle no other built-in has). Per-token
		// prices live only in the console cost estimator — seeds stay 0 and
		// cost estimates read as unknown. Usage arrives in EVERY streaming
		// chunk (cumulative), so token metering works without
		// stream_options. frequency_penalty is explicitly unsupported.
		models: [
			{ id: 'glm-5.2', name: 'GLM-5.2', contextLength: 262144, inputPrice: 0, outputPrice: 0, functionCallingSupported: true },
			{ id: 'deepseek-v4-flash-0731', name: 'DeepSeek V4 Flash', contextLength: 262144, inputPrice: 0, outputPrice: 0, functionCallingSupported: true },
			{ id: 'qwen3.5-397b-a17b', name: 'Qwen3.5 397B', contextLength: 250000, inputPrice: 0, outputPrice: 0, visionSupported: true, functionCallingSupported: true },
			{ id: 'qwen3.8-27b', name: 'Qwen3.8 27B', contextLength: 262144, inputPrice: 0, outputPrice: 0, visionSupported: true, functionCallingSupported: true },
			{ id: 'gpt-oss-120b', name: 'GPT-OSS 120B', contextLength: 131072, inputPrice: 0, outputPrice: 0, functionCallingSupported: true },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'reka',
		name: 'Reka',
		endpoint: 'https://api.reka.ai/v1/chat/completions',
		authType: 'bearer',
		// Verified 2026-10-10 via docs.reka.ai (chat overview/models/pricing)
		// + live probe. Small first-party catalog (reka-flash-3 has no tool
		// calling — agent mode needs a partner model); /v1/models returns
		// per-model pricing and supported_sampling_parameters, discovery
		// fills the rest. Prices unpublished on the pricing page → seeds 0.
		// Prepaid credits only (no postpay).
		models: [
			{ id: 'reka-flash-3', name: 'Reka Flash 3', contextLength: 65536, inputPrice: 0, outputPrice: 0 },
			{ id: 'reka-edge-2603', name: 'Reka Edge', contextLength: 16384, inputPrice: 0, outputPrice: 0, visionSupported: true },
		],
		autoDiscoverModels: true,
	},
];

// ============================================================================
// PROVIDER REGISTRY
// ============================================================================

export class ProviderRegistry {
	private providers = new Map<string, AIProvider>();
	private configs: Record<string, ProviderConfig> = {};
	private customProviders: ProviderDefinition[] = [];
	/** Optional resolver — returns API key from keychain (preferred) or plaintext. */
	private resolveKey?: (providerId: string, config?: ProviderConfig) => string;
	/** Last known good discovery result per provider id — seeds model lists so
	 *  restarts (and offline sessions) never fall back to the stale baked-in
	 *  list while the background refresh is pending or unreachable. */
	private discoveredCache: Record<string, AIModel[]> = {};
	/** Optional sink — called after every successful discovery so the host
	 *  can persist the cache (main.ts writes it into settings, debounced). */
	private onModelsDiscovered?: (providerId: string, models: AIModel[]) => void;
	/** OAuth token store for the Sign in with ChatGPT provider. */
	private chatgptTokenStore?: ChatGPTTokenStore;

	constructor(
		configs: Record<string, ProviderConfig>,
		customProviders?: ProviderDefinition[],
		resolveKey?: (providerId: string, config?: ProviderConfig) => string,
		discoveredModels?: Record<string, AIModel[]>,
		onModelsDiscovered?: (providerId: string, models: AIModel[]) => void,
		/** OAuth token store for Sign in with ChatGPT (keychain + refresh). */
		chatgptTokenStore?: ChatGPTTokenStore
	) {
		this.configs = configs;
		this.customProviders = customProviders || [];
		this.resolveKey = resolveKey;
		this.discoveredCache = discoveredModels || {};
		this.onModelsDiscovered = onModelsDiscovered;
		this.chatgptTokenStore = chatgptTokenStore;
	}

	getProvider(id: string): AIProvider | undefined {
		return this.providers.get(id);
	}

	getActiveProvider(activeId: string): AIProvider | undefined {
		const active = this.providers.get(activeId);
		if (active) return active;

		// Fall back to first available enabled provider
		for (const [id, provider] of this.providers) {
			if (this.configs[id]?.enabled && provider.isAuthenticated()) return provider;
		}
		const first = this.providers.values().next();
		return first.done ? undefined : first.value;
	}

	getAllEnabledProviders(): { id: string; provider: AIProvider; config: ProviderConfig }[] {
		const result: { id: string; provider: AIProvider; config: ProviderConfig }[] = [];
		for (const [id, provider] of this.providers) {
			const config = this.configs[id];
			if (config?.enabled) {
				result.push({ id, provider, config });
			}
		}
		return result;
	}

	async initializeProviders(): Promise<void> {
		// Create built-in providers
		for (const def of PROVIDER_DEFINITIONS) {
			const config = this.configs[def.id];
			if (!config?.enabled && def.id !== 'anthropic') continue; // Always create Anthropic for migration compat

			try {
				const provider = this.createProviderFromDefinition(def, config);
				if (provider) {
					this.providers.set(def.id, provider);
				}
			} catch (e) {
				console.error(`[Curtis] Failed to create provider ${def.id}:`, e);
			}
		}

		// Create custom providers
		for (const def of this.customProviders) {
			const config = this.configs[def.id];
			if (!config?.enabled) continue;

			try {
				const provider = this.createProviderFromDefinition(def, config);
				if (provider) {
					this.providers.set(def.id, provider);
				}
			} catch (e) {
				console.error(`[Curtis] Failed to create custom provider ${def.id}:`, e);
			}
		}

		// Auto-discover models for every provider that asks for it (built-in
		// definitions and custom providers alike).
		for (const def of this.getAllDefinitions()) {
			if (def.autoDiscoverModels && this.providers.has(def.id)) {
				await this.discoverModels(def);
			}
		}
	}

	private createProviderFromDefinition(def: ProviderDefinition, config?: ProviderConfig): AIProvider | null {
		// Prefer keychain-resolved key over plaintext apiKey.
		const apiKey = this.resolveKey ? this.resolveKey(def.id, config) : (config?.apiKey || '');
		const endpoint = config?.customEndpoint || def.endpoint;
		// Seed with the last good discovery result when one exists — newer
		// than the baked-in list, and survives config edits that recreate the
		// provider instance. Manual extras are appended on top.
		const seedModels = applyExtraModels(this.discoveredCache[def.id] ?? def.models, config);

		if (def.authType === 'anthropic') {
			// Custom endpoints (e.g. Claude-compatible gateways) must be honored —
			// silently falling back to api.anthropic.com would leak the proxy key.
			const provider = new AnthropicProvider(apiKey, endpoint);
			provider.setModels(seedModels);
			return provider;
		}

		if (def.authType === 'oauth') {
			// Sign in with ChatGPT — credentials are short-lived OAuth tokens
			// owned by the token store, not a static API key. The provider
			// refreshes lazily via prepare(); the keychain blob seeds its
			// snapshot at construction.
			return new ChatGPTProvider(this.chatgptTokenStore ?? null, endpoint || CHATGPT_ENDPOINT, seedModels);
		}

		if (def.id === 'ollama') {
			// Ollama speaks its native /api/chat dialect so the hardware knobs
			// (options.num_ctx, keep_alive, …) actually take effect — the
			// OpenAI-compat /v1 endpoint has no passthrough for them. Normalize
			// endpoints saved against the old /v1 default to the native path.
			const provider = new OllamaProvider(normalizeOllamaEndpoint(endpoint));
			provider.setModels(seedModels);
			return provider;
		}

		// Azure requires a user-supplied deployment URL — refuse to construct
		// a provider with an empty endpoint (it would throw `Invalid URL` on
		// the first request). The user sets the URL via the settings field.
		if (!endpoint) {
			console.warn(`[Curtis] Provider ${def.id} has no endpoint — set one in settings.`);
			return null;
		}

		// All other providers use OpenAI-compatible format
		return new OpenAICompatibleProvider({
			id: def.id,
			name: def.name,
			endpoint,
			models: seedModels,
			apiKey,
			authType: def.authType,
			supportsStreamUsage: STREAM_USAGE_PROVIDER_IDS.has(def.id),
			paramCaps: getParamCaps(def.id),
		});
	}

	/**
	 * Discover available models for a provider by hitting its /models endpoint.
	 * Mutates the provider's model list in place via setModels(). Safe to call
	 * from settings UI ("Refresh models" button) — returns the discovered list.
	 *
	 * Handles three discovery shapes:
	 *   - OpenAI-compat /v1/models (most providers): { data: [{id, context_length?}] }
	 *   - Ollama /api/tags: { models: [{name, ...}] }
	 *   - Gemini /v1beta/models: { models: [{name, ...}] } (names prefixed "models/")
	 */
	async discoverModels(def: ProviderDefinition): Promise<AIModel[]> {
		const provider = this.providers.get(def.id);
		if (!provider) return [];

		const config = this.configs[def.id];
		const endpoint = config?.customEndpoint || def.endpoint;
		const apiKey = this.resolveKey ? this.resolveKey(def.id, config) : (config?.apiKey || '');

		// Derive the discovery URL from the chat endpoint.
		let modelsUrl: string;
		if (def.id === 'ollama') {
			// Ollama chat lives at /api/chat (or the legacy /v1/chat/completions
			// saved in older configs); the model catalog is at /api/tags.
			const origin = endpoint.replace(/\/(v1|api)\/.*$/, '');
			modelsUrl = origin + '/api/tags';
		} else if (def.id === 'google') {
			// Gemini: replace /openai/ path with native /v1beta/models
			modelsUrl = endpoint.replace(/\/openai\/chat\/completions.*$/, '/v1beta/models?pageSize=200');
		} else if (def.authType === 'anthropic') {
			// Claude: chat at /v1/messages, catalog at /v1/models (paginated —
			// ask for the max page or the list truncates at 20 entries).
			modelsUrl = endpoint.replace(/\/messages.*$/, '/models?limit=1000');
		} else {
			// Standard OpenAI-compat: /chat/completions → /models
			modelsUrl = endpoint.replace(/\/chat\/completions.*$/, '/models');
		}

		const headers: Record<string, string> = {};
		if (def.id === 'google' && apiKey) {
			// The native v1beta/models endpoint rejects raw API keys as Bearer
			// tokens — it only accepts x-goog-api-key / ?key=.
			headers['x-goog-api-key'] = apiKey;
		} else if (def.authType === 'oauth') {
			// Sign in with ChatGPT: the credential is the provider's live OAuth
			// access token, not a stored key. Refresh best-effort — a failed
			// refresh yields an empty catalog, never a settings-UI crash.
			const oauthProvider = this.providers.get(def.id);
			if (oauthProvider?.prepare) {
				await oauthProvider.prepare().catch(() => undefined);
			}
			const token = (oauthProvider as ChatGPTProvider | undefined)?.getAccessToken() ?? '';
			if (token) headers['Authorization'] = `Bearer ${token}`;
		} else if (apiKey && def.authType === 'bearer') {
			headers['Authorization'] = `Bearer ${apiKey}`;
		} else if (apiKey && def.authType === 'key') {
			headers['Authorization'] = `Key ${apiKey}`;
		} else if (apiKey && def.authType === 'anthropic') {
			headers['x-api-key'] = apiKey;
			headers['anthropic-version'] = '2023-06-01';
		}

		try {
			const resp = await requestUrl({
				url: modelsUrl,
				method: 'GET',
				headers,
				throw: false,
			});
			if (resp.status >= 400) {
				console.debug(`[Curtis] Discovery for ${def.id} returned ${resp.status}`);
				return [];
			}

			const data = resp.json as ModelsResponse;
			const discovered = this.parseModelsResponse(def.id, data);
			if (discovered.length === 0) return [];

			// Merge discovered models with the metadata we already have
			// (pricing, caps, vision/tool flags) from the built-in list or a
			// previous discovery.
			const existing = provider.models;
			const existingById = new Map(existing.map((m) => [m.id, m]));
			const merged: AIModel[] = [];
			const seenIds = new Set<string>();
			// Curated ids: the baked-in list plus anything the user typed in
			// manually. These are NEVER pruned on a successful listing — /models
			// is not universally authoritative (z.ai's coding-plan endpoint
			// lags its plan routing: it lists models the plan stopped serving
			// and omits the one it serves), so a listing gap must not hide an
			// id the user knows works.
			const extraModelIds = config?.extraModels ?? [];
			const curatedIds = new Set<string>([...def.models.map((m) => m.id), ...extraModelIds]);

			// First: discovered models, using known metadata if available
			for (const m of discovered) {
				if (seenIds.has(m.id)) continue;
				seenIds.add(m.id);
				merged.push(existingById.get(m.id) ?? m);
			}
			// Then: curated ids absent from the listing (baked-ins like
			// openrouter/auto, and manual extras that already have metadata).
			for (const m of existing) {
				if (seenIds.has(m.id)) continue;
				if (curatedIds.has(m.id)) {
					seenIds.add(m.id);
					merged.push(m);
				}
			}
			// Finally: manual extras with no metadata yet, as bare entries.
			for (const id of extraModelIds) {
				if (seenIds.has(id)) continue;
				seenIds.add(id);
				merged.push({ id, name: id, contextLength: 0, inputPrice: 0, outputPrice: 0 });
			}
			// Entries that came only from a previous discovery and vanished
			// from today's listing fall through here and are dropped — the
			// cache self-cleans without ever hiding a curated id. Discovery
			// failures return earlier, so an unreachable /models never prunes.

			provider.setModels?.(merged);
			this.discoveredCache[def.id] = merged;
			this.onModelsDiscovered?.(def.id, merged);
			return merged;
		} catch (e) {
			console.debug(`[Curtis] Model discovery failed for ${def.id}:`, e);
			return [];
		}
	}

	/**
	 * Parse three known /models response shapes into a unified AIModel[] list.
	 * Accepts the already-narrowed `ModelsResponse` union; each branch guards
	 * on a discriminant field so TS narrows to the right member.
	 */
	private parseModelsResponse(providerId: string, data: ModelsResponse): AIModel[] {
		// OpenAI-compat: { data: [{ id, context_length? }] }
		if ('data' in data && Array.isArray(data.data)) {
			return data.data
				.filter((m): m is { id: string; context_length?: number; context_window?: number } =>
					typeof m.id === 'string' && m.id.length > 0)
				.map((m) => ({
					id: m.id,
					name: m.id,
					contextLength: m.context_length || m.context_window || 0,
					inputPrice: 0,
					outputPrice: 0,
				}));
		}
		// Ollama: { models: [{ name, ... }] } — names often have :tag suffix
		if ('models' in data && Array.isArray(data.models) && providerId === 'ollama') {
			const ollama: OllamaModelsResponse = data;
			return (ollama.models ?? []).map((m) => ({
				id: m.name || m.model || '',
				name: m.name || m.model || '',
				contextLength: 0,
				inputPrice: 0,
				outputPrice: 0,
			}));
		}
		// Gemini: { models: [{ name: "models/gemini-...", supportedGenerationMethods }] }
		if ('models' in data && Array.isArray(data.models) && providerId === 'google') {
			const gemini: GeminiModelsResponse = data;
			return (gemini.models ?? [])
				.filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
				.map((m) => {
					const id = (m.name || '').replace(/^models\//, '');
					return {
						id,
						name: m.displayName || id,
						contextLength: m.inputTokenLimit || 0,
						inputPrice: 0,
						outputPrice: 0,
					};
				});
		}
		// Generic fallback: try data.models
		if ('models' in data && Array.isArray(data.models)) {
			const generic: GenericModelsResponse = data;
			return (generic.models ?? []).map((m) => ({
				id: m.id || m.name || '',
				name: m.name || m.id || '',
				contextLength: m.context_length || 0,
				inputPrice: 0,
				outputPrice: 0,
			}));
		}
		return [];
	}

	updateConfig(id: string, config: ProviderConfig): void {
		this.configs[id] = config;
		// Recreate the provider instance with new config
		const def = PROVIDER_DEFINITIONS.find((d) => d.id === id) || this.customProviders.find((d) => d.id === id);
		if (def && config.enabled) {
			try {
				const provider = this.createProviderFromDefinition(def, config);
				if (provider) this.providers.set(id, provider);
			} catch (e) {
				console.error(`[Curtis] Failed to update provider ${id}:`, e);
			}
		} else {
			this.providers.delete(id);
		}
	}

	addCustomProvider(def: ProviderDefinition): void {
		this.customProviders.push(def);
	}

	/** keepDiscoveredCache: the settings edit-save flow removes and re-adds
	 *  the same id — wiping the cache there would drop discovery results on
	 *  a mere rename or endpoint tweak. Actual deletion clears it. */
	removeCustomProvider(id: string, keepDiscoveredCache = false): void {
		this.customProviders = this.customProviders.filter((d) => d.id !== id);
		this.providers.delete(id);
		delete this.configs[id];
		if (!keepDiscoveredCache) delete this.discoveredCache[id];
	}

	getDefinition(id: string): ProviderDefinition | undefined {
		return PROVIDER_DEFINITIONS.find((d) => d.id === id) || this.customProviders.find((d) => d.id === id);
	}

	getAllDefinitions(): ProviderDefinition[] {
		return [...PROVIDER_DEFINITIONS, ...this.customProviders];
	}

	estimateCost(providerId: string, modelId: string, inputTokens: number, outputTokens: number): number | null {
		const provider = this.providers.get(providerId);
		if (!provider) return null;
		const pricing = provider.getModelPricing(modelId);
		if (!pricing) return null;
		return (inputTokens / 1_000_000) * pricing.inputPrice + (outputTokens / 1_000_000) * pricing.outputPrice;
	}
}

// Re-export for convenience
export { AnthropicProvider } from './anthropic';
export { OpenAICompatibleProvider } from './base';
export { OllamaProvider } from './ollama';
