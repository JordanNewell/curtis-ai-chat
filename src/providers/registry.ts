// Provider Registry — manages all AI provider instances

import { requestUrl } from 'obsidian';
import type { AIProvider, AIModel, ProviderDefinition, ProviderConfig } from '../types';
import { OpenAICompatibleProvider } from './base';
import { AnthropicProvider, getAnthropicModels } from './anthropic';

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

// ============================================================================
// BUILT-IN PROVIDER DEFINITIONS
// ============================================================================

export const PROVIDER_DEFINITIONS: ProviderDefinition[] = [
	{
		id: 'anthropic',
		name: 'Anthropic Claude',
		endpoint: 'https://api.anthropic.com/v1/messages',
		authType: 'anthropic',
		models: getAnthropicModels(),
	},
	{
		id: 'openai',
		name: 'OpenAI',
		endpoint: 'https://api.openai.com/v1/chat/completions',
		authType: 'bearer',
		// Fallback list — auto-discovered from /v1/models at runtime.
		// Verified 2026-07-19.
		models: [
			{ id: 'gpt-5.2', name: 'GPT-5.2', contextLength: 200000, inputPrice: 5.0, outputPrice: 15.0, visionSupported: true, functionCallingSupported: true },
			{ id: 'gpt-5.1', name: 'GPT-5.1', contextLength: 200000, inputPrice: 2.5, outputPrice: 10.0, visionSupported: true, functionCallingSupported: true },
			{ id: 'gpt-5', name: 'GPT-5', contextLength: 200000, inputPrice: 2.0, outputPrice: 8.0, visionSupported: true, functionCallingSupported: true },
			{ id: 'gpt-5-mini', name: 'GPT-5 Mini', contextLength: 200000, inputPrice: 0.5, outputPrice: 2.0, visionSupported: true, functionCallingSupported: true },
			{ id: 'gpt-5-nano', name: 'GPT-5 Nano', contextLength: 200000, inputPrice: 0.1, outputPrice: 0.4, visionSupported: true, functionCallingSupported: true },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'google',
		name: 'Google Gemini',
		endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
		authType: 'bearer',
		// Verified 2026-07-19.
		models: [
			{ id: 'gemini-3-pro', name: 'Gemini 3 Pro', contextLength: 1000000, inputPrice: 1.25, outputPrice: 5.0, visionSupported: true, functionCallingSupported: true },
			{ id: 'gemini-3-flash', name: 'Gemini 3 Flash', contextLength: 1000000, inputPrice: 0.075, outputPrice: 0.3, visionSupported: true, functionCallingSupported: true },
			{ id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextLength: 1000000, inputPrice: 1.25, outputPrice: 5.0, visionSupported: true, functionCallingSupported: true },
			{ id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextLength: 1000000, inputPrice: 0.075, outputPrice: 0.3, visionSupported: true, functionCallingSupported: true },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'zai-glm',
		name: 'Z.ai GLM',
		endpoint: 'https://api.z.ai/api/coding/paas/v4/chat/completions',
		authType: 'bearer',
		// Verified 2026-07-19 via GET /models on Coding Plan endpoint.
		models: [
			{ id: 'glm-5.2', name: 'GLM-5.2 (Latest)', contextLength: 128000, inputPrice: 0, outputPrice: 0 },
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
		endpoint: 'http://localhost:11434/v1/chat/completions',
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
		// Verified 2026-07-19.
		models: [
			{ id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', contextLength: 128000, inputPrice: 0.59, outputPrice: 0.79 },
			{ id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B', contextLength: 128000, inputPrice: 0.05, outputPrice: 0.08 },
			{ id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', contextLength: 128000, inputPrice: 0.59, outputPrice: 0.79 },
			{ id: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B', contextLength: 128000, inputPrice: 0.1, outputPrice: 0.1 },
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
		// Verified 2026-07-19.
		models: [
			{ id: 'mistral-large-latest', name: 'Mistral Large', contextLength: 128000, inputPrice: 2.0, outputPrice: 6.0, functionCallingSupported: true },
			{ id: 'mistral-small-latest', name: 'Mistral Small', contextLength: 128000, inputPrice: 0.4, outputPrice: 1.2 },
			{ id: 'codestral-latest', name: 'Codestral', contextLength: 32768, inputPrice: 0.3, outputPrice: 0.9 },
			{ id: 'devstral-latest', name: 'Devstral', contextLength: 32768, inputPrice: 0.4, outputPrice: 1.2 },
			{ id: 'ministral-8b-latest', name: 'Ministral 8B', contextLength: 128000, inputPrice: 0.1, outputPrice: 0.1 },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'deepseek',
		name: 'DeepSeek',
		endpoint: 'https://api.deepseek.com/v1/chat/completions',
		authType: 'bearer',
		// Verified 2026-07-19. NOTE: deepseek-chat/reasoner sunset 2026-07-24.
		models: [
			{ id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', contextLength: 65536, inputPrice: 0.27, outputPrice: 1.1, functionCallingSupported: true },
			{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', contextLength: 65536, inputPrice: 0.14, outputPrice: 0.55, functionCallingSupported: true },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'cohere',
		name: 'Cohere',
		endpoint: 'https://api.cohere.ai/compatibility/v1/chat/completions',
		authType: 'bearer',
		// Verified 2026-07-19. Endpoint is the OpenAI-compat path.
		models: [
			{ id: 'command-a-03-2025', name: 'Command A', contextLength: 256000, inputPrice: 2.5, outputPrice: 10.0 },
			{ id: 'command-r-plus-08-2024', name: 'Command R+', contextLength: 128000, inputPrice: 2.5, outputPrice: 10.0 },
			{ id: 'command-r-08-2024', name: 'Command R', contextLength: 128000, inputPrice: 0.5, outputPrice: 1.5 },
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
		id: 'xai',
		name: 'xAI Grok',
		endpoint: 'https://api.x.ai/v1/chat/completions',
		authType: 'bearer',
		models: [
			{ id: 'grok-4', name: 'Grok 4', contextLength: 256000, inputPrice: 3.0, outputPrice: 15.0, visionSupported: true, functionCallingSupported: true },
			{ id: 'grok-4-fast', name: 'Grok 4 Fast', contextLength: 256000, inputPrice: 0.2, outputPrice: 0.5, visionSupported: true, functionCallingSupported: true },
			{ id: 'grok-2-vision', name: 'Grok 2 Vision', contextLength: 32768, inputPrice: 2.0, outputPrice: 10.0, visionSupported: true },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'perplexity',
		name: 'Perplexity',
		endpoint: 'https://api.perplexity.ai/chat/completions',
		authType: 'bearer',
		models: [
			{ id: 'sonar-pro', name: 'Sonar Pro', contextLength: 200000, inputPrice: 3.0, outputPrice: 15.0, functionCallingSupported: true },
			{ id: 'sonar-reasoning-pro', name: 'Sonar Reasoning Pro', contextLength: 127000, inputPrice: 2.0, outputPrice: 8.0 },
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
		id: 'hyperbolic',
		name: 'Hyperbolic',
		endpoint: 'https://api.hyperbolic.xyz/v1/chat/completions',
		authType: 'bearer',
		models: [
			{ id: 'Qwen/Qwen2.5-72B-Instruct', name: 'Qwen 2.5 72B', contextLength: 32768, inputPrice: 0.4, outputPrice: 0.4 },
			{ id: 'meta-llama/Meta-Llama-3.1-405B-Instruct', name: 'Llama 3.1 405B', contextLength: 32768, inputPrice: 4.0, outputPrice: 4.0 },
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
		id: 'lepton',
		name: 'Lepton AI',
		endpoint: 'https://api.lepton.run/v1/chat/completions',
		authType: 'bearer',
		models: [
			{ id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3', contextLength: 64000 },
			{ id: 'meta-llama/Llama3.3-70B-Instruct', name: 'Llama 3.3 70B', contextLength: 64000 },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'lambda',
		name: 'Lambda Labs',
		endpoint: 'https://api.lambdalabs.com/v1/chat/completions',
		authType: 'bearer',
		models: [
			{ id: 'llama-3.3-70b-instruct', name: 'Llama 3.3 70B', contextLength: 128000, inputPrice: 0.39, outputPrice: 0.39 },
			{ id: 'deepseek-v3', name: 'DeepSeek V3', contextLength: 128000, inputPrice: 0.3, outputPrice: 1.1 },
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
		id: 'github-models',
		name: 'GitHub Models',
		endpoint: 'https://models.inference.ai.azure.com/chat/completions',
		authType: 'bearer',
		models: [
			{ id: 'gpt-5', name: 'GPT-5', contextLength: 200000 },
			{ id: 'mistral-large', name: 'Mistral Large', contextLength: 128000 },
		],
		autoDiscoverModels: true,
	},
	{
		id: 'fal',
		name: 'fal.ai',
		endpoint: 'https://api.fal.ai/v1/chat/completions',
		authType: 'bearer',
		models: [],
		autoDiscoverModels: true,
	},
	{
		id: 'cerebras',
		name: 'Cerebras',
		endpoint: 'https://api.cerebras.ai/v1/chat/completions',
		authType: 'bearer',
		models: [
			{ id: 'llama-3.3-70b', name: 'Llama 3.3 70B', contextLength: 128000, inputPrice: 0.85, outputPrice: 1.2 },
			{ id: 'llama3.1-8b', name: 'Llama 3.1 8B', contextLength: 128000, inputPrice: 0.1, outputPrice: 0.1 },
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

	constructor(
		configs: Record<string, ProviderConfig>,
		customProviders?: ProviderDefinition[],
		resolveKey?: (providerId: string, config?: ProviderConfig) => string
	) {
		this.configs = configs;
		this.customProviders = customProviders || [];
		this.resolveKey = resolveKey;
	}

	getProvider(id: string): AIProvider | undefined {
		return this.providers.get(id);
	}

	getActiveProvider(activeId: string): AIProvider | undefined {
		if (this.providers.has(activeId)) return this.providers.get(activeId)!;

		// Fall back to first available enabled provider
		for (const [id, provider] of this.providers) {
			if (this.configs[id]?.enabled && provider.isAuthenticated()) return provider;
		}
		return this.providers.values().next().value;
	}

	getAllProviders(): AIProvider[] {
		return Array.from(this.providers.values());
	}

	getProviderIds(): string[] {
		return Array.from(this.providers.keys());
	}

	getModelsForProvider(id: string): AIModel[] {
		const provider = this.providers.get(id);
		if (!provider) return [];
		return provider.models;
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

		// Auto-discover models for Ollama and LM Studio
		for (const def of PROVIDER_DEFINITIONS) {
			if (def.autoDiscoverModels && this.providers.has(def.id)) {
				await this.discoverModels(def);
			}
		}
	}

	private createProviderFromDefinition(def: ProviderDefinition, config?: ProviderConfig): AIProvider | null {
		// Prefer keychain-resolved key over plaintext apiKey.
		const apiKey = this.resolveKey ? this.resolveKey(def.id, config) : (config?.apiKey || '');
		const endpoint = config?.customEndpoint || def.endpoint;

		if (def.authType === 'anthropic') {
			return new AnthropicProvider(apiKey);
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
			models: def.models,
			apiKey,
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
			// Ollama uses a different path; chat at /v1/chat/completions, tags at /api/tags
			const origin = endpoint.replace(/\/v1\/.*$/, '');
			modelsUrl = origin + '/api/tags';
		} else if (def.id === 'google') {
			// Gemini: replace /openai/ path with native /v1beta/models
			modelsUrl = endpoint.replace(/\/openai\/chat\/completions.*$/, '/v1beta/models?pageSize=200');
		} else {
			// Standard OpenAI-compat: /chat/completions → /models
			modelsUrl = endpoint.replace(/\/chat\/completions.*$/, '/models');
		}

		const headers: Record<string, string> = {};
		if (apiKey && def.authType === 'bearer') headers['Authorization'] = `Bearer ${apiKey}`;
		else if (apiKey && def.authType === 'anthropic') headers['x-api-key'] = apiKey;

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

			// Merge discovered models with built-in ones (preserve pricing/caps
			// from the built-in list, append new IDs as defaults).
			const existing = provider.models;
			const existingById = new Map(existing.map((m) => [m.id, m]));
			const merged: AIModel[] = [];
			const seenIds = new Set<string>();

			// First: discovered models, using built-in metadata if available
			for (const m of discovered) {
				if (seenIds.has(m.id)) continue;
				seenIds.add(m.id);
				const builtin = existingById.get(m.id);
				merged.push(builtin ?? m);
			}
			// Then: any built-in models not in discovered (e.g. openrouter/auto)
			for (const m of existing) {
				if (!seenIds.has(m.id)) {
					seenIds.add(m.id);
					merged.push(m);
				}
			}

			provider.setModels?.(merged);
			return merged;
		} catch (e) {
			console.debug(`[Curtis] Model discovery failed for ${def.id}:`, e);
			return [];
		}
	}

	/** Parse three known /models response shapes into a unified AIModel[] list. */
	private parseModelsResponse(providerId: string, data: ModelsResponse): AIModel[] {
		// OpenAI-compat: { data: [{ id, context_length? }] }
		if ('data' in data && Array.isArray(data.data)) {
			return data.data.map((m) => ({
				id: m.id,
				name: m.id,
				contextLength: m.context_length || m.context_window || 0,
				inputPrice: 0,
				outputPrice: 0,
			}));
		}
		// Ollama: { models: [{ name, ... }] } — names often have :tag suffix
		if ('models' in data && Array.isArray(data.models) && providerId === 'ollama') {
			const ollama = data as OllamaModelsResponse;
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
			const gemini = data as GeminiModelsResponse;
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
						visionSupported: true,
					};
				});
		}
		// Generic fallback: try data.models
		if ('models' in data && Array.isArray(data.models)) {
			const generic = data as GenericModelsResponse;
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

	removeCustomProvider(id: string): void {
		this.customProviders = this.customProviders.filter((d) => d.id !== id);
		this.providers.delete(id);
		delete this.configs[id];
	}

	getCustomProviders(): ProviderDefinition[] {
		return this.customProviders;
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
