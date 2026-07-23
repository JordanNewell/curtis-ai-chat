// ESLint flat config — matches the Obsidian plugin directory's automated
// review ruleset (obsidianmd/eslint-plugin recommended + type-checked
// @typescript-eslint rules). `npm run lint` reproduces the scorecard.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import obsidian from 'eslint-plugin-obsidianmd';

export default tseslint.config(
	{
		ignores: [
			'node_modules/',
			'main.js',
			'main.js.map',
			'_research/',
			'demo-vault/',
			'scripts/',
			'esbuild.config.mjs',
			'version-bump.mjs',
		],
	},
	{
		files: ['src/**/*.ts'],
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
			globals: {
				window: 'readonly',
				document: 'readonly',
				navigator: 'readonly',
				DOMParser: 'readonly',
				FormData: 'readonly',
				TextEncoder: 'readonly',
				fetch: 'readonly',
				AudioContext: 'readonly',
			},
		},
		plugins: {
			'@typescript-eslint': tseslint.plugin,
			obsidian,
		},
		extends: [
			js.configs.recommended,
			...tseslint.configs.recommendedTypeChecked,
		],
		rules: {
			...obsidian.configs.recommended.rules,
			// Strict rules the scorecard also flags
			'@typescript-eslint/no-unnecessary-type-assertion': 'warn',
			'@typescript-eslint/no-redundant-type-constituents': 'warn',
			'@typescript-eslint/no-floating-promises': 'warn',
			'@typescript-eslint/no-misused-promises': 'warn',
			'@typescript-eslint/no-deprecated': 'warn',
			// Scorecard treats unsafe-* as warnings
			'@typescript-eslint/no-unsafe-assignment': 'warn',
			'@typescript-eslint/no-unsafe-call': 'warn',
			'@typescript-eslint/no-unsafe-member-access': 'warn',
			'@typescript-eslint/no-unsafe-argument': 'warn',
			'@typescript-eslint/no-unsafe-return': 'warn',
			// Codebase relaxations (intentional)
			'@typescript-eslint/no-explicit-any': 'warn',
			'@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
			'@typescript-eslint/no-empty-object-type': 'off',
			'@typescript-eslint/no-empty-function': 'off',
			'@typescript-eslint/require-await': 'off',
			'@typescript-eslint/no-unnecessary-condition': 'off',
			'@typescript-eslint/no-non-null-assertion': 'off',
			// Not enforced by the scorecard
			'@typescript-eslint/restrict-template-expressions': 'off',
			'@typescript-eslint/no-confusing-void-expression': 'off',
			'@typescript-eslint/use-unknown-in-catch-callback-variable': 'off',
			'@typescript-eslint/no-dynamic-delete': 'off',
			'@typescript-eslint/no-base-to-string': 'off',
			'@typescript-eslint/no-useless-constructor': 'off',
			'@typescript-eslint/no-unnecessary-type-parameters': 'off',
			'@typescript-eslint/no-unnecessary-boolean-literal-compare': 'off',
		},
	},
);
