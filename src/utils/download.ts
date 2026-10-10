// Filename + browser-download helpers shared by the markdown/curt export
// paths and the conversation store (which names the vault transcript files).

/** Sanitize a string for use as a filename.
 *  Strips Windows-forbidden chars + Unicode control characters (Cc category). */
export function sanitizeFilename(name: string): string {
	return name.replace(/[<>:"/\\|?*\p{Cc}]/gu, '_').trim() || 'conversation';
}

/** Turn a conversation title into a filesystem-safe filename fragment
 *  (the "<date> <slug> <id6>" convention vault transcripts and bulk .curt
 *  exports share, so both name the same conversation identically). */
export function slugify(title: string): string {
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

/** Trigger a browser download of `content` as `filename`. Uses the active
 *  document so it works from a popout window too. */
export function downloadBlob(content: string | Uint8Array, filename: string, mime: string): void {
	const blob = new Blob([content as BlobPart], { type: mime });
	const url = URL.createObjectURL(blob);
	const a = activeDocument.body.createEl('a', { attr: { href: url, download: filename } });
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}
