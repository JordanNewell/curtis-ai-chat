import { App, Modal, Setting } from 'obsidian';

class ConfirmModal extends Modal {
	private decided = false;

	constructor(
		app: App,
		private title: string,
		private message: string,
		private confirmLabel: string,
		private settle: (ok: boolean) => void
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.title);
		this.contentEl.createDiv({ cls: 'ai-confirm-message', text: this.message });
		new Setting(this.contentEl)
			.addButton((btn) => btn.setButtonText('Cancel').onClick(() => this.finish(false)))
			.addButton((btn) => btn.setButtonText(this.confirmLabel).setDestructive().setCta().onClick(() => this.finish(true)));
	}

	private finish(ok: boolean): void {
		this.decided = true;
		this.settle(ok);
		this.close();
	}

	onClose(): void {
		// Esc (or any close that isn't a button click) counts as a cancel.
		if (!this.decided) this.settle(false);
		this.contentEl.empty();
	}
}

/** Promise wrapper so callers can simply `await` the user's decision. */
export function confirmAction(
	app: App,
	title: string,
	message: string,
	confirmLabel = 'Confirm'
): Promise<boolean> {
	return new Promise((resolve) => {
		new ConfirmModal(app, title, message, confirmLabel, resolve).open();
	});
}
