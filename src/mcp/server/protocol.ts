// MCP server mode — the pure JSON-RPC half.
//
// Server mode turns the MCP relationship around: Curtis, already an MCP
// client, also serves the vault as tools so external AI apps (Claude
// Desktop, coding agents) can work with the user's notes. This module holds
// the protocol logic and knows nothing about HTTP or Obsidian — a backend
// interface carries the tool catalog, so the dispatcher is unit-testable
// with a fake and the HTTP layer stays a thin shell around it.
//
// Wire shape: MCP Streamable HTTP rides JSON-RPC 2.0. We are a stateless
// server — no sessions, no server-initiated streams. Batching was removed
// from the spec in 2025-06-18, so a batch body is an invalid request.

/** Protocol versions this server speaks. A client asking for an older one
 *  gets the newest we support (the spec's negotiation rule). */
export const MCP_SERVER_PROTOCOL_VERSION = '2025-06-18';
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-03-26', '2025-06-18'];

/** JSON-RPC 2.0 reserved error codes we actually send. */
export const RPC_ERRORS = {
	PARSE: -32700,
	INVALID_REQUEST: -32600,
	METHOD_NOT_FOUND: -32601,
	INVALID_PARAMS: -32602,
	INTERNAL: -32603,
} as const;

export type JsonRpcId = string | number | null;

export interface McpToolSpec {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

/** One tool result — mirrors the MCP content block we support (text only). */
export interface McpCallResult {
	content: { type: 'text'; text: string }[];
	isError?: boolean;
}

/** The tool catalog the dispatcher serves. The HTTP layer builds a real one
 *  over the vault; tests hand in whatever they like. */
export interface McpServerBackend {
	listTools(): McpToolSpec[];
	callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult>;
}

export interface McpServerInfo {
	name: string;
	version: string;
}

export interface McpJsonRpcResponse {
	jsonrpc: '2.0';
	id: JsonRpcId;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
}

/** Handle one decoded JSON-RPC message. Resolves with the response object
 *  for a request, or null for a notification (the HTTP layer answers 202).
 *  Async because tools/call awaits the backend. */
export async function handleJsonRpcMessage(
	message: unknown,
	backend: McpServerBackend,
	serverInfo: McpServerInfo
): Promise<McpJsonRpcResponse | null> {
	if (!isRpcEnvelope(message)) {
		return errorResponse(null, RPC_ERRORS.INVALID_REQUEST, 'Not a JSON-RPC 2.0 request');
	}
	const { id, method } = message;

	// Notifications carry no id and get no response — `initialized` is the
	// one we expect; any other is tolerated and dropped.
	if (id === undefined) return null;

	switch (method) {
		case 'initialize':
			return {
				jsonrpc: '2.0',
				id,
				result: {
					protocolVersion: negotiateVersion(message.params),
					capabilities: { tools: { listChanged: false } },
					serverInfo,
					instructions:
						'Curtis vault tools: list, read, and search the user\'s Obsidian vault. ' +
						'Paths are vault-relative. write_note only exists when the user enabled writes.',
				},
			};
		case 'ping':
			return { jsonrpc: '2.0', id, result: {} };
		case 'tools/list':
			return { jsonrpc: '2.0', id, result: { tools: backend.listTools() } };
		case 'tools/call': {
			const params = message.params as { name?: unknown; arguments?: unknown } | undefined;
			if (typeof params?.name !== 'string') {
				return errorResponse(id, RPC_ERRORS.INVALID_PARAMS, 'tools/call requires a string "name"');
			}
			const args = params.arguments;
			if (args !== undefined && !isPlainObject(args)) {
				return errorResponse(id, RPC_ERRORS.INVALID_PARAMS, 'tools/call "arguments" must be an object');
			}
			const catalog = backend.listTools();
			if (!catalog.some((t) => t.name === params.name)) {
				return errorResponse(id, RPC_ERRORS.INVALID_PARAMS, `Unknown tool: ${params.name}`);
			}
			// Tool failures are RESULTS (isError), not protocol errors — the
			// spec's rule, and what lets a client show the message to the model.
			return backend
				.callTool(params.name, isPlainObject(args) ? args : {})
				.then((result) => ({ jsonrpc: '2.0' as const, id, result }))
				.catch((e: unknown) => ({
					jsonrpc: '2.0' as const,
					id,
					result: {
						content: [{ type: 'text' as const, text: e instanceof Error ? e.message : String(e) }],
						isError: true,
					},
				}));
		}
		default:
			return errorResponse(id, RPC_ERRORS.METHOD_NOT_FOUND, `Method not found: ${method}`);
	}
}

/** Build the -32700 response for a body that never parsed. */
export function rpcParseErrorResponse(): McpJsonRpcResponse {
	return errorResponse(null, RPC_ERRORS.PARSE, 'Invalid JSON body');
}

function errorResponse(id: JsonRpcId, code: number, message: string): McpJsonRpcResponse {
	return { jsonrpc: '2.0', id, error: { code, message } };
}

function negotiateVersion(params: unknown): string {
	const requested = isPlainObject(params) && typeof params.protocolVersion === 'string'
		? params.protocolVersion
		: undefined;
	if (requested && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)) return requested;
	return MCP_SERVER_PROTOCOL_VERSION;
}

function isRpcEnvelope(m: unknown): m is {
	jsonrpc: '2.0'; method: string; params?: unknown; id?: JsonRpcId;
} {
	if (!isPlainObject(m)) return false;
	if (m.jsonrpc !== '2.0' || typeof m.method !== 'string') return false;
	const id = m.id;
	if (id !== undefined && typeof id !== 'string' && typeof id !== 'number' && id !== null) return false;
	return true;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}
