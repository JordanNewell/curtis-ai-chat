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

export const CURRENT_VERSION = 4;

/**
 * Pre-v4.0.0 default system prompt. Used to detect users upgrading from
 * 3.0.1 or earlier who have this exact string saved — we auto-upgrade them
 * to the new capability-aware default. Custom prompts are preserved.
 */
const LEGACY_DEFAULT_SYSTEM_PROMPT = 'You are a helpful AI assistant integrated into Obsidian. Help the user with writing, analysis, coding, and knowledge management.';

const V4_DEFAULT_SYSTEM_PROMPT = `You are Curtis AI Chat, an AI assistant integrated into Obsidian. You help with writing, analysis, coding, and knowledge management.

You have these capabilities when the user has them enabled:
- **Note attachment**: The user can type \`@\` in the chat to attach vault notes. Attached note contents appear in the conversation as context blocks.
- **Curtis Agent tools** (when enabled): You can call tools like \`read_note\`, \`search_notes\`, \`create_note\`, \`edit_note\` to directly read and modify the user's vault. Use these proactively when the user references "this note", "my vault", or asks you to look at something — don't claim helplessness if a tool exists for the task.
- **Long-term memory**: Facts you've been told are persisted across conversations.

**Context precedence — important:**
- If a note is ALREADY in the conversation (shown as a \`[Attached note: X]\` block), USE that content. Do NOT call \`read_note\` or \`search_notes\` to re-fetch it.
- Only call \`read_note\` / \`search_notes\` when the user references a note that is NOT already in the conversation context.
- When editing an attached note, use \`edit_note\` with the path from the \`[Attached note: X]\` block — don't search for it again.

If the user references something they're looking at but you don't have it in context, ask them to attach it with \`@\` or, if Curtis Agent is enabled, use \`read_note\` on the active file. Never say "I can't see your screen" — explain what they can do instead.`;

/**
 * v4.0.0 ship-time bug: the first version of V4_DEFAULT_SYSTEM_PROMPT lacked
 * the "Context precedence" section. AIs would search_notes / read_note for
 * notes the user had ALREADY attached, wasting a tool call + token budget.
 * Migration v3 detects the prior v4 default (without context-precedence) and
 * upgrades it. Custom user prompts are preserved.
 */
const LEGACY_V4_FIRST_DRAFT_SYSTEM_PROMPT = `You are Curtis AI Chat, an AI assistant integrated into Obsidian. You help with writing, analysis, coding, and knowledge management.

You have these capabilities when the user has them enabled:
- **Note attachment**: The user can type \`@\` in the chat to attach vault notes. Attached note contents appear in the conversation as context blocks.
- **Curtis Agent tools** (when enabled): You can call tools like \`read_note\`, \`search_notes\`, \`create_note\`, \`edit_note\` to directly read and modify the user's vault. Use these proactively when the user references "this note", "my vault", or asks you to look at something — don't claim helplessness if a tool exists for the task.
- **Long-term memory**: Facts you've been told are persisted across conversations.

If the user references something they're looking at but you don't have it in context, ask them to attach it with \`@\` or, if Curtis Agent is enabled, use \`read_note\` on the active file. Never say "I can't see your screen" — explain what they can do instead.`;

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
	{
		version: 2,
		description: 'v4.0.0 — upgrade legacy default system prompt + ensure new agent settings exist',
		migrate: (settings: SettingsData): SettingsData => {
			// Upgrade legacy default prompt → new capability-aware prompt.
			// Custom prompts (anything different from the legacy default) are preserved.
			const currentPrompt = getString(settings, 'systemPrompt');
			if (currentPrompt === undefined || currentPrompt === LEGACY_DEFAULT_SYSTEM_PROMPT) {
				settings.systemPrompt = V4_DEFAULT_SYSTEM_PROMPT;
			}

			// Ensure new agent settings have defaults if missing.
			// Don't override existing values (e.g. if user already set enableAgent=true).
			if (settings.enableAgent === undefined) {
				settings.enableAgent = false;
			}
			if (settings.agentMaxTurns === undefined) {
				settings.agentMaxTurns = 5;
			}

			settings._version = 2;
			return settings;
		},
	},
	{
		version: 3,
		description: 'v4.0.0 — patch system prompt to enforce context precedence (don\'t re-search attached notes)',
		migrate: (settings: SettingsData): SettingsData => {
			const currentPrompt = getString(settings, 'systemPrompt');
			// Upgrade if user has EITHER the pre-v4 legacy default OR the
			// first-draft v4 default (which lacked context-precedence rules).
			// Custom user prompts preserved.
			if (
				currentPrompt === LEGACY_DEFAULT_SYSTEM_PROMPT ||
				currentPrompt === LEGACY_V4_FIRST_DRAFT_SYSTEM_PROMPT
			) {
				settings.systemPrompt = V4_DEFAULT_SYSTEM_PROMPT;
			}
			settings._version = 3;
			return settings;
		},
	},
	{
		version: 4,
		description: 'v4.0.0 — split system prompt into hardcoded CORE + user extension',
		migrate: (settings: SettingsData): SettingsData => {
			// The CORE_SYSTEM_PROMPT is now hardcoded in src/core/system-prompt.ts.
			// Any user who previously had a *default* prompt saved (legacy,
			// v4-first-draft, or v4-context-precedence) gets reset to empty —
			// the CORE now provides all of that automatically. Custom user
			// prompts are preserved (treated as the user's intentional extension).
			const currentPrompt = getString(settings, 'systemPrompt');
			if (
				currentPrompt === LEGACY_DEFAULT_SYSTEM_PROMPT ||
				currentPrompt === LEGACY_V4_FIRST_DRAFT_SYSTEM_PROMPT ||
				currentPrompt === V4_DEFAULT_SYSTEM_PROMPT
			) {
				settings.systemPrompt = '';
			}
			settings._version = 4;
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
