// Claude (claude.ai) export converter.
//
// The claude.ai data export ships `conversations.json`: an array of
// conversations whose `chat_messages` are already flat and ordered, with
// `sender: 'human' | 'assistant'`. Message text lives either in a top-level
// `text` field or in `content` blocks ({type: 'text', text}); newer exports
// use blocks. Timestamps are ISO strings.

import type { ParsedChat, ParsedMessage } from './types';

interface ClaudeMessage {
	sender?: string;
	text?: string;
	content?: unknown;
	created_at?: string;
}

interface ClaudeConversation {
	name?: string;
	created_at?: string;
	updated_at?: string;
	chat_messages?: ClaudeMessage[];
}

function isoToMs(iso: unknown): number | undefined {
	if (typeof iso !== 'string') return undefined;
	const t = Date.parse(iso);
	return Number.isFinite(t) ? t : undefined;
}

function blocksToText(content: unknown): string {
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return '';
	return content
		.map((b) => {
			if (b && typeof b === 'object' && typeof (b as { text?: unknown }).text === 'string') {
				return (b as { text: string }).text;
			}
			return '';
		})
		.join('\n')
		.trim();
}

export function parseClaudeExport(data: unknown): ParsedChat[] {
	if (!Array.isArray(data)) return [];
	const chats: ParsedChat[] = [];
	for (const raw of data) {
		const conv = raw as ClaudeConversation;
		if (!conv || typeof conv !== 'object' || !Array.isArray(conv.chat_messages)) continue;

		const messages: ParsedMessage[] = [];
		for (const m of conv.chat_messages) {
			const sender = m?.sender;
			if (sender !== 'human' && sender !== 'assistant') continue;
			const text = (typeof m.text === 'string' && m.text.trim() ? m.text : blocksToText(m.content)).trim();
			if (!text) continue;
			messages.push({
				role: sender === 'human' ? 'user' : 'assistant',
				content: text,
				timestamp: isoToMs(m.created_at),
			});
		}
		if (messages.length === 0) continue;

		chats.push({
			title: typeof conv.name === 'string' && conv.name.trim() ? conv.name.trim() : 'Imported Claude chat',
			messages,
			createdAt: isoToMs(conv.created_at),
			updatedAt: isoToMs(conv.updated_at),
			provider: 'claude',
		});
	}
	return chats;
}
