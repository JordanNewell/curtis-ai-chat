export interface DiffLine {
	type: 'added' | 'removed' | 'unchanged';
	text: string;
}

/**
 * Line-level diff between original and modified text.
 * Uses LCS dynamic programming — O(n*m) time/space.
 * For typical AI rewrite sizes (<200 lines) this is fast enough.
 */
export function diffLines(original: string, modified: string): DiffLine[] {
	const a = original.split('\n');
	const b = modified.split('\n');

	// Build LCS table
	const m = a.length, n = b.length;
	const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
	for (let i = m - 1; i >= 0; i--) {
		for (let j = n - 1; j >= 0; j--) {
			if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
			else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}

	// Backtrack to build diff
	const result: DiffLine[] = [];
	let i = 0, j = 0;
	while (i < m && j < n) {
		if (a[i] === b[j]) {
			result.push({ type: 'unchanged', text: a[i] });
			i++; j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			result.push({ type: 'removed', text: a[i] });
			i++;
		} else {
			result.push({ type: 'added', text: b[j] });
			j++;
		}
	}
	while (i < m) { result.push({ type: 'removed', text: a[i] }); i++; }
	while (j < n) { result.push({ type: 'added', text: b[j] }); j++; }

	return result;
}
