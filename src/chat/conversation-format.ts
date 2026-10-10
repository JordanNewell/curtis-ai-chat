// Conversation file format — serialize/parse the markdown conversation files
// (frontmatter + H1 title + marker-attributed message sections).
//
// Obsidian-free by design (same boundary as src/autocomplete/, vshell, pcp):
// runs under plain node, so the separate Curtis AI Porter repo can read and
// write Curtis conversation files without Obsidian. YAML comes in through
// YamlPort — the Obsidian host passes { parse: parseYaml, dump: stringifyYaml };
// node hosts pass js-yaml directly.

import type { Conversation, ConversationMessage, TokenUsage } from '../types';
import { slugify } from '../utils/download';

/** YAML codec for conversation frontmatter. */
export interface YamlPort {
	parse(text: string): unknown;
	dump(value: unknown): string;
}

/** Marker opening every message block. Content between markers is the message. */
const MSG_MARKER_RE = /<!--\s*curtis:msg\s+(\{[\s\S]*?\})\s*-->/g;
/** Human-facing section labels, fixed set — the parser strips exactly one of
 *  these above each marker; anything else is treated as message content. */
const ROLE_LABELS: Record<ConversationMessage['role'], string> = {
	user: 'You',
	assistant: 'AI',
	tool: 'Tool',
	system: 'System',
};
const HEADING_LINE_RE = /^## (You|AI|Tool|System)\s*$/;

export function serializeConversationMarkdown(conv: Conversation, yaml: YamlPort): string {
	const fm: Record<string, unknown> = {
		curtis: 'conversation',
		id: conv.id,
		created: conv.createdAt,
		updated: conv.updatedAt,
		provider: conv.provider,
		model: conv.model,
	};
	if (conv.role) fm.role = conv.role;
	if (conv.leaderId) fm.leaderId = conv.leaderId;

	const parts: string[] = [`---\n${yaml.dump(fm).replace(/\n+$/, '\n')}---`, '', `# ${conv.title}`, ''];
	for (const msg of conv.messages) {
		const meta: Record<string, unknown> = { id: msg.id, ts: msg.timestamp, role: msg.role };
		if (msg.provider) meta.provider = msg.provider;
		if (msg.model) meta.model = msg.model;
		if (msg.cost) meta.cost = msg.cost;
		if (msg.tokens) meta.tokens = msg.tokens;
		if (msg.images && msg.images.length > 0) meta.images = msg.images;
		if (msg.attachedNotes && msg.attachedNotes.length > 0) meta.attachedNotes = msg.attachedNotes;
		if (msg.tool_calls && msg.tool_calls.length > 0) meta.tool_calls = msg.tool_calls;
		if (msg.tool_call_id) meta.tool_call_id = msg.tool_call_id;
		if (msg.tool_error) meta.tool_error = true;
		if (msg.memoriesUsedIds && msg.memoriesUsedIds.length > 0) meta.mem = msg.memoriesUsedIds;
		// Escape the comment terminator so metadata containing "-->"
		// (e.g. tool arguments editing markdown with HTML comments) can't
		// break out of the marker.
		const json = JSON.stringify(meta).replace(/-->/g, '--\\u003E');
		// Likewise, a message body quoting the marker itself would split
		// this message in two on the next parse — neutralize the opener.
		// The zero-width space is invisible and survives round-trips.
		const content = (typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? ''))
			.replace(/<!--\s*curtis:msg/g, '<!--\u200Bcurtis:msg');
		parts.push(
			`## ${ROLE_LABELS[msg.role] ?? 'AI'}`,
			`<!-- curtis:msg ${json} -->`,
			'',
			content.trim(),
			''
		);
	}
	return parts.join('\n');
}

/** File name for a conversation file: "<created-date> <slug> <id6>.md" so
 *  files sort chronologically and survive title renames without colliding. */
export function conversationFileName(conv: Conversation): string {
	const d = new Date(conv.createdAt);
	const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	// Short random tail from the conversation id guarantees uniqueness even
	// when two chats share a title and a creation date.
	const short = conv.id.split('_').pop()?.slice(-6) || conv.id.slice(-6);
	return `${date} ${slugify(conv.title)} ${short}.md`;
}

/**
 * Parse a conversation markdown file into a Conversation.
 *
 * Layout (written by serializeConversationMarkdown; hand edits tolerated):
 *
 *   ---
 *   curtis: conversation
 *   id: conv_...
 *   ...
 *   ---
 *
 *   # Title
 *
 *   ## You
 *   <!-- curtis:msg {"id":"...","ts":...,"role":"user"} -->
 *
 *   message content
 *
 * The marker ends the heading area and opens the message; a message's content
 * runs from the end of its marker to the role heading that precedes the next
 * marker (or EOF). Sections without a marker can't be attributed to a role,
 * so they are not ingested — they stay readable in the file.
 *
 * Returns null when the file isn't a Curtis conversation (no frontmatter
 * signature) or the frontmatter is unreadable.
 */
export function parseConversationMarkdown(raw: string, fallbackMtime: number, yaml: YamlPort): Conversation | null {
	const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\s*\n?/);
	if (!fmMatch) return null;
	let fm: Record<string, unknown>;
	try {
		fm = yaml.parse(fmMatch[1]) as Record<string, unknown>;
	} catch {
		return null;
	}
	if (!fm || fm.curtis !== 'conversation' || typeof fm.id !== 'string') return null;

	const bodyStart = fmMatch[0].length;
	const body = raw.slice(bodyStart);

	// Locate every message marker.
	MSG_MARKER_RE.lastIndex = 0;
	const markers: Array<{ meta: Record<string, unknown>; start: number; end: number }> = [];
	let m: RegExpExecArray | null;
	while ((m = MSG_MARKER_RE.exec(body)) !== null) {
		try {
			markers.push({ meta: JSON.parse(m[1]) as Record<string, unknown>, start: m.index, end: m.index + m[0].length });
		} catch {
			// Malformed marker — treat as content, not a boundary.
		}
	}

	// Title = first H1 in the region before the first marker.
	const pre = body.slice(0, markers[0]?.start ?? body.length);
	const titleMatch = pre.match(/^# (.+)$/m);
	const title = titleMatch?.[1]?.trim() || 'Untitled';

	// For each marker, the content region ends where the NEXT message's role
	// heading begins. Scan back from the next marker over whitespace; if the
	// line above it is one of our fixed role headings, that heading starts the
	// next block — otherwise the next marker itself is the boundary.
	const messages: ConversationMessage[] = [];
	for (let i = 0; i < markers.length; i++) {
		const { meta } = markers[i];
		const role = readRole(meta.role);
		if (!role) continue;
		let contentEnd = body.length;
		if (i + 1 < markers.length) {
			const next = markers[i + 1].start;
			let j = next;
			while (j > 0 && /[\s]/.test(body[j - 1])) j--;
			const lineStart = body.lastIndexOf('\n', j - 1) + 1;
			const line = body.slice(lineStart, next).trimEnd();
			contentEnd = HEADING_LINE_RE.test(line) ? lineStart : next;
		}
		const content = body.slice(markers[i].end, contentEnd).replace(/^\n+/, '').replace(/\s+$/, '');
		messages.push({
			id: typeof meta.id === 'string' ? meta.id : `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
			role,
			content,
			timestamp: typeof meta.ts === 'number' ? meta.ts : fallbackMtime,
			provider: typeof meta.provider === 'string' ? meta.provider : undefined,
			model: typeof meta.model === 'string' ? meta.model : undefined,
			cost: typeof meta.cost === 'number' ? meta.cost : undefined,
			tokens: isTokenUsage(meta.tokens) ? meta.tokens : undefined,
			images: readStringArray(meta.images),
			attachedNotes: readStringArray(meta.attachedNotes),
			tool_calls: Array.isArray(meta.tool_calls) ? (meta.tool_calls as ConversationMessage['tool_calls']) : undefined,
			tool_call_id: typeof meta.tool_call_id === 'string' ? meta.tool_call_id : undefined,
			tool_error: meta.tool_error === true || undefined,
			memoriesUsedIds: readStringArray(meta.mem),
		});
	}

	const updatedAt = typeof fm.updated === 'number' ? fm.updated : fallbackMtime;
	const created = typeof fm.created === 'number' ? fm.created : updatedAt;
	return {
		id: fm.id,
		title,
		messages,
		createdAt: created,
		updatedAt,
		provider: typeof fm.provider === 'string' ? fm.provider : '',
		model: typeof fm.model === 'string' ? fm.model : '',
		role: fm.role === 'leader' || fm.role === 'follower' ? fm.role : undefined,
		leaderId: typeof fm.leaderId === 'string' ? fm.leaderId : undefined,
	};
}

function readRole(v: unknown): ConversationMessage['role'] | undefined {
	return v === 'user' || v === 'assistant' || v === 'tool' || v === 'system' ? v : undefined;
}

function readStringArray(v: unknown): string[] | undefined {
	if (!Array.isArray(v)) return undefined;
	const arr = v.filter((x): x is string => typeof x === 'string');
	return arr.length > 0 ? arr : undefined;
}

function isTokenUsage(v: unknown): v is TokenUsage {
	if (!v || typeof v !== 'object') return false;
	const o = v as Record<string, unknown>;
	return typeof o.promptTokens === 'number' && typeof o.completionTokens === 'number' && typeof o.totalTokens === 'number';
}

