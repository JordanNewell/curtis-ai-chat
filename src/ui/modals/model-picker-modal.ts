// Model Picker Modal — fuzzy-searchable model selector with capability pills.
//
// Routed through from ChatView whenever the user clicks the model name in the
// header. Replaces the old inline <select> path entirely (the select scales
// badly past ~20 models and can't show capability metadata).

import { App, FuzzySuggestModal, setIcon } from 'obsidian';
import type { AIModel } from '../../types';

interface ModelPickerEntry {
	providerId: string;
	providerName: string;
	model: AIModel;
}

/** Format a context length (in tokens) as a compact pill label. */
function formatContext(length: number): string {
	if (!length || length <= 0) return '';
	if (length >= 1_000_000) return `${(length / 1_000_000).toFixed(1)}M`;
	if (length >= 1000) return `${Math.round(length / 1000)}K`;
	return String(length);
}

export class ModelPickerModal extends FuzzySuggestModal<ModelPickerEntry> {
	private entries: ModelPickerEntry[];
	private activeKey: string | undefined;
	private onPick: (providerId: string, modelId: string) => void;

	constructor(
		app: App,
		entries: ModelPickerEntry[],
		activeKey: string | undefined,
		onPick: (providerId: string, modelId: string) => void
	) {
		super(app);
		this.entries = entries;
		this.activeKey = activeKey;
		this.onPick = onPick;
		this.setPlaceholder('Search models... (type to filter)');
	}

	getItems(): ModelPickerEntry[] {
		return this.entries;
	}

	/** Plain text used for fuzzy scoring + filtering. */
	getItemText(entry: ModelPickerEntry): string {
		return `${entry.providerName} ${entry.model.name}`;
	}

	/** Custom row: name + provider + capability pills. */
	renderSuggestion(entry: { item: ModelPickerEntry }, el: HTMLElement): void {
		el.empty();
		el.addClass('ai-model-suggestion-row');

		const row = el.createDiv({ cls: 'ai-model-suggestion' });

		// Active marker — highlight current model
		const key = `${entry.item.providerId}|${entry.item.model.id}`;
		const isActive = key === this.activeKey;

		const text = row.createDiv({ cls: 'ai-model-suggestion-text' });
		const name = text.createDiv({
			cls: 'ai-model-suggestion-name',
			text: entry.item.model.name,
		});
		if (isActive) name.style.color = 'var(--interactive-accent)';
		text.createDiv({
			cls: 'ai-model-suggestion-provider',
			text: entry.item.providerName,
		});

		// Capability pills
		const pills = row.createDiv({ cls: 'ai-model-pills' });

		if (entry.item.model.visionSupported) {
			const pill = pills.createDiv({ cls: 'ai-model-pill ai-model-pill-vision' });
			setIcon(pill, 'eye');
			pill.appendText('Vision');
		}
		if (entry.item.model.functionCallingSupported) {
			const pill = pills.createDiv({ cls: 'ai-model-pill ai-model-pill-tools' });
			setIcon(pill, 'wrench');
			pill.appendText('Tools');
		}
		const ctx = formatContext(entry.item.model.contextLength);
		if (ctx) {
			pills.createDiv({ cls: 'ai-model-pill', text: ctx });
		}
		if (isActive) {
			const check = pills.createDiv({ cls: 'ai-model-pill is-active' });
			setIcon(check, 'check');
		}
	}

	onChooseItem(entry: ModelPickerEntry): void {
		this.onPick(entry.providerId, entry.model.id);
	}
}

/**
 * Build a flat list of {providerId, providerName, model} entries from the
 * set of enabled providers, for use with ModelPickerModal.
 */
export function buildModelPickerEntries(
	enabledProviders: Array<{ id: string; provider: { name: string; models: AIModel[] } }>
): ModelPickerEntry[] {
	const entries: ModelPickerEntry[] = [];
	for (const { id, provider } of enabledProviders) {
		for (const model of provider.models) {
			entries.push({ providerId: id, providerName: provider.name, model });
		}
	}
	return entries;
}
