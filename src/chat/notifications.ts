// System notifications for finished chat responses.
//
// Desktop Obsidian runs on Electron, where the web Notification API works and
// permission is normally pre-granted. Everywhere else — mobile, or desktop
// users who denied the permission — we fall back to an in-app Notice so the
// setting still does something. Feature-detection mirrors voice.ts
// (isSpeechSupported): the capability decides, never the platform.

import { Notice, WorkspaceLeaf } from 'obsidian';

/** True when the web Notification API exists (desktop Electron). */
export function isSystemNotificationSupported(): boolean {
	return typeof Notification !== 'undefined';
}

/** Ask for permission when the user turns notifications on. 'granted' needs
 *  no prompt; 'denied' can only be undone in OS/app settings, so say so. */
export async function ensureNotificationPermission(): Promise<void> {
	if (!isSystemNotificationSupported()) return;
	if (Notification.permission === 'default') {
		try {
			await Notification.requestPermission();
		} catch (e) {
			console.debug('[Curtis] notification permission request failed:', e);
		}
	}
	if (Notification.permission === 'denied') {
		new Notice('System notifications are blocked for Obsidian — re-enable them in your operating system notification settings.');
	}
}

export interface ResponseNotification {
	title: string;
	body: string;
	/** Leaf to reveal (and window to focus) when the notification is clicked. */
	leaf?: WorkspaceLeaf;
}

/** Fire a completion/error notification. Clicking it focuses the window and
 *  reveals the chat pane the response belongs to. */
export function notifyResponse(notification: ResponseNotification): void {
	if (isSystemNotificationSupported() && Notification.permission === 'granted') {
		try {
			// Titles come from auto-generated conversation titles, which are
			// raw slices of the first message — collapse any whitespace.
			const title = notification.title.replace(/\s+/g, ' ').trim();
			const system = new Notification(title, { body: notification.body });
			system.onclick = () => {
				try {
					system.close();
				} catch {
					// Some platforms close notifications automatically on click.
				}
				if (notification.leaf) {
					try {
						// The leaf may have been closed while the notification
						// sat in the action center — a stale leaf must not
						// surface an error dialog.
						notification.leaf.view.app.workspace.setActiveLeaf(notification.leaf, { focus: true });
					} catch (e) {
						console.debug('[Curtis] notification click could not reveal the chat pane:', e);
					}
				}
			};
			return;
		} catch (e) {
			console.debug('[Curtis] system notification failed, falling back to a notice:', e);
		}
	}
	new Notice(`${notification.title}\n${notification.body}`, 10000);
}

/** Single-line preview of a response for a notification body. Markdown
 *  syntax is stripped — `## Heading` and `**bold**` read as noise in a
 *  toast, and links collapse to their label text. */
export function responsePreview(content: string, max = 120): string {
	const line = content
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/[#*_`>~]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	return line.length > max ? line.slice(0, max - 1) + '…' : line;
}
