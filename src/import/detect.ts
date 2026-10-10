// Export-format auto-detection.
//
// Order matters: extension-based (.curt, .zip) first, then structural JSON
// signatures, then the Curtis markdown frontmatter, then generic markdown —
// and generic only when both sides of a conversation are confidently found.

import { parseConversationMarkdown } from '../chat/conversation-format';
import { vaultYamlPort } from '../chat/conversation-files';
import { unzipSync, strFromU8 } from 'fflate';
import type { Conversation } from '../types';
import type { DetectedFile, ParsedChat } from './types';
import { parseChatGptExport } from './chatgpt';
import { parseClaudeExport } from './claude';
import { parseCurt } from './curt';
import { parseGenericJson, parseGenericMarkdown } from './generic';

/** Detect a single JSON document once parsed. */
function detectJson(data: unknown): DetectedFile['format'] {
	if (Array.isArray(data)) {
		if (data.length > 0 && data.some((c) => c && typeof c === 'object' && 'chat_messages' in c)) return 'claude';
		if (data.length > 0 && data.some((c) => c && typeof c === 'object' && 'mapping' in c)) return 'chatgpt';
		return 'generic-json';
	}
	if (data && typeof data === 'object') {
		if ('mapping' in data) return 'chatgpt';
		if ('chat_messages' in data) return 'claude';
	}
	return 'generic-json';
}

/**
 * Detect a ChatGPT/Claude export inside an arbitrary zip: the canonical
 * `conversations.json` (any folder depth), else any .json whose parsed
 * content carries a known signature, else .curt files (a bulk-export zip).
 * Non-chat zips yield 'unknown'.
 */
function detectZip(buf: Uint8Array): DetectedFile {
	let entries: Record<string, Uint8Array>;
	try {
		entries = unzipSync(buf);
	} catch {
		return { format: 'unknown', chats: [] };
	}
	const canonical = Object.keys(entries).find((p) => p === 'conversations.json' || p.endsWith('/conversations.json'));
	const candidates = canonical ? [canonical] : Object.keys(entries).filter((p) => p.toLowerCase().endsWith('.json'));
	for (const path of candidates) {
		let data: unknown;
		try {
			data = JSON.parse(strFromU8(entries[path]));
		} catch {
			continue;
		}
		const format = detectJson(data);
		if (format === 'chatgpt') return { format, chats: parseChatGptExport(data) };
		if (format === 'claude') return { format, chats: parseClaudeExport(data) };
	}
	// A zip of .curt files (bulk export from this plugin or Curtis Porter) —
	// import every valid one; corrupted entries are skipped, not fatal.
	const curtEntries = Object.keys(entries).filter((p) => p.toLowerCase().endsWith('.curt'));
	if (curtEntries.length > 0) {
		const conversations: Conversation[] = [];
		for (const path of curtEntries) {
			const conv = parseCurt(strFromU8(entries[path]));
			if (conv) conversations.push(conv);
		}
		if (conversations.length > 0) return { format: 'curt', chats: [], conversations };
	}
	return { format: 'unknown', chats: [] };
}

/**
 * Detect the format of one picked/dropped file and parse it.
 * `name` is only used for the .curt/.zip extensions and error reporting;
 * content signatures decide everything else.
 */
export function detectAndParse(name: string, buf: ArrayBuffer): DetectedFile {
	const ext = name.toLowerCase().split('.').pop() || '';
	const bytes = new Uint8Array(buf);

	if (ext === 'curt') {
		const conv = parseCurt(new TextDecoder().decode(bytes));
		return conv ? { format: 'curt', chats: [], conversations: [conv] } : { format: 'unknown', chats: [] };
	}

	if (ext === 'zip' || (bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b)) {
		return detectZip(bytes);
	}

	const text = new TextDecoder().decode(bytes);

	// JSON documents (ChatGPT / Claude / generic transcripts).
	const trimmed = text.trim();
	if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
		try {
			const data: unknown = JSON.parse(trimmed);
			const format = detectJson(data);
			if (format === 'chatgpt') return { format, chats: parseChatGptExport(data) };
			if (format === 'claude') return { format, chats: parseClaudeExport(data) };
			const chat = parseGenericJson(data);
			return chat ? { format, chats: [chat] } : { format: 'unknown', chats: [] };
		} catch {
			return { format: 'unknown', chats: [] };
		}
	}

	// Curtis markdown (a transcript exported from another vault, or a vault
	// file copied by hand) — the store's parser owns that contract.
	const curtisMd = parseConversationMarkdown(text, 0, vaultYamlPort);
	if (curtisMd) return { format: 'curtis-md', chats: [], conversations: [curtisMd] };

	// Generic role-headed markdown.
	const generic = parseGenericMarkdown(text);
	if (generic) return { format: 'generic-md', chats: [generic] };

	return { format: 'unknown', chats: [] };
}

/** Normalize a parsed chat into a Conversation ready for the store.
 *  Tool-role messages are dropped: foreign transcripts carry no tool_calls
 *  linkage, and an orphan tool message would make providers reject the
 *  request when the imported history is re-sent on continuation. */
export function parsedChatToConversation(chat: ParsedChat): Conversation {
	const now = Date.now();
	const createdAt = chat.createdAt ?? chat.messages[0]?.timestamp ?? now;
	const updatedAt = chat.updatedAt ?? chat.messages[chat.messages.length - 1]?.timestamp ?? createdAt;
	return {
		id: '',
		title: chat.title,
		messages: chat.messages
			.filter((m) => m.role !== 'tool')
			.map((m) => ({
				id: '',
				role: m.role,
				content: m.content,
				timestamp: m.timestamp ?? createdAt,
				model: m.model,
			})),
		createdAt: Math.min(createdAt, updatedAt),
		updatedAt: Math.max(createdAt, updatedAt),
		provider: chat.provider ?? '',
		model: chat.model ?? '',
	};
}

export function conversationDedupeKey(conv: Conversation): string {
	const first = conv.messages.find((m) => m.role === 'user')?.content ?? '';
	return `${conv.title.trim().toLowerCase()}|${conv.messages.length}|${first.slice(0, 200)}`;
}
