// Tests for the HTTP half of MCP server mode: the security gates (bearer
// token, Host allowlist, Origin allowlist), method routing, and the JSON-RPC
// plumbing, all over a real socket. The server binds port 0 on 127.0.0.1 with
// the real node:http injected — production resolves that module via
// window.require inside Obsidian; under plain vitest/node we hand it in.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { McpHttpServer, RequestBodyTooLargeError } from './server';
import type { McpServerBackend } from './protocol';

// Type view only — the obsidianmd lint rules forbid node:* import statements;
// the module itself arrives via the dynamic import in startTestServer().
type HttpModule = typeof import('node:http');

const TOKEN = 'test-token-123';
const SERVER_INFO = { name: 'curtis-test', version: '0.0.0' };

function fakeBackend(): McpServerBackend {
	return {
		listTools: () => [
			{ name: 'echo', description: 'Echoes the arguments back as text.', inputSchema: { type: 'object' } },
		],
		callTool: async (_name, args) => ({
			content: [{ type: 'text', text: `echo:${JSON.stringify(args)}` }],
		}),
	};
}

interface TestServer {
	server: McpHttpServer;
	port: number;
}

let http: HttpModule;
let server: McpHttpServer | undefined;
let port: number;

/** One shared server for the whole suite: ephemeral port, real node:http. */
async function startTestServer(): Promise<TestServer> {
	// importActual rather than import(): the obsidianmd lint rules want a
	// Platform.isDesktop guard around a literal node: import, which a
	// plain-node test cannot honestly provide. There are no mocks in this
	// suite, so importActual hands back the very module production resolves.
	http = await vi.importActual<HttpModule>('node:http');
	const started = new McpHttpServer({
		port: 0, // ephemeral — the OS picks, boundPort reports the pick
		token: TOKEN,
		backend: fakeBackend(),
		serverInfo: SERVER_INFO,
		httpModule: http,
	});
	await started.start();
	const bound = started.boundPort;
	if (bound === null) throw new Error('server failed to report its bound port');
	return { server: started, port: bound };
}

beforeAll(async () => {
	({ server, port } = await startTestServer());
});

afterAll(async () => {
	await server?.stop();
});

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

interface RawResponse {
	status: number;
	headers: Record<string, string>;
	text: string;
}

const DECODER = new TextDecoder();

/** One helper for the whole suite, over the injected http module: fetch would
 *  refuse the Host override the host-gate tests need, and the suite stays
 *  free of browser globals. Headers pass through verbatim. */
function request(opts: { method?: string; headers?: Record<string, string>; body?: string }): Promise<RawResponse> {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{
				host: '127.0.0.1',
				port,
				path: '/mcp',
				method: opts.method ?? 'POST',
				headers: opts.headers,
			},
			(res) => {
				let text = '';
				res.on('data', (chunk: Uint8Array) => {
					text += DECODER.decode(chunk, { stream: true });
				});
				res.on('end', () => {
					text += DECODER.decode(); // flush a split multibyte tail
					const headers: Record<string, string> = {};
					for (const [name, value] of Object.entries(res.headers)) {
						if (typeof value === 'string') headers[name] = value;
					}
					resolve({ status: res.statusCode ?? 0, headers, text });
				});
			}
		);
		req.on('error', reject);
		req.end(opts.body ?? '');
	});
}

/** Authenticated POST with the valid bearer by default; per-test headers
 *  override. A string body is sent verbatim (malformed-JSON, oversize). */
function post(body: unknown, headers: Record<string, string> = {}): Promise<RawResponse> {
	return request({
		headers: {
			authorization: `Bearer ${TOKEN}`,
			'content-type': 'application/json',
			...headers,
		},
		body: typeof body === 'string' ? body : JSON.stringify(body),
	});
}

function rpc(method: string, params?: unknown): unknown {
	return { jsonrpc: '2.0', id: 1, method, params };
}

function notification(method: string): unknown {
	return { jsonrpc: '2.0', method }; // no id — that is what makes it one
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

describe('auth gate', () => {
	it('serves a valid bearer token', async () => {
		expect((await post(rpc('ping'))).status).toBe(200);
	});

	it('rejects a missing Authorization header with 401', async () => {
		const res = await request({
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(rpc('ping')),
		});
		expect(res.status).toBe(401);
	});

	it('rejects a wrong token with 401', async () => {
		const res = await post(rpc('ping'), { authorization: 'Bearer wrong-token' });
		expect(res.status).toBe(401);
	});

	it('accepts x-curtis-token as the alternative credential', async () => {
		const res = await request({
			headers: { 'content-type': 'application/json', 'x-curtis-token': TOKEN },
			body: JSON.stringify(rpc('ping')),
		});
		expect(res.status).toBe(200);
	});
});

// ---------------------------------------------------------------------------
// Origin / Host
// ---------------------------------------------------------------------------

describe('origin gate', () => {
	it('serves requests that carry no Origin header', async () => {
		expect((await post(rpc('ping'))).status).toBe(200);
	});

	it('refuses a foreign web origin with 403', async () => {
		const res = await post(rpc('ping'), { origin: 'https://evil.example' });
		expect(res.status).toBe(403);
	});

	it('serves the Obsidian desktop origin', async () => {
		const res = await post(rpc('ping'), { origin: 'app://obsidian.md' });
		expect(res.status).toBe(200);
	});

	it('refuses a sandboxed null origin with 403', async () => {
		const res = await post(rpc('ping'), { origin: 'null' });
		expect(res.status).toBe(403);
	});
});

describe('host gate', () => {
	it('refuses a non-loopback Host header with 403', async () => {
		const res = await post(rpc('ping'), { host: 'evil.example' });
		expect(res.status).toBe(403);
	});

	it('serves a localhost Host header', async () => {
		const res = await post(rpc('ping'), { host: `localhost:${port}` });
		expect(res.status).toBe(200);
	});
});

// ---------------------------------------------------------------------------
// Routing and plumbing
// ---------------------------------------------------------------------------

describe('method routing', () => {
	it('answers GET with 405 and an Allow header naming POST', async () => {
		const res = await request({ method: 'GET', headers: { authorization: `Bearer ${TOKEN}` } });
		expect(res.status).toBe(405);
		expect(res.headers.allow).toContain('POST');
	});
});

describe('JSON-RPC over the wire', () => {
	it('round-trips initialize: protocol version and server info echoed', async () => {
		const res = await post(rpc('initialize', { protocolVersion: '2025-06-18' }));
		expect(res.status).toBe(200);
		expect(res.headers['content-type']).toContain('application/json');
		const body = JSON.parse(res.text) as {
			result: { protocolVersion: string; serverInfo: { name: string; version: string } };
		};
		expect(body.result.protocolVersion).toBe('2025-06-18');
		expect(body.result.serverInfo).toEqual(SERVER_INFO);
	});

	it('round-trips tools/list with the injected backend catalog', async () => {
		const res = await post(rpc('tools/list'));
		expect(res.status).toBe(200);
		const body = JSON.parse(res.text) as { result: { tools: { name: string }[] } };
		expect(body.result.tools.map((t) => t.name)).toContain('echo');
	});

	it('round-trips tools/call: the args come back inside the text result', async () => {
		const res = await post(rpc('tools/call', { name: 'echo', arguments: { note: 'hello vault' } }));
		expect(res.status).toBe(200);
		const body = JSON.parse(res.text) as { result: { content: { type: string; text: string }[] } };
		expect(body.result.content[0].type).toBe('text');
		expect(body.result.content[0].text).toContain('hello vault');
	});

	it('answers a notification with 202 and an empty body', async () => {
		const res = await post(notification('notifications/initialized'));
		expect(res.status).toBe(202);
		expect(res.text).toBe('');
	});

	it('answers an unparseable body with 400 and the -32700 parse error', async () => {
		const res = await post('{"jsonrpc":"2.0" oops');
		expect(res.status).toBe(400);
		const body = JSON.parse(res.text) as { error: { code: number } };
		expect(body.error.code).toBe(-32700);
	});

	it('answers an unknown method with 200 and -32601', async () => {
		const res = await post(rpc('resources/list'));
		expect(res.status).toBe(200);
		const body = JSON.parse(res.text) as { error: { code: number } };
		expect(body.error.code).toBe(-32601);
	});
});

// ---------------------------------------------------------------------------
// Body limits
// ---------------------------------------------------------------------------

describe('body limits', () => {
	it('rejects a body over the 2 MB cap with 413, judged from the header', async () => {
		const body = 'x'.repeat(2_100_000);
		const res = await request({
			headers: {
				authorization: `Bearer ${TOKEN}`,
				'content-type': 'application/json',
				'content-length': String(new TextEncoder().encode(body).length),
			},
			body,
		});
		expect(res.status).toBe(413);
		expect(res.text).toContain('too large');
	});

	it('tags mid-stream overflow with a type the handler can single out', () => {
		const e = new RequestBodyTooLargeError();
		expect(e).toBeInstanceOf(Error);
		expect(e.message).toBe('Request body too large');
	});
});

// ---------------------------------------------------------------------------
// Injection
// ---------------------------------------------------------------------------

describe('http module injection', () => {
	it('rejects start() with the desktop-only error when nothing is resolvable', async () => {
		// No httpModule handed in and no window.require under plain node —
		// the manager never constructs the server on mobile; start() says so.
		const orphan = new McpHttpServer({
			port: 0,
			token: TOKEN,
			backend: fakeBackend(),
			serverInfo: SERVER_INFO,
		});
		await expect(orphan.start()).rejects.toThrow('desktop-only');
		expect(orphan.running).toBe(false);
		expect(orphan.boundPort).toBeNull();
	});

	it('reports the actually bound port while port 0 was configured', () => {
		expect(server?.port).toBe(0);
		expect(server?.boundPort).not.toBeNull();
	});
});
