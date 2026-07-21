// ============================================================================
// Settings Migration System
// ============================================================================
//
// Each migration is a function that transforms settings from version N to N+1.
// Migrations run sequentially and are idempotent.
//
// To add a migration:
//   1. Add a new entry to MIGRATIONS array
//   2. Increment CURRENT_VERSION
//   3. The migration runs automatically on next plugin load
// ============================================================================

export const CURRENT_VERSION = 1;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SettingsData = Record<string, any>;

export interface Migration {
	version: number;
	description: string;
	// Return the modified settings. Throw to abort migration.
	migrate: (settings: SettingsData) => SettingsData;
}

export const MIGRATIONS: Migration[] = [
	{
		version: 1,
		description: 'Migrate from legacy MultiProviderPluginSettings to CurtisSettings',
		migrate: (settings: SettingsData): SettingsData => {
			// Detect legacy format (has 'provider' as claude/glm/gemini string)
			if (settings.provider && !settings.activeProvider) {
				const legacyMap: Record<string, string> = {
					claude: 'anthropic',
					glm: 'zai-glm',
					gemini: 'google',
				};
				settings.activeProvider = legacyMap[settings.provider] || settings.provider;
				settings.activeModel = settings[`${settings.provider}Model`] || settings.activeModel || '';
			}

			// Migrate API keys into providerConfigs
			if (!settings.providerConfigs) {
				settings.providerConfigs = {};
			}

			const keyMap: Record<string, string> = {
				claudeApiKey: 'anthropic',
				glmApiKey: 'zai-glm',
				geminiApiKey: 'google',
				openaiApiKey: 'openai',
				groqApiKey: 'groq',
				openrouterApiKey: 'openrouter',
				togetherApiKey: 'together',
				mistralApiKey: 'mistral',
				deepseekApiKey: 'deepseek',
				cohereApiKey: 'cohere',
			};

			for (const [legacyKey, providerId] of Object.entries(keyMap)) {
				if (settings[legacyKey] && !settings.providerConfigs[providerId]) {
					settings.providerConfigs[providerId] = {
						enabled: true,
						apiKey: settings[legacyKey],
					};
				} else if (settings[legacyKey]) {
					settings.providerConfigs[providerId].apiKey = settings[legacyKey];
					settings.providerConfigs[providerId].enabled = true;
				}
			}

			// GLM endpoint migration
			if (settings.glmEndpoint && !settings.providerConfigs['zai-glm']?.customEndpoint) {
				if (!settings.providerConfigs['zai-glm']) {
					settings.providerConfigs['zai-glm'] = { enabled: false, apiKey: '' };
				}
				settings.providerConfigs['zai-glm'].customEndpoint = settings.glmEndpoint;
			}

			// Clean up legacy keys
			const legacyKeys = [
				'provider', 'claudeApiKey', 'claudeModel', 'glmApiKey', 'glmEndpoint', 'glmModel',
				'geminiApiKey', 'geminiModel', 'geminiOAuthToken', 'geminiRefreshToken',
				'geminiOAuthClientId', 'geminiOAuthClientSecret',
				'chatHistoryFile', 'defaultConversationTemplate',
				'enablePremiumFeatures', 'autoReindexInterval', 'maxCacheSize',
				'autoSummarizeDaily', 'autoExtractTasks', 'suggestBacklinks',
				'minLinkStrength', 'maxSuggestions',
			];
			for (const key of legacyKeys) {
				delete settings[key];
			}

			settings._version = 1;
			return settings;
		},
	},
];

/**
 * Run all pending migrations on settings data.
 * Returns the migrated settings.
 */
export function runMigrations(settings: SettingsData): SettingsData {
	const currentVersion = settings._version || 0;

	if (currentVersion >= CURRENT_VERSION) {
		return settings;
	}

	console.log(`[Curtis] Migrating settings from version ${currentVersion} to ${CURRENT_VERSION}`);

	const pending = MIGRATIONS.filter(m => m.version > currentVersion);
	pending.sort((a, b) => a.version - b.version);

	let result = { ...settings };

	for (const migration of pending) {
		try {
			console.log(`[Curtis] Running migration: v${migration.version} — ${migration.description}`);
			result = migration.migrate(result);
			result._version = migration.version;
		} catch (err) {
			console.error(`[Curtis] Migration v${migration.version} failed:`, err);
			// Don't abort — save what we have and continue
		}
	}

	result._version = CURRENT_VERSION;
	return result;
}
