// VaultVfs — the Obsidian side of the vshell Vfs port (see vshell.ts for the
// boundary rationale). Every operation goes through the official vault API,
// which is what keeps the vault shell permission-free on mobile.

import { App, TAbstractFile, TFile, TFolder } from 'obsidian';
import type { Vfs, VfsEntry } from './vshell';

export class VaultVfs implements Vfs {
	private readonly app: App;

	constructor(app: App) {
		this.app = app;
	}

	private node(path: string): TAbstractFile | null {
		// '' is the root; everything else is a normalized vault path by the
		// time it gets here (vshell resolves first).
		return path === '' ? this.app.vault.getRoot() : this.app.vault.getAbstractFileByPath(path);
	}

	async list(folderPath: string): Promise<VfsEntry[]> {
		const node = this.node(folderPath);
		if (!(node instanceof TFolder)) {
			throw new Error(`not a folder: /${folderPath}`);
		}
		return node.children.map((child) => ({
			name: child.name,
			path: child.path,
			type: child instanceof TFolder ? 'folder' : 'file',
			size: child instanceof TFile ? child.stat.size : 0,
		}));
	}

	async type(path: string): Promise<'file' | 'folder' | null> {
		const node = this.node(path);
		if (!node) return null;
		return node instanceof TFolder ? 'folder' : 'file';
	}

	async read(filePath: string): Promise<string> {
		const node = this.node(filePath);
		if (!(node instanceof TFile)) {
			throw new Error(`no such file: /${filePath}`);
		}
		return this.app.vault.read(node);
	}

	async write(filePath: string, content: string): Promise<void> {
		const node = this.node(filePath);
		if (node instanceof TFile) {
			await this.app.vault.modify(node, content);
		} else {
			await this.app.vault.create(filePath, content);
		}
	}

	async createFolder(folderPath: string): Promise<void> {
		// Throws when the folder exists — vshell's mkdir turns that into the
		// right message for -p vs plain.
		await this.app.vault.createFolder(folderPath);
	}

	async move(from: string, to: string): Promise<void> {
		const node = this.node(from);
		if (!node) throw new Error(`no such path: /${from}`);
		await this.app.vault.rename(node, to);
	}

	async copyFile(from: string, to: string): Promise<void> {
		const node = this.node(from);
		if (!(node instanceof TFile)) throw new Error(`no such file: /${from}`);
		await this.app.vault.copy(node, to);
	}

	async trash(targetPath: string): Promise<void> {
		const node = this.node(targetPath);
		if (!node) throw new Error(`no such path: /${targetPath}`);
		// FileManager.trashFile honors the user's deletion preference
		// (system trash, .trash, or permanent) — same call the conversation
		// store makes.
		await this.app.fileManager.trashFile(node);
	}

	async exists(path: string): Promise<boolean> {
		if (path === '') return true;
		return this.app.vault.adapter.exists(path);
	}
}
