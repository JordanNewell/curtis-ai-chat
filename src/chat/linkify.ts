// Link helpers — pure string logic, Obsidian-free so the unit tests run
// under node. The DOM wiring lives in message-renderer.ts.

/** A candidate vault-note reference found in plain text. */
export interface PathCandidate {
	/** The contiguous span to wrap in a link, e.g. "Projects/Ideas.md". */
	text: string;
	/** Offset of the span inside the scanned string. */
	start: number;
}

export interface ResolvedPath extends PathCandidate {
	/** The vault path the candidate resolved to. */
	path: string;
}

// One or more '/'-separated segments ending in '.md'. Letters, numbers, and
// the punctuation vault filenames realistically contain (spaces, dashes,
// parens, dots, commas, ampersands, apostrophes, '+'). Greedy on purpose —
// a match may swallow surrounding prose, which candidatesFromMatch trims.
const VAULT_PATH_RE = /(?:[\p{L}\p{N}][\p{L}\p{N} _\-()',.&+]*\/)*[\p{L}\p{N}][\p{L}\p{N} _\-()',.&+]*\.md/gu;

/**
 * Find plausible vault-note references in a plain-text string. Deliberately
 * generous — callers verify each candidate against the real vault index and
 * drop unknown paths, so a false positive only costs one lookup.
 */
export function findVaultPathCandidates(text: string): PathCandidate[] {
	const out: PathCandidate[] = [];
	for (const m of text.matchAll(VAULT_PATH_RE)) {
		for (const c of candidatesFromMatch(m[0], m.index ?? 0)) {
			// Reject candidates glued into a larger token: an email local part
			// ("a@notes.md"), mid-word ("notes.mdx"), or a trailing slash
			// ("notes.md/x"). URL-internal candidates are allowed through —
			// bare URLs are autolinked before this runs, and resolution drops
			// anything the vault doesn't actually have.
			const prev = c.start > 0 ? text[c.start - 1] : '';
			if (/[\w:.@#]/.test(prev)) continue;
			const next = text[c.start + c.text.length] ?? '';
			if (/[\w\-/]/.test(next)) continue;
			out.push(c);
		}
	}
	return out;
}

/** Indices at which a word starts inside a path segment. */
function wordStarts(seg: string): number[] {
	const starts: number[] = [0];
	for (let i = 1; i < seg.length; i++) {
		if (/\s/.test(seg[i - 1]) && /[\p{L}\p{N}]/u.test(seg[i])) starts.push(i);
	}
	return starts;
}

/**
 * Expand one raw greedy match into candidates. The regex cannot tell where
 * prose ends and a path begins ("I created Projects/Ideas.md" is one match),
 * so each candidate is emitted together with word-boundary suffixes of its
 * first and last segment ("Projects/Ideas.md", "Ideas.md") — resolution
 * picks the variant the vault actually has. A segment containing ".md"
 * before its end means the reference ended there ("…Ideas.md, plus
 * todo.md"): the path is cut and the remainder's final ".md" word kept as
 * one more candidate.
 */
function candidatesFromMatch(raw: string, rawStart: number): PathCandidate[] {
	const out: PathCandidate[] = [];

	const emit = (segs: string[], start: number): void => {
		out.push({ text: segs.join('/'), start });
		const first = segs[0];
		const firstStarts = wordStarts(first);
		for (let k = 1; k < firstStarts.length; k++) {
			out.push({
				text: [first.slice(firstStarts[k]), ...segs.slice(1)].join('/'),
				start: start + firstStarts[k],
			});
		}
		const lastIdx = segs.length - 1;
		if (lastIdx === 0) return; // single segment — the first pass covered it
		const last = segs[lastIdx];
		const lastStarts = wordStarts(last);
		const prefixLen = segs.slice(0, lastIdx).join('/').length + 1;
		for (let k = 1; k < lastStarts.length; k++) {
			// Only the trimmed tail is contiguous in the source text — the
			// folder prefix stays behind. resolveVaultRef's suffix fallback
			// still resolves a bare tail to its full path when unique.
			out.push({
				text: last.slice(lastStarts[k]),
				start: start + prefixLen + lastStarts[k],
			});
		}
	};

	const segments = raw.split('/');
	let current: string[] = [];
	let pathStart = 0; // offset of the open path's first segment, within raw
	let offset = 0; // offset of the segment being inspected, within raw
	for (const seg of segments) {
		const mdIdx = seg.indexOf('.md');
		if (mdIdx !== -1 && mdIdx < seg.length - 3) {
			if (current.length === 0) pathStart = offset;
			current.push(seg.slice(0, mdIdx + 3));
			emit(current, rawStart + pathStart);
			const rest = seg.slice(mdIdx + 3);
			const lastTok = rest.trim().split(/\s+/).pop() ?? '';
			if (lastTok.endsWith('.md') && /[\p{L}\p{N}]/u.test(lastTok[0] ?? '')) {
				emit([lastTok], rawStart + offset + mdIdx + 3 + rest.lastIndexOf(lastTok));
			}
			current = [];
		} else {
			if (current.length === 0) pathStart = offset;
			current.push(seg);
		}
		offset += seg.length + 1; // +1 for the '/'
	}
	if (current.length > 0) emit(current, rawStart + pathStart);
	return out;
}

/**
 * Resolve candidates against the vault's markdown paths, in order. Earlier
 * (longer) candidates win; anything overlapping an already-resolved span is
 * dropped, so a base path and its suffix variants can never both link.
 */
export function resolveCandidates(candidates: PathCandidate[], paths: string[]): ResolvedPath[] {
	const out: ResolvedPath[] = [];
	let coverEnd = -1;
	for (const c of candidates) {
		if (c.start < coverEnd) continue;
		const path = resolveVaultRef(c.text, paths);
		if (!path) continue;
		coverEnd = c.start + c.text.length;
		out.push({ ...c, path });
	}
	return out;
}

/**
 * Resolve one candidate against the vault. Case-insensitive; falls back to
 * a unique folder-suffix match, so "Ideas.md" resolves inside
 * "Projects/Ideas.md" when unambiguous. Unknown or ambiguous → null.
 */
export function resolveVaultRef(candidate: string, paths: string[]): string | null {
	const lower = candidate.toLowerCase();
	for (const p of paths) {
		if (p.toLowerCase() === lower) return p;
	}
	const suffix = `/${lower}`;
	let found: string | null = null;
	for (const p of paths) {
		if (!p.toLowerCase().endsWith(suffix)) continue;
		if (found) return null; // two or more candidates — refuse to guess
		found = p;
	}
	return found;
}

/** Favicon URL for a hostname via DuckDuckGo's icon service. */
export function faviconUrlFor(hostname: string): string {
	return `https://icons.duckduckgo.com/ip3/${hostname}.ico`;
}
