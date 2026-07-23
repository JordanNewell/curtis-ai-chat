// Chat Search Modal — fuzzy-search across ALL conversations (titles + message
// contents). Opens via the header search button or the Ctrl+Shift+F command.
//
// Uses FuzzySuggestModal's built-in fuzzy matching: each item is a
// (conversation, message) pair, getItemText returns the combined
// "title — snippet" string, and Obsidian fuzzy-matches against that.
// No need to bind to the input field ourselves.

import { App, FuzzySuggestModal } from 'obsidian';
import type CurtisPlugin from '../../main';
import type { Conversation, ConversationMessage } from '../../types';

export interface ChatSearchResult {
	conversation: Conversation;
	message: ConversationMessage;
	snippet: string;
}

/** First ~80 chars of the content, with ellipsis if truncated. */
function snippetOf(content: string): string {
	if (!content) return '';
	if (content.length <= 80) return content;
	return content.slice(0, 80) + '...';
}

/** Cap on the number of result items passed to FuzzySuggestModal. Keeps the
 *  modal responsive for users with thousands of messages. */
const MAX_ITEMS = 200;

export class ChatSearchModal extends FuzzySuggestModal<ChatSearchResult> {
	private plugin: CurtisPlugin;

	constructor(app: App, plugin: CurtisPlugin) {
		super(app);
		this.plugin = plugin;
		this.setPlaceholder('Search conversations... (type to filter)');
		this.setInstructions([
			{ command: '↑↓', purpose: 'Navigate' },
			{ command: '↵', purpose: 'Open conversation' },
			{ command: 'esc', purpose: 'Close' },
		]);
	}

	getItems(): ChatSearchResult[] {
		const results: ChatSearchResult[] = [];
		for (const conv of this.plugin.conversationStore.getAllConversations()) {
			for (const message of conv.messages) {
				const content = typeof message.content === 'string' ? message.content : '';
				const snippet = snippetOf(content);
				if (!snippet) continue;
				results.push({ conversation: conv, message, snippet });
				if (results.length >= MAX_ITEMS) return results;
			}
		}
		return results;
	}

	/** Plain text used for fuzzy scoring + filtering. */
	getItemText(item: ChatSearchResult): string {
		return `${item.conversation.title} — ${item.snippet}`;
	}

	/** Custom row: conversation title + message snippet + role label. */
	renderSuggestion(entry: { item: ChatSearchResult }, el: HTMLElement): void {
		el.empty();
		el.addClass('ai-chat-search-row');
		const { conversation, message, snippet } = entry.item;
		el.createDiv({ cls: 'ai-chat-search-title', text: conversation.title });
		const body = el.createDiv({ cls: 'ai-chat-search-snippet' });
		const roleLabel = message.role === 'user' ? 'You' : 'AI';
		body.createEl('span', { cls: 'ai-chat-search-role', text: roleLabel });
		body.appendText(snippet);
	}

	onChooseItem(item: ChatSearchResult): void {
		this.plugin.conversationStore.setCurrentConversation(item.conversation.id);
		// Re-render any open ChatView so the chosen conversation shows up.
		// For v1 we don't scroll to the specific message — switching is enough.
		this.plugin.refreshChatViews();
	}
}
