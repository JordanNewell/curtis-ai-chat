// Stream shim — adapts non-fetch sources to the StreamResponse shape that
// AIProvider.parseStream / parseResponse expect.
//
// Three cases the transport layer needs to feed into provider parsers:
//   1. Native fetch() Response — already satisfies StreamResponse; passthrough.
//   2. Node `https.IncomingMessage` (desktop streaming via require('https')) —
//      has `.on('data')` events, no `.getReader()`. Wrap with NodeIncomingReader.
//   3. Obsidian requestUrl() buffered response — whole body already in memory;
//      wrap as a single-chunk stream for parser compatibility.

import type { StreamResponse, ReadableLike, ReadableReader } from '../types';

/**
 * Minimal Node IncomingMessage / readable-stream surface we consume.
 * Captured as an interface so the shim is decoupled from Node typings
 * (which aren't resolvable in the mobile renderer environment).
 */
export interface NodeIncomingMessage {
	statusCode?: number;
	on(event: 'data', listener: (chunk: Uint8Array) => void): unknown;
	on(event: 'end', listener: () => void): unknown;
	on(event: 'error', listener: (err: Error) => void): unknown;
	destroy?(error?: Error): unknown;
}

/**
 * Wrap a Node IncomingMessage (event-emitter style) as a WHATWG-style reader.
 * Pulls data via `.on('data')`/`.on('end')`/`.on('error')` and fulfills `read()`
 * promises against a buffered queue. Cancels via `destroy()` when the reader
 * is cancelled (e.g. AbortSignal fires).
 */
export class NodeIncomingReader implements ReadableReader {
	private chunks: Uint8Array[] = [];
	private done = false;
	private error: Error | null = null;
	private waiters: Array<() => void> = [];
	private locked = false;
	private stream: NodeIncomingMessage | undefined;

	constructor(stream: NodeIncomingMessage) {
		this.stream = stream;
		stream.on('data', (chunk: Uint8Array) => {
			this.chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
			this.drainWaiters();
		});
		stream.on('end', () => {
			this.done = true;
			this.drainWaiters();
		});
		stream.on('error', (err: Error) => {
			this.error = err;
			this.done = true;
			this.drainWaiters();
		});
	}

	private drainWaiters(): void {
		while (this.waiters.length > 0) {
			const w = this.waiters.shift();
			w?.();
		}
	}

	async read(): Promise<{ done: true; value?: undefined } | { done: false; value: Uint8Array }> {
		if (this.error) throw this.error;
		if (this.chunks.length > 0) {
			return { done: false, value: this.chunks.shift()! };
		}
		if (this.done) {
			return { done: true, value: undefined };
		}
		// Wait for next data/end/error event
		await new Promise<void>((resolve) => this.waiters.push(resolve));
		return this.read();
	}

	releaseLock(): void {
		this.locked = false;
		// Best-effort cleanup of the underlying stream
		try {
			this.stream?.destroy?.();
		} catch {
			// ignore
		}
	}
}

/** ReadableLike wrapper for Node IncomingMessage. */
export function wrapNodeStream(stream: NodeIncomingMessage): ReadableLike {
	return {
		getReader: () => new NodeIncomingReader(stream),
	};
}

/**
 * Build a StreamResponse from a Node IncomingMessage (desktop https path).
 * `status` is read from `statusCode`; body is wrapped for `getReader()`.
 */
export function streamResponseFromNode(stream: NodeIncomingMessage): StreamResponse {
	const status = stream.statusCode ?? 0;
	return {
		ok: status >= 200 && status < 400,
		status,
		body: wrapNodeStream(stream),
		json: async (): Promise<unknown> => JSON.parse(await readAllText(stream)) as unknown,
		text: async () => readAllText(stream),
	};
}

/**
 * Build a StreamResponse from a buffered body (requestUrl path, or
 * a fetch() whose stream we already consumed). Emits one chunk on read().
 */
export function streamResponseFromBuffer(
	status: number,
	bodyText: string,
	jsonCache?: unknown
): StreamResponse {
	let textAlreadyRead = false;
	let readerReturned = false;
	const reader: ReadableReader = {
		read: async () => {
			if (readerReturned) return { done: true, value: undefined };
			if (textAlreadyRead) return { done: true, value: undefined };
			textAlreadyRead = true;
			// Encode the whole body as one chunk; parsers will split on \n themselves.
			return { done: false, value: new TextEncoder().encode(bodyText) };
		},
		releaseLock: () => {
			readerReturned = true;
		},
	};
	return {
		ok: status >= 200 && status < 400,
		status,
		body: { getReader: () => reader },
		json: async (): Promise<unknown> => (jsonCache !== undefined ? jsonCache : JSON.parse(bodyText) as unknown),
		text: async () => bodyText,
	};
}

/** Read the full body of a Node stream into a UTF-8 string. Used for error bodies. */
function readAllText(stream: NodeIncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Uint8Array[] = [];
		stream.on('data', (c: Uint8Array) => chunks.push(c));
		stream.on('end', () => {
			const total = chunks.reduce((sum, c) => sum + c.length, 0);
			const merged = new Uint8Array(total);
			let offset = 0;
			for (const c of chunks) { merged.set(c, offset); offset += c.length; }
			resolve(new TextDecoder('utf8').decode(merged));
		});
		stream.on('error', (err: Error) => reject(err));
	});
}
