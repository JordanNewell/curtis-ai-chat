// Curtis Settings — defaults, settings tab UI

import { App, Notice, PluginSettingTab, Setting, requestUrl } from 'obsidian';
import type { CurtisSettings, ProviderConfig, ProviderDefinition } from './types';
import { PROVIDER_DEFINITIONS } from './providers/registry';
import { CustomProviderModal } from './ui/modals/custom-provider-modal';
import { FolderSuggestModal } from './ui/modals/folder-suggest-modal';
import { ImageSuggestModal } from './ui/modals/image-suggest-modal';
import { setApiKeyForProvider, getSecretStorage, resolveApiKey } from './core/secrets';
import type CurtisPlugin from './main';

export const DEFAULT_SETTINGS: CurtisSettings = {
	activeProvider: 'anthropic',
	activeModel: 'claude-sonnet-4-5-20250929',

	providerConfigs: Object.fromEntries(
		PROVIDER_DEFINITIONS.map((def) => [
			def.id,
			{
				enabled: def.id === 'anthropic',
				apiKey: '',
				defaultModel: def.models[0]?.id,
			} as ProviderConfig,
		])
	),

	customProviders: [],

	temperature: 0.7,
	maxTokens: 4096,
	systemPrompt: 'You are a helpful AI assistant integrated into Obsidian. Help the user with writing, analysis, coding, and knowledge management.',
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

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Curtis Settings' });

		// ---- Active Provider & Model ----
		containerEl.createEl('h3', { text: 'Active Provider' });

		const enabledProviders = PROVIDER_DEFINITIONS.filter(
			(d) => this.plugin.settings.providerConfigs[d.id]?.enabled
		);

		new Setting(containerEl)
			.setName('Active provider')
			.setDesc('Select the AI provider to use for chat')
			.addDropdown((dd) => {
				dd.addOption('', 'None configured');
				for (const def of enabledProviders) {
					dd.addOption(def.id, def.name);
				}
				dd.setValue(this.plugin.settings.activeProvider);
				dd.onChange(async (val) => {
					this.plugin.settings.activeProvider = val;
					const config = this.plugin.settings.providerConfigs[val];
					if (config?.defaultModel) {
						this.plugin.settings.activeModel = config.defaultModel;
					}
					await this.plugin.saveSettings();
					this.display();
				});
			});

		const activeDef = PROVIDER_DEFINITIONS.find((d) => d.id === this.plugin.settings.activeProvider);
		if (activeDef) {
			new Setting(containerEl)
				.setName('Active model')
				.setDesc('Select the model to use')
				.addDropdown((dd) => {
					const provider = this.plugin.providerRegistry.getProvider(activeDef.id);
					const models = provider?.models || activeDef.models;
					for (const m of models) {
						dd.addOption(m.id, `${m.name} (${(m.contextLength / 1000).toFixed(0)}K)`);
					}
					dd.setValue(this.plugin.settings.activeModel);
					dd.onChange(async (val) => {
						this.plugin.settings.activeModel = val;
						await this.plugin.saveSettings();
					});
				});
		}

		// ---- Provider Configuration ----
		containerEl.createEl('h3', { text: 'Provider Configuration' });
		const privacyNote = containerEl.createEl('p', {
			cls: 'ai-setting-hint ai-privacy-note',
		});
		privacyNote.innerHTML = '<strong>Privacy:</strong> Cloud providers (Anthropic, OpenAI, Gemini, etc.) send your chat content to their servers. For fully private, offline AI, enable <em>Ollama (Local)</em> — nothing leaves your machine.';

		for (const def of PROVIDER_DEFINITIONS) {
			const config = this.plugin.settings.providerConfigs[def.id] || {
				enabled: false,
				apiKey: '',
			};
			this.plugin.settings.providerConfigs[def.id] = config;

			const details = containerEl.createDiv({ cls: 'ai-provider-settings' });
			details.createEl('h4', { text: def.name });

			new Setting(details)
				.setName('Enable')
				.addToggle((toggle) => {
					toggle.setValue(config.enabled);
					toggle.onChange(async (val) => {
						config.enabled = val;
						await this.plugin.saveSettings();
						this.plugin.providerRegistry.updateConfig(def.id, config);
						this.display();
					});
				});

			if (def.authType === 'anthropic') {
				new Setting(details)
					.setName('API Key')
					.setDesc('Anthropic API key — stored in OS keychain when available')
					.addText((text) => {
						text.inputEl.type = 'password';
						text.setPlaceholder('sk-ant-...')
							.setValue(config.apiKey || '')
							.onChange(async (val) => {
								setApiKeyForProvider(this.app, def.id, config, val);
								await this.plugin.saveSettings();
								this.plugin.providerRegistry.updateConfig(def.id, config);
							});
					});
			} else if (def.authType === 'bearer') {
				const keyDesc = getSecretStorage(this.app)
					? `${def.name} API key — stored in OS keychain`
					: `${def.name} API key`;
				new Setting(details)
					.setName('API Key')
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
				new Setting(details)
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
				new Setting(details)
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
										this.display();
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

		// ---- Custom Providers ----
		containerEl.createEl('h3', { text: 'Custom Providers' });
		containerEl.createEl('p', {
			cls: 'ai-setting-hint',
			text: 'Add any OpenAI-compatible endpoint (LiteLLM, llama.cpp, Novita, DeepInfra, Portkey, Helicone, self-hosted servers, etc.).',
		});

		const customProviders = this.plugin.settings.customProviders;
		for (const def of customProviders) {
			const config = this.plugin.settings.providerConfigs[def.id] || { enabled: true, apiKey: '' };
			this.plugin.settings.providerConfigs[def.id] = config;

			const details = containerEl.createDiv({ cls: 'ai-provider-settings' });
			details.createEl('h4', { text: def.name });

			new Setting(details)
				.setName('Enable')
				.addToggle((t) => {
					t.setValue(config.enabled);
					t.onChange(async (val) => {
						config.enabled = val;
						await this.plugin.saveSettings();
						this.plugin.providerRegistry.updateConfig(def.id, config);
						this.display();
					});
				});

			new Setting(details)
				.setName('API key')
				.setDesc(getSecretStorage(this.app) ? 'Stored in OS keychain' : '')
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

			new Setting(details)
				.setName('Endpoint')
				.setDesc(def.endpoint)
				.addButton((b) => {
					b.setButtonText('Edit')
						.onClick(() => this.openCustomProviderModal(def, config.apiKey));
				})
				.addButton((b) => {
					b.setButtonText('Delete')
						.setWarning()
						.onClick(async () => {
							this.plugin.providerRegistry.removeCustomProvider(def.id);
							this.plugin.settings.customProviders = this.plugin.settings.customProviders.filter((p) => p.id !== def.id);
							delete this.plugin.settings.providerConfigs[def.id];
							await this.plugin.saveSettings();
							this.display();
							new Notice(`Deleted ${def.name}`);
						});
				});
		}

		new Setting(containerEl)
			.setName('Add custom provider')
			.setDesc('Configure any OpenAI-compatible endpoint')
			.addButton((b) => {
				b.setButtonText('+ Add')
					.setClass('mod-cta')
					.onClick(() => this.openCustomProviderModal());
			});

		// ---- Generation Settings ----
		containerEl.createEl('h3', { text: 'Generation' });

		new Setting(containerEl)
			.setName('Temperature')
			.setDesc('Higher = more creative, lower = more focused (0.0 - 2.0)')
			.addSlider((slider) => {
				slider
					.setLimits(0, 2, 0.1)
					.setValue(this.plugin.settings.temperature)
					.setDynamicTooltip()
					.onChange(async (val) => {
						this.plugin.settings.temperature = val;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Max tokens')
			.setDesc('Maximum response length')
			.addText((text) => {
				text
					.setValue(String(this.plugin.settings.maxTokens))
					.onChange(async (val) => {
						const n = parseInt(val, 10);
						if (!isNaN(n) && n > 0) {
							this.plugin.settings.maxTokens = n;
							await this.plugin.saveSettings();
						}
					});
			});

		new Setting(containerEl)
			.setName('System prompt')
			.setDesc('Instructions for the AI assistant')
			.addTextArea((text) => {
				text
					.setValue(this.plugin.settings.systemPrompt)
					.onChange(async (val) => {
						this.plugin.settings.systemPrompt = val;
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 4;
			});

		new Setting(containerEl)
			.setName('Stream responses')
			.setDesc('Show AI responses as they are generated')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.streamResponse);
				toggle.onChange(async (val) => {
					this.plugin.settings.streamResponse = val;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName('Show token usage')
			.setDesc('Display token counts after each response')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.showTokenUsage);
				toggle.onChange(async (val) => {
					this.plugin.settings.showTokenUsage = val;
					await this.plugin.saveSettings();
				});
			});

		// ---- Chat UI ----
		containerEl.createEl('h3', { text: 'Chat UI' });

		new Setting(containerEl)
			.setName('Enter key behavior')
			.setDesc('Choose what Enter does in the chat input.')
			.addDropdown((dd) => {
				dd.addOption('send', 'Enter = send · Shift+Enter = newline');
				dd.addOption('newline', 'Enter = newline · Ctrl/Cmd+Enter = send');
				dd.setValue(this.plugin.settings.enterKeyBehavior);
				dd.onChange(async (val) => {
					this.plugin.settings.enterKeyBehavior = val as 'send' | 'newline';
					await this.plugin.saveSettings();
					this.plugin.refreshAllChatViews();
				});
			});

		new Setting(containerEl)
			.setName('Chat panel position')
			.addDropdown((dd) => {
				dd.addOption('right', 'Right');
				dd.addOption('left', 'Left');
				dd.setValue(this.plugin.settings.chatViewPosition);
				dd.onChange(async (val) => {
					this.plugin.settings.chatViewPosition = val as 'right' | 'left';
					await this.plugin.saveSettings();
				});
			});

	new Setting(containerEl)
		.setName('Chat panel width')
		.setDesc('Width in pixels')
		.addText((text) => {
			text.setValue(String(this.plugin.settings.chatWidth)).onChange(async (val) => {
				const n = parseInt(val, 10);
				if (!isNaN(n) && n >= 200) {
					this.plugin.settings.chatWidth = n;
					await this.plugin.saveSettings();
				}
			});
		});

	// ---- Notes ----
	containerEl.createEl('h3', { text: 'Notes' });

	new Setting(containerEl)
		.setName('Note save folder')
		.setDesc('Where "Save as note" and the /note slash command save new notes. Empty = vault root.')
		.addText((text) => {
			text.setPlaceholder('AI Notes')
				.setValue(this.plugin.settings.noteSaveFolder)
				.onChange(async (val) => {
					this.plugin.settings.noteSaveFolder = val.trim();
					await this.plugin.saveSettings();
				});
		})
		.addButton((btn) => {
			btn.setIcon('folder').setTooltip('Browse…').onClick(() => {
				new FolderSuggestModal(this.app, async (path) => {
					this.plugin.settings.noteSaveFolder = path;
					await this.plugin.saveSettings();
					this.display();
				}).open();
			});
		});

	new Setting(containerEl)
		.setName('Auto-save assistant responses')
		.setDesc('Silently save each completed assistant message as a note. Folder below.')
		.addToggle((toggle) => {
			toggle.setValue(this.plugin.settings.autoSaveAssistantResponses);
			toggle.onChange(async (val) => {
				this.plugin.settings.autoSaveAssistantResponses = val;
				await this.plugin.saveSettings();
			});
		});

	new Setting(containerEl)
		.setName('Auto-save folder')
		.setDesc('Defaults to the Note save folder above when empty.')
		.addText((text) => {
			text.setPlaceholder('AI Responses')
				.setValue(this.plugin.settings.autoSaveFolder)
				.onChange(async (val) => {
					this.plugin.settings.autoSaveFolder = val.trim();
					await this.plugin.saveSettings();
				});
		})
		.addButton((btn) => {
			btn.setIcon('folder').setTooltip('Browse…').onClick(() => {
				new FolderSuggestModal(this.app, async (path) => {
					this.plugin.settings.autoSaveFolder = path;
					await this.plugin.saveSettings();
					this.display();
				}).open();
			});
		});

	// ---- Chat Background ----
	containerEl.createEl('h3', { text: 'Chat Background' });

	new Setting(containerEl)
		.setName('Background style')
		.setDesc('"Theme" uses your Obsidian theme colors. "Wallpaper" uses the image picked below.')
		.addDropdown((dd) => {
			dd.addOption('theme', 'Theme (default)');
			dd.addOption('wallpaper', 'Wallpaper image');
			dd.setValue(this.plugin.settings.chatBackground);
			dd.onChange(async (val) => {
				this.plugin.settings.chatBackground = val as 'theme' | 'wallpaper';
				await this.plugin.saveSettings();
				this.plugin.refreshAllChatViews();
			});
		});

	new Setting(containerEl)
		.setName('Wallpaper image')
		.setDesc('Pick any image file in your vault.')
		.addText((text) => {
			text.setPlaceholder('attachments/wallpaper.png')
				.setValue(this.plugin.settings.chatWallpaperPath)
				.onChange(async (val) => {
					this.plugin.settings.chatWallpaperPath = val.trim();
					await this.plugin.saveSettings();
					this.plugin.refreshAllChatViews();
				});
		})
		.addButton((btn) => {
			btn.setIcon('image').setTooltip('Pick image from vault').onClick(() => {
				new ImageSuggestModal(this.app, async (path) => {
					this.plugin.settings.chatWallpaperPath = path;
					this.plugin.settings.chatBackground = 'wallpaper';
					await this.plugin.saveSettings();
					this.display();
					this.plugin.refreshAllChatViews();
				}).open();
			});
		});

	// ---- Memory ----
	containerEl.createEl('h3', { text: 'Memory' });

	new Setting(containerEl)
		.setName('Enable memory')
		.setDesc('Inject remembered facts about the user into each prompt')
		.addToggle((toggle) => {
			toggle.setValue(this.plugin.settings.enableMemory);
			toggle.onChange(async (val) => {
				this.plugin.settings.enableMemory = val;
				await this.plugin.saveSettings();
			});
		});

	new Setting(containerEl)
		.setName('Auto-capture facts')
		.setDesc('After each turn, ask the model to extract durable facts. Off = manual only (/remember, right-click).')
		.addDropdown((dd) => {
			dd.addOption('off', 'Off (manual only)');
			dd.addOption('auto', 'Auto-extract after each turn');
			dd.setValue(this.plugin.settings.memoryCaptureMode);
			dd.onChange(async (val) => {
				this.plugin.settings.memoryCaptureMode = val as 'off' | 'auto';
				await this.plugin.saveSettings();
			});
		});

	new Setting(containerEl)
		.setName('Memory file path')
		.setDesc('Markdown file where facts are stored. Editable by hand.')
		.addText((text) => {
			text.setPlaceholder('AI/Curtis Memory.md')
				.setValue(this.plugin.settings.memoryFilePath)
				.onChange(async (val) => {
					this.plugin.settings.memoryFilePath = val.trim() || 'AI/Curtis Memory.md';
					await this.plugin.saveSettings();
					await this.plugin.memoryStore.reload(this.plugin);
				});
		})
		.addButton((btn) => {
			btn.setIcon('folder').setTooltip('Browse…').onClick(() => {
				new FolderSuggestModal(this.app, async (path) => {
					// FolderSuggestModal picks a folder; append default filename.
					const fname = 'Curtis Memory.md';
					this.plugin.settings.memoryFilePath = path ? `${path}/${fname}` : fname;
					await this.plugin.saveSettings();
					await this.plugin.memoryStore.reload(this.plugin);
					this.display();
				}).open();
			});
		})
		.addButton((btn) => {
			btn.setButtonText('Open').setTooltip('Open memory file').onClick(async () => {
				await this.plugin.memoryStore.ensureFile();
				const p = this.plugin.settings.memoryFilePath;
				const file = this.app.vault.getAbstractFileByPath(p);
				if (file) await this.app.workspace.openLinkText(p, '', false);
			});
		})
		.addButton((btn) => {
			btn.setButtonText('Clear').setWarning().setTooltip('Delete all facts').onClick(async () => {
				await this.plugin.memoryStore.clear();
				new Notice('Memory cleared');
			});
		});

		// ---- Support ----
		containerEl.createEl('h3', { text: '🙏 Support Curtis' });
		const supportBlurb = containerEl.createEl('p', {
			cls: 'ai-setting-hint ai-support-blurb',
		});
		supportBlurb.setText(
			'Curtis is free and open source. If it saves you time, consider buying me a coffee or sponsoring the project on GitHub. Every contribution funds the next feature.'
		);

		new Setting(containerEl)
			.setName('Buy Me a Coffee')
			.setDesc('buymeacoffee.com/jordannewell')
			.addButton((btn) => {
				btn.setButtonText('☕ Buy me a coffee')
					.setClass('mod-cta')
					.onClick(() => window.open('https://www.buymeacoffee.com/jordannewell', '_blank'));
			});

		new Setting(containerEl)
			.setName('GitHub Sponsors')
			.setDesc('github.com/sponsors/jordannewell')
			.addButton((btn) => {
				btn.setButtonText('💛 Sponsor on GitHub')
					.onClick(() => window.open('https://github.com/sponsors/jordannewell', '_blank'));
			});
	}

	private openCustomProviderModal(existing?: ProviderDefinition, existingKey?: string): void {
		new CustomProviderModal(
			this.app,
			async ({ definition, apiKey }) => {
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
				this.display();
				new Notice(`Saved ${definition.name}`);
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
