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
//   provider:response    — AI response completed (usage reported here)
//   provider:chunk       — streaming chunk received
//   conversation:changed — a conversation was mutated (message added/updated/
//                          deleted, renamed, or the whole conversation removed);
//                          lets every open chat pane stay in sync with the
//                          conversation it is bound to
// ============================================================================

type EventHandler<T = unknown> = (data: T) => void;

export interface TokenUsagePayload {
	promptTokens?: number;
	completionTokens?: number;
	totalTokens: number;
}

/** What happened to a conversation. 'messages' = message list changed,
 *  'meta' = title/creation changed, 'delete' = the conversation is gone. */
export type ConversationChangeKind = 'messages' | 'meta' | 'delete';

export interface ConversationChangedPayload {
	id: string;
	kind: ConversationChangeKind;
}

export interface EventBusEvents {
	'provider:response': { content?: string; usage?: TokenUsagePayload; provider: string; model: string };
	'provider:chunk': { delta: string; provider: string };
	'conversation:changed': ConversationChangedPayload;
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
