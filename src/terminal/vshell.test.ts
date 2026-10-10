// vshell tests — the command set runs against an in-memory Vfs, no Obsidian
// involved (the same boundary the autocomplete modules keep).

import { describe, expect, it, vi } from 'vitest';
import { runVaultCommand, resolveVaultPath, tokenize, type Vfs, type VfsEntry } from './vshell';

function basename(p: string): string {
	const parts = p.split('/');
	return parts[parts.length - 1] ?? p;
}

function parentOf(p: string): string {
	return p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
}

class MemVfs implements Vfs {
	folders = new Set<string>(['']);
	files = new Map<string, string>();
	trashed: string[] = [];

	async list(folderPath: string): Promise<VfsEntry[]> {
		if (!this.folders.has(folderPath)) throw new Error(`not a folder: ${folderPath}`);
		const entries: VfsEntry[] = [];
		for (const f of this.folders) {
			if (f !== folderPath && parentOf(f) === folderPath) {
				entries.push({ name: basename(f), path: f, type: 'folder', size: 0 });
			}
		}
		for (const [f, content] of this.files) {
			if (parentOf(f) === folderPath) {
				entries.push({ name: basename(f), path: f, type: 'file', size: content.length });
			}
		}
		return entries;
	}

	async type(path: string): Promise<'file' | 'folder' | null> {
		if (this.folders.has(path)) return 'folder';
		if (this.files.has(path)) return 'file';
		return null;
	}

	async read(filePath: string): Promise<string> {
		const content = this.files.get(filePath);
		if (content === undefined) throw new Error(`no such file: ${filePath}`);
		return content;
	}

	async write(filePath: string, content: string): Promise<void> {
		this.files.set(filePath, content);
	}

	async createFolder(folderPath: string): Promise<void> {
		if (this.folders.has(folderPath)) throw new Error('folder exists');
		this.folders.add(folderPath);
	}

	async move(from: string, to: string): Promise<void> {
		if (this.files.has(from)) {
			this.files.set(to, this.files.get(from)!);
			this.files.delete(from);
		} else if (this.folders.has(from)) {
			this.folders.delete(from);
			this.folders.add(to);
			for (const f of [...this.files.keys()]) {
				if (f.startsWith(from + '/')) {
					this.files.set(to + f.slice(from.length), this.files.get(f)!);
					this.files.delete(f);
				}
			}
		} else {
			throw new Error(`no such path: ${from}`);
		}
	}

	async copyFile(from: string, to: string): Promise<void> {
		const content = this.files.get(from);
		if (content === undefined) throw new Error(`no such file: ${from}`);
		this.files.set(to, content);
	}

	async trash(targetPath: string): Promise<void> {
		if (this.files.has(targetPath)) {
			this.files.delete(targetPath);
		} else if (this.folders.has(targetPath)) {
			this.folders.delete(targetPath);
			for (const f of [...this.files.keys()]) {
				if (parentOf(f) === targetPath || f.startsWith(targetPath + '/')) this.files.delete(f);
			}
		} else {
			throw new Error(`no such path: ${targetPath}`);
		}
		this.trashed.push(targetPath);
	}

	async exists(path: string): Promise<boolean> {
		return this.folders.has(path) || this.files.has(path);
	}
}

/** The standard fixture: a vault with notes/ (a.md, b.md, data.txt, u.txt,
 *  sub/c.md) and a root readme. */
function seedInto(vfs: MemVfs): MemVfs {
	vfs.folders.add('notes');
	vfs.folders.add('notes/sub');
	vfs.files.set('readme.md', '# Hello\nworld\n');
	vfs.files.set('notes/a.md', 'alpha\nbeta\ngamma\n');
	vfs.files.set('notes/b.md', 'beta beta\n');
	vfs.files.set('notes/sub/c.md', 'deep gamma\n');
	vfs.files.set('notes/data.txt', '3\n1\n2\n1\n');
	vfs.files.set('notes/u.txt', 'a\na\nb\nb\nb\nc\n');
	return vfs;
}

function seed(): MemVfs {
	return seedInto(new MemVfs());
}

function run(vfs: Vfs, command: string, cwd = '') {
	return runVaultCommand(vfs, { command, cwd });
}

describe('tokenize', () => {
	it('splits on whitespace', () => {
		expect(tokenize('ls -l  notes')).toEqual(['ls', '-l', 'notes']);
	});
	it('keeps quoted spans together', () => {
		expect(tokenize('grep "two words" \'a b\'')).toEqual(['grep', 'two words', 'a b']);
	});
	it('preserves an explicitly empty argument', () => {
		expect(tokenize("echo ''")).toEqual(['echo', '']);
	});
	it('rejects an unterminated quote', () => {
		expect(() => tokenize('grep "oops')).toThrow();
	});
});

describe('resolveVaultPath', () => {
	it('joins relative paths onto the cwd', () => {
		expect(resolveVaultPath('notes', 'a.md')).toBe('notes/a.md');
	});
	it('treats a leading slash as vault-absolute', () => {
		expect(resolveVaultPath('notes', '/readme.md')).toBe('readme.md');
	});
	it('resolves . and ..', () => {
		expect(resolveVaultPath('notes/sub', '..')).toBe('notes');
		expect(resolveVaultPath('notes', './a.md')).toBe('notes/a.md');
	});
	it('refuses to climb past the root', () => {
		expect(() => resolveVaultPath('notes', '../..')).toThrow();
	});
});

describe('runVaultCommand basics', () => {
	it('pwd prints the vault-relative cwd', async () => {
		expect(await run(seed(), 'pwd')).toMatchObject({ stdout: '/\n', exitCode: 0 });
		expect(await run(seed(), 'pwd', 'notes/sub')).toMatchObject({ stdout: '/notes/sub\n', exitCode: 0 });
	});

	it('echo joins arguments (quotes already stripped)', async () => {
		expect(await run(seed(), 'echo "hello world"')).toMatchObject({ stdout: 'hello world\n', exitCode: 0 });
	});

	it('unknown commands exit 127 with a pointer to help', async () => {
		const r = await run(seed(), 'frobnicate');
		expect(r.exitCode).toBe(127);
		expect(r.stderr).toContain('unknown command');
	});

	it('rejects pipes, redirection, and chaining', async () => {
		for (const command of ['ls | wc', 'cat a > b', 'ls && pwd', 'echo `pwd`']) {
			const r = await run(seed(), command);
			expect(r.exitCode).toBe(1);
			expect(r.stderr).toContain('not supported');
		}
	});

	it('quoted metacharacters are literal, not pipes', async () => {
		expect((await run(seed(), 'echo "a | b && c"')).stdout).toBe('a | b && c\n');
		expect((await run(seed(), 'sed "s/(al)pha/<\\1>/" notes/a.md')).stdout).toContain('<al>');
	});

	it('cd explains the pane/cwd contract instead of running', async () => {
		const r = await run(seed(), 'cd notes');
		expect(r.exitCode).toBe(2);
		expect(r.stderr).toContain('cd');
	});
});

describe('reading commands', () => {
	it('ls lists folders with a trailing slash', async () => {
		const r = await run(seed(), 'ls');
		expect(r.stdout).toContain('notes/');
		expect(r.stdout).toContain('readme.md');
		expect(r.exitCode).toBe(0);
	});

	it('ls -l marks folders and sizes files', async () => {
		const r = await run(seed(), 'ls -l');
		expect(r.stdout).toMatch(/^d\s+-\s+notes\//m);
		expect(r.stdout).toMatch(/^-\s+\d+\s+readme\.md/m);
	});

	it('ls of a missing path fails', async () => {
		const r = await run(seed(), 'ls nope');
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain('no such directory');
	});

	it('cat prints files in order', async () => {
		const r = await run(seed(), 'cat notes/a.md notes/b.md');
		expect(r.stdout).toBe('alpha\nbeta\ngamma\nbeta beta\n');
	});

	it('cat of a missing file fails', async () => {
		const r = await run(seed(), 'cat ghost.md');
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain('no such file');
	});

	it('head and tail respect -n', async () => {
		expect((await run(seed(), 'head -n 1 notes/a.md')).stdout).toBe('alpha\n');
		expect((await run(seed(), 'tail -n 1 notes/a.md')).stdout).toBe('gamma\n');
		expect((await run(seed(), 'head -2 notes/a.md')).stdout).toBe('alpha\nbeta\n');
	});

	it('head rejects a bad line count', async () => {
		expect((await run(seed(), 'head -n x notes/a.md')).exitCode).toBe(2);
	});

	it('wc counts lines, words, and chars', async () => {
		expect((await run(seed(), 'wc -l notes/data.txt')).stdout.trim()).toBe('4 notes/data.txt');
		expect((await run(seed(), 'wc -c readme.md')).stdout.trim()).toBe('14 readme.md');
	});
});

describe('grep and find', () => {
	it('grep recurses into folders with path prefixes', async () => {
		const r = await run(seed(), 'grep beta notes');
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain('notes/a.md:beta');
		expect(r.stdout).toContain('notes/b.md:beta beta');
	});

	it('grep -i and -n behave', async () => {
		const r = await run(seed(), 'grep -i -n GAMMA notes');
		expect(r.stdout).toContain('notes/a.md:3:gamma');
		expect(r.stdout).toContain('notes/sub/c.md:1:deep gamma');
	});

	it('grep on a single file has no path prefix', async () => {
		const r = await run(seed(), 'grep beta notes/a.md');
		expect(r.stdout).toBe('beta\n');
	});

	it('grep with no matches exits 1', async () => {
		expect((await run(seed(), 'grep zzz notes')).exitCode).toBe(1);
	});

	it('grep degrades invalid regex to a literal match', async () => {
		const r = await run(seed(), 'grep "[unclosed" readme.md');
		expect(r.exitCode).toBe(1); // literal "[unclosed" appears nowhere
	});

	it('find walks recursively from its start', async () => {
		const r = await run(seed(), 'find notes');
		expect(r.stdout.split('\n')[0]).toBe('/notes');
		expect(r.stdout).toContain('/notes/sub/c.md');
	});

	it('find -name and -type filter', async () => {
		const md = await run(seed(), 'find notes -name "*.md"');
		expect(md.stdout).toContain('/notes/a.md');
		expect(md.stdout).not.toContain('data.txt');
		const dirs = await run(seed(), 'find notes -type d');
		expect(dirs.stdout).toContain('/notes/sub');
		expect(dirs.stdout).not.toContain('a.md');
	});
});

describe('text transforms', () => {
	it('sed substitutes first-occurrence per line, or every with g', async () => {
		expect((await run(seed(), 'sed s/beta/BETA/ notes/a.md')).stdout).toBe('alpha\nBETA\ngamma\n');
		expect((await run(seed(), 'sed s/beta/BETA/g notes/b.md')).stdout).toBe('BETA BETA\n');
	});

	it('sed accepts any delimiter and group refs', async () => {
		expect((await run(seed(), 'sed s,beta,X, notes/a.md')).stdout).toContain('X');
		expect((await run(seed(), 'sed "s/(al)pha/<\\1>/" notes/a.md')).stdout).toContain('<al>');
	});

	it('sed rejects non-substitution scripts', async () => {
		const r = await run(seed(), 'sed p/foo/bar notes/a.md');
		expect(r.exitCode).toBe(2);
	});

	it('sort -n and -r order lines', async () => {
		expect((await run(seed(), 'sort -n notes/data.txt')).stdout).toBe('1\n1\n2\n3\n');
		expect((await run(seed(), 'sort -r notes/data.txt')).stdout).toBe('3\n2\n1\n1\n');
	});

	it('uniq collapses adjacent runs, -c counts them', async () => {
		expect((await run(seed(), 'uniq notes/u.txt')).stdout).toBe('a\nb\nc\n');
		expect((await run(seed(), 'uniq -c notes/u.txt')).stdout).toBe('   2 a\n   3 b\n   1 c\n');
	});
});

describe('write commands', () => {
	it('mkdir creates, refuses duplicates, -p nests and tolerates existing', async () => {
		const vfs = seed();
		expect((await run(vfs, 'mkdir docs')).exitCode).toBe(0);
		expect(vfs.folders.has('docs')).toBe(true);
		expect((await run(vfs, 'mkdir docs')).exitCode).toBe(1);
		expect((await run(vfs, 'mkdir -p docs/deep/er')).exitCode).toBe(0);
		expect(vfs.folders.has('docs/deep/er')).toBe(true);
		expect((await run(vfs, 'mkdir -p docs')).exitCode).toBe(0);
		expect((await run(vfs, 'mkdir orph/an')).exitCode).toBe(1);
	});

	it('mkdir without -p over a file fails', async () => {
		const r = await run(seed(), 'mkdir notes/a.md');
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain('file is in the way');
	});

	it('touch creates an empty file and never truncates an existing one', async () => {
		const vfs = seed();
		await run(vfs, 'touch notes/new.md');
		expect(vfs.files.get('notes/new.md')).toBe('');
		await run(vfs, 'touch readme.md');
		expect(vfs.files.get('readme.md')).toBe('# Hello\nworld\n');
	});

	it('cp copies to a name or into a folder, refuses existing destinations', async () => {
		const vfs = seed();
		await run(vfs, 'cp readme.md notes/copy.md');
		expect(vfs.files.get('notes/copy.md')).toBe('# Hello\nworld\n');
		await run(vfs, 'cp readme.md notes');
		expect(vfs.files.get('notes/readme.md')).toBe('# Hello\nworld\n');
		expect((await run(vfs, 'cp readme.md notes/copy.md')).exitCode).toBe(1);
	});

	it('mv renames files and moves folders with their children', async () => {
		const vfs = seed();
		await run(vfs, 'mv readme.md intro.md');
		expect(vfs.files.has('intro.md')).toBe(true);
		expect(vfs.files.has('readme.md')).toBe(false);
		await run(vfs, 'mv notes/sub notes/sub2');
		expect(vfs.files.has('notes/sub2/c.md')).toBe(true);
		expect(vfs.files.has('notes/sub/c.md')).toBe(false);
	});

	it('mv refuses to move a folder into itself', async () => {
		expect((await run(seed(), 'mv notes notes/sub/x')).exitCode).toBe(1);
	});

	it('rm trashes files, needs -r for folders, refuses the root', async () => {
		const vfs = seed();
		await run(vfs, 'rm readme.md');
		expect(vfs.trashed).toContain('readme.md');
		expect(vfs.files.has('readme.md')).toBe(false);
		expect((await run(vfs, 'rm notes')).exitCode).toBe(1);
		await run(vfs, 'rm -r notes/sub');
		expect(vfs.trashed).toContain('notes/sub');
		expect(vfs.files.has('notes/sub/c.md')).toBe(false);
		expect((await run(seed(), 'rm -r /')).exitCode).toBe(1);
	});
});

describe('limits and interruption', () => {
	it('caps stdout at 8000 chars with a truncation flag', async () => {
		const vfs = seed();
		vfs.files.set('big.txt', 'a'.repeat(9000));
		const r = await run(vfs, 'cat big.txt');
		expect(r.stdout.length).toBe(8000);
		expect(r.stdoutTruncated).toBe(true);
	});

	it('a slow walk past the deadline reports a timeout with null exit', async () => {
		// Fake clock: the deadline check reads Date.now(), so the "slow" Vfs
		// just jumps the system time past it — no real timers, deterministic.
		vi.useFakeTimers();
		try {
			class SlowVfs extends MemVfs {
				override async read(path: string): Promise<string> {
					vi.setSystemTime(Date.now() + 60_000);
					return super.read(path);
				}
			}
			const r = await runVaultCommand(seedInto(new SlowVfs()), { command: 'cat notes/a.md notes/b.md', timeoutMs: 5000 });
			expect(r.timedOut).toBe(true);
			expect(r.exitCode).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});

	it('a pre-aborted signal stops the run with a null exit', async () => {
		const controller = new AbortController();
		controller.abort();
		const r = await runVaultCommand(seed(), { command: 'cat notes/a.md', signal: controller.signal });
		expect(r.exitCode).toBeNull();
		expect(r.timedOut).toBe(false);
	});
});

describe('efficiency smoke', () => {
	// The pane renders whatever these commands return — the efficiency
	// contract is that pathological input degrades to the caps instead of
	// freezing the renderer or eating the conversation.

	it('a multi-megabyte cat returns inside the capture cap, fast', async () => {
		const vfs = seed();
		vfs.files.set('huge.txt', 'x'.repeat(3_000_000));
		const started = Date.now();
		const r = await run(vfs, 'cat huge.txt');
		expect(r.exitCode).toBe(0);
		expect(r.stdout.length).toBe(8000);
		expect(r.stdoutTruncated).toBe(true);
		// Generous wall-clock budget: only a pathological regression (unbounded
		// accumulation, quadratic concat) should ever trip it.
		expect(Date.now() - started).toBeLessThan(5000);
	});

	it('grep over an oversized vault stops at the walk cap instead of reading everything', async () => {
		const vfs = seed();
		vfs.folders.add('bulk');
		for (let i = 0; i < 2500; i++) vfs.files.set(`bulk/note-${String(i).padStart(4, '0')}.md`, 'needle\n');
		const r = await run(vfs, 'grep needle bulk');
		expect(r.exitCode).toBe(0);
		expect(r.stderr).toContain('capped at 2000 entries');
		// Both caps engaged: the walk stopped at 2000 entries AND the rendered
		// matches truncated at the output cap.
		expect(r.stdoutTruncated).toBe(true);
		expect(r.stdout.length).toBe(8000);
	});

	it('find lists its header plus a capped, truncated entry list', async () => {
		const vfs = seed();
		vfs.folders.add('bulk');
		for (let i = 0; i < 2500; i++) vfs.files.set(`bulk/note-${String(i).padStart(4, '0')}.md`, '');
		const r = await run(vfs, 'find bulk');
		expect(r.stderr).toContain('capped at 2000 entries');
		expect(r.stdout.startsWith('/bulk\n')).toBe(true);
		expect(r.stdoutTruncated).toBe(true);
	});
});
