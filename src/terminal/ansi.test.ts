import { describe, expect, it } from 'vitest';
import { createAnsiStreamer, stripAnsi } from './ansi';

const text = (spans: ReturnType<ReturnType<typeof createAnsiStreamer>['push']>) =>
	spans.map((s) => s.text).join('');

describe('stripAnsi', () => {
	it('removes SGR sequences', () => {
		expect(stripAnsi('\x1b[32mok\x1b[0m')).toBe('ok');
	});

	it('removes cursor movement and other CSI sequences', () => {
		expect(stripAnsi('\x1b[2J\x1b[3;5Hmiddle\x1b[K')).toBe('middle');
	});

	it('removes OSC sequences with both terminators', () => {
		expect(stripAnsi('\x1b]0;my title\x07body')).toBe('body');
		expect(stripAnsi('\x1b]8;;https://x\x1b\\link\x1b]8;;\x1b\\')).toBe('link');
	});

	it('removes two-char escapes and charset designations', () => {
		expect(stripAnsi('\x1b7saved\x1b8')).toBe('saved');
		expect(stripAnsi('\x1b(Bplain')).toBe('plain');
	});

	it('leaves plain text untouched', () => {
		expect(stripAnsi('hello [world]')).toBe('hello [world]');
	});
});

describe('createAnsiStreamer', () => {
	it('passes plain text through as unstyled spans', () => {
		const s = createAnsiStreamer();
		const spans = [...s.push('hello '), ...s.flush()];
		expect(text(spans)).toBe('hello ');
		expect(spans[0].classes).toEqual([]);
	});

	it('applies SGR colors as classes', () => {
		const s = createAnsiStreamer();
		const spans = [...s.push('\x1b[31mred\x1b[0m plain'), ...s.flush()];
		expect(text(spans)).toBe('red plain');
		expect(spans[0].classes).toContain('ai-ansi-fg-red');
		expect(spans[1].classes).toEqual([]);
	});

	it('carries style across chunks', () => {
		const s = createAnsiStreamer();
		const spans = [...s.push('\x1b[1;32mbo'), ...s.push('ld green'), ...s.flush()];
		expect(text(spans)).toBe('bold green');
		expect(spans[0].classes).toContain('ai-ansi-bold');
		expect(spans[0].classes).toContain('ai-ansi-fg-green');
	});

	it('holds back a sequence split across chunks', () => {
		const s = createAnsiStreamer();
		const first = s.push('ok\x1b[3');
		// "ok" is emittable; the half sequence is not.
		expect(text(first)).toBe('ok');
		const rest = [...s.push('5mhi'), ...s.flush()];
		// The halves reassemble to SGR 35 — plain magenta, not 95.
		expect(text(rest)).toBe('hi');
		expect(rest[0].classes).toContain('ai-ansi-fg-magenta');
	});

	it('maps 256-color and 24-bit colors to direct rgb styles', () => {
		const s = createAnsiStreamer();
		const spans = [
			...s.push('\x1b[38;5;196mone\x1b[0m'),
			...s.push('\x1b[38;2;10;20;30mtwo\x1b[0m'),
			...s.flush(),
		];
		expect(text(spans)).toBe('onetwo');
		expect(spans[0].color).toBe('rgb(255, 0, 0)');
		expect(spans[0].classes).toEqual([]);
		expect(spans[1].color).toBe('rgb(10, 20, 30)');
	});

	it('resets attributes on SGR 0', () => {
		const s = createAnsiStreamer();
		const spans = [...s.push('\x1b[1;4;41mheavy\x1b[0mcalm'), ...s.flush()];
		expect(spans[0].classes.length).toBeGreaterThan(0);
		expect(spans[1].classes).toEqual([]);
	});

	it('collapses carriage-return overwrites per line', () => {
		const s = createAnsiStreamer();
		const spans = [...s.push('10%\r50%\r99%\ndone'), ...s.flush()];
		expect(text(spans)).toBe('99%\ndone');
	});

	it('drops a sequence still open at flush', () => {
		const s = createAnsiStreamer();
		const spans = [...s.push('text\x1b[31'), ...s.flush()];
		expect(text(spans)).toBe('text');
	});
});
