// .curt — Curtis's branded single-file conversation format.
//
// One .curt file = one conversation, serialized as JSON with a magic field.
// JSON (rather than the markdown+marker layout) because a portable file must
// be byte-robust: no marker-escaping edge cases, and base64 images / tool
// calls survive verbatim. The export path uses a browser download; the import
// path validates strictly — a hand-corrupted file is reported, not guessed.
//
// Exports also stamp a `generator` field ("curtis-ai-chat@<version>") naming
// the app and version that wrote the file — provenance only. Readers ignore
// it entirely: first-party files written before the field existed and
// third-party writers without it import identically.

import { Notice, TFile, type App } from 'obsidian';
import { zipSync, strToU8 } from 'fflate';
import type { Conversation, ConversationMessage } from '../types';
import { downloadBlob, sanitizeFilename, slugify } from '../utils/download';

const CURT_MAGIC = 'curtis-conversation';
const CURT_VERSION = 1;

interface CurtFile {
	curt: typeof CURT_MAGIC;
	version: number;
	/**
	 * Provenance: which app and version produced the file, formatted as
	 * "curtis-ai-chat@<version>". Optional — older first-party files and
	 * third-party writers omit it. Readers must ignore it for compatibility:
	 * its presence, absence, or value never affects parsing.
	 */
	generator?: string;
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

/**
 * Serialize a conversation as a .curt file body. When `pluginVersion` is
 * given (callers pass `plugin.manifest.version`), the file is stamped with a
 * `generator` provenance field; without it the field is omitted entirely —
 * the version is never hardcoded.
 */
export function serializeCurt(conv: Conversation, pluginVersion?: string): string {
	const file: CurtFile = { curt: CURT_MAGIC, version: CURT_VERSION, conversation: conv };
	if (pluginVersion) file.generator = `curtis-ai-chat@${pluginVersion}`;
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

/** Trigger a browser download of the conversation as a .curt file. */
export function downloadConversationCurt(conv: Conversation, pluginVersion?: string): void {
	const body = serializeCurt(conv, pluginVersion);
	downloadBlob(body, `${sanitizeFilename(conv.title || 'conversation')}.curt`, 'application/json;charset=utf-8');
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
export function downloadConversationsCurtZip(conversations: Conversation[], pluginVersion?: string): void {
	const entries: Record<string, Uint8Array> = {};
	let count = 0;
	for (const conv of conversations) {
		if (!conv || !Array.isArray(conv.messages) || conv.messages.length === 0) continue;
		entries[curtZipEntryName(conv)] = strToU8(serializeCurt(conv, pluginVersion));
		count++;
	}
	if (count === 0) {
		new Notice('No conversations to export');
		return;
	}
	const now = new Date();
	const p = (n: number): string => String(n).padStart(2, '0');
	const zipName = `curtis-chats-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.zip`;
	downloadBlob(zipSync(entries), zipName, 'application/zip');
	new Notice(`Exported ${count} conversation${count === 1 ? '' : 's'} to ${zipName}`, 8000);
}

/**
 * Parse a vault .curt file (click-to-import path). Returns null when the
 * file isn't a valid .curt conversation — .curt round-trips full fidelity,
 * so on success the importer writes it as-is.
 */
export async function readCurtFile(app: App, file: TFile): Promise<Conversation | null> {
	try {
		return parseCurt(await app.vault.read(file));
	} catch {
		return null;
	}
}
