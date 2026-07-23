import { App, Modal, Setting } from 'obsidian';
import { diffLines } from '../../utils/diff';

export class DiffRewriteModal extends Modal {
	private original: string;
	private modified: string;
	private onAccept: (modified: string) => void;

	constructor(app: App, original: string, modified: string, onAccept: (modified: string) => void) {
		super(app);
		this.original = original;
		this.modified = modified;
		this.onAccept = onAccept;
		this.setTitle('AI rewrite — review changes');
		// Size the modal via CSS class (avoids direct style assignment per
		// Obsidian lint rule obsidianmd/no-static-style-assignment).
		this.modalEl.addClass('ai-diff-rewrite-modal');
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		const diffContainer = contentEl.createDiv({ cls: 'ai-diff-container' });
		const diff = diffLines(this.original, this.modified);

		// Group consecutive added/removed pairs into diff blocks
		for (const line of diff) {
			const row = diffContainer.createDiv({ cls: `ai-diff-line ai-diff-${line.type}` });
			const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
			row.createEl('span', { cls: 'ai-diff-prefix', text: prefix });
			row.createEl('span', { cls: 'ai-diff-text', text: line.text || ' ' });
		}

		new Setting(contentEl)
			.addButton((btn) => btn.setButtonText('Reject').onClick(() => this.close()))
			.addButton((btn) => btn.setButtonText('Accept').setCta().onClick(() => {
				this.onAccept(this.modified);
				this.close();
			}));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
