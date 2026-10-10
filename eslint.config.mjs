// ESLint config — obsidianmd/eslint-plugin's recommended config, with
// parserOptions.projectService injected so type-checked rules work.
// This matches what the Obsidian plugin directory runs for review.
import obsidian from 'eslint-plugin-obsidianmd';

export default [
	...obsidian.configs.recommended,
	{
		files: ['**/*.ts'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			// Recommended default, plus: strings mentioning MCP are exempt from
			// sentence-case — it's a protocol name the rule doesn't know, and
			// passing `acronyms` here REPLACES the built-in list, so exempting
			// the strings is the maintainable way to keep "MCP servers" uppercase.
			// "Curtis" is exempt for the same reason: it's the product name, and
			// sentence-case would demand "curtis" mid-string. "Jordan Newell"
			// likewise — a proper name the rule would lowercase to "newell".
			// "GCP" is Google Cloud, same story as MCP. "ChatGPT" is OpenAI's
			// product name, same story. "AI" is the vault folder prefix the
			// defaults use (AI Notes, AI/Conversations, AI/Scheduled) — the
			// rule would lowercase it to "ai/…" inside UI copy.
			'obsidianmd/ui/sentence-case': ['warn', { enforceCamelCaseLower: true, ignoreRegex: ['MCP', 'GCP', 'Curtis', 'ChatGPT', 'Jordan Newell', 'AI'] }],
		},
	},
	{
		// Deliberately Obsidian-free modules — zero obsidian imports — so their
		// suites run under vitest/node and the Porter repo can reuse them,
		// where `window` does not exist. Bare timers are the point here:
		// prefer-window-timers (a popout-compat rule) must not "fix" them back,
		// and no-restricted-globals makes any window.* use a hard error so the
		// node boundary cannot silently regress.
		files: [
			'src/autocomplete/controller.ts',
			'src/agents/pcp.ts',
			'src/agents/pcp.test.ts',
			'src/chat/conversation-format.ts',
			'src/chat/conversation-store.ts',
			'src/chat/conversation-store.test.ts',
			'src/core/tool-schema.ts',
			'src/gcp/auth.ts',
			'src/gcp/auth.test.ts',
			'src/gcp/http.ts',
			'src/gcp/storage.ts',
			'src/gcp/storage.test.ts',
			'src/providers/chatgpt.ts',
			'src/providers/chatgpt.test.ts',
			'src/terminal/vshell.ts',
			'src/terminal/vshell.test.ts',
			'src/scheduler/schedule.ts',
			'src/scheduler/schedule.test.ts',
		],
		rules: {
			'obsidianmd/prefer-window-timers': 'off',
			'no-restricted-globals': ['error', 'window'],
		},
	},
];
