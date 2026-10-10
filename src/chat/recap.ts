// /recap — end-of-session summary in Curtis's voice. One background
// completion over the current conversation; the result is appended to the
// chat itself (so it lives in the transcript) and, when the journal is
// enabled, to the journal file in the vault.

import { Notice } from 'obsidian';
import type CurtisPlugin from '../main';
import type { AIMessage, ConversationMessage } from '../types';
import { appendJournalEntry } from '../memory/journal';
import { ThinkingStreamSplitter } from '../providers/anthropic';

const RECAP_SYSTEM_PROMPT =
	'You are Curtis, an AI assistant integrated into Obsidian. Summarize the conversation below in 2-3 terse bullet points: what was worked on, what was decided, and what was left open. No preamble, no headings, no emoji — just the bullets, written as durable notes a future session could pick up from.';

const TRANSCRIPT_TURNS = 30;
const TURN_CHAR_LIMIT = 500;

function transcriptOf(messages: ConversationMessage[]): string {
	return messages
		.slice(-TRANSCRIPT_TURNS)
		.map((m) => {
			const who =
				m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Curtis' : m.role === 'tool' ? 'Tool' : 'System';
			return `${who}: ${m.content.slice(0, TURN_CHAR_LIMIT)}`;
		})
		.join('\n\n');
}

/**
 * Recap a conversation. Appends the summary as an assistant message, then
 * (when enabled) logs it to the journal. `conversationId` pins the recap to
 * the pane that asked for it (multi-pane support; falls back to the store's
 * current conversation when absent). `onDone` fires only on success — use it
 * to re-render the chat view.
 */
export async function runRecap(
	plugin: CurtisPlugin,
	conversationId: string | null | undefined,
	onDone?: () => void
): Promise<void> {
	const store = plugin.conversationStore;
	const conv = conversationId ? store.getConversation(conversationId) : store.getCurrentConversation();
	if (!conv || conv.messages.length < 3) {
		new Notice('Nothing to recap yet');
		return;
	}

	const notice = new Notice('Recapping…', 0);
	let buffer = '';
	// Extended-thinking providers tag reasoning chunks with <think> sentinels —
	// the recap must store the answer only.
	const thinking = new ThinkingStreamSplitter();
	try {
		const messages: AIMessage[] = [
			{ role: 'system', content: RECAP_SYSTEM_PROMPT },
			{
				role: 'user',
				content: `Conversation title: ${conv.title}\n\n${transcriptOf(conv.messages)}\n\nRecap:`,
			},
		];
		await plugin.callAI(messages, plugin.settings.activeModel, {
			onChunk: (c) => (buffer += thinking.push(c).answer),
		});
	} catch (e) {
		console.error('[Curtis] recap failed:', e);
		new Notice('Recap failed');
		return;
	} finally {
		notice.hide();
	}

	const recap = buffer.trim();
	if (!recap) {
		new Notice('Recap came back empty');
		return;
	}

	// Pin the append to the conversation that was recapped — the store's
	// current pointer may have moved to another pane meanwhile.
	store.addMessageTo(conv.id, {
		role: 'assistant',
		content: `**Recap**\n\n${recap}`,
		provider: plugin.settings.activeProvider,
		model: plugin.settings.activeModel,
	});

	if (plugin.settings.enableJournal) {
		try {
			await appendJournalEntry(plugin, conv.title, recap, store.getConversationPath(conv.id));
			new Notice('Logged to Curtis Journal');
		} catch (e) {
			// The recap still landed in the chat — a journal failure is not fatal.
			console.error('[Curtis] journal append failed:', e);
		}
	}

	onDone?.();
}
