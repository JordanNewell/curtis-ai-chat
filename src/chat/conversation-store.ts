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
//   - Hand edits round-trip: a vault 'modify' on a tracked file re-parses it
//     (self-writes are guarded, same as the memory store). Deleting a file in
//     Obsidian deletes the conversation from history.
//   - One-time import: conversations still living in localStorage (the
//     pre-1.3 store) are written out to vault files on load, matched by id,
//     so no history is lost on upgrade. The localStorage copy is left in
//     place as a harmless backup and never read again.

import { App, Notice, TFile, parseYaml, stringifyYaml } from 'obsidian';
import type { Conversation, ConversationMessage, ConversationStats, TokenUsage } from '../types';
import type CurtisPlugin from '../main';

const DEFAULT_CONVERSATIONS_FOLDER = 'AI/Conversations';
const LEGACY_STORAGE_KEY = 'ai-conversations';
/** Marker opening every message block. Content between markers is the message. */
const MSG_MARKER_RE = /<!--\s*curtis:msg\s+(\{[\s\S]*?\})\s*-->/g;
/** Human-facing section labels, fixed set — the parser strips exactly one of
 *  these above each marker; anything else is treated as message content. */
const ROLE_LABELS: Record<ConversationMessage['role'], string> = {
	user: 'You',
	assistant: 'AI',
	tool: 'Tool',
	system: 'System',
};
const HEADING_LINE_RE = /^## (You|AI|Tool|System)\s*$/;

export class ConversationStore {
	private app: App;
	private plugin: CurtisPlugin | null = null;
	private conversations = new Map<string, Conversation>();
	private currentConversationId: string | null = null;

	/** conv id → file path in the vault. */
	private paths = new Map<string, string>();
	/** conv ids with unsaved changes. */
	private dirty = new Set<string>();
	/** Per-conv debounce timers for persisted writes. */
	private timers = new Map<string, number>();
	/** Per-conv write queue — serializes persist/rename ops for one file. */
	private queues = new Map<string, Promise<void>>();
	/** Paths we are writing right now — the modify watcher skips these so we
	 *  don't re-parse our own output (same guard as the memory store). */
	private writingPaths = new Set<string>();

	constructor(app: App) {
		this.app = app;
	}

	private resolveFolder(): string {
		const raw = this.plugin?.settings?.conversationsFolder?.trim();
		return raw ? raw.replace(/^\/+|\/+$/g, '') : DEFAULT_CONVERSATIONS_FOLDER;
	}

	// ----------------------------------------------------------------------------
	// Load / import
	// ----------------------------------------------------------------------------

	/** Scan the conversations folder, rebuild the in-memory map, watch for
	 *  hand edits, and import anything still trapped in localStorage. */
	async load(plugin: CurtisPlugin): Promise<void> {
		this.plugin = plugin;
		this.app = plugin.app || this.app;

		await this.ensureFolder();
		await this.scanFolder();
		this.registerFileWatcher();
		await this.importLegacyLocalStorage();
	}

	/** Read every markdown file under the folder; ingest files that carry our
	 *  frontmatter signature. Unrelated notes in the folder are ignored. */
	private async scanFolder(): Promise<void> {
		const folder = this.resolveFolder();
		const prefix = `${folder}/`;
		const files = this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(prefix));
		// Reads are independent — parse concurrently so a large history
		// doesn't serialize into a slow boot.
		const parsed = await Promise.all(files.map((file) => this.parseFile(file)));
		for (let i = 0; i < files.length; i++) {
			const conv = parsed[i];
			if (conv) {
				this.conversations.set(conv.id, conv);
				this.paths.set(conv.id, files[i].path);
			}
		}
	}

	/** One-time migration: localStorage conversations with ids not present in
	 *  the vault are written out as files. Idempotent across boots. */
	private async importLegacyLocalStorage(): Promise<void> {
		let entries: [string, Conversation][] = [];
		try {
			const raw: unknown = this.app.loadLocalStorage(LEGACY_STORAGE_KEY);
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
		try {
			this.plugin?.registerEvent(
				this.app.vault.on('modify', (file) => {
					if (!(file instanceof TFile)) return;
					if (this.writingPaths.has(file.path)) return;
					void this.reloadFile(file);
				})
			);
			this.plugin?.registerEvent(
				this.app.vault.on('rename', (file, oldPath) => {
					if (!(file instanceof TFile)) return;
					const id = this.findByPath(oldPath);
					if (id) this.paths.set(id, file.path);
				})
			);
			this.plugin?.registerEvent(
				this.app.vault.on('delete', (file) => {
					if (!(file instanceof TFile)) return;
					const id = this.findByPath(file.path);
					if (!id) return;
					this.paths.delete(id);
					this.conversations.delete(id);
					if (this.currentConversationId === id) {
						this.currentConversationId = null;
					}
				})
			);
			// The debounced write can lose the last ≤200ms of messages on a fast
			// quit; onunload's fire-and-forget flush races teardown. The quit
			// event is the one hook Obsidian actually awaits.
			this.plugin?.registerEvent(
				this.app.workspace.on('quit', (tasks) => {
					for (const id of Array.from(this.dirty)) {
						this.clearTimer(id);
						tasks.add(() => this.flush(id));
					}
				})
			);
		} catch {
			// registerEvent only valid during plugin load — ignore if called late.
		}
	}

	private findByPath(path: string): string | undefined {
		for (const [id, p] of this.paths) {
			if (p === path) return id;
		}
		return undefined;
	}

	/** Re-read one conversation file after an external modify. Parse failures
	 *  keep the in-memory copy (a transient read must not wipe live state). */
	private async reloadFile(file: TFile): Promise<void> {
		const id = this.findByPath(file.path);
		if (!id) return;
		// A pending debounced write means our in-memory copy is AHEAD of the
		// disk — replacing it with the on-disk copy (and clearing the dirty
		// flag) would silently drop just-added messages. Let the flush land.
		if (this.dirty.has(id)) return;
		const conv = await this.parseFile(file);
		if (conv && conv.id === id) {
			this.conversations.set(id, conv);
			this.dirty.delete(id);
		}
	}

	// ----------------------------------------------------------------------------
	// Public API (synchronous — writes are debounced to the vault)
	// ----------------------------------------------------------------------------

	createConversation(provider: string, model: string): Conversation {
		const id = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
		const now = Date.now();
		const conv: Conversation = {
			id,
			title: 'New chat',
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

		// Auto-title from first user message
		if (conv.title === 'New chat' && message.role === 'user') {
			conv.title = (typeof message.content === 'string' ? message.content : '').slice(0, 50);
		}

		this.markDirty(conv.id);
		return fullMessage;
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
		if (path) {
			void this.enqueue(id, async () => {
				const file = this.app.vault.getAbstractFileByPath(path);
				if (file instanceof TFile) {
					try {
						// FileManager.trashFile honors the user's deletion
						// preference (system trash vs .trash folder).
						await this.app.fileManager.trashFile(file);
					} catch (e) {
						console.error('[Curtis] Failed to trash conversation file:', e);
					}
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
		this.markDirty(conv.id);
		return true;
	}

	/**
	 * Drop every message AFTER the one with `messageId` (the matched message
	 * stays). Used by edit-resend (truncate after the edited user msg before
	 * re-streaming). Returns the number of messages removed.
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
		this.markDirty(conv.id);
		return removed;
	}

	/**
	 * Drop the message with `messageId` AND everything after it. Used by
	 * regenerate (the dropped assistant message is re-streamed fresh).
	 * Returns the number of messages removed.
	 */
	truncateFromMessage(messageId: string): number {
		const conv = this.getCurrentConversation();
		if (!conv) return 0;
		const idx = conv.messages.findIndex((m) => m.id === messageId);
		if (idx === -1) return 0;
		const removed = conv.messages.length - idx;
		conv.messages = conv.messages.slice(0, idx);
		conv.updatedAt = Date.now();
		this.markDirty(conv.id);
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
		this.markDirty(conv.id);
		return true;
	}

	/** Rename the current conversation. The file is retitled to match. */
	renameCurrentConversation(title: string): void {
		const conv = this.getCurrentConversation();
		if (!conv) return;
		conv.title = title;
		conv.updatedAt = Date.now();
		this.markDirty(conv.id);
	}

	/** Schedule a debounced vault write for the given conversation. */
	private markDirty(id: string): void {
		this.dirty.add(id);
		this.clearTimer(id);
		this.timers.set(
			id,
			window.setTimeout(() => {
				this.timers.delete(id);
				void this.flush(id);
			}, 200)
		);
	}

	private clearTimer(id: string): void {
		const t = this.timers.get(id);
		if (t) {
			window.clearTimeout(t);
			this.timers.delete(id);
		}
	}

	/** Legacy no-op kept for call sites that treated the store as
	 *  explicitly-saved; with vault files every mutation persists itself. */
	save(): void {
		for (const id of Array.from(this.dirty)) {
			this.clearTimer(id);
			void this.flush(id);
		}
	}

	// ----------------------------------------------------------------------------
	// Vault I/O
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
		await this.ensureFolder();
		const folder = this.resolveFolder();
		const desiredPath = `${folder}/${this.fileNameFor(conv)}`;
		const existingPath = this.paths.get(conv.id);

		let path = existingPath;
		if (!path) {
			path = await this.uniquePath(desiredPath);
		} else if (path !== desiredPath && !(await this.pathTaken(desiredPath))) {
			// Title changed (auto-title or rename) — retitle the file so the
			// vault explorer stays human-browsable.
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) {
				try {
					await this.app.vault.rename(file, desiredPath);
					path = desiredPath;
				} catch (e) {
					console.error('[Curtis] Conversation retitle failed:', e);
					// Keep writing to the old path — the H1 carries the new title.
				}
			}
		}

		this.writingPaths.add(path);
		try {
			// Serialize inside the try — a malformed message (e.g. undefined
			// content from a legacy import) must not reject flush as an
			// unhandled rejection with the dirty flag stranded.
			const body = this.serializeMarkdown(conv);
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) {
				await this.app.vault.modify(file, body);
			} else {
				// A cold-boot index can lag the filesystem; vault.create may
				// then throw "already exists" — the catch below tolerates it.
				await this.app.vault.create(path, body);
			}
			this.paths.set(conv.id, path);
			this.dirty.delete(conv.id);
		} catch (e) {
			// Lost a race with the indexer — fine as long as the file exists.
			const onDisk = await this.app.vault.adapter.exists(path).catch(() => false);
			if (onDisk) {
				this.paths.set(conv.id, path);
				this.dirty.delete(conv.id);
			} else {
				console.error('[Curtis] Conversation persist failed:', e);
				new Notice('Curtis could not save a conversation — history may be stale until the next successful write.');
			}
		} finally {
			window.setTimeout(() => this.writingPaths.delete(path), 0);
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
		if (this.app.vault.getAbstractFileByPath(path)) return true;
		return this.app.vault.adapter.exists(path).catch(() => false);
	}

	private fileNameFor(conv: Conversation): string {
		const d = new Date(conv.createdAt);
		const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
		// Short random tail from the conversation id guarantees uniqueness even
		// when two chats share a title and a creation date.
		const short = conv.id.split('_').pop()?.slice(-6) || conv.id.slice(-6);
		return `${date} ${slugify(conv.title)} ${short}.md`;
	}

	private async ensureFolder(): Promise<void> {
		const folder = this.resolveFolder();
		if (this.app.vault.getAbstractFileByPath(folder)) return;
		if (await this.app.vault.adapter.exists(folder)) return;
		const parts = folder.split('/').filter(Boolean);
		let acc = '';
		for (const p of parts) {
			acc = acc ? `${acc}/${p}` : p;
			if (!this.app.vault.getAbstractFileByPath(acc)) {
				try { await this.app.vault.createFolder(acc); } catch { /* already exists */ }
			}
		}
	}

	// ----------------------------------------------------------------------------
	// Markdown parse / serialize
	// ----------------------------------------------------------------------------

	private async parseFile(file: TFile): Promise<Conversation | null> {
		let raw: string;
		try {
			raw = await this.app.vault.read(file);
		} catch (e) {
			console.error('[Curtis] Failed to read conversation file:', e);
			return null;
		}
		return parseConversationMarkdown(raw, file.stat.mtime);
	}

	private serializeMarkdown(conv: Conversation): string {
		const fm: Record<string, unknown> = {
			curtis: 'conversation',
			id: conv.id,
			created: conv.createdAt,
			updated: conv.updatedAt,
			provider: conv.provider,
			model: conv.model,
		};

		const parts: string[] = [`---\n${stringifyYaml(fm).replace(/\n+$/, '\n')}---`, '', `# ${conv.title}`, ''];
		for (const msg of conv.messages) {
			const meta: Record<string, unknown> = { id: msg.id, ts: msg.timestamp, role: msg.role };
			if (msg.provider) meta.provider = msg.provider;
			if (msg.model) meta.model = msg.model;
			if (msg.cost) meta.cost = msg.cost;
			if (msg.tokens) meta.tokens = msg.tokens;
			if (msg.images && msg.images.length > 0) meta.images = msg.images;
			if (msg.attachedNotes && msg.attachedNotes.length > 0) meta.attachedNotes = msg.attachedNotes;
			if (msg.tool_calls && msg.tool_calls.length > 0) meta.tool_calls = msg.tool_calls;
			if (msg.tool_call_id) meta.tool_call_id = msg.tool_call_id;
			if (msg.tool_error) meta.tool_error = true;
			// Escape the comment terminator so metadata containing "-->"
			// (e.g. tool arguments editing markdown with HTML comments) can't
			// break out of the marker.
			const json = JSON.stringify(meta).replace(/-->/g, '--\\u003E');
			// Likewise, a message body quoting the marker itself would split
			// this message in two on the next parse — neutralize the opener.
			// The zero-width space is invisible and survives round-trips.
			const content = (typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? ''))
				.replace(/<!--\s*curtis:msg/g, '<!--\u200Bcurtis:msg');
			parts.push(
				`## ${ROLE_LABELS[msg.role] ?? 'AI'}`,
				`<!-- curtis:msg ${json} -->`,
				'',
				content.trim(),
				''
			);
		}
		return parts.join('\n');
	}
}

/** Turn a conversation title into a filesystem-safe filename fragment. */
function slugify(title: string): string {
	const cleaned = (title || '')
		.replace(/[\\/:*?"<>|#^[\]]/g, '')
		// eslint-disable-next-line no-control-regex -- strip ASCII control chars that are illegal in filenames
		.replace(/[\x00-\x1f]/g, '')
		.replace(/\s+/g, ' ')
		.replace(/^\.+/, '')
		.trim()
		.replace(/[. ]+$/, '');
	const trimmed = cleaned.length > 60 ? cleaned.slice(0, 60).trim() : cleaned;
	return trimmed || 'Untitled';
}

/**
 * Parse a conversation markdown file into a Conversation.
 *
 * Layout (written by serializeMarkdown; hand edits tolerated):
 *
 *   ---
 *   curtis: conversation
 *   id: conv_...
 *   ...
 *   ---
 *
 *   # Title
 *
 *   ## You
 *   <!-- curtis:msg {"id":"...","ts":...,"role":"user"} -->
 *
 *   message content
 *
 * The marker ends the heading area and opens the message; a message's content
 * runs from the end of its marker to the role heading that precedes the next
 * marker (or EOF). Sections without a marker can't be attributed to a role,
 * so they are not ingested — they stay readable in the file.
 *
 * Returns null when the file isn't a Curtis conversation (no frontmatter
 * signature) or the frontmatter is unreadable.
 */
export function parseConversationMarkdown(raw: string, fallbackMtime: number): Conversation | null {
	const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\s*\n?/);
	if (!fmMatch) return null;
	let fm: Record<string, unknown>;
	try {
		fm = parseYaml(fmMatch[1]) as Record<string, unknown>;
	} catch {
		return null;
	}
	if (!fm || fm.curtis !== 'conversation' || typeof fm.id !== 'string') return null;

	const bodyStart = fmMatch[0].length;
	const body = raw.slice(bodyStart);

	// Locate every message marker.
	MSG_MARKER_RE.lastIndex = 0;
	const markers: Array<{ meta: Record<string, unknown>; start: number; end: number }> = [];
	let m: RegExpExecArray | null;
	while ((m = MSG_MARKER_RE.exec(body)) !== null) {
		try {
			markers.push({ meta: JSON.parse(m[1]) as Record<string, unknown>, start: m.index, end: m.index + m[0].length });
		} catch {
			// Malformed marker — treat as content, not a boundary.
		}
	}

	// Title = first H1 in the region before the first marker.
	const pre = body.slice(0, markers[0]?.start ?? body.length);
	const titleMatch = pre.match(/^# (.+)$/m);
	const title = titleMatch?.[1]?.trim() || 'Untitled';

	// For each marker, the content region ends where the NEXT message's role
	// heading begins. Scan back from the next marker over whitespace; if the
	// line above it is one of our fixed role headings, that heading starts the
	// next block — otherwise the next marker itself is the boundary.
	const messages: ConversationMessage[] = [];
	for (let i = 0; i < markers.length; i++) {
		const { meta } = markers[i];
		const role = readRole(meta.role);
		if (!role) continue;
		let contentEnd = body.length;
		if (i + 1 < markers.length) {
			const next = markers[i + 1].start;
			let j = next;
			while (j > 0 && /[\s]/.test(body[j - 1])) j--;
			const lineStart = body.lastIndexOf('\n', j - 1) + 1;
			const line = body.slice(lineStart, next).trimEnd();
			contentEnd = HEADING_LINE_RE.test(line) ? lineStart : next;
		}
		const content = body.slice(markers[i].end, contentEnd).replace(/^\n+/, '').replace(/\s+$/, '');
		messages.push({
			id: typeof meta.id === 'string' ? meta.id : `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
			role,
			content,
			timestamp: typeof meta.ts === 'number' ? meta.ts : fallbackMtime,
			provider: typeof meta.provider === 'string' ? meta.provider : undefined,
			model: typeof meta.model === 'string' ? meta.model : undefined,
			cost: typeof meta.cost === 'number' ? meta.cost : undefined,
			tokens: isTokenUsage(meta.tokens) ? meta.tokens : undefined,
			images: readStringArray(meta.images),
			attachedNotes: readStringArray(meta.attachedNotes),
			tool_calls: Array.isArray(meta.tool_calls) ? (meta.tool_calls as ConversationMessage['tool_calls']) : undefined,
			tool_call_id: typeof meta.tool_call_id === 'string' ? meta.tool_call_id : undefined,
			tool_error: meta.tool_error === true || undefined,
		});
	}

	const updatedAt = typeof fm.updated === 'number' ? fm.updated : fallbackMtime;
	const created = typeof fm.created === 'number' ? fm.created : updatedAt;
	return {
		id: fm.id,
		title,
		messages,
		createdAt: created,
		updatedAt,
		provider: typeof fm.provider === 'string' ? fm.provider : '',
		model: typeof fm.model === 'string' ? fm.model : '',
	};
}

function readRole(v: unknown): ConversationMessage['role'] | undefined {
	return v === 'user' || v === 'assistant' || v === 'tool' || v === 'system' ? v : undefined;
}

function readStringArray(v: unknown): string[] | undefined {
	if (!Array.isArray(v)) return undefined;
	const arr = v.filter((x): x is string => typeof x === 'string');
	return arr.length > 0 ? arr : undefined;
}

function isTokenUsage(v: unknown): v is TokenUsage {
	if (!v || typeof v !== 'object') return false;
	const o = v as Record<string, unknown>;
	return typeof o.promptTokens === 'number' && typeof o.completionTokens === 'number' && typeof o.totalTokens === 'number';
}
