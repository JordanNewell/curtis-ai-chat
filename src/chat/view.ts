// Sidebar Chat View — persistent ItemView for AI chat

import { ItemView, Notice, WorkspaceLeaf, setIcon, TFile } from 'obsidian';
import type { Conversation, ConversationMessage, AIMessage, MessageContent, TokenUsage } from '../types';
import { MessageRenderer } from './message-renderer';
import { ConversationStore } from './conversation-store';
import { ModelPickerModal, buildModelPickerEntries } from '../ui/modals/model-picker-modal';
import { attachMessageActions } from './message-actions';
import { handleSlashCommand, slashSuggestions, type SlashContext } from './slash-commands';
import { saveMessageAsNote, saveImageToVault } from '../vault/notes';
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
	const bytes = new Uint8Array(buf);
	let binary = '';
	const chunk = 0x8000; // Avoid call-stack limits on large arrays.
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
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
function friendlyError(error: Error, hasImages = false): { message: string; cause?: string } {
	const msg = (error.message || '').toLowerCase();

	if (/(image|vision|multimodal|unsupported.*media)/.test(msg) && hasImages) {
		return {
			message: `This model rejected the image. Switch to a vision-capable model via the picker (look for the 👁 icon), or remove the image and resend.`,
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

// Tracks whether the most recent send included images — passed into
// friendlyError so it can disambiguate image-rejection errors.
let currentSendHasImagesFlag = false;

export class ChatView extends ItemView {
	plugin: CurtisPlugin;
	private renderer: MessageRenderer;
	private store: ConversationStore;
	private messagesContainer!: HTMLElement;
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
	/** Pending image attachments for the next user message.
	 *  `path` is the vault-internal file path (real TFile); `thumbUrl` is a
	 *  resource URL good for the lifetime of the view (used for thumbnails). */
	private pendingImages: Array<{ path: string; thumbUrl: string; name: string }> = [];
	/** Thumbnail strip above the input. */
	private imageStrip!: HTMLElement;
	/** Paperclip button — opens OS file picker or accepts drops. */
	private attachBtn!: HTMLButtonElement;

	startNewChat(): void {
		const provider = this.plugin.providerRegistry.getActiveProvider(this.plugin.settings.activeProvider);
		this.store.createConversation(
			provider?.id || this.plugin.settings.activeProvider,
			this.plugin.settings.activeModel
		);
		this.pendingImages = [];
		this.renderImageStrip();
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
		return 'AI Chat';
	}

	getIcon(): string {
		return 'bot';
	}

	async onOpen(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass('ai-chat-view');

		// Persistent background layer — wallpaper only. Sits behind the message
		// list (z-index 0). Empty-state copy is rendered separately by
		// renderEmptyState inside messagesContainer.
		this.renderBackground(container);

		await this.renderHeader(container);
		this.renderMessagesContainer(container);
		await this.renderInputArea(container);

		this.renderCurrentConversation();
	}

	private async renderHeader(container: HTMLElement): Promise<void> {
		const header = container.createDiv({ cls: 'ai-chat-header' });

		// New chat — icon button
		const newChatBtn = header.createEl('button', { cls: 'ai-chat-icon-btn' });
		setIcon(newChatBtn, 'plus');
		newChatBtn.title = 'New chat';
		newChatBtn.setAttribute('aria-label', 'New chat');
		newChatBtn.addEventListener('click', () => this.startNewChat());

		// Model picker button — always routes through the modal so we get
		// capability pills and consistent UX regardless of model count.
		const pickerBtn = header.createEl('button', { cls: 'ai-model-picker-btn' });
		this.updateModelPickerButton(pickerBtn);
		pickerBtn.addEventListener('click', () => this.openModelPicker(pickerBtn));

		// History — icon button
		const historyBtn = header.createEl('button', { cls: 'ai-chat-icon-btn' });
		setIcon(historyBtn, 'history');
		historyBtn.title = 'Conversation history';
		historyBtn.setAttribute('aria-label', 'Conversation history');
		historyBtn.addEventListener('click', () => this.showHistoryDropdown(historyBtn));
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
		if (this.plugin.settings.enterKeyBehavior === 'newline') {
			this.inputHintEl.innerHTML =
				'<kbd>Ctrl</kbd>+<kbd>Enter</kbd> send · <kbd>Enter</kbd> newline · <kbd>/</kbd> commands';
		} else {
			this.inputHintEl.innerHTML =
				'<kbd>Enter</kbd> send · <kbd>Shift+Enter</kbd> newline · <kbd>/</kbd> commands';
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
				layer.style.backgroundImage = `url("${url}")`;
				layer.addClass('has-wallpaper');
			} else {
				layer.style.backgroundImage = '';
				layer.removeClass('has-wallpaper');
			}
		} else {
			layer.style.backgroundImage = '';
			layer.removeClass('has-wallpaper');
		}
		// No persistent watermark — the brand orb is rendered inside the
		// empty-state block (renderEmptyState) so it appears on new chat and
		// disappears when the first message arrives.
	}

	private async renderInputArea(container: HTMLElement): Promise<void> {
		const inputArea = container.createDiv({ cls: 'ai-chat-input-area' });

		// Pending image thumbnails (hidden until first attach).
		this.imageStrip = inputArea.createDiv({ cls: 'ai-chat-image-strip' });
		this.imageStrip.style.display = 'none';

		// Input card + send button live as siblings in a flex row. The send
		// button is OUTSIDE the textarea's focus halo so it never looks
		// "boxed in" when the field is focused — same pattern as ChatGPT and
		// Claude. The Stop button replaces Send in-place while streaming.
		const row = inputArea.createDiv({ cls: 'ai-chat-input-row' });

		// Paperclip attaches images (file picker). Lives at the left of the row,
		// outside the textarea halo, mirroring the send button on the right.
		// The hidden <input> is a SIBLING of the button — putting it inside the
		// button causes the picker to open-then-close because the synthesized
		// input click bubbles back up to the button handler.
		const attachCol = row.createDiv({ cls: 'ai-chat-attach-col' });
		const fileInput = attachCol.createEl('input', {
			cls: 'ai-chat-file-input',
			type: 'file',
			attr: { accept: 'image/*', multiple: 'multiple' },
		});
		fileInput.style.display = 'none';
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
		});
		// Paste image straight from clipboard (Ctrl+V) — standard chat UX.
		this.inputEl.addEventListener('paste', (e) => this.handlePaste(e));

		// Drag-and-drop images anywhere on the input area.
		this.setupDragDrop(inputArea);

		const sendCol = row.createDiv({ cls: 'ai-chat-send-col' });
		this.sendBtn = sendCol.createEl('button', { cls: 'ai-chat-send-btn' });
		setIcon(this.sendBtn, 'arrow-up');
		this.sendBtn.title = 'Send';
		this.sendBtn.setAttribute('aria-label', 'Send');
		this.sendBtn.addEventListener('click', () => this.sendMessage());

		this.abortBtn = sendCol.createEl('button', { cls: 'ai-chat-abort-btn' });
		setIcon(this.abortBtn, 'square');
		this.abortBtn.title = 'Stop generating';
		this.abortBtn.setAttribute('aria-label', 'Stop generating');
		this.abortBtn.style.display = 'none';
		this.abortBtn.addEventListener('click', () => this.abortGeneration());

		const btnRow = inputArea.createDiv({ cls: 'ai-chat-btn-row' });
		this.inputHintEl = btnRow.createDiv({ cls: 'ai-chat-input-hint' });
		this.refreshInputHint();
	}

	async onClose(): Promise<void> {
		this.renderer.cleanup();
	}

	// --- Model picker -----------------------------------------------------

	private openModelPicker(_anchor: HTMLElement): void {
		const entries = buildModelPickerEntries(
			this.plugin.providerRegistry.getAllEnabledProviders()
		);
		const activeKey = `${this.plugin.settings.activeProvider}|${this.plugin.settings.activeModel}`;
		new ModelPickerModal(this.app, entries, activeKey, (providerId, modelId) => {
			this.plugin.settings.activeProvider = providerId;
			this.plugin.settings.activeModel = modelId;
			this.plugin.saveSettings();
			// Re-render header to reflect new model name on the button.
			const btn = this.contentEl.querySelector('.ai-model-picker-btn');
			if (btn instanceof HTMLElement) this.updateModelPickerButton(btn);
		}).open();
	}

	private updateModelPickerButton(btn: HTMLElement): void {
		btn.empty();
		const provider = this.plugin.providerRegistry.getProvider(this.plugin.settings.activeProvider);
		const model = provider?.models.find((m) => m.id === this.plugin.settings.activeModel);
		const modelName = model?.name || this.plugin.settings.activeModel || 'Pick model';
		const providerName = provider?.name || this.plugin.settings.activeProvider;
		const color = providerColor(this.plugin.settings.activeProvider);
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
		// Slash menu: ArrowUp/Down/Enter/Tab/Escape when visible
		if (this.slashMenu && this.slashMenu.style.display !== 'none') {
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
				this.sendMessage();
			}
		} else {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				this.sendMessage();
			}
		}
	}

	private autoResizeInput(): void {
		this.inputEl.style.height = 'auto';
		this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 320) + 'px';
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
		this.slashMenu!.style.display = '';
	}

	private ensureSlashMenu(): void {
		if (this.slashMenu) return;
		const inputArea = this.contentEl.querySelector('.ai-chat-input-area');
		if (!inputArea) return;
		this.slashMenu = (inputArea as HTMLElement).createDiv({ cls: 'ai-slash-menu' });
		this.slashMenu.style.display = 'none';
	}

	private hideSlashMenu(): void {
		if (this.slashMenu) this.slashMenu.style.display = 'none';
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

	// --- Messages ---------------------------------------------------------

	private renderCurrentConversation(): void {
		this.messagesContainer.empty();
		const conv = this.store.getCurrentConversation();
		if (!conv || conv.messages.length === 0) {
			this.renderEmptyState();
			return;
		}

		for (const msg of conv.messages) {
			this.appendMessageToDOM(msg);
		}
		this.scrollToBottom();
	}

	private renderEmptyState(): void {
		// Full hero orb (only shown when chat has no messages). Disappears the
		// moment the first message is added. Wallpaper (if enabled) shows behind.
		const empty = this.messagesContainer.createDiv({ cls: 'ai-chat-empty' });
		const iconWrap = empty.createDiv({ cls: 'ai-chat-empty-icon' });
		setIcon(iconWrap, 'bot');
		empty.createDiv({ cls: 'ai-chat-empty-title', text: 'Curtis' });
		empty.createDiv({ cls: 'ai-chat-empty-hint', text: 'Ask anything — type a message below to begin.' });
	}

	private appendMessageToDOM(msg: ConversationMessage): HTMLElement {
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
		} else {
			this.renderer.renderMessage(contentEl, msg.content);
			// Attach hover actions on rendered assistant messages.
			attachMessageActions({
				app: this.app,
				wrapper,
				message: msg,
				saveFolder: this.plugin.settings.noteSaveFolder,
				callbacks: {
					onRegenerate: (m) => this.regenerateMessage(m.id),
					onEditResend: (m) => this.editResendForAssistant(m.id),
					onQuoteIntoInput: (m) => this.quoteMessageIntoInput(m),
				},
			});
		}

		return wrapper;
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

	// --- Image attachments ------------------------------------------------

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
			const imgs = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
			if (imgs.length > 0) void this.addImageFiles(imgs);
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
		const provider = this.plugin.providerRegistry.getProvider(this.plugin.settings.activeProvider);
		const model = provider?.models.find((m) => m.id === this.plugin.settings.activeModel);
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
			this.imageStrip.style.display = 'none';
			return;
		}
		this.imageStrip.style.display = '';
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

		// Slash command interception — consumed commands suppress the send.
		if (trimmed.startsWith('/')) {
			const consumed = await handleSlashCommand(trimmed, this.slashContext());
			if (consumed) {
				this.inputEl.value = '';
				this.autoResizeInput();
				return;
			}
			// Unknown slash command falls through and gets sent literally.
		}

		// Ensure we have an active conversation
		if (!this.store.getCurrentConversation()) {
			this.startNewChat();
		}

		let provider;
		try {
			provider = this.plugin.getAuthenticatedProvider();
		} catch {
			new Notice('No AI provider configured or authenticated. Check settings.');
			return;
		}

		// Add user message — capture any pending image attachments (vault paths).
		const imagePaths = this.pendingImages.map((p) => p.path);
		this.store.addMessage({
			role: 'user',
			content: trimmed,
			provider: provider.id,
			model: this.plugin.settings.activeModel,
			images: imagePaths.length > 0 ? imagePaths : undefined,
		});
		// Track for error-reporting (so we can suggest vision model if it fails).
		currentSendHasImagesFlag = imagePaths.length > 0;
		// Clear the pending strip — images are now persisted on the message.
		this.pendingImages = [];
		this.renderImageStrip();
		this.inputEl.value = '';
		this.autoResizeInput();

		// Re-render to show user message
		this.renderCurrentConversation();

		// Show generating state
		this.isGenerating = true;
		this.sendBtn.style.display = 'none';
		this.abortBtn.style.display = '';
		this.streamingContent = '';

		// Create assistant message placeholder with role label + "Thinking…" state
		const conv = this.store.getCurrentConversation()!;
		const assistantWrapper = this.messagesContainer.createDiv({
			cls: 'ai-message ai-message-assistant ai-message-thinking',
		});

		const modelLabel = (() => {
			const p = this.plugin.providerRegistry.getProvider(provider.id);
			const m = p?.models.find((x) => x.id === this.plugin.settings.activeModel);
			return m?.name || this.plugin.settings.activeModel || 'Assistant';
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

		try {
			// Build messages array from conversation history
			const aiMessages: AIMessage[] = await this.buildMessagesArray(conv);

			await this.plugin.callAI(aiMessages, this.plugin.settings.activeModel, {
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
						const stored = this.store.addMessage({
							role: 'assistant',
							content: this.streamingContent,
							tokens: usage,
							provider: provider.id,
							model: this.plugin.settings.activeModel,
						});
						storedMessageId = stored.id;
						assistantStored = true;
					}
					// Update token count in the meta row
					const info = assistantWrapper.querySelector('.ai-message-info');
					if (info instanceof HTMLElement) {
						info.setText(`${usage.totalTokens} tok`);
					} else {
						meta.createDiv({ cls: 'ai-message-info', text: `${usage.totalTokens} tok` });
					}
				},
				onError: (error: Error) => {
					console.error('[Curtis] Stream error:', error);
					const friendly = friendlyError(error, currentSendHasImagesFlag);
					new Notice(friendly.message, 8000);
					this.streamingContent += `\n\n*⚠️ ${friendly.message}*`;
					this.renderer.renderStreamedMessage(assistantContent, this.streamingContent);
				},
				signal: this.abortController.signal,
			});

			// If no usage callback fired, store the message without token counts
			if (!assistantStored && this.streamingContent) {
				const stored = this.store.addMessage({
					role: 'assistant',
					content: this.streamingContent,
					provider: provider.id,
					model: this.plugin.settings.activeModel,
				});
				storedMessageId = stored.id;
				assistantStored = true;
			}
		} catch (e) {
			if ((e as Error).name !== 'AbortError') {
				console.error('[Curtis] AI call failed:', e);
				new Notice('AI request failed. Check console for details.');
			}
		} finally {
			this.isGenerating = false;
			this.sendBtn.style.display = '';
			this.abortBtn.style.display = 'none';
			this.abortController = null;
			assistantWrapper.removeClass('ai-message-streaming');
			assistantWrapper.removeClass('ai-message-thinking');
			// Final markdown render — replaces the streaming plain-text preview
			// with a fully-parsed markdown view (code blocks, links, etc.).
			this.renderer.renderStreamedMessage(assistantContent, this.streamingContent, true);
			this.scrollToBottom();

			// Attach hover-visible actions now that the message is final.
			if (storedMessageId && this.streamingContent) {
				// Sync final content into the stored message in case usage fired
				// early (before the final chunk) and the snapshot is stale.
				this.store.updateMessage(storedMessageId, { content: this.streamingContent });
				const stored = this.store.getCurrentConversation()?.messages.find((m) => m.id === storedMessageId);
				if (stored) {
					attachMessageActions({
						app: this.app,
						wrapper: assistantWrapper,
						message: stored,
						saveFolder: this.plugin.settings.noteSaveFolder,
						callbacks: {
							onRegenerate: (m) => this.regenerateMessage(m.id),
							onEditResend: (m) => this.editResendForAssistant(m.id),
							onQuoteIntoInput: (m) => this.quoteMessageIntoInput(m),
						},
					});
					// Auto-save (silent) if the user opted in.
					if (this.plugin.settings.autoSaveAssistantResponses) {
						const folder = this.plugin.settings.autoSaveFolder || this.plugin.settings.noteSaveFolder;
						void saveMessageAsNote(this.app, stored, folder).catch((e) =>
							console.error('[Curtis] auto-save failed:', e)
						);
					}
				}
			}
			// Background fact extraction — fire-and-forget.
			// Reset image-flag + extract facts.
			currentSendHasImagesFlag = false;
			this.maybeExtractFacts();
		}
	}

	/** Pull the last user/assistant pair and hand to the plugin for extraction. */
	private maybeExtractFacts(): void {
		const conv = this.store.getCurrentConversation();
		if (!conv) return;
		const msgs = conv.messages;
		const assistant = msgs.at(-1);
		if (!assistant || assistant.role !== 'assistant') return;
		let userIdx = msgs.length - 2;
		while (userIdx >= 0 && msgs[userIdx].role !== 'user') userIdx--;
		if (userIdx < 0) return;
		const userMsg = msgs[userIdx];
		void this.plugin.extractAndStoreFacts(userMsg.content, assistant.content).catch((e) =>
			console.debug('[Curtis] fact extraction failed:', e)
		);
	}

	private abortGeneration(): void {
		if (this.abortController) {
			this.abortController.abort();
		}
	}

	private async buildMessagesArray(conv: Conversation): Promise<AIMessage[]> {
		const messages: AIMessage[] = [];

		// System prompt + memory block.
		const sysParts: string[] = [];
		if (this.plugin.settings.systemPrompt) {
			sysParts.push(this.plugin.settings.systemPrompt);
		}
		if (sysParts.length > 0) {
			// Append memory block (if enabled + facts exist) to the system prompt.
			if (this.plugin.settings.enableMemory) {
				const memBlock = this.plugin.memoryStore.formatFactsForPrompt();
				if (memBlock) sysParts.push(memBlock);
			}
			messages.push({ role: 'system', content: sysParts.join('\n\n') });
		} else if (this.plugin.settings.enableMemory) {
			// No base system prompt but memory enabled — inject as a standalone system msg.
			const memBlock = this.plugin.memoryStore.formatFactsForPrompt();
			if (memBlock) messages.push({ role: 'system', content: memBlock });
		}

		// Conversation history — user messages with attached images become
		// multi-part content (text + image_url). Image paths are read from the
		// vault at send time and converted to base64 data URLs.
		for (const msg of conv.messages) {
			if (msg.role === 'user' && msg.images && msg.images.length > 0) {
				const parts: MessageContent[] = [];
				if (msg.content) parts.push({ type: 'text', text: msg.content });
				for (const imgPath of msg.images) {
					const dataUrl = await this.imagePathToDataUrl(imgPath);
					if (dataUrl) {
						parts.push({ type: 'image_url', image_url: { url: dataUrl } });
					}
				}
				messages.push({ role: 'user', content: parts.length > 0 ? parts : msg.content });
			} else {
				messages.push({ role: msg.role, content: msg.content });
			}
		}

		return messages;
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
		const conv = this.store.getCurrentConversation();
		if (!conv) return;

		const idx = conv.messages.findIndex((m) => m.id === assistantMessageId);
		if (idx === -1) {
			new Notice('Message not found');
			return;
		}

		// Truncate the conversation so the last message is the user prompt
		// immediately preceding this assistant message.
		conv.messages = conv.messages.slice(0, idx);
		conv.updatedAt = Date.now();
		this.store.save();
		this.renderCurrentConversation();

		// Trigger a no-op "user" send path: we re-use sendMessage's body by
		// synthesizing an empty user input — but that path early-returns on empty.
		// Instead, inline the assistant-stream logic by calling a dedicated helper.
		await this.streamAssistantResponse();
	}

	/**
	 * Load the user message preceding the given assistant message into the
	 * input box for editing; on next Send the truncateAfterMessage hook (fired
	 * when the user message matches) will drop the old branch.
	 */
	private editResendForAssistant(assistantMessageId: string): void {
		const conv = this.store.getCurrentConversation();
		if (!conv) return;
		const idx = conv.messages.findIndex((m) => m.id === assistantMessageId);
		if (idx <= 0) {
			new Notice('No prior user message to edit');
			return;
		}
		// Find the immediately-preceding user message.
		let userIdx = idx - 1;
		while (userIdx >= 0 && conv.messages[userIdx].role !== 'user') userIdx--;
		if (userIdx < 0) {
			new Notice('No prior user message to edit');
			return;
		}
		const userMsg = conv.messages[userIdx];
		// Truncate everything AFTER the user message — the old assistant reply
		// goes away; the next send replaces the user message text.
		this.store.truncateAfterMessage(userMsg.id);
		// Also remove the user message itself so the new send isn't duplicated.
		this.store.deleteMessage(userMsg.id);
		this.renderCurrentConversation();
		this.inputEl.value = userMsg.content;
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
		const conv = this.store.getCurrentConversation();
		if (!conv) return;

		// Set the image flag based on the last user message (it may have
		// attached images that an error would blame).
		const lastUser = this.store.getLastUserMessage();
		currentSendHasImagesFlag = !!(lastUser?.images && lastUser.images.length > 0);

		this.isGenerating = true;
		this.sendBtn.style.display = 'none';
		this.abortBtn.style.display = '';
		this.streamingContent = '';

		const assistantWrapper = this.messagesContainer.createDiv({
			cls: 'ai-message ai-message-assistant ai-message-thinking',
		});
		const modelLabel = (() => {
			const p = this.plugin.providerRegistry.getProvider(provider.id);
			const m = p?.models.find((x) => x.id === this.plugin.settings.activeModel);
			return m?.name || this.plugin.settings.activeModel || 'Assistant';
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

		try {
			const aiMessages = await this.buildMessagesArray(conv);
			await this.plugin.callAI(aiMessages, this.plugin.settings.activeModel, {
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
						const stored = this.store.addMessage({
							role: 'assistant',
							content: this.streamingContent,
							tokens: usage,
							provider: provider.id,
							model: this.plugin.settings.activeModel,
						});
						storedMessageId = stored.id;
						assistantStored = true;
					}
				},
				onError: (error: Error) => {
					console.error('[Curtis] Stream error:', error);
					const friendly = friendlyError(error, currentSendHasImagesFlag);
					new Notice(friendly.message, 8000);
					this.streamingContent += `\n\n*⚠️ ${friendly.message}*`;
					this.renderer.renderStreamedMessage(assistantContent, this.streamingContent);
				},
				signal: this.abortController.signal,
			});
			if (!assistantStored && this.streamingContent) {
				const stored = this.store.addMessage({
					role: 'assistant',
					content: this.streamingContent,
					provider: provider.id,
					model: this.plugin.settings.activeModel,
				});
				storedMessageId = stored.id;
				assistantStored = true;
			}
		} catch (e) {
			if ((e as Error).name !== 'AbortError') {
				console.error('[Curtis] Regenerate failed:', e);
				new Notice('Regenerate failed');
			}
		} finally {
			this.isGenerating = false;
			this.sendBtn.style.display = '';
			this.abortBtn.style.display = 'none';
			this.abortController = null;
			assistantWrapper.removeClass('ai-message-streaming');
			assistantWrapper.removeClass('ai-message-thinking');
			this.renderer.renderStreamedMessage(assistantContent, this.streamingContent, true);
			this.scrollToBottom();
			if (storedMessageId && this.streamingContent) {
				// Sync final content into the stored message in case usage fired
				// early (before the final chunk) and the snapshot is stale.
				this.store.updateMessage(storedMessageId, { content: this.streamingContent });
				const stored = this.store.getCurrentConversation()?.messages.find((m) => m.id === storedMessageId);
				if (stored) {
					attachMessageActions({
						app: this.app,
						wrapper: assistantWrapper,
						message: stored,
						saveFolder: this.plugin.settings.noteSaveFolder,
						callbacks: {
							onRegenerate: (m) => this.regenerateMessage(m.id),
							onEditResend: (m) => this.editResendForAssistant(m.id),
							onQuoteIntoInput: (m) => this.quoteMessageIntoInput(m),
						},
					});
					if (this.plugin.settings.autoSaveAssistantResponses) {
						const folder = this.plugin.settings.autoSaveFolder || this.plugin.settings.noteSaveFolder;
						void saveMessageAsNote(this.app, stored, folder).catch((e) =>
							console.error('[Curtis] auto-save failed:', e)
						);
					}
				}
			}
			// Background fact extraction — fire-and-forget.
			// Reset image-flag + extract facts.
			currentSendHasImagesFlag = false;
			this.maybeExtractFacts();
		}
	}

	/** Build the SlashContext passed into slash-command handlers. */
	private slashContext(): SlashContext {
		return {
			plugin: this.plugin,
			app: this.app,
			raw: this.inputEl.value,
			args: '',
			setInput: (text) => {
				this.inputEl.value = text;
				this.autoResizeInput();
			},
			focusInput: () => this.inputEl.focus(),
			regenerate: () => {
				const last = this.store.getLastAssistantMessage();
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
		requestAnimationFrame(() => {
			this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
		});
	}

	private showHistoryDropdown(anchor: HTMLElement): void {
		// Block switching while a stream is in-flight — otherwise the in-flight
		// onChunk/onUsage callbacks would write into the new conversation's
		// DOM/store and corrupt it.
		if (this.isGenerating) {
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

		const currentId = this.store.getCurrentConversation()?.id;
		const dropdown = this.containerEl.createDiv({ cls: 'ai-history-dropdown' });

		for (const conv of conversations) {
			const item = dropdown.createDiv({ cls: 'ai-history-item' });
			if (conv.id === currentId) item.addClass('is-active');
			item.createDiv({ cls: 'ai-history-title', text: conv.title });
			item.createDiv({
				cls: 'ai-history-meta',
				text: `${conv.messages.length} msgs · ${new Date(conv.updatedAt).toLocaleDateString()}`,
			});

			item.addEventListener('click', () => {
				this.store.setCurrentConversation(conv.id);
				this.renderCurrentConversation();
				dropdown.remove();
			});
		}

		// Position below anchor
		const rect = anchor.getBoundingClientRect();
		const containerRect = this.containerEl.getBoundingClientRect();
		dropdown.style.position = 'absolute';
		dropdown.style.top = `${rect.bottom - containerRect.top + 4}px`;
		dropdown.style.right = '8px';

		// Close on outside click
		const handler = (e: MouseEvent) => {
			if (!dropdown.contains(e.target as Node) && e.target !== anchor) {
				dropdown.remove();
				document.removeEventListener('click', handler);
			}
		};
		setTimeout(() => document.addEventListener('click', handler), 10);
	}
}
