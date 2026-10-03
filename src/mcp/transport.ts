// MCP Streamable HTTP transport.
//
// One endpoint, one HTTP verb family: JSON-RPC messages POST to the server
// URL; the server answers with either a single JSON body or a
// text/event-stream that carries the response events. This is the transport
// the MCP spec consolidates on (2025-03-26 onward) and the only one that
// works everywhere Curtis runs — it rides Obsidian's requestUrl, which is
// CORS-immune on desktop and available on mobile. stdio transports are
// intentionally out of scope (no child processes on mobile; use mcp-proxy /
// supergateway to bridge local stdio servers to HTTP).
//
// requestUrl is buffered — it resolves with the complete response body. For
// Streamable HTTP POSTs that's fine in practice: a compliant server closes
// the SSE stream once it has written the JSON-RPC response for that request.
// Server→client notifications between requests are not consumed in v1.4 (we
// advertise an empty client capability set, so compliant servers send none);
// "tools list changed" is handled by the settings Refresh action instead.
// The one server→client REQUEST we may still see on a response stream is
// `ping` — the spec requires an answer, so it is replied to fire-and-forget.

import { requestUrl } from 'obsidian';
import {
	isJsonRpcResponse,
	MCP_CLIENT_PROTOCOL_VERSION,
} from './types';
import type { JsonRpcId, JsonRpcOutbound, JsonRpcResponse } from './types';

// ---------------------------------------------------------------------------
// Injectable HTTP layer — requestUrl by default, plain fetch in the protocol
// smoke test (scripts/mcp-smoke.mjs) so the wire logic is testable in node.
// ---------------------------------------------------------------------------

export interface HttpSendRequest {
	url: string;
	method: 'POST' | 'GET' | 'DELETE';
	headers: Record<string, string>;
	body?: string;
}

export interface HttpSendResponse {
	status: number;
	headers: Record<string, string>;
	text: string;
}

export type HttpSender = (req: HttpSendRequest) => Promise<HttpSendResponse>;

export function defaultHttpSender(req: HttpSendRequest): Promise<HttpSendResponse> {
	return requestUrl({
		url: req.url,
		method: req.method,
		headers: req.headers,
		body: req.body,
		throw: false,
	}).then((resp) => ({
		status: resp.status,
		headers: resp.headers || {},
		text: resp.text || '',
	}));
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class McpTransportError extends Error {
	readonly status?: number;
	constructor(message: string, status?: number) {
		super(message);
		this.name = 'McpTransportError';
		this.status = status;
	}
}

/** 404 after a session was established — the spec's signal that the server
 *  dropped our session (restart, TTL). Client must re-initialize and retry. */
export class McpSessionExpiredError extends McpTransportError {
	constructor() {
		super('MCP session expired (server returned 404)');
		this.name = 'McpSessionExpiredError';
	}
}

/** JSON-RPC error object returned by the server for a specific request. */
export class McpRpcError extends Error {
	readonly code: number;
	readonly data?: unknown;
	constructor(code: number, message: string, data?: unknown) {
		super(message);
		this.name = 'McpRpcError';
		this.code = code;
		this.data = data;
	}
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export interface StreamableHttpTransportOptions {
	url: string;
	/** Static per-server headers (auth etc.), resolved once at construction. */
	headers: Record<string, string>;
	sender?: HttpSender;
	/** Default timeout for a request. Individual sends can override. */
	timeoutMs?: number;
}

export class StreamableHttpTransport {
	readonly url: string;
	sessionId?: string;
	/** Protocol version the SERVER echoed at initialize — sent back as
	 *  MCP-Protocol-Version on every post-initialize request. */
	protocolVersion: string = MCP_CLIENT_PROTOCOL_VERSION;

	private readonly userHeaders: Record<string, string>;
	private readonly sender: HttpSender;
	private readonly defaultTimeoutMs: number;

	constructor(opts: StreamableHttpTransportOptions) {
		this.url = opts.url;
		this.userHeaders = opts.headers;
		this.sender = opts.sender || defaultHttpSender;
		this.defaultTimeoutMs = opts.timeoutMs ?? 20_000;
	}

	/**
	 * POST one JSON-RPC message and return the response with a matching id —
	 * or null when the server accepted a notification (202 / no body) or
	 * answered with a stream that carried no response for this id.
	 */
	async send(message: JsonRpcOutbound, timeoutMs?: number): Promise<JsonRpcResponse | null> {
		const resp = await this.post(message, timeoutMs);
		const { response, pingIds } = parsePostBody(resp, requestIdOf(message));
		this.answerPings(pingIds);
		return response;
	}

	/**
	 * The initialize round-trip additionally needs the response headers
	 * (session id assignment), so it bypasses `send`.
	 */
	async initialize(message: JsonRpcOutbound): Promise<{ response: JsonRpcResponse; headers: Record<string, string> }> {
		const resp = await this.post(message);
		const { response, pingIds } = parsePostBody(resp, requestIdOf(message));
		this.answerPings(pingIds);
		if (!response) {
			throw new McpTransportError('MCP server returned no initialize response');
		}
		if (response.error) {
			throw new McpRpcError(response.error.code, response.error.message, response.error.data);
		}
		return { response, headers: resp.headers };
	}

	/** Record the session id / negotiated protocol version from initialize. */
	captureSession(resp: JsonRpcResponse, headers: Record<string, string>): void {
		const sid = headerValue(headers, 'mcp-session-id');
		if (sid) this.sessionId = sid;
		const result = resp.result;
		if (result && typeof result.protocolVersion === 'string') {
			this.protocolVersion = result.protocolVersion;
		}
	}

	resetSession(): void {
		this.sessionId = undefined;
		this.protocolVersion = MCP_CLIENT_PROTOCOL_VERSION;
	}

	private async post(message: JsonRpcOutbound, timeoutMs?: number): Promise<HttpSendResponse> {
		return this.postRaw(JSON.stringify(message), timeoutMs, message.method !== 'initialize', message.method);
	}

	/**
	 * Fire the JSON-RPC result for a server→client `ping` request. The spec's
	 * MUST-respond: a ping left unanswered can stall some servers. Best-effort
	 * — a failed pong must never fail the original call it rode in on.
	 */
	private answerPings(pingIds: JsonRpcId[]): void {
		for (const id of pingIds) {
			void this.postRaw(JSON.stringify({ jsonrpc: '2.0', id, result: { pong: {} } }), this.defaultTimeoutMs, true, 'ping-reply')
				.catch(() => { /* fire-and-forget */ });
		}
	}

	private async postRaw(body: string, timeoutMs: number | undefined, protocolHeaders: boolean, label: string): Promise<HttpSendResponse> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			// Spec: POSTs MUST accept both — a server may answer with either.
			Accept: 'application/json, text/event-stream',
			...this.userHeaders,
		};
		if (this.sessionId) {
			headers['Mcp-Session-Id'] = this.sessionId;
		}
		if (protocolHeaders) {
			headers['MCP-Protocol-Version'] = this.protocolVersion;
		}

		const timeout = timeoutMs ?? this.defaultTimeoutMs;
		const resp = await withTimeout(
			this.sender({
				url: this.url,
				method: 'POST',
				headers,
				body,
			}),
			timeout,
			`MCP request timed out after ${timeout}ms (${label})`
		);

		if (resp.status === 404 && this.sessionId) {
			throw new McpSessionExpiredError();
		}
		if (resp.status < 200 || resp.status >= 300) {
			throw new McpTransportError(
				`MCP server returned HTTP ${resp.status}: ${truncate(resp.text, 200)}`,
				resp.status
			);
		}
		return resp;
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requestIdOf(m: JsonRpcOutbound): string | number | undefined {
	return 'id' in m ? m.id : undefined;
}

/** Case-insensitive header lookup — requestUrl doesn't guarantee key casing. */
function headerValue(headers: Record<string, string>, name: string): string | undefined {
	const lower = name.toLowerCase();
	for (const key of Object.keys(headers)) {
		if (key.toLowerCase() === lower) return headers[key];
	}
	return undefined;
}

/** Result of decoding a 2xx POST response body. */
interface ParsedPostBody {
	/** The JSON-RPC response matching the request id, if any. */
	response: JsonRpcResponse | null;
	/** Ids of server→client `ping` requests seen in the body — each MUST be answered. */
	pingIds: JsonRpcId[];
}

/** Decode a 2xx POST response: plain JSON body, buffered SSE stream, or an
 *  empty notification ack. */
function parsePostBody(resp: HttpSendResponse, id: string | number | undefined): ParsedPostBody {
	const contentType = (headerValue(resp.headers, 'content-type') || '').toLowerCase();

	if (contentType.includes('text/event-stream')) {
		return extractResponseFromSse(resp.text, id);
	}
	if (!resp.text.trim()) {
		return { response: null, pingIds: [] }; // 202 Accepted (notification ack) — no body.
	}
	if (contentType && !contentType.includes('application/json') && !contentType.startsWith('text/')) {
		throw new McpTransportError(`MCP server answered with unexpected content type: ${contentType}`);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(resp.text);
	} catch {
		// A 2xx non-JSON body (proxy error page, HTML) must not escape as a
		// bare SyntaxError — surface status + body so the UI shows why.
		throw new McpTransportError(
			`MCP server returned invalid JSON (HTTP ${resp.status}): ${truncate(resp.text, 200)}`,
			resp.status
		);
	}
	return { response: isJsonRpcResponse(parsed) ? parsed : null, pingIds: pingIdOf(parsed) };
}

/** Server→client request frames we must answer. Only `ping` — our client
 *  capability set is empty, so a compliant server sends nothing else. */
function pingIdOf(parsed: unknown): JsonRpcId[] {
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
	const rec = parsed as Record<string, unknown>;
	if (rec.jsonrpc !== '2.0' || rec.method !== 'ping') return [];
	if (typeof rec.id !== 'string' && typeof rec.id !== 'number') return [];
	return [rec.id];
}

/** Parse a buffered SSE payload and return the JSON-RPC response whose id
 *  matches the request. Notifications and unrelated frames are skipped; a
 *  response for a DIFFERENT id is never attributed to this request. When the
 *  request has no id (notification), the first response-shaped message wins. */
function extractResponseFromSse(text: string, id: string | number | undefined): ParsedPostBody {
	let response: JsonRpcResponse | null = null;
	const pingIds: JsonRpcId[] = [];
	for (const block of text.split(/\r?\n\r?\n/)) {
		const dataLines: string[] = [];
		for (const line of block.split(/\r?\n/)) {
			if (line.startsWith('data:')) {
				// Strip exactly one leading space per the SSE spec.
				dataLines.push(line.slice(5).replace(/^ /, ''));
			}
			// `event:`/`id:` lines are irrelevant — the JSON-RPC id is in-band.
		}
		if (dataLines.length === 0) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(dataLines.join('\n'));
		} catch {
			continue; // keep-alive comments or non-JSON payloads
		}
		pingIds.push(...pingIdOf(parsed));
		if (response || !isJsonRpcResponse(parsed)) continue;
		if (id === undefined || parsed.id === id) response = parsed;
	}
	return { response, pingIds };
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = window.setTimeout(() => reject(new McpTransportError(message)), ms);
		promise.then(
			(value) => {
				window.clearTimeout(timer);
				resolve(value);
			},
			(err: unknown) => {
				window.clearTimeout(timer);
				// Rejection reasons must be Errors — network layers throw arbitrary.
				reject(err instanceof Error ? err : new McpTransportError(`MCP request failed: ${String(err)}`));
			}
		);
	});
}

function truncate(s: string, max: number): string {
	return s.length > max ? s.slice(0, max) + '…' : s;
}
