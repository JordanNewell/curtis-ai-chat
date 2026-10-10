// GCP manager — owns the service-account session and projects the read-only
// Cloud Storage tools into the Curtis ToolRegistry. Mirrors McpManager's
// contract: live settings callbacks, an onToolsChanged callback wired to a
// registry slice replace, and a runtime status for the settings card.
//
// Design notes carried over from MCP:
//  - Tool closures capture the MANAGER, never the token source or storage
//    client. A reconnect/re-auth rebuilds both; every registered
//    ToolDefinition stays valid.
//  - connect() is fire-and-forget from onload: Google being slow must never
//    delay plugin boot. Failures land in status, not throws.

import { requestUrl } from 'obsidian';
import type { ToolDefinition, ToolRegistry } from '../core/tools';
import { parseServiceAccountJson, GcpTokenSource } from './auth';
import { StorageClient } from './storage';
import type { GcpConnectorStatus, GcpServiceAccount } from './types';
import type { HttpSendRequest, HttpSendResponse, HttpSender } from './http';

export interface GcpManagerOptions {
	/** Live master switch (reads plugin settings). */
	isEnabled: () => boolean;
	/** Resolved service-account JSON (keychain or plaintext), '' when unset. */
	getServiceAccountJson: () => string;
	/** Project id for bucket listing; falls back to the key's project_id. */
	getProjectId: () => string;
	/** Injectable HTTP layer (vitest). */
	sender?: HttpSender;
}

/** requestUrl-backed sender — requestUrl is CORS-immune on desktop and
 *  available on mobile, same reasoning as the MCP transport. */
function defaultGcpHttpSender(req: HttpSendRequest): Promise<HttpSendResponse> {
	return requestUrl({
		url: req.url,
		method: req.method,
		headers: req.headers,
		body: req.body,
		throw: false,
	}).then((resp) => ({
		status: resp.status,
		text: resp.text || '',
	}));
}

export class GcpManager {
	/** Fired whenever the GCP tool list may have changed. */
	onToolsChanged?: () => void;

	private status: GcpConnectorStatus = { state: 'disconnected' };
	private serviceAccount?: GcpServiceAccount;
	private tokenSource?: GcpTokenSource;
	private storage?: StorageClient;
	private readonly opts: GcpManagerOptions;
	private readonly sender: HttpSender;

	constructor(opts: GcpManagerOptions) {
		this.opts = opts;
		this.sender = opts.sender ?? defaultGcpHttpSender;
	}

	// ---- Lifecycle ---------------------------------------------------------

	/**
	 * Connect from the CURRENT settings: parse the key, build the token
	 * source, and prime a token so the settings card shows real state (a bad
	 * key or wrong scopes surface immediately, not on first tool call).
	 * Never throws. Safe to call repeatedly.
	 */
	async connect(): Promise<void> {
		if (!this.opts.isEnabled()) {
			this.status = { state: 'disconnected' };
			this.emitToolsChanged();
			return;
		}
		const json = this.opts.getServiceAccountJson();
		if (!json) {
			this.status = { state: 'error', error: 'No service-account key configured — add one in Settings → GCP.' };
			this.emitToolsChanged();
			return;
		}
		this.status = { state: 'connecting' };
		try {
			const serviceAccount = parseServiceAccountJson(json);
			const tokenSource = new GcpTokenSource(serviceAccount, this.sender);
			const storage = new StorageClient({
				getToken: () => tokenSource.getToken(),
				invalidateToken: () => tokenSource.invalidate(),
				sender: this.sender,
			});
			// Prime the token — this validates the key end-to-end.
			await tokenSource.getToken();
			// The master switch may have been flipped off while the token
			// request was in flight — don't resurrect a disabled connector.
			if (!this.opts.isEnabled()) {
				this.status = { state: 'disconnected' };
			} else {
				this.serviceAccount = serviceAccount;
				this.tokenSource = tokenSource;
				this.storage = storage;
				this.status = { state: 'connected', tokenExpiresAt: tokenSource.tokenExpiresAt() };
			}
		} catch (e) {
			this.tokenSource = undefined;
			this.storage = undefined;
			this.status = { state: 'error', error: e instanceof Error ? e.message : String(e) };
		}
		this.emitToolsChanged();
	}

	/** Drop the session (plugin unload, master switch off). */
	async disconnect(): Promise<void> {
		this.serviceAccount = undefined;
		this.tokenSource = undefined;
		this.storage = undefined;
		this.status = { state: 'disconnected' };
		this.emitToolsChanged();
	}

	/** Master switch. On: connect. Off: drop everything. */
	async setEnabled(enabled: boolean): Promise<void> {
		if (enabled) await this.connect();
		else await this.disconnect();
	}

	/** (Re)connect from current settings — the settings Reconnect button and
	 *  the post-save path after editing the key. */
	async refresh(): Promise<GcpConnectorStatus> {
		await this.disconnect();
		await this.connect();
		return this.statusOf();
	}

	// ---- Introspection -----------------------------------------------------

	statusOf(): GcpConnectorStatus {
		return this.status;
	}

	// ---- Tool projection ---------------------------------------------------

	getToolDefinitions(): ToolDefinition[] {
		// Belt to the connect-time guards: the master switch wins even if a
		// stale connected status slipped through a disable race.
		if (!this.opts.isEnabled() || this.status.state !== 'connected' || !this.storage) {
			return [];
		}
		return [
			this.listBucketsTool(),
			this.listObjectsTool(),
			this.readObjectTool(),
		];
	}

	/**
	 * Replace the GCP slice of the registry with the current tool set.
	 * Wired to onToolsChanged by main.ts.
	 */
	syncTools(registry: ToolRegistry): void {
		registry.setGcpTools(this.getToolDefinitions());
	}

	/**
	 * Execute one GCP tool call on behalf of a ToolDefinition closure.
	 * Failures throw — ToolRegistry.executeTool converts throws into is_error
	 * results, which is exactly the semantics tool errors should carry.
	 */
	async callTool(toolName: string, args: Record<string, unknown>): Promise<string> {
		const storage = this.storage;
		if (!storage || this.status.state !== 'connected') {
			throw new Error('GCP connector is not connected — reconnect it in Settings → GCP.');
		}
		switch (toolName) {
			case 'gcp__storage__list_buckets': {
				const projectId = this.projectId();
				if (!projectId) {
					throw new Error('No GCP project id — set one in Settings → GCP.');
				}
				return storage.listBuckets(projectId, {
					maxResults: numArg(args.maxResults, 20),
					pageToken: strArg(args.pageToken) || undefined,
				});
			}
			case 'gcp__storage__list_objects': {
				const bucket = strArg(args.bucket);
				if (!bucket) throw new Error("'bucket' is required.");
				return storage.listObjects(bucket, {
					prefix: strArg(args.prefix) || undefined,
					maxResults: numArg(args.maxResults, 50),
					pageToken: strArg(args.pageToken) || undefined,
				});
			}
			case 'gcp__storage__read_object': {
				const bucket = strArg(args.bucket);
				const object = strArg(args.object);
				if (!bucket || !object) throw new Error("'bucket' and 'object' are required.");
				return storage.readObject(bucket, object);
			}
			default:
				throw new Error(`Unknown GCP tool: ${toolName}`);
		}
	}

	// ---- Internals ---------------------------------------------------------

	/** Settings project id wins; the key's own project_id is the fallback. */
	private projectId(): string {
		return this.opts.getProjectId().trim() || this.serviceAccount?.projectId || '';
	}

	private emitToolsChanged(): void {
		this.onToolsChanged?.();
	}

	private listBucketsTool(): ToolDefinition {
		return {
			name: 'gcp__storage__list_buckets',
			description: 'List Cloud Storage buckets in the connected GCP project.',
			parameters: {
				maxResults: { type: 'number', description: 'Maximum buckets to return (default 20, max 100).' },
				pageToken: { type: 'string', description: 'Page token from a previous call, to get further results.' },
			},
			execute: (params) => this.callTool('gcp__storage__list_buckets', params),
		};
	}

	private listObjectsTool(): ToolDefinition {
		return {
			name: 'gcp__storage__list_objects',
			description: 'List objects in a Cloud Storage bucket, optionally under a prefix (like ls with a path).',
			parameters: {
				bucket: { type: 'string', description: 'Bucket name (without gs://).', required: true },
				prefix: { type: 'string', description: 'Only objects whose names start with this prefix (e.g. "reports/2026/").' },
				maxResults: { type: 'number', description: 'Maximum objects to return (default 50, max 200).' },
				pageToken: { type: 'string', description: 'Page token from a previous call, to get further results.' },
			},
			execute: (params) => this.callTool('gcp__storage__list_objects', params),
		};
	}

	private readObjectTool(): ToolDefinition {
		return {
			name: 'gcp__storage__read_object',
			description: 'Read one Cloud Storage object. Text-like files come back as text; binaries return metadata only.',
			parameters: {
				bucket: { type: 'string', description: 'Bucket name (without gs://).', required: true },
				object: { type: 'string', description: 'Full object path inside the bucket, e.g. "reports/2026/q1.csv".', required: true },
			},
			execute: (params) => this.callTool('gcp__storage__read_object', params),
		};
	}
}

function strArg(v: unknown): string {
	return typeof v === 'string' ? v : '';
}

function numArg(v: unknown, fallback: number): number {
	return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
}
