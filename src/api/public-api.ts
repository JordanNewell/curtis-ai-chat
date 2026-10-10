// Curtis plugin API — the surface other Obsidian plugins consume.
//
// Reachable as `app.plugins.plugins['curtis-ai-chat'].api` once Curtis is
// loaded. Deliberately small and read-mostly: headless runs of the full
// agent loop (chat targets the default assistant, runAgent a named agent),
// vault reads/searches, and memory reads. It shares the MCP server's vault
// port so both inbound surfaces behave identically.
//
// Stability: this object is a public contract. Add things; don't change or
// remove existing members without a major version bump and a docs note.

import type { AIMessage, MemoryFact, TokenUsage } from '../types';
import type CurtisPlugin from '../main';
import { composeSystemPrompt } from '../core/system-prompt';
import { RUN_COMMAND_TOOL } from '../core/command-tools';
import { SWARM_TOOL_NAME } from '../swarm';
import { buildVaultToolPort } from '../mcp/server/manager';
import { findTextHits, safeVaultPath } from '../mcp/server/vault-tools';
import { ThinkingStreamSplitter } from '../providers/anthropic';

export interface CurtisApiChatOptions {
	/** Replaces Curtis's default system prompt (date + core prompt + the
	 *  user's custom extensions). */
	system?: string;
	/** Prior turns to include; roles system/user/assistant. */
	history?: AIMessage[];
	/** Model id (provider-scoped). Defaults to the active chat model. */
	model?: string;
	/** Provider id. Defaults to the active chat provider. */
	providerId?: string;
	/** Agent-loop turn cap. Defaults to the plugin's agentMaxTurns. */
	maxTurns?: number;
	/** Let the loop run shell commands. Off by default for callers that
	 *  can't show the confirmation dialog's context; the user's confirmation
	 *  setting still applies on top of this. */
	allowRunCommand?: boolean;
	/** Abort to cancel mid-loop. */
	signal?: AbortSignal;
	/** Stream the model's text output as it arrives. */
	onChunk?: (chunk: string) => void;
	/** Streams per-request token usage from the underlying loop (each tool
	 *  turn reports its own usage). */
	onUsage?: (usage: TokenUsage) => void;
}

export interface CurtisApiAgentRunOptions {
	/** Agent-loop turn cap. Defaults to the agent's own maxTurns, then the
	 *  plugin's agentMaxTurns. Clamped to 1-20. */
	maxTurns?: number;
	/** Abort to cancel mid-loop. */
	signal?: AbortSignal;
	/** Stream the model's text output as it arrives. */
	onChunk?: (chunk: string) => void;
	/** Streams per-request token usage from the underlying loop (each tool
	 *  turn reports its own usage). */
	onUsage?: (usage: TokenUsage) => void;
	/** Let the loop run shell commands. Off by default for callers that
	 *  can't show the confirmation dialog's context; the user's confirmation
	 *  setting still applies on top of this. */
	allowRunCommand?: boolean;
}

export interface CurtisApiTextHit {
	path: string;
	line: number;
	excerpt: string;
}

export interface CurtisApiSemanticHit {
	path: string;
	snippet: string;
	score: number;
}

export interface CurtisPublicApi {
	/** Curtis plugin version (manifest). */
	readonly version: string;
	/** One headless agent turn-set: send a prompt, get the final text.
	 *  Runs the same loop the chat uses — vault tools, MCP tools, memory —
	 *  without touching any conversation or UI. Rejects with the provider
	 *  error when no authenticated provider is available. */
	chat(prompt: string, options?: CurtisApiChatOptions): Promise<string>;
	/** Headless run of a NAMED agent: its persona, its model routing, and
	 *  its tool ACL all apply. The agent must have "Remote invocation"
	 *  enabled — the same switch that admits MCP clients to run_agent gates
	 *  this method. No history is sent: each call is a fresh engagement.
	 *  Rejects for an unknown agent name, for an agent without remote
	 *  invocation enabled, or with the provider error when the loop fails. */
	runAgent(name: string, task: string, options?: CurtisApiAgentRunOptions): Promise<string>;
	/** Case-insensitive vault text search, ranked (filename hits first). */
	searchNotes(query: string, limit?: number): Promise<CurtisApiTextHit[]>;
	/** Semantic search over the RAG index. Rejects when RAG is disabled. */
	semanticSearch(query: string, topK?: number): Promise<CurtisApiSemanticHit[]>;
	/** Full note text, or null when the path doesn't resolve to a file. */
	readNote(path: string): Promise<string | null>;
	/** Note paths under an optional folder, alphabetically. */
	listNotes(folder?: string, limit?: number): Promise<string[]>;
	/** The user's saved memory facts (read-only copies). */
	getMemory(): MemoryFact[];
}

export function createPublicApi(plugin: CurtisPlugin): CurtisPublicApi {
	return {
		get version(): string {
			return plugin.manifest.version;
		},

		async chat(prompt, options = {}) {
			if (!prompt.trim()) throw new Error('Curtis api.chat: prompt is required');
			const messages: AIMessage[] = [
				{ role: 'system', content: composeSystemPrompt(options.system) },
				...(options.history ?? []),
				{ role: 'user', content: prompt },
			];

			// Headless callers get the full tool loop minus the two tools whose
			// semantics belong to chat sessions: shell (confirmation dialogs a
			// background caller can't frame) and swarm (spawns UI panes).
			const catalog = new Set(plugin.toolRegistry.getAllTools().map((t) => t.name));
			catalog.delete(SWARM_TOOL_NAME);
			if (options.allowRunCommand) {
				catalog.add(RUN_COMMAND_TOOL.name);
			} else {
				catalog.delete(RUN_COMMAND_TOOL.name);
			}

			let output = '';
			// Headless callers get answer text only — <think> sentinels from
			// extended-thinking providers never cross the public API.
			const thinking = new ThinkingStreamSplitter();
			await plugin.callAgentLoop(
				messages,
				options.model ?? plugin.settings.activeModel,
				{
					onChunk: (chunk) => {
						const { answer } = thinking.push(chunk);
						output += answer;
						options.onChunk?.(answer);
					},
					onUsage: options.onUsage,
					signal: options.signal,
				},
				{
					providerId: options.providerId,
					maxTurns: options.maxTurns,
					allowedTools: [...catalog],
				}
			);
			return output;
		},

		async runAgent(name, task, options = {}) {
			if (!task.trim()) throw new Error('Curtis api.runAgent: task is required');
			const agent = plugin.agents.findByRef(name);
			if (!agent) {
				// findByRef returns undefined for both a clean miss and an
				// ambiguous substring ref — split them so callers (and MCP
				// clients through run_agent) get actionable text.
				const q = name.trim().toLowerCase();
				const matches = q ? plugin.settings.agents.filter((a) => a.name.toLowerCase().includes(q)) : [];
				if (matches.length > 1) {
					const names = matches.slice(0, 5).map((a) => a.name).join(', ');
					throw new Error(`Agent reference "${name}" is ambiguous — candidates: ${names}${matches.length > 5 ? ', …' : ''}`);
				}
				throw new Error(`Unknown agent: ${name} — use list_agents for exact names`);
			}
			if (agent.remote !== true) {
				throw new Error(`Agent "${agent.name}" is not enabled for programmatic invocation — enable "Remote invocation" in the agent editor`);
			}

			const messages: AIMessage[] = [
				// No history — a run_agent call is one task, a fresh engagement,
				// not a continuation of anything.
				{ role: 'system', content: composeSystemPrompt(undefined, { name: agent.name, prompt: agent.systemPrompt }) },
				{ role: 'user', content: task },
			];

			// Same headless catalog policy as chat(), then the agent's own ACL
			// on top — its ceiling holds even when the caller would allow more.
			const catalog = new Set(plugin.toolRegistry.getAllTools().map((t) => t.name));
			catalog.delete(SWARM_TOOL_NAME);
			if (options.allowRunCommand) {
				catalog.add(RUN_COMMAND_TOOL.name);
			} else {
				catalog.delete(RUN_COMMAND_TOOL.name);
			}
			const allowedTools = [...catalog].filter((toolName) => plugin.agents.allowsTool(agent, toolName));

			// The `|| undefined` tail matters: an unset lane must reach the loop
			// as undefined (falls back to the active provider), never ''.
			const providerId = agent.providerId || plugin.settings.agentProviderId || undefined;
			const modelId = agent.modelId || plugin.settings.agentModelId || plugin.settings.activeModel;
			const maxTurns = Math.min(20, Math.max(1, options.maxTurns ?? agent.maxTurns ?? plugin.settings.agentMaxTurns));

			let output = '';
			// Same answer-only streaming contract as chat() above.
			const thinking = new ThinkingStreamSplitter();
			await plugin.callAgentLoop(
				messages,
				modelId,
				{
					onChunk: (chunk) => {
						const { answer } = thinking.push(chunk);
						output += answer;
						options.onChunk?.(answer);
					},
					onUsage: options.onUsage,
					signal: options.signal,
				},
				{
					agentId: agent.id,
					providerId,
					maxTurns,
					allowedTools,
				}
			);
			return output;
		},

		async searchNotes(query, limit = 20) {
			const trimmed = query.trim();
			if (!trimmed) return [];
			const hits = await findTextHits(buildVaultToolPort(plugin), trimmed, Math.min(100, Math.max(1, limit)));
			return hits.flatMap((hit) =>
				hit.lines.map((l) => ({ path: hit.path, line: l.line, excerpt: l.text }))
			);
		},

		async semanticSearch(query, topK = 8) {
			if (!plugin.settings.enableRag) {
				throw new Error('Curtis api.semanticSearch: enable RAG in Curtis settings first');
			}
			await plugin.ragIndex.ensureLoaded();
			const results = await plugin.ragIndex.search(query.trim(), Math.min(25, Math.max(1, topK)));
			return results.map((r) => ({ path: r.chunk.filePath, snippet: r.chunk.content, score: r.score }));
		},

		async readNote(path) {
			const safe = safeVaultPath(path);
			if (!safe) return null;
			return buildVaultToolPort(plugin).read(safe);
		},

		async listNotes(folder, limit = 200) {
			const prefix = folder ? safeVaultPath(folder) : '';
			if (folder && !prefix) return [];
			return buildVaultToolPort(plugin)
				.listFiles()
				.map((f) => f.path)
				.filter((p) => (prefix ? p.startsWith(`${prefix}/`) : true))
				.sort()
				.slice(0, Math.min(1000, Math.max(1, limit)));
		},

		getMemory() {
			// Copies — callers must not be able to mutate the live store.
			return plugin.memoryStore.getFacts().map((f) => ({ ...f }));
		},
	};
}
