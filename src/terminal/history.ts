// Terminal memory — the pure logic behind the pane's persistent command
// history. Deliberately Obsidian-free so it runs under vitest (same boundary
// as vshell.ts); storage is a settings array owned by the plugin, shared by
// every open terminal pane, persisted in data.json.
//
// The leading-space rule comes from fish/zsh's HIST_IGNORE_SPACE: a command
// typed with a leading space is never remembered, which is how you run
// something containing a secret without it landing in the history file.

export const TERMINAL_HISTORY_CAP = 500;

/**
 * Add a command to the history and return the new array. Erasedups
 * semantics: re-running a command moves it to the end (most recent), so
 * arrow-up recall shows each command once, newest last. Commands that are
 * empty, or start with a space (the do-not-remember escape hatch), leave
 * the history untouched. The input array is never mutated.
 */
export function rememberCommand(history: string[], command: string, cap = TERMINAL_HISTORY_CAP): string[] {
	const cmd = command.trim();
	if (!cmd || command.startsWith(' ')) return history;
	const next = history.filter((h) => h !== cmd);
	next.push(cmd);
	return next.length > cap ? next.slice(next.length - cap) : next;
}

/**
 * Search history backwards for a substring, starting just below fromIndex
 * (pass history.length - 1 for the first hit). Returns the index or -1.
 * An empty query matches nothing — Ctrl+R with no query typed has nothing
 * to commit to.
 */
export function searchHistoryBackward(history: string[], query: string, fromIndex: number): number {
	if (!query) return -1;
	const start = Math.min(fromIndex, history.length - 1);
	for (let i = start; i >= 0; i--) {
		if (history[i].includes(query)) return i;
	}
	return -1;
}

/**
 * Unique history commands starting with prefix, most recent first, exact
 * matches excluded (Tab on a complete command has nothing to add).
 */
export function completeFromHistory(history: string[], prefix: string): string[] {
	if (!prefix) return [];
	const out: string[] = [];
	for (let i = history.length - 1; i >= 0; i--) {
		const cmd = history[i];
		if (cmd.startsWith(prefix) && cmd !== prefix && !out.includes(cmd)) out.push(cmd);
	}
	return out;
}
