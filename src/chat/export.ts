// Conversation export — format as markdown + trigger a browser download.

import type { Conversation } from '../types';

/** Optional resolver: provider id → human-readable display name.
 *  When omitted, the raw provider id is used. */
export type ProviderNameResolver = (providerId: string) => string | undefined;

/** Format a timestamp as a locale string (e.g. "2026-07-22 4:54 PM"). */
function formatTime(ts: number): string {
	return new Date(ts).toLocaleString();
}

/** Format a conversation as a markdown document.
 *  - H1 title
 *  - Metadata block (provider, model, started, message count)
 *  - Each message as a section with role + timestamp + content
 *  - Attached images emitted as markdown image syntax (`![](path)`).
 *    msg.images holds vault paths — these render natively inside Obsidian
 *    and travel with the .md as portable references elsewhere. */
export function formatConversationAsMarkdown(
	conv: Conversation,
	opts: { providerName?: ProviderNameResolver } = {}
): string {
	const resolveName = opts.providerName;
	const providerId = conv.provider;
	const providerDisplay = resolveName ? resolveName(providerId) : undefined;
	const providerLabel = providerDisplay
		? `${providerId} (${providerDisplay})`
		: providerId;

	const lines: string[] = [];
	lines.push(`# ${conv.title || 'Untitled conversation'}`);
	lines.push('');
	lines.push(`> Provider: ${providerLabel}`);
	lines.push(`> Model: ${conv.model}`);
	lines.push(`> Started: ${formatTime(conv.createdAt)}`);
	lines.push(`> Messages: ${conv.messages.length}`);
	lines.push('');
	lines.push('---');
	lines.push('');

	for (const msg of conv.messages) {
		const role = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : msg.role;
		const modelPart = msg.role === 'assistant' && msg.model ? ` · ${msg.model}` : '';
		lines.push(`## ${role}`);
		lines.push(`*${formatTime(msg.timestamp)}*${modelPart}`);
		lines.push('');
		if (msg.content) {
			lines.push(msg.content);
			lines.push('');
		}
		if (msg.images && msg.images.length > 0) {
			for (const img of msg.images) {
				lines.push(`![](${img})`);
			}
			lines.push('');
		}
		lines.push('---');
		lines.push('');
	}

	return lines.join('\n');
}

/** Sanitize a string for use as a filename. */
function sanitizeFilename(name: string): string {
	return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'conversation';
}

/** Trigger a browser download of the conversation as a .md file.
 *  Filename: sanitized title + .md extension. */
export function downloadConversationMarkdown(
	conv: Conversation,
	opts: { providerName?: ProviderNameResolver } = {}
): void {
	const md = formatConversationAsMarkdown(conv, opts);
	const filename = `${sanitizeFilename(conv.title || 'conversation')}.md`;
	const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
	const url = URL.createObjectURL(blob);
	const a = activeDocument.body.createEl('a', { attr: { href: url, download: filename } });
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}
