// Curtis — Main Plugin Entry Point

import { Editor, Notice, Plugin, requestUrl } from 'obsidian';
import type { CurtisSettings, AIMessage, TokenUsage, AIProvider, ToolCall, ToolDefinition } from './types';
import { DEFAULT_SETTINGS, CurtisSettingTab } from './settings';
import { ProviderRegistry } from './providers/registry';
import { chatStream, flattenHeaders } from './providers/transport';
import { EventBus } from './core/events';
import { HookSystem } from './core/hooks';
import { ToolRegistry } from './core/tools';
import { runMigrations } from './core/migration';
import type { SettingsData } from './core/migration';
import { migrateSecretsToKeychain, resolveApiKey } from './core/secrets';
import { MemoryStore } from './memory';
import { TemplateManager } from './templates';
import { ConversationStore } from './chat/conversation-store';
import { ChatSearchModal } from './ui/modals/chat-search-modal';
import { DiffRewriteModal } from './ui/modals/diff-rewrite-modal';
import { CHAT_VIEW_TYPE, ChatView } from './chat/view';
import { registerCommands } from './commands';
import { registerContextMenu } from './commands/context-menu';
import { SELECTION_ACTIONS } from './commands/selection';

export default class CurtisPlugin extends Plugin {
	settings!: CurtisSettings;
	eventBus!: EventBus;
	hookSystem!: HookSystem;
	toolRegistry!: ToolRegistry;
	memoryStore!: MemoryStore;
	templateManager!: TemplateManager;
	providerRegistry!: ProviderRegistry;
	conversationStore!: ConversationStore;

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
		this.hookSystem = new HookSystem();
		this.toolRegistry = new ToolRegistry(this.app, {
			enableWebSearch: this.settings.enableWebSearch,
		});
		this.memoryStore = new MemoryStore(this.app);
		await this.memoryStore.load(this);
		this.templateManager = new TemplateManager();
		this.conversationStore = new ConversationStore(this.app);
		this.conversationStore.load();

		// 4. Initialize provider registry (with keychain-aware key resolver)
		const resolveKey = (providerId: string, config?: import('./types').ProviderConfig): string => {
			return resolveApiKey(this.app, config);
		};
		this.providerRegistry = new ProviderRegistry(
			this.settings.providerConfigs,
			this.settings.customProviders,
			resolveKey
		);
		await this.providerRegistry.initializeProviders();

		// 4. Register views
		this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this));

		// 5. Register commands
		registerCommands(this);

		// 6. Register context menu
		registerContextMenu(this);

		// 7. Settings tab
		this.addSettingTab(new CurtisSettingTab(this.app, this));

		// 8. Ribbon icon
		this.addRibbonIcon('bot', 'Open AI Chat', () => {
			void this.activateChatView();
		});
	}

	onunload(): void {
		this.conversationStore.save();
		void this.memoryStore.save(this);
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as SettingsData | null;
		const migrated = runMigrations(data || {});

		// Deep-merge defaults over stored data so nested objects (e.g. providerConfigs)
		// don't get wiped when the stored copy is partial/empty.
		this.settings = {
			...DEFAULT_SETTINGS,
			...(migrated as Partial<CurtisSettings>),
			providerConfigs: {
				...DEFAULT_SETTINGS.providerConfigs,
				...(migrated.providerConfigs || {}),
			},
			hotkeys: {
				...DEFAULT_SETTINGS.hotkeys,
				...((migrated.hotkeys as CurtisSettings['hotkeys']) || {}),
			},
		};
		await this.saveData(this.settings);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	// ---- Chat View Management ----

	/** Re-render the background layer of every open ChatView. Called when
	 *  background-related settings change. */
	refreshAllChatViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof ChatView) {
				view.refreshBackground();
				view.refreshInputHint();
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

	/** Open the cross-conversation search modal. Ensures the chat view exists
	 *  first so onChooseItem has somewhere to render the result. */
	async openChatSearch(): Promise<void> {
		await this.activateChatView();
		new ChatSearchModal(this.app, this).open();
	}

	async activateChatView(newChat?: boolean): Promise<void> {
		const { workspace } = this.app;

		let leaf = workspace.getLeavesOfType(CHAT_VIEW_TYPE)[0];

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

	// ---- Selection Processing ----

	async processSelection(editor: Editor, action: string): Promise<void> {
		const selection = editor.getSelection();
		if (!selection) return;

		const actionDef = SELECTION_ACTIONS[action];
		if (!actionDef) return;

		try {
			this.getAuthenticatedProvider();
		} catch {
			new Notice('No AI provider configured. Check settings.');
			return;
		}

		const messages: AIMessage[] = [
			{ role: 'system', content: actionDef.systemPrompt },
			{ role: 'user', content: actionDef.userPrompt(selection) },
		];

		new Notice('Processing...', 2000);

		try {
			let result = '';

			await this.callAI(messages, this.settings.activeModel, {
				onChunk: (chunk: string) => {
					result += chunk;
				},
			});

			// Apply result based on insert mode
			switch (actionDef.insertMode) {
				case 'replace':
					editor.replaceSelection(result);
					break;
				case 'insert-below':
					editor.replaceSelection(selection + '\n\n' + result);
					break;
				// 'none' insert mode has no defined behavior and no action uses it;
				// omitting the case keeps the switch exhaustive over real values.
			}
		} catch (e) {
			console.error('[Curtis] Selection processing failed:', e);
			new Notice('AI request failed');
		}
	}

	// ---- Diff Rewrite (Cursor-style inline rewrite) ----

	/**
	 * Rewrite the current selection via the 'improve' prompt and open a diff
	 * modal so the user can review changes before applying. Non-streaming —
	 * we need the full response to compute the diff before showing the modal.
	 */
	async runDiffRewrite(editor: Editor, selection: string): Promise<void> {
		try {
			this.getAuthenticatedProvider();
		} catch {
			new Notice('No AI provider configured. Check settings.');
			return;
		}

		const action = SELECTION_ACTIONS.improve;
		const messages: AIMessage[] = [
			{ role: 'system', content: action.systemPrompt },
			{ role: 'user', content: action.userPrompt(selection) },
		];

		new Notice('Rewriting...', 2000);

		try {
			const provider = this.getAuthenticatedProvider();
			const direct = await this.callProviderOnce(provider, messages, this.settings.activeModel, undefined);
			if (direct.error) {
				new Notice(`Rewrite failed: ${direct.error.message}`);
				return;
			}
			const result = direct.content?.trim();
			if (!result) {
				new Notice('Rewrite returned empty content');
				return;
			}
			new DiffRewriteModal(this.app, selection, result, (modified) => {
				editor.replaceSelection(modified);
				new Notice('Applied');
			}).open();
		} catch (e) {
			console.error('[Curtis] Diff rewrite failed:', e);
			new Notice(`Rewrite failed: ${(e as Error).message}`);
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

		// Run hooks: messages:before-send
		const processedMessages = (await this.hookSystem.runPipeline(
			'messages:before-send',
			messages,
			{}
		)) as AIMessage[];

		const stream = this.settings.streamResponse;
		const options = {
			model: modelId,
			temperature: this.settings.temperature,
			maxTokens: this.settings.maxTokens,
			stream,
		};

		// Run hooks: provider:request
		const requestInit = provider.formatRequest(processedMessages, options);
		const finalRequest = await this.hookSystem.runPipeline('provider:request', requestInit, {});

		// Track usage centrally so all transports report identically.
		const onUsage = (usage: TokenUsage): void => {
			callbacks?.onUsage?.(usage);
			this.eventBus.emit('provider:response', { usage, provider: provider.id, model: modelId });
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
			finalRequest,
			{ stream },
			{
				onChunk: (delta) => {
					receivedAnyChunk = true;
					this.eventBus.emit('provider:chunk', { delta, provider: provider.id });
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
			messagesHaveImageContent(processedMessages)
		) {
			const errMsg = (streamError.message || '').toLowerCase();
			const isImageRejection =
				errMsg.includes('content.type') ||
				errMsg.includes('image') ||
				errMsg.includes('multimodal') ||
				errMsg.includes('media');
			if (isImageRejection) {
				const textOnly = stripImageContent(processedMessages);
				const strippedRequest = provider.formatRequest(textOnly, options);
				const finalStrippedRequest = await this.hookSystem.runPipeline(
					'provider:request',
					strippedRequest,
					{}
				);
				new Notice('This endpoint rejected the image — retrying as text only. Try a different provider for vision.', 6000);
				streamError = null;
				const retry = await chatStream(
					provider,
					finalStrippedRequest,
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
	// When agent mode is enabled AND the active provider speaks the OpenAI
	// tool-calling dialect, callAI delegates here. The loop:
	//   1. Send messages + tool catalog (non-streaming) → AIResponse.
	//   2. If response has tool_calls: execute the first one, append the
	//      assistant tool_call message + the tool result message, loop.
	//   3. If response has no tool_calls: it's the final answer — deliver
	//      the text via onChunk and return.
	//
	// v1 constraints (per design doc):
	//   - Single tool call per turn (ignore parallel tool_calls).
	//   - Auto-approve (no per-call confirmation).
	//   - Loop cap = settings.agentMaxTurns (default 5).
	//   - Non-streaming — tool_call detection needs the full response.

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
		}
	): Promise<void> {
		const provider = this.getAuthenticatedProvider();
		const allTools = this.toolRegistry.getAllTools();
		const maxTurns = Math.max(1, this.settings.agentMaxTurns);

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
		const tools = hasAttachedNote
			? allTools.filter((t) => t.name !== 'read_note' && t.name !== 'search_notes')
			: allTools;

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
				this.eventBus.emit('provider:response', { usage: direct.usage, provider: provider.id, model: modelId });
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

			// Execute.
			const toolResult = await this.toolRegistry.executeTool(call);

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
		const options = {
			model: modelId,
			temperature: this.settings.temperature,
			maxTokens: this.settings.maxTokens,
			stream: false as const,
			tools,
		};
		const requestInit = provider.formatRequest(messages, options);
		const finalRequest = await this.hookSystem.runPipeline('provider:request', requestInit, {});

		const headers: Record<string, string> = flattenHeaders(finalRequest.headers);

		try {
			const resp = await requestUrl({
				url: provider.endpoint,
				method: finalRequest.method || 'POST',
				headers,
				body: finalRequest.body as string,
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

	// ---- Memory auto-capture -----------------------------------------------

	/**
	 * Background extraction of durable facts from a completed user→assistant
	 * turn. Strict prompt: model returns 0-3 facts as JSON or `[]`. Failures
	 * are logged but never surface to the user — this is best-effort.
	 */
	async extractAndStoreFacts(userText: string, assistantText: string): Promise<void> {
		if (!this.settings.enableMemory) return;
		if (this.settings.memoryCaptureMode !== 'auto') return;
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
			for (const f of json) {
				if (typeof f?.content === 'string' && f.content.trim()) {
					await this.memoryStore.addFact(f.content.trim(), typeof f.category === 'string' ? f.category : undefined);
				}
			}
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
