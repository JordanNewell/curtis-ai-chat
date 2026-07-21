import { App, Modal } from 'obsidian';
import { SLASH_COMMANDS } from '../../chat/slash-commands';

/** Modal listing all slash commands. Opened by `/help`. */
export class SlashHelpModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText('Slash Commands');
		const list = this.contentEl.createDiv({ cls: 'ai-slash-help-list' });
		for (const cmd of SLASH_COMMANDS) {
			const row = list.createDiv({ cls: 'ai-slash-help-row' });
			row.createEl('code', { text: cmd.usage });
			row.createDiv({ cls: 'ai-slash-help-desc', text: cmd.description });
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
