// GCP Storage client tests — bucket/object listing, the readObject text vs
// binary vs oversized policy, 401 token invalidation, and API error
// mapping. Runs under node: storage.ts is Obsidian-free (injected sender +
// token callbacks), so a routing fake stands in for Google's API.

import { describe, expect, it } from 'vitest';
import { StorageClient, formatBytes, isTextLike } from './storage';
import type { HttpSendRequest, HttpSendResponse } from './http';

interface Harness {
	client: StorageClient;
	requests: HttpSendRequest[];
	tokensMinted: number;
	invalidations: number;
}

/** Build a client whose sender answers every request via `route`. Tokens
 *  mint as tok-1, tok-2, … and cache like the real GcpTokenSource (until
 *  invalidateToken), so 401-retry assertions can pin exact headers. */
function makeHarness(route: (req: HttpSendRequest) => Partial<HttpSendResponse>): Harness {
	const requests: HttpSendRequest[] = [];
	let tokensMinted = 0;
	let invalidations = 0;
	let cachedToken = '';
	const client = new StorageClient({
		getToken: async () => cachedToken || (cachedToken = `tok-${++tokensMinted}`),
		invalidateToken: () => {
			invalidations++;
			cachedToken = '';
		},
		sender: async (req) => {
			requests.push(req);
			return { status: 200, text: '', ...route(req) };
		},
	});
	return { client, requests, get tokensMinted() { return tokensMinted; }, get invalidations() { return invalidations; } };
}

function metadataResponse(contentType: string, size: number | string): Partial<HttpSendResponse> {
	return { text: JSON.stringify({ name: 'obj', contentType, size: String(size) }) };
}

describe('formatBytes + isTextLike', () => {
	it('formats human sizes', () => {
		expect(formatBytes(0)).toBe('0 B');
		expect(formatBytes(42)).toBe('42 B');
		expect(formatBytes(2048)).toBe('2.0 KB');
		expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
	});

	it('classifies content types', () => {
		expect(isTextLike('text/plain')).toBe(true);
		expect(isTextLike('application/json')).toBe(true);
		expect(isTextLike('application/x-yaml')).toBe(true);
		expect(isTextLike('image/png')).toBe(false);
		expect(isTextLike('application/octet-stream')).toBe(false);
	});
});

describe('listBuckets', () => {
	it('formats one bucket per line with the next-page hint', async () => {
		const h = makeHarness((req) => {
			expect(req.url).toContain('project=my-project');
			return {
				text: JSON.stringify({
					items: [{ name: 'curtis-notes', location: 'US' }, { name: 'curtis-media' }],
					nextPageToken: 'PAGE2',
				}),
			};
		});
		const out = await h.client.listBuckets('my-project');
		expect(out).toContain('Buckets in project "my-project" (2):');
		expect(out).toContain('- gs://curtis-notes (US)');
		expect(out).toContain('- gs://curtis-media');
		expect(out).toContain('pageToken "PAGE2"');
	});

	it('reports an empty project without a page hint', async () => {
		const h = makeHarness(() => ({ text: JSON.stringify({ items: [] }) }));
		const out = await h.client.listBuckets('empty-project');
		expect(out).toContain('No buckets found in project "empty-project"');
		expect(out).not.toContain('pageToken');
	});

	it('clamps maxResults into the API-legal range', async () => {
		let seen = '';
		const h = makeHarness((req) => {
			seen = req.url;
			return { text: JSON.stringify({ items: [] }) };
		});
		await h.client.listBuckets('p', { maxResults: 9999 });
		expect(seen).toContain('maxResults=100');
	});
});

describe('listObjects', () => {
	it('encodes the prefix and formats rows', async () => {
		let seen = '';
		const h = makeHarness((req) => {
			seen = req.url;
			return {
				text: JSON.stringify({
					items: [
						{ name: 'reports/2026/q1.csv', size: '1024', contentType: 'text/csv' },
						{ name: 'reports/2026/summary.json', size: '512', contentType: 'application/json' },
					],
				}),
			};
		});
		const out = await h.client.listObjects('curtis-notes', { prefix: 'reports/2026/' });
		expect(seen).toContain(encodeURIComponent('reports/2026/'));
		expect(out).toContain('Objects in gs://curtis-notes under prefix "reports/2026/" (2):');
		expect(out).toContain('- reports/2026/q1.csv — 1.0 KB, text/csv');
	});

	it('reports an empty listing', async () => {
		const h = makeHarness(() => ({ text: JSON.stringify({}) }));
		const out = await h.client.listObjects('b');
		expect(out).toContain('No objects found in gs://b');
	});
});

describe('readObject', () => {
	it('inlines text-like objects after a metadata check', async () => {
		const h = makeHarness((req) => {
			if (req.url.includes('alt=media')) return { text: 'quarter 1 looks great' };
			return metadataResponse('text/csv', 21);
		});
		const out = await h.client.readObject('curtis-notes', 'reports/q1.csv');
		expect(out).toContain('reports/q1.csv (text/csv, 21 B):');
		expect(out).toContain('quarter 1 looks great');
		// Metadata first, media second — both carry the bearer token.
		expect(h.requests.length).toBe(2);
		expect(h.requests[0].headers['Authorization']).toBe('Bearer tok-1');
		expect(h.requests[1].url).toContain('alt=media');
	});

	it('returns a descriptor for binaries without downloading them', async () => {
		const h = makeHarness(() => metadataResponse('image/png', 4096));
		const out = await h.client.readObject('b', 'pic.png');
		expect(out).toContain('[binary object: pic.png — image/png, 4.0 KB, gs://b/pic.png');
		expect(h.requests.length).toBe(1); // metadata only — no media GET
	});

	it('refuses to buffer oversized text objects', async () => {
		const h = makeHarness(() => metadataResponse('text/plain', 10 * 1024 * 1024));
		const out = await h.client.readObject('b', 'huge.log');
		expect(out).toContain('object too large to read inline');
		expect(h.requests.length).toBe(1);
	});

	it('truncates long text with a note', async () => {
		const h = makeHarness((req) => {
			if (req.url.includes('alt=media')) return { text: 'x'.repeat(100) };
			return metadataResponse('text/plain', 100);
		});
		const out = await h.client.readObject('b', 'log.txt', { maxChars: 10 });
		expect(out).toContain('xxxxxxxxxx');
		expect(out).toContain('[truncated at 10 characters');
	});

	it('mints a fresh token and retries once on 401', async () => {
		let mediaCalls = 0;
		const h = makeHarness((req) => {
			if (req.url.includes('alt=media')) {
				mediaCalls++;
				// First media attempt carries the stale token — refuse it.
				if (req.headers['Authorization'] === 'Bearer tok-1') return { status: 401, text: 'unauthorized' };
				return { text: 'fresh data' };
			}
			return metadataResponse('text/plain', 10);
		});
		const out = await h.client.readObject('b', 'doc.txt');
		expect(out).toContain('fresh data');
		expect(mediaCalls).toBe(2);
		expect(h.invalidations).toBe(1);
		expect(h.tokensMinted).toBeGreaterThanOrEqual(2);
	});

	it('throws Google\'s error message on API failures', async () => {
		const h = makeHarness(() => ({
			status: 404,
			text: JSON.stringify({ error: { code: 404, message: 'No such object: b/nope.txt' } }),
		}));
		await expect(h.client.readObject('b', 'nope.txt')).rejects.toThrow(/No such object: b\/nope\.txt/);
	});

	it('maps 403 to a roles-oriented message', async () => {
		const h = makeHarness(() => ({ status: 403, text: 'forbidden' }));
		await expect(h.client.readObject('b', 'x.txt')).rejects.toThrow(/roles/);
	});
});
