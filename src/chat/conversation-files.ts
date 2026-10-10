// Storage port for conversation files, plus the Obsidian (vault) adapter.
//
// ConversationStore orchestrates (in-memory map, write queues, debounce, the
// boot-race scan) against the ConversationFiles port — never against the
// Obsidian API directly — so the store runs under plain node and the separate
// Curtis AI Porter repo can bind the same orchestration to node:fs. This file
// is the only place that knows about the vault; node hosts write their own
// ConversationFiles (and pass `watch`/`onQuit` as no-ops or fs.watch).

import { App, Plugin, TFile, parseYaml, stringifyYaml } from 'obsidian';
import type { YamlPort } from './conversation-format';

/** The Obsidian yaml codec — Obsidian's parseYaml/stringifyYaml pair, as one
 *  YamlPort. Every Obsidian-side consumer (store load, importers) shares it. */
export const vaultYamlPort: YamlPort = { parse: parseYaml, dump: stringifyYaml };

export interface ConversationFileMeta {
	path: string;
	mtime: number;
}

export interface ConversationFileWatchers {
	/** A tracked file was modified outside a store write (path, new mtime). */
	onModify(path: string, mtime: number): void;
	/** A tracked file moved on disk. */
	onRename(path: string, oldPath: string): void;
	/** A tracked file was removed. */
	onDelete(path: string): void;
}

export interface ConversationFiles {
	/** Conversation .md files per the host's (possibly lagging) index —
	 *  Obsidian's vault tree can trail the filesystem on a cold boot. */
	listIndexedMarkdown(folder: string): Promise<ConversationFileMeta[]>;
	/** Ground-truth listing of the folder on disk; [] when unreadable. */
	listDiskMarkdown(folder: string): Promise<string[]>;
	/** Read a file as text. Rejects when missing/unreadable. */
	read(path: string): Promise<string>;
	/** Create or overwrite a file. Tolerates a lagging index (create when the
	 *  index doesn't know the file yet must not throw "already exists" past
	 *  the caller — the caller treats a throw + exists() as success). */
	write(path: string, body: string): Promise<void>;
	/** Move/rename a file. Rejects when the source is missing. */
	rename(from: string, to: string): Promise<void>;
	/** Delete to the host's trash (recoverable). No-op when missing. */
	trash(path: string): Promise<void>;
	/** Does a file or folder exist? Checks the index AND the disk. */
	exists(path: string): Promise<boolean>;
	/** Ensure a folder (and parents) exists. */
	ensureFolder(folder: string): Promise<void>;
	/** Watch for changes outside the store's own writes. */
	watch(watchers: ConversationFileWatchers): void;
	/** Register a last-chance flush — the one hook the Obsidian host awaits
	 *  on quit (the debounced write can lose the tail of a fast quit). */
	onQuit(hook: () => Promise<void>): void;
	/** Legacy pre-1.3 localStorage read. Null when absent or unavailable. */
	loadLegacyStorage(key: string): unknown;
}

/** Obsidian binding: vault + adapter + file manager, watching via plugin events. */
export class VaultConversationFiles implements ConversationFiles {
	constructor(private app: App, private plugin: Plugin) {}

	async listIndexedMarkdown(folder: string): Promise<ConversationFileMeta[]> {
		const prefix = `${folder}/`;
		return this.app.vault
			.getMarkdownFiles()
			.filter((f) => f.path.startsWith(prefix))
			.map((f) => ({ path: f.path, mtime: f.stat.mtime }));
	}

	async listDiskMarkdown(folder: string): Promise<string[]> {
		try {
			const listing = await this.app.vault.adapter.list(folder);
			return listing.files.filter((f) => f.endsWith('.md'));
		} catch {
			return [];
		}
	}

	async read(path: string): Promise<string> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) throw new Error(`Not a vault file: ${path}`);
		return this.app.vault.read(file);
	}

	async write(path: string, body: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			await this.app.vault.modify(file, body);
		} else {
			// A cold-boot index can lag the filesystem; vault.create may then
			// throw "already exists" — the caller tolerates it via exists().
			await this.app.vault.create(path, body);
		}
	}

	async rename(from: string, to: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(from);
		if (!(file instanceof TFile)) throw new Error(`Not a vault file: ${from}`);
		await this.app.vault.rename(file, to);
	}

	async trash(path: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		// FileManager.trashFile honors the user's deletion preference
		// (system trash vs .trash folder).
		await this.app.fileManager.trashFile(file);
	}

	async exists(path: string): Promise<boolean> {
		if (this.app.vault.getAbstractFileByPath(path)) return true;
		return this.app.vault.adapter.exists(path).catch(() => false);
	}

	async ensureFolder(folder: string): Promise<void> {
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

	watch(watchers: ConversationFileWatchers): void {
		try {
			this.plugin.registerEvent(
				this.app.vault.on('modify', (file) => {
					if (!(file instanceof TFile)) return;
					watchers.onModify(file.path, file.stat.mtime);
				})
			);
			this.plugin.registerEvent(
				this.app.vault.on('rename', (file, oldPath) => {
					if (!(file instanceof TFile)) return;
					watchers.onRename(file.path, oldPath);
				})
			);
			this.plugin.registerEvent(
				this.app.vault.on('delete', (file) => {
					if (!(file instanceof TFile)) return;
					watchers.onDelete(file.path);
				})
			);
		} catch {
			// registerEvent only valid during plugin load — ignore if called late.
		}
	}

	onQuit(hook: () => Promise<void>): void {
		try {
			this.plugin.registerEvent(
				this.app.workspace.on('quit', (tasks) => {
					tasks.add(hook);
				})
			);
		} catch {
			// registerEvent only valid during plugin load — ignore if called late.
		}
	}

	loadLegacyStorage(key: string): unknown {
		return this.app.loadLocalStorage(key);
	}
}
