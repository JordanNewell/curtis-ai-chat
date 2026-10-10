// Autocomplete controller — pure orchestration, zero Obsidian/CodeMirror
// imports so the race cases are unit-testable without an editor.
//
// The correctness core is the snapshot check: a response may only render
// when the text that produced it still matches the text at the cursor.
// Every race — a reply landing after further typing, undo mid-flight,
// a late buffered payload — reduces to "prefix changed", so one equality
// check retires them all. Abort is an optimization (saves tokens), never
// the correctness mechanism.

export interface CompletionOutcome {
	text: string;
	/** Total tokens the request cost, as reported by the provider. */
	tokens: number;
}

export interface AutocompleteDeps {
	/** Execute the request. Rejects on provider/transport failure. */
	execute: (prefix: string, suffix: string, signal: AbortSignal) => Promise<CompletionOutcome>;
	/** Text before the cursor right now. Truncated request prefixes compare
	 *  via endsWith, so return the full pre-cursor text. */
	currentPrefix: () => string;
	/** Text after the cursor right now. Pins the ghost to the request's
	 *  position: identical tail text at a different cursor spot must not
	 *  inherit the other spot's suggestion. */
	currentSuffix: () => string;
	/** Cache-busting context (provider|model). A model switch must not serve
	 *  the previous model's cached ghost. */
	context: () => string;
	/** Render a suggestion after the cursor. */
	show: (text: string) => void;
	/** User-facing one-liner — only fired when the circuit breaker opens. */
	notify: (message: string) => void;
}

export interface AutocompleteConfig {
	debounceMs: number;
	/** Chars since the last whitespace before a request fires. Whitespace-
	 *  agnostic by design: CJK text has no spaces, so any 4 CJK chars qualify. */
	minChars: number;
	prefixChars: number;
	suffixChars: number;
	cacheSize: number;
	maxPerMinute: number;
	failureCooldownMs: number;
	timeoutMs: number;
}

export const DEFAULT_AUTOCOMPLETE_CONFIG: AutocompleteConfig = {
	debounceMs: 500,
	minChars: 4,
	prefixChars: 2000,
	suffixChars: 300,
	cacheSize: 50,
	maxPerMinute: 20,
	failureCooldownMs: 60_000,
	timeoutMs: 5000,
};

/** Schedule + gate + execute + verify. One instance per editor. */
export class AutocompleteController {
	private readonly deps: AutocompleteDeps;
	private readonly cfg: AutocompleteConfig;

	private timer: ReturnType<typeof setTimeout> | null = null;
	private pending: { prefix: string; suffix: string } | null = null;
	private inFlight: { prefix: string; abort: AbortController; timeout: ReturnType<typeof setTimeout> } | null = null;
	/** LRU: most-recent entry re-inserted on hit; oldest evicted at capacity. */
	private readonly cache = new Map<string, string>();
	private requestTimes: number[] = [];
	private cooldownUntil = 0;
	/** Prefix the user dismissed (Escape) or just accepted — a repeat fire for
	 *  the identical prefix is suppressed so the ghost can't resurrect itself.
	 *  Cleared by the next keystroke that changes the prefix. */
	private dismissedPrefix: string | null = null;

	constructor(deps: AutocompleteDeps, config?: Partial<AutocompleteConfig>) {
		this.deps = deps;
		this.cfg = { ...DEFAULT_AUTOCOMPLETE_CONFIG, ...config };
	}

	/** Called on every qualifying keystroke. Debounces, then fires. */
	schedule(prefix: string, suffix: string): void {
		if (!this.matchesDismissed(prefix)) this.dismissedPrefix = null;
		this.pending = { prefix, suffix };
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			this.timer = null;
			this.fire();
		}, this.cfg.debounceMs);
	}

	/** Escape pressed — never re-show this prefix until the text changes.
	 *  Pass the FULL pre-cursor text; scheduled prefixes are truncated, and
	 *  the suffix-of comparison below absorbs that difference. */
	dismiss(currentPrefix: string): void {
		this.dismissedPrefix = currentPrefix;
		this.abortInFlight();
	}

	/** Suggestion accepted. `newPrefix` is the full pre-cursor text including
	 *  the inserted completion — suppresses the instant re-fire the insertion
	 *  would otherwise trigger (burst length is already ≥ minChars there). */
	accept(newPrefix: string): void {
		this.dismissedPrefix = newPrefix;
		this.abortInFlight();
	}

	/** Editor destroyed or feature toggled off — drop all pending state. */
	dispose(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		this.pending = null;
		this.abortInFlight();
		this.cache.clear();
	}

	private fire(): void {
		const req = this.pending;
		if (!req) return;
		const now = Date.now();
		if (this.cooldownUntil > now) return;
		if (this.matchesDismissed(req.prefix)) return;
		if (burstLength(req.prefix) < this.cfg.minChars) return;

		const key = cacheKey(this.deps.context(), req.prefix);
		const cached = this.cache.get(key);
		if (cached !== undefined) {
			// Re-insert to mark recency (Map iteration order = LRU order).
			this.cache.delete(key);
			this.cache.set(key, cached);
			this.deps.show(cached);
			return;
		}
		if (!this.throttleAllows(now)) return;

		this.abortInFlight();
		const abort = new AbortController();
		const timeout = setTimeout(() => abort.abort(), this.cfg.timeoutMs);
		this.inFlight = { prefix: req.prefix, abort, timeout };

		void this.deps.execute(req.prefix, req.suffix, abort.signal).then(
			(outcome) => {
				if (abort.signal.aborted) return;
				// Snapshot check — the load-bearing guard. Covers typing past the
				// request, undo, and any doc mutation elsewhere. The suffix pins
				// the position when identical tail text exists at two spots.
				if (!this.deps.currentPrefix().endsWith(req.prefix)) return;
				if (!this.deps.currentSuffix().startsWith(req.suffix)) return;
				if (!outcome.text) return;
				this.cacheSet(key, outcome.text);
				this.deps.show(outcome.text);
			},
			(err: unknown) => {
				if (abort.signal.aborted) return;
				this.openCooldown(err);
			}
		).finally(() => {
			clearTimeout(timeout);
			if (this.inFlight?.abort === abort) this.inFlight = null;
		});
	}

	private abortInFlight(): void {
		if (!this.inFlight) return;
		clearTimeout(this.inFlight.timeout);
		this.inFlight.abort.abort();
		this.inFlight = null;
	}

	/** True while `prefix` is the tail of the dismissed/accepted text — i.e.
	 *  nothing new has been typed since the dismissal. Comparison direction
	 *  matters: the dismissed text is untruncated, scheduled prefixes are not,
	 *  so the scheduled (shorter) side must be the needle. */
	private matchesDismissed(prefix: string): boolean {
		const dismissed = this.dismissedPrefix;
		return dismissed !== null && dismissed.endsWith(prefix);
	}

	/** Any provider failure silences suggestions for the cooldown window —
	 *  rate-limit rejections (429) get double, hedging toward the Retry-After
	 *  behavior we can't read off the wrapped transport errors. */
	private openCooldown(err: unknown): void {
		const msg = err instanceof Error ? err.message : String(err);
		const multiplier = msg.includes('429') ? 2 : 1;
		this.cooldownUntil = Date.now() + this.cfg.failureCooldownMs * multiplier;
		this.deps.notify(
			multiplier > 1
				? 'Curtis autocomplete paused for 2 minutes (provider rate limit).'
				: 'Curtis autocomplete paused for a minute (provider error).'
		);
	}

	private throttleAllows(now: number): boolean {
		this.requestTimes = this.requestTimes.filter((t) => now - t < 60_000);
		if (this.requestTimes.length >= this.cfg.maxPerMinute) return false;
		this.requestTimes.push(now);
		return true;
	}

	private cacheSet(key: string, text: string): void {
		if (this.cache.size >= this.cfg.cacheSize) {
			const oldest = this.cache.keys().next();
			if (oldest.done !== true) this.cache.delete(oldest.value);
		}
		this.cache.set(key, text);
	}
}

/** Chars since the last whitespace, scanning back from the end. Capped so a
 *  spaceless 10k-char CJK paragraph costs the same as a long English word. */
export function burstLength(prefix: string): number {
	let n = 0;
	for (let i = prefix.length - 1; i >= 0 && n < 64; i--) {
		if (/\s/.test(prefix[i])) break;
		n++;
	}
	return n;
}

/** djb2 — deterministic, cheap, no crypto dependency; collisions only risk
 *  serving a stale ghost for a different prefix of equal hash, which the
 *  snapshot check then independently verifies. */
function cacheKey(context: string, prefix: string): string {
	let h = 5381;
	for (let i = 0; i < prefix.length; i++) {
		h = ((h << 5) + h + prefix.charCodeAt(i)) | 0;
	}
	return `${context}\u0000${(h >>> 0).toString(36)}`;
}
