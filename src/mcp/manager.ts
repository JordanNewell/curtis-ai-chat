// MCP manager — owns one McpClient per configured server and projects their
// tools into the Curtis ToolRegistry.
//
// Design notes:
//  - Tool closures capture the MANAGER + server id, never a client instance.
//    Refreshing a connection rebuilds the client but keeps every registered
//    ToolDefinition valid.
//  - Tool names are namespaced `mcp__<server>__<tool>` and capped at 64 chars
//    (the function-name limit every provider dialect Curtis speaks enforces —
//    one oversized name would otherwise break the whole tools array).
//  - connectAll() is fire-and-forget from onload: a slow or dead server must
//    never delay plugin boot. Failures land in per-server status, not throws.

import type { ToolDefinition, ToolRegistry } from '../core/tools';
import { formatToolCallResult, McpClient } from './client';
import type { McpServerConfig, McpServerStatus } from './types';

export interface McpManagerOptions {
	/** Live view of the persisted server configs (reads plugin settings). */
	getServers: () => McpServerConfig[];
	/** Live master switch (reads plugin settings). */
	isEnabled: () => boolean;
	/** Plugin version from manifest.json — reported in clientInfo. */
	clientVersion: string;
	/** Injectable HTTP layer (protocol smoke test). */
	sender?: import('./client').HttpSender;
}

export class McpManager {
	/** Fired whenever the aggregate MCP tool list may have changed. */
	onToolsChanged?: () => void;

	private readonly clients = new Map<string, McpClient>();
	private readonly statuses = new Map<string, McpServerStatus>();
	private readonly opts: McpManagerOptions;

	constructor(opts: McpManagerOptions) {
		this.opts = opts;
	}

	// ---- Lifecycle ---------------------------------------------------------

	/** Connect every enabled server in parallel. Never throws. */
	async connectAll(): Promise<void> {
		if (!this.opts.isEnabled()) return;
		const servers = this.opts.getServers().filter((s) => s.enabled);
		await Promise.all(servers.map((s) => this.connectServer(s)));
		// The master switch may have been flipped off while handshakes were in
		// flight — don't re-register tools for a disabled feature.
		if (this.opts.isEnabled()) this.emitToolsChanged();
	}

	/** Tear down every connection (plugin unload, master switch off). */
	async disconnectAll(): Promise<void> {
		const ids = [...this.clients.keys()];
		this.clients.clear();
		for (const id of ids) {
			this.statuses.set(id, { state: 'disconnected', toolCount: 0 });
		}
		this.emitToolsChanged();
	}

	/** Master switch. On: connect all. Off: drop everything. */
	async setEnabled(enabled: boolean): Promise<void> {
		if (enabled) await this.connectAll();
		else await this.disconnectAll();
	}

	/**
	 * (Re)connect one server from its CURRENT config. Used at boot, by the
	 * settings Test/Refresh button, and after editing a server. Safe to call
	 * repeatedly. Returns the resulting status.
	 */
	async refreshServer(serverId: string): Promise<McpServerStatus> {
		const config = this.opts.getServers().find((s) => s.id === serverId);
		if (!config) {
			await this.disconnectServer(serverId);
			return this.statusOf(serverId);
		}
		if (!config.enabled || !this.opts.isEnabled()) {
			await this.disconnectServer(serverId);
			return this.statusOf(serverId);
		}
		await this.connectServer(config);
		this.emitToolsChanged();
		return this.statusOf(serverId);
	}

	async disconnectServer(serverId: string): Promise<void> {
		this.clients.delete(serverId);
		const had = this.statuses.get(serverId);
		this.statuses.set(serverId, {
			state: 'disconnected',
			toolCount: 0,
			serverName: had?.serverName,
			serverVersion: had?.serverVersion,
		});
		this.emitToolsChanged();
	}

	// ---- Introspection -----------------------------------------------------

	statusOf(serverId: string): McpServerStatus {
		return this.statuses.get(serverId) || { state: 'disconnected', toolCount: 0 };
	}

	isConnected(serverId: string): boolean {
		return this.clients.get(serverId)?.connected === true;
	}

	// ---- Tool projection ---------------------------------------------------

	/**
	 * Every tool from every connected server, as ToolDefinitions ready for
	 * the registry. Name collisions (sanitized-server clashes, truncated
	 * names) are deduped deterministically.
	 */
	getToolDefinitions(): ToolDefinition[] {
		// Belt to the connect-time guards: even if a client slipped back into
		// the map during a disable race, the master switch wins here.
		if (!this.opts.isEnabled()) return [];
		const defs: ToolDefinition[] = [];
		const seen = new Set<string>();
		for (const config of this.opts.getServers()) {
			if (!config.enabled) continue;
			const client = this.clients.get(config.id);
			if (!client || !client.connected) continue;
			const serverKey = sanitizeServerKey(config.name);
			for (const tool of client.tools) {
				let name = buildMcpToolName(serverKey, tool.name);
				let n = 2;
				while (seen.has(name)) {
					name = uniquify(name, n++);
				}
				seen.add(name);
				defs.push(this.toToolDefinition(config, tool, name));
			}
		}
		return defs;
	}

	/**
	 * Replace the MCP slice of the registry with the current tool set.
	 * Wired to onToolsChanged by main.ts.
	 */
	syncTools(registry: ToolRegistry): void {
		registry.setMcpTools(this.getToolDefinitions());
	}

	/**
	 * Execute one MCP tool call on behalf of a ToolDefinition closure.
	 * Tool-level failures (isError=true) throw — ToolRegistry.executeTool
	 * converts throws into is_error results, which is exactly the semantics
	 * MCP's isError carries.
	 */
	async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<string> {
		const client = this.clients.get(serverId);
		if (!client || !client.connected) {
			throw new Error('MCP server is not connected — reconnect it in Settings → MCP servers');
		}
		try {
			const result = await client.callTool(toolName, args);
			const formatted = formatToolCallResult(result);
			if (formatted.isError) {
				throw new Error(formatted.text);
			}
			return formatted.text;
		} catch (e) {
			if (!client.connected) {
				// A session-expiry reconnect inside callTool failed — drop the
				// dead client so the settings card stops advertising
				// "Connected" and the tool registry stops offering it.
				this.clients.delete(serverId);
				this.statuses.set(serverId, {
					state: 'error',
					toolCount: 0,
					error: e instanceof Error ? e.message : String(e),
				});
				this.emitToolsChanged();
			}
			throw e;
		}
	}

	// ---- Internals ---------------------------------------------------------

	private toToolDefinition(config: McpServerConfig, tool: { name: string; description?: string; inputSchema?: Record<string, unknown> }, registryName: string): ToolDefinition {
		return {
			name: registryName,
			description:
				tool.description?.trim() ||
				`MCP tool '${tool.name}' provided by the '${config.name}' MCP server.`,
			parameters: {},
			// Server's own JSON Schema, passed through — see ToolDefinition.
			inputSchema: normalizeInputSchema(tool.inputSchema),
			execute: async (params) => this.callTool(config.id, tool.name, params),
		};
	}

	private async connectServer(config: McpServerConfig): Promise<void> {
		this.statuses.set(config.id, { state: 'connecting', toolCount: 0 });
		try {
			const client = new McpClient({
				url: config.url,
				headers: headersRecord(config.headers),
				clientVersion: this.opts.clientVersion,
				sender: this.opts.sender,
			});
			await client.connect();
			// The master switch or this server's config may have been flipped
			// off while the handshake was in flight — a completed connect must
			// not resurrect a disabled server's tools. Dropping the reference
			// is enough teardown (the transport is per-request HTTP).
			const stillEnabled = this.opts.isEnabled()
				&& this.opts.getServers().some((s) => s.id === config.id && s.enabled);
			if (!stillEnabled) {
				this.statuses.set(config.id, { state: 'disconnected', toolCount: 0 });
				return;
			}
			this.clients.set(config.id, client);
			this.statuses.set(config.id, {
				state: 'connected',
				toolCount: client.tools.length,
				serverName: client.serverName,
				serverVersion: client.serverVersion,
			});
		} catch (e) {
			this.clients.delete(config.id);
			this.statuses.set(config.id, {
				state: 'error',
				toolCount: 0,
				error: e instanceof Error ? e.message : String(e),
			});
		}
	}

	private emitToolsChanged(): void {
		this.onToolsChanged?.();
	}
}

// ---------------------------------------------------------------------------
// Naming helpers
// ---------------------------------------------------------------------------

/** Provider function-name ceiling (OpenAI + Anthropic both enforce 64). */
const MAX_TOOL_NAME_LEN = 64;

export function sanitizeServerKey(name: string): string {
	const key = name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
	return key || 'server';
}

function sanitizeToolKey(name: string): string {
	return name.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'tool';
}

export function buildMcpToolName(serverKey: string, toolName: string): string {
	const prefix = 'mcp__';
	const separator = '__';
	// Budget the tool suffix FIRST — an unbudgeted 70-char tool name used to
	// slip past the cap because only the server key was ever truncated, and
	// one oversized name gets the whole tools array rejected by providers.
	const suffixRoom = Math.max(1, MAX_TOOL_NAME_LEN - prefix.length - separator.length - 1);
	const toolKey = sanitizeToolKey(toolName).slice(0, suffixRoom);
	const suffix = separator + toolKey;
	const keyRoom = Math.max(1, MAX_TOOL_NAME_LEN - prefix.length - suffix.length);
	const key = serverKey.slice(0, keyRoom);
	// Backstop: the ceiling holds even for pathological inputs.
	return (prefix + key + suffix).slice(0, MAX_TOOL_NAME_LEN);
}

/** Deterministic collision suffix: `name` → `name_2`, `name_3`, … */
function uniquify(name: string, n: number): string {
	const base = name.slice(0, MAX_TOOL_NAME_LEN - String(n).length - 1);
	return `${base}_${n}`;
}

/**
 * Server-provided JSON Schema, made safe for the provider dialects: must be
 * an object schema; missing type defaults to 'object' (some servers emit a
 * bare properties map). Malformed schemas degrade to a permissive
 * accept-anything object — the MCP server validates its own args anyway.
 */
function normalizeInputSchema(schema: Record<string, unknown> | undefined): {
	type: 'object';
	properties?: Record<string, unknown>;
	required?: string[];
} {
	if (!schema) return { type: 'object' };
	const out: { type: 'object'; properties?: Record<string, unknown>; required?: string[] } = {
		type: 'object',
	};
	if (schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)) {
		out.properties = schema.properties as Record<string, unknown>;
	}
	if (Array.isArray(schema.required)) {
		const required = schema.required.filter((r): r is string => typeof r === 'string');
		if (required.length > 0) out.required = required;
	}
	return out;
}

function headersRecord(headers: { name: string; value: string }[]): Record<string, string> {
	const out: Record<string, string> = {};
	for (const h of headers) {
		const name = h.name.trim();
		if (name) out[name] = h.value;
	}
	return out;
}
