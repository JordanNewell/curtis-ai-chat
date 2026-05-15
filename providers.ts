// Multi-Provider AI Abstraction Layer with Streaming and Pricing

// Base types
export interface AIMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface AIModel {
	id: string;
	name: string;
	contextLength: number;
	provider: string;
	inputPrice?: number; // Price per million input tokens (USD)
	outputPrice?: number; // Price per million output tokens (USD)
	visionSupported?: boolean;
	functionCallingSupported?: boolean;
}

export interface AIRequestOptions {
	model: string;
	temperature: number;
	maxTokens: number;
	stream?: boolean;
}

export interface AIResponse {
	content: string;
	usage?: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
	};
	cachedTokens?: number;
	reasoning?: string;
}

export interface StreamChunk {
	delta: string;
	usage?: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
	};
	done: boolean;
}

// Streaming callback types
export type StreamCallback = (chunk: string) => void;
export type UsageCallback = (usage: { promptTokens: number; completionTokens: number; totalTokens: number }) => void;
export type ErrorCallback = (error: Error) => void;

// Base provider interface
export interface AIProvider {
	id: string;
	name: string;
	endpoint: string;
	models: AIModel[];
	supportsStreaming: boolean;
	supportsVision: boolean;
	supportsFunctions: boolean;
	formatRequest(messages: AIMessage[], options: AIRequestOptions): RequestInit;
	parseResponse(response: Response): Promise<AIResponse>;
	parseStream(response: Response, onChunk: StreamCallback, onUsage?: UsageCallback, onError?: ErrorCallback): Promise<void>;
	isAuthenticated(): boolean;
	authenticate(): Promise<void>;
	getModelPricing(modelId: string): { inputPrice: number; outputPrice: number } | null;
}

// Plugin settings interface for providers
export interface ProviderSettings {
	// Provider selection
	provider: 'claude' | 'glm' | 'gemini';

	// Claude settings
	claudeApiKey: string;
	claudeModel: string;

	// GLM settings
	glmApiKey: string;
	glmEndpoint: string;
	glmModel: string;

	// Gemini settings (OAuth only)
	geminiOAuthToken?: string;
	geminiRefreshToken?: string;
	geminiOAuthClientId?: string;
	geminiOAuthClientSecret?: string;
	geminiModel: string;

	// Shared settings
	temperature: number;
	maxTokens: number;
	systemPrompt: string;
	streamResponse: boolean;
	showTokenUsage: boolean;

	// Enhanced settings
	enableCostTracking: boolean;
	budgetLimit?: number; // Monthly budget in USD
	defaultConversationTemplate?: string;
}

// =============================================================================
// CLAUDE PROVIDER
// =============================================================================

const CLAUDE_MODELS: AIModel[] = [
	{
		id: 'claude-opus-4-6',
		name: 'Claude Opus 4.6',
		contextLength: 200000,
		provider: 'claude',
		inputPrice: 15.0,
		outputPrice: 75.0,
		visionSupported: true,
		functionCallingSupported: true
	},
	{
		id: 'claude-sonnet-4-5-20250929',
		name: 'Claude Sonnet 4.5',
		contextLength: 200000,
		provider: 'claude',
		inputPrice: 3.0,
		outputPrice: 15.0,
		visionSupported: true,
		functionCallingSupported: true
	},
	{
		id: 'claude-haiku-4-5-20251001',
		name: 'Claude Haiku 4.5',
		contextLength: 200000,
		provider: 'claude',
		inputPrice: 0.8,
		outputPrice: 4.0,
		visionSupported: true,
		functionCallingSupported: true
	},
];

export class ClaudeProvider implements AIProvider {
	id = 'claude' as const;
	name = 'Anthropic Claude';
	endpoint = 'https://api.anthropic.com/v1/messages';
	models = CLAUDE_MODELS;
	supportsStreaming = true;
	supportsVision = true;
	supportsFunctions = true;

	private apiKey: string;

	constructor(settings: ProviderSettings) {
		this.apiKey = settings.claudeApiKey;
	}

	isAuthenticated(): boolean {
		return this.apiKey.length > 0;
	}

	async authenticate(): Promise<void> {
		if (!this.isAuthenticated()) {
			throw new Error('Claude API key not set');
		}
	}

	formatRequest(messages: AIMessage[], options: AIRequestOptions): RequestInit {
		// Claude-specific: extract system message (uses separate param)
		const systemMessage = messages.find(m => m.role === 'system')?.content || '';
		const chatMessages = messages.filter(m => m.role !== 'system');

		return {
			method: 'POST',
			headers: {
				'x-api-key': this.apiKey,
				'anthropic-version': '2023-06-01',
				'content-type': 'application/json',
			},
			body: JSON.stringify({
				model: options.model,
				max_tokens: options.maxTokens,
				temperature: options.temperature,
				system: systemMessage,
				messages: chatMessages.map(m => ({
					role: m.role,
					content: m.content
				})),
				stream: options.stream || false
			})
		};
	}

	async parseResponse(response: Response): Promise<AIResponse> {
		const data = await response.json();

		// Claude response format: { content: [{ text: string }], usage: {...} }
		const content = data.content?.[0]?.text || data.content?.[0]?.type === 'text' ? data.content[0].text : '';
		const usage = data.usage ? {
			promptTokens: data.usage.input_tokens || 0,
			completionTokens: data.usage.output_tokens || 0,
			totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0)
		} : undefined;

		return { content, usage };
	}

	async parseStream(
		response: Response,
		onChunk: StreamCallback,
		onUsage?: UsageCallback,
		onError?: ErrorCallback
	): Promise<void> {
		const reader = response.body?.getReader();
		if (!reader) {
			throw new Error('No response body');
		}

		const decoder = new TextDecoder();
		let buffer = '';
		let accumulatedContent = '';

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					if (!line.trim() || !line.startsWith('data: ')) continue;

					const data = line.slice(6);
					if (data === '[DONE]') continue;

					try {
						const parsed = JSON.parse(data);
						if (parsed.type === 'content_block_delta') {
							const delta = parsed.delta?.text || '';
							if (delta) {
								accumulatedContent += delta;
								onChunk(delta);
							}
						} else if (parsed.type === 'message_stop' && onUsage) {
							// Usage is typically sent in a separate event
							onUsage({
								promptTokens: 0, // Will be updated if available
								completionTokens: accumulatedContent.length / 4, // Rough estimate
								totalTokens: 0
							});
						}
					} catch (e) {
						if (onError) onError(e as Error);
					}
				}
			}
		} finally {
			reader.releaseLock();
		}
	}

	getModelPricing(modelId: string): { inputPrice: number; outputPrice: number } | null {
		const model = this.models.find(m => m.id === modelId);
		if (!model || model.inputPrice === undefined || model.outputPrice === undefined) {
			return null;
		}
		return { inputPrice: model.inputPrice, outputPrice: model.outputPrice };
	}
}

// =============================================================================
// GLM PROVIDER
// =============================================================================

const GLM_MODELS: AIModel[] = [
	{ id: 'glm-4.7', name: 'GLM-4.7 (Latest)', contextLength: 128000, provider: 'glm', inputPrice: 0.5, outputPrice: 0.5 },
	{ id: 'glm-4-plus', name: 'GLM-4 Plus', contextLength: 128000, provider: 'glm', inputPrice: 0.4, outputPrice: 0.4 },
	{ id: 'glm-4-air', name: 'GLM-4 Air', contextLength: 128000, provider: 'glm', inputPrice: 0.3, outputPrice: 0.3 },
	{ id: 'glm-4-flash', name: 'GLM-4 Flash', contextLength: 128000, provider: 'glm', inputPrice: 0.1, outputPrice: 0.1 },
	{ id: 'glm-4-long', name: 'GLM-4 Long (1M tokens)', contextLength: 1000000, provider: 'glm', inputPrice: 0.5, outputPrice: 0.5 },
];

export class GLMProvider implements AIProvider {
	id = 'glm' as const;
	name = 'Z.ai GLM';
	endpoint: string;
	models = GLM_MODELS;
	supportsStreaming = true;
	supportsVision = true;
	supportsFunctions = true;

	private apiKey: string;

	constructor(settings: ProviderSettings) {
		this.apiKey = settings.glmApiKey;
		this.endpoint = settings.glmEndpoint || 'https://api.z.ai/api/paas/v4/chat/completions';
	}

	isAuthenticated(): boolean {
		return this.apiKey.length > 0;
	}

	async authenticate(): Promise<void> {
		if (!this.isAuthenticated()) {
			throw new Error('GLM API key not set');
		}
	}

	formatRequest(messages: AIMessage[], options: AIRequestOptions): RequestInit {
		return {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${this.apiKey}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				model: options.model,
				messages: messages,
				temperature: options.temperature,
				max_tokens: options.maxTokens,
				stream: options.stream || false
			})
		};
	}

	async parseResponse(response: Response): Promise<AIResponse> {
		const data = await response.json();

		// GLM/OpenAI format: { choices: [{ message: { content } }], usage: {...} }
		const content = data.choices?.[0]?.message?.content || '';
		const usage = data.usage ? {
			promptTokens: data.usage.prompt_tokens || 0,
			completionTokens: data.usage.completion_tokens || 0,
			totalTokens: data.usage.total_tokens || 0
		} : undefined;

		return { content, usage };
	}

	async parseStream(
		response: Response,
		onChunk: StreamCallback,
		onUsage?: UsageCallback,
		onError?: ErrorCallback
	): Promise<void> {
		const reader = response.body?.getReader();
		if (!reader) {
			throw new Error('No response body');
		}

		const decoder = new TextDecoder();
		let buffer = '';

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					if (!line.trim() || !line.startsWith('data: ')) continue;

					const data = line.slice(6);
					if (data === '[DONE]') continue;

					try {
						const parsed = JSON.parse(data);
						const delta = parsed.choices?.[0]?.delta?.content || '';
						if (delta) {
							onChunk(delta);
						}

						if (parsed.usage && onUsage) {
							onUsage({
								promptTokens: parsed.usage.prompt_tokens || 0,
								completionTokens: parsed.usage.completion_tokens || 0,
								totalTokens: parsed.usage.total_tokens || 0
							});
						}
					} catch (e) {
						if (onError) onError(e as Error);
					}
				}
			}
		} finally {
			reader.releaseLock();
		}
	}

	getModelPricing(modelId: string): { inputPrice: number; outputPrice: number } | null {
		const model = this.models.find(m => m.id === modelId);
		if (!model || model.inputPrice === undefined || model.outputPrice === undefined) {
			return null;
		}
		return { inputPrice: model.inputPrice, outputPrice: model.outputPrice };
	}
}

// =============================================================================
// GEMINI PROVIDER (OAuth only)
// =============================================================================

const GEMINI_MODELS: AIModel[] = [
	{ id: 'gemini-3-pro', name: 'Gemini 3 Pro', contextLength: 1000000, provider: 'gemini', inputPrice: 0, outputPrice: 0 },
	{ id: 'gemini-3-flash', name: 'Gemini 3 Flash', contextLength: 1000000, provider: 'gemini', inputPrice: 0, outputPrice: 0 },
	{ id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextLength: 1000000, provider: 'gemini', inputPrice: 1.25, outputPrice: 5.0 },
	{ id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextLength: 1000000, provider: 'gemini', inputPrice: 0.075, outputPrice: 0.30 },
	{ id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', contextLength: 1000000, provider: 'gemini', inputPrice: 0, outputPrice: 0 },
];

export class GeminiProvider implements AIProvider {
	id = 'gemini' as const;
	name = 'Google Gemini';
	endpoint = 'https://generativelanguage.googleapis.com/v1/openai/chat/completions';
	models = GEMINI_MODELS;
	supportsStreaming = true;
	supportsVision = true;
	supportsFunctions = true;

	private oauthToken?: string;
	private refreshToken?: string;
	private clientId?: string;
	private clientSecret?: string;
	private tokenExpiresAt?: number;

	constructor(settings: ProviderSettings) {
		this.oauthToken = settings.geminiOAuthToken;
		this.refreshToken = settings.geminiRefreshToken;
		this.clientId = settings.geminiOAuthClientId;
		this.clientSecret = settings.geminiOAuthClientSecret;
	}

	isAuthenticated(): boolean {
		return !!this.oauthToken && !this.isTokenExpired();
	}

	isTokenExpired(): boolean {
		if (!this.tokenExpiresAt) return false;
		return Date.now() >= this.tokenExpiresAt;
	}

	async authenticate(): Promise<void> {
		if (!this.oauthToken) {
			throw new Error('Gemini not authenticated. Please complete OAuth flow.');
		}

		if (this.isTokenExpired() && this.refreshToken) {
			await this.refreshAccessToken();
		}
	}

	async refreshAccessToken(): Promise<void> {
		if (!this.refreshToken || !this.clientId || !this.clientSecret) {
			throw new Error('Cannot refresh token: missing credentials');
		}

		const response = await fetch('https://oauth2.googleapis.com/token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				client_id: this.clientId,
				client_secret: this.clientSecret,
				refresh_token: this.refreshToken,
				grant_type: 'refresh_token'
			})
		});

		if (!response.ok) {
			throw new Error('Failed to refresh OAuth token');
		}

		const data = await response.json();
		this.oauthToken = data.access_token;
		this.tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
	}

	setTokens(oauthToken: string, refreshToken: string, expiresIn: number): void {
		this.oauthToken = oauthToken;
		this.refreshToken = refreshToken;
		this.tokenExpiresAt = Date.now() + expiresIn * 1000;
	}

	getCurrentToken(): string | undefined {
		return this.oauthToken;
	}

	formatRequest(messages: AIMessage[], options: AIRequestOptions): RequestInit {
		return {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.oauthToken}`
			},
			body: JSON.stringify({
				model: options.model,
				messages: messages,
				temperature: options.temperature,
				max_tokens: options.maxTokens,
				stream: options.stream || false
			})
		};
	}

	async parseResponse(response: Response): Promise<AIResponse> {
		const data = await response.json();

		// Gemini OpenAI-compatible format
		const content = data.choices?.[0]?.message?.content || '';
		const usage = data.usage ? {
			promptTokens: data.usage.prompt_tokens || 0,
			completionTokens: data.usage.completion_tokens || 0,
			totalTokens: data.usage.total_tokens || 0
		} : undefined;

		return { content, usage };
	}

	async parseStream(
		response: Response,
		onChunk: StreamCallback,
		onUsage?: UsageCallback,
		onError?: ErrorCallback
	): Promise<void> {
		const reader = response.body?.getReader();
		if (!reader) {
			throw new Error('No response body');
		}

		const decoder = new TextDecoder();
		let buffer = '';

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					if (!line.trim() || !line.startsWith('data: ')) continue;

					const data = line.slice(6);
					if (data === '[DONE]') continue;

					try {
						const parsed = JSON.parse(data);
						const delta = parsed.choices?.[0]?.delta?.content || '';
						if (delta) {
							onChunk(delta);
						}

						if (parsed.usage && onUsage) {
							onUsage({
								promptTokens: parsed.usage.prompt_tokens || 0,
								completionTokens: parsed.usage.completion_tokens || 0,
								totalTokens: parsed.usage.total_tokens || 0
							});
						}
					} catch (e) {
						if (onError) onError(e as Error);
					}
				}
			}
		} finally {
			reader.releaseLock();
		}
	}

	getModelPricing(modelId: string): { inputPrice: number; outputPrice: number } | null {
		const model = this.models.find(m => m.id === modelId);
		if (!model || model.inputPrice === undefined || model.outputPrice === undefined) {
			return null;
		}
		return { inputPrice: model.inputPrice, outputPrice: model.outputPrice };
	}
}

// =============================================================================
// PROVIDER FACTORY
// =============================================================================

export function createProvider(providerId: string, settings: ProviderSettings): AIProvider {
	switch (providerId) {
		case 'claude':
			return new ClaudeProvider(settings);
		case 'glm':
			return new GLMProvider(settings);
		case 'gemini':
			return new GeminiProvider(settings);
		default:
			throw new Error(`Unknown provider: ${providerId}`);
	}
}

export function getAllModels(): AIModel[] {
	return [...CLAUDE_MODELS, ...GLM_MODELS, ...GEMINI_MODELS];
}

export function getModelsForProvider(providerId: string): AIModel[] {
	switch (providerId) {
		case 'claude':
			return CLAUDE_MODELS;
		case 'glm':
			return GLM_MODELS;
		case 'gemini':
			return GEMINI_MODELS;
		default:
			return [];
	}
}

export function estimateCost(provider: AIProvider, modelId: string, inputTokens: number, outputTokens: number): number | null {
	const pricing = provider.getModelPricing(modelId);
	if (!pricing) return null;

	const inputCost = (inputTokens / 1_000_000) * pricing.inputPrice;
	const outputCost = (outputTokens / 1_000_000) * pricing.outputPrice;
	return inputCost + outputCost;
}
