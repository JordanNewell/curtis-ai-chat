// Custom Action Editor Modal — form for adding/editing user-defined
// selection actions. Mirrors CustomProviderModal: validate on submit, hand
// the record back to the caller (settings owns persistence and the id
// uniqueness set).

import { App, Modal, Setting } from 'obsidian';
import type { CustomSelectionAction } from '../../types';
import { SELECTION_TEMPLATE_TOKEN, sanitizeCustomActionId } from '../../commands/selection';

export class CustomActionEditorModal extends Modal {
	private name = '';
	private systemPrompt = '';
	private userPromptTemplate = '';
	private insertMode: CustomSelectionAction['insertMode'] = 'replace';
	private onSubmit: (action: CustomSelectionAction) => void;
	private existing?: CustomSelectionAction;
	private takenIds: ReadonlySet<string>;
	private errorEl: HTMLElement | null = null;

	constructor(
		app: App,
		onSubmit: (action: CustomSelectionAction) => void,
		existing?: CustomSelectionAction,
		takenIds: ReadonlySet<string> = new Set()
	) {
		super(app);
		this.onSubmit = onSubmit;
		this.existing = existing;
		this.takenIds = takenIds;
		if (existing) {
			this.name = existing.name;
			this.systemPrompt = existing.systemPrompt;
			this.userPromptTemplate = existing.userPromptTemplate;
			this.insertMode = existing.insertMode;
		}
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: this.existing ? 'Edit custom action' : 'New custom action' });

		new Setting(contentEl)
			.setName('Name')
			.setDesc('Shown in the context menu, command palette and hotkeys list')
			.addText((t) => {
				t.setPlaceholder('Pirate speak')
					.setValue(this.name)
					.onChange((v) => (this.name = v));
			});

		new Setting(contentEl)
			.setName('System prompt')
			.setDesc('How the model should behave for this action')
			.addTextArea((t) => {
				t.setPlaceholder('Rewrite everything in pirate speak. Output only the rewritten text.')
					.setValue(this.systemPrompt)
					.onChange((v) => (this.systemPrompt = v));
				t.inputEl.rows = 3;
			});

		new Setting(contentEl)
			.setName('User prompt template')
			.setDesc(`The request sent with the selection. Use ${SELECTION_TEMPLATE_TOKEN} where the selected text goes; without it the selection is not sent.`)
			.addTextArea((t) => {
				t.setPlaceholder(`Rewrite the following in pirate speak:\n\n${SELECTION_TEMPLATE_TOKEN}`)
					.setValue(this.userPromptTemplate)
					.onChange((v) => (this.userPromptTemplate = v));
				t.inputEl.rows = 4;
			});

		new Setting(contentEl)
			.setName('Insert mode')
			.setDesc('Replace runs the result through the diff review modal; insert-below appends it under the selection')
			.addDropdown((dd) => {
				dd.addOption('replace', 'Replace selection (review diff first)');
				dd.addOption('insert-below', 'Insert below selection');
				dd.setValue(this.insertMode);
				dd.onChange((v) => (this.insertMode = v as CustomSelectionAction['insertMode']));
			});

		const buttonRow = contentEl.createDiv({ cls: 'ai-modal-button-row' });
		const cancelBtn = buttonRow.createEl('button', { text: 'Cancel', cls: 'ai-modal-btn-secondary' });
		cancelBtn.addEventListener('click', () => this.close());
		const saveBtn = buttonRow.createEl('button', {
			text: this.existing ? 'Save' : 'Add action',
			cls: 'mod-cta ai-modal-btn-primary',
		});
		saveBtn.addEventListener('click', () => this.submit());
	}

	private submit(): void {
		const name = this.name.trim();
		const systemPrompt = this.systemPrompt.trim();
		const userPromptTemplate = this.userPromptTemplate.trim();
		if (!name || !systemPrompt || !userPromptTemplate) {
			this.showError('Name, system prompt and user prompt template are required.');
			return;
		}
		const action: CustomSelectionAction = {
			// Edits keep their id; new actions derive one unique across the
			// built-ins and existing customs (uniqueness set computed by the caller).
			id: this.existing?.id ?? sanitizeCustomActionId(name, this.takenIds),
			name,
			systemPrompt,
			userPromptTemplate,
			insertMode: this.insertMode,
		};
		this.onSubmit(action);
		this.close();
	}

	private showError(message: string): void {
		this.errorEl?.remove();
		this.errorEl = this.contentEl.createEl('p', { cls: 'ai-modal-error', text: message });
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
