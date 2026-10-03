// Edit Fact Modal — edit a single memory fact's content + category.

import { App, Modal, Notice, Setting } from 'obsidian';
import type { MemoryFact } from '../../types';

/** The only categories that round-trip through the memory markdown file. */
const FACT_CATEGORIES = ['preference', 'identity', 'project', 'instruction', 'other'] as const;

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
			.addDropdown((dd) => {
				// Free text here used to be silently lost on round-trip: only
				// these five values survive the memory file's parse/serialize.
				dd.addOption('', 'None');
				for (const c of FACT_CATEGORIES) dd.addOption(c, c);
				dd.setValue(this.category).onChange((val) => { this.category = val; });
			});

		new Setting(contentEl)
			.addButton((btn) => btn.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((btn) => btn.setButtonText('Save').setCta().onClick(() => {
				if (!this.content.trim()) {
					new Notice('Fact content cannot be empty');
					return;
				}
				this.onSave(this.content, this.category);
				this.close();
			}));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
