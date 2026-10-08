// Import summary — per-file breakdown after an import run. A terse Notice
// suffices for one clean file; anything multi-file or with failures gets the
// modal so the user can see exactly what landed and what was skipped.

import { App, Modal, setIcon } from 'obsidian';
import type { ImportSummary } from './types';
import { formatLabel } from './importer';

export class ImportSummaryModal extends Modal {
	private summary: ImportSummary;

	constructor(app: App, summary: ImportSummary) {
		super(app);
		this.summary = summary;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('curt-import-summary');

		contentEl.createDiv({ cls: 'curt-import-summary-title', text: 'Import complete' });
		const headline = this.summary.totalImported > 0
			? `Imported ${this.summary.totalImported} conversation${this.summary.totalImported === 1 ? '' : 's'}` +
				(this.summary.totalSkipped > 0 ? ` · ${this.summary.totalSkipped} already present` : '')
			: 'No new conversations imported';
		contentEl.createDiv({ cls: 'curt-import-summary-headline', text: headline });

		for (const report of this.summary.reports) {
			const row = contentEl.createDiv({ cls: 'curt-import-summary-row' });
			const icon = row.createDiv({ cls: 'curt-import-summary-icon' });
			setIcon(icon, report.error ? 'alert-circle' : 'check');
			if (report.error) icon.addClass('is-error');
			const body = row.createDiv({ cls: 'curt-import-summary-body' });
			body.createDiv({ cls: 'curt-import-summary-file', text: report.file });
			const parts = [formatLabel(report.format)];
			if (report.imported > 0) parts.push(`${report.imported} imported`);
			if (report.skipped > 0) parts.push(`${report.skipped} already present`);
			if (report.error) parts.push(report.error);
			body.createDiv({ cls: 'curt-import-summary-detail', text: parts.join(' · ') });
		}

		const actions = contentEl.createDiv({ cls: 'curt-import-summary-actions' });
		const done = actions.createEl('button', { cls: 'mod-cta', text: 'Done' });
		done.addEventListener('click', () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
