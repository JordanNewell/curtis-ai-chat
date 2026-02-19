import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import {
	AIProvider,
	ProviderSettings,
	createProvider,
	getModelsForProvider,
	estimateCost
} from './providers';
import { createDefaultGeminiOAuth, GeminiOAuthManualFlow } from './oauth';
import { ConversationManager, Conversation } from './conversation';
import { TemplateManager, PromptTemplate } from './templates';
import {
	VaultIndexer,
	PremiumSettings,
	createDefaultPremiumSettings,
	NoteMetadata
} from './vault-indexer';
import { LinkIntelligence, LinkSuggestion } from './link-intelligence';
import {
	DailyNotesAssistant,
	DailyNoteAnalysis,
	JournalPrompt,
	createDefaultJournalPrompts
} from './daily-notes-assistant';
import {
	VaultIntelligence,
	VaultInsights,
	VaultRecommendation
} from './vault-intelligence';
import { MemoryClient } from './MemoryClient';

// ============================================================================
// PLUGIN SETTINGS
// ============================================================================

interface MultiProviderPluginSettings extends PremiumSettings {
	// Provider selection
	provider: 'claude' | 'glm' | 'gemini';

	// Claude settings
	claudeApiKey: string;
	claudeModel: string;

	// GLM settings
	glmApiKey: string;
	glmEndpoint: string;
	glmModel: string;

	// Gemini settings (OAuth only)
	geminiOAuthToken?: string;
	geminiRefreshToken?: string;
	geminiOAuthClientId?: string;
	geminiOAuthClientSecret?: string;
	geminiModel: string;

	// Shared settings
	temperature: number;
	maxTokens: number;
	systemPrompt: string;
	streamResponse: boolean;
	showTokenUsage: boolean;
	chatHistoryFile: string;

	// Enhanced settings
	enableCostTracking: boolean;
	budgetLimit?: number;
	defaultConversationTemplate?: string;
}

const DEFAULT_SETTINGS: MultiProviderPluginSettings = {
	// Premium features defaults
	...createDefaultPremiumSettings(),

	// Provider selection
	provider: 'glm',
	claudeApiKey: '',
	claudeModel: 'claude-sonnet-4-5-20250929',
	glmApiKey: '',
	glmEndpoint: 'https://api.z.ai/api/paas/v4/chat/completions',
	glmModel: 'glm-4.7',
	geminiOAuthToken: undefined,
	geminiRefreshToken: undefined,
	geminiOAuthClientId: '',
	geminiOAuthClientSecret: '',
	geminiModel: 'gemini-2.5-flash',
	temperature: 0.7,
	maxTokens: 4096,
	systemPrompt: 'You are a helpful AI assistant integrated into Obsidian. Help the user with writing, analysis, coding, and knowledge management.',
	streamResponse: true,
	showTokenUsage: true,
	chatHistoryFile: 'AI Chat History.md',
	enableCostTracking: true,
	budgetLimit: undefined,
	defaultConversationTemplate: undefined,
};

// ============================================================================
// MAIN PLUGIN CLASS
// ============================================================================

export default class MultiProviderAIPlugin extends Plugin {
	settings: MultiProviderPluginSettings;
	chatHistory: any[][] = [];
	currentChatIndex = -1;
	providers: Map<string, AIProvider> = new Map();
	geminiOAuth?: GeminiOAuthManualFlow;
	conversationManager: ConversationManager;
	templateManager: TemplateManager;
	vaultIndexer?: VaultIndexer;
	linkIntelligence?: LinkIntelligence;
	dailyNotesAssistant?: DailyNotesAssistant;
	vaultIntelligence?: VaultIntelligence;
	memoryClient: MemoryClient;

	async onload() {
		await this.loadSettings();

		// Initialize managers
		this.conversationManager = new ConversationManager('');
		this.templateManager = new TemplateManager();

		// Initialize memory client
		this.memoryClient = new MemoryClient(this.app, {
			sessionId: `obsidian_${Date.now()}`
		});
		console.log('[GLM Plugin] Memory client initialized');

		// Initialize VaultIndexer for premium features
		if (this.settings.enablePremiumFeatures) {
			this.vaultIndexer = new VaultIndexer(this.app, this.settings);

			// Initialize LinkIntelligence
			this.linkIntelligence = new LinkIntelligence(this.vaultIndexer, this.settings);

			// Initialize DailyNotesAssistant
			this.dailyNotesAssistant = new DailyNotesAssistant(
				this.app,
				this.vaultIndexer,
				this.settings,
				(messages) => this.callAI(messages)
			);

			// Initialize VaultIntelligence
			this.vaultIntelligence = new VaultIntelligence(
				this.vaultIndexer,
				this.linkIntelligence,
				this.dailyNotesAssistant,
				this
			);

			// Register vault event handlers
			this.registerEvent(
				this.app.vault.on('create', async (file) => {
					if (file instanceof TFile && file.extension === 'md') {
						await this.vaultIndexer?.indexFile(file);
					}
				})
			);

			this.registerEvent(
				this.app.vault.on('modify', async (file) => {
					if (file instanceof TFile && file.extension === 'md') {
						await this.vaultIndexer?.indexFile(file);
					}
				})
			);

			this.registerEvent(
				this.app.vault.on('delete', (file) => {
					if (file instanceof TFile && file.extension === 'md') {
						this.vaultIndexer?.removeFile(file.path);
					}
				})
			);

			// Register workspace event for daily notes detection
			this.registerEvent(
				this.app.workspace.on('file-open', async (file) => {
					if (file && file.extension === 'md' && this.dailyNotesAssistant && this.settings.enableDailyNotesAssistant) {
						if (this.dailyNotesAssistant.isDailyNote(file.path)) {
							await this.dailyNotesAssistant.autoProcessDailyNote();
						}
					}
				})
			);

			// Initial index
			new Notice('AI Plugin: Indexing vault...', 3000);
			await this.vaultIndexer.indexVault();
			const stats = this.vaultIndexer.getVaultStats();
			new Notice(`AI Plugin: Indexed ${stats.totalNotes} notes`, 3000);
		}

		this.initializeProviders();

		// Ribbon icon
		this.addRibbonIcon('bot', 'Open AI Chat', () => {
			new AIChatModal(this.app, this).open();
		});

		// Commands
		this.addCommand({
			id: 'open-ai-chat',
			name: 'Open AI Chat',
			callback: () => {
				new AIChatModal(this.app, this).open();
			},
		});

		this.addCommand({
			id: 'ai-generate-from-selection',
			name: 'Generate text from selection',
			editorCheckCallback: (checking: boolean, editor: Editor, view: MarkdownView) => {
				const selection = editor.getSelection();
				if (!selection) return false;

				if (!checking) {
					this.processSelection(editor, selection, 'generate');
				}
				return true;
			},
		});

		this.addCommand({
			id: 'ai-summarize-selection',
			name: 'Summarize selection',
			editorCheckCallback: (checking: boolean, editor: Editor, view: MarkdownView) => {
				const selection = editor.getSelection();
				if (!selection) return false;

				if (!checking) {
					this.processSelection(editor, selection, 'summarize');
				}
				return true;
			},
		});

		this.addCommand({
			id: 'ai-explain-selection',
			name: 'Explain selection',
			editorCheckCallback: (checking: boolean, editor: Editor, view: MarkdownView) => {
				const selection = editor.getSelection();
				if (!selection) return false;

				if (!checking) {
					this.processSelection(editor, selection, 'explain');
				}
				return true;
			},
		});

		this.addCommand({
			id: 'ai-refine-selection',
			name: 'Improve writing of selection',
			editorCheckCallback: (checking: boolean, editor: Editor, view: MarkdownView) => {
				const selection = editor.getSelection();
				if (!selection) return false;

				if (!checking) {
					this.processSelection(editor, selection, 'refine');
				}
				return true;
			},
		});

		this.addCommand({
			id: 'ai-code-review',
			name: 'Review code selection',
			editorCheckCallback: (checking: boolean, editor: Editor, view: MarkdownView) => {
				const selection = editor.getSelection();
				if (!selection) return false;

				if (!checking) {
					this.processSelection(editor, selection, 'code-review');
				}
				return true;
			},
		});

		this.addCommand({
			id: 'ai-explain-code',
			name: 'Explain code selection',
			editorCheckCallback: (checking: boolean, editor: Editor, view: MarkdownView) => {
				const selection = editor.getSelection();
				if (!selection) return false;

				if (!checking) {
					this.processSelection(editor, selection, 'explain-code');
				}
				return true;
			},
		});

		// Conversation history commands
		this.addCommand({
			id: 'ai-show-conversations',
			name: 'Show conversation history',
			callback: () => {
				new ConversationHistoryModal(this.app, this).open();
			},
		});

		this.addCommand({
			id: 'ai-export-conversation',
			name: 'Export current conversation',
			callback: () => {
				this.exportCurrentConversation();
			},
		});

		this.addCommand({
			id: 'ai-show-stats',
			name: 'Show usage statistics',
			callback: () => {
				new StatsModal(this.app, this).open();
			},
		});

		this.addCommand({
			id: 'ai-show-templates',
			name: 'Show prompt templates',
			callback: () => {
				new TemplatesModal(this.app, this).open();
			},
		});

		// Premium feature commands
		this.addCommand({
			id: 'ai-suggest-backlinks',
			name: 'Suggest backlinks for current note',
			editorCheckCallback: (checking: boolean, editor: Editor, view: MarkdownView) => {
				if (!this.settings.enablePremiumFeatures || !this.settings.enableLinkSuggestions) return false;
				const file = view.file;
				if (!file || !this.vaultIndexer) return false;

				if (!checking) {
					this.showBacklinkSuggestions(file.path);
				}
				return true;
			},
		});

		this.addCommand({
			id: 'ai-show-vault-stats',
			name: 'Show vault statistics',
			callback: () => {
				if (!this.settings.enablePremiumFeatures || !this.vaultIndexer) {
					new Notice('Enable premium features to use vault statistics');
					return;
				}
				this.showVaultStats();
			},
		});

		// Daily notes commands
		this.addCommand({
			id: 'ai-analyze-daily-note',
			name: 'Analyze current daily note',
			editorCheckCallback: (checking: boolean, editor: Editor, view: MarkdownView) => {
				if (!this.settings.enablePremiumFeatures || !this.settings.enableDailyNotesAssistant) return false;
				const file = view.file;
				if (!file || !this.dailyNotesAssistant) return false;
				if (!this.dailyNotesAssistant.isDailyNote(file.path)) return false;

				if (!checking) {
					this.analyzeDailyNote(file.path);
				}
				return true;
			},
		});

		this.addCommand({
			id: 'ai-generate-journal-prompts',
			name: 'Generate journal prompts',
			callback: () => {
				if (!this.settings.enablePremiumFeatures || !this.dailyNotesAssistant) {
					new Notice('Enable premium features and daily notes assistant to use journal prompts');
					return;
				}
				this.generateJournalPrompts();
			},
		});

		this.addCommand({
			id: 'ai-extract-daily-tasks',
			name: 'Extract tasks from daily note',
			editorCheckCallback: (checking: boolean, editor: Editor, view: MarkdownView) => {
				if (!this.settings.enablePremiumFeatures || !this.settings.enableDailyNotesAssistant) return false;
				const file = view.file;
				if (!file || !this.dailyNotesAssistant) return false;
				if (!this.dailyNotesAssistant.isDailyNote(file.path)) return false;

				if (!checking) {
					this.extractDailyTasks(file.path);
				}
				return true;
			},
		});

		// Vault intelligence command
		this.addCommand({
			id: 'ai-show-vault-intelligence',
			name: 'Show vault intelligence dashboard',
			callback: () => {
				if (!this.settings.enablePremiumFeatures || !this.vaultIntelligence) {
					new Notice('Enable premium features to use vault intelligence');
					return;
				}
				this.showVaultIntelligenceDashboard();
			},
		});

		// Settings tab
		this.addSettingTab(new MultiProviderSettingTab(this.app, this));

		console.log('Multi-Provider AI Plugin loaded');
	}

	onunload() {
		console.log('Multi-Provider AI Plugin unloaded');
	}

	initializeProviders() {
		// Initialize Gemini OAuth if credentials are provided
		if (this.settings.geminiOAuthClientId && this.settings.geminiOAuthClientSecret) {
			this.geminiOAuth = createDefaultGeminiOAuth(
				this.settings.geminiOAuthClientId,
				this.settings.geminiOAuthClientSecret
			);

			// Restore tokens if available
			if (this.settings.geminiOAuthToken && this.settings.geminiRefreshToken) {
				this.geminiOAuth.restoreTokens({
					access_token: this.settings.geminiOAuthToken,
					refresh_token: this.settings.geminiRefreshToken,
				});
			}
		}

		// Create provider instances
		this.providers.set('claude', createProvider('claude', this.settings));
		this.providers.set('glm', createProvider('glm', this.settings));
		this.providers.set('gemini', createProvider('gemini', this.settings));
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		// Save Gemini OAuth tokens if available
		if (this.geminiOAuth) {
			const tokens = this.geminiOAuth.getTokensForStorage();
			this.settings.geminiOAuthToken = tokens.access_token;
			this.settings.geminiRefreshToken = tokens.refresh_token;
		}
		await this.saveData(this.settings);
	}

	getCurrentProvider(): AIProvider {
		const provider = this.providers.get(this.settings.provider);
		if (!provider) {
			throw new Error(`Provider ${this.settings.provider} not configured`);
		}
		return provider;
	}

	getCurrentModel(): string {
		switch (this.settings.provider) {
			case 'claude':
				return this.settings.claudeModel;
			case 'glm':
				return this.settings.glmModel;
			case 'gemini':
				return this.settings.geminiModel;
		}
	}

	// ============================================================================
	// PREMIUM FEATURES METHODS
	// ============================================================================

	async showBacklinkSuggestions(path: string) {
		if (!this.linkIntelligence || !this.vaultIndexer) {
			new Notice('Link intelligence not available');
			return;
		}

		new Notice('Finding link suggestions...', 2000);

		try {
			const suggestions = await this.linkIntelligence.getBacklinkSuggestions(path);

			if (suggestions.length === 0) {
				new Notice('No link suggestions found');
				return;
			}

			// Show suggestions in a modal
			new LinkSuggestionsModal(this.app, suggestions, this).open();
		} catch (error: any) {
			new Notice(`Error getting suggestions: ${error.message}`);
		}
	}

	showVaultStats() {
		if (!this.vaultIndexer) {
			new Notice('Vault indexer not available');
			return;
		}

		const stats = this.vaultIndexer.getVaultStats();

		// Create a simple stats display modal
		const content = `
## Vault Statistics

- **Total Notes:** ${stats.totalNotes}
- **Total Words:** ${stats.totalWords.toLocaleString()}
- **Total Tags:** ${stats.totalTags}
- **Total Links:** ${stats.totalLinks}
- **Orphaned Notes:** ${stats.orphanedNotes}

### Most Linked Notes
${stats.mostLinkedNotes.slice(0, 5).map(note => `- ${note.basename} (${note.backlinks.length} backlinks)`).join('\n')}

### Largest Notes
${stats.largestNotes.slice(0, 5).map(note => `- ${note.basename} (${note.wordCount.toLocaleString()} words)`).join('\n')}
		`;

		new VaultStatsModal(this.app, 'Vault Statistics', content).open();
	}

	// ============================================================================
	// DAILY NOTES METHODS
	// ============================================================================

	async analyzeDailyNote(path: string) {
		if (!this.dailyNotesAssistant) {
			new Notice('Daily notes assistant not available');
			return;
		}

		new Notice('Analyzing daily note...', 2000);

		try {
			const analysis = await this.dailyNotesAssistant.analyzeDailyNote(path);
			new DailyNoteAnalysisModal(this.app, analysis, this).open();
		} catch (error: any) {
			new Notice(`Error analyzing daily note: ${error.message}`);
		}
	}

	async generateJournalPrompts() {
		if (!this.dailyNotesAssistant) {
			new Notice('Daily notes assistant not available');
			return;
		}

		new Notice('Generating journal prompts...', 2000);

		try {
			const prompts = await this.dailyNotesAssistant.generatePrompts(7);
			new JournalPromptsModal(this.app, prompts, this).open();
		} catch (error: any) {
			new Notice(`Error generating prompts: ${error.message}`);
		}
	}

	async extractDailyTasks(path: string) {
		if (!this.dailyNotesAssistant) {
			new Notice('Daily notes assistant not available');
			return;
		}

		new Notice('Extracting tasks...', 2000);

		try {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) {
				new Notice('File not found');
				return;
			}

			const content = await this.app.vault.read(file);
			const tasks = await this.dailyNotesAssistant.extractTasks(content);

			if (tasks.length === 0) {
				new Notice('No tasks found in this note');
				return;
			}

			// Format tasks for display
			const taskList = tasks.map(t => {
				const status = t.completed ? 'x' : ' ';
				const priority = t.priority ? ` [${t.priority.toUpperCase()}]` : '';
				const category = t.category ? ` #${t.category}` : '';
				return `- [${status}] ${t.text}${priority}${category}`;
			}).join('\n');

			const contentDisplay = `
## Extracted Tasks (${tasks.length})

${taskList}
			`;

			new ExtractedTasksModal(this.app, 'Extracted Tasks', contentDisplay, tasks, path, this).open();
		} catch (error: any) {
			new Notice(`Error extracting tasks: ${error.message}`);
		}
	}

	// ============================================================================
	// VAULT INTELLIGENCE METHODS
	// ============================================================================

	async showVaultIntelligenceDashboard() {
		if (!this.vaultIntelligence || !this.vaultIndexer) {
			new Notice('Vault intelligence not available');
			return;
		}

		new Notice('Analyzing vault...', 3000);

		try {
			const insights = await this.vaultIntelligence.generateInsights();
			new VaultIntelligenceModal(this.app, insights, this).open();
		} catch (error: any) {
			new Notice(`Error analyzing vault: ${error.message}`);
		}
	}

	async callAI(messages: any[], onChunk?: (chunk: string) => void): Promise<{ content: string; usage?: any }> {
		const provider = this.getCurrentProvider();

		// Check authentication
		if (!provider.isAuthenticated()) {
			await provider.authenticate();
		}

		const options = {
			model: this.getCurrentModel(),
			temperature: this.settings.temperature,
			maxTokens: this.settings.maxTokens,
			stream: this.settings.streamResponse && !!onChunk && provider.supportsStreaming,
		};

		try {
			const request = provider.formatRequest(messages, options);
			const response = await fetch(provider.endpoint, request);

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`API returned ${response.status}: ${errorText}`);
			}

			// Use real streaming if enabled and supported
			if (options.stream && onChunk) {
				let fullContent = '';
				let finalUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;

				await provider.parseStream(
					response,
					(chunk) => {
						fullContent += chunk;
						onChunk(chunk);
					},
					(usage) => {
						finalUsage = usage;
						if (this.settings.showTokenUsage) {
							new Notice(`Tokens: ${usage.promptTokens} prompt, ${usage.completionTokens} completion`);
						}

						// Track cost if enabled
						if (this.settings.enableCostTracking) {
							const cost = estimateCost(provider, options.model, usage.promptTokens, usage.completionTokens);
							if (cost && this.settings.budgetLimit) {
								const stats = this.conversationManager.getStats();
								const totalCost = stats.totalCost + cost;
								if (totalCost > this.settings.budgetLimit) {
									new Notice(`⚠️ Budget warning: Cost $${totalCost.toFixed(4)} exceeds limit of $${this.settings.budgetLimit}`);
								}
							}
						}
					}
				);

				return { content: fullContent, usage: finalUsage };
			} else {
				// Non-streaming fallback
				const result = await provider.parseResponse(response);

				if (this.settings.showTokenUsage && result.usage) {
					new Notice(`Tokens: ${result.usage.promptTokens} prompt, ${result.usage.completionTokens} completion`);
				}

				// Still deliver chunks for UI consistency
				if (onChunk && result.content) {
					const chunkSize = 20;
					for (let i = 0; i < result.content.length; i += chunkSize) {
						const chunk = result.content.slice(i, i + chunkSize);
						onChunk(chunk);
						await new Promise(resolve => setTimeout(resolve, 10));
					}
				}

				return result;
			}
		} catch (error: any) {
			throw new Error(`${provider.name} API error: ${error.message}`);
		}
	}

	async processSelection(editor: Editor, selection: string, action: string) {
		const systemPrompts: Record<string, string> = {
			'generate': 'Generate content based on the user\'s request.',
			'summarize': 'Provide a concise summary of the given text. Highlight key points.',
			'explain': 'Explain the given text in clear, simple terms. Break down complex concepts.',
			'refine': 'Improve the writing quality of the given text. Fix grammar, enhance clarity, and maintain the original meaning.',
			'code-review': 'Review the code for bugs, security issues, performance problems, and best practices. Provide specific suggestions.',
			'explain-code': 'Explain what the code does, how it works, and any important patterns or concepts used.',
		};

		const userPrompts: Record<string, (text: string) => string> = {
			'generate': (text) => text,
			'summarize': (text) => `Please summarize this:\n\n${text}`,
			'explain': (text) => `Please explain this:\n\n${text}`,
			'refine': (text) => `Please improve this text while maintaining its meaning:\n\n${text}`,
			'code-review': (text) => `Please review this code:\n\n\`\`\`\n${text}\n\`\`\``,
			'explain-code': (text) => `Please explain what this code does:\n\n\`\`\`\n${text}\n\`\`\``,
		};

		new Notice(`AI: ${action}...`, 2000);

		try {
			const messages: any[] = [
				{ role: 'system', content: systemPrompts[action] },
				{ role: 'user', content: userPrompts[action](selection) },
			];

			let result = '';
			const modal = new AIProcessingModal(this.app, action);
			modal.open();

			const { content } = await this.callAI(messages, (chunk) => {
				result += chunk;
				modal.updateContent(result);
			});

			modal.close();

			// Insert or replace based on action
			if (action === 'generate') {
				const cursor = editor.getCursor();
				editor.replaceRange(`\n${content}\n`, cursor);
			} else {
				editor.replaceSelection(content);
			}

			new Notice(`${action} complete!`);
		} catch (error: any) {
			new Notice(`Error: ${error.message}`);
		}
	}

	startNewChat(): void {
		this.chatHistory.push([]);
		this.currentChatIndex = this.chatHistory.length - 1;
	}

	addToChatHistory(message: any): void {
		if (this.currentChatIndex >= 0 && this.chatHistory[this.currentChatIndex]) {
			this.chatHistory[this.currentChatIndex].push(message);
		}
	}

	getCurrentChat(): any[] {
		if (this.currentChatIndex >= 0 && this.chatHistory[this.currentChatIndex]) {
			return this.chatHistory[this.currentChatIndex];
		}
		return [];
	}

	async exportCurrentConversation(): Promise<void> {
		const currentConversation = this.conversationManager.getCurrentConversation();
		if (!currentConversation) {
			new Notice('No active conversation to export');
			return;
		}

		try {
			const markdown = await this.conversationManager.exportToFile(currentConversation.id);
			const filename = `AI Chat - ${currentConversation.title.replace(/[^a-zA-Z0-9]/g, '_')}.md`;

			// Write to vault
			const file = await this.app.vault.create(filename, markdown);
			new Notice(`Exported to ${file.path}`);
		} catch (error: any) {
			new Notice(`Export failed: ${error.message}`);
		}
	}
}

// ============================================================================
// CHAT MODAL
// ============================================================================

class AIChatModal extends Modal {
	plugin: MultiProviderAIPlugin;
	chatContainer: HTMLElement;
	inputEl: HTMLTextAreaElement;
	sendButton: HTMLButtonElement;
	modelSelect: HTMLSelectElement;
	messages: any[] = [];
	isGenerating = false;
	templateId?: string;

	constructor(app: App, plugin: MultiProviderAIPlugin, templateId?: string) {
		super(app);
		this.plugin = plugin;
		this.templateId = templateId;
		this.plugin.startNewChat();
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass('ai-chat-modal');

		contentEl.createEl('h2', { text: '🤖 AI Chat' });

		// Provider and model selector
		const selectorContainer = contentEl.createDiv({ cls: 'ai-model-selector' });

		// Provider selector
		const providerContainer = selectorContainer.createDiv({ cls: 'ai-provider-selector' });
		providerContainer.createSpan({ text: 'Provider: ' });

		const providerSelect = providerContainer.createEl('select');
		providerSelect.createEl('option', { value: 'claude', text: 'Claude' });
		providerSelect.createEl('option', { value: 'glm', text: 'GLM' });
		providerSelect.createEl('option', { value: 'gemini', text: 'Gemini' });

		providerSelect.value = this.plugin.settings.provider;
		providerSelect.addEventListener('change', async () => {
			this.plugin.settings.provider = providerSelect.value as any;
			await this.plugin.saveSettings();
			this.updateModelSelector();
		});

		// Model selector
		const modelContainer = selectorContainer.createDiv({ cls: 'ai-model-selector-select' });
		modelContainer.createSpan({ text: 'Model: ' });

		this.modelSelect = modelContainer.createEl('select');
		this.updateModelSelector();

		this.modelSelect.addEventListener('change', async () => {
			const provider = this.plugin.settings.provider;
			switch (provider) {
				case 'claude':
					this.plugin.settings.claudeModel = this.modelSelect.value;
					break;
				case 'glm':
					this.plugin.settings.glmModel = this.modelSelect.value;
					break;
				case 'gemini':
					this.plugin.settings.geminiModel = this.modelSelect.value;
					break;
			}
			await this.plugin.saveSettings();
		});

		// Template quick selector
		const templateContainer = contentEl.createDiv({ cls: 'ai-template-selector' });
		const templateButton = templateContainer.createEl('button', {
			text: '📋 Templates',
			cls: 'ai-template-button'
		});
		templateButton.onclick = () => {
			this.close();
			new TemplatesModal(this.app, this.plugin).open();
		};

		// Memory toggle
		const memoryContainer = contentEl.createDiv({ cls: 'ai-memory-toggle' });
		const memoryToggle = memoryContainer.createEl('input', {
			type: 'checkbox',
			attr: { id: 'memory-toggle' }
		});
		memoryToggle.checked = this.plugin.memoryClient.getRemember();
		memoryToggle.addEventListener('change', () => {
			this.plugin.memoryClient.setRemember(memoryToggle.checked);
		});

		const memoryLabel = memoryContainer.createEl('label', {
			attr: { for: 'memory-toggle' },
			text: '🧠 Remember conversation'
		});

		// Memory stats indicator
		this.updateMemoryStats(memoryContainer);

		// Chat container
		this.chatContainer = contentEl.createDiv({ cls: 'ai-chat-messages' });

		// System prompt indicator
		if (this.plugin.settings.systemPrompt) {
			this.addSystemMessage(this.plugin.settings.systemPrompt);
		}

		// Input container
		const inputContainer = contentEl.createDiv({ cls: 'ai-input-container' });

		this.inputEl = inputContainer.createEl('textarea', {
			placeholder: 'Type your message...',
			cls: 'ai-chat-input',
		});

		this.inputEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				this.sendMessage();
			}
		});

		// Button container
		const buttonContainer = inputContainer.createDiv({ cls: 'ai-button-container' });

		this.sendButton = buttonContainer.createEl('button', {
			text: 'Send',
			cls: 'ai-send-button',
		});

		this.sendButton.onclick = () => this.sendMessage();

		const clearButton = buttonContainer.createEl('button', {
			text: 'Clear',
			cls: 'ai-clear-button',
		});

		clearButton.onclick = () => {
			this.chatContainer.empty();
			this.messages = [];
			this.plugin.startNewChat();
			if (this.plugin.settings.systemPrompt) {
				this.addSystemMessage(this.plugin.settings.systemPrompt);
			}
		};

		// Style
		this.addStyles();
	}

	updateModelSelector() {
		this.modelSelect.empty();
		const models = getModelsForProvider(this.plugin.settings.provider);
		let currentModel = '';

		switch (this.plugin.settings.provider) {
			case 'claude':
				currentModel = this.plugin.settings.claudeModel;
				break;
			case 'glm':
				currentModel = this.plugin.settings.glmModel;
				break;
			case 'gemini':
				currentModel = this.plugin.settings.geminiModel;
				break;
		}

		models.forEach(model => {
			const option = this.modelSelect.createEl('option', {
				value: model.id,
				text: `${model.name} (${model.contextLength.toLocaleString()} tokens)`,
			});
			if (model.id === currentModel) {
				option.selected = true;
			}
		});
	}

	addSystemMessage(content: string) {
		const msgEl = this.chatContainer.createDiv({ cls: 'ai-message ai-system-message' });
		msgEl.createEl('strong', { text: '📋 System' });
		msgEl.createEl('p', { text: content });
	}

	async sendMessage() {
		const content = this.inputEl.value.trim();
		if (!content || this.isGenerating) return;

		this.inputEl.value = '';
		this.isGenerating = true;
		this.sendButton.disabled = true;

		// Add user message
		this.addMessage('user', content);
		this.messages.push({ role: 'user', content });
		this.plugin.addToChatHistory({ role: 'user', content });

		// Add assistant placeholder
		const assistantMsgEl = this.addMessage('assistant', '');
		let responseContent = '';

		try {
			const messages: any[] = [
				{ role: 'system', content: this.plugin.settings.systemPrompt },
				...this.messages,
			];

			await this.plugin.callAI(messages, (chunk) => {
				responseContent += chunk;
				assistantMsgEl.querySelector('p')!.setText(responseContent);
				this.scrollToBottom();
			});

			this.messages.push({ role: 'assistant', content: responseContent });
			this.plugin.addToChatHistory({ role: 'assistant', content: responseContent });

		} catch (error: any) {
			assistantMsgEl.querySelector('p')!.setText(`Error: ${error.message}`);
			assistantMsgEl.addClass('ai-error-message');
		} finally {
			this.isGenerating = false;
			this.sendButton.disabled = false;
			this.scrollToBottom();
		}
	}

	addMessage(role: string, content: string): HTMLElement {
		const msgEl = this.chatContainer.createDiv({
			cls: `ai-message ai-${role}-message`,
		});

		const label = role === 'user' ? '👤 You' : `🤖 ${this.plugin.settings.provider.toUpperCase()}`;
		msgEl.createEl('strong', { text: label });

		const contentEl = msgEl.createEl('p', { text: content || '...' });

		this.scrollToBottom();

		return msgEl;
	}

	scrollToBottom() {
		this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
	}

	async updateMemoryStats(container: HTMLElement) {
		const stats = await this.plugin.memoryClient.getStats();
		container.createSpan({
			cls: 'ai-memory-stats',
			text: ` (${stats.factCount} facts)`
		});
	}

	addStyles() {
		// Styles are injected via styles.css
		const { contentEl } = this;

		// Memory toggle styles
		contentEl.createEl('style', { text: `
			.ai-memory-toggle {
				display: flex;
				align-items: center;
				gap: 8px;
				margin: 8px 0;
				padding: 8px;
				background: var(--background-secondary);
				border-radius: 6px;
			}
			.ai-memory-toggle label {
				cursor: pointer;
				font-size: 14px;
			}
			.ai-memory-stats {
				opacity: 0.6;
				font-size: 12px;
				margin-left: auto;
			}
		` });
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// ============================================================================
// PROCESSING MODAL
// ============================================================================

class AIProcessingModal extends Modal {
	contentEl: HTMLElement;
	contentText: string;

	constructor(app: App, action: string) {
		super(app);
		this.contentText = '';
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass('ai-processing-modal');

		contentEl.createEl('h2', { text: '⏳ AI Processing...' });

		this.contentEl = contentEl.createEl('div', {
			cls: 'ai-processing-content',
			text: 'Starting...',
		});

		const closeButton = contentEl.createEl('button', {
			text: 'Close',
			cls: 'ai-close-button',
		});

		closeButton.onclick = () => this.close();
	}

	updateContent(content: string) {
		this.contentEl.setText(content);
		this.contentEl.scrollTop = this.contentEl.scrollHeight;
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// ============================================================================
// SETTINGS TAB
// ============================================================================

class MultiProviderSettingTab extends PluginSettingTab {
	plugin: MultiProviderAIPlugin;

	constructor(app: App, plugin: MultiProviderAIPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: '⚙️ Multi-Provider AI Settings' });

		// ============================================================================
		// PROVIDER SELECTION
		// ============================================================================

		containerEl.createEl('h3', { text: '🔌 Provider Selection' });

		new Setting(containerEl)
			.setName('AI Provider')
			.setDesc('Select your AI provider')
			.addDropdown((dropdown) => {
				dropdown.addOption('claude', 'Anthropic Claude');
				dropdown.addOption('glm', 'Z.ai GLM');
				dropdown.addOption('gemini', 'Google Gemini');
				dropdown.setValue(this.plugin.settings.provider);
				dropdown.onChange(async (value) => {
					this.plugin.settings.provider = value as any;
					await this.plugin.saveSettings();
					this.display(); // Refresh to show provider-specific settings
				});
			});

		containerEl.createEl('hr');

		// ============================================================================
		// PROVIDER-SPECIFIC SETTINGS
		// ============================================================================

		switch (this.plugin.settings.provider) {
			case 'claude':
				this.displayClaudeSettings(containerEl);
				break;
			case 'glm':
				this.displayGLMSettings(containerEl);
				break;
			case 'gemini':
				this.displayGeminiSettings(containerEl);
				break;
		}

		containerEl.createEl('hr');

		// ============================================================================
		// SHARED SETTINGS
		// ============================================================================

		containerEl.createEl('h3', { text: '🎛️ Shared Settings' });

		new Setting(containerEl)
			.setName('Temperature')
			.setDesc('Controls randomness (0.0 = focused, 1.0 = creative)')
			.addSlider((slider) =>
				slider
					.setLimits(0, 1, 0.1)
					.setValue(this.plugin.settings.temperature)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.temperature = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Max Tokens')
			.setDesc('Maximum tokens in response')
			.addText((text) =>
				text
					.setPlaceholder('4096')
					.setValue(this.plugin.settings.maxTokens.toString())
					.onChange(async (value) => {
						const num = parseInt(value);
						if (!isNaN(num)) {
							this.plugin.settings.maxTokens = num;
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			.setName('System Prompt')
			.setDesc('Default system prompt for all conversations')
			.addTextArea((text) =>
				text
					.setPlaceholder('You are a helpful AI assistant...')
					.setValue(this.plugin.settings.systemPrompt)
					.onChange(async (value) => {
						this.plugin.settings.systemPrompt = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Stream Response')
			.setDesc('Show response as it generates (instead of waiting for completion)')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.streamResponse)
					.onChange(async (value) => {
						this.plugin.settings.streamResponse = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Show Token Usage')
			.setDesc('Display token usage notice after each request')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showTokenUsage)
					.onChange(async (value) => {
						this.plugin.settings.showTokenUsage = value;
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl('hr');

		// ============================================================================
		// PREMIUM FEATURES
		// ============================================================================

		containerEl.createEl('h3', { text: '🌟 Premium Features' });

		new Setting(containerEl)
			.setName('Enable Premium Features')
			.setDesc('Unlock vault intelligence, link suggestions, and daily notes automation')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enablePremiumFeatures || false)
					.onChange(async (value) => {
						this.plugin.settings.enablePremiumFeatures = value;
						await this.plugin.saveSettings();
						this.display(); // Refresh to show/hide premium options
					})
			);

		if (this.plugin.settings.enablePremiumFeatures) {
			// Vault Intelligence Settings
			containerEl.createEl('h4', { text: '🧠 Vault Intelligence' });

			new Setting(containerEl)
				.setName('Auto-Reindex Interval')
				.setDesc('How often to reindex the vault (in minutes)')
				.addSlider((slider) =>
					slider
						.setLimits(5, 120, 5)
						.setValue(this.plugin.settings.autoReindexInterval || 60)
						.setDynamicTooltip()
						.onChange(async (value) => {
							this.plugin.settings.autoReindexInterval = value;
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName('Exclude Patterns')
				.setDesc('Glob patterns for files to exclude from indexing (comma-separated)')
				.addText((text) =>
					text
						.setPlaceholder('*.excalidraw.md,*.canvas')
						.setValue((this.plugin.settings.excludePatterns || ['*.excalidraw.md', '*.canvas']).join(','))
						.onChange(async (value) => {
							this.plugin.settings.excludePatterns = value.split(',').map(p => p.trim());
							await this.plugin.saveSettings();
						})
				);

			// Daily Notes Settings
			containerEl.createEl('h4', { text: '📅 Daily Notes Assistant' });

			new Setting(containerEl)
				.setName('Enable Daily Notes Assistant')
				.setDesc('Auto-summarize and extract tasks from daily notes')
				.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings.enableDailyNotesAssistant !== false)
						.onChange(async (value) => {
							this.plugin.settings.enableDailyNotesAssistant = value;
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName('Daily Notes Folder')
				.setDesc('Folder containing daily notes')
				.addText((text) =>
					text
						.setPlaceholder('Daily Notes')
						.setValue(this.plugin.settings.dailyNotesFolder || 'Daily Notes')
						.onChange(async (value) => {
							this.plugin.settings.dailyNotesFolder = value;
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName('Daily Notes Format')
				.setDesc('Moment.js format for daily note filenames')
				.addText((text) =>
					text
						.setPlaceholder('YYYY-MM-DD')
						.setValue(this.plugin.settings.dailyNotesFormat || 'YYYY-MM-DD')
						.onChange(async (value) => {
							this.plugin.settings.dailyNotesFormat = value;
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName('Auto-Summarize Daily Notes')
				.setDesc('Automatically generate AI summaries when opening daily notes')
				.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings.autoSummarizeDaily !== false)
						.onChange(async (value) => {
							this.plugin.settings.autoSummarizeDaily = value;
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName('Auto-Extract Tasks')
				.setDesc('Automatically extract and categorize tasks from daily notes')
				.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings.autoExtractTasks !== false)
						.onChange(async (value) => {
							this.plugin.settings.autoExtractTasks = value;
							await this.plugin.saveSettings();
						})
				);

			// Link Intelligence Settings
			containerEl.createEl('h4', { text: '🔗 Link Intelligence' });

			new Setting(containerEl)
				.setName('Enable Link Suggestions')
				.setDesc('Suggest relevant backlinks while editing')
				.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings.suggestBacklinks !== false)
						.onChange(async (value) => {
							this.plugin.settings.suggestBacklinks = value;
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName('Minimum Link Strength')
				.setDesc('Minimum similarity threshold for link suggestions (0.0 - 1.0)')
				.addSlider((slider) =>
					slider
						.setLimits(0.1, 0.9, 0.1)
						.setValue(this.plugin.settings.minLinkStrength || 0.3)
						.setDynamicTooltip()
						.onChange(async (value) => {
							this.plugin.settings.minLinkStrength = value;
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName('Maximum Suggestions')
				.setDesc('Maximum number of link suggestions to show')
				.addSlider((slider) =>
					slider
						.setLimits(3, 10, 1)
						.setValue(this.plugin.settings.maxSuggestions || 5)
						.setDynamicTooltip()
						.onChange(async (value) => {
							this.plugin.settings.maxSuggestions = value;
							await this.plugin.saveSettings();
						})
				);
		}

		containerEl.createEl('hr');

		// ============================================================================
		// USAGE GUIDE
		// ============================================================================

		containerEl.createEl('h3', { text: '📖 Usage Guide' });

		const guide = containerEl.createDiv({ cls: 'ai-usage-guide' });
		guide.innerHTML = `
			<p><strong>Commands:</strong></p>
			<ul>
				<li><kbd>Ctrl/Cmd + Shift + G</kbd> - Open AI Chat</li>
				<li>Select text → Right-click → AI commands</li>
			</ul>
			<p><strong>Features:</strong></p>
			<ul>
				<li>💬 Chat interface with streaming responses</li>
				<li>✍️ Generate, summarize, explain, refine text</li>
				<li>🔍 Code review and explanation</li>
				<li>🎨 Multiple providers: Claude, GLM, Gemini</li>
			</ul>
			<p><strong>Getting API Keys:</strong></p>
			<ul>
				<li><a href="https://console.anthropic.com/" target="_blank">Claude API Key →</a></li>
				<li><a href="https://docs.z.ai/" target="_blank">GLM API Key →</a></li>
				<li><a href="https://console.cloud.google.com/" target="_blank">Gemini OAuth Setup →</a></li>
			</ul>
		`;
	}

	displayClaudeSettings(containerEl: HTMLElement) {
		containerEl.createEl('h3', { text: '🤖 Claude Settings' });

		new Setting(containerEl)
			.setName('Claude API Key')
			.setDesc('Your Anthropic API key from https://console.anthropic.com/')
			.addText((text) =>
				text
					.setPlaceholder('sk-ant-...')
					.setValue(this.plugin.settings.claudeApiKey)
					.onChange(async (value) => {
						this.plugin.settings.claudeApiKey = value;
						await this.plugin.saveSettings();
					})
			);

		const claudeModels = getModelsForProvider('claude');
		new Setting(containerEl)
			.setName('Claude Model')
			.setDesc('Select Claude model to use')
			.addDropdown((dropdown) => {
				claudeModels.forEach((model) => {
					dropdown.addOption(model.id, `${model.name} (${model.contextLength.toLocaleString()} tokens)`);
				});
				dropdown.setValue(this.plugin.settings.claudeModel);
				dropdown.onChange(async (value) => {
					this.plugin.settings.claudeModel = value;
					await this.plugin.saveSettings();
				});
			});
	}

	displayGLMSettings(containerEl: HTMLElement) {
		containerEl.createEl('h3', { text: '🤖 GLM Settings' });

		new Setting(containerEl)
			.setName('GLM API Key')
			.setDesc('Your Z.ai GLM API key from https://docs.z.ai/')
			.addText((text) =>
				text
					.setPlaceholder('Enter your API key')
					.setValue(this.plugin.settings.glmApiKey)
					.onChange(async (value) => {
						this.plugin.settings.glmApiKey = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('GLM API Endpoint')
			.setDesc('Z.ai GLM API endpoint (default: official Z.ai endpoint)')
			.addText((text) =>
				text
					.setPlaceholder('https://api.z.ai/api/paas/v4/chat/completions')
					.setValue(this.plugin.settings.glmEndpoint)
					.onChange(async (value) => {
						this.plugin.settings.glmEndpoint = value;
						await this.plugin.saveSettings();
					})
			);

		const glmModels = getModelsForProvider('glm');
		new Setting(containerEl)
			.setName('GLM Model')
			.setDesc('Select GLM model to use')
			.addDropdown((dropdown) => {
				glmModels.forEach((model) => {
					dropdown.addOption(model.id, `${model.name} (${model.contextLength.toLocaleString()} tokens)`);
				});
				dropdown.setValue(this.plugin.settings.glmModel);
				dropdown.onChange(async (value) => {
					this.plugin.settings.glmModel = value;
					await this.plugin.saveSettings();
				});
			});
	}

	displayGeminiSettings(containerEl: HTMLElement) {
		containerEl.createEl('h3', { text: '🤖 Gemini Settings (OAuth)' });

		// OAuth Status
		const oauthStatus = this.plugin.geminiOAuth?.isAuthenticated()
			? '✅ Connected'
			: '❌ Not connected';

		new Setting(containerEl)
			.setName('OAuth Status')
			.setDesc(oauthStatus);

		// Client ID
		new Setting(containerEl)
			.setName('OAuth Client ID')
			.setDesc('Google Cloud OAuth 2.0 Client ID')
			.addText((text) =>
				text
					.setPlaceholder('Enter your client ID')
					.setValue(this.plugin.settings.geminiOAuthClientId || '')
					.onChange(async (value) => {
						this.plugin.settings.geminiOAuthClientId = value;
						await this.plugin.saveSettings();
					})
			);

		// Client Secret
		new Setting(containerEl)
			.setName('OAuth Client Secret')
			.setDesc('Google Cloud OAuth 2.0 Client Secret')
			.addText((text) =>
				text
					.setPlaceholder('Enter your client secret')
					.setValue(this.plugin.settings.geminiOAuthClientSecret || '')
					.onChange(async (value) => {
						this.plugin.settings.geminiOAuthClientSecret = value;
						await this.plugin.saveSettings();
					})
			);

		// Connect Button
		new Setting(containerEl)
			.setName('Connect with Google')
			.setDesc('Click to authenticate with Google OAuth')
			.addButton((button) => {
				button.setButtonText('Connect');
				button.setClass('mod-cta');
				button.onClick(async () => {
					if (!this.plugin.settings.geminiOAuthClientId || !this.plugin.settings.geminiOAuthClientSecret) {
						new Notice('Please enter OAuth Client ID and Secret first');
						return;
					}

					// Reinitialize OAuth with current credentials
					this.plugin.geminiOAuth = createDefaultGeminiOAuth(
						this.plugin.settings.geminiOAuthClientId,
						this.plugin.settings.geminiOAuthClientSecret
					);

					// Open OAuth flow
					try {
						// Open browser for authentication
						const authUrl = this.plugin.geminiOAuth['oauth'].getAuthorizationUrl();
						window.open(authUrl, '_blank');

						// Create modal for code entry
						new GeminiOAuthCodeModal(this.app, this.plugin).open();
					} catch (error: any) {
						new Notice(`OAuth error: ${error.message}`);
					}
				});
			});

		// Disconnect Button (only show if authenticated)
		if (this.plugin.geminiOAuth?.isAuthenticated()) {
			new Setting(containerEl)
				.setName('Disconnect')
				.setDesc('Remove OAuth connection')
				.addButton((button) => {
					button.setButtonText('Disconnect');
					button.setWarning();
					button.onClick(async () => {
						this.plugin.geminiOAuth?.logout();
						this.plugin.settings.geminiOAuthToken = undefined;
						this.plugin.settings.geminiRefreshToken = undefined;
						await this.plugin.saveSettings();
						this.display(); // Refresh UI
						new Notice('Disconnected from Google');
					});
				});
		}

		// Model Selection
		const geminiModels = getModelsForProvider('gemini');
		new Setting(containerEl)
			.setName('Gemini Model')
			.setDesc('Select Gemini model to use')
			.addDropdown((dropdown) => {
				geminiModels.forEach((model) => {
					dropdown.addOption(model.id, `${model.name} (${model.contextLength.toLocaleString()} tokens)`);
				});
				dropdown.setValue(this.plugin.settings.geminiModel);
				dropdown.onChange(async (value) => {
					this.plugin.settings.geminiModel = value;
					await this.plugin.saveSettings();
				});
			});
	}
}

// ============================================================================
// GEMINI OAUTH CODE MODAL
// ============================================================================

class GeminiOAuthCodeModal extends Modal {
	plugin: MultiProviderAIPlugin;
	inputEl: HTMLInputElement;

	constructor(app: App, plugin: MultiProviderAIPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass('gemini-oauth-modal');

		contentEl.createEl('h2', { text: '🔐 Gemini OAuth Authentication' });

		contentEl.createEl('p', {
			text: 'After completing OAuth in your browser, paste the authorization code below:'
		});

		this.inputEl = contentEl.createEl('input', {
			type: 'text',
			placeholder: 'Paste authorization code here...',
			cls: 'gemini-oauth-code-input',
		});

		this.inputEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				this.submitCode();
			}
		});

		const submitButton = contentEl.createEl('button', {
			text: 'Submit',
			cls: 'mod-cta',
		});

		submitButton.onclick = () => this.submitCode();

		const cancelButton = contentEl.createEl('button', {
			text: 'Cancel',
		});

		cancelButton.onclick = () => this.close();
	}

	async submitCode() {
		const code = this.inputEl.value.trim();
		if (!code) {
			new Notice('Please enter the authorization code');
			return;
		}

		try {
			await this.plugin.geminiOAuth!.submitAuthorizationCode(code);
			await this.plugin.saveSettings();
			new Notice('Successfully connected to Google Gemini!');
			this.close();
			// Refresh settings display
			(this.plugin.app as any).setting?.open();
			(this.plugin.app as any).setting?.activeTab?.instance?.display();
		} catch (error: any) {
			new Notice(`Failed to complete OAuth: ${error.message}`);
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// ============================================================================
// CONVERSATION HISTORY MODAL
// ============================================================================

class ConversationHistoryModal extends Modal {
	plugin: MultiProviderAIPlugin;
	searchEl: HTMLInputElement;
	filterEl: HTMLSelectElement;
	listContainer: HTMLElement;

	constructor(app: App, plugin: MultiProviderAIPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass('ai-history-modal');
		contentEl.createEl('h2', { text: '📚 Conversation History' });

		// Search and filter
		const searchContainer = contentEl.createDiv({ cls: 'ai-history-search' });

		this.searchEl = searchContainer.createEl('input', {
			type: 'text',
			placeholder: 'Search conversations...',
			cls: 'ai-search-input',
		});

		this.searchEl.addEventListener('input', () => this.refreshList());

		this.filterEl = searchContainer.createEl('select', { cls: 'ai-filter-select' });
		this.filterEl.createEl('option', { value: 'all', text: 'All Conversations' });
		this.filterEl.createEl('option', { value: 'starred', text: '⭐ Starred' });
		this.filterEl.createEl('option', { value: 'recent', text: '🕐 Recent (7 days)' });

		this.filterEl.addEventListener('change', () => this.refreshList());

		// Conversation list
		this.listContainer = contentEl.createDiv({ cls: 'ai-conversation-list' });

		this.refreshList();
	}

	refreshList() {
		this.listContainer.empty();
		const query = this.searchEl.value.toLowerCase();
		const filter = this.filterEl.value;

		let conversations = this.plugin.conversationManager.getAllConversations();

		// Apply filter
		if (filter === 'starred') {
			conversations = conversations.filter(c => c.starred);
		} else if (filter === 'recent') {
			const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
			conversations = conversations.filter(c => c.updatedAt > weekAgo);
		}

		// Apply search
		if (query) {
			conversations = this.plugin.conversationManager.searchConversations(query);
		}

		if (conversations.length === 0) {
			this.listContainer.createEl('p', {
				text: 'No conversations found',
				cls: 'ai-empty-state'
			});
			return;
		}

		for (const conv of conversations) {
			const item = this.listContainer.createDiv({ cls: 'ai-conversation-item' });

			const header = item.createDiv({ cls: 'ai-conv-header' });
			header.createEl('span', {
				text: conv.starred ? '⭐ ' : '',
				cls: 'ai-conv-star'
			});
			header.createEl('strong', { text: conv.title });

			const meta = item.createEl('div', { cls: 'ai-conv-meta' });
			meta.createEl('span', { text: `${conv.provider} • ${conv.model}` });
			meta.createEl('span', { text: `${conv.messages.length} messages` });
			meta.createEl('span', { text: new Date(conv.updatedAt).toLocaleDateString() });

			const actions = item.createDiv({ cls: 'ai-conv-actions' });

			const loadBtn = actions.createEl('button', { text: 'Load', cls: 'mod-cta' });
			loadBtn.onclick = () => {
				this.plugin.conversationManager.setCurrentConversation(conv.id);
				new Notice(`Loaded: ${conv.title}`);
				this.close();
				new AIChatModal(this.app, this.plugin).open();
			};

			const exportBtn = actions.createEl('button', { text: 'Export' });
			exportBtn.onclick = async () => {
				try {
					const markdown = await this.plugin.conversationManager.exportToFile(conv.id);
					const filename = `AI Chat - ${conv.title.replace(/[^a-zA-Z0-9]/g, '_')}.md`;
					const file = await this.app.vault.create(filename, markdown);
					new Notice(`Exported to ${file.path}`);
				} catch (error: any) {
					new Notice(`Export failed: ${error.message}`);
				}
			};

			const deleteBtn = actions.createEl('button', { text: 'Delete' });
			deleteBtn.onclick = () => {
				if (confirm(`Delete "${conv.title}"?`)) {
					this.plugin.conversationManager.deleteConversation(conv.id);
					this.refreshList();
				}
			};

			if (conv.tags && conv.tags.length > 0) {
				const tags = item.createEl('div', { cls: 'ai-conv-tags' });
				conv.tags.forEach(tag => {
					tags.createEl('span', { text: `#${tag}`, cls: 'ai-tag' });
				});
			}
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// ============================================================================
// STATS MODAL
// ============================================================================

class StatsModal extends Modal {
	plugin: MultiProviderAIPlugin;

	constructor(app: App, plugin: MultiProviderAIPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass('ai-stats-modal');
		contentEl.createEl('h2', { text: '📊 Usage Statistics' });

		const stats = this.plugin.conversationManager.getStats();
		const container = contentEl.createDiv({ cls: 'ai-stats-container' });

		// Overview
		const overview = container.createDiv({ cls: 'ai-stats-section' });
		overview.createEl('h3', { text: 'Overview' });
		overview.createEl('p', { text: `Total Conversations: ${stats.totalConversations}` });
		overview.createEl('p', { text: `Total Messages: ${stats.totalMessages}` });
		overview.createEl('p', { text: `Total Tokens: ${stats.totalTokens.toLocaleString()}` });
		overview.createEl('p', { text: `Total Cost: $${stats.totalCost.toFixed(4)}` });

		// Provider breakdown
		const providerSection = container.createDiv({ cls: 'ai-stats-section' });
		providerSection.createEl('h3', { text: 'By Provider' });

		for (const [provider, data] of Object.entries(stats.providerBreakdown)) {
			const item = providerSection.createDiv({ cls: 'ai-stats-item' });
			item.createEl('strong', { text: provider.toUpperCase() });
			item.createEl('span', {
				text: `${data.tokens.toLocaleString()} tokens • $${data.cost.toFixed(4)}`
			});
		}

		// Model breakdown
		const modelSection = container.createDiv({ cls: 'ai-stats-section' });
		modelSection.createEl('h3', { text: 'By Model' });

		for (const [model, data] of Object.entries(stats.modelBreakdown)) {
			const item = modelSection.createDiv({ cls: 'ai-stats-item' });
			item.createEl('strong', { text: model });
			item.createEl('span', {
				text: `${data.count} uses • ${data.tokens.toLocaleString()} tokens • $${data.cost.toFixed(4)}`
			});
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// ============================================================================
// TEMPLATES MODAL
// ============================================================================

class TemplatesModal extends Modal {
	plugin: MultiProviderAIPlugin;
	filterEl: HTMLSelectElement;
	listContainer: HTMLElement;

	constructor(app: App, plugin: MultiProviderAIPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass('ai-templates-modal');
		contentEl.createEl('h2', { text: '📋 Prompt Templates' });

		// Category filter
		const filterContainer = contentEl.createDiv({ cls: 'ai-templates-filter' });
		filterContainer.createSpan({ text: 'Category: ' });

		this.filterEl = filterContainer.createEl('select');
		this.filterEl.createEl('option', { value: 'all', text: 'All Templates' });
		this.filterEl.createEl('option', { value: 'writing', text: '✍️ Writing' });
		this.filterEl.createEl('option', { value: 'coding', text: '💻 Coding' });
		this.filterEl.createEl('option', { value: 'analysis', text: '🔍 Analysis' });
		this.filterEl.createEl('option', { value: 'creative', text: '🎨 Creative' });
		this.filterEl.createEl('option', { value: 'productivity', text: '⚡ Productivity' });
		this.filterEl.createEl('option', { value: 'learning', text: '📚 Learning' });

		this.filterEl.addEventListener('change', () => this.refreshList());

		this.listContainer = contentEl.createDiv({ cls: 'ai-templates-list' });

		this.refreshList();
	}

	refreshList() {
		this.listContainer.empty();
		const category = this.filterEl.value as any;

		let templates = category === 'all'
			? this.plugin.templateManager.getAllTemplates()
			: this.plugin.templateManager.getTemplatesByCategory(category as any);

		if (templates.length === 0) {
			this.listContainer.createEl('p', {
				text: 'No templates found',
				cls: 'ai-empty-state'
			});
			return;
		}

		for (const template of templates) {
			const item = this.listContainer.createDiv({ cls: 'ai-template-item' });

			const header = item.createDiv({ cls: 'ai-template-header' });

			if (template.icon) {
				header.createEl('span', { text: template.icon, cls: 'ai-template-icon' });
			}
			header.createEl('strong', { text: template.name });
			header.createEl('span', {
				text: template.category,
				cls: 'ai-template-category'
			});

			item.createEl('p', {
				text: template.description,
				cls: 'ai-template-desc'
			});

			const useBtn = item.createEl('button', {
				text: 'Use Template',
				cls: 'mod-cta'
			});
			useBtn.onclick = () => {
				this.close();
				new AIChatModal(this.app, this.plugin, template.id).open();
			};
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// ============================================================================
// PREMIUM FEATURES MODALS
// ============================================================================

class LinkSuggestionsModal extends Modal {
	private suggestions: LinkSuggestion[];
	private plugin: MultiProviderAIPlugin;

	constructor(app: App, suggestions: LinkSuggestion[], plugin: MultiProviderAIPlugin) {
		super(app);
		this.suggestions = suggestions;
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: '🔗 Link Suggestions' });

		if (this.suggestions.length === 0) {
			contentEl.createEl('p', { text: 'No suggestions found.' });
			return;
		}

		for (const suggestion of this.suggestions) {
			const item = contentEl.createDiv({ cls: 'ai-link-suggestion' });

			const header = item.createDiv({ cls: 'ai-link-suggestion-header' });

			const confidenceClass = suggestion.confidence >= 0.7 ? 'high' :
				suggestion.confidence >= 0.5 ? 'medium' : 'low';

			header.createEl('span', {
				text: `${Math.round(suggestion.confidence * 100)}%`,
				cls: `ai-link-confidence ${confidenceClass}`
			});

			header.createEl('strong', { text: suggestion.targetBasename });

			item.createEl('p', {
				text: suggestion.reason,
				cls: 'ai-link-suggestion-reason'
			});

			if (suggestion.sharedTopics && suggestion.sharedTopics.length > 0) {
				const topics = item.createDiv({ cls: 'ai-link-topics' });
				topics.createEl('span', { text: 'Shared topics: ', cls: 'ai-link-topics-label' });
				suggestion.sharedTopics.forEach(topic => {
					topics.createEl('code', { text: `#${topic}`, cls: 'ai-link-topic-tag' });
				});
			}

			const actions = item.createDiv({ cls: 'ai-link-suggestion-actions' });

			const insertBtn = actions.createEl('button', {
				text: 'Copy Link',
				cls: 'mod-cta'
			});
			insertBtn.onclick = () => {
				navigator.clipboard.writeText(`[[${suggestion.targetBasename}]]`);
				new Notice('Link copied to clipboard');
			};

			const openBtn = actions.createEl('button', {
				text: 'Open Note'
			});
			openBtn.onclick = async () => {
				const targetFile = this.app.vault.getAbstractFileByPath(suggestion.targetPath);
				if (targetFile instanceof TFile) {
					await this.app.workspace.openLinkText(targetFile.path, '');
					this.close();
				}
			};
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class VaultStatsModal extends Modal {
	private title: string;
	private content: string;

	constructor(app: App, title: string, content: string) {
		super(app);
		this.title = title;
		this.content = content;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: this.title });

		// Parse and render markdown content
		const lines = this.content.split('\n');
		let container = contentEl.createDiv();

		for (const line of lines) {
			if (line.startsWith('## ')) {
				container = contentEl.createDiv({ cls: 'ai-stats-section' });
				container.createEl('h3', { text: line.replace('## ', '') });
			} else if (line.startsWith('- ')) {
				container.createEl('li', { text: line.replace('- ', '') });
			} else if (line.trim()) {
				container.createEl('p', { text: line });
			}
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// ============================================================================
// DAILY NOTES MODALS
// ============================================================================

class DailyNoteAnalysisModal extends Modal {
	private analysis: DailyNoteAnalysis;
	private plugin: MultiProviderAIPlugin;

	constructor(app: App, analysis: DailyNoteAnalysis, plugin: MultiProviderAIPlugin) {
		super(app);
		this.analysis = analysis;
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('ai-daily-note-modal');

		contentEl.createEl('h2', { text: '📅 Daily Note Analysis' });

		// Date and stats
		const header = contentEl.createDiv({ cls: 'ai-daily-header' });
		header.createEl('span', { text: this.analysis.date });
		header.createEl('span', { text: `${this.analysis.wordCount} words` });

		// Sentiment indicator
		const sentimentEmoji = this.analysis.sentiment === 'positive' ? '😊' :
			this.analysis.sentiment === 'negative' ? '😔' : '😐';
		header.createEl('span', { text: `${sentimentEmoji} ${this.analysis.sentiment}` });

		// Summary
		if (this.analysis.summary) {
			const summarySection = contentEl.createDiv({ cls: 'ai-daily-summary' });
			summarySection.createEl('h3', { text: '📝 Summary' });
			summarySection.createEl('p', { text: this.analysis.summary });
		}

		// Tasks
		if (this.analysis.tasks.length > 0) {
			const tasksSection = contentEl.createDiv({ cls: 'ai-daily-tasks-section' });
			tasksSection.createEl('h3', { text: `✅ Tasks (${this.analysis.tasks.length})` });

			const pendingTasks = this.analysis.tasks.filter(t => !t.completed);
			const completedTasks = this.analysis.tasks.filter(t => t.completed);

			if (pendingTasks.length > 0) {
				tasksSection.createEl('h4', { text: 'Pending' });
				const taskList = tasksSection.createDiv({ cls: 'ai-daily-tasks' });
				for (const task of pendingTasks) {
					const taskItem = taskList.createDiv({ cls: 'ai-task-item' });
					taskItem.createDiv({ cls: `ai-task-priority ${task.priority}` });
					taskItem.createEl('span', { text: task.text });
					if (task.category) {
						taskItem.createEl('code', { text: task.category, cls: 'ai-task-category' });
					}
				}
			}

			if (completedTasks.length > 0) {
				tasksSection.createEl('h4', { text: 'Completed' });
				const taskList = tasksSection.createDiv({ cls: 'ai-daily-tasks' });
				for (const task of completedTasks) {
					const taskItem = taskList.createDiv({ cls: 'ai-task-item ai-task-completed' });
					taskItem.createEl('span', { text: '✓ ' + task.text });
				}
			}
		}

		// Topics
		if (this.analysis.topics.length > 0) {
			const topicsSection = contentEl.createDiv();
			topicsSection.createEl('h3', { text: '🏷️ Topics' });
			const topicsContainer = topicsSection.createDiv({ cls: 'ai-link-topics' });
			for (const topic of this.analysis.topics) {
				topicsContainer.createEl('code', { text: `#${topic}`, cls: 'ai-link-topic-tag' });
			}
		}

		// Related Notes
		if (this.analysis.relatedNotes.length > 0) {
			const relatedSection = contentEl.createDiv();
			relatedSection.createEl('h3', { text: '🔗 Related Notes' });
			for (const notePath of this.analysis.relatedNotes.slice(0, 5)) {
				const note = this.plugin.vaultIndexer?.getNoteMetadata(notePath);
				if (note) {
					const noteLink = relatedSection.createDiv({ cls: 'ai-related-note' });
					noteLink.createEl('span', { text: '• ' });
					const link = noteLink.createEl('a', { text: note.basename });
					link.onclick = async () => {
						const file = this.app.vault.getAbstractFileByPath(notePath);
						if (file instanceof TFile) {
							await this.app.workspace.openLinkText(file.path, '');
							this.close();
						}
					};
				}
			}
		}

		// Suggested Prompts
		if (this.analysis.suggestedPrompts.length > 0) {
			const promptsSection = contentEl.createDiv({ cls: 'ai-journal-prompts' });
			promptsSection.createEl('h3', { text: '💭 Suggested Prompts' });

			for (const prompt of this.analysis.suggestedPrompts) {
				const promptCard = promptsSection.createDiv({ cls: 'ai-prompt-card' });
				promptCard.createEl('p', { text: prompt });

				const useBtn = promptCard.createEl('button', {
					text: 'Use this prompt',
					cls: 'mod-cta'
				});
				useBtn.onclick = () => {
					navigator.clipboard.writeText(prompt);
					new Notice('Prompt copied to clipboard');
				};
			}
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class JournalPromptsModal extends Modal {
	private prompts: JournalPrompt[];
	private plugin: MultiProviderAIPlugin;

	constructor(app: App, prompts: JournalPrompt[], plugin: MultiProviderAIPlugin) {
		super(app);
		this.prompts = prompts;
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: '💭 Journal Prompts' });

		const promptsContainer = contentEl.createDiv({ cls: 'ai-journal-prompts' });

		for (const prompt of this.prompts) {
			const promptCard = promptsContainer.createDiv({ cls: 'ai-prompt-card' });

			const categoryBadge = promptCard.createEl('span', {
				text: prompt.category,
				cls: 'ai-prompt-category'
			});

			promptCard.createEl('p', { text: prompt.prompt });

			const actions = promptCard.createDiv({ cls: 'ai-prompt-actions' });

			const copyBtn = actions.createEl('button', { text: 'Copy' });
			copyBtn.onclick = () => {
				navigator.clipboard.writeText(prompt.prompt);
				new Notice('Prompt copied to clipboard');
			};

			const useBtn = actions.createEl('button', {
				text: 'Open in Chat',
				cls: 'mod-cta'
			});
			useBtn.onclick = () => {
				this.close();
				// Open AI chat with the prompt
				const modal = new AIChatModal(this.app, this.plugin);
				modal.open();
				// Set the input to the prompt
				setTimeout(() => {
					modal.inputEl.value = prompt.prompt;
				}, 100);
			};
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class ExtractedTasksModal extends Modal {
	private tasks: any[];
	private path: string;
	private plugin: MultiProviderAIPlugin;
	private title: string;
	private content: string;

	constructor(app: App, title: string, content: string, tasks: any[], path: string, plugin: MultiProviderAIPlugin) {
		super(app);
		this.title = title;
		this.content = content;
		this.tasks = tasks;
		this.path = path;
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: this.title });

		// Parse and render content
		const lines = this.content.split('\n');
		for (const line of lines) {
			if (line.startsWith('##')) {
				contentEl.createEl('h3', { text: line.replace('##', '') });
			} else if (line.startsWith('-')) {
				contentEl.createEl('li', { text: line.replace('-', '').trim() });
			} else if (line.trim()) {
				contentEl.createEl('p', { text: line });
			}
		}

		// Add action buttons
		const actions = contentEl.createDiv({ cls: 'ai-link-suggestion-actions' });

		const copyBtn = actions.createEl('button', { text: 'Copy All Tasks' });
		copyBtn.onclick = () => {
			const taskText = this.tasks.map(t => `- [${t.completed ? 'x' : ' '}] ${t.text}`).join('\n');
			navigator.clipboard.writeText(taskText);
			new Notice('Tasks copied to clipboard');
		};

		const appendBtn = actions.createEl('button', {
			text: 'Append to Note',
			cls: 'mod-cta'
		});
		appendBtn.onclick = async () => {
			if (this.plugin.dailyNotesAssistant) {
				await this.plugin.dailyNotesAssistant.appendToDailyNote(
					this.path,
					this.tasks.map(t => `- [ ] ${t.text}`).join('\n'),
					'tasks'
				);
				new Notice('Tasks appended to note');
				this.close();
			}
		};
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// ============================================================================
// VAULT INTELLIGENCE MODAL
// ============================================================================

class VaultIntelligenceModal extends Modal {
	private insights: VaultInsights;
	private plugin: MultiProviderAIPlugin;
	private currentTab: string = 'overview';

	constructor(app: App, insights: VaultInsights, plugin: MultiProviderAIPlugin) {
		super(app);
		this.insights = insights;
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('ai-vault-intelligence-modal');

		// Header
		const header = contentEl.createDiv({ cls: 'ai-modal-header' });
		header.createEl('h2', { text: '🧠 Vault Intelligence Dashboard' });

		// Refresh button
		const refreshBtn = header.createEl('button', {
			text: '🔄 Refresh',
			cls: 'ai-refresh-btn'
		});
		refreshBtn.onclick = () => {
			this.close();
			this.plugin.showVaultIntelligenceDashboard();
		};

		// Tab navigation
		const tabs = contentEl.createDiv({ cls: 'ai-tabs' });
		const tabOptions = [
			{ id: 'overview', label: '📊 Overview', icon: '📊' },
			{ id: 'health', label: '🏥 Health', icon: '🏥' },
			{ id: 'topics', label: '🏷️ Topics', icon: '🏷️' },
			{ id: 'activity', label: '⚡ Activity', icon: '⚡' },
			{ id: 'recommendations', label: '💡 Recommendations', icon: '💡' }
		];

		for (const tab of tabOptions) {
			const tabBtn = tabs.createEl('button', {
				text: tab.label,
				cls: `ai-tab ${this.currentTab === tab.id ? 'ai-tab-active' : ''}`
			});
			tabBtn.onclick = () => {
				this.currentTab = tab.id;
				this.renderContent();
			};
		}

		// Content area
		this.renderContent();
	}

	private renderContent() {
		const { contentEl } = this;

		// Remove existing content
		const existingContent = contentEl.querySelector('.ai-modal-content');
		if (existingContent) {
			existingContent.remove();
		}

		const contentArea = contentEl.createDiv({ cls: 'ai-modal-content' });

		switch (this.currentTab) {
			case 'overview':
				this.renderOverview(contentArea);
				break;
			case 'health':
				this.renderHealth(contentArea);
				break;
			case 'topics':
				this.renderTopics(contentArea);
				break;
			case 'activity':
				this.renderActivity(contentArea);
				break;
			case 'recommendations':
				this.renderRecommendations(contentArea);
				break;
		}
	}

	private renderOverview(container: HTMLElement) {
		const { overview } = this.insights;

		// Stats grid
		const statsGrid = container.createDiv({ cls: 'ai-stats-grid' });

		const stats = [
			{ label: 'Total Notes', value: overview.totalNotes.toLocaleString(), icon: '📝' },
			{ label: 'Total Words', value: overview.totalWords.toLocaleString(), icon: '✍️' },
			{ label: 'Total Links', value: overview.totalLinks.toLocaleString(), icon: '🔗' },
			{ label: 'Total Tags', value: overview.totalTags.toLocaleString(), icon: '🏷️' },
			{ label: 'Orphaned Notes', value: overview.orphanedNotes.toLocaleString(), icon: '👻' },
			{ label: 'Growth Rate', value: `+${overview.growthRate.toFixed(1)}%`, icon: '📈' }
		];

		for (const stat of stats) {
			const statCard = statsGrid.createDiv({ cls: 'ai-stat-card' });
			statCard.createEl('span', { text: stat.icon, cls: 'ai-stat-icon' });
			statCard.createEl('div', { text: stat.value, cls: 'ai-stat-value' });
			statCard.createEl('div', { text: stat.label, cls: 'ai-stat-label' });
		}

		// Largest notes
		if (overview.largestNotes.length > 0) {
			const largestSection = container.createDiv({ cls: 'ai-section' });
			largestSection.createEl('h3', { text: '📏 Largest Notes' });

			const list = largestSection.createDiv({ cls: 'ai-list' });
			for (const note of overview.largestNotes.slice(0, 5)) {
				const item = list.createDiv({ cls: 'ai-list-item' });
				item.createEl('span', { text: note.basename, cls: 'ai-note-name' });
				item.createEl('span', {
					text: `${note.wordCount.toLocaleString()} words`,
					cls: 'ai-note-count'
				});
			}
		}

		// Most linked notes
		if (overview.mostLinkedNotes.length > 0) {
			const linkedSection = container.createDiv({ cls: 'ai-section' });
			linkedSection.createEl('h3', { text: '🔗 Most Linked Notes' });

			const list = linkedSection.createDiv({ cls: 'ai-list' });
			for (const note of overview.mostLinkedNotes.slice(0, 5)) {
				const item = list.createDiv({ cls: 'ai-list-item' });
				item.createEl('span', { text: note.basename, cls: 'ai-note-name' });
				item.createEl('span', {
					text: `${note.backlinks.length} backlinks`,
					cls: 'ai-note-count'
				});
			}
		}
	}

	private renderHealth(container: HTMLElement) {
		const { health } = this.insights;

		// Health score
		const scoreSection = container.createDiv({ cls: 'ai-health-score-section' });
		const scoreCard = scoreSection.createDiv({ cls: 'ai-health-score-card' });

		const scoreValue = scoreCard.createDiv({ cls: 'ai-score-value' });
		scoreValue.createEl('span', { text: health.healthScore.toString(), cls: `ai-score-${this.getHealthScoreClass(health.healthScore)}` });
		scoreValue.createEl('span', { text: '/100', cls: 'ai-score-max' });

		scoreCard.createEl('div', { text: this.getHealthScoreLabel(health.healthScore), cls: 'ai-score-label' });

		// Health breakdown
		const breakdownSection = container.createDiv({ cls: 'ai-section' });
		breakdownSection.createEl('h3', { text: '📋 Health Breakdown' });

		// Orphaned notes
		if (health.orphanedNotes.length > 0) {
			const orphanedSection = breakdownSection.createDiv({ cls: 'ai-health-item' });
			orphanedSection.createEl('h4', { text: `👻 Orphaned Notes (${health.orphanedNotes.length})` });

			const orphanedList = orphanedSection.createDiv({ cls: 'ai-list' });
			for (const note of health.orphanedNotes.slice(0, 10)) {
				const item = orphanedList.createDiv({ cls: 'ai-list-item ai-clickable' });
				item.createEl('span', { text: note.basename });
				item.onclick = () => {
					this.app.workspace.openLinkText(note.path, '');
				};
			}
		}

		// Weak connections
		if (health.weakConnections.length > 0) {
			const weakSection = breakdownSection.createDiv({ cls: 'ai-health-item' });
			weakSection.createEl('h4', { text: `🔗 Weak Connections (${health.weakConnections.length})` });

			const weakList = weakSection.createDiv({ cls: 'ai-list' });
			for (const note of health.weakConnections.slice(0, 10)) {
				const item = weakList.createDiv({ cls: 'ai-list-item ai-clickable' });
				item.createEl('span', { text: note.basename });
				item.onclick = () => {
					this.app.workspace.openLinkText(note.path, '');
				};
			}
		}

		// Outdated notes
		if (health.outdatedNotes.length > 0) {
			const outdatedSection = breakdownSection.createDiv({ cls: 'ai-health-item' });
			outdatedSection.createEl('h4', { text: `📅 Outdated Notes (${health.outdatedNotes.length})` });

			const outdatedList = outdatedSection.createDiv({ cls: 'ai-list' });
			for (const note of health.outdatedNotes.slice(0, 10)) {
				const item = outdatedList.createDiv({ cls: 'ai-list-item ai-clickable' });
				item.createEl('span', { text: note.basename });
				const daysAgo = Math.floor((Date.now() - note.modifiedAt) / (1000 * 60 * 60 * 24));
				item.createEl('span', { text: `Updated ${daysAgo} days ago`, cls: 'ai-note-meta' });
				item.onclick = () => {
					this.app.workspace.openLinkText(note.path, '');
				};
			}
		}
	}

	private renderTopics(container: HTMLElement) {
		const { topics } = this.insights;

		// Topic cloud
		if (topics.clusters.size > 0) {
			const cloudSection = container.createDiv({ cls: 'ai-section' });
			cloudSection.createEl('h3', { text: '☁️ Topic Cloud' });

			const cloud = cloudSection.createDiv({ cls: 'ai-topic-cloud' });

			for (const [topic, notes] of topics.clusters) {
				const tag = cloud.createEl('span', {
					text: `#${topic}`,
					cls: 'ai-topic-tag'
				});

				// Size based on note count
				const size = Math.min(1.5, Math.max(0.8, notes.length / 20));
				tag.style.fontSize = `${size}rem`;

				tag.onclick = () => {
					this.close();
					// Open search with tag
					(this.app as any).internalPlugins.plugins['global-search'].openGlobalSearch(`#${topic}`);
				};
			}
		}

		// Knowledge gaps
		if (topics.gaps.length > 0) {
			const gapsSection = container.createDiv({ cls: 'ai-section' });
			gapsSection.createEl('h3', { text: '🔍 Knowledge Gaps' });

			const gapsList = gapsSection.createDiv({ cls: 'ai-list' });
			for (const gap of topics.gaps) {
			 const item = gapsList.createDiv({ cls: 'ai-list-item' });
			 item.createEl('span', { text: gap.topic, cls: 'ai-gap-topic' });
			 item.createEl('span', { text: `Suggested: ${gap.suggestedNotes}`, cls: 'ai-gap-suggestion' });
			}
		}

		// Trending topics
		if (topics.trending.length > 0) {
			const trendingSection = container.createDiv({ cls: 'ai-section' });
			trendingSection.createEl('h3', { text: '📈 Trending Topics' });

			const trendingList = trendingSection.createDiv({ cls: 'ai-list' });
			for (const trend of topics.trending) {
				const item = trendingList.createDiv({ cls: 'ai-list-item' });
			 item.createEl('span', { text: trend.topic, cls: 'ai-trend-topic' });
			 item.createEl('span', { text: `+${trend.growth.toFixed(1)}%`, cls: 'ai-trend-growth' });
			}
		}
	}

	private renderActivity(container: HTMLElement) {
		const { activity } = this.insights;

		// Activity streak
		const streakSection = container.createDiv({ cls: 'ai-section' });
		streakSection.createEl('h3', { text: '🔥 Activity Streak' });

		const streakCard = streakSection.createDiv({ cls: 'ai-streak-card' });
		streakCard.createEl('div', {
			text: `${activity.streak} day${activity.streak !== 1 ? 's' : ''}`,
			cls: 'ai-streak-value'
		});
		streakCard.createEl('div', { text: 'Current Streak', cls: 'ai-streak-label' });

		// Most active notes
		if (activity.mostActiveNotes.length > 0) {
			const activeSection = container.createDiv({ cls: 'ai-section' });
			activeSection.createEl('h3', { text: '⚡ Most Active Notes' });

			const activeList = activeSection.createDiv({ cls: 'ai-list' });
			for (const note of activity.mostActiveNotes.slice(0, 10)) {
				const item = activeList.createDiv({ cls: 'ai-list-item ai-clickable' });
			 item.createEl('span', { text: note.basename });
			 item.createEl('span', { text: `${note.backlinks.length} backlinks`, cls: 'ai-note-meta' });
			 item.onclick = () => {
					this.app.workspace.openLinkText(note.path, '');
				};
			}
		}

		// Recent activity
		if (activity.recentActivity.length > 0) {
			const recentSection = container.createDiv({ cls: 'ai-section' });
			recentSection.createEl('h3', { text: '🕐 Recent Activity' });

			const recentList = recentSection.createDiv({ cls: 'ai-timeline' });
			for (const event of activity.recentActivity.slice(0, 10)) {
				const item = recentList.createDiv({ cls: 'ai-timeline-item' });
				item.createEl('span', { text: event.action, cls: 'ai-timeline-action' });
				item.createEl('span', { text: event.path, cls: 'ai-timeline-path' });
				const timeAgo = Math.floor((Date.now() - event.timestamp) / (1000 * 60));
				item.createEl('span', { text: `${timeAgo}m ago`, cls: 'ai-timeline-time' });
			}
		}
	}

	private renderRecommendations(container: HTMLElement) {
		const { recommendations } = this.insights;

		if (recommendations.length === 0) {
			const emptyState = container.createDiv({ cls: 'ai-empty-state' });
			emptyState.createEl('p', { text: '🎉 No recommendations! Your vault is in great shape.' });
			return;
		}

		// Group by priority
		const byPriority = recommendations.reduce((acc, rec) => {
			if (!acc[rec.priority]) {
				acc[rec.priority] = [];
			}
			acc[rec.priority].push(rec);
			return acc;
		}, {} as Record<string, typeof recommendations>);

		// High priority
		if (byPriority.high) {
			const highSection = container.createDiv({ cls: 'ai-rec-section ai-rec-high' });
			highSection.createEl('h3', { text: '🔴 High Priority' });

			for (const rec of byPriority.high) {
				this.renderRecommendation(highSection, rec);
			}
		}

		// Medium priority
		if (byPriority.medium) {
			const mediumSection = container.createDiv({ cls: 'ai-rec-section ai-rec-medium' });
			mediumSection.createEl('h3', { text: '🟡 Medium Priority' });

			for (const rec of byPriority.medium) {
				this.renderRecommendation(mediumSection, rec);
			}
		}

		// Low priority
		if (byPriority.low) {
			const lowSection = container.createDiv({ cls: 'ai-rec-section ai-rec-low' });
			lowSection.createEl('h3', { text: '🟢 Low Priority' });

			for (const rec of byPriority.low) {
				this.renderRecommendation(lowSection, rec);
			}
		}
	}

	private renderRecommendation(container: HTMLElement, rec: VaultRecommendation) {
		const card = container.createDiv({ cls: 'ai-rec-card' });

		const header = card.createDiv({ cls: 'ai-rec-header' });
		header.createEl('span', { text: rec.title, cls: 'ai-rec-title' });
		header.createEl('span', { text: rec.type, cls: 'ai-rec-type' });

		card.createEl('p', { text: rec.description, cls: 'ai-rec-description' });

		if (rec.actionable) {
			const actionBtn = card.createEl('button', {
				text: 'Take Action',
				cls: 'mod-cta'
			});

			// Handle different action types
			actionBtn.onclick = async () => {
				switch (rec.type) {
					case 'link':
						// Open link suggestions
						if (rec.targetPath && this.plugin.linkIntelligence) {
							this.close();
							const suggestions = await this.plugin.linkIntelligence.getBacklinkSuggestions(rec.targetPath);
							new LinkSuggestionsModal(this.app, suggestions, this.plugin).open();
						}
						break;
					case 'tag':
						// Add suggested tags
						if (rec.targetPath) {
							this.app.workspace.openLinkText(rec.targetPath, '');
						}
						break;
					case 'consolidate':
						// Merge notes
						new Notice('Manual consolidation required: ' + rec.description);
						break;
					case 'update':
						// Open outdated note
						if (rec.targetPath) {
							this.app.workspace.openLinkText(rec.targetPath, '');
						}
						break;
				}
			};
		}
	}

	private getHealthScoreClass(score: number): string {
		if (score >= 80) return 'excellent';
		if (score >= 60) return 'good';
		if (score >= 40) return 'fair';
		return 'poor';
	}

	private getHealthScoreLabel(score: number): string {
		if (score >= 80) return 'Excellent';
		if (score >= 60) return 'Good';
		if (score >= 40) return 'Fair';
		return 'Needs Improvement';
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
