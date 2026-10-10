// Cloud Storage JSON API client — the READ-ONLY surface the GCP connector
// exposes (list buckets, list objects, read one object). Obsidian-free: it
// takes the injected HttpSender plus token callbacks, so the wire logic is
// unit-tested in node.
//
// readObject never buffers large or binary payloads: it fetches the object's
// metadata first and only downloads the media when the content type is
// text-like AND the object is small enough to be useful inline to a model.
// Everything else comes back as a bracketed descriptor (mime, size, gs://
// URI) — the same convention MCP's formatToolCallResult uses for binaries.

import type { HttpSender } from './http';

const JSON_API_BASE = 'https://storage.googleapis.com/storage/v1';
const MEDIA_API_BASE = 'https://storage.googleapis.com/download/storage/v1';

/** Hard ceiling on buffered downloads — requestUrl/fetch resolve with the
 *  whole body, and no model needs 5 MB of inline text. */
const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024;

/** Default tool-result cap, matching MCP's MAX_TOOL_RESULT_CHARS posture. */
const MAX_RESULT_CHARS = 20000;

type Json = Record<string, unknown>;

function asJson(value: unknown): Json {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
}

function asArray(value: unknown): Json[] {
	return Array.isArray(value) ? value.map(asJson) : [];
}

function asString(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

/** Object names and bucket names ride the path — encode fully, slashes
 *  included (the JSON API expects %2F, not path segments). */
function pathEncode(segment: string): string {
	return encodeURIComponent(segment);
}

/** Human-readable byte size for list rows and descriptors. */
export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return 'unknown size';
	if (bytes < 1024) return `${bytes} B`;
	const units = ['KB', 'MB', 'GB', 'TB'];
	let value = bytes;
	let unit = 'B';
	for (const next of units) {
		if (value < 1024) break;
		value /= 1024;
		unit = next;
	}
	return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${unit}`;
}

/** Text-like content types that are useful inline to a model. Unknown types
 *  (missing contentType) are treated as text — plain data files usually are. */
export function isTextLike(contentType: string): boolean {
	const ct = contentType.toLowerCase();
	if (ct.startsWith('text/')) return true;
	return /(json|xml|yaml|yml|csv|javascript|ecmascript|toml|sql|svg|x-sh)/.test(ct);
}

export interface StorageClientOptions {
	/** Resolves a bearer token (the GcpTokenSource — auto-refreshing). */
	getToken: () => Promise<string>;
	/** Called on 401 so the next getToken mints a fresh token. */
	invalidateToken: () => void;
	sender: HttpSender;
}

export class StorageClient {
	constructor(private readonly opts: StorageClientOptions) {}

	/** One page of buckets in a project, formatted for a tool result. */
	async listBuckets(projectId: string, opts: { maxResults?: number; pageToken?: string } = {}): Promise<string> {
		const params = new URLSearchParams({
			project: projectId,
			maxResults: String(clamp(opts.maxResults ?? 20, 1, 100)),
		});
		if (opts.pageToken) params.set('pageToken', opts.pageToken);
		const data = await this.authedGetJson(`${JSON_API_BASE}/b?${params.toString()}`);
		const buckets = asArray(data.items);
		if (buckets.length === 0) return `No buckets found in project "${projectId}".`;
		const lines = buckets.map((b) => {
			const name = asString(b.name);
			const location = asString(b.location);
			return `- gs://${name}${location ? ` (${location})` : ''}`;
		});
		const token = asString(data.nextPageToken);
		return [
			`Buckets in project "${projectId}" (${buckets.length}):`,
			...lines,
			token ? `More results — call again with pageToken "${token}".` : '',
		].filter(Boolean).join('\n');
	}

	/** One page of objects under a bucket (optionally under a prefix). */
	async listObjects(bucket: string, opts: { prefix?: string; maxResults?: number; pageToken?: string } = {}): Promise<string> {
		const params = new URLSearchParams({
			maxResults: String(clamp(opts.maxResults ?? 50, 1, 200)),
		});
		if (opts.prefix) params.set('prefix', opts.prefix);
		if (opts.pageToken) params.set('pageToken', opts.pageToken);
		const data = await this.authedGetJson(`${JSON_API_BASE}/b/${pathEncode(bucket)}/o?${params.toString()}`);
		const objects = asArray(data.items);
		if (objects.length === 0) {
			return `No objects found in gs://${bucket}${opts.prefix ? ` under prefix "${opts.prefix}"` : ''}.`;
		}
		const lines = objects.map((o) => {
			const size = Number(o.size ?? NaN);
			const contentType = asString(o.contentType) || 'unknown type';
			return `- ${asString(o.name)} — ${formatBytes(size)}, ${contentType}`;
		});
		const token = asString(data.nextPageToken);
		return [
			`Objects in gs://${bucket}${opts.prefix ? ` under prefix "${opts.prefix}"` : ''} (${objects.length}):`,
			...lines,
			token ? `More results — call again with pageToken "${token}".` : '',
		].filter(Boolean).join('\n');
	}

	/**
	 * Read one object. Text-like objects come back as text (capped); binaries
	 * and oversized objects return a descriptor instead of content.
	 */
	async readObject(bucket: string, object: string, opts: { maxChars?: number } = {}): Promise<string> {
		const meta = await this.authedGetJson(`${JSON_API_BASE}/b/${pathEncode(bucket)}/o/${pathEncode(object)}`);
		const contentType = asString(meta.contentType) || 'application/octet-stream';
		const sizeBytes = Number(meta.size ?? NaN);
		const gsUri = `gs://${bucket}/${object}`;
		const descriptor = `[binary object: ${object} — ${contentType}, ${formatBytes(sizeBytes)}, ${gsUri}. Curtis's GCP access is read-only and binaries are not inlined.]`;
		if (!isTextLike(contentType)) return descriptor;
		if (Number.isFinite(sizeBytes) && sizeBytes > MAX_DOWNLOAD_BYTES) {
			return `[object too large to read inline: ${object} — ${contentType}, ${formatBytes(sizeBytes)}, ${gsUri}]`;
		}
		const resp = await this.authedGetText(`${MEDIA_API_BASE}/b/${pathEncode(bucket)}/o/${pathEncode(object)}?alt=media`);
		const maxChars = clamp(opts.maxChars ?? MAX_RESULT_CHARS, 1, MAX_RESULT_CHARS);
		const truncated = resp.length > maxChars;
		const parts = [
			`${object} (${contentType}, ${formatBytes(sizeBytes)}):`,
			'',
			truncated ? resp.slice(0, maxChars) : resp,
		];
		if (truncated) parts.push(`\n[truncated at ${maxChars} characters — the object continues]`);
		return parts.join('\n');
	}

	// ---- Internals ---------------------------------------------------------

	/** GET a JSON API endpoint, retrying once with a fresh token on 401. */
	private async authedGetJson(url: string): Promise<Json> {
		const resp = await this.authedGetText(url);
		let data: unknown;
		try {
			data = JSON.parse(resp);
		} catch {
			throw new Error('GCP Storage API returned a non-JSON response.');
		}
		const obj = asJson(data);
		if (obj.error) throw apiError(obj);
		return obj;
	}

	private async authedGetText(url: string): Promise<string> {
		let resp = await this.send(url);
		if (resp.status === 401) {
			// Cached token expired or was revoked mid-flight — mint a new one
			// and replay once. A second 401 is a real permission problem.
			this.opts.invalidateToken();
			resp = await this.send(url);
		}
		if (resp.status === 401 || resp.status === 403) {
			throw new Error(`GCP Storage API refused the request (HTTP ${resp.status}) — check the service account's roles (needs read access to this bucket).`);
		}
		if (resp.status !== 200) {
			let message = `HTTP ${resp.status}`;
			try {
				const parsed = asJson(JSON.parse(resp.text));
				const apiMessage = parsed.error ? asString(asJson(parsed.error).message) : '';
				if (apiMessage) message = apiMessage;
			} catch { /* keep the status-line message */ }
			throw new Error(`GCP Storage API error: ${message}`);
		}
		return resp.text;
	}

	private async send(url: string): Promise<{ status: number; text: string }> {
		const token = await this.opts.getToken();
		return this.opts.sender({ url, method: 'GET', headers: { Authorization: `Bearer ${token}` } });
	}
}

/** Shape a Google API error envelope into the thrown message. */
function apiError(body: Json): Error {
	const err = asJson(body.error);
	const message = asString(err.message) || 'unknown error';
	return new Error(`GCP Storage API error: ${message}`);
}

function clamp(n: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, Math.floor(n)));
}
