// Arena Model Picker Modal — multi-select for the Multi-Model Arena.
//
// FuzzySuggestModal is single-select only; arena needs 2-5 simultaneous
// selections, so we use a plain Modal with toggleable rows. Rows mirror the
// visual language of ModelPickerModal (name + provider + capability pills)
// but add a checkbox-style selected state.

import { App, Modal, setIcon } from 'obsidian';
import type { AIModel } from '../../types';

export interface ArenaModelEntry {
	providerId: string;
	providerName: string;
	model: AIModel;
}

export interface ArenaSelection {
	providerId: string;
	modelId: string;
	providerName: string;
	modelName: string;
}

const MIN_SELECTIONS = 2;
const MAX_SELECTIONS = 5;

/** Format a context length (in tokens) as a compact pill label. */
function formatContext(length: number): string {
	if (!length || length <= 0) return '';
	if (length >= 1_000_000) return `${(length / 1_000_000).toFixed(1)}M`;
	if (length >= 1000) return `${Math.round(length / 1000)}K`;
	return String(length);
}

export class ArenaModelPickerModal extends Modal {
	private entries: ArenaModelEntry[];
	private selected = new Set<string>(); // key: `${providerId}|${modelId}`
	private onSubmit: (selections: ArenaSelection[]) => void;
	private counterEl!: HTMLElement;
	private startBtn!: HTMLButtonElement;
	private rowEls = new Map<string, HTMLElement>();
	private submitted = false;
	/** Optional hook fired after onOpen's DOM is built — used by the caller
	 *  to pre-select entries before the user interacts. */
	public onOpenHook: (() => void) | undefined;
	/** Optional hook fired when the user cancels (Cancel button or Escape). */
	public onCancel: (() => void) | undefined;

	constructor(
		app: App,
		entries: ArenaModelEntry[],
		onSubmit: (selections: ArenaSelection[]) => void
	) {
		super(app);
		this.entries = entries;
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('ai-arena-picker-modal');

		contentEl.createEl('h2', { text: 'Arena — pick 2–5 models' });
		contentEl.createEl('p', {
			cls: 'ai-arena-picker-desc',
			text: 'Your next prompt streams in parallel to every selected model, side-by-side.',
		});

		this.counterEl = contentEl.createDiv({ cls: 'ai-arena-picker-counter' });
		this.updateCounter();

		const listEl = contentEl.createDiv({ cls: 'ai-arena-picker-list' });
		for (const entry of this.entries) {
			const key = `${entry.providerId}|${entry.model.id}`;
			const row = listEl.createDiv({
				cls: 'ai-arena-picker-row' + (this.selected.has(key) ? ' is-selected' : ''),
			});
			row.createDiv({ cls: 'ai-arena-picker-check' });
			const text = row.createDiv({ cls: 'ai-arena-picker-text' });
			text.createDiv({ cls: 'ai-arena-picker-name', text: entry.model.name });
			text.createDiv({ cls: 'ai-arena-picker-provider', text: entry.providerName });

			const pills = row.createDiv({ cls: 'ai-model-pills' });
			if (entry.model.visionSupported) {
				const pill = pills.createDiv({ cls: 'ai-model-pill ai-model-pill-vision' });
				setIcon(pill, 'eye');
				pill.appendText('Vision');
			}
			if (entry.model.functionCallingSupported) {
				const pill = pills.createDiv({ cls: 'ai-model-pill ai-model-pill-tools' });
				setIcon(pill, 'wrench');
				pill.appendText('Tools');
			}
			const ctx = formatContext(entry.model.contextLength);
			if (ctx) {
				pills.createDiv({ cls: 'ai-model-pill', text: ctx });
			}

			row.addEventListener('click', () => this.toggle(key));
			this.rowEls.set(key, row);
		}

		// Footer with Cancel + Start buttons.
		const footer = contentEl.createDiv({ cls: 'ai-arena-picker-footer' });
		const cancelBtn = footer.createEl('button', { cls: 'ai-arena-picker-cancel', text: 'Cancel' });
		cancelBtn.addEventListener('click', () => {
			this.onCancel?.();
			this.close();
		});
		this.startBtn = footer.createEl('button', {
			cls: 'mod-cta ai-arena-picker-start',
			text: 'Start arena',
		});
		this.startBtn.addEventListener('click', () => this.submit());
		this.updateStartButton();
		// Fire the post-open hook now that rows exist (used to pre-select).
		this.onOpenHook?.();
	}

	/** Public toggle — lets the caller pre-select entries before user input. */
	toggleFromOutside(key: string): void {
		this.toggle(key);
	}

	private toggle(key: string): void {
		if (this.selected.has(key)) {
			this.selected.delete(key);
		} else {
			if (this.selected.size >= MAX_SELECTIONS) {
				return;
			}
			this.selected.add(key);
		}
		const row = this.rowEls.get(key);
		row?.toggleClass('is-selected', this.selected.has(key));
		this.updateCounter();
		this.updateStartButton();
	}

	private updateCounter(): void {
		this.counterEl.setText(`Selected: ${this.selected.size} / ${MAX_SELECTIONS}`);
	}

	private updateStartButton(): void {
		this.startBtn.disabled = this.selected.size < MIN_SELECTIONS;
	}

	private submit(): void {
		if (this.selected.size < MIN_SELECTIONS) return;
		const selections: ArenaSelection[] = [];
		for (const entry of this.entries) {
			const key = `${entry.providerId}|${entry.model.id}`;
			if (this.selected.has(key)) {
				selections.push({
					providerId: entry.providerId,
					modelId: entry.model.id,
					providerName: entry.providerName,
					modelName: entry.model.name,
				});
			}
		}
		this.submitted = true;
		this.onSubmit(selections);
		this.close();
	}

	onClose(): void {
		super.onClose();
		if (!this.submitted) {
			this.onCancel?.();
		}
	}
}
