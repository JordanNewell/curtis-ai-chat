// Custom Provider Modal — form for adding/editing user-defined OpenAI-compatible endpoints.
// Covers Ollama, LM Studio, LiteLLM, Novita, DeepInfra, Requesty, AIMLAPI, Portkey,
// Helicone, self-hosted llama.cpp, and any future OpenAI-compat service.

import { App, Modal, Setting } from 'obsidian';
import type { ProviderDefinition, AuthType } from '../../types';

export interface CustomProviderResult {
	definition: ProviderDefinition;
	apiKey: string;
}

export class CustomProviderModal extends Modal {
	private name = '';
	private endpoint = '';
	private authType: AuthType = 'bearer';
	private apiKey = '';
	private defaultModel = '';
	private onSubmit: (result: CustomProviderResult) => void;
	private existing?: ProviderDefinition;

	constructor(
		app: App,
		onSubmit: (result: CustomProviderResult) => void,
		existing?: ProviderDefinition,
		existingKey?: string
	) {
		super(app);
		this.onSubmit = onSubmit;
		this.existing = existing;
		if (existing) {
			this.name = existing.name;
			this.endpoint = existing.endpoint;
			this.authType = existing.authType;
			if (existingKey) this.apiKey = existingKey;
			this.defaultModel = existing.models[0]?.id || '';
		}
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: this.existing ? 'Edit custom provider' : 'Add custom provider' });

		new Setting(contentEl)
			.setName('Display name')
			.setDesc('Shown in the provider list and model selector')
			.addText((t) => {
				t.setPlaceholder('My Local LLM')
					.setValue(this.name)
					.onChange((v) => (this.name = v));
			});

		new Setting(contentEl)
			.setName('Endpoint URL')
			.setDesc('Full chat-completions URL, e.g. https://api.example.com/v1/chat/completions')
			.addText((t) => {
				t.setPlaceholder('https://.../v1/chat/completions')
					.setValue(this.endpoint)
					.onChange((v) => (this.endpoint = v));
			});

		new Setting(contentEl)
			.setName('Authentication')
			.setDesc('Bearer token (most providers) or None (local servers)')
			.addDropdown((dd) => {
				dd.addOption('bearer', 'API key (Bearer)');
				dd.addOption('none', 'None (no auth)');
				dd.setValue(this.authType);
				dd.onChange((v) => (this.authType = v as AuthType));
			});

		new Setting(contentEl)
			.setName('API key')
			.setDesc('Leave blank for no-auth providers')
			.addText((t) => {
				t.inputEl.type = 'password';
				t.setPlaceholder('sk-...')
					.setValue(this.apiKey)
					.onChange((v) => (this.apiKey = v));
			});

		new Setting(contentEl)
			.setName('Default model')
			.setDesc('Optional. Most providers expose /v1/models — leave blank to auto-discover.')
			.addText((t) => {
				t.setPlaceholder('llama3.1, gpt-4o, my-model-id')
					.setValue(this.defaultModel)
					.onChange((v) => (this.defaultModel = v));
			});

		const buttonRow = contentEl.createDiv({ cls: 'ai-modal-button-row' });
		const cancelBtn = buttonRow.createEl('button', { text: 'Cancel', cls: 'ai-modal-btn-secondary' });
		cancelBtn.addEventListener('click', () => this.close());
		const saveBtn = buttonRow.createEl('button', {
			text: this.existing ? 'Save' : 'Add provider',
			cls: 'mod-cta ai-modal-btn-primary',
		});
		saveBtn.addEventListener('click', () => this.submit());
	}

	private submit(): void {
		if (!this.name.trim() || !this.endpoint.trim()) return;

		const id = this.existing?.id || `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const models = this.defaultModel.trim()
			? [{ id: this.defaultModel.trim(), name: this.defaultModel.trim(), contextLength: 0, inputPrice: 0, outputPrice: 0 }]
			: [];

		const definition: ProviderDefinition = {
			id,
			name: this.name.trim(),
			endpoint: this.endpoint.trim(),
			authType: this.authType,
			models,
			autoDiscoverModels: true,
		};

		this.onSubmit({ definition, apiKey: this.apiKey });
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
