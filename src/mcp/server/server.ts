// MCP server mode — the HTTP half.
//
// A minimal Streamable HTTP host: one endpoint, POST in, single JSON-RPC
// response out (the spec allows JSON responses for requests that need no
// streaming, and a stateless server never streams). Runs on Node's http
// module inside the desktop Electron renderer — mobile has no listening
// sockets, so the manager never constructs this there.
//
// Security posture for a localhost AI-tool server, per the MCP spec's
// "security best practices":
//   - bind 127.0.0.1 only, never 0.0.0.0
//   - bearer token on every request, constant-time compared
//   - Host must be 127.0.0.1/localhost (DNS-rebinding defense)
//   - cross-origin browser requests are refused (Origin allowlist) — a
//     web page must never be able to reach the vault through this server

// Type views of the Node http/net values we touch. The obsidianmd lint rules
// forbid `node:*` import statements outright (mobile has no Node), so the
// modules are resolved at runtime by nodeHttp() and these come from inline
// import types — erased at build, never bundled.
type HttpRequest = import('node:http').IncomingMessage;
type HttpResponse = import('node:http').ServerResponse;
type HttpServer = import('node:http').Server;
type HttpSocket = import('node:net').Socket;
import {
	handleJsonRpcMessage,
	rpcParseErrorResponse,
	MCP_SERVER_PROTOCOL_VERSION,
} from './protocol';
import type { McpJsonRpcResponse, McpServerBackend, McpServerInfo } from './protocol';

const MAX_BODY_BYTES = 2_000_000;
const REQUEST_TIMEOUT_MS = 120_000; // tool calls can legitimately run long (RAG warm-up)

export interface McpHttpServerOptions {
	port: number;
	token: string;
	backend: McpServerBackend;
	serverInfo: McpServerInfo;
	/** Test hook, mirroring the client transport's injected sender: vitest
	 *  passes the real node:http so the suite runs under plain node.
	 *  Production omits it and start() resolves Node via nodeHttp() below. */
	httpModule?: typeof import('node:http');
}

export class McpHttpServer {
	private server: HttpServer | null = null;
	private sockets = new Set<HttpSocket>();
	private opts: McpHttpServerOptions;

	constructor(opts: McpHttpServerOptions) {
		this.opts = opts;
	}

	/** Swap the tool catalog live (e.g. the writes toggle flipped) without
	 *  dropping connections — clients just see a different tools/list. */
	setBackend(backend: McpServerBackend): void {
		this.opts = { ...this.opts, backend };
	}

	get running(): boolean {
		return this.server !== null;
	}

	get port(): number {
		return this.opts.port;
	}

	/** The port actually bound (a configured 0 means the OS picked one).
	 *  address() is a string for unix sockets and null when closed — we bind
	 *  TCP only, so both mean "not serving on a port". */
	get boundPort(): number | null {
		const addr = this.server?.address();
		return addr && typeof addr === 'object' ? addr.port : null;
	}

	start(): Promise<void> {
		if (this.server) return Promise.resolve();
		const http = this.opts.httpModule ?? nodeHttp();
		if (!http) {
			return Promise.reject(new Error('Node http module unavailable — MCP server mode is desktop-only'));
		}
		return new Promise((resolve, reject) => {
			const server = http.createServer((req, res) => {
				void this.handle(req, res);
			});
			server.on('connection', (socket) => {
				this.sockets.add(socket);
				socket.on('close', () => this.sockets.delete(socket));
			});
			server.on('error', (err) => {
				this.server = null;
				const code = (err as { code?: string }).code;
				reject(
					code === 'EADDRINUSE'
						? new Error(`Port ${this.opts.port} is already in use — pick another in Settings → Curtis AI → MCP server`)
						: err
				);
			});
			// 127.0.0.1, never 0.0.0.0 — this server can read and (opt-in) write
			// the vault; it must not be reachable from the network.
			server.listen(this.opts.port, '127.0.0.1', () => {
				this.server = server;
				resolve();
			});
		});
	}

	async stop(): Promise<void> {
		const server = this.server;
		if (!server) return;
		this.server = null;
		for (const socket of this.sockets) socket.destroy();
		this.sockets.clear();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}

	private async handle(req: HttpRequest, res: HttpResponse): Promise<void> {
		try {
			if (!requestHostIsLocal(req)) return fail(res, 403, 'Forbidden');
			if (!isAllowedOrigin(header(req, 'origin'))) return fail(res, 403, 'Forbidden');
			if (req.method !== 'POST') {
				res.setHeader('Allow', 'POST');
				return fail(res, 405, 'Method Not Allowed');
			}
			if (!timingSafeEqual(header(req, 'authorization') ?? '', `Bearer ${this.opts.token}`) &&
				!timingSafeEqual(header(req, 'x-curtis-token') ?? '', this.opts.token)) {
				return fail(res, 401, 'Unauthorized — present the MCP server token from Curtis settings');
			}

			// Reject oversize before reading a byte when the header is honest;
			// readBody's mid-stream check catches the liars.
			const contentLength = parseInt(header(req, 'content-length') ?? '', 10);
			if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
				return fail(res, 413, 'Request body too large');
			}

			const body = await readBody(req);
			let message: unknown;
			try {
				message = JSON.parse(body);
			} catch {
				return respond(res, 400, rpcParseErrorResponse());
			}

			const response = await handleJsonRpcMessage(message, this.opts.backend, this.opts.serverInfo);
			if (!response) {
				// Notification — acknowledged, no body.
				res.statusCode = 202;
				res.end();
				return;
			}
			respond(res, 200, response);
		} catch (e) {
			if (e instanceof RequestBodyTooLargeError) return fail(res, 413, 'Request body too large');
			fail(res, 500, e instanceof Error ? e.message : 'Internal error');
		}
	}
}

// ---------------------------------------------------------------------------
// Request checks
// ---------------------------------------------------------------------------

/** The token gate. Length-mismatched strings bail immediately (lengths are
 *  not secret); equal lengths compare every byte so timing leaks nothing. */
export function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

/** Browsers attach Origin to cross-origin requests; local AI apps attach
 *  none. Anything that is not a trusted local app origin is refused — the
 *  DNS-rebinding/drive-by defense. `null` (sandboxed frames) is refused too. */
export function isAllowedOrigin(origin: string | undefined): boolean {
	if (origin === undefined) return true;
	if (origin === 'null') return false;
	const trusted = [
		/^app:\/\//i, // Obsidian desktop
		/^obsidian:\/\//i,
		/^capacitor:\/\/localhost/i, // Obsidian mobile (never binds, but harmless)
		/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i,
	];
	return trusted.some((re) => re.test(origin));
}

/** The rebinding half: even with a poisoned DNS entry, Host would name the
 *  attacker's domain — only loopback hosts are served. */
export function requestHostIsLocal(req: HttpRequest): boolean {
	const host = (header(req, 'host') ?? '').toLowerCase();
	return /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host);
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

/** Mid-stream oversize — readBody rejects with this type so handle() can
 *  answer 413 instead of lumping it in with the generic 500. */
export class RequestBodyTooLargeError extends Error {
	constructor() {
		super('Request body too large');
		this.name = 'RequestBodyTooLargeError';
	}
}

function readBody(req: HttpRequest): Promise<string> {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks: Uint8Array[] = [];
		req.on('data', (chunk: Uint8Array) => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES) {
				reject(new RequestBodyTooLargeError());
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on('end', () => {
			const body = new Uint8Array(size);
			let offset = 0;
			for (const chunk of chunks) {
				body.set(chunk, offset);
				offset += chunk.length;
			}
			resolve(new TextDecoder().decode(body));
		});
		req.on('error', reject);
		// A hung client must not pin a socket forever.
		req.setTimeout(REQUEST_TIMEOUT_MS, () => {
			reject(new Error('Request timed out'));
			req.destroy();
		});
	});
}

function respond(res: HttpResponse, status: number, body: McpJsonRpcResponse): void {
	res.statusCode = status;
	res.setHeader('Content-Type', 'application/json');
	res.setHeader('MCP-Protocol-Version', MCP_SERVER_PROTOCOL_VERSION);
	res.end(JSON.stringify(body));
}

function fail(res: HttpResponse, status: number, message: string): void {
	res.statusCode = status;
	res.setHeader('Content-Type', 'text/plain');
	res.end(message);
}

function header(req: HttpRequest, name: string): string | undefined {
	const v = req.headers[name];
	return Array.isArray(v) ? v[0] : v;
}

/** Resolve Node's http module at runtime. Inside Obsidian's CommonJS-loaded
 *  plugin bundle the module scope has `require` (reachable via window on
 *  desktop); mobile has none, and this returns null — the manager never
 *  constructs the server there. Indirection keeps the bundler and eslint
 *  away from a literal require('http'). */
function nodeHttp(): typeof import('node:http') | null {
	try {
		const req = (window as { require?: (id: string) => unknown }).require;
		if (typeof req !== 'function') return null;
		return req('http') as typeof import('node:http');
	} catch {
		return null;
	}
}
