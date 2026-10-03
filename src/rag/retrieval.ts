// Curtis — RAG retrieval formatting: turn search results into a prompt block.
//
// The block is self-describing so the model treats excerpts correctly:
// partial, path-addressed, and never a substitute for reading the file.

import type { RetrievalResult } from '../types';

const RETRIEVED_CONTEXT_HEADER =
	'[Retrieved vault context — excerpts from the user\'s notes that appear relevant to ' +
	'their latest message. Excerpts are partial; the bracketed paths are exact vault paths. ' +
	'Use read_note for the full file and say so when you need more than the excerpt.]';

/**
 * Format retrieved chunks for injection into the system prompt. Chunks from
 * files already attached via @-mention are dropped (their full contents are
 * already in context). Returns null when nothing usable remains — callers
 * then simply omit the block.
 */
export function formatRetrievedContext(
	results: RetrievalResult[],
	excludePaths: Set<string> = new Set()
): string | null {
	const usable = results.filter(
		(r) => !excludePaths.has(r.chunk.filePath) && r.chunk.content.trim().length > 0
	);
	if (usable.length === 0) return null;
	const blocks = usable.map(
		(r) => `[Excerpt: ${r.chunk.filePath}]\n${r.chunk.content.trim()}`
	);
	return `${RETRIEVED_CONTEXT_HEADER}\n\n${blocks.join('\n\n')}`;
}
