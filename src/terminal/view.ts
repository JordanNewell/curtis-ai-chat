// Terminal pane — a shell in its own optional window.
//
// Desktop: every command is a fresh shell via the shared runner (see
// runner.ts) — no PTY, no persistent session. The pane tracks the working
// directory itself and re-resolves `cd` after each successful run, which is
// what makes consecutive commands feel like a session. Output streams into
// the scrollback as the process emits it, through the ANSI streamer (see
// ansi.ts), so long builds render live in color instead of appearing at
// the end as garbled escape text.
//
// Memory: when Settings → Terminal → Terminal memory is on, the pane's
// command history is shared across panes and persisted across sessions
// (data.json), and the last working directory is restored on open. A
// command typed with a leading space is never remembered — the escape
// hatch for commands containing secrets.
//
// Mobile: there is no OS shell (iOS forbids it; Obsidian's Android webview
// exposes no process bridge), so the same pane runs the vault shell — vshell
// over the vault API. Same input, scrollback, history, and stop affordances;
// the cwd is vault-relative instead of absolute.
//
// Model-driven execution lives in core/command-tools.ts and never touches
// this view; the three share the runner/vshell result shape and the
// shell/timeout settings.

import { ItemView, Notice, Platform, setIcon } from 'obsidian';
import type CurtisPlugin from '../main';
import { FolderSuggestModal } from '../ui/modals/folder-suggest-modal';
import { CURTIS_ICON_ID } from '../icons';
import { fsPathExists, getNodePath, runShellCommand, shellLabel, vaultBasePath } from './runner';
import type { ShellRunResult } from './runner';
import { createAnsiStreamer } from './ansi';
import type { AnsiSpan, AnsiStreamer } from './ansi';
import { completeFromHistory, rememberCommand, searchHistoryBackward } from './history';
import { resolveVaultPath, runVaultCommand } from './vshell';
import { VaultVfs } from './vault-vfs';

export const TERMINAL_VIEW_TYPE = 'curtis-terminal';

const HISTORY_RE = /^\s*history\s*$/;
const HISTORY_CLEAR_RE = /^\s*history\s+-c\s*$/;
const URL_RE = /https?:\/\/[^\s]+/g;

function formatSeconds(ms: number): string {
	const s = ms / 1000;
	return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
}

export class TerminalView extends ItemView {
	private plugin: CurtisPlugin;

	/** Vault-shell mode — mobile. Decide-once: the pane is constructed per
	 *  platform session, and the two modes never mix. */
	private readonly vaultMode = !Platform.isDesktopApp;

	/** Working directory for the next command. Desktop: absolute OS path.
	 *  Vault mode: vault-relative ('' = root). Starts at the vault root
	 *  (or the remembered directory, with terminal memory on); `cd` success
	 *  updates it. Pane-local — a new terminal starts at the root unless
	 *  memory restored one. */
	private cwd = '';
	/** Per-pane fallback history — used only when terminal memory is off. */
	private localHistory: string[] = [];
	/** -1 = composing a fresh line; otherwise an index into getHistory(). */
	private historyIndex = -1;
	private running = false;
	private abort: AbortController | null = null;

	// Ctrl+R reverse search state. The draft is the pre-search input value —
	// Esc restores it; Enter keeps the matched command and runs it.
	private searchMode = false;
	private searchQuery = '';
	private searchMatchIdx = -1;
	private searchDraft = '';
	private searchHintEl!: HTMLElement;

	// Tab completion state — the cycle resets on any real edit.
	private tabPrefix = '';
	private tabCandidates: string[] = [];
	private tabIdx = -1;

	private scrollEl!: HTMLElement;
	private inputEl!: HTMLInputElement;
	private cwdLabelEl!: HTMLElement;
	private stopBtnEl!: HTMLButtonElement;
	private promptEl!: HTMLElement;

	constructor(leaf: import('obsidian').WorkspaceLeaf, plugin: CurtisPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return TERMINAL_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Terminal';
	}

	getIcon(): string {
		return 'terminal';
	}

	/** The history the pane recalls from: the shared, persisted one when
	 *  terminal memory is on, a pane-local session one otherwise. */
	private getHistory(): string[] {
		return this.plugin.settings.terminalMemory ? this.plugin.settings.terminalHistory : this.localHistory;
	}

	async onOpen(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass('ai-term-view');

		// Desktop anchors the cwd to the vault's on-disk root; vault mode
		// uses '' (the vault root, vault-relative). Terminal memory then
		// restores the last directory — validated first, because a spawn
		// into a since-deleted folder would just ENOENT.
		this.cwd = this.vaultMode ? '' : (vaultBasePath(this.app) ?? '');
		const lastCwd = this.plugin.settings.terminalMemory ? this.plugin.settings.terminalLastCwd : '';
		if (lastCwd) {
			if (this.vaultMode) {
				if ((await new VaultVfs(this.app).type(lastCwd)) === 'folder') this.cwd = lastCwd;
			} else if (fsPathExists(lastCwd)) {
				this.cwd = lastCwd;
			}
		}

		this.addAction('trash', 'Clear terminal', () => this.clearScrollback());
		// The "another" pair — same options a chat pane offers. Always create
		// (the dedupe-reveal would just find this very pane); tab works on
		// mobile too, where the vault shell makes multi-tab useful.
		this.addAction('file-plus', 'Open another terminal tab', () => {
			void this.plugin.openTerminalPane('tab', { another: true });
		});
		if (Platform.isDesktop) {
			this.addAction('app-window', 'Open another terminal window', () => {
				// `another` is load-bearing: the dedupe-reveal in openTerminalPane
				// would find this very pane and the button would do nothing.
				void this.plugin.openTerminalPane('window', { another: true });
			});
		}

		this.renderTopbar(container);
		this.renderScrollback(container);
		this.renderInputBar(container);
	}

	async onClose(): Promise<void> {
		// A closed pane must not leave a child process running orphaned —
		// the runner resolves (not hangs) when the kill lands.
		this.abort?.abort();
	}

	private renderTopbar(container: HTMLElement): void {
		const bar = container.createDiv({ cls: 'ai-term-topbar' });

		const cwdBtn = bar.createEl('button', { cls: 'ai-term-cwd' });
		cwdBtn.setAttribute('aria-label', 'Change working directory');
		setIcon(cwdBtn, 'folder');
		this.cwdLabelEl = cwdBtn.createSpan({ cls: 'ai-term-cwd-label' });
		this.refreshCwdLabel();
		cwdBtn.addEventListener('click', () => {
			new FolderSuggestModal(this.app, (folderPath) => {
				// The modal speaks vault-relative paths; desktop anchors them
				// to the on-disk root, vault mode uses them as-is.
				if (this.vaultMode) {
					this.cwd = folderPath;
				} else {
					const vaultRoot = vaultBasePath(this.app);
					const path = getNodePath();
					if (!vaultRoot || !path) return;
					this.cwd = folderPath ? path.join(vaultRoot, folderPath) : vaultRoot;
				}
				this.refreshCwdLabel();
				this.rememberCwd();
			}).open();
		});

		bar.createDiv({ cls: 'ai-term-shell', text: this.vaultMode ? 'vault' : shellLabel(this.plugin.settings.terminalShell) });

		// Clear — desktop keeps it in the native pane-header row only (the
		// trash action up top); mobile header actions aren't reliably
		// visible, so the in-bar button stays there.
		if (Platform.isMobile) {
			const clearBtn = bar.createEl('button', { cls: 'ai-term-iconbtn' });
			clearBtn.setAttribute('aria-label', 'Clear terminal');
			setIcon(clearBtn, 'trash');
			clearBtn.addEventListener('click', () => this.clearScrollback());
		}

		this.stopBtnEl = bar.createEl('button', { cls: 'ai-term-iconbtn is-hidden' });
		this.stopBtnEl.setAttribute('aria-label', 'Stop running command');
		setIcon(this.stopBtnEl, 'square');
		this.stopBtnEl.addEventListener('click', () => {
			if (this.running) {
				new Notice('Stopping…');
				this.abort?.abort();
			}
		});
	}

	private renderScrollback(container: HTMLElement): void {
		this.scrollEl = container.createDiv({ cls: 'ai-term-scroll' });
		// A click on the scrollback returns focus to the prompt — unless the
		// click ends a drag that made a text selection, which copying needs
		// kept (focusing the input would not clear it, but the caret jump
		// reads as the selection being stolen).
		this.scrollEl.addEventListener('click', () => {
			const selection = window.getSelection();
			if (!selection || selection.isCollapsed) this.inputEl.focus();
		});
		this.renderBanner();
	}

	/** Startup greeting — the terminal's one brand moment: the Curtis mark,
	 *  version, and the fresh-shell hint. Gone when the scrollback clears,
	 *  like any motd. */
	private renderBanner(): void {
		const banner = this.scrollEl.createDiv({ cls: 'ai-term-banner' });
		const mark = banner.createSpan({ cls: 'ai-term-banner-mark' });
		setIcon(mark, CURTIS_ICON_ID);
		const text = banner.createDiv({ cls: 'ai-term-banner-text' });
		text.createDiv({ cls: 'ai-term-banner-title', text: `Curtis terminal — v${this.plugin.manifest.version}` });
		if (this.vaultMode) {
			text.createDiv({
				cls: 'ai-term-banner-hint',
				text: 'Vault shell — commands run against your notes, not the OS. rm moves to trash.',
			});
		} else {
			const memory = this.plugin.settings.terminalMemory;
			text.createDiv({
				cls: 'ai-term-banner-hint',
				text: memory
					? 'Commands run in a fresh shell each time — the pane carries the working directory and your command history.'
					: 'Commands run in a fresh shell each time — the pane carries the working directory, nothing else does.',
			});
		}
		const memory = this.plugin.settings.terminalMemory;
		const shortcuts = ['Ctrl+R history search', 'Tab completes', 'Ctrl+C stop/copy', 'Ctrl+L clear'];
		if (memory) shortcuts.push('a leading space keeps a command out of history');
		text.createDiv({ cls: 'ai-term-banner-hint', text: `${shortcuts.join(' · ')}` });
	}

	private renderInputBar(container: HTMLElement): void {
		const bar = container.createDiv({ cls: 'ai-term-inputbar' });
		this.searchHintEl = bar.createSpan({ cls: 'ai-term-search-hint is-hidden' });
		this.promptEl = bar.createSpan({ cls: 'ai-term-prompt', text: this.promptLabel() });
		this.inputEl = bar.createEl('input', {
			cls: 'ai-term-input',
			type: 'text',
			attr: { placeholder: 'Run a command…', spellcheck: 'false' },
		});
		this.inputEl.addEventListener('input', () => {
			// Any real edit invalidates a Tab-completion cycle.
			this.tabPrefix = '';
			this.tabCandidates = [];
			this.tabIdx = -1;
		});
		this.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
			this.onInputKeyDown(e);
		});
	}

	private onInputKeyDown(e: KeyboardEvent): void {
		// Ctrl+R first: inside search it cycles older matches; outside it
		// enters search mode.
		if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'r') {
			e.preventDefault();
			if (this.searchMode) this.stepSearch();
			else this.enterSearch();
			return;
		}
		if (this.searchMode) {
			if (e.key === 'Escape') {
				e.preventDefault();
				this.exitSearch(true);
				return;
			}
			if (e.key === 'Enter') {
				// Commit the match, then fall through so the Enter below runs it.
				this.exitSearch(false);
			} else if (e.key === 'Backspace') {
				e.preventDefault();
				this.searchQuery = this.searchQuery.slice(0, -1);
				this.updateSearch();
				return;
			} else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
				e.preventDefault();
				this.searchQuery += e.key;
				this.updateSearch();
				return;
			} else {
				// Anything else (arrows, Home…) leaves search mode with the
				// matched value in place — same as Enter without running.
				this.exitSearch(false);
			}
		}
		if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
			const k = e.key.toLowerCase();
			if (k === 'c') {
				e.preventDefault();
				this.handleCtrlC();
				return;
			}
			if (k === 'l') {
				e.preventDefault();
				this.clearScrollback();
				return;
			}
		}
		if (e.key === 'Tab') {
			e.preventDefault();
			this.tabComplete();
			return;
		}
		if (e.key === 'Enter') {
			const command = this.inputEl.value.trim();
			if (command) void this.runCommand(command);
			return;
		}
		if (e.key === 'ArrowUp') {
			this.stepHistory(-1);
			e.preventDefault();
		} else if (e.key === 'ArrowDown') {
			this.stepHistory(1);
			e.preventDefault();
		}
	}

	// ---- Ctrl+R reverse history search ----

	private enterSearch(): void {
		this.searchMode = true;
		this.searchDraft = this.inputEl.value;
		this.searchQuery = '';
		this.searchMatchIdx = -1;
		this.searchHintEl.removeClass('is-hidden');
		this.renderSearchHint();
	}

	private stepSearch(): void {
		// Ctrl+R again: keep the query, walk past the current match.
		if (this.searchMatchIdx === -1) this.updateSearch();
		else this.updateSearch(this.searchMatchIdx - 1);
	}

	private updateSearch(below?: number): void {
		const history = this.getHistory();
		const from = below ?? history.length - 1;
		this.searchMatchIdx = searchHistoryBackward(history, this.searchQuery, from);
		if (this.searchMatchIdx !== -1) {
			this.inputEl.value = history[this.searchMatchIdx] ?? '';
		}
		this.renderSearchHint();
	}

	private renderSearchHint(): void {
		const mark = this.searchMatchIdx === -1 && this.searchQuery ? 'failed' : 'r-search';
		this.searchHintEl.setText(`(${mark})\`${this.searchQuery}\``);
		this.searchHintEl.toggleClass('is-failed', mark === 'failed');
	}

	private exitSearch(restoreDraft: boolean): void {
		this.searchMode = false;
		this.searchHintEl.addClass('is-hidden');
		if (restoreDraft) this.inputEl.value = this.searchDraft;
		this.historyIndex = -1;
		this.searchMatchIdx = -1;
	}

	// ---- Ctrl+C: copy a selection, stop a running command, else kill the line ----

	private handleCtrlC(): void {
		const selection = window.getSelection();
		if (selection && !selection.isCollapsed && selection.toString()) {
			void navigator.clipboard.writeText(selection.toString()).catch(() => {});
			return;
		}
		if (this.running) {
			new Notice('Stopping…');
			this.abort?.abort();
			return;
		}
		this.inputEl.value = '';
	}

	// ---- Tab: complete from history, cycling matches ----

	private tabComplete(): void {
		const value = this.inputEl.value;
		if (this.tabPrefix !== value) {
			this.tabPrefix = value;
			this.tabCandidates = completeFromHistory(this.getHistory(), value);
			this.tabIdx = -1;
		}
		if (this.tabCandidates.length === 0) return;
		this.tabIdx = (this.tabIdx + 1) % this.tabCandidates.length;
		this.inputEl.value = this.tabCandidates[this.tabIdx];
		const end = this.inputEl.value.length;
		this.inputEl.setSelectionRange(end, end);
	}

	private refreshCwdLabel(): void {
		if (this.vaultMode) {
			this.cwdLabelEl.setText(`/${this.cwd}`);
		} else {
			const path = getNodePath();
			const display = path ? path.resolve(this.cwd || path.sep) : this.cwd;
			this.cwdLabelEl.setText(display);
		}
		// The topbar calls this before the input bar exists; renderInputBar
		// labels the prompt itself on creation.
		if (this.promptEl) this.promptEl.setText(this.promptLabel());
	}

	/** Short directory label for the prompt — the basename on desktop, the
	 *  vault-relative folder on mobile. */
	private promptLabel(): string {
		if (this.vaultMode) return this.cwd ? `/${this.cwd.split('/').pop()}` : '/';
		const path = getNodePath();
		if (!path) return '$';
		return path.basename(this.cwd) || this.cwd || '$';
	}

	/** Persist the current directory for the next session (terminal memory
	 *  on). Called only on actual changes — cd success and the folder picker
	 *  — never on plain command runs. */
	private rememberCwd(): void {
		if (!this.plugin.settings.terminalMemory) return;
		if (this.plugin.settings.terminalLastCwd === this.cwd) return;
		this.plugin.settings.terminalLastCwd = this.cwd;
		void this.plugin.saveSettings();
	}

	private clearScrollback(): void {
		if (this.running) {
			new Notice('Stop the running command first.');
			return;
		}
		this.scrollEl.empty();
		this.addNote('Cleared.');
	}

	private addNote(text: string): void {
		this.scrollEl.createDiv({ cls: 'ai-term-note', text });
		this.scrollToBottom();
	}

	private stepHistory(direction: -1 | 1): void {
		const history = this.getHistory();
		if (history.length === 0) return;
		if (direction === -1) {
			// Not walking history yet: start at the most recent entry.
			if (this.historyIndex === -1) this.historyIndex = history.length - 1;
			else if (this.historyIndex > 0) this.historyIndex--;
		} else {
			if (this.historyIndex === -1) return;
			if (this.historyIndex < history.length - 1) this.historyIndex++;
			else {
				// Walked past the newest entry — back to the empty draft line.
				this.historyIndex = -1;
				this.inputEl.value = '';
				return;
			}
		}
		this.inputEl.value = history[this.historyIndex] ?? '';
	}

	/** Render one `history` invocation as a transcript block. */
	private renderHistoryBlock(): void {
		const history = this.getHistory();
		const block = this.scrollEl.createDiv({ cls: 'ai-term-block' });
		const cmdline = block.createDiv({ cls: 'ai-term-cmdline' });
		cmdline.createSpan({ cls: 'ai-term-prompt', text: this.promptLabel() });
		cmdline.createSpan({ cls: 'ai-term-cmdtext', text: 'history' });
		const pre = block.createEl('pre', { cls: 'ai-term-stdout' });
		pre.setText(history.map((cmd, i) => `${String(i + 1).padStart(4)}  ${cmd}`).join('\n'));
		const exitEl = block.createDiv({ cls: 'ai-term-exit ai-term-exit-ok' });
		exitEl.setText(`${history.length} ${history.length === 1 ? 'command' : 'commands'}`);
		this.scrollToBottom();
	}

	/**
	 * Run one command through the shared runner and render the transcript
	 * block. One command at a time — the input is disabled while one runs,
	 * matching the pane's own Stop affordance (no queues to get lost in).
	 */
	private async runCommand(command: string): Promise<void> {
		if (this.running) {
			new Notice('A command is still running — stop it first.');
			return;
		}
		if (!this.vaultMode && !this.cwd) return; // desktop: no vault root resolved

		this.inputEl.value = '';
		if (this.plugin.settings.terminalMemory) {
			// Shared, persisted history. rememberCommand hands back a new
			// array (erasedups + cap), so store it on the settings object —
			// every open pane reads from there on its next command.
			this.plugin.settings.terminalHistory = rememberCommand(this.plugin.settings.terminalHistory, command);
			void this.plugin.saveSettings();
		} else if (this.localHistory[this.localHistory.length - 1] !== command) {
			this.localHistory.push(command);
		}
		this.historyIndex = -1;

		// Pane builtins before the shell: `clear`/`cls` is pane state, not a
		// process — the screen a real shell repaints IS this scrollback, and
		// the captured ANSI repaint a real shell emits would only render as
		// garbled escape text. `history` reads the pane's remembered
		// commands (`history -c` wipes them). All work in vault mode too.
		if (/^\s*(?:clear|cls)\s*$/i.test(command)) {
			this.clearScrollback();
			return;
		}
		if (HISTORY_CLEAR_RE.test(command)) {
			if (this.plugin.settings.terminalMemory) {
				this.plugin.settings.terminalHistory = [];
				void this.plugin.saveSettings();
			} else {
				this.localHistory = [];
			}
			this.addNote('History cleared.');
			return;
		}
		if (HISTORY_RE.test(command)) {
			this.renderHistoryBlock();
			return;
		}

		const vaultRoot = vaultBasePath(this.app);
		const path = getNodePath();
		// `cd` mirroring only applies to a bare cd — in a compound command
		// the shell consumes it, and "dir && build" is not a directory.
		const cdMatch = /^\s*cd(?:\s+(.*))?$/.exec(command);
		const isCd = cdMatch && !/[&|;<>`]/.test(command) ? cdMatch : null;
		const cwdBefore = this.cwd;

		const block = this.scrollEl.createDiv({ cls: 'ai-term-block' });
		const cmdline = block.createDiv({ cls: 'ai-term-cmdline' });
		cmdline.createSpan({ cls: 'ai-term-prompt', text: this.promptLabel() });
		cmdline.createSpan({ cls: 'ai-term-cmdtext', text: command });
		const stdoutEl = block.createEl('pre', { cls: 'ai-term-stdout is-hidden' });
		const stderrEl = block.createEl('pre', { cls: 'ai-term-stderr is-hidden' });
		const exitEl = block.createDiv({ cls: 'ai-term-exit', text: '…' });
		this.scrollToBottom();

		// Desktop streams: chunks render as they arrive, through the ANSI
		// streamer so colors open in one chunk survive into the next. Vault
		// commands are quick vault-API ops — their (ANSI-free) output lands
		// once, at completion.
		const live = !this.vaultMode;
		const streamers: Record<'stdout' | 'stderr', AnsiStreamer> = {
			stdout: createAnsiStreamer(),
			stderr: createAnsiStreamer(),
		};
		const elements: Record<'stdout' | 'stderr', HTMLElement> = { stdout: stdoutEl, stderr: stderrEl };
		const streamed = { stdout: false, stderr: false };

		const appendSpans = (el: HTMLElement, spans: AnsiSpan[]): void => {
			for (const span of spans) this.appendAnsiSpan(el, span);
			if (spans.length) this.scrollToBottom();
		};
		const onOutput = (stream: 'stdout' | 'stderr', text: string): void => {
			streamed[stream] = true;
			elements[stream].removeClass('is-hidden');
			appendSpans(elements[stream], streamers[stream].push(text));
		};

		this.setRunning(true);
		this.abort = new AbortController();
		const startedAt = performance.now();
		const tick = window.setInterval(() => {
			exitEl.setText(`… ${formatSeconds(performance.now() - startedAt)}`);
		}, 100);
		try {
			const timeoutMs = Math.max(1, this.plugin.settings.terminalTimeoutSeconds) * 1000;
			const result = this.vaultMode && isCd
				? await this.runVaultCd(isCd[1] ?? '')
				: this.vaultMode
					? await runVaultCommand(new VaultVfs(this.app), {
						command,
						cwd: this.cwd,
						timeoutMs,
						signal: this.abort.signal,
					})
					: await runShellCommand(
						{
							command,
							cwd: this.cwd,
							timeoutMs,
							signal: this.abort.signal,
							onOutput: live ? onOutput : undefined,
						},
						this.plugin.settings.terminalShell
					);

			// Drain whatever the streamers still hold, then finish streams
			// that never received a live chunk the slow way — the whole
			// buffered output, once, through the same ANSI path.
			for (const stream of ['stdout', 'stderr'] as const) {
				appendSpans(elements[stream], streamers[stream].flush());
				const text = stream === 'stdout' ? result.stdout : result.stderr;
				const truncated = stream === 'stdout' ? result.stdoutTruncated : result.stderrTruncated;
				if (!streamed[stream] && text) {
					elements[stream].removeClass('is-hidden');
					appendSpans(elements[stream], streamers[stream].push(text));
					appendSpans(elements[stream], streamers[stream].flush());
				}
				if (truncated) {
					elements[stream].createSpan({ cls: 'ai-term-truncated', text: '\n…[truncated]' });
				}
			}

			// A successful `cd` is mirrored into the pane's tracked directory
			// — the fresh-shell equivalent of session state.
			if (isCd && result.exitCode === 0 && path) {
				const target = (isCd[1] ?? '').trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
				if (!target) {
					this.cwd = vaultRoot ?? this.cwd;
				} else if (path.isAbsolute(target)) {
					this.cwd = path.resolve(target);
				} else {
					this.cwd = path.resolve(path.join(cwdBefore, target));
				}
				this.refreshCwdLabel();
				this.rememberCwd();
			}

			const duration = formatSeconds(performance.now() - startedAt);
			exitEl.setText(`${this.describeExit(result)} · ${duration}`);
			exitEl.addClass(result.exitCode === 0 && !result.timedOut ? 'ai-term-exit-ok' : 'ai-term-exit-fail');
		} catch (e) {
			exitEl.setText(`${this.vaultMode ? 'Vault shell' : 'Shell'} error: ${e instanceof Error ? e.message : String(e)}`);
			exitEl.addClass('ai-term-exit-fail');
		} finally {
			window.clearInterval(tick);
			this.abort = null;
			this.setRunning(false);
			this.scrollToBottom();
			this.inputEl.focus();
		}
	}

	/** Render one styled span into the scrollback, linkifying bare URLs. */
	private appendAnsiSpan(el: HTMLElement, span: AnsiSpan): void {
		if (!span.text) return;
		let last = 0;
		for (const match of span.text.matchAll(URL_RE)) {
			const idx = match.index ?? 0;
			if (idx > last) this.appendStyledText(el, span, span.text.slice(last, idx));
			// Trailing punctuation almost always ends the sentence, not the URL.
			const url = match[0].replace(/[)\].,;'"]+$/, '');
			if (url) this.appendStyledText(el, span, url, url);
			this.appendStyledText(el, span, match[0].slice(url.length));
			last = idx + match[0].length;
		}
		if (last < span.text.length) this.appendStyledText(el, span, span.text.slice(last));
	}

	private appendStyledText(el: HTMLElement, span: AnsiSpan, text: string, url?: string): void {
		if (!text) return;
		const styled = span.classes.length > 0 || span.color !== undefined || span.backgroundColor !== undefined;
		if (!styled) {
			if (url) {
				const a = el.createEl('a', { text, href: url });
				a.setAttrs({ target: '_blank', rel: 'noopener' });
			} else {
				el.appendText(text);
			}
			return;
		}
		const node = url ? el.createEl('a', { text, href: url }) : el.createSpan({ text });
		for (const cls of span.classes) node.addClass(cls);
		if (span.color) node.style.color = span.color;
		if (span.backgroundColor) node.style.backgroundColor = span.backgroundColor;
		if (url) node.setAttrs({ target: '_blank', rel: 'noopener' });
	}

	/** Bare `cd` in vault mode — pane state, not a command: there is no shell
	 *  to validate it, so resolve here and mirror only when the target is a
	 *  real folder (desktop parity: a failed cd moves nothing). */
	private async runVaultCd(targetRaw: string): Promise<ShellRunResult> {
		const target = targetRaw.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
		try {
			const next = target ? resolveVaultPath(this.cwd, target) : '';
			if (target && (await new VaultVfs(this.app).type(next)) !== 'folder') {
				return {
					stdout: '', stderr: `cd: no such directory: ${target}\n`,
					exitCode: 1, timedOut: false, stdoutTruncated: false, stderrTruncated: false,
				};
			}
			this.cwd = next;
			this.refreshCwdLabel();
			this.rememberCwd();
			return {
				stdout: '', stderr: '',
				exitCode: 0, timedOut: false, stdoutTruncated: false, stderrTruncated: false,
			};
		} catch (e) {
			return {
				stdout: '', stderr: `cd: ${e instanceof Error ? e.message : String(e)}\n`,
				exitCode: 1, timedOut: false, stdoutTruncated: false, stderrTruncated: false,
			};
		}
	}

	private describeExit(result: {
		exitCode: number | null;
		timedOut: boolean;
		stdoutTruncated: boolean;
		stderrTruncated: boolean;
	}): string {
		if (result.timedOut) return 'Timed out — command stopped.';
		if (result.exitCode === null) return 'Stopped.';
		return result.exitCode === 0 ? 'exit 0' : `exit ${result.exitCode}`;
	}

	private setRunning(running: boolean): void {
		this.running = running;
		this.stopBtnEl.toggleClass('is-hidden', !running);
		// Stop speaks — error color + breathing ring while a command runs.
		this.stopBtnEl.toggleClass('is-running', running);
		this.inputEl.disabled = running;
		// The prompt dims with the disabled field, not just the field itself.
		if (this.promptEl) this.promptEl.toggleClass('dim', running);
	}

	private scrollToBottom(): void {
		this.scrollEl.scrollTop = this.scrollEl.scrollHeight;
	}
}
