// .curt — Curtis's branded single-file conversation format.
//
// One .curt file = one conversation, serialized as JSON with a magic field.
// JSON (rather than the markdown+marker layout) because a portable file must
// be byte-robust: no marker-escaping edge cases, and base64 images / tool
// calls survive verbatim. The export path uses a browser download; the import
// path validates strictly — a hand-corrupted file is reported, not guessed.

import { Notice, TFile, type App } from 'obsidian';
import { zipSync, strToU8 } from 'fflate';
import type { Conversation, ConversationMessage } from '../types';
import type { ParsedMessage } from './types';

const CURT_MAGIC = 'curtis-conversation';
const CURT_VERSION = 1;

interface CurtFile {
	curt: typeof CURT_MAGIC;
	version: number;
	conversation: Conversation;
}

function isMessage(v: unknown): v is ConversationMessage {
	if (!v || typeof v !== 'object') return false;
	const m = v as Record<string, unknown>;
	return (
		typeof m.id === 'string' &&
		(m.role === 'user' || m.role === 'assistant' || m.role === 'system' || m.role === 'tool') &&
		typeof m.content === 'string' &&
		typeof m.timestamp === 'number'
	);
}

/** Serialize a conversation as a .curt file body. */
export function serializeCurt(conv: Conversation): string {
	const file: CurtFile = { curt: CURT_MAGIC, version: CURT_VERSION, conversation: conv };
	return JSON.stringify(file, null, '\t');
}

/**
 * Parse a .curt body. Returns null when the magic/version/shape doesn't
 * validate — callers report the file as failed rather than importing a
 * half-parsed conversation.
 */
export function parseCurt(raw: string): Conversation | null {
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return null;
	}
	const f = data as Partial<CurtFile>;
	if (!f || f.curt !== CURT_MAGIC || f.version !== CURT_VERSION) return null;
	const conv = f.conversation as Partial<Conversation> | undefined;
	if (
		!conv ||
		typeof conv.id !== 'string' ||
		typeof conv.title !== 'string' ||
		typeof conv.createdAt !== 'number' ||
		typeof conv.updatedAt !== 'number' ||
		!Array.isArray(conv.messages) ||
		!conv.messages.every(isMessage)
	) {
		return null;
	}
	return conv as Conversation;
}

/** Sanitize a title for a .curt filename (mirrors export.ts's md rules). */
function sanitizeFilename(name: string): string {
	return name.replace(/[<>:"/\\|?*\p{Cc}]/gu, '_').trim() || 'conversation';
}

/** Trigger a browser download of the conversation as a .curt file. */
export function downloadConversationCurt(conv: Conversation): void {
	const body = serializeCurt(conv);
	const filename = `${sanitizeFilename(conv.title || 'conversation')}.curt`;
	const blob = new Blob([body], { type: 'application/json;charset=utf-8' });
	const url = URL.createObjectURL(blob);
	const a = activeDocument.body.createEl('a', { attr: { href: url, download: filename } });
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}

/** Turn a conversation title into a filesystem-safe filename fragment
 *  (mirrors conversation-store's slugify — bulk export names files with the
 *  same "<date> <slug> <id6>" convention the vault transcripts use). */
function slugify(title: string): string {
	const cleaned = (title || '')
		.replace(/[\\/:*?"<>|#^[\]]/g, '')
		// eslint-disable-next-line no-control-regex -- strip ASCII control chars that are illegal in filenames
		.replace(/[\x00-\x1f]/g, '')
		.replace(/\s+/g, ' ')
		.replace(/^\.+/, '')
		.trim()
		.replace(/[. ]+$/, '');
	const trimmed = cleaned.length > 60 ? cleaned.slice(0, 60).trim() : cleaned;
	return trimmed || 'Untitled';
}

/** Bulk-export filename: "<created-date> <slug> <id6>.curt" — collision-safe
 *  and chronologically sorted, unlike bare titles. */
function curtZipEntryName(conv: Conversation): string {
	const d = new Date(conv.createdAt);
	const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	const short = conv.id.split('_').pop()?.slice(-6) || conv.id.slice(-6);
	return `${date} ${slugify(conv.title)} ${short}.curt`;
}

/**
 * Export every conversation as a single zip of .curt files — whole-history
 * backup, vault-to-vault move, or machine-to-machine transfer. The zip is
 * re-importable: drop it into another vault and import it (auto-detected).
 * Empty conversations are skipped; the rest land byte-identical to their
 * single-file exports.
 */
export function downloadConversationsCurtZip(conversations: Conversation[]): void {
	const entries: Record<string, Uint8Array> = {};
	let count = 0;
	for (const conv of conversations) {
		if (!conv || !Array.isArray(conv.messages) || conv.messages.length === 0) continue;
		entries[curtZipEntryName(conv)] = strToU8(serializeCurt(conv));
		count++;
	}
	if (count === 0) {
		new Notice('No conversations to export');
		return;
	}
	const now = new Date();
	const p = (n: number): string => String(n).padStart(2, '0');
	const zipName = `curtis-chats-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.zip`;
	const blob = new Blob([zipSync(entries)], { type: 'application/zip' });
	const url = URL.createObjectURL(blob);
	const a = activeDocument.body.createEl('a', { attr: { href: url, download: zipName } });
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
	new Notice(`Exported ${count} conversation${count === 1 ? '' : 's'} to ${zipName}`, 8000);
}

/**
 * Parse a vault .curt file (click-to-import path). Returns the conversation
 * plus a parsed-message fallback shape is NOT used — .curt round-trips full
 * fidelity, so on success the importer writes it as-is.
 */
export async function readCurtFile(app: App, file: TFile): Promise<Conversation | null> {
	try {
		return parseCurt(await app.vault.read(file));
	} catch {
		return null;
	}
}

/** Convert a Curtis markdown transcript into the ParsedChat pipeline. Used
 *  when someone imports Curtis's human-readable .md export into another
 *  vault without the marker metadata — reuse the store's own parser. */
export function conversationToParsedMessages(conv: Conversation): ParsedMessage[] {
	return conv.messages.map((m) => ({
		role: m.role,
		content: m.content,
		timestamp: m.timestamp,
		model: m.model,
	}));
}

export function curtUnsupportedNotice(file: string): void {
	new Notice(`Curtis could not read ${file} as a .curt conversation file`);
}
