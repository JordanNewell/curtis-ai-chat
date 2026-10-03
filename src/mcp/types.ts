// MCP — Model Context Protocol client types.
//
// Curtis is an MCP *client*: it connects to MCP servers the user already runs
// and turns their tools into first-class entries in the Curtis tool registry.
// Transport: Streamable HTTP only (works on desktop and mobile — requestUrl,
// no child processes). stdio servers can be bridged with mcp-proxy or
// supergateway.
//
// Spec references (kept intentionally small — we only need the tool subset):
//   initialize handshake, notifications/initialized, tools/list (paginated),
//   tools/call. No sampling, no roots, no subscriptions — we advertise an
//   empty client capability set, so a compliant server will never send
//   server→client requests.

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 wire shapes
// ---------------------------------------------------------------------------

export type JsonRpcId = string | number;

export interface JsonRpcRequest {
	jsonrpc: '2.0';
	id: JsonRpcId;
	method: string;
	params?: Record<string, unknown>;
}

export interface JsonRpcNotification {
	jsonrpc: '2.0';
	method: string;
	params?: Record<string, unknown>;
}

export interface JsonRpcErrorObj {
	code: number;
	message: string;
	data?: unknown;
}

export interface JsonRpcResponse {
	jsonrpc: '2.0';
	id: JsonRpcId;
	result?: Record<string, unknown>;
	error?: JsonRpcErrorObj;
}

export type JsonRpcOutbound = JsonRpcRequest | JsonRpcNotification;

export function isJsonRpcResponse(v: unknown): v is JsonRpcResponse {
	if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
	const rec = v as Record<string, unknown>;
	return rec.jsonrpc === '2.0' && (typeof rec.id === 'string' || typeof rec.id === 'number') && !('method' in rec);
}

// ---------------------------------------------------------------------------
// MCP tool descriptors + results
// ---------------------------------------------------------------------------

/** A tool advertised by a server via tools/list. `inputSchema` is the
 *  server's own JSON Schema for arguments — passed through verbatim. */
export interface McpToolDescriptor {
	name: string;
	description?: string;
	inputSchema?: Record<string, unknown>;
}

/** Content blocks a tool result may carry (subset we can render as text). */
export interface McpContentBlock {
	type: string;
	text?: string;
	mimeType?: string;
	data?: string;
	uri?: string;
	name?: string;
	resource?: {
		uri?: string;
		mimeType?: string;
		text?: string;
		blob?: string;
	};
}

export interface McpToolCallResult {
	content?: McpContentBlock[];
	structuredContent?: unknown;
	isError?: boolean;
}

// ---------------------------------------------------------------------------
// Config (persisted in data.json) + runtime status
// ---------------------------------------------------------------------------

/** One user-configured MCP server. Persisted — headers may carry auth
 *  tokens, which live in data.json (documented in the settings UI). */
export interface McpServerConfig {
	/** Stable id (survives renames); generated once at creation. */
	id: string;
	/** Display name, also the tool namespace: mcp__<name>__<tool>. */
	name: string;
	/** Streamable HTTP endpoint of the MCP server. */
	url: string;
	enabled: boolean;
	/** Static headers sent with every request (auth, tenant ids). */
	headers: { name: string; value: string }[];
}

export type McpConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/** Per-server runtime state surfaced in the settings UI. Not persisted. */
export interface McpServerStatus {
	state: McpConnectionState;
	toolCount: number;
	serverName?: string;
	serverVersion?: string;
	error?: string;
}

// ---------------------------------------------------------------------------
// Protocol constants
// ---------------------------------------------------------------------------

/** Newest protocol version Curtis offers at initialize. Servers negotiate
 *  down; whatever they echo is used verbatim on later requests. */
export const MCP_CLIENT_PROTOCOL_VERSION = '2025-06-18';

/** clientInfo name — version is injected from manifest.json at runtime so it
 *  can't drift from the release. */
export const MCP_CLIENT_NAME = 'curtis-ai-chat';
