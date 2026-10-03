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
		this.setPlaceholder('Pick a folder (type to filter, esc to use vault root)');
		this.setTitle('Choose folder');
	}

	getItems(): (TFolder | null)[] {
		// null entry at top == vault root. getAllLoadedFiles() also returns the
		// root TFolder itself (path '/') — that duplicate row would hand back
		// '/' and break the "empty string for root" contract downstream
		// (conversation folder resolution strips it to '' but settings saves
		// the raw '/', making the folder scan match nothing).
		return [
			null,
			...this.app.vault
				.getAllLoadedFiles()
				.filter((f): f is TFolder => f instanceof TFolder && f.path !== '/'),
		];
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
