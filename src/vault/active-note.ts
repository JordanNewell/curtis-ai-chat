// Resolve the user's "active" note even when the chat sidebar has focus.
//
// `workspace.getActiveViewOfType(MarkdownView)` returns the view that holds
// keyboard focus — which is the chat itself, not the note the user means.
// Instead we walk every open markdown leaf and pick the best candidate:
//   1. prefer leaves in the center/main area (getContainer() is WorkspaceRoot)
//   2. among those, prefer the workspace's activeLeaf if it's a markdown view
//   3. otherwise take the first

import { App, MarkdownView, TFile } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';

function isCenterLeaf(leaf: WorkspaceLeaf): boolean {
	try {
		const container = leaf.getContainer?.();
		const name: string | undefined = container?.constructor?.name;
		// WorkspaceRoot (main) or WorkspaceWindow (popout window)
		return name === 'WorkspaceRoot' || name === 'WorkspaceWindow';
	} catch {
		return false;
	}
}

function fileFromLeaf(leaf: WorkspaceLeaf): TFile | null {
	const view = leaf.view;
	if (view instanceof MarkdownView && view.file) return view.file;
	return null;
}

/**
 * Return the TFile of the user's active note, or null if none is open.
 * Robust against the chat sidebar holding keyboard focus.
 */
export function getActiveNoteFile(app: App): TFile | null {
	const workspace = app.workspace;

	// Fast path: if the activeLeaf is a markdown view, that's authoritative.
	const activeLeaf = workspace.activeLeaf;
	if (activeLeaf) {
		const f = fileFromLeaf(activeLeaf);
		if (f) return f;
	}

	const markdownLeaves = workspace.getLeavesOfType('markdown');
	if (markdownLeaves.length === 0) return null;

	// Prefer center-area leaves; the chat sidebar lives in the side dock.
	const centerLeaves = markdownLeaves.filter(isCenterLeaf);
	const pool = centerLeaves.length > 0 ? centerLeaves : markdownLeaves;

	// If activeLeaf is in the pool, use it; else take the first.
	for (const leaf of pool) {
		if (leaf === activeLeaf) return fileFromLeaf(leaf);
	}
	return fileFromLeaf(pool[0]);
}

/** Convenience: active MarkdownView (for editor mutations) using the same logic. */
export function getActiveNoteView(app: App): MarkdownView | null {
	const file = getActiveNoteFile(app);
	if (!file) return null;
	const leaves = app.workspace.getLeavesOfType('markdown');
	for (const leaf of leaves) {
		const view = leaf.view;
		if (view instanceof MarkdownView && view.file === file) return view;
	}
	return null;
}
