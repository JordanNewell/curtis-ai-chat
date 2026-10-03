// Curtis Settings — defaults, settings tab UI

import { App, Notice, PluginSettingTab, Setting, requestUrl } from 'obsidian';
import type { SettingDefinitionItem, SettingDefinitionRender } from 'obsidian';
import type { CurtisSettings, ProviderConfig, ProviderDefinition } from './types';
import { PROVIDER_DEFINITIONS } from './providers/registry';
import { CustomProviderModal } from './ui/modals/custom-provider-modal';
import { FolderSuggestModal } from './ui/modals/folder-suggest-modal';
import { ImageSuggestModal } from './ui/modals/image-suggest-modal';
import { EditFactModal } from './ui/modals/edit-fact-modal';
import { CORE_SYSTEM_PROMPT } from './core/system-prompt';
import { setApiKeyForProvider, getSecretStorage, resolveApiKey } from './core/secrets';
import type CurtisPlugin from './main';

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
	chatWidth: 400,

	noteSaveFolder: 'AI Notes',
	autoSaveAssistantResponses: false,
	autoSaveFolder: '',

	enterKeyBehavior: 'send',
	chatBackground: 'theme',
	chatWallpaperPath: '',

	enableCostTracking: true,

	enableMemory: true,
	memoryCaptureMode: 'auto',
	memoryFilePath: 'AI/Curtis Memory.md',

	enableDailyNotesAssistant: false,
	dailyNotesFolder: 'Daily Notes',
	dailyNotesFormat: 'YYYY-MM-DD',

	enableRag: false,
	ragChunkSize: 500,
	ragChunkOverlap: 50,
	ragTopK: 5,
	ragEmbeddingProvider: 'openai',
	ragEmbeddingModel: 'text-embedding-3-small',

	enableAgent: false,
	agentMaxTurns: 5,
	enableWebSearch: false,
	showDaySeparators: true,

	hotkeys: {
		toggleChat: 'Ctrl+Shift+G',
		quickAction: 'Ctrl+Shift+A',
		explainSelection: 'Ctrl+Shift+E',
	},
};

export class CurtisSettingTab extends PluginSettingTab {
	plugin: CurtisPlugin;

	constructor(app: App, plugin: CurtisPlugin) {
		super(app, plugin);
		this.plugin = plugin;
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
			this.generationGroup(),
			this.agentGroup(),
			this.chatUIGroup(),
			this.notesGroup(),
			this.backgroundGroup(),
			this.memoryGroup(),
			this.supportGroup(),
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
		const enabledProviders = PROVIDER_DEFINITIONS.filter(
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
					const activeDef = PROVIDER_DEFINITIONS.find((d) => d.id === s.activeProvider);
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
			desc: def.authType === 'none' ? 'Local provider — no API key required' : undefined,
			render: (setting) => {
				const el = setting.settingEl;
				el.empty();
				el.addClass('ai-provider-settings');
				this.buildProviderCardRows(el, def);
			},
		};
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
					this.update();
				});
			});

		if (def.authType === 'anthropic') {
			new Setting(el)
				.setName('API key')
				.setDesc('Anthropic API key — stored in os keychain when available')
				.addText((text) => {
					text.inputEl.type = 'password';
					text.setPlaceholder('Sk-ant-...')
						.setValue(config.apiKey || '')
						.onChange(async (val) => {
							setApiKeyForProvider(this.app, def.id, config, val);
							await this.plugin.saveSettings();
							this.plugin.providerRegistry.updateConfig(def.id, config);
						});
				});
		} else if (def.authType === 'bearer') {
			const keyDesc = getSecretStorage(this.app)
				? `${def.name} API key — stored in os keychain`
				: `${def.name} API key`;
			new Setting(el)
				.setName('API key')
				.setDesc(keyDesc)
				.addText((text) => {
					text.inputEl.type = 'password';
					text.setPlaceholder('Enter API key')
						.setValue(config.apiKey || '')
						.onChange(async (val) => {
							setApiKeyForProvider(this.app, def.id, config, val);
							await this.plugin.saveSettings();
							this.plugin.providerRegistry.updateConfig(def.id, config);
						});
				});
		}
		// 'none' auth (Ollama, LM Studio) skips the API key field entirely.

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
							const result = await testProviderConnection(def, config, this.app);
							new Notice(result.message, 8000);
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
				desc: def.endpoint,
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
					await this.plugin.saveSettings();
					this.update();
					new Notice(`Deleted ${def.name}`);
				});
			});
	}

	// ---- Generation ----

	private generationGroup(): SettingDefinitionItem {
		const s = this.plugin.settings;
		return {
			type: 'group',
			name: 'Generation',
			heading: 'Generation',
			items: [
				this.row('Temperature', 'Higher = more creative, lower = more focused (0.0 - 2.0)', (el) => {
					new Setting(el)
						.setName('Temperature')
						.setDesc('Higher = more creative, lower = more focused (0.0 - 2.0)')
						.addSlider((slider) => {
							slider
								.setLimits(0, 2, 0.1)
								.setValue(s.temperature)
								.onChange(async (val) => {
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
			],
		};
	}

	// ---- Agent ----

	private agentGroup(): SettingDefinitionItem {
		const s = this.plugin.settings;
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
			],
		};
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
				this.row('Chat panel position', undefined, (el) => {
					new Setting(el)
						.setName('Chat panel position')
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
				this.row('Chat panel width', 'Width in pixels', (el) => {
					new Setting(el)
						.setName('Chat panel width')
						.setDesc('Width in pixels')
						.addText((text) => {
							text.setValue(String(s.chatWidth)).onChange(async (val) => {
								const n = parseInt(val, 10);
								if (!isNaN(n) && n >= 200) {
									s.chatWidth = n;
									await this.plugin.saveSettings();
								}
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
			this.row('Enable memory', 'Inject remembered facts about the user into each prompt', (el) => {
				new Setting(el)
					.setName('Enable memory')
					.setDesc('Inject remembered facts about the user into each prompt')
					.addToggle((toggle) => {
						toggle.setValue(s.enableMemory);
						toggle.onChange(async (val) => {
							s.enableMemory = val;
							await this.plugin.saveSettings();
						});
					});
			}),
			this.row('Auto-capture facts', 'After each turn, ask the model to extract durable facts. Off = manual only (/remember, right-click).', (el) => {
				new Setting(el)
					.setName('Auto-capture facts')
					.setDesc('After each turn, ask the model to extract durable facts. Off = manual only (/remember, right-click).')
					.addDropdown((dd) => {
						dd.addOption('off', 'Off (manual only)');
						dd.addOption('auto', 'Auto-extract after each turn');
						dd.setValue(s.memoryCaptureMode);
						dd.onChange(async (val) => {
							s.memoryCaptureMode = val as 'off' | 'auto';
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
					items.push(this.row(preview, fact.category ? `Category: ${fact.category}` : 'Uncategorized', (el) => {
						new Setting(el)
							.setName(preview)
							.setDesc(fact.category ? `Category: ${fact.category}` : 'Uncategorized')
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
					}));
				}
			}
		}
		return { type: 'group', name: 'Memory', heading: 'Memory', items };
	}

	// ---- Support ----

	private supportGroup(): SettingDefinitionItem {
		return {
			type: 'group',
			name: 'Support',
			heading: '🙏 Support',
			items: [
				this.row('Support curtis', undefined, (el) => {
					const supportBlurb = el.createEl('p', { cls: 'ai-setting-hint ai-support-blurb' });
					supportBlurb.setText(
						'Curtis is free and open source. If it saves you time, consider buying me a coffee or sponsoring the project on GitHub. Every contribution funds the next feature.'
					);
				}),
				this.row('Buy me a coffee', 'Buymeacoffee.com/jordannewell', (el) => {
					new Setting(el)
						.setName('Buy me a coffee')
						.setDesc('Buymeacoffee.com/jordannewell')
						.addButton((btn) => {
							btn.setButtonText('☕ Buy me a coffee')
								.setClass('mod-cta')
								.onClick(() => window.open('https://www.buymeacoffee.com/jordannewell', '_blank'));
						});
				}),
				this.row('GitHub sponsors', 'GitHub.com/sponsors/jordannewell', (el) => {
					new Setting(el)
						.setName('GitHub sponsors')
						.setDesc('GitHub.com/sponsors/jordannewell')
						.addButton((btn) => {
							btn.setButtonText('💛 Sponsor on GitHub')
								.onClick(() => window.open('https://github.com/sponsors/jordannewell', '_blank'));
						});
				}),
			],
		};
	}

	private openCustomProviderModal(existing?: ProviderDefinition, existingKey?: string): void {
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
					// Recreate the registry with new config
					this.plugin.providerRegistry.addCustomProvider(definition);
					this.plugin.providerRegistry.updateConfig(definition.id, config);
					this.update();
					new Notice(`Saved ${definition.name}`);
				})();
			},
			existing,
			existingKey
		).open();
	}
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
	app?: App
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
	else if (isAnthropic) {
		headers['x-api-key'] = apiKey;
		headers['anthropic-version'] = '2023-06-01';
	}

	const modelId = config.defaultModel || def.models[0]?.id || 'gpt-3.5-turbo';
	let body: string;
	if (isAnthropic) {
		body = JSON.stringify({
			model: modelId,
			max_tokens: 16,
			messages: [{ role: 'user', content: 'say ok' }],
		});
	} else {
		body = JSON.stringify({
			model: modelId,
			max_tokens: 16,
			messages: [{ role: 'user', content: 'say ok' }],
		});
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
