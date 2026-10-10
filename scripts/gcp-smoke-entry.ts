// GCP connector smoke test entry — bundled with esbuild (obsidian → stub)
// and run under node against the fake Google in gcp-smoke.mjs.
//
// Exercises the real wire path end-to-end: service-account JSON parsing,
// RS256 JWT signing verified server-side by the fake token endpoint, the
// token exchange, the manager's connect → connected status, tool
// projection, all three storage tools (including the project-id fallback
// to the key's project_id and the URL-encoded prefix), the binary-descriptor
// path, the 401 → invalidate → re-mint → retry recovery, and Google error
// mapping through ToolRegistry-style thrown errors.

import { strict as assert } from 'node:assert/strict';
import { GcpManager } from '../src/gcp/manager';
import type { ToolRegistry } from '../src/core/tools';
import type { HttpSender } from '../src/gcp/http';

// Node has no `window`; production code uses window timers (obsidianmd lint).
// Same functions, same global — alias before any client code runs.
if (typeof window === 'undefined') {
	(globalThis as unknown as { window: unknown }).window = globalThis;
}

const port = Number(process.env.GCP_SMOKE_PORT || 0);
if (!port) throw new Error('GCP_SMOKE_PORT not set (gcp-smoke.mjs assigns one)');
const serviceAccountJson = Buffer.from(process.env.GCP_SMOKE_SA || '', 'base64').toString('utf8');

const sender: HttpSender = async (req) => {
	// The client code builds real googleapis.com URLs; the smoke redirects
	// them to the local fake Google at the transport seam.
	const url = req.url.replace('https://storage.googleapis.com', `http://127.0.0.1:${port}`);
	const resp = await fetch(url, {
		method: req.method,
		headers: req.headers,
		body: req.body,
	});
	return { status: resp.status, text: await resp.text() };
};

interface RecordedRequest {
	path: string;
	query: Record<string, string>;
	authorization: string;
}

async function recordedRequests(): Promise<RecordedRequest[]> {
	const resp = await fetch(`http://127.0.0.1:${port}/__requests`);
	const body = (await resp.json()) as { requests: RecordedRequest[] };
	return body.requests;
}

async function expireTokens(): Promise<void> {
	await fetch(`http://127.0.0.1:${port}/__expire`, { method: 'POST' });
}

async function main(): Promise<void> {
	// Settings project id is EMPTY on purpose — the manager must fall back to
	// the key's own project_id ('smoke-project') for bucket listing.
	const manager = new GcpManager({
		isEnabled: () => true,
		getServiceAccountJson: () => serviceAccountJson,
		getProjectId: () => '',
		sender,
	});

	// Tool projection before connect: the slice must be empty.
	assert.deepEqual(manager.getToolDefinitions(), []);

	await manager.connect();
	const status = manager.statusOf();
	assert.equal(status.state, 'connected', `expected connected, got: ${JSON.stringify(status)}`);
	assert.ok((status.tokenExpiresAt ?? 0) > Date.now(), 'tokenExpiresAt should be in the future');

	// Tool projection after connect: exactly the three storage tools.
	assert.deepEqual(
		manager.getToolDefinitions().map((t) => t.name).sort(),
		['gcp__storage__list_buckets', 'gcp__storage__list_objects', 'gcp__storage__read_object'],
	);

	// syncTools replaces a registry slice; disconnect must clear it again.
	let captured: string[] = [];
	const fakeRegistry = {
		setGcpTools: (defs: Array<{ name: string }>) => { captured = defs.map((d) => d.name); },
	} as unknown as ToolRegistry;
	manager.syncTools(fakeRegistry);
	assert.equal(captured.length, 3);

	// list_buckets — project id fell back to the key's project_id.
	const buckets = await manager.callTool('gcp__storage__list_buckets', {});
	assert.match(buckets, /Buckets in project "smoke-project"/);
	assert.match(buckets, /gs:\/\/smoke-bucket \(US\)/);
	assert.match(buckets, /gs:\/\/smoke-media \(EU\)/);

	// list_objects with a prefix — encoded on the wire, decoded server-side.
	const objects = await manager.callTool('gcp__storage__list_objects', { bucket: 'smoke-bucket', prefix: 'reports/2026/' });
	assert.match(objects, /reports\/2026\/q1\.csv — 21 B, text\/csv/);
	assert.match(objects, /reports\/2026\/summary\.json/);
	assert.doesNotMatch(objects, /pic\.png/);
	const requests = await recordedRequests();
	const listReq = requests.find((r) => r.path === '/storage/v1/b/smoke-bucket/o');
	assert.ok(listReq, 'object listing request not recorded');
	assert.equal(listReq.query.prefix, 'reports/2026/');
	assert.match(listReq.authorization, /^Bearer tok-/);

	// read_object, text path — metadata first, then the media GET.
	const text = await manager.callTool('gcp__storage__read_object', { bucket: 'smoke-bucket', object: 'reports/q1.csv' });
	assert.match(text, /reports\/q1\.csv \(text\/csv, 21 B\):/);
	assert.match(text, /quarter 1 looks great/);

	// read_object, binary path — descriptor only, no media download.
	const binary = await manager.callTool('gcp__storage__read_object', { bucket: 'smoke-bucket', object: 'media/pic.png' });
	assert.match(binary, /\[binary object: media\/pic\.png — image\/png, 4\.0 KB, gs:\/\/smoke-bucket\/media\/pic\.png/);
	assert.ok(!requests.some((r) => r.path.includes('alt=media') && r.path.includes('pic.png')), 'binary media must not be downloaded');

	// 401 → invalidate → fresh token → retry. Expire generation 1; the next
	// call must transparently recover without surfacing an error.
	await expireTokens();
	const afterExpiry = await manager.callTool('gcp__storage__read_object', { bucket: 'smoke-bucket', object: 'reports/q1.csv' });
	assert.match(afterExpiry, /quarter 1 looks great/);
	assert.equal(manager.statusOf().state, 'connected');

	// Google error mapping — a missing object throws Google's message
	// (ToolRegistry.executeTool turns that into an is_error tool result).
	await assert.rejects(
		() => manager.callTool('gcp__storage__read_object', { bucket: 'smoke-bucket', object: 'nope.txt' }),
		/No such object: smoke-bucket\/nope\.txt/,
	);

	// Unknown tool name → hard error.
	await assert.rejects(
		() => manager.callTool('gcp__storage__write_object', {}),
		/Unknown GCP tool/,
	);

	// Disconnect clears the projection via onToolsChanged.
	let changed = 0;
	manager.onToolsChanged = () => { changed++; };
	await manager.disconnect();
	assert.deepEqual(manager.getToolDefinitions(), []);
	assert.equal(manager.statusOf().state, 'disconnected');
	assert.ok(changed >= 1, 'disconnect must fire onToolsChanged');

	// Reconnect from the same settings — the refresh path (settings button).
	const refreshed = await manager.refresh();
	assert.equal(refreshed.state, 'connected');

	console.log('GCP smoke test: all assertions passed');
}

main().catch((e) => {
	console.error('GCP smoke test FAILED:', e);
	process.exit(1);
});
