// MCP protocol smoke test orchestrator.
//
// Starts a minimal but spec-shaped Streamable HTTP MCP server on 127.0.0.1,
// bundles scripts/mcp-smoke-entry.ts (which drives the REAL client code from
// src/mcp/) with the obsidian module stubbed, runs it, and reports the result.
//
// Usage:  node scripts/mcp-smoke.mjs
// Needs:  node >= 18 (global fetch). Not shipped in the plugin bundle.

import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');

// ---------------------------------------------------------------------------
// Minimal MCP server
// ---------------------------------------------------------------------------

const PROTOCOL_VERSION = '2025-06-18';
const AUTH_TOKEN = 'Bearer smoke-token';
let nextSession = 0;
const validSessions = new Set();
// JSON-RPC responses received FROM the client — server→client ping replies.
const pongs = [];

// 70 chars — exceeds the 64-char function-name limit every provider enforces.
const OVERSIZED_TOOL = 'oversized_' + 'n'.repeat(60);

function jsonResp(res, status, body, extraHeaders = {}) {
	res.writeHead(status, {
		'Content-Type': 'application/json',
		...extraHeaders,
	});
	res.end(body === undefined ? '' : JSON.stringify(body));
}

const TOOLS_PAGE_ONE = [
	{ name: 'echo', description: 'Echo back the arguments', inputSchema: { type: 'object', properties: { msg: { type: 'string' } } } },
	{ name: 'fail_tool', description: 'Always reports isError' },
	{ name: 'structured', description: 'Returns only structuredContent' },
	{ name: 'pinged_echo', description: 'Answers via SSE with a server ping frame plus the response' },
	{ name: 'wrong_id', description: 'Answers via SSE with a response for a DIFFERENT request id' },
	{ name: 'html_body', description: 'Answers with a 200 text/html proxy-error body' },
	{ name: OVERSIZED_TOOL, description: 'Tool name longer than the 64-char provider limit' },
];
const TOOLS_PAGE_TWO = [{ name: 'tool_b', description: 'Errors as a JSON-RPC error' }];

const server = createServer((req, res) => {
	let raw = '';
	req.on('data', (chunk) => (raw += chunk));
	req.on('end', () => {
		// Header regression canary: every request the client makes must carry
		// the configured Authorization header.
		if (req.headers['authorization'] !== AUTH_TOKEN) {
			res.writeHead(401).end();
			return;
		}

		const path = (req.url || '/').split('?')[0];

		if (path === '/__invalidate') {
			validSessions.clear();
			res.writeHead(200).end();
			return;
		}
		if (path === '/__pings') {
			jsonResp(res, 200, { pongs });
			return;
		}

		const isNoToolsServer = path === '/mcp-notools';

		let message;
		try {
			message = JSON.parse(raw);
		} catch {
			jsonResp(res, 400, { error: 'bad json' });
			return;
		}

		const session = req.headers['mcp-session-id'];
		const isInitialize = message.method === 'initialize';

		if (isInitialize) {
			const sid = `sess-${++nextSession}`;
			validSessions.add(sid);
			jsonResp(res, 200, {
				jsonrpc: '2.0',
				id: message.id,
				result: {
					protocolVersion: PROTOCOL_VERSION,
					// The /mcp-notools endpoint advertises no tools capability —
					// the client must skip tools/list, not error the connect.
					capabilities: isNoToolsServer ? {} : { tools: {} },
					serverInfo: { name: 'smoke-server', version: '1.0.0' },
				},
			}, { 'Mcp-Session-Id': sid });
			return;
		}

		// Every non-initialize request must carry a valid session.
		if (!session || !validSessions.has(session)) {
			res.writeHead(404).end();
			return;
		}

		// A JSON-RPC response from the client — our ping replies land here.
		if (message.method === undefined) {
			pongs.push(message);
			res.writeHead(202).end();
			return;
		}

		// Notifications get a bare 202.
		if (message.id === undefined || message.id === null) {
			res.writeHead(202).end();
			return;
		}

		const reply = (result) => jsonResp(res, 200, { jsonrpc: '2.0', id: message.id, result });
		const rpcError = (code, msg) => jsonResp(res, 200, { jsonrpc: '2.0', id: message.id, error: { code, message: msg } });

		if (isNoToolsServer) {
			// Only reachable if the client wrongly attempts tools/list here.
			rpcError(-32601, `Method not found: ${message.method}`);
			return;
		}

		switch (message.method) {
			case 'tools/list': {
				const page = message.params?.cursor === 'page2' ? TOOLS_PAGE_TWO : TOOLS_PAGE_ONE;
				reply({ tools: page, nextCursor: message.params?.cursor === 'page2' ? undefined : 'page2' });
				return;
			}
			case 'tools/call': {
				const name = message.params?.name;
				if (name === 'echo') {
					reply({ content: [{ type: 'text', text: 'echo:' }, { type: 'text', text: JSON.stringify(message.params?.arguments || {}) }] });
				} else if (name === 'sse_echo') {
					// Answer as a text/event-stream instead of a JSON body —
					// same JSON-RPC response, different framing.
					const payload = JSON.stringify({
						jsonrpc: '2.0',
						id: message.id,
						result: { content: [{ type: 'text', text: `sse echo:\n\n${JSON.stringify(message.params?.arguments || {})}` }] },
					});
					res.writeHead(200, { 'Content-Type': 'text/event-stream' });
					res.end(`: keepalive\n\nevent: message\ndata: ${payload.replace(/\n/g, '')}\n\n`);
				} else if (name === 'pinged_echo') {
					// Piggyback a server→client ping on the response stream —
					// the spec's MUST-respond; the client must reply fire-and-forget.
					const pingFrame = JSON.stringify({ jsonrpc: '2.0', id: 'srv-ping-1', method: 'ping' });
					const respFrame = JSON.stringify({
						jsonrpc: '2.0',
						id: message.id,
						result: { content: [{ type: 'text', text: 'pong-follows' }] },
					});
					res.writeHead(200, { 'Content-Type': 'text/event-stream' });
					res.end(`event: message\ndata: ${pingFrame}\n\nevent: message\ndata: ${respFrame}\n\n`);
				} else if (name === 'wrong_id') {
					// Response for a DIFFERENT request id — must never be
					// attributed to the tools/call that is still pending.
					const foreign = JSON.stringify({
						jsonrpc: '2.0',
						id: 888888,
						result: { content: [{ type: 'text', text: 'WRONG-RESPONSE' }] },
					});
					res.writeHead(200, { 'Content-Type': 'text/event-stream' });
					res.end(`event: message\ndata: ${foreign}\n\n`);
				} else if (name === 'html_body') {
					// 2xx non-JSON body (proxy error page) — must surface as a
					// typed transport error, not a bare SyntaxError.
					res.writeHead(200, { 'Content-Type': 'text/html' });
					res.end('<html>proxy error page</html>');
				} else if (name === 'fail_tool') {
					reply({ content: [{ type: 'text', text: 'boom' }], isError: true });
				} else if (name === 'structured') {
					reply({ content: [], structuredContent: { a: 1 } });
				} else if (name === OVERSIZED_TOOL) {
					reply({ content: [{ type: 'text', text: `long name ok (${name.length} chars)` }] });
				} else {
					rpcError(-32602, `No handler for tool: ${name}`);
				}
				return;
			}
			default:
				rpcError(-32601, `Method not found: ${message.method}`);
		}
	});
});

// ---------------------------------------------------------------------------
// Bundle + run the entry against the server
// ---------------------------------------------------------------------------

async function main() {
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	const port = server.address().port;

	const outDir = mkdtempSync(join(tmpdir(), 'curtis-mcp-smoke-'));
	const outfile = join(outDir, 'smoke.cjs');
	try {
		await build({
			entryPoints: [join(root, 'scripts', 'mcp-smoke-entry.ts')],
			bundle: true,
			platform: 'node',
			format: 'cjs',
			outfile,
			alias: { obsidian: join(root, 'scripts', 'obsidian-stub.ts') },
			logLevel: 'silent',
		});
		// Async spawn — spawnSync would freeze this process's event loop and
		// the HTTP server below could never answer the child's requests.
		const code = await new Promise((resolve, reject) => {
			const child = spawn(process.execPath, [outfile], {
				env: { ...process.env, MCP_SMOKE_PORT: String(port) },
				stdio: 'inherit',
			});
			child.on('error', reject);
			child.on('exit', (c) => resolve(c ?? 1));
		});
		process.exitCode = code;
	} finally {
		rmSync(outDir, { recursive: true, force: true });
		server.close();
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
