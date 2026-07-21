// OpenAI-Compatible Provider Base — covers 80%+ of all AI providers

import type {
	AIProvider,
	AIMessage,
	AIModel,
	AIRequestOptions,
	AIResponse,
	StreamCallback,
	UsageCallback,
	ErrorCallback,
	AuthType,
	StreamResponse,
} from '../types';

export abstract class BaseProvider implements AIProvider {
	abstract readonly id: string;
	abstract readonly name: string;
	abstract readonly endpoint: string;
	abstract models: AIModel[];  // mutable so discoverModels can update in place
	abstract readonly authType: AuthType;

	readonly supportsStreaming = true;
	readonly supportsVision = true;

	protected abstract getAuthHeaders(): Record<string, string>;

	formatRequest(messages: AIMessage[], options: AIRequestOptions): RequestInit {
		return {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...this.getAuthHeaders(),
			},
			body: JSON.stringify({
				model: options.model,
				messages,
				temperature: options.temperature,
				max_tokens: options.maxTokens,
				stream: options.stream ?? false,
			}),
		};
	}

	async parseResponse(response: StreamResponse): Promise<AIResponse> {
		const data = await response.json();
		const content = data.choices?.[0]?.message?.content || '';
		const usage = data.usage
			? {
					promptTokens: data.usage.prompt_tokens || 0,
					completionTokens: data.usage.completion_tokens || 0,
					totalTokens: data.usage.total_tokens || 0,
				}
			: undefined;
		return { content, usage };
	}

	async parseStream(
		response: StreamResponse,
		onChunk: StreamCallback,
		onUsage?: UsageCallback,
		onError?: ErrorCallback
	): Promise<void> {
		const reader = response.body?.getReader();
		if (!reader) throw new Error('No response body');

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
						if (delta) onChunk(delta);

						if (parsed.usage && onUsage) {
							onUsage({
								promptTokens: parsed.usage.prompt_tokens || 0,
								completionTokens: parsed.usage.completion_tokens || 0,
								totalTokens: parsed.usage.total_tokens || 0,
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

	abstract isAuthenticated(): boolean;
	abstract getModelPricing(modelId: string): { inputPrice: number; outputPrice: number } | null;
}

// Concrete OpenAI-compatible provider — instantiate for any OpenAI-format API
export class OpenAICompatibleProvider extends BaseProvider {
	readonly id: string;
	readonly name: string;
	readonly endpoint: string;
	models: AIModel[];  // mutable so discoverModels can update in place
	readonly authType: AuthType = 'bearer';

	private apiKey: string;

	constructor(config: {
		id: string;
		name: string;
		endpoint: string;
		models: AIModel[];
		apiKey: string;
	}) {
		super();
		this.id = config.id;
		this.name = config.name;
		this.endpoint = config.endpoint;
		this.models = config.models;
		this.apiKey = config.apiKey;
	}

	/** Replace this provider's model list (used by auto-discovery). */
	setModels(models: AIModel[]): void {
		this.models = models;
	}

	getAuthHeaders(): Record<string, string> {
		if (!this.apiKey) return {};
		return { Authorization: `Bearer ${this.apiKey}` };
	}

	isAuthenticated(): boolean {
		return this.apiKey.length > 0;
	}

	getModelPricing(modelId: string): { inputPrice: number; outputPrice: number } | null {
		const model = this.models.find((m) => m.id === modelId);
		if (!model || model.inputPrice === undefined || model.outputPrice === undefined) return null;
		return { inputPrice: model.inputPrice, outputPrice: model.outputPrice };
	}
}
