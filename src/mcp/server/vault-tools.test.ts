import { describe, expect, it } from 'vitest';
import { createVaultBackend, findTextHits, safeVaultPath } from './vault-tools';
import type { VaultToolPort } from './vault-tools';

describe('safeVaultPath', () => {
	it('accepts and normalizes vault-relative paths', () => {
		expect(safeVaultPath('note.md')).toBe('note.md');
		expect(safeVaultPath('Projects/deep/note.md')).toBe('Projects/deep/note.md');
		expect(safeVaultPath('Projects/./note.md')).toBe('Projects/note.md');
		expect(safeVaultPath('Projects\\note.md')).toBe('Projects/note.md');
		// Whole-string whitespace is trimmed; spaces inside segment names are
		// legitimate ("My Notes/note.md") and must survive.
		expect(safeVaultPath('  note.md  ')).toBe('note.md');
		expect(safeVaultPath('My Notes/note.md')).toBe('My Notes/note.md');
	});

	it('rejects escapes and absolutes', () => {
		expect(safeVaultPath('../secret.md')).toBeNull();
		expect(safeVaultPath('Projects/../../secret.md')).toBeNull();
		expect(safeVaultPath('/etc/passwd')).toBeNull();
		expect(safeVaultPath('C:/secrets.md')).toBeNull();
		expect(safeVaultPath('')).toBeNull();
		expect(safeVaultPath('.')).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Backend over a fake port
// ---------------------------------------------------------------------------

function fakePort(overrides: Partial<VaultToolPort> = {}): VaultToolPort {
	const files = {
		'a.md': 'alpha\nbeta alpha\n',
		'folder/b.md': 'nothing here',
		'folder/c-alpha.md': 'deep alpha content',
	};
	return {
		listFiles: () => Object.keys(files).map((path) => ({ path })),
		read: async (path) => (path in (files as Record<string, string>) ? (files as Record<string, string>)[path] : null),
		write: async () => 'created',
		...overrides,
	};
}

function toolNames(port: VaultToolPort, allowWrites: boolean): string[] {
	return createVaultBackend(port, { allowWrites }).listTools().map((t) => t.name);
}

describe('catalog gating', () => {
	it('serves the read-only core by default', () => {
		expect(toolNames(fakePort(), false)).toEqual(['list_notes', 'read_note', 'search_notes']);
	});

	it('adds semantic_search only when the port has an index', () => {
		const port = fakePort({ semanticSearch: async () => [] });
		expect(toolNames(port, false)).toContain('semantic_search');
	});

	it('adds get_memory only when the port has facts', () => {
		const port = fakePort({ memoryFacts: () => [{ content: 'x', timestamp: 0 }] });
		expect(toolNames(port, false)).toContain('get_memory');
	});

	it('adds write_note only when writes are allowed', () => {
		expect(toolNames(fakePort(), true)).toContain('write_note');
		expect(toolNames(fakePort(), false)).not.toContain('write_note');
	});
});

describe('list_notes', () => {
	it('lists sorted paths and reports paging', async () => {
		const backend = createVaultBackend(fakePort(), { allowWrites: false });
		const res = await backend.callTool('list_notes', { limit: 2 });
		const text = res.content[0].text;
		expect(text).toContain('a.md');
		expect(text).toContain('folder/b.md');
		expect(text).toContain('more pages exist');
	});

	it('filters by folder', async () => {
		const backend = createVaultBackend(fakePort(), { allowWrites: false });
		const res = await backend.callTool('list_notes', { folder: 'folder' });
		expect(res.content[0].text).toContain('folder/b.md');
		// Not a plain `not.toContain('a.md')` — "c-alpha.md" ends in "a.md".
		expect(res.content[0].text.split('\n')).not.toContain('a.md');
	});

	it('rejects an unsafe folder', async () => {
		const backend = createVaultBackend(fakePort(), { allowWrites: false });
		const res = await backend.callTool('list_notes', { folder: '../outside' });
		expect(res.isError).toBe(true);
	});
});

describe('read_note', () => {
	it('returns content and reports missing notes', async () => {
		const backend = createVaultBackend(fakePort(), { allowWrites: false });
		expect((await backend.callTool('read_note', { path: 'a.md' })).content[0].text).toContain('beta alpha');
		const missing = await backend.callTool('read_note', { path: 'nope.md' });
		expect(missing.isError).toBe(true);
		expect(missing.content[0].text).toContain('not found');
	});

	it('truncates at max_chars', async () => {
		const long = fakePort({ read: async () => 'x'.repeat(5000) });
		const backend = createVaultBackend(long, { allowWrites: false });
		const res = await backend.callTool('read_note', { path: 'a.md', max_chars: 300 });
		expect(res.content[0].text).toContain('[Truncated at 300 of 5000');
	});

	it('refuses unsafe paths', async () => {
		const backend = createVaultBackend(fakePort(), { allowWrites: false });
		expect((await backend.callTool('read_note', { path: '../x' })).isError).toBe(true);
	});
});

describe('search_notes / findTextHits', () => {
	it('returns ranked hits with line numbers', async () => {
		const hits = await findTextHits(fakePort(), 'alpha', 20);
		// Filename match first, then more occurrences.
		expect(hits[0].path).toBe('folder/c-alpha.md');
		expect(hits[1].path).toBe('a.md');
		expect(hits[1].lines[0]).toEqual({ line: 1, text: 'alpha' });
	});

	it('is case-insensitive', async () => {
		expect(await findTextHits(fakePort(), 'ALPHA', 20)).toHaveLength(2);
	});

	it('formats the tool result with excerpts', async () => {
		const backend = createVaultBackend(fakePort(), { allowWrites: false });
		const res = await backend.callTool('search_notes', { query: 'alpha' });
		expect(res.content[0].text).toContain('folder/c-alpha.md');
		expect(res.content[0].text).toContain('1: alpha');
	});
});

describe('write_note', () => {
	it('creates, reports existing, appends, and overwrites', async () => {
		const modes: string[] = [];
		const port = fakePort({
			write: async (_path, _content, mode) => {
				modes.push(mode);
				return mode === 'create' ? 'created' : mode === 'append' ? 'appended' : 'written';
			},
		});
		const backend = createVaultBackend(port, { allowWrites: true });

		expect((await backend.callTool('write_note', { path: 'new.md', content: 'hi' })).content[0].text).toContain('Created new.md');
		expect((await backend.callTool('write_note', { path: 'new.md', content: 'hi', mode: 'append' })).content[0].text).toContain('Appended');
		expect((await backend.callTool('write_note', { path: 'new.md', content: 'hi', mode: 'overwrite' })).content[0].text).toContain('Overwrote');
		expect(modes).toEqual(['create', 'append', 'overwrite']);
	});

	it('surfaces an exists refusal as an error result', async () => {
		const port = fakePort({ write: async () => 'exists' });
		const backend = createVaultBackend(port, { allowWrites: true });
		const res = await backend.callTool('write_note', { path: 'new.md', content: 'hi' });
		expect(res.isError).toBe(true);
		expect(res.content[0].text).toContain('already exists');
	});

	it('validates path and mode before touching the port', async () => {
		const backend = createVaultBackend(fakePort(), { allowWrites: true });
		expect((await backend.callTool('write_note', { path: '../x', content: 'v' })).isError).toBe(true);
		expect((await backend.callTool('write_note', { path: 'x.md', content: 'v', mode: 'chmod' })).isError).toBe(true);
		expect((await backend.callTool('write_note', { path: 'x.md' })).isError).toBe(true);
	});
});

describe('optional tools', () => {
	it('formats semantic hits; an indexless port answers unavailable', async () => {
		const withIndex = createVaultBackend(
			fakePort({ semanticSearch: async () => [{ path: 'a.md', snippet: 'alpha', score: 0.91 }] }),
			{ allowWrites: false }
		);
		const res = await withIndex.callTool('semantic_search', { query: 'concepts of alpha' });
		expect(res.content[0].text).toContain('a.md (score 0.910)');

		// Direct handler call (the protocol layer refuses unlisted tools before
		// this point) — an indexless port reports unavailability, not a crash.
		const without = createVaultBackend(fakePort(), { allowWrites: false });
		const unavailable = await without.callTool('semantic_search', { query: 'alpha' });
		expect(unavailable.isError).toBe(true);
		expect(unavailable.content[0].text).toContain('not available');
	});

	it('formats memory facts', async () => {
		const backend = createVaultBackend(
			fakePort({ memoryFacts: () => [{ content: 'Prefers terse replies', category: 'style', timestamp: 0 }] }),
			{ allowWrites: false }
		);
		const res = await backend.callTool('get_memory', {});
		expect(res.content[0].text).toContain('[style] Prefers terse replies');
	});
});
