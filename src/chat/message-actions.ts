// Per-message action toolbar.
// Assistant actions: copy, quote-into-input, save-as-note, insert-into-active-note, regenerate.
// User actions: copy, edit-resend (loads text back into input for re-send).

import { App, Notice, setIcon, TFile } from 'obsidian';
import type { ConversationMessage } from '../types';
import { saveMessageAsNote } from '../vault/notes';
import { getActiveNoteView } from '../vault/active-note';

export interface MessageActionCallbacks {
	/** Regenerate: drop the trailing assistant message + re-run last user msg. */
	onRegenerate?: (assistantMsg: ConversationMessage) => void;
	/** Append the message as a markdown blockquote into the chat input box. */
	onQuoteIntoInput?: (assistantMsg: ConversationMessage) => void;
}

export interface UserMessageActionCallbacks {
	/** Edit-resend for a user bubble directly: truncate + load text into input. */
	onEditUserMessage?: (userMsg: ConversationMessage) => void;
}

export interface AttachActionsOptions {
	app: App;
	/** The wrapper element returned by appendMessageToDOM. */
	wrapper: HTMLElement;
	/** The assistant message (with id) — must be persisted already. */
	message: ConversationMessage;
	/** Folder for Save-as-note. */
	saveFolder: string;
	/** Whether to show the regenerate/edit-resend controls (false during streaming). */
	allowBranching?: boolean;
	callbacks?: MessageActionCallbacks;
}

/**
 * Attach a hover-visible actions toolbar to an assistant message wrapper.
 * Idempotent — safe to call multiple times (skips if already attached).
 */
export function attachMessageActions(opts: AttachActionsOptions): void {
	const { wrapper, message, saveFolder, app, allowBranching = true, callbacks } = opts;

	if (wrapper.querySelector('.ai-message-actions')) return;

	const bar = wrapper.createDiv({ cls: 'ai-message-actions' });

	const addAction = (
		icon: string,
		title: string,
		onClick: () => void | Promise<void>
	): void => {
		const btn = bar.createEl('button', { cls: 'ai-message-action-btn' });
		setIcon(btn, icon);
		btn.title = title;
		btn.setAttribute('aria-label', title);
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			void onClick();
		});
	};

	// Copy raw markdown to clipboard
	addAction('copy', 'Copy message', async () => {
		try {
			await navigator.clipboard.writeText(message.content);
			new Notice('Copied');
		} catch {
			new Notice('Copy failed');
		}
	});

	// Quote into the chat input (not clipboard) — turns the message into a
	// `> ...` blockquote appended to whatever you're typing, ready to send.
	if (callbacks?.onQuoteIntoInput) {
		addAction('quote', 'Quote into input', () => callbacks.onQuoteIntoInput!(message));
	}

	// Save as a new note in the configured folder
	addAction('file-plus', `Save as note (${saveFolder || 'vault root'})`, async () => {
		const file = await saveMessageAsNote(app, message, saveFolder, { open: true });
		if (file instanceof TFile) new Notice(`Saved: ${file.basename}`);
	});

	// Insert into the user's active note (center-area markdown view) at cursor.
	// Uses getActiveNoteView so it works even when the chat sidebar has focus.
	addAction('square-arrow-down', 'Insert into active note', () => {
		const view = getActiveNoteView(app);
		if (!view || !view.editor) {
			new Notice('No note open in the main area. Open a note first.');
			return;
		}
		const editor = view.editor;
		const cursor = editor.getCursor();
		const prefix = editor.getLine(cursor.line).trim().length > 0 ? '\n\n' : '';
		editor.replaceRange(prefix + message.content + '\n', cursor);
		new Notice(`Inserted into ${view.file?.basename ?? 'note'}`);
	});

	if (allowBranching) {
		if (callbacks?.onRegenerate) {
			addAction('refresh-cw', 'Regenerate', () => callbacks.onRegenerate!(message));
		}
	}
}

/**
 * Attach an INLINE actions row BELOW a user bubble. Different from the
 * assistant attachMessageActions (which floats absolute top-right) — this
 * sits in normal flow so it can't break the bubble layout. Right-aligned
 * to match the user bubble alignment.
 *
 * Actions: Copy, Edit & resend.
 */
export function attachUserMessageActions(
	wrapper: HTMLElement,
	message: ConversationMessage,
	callbacks: UserMessageActionCallbacks
): void {
	if (wrapper.querySelector('.ai-user-actions')) return;

	const bar = wrapper.createDiv({ cls: 'ai-user-actions' });

	const addAction = (icon: string, title: string, onClick: () => void | Promise<void>): void => {
		const btn = bar.createEl('button', { cls: 'ai-message-action-btn' });
		setIcon(btn, icon);
		btn.title = title;
		btn.setAttribute('aria-label', title);
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			void onClick();
		});
	};

	addAction('copy', 'Copy message', async () => {
		try {
			await navigator.clipboard.writeText(message.content);
			new Notice('Copied');
		} catch {
			new Notice('Copy failed');
		}
	});

	if (callbacks.onEditUserMessage) {
		addAction('pencil', 'Edit & resend', () => callbacks.onEditUserMessage!(message));
	}
}

