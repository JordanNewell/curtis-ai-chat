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
interface ElectronRequire {
	(moduleName: 'https'): typeof import('https');
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
 * Lazy accessor for Node's https module. Returns undefined on mobile or if
 * Node integration is unavailable for any reason. Never throws.
 */
function getNodeHttps(): typeof import('https') | undefined {
	if (!Platform.isDesktopApp) return undefined;
	try {
		// window.require bypasses esbuild hoisting; https is externalized.
		const req = (window as unknown as { require?: ElectronRequire }).require;
		if (typeof req !== 'function') return undefined;
		return req('https');
	} catch {
		return undefined;
	}
}

/**
 * Pick the best transport for the request.
 * - `stream: true` requests prefer node-https (desktop) or fetch (mobile).
 * - `stream: false` requests use requestUrl (simplest, works everywhere).
 */
export function pickTransport(stream: boolean): TransportKind {
	if (stream) {
		if (getNodeHttps() !== undefined) return 'node-https';
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
	const transport = pickTransport(options.stream);
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
					await runViaFetch(provider, requestInit, options.stream, callbacks, (c) => { cancelImpl = c; });
				} else {
					await runViaRequestUrl(provider, requestInit, callbacks);
				}
				resolve();
			} catch (err) {
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
	const https = getNodeHttps();
	if (!https) throw new Error('Node https unavailable on this platform');

	const url = new URL(provider.endpoint);
	const body = (requestInit.body as string) ?? '';
	const headers: Record<string, string> = {};
	for (const [k, v] of Object.entries(requestInit.headers || {})) {
		headers[k] = String(v);
	}

	const options = {
		protocol: url.protocol,
		hostname: url.hostname,
		port: url.port || (url.protocol === 'https:' ? 443 : 80),
		path: url.pathname + url.search,
		method: requestInit.method || 'POST',
		headers: {
			...headers,
			'Content-Length': Buffer.byteLength(body),
		},
	};

	return new Promise<void>((resolve, reject) => {
		const req = https.request(options, (res) => {
			const nodeRes = res as unknown as NodeIncomingMessage;
			const status = nodeRes.statusCode ?? 0;
			if (status < 200 || status >= 400) {
				// Drain error body for a meaningful message
				let errBody = '';
				nodeRes.on('data', (c: Buffer) => (errBody += c.toString('utf8')));
				nodeRes.on('end', () => {
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

	registerCancel(() => {
		// fetch has no native cancel beyond AbortSignal (already wired above).
		// response.body?.cancel() is a soft-cancel for the stream.
		const body = response.body as { cancel?: () => Promise<void> } | null;
		void body?.cancel?.();
	});
}

// ---------------------------------------------------------------------------
// Transport 3: Obsidian requestUrl — CORS-immune but buffered, no abort
// ---------------------------------------------------------------------------

async function runViaRequestUrl(
	provider: AIProvider,
	requestInit: RequestInit,
	callbacks: ChatStreamCallbacks
): Promise<void> {
	const headers: Record<string, string> = {};
	for (const [k, v] of Object.entries(requestInit.headers || {})) {
		headers[k] = String(v);
	}

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
