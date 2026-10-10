// Secret storage helpers — move API keys from plaintext settings into
// Obsidian's app.secretStorage (OS keychain; Obsidian 1.11.4+).
//
// Why this exists separately from migration.ts: the synchronous migrations
// in migration.ts run on pure settings data and have no access to the App
// instance. secretStorage requires the live App. So this module is the
// async half: called from onload() AFTER loadSettings + migrations.

import type { App } from 'obsidian';
import type { ProviderConfig, CurtisSettings } from '../types';

/** Key prefix for all secrets we own in the keychain. */
export const SECRET_PREFIX = 'curtis-api-key-';

/** Keychain key for the GCP connector's service-account JSON. */
export const GCP_SECRET_ID = SECRET_PREFIX + 'gcp-service-account';

/** Key prefix for OAuth token blobs (Sign in with ChatGPT). Values are JSON
 *  blobs, not API keys — kept apart from SECRET_PREFIX so a blob can never
 *  be resolved as someone's API key by resolveApiKey. */
export const OAUTH_SECRET_PREFIX = 'curtis-oauth-';

/** Previous prefix used before the "Curtis" rebrand. */
const OLD_PREFIX = 'obsibuddi-api-key-';

/**
 * Feature-detect Obsidian's secretStorage (added in 1.11.4).
 * Returns the SecretStorage instance or undefined if unavailable.
 */
export function getSecretStorage(app: App): import('obsidian').SecretStorage | undefined {
	const ss = (app as unknown as { secretStorage?: import('obsidian').SecretStorage }).secretStorage;
	if (ss && typeof ss.setSecret === 'function' && typeof ss.getSecret === 'function') {
		return ss;
	}
	return undefined;
}

/**
 * Migrate any plaintext API keys found in providerConfigs into the OS
 * keychain. Idempotent — safe to call on every onload. Sets apiKeyRef and
 * clears apiKey when a key is successfully moved.
 *
 * @returns the (possibly-modified) settings object. Caller must persist.
 */
export async function migrateSecretsToKeychain(
	app: App,
	settings: CurtisSettings
): Promise<{ settings: CurtisSettings; migrated: string[]; skipped: boolean }> {
	const ss = getSecretStorage(app);
	if (!ss) {
		// Feature unavailable — leave plaintext in place, no warning spam.
		return { settings, migrated: [], skipped: true };
	}

	const migrated: string[] = [];

	// One-time: re-key any secrets stored under the old "obsibuddi" prefix.
	try {
		const secrets = ss.listSecrets();
		for (const key of secrets) {
			if (key.startsWith(OLD_PREFIX)) {
				const newKey = SECRET_PREFIX + key.slice(OLD_PREFIX.length);
				const value = ss.getSecret(key);
				if (value) {
					ss.setSecret(newKey, value);
					// Fix up apiKeyRef if it points at the old key
					for (const cfgId of Object.keys(settings.providerConfigs)) {
						const cfg: ProviderConfig = settings.providerConfigs[cfgId];
						if (cfg.apiKeyRef === key) cfg.apiKeyRef = newKey;
					}
				}
			}
		}
	} catch (e) {
		console.debug('[Curtis] Old-prefix secret migration failed (non-fatal):', e);
	}

	for (const providerId of Object.keys(settings.providerConfigs)) {
		const config: ProviderConfig = settings.providerConfigs[providerId];
		const plaintext = config.apiKey?.trim();
		if (!plaintext) continue;

		const secretId = SECRET_PREFIX + providerId;
		try {
			ss.setSecret(secretId, plaintext);
			config.apiKeyRef = secretId;
			config.apiKey = ''; // wipe plaintext; do NOT delete the key (keep shape stable)
			migrated.push(providerId);
		} catch (e) {
			console.error(`[Curtis] Failed to migrate secret for ${providerId}:`, e);
		}
	}

	return { settings, migrated, skipped: false };
}

/**
 * Resolve a provider's API key, preferring the keychain reference over
 * plaintext. Returns empty string if neither is set or keychain is unavailable.
 */
export function resolveApiKey(app: App, config?: ProviderConfig): string {
	if (!config) return '';
	if (config.apiKeyRef) {
		const ss = getSecretStorage(app);
		if (ss) {
			try {
				return ss.getSecret(config.apiKeyRef) || '';
			} catch {
				return '';
			}
		}
	}
	return config.apiKey || '';
}

/**
 * Store a key for a provider in the keychain (when available) and return the
 * updated config. Falls back to plaintext storage on older Obsidian.
 */
export function setApiKeyForProvider(
	app: App,
	providerId: string,
	config: ProviderConfig,
	apiKey: string
): ProviderConfig {
	const ss = getSecretStorage(app);
	if (ss) {
		const secretId = SECRET_PREFIX + providerId;
		if (apiKey) {
			ss.setSecret(secretId, apiKey);
			config.apiKeyRef = secretId;
			config.apiKey = ''; // never persist plaintext when keychain is available
		} else {
			// Empty key → clear both ref and plaintext
			config.apiKeyRef = undefined;
			config.apiKey = '';
		}
	} else {
		config.apiKey = apiKey; // plaintext fallback
	}
	return config;
}

/**
 * Resolve a provider's OAuth token blob (JSON string), preferring the
 * keychain reference over the plaintext fallback. Returns '' when signed out.
 */
export function resolveOAuthBlob(app: App, config?: ProviderConfig): string {
	if (!config) return '';
	if (config.oauthRef) {
		const ss = getSecretStorage(app);
		if (ss) {
			try {
				return ss.getSecret(config.oauthRef) || '';
			} catch {
				return '';
			}
		}
	}
	return config.oauthJson || '';
}

/**
 * Store (or clear, when blob is empty) a provider's OAuth token blob in the
 * keychain when available, plaintext otherwise. Mutates and returns config.
 */
export function storeOAuthBlob(
	app: App,
	providerId: string,
	config: ProviderConfig,
	blob: string
): ProviderConfig {
	const ss = getSecretStorage(app);
	if (ss) {
		const secretId = OAUTH_SECRET_PREFIX + providerId;
		if (blob) {
			ss.setSecret(secretId, blob);
			config.oauthRef = secretId;
			config.oauthJson = '';
		} else {
			// Sign-out → clear both. Best-effort secret deletion: secretStorage
			// has no deleteSecret, so an empty overwrite is the strongest
			// removal the API offers.
			try {
				ss.setSecret(secretId, '');
			} catch {
				// Never set — fine.
			}
			config.oauthRef = undefined;
			config.oauthJson = '';
		}
	} else {
		config.oauthJson = blob; // plaintext fallback
	}
	return config;
}

/**
 * Resolve the GCP connector's service-account JSON, preferring the keychain
 * reference over the plaintext fallback. Returns '' when unset.
 */
export function resolveGcpServiceAccount(app: App, settings: CurtisSettings): string {
	if (settings.gcpServiceAccountRef) {
		const ss = getSecretStorage(app);
		if (ss) {
			try {
				return ss.getSecret(settings.gcpServiceAccountRef) || '';
			} catch {
				return '';
			}
		}
	}
	return settings.gcpServiceAccountJson || '';
}

/**
 * Store (or clear, with '') the GCP service-account JSON. The OS keychain is
 * preferred; the plaintext settings field is the fallback on older Obsidian
 * or when the keychain write fails — same posture as setApiKeyForProvider.
 */
export function setGcpServiceAccount(app: App, settings: CurtisSettings, json: string): void {
	const ss = getSecretStorage(app);
	if (ss) {
		try {
			// Clear = overwrite with '' (SecretStorage has no guaranteed delete);
			// resolveGcpServiceAccount treats empty as unset either way.
			ss.setSecret(GCP_SECRET_ID, json);
			if (json) {
				settings.gcpServiceAccountRef = GCP_SECRET_ID;
				settings.gcpServiceAccountJson = undefined;
				return;
			}
		} catch (e) {
			console.error('[Curtis] Failed to store GCP service-account key in the keychain:', e);
			if (!json) return; // nothing left to fall back to on clear
		}
	}
	settings.gcpServiceAccountRef = undefined;
	settings.gcpServiceAccountJson = json || undefined;
}
