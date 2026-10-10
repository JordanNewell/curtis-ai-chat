// MCP server mode — the vault tool catalog.
//
// The tools external AI clients get when they connect to Curtis: list,
// read, search (text + semantic), memory, and opt-in writing. Nothing here
// imports Obsidian — vault access goes through VaultToolPort, an adapter
// the plugin builds over app.vault / RAG / memory. That keeps every handler
// testable under node and makes the security boundary explicit: a tool can
// only reach what its port exposes, and every path argument passes
// safeVaultPath before a port call.

import type { McpServerBackend, McpToolSpec } from './protocol';

// ---------------------------------------------------------------------------
// Path safety — the single gate every tool argument goes through.
// ---------------------------------------------------------------------------

/** Normalize a client-supplied vault path, or return null when it tries to
 *  leave the vault: absolute paths, Windows drive letters, and `..`
 *  segments are all rejected; backslashes and redundant dots are collapsed. */
export function safeVaultPath(input: string): string | null {
	const raw = input.trim().replace(/\\/g, '/');
	if (!raw) return null;
	if (raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) return null;
	const parts: string[] = [];
	for (const segment of raw.split('/')) {
		if (!segment || segment === '.') continue;
		if (segment === '..') return null;
		for (let i = 0; i < segment.length; i++) {
			if (segment.charCodeAt(i) < 0x20) return null;
		}
		parts.push(segment);
	}
	if (parts.length === 0) return null;
	return parts.join('/');
}

// ---------------------------------------------------------------------------
// Port — what the Obsidian side provides. Deliberately narrow.
// ---------------------------------------------------------------------------

export interface VaultFileEntry {
	path: string;
	mtime?: number;
}

export interface VaultSemanticHit {
	path: string;
	snippet: string;
	score: number;
}

export interface VaultToolPort {
	listFiles(): VaultFileEntry[];
	read(path: string): Promise<string | null>;
	write(path: string, content: string, mode: 'create' | 'overwrite' | 'append'):
		Promise<'created' | 'written' | 'appended' | 'exists'>;
	/** Absent (or returning []) when the RAG index is off/unavailable — the
	 *  semantic_search tool disappears with it rather than erroring. */
	semanticSearch?(query: string, topK: number): Promise<VaultSemanticHit[]>;
	memoryFacts?(): { content: string; category?: string; timestamp: number }[];
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

const LIST_TOOL: McpToolSpec = {
	name: 'list_notes',
	description:
		'List markdown notes in the vault, alphabetically. Optionally restrict to a folder ' +
		'(vault-relative, e.g. "Projects"). Use read_note for contents.',
	inputSchema: {
		type: 'object',
		properties: {
			folder: { type: 'string', description: 'Optional folder to list, vault-relative' },
			limit: { type: 'number', description: 'Max paths to return (default 200, cap 1000)' },
			offset: { type: 'number', description: 'Skip this many paths first (for paging)' },
		},
	},
};

const READ_TOOL: McpToolSpec = {
	name: 'read_note',
	description:
		'Read the full text of one note. Path is vault-relative, e.g. "Projects/spec.md". ' +
		'Output is capped — very large notes are truncated with a marker.',
	inputSchema: {
		type: 'object',
		properties: {
			path: { type: 'string', description: 'Vault-relative note path' },
			max_chars: { type: 'number', description: 'Cap on returned characters (default 20000)' },
		},
		required: ['path'],
	},
};

const SEARCH_TOOL: McpToolSpec = {
	name: 'search_notes',
	description:
		'Case-insensitive text search across the vault. Returns one line per hit: ' +
		'path:line with a trimmed excerpt. Ranks filename matches first, then hit count.',
	inputSchema: {
		type: 'object',
		properties: {
			query: { type: 'string', description: 'Text to search for' },
			limit: { type: 'number', description: 'Max notes with hits to return (default 20, cap 100)' },
		},
		required: ['query'],
	},
};

const SEMANTIC_TOOL: McpToolSpec = {
	name: 'semantic_search',
	description:
		'Meaning-based search over the vault\'s embedding index — finds notes by concept, ' +
		'not keywords. Returns paths with scored snippets. Unavailable when the user has ' +
		'the index off; fall back to search_notes.',
	inputSchema: {
		type: 'object',
		properties: {
			query: { type: 'string', description: 'What to look for, in natural language' },
			top_k: { type: 'number', description: 'Max results (default 8, cap 25)' },
		},
		required: ['query'],
	},
};

const MEMORY_TOOL: McpToolSpec = {
	name: 'get_memory',
	description:
		'The user\'s saved memory facts — durable preferences, project context, decisions ' +
		'that outlive any conversation. Cheap to call; worth checking before asking the ' +
		'user something they may have already told Curtis.',
	inputSchema: { type: 'object', properties: {} },
};

const WRITE_TOOL: McpToolSpec = {
	name: 'write_note',
	description:
		'Create, overwrite, or append to a note. Modes: "create" fails if the note exists; ' +
		'"overwrite" replaces the whole body; "append" adds to the end. Parent folders are ' +
		'created as needed. The user has explicitly allowed MCP writes.',
	inputSchema: {
		type: 'object',
		properties: {
			path: { type: 'string', description: 'Vault-relative note path' },
			content: { type: 'string', description: 'Full note content (create/overwrite) or text to append' },
			mode: { type: 'string', enum: ['create', 'overwrite', 'append'], description: 'Default: create' },
		},
		required: ['path', 'content'],
	},
};

// Limits for the scan-based tools — a big vault must not make one call
// unreadable (or one call read the whole vault).
const SEARCH_FILES_SCANNED = 2000;
const SEARCH_TOTAL_CHARS = 8_000_000;
const EXCERPT_MAX = 160;
const READ_MAX_CHARS_CAP = 200_000;
const RESULT_TEXT_CAP = 100_000;

/** Build the MCP backend over a vault port. Writes enter the catalog only
 *  when allowWrites is on — an unlisted tool is unreachable, which is the
 *  whole gate. */
export function createVaultBackend(port: VaultToolPort, opts: { allowWrites: boolean }): McpServerBackend {
	const tools: McpToolSpec[] = [LIST_TOOL, READ_TOOL, SEARCH_TOOL];
	if (port.semanticSearch) tools.push(SEMANTIC_TOOL);
	if (port.memoryFacts) tools.push(MEMORY_TOOL);
	if (opts.allowWrites) tools.push(WRITE_TOOL);

	return {
		listTools: () => tools,
		async callTool(name, args) {
			switch (name) {
				case 'list_notes':
					return listNotes(port, args);
				case 'read_note':
					return readNote(port, args);
				case 'search_notes':
					return searchNotes(port, args);
				case 'semantic_search':
					return semanticSearch(port, args);
				case 'get_memory':
					return getMemory(port);
				case 'write_note':
					return writeNote(port, args);
				default:
					// The dispatcher rejects unknown names before we get here.
					return textResult(`Unknown tool: ${name}`, true);
			}
		},
	};
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function listNotes(port: VaultToolPort, args: Record<string, unknown>): Promise<McpCallResultText> {
	const limit = clampInt(args.limit, 1, 1000, 200);
	const offset = Math.max(0, clampInt(args.offset, 0, Number.MAX_SAFE_INTEGER, 0));
	const folderRaw = typeof args.folder === 'string' ? args.folder : '';
	const folder = folderRaw ? safeVaultPath(folderRaw) : '';
	if (folderRaw && !folder) return textResult(`Invalid folder: ${folderRaw}`, true);

	const prefix = folder ? `${folder}/` : '';
	const all = port
		.listFiles()
		.map((f) => f.path)
		.filter((p) => p.startsWith(prefix))
		.sort();
	const page = all.slice(offset, offset + limit);
	if (page.length === 0) {
		return textResult(`No notes found${folder ? ` under ${folder}` : ''}${offset ? ` at offset ${offset}` : ''}.`);
	}
	const header = `${page.length} of ${all.length} notes${folder ? ` under ${folder}` : ''}${all.length > offset + page.length ? ' — more pages exist (use offset)' : ''}:`;
	return textResult([header, ...page].join('\n'));
}

async function readNote(port: VaultToolPort, args: Record<string, unknown>): Promise<McpCallResultText> {
	const path = safeVaultPath(stringArg(args.path));
	if (!path) return textResult('Invalid path — supply a vault-relative note path.', true);
	const maxChars = clampInt(args.max_chars, 200, READ_MAX_CHARS_CAP, 20_000);

	const content = await port.read(path);
	if (content === null) return textResult(`Note not found: ${path}`, true);
	if (content.length <= maxChars) return textResult(content);
	return textResult(`${content.slice(0, maxChars)}\n\n[Truncated at ${maxChars} of ${content.length} characters — raise max_chars or read in ranges via search_notes.]`);
}

interface SearchHit {
	path: string;
	lines: { line: number; text: string }[];
}

/** Scan the vault for a case-insensitive substring. Shared by the MCP
 *  search_notes tool and the plugin API (which wants the structured hits). */
export async function findTextHits(
	port: VaultToolPort,
	query: string,
	limit: number
): Promise<SearchHit[]> {
	const needle = query.toLowerCase();
	const hits: SearchHit[] = [];
	let charsRead = 0;
	const files = port.listFiles().sort((a, b) => a.path.localeCompare(b.path));
	for (const [index, file] of files.entries()) {
		if (hits.length >= limit || charsRead > SEARCH_TOTAL_CHARS || index >= SEARCH_FILES_SCANNED) break;
		const content = await port.read(file.path);
		if (content === null) continue;
		charsRead += content.length;
		const lines = content.split('\n');
		const matches: { line: number; text: string }[] = [];
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].toLowerCase().includes(needle)) {
				matches.push({ line: i + 1, text: excerpt(lines[i]) });
			}
		}
		if (matches.length > 0) hits.push({ path: file.path, lines: matches });
	}

	// Filename matches outrank content matches, then more hits outrank fewer.
	hits.sort((a, b) => {
		const aName = a.path.toLowerCase().includes(needle) ? 0 : 1;
		const bName = b.path.toLowerCase().includes(needle) ? 0 : 1;
		if (aName !== bName) return aName - bName;
		return b.lines.length - a.lines.length;
	});
	return hits;
}

async function searchNotes(port: VaultToolPort, args: Record<string, unknown>): Promise<McpCallResultText> {
	const query = stringArg(args.query).trim();
	if (!query) return textResult('Empty query.', true);
	const limit = clampInt(args.limit, 1, 100, 20);

	const hits = await findTextHits(port, query, limit);
	if (hits.length === 0) return textResult(`No notes contain "${query}".`);
	const body = hits.map((h) =>
		[h.path, ...h.lines.slice(0, 5).map((l) => `  ${l.line}: ${l.text}`)].join('\n')
	);
	return textResult(`${hits.length} note(s) match "${query}":\n\n${body.join('\n')}`);
}

async function semanticSearch(port: VaultToolPort, args: Record<string, unknown>): Promise<McpCallResultText> {
	if (!port.semanticSearch) return textResult('Semantic search is not available (the index is off or still loading).', true);
	const query = stringArg(args.query).trim();
	if (!query) return textResult('Empty query.', true);
	const topK = clampInt(args.top_k, 1, 25, 8);
	const hits = await port.semanticSearch(query, topK);
	if (hits.length === 0) return textResult(`No semantically similar notes for "${query}".`);
	const body = hits.map((h) => `${h.path} (score ${h.score.toFixed(3)})\n  ${excerpt(h.snippet.replace(/\n+/g, ' '))}`);
	return textResult(`${hits.length} result(s):\n\n${body.join('\n\n')}`);
}

async function getMemory(port: VaultToolPort): Promise<McpCallResultText> {
	const facts = port.memoryFacts?.() ?? [];
	if (facts.length === 0) return textResult('No memory facts saved.');
	const lines = facts.map((f) =>
		`- ${f.category ? `[${f.category}] ` : ''}${f.content}`
	);
	return textResult(`${facts.length} memory fact(s):\n${lines.join('\n')}`);
}

async function writeNote(port: VaultToolPort, args: Record<string, unknown>): Promise<McpCallResultText> {
	const path = safeVaultPath(stringArg(args.path));
	if (!path) return textResult('Invalid path — supply a vault-relative note path.', true);
	if (typeof args.content !== 'string') return textResult('write_note requires string content.', true);
	const mode = args.mode === undefined ? 'create' : args.mode;
	if (mode !== 'create' && mode !== 'overwrite' && mode !== 'append') {
		const shown = typeof mode === 'string' ? mode : JSON.stringify(mode);
		return textResult(`Invalid mode: ${shown} — use create, overwrite, or append.`, true);
	}

	const outcome = await port.write(path, args.content, mode);
	switch (outcome) {
		case 'created':
			return textResult(`Created ${path} (${args.content.length} chars).`);
		case 'written':
			return textResult(`Overwrote ${path} (${args.content.length} chars).`);
		case 'appended':
			return textResult(`Appended ${args.content.length} chars to ${path}.`);
		case 'exists':
			return textResult(`${path} already exists — use mode "overwrite" to replace it or "append" to add to it.`, true);
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type McpCallResultText = { content: { type: 'text'; text: string }[]; isError?: boolean };

function textResult(text: string, isError = false): McpCallResultText {
	const result: McpCallResultText = { content: [{ type: 'text', text: text.slice(0, RESULT_TEXT_CAP) }] };
	if (isError) result.isError = true;
	return result;
}

function stringArg(v: unknown): string {
	return typeof v === 'string' ? v : '';
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
	const n = typeof v === 'number' ? Math.floor(v) : Number.NaN;
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, n));
}

function excerpt(line: string): string {
	const trimmed = line.trim();
	return trimmed.length > EXCERPT_MAX ? `${trimmed.slice(0, EXCERPT_MAX)}…` : trimmed;
}
