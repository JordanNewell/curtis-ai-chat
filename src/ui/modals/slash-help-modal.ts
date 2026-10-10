import { App, Modal, prepareFuzzySearch } from 'obsidian';
import { SLASH_COMMANDS } from '../../chat/slash-commands';

/** Modal listing all slash commands. Opened by `/help`. */
export class SlashHelpModal extends Modal {
	/** Command rows with the text fuzzy matching runs against. */
	private rows: Array<{ el: HTMLElement; text: string }> = [];

	constructor(app: App) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText('Slash commands');

		const filter = this.contentEl.createEl('input', {
			cls: 'ai-slash-help-filter',
			type: 'text',
			placeholder: 'Filter commands...',
		});
		const list = this.contentEl.createDiv({ cls: 'ai-slash-help-list' });
		const emptyState = list.createDiv({
			cls: 'ai-slash-help-empty',
			text: 'No matching commands',
		});
		emptyState.hide();

		for (const cmd of SLASH_COMMANDS) {
			const row = list.createDiv({ cls: 'ai-slash-help-row' });
			row.createEl('code', { text: cmd.usage });
			row.createDiv({ cls: 'ai-slash-help-desc', text: cmd.description });
			this.rows.push({ el: row, text: `${cmd.usage} ${cmd.description}` });
		}

		filter.addEventListener('input', () => {
			const query = filter.value.trim();
			const match = query ? prepareFuzzySearch(query) : null;
			let visible = 0;
			for (const row of this.rows) {
				const show = match === null || match(row.text) !== null;
				row.el.toggle(show);
				if (show) visible++;
			}
			emptyState.toggle(visible === 0);
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
