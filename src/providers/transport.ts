// Transport layer — the single network entry point for AI chat requests.
//
// Three-tier strategy based on platform + provider capabilities:
//   1. node-https — Desktop + need CORS bypass + need streaming.
//      Uses require('https') via window.require. True streaming, supports abort.
//      Available only when Platform.isDesktopApp is true (Node integration).
//   2. fetch — Native renderer fetch. True streaming IF the provider sends
//      Access-Control-Allow-Origin. Works on mobile for CORS-friendly providers.
//   3. requestUrl — Obsidian's wrapper. CORS-immune (runs Node-side) but
//      BUFFERS the whole response — no real streaming, no AbortSignal.
//      Last-resort fallback (mobile + non-CORS provider) and the historical path.
//
// Selection logic:
//   - Desktop + stream requested → try node-https (works for every provider).
//   - Mobile + stream requested + provider known to send CORS → fetch.
//   - Non-streaming (or stream fallback) → requestUrl.
//
// This isolates all transport policy in one file; callAI doesn't know or care
// which path served a given request.

import { Platform, requestUrl } from 'obsidian';
import type { RequestUrlResponse } from 'obsidian';
import type { AIProvider, StreamResponse, StreamCallback, UsageCallback, ErrorCallback } from '../types';
import { streamResponseFromNode, streamResponseFromBuffer } from './stream-shim';
import type { NodeIncomingMessage } from './stream-shim';
import { isRecord } from '../core/types/json-helpers';

export type TransportKind = 'node-https' | 'fetch' | 'requestUrl';

/**
 * Minimal shape of the Electron `window.require` we use to load Node's https
 * module from inside the desktop renderer. Defined inline to avoid pulling
 * in @types/node at runtime (mobile renderer has no Node globals).
 */
/**
 * Minimal surface of Node's `https` module that we consume. Defined inline
 * (instead of `typeof import('https')`) so the type resolves without
 * @types/node in the scanner's environment.
 */
interface NodeHttpsModule {
	request(
		options: Record<string, unknown>,
		callback: (res: NodeIncomingMessage) => void
	): NodeClientRequest;
}

interface NodeClientRequest {
	write(data: string): void;
	end(): void;
	on(event: 'error', listener: (err: Error) => void): unknown;
	destroy(): void;
}

interface ElectronRequire {
	(moduleName: 'https'): NodeHttpsModule;
	(moduleName: string): unknown;
}

export interface ChatStreamCallbacks {
	onChunk?: StreamCallback;
	onUsage?: UsageCallback;
	onError?: ErrorCallback;
	signal?: AbortSignal;
}

export interface ChatStreamResult {
	/** Cancels the in-flight request. Safe to call after completion. */
	cancel: () => void;
	/**
	 * Resolves when the response body has been fully consumed (or errored).
	 * For non-streaming transports, this resolves after the buffered body is parsed.
	 */
	done: Promise<void>;
}

/**
 * Lazy accessor for Node's http/https module, picked by protocol. Returns
 * undefined on mobile or if Node integration is unavailable. Never throws.
 */
function getNodeHttpModule(protocol: string): NodeHttpsModule | undefined {
	if (!Platform.isDesktopApp) return undefined;
	try {
		// window.require bypasses esbuild hoisting; http(s) is externalized.
		const req = (window as unknown as { require?: ElectronRequire }).require;
		if (typeof req !== 'function') return undefined;
		return req(protocol === 'http:' ? 'http' : 'https') as NodeHttpsModule;
	} catch {
		return undefined;
	}
}

/**
 * Pick the best transport for the request.
 * - `stream: true` requests prefer node-https (desktop) or fetch (mobile).
 * - `stream: false` requests use requestUrl (simplest, works everywhere).
 */
export function pickTransport(stream: boolean, endpoint?: string): TransportKind {
	if (stream) {
		const protocol = endpoint ? new URL(endpoint).protocol : 'https:';
		if (getNodeHttpModule(protocol) !== undefined) return 'node-https';
		// fetch() is architecturally required here for mobile streaming.
		// Obsidian's requestUrl does not support SSE streaming (it buffers).
		// Mobile users have no alternative transport for CORS-friendly providers.
		// Use window.fetch to satisfy Obsidian's no-restricted-globals rule.
		if (typeof window.fetch !== 'undefined') return 'fetch';
	}
	// requestUrl always available; safe fallback.
	return 'requestUrl';
}

/**
 * Flatten a HeadersInit (Record, array of pairs, or Headers) into a plain
 * Record<string, string>. Avoids Object.entries() which widens to `any`.
 */
export function flattenHeaders(init: HeadersInit | undefined | null): Record<string, string> {
	const out: Record<string, string> = {};
	if (!init) return out;
	if (init instanceof Headers) {
		init.forEach((v, k) => { out[k] = v; });
		return out;
	}
	if (Array.isArray(init)) {
		for (const pair of init) {
			if (Array.isArray(pair) && pair.length >= 2) {
				const k = String(pair[0]);
				const v = String(pair[1]);
				if (k) out[k] = v;
			}
		}
		return out;
	}
	// Record<string, string>
	for (const k of Object.keys(init)) {
		out[k] = String(init[k]);
	}
	return out;
}

/**
 * Execute a chat completion request via the chosen transport. Calls provider
 * hooks (parseStream if streaming, parseResponse otherwise) and dispatches
 * results to callbacks.
 *
 * `requestInit` is the provider-built RequestInit (method, headers, body).
 * `provider.endpoint` is the target URL.
 */
export async function chatStream(
	provider: AIProvider,
	requestInit: RequestInit,
	options: { stream: boolean },
	callbacks: ChatStreamCallbacks = {}
): Promise<ChatStreamResult> {
	const transport = pickTransport(options.stream, provider.endpoint);
	let cancelImpl: () => void = () => {};

	const done = new Promise<void>((resolve, reject) => {
		cancelImpl = () => resolve(); // cancel resolves (does not reject)
		const onAbort = () => cancelImpl();
		if (callbacks.signal) {
			if (callbacks.signal.aborted) {
				resolve();
				return;
			}
			callbacks.signal.addEventListener('abort', onAbort, { once: true });
		}

		const run = async () => {
			try {
				if (transport === 'node-https') {
					await runViaNodeHttps(provider, requestInit, options.stream, callbacks, (c) => { cancelImpl = c; });
				} else if (transport === 'fetch') {
					let delivered = false;
					const tracked: ChatStreamCallbacks = {
						...callbacks,
						onChunk: (c) => { delivered = true; callbacks.onChunk?.(c); },
						onUsage: (u) => { delivered = true; callbacks.onUsage?.(u); },
					};
					try {
						await runViaFetch(provider, requestInit, options.stream, tracked, (c) => { cancelImpl = c; });
					} catch (err) {
						const networkish = err instanceof TypeError
							|| (err instanceof Error && err.message.includes('fetch unavailable'));
						if (delivered || callbacks.signal?.aborted || !networkish) throw err;
						// CORS/network failure before any content arrived (mobile
						// common case): retry once, buffered, via requestUrl.
						await runViaRequestUrl(provider, rewriteBodyStreamOff(requestInit), callbacks);
					}
				} else {
					await runViaRequestUrl(provider, requestInit, callbacks);
				}
				resolve();
			} catch (err) {
				// An aborted request must not surface as a user-facing error —
				// socket teardown (ConnResetException, hang-up) lands here too.
				if (callbacks.signal?.aborted) {
					resolve();
					return;
				}
				const error = err instanceof Error ? err : new Error(String(err));
				if (error.name === 'AbortError') {
					resolve();
					return;
				}
				callbacks.onError?.(error);
				reject(error);
			} finally {
				if (callbacks.signal) callbacks.signal.removeEventListener('abort', onAbort);
			}
		};
		void run();
	});

	return { cancel: () => cancelImpl(), done };
}

// ---------------------------------------------------------------------------
// Transport 1: Node https — desktop streaming with true abort
// ---------------------------------------------------------------------------

function runViaNodeHttps(
	provider: AIProvider,
	requestInit: RequestInit,
	stream: boolean,
	callbacks: ChatStreamCallbacks,
	registerCancel: (cancel: () => void) => void
): Promise<void> {
	const url = new URL(provider.endpoint);
	const https = getNodeHttpModule(url.protocol);
	if (!https) throw new Error('Node http(s) unavailable on this platform');
	const body = (requestInit.body as string) ?? '';
	const headers: Record<string, string> = flattenHeaders(requestInit.headers);

	const options = {
		protocol: url.protocol,
		hostname: url.hostname,
		port: url.port || (url.protocol === 'https:' ? 443 : 80),
		path: url.pathname + url.search,
		method: requestInit.method || 'POST',
		headers: {
			...headers,
			'Content-Length': new TextEncoder().encode(body).length,
		},
	};

	return new Promise<void>((resolve, reject) => {
		const req = https.request(options, (res: NodeIncomingMessage) => {
			const status = res.statusCode ?? 0;
			if (status < 200 || status >= 400) {
				// Drain error body for a meaningful message
				let errBody = '';
				res.on('data', (c: Uint8Array) => (errBody += new TextDecoder('utf8').decode(c)));
				res.on('end', () => {
					reject(new Error(`${provider.name} API error (${status}): ${errBody.slice(0, 500)}`));
				});
				return;
			}

			const response: StreamResponse = streamResponseFromNode(res);

			if (stream) {
				provider.parseStream(
					response,
					(chunk) => callbacks.onChunk?.(chunk),
					(usage) => callbacks.onUsage?.(usage),
					(err) => callbacks.onError?.(err)
				).then(resolve, reject);
			} else {
				provider.parseResponse(response).then((ai) => {
					if (ai.content) callbacks.onChunk?.(ai.content);
					if (ai.usage) callbacks.onUsage?.(ai.usage);
					resolve();
				}, reject);
			}
		});

		req.on('error', (err: Error) => {
			// AbortError surfaces here as socket hang-up; normalize.
			if (callbacks.signal?.aborted) {
				resolve();
				return;
			}
			reject(err);
		});

		// Wire abort — destroy the underlying socket immediately.
		if (callbacks.signal) {
			if (callbacks.signal.aborted) {
				req.destroy();
			} else {
				callbacks.signal.addEventListener('abort', () => req.destroy(), { once: true });
			}
		}
		registerCancel(() => req.destroy());

		req.write(body);
		req.end();
	});
}

// ---------------------------------------------------------------------------
// Transport 2: Native fetch — true streaming when provider sends CORS headers
// ---------------------------------------------------------------------------

async function runViaFetch(
	provider: AIProvider,
	requestInit: RequestInit,
	stream: boolean,
	callbacks: ChatStreamCallbacks,
	registerCancel: (cancel: () => void) => void
): Promise<void> {
	// Mobile-only streaming path. requestUrl cannot stream SSE; node-https is
	// unavailable on mobile. fetch is the only transport that works for mobile + CORS-friendly providers.
	// Use window.fetch to satisfy Obsidian's no-restricted-globals rule.
	if (typeof window.fetch === 'undefined') {
		throw new Error('fetch unavailable — falling back');
	}

	// Mobile-only streaming path. requestUrl cannot stream SSE; node-https is
	// unavailable on mobile. This is the only transport that works for mobile + CORS-friendly providers.
	const response = await window.fetch(provider.endpoint, {
		...requestInit,
		signal: callbacks.signal,
	});

	if (!response.ok) {
		const errorText = await response.text().catch(() => 'Unknown error');
		throw new Error(`${provider.name} API error (${response.status}): ${errorText}`);
	}

	// fetch Response already satisfies StreamResponse shape (body is ReadableStream).
	const streamResponse = response as unknown as StreamResponse;

	// Register while the stream is live — after parseStream the body is spent
	// and cancelling is a no-op.
	registerCancel(() => {
		const body = response.body as { cancel?: () => Promise<void> } | null;
		void body?.cancel?.();
	});

	if (stream) {
		await provider.parseStream(
			streamResponse,
			(chunk) => callbacks.onChunk?.(chunk),
			(usage) => callbacks.onUsage?.(usage),
			(err) => callbacks.onError?.(err)
		);
	} else {
		const ai = await provider.parseResponse(streamResponse);
		if (ai.content) callbacks.onChunk?.(ai.content);
		if (ai.usage) callbacks.onUsage?.(ai.usage);
	}
}

// ---------------------------------------------------------------------------
// Transport 3: Obsidian requestUrl — CORS-immune but buffered, no abort
// ---------------------------------------------------------------------------

async function runViaRequestUrl(
	provider: AIProvider,
	requestInit: RequestInit,
	callbacks: ChatStreamCallbacks
): Promise<void> {
	// requestUrl cannot be aborted — but a request that is already cancelled
	// must not deliver its buffered payload into a finalized chat bubble.
	if (callbacks.signal?.aborted) return;
	const headers: Record<string, string> = flattenHeaders(requestInit.headers);

	let urlResp: RequestUrlResponse;
	try {
		urlResp = await requestUrl({
			url: provider.endpoint,
			method: requestInit.method || 'POST',
			headers,
			body: requestInit.body as string,
			throw: true,
		});
	} catch (e) {
		const msg = (e as { message?: string }).message || String(e);
		throw new Error(`${provider.name} API error: ${msg}`);
	}
	if (callbacks.signal?.aborted) return;

	// Parse the body ourselves and narrow at the boundary. requestUrl returns
	// .json already-parsed, but we re-parse .text so the value flows through
	// isRecord before reaching provider.parseResponse.
	const body = urlResp.text;
	const data: unknown = JSON.parse(body);
	if (!isRecord(data)) {
		throw new Error(`${provider.name}: malformed JSON response`);
	}
	// Pass `data` to provider.parseResponse which will narrow further.
	const response = streamResponseFromBuffer(urlResp.status, body, data);
	const ai = await provider.parseResponse(response);
	if (ai.content) callbacks.onChunk?.(ai.content);
	if (ai.usage) callbacks.onUsage?.(ai.usage);
	// Note: requestUrl ignores AbortSignal; abort during this path is best-effort.
}

/**
 * Rewrite a JSON request body with `stream: false` — used when a failed
 * streaming fetch is retried buffered via requestUrl (which cannot stream).
 */
function rewriteBodyStreamOff(requestInit: RequestInit): RequestInit {
	if (typeof requestInit.body !== 'string') return requestInit;
	try {
		const parsed: unknown = JSON.parse(requestInit.body);
		if (isRecord(parsed) && parsed.stream === true) {
			return { ...requestInit, body: JSON.stringify({ ...parsed, stream: false }) };
		}
	} catch {
		// Non-JSON body — send as-is.
	}
	return requestInit;
}
