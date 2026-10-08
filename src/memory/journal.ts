// Curtis Journal — append-only session log. /recap writes one entry per
// recap: what was worked on, decided, and left open. The file is plain
// markdown in the vault, so it syncs, searches, and stays portable. There is
// deliberately no watcher or cache — entries are rare, small, and only ever
// appended (Curtis never rewrites this file; hand edits are sacred).

import { TFile } from 'obsidian';
import type CurtisPlugin from '../main';

const DEFAULT_JOURNAL_PATH = 'AI/Curtis Journal.md';

const HEADER =
	'# Curtis Journal\n\nOne entry per recap — what we worked on, decided, and left open. Edit or delete freely; Curtis only appends.\n\n';

function journalPath(plugin: CurtisPlugin): string {
	return plugin.settings.journalFilePath?.trim() || DEFAULT_JOURNAL_PATH;
}

/** Create the folder chain of a vault path (mirrors MemoryStore.ensureFile). */
async function ensureFolders(plugin: CurtisPlugin, path: string): Promise<void> {
	const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
	if (!folder) return;
	const parts = folder.split('/').filter(Boolean);
	let acc = '';
	for (const p of parts) {
		acc = acc ? `${acc}/${p}` : p;
		if (!plugin.app.vault.getAbstractFileByPath(acc)) {
			try {
				await plugin.app.vault.createFolder(acc);
			} catch {
				// already exists (index lag or race) — fine
			}
		}
	}
}

/** Make sure the journal file exists so users can find & open it. */
export async function ensureJournalFile(plugin: CurtisPlugin): Promise<TFile | null> {
	const path = journalPath(plugin);
	await ensureFolders(plugin, path);
	const existing = plugin.app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) return existing;
	// The vault index can lag the filesystem on a cold boot — check the
	// adapter (filesystem truth) before creating, same guard as MemoryStore.
	if (await plugin.app.vault.adapter.exists(path)) {
		const recheck = plugin.app.vault.getAbstractFileByPath(path);
		return recheck instanceof TFile ? recheck : null;
	}
	try {
		return await plugin.app.vault.create(path, HEADER);
	} catch {
		const onDisk = await plugin.app.vault.adapter.exists(path).catch(() => false);
		if (!onDisk) throw new Error(`[Curtis] Could not create journal file: ${path}`);
		const late = plugin.app.vault.getAbstractFileByPath(path);
		return late instanceof TFile ? late : null;
	}
}

/**
 * Append one journal entry:
 *
 *   ## 2026-10-08 — <conversation title>
 *   <recap body>
 *   [[<conversation path>|Open conversation]]
 */
export async function appendJournalEntry(
	plugin: CurtisPlugin,
	title: string,
	body: string,
	conversationPath?: string
): Promise<void> {
	const file = await ensureJournalFile(plugin);
	if (!file) throw new Error('[Curtis] Journal file unavailable');
	const date = new Date().toISOString().slice(0, 10);
	const parts = [`## ${date} — ${title}`, '', body.trim(), ''];
	if (conversationPath) parts.push(`[[${conversationPath}|Open conversation]]`, '');
	parts.push('');
	await plugin.app.vault.append(file, parts.join('\n'));
}
