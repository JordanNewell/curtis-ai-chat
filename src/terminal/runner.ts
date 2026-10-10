// Terminal runner — the desktop shell-execution core.
//
// One implementation serves both consumers: the terminal pane (user-typed,
// human-paced) and the run_command agent tool (model-typed, confirmation-
// gated in callAgentLoop). Tier 1 design: each command is a fresh
// `child_process.spawn` through the platform shell — no persistent session,
// no PTY, no native modules. Exit codes, timeouts and output caps are
// exact; interactive TUI programs are explicitly out of scope (that is the
// node-pty tier).
//
// Node is reached through window.require like the network transport
// (src/providers/transport.ts) — never a static import, so the bundle stays
// loadable on mobile where child_process doesn't exist.

import { FileSystemAdapter, Platform } from 'obsidian';
import type { App } from 'obsidian';

/** Per-stream capture cap. Matches read_url's budget — providers cap
 *  context, and a runaway `cat` must not eat a conversation. */
export const MAX_OUTPUT_CHARS = 8000;

/**
 * Minimal surfaces of the Node modules we consume. Defined inline (instead
 * of `typeof import('child_process')`) so the types resolve without
 * @types/node in the mobile renderer's environment.
 */
/** Structural stand-in for Buffer — enough to decode text without
 *  depending on the Node global type being in scope. */
interface NodeStreamChunk {
	toString(encoding?: string): string;
}

interface NodeReadable {
	on(event: 'data', listener: (chunk: NodeStreamChunk) => void): unknown;
	on(event: 'end', listener: () => void): unknown;
	/** Drain the stream once the capture cap is hit — without this the child
	 *  can deadlock on a full pipe and never exit. */
	resume(): unknown;
}

interface NodeChildProcess {
	pid: number | undefined;
	stdout: NodeReadable | null;
	stderr: NodeReadable | null;
	on(event: 'error', listener: (err: Error) => void): unknown;
	on(event: 'exit', listener: (code: number | null, signal: string | null) => void): unknown;
	kill(signal?: string): boolean;
}

interface ChildProcessModule {
	spawn(
		file: string,
		args: string[],
		options: { cwd?: string; windowsHide?: boolean; windowsVerbatimArguments?: boolean }
	): NodeChildProcess;
}

interface NodePathModule {
	isAbsolute(p: string): boolean;
	join(...parts: string[]): string;
	resolve(...parts: string[]): string;
	basename(p: string): string;
	sep: string;
}

interface ElectronRequire {
	(moduleName: 'child_process'): ChildProcessModule;
	(moduleName: 'path'): NodePathModule;
	(moduleName: string): unknown;
}

function nodeRequire(): ElectronRequire | undefined {
	if (!Platform.isDesktopApp) return undefined;
	try {
		const req = (window as unknown as { require?: ElectronRequire }).require;
		return typeof req === 'function' ? req : undefined;
	} catch {
		return undefined;
	}
}

/** Node's path module, or undefined where Node doesn't exist (mobile). */
export function getNodePath(): NodePathModule | undefined {
	const req = nodeRequire();
	if (!req) return undefined;
	try {
		return req('path');
	} catch {
		return undefined;
	}
}

/** True when Obsidian is running on Windows. Reads process.platform off the
 *  desktop renderer — the only environment where shells exist anyway. */
export function isWindows(): boolean {
	try {
		const p = (window as unknown as { process?: { platform?: string } }).process?.platform;
		return p === 'win32';
	} catch {
		return false;
	}
}

/** Absolute path of the vault on disk (desktop only). */
export function vaultBasePath(app: App): string | undefined {
	const adapter = app.vault.adapter;
	return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : undefined;
}

/** True when the path exists on disk (desktop only; false on mobile —
 *  callers there check the vault API instead). Used to sanity-check a
 *  restored terminal cwd before it becomes a spawn's working directory. */
export function fsPathExists(p: string): boolean {
	try {
		const req = nodeRequire();
		if (!req) return false;
		const fs = req('fs') as { existsSync(path: string): boolean };
		return fs.existsSync(p);
	} catch {
		return false;
	}
}

export interface ShellRunOptions {
	command: string;
	/** Working directory (absolute). Callers resolve it — the pane tracks its
	 *  own cwd; the tool resolves against the vault root. */
	cwd?: string;
	timeoutMs?: number;
	signal?: AbortSignal;
	/** Live-output tap, called per decoded chunk while the process runs.
	 *  Falls silent for a stream once its capture cap is hit (the matching
	 *  *Truncated flag explains why). The pane streams with this; the agent
	 *  tool omits it and reads the finished result. */
	onOutput?: (stream: 'stdout' | 'stderr', text: string) => void;
}

export interface ShellRunResult {
	stdout: string;
	stderr: string;
	/** null when the process was killed (timeout/stop) before exiting. */
	exitCode: number | null;
	timedOut: boolean;
	stdoutTruncated: boolean;
	stderrTruncated: boolean;
}

/** One concrete shell invocation attempt. */
interface ShellInvocation {
	file: string;
	args: string[];
	/** Pass the command through to Windows verbatim (cmd.exe /s semantics). */
	verbatim: boolean;
}

function cmdInvocation(command: string): ShellInvocation {
	return { file: 'cmd.exe', args: ['/d', '/s', '/c', command], verbatim: true };
}

function powershellInvocation(file: string, command: string): ShellInvocation {
	return {
		file,
		args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
		verbatim: true,
	};
}

function posixInvocation(file: string, command: string): ShellInvocation {
	return { file, args: ['-c', command], verbatim: false };
}

/**
 * Resolve the user's shell setting ('' = auto, 'cmd', 'powershell', 'pwsh',
 * or a custom executable path) into concrete spawn attempts. Unix auto
 * returns bash first with sh as the ENOENT fallback. An unsupported combo
 * (cmd on Unix) returns [] and the caller raises.
 */
function resolveShellInvocations(shellSetting: string, command: string): ShellInvocation[] {
	const setting = shellSetting.trim();
	const win = isWindows();
	const bare = setting.toLowerCase().replace(/\.exe$/, '');

	if (!setting) {
		return win ? [cmdInvocation(command)] : [posixInvocation('/bin/bash', command), posixInvocation('/bin/sh', command)];
	}
	if (bare === 'cmd') return win ? [cmdInvocation(command)] : [];
	if (bare === 'powershell') return [powershellInvocation(win ? 'powershell.exe' : 'pwsh', command)];
	if (bare === 'pwsh') return [powershellInvocation('pwsh', command)];
	// Custom executable path. Classify by name so cmd.exe/pwsh copies get
	// their native argument style; anything else is treated as a POSIX shell
	// (covers git-bash.exe, zsh, busybox sh…).
	if (bare.endsWith('cmd')) return win ? [cmdInvocation(command)] : [];
	if (bare.endsWith('powershell') || bare.endsWith('pwsh')) {
		return [powershellInvocation(setting, command)];
	}
	return win
		? [{ file: setting, args: ['-c', command], verbatim: false }]
		: [posixInvocation(setting, command)];
}

/** Short badge text for the shell the setting resolves to. */
export function shellLabel(shellSetting: string): string {
	const setting = shellSetting.trim();
	if (!setting) return isWindows() ? 'cmd' : 'bash';
	const bare = setting.toLowerCase().replace(/\.exe$/, '');
	if (bare === 'cmd' || bare.endsWith('cmd')) return 'cmd';
	if (bare === 'powershell' || bare.endsWith('powershell')) return 'powershell';
	if (bare === 'pwsh' || bare.endsWith('pwsh')) return 'pwsh';
	const parts = setting.split(/[\\/]/);
	return parts[parts.length - 1] || 'shell';
}

function isSpawnMissingError(err: Error): boolean {
	return err.message.includes('ENOENT') || err.message.includes('spawn');
}

/**
 * Run one shell command to completion. Resolves with captured output and
 * the exit code; a killed process (timeout or abort) resolves with
 * exitCode null rather than rejecting — callers decide how to phrase it.
 * Rejects only when the shell itself cannot be started (or Node/mobile).
 */
export async function runShellCommand(opts: ShellRunOptions, shellSetting: string): Promise<ShellRunResult> {
	const req = nodeRequire();
	if (!req) throw new Error('Shell execution requires Obsidian desktop.');
	const cp = req('child_process');
	const attempts = resolveShellInvocations(shellSetting, opts.command);
	if (attempts.length === 0) {
		throw new Error(`Shell "${shellSetting}" is not available on this platform.`);
	}

	let lastError: Error | undefined;
	for (let i = 0; i < attempts.length; i++) {
		try {
			return await spawnOnce(cp, attempts[i], opts);
		} catch (e) {
			lastError = e instanceof Error ? e : new Error(String(e));
			// The bash→sh fallback exists only for a missing primary shell;
			// any other failure (bad cwd, abort) is final.
			if (i === attempts.length - 1 || !isSpawnMissingError(lastError)) throw lastError;
		}
	}
	throw lastError ?? new Error('Command failed to start.');
}

function spawnOnce(cp: ChildProcessModule, invocation: ShellInvocation, opts: ShellRunOptions): Promise<ShellRunResult> {
	return new Promise<ShellRunResult>((resolve, reject) => {
		let child: NodeChildProcess;
		try {
			child = cp.spawn(invocation.file, invocation.args, {
				cwd: opts.cwd,
				windowsHide: true,
				windowsVerbatimArguments: invocation.verbatim,
			});
		} catch (e) {
			reject(e instanceof Error ? e : new Error(String(e)));
			return;
		}

		const result: ShellRunResult = {
			stdout: '',
			stderr: '',
			exitCode: null,
			timedOut: false,
			stdoutTruncated: false,
			stderrTruncated: false,
		};

		let settled = false;
		let timeoutId: number | undefined;
		let graceId: number | undefined;

		const settle = (fn: () => void) => {
			if (settled) return;
			settled = true;
			if (timeoutId !== undefined) window.clearTimeout(timeoutId);
			if (graceId !== undefined) window.clearTimeout(graceId);
			opts.signal?.removeEventListener('abort', onAbort);
			fn();
		};

		const kill = () => {
			try {
				child.kill();
			} catch {
				// Already dead — the exit event settles us.
			}
			// Windows kills are not always prompt; never leave the loop hanging
			// on a process whose exit event got lost.
			graceId = window.setTimeout(() => {
				settle(() => resolve(result));
			}, 2000);
		};

		const onAbort = () => {
			kill();
		};
		if (opts.signal) {
			if (opts.signal.aborted) {
				try {
					child.kill();
				} catch {
					// Already dead — the exit event settles us.
				}
				settle(() => resolve(result));
				return;
			}
			opts.signal.addEventListener('abort', onAbort, { once: true });
		}

		if (opts.timeoutMs && opts.timeoutMs > 0) {
			timeoutId = window.setTimeout(() => {
				result.timedOut = true;
				kill();
			}, opts.timeoutMs);
		}

		const capture = (readable: NodeReadable | null, into: 'stdout' | 'stderr') => {
			if (!readable) return;
			readable.on('data', (chunk) => {
				const text = chunk.toString('utf8');
				if (result[into].length < MAX_OUTPUT_CHARS) opts.onOutput?.(into, text);
				if (result[into].length >= MAX_OUTPUT_CHARS) {
					if (into === 'stdout') result.stdoutTruncated = true;
					else result.stderrTruncated = true;
					readable.resume();
					return;
				}
				result[into] += text;
				if (result[into].length >= MAX_OUTPUT_CHARS) {
					result[into] = result[into].slice(0, MAX_OUTPUT_CHARS);
					if (into === 'stdout') result.stdoutTruncated = true;
					else result.stderrTruncated = true;
					readable.resume();
				}
			});
		};
		capture(child.stdout, 'stdout');
		capture(child.stderr, 'stderr');

		child.on('error', (err) => {
			settle(() => reject(err));
		});
		child.on('exit', (code) => {
			result.exitCode = code;
			settle(() => resolve(result));
		});
	});
}
