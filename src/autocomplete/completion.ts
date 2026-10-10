// Completion prompt construction + response cleanup. Pure functions — the
// request itself rides the shared chat transport (plugin.callCompletion).

import type { AIMessage } from '../types';

/** Server-side cap — small by design: a ghost is a sentence, not a paragraph.
 *  60 tokens ≈ 45 words; the hard cost ceiling per request. */
export const AUTOCOMPLETE_MAX_TOKENS = 60;

/** Server-side stop: two newlines = paragraph end. Providers that ignore
 *  stop sequences are caught client-side by extractCompletion. */
export const AUTOCOMPLETE_STOP_SEQUENCES = ['\n\n'];

/** Client-side cap on accepted ghost length, backstopping the token cap. */
export const COMPLETION_MAX_CHARS = 280;

const COMPLETION_SYSTEM_PROMPT =
	'You extend text the user is writing. Continue the text exactly at the point where BEFORE ends. ' +
	'Rules: output ONLY the continuation — no quotes, no labels, no explanations, no repetition of ' +
	'existing text. Match the language, tone, and formatting of the surrounding text. Keep it short: ' +
	'at most a sentence or two. If the text already reads complete or the continuation is ambiguous, ' +
	'output nothing.';

export interface CompletionContextLimits {
	prefixChars: number;
	suffixChars: number;
}

/**
 * Build the chat messages for a completion request. The full pre-cursor text
 * (already truncated to `limits.prefixChars` by the caller's config) and a
 * short suffix give the model both directions of context; the suffix is empty
 * at end-of-line, which is the normal trigger position.
 */
export function buildCompletionMessages(
	prefix: string,
	suffix: string,
	limits: CompletionContextLimits
): AIMessage[] {
	const before = prefix.slice(-limits.prefixChars);
	const after = suffix.slice(0, limits.suffixChars);
	return [
		{ role: 'system', content: COMPLETION_SYSTEM_PROMPT },
		{
			role: 'user',
			content: `Continue the text at the point where BEFORE ends.\n\n<before>\n${before}\n</before>\n\n<after>\n${after}\n</after>`,
		},
	];
}

/**
 * Clean a raw model reply into safe ghost text: hard-stop at a paragraph
 * break, strip stray code fences, drop a leading whitespace character that
 * would double one already at the cursor boundary, cap length. Empty output
 * means "no suggestion".
 */
export function extractCompletion(raw: string, endsWithWhitespace = false): string {
	let text = raw ?? '';
	const stop = text.indexOf('\n\n');
	if (stop !== -1) text = text.slice(0, stop);

	// Some models wrap even one-line continuations in fences.
	const fenced = text.match(/^```[^\n]*\n([\s\S]*?)\n?```$/);
	if (fenced) text = fenced[1];
	// Others quote it.
	const quoted = text.match(/^"([\s\S]*)"$/);
	if (quoted) text = quoted[1];

	if (endsWithWhitespace) text = text.replace(/^\s+/, '');
	text = text.replace(/\s+$/, '');
	if (text.length > COMPLETION_MAX_CHARS) text = text.slice(0, COMPLETION_MAX_CHARS);
	return text;
}
