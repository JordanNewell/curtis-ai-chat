import { Editor, Notice, Platform } from 'obsidian';
import type CurtisPlugin from '../main';
import { rebuildIndexWithProgress } from '../rag';
import { openImportDialog } from '../import/importer';
import { downloadConversationsCurtZip } from '../import/curt';
import { AgentPickerModal } from '../ui/modals/agent-picker-modal';

export function registerCommands(plugin: CurtisPlugin): void {
	// ── Chat Commands ──
	plugin.addCommand({
		id: 'open-chat',
		name: 'Open chat',
		callback: () => plugin.activateChatView(),
	});

	plugin.addCommand({
		id: 'new-chat',
		name: 'New chat conversation',
		callback: () => plugin.activateChatView(true),
	});

	// Named agents — pick a lane first, then open a fresh pane bound to it.
	// The conversation is created up front so the pane bind carries the
	// agent's provider/model instead of the workspace defaults.
	plugin.addCommand({
		id: 'new-chat-with-agent',
		name: 'New chat with agent…',
		callback: () => {
			new AgentPickerModal(plugin.app, plugin, (agent) => {
				if (!agent) return;
				const conv = plugin.conversationStore.createConversation(agent.providerId, agent.modelId);
				plugin.conversationStore.setConversationAgent(conv.id, agent.id);
				void plugin.openNewChatPane('tab', conv.id);
			}).open();
		},
	});

	// Multi-pane support — each additional tab binds its own conversation.
	plugin.addCommand({
		id: 'open-new-chat-tab',
		name: 'Open new chat tab',
		callback: () => plugin.openNewChatPane('tab'),
	});

	plugin.addCommand({
		id: 'open-chat-window',
		name: 'Open chat in new window',
		callback: () => plugin.openNewChatPane('window'),
	});

	// ── Terminal (window: desktop only — OS windows don't exist on mobile.
	// The tab variant runs the vault shell there; both run the OS shell on
	// desktop.) The plain pair reveals an existing terminal; the "new" pair
	// mirrors the chat commands and always creates one. ──
	plugin.addCommand({
		id: 'open-terminal',
		name: 'Open terminal window',
		checkCallback: (checking: boolean) => {
			if (!Platform.isDesktop) return false;
			if (!checking) void plugin.openTerminalPane('window');
			return true;
		},
	});

	plugin.addCommand({
		id: 'open-terminal-tab',
		name: 'Open terminal tab',
		callback: () => plugin.openTerminalPane('tab'),
	});

	plugin.addCommand({
		id: 'open-new-terminal-tab',
		name: 'Open new terminal tab',
		callback: () => plugin.openTerminalPane('tab', { another: true }),
	});

	plugin.addCommand({
		id: 'open-terminal-new-window',
		name: 'Open terminal in new window',
		checkCallback: (checking: boolean) => {
			if (!Platform.isDesktop) return false;
			if (!checking) void plugin.openTerminalPane('window', { another: true });
			return true;
		},
	});

	plugin.addCommand({
		id: 'search-conversations',
		name: 'Search conversations',
		callback: () => {
			void plugin.openChatSearch();
		},
	});

	plugin.addCommand({
		id: 'import-chats',
		name: 'Import chats from other AI tools',
		callback: () => openImportDialog(plugin),
	});

	plugin.addCommand({
		id: 'export-all-chats-curt',
		name: 'Export all chats as .curt (zip)',
		callback: () => downloadConversationsCurtZip(plugin.conversationStore.getAllConversations(), plugin.manifest.version),
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

	// ── Custom selection actions ──
	// One palette command per user-defined action. Commands are registered at
	// load — edits in settings apply on the next reload (the context menu
	// picks them up immediately).
	for (const custom of plugin.settings.customSelectionActions) {
		plugin.addCommand({
			id: `custom-selection-${custom.id}`,
			name: custom.name,
			editorCallback: (editor) => plugin.processSelection(editor, custom.id),
		});
	}

	// ── Vault retrieval (RAG) ──
	plugin.addCommand({
		id: 'rebuild-vault-index',
		name: 'Rebuild vault index (vault retrieval)',
		checkCallback: (checking: boolean) => {
			if (!plugin.settings.enableRag) return false;
			if (!checking) void rebuildIndexWithProgress(plugin);
			return true;
		},
	});
}
