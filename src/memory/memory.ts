// Long-term memory store — markdown-file-backed, full-injection recall.
//
// Design (lifted from obsidian-copilot's user-memory layer, see _research/):
//   - Facts live in a user-visible bullet-list markdown file in the vault
//     (default "AI/Curtis Memory.md"). One bullet per fact, with hidden
//     HTML-comment metadata (id + updatedAt) so the file reads cleanly.
//   - Capture is LLM-gated (auto mode) or user-driven (manual). Both go
//     through the same addFact API.
//   - Recall is trivial — full injection. Because capture is signal-gated,
//     the fact set stays small enough that retrieval would be wasted work.
//   - Cache in memory; rebuild on Obsidian modify events for the memory file
//     so hand-edits show up on the next prompt.

import { App, Notice, TFile } from 'obsidian';
import type { MemoryFact } from '../types';
import type CurtisPlugin from '../main';

const DEFAULT_MEMORY_PATH = 'AI/Curtis Memory.md';

export class MemoryStore {
	private app: App;
	private plugin!: CurtisPlugin;
	private facts: MemoryFact[] = [];
	/** Path of the markdown file — pulled from settings lazily to avoid cycle. */
	private filePath: string = DEFAULT_MEMORY_PATH;

	constructor(app: App) {
		this.app = app;
	}

	/** Resolve the configured file path. */
	private resolvePath(): string {
		return this.plugin?.settings?.memoryFilePath?.trim() || DEFAULT_MEMORY_PATH;
	}

	async load(plugin: CurtisPlugin): Promise<void> {
		this.plugin = plugin;
		this.app = plugin.app || this.app;
		this.filePath = this.resolvePath();
		await this.ensureFile();
		await this.reload(plugin);
		this.registerFileWatcher();
	}

	/** Re-read the file from disk and rebuild the in-memory cache. */
	async reload(plugin?: CurtisPlugin): Promise<void> {
		if (plugin) {
			this.plugin = plugin;
			this.app = plugin.app || this.app;
		}
		this.filePath = this.resolvePath();
		const file = this.app.vault.getAbstractFileByPath(this.filePath);
		if (!(file instanceof TFile)) {
			this.facts = [];
			return;
		}
		try {
			const raw = await this.app.vault.read(file);
			this.facts = this.parseMarkdown(raw);
		} catch (e) {
			console.error('[Curtis] Memory reload failed:', e);
			this.facts = [];
		}
	}

	/** Make sure the memory file exists so users can find & open it. */
	async ensureFile(): Promise<void> {
		if (!this.app) return;
		this.filePath = this.resolvePath();
		const existing = this.app.vault.getAbstractFileByPath(this.filePath);
		if (existing instanceof TFile) return;
		// Create folder chain.
		const folder = this.filePath.includes('/') ? this.filePath.slice(0, this.filePath.lastIndexOf('/')) : '';
		if (folder) {
			const parts = folder.split('/').filter(Boolean);
			let acc = '';
			for (const p of parts) {
				acc = acc ? `${acc}/${p}` : p;
				if (!this.app.vault.getAbstractFileByPath(acc)) {
					try { await this.app.vault.createFolder(acc); } catch { /* already exists */ }
				}
			}
		}
		await this.app.vault.create(
			this.filePath,
			'# Curtis Memory\n\nLong-term facts about the user, captured during chat and editable by hand. Delete a line to forget; edit a line to correct.\n\n'
		);
	}

	/** Backwards-compat with main.ts unload. */
	async save(_plugin?: CurtisPlugin): Promise<void> {
		// Storage is the markdown file; persist() handles writes. No-op here.
	}

	/** Set while WE are writing the file — used by the watcher to skip the
	 *  self-triggered modify event so we don't re-parse what we just wrote. */
	private writing = false;

	private registerFileWatcher(): void {
		if (!this.app) return;
		try {
			this.plugin.registerEvent(
				this.app.vault.on('modify', (file) => {
					if (this.writing) return; // ignore our own writes
					if (file instanceof TFile && file.path === this.filePath) {
						void this.reload();
					}
				})
			);
		} catch {
			// registerEvent only valid during plugin load — ignore if called late.
		}
	}

	// ----------------------------------------------------------------------------
	// Public API
	// ----------------------------------------------------------------------------

	/** All cached facts. */
	getFacts(): MemoryFact[] {
		return this.facts;
	}

	/** Add a fact, dedupe against existing, persist. */
	async addFact(content: string, category?: string): Promise<MemoryFact | null> {
		const trimmed = content.trim();
		if (!trimmed) return null;
		// Trivial dedupe — exact content match (case-insensitive).
		const exists = this.facts.find((f) => f.content.toLowerCase() === trimmed.toLowerCase());
		if (exists) {
			exists.content = trimmed;
			exists.timestamp = Date.now();
			exists.lastAccessed = Date.now();
			await this.persist();
			return exists;
		}
		const fact: MemoryFact = {
			id: cryptoId(),
			content: trimmed,
			category,
			timestamp: Date.now(),
			accessCount: 0,
			lastAccessed: Date.now(),
		};
		this.facts.push(fact);
		await this.persist();
		return fact;
	}

	/** Remove a fact by id. */
	async deleteFact(id: string): Promise<boolean> {
		const idx = this.facts.findIndex((f) => f.id === id);
		if (idx === -1) return false;
		this.facts.splice(idx, 1);
		await this.persist();
		return true;
	}

	/** Edit a fact's content (and optionally its category) by id. */
	async updateFact(id: string, content: string, category?: string): Promise<MemoryFact | null> {
		const fact = this.facts.find((f) => f.id === id);
		if (!fact) return null;
		const trimmed = content.trim();
		if (!trimmed) return null;
		fact.content = trimmed;
		if (category !== undefined) fact.category = category;
		fact.timestamp = Date.now();
		fact.lastAccessed = Date.now();
		await this.persist();
		return fact;
	}

	/** Remove every fact (the file is reset to its header). */
	async clear(): Promise<void> {
		this.facts = [];
		await this.persist();
		new Notice('Memory cleared');
	}

	/** Render facts as a markdown block suitable for the system prompt. */
	formatFactsForPrompt(): string {
		if (this.facts.length === 0) return '';
		const lines = this.facts.map((f) => {
			const cat = f.category ? ` [${f.category}]` : '';
			return `- ${f.content}${cat}`;
		});
		return `## What you know about the user\n${lines.join('\n')}`;
	}

	// ----------------------------------------------------------------------------
	// Markdown parse / serialize
	// ----------------------------------------------------------------------------

	/**
	 * Parse bullet lines of the form:
	 *   - Some durable fact [category] <!-- id:abc updated:1700000000 -->
	 *
	 * The category must be one of the known enum values, so arbitrary
	 * bracketed text in the fact body (e.g. wikilinks like [[Topic]]) is NOT
	 * mis-classified as a category. The HTML comment is split off first to
	 * anchor the rest of the parse to "the trailing bracket before the comment".
	 */
	private parseMarkdown(raw: string): MemoryFact[] {
		const facts: MemoryFact[] = [];
		const validCats = new Set(['preference', 'identity', 'project', 'instruction', 'other']);
		const lines = raw.split('\n');
		for (const line of lines) {
			// 1. Strip the trailing HTML comment (if any) so the rest of the
			//    regex doesn't have to deal with it.
			let id: string | undefined;
			let updated: number = Date.now();
			let body: string = String(line);
			const metaMatch: RegExpMatchArray | null = body.match(/<!--\s*id:([^\s]+)\s+updated:(\d+)\s*-->\s*$/);
			if (metaMatch) {
				const groups: string[] = Array.from(metaMatch);
				id = groups[1] ?? '';
				updated = parseInt(groups[2] ?? '0', 10);
				const matchIndex = metaMatch.index;
				const idx: number = typeof matchIndex === 'number' ? matchIndex : 0;
				const sliced: string = body.slice(0, idx);
				body = sliced.replace(/\s+$/, '');
			}
			// 2. Bullet marker.
			const bulletMatch = body.match(/^\s*[-*]\s+(.+)$/);
			if (!bulletMatch) continue;
			const bulletGroups: string[] = bulletMatch;
			let text = (bulletGroups[1] ?? '').trim();
			// 3. Trailing [category] — ONLY if it's a valid category value.
			let category: string | undefined;
			const catMatch = text.match(/\s\[([^\]]+)\]\s*$/);
			if (catMatch) {
				const catGroups: string[] = catMatch;
				const catValue = (catGroups[1] ?? '').trim();
				if (validCats.has(catValue)) {
					category = catValue;
					const catIdx = catMatch.index;
					text = text.slice(0, typeof catIdx === 'number' ? catIdx : text.length).trim();
				}
			}
			if (!text) continue;
			facts.push({
				id: id || cryptoId(),
				content: text,
				category,
				timestamp: updated,
				accessCount: 0,
				lastAccessed: updated,
			});
		}
		return facts;
	}

	private async persist(): Promise<void> {
		if (!this.app) return;
		await this.ensureFile();
		const file = this.app.vault.getAbstractFileByPath(this.filePath);
		if (!(file instanceof TFile)) return;
		const body = this.serializeMarkdown();
		// Guard against the modify event we're about to trigger ourselves —
		// without this, persist → modify → reload re-parses what we just
		// serialized, which can drop facts whose content has bracketed text.
		this.writing = true;
		try {
			await this.app.vault.modify(file, body);
		} catch (e) {
			console.error('[Curtis] Memory persist failed:', e);
		} finally {
			// Release on the next microtask so the modify event (which fires
			// synchronously after vault.modify resolves) is caught by the guard.
			window.setTimeout(() => { this.writing = false; }, 0);
		}
	}

	private serializeMarkdown(): string {
		const header = '# Curtis Memory\n\nLong-term facts about the user, captured during chat and editable by hand. Delete a line to forget; edit a line to correct.\n\n';
		if (this.facts.length === 0) return header;
		const bullets = this.facts
			.map((f) => {
				const cat = f.category ? ` [${f.category}]` : '';
				const meta = ` <!-- id:${f.id} updated:${f.timestamp} -->`;
				return `- ${f.content}${cat}${meta}`;
			})
			.join('\n');
		return header + bullets + '\n';
	}
}

function cryptoId(): string {
	try {
		// Obsidian desktop — crypto.randomUUID available
		if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
			return crypto.randomUUID();
		}
	} catch {
		// fall through to manual ID
	}
	return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
