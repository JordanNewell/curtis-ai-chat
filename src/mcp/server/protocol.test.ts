import { describe, expect, it } from 'vitest';
import {
	handleJsonRpcMessage,
	rpcParseErrorResponse,
	MCP_SERVER_PROTOCOL_VERSION,
	RPC_ERRORS,
} from './protocol';
import type { McpServerBackend, McpToolSpec } from './protocol';

const SERVER_INFO = { name: 'curtis-test', version: '0.0.1' };

const CATALOG: McpToolSpec[] = [
	{ name: 'echo', description: 'Echo back', inputSchema: { type: 'object' } },
];

const backend: McpServerBackend = {
	listTools: () => CATALOG,
	async callTool(name, args) {
		if (name === 'echo') {
			if (args.boom === true) throw new Error('kaboom');
			return { content: [{ type: 'text', text: `echo:${JSON.stringify(args)}` }] };
		}
		return { content: [{ type: 'text', text: '??' }], isError: true };
	},
};

function req(method: string, params?: unknown, id: string | number = 1): unknown {
	return { jsonrpc: '2.0', id, method, params };
}

describe('handleJsonRpcMessage — handshake', () => {
	it('initializes with capabilities and server info', async () => {
		const res = await handleJsonRpcMessage(
			req('initialize', { protocolVersion: MCP_SERVER_PROTOCOL_VERSION }),
			backend,
			SERVER_INFO
		);
		expect(res?.error).toBeUndefined();
		expect(res?.result).toMatchObject({
			protocolVersion: MCP_SERVER_PROTOCOL_VERSION,
			serverInfo: SERVER_INFO,
			capabilities: { tools: { listChanged: false } },
		});
	});

	it('negotiates down to an older supported version', async () => {
		const res = await handleJsonRpcMessage(req('initialize', { protocolVersion: '2025-03-26' }), backend, SERVER_INFO);
		expect((res?.result as { protocolVersion: string }).protocolVersion).toBe('2025-03-26');
	});

	it('falls back to its own newest version on an unknown request', async () => {
		const res = await handleJsonRpcMessage(req('initialize', { protocolVersion: '1999-01-01' }), backend, SERVER_INFO);
		expect((res?.result as { protocolVersion: string }).protocolVersion).toBe(MCP_SERVER_PROTOCOL_VERSION);
	});
});

describe('handleJsonRpcMessage — tools', () => {
	it('lists the catalog', async () => {
		const res = await handleJsonRpcMessage(req('tools/list'), backend, SERVER_INFO);
		expect(res?.result).toEqual({ tools: CATALOG });
	});

	it('calls a tool and wraps the result', async () => {
		const res = await handleJsonRpcMessage(req('tools/call', { name: 'echo', arguments: { a: 1 } }), backend, SERVER_INFO);
		expect(res?.result).toEqual({ content: [{ type: 'text', text: 'echo:{"a":1}' }] });
	});

	it('defaults missing arguments to an empty object', async () => {
		const res = await handleJsonRpcMessage(req('tools/call', { name: 'echo' }), backend, SERVER_INFO);
		expect(res?.result).toEqual({ content: [{ type: 'text', text: 'echo:{}' }] });
	});

	it('reports a throwing tool as an isError result, not a protocol error', async () => {
		const res = await handleJsonRpcMessage(req('tools/call', { name: 'echo', arguments: { boom: true } }), backend, SERVER_INFO);
		expect(res?.error).toBeUndefined();
		expect(res?.result).toMatchObject({ isError: true });
		expect((res?.result as { content: { text: string }[] }).content[0].text).toBe('kaboom');
	});

	it('rejects an unknown tool with invalid params', async () => {
		const res = await handleJsonRpcMessage(req('tools/call', { name: 'nope' }), backend, SERVER_INFO);
		expect(res?.error?.code).toBe(RPC_ERRORS.INVALID_PARAMS);
	});

	it('rejects a tools/call without a name', async () => {
		const res = await handleJsonRpcMessage(req('tools/call', {}), backend, SERVER_INFO);
		expect(res?.error?.code).toBe(RPC_ERRORS.INVALID_PARAMS);
	});

	it('rejects non-object arguments', async () => {
		const res = await handleJsonRpcMessage(req('tools/call', { name: 'echo', arguments: [1] }), backend, SERVER_INFO);
		expect(res?.error?.code).toBe(RPC_ERRORS.INVALID_PARAMS);
	});
});

describe('handleJsonRpcMessage — protocol edges', () => {
	it('answers ping with an empty result', async () => {
		const res = await handleJsonRpcMessage(req('ping'), backend, SERVER_INFO);
		expect(res?.result).toEqual({});
	});

	it('returns null for notifications (initialized and unknown)', async () => {
		expect(await handleJsonRpcMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, backend, SERVER_INFO)).toBeNull();
		expect(await handleJsonRpcMessage({ jsonrpc: '2.0', method: 'notifications/whatever' }, backend, SERVER_INFO)).toBeNull();
	});

	it('rejects batches — removed from the 2025-06-18 spec', async () => {
		const res = await handleJsonRpcMessage([req('ping')], backend, SERVER_INFO);
		expect(res?.error?.code).toBe(RPC_ERRORS.INVALID_REQUEST);
	});

	it('rejects non-JSON-RPC envelopes', async () => {
		expect((await handleJsonRpcMessage('hello', backend, SERVER_INFO))?.error?.code).toBe(RPC_ERRORS.INVALID_REQUEST);
		expect((await handleJsonRpcMessage({ jsonrpc: '1.0', id: 1, method: 'ping' }, backend, SERVER_INFO))?.error?.code).toBe(RPC_ERRORS.INVALID_REQUEST);
		expect((await handleJsonRpcMessage({ jsonrpc: '2.0', id: 1 }, backend, SERVER_INFO))?.error?.code).toBe(RPC_ERRORS.INVALID_REQUEST);
		expect((await handleJsonRpcMessage({ jsonrpc: '2.0', id: true, method: 'ping' }, backend, SERVER_INFO))?.error?.code).toBe(RPC_ERRORS.INVALID_REQUEST);
	});

	it('rejects unknown methods', async () => {
		const res = await handleJsonRpcMessage(req('resources/list'), backend, SERVER_INFO);
		expect(res?.error?.code).toBe(RPC_ERRORS.METHOD_NOT_FOUND);
	});

	it('builds a parse error response with a null id', () => {
		const res = rpcParseErrorResponse();
		expect(res.error?.code).toBe(RPC_ERRORS.PARSE);
		expect(res.id).toBeNull();
	});
});
