// Conversation History Management with Export/Import

export interface ConversationMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
	timestamp: number;
	cost?: number;
	tokens?: {
		prompt: number;
		completion: number;
		total: number;
	};
	provider?: string;
	model?: string;
}

export interface Conversation {
	id: string;
	title: string;
	messages: ConversationMessage[];
	createdAt: number;
	updatedAt: number;
	provider: string;
	model: string;
	tags?: string[];
	starred?: boolean;
}

export interface ConversationStats {
	totalConversations: number;
	totalMessages: number;
	totalTokens: number;
	totalCost: number;
	providerBreakdown: Record<string, { tokens: number; cost: number }>;
	modelBreakdown: Record<string, { tokens: number; cost: number; count: number }>;
}

export class ConversationManager {
	private conversations: Map<string, Conversation> = new Map();
	private currentConversationId?: string;
	private storageKey = 'ai-conversations';

	constructor(private vaultPath: string) {
		this.loadFromStorage();
	}

	createConversation(provider: string, model: string): Conversation {
		const id = this.generateId();
		const conversation: Conversation = {
			id,
			title: 'New Conversation',
			messages: [],
			createdAt: Date.now(),
			updatedAt: Date.now(),
			provider,
			model,
			tags: [],
			starred: false
		};

		this.conversations.set(id, conversation);
		this.currentConversationId = id;
		this.saveToStorage();
		return conversation;
	}

	addMessage(message: Omit<ConversationMessage, 'timestamp'>): void {
		const conversation = this.getCurrentConversation();
		if (!conversation) return;

		const fullMessage: ConversationMessage = {
			...message,
			timestamp: Date.now()
		};

		conversation.messages.push(fullMessage);
		conversation.updatedAt = Date.now();

		// Auto-generate title from first user message
		if (conversation.messages.length === 1 && message.role === 'user') {
			conversation.title = this.generateTitle(message.content);
		}

		this.saveToStorage();
	}

	getCurrentConversation(): Conversation | undefined {
		if (!this.currentConversationId) return undefined;
		return this.conversations.get(this.currentConversationId);
	}

	getConversation(id: string): Conversation | undefined {
		return this.conversations.get(id);
	}

	getAllConversations(): Conversation[] {
		return Array.from(this.conversations.values())
			.sort((a, b) => b.updatedAt - a.updatedAt);
	}

	searchConversations(query: string): Conversation[] {
		const lowerQuery = query.toLowerCase();
		return this.getAllConversations().filter(conv =>
			conv.title.toLowerCase().includes(lowerQuery) ||
			conv.messages.some(msg => msg.content.toLowerCase().includes(lowerQuery)) ||
			conv.tags?.some(tag => tag.toLowerCase().includes(lowerQuery))
		);
	}

	getConversationsByTag(tag: string): Conversation[] {
		return this.getAllConversations().filter(conv =>
			conv.tags?.includes(tag)
		);
	}

	getStarredConversations(): Conversation[] {
		return this.getAllConversations().filter(conv => conv.starred);
	}

	updateConversation(id: string, updates: Partial<Conversation>): void {
		const conversation = this.conversations.get(id);
		if (!conversation) return;

		Object.assign(conversation, updates, { updatedAt: Date.now() });
		this.saveToStorage();
	}

	deleteConversation(id: string): void {
		this.conversations.delete(id);
		if (this.currentConversationId === id) {
			this.currentConversationId = undefined;
		}
		this.saveToStorage();
	}

	setCurrentConversation(id: string): void {
		if (this.conversations.has(id)) {
			this.currentConversationId = id;
		}
	}

	addTag(id: string, tag: string): void {
		const conversation = this.conversations.get(id);
		if (!conversation) return;

		if (!conversation.tags) {
			conversation.tags = [];
		}
		if (!conversation.tags.includes(tag)) {
			conversation.tags.push(tag);
			this.saveToStorage();
		}
	}

	removeTag(id: string, tag: string): void {
		const conversation = this.conversations.get(id);
		if (!conversation || !conversation.tags) return;

		conversation.tags = conversation.tags.filter(t => t !== tag);
		this.saveToStorage();
	}

	toggleStarred(id: string): void {
		const conversation = this.conversations.get(id);
		if (!conversation) return;

		conversation.starred = !conversation.starred;
		this.saveToStorage();
	}

	getStats(): ConversationStats {
		const stats: ConversationStats = {
			totalConversations: this.conversations.size,
			totalMessages: 0,
			totalTokens: 0,
			totalCost: 0,
			providerBreakdown: {},
			modelBreakdown: {}
		};

		for (const conv of this.conversations.values()) {
			stats.totalMessages += conv.messages.length;

			for (const msg of conv.messages) {
				if (msg.tokens) {
					stats.totalTokens += msg.tokens.total;

					// Provider breakdown
					if (!stats.providerBreakdown[msg.provider || 'unknown']) {
						stats.providerBreakdown[msg.provider || 'unknown'] = { tokens: 0, cost: 0 };
					}
					stats.providerBreakdown[msg.provider || 'unknown'].tokens += msg.tokens.total;

					// Model breakdown
					const modelKey = msg.model || 'unknown';
					if (!stats.modelBreakdown[modelKey]) {
						stats.modelBreakdown[modelKey] = { tokens: 0, cost: 0, count: 0 };
					}
					stats.modelBreakdown[modelKey].tokens += msg.tokens.total;
					stats.modelBreakdown[modelKey].count++;
				}

				if (msg.cost) {
					stats.totalCost += msg.cost;

					if (msg.provider && stats.providerBreakdown[msg.provider]) {
						stats.providerBreakdown[msg.provider].cost += msg.cost;
					}

					if (msg.model && stats.modelBreakdown[msg.model]) {
						stats.modelBreakdown[msg.model].cost += msg.cost;
					}
				}
			}
		}

		return stats;
	}

	async exportToFile(conversationId: string): Promise<string> {
		const conversation = this.conversations.get(conversationId);
		if (!conversation) throw new Error('Conversation not found');

		let markdown = `# ${conversation.title}\n\n`;
		markdown += `**Provider:** ${conversation.provider} | **Model:** ${conversation.model}\n`;
		markdown += `**Created:** ${new Date(conversation.createdAt).toLocaleString()}\n`;
		markdown += `**Messages:** ${conversation.messages.length}\n\n`;
		markdown += `---\n\n`;

		for (const msg of conversation.messages) {
			const emoji = msg.role === 'user' ? '👤' : msg.role === 'system' ? '📋' : '🤖';
			markdown += `## ${emoji} ${msg.role.charAt(0).toUpperCase() + msg.role.slice(1)}\n\n`;
			markdown += `${msg.content}\n\n`;

			if (msg.tokens) {
				markdown += `*Tokens: ${msg.tokens.total} (${msg.tokens.prompt} prompt + ${msg.tokens.completion} completion)*\n\n`;
			}
		}

		return markdown;
	}

	async exportAllToJson(): Promise<string> {
		const data = {
			version: 1,
			exportedAt: new Date().toISOString(),
			conversations: Array.from(this.conversations.values())
		};
		return JSON.stringify(data, null, 2);
	}

	async importFromJson(jsonString: string): Promise<void> {
		try {
			const data = JSON.parse(jsonString);

			if (data.version === 1 && Array.isArray(data.conversations)) {
				for (const conv of data.conversations) {
					this.conversations.set(conv.id, conv);
				}
				this.saveToStorage();
			} else {
				throw new Error('Invalid import format');
			}
		} catch (e) {
			throw new Error(`Failed to import: ${(e as Error).message}`);
		}
	}

	clearAll(): void {
		this.conversations.clear();
		this.currentConversationId = undefined;
		this.saveToStorage();
	}

	private generateId(): string {
		return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	}

	private generateTitle(content: string): string {
		// Take first 50 chars, clean it up
		let title = content.replace(/\n/g, ' ').trim();
		if (title.length > 50) {
			title = title.substring(0, 47) + '...';
		}
		return title;
	}

	private saveToStorage(): void {
		// This will be called from main plugin to save to plugin data
		const data = Array.from(this.conversations.entries());
		localStorage.setItem(this.storageKey, JSON.stringify(data));
	}

	private loadFromStorage(): void {
		const stored = localStorage.getItem(this.storageKey);
		if (stored) {
			try {
				const data = JSON.parse(stored);
				this.conversations = new Map(data);
			} catch (e) {
				console.error('Failed to load conversations:', e);
			}
		}
	}

	getAllTags(): string[] {
		const tags = new Set<string>();
		for (const conv of this.conversations.values()) {
			if (conv.tags) {
				conv.tags.forEach(tag => tags.add(tag));
			}
		}
		return Array.from(tags).sort();
	}
}
