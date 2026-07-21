import { App, FuzzySuggestModal, TFile } from 'obsidian';

/** Fuzzy-pick an image file from the vault. Used for the wallpaper setting. */
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif']);

export class ImageSuggestModal extends FuzzySuggestModal<TFile> {
	private onChoose: (path: string) => void;

	constructor(app: App, onChoose: (path: string) => void) {
		super(app);
		this.onChoose = onChoose;
		this.setPlaceholder('Pick an image…');
		this.setTitle('Choose wallpaper image');
	}

	getItems(): TFile[] {
		return this.app.vault.getFiles().filter((f) => IMAGE_EXTS.has(f.extension.toLowerCase()));
	}

	getItemText(item: TFile): string {
		return item.path;
	}

	onChooseItem(item: TFile): void {
		this.onChoose(item.path);
	}
}
