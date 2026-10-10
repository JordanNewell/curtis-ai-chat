// Node tests for the conversation file format + store — the seam the separate
// Curtis AI Porter repo builds on: markdown round-trip, the import path, and
// store orchestration over an in-memory ConversationFiles port (no Obsidian).

import { describe, expect, it } from 'vitest';
import { ConversationStore, type ConversationStoreHost } from './conversation-store';
import {
	conversationFileName,
	parseConversationMarkdown,
	serializeConversationMarkdown,
	type YamlPort,
} from './conversation-format';
import type { ConversationFileMeta, ConversationFileWatchers, ConversationFiles } from './conversation-files';
import type { Conversation } from '../types';
import { EventBus } from '../core/events';

// The conversation frontmatter is flat scalars only (ids, timestamps, slugs,
// role names) — a line codec covers everything these tests write and parse.
// Message metadata rides in JSON comment markers, not yaml. Real hosts pass
// js-yaml (node) or Obsidian's parseYaml/stringifyYaml.
const flatYaml: YamlPort = {
	parse(text) {
		const out: Record<string, unknown> = {};
		for (const line of text.split('\n')) {
			const m = /^([^:#]+):\s*(.*)$/.exec(line);
			if (!m) continue;
			out[m[1].trim()] = /^-?\d+$/.test(m[2]) ? Number(m[2]) : m[2];
		}
		return out;
	},
	dump(value) {
		const obj = value as Record<string, unknown>;
		// Trailing newline — real yaml writers (js-yaml, Obsidian's stringifyYaml)
		// always end the document with one; the parser's `---\n...\n---` fence
		// match depends on it.
		return Object.entries(obj)
			.map(([k, v]) => `${k}: ${String(v)}`)
			.join('\n') + '\n';
	},
};

class MemoryFiles implements ConversationFiles {
	files = new Map<string, { body: string; mtime: number }>();
	trashed: string[] = [];
	quitHook: (() => Promise<void>) | null = null;
	private now = 1_700_000_000_000;
	private watchers: ConversationFileWatchers | null = null;

	async listIndexedMarkdown(folder: string): Promise<ConversationFileMeta[]> {
		const prefix = `${folder}/`;
		return [...this.files.entries()]
			.filter(([p]) => p.startsWith(prefix))
			.map(([p, f]) => ({ path: p, mtime: f.mtime }));
	}

	async listDiskMarkdown(folder: string): Promise<string[]> {
		return (await this.listIndexedMarkdown(folder)).map((m) => m.path);
	}

	async read(path: string): Promise<string> {
		const f = this.files.get(path);
		if (!f) throw new Error(`missing: ${path}`);
		return f.body;
	}

	async write(path: string, body: string): Promise<void> {
		this.files.set(path, { body, mtime: ++this.now });
	}

	async rename(from: string, to: string): Promise<void> {
		const f = this.files.get(from);
		if (!f) throw new Error(`missing: ${from}`);
		this.files.delete(from);
		this.files.set(to, f);
	}

	async trash(path: string): Promise<void> {
		if (this.files.delete(path)) this.trashed.push(path);
	}

	async exists(path: string): Promise<boolean> {
		return this.files.has(path);
	}

	async ensureFolder(): Promise<void> {}

	watch(watchers: ConversationFileWatchers): void {
		this.watchers = watchers;
	}

	onQuit(hook: () => Promise<void>): void {
		this.quitHook = hook;
	}

	loadLegacyStorage(): unknown {
		return null;
	}

	/** Test driver: simulate the host reporting an external edit. */
	externalModify(path: string, body: string): void {
		const mtime = Date.now();
		this.files.set(path, { body, mtime });
		this.watchers?.onModify(path, mtime);
	}
}

const makeHost = (): ConversationStoreHost => ({ settings: {}, eventBus: new EventBus() });

const makeStore = async (files: MemoryFiles): Promise<ConversationStore> => {
	const store = new ConversationStore();
	await store.load({ host: makeHost(), files, yaml: flatYaml });
	return store;
};

const sampleConversation = (): Conversation => ({
	id: 'conv_sample_abc123',
	title: 'Sample chat',
	messages: [
		{ id: 'm1', role: 'user', content: 'What is decay theory?', timestamp: 1_700_000_001_000, provider: 'deepseek', model: 'deepseek-chat' },
		{
			id: 'm2',
			role: 'assistant',
			content: 'Decay theory says memory traces fade with time.',
			timestamp: 1_700_000_002_000,
			provider: 'deepseek',
			model: 'deepseek-chat',
			cost: 0.0012,
			tokens: { promptTokens: 120, completionTokens: 30, totalTokens: 150 },
			attachedNotes: ['Memory/Decay.md'],
			memoriesUsedIds: ['fact_1', 'fact_2'],
		},
	],
	createdAt: 1_700_000_000_000,
	updatedAt: 1_700_000_002_000,
	provider: 'deepseek',
	model: 'deepseek-chat',
	role: 'leader',
	leaderId: undefined,
});

describe('conversation format', () => {
	it('round-trips a full conversation through serialize → parse', () => {
		const conv = sampleConversation();
		const parsed = parseConversationMarkdown(serializeConversationMarkdown(conv, flatYaml), 0, flatYaml);
		expect(parsed).toEqual(conv);
	});

	it('round-trips leader/follower swarm metadata', () => {
		const conv = sampleConversation();
		conv.role = 'follower';
		conv.leaderId = 'conv_leader_000';
		const parsed = parseConversationMarkdown(serializeConversationMarkdown(conv, flatYaml), 0, flatYaml);
		expect(parsed?.role).toBe('follower');
		expect(parsed?.leaderId).toBe('conv_leader_000');
	});

	it('neutralizes marker lookalikes so a message cannot split on re-parse', () => {
		const conv = sampleConversation();
		conv.messages[1].content = 'Use <!-- curtis:msg {"fake":true} --> carefully; a --> inside must not split the block.';
		const round = parseConversationMarkdown(serializeConversationMarkdown(conv, flatYaml), 0, flatYaml);
		// The fake opener is neutralized (invisible zero-width space after
		// "<!--"), so the re-parse sees the same two messages — the fake marker
		// does not split the message and the text survives readably.
		expect(round?.messages).toHaveLength(2);
		expect(round?.messages[1].content).toContain('{"fake":true}');
		expect(round?.messages[1].content).toContain('must not split the block.');
	});

	it('returns null for markdown without a Curtis frontmatter signature', () => {
		expect(parseConversationMarkdown('# Just a note\n\nBody.', 0, flatYaml)).toBeNull();
		expect(parseConversationMarkdown('---\nfrontmatter: other-plugin\n---\n# X', 0, flatYaml)).toBeNull();
	});

	it('parses hand-authored files (porter must read files Curtis wrote)', () => {
		const raw = [
			'---',
			'curtis: conversation',
			'id: conv_hand_000001',
			'created: 1791556000000',
			'updated: 1791556000001',
			'provider: deepseek',
			'model: deepseek-chat',
			'---',
			'',
			'# Verify 1',
			'',
			'## You',
			'<!-- curtis:msg {"id":"m1","ts":1791556000000,"role":"user"} -->',
			'',
			'Seed message for store verification.',
			'',
			'## AI',
			'<!-- curtis:msg {"id":"m2","ts":1791556000001,"role":"assistant"} -->',
			'',
			'Seed reply.',
			'',
		].join('\n');
		const conv = parseConversationMarkdown(raw, 0, flatYaml);
		expect(conv?.id).toBe('conv_hand_000001');
		expect(conv?.title).toBe('Verify 1');
		expect(conv?.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
		expect(conv?.messages[0].content).toBe('Seed message for store verification.');
	});

	it('names files chronologically with a slug and id tail', () => {
		const conv = sampleConversation();
		// Local noon on Nov 14 2023 — the name derives from the LOCAL calendar
		// day, so pin the timestamp to noon to stay timezone-proof. slugify
		// keeps case and inner spaces; it only strips filename-illegal chars.
		conv.createdAt = new Date(2023, 10, 14, 12).getTime();
		expect(conversationFileName(conv)).toBe('2023-11-14 Sample chat abc123.md');
	});
});

describe('conversation store over the file port', () => {
	it('imports an external conversation and writes the file immediately', async () => {
		const files = new MemoryFiles();
		const store = await makeStore(files);
		const id = await store.importConversation(sampleConversation());
		expect(id).toBe('conv_sample_abc123');
		const path = store.getConversationPath(id!);
		expect(path).toBeDefined();
		expect(files.files.has(path!)).toBe(true);
		// The written file parses back to the same conversation.
		const parsed = parseConversationMarkdown(await files.read(path!), 0, flatYaml);
		expect(parsed).toEqual(sampleConversation());
	});

	it('assigns a fresh id on collision and rejects empty conversations', async () => {
		const files = new MemoryFiles();
		const store = await makeStore(files);
		await store.importConversation(sampleConversation());
		const again = await store.importConversation(sampleConversation());
		expect(again).not.toBe('conv_sample_abc123');
		expect(store.getConversation(again!)).toBeDefined();
		expect(await store.importConversation({ ...sampleConversation(), messages: [] })).toBeNull();
	});

	it('auto-titles from the first user message and flushes on quit', async () => {
		const files = new MemoryFiles();
		const store = await makeStore(files);
		const conv = store.createConversation('openai', 'gpt-4o');
		store.addMessage({ role: 'user', content: 'Explain decay theory briefly', provider: 'openai', model: 'gpt-4o' });
		expect(store.getConversation(conv.id)?.title).toBe('Explain decay theory briefly');
		expect(store.getConversationPath(conv.id)).toBeUndefined(); // memory-only until flushed
		await files.quitHook?.();
		expect(store.getConversationPath(conv.id)).toBeDefined();
		expect(files.files.size).toBe(1);
	});

	it('numbers concurrent fresh chats and drops the number on first message', async () => {
		const store = await makeStore(new MemoryFiles());
		const a = store.createConversation('openai', 'gpt-4o');
		const b = store.createConversation('openai', 'gpt-4o');
		expect(a.title).toBe('New chat');
		expect(b.title).toBe('New chat 2');
		store.setCurrentConversation(b.id);
		store.addMessage({ role: 'user', content: 'hello', provider: 'openai', model: 'gpt-4o' });
		expect(b.title).toBe('hello');
		expect(a.title).toBe('New chat');
	});

	it('retitles the file on rename', async () => {
		const files = new MemoryFiles();
		const store = await makeStore(files);
		const id = await store.importConversation(sampleConversation());
		const oldPath = store.getConversationPath(id!);
		store.renameCurrentConversation('Renamed chat', id!);
		await files.quitHook?.();
		const newPath = store.getConversationPath(id!);
		expect(newPath).not.toBe(oldPath);
		expect(files.files.has(newPath!)).toBe(true);
		expect(files.files.has(oldPath!)).toBe(false);
		expect(store.getConversation(id!)?.title).toBe('Renamed chat');
	});

	it('trashes the file on delete, never hard-deleting', async () => {
		const files = new MemoryFiles();
		const store = await makeStore(files);
		const id = await store.importConversation(sampleConversation());
		const path = store.getConversationPath(id!);
		store.deleteConversation(id!);
		expect(store.getConversation(id!)).toBeUndefined();
		// Trash is queued — wait for the flush chain to land.
		await new Promise((r) => setTimeout(r, 10));
		expect(files.trashed).toEqual([path]);
	});

	it('re-parses on external modify, but never clobbers pending writes', async () => {
		const files = new MemoryFiles();
		const store = await makeStore(files);
		const id = await store.importConversation(sampleConversation());
		const path = store.getConversationPath(id!);

		const edited = serializeConversationMarkdown(
			{ ...sampleConversation(), messages: [{ ...sampleConversation().messages[0], content: 'Hand-edited content' }] },
			flatYaml
		);
		// Let the store's own write fully settle first — the self-write guard
		// (writingPaths) clears on the next macrotask after a flush, and an
		// edit reported before that is (correctly) treated as the store's own.
		await new Promise((r) => setTimeout(r, 10));
		files.externalModify(path!, edited);
		await new Promise((r) => setTimeout(r, 10));
		expect(store.getConversation(id!)?.messages[0].content).toBe('Hand-edited content');

		// A dirty in-memory copy is ahead of disk — the watcher must skip it.
		store.addMessageTo(id!, { role: 'user', content: 'newest message', provider: 'deepseek', model: 'deepseek-chat' });
		files.externalModify(path!, edited);
		await new Promise((r) => setTimeout(r, 10));
		const conv = store.getConversation(id!)!;
		expect(conv.messages[conv.messages.length - 1].content).toBe('newest message');
	});

	it('scans pre-existing files on boot and exposes path lookup', async () => {
		const files = new MemoryFiles();
		const seed = sampleConversation();
		files.files.set('AI/Conversations/2023-11-14 sample-chat abc123.md', {
			body: serializeConversationMarkdown(seed, flatYaml),
			mtime: 1_700_000_002_000,
		});
		const store = await makeStore(files);
		expect(store.getConversation('conv_sample_abc123')).toBeDefined();
		expect(store.getConversationByPath('AI/Conversations/2023-11-14 sample-chat abc123.md')?.id).toBe('conv_sample_abc123');
		expect(store.getAllConversations()).toHaveLength(1);
	});
});
