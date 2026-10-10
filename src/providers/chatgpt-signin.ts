// "Sign in with ChatGPT" — OAuth 2.0 Authorization Code + PKCE against
// auth.openai.com, using OpenAI's dynamic client registration (no client
// secret: `client_id=dynamic_agent_client` plus a per-installation host id;
// OpenAI issues the real client id back on the redirect). Wire details —
// scopes, `resource` on token requests, discovery-first endpoints, issued
// client id riding the callback — cross-checked 2026-10-10 against the
// official devkit source (github.com/openai/sign-in-with-chatgpt-devkit,
// packages/local/src/oauth.ts).
//
// Flow (desktop only — needs Node for the loopback listener):
//   1. Spin up a one-shot HTTP server on 127.0.0.1 (ephemeral port).
//   2. Open the system browser at the authorize URL with PKCE + state + nonce.
//   3. Catch the redirect, validate state, exchange the code at the token
//      endpoint, persist the blob via the provider config's OAuth secret.
//
// Access tokens live ~1h; the refresh token (~30d) renews them in
// ChatGPTProvider.prepare(). Requests then hit the standard api.openai.com
// Responses API and bill against the user's ChatGPT plan (scope
// `chatgpt.tokens.use.direct`), not against API credits.

import { Platform, requestUrl } from 'obsidian';
import type { App } from 'obsidian';
import type { CurtisSettings } from '../types';
import type { ChatGPTTokens, ChatGPTTokenStore } from './chatgpt';
import { parseTokenBlob } from './chatgpt';
import { resolveOAuthBlob, storeOAuthBlob } from '../core/secrets';

const CHATGPT_ISSUER = 'https://auth.openai.com';
/** Dynamic-registration client id — OpenAI issues the real one on redirect. */
const DYNAMIC_CLIENT_ID = 'dynamic_agent_client';
// Scope string matches the devkit verbatim. `resource.invoke` gates the
// API-resource grant; without `chatgpt.tokens.use.direct` a successful
// sign-in authenticates the user but cannot spend their plan.
const CHATGPT_SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
/** The API surface plan-usage tokens are minted for — sent on the authorize
 *  URL AND both token requests (the devkit includes it on all three). */
const CHATGPT_RESOURCE = 'https://api.openai.com/v1';
/** Give up waiting for the browser round-trip after five minutes. */
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

// Endpoints come from the issuer's OIDC discovery document rather than
// hardcoded paths — same as the devkit. Cached for the session; the issuer
// and endpoint origins are validated before use.
interface ChatGPTDiscovery {
	authorization_endpoint: string;
	token_endpoint: string;
}

let discoveryCache: Promise<ChatGPTDiscovery> | undefined;

function chatGPTDiscovery(): Promise<ChatGPTDiscovery> {
	discoveryCache ??= (async () => {
		const resp = await requestUrl({
			url: `${CHATGPT_ISSUER}/.well-known/openid-configuration`,
			method: 'GET',
			throw: false,
		});
		if (resp.status < 200 || resp.status >= 300) {
			discoveryCache = undefined;
			throw new Error(`ChatGPT sign-in configuration unreachable (${resp.status}).`);
		}
		const data: unknown = resp.json;
		if (!data || typeof data !== 'object' || (data as Record<string, unknown>).issuer !== CHATGPT_ISSUER) {
			discoveryCache = undefined;
			throw new Error('ChatGPT sign-in configuration could not be verified.');
		}
		const endpoints: Partial<ChatGPTDiscovery> = {};
		for (const key of ['authorization_endpoint', 'token_endpoint'] as const) {
			const value = (data as Record<string, unknown>)[key];
			if (typeof value !== 'string' || (() => { try { return new URL(value).origin !== CHATGPT_ISSUER; } catch { return true; } })()) {
				discoveryCache = undefined;
				throw new Error('ChatGPT sign-in configuration could not be verified.');
			}
			endpoints[key] = value;
		}
		return endpoints as ChatGPTDiscovery;
	})();
	return discoveryCache;
}

/** True where the loopback listener can run (desktop Node integration). */
export function isChatGPTSignInAvailable(): boolean {
	if (!Platform.isDesktopApp) return false;
	try {
		return typeof (window as unknown as { require?: unknown }).require === 'function';
	} catch {
		return false;
	}
}

/** Minimal shape of Electron's window.require for Node's http module — same
 *  pattern as transport.ts, inline so mobile never resolves @types/node. */
interface NodeHttpModule {
	createServer(handler: (req: { url?: string }, res: NodeServerResponseLike) => void): NodeServerLike;
}

interface NodeServerResponseLike {
	writeHead(status: number, headers: Record<string, string>): void;
	end(body: string): void;
}

interface NodeServerLike {
	listen(port: number, host: string, callback: () => void): void;
	close(callback?: (err?: Error) => void): void;
	address(): { port: number };
}

function getNodeHttp(): NodeHttpModule | undefined {
	if (!Platform.isDesktopApp) return undefined;
	try {
		const req = (window as unknown as { require?: (m: string) => unknown }).require;
		if (typeof req !== 'function') return undefined;
		return req('http') as NodeHttpModule;
	} catch {
		return undefined;
	}
}

// ---------------------------------------------------------------------------
// PKCE (RFC 7636, S256) on WebCrypto — no Node dependency, works in the
// Electron renderer and under vitest alike.
// ---------------------------------------------------------------------------

function base64Url(bytes: Uint8Array): string {
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomBase64Url(byteLength: number): string {
	const buf = new Uint8Array(byteLength);
	crypto.getRandomValues(buf);
	return base64Url(buf);
}

async function generatePkcePair(): Promise<{ verifier: string; challenge: string }> {
	const verifier = randomBase64Url(32);
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
	return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

/** Best-effort `chatgpt_account_id` pull from the ID token payload. */
function accountIdFromIdToken(idToken: string | undefined): string | undefined {
	if (!idToken) return undefined;
	const parts = idToken.split('.');
	if (parts.length < 2) return undefined;
	try {
		const payload: unknown = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
		if (payload && typeof payload === 'object') {
			const claim = (payload as Record<string, unknown>)['chatgpt_account_id'];
			if (typeof claim === 'string') return claim;
		}
	} catch {
		// Non-decodable id_token — informational only, ignore.
	}
	return undefined;
}

function tokensFromTokenResponse(body: Record<string, unknown>): ChatGPTTokens {
	// The server echoes the granted scopes. If plan usage is absent, the
	// sign-in authenticated the user but the tokens cannot spend the plan —
	// fail loudly rather than shipping credentials that 403 on first request.
	if (typeof body.scope === 'string' && !body.scope.split(/\s+/).includes('chatgpt.tokens.use.direct')) {
		throw new Error('OpenAI did not grant ChatGPT plan usage for Curtis AI — sign in again and approve plan usage.');
	}
	const accessToken = body.access_token;
	if (typeof accessToken !== 'string' || !accessToken) {
		throw new Error('Token endpoint returned no access_token');
	}
	const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : 3600;
	const tokens: ChatGPTTokens = {
		access_token: accessToken,
		expires_at: Date.now() + expiresIn * 1000,
	};
	if (typeof body.refresh_token === 'string' && body.refresh_token) tokens.refresh_token = body.refresh_token;
	if (typeof body.client_id === 'string' && body.client_id) tokens.client_id = body.client_id;
	const accountId = accountIdFromIdToken(typeof body.id_token === 'string' ? body.id_token : undefined);
	if (accountId) tokens.account_id = accountId;
	return tokens;
}

async function postTokenRequest(form: Record<string, string>): Promise<ChatGPTTokens> {
	const { token_endpoint } = await chatGPTDiscovery();
	const resp = await requestUrl({
		url: token_endpoint,
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(form).toString(),
		throw: false,
	});
	if (resp.status < 200 || resp.status >= 300) {
		const detail = (resp.text || '').slice(0, 300);
		throw new Error(`ChatGPT token exchange failed (${resp.status}): ${detail}`);
	}
	const body: unknown = resp.json;
	if (!body || typeof body !== 'object') throw new Error('ChatGPT token endpoint returned a malformed body');
	return tokensFromTokenResponse(body as Record<string, unknown>);
}

/** Exchange an authorization code for the initial token pair. */
export async function exchangeAuthorizationCode(opts: {
	code: string;
	redirectUri: string;
	clientId: string;
	codeVerifier: string;
}): Promise<ChatGPTTokens> {
	return postTokenRequest({
		grant_type: 'authorization_code',
		code: opts.code,
		redirect_uri: opts.redirectUri,
		client_id: opts.clientId,
		code_verifier: opts.codeVerifier,
		resource: CHATGPT_RESOURCE,
	});
}

/** Rotate the refresh token for a fresh access token (grant_type=refresh_token). */
export async function refreshChatGPTTokens(tokens: ChatGPTTokens): Promise<ChatGPTTokens> {
	if (!tokens.refresh_token) {
		throw new Error('ChatGPT session has no refresh token — sign in again.');
	}
	return postTokenRequest({
		grant_type: 'refresh_token',
		refresh_token: tokens.refresh_token,
		client_id: tokens.client_id || DYNAMIC_CLIENT_ID,
		resource: CHATGPT_RESOURCE,
	});
}

/**
 * Run the full browser sign-in. Resolves with the initial token pair; the
 * caller persists via the token store. Rejects on timeout, state mismatch,
 * user cancellation (error=access_denied on the redirect), or exchange failure.
 *
 * `previousClientId` (the client id issued on an earlier sign-in) is reused
 * when present so re-auth never registers a second app — matching the devkit,
 * which only sends the dynamic placeholder on a truly first sign-in.
 */
export async function signInWithChatGPT(opts: {
	hostId: string;
	agentName?: string;
	previousClientId?: string;
}): Promise<ChatGPTTokens> {
	const http = getNodeHttp();
	if (!http) {
		throw new Error('Sign in with ChatGPT requires Obsidian desktop');
	}

	const { authorization_endpoint } = await chatGPTDiscovery();
	const { verifier, challenge } = await generatePkcePair();
	const state = randomBase64Url(16);
	const nonce = randomBase64Url(16);
	const agentName = opts.agentName || 'Curtis AI';

	// Callback channel — resolved exactly once by the loopback handler below.
	let deliverCallback: ((params: URLSearchParams, error: string | null) => void) | null = null;
	const callbackPromise = new Promise<URLSearchParams>((resolve, reject) => {
		deliverCallback = (params, error) => {
			if (error) {
				reject(new Error(`Sign-in was cancelled: ${error}`));
				return;
			}
			resolve(params);
		};
	});

	// One-shot loopback listener. The port is ephemeral so parallel plugin
	// instances and other local servers never collide.
	const server = http.createServer((req, res) => {
		const url = new URL(req.url || '/', 'http://127.0.0.1');
		if (url.pathname !== '/callback') {
			res.writeHead(404, { 'Content-Type': 'text/plain' });
			res.end('Not found');
			return;
		}
		const error = url.searchParams.get('error');
		const html = error
			? `<!DOCTYPE html><title>Curtis AI</title><body style="font-family:sans-serif;text-align:center;padding-top:3rem"><h3>ChatGPT sign-in failed</h3><p>${error}</p><p>You can close this tab.</p></body>`
			: '<!DOCTYPE html><title>Curtis AI</title><body style="font-family:sans-serif;text-align:center;padding-top:3rem"><h3>ChatGPT connected</h3><p>Curtis AI is signed in — you can close this tab.</p></body>';
		res.writeHead(200, { 'Content-Type': 'text/html' });
		res.end(html);
		deliverCallback?.(url.searchParams, error);
	});

	const redirectUri = await new Promise<string>((resolveListen) => {
		server.listen(0, '127.0.0.1', () => {
			resolveListen(`http://127.0.0.1:${server.address().port}/callback`);
		});
	});

	const authorizeUrl = new URL(authorization_endpoint);
	authorizeUrl.searchParams.set('response_type', 'code');
	authorizeUrl.searchParams.set('client_id', opts.previousClientId ?? DYNAMIC_CLIENT_ID);
	authorizeUrl.searchParams.set('redirect_uri', redirectUri);
	authorizeUrl.searchParams.set('scope', CHATGPT_SCOPES);
	authorizeUrl.searchParams.set('resource', CHATGPT_RESOURCE);
	authorizeUrl.searchParams.set('code_challenge', challenge);
	authorizeUrl.searchParams.set('code_challenge_method', 'S256');
	authorizeUrl.searchParams.set('state', state);
	authorizeUrl.searchParams.set('nonce', nonce);
	// The app-name hint drives dynamic registration — only meaningful (and
	// only sent by the devkit) on a first sign-in.
	if (!opts.previousClientId) authorizeUrl.searchParams.set('agent_name_hint', agentName);
	authorizeUrl.searchParams.set('ext_agent_host_id', `urn:uuid:${opts.hostId}`);

	try {
		window.open(authorizeUrl.toString(), '_blank');

		const params = await withTimeout(callbackPromise, SIGN_IN_TIMEOUT_MS, 'ChatGPT sign-in timed out — no browser callback arrived.');
		if (params.get('state') !== state) {
			throw new Error('ChatGPT sign-in state mismatch — restart the sign-in.');
		}
		const code = params.get('code');
		if (!code) throw new Error('ChatGPT sign-in returned no authorization code.');
		// Dynamic registration: the issued client id rides the callback. Fall
		// back to the dynamic id when the issuer omits it.
		const clientId = params.get('client_id') || DYNAMIC_CLIENT_ID;
		const tokens = await exchangeAuthorizationCode({ code, redirectUri, clientId, codeVerifier: verifier });
		if (!tokens.client_id) tokens.client_id = clientId;
		return tokens;
	} finally {
		server.close();
	}
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = window.setTimeout(() => reject(new Error(message)), ms);
		promise.then(
			(v) => {
				window.clearTimeout(timer);
				resolve(v);
			},
			(e) => {
				window.clearTimeout(timer);
				reject(e instanceof Error ? e : new Error(String(e)));
			}
		);
	});
}

/**
 * The concrete token store the plugin registers with the provider registry:
 * keychain-backed persistence against the `chatgpt` provider config, plus
 * network refresh via Obsidian's CORS-immune requestUrl.
 */
export class ChatGPTTokenManager implements ChatGPTTokenStore {
	constructor(
		private app: App,
		private settings: CurtisSettings,
		private persist: () => Promise<void>
	) {}

	loadTokens(): ChatGPTTokens | null {
		return parseTokenBlob(resolveOAuthBlob(this.app, this.settings.providerConfigs['chatgpt']));
	}

	async saveTokens(tokens: ChatGPTTokens | null): Promise<void> {
		const config = this.settings.providerConfigs['chatgpt'];
		if (!config) return;
		storeOAuthBlob(this.app, 'chatgpt', config, tokens ? JSON.stringify(tokens) : '');
		await this.persist();
	}

	async refresh(tokens: ChatGPTTokens): Promise<ChatGPTTokens> {
		return refreshChatGPTTokens(tokens);
	}
}
