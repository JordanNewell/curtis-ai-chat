// vshell — the vault shell: a curated POSIX-ish command set implemented over
// the Obsidian vault API instead of the OS. This is the terminal mobile can
// have: iOS forbids spawning processes outright, and Obsidian's mobile webview
// exposes no process bridge on Android either — but everything here runs
// against vault files, which needs no permissions on either platform.
//
// Deliberately Obsidian-free (only `import type` from runner.ts, which never
// reaches the runtime) so the whole command set runs under vitest. The
// Obsidian side of the Vfs port lives in vault-vfs.ts.
//
// v1 boundaries, on purpose: no pipes, no redirection, no globbing (find's
// -name and grep patterns cover the real ask), sed is substitution-print only.
// Everything destructive routes to trash, never hard-deletes. Output is capped
// at the same 8000 chars the desktop runner caps at, with the same truncation
// flags, so the pane and the agent tool render both shells identically.

import type { ShellRunResult } from './runner';

/** Mirrors runner.ts MAX_OUTPUT_CHARS — kept local so this module stays
 *  Obsidian-free and testable. */
const MAX_OUTPUT_CHARS = 8000;
/** Safety cap on recursive walks (grep/find) — a vault with 50k notes must
 *  not freeze the pane for minutes. */
const MAX_WALK_ENTRIES = 2000;

export interface VfsEntry {
	name: string;
	/** Vault-relative path ('' = vault root). */
	path: string;
	type: 'file' | 'folder';
	/** Bytes; 0 for folders. */
	size: number;
}

/** Minimal filesystem port. Implementations: the Obsidian adapter
 *  (vault-vfs.ts) and the in-memory fixture in vshell.test.ts. All paths are
 *  vault-relative with '/' separators; '' is the root. */
export interface Vfs {
	/** Children of a folder, arbitrary order (commands sort). */
	list(folderPath: string): Promise<VfsEntry[]>;
	/** 'file' | 'folder', or null when the path does not exist. */
	type(path: string): Promise<'file' | 'folder' | null>;
	read(filePath: string): Promise<string>;
	/** Create or overwrite. Parent folder must exist. */
	write(filePath: string, content: string): Promise<void>;
	/** Throws when the folder already exists. Creates parents. */
	createFolder(folderPath: string): Promise<void>;
	/** Rename/move a file or folder to a path that must not exist. */
	move(from: string, to: string): Promise<void>;
	/** Copy one file to a path that must not exist. */
	copyFile(from: string, to: string): Promise<void>;
	/** Move to trash — never a hard delete. */
	trash(targetPath: string): Promise<void>;
	exists(path: string): Promise<boolean>;
}

export interface VaultRunOptions {
	command: string;
	/** Vault-relative working directory ('' = vault root). */
	cwd?: string;
	timeoutMs?: number;
	signal?: AbortSignal;
}

/** Command failure with a POSIX-ish exit code. Thrown by commands; caught by
 *  runVaultCommand, never by callers. */
class CommandError extends Error {
	constructor(message: string, readonly code = 1) {
		super(message);
		this.name = 'CommandError';
	}
}

/** Internal: deadline/abort raced through every await in a command. An
 *  Error subtype so it satisfies only-throw-error; caught by instance before
 *  any generic Error handling, never by callers. */
class VaultShellInterrupt extends Error {
	constructor(readonly kind: 'timeout' | 'abort') {
		super(kind);
		this.name = 'VaultShellInterrupt';
	}
}

// ---------------------------------------------------------------------------
// Tokenizer — single/double quotes, no escapes beyond closing the quote.

/** Split a command line into words. Throws CommandError on an unterminated
 *  quote. */
export function tokenize(line: string): string[] {
	const tokens: string[] = [];
	let cur = '';
	let hasCur = false;
	let quote: '"' | "'" | null = null;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (quote) {
			if (ch === quote) quote = null;
			else cur += ch;
		} else if (ch === '"' || ch === "'") {
			quote = ch;
			hasCur = true; // '' is a real empty-word argument
		} else if (ch === ' ' || ch === '\t') {
			if (hasCur) {
				tokens.push(cur);
				cur = '';
				hasCur = false;
			}
		} else {
			cur += ch;
			hasCur = true;
		}
	}
	if (quote) throw new CommandError(`unterminated quote in command`, 2);
	if (hasCur) tokens.push(cur);
	return tokens;
}

// ---------------------------------------------------------------------------
// Paths — vault-relative, '/'-separated, '' is root. '..' past the root is an
// error, not a silent clamp: the vault IS the filesystem here.

/** Normalize a vault-relative path. Throws when '..' escapes the root. */
function normalize(p: string): string {
	const parts = p.split('/').filter((x) => x.length > 0 && x !== '.');
	const out: string[] = [];
	for (const part of parts) {
		if (part === '..') {
			if (out.length === 0) throw new CommandError('path escapes the vault root', 2);
			out.pop();
		} else {
			out.push(part);
		}
	}
	return out.join('/');
}

/** Resolve `input` against `cwd` (both vault-relative; leading '/' means
 *  absolute-from-root). Throws on root escape — callers that want leniency
 *  catch and keep their previous cwd. */
export function resolveVaultPath(cwd: string, input: string): string {
	if (!input || input === '.') return normalize(cwd);
	if (input.startsWith('/')) return normalize(input);
	return normalize(`${cwd ? cwd + '/' : ''}${input}`);
}

function basename(p: string): string {
	const parts = p.split('/');
	return parts[parts.length - 1] ?? p;
}

/** Shell-style pattern match ('*' any run, '?' one char) against a basename. */
function fnmatch(pattern: string, name: string): boolean {
	let re = '';
	for (const ch of pattern) {
		if (ch === '*') re += '.*';
		else if (ch === '?') re += '.';
		else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}
	return new RegExp(`^${re}$`).test(name);
}

/** RegExp that degrades to a literal match when the source is not valid
 *  regex — grep/sed meet real notes, not just valid patterns. */
function safeRegex(source: string, flags: string): RegExp {
	try {
		return new RegExp(source, flags);
	} catch {
		return new RegExp(source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
	}
}

function nameSort(a: VfsEntry, b: VfsEntry): number {
	return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}

/** Content lines with any trailing empty line dropped (a lone terminal
 *  newline is not a line). */
function splitLines(content: string): string[] {
	const lines = content.split('\n');
	if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
	return lines;
}

// ---------------------------------------------------------------------------
// Walk — the shared recursive descent under grep/find.

interface WalkOutcome {
	entries: VfsEntry[];
	/** True when MAX_WALK_ENTRIES cut the walk short. */
	capped: boolean;
}

async function walkTree(vfs: Vfs, start: string, check: () => Promise<void>): Promise<WalkOutcome> {
	const entries: VfsEntry[] = [];
	let capped = false;
	const descend = async (folder: string): Promise<void> => {
		await check();
		if (entries.length >= MAX_WALK_ENTRIES) {
			capped = true;
			return;
		}
		const children = (await vfs.list(folder)).sort(nameSort);
		for (const child of children) {
			if (entries.length >= MAX_WALK_ENTRIES) {
				capped = true;
				return;
			}
			entries.push(child);
			if (child.type === 'folder') await descend(child.path);
		}
	};
	await descend(start);
	return { entries, capped };
}

// ---------------------------------------------------------------------------
// Commands.

interface Ctx {
	vfs: Vfs;
	cwd: string;
	out: (text: string) => void;
	/** Line-oriented output — the common case; guarantees the newline. */
	outLine: (text: string) => void;
	err: (text: string) => void;
	check: () => Promise<void>;
}

type Command = (args: string[], ctx: Ctx) => Promise<number>;

const helpCmd: Command = async (_args, ctx) => {
	ctx.out([
		'vault shell — commands run against vault notes, not the OS',
		'pwd  ls [-l]  cat  head  tail  wc  grep [-i] [-n]  find [-name] [-type]',
		'sed s/old/new/[g]  sort [-r] [-n]  uniq [-c]  echo',
		'mkdir [-p]  touch  cp  mv  rm [-r]',
		'',
		'grep recurses into folders; find walks from its path. rm moves to',
		'trash. No pipes, redirection, or command chaining.',
	].join('\n'));
	return 0;
};

const pwdCmd: Command = async (_args, ctx) => {
	ctx.outLine(`/${ctx.cwd}`);
	return 0;
};

const echoCmd: Command = async (args, ctx) => {
	ctx.outLine(args.join(' '));
	return 0;
};

const lsCmd: Command = async (args, ctx) => {
	let long = false;
	const paths: string[] = [];
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '-l') long = true;
		else if (args[i] === '-a') { /* folders only vault — dotfiles moot */ }
		else paths.push(args[i]);
	}
	if (paths.length === 0) paths.push('.');
	const multiple = paths.length > 1;
	let exit = 0;
	for (const p of paths) {
		await ctx.check();
		const abs = resolveVaultPath(ctx.cwd, p);
		const type = await ctx.vfs.type(abs);
		try {
			if (type === 'file') {
				const parent = abs.includes('/') ? abs.slice(0, abs.lastIndexOf('/')) : '';
				const entry = (await ctx.vfs.list(parent)).find((e) => e.path === abs);
				if (!entry) throw new CommandError(`no such file: ${p}`);
				ctx.outLine(multiple ? `${p}:\n${entry.name}` : entry.name);
				continue;
			}
			if (type !== 'folder') throw new CommandError(`no such directory: ${p}`);
			const children = (await ctx.vfs.list(abs)).sort(nameSort);
			if (multiple) ctx.outLine(`${p}:`);
			for (const c of children) {
				if (long) {
					const size = c.type === 'folder' ? '-' : String(c.size);
					ctx.outLine(`${c.type === 'folder' ? 'd' : '-'} ${size.padStart(8)}  ${c.name}${c.type === 'folder' ? '/' : ''}`);
				} else {
					ctx.outLine(`${c.name}${c.type === 'folder' ? '/' : ''}`);
				}
			}
		} catch (e) {
			if (e instanceof CommandError) {
				ctx.err(`ls: ${e.message}`);
				exit = 1;
			} else throw e;
		}
	}
	return exit;
};

async function readFiles(ctx: Ctx, paths: string[], cmdName: string): Promise<{ path: string; content: string }[]> {
	const files: { path: string; content: string }[] = [];
	for (const p of paths) {
		await ctx.check();
		const abs = resolveVaultPath(ctx.cwd, p);
		const type = await ctx.vfs.type(abs);
		if (type !== 'file') throw new CommandError(`${cmdName}: no such file: ${p}`);
		files.push({ path: abs, content: await ctx.vfs.read(abs) });
	}
	return files;
}

const catCmd: Command = async (args, ctx) => {
	if (args.length === 0) throw new CommandError('cat: a file is required', 2);
	const files = await readFiles(ctx, args, 'cat');
	for (const f of files) ctx.out(f.content.endsWith('\n') || f.content === '' ? f.content : f.content + '\n');
	return 0;
};

async function headTail(args: string[], ctx: Ctx, fromEnd: boolean): Promise<number> {
	let count = 10;
	const paths: string[] = [];
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '-n') {
			const raw = args[++i];
			const n = Number(raw);
			if (raw === undefined || !Number.isInteger(n) || n < 0) throw new CommandError(`invalid line count: ${raw ?? '(missing)'}`, 2);
			count = n;
		} else if (args[i]?.startsWith('-') && /^-\d+$/.test(args[i])) {
			count = Number(args[i].slice(1));
		} else {
			paths.push(args[i]);
		}
	}
	if (paths.length !== 1) throw new CommandError(fromEnd ? 'tail: exactly one file' : 'head: exactly one file', 2);
	const [file] = await readFiles(ctx, paths, fromEnd ? 'tail' : 'head');
	const lines = splitLines(file.content);
	const picked = fromEnd ? lines.slice(Math.max(0, lines.length - count)) : lines.slice(0, count);
	if (picked.length > 0) ctx.out(picked.join('\n') + '\n');
	return 0;
}

const headCmd: Command = async (args, ctx) => headTail(args, ctx, false);
const tailCmd: Command = async (args, ctx) => headTail(args, ctx, true);

const wcCmd: Command = async (args, ctx) => {
	let mode: 'lines' | 'words' | 'chars' | null = null;
	const paths: string[] = [];
	for (const a of args) {
		if (a === '-l' || a === '-w' || a === '-c') mode = a === '-l' ? 'lines' : a === '-w' ? 'words' : 'chars';
		else paths.push(a);
	}
	if (paths.length === 0) throw new CommandError('wc: a file is required', 2);
	const files = await readFiles(ctx, paths, 'wc');
	const totals = { lines: 0, words: 0, chars: 0 };
	for (const f of files) {
		const lines = (f.content.match(/\n/g) ?? []).length;
		const words = f.content.split(/\s+/).filter((w) => w.length > 0).length;
		const chars = f.content.length;
		totals.lines += lines;
		totals.words += words;
		totals.chars += chars;
		const label = mode === 'lines' ? String(lines) : mode === 'words' ? String(words) : mode === 'chars' ? String(chars)
			: `${String(lines).padStart(7)}${String(words).padStart(8)}${String(chars).padStart(8)}`;
		ctx.outLine(`${label} ${f.path}`);
	}
	if (files.length > 1 && mode === null) {
		ctx.outLine(`${String(totals.lines).padStart(7)}${String(totals.words).padStart(8)}${String(totals.chars).padStart(8)} total`);
	}
	return 0;
};

const grepCmd: Command = async (args, ctx) => {
	let ignoreCase = false;
	let showLineNumbers = false;
	let pattern = '';
	const paths: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === '-i') ignoreCase = true;
		else if (a === '-n') showLineNumbers = true;
		else if (a === '-r' || a === '-R' || a === '-e') { /* folders always recurse; -e implicit */ }
		else if (pattern === '' && paths.length === 0) pattern = a;
		else paths.push(a);
	}
	if (pattern === '') throw new CommandError('grep: a pattern is required', 2);
	if (paths.length === 0) paths.push('.');
	const re = safeRegex(pattern, ignoreCase ? 'i' : '');

	const targets: { path: string; display: string }[] = [];
	for (const p of paths) {
		await ctx.check();
		const abs = resolveVaultPath(ctx.cwd, p);
		const type = await ctx.vfs.type(abs);
		if (type === 'file') targets.push({ path: abs, display: p });
		else if (type === 'folder') {
			const walk = await walkTree(ctx.vfs, abs, ctx.check);
			if (walk.capped) ctx.err(`grep: walk capped at ${MAX_WALK_ENTRIES} entries — results may be incomplete`);
			for (const e of walk.entries) {
				if (e.type === 'file') targets.push({ path: e.path, display: e.path });
			}
		} else {
			throw new CommandError(`grep: no such file or directory: ${p}`);
		}
	}

	let matches = 0;
	// Path prefixes once more than one file is in play — ripgrep behavior.
	const prefixPaths = targets.length > 1;
	for (const t of targets) {
		await ctx.check();
		const content = await ctx.vfs.read(t.path);
		const lines = splitLines(content);
		for (let i = 0; i < lines.length; i++) {
			if (re.test(lines[i])) {
				matches++;
				const loc = prefixPaths ? `${t.display}:` : '';
				const num = showLineNumbers ? `${i + 1}:` : '';
				ctx.outLine(`${loc}${num}${lines[i]}`);
			}
		}
	}
	return matches > 0 ? 0 : 1;
};

const findCmd: Command = async (args, ctx) => {
	let start = '.';
	let namePattern: string | null = null;
	let typeFilter: 'file' | 'folder' | null = null;
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === '-name') {
			namePattern = args[++i];
			if (namePattern === undefined) throw new CommandError('find: -name needs a pattern', 2);
		} else if (a === '-type') {
			const t = args[++i];
			if (t !== 'f' && t !== 'd') throw new CommandError('find: -type is f or d', 2);
			typeFilter = t === 'f' ? 'file' : 'folder';
		} else if (a.startsWith('-')) {
			throw new CommandError(`find: unsupported option ${a}`, 2);
		} else {
			start = a;
		}
	}
	const abs = resolveVaultPath(ctx.cwd, start);
	if ((await ctx.vfs.type(abs)) !== 'folder') throw new CommandError(`find: no such directory: ${start}`);
	const walk = await walkTree(ctx.vfs, abs, ctx.check);
	if (walk.capped) ctx.err(`find: walk capped at ${MAX_WALK_ENTRIES} entries — results may be incomplete`);
	const matches = walk.entries.filter((e) =>
		(!typeFilter || e.type === typeFilter)
		&& (!namePattern || fnmatch(namePattern, e.name)));
	ctx.outLine(`/${abs}`);
	for (const m of matches) ctx.outLine(`/${m.path}`);
	return 0;
};

interface SedScript {
	re: RegExp;
	replacement: string;
}

/** Parse `s/old/new/[gi]` (any non-alphanumeric delimiter). Null when the
 *  argument is not a substitution script — v1's only sed form. */
function parseSedScript(script: string): SedScript | null {
	if (script.length < 4 || script[0] !== 's') return null;
	const delim = script[1];
	if (!delim || /[a-zA-Z0-9\s]/.test(delim)) return null;
	const parts: string[] = [];
	let cur = '';
	const body = script.slice(2);
	for (let i = 0; i < body.length; i++) {
		const ch = body[i];
		if (ch === '\\' && i + 1 < body.length) {
			const next = body[i + 1];
			// An escaped delimiter unescapes; anything else passes through
			// (including \1 group refs, converted to $1 below).
			cur += next === delim ? '' : ch + next;
			i++;
		} else if (ch === delim) {
			parts.push(cur);
			cur = '';
		} else {
			cur += ch;
		}
	}
	parts.push(cur);
	if (parts.length < 2 || parts.length > 3) return null;
	const flags = parts[2] ?? '';
	let global = false;
	let reFlags = '';
	for (const f of flags) {
		if (f === 'g') global = true;
		else if (f === 'i') reFlags += 'i';
		else if (f !== '') return null;
	}
	// sed groups are \1; JS replacement templates are $1.
	const replacement = parts[1].replace(/\\(\d)/g, '$$$1');
	return {
		// The g flag rides the regex itself — String.replace only replaces
		// every occurrence through a /g regex.
		re: safeRegex(parts[0], reFlags + (global ? 'g' : '')),
		replacement,
	};
}

const sedCmd: Command = async (args, ctx) => {
	if (args.length < 2) throw new CommandError('sed: s/old/new/[g] and one file (print-only, no -i)', 2);
	const script = parseSedScript(args[0]);
	if (!script) throw new CommandError(`sed: unsupported script "${args[0]}" — v1 is s/old/new/[gi], print-only`, 2);
	const [file] = await readFiles(ctx, args.slice(1), 'sed');
	const lines = splitLines(file.content);
	const out = lines.map((line) => line.replace(script.re, script.replacement));
	if (out.length > 0) ctx.out(out.join('\n') + '\n');
	return 0;
};

const sortCmd: Command = async (args, ctx) => {
	let reverse = false;
	let numeric = false;
	const paths: string[] = [];
	for (const a of args) {
		if (a === '-r') reverse = true;
		else if (a === '-n') numeric = true;
		else paths.push(a);
	}
	if (paths.length !== 1) throw new CommandError('sort: exactly one file', 2);
	const [file] = await readFiles(ctx, paths, 'sort');
	let lines = splitLines(file.content);
	const compare = (a: string, b: string): number => {
		if (numeric) {
			const na = Number((/^-?\d+(?:\.\d+)?/.exec(a) ?? ['0'])[0]);
			const nb = Number((/^-?\d+(?:\.\d+)?/.exec(b) ?? ['0'])[0]);
			return na - nb || a.localeCompare(b, undefined, { numeric: true });
		}
		return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
	};
	lines = lines.slice().sort(compare);
	if (reverse) lines.reverse();
	if (lines.length > 0) ctx.out(lines.join('\n') + '\n');
	return 0;
};

const uniqCmd: Command = async (args, ctx) => {
	let count = false;
	const paths: string[] = [];
	for (const a of args) {
		if (a === '-c') count = true;
		else paths.push(a);
	}
	if (paths.length !== 1) throw new CommandError('uniq: exactly one file', 2);
	const [file] = await readFiles(ctx, paths, 'uniq');
	// Adjacent-equal runs, like POSIX uniq (pipe uniq through sort yourself —
	// there are no pipes, so sort first in a separate command).
	const runs: { line: string; n: number }[] = [];
	for (const line of splitLines(file.content)) {
		const last = runs[runs.length - 1];
		if (last && last.line === line) last.n++;
		else runs.push({ line, n: 1 });
	}
	const rendered = runs.map((r) => (count ? `${String(r.n).padStart(4)} ${r.line}` : r.line));
	if (rendered.length > 0) ctx.out(rendered.join('\n') + '\n');
	return 0;
};

const mkdirCmd: Command = async (args, ctx) => {
	let parents = false;
	const paths: string[] = [];
	for (const a of args) {
		if (a === '-p') parents = true;
		else paths.push(a);
	}
	if (paths.length === 0) throw new CommandError('mkdir: a path is required', 2);
	for (const p of paths) {
		await ctx.check();
		const abs = resolveVaultPath(ctx.cwd, p);
		if (!abs) throw new CommandError('mkdir: cannot create the vault root', 2);
		const existing = await ctx.vfs.type(abs);
		if (existing === 'folder') {
			if (!parents) throw new CommandError(`mkdir: already exists: ${p}`);
			continue;
		}
		if (existing === 'file') throw new CommandError(`mkdir: a file is in the way: ${p}`);
		if (!parents) {
			const parentPath = abs.includes('/') ? abs.slice(0, abs.lastIndexOf('/')) : '';
			if ((await ctx.vfs.type(parentPath)) !== 'folder') {
				throw new CommandError(`mkdir: parent folder missing: ${p} (use -p)`);
			}
		}
		await ctx.vfs.createFolder(abs);
	}
	return 0;
};

const touchCmd: Command = async (args, ctx) => {
	if (args.length === 0) throw new CommandError('touch: a file is required', 2);
	for (const p of args) {
		await ctx.check();
		const abs = resolveVaultPath(ctx.cwd, p);
		const type = await ctx.vfs.type(abs);
		if (type === 'folder') throw new CommandError(`touch: is a folder: ${p}`);
		if (type !== 'file') await ctx.vfs.write(abs, ''); // exists → no-op: vault mtime is not settable
	}
	return 0;
};

/** Resolve cp/mv destination POSIX-style: existing folder → into it, else the
 *  literal target path. */
async function resolveDest(ctx: Ctx, dest: string, srcName: string): Promise<string> {
	const abs = resolveVaultPath(ctx.cwd, dest);
	const type = await ctx.vfs.type(abs);
	if (type === 'folder') return abs ? `${abs}/${srcName}` : srcName;
	if (type === 'file') throw new CommandError(`destination exists: ${dest}`);
	return abs;
}

const cpCmd: Command = async (args, ctx) => {
	if (args.length !== 2) throw new CommandError('cp: <source file> <destination>', 2);
	const src = resolveVaultPath(ctx.cwd, args[0]);
	if ((await ctx.vfs.type(src)) !== 'file') throw new CommandError(`cp: no such file: ${args[0]}`);
	const dest = await resolveDest(ctx, args[1], basename(src));
	if (dest === src) throw new CommandError('cp: source and destination are the same');
	await ctx.vfs.copyFile(src, dest);
	return 0;
};

const mvCmd: Command = async (args, ctx) => {
	if (args.length !== 2) throw new CommandError('mv: <source> <destination>', 2);
	const src = resolveVaultPath(ctx.cwd, args[0]);
	const srcType = await ctx.vfs.type(src);
	if (!srcType) throw new CommandError(`mv: no such path: ${args[0]}`);
	const dest = await resolveDest(ctx, args[1], basename(src));
	if (dest === src) throw new CommandError('mv: source and destination are the same');
	if (dest.startsWith(src + '/')) throw new CommandError('mv: cannot move a folder into itself');
	await ctx.vfs.move(src, dest);
	return 0;
};

const rmCmd: Command = async (args, ctx) => {
	let recursive = false;
	const paths: string[] = [];
	for (const a of args) {
		if (a === '-r' || a === '-rf' || a === '-fr') recursive = true;
		else paths.push(a);
	}
	if (paths.length === 0) throw new CommandError('rm: a path is required', 2);
	for (const p of paths) {
		await ctx.check();
		const abs = resolveVaultPath(ctx.cwd, p);
		const type = await ctx.vfs.type(abs);
		if (!type) throw new CommandError(`rm: no such path: ${p}`);
		if (!abs) throw new CommandError('rm: refusing to remove the vault root');
		if (type === 'folder' && !recursive) throw new CommandError(`rm: is a folder: ${p} (use -r)`);
		// Trash, never unlink — the vault shell's one unretractable action
		// stays retractable.
		await ctx.vfs.trash(abs);
	}
	return 0;
};

const cdCmd: Command = async (_args, _ctx) => {
	throw new CommandError('cd: the pane mirrors a bare cd; the agent passes cwd per command', 2);
};

const COMMANDS: Record<string, Command> = {
	help: helpCmd,
	pwd: pwdCmd,
	echo: echoCmd,
	ls: lsCmd,
	cat: catCmd,
	head: headCmd,
	tail: tailCmd,
	wc: wcCmd,
	grep: grepCmd,
	find: findCmd,
	sed: sedCmd,
	sort: sortCmd,
	uniq: uniqCmd,
	mkdir: mkdirCmd,
	touch: touchCmd,
	cp: cpCmd,
	mv: mvCmd,
	rm: rmCmd,
	cd: cdCmd,
};

/** True when a pipe/redirect/chaining metacharacter appears OUTSIDE quotes —
 *  a quoted `|` in `grep "a|b"` or `<` in a sed replacement is literal text,
 *  exactly like a real shell. */
function hasBareMetachars(line: string): boolean {
	let quote: string | null = null;
	for (const ch of line) {
		if (quote) {
			if (ch === quote) quote = null;
		} else if (ch === '"' || ch === "'") {
			quote = ch;
		} else if ('|<>&;`'.includes(ch)) {
			return true;
		}
	}
	return false;
}

// ---------------------------------------------------------------------------
// Entry point.

/** Run one vault-shell command to completion. Same contract as the desktop
 *  runShellCommand: resolves (never rejects) with captured output; a timeout
 *  or abort resolves with exitCode null rather than an error. */
export async function runVaultCommand(vfs: Vfs, opts: VaultRunOptions): Promise<ShellRunResult> {
	const result: ShellRunResult = {
		stdout: '',
		stderr: '',
		exitCode: 0,
		timedOut: false,
		stdoutTruncated: false,
		stderrTruncated: false,
	};
	const pushTo = (into: 'stdout' | 'stderr', text: string): void => {
		if (text === '') return;
		if (result[into].length >= MAX_OUTPUT_CHARS) {
			result[into === 'stdout' ? 'stdoutTruncated' : 'stderrTruncated'] = true;
			return;
		}
		result[into] += text;
		if (result[into].length > MAX_OUTPUT_CHARS) {
			result[into] = result[into].slice(0, MAX_OUTPUT_CHARS);
			result[into === 'stdout' ? 'stdoutTruncated' : 'stderrTruncated'] = true;
		}
	};
	const out = (t: string) => pushTo('stdout', t);
	const outLine = (t: string) => {
		if (t !== '') pushTo('stdout', `${t}\n`);
	};
	const err = (t: string) => pushTo('stderr', `${t}\n`);

	const deadline = opts.timeoutMs && opts.timeoutMs > 0 ? Date.now() + opts.timeoutMs : 0;
	const check = async (): Promise<void> => {
		if (opts.signal?.aborted) throw new VaultShellInterrupt('abort');
		if (deadline > 0 && Date.now() > deadline) throw new VaultShellInterrupt('timeout');
	};

	try {
		if (hasBareMetachars(opts.command)) {
			err('vshell: pipes, redirection, and chaining are not supported — one command per line');
			result.exitCode = 1;
			return result;
		}
		const tokens = tokenize(opts.command);
		if (tokens.length === 0) return result;
		const cwd = opts.cwd ? normalize(opts.cwd) : '';
		const [name, ...args] = tokens;
		const command = COMMANDS[name];
		if (!command) {
			err(`vshell: unknown command "${name}" — try help`);
			result.exitCode = 127;
			return result;
		}
		result.exitCode = await command(args, { vfs, cwd, out, outLine, err, check });
	} catch (e) {
		if (e instanceof VaultShellInterrupt) {
			result.exitCode = null;
			if (e.kind === 'timeout') result.timedOut = true;
		} else if (e instanceof CommandError) {
			err(e.message);
			result.exitCode = e.code;
		} else {
			err(`vshell: ${e instanceof Error ? e.message : String(e)}`);
			result.exitCode = 1;
		}
	}
	return result;
}
