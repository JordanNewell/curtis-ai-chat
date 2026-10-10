import { describe, expect, it } from 'vitest';
import {
	faviconUrlFor,
	findVaultPathCandidates,
	resolveCandidates,
	resolveVaultRef,
} from './linkify';

describe('findVaultPathCandidates', () => {
	it('finds folder paths and bare filenames across glued prose', () => {
		const text = 'Saved to AI/Conversations/Morning pages.md, plus todo.md for today.';
		const found = findVaultPathCandidates(text);
		expect(found.map((c) => c.text)).toEqual([
			'Saved to AI/Conversations/Morning pages.md',
			'to AI/Conversations/Morning pages.md',
			'AI/Conversations/Morning pages.md',
			'pages.md',
			'todo.md',
		]);
		// Every candidate must be a contiguous slice at its claimed offset.
		for (const c of found) {
			expect(text.slice(c.start, c.start + c.text.length)).toBe(c.text);
		}
	});

	it('rejects emails and mid-word hits', () => {
		const text = 'Mail a@notes.md about notes.mdx sometime.';
		expect(findVaultPathCandidates(text)).toEqual([]);
	});

	it('keeps a path that merely ends a sentence', () => {
		const text = 'Open Projects/Ideas.md.';
		expect(findVaultPathCandidates(text).map((c) => ({ ...c }))).toContainEqual({
			text: 'Projects/Ideas.md',
			start: 5,
		});
	});

	it('handles unicode names, dotted folders, and dotted filenames', () => {
		const text = 'Обзор/Заметки.md and my.folder/note v2.0.md are valid.';
		const found = findVaultPathCandidates(text);
		expect(found.map((c) => c.text)).toContain('Обзор/Заметки.md');
		expect(found.map((c) => c.text)).toContain('note v2.0.md');
	});

	it('may surface URL-internal paths — resolveVaultRef is the filter', () => {
		const text = 'Docs at https://example.com/docs/readme.md explain things.';
		expect(findVaultPathCandidates(text).map((c) => c.text)).toContain(
			'example.com/docs/readme.md'
		);
		expect(resolveVaultRef('example.com/docs/readme.md', ['AI/Notes.md'])).toBeNull();
	});

	it('finds nothing in prose without path-like tokens', () => {
		expect(findVaultPathCandidates('No references here at all.')).toEqual([]);
	});
});

describe('resolveCandidates', () => {
	const paths = ['AI/Conversations/Chat.md', 'Projects/Ideas.md', 'todo.md'];

	it('keeps the longest candidate that overlaps a resolved span out', () => {
		const candidates = findVaultPathCandidates('Created Projects/Ideas.md, plus todo.md.');
		const resolved = resolveCandidates(candidates, paths);
		expect(resolved.map((r) => [r.text, r.path])).toEqual([
			['Projects/Ideas.md', 'Projects/Ideas.md'],
			['todo.md', 'todo.md'],
		]);
	});

	it('resolves a unique basename to its full path', () => {
		expect(resolveCandidates([{ text: 'Chat.md', start: 0 }], paths)).toEqual([
			{ text: 'Chat.md', start: 0, path: 'AI/Conversations/Chat.md' },
		]);
	});

	it('drops unknown candidates', () => {
		expect(resolveCandidates([{ text: 'missing.md', start: 0 }], paths)).toEqual([]);
	});
});

describe('resolveVaultRef', () => {
	const paths = ['AI/Conversations/Chat.md', 'Projects/Ideas.md', 'Archive/Ideas.md', 'todo.md'];

	it('matches exact paths case-insensitively', () => {
		expect(resolveVaultRef('TODO.md', paths)).toBe('todo.md');
		expect(resolveVaultRef('projects/ideas.md', paths)).toBe('Projects/Ideas.md');
	});

	it('resolves a unique basename to its full path', () => {
		expect(resolveVaultRef('Chat.md', paths)).toBe('AI/Conversations/Chat.md');
	});

	it('refuses ambiguous basenames and unknown paths', () => {
		expect(resolveVaultRef('Ideas.md', paths)).toBeNull();
		expect(resolveVaultRef('missing.md', paths)).toBeNull();
	});
});

describe('faviconUrlFor', () => {
	it('builds a DuckDuckGo icon URL', () => {
		expect(faviconUrlFor('obsidian.md')).toBe('https://icons.duckduckgo.com/ip3/obsidian.md.ico');
	});
});
