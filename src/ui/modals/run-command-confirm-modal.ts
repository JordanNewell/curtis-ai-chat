import { App, Modal, Setting } from 'obsidian';

export type CommandApproval = 'once' | 'always' | 'deny';

export class RunCommandConfirmModal extends Modal {
	private command: string;
	private cwd: string;
	private settle: (choice: CommandApproval) => void;
	private decided = false;

	constructor(app: App, command: string, cwd: string, settle: (choice: CommandApproval) => void) {
		super(app);
		this.command = command;
		this.cwd = cwd;
		this.settle = settle;
		this.setTitle('Agent wants to run a command');
		// Size the modal via CSS class (avoids direct style assignment per
		// Obsidian lint rule obsidianmd/no-static-style-assignment).
		this.modalEl.addClass('ai-run-command-modal');
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createDiv({
			cls: 'ai-run-command-hint',
			text: 'The agent requested shell execution. Nothing runs until you allow it.',
		});

		const cwdEl = contentEl.createDiv({ cls: 'ai-run-command-cwd' });
		cwdEl.createSpan({ cls: 'ai-run-command-cwd-label', text: 'Directory' });
		cwdEl.createSpan({ text: this.cwd });

		const pre = contentEl.createEl('pre', { cls: 'ai-run-command-cmd' });
		pre.setText(this.command);

		new Setting(contentEl)
			.addButton((btn) => btn.setButtonText('Deny').onClick(() => this.finish('deny')))
			.addButton((btn) => btn.setButtonText('Run once').setCta().onClick(() => this.finish('once')))
			.addButton((btn) => btn.setButtonText('Always this session').onClick(() => this.finish('always')));
	}

	private finish(choice: CommandApproval): void {
		this.decided = true;
		this.settle(choice);
		this.close();
	}

	onClose(): void {
		// Esc (or any close that isn't a button click) counts as a denial —
		// the agent loop must never hang on an unanswered modal.
		if (!this.decided) this.settle('deny');
		this.contentEl.empty();
	}
}

/** Promise wrapper so callAgentLoop can simply `await` the user's decision. */
export function confirmCommandRun(app: App, command: string, cwd: string): Promise<CommandApproval> {
	return new Promise((resolve) => {
		new RunCommandConfirmModal(app, command, cwd, resolve).open();
	});
}
