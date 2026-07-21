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

import type { ProviderConfig } from '../types';

export const CURRENT_VERSION = 1;

/**
 * Settings data is an opaque bag of JSON. Migrations read/write specific known
 * keys via the typed helpers below (getString / setString / getProviderConfigs).
 */
export type SettingsData = Record<string, unknown>;

export interface Migration {
	version: number;
	description: string;
	migrate: (settings: SettingsData) => SettingsData;
}

function getString(settings: SettingsData, key: string): string | undefined {
	const v = settings[key];
	return typeof v === 'string' ? v : undefined;
}

function getProviderConfigs(settings: SettingsData): Record<string, ProviderConfig> {
	const v = settings.providerConfigs;
	return v && typeof v === 'object' ? v as Record<string, ProviderConfig> : {};
}

export const MIGRATIONS: Migration[] = [
	{
		version: 1,
		description: 'Migrate from legacy MultiProviderPluginSettings to CurtisSettings',
		migrate: (settings: SettingsData): SettingsData => {
			// Detect legacy format (has 'provider' as claude/glm/gemini string)
			const legacyProvider = getString(settings, 'provider');
			if (legacyProvider && !settings.activeProvider) {
				const legacyMap: Record<string, string> = {
					claude: 'anthropic',
					glm: 'zai-glm',
					gemini: 'google',
				};
				settings.activeProvider = legacyMap[legacyProvider] || legacyProvider;
				settings.activeModel = getString(settings, `${legacyProvider}Model`) || getString(settings, 'activeModel') || '';
			}

			// Migrate API keys into providerConfigs
			const providerConfigs = getProviderConfigs(settings);
			settings.providerConfigs = providerConfigs;

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

			for (const legacyKey of Object.keys(keyMap)) {
				const providerId = keyMap[legacyKey];
				const legacyValue = getString(settings, legacyKey);
				if (!legacyValue) continue;
				const existing = providerConfigs[providerId];
				if (!existing) {
					providerConfigs[providerId] = {
						enabled: true,
						apiKey: legacyValue,
					};
				} else {
					existing.apiKey = legacyValue;
					existing.enabled = true;
				}
			}

			// GLM endpoint migration
			const glmEndpoint = getString(settings, 'glmEndpoint');
			const zaiGlm = providerConfigs['zai-glm'];
			if (glmEndpoint && !zaiGlm?.customEndpoint) {
				if (!zaiGlm) {
					providerConfigs['zai-glm'] = { enabled: false, apiKey: '' };
				}
				providerConfigs['zai-glm'].customEndpoint = glmEndpoint;
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
	const currentVersion = (typeof settings._version === 'number' ? settings._version : 0);

	if (currentVersion >= CURRENT_VERSION) {
		return settings;
	}

	const pending = MIGRATIONS.filter(m => m.version > currentVersion);
	pending.sort((a, b) => a.version - b.version);

	let result: SettingsData = { ...settings };

	for (const migration of pending) {
		try {
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
