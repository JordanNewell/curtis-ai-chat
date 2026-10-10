// Autocomplete controller race-condition tests.
//
// These encode the mitigation promises from the feature scope: a stale
// response must never render, whatever produced the staleness (typing,
// undo, accept, dismiss, timeout, dispose). All timing is virtual.
//
// Fixture note: prefixes end with a ≥4-char post-whitespace burst so they
// clear the default minChars gate ('hello worl' → burst 'worl' = 4).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutocompleteController, type AutocompleteDeps, type CompletionOutcome } from './controller';

interface Deferred<T> {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (err: unknown) => void;
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (err: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/** Harness: fake deps with recording + manual resolution of requests. */
function makeHarness(opts?: { prefix?: () => string; context?: () => string }) {
	const shown: string[] = [];
	const notices: string[] = [];
	const requests: Array<{ prefix: string; suffix: string; deferred: Deferred<CompletionOutcome> }> = [];
	let ctx: string = opts?.context ? opts.context() : 'p|m';

	const deps: AutocompleteDeps = {
		execute: (prefix, suffix) => {
			const d = deferred<CompletionOutcome>();
			requests.push({ prefix, suffix, deferred: d });
			return d.promise;
		},
		currentPrefix: opts?.prefix ?? (() => ''),
		currentSuffix: () => '',
		context: () => ctx,
		show: (text) => shown.push(text),
		notify: (message) => notices.push(message),
	};
	return {
		deps,
		shown,
		notices,
		requests,
		setContext: (c: string) => { ctx = c; },
		last: () => requests[requests.length - 1],
	};
}

const resolveWith = (d: Deferred<CompletionOutcome>, text: string): void => {
	d.resolve({ text, tokens: 10 });
};

/** Drain the microtask queue so resolved request handlers have run. */
const flush = async (): Promise<void> => {
	for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('AutocompleteController — request lifecycle', () => {
	it('debounces: nothing fires or shows before the debounce elapses', async () => {
		const h = makeHarness({ prefix: () => 'the quick brown' });
		const c = new AutocompleteController(h.deps);
		c.schedule('the quick brown', '');
		vi.advanceTimersByTime(400);
		expect(h.requests).toHaveLength(0);
		vi.advanceTimersByTime(100);
		expect(h.requests).toHaveLength(1);
		resolveWith(h.last().deferred, ' fox');
		await flush();
		expect(h.shown).toEqual([' fox']);
	});

	it('respects minChars — a short burst never fires', async () => {
		const h = makeHarness();
		const c = new AutocompleteController(h.deps);
		c.schedule('the ', ''); // burst after whitespace = 0
		vi.advanceTimersByTime(1000);
		expect(h.requests).toHaveLength(0);
		c.schedule('the quic', ''); // burst = 4
		vi.advanceTimersByTime(1000);
		expect(h.requests).toHaveLength(1);
	});

	it('cache serves a repeat prefix without a second request', async () => {
		const h = makeHarness({ prefix: () => 'hello worl' });
		const c = new AutocompleteController(h.deps);
		c.schedule('hello worl', '');
		vi.advanceTimersByTime(1000);
		resolveWith(h.last().deferred, 'd');
		await flush();
		expect(h.shown).toEqual(['d']);
		c.schedule('hello worl', '');
		vi.advanceTimersByTime(1000);
		expect(h.requests).toHaveLength(1);
		expect(h.shown).toEqual(['d', 'd']);
	});

	it('a context (model) switch invalidates cached entries', async () => {
		const h = makeHarness({ prefix: () => 'hello worl' });
		const c = new AutocompleteController(h.deps);
		c.schedule('hello worl', '');
		vi.advanceTimersByTime(1000);
		resolveWith(h.last().deferred, 'd');
		await flush();
		h.setContext('p|m2');
		c.schedule('hello worl', '');
		vi.advanceTimersByTime(1000);
		expect(h.requests).toHaveLength(2);
	});
});

describe('AutocompleteController — staleness races', () => {
	it('drops a response that lands after the user typed more', async () => {
		const h = makeHarness();
		let live = 'hello worl';
		h.deps.currentPrefix = () => live;
		const c = new AutocompleteController(h.deps);
		c.schedule('hello worl', '');
		vi.advanceTimersByTime(1000);
		const first = h.last();
		// User keeps typing while the request is in flight.
		live = 'hello world';
		c.schedule('hello world', '');
		vi.advanceTimersByTime(1000);
		// Second fire aborted the first flight…
		expect(h.requests).toHaveLength(2);
		// …and even if the first response lands anyway, it must not render.
		resolveWith(first.deferred, ' response');
		await flush();
		resolveWith(h.last().deferred, '!');
		await flush();
		expect(h.shown).toEqual(['!']);
	});

	it('drops a response after an undo changed the prefix (snapshot check)', async () => {
		const h = makeHarness();
		let live = 'some draft text';
		h.deps.currentPrefix = () => live;
		const c = new AutocompleteController(h.deps);
		c.schedule('some draft text', '');
		vi.advanceTimersByTime(1000);
		const d = h.last().deferred;
		live = ''; // undo everything
		resolveWith(d, ' continues');
		await flush();
		expect(h.shown).toEqual([]);
	});

	it('accept suppresses the instant re-fire the insertion causes', async () => {
		const h = makeHarness();
		let live = 'hello worl';
		h.deps.currentPrefix = () => live;
		const c = new AutocompleteController(h.deps);
		c.schedule('hello worl', '');
		vi.advanceTimersByTime(1000);
		resolveWith(h.last().deferred, 'd there');
		await flush();
		live = 'hello world there';
		c.accept(live);
		// The insertion itself triggers a new keystroke cycle with the same text.
		c.schedule(live, '');
		vi.advanceTimersByTime(1000);
		expect(h.requests).toHaveLength(1);
		expect(h.shown).toEqual(['d there']); // only the original ghost
		// Typing a fresh word re-arms suggestions.
		live = live + ' more';
		c.schedule(live, '');
		vi.advanceTimersByTime(1000);
		expect(h.requests).toHaveLength(2);
	});

	it('dismiss (Escape) keeps the ghost down until the text changes', async () => {
		const h = makeHarness({ prefix: () => 'hello worl' });
		const c = new AutocompleteController(h.deps);
		c.schedule('hello worl', '');
		vi.advanceTimersByTime(1000);
		resolveWith(h.last().deferred, 'd');
		await flush();
		c.dismiss('hello worl');
		// The same prefix scheduled again (e.g. editor re-render) stays hidden.
		c.schedule('hello worl', '');
		vi.advanceTimersByTime(1000);
		expect(h.requests).toHaveLength(1);
		expect(h.shown).toEqual(['d']);
	});

	it('a request that times out aborts silently and a late reply never renders', async () => {
		const h = makeHarness({ prefix: () => 'hello worl' });
		const c = new AutocompleteController(h.deps);
		c.schedule('hello worl', '');
		vi.advanceTimersByTime(1000);
		const d = h.last().deferred;
		// Past the timeout the request is aborted…
		vi.advanceTimersByTime(5000);
		expect(h.shown).toEqual([]);
		// …so the late resolution must not render.
		resolveWith(d, ' late');
		await flush();
		expect(h.shown).toEqual([]);
	});

	it('dispose aborts the in-flight request and drops everything', async () => {
		const h = makeHarness({ prefix: () => 'hello worl' });
		const c = new AutocompleteController(h.deps);
		c.schedule('hello worl', '');
		vi.advanceTimersByTime(1000);
		const d = h.last().deferred;
		c.dispose();
		resolveWith(d, ' after dispose');
		await flush();
		expect(h.shown).toEqual([]); // aborted, not rendered
		// A controller is done after dispose — but if something schedules on it
		// anyway, it starts cleanly rather than leaking aborted state.
		c.schedule('hello worl', '');
		vi.advanceTimersByTime(1000);
		expect(h.requests).toHaveLength(2);
		expect(h.shown).toEqual([]);
	});

	it('an empty completion never renders', async () => {
		const h = makeHarness({ prefix: () => 'hello worl' });
		const c = new AutocompleteController(h.deps);
		c.schedule('hello worl', '');
		vi.advanceTimersByTime(1000);
		resolveWith(h.last().deferred, '');
		await flush();
		expect(h.shown).toEqual([]);
	});
});

describe('AutocompleteController — cost guards', () => {
	it('throttles to maxPerMinute real requests', async () => {
		const h = makeHarness();
		const c = new AutocompleteController(h.deps, { maxPerMinute: 2, minChars: 1 });
		for (let i = 1; i <= 3; i++) {
			c.schedule('x'.repeat(i * 10), '');
			vi.advanceTimersByTime(1000);
		}
		expect(h.requests).toHaveLength(2);
		// Window slides — an hour later the throttle is clear again.
		vi.advanceTimersByTime(60 * 60 * 1000);
		c.schedule('y'.repeat(40), '');
		vi.advanceTimersByTime(1000);
		expect(h.requests).toHaveLength(3);
	});

	it('a provider failure opens the cooldown and notifies once', async () => {
		const h = makeHarness({ prefix: () => 'hello worl' });
		const c = new AutocompleteController(h.deps);
		c.schedule('hello worl', '');
		vi.advanceTimersByTime(1000);
		h.last().deferred.reject(new Error('API error (500): boom'));
		await flush();
		expect(h.notices).toHaveLength(1);
		// Inside the cooldown: no further requests.
		c.schedule('hello worlx', '');
		vi.advanceTimersByTime(1000);
		expect(h.requests).toHaveLength(1);
		// Cooldown elapsed: requests resume.
		vi.advanceTimersByTime(60_000);
		c.schedule('hello worlxy', '');
		vi.advanceTimersByTime(1000);
		expect(h.requests).toHaveLength(2);
	});

	it('a 429 doubles the cooldown', async () => {
		const h = makeHarness({ prefix: () => 'hello worl' });
		const c = new AutocompleteController(h.deps);
		c.schedule('hello worl', '');
		vi.advanceTimersByTime(1000);
		h.last().deferred.reject(new Error('API error (429): slow down'));
		await flush();
		vi.advanceTimersByTime(60_000);
		c.schedule('hello worlx', '');
		vi.advanceTimersByTime(1000);
		expect(h.requests).toHaveLength(1); // still cooling
		vi.advanceTimersByTime(60_000);
		c.schedule('hello worlxy', '');
		vi.advanceTimersByTime(1000);
		expect(h.requests).toHaveLength(2);
	});

	it('cache hits do not consume throttle budget', async () => {
		const h = makeHarness({ prefix: () => 'aaaa' });
		const c = new AutocompleteController(h.deps, { maxPerMinute: 1, minChars: 1 });
		c.schedule('aaaa', '');
		vi.advanceTimersByTime(1000);
		resolveWith(h.last().deferred, '!');
		await flush();
		// Same prefix again — served from cache even though the throttle window
		// is exhausted.
		c.schedule('aaaa', '');
		vi.advanceTimersByTime(1000);
		expect(h.requests).toHaveLength(1);
		expect(h.shown).toEqual(['!', '!']);
	});
});
