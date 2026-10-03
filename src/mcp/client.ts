// MCP client session — one instance per configured server.
//
// Lifecycle: connect() runs the initialize handshake + notifications/
// initialized, then lists tools (paginated). callTool() executes a tool and
// transparently recovers from a dropped session (404 → re-initialize → retry
// once). All protocol failures throw; the manager records them as server
// status so the settings UI can show what happened.

import {
	MCP_CLIENT_NAME,
	MCP_CLIENT_PROTOCOL_VERSION,
} from './types';
import type {
	JsonRpcOutbound,
	McpContentBlock,
	McpToolCallResult,
	McpToolDescriptor,
} from './types';
import {
	StreamableHttpTransport,
	McpRpcError,
	McpSessionExpiredError,
} from './transport';

export { McpRpcError, McpSessionExpiredError, McpTransportError } from './transport';
export type { HttpSender } from './transport';

export interface McpClientOptions {
	url: string;
	headers: Record<string, string>;
	/** Plugin version for clientInfo — injected from manifest.json. */
	clientVersion: string;
	sender?: import('./transport').HttpSender;
	/** Control-plane timeout (initialize, tools/list). */
	timeoutMs?: number;
	/** tools/call timeout — server tools can legitimately be slow. */
	callTimeoutMs?: number;
}

const CONTROL_TIMEOUT_MS = 20_000;
const CALL_TIMEOUT_MS = 120_000;

export class McpClient {
	readonly tools: McpToolDescriptor[] = [];
	serverName?: string;
	serverVersion?: string;

	private readonly transport: StreamableHttpTransport;
	private readonly clientVersion: string;
	private readonly callTimeoutMs: number;
	private nextId = 1;

	constructor(opts: McpClientOptions) {
		this.transport = new StreamableHttpTransport({
			url: opts.url,
			headers: opts.headers,
			sender: opts.sender,
			timeoutMs: opts.timeoutMs ?? CONTROL_TIMEOUT_MS,
		});
		this.clientVersion = opts.clientVersion;
		this.callTimeoutMs = opts.callTimeoutMs ?? CALL_TIMEOUT_MS;
	}

	get connected(): boolean {
		return this.transport.sessionId !== undefined || this.handshakeDone;
	}

	private handshakeDone = false;

	/**
	 * initialize → notifications/initialized → tools/list. Safe to call again
	 * after a session drop: the transport resets first.
	 */
	async connect(): Promise<void> {
		this.transport.resetSession();
		this.handshakeDone = false;

		const initMsg: JsonRpcOutbound = {
			jsonrpc: '2.0',
			id: this.nextId++,
			method: 'initialize',
			params: {
				protocolVersion: MCP_CLIENT_PROTOCOL_VERSION,
				// Empty capability set: no sampling, no roots, no subscriptions.
				capabilities: {},
				clientInfo: { name: MCP_CLIENT_NAME, version: this.clientVersion },
			},
		};
		const { response, headers } = await this.transport.initialize(initMsg);
		this.transport.captureSession(response, headers);
		const result = response.result || {};
		const info = result.serverInfo;
		if (info && typeof info === 'object' && !Array.isArray(info)) {
			const rec = info as Record<string, unknown>;
			this.serverName = typeof rec.name === 'string' ? rec.name : undefined;
			this.serverVersion = typeof rec.version === 'string' ? rec.version : undefined;
		}

		// Acknowledge before making any other request (spec requirement).
		await this.transport.send({
			jsonrpc: '2.0',
			method: 'notifications/initialized',
		});

		// A server that declares no tools capability rejects tools/list with
		// Method-not-found — finish connected with an empty tool list instead
		// of erroring the whole connect. Missing capabilities field: attempt
		// the list anyway (lenient).
		const caps = result.capabilities;
		const capsIsObject = !!caps && typeof caps === 'object' && !Array.isArray(caps);
		const serverDeclaresNoTools = capsIsObject && !('tools' in (caps as Record<string, unknown>));

		this.tools.length = 0;
		if (!serverDeclaresNoTools) {
			this.tools.push(...(await this.listTools()));
		}
		this.handshakeDone = true;
	}

	/** tools/list with cursor pagination. */
	private async listTools(): Promise<McpToolDescriptor[]> {
		const out: McpToolDescriptor[] = [];
		let cursor: string | undefined;
		do {
			const params: Record<string, unknown> = {};
			if (cursor) params.cursor = cursor;
			const result = await this.request('tools/list', params);
			const tools = result.tools;
			if (Array.isArray(tools)) {
				for (const t of tools) {
					if (!t || typeof t !== 'object' || Array.isArray(t)) continue;
					const rec = t as Record<string, unknown>;
					if (typeof rec.name !== 'string' || !rec.name) continue;
					const schema = rec.inputSchema;
					out.push({
						name: rec.name,
						description: typeof rec.description === 'string' ? rec.description : undefined,
						inputSchema:
							schema && typeof schema === 'object' && !Array.isArray(schema)
								? (schema as Record<string, unknown>)
								: undefined,
					});
				}
			}
			cursor = typeof result.nextCursor === 'string' ? result.nextCursor : undefined;
		} while (cursor);
		return out;
	}

	/**
	 * tools/call. Returns the raw MCP result — content formatting lives in
	 * formatToolCallResult so tests and callers can treat them separately.
	 * Throws on JSON-RPC errors; a result with isError=true is NOT a throw —
	 * the caller decides how to surface it (see formatToolCallResult).
	 */
	async callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
		try {
			const result = await this.request('tools/call', { name, arguments: args }, this.callTimeoutMs);
			return normalizeToolResult(result);
		} catch (e) {
			if (e instanceof McpSessionExpiredError) {
				// Server dropped our session (restart/TTL). Re-initialize once
				// and replay the call against the fresh session.
				await this.connect();
				const result = await this.request('tools/call', { name, arguments: args }, this.callTimeoutMs);
				return normalizeToolResult(result);
			}
			throw e;
		}
	}

	/** One JSON-RPC request/response round-trip. */
	private async request(
		method: string,
		params: Record<string, unknown>,
		timeoutMs?: number
	): Promise<Record<string, unknown>> {
		const msg: JsonRpcOutbound = {
			jsonrpc: '2.0',
			id: this.nextId++,
			method,
			params,
		};
		const resp = await this.transport.send(msg, timeoutMs);
		if (!resp) {
			throw new McpRpcError(-32700, `MCP server sent no response for ${method}`);
		}
		if (resp.error) {
			throw new McpRpcError(resp.error.code, resp.error.message, resp.error.data);
		}
		return resp.result || {};
	}
}

// ---------------------------------------------------------------------------
// Result → text formatting
// ---------------------------------------------------------------------------

/** Tool results longer than this get truncated — providers cap context and a
 *  single runaway MCP tool shouldn't eat the whole window. */
const MAX_TOOL_RESULT_CHARS = 20_000;

export interface FormattedToolResult {
	text: string;
	isError: boolean;
}

/**
 * Convert an MCP tools/call result to the plain-text shape Curtis tool
 * results use. Text blocks join with blank lines; non-text blocks become
 * bracketed descriptors (tool results are strings in every provider dialect
 * Curtis speaks — images can't ride a tool result). structuredContent is the
 * fallback when a server returns no text blocks at all.
 */
export function formatToolCallResult(result: McpToolCallResult): FormattedToolResult {
	const parts: string[] = [];
	for (const block of result.content || []) {
		const rendered = renderContentBlock(block);
		if (rendered) parts.push(rendered);
	}

	let text = parts.join('\n\n').trim();
	if (!text && result.structuredContent !== undefined && result.structuredContent !== null) {
		try {
			text = JSON.stringify(result.structuredContent, null, 2);
		} catch {
			// Cyclic or otherwise unserializable — don't lose the call entirely.
			text = '[structured content could not be serialized]';
		}
	}
	if (!text) text = '(empty result)';

	if (text.length > MAX_TOOL_RESULT_CHARS) {
		text = text.slice(0, MAX_TOOL_RESULT_CHARS) + `\n\n…[truncated, ${text.length} chars total]`;
	}

	return { text, isError: result.isError === true };
}

function renderContentBlock(block: McpContentBlock): string | null {
	switch (block.type) {
		case 'text':
			return typeof block.text === 'string' ? block.text : null;
		case 'image':
		case 'audio': {
			const kind = block.type === 'image' ? 'image' : 'audio';
			const size = typeof block.data === 'string' ? block.data.length : 0;
			return `[${kind}: ${block.mimeType || 'unknown type'}, ~${size} bytes — binary content not shown]`;
		}
		case 'resource_link':
			return `[resource: ${block.name || 'unnamed'}] ${block.uri || '(no uri)'}`;
		case 'resource': {
			const r = block.resource;
			if (!r) return null;
			if (typeof r.text === 'string') return r.text;
			return `[resource: ${r.uri || 'embedded'}, ${r.mimeType || 'unknown type'} — binary content not shown]`;
		}
		default:
			return `[unsupported content block: ${block.type}]`;
	}
}

/** Narrow an untyped JSON-RPC result into an McpToolCallResult. */
function normalizeToolResult(result: Record<string, unknown>): McpToolCallResult {
	const out: McpToolCallResult = {};
	if (Array.isArray(result.content)) {
		out.content = result.content.filter(
			(b): b is McpContentBlock => !!b && typeof b === 'object' && !Array.isArray(b) && typeof (b as Record<string, unknown>).type === 'string'
		);
	}
	if (result.structuredContent !== undefined) {
		out.structuredContent = result.structuredContent;
	}
	if (result.isError === true) out.isError = true;
	return out;
}
