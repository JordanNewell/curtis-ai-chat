// Sidebar Chat View — persistent ItemView for AI chat

import { ItemView, Menu, Notice, Platform, WorkspaceLeaf, setIcon, TFile, debounce } from 'obsidian';
import type { Conversation, ConversationMessage, AIMessage, MessageContent, TokenUsage, ToolCall, MemoryProposal } from '../types';
import { toBase64 } from '../utils/base64';
import { MessageRenderer } from './message-renderer';
import { CURTIS_ICON_ID } from '../icons';
import { ConversationStore } from './conversation-store';
import { ModelPickerModal, buildModelPickerEntries } from '../ui/modals/model-picker-modal';
import { ArenaModelPickerModal } from '../ui/modals/arena-model-picker-modal';
import type { ArenaSelection, ArenaModelEntry } from '../ui/modals/arena-model-picker-modal';
import { attachMessageActions, attachUserMessageActions } from './message-actions';
import { handleSlashCommand, slashSuggestions, type SlashContext } from './slash-commands';
import { runRecap } from './recap';
import { downloadConversationMarkdown } from './export';
import { downloadConversationCurt } from '../import/curt';
import { importDroppedFiles } from '../import/importer';
import { saveMessageAsNote, saveImageToVault } from '../vault/notes';
import { getActiveNoteFile } from '../vault/active-note';
import { composeSystemPrompt } from '../core/system-prompt';
import { formatRetrievedContext } from '../rag';
import {
	VoiceRecorder,
	transcribeAudio,
	speakText,
	stopSpeaking,
	isMediaRecorderSupported,
	isSpeechSupported,
} from './voice';
import { TTSController } from './tts-controller';
import { notifyResponse, responsePreview } from './notifications';
import type CurtisPlugin from '../main';

export const CHAT_VIEW_TYPE = 'curtis-chat';

/** Brand color per built-in provider id. Used for the role/picker dot.
 *  Custom providers fall back to --interactive-accent via CSS. */
const PROVIDER_COLORS: Record<string, string> = {
	anthropic: '#d97757',
	openai: '#10a37f',
	gemini: '#4285f4',
	'zai-glm': '#3b82f6',
	ollama: '#9333ea',
	openrouter: '#6464ff',
	mistral: '#fa520f',
	groq: '#f55036',
	deepseek: '#4d6bfe',
	xai: '#ffffff',
	perplexity: '#20808d',
	novita: '#00d4aa',
	deepinfra: '#ff6b35',
	hyperbolic: '#a855f7',
	chutes: '#facc15',
	replicate: '#000000',
	lepton: '#7c3aed',
	lambda: '#ef4444',
	huggingface: '#ff9d00',
	'azure-openai': '#0078d4',
	'github-models': '#6e40c9',
	fal: '#7c3aed',
	cerebras: '#e63946',
	sambanova: '#1e88e5',
	requesty: '#22c55e',
};

function providerColor(providerId: string | undefined): string | undefined {
	if (!providerId) return undefined;
	// Direct hit
	if (PROVIDER_COLORS[providerId]) return PROVIDER_COLORS[providerId];
	// Partial match (e.g. custom providers with prefixed ids)
	const lower = providerId.toLowerCase();
	for (const key of Object.keys(PROVIDER_COLORS)) {
		if (lower.includes(key)) return PROVIDER_COLORS[key];
	}
	return undefined;
}

/** Map a file extension to a MIME type for the data URL prefix. */
function imageMimeFromExt(ext: string): string {
	const e = ext.toLowerCase();
	const map: Record<string, string> = {
		png: 'image/png',
		jpg: 'image/jpeg',
		jpeg: 'image/jpeg',
		gif: 'image/gif',
		webp: 'image/webp',
		svg: 'image/svg+xml',
		bmp: 'image/bmp',
		avif: 'image/avif',
	};
	return map[e] || 'image/png';
}

/** ArrayBuffer → base64 string (Obsidian's readBinary returns ArrayBuffer). */
function bytesToBase64(buf: ArrayBuffer): string {
	return toBase64(new Uint8Array(buf));
}

/**
 * Translate a provider/stream error into a user-readable message with the
 * likely cause + suggested fix. Patterns observed across providers:
 *   - "image" / "vision" / "multimodal" → model can't handle images
 *   - HTTP 401/403 → auth
 *   - HTTP 413 → payload too large (often: image too big)
 *   - HTTP 429 → rate limit
 *   - HTTP 5xx → provider down
 */
/**
 * Model-level failure patterns: the selected model id was retired, gated, or
 * unknown to the provider. Checked BEFORE the 401/403 branch because gated
 * and decommissioned models often surface as 403/404 — classifying them as
 * auth failures sends users off to re-enter API keys that are perfectly valid.
 */
const MODEL_UNAVAILABLE_RE =
	/model[_\s-]*not[_\s-]*(found|exist|available)|model_not_found|unknown model|invalid model|unsupported model|access to (this|the|that) model|model.*(decommissioned|deprecated|retired|no longer|does not exist|doesn.t exist)/;
/** Weaker signals that only indicate a dead model when the error body also
 *  names the model or carries a 404 status (e.g. OpenAI's "The model `x`
 *  does not exist or you do not have access to it", z.ai's "model not
 *  supported" for ids the plan stopped serving). */
const MODEL_GONE_WEAK_RE = /(does not|doesn.t) exist|not available|no longer|not supported|unsupported/;

function friendlyError(error: Error, hasImages = false): { message: string; cause?: string } {
	const msg = (error.message || '').toLowerCase();
	const mentionsModel = msg.includes('model');
	const has404 = /(^|[^0-9])404([^0-9]|$)/.test(msg);

	if (/(image|vision|multimodal|unsupported.*media)/.test(msg) && hasImages) {
		return {
			message: `This model rejected the image. Switch to a vision-capable model via the picker (look for the 👁 icon), or remove the image and resend.`,
		};
	}
	if (MODEL_UNAVAILABLE_RE.test(msg) || ((MODEL_GONE_WEAK_RE.test(msg) || has404) && mentionsModel)) {
		return {
			message: 'This model is no longer available from the provider — it was likely retired or your key does not have access to it. Pick a current model from the model picker.',
		};
	}
	if (/(^|[^0-9])(401|403)([^0-9]|$)|unauthor|invalid.*api.*key|invalid.*key/.test(msg)) {
		return { message: 'Auth failed — check the API key for this provider in Settings.' };
	}
	if (/413|payload too large|request entity too large/.test(msg)) {
		return { message: 'Request too large. Try a smaller image or shorter message.' };
	}
	if (/429|rate limit|too many requests/.test(msg)) {
		return { message: 'Rate-limited by provider. Wait a moment and retry.' };
	}
	if (/(^|[^0-9])5\d{2}([^0-9]|$)|server error|internal error/.test(msg)) {
		return { message: 'Provider is having issues (5xx). Try again or switch providers.' };
	}
	if (/network|fetch|timeout|econnreset|enotfound/.test(msg)) {
		return { message: 'Network error — check your connection or the provider endpoint.' };
	}
	return { message: error.message || 'Request failed' };
}

/** Outcome of one arena column — drives the end-of-round notification. */
interface ArenaColumnResult {
	streamed: boolean;
	failed: boolean;
	aborted: boolean;
}

export class ChatView extends ItemView {
	plugin: CurtisPlugin;
	private renderer: MessageRenderer;
	private store: ConversationStore;
	private messagesContainer!: HTMLElement;
	/** Conversation THIS pane renders. Per-instance so multiple panes (splits,
	 *  popout windows) can each hold a different conversation; null only
	 *  before the first bind (fresh vault, no conversations yet). */
	private conversationId: string | null = null;
	/** Provider/model THIS pane chats with. Initialized from the global
	 *  settings (the default for newly opened panes) and persisted back on
	 *  change — the last pane the user touched wins as the default. */
	private activeProviderId = '';
	private activeModelId = '';
	/** True while this view handles its own re-render after a store write —
	 *  conversation:changed handlers skip so panes don't double-render. */
	private suppressStoreEvents = false;
	/** Unsubscriber for the plugin eventBus conversation listener. */
	private unsubscribeStoreEvents: (() => void) | null = null;
	/** Tracks whether the most recent send included images — passed into
	 *  friendlyError so it can disambiguate image-rejection errors. Instance
	 *  field (not module-level) so two open ChatViews never cross-talk. */
	private currentSendHasImages = false;
	/** Persistent background layer (wallpaper + brand watermark). */
	private backgroundLayer!: HTMLElement;
	/** Hint row below input — text reflects current enterKeyBehavior setting. */
	private inputHintEl!: HTMLElement;
	private inputEl!: HTMLTextAreaElement;
	private sendBtn!: HTMLButtonElement;
	private abortBtn!: HTMLButtonElement;
	private isGenerating = false;
	private abortController: AbortController | null = null;
	private streamingContent = '';
	/** Slash autocomplete dropdown (created lazily). */
	private slashMenu: HTMLElement | null = null;
	/** @-mention autocomplete dropdown (created lazily). */
	private mentionMenu: HTMLElement | null = null;
	/** Offset of the last character of the most recently selected @-mention
	 *  (its trailing space). Prose typed after a mention still matches the
	 *  mention regex via the mention's own '@' — the menu may only reopen for
	 *  a match that starts at/after this offset, i.e. a fresh '@' typed after
	 *  the mention. Reset when the caret moves before it or the input is
	 *  replaced/cleared. */
	private mentionEndOffset = -1;
	/** Debounced vault-scan for @-mention suggestions. The scan iterates every
	 *  markdown file in the vault; coalescing rapid keystrokes prevents the
	 *  input handler from blocking the main thread on large vaults. The hide
	 *  path runs immediately so the menu closes the instant `@` is gone. */
	private debouncedMentionLookup = debounce((match: RegExpMatchArray) => {
		const query = match[1].trim();
		const suggestions = this.getMatchingNotes(query);
		if (suggestions.length === 0) {
			this.hideMentionMenu();
			return;
		}
		this.renderMentionMenu(suggestions, match.index ?? -1);
	}, 200);
	/** Pending note attachments for the next user message. Each entry is a
	 *  vault TFile referenced via @-mention. Contents are read at send time
	 *  and prepended to the message sent to the AI (invisible in the bubble). */
	private pendingNoteAttachments: TFile[] = [];
	/** Pending image attachments for the next user message.
	 *  `path` is the vault-internal file path (real TFile); `thumbUrl` is a
	 *  resource URL good for the lifetime of the view (used for thumbnails). */
	private pendingImages: Array<{ path: string; thumbUrl: string; name: string }> = [];
	/** Thumbnail strip above the input. */
	private imageStrip!: HTMLElement;
	/** Paperclip button — opens OS file picker or accepts drops. */
	private attachBtn!: HTMLButtonElement;
	/** Mic button — toggles voice recording for Whisper STT. */
	private micBtn!: HTMLButtonElement;
	/** Auto-speak toggle in the header — speaks new assistant responses aloud. */
	private autoSpeakBtn!: HTMLButtonElement;

	// --- Voice state ------------------------------------------------------
	/** Active recorder while mic is recording; null when idle. */
	private voiceRecorder: VoiceRecorder | null = null;
	/** Header toggle — when on, each new assistant message is spoken aloud. */
	private autoSpeak = false;
	/** id of the assistant message currently being spoken, or null. */
	private currentlySpeaking: string | null = null;
	/** Active TTS controller when the player UI is open. */
	private ttsController: TTSController | null = null;

	// --- Memory proposals (confirm-mode capture) ---------------------------
	/** Lowercased fact contents the user skipped this session — never
	 *  re-propose something the user already declined. */
	private dismissedProposals = new Set<string>();

	// --- Relevance pulse ----------------------------------------------------
	/** Active "discussed in …" hint bar, or null. */
	private pulseBar: HTMLElement | null = null;
	/** Note path the user dismissed the pulse for — never re-suggest it. */
	private pulseDismissedFor: string | null = null;
	/** file-open → pulse compute, debounced so rapid note switching is cheap. */
	private debouncedPulse = debounce((file: TFile) => void this.computePulse(file), 2000, true);

	// --- Arena mode -------------------------------------------------------
	/** True while the user has the arena toggle active. */
	private arenaMode = false;
	/** Models selected for the next arena send (2, head-to-head). */
	private arenaSelectedModels: ArenaSelection[] = [];
	/** In-flight arena AbortControllers, keyed by `${providerId}:${modelId}`. */
	private arenaAbortControllers: Map<string, AbortController> = new Map();
	/** Stored assistant message id per column of the current arena round,
	 *  keyed like arenaAbortControllers. Promote uses it to delete the losing
	 *  column's answer so the continued thread carries the winner only. */
	private arenaRoundMessages: Map<string, string | null> = new Map();

	startNewChat(): void {
		// A new chat mid-stream would repoint the store's current conversation
		// while callbacks are still writing — block like the history dropdown does.
		if (this.isGenerating || this.arenaAbortControllers.size > 0) {
			new Notice('Stop the current response before starting a new chat');
			return;
		}
		const provider = this.plugin.providerRegistry.getActiveProvider(this.activeProviderId);
		const conv = this.store.createConversation(
			provider?.id || this.activeProviderId,
			this.activeModelId
		);
		// Bind this pane to the fresh conversation (also becomes the store's
		// "most recent" — the one a newly opened pane starts on).
		this.conversationId = conv.id;
		this.pendingImages = [];
		this.pendingNoteAttachments = [];
		this.renderImageStrip();
		this.renderAttachmentChips();
		this.messagesContainer.empty();
		// Re-show the hero orb + welcome copy.
		this.renderEmptyState();
		this.inputEl.focus();
	}

	constructor(leaf: WorkspaceLeaf, plugin: CurtisPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.renderer = new MessageRenderer(plugin.app);
		this.store = plugin.conversationStore;
	}

	getViewType(): string {
		return CHAT_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Curtis AI';
	}

	getIcon(): string {
		return CURTIS_ICON_ID;
	}

	/** Custom entries for the pane menu — the visible home for the multi-
	 *  pane commands, above the native pane items. Fires for both the "..."
	 *  menu and the tab-header context menu. The popout item is desktop-
	 *  only; mobile has no popout windows. */
	onPaneMenu(menu: Menu, source: string): void {
		menu.addItem((item) => item
			.setTitle('Open new chat pane')
			.setIcon('square-split-horizontal')
			.onClick(() => void this.plugin.openNewChatPane('split')));
		if (Platform.isDesktop) {
			menu.addItem((item) => item
				.setTitle('Open chat in new window')
				.setIcon('popout')
				.onClick(() => void this.plugin.openNewChatPane('window')));
		}
		menu.addSeparator();
		super.onPaneMenu(menu, source);
	}

	/** The conversation this pane renders; undefined when unbound (fresh
	 *  vault) or the bound conversation vanished (deleted in another pane). */
	private getConversationForView(): Conversation | undefined {
		return this.conversationId ? this.store.getConversation(this.conversationId) : undefined;
	}

	/** Point this pane at a conversation and make it the store's "most
	 *  recent" (the conversation a newly opened pane starts on). Other panes
	 *  keep whatever they are bound to. Returns false when refused — blocked
	 *  mid-stream for the same reason as the history dropdown: in-flight
	 *  callbacks are pinned to the old conversation, and re-rendering under
	 *  them corrupts the live DOM. */
	switchConversation(id: string): boolean {
		if (id === this.conversationId) return true;
		if (this.isGenerating || this.arenaAbortControllers.size > 0) {
			new Notice('Stop the current response before switching conversations');
			return false;
		}
		this.conversationId = id;
		this.store.setCurrentConversation(id);
		this.renderCurrentConversation();
		return true;
	}

	/** Set this pane's model and persist it as the workspace-wide default
	 *  (existing panes keep their own selection). */
	private setActiveModel(providerId: string, modelId: string): void {
		this.activeProviderId = providerId;
		this.activeModelId = modelId;
		this.plugin.settings.activeProvider = providerId;
		this.plugin.settings.activeModel = modelId;
		void this.plugin.saveSettings();
		const btn = this.contentEl.querySelector('.ai-model-picker-btn');
		if (btn instanceof HTMLElement) this.updateModelPickerButton(btn);
	}

	/** Reconcile this pane with a conversation mutation that happened
	 *  elsewhere (another pane, a vault file edit/delete). */
	private onConversationChanged(evt: { id: string; kind: 'messages' | 'meta' | 'delete' }): void {
		if (this.suppressStoreEvents) return;
		if (evt.kind === 'delete') {
			if (evt.id === this.conversationId) {
				// Our conversation is gone mid-stream — abort first so the
				// pinned callbacks stop writing, then fall back to the most
				// recent conversation. (Partial content lands nowhere: the
				// pinned conversation no longer exists.)
				if (this.isGenerating || this.arenaAbortControllers.size > 0) {
					this.abortController?.abort();
					this.abortArena();
				}
				this.conversationId = this.store.getCurrentConversation()?.id ?? null;
				this.renderCurrentConversation();
			}
			return;
		}
		if (evt.id !== this.conversationId) return;
		// A pane mid-stream manages its own DOM; the final store writes are
		// followed by its own re-render.
		if (this.isGenerating || this.arenaAbortControllers.size > 0) return;
		this.renderCurrentConversation();
	}

	/** True while the user is looking straight at this pane — completion
	 *  notifications are suppressed to avoid announcing what's on screen. */
	private isChatVisible(): boolean {
		return this.contentEl.ownerDocument.hasFocus() && this.app.workspace.getActiveViewOfType(ChatView) === this;
	}

	async onOpen(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass('ai-chat-view');

		// Pane-header action — one-click popout. Desktop-only for the same
		// reason as the menu entry: mobile has no popout windows.
		if (Platform.isDesktop) {
			this.addAction('popout', 'Open chat in new window', () => {
				void this.plugin.openNewChatPane('window');
			});
		}

		// Per-pane binding: start on the most recent conversation with the
		// workspace-default provider/model. From here on this pane's fields
		// are the source of truth; settings hold the defaults for new panes.
		this.conversationId = this.store.getCurrentConversation()?.id ?? null;
		this.activeProviderId = this.plugin.settings.activeProvider;
		this.activeModelId = this.plugin.settings.activeModel;

		// Persistent background layer — wallpaper only. Sits behind the message
		// list (z-index 0). Empty-state copy is rendered separately by
		// renderEmptyState inside messagesContainer.
		this.renderBackground(container);

		await this.renderHeader(container);
		this.renderMessagesContainer(container);
		await this.renderInputArea(container);

		this.renderCurrentConversation();

		// Cross-pane sync — another pane (or a vault file edit) touching the
		// conversation this pane renders re-renders it here.
		this.unsubscribeStoreEvents = this.plugin.eventBus.on(
			'conversation:changed',
			(evt) => this.onConversationChanged(evt)
		);

		// Re-render the header when the user switches notes so the active-note
		// pill stays in sync. Rebuilds only the header bar (preserves the
		// message list + input state, which live in separate containers).
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				this.refreshActiveNoteIndicator();
			})
		);

		// Relevance pulse — when a newly opened note closely matches an indexed
		// past conversation, hint at it under the header. Debounced; the actual
		// similarity math is local cosine over the existing index. Two signals
		// feed the same debounced compute: file-open, and active-leaf-change
		// (which covers focus moves that don't re-emit file-open).
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				if (file) this.debouncedPulse(file);
			})
		);
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				const file = getActiveNoteFile(this.app);
				if (file) this.debouncedPulse(file);
			})
		);
	}

	/** Relevance pulse core: local cosine between the opened note and indexed
	 *  conversations. Silently no-ops unless the pulse is enabled, the note is
	 *  indexed, and a conversation clears the precision threshold — a missed
	 *  hint is invisible, a wrong one is embarrassing. */
	private async computePulse(file: TFile): Promise<void> {
		if (!this.plugin.settings.enableRelevancePulse || !this.plugin.settings.enableRag) return;
		if (file.extension !== 'md' || this.isGenerating) return;
		if (this.pulseDismissedFor === file.path) return;
		const s = this.plugin.settings;
		const convFolder = (s.conversationsFolder || 'AI/Conversations').replace(/\/+$/, '');
		// Never pulse on Curtis's own artifacts.
		if (file.path.startsWith(`${convFolder}/`)) return;
		if (file.path === s.memoryFilePath || file.path === s.journalFilePath) return;
		try {
			const match = (await this.plugin.ragIndex.findRelatedConversations(file.path, 1))[0];
			if (!match) return;
			const conv = this.plugin.conversationStore.getConversationByPath(match.filePath);
			if (!conv || conv.messages.length === 0) return;
			// Already showing that conversation — nothing to surface.
			if (conv.id === this.conversationId) return;
			this.renderPulseBar(file.path, conv.id, conv.title, conv.updatedAt);
		} catch (e) {
			console.debug('[Curtis] relevance pulse failed:', e);
		}
	}

	/** Slim dismissible hint under the header: "Discussed in …" — clicking it
	 *  jumps straight into that past conversation. */
	private renderPulseBar(notePath: string, conversationId: string, title: string, updatedAt: number): void {
		this.pulseBar?.remove();
		const header = this.contentEl.querySelector('.ai-chat-header');
		if (!(header instanceof HTMLElement)) return;
		const bar = createDiv({ cls: 'ai-chat-pulse' });
		const label = bar.createSpan({
			cls: 'ai-chat-pulse-label',
			text: `Discussed in “${title}” · ${new Date(updatedAt).toLocaleDateString()}`,
		});
		label.addEventListener('click', () => {
			// Only dismiss the bar on a successful switch — refused (mid-stream)
			// leaves it up so the user can retry after stopping the response.
			if (this.switchConversation(conversationId)) {
				this.pulseBar?.remove();
				this.pulseBar = null;
			}
		});
		const closeBtn = bar.createEl('button', {
			cls: 'ai-chat-pulse-close clickable-icon',
			attr: { 'aria-label': 'Dismiss' },
		});
		setIcon(closeBtn, 'lucide-x');
		closeBtn.addEventListener('click', () => {
			this.pulseDismissedFor = notePath;
			this.pulseBar?.remove();
			this.pulseBar = null;
		});
		this.contentEl.insertBefore(bar, header.nextSibling);
		this.pulseBar = bar;
	}

	/**
	 * Refresh the active-note pill in the header. Removes any existing pill
	 * and re-renders it at the same position (right after the new-chat button)
	 * if a markdown note is currently active.
	 */
	private refreshActiveNoteIndicator(): void {
		const header = this.contentEl.querySelector('.ai-chat-header');
		if (!(header instanceof HTMLElement)) return;
		// Remove any existing pill (could be stale after a note switch).
		const existing = header.querySelector('.ai-chat-active-note');
		existing?.remove();
		const file = getActiveNoteFile(this.app);
		if (!file) return;
		// Build the pill via the shared helper, then relocate it.
		const tempHost = createDiv();
		this.renderActiveNoteIndicator(tempHost);
		const pill = tempHost.firstElementChild;
		if (!(pill instanceof HTMLElement)) return;
		// Position: insert after the new chat button (first .ai-chat-icon-btn in
		// the primary row) so the pill stays before the model picker.
		const mainRow = header.querySelector('.ai-chat-header-main');
		const newChatBtn = mainRow?.querySelector('.ai-chat-icon-btn');
		if (mainRow instanceof HTMLElement && newChatBtn) {
			mainRow.insertBefore(pill, newChatBtn.nextSibling);
		} else if (mainRow instanceof HTMLElement) {
			mainRow.insertBefore(pill, mainRow.firstChild);
		} else {
			header.insertBefore(pill, header.firstChild);
		}
	}

	private async renderHeader(container: HTMLElement): Promise<void> {
		const header = container.createDiv({ cls: 'ai-chat-header' });

		// Primary row — new chat, active-note pill, model picker. The picker
		// stretches to fill, so this line reads as the conversation's identity.
		const main = header.createDiv({ cls: 'ai-chat-header-main' });

		// New chat — icon button
		const newChatBtn = main.createEl('button', { cls: 'ai-chat-icon-btn' });
		setIcon(newChatBtn, 'plus');
		newChatBtn.title = 'New chat';
		newChatBtn.setAttribute('aria-label', 'New chat');
		newChatBtn.addEventListener('click', () => this.startNewChat());

		// Active-note indicator — pill showing the note the user is editing.
		// Click to attach it to the pending message (reuses @-mention pipeline).
		// Kept out of the DOM when there's no active markdown note.
		this.renderActiveNoteIndicator(main);

		// Model picker button — always routes through the modal so we get
		// capability pills and consistent UX regardless of model count.
		const pickerBtn = main.createEl('button', { cls: 'ai-model-picker-btn' });
		this.updateModelPickerButton(pickerBtn);
		pickerBtn.addEventListener('click', () => this.openModelPicker(pickerBtn));

		// Tools row — mode toggles and utilities. Stays inline with the
		// primary row on wide panes and stacks under it on narrow ones
		// (double-deck header) instead of cramming every control into one line.
		const tools = header.createDiv({ cls: 'ai-chat-header-tools' });

		// Arena toggle — switches the picker path to multi-select and routes
		// the next send to all selected models in parallel.
		const arenaBtn = tools.createEl('button', { cls: 'ai-chat-icon-btn ai-chat-arena-btn' });
		setIcon(arenaBtn, 'wand');
		arenaBtn.title = 'Arena mode';
		arenaBtn.setAttribute('aria-label', 'Arena mode');
		arenaBtn.toggleClass('is-active', this.arenaMode);
		arenaBtn.addEventListener('click', () => this.toggleArenaMode(arenaBtn));

		// Auto-speak toggle — when on, new assistant responses are spoken aloud.
		// Only render when speechSynthesis is available (desktop Chromium-based).
		if (isSpeechSupported()) {
			this.autoSpeakBtn = tools.createEl('button', { cls: 'ai-chat-icon-btn ai-chat-autospeak-btn' });
			setIcon(this.autoSpeakBtn, 'volume-2');
			this.autoSpeakBtn.title = 'Auto-speak responses';
			this.autoSpeakBtn.setAttribute('aria-label', 'Auto-speak responses');
			this.autoSpeakBtn.addEventListener('click', () => this.toggleAutoSpeak());
		}

		// History — icon button
		const historyBtn = tools.createEl('button', { cls: 'ai-chat-icon-btn' });
		setIcon(historyBtn, 'history');
		historyBtn.title = 'Conversation history';
		historyBtn.setAttribute('aria-label', 'Conversation history');
		historyBtn.addEventListener('click', () => this.showHistoryDropdown(historyBtn));

		// Export — download current conversation as markdown or a portable .curt
		const exportBtn = tools.createEl('button', { cls: 'ai-chat-icon-btn' });
		setIcon(exportBtn, 'download');
		exportBtn.title = 'Export conversation';
		exportBtn.setAttribute('aria-label', 'Export conversation');
		exportBtn.addEventListener('click', (e) => {
			const menu = new Menu();
			menu.addItem((item) =>
				item
					.setTitle('Download as Markdown')
					.setIcon('file-text')
					.onClick(() => this.exportCurrentConversation())
			);
			menu.addItem((item) =>
				item
					.setTitle('Save as .curt (portable)')
					.setIcon('package')
					.onClick(() => {
						const conv = this.getConversationForView();
						if (!conv || conv.messages.length === 0) {
							new Notice('Nothing to export');
							return;
						}
						downloadConversationCurt(conv);
						new Notice(`Exported: ${conv.title}`);
					})
			);
			menu.addItem((item) =>
				item
					.setTitle('Recap conversation')
					.setIcon('list-checks')
					.onClick(() => void runRecap(this.plugin, this.conversationId, () => this.renderCurrentConversation()))
			);
			menu.showAtMouseEvent(e);
		});

		// Search — fuzzy-search across ALL conversations (assignable hotkey)
		const searchBtn = tools.createEl('button', { cls: 'ai-chat-icon-btn' });
		setIcon(searchBtn, 'search');
		searchBtn.title = 'Search conversations';
		searchBtn.setAttribute('aria-label', 'Search conversations');
		searchBtn.addEventListener('click', () =>
			void this.plugin.openChatSearch((id) => this.switchConversation(id))
		);
	}

	/**
	 * Render the active-note indicator pill into the header. Re-renders the
	 * pill on every call so the label stays in sync when the user switches
	 * notes. No-op (renders nothing) when no markdown note is active.
	 */
	private renderActiveNoteIndicator(header: HTMLElement): void {
		const file = getActiveNoteFile(this.app);
		if (!file) return;
		const noteBtn = header.createDiv({ cls: 'ai-chat-active-note' });
		setIcon(noteBtn, 'file-text');
		const name = file.basename.length > 20
			? file.basename.slice(0, 17) + '...'
			: file.basename;
		noteBtn.createSpan({ text: name });
		noteBtn.setAttribute('aria-label', `Active: ${file.path}. Click to attach.`);
		noteBtn.title = `Active: ${file.path}`;
		noteBtn.addEventListener('click', () => this.attachActiveNoteToPending(file));
	}

	/**
	 * Attach the active note to the pending-message attachment list (same
	 * pipeline as @-mention selection). Shows a Notice on attach / duplicate.
	 */
	private attachActiveNoteToPending(file: TFile): void {
		if (this.pendingNoteAttachments.some((f) => f.path === file.path)) {
			new Notice(`Already attached: ${file.basename}`);
			return;
		}
		this.pendingNoteAttachments.push(file);
		new Notice(`Attached: ${file.basename}`);
		this.renderAttachmentChips();
	}

	/**
	 * Render the chip strip above the input area for each pending note
	 * attachment. Chips have an × to remove. Lazily creates the container on
	 * first render. Hidden via CSS when empty.
	 */
	private renderAttachmentChips(): void {
		const inputArea = this.contentEl.querySelector('.ai-chat-input-area');
		if (!inputArea) return;
		let chipContainer = inputArea.querySelector('.ai-chat-attachments');
		if (!chipContainer) {
			// Insert as the first child so chips sit above the image strip +
			// textarea card.
			chipContainer = (inputArea as HTMLElement).createDiv({ cls: 'ai-chat-attachments' });
			(inputArea as HTMLElement).insertBefore(chipContainer, inputArea.firstChild);
		}
		chipContainer.empty();
		for (const file of this.pendingNoteAttachments) {
			const chip = chipContainer.createDiv({ cls: 'ai-chat-attachment-chip' });
			chip.createSpan({ cls: 'ai-chat-attachment-name', text: file.basename });
			const removeBtn = chip.createSpan({ cls: 'ai-chat-attachment-remove', text: '×' });
			removeBtn.setAttribute('role', 'button');
			removeBtn.setAttribute('aria-label', `Remove ${file.basename}`);
			removeBtn.addEventListener('click', () => {
				this.pendingNoteAttachments = this.pendingNoteAttachments.filter((f) => f.path !== file.path);
				this.renderAttachmentChips();
			});
		}
	}

	/** Export the current conversation as a downloadable .md file. */
	private exportCurrentConversation(): void {
		const conv = this.getConversationForView();
		if (!conv || conv.messages.length === 0) {
			new Notice('Nothing to export');
			return;
		}
		downloadConversationMarkdown(conv, {
			providerName: (id) => this.plugin.providerRegistry.getProvider(id)?.name,
		});
		new Notice(`Exported: ${conv.title}`);
	}

	private renderMessagesContainer(container: HTMLElement): void {
		this.messagesContainer = container.createDiv({ cls: 'ai-chat-messages' });
	}

	private renderBackground(container: HTMLElement): void {
		this.backgroundLayer = container.createDiv({ cls: 'ai-chat-background' });
		this.refreshBackground();
	}

	/** Update the hint text to match the current enterKeyBehavior setting. */
	refreshInputHint(): void {
		if (!this.inputHintEl) return;
		this.inputHintEl.empty();
		if (this.plugin.settings.enterKeyBehavior === 'newline') {
			this.inputHintEl.createEl('kbd', { text: 'Ctrl' });
			this.inputHintEl.appendText('+');
			this.inputHintEl.createEl('kbd', { text: 'Enter' });
			this.inputHintEl.appendText(' send · ');
			this.inputHintEl.createEl('kbd', { text: 'Enter' });
			this.inputHintEl.appendText(' newline · ');
			this.inputHintEl.createEl('kbd', { text: '/' });
			this.inputHintEl.appendText(' commands');
		} else {
			this.inputHintEl.createEl('kbd', { text: 'Enter' });
			this.inputHintEl.appendText(' send · ');
			this.inputHintEl.createEl('kbd', { text: 'Shift+Enter' });
			this.inputHintEl.appendText(' newline · ');
			this.inputHintEl.createEl('kbd', { text: '/' });
			this.inputHintEl.appendText(' commands');
		}
	}

	/** Re-render the background layer based on current settings.
	 *  Public so the plugin can call it on every open ChatView when settings change. */
	refreshBackground(): void {
		const layer = this.backgroundLayer;
		if (!layer) return;
		layer.empty();
		// Wallpaper (custom image) takes precedence when enabled.
		if (this.plugin.settings.chatBackground === 'wallpaper' && this.plugin.settings.chatWallpaperPath) {
			const file = this.app.vault.getAbstractFileByPath(this.plugin.settings.chatWallpaperPath);
			if (file instanceof TFile) {
				const url = this.app.vault.getResourcePath(file);
				layer.style.setProperty('--wallpaper-url', `url("${url}")`);
				layer.addClass('has-wallpaper');
			} else {
				layer.removeClass('has-wallpaper');
			}
		} else {
			layer.removeClass('has-wallpaper');
		}
		// No persistent watermark — the brand orb is rendered inside the
		// empty-state block (renderEmptyState) so it appears on new chat and
		// disappears when the first message arrives.
	}

	private async renderInputArea(container: HTMLElement): Promise<void> {
		const inputArea = container.createDiv({ cls: 'ai-chat-input-area' });

		// Pending image thumbnails (hidden until first attach).
		this.imageStrip = inputArea.createDiv({ cls: 'ai-chat-image-strip is-hidden' });

		// The textarea card sits alone on its own full-width line so nothing
		// bunches beside it. Attach, mic, the Enter/Shift+Enter hint and the
		// send button share the action row UNDER the box (ChatGPT-style).
		// The Stop button replaces Send in-place while streaming.
		const row = inputArea.createDiv({ cls: 'ai-chat-input-row' });

		const wrap = row.createDiv({ cls: 'ai-chat-input-wrap' });
		this.inputEl = wrap.createEl('textarea', {
			cls: 'ai-chat-input',
			placeholder: 'Message Curtis…',
		});
		this.inputEl.rows = 1;
		this.inputEl.addEventListener('keydown', (e) => this.handleInputKeydown(e));
		this.inputEl.addEventListener('input', () => {
			this.autoResizeInput();
			this.maybeShowSlashMenu();
			this.maybeShowMentionMenu();
		});
		// Paste image straight from clipboard (Ctrl+V) — standard chat UX.
		this.inputEl.addEventListener('paste', (e) => this.handlePaste(e));

		// Drag-and-drop images anywhere on the input area.
		this.setupDragDrop(inputArea);

		// Action row under the box: attach + mic on the left, hint centered,
		// send on the right.
		const btnRow = inputArea.createDiv({ cls: 'ai-chat-btn-row' });

		// Paperclip attaches images (file picker); mic toggles voice input
		// (only rendered when MediaRecorder exists). The hidden <input> is a
		// SIBLING of the button — putting it inside the button causes the
		// picker to open-then-close because the synthesized input click
		// bubbles back up to the button handler.
		const attachCol = btnRow.createDiv({ cls: 'ai-chat-attach-col' });
		const fileInput = attachCol.createEl('input', {
			cls: 'ai-chat-file-input',
			type: 'file',
			attr: { accept: 'image/*', multiple: 'multiple' },
		});
		this.attachBtn = attachCol.createEl('button', { cls: 'ai-chat-icon-btn ai-chat-attach-btn' });
		setIcon(this.attachBtn, 'paperclip');
		this.attachBtn.title = 'Attach image';
		this.attachBtn.setAttribute('aria-label', 'Attach image');
		this.attachBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			fileInput.click();
		});
		fileInput.addEventListener('change', () => {
			if (fileInput.files && fileInput.files.length > 0) {
				void this.addImageFiles(Array.from(fileInput.files));
			}
			fileInput.value = '';
		});

		// Mic button — click to start recording, click again to stop +
		// transcribe via Whisper.
		if (isMediaRecorderSupported()) {
			this.micBtn = attachCol.createEl('button', { cls: 'ai-chat-icon-btn ai-chat-mic-button' });
			setIcon(this.micBtn, 'mic');
			this.micBtn.title = 'Voice input';
			this.micBtn.setAttribute('aria-label', 'Voice input');
			this.micBtn.addEventListener('click', () => void this.handleMicClick());
		}

		// Hint fills the space between the attach group and the send button.
		this.inputHintEl = btnRow.createDiv({ cls: 'ai-chat-input-hint' });
		this.refreshInputHint();

		const sendCol = btnRow.createDiv({ cls: 'ai-chat-send-col' });
		this.sendBtn = sendCol.createEl('button', { cls: 'ai-chat-send-btn' });
		setIcon(this.sendBtn, 'arrow-up');
		this.sendBtn.title = 'Send';
		this.sendBtn.setAttribute('aria-label', 'Send');
		this.sendBtn.addEventListener('click', () => void this.sendMessage());

		this.abortBtn = sendCol.createEl('button', { cls: 'ai-chat-abort-btn is-hidden' });
		setIcon(this.abortBtn, 'square');
		this.abortBtn.title = 'Stop generating';
		this.abortBtn.setAttribute('aria-label', 'Stop generating');
		this.abortBtn.addEventListener('click', () => this.abortGeneration());
	}

	async onClose(): Promise<void> {
		// A closed pane's stream would keep writing headless — abort so the
		// partial response persists through the normal abort path instead.
		this.abortController?.abort();
		this.abortArena();
		this.unsubscribeStoreEvents?.();
		this.unsubscribeStoreEvents = null;
		// Tear down any active voice session — stop mic + cancel speech so they
		// don't outlive the view. (speechSynthesis is window-global: two panes
		// auto-speaking simultaneously was never supported; last one wins.)
		this.voiceRecorder?.cancel();
		this.voiceRecorder = null;
		stopSpeaking();
		this.currentlySpeaking = null;
		this.debouncedMentionLookup.cancel();
		this.renderer.cleanup();
	}

	// --- Model picker -----------------------------------------------------

	private openModelPicker(_anchor: HTMLElement): void {
		const entries = buildModelPickerEntries(
			this.plugin.providerRegistry.getAllEnabledProviders()
		);
		const activeKey = `${this.activeProviderId}|${this.activeModelId}`;
		new ModelPickerModal(this.app, entries, activeKey, (providerId, modelId) => {
			this.setActiveModel(providerId, modelId);
		}).open();
	}

	private updateModelPickerButton(btn: HTMLElement): void {
		btn.empty();
		const provider = this.plugin.providerRegistry.getProvider(this.activeProviderId);
		const model = provider?.models.find((m) => m.id === this.activeModelId);
		const modelName = model?.name || this.activeModelId || 'Pick model';
		const providerName = provider?.name || this.activeProviderId;
		const color = providerColor(this.activeProviderId);
		if (color) btn.style.setProperty('--provider-color', color);

		btn.createDiv({ cls: 'ai-model-picker-btn-dot' });

		const text = btn.createDiv({ cls: 'ai-model-picker-btn-text' });
		text.createDiv({ cls: 'ai-model-picker-btn-model', text: modelName });
		text.createDiv({ cls: 'ai-model-picker-btn-provider', text: providerName });

		const chevron = btn.createDiv({ cls: 'ai-model-picker-btn-chevron' });
		setIcon(chevron, 'chevron-down');

		btn.title = `${providerName} / ${modelName}`;
	}

	// --- Input ------------------------------------------------------------

	private handleInputKeydown(e: KeyboardEvent): void {
		// Mention menu takes priority — @ can appear mid-message whereas
		// slash only triggers at the start, so check it first.
		if (this.mentionMenu && !this.mentionMenu.hasClass('is-hidden')) {
			if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
				e.preventDefault();
				this.moveMentionSelection(e.key === 'ArrowDown' ? 1 : -1);
				return;
			}
			if (e.key === 'Enter' || e.key === 'Tab') {
				const sel = this.mentionMenu.querySelector('.is-selected');
				if (sel instanceof HTMLElement) {
					e.preventDefault();
					sel.click();
					return;
				}
				this.hideMentionMenu();
			}
			if (e.key === 'Escape') {
				e.preventDefault();
				this.hideMentionMenu();
				return;
			}
		}
		// Slash menu: ArrowUp/Down/Enter/Tab/Escape when visible
		if (this.slashMenu && !this.slashMenu.hasClass('is-hidden')) {
			if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
				e.preventDefault();
				this.moveSlashSelection(e.key === 'ArrowDown' ? 1 : -1);
				return;
			}
			if (e.key === 'Enter' || e.key === 'Tab') {
				const sel = this.slashMenu.querySelector('.is-selected');
				if (sel instanceof HTMLElement) {
					e.preventDefault();
					sel.click();
					return;
				}
				this.hideSlashMenu();
			}
			if (e.key === 'Escape') {
				e.preventDefault();
				this.hideSlashMenu();
				return;
			}
		}
		// Enter-key send behavior is configurable. Default: Enter sends,
		// Shift+Enter inserts newline. Alt: Enter inserts newline, Ctrl/Cmd+Enter
		// sends (better for users who paste/type multi-line questions often).
		const mode = this.plugin.settings.enterKeyBehavior;
		if (mode === 'newline') {
			if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				void this.sendMessage();
			}
		} else {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				void this.sendMessage();
			}
		}
	}

	private autoResizeInput(): void {
		this.inputEl.setCssProps({ height: 'auto' });
		this.inputEl.setCssProps({ height: `${Math.min(this.inputEl.scrollHeight, 320)}px` });
	}

	// --- Slash autocomplete ---------------------------------------------

	private maybeShowSlashMenu(): void {
		const value = this.inputEl.value;
		// Only show menu if the slash is at start and there's no space yet.
		if (!value.startsWith('/') || value.includes(' ')) {
			this.hideSlashMenu();
			return;
		}
		const suggestions = slashSuggestions(value);
		if (suggestions.length === 0) {
			this.hideSlashMenu();
			return;
		}
		this.ensureSlashMenu();
		this.slashMenu!.empty();
		suggestions.forEach((cmd, i) => {
			const item = this.slashMenu!.createDiv({ cls: 'ai-slash-menu-item' + (i === 0 ? ' is-selected' : '') });
			item.createEl('code', { text: cmd.usage });
			item.createDiv({ cls: 'ai-slash-menu-desc', text: cmd.description });
			item.addEventListener('click', () => {
				this.inputEl.value = `/${cmd.name} `;
				this.autoResizeInput();
				this.hideSlashMenu();
				this.inputEl.focus();
			});
		});
		this.slashMenu!.removeClass('is-hidden');
	}

	private ensureSlashMenu(): void {
		if (this.slashMenu) return;
		const inputArea = this.contentEl.querySelector('.ai-chat-input-area');
		if (!inputArea) return;
		this.slashMenu = (inputArea as HTMLElement).createDiv({ cls: 'ai-slash-menu is-hidden' });
	}

	private hideSlashMenu(): void {
		if (this.slashMenu) this.slashMenu.addClass('is-hidden');
	}

	private moveSlashSelection(delta: number): void {
		if (!this.slashMenu) return;
		const items = Array.from(this.slashMenu.querySelectorAll<HTMLElement>('.ai-slash-menu-item'));
		if (items.length === 0) return;
		let idx = items.findIndex((i) => i.hasClass('is-selected'));
		if (idx === -1) idx = 0;
		idx = (idx + delta + items.length) % items.length;
		items.forEach((i) => i.removeClass('is-selected'));
		items[idx].addClass('is-selected');
		items[idx].scrollIntoView({ block: 'nearest' });
	}

	// --- @-mention autocomplete -------------------------------------------

	/**
	 * Detect an @-mention in progress: an `@` preceded by whitespace or string
	 * start, followed by query text up to the cursor. When found, show the
	 * matching-notes dropdown; otherwise hide it.
	 */
	private maybeShowMentionMenu(): void {
		const value = this.inputEl.value;
		const cursorPos = this.inputEl.selectionStart ?? value.length;
		// Caret moved before a selected mention (or the input was cleared) —
		// the stale guard must not suppress a fresh mention typed there.
		if (this.mentionEndOffset >= 0 && cursorPos < this.mentionEndOffset) {
			this.mentionEndOffset = -1;
		}
		const beforeCursor = value.slice(0, cursorPos);
		// Query chars: word chars, spaces, hyphens. Stop at the @ boundary.
		const match = beforeCursor.match(/(?:^|\s)@([\w\s-]*)$/);
		if (!match) {
			// Cancel any in-flight debounced lookup so a stale scan can't
			// re-open the menu after the user deleted the `@`.
			this.debouncedMentionLookup.cancel();
			this.hideMentionMenu();
			return;
		}
		// Prose typed after a selected mention re-matches the regex through the
		// mention's own '@'. Suppress it — Enter must send, not clobber text.
		if (this.mentionEndOffset >= 0 && (match.index ?? 0) < this.mentionEndOffset) {
			this.debouncedMentionLookup.cancel();
			this.hideMentionMenu();
			return;
		}
		this.debouncedMentionLookup(match);
	}

	/**
	 * Fuzzy-match markdown files by query. Basename hits rank above path hits,
	 * then most-recently-modified first. Caps at 10 results for responsiveness
	 * in large vaults.
	 */
	private getMatchingNotes(query: string): TFile[] {
		const q = query.toLowerCase();
		const files: TFile[] = this.app.vault.getMarkdownFiles();
		const scored: Array<{ file: TFile; score: number }> = [];
		for (const f of files) {
			const basenameHit = !q || f.basename.toLowerCase().includes(q);
			const pathHit = !q || f.path.toLowerCase().includes(q);
			if (!basenameHit && !pathHit) continue;
			const score = (basenameHit ? 2 : 0) + (pathHit ? 1 : 0);
			scored.push({ file: f, score });
		}
		scored.sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			// Tie-break: most recently modified first.
			return (b.file.stat.mtime ?? 0) - (a.file.stat.mtime ?? 0);
		});
		return scored.slice(0, 10).map((s) => s.file);
	}

	/**
	 * Render the dropdown of matching notes. `atIndex` is the absolute position
	 * of the `@` in the input value — used on click to replace `@query` with
	 * `@Note Name ` (trailing space) and stash the note as a pending attachment.
	 */
	private renderMentionMenu(suggestions: TFile[], atIndex: number): void {
		this.ensureMentionMenu();
		this.mentionMenu!.empty();
		suggestions.forEach((file, i) => {
			const item = this.mentionMenu!.createDiv({
				cls: 'ai-mention-menu-item' + (i === 0 ? ' is-selected' : ''),
			});
			item.createDiv({ cls: 'ai-mention-menu-name', text: file.basename });
			// Folder path beneath the name (omit when the note lives at vault root).
			const dir = file.parent?.path ?? '';
			if (dir && dir !== '/') {
				item.createDiv({ cls: 'ai-mention-menu-path', text: dir });
			}
			item.addEventListener('click', () => {
				this.selectMention(file, atIndex);
			});
			item.addEventListener('mouseenter', () => {
				this.mentionMenu!.querySelectorAll('.ai-mention-menu-item').forEach((el) => {
					el.removeClass('is-selected');
				});
				item.addClass('is-selected');
			});
		});
		this.mentionMenu!.removeClass('is-hidden');
	}

	private ensureMentionMenu(): void {
		if (this.mentionMenu) return;
		const inputArea = this.contentEl.querySelector('.ai-chat-input-area');
		if (!inputArea) return;
		this.mentionMenu = (inputArea as HTMLElement).createDiv({ cls: 'ai-mention-menu is-hidden' });
	}

	private hideMentionMenu(): void {
		if (this.mentionMenu) this.mentionMenu.addClass('is-hidden');
	}

	private moveMentionSelection(delta: number): void {
		if (!this.mentionMenu) return;
		const items = Array.from(this.mentionMenu.querySelectorAll<HTMLElement>('.ai-mention-menu-item'));
		if (items.length === 0) return;
		let idx = items.findIndex((i) => i.hasClass('is-selected'));
		if (idx === -1) idx = 0;
		idx = (idx + delta + items.length) % items.length;
		items.forEach((i) => i.removeClass('is-selected'));
		items[idx].addClass('is-selected');
		items[idx].scrollIntoView({ block: 'nearest' });
	}

	/**
	 * Replace the `@query` text starting at `atIndex` with `@Note Name ` and
	 * stash the note as a pending attachment. The inserted name keeps the `@`
	 * prefix so the user has visual confirmation of what got attached.
	 */
	private selectMention(file: TFile, atIndex: number): void {
		const value = this.inputEl.value;
		// atIndex points at the offset of the whitespace/start BEFORE the @.
		// Normalize to the @ itself.
		const atPos = atIndex === -1 ? -1 : value.indexOf('@', atIndex);
		if (atPos === -1) {
			this.hideMentionMenu();
			return;
		}
		const insert = `@${file.basename} `;
		this.inputEl.value = value.slice(0, atPos) + insert + value.slice(this.inputEl.selectionStart ?? value.length);
		// Cursor goes right after the trailing space so typing continues naturally.
		const newCursor = atPos + insert.length;
		this.inputEl.setSelectionRange(newCursor, newCursor);
		// Arm the reopen guard — see mentionEndOffset. The trailing space is
		// the mention's last character.
		this.mentionEndOffset = newCursor - 1;
		// Kill any in-flight scan scheduled just before the selection.
		this.debouncedMentionLookup.cancel();
		this.autoResizeInput();
		// De-dupe — attaching the same note twice would just duplicate the context.
		if (!this.pendingNoteAttachments.some((n) => n.path === file.path)) {
			this.pendingNoteAttachments.push(file);
		}
		this.hideMentionMenu();
		this.renderAttachmentChips();
		this.inputEl.focus();
	}

	// --- Messages ---------------------------------------------------------

	renderCurrentConversation(): void {
		// refreshChatViews() can fire while a chat view's onOpen is still
		// constructing (e.g. command open + settings change in the same tick)
		// — the container doesn't exist yet and onOpen renders on its own.
		if (!this.messagesContainer) return;
		this.messagesContainer.empty();
		this.closeMemoryPopover();
		const conv = this.getConversationForView();
		if (!conv || conv.messages.length === 0) {
			this.renderEmptyState();
			return;
		}

		// Track the last rendered calendar date so we can insert day
		// separators when messages cross a date boundary.
		let lastDateKey = '';
		const showSeparators = this.plugin.settings.showDaySeparators !== false;
		for (const msg of conv.messages) {
			if (showSeparators) {
				const key = this.dayKey(msg.timestamp);
				if (key !== lastDateKey) {
					this.appendDaySeparator(msg.timestamp);
					lastDateKey = key;
				}
			}
			this.appendMessageToDOM(msg);
		}
		this.scrollToBottom();
	}

	/** YYYY-MM-DD for the given epoch ms, in the user's local zone. */
	private dayKey(ts: number): string {
		const d = new Date(ts);
		return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
	}

	/** Render a "Today" / "Yesterday" / "Jul 21" divider above a message. */
	private appendDaySeparator(ts: number): void {
		const now = new Date();
		const msg = new Date(ts);
		const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
		const yesterday = new Date(now);
		yesterday.setDate(now.getDate() - 1);
		const yKey = `${yesterday.getFullYear()}-${yesterday.getMonth()}-${yesterday.getDate()}`;
		const msgKey = `${msg.getFullYear()}-${msg.getMonth()}-${msg.getDate()}`;

		let label: string;
		if (msgKey === todayKey) {
			label = 'Today';
		} else if (msgKey === yKey) {
			label = 'Yesterday';
		} else {
			label = msg.toLocaleDateString(undefined, {
				weekday: 'short',
				month: 'short',
				day: 'numeric',
				year: msg.getFullYear() === now.getFullYear() ? undefined : 'numeric',
			});
		}

		const divider = this.messagesContainer.createDiv({ cls: 'ai-chat-day-divider' });
		divider.createSpan({ text: label });
	}

	private renderEmptyState(): void {
		// Full hero orb (only shown when chat has no messages). Disappears the
		// moment the first message is added. Wallpaper (if enabled) shows behind.
		const empty = this.messagesContainer.createDiv({ cls: 'ai-chat-empty' });
		// Logo disc is painted purely by CSS (inlined brand image in styles.css).
		empty.createDiv({ cls: 'ai-chat-empty-icon' });
		empty.createDiv({ cls: 'ai-chat-empty-title', text: 'Curtis' });
		if (!this.plugin.settings.onboardingCompleted) {
			this.renderOnboardingInto(empty);
			return;
		}
		const activeNote = getActiveNoteFile(this.app);
		if (activeNote) {
			empty.createDiv({
				cls: 'ai-chat-empty-hint',
				text: `I can see you're working on "${activeNote.basename}". Ask me anything about it, or click the note name in the header to attach it.`,
			});
		} else {
			empty.createDiv({
				cls: 'ai-chat-empty-hint',
				text: 'Ask anything — type a message below to begin. Use @ to attach notes.',
			});
		}
	}

	/** First-run panel inside the empty-state hero: what Curtis is (and the
	 *  plain-language AI disclosure), an optional vault read with visible
	 *  progress, and two starter questions. Everything here is optional —
	 *  Skip is always one click away, and the first real message retires the
	 *  panel for good. */
	private renderOnboardingInto(empty: HTMLElement): void {
		const body = empty.createDiv({ cls: 'ai-onboard' });
		body.createDiv({
			cls: 'ai-onboard-line',
			text: 'An AI assistant built into your vault. Your notes stay on your machine.',
		});
		body.createDiv({
			cls: 'ai-onboard-line',
			text: 'What Curtis remembers is one editable file — delete a line, it forgets.',
		});
		body.createDiv({
			cls: 'ai-onboard-line',
			text: 'Models do the talking. Curtis is the harness that connects them to your notes.',
		});

		if (this.plugin.settings.enableRag) {
			const status = this.plugin.ragIndex.getStatus();
			if ((status.lastBuilt ?? 0) > 0) {
				body.createDiv({
					cls: 'ai-onboard-faint',
					text: `Vault already indexed — ${status.fileCount} notes.`,
				});
			} else {
				const actions = body.createDiv({ cls: 'ai-onboard-actions' });
				const btn = actions.createEl('button', {
					cls: 'mod-cta ai-onboard-btn',
					text: 'Read my vault',
					type: 'button',
				});
				const progress = body.createDiv({ cls: 'ai-onboard-progress is-hidden' });
				btn.addEventListener('click', () => {
					btn.disabled = true;
					progress.removeClass('is-hidden');
					progress.setText('Reading vault…');
					void this.plugin.ragIndex
						.rebuildAll((done, total) => {
							progress.setText(total > 0 ? `Reading vault… ${done}/${total} chunks` : 'Reading vault…');
						})
						.then(() => {
							const st = this.plugin.ragIndex.getStatus();
							progress.setText(`Done — ${st.fileCount} notes indexed.`);
						})
						.catch((e: unknown) => {
							console.error('[Curtis] onboarding index failed:', e);
							progress.setText('Indexing failed — retry from settings → vault retrieval.');
							btn.disabled = false;
						});
				});
			}
		} else {
			body.createDiv({
				cls: 'ai-onboard-faint',
				text: 'Vault reading is off — enable it any time in Settings → Vault retrieval.',
			});
		}

		// Starter questions — clicking fills the input; answers the user sends
		// flow through the normal memory-capture path (with provenance).
		const chips = body.createDiv({ cls: 'ai-onboard-chips' });
		const STARTER_QUESTIONS = [
			'What do you use this vault for?',
			'How do you like your answers — terse or thorough?',
		];
		for (const q of STARTER_QUESTIONS) {
			const chip = chips.createEl('button', { cls: 'ai-onboard-chip', text: q, type: 'button' });
			chip.addEventListener('click', () => {
				this.inputEl.value = q;
				this.autoResizeInput();
				this.inputEl.focus();
			});
		}

		const skip = body.createEl('button', { cls: 'ai-onboard-skip', text: 'Skip — just chat', type: 'button' });
		skip.addEventListener('click', () => {
			this.plugin.settings.onboardingCompleted = true;
			void this.plugin.saveSettings();
			this.renderCurrentConversation();
		});
	}

	private appendMessageToDOM(msg: ConversationMessage): HTMLElement {
		// Tool role messages render as a distinct "tool result" bubble.
		if (msg.role === 'tool') {
			return this.appendToolResultToDOM(msg);
		}

		const wrapper = this.messagesContainer.createDiv({
			cls: `ai-message ai-message-${msg.role}`,
		});

		// Assistant only: tiny model name label above the bubble.
		// User messages get NO label — alignment + bubble color is the signal,
		// like Telegram/iMessage.
		if (msg.role === 'assistant') {
			const color = providerColor(msg.provider);
			if (color) wrapper.style.setProperty('--provider-color', color);
			const provider = msg.provider ? this.plugin.providerRegistry.getProvider(msg.provider) : undefined;
			const model = provider?.models.find((m) => m.id === msg.model);
			const label = model?.name || msg.model || 'Assistant';
			const meta = wrapper.createDiv({ cls: 'ai-message-meta' });
			meta.createDiv({ cls: 'ai-message-role-dot' });
			meta.createDiv({ cls: 'ai-message-role', text: label });
			if (msg.tokens && this.plugin.settings.showTokenUsage) {
				meta.createDiv({ cls: 'ai-message-info', text: `${msg.tokens.totalTokens} tok` });
			}
			if (msg.memoriesUsedIds && msg.memoriesUsedIds.length > 0) {
				this.renderMemoryChipInto(meta, msg.memoriesUsedIds);
			}
		}

		// Assistant message with tool_calls renders as a "tool invocation"
		// bubble instead of a normal content bubble.
		if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
			this.renderToolCallBubble(wrapper, msg.tool_calls[0]);
			return wrapper;
		}

		const contentEl = wrapper.createDiv({ cls: 'ai-message-content' });

		if (msg.role === 'user') {
			this.renderer.renderUserMessage(contentEl, msg.content);
			// Render any attached images below the text. msg.images holds vault paths.
			if (msg.images && msg.images.length > 0) {
				const gallery = contentEl.createDiv({ cls: 'ai-message-image-gallery' });
				for (const path of msg.images) {
					const file = this.app.vault.getAbstractFileByPath(path);
					if (!(file instanceof TFile)) continue;
					const img = gallery.createEl('img', { cls: 'ai-message-image' });
					img.src = this.app.vault.getResourcePath(file);
					img.alt = file.basename;
					img.title = file.path;
					img.addEventListener('click', () => {
						// Open in Obsidian's native image viewer.
						void this.app.workspace.openLinkText(file.path, '', false);
					});
				}
			}
			// Inline Copy + Edit-resend row below user bubbles (NOT absolute
			// positioned — sits in normal flow so it can't disturb layout).
			attachUserMessageActions(wrapper, msg, {
				onEditUserMessage: (m) => this.editUserMessage(m.id),
			});
		} else {
			void this.renderer.renderMessage(contentEl, msg.content);
			// Attach hover actions on rendered assistant messages.
			attachMessageActions({
				app: this.app,
				wrapper,
				message: msg,
				saveFolder: this.plugin.settings.noteSaveFolder,
				callbacks: {
					onRegenerate: (m) => void this.regenerateMessage(m.id),
					onQuoteIntoInput: (m) => this.quoteMessageIntoInput(m),
				},
			});
			this.attachSpeakAction(wrapper, msg);
		}

		return wrapper;
	}

	/** Render a tool-invocation bubble (assistant requested a tool call). */
	private renderToolCallBubble(wrapper: HTMLElement, call: ToolCall): void {
		wrapper.addClass('ai-message-tool-call');
		const header = wrapper.createDiv({ cls: 'ai-tool-call-header' });
		setIcon(header.createDiv({ cls: 'ai-tool-call-icon' }), 'wrench');
		header.createDiv({ cls: 'ai-tool-call-name', text: call.name });
		const argsEl = wrapper.createDiv({ cls: 'ai-tool-call-args' });
		argsEl.createEl('pre', { text: JSON.stringify(call.arguments, null, 2) });
	}

	/** Render a tool-result bubble (output from an executed tool). */
	private appendToolResultToDOM(msg: ConversationMessage): HTMLElement {
		const wrapper = this.messagesContainer.createDiv({ cls: 'ai-message ai-message-tool' });
		if (msg.tool_error) wrapper.addClass('is-error');
		this.appendToolResultContentInto(wrapper, msg.content, !!msg.tool_error);
		return wrapper;
	}

	/** Fill a tool-result bubble's content into an existing wrapper element. */
	private appendToolResultContentInto(wrapper: HTMLElement, content: string, isError: boolean): void {
		const header = wrapper.createDiv({ cls: 'ai-tool-result-header' });
		setIcon(header.createDiv({ cls: 'ai-tool-result-icon' }), 'terminal');
		header.createDiv({ cls: 'ai-tool-result-label', text: isError ? 'Tool error:' : 'Tool result:' });
		const body = wrapper.createDiv({ cls: 'ai-tool-result-body' });
		body.createEl('pre', { text: content.length > 2000 ? content.slice(0, 2000) + '\n…[truncated]' : content });
	}

	/** Append `msg` as a markdown blockquote to the chat input and focus it. */
	private quoteMessageIntoInput(msg: ConversationMessage): void {
		const quote = msg.content
			.split('\n')
			.map((l) => `> ${l}`)
			.join('\n');
		const current = this.inputEl.value.trim();
		this.inputEl.value = current ? `${current}\n\n${quote}\n\n` : `${quote}\n\n`;
		this.autoResizeInput();
		this.inputEl.focus();
		// Place cursor at end
		this.inputEl.setSelectionRange(this.inputEl.value.length, this.inputEl.value.length);
		new Notice('Quoted into input');
	}

	/**
	 * Cost for one response from the provider's published pricing; null when
	 * the provider/model has no known pricing (local servers, undiscovered
	 * models) — /stats totals simply skip unknown-cost messages.
	 */
	private estimateMessageCost(providerId: string, modelId: string, usage: TokenUsage): number | null {
		return this.plugin.providerRegistry.estimateCost(providerId, modelId, usage.promptTokens, usage.completionTokens);
	}

	/**
	 * Prefill the composer from outside the view (context menu's "Ask AI about
	 * selection", external commands). Public API — replaces the input content.
	 */
	setInputValue(text: string): void {
		this.inputEl.value = text;
		this.mentionEndOffset = -1;
		this.autoResizeInput();
		this.inputEl.focus();
		this.inputEl.setSelectionRange(this.inputEl.value.length, this.inputEl.value.length);
	}

	// --- Voice I/O --------------------------------------------------------

	/**
	 * Resolve the OpenAI provider's Bearer token for Whisper. Reads the
	 * plaintext apiKey from the provider config. Returns null when the OpenAI
	 * provider is missing, disabled, or has no key configured.
	 *
	 * Keychain-resolved keys (apiKeyRef) are deferred to v2 — that path needs
	 * a new public accessor on AIProvider since getAuthHeaders() is protected.
	 */
	private resolveOpenAiBearerToken(): string | null {
		const config = this.plugin.settings.providerConfigs['openai'];
		if (!config?.enabled) return null;
		const apiKey = config.apiKey?.trim();
		if (!apiKey) return null;
		return `Bearer ${apiKey}`;
	}

	private async handleMicClick(): Promise<void> {
		if (!isMediaRecorderSupported() || !this.micBtn) return;

		if (this.voiceRecorder) {
			// Null the field and clear the UI BEFORE awaiting stop — a second
			// click inside the stop window must not re-enter this branch.
			const recorder = this.voiceRecorder;
			this.voiceRecorder = null;
			this.micBtn.removeClass('is-recording');
			let blob: Blob;
			try {
				blob = await recorder.stop();
			} catch (e) {
				console.error('[Curtis] Failed to stop recording:', e);
				new Notice('Recording failed');
				return;
			}

			if (blob.size === 0) {
				new Notice('Recording was empty');
				return;
			}

			const bearer = this.resolveOpenAiBearerToken();
			if (!bearer) {
				new Notice('OpenAI API key required for voice transcription. Configure in settings.');
				return;
			}

			new Notice('Transcribing…');
			try {
				const text = await transcribeAudio(blob, bearer);
				if (!text) {
					new Notice('No speech detected');
					return;
				}
				// Append to input with a space separator when non-empty.
				const current = this.inputEl.value;
				const prefix = current && !current.endsWith(' ') ? ' ' : '';
				this.inputEl.value = current + prefix + text;
				this.autoResizeInput();
				this.inputEl.focus();
				// Place cursor at end so the user can keep typing.
				this.inputEl.setSelectionRange(this.inputEl.value.length, this.inputEl.value.length);
			} catch (e) {
				console.error('[Curtis] Whisper transcription failed:', e);
				new Notice(`Transcription failed: ${(e as Error).message}`);
			}
		} else {
			// Start recording
			this.voiceRecorder = new VoiceRecorder();
			try {
				await this.voiceRecorder.start();
				this.micBtn.addClass('is-recording');
			} catch (e) {
				this.voiceRecorder = null;
				console.error('[Curtis] Mic access failed:', e);
				new Notice(`Mic error: ${(e as Error).message}`);
			}
		}
	}

	/** Toggle auto-speak on/off. Visible state lives on the header button. */
	private toggleAutoSpeak(): void {
		this.autoSpeak = !this.autoSpeak;
		this.autoSpeakBtn?.toggleClass('is-active', this.autoSpeak);
		if (this.autoSpeak) {
			new Notice('Auto-speak on');
		} else {
			// Turning off also cancels any in-progress speech.
			stopSpeaking();
			this.currentlySpeaking = null;
			new Notice('Auto-speak off');
		}
	}

	/**
	 * Attach a speaker button to an assistant message's hover-action toolbar.
	 * Click toggles speak/stop for this message. Safe to call multiple times.
	 */
	private attachSpeakAction(wrapper: HTMLElement, msg: ConversationMessage): void {
		if (!isSpeechSupported()) return;
		if (wrapper.querySelector('.ai-msg-speak-btn')) return;

		const bar = wrapper.querySelector<HTMLElement>('.ai-message-actions');
		if (!bar) return;

		const btn = bar.createEl('button', { cls: 'ai-message-action-btn ai-msg-speak-btn' });
		setIcon(btn, 'volume-2');
		btn.title = 'Speak';
		btn.setAttribute('aria-label', 'Speak');
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			if (this.currentlySpeaking === msg.id) {
				// Currently speaking this message — stop and tear down player.
				this.ttsController?.stop();
				this.currentlySpeaking = null;
				this.ttsController = null;
				wrapper.querySelector('.ai-tts-player')?.remove();
				btn.removeClass('is-speaking');
				setIcon(btn, 'volume-2');
			} else {
				// Stop any other message's player + reset its indicator.
				this.messagesContainer
					.querySelectorAll('.ai-msg-speak-btn.is-speaking')
					.forEach((el) => {
						el.removeClass('is-speaking');
						setIcon(el as HTMLElement, 'volume-2');
					});
				this.messagesContainer.querySelectorAll('.ai-tts-player').forEach((el) => el.remove());
				this.ttsController?.stop();

				setIcon(btn, 'square');
				btn.addClass('is-speaking');
				this.currentlySpeaking = msg.id;
				this.ttsController = new TTSController();
				this.ttsController.play(msg.content);
				this.renderTTSPlayer(wrapper, msg);
			}
		});
	}

	/**
	 * Render the inline TTS player bar (pause/resume, skip ±1, rate cycle,
	 * position, close) under the given assistant message. Subscribes to the
	 * current controller and updates buttons live as playback progresses.
	 */
	private renderTTSPlayer(wrapper: HTMLElement, msg: ConversationMessage): void {
		wrapper.querySelector('.ai-tts-player')?.remove();
		const player = wrapper.createDiv({ cls: 'ai-tts-player' });

		const speakBtn = wrapper.querySelector<HTMLElement>('.ai-msg-speak-btn');

		const unsub = this.ttsController!.subscribe((state) => {
			player.empty();

			// Pause/resume
			const playPause = player.createEl('button', { cls: 'ai-tts-btn ai-tts-playpause' });
			setIcon(playPause, state.isPaused ? 'play' : 'pause');
			playPause.title = state.isPaused ? 'Resume' : 'Pause';
			playPause.addEventListener('click', (e) => {
				e.stopPropagation();
				this.ttsController?.togglePauseResume();
			});

			// Skip back
			const back = player.createEl('button', { cls: 'ai-tts-btn' });
			setIcon(back, 'rewind');
			back.title = 'Previous sentence';
			back.disabled = state.currentSentence === 0;
			back.addEventListener('click', (e) => {
				e.stopPropagation();
				this.ttsController?.skip(-1);
			});

			// Skip forward
			const fwd = player.createEl('button', { cls: 'ai-tts-btn' });
			setIcon(fwd, 'fast-forward');
			fwd.title = 'Next sentence';
			fwd.disabled = state.currentSentence >= state.totalSentences - 1;
			fwd.addEventListener('click', (e) => {
				e.stopPropagation();
				this.ttsController?.skip(1);
			});

			// Position
			player.createDiv({
				cls: 'ai-tts-position',
				text: `${state.currentSentence + 1} / ${state.totalSentences}`,
			});

			// Rate cycle
			const rate = player.createEl('button', { cls: 'ai-tts-btn ai-tts-rate' });
			rate.setText(`${state.rate}x`);
			rate.title = 'Cycle playback speed';
			rate.addEventListener('click', (e) => {
				e.stopPropagation();
				this.ttsController?.cycleRate();
			});

			// Spacer
			player.createDiv({ cls: 'ai-tts-spacer' });

			// Close — stop playback + tear down player
			const close = player.createEl('button', { cls: 'ai-tts-btn ai-tts-close' });
			setIcon(close, 'x');
			close.title = 'Stop & close';
			close.addEventListener('click', (e) => {
				e.stopPropagation();
				this.ttsController?.stop();
				this.ttsController = null;
				if (this.currentlySpeaking === msg.id) this.currentlySpeaking = null;
				speakBtn?.removeClass('is-speaking');
				if (speakBtn) setIcon(speakBtn, 'volume-2');
				player.remove();
			});

			// When playback finishes naturally, reflect it in the trigger button.
			if (!state.isPlaying && !state.isPaused) {
				speakBtn?.removeClass('is-speaking');
				if (speakBtn) setIcon(speakBtn, 'volume-2');
			}
		});

		// Tag the player with the unsubscribe so a re-render can clean up.
		player.dataset.unsubscribeRef = '1';
		// Best-effort cleanup when the player is removed from the DOM (e.g.
		// when the conversation re-renders). MutationObserver is overkill —
		// a single onunload hook on the wrapper covers the common cases.
		const cleanup = (e: Event): void => {
			// DOMNodeRemoved bubbles — the player re-renders itself on every
			// state change; only the WRAPPER's own removal ends the
			// subscription (unsubscribing on descendant removal froze the
			// player after its first re-render).
			if (e.target !== wrapper) return;
			unsub();
			wrapper.removeEventListener('DOMNodeRemoved', cleanup);
		};
		wrapper.addEventListener('DOMNodeRemoved', cleanup);
	}

	/**
	 * Speak an assistant message via auto-speak. Uses the final stored message
	 * object. No-op when auto-speak is off or speech is unsupported.
	 */
	private maybeAutoSpeak(msg: ConversationMessage): void {
		if (!this.autoSpeak || !isSpeechSupported() || !msg.content) return;
		this.currentlySpeaking = msg.id;
		// Auto-speak uses the simple path (no player UI) — the player is only
		// rendered when the user explicitly clicks Speak.
		speakText(msg.content, {
			onEnd: () => {
				if (this.currentlySpeaking === msg.id) this.currentlySpeaking = null;
			},
		});
	}

	// --- Image attachments ------------------------------------------------

	/** Extensions the chat importer recognizes when dropped on the view. */
	private static IMPORT_EXTENSIONS = new Set(['curt', 'json', 'zip', 'md', 'txt']);

	private setupDragDrop(target: HTMLElement): void {
		target.addEventListener('dragover', (e) => {
			if (e.dataTransfer?.types?.includes('Files')) {
				e.preventDefault();
				target.addClass('is-drag-over');
			}
		});
		target.addEventListener('dragleave', () => target.removeClass('is-drag-over'));
		target.addEventListener('drop', (e) => {
			if (!e.dataTransfer?.files?.length) return;
			e.preventDefault();
			target.removeClass('is-drag-over');
			const dropped = Array.from(e.dataTransfer.files);
			const imgs = dropped.filter((f) => f.type.startsWith('image/'));
			if (imgs.length > 0) void this.addImageFiles(imgs);
			// Non-image files with importable extensions go to the chat importer
			// (ChatGPT/Claude exports, .curt files, generic transcripts).
			const importable = dropped.filter((f) => {
				const ext = f.name.toLowerCase().split('.').pop() || '';
				return !f.type.startsWith('image/') && ChatView.IMPORT_EXTENSIONS.has(ext);
			});
			if (importable.length > 0) void importDroppedFiles(this.plugin, importable);
		});
	}

	private handlePaste(e: ClipboardEvent): void {
		const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
		if (files.length === 0) return;
		e.preventDefault();
		void this.addImageFiles(files);
	}

	/** Read File objects → save to vault as real attachments → add to pending list. */
	private async addImageFiles(files: File[]): Promise<void> {
		// Vision gate: warn (but still allow) if active model doesn't claim vision.
		const provider = this.plugin.providerRegistry.getProvider(this.activeProviderId);
		const model = provider?.models.find((m) => m.id === this.activeModelId);
		if (provider && model && model.visionSupported === false) {
			new Notice(`${model.name} may not support images — sending anyway`, 5000);
		}

		const MAX_BYTES = 8 * 1024 * 1024; // 8 MB per image
		for (const f of files) {
			if (!f.type.startsWith('image/')) continue;
			if (f.size > MAX_BYTES) {
				new Notice(`Skipping ${f.name}: >8MB`);
				continue;
			}
			try {
				const buf = await f.arrayBuffer();
				const file = await saveImageToVault(this.app, buf, f.type || 'image/png');
				if (!file) continue;
				// Resource URL — Obsidian's app-internal URL for the file.
				// Good for <img src> for the lifetime of the view.
				const thumbUrl = this.app.vault.getResourcePath(file);
				this.pendingImages.push({ path: file.path, thumbUrl, name: f.name });
			} catch (e) {
				console.error('[Curtis] image save failed:', e);
				new Notice(`Failed to attach ${f.name}`);
			}
		}
		this.renderImageStrip();
	}

	private renderImageStrip(): void {
		this.imageStrip.empty();
		if (this.pendingImages.length === 0) {
			this.imageStrip.addClass('is-hidden');
			return;
		}
		this.imageStrip.removeClass('is-hidden');
		for (let i = 0; i < this.pendingImages.length; i++) {
			const img = this.pendingImages[i];
			const tile = this.imageStrip.createDiv({ cls: 'ai-chat-image-tile' });
			const thumb = tile.createEl('img', { cls: 'ai-chat-image-thumb' });
			thumb.src = img.thumbUrl;
			thumb.alt = img.name;
			thumb.title = img.name;
			const remove = tile.createEl('button', { cls: 'ai-chat-image-remove' });
			setIcon(remove, 'x');
			remove.title = 'Remove image';
			remove.setAttribute('aria-label', 'Remove image');
			const idx = i;
			remove.addEventListener('click', () => {
				this.pendingImages.splice(idx, 1);
				this.renderImageStrip();
			});
		}
	}

	private async sendMessage(): Promise<void> {
		const content = this.inputEl.value;
		const trimmed = content.trim();
		if (!trimmed || this.isGenerating) return;

		this.hideSlashMenu();
		this.hideMentionMenu();

		// Arena branch — fan out to all selected models in parallel. Lives
		// before slash-command handling so /help etc. still work in arena
		// mode (they consume the input without sending).
		if (this.arenaMode && this.arenaSelectedModels.length >= 2) {
			// Slash commands still take precedence inside arena.
			if (trimmed.startsWith('/')) {
				const before = this.inputEl.value;
				const consumed = await handleSlashCommand(trimmed, this.slashContext());
				if (consumed) {
					// Only clear when the command left the input untouched — /paste
					// REPLACES the input with the clipboard text.
					if (this.inputEl.value === before) this.inputEl.value = '';
					this.autoResizeInput();
					return;
				}
			}
			const prompt = trimmed;
			this.inputEl.value = '';
			this.mentionEndOffset = -1;
			this.autoResizeInput();
			void this.sendArenaMessage(prompt);
			return;
		}

		// Slash command interception — consumed commands suppress the send.
		if (trimmed.startsWith('/')) {
			const before = this.inputEl.value;
			const consumed = await handleSlashCommand(trimmed, this.slashContext());
			if (consumed) {
				// Only clear when the command left the input untouched — /paste
				// REPLACES the input with the clipboard text (clearing here used
				// to wipe it in the same tick, making /paste a no-op).
				if (this.inputEl.value === before) this.inputEl.value = '';
				this.autoResizeInput();
				return;
			}
			// Unknown slash command falls through and gets sent literally.
		}

		// Ensure we have an active conversation
		if (!this.getConversationForView()) {
			this.startNewChat();
		}
		// startNewChat is a no-op when it refuses (belt-and-braces: it can
		// only refuse mid-stream, which sendMessage already blocks) — never
		// send into a null pin.
		if (!this.conversationId) {
			new Notice('No conversation to send into — try again');
			return;
		}
		// Pin every store write below to THIS pane's conversation — the user
		// may start a new chat, switch conversations, or use another pane
		// while the stream is in flight.
		const convId = this.conversationId;

		let provider;
		try {
			provider = this.plugin.getAuthenticatedProvider();
		} catch {
			new Notice('No AI provider configured or authenticated. Check settings.');
			return;
		}

		// Add user message — capture any pending image attachments (vault paths).
		const imagePaths = this.pendingImages.map((p) => p.path);
		// Capture @-mention attachments so buildMessagesArray can prepend their
		// contents to the AI-bound message. The user's chat bubble shows only
		// `trimmed`; attachments are invisible context.
		const notePaths = this.pendingNoteAttachments.map((f) => f.path);
		// Suppress the conversation:changed self-re-render — the composer is
		// re-rendered right below.
		this.suppressStoreEvents = true;
		this.store.addMessageTo(convId, {
			role: 'user',
			content: trimmed,
			provider: provider.id,
			model: this.activeModelId,
			images: imagePaths.length > 0 ? imagePaths : undefined,
			attachedNotes: notePaths.length > 0 ? notePaths : undefined,
		});
		this.suppressStoreEvents = false;
		// Track for error-reporting (so we can suggest vision model if it fails).
		this.currentSendHasImages = imagePaths.length > 0;
		// Clear the pending strips — images + notes are now persisted on the message.
		this.pendingImages = [];
		this.renderImageStrip();
		this.pendingNoteAttachments = [];
		this.renderAttachmentChips();
		this.inputEl.value = '';
		this.mentionEndOffset = -1;
		this.autoResizeInput();

		// Re-render to show user message
		this.renderCurrentConversation();

		// The first real message retires the onboarding panel for good.
		if (!this.plugin.settings.onboardingCompleted) {
			this.plugin.settings.onboardingCompleted = true;
			void this.plugin.saveSettings();
		}

		// Show generating state
		this.isGenerating = true;
		this.setGeneratingUI(true);
		this.streamingContent = '';

		// Create assistant message placeholder with role label + "Thinking…" state
		// (convId was pinned above, before the user message was stored.)
		const conv = this.store.getConversation(convId)!;
		// Snapshot of the memory ids injected this turn. Attached to the stored
		// assistant message so the "N memories" chip stays truthful even after
		// the fact set changes (removed facts render as "since removed").
		const memoryIds = this.plugin.settings.enableMemory
			? this.plugin.memoryStore.getFacts().map((f) => f.id)
			: [];
		const assistantWrapper = this.messagesContainer.createDiv({
			cls: 'ai-message ai-message-assistant ai-message-thinking',
		});

		const modelLabel = (() => {
			const p = this.plugin.providerRegistry.getProvider(provider.id);
			const m = p?.models.find((x) => x.id === this.activeModelId);
			return m?.name || this.activeModelId || 'Assistant';
		})();

		const meta = assistantWrapper.createDiv({ cls: 'ai-message-meta' });
		const color = providerColor(provider.id);
		if (color) assistantWrapper.style.setProperty('--provider-color', color);
		meta.createDiv({ cls: 'ai-message-role-dot' });
		meta.createDiv({ cls: 'ai-message-role', text: modelLabel });

		const assistantContent = assistantWrapper.createDiv({ cls: 'ai-message-content' });
		this.scrollToBottom();

		this.abortController = new AbortController();

		// Track whether the assistant message was already persisted (via onUsage)
		// to avoid the double-add bug — usage may fire before or after final chunk.
		let assistantStored = false;
		let storedMessageId: string | null = null;
		let firstChunkReceived = false;
		// Set by onError callbacks / a thrown error — drives the failure
		// notification and suppresses the completion one.
		let errorSeen = false;

		try {
			// Build messages array from conversation history
			const aiMessages: AIMessage[] = await this.buildMessagesArray(conv);

			// Agent mode branch: if enabled + provider supports OpenAI tool calls,
			// delegate to callAgentLoop. Tool invocations render as separate
			// bubbles inserted BEFORE the final assistant bubble. The final text
			// still arrives via onChunk so the existing streaming UI works.
			const agentActive = this.plugin.settings.enableAgent
				&& provider.supportsToolCalls?.() === true;

			if (agentActive) {
				await this.plugin.callAgentLoop(aiMessages, this.activeModelId, {
					onChunk: (chunk: string) => {
						if (!firstChunkReceived) {
							firstChunkReceived = true;
							assistantWrapper.removeClass('ai-message-thinking');
							assistantWrapper.addClass('ai-message-streaming');
						}
						this.streamingContent += chunk;
						this.renderer.renderStreamedMessage(assistantContent, this.streamingContent);
						this.scrollToBottom();
					},
					onUsage: (usage: TokenUsage) => {
						if (!assistantStored) {
							const stored = this.store.addMessageTo(convId, {
								role: 'assistant',
								content: this.streamingContent,
								tokens: usage,
								cost: this.estimateMessageCost(provider.id, this.activeModelId, usage) ?? undefined,
								provider: provider.id,
								model: this.activeModelId,
								memoriesUsedIds: memoryIds.length > 0 ? memoryIds : undefined,
							});
							if (stored) {
								storedMessageId = stored.id;
								assistantStored = true;
							}
						}
						if (this.plugin.settings.showTokenUsage) {
							const info = assistantWrapper.querySelector('.ai-message-info');
							if (info instanceof HTMLElement) {
								info.setText(`${usage.totalTokens} tok`);
							} else {
								meta.createDiv({ cls: 'ai-message-info', text: `${usage.totalTokens} tok` });
							}
						}
					},
					onError: (error: Error) => {
						errorSeen = true;
						console.error('[Curtis] Agent error:', error);
						const friendly = friendlyError(error, this.currentSendHasImages);
						new Notice(friendly.message, 8000);
						this.streamingContent += `\n\n*⚠️ ${friendly.message}*`;
						this.renderer.renderStreamedMessage(assistantContent, this.streamingContent);
					},
					onToolCall: (call: ToolCall) => {
						// Render the invocation as a stored assistant message + a
						// live bubble inserted before the streaming assistant wrapper.
						this.store.addMessageTo(convId, {
							role: 'assistant',
							content: '',
							tool_calls: [call],
							provider: provider.id,
							model: this.activeModelId,
						});
						const bubble = this.messagesContainer.createDiv({ cls: 'ai-message ai-message-tool-call' });
						this.messagesContainer.insertBefore(bubble, assistantWrapper);
						this.renderToolCallBubble(bubble, call);
						this.scrollToBottom();
					},
					onToolResult: (call: ToolCall, result: { content: string; isError: boolean }) => {
						this.store.addMessageTo(convId, {
							role: 'tool',
							content: result.content,
							tool_call_id: call.id,
							tool_error: result.isError || undefined,
						});
						const bubble = this.messagesContainer.createDiv({
							cls: 'ai-message ai-message-tool' + (result.isError ? ' is-error' : ''),
						});
						this.messagesContainer.insertBefore(bubble, assistantWrapper);
						this.appendToolResultContentInto(bubble, result.content, result.isError);
						this.scrollToBottom();
					},
					signal: this.abortController.signal,
				});
			} else {
				await this.plugin.callAI(aiMessages, this.activeModelId, {
					onChunk: (chunk: string) => {
						if (!firstChunkReceived) {
							firstChunkReceived = true;
							assistantWrapper.removeClass('ai-message-thinking');
							assistantWrapper.addClass('ai-message-streaming');
						}
						this.streamingContent += chunk;
						this.renderer.renderStreamedMessage(assistantContent, this.streamingContent);
						this.scrollToBottom();
					},
					onUsage: (usage: TokenUsage) => {
						if (!assistantStored) {
							const stored = this.store.addMessageTo(convId, {
								role: 'assistant',
								content: this.streamingContent,
								tokens: usage,
								cost: this.estimateMessageCost(provider.id, this.activeModelId, usage) ?? undefined,
								provider: provider.id,
								model: this.activeModelId,
								memoriesUsedIds: memoryIds.length > 0 ? memoryIds : undefined,
							});
							if (stored) {
								storedMessageId = stored.id;
								assistantStored = true;
							}
						}
						if (this.plugin.settings.showTokenUsage) {
							// Update token count in the meta row (same gate as the
							// persisted-message badge so the count doesn't flash
							// for users who turned token display off).
							const info = assistantWrapper.querySelector('.ai-message-info');
							if (info instanceof HTMLElement) {
								info.setText(`${usage.totalTokens} tok`);
							} else {
								meta.createDiv({ cls: 'ai-message-info', text: `${usage.totalTokens} tok` });
							}
						}
					},
					onError: (error: Error) => {
						errorSeen = true;
						console.error('[Curtis] Stream error:', error);
						const friendly = friendlyError(error, this.currentSendHasImages);
						new Notice(friendly.message, 8000);
						this.streamingContent += `\n\n*⚠️ ${friendly.message}*`;
						this.renderer.renderStreamedMessage(assistantContent, this.streamingContent);
					},
					signal: this.abortController.signal,
				});
			}

			// If no usage callback fired, store the message without token counts
			if (!assistantStored && this.streamingContent) {
				const stored = this.store.addMessageTo(convId, {
					role: 'assistant',
					content: this.streamingContent,
					provider: provider.id,
					model: this.activeModelId,
					memoriesUsedIds: memoryIds.length > 0 ? memoryIds : undefined,
				});
				if (stored) {
					storedMessageId = stored.id;
					assistantStored = true;
				}
			}
		} catch (e) {
			if ((e as Error).name !== 'AbortError') {
				errorSeen = true;
				console.error('[Curtis] AI call failed:', e);
				new Notice('AI request failed. Check console for details.');
			}
		} finally {
			// Read the abort state before nulling the controller — an aborted
			// stream must not fire a completion notification.
			const aborted = this.abortController?.signal.aborted ?? false;
			this.isGenerating = false;
			this.setGeneratingUI(false);
			this.abortController = null;
			assistantWrapper.removeClass('ai-message-streaming');
			assistantWrapper.removeClass('ai-message-thinking');
			// Final markdown render — replaces the streaming plain-text preview
			// with a fully-parsed markdown view (code blocks, links, etc.).
			this.renderer.renderStreamedMessage(assistantContent, this.streamingContent, true);
			this.scrollToBottom();

			// The store writes below are self-initiated — other panes still get
			// the conversation:changed event; this one manages its own DOM.
			this.suppressStoreEvents = true;
			try {
				// Attach hover-visible actions now that the message is final.
				if (storedMessageId && this.streamingContent) {
					// Sync final content into the stored message in case usage fired
					// early (before the final chunk) and the snapshot is stale.
					this.store.updateMessage(storedMessageId, { content: this.streamingContent }, convId);
					const stored = this.store.getConversation(convId)?.messages.find((m) => m.id === storedMessageId);
					if (stored) {
						attachMessageActions({
							app: this.app,
							wrapper: assistantWrapper,
							message: stored,
							saveFolder: this.plugin.settings.noteSaveFolder,
							callbacks: {
								onRegenerate: (m) => void this.regenerateMessage(m.id),
								onQuoteIntoInput: (m) => this.quoteMessageIntoInput(m),
							},
						});
						this.attachSpeakAction(assistantWrapper, stored);
						// Auto-speak the fresh response if the toggle is on.
						this.maybeAutoSpeak(stored);
						// Auto-save (silent) if the user opted in.
						if (this.plugin.settings.autoSaveAssistantResponses) {
							const folder = this.plugin.settings.autoSaveFolder || this.plugin.settings.noteSaveFolder;
							void saveMessageAsNote(this.app, stored, folder).catch((e) =>
								console.error('[Curtis] auto-save failed:', e)
							);
						}
					}
				}
				// Memory chip — shows which remembered facts were in context.
				if (memoryIds.length > 0) this.renderMemoryChipInto(meta, memoryIds);
			} finally {
				this.suppressStoreEvents = false;
			}
			this.notifyResponseFinished(convId, {
				aborted,
				failed: errorSeen,
				content: this.streamingContent,
			});
			// Background fact extraction — fire-and-forget.
			// Reset image-flag + extract facts.
			this.currentSendHasImages = false;
			this.maybeExtractFacts(convId);
		}
	}

	/** Completion/failure notification for a finished stream. No-op when the
	 *  round was aborted, the user is watching this pane, or the matching
	 *  setting is off. */
	private notifyResponseFinished(
		convId: string,
		state: { aborted: boolean; failed: boolean; content: string }
	): void {
		if (state.aborted || this.isChatVisible()) return;
		const title = `Curtis — ${this.store.getConversation(convId)?.title || 'chat'}`;
		if (state.failed) {
			if (!this.plugin.settings.notifyOnError) return;
			notifyResponse({ title, body: 'Request failed — open the chat for details.', leaf: this.leaf });
		} else {
			if (!this.plugin.settings.notifyOnCompletion || !state.content) return;
			notifyResponse({ title, body: responsePreview(state.content), leaf: this.leaf });
		}
	}

	/** Pull the last user/assistant pair from the conversation the stream was
	 *  pinned to and hand to the plugin for extraction. The pinned id (not
	 *  getCurrentConversation) is used so switching chats mid-stream can't
	 *  extract from the wrong conversation — and so captured facts record
	 *  which conversation they came from. In 'confirm' mode the proposals
	 *  come back here for ratification. */
	private maybeExtractFacts(convId: string): void {
		const conv = this.store.getConversation(convId);
		if (!conv) return;
		const msgs = conv.messages;
		const assistant: ConversationMessage | undefined = msgs[msgs.length - 1];
		if (!assistant || assistant.role !== 'assistant') return;
		let userIdx = msgs.length - 2;
		while (userIdx >= 0 && msgs[userIdx].role !== 'user') userIdx--;
		if (userIdx < 0) return;
		const userMsg = msgs[userIdx];
		void this.plugin.extractAndStoreFacts(
			userMsg.content,
			assistant.content,
			(proposals) => this.renderMemoryProposals(proposals),
			convId
		).catch((e) =>
			console.debug('[Curtis] fact extraction failed:', e)
		);
	}

	/** Open memory popover (one at a time, in-flow below its message). */
	private memPopover: HTMLElement | null = null;
	/** Chip that opened {@link memPopover} — re-clicking it closes. */
	private memPopoverChip: HTMLElement | null = null;

	/** "N memories" chip for an assistant message meta row. Shared by the live
	 *  stream path and restored history; no-op when the chip already exists. */
	private renderMemoryChipInto(meta: HTMLElement, ids: string[]): void {
		if (meta.querySelector('.ai-message-mem')) return;
		const chip = meta.createDiv({
			cls: 'ai-message-mem',
			attr: { 'aria-label': 'Memories used in this reply' },
		});
		setIcon(chip, 'lucide-brain');
		chip.createSpan({ cls: 'ai-message-mem-count', text: String(ids.length) });
		chip.addEventListener('click', () => this.toggleMemoryPopover(chip, ids));
	}

	private closeMemoryPopover(): void {
		this.memPopover?.remove();
		this.memPopover = null;
		this.memPopoverChip = null;
	}

	/** Expand/collapse the fact list under the chip's message bubble. Facts
	 *  are resolved against the CURRENT memory store, so edited or removed
	 *  facts degrade honestly instead of showing stale text. */
	private toggleMemoryPopover(chip: HTMLElement, ids: string[]): void {
		const reopen = this.memPopoverChip !== chip;
		this.closeMemoryPopover();
		if (!reopen) return;
		this.memPopoverChip = chip;

		const pop = createDiv({ cls: 'ai-mem-popover' });
		const byId = new Map(this.plugin.memoryStore.getFacts().map((f) => [f.id, f]));
		for (const id of ids) {
			const fact = byId.get(id);
			const row = pop.createDiv({ cls: 'ai-mem-popover-row' });
			if (!fact) {
				row.createDiv({ cls: 'ai-mem-popover-fact is-removed', text: '(since removed)' });
				continue;
			}
			row.createDiv({ cls: 'ai-mem-popover-fact', text: fact.content });
			const metaLine = row.createDiv({ cls: 'ai-mem-popover-meta' });
			metaLine.createSpan({ text: `learned ${new Date(fact.timestamp).toLocaleDateString()}` });
			if (fact.sourceConversationId) {
				const conv = this.plugin.conversationStore.getConversation(fact.sourceConversationId);
				if (conv) {
					const link = metaLine.createEl('a', { cls: 'ai-mem-popover-link', text: 'View conversation' });
					link.addEventListener('click', (ev) => {
						ev.preventDefault();
						this.closeMemoryPopover();
						this.switchConversation(conv.id);
					});
				}
			}
		}
		const footer = pop.createDiv({ cls: 'ai-mem-popover-footer' });
		const open = footer.createEl('a', { cls: 'ai-mem-popover-link', text: 'Open memory file' });
		open.addEventListener('click', (ev) => {
			ev.preventDefault();
			this.closeMemoryPopover();
			void this.app.workspace.openLinkText(this.plugin.settings.memoryFilePath, '', false);
		});

		const host = chip.closest('.ai-message');
		if (host?.parentElement) {
			host.parentElement.insertBefore(pop, host.nextSibling);
		} else {
			this.messagesContainer.appendChild(pop);
		}
		this.memPopover = pop;
		this.scrollToBottom();
	}

	/** 'confirm' capture mode: show proposed facts under the last message.
	 *  Nothing is written to the memory file until the user taps Save; the
	 *  bar is transient — sending the next message clears it. */
	private renderMemoryProposals(proposals: MemoryProposal[]): void {
		const fresh = proposals.filter(
			(p) => !this.dismissedProposals.has(p.content.toLowerCase())
		).slice(0, 3);
		if (fresh.length === 0) return;

		// One bar at a time — a pending bar from a previous turn is replaced.
		this.messagesContainer.querySelectorAll('.ai-memory-proposal-bar').forEach((el) => el.remove());

		const bar = this.messagesContainer.createDiv({ cls: 'ai-memory-proposal-bar' });
		const header = bar.createDiv({ cls: 'ai-memory-proposal-header' });
		header.createDiv({ cls: 'ai-memory-proposal-title', text: 'Worth remembering?' });
		const closeBtn = header.createEl('button', {
			cls: 'ai-memory-proposal-close clickable-icon',
			attr: { 'aria-label': 'Dismiss' },
		});
		setIcon(closeBtn, 'lucide-x');

		const removeBarIfEmpty = () => {
			if (!bar.querySelector('.ai-memory-proposal-row')) bar.remove();
		};
		closeBtn.addEventListener('click', () => {
			// Treat dismiss-all as "not now" for everything still showing, so
			// the same facts don't come back next turn.
			bar.querySelectorAll('.ai-memory-proposal-row').forEach((row) => {
				const text = row.querySelector('.ai-memory-proposal-text')?.textContent;
				if (text) this.dismissedProposals.add(text.toLowerCase());
			});
			bar.remove();
		});

		for (const p of fresh) {
			const row = bar.createDiv({ cls: 'ai-memory-proposal-row' });
			row.createDiv({ cls: 'ai-memory-proposal-text', text: p.content });
			const actions = row.createDiv({ cls: 'ai-memory-proposal-actions' });
			const saveBtn = actions.createEl('button', { cls: 'mod-cta', text: 'Save', type: 'button' });
			const skipBtn = actions.createEl('button', { text: 'Skip', type: 'button' });
			saveBtn.addEventListener('click', () => {
				void (async () => {
					await this.plugin.memoryStore.addFact(p.content, p.category, p.sourceConversationId);
					row.addClass('is-saved');
					row.querySelector('.ai-memory-proposal-actions')?.remove();
					row.querySelector('.ai-memory-proposal-text')?.setText(`Saved: ${p.content}`);
					window.setTimeout(() => {
						row.remove();
						removeBarIfEmpty();
					}, 1200);
				})();
			});
			skipBtn.addEventListener('click', () => {
				this.dismissedProposals.add(p.content.toLowerCase());
				row.remove();
				removeBarIfEmpty();
			});
		}

		this.scrollToBottom();
	}

	private abortGeneration(): void {
		if (this.arenaAbortControllers.size > 0) {
			this.abortArena();
			return;
		}
		if (this.abortController) {
			this.abortController.abort();
		}
	}

	/** Toggle send/abort button visibility based on generation state. Uses
	 *  class toggles instead of direct style writes (Obsidian lint rule). */
	private setGeneratingUI(generating: boolean): void {
		if (generating) {
			this.sendBtn.addClass('is-hidden');
			this.abortBtn.removeClass('is-hidden');
		} else {
			this.sendBtn.removeClass('is-hidden');
			this.abortBtn.addClass('is-hidden');
		}
	}

	private async buildMessagesArray(conv: Conversation): Promise<AIMessage[]> {
		const messages: AIMessage[] = [];

		// System prompt = CORE (non-negotiable identity/capabilities) + user
		// extension (editable in settings) + memory block (if enabled).
		// The CORE guarantees Curtis always knows what it is and what tools
		// it has — users add context via the extension, they cannot remove it.
		const sysParts: string[] = [composeSystemPrompt(this.plugin.settings.systemPrompt)];
		if (this.plugin.settings.enableMemory) {
			const memBlock = this.plugin.memoryStore.formatFactsForPrompt();
			if (memBlock) sysParts.push(memBlock);
		}
		const ragBlock = await this.buildRetrievedContextBlock(conv);
		if (ragBlock) sysParts.push(ragBlock);
		messages.push({ role: 'system', content: sysParts.join('\n\n') });

		// Conversation history — user messages with attached images become
		// multi-part content (text + image_url). Image paths are read from the
		// vault at send time and converted to base64 data URLs. @-mention note
		// attachments are prepended to the text portion (invisible to the user,
		// visible to the AI as `[Attached note: Name]\n<contents>`).
		for (const msg of conv.messages) {
			if (msg.role === 'user' && msg.images && msg.images.length > 0) {
				const parts: MessageContent[] = [];
				const textWithNotes = await this.prependAttachedNotes(msg.content, msg.attachedNotes);
				if (textWithNotes) parts.push({ type: 'text', text: textWithNotes });
				for (const imgPath of msg.images) {
					const dataUrl = await this.imagePathToDataUrl(imgPath);
					if (dataUrl) {
						parts.push({ type: 'image_url', image_url: { url: dataUrl } });
					}
				}
				messages.push({ role: 'user', content: parts.length > 0 ? parts : msg.content });
			} else if (msg.role === 'user' && msg.attachedNotes && msg.attachedNotes.length > 0) {
				// Text-only message with @-mention attachments.
				const textWithNotes = await this.prependAttachedNotes(msg.content, msg.attachedNotes);
				messages.push({ role: 'user', content: textWithNotes });
			} else if (msg.role === 'tool') {
				// Tool result messages must carry tool_call_id for OpenAI-compat APIs.
				messages.push({
					role: 'tool',
					content: msg.content,
					tool_call_id: msg.tool_call_id,
					// Anthropic replays tool_result blocks with is_error; without
					// it, past failures look like successes in history.
					is_error: msg.tool_error || undefined,
				});
			} else if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
				// Assistant tool-invocation messages carry the tool_calls array.
				messages.push({
					role: 'assistant',
					content: msg.content || '',
					tool_calls: msg.tool_calls,
				});
			} else {
				messages.push({ role: msg.role, content: msg.content });
			}
		}

		return messages;
	}

	/**
	 * Vault retrieval (RAG): embed the latest user message and pull the most
	 * relevant note excerpts into the system prompt. Returns null (no block)
	 * when retrieval is off, the last turn carries an explicit @-mention
	 * attachment (curated context wins — same precedence rule the agent loop
	 * applies to read_note/search_notes), there is nothing to query, or the
	 * search fails. Retrieval problems must never block a send.
	 */
	private async buildRetrievedContextBlock(conv: Conversation): Promise<string | null> {
		if (!this.plugin.settings.enableRag) return null;
		const lastUser = [...conv.messages].reverse().find((m) => m.role === 'user');
		if (!lastUser) return null;
		// Explicit attachment on the current turn — the user already chose the
		// context; don't pile retrieved excerpts on top of it.
		if (lastUser.attachedNotes && lastUser.attachedNotes.length > 0) return null;
		const query = lastUser.content.trim();
		if (!query || query.startsWith('/')) return null;
		try {
			const results = await this.plugin.ragIndex.search(query, this.plugin.settings.ragTopK);
			// Notes attached anywhere in the conversation are already in-context
			// as full [Attached note: …] blocks — excerpting them again just
			// burns context.
			const attached = new Set<string>();
			for (const m of conv.messages) {
				for (const p of m.attachedNotes || []) attached.add(p);
			}
			return formatRetrievedContext(results, attached);
		} catch (e) {
			console.warn('[Curtis] Vault retrieval failed (non-fatal, sending without):', e);
			return null;
		}
	}

	/**
	 * Build the user-visible text with attached-note contents prepended as
	 * invisible context. Each note is rendered as:
	 *
	 *   [Attached note: <basename>]
	 *   <note contents>
	 *
	 * Blocks are joined with a horizontal rule and a trailing separator sets
	 * them off from the user's actual message. Returns the original content
	 * unchanged when no attachments are present (or when reads fail).
	 */
	private async prependAttachedNotes(content: string, attachedNotes?: string[]): Promise<string> {
		if (!attachedNotes || attachedNotes.length === 0) return content;
		const parts: string[] = [];
		for (const notePath of attachedNotes) {
			const file = this.app.vault.getAbstractFileByPath(notePath);
			if (!(file instanceof TFile)) continue;
			try {
				const body = await this.app.vault.read(file);
				// Include the FULL vault-relative path (not just basename) so
				// the AI has the exact value to pass back to edit_note /
				// create_note tools. Without this, the model was guessing the
				// path (basename only, wrong extension, missing folder) and
				// `getAbstractFileByPath` failed inside the tool.
				parts.push(`[Attached note: ${file.path}]\n${body}`);
			} catch (e) {
				console.error(`[Curtis] Failed to read attached note ${notePath}:`, e);
			}
		}
		if (parts.length === 0) return content;
		return parts.join('\n\n---\n\n') + '\n\n---\n\n' + content;
	}

	/** Read a vault image file and return it as a base64 data URL. */
	private async imagePathToDataUrl(path: string): Promise<string | null> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return null;
		try {
			const bytes = await this.app.vault.readBinary(file);
			const mime = imageMimeFromExt(file.extension);
			const base64 = bytesToBase64(bytes);
			return `data:${mime};base64,${base64}`;
		} catch (e) {
			console.error(`[Curtis] Failed to read image ${path}:`, e);
			return null;
		}
	}

	// --- Regenerate / edit-resend ---------------------------------------

	/**
	 * Drop the given assistant message + everything after it, then re-stream
	 * a fresh response using the conversation history up to that point.
	 */
	private async regenerateMessage(assistantMessageId: string): Promise<void> {
		if (this.isGenerating) {
			new Notice('Already generating');
			return;
		}
		const conv = this.getConversationForView();
		if (!conv) return;

		const idx = conv.messages.findIndex((m) => m.id === assistantMessageId);
		if (idx === -1) {
			new Notice('Message not found');
			return;
		}

		// Authenticate BEFORE truncating — the auth check inside the re-stream
		// only shows a Notice, and by then the old reply is already deleted
		// (data loss with no replacement when the key is gone).
		try {
			this.plugin.getAuthenticatedProvider();
		} catch {
			new Notice('No AI provider configured or authenticated. Check settings.');
			return;
		}

		// Truncate the conversation so the dropped assistant message and
		// everything after it are removed; the re-stream replaces them.
		// (Suppressed self-event: the explicit render right below covers it.)
		this.suppressStoreEvents = true;
		try {
			this.store.truncateFromMessage(assistantMessageId, conv.id);
		} finally {
			this.suppressStoreEvents = false;
		}
		this.renderCurrentConversation();

		// Trigger a no-op "user" send path: we re-use sendMessage's body by
		// synthesizing an empty user input — but that path early-returns on empty.
		// Instead, inline the assistant-stream logic by calling a dedicated helper.
		await this.streamAssistantResponse();
	}

	/**
	 * Edit-resend for a user bubble directly: truncate everything after the
	 * user message, delete the user message itself (so the next send isn't
	 * duplicated), then load its text into the input box.
	 */
	private editUserMessage(userMessageId: string): void {
		const conv = this.getConversationForView();
		if (!conv) return;
		const idx = conv.messages.findIndex((m) => m.id === userMessageId);
		if (idx < 0) return;
		const userMsg = conv.messages[idx];
		if (userMsg.role !== 'user') return;
		// (Suppressed self-event: the explicit render right below covers it.)
		this.suppressStoreEvents = true;
		try {
			this.store.truncateAfterMessage(userMsg.id, conv.id);
			this.store.deleteMessage(userMsg.id, conv.id);
		} finally {
			this.suppressStoreEvents = false;
		}
		// Restore the message's attachments into the pending strips — an
		// edit-resend used to silently drop images and @-noted notes.
		this.pendingImages = [];
		for (const imgPath of userMsg.images || []) {
			const file = this.app.vault.getAbstractFileByPath(imgPath);
			if (!(file instanceof TFile)) continue;
			this.pendingImages.push({
				path: file.path,
				thumbUrl: this.app.vault.getResourcePath(file),
				name: file.name,
			});
		}
		this.pendingNoteAttachments = (userMsg.attachedNotes || [])
			.map((p) => this.app.vault.getAbstractFileByPath(p))
			.filter((f): f is TFile => f instanceof TFile);
		this.renderImageStrip();
		this.renderAttachmentChips();
		this.renderCurrentConversation();
		this.inputEl.value = userMsg.content;
		this.mentionEndOffset = -1;
		this.autoResizeInput();
		this.inputEl.focus();
		new Notice('Edit the prompt and send');
	}

	/**
	 * Stream a fresh assistant response from the current conversation state,
	 * without consuming input. Used by /regen and regenerate-message.
	 */
	private async streamAssistantResponse(): Promise<void> {
		let provider;
		try {
			provider = this.plugin.getAuthenticatedProvider();
		} catch {
			new Notice('No AI provider configured or authenticated. Check settings.');
			return;
		}
		const conv = this.getConversationForView();
		if (!conv) return;
		// Pin store writes to this conversation for the whole re-stream.
		const convId = conv.id;
		// Same memory snapshot as sendMessage — powers the chip on regens.
		const memoryIds = this.plugin.settings.enableMemory
			? this.plugin.memoryStore.getFacts().map((f) => f.id)
			: [];

		// Set the image flag based on the last user message (it may have
		// attached images that an error would blame).
		const lastUser = this.store.getLastUserMessage(convId);
		this.currentSendHasImages = !!(lastUser?.images && lastUser.images.length > 0);

		this.isGenerating = true;
		this.setGeneratingUI(true);
		this.streamingContent = '';

		const assistantWrapper = this.messagesContainer.createDiv({
			cls: 'ai-message ai-message-assistant ai-message-thinking',
		});
		const modelLabel = (() => {
			const p = this.plugin.providerRegistry.getProvider(provider.id);
			const m = p?.models.find((x) => x.id === this.activeModelId);
			return m?.name || this.activeModelId || 'Assistant';
		})();
		const meta = assistantWrapper.createDiv({ cls: 'ai-message-meta' });
		const color = providerColor(provider.id);
		if (color) assistantWrapper.style.setProperty('--provider-color', color);
		meta.createDiv({ cls: 'ai-message-role-dot' });
		meta.createDiv({ cls: 'ai-message-role', text: modelLabel });

		const assistantContent = assistantWrapper.createDiv({ cls: 'ai-message-content' });
		this.scrollToBottom();
		this.abortController = new AbortController();

		let assistantStored = false;
		let storedMessageId: string | null = null;
		let firstChunkReceived = false;
		let errorSeen = false;

		try {
			const aiMessages = await this.buildMessagesArray(conv);
			await this.plugin.callAI(aiMessages, this.activeModelId, {
				onChunk: (chunk: string) => {
					if (!firstChunkReceived) {
						firstChunkReceived = true;
						assistantWrapper.removeClass('ai-message-thinking');
						assistantWrapper.addClass('ai-message-streaming');
					}
					this.streamingContent += chunk;
					this.renderer.renderStreamedMessage(assistantContent, this.streamingContent);
					this.scrollToBottom();
				},
				onUsage: (usage: TokenUsage) => {
					if (!assistantStored) {
						const stored = this.store.addMessageTo(convId, {
							role: 'assistant',
							content: this.streamingContent,
							tokens: usage,
							cost: this.estimateMessageCost(provider.id, this.activeModelId, usage) ?? undefined,
							provider: provider.id,
							model: this.activeModelId,
						});
						if (stored) {
							storedMessageId = stored.id;
							assistantStored = true;
						}
					}
				},
				onError: (error: Error) => {
					console.error('[Curtis] Stream error:', error);
					const friendly = friendlyError(error, this.currentSendHasImages);
					new Notice(friendly.message, 8000);
					this.streamingContent += `\n\n*⚠️ ${friendly.message}*`;
					this.renderer.renderStreamedMessage(assistantContent, this.streamingContent);
				},
				signal: this.abortController.signal,
			});
			if (!assistantStored && this.streamingContent) {
				const stored = this.store.addMessageTo(convId, {
					role: 'assistant',
					content: this.streamingContent,
					provider: provider.id,
					model: this.activeModelId,
					memoriesUsedIds: memoryIds.length > 0 ? memoryIds : undefined,
				});
				if (stored) {
					storedMessageId = stored.id;
					assistantStored = true;
				}
			}
		} catch (e) {
			if ((e as Error).name !== 'AbortError') {
				errorSeen = true;
				console.error('[Curtis] Regenerate failed:', e);
				new Notice('Regenerate failed');
			}
		} finally {
			const aborted = this.abortController?.signal.aborted ?? false;
			this.isGenerating = false;
			this.setGeneratingUI(false);
			this.abortController = null;
			assistantWrapper.removeClass('ai-message-streaming');
			assistantWrapper.removeClass('ai-message-thinking');
			this.renderer.renderStreamedMessage(assistantContent, this.streamingContent, true);
			this.scrollToBottom();
			this.suppressStoreEvents = true;
			try {
				if (storedMessageId && this.streamingContent) {
					// Sync final content into the stored message in case usage fired
					// early (before the final chunk) and the snapshot is stale.
					this.store.updateMessage(storedMessageId, { content: this.streamingContent }, convId);
					const stored = this.store.getConversation(convId)?.messages.find((m) => m.id === storedMessageId);
					if (stored) {
						attachMessageActions({
							app: this.app,
							wrapper: assistantWrapper,
							message: stored,
							saveFolder: this.plugin.settings.noteSaveFolder,
							callbacks: {
								onRegenerate: (m) => void this.regenerateMessage(m.id),
								onQuoteIntoInput: (m) => this.quoteMessageIntoInput(m),
							},
						});
						this.attachSpeakAction(assistantWrapper, stored);
						this.maybeAutoSpeak(stored);
						if (this.plugin.settings.autoSaveAssistantResponses) {
							const folder = this.plugin.settings.autoSaveFolder || this.plugin.settings.noteSaveFolder;
							void saveMessageAsNote(this.app, stored, folder).catch((e) =>
								console.error('[Curtis] auto-save failed:', e)
							);
						}
					}
				}
				// Memory chip — shows which remembered facts were in context.
				if (memoryIds.length > 0) this.renderMemoryChipInto(meta, memoryIds);
			} finally {
				this.suppressStoreEvents = false;
			}
			this.notifyResponseFinished(convId, {
				aborted,
				failed: errorSeen,
				content: this.streamingContent,
			});
			// Background fact extraction — fire-and-forget.
			// Reset image-flag + extract facts.
			this.currentSendHasImages = false;
			this.maybeExtractFacts(convId);
		}
	}

	/** Build the SlashContext passed into slash-command handlers. */
	private slashContext(): SlashContext {
		return {
			plugin: this.plugin,
			app: this.app,
			raw: this.inputEl.value,
			args: '',
			// Multi-pane: commands act on the pane they were typed into.
			conversationId: this.conversationId,
			setModel: (providerId, modelId) => this.setActiveModel(providerId, modelId),
			setInput: (text) => {
				this.inputEl.value = text;
				this.autoResizeInput();
			},
			focusInput: () => this.inputEl.focus(),
			regenerate: () => {
				const last = this.conversationId ? this.store.getLastAssistantMessage(this.conversationId) : undefined;
				if (!last) {
					new Notice('Nothing to regenerate');
					return;
				}
				void this.regenerateMessage(last.id);
			},
			refresh: () => this.renderCurrentConversation(),
			newChat: () => this.startNewChat(),
		};
	}

	private scrollToBottom(): void {
		// The view's OWN window — in a popout, window.requestAnimationFrame
		// would schedule on the main window and never fire for this pane.
		const win = this.contentEl.ownerDocument.defaultView;
		win?.requestAnimationFrame(() => {
			this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
		});
	}

	// --- Arena mode -------------------------------------------------------

	/** Toggle arena on/off. When turning on, open the multi-select modal. */
	private toggleArenaMode(btn: HTMLElement): void {
		if (this.isGenerating) {
			new Notice('Stop the current response before toggling arena');
			return;
		}
		this.arenaMode = !this.arenaMode;
		btn.toggleClass('is-active', this.arenaMode);
		if (this.arenaMode) {
			this.openArenaModelPicker();
		} else {
			this.arenaSelectedModels = [];
		}
	}

	/** Build the entries list from enabled providers and open the picker. */
	private openArenaModelPicker(): void {
		// Reset selections so a previous arena run doesn't bleed in if the
		// user cancels the picker.
		this.arenaSelectedModels = [];
		const enabled = this.plugin.providerRegistry.getAllEnabledProviders();
		if (enabled.length === 0) {
			new Notice('No enabled providers. Configure one in settings first.');
			this.arenaMode = false;
			const btn = this.contentEl.querySelector('.ai-chat-arena-btn');
			if (btn instanceof HTMLElement) btn.removeClass('is-active');
			return;
		}
		const entries: ArenaModelEntry[] = [];
		for (const { id, provider } of enabled) {
			for (const model of provider.models) {
				entries.push({ providerId: id, providerName: provider.name, model });
			}
		}
		if (entries.length < 2) {
			new Notice('Need at least 2 models across enabled providers for arena');
			this.arenaMode = false;
			const btn = this.contentEl.querySelector('.ai-chat-arena-btn');
			if (btn instanceof HTMLElement) btn.removeClass('is-active');
			return;
		}
		// Pre-select the active provider+model to save a click.
		const preselected: ArenaSelection[] = [];
		const activeProvider = this.plugin.providerRegistry.getProvider(this.activeProviderId);
		const activeModel = activeProvider?.models.find((m) => m.id === this.activeModelId);
		if (activeProvider && activeModel) {
			preselected.push({
				providerId: this.activeProviderId,
				modelId: this.activeModelId,
				providerName: activeProvider.name,
				modelName: activeModel.name,
			});
		}
		// Pre-fill the selection set with the active model so the user just
		// needs to pick one more to start.
		const modal = new ArenaModelPickerModal(
			this.app,
			entries,
			(selections) => {
				this.arenaSelectedModels = selections;
				if (selections.length > 0) {
					new Notice(`Arena ready — ${selections.length} models. Type a prompt and send.`);
				}
			}
		);
		// Pre-select via the modal's internal API once it opens.
		modal.onOpenHook = () => {
			for (const sel of preselected) {
				modal.toggleFromOutside(`${sel.providerId}|${sel.modelId}`);
			}
		};
		modal.onCancel = () => {
			// User backed out — turn arena mode off and clear pre-fetched state.
			this.arenaMode = false;
			this.arenaSelectedModels = [];
			const btn = this.contentEl.querySelector('.ai-chat-arena-btn');
			if (btn instanceof HTMLElement) btn.removeClass('is-active');
		};
		modal.open();
	}

	/**
	 * Send `prompt` to every selected arena model in parallel. Each response
	 * streams into its own column inside a shared grid layout. A full-width
	 * user bubble precedes the grid.
	 */
	private async sendArenaMessage(prompt: string): Promise<void> {
		// Ensure a conversation exists so the user message can be persisted.
		if (!this.getConversationForView()) {
			this.startNewChat();
		}
		if (!this.conversationId) {
			new Notice('No conversation to send into — try again');
			return;
		}
		// Pin every store write below to THIS conversation (same pattern as
		// the normal send path).
		const convId = this.conversationId;

		// Context parity with a normal send: capture images + @-mention notes,
		// persist them on the user message, and clear the pending strips. The
		// compared answers must see the context the promoted model will see,
		// or the arena verdict doesn't predict post-promote behavior. The
		// user message deliberately carries no provider/model — it went to
		// every selected model, not the active one.
		const imagePaths = this.pendingImages.map((p) => p.path);
		const notePaths = this.pendingNoteAttachments.map((f) => f.path);
		this.currentSendHasImages = imagePaths.length > 0;
		this.suppressStoreEvents = true;
		this.store.addMessageTo(convId, {
			role: 'user',
			content: prompt,
			images: imagePaths.length > 0 ? imagePaths : undefined,
			attachedNotes: notePaths.length > 0 ? notePaths : undefined,
		});
		this.suppressStoreEvents = false;
		this.pendingImages = [];
		this.renderImageStrip();
		this.pendingNoteAttachments = [];
		this.renderAttachmentChips();
		this.renderCurrentConversation();

		this.isGenerating = true;
		this.setGeneratingUI(true);
		this.arenaAbortControllers.clear();
		this.arenaRoundMessages.clear();

		// System prompt = CORE + extension + memory + RAG — the same parts
		// buildMessagesArray assembles for a normal send (arena stays
		// single-shot: no prior conversation history rides along).
		const sysParts: string[] = [composeSystemPrompt(this.plugin.settings.systemPrompt)];
		if (this.plugin.settings.enableMemory) {
			const memBlock = this.plugin.memoryStore.formatFactsForPrompt();
			if (memBlock) sysParts.push(memBlock);
		}
		const ragBlock = await this.buildRetrievedContextBlock(this.store.getConversation(convId)!);
		if (ragBlock) sysParts.push(ragBlock);
		const messages: AIMessage[] = [{ role: 'system', content: sysParts.join('\n\n') }];

		// User turn = prompt + attached-note contents (invisible context) and,
		// when images are pending, multi-part image content — the same shape
		// the normal path builds for vision sends.
		const textWithNotes = await this.prependAttachedNotes(
			prompt,
			notePaths.length > 0 ? notePaths : undefined
		);
		if (imagePaths.length > 0) {
			const parts: MessageContent[] = [];
			if (textWithNotes) parts.push({ type: 'text', text: textWithNotes });
			for (const imgPath of imagePaths) {
				const dataUrl = await this.imagePathToDataUrl(imgPath);
				if (dataUrl) parts.push({ type: 'image_url', image_url: { url: dataUrl } });
			}
			messages.push({ role: 'user', content: parts.length > 0 ? parts : textWithNotes });
		} else {
			messages.push({ role: 'user', content: textWithNotes });
		}

		// Arena layout — user bubble is already rendered above; the grid sits
		// below it as the assistant's response surface.
		const arenaLayout = this.messagesContainer.createDiv({ cls: 'ai-arena-layout' });
		arenaLayout.style.setProperty('--arena-columns', String(this.arenaSelectedModels.length));

		const promises: Promise<ArenaColumnResult>[] = [];
		for (const sel of this.arenaSelectedModels) {
			const column = arenaLayout.createDiv({ cls: 'ai-arena-column' });
			const color = providerColor(sel.providerId);
			if (color) column.style.setProperty('--provider-color', color);

			const header = column.createDiv({ cls: 'ai-arena-column-header' });
			header.createDiv({ cls: 'ai-message-role-dot' });
			const headerText = header.createDiv({ cls: 'ai-arena-column-header-text' });
			headerText.createDiv({ cls: 'ai-arena-column-model', text: sel.modelName });
			headerText.createDiv({ cls: 'ai-arena-column-provider', text: sel.providerName });

			const responseEl = column.createDiv({ cls: 'ai-arena-column-response ai-message-thinking' });
			const footer = column.createDiv({ cls: 'ai-arena-column-footer' });
			const stopBtn = footer.createEl('button', { cls: 'ai-arena-stop-btn', text: 'Stop' });
			stopBtn.title = 'Stop this column';
			stopBtn.setAttribute('aria-label', `Stop ${sel.modelName}`);
			const promoteBtn = footer.createEl('button', {
				cls: 'ai-arena-promote-btn',
				text: 'Promote to chat',
			});
			promoteBtn.disabled = true;
			promoteBtn.addEventListener('click', () => {
				void this.promoteArenaColumn(sel, responseEl.dataset.content || '');
			});

			promises.push(
				this.streamArenaResponse(sel, convId, messages, responseEl, footer, stopBtn, promoteBtn)
			);
		}

		// All streams run parallel; resolve independently. allSettled so one
		// failure doesn't reject the batch.
		void Promise.all(
			promises.map((p): Promise<ArenaColumnResult> => p.then(
				(status) => status,
				(): ArenaColumnResult => ({ streamed: false, failed: true, aborted: false })
			))
		).then((results) => {
			this.isGenerating = false;
			this.setGeneratingUI(false);
			this.currentSendHasImages = false;
			this.arenaAbortControllers.clear();
			this.scrollToBottom();
			// One notification for the whole round (not per column). A column
			// the user manually stopped doesn't sink the round — any clean
			// finish still counts.
			if (!this.isChatVisible()) {
				const anyClean = results.some((r) => r.streamed && !r.failed && !r.aborted);
				const allFailed = results.length > 0 && results.every((r) => r.failed);
				const title = `Curtis — ${this.store.getConversation(convId)?.title || 'chat'}`;
				if (allFailed && this.plugin.settings.notifyOnError) {
					notifyResponse({ title, body: 'Arena round failed on every model — open the chat for details.', leaf: this.leaf });
				} else if (anyClean && this.plugin.settings.notifyOnCompletion) {
					const names = this.arenaSelectedModels.map((s) => s.modelName).join(' · ');
					notifyResponse({ title, body: `Arena round finished (${names}).`, leaf: this.leaf });
				}
			}
		});
	}

	/**
	 * Stream a single arena response into its column element. Captured text
	 * is stashed on `responseEl.dataset.content` for the promote-to-chat path.
	 */
	private async streamArenaResponse(
		sel: ArenaSelection,
		convId: string,
		messages: AIMessage[],
		responseEl: HTMLElement,
		footer: HTMLElement,
		stopBtn: HTMLButtonElement,
		promoteBtn: HTMLButtonElement
	): Promise<ArenaColumnResult> {
		const arenaKey = `${sel.providerId}:${sel.modelId}`;
		const abortController = new AbortController();
		this.arenaAbortControllers.set(arenaKey, abortController);
		// Per-column stop — aborts only this column; the sibling keeps streaming.
		stopBtn.addEventListener('click', () => abortController.abort());
		let streamed = '';
		let firstChunkReceived = false;
		let assistantStored = false;
		let errorSeen = false;
		let storedArenaMessageId: string | null = null;

		try {
			await this.plugin.callAI(messages, sel.modelId, {
				providerId: sel.providerId,
				signal: abortController.signal,
				onChunk: (chunk: string) => {
					if (!firstChunkReceived) {
						firstChunkReceived = true;
						responseEl.removeClass('ai-message-thinking');
						responseEl.addClass('ai-message-streaming');
					}
					streamed += chunk;
					responseEl.dataset.content = streamed;
					this.renderer.renderStreamedMessage(responseEl, streamed);
					this.scrollToBottom();
				},
				onUsage: (usage: TokenUsage) => {
					const usageEl = footer.querySelector('.ai-arena-column-usage');
					if (usageEl instanceof HTMLElement) {
						usageEl.setText(`${usage.totalTokens} tok`);
					} else {
						footer.createDiv({
							cls: 'ai-arena-column-usage',
							text: `${usage.totalTokens} tok`,
						});
					}
					// Persist a separate assistant message per column so the
					// user can still see all answers after exiting arena without
					// promoting. Promote later deletes the losing column's
					// message; provider/model on each record shows which model
					// produced which answer.
					if (!assistantStored) {
						const stored = this.store.addMessageTo(convId, {
							role: 'assistant',
							content: streamed,
							tokens: usage,
							cost: this.estimateMessageCost(sel.providerId, sel.modelId, usage) ?? undefined,
							provider: sel.providerId,
							model: sel.modelId,
						});
						if (stored) {
							storedArenaMessageId = stored.id;
							this.arenaRoundMessages.set(arenaKey, stored.id);
							assistantStored = true;
						}
					}
				},
				onError: (error: Error) => {
					errorSeen = true;
					console.error(`[Curtis] Arena stream error (${sel.providerName}/${sel.modelName}):`, error);
					const friendly = friendlyError(error, this.currentSendHasImages);
					responseEl.createDiv({
						cls: 'ai-arena-column-error',
						text: `⚠️ ${friendly.message}`,
					});
				},
			});
			// Persist even when no usage callback fired (some providers omit
			// token counts on stream completion). Runs only on a clean finish —
			// an abort skips it, matching the normal path's no-usage store.
			if (streamed && !assistantStored) {
				const stored = this.store.addMessageTo(convId, {
					role: 'assistant',
					content: streamed,
					provider: sel.providerId,
					model: sel.modelId,
				});
				if (stored) {
					storedArenaMessageId = stored.id;
					this.arenaRoundMessages.set(arenaKey, stored.id);
					assistantStored = true;
				}
			}
		} catch (e) {
			if ((e as Error).name !== 'AbortError') {
				errorSeen = true;
				console.error(`[Curtis] Arena call failed (${sel.providerName}/${sel.modelName}):`, e);
				responseEl.createDiv({
					cls: 'ai-arena-column-error',
					text: `⚠️ ${(e as Error).message || 'Request failed'}`,
				});
			}
		} finally {
			responseEl.removeClass('ai-message-streaming');
			responseEl.removeClass('ai-message-thinking');
			stopBtn.remove();
			// Final markdown render even for an aborted column so partial text
			// keeps its formatting, and promote becomes available for whatever
			// streamed (mirrors the normal path's finally).
			if (streamed) {
				this.renderer.renderStreamedMessage(responseEl, streamed, true);
				promoteBtn.disabled = false;
				// Sync the full text in case usage fired before the final chunk
				// and the persisted snapshot is stale (mirrors the normal path).
				if (storedArenaMessageId) {
					this.store.updateMessage(storedArenaMessageId, { content: streamed }, convId);
				}
			}
			// Release the controller so the Map doesn't accumulate stale entries
			// across arena rounds (one leaked controller per column per send).
			this.arenaAbortControllers.delete(arenaKey);
		}
		return {
			streamed: streamed.length > 0,
			failed: errorSeen,
			aborted: abortController.signal.aborted,
		};
	}

	/**
	 * Promote a single column's response into the main chat: exit arena mode,
	 * keep the promoted answer as the assistant message, and continue with
	 * that provider/model. The losing column is aborted and its stored answer
	 * deleted — the continued thread carries the winner only ("carried into a
	 * normal single-model conversation").
	 */
	private async promoteArenaColumn(sel: ArenaSelection, content: string): Promise<void> {
		if (!content) return;
		const winnerKey = `${sel.providerId}:${sel.modelId}`;
		for (const [key, controller] of this.arenaAbortControllers) {
			if (key !== winnerKey) controller.abort();
		}
		for (const [key, messageId] of this.arenaRoundMessages) {
			if (key !== winnerKey && messageId) {
				this.store.deleteMessage(messageId, this.conversationId ?? undefined);
			}
		}
		this.arenaRoundMessages.clear();
		// Exit arena mode but keep the just-promoted message in history.
		this.arenaMode = false;
		this.arenaSelectedModels = [];
		const btn = this.contentEl.querySelector('.ai-chat-arena-btn');
		if (btn instanceof HTMLElement) btn.removeClass('is-active');
		// Switch this pane's provider/model to the promoted column's so the
		// next message continues with the same model the user just picked.
		this.setActiveModel(sel.providerId, sel.modelId);
		// The live arena grid is now dead DOM (loser deleted, mode off) —
		// re-render closes it and shows the clean user + winner thread.
		this.renderCurrentConversation();
		new Notice(`Continuing with ${sel.modelName}`);
	}

	/** Abort every in-flight arena stream. */
	private abortArena(): void {
		for (const controller of this.arenaAbortControllers.values()) {
			controller.abort();
		}
	}

	private showHistoryDropdown(anchor: HTMLElement): void {
		// Block switching while a stream is in-flight — otherwise the in-flight
		// onChunk/onUsage callbacks would write into the new conversation's
		// DOM/store and corrupt it.
		if (this.isGenerating || this.arenaAbortControllers.size > 0) {
			new Notice('Stop the current response before switching conversations');
			return;
		}

		// Remove existing dropdown
		const existing = this.containerEl.querySelector('.ai-history-dropdown');
		if (existing) {
			existing.remove();
			return;
		}

		const conversations = this.store.getAllConversations();
		if (conversations.length === 0) {
			new Notice('No conversation history');
			return;
		}

		const currentId = this.conversationId;
		const dropdown = this.containerEl.createDiv({ cls: 'ai-history-dropdown' });

		// Close on outside click. handler + closeDropdown form one close path —
		// item click, delete, and outside click all funnel through it so the
		// document listener never outlives the dropdown. The listener attaches
		// to THIS pane's document so clicks in a popout close it too.
		const doc = this.containerEl.ownerDocument;
		const handler = (e: MouseEvent) => {
			if (!dropdown.contains(e.target as Node) && e.target !== anchor) {
				closeDropdown();
			}
		};
		const closeDropdown = (): void => {
			dropdown.remove();
			doc.removeEventListener('click', handler);
		};

		for (const conv of conversations) {
			const item = dropdown.createDiv({ cls: 'ai-history-item' });
			if (conv.id === currentId) item.addClass('is-active');
			item.createDiv({ cls: 'ai-history-title', text: conv.title });
			item.createDiv({
				cls: 'ai-history-meta',
				text: `${conv.messages.length} msgs · ${new Date(conv.updatedAt).toLocaleDateString()}`,
			});

			// Delete moves the conversation's vault file to the trash
			// (recoverable). Deleting the current chat starts a fresh one.
			const deleteBtn = item.createEl('button', { cls: 'ai-history-delete-btn' });
			setIcon(deleteBtn, 'trash-2');
			deleteBtn.title = 'Delete conversation';
			deleteBtn.setAttribute('aria-label', `Delete ${conv.title}`);
			deleteBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				// Suppress the conversation:changed rebind for this pane — the
				// explicit handling right below decides what we show next.
				this.suppressStoreEvents = true;
				try {
					this.store.deleteConversation(conv.id);
					if (conv.id === currentId) this.startNewChat();
				} finally {
					this.suppressStoreEvents = false;
				}
				new Notice('Deleted');
				closeDropdown();
			});

			item.addEventListener('click', () => {
				this.switchConversation(conv.id);
				closeDropdown();
			});
		}

		// Position below anchor
		const rect = anchor.getBoundingClientRect();
		const containerRect = this.containerEl.getBoundingClientRect();
		dropdown.setCssProps({ top: `${rect.bottom - containerRect.top + 4}px` });
		window.setTimeout(() => doc.addEventListener('click', handler), 10);
	}
}
