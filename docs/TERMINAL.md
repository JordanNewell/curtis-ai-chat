# Terminal

> A shell in its own optional window. And, if you opt in, a tool the agent can run commands with.

Two related pieces, one settings section:

- The **terminal pane** — a shell next to your notes. Always available, never in the way: it opens as its own OS window (or a workspace tab, if you prefer). Desktop runs the OS shell; mobile runs the [vault shell](#mobile-the-vault-shell).
- The **command tool** — `run_command` for Curtis Agent. Off by default; when enabled, the AI can run commands (OS shell on desktop, vault shell on mobile), and every command passes your approval first.

## Opening the terminal

- The **terminal icon** in the chat top bar, beside history / export / search
- The pane's **"..." menu** → Open terminal
- Command palette → **Open terminal window** (its own OS window, desktop) or **Open terminal tab** (docked in the workspace)
- One terminal at a time — opening again reveals the existing one

On desktop the window variant is the design default. On mobile there are no OS windows — the icon, the menu, and the tab command all dock the pane, which runs the vault shell instead of an OS shell (iOS forbids spawning processes; Obsidian's Android app exposes no process bridge to plugins).

## How it works

Every command runs in a **fresh shell** — the pane carries the working directory between commands, nothing else does. Environment tweaks, `set` variables, and activated venvs don't persist; write them into the command itself. `cd` is mirrored: a successful `cd` moves the pane's directory, and the folder button in the pane header picks one directly. `clear` and `cls` never reach the shell in either mode — they wipe the pane's scrollback directly, since the captured ANSI repaint a real shell emits would only render as garbled escape text.

Output **streams in live** while the command runs — no waiting for the process to exit — and ANSI color sequences render as color (bold, underline, dim, the 16 standard colors, and 256-color/truecolor), not as garbled escape text. Bare URLs in output are clickable. Every block carries an elapsed-time badge; while a command runs the badge ticks, and when it settles the badge freezes at the final time beside the exit code. The prompt shows the current directory.

The header shows the current directory (click it to change), the shell in use, a stop button while a command runs, and clear. Each command is killed after the timeout in Settings → Terminal (default 60 seconds).

Keyboard:

| Key | Action |
|---|---|
| `Ctrl/Cmd+R` | Search history (type to refine, `Ctrl+R` again for older matches, Enter runs the match, Esc restores your draft) |
| `Tab` | Complete the typed prefix from history (Tab again cycles matches) |
| Arrow up / down | Walk the history |
| `Ctrl/Cmd+C` | Copy the selection; if nothing is selected, stop the running command; otherwise clear the input line |
| `Ctrl/Cmd+L` | Clear the scrollback |

## Terminal memory

Settings → Terminal → **Terminal memory** (on by default) makes the pane remember across panes and sessions:

- Command history persists in plugin data — arrow-up, `Ctrl+R`, and Tab all read it, in every terminal pane, after a restart.
- The last working directory is restored when a pane opens (checked first: a directory deleted since is skipped).
- `history` lists the remembered commands; `history -c` wipes them.
- A command typed with a **leading space** is never remembered — the escape hatch for commands that embed secrets (fish/zsh's `HIST_IGNORE_SPACE`).

With memory off, each pane keeps its own session-only history and closes without a trace.

## The command tool

Settings → Terminal → **Enable command tool** adds `run_command` to agent mode (requires agent mode itself to be on). The model gets stdout, stderr, and the exit code — ANSI escape sequences stripped, so color-forced tools never feed garbled `[32m` text into the conversation. Long output is capped and truncated. Commands are non-interactive by design — full-screen programs and anything waiting on stdin are killed at the timeout.

Every agent-initiated command passes a **confirmation dialog** first: the command and its directory, with Deny / Run once / Always this session. Denial tells the model to stop and ask. "Always this session" lasts until Obsidian reloads. Turning confirmation off is possible; leaving it on is the intended posture.

Two bounds ship on:

- **Restrict commands to the vault** — a working directory outside the vault root is refused (the terminal pane itself is never restricted; this only bounds the AI).
- **Timeout** — runaway commands die at the slider's value, 5–300 seconds.

## Shell selection

Auto by default: `cmd` on Windows, `bash` elsewhere (falls back to `sh` when bash is missing). Settings → Terminal → Shell accepts `cmd`, `powershell`, `pwsh`, or a custom executable path. There is no PTY — full-screen TUI apps (vim, htop) are not supported in the pane. Desktop only — the mobile pane ignores it and runs the vault shell.

## Mobile: the vault shell

Mobile cannot have an OS shell — iOS forbids spawning processes outright, and Obsidian's Android app gives plugins no process bridge — so the same terminal pane runs a **vault shell** instead: a curated POSIX-ish command set implemented over Obsidian's vault API. It needs no permissions on either platform and can never touch anything outside the vault, which is the same posture the desktop's restrict-to-vault default takes.

The command set:

| Area | Commands |
|---|---|
| Navigate | `pwd`, `ls [-l]`, `cd` (mirrored by the pane) |
| Read | `cat`, `head [-n]`, `tail [-n]`, `wc [-l -w -c]` |
| Search | `grep [-i] [-n]` (recurses into folders), `find [-name] [-type]` |
| Transform | `sed s/old/new/[g]` (print-only), `sort [-r] [-n]`, `uniq [-c]`, `echo` |
| Write | `mkdir [-p]`, `touch`, `cp`, `mv`, `rm [-r]` |

Deliberate v1 boundaries: no pipes, redirection, or command chaining (quoted metacharacters are literal — `grep "a|b"` searches for that string). `rm` moves to Obsidian trash, never hard-deletes. `sed` prints; it does not edit in place (the agent has `edit_note` for that). Recursive walks cap at 2000 entries and output caps at the same 8000 characters as desktop, so a huge vault degrades instead of freezing.

The agent's `run_command` routes here automatically on mobile with the same confirmation dialog, output caps, and timeout — the model sees one tool; the platform picks the backend.

## Terminal vs agent tools

- [Agent mode](AGENT.md) vault tools read and write notes. The command tool runs anything a shell can — builds, scripts, git — including outside the vault when the restriction is lifted.
- The [swarm](SWARM.md) runs followers through the same loop, so a follower's shell commands pass the same confirmation dialog. Stopping the leader stops the command it started.

## See also

→ [AGENT.md](AGENT.md) for the tool loop and the vault tools
→ [SWARM.md](SWARM.md) for delegation, which inherits this gating
