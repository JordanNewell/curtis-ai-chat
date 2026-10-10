// Platform ports — the seam between @curtis/core (pure TS) and any host
// (Obsidian plugin, VS Code extension, CLI, browser extension).
//
// Phase 1 defines the contracts; the shell supplies implementations. Core
// modules will consume these in phases 3–5, replacing direct use of
// obsidian's requestUrl, Notice, TFile/vault, and app.secretStorage.
// See docs/plans/2026-10-10-headless-core-package.md for the migration map.

/** Non-blocking host notification (Obsidian Notice, VS Code toast, CLI log). */
export interface Notifier {
	show(message: string, durationMs?: number): void;
}

/**
 * Transport-agnostic HTTP client. Core owns selection policy (streaming vs
 * fallback, retry, abort); the host supplies the implementation — e.g. an
 * adapter over obsidian's requestUrl, or plain fetch elsewhere.
 */
export interface HttpFetcher {
	post(url: string, headers: Record<string, string>, body: string, signal?: AbortSignal): Promise<HttpResponse>;
	get(url: string, headers?: Record<string, string>, signal?: AbortSignal): Promise<HttpResponse>;
}

export interface HttpResponse {
	status: number;
	/** Raw response body. Streaming fetchers may return an incrementally-readable body; buffered fetchers return the full text. */
	text: string;
	/** Optional incremental stream, when the host fetcher supports it. */
	stream?: TransportReadable;
	headers?: Record<string, string>;
}

/** Minimal async-readable surface (mirrors types.ts ReadableLike; named distinctly to avoid re-export ambiguity). */
export interface TransportReadable {
	getReader(): TransportReadableReader;
}

export interface TransportReadableReader {
	read(): Promise<{ done: boolean; value?: Uint8Array | string }>;
	cancel?(): Promise<void>;
}

/**
 * Vault/file-system port. Paths are vault-relative, '/'-separated.
 * The Obsidian shell adapts this over App#vault; other hosts map it to
 * their own storage. The core never sees TFile.
 */
export interface VaultFS {
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	exists(path: string): Promise<boolean>;
	list(path: string, options?: { includeFolders?: boolean }): Promise<string[]>;
	delete(path: string): Promise<void>;
}

/** Host secret storage (OS keychain). Obsidian adapts over app.secretStorage. */
export interface SecretStore {
	get(key: string): Promise<string | undefined>;
	set(key: string, value: string): Promise<void>;
	delete(key: string): Promise<void>;
}
