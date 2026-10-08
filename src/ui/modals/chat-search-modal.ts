// Chat Search Modal — fuzzy-search across ALL conversations (titles + message
// contents). Opens via the header search button or the Ctrl+Shift+F command.
//
// Uses FuzzySuggestModal's built-in fuzzy matching: each item is a
// (conversation, message) pair, getItemText returns the combined
// "title — snippet" string, and Obsidian fuzzy-matches against that.
// No need to bind to the input field ourselves.

import { App, FuzzySuggestModal, prepareFuzzySearch } from 'obsidian';
import type { FuzzyMatch } from 'obsidian';
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
	/** Called with the chosen conversation id. When provided, the picked
	 *  conversation opens in the pane the search was launched from; otherwise
	 *  every open pane re-renders (legacy single-pane behavior). */
	private onSelect?: (conversationId: string) => void;

	constructor(app: App, plugin: CurtisPlugin, onSelect?: (conversationId: string) => void) {
		super(app);
		this.plugin = plugin;
		this.onSelect = onSelect;
		this.setPlaceholder('Search conversations... (Type to filter)');
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

	/**
	 * Pre-filter with the raw query across ALL conversations before the
	 * recency cap applies. The base class fuzzy-matches only over getItems(),
	 * and getItems() truncates by recency — without this override, every
	 * conversation older than the newest 200 messages is invisible to search
	 * (title included), no matter what the user types.
	 */
	getSuggestions(query: string): FuzzyMatch<ChatSearchResult>[] {
		const q = query.trim().toLowerCase();
		if (!q) {
			return this.getItems().map((item) => ({ item, match: { matches: [], score: 0 } }));
		}
		const results: ChatSearchResult[] = [];
		for (const conv of this.plugin.conversationStore.getAllConversations()) {
			const titleHit = conv.title.toLowerCase().includes(q);
			for (const message of conv.messages) {
				const content = typeof message.content === 'string' ? message.content : '';
				if (!titleHit && !content.toLowerCase().includes(q)) continue;
				const snippet = snippetOf(content);
				if (!snippet) continue;
				results.push({ conversation: conv, message, snippet });
				if (results.length >= MAX_ITEMS) break;
			}
			if (results.length >= MAX_ITEMS) break;
		}
		const fuzzy = prepareFuzzySearch(query);
		const scored: FuzzyMatch<ChatSearchResult>[] = [];
		for (const item of results) {
			const match = fuzzy(this.getItemText(item));
			if (match) scored.push({ item, match });
		}
		scored.sort((a, b) => a.match.score - b.match.score);
		return scored;
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
		body.createSpan({ cls: 'ai-chat-search-role', text: roleLabel });
		body.appendText(snippet);
	}

	onChooseItem(item: ChatSearchResult): void {
		// For v1 we don't scroll to the specific message — switching is enough.
		if (this.onSelect) {
			// switchConversation moves the store pointer itself on success —
			// when the pane refuses (mid-stream), the pointer must not move
			// either, or the pane and the default silently diverge.
			this.onSelect(item.conversation.id);
			return;
		}
		this.plugin.conversationStore.setCurrentConversation(item.conversation.id);
		this.plugin.refreshChatViews();
	}
}
