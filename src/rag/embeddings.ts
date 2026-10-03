// Curtis — Embeddings client for OpenAI-compatible /embeddings endpoints.
//
// Covers OpenAI, Gemini's OpenAI-compat shim, Ollama (/v1/embeddings),
// LM Studio, and every custom provider — anything speaking the
// `{ model, input } → { data: [{ index, embedding }] }` wire shape.
// Anthropic has no embeddings API and is excluded upstream.
//
// Transport is Obsidian's requestUrl (CORS-immune, works on desktop+mobile).

import { requestUrl } from 'obsidian';

export interface EmbeddingEndpoint {
	url: string;
	apiKey: string;
	model: string;
}

export class EmbeddingError extends Error {
	readonly status: number | null;

	constructor(message: string, status?: number | null) {
		super(message);
		this.name = 'EmbeddingError';
		this.status = status ?? null;
	}
}

/**
 * Derive the /embeddings URL from a chat-completions endpoint, mirroring the
 * registry's discovery logic: `…/v1/chat/completions` → `…/v1/embeddings`,
 * Azure deployment URLs included. Endpoints that don't end in
 * chat/completions get `/embeddings` appended (custom bare /v1 roots).
 */
export function embeddingsUrlFromChatUrl(chatUrl: string): string {
	const base = chatUrl.split('?')[0].replace(/\/+$/, '');
	if (/chat\/completions$/.test(base)) {
		return base.replace(/chat\/completions$/, 'embeddings');
	}
	return `${base}/embeddings`;
}

const BATCH_SIZE = 16;
const BATCH_DELAY_MS = 100;

/**
 * Embed a list of texts in small batches. Returns vectors in input order.
 * onProgress reports (done, total) after each batch completes.
 */
export async function embedTexts(
	endpoint: EmbeddingEndpoint,
	inputs: string[],
	onProgress?: (done: number, total: number) => void
): Promise<number[][]> {
	const out: number[][] = new Array<number[]>(inputs.length);
	let done = 0;
	for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
		const batch = inputs.slice(i, i + BATCH_SIZE);
		const vectors = await embedBatch(endpoint, batch);
		for (let j = 0; j < vectors.length; j++) {
			out[i + j] = vectors[j];
		}
		done += batch.length;
		onProgress?.(done, inputs.length);
		if (i + BATCH_SIZE < inputs.length) {
			// Gentle pacing — local servers process sequentially and hosted
			// APIs rate-limit per minute; 100ms between batches is negligible
			// for vault-sized jobs and keeps both comfortable.
			await new Promise((resolve) => window.setTimeout(resolve, BATCH_DELAY_MS));
		}
	}
	return out;
}

async function embedBatch(endpoint: EmbeddingEndpoint, batch: string[]): Promise<number[][]> {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (endpoint.apiKey) headers['Authorization'] = `Bearer ${endpoint.apiKey}`;

	let status: number;
	let body: string;
	try {
		const resp = await requestUrl({
			url: endpoint.url,
			method: 'POST',
			headers,
			body: JSON.stringify({ model: endpoint.model, input: batch }),
			throw: false,
		});
		status = resp.status;
		body = resp.text;
	} catch (e) {
		throw new EmbeddingError(`Embedding request failed: ${(e as Error).message}`);
	}
	if (status < 200 || status >= 300) {
		throw new EmbeddingError(`Embeddings API returned ${status}: ${body.slice(0, 300)}`, status);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch {
		throw new EmbeddingError('Embeddings API returned non-JSON body');
	}
	return parseEmbeddingsResponse(parsed, batch.length);
}

/** Parse `{ data: [{ index, embedding }] }`, restoring input order via index. */
function parseEmbeddingsResponse(data: unknown, expected: number): number[][] {
	if (!data || typeof data !== 'object') {
		throw new EmbeddingError('Unexpected embeddings response shape');
	}
	const arr = (data as { data?: unknown }).data;
	if (!Array.isArray(arr)) {
		throw new EmbeddingError('Unexpected embeddings response shape (missing data[])');
	}
	const out: number[][] = new Array<number[]>(expected);
	for (const item of arr) {
		if (!item || typeof item !== 'object') continue;
		const rec = item as { index?: unknown; embedding?: unknown };
		if (typeof rec.index !== 'number' || !Number.isInteger(rec.index)) continue;
		if (rec.index < 0 || rec.index >= expected) continue;
		if (!Array.isArray(rec.embedding)) continue;
		out[rec.index] = rec.embedding.map((v) => (typeof v === 'number' ? v : 0));
	}
	// A hole means the provider skipped an index — treat as malformed rather
	// than silently mis-aligning vectors to texts.
	for (let i = 0; i < expected; i++) {
		if (!Array.isArray(out[i])) {
			throw new EmbeddingError('Embeddings response missing entries');
		}
	}
	return out;
}
