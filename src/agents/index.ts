// Agents — named worker configs: persona + model routing + tool ACL.
//
// An agent is NOT a runtime. It resolves to (system-prompt persona,
// provider/model, tool filter, loop cap, memory participation) at request
// time inside the existing agent loop. Storage is settings.agents
// (data.json): atomic, mobile-safe, rides the declarative settings API.
// The shareable file format (Claude Code-style frontmatter markdown) is an
// export concern, not the store — see docs/plans/2026-10-09-agents.md.
//
// The design invariant: agents never talk to each other directly — every
// collaboration path runs through Curtis (pane switching, the swarm's
// leader, the arena). The lane is the product; the model is a swappable part.

import { Notice, TFile } from 'obsidian';
import type { Agent, AgentToolAcl, Conversation, ToolDefinition } from '../types';
import type CurtisPlugin from '../main';
import { PCP_TEMPLATE, formatClaimsBlock, normalizeClaimsPolicy, parsePcpSections } from './pcp';

/** Vault-scoped tools stripped when an agent's ACL turns the vault off.
 *  Utilities with no data access (get_current_date, calculator) stay —
 *  they leak nothing about the vault. run_command counts as vault-class:
 *  a read-only agent must not reach the shell either. */
const VAULT_TOOLS = new Set([
	'read_note',
	'search_notes',
	'create_note',
	'edit_note',
	'list_notes',
	'get_tags',
	'get_backlinks',
	'get_current_note',
	'semantic_search',
	'run_command',
]);

const WEB_TOOLS = new Set(['web_search', 'read_url']);

/** Which ACL class a tool belongs to. 'free' tools are pure utilities any
 *  agent may call; swarm's spawn_agent is gated separately (leader rule). */
export type ToolClass = 'vault' | 'web' | 'mcp' | 'gcp' | 'free';

export function classifyTool(name: string): ToolClass {
	if (name.startsWith('mcp__')) return 'mcp';
	if (name.startsWith('gcp__')) return 'gcp';
	if (WEB_TOOLS.has(name)) return 'web';
	if (VAULT_TOOLS.has(name)) return 'vault';
	return 'free';
}

/** The effective send config for a conversation — what the view and the
 *  agent loop both derive from an agent binding. */
export interface ResolvedAgent {
	/** The bound agent, or undefined for the default assistant. */
	agent: Agent | undefined;
	/** Persona text for the system prompt (undefined when no agent). */
	persona: string | undefined;
	/** The agent's model routing, when set. */
	providerId: string | undefined;
	modelId: string | undefined;
	/** The agent's tool ceiling, when set. */
	acl: AgentToolAcl | undefined;
	/** Per-agent loop cap override. */
	maxTurns: number | undefined;
}

export class AgentManager {
	private plugin: CurtisPlugin;

	constructor(plugin: CurtisPlugin) {
		this.plugin = plugin;
	}

	getAgents(): Agent[] {
		return this.plugin.settings.agents;
	}

	getAgent(id: string | undefined): Agent | undefined {
		if (!id) return undefined;
		return this.plugin.settings.agents.find((a) => a.id === id);
	}

	/** Resolve a reference from model-facing text (spawn_agent's `agent`
	 *  param, /agent args): exact id, then exact case-insensitive name, then
	 *  unambiguous substring. Ambiguous substring matches fail loudly — the
	 *  caller surfaces the roster rather than guessing. */
	findByRef(ref: string): Agent | undefined {
		const q = ref.trim().toLowerCase();
		if (!q) return undefined;
		const all = this.plugin.settings.agents;
		const byId = all.find((a) => a.id.toLowerCase() === q);
		if (byId) return byId;
		const byName = all.filter((a) => a.name.toLowerCase() === q);
		if (byName.length === 1) return byName[0];
		const bySubstring = all.filter((a) => a.name.toLowerCase().includes(q));
		return bySubstring.length === 1 ? bySubstring[0] : undefined;
	}

	createAgent(init: Partial<Agent> & { name: string }): Agent {
		const agent: Agent = {
			id: `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
			name: init.name,
			emoji: init.emoji || '🤖',
			systemPrompt: init.systemPrompt || '',
			providerId: init.providerId || this.plugin.settings.activeProvider,
			modelId: init.modelId || this.plugin.settings.activeModel,
			tools: { vault: true, web: false, mcp: false, gcp: false, ...(init.tools ?? {}) },
			...(init.temperature !== undefined ? { temperature: init.temperature } : {}),
			...(init.maxTokens !== undefined ? { maxTokens: init.maxTokens } : {}),
			...(init.maxTurns !== undefined ? { maxTurns: init.maxTurns } : {}),
			...(init.remote !== undefined ? { remote: init.remote } : {}),
			memory: init.memory || 'inherit',
			createdAt: Date.now(),
		};
		this.plugin.settings.agents.push(agent);
		void this.plugin.saveSettings();
		return agent;
	}

	updateAgent(id: string, patch: Partial<Omit<Agent, 'id' | 'createdAt'>>): void {
		const agent = this.getAgent(id);
		if (!agent) return;
		Object.assign(agent, patch);
		void this.plugin.saveSettings();
	}

	/** Delete an agent. Conversations keep their agentId — resolution falls
	 *  back to the default assistant, so transcripts never break; the stale
	 *  id stays as attribution history. */
	deleteAgent(id: string): void {
		this.plugin.settings.agents = this.plugin.settings.agents.filter((a) => a.id !== id);
		void this.plugin.saveSettings();
	}

	/** Resolve a conversation's effective agent config. A dangling agentId
	 *  (agent deleted) resolves to the default assistant. */
	resolve(conv?: Conversation): ResolvedAgent {
		const agent = this.getAgent(conv?.agentId);
		if (!agent) {
			return {
				agent: undefined,
				persona: undefined,
				providerId: undefined,
				modelId: undefined,
				acl: undefined,
				maxTurns: undefined,
			};
		}
		return {
			agent,
			persona: agent.systemPrompt.trim() || undefined,
			providerId: agent.providerId || undefined,
			modelId: agent.modelId || undefined,
			acl: agent.tools,
			maxTurns: agent.maxTurns,
		};
	}

	/** Memory participation for a conversation — the tri-state that keeps a
	 *  local-only agent from leaking learned facts into cloud chats via the
	 *  memory file. 'inherit' follows the global toggle. */
	memoryEnabled(conv?: Conversation): boolean {
		const agent = this.getAgent(conv?.agentId);
		if (!agent || agent.memory === 'inherit') return this.plugin.settings.enableMemory;
		return agent.memory === 'on';
	}

	/** PCP-0: read the profile file and render the claims block this agent is
	 *  consented to see. Null when the agent has no policy, the file is
	 *  missing, or nothing qualified — no policy means no injection, ever. */
	async loadConsentedClaimsBlock(agent: Agent): Promise<string | null> {
		const allowed = normalizeClaimsPolicy(agent.claims);
		if (allowed.length === 0) return null;
		const file = this.plugin.app.vault.getAbstractFileByPath(this.plugin.settings.pcpFilePath);
		if (!(file instanceof TFile)) return null;
		const content = await this.plugin.app.vault.read(file);
		return formatClaimsBlock(parsePcpSections(content), allowed);
	}

	/** Open (creating from the starter template when missing) the profile
	 *  file. Used by the settings row; keeps PCP-0 discoverable without a
	 *  dedicated editor UI. */
	async openClaimsFile(): Promise<void> {
		const path = this.plugin.settings.pcpFilePath;
		const existing = this.plugin.app.vault.getAbstractFileByPath(path);
		if (!(existing instanceof TFile)) {
			const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
			if (folder) {
				try {
					await this.plugin.app.vault.createFolder(folder);
				} catch { /* folder may already exist */ }
			}
			await this.plugin.app.vault.create(path, PCP_TEMPLATE);
			new Notice(`Created claims profile: ${path}`);
		}
		await this.plugin.app.workspace.openLinkText(path, '', false);
	}

	/** True when the agent's ACL admits this tool. The registry's membership
	 *  is already the global gate — this only ever narrows. */
	allowsTool(agent: Agent, toolName: string): boolean {
		const cls = classifyTool(toolName);
		if (cls === 'vault') return agent.tools.vault;
		if (cls === 'web') return agent.tools.web;
		if (cls === 'mcp') return agent.tools.mcp;
		if (cls === 'gcp') return agent.tools.gcp;
		return true;
	}

	/** Filter a tool list through an agent's ACL (convenience for callers
	 *  that want one shot). */
	filterTools(tools: ToolDefinition[], agent: Agent): ToolDefinition[] {
		return tools.filter((t) => this.allowsTool(agent, t.name));
	}

	/** System-prompt block advertising the roster to a leader chat — the
	 *  leader can only spawn specialists it knows about. Null when the user
	 *  has no agents; a leader with an empty roster behaves as today. */
	rosterBlock(): string | null {
		const agents = this.plugin.settings.agents;
		if (agents.length === 0) return null;
		const lines = agents.map((a) => {
			const caps: string[] = [];
			caps.push(a.tools.vault ? 'vault' : 'no vault');
			caps.push(a.tools.web ? 'web' : 'no web');
			caps.push(a.tools.mcp ? 'MCP' : 'no MCP');
			caps.push(a.tools.gcp ? 'GCP' : 'no GCP');
			return `- "${a.name}" — tool access: ${caps.join(', ')}`;
		});
		return [
			'[Swarm roster] Named agents are available as specialist followers via the spawn_agent tool\'s optional "agent" parameter (pass the exact name). Each brings its own model and tool permissions:',
			...lines,
			'Match the specialist to the subtask — a web-less agent cannot do web research; a vault-less one only works from its own knowledge. Omit "agent" to spawn a follower with this conversation\'s model.',
		].join('\n');
	}
}
