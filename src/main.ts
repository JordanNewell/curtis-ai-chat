// Curtis — Main Plugin Entry Point

import { Editor, Notice, Platform, Plugin, addIcon, requestUrl, TFile, debounce } from 'obsidian';
import { CURTIS_ICON_ID, CURTIS_ICON_SVG } from './icons';
import type { CurtisSettings, AIMessage, TokenUsage, AIProvider, AIRequestOptions, ToolCall, ToolDefinition, MemoryProposal } from './types';
import { DEFAULT_SETTINGS, CurtisSettingTab } from './settings';
import { ProviderRegistry, getReasoningWire } from './providers/registry';
import { ChatGPTTokenManager, signInWithChatGPT } from './providers/chatgpt-signin';
import type { ChatGPTTokens } from './providers/chatgpt';
import { ChatGPTProvider } from './providers/chatgpt';
import { chatStream, flattenHeaders } from './providers/transport';
import { EventBus } from './core/events';
import { ToolRegistry } from './core/tools';
import { McpManager } from './mcp/manager';
import { McpServerManager } from './mcp/server/manager';
import { GcpManager } from './gcp/manager';
import { createPublicApi } from './api/public-api';
import type { CurtisPublicApi } from './api/public-api';
import { SchedulerService } from './scheduler/service';
import { RagIndexManager } from './rag';
import { runMigrations } from './core/migration';
import type { SettingsData } from './core/migration';
import { migrateSecretsToKeychain, resolveApiKey, resolveGcpServiceAccount } from './core/secrets';
import { MemoryStore } from './memory';
import { ConversationStore } from './chat/conversation-store';
import { VaultConversationFiles, vaultYamlPort } from './chat/conversation-files';
import { SwarmManager, SWARM_TOOL_NAME } from './swarm';
import { AgentManager } from './agents';
import type { ResolvedAgent } from './agents';
import { ChatSearchModal } from './ui/modals/chat-search-modal';
import { DiffRewriteModal } from './ui/modals/diff-rewrite-modal';
import { CHAT_VIEW_TYPE, ChatView } from './chat/view';
import { CURT_VIEW_TYPE, CurtImportView } from './import/curt-import-view';
import { TERMINAL_VIEW_TYPE, TerminalView } from './terminal/view';
import { RUN_COMMAND_TOOL } from './core/command-tools';
import { confirmCommandRun } from './ui/modals/run-command-confirm-modal';
import { importChats, reportResult } from './import/importer';
import { registerCommands } from './commands';
import { registerContextMenu } from './commands/context-menu';
import { SELECTION_ACTIONS, customToSelectionAction, translateUserPrompt } from './commands/selection';
import type { SelectionAction } from './commands/selection';
import { TranslateLanguageModal } from './ui/modals/translate-language-modal';
import { createAutocompleteExtension } from './autocomplete/editor-extension';
import { AUTOCOMPLETE_MAX_TOKENS, AUTOCOMPLETE_STOP_SEQUENCES } from './autocomplete/completion';

/** Bind intent for a freshly opened chat pane: the literal opens a new
 *  conversation; any other string is an existing conversation id carried
 *  over (a popout opening a pane's current chat). */
export type PaneBind = 'fresh' | (string & {});

export default class CurtisPlugin extends Plugin {
	settings!: CurtisSettings;
	eventBus!: EventBus;
	toolRegistry!: ToolRegistry;
	mcpManager!: McpManager;
	gcpManager!: GcpManager;
	memoryStore!: MemoryStore;
	providerRegistry!: ProviderRegistry;
	/** OAuth token store behind the Sign in with ChatGPT provider. */
	chatgptTokenStore!: ChatGPTTokenManager;
	conversationStore!: ConversationStore;
	ragIndex!: RagIndexManager;
	swarm!: SwarmManager;
	agents!: AgentManager;
	/** Public plugin API — `app.plugins.plugins['curtis-ai-chat'].api`. */
	api!: CurtisPublicApi;
	/** Scheduled runs — fires persisted job prompts headlessly on a cadence
	 *  while the app is open (src/scheduler/, docs/SCHEDULED_RUNS.md). */
	scheduler!: SchedulerService;
	mcpServerManager!: McpServerManager;

	async onload(): Promise<void> {
		// 1. Load settings with migration
		await this.loadSettings();

		// 2. Migrate any plaintext API keys into OS keychain (no-op on Obsidian
		//    < 1.11.4 — keys stay in plaintext with a one-time warning).
		const { migrated, skipped } = await migrateSecretsToKeychain(this.app, this.settings);
		if (migrated.length > 0) {
			new Notice(`Migrated ${migrated.length} API key(s) to OS keychain`);
			await this.saveSettings();
		} else if (skipped) {
			console.warn('[Curtis] OS keychain unavailable (Obsidian < 1.11.4). API keys remain in plaintext data.json.');
		}

		// 3. Initialize core services
		this.eventBus = new EventBus();
		// Vault retrieval (RAG) — constructed before the tool registry so agent
		// mode can be handed semantic_search at boot. Loading the on-disk index
		// is lazy + idempotent; it must not delay boot.
		this.ragIndex = new RagIndexManager(this.app, this.manifest, this);
		void this.ragIndex.ensureLoaded();
		this.toolRegistry = new ToolRegistry(this.app, {
			enableWebSearch: this.settings.enableWebSearch,
			enableRag: this.settings.enableRag,
			enableCommands: this.settings.enableCommands,
			ragIndex: this.ragIndex,
		});
		// Swarm — the spawn_agent tool is registered for every conversation but
		// only ever advertised to leader chats (filtered in callAgentLoop).
		this.swarm = new SwarmManager(this);
		this.toolRegistry.register(this.swarm.buildSpawnTool());
		// MCP: connect user-configured servers in the background — a slow or
		// dead server must never delay plugin boot. Tools join the registry
		// via onToolsChanged as connections come up.
		this.mcpManager = new McpManager({
			getServers: () => this.settings.mcpServers,
			isEnabled: () => this.settings.enableMcp,
			clientVersion: this.manifest.version,
		});
		this.mcpManager.onToolsChanged = () => this.mcpManager.syncTools(this.toolRegistry);
		this.mcpManager.syncTools(this.toolRegistry);
		if (this.settings.enableMcp) void this.mcpManager.connectAll();
		// GCP connector — read-only Cloud Storage tools on a service account.
		// Same shape as MCP: connect in the background (a slow Google must
		// never delay boot), tools join the registry via onToolsChanged.
		this.gcpManager = new GcpManager({
			isEnabled: () => this.settings.enableGcp,
			getServiceAccountJson: () => resolveGcpServiceAccount(this.app, this.settings),
			getProjectId: () => this.settings.gcpProjectId,
		});
		this.gcpManager.onToolsChanged = () => this.gcpManager.syncTools(this.toolRegistry);
		this.gcpManager.syncTools(this.toolRegistry);
		if (this.settings.enableGcp) void this.gcpManager.connect();
		this.memoryStore = new MemoryStore(this.app);
		try {
			await this.memoryStore.load(this);
		} catch (e) {
			// A bad memory-file path (or a read-only vault) must not kill the
			// whole plugin — degrade to an empty in-memory store instead.
			console.error('[Curtis] Memory store failed to load — memory disabled this session:', e);
			new Notice('Curtis: memory file could not be opened — memory is disabled this session.');
		}
		this.conversationStore = new ConversationStore();
		// Loads vault-file conversations, watches for hand edits, and imports
		// any history still stored in localStorage (pre-1.3 format).
		await this.conversationStore.load({
			host: this,
			files: new VaultConversationFiles(this.app, this),
			yaml: vaultYamlPort,
			notifyError: (message) => new Notice(message),
		});
		// Named agents — persona + model routing + tool ACL per conversation.
		this.agents = new AgentManager(this);

		// Public plugin API — other plugins reach Curtis through
		// app.plugins.plugins['curtis-ai-chat'].api (docs/PLUGIN_API.md).
		this.api = createPublicApi(this);

		// Scheduled runs — ticks 30s after boot, so starting it here is safe
		// even though it reads this.api lazily at run time.
		this.scheduler = new SchedulerService(this);
		this.scheduler.start();

		// MCP server mode — serve the vault to external MCP clients. Desktop
		// only (mobile has no listening sockets); a bind failure must not
		// break boot, so it surfaces as a notice and the plugin loads on.
		this.mcpServerManager = new McpServerManager(this);
		if (this.settings.enableMcpServer && Platform.isDesktopApp) {
			void this.mcpServerManager.start().catch((e: unknown) => {
				new Notice(`Curtis MCP server: ${e instanceof Error ? e.message : String(e)}`);
			});
		}

		// 4. Initialize provider registry (with keychain-aware key resolver)
		const resolveKey = (_providerId: string, config?: import('./types').ProviderConfig): string => {
			return resolveApiKey(this.app, config);
		};
		// Sign in with ChatGPT — keychain-backed OAuth token store; the
		// ChatGPT provider refreshes through it lazily (prepare()).
		this.chatgptTokenStore = new ChatGPTTokenManager(
			this.app,
			this.settings,
			() => this.saveSettings()
		);
		this.providerRegistry = new ProviderRegistry(
			this.settings.providerConfigs,
			this.settings.customProviders,
			resolveKey,
			this.settings.discoveredModels,
			(providerId, models) => {
				// Persist each successful discovery so the next boot seeds from
				// the last known good list instead of the baked-in one.
				if (!this.settings.discoveredModels) this.settings.discoveredModels = {};
				this.settings.discoveredModels[providerId] = models;
				this.debouncedSaveDiscovery();
			},
			this.chatgptTokenStore
		);

		// Discovery hits each enabled provider's /models endpoint sequentially —
		// awaiting it here would block commands, ribbon, view registration and
		// the settings tab behind network calls (or one hung endpoint). Provider
		// instances are created synchronously up to the first await inside, so
		// chat works immediately; model lists fill in as discovery lands.
		void this.providerRegistry.initializeProviders();

		// 4. Register views
		this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this));
		// .curt files (Curtis's portable conversation format) open a branded
		// landing page offering one-click import — see src/import/curt.ts.
		this.registerView(CURT_VIEW_TYPE, (leaf) => new CurtImportView(leaf, this));
		this.registerExtensions(['curt'], CURT_VIEW_TYPE);
		// Desktop terminal pane — opened on demand as its own window; never
		// restored into the layout on mobile (the view itself degrades too).
		this.registerView(TERMINAL_VIEW_TYPE, (leaf) => new TerminalView(leaf, this));

		// 5. Register commands
		registerCommands(this);

		// 5b. Editor ghost-text autocomplete — one registration serves every
		//     editor and popout window. Desktop only (ghost text is unusable
		//     behind mobile keyboards); the extension reads settings live, so
		//     the toggle applies without a reload.
		if (!Platform.isMobile) {
			this.registerEditorExtension(createAutocompleteExtension(this));
		}

		// 6. Register context menu
		registerContextMenu(this);

		// 6b. Right-click "Import into Curtis" on importable files in the
		//     vault explorer (.curt bundles, export JSON/zip, transcripts).
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (!(file instanceof TFile)) return;
				if (!['curt', 'json', 'zip', 'md', 'txt'].includes(file.extension)) return;
				menu.addItem((item) => {
					item
						.setTitle('Curtis: import this file')
						.setIcon(CURTIS_ICON_ID)
						.onClick(() => {
							void (async () => {
								const summary = await importChats(this, [
									{ name: file.name, buffer: await this.app.vault.readBinary(file) },
								]);
								reportResult(summary, this);
							})();
						});
				});
			})
		);

		// 6c. Vault file listeners keep the RAG index in step with edits.
		//     Registered unconditionally — the manager no-ops when vault
		//     retrieval is disabled or the index was never built.
		this.registerVaultIndexListeners();

		// 7. Settings tab
		this.addSettingTab(new CurtisSettingTab(this.app, this));

		// 8. Register the custom Curtis mark — the logo lives on the ribbon
		//    (one click to chat; activateChatView reveals an existing pane
		//    rather than stacking duplicates), on the chat tab
		//    (ChatView.getIcon), and in menus. Icon registered before first
		//    use.
		addIcon(CURTIS_ICON_ID, CURTIS_ICON_SVG);
		this.addRibbonIcon(CURTIS_ICON_ID, 'Open Curtis AI', () => {
			void this.activateChatView();
		});
	}

	onunload(): void {
		// Abort in-flight scheduled runs and stop the tick before anything
		// they might call tears down underneath them.
		this.scheduler?.stop();
		// Flush any debounced conversation-file writes (best-effort — each
		// mutation already schedules its own write 200ms out). Guarded: onload
		// may have aborted before a service was constructed.
		this.conversationStore?.save();
		void this.memoryStore?.save(this);
		void this.mcpManager?.disconnectAll();
		void this.gcpManager?.disconnect();
		void this.mcpServerManager?.stop();
		void this.ragIndex?.dispose();
		// Drop any pending discovery-cache write rather than fire saveSettings()
		// on an unloaded plugin — the cache self-rebuilds on next boot's discovery.
		this.debouncedSaveDiscovery.cancel();
	}

	/**
	 * Keep the RAG index in step with the vault: edits re-embed the note
	 * (debounced inside the manager), deletes/renames update paths. All
	 * handlers no-op unless vault retrieval is enabled AND an index exists,
	 * so an idle vault never spends embeddings calls in the background.
	 */
	private registerVaultIndexListeners(): void {
		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (file instanceof TFile && file.extension === 'md') this.ragIndex.scheduleFileUpdate(file);
			})
		);
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (file instanceof TFile && file.extension === 'md') void this.ragIndex.removeFile(file.path);
			})
		);
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (file instanceof TFile && file.extension === 'md') {
					void this.ragIndex.renameFile(oldPath, file.path);
				}
			})
		);
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as SettingsData | null;
		const migrated = runMigrations(data || {});

		// Deep-merge defaults over stored data so nested objects (e.g. providerConfigs)
		// don't get wiped when the stored copy is partial/empty. Default inner
		// configs are cloned so in-place mutation in the settings UI can never
		// pollute the module-level defaults.
		const defaultConfigs = Object.fromEntries(
			Object.entries(DEFAULT_SETTINGS.providerConfigs).map(([id, cfg]) => [id, { ...cfg }])
		);
		this.settings = {
			...DEFAULT_SETTINGS,
			...(migrated as Partial<CurtisSettings>),
			providerConfigs: {
				...defaultConfigs,
				...(migrated.providerConfigs || {}),
			},
		};
		await this.saveData(this.settings);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	// ---- Sign in with ChatGPT ----------------------------------------------

	/** Current OAuth tokens for the ChatGPT provider, when signed in. */
	getChatGPTTokens(): ChatGPTTokens | null {
		return this.chatgptTokenStore?.loadTokens() ?? null;
	}

	/** Persist (or clear, null) the ChatGPT OAuth tokens and refresh the live
	 *  provider instance so the next request uses the new credential. */
	async saveChatGPTTokens(tokens: ChatGPTTokens | null): Promise<void> {
		await this.chatgptTokenStore.saveTokens(tokens);
		(this.providerRegistry.getProvider('chatgpt') as ChatGPTProvider | undefined)?.reloadTokens();
	}

	/** Run the browser sign-in flow (desktop only) and store the result. */
	async startChatGPTSignIn(): Promise<void> {
		if (!this.settings.chatgptHostId) {
			this.settings.chatgptHostId = crypto.randomUUID();
			await this.saveSettings();
		}
		const tokens = await signInWithChatGPT({
			hostId: this.settings.chatgptHostId,
			// Re-auth reuses the client id OpenAI already issued — a fresh
			// dynamic registration per sign-in would litter the account.
			previousClientId: this.getChatGPTTokens()?.client_id,
		});
		await this.saveChatGPTTokens(tokens);
	}

	/** Coalesces model-discovery cache writes — a boot with many enabled
	 *  providers would otherwise fire one data.json write per provider. */
	private debouncedSaveDiscovery = debounce(() => {
		void this.saveSettings();
	}, 2000);

	// ---- Chat View Management ----

	/** Re-render the background layer of every open ChatView. Called when
	 *  background-related settings change. */
	refreshAllChatViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof ChatView) {
				view.refreshBackground();
			}
		}
	}

	/** Re-render the full conversation in every open ChatView. Called after
	 *  the current conversation is swapped externally (e.g. from the search
	 *  modal) so the view reflects the new conversation without a full reload. */
	refreshChatViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof ChatView) {
				view.renderCurrentConversation();
			}
		}
	}

	/** Open the cross-conversation search modal. When `onSelect` is given (a
	 *  pane launched the search), the chosen conversation opens in that pane
	 *  and no view is activated — revealing the first chat leaf here would
	 *  steal focus from the pane the user clicked. The command-path fallback
	 *  activates a view first so there is somewhere to render the result. */
	async openChatSearch(onSelect?: (conversationId: string) => void): Promise<void> {
		let selector = onSelect;
		if (!selector) {
			await this.activateChatView();
			const activeView = this.app.workspace.getActiveViewOfType(ChatView);
			const view = activeView instanceof ChatView
				? activeView
				: this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)[0]?.view;
			if (view instanceof ChatView) {
				selector = (id) => view.switchConversation(id);
			}
		}
		new ChatSearchModal(this.app, this, selector).open();
	}

	async activateChatView(newChat?: boolean): Promise<void> {
		const { workspace } = this.app;

		// Multi-pane: prefer the chat pane the user is already in (e.g. a
		// popout they are typing in); fall back to the first existing chat
		// leaf; create one when none exists.
		let leaf = workspace.getActiveViewOfType(ChatView)?.leaf
			?? workspace.getLeavesOfType(CHAT_VIEW_TYPE)[0];

		if (!leaf) {
			const position = this.settings.chatViewPosition === 'left' ? 'left' : 'right';
			if (position === 'left') {
				const newLeaf = workspace.getLeftLeaf(false);
				if (!newLeaf) return;
				leaf = newLeaf;
			} else {
				const newLeaf = workspace.getRightLeaf(false);
				if (!newLeaf) return;
				leaf = newLeaf;
			}
		}

		await leaf.setViewState({ type: CHAT_VIEW_TYPE, active: true });
		void workspace.revealLeaf(leaf);

		if (newChat && leaf.view instanceof ChatView) {
			leaf.view.startNewChat();
		}
	}

	/** What the next opened chat pane binds to: 'fresh' starts a new
	 *  conversation; any other value is a conversation id carried over (a
	 *  popout opening a pane's current chat). Consumed by ChatView.onOpen —
	 *  passing intent through the plugin instead of poking the view after
	 *  setViewState avoids racing a slow async onOpen. */
	private pendingPaneBind: PaneBind | null = null;

	takePendingPaneBind(): PaneBind | null {
		const bind = this.pendingPaneBind;
		this.pendingPaneBind = null;
		return bind;
	}

	/** Open an ADDITIONAL chat pane — a tab beside the active one, or a
	 *  separate OS window. Both start a fresh conversation unless a bind is
	 *  passed (the header popout passes the pane's current conversation so
	 *  "open this chat in a window" does what it says). */
	async openNewChatPane(target: 'tab' | 'window', bind: PaneBind = 'fresh'): Promise<void> {
		this.pendingPaneBind = bind;
		const { workspace } = this.app;
		const leaf = workspace.getLeaf(target);
		await leaf.setViewState({ type: CHAT_VIEW_TYPE, active: true });
		void workspace.revealLeaf(leaf);
	}

	/** Open the terminal — deliberately window-first (its own optional OS
	 *  window, per the design call), with 'tab' docking it in the workspace
	 *  instead. Menu and command entries reveal the existing pane when there
	 *  is one; `another` (the "Open new/another terminal …" entries, chat
	 *  menu and terminal pane alike) skips the reveal and always spawns a
	 *  fresh pane — called from inside a terminal pane, the reveal would
	 *  always find the pane you clicked from and the button would never
	 *  open anything. Mobile callers pass 'tab' (no OS windows there) and
	 *  the pane runs the vault shell — see terminal/vshell.ts. */
	async openTerminalPane(target: 'tab' | 'window', opts?: { another?: boolean }): Promise<void> {
		const { workspace } = this.app;
		if (!opts?.another) {
			const existing = workspace.getLeavesOfType(TERMINAL_VIEW_TYPE)[0];
			if (existing) {
				void workspace.revealLeaf(existing);
				return;
			}
		}
		try {
			const leaf = workspace.getLeaf(target);
			await leaf.setViewState({ type: TERMINAL_VIEW_TYPE, active: true });
			void workspace.revealLeaf(leaf);
		} catch (e) {
			// A rejected setViewState must not vanish — the caller voids this
			// promise, and a swallowed rejection reads as a dead button.
			new Notice(`Could not open the terminal: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	// ---- Selection Processing ----

	async processSelection(editor: Editor, actionId: string): Promise<void> {
		const selection = editor.getSelection();
		if (!selection) return;

		const resolved = this.resolveSelectionAction(actionId);
		if (!resolved) return;
		const { label } = resolved;
		let { action } = resolved;

		try {
			this.getAuthenticatedProvider();
		} catch {
			new Notice('No AI provider configured. Check settings.');
			return;
		}

		// Translate asks for a target language first; the choice persists as
		// the next prefill. Every other action runs its built-in prompt.
		if (actionId === 'translate') {
			const language = await this.promptTranslateLanguage();
			if (!language) return;
			this.settings.selectionTranslateLanguage = language;
			await this.saveSettings();
			action = { ...action, userPrompt: (text) => translateUserPrompt(text, language) };
		}

		// Replace-mode actions review through the diff modal — nothing may
		// silently overwrite the selection anymore. Insert-below keeps the
		// direct apply.
		if (action.insertMode === 'replace') {
			await this.runDiffRewrite(editor, selection, action, label);
			return;
		}

		const messages: AIMessage[] = [
			{ role: 'system', content: action.systemPrompt },
			{ role: 'user', content: action.userPrompt(selection) },
		];

		new Notice('Processing...', 2000);

		try {
			let result = '';

			await this.callAI(messages, this.settings.activeModel, {
				onChunk: (chunk: string) => {
					result += chunk;
				},
			});

			// Insert-below — the original stays, the result lands under it.
			editor.replaceSelection(selection + '\n\n' + result);
		} catch (e) {
			console.error('[Curtis] Selection processing failed:', e);
			new Notice('AI request failed');
		}
	}

	/** Resolve a selection action id — built-in or user-defined — into the
	 *  runtime shape plus a human label for notices and the review modal. */
	private resolveSelectionAction(actionId: string): { action: SelectionAction; label: string } | undefined {
		const builtin = SELECTION_ACTIONS[actionId];
		if (builtin) {
			const label = actionId
				.split('-')
				.map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word))
				.join(' ');
			return { action: builtin, label };
		}
		const custom = this.settings.customSelectionActions.find((a) => a.id === actionId);
		if (!custom) return undefined;
		return { action: customToSelectionAction(custom), label: custom.name };
	}

	/** Ask for the translate target language. Resolves null on dismiss. */
	private promptTranslateLanguage(): Promise<string | null> {
		return new Promise((resolve) => {
			new TranslateLanguageModal(this.app, this.settings.selectionTranslateLanguage, resolve).open();
		});
	}

	// ---- Diff Rewrite (Cursor-style inline rewrite) ----

	/**
	 * Run a replace-mode selection action and open a diff modal so the user
	 * can review changes before they replace the selection. Non-streaming —
	 * we need the full response to compute the diff before showing the modal.
	 * Defaults to the 'improve' action for the explicit "Rewrite with AI
	 * (diff)" entries; processSelection routes every replace-mode action
	 * through here.
	 */
	async runDiffRewrite(
		editor: Editor,
		selection: string,
		action: SelectionAction = SELECTION_ACTIONS.improve,
		label = 'Rewrite'
	): Promise<void> {
		try {
			this.getAuthenticatedProvider();
		} catch {
			new Notice('No AI provider configured. Check settings.');
			return;
		}

		const messages: AIMessage[] = [
			{ role: 'system', content: action.systemPrompt },
			{ role: 'user', content: action.userPrompt(selection) },
		];

		new Notice('Processing...', 2000);

		try {
			const provider = this.getAuthenticatedProvider();
			const direct = await this.callProviderOnce(provider, messages, this.settings.activeModel, undefined);
			if (direct.error) {
				new Notice(`${label} failed: ${direct.error.message}`);
				return;
			}
			const result = direct.content?.trim();
			if (!result) {
				new Notice(`${label} returned empty content`);
				return;
			}
			new DiffRewriteModal(this.app, selection, result, (modified) => {
				editor.replaceSelection(modified);
				new Notice('Applied');
			}, `Review changes — ${label}`).open();
		} catch (e) {
			console.error('[Curtis] Diff rewrite failed:', e);
			new Notice(`${label} failed: ${(e as Error).message}`);
		}
	}

	// ---- Core AI Call ----

	/**
	 * Resolve the active provider and verify authentication. Throws with a
	 * user-readable message if no provider is configured or authenticated.
	 */
	getAuthenticatedProvider(): AIProvider {
		const provider = this.providerRegistry.getActiveProvider(this.settings.activeProvider);
		if (!provider) throw new Error('No active provider');
		if (!provider.isAuthenticated()) throw new Error('Provider not authenticated');
		return provider;
	}

	/**
	 * Resolve a specific provider by id and verify authentication. Used by
	 * arena mode where each parallel call targets a different provider.
	 * Throws with a readable message if the provider is missing or unauthed.
	 */
	getAuthenticatedProviderById(providerId: string): AIProvider {
		const provider = this.providerRegistry.getProvider(providerId);
		if (!provider) throw new Error(`Provider "${providerId}" not configured`);
		if (!provider.isAuthenticated()) throw new Error(`Provider "${providerId}" not authenticated`);
		return provider;
	}

	/**
	 * Build request options for a provider, layering its advanced overrides
	 * over the global Generation settings in three steps:
	 *   global Generation value < provider modelOverrides (Settings →
	 *   provider card → Advanced request parameters → 'Provider default')
	 *   < perModelOverrides[modelId] (same block, model scope).
	 * Field-level: a defined value wins; undefined falls through to the next
	 * layer. The optional sampling knobs stay undefined unless explicitly set,
	 * which providers treat as "don't send this field".
	 *
	 * When a reasoning effort resolves, it is translated into the provider's
	 * wire dialect (getReasoningWire) and any sampling fields the provider
	 * rejects under reasoning are stripped — after layering, so a
	 * provider-level temperature can't sneak back in under a reasoning request.
	 */
	private buildRequestOptions(
		providerId: string,
		modelId: string,
		init?: { stream?: boolean; tools?: ToolDefinition[] }
	): AIRequestOptions {
		const config = this.settings.providerConfigs[providerId];
		const p = config?.modelOverrides ?? {};
		const m = (modelId ? config?.perModelOverrides?.[modelId] : undefined) ?? {};
		// First defined value wins — the three-layer resolution.
		const pick = <T>(...vals: Array<T | undefined>): T | undefined =>
			vals.find((v) => v !== undefined);

		// omitTemperature: true wins at any layer and can never be un-set by a
		// lower layer — a "don't send temperature" must stay sticky.
		const omitTemperature = m.omitTemperature === true || p.omitTemperature === true;
		const temperature = pick(m.temperature, p.temperature, this.settings.temperature);
		const maxTokens = pick(m.maxTokens, p.maxTokens) ?? this.settings.maxTokens;
		const topP = pick(m.topP, p.topP);
		const topK = pick(m.topK, p.topK);
		const minP = pick(m.minP, p.minP);
		const seed = pick(m.seed, p.seed);
		const stopSequences = pick(m.stopSequences, p.stopSequences);
		const frequencyPenalty = pick(m.frequencyPenalty, p.frequencyPenalty);
		const presencePenalty = pick(m.presencePenalty, p.presencePenalty);
		const repetitionPenalty = pick(m.repetitionPenalty, p.repetitionPenalty);
		const numCtx = pick(m.numCtx, p.numCtx);
		const numGpu = pick(m.numGpu, p.numGpu);
		const numThread = pick(m.numThread, p.numThread);
		const keepAlive = pick(m.keepAlive, p.keepAlive);
		const hasOllamaKnobs = numCtx !== undefined || numGpu !== undefined
			|| numThread !== undefined || !!keepAlive;

		const options: AIRequestOptions = {
			model: modelId,
			temperature: omitTemperature ? undefined : temperature,
			maxTokens,
			stream: init?.stream,
			tools: init?.tools,
			topP,
			topK,
			minP,
			seed,
			stop: parseStopSequences(stopSequences),
			frequencyPenalty,
			presencePenalty,
			repetitionPenalty,
			extra: parseExtraBody(pick(m.extraBodyJson, p.extraBodyJson)),
			ollama: hasOllamaKnobs ? {
				numCtx,
				numGpu,
				numThread,
				keepAlive,
			} : undefined,
		};

		// Reasoning effort → provider wire dialect. Skipped entirely when
		// unset — undefined means "send nothing reasoning-related".
		const effort = pick(m.reasoningEffort, p.reasoningEffort);
		if (effort) {
			options.reasoningEffort = effort;
			const wire = getReasoningWire(providerId, effort, maxTokens);
			if (wire.body) options.reasoningBody = wire.body;
			for (const key of wire.dropSampling) {
				if (key === 'temperature') options.temperature = undefined;
				else if (key === 'topP') options.topP = undefined;
				else if (key === 'stop') options.stop = undefined;
				else if (key === 'penalties') {
					options.frequencyPenalty = undefined;
					options.presencePenalty = undefined;
				}
			}
		}

		return options;
	}

	/**
	 * Compact summary of the non-default request parameters a provider/model
	 * pair resolves to (rendered under each arena column's header). Only
	 * fields that differ from the global Generation settings, or optional
	 * knobs that are explicitly set, appear — '' when everything is default
	 * so callers render nothing.
	 */
	getEffectiveParamsSummary(providerId: string, modelId: string): string {
		const o = this.buildRequestOptions(providerId, modelId, {});
		const cfg = this.settings.providerConfigs[providerId];
		// omitTemperature suppresses temperature at any layer — its own label.
		const noTemp = cfg?.modelOverrides?.omitTemperature === true
			|| cfg?.perModelOverrides?.[modelId]?.omitTemperature === true;
		const parts: string[] = [];
		if (noTemp) parts.push('no temp');
		else if (o.temperature !== undefined && o.temperature !== this.settings.temperature) {
			parts.push(`temp ${o.temperature}`);
		}
		if (o.maxTokens !== this.settings.maxTokens) parts.push(`max ${o.maxTokens}`);
		if (o.topP !== undefined) parts.push(`top_p ${o.topP}`);
		if (o.topK !== undefined) parts.push(`top_k ${o.topK}`);
		if (o.minP !== undefined) parts.push(`min_p ${o.minP}`);
		if (o.seed !== undefined) parts.push(`seed ${o.seed}`);
		if (o.stop?.length) parts.push(`stop ${o.stop.length}`);
		if (o.frequencyPenalty !== undefined) parts.push(`freq ${o.frequencyPenalty}`);
		if (o.presencePenalty !== undefined) parts.push(`pres ${o.presencePenalty}`);
		if (o.repetitionPenalty !== undefined) parts.push(`rep ${o.repetitionPenalty}`);
		if (o.reasoningEffort) parts.push(`effort ${o.reasoningEffort}`);
		if (o.ollama?.numCtx !== undefined) parts.push(`ctx ${o.ollama.numCtx}`);
		if (o.ollama?.numGpu !== undefined) parts.push(`gpu ${o.ollama.numGpu}`);
		if (o.ollama?.numThread !== undefined) parts.push(`threads ${o.ollama.numThread}`);
		if (o.ollama?.keepAlive) parts.push(`keep_alive ${o.ollama.keepAlive}`);
		return parts.join(' · ');
	}

	/** Last formatted request body per provider id — feeds the settings
	 *  card's "Copy last request JSON" button. In-memory only, reset on
	 *  plugin reload; nothing here touches the vault or data.json. */
	private lastRequestBodies = new Map<string, string>();

	/** The most recent request body this session sent to a provider, if any. */
	getLastRequestBody(providerId: string): string | undefined {
		return this.lastRequestBodies.get(providerId);
	}

	/**
	 * Central chat-completion entry point. Handles every HTTP transport
	 * (node-https / fetch / requestUrl), streaming and non-streaming, and
	 * abort via AbortSignal. Callers supply onChunk to receive the response.
	 *
	 * Honors `settings.streamResponse` for transport selection.
	 */
	async callAI(
		messages: AIMessage[],
		modelId: string,
		callbacks?: {
			onChunk?: (chunk: string) => void;
			onUsage?: (usage: TokenUsage) => void;
			onError?: (error: Error) => void;
			signal?: AbortSignal;
			/** Override the active provider for this call. Used by arena mode
			 *  to fan out a single prompt to multiple providers in parallel. */
			providerId?: string;
		}
	): Promise<void> {
		const provider = callbacks?.providerId
			? this.getAuthenticatedProviderById(callbacks.providerId)
			: this.getAuthenticatedProvider();

		// OAuth providers (Sign in with ChatGPT) refresh their short-lived
		// access token here — formatRequest reads a synchronous snapshot and
		// cannot await. A failed refresh surfaces as a normal provider error.
		try {
			await provider.prepare?.();
		} catch (e) {
			callbacks?.onError?.(e as Error);
			return;
		}

		const stream = this.settings.streamResponse;
		const options = this.buildRequestOptions(provider.id, modelId, { stream });

		const requestInit = provider.formatRequest(messages, options);
		// Every provider formats the body as a JSON string (see formatRequest).
		this.lastRequestBodies.set(provider.id, requestInit.body as string);

		// Track usage centrally so all transports report identically.
		const onUsage = (usage: TokenUsage): void => {
			callbacks?.onUsage?.(usage);
		};

		// Track the last stream error so we can decide whether to retry with
		// images stripped (some providers — e.g. Z.ai GLM Coding plan — reject
		// image_url parts with a 400 even though the model accepts images via
		// a different endpoint). We capture the error quietly; if it's an image-
		// rejection we retry text-only WITHOUT surfacing the original error.
		let streamError: Error | null = null;
		let receivedAnyChunk = false;

		const result = await chatStream(
			provider,
			requestInit,
			{ stream },
			{
				onChunk: (delta) => {
					receivedAnyChunk = true;
					callbacks?.onChunk?.(delta);
				},
				onUsage,
				onError: (err) => {
					// Don't propagate yet — we may retry.
					streamError = err;
				},
				signal: callbacks?.signal,
			}
		);

		try {
			await result.done;
		} catch (e) {
			if (!streamError) streamError = e as Error;
		}

		// Retry path: if the provider rejected the request specifically because
		// of image content AND we never received a successful chunk, retry once
		// with text-only content. We only retry when no chunks flowed so we
		// don't append the retry onto a partial response.
		if (
			streamError &&
			!receivedAnyChunk &&
			messagesHaveImageContent(messages)
		) {
			const errMsg = (streamError.message || '').toLowerCase();
			const isImageRejection =
				errMsg.includes('content.type') ||
				errMsg.includes('image') ||
				errMsg.includes('multimodal') ||
				errMsg.includes('media');
			if (isImageRejection) {
				const textOnly = stripImageContent(messages);
				const strippedRequest = provider.formatRequest(textOnly, options);
				this.lastRequestBodies.set(provider.id, strippedRequest.body as string);
				new Notice('This endpoint rejected the image — retrying as text only. Try a different provider for vision.', 6000);
				streamError = null;
				const retry = await chatStream(
					provider,
					strippedRequest,
					{ stream },
					{
						onChunk: (delta) => callbacks?.onChunk?.(delta),
						onUsage,
						onError: (err) => {
							streamError = err;
							callbacks?.onError?.(err);
						},
						signal: callbacks?.signal,
					}
				);
				try {
					await retry.done;
				} catch (e) {
					if (!streamError) streamError = e as Error;
				}
			}
		} else if (streamError) {
			// Non-image error, or image error after partial chunks already flowed.
			// Surface it to the caller now.
			callbacks?.onError?.(streamError);
		}

		if (streamError && !callbacks?.onError) {
			throw streamError;
		}
	}

	// ---- Agent loop --------------------------------------------------------
	//
	// Invoked from the chat view when agent mode is enabled AND the active
	// provider speaks a tool-calling dialect. The loop:
	//   1. Send messages + tool catalog (non-streaming) → AIResponse.
	//   2. If response has tool_calls: execute the first one, append the
	//      assistant tool_call message + the tool result message, loop.
	//   3. If response has no tool_calls: it's the final answer — deliver
	//      the text via onChunk and return.
	//
	// v1 constraints (per design doc):
	//   - Single tool call per turn (ignore parallel tool_calls).
	//   - Auto-approve EXCEPT run_command — shell commands pass a
	//     confirmation dialog (see the gate in the loop body).
	//   - Loop cap = settings.agentMaxTurns (default 5).
	//   - Non-streaming — tool_call detection needs the full response.

	/** Commands approved with "always this session" in the run_command
	 *  dialog, keyed by cwd+command. Plugin-lifetime — a reload re-arms the
	 *  gate. Irrelevant while terminalConfirmCommands is off. */
	private commandSessionAllows = new Set<string>();

	/** Mirror of AgentManager.resolve for a headless, conversation-less run
	 *  (opts.agentId, e.g. api.runAgent): same ResolvedAgent shape, so the
	 *  ACL filter and maxTurns fallback below behave identically. A dangling
	 *  id resolves to the default assistant, matching the conversation path. */
	private resolveAgentForLoop(agentId: string): ResolvedAgent {
		const agent = this.agents.getAgent(agentId);
		if (!agent) {
			return {
				agent: undefined,
				persona: undefined,
				providerId: undefined,
				modelId: undefined,
				acl: undefined,
				maxTurns: undefined,
			};
		}
		return {
			agent,
			persona: agent.systemPrompt.trim() || undefined,
			providerId: agent.providerId || undefined,
			modelId: agent.modelId || undefined,
			acl: agent.tools,
			maxTurns: agent.maxTurns,
		};
	}

	async callAgentLoop(
		messages: AIMessage[],
		modelId: string,
		callbacks: {
			onChunk?: (chunk: string) => void;
			onUsage?: (usage: TokenUsage) => void;
			onError?: (error: Error) => void;
			onToolCall?: (call: ToolCall) => void;
			onToolResult?: (call: ToolCall, result: { content: string; isError: boolean }) => void;
			signal?: AbortSignal;
		},
		opts?: { conversationId?: string; providerId?: string; maxTurns?: number; allowedTools?: string[]; agentId?: string }
	): Promise<void> {
		// Per-conversation routing: an explicit providerId (agent chat, pane
		// model, swarm follower) wins over the workspace default — the loop
		// must talk to the conversation's provider, not whichever happens to
		// be globally active. Callers pre-validate auth; a miss here surfaces
		// through onError.
		const provider = opts?.providerId
			? this.getAuthenticatedProviderById(opts.providerId)
			: this.getAuthenticatedProvider();
		const allTools = this.toolRegistry.getAllTools();

		// Leader detection gates the swarm tool: spawn_agent is registered for
		// every conversation but must only ever be advertised to leader chats — a
		// leader's follower (role 'follower') can never spawn sub-agents.
		const conversationId = opts?.conversationId;
		const conversation = conversationId
			? this.conversationStore.getConversation(conversationId)
			: undefined;
		const isLeader = conversation?.role === 'leader';
		if (isLeader && conversationId) {
			this.swarm.beginGeneration(conversationId);
		}

		// Named agents: the bound conversation's agent narrows the toolset and
		// can override the loop cap. Applies to followers too — a follower
		// conversation carries the agent it was spawned from. An explicit
		// opts.agentId (api.runAgent) resolves the agent headlessly with no
		// conversation at all, so leader/swarm gating below stays off.
		const resolvedAgent = opts?.agentId
			? this.resolveAgentForLoop(opts.agentId)
			: this.agents.resolve(conversation);
		const maxTurns = Math.max(1, opts?.maxTurns ?? resolvedAgent.maxTurns ?? this.settings.agentMaxTurns);

		// If any user message in the working set already carries an attached
		// note (marked by the `[Attached note: X]` block that prependAttachedNotes
		// injects), strip read_note + search_notes from the tool list. The note
		// content is already in the conversation context — advertising these
		// tools just tempts the model to re-fetch what it already has, wasting
		// a turn + tokens. Other tools (create_note, edit_note, get_tags, etc.)
		// remain available since they do work the attachment can't substitute for.
		const hasAttachedNote = messages.some((m) =>
			m.role === 'user' && typeof m.content === 'string' && m.content.includes('[Attached note:')
		);
		const agentAcl = resolvedAgent.agent;
		const tools = allTools.filter((t) => {
			if (t.name === SWARM_TOOL_NAME) {
				// Leader-only — and a vault-less agent cannot delegate vault
				// work it is not allowed to do itself.
				if (!isLeader) return false;
				if (agentAcl && !agentAcl.tools.vault) return false;
				return true;
			}
			if (agentAcl && !this.agents.allowsTool(agentAcl, t.name)) return false;
			if (hasAttachedNote && (t.name === 'read_note' || t.name === 'search_notes')) return false;
			// Headless callers (plugin API) narrow the catalog — e.g. no shell.
			if (opts?.allowedTools && !opts.allowedTools.includes(t.name)) return false;
			return true;
		});

		// Working copy — we append assistant tool_call messages and tool
		// result messages as the loop progresses.
		let working: AIMessage[] = [...messages];

		let turns = 0;
		while (turns < maxTurns) {
			if (callbacks.signal?.aborted) return;

			const direct = await this.callProviderOnce(provider, working, modelId, tools, callbacks.signal);
			if (direct.error) {
				callbacks.onError?.(direct.error);
				if (!callbacks.onError) throw direct.error;
				return;
			}
			if (direct.usage) {
				callbacks.onUsage?.(direct.usage);
			}

			if (!direct.toolCalls || direct.toolCalls.length === 0) {
				// Final answer — deliver as one chunk. The view's streaming
				// renderer handles a single large delta fine.
				if (direct.content) callbacks.onChunk?.(direct.content);
				return;
			}

			// v1: execute the first tool call only.
			const call = direct.toolCalls[0];
			callbacks.onToolCall?.(call);

			// Append the assistant message (with tool_calls) to working set.
			working = [...working, {
				role: 'assistant' as const,
				content: direct.content || '',
				tool_calls: [call],
			}];

			// Confirmation gate for shell commands: run_command reaches
			// outside the vault, so — when confirmation is on — every call
			// passes a dialog unless the user already allowed this exact
			// command this session. A denial short-circuits into an error
			// tool result so the model can react; the loop continues rather
			// than aborting.
			if (call.name === RUN_COMMAND_TOOL.name && this.settings.terminalConfirmCommands) {
				const commandText = typeof call.arguments.command === 'string' ? call.arguments.command : '';
				const cwdText = typeof call.arguments.cwd === 'string' ? call.arguments.cwd : '';
				if (commandText) {
					const sessionKey = `${cwdText}\u241f${commandText}`;
					if (!this.commandSessionAllows.has(sessionKey)) {
						const approval = await confirmCommandRun(this.app, commandText, cwdText || 'vault root');
						if (approval === 'always') this.commandSessionAllows.add(sessionKey);
						if (approval === 'deny') {
							const denied =
								'User denied this command in the confirmation dialog. Do not run it again — ask the user how to proceed instead.';
							callbacks.onToolResult?.(call, { content: denied, isError: true });
							working = [...working, {
								role: 'tool' as const,
								content: denied,
								tool_call_id: call.id,
								name: call.name,
								is_error: true,
							}];
							turns++;
							continue;
						}
					}
				}
			}

			// Execute. The context bag is what lets orchestrating tools (the
			// swarm) act on behalf of this loop: abort with it, inherit its
			// provider/model, and write into the right conversation.
			const toolResult = await this.toolRegistry.executeTool(call, conversationId, {
				signal: callbacks.signal,
				plugin: this,
				providerId: opts?.providerId ?? provider.id,
				modelId,
			});

			callbacks.onToolResult?.(call, {
				content: toolResult.content,
				isError: toolResult.is_error === true,
			});

			// Append the tool result message.
			working = [...working, {
				role: 'tool' as const,
				content: toolResult.content,
				tool_call_id: call.id,
				name: call.name,
				is_error: toolResult.is_error === true,
			}];

			turns++;
		}

		// Hit the loop cap without a final answer.
		console.warn(`[Curtis] Agent hit max turns (${maxTurns}) without a final response`);
		callbacks.onChunk?.('\n\n*[Agent stopped: reached max tool calls limit]*');
	}

	/**
	 * One-shot non-streaming provider call. Returns the parsed AIResponse
	 * (content + tool_calls + usage) or an error. Used by callAgentLoop.
	 *
	 * Goes through Obsidian's requestUrl (CORS-immune, buffered) so we can
	 * call provider.parseResponse ourselves and recover tool_calls — the
	 * streaming chatStream path only forwards content deltas.
	 *
	 * v1 limitation: requestUrl ignores AbortSignal, so agent requests
	 * can't be mid-flight cancelled. The user can still abort before the
	 * next loop iteration.
	 */
	private async callProviderOnce(
		provider: AIProvider,
		messages: AIMessage[],
		modelId: string,
		tools: ToolDefinition[] | undefined,
		signal?: AbortSignal
	): Promise<{ content: string; toolCalls?: ToolCall[]; usage?: TokenUsage; error?: Error }> {
		// OAuth refresh before dispatch (see callAI) — a failed refresh is a
		// normal agent-loop error, not a throw.
		try {
			await provider.prepare?.();
		} catch (e) {
			return { content: '', error: e as Error };
		}
		const options = this.buildRequestOptions(provider.id, modelId, { stream: false, tools });
		const requestInit = provider.formatRequest(messages, options);
		this.lastRequestBodies.set(provider.id, requestInit.body as string);

		const headers: Record<string, string> = flattenHeaders(requestInit.headers);

		try {
			const resp = await requestUrl({
				url: provider.endpoint,
				method: requestInit.method || 'POST',
				headers,
				body: requestInit.body as string,
				throw: false,
			});
			if (resp.status < 200 || resp.status >= 300) {
				const snippet = (resp.text || '').slice(0, 500);
				return { content: '', error: new Error(`${provider.name} API error (${resp.status}): ${snippet}`) };
			}
			const body = resp.text;
			const data: unknown = JSON.parse(body);
			const ai = await provider.parseResponse({
				ok: resp.status >= 200 && resp.status < 300,
				status: resp.status,
				json: async () => data,
				text: async () => body,
			});
			return {
				content: ai.content || '',
				toolCalls: ai.tool_calls,
				usage: ai.usage,
			};
		} catch (e) {
			if (signal?.aborted) return { content: '', error: new Error('Aborted') };
			return { content: '', error: e as Error };
		}
	}

	// ---- Inline autocomplete ------------------------------------------------

	/** Session tally for /stats — in-memory only, resets with the app. */
	readonly autocompleteUsage = { requests: 0, tokens: 0 };

	recordAutocompleteUsage(tokens: number): void {
		this.autocompleteUsage.tokens += tokens;
	}

	/**
	 * One completion request for the editor ghost text. Rides the same
	 * transport as chat (chatStream → provider auth headers → paramCaps) so
	 * token refresh, CORS policy and strict-provider quirks behave
	 * identically; only the sampling differs, and deliberately: completion
	 * tuning is fixed (small, cool, cheap) — chat's generation settings and
	 * the provider's model overrides do not apply. The one override honored
	 * is omitTemperature, which marks providers that reject the field outright.
	 */
	async callCompletion(
		providerId: string,
		modelId: string,
		messages: AIMessage[],
		signal: AbortSignal
	): Promise<{ text: string; tokens: number }> {
		const provider = this.getAuthenticatedProviderById(providerId);
		// OAuth refresh before dispatch (see callAI); throws to the caller.
		await provider.prepare?.();
		const config = this.settings.providerConfigs[providerId];
		const omitTemperature = config?.modelOverrides?.omitTemperature === true
			|| (modelId ? config?.perModelOverrides?.[modelId]?.omitTemperature === true : false);
		const options: AIRequestOptions = {
			model: modelId,
			temperature: omitTemperature ? undefined : 0.2,
			maxTokens: AUTOCOMPLETE_MAX_TOKENS,
			stream: false,
			stop: AUTOCOMPLETE_STOP_SEQUENCES,
		};
		const requestInit = provider.formatRequest(messages, options);

		let text = '';
		let tokens = 0;
		const result = await chatStream(
			provider,
			requestInit,
			{ stream: false },
			{
				onChunk: (delta) => {
					text += delta;
				},
				onUsage: (usage) => {
					tokens = usage.totalTokens;
				},
				signal,
			}
		);
		try {
			await result.done;
		} catch (e) {
			if (signal.aborted) return { text: '', tokens: 0 };
			throw e;
		}
		this.autocompleteUsage.requests++;
		return { text, tokens };
	}

	// ---- Memory auto-capture -----------------------------------------------

	/**
	 * Background extraction of durable facts from a completed user→assistant
	 * turn. Strict prompt: model returns 0-3 facts as JSON or `[]`. Failures
	 * are logged but never surface to the user — this is best-effort.
	 *
	 * Capture modes:
	 *   - 'off'     — never runs.
	 *   - 'auto'    — extracted facts are saved to the memory file directly.
	 *   - 'confirm' — extracted facts are handed to `onPropose`; nothing is
	 *                 persisted until the user ratifies each one.
	 */
	async extractAndStoreFacts(
		userText: string,
		assistantText: string,
		onPropose?: (proposals: MemoryProposal[]) => void,
		sourceConversationId?: string
	): Promise<void> {
		if (!this.settings.enableMemory) return;
		const mode = this.settings.memoryCaptureMode;
		if (mode === 'off') return;
		const trimmedUser = userText.trim();
		const trimmedAsst = assistantText.trim();
		if (!trimmedUser || !trimmedAsst) return;

		const prompt = [
			{
				role: 'system' as const,
				content:
					'You extract DURABLE facts about the user from a chat turn. A durable fact is something ' +
					'true across future conversations: a preference, identity trait, long-lived project detail, ' +
					'or standing instruction. Do NOT capture ephemeral requests, the topic of this single chat, ' +
					'or anything the user is asking be done right now.\n\n' +
					'Respond with ONLY a JSON array of 0-3 objects, each: {"content": "<self-contained statement>", "category": "preference|identity|project|instruction|other"}.\n' +
					'If nothing durable, respond: []',
			},
			{
				role: 'user' as const,
				content: `User said:\n${trimmedUser.slice(0, 2000)}\n\nAssistant replied:\n${trimmedAsst.slice(0, 2000)}\n\nExtract durable facts (JSON array):`,
			},
		];

		try {
			let buffer = '';
			await this.callAI(prompt, this.settings.activeModel, {
				onChunk: (c) => (buffer += c),
			});
			const json = extractJsonArray(buffer);
			if (!json || json.length === 0) return;
			// Normalize + skip facts the user already saved — neither mode
			// should re-surface known content.
			const existing = new Set(this.memoryStore.getFacts().map((f) => f.content.toLowerCase()));
			const proposals: MemoryProposal[] = [];
			for (const f of json) {
				if (typeof f?.content !== 'string') continue;
				const content = f.content.replace(/\s+/g, ' ').trim();
				if (!content || existing.has(content.toLowerCase())) continue;
				proposals.push({
					content,
					category: typeof f.category === 'string' ? f.category : undefined,
					...(sourceConversationId ? { sourceConversationId } : {}),
				});
			}
			if (proposals.length === 0) return;
			if (mode === 'auto') {
				for (const p of proposals) {
					await this.memoryStore.addFact(p.content, p.category, p.sourceConversationId);
				}
				return;
			}
			onPropose?.(proposals);
		} catch (e) {
			console.debug('[Curtis] fact extraction failed (non-fatal):', e);
		}
	}

}

/** Pull the first JSON array out of an LLM response (handles ```json fences). */
function extractJsonArray(text: string): Array<{ content?: unknown; category?: unknown }> | null {
	if (!text) return null;
	// Strip markdown code fences if present.
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const candidate = fenced ? fenced[1] : text;
	// First '[' to matching ']' — tolerant of trailing prose.
	const start = candidate.indexOf('[');
	const end = candidate.lastIndexOf(']');
	if (start === -1 || end === -1 || end <= start) return null;
	const slice = candidate.slice(start, end + 1);
	try {
		const parsed: unknown = JSON.parse(slice);
		return Array.isArray(parsed) ? (parsed as Array<{ content?: unknown; category?: unknown }>) : null;
	} catch {
		return null;
	}
}

/** Split the comma-separated stop-sequence override into a wire array. */
function parseStopSequences(raw: string | undefined): string[] | undefined {
	if (!raw || !raw.trim()) return undefined;
	const seqs = raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
	return seqs.length > 0 ? seqs : undefined;
}

/** Parse the extra-body JSON override. Bad JSON logs and sends nothing — a
 *  typo must never take the whole request down. */
function parseExtraBody(raw: string | undefined): Record<string, unknown> | undefined {
	if (!raw || !raw.trim()) return undefined;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
		console.warn('[Curtis] Extra body JSON must be an object — ignoring.');
		return undefined;
	} catch (e) {
		console.warn('[Curtis] Extra body JSON failed to parse — ignoring.', e);
		return undefined;
	}
}

/** True if any message in the array has multi-part content with image_url parts. */
function messagesHaveImageContent(messages: AIMessage[]): boolean {
	for (const m of messages) {
		if (Array.isArray(m.content)) {
			for (const part of m.content) {
				if (part.type === 'image_url') return true;
			}
		}
	}
	return false;
}

/** Return a copy of the message list with image parts removed (text-only).
 *  If a message would become empty after stripping (image-only), substitute a
 *  placeholder so providers don't reject an empty content field. */
function stripImageContent(messages: AIMessage[]): AIMessage[] {
	return messages.map((m) => {
		if (!Array.isArray(m.content)) return m;
		const textParts = m.content.filter((p) => p.type === 'text');
		const joined = textParts.map((p) => p.text || '').join('\n').trim();
		return { ...m, content: joined || '[image removed — provider does not support images]' };
	});
}
