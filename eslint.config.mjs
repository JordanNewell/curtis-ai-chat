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
			// sentence-case would demand "curtis" mid-string.
			'obsidianmd/ui/sentence-case': ['warn', { enforceCamelCaseLower: true, ignoreRegex: ['MCP', 'Curtis'] }],
		},
	},
];
