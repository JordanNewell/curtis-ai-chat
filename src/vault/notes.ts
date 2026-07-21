// Note creation helpers — used by "Save as note", /note, /save-all, and auto-save.

import { App, Notice, TFile } from 'obsidian';
import type { ConversationMessage } from '../types';

/** Resolve the attachment folder. We use a fixed default rather than reading
 * Obsidian's per-vault setting (no public API in this obsidian version). */
export async function resolveAttachmentFolder(app: App): Promise<string> {
	const folder = 'attachments';
	await ensureFolder(app, folder);
	return folder;
}

/** Generate a unique filename for an image attachment. */
function uniqueImageName(app: App, folder: string, ext: string): string {
	const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
	let name = `Pasted image ${ts}.${ext}`;
	let path = `${folder}/${name}`;
	let n = 2;
	while (app.vault.getAbstractFileByPath(path)) {
		name = `Pasted image ${ts} ${n}.${ext}`;
		path = `${folder}/${name}`;
		n++;
	}
	return path;
}

const INVALID_CHARS = /[#*/\\?<>|:`"]/g;

/** Sanitize a string into a valid Obsidian basename (no path separators). */
export function sanitizeBasename(name: string): string {
	const cleaned = name
		.replace(/^\s*#+\s*/, '') // strip leading markdown heading marker
		.replace(INVALID_CHARS, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	return cleaned || 'Untitled';
}

/** Derive a readable basename from a message's content (first non-empty line). */
export function deriveNoteBasename(content: string, fallback = 'AI Note'): string {
	const firstLine = content
		.split('\n')
		.map((l) => l.trim())
		.find((l) => l.length > 0);
	if (!firstLine) return fallback;
	// Strip markdown emphasis/links/code so filenames read cleanly.
	const stripped = firstLine
		.replace(/`{1,3}[^`]*`{1,3}/g, '') // inline code
		.replace(/\*\*([^*]+)\*\*/g, '$1')
		.replace(/\*([^*]+)\*/g, '$1')
		.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
		.replace(/\[\[([^\]]+)\]\]/g, '$1')
		.replace(/^\s*[-*+]\s+/, '');
	return sanitizeBasename(stripped).slice(0, 60) || fallback;
}

/** Ensure a folder path exists, creating nested segments as needed. */
export async function ensureFolder(app: App, folder: string): Promise<void> {
	if (!folder) return;
	const existing = app.vault.getAbstractFileByPath(folder);
	if (existing) return;
	const parts = folder.split('/').filter(Boolean);
	let acc = '';
	for (const p of parts) {
		acc = acc ? `${acc}/${p}` : p;
		if (!app.vault.getAbstractFileByPath(acc)) {
			try {
				await app.vault.createFolder(acc);
			} catch {
				/* already exists, ignore */
			}
		}
	}
}

/**
 * Save raw image bytes to the vault as a proper attachment file (mirrors
 * Obsidian's native paste/drop behavior — images become real files in the
 * configured attachment folder, reusable across notes and chats). Returns
 * the created TFile.
 */
export async function saveImageToVault(
	app: App,
	data: ArrayBuffer,
	mime: string
): Promise<TFile | null> {
	const folder = await resolveAttachmentFolder(app);
	const ext = mimeToExt(mime);
	const path = uniqueImageName(app, folder, ext);
	try {
		const bytes = new Uint8Array(data);
		const file = await app.vault.createBinary(path, bytes as unknown as ArrayBuffer);
		return file;
	} catch (e) {
		console.error('[Curtis] saveImageToVault failed:', e);
		new Notice(`Failed to save image: ${(e as Error).message}`);
		return null;
	}
}

function mimeToExt(mime: string): string {
	const map: Record<string, string> = {
		'image/png': 'png',
		'image/jpeg': 'jpg',
		'image/gif': 'gif',
		'image/webp': 'webp',
		'image/svg+xml': 'svg',
		'image/bmp': 'bmp',
		'image/avif': 'avif',
	};
	return map[mime] || 'png';
}

/**
 * Convert a data URL into raw bytes for vault storage.
 */
export function dataUrlToBytes(dataUrl: string): { bytes: ArrayBuffer; mime: string } | null {
	const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
	if (!m) return null;
	const mime = m[1];
	const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0)).buffer;
	return { bytes, mime };
}

/** Create a note with a unique basename inside `folder`. Returns the file. */
export async function createNote(
	app: App,
	folder: string,
	basename: string,
	content: string,
	opts: { open?: boolean; frontmatter?: Record<string, unknown> } = {}
): Promise<TFile | null> {
	await ensureFolder(app, folder);

	const safe = sanitizeBasename(basename);
	const prefix = folder ? `${folder.replace(/\/+$/, '')}/` : '';

	// Find a unique path — append " 2", " 3", etc. on collision.
	let path = `${prefix}${safe}.md`;
	let n = 2;
	while (app.vault.getAbstractFileByPath(path)) {
		path = `${prefix}${safe} ${n}.md`;
		n++;
	}

	const body = opts.frontmatter
		? `---\n${Object.entries(opts.frontmatter)
				.map(([k, v]) => {
					const value = typeof v === 'string' ? v : JSON.stringify(v);
					return `${k}: ${value}`;
				})
				.join('\n')}\n---\n\n${content}`
		: content;

	try {
		const file = await app.vault.create(path, body);
		if (opts.open) {
			// Open in a NEW leaf so we don't blow away whatever the user is
			// currently editing — Save-as-note and Insert-into-active-note
			// are sibling actions with opposite intents.
			await app.workspace.openLinkText(path, '', true);
		}
		return file;
	} catch (e) {
		console.error('[Curtis] createNote failed:', e);
		new Notice(`Failed to create note: ${(e as Error).message}`);
		return null;
	}
}

/**
 * Save a single message as a note. Title derived from content; folder from
 * settings. Returns the created file (or null).
 */
export async function saveMessageAsNote(
	app: App,
	msg: ConversationMessage,
	folder: string,
	opts: { open?: boolean } = {}
): Promise<TFile | null> {
	// Locale strings contain path-invalid chars on some OSes; use a safe stamp.
	const stamp = new Date(msg.timestamp)
		.toISOString()
		.replace(/[T]/g, ' ')
		.replace(/[:.]/g, '-')
		.slice(0, 19);
	const basename = deriveNoteBasename(msg.content, `AI Response ${stamp}`);
	const frontmatter = {
		source: 'Curtis',
		provider: msg.provider || '',
		model: msg.model || '',
		created: new Date(msg.timestamp).toISOString(),
	};
	// Embed attached images as Obsidian wikilinks.
	let body = msg.content;
	if (msg.images && msg.images.length > 0) {
		const embeds = msg.images
			.map((p) => {
				const name = p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p;
				return `![[${name}]]`;
			})
			.join('\n');
		body = `${msg.content}\n\n${embeds}`;
	}
	return createNote(app, folder, basename, body, { open: opts.open, frontmatter });
}

/**
 * Export an entire conversation (array of messages) as a single markdown note.
 */
export function renderConversationAsMarkdown(
	messages: ConversationMessage[],
	title: string
): string {
	const lines: string[] = [`# ${title}`, ''];
	for (const msg of messages) {
		const role = msg.role === 'user' ? '## 🧑 You' : msg.role === 'assistant' ? '## 🤖 Assistant' : `## ${msg.role}`;
		lines.push(role);
		if (msg.model) {
			lines.push(`*${msg.provider || ''} / ${msg.model}*`.trim());
		}
		lines.push('');
		lines.push(msg.content);
		lines.push('');
		// Embed any attached images as Obsidian wikilinks so the note renders
		// them natively — `![[Pasted image ...]]` resolves in the note view.
		if (msg.images && msg.images.length > 0) {
			for (const path of msg.images) {
				const name = path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path;
				lines.push(`![[${name}]]`);
			}
			lines.push('');
		}
	}
	return lines.join('\n');
}
