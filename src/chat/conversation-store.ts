// Conversation Store — vault-file-backed persistent conversation management.
//
// Design (mirrors the memory store's file-backed pattern):
//   - Each conversation lives in ONE markdown file inside the conversations
//     folder (default "AI/Conversations"). Files are named
//     "<created-date> <title> <id6>.md" so they sort chronologically in the
//     file explorer and survive title renames without colliding.
//   - Conversation metadata rides in YAML frontmatter (id, provider, model,
//     timestamps). The title is the H1. Messages are readable
//     markdown sections; a hidden HTML comment above each section carries the
//     machine metadata (id, timestamp, role, tokens, tool calls, attachments)
//     so the file stays human-readable and native Obsidian search indexes
//     every word of history.
//   - The in-memory Map stays the working set so the whole call surface stays
//     synchronous (the chat view streams and mutates freely). Writes are
//     debounced per conversation and serialized through a per-id queue so
//     rename + modify never interleave.
//   - Hand edits round-trip: a 'modify' on a tracked file re-parses it
//     (self-writes are guarded, same as the memory store). Deleting a file
//     in the host app deletes the conversation from history.
//   - One-time import: conversations still living in localStorage (the
//     pre-1.3 store) are written out to files on load, matched by id,
//     so no history is lost on upgrade. The localStorage copy is left in
//     place as a harmless backup and never read again.
//
// Obsidian-free: the store orchestrates against two injected ports and runs
// under plain node (vitest, and the separate Curtis AI Porter repo):
//   - ConversationFiles — file I/O + change watching (the Obsidian host binds
//     it to the vault via VaultConversationFiles; a node host binds node:fs).
//   - YamlPort — frontmatter codec (Obsidian: parseYaml/stringifyYaml).

import type { Conversation, ConversationMessage, ConversationStats } from '../types';
import type { ConversationChangeKind, EventBus } from '../core/events';
import {
	parseConversationMarkdown,
	serializeConversationMarkdown,
	conversationFileName,
	type YamlPort,
} from './conversation-format';
import type { ConversationFiles } from './conversation-files';

const DEFAULT_CONVERSATIONS_FOLDER = 'AI/Conversations';
const LEGACY_STORAGE_KEY = 'ai-conversations';
/** Fresh chats are "New chat", numbered ("New chat 2", …) once one already
 *  exists — with several panes open, identical titles are indistinguishable.
 *  The first user message replaces any match, so the number lives exactly as
 *  long as the ambiguity does. */
const UNTITLED_TITLE_RE = /^New chat(?: (\d+))?$/;

/** The slice of the plugin the store needs — structural, so node tests and
 *  the Porter repo can satisfy it without Obsidian. */
export interface ConversationStoreHost {
	settings: { conversationsFolder?: string };
	eventBus: EventBus;
}

export interface ConversationStoreLoadOptions {
	host: ConversationStoreHost;
	files: ConversationFiles;
	yaml: YamlPort;
	notifyError?: (message: string) => void;
}

export class ConversationStore {
	private host: ConversationStoreHost | null = null;
	private files!: ConversationFiles;
	private yaml!: YamlPort;
	private notifyError?: (message: string) => void;
	private conversations = new Map<string, Conversation>();
	private currentConversationId: string | null = null;

	/** conv id → file path. */
	private paths = new Map<string, string>();
	/** conv ids with unsaved changes. */
	private dirty = new Set<string>();
	/** Per-conv debounce timers for persisted writes. ReturnType (not number)
	 *  — this module also runs under plain node, where setTimeout doesn't
	 *  return a number, and window timers are unavailable. */
	private timers = new Map<string, ReturnType<typeof setTimeout>>();
	/** Per-conv write queue — serializes persist/rename ops for one file. */
	private queues = new Map<string, Promise<void>>();
	/** Paths we are writing right now — the modify watcher skips these so we
	 *  don't re-parse our own output (same guard as the memory store). */
	private writingPaths = new Set<string>();

	private resolveFolder(): string {
		const raw = this.host?.settings?.conversationsFolder?.trim();
		return raw ? raw.replace(/^\/+|\/+$/g, '') : DEFAULT_CONVERSATIONS_FOLDER;
	}

	// ----------------------------------------------------------------------------
	// Load / import
	// ----------------------------------------------------------------------------

	/** Scan the conversations folder, rebuild the in-memory map, watch for
	 *  hand edits, and import anything still trapped in localStorage. */
	async load(opts: ConversationStoreLoadOptions): Promise<void> {
		this.host = opts.host;
		this.files = opts.files;
		this.yaml = opts.yaml;
		this.notifyError = opts.notifyError;

		await this.ensureFolder();
		await this.scanFolder();
		this.registerFileWatcher();
		// Background — must not block onload while the vault tree populates.
		// The legacy import runs INSIDE, after the scan settles: importing
		// before the tree arrives would re-import conversations the (late)
		// scan is about to find, and every boot would write another copy.
		void this.settleScanThenImportLegacy();
	}

	/** Parse every file under the conversations folder into the map.
	 *  Idempotent (set by id); safe to run again when settleScan retries. */
	private async scanFolder(): Promise<void> {
		const folder = this.resolveFolder();
		const metas = await this.files.listIndexedMarkdown(folder);
		// Reads are independent — parse concurrently so a large history
		// doesn't serialize into a slow boot.
		const parsed = await Promise.all(metas.map((meta) => this.parsePath(meta.path, meta.mtime)));
		for (let i = 0; i < metas.length; i++) {
			const conv = parsed[i];
			// A dirty in-memory copy is AHEAD of disk (pending debounced write) —
			// a re-scan (boot retry) must not replace it with the older file.
			if (conv && !this.dirty.has(conv.id)) {
				this.conversations.set(conv.id, conv);
				this.paths.set(conv.id, metas[i].path);
			}
		}
	}

	/**
	 * Boot-race guard for the scan, then the one-time localStorage import.
	 *
	 * On some boots the host's file index is not populated yet when the
	 * plugin loads, so scanFolder sees an empty folder even though
	 * conversation files exist. Left alone, the legacy localStorage import
	 * then re-imports conversations the late scan was about to find — and
	 * every boot writes another numbered copy of each file (the demo-vault
	 * litter machine). So: poll until the index lists the folder (up to
	 * ~45s — it has always arrived by then; normal boots pass on the first
	 * check), re-scanning as it grows, and only then import localStorage
	 * entries whose ids are still missing.
	 */
	private async settleScanThenImportLegacy(): Promise<void> {
		const folder = this.resolveFolder();
		let settled = false;
		for (let attempt = 0; attempt < 45; attempt++) {
			const vaultCount = (await this.files.listIndexedMarkdown(folder)).length;
			if (vaultCount > 0) {
				settled = true;
				break;
			}
			// Keep waiting only when the disk folder actually has files — a
			// folder that is empty on disk needs no scan, whatever the index says.
			const diskCount = (await this.files.listDiskMarkdown(folder)).length;
			if (diskCount === 0) return;
			if (attempt === 0 || attempt % 10 === 9) {
				console.warn(
					`[Curtis] File index not ready — ${vaultCount} under ${folder}/, ` +
						`${diskCount} on disk. Waiting... (attempt ${attempt + 1})`
				);
			}
			await new Promise((r) => setTimeout(r, 1000));
			await this.scanFolder();
		}
		if (!settled) {
			console.error(
				'[Curtis] Conversation files exist on disk but the index never listed them. History will be missing until the next reload.'
			);
		}
		await this.importLegacyLocalStorage();
	}

	/** One-time migration: localStorage conversations with ids not present in
	 *  the store are written out as files. Idempotent across boots. */
	private async importLegacyLocalStorage(): Promise<void> {
		let entries: [string, Conversation][] = [];
		try {
			const raw: unknown = this.files.loadLegacyStorage(LEGACY_STORAGE_KEY);
			if (!raw) return;
			const parsed = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
			if (Array.isArray(parsed)) entries = parsed as [string, Conversation][];
		} catch (e) {
			console.error('[Curtis] Legacy conversation import read failed:', e);
			return;
		}
		let imported = 0;
		for (const entry of entries) {
			// Legacy format is a serialized Map: an array of [id, conversation] pairs.
			const conv = Array.isArray(entry) ? entry[1] : (entry as Conversation);
			if (!conv || typeof conv !== 'object' || typeof conv.id !== 'string') continue;
			if (this.conversations.has(conv.id)) continue;
			if (!Array.isArray(conv.messages)) continue;
			this.conversations.set(conv.id, conv);
			this.dirty.add(conv.id);
			imported++;
		}
		if (imported > 0) {
			// Flush inline (not debounced) so the import survives a fast quit.
			const ids = Array.from(this.dirty);
			await Promise.all(ids.map((id) => this.flush(id)));
		}
	}

	private registerFileWatcher(): void {
		this.files.watch({
			onModify: (path, mtime) => {
				if (this.writingPaths.has(path)) return;
				void this.reloadPath(path, mtime);
			},
			onRename: (path, oldPath) => {
				const id = this.findByPath(oldPath);
				if (id) this.paths.set(id, path);
			},
			onDelete: (path) => {
				const id = this.findByPath(path);
				if (!id) return;
				this.paths.delete(id);
				this.conversations.delete(id);
				if (this.currentConversationId === id) {
					this.currentConversationId = null;
				}
				this.notifyChanged(id, 'delete');
			},
		});
		// The debounced write can lose the last ≤200ms of messages on a fast
		// quit; onunload's fire-and-forget flush races teardown. The quit
		// hook is the one the host actually awaits.
		this.files.onQuit(async () => {
			for (const id of Array.from(this.dirty)) {
				this.clearTimer(id);
				await this.flush(id);
			}
		});
	}

	private findByPath(path: string): string | undefined {
		for (const [id, p] of this.paths) {
			if (p === path) return id;
		}
		return undefined;
	}

	/** Re-read one conversation file after an external modify. Parse failures
	 *  keep the in-memory copy (a transient read must not wipe live state). */
	private async reloadPath(path: string, mtime: number): Promise<void> {
		const id = this.findByPath(path);
		if (!id) return;
		// A pending debounced write means our in-memory copy is AHEAD of the
		// disk — replacing it with the on-disk copy (and clearing the dirty
		// flag) would silently drop just-added messages. Let the flush land.
		if (this.dirty.has(id)) return;
		const conv = await this.parsePath(path, mtime);
		if (conv && conv.id === id) {
			this.conversations.set(id, conv);
			this.dirty.delete(id);
			this.notifyChanged(id, 'messages');
		}
	}

	// ----------------------------------------------------------------------------
	// Public API (synchronous — writes are debounced to storage)
	// ----------------------------------------------------------------------------

	createConversation(provider: string, model: string): Conversation {
		const id = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
		const now = Date.now();
		// Number past the highest untitled chat already in memory so two fresh
		// panes never share a label. Monotonic within a session — a deleted
		// "New chat 4" is not immediately reissued.
		let highest = 0;
		for (const c of this.conversations.values()) {
			const m = UNTITLED_TITLE_RE.exec(c.title);
			if (m) highest = Math.max(highest, Number(m[1] ?? 1));
		}
		const conv: Conversation = {
			id,
			title: highest === 0 ? 'New chat' : `New chat ${highest + 1}`,
			messages: [],
			createdAt: now,
			updatedAt: now,
			provider,
			model,
		};
		this.conversations.set(id, conv);
		this.currentConversationId = id;
		// Empty conversations are not persisted — the first message creates
		// the file, so clicking "New chat" never litters the vault.
		this.notifyChanged(id, 'meta');
		return conv;
	}

	getCurrentConversation(): Conversation | undefined {
		if (!this.currentConversationId) return undefined;
		return this.conversations.get(this.currentConversationId);
	}

	setCurrentConversation(id: string): void {
		if (this.conversations.has(id)) {
			this.currentConversationId = id;
		}
	}

	/** Conversation by id, independent of the current-conversation pointer. */
	getConversation(id: string): Conversation | undefined {
		return this.conversations.get(id);
	}

	/** Storage path of a conversation's markdown file. Undefined while the
	 *  conversation is still empty (memory-only, never written). */
	getConversationPath(id: string): string | undefined {
		return this.paths.get(id);
	}

	/** Conversation backed by a given file path, if any. */
	getConversationByPath(path: string): Conversation | undefined {
		const id = this.findByPath(path);
		return id ? this.conversations.get(id) : undefined;
	}

	addMessage(message: Omit<ConversationMessage, 'id' | 'timestamp'>): ConversationMessage {
		if (!this.currentConversationId) throw new Error('No active conversation');
		const stored = this.addMessageTo(this.currentConversationId, message);
		if (!stored) throw new Error('No active conversation');
		return stored;
	}

	/**
	 * Append to a SPECIFIC conversation, independent of the current-conversation
	 * pointer — a stream in flight must land in the conversation it started in
	 * even if the user starts a new chat or switches while it runs.
	 */
	addMessageTo(conversationId: string, message: Omit<ConversationMessage, 'id' | 'timestamp'>): ConversationMessage | null {
		const conv = this.conversations.get(conversationId);
		if (!conv) return null;

		const fullMessage: ConversationMessage = {
			...message,
			id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
			timestamp: Date.now(),
		};

		conv.messages.push(fullMessage);
		conv.updatedAt = Date.now();

		// Auto-title from first user message — replaces the untitled
		// placeholder in numbered ("New chat 2") or plain form.
		if (UNTITLED_TITLE_RE.test(conv.title) && message.role === 'user') {
			conv.title = (typeof message.content === 'string' ? message.content : '').slice(0, 50);
		}

		this.markDirty(conv.id);
		this.notifyChanged(conv.id, 'messages');
		return fullMessage;
	}

	/**
	 * Persist an externally-built conversation (chat importer / Porter).
	 * Assigns a fresh conv id on collision, fills in any missing message ids,
	 * writes the file immediately (no debounce — the summary must reflect
	 * reality), and returns the final id. Returns null when the conversation
	 * has no messages (nothing worth a file).
	 */
	async importConversation(conv: Conversation): Promise<string | null> {
		if (!conv || !Array.isArray(conv.messages) || conv.messages.length === 0) return null;
		while (!conv.id || this.conversations.has(conv.id)) {
			conv.id = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
		}
		for (const msg of conv.messages) {
			if (!msg.id || conv.messages.some((m) => m !== msg && m.id === msg.id)) {
				msg.id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
			}
		}
		this.conversations.set(conv.id, conv);
		this.dirty.add(conv.id);
		await this.flush(conv.id);
		return conv.id;
	}

	getAllConversations(): Conversation[] {
		return Array.from(this.conversations.values()).sort((a, b) => b.updatedAt - a.updatedAt);
	}

	/** Delete = move the file to the trash (recoverable), never a hard delete. */
	deleteConversation(id: string): void {
		this.conversations.delete(id);
		const path = this.paths.get(id);
		this.paths.delete(id);
		this.dirty.delete(id);
		this.clearTimer(id);
		if (this.currentConversationId === id) {
			this.currentConversationId = null;
		}
		this.notifyChanged(id, 'delete');
		if (path) {
			void this.enqueue(id, async () => {
				try {
					await this.files.trash(path);
				} catch (e) {
					console.error('[Curtis] Failed to trash conversation file:', e);
				}
			});
		}
	}

	getStats(): ConversationStats {
		let totalMessages = 0;
		let totalTokens = 0;
		let totalCost = 0;
		const providerBreakdown: Record<string, { tokens: number }> = {};
		const modelBreakdown: Record<string, { tokens: number; count: number }> = {};

		for (const conv of this.conversations.values()) {
			for (const msg of conv.messages) {
				totalMessages++;
				if (msg.tokens) {
					totalTokens += msg.tokens.totalTokens;
					const provider = msg.provider || 'unknown';
					const model = msg.model || 'unknown';

					if (!providerBreakdown[provider]) providerBreakdown[provider] = { tokens: 0 };
					providerBreakdown[provider].tokens += msg.tokens.totalTokens;

					if (!modelBreakdown[model]) modelBreakdown[model] = { tokens: 0, count: 0 };
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

	/** Last user message in the given conversation (default: current), or undefined. */
	getLastUserMessage(conversationId?: string): ConversationMessage | undefined {
		const conv = conversationId ? this.conversations.get(conversationId) : this.getCurrentConversation();
		if (!conv) return undefined;
		for (let i = conv.messages.length - 1; i >= 0; i--) {
			if (conv.messages[i].role === 'user') return conv.messages[i];
		}
		return undefined;
	}

	/** Last assistant message in the given conversation (default: current), or undefined. */
	getLastAssistantMessage(conversationId?: string): ConversationMessage | undefined {
		const conv = conversationId ? this.conversations.get(conversationId) : this.getCurrentConversation();
		if (!conv) return undefined;
		for (let i = conv.messages.length - 1; i >= 0; i--) {
			if (conv.messages[i].role === 'assistant') return conv.messages[i];
		}
		return undefined;
	}

	/** Remove and return a message by id from the given conversation (default: current). */
	deleteMessage(messageId: string, conversationId?: string): boolean {
		const conv = conversationId ? this.conversations.get(conversationId) : this.getCurrentConversation();
		if (!conv) return false;
		const idx = conv.messages.findIndex((m) => m.id === messageId);
		if (idx === -1) return false;
		conv.messages.splice(idx, 1);
		conv.updatedAt = Date.now();
		this.markDirty(conv.id);
		this.notifyChanged(conv.id, 'messages');
		return true;
	}

	/**
	 * Drop every message AFTER the one with `messageId` (the matched message
	 * stays). Used by edit-resend (truncate after the edited user msg before
	 * re-streaming). Returns the number of messages removed.
	 */
	truncateAfterMessage(messageId: string, conversationId?: string): number {
		const conv = conversationId ? this.conversations.get(conversationId) : this.getCurrentConversation();
		if (!conv) return 0;
		const idx = conv.messages.findIndex((m) => m.id === messageId);
		if (idx === -1) return 0;
		const removed = conv.messages.length - (idx + 1);
		if (removed <= 0) return 0;
		conv.messages = conv.messages.slice(0, idx + 1);
		conv.updatedAt = Date.now();
		this.markDirty(conv.id);
		this.notifyChanged(conv.id, 'messages');
		return removed;
	}

	/**
	 * Drop the message with `messageId` AND everything after it. Used by
	 * regenerate (the dropped assistant message is re-streamed fresh).
	 * Returns the number of messages removed.
	 */
	truncateFromMessage(messageId: string, conversationId?: string): number {
		const conv = conversationId ? this.conversations.get(conversationId) : this.getCurrentConversation();
		if (!conv) return 0;
		const idx = conv.messages.findIndex((m) => m.id === messageId);
		if (idx === -1) return 0;
		const removed = conv.messages.length - idx;
		conv.messages = conv.messages.slice(0, idx);
		conv.updatedAt = Date.now();
		this.markDirty(conv.id);
		this.notifyChanged(conv.id, 'messages');
		return removed;
	}

	/** Update a message in place (by id) in the given conversation (default: current). */
	updateMessage(messageId: string, updates: Partial<ConversationMessage>, conversationId?: string): boolean {
		const conv = conversationId ? this.conversations.get(conversationId) : this.getCurrentConversation();
		if (!conv) return false;
		const msg = conv.messages.find((m) => m.id === messageId);
		if (!msg) return false;
		Object.assign(msg, updates);
		conv.updatedAt = Date.now();
		this.markDirty(conv.id);
		this.notifyChanged(conv.id, 'messages');
		return true;
	}

	/** Rename the current (or given) conversation. The file is retitled to match. */
	renameCurrentConversation(title: string, conversationId?: string): void {
		const conv = conversationId ? this.conversations.get(conversationId) : this.getCurrentConversation();
		if (!conv) return;
		conv.title = title;
		conv.updatedAt = Date.now();
		this.markDirty(conv.id);
		this.notifyChanged(conv.id, 'meta');
	}

	/** Set (or clear) a conversation's swarm role and persist + broadcast it.
	 *  Clearing a follower's role also clears the leader link. */
	setConversationRole(id: string, role: 'leader' | 'follower' | undefined): void {
		const conv = this.conversations.get(id);
		if (!conv) return;
		conv.role = role;
		if (!role || role === 'leader') conv.leaderId = undefined;
		this.markDirty(id);
		this.notifyChanged(id, 'meta');
	}

	/** Bind (or clear) a conversation's named agent and persist + broadcast.
	 *  The binding is metadata: persona/model/ACL resolve at request time,
	 *  so editing the agent updates every chat it is bound to. */
	setConversationAgent(id: string, agentId: string | undefined): void {
		const conv = this.conversations.get(id);
		if (!conv) return;
		conv.agentId = agentId;
		conv.updatedAt = Date.now();
		this.markDirty(id);
		this.notifyChanged(id, 'meta');
	}

	/** Broadcast a conversation mutation so every open chat pane bound to it
	 *  can re-render (or rebind, on delete). No-op before load() wired the host. */
	private notifyChanged(id: string, kind: ConversationChangeKind): void {
		this.host?.eventBus.emit('conversation:changed', { id, kind });
	}

	/** Schedule a debounced write for the given conversation. */
	private markDirty(id: string): void {
		this.dirty.add(id);
		this.clearTimer(id);
		this.timers.set(
			id,
			setTimeout(() => {
				this.timers.delete(id);
				void this.flush(id);
			}, 200)
		);
	}

	private clearTimer(id: string): void {
		const t = this.timers.get(id);
		if (t) {
			clearTimeout(t);
			this.timers.delete(id);
		}
	}

	/** Kept for call sites that treated the store as explicitly-saved; with
	 *  file-backed storage every mutation persists itself. */
	save(): void {
		for (const id of Array.from(this.dirty)) {
			this.clearTimer(id);
			void this.flush(id);
		}
	}

	// ----------------------------------------------------------------------------
	// File I/O (through the ConversationFiles port)
	// ----------------------------------------------------------------------------

	/** Serialize and write one conversation's file (through its queue). */
	private async flush(id: string): Promise<void> {
		const conv = this.conversations.get(id);
		if (!conv) return;
		// Empty conversations stay memory-only until they have content.
		if (conv.messages.length === 0 && !this.paths.has(id)) return;
		await this.enqueue(id, () => this.writeConversation(conv));
	}

	/** Chain an operation onto the per-conversation queue (runs even if the
	 *  previous op failed — a failed write must not wedge the file). */
	private enqueue(id: string, op: () => Promise<void>): Promise<void> {
		const tail = (this.queues.get(id) || Promise.resolve()).catch(() => undefined).then(op);
		this.queues.set(id, tail);
		tail.catch(() => undefined).finally(() => {
			if (this.queues.get(id) === tail) this.queues.delete(id);
		});
		return tail;
	}

	private async writeConversation(conv: Conversation): Promise<void> {
		const folder = this.resolveFolder();
		await this.files.ensureFolder(folder);
		const desiredPath = `${folder}/${conversationFileName(conv)}`;
		const existingPath = this.paths.get(conv.id);

		let path = existingPath;
		if (!path) {
			path = await this.uniquePath(desiredPath);
		} else if (path !== desiredPath && !(await this.pathTaken(desiredPath))) {
			// Title changed (auto-title or rename) — retitle the file so the
			// file list stays human-browsable.
			try {
				await this.files.rename(path, desiredPath);
				path = desiredPath;
			} catch (e) {
				console.error('[Curtis] Conversation retitle failed:', e);
				// Keep writing to the old path — the H1 carries the new title.
			}
		}

		this.writingPaths.add(path);
		try {
			// Serialize inside the try — a malformed message (e.g. undefined
			// content from a legacy import) must not reject flush as an
			// unhandled rejection with the dirty flag stranded.
			const body = serializeConversationMarkdown(conv, this.yaml);
			await this.files.write(path, body);
			this.paths.set(conv.id, path);
			this.dirty.delete(conv.id);
		} catch (e) {
			// Lost a race with the indexer — fine as long as the file exists.
			const onDisk = await this.files.exists(path);
			if (onDisk) {
				this.paths.set(conv.id, path);
				this.dirty.delete(conv.id);
			} else {
				console.error('[Curtis] Conversation persist failed:', e);
				this.notifyError?.('Curtis could not save a conversation — history may be stale until the next successful write.');
			}
		} finally {
			setTimeout(() => this.writingPaths.delete(path), 0);
		}
	}

	private async uniquePath(path: string): Promise<string> {
		if (!(await this.pathTaken(path))) return path;
		const dot = path.lastIndexOf('.');
		const base = dot === -1 ? path : path.slice(0, dot);
		const ext = dot === -1 ? '' : path.slice(dot);
		for (let n = 2; n < 100; n++) {
			const candidate = `${base} ${n}${ext}`;
			if (!(await this.pathTaken(candidate))) return candidate;
		}
		return `${base} ${Date.now()}${ext}`;
	}

	private async pathTaken(path: string): Promise<boolean> {
		return this.files.exists(path);
	}

	private async ensureFolder(): Promise<void> {
		await this.files.ensureFolder(this.resolveFolder());
	}

	// ----------------------------------------------------------------------------
	// Parse (through the file port + injected yaml)
	// ----------------------------------------------------------------------------

	private async parsePath(path: string, mtime: number): Promise<Conversation | null> {
		let raw: string;
		try {
			raw = await this.files.read(path);
		} catch (e) {
			console.error('[Curtis] Failed to read conversation file:', e);
			return null;
		}
		return parseConversationMarkdown(raw, mtime, this.yaml);
	}
}
