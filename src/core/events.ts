// ============================================================================
// Type-Safe Event Bus
// ============================================================================
//
// Usage:
//   emitter.on('provider:response', (data) => { ... });
//   emitter.emit('provider:response', { content: '...', tokens: 100 });
//   emitter.off('provider:response', handler);
//
// Built-in events (extend as needed):
//   provider:response     — AI response completed
//   provider:chunk         — streaming chunk received
//   provider:error         — API error occurred
//   provider:switch        — user switched provider/model
//   chat:message:sent     — user sent a message
//   chat:message:received — assistant message completed
//   chat:conversation:new — new conversation started
//   chat:conversation:load — conversation loaded
//   chat:conversation:delete — conversation deleted
//   vault:file:indexed    — file was indexed
//   vault:file:removed     — file was removed from index
//   memory:fact:stored    — memory fact was saved
//   memory:fact:recalled  — memory facts were recalled
//   settings:changed      — any setting was modified
//   settings:migrated     — settings were migrated to new version
//   rag:indexed           — RAG indexing completed
//   rag:query             — RAG query executed
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
	'provider:error': { error: Error; provider: string };
	'provider:switch': { provider: string; model: string; previousProvider?: string; previousModel?: string };
	'chat:message:sent': { conversationId: string; messageId: string; content: string };
	'chat:message:received': { conversationId: string; messageId: string; content: string; tokens?: TokenUsagePayload };
	'chat:conversation:new': { conversationId: string; provider: string; model: string };
	'chat:conversation:load': { conversationId: string };
	'chat:conversation:delete': { conversationId: string };
	'chat:abort': { conversationId: string };
	'vault:file:indexed': { path: string };
	'vault:file:removed': { path: string };
	'memory:fact:stored': { factId: string; content: string };
	'memory:fact:recalled': { facts: string[] };
	'settings:changed': { key: string; value: unknown };
	'settings:migrated': { from: number; to: number };
	'rag:indexed': { fileCount: number; chunkCount: number };
	'rag:query': { query: string; resultCount: number };
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

	once<K extends keyof EventBusEvents>(event: K, handler: EventHandler<EventBusEvents[K]>): () => void {
		const wrapper: EventHandler<EventBusEvents[K]> = (data) => {
			handler(data);
			this.off(event, wrapper);
		};
		return this.on(event, wrapper);
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

	// Wildcard listener for debugging/plugin API
	onAny(handler: (event: string, data: unknown) => void): () => void {
		// Store in a special key
		const key = '*';
		if (!this.handlers.has(key)) {
			this.handlers.set(key, new Set());
		}
		this.handlers.get(key)!.add(handler as EventHandler);
		return () => this.handlers.get(key)?.delete(handler as EventHandler);
	}

 removeAllListeners(event?: string): void {
		if (event) {
			this.handlers.delete(event);
		} else {
			this.handlers.clear();
		}
	}

	listenerCount(event: string): number {
		return this.handlers.get(event)?.size || 0;
	}
}
