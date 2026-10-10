import { describe, expect, it } from 'vitest';
import { combineBackends, createAgentBackend, limitConcurrency } from './agent-tools';
import type { AgentBackendDeps, AgentSummary } from './agent-tools';
import type { McpServerBackend } from './protocol';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface RunCall {
	name: string;
	task: string;
	maxTurns?: number;
}

function fakeDeps(overrides: Partial<AgentBackendDeps> = {}): {
	deps: AgentBackendDeps;
	roster: AgentSummary[];
	calls: RunCall[];
} {
	const roster: AgentSummary[] = [
		{ name: 'Researcher', emoji: '🔍', description: 'Digs through sources', model: 'model-a' },
		{ name: 'Writer', emoji: '✏', description: 'Drafts prose', model: 'model-b' },
	];
	const calls: RunCall[] = [];
	const deps: AgentBackendDeps = {
		listRemoteAgents: () => roster,
		runAgent: async (name, task, maxTurns) => {
			calls.push({ name, task, maxTurns });
			if (name === 'Researcher') return `research done: ${task}`;
			throw new Error(`No remote agent named "${name}".`);
		},
		...overrides,
	};
	return { deps, roster, calls };
}

describe('combineBackends', () => {
	function tinyBackend(name: string, answer: string): McpServerBackend {
		return {
			listTools: () => [{ name, description: `${name} tool`, inputSchema: { type: 'object', properties: {} } }],
			callTool: async () => ({ content: [{ type: 'text', text: answer }] }),
		};
	}

	it('merges catalogs in order', () => {
		const merged = combineBackends([tinyBackend('a', 'A'), tinyBackend('b', 'B')]);
		expect(merged.listTools().map((t) => t.name)).toEqual(['a', 'b']);
	});

	it('routes each call to the backend that lists the tool', async () => {
		const merged = combineBackends([tinyBackend('a', 'A'), tinyBackend('b', 'B')]);
		expect((await merged.callTool('a', {})).content[0].text).toBe('A');
		expect((await merged.callTool('b', {})).content[0].text).toBe('B');
	});

	it('routes a duplicated name to the first backend listing it', async () => {
		const merged = combineBackends([tinyBackend('a', 'first'), tinyBackend('a', 'second')]);
		expect((await merged.callTool('a', {})).content[0].text).toBe('first');
	});

	it('answers an unlisted tool with an error result', async () => {
		const merged = combineBackends([tinyBackend('a', 'A')]);
		const res = await merged.callTool('nope', {});
		expect(res.isError).toBe(true);
		expect(res.content[0].text).toBe('Unknown tool: nope');
	});
});

describe('createAgentBackend catalog', () => {
	it('serves list_agents and run_agent even with an empty roster', () => {
		const { deps } = fakeDeps({ listRemoteAgents: () => [] });
		expect(createAgentBackend(deps).listTools().map((t) => t.name)).toEqual(['list_agents', 'run_agent']);
	});

	it('keeps run_agent callable on an empty roster — unknown names error, not missing tool', async () => {
		const { deps } = fakeDeps({ listRemoteAgents: () => [] });
		const res = await createAgentBackend(deps).callTool('run_agent', { name: 'Ghost', task: 'hi' });
		expect(res.isError).toBe(true);
		expect(res.content[0].text).toContain('Ghost');
	});

	it('listTools reads the roster live between calls', () => {
		const { deps, roster } = fakeDeps();
		const backend = createAgentBackend(deps);
		const listDescription = () => backend.listTools().find((t) => t.name === 'list_agents')?.description;
		expect(listDescription()).toContain('Currently enabled: Researcher, Writer.');

		// Mutate the array the dep returns — no rebuild, change shows through.
		roster.length = 0;
		expect(listDescription()).toContain('No agents are currently enabled');
	});
});

describe('list_agents', () => {
	it('formats one line per agent under a count header', async () => {
		const { deps } = fakeDeps();
		const res = await createAgentBackend(deps).callTool('list_agents', {});
		const text = res.content[0].text;
		expect(text).toContain('2 agent(s) available for remote invocation:');
		expect(text).toContain('- Researcher 🔍 — Digs through sources · model-a');
		expect(text).toContain('- Writer ✏ — Drafts prose · model-b');
	});

	it('reports an empty roster', async () => {
		const { deps } = fakeDeps({ listRemoteAgents: () => [] });
		const res = await createAgentBackend(deps).callTool('list_agents', {});
		expect(res.content[0].text).toBe('No agents are enabled for remote invocation.');
	});
});

describe('run_agent', () => {
	it('returns the runner text on the happy path', async () => {
		const { deps, calls } = fakeDeps();
		const res = await createAgentBackend(deps).callTool('run_agent', { name: 'Researcher', task: 'find sources' });
		expect(res.content[0].text).toBe('research done: find sources');
		expect(res.isError).toBeUndefined();
		expect(calls).toEqual([{ name: 'Researcher', task: 'find sources', maxTurns: undefined }]);
	});

	it('refuses missing or empty name/task before calling the runner', async () => {
		const { deps, calls } = fakeDeps();
		const backend = createAgentBackend(deps);
		expect((await backend.callTool('run_agent', {})).isError).toBe(true);
		expect((await backend.callTool('run_agent', { name: '', task: 'x' })).isError).toBe(true);
		expect((await backend.callTool('run_agent', { name: 'Researcher' })).isError).toBe(true);
		expect((await backend.callTool('run_agent', { name: 'Researcher', task: '   ' })).isError).toBe(true);
		expect(calls).toHaveLength(0);
	});

	it('clamps max_turns into 1..20 by default', async () => {
		const { deps, calls } = fakeDeps();
		const backend = createAgentBackend(deps);
		await backend.callTool('run_agent', { name: 'Researcher', task: 't', max_turns: 500 });
		expect(calls[0].maxTurns).toBe(20);
		await backend.callTool('run_agent', { name: 'Researcher', task: 't', max_turns: 0 });
		expect(calls[1].maxTurns).toBe(1);
	});

	it('honors a custom maxTurnsCap', async () => {
		const { deps, calls } = fakeDeps({ maxTurnsCap: 50 });
		await createAgentBackend(deps).callTool('run_agent', { name: 'Researcher', task: 't', max_turns: 500 });
		expect(calls[0].maxTurns).toBe(50);
	});

	it('refuses a non-number max_turns before calling the runner', async () => {
		const { deps, calls } = fakeDeps();
		const res = await createAgentBackend(deps).callTool('run_agent', { name: 'Researcher', task: 't', max_turns: 'x' });
		expect(res.isError).toBe(true);
		expect(calls).toHaveLength(0);
	});

	it('turns a runner rejection into an error result, not a throw', async () => {
		const { deps } = fakeDeps();
		const res = await createAgentBackend(deps).callTool('run_agent', { name: 'Ghost', task: 't' });
		expect(res.isError).toBe(true);
		expect(res.content[0].text).toContain('No remote agent named "Ghost".');
	});
});

describe('limitConcurrency', () => {
	interface Deferred<T> {
		promise: Promise<T>;
		resolve: (value: T) => void;
		reject: (e: unknown) => void;
	}

	function deferred<T>(): Deferred<T> {
		let resolve!: (value: T) => void;
		let reject!: (e: unknown) => void;
		const promise = new Promise<T>((res, rej) => {
			resolve = res;
			reject = rej;
		});
		return { promise, resolve, reject };
	}

	it('passes arguments through to the runner', async () => {
		const calls: RunCall[] = [];
		const gated = limitConcurrency(async (name, task, maxTurns) => {
			calls.push({ name, task, maxTurns });
			return `ran ${name}`;
		}, 2);
		await expect(gated('Researcher', 'find sources', 7)).resolves.toBe('ran Researcher');
		expect(calls).toEqual([{ name: 'Researcher', task: 'find sources', maxTurns: 7 }]);
	});

	it('rejects at the cap without queueing, admits the next run once a slot frees', async () => {
		const gates: Deferred<string>[] = [];
		const gated = limitConcurrency(() => {
			const gate = deferred<string>();
			gates.push(gate);
			return gate.promise;
		}, 2);

		const first = gated('a', 't1');
		const second = gated('b', 't2');
		expect(gates).toHaveLength(2);
		await expect(gated('c', 't3')).rejects.toThrow('Agent runner is busy (2 runs in flight) — retry shortly');
		expect(gates).toHaveLength(2); // rejected at entry — the runner never saw it

		gates[0].resolve('one');
		await expect(first).resolves.toBe('one');
		const fourth = gated('d', 't4'); // the freed slot
		expect(gates).toHaveLength(3);
		gates[1].resolve('two');
		gates[2].resolve('four');
		await expect(second).resolves.toBe('two');
		await expect(fourth).resolves.toBe('four');
	});

	it('frees the slot when a run rejects, not only when it resolves', async () => {
		let started = 0;
		const gated = limitConcurrency(() => {
			started++;
			return Promise.reject(new Error(`run ${started} failed`));
		}, 2);
		await expect(gated('a', 't1')).rejects.toThrow('run 1 failed');
		await expect(gated('b', 't2')).rejects.toThrow('run 2 failed');
		// If the slot had leaked, this call would get the busy message instead.
		await expect(gated('c', 't3')).rejects.toThrow('run 3 failed');
	});
});
