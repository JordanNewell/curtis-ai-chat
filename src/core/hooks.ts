// ============================================================================
// Hook System — Interceptors that can modify data
// ============================================================================
//
// Unlike events (fire-and-forget notifications), hooks allow interception
// and modification of data at defined points in the pipeline.
//
// Built-in hooks (runPipeline call sites in main.ts):
//   messages:before-send — Modify messages before sending to AI
//   provider:request     — Modify HTTP request before sending
// ============================================================================

type HookHandler<T = unknown, R = unknown> = (data: T, context: HookContext) => R | Promise<R>;

export interface HookContext {
	readonly hookName: string;
	readonly provider?: string;
	readonly model?: string;
	readonly conversationId?: string;
	metadata: Record<string, unknown>;
}

interface HookAIMessage {
	role: string;
	content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

// Hook registry — typed by hook name
export interface HookDefinitions {
	'messages:before-send': HookAIMessage[];
	'provider:request': RequestInit;
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
			hookName: hook,
			metadata: {},
			...context,
		};

		let result = data;
		for (const { handler } of handlers) {
			try {
				const next = await handler(result, ctx);
				// A void-returning handler passes data through — only an explicit
				// return value replaces it. Nullifying on undefined would crash
				// main.ts, which feeds the result straight into
				// provider.formatRequest.
				if (next !== undefined) result = next as HookDefinitions[K];
			} catch (err) {
				console.error(`[Curtis] Hook error in "${hook}":`, err);
				// Continue pipeline even if one hook fails
			}
		}

		return result;
	}
}
