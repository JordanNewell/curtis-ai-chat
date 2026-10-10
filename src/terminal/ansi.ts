// ANSI escape handling for the terminal.
//
// Output captured through a pipe carries whatever the child emitted: tools
// forced into color mode (--color=always, CLICOLOR_FORCE, npm, gh) emit SGR
// sequences that would otherwise render as garbled "[32m" text. Two jobs:
//
//   stripAnsi(text)      — remove every escape sequence. The agent's
//                          run_command tool uses this so escape garbage never
//                          reaches the model's context.
//   createAnsiStreamer() — incremental parser turning a chunk stream into
//                          styled spans for the pane, carrying SGR state
//                          across chunk boundaries (a color can open in one
//                          chunk and close three chunks later).
//
// Deliberately Obsidian-free so it runs under vitest (same boundary as
// vshell.ts). Spans carry presentation tokens, not DOM: the pane maps the
// class names to CSS (.ai-ansi-* in styles.css) and applies direct rgb()
// colors for 256-color/24-bit SGR, which have no fixed palette slot.

export interface AnsiSpan {
	text: string;
	classes: string[];
	/** Direct css color for extended-color SGR (38;5 / 38;2). */
	color?: string;
	/** Direct css color for extended background SGR (48;5 / 48;2). */
	backgroundColor?: string;
}

const PALETTE = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const;

// All three regexes match control characters on purpose — parsing terminal
// escape sequences IS matching control characters (same exemption as
// utils/download.ts).
// eslint-disable-next-line no-control-regex -- ESC-based CSI matcher
const CSI_RE = /\[[0-9;:<=?]*[ -/]*[@-~]/g;
// Lazy body so an unterminated OSC swallows only up to its terminator.
// eslint-disable-next-line no-control-regex -- OSC title/terminator matcher
const OSC_RE = /\].*?(?:|\\)/g;
// Two-char escapes (ESC 7, ESC c — DEC codes live below @) and charset
// designations (ESC ( B). Charset pairs come first so the single-char
// alternative can't eat their introducer.
// eslint-disable-next-line no-control-regex -- two-char escape matcher
const SHORT_ESC_RE = /\(.|\).|[\x20-\x7e]/g;

/** Remove every escape sequence — SGR, cursor movement, OSC titles, charset
 *  switches: anything a pipe-captured run can emit. */
export function stripAnsi(text: string): string {
	return text.replace(CSI_RE, '').replace(OSC_RE, '').replace(SHORT_ESC_RE, '');
}

/** Progress-bar friendliness: within one line keep only what follows the
 *  last \r, approximating the overwrite the child intended. */
function collapseCarriageReturns(text: string): string {
	if (!text.includes('\r')) return text;
	return text
		.split('\n')
		.map((line) => {
			const i = line.lastIndexOf('\r');
			return i === -1 ? line : line.slice(i + 1);
		})
		.join('\n');
}

interface StyleState {
	bold: boolean;
	dim: boolean;
	italic: boolean;
	underline: boolean;
	/** Palette token name ('red', 'bright-blue') or a direct 'rgb(...)' string. */
	fg?: string;
	bg?: string;
}

/** The xterm 256-color cube/gray ramp (16–255); 0–15 have palette tokens
 *  instead, so callers map those before reaching here. */
function ansi256ToRgb(n: number): string {
	if (n < 16) return '';
	if (n < 232) {
		const i = n - 16;
		const steps = [0, 95, 135, 175, 215, 255];
		const r = steps[Math.floor(i / 36)];
		const g = steps[Math.floor((i % 36) / 6)];
		const b = steps[i % 6];
		return `rgb(${r}, ${g}, ${b})`;
	}
	const v = 8 + (n - 232) * 10;
	return `rgb(${v}, ${v}, ${v})`;
}

/**
 * Incremental SGR-aware streamer. Feed chunks via push() as they arrive;
 * call flush() when the command ends to drain buffered text. A sequence
 * split across pushes is held back until its terminator arrives, so no
 * half-rendered escape ever reaches the pane.
 */
export interface AnsiStreamer {
	push(chunk: string): AnsiSpan[];
	flush(): AnsiSpan[];
}

export function createAnsiStreamer(): AnsiStreamer {
	const state: StyleState = { bold: false, dim: false, italic: false, underline: false };
	/** Ground text since the last emission — survives across pushes, since a
	 *  color open in one chunk stays open until a later chunk resets it. */
	let buf = '';
	/** True while consuming a sequence (ESC seen, terminator not yet). */
	let inEscape = false;
	/** True once the sequence is identified as OSC (ends at BEL or ST). */
	let inOsc = false;
	/** The escape characters accumulated so far — also survives pushes, so an
	 *  escape split across chunks resolves only once its terminator lands. */
	let seq = '';

	const classesFor = (): string[] => {
		const classes: string[] = [];
		if (state.bold) classes.push('ai-ansi-bold');
		if (state.dim) classes.push('ai-ansi-dim');
		if (state.italic) classes.push('ai-ansi-italic');
		if (state.underline) classes.push('ai-ansi-underline');
		// Direct rgb() colors ride the span's style — only palette tokens
		// become classes the stylesheet themes.
		if (state.fg && !state.fg.startsWith('rgb(')) classes.push(`ai-ansi-fg-${state.fg}`);
		if (state.bg && !state.bg.startsWith('rgb(')) classes.push(`ai-ansi-bg-${state.bg}`);
		return classes;
	};

	const emit = (out: AnsiSpan[]): void => {
		if (!buf) return;
		const text = collapseCarriageReturns(buf);
		buf = '';
		if (!text) return;
		const span: AnsiSpan = { text, classes: classesFor() };
		if (state.fg?.startsWith('rgb(')) span.color = state.fg;
		if (state.bg?.startsWith('rgb(')) span.backgroundColor = state.bg;
		out.push(span);
	};

	const applySgr = (params: string): void => {
		// Colon sub-parameter forms (38:5:N) split like semicolons — the
		// producers we care about never mix both inside one sequence.
		const list = params.split(/[;:]/).map((p) => (p === '' ? '0' : p));
		for (let i = 0; i < list.length; i++) {
			const n = parseInt(list[i], 10);
			if (Number.isNaN(n)) continue;
			if (n === 0) {
				state.bold = state.dim = state.italic = state.underline = false;
				state.fg = undefined;
				state.bg = undefined;
			} else if (n === 1) state.bold = true;
			else if (n === 2) state.dim = true;
			else if (n === 3) state.italic = true;
			else if (n === 4) state.underline = true;
			else if (n === 21 || n === 22) { state.bold = false; state.dim = false; }
			else if (n === 23) state.italic = false;
			else if (n === 24) state.underline = false;
			else if (n >= 30 && n <= 37) state.fg = PALETTE[n - 30];
			else if (n === 39) state.fg = undefined;
			else if (n >= 40 && n <= 47) state.bg = PALETTE[n - 40];
			else if (n === 49) state.bg = undefined;
			else if (n >= 90 && n <= 97) state.fg = `bright-${PALETTE[n - 90]}`;
			else if (n >= 100 && n <= 107) state.bg = `bright-${PALETTE[n - 100]}`;
			else if ((n === 38 || n === 48) && i + 1 < list.length) {
				const mode = parseInt(list[i + 1], 10);
				if (mode === 5 && i + 2 < list.length) {
					const color = ansi256ToRgb(parseInt(list[i + 2], 10) || 0);
					if (n === 38) state.fg = color || undefined;
					else state.bg = color || undefined;
					i += 2;
				} else if (mode === 2 && i + 4 < list.length) {
					const rgb = `rgb(${list[i + 2]}, ${list[i + 3]}, ${list[i + 4]})`;
					if (n === 38) state.fg = rgb;
					else state.bg = rgb;
					i += 4;
				}
			}
		}
	};

	const consume = (chunk: string, out: AnsiSpan[]): void => {
		for (const ch of chunk) {
			if (inEscape) {
				seq += ch;
				if (seq === '\x1b') continue; // bare ESC — wait for its partner
				if (seq === '\x1b[') continue; // CSI opened — wait for params + final
				if (seq === '\x1b]') { inOsc = true; continue; }
				if (inOsc) {
					if (ch === '\x07') {
						// BEL terminator.
					} else if (ch === '\\') {
						if (!seq.endsWith('\x1b\\')) continue; // stray backslash — OSC body
					} else if (ch === '\x1b') {
						continue; // maybe the ST opener — the next char decides
					} else {
						continue; // OSC body
					}
					inEscape = false;
					inOsc = false;
					seq = '';
					continue;
				}
				if (seq.length === 2) {
					// Two-char escape (ESC 7, ESC c, ESC ( …) — ignore whole.
					// A '(' or ')' pulls in its designating byte first.
					if (ch === '(' || ch === ')') continue;
					inEscape = false;
					seq = '';
					continue;
				}
				// CSI body — done at the final byte 0x40–0x7E.
				if (ch >= '@' && ch <= '~') {
					// slice(2, -1): params only — the final byte is not a parameter.
					if (ch === 'm') applySgr(seq.slice(2, -1));
					inEscape = false;
					seq = '';
				}
				continue;
			}
			if (ch === '\x1b') {
				emit(out);
				inEscape = true;
				inOsc = false;
				seq = '\x1b';
				continue;
			}
			buf += ch;
		}
	};

	return {
		push(chunk: string): AnsiSpan[] {
			const out: AnsiSpan[] = [];
			consume(chunk, out);
			return out;
		},
		flush(): AnsiSpan[] {
			const out: AnsiSpan[] = [];
			emit(out);
			// A sequence still open at flush is garbage by definition — drop it.
			seq = '';
			inEscape = false;
			inOsc = false;
			return out;
		},
	};
}
