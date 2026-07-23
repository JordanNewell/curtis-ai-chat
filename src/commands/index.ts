import { Editor, Notice } from 'obsidian';
import type CurtisPlugin from '../main';

export function registerCommands(plugin: CurtisPlugin): void {
	// ── Chat Commands ──
	plugin.addCommand({
		id: 'open-chat',
		name: 'Open AI Chat',
		callback: () => plugin.activateChatView(),
	});

	plugin.addCommand({
		id: 'new-chat',
		name: 'New Chat Conversation',
		callback: () => plugin.activateChatView(true),
	});

	plugin.addCommand({
		id: 'search-conversations',
		name: 'Search conversations',
		callback: () => {
			void plugin.openChatSearch();
		},
	});

	// ── Selection Commands ──
	plugin.addCommand({
		id: 'summarize-selection',
		name: 'Summarize selection',
		editorCallback: (editor) => plugin.processSelection(editor, 'summarize'),
	});

	plugin.addCommand({
		id: 'explain-selection',
		name: 'Explain selection',
		editorCallback: (editor) => plugin.processSelection(editor, 'explain'),
	});

	plugin.addCommand({
		id: 'improve-selection',
		name: 'Improve writing of selection',
		editorCallback: (editor) => plugin.processSelection(editor, 'improve'),
	});

	plugin.addCommand({
		id: 'translate-selection',
		name: 'Translate selection',
		editorCallback: (editor) => plugin.processSelection(editor, 'translate'),
	});

	plugin.addCommand({
		id: 'code-review-selection',
		name: 'Review code selection',
		editorCallback: (editor) => plugin.processSelection(editor, 'code-review'),
	});

	plugin.addCommand({
		id: 'explain-code-selection',
		name: 'Explain code selection',
		editorCallback: (editor) => plugin.processSelection(editor, 'explain-code'),
	});

	plugin.addCommand({
		id: 'generate-from-selection',
		name: 'Generate text from selection',
		editorCallback: (editor) => plugin.processSelection(editor, 'generate'),
	});

	plugin.addCommand({
		id: 'extract-key-points',
		name: 'Extract key points from selection',
		editorCallback: (editor) => plugin.processSelection(editor, 'key-points'),
	});

	// ── Diff Rewrite (Cursor-style inline rewrite) ──
	plugin.addCommand({
		id: 'rewrite-with-ai',
		name: 'Rewrite selection with AI (with diff)',
		editorCallback: (editor: Editor) => {
			const selection = editor.getSelection();
			if (!selection) {
				new Notice('Select some text first');
				return;
			}
			void plugin.runDiffRewrite(editor, selection);
		},
	});

	// ── Extended Selection Commands ──
	const extended: Array<[string, string, string]> = [
		['fix-grammar-selection', 'Fix grammar of selection', 'fix-grammar'],
		['shorten-selection', 'Shorten selection', 'shorten'],
		['tldr-selection', 'TL;DR selection', 'tldr'],
		['refactor-selection', 'Refactor code selection', 'refactor'],
		['add-tests-selection', 'Add tests for selection', 'add-tests'],
		['convert-callout-selection', 'Convert selection to callout', 'convert-callout'],
		['extract-links-selection', 'Extract wikilinks from selection', 'extract-links'],
		['eli5-selection', 'Explain selection like I am 5', 'eli5'],
		['table-from-text-selection', 'Make a table from selection', 'table-from-text'],
		['pros-cons-selection', 'List pros and cons from selection', 'pros-cons'],
	];
	for (const [id, name, action] of extended) {
		plugin.addCommand({
			id,
			name,
			editorCallback: (editor) => plugin.processSelection(editor, action),
		});
	}
}
