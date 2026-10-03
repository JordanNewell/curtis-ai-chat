// MCP Server Modal — form for adding/editing MCP server connections.
//
// Curtis speaks the Streamable HTTP transport only. Local stdio servers
// (the `npx some-mcp-server` kind) can be bridged to HTTP with mcp-proxy or
// supergateway — the description hint below says so, because "I have a
// stdio server and the URL field doesn't accept it" is the #1 support
// question this feature will generate.

import { App, Modal, Setting } from 'obsidian';
import type { McpServerConfig } from '../../types';

/** Parse the headers textarea — one `Name: value` per line, `#` comments. */
export function parseHeaderLines(text: string): { name: string; value: string }[] {
	const out: { name: string; value: string }[] = [];
	for (const rawLine of text.split('\n')) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;
		const idx = line.indexOf(':');
		if (idx <= 0) continue;
		const name = line.slice(0, idx).trim();
		const value = line.slice(idx + 1).trim();
		if (name) out.push({ name, value });
	}
	return out;
}

export function formatHeaderLines(headers: { name: string; value: string }[]): string {
	return headers.map((h) => `${h.name}: ${h.value}`).join('\n');
}

export interface McpServerResult {
	config: McpServerConfig;
}

export class McpServerModal extends Modal {
	private name = '';
	private url = '';
	private headersText = '';
	private onSubmit: (result: McpServerResult) => void;
	private existing?: McpServerConfig;
	private errorEl?: HTMLElement;

	constructor(
		app: App,
		onSubmit: (result: McpServerResult) => void,
		existing?: McpServerConfig
	) {
		super(app);
		this.onSubmit = onSubmit;
		this.existing = existing;
		if (existing) {
			this.name = existing.name;
			this.url = existing.url;
			this.headersText = formatHeaderLines(existing.headers);
		}
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: this.existing ? 'Edit MCP server' : 'Add MCP server' });

		new Setting(contentEl)
			.setName('Name')
			.setDesc('Also namespaces its tools: mcp__<name>__<tool>')
			.addText((t) => {
				t.setPlaceholder('My server')
					.setValue(this.name)
					.onChange((v) => (this.name = v));
			});

		new Setting(contentEl)
			.setName('Server URL')
			.setDesc('Streamable HTTP endpoint of the MCP server. For local stdio servers, put mcp-proxy or supergateway in front.')
			.addText((t) => {
				t.setPlaceholder('URL: https://mcp.example.com/mcp')
					.setValue(this.url)
					.onChange((v) => (this.url = v));
			});

		new Setting(contentEl)
			.setName('Headers')
			.setDesc('Optional. One per line, e.g. Authorization: Bearer token. Stored in data.json.')
			.addTextArea((t) => {
				t.setPlaceholder('# Authorization: Bearer <token>')
					.setValue(this.headersText)
					.onChange((v) => (this.headersText = v));
				t.inputEl.rows = 4;
			});

		this.errorEl = contentEl.createEl('p', {
			cls: 'ai-setting-hint ai-form-error',
			text: '',
		});

		const buttonRow = contentEl.createDiv({ cls: 'ai-modal-button-row' });
		const cancelBtn = buttonRow.createEl('button', { text: 'Cancel', cls: 'ai-modal-btn-secondary' });
		cancelBtn.addEventListener('click', () => this.close());
		const saveBtn = buttonRow.createEl('button', {
			text: this.existing ? 'Save' : 'Add server',
			cls: 'mod-cta ai-modal-btn-primary',
		});
		saveBtn.addEventListener('click', () => this.submit());
	}

	private submit(): void {
		const name = this.name.trim();
		const url = this.url.trim();
		if (!name || !url) {
			this.showError('Name and URL are required.');
			return;
		}
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			this.showError('URL is not a valid URL.');
			return;
		}
		if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
			this.showError('URL must start with http:// or https://');
			return;
		}

		const config: McpServerConfig = {
			id: this.existing?.id || `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			name,
			url,
			enabled: this.existing?.enabled ?? true,
			headers: parseHeaderLines(this.headersText),
		};
		this.onSubmit({ config });
		this.close();
	}

	private showError(message: string): void {
		if (this.errorEl) this.errorEl.setText(message);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
