// MCP server mode — agents as tools.
//
// Alongside the vault tools, external MCP clients can run the user's agents
// headlessly: list_agents discovers which agents are enabled for remote
// invocation, run_agent sends one task to one agent and returns its final
// answer. Nothing here imports Obsidian — agent access goes through
// AgentBackendDeps, an adapter the plugin builds over its agent registry and
// runner, so every handler is testable under node and the security boundary
// stays explicit: a client can only reach agents the port exposes.

import type { McpServerBackend, McpToolSpec } from './protocol';

// ---------------------------------------------------------------------------
// Port — what the Obsidian side provides. Deliberately narrow.
// ---------------------------------------------------------------------------

export interface AgentSummary {
	name: string;
	emoji: string;
	description: string;
	model: string;
}

export interface AgentBackendDeps {
	listRemoteAgents(): AgentSummary[];
	/** Run one agent headlessly; resolves with its final answer text.
	 *  Rejects for unknown names or when the gate is off. */
	runAgent(name: string, task: string, maxTurns?: number): Promise<string>;
	/** Upper bound for the run_agent max_turns override (default 20). */
	maxTurnsCap?: number;
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

const DEFAULT_MAX_TURNS_CAP = 20;
const RESULT_TEXT_CAP = 100_000;

const LIST_AGENTS_TOOL: McpToolSpec = {
	name: 'list_agents',
	description:
		"Discover the user's agents that are enabled for remote invocation — each with its " +
		'name, description, and model. Call this before run_agent to get the exact names.',
	inputSchema: { type: 'object', properties: {} },
};

const RUN_AGENT_TOOL: McpToolSpec = {
	name: 'run_agent',
	description:
		"Run one of the user's agents headlessly on a task and get its final answer as text. " +
		"The agent has its own persona and model routing; the task text is sent to that " +
		"agent's model. Use list_agents first for the exact names.",
	inputSchema: {
		type: 'object',
		properties: {
			name: { type: 'string', description: "The agent's exact name from list_agents" },
			task: { type: 'string', description: 'Full instructions for the agent' },
			max_turns: { type: 'number', description: "Optional override of the agent's loop cap (clamped to the server's maximum)" },
		},
		required: ['name', 'task'],
	},
};

/** Build the MCP backend over an agent port. Both tools stay in the catalog
 *  even with an empty roster — an unknown-name call then gets a readable
 *  tool-level error instead of a missing-tool protocol error. */
export function createAgentBackend(deps: AgentBackendDeps): McpServerBackend {
	return {
		// Live read on every call — the roster rides in the description, the
		// only part of tools/list that can change, so clients see roster
		// changes without a reconnect.
		listTools() {
			const agents = deps.listRemoteAgents();
			const rosterNote = agents.length > 0
				? ` Currently enabled: ${agents.map((a) => a.name).join(', ')}.`
				: ' No agents are currently enabled.';
			return [
				{ ...LIST_AGENTS_TOOL, description: LIST_AGENTS_TOOL.description + rosterNote },
				RUN_AGENT_TOOL,
			];
		},
		async callTool(name, args) {
			switch (name) {
				case 'list_agents':
					return listAgents(deps);
				case 'run_agent':
					return runAgent(deps, args);
				default:
					// The dispatcher rejects unknown names before we get here.
					return textResult(`Unknown tool: ${name}`, true);
			}
		},
	};
}

// ---------------------------------------------------------------------------
// Combining — the HTTP layer serves vault tools and agent tools over one MCP
// endpoint; this keeps that wiring declarative and testable.
// ---------------------------------------------------------------------------

/** Merge backends into one: catalogs concatenate in order and a call routes
 *  to the first backend listing the tool. Membership is re-checked on every
 *  call, so gated tools stay live through the combined surface. */
export function combineBackends(backends: McpServerBackend[]): McpServerBackend {
	return {
		listTools: () => backends.flatMap((b) => b.listTools()),
		async callTool(name, args) {
			const owner = backends.find((b) => b.listTools().some((t) => t.name === name));
			// The dispatcher rejects unknown names before we get here.
			if (!owner) return textResult(`Unknown tool: ${name}`, true);
			return owner.callTool(name, args);
		},
	};
}

// ---------------------------------------------------------------------------
// Concurrency gate
// ---------------------------------------------------------------------------

/** Reject when `max` runs are already in flight — a remote client must not
 *  be able to stampede the user's provider bill with parallel calls. */
export function limitConcurrency(
	runner: (name: string, task: string, maxTurns?: number) => Promise<string>,
	max: number
): (name: string, task: string, maxTurns?: number) => Promise<string> {
	let inFlight = 0;
	return (name, task, maxTurns) => {
		if (inFlight >= max) {
			// No queueing — reject now; the backend's rejection handling turns
			// this into an isError tool result the client can show its model.
			return Promise.reject(new Error(`Agent runner is busy (${inFlight} runs in flight) — retry shortly`));
		}
		inFlight++;
		return runner(name, task, maxTurns).finally(() => {
			inFlight--;
		});
	};
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function listAgents(deps: AgentBackendDeps): McpCallResultText {
	const agents = deps.listRemoteAgents();
	if (agents.length === 0) return textResult('No agents are enabled for remote invocation.');
	const lines = agents.map((a) => `- ${a.name} ${a.emoji} — ${a.description} · ${a.model}`);
	return textResult([`${agents.length} agent(s) available for remote invocation:`, ...lines].join('\n'));
}

async function runAgent(deps: AgentBackendDeps, args: Record<string, unknown>): Promise<McpCallResultText> {
	const name = typeof args.name === 'string' ? args.name : '';
	if (!name.trim()) return textResult('run_agent requires a non-empty agent name — call list_agents for the exact names.', true);
	const task = typeof args.task === 'string' ? args.task : '';
	if (!task.trim()) return textResult('run_agent requires a non-empty task.', true);

	const cap = deps.maxTurnsCap ?? DEFAULT_MAX_TURNS_CAP;
	let maxTurns: number | undefined;
	if (args.max_turns !== undefined) {
		if (typeof args.max_turns !== 'number' || !Number.isFinite(args.max_turns)) {
			return textResult('max_turns must be a number.', true);
		}
		maxTurns = Math.min(cap, Math.max(1, Math.floor(args.max_turns)));
	}

	// A runner failure (unknown name, gate off) is a tool result, never a
	// protocol error — the client can show the message to its model.
	try {
		return textResult(await deps.runAgent(name, task, maxTurns));
	} catch (e) {
		return textResult(e instanceof Error ? e.message : String(e), true);
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type McpCallResultText = { content: { type: 'text'; text: string }[]; isError?: boolean };

function textResult(text: string, isError = false): McpCallResultText {
	const result: McpCallResultText = { content: [{ type: 'text', text: text.slice(0, RESULT_TEXT_CAP) }] };
	if (isError) result.isError = true;
	return result;
}
