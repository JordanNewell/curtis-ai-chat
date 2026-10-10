import { describe, it, expect } from 'vitest';
import { buildCompletionMessages, extractCompletion, COMPLETION_MAX_CHARS } from './completion';

describe('buildCompletionMessages', () => {
	it('embeds prefix and suffix in labeled blocks', () => {
		const msgs = buildCompletionMessages('Hello wor', 'ld.', { prefixChars: 2000, suffixChars: 300 });
		expect(msgs).toHaveLength(2);
		expect(msgs[0].role).toBe('system');
		const user = msgs[1].content as string;
		expect(user).toContain('<before>\nHello wor\n</before>');
		expect(user).toContain('<after>\nld.\n</after>');
	});

	it('truncates prefix to the limit from the end (keeps text nearest cursor)', () => {
		const long = 'a'.repeat(3000) + 'tail';
		const msgs = buildCompletionMessages(long, '', { prefixChars: 2000, suffixChars: 300 });
		const user = msgs[1].content as string;
		expect(user).toContain('tail');
		expect(user).not.toContain('a'.repeat(3000));
	});

	it('handles an empty suffix (end-of-line trigger)', () => {
		const msgs = buildCompletionMessages('Hello wor', '', { prefixChars: 10, suffixChars: 300 });
		const user = msgs[1].content as string;
		expect(user).toContain('<after>\n\n</after>');
	});
});

describe('extractCompletion', () => {
	it('stops at a paragraph break (client-side backstop for ignored stop sequences)', () => {
		expect(extractCompletion('first line\n\nSecond paragraph')).toBe('first line');
	});

	it('strips stray code fences and quotes', () => {
		expect(extractCompletion('```\ncontinuation\n```')).toBe('continuation');
		expect(extractCompletion('"continuation"')).toBe('continuation');
	});

	it('drops doubled leading whitespace when the prefix ends with whitespace', () => {
		expect(extractCompletion(' continued', true)).toBe('continued');
		// Keeps meaningful leading whitespace at a normal boundary.
		expect(extractCompletion(' continued', false)).toBe(' continued');
	});

	it('trims trailing whitespace and caps length', () => {
		expect(extractCompletion('word   ')).toBe('word');
		const long = 'x'.repeat(COMPLETION_MAX_CHARS + 50);
		expect(extractCompletion(long)).toHaveLength(COMPLETION_MAX_CHARS);
	});

	it('returns empty for empty or fence-only input', () => {
		expect(extractCompletion('')).toBe('');
		expect(extractCompletion('\n\n')).toBe('');
	});
});
