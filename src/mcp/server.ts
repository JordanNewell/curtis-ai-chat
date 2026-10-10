// Curtis MCP Server — expose the vault, long-term memory, and chat history
// over the Model Context Protocol so any MCP client (Claude Desktop, Cursor,
// Windsurf, etc.) can connect to Obsidian as a backend.
//
// Design notes:
//   - Implements the MCP JSON-RPC 2.0 surface directly (no SDK dependency —
//     the plugin bundles to a single main.js and we keep deps at zero).
//   - Streamable HTTP transport: POST /mcp with JSON-RPC request bodies.
//     Batched requests are supported per spec. SSE responses are emitted for
//     notifications; plain JSON is returned for simple request/response.
//   - Binds to 127.0.0.1 only (loopback). Never expose this across the
//     network — it has vault write access. Auth is a user-configurable
//     bearer token (auto-generated on first enable, shown in settings).
//   - Off by default. Opt-in via Settings → Curtis AI Chat → MCP Server.

import { App, Notice, TFile } from 'obsidian';
import type CurtisPlugin from '../main';

// ============================================================================
// Types
// ============================================================================

export interface McpToolDef {
	name: string;
	description: string;
	inputSchema: {
		type: 'object';
		properties: Record<string, unknown>;
		required?: string[];
	};
	handler: (args: Record<string, unknown>) => Promise<ToolPayload>;
}

/** A tool result that is either plain text or structured MCP content blocks. */
type ToolPayload =
	| { type: 'text'; text: string }
	| { type: 'content'; content: Array<Record<string, unknown>> };

interface JsonRpcRequest {
	jsonrpc: '2.0';
	id?: string | number | null;
	method: string;
	params?: Record<string, unknown>;
}

interface JsonRpcResponse {
	jsonrpc: '2.0';
	id: string | number | null;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
}

export interface McpServerStatus {
	running: boolean;
	port: number;
	requestCount: number;
	lastError?: string;
	startedAt?: number;
}

// ============================================================================
// JSON-RPC error codes (per MCP spec / JSON-RPC 2.0)
// ============================================================================

const ERR_PARSE = -32700;
const ERR_INVALID_REQUEST = -32600;
const ERR_METHOD_NOT_FOUND = -32601;
const ERR_INVALID_PARAMS = -32602;
const ERR_INTERNAL = -32603;

const PROTOCOL_VERSION = '2025-03-26';

// ============================================================================
// Helpers
// ============================================================================

function str(v: unknown, fallback = ''): string {
	return typeof v === 'string' ? v : fallback;
}

function num(v: unknown, fallback = 0): number {
	return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Generate a URL-safe random bearer token. */
function generateToken(): string {
	const bytes = new Uint8Array(24);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function textResult(text: string): ToolPayload {
	return { type: 'text', text };
}

function toResponse(id: JsonRpcRequest['id'], result: unknown): JsonRpcResponse {
	return { jsonrpc: '2.0', id: id ?? null, result };
}

function toError(id: JsonRpcRequest['id'], code: number, message: string, data?: unknown): JsonRpcResponse {
	return { jsonrpc: '2.0', id: id ?? null, error: { code, message, data } };
}

// ============================================================================
// Server
// ============================================================================

export class McpServer {
	private plugin: CurtisPlugin;
	private app: App;

	/** Node http server — typed as any so we don't need @types/node at build. */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private httpServer: any = null;
	private status: McpServerStatus = { running: false, port: 0, requestCount: 0 };
	private tools: McpToolDef[] = [];

	constructor(plugin: CurtisPlugin) {
		this.plugin = plugin;
		this.app = plugin.app;
	}

	getStatus(): McpServerStatus {
		return { ...this.status };
	}

	getToken(): string {
		return this.plugin.settings.mcpAuthToken || '';
	}

	// --------------------------------------------------------------------------
	// Lifecycle
	// --------------------------------------------------------------------------

	async start(): Promise<void> {
		if (this.status.running) return;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const mod: any = (window as any).require ? (window as any).require('http') : null;
		if (!mod || !mod.createServer) {
			this.status.lastError = 'Node http module unavailable on this platform';
			new Notice('Curtis MCP: Node http unavailable — cannot start server');
			return;
		}
		if (!this.plugin.settings.mcpAuthToken) {
			this.plugin.settings.mcpAuthToken = generateToken();
			await this.plugin.saveSettings();
		}
		this.tools = this.buildTools();
		const port = this.plugin.settings.mcpPort || 3127;

		this.httpServer = mod.createServer((req: unknown, res: unknown) => {
			this.handleRequest(req, res).catch((e) => {
				console.error('[Curtis MCP] request error:', e);
				this.status.lastError = String((e as Error)?.message ?? e);
			});
		});

		await new Promise<void>((resolve, reject) => {
			this.httpServer.on('error', (err: Error) => {
				this.status.lastError = err.message;
				this.status.running = false;
				new Notice(`Curtis MCP server failed to start: ${err.message}`);
				reject(err);
			});
			this.httpServer.listen(port, '127.0.0.1', () => {
				this.status.running = true;
				this.status.port = port;
				this.status.requestCount = 0;
				this.status.lastError = undefined;
				this.status.startedAt = Date.now();
				console.log(`[Curtis MCP] listening on http://127.0.0.1:${port}/mcp`);
				resolve();
			});
		});
	}

	stop(): void {
		if (this.httpServer) {
			try {
				this.httpServer.close();
			} catch {
				/* already closed */
			}
			this.httpServer = null;
		}
		this.status.running = false;
		this.status.port = 0;
	}

	async restart(): Promise<void> {
		this.stop();
		if (this.plugin.settings.enableMcpServer) {
			await this.start();
		}
	}

	// --------------------------------------------------------------------------
	// HTTP handling (Streamable HTTP transport)
	// --------------------------------------------------------------------------

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private async handleRequest(req: any, res: any): Promise<void> {
		const url = String(req.url ?? '');
		const method = String(req.method ?? 'GET');

		if (!url.startsWith('/mcp')) {
			res.writeHead(404, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'not found' }));
			return;
		}

		// Health probe (no auth — returns only running state, no data).
		if (method === 'GET' && url.replace(/\?.*$/, '') === '/mcp/health') {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ ok: true, server: 'curtis-mcp', protocol: PROTOCOL_VERSION }));
			return;
		}

		// Auth — every other request must carry the bearer token.
		const auth = String(req.headers?.['authorization'] ?? '');
		if (auth !== `Bearer ${this.getToken()}`) {
			res.writeHead(401, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'unauthorized' }));
			return;
		}

		if (method === 'DELETE') {
			// Session termination per Streamable HTTP spec — stateless here.
			res.writeHead(204);
			res.end();
			return;
		}

		if (method !== 'POST') {
			res.writeHead(405, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'method not allowed' }));
			return;
		}

		// Read and parse body.
		const chunks: Buffer[] = [];
		for await (const chunk of req) chunks.push(chunk as Buffer);
		let bodyText: string;
		try {
			bodyText = Buffer.concat(chunks).toString('utf-8');
		} catch {
			res.writeHead(400, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'bad request body' }));
			return;
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(bodyText);
		} catch {
			res.writeHead(400, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify(toError(null, ERR_PARSE, 'Parse error')));
			return;
		}

		const requests: JsonRpcRequest[] = Array.isArray(parsed)
			? (parsed as unknown[]).filter(isRecord).map((r) => r as unknown as JsonRpcRequest)
			: [parsed as JsonRpcRequest];

		this.status.requestCount += requests.length;

		// Process each request. Notifications (no id) get no response object.
		const responses: JsonRpcResponse[] = [];
		for (const request of requests) {
			const resp = await this.dispatch(request);
			if (resp) responses.push(resp);
		}

		if (responses.length === 0) {
			res.writeHead(202);
			res.end();
			return;
		}

		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify(Array.isArray(parsed) ? responses : responses[0]));
	}

	private async dispatch(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
		const id = request.id ?? null;
		const method = String(request.method ?? '');
		const params = isRecord(request.params) ? request.params : {};

		if (!request.jsonrpc || (request.id === undefined && !isNotification(request))) {
			return toError(id, ERR_INVALID_REQUEST, 'Invalid Request');
		}

		switch (method) {
			case 'initialize':
				return toResponse(id, {
					protocolVersion: PROTOCOL_VERSION,
					capabilities: {
						tools: { listChanged: false },
						resources: { subscribe: false, listChanged: false },
					},
					serverInfo: {
						name: 'curtis-mcp',
						title: 'Curtis AI Chat — Obsidian Vault',
						version: this.plugin.manifest?.version ?? '1.0.0',
					},
					instructions:
						'This server exposes an Obsidian vault: notes, long-term AI memory, and chat history. ' +
						'Use list/read/write tools for notes, memory_* tools for the durable memory file, ' +
						'and chat_history / chat_search for past conversations.',
				});

			case 'notifications/initialized':
				return null; // notification — no response

			case 'ping':
				return toResponse(id, {});

			case 'tools/list':
				return toResponse(id, {
					tools: this.tools.map((t) => ({
						name: t.name,
						description: t.description,
						inputSchema: t.inputSchema,
					})),
				});

			case 'tools/call': {
				const name = str(params.name);
				const args = isRecord(params.arguments) ? params.arguments : {};
				const tool = this.tools.find((t) => t.name === name);
				if (!tool) return toError(id, ERR_INVALID_PARAMS, `Unknown tool: ${name}`);
				try {
					const payload = await tool.handler(args);
					if (payload.type === 'text') {
						return toResponse(id, {
							content: [{ type: 'text', text: payload.text }],
						});
					}
					return toResponse(id, { content: payload.content });
				} catch (e) {
					return toResponse(id, {
						content: [{ type: 'text', text: `Error: ${String((e as Error)?.message ?? e)}` }],
						isError: true,
					});
				}
			}

			case 'resources/list':
				return toResponse(id, { resources: await this.listResources() });

			case 'resources/read': {
				const uri = str(params.uri);
				const resource = await this.readResource(uri);
				if (!resource) return toError(id, ERR_INVALID_PARAMS, `Unknown resource: ${uri}`);
				return toResponse(id, { contents: [resource] });
			}

			default:
				return toError(id, ERR_METHOD_NOT_FOUND, `Method not found: ${method}`);
		}
	}

	// --------------------------------------------------------------------------
	// Vault access helpers
	// --------------------------------------------------------------------------

	private listMarkdownFiles(): TFile[] {
		return this.app.vault.getMarkdownFiles();
	}

	private noteSummary(f: TFile): Record<string, unknown> {
		return { name: f.name, path: f.path, size: f.stat.size, modified: f.stat.mtime };
	}

	private async readNote(path: string): Promise<string> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) throw new Error(`Note not found: ${path}`);
		return this.app.vault.read(file);
	}

	/**
	 * Search notes by name substring, tag, or content substring. Name matches
	 * rank highest, then tags, then content hits. Content scan is bounded by
	 * maxScan files (largest-first skip) so huge vaults don't get fully read.
	 */
	private async searchNotes(
		query: string,
		limit: number,
		maxScan = 800,
	): Promise<Array<Record<string, unknown>>> {
		const q = query.toLowerCase();
		const files = this.listMarkdownFiles().slice(0, maxScan);
		const results: Array<{ path: string; score: number; excerpt: string }> = [];
		for (const f of files) {
			let score = 0;
			let excerpt = '';
			if (f.name.toLowerCase().includes(q) || f.basename.toLowerCase().includes(q)) {
				score += 10;
			}
			const cache = this.app.metadataCache.getFileCache(f);
			const tags = (cache?.tags ?? []).map((t) => t.tag.toLowerCase());
			const fmTags = Object.keys(cache?.frontmatter?.tags ?? {});
			if (tags.some((t) => t.includes(q)) || fmTags.some((t) => String(t).toLowerCase().includes(q))) {
				score += 5;
			}
			if (score === 0) {
				try {
					const content = (await this.app.vault.cachedRead(f)).toLowerCase();
					const idx = content.indexOf(q);
					if (idx !== -1) {
						score += 1;
						excerpt = content.slice(Math.max(0, idx - 60), idx + 120).replace(/\s+/g, ' ').trim();
					}
				} catch {
					/* unreadable file — skip */
				}
			}
			if (score > 0) results.push({ path: f.path, score, excerpt });
		}
		return results.sort((a, b) => b.score - a.score).slice(0, limit);
	}

	// --------------------------------------------------------------------------
	// Tool definitions
	// --------------------------------------------------------------------------

	private buildTools(): McpToolDef[] {
		return [
			{
				name: 'list_notes',
				description: 'List markdown notes in the vault. Optionally scope to a folder.',
				inputSchema: {
					type: 'object',
					properties: {
						folder: { type: 'string', description: 'Optional folder path prefix, e.g. "Projects".' },
						limit: { type: 'number', description: 'Max notes to return (default 100).' },
					},
				},
				handler: async (args) => {
					const folder = str(args.folder).replace(/^\/+|\/+$/g, '');
					const limit = Math.max(1, num(args.limit, 100));
					let files = this.listMarkdownFiles();
					if (folder) files = files.filter((f) => f.path.startsWith(`${folder}/`));
					files = files.slice(0, limit);
					return textResult(
						JSON.stringify({ count: files.length, notes: files.map((f) => this.noteSummary(f)) }, null, 2),
					);
				},
			},
			{
				name: 'read_note',
				description: 'Read the full content of a vault note by path.',
				inputSchema: {
					type: 'object',
					properties: { path: { type: 'string', description: 'Vault-relative path, e.g. "Projects/idea.md".' } },
					required: ['path'],
				},
				handler: async (args) => {
					const path = str(args.path);
					const content = await this.readNote(path);
					return textResult(content);
				},
			},
			{
				name: 'create_note',
				description: 'Create a new note in the vault (fails if the path already exists).',
				inputSchema: {
					type: 'object',
					properties: {
						path: { type: 'string', description: 'Vault-relative path for the new note.' },
						content: { type: 'string', description: 'Markdown content of the note.' },
					},
					required: ['path', 'content'],
				},
				handler: async (args) => {
					const path = str(args.path);
					const content = str(args.content);
					if (!path.endsWith('.md')) throw new Error('Path must end in .md');
					if (this.app.vault.getAbstractFileByPath(path)) {
						throw new Error(`Note already exists: ${path}. Use append_note or edit_note instead.`);
					}
					await this.ensureFolderFor(path);
					await this.app.vault.create(path, content);
					return textResult(`Created ${path}`);
				},
			},
			{
				name: 'append_note',
				description: 'Append content to an existing note (creates it if missing).',
				inputSchema: {
					type: 'object',
					properties: {
						path: { type: 'string', description: 'Vault-relative path.' },
						content: { type: 'string', description: 'Markdown content to append.' },
					},
					required: ['path', 'content'],
				},
				handler: async (args) => {
					const path = str(args.path);
					const content = str(args.content);
					const file = this.app.vault.getAbstractFileByPath(path);
					if (file instanceof TFile) {
						const existing = await this.app.vault.read(file);
						await this.app.vault.modify(file, `${existing.replace(/\n*$/, '\n')}${content}\n`);
						return textResult(`Appended to ${path}`);
					}
					await this.ensureFolderFor(path);
					await this.app.vault.create(path, `${content}\n`);
					return textResult(`Created ${path} (did not exist)`);
				},
			},
			{
				name: 'overwrite_note',
				description: 'Replace the entire content of an existing note. Destructive — prefer append_note.',
				inputSchema: {
					type: 'object',
					properties: {
						path: { type: 'string', description: 'Vault-relative path.' },
						content: { type: 'string', description: 'New full markdown content.' },
					},
					required: ['path', 'content'],
				},
				handler: async (args) => {
					const path = str(args.path);
					const file = this.app.vault.getAbstractFileByPath(path);
					if (!(file instanceof TFile)) throw new Error(`Note not found: ${path}`);
					await this.app.vault.modify(file, str(args.content));
					return textResult(`Overwrote ${path}`);
				},
			},
			{
				name: 'search_notes',
				description: 'Search notes by title substring or tag. Returns matching paths.',
				inputSchema: {
					type: 'object',
					properties: {
						query: { type: 'string', description: 'Search string.' },
						limit: { type: 'number', description: 'Max results (default 20).' },
					},
					required: ['query'],
				},
				handler: async (args) => {
					const query = str(args.query);
					const limit = Math.max(1, num(args.limit, 20));
					const results = await this.searchNotes(query, limit);
					return textResult(JSON.stringify({ count: results.length, results }, null, 2));
				},
			},
			{
				name: 'memory_read',
				description: "Read Curtis's durable long-term memory file (bullet-list of user facts).",
				inputSchema: { type: 'object', properties: {} },
				handler: async () => {
					const facts = this.plugin.memoryStore?.getFacts() ?? [];
					return textResult(
						JSON.stringify(
							{
								path: this.plugin.settings.memoryFilePath || 'AI/Curtis Memory.md',
								count: facts.length,
								facts: facts.map((f) => ({
									id: f.id,
									content: f.content,
									category: f.category ?? null,
									updated: new Date(f.timestamp).toISOString(),
								})),
							},
							null,
							2,
						),
					);
				},
			},
			{
				name: 'memory_add',
				description: 'Add a durable fact to Curtis long-term memory (deduped on exact content).',
				inputSchema: {
					type: 'object',
					properties: {
						content: { type: 'string', description: 'The fact, one sentence.' },
						category: { type: 'string', description: 'Optional category label.' },
					},
					required: ['content'],
				},
				handler: async (args) => {
					const content = str(args.content);
					const category = str(args.category) || undefined;
					if (!this.plugin.memoryStore) throw new Error('Memory store not loaded');
					const fact = await this.plugin.memoryStore.addFact(content, category);
					return fact
						? textResult(`Stored fact ${fact.id}`)
						: textResult('Not stored (empty content)');
				},
			},
			{
				name: 'memory_delete',
				description: 'Delete a fact from Curtis long-term memory by id.',
				inputSchema: {
					type: 'object',
					properties: { id: { type: 'string', description: 'Fact id (from memory_read).' } },
					required: ['id'],
				},
				handler: async (args) => {
					const id = str(args.id);
					if (!this.plugin.memoryStore) throw new Error('Memory store not loaded');
					const ok = await this.plugin.memoryStore.deleteFact(id);
					return textResult(ok ? `Deleted ${id}` : `No fact with id ${id}`);
				},
			},
			{
				name: 'chat_history',
				description: 'List stored chat conversations, or fetch one conversation full transcript.',
				inputSchema: {
					type: 'object',
					properties: {
						conversation_id: { type: 'string', description: 'Conversation id. Omit to list conversations.' },
						limit: { type: 'number', description: 'List page size (default 25).' },
					},
				},
				handler: async (args) => {
					const store = this.plugin.conversationStore;
					if (!store) throw new Error('Conversation store not loaded');
					const convId = str(args.conversation_id);
					if (convId) {
						const conv = store.getAllConversations().find((c) => c.id === convId);
						if (!conv) throw new Error(`No conversation ${convId}`);
						return textResult(
							JSON.stringify(
								{
									id: conv.id,
									title: conv.title,
									provider: conv.provider,
									model: conv.model,
									messages: conv.messages.map((m) => ({
										role: m.role,
										content: typeof m.content === 'string' ? m.content : '[non-text content]',
										timestamp: new Date(m.timestamp).toISOString(),
									})),
								},
								null,
								2,
							),
						);
					}
					const limit = Math.max(1, num(args.limit, 25));
					const convs = store.getAllConversations().slice(0, limit);
					return textResult(
						JSON.stringify(
							{
								count: convs.length,
								conversations: convs.map((c) => ({
									id: c.id,
									title: c.title,
									provider: c.provider,
									model: c.model,
									messages: c.messages.length,
									updated: new Date(c.updatedAt).toISOString(),
								})),
							},
							null,
							2,
						),
					);
				},
			},
			{
				name: 'chat_search',
				description: 'Full-text search across all stored chat conversations.',
				inputSchema: {
					type: 'object',
					properties: { query: { type: 'string', description: 'Search string.' } },
					required: ['query'],
				},
				handler: async (args) => {
					const query = str(args.query);
					if (!query) throw new Error('query is required');
					const store = this.plugin.conversationStore;
					if (!store) throw new Error('Conversation store not loaded');
					const q = query.toLowerCase();
					const hits = store.getAllConversations()
						.filter((c) => c.messages.some((m) => typeof m.content === 'string' && m.content.toLowerCase().includes(q)))
						.map((c) => {
						const matching = c.messages.filter(
							(m) => typeof m.content === 'string' && m.content.toLowerCase().includes(query.toLowerCase()),
						);
						return {
							id: c.id,
							title: c.title,
							matches: matching.slice(0, 3).map((m) => ({
								role: m.role,
								excerpt: (typeof m.content === 'string' ? m.content : '').slice(0, 200),
							})),
						};
					});
					return textResult(JSON.stringify({ count: hits.length, results: hits }, null, 2));
				},
			},
		];
	}

	/** Create parent folders for a note path if missing. */
	private async ensureFolderFor(path: string): Promise<void> {
		const parts = path.split('/').slice(0, -1);
		let prefix = '';
		for (const part of parts) {
			prefix = prefix ? `${prefix}/${part}` : part;
			if (!this.app.vault.getAbstractFileByPath(prefix)) {
				await this.app.vault.createFolder(prefix);
			}
		}
	}

	// --------------------------------------------------------------------------
	// Resources (read-only MCP resources for note discovery)
	// --------------------------------------------------------------------------

	private async listResources(): Promise<Array<Record<string, unknown>>> {
		const files = this.listMarkdownFiles().slice(0, 500); // cap payload size
		return [
			{
				uri: 'curtis://memory',
				name: 'Curtis Memory',
				description: "Curtis's durable long-term memory facts.",
				mimeType: 'application/json',
			},
			...files.map((f) => ({
				uri: `curtis://note/${f.path}`,
				name: f.basename,
				description: `Vault note: ${f.path}`,
				mimeType: 'text/markdown',
			})),
		];
	}

	private async readResource(
		uri: string,
	): Promise<{ uri: string; mimeType: string; text: string } | null> {
		if (uri === 'curtis://memory') {
			const facts = this.plugin.memoryStore?.getFacts() ?? [];
			return {
				uri,
				mimeType: 'application/json',
				text: JSON.stringify(
					facts.map((f) => ({ id: f.id, content: f.content, category: f.category ?? null })),
					null,
					2,
				),
			};
		}
		if (uri.startsWith('curtis://note/')) {
			const path = uri.slice('curtis://note/'.length);
			try {
				return { uri, mimeType: 'text/markdown', text: await this.readNote(path) };
			} catch {
				return null;
			}
		}
		return null;
	}
}

function isNotification(request: JsonRpcRequest): boolean {
	return request.id === undefined || request.id === null;
}

// Re-export nothing — requestUrl is not used here (Node http handles transport).

