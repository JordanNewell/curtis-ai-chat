import { PromptTemplate } from '../types';

export const BUILTIN_TEMPLATES: PromptTemplate[] = [
	// ── Writing ──
	{
		id: 'summarize',
		name: 'Summarize',
		description: 'Create a concise summary of the selected text',
		category: 'writing',
		content: 'Please summarize the following text:\n\n{{selection}}\n\nProvide a {{length}} summary that captures the key points.',
		variables: [
			{ name: 'selection', required: true, description: 'Text to summarize' },
			{ name: 'length', defaultValue: 'brief', description: 'brief, detailed, or one-sentence' },
		],
		icon: '📝',
	},
	{
		id: 'improve-writing',
		name: 'Improve Writing',
		description: 'Enhance clarity, grammar, and flow while preserving meaning',
		category: 'writing',
		content: 'Please improve the writing quality of the following text:\n\n{{selection}}\n\nFocus on:\n- Grammar and spelling\n- Clarity and conciseness\n- Flow and readability\n\nMaintain the original meaning and tone.',
		variables: [
			{ name: 'selection', required: true, description: 'Text to improve' },
		],
		icon: '✨',
	},
	{
		id: 'expand-text',
		name: 'Expand Text',
		description: 'Elaborate on ideas with more detail and examples',
		category: 'writing',
		content: 'Expand on the following text with more details, examples, and explanations:\n\n{{selection}}',
		variables: [
			{ name: 'selection', required: true, description: 'Text to expand' },
		],
		icon: '📖',
	},
	{
		id: 'change-tone',
		name: 'Change Tone',
		description: 'Adjust the tone of the text',
		category: 'writing',
		content: 'Rewrite the following text to be more {{tone}}:\n\n{{selection}}',
		variables: [
			{ name: 'selection', required: true, description: 'Text to rewrite' },
			{ name: 'tone', defaultValue: 'professional', description: 'professional, casual, friendly, formal, persuasive' },
		],
		icon: '🎭',
	},
	{
		id: 'translate',
		name: 'Translate',
		description: 'Translate text to another language',
		category: 'writing',
		content: 'Translate the following text to {{language}}:\n\n{{selection}}\n\nPreserve markdown formatting.',
		variables: [
			{ name: 'selection', required: true, description: 'Text to translate' },
			{ name: 'language', defaultValue: 'English', description: 'Target language' },
		],
		icon: '🌍',
	},

	// ── Coding ──
	{
		id: 'code-review',
		name: 'Code Review',
		description: 'Review code for bugs, security, and best practices',
		category: 'coding',
		content: 'Please review this code:\n\n```\n{{selection}}\n```\n\nAnalyze for:\n- Bugs and logical errors\n- Security vulnerabilities\n- Performance issues\n- Best practices\n\nProvide specific suggestions.',
		variables: [
			{ name: 'selection', required: true, description: 'Code to review' },
		],
		icon: '🔍',
	},
	{
		id: 'explain-code',
		name: 'Explain Code',
		description: 'Explain what code does step by step',
		category: 'coding',
		content: 'Please explain this code step by step:\n\n```\n{{selection}}\n```',
		variables: [
			{ name: 'selection', required: true, description: 'Code to explain' },
		],
		icon: '💻',
	},
	{
		id: 'generate-code',
		name: 'Generate Code',
		description: 'Generate code from a description',
		category: 'coding',
		content: 'Generate code for the following:\n\n{{selection}}\n\nInclude comments explaining the implementation.',
		variables: [
			{ name: 'selection', required: true, description: 'Code description' },
		],
		icon: '⚡',
	},
	{
		id: 'fix-code',
		name: 'Fix Code',
		description: 'Fix bugs in code',
		category: 'coding',
		content: 'Fix the bugs in this code:\n\n```\n{{selection}}\n```\n\nExplain each fix.',
		variables: [
			{ name: 'selection', required: true, description: 'Code with bugs' },
		],
		icon: '🔧',
	},

	// ── Analysis ──
	{
		id: 'extract-key-points',
		name: 'Extract Key Points',
		description: 'Extract the main ideas and key takeaways',
		category: 'analysis',
		content: 'Extract the key points from the following text:\n\n{{selection}}\n\nFormat as bullet points.',
		variables: [
			{ name: 'selection', required: true, description: 'Text to analyze' },
		],
		icon: '📋',
	},
	{
		id: 'compare',
		name: 'Compare',
		description: 'Compare two concepts or texts',
		category: 'analysis',
		content: 'Compare and contrast the following:\n\n{{selection}}\n\nHighlight similarities, differences, and key insights.',
		variables: [
			{ name: 'selection', required: true, description: 'Texts to compare' },
		],
		icon: '⚖️',
	},

	// ── Creative ──
	{
		id: 'brainstorm',
		name: 'Brainstorm',
		description: 'Generate creative ideas on a topic',
		category: 'creative',
		content: 'Brainstorm creative ideas for:\n\n{{selection}}\n\nGenerate 10 diverse ideas, ranked by potential.',
		variables: [
			{ name: 'selection', required: true, description: 'Topic to brainstorm' },
		],
		icon: '💡',
	},
	{
		id: 'outline',
		name: 'Create Outline',
		description: 'Create a structured outline for a topic',
		category: 'creative',
		content: 'Create a detailed outline for:\n\n{{selection}}\n\nInclude main sections, subsections, and key points.',
		variables: [
			{ name: 'selection', required: true, description: 'Topic to outline' },
		],
		icon: '🗂️',
	},

	// ── Productivity ──
	{
		id: 'action-items',
		name: 'Extract Action Items',
		description: 'Extract actionable tasks from text',
		category: 'productivity',
		content: 'Extract all action items and tasks from the following text:\n\n{{selection}}\n\nFormat as a checklist with priorities.',
		variables: [
			{ name: 'selection', required: true, description: 'Text to extract tasks from' },
		],
		icon: '✅',
	},
	{
		id: 'meeting-notes',
		name: 'Format Meeting Notes',
		description: 'Structure raw notes into formatted meeting notes',
		category: 'productivity',
		content: 'Format these meeting notes into a structured document:\n\n{{selection}}\n\nInclude: summary, decisions, action items with owners, and next steps.',
		variables: [
			{ name: 'selection', required: true, description: 'Raw meeting notes' },
		],
		icon: '📊',
	},

	// ── Learning ──
	{
		id: 'simplify',
		name: 'Simplify',
		description: 'Explain complex topic in simple terms (ELI5)',
		category: 'learning',
		content: 'Explain the following in simple terms that anyone could understand:\n\n{{selection}}\n\nUse analogies and examples.',
		variables: [
			{ name: 'selection', required: true, description: 'Complex topic' },
		],
		icon: '🎓',
	},
	{
		id: 'quiz',
		name: 'Generate Quiz',
		description: 'Create quiz questions to test understanding',
		category: 'learning',
		content: 'Create quiz questions based on:\n\n{{selection}}\n\nGenerate 5 questions with answers.',
		variables: [
			{ name: 'selection', required: true, description: 'Study material' },
		],
		icon: '❓',
	},
	{
		id: 'flashcards',
		name: 'Generate Flashcards',
		description: 'Create flashcards for spaced repetition',
		category: 'learning',
		content: 'Create flashcards from:\n\n{{selection}}\n\nFormat as Q&A pairs suitable for spaced repetition.',
		variables: [
			{ name: 'selection', required: true, description: 'Content to make flashcards from' },
		],
		icon: '🃏',
	},

	// ── Extended Coding ──
	{
		id: 'refactor',
		name: 'Refactor Code',
		description: 'Improve structure, naming, and clarity without changing behavior',
		category: 'coding',
		content: 'Refactor the following code. Preserve behavior, improve naming, structure, and language idioms. Output only the refactored code with a brief note on the changes.\n\n```\n{{selection}}\n```',
		variables: [
			{ name: 'selection', required: true, description: 'Code to refactor' },
		],
		icon: '🔨',
	},
	{
		id: 'add-tests',
		name: 'Add Tests',
		description: 'Generate unit tests for the selection',
		category: 'coding',
		content: 'Write unit tests for:\n\n```\n{{selection}}\n```\n\nUse sensible framework conventions and cover happy path plus edge cases.',
		variables: [
			{ name: 'selection', required: true, description: 'Code to test' },
		],
		icon: '🧪',
	},
	{
		id: 'add-types',
		name: 'Add Type Annotations',
		description: 'Add TypeScript / type annotations to the code',
		category: 'coding',
		content: 'Add type annotations to the following code. Preserve behavior and runtime semantics. Output only the typed code.\n\n```\n{{selection}}\n```',
		variables: [
			{ name: 'selection', required: true, description: 'Untyped code' },
		],
		icon: '🏷️',
	},
	{
		id: 'add-docs',
		name: 'Add Documentation',
		description: 'Generate doc comments for functions, classes, and modules',
		category: 'coding',
		content: 'Add documentation comments (JSDoc, docstrings, or language-appropriate) to:\n\n```\n{{selection}}\n```\n\nOutput only the documented code.',
		variables: [
			{ name: 'selection', required: true, description: 'Code to document' },
		],
		icon: '📚',
	},
	{
		id: 'security-audit',
		name: 'Security Audit',
		description: 'Flag security issues and suggest fixes',
		category: 'coding',
		content: 'Audit the following code for security vulnerabilities (injection, auth, secrets, SSRF, deserialization, etc.). Rate severity, explain, and propose fixes.\n\n```\n{{selection}}\n```',
		variables: [
			{ name: 'selection', required: true, description: 'Code to audit' },
		],
		icon: '🔒',
	},
	{
		id: 'convert-language',
		name: 'Convert Language',
		description: 'Translate code from one language to another',
		category: 'coding',
		content: 'Convert the following code from {{from}} to {{to}}. Preserve behavior and idioms of the target language. Output only the converted code.\n\n```\n{{selection}}\n```',
		variables: [
			{ name: 'selection', required: true, description: 'Source code' },
			{ name: 'from', required: true, defaultValue: 'JavaScript', description: 'Source language' },
			{ name: 'to', required: true, defaultValue: 'Python', description: 'Target language' },
		],
		icon: '🔄',
	},

	// ── Extended Writing ──
	{
		id: 'fix-grammar',
		name: 'Fix Grammar',
		description: 'Correct grammar, spelling, and punctuation',
		category: 'writing',
		content: 'Fix grammar, spelling, and punctuation errors in the text. Preserve meaning and tone. Output only the corrected text.\n\n{{selection}}',
		variables: [
			{ name: 'selection', required: true, description: 'Text to correct' },
		],
		icon: '✅',
	},
	{
		id: 'shorten',
		name: 'Shorten Text',
		description: 'Cut text to roughly half its length while keeping key info',
		category: 'writing',
		content: 'Shorten the following text to about half its length while keeping all key information. Output only the shortened text.\n\n{{selection}}',
		variables: [
			{ name: 'selection', required: true, description: 'Text to shorten' },
		],
		icon: '✂️',
	},
	{
		id: 'rewrite-tone-formal',
		name: 'Rewrite: Formal Tone',
		description: 'Rewrite the text in a formal, professional tone',
		category: 'writing',
		content: 'Rewrite the following text in a formal, professional tone while preserving meaning. Output only the rewritten text.\n\n{{selection}}',
		variables: [
			{ name: 'selection', required: true, description: 'Text to rewrite' },
		],
		icon: '🎩',
	},
	{
		id: 'rewrite-tone-casual',
		name: 'Rewrite: Casual Tone',
		description: 'Rewrite the text in a friendly, conversational tone',
		category: 'writing',
		content: 'Rewrite the following text in a friendly, conversational tone while preserving meaning. Output only the rewritten text.\n\n{{selection}}',
		variables: [
			{ name: 'selection', required: true, description: 'Text to rewrite' },
		],
		icon: '😎',
	},
	{
		id: 'proofread',
		name: 'Proofread',
		description: 'Find typos, awkward phrasing, and inconsistencies',
		category: 'writing',
		content: 'Proofread the following text. List issues as bullet points, then output a corrected version below.\n\n{{selection}}',
		variables: [
			{ name: 'selection', required: true, description: 'Text to proofread' },
		],
		icon: '🔍',
	},

	// ── Extended Productivity ──
	{
		id: 'tldr',
		name: 'TL;DR',
		description: 'One-sentence TL;DR plus 3 bullet points',
		category: 'productivity',
		content: 'Produce a one-sentence TL;DR followed by 3 bullet points for:\n\n{{selection}}',
		variables: [
			{ name: 'selection', required: true, description: 'Source text' },
		],
		icon: '⚡',
	},
	{
		id: 'table-from-text',
		name: 'Table From Text',
		description: 'Convert free-form text into a markdown table',
		category: 'productivity',
		content: 'Convert the following text into a clean markdown table. Pick sensible column headers.\n\n{{selection}}',
		variables: [
			{ name: 'selection', required: true, description: 'Text to tabulate' },
		],
		icon: '📋',
	},
	{
		id: 'extract-links',
		name: 'Extract Wikilinks',
		description: 'Find entities worth of Obsidian wikilinks',
		category: 'productivity',
		content: 'From the following text, identify key entities and concepts worth of Obsidian wikilinks. Output a comma-separated list of [[Wikilink Title]] entries. No prose.\n\n{{selection}}',
		variables: [
			{ name: 'selection', required: true, description: 'Source text' },
		],
		icon: '🔗',
	},

	// ── Extended Analysis ──
	{
		id: 'pros-cons',
		name: 'Pros & Cons',
		description: 'List pros and cons of a decision or option',
		category: 'analysis',
		content: 'List pros and cons for the following. Use two markdown sub-sections (## Pros / ## Cons). Output only those sections.\n\n{{selection}}',
		variables: [
			{ name: 'selection', required: true, description: 'Subject' },
		],
		icon: '⚖️',
	},
	{
		id: 'root-cause',
		name: 'Root Cause Analysis',
		description: 'Identify the underlying cause of an issue',
		category: 'analysis',
		content: 'Perform a root-cause analysis on the following issue. Apply the "5 Whys" technique, then state the most likely root cause and a recommended fix.\n\n{{selection}}',
		variables: [
			{ name: 'selection', required: true, description: 'Issue description' },
		],
		icon: '🕵️',
	},
];
