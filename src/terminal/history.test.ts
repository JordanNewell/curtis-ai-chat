import { describe, expect, it } from 'vitest';
import { completeFromHistory, rememberCommand, searchHistoryBackward, TERMINAL_HISTORY_CAP } from './history';

describe('rememberCommand', () => {
	it('appends and returns a new array', () => {
		const before = ['a'];
		const after = rememberCommand(before, 'b');
		expect(after).toEqual(['a', 'b']);
		expect(before).toEqual(['a']);
	});

	it('moves a re-run command to the end (erasedups)', () => {
		expect(rememberCommand(['ls', 'git status', 'ls'], 'ls')).toEqual(['git status', 'ls']);
	});

	it('ignores empty commands', () => {
		expect(rememberCommand(['a'], '   ')).toEqual(['a']);
	});

	it('never remembers a leading-space command', () => {
		expect(rememberCommand(['a'], ' echo secret')).toEqual(['a']);
	});

	it('caps the history, dropping the oldest', () => {
		let h: string[] = [];
		for (let i = 0; i < TERMINAL_HISTORY_CAP + 10; i++) h = rememberCommand(h, `cmd-${i}`);
		expect(h.length).toBe(TERMINAL_HISTORY_CAP);
		expect(h[0]).toBe(`cmd-${10}`);
		expect(h[h.length - 1]).toBe(`cmd-${TERMINAL_HISTORY_CAP + 9}`);
	});
});

describe('searchHistoryBackward', () => {
	const history = ['git status', 'npm run build', 'git status --short', 'npm test'];

	it('finds the most recent match from the end', () => {
		expect(searchHistoryBackward(history, 'git', history.length - 1)).toBe(2);
	});

	it('walks past a found match on the next call', () => {
		expect(searchHistoryBackward(history, 'git', 1)).toBe(0);
	});

	it('matches substrings', () => {
		expect(searchHistoryBackward(history, 'build', history.length - 1)).toBe(1);
	});

	it('returns -1 when nothing matches', () => {
		expect(searchHistoryBackward(history, 'cargo', history.length - 1)).toBe(-1);
	});

	it('returns -1 for an empty query', () => {
		expect(searchHistoryBackward(history, '', history.length - 1)).toBe(-1);
	});
});

describe('completeFromHistory', () => {
	const history = ['npm run build', 'npm test', 'git status', 'npm run dev'];

	it('returns most-recent-first completions', () => {
		expect(completeFromHistory(history, 'npm ')).toEqual(['npm run dev', 'npm test', 'npm run build']);
	});

	it('skips an exact match', () => {
		expect(completeFromHistory(history, 'npm test')).toEqual([]);
	});

	it('dedupes repeated commands', () => {
		expect(completeFromHistory(['ls', 'ls -la', 'ls'], 'ls')).toEqual(['ls -la']);
	});

	it('returns nothing for an empty prefix', () => {
		expect(completeFromHistory(history, '')).toEqual([]);
	});
});
