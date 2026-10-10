// GCP service-account auth — RFC 7523 JWT-bearer flow.
//
// The service-account key's RSA private key signs a JWT asserting the
// storage scope; the JWT is exchanged at the key's token_uri for a
// short-lived OAuth2 access token. GcpTokenSource caches that token and
// mints a new one before expiry, so ordinary tool calls cost zero network
// round-trips beyond the Storage API itself.
//
// Obsidian-free by design: all network I/O goes through the injected
// HttpSender (requestUrl in production — see gcp/manager.ts) and signing
// uses WebCrypto, available in Obsidian's renderer on desktop and mobile.
// This module is unit-tested under node (vitest).

import type { GcpServiceAccount } from './types';
import { GCP_STORAGE_SCOPE, GCP_TOKEN_REFRESH_SKEW_MS } from './types';
import type { HttpSender, HttpSendRequest } from './http';

/**
 * Validate a pasted service-account key file and extract what Curtis needs.
 * Throws with a user-facing message — the settings modal surfaces it as-is.
 */
export function parseServiceAccountJson(text: string): GcpServiceAccount {
	let raw: Record<string, unknown>;
	try {
		raw = JSON.parse(text) as Record<string, unknown>;
	} catch {
		throw new Error('Not valid JSON — paste the full contents of the service-account key file.');
	}
	if (raw.type !== 'service_account') {
		throw new Error(`This JSON has type "${String(raw.type)}" — Curtis needs a service-account key (type "service_account").`);
	}
	const missing = (['client_email', 'private_key', 'project_id', 'token_uri'] as const)
		.filter((k) => typeof raw[k] !== 'string' || !raw[k].trim());
	if (missing.length > 0) {
		throw new Error(`Key file is missing field(s): ${missing.join(', ')}. Paste the complete key, not an excerpt.`);
	}
	return {
		clientEmail: (raw.client_email as string).trim(),
		privateKey: raw.private_key as string,
		projectId: (raw.project_id as string).trim(),
		tokenUri: (raw.token_uri as string).trim(),
	};
}

// ---------------------------------------------------------------------------
// Signing (RS256 via WebCrypto)
// ---------------------------------------------------------------------------

function base64UrlEncode(bytes: Uint8Array): string {
	let binary = '';
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** PKCS#8 PEM body → DER bytes. Google keys ship exactly this PEM label. */
function pemToPkcs8(pem: string): ArrayBuffer {
	const body = pem
		.replace(/-----BEGIN PRIVATE KEY-----/, '')
		.replace(/-----END PRIVATE KEY-----/, '')
		.replace(/\s+/g, '');
	const binary = atob(body);
	const buffer = new ArrayBuffer(binary.length);
	const bytes = new Uint8Array(buffer);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return buffer;
}

/** Sign JWT claims with a service-account private key (RS256). */
export async function signJwt(claims: Record<string, unknown>, privateKeyPem: string): Promise<string> {
	// Bare `crypto` — the WebCrypto global in Obsidian's renderer (desktop +
	// mobile) AND in node, so this module stays unit-testable.
	if (!crypto?.subtle) {
		throw new Error('WebCrypto is unavailable in this environment — the GCP connector cannot sign service-account JWTs.');
	}
	const key = await crypto.subtle.importKey(
		'pkcs8',
		pemToPkcs8(privateKeyPem),
		{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
		false,
		['sign'],
	);
	const head = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
	const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(claims)));
	const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${payload}`));
	return `${head}.${payload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

// ---------------------------------------------------------------------------
// Token cache
// ---------------------------------------------------------------------------

interface CachedToken {
	token: string;
	/** Epoch ms — Google's expires_in is nominal 3600s. */
	expiresAt: number;
}

export class GcpTokenSource {
	private cached?: CachedToken;

	constructor(
		private readonly serviceAccount: GcpServiceAccount,
		private readonly sender: HttpSender,
		/** Injectable clock — tests advance it instead of sleeping. */
		private readonly now: () => number = Date.now,
	) {}

	/** A valid access token; cached until within the refresh skew of expiry. */
	async getToken(): Promise<string> {
		if (this.cached && this.cached.expiresAt - GCP_TOKEN_REFRESH_SKEW_MS > this.now()) {
			return this.cached.token;
		}
		return this.fetchToken();
	}

	/** Drop the cached token — the Storage client calls this on 401 so the
	 *  next getToken mints a fresh one instead of replaying the dead one. */
	invalidate(): void {
		this.cached = undefined;
	}

	/** Expiry of the cached token (epoch ms), for the settings status row. */
	tokenExpiresAt(): number | undefined {
		return this.cached?.expiresAt;
	}

	private async fetchToken(): Promise<string> {
		const nowSeconds = Math.floor(this.now() / 1000);
		const jwt = await signJwt(
			{
				iss: this.serviceAccount.clientEmail,
				scope: GCP_STORAGE_SCOPE,
				aud: this.serviceAccount.tokenUri,
				iat: nowSeconds,
				// Google caps JWT-bearer access tokens at 1h regardless of exp.
				exp: nowSeconds + 3600,
			},
			this.serviceAccount.privateKey,
		);
		const req: HttpSendRequest = {
			url: this.serviceAccount.tokenUri,
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
				assertion: jwt,
			}).toString(),
		};
		const resp = await this.sender(req);
		let parsed: { access_token?: unknown; expires_in?: unknown; error?: unknown; error_description?: unknown };
		try {
			parsed = JSON.parse(resp.text) as typeof parsed;
		} catch {
			parsed = {};
		}
		if (resp.status !== 200 || typeof parsed.access_token !== 'string') {
			const detail = typeof parsed.error_description === 'string'
				? parsed.error_description
				: typeof parsed.error === 'string'
					? parsed.error
					: `HTTP ${resp.status}`;
			throw new Error(`GCP token exchange failed: ${detail}`);
		}
		const expiresInSeconds = typeof parsed.expires_in === 'number' ? parsed.expires_in : 3600;
		this.cached = {
			token: parsed.access_token,
			expiresAt: this.now() + expiresInSeconds * 1000,
		};
		return this.cached.token;
	}
}
