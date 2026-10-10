// GCP Service Account Modal — paste a service-account JSON key.
//
// The key is validated here (parse errors surface before anything is saved)
// and stored by the caller via core/secrets.ts — OS keychain when available,
// plaintext data.json fallback otherwise. The modal never reads the stored
// key back: reopening it shows an empty field, and submitting empty is an
// error rather than a silent clear (removal has its own button).

import { App, Modal, Setting } from 'obsidian';
import { parseServiceAccountJson } from '../../gcp/auth';

export interface GcpServiceAccountResult {
	/** The raw key JSON as pasted. */
	json: string;
	/** project_id from the key — prefills the settings Project ID field. */
	projectId?: string;
}

export class GcpServiceAccountModal extends Modal {
	private json = '';
	private onSubmit: (result: GcpServiceAccountResult) => void;
	private errorEl?: HTMLElement;

	constructor(app: App, onSubmit: (result: GcpServiceAccountResult) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'GCP service account' });

		new Setting(contentEl)
			.setName('Service-account key (JSON)')
			.setDesc('Paste the full contents of a service-account key file. It is stored in the OS keychain when available, plaintext data.json otherwise.')
			.addTextArea((t) => {
				t.setPlaceholder('{\n  "type": "service_account",\n  "project_id": "my-project",\n  ... }')
					.setValue(this.json)
					.onChange((v) => (this.json = v));
				t.inputEl.rows = 10;
				t.inputEl.addClass('ai-json-paste');
			});

		this.errorEl = contentEl.createEl('p', {
			cls: 'ai-setting-hint ai-form-error',
			text: '',
		});

		const buttonRow = contentEl.createDiv({ cls: 'ai-modal-button-row' });
		const cancelBtn = buttonRow.createEl('button', { text: 'Cancel', cls: 'ai-modal-btn-secondary' });
		cancelBtn.addEventListener('click', () => this.close());
		const saveBtn = buttonRow.createEl('button', {
			text: 'Save key',
			cls: 'mod-cta ai-modal-btn-primary',
		});
		saveBtn.addEventListener('click', () => this.submit());
	}

	private submit(): void {
		const text = this.json.trim();
		if (!text) {
			this.showError('Paste the service-account key JSON.');
			return;
		}
		let parsed;
		try {
			parsed = parseServiceAccountJson(text);
		} catch (e) {
			this.showError(e instanceof Error ? e.message : String(e));
			return;
		}
		this.onSubmit({ json: text, projectId: parsed.projectId || undefined });
		this.close();
	}

	private showError(message: string): void {
		if (this.errorEl) this.errorEl.setText(message);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
