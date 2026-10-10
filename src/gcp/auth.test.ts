// GCP auth tests — service-account JSON parsing, RS256 JWT signing, and the
// token cache. Runs under node: auth.ts is Obsidian-free (injected HTTP
// sender), and node's global WebCrypto generates + verifies the same keys
// Google issues, so the suite exercises the real signing path end-to-end.

import { describe, expect, it } from 'vitest';
import { GcpTokenSource, parseServiceAccountJson, signJwt } from './auth';
import type { HttpSendRequest, HttpSendResponse } from './http';
import type { GcpServiceAccount } from './types';

/** ArrayBuffer → base64 (no Buffer — the suite runs on browser globals). */
function toBase64(bytes: ArrayBuffer): string {
	let binary = '';
	for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
	return btoa(binary);
}

/** base64url JWT segment → parsed JSON. */
function segmentJson(segment: string): Record<string, unknown> {
	const binary = atob(segment.replace(/-/g, '+').replace(/_/g, '/'));
	return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))) as Record<string, unknown>;
}

/** base64url JWT signature → bytes, ready for crypto.subtle.verify. */
function signatureBytes(segment: string): Uint8Array<ArrayBuffer> {
	const binary = atob(segment.replace(/-/g, '+').replace(/_/g, '/'));
	const buffer = new ArrayBuffer(binary.length);
	const bytes = new Uint8Array(buffer);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

/** Generate a real RSA keypair and export the private half as the PKCS#8
 *  PEM shape Google's console ships in service-account JSON files. */
async function generateKeyPem(): Promise<string> {
	const pair = await crypto.subtle.generateKey(
		{ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
		true,
		['sign', 'verify'],
	);
	const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
	const lines = (toBase64(pkcs8).match(/.{1,64}/g) ?? []).join('\n');
	return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----`;
}

function testServiceAccount(pem: string): GcpServiceAccount {
	return {
		clientEmail: 'curtis-sa@my-project.iam.gserviceaccount.com',
		privateKey: pem,
		projectId: 'my-project',
		tokenUri: 'https://oauth2.googleapis.com/token',
	};
}

const VALID_KEY_JSON = JSON.stringify({
	type: 'service_account',
	project_id: 'my-project',
	private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvQ==\n-----END PRIVATE KEY-----',
	client_email: 'curtis-sa@my-project.iam.gserviceaccount.com',
	token_uri: 'https://oauth2.googleapis.com/token',
});

describe('parseServiceAccountJson', () => {
	it('extracts the fields Curtis needs', () => {
		const sa = parseServiceAccountJson(VALID_KEY_JSON);
		expect(sa.projectId).toBe('my-project');
		expect(sa.clientEmail).toBe('curtis-sa@my-project.iam.gserviceaccount.com');
		expect(sa.tokenUri).toBe('https://oauth2.googleapis.com/token');
		expect(sa.privateKey).toContain('BEGIN PRIVATE KEY');
	});

	it('rejects non-JSON with a paste-oriented message', () => {
		expect(() => parseServiceAccountJson('not json {')).toThrow(/Not valid JSON/);
	});

	it('rejects non-service-account key types', () => {
		expect(() => parseServiceAccountJson(JSON.stringify({ type: 'authorized_user' }))).toThrow(/authorized_user/);
	});

	it('names the missing fields', () => {
		const err = (() => {
			try {
				parseServiceAccountJson(JSON.stringify({ type: 'service_account', project_id: 'p' }));
				return '';
			} catch (e) {
				return e instanceof Error ? e.message : '';
			}
		})();
		expect(err).toContain('client_email');
		expect(err).toContain('private_key');
		expect(err).toContain('token_uri');
	});
});

describe('signJwt', () => {
	it('produces an RS256 JWT that verifies against the signing key', async () => {
		const pair = await crypto.subtle.generateKey(
			{ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
			true,
			['sign', 'verify'],
		);
		const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
		const pem = `-----BEGIN PRIVATE KEY-----\n${(toBase64(pkcs8).match(/.{1,64}/g) ?? []).join('\n')}\n-----END PRIVATE KEY-----`;

		const claims = { iss: 'sa@example.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/devstorage.read_only', aud: 'https://oauth2.googleapis.com/token', iat: 1000, exp: 4600 };
		const jwt = await signJwt(claims, pem);

		const [head, payload, signature] = jwt.split('.');
		expect(jwt.split('.').length).toBe(3);
		expect(segmentJson(head)).toEqual({ alg: 'RS256', typ: 'JWT' });
		expect(segmentJson(payload)).toEqual(claims);

		const signedInput = new TextEncoder().encode(`${head}.${payload}`);
		const sigBytes = signatureBytes(signature);
		const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', pair.publicKey, sigBytes, signedInput);
		expect(ok).toBe(true);

		// Cross-check with an independent key: must NOT verify (wrong key).
		const other = await crypto.subtle.generateKey(
			{ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
			true,
			['sign', 'verify'],
		);
		const wrongKeyOk = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', other.publicKey, sigBytes, signedInput);
		expect(wrongKeyOk).toBe(false);
	});

	it('rejects a garbage private key', async () => {
		await expect(signJwt({ iss: 'x' }, '-----BEGIN PRIVATE KEY-----\n!!!!\n-----END PRIVATE KEY-----')).rejects.toThrow();
	});
});

describe('GcpTokenSource', () => {
	interface Harness {
		requests: HttpSendRequest[];
		setResponse: (resp: Partial<HttpSendResponse>) => void;
		advance: (ms: number) => void;
		source: GcpTokenSource;
	}

	function makeHarness(serviceAccount: GcpServiceAccount, respond?: (req: HttpSendRequest) => Partial<HttpSendResponse>): Harness {
		const requests: HttpSendRequest[] = [];
		let nowMs = 1_000_000;
		let lastResponse: Partial<HttpSendResponse> = { status: 200, text: JSON.stringify({ access_token: 'tok-1', expires_in: 3600 }) };
		const sender = async (req: HttpSendRequest): Promise<HttpSendResponse> => {
			requests.push(req);
			const custom = respond?.(req);
			return { status: 200, text: '', ...lastResponse, ...custom };
		};
		return {
			requests,
			setResponse: (resp) => { lastResponse = resp; },
			advance: (ms) => { nowMs += ms; },
			source: new GcpTokenSource(serviceAccount, sender, () => nowMs),
		};
	}

	it('exchanges a signed JWT for a token and caches it', async () => {
		const pem = await generateKeyPem();
		const h = makeHarness(testServiceAccount(pem));
		const token = await h.source.getToken();
		expect(token).toBe('tok-1');
		expect(h.requests.length).toBe(1);

		const req = h.requests[0];
		expect(req.url).toBe('https://oauth2.googleapis.com/token');
		expect(req.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
		const body = new URLSearchParams(req.body ?? '');
		expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
		const assertion = body.get('assertion') ?? '';
		const claims = segmentJson(assertion.split('.')[1]);
		expect(claims.iss).toBe('curtis-sa@my-project.iam.gserviceaccount.com');
		expect(claims.scope).toBe('https://www.googleapis.com/auth/devstorage.read_only');
		expect(claims.aud).toBe('https://oauth2.googleapis.com/token');

		// Cached — no second request while the token is fresh.
		await expect(h.source.getToken()).resolves.toBe('tok-1');
		expect(h.requests.length).toBe(1);
	});

	it('refreshes near expiry and honors the 2-minute skew', async () => {
		const pem = await generateKeyPem();
		const h = makeHarness(testServiceAccount(pem));
		await h.source.getToken();
		expect(h.requests.length).toBe(1);

		// 10 minutes before expiry: still inside the cache window (skew is 2).
		h.advance(50 * 60 * 1000);
		await h.source.getToken();
		expect(h.requests.length).toBe(1);

		// 1 minute before expiry: inside the skew — refresh.
		h.advance(9 * 60 * 1000);
		h.setResponse({ text: JSON.stringify({ access_token: 'tok-2', expires_in: 3600 }) });
		await expect(h.source.getToken()).resolves.toBe('tok-2');
		expect(h.requests.length).toBe(2);
	});

	it('mints a fresh token after invalidate() (the 401 path)', async () => {
		const pem = await generateKeyPem();
		const h = makeHarness(testServiceAccount(pem));
		await h.source.getToken();
		h.source.invalidate();
		h.setResponse({ text: JSON.stringify({ access_token: 'tok-2', expires_in: 3600 }) });
		await expect(h.source.getToken()).resolves.toBe('tok-2');
		expect(h.requests.length).toBe(2);
	});

	it('surfaces Google\'s error_description on a failed exchange', async () => {
		const pem = await generateKeyPem();
		const h = makeHarness(testServiceAccount(pem));
		h.setResponse({ status: 400, text: JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }) });
		await expect(h.source.getToken()).rejects.toThrow(/Invalid JWT Signature/);
	});
});
