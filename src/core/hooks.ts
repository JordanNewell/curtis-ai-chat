// ============================================================================
// Hook System — Interceptors that can modify data
// ============================================================================
//
// Unlike events (fire-and-forget notifications), hooks allow interception
// and modification of data at defined points in the pipeline.
//
// Built-in hooks:
//   messages:before-send  — Modify messages before sending to AI
//   response:after-receive — Modify AI response before display
//   system-prompt:build   — Modify system prompt before use
//   context:build        — Add/modify vault context injected into messages
//   provider:request      — Modify HTTP request before sending
//   provider:response     — Modify HTTP response before parsing
//   chat:render-message  — Modify message DOM before it's inserted
//   settings:validate     — Validate/modify settings before save
// ============================================================================

type HookHandler<T = any, R = any> = (data: T, context: HookContext) => R | Promise<R>;

export interface HookContext {
	readonly hookName: string;
	readonly provider?: string;
	readonly model?: string;
	readonly conversationId?: string;
	metadata: Record<string, any>;
}

// Hook registry — typed by hook name
export interface HookDefinitions {
	'messages:before-send': AIMessage[];
	'response:after-receive': string;
	'system-prompt:build': string;
	'context:build': Array<{ role: string; content: string }>;
	'provider:request': RequestInit;
	'provider:response': Response;
	'chat:render-message': HTMLElement;
	'settings:validate': Record<string, any>;
}

interface AIMessage {
	role: string;
	content: any;
}

export class HookSystem {
	private hooks: Map<string, Array<{ priority: number; handler: HookHandler }>> = new Map();

	/**
	 * Register a hook handler. Lower priority runs first.
	 * Returns unsubscribe function.
	 */
	register<K extends keyof HookDefinitions>(
		hook: K,
		handler: HookHandler<HookDefinitions[K], HookDefinitions[K]>,
		priority: number = 50
	): () => void {
		if (!this.hooks.has(hook)) {
			this.hooks.set(hook, []);
		}

		const entry = { priority, handler };
		const handlers = this.hooks.get(hook)!;
		handlers.push(entry);

		// Keep sorted by priority
		handlers.sort((a, b) => a.priority - b.priority);

		return () => {
			const idx = handlers.indexOf(entry);
			if (idx !== -1) handlers.splice(idx, 1);
		};
	}

	/**
	 * Run data through all registered hooks for a given hook name.
	 * Each hook receives the output of the previous one (pipeline).
	 */
	async runPipeline<K extends keyof HookDefinitions>(
		hook: K,
		data: HookDefinitions[K],
		context: Partial<HookContext>
	): Promise<HookDefinitions[K]> {
		const handlers = this.hooks.get(hook);
		if (!handlers || handlers.length === 0) return data;

		const ctx: HookContext = {
			hookName: hook as string,
			metadata: {},
			...context,
		};

		let result = data;
		for (const { handler } of handlers) {
			try {
				result = (await handler(result, ctx)) as HookDefinitions[K];
			} catch (err) {
				console.error(`[Curtis] Hook error in "${hook}":`, err);
				// Continue pipeline even if one hook fails
			}
		}

		return result;
	}

	hasHook(hook: string): boolean {
		return (this.hooks.get(hook)?.length || 0) > 0;
	}

	getHookCount(hook: string): number {
		return this.hooks.get(hook)?.length || 0;
	}
}
