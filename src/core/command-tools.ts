// Command tool — opt-in command execution for Curtis Agent.
//
// Desktop: run_command spawns the platform shell for one command and returns
// stdout, stderr and the exit code. Mobile: there is no OS shell (iOS
// sandbox; no process bridge in Obsidian's Android webview), so the same tool
// runs the vault shell — vshell over the vault API, same result shape, same
// output caps. The model sees one tool; the platform picks the backend.
//
// The tool is stateless by design: no session, no persistent working
// directory between calls — the model passes an explicit cwd when it doesn't
// want the vault root. Off by default (the same vault-first posture as the
// web tools); when enabled, every call passes a confirmation dialog in
// callAgentLoop unless the user chose "always allow" for that exact command
// this session. The dialog lives in the loop, not here, so swarm followers
// are gated by the same choke point.
//
// Non-zero exits are NOT thrown — the exit-code line carries the failure to
// the model while preserving whatever output the command produced. Throwing
// is reserved for "the tool could not run at all", which executeTool turns
// into an is_error result.

import { runShellCommand, vaultBasePath, getNodePath, isWindows } from '../terminal/runner';
import type { ShellRunResult } from '../terminal/runner';
import { stripAnsi } from '../terminal/ansi';
import { runVaultCommand } from '../terminal/vshell';
import { VaultVfs } from '../terminal/vault-vfs';
import type { ToolContext, ToolDefinition } from './tools';

function str(v: unknown): string {
	return typeof v === 'string' ? v : '';
}

function num(v: unknown): number {
	return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** True when dir resolves to the vault root or somewhere inside it.
 *  Case-insensitive on Windows, exact elsewhere. */
function isInsideVault(vaultRoot: string, dir: string): boolean {
	const path = getNodePath();
	if (!path) return false;
	const root = path.resolve(vaultRoot);
	const target = path.resolve(dir);
	const a = isWindows() ? target.toLowerCase() : target;
	const b = isWindows() ? root.toLowerCase() : root;
	return a === b || a.startsWith(b + path.sep);
}

export const RUN_COMMAND_TOOL: ToolDefinition = {
	name: 'run_command',
	description:
		"Run a command and return stdout, stderr and the exit code. On desktop this is the OS shell — each command " +
		'runs fresh, so use explicit cd/absolute paths rather than relying on a previous working directory; interactive ' +
		'programs (full-screen TUIs, anything waiting on stdin) hang until the timeout. On mobile it is a vault shell: ' +
		'ls, cat, head, tail, wc, grep, find, sed s/old/new/[g], sort, uniq, echo, mkdir, touch, cp, mv, rm — operating ' +
		'on vault notes only (rm moves to trash; no pipes or redirection). Commands are shown to the user for approval ' +
		'before they run.',
	parameters: {
		command: { type: 'string', description: 'The shell command to run', required: true },
		cwd: {
			type: 'string',
			description:
				'Working directory: absolute path on desktop, or vault-relative path (default: vault root)',
		},
		timeout_seconds: {
			type: 'number',
			description: 'Kill the command after this many seconds (default from settings, max 600)',
		},
	},
	execute: async (params, context: ToolContext) => {
		const plugin = context.plugin;
		if (!plugin) throw new Error('run_command is unavailable outside the agent loop.');
		const command = str(params.command).trim();
		if (!command) return 'Command is required.';

		const requested = num(params.timeout_seconds) || plugin.settings.terminalTimeoutSeconds;
		const timeoutSec = Math.min(600, Math.max(1, requested));

		const vaultRoot = vaultBasePath(context.app);
		const path = getNodePath();

		let result: ShellRunResult;
		if (vaultRoot && path) {
			// Desktop — the OS shell.
			const cwdParam = str(params.cwd).trim();
			let cwd = vaultRoot;
			if (cwdParam) {
				cwd = path.isAbsolute(cwdParam) ? path.resolve(cwdParam) : path.resolve(path.join(vaultRoot, cwdParam));
				if (plugin.settings.terminalRestrictToVault && !isInsideVault(vaultRoot, cwd)) {
					return (
						`Refused: "${cwdParam}" is outside the vault and command execution is restricted to the ` +
						'vault (Settings → Terminal). Ask the user to lift the restriction if it is needed.'
					);
				}
			}
			result = await runShellCommand(
				{ command, cwd, timeoutMs: timeoutSec * 1000, signal: context.signal },
				plugin.settings.terminalShell
			);
		} else {
			// Mobile — the vault shell. Inherently vault-scoped, so the
			// restrict-to-vault setting is satisfied by construction; the cwd
			// is vault-relative and must be a folder.
			const cwd = str(params.cwd).trim().replace(/^\/+/, '').replace(/\/+$/, '');
			const vfs = new VaultVfs(context.app);
			if (cwd && (await vfs.type(cwd)) !== 'folder') {
				return `Refused: "${cwd}" is not a folder in the vault.`;
			}
			result = await runVaultCommand(vfs, {
				command,
				cwd,
				timeoutMs: timeoutSec * 1000,
				signal: context.signal,
			});
		}

		// Color-forced tools (--color=always, CLICOLOR_FORCE) emit SGR
		// sequences that would reach the model as garbled "[32m" text —
		// strip every escape sequence from both streams. The pane renders
		// them instead (see terminal/ansi.ts).
		const sections: string[] = [];
		const stdout = stripAnsi(result.stdout).trim();
		const stderr = stripAnsi(result.stderr).trim();
		if (stdout) {
			sections.push(result.stdoutTruncated ? `${stdout}\n…[truncated]` : stdout);
		}
		if (stderr) {
			sections.push(`[stderr]\n${result.stderrTruncated ? `${stderr}\n…[truncated]` : stderr}`);
		}
		if (result.timedOut) {
			sections.push(`Exit: timed out after ${timeoutSec}s and was killed`);
		} else if (result.exitCode === null) {
			sections.push('Exit: stopped before completion');
		} else if (result.exitCode !== 0) {
			sections.push(`Exit code: ${result.exitCode} (command failed)`);
		} else {
			sections.push('Exit code: 0');
		}
		return sections.join('\n');
	},
};
