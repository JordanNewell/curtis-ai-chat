// Curtis Settings — defaults, settings tab UI

import { App, Notice, Platform, PluginSettingTab, Setting, requestUrl, setIcon } from 'obsidian';
import type { SettingDefinitionItem, SettingDefinitionRender } from 'obsidian';
import type { CurtisSettings, CustomSelectionAction, ModelOverrides, ProviderConfig, ProviderDefinition, McpServerConfig, ReasoningEffort } from './types';
import { PROVIDER_DEFINITIONS, getParamCaps } from './providers/registry';
import { isChatGPTSignInAvailable } from './providers/chatgpt-signin';
import { CustomProviderModal } from './ui/modals/custom-provider-modal';
import { CustomActionEditorModal } from './ui/modals/custom-action-editor-modal';
import { SELECTION_ACTIONS } from './commands/selection';
import { McpServerModal } from './ui/modals/mcp-server-modal';
import { AgentEditorModal } from './ui/modals/agent-editor-modal';
import { ScheduledJobModal } from './ui/modals/scheduled-job-modal';
import { describeSchedule } from './scheduler/schedule';
import { FolderSuggestModal } from './ui/modals/folder-suggest-modal';
import { ImageSuggestModal } from './ui/modals/image-suggest-modal';
import { ModelPickerModal, buildModelPickerEntries } from './ui/modals/model-picker-modal';
import { ensureJournalFile } from './memory/journal';
import { EditFactModal } from './ui/modals/edit-fact-modal';
import { CORE_SYSTEM_PROMPT } from './core/system-prompt';
import { setApiKeyForProvider, getSecretStorage, resolveApiKey, resolveGcpServiceAccount, setGcpServiceAccount } from './core/secrets';
import { GcpServiceAccountModal } from './ui/modals/gcp-service-account-modal';
import { rebuildIndexWithProgress } from './rag';
import { openImportDialog } from './import/importer';
import { downloadConversationsCurtZip } from './import/curt';
import { flattenHeaders } from './providers/transport';
import { ensureNotificationPermission, isSystemNotificationSupported } from './chat/notifications';
import { isSpeechSupported } from './chat/voice';
import { CURTIS_ICON_ID } from './icons';
import type CurtisPlugin from './main';
import type { RemoteRunEntry } from './mcp/server/manager';

export const DEFAULT_SETTINGS: CurtisSettings = {
	activeProvider: 'anthropic',
	activeModel: 'claude-sonnet-4-5-20250929',

	providerConfigs: (() => {
		const configs: Record<string, ProviderConfig> = {};
		for (const def of PROVIDER_DEFINITIONS) {
			configs[def.id] = {
				enabled: def.id === 'anthropic',
				apiKey: '',
				defaultModel: def.models[0]?.id,
			};
		}
		return configs;
	})(),

	customProviders: [],

	temperature: 0.7,
	maxTokens: 4096,
	// User-defined extension to the CORE_SYSTEM_PROMPT (now hardcoded in
	// src/core/system-prompt.ts and composed at send time). Empty by default —
	// fresh installs get just the core. Users can add custom context here
	// (project specifics, tone preferences, domain knowledge) which is
	// appended below a `---` separator after the core.
	systemPrompt: '',
	streamResponse: true,
	showTokenUsage: true,

	chatViewPosition: 'right',
	notifyOnCompletion: false,
	notifyOnError: false,

	noteSaveFolder: 'AI Notes',
	autoSaveAssistantResponses: false,
	autoSaveFolder: '',

	enterKeyBehavior: 'send',
	chatBackground: 'theme',
	chatWallpaperPath: '',

	ttsVoiceUri: '',
	ttsRate: 1,
	ttsPitch: 1,
	ttsAutoSpeak: false,
	ttsHighlight: true,

	enableMemory: true,
	memoryCaptureMode: 'confirm',
	memoryFilePath: 'AI/Curtis Memory.md',
	pcpFilePath: 'AI/PCP.md',

	conversationsFolder: 'AI/Conversations',

	enableJournal: true,
	journalFilePath: 'AI/Curtis Journal.md',

	enableRag: false,
	enableRelevancePulse: true,
	ragChunkSize: 500,
	ragChunkOverlap: 50,
	ragTopK: 5,
	ragEmbeddingProvider: 'openai',
	ragEmbeddingModel: 'text-embedding-3-small',

	enableAgent: false,
	agentMaxTurns: 5,
	agentProviderId: '',
	agentModelId: '',
	// Swarm: cap on follower agents a leader chat may spawn per send —
	// the hard ceiling on how much one message can fan out.
	swarmMaxFollowers: 3,
	enableWebSearch: false,
	enableMcp: false,
	mcpServers: [],
	// GCP connector — read-only Cloud Storage via service-account key;
	// off by default, same opt-in posture as MCP and the web tools.
	enableGcp: false,
	gcpProjectId: '',
	// MCP server mode — desktop only, off by default; writes double-gated.
	enableMcpServer: false,
	mcpServerPort: 24783,
	mcpServerToken: '',
	mcpServerAllowWrites: false,
	agents: [],
	// Scheduled runs — prompt (+ optional named agent) on a cadence, fired
	// only while Obsidian is open. Jobs persist here; each run writes one
	// markdown note into scheduledOutputFolder.
	scheduledJobs: [],
	scheduledOutputFolder: 'AI/Scheduled',
	showDaySeparators: true,
	showLinkFavicons: true,

	// Terminal — the pane is always available on desktop; these govern the
	// agent's run_command tool.
	enableCommands: false,
	terminalConfirmCommands: true,
	terminalRestrictToVault: true,
	terminalShell: '',
	terminalTimeoutSeconds: 60,
	// Terminal memory — shared, persistent command history + last cwd.
	terminalMemory: true,
	terminalHistory: [],
	terminalLastCwd: '',

	// Inline autocomplete — off by default: it sends note text around the
	// cursor to the provider on every typing pause, which users must opt into.
	enableAutocomplete: false,
	autocompleteProviderId: '',
	autocompleteModelId: '',
	autocompleteDebounceMs: 500,
	autocompleteMinChars: 4,
	autocompleteAcceptKey: 'tab',

	onboardingCompleted: false,

	// Selection actions (editor context menu / command palette).
	// Last target language used by the translate action — prefill for the
	// next run of the language prompt.
	selectionTranslateLanguage: 'English',
	// User-defined selection actions shown alongside the built-ins.
	customSelectionActions: [],

	// Anthropic extended thinking — consumed in the provider request path.
	anthropicExtendedThinking: false,
	anthropicThinkingBudget: 8000,
};

export class CurtisSettingTab extends PluginSettingTab {
	plugin: CurtisPlugin;

	/** Shared enable-path for the notification toggles: request permission on
	 *  desktop, and tell unsupported platforms (mobile) what they get. */
	private static async warnWhenNotificationsUnsupported(): Promise<void> {
		if (isSystemNotificationSupported()) {
			await ensureNotificationPermission();
			return;
		}
		new Notice('System notifications are not available here — completions will surface as in-app notices instead.');
	}

	constructor(app: App, plugin: CurtisPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		// Stylesheet root for the settings pane (styles.css) — scopes the
		// settings design system to Curtis's tab without touching other
		// plugins' settings or core panes.
		this.containerEl.addClass('curtis-settings');
	}

	/** S3 — tabular-nums value readout beside a slider. Returns the sync
	 *  callback to call (again) from the slider's onChange. */
	private sliderReadout(setting: Setting, initial: number, format: (v: number) => string): (v: number) => void {
		const readout = setting.controlEl.createSpan({
			cls: 'ai-slider-readout',
			text: format(initial),
		});
		return (v: number) => readout.setText(format(v));
	}

	/**
	 * Declarative settings (Obsidian 1.13+): each section is a group of
	 * definitions. Simple visuals are built imperatively inside `render`
	 * callbacks — the framework creates the row (name/desc feed the settings
	 * search index), and we fill it with the same Setting components used
	 * before the migration. Dynamic state changes call `this.update()` to
	 * re-fetch definitions and re-render.
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			this.activeProviderGroup(),
			this.providerConfigGroup(),
			this.customProvidersGroup(),
			this.customActionsGroup(),
			this.generationGroup(),
			this.autocompleteGroup(),
			this.agentGroup(),
			this.agentsGroup(),
			this.scheduledRunsGroup(),
			this.terminalGroup(),
			this.mcpGroup(),
			this.mcpServerGroup(),
			this.gcpGroup(),
			this.chatUIGroup(),
			this.voiceGroup(),
			this.notesGroup(),
			this.backgroundGroup(),
				this.memoryGroup(),
				this.ragGroup(),
				this.conversationsGroup(),
				this.aboutGroup(),
		];
	}

	/** A definition whose row is built by `build`, with `name`/`desc` for search. */
	private row(name: string, desc: string | undefined, build: (el: HTMLElement) => void): SettingDefinitionRender {
		return {
			name,
			...(desc ? { desc } : {}),
			render: (setting) => {
				const el = setting.settingEl;
				el.empty();
				build(el);
			},
		};
	}

	// ---- Active provider & model ----

	private activeProviderGroup(): SettingDefinitionItem {
		const s = this.plugin.settings;
		// Built-ins AND customs — a custom provider can legitimately be active
		// (model picker, /model, /provider); listing only built-ins rendered a
		// blank dropdown and an empty Active-model row.
		const enabledProviders = this.plugin.providerRegistry.getAllDefinitions().filter(
			(d) => s.providerConfigs[d.id]?.enabled
		);
		return {
			type: 'group',
			name: 'Active provider',
			heading: 'Active provider',
			items: [
				this.row('Active provider', 'Select the AI provider to use for chat', (el) => {
					new Setting(el)
						.setName('Active provider')
						.setDesc('Select the AI provider to use for chat')
						.addDropdown((dd) => {
							dd.addOption('', 'None configured');
							for (const def of enabledProviders) {
								dd.addOption(def.id, def.name);
							}
							dd.setValue(s.activeProvider);
							dd.onChange(async (val) => {
								s.activeProvider = val;
								const config = s.providerConfigs[val];
								if (config?.defaultModel) {
									s.activeModel = config.defaultModel;
								}
								await this.plugin.saveSettings();
								this.update();
							});
						});
				}),
				this.row('Active model', 'Select the model to use', (el) => {
					const activeDef = this.plugin.providerRegistry.getDefinition(s.activeProvider);
					if (!activeDef) return;
					new Setting(el)
						.setName('Active model')
						.setDesc('Select the model to use')
						.addDropdown((dd) => {
							const provider = this.plugin.providerRegistry.getProvider(activeDef.id);
							const models = provider?.models || activeDef.models;
							for (const m of models) {
								dd.addOption(m.id, `${m.name} (${(m.contextLength / 1000).toFixed(0)}K)`);
							}
							dd.setValue(s.activeModel);
							dd.onChange(async (val) => {
								s.activeModel = val;
								await this.plugin.saveSettings();
							});
						});
				}),
			],
		};
	}

	// ---- Provider configuration ----

	private providerConfigGroup(): SettingDefinitionItem {
		const items: SettingDefinitionRender[] = [
			this.row('Privacy', undefined, (el) => {
				const privacyNote = el.createEl('p', { cls: 'ai-setting-hint ai-privacy-note' });
				privacyNote.createEl('strong', { text: 'Privacy:' });
				privacyNote.appendText(' Cloud providers (Anthropic, OpenAI, Gemini, etc.) send your chat content to their servers. For fully private, offline AI, enable ');
				privacyNote.createEl('em', { text: 'Ollama (local)' });
				privacyNote.appendText(' — nothing leaves your machine.');
			}),
		];
		for (const def of PROVIDER_DEFINITIONS) {
			items.push(this.renderProviderCard(def));
		}
		return {
			type: 'group',
			name: 'Provider configuration',
			heading: 'Provider configuration',
			items,
		};
	}

	/** One built-in provider's configuration card. */
	private renderProviderCard(def: ProviderDefinition): SettingDefinitionRender {
		return {
			name: def.name,
			desc: this.providerCardDesc(def),
			render: (setting) => {
				const el = setting.settingEl;
				el.empty();
				el.addClass('ai-provider-settings');
				this.buildProviderCardRows(el, def);
			},
		};
	}

	/**
	 * Card description — base text plus an override count. Desc is not shown
	 * on the card itself (the render callback owns that DOM) but it feeds the
	 * settings search index, so "which providers did I tune?" is searchable
	 * and the count is visible without opening every card.
	 */
	private providerCardDesc(def: ProviderDefinition): string | undefined {
		const base = def.authType === 'none' ? 'Local provider — no API key required' : undefined;
		return this.withOverrideCount(base, def.id);
	}

	/** Append the provider's total override count to a card description. */
	private withOverrideCount(base: string | undefined, providerId: string): string | undefined {
		const n = this.countOverrides(this.plugin.settings.providerConfigs[providerId]);
		if (n === 0) return base;
		const label = `${n} parameter override${n === 1 ? '' : 's'} set`;
		return base ? `${base} · ${label}` : label;
	}

	/** Total advanced-parameter overrides across the provider default and all
	 *  of its per-model records. */
	private countOverrides(config: ProviderConfig | undefined): number {
		if (!config) return 0;
		let n = countOverrideFields(config.modelOverrides);
		for (const rec of Object.values(config.perModelOverrides ?? {})) {
			n += countOverrideFields(rec);
		}
		return n;
	}

	private buildProviderCardRows(el: HTMLElement, def: ProviderDefinition): void {
		const config = this.plugin.settings.providerConfigs[def.id] || {
			enabled: false,
			apiKey: '',
		};
		this.plugin.settings.providerConfigs[def.id] = config;

		new Setting(el).setName(def.name).setHeading();

		new Setting(el)
			.setName('Enable')
			.addToggle((toggle) => {
				toggle.setValue(config.enabled);
				toggle.onChange(async (val) => {
					config.enabled = val;
					await this.plugin.saveSettings();
					this.plugin.providerRegistry.updateConfig(def.id, config);
					// Enabling at runtime must also fill the model list — defs
					// with no static models (ollama, lmstudio, azure…) would
					// otherwise show empty dropdowns until a manual refresh.
					if (val && def.autoDiscoverModels) {
						void this.plugin.providerRegistry
							.discoverModels(def)
							.then(() => this.update())
							.catch(() => undefined);
					}
					this.update();
				});
			});

		if (def.authType === 'anthropic') {
			new Setting(el)
				.setName('API key')
				.setDesc('Anthropic API key — stored in os keychain when available')
				.addText((text) => {
					text.inputEl.type = 'password';
					const storedInKeychain = !config.apiKey && !!config.apiKeyRef;
					text.setPlaceholder(storedInKeychain ? '•••• stored — type a new key to replace' : 'Sk-ant-...')
						.setValue(config.apiKey || '')
						.onChange(async (val) => {
							setApiKeyForProvider(this.app, def.id, config, val);
							await this.plugin.saveSettings();
							this.plugin.providerRegistry.updateConfig(def.id, config);
						});
				});
		} else if (def.authType === 'bearer' || def.authType === 'key') {
			// 'key' (fal.ai) uses a prefixed Authorization scheme, not Bearer —
			// say so, and hint at fal's id:secret key format.
			const keyDesc = def.authType === 'key'
				? `${def.name} key (id:secret) — sent as "Authorization: Key <key>"`
				: getSecretStorage(this.app)
					? `${def.name} API key — stored in os keychain`
					: `${def.name} API key`;
			new Setting(el)
				.setName('API key')
				.setDesc(keyDesc)
				.addText((text) => {
					text.inputEl.type = 'password';
					const storedInKeychain = !config.apiKey && !!config.apiKeyRef;
					text.setPlaceholder(storedInKeychain ? '•••• stored — type a new key to replace' : 'Enter API key')
						.setValue(config.apiKey || '')
						.onChange(async (val) => {
							setApiKeyForProvider(this.app, def.id, config, val);
							await this.plugin.saveSettings();
							this.plugin.providerRegistry.updateConfig(def.id, config);
						});
				});
		}
		// 'none' auth (Ollama, LM Studio) skips the API key field entirely.
		// OAuth (Sign in with ChatGPT) has no key either — a sign-in card.
		if (def.authType === 'oauth') {
			this.buildChatGPTOAuthSetting(el, config);
		}

		// Endpoint override applies to ALL auth types — Ollama and LM Studio
		// need this for non-default hosts; Azure requires a deployment URL.
		if (def.id === 'ollama' || def.id === 'lmstudio' || def.id === 'azure-openai') {
			const placeholder =
				def.id === 'azure-openai'
					? 'https://<resource>.openai.azure.com/openai/deployments/<dep>/chat/completions?api-version=2024-10-21'
					: def.endpoint;
			new Setting(el)
				.setName(def.id === 'azure-openai' ? 'Deployment URL' : 'Custom endpoint')
				.setDesc(
					def.id === 'azure-openai'
						? 'Required. Full Azure deployment URL including api-version.'
						: 'Override default endpoint URL'
				)
				.addText((text) => {
					text.setPlaceholder(placeholder)
						.setValue(config.customEndpoint || '')
						.onChange(async (val) => {
							config.customEndpoint = val || undefined;
							await this.plugin.saveSettings();
							this.plugin.providerRegistry.updateConfig(def.id, config);
						});
				});
		}

		// Default model selector per provider
		if (config.enabled) {
			const providerInstance = this.plugin.providerRegistry.getProvider(def.id);
			const modelList = providerInstance?.models || def.models;
			new Setting(el)
				.setName('Default model')
				.setDesc(modelList.length > def.models.length
					? `${modelList.length} models (auto-discovered)`
					: 'Pick the default model for new chats')
				.addDropdown((dd) => {
					for (const m of modelList) {
						dd.addOption(m.id, m.name);
					}
					dd.setValue(config.defaultModel || modelList[0]?.id || '');
					dd.onChange(async (val) => {
						config.defaultModel = val;
						await this.plugin.saveSettings();
					});
				})
				.addExtraButton((btn) => {
					if (!def.autoDiscoverModels) {
						btn.setDisabled(true).setTooltip('Auto-discovery not supported for this provider');
						return;
					}
					btn.setIcon('refresh-cw')
						.setTooltip('Refresh model list from provider')
						.onClick(async () => {
							new Notice(`Refreshing ${def.name} models...`);
							try {
								const discovered = await this.plugin.providerRegistry.discoverModels(def);
								if (discovered.length > 0) {
									new Notice(`${def.name}: ${discovered.length} models available`);
									this.update();
								} else {
									new Notice(`${def.name}: no models discovered. Check API key.`);
								}
							} catch (e) {
								new Notice(`${def.name} refresh failed: ${(e as Error).message}`);
							}
						});
				})
				.addExtraButton((btn) => {
					btn.setIcon('crosshair')
						.setTooltip('Test connection')
						.onClick(async () => {
							new Notice(`Testing ${def.name}...`);
							const result = await testProviderConnection(def, config, this.app, this.plugin.providerRegistry.getProvider(def.id));
							new Notice(result.message, 8000);
						});
				})
				.addExtraButton((btn) => {
					// Copy the exact body the last request to this provider sent
					// (per-model overrides, reasoning dialect and all) — the
					// fastest way to see what actually reached the wire.
					btn.setIcon('copy')
						.setTooltip('Copy last request JSON')
						.setDisabled(!this.plugin.getLastRequestBody(def.id))
						.onClick(async () => {
							const body = this.plugin.getLastRequestBody(def.id);
							if (!body) return;
							await navigator.clipboard.writeText(body);
							new Notice('Copied last request body');
						});
				});

				this.buildManualModelSettings(el, def, config);
				this.buildAdvancedParams(el, def, config);
			}
		}

	/** Sign in with ChatGPT — the OAuth provider's card: connection status
	 *  plus sign-in/sign-out buttons. No API key exists for this provider;
	 *  the browser flow mints the tokens (see providers/chatgpt-signin.ts). */
	private buildChatGPTOAuthSetting(el: HTMLElement, _config: ProviderConfig): void {
		const tokens = this.plugin.getChatGPTTokens();
		const signedIn = !!(tokens?.access_token || tokens?.refresh_token);
		const setting = new Setting(el)
			.setName(signedIn ? 'ChatGPT account' : 'Sign in with ChatGPT')
			.setDesc(
				signedIn
					? `Connected${tokens?.account_id ? ` (${tokens.account_id})` : ''} — requests bill against your ChatGPT plan allowance, not API credits. The access token renews automatically.`
					: "Uses your ChatGPT Plus/Pro plan via OpenAI's official sign-in — no API key. A browser window opens to authorize Curtis AI."
			);

		if (!isChatGPTSignInAvailable()) {
			setting.setName('ChatGPT (Sign in)');
			setting.setDesc('Sign in with ChatGPT requires Obsidian desktop.');
			return;
		}

		if (signedIn) {
			setting.addButton((b) =>
				b.setButtonText('Sign out').onClick(async () => {
					await this.plugin.saveChatGPTTokens(null);
					new Notice('Signed out of ChatGPT');
					this.update();
				})
			);
		} else {
			setting.addButton((b) =>
				b
					.setButtonText('Sign in with ChatGPT')
					.setCta()
					.onClick(async () => {
						b.setDisabled(true).setButtonText('Waiting for browser…');
						try {
							await this.plugin.startChatGPTSignIn();
							new Notice('Signed in to ChatGPT');
						} catch (e) {
							new Notice(`ChatGPT sign-in failed: ${e instanceof Error ? e.message : String(e)}`, 8000);
						} finally {
							b.setDisabled(false).setButtonText('Sign in with ChatGPT');
							this.update();
						}
					})
			);
		}
	}

	/** "Add model" rows — manual model ids for providers whose /models listing
	 *  lags what the plan actually serves (e.g. z.ai coding plans). Extras are
	 *  always offered in the picker and never pruned by discovery. Shared by
	 *  built-in and custom provider cards. */
	private buildManualModelSettings(el: HTMLElement, def: ProviderDefinition, config: ProviderConfig): void {
		const input = new Setting(el)
			.setName('Add model')
			.setDesc('Manually add a model ID if the list above is outdated — it appears in the model picker and survives refreshes.');
		const inputEl = input.controlEl.createEl('input', { type: 'text', attr: { placeholder: 'e.g. glm-5.3' } });
		inputEl.addClass('ai-manual-model-input');
		const addExtra = async (): Promise<void> => {
			const id = inputEl.value.trim();
			if (!id) return;
			if (config.extraModels?.includes(id)) {
				new Notice(`${id} is already in the list`);
				return;
			}
			config.extraModels = [...(config.extraModels ?? []), id];
			await this.plugin.saveSettings();
			// updateConfig recreates the provider seeded with the extras.
			this.plugin.providerRegistry.updateConfig(def.id, config);
			this.update();
			new Notice(`Added ${id} to ${def.name}`);
		};
		inputEl.addEventListener('keydown', (evt) => {
			if (evt.key === 'Enter') void addExtra();
		});
		input.addExtraButton((btn) => {
			btn.setIcon('plus')
				.setTooltip('Add model ID')
				.onClick(() => void addExtra());
		});

		for (const id of config.extraModels ?? []) {
			new Setting(el)
				.setName(id)
				.setDesc('Manually added — always kept in the model picker')
				.addExtraButton((btn) => {
					btn.setIcon('x')
						.setTooltip('Remove')
						.onClick(async () => {
							config.extraModels = (config.extraModels ?? []).filter((m) => m !== id);
							await this.plugin.saveSettings();
							this.plugin.providerRegistry.updateConfig(def.id, config);
							this.update();
						});
				});
		}
	}

	// ---- Custom providers ----

	private customProvidersGroup(): SettingDefinitionItem {
		const items: SettingDefinitionRender[] = [
			this.row('Custom providers', undefined, (el) => {
				el.createEl('p', {
					cls: 'ai-setting-hint',
					text: 'Add any OpenAI-compatible endpoint (litellm, llama.cpp, novita, deepinfra, portkey, helicone, self-hosted servers, etc.).',
				});
			}),
		];
		for (const def of this.plugin.settings.customProviders) {
			items.push({
				name: def.name,
				desc: this.withOverrideCount(def.endpoint, def.id),
				render: (setting) => {
					const el = setting.settingEl;
					el.empty();
					el.addClass('ai-provider-settings');
					this.buildCustomProviderCardRows(el, def);
				},
			});
		}
		items.push(this.row('Add custom provider', 'Configure any OpenAI-compatible endpoint', (el) => {
			new Setting(el)
				.setName('Add custom provider')
				.setDesc('Configure any OpenAI-compatible endpoint')
				.addButton((b) => {
					b.setButtonText('Add')
						.setClass('mod-cta')
						.onClick(() => this.openCustomProviderModal());
				});
		}));
		return { type: 'group', name: 'Custom providers', heading: 'Custom providers', items };
	}

	private buildCustomProviderCardRows(el: HTMLElement, def: ProviderDefinition): void {
		const config = this.plugin.settings.providerConfigs[def.id] || { enabled: true, apiKey: '' };
		this.plugin.settings.providerConfigs[def.id] = config;

		new Setting(el).setName(def.name).setHeading();

		new Setting(el)
			.setName('Enable')
			.addToggle((t) => {
				t.setValue(config.enabled);
				t.onChange(async (val) => {
					config.enabled = val;
					await this.plugin.saveSettings();
					this.plugin.providerRegistry.updateConfig(def.id, config);
					this.update();
				});
			});

		new Setting(el)
			.setName('API key')
			.setDesc(getSecretStorage(this.app) ? 'Stored in os keychain' : '')
			.addText((t) => {
				t.inputEl.type = 'password';
				t.setPlaceholder('Bearer token')
					.setValue(config.apiKey || '')
					.onChange(async (val) => {
						setApiKeyForProvider(this.app, def.id, config, val);
						await this.plugin.saveSettings();
						this.plugin.providerRegistry.updateConfig(def.id, config);
					});
			});

		new Setting(el)
			.setName('Endpoint')
			.setDesc(def.endpoint)
			.addButton((b) => {
				b.setButtonText('Edit')
					.onClick(() => this.openCustomProviderModal(def, config.apiKey));
			})
			.addButton((b) => {
				b.setButtonText('Delete');
				b.buttonEl.addClass('mod-destructive');
				b.onClick(async () => {
					this.plugin.providerRegistry.removeCustomProvider(def.id);
					this.plugin.settings.customProviders = this.plugin.settings.customProviders.filter((p) => p.id !== def.id);
					delete this.plugin.settings.providerConfigs[def.id];
					// The persisted discovery cache outlives the registry's
					// in-memory copy — clear it too or data.json carries the
					// dead id forever.
					delete this.plugin.settings.discoveredModels?.[def.id];
					await this.plugin.saveSettings();
					this.update();
					new Notice(`Deleted ${def.name}`);
				});
			})
			.addExtraButton((btn) => {
				// Custom cards have no test-connection button — the copy action
				// rides on the Endpoint row instead.
				btn.setIcon('copy')
					.setTooltip('Copy last request JSON')
					.setDisabled(!this.plugin.getLastRequestBody(def.id))
					.onClick(async () => {
						const body = this.plugin.getLastRequestBody(def.id);
						if (!body) return;
						await navigator.clipboard.writeText(body);
						new Notice('Copied last request body');
					});
			});

		this.buildManualModelSettings(el, def, config);
		this.buildAdvancedParams(el, def, config);
	}

	// ---- Custom selection actions ----

	private customActionsGroup(): SettingDefinitionItem {
		const s = this.plugin.settings;
		const items: SettingDefinitionRender[] = [
			this.row('Custom selection actions', undefined, (el) => {
				el.createEl('p', {
					cls: 'ai-setting-hint',
					text: 'Your own editor actions for selected text: a system prompt plus a user prompt template. They appear in the editor context menu and command palette alongside the built-ins. Palette entries are registered at startup — reload after adding one.',
				});
			}),
		];
		for (const action of s.customSelectionActions) {
			const desc = action.insertMode === 'replace'
				? 'Replaces the selection (diff review first)'
				: 'Inserts the result below the selection';
			items.push(this.row(`Custom selection action ${action.name}`, desc, (el) => {
				let confirming = false;
				new Setting(el)
					.setName(action.name)
					.setDesc(desc)
					.addButton((btn) =>
						btn.setIcon('pencil').setTooltip('Edit action').onClick(() => {
							this.openCustomActionModal(action);
						})
					)
					.addButton((btn) =>
						btn
							.setIcon('trash')
							.setTooltip('Delete action')
							.onClick(() => {
								// Two-step: first click arms the button — deletion is
								// unrecoverable.
								if (!confirming) {
									confirming = true;
									btn.setButtonText('Confirm delete');
									window.setTimeout(() => {
										confirming = false;
										btn.setButtonText('');
									}, 4000);
									return;
								}
								void (async () => {
									s.customSelectionActions = s.customSelectionActions.filter((a) => a.id !== action.id);
									await this.plugin.saveSettings();
									new Notice(`Deleted "${action.name}"`);
									this.update();
								})();
							})
					);
			}));
		}
		items.push(
			this.row('New custom action', 'Create a custom selection action — prompts, template, insert mode', (el) => {
				new Setting(el)
					.setName('New custom action')
					.setDesc('Create a custom selection action — prompts, template, insert mode')
					.addButton((btn) => {
						btn.setButtonText('New action…').setCta().onClick(() => {
							this.openCustomActionModal();
						});
					});
			})
		);
		return { type: 'group', name: 'Custom selection actions', heading: 'Custom selection actions', items };
	}

	/** Open the custom-action editor. New actions get an id unique across the
	 *  built-ins, existing customs, and the context menu's pseudo-actions
	 *  (which the menu dispatches before processSelection ever sees them);
	 *  edits keep their id. */
	private openCustomActionModal(existing?: CustomSelectionAction): void {
		const taken = new Set([
			...Object.keys(SELECTION_ACTIONS),
			'chat',
			'rewrite-diff',
			...this.plugin.settings.customSelectionActions.map((a) => a.id),
		]);
		new CustomActionEditorModal(this.app, (result) => {
			void (async () => {
				const actions = this.plugin.settings.customSelectionActions;
				const idx = actions.findIndex((a) => a.id === result.id);
				if (idx >= 0) actions[idx] = result;
				else actions.push(result);
				await this.plugin.saveSettings();
				this.update();
			})();
		}, existing, taken).open();
	}

	/**
	 * "Advanced request parameters" — per-provider (and per-model) overrides
	 * for the sampling knobs, a reasoning-effort selector, Ollama's
	 * local-server options (context window, GPU layers, threads, keep-alive),
	 * and a raw extra-body JSON passthrough. Rendered inside a <details> so
	 * the ~30 provider cards stay compact. A Scope picker at the top switches
	 * every row between the provider-level defaults and one model's overrides
	 * (config.perModelOverrides[modelId]); model values win over provider
	 * defaults at request time. Fields the provider's API doesn't accept
	 * (capability matrix — see the vault note "Provider Parameter Matrix")
	 * are disabled with a hint; the wire format drops them too, so a stale
	 * value can never 400 a strict API. Numeric rows and the extra-body JSON
	 * validate on change — out-of-range values still save (tinkerer override)
	 * but the row description flags them.
	 */
	private buildAdvancedParams(el: HTMLElement, def: ProviderDefinition, config: ProviderConfig): void {
		if (!config.enabled) return;
		const caps = getParamCaps(def.id);
		const isOllama = def.id === 'ollama';

		const totalOverrides = (): number =>
			countOverrideFields(config.modelOverrides)
			+ Object.values(config.perModelOverrides ?? {}).reduce((sum, rec) => sum + countOverrideFields(rec), 0);

		const details = el.createEl('details', { cls: 'ai-advanced-params' });
		// Collapsed state carries the signal — the "(N set)" pill tells you a
		// card is tuned without opening it, and updates live as fields change.
		const summaryEl = details.createEl('summary', { text: 'Advanced request parameters' });
		const updateSummary = (): void => {
			const n = totalOverrides();
			summaryEl.empty();
			summaryEl.appendText('Advanced request parameters');
			if (n > 0) summaryEl.createSpan({ cls: 'ai-advanced-count', text: `${n} set` });
		};
		updateSummary();

		const save = async (): Promise<void> => {
			await this.plugin.saveSettings();
			updateSummary();
		};

		const toText = (n: number | undefined): string => (n === undefined ? '' : String(n));
		const toNum = (v: string): number | undefined => {
			const t = v.trim();
			if (!t) return undefined;
			const n = Number(t);
			return Number.isFinite(n) ? n : undefined;
		};
		const hasOverrides = (rec: ModelOverrides | undefined): boolean =>
			!!rec && Object.values(rec).some((v) => v !== undefined);

		// Selected scope: '' = provider defaults; otherwise a model id. Lives
		// outside the row builder so switching scope only rebuilds the rows
		// inside this <details>, not the whole settings tab.
		let scopeId = '';
		const container = details.createDiv();
		const renderRows = (): void => {
			container.empty();

			// The record these rows read/write for the selected scope. Reading
			// an untouched scope must not materialize an empty record into
			// data.json — only edit() creates one, lazily.
			const peek = (): ModelOverrides | undefined =>
				scopeId ? config.perModelOverrides?.[scopeId] : config.modelOverrides;
			const edit = (): ModelOverrides => {
				if (scopeId) {
					if (!config.perModelOverrides) config.perModelOverrides = {};
					return config.perModelOverrides[scopeId] ?? (config.perModelOverrides[scopeId] = {});
				}
				return config.modelOverrides ?? (config.modelOverrides = {});
			};

			// Scope picker — drives every row below.
			const providerInstance = this.plugin.providerRegistry.getProvider(def.id);
			const modelList = providerInstance?.models || def.models;
			new Setting(container)
				.setName('Scope')
				.setDesc('Which record these rows edit: the provider default, or one model. Model values win over the provider default; a * marks scopes that have overrides.')
				.addDropdown((dd) => {
					dd.addOption('', `Provider default${hasOverrides(config.modelOverrides) ? ' *' : ''}`);
					for (const m of modelList) {
						const marked = hasOverrides(config.perModelOverrides?.[m.id]) ? ' *' : '';
						dd.addOption(m.id, `${m.name}${marked}`);
					}
					dd.setValue(scopeId);
					dd.onChange((v) => {
						scopeId = v;
						renderRows();
					});
				})
				.addExtraButton((btn) => {
					btn.setIcon('rotate-ccw')
						.setTooltip('Clear every override in this scope')
						.setDisabled(!hasOverrides(peek()))
						.onClick(async () => {
							if (scopeId) {
								delete config.perModelOverrides?.[scopeId];
								if (config.perModelOverrides && Object.keys(config.perModelOverrides).length === 0) {
									delete config.perModelOverrides;
								}
							} else {
								config.modelOverrides = undefined;
							}
							await save();
							renderRows();
						});
				});

			container.createEl('p', {
				cls: 'ai-setting-hint',
				text: 'Per-provider overrides for the request body. Empty fields fall back to the global generation settings; fields this API does not accept are never sent.',
			});

			// A text row with a numeric override. `supported=false` renders the
			// row disabled with a capability hint instead of an editable field.
			// `range` (when given) validates on change: out-of-range values are
			// still saved, but the description says so.
			const numRow = (
				name: string,
				desc: string,
				get: () => number | undefined,
				set: (n: number | undefined) => void,
				supported: boolean,
				range?: { min?: number; max?: number }
			): void => {
				const base = supported ? desc : `${desc} Not supported by ${def.name} — the field is dropped.`;
				const setting = new Setting(container)
					.setName(name)
					.setDesc(base);
				setting.addText((t) => {
					t.setPlaceholder('Default').setValue(toText(get()));
					if (!supported) t.setDisabled(true);
					const applyRangeWarning = (v: string): void => {
						const n = toNum(v);
						const outside = range !== undefined && n !== undefined
							&& ((range.min !== undefined && n < range.min)
								|| (range.max !== undefined && n > range.max));
						setting.setDesc(outside ? `${base} (outside documented range)` : base);
					};
					applyRangeWarning(toText(get()));
					t.onChange(async (v) => {
						set(toNum(v));
						applyRangeWarning(v);
						await save();
					});
				});
			};

			new Setting(container)
				.setName('Omit temperature')
				.setDesc('Never send temperature. Required escape hatch for models that reject sampling params (OpenAI reasoning models, post-Opus-4.6 Claude).')
				.addToggle((t) => {
					t.setValue(peek()?.omitTemperature === true);
					t.onChange(async (v) => {
						edit().omitTemperature = v || undefined;
						await save();
					});
				});

			// Anthropic and Z.ai only accept 0–1 server-side — their cards flag
			// anything above 1. Kimi pins temperature entirely (caps.temperature
			// false) — the row is disabled, the wire never sends it.
			const tempMax = def.id === 'anthropic' || def.id === 'zai-glm' || def.id === 'zai' ? 1 : 2;
			numRow('Temperature', '0–2 (Anthropic and Z.ai only accept 0–1). Overrides the global value.', () => peek()?.temperature, (n) => { edit().temperature = n; }, caps.temperature !== false, { min: 0, max: tempMax });
			numRow('Max tokens', 'Maximum response length. Overrides the global value.', () => peek()?.maxTokens, (n) => { edit().maxTokens = n; }, true, { min: 1 });
			numRow('Top P', '0–1. Nucleus-sampling cutoff.', () => peek()?.topP, (n) => { edit().topP = n; }, caps.topP, { min: 0, max: 1 });
			numRow('Top K', 'Only sample from the K most likely tokens.', () => peek()?.topK, (n) => { edit().topK = n; }, caps.topK, { min: 1 });
			numRow('Min P', '0–1. Discard tokens below this probability share of the top token.', () => peek()?.minP, (n) => { edit().minP = n; }, caps.minP, { min: 0, max: 1 });
			numRow('Seed', 'Best-effort deterministic sampling.', () => peek()?.seed, (n) => { edit().seed = n; }, caps.seed);
			numRow('Frequency penalty', '-2–2. Penalize tokens by how often they already appeared.', () => peek()?.frequencyPenalty, (n) => { edit().frequencyPenalty = n; }, caps.frequencyPenalty, { min: -2, max: 2 });
			numRow('Presence penalty', '-2–2. Penalize tokens that appeared at all.', () => peek()?.presencePenalty, (n) => { edit().presencePenalty = n; }, caps.presencePenalty, { min: -2, max: 2 });
			numRow('Repetition penalty', '1 = off; 1.1–1.2 common. Open-model servers only.', () => peek()?.repetitionPenalty, (n) => { edit().repetitionPenalty = n; }, caps.repetitionPenalty, { min: 0, max: 2 });

			new Setting(container)
				.setName('Stop sequences')
				.setDesc(caps.stop
					? 'Comma-separated — generation halts when one is produced.'
					: `Not supported by ${def.name} — the field is dropped.`)
				.addText((t) => {
					t.setPlaceholder('E.g. User:, ###').setValue(peek()?.stopSequences ?? '');
					if (!caps.stop) t.setDisabled(true);
					t.onChange(async (v) => {
						edit().stopSequences = v.trim() || undefined;
						await save();
					});
				});

			// Reasoning effort — translated into each provider's dialect at
			// request time (see getReasoningWire). LM Studio, Chutes and
			// Replicate document no reasoning control on their compat
			// endpoints, so the row is disabled with a hint there.
			const reasoningSupported = def.id !== 'lmstudio' && def.id !== 'chutes' && def.id !== 'replicate';
			const reasoningDesc = 'Maps to each provider\u2019s dialect (reasoning_effort, thinking, think). While active, sampling params the provider rejects under reasoning are suppressed.'
				+ (def.id === 'anthropic'
					? ' Anthropic sends thinking budgets (low 2048, medium 8192, high 16384, max 32768) — Max tokens must exceed the budget or the request goes out without it.'
					: '');
			new Setting(container)
				.setName('Reasoning effort')
				.setDesc(reasoningSupported
					? reasoningDesc
					: `${reasoningDesc} Not supported by ${def.name} — the field is dropped.`)
				.addDropdown((dd) => {
					dd.addOption('', 'Default');
					dd.addOption('off', 'Off');
					dd.addOption('minimal', 'Minimal');
					dd.addOption('low', 'Low');
					dd.addOption('medium', 'Medium');
					dd.addOption('high', 'High');
					dd.addOption('max', 'Max');
					dd.setValue(peek()?.reasoningEffort ?? '');
					if (!reasoningSupported) dd.setDisabled(true);
					dd.onChange(async (v) => {
						edit().reasoningEffort = (v || undefined) as ReasoningEffort | undefined;
						await save();
					});
				});

			if (isOllama) {
				container.createEl('p', {
					cls: 'ai-setting-hint',
					text: 'Local-server options — sent via ollama\u2019s native options{} object. These are the knobs that would otherwise require a modelfile.',
				});
				numRow('Context window (num_ctx)', 'Tokens of context. Server default adapts to VRAM (~4096 floor); raising it raises VRAM use.', () => peek()?.numCtx, (n) => { edit().numCtx = n; }, true, { min: 128 });
				numRow('GPU layers (num_gpu)', 'Model layers offloaded to the GPU. 0 forces CPU; omit to let Ollama schedule.', () => peek()?.numGpu, (n) => { edit().numGpu = n; }, true, { min: 0 });
				numRow('CPU threads (num_thread)', 'Compute threads. Omit to auto-detect.', () => peek()?.numThread, (n) => { edit().numThread = n; }, true, { min: 1 });
				new Setting(container)
					.setName('Keep alive')
					.setDesc('How long the model stays loaded after a request: "30m", "24h", -1 forever, 0 unload immediately. Default 5m.')
					.addText((t) => {
						t.setPlaceholder('Default (5m)').setValue(peek()?.keepAlive ?? '');
						t.onChange(async (v) => {
							edit().keepAlive = v.trim() || undefined;
							await save();
						});
					});
			}

			const extraBaseDesc = 'Raw JSON object merged into the request body last — the escape hatch for provider-specific fields (thinking toggles, reasoning_effort, routing, ttl). Reserved keys: model, messages, stream, stream_options.';
			const extraSetting = new Setting(container)
				.setName('Extra body JSON')
				.setDesc(extraBaseDesc);
			extraSetting.addTextArea((t) => {
				t.setPlaceholder('{\n  "thinking": { "type": "disabled" }\n}')
					.setValue(peek()?.extraBodyJson ?? '');
				t.inputEl.rows = 3;
				t.inputEl.addClass('ai-extra-body-json');
				// Parse on change — broken JSON is saved as typed but flagged,
				// because the request path silently ignores it.
				const applyJsonWarning = (v: string): void => {
					const trimmed = v.trim();
					let invalid = false;
					if (trimmed) {
						try {
							JSON.parse(trimmed);
						} catch {
							invalid = true;
						}
					}
					extraSetting.setDesc(invalid ? `${extraBaseDesc} (invalid JSON — ignored until fixed)` : extraBaseDesc);
				};
				applyJsonWarning(peek()?.extraBodyJson ?? '');
				t.onChange(async (v) => {
					edit().extraBodyJson = v.trim() || undefined;
					applyJsonWarning(v);
					await save();
				});
			});
			extraSetting.controlEl.addClass('ai-advanced-params-control');
		};

		renderRows();
	}

	private generationGroup(): SettingDefinitionItem {
		const s = this.plugin.settings;
		return {
			type: 'group',
			name: 'Generation',
			heading: 'Generation',
			items: [
				this.row('Temperature', 'Higher = more creative, lower = more focused (0.0 - 2.0)', (el) => {
					const setting = new Setting(el)
						.setName('Temperature')
						.setDesc('Higher = more creative, lower = more focused (0.0 - 2.0)');
					const syncReadout = this.sliderReadout(setting, s.temperature, (v) => v.toFixed(1));
					setting.addSlider((slider) => {
						slider
							.setLimits(0, 2, 0.1)
							.setValue(s.temperature)
							.onChange(async (val) => {
								syncReadout(val);
								s.temperature = val;
								await this.plugin.saveSettings();
							});
					});
				}),
				this.row('Max tokens', 'Maximum response length', (el) => {
					new Setting(el)
						.setName('Max tokens')
						.setDesc('Maximum response length')
						.addText((text) => {
							text
								.setValue(String(s.maxTokens))
								.onChange(async (val) => {
									const n = parseInt(val, 10);
									if (!isNaN(n) && n > 0) {
										s.maxTokens = n;
										await this.plugin.saveSettings();
									}
								});
						});
				}),
				this.row('Curtis identity (read-only)', 'The non-negotiable core prompt — defines who curtis is, what tools are available, and the operating principles. Appended automatically to every conversation.', (el) => {
					new Setting(el)
						.setName('Curtis identity (read-only)')
						.setDesc('The non-negotiable core prompt — defines who curtis is, what tools are available, and the operating principles. Appended automatically to every conversation.')
						.addTextArea((text) => {
							text
								.setValue(CORE_SYSTEM_PROMPT)
								.setDisabled(true);
							text.inputEl.rows = 10;
							text.inputEl.addClass('ai-system-prompt-core');
						});
				}),
				this.row('Additional instructions', 'Your own context layered on top of curtis\'s core — project specifics, tone preferences, domain knowledge. Optional.', (el) => {
					new Setting(el)
						.setName('Additional instructions')
						.setDesc('Your own context layered on top of curtis\'s core — project specifics, tone preferences, domain knowledge. Optional.')
						.addTextArea((text) => {
							text
								.setPlaceholder('E.g., "you are my rust coding assistant. Prefer the 2021 edition. Always explain lifetimes when introducing them."')
								.setValue(s.systemPrompt)
								.onChange(async (val) => {
									s.systemPrompt = val;
									await this.plugin.saveSettings();
								});
							text.inputEl.rows = 4;
						})
						.addExtraButton((btn) => {
							btn.setIcon('reset')
								.setTooltip('Reset to defaults')
								.onClick(async () => {
									s.systemPrompt = '';
									await this.plugin.saveSettings();
									this.update();
								});
						});
				}),
				this.row('Stream responses', 'Show AI responses as they are generated', (el) => {
					new Setting(el)
						.setName('Stream responses')
						.setDesc('Show AI responses as they are generated')
						.addToggle((toggle) => {
							toggle.setValue(s.streamResponse);
							toggle.onChange(async (val) => {
								s.streamResponse = val;
								await this.plugin.saveSettings();
							});
						});
				}),
				this.row('Show token usage', 'Display token counts after each response', (el) => {
					new Setting(el)
						.setName('Show token usage')
						.setDesc('Display token counts after each response')
						.addToggle((toggle) => {
							toggle.setValue(s.showTokenUsage);
							toggle.onChange(async (val) => {
								s.showTokenUsage = val;
								await this.plugin.saveSettings();
							});
						});
				}),
				this.row('Extended thinking (Anthropic)', 'Show Claude\'s reasoning before the final answer.', (el) => {
					new Setting(el)
						.setName('Extended thinking (Anthropic)')
						.setDesc('Show Claude\'s reasoning before the final answer.')
						.addToggle((toggle) => {
							toggle.setValue(s.anthropicExtendedThinking);
							toggle.onChange(async (val) => {
								s.anthropicExtendedThinking = val;
								await this.plugin.saveSettings();
							});
						});
				}),
				this.row('Thinking budget (tokens)', 'Token budget for Anthropic extended thinking (1024\u201332000).', (el) => {
					new Setting(el)
						.setName('Thinking budget (tokens)')
						.setDesc('Token budget for Anthropic extended thinking (1024\u201332000).')
						.addText((text) => {
							text
								.setValue(String(s.anthropicThinkingBudget))
								.onChange(async (val) => {
									const n = parseInt(val, 10);
									if (!isNaN(n) && n > 0) {
										s.anthropicThinkingBudget = n;
										await this.plugin.saveSettings();
									}
								});
						});
				}),
			],
		};
	}

	// ---- Inline autocomplete ----

	private autocompleteGroup(): SettingDefinitionItem {
		const s = this.plugin.settings;
		const descFor = (base: string): string => {
			if (!s.enableAutocomplete) return base;
			const pid = s.autocompleteProviderId || s.activeProvider;
			const config = s.providerConfigs[pid];
			if (pid && config && !config.enabled) return `${base} — warning: the provider is disabled`;
			return base;
		};
		return {
			type: 'group',
			name: 'Autocomplete',
			heading: 'Autocomplete',
			items: [
				this.row(
					'Inline suggestions',
					'Ghost-text suggestions while typing in notes. Off by default — a suggestion request sends the text around the caret to the selected provider each time you pause. Desktop only.',
					(el) => {
						new Setting(el)
							.setName('Inline suggestions')
							.setDesc('Ghost-text suggestions while typing in notes. Off by default — a suggestion request sends the text around the caret to the selected provider each time you pause. Desktop only.')
							.addToggle((toggle) => {
								toggle.setValue(s.enableAutocomplete);
								toggle.onChange(async (val) => {
									s.enableAutocomplete = val;
									await this.plugin.saveSettings();
									this.update();
								});
							});
					}
				),
				this.row(
					'Autocomplete model',
					descFor(`Currently: ${this.autocompleteTargetLabel()}. Small, fast models work best — requests are capped at 60 tokens.`),
					(el) => {
						const setting = new Setting(el)
							.setName('Autocomplete model')
							.setDesc(descFor(`Currently: ${this.autocompleteTargetLabel()}. Small, fast models work best — requests are capped at 60 tokens.`))
							.addButton((btn) => {
								btn.setButtonText('Choose model').onClick(() => {
									const entries = buildModelPickerEntries(this.plugin.providerRegistry.getAllEnabledProviders());
									new ModelPickerModal(
										this.app,
										entries,
										s.autocompleteProviderId && s.autocompleteModelId
											? `${s.autocompleteProviderId}|${s.autocompleteModelId}`
											: undefined,
										(providerId, modelId) => {
											s.autocompleteProviderId = providerId;
											s.autocompleteModelId = modelId;
											void this.plugin.saveSettings();
											this.update();
										}
									).open();
								});
							})
							.addExtraButton((btn) => {
								btn.setIcon('reset').setTooltip('Follow the active chat model').onClick(async () => {
									s.autocompleteProviderId = '';
									s.autocompleteModelId = '';
									await this.plugin.saveSettings();
									this.update();
								});
							});
						void setting;
					}
				),
				this.row('Accept key', 'Key that inserts a visible suggestion. Tab only takes over while a suggestion is showing.', (el) => {
					new Setting(el)
						.setName('Accept key')
						.setDesc('Key that inserts a visible suggestion. Tab only takes over while a suggestion is showing.')
						.addDropdown((dropdown) => {
							dropdown
								.addOption('tab', 'Tab')
								.addOption('alt-tab', 'Alt+Tab')
								.addOption('ctrl-arrow', 'Ctrl+Right arrow')
								.setValue(s.autocompleteAcceptKey)
								.onChange(async (val) => {
									if (val === 'tab' || val === 'alt-tab' || val === 'ctrl-arrow') {
										s.autocompleteAcceptKey = val;
										await this.plugin.saveSettings();
									}
								});
						});
				}),
				this.row('Debounce', 'How long typing must pause before a suggestion request fires (milliseconds).', (el) => {
					const setting = new Setting(el)
						.setName('Debounce')
						.setDesc('How long typing must pause before a suggestion request fires (milliseconds).');
					const syncReadout = this.sliderReadout(setting, s.autocompleteDebounceMs, (v) => `${v}ms`);
					setting.addSlider((slider) => {
						slider
							.setLimits(200, 1000, 50)
							.setValue(s.autocompleteDebounceMs)
							.onChange(async (val) => {
								syncReadout(val);
								s.autocompleteDebounceMs = val;
								await this.plugin.saveSettings();
							});
					});
				}),
				this.row('Minimum characters', 'Characters typed since the last space before suggestions start.', (el) => {
					const setting = new Setting(el)
						.setName('Minimum characters')
						.setDesc('Characters typed since the last space before suggestions start.');
					const syncReadout = this.sliderReadout(setting, s.autocompleteMinChars, (v) => String(v));
					setting.addSlider((slider) => {
						slider
							.setLimits(1, 8, 1)
							.setValue(s.autocompleteMinChars)
							.onChange(async (val) => {
								syncReadout(val);
								s.autocompleteMinChars = val;
								await this.plugin.saveSettings();
							});
					});
				}),
			],
		};
	}

	/** Human label for the autocomplete provider/model pair, or the follow-
	 *  active fallback. Used in the model row description. */
	private autocompleteTargetLabel(): string {
		const s = this.plugin.settings;
		const providerId = s.autocompleteProviderId || s.activeProvider;
		const modelId = s.autocompleteModelId || s.activeModel;
		if (!providerId || !modelId) return 'no model available';
		const provider = this.plugin.providerRegistry.getProvider(providerId);
		return `${provider?.name ?? providerId} — ${modelId}`;
	}

	// ---- Agent ----

	private agentGroup(): SettingDefinitionItem {
		const s = this.plugin.settings;
		const descFor = (base: string): string => {
			if (!s.enableAgent) return base;
			const pid = s.agentProviderId || s.activeProvider;
			const config = s.providerConfigs[pid];
			if (pid && config && !config.enabled) return `${base} — warning: the provider is disabled`;
			return base;
		};
		return {
			type: 'group',
			name: 'Agent',
			heading: 'Agent',
			items: [
				this.row('Enable agent mode', 'Let the AI call tools to read/create/modify your vault notes. Works with every major provider, cloud and local — the model itself must support tool calling.', (el) => {
					new Setting(el)
						.setName('Enable agent mode')
						.setDesc('Let the AI call tools to read/create/modify your vault notes. Works with every major provider, cloud and local — the model itself must support tool calling.')
						.addToggle((toggle) => {
							toggle.setValue(s.enableAgent);
							toggle.onChange(async (val) => {
								s.enableAgent = val;
								await this.plugin.saveSettings();
							});
						});
				}),
				this.row(
					'Agent model',
					descFor(`Currently: ${this.agentModelTargetLabel()}. Tool-calling turns — agent mode, leader chats, terminal commands — run on this model; plain chat keeps the chat model. Pick one that supports tool calling. A named agent bound to a chat keeps its own model.`),
					(el) => {
						const setting = new Setting(el)
							.setName('Agent model')
							.setDesc(descFor(`Currently: ${this.agentModelTargetLabel()}. Tool-calling turns — agent mode, leader chats, terminal commands — run on this model; plain chat keeps the chat model. Pick one that supports tool calling. A named agent bound to a chat keeps its own model.`))
							.addButton((btn) => {
								btn.setButtonText('Choose model').onClick(() => {
									const entries = buildModelPickerEntries(this.plugin.providerRegistry.getAllEnabledProviders());
									new ModelPickerModal(
										this.app,
										entries,
										s.agentProviderId && s.agentModelId
											? `${s.agentProviderId}|${s.agentModelId}`
											: undefined,
										(providerId, modelId) => {
											s.agentProviderId = providerId;
											s.agentModelId = modelId;
											void this.plugin.saveSettings();
											this.update();
										}
									).open();
								});
							})
							.addExtraButton((btn) => {
								btn.setIcon('reset').setTooltip('Follow the chat model').onClick(async () => {
									s.agentProviderId = '';
									s.agentModelId = '';
									await this.plugin.saveSettings();
									this.update();
								});
							});
						void setting;
					}
				),
				this.row('Max tool calls per message', 'Safety limit — prevents infinite agent loops', (el) => {
					new Setting(el)
						.setName('Max tool calls per message')
						.setDesc('Safety limit — prevents infinite agent loops')
						.addDropdown((dd) => {
							for (const n of [1, 3, 5, 10]) {
								dd.addOption(String(n), String(n));
							}
							dd.setValue(String(s.agentMaxTurns));
							dd.onChange(async (val) => {
								s.agentMaxTurns = Number(val);
								await this.plugin.saveSettings();
							});
						});
				}),
				this.row('Max follower agents', 'Swarm — how many follower agents a leader chat may spawn per message. Toggle leader mode from the chat pane menu or with /leader; each follower is a full agent run with its own conversation.', (el) => {
					new Setting(el)
						.setName('Max follower agents')
						.setDesc('Swarm — how many follower agents a leader chat may spawn per message. Toggle leader mode from the chat pane menu or with /leader; each follower is a full agent run with its own conversation.')
						.addDropdown((dd) => {
							for (const n of [1, 2, 3, 4]) {
								dd.addOption(String(n), String(n));
							}
							dd.setValue(String(s.swarmMaxFollowers));
							dd.onChange(async (val) => {
								s.swarmMaxFollowers = Number(val);
								await this.plugin.saveSettings();
							});
						});
				}),
				this.row('Enable web tools', 'Adds web_search (duckduckgo) + read_URL (jina reader) tools so the AI can look things up online. Free, no API key. Requires agent mode on. Off by default — curtis is vault-first.', (el) => {
					new Setting(el)
						.setName('Enable web tools')
						.setDesc('Adds web_search (duckduckgo) + read_URL (jina reader) tools so the AI can look things up online. Free, no API key. Requires agent mode on. Off by default — curtis is vault-first.')
						.addToggle((toggle) => {
							toggle.setValue(s.enableWebSearch);
								toggle.onChange(async (val) => {
									s.enableWebSearch = val;
									await this.plugin.saveSettings();
									// Hot-reload the tool registry so the change takes effect on
									// the next agent send — no Obsidian reload required.
									this.plugin.toolRegistry.setWebToolsEnabled(val);
									new Notice(val
										? 'Web tools enabled'
										: 'Web tools disabled');
								});
							});
					}),
					this.row('Import chats from other AI tools', 'Bring conversations from ChatGPT, Claude, or any role-labeled export into Curtis. Auto-detects official data exports (.json or .zip), .curt files, and generic markdown transcripts. Also available as a command and via drag-and-drop onto the chat.', (el) => {
						new Setting(el)
							.setName('Import chats from other AI tools')
							.setDesc('Bring conversations from ChatGPT, Claude, or any role-labeled export into Curtis. Auto-detects official data exports (.json or .zip), .curt files, and generic markdown transcripts.')
							.addButton((btn) => {
								btn.setButtonText('Import…').setCta().onClick(() => openImportDialog(this.plugin));
							});
					}),
					this.row('Export all chats as .curt', 'Download every conversation as portable .curt files in one zip — for backup, moving to another vault or machine, or handing to Curtis Porter. Re-importing the zip skips conversations already present.', (el) => {
						new Setting(el)
							.setName('Export all chats as .curt')
							.setDesc('Download every conversation as portable .curt files in one zip — for backup, moving to another vault or machine, or handing to Curtis Porter.')
							.addButton((btn) => {
								btn.setButtonText('Export all…').onClick(() =>
									downloadConversationsCurtZip(this.plugin.conversationStore.getAllConversations(), this.plugin.manifest.version)
								);
							});
					}),
				],
			};
		}

	/** Human label for the agent-mode provider/model pair, or the follow-chat
	 *  fallback. Used in the agent model row description. */
	private agentModelTargetLabel(): string {
		const s = this.plugin.settings;
		const providerId = s.agentProviderId || s.activeProvider;
		const modelId = s.agentModelId || s.activeModel;
		if (!providerId || !modelId) return 'no model available';
		const provider = this.plugin.providerRegistry.getProvider(providerId);
		return `${provider?.name ?? providerId} — ${modelId}`;
	}

	// ---- Agents (named workers) ----

	private agentsGroup(): SettingDefinitionItem {
		const s = this.plugin.settings;
		const items: SettingDefinitionRender[] = [
			this.row('Agents', undefined, (el) => {
				const note = el.createEl('p', { cls: 'ai-setting-hint' });
				note.setText(
					'Named workers: a persona + model + tool permissions bound to any chat (/agent or the pill in the chat header) or spawned by a swarm leader. An agent narrows what the global toggles allow — it can never widen it.'
				);
			}),
			this.row('Claims profile', undefined, (el) => {
				new Setting(el)
					.setName('Claims profile')
					.setDesc(`A personal context profile (${s.pcpFilePath}) with claim sections — PEP-P personality, PEP-D developer, etc. Each agent sees only the classes its consent policy allows.`)
					.addButton((btn) => {
						btn.setButtonText('Open / create…').onClick(() => {
							void this.plugin.agents.openClaimsFile();
						});
					});
			}),
		];
		for (const agent of s.agents) {
			const providerName = this.plugin.providerRegistry.getProvider(agent.providerId)?.name ?? agent.providerId;
			const caps: string[] = [];
			caps.push(agent.tools.vault ? 'vault' : 'no vault');
			caps.push(agent.tools.web ? 'web' : 'no web');
			caps.push(agent.tools.mcp ? 'MCP' : 'no MCP');
			if (agent.memory === 'off') caps.push('memory off');
			const desc = `${providerName} · ${agent.modelId} · ${caps.join(', ')}`;
			items.push(this.row(`Agent ${agent.name}`, desc, (el) => {
				let confirming = false;
				new Setting(el)
					.setName(`${agent.emoji} ${agent.name}`)
					.setDesc(desc)
					.addButton((btn) =>
						btn.setIcon('pencil').setTooltip('Edit agent').onClick(() => {
							new AgentEditorModal(this.app, this.plugin, agent, () => this.update()).open();
						})
					)
					.addButton((btn) =>
						btn
							.setIcon('trash')
							.setTooltip('Delete agent')
							.onClick(() => {
								// Two-step: first click arms the button — an agent may
								// be bound to several chats and this is unrecoverable.
								if (!confirming) {
									confirming = true;
									btn.setButtonText('Confirm delete');
									window.setTimeout(() => {
										confirming = false;
										btn.setButtonText('');
									}, 4000);
									return;
								}
								this.plugin.agents.deleteAgent(agent.id);
								new Notice(`Deleted agent "${agent.name}" — chats bound to it fall back to the default assistant`);
								this.update();
							})
					);
			}));
		}
		items.push(
			this.row('New agent', 'Create a named agent — persona, model routing, tool access', (el) => {
				new Setting(el)
					.setName('New agent')
					.setDesc('Create a named agent — persona, model routing, tool access')
					.addButton((btn) => {
						btn.setButtonText('New agent…').setCta().onClick(() => {
							new AgentEditorModal(this.app, this.plugin, undefined, () => this.update()).open();
						});
					});
			})
		);
		return {
			type: 'group',
			name: 'Agents',
			heading: 'Agents',
			items,
		};
	}

	// ---- Scheduled runs ----

	/** Human line for a job card: schedule · runner · outcome. */
	private scheduledJobDesc(job: CurtisSettings['scheduledJobs'][number]): string {
		const runner = job.agentName || 'default assistant';
		const parts = [`${describeSchedule(job.schedule)} · ${runner}`];
		if (job.lastStatus === 'error') {
			parts.push(`last run failed: ${(job.lastError ?? '').slice(0, 80)}`);
		} else if (job.lastFiredAt) {
			const when = new Date(job.lastFiredAt).toLocaleString(undefined, {
				month: 'short',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit',
			});
			parts.push(`last run ok ${when}`);
		} else {
			parts.push('never run');
		}
		if (this.plugin.scheduler?.isRunning(job.id)) parts.push('running now…');
		return parts.join(' · ');
	}

	private scheduledRunsGroup(): SettingDefinitionItem {
		const s = this.plugin.settings;
		const items: SettingDefinitionRender[] = [
			this.row('Scheduled runs', undefined, (el) => {
				const note = el.createEl('p', { cls: 'ai-setting-hint' });
				note.setText(
					'Put an agent on a cadence: a task prompt (with vault tools) fires headlessly and each run lands as a Markdown note. Runs happen only while Obsidian is open — a daily job missed while closed fires once on the next launch; interval runs re-anchor from that catch-up.'
				);
			}),
			this.row('Run notes folder', 'Where each run writes its note — frontmatter carries the job, status, and duration; the body is the answer or the error', (el) => {
				new Setting(el)
					.setName('Run notes folder')
					.setDesc('Where each run writes its note — frontmatter carries the job, status, and duration; the body is the answer or the error')
					.addText((text) => {
						text.setPlaceholder('AI/Scheduled')
							.setValue(s.scheduledOutputFolder)
							.onChange(async (val) => {
								s.scheduledOutputFolder = val.trim();
								await this.plugin.saveSettings();
							});
					});
			}),
		];

		for (const job of s.scheduledJobs) {
			const desc = this.scheduledJobDesc(job);
			items.push(this.row(`Scheduled run ${job.name}`, desc, (el) => {
				let confirming = false;
				new Setting(el)
					.setName(`${job.enabled ? '' : '⏸ '}${job.name}`)
					.setDesc(desc)
					.addButton((btn) =>
						btn.setIcon('play').setTooltip('Run now').onClick(() => {
							this.plugin.scheduler?.runJobNow(job.id);
							// Status ("running now…") lands on the next re-render.
							window.setTimeout(() => this.update(), 500);
						})
					)
					.addButton((btn) =>
						btn.setIcon('pencil').setTooltip('Edit run').onClick(() => {
							new ScheduledJobModal(this.plugin, (result) => {
								void (async () => {
									const target = s.scheduledJobs.find((j) => j.id === result.id);
									if (target) Object.assign(target, result);
									await this.plugin.saveSettings();
									this.update();
								})();
							}, job).open();
						})
					)
					.addButton((btn) =>
						btn
							.setIcon('trash')
							.setTooltip('Delete run')
							.onClick(() => {
								// Two-step: first click arms the button — past runs'
								// notes stay in the vault, but the job is unrecoverable.
								if (!confirming) {
									confirming = true;
									btn.setButtonText('Confirm delete');
									window.setTimeout(() => {
										confirming = false;
										btn.setButtonText('');
									}, 4000);
									return;
								}
								void (async () => {
									s.scheduledJobs = s.scheduledJobs.filter((j) => j.id !== job.id);
									await this.plugin.saveSettings();
									new Notice(`Deleted scheduled run "${job.name}"`);
									this.update();
								})();
							})
					);
			}));
		}

		items.push(
				this.row('New scheduled run', 'Put a task on a cadence — daily at a time, or on a repeating interval', (el) => {
					new Setting(el)
						.setName('New scheduled run')
						.setDesc('Put a task on a cadence — daily at a time, or on a repeating interval')
					.addButton((btn) => {
						btn.setButtonText('New scheduled run…').setCta().onClick(() => {
							new ScheduledJobModal(this.plugin, (result) => {
								void (async () => {
									s.scheduledJobs.push({ ...result, createdAt: Date.now() });
									await this.plugin.saveSettings();
									this.update();
								})();
							}).open();
						});
					});
			})
		);

		return { type: 'group', name: 'Scheduled runs', heading: 'Scheduled runs', items };
	}

	// ---- Terminal ----

	private terminalGroup(): SettingDefinitionItem {
		const s = this.plugin.settings;
		return {
			type: 'group',
			name: 'Terminal',
			heading: 'Terminal',
			items: [
				this.row('Terminal memory', 'Remember terminal commands across panes and sessions: arrow-up and Ctrl+R recall them, Tab completes from them, and the last working directory is restored on open. A command typed with a leading space is never remembered. Off = each pane keeps its own history until it closes.', (el) => {
					new Setting(el)
						.setName('Terminal memory')
						.setDesc('Remember terminal commands across panes and sessions: arrow-up and Ctrl+R recall them, Tab completes from them, and the last working directory is restored on open. A command typed with a leading space is never remembered. Off = each pane keeps its own history until it closes.')
						.addToggle((toggle) => {
							toggle.setValue(s.terminalMemory);
							toggle.onChange(async (val) => {
								s.terminalMemory = val;
								await this.plugin.saveSettings();
							});
						});
				}),
				this.row('Enable command tool', 'Adds run_command to agent mode: the AI runs shell commands on desktop, or vault commands (ls, cat, grep, find…) on mobile, with your approval per command. Off by default — Curtis is vault-first. Requires agent mode on.', (el) => {
					new Setting(el)
						.setName('Enable command tool')
						.setDesc('Adds run_command to agent mode: the AI runs shell commands on desktop, or vault commands (ls, cat, grep, find…) on mobile, with your approval per command. Off by default — Curtis is vault-first. Requires agent mode on.')
						.addToggle((toggle) => {
							toggle.setValue(s.enableCommands);
							toggle.onChange(async (val) => {
								s.enableCommands = val;
								await this.plugin.saveSettings();
								// Hot-reload the tool registry so the change takes
								// effect on the next agent send — no reload needed.
								this.plugin.toolRegistry.setCommandToolsEnabled(val);
								new Notice(val ? 'Command tool enabled' : 'Command tool disabled');
							});
						});
				}),
				this.row('Confirm before running commands', 'Show a dialog for every agent-initiated command, with an "always this session" option for commands you trust. Denying tells the model to stop and ask.', (el) => {
					new Setting(el)
						.setName('Confirm before running commands')
						.setDesc('Show a dialog for every agent-initiated command, with an "always this session" option for commands you trust. Denying tells the model to stop and ask.')
						.addToggle((toggle) => {
							toggle.setValue(s.terminalConfirmCommands);
							toggle.onChange(async (val) => {
								s.terminalConfirmCommands = val;
								await this.plugin.saveSettings();
							});
						});
				}),
				this.row('Restrict commands to the vault', 'Refuse a run_command working directory outside the vault root (desktop — mobile vault commands cannot leave the vault by construction). The terminal pane itself is never restricted — this only bounds the AI.', (el) => {
					new Setting(el)
						.setName('Restrict commands to the vault')
						.setDesc('Refuse a run_command working directory outside the vault root (desktop — mobile vault commands cannot leave the vault by construction). The terminal pane itself is never restricted — this only bounds the AI.')
						.addToggle((toggle) => {
							toggle.setValue(s.terminalRestrictToVault);
							toggle.onChange(async (val) => {
								s.terminalRestrictToVault = val;
								await this.plugin.saveSettings();
							});
						});
				}),
				this.row('Shell', "Shell the terminal and run_command use: auto (default), cmd, powershell, pwsh, or a custom executable path. Empty = platform default (cmd on Windows, bash elsewhere).", (el) => {
					new Setting(el)
						.setName('Shell')
						.setDesc("Shell the terminal and run_command use: auto (default), cmd, powershell, pwsh, or a custom executable path. Empty = platform default (cmd on Windows, bash elsewhere).")
						.addText((text) => {
							text.setPlaceholder('Auto')
								.setValue(s.terminalShell)
								.onChange(async (val) => {
									s.terminalShell = val.trim();
									await this.plugin.saveSettings();
								});
						});
				}),
				this.row('Command timeout', 'Seconds before an agent-initiated command is killed (5–300). The terminal pane uses it as its default timeout too.', (el) => {
					const setting = new Setting(el)
						.setName('Command timeout')
						.setDesc('Seconds before an agent-initiated command is killed (5–300). The terminal pane uses it as its default timeout too.');
					const syncReadout = this.sliderReadout(setting, Math.min(300, Math.max(5, s.terminalTimeoutSeconds)), (v) => `${v}s`);
					setting.addSlider((slider) => {
						slider
							.setLimits(5, 300, 5)
							.setValue(Math.min(300, Math.max(5, s.terminalTimeoutSeconds)))
							.onChange(async (val) => {
								syncReadout(val);
								s.terminalTimeoutSeconds = val;
								await this.plugin.saveSettings();
							});
					});
				}),
			],
		};
	}

	// ---- MCP servers ----

	private mcpGroup(): SettingDefinitionItem {
		const s = this.plugin.settings;
		const items: SettingDefinitionRender[] = [
			this.row('MCP servers', undefined, (el) => {
				const hint = el.createEl('p', { cls: 'ai-setting-hint' });
				hint.appendText(
					'MCP (Model Context Protocol) lets Curtis call tools from servers you already run — browsers, databases, APIs — instead of a fixed built-in catalog. '
				);
				hint.createEl('strong', { text: 'Requires agent mode.' });
				hint.appendText(
					' Curtis speaks the Streamable HTTP transport (desktop + mobile); local stdio servers need an HTTP bridge such as mcp-proxy or supergateway.'
				);
			}),
			this.row('Enable MCP', 'Connect to MCP servers and offer their tools alongside the built-in vault tools', (el) => {
				new Setting(el)
					.setName('Enable MCP')
					.setDesc('Connect to MCP servers and offer their tools alongside the built-in vault tools')
					.addToggle((toggle) => {
						toggle.setValue(s.enableMcp);
						toggle.onChange(async (val) => {
							s.enableMcp = val;
							await this.plugin.saveSettings();
							// Connect/disconnect in the background — a slow server
							// must never block the settings tab.
							void this.plugin.mcpManager.setEnabled(val);
							new Notice(val ? 'MCP enabled — connecting servers' : 'MCP disabled');
						});
					});
			}),
		];

		for (const server of s.mcpServers) {
			items.push(this.renderMcpServerCard(server));
		}

		items.push(this.row('Add MCP server', 'Connect to any MCP server over Streamable HTTP', (el) => {
			new Setting(el)
				.setName('Add MCP server')
				.setDesc('Connect to any MCP server over Streamable HTTP')
				.addButton((b) => {
					b.setButtonText('Add')
						.setClass('mod-cta')
						.onClick(() => {
							new McpServerModal(this.app, (result) => {
								void (async () => {
									this.plugin.settings.mcpServers.push(result.config);
									await this.plugin.saveSettings();
									if (s.enableMcp && result.config.enabled) {
										void this.plugin.mcpManager.refreshServer(result.config.id);
									}
									this.update();
								})();
							}).open();
						});
				});
		}));

		return { type: 'group', name: 'MCP servers', heading: 'MCP servers', items };
	}

	// ---- MCP server mode (serve the vault over localhost MCP) ----

	private mcpServerGroup(): SettingDefinitionItem {
		const s = this.plugin.settings;
		const desktop = Platform.isDesktopApp;
		const manager = this.plugin.mcpServerManager;
		// One log line per remote run: `HH:MM · agent · ok, 1234 chars · 4.2s`.
		const remoteRunLine = (r: RemoteRunEntry): string => {
			const at = new Date(r.startedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
			if (!r.ok) return `${at} · ${r.agent} · failed: ${(r.error ?? '').slice(0, 60)}`;
			return `${at} · ${r.agent} · ok, ${r.chars} chars · ${((r.durationMs ?? 0) / 1000).toFixed(1)}s`;
		};
		const items: SettingDefinitionRender[] = [
			this.row('MCP server', undefined, (el) => {
				const hint = el.createEl('p', { cls: 'ai-setting-hint' });
				hint.appendText(
					'Serve this vault as MCP tools on localhost — search, read, semantic search, memory, and (opt-in) writing — so external AI apps like Claude Desktop or coding agents can work with your notes. '
				);
				hint.createEl('strong', { text: 'Desktop only.' });
				hint.appendText(' Binds to 127.0.0.1 and requires a bearer token.');
				hint.appendText(' Agents with "Remote invocation" enabled appear to MCP clients as runnable tools.');
			}),
			this.row('Enable MCP server', 'Let external MCP clients read (and optionally write) this vault on localhost', (el) => {
				new Setting(el)
					.setName('Enable MCP server')
					.setDesc(
						desktop
							? 'Let external MCP clients read (and optionally write) this vault on localhost'
							: 'Desktop only — mobile Obsidian cannot listen on ports'
					)
					.addToggle((toggle) => {
						if (!desktop) toggle.setDisabled(true);
						toggle.setValue(s.enableMcpServer);
						toggle.onChange(async (val) => {
							s.enableMcpServer = val;
							await this.plugin.saveSettings();
							void (async () => {
								try {
									if (val) await manager.start();
									else await manager.stop();
								} catch (e) {
									new Notice(`Curtis MCP server: ${e instanceof Error ? e.message : String(e)}`);
								}
								this.update();
							})();
						});
					});
			}),
		];

		if (!desktop) {
			return { type: 'group', name: 'MCP server', heading: 'MCP server', items };
		}

		const status = manager.status();
		items.push(this.row('Server status', undefined, (el) => {
			new Setting(el).setName('Status').setDesc(status.error ? `Error: ${status.error}` : status.running ? `Running on port ${s.mcpServerPort}` : 'Stopped');
		}));

		items.push(this.row('Recent remote runs', 'Last agent runs started by MCP clients, newest first', (el) => {
			const runs = manager.recentRemoteRuns().slice(0, 5);
			const setting = new Setting(el).setName('Recent remote runs');
			// setDesc text collapses newlines — one br per line instead.
			const lines = runs.length > 0 ? runs.map(remoteRunLine) : ['No remote agent runs yet.'];
			for (let i = 0; i < lines.length; i++) {
				if (i > 0) setting.descEl.createEl('br');
				setting.descEl.appendText(lines[i]);
			}
		}));

		items.push(this.row('Port', 'TCP port the MCP server listens on (localhost only)', (el) => {
			new Setting(el)
				.setName('Port')
				.setDesc('TCP port the MCP server listens on (localhost only)')
				.addText((text) => {
					text.setValue(String(s.mcpServerPort));
					text.onChange(async (val) => {
						const port = Number.parseInt(val, 10);
						if (!Number.isFinite(port) || port < 1024 || port > 65535) return;
						if (port === s.mcpServerPort) return;
						s.mcpServerPort = port;
						await this.plugin.saveSettings();
						if (status.running) {
							try {
								await manager.start(); // restart on the new port
							} catch (e) {
								new Notice(`Curtis MCP server: ${e instanceof Error ? e.message : String(e)}`);
							}
							this.update();
						}
					});
				});
		}));

		items.push(this.row('Allow writes', 'Also expose write_note (create, overwrite, append) to MCP clients', (el) => {
			new Setting(el)
				.setName('Allow writes')
				.setDesc('Also expose write_note (create, overwrite, append) to MCP clients — off by default')
				.addToggle((toggle) => {
					toggle.setValue(s.mcpServerAllowWrites);
					toggle.onChange(async (val) => {
						s.mcpServerAllowWrites = val;
						await this.plugin.saveSettings();
						// Tool list changes with the gate — clients re-fetch it per
						// session, but a running server should reflect it now.
						if (status.running) await manager.syncTools();
						new Notice(val ? 'MCP clients may now write notes' : 'MCP server is now read-only');
					});
				});
		}));

		items.push(this.row('Access token', 'Bearer token MCP clients must present', (el) => {
			new Setting(el)
				.setName('Access token')
				.setDesc(`Bearer token clients must present${s.mcpServerToken ? ` (currently ${s.mcpServerToken.slice(0, 8)}…)` : ' — generated on first start'}`)
				.addButton((b) => {
					b.setButtonText('Copy token').onClick(() => {
						void navigator.clipboard.writeText(s.mcpServerToken).then(() => new Notice('Token copied'));
					});
				})
				.addButton((b) => {
					b.setButtonText('Regenerate').onClick(() => {
						void (async () => {
							s.mcpServerToken = manager.generateToken();
							await this.plugin.saveSettings();
							if (status.running) await manager.start(); // re-bind with the new token
							new Notice('New token generated — update your MCP clients');
							this.update();
						})();
					});
				});
		}));

		items.push(this.row('Connect a client', 'A ready-made registration command for Claude-style clients', (el) => {
			const url = `http://127.0.0.1:${s.mcpServerPort}/mcp`;
			const cmd = `claude mcp add --transport http curtis-vault ${url} --header "Authorization: Bearer ${s.mcpServerToken}"`;
			new Setting(el)
				.setName('Connect a client')
				.setDesc(url)
				.addButton((b) => {
					b.setButtonText('Copy command').onClick(() => {
						void navigator.clipboard.writeText(cmd).then(() => new Notice('Command copied'));
					});
				});
		}));

		return { type: 'group', name: 'MCP server', heading: 'MCP server', items };
	}

	// ---- GCP connector ----

	private gcpGroup(): SettingDefinitionItem {
		const s = this.plugin.settings;
		const items: SettingDefinitionRender[] = [
			this.row('GCP', undefined, (el) => {
				const hint = el.createEl('p', { cls: 'ai-setting-hint' });
				hint.appendText(
					'Connect a Google Cloud project with a service-account key so Curtis can browse its Cloud Storage — list buckets, list objects, read files — as agent tools. '
				);
				hint.createEl('strong', { text: 'Read-only.' });
				hint.appendText(' The key is stored in the OS keychain when available.');
				hint.createEl('br');
				hint.createEl('strong', { text: 'Requires agent mode.' });
			}),
			this.row('Enable GCP connector', 'Offer read-only Cloud Storage tools from your GCP project', (el) => {
				new Setting(el)
					.setName('Enable GCP connector')
					.setDesc('Offer read-only Cloud Storage tools from your GCP project')
					.addToggle((toggle) => {
						toggle.setValue(s.enableGcp);
						toggle.onChange(async (val) => {
							s.enableGcp = val;
							await this.plugin.saveSettings();
							// Connect/disconnect in the background — never block
							// the settings tab on Google.
							void this.plugin.gcpManager.setEnabled(val);
							new Notice(val ? 'GCP connector enabled' : 'GCP connector disabled');
							window.setTimeout(() => this.update(), 50);
						});
					});
			}),
			this.renderGcpCard(),
		];
		return { type: 'group', name: 'GCP', heading: 'GCP', items };
	}

	private renderGcpCard(): SettingDefinitionRender {
		return {
			name: 'GCP connection',
			desc: 'Service account + project for the GCP connector',
			render: (setting) => {
				const el = setting.settingEl;
				el.empty();
				el.addClass('ai-provider-settings');
				this.buildGcpCardRows(el);
			},
		};
	}

	private buildGcpCardRows(el: HTMLElement): void {
		const s = this.plugin.settings;
		const manager = this.plugin.gcpManager;
		const status = manager.statusOf();
		new Setting(el).setName('GCP connection').setHeading();

		// Connection status — mirrors the MCP server-card Status row.
		const statusRow = new Setting(el).setName('Status');
		let statusText: string;
		switch (status.state) {
			case 'connecting':
				statusText = 'Connecting…';
				break;
			case 'connected': {
				const until = status.tokenExpiresAt ? ` — access token until ${new Date(status.tokenExpiresAt).toLocaleTimeString()}` : '';
				statusText = `Connected${until}`;
				break;
			}
			case 'error':
				statusText = `Error: ${status.error || 'unknown error'}`;
				break;
			default:
				statusText = s.enableGcp ? 'Not connected' : 'Disabled';
		}
		statusRow.setDesc(statusText);
		if (status.state === 'connected') statusRow.descEl.addClass('ai-gcp-status-connected');
		if (status.state === 'error') statusRow.descEl.addClass('ai-gcp-status-error');

		new Setting(el)
			.setName('Project ID')
			.setDesc('GCP project to browse (blank = the key\'s own project)')
			.addText((t) => {
				t.setPlaceholder('Example: my-project')
					.setValue(s.gcpProjectId)
					.onChange(async (v) => {
						s.gcpProjectId = v.trim();
						await this.plugin.saveSettings();
					});
			});

		const hasKey = Boolean(resolveGcpServiceAccount(this.app, s) || s.gcpServiceAccountRef);
		new Setting(el)
			.setName('Service account key')
			.setDesc(hasKey ? 'Configured — stored in the OS keychain when available' : 'Not configured — paste a service-account JSON key')
			.addButton((b) => {
				b.setButtonText(hasKey ? 'Edit' : 'Add key');
				b.onClick(() => {
					new GcpServiceAccountModal(this.app, (result) => {
						void (async () => {
							setGcpServiceAccount(this.app, s, result.json);
							// Default the project id from the key when unset.
							if (!s.gcpProjectId.trim() && result.projectId) {
								s.gcpProjectId = result.projectId;
							}
							await this.plugin.saveSettings();
							if (s.enableGcp) await manager.refresh();
							this.update();
							new Notice('Service-account key saved');
						})();
					}).open();
				});
			})
			.addButton((b) => {
				b.setIcon('refresh-cw').setTooltip('Connect / refresh token');
				b.onClick(() => {
					void (async () => {
						if (!s.enableGcp) {
							new Notice('Enable the GCP connector first (toggle above).');
							return;
						}
						if (!hasKey) {
							new Notice('Add a service-account key first.');
							return;
						}
						new Notice('Connecting to GCP…');
						const st = await manager.refresh();
						new Notice(
							st.state === 'connected' ? 'GCP: connected' : `GCP: ${st.state === 'error' ? st.error : st.state}`,
							8000
						);
						this.update();
					})();
				});
			})
			.addButton((b) => {
				b.setButtonText('Remove key');
				b.buttonEl.addClass('mod-destructive');
				b.onClick(() => {
					void (async () => {
						setGcpServiceAccount(this.app, s, '');
						await this.plugin.saveSettings();
						await manager.disconnect();
						this.update();
						new Notice('Service-account key removed');
					})();
				});
			});
	}

	private renderMcpServerCard(server: McpServerConfig): SettingDefinitionRender {
		return {
			name: server.name,
			desc: server.url,
			render: (setting) => {
				const el = setting.settingEl;
				el.empty();
				el.addClass('ai-provider-settings');
				this.buildMcpServerCardRows(el, server);
			},
		};
	}

	private buildMcpServerCardRows(el: HTMLElement, server: McpServerConfig): void {
		const manager = this.plugin.mcpManager;
		new Setting(el).setName(server.name).setHeading();

		// Connection status — reflects live manager state, not just config.
		const statusRow = new Setting(el).setName('Status');
		const status = manager.statusOf(server.id);
		const toolWord = status.toolCount === 1 ? 'tool' : 'tools';
		let statusText: string;
		switch (status.state) {
			case 'connecting':
				statusText = 'Connecting…';
				break;
			case 'connected': {
				const info = status.serverName ? `${status.serverName}${status.serverVersion ? ` v${status.serverVersion}` : ''} — ` : '';
				statusText = `Connected (${info}${status.toolCount} ${toolWord})`;
				break;
			}
			case 'error':
				statusText = `Error: ${status.error || 'unknown error'}`;
				break;
			default:
				statusText = server.enabled ? 'Not connected' : 'Disabled';
		}
		statusRow.setDesc(statusText);
		if (status.state === 'connected') statusRow.descEl.addClass('ai-mcp-status-connected');
		if (status.state === 'error') statusRow.descEl.addClass('ai-mcp-status-error');

		new Setting(el)
			.setName('Enable')
			.addToggle((toggle) => {
				toggle.setValue(server.enabled);
				toggle.onChange(async (val) => {
					server.enabled = val;
					await this.plugin.saveSettings();
					void this.plugin.mcpManager.refreshServer(server.id);
					// Status is async — give the connection a beat, then repaint.
					window.setTimeout(() => this.update(), 50);
				});
			});

		new Setting(el)
			.setName('Endpoint')
			.setDesc(server.url)
			.addButton((b) => {
				b.setButtonText('Edit').onClick(() => {
					new McpServerModal(this.app, (result) => {
						void (async () => {
							const servers = this.plugin.settings.mcpServers;
							const idx = servers.findIndex((s) => s.id === server.id);
							if (idx >= 0) servers[idx] = result.config;
							await this.plugin.saveSettings();
							await this.plugin.mcpManager.refreshServer(server.id);
							this.update();
							new Notice(`Saved ${result.config.name}`);
						})();
					}, server).open();
				});
			})
			.addButton((b) => {
				b.setIcon('refresh-cw').setTooltip('Connect / refresh tools').onClick(() => {
					void (async () => {
						if (!this.plugin.settings.enableMcp) {
							new Notice('Enable MCP first (toggle above).');
							return;
						}
						new Notice(`Connecting to ${server.name}…`);
						const st = await this.plugin.mcpManager.refreshServer(server.id);
						new Notice(
							st.state === 'connected'
								? `${server.name}: connected, ${st.toolCount} tools`
								: `${server.name}: ${st.state === 'error' ? st.error : st.state}`,
							8000
						);
						this.update();
					})();
				});
			})
			.addButton((b) => {
				b.setButtonText('Delete');
				b.buttonEl.addClass('mod-destructive');
				b.onClick(async () => {
					await this.plugin.mcpManager.disconnectServer(server.id);
					this.plugin.settings.mcpServers = this.plugin.settings.mcpServers.filter((s) => s.id !== server.id);
					await this.plugin.saveSettings();
					this.update();
					new Notice(`Deleted ${server.name}`);
				});
			});
	}

	// ---- Chat UI ----

	private chatUIGroup(): SettingDefinitionItem {
		const s = this.plugin.settings;
		return {
			type: 'group',
			name: 'Chat UI',
			heading: 'Chat UI',
			items: [
				this.row('Day separators', 'Show "today", "yesterday", or the date between messages on different days.', (el) => {
					new Setting(el)
						.setName('Day separators')
						.setDesc('Show "today", "yesterday", or the date between messages on different days.')
						.addToggle((toggle) => {
							toggle.setValue(s.showDaySeparators !== false);
							toggle.onChange(async (val) => {
								s.showDaySeparators = val;
								await this.plugin.saveSettings();
								this.plugin.refreshChatViews();
							});
						});
				}),
				this.row('Link favicons', 'Show a site icon next to external links in chat. Icons load from icons.duckduckgo.com \u2014 one request per domain; turn off to keep chat rendering fully local.', (el) => {
					new Setting(el)
						.setName('Link favicons')
						.setDesc('Show a site icon next to external links in chat. Icons load from icons.duckduckgo.com \u2014 one request per domain; turn off to keep chat rendering fully local.')
						.addToggle((toggle) => {
							toggle.setValue(s.showLinkFavicons !== false);
							toggle.onChange(async (val) => {
								s.showLinkFavicons = val;
								await this.plugin.saveSettings();
								this.plugin.refreshChatViews();
							});
						});
				}),
				this.row('Enter key behavior', 'Choose what enter does in the chat input.', (el) => {
					new Setting(el)
						.setName('Enter key behavior')
						.setDesc('Choose what enter does in the chat input.')
						.addDropdown((dd) => {
							dd.addOption('send', 'Enter = send · Shift+Enter = newline');
							dd.addOption('newline', 'Enter = newline · Ctrl/Cmd+Enter = send');
							dd.setValue(s.enterKeyBehavior);
							dd.onChange(async (val) => {
								s.enterKeyBehavior = val as 'send' | 'newline';
								await this.plugin.saveSettings();
								this.plugin.refreshAllChatViews();
							});
						});
				}),
				this.row('Notify when responses complete', 'Show a system notification when a response finishes. Skipped while you are viewing the chat; in-app notice on mobile.', (el) => {
					new Setting(el)
						.setName('Notify when responses complete')
						.setDesc('Show a system notification when a response finishes. Skipped while you are viewing the chat; in-app notice on mobile.')
						.addToggle((toggle) => {
							toggle.setValue(s.notifyOnCompletion === true);
							toggle.onChange(async (val) => {
								s.notifyOnCompletion = val;
								await this.plugin.saveSettings();
								if (val) await CurtisSettingTab.warnWhenNotificationsUnsupported();
							});
						});
				}),
				this.row('Notify when requests fail', 'Show a system notification when a request fails (completions toggle above covers successes).', (el) => {
					new Setting(el)
						.setName('Notify when requests fail')
						.setDesc('Show a system notification when a request fails (completions toggle above covers successes).')
						.addToggle((toggle) => {
							toggle.setValue(s.notifyOnError === true);
							toggle.onChange(async (val) => {
								s.notifyOnError = val;
								await this.plugin.saveSettings();
								if (val) await CurtisSettingTab.warnWhenNotificationsUnsupported();
							});
						});
				}),
				this.row('Chat panel position', 'Side of the workspace for the chat panel — applies to newly opened panels (an already-open panel does not move)', (el) => {
					new Setting(el)
						.setName('Chat panel position')
						.setDesc('Side of the workspace for the chat panel — applies to newly opened panels (an already-open panel does not move)')
						.addDropdown((dd) => {
							dd.addOption('right', 'Right');
							dd.addOption('left', 'Left');
							dd.setValue(s.chatViewPosition);
							dd.onChange(async (val) => {
								s.chatViewPosition = val as 'right' | 'left';
								await this.plugin.saveSettings();
							});
						});
				}),
				// "Chat panel width" intentionally not offered: Obsidian's API
				// exposes no way to resize a docked sidebar leaf, so the value
				// could be saved but never take effect. Drag the panel edge.
			],
		};
	}

	// ---- Voice ----

	private voiceGroup(): SettingDefinitionItem {
		const s = this.plugin.settings;
		return {
			type: 'group',
			name: 'Voice',
			heading: 'Voice',
			items: [
				this.row('Auto-speak responses', 'Speak each assistant response aloud as it completes. Toggle also lives in the chat input row.', (el) => {
					new Setting(el)
						.setName('Auto-speak responses')
						.setDesc('Speak each assistant response aloud as it completes. Toggle also lives in the chat input row.')
						.addToggle((toggle) => {
							toggle.setValue(s.ttsAutoSpeak);
							toggle.onChange(async (val) => {
								s.ttsAutoSpeak = val;
								await this.plugin.saveSettings();
							});
						});
				}),
				this.row('Read-aloud voice', 'Voice used when reading messages aloud. Leave on automatic to let the system pick.', (el) => {
					new Setting(el)
						.setName('Read-aloud voice')
						.setDesc('Voice used when reading messages aloud. Leave on automatic to let the system pick.')
						.addDropdown((dd) => {
							const voices = isSpeechSupported() ? window.speechSynthesis.getVoices() : [];
							if (voices.length === 0 && isSpeechSupported()) {
								// Voice lists load asynchronously on many platforms
								// (getVoices() is empty until voiceschanged fires) —
								// re-render once the OS list arrives.
								window.speechSynthesis.onvoiceschanged = () => this.update();
							}
							dd.addOption('', 'System default (auto)');
							for (const voice of voices) {
								dd.addOption(voice.voiceURI, `${voice.name} (${voice.lang})`);
							}
							// A stored voice from another machine may not exist
							// here — display auto; playback falls back silently.
							const known = voices.some((v) => v.voiceURI === s.ttsVoiceUri);
							dd.setValue(known ? s.ttsVoiceUri : '');
							dd.onChange(async (val) => {
								s.ttsVoiceUri = val;
								await this.plugin.saveSettings();
							});
						});
				}),
				this.row('Read-aloud rate', "Default speaking speed. The player's rate button overrides this for the current playback only.", (el) => {
					const setting = new Setting(el)
						.setName('Read-aloud rate')
						.setDesc("Default speaking speed. The player's rate button overrides this for the current playback only.");
					const syncReadout = this.sliderReadout(setting, s.ttsRate, (v) => `${v}×`);
					setting.addSlider((slider) => {
						slider
							.setLimits(0.5, 2, 0.25)
							.setValue(s.ttsRate)
							.onChange(async (val) => {
								syncReadout(val);
								s.ttsRate = val;
								await this.plugin.saveSettings();
							});
					});
				}),
				this.row('Highlight spoken sentence', 'Follow along: the sentence being read is highlighted and scrolled into view.', (el) => {
					new Setting(el)
						.setName('Highlight spoken sentence')
						.setDesc('Follow along: the sentence being read is highlighted and scrolled into view.')
						.addToggle((toggle) => {
							toggle.setValue(s.ttsHighlight);
							toggle.onChange(async (val) => {
								s.ttsHighlight = val;
								await this.plugin.saveSettings();
							});
						});
				}),
			],
		};
	}

	// ---- Notes ----

	private notesGroup(): SettingDefinitionItem {
		const s = this.plugin.settings;
		return {
			type: 'group',
			name: 'Notes',
			heading: 'Notes',
			items: [
				this.row('Note save folder', 'Where "save as note" and the /note slash command save new notes. Empty = vault root.', (el) => {
					new Setting(el)
						.setName('Note save folder')
						.setDesc('Where "save as note" and the /note slash command save new notes. Empty = vault root.')
						.addText((text) => {
							text.setPlaceholder('AI notes')
								.setValue(s.noteSaveFolder)
								.onChange(async (val) => {
									s.noteSaveFolder = val.trim();
									await this.plugin.saveSettings();
								});
						})
						.addButton((btn) => {
							btn.setIcon('folder').setTooltip('Browse…').onClick(() => {
								new FolderSuggestModal(this.app, (path) => {
									void (async () => {
										s.noteSaveFolder = path;
										await this.plugin.saveSettings();
										this.update();
									})();
								}).open();
							});
						});
				}),
				this.row('Auto-save assistant responses', 'Silently save each completed assistant message as a note. Folder below.', (el) => {
					new Setting(el)
						.setName('Auto-save assistant responses')
						.setDesc('Silently save each completed assistant message as a note. Folder below.')
						.addToggle((toggle) => {
							toggle.setValue(s.autoSaveAssistantResponses);
							toggle.onChange(async (val) => {
								s.autoSaveAssistantResponses = val;
								await this.plugin.saveSettings();
							});
						});
				}),
				this.row('Auto-save folder', 'Defaults to the note save folder above when empty.', (el) => {
					new Setting(el)
						.setName('Auto-save folder')
						.setDesc('Defaults to the note save folder above when empty.')
						.addText((text) => {
							text.setPlaceholder('AI responses')
								.setValue(s.autoSaveFolder)
								.onChange(async (val) => {
									s.autoSaveFolder = val.trim();
									await this.plugin.saveSettings();
								});
						})
						.addButton((btn) => {
							btn.setIcon('folder').setTooltip('Browse…').onClick(() => {
								new FolderSuggestModal(this.app, (path) => {
									void (async () => {
										s.autoSaveFolder = path;
										await this.plugin.saveSettings();
										this.update();
									})();
								}).open();
							});
						});
				}),
			],
		};
	}

	// ---- Chat background ----

	private backgroundGroup(): SettingDefinitionItem {
		const s = this.plugin.settings;
		return {
			type: 'group',
			name: 'Chat background',
			heading: 'Chat background',
			items: [
				this.row('Background style', '"theme" uses your Obsidian theme colors. "wallpaper" uses the image picked below.', (el) => {
					new Setting(el)
						.setName('Background style')
						.setDesc('"theme" uses your Obsidian theme colors. "wallpaper" uses the image picked below.')
						.addDropdown((dd) => {
							dd.addOption('theme', 'Theme (default)');
							dd.addOption('wallpaper', 'Wallpaper image');
							dd.setValue(s.chatBackground);
							dd.onChange(async (val) => {
								s.chatBackground = val as 'theme' | 'wallpaper';
								await this.plugin.saveSettings();
								this.plugin.refreshAllChatViews();
							});
						});
				}),
				this.row('Wallpaper image', 'Pick any image file in your vault.', (el) => {
					new Setting(el)
						.setName('Wallpaper image')
						.setDesc('Pick any image file in your vault.')
						.addText((text) => {
							text.setPlaceholder('attachments/wallpaper.png')
								.setValue(s.chatWallpaperPath)
								.onChange(async (val) => {
									s.chatWallpaperPath = val.trim();
									await this.plugin.saveSettings();
									this.plugin.refreshAllChatViews();
								});
						})
						.addButton((btn) => {
							btn.setIcon('image').setTooltip('Pick image from vault').onClick(() => {
								new ImageSuggestModal(this.app, (path) => {
									void (async () => {
										s.chatWallpaperPath = path;
										s.chatBackground = 'wallpaper';
										await this.plugin.saveSettings();
										this.update();
										this.plugin.refreshAllChatViews();
									})();
								}).open();
							});
						});
				}),
			],
		};
	}

	// ---- Memory ----

	private memoryGroup(): SettingDefinitionItem {
		const s = this.plugin.settings;
		const items: SettingDefinitionRender[] = [
			this.row('Enable memory', 'Inject remembered facts into each prompt — they are sent to your active provider with every message.', (el) => {
				new Setting(el)
					.setName('Enable memory')
					.setDesc('Inject remembered facts into each prompt — they are sent to your active provider with every message.')
					.addToggle((toggle) => {
						toggle.setValue(s.enableMemory);
						toggle.onChange(async (val) => {
							s.enableMemory = val;
							await this.plugin.saveSettings();
						});
					});
			}),
			this.row('Fact capture', 'How new facts get saved. Extraction (when on) runs one background request per turn through your active provider.', (el) => {
				new Setting(el)
					.setName('Fact capture')
					.setDesc('How new facts get saved. Extraction (when on) runs one background request per turn through your active provider.')
					.addDropdown((dd) => {
						dd.addOption('off', 'Off — manual only (/remember, right-click)');
						dd.addOption('confirm', 'Ask before saving (default)');
						dd.addOption('auto', 'Save silently after each turn');
						dd.setValue(s.memoryCaptureMode);
						dd.onChange(async (val) => {
							s.memoryCaptureMode = val as 'off' | 'confirm' | 'auto';
							await this.plugin.saveSettings();
						});
					});
			}),
			this.row('Memory file path', 'Markdown file where facts are stored. Editable by hand.', (el) => {
				new Setting(el)
					.setName('Memory file path')
					.setDesc('Markdown file where facts are stored. Editable by hand.')
					.addText((text) => {
						text.setPlaceholder('AI/Curtis Memory.md')
							.setValue(s.memoryFilePath)
							.onChange(async (val) => {
								s.memoryFilePath = val.trim() || 'AI/Curtis Memory.md';
								await this.plugin.saveSettings();
								await this.plugin.memoryStore.reload(this.plugin);
							});
					})
					.addButton((btn) => {
						btn.setIcon('folder').setTooltip('Browse…').onClick(() => {
							new FolderSuggestModal(this.app, (path) => {
								void (async () => {
									// FolderSuggestModal picks a folder; append default filename.
									const fname = 'Curtis Memory.md';
									s.memoryFilePath = path ? `${path}/${fname}` : fname;
									await this.plugin.saveSettings();
									await this.plugin.memoryStore.reload(this.plugin);
									this.update();
								})();
							}).open();
						});
					})
					.addButton((btn) => {
						btn.setButtonText('Open').setTooltip('Open memory file').onClick(async () => {
							await this.plugin.memoryStore.ensureFile();
							const p = s.memoryFilePath;
							const file = this.app.vault.getAbstractFileByPath(p);
							if (file) await this.app.workspace.openLinkText(p, '', false);
						});
					})
					.addButton((btn) => {
						btn.setButtonText('Clear').setTooltip('Delete all facts');
						btn.buttonEl.addClass('mod-destructive');
						btn.onClick(async () => {
							await this.plugin.memoryStore.clear();
							new Notice('Memory cleared');
						});
					});
			}),
		];

		// Fact list — only when memory is enabled.
		if (s.enableMemory) {
			const facts = this.plugin.memoryStore.getFacts();
			if (facts.length === 0) {
				items.push(this.row('No facts yet', 'Memory facts will appear here once captured.', (el) => {
					new Setting(el)
						.setName('No facts yet')
						.setDesc('Memory facts will appear here once captured.');
				}));
			} else {
				for (const fact of facts) {
					const preview = fact.content.length > 80 ? fact.content.slice(0, 80) + '…' : fact.content;
					// Provenance line: category · learned date · source conversation.
					const conv = fact.sourceConversationId
						? this.plugin.conversationStore.getConversation(fact.sourceConversationId)
						: undefined;
					const descParts = [
						fact.category ? `Category: ${fact.category}` : 'Uncategorized',
						`learned ${new Date(fact.timestamp).toLocaleDateString()}`,
					];
					if (conv) descParts.push(`from “${conv.title}”`);
					const desc = descParts.join(' · ');
					items.push(this.row(preview, desc, (el) => {
						const setting = new Setting(el)
							.setName(preview)
							.setDesc(desc)
							.addButton((btn) => btn.setButtonText('Edit').onClick(() => {
								new EditFactModal(this.app, fact, (content, category) => {
									void (async () => {
										await this.plugin.memoryStore.updateFact(fact.id, content, category || undefined);
										this.update();
									})();
								}).open();
							}))
							.addButton((btn) => {
								btn.setButtonText('Delete');
								btn.buttonEl.addClass('mod-destructive');
								btn.onClick(async () => {
									await this.plugin.memoryStore.deleteFact(fact.id);
									this.update();
								});
							});
						if (conv) {
							setting.addExtraButton((btn) => {
								btn.setIcon('messages-square')
									.setTooltip('View source conversation')
									.onClick(() => {
										const path = this.plugin.conversationStore.getConversationPath(conv.id);
										if (path) {
											void this.app.workspace.openLinkText(path, '', false);
										} else {
											new Notice('That conversation has no saved file');
										}
									});
							});
						}
					}));
				}
			}
		}
		return { type: 'group', name: 'Memory', heading: 'Memory', items };
	}

	// ---- Conversations ----

	private conversationsGroup(): SettingDefinitionItem {
		const s = this.plugin.settings;
		return {
			type: 'group',
			name: 'Conversations',
			heading: 'Conversations',
			items: [
				this.row('Conversations folder', 'Each chat is saved as a Markdown note in this folder — synced with your vault, searchable, and readable by the agent. New chats are stored here.', (el) => {
					new Setting(el)
						.setName('Conversations folder')
						.setDesc('Each chat is saved as a Markdown note in this folder — synced with your vault, searchable, and readable by the agent. New chats are stored here.')
						.addText((text) => {
							text.setPlaceholder('AI/conversations')
								.setValue(s.conversationsFolder)
								.onChange(async (val) => {
									s.conversationsFolder = val.trim() || 'AI/Conversations';
									await this.plugin.saveSettings();
								});
						})
							.addButton((btn) => {
								btn.setIcon('folder').setTooltip('Browse…').onClick(() => {
									new FolderSuggestModal(this.app, (path) => {
										void (async () => {
											s.conversationsFolder = path || 'AI/Conversations';
											await this.plugin.saveSettings();
											this.update();
										})();
									}).open();
								});
							});
					}),
				this.row('Recap journal', 'When you recap a conversation (/recap or the export menu), also append the summary to a journal file in your vault.', (el) => {
					new Setting(el)
						.setName('Recap journal')
						.setDesc('When you recap a conversation (/recap or the export menu), also append the summary to a journal file in your vault.')
						.addToggle((toggle) => {
							toggle.setValue(s.enableJournal);
							toggle.onChange(async (val) => {
								s.enableJournal = val;
								await this.plugin.saveSettings();
							});
						});
				}),
				this.row('Journal file path', 'Append-only markdown file where recaps are logged. One entry per recap; Curtis never rewrites it.', (el) => {
					new Setting(el)
						.setName('Journal file path')
						.setDesc('Append-only markdown file where recaps are logged. One entry per recap; Curtis never rewrites it.')
						.addText((text) => {
							text.setPlaceholder('AI/Curtis Journal.md')
								.setValue(s.journalFilePath)
								.onChange(async (val) => {
									s.journalFilePath = val.trim() || 'AI/Curtis Journal.md';
									await this.plugin.saveSettings();
								});
						})
						.addButton((btn) => {
							btn.setButtonText('Open').setTooltip('Open journal file').onClick(async () => {
								await ensureJournalFile(this.plugin);
								const p = s.journalFilePath || 'AI/Curtis Journal.md';
								if (this.app.vault.getAbstractFileByPath(p)) {
									await this.app.workspace.openLinkText(p, '', false);
								}
							});
						});
				}),
			],
		};
	}

	// ---- Vault retrieval (RAG) ----

	private ragGroup(): SettingDefinitionItem {
		const s = this.plugin.settings;
		const items: SettingDefinitionRender[] = [
			this.row('Enable vault retrieval', 'Index your notes with embeddings and inject relevant excerpts into each prompt automatically.', (el) => {
				new Setting(el)
					.setName('Enable vault retrieval')
					.setDesc('Index your notes with embeddings and inject relevant excerpts into each prompt automatically.')
					.addToggle((toggle) => {
						toggle.setValue(s.enableRag);
						toggle.onChange(async (val) => {
							s.enableRag = val;
							await this.plugin.saveSettings();
							// Hot-reload the agent tool — no Obsidian reload needed.
							this.plugin.toolRegistry.setRagToolEnabled(val);
							this.update();
						});
					});
			}),
			this.row('Relevance pulse', 'When the note you open closely matches a past conversation, show a "discussed in …" hint under the chat header. Local-only similarity over the vault index — no API calls. Requires the index.', (el) => {
				new Setting(el)
					.setName('Relevance pulse')
					.setDesc('When the note you open closely matches a past conversation, show a "discussed in …" hint under the chat header. Local-only similarity over the vault index — no API calls. Requires the index.')
					.addToggle((toggle) => {
						toggle.setValue(s.enableRelevancePulse);
						toggle.onChange(async (val) => {
							s.enableRelevancePulse = val;
							await this.plugin.saveSettings();
						});
					});
			}),
			this.row('Embedding provider', 'Any OpenAI-compatible /embeddings endpoint. Local (ollama, lm studio) works fully offline. Anthropic has no embeddings API.', (el) => {
				new Setting(el)
					.setName('Embedding provider')
					.setDesc('Any OpenAI-compatible /embeddings endpoint. Local (ollama, lm studio) works fully offline. Anthropic has no embeddings API.')
					.addDropdown((dd) => {
						for (const def of this.plugin.providerRegistry.getAllDefinitions()) {
							if (def.authType === 'anthropic') continue;
							dd.addOption(def.id, def.name);
						}
						dd.setValue(s.ragEmbeddingProvider);
						dd.onChange(async (val) => {
							s.ragEmbeddingProvider = val;
							s.ragEmbeddingModel = defaultEmbeddingModel(val);
							await this.plugin.saveSettings();
							this.update();
						});
					});
			}),
			this.row('Embedding model', 'Model ID sent to the /embeddings endpoint.', (el) => {
				new Setting(el)
					.setName('Embedding model')
					.setDesc('Model ID sent to the /embeddings endpoint.')
				.addText((text) => {
					text.setPlaceholder('Model ID')
						.setValue(s.ragEmbeddingModel)
							.onChange(async (val) => {
								s.ragEmbeddingModel = val.trim() || 'text-embedding-3-small';
								await this.plugin.saveSettings();
							});
					});
			}),
		];

		if (s.enableRag) {
			items.push(
				this.row('Chunk size', 'Characters per note chunk (default 500).', (el) => {
					new Setting(el)
						.setName('Chunk size')
						.setDesc('Characters per note chunk (default 500).')
						.addText((text) => {
							text.setValue(String(s.ragChunkSize)).onChange(async (val) => {
								const n = parseInt(val, 10);
								if (!isNaN(n) && n >= 100) {
									s.ragChunkSize = n;
									await this.plugin.saveSettings();
								}
							});
						});
				}),
				this.row('Chunk overlap', 'Characters of overlap between consecutive chunks (default 50).', (el) => {
					new Setting(el)
						.setName('Chunk overlap')
						.setDesc('Characters of overlap between consecutive chunks (default 50).')
						.addText((text) => {
							text.setValue(String(s.ragChunkOverlap)).onChange(async (val) => {
								const n = parseInt(val, 10);
								if (!isNaN(n) && n >= 0 && n < s.ragChunkSize / 2) {
									s.ragChunkOverlap = n;
									await this.plugin.saveSettings();
								}
							});
						});
				}),
				this.row('Results per query', 'How many excerpts to inject into each prompt (default 5).', (el) => {
					new Setting(el)
						.setName('Results per query')
						.setDesc('How many excerpts to inject into each prompt (default 5).')
						.addDropdown((dd) => {
							for (const n of [3, 5, 8, 12]) dd.addOption(String(n), String(n));
							dd.setValue(String(s.ragTopK));
							dd.onChange(async (val) => {
								s.ragTopK = Number(val);
								await this.plugin.saveSettings();
							});
						});
				})
			);

			// Index status + actions. Rebuilt on every this.update() so the
			// counts refresh after a build finishes.
			const status = this.plugin.ragIndex.getStatus();
			const statusText = status.modelMismatch
				? `Index built with ${status.embeddingProvider}/${status.embeddingModel} — rebuild to use the provider selected above.`
				: status.lastBuilt
					? `${status.fileCount} notes · ${status.chunkCount} chunks · built ${new Date(status.lastBuilt).toLocaleString()}`
					: 'No index yet — build one to activate retrieval.';
			items.push(
				this.row('Index status', statusText, (el) => {
					new Setting(el)
						.setName('Index status')
						.setDesc(statusText)
						.addButton((btn) => {
							btn.setButtonText(status.building ? 'Building…' : 'Rebuild index')
								.setClass('mod-cta')
								.setDisabled(status.building)
								.onClick(async () => {
									await rebuildIndexWithProgress(this.plugin);
									this.update();
								});
						})
						.addButton((btn) => {
							btn.setButtonText('Delete index').setTooltip('Remove the stored embedding index');
							btn.buttonEl.addClass('mod-destructive');
							btn.onClick(async () => {
								await this.plugin.ragIndex.clear();
								new Notice('Vault index deleted');
								this.update();
							});
						});
				})
			);
		}
		return { type: 'group', name: 'Vault retrieval', heading: 'Vault retrieval', items };
	}

	// ---- About ----

	private aboutGroup(): SettingDefinitionItem {
		return {
			type: 'group',
			name: 'About',
			heading: 'About',
			items: [
				this.row('About Curtis', undefined, (el) => {
					// One wrapper — settingEl is a flex row, so bare children would
					// sit side by side instead of stacking.
					const wrap = el.createDiv();
					const title = wrap.createDiv({ cls: 'curtis-mark-title' });
					const mark = title.createSpan({ cls: 'curtis-modal-title-icon', attr: { 'aria-hidden': 'true' } });
					// Registered by main.ts (addIcon) at startup.
					setIcon(mark, CURTIS_ICON_ID);
					title.appendText(`Curtis v${this.plugin.manifest.version}`);

					wrap.createEl('p', {
						cls: 'ai-setting-hint',
						text: 'Polyglot AI chat for Obsidian — 30+ providers, agent mode, memory. Local-first, open source.',
					});

					const author = wrap.createEl('p', { cls: 'ai-setting-hint' });
					author.appendText('By ');
					const link = author.createEl('a', { href: 'https://github.com/jordannewell/curtis-ai-chat' });
					link.setText('Jordan Newell');
				}),
			],
		};
	}

	private openCustomProviderModal(existing?: ProviderDefinition, existingKey?: string): void {
		// Prefill from the keychain when the stored plaintext was wiped (by
		// design, secrets.ts) — a blank prefill silently cleared the stored
		// key the moment the user saved any edit.
		const resolvedKey = existing
			? (existingKey || resolveApiKey(this.app, this.plugin.settings.providerConfigs[existing.id]) || '')
			: undefined;
		new CustomProviderModal(
			this.app,
			(result) => {
				void (async () => {
					const { definition, apiKey } = result;
					// If editing, remove the old entry first
					if (existing) {
						this.plugin.settings.customProviders = this.plugin.settings.customProviders.filter((p) => p.id !== existing.id);
					}
					this.plugin.settings.customProviders.push(definition);
					const config: ProviderConfig = {
						enabled: true,
						defaultModel: definition.models[0]?.id,
					};
					setApiKeyForProvider(this.app, definition.id, config, apiKey);
					this.plugin.settings.providerConfigs[definition.id] = config;
					await this.plugin.saveSettings();
					// Recreate the registry entry — without removing the old def
					// first, the registry holds two definitions with the same id
					// and updateConfig() recreates from the STALE one. Keep the
					// discovery cache: this is an edit of the same provider.
					this.plugin.providerRegistry.removeCustomProvider(definition.id, true);
					this.plugin.providerRegistry.addCustomProvider(definition);
					this.plugin.providerRegistry.updateConfig(definition.id, config);
					if (definition.autoDiscoverModels && !definition.models.length) {
						void this.plugin.providerRegistry
							.discoverModels(definition)
							.then(() => this.update())
							.catch(() => undefined);
					}
					this.update();
					new Notice(`Saved ${definition.name}`);
				})();
			},
			existing,
			resolvedKey
		).open();
	}
}

// ============================================================================
// Vault retrieval helpers
// ============================================================================

/** Sensible default embedding model per provider when the user switches
 *  ragEmbeddingProvider. Anything unknown keeps the OpenAI default — the
 *  field is editable and the /embeddings shape is identical. */
function defaultEmbeddingModel(providerId: string): string {
	const defaults: Record<string, string> = {
		openai: 'text-embedding-3-small',
		google: 'gemini-embedding-001',
		'zai-glm': 'embedding-3',
		ollama: 'nomic-embed-text',
		lmstudio: 'text-embedding-nomic-embed-text-v1.5',
	};
	return defaults[providerId] || 'text-embedding-3-small';
}

/** How many override fields in a ModelOverrides record are actually set —
 *  drives the "(N set)" summary and the reset button's enabled state. */
function countOverrideFields(rec: ModelOverrides | undefined): number {
	if (!rec) return 0;
	return Object.values(rec).filter((v) => v !== undefined).length;
}

// ============================================================================
// Test-connection helper — sends a tiny "say ok" request to verify auth + URL
// ============================================================================

interface TestResult {
	ok: boolean;
	status: number | null;
	message: string;
}

async function testProviderConnection(
	def: ProviderDefinition,
	config: ProviderConfig,
	app?: App,
	provider?: import('./types').AIProvider
): Promise<TestResult> {
	const endpoint = config.customEndpoint || def.endpoint;
	const apiKey = app ? resolveApiKey(app, config) : (config.apiKey || '');

	// Build a minimal request body in OpenAI-compat shape; for Anthropic we'd
	// need a different shape, but the test still validates auth + reachability.
	const isAnthropic = def.authType === 'anthropic';
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
	};
	if (def.authType === 'bearer') headers['Authorization'] = `Bearer ${apiKey}`;
	else if (def.authType === 'key') headers['Authorization'] = `Key ${apiKey}`;
	else if (isAnthropic) {
		headers['x-api-key'] = apiKey;
		headers['anthropic-version'] = '2023-06-01';
	}

	const modelId = config.defaultModel || def.models[0]?.id || 'gpt-3.5-turbo';
	// Same minimal body for both dialects (model + max_tokens + messages is
	// valid OpenAI-compat AND Anthropic shape) — auth + reachability is all
	// this test validates.
	let body = JSON.stringify({
		model: modelId,
		max_tokens: 16,
		messages: [{ role: 'user', content: 'say ok' }],
	});

	if (provider) {
		// Dialect-correct path for providers whose wire shape (or credential)
		// the generic branches above can't express — the Responses API of
		// Sign in with ChatGPT, OAuth token refresh, Ollama's native dialect.
		// prepare() refreshes short-lived credentials; a failed refresh just
		// reports as a failed test.
		await provider.prepare?.().catch(() => undefined);
		const init = provider.formatRequest([{ role: 'user', content: 'say ok' }], {
			model: modelId,
			maxTokens: 16,
		});
		for (const [k, v] of Object.entries(flattenHeaders(init.headers))) headers[k] = v;
		body = init.body as string;
	}

	const start = Date.now();
	try {
		const resp = await requestUrl({
			url: endpoint,
			method: 'POST',
			headers,
			body,
			throw: false,
		});
		const latency = Date.now() - start;
		if (resp.status >= 200 && resp.status < 300) {
			return { ok: true, status: resp.status, message: `✓ ${def.name} OK (${resp.status}, ${latency}ms)` };
		}
		const errSnippet = (resp.text || '').slice(0, 200);
		return { ok: false, status: resp.status, message: `✗ ${def.name} returned ${resp.status}: ${errSnippet}` };
	} catch (e) {
		return { ok: false, status: null, message: `✗ ${def.name} failed: ${(e as Error).message}` };
	}
}
