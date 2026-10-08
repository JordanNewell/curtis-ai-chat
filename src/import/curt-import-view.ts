// .curt click-to-import view.
//
// Curtis registers the `curt` extension against this view, so double-clicking
// a .curt file in the vault explorer opens a branded landing page instead of
// Obsidian's "unsupported file" wall. One click imports the conversation into
// the configured conversations folder.

import { TFile, FileView, setIcon, WorkspaceLeaf } from 'obsidian';
import type CurtisPlugin from '../main';
import { CURTIS_ICON_ID } from '../icons';
import { readCurtFile } from './curt';
import { importChats, reportResult } from './importer';

export const CURT_VIEW_TYPE = 'curt-import-view';

export class CurtImportView extends FileView {
	private plugin: CurtisPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: CurtisPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.navigation = false;
	}

	getViewType(): string {
		return CURT_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.file ? `${this.file.basename} (Curtis)` : 'Curtis conversation';
	}

	getIcon(): string {
		return CURTIS_ICON_ID;
	}

	async onLoadFile(file: TFile): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('curt-import-view');

		const conv = await readCurtFile(this.app, file);
		if (!conv) {
			this.contentEl.createDiv({ cls: 'curt-import-error', text: 'This file is not a valid Curtis conversation (.curt) file.' });
			return;
		}
		const card = this.contentEl.createDiv({ cls: 'curt-import-card' });
		const iconEl = card.createDiv({ cls: 'curt-import-icon' });
		setIcon(iconEl, CURTIS_ICON_ID);
		card.createDiv({ cls: 'curt-import-title', text: conv.title });
		const when = conv.createdAt ? new Date(conv.createdAt).toLocaleDateString() : '';
		card.createDiv({
			cls: 'curt-import-meta',
			text: `${conv.messages.length} message${conv.messages.length === 1 ? '' : 's'}${when ? ` · started ${when}` : ''}`,
		});

		const actions = card.createDiv({ cls: 'curt-import-actions' });
		const importBtn = actions.createEl('button', { cls: 'mod-cta', text: 'Import this conversation' });
		importBtn.addEventListener('click', () => {
			void (async () => {
				const summary = await importChats(this.plugin, [
					{ name: file.name, buffer: await this.app.vault.readBinary(file) },
				]);
				reportResult(summary, this.plugin);
				if (summary.totalImported > 0) {
					// The imported copy now lives in the vault as .md; close the
					// import landing page and open the conversation itself.
					await this.leaf.setViewState({ type: 'empty', state: {} });
					void this.plugin.activateChatView();
				}
			})();
		});
		actions.createEl('button', { text: 'Close' }).addEventListener('click', () => {
			void this.leaf.setViewState({ type: 'empty', state: {} });
		});
	}
}
