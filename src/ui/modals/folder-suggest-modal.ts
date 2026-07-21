import { App, FuzzySuggestModal, TFolder } from 'obsidian';

/**
 * Modal that lets the user pick any folder (including the vault root) for a
 * setting. Returns the chosen folder path (empty string for root).
 */
export class FolderSuggestModal extends FuzzySuggestModal<TFolder | null> {
	private onChoose: (folderPath: string) => void;

	constructor(app: App, onChoose: (folderPath: string) => void) {
		super(app);
		this.onChoose = onChoose;
		this.setPlaceholder('Pick a folder (type to filter, Esc to use vault root)');
		this.setTitle('Choose folder');
	}

	getItems(): (TFolder | null)[] {
		// null entry at top == vault root
		return [null, ...this.app.vault.getAllLoadedFiles().filter((f): f is TFolder => f instanceof TFolder)];
	}

	getItemText(item: TFolder | null): string {
		return item ? item.path : '/';
	}

	renderSuggestion(item: import('obsidian').FuzzyMatch<TFolder | null>, el: HTMLElement): void {
		el.empty();
		el.createDiv({ text: item.item ? item.item.path : '/' });
		el.createDiv({ cls: 'ai-setting-hint', text: item.item ? 'folder' : 'vault root' });
	}

	onChooseItem(item: TFolder | null): void {
		this.onChoose(item ? item.path : '');
	}
}
