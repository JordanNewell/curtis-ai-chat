// Conversation Store — persistent conversation management

import { App } from 'obsidian';
import type { Conversation, ConversationMessage, ConversationStats } from '../types';

const STORAGE_KEY = 'ai-conversations';

export class ConversationStore {
	private app: App;
	private conversations = new Map<string, Conversation>();
	private currentConversationId: string | null = null;

	constructor(app: App) {
		this.app = app;
	}

	load(): void {
		try {
			const raw: unknown = this.app.loadLocalStorage(STORAGE_KEY);
			if (!raw) return;
			const entries = (typeof raw === 'string' ? JSON.parse(raw) : raw) as [string, Conversation][];
			this.conversations = new Map(entries);
		} catch (e) {
			console.error('[Curtis] Failed to load conversations:', e);
			this.conversations = new Map();
		}
	}

	save(): void {
		try {
			const entries = Array.from(this.conversations.entries());
			this.app.saveLocalStorage(STORAGE_KEY, entries);
		} catch (e) {
			console.error('[Curtis] Failed to save conversations:', e);
		}
	}

	createConversation(provider: string, model: string): Conversation {
		const id = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
		const now = Date.now();
		const conv: Conversation = {
			id,
			title: 'New chat',
			messages: [],
			branches: [],
			createdAt: now,
			updatedAt: now,
			provider,
			model,
		};
		this.conversations.set(id, conv);
		this.currentConversationId = id;
		this.save();
		return conv;
	}

	getCurrentConversation(): Conversation | undefined {
		if (!this.currentConversationId) return undefined;
		return this.conversations.get(this.currentConversationId);
	}

	getConversation(id: string): Conversation | undefined {
		return this.conversations.get(id);
	}

	setCurrentConversation(id: string): void {
		if (this.conversations.has(id)) {
			this.currentConversationId = id;
		}
	}

	getCurrentConversationId(): string | null {
		return this.currentConversationId;
	}

	addMessage(message: Omit<ConversationMessage, 'id' | 'timestamp'>): ConversationMessage {
		const conv = this.getCurrentConversation();
		if (!conv) throw new Error('No active conversation');

		const fullMessage: ConversationMessage = {
			...message,
			id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
			timestamp: Date.now(),
		};

		conv.messages.push(fullMessage);
		conv.updatedAt = Date.now();

		// Auto-title from first user message
		if (conv.title === 'New chat' && message.role === 'user') {
			conv.title = (typeof message.content === 'string' ? message.content : '').slice(0, 50);
		}

		this.save();
		return fullMessage;
	}

	getAllConversations(): Conversation[] {
		return Array.from(this.conversations.values()).sort((a, b) => b.updatedAt - a.updatedAt);
	}

	searchConversations(query: string): Conversation[] {
		const q = query.toLowerCase();
		return this.getAllConversations().filter(
			(c) =>
				c.title.toLowerCase().includes(q) ||
				c.messages.some((m) => typeof m.content === 'string' && m.content.toLowerCase().includes(q)) ||
				c.tags?.some((t) => t.toLowerCase().includes(q))
		);
	}

	updateConversation(id: string, updates: Partial<Conversation>): void {
		const conv = this.conversations.get(id);
		if (!conv) return;
		Object.assign(conv, updates, { updatedAt: Date.now() });
		this.save();
	}

	deleteConversation(id: string): void {
		this.conversations.delete(id);
		if (this.currentConversationId === id) {
			this.currentConversationId = null;
		}
		this.save();
	}

	addTag(id: string, tag: string): void {
		const conv = this.conversations.get(id);
		if (!conv) return;
		if (!conv.tags) conv.tags = [];
		if (!conv.tags.includes(tag)) {
			conv.tags.push(tag);
			this.save();
		}
	}

	removeTag(id: string, tag: string): void {
		const conv = this.conversations.get(id);
		if (!conv?.tags) return;
		conv.tags = conv.tags.filter((t) => t !== tag);
		this.save();
	}

	toggleStarred(id: string): void {
		const conv = this.conversations.get(id);
		if (!conv) return;
		conv.starred = !conv.starred;
		this.save();
	}

	getStats(): ConversationStats {
		let totalMessages = 0;
		let totalTokens = 0;
		let totalCost = 0;
		const providerBreakdown: Record<string, { tokens: number; cost: number }> = {};
		const modelBreakdown: Record<string, { tokens: number; cost: number; count: number }> = {};

		for (const conv of this.conversations.values()) {
			for (const msg of conv.messages) {
				totalMessages++;
				if (msg.tokens) {
					totalTokens += msg.tokens.totalTokens;
					const provider = msg.provider || 'unknown';
					const model = msg.model || 'unknown';

					if (!providerBreakdown[provider]) providerBreakdown[provider] = { tokens: 0, cost: 0 };
					providerBreakdown[provider].tokens += msg.tokens.totalTokens;

					if (!modelBreakdown[model]) modelBreakdown[model] = { tokens: 0, cost: 0, count: 0 };
					modelBreakdown[model].tokens += msg.tokens.totalTokens;
					modelBreakdown[model].count++;
				}
				if (msg.cost) totalCost += msg.cost;
			}
		}

		return {
			totalConversations: this.conversations.size,
			totalMessages,
			totalTokens,
			totalCost,
			providerBreakdown,
			modelBreakdown,
		};
	}

	/** Last user message in the current conversation, or undefined. */
	getLastUserMessage(): ConversationMessage | undefined {
		const conv = this.getCurrentConversation();
		if (!conv) return undefined;
		for (let i = conv.messages.length - 1; i >= 0; i--) {
			if (conv.messages[i].role === 'user') return conv.messages[i];
		}
		return undefined;
	}

	/** Last assistant message in the current conversation, or undefined. */
	getLastAssistantMessage(): ConversationMessage | undefined {
		const conv = this.getCurrentConversation();
		if (!conv) return undefined;
		for (let i = conv.messages.length - 1; i >= 0; i--) {
			if (conv.messages[i].role === 'assistant') return conv.messages[i];
		}
		return undefined;
	}

	/** Remove and return a message by id from the current conversation. */
	deleteMessage(messageId: string): boolean {
		const conv = this.getCurrentConversation();
		if (!conv) return false;
		const idx = conv.messages.findIndex((m) => m.id === messageId);
		if (idx === -1) return false;
		conv.messages.splice(idx, 1);
		conv.updatedAt = Date.now();
		this.save();
		return true;
	}

	/**
	 * Drop every message AFTER the one with `messageId` (the matched message
	 * stays). Used by regenerate (truncate after the user msg) and edit-resend
	 * (truncate after the edited user msg before re-streaming).
	 * Returns the number of messages removed.
	 */
	truncateAfterMessage(messageId: string): number {
		const conv = this.getCurrentConversation();
		if (!conv) return 0;
		const idx = conv.messages.findIndex((m) => m.id === messageId);
		if (idx === -1) return 0;
		const removed = conv.messages.length - (idx + 1);
		if (removed <= 0) return 0;
		conv.messages = conv.messages.slice(0, idx + 1);
		conv.updatedAt = Date.now();
		this.save();
		return removed;
	}

	/** Update a message in place (by id) in the current conversation. */
	updateMessage(messageId: string, updates: Partial<ConversationMessage>): boolean {
		const conv = this.getCurrentConversation();
		if (!conv) return false;
		const msg = conv.messages.find((m) => m.id === messageId);
		if (!msg) return false;
		Object.assign(msg, updates);
		conv.updatedAt = Date.now();
		this.save();
		return true;
	}

	/** Rename the current conversation. */
	renameCurrentConversation(title: string): void {
		const conv = this.getCurrentConversation();
		if (!conv) return;
		conv.title = title;
		conv.updatedAt = Date.now();
		this.save();
	}

	exportConversation(id: string): string {
		const conv = this.conversations.get(id);
		if (!conv) return '';

		const lines: string[] = [`# ${conv.title}`, '', `*Created: ${new Date(conv.createdAt).toLocaleString()}*`, ''];
		for (const msg of conv.messages) {
			const role = msg.role === 'user' ? '**You**' : '**AI**';
			const time = new Date(msg.timestamp).toLocaleTimeString();
			lines.push(`### ${role} (${time})`, '', msg.content, '');
		}
		return lines.join('\n');
	}
}
