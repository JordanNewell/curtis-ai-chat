// ESLint config — uses obsidianmd/eslint-plugin's recommended config verbatim,
// with parserOptions.projectService injected so type-checked rules work.
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
	},
];
