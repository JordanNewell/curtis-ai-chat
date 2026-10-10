// ChatGPT provider tests — pure mappings and parsers, node-safe (no Obsidian
// imports; buildToolParametersSchema comes from core/tool-schema).

import { describe, expect, it } from 'vitest';
import type { AIMessage, StreamResponse } from '../types';
import { ChatGPTProvider, parseTokenBlob } from './chatgpt';
import type { ChatGPTTokens, ChatGPTTokenStore } from './chatgpt';

describe('parseTokenBlob', () => {
	it('parses a full blob', () => {
		const tokens = parseTokenBlob(JSON.stringify({
			access_token: 'at',
			refresh_token: 'rt',
			expires_at: 123,
			client_id: 'cid',
			account_id: 'acct',
		}));
		expect(tokens).toEqual({
			access_token: 'at',
			refresh_token: 'rt',
			expires_at: 123,
			client_id: 'cid',
			account_id: 'acct',
		});
	});

	it('returns null for malformed or empty blobs', () => {
		expect(parseTokenBlob('')).toBeNull();
		expect(parseTokenBlob('not json')).toBeNull();
		expect(parseTokenBlob('{"refresh_token":"rt"}')).toBeNull();
	});
});

describe('ChatGPTProvider.formatRequest — Responses dialect mapping', () => {
	function bodyOf(messages: AIMessage[], options?: Partial<Parameters<ChatGPTProvider['formatRequest']>[1]>): Record<string, unknown> {
		const provider = new ChatGPTProvider(storeWith({ access_token: 'at-1', expires_at: Date.now() + 600_000 }).store);
		const init = provider.formatRequest(messages, {
			model: 'gpt-6-codex',
			maxTokens: 2048,
			...options,
		});
		const headers = init.headers as Record<string, string>;
		expect(headers['Authorization']).toBe('Bearer at-1');
		return JSON.parse(init.body as string) as Record<string, unknown>;
	}

	it('sends system as instructions and user text as input_text', () => {
		const body = bodyOf([
			{ role: 'system', content: 'You are curt.' },
			{ role: 'user', content: 'hi' },
		]);
		expect(body.instructions).toBe('You are curt.');
		expect(body.input).toEqual([
			{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
		]);
		expect(body.max_output_tokens).toBe(2048);
	});

	it('maps image parts to input_image', () => {
		const body = bodyOf([
			{ role: 'user', content: [
				{ type: 'text', text: 'look' },
				{ type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
			] },
		]);
		expect(body.input).toEqual([
			{ role: 'user', content: [
				{ type: 'input_text', text: 'look' },
				{ type: 'input_image', image_url: 'data:image/png;base64,QUJD' },
			] },
		]);
	});

	it('maps assistant tool_calls and tool results to function_call items', () => {
		const body = bodyOf([
			{ role: 'user', content: 'read it' },
			{ role: 'assistant', content: 'checking', tool_calls: [
				{ id: 'call1', name: 'read_note', arguments: { path: 'x.md' } },
			] },
			{ role: 'tool', tool_call_id: 'call1', content: 'note body' },
		]);
		expect(body.input).toEqual([
			{ role: 'user', content: [{ type: 'input_text', text: 'read it' }] },
			{ role: 'assistant', content: [{ type: 'output_text', text: 'checking' }] },
			{ type: 'function_call', call_id: 'call1', name: 'read_note', arguments: '{"path":"x.md"}' },
			{ type: 'function_call_output', call_id: 'call1', output: 'note body' },
		]);
	});

	it('advertises tools in the flat Responses shape', () => {
		const body = bodyOf(
			[{ role: 'user', content: 'go' }],
			{ tools: [{
				name: 'read_note',
				description: 'Read a note',
				parameters: { path: { type: 'string', description: 'Path', required: true } },
				execute: async () => 'ok',
			}] },
		);
		expect(body.tools).toEqual([{
			type: 'function',
			name: 'read_note',
			description: 'Read a note',
			parameters: {
				type: 'object',
				properties: { path: { type: 'string', description: 'Path' } },
				required: ['path'],
			},
		}]);
		expect(body.tool_choice).toBe('auto');
	});
});

describe('ChatGPTProvider.parseResponse', () => {
	const provider = new ChatGPTProvider(null);

	it('joins output_text and parses function_call items', async () => {
		const ai = await provider.parseResponse(fakeJson({
			id: 'resp1',
			status: 'completed',
			output: [
				{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Part 1' }, { type: 'output_text', text: 'Part 2' }] },
				{ type: 'function_call', call_id: 'call1', name: 'read_note', arguments: '{"path":"x.md"}' },
			],
			usage: { input_tokens: 10, output_tokens: 5 },
		}));
		expect(ai.content).toBe('Part 1\n\nPart 2');
		expect(ai.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
		expect(ai.tool_calls).toEqual([
			{ id: 'call1', name: 'read_note', arguments: { path: 'x.md' } },
		]);
	});

	it('throws on a failed status with an error message', async () => {
		await expect(provider.parseResponse(fakeJson({
			id: 'resp2',
			status: 'failed',
			error: { message: 'quota exceeded' },
			output: [],
		}))).rejects.toThrow('quota exceeded');
	});
});

describe('ChatGPTProvider.parseStream', () => {
	function collect(events: unknown[]): { done: Promise<void>; chunks: string[]; usages: unknown[]; errors: Error[] } {
		const out = { chunks: [] as string[], usages: [] as unknown[], errors: [] as Error[] };
		const provider = new ChatGPTProvider(null);
		const done = provider.parseStream(
			sseResponse(events),
			(c) => out.chunks.push(c),
			(u) => out.usages.push(u),
			(e) => out.errors.push(e),
		);
		return { done, ...out };
	}

	it('streams text deltas and final usage', async () => {
		const { done, chunks, usages, errors } = collect([
			{ type: 'response.created', response: { id: 'r' } },
			{ type: 'response.output_text.delta', delta: 'Hel' },
			{ type: 'response.output_text.delta', delta: 'lo' },
			{ type: 'response.completed', response: { id: 'r', usage: { input_tokens: 7, output_tokens: 3 } } },
		]);
		await done;
		expect(chunks.join('')).toBe('Hello');
		expect(usages).toEqual([{ promptTokens: 7, completionTokens: 3, totalTokens: 10 }]);
		expect(errors).toEqual([]);
	});

	it('appends the truncation marker on max_output_tokens incomplete', async () => {
		const { done, chunks } = collect([
			{ type: 'response.output_text.delta', delta: 'cut off' },
			{ type: 'response.incomplete', response: { id: 'r', incomplete_details: { reason: 'max_output_tokens' } } },
		]);
		await done;
		expect(chunks.join('')).toContain('cut off');
		expect(chunks.join('')).toContain('Truncated');
	});

	it('surfaces failed and error events', async () => {
		const failed = collect([
			{ type: 'response.failed', response: { id: 'r', error: { message: 'boom' } } },
		]);
		await failed.done;
		expect(failed.errors.map((e) => e.message)).toEqual(['boom']);

		const errored = collect([{ type: 'error', message: 'bad key' }]);
		await errored.done;
		expect(errored.errors.map((e) => e.message)).toEqual(['bad key']);
	});
});

describe('ChatGPTProvider.prepare — token refresh', () => {
	it('does not refresh a live token', async () => {
		const { store, calls } = storeWith({ access_token: 'live', refresh_token: 'rt', expires_at: Date.now() + 600_000 });
		const provider = new ChatGPTProvider(store);
		await provider.prepare();
		expect(calls.refresh).toBe(0);
	});

	it('refreshes an expiring token and persists the result', async () => {
		const { store, calls } = storeWith({ access_token: 'stale', refresh_token: 'rt', expires_at: Date.now() - 1000 });
		const provider = new ChatGPTProvider(store);
		await provider.prepare();
		expect(calls.refresh).toBe(1);
		expect(calls.saved.at(-1)?.access_token).toBe('fresh');
		expect(provider.getAccessToken()).toBe('fresh');
	});

	it('keeps the old refresh token when the issuer does not rotate', async () => {
		const { store, calls } = storeWith(
			{ access_token: 'stale', refresh_token: 'rt-old', expires_at: Date.now() - 1000 },
			() => ({ access_token: 'fresh', expires_at: Date.now() + 600_000 }),
		);
		const provider = new ChatGPTProvider(store);
		await provider.prepare();
		expect(calls.saved.at(-1)?.refresh_token).toBe('rt-old');
	});

	it('single-flights concurrent refreshes', async () => {
		const { store, calls } = storeWith({ access_token: 'stale', refresh_token: 'rt', expires_at: Date.now() - 1000 });
		const provider = new ChatGPTProvider(store);
		await Promise.all([provider.prepare(), provider.prepare(), provider.prepare()]);
		expect(calls.refresh).toBe(1);
	});

	it('throws when expired with no refresh token', async () => {
		const { store } = storeWith({ access_token: 'stale', expires_at: Date.now() - 1000 });
		const provider = new ChatGPTProvider(store);
		await expect(provider.prepare()).rejects.toThrow('sign in again');
	});

	it('isAuthenticated reflects stored tokens', () => {
		expect(new ChatGPTProvider(storeWith(null).store).isAuthenticated()).toBe(false);
		expect(new ChatGPTProvider(storeWith({ access_token: 'a', expires_at: 0 }).store).isAuthenticated()).toBe(true);
		expect(new ChatGPTProvider(storeWith({ access_token: '', refresh_token: 'r', expires_at: 0 }).store).isAuthenticated()).toBe(true);
	});
});

// ---- helpers -------------------------------------------------------------

interface FakeStoreCalls {
	refresh: number;
	saved: (ChatGPTTokens | null)[];
}

function storeWith(
	tokens: ChatGPTTokens | null,
	refreshImpl?: () => ChatGPTTokens,
): { store: ChatGPTTokenStore; calls: FakeStoreCalls } {
	const calls: FakeStoreCalls = { refresh: 0, saved: [] };
	const store: ChatGPTTokenStore = {
		loadTokens: () => tokens,
		saveTokens: async (saved) => {
			calls.saved.push(saved);
		},
		refresh: async (current) => {
			calls.refresh++;
			void current;
			return refreshImpl
				? refreshImpl()
				: { access_token: 'fresh', refresh_token: 'rt-next', expires_at: Date.now() + 600_000 };
		},
	};
	return { store, calls };
}

function fakeJson(body: unknown): StreamResponse {
	return {
		ok: true,
		status: 200,
		json: async () => body,
		text: async () => JSON.stringify(body),
	};
}

function sseResponse(events: unknown[]): StreamResponse {
	const encoder = new TextEncoder();
	const payload = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
	let sent = false;
	return {
		ok: true,
		status: 200,
		json: async () => ({}),
		text: async () => payload,
		body: {
			getReader: () => ({
				read: async () => {
					if (sent) return { done: true as const };
					sent = true;
					return { done: false as const, value: encoder.encode(payload) };
				},
				releaseLock: () => {},
			}),
		},
	};
}
