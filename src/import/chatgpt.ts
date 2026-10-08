// ChatGPT export converter.
//
// The official ChatGPT data export (Settings → Data controls → Export) ships
// `conversations.json`: an array of conversations, each with a `mapping` tree
// of message nodes (parent/children ids) rather than a flat array. We flatten
// chronologically by node create_time — the linear walk from the root is
// fragile against branches (regenerations, edits), and sorting keeps the
// first-written branch in order, which is what the user experienced.

import type { ParsedChat, ParsedMessage } from './types';

interface ChatGptContent {
	content_type?: string;
	parts?: unknown[];
	text?: string;
}

interface ChatGptNode {
	message?: {
		author?: { role?: string };
		content?: ChatGptContent;
		create_time?: number | null;
		metadata?: { model_slug?: string };
	};
}

interface ChatGptConversation {
	title?: string;
	create_time?: number;
	update_time?: number;
	mapping?: Record<string, ChatGptNode>;
}

/** Extract readable text from one ChatGPT message node. */
function contentToText(content: ChatGptContent | undefined): string {
	if (!content) return '';
	if (typeof content.text === 'string' && content.parts === undefined) return content.text;
	if (Array.isArray(content.parts)) {
		return content.parts
			.filter((p): p is string => typeof p === 'string')
			.join('\n')
			.trim();
	}
	return '';
}

export function parseChatGptExport(data: unknown): ParsedChat[] {
	if (!Array.isArray(data)) return [];
	const chats: ParsedChat[] = [];
	for (const raw of data) {
		const conv = raw as ChatGptConversation;
		if (!conv || typeof conv !== 'object' || !conv.mapping) continue;

		const nodes = Object.values(conv.mapping).filter(
			(n): n is ChatGptNode => !!n?.message && n.message.author?.role !== undefined
		);
		// Epoch seconds → ms. Nodes without a time sort first in export order.
		const timed = nodes.map((n, i) => ({
			order: (n.message?.create_time ?? 0) * 1000,
			index: i,
			node: n,
		}));
		timed.sort((a, b) => a.order - b.order || a.index - b.index);

		const messages: ParsedMessage[] = [];
		for (const { node, order } of timed) {
			const msg0 = node.message;
			if (!msg0) continue;
			const role = msg0.author?.role;
			// 'system' nodes are OpenAI platform prompts (not user content) and
			// 'tool' nodes are execution output — neither is part of the visible
			// conversation, and tool messages would orphan without tool_calls
			// when Curtis re-sends the history to a provider.
			if (role !== 'user' && role !== 'assistant') continue;
			const text = contentToText(msg0.content);
			if (!text.trim()) continue;
			const msg: ParsedMessage = { role, content: text, timestamp: order || undefined };
			const model = msg0.metadata?.model_slug;
			if (role === 'assistant' && typeof model === 'string') msg.model = model;
			messages.push(msg);
		}
		if (messages.length === 0) continue;

		chats.push({
			title: typeof conv.title === 'string' && conv.title.trim() ? conv.title.trim() : 'Imported ChatGPT chat',
			messages,
			createdAt: conv.create_time ? conv.create_time * 1000 : undefined,
			updatedAt: conv.update_time ? conv.update_time * 1000 : undefined,
			provider: 'chatgpt',
			model: messages.find((m) => m.model)?.model,
		});
	}
	return chats;
}
