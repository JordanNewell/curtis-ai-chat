// Slash command parser + registry. The ChatView intercepts the input on Send:
// if the trimmed text starts with `/`, dispatch via handleSlashCommand, which
// either consumes it (returns true) or lets the send fall through (false).

import { App, Notice, TFile } from 'obsidian';
import type { ConversationStore } from './conversation-store';
import { downloadConversationMarkdown } from './export';
import { createNote, renderConversationAsMarkdown, saveMessageAsNote } from '../vault/notes';
import { SlashHelpModal } from '../ui/modals/slash-help-modal';
import type CurtisPlugin from '../main';

export interface SlashCommand {
	/** Command name without leading slash. Lowercase. */
	name: string;
	/** Display usage, e.g. "/note [name]". */
	usage: string;
	description: string;
	/** Returns true if handled (send suppressed). */
	run: (ctx: SlashContext) => Promise<boolean> | boolean;
}

export interface SlashContext {
	plugin: CurtisPlugin;
	app: App;
	/** The full input string including the slash. */
	raw: string;
	/** Arguments (everything after the command word). */
	args: string;
	/** Helper to replace the input box value. */
	setInput: (text: string) => void;
	/** Helper to focus the input. */
	focusInput: () => void;
	/** Regenerate the last assistant response. */
	regenerate: () => void;
	/** Re-render the current conversation. */
	refresh: () => void;
	/** Start a new chat. */
	newChat: () => void;
}

const findConv = (store: ConversationStore) => store.getCurrentConversation();

export const SLASH_COMMANDS: SlashCommand[] = [
	{
		name: 'clear',
		usage: '/clear',
		description: 'Start a new chat',
		run: (ctx) => {
			ctx.newChat();
			return true;
		},
	},
	{
		name: 'regen',
		usage: '/regen',
		description: 'Regenerate the last assistant response',
		run: (ctx) => {
			ctx.regenerate();
			return true;
		},
	},
	{
		name: 'regenerate',
		usage: '/regenerate',
		description: 'Alias of /regen',
		run: (ctx) => {
			ctx.regenerate();
			return true;
		},
	},
	{
		name: 'title',
		usage: '/title <text>',
		description: 'Rename the current conversation',
		run: (ctx) => {
			const conv = findConv(ctx.plugin.conversationStore);
			const title = ctx.args.trim();
			if (!conv) return true;
			if (!title) {
				new Notice('Usage: /title <new name>');
				return true;
			}
			ctx.plugin.conversationStore.renameCurrentConversation(title);
			ctx.refresh();
			new Notice(`Renamed to "${title}"`);
			return true;
		},
	},
	{
		name: 'copy',
		usage: '/copy',
		description: 'Copy the last assistant response',
		run: async (ctx) => {
			const last = ctx.plugin.conversationStore.getLastAssistantMessage();
			if (!last) {
				new Notice('No assistant message to copy');
				return true;
			}
			try {
				await navigator.clipboard.writeText(last.content);
				new Notice('Copied last response');
			} catch {
				new Notice('Copy failed');
			}
			return true;
		},
	},
	{
		name: 'note',
		usage: '/note [name]',
		description: 'Save the last assistant response as a new note',
		run: async (ctx) => {
			const last = ctx.plugin.conversationStore.getLastAssistantMessage();
			if (!last) {
				new Notice('No assistant message to save');
				return true;
			}
			const folder = ctx.plugin.settings.noteSaveFolder;
			const name = ctx.args.trim();
			const file = name
				? await createNote(ctx.app, folder, name, last.content, { open: true, frontmatter: { source: 'Curtis', provider: last.provider, model: last.model } })
				: await saveMessageAsNote(ctx.app, last, folder, { open: true });
			if (file instanceof TFile) new Notice(`Saved: ${file.basename}`);
			return true;
		},
	},
	{
		name: 'save-all',
		usage: '/save-all [name]',
		description: 'Export the whole conversation to a single note',
		run: async (ctx) => {
			const conv = findConv(ctx.plugin.conversationStore);
			if (!conv || conv.messages.length === 0) {
				new Notice('Nothing to export');
				return true;
			}
			const folder = ctx.plugin.settings.noteSaveFolder;
			const body = renderConversationAsMarkdown(conv.messages, conv.title);
			const name = ctx.args.trim() || conv.title;
			const file = await createNote(ctx.app, folder, name, body, { open: true });
			if (file instanceof TFile) new Notice(`Exported: ${file.basename}`);
			return true;
		},
	},
	{
		name: 'export',
		usage: '/export',
		description: 'Download current conversation as a markdown file',
		run: (ctx) => {
			const conv = findConv(ctx.plugin.conversationStore);
			if (!conv || conv.messages.length === 0) {
				new Notice('Nothing to export');
				return true;
			}
			downloadConversationMarkdown(conv, {
				providerName: (id) => ctx.plugin.providerRegistry.getProvider(id)?.name,
			});
			new Notice(`Exported: ${conv.title}`);
			return true;
		},
	},
	{
		name: 'paste',
		usage: '/paste',
		description: 'Paste from clipboard into the input',
		run: async (ctx) => {
			try {
				const text = await navigator.clipboard.readText();
				ctx.setInput(text);
				ctx.focusInput();
			} catch {
				new Notice('Clipboard read denied (allow clipboard access)');
			}
			return true;
		},
	},
	{
		name: 'model',
		usage: '/model <name>',
		description: 'Switch active model (fuzzy match)',
		run: (ctx) => {
			const q = ctx.args.trim().toLowerCase();
			if (!q) {
				new Notice('Usage: /model <name>');
				return true;
			}
			const providers = ctx.plugin.providerRegistry.getAllEnabledProviders();
			let best: { providerId: string; modelId: string; score: number } | null = null;
			for (const { id, provider } of providers) {
				for (const m of provider.models) {
					const hay = `${provider.name} ${m.name} ${m.id}`.toLowerCase();
					const score = fuzzyScore(q, hay);
					if (score > 0 && (!best || score > best.score)) {
						best = { providerId: id, modelId: m.id, score };
					}
				}
			}
			if (!best) {
				new Notice(`No model matching "${q}"`);
				return true;
			}
			ctx.plugin.settings.activeProvider = best.providerId;
			ctx.plugin.settings.activeModel = best.modelId;
			void ctx.plugin.saveSettings();
			const provider = ctx.plugin.providerRegistry.getProvider(best.providerId);
			new Notice(`Model: ${provider?.name} / ${best.modelId}`);
			ctx.refresh();
			return true;
		},
	},
	{
		name: 'provider',
		usage: '/provider <name>',
		description: 'Switch active provider (fuzzy match)',
		run: (ctx) => {
			const q = ctx.args.trim().toLowerCase();
			if (!q) {
				new Notice('Usage: /provider <name>');
				return true;
			}
			const providers = ctx.plugin.providerRegistry.getAllEnabledProviders();
			let best: { id: string; score: number } | null = null;
			for (const { id, provider } of providers) {
				const score = fuzzyScore(q, `${provider.name} ${id}`.toLowerCase());
				if (score > 0 && (!best || score > best.score)) {
					best = { id, score };
				}
			}
			if (!best) {
				new Notice(`No provider matching "${q}"`);
				return true;
			}
			const provider = ctx.plugin.providerRegistry.getProvider(best.id);
			const firstModel = provider?.models[0]?.id;
			ctx.plugin.settings.activeProvider = best.id;
			if (firstModel) ctx.plugin.settings.activeModel = firstModel;
			void ctx.plugin.saveSettings();
			new Notice(`Provider: ${provider?.name}`);
			ctx.refresh();
			return true;
		},
	},
	{
		name: 'system',
		usage: '/system <text>',
		description: 'Set the system prompt (empty resets to default)',
		run: (ctx) => {
			const text = ctx.args.trim();
			if (!text) {
				ctx.plugin.settings.systemPrompt =
					'You are a helpful AI assistant integrated into Obsidian. Help the user with writing, analysis, coding, and knowledge management.';
				new Notice('System prompt reset to default');
			} else {
				ctx.plugin.settings.systemPrompt = text;
				new Notice('System prompt updated');
			}
			void ctx.plugin.saveSettings();
			return true;
		},
	},
	{
		name: 'stats',
		usage: '/stats',
		description: 'Show conversation stats (tokens, messages)',
		run: (ctx) => {
			const stats = ctx.plugin.conversationStore.getStats();
			new Notice(
				`${stats.totalConversations} conv · ${stats.totalMessages} msgs · ${stats.totalTokens.toLocaleString()} tokens`,
				5000
			);
			return true;
		},
	},
	{
		name: 'help',
		usage: '/help',
		description: 'Show all slash commands',
		run: (ctx) => {
			new SlashHelpModal(ctx.app).open();
			return true;
		},
	},
	{
		name: 'remember',
		usage: '/remember <fact>',
		description: 'Manually save a durable fact to memory',
		run: async (ctx) => {
			const text = ctx.args.trim();
			if (!text) {
				new Notice('Usage: /remember <fact>');
				return true;
			}
			await ctx.plugin.memoryStore.addFact(text);
			new Notice('Saved to memory');
			return true;
		},
	},
	{
		name: 'forget',
		usage: '/forget <substring>',
		description: 'Delete the first memory whose content matches the substring',
		run: async (ctx) => {
			const q = ctx.args.trim().toLowerCase();
			if (!q) {
				new Notice('Usage: /forget <substring>');
				return true;
			}
			const facts = ctx.plugin.memoryStore.getFacts();
			const hit = facts.find((f) => f.content.toLowerCase().includes(q));
			if (!hit) {
				new Notice('No matching memory');
				return true;
			}
			await ctx.plugin.memoryStore.deleteFact(hit.id);
			new Notice(`Forgot: ${hit.content.slice(0, 60)}`);
			return true;
		},
	},
	{
		name: 'memory',
		usage: '/memory',
		description: 'Show remembered facts or open the memory file',
		run: async (ctx) => {
			const facts = ctx.plugin.memoryStore.getFacts();
			if (facts.length === 0) {
				new Notice('Memory is empty');
				return true;
			}
			const sub = ctx.args.trim().toLowerCase();
			if (sub === 'open') {
				await ctx.plugin.memoryStore.ensureFile();
				await ctx.app.workspace.openLinkText(ctx.plugin.settings.memoryFilePath, '', false);
				return true;
			}
			if (sub === 'clear') {
				await ctx.plugin.memoryStore.clear();
				return true;
			}
			// Default: show a Notice with a short summary.
			const sample = facts.slice(-8).map((f) => `• ${f.content}${f.category ? ` [${f.category}]` : ''}`).join('\n');
			new Notice(`Memory (${facts.length} facts):\n${sample}`, 8000);
			return true;
		},
	},
];

/** Very small fuzzy scorer: returns 0 if no chars match, higher = better. */
function fuzzyScore(needle: string, haystack: string): number {
	let score = 0;
	let ni = 0;
	for (let i = 0; i < haystack.length && ni < needle.length; i++) {
		if (haystack[i] === needle[ni]) {
			score += i === 0 || haystack[i - 1] === ' ' || haystack[i - 1] === '/' || haystack[i - 1] === '-' ? 3 : 1;
			ni++;
		}
	}
	return ni === needle.length ? score : 0;
}

/**
 * Try to handle `raw` as a slash command. Returns true if consumed.
 * Caller passes helpers via ctx.
 */
export async function handleSlashCommand(raw: string, ctx: SlashContext): Promise<boolean> {
	const trimmed = raw.trim();
	if (!trimmed.startsWith('/')) return false;
	const space = trimmed.indexOf(' ');
	const name = (space === -1 ? trimmed.slice(1) : trimmed.slice(1, space)).toLowerCase();
	const args = space === -1 ? '' : trimmed.slice(space + 1);
	const cmd = SLASH_COMMANDS.find((c) => c.name === name);
	if (!cmd) return false; // Unknown command — fall through to send
	try {
		return await cmd.run({ ...ctx, raw, args });
	} catch (e) {
		console.error(`[Curtis] /${name} failed:`, e);
		new Notice(`/${name} failed: ${(e as Error).message}`);
		return true;
	}
}

/** Suggestions for the autocomplete dropdown as the user types `/…`. */
export function slashSuggestions(prefix: string): SlashCommand[] {
	const q = prefix.toLowerCase();
	if (!q.startsWith('/')) return [];
	const head = q.slice(1).split(/\s/)[0];
	if (!head) return SLASH_COMMANDS;
	return SLASH_COMMANDS.filter((c) => c.name.startsWith(head));
}
