// Import orchestrator: pick files → detect format → normalize → write to
// the conversations folder → report. This is the single entry point shared
// by the command picker, chat-view drag-and-drop, and the .curt click-to-import
// view. Kept free of Obsidian UI except Notices so the whole pipeline could
// lift into a standalone importer plugin later.

import { Notice } from 'obsidian';
import type CurtisPlugin from '../main';
import type { Conversation } from '../types';
import type { ImportedFileReport, ImportSummary } from './types';
import { conversationDedupeKey, detectAndParse, parsedChatToConversation } from './detect';
import { ImportSummaryModal } from './import-summary-modal';

export interface ImportFileInput {
	name: string;
	buffer: ArrayBuffer;
}

const FORMAT_LABELS: Record<string, string> = {
	curt: 'Curtis (.curt)',
	'curtis-md': 'Curtis markdown',
	chatgpt: 'ChatGPT',
	claude: 'Claude',
	'generic-json': 'JSON transcript',
	'generic-md': 'Markdown transcript',
	unknown: 'Unknown format',
};

/**
 * Import the given files. Dedupe: a conversation whose id already exists is
 * skipped (re-running the same export is idempotent); for foreign formats a
 * title+length+first-message key guards against double imports too.
 */
export async function importChats(
	plugin: CurtisPlugin,
	files: ImportFileInput[],
	onProgress?: (done: number, total: number) => void
): Promise<ImportSummary> {
	const store = plugin.conversationStore;
	const existingIds = new Set<string>();
	const existingKeys = new Set<string>();
	for (const conv of store.getAllConversations()) {
		existingIds.add(conv.id);
		existingKeys.add(conversationDedupeKey(conv));
	}

	const reports: ImportedFileReport[] = [];
	let totalImported = 0;
	let totalSkipped = 0;

	for (let i = 0; i < files.length; i++) {
		const file = files[i];
		onProgress?.(i, files.length);
		const report: ImportedFileReport = { file: file.name, format: 'unknown', imported: 0, skipped: 0 };
		reports.push(report);
		if (file.buffer.byteLength === 0) {
			report.error = 'empty file';
			continue;
		}
		let detected;
		try {
			detected = detectAndParse(file.name, file.buffer);
		} catch (e) {
			report.error = (e as Error).message || 'parse failure';
			continue;
		}
		report.format = detected.format;
		if (detected.format === 'unknown' || (detected.chats.length === 0 && !detected.conversations)) {
			report.error = 'no conversations recognized';
			continue;
		}

		// .curt / Curtis markdown round-trip full Conversation objects (ids,
		// tokens, images intact); foreign formats normalize into fresh ones.
		const candidates: Conversation[] = detected.conversations ?? detected.chats.map(parsedChatToConversation);

		for (const conv of candidates) {
			const idKey = conv.id || '';
			const dupeKey = conversationDedupeKey({ ...conv, id: '' });
			if ((idKey && existingIds.has(idKey)) || existingKeys.has(dupeKey)) {
				report.skipped++;
				totalSkipped++;
				continue;
			}
			try {
				const finalId = await store.importConversation(conv);
				if (!finalId) {
					report.skipped++;
					continue;
				}
				existingIds.add(finalId);
				existingKeys.add(dupeKey);
				report.imported++;
				totalImported++;
			} catch (e) {
				console.error('[Curtis] Import write failed:', e);
				report.error = report.error || 'vault write failed';
			}
		}
	}

	return { reports, totalImported, totalSkipped };
}

/** Terse single-line result for Notice surfaces. */
export function summarizeShort(summary: ImportSummary): string {
	const parts: string[] = [];
	for (const r of summary.reports) {
		if (r.imported > 0) {
			parts.push(`${r.imported} from ${FORMAT_LABELS[r.format] ?? r.format}`);
		}
	}
	if (summary.totalImported === 0) {
		const firstError = summary.reports.find((r) => r.error)?.error;
		return firstError ? `Import found nothing: ${firstError}` : 'Import found no conversations';
	}
	let line = `Imported ${summary.totalImported} conversation${summary.totalImported === 1 ? '' : 's'} (${parts.join(', ')})`;
	if (summary.totalSkipped > 0) line += `, ${summary.totalSkipped} already present`;
	return line;
}

/** Shared result reporting: modal for anything multi-file or imperfect,
 *  terse Notice for a single clean file. */
export function reportResult(summary: ImportSummary, plugin: CurtisPlugin): void {
	const hasIssues = summary.totalSkipped > 0 || summary.reports.some((r) => r.error);
	if (summary.reports.length > 1 || hasIssues) {
		new ImportSummaryModal(plugin.app, summary).open();
	} else {
		new Notice(summarizeShort(summary), 8000);
	}
	if (summary.totalImported > 0) plugin.refreshChatViews();
}

/** File-picker flow: open an OS multi-select, run the pipeline, show the summary. */
export function openImportDialog(plugin: CurtisPlugin): void {
	// Hidden file input — the OS picker is the UI; removed once handled.
	const input = activeDocument.body.createEl('input', { type: 'file' });
	input.type = 'file';
	input.multiple = true;
	input.accept = '.curt,.json,.zip,.md,.txt';
	input.addEventListener('change', () => {
		void (async () => {
			const files = Array.from(input.files ?? []);
			input.remove();
			if (files.length === 0) return;
			const progress = new Notice('Importing…', 0);
			const inputs: ImportFileInput[] = [];
			for (const f of files) {
				inputs.push({ name: f.name, buffer: await f.arrayBuffer() });
			}
			const summary = await importChats(plugin, inputs, (done, total) => {
				progress.setMessage(`Importing ${done + 1} of ${total}…`);
			});
			progress.hide();
			reportResult(summary, plugin);
		})();
	});
	input.click();
}

/** Run a single already-read file through the pipeline (drag-and-drop path). */
export async function importDroppedFiles(plugin: CurtisPlugin, files: File[]): Promise<void> {
	const progress = new Notice('Importing…', 0);
	const inputs: ImportFileInput[] = [];
	for (const f of files) {
		inputs.push({ name: f.name, buffer: await f.arrayBuffer() });
	}
	const summary = await importChats(plugin, inputs, (done, total) => {
		progress.setMessage(`Importing ${done + 1} of ${total}…`);
	});
	progress.hide();
	reportResult(summary, plugin);
}

export function formatLabel(format: string): string {
	return FORMAT_LABELS[format] ?? format;
}
