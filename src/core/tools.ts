import { App, TFile, Notice } from 'obsidian';

// ============================================================================
// Tool/Function Calling Framework
// ============================================================================
//
// Tools are functions the AI can invoke during a conversation.
// Each tool has a JSON Schema definition and a handler.
//
// Built-in tools:
//   read_note    — Read the content of a vault note
//   search_notes — Search vault notes by name or content
//   create_note  — Create a new note in the vault
//   edit_note    — Append/replace content in a note
//   list_notes   — List notes in a folder
//   get_tags     — List all tags in the vault
//   get_backlinks — Get backlinks for a note
//   daily_note   — Read today's daily note
//   calculator   — Evaluate a math expression
//
// Future tools (easy to add):
//   web_search   — Search the web
//   read_url     — Fetch and read a URL
//   manage_tasks — Create/complete tasks
//   query_memory — Query cross-session memory
//   query_rag    — Semantic search vault
// ============================================================================

export interface ToolDefinition {
	name: string;
	description: string;
	parameters: Record<string, ToolParameter>;
	execute: (params: Record<string, any>, context: ToolContext) => Promise<string>;
}

export interface ToolParameter {
	type: 'string' | 'number' | 'boolean';
	description: string;
	required?: boolean;
	enum?: string[];
	default?: any;
}

export interface ToolContext {
	app: App;
	conversationId?: string;
}

export interface ToolCall {
	id: string;
	name: string;
	arguments: Record<string, any>;
}

export interface ToolResult {
	tool_call_id: string;
	content: string;
	is_error?: boolean;
}

export class ToolRegistry {
	private tools: Map<string, ToolDefinition> = new Map();
	private app: App;

	constructor(app: App) {
		this.app = app;
		this.registerBuiltinTools();
	}

	register(tool: ToolDefinition): () => void {
		this.tools.set(tool.name, tool);
		return () => this.tools.delete(tool.name);
	}

	unregister(name: string): void {
		this.tools.delete(name);
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
	async executeTool(call: ToolCall, conversationId?: string): Promise<ToolResult> {
		const tool = this.tools.get(call.name);
		if (!tool) {
			return {
				tool_call_id: call.id,
				content: `Unknown tool: ${call.name}`,
				is_error: true,
			};
		}

		try {
			// Validate required parameters
			for (const [key, param] of Object.entries(tool.parameters)) {
				if (param.required && call.arguments[key] === undefined) {
					return {
						tool_call_id: call.id,
						content: `Missing required parameter: ${key}`,
						is_error: true,
					};
				}
			}

			const result = await tool.execute(call.arguments, {
				app: this.app,
				conversationId,
			});

			return {
				tool_call_id: call.id,
				content: result,
			};
		} catch (error: any) {
			return {
				tool_call_id: call.id,
				content: `Tool error: ${error.message}`,
				is_error: true,
			};
		}
	}

	/**
	 * Get all tool definitions in OpenAI function calling format.
	 */
	getOpenAITools(): Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, any> } }> {
		return this.getAllTools().map(tool => ({
			type: 'function',
			function: {
				name: tool.name,
				description: tool.description,
				parameters: {
					type: 'object',
					properties: Object.fromEntries(
						Object.entries(tool.parameters).map(([key, param]) => [key, {
							type: param.type,
							description: param.description,
							...param.enum ? { enum: param.enum } : {},
							...param.default !== undefined ? { default: param.default } : {},
						}])
					),
					required: Object.entries(tool.parameters)
						.filter(([, p]) => p.required)
						.map(([k]) => k),
				},
			},
		}));
	}

	private registerBuiltinTools(): void {
		this.register({
			name: 'read_note',
			description: 'Read the content of a specific note in the vault. Use this to retrieve information from existing notes.',
			parameters: {
				path: { type: 'string', description: 'The file path of the note (e.g., "folder/note.md")', required: true },
			},
			execute: async (params) => {
				const file = this.app.vault.getAbstractFileByPath(params.path);
				if (!(file instanceof TFile)) return `Note not found: ${params.path}`;
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
				const query = params.query.toLowerCase();
				const max = params.max_results || 10;
				const files = this.app.vault.getMarkdownFiles();
				const results: string[] = [];

				for (const file of files) {
					if (file.path.toLowerCase().includes(query) || file.basename.toLowerCase().includes(query)) {
						const cache = this.app.metadataCache.getFileCache(file);
						const tags = cache?.frontmatter?.tags || [];
						const wordCount = cache?.frontmatter?.wordcount || 0;
						results.push(`- **${file.basename}** (${file.path}) [${tags.length ? '#' + tags.join(' #') : 'no tags'}]`);
						if (results.length >= max) break;
					}
				}

				if (results.length === 0) {
					// Try content search via Obsidian search
					const contentMatches: string[] = [];
					for (const file of files) {
						if (results.length + contentMatches.length >= max) break;
						try {
							const content = await this.app.vault.read(file);
							if (content.toLowerCase().includes(query)) {
								contentMatches.push(`- **${file.basename}** (${file.path}) [content match]`);
							}
						} catch { /* skip unreadable files */ }
					}

					if (contentMatches.length > 0) {
						return `No filename matches. Content matches:\n${contentMatches.join('\n')}`;
					}

					return `No notes found matching "${params.query}"`;
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
				const folder = params.folder || '/';
				const path = folder === '/' ? `${params.title}.md` : `${folder}/${params.title}.md`;

				// Ensure folder exists
				try {
					await this.app.vault.createFolder(folder);
				} catch { /* folder may already exist */ }

				const file = await this.app.vault.create(path, params.content || '');
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
				const file = this.app.vault.getAbstractFileByPath(params.path);
				if (!(file instanceof TFile)) return `Note not found: ${params.path}`;

				const existing = await this.app.vault.read(file);
				let newContent: string;

				switch (params.action) {
					case 'append':
						newContent = existing + '\n\n' + params.content;
						break;
					case 'prepend':
						newContent = params.content + '\n\n' + existing;
						break;
					case 'replace':
						if (params.old_content) {
							newContent = existing.replace(params.old_content, params.content);
						} else {
							newContent = params.content;
						}
						break;
					default:
						return `Unknown action: ${params.action}`;
				}

				await this.app.vault.modify(file, newContent);
				return `Note updated: ${params.path} (${params.action})`;
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
				const folder = params.folder || '/';
				const max = params.max_results || 20;
				const files = this.app.vault.getMarkdownFiles()
					.filter(f => folder === '/' || f.path.startsWith(folder))
					.slice(0, max);

				if (files.length === 0) return `No notes found in "${folder}"`;

				return files.map(f => {
					const cache = this.app.metadataCache.getFileCache(f);
					const tags = cache?.frontmatter?.tags || [];
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
					const fileTags = cache?.tags?.map(t => t.tag.replace('#', '')) || [];
					const fmTags = cache?.frontmatter?.tags || [];
					const all = [...fileTags, ...fmTags].filter(Boolean);
					for (const tag of all) {
						tags[tag] = (tags[tag] || 0) + 1;
					}
				}
				return Object.entries(tags)
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
				const file = this.app.vault.getAbstractFileByPath(params.path);
				if (!(file instanceof TFile)) return `Note not found: ${params.path}`;

					const backlinks: string[] = [];
					for (const [sourcePath, destMap] of Object.entries(this.app.metadataCache.resolvedLinks || {})) {
						if (file.path in destMap) {
							backlinks.push(sourcePath);
						}
					}
					const notes = backlinks.map(path => {
						const linkedFile = this.app.vault.getAbstractFileByPath(path);
						const name = linkedFile instanceof TFile ? linkedFile.basename : path;
						return `- **${name}** (${path})`;
					});

				return notes.length > 0
					? `Backlinks for ${params.path} (${notes.length}):\n${notes.join('\n')}`
					: `No backlinks found for ${params.path}`;
			},
		});

		this.register({
			name: 'get_current_note',
			description: 'Get the content and metadata of the note currently open in the editor.',
			parameters: {},
			execute: async () => {
				const activeFile = this.app.workspace.getActiveFile();
				if (!activeFile) return 'No note is currently open.';

				const content = await this.app.vault.read(activeFile);
				const cache = this.app.metadataCache.getFileCache(activeFile);
				const frontmatter = cache?.frontmatter || {};

				return `Current note: **${activeFile.basename}** (${activeFile.path})\n\nFrontmatter: ${JSON.stringify(frontmatter, null, 2)}\n\nContent:\n${content}`;
			},
		});
	}
}
