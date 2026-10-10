// Swarm — leader chats that delegate work to follower agents.
//
// A follower is NOT a new runtime: it is a real, persisted conversation
// driven by a nested agent loop. The leader's spawn_agent tool call blocks
// until the follower finishes and its final report comes back as the tool
// result. Followers run one at a time (v1) — predictable cost, no concurrent
// vault edits, and the leader's Stop tears the whole thing down because the
// nested loop shares the leader's abort signal.
//
// Panes are viewers, never participants: every follower message goes through
// the conversation store, and any pane bound to that conversation re-renders
// off conversation:changed. Closing a follower's pane never orphans a run.

import type CurtisPlugin from '../main';
import type { ToolContext, ToolDefinition } from '../core/tools';
import type { Agent, AIMessage, Conversation, TokenUsage } from '../types';
import { ThinkingStreamSplitter } from '../providers/anthropic';

export const SWARM_TOOL_NAME = 'spawn_agent';

/** Cap on what a follower's report hands back to the leader — the full
 *  transcript stays in the follower conversation, so a long report must not
 *  silently eat the leader's context window. */
const FOLLOWER_RESULT_CAP = 8_000;

interface FollowerRecord {
	conversationId: string;
	leaderId: string;
	task: string;
	status: 'running' | 'done' | 'aborted' | 'error';
}

function str(v: unknown): string {
	return typeof v === 'string' ? v : '';
}

export class SwarmManager {
	private plugin: CurtisPlugin;
	/** Followers spawned during the CURRENT leader generation (one user
	 *  send), keyed by leader conversation id — this is what the cap counts. */
	private currentGeneration = new Map<string, FollowerRecord[]>();
	/** Follower conversation ids with a nested loop in flight — the view
	 *  refuses sends into these panes while the leader owns the thread. */
	private activeFollowers = new Set<string>();

	constructor(plugin: CurtisPlugin) {
		this.plugin = plugin;
	}

	/** Reset the per-send counter at the start of a leader generation.
	 *  Called from callAgentLoop when the conversation is a leader. */
	beginGeneration(leaderId: string): void {
		this.currentGeneration.set(leaderId, []);
	}

	/** True while a swarm-driven nested loop is writing this conversation. */
	isFollowerBusy(conversationId: string): boolean {
		return this.activeFollowers.has(conversationId);
	}

	/** The spawn_agent tool definition. Registered once at startup; visibility
	 *  per conversation is decided in callAgentLoop (leaders only). The
	 *  optional `agent` parameter runs the task as one of the user's named
	 *  agents — its own model, persona, and tool permissions (the roster is
	 *  advertised in the leader's system prompt). */
	buildSpawnTool(): ToolDefinition {
		return {
			name: SWARM_TOOL_NAME,
			description:
				'Spawn a follower agent: a fresh assistant with its own conversation and the vault toolset ' +
				'(read/search/create/edit notes, web search if enabled) that works on ONE task and returns a report. ' +
				'Use it to parallelize self-contained subtasks — researching different parts of the vault, reading ' +
				'several sources, drafting separate sections. Give each follower a complete, standalone task ' +
				'description: it cannot see this conversation. Followers run one at a time and each run costs ' +
				'tokens — do not spawn one for trivial work you can do with a single tool call. Followers cannot ' +
				'spawn further agents. The cap on followers per message is enforced for you: when it is reached, ' +
				'synthesize from what you have instead of retrying.',
			parameters: {
				task: {
					type: 'string',
					description: 'Complete, self-contained instructions for the follower — what to do and what to report back',
					required: true,
				},
				agent: {
					type: 'string',
					description:
						'Optional: exact name of a named agent (see the roster in your context) to run this task as a ' +
						'specialist — it brings its own model, role, and tool permissions. Match the specialist to the ' +
						'subtask; omit to inherit this conversation\'s model.',
					required: false,
				},
			},
			execute: async (params, context) => this.runFollower(str(params.task), context, str(params.agent) || undefined),
		};
	}

	private async runFollower(task: string, ctx: ToolContext, agentRef?: string): Promise<string> {
		const plugin = ctx.plugin;
		if (!plugin) throw new Error('Swarm is not wired up — reload the plugin');
		const leaderId = ctx.conversationId;
		if (!leaderId) throw new Error('spawn_agent requires a bound conversation (leader chat)');

		const leader = plugin.conversationStore.getConversation(leaderId);
		if (!leader || leader.role !== 'leader') {
			throw new Error('spawn_agent is only available in leader chats');
		}

		const cap = Math.max(1, plugin.settings.swarmMaxFollowers);
		const spawned = this.currentGeneration.get(leaderId) ?? [];
		const running = spawned.filter((f) => f.status === 'running');
		if (spawned.length >= cap) {
			throw new Error(
				`Follower cap reached (${spawned.length}/${cap} this message${running.length ? `, ${running.length} still running` : ''}). ` +
					'Synthesize your answer from the reports you already have.'
			);
		}
		if (task.trim().length < 3) {
			throw new Error('Task description is too short — give the follower complete instructions');
		}

		// Named-agent spawn: resolve the specialist up front so a bad name
		// fails loudly (the leader can retry without one) instead of silently
		// degrading to a generic follower.
		let agent: Agent | undefined;
		if (agentRef) {
			agent = plugin.agents.findByRef(agentRef);
			if (!agent) {
				const roster = plugin.agents.getAgents().map((a) => `"${a.name}"`).join(', ');
				throw new Error(
					`No named agent matching "${agentRef}".` + (roster ? ` Available: ${roster}.` : ' No agents are configured.')
				);
			}
		}

		// Routing order: the named agent's own lane wins, then the leader's
		// EFFECTIVE provider/model — the ones this very run is using (via
		// ToolContext), not the conversation metadata, which can lag the
		// pane's current model picker.
		const providerId = agent?.providerId || ctx.providerId || leader.provider;
		const modelId = agent?.modelId || ctx.modelId || leader.model;
		const conv = this.createFollowerConversation(leaderId, providerId, modelId, task, agent);

		const record: FollowerRecord = { conversationId: conv.id, leaderId, task, status: 'running' };
		spawned.push(record);
		this.currentGeneration.set(leaderId, spawned);
		this.activeFollowers.add(conv.id);

		// Best-effort pane: the run is fully functional headless (the
		// conversation persists whatever happens to windows).
		try {
			await plugin.openNewChatPane('tab', conv.id);
		} catch (e) {
			console.warn('[Curtis] Swarm: follower pane did not open:', e);
		}

		// The task IS the follower's first user message — a pane bound to this
		// conversation shows what was asked, not just the work that followed.
		plugin.conversationStore.addMessageTo(conv.id, {
			role: 'user',
			content: task,
			provider: providerId,
			model: modelId,
		});

		let report = '';
		let usage: TokenUsage | undefined;
		let failed: string | undefined;
		// Keep <think>-tagged reasoning out of the report the leader receives.
		const thinking = new ThinkingStreamSplitter();
		try {
			await plugin.callAgentLoop(this.followerMessages(task, agent), modelId, {
				onChunk: (chunk) => {
					report += thinking.push(chunk).answer;
				},
				onUsage: (u) => {
					usage = u;
				},
				onError: (error) => {
					failed = error.message;
					report += `\n\n*[Follower hit an error: ${error.message}]*`;
				},
				onToolCall: (call) => {
					// Every write goes through the store — bound panes update via
					// conversation:changed, and the vault file accumulates the trail.
					plugin.conversationStore.addMessageTo(conv.id, {
						role: 'assistant',
						content: '',
						tool_calls: [call],
						provider: providerId,
						model: modelId,
					});
				},
				onToolResult: (call, result) => {
					plugin.conversationStore.addMessageTo(conv.id, {
						role: 'tool',
						content: result.content,
						tool_call_id: call.id,
						tool_error: result.isError || undefined,
					});
				},
				signal: ctx.signal,
			}, { conversationId: conv.id, providerId });
			record.status = failed ? 'error' : 'done';
		} catch (e) {
			if (e instanceof Error && e.name === 'AbortError') {
				record.status = 'aborted';
				report = report || '';
				plugin.conversationStore.addMessageTo(conv.id, {
					role: 'assistant',
					content: '*[Stopped — the leader was aborted while this agent was working]*',
				});
			} else {
				record.status = 'error';
				failed = e instanceof Error ? e.message : String(e);
			}
		} finally {
			this.activeFollowers.delete(conv.id);
			// The nested loop and the pane open both moved the store's
			// "most recent" pointer — hand it back to the leader.
			plugin.conversationStore.setCurrentConversation(leaderId);
		}

		if (report.trim()) {
			plugin.conversationStore.addMessageTo(conv.id, {
				role: 'assistant',
				content: report,
				...(usage ? { tokens: usage } : {}),
				provider: providerId,
				model: modelId,
			});
		}

		if (record.status === 'aborted') {
			return `Follower "${conv.title}" was stopped because the leader was aborted.`;
		}

		const statusLine = record.status === 'error'
			? `Follower "${conv.title}" finished with an error: ${failed ?? 'unknown error'}. Partial report follows.`
			: `Follower "${conv.title}" finished. Full transcript: conversation "${conv.title}" in chat history.`;
		const body = report.trim() || '(the follower produced no final text — check its transcript)';
		const capped = body.length > FOLLOWER_RESULT_CAP
			? `${body.slice(0, FOLLOWER_RESULT_CAP)}\n\n*[Report truncated at ${FOLLOWER_RESULT_CAP} characters — the full text is in the follower conversation "${conv.title}"]*`
			: body;
		return `${statusLine}\n\n${capped}`;
	}

	private createFollowerConversation(
		leaderId: string,
		providerId: string,
		modelId: string,
		task: string,
		agent?: Agent
	): Conversation {
		const store = this.plugin.conversationStore;
		const conv = store.createConversation(providerId, modelId);
		const taskLabel = `${task.slice(0, 60).trim()}${task.length > 60 ? '…' : ''}`;
		conv.title = agent ? `${agent.name}: ${taskLabel}` : `Agent: ${taskLabel}`;
		conv.role = 'follower';
		conv.leaderId = leaderId;
		if (agent) conv.agentId = agent.id;
		// createConversation points the store's global "most recent" pointer at
		// the follower — a pane opened later must not silently bind to it.
		store.setCurrentConversation(leaderId);
		return conv;
	}

	private followerMessages(task: string, agent?: Agent): AIMessage[] {
		const system =
			'You are a follower agent spawned by a leader conversation inside the user\'s Obsidian vault. ' +
			'You were given exactly one task. Complete it thoroughly using the available tools — read and search ' +
			'notes, create or edit notes only if the task says to — then write a complete, self-contained report ' +
			'that the leader can use without reading your transcript: findings first, then the evidence, with ' +
			'note paths cited. Do not ask questions; make reasonable assumptions and state them.';
		// A named-agent follower wears its persona as the role layer, AFTER the
		// harness framing — same layering as a bound chat (role wins ties).
		const full = agent && agent.systemPrompt.trim()
			? `${system}\n\n# Your role: ${agent.name}\n\n${agent.systemPrompt.trim()}`
			: system;
		return [
			{ role: 'system', content: full },
			{ role: 'user', content: task },
		];
	}
}
