import { App, TFile } from 'obsidian';
import { asStringArray, isRecord } from './types/json-helpers';
import { getActiveNoteFile } from '../vault/active-note';
import { WEB_SEARCH_TOOL, READ_URL_TOOL } from './web-tools';
import { RUN_COMMAND_TOOL } from './command-tools';
import type { RagIndexManager } from '../rag/index-manager';
import type CurtisPlugin from '../main';
import type { JsonSchemaObject, ToolParameter } from './tool-schema';
import { buildToolParametersSchema } from './tool-schema';

// The pure schema-builder half lives in ./tool-schema (Obsidian-free, so
// providers and their tests can import it under node). Re-exported here to
// keep this module's public surface unchanged.
export { buildToolParametersSchema };
export type { JsonSchemaObject };
export type { ToolParameter } from './tool-schema';

/** Coerce a tool param value to string. Empty string if absent or wrong type. */
function str(v: unknown): string {
	return typeof v === 'string' ? v : '';
}

/** Coerce a tool param value to number. 0 if absent or wrong type. */
function num(v: unknown): number {
	return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Registry key of the vault-retrieval tool (Settings → Vault retrieval). */
const SEMANTIC_SEARCH_TOOL_NAME = 'semantic_search';

// ============================================================================
// Tool/Function Calling Framework
// ============================================================================
//
// Tools are functions the AI can invoke during a conversation.
// Each tool has a JSON Schema definition and a handler.
//
// Built-in tools:
//   read_note        — Read the content of a vault note
//   search_notes     — Search vault notes by name or content
//   create_note      — Create a new note in the vault
//   edit_note        — Append/replace content in a note
//   list_notes       — List notes in a folder
//   get_tags         — List all tags in the vault
//   get_backlinks    — Get backlinks for a note
//   get_current_note — Get the note open in the editor
//   get_current_date — Get the current date/time
//   calculator       — Evaluate an arithmetic expression
//
// Optional web tools (settings toggle):
//   web_search       — Search the web (DuckDuckGo)
//   read_url         — Fetch and read a URL
//
// Optional command tool (settings toggle, desktop only):
//   run_command      — Run a shell command; confirmation-gated in
//                      callAgentLoop, cwd restricted to the vault by default.
//
// MCP tools (Settings → MCP servers, via McpManager):
//   mcp__<server>__<tool> — any tool exposed by a user-configured MCP server.
//   Not enumerated here: the registry's MCP slice is replaced wholesale
//   (setMcpTools) whenever connections change.
//
// GCP connector tools (Settings → GCP, via GcpManager):
//   gcp__storage__* — read-only Cloud Storage on the user's GCP project.
//   Replaced wholesale (setGcpTools) whenever connection state changes.
//
// Optional vault retrieval tool (Settings → Vault retrieval):
//   semantic_search  — Embedding-based search over the RAG index
// ============================================================================

export interface ToolDefinition {
	name: string;
	description: string;
	parameters: Record<string, ToolParameter>;
	execute: (params: Record<string, unknown>, context: ToolContext) => Promise<string>;
	/**
	 * Full JSON Schema override for `parameters` — used by MCP tools, whose
	 * argument schemas come from the server and can be arbitrarily nested.
	 * When set, buildToolParametersSchema emits this verbatim and the
	 * registry skips its flat required-param pre-check (the MCP server
	 * validates its own arguments).
	 */
	inputSchema?: JsonSchemaObject;
}

export interface ToolContext {
	app: App;
	conversationId?: string;
	/** The plugin — only for tools that orchestrate above the vault layer
	 *  (the swarm's spawn_agent). Ordinary tools never see it. */
	plugin?: CurtisPlugin;
	/** The abort signal of the agent loop that issued the call — stopping
	 *  the leader tears down work the tool started (nested agent runs). */
	signal?: AbortSignal;
	/** Provider/model of the loop that issued the call, so orchestrating
	 *  tools can inherit the caller's model for the work they spawn. */
	providerId?: string;
	modelId?: string;
}

export interface ToolCall {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

export interface ToolResult {
	tool_call_id: string;
	content: string;
	is_error?: boolean;
}

/** Extra per-call context for orchestrating tools (swarm). Ordinary
 *  tools ignore it; executeTool just forwards it into ToolContext. */
export interface ExecuteToolOpts {
	signal?: AbortSignal;
	plugin?: CurtisPlugin;
	providerId?: string;
	modelId?: string;
}

export class ToolRegistry {
	private tools: Map<string, ToolDefinition> = new Map();
	private mcpToolNames: Set<string> = new Set();
	private gcpToolNames: Set<string> = new Set();
	private app: App;
	private ragIndex: RagIndexManager | null = null;

	constructor(
		app: App,
		opts: {
			enableWebSearch?: boolean;
			enableRag?: boolean;
			enableCommands?: boolean;
			ragIndex?: RagIndexManager;
		} = {}
	) {
		this.app = app;
		if (opts.ragIndex) this.ragIndex = opts.ragIndex;
		this.registerBuiltinTools();
		if (opts.enableWebSearch) {
			this.register(WEB_SEARCH_TOOL);
			this.register(READ_URL_TOOL);
		}
		if (opts.enableRag) {
			this.setRagToolEnabled(true);
		}
		if (opts.enableCommands) {
			this.setCommandToolsEnabled(true);
		}
	}

	register(tool: ToolDefinition): () => void {
		this.tools.set(tool.name, tool);
		return () => this.tools.delete(tool.name);
	}

	unregister(name: string): void {
		this.tools.delete(name);
	}

	/**
	 * Hot-reload the web tools (web_search + read_url) without rebuilding the
	 * rest of the registry. Called from the settings toggle so users don't
	 * need to reload Obsidian when flipping enableWebSearch.
	 */
	setWebToolsEnabled(enabled: boolean): void {
		if (enabled) {
			if (!this.tools.has(WEB_SEARCH_TOOL.name)) this.register(WEB_SEARCH_TOOL);
			if (!this.tools.has(READ_URL_TOOL.name)) this.register(READ_URL_TOOL);
		} else {
			this.unregister(WEB_SEARCH_TOOL.name);
			this.unregister(READ_URL_TOOL.name);
		}
	}

	/**
	 * Hot-reload the command tool (run_command) without rebuilding the rest
	 * of the registry — same pattern as setWebToolsEnabled, called from the
	 * Settings → Terminal toggle. Execution itself is desktop-only and
	 * confirmation-gated in callAgentLoop; this only controls advertising.
	 */
	setCommandToolsEnabled(enabled: boolean): void {
		if (enabled) {
			if (!this.tools.has(RUN_COMMAND_TOOL.name)) this.register(RUN_COMMAND_TOOL);
		} else {
			this.unregister(RUN_COMMAND_TOOL.name);
		}
	}

	/**
	 * Replace the MCP tool slice of the registry (tools from user-configured
	 * MCP servers, namespaced mcp__*). Idempotent: clears the previous MCP
	 * set first so removed servers/tools disappear. The manager calls this
	 * whenever connection state changes.
	 */
	setMcpTools(defs: ToolDefinition[]): void {
		for (const name of this.mcpToolNames) this.tools.delete(name);
		this.mcpToolNames.clear();
		for (const def of defs) {
			this.tools.set(def.name, def);
			this.mcpToolNames.add(def.name);
		}
	}

	/**
	 * Replace the GCP connector tool slice (gcp__storage__*, read-only Cloud
	 * Storage from the user's GCP project). Idempotent, same contract as
	 * setMcpTools — the GcpManager calls this whenever connection state
	 * changes.
	 */
	setGcpTools(defs: ToolDefinition[]): void {
		for (const name of this.gcpToolNames) this.tools.delete(name);
		this.gcpToolNames.clear();
		for (const def of defs) {
			this.tools.set(def.name, def);
			this.gcpToolNames.add(def.name);
		}
	}

	/**
	 * Hot-reload the semantic_search tool (Settings → Vault retrieval) without
	 * rebuilding the rest of the registry — same pattern as setWebToolsEnabled
	 * so the toggle takes effect on the next agent send.
	 */
	setRagToolEnabled(enabled: boolean): void {
		if (enabled && this.ragIndex) {
			if (!this.tools.has(SEMANTIC_SEARCH_TOOL_NAME)) {
				this.register(this.buildSemanticSearchTool());
			}
		} else {
			this.unregister(SEMANTIC_SEARCH_TOOL_NAME);
		}
	}

	private buildSemanticSearchTool(): ToolDefinition {
		const ragIndex = this.ragIndex as RagIndexManager;
		return {
			name: SEMANTIC_SEARCH_TOOL_NAME,
			description:
				'Semantic search over the user\'s vault notes (embedding-based). Returns the most relevant note ' +
				'excerpts for a natural-language query. Prefer this over search_notes when the query is ' +
				'conceptual or meaning-based rather than an exact keyword or filename.',
			parameters: {
				query: { type: 'string', description: 'Natural-language search query', required: true },
				max_results: { type: 'number', description: 'Maximum number of excerpts to return (default: 5)', default: 5 },
			},
			execute: async (params) => {
				const results = await ragIndex.search(str(params.query), num(params.max_results) || 5);
				if (results.length === 0) {
					return 'No semantic matches. If the vault index has never been built, the user can build it in Settings → Vault retrieval → Rebuild index.';
				}
				return results
					.map((r) => `[Excerpt: ${r.chunk.filePath}]\n${r.chunk.content.trim()}`)
					.join('\n\n---\n\n');
			},
		};
	}

	getTool(name: string): ToolDefinition | undefined {
		return this.tools.get(name);
	}

	getAllTools(): ToolDefinition[] {
		return Array.from(this.tools.values());
	}

	/**
	 * Execute a tool call and return the result.
	 */
	async executeTool(call: ToolCall, conversationId?: string, opts?: ExecuteToolOpts): Promise<ToolResult> {
		const tool = this.tools.get(call.name);
		if (!tool) {
			return {
				tool_call_id: call.id,
				content: `Unknown tool: ${call.name}`,
				is_error: true,
			};
		}

		try {
			// Validate required parameters. MCP tools (inputSchema set) are
			// exempt — their schemas aren't flat and the MCP server validates
			// its own arguments, surfacing failures as isError results.
			if (!tool.inputSchema) {
				const params = tool.parameters;
				for (const key of Object.keys(params)) {
					const param: ToolParameter = params[key];
					if (!param.required) continue;
					const value: unknown = call.arguments[key];
					if (value === undefined) {
						return {
							tool_call_id: call.id,
							content: `Missing required parameter: ${key}`,
							is_error: true,
						};
					}
					// Type-check against the declared type — coercing garbage to
					// '' or 0 would silently corrupt the tool's behavior.
					if (typeof value !== param.type) {
						return {
							tool_call_id: call.id,
							content: `Invalid type for parameter "${key}": expected ${param.type}, got ${typeof value}`,
							is_error: true,
						};
					}
				}
			}

			const result = await tool.execute(call.arguments, {
				app: this.app,
				conversationId,
				signal: opts?.signal,
				plugin: opts?.plugin,
				providerId: opts?.providerId,
				modelId: opts?.modelId,
			});

			return {
				tool_call_id: call.id,
				content: result,
			};
		} catch (error: unknown) {
			return {
				tool_call_id: call.id,
				content: `Tool error: ${error instanceof Error ? error.message : String(error)}`,
				is_error: true,
			};
		}
	}

	private registerBuiltinTools(): void {
		this.register({
			name: 'read_note',
			description: 'Read the content of a specific note in the vault. Use this to retrieve information from existing notes.',
			parameters: {
				path: { type: 'string', description: 'The file path of the note (e.g., "folder/note.md")', required: true },
			},
			execute: async (params) => {
				const path = str(params.path);
				const file = this.app.vault.getAbstractFileByPath(path);
				if (!(file instanceof TFile)) return `Note not found: ${path}`;
				return await this.app.vault.read(file);
			},
		});

		this.register({
			name: 'search_notes',
			description: 'Search for notes in the vault by filename or content. Returns a list of matching notes.',
			parameters: {
				query: { type: 'string', description: 'Search query to match against note filenames and content', required: true },
				max_results: { type: 'number', description: 'Maximum number of results (default: 10)', default: 10 },
			},
			execute: async (params) => {
				const query = str(params.query).toLowerCase();
				const max = num(params.max_results) || 10;
				const files = this.app.vault.getMarkdownFiles();
				const results: string[] = [];

				for (const file of files) {
					if (file.path.toLowerCase().includes(query) || file.basename.toLowerCase().includes(query)) {
						const cache = this.app.metadataCache.getFileCache(file);
						const fm: unknown = cache?.frontmatter;
						const tags: string[] = isRecord(fm) ? asStringArray(fm.tags) : [];
						results.push(`- **${file.basename}** (${file.path}) [${tags.length ? '#' + tags.join(' #') : 'no tags'}]`);
						if (results.length >= max) break;
					}
				}

				if (results.length === 0) {
					// Content fallback used to read EVERY vault file per miss —
					// cap the scan (newest 300 files, ~2MB read) so a large vault
					// can't stall the agent loop.
					const MAX_SCAN_FILES = 300;
					const MAX_SCAN_CHARS = 2_000_000;
					const scanList = [...files]
						.sort((a, b) => b.stat.mtime - a.stat.mtime)
						.slice(0, MAX_SCAN_FILES);
					let capHit = scanList.length < files.length;
					const contentMatches: string[] = [];
					let scannedChars = 0;

					for (const file of scanList) {
						if (results.length + contentMatches.length >= max) break;
						if (scannedChars >= MAX_SCAN_CHARS) {
							capHit = true;
							break;
						}
						try {
							const content = await this.app.vault.read(file);
							scannedChars += content.length;
							if (content.toLowerCase().includes(query)) {
								contentMatches.push(`- **${file.basename}** (${file.path}) [content match]`);
							}
						} catch { /* skip unreadable files */ }
					}

					const capNote = capHit
						? ` (content scan capped at the ${MAX_SCAN_FILES} most recently modified files / ~2 MB)`
						: '';

					if (contentMatches.length > 0) {
						return `No filename matches. Content matches${capNote}:\n${contentMatches.join('\n')}`;
					}

					return `No notes found matching "${query}"${capNote}`;
				}

				return `Found ${results.length} notes:\n${results.join('\n')}`;
			},
		});

		this.register({
			name: 'create_note',
			description: 'Create a new note in the vault with the given title and content.',
			parameters: {
				title: { type: 'string', description: 'The title/filename for the new note', required: true },
				content: { type: 'string', description: 'The markdown content for the note', default: '' },
				folder: { type: 'string', description: 'Folder to create the note in (default: vault root)', default: '/' },
			},
			execute: async (params) => {
				const title = str(params.title);
				const content = str(params.content);
				const folder = str(params.folder) || '/';
				const path = folder === '/' ? `${title}.md` : `${folder}/${title}.md`;

				// Ensure folder exists
				try {
					await this.app.vault.createFolder(folder);
				} catch { /* folder may already exist */ }

				const file = await this.app.vault.create(path, content);
				return `Created note: ${file.path}`;
			},
		});

		this.register({
			name: 'edit_note',
			description: 'Append content to or replace content in an existing note.',
			parameters: {
				path: { type: 'string', description: 'File path of the note to edit', required: true },
				action: { type: 'string', description: 'Action to perform', required: true, enum: ['append', 'prepend', 'replace'] },
				content: { type: 'string', description: 'Content to insert', required: true },
				old_content: { type: 'string', description: 'For replace action: the text to find and replace' },
			},
			execute: async (params) => {
				const path = str(params.path);
				const action = str(params.action);
				const content = str(params.content);
				const oldContent = str(params.old_content);

				const file = this.app.vault.getAbstractFileByPath(path);
				if (!(file instanceof TFile)) return `Note not found: ${path}`;

				const existing = await this.app.vault.read(file);
				let newContent: string;

				switch (action) {
					case 'append':
						newContent = existing + '\n\n' + content;
						break;
					case 'prepend':
						newContent = content + '\n\n' + existing;
						break;
					case 'replace':
						if (oldContent) {
							if (!existing.includes(oldContent)) {
								// Reporting success on a no-op replace would let the
								// model believe an edit landed that didn't.
								throw new Error(`old_content not found in ${path} — nothing was changed. Re-read the note and quote the exact text.`);
							}
							// Function replacer: model-supplied text may contain
							// $&/$`/$' patterns String.replace would interpret.
							newContent = existing.replace(oldContent, () => content);
						} else {
							newContent = content;
						}
						break;
					default:
						return `Unknown action: ${action}`;
				}

				await this.app.vault.modify(file, newContent);
				return `Note updated: ${path} (${action})`;
			},
		});

		this.register({
			name: 'list_notes',
			description: 'List notes in a specific folder or the entire vault.',
			parameters: {
				folder: { type: 'string', description: 'Folder path to list notes from (default: all)', default: '/' },
				max_results: { type: 'number', description: 'Maximum notes to list (default: 20)', default: 20 },
			},
			execute: async (params) => {
				const folder = str(params.folder) || '/';
				const max = num(params.max_results) || 20;
				const files = this.app.vault.getMarkdownFiles()
					.filter(f => folder === '/' || f.path.startsWith(folder.endsWith('/') ? folder : folder + '/'))
					.slice(0, max);

				if (files.length === 0) return `No notes found in "${folder}"`;

				return files.map(f => {
					const cache = this.app.metadataCache.getFileCache(f);
					const fm: unknown = cache?.frontmatter;
					const tags: string[] = isRecord(fm) ? asStringArray(fm.tags) : [];
					const mtime = new Date(f.stat.mtime).toLocaleDateString();
					return `- **${f.basename}** (${f.path}) [${mtime}]${tags.length ? ' #' + tags.join(' #') : ''}`;
				}).join('\n');
			},
		});

		this.register({
			name: 'get_tags',
			description: 'Get all tags used in the vault, sorted by frequency.',
			parameters: {},
			execute: async () => {
				const tags: Record<string, number> = {};
				for (const file of this.app.vault.getMarkdownFiles()) {
					const cache = this.app.metadataCache.getFileCache(file);
					const fileTags: string[] = cache?.tags?.map(t => t.tag.replace('#', '')) || [];
					const fm: unknown = cache?.frontmatter;
					const fmTags: string[] = isRecord(fm) ? asStringArray(fm.tags) : [];
					const all = [...fileTags, ...fmTags].filter(Boolean);
					for (const tag of all) {
						tags[tag] = (tags[tag] || 0) + 1;
					}
				}
				return Object.keys(tags)
					.map((tag): [string, number] => [tag, tags[tag]])
					.sort((a, b) => b[1] - a[1])
					.slice(0, 50)
					.map(([tag, count]) => `- #${tag} (${count})`)
					.join('\n') || 'No tags found in vault.';
			},
		});

		this.register({
			name: 'get_backlinks',
			description: 'Get all notes that link to a given note.',
			parameters: {
				path: { type: 'string', description: 'File path of the note', required: true },
			},
			execute: async (params) => {
				const path = str(params.path);
				const file = this.app.vault.getAbstractFileByPath(path);
				if (!(file instanceof TFile)) return `Note not found: ${path}`;

					const backlinks: string[] = [];
					const links: Record<string, Record<string, number>> = this.app.metadataCache.resolvedLinks || {};
					for (const sourcePath of Object.keys(links)) {
						const destMap: Record<string, number> = links[sourcePath];
						if (file.path in destMap) {
							backlinks.push(sourcePath);
						}
					}
					const notes = backlinks.map(srcPath => {
						const linkedFile = this.app.vault.getAbstractFileByPath(srcPath);
						const name = linkedFile instanceof TFile ? linkedFile.basename : srcPath;
						return `- **${name}** (${srcPath})`;
					});

				return notes.length > 0
					? `Backlinks for ${path} (${notes.length}):\n${notes.join('\n')}`
					: `No backlinks found for ${path}`;
			},
		});

		this.register({
			name: 'get_current_note',
			description: 'Get the content and metadata of the note currently open in the editor.',
			parameters: {},
			execute: async () => {
				// Use the robust resolver — `workspace.getActiveFile()` returns
				// whatever has focus, which is the chat sidebar itself when the
				// user is mid-conversation. `getActiveNoteFile()` walks every
				// markdown leaf and picks the center-area one the user means.
				const activeFile = getActiveNoteFile(this.app);
				if (!activeFile) return 'No note is currently open in the editor.';

				const content = await this.app.vault.read(activeFile);
				const cache = this.app.metadataCache.getFileCache(activeFile);
				const frontmatter = (cache?.frontmatter ?? {}) as Record<string, unknown>;

				return `Current note: **${activeFile.basename}** (${activeFile.path})\n\nFrontmatter: ${JSON.stringify(frontmatter, null, 2)}\n\nContent:\n${content}`;
			},
		});

		this.register({
			name: 'get_current_date',
			description:
				'Get the current date, day of week, and time in the user\'s local timezone. ' +
				'Use whenever the user asks "what day is it", "today", "this week", or references dates relative to now. ' +
				'No arguments — just returns the current moment.',
			parameters: {},
			execute: async () => {
				const now = new Date();
				const dateStr = now.toLocaleDateString(undefined, {
					weekday: 'long',
					year: 'numeric',
					month: 'long',
					day: 'numeric',
				});
				const timeStr = now.toLocaleTimeString(undefined, {
					hour: '2-digit',
					minute: '2-digit',
					second: '2-digit',
				});
				const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
				return `Current date: ${dateStr}\nTime: ${timeStr} (${tz})\nISO: ${now.toISOString()}`;
			},
		});

		this.register({
			name: 'calculator',
			description:
				'Evaluate an arithmetic expression exactly (+, -, *, /, %, ^, parentheses, decimals). ' +
				'Use for any math instead of estimating.',
			parameters: {
				expression: {
					type: 'string',
					description: 'The arithmetic expression to evaluate, e.g. "(2.5 + 3) * 12 / 8"',
					required: true,
				},
			},
			execute: async (params) => formatCalcResult(evaluateExpression(str(params.expression))),
		});
	}
}

// ---------------------------------------------------------------------------
// Safe arithmetic evaluator (recursive descent, no eval)
// ---------------------------------------------------------------------------

type CalcToken = number | string;

function tokenizeExpression(input: string): CalcToken[] {
	const tokens: CalcToken[] = [];
	let i = 0;
	while (i < input.length) {
		const ch = input[i];
		if (/\s/.test(ch)) {
			i++;
			continue;
		}
		if ('+-*/%^()'.includes(ch)) {
			tokens.push(ch);
			i++;
			continue;
		}
		const numMatch = /^\d+(?:\.\d+)?/.exec(input.slice(i));
		if (numMatch) {
			tokens.push(Number(numMatch[0]));
			i += numMatch[0].length;
			continue;
		}
		throw new Error(`Invalid character in expression: "${ch}"`);
	}
	return tokens;
}

function evaluateExpression(input: string): number {
	const tokens = tokenizeExpression(input);
	let pos = 0;
	const peek = (): CalcToken | undefined => tokens[pos];
	const next = (): CalcToken | undefined => tokens[pos++];

	function parseExpression(): number {
		let value = parseTerm();
		while (peek() === '+' || peek() === '-') {
			const op = next();
			const rhs = parseTerm();
			value = op === '+' ? value + rhs : value - rhs;
		}
		return value;
	}

	function parseTerm(): number {
		let value = parseFactor();
		while (peek() === '*' || peek() === '/' || peek() === '%') {
			const op = next();
			const rhs = parseFactor();
			if (op === '*') value = value * rhs;
			else if (op === '/') value = value / rhs;
			else value = value % rhs;
		}
		return value;
	}

	function parseFactor(): number {
		const base = parseUnary();
		if (peek() === '^') {
			next();
			return Math.pow(base, parseFactor()); // right-associative
		}
		return base;
	}

	function parseUnary(): number {
		if (peek() === '-') {
			next();
			return -parseUnary();
		}
		return parsePrimary();
	}

	function parsePrimary(): number {
		const token = next();
		if (token === undefined) throw new Error('Unexpected end of expression');
		if (token === '(') {
			const value = parseExpression();
			if (next() !== ')') throw new Error('Missing closing parenthesis');
			return value;
		}
		const n = Number(token);
		if (!Number.isFinite(n)) throw new Error(`Unexpected token: ${token}`);
		return n;
	}

	const result = parseExpression();
	if (pos !== tokens.length) throw new Error(`Unexpected token: ${tokens[pos]}`);
	if (!Number.isFinite(result)) throw new Error('Result is not a finite number (division by zero?)');
	return result;
}

function formatCalcResult(n: number): string {
	return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(10)));
}
