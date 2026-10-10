// Resolve the user's "active" note even when the chat sidebar has focus.
//
// `workspace.getActiveViewOfType(MarkdownView)` returns the view that holds
// keyboard focus — which is the chat itself, not the note the user means.
// Instead we walk every open markdown leaf and pick the best candidate:
//   1. prefer leaves in the center/main area (root is neither sidebar root)
//   2. among those, prefer the workspace's activeEditor leaf if it's markdown
//   3. otherwise take the first

import { App, MarkdownView, TFile } from 'obsidian';
import type { Workspace, WorkspaceLeaf } from 'obsidian';

function isCenterLeaf(leaf: WorkspaceLeaf, workspace: Workspace): boolean {
	// getRoot() returns the root object the leaf descends from: the main
	// window's root, one of the sidebar roots, or a popout window's own root.
	// Identity against the sidebar roots covers every center-area case,
	// popouts included.
	const root = leaf.getRoot();
	return root !== workspace.leftSplit && root !== workspace.rightSplit;
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

	// Fast path: if there's an active editor with a file, that's authoritative.
	const activeFile = workspace.activeEditor?.file;
	if (activeFile) return activeFile;

	const markdownLeaves = workspace.getLeavesOfType('markdown');
	if (markdownLeaves.length === 0) return null;

	// Prefer center-area leaves; the chat sidebar lives in the side dock.
	const centerLeaves = markdownLeaves.filter((leaf) => isCenterLeaf(leaf, workspace));
	const pool = centerLeaves.length > 0 ? centerLeaves : markdownLeaves;

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
