// ============================================================================
// Type-Safe Event Bus
// ============================================================================
//
// Usage:
//   emitter.on('provider:response', (data) => { ... });
//   emitter.emit('provider:response', { usage, provider, model });
//   emitter.off('provider:response', handler);
//
// Emitted events (extend the map when a new emitter lands):
//   provider:response — AI response completed (usage reported here)
//   provider:chunk    — streaming chunk received
// ============================================================================

type EventHandler<T = unknown> = (data: T) => void;

export interface TokenUsagePayload {
	promptTokens?: number;
	completionTokens?: number;
	totalTokens: number;
}

export interface EventBusEvents {
	'provider:response': { content?: string; usage?: TokenUsagePayload; provider: string; model: string };
	'provider:chunk': { delta: string; provider: string };
}

export class EventBus {
	private handlers: Map<string, Set<EventHandler>> = new Map();

	on<K extends keyof EventBusEvents>(event: K, handler: EventHandler<EventBusEvents[K]>): () => void {
		if (!this.handlers.has(event)) {
			this.handlers.set(event, new Set());
		}
		this.handlers.get(event)!.add(handler);

		// Return unsubscribe function
		return () => this.off(event, handler);
	}

	off<K extends keyof EventBusEvents>(event: K, handler: EventHandler<EventBusEvents[K]>): void {
		this.handlers.get(event)?.delete(handler);
	}

	emit<K extends keyof EventBusEvents>(event: K, data: EventBusEvents[K]): void {
		const handlers = this.handlers.get(event);
		if (!handlers) return;
		for (const handler of handlers) {
			try {
				handler(data);
			} catch (err) {
				console.error(`[Curtis] Event handler error for "${event}":`, err);
			}
		}
	}
}
