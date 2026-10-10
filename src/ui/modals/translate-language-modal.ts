// Translate Language Modal — one text field asking for the translate
// action's target language. Resolves null when dismissed without
// committing; the caller persists the committed language as the next prefill.

import { App, Modal, Notice, Setting } from 'obsidian';

export class TranslateLanguageModal extends Modal {
	private language: string;
	private result: string | null = null;
	private onResult: (language: string | null) => void;

	constructor(app: App, initial: string, onResult: (language: string | null) => void) {
		super(app);
		this.language = initial;
		this.onResult = onResult;
		this.setTitle('Translate to…');
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		new Setting(contentEl)
			.setName('Target language')
			.addText((text) => {
				text.setPlaceholder('English')
					.setValue(this.language)
					.onChange((val) => { this.language = val; });
				// One field — Enter commits without reaching for the button.
				text.inputEl.addEventListener('keydown', (evt) => {
					if (evt.key === 'Enter') this.commit();
				});
				text.inputEl.focus();
			});

		new Setting(contentEl)
			.addButton((btn) => btn.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((btn) => btn.setButtonText('Translate').setCta().onClick(() => this.commit()));
	}

	private commit(): void {
		const trimmed = this.language.trim();
		if (!trimmed) {
			new Notice('Enter a target language');
			return;
		}
		this.result = trimmed;
		this.close();
	}

	onClose(): void {
		this.onResult(this.result);
		this.contentEl.empty();
	}
}
