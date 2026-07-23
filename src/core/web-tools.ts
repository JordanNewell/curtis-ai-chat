// Web tools — opt-in internet access for Curtis Agent.
//
// Two tools:
//   web_search — DuckDuckGo HTML scrape, returns top N results (title, URL,
//                snippet). No API key, no rate-limit headers — works for
//                personal/OSS use but don't hammer it.
//   read_url   — Jina AI reader (https://r.jina.ai/<url>) — fetches a URL,
//                strips to clean markdown. Free tier, rate-limited per IP.
//
// Both registered conditionally by ToolRegistry when settings.enableWebSearch
// is true. Off by default — Curtis is vault-first; web access is opt-in so the
// "stay in your lane" principle holds for users who want it.

import { requestUrl } from 'obsidian';
import type { ToolDefinition } from './tools';
import { isRecord } from './types/json-helpers';

const DDG_ENDPOINT = 'https://html.duckduckgo.com/html/';
const JINA_ENDPOINT = 'https://r.jina.ai/';

interface DDGResult {
	title: string;
	url: string;
	snippet: string;
}

/**
 * Parse DuckDuckGo's HTML results page. Uses DOMParser (available in
 * Obsidian's Chromium runtime) to walk the .result__a / .result__snippet
 * nodes. Returns up to `max` results.
 */
function parseDDGHtml(html: string, max: number): DDGResult[] {
	const doc = new DOMParser().parseFromString(html, 'text/html');
	const out: DDGResult[] = [];
	const anchors = Array.from(doc.querySelectorAll('.result__a'));
	for (const a of anchors) {
		if (out.length >= max) break;
		const title = (a.textContent || '').trim();
		if (!title) continue;
		// DDG wraps URLs in a redirect stub like //duckduckgo.com/l/?uddg=<encoded>
		const rawHref = a.getAttribute('href') || '';
		const url = unwrapDDGRedirect(rawHref);
		if (!url) continue;
		const resultBlock = a.closest('.result, .web-result');
		const snippet = (resultBlock?.querySelector('.result__snippet')?.textContent || '').trim();
		out.push({ title, url, snippet });
	}
	return out;
}

/** Pull the actual target URL out of DDG's `//duckduckgo.com/l/?uddg=...` redirect. */
function unwrapDDGRedirect(href: string): string {
	const match = href.match(/uddg=([^&]+)/);
	if (match) {
		try {
			return decodeURIComponent(match[1]);
		} catch {
			return href;
		}
	}
	// Some results are direct links.
	if (href.startsWith('http://') || href.startsWith('https://')) return href;
	return '';
}

export const WEB_SEARCH_TOOL: ToolDefinition = {
	name: 'web_search',
	description:
		'Search the web via DuckDuckGo. Returns up to 5 results (title, URL, snippet). ' +
		'Use this when the user asks about something outside the vault — current events, ' +
		'documentation, definitions, recent releases, etc. For deeper content from a ' +
		'specific page, follow up with read_url.',
	parameters: {
		query: { type: 'string', description: 'Search query', required: true },
		max_results: {
			type: 'number',
			description: 'Maximum results to return (default: 5, max: 10)',
			default: 5,
		},
	},
	execute: async (params) => {
		const query = String(params.query || '').trim();
		if (!query) return 'Search query is required.';
		const max = Math.min(10, Math.max(1, Number(params.max_results) || 5));

		try {
			const resp = await requestUrl({
				url: `${DDG_ENDPOINT}?q=${encodeURIComponent(query)}`,
				method: 'GET',
				headers: {
					// DDG returns HTML to a real UA; some bots get blanked.
					'User-Agent':
						'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
				},
			});
			const results = parseDDGHtml(resp.text, max);
			if (results.length === 0) {
				return `No results for "${query}".`;
			}
			const lines = results.map(
				(r, i) =>
					`${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`
			);
			return `Found ${results.length} results for "${query}":\n\n${lines.join('\n\n')}`;
		} catch (e) {
			return `Web search failed: ${e instanceof Error ? e.message : String(e)}`;
		}
	},
};

export const READ_URL_TOOL: ToolDefinition = {
	name: 'read_url',
	description:
		'Fetch a URL and return its content as clean markdown (via Jina AI reader). ' +
		'Use after web_search when you need the full text of a specific page, or when ' +
		'the user pastes a URL. Handles paywall-light sites, blog posts, documentation ' +
		'pages. May fail on heavy SPA apps or paywalled content.',
	parameters: {
		url: { type: 'string', description: 'The full URL to fetch (https://...)', required: true },
	},
	execute: async (params) => {
		const url = String(params.url || '').trim();
		if (!url) return 'URL is required.';
		if (!/^https?:\/\//i.test(url)) {
			return 'URL must start with http:// or https://';
		}

		try {
			const resp = await requestUrl({
				url: `${JINA_ENDPOINT}${url}`,
				method: 'GET',
				headers: {
					Accept: 'application/json',
					'X-Return-Format': 'markdown',
				},
			});
			// Jina returns either plain markdown (text/plain) or JSON with a `data.content` field.
			const contentType = resp.headers?.['content-type'] || '';
			if (contentType.includes('application/json')) {
				try {
					// Narrow at the boundary: JSON.parse yields unknown; run it
					// through isRecord before touching any field so the value
					// never enters typed code as `any`.
					const parsed: unknown = JSON.parse(resp.text);
					if (isRecord(parsed)) {
						// Jina nests under `data` (newer API) or at the root (older).
						const nested = isRecord(parsed.data) ? parsed.data : parsed;
						const content = typeof nested.content === 'string' ? nested.content : '';
						const title = typeof nested.title === 'string' ? nested.title : '';
						if (content) return title ? `# ${title}\n\n${content}` : content;
					}
					return `No readable content at ${url}`;
				} catch {
					// Fall through to treating as plain text.
				}
			}
			if (!resp.text || resp.text.trim().length === 0) {
				return `No readable content at ${url}`;
			}
			// Truncate to keep tool result manageable — providers cap context.
			const MAX = 8000;
			const body = resp.text.length > MAX
				? resp.text.slice(0, MAX) + '\n\n…[truncated]'
				: resp.text;
			return body;
		} catch (e) {
			return `URL fetch failed: ${e instanceof Error ? e.message : String(e)}`;
		}
	},
};
