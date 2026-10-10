// Rename Conversation Modal — one field. Retails nothing itself: the
// callback routes through ConversationStore.renameCurrentConversation so the
// vault file retitles and every pane bound to the conversation updates.

import { App, Modal, Notice, Setting } from 'obsidian';

export class RenameConversationModal extends Modal {
	private initialTitle: string;
	private title: string;
	private onRename: (title: string) => void;

	constructor(app: App, title: string, onRename: (title: string) => void) {
		super(app);
		this.initialTitle = title;
		this.title = title;
		this.onRename = onRename;
		this.setTitle('Rename conversation');
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		new Setting(contentEl)
			.setName('Title')
			.addText((text) => {
				text.setValue(this.title).onChange((val) => { this.title = val; });
				// One field — Enter commits without reaching for the button.
				text.inputEl.addEventListener('keydown', (evt) => {
					if (evt.key === 'Enter') this.commit();
				});
				text.inputEl.focus();
			});

		new Setting(contentEl)
			.addButton((btn) => btn.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((btn) => btn.setButtonText('Rename').setCta().onClick(() => this.commit()));
	}

	private commit(): void {
		const trimmed = this.title.trim();
		if (!trimmed) {
			new Notice('Title cannot be empty');
			return;
		}
		if (trimmed !== this.initialTitle) this.onRename(trimmed);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
