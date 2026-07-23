// Edit Fact Modal — edit a single memory fact's content + category.

import { App, Modal, Setting } from 'obsidian';
import type { MemoryFact } from '../../types';

export class EditFactModal extends Modal {
	private fact: MemoryFact;
	private onSave: (content: string, category: string) => void;
	private content: string;
	private category: string;

	constructor(app: App, fact: MemoryFact, onSave: (content: string, category: string) => void) {
		super(app);
		this.fact = fact;
		this.onSave = onSave;
		this.content = fact.content;
		this.category = fact.category || '';
		this.setTitle('Edit memory fact');
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		new Setting(contentEl)
			.setName('Fact')
			.addTextArea((text) => {
				text.setValue(this.content)
					.onChange((val) => { this.content = val; });
				text.inputEl.rows = 4;
				text.inputEl.cols = 50;
			});

		new Setting(contentEl)
			.setName('Category')
			.setDesc('Optional — used for grouping')
			.addText((text) => {
				text.setPlaceholder('preference / identity / project / instruction / other')
					.setValue(this.category)
					.onChange((val) => { this.category = val; });
			});

		new Setting(contentEl)
			.addButton((btn) => btn.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((btn) => btn.setButtonText('Save').setCta().onClick(() => {
				this.onSave(this.content, this.category);
				this.close();
			}));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
