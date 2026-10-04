// Curtis Settings — defaults, settings tab UI

import { App, Notice, PluginSettingTab, Setting, requestUrl } from 'obsidian';
import type { SettingDefinitionItem, SettingDefinitionRender } from 'obsidian';
import type { CurtisSettings, ProviderConfig, ProviderDefinition, McpServerConfig } from './types';
import { PROVIDER_DEFINITIONS } from './providers/registry';
import { CustomProviderModal } from './ui/modals/custom-provider-modal';
import { McpServerModal } from './ui/modals/mcp-server-modal';
import { FolderSuggestModal } from './ui/modals/folder-suggest-modal';
import { ImageSuggestModal } from './ui/modals/image-suggest-modal';
import { EditFactModal } from './ui/modals/edit-fact-modal';
import { CORE_SYSTEM_PROMPT } from './core/system-prompt';
import { setApiKeyForProvider, getSecretStorage, resolveApiKey } from './core/secrets';
import { rebuildIndexWithProgress } from './rag';
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

	noteSaveFolder: 'AI Notes',
	autoSaveAssistantResponses: false,
	autoSaveFolder: '',

	enterKeyBehavior: 'send',
	chatBackground: 'theme',
	chatWallpaperPath: '',

	enableMemory: true,
	memoryCaptureMode: 'auto',
	memoryFilePath: 'AI/Curtis Memory.md',

	conversationsFolder: 'AI/Conversations',

	enableRag: false,
	ragChunkSize: 500,
	ragChunkOverlap: 50,
	ragTopK: 5,
	ragEmbeddingProvider: 'openai',
	ragEmbeddingModel: 'text-embedding-3-small',

	enableAgent: false,
	agentMaxTurns: 5,
	enableWebSearch: false,
	enableMcp: false,
	mcpServers: [],
	showDaySeparators: true,
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
			this.mcpGroup(),
			this.chatUIGroup(),
			this.notesGroup(),
			this.backgroundGroup(),
				this.memoryGroup(),
				this.ragGroup(),
				this.conversationsGroup(),
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
		} else if (def.authType === 'bearer') {
			const keyDesc = getSecretStorage(this.app)
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
					// and updateConfig() recreates from the STALE one.
					this.plugin.providerRegistry.removeCustomProvider(definition.id);
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
	// Same minimal body for both dialects (model + max_tokens + messages is
	// valid OpenAI-compat AND Anthropic shape) — auth + reachability is all
	// this test validates.
	const body = JSON.stringify({
		model: modelId,
		max_tokens: 16,
		messages: [{ role: 'user', content: 'say ok' }],
	});

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
