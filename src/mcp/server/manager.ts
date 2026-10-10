// MCP server mode — lifecycle + the Obsidian side of the vault port.
//
// The manager owns the HTTP server, builds the VaultToolPort adapter over
// app.vault / RAG / memory, and maps settings onto all of it: the enable
// toggle starts and stops, the writes toggle re-syncs the tool catalog,
// the token regenerates. Desktop only — everything here is a no-op (or an
// honest error) where Obsidian cannot listen on ports.

import { Notice, Platform, TFile, TFolder } from 'obsidian';
import type CurtisPlugin from '../../main';
import { McpHttpServer } from './server';
import { createVaultBackend } from './vault-tools';
import { createAgentBackend, combineBackends, limitConcurrency } from './agent-tools';
import type { VaultToolPort } from './vault-tools';

export interface McpServerStatus {
	running: boolean;
	error?: string;
}

/** One remote agent run started by an MCP client — kept in memory for the
 *  settings UI. Completion is the audit event: no start Notice (too chatty
 *  for cron-driven clients), one completion Notice per run. */
export interface RemoteRunEntry {
	agent: string;
	task: string;        // first 80 chars, whitespace-collapsed
	startedAt: number;   // epoch ms
	durationMs?: number; // set on completion
	ok: boolean;
	chars?: number;      // response length on success
	error?: string;      // message on failure
}

const REMOTE_RUN_CONCURRENCY = 2;
const REMOTE_RUN_LOG_CAP = 20;
const REMOTE_RUN_TASK_CHARS = 80;

export class McpServerManager {
	private http: McpHttpServer | null = null;
	private lastError: string | undefined;
	private starting: Promise<void> | null = null;
	// Ring buffer of recent remote agent runs, newest first (settings UI reads it).
	private remoteRuns: RemoteRunEntry[] = [];

	constructor(private plugin: CurtisPlugin) {}

	generateToken(): string {
		return crypto.randomUUID().replace(/-/g, '');
	}

	status(): McpServerStatus {
		return { running: this.http?.running ?? false, error: this.lastError };
	}

	connectionUrl(): string {
		return `http://127.0.0.1:${this.plugin.settings.mcpServerPort}/mcp`;
	}

	/** Idempotent start: binds the port, or restarts onto new settings when
	 *  already running (port/token/writes changes funnel through here). */
	async start(): Promise<void> {
		if (this.starting) return this.starting;
		this.starting = this.doStart().finally(() => {
			this.starting = null;
		});
		return this.starting;
	}

	private async doStart(): Promise<void> {
		if (!Platform.isDesktopApp) {
			throw new Error('The MCP server is desktop-only — mobile Obsidian cannot listen on ports');
		}
		const s = this.plugin.settings;
		// First start mints the token; every later start uses the stored one.
		if (!s.mcpServerToken) {
			s.mcpServerToken = this.generateToken();
			await this.plugin.saveSettings();
		}
		await this.stop();
		this.lastError = undefined;
		const server = new McpHttpServer({
			port: s.mcpServerPort,
			token: s.mcpServerToken,
			backend: this.buildBackend(),
			serverInfo: { name: 'curtis-ai-chat', version: this.plugin.manifest.version },
		});
		try {
			await server.start();
		} catch (e) {
			this.lastError = e instanceof Error ? e.message : String(e);
			throw e;
		}
		this.http = server;
		new Notice(`Curtis MCP server running on ${this.connectionUrl()}`);
	}

	async stop(): Promise<void> {
		if (!this.http) return;
		const server = this.http;
		this.http = null;
		await server.stop();
	}

	/** Re-serve the catalog after a settings change (writes toggle) without
	 *  bouncing the socket. A stopped server just picks it up on next start. */
	async syncTools(): Promise<void> {
		if (!this.http) return;
		this.http.setBackend(this.buildBackend());
	}

	/** Vault tools + agent tools in one catalog. The agent slice reads
	 *  settings live (listRemoteAgents runs per tools/list), so roster and
	 *  Remote-invocation changes appear without a reconnect. */
	private buildBackend() {
		return combineBackends([
			createVaultBackend(buildVaultToolPort(this.plugin), {
				allowWrites: this.plugin.settings.mcpServerAllowWrites,
			}),
			createAgentBackend({
				listRemoteAgents: () =>
					this.plugin.settings.agents
						.filter((a) => a.remote)
						.map((a) => ({
							name: a.name,
							emoji: a.emoji,
							description: agentDescription(a.systemPrompt),
							model: a.modelId || 'active model',
						})),
				runAgent: this.wrapRemoteRunner(),
			}),
		]);
	}

	/** Copies of the recent remote runs, newest first — for the settings UI. */
	recentRemoteRuns(): RemoteRunEntry[] {
		return this.remoteRuns.map((e) => ({ ...e }));
	}

	/** Append a completed run to the log (oldest dropped past the cap) and
	 *  show the one completion Notice. Called only on completion, never at
	 *  start — a start Notice would be too chatty for cron-driven clients. */
	private recordRemoteRun(entry: RemoteRunEntry): void {
		this.remoteRuns.unshift(entry);
		if (this.remoteRuns.length > REMOTE_RUN_LOG_CAP) this.remoteRuns.length = REMOTE_RUN_LOG_CAP;
		if (entry.ok) {
			const secs = ((entry.durationMs ?? 0) / 1000).toFixed(1);
			new Notice(`Curtis: "${entry.agent}" finished a remote run — ${entry.chars} chars in ${secs}s`);
		} else {
			new Notice(`Curtis: remote run of "${entry.agent}" failed — ${entry.error}`);
		}
	}

	/** The remote run_agent dep, composed: the raw api call behind a
	 *  concurrency gate (parallel MCP clients must not stampede the provider
	 *  bill), then a logger that turns each run into a log entry. */
	private wrapRemoteRunner(): (name: string, task: string, maxTurns?: number) => Promise<string> {
		const gated = limitConcurrency(
			(name, task, maxTurns) => this.plugin.api.runAgent(name, task, { maxTurns }),
			REMOTE_RUN_CONCURRENCY
		);
		return async (name, task, maxTurns) => {
			const entry: RemoteRunEntry = {
				agent: name,
				task: task.replace(/\s+/g, ' ').trim().slice(0, REMOTE_RUN_TASK_CHARS),
				startedAt: Date.now(),
				ok: false,
			};
			try {
				const text = await gated(name, task, maxTurns);
				this.recordRemoteRun({ ...entry, ok: true, durationMs: Date.now() - entry.startedAt, chars: text.length });
				return text;
			} catch (e) {
				this.recordRemoteRun({ ...entry, durationMs: Date.now() - entry.startedAt, error: e instanceof Error ? e.message : String(e) });
				throw e;
			}
		};
	}

	// -------------------------------------------------------------------------

	private async ensureFolder(filePath: string): Promise<void> {
		const segments = filePath.split('/').slice(0, -1);
		for (let i = 1; i <= segments.length; i++) {
			const prefix = segments.slice(0, i).join('/');
			const existing = this.plugin.app.vault.getAbstractFileByPath(prefix);
			if (existing instanceof TFolder) continue;
			if (existing) throw new Error(`"${prefix}" exists but is not a folder`);
			await this.plugin.app.vault.createFolder(prefix);
		}
	}
}

/** The Obsidian-backed VaultToolPort — shared by the MCP server and the
 *  plugin API so both surfaces see exactly the same vault behavior. */
export function buildVaultToolPort(plugin: CurtisPlugin): VaultToolPort {
	const app = plugin.app;
	const port: VaultToolPort = {
		listFiles: () =>
			app.vault.getMarkdownFiles().map((f) => ({ path: f.path, mtime: f.stat.mtime })),
		read: async (path) => {
			const file = app.vault.getAbstractFileByPath(path);
			return file instanceof TFile ? app.vault.cachedRead(file) : null;
		},
		write: async (path, content, mode) => {
			const existing = app.vault.getAbstractFileByPath(path);
			if (existing instanceof TFile) {
				if (mode === 'create') return 'exists';
				if (mode === 'append') {
					const current = await app.vault.read(existing);
					await app.vault.modify(existing, current + (current && !current.endsWith('\n') ? '\n' : '') + content);
					return 'appended';
				}
				await app.vault.modify(existing, content);
				return 'written';
			}
			// Missing note: create/overwrite create it; append creates too —
			// appending to nothing is creating.
			await ensureFolder(plugin, path);
			await app.vault.create(path, content);
			return 'created';
		},
	};
	if (plugin.settings.enableRag) {
		port.semanticSearch = async (query, topK) => {
			await plugin.ragIndex.ensureLoaded();
			const results = await plugin.ragIndex.search(query, topK);
			return results.map((r) => ({
				path: r.chunk.filePath,
				snippet: r.chunk.content,
				score: r.score,
			}));
		};
	}
	port.memoryFacts = () =>
		plugin.memoryStore.getFacts().map((f) => ({
			content: f.content,
			category: f.category,
			timestamp: f.timestamp,
		}));
	return port;
}

/** Create parent folders for a vault-relative file path (no-op when the
 *  folder chain already exists). */
async function ensureFolder(plugin: CurtisPlugin, filePath: string): Promise<void> {
	const segments = filePath.split('/').slice(0, -1);
	for (let i = 1; i <= segments.length; i++) {
		const prefix = segments.slice(0, i).join('/');
		const existing = plugin.app.vault.getAbstractFileByPath(prefix);
		if (existing instanceof TFolder) continue;
		if (existing) throw new Error(`"${prefix}" exists but is not a folder`);
		await plugin.app.vault.createFolder(prefix);
	}
}

/** One-line roster description from an agent's persona prompt. */
function agentDescription(prompt: string): string {
	const flat = prompt.replace(/\s+/g, ' ').trim();
	return flat.length > 140 ? `${flat.slice(0, 140)}…` : flat;
}
