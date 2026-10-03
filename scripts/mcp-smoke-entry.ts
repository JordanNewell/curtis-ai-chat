// MCP client smoke test entry — bundled with esbuild (obsidian → stub) and
// run under node against the local server in mcp-smoke.mjs.
//
// Exercises the real wire code path: initialize handshake + session header
// (+ Authorization header on every request), tools/list pagination,
// SSE-formatted responses, server→client ping replies, response-id
// correlation, non-JSON 2xx bodies, isError results, structuredContent
// fallback, JSON-RPC error mapping, no-tools-capability connects, the
// registry name cap for oversized tool names, and the
// session-expired → re-initialize → retry recovery.

import { strict as assert } from 'node:assert/strict';
import { McpClient, formatToolCallResult, McpTransportError } from '../src/mcp/client';
import { buildMcpToolName, sanitizeServerKey } from '../src/mcp/manager';
import type { HttpSender } from '../src/mcp/transport';

// Node has no `window`; production code uses window timers (obsidianmd lint).
// Same functions, same global — alias before any client code runs.
if (typeof window === 'undefined') {
	(globalThis as unknown as { window: unknown }).window = globalThis;
}

const port = Number(process.env.MCP_SMOKE_PORT || 0);
if (!port) throw new Error('MCP_SMOKE_PORT not set (mcp-smoke.mjs assigns one)');

const AUTH = 'Bearer smoke-token';
// 70 chars — exceeds the 64-char provider function-name limit (server mirrors it).
const OVERSIZED_TOOL = 'oversized_' + 'n'.repeat(60);

const sender: HttpSender = async (req) => {
	const resp = await fetch(req.url, {
		method: req.method,
		headers: req.headers,
		body: req.body,
	});
	const headers: Record<string, string> = {};
	resp.headers.forEach((v, k) => (headers[k] = v));
	return { status: resp.status, headers, text: await resp.text() };
};

/** Poll the control endpoint until the client's pong for `id` is recorded. */
async function pollForPong(id: string, timeoutMs = 2000): Promise<unknown> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const resp = await fetch(`http://127.0.0.1:${port}/__pings`, { headers: { Authorization: AUTH } });
		const body = (await resp.json()) as { pongs: Array<{ id: unknown; result?: unknown }> };
		const match = body.pongs.find((p) => p.id === id);
		if (match) return match.result;
		await new Promise((r) => setTimeout(r, 50));
	}
	throw new Error(`no pong recorded for ping id ${id}`);
}

async function main(): Promise<void> {
	const client = new McpClient({
		url: `http://127.0.0.1:${port}/mcp`,
		headers: { Authorization: AUTH },
		clientVersion: '0.0.0-test',
		sender,
	});

	await client.connect();
	assert.equal(client.serverName, 'smoke-server');
	assert.equal(client.serverVersion, '1.0.0');
	// 7 tools on page one (incl. the oversized name) + 1 on page two.
	assert.deepEqual(client.tools.map((t) => t.name), [
		'echo', 'fail_tool', 'structured', 'pinged_echo', 'wrong_id', 'html_body', OVERSIZED_TOOL, 'tool_b',
	]);

	// Registry-name projection: capped at 64 chars and still unique/resolvable.
	const serverKey = sanitizeServerKey('smoke-server');
	const registryNames = client.tools.map((t) => buildMcpToolName(serverKey, t.name));
	for (const name of registryNames) {
		assert.ok(name.length <= 64, `registry name exceeds 64 chars: ${name}`);
	}
	assert.equal(new Set(registryNames).size, registryNames.length, 'registry names must stay unique');
	assert.ok(buildMcpToolName(serverKey, OVERSIZED_TOOL).includes('oversized_'));

	// Plain text result (multi-block join).
	const echoed = await client.callTool('echo', { msg: 'hi' });
	assert.equal(formatToolCallResult(echoed).text, 'echo:\n\n{"msg":"hi"}');
	assert.equal(formatToolCallResult(echoed).isError, false);

	// The oversized-name tool is still callable under its full server name.
	const long = await client.callTool(OVERSIZED_TOOL, {});
	assert.equal(formatToolCallResult(long).text, `long name ok (${OVERSIZED_TOOL.length} chars)`);

	// SSE-formatted response parses identically to a JSON body.
	const viaSse = await client.callTool('sse_echo', { msg: 'stream' });
	assert.equal(formatToolCallResult(viaSse).text, 'sse echo:\n\n{"msg":"stream"}');

	// Server→client ping riding the response stream must be answered.
	const pinged = await client.callTool('pinged_echo', {});
	assert.equal(formatToolCallResult(pinged).text, 'pong-follows');
	assert.deepEqual(await pollForPong('srv-ping-1'), { pong: {} });

	// SSE response for a DIFFERENT request id is never attributed to ours.
	await assert.rejects(
		() => client.callTool('wrong_id', {}),
		/no response for tools\/call/
	);

	// 2xx non-JSON body (proxy error page) → typed transport error with status.
	await assert.rejects(
		() => client.callTool('html_body', {}),
		(e: unknown) =>
			e instanceof McpTransportError &&
			e.status === 200 &&
			/invalid JSON/.test(e.message) &&
			/proxy error page/.test(e.message)
	);

	// isError result — formatted, not thrown (the manager throws).
	const failed = await client.callTool('fail_tool', {});
	assert.equal(formatToolCallResult(failed).isError, true);
	assert.equal(formatToolCallResult(failed).text, 'boom');

	// structuredContent fallback when no text blocks.
	const structured = await client.callTool('structured', {});
	assert.equal(formatToolCallResult(structured).text, '{\n  "a": 1\n}');

	// JSON-RPC error → throw with server message.
	await assert.rejects(
		() => client.callTool('tool_b', {}),
		/No handler for tool/
	);

	// A server advertising no tools capability finishes connected with an
	// empty tool list instead of erroring the connect via tools/list.
	const notools = new McpClient({
		url: `http://127.0.0.1:${port}/mcp-notools`,
		headers: { Authorization: AUTH },
		clientVersion: '0.0.0-test',
		sender,
	});
	await notools.connect();
	assert.equal(notools.connected, true);
	assert.equal(notools.tools.length, 0);

	// Session expiry: server invalidates our session; the client must
	// re-initialize transparently and the retry must succeed.
	await sender({ url: `http://127.0.0.1:${port}/__invalidate`, method: 'POST', headers: { Authorization: AUTH } });
	const afterReconnect = await client.callTool('echo', { msg: 'again' });
	assert.equal(formatToolCallResult(afterReconnect).text, 'echo:\n\n{"msg":"again"}');

	console.log('MCP smoke test: all assertions passed');
}

main().catch((e) => {
	console.error('MCP smoke test FAILED:', e);
	process.exit(1);
});
