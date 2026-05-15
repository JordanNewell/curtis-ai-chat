// Prompt Templates System with Variables and Categories

export interface TemplateVariable {
	name: string;
	defaultValue?: string;
	required?: boolean;
	description?: string;
}

export interface PromptTemplate {
	id: string;
	name: string;
	description: string;
	category: TemplateCategory;
	content: string;
	variables?: TemplateVariable[];
	systemPrompt?: string;
	provider?: 'claude' | 'glm' | 'gemini' | 'any';
	model?: string;
	temperature?: number;
	maxTokens?: number;
	icon?: string;
}

export type TemplateCategory =
	| 'writing'
	| 'coding'
	| 'analysis'
	| 'creative'
	| 'productivity'
	| 'learning'
	| 'custom';

// Built-in templates
export const BUILTIN_TEMPLATES: PromptTemplate[] = [
	// Writing Templates
	{
		id: 'summarize',
		name: 'Summarize',
		description: 'Create a concise summary of the selected text',
		category: 'writing',
		content: 'Please summarize the following text:\n\n{{selection}}\n\nProvide a {length} summary that captures the key points.',
		variables: [
			{ name: 'selection', defaultValue: '', required: true, description: 'Text to summarize' },
			{ name: 'length', defaultValue: 'brief', description: 'Summary length: brief, detailed, or one-sentence' }
		],
		icon: '📝'
	},
	{
		id: 'improve-writing',
		name: 'Improve Writing',
		description: 'Enhance clarity, grammar, and flow while preserving meaning',
		category: 'writing',
		content: 'Please improve the writing quality of the following text:\n\n{{selection}}\n\nFocus on:\n- Grammar and spelling\n- Clarity and conciseness\n- Flow and readability\n\nMaintain the original meaning and tone.',
		variables: [
			{ name: 'selection', defaultValue: '', required: true, description: 'Text to improve' }
		],
		icon: '✨'
	},
	{
		id: 'expand-text',
		name: 'Expand Text',
		description: 'Elaborate on ideas with more detail and examples',
		category: 'writing',
		content: 'Expand on the following text with more details, examples, and explanations:\n\n{{selection}}',
		variables: [
			{ name: 'selection', defaultValue: '', required: true, description: 'Text to expand' }
		],
		icon: '📖'
	},
	{
		id: 'change-tone',
		name: 'Change Tone',
		description: 'Adjust the tone of the text to be more formal, casual, etc.',
		category: 'writing',
		content: 'Rewrite the following text to be more {{tone}}:\n\n{{selection}}',
		variables: [
			{ name: 'selection', defaultValue: '', required: true, description: 'Text to rewrite' },
			{ name: 'tone', defaultValue: 'professional', description: 'Desired tone: professional, casual, friendly, formal, persuasive' }
		],
		icon: '🎭'
	},

	// Coding Templates
	{
		id: 'code-review',
		name: 'Code Review',
		description: 'Review code for bugs, security issues, and best practices',
		category: 'coding',
		content: 'Please review the following code for:\n- Bugs and errors\n- Security vulnerabilities\n- Performance issues\n- Best practices violations\n- Code style and readability\n\n```{{language}}\n{{selection}}\n```\n\nProvide specific suggestions for improvement.',
		systemPrompt: 'You are an expert code reviewer. Analyze code thoroughly and provide constructive feedback.',
		variables: [
			{ name: 'selection', defaultValue: '', required: true, description: 'Code to review' },
			{ name: 'language', defaultValue: 'javascript', description: 'Programming language' }
		],
		icon: '🔍'
	},
	{
		id: 'explain-code',
		name: 'Explain Code',
		description: 'Get a detailed explanation of what the code does',
		category: 'coding',
		content: 'Explain what the following code does, how it works:\n\n```{{language}}\n{{selection}}\n```\n\nInclude:\n- Overall purpose\n- Step-by-step breakdown\n- Key concepts and patterns used',
		systemPrompt: 'You are a coding educator. Explain code clearly for developers of all levels.',
		variables: [
			{ name: 'selection', defaultValue: '', required: true, description: 'Code to explain' },
			{ name: 'language', defaultValue: 'javascript', description: 'Programming language' }
		],
		icon: '💡'
	},
	{
		id: 'generate-code',
		name: 'Generate Code',
		description: 'Generate code based on a description',
		category: 'coding',
		content: 'Generate code for the following:\n\n{{description}}\n\nRequirements:\n- Language: {{language}}\n- Include error handling\n- Add comments for clarity\n- Follow best practices',
		systemPrompt: 'You are an expert programmer. Write clean, efficient, well-documented code.',
		variables: [
			{ name: 'description', defaultValue: '', required: true, description: 'What the code should do' },
			{ name: 'language', defaultValue: 'javascript', description: 'Programming language' }
		],
		icon: '⌨️'
	},
	{
		id: 'fix-code',
		name: 'Fix Code',
		description: 'Debug and fix issues in the code',
		category: 'coding',
		content: 'Find and fix the bugs in this code:\n\n```{{language}}\n{{selection}}\n```\n\nExplain what was wrong and show the corrected version.',
		systemPrompt: 'You are an expert debugger. Identify issues and provide working solutions.',
		variables: [
			{ name: 'selection', defaultValue: '', required: true, description: 'Code with bugs' },
			{ name: 'language', defaultValue: 'javascript', description: 'Programming language' }
		],
		icon: '🔧'
	},
	{
		id: 'add-tests',
		name: 'Generate Tests',
		description: 'Create unit tests for the given code',
		category: 'coding',
		content: 'Generate comprehensive unit tests for the following code:\n\n```{{language}}\n{{selection}}\n```\n\nInclude edge cases and error scenarios.',
		systemPrompt: 'You are a test engineer. Write thorough, well-structured tests.',
		variables: [
			{ name: 'selection', defaultValue: '', required: true, description: 'Code to test' },
			{ name: 'language', defaultValue: 'javascript', description: 'Programming language' },
			{ name: 'framework', defaultValue: 'jest', description: 'Test framework (jest, pytest, etc.)' }
		],
		icon: '✅'
	},

	// Analysis Templates
	{
		id: 'analyze-sentiment',
		name: 'Sentiment Analysis',
		description: 'Analyze the emotional tone and sentiment',
		category: 'analysis',
		content: 'Analyze the sentiment of the following text:\n\n{{selection}}\n\nProvide:\n- Overall sentiment (positive/negative/neutral)\n- Emotional tone\n- Key phrases that indicate sentiment\n- Confidence level',
		variables: [
			{ name: 'selection', defaultValue: '', required: true, description: 'Text to analyze' }
		],
		icon: '😊'
	},
	{
		id: 'extract-keywords',
		name: 'Extract Keywords',
		description: 'Identify important keywords and topics',
		category: 'analysis',
		content: 'Extract the key topics, keywords, and concepts from:\n\n{{selection}}\n\nPresent them in a structured format with relevance scores.',
		variables: [
			{ name: 'selection', defaultValue: '', required: true, description: 'Text to analyze' }
		],
		icon: '🔑'
	},
	{
		id: 'compare-concepts',
		name: 'Compare Concepts',
		description: 'Create a detailed comparison between two concepts',
		category: 'analysis',
		content: 'Create a detailed comparison between {{concept1}} and {{concept2}}.\n\nInclude:\n- Definitions\n- Key similarities\n- Important differences\n- Use cases for each\n- When to choose one over the other',
		variables: [
			{ name: 'concept1', defaultValue: '', required: true, description: 'First concept' },
			{ name: 'concept2', defaultValue: '', required: true, description: 'Second concept' }
		],
		icon: '⚖️'
	},

	// Creative Templates
	{
		id: 'brainstorm',
		name: 'Brainstorm Ideas',
		description: 'Generate creative ideas for a topic',
		category: 'creative',
		content: 'Brainstorm creative ideas for: {{topic}}\n\nGenerate {{count}} unique, innovative ideas. Consider different angles and approaches.',
		variables: [
			{ name: 'topic', defaultValue: '', required: true, description: 'Topic to brainstorm' },
			{ name: 'count', defaultValue: '10', description: 'Number of ideas' }
		],
		icon: '💭'
	},
	{
		id: 'story-outline',
		name: 'Story Outline',
		description: 'Create a structured story outline',
		category: 'creative',
		content: 'Create a story outline based on this premise:\n\n{{premise}}\n\nInclude:\n- Act structure\n- Character arcs\n- Plot points\n- Themes',
		variables: [
			{ name: 'premise', defaultValue: '', required: true, description: 'Story premise' }
		],
		icon: '📚'
	},
	{
		id: 'rewrite-style',
		name: 'Rewrite in Style',
		description: 'Rewrite text in the style of a famous author or style',
		category: 'creative',
		content: 'Rewrite the following text in the style of {{style}}:\n\n{{selection}}',
		variables: [
			{ name: 'selection', defaultValue: '', required: true, description: 'Text to rewrite' },
			{ name: 'style', defaultValue: 'Shakespeare', description: 'Style: Shakespeare, Hemingway, Tolkien, etc.' }
		],
		icon: '🎨'
	},

	// Productivity Templates
	{
		id: 'action-items',
		name: 'Extract Action Items',
		description: 'Extract tasks and action items from text',
		category: 'productivity',
		content: 'Extract all action items, tasks, and commitments from:\n\n{{selection}}\n\nFormat as a checklist with priorities.',
		variables: [
			{ name: 'selection', defaultValue: '', required: true, description: 'Text containing tasks' }
		],
		icon: '✓'
	},
	{
		id: 'meeting-notes',
		name: 'Format Meeting Notes',
		description: 'Structure raw notes into professional meeting notes',
		category: 'productivity',
		content: 'Format the following notes into professional meeting notes:\n\n{{selection}}\n\nInclude:\n- Summary\n- Key decisions\n- Action items with owners\n- Next steps',
		variables: [
			{ name: 'selection', defaultValue: '', required: true, description: 'Raw meeting notes' }
		],
		icon: '📋'
	},
	{
		id: 'email-draft',
		name: 'Draft Email',
		description: 'Create a professional email based on key points',
		category: 'productivity',
		content: 'Draft a {{tone}} email for {{purpose}}.\n\nKey points to include:\n{{points}}\n\nMake it professional and effective.',
		variables: [
			{ name: 'purpose', defaultValue: '', required: true, description: 'Email purpose' },
			{ name: 'points', defaultValue: '', required: true, description: 'Key points to include' },
			{ name: 'tone', defaultValue: 'professional', description: 'Tone: professional, friendly, persuasive, apologetic' }
		],
		icon: '📧'
	},

	// Learning Templates
	{
		id: 'explain-like-five',
		name: 'Explain Like I\'m Five',
		description: 'Simplify complex topics for easy understanding',
		category: 'learning',
		content: 'Explain {{topic}} like I\'m five years old.\n\nUse simple language, analogies, and examples that a child could understand.',
		variables: [
			{ name: 'topic', defaultValue: '', required: true, description: 'Topic to explain' }
		],
		icon: '👶'
	},
	{
		id: 'study-guide',
		name: 'Create Study Guide',
		description: 'Generate a study guide from notes or content',
		category: 'learning',
		content: 'Create a comprehensive study guide for:\n\n{{selection}}\n\nInclude:\n- Key concepts\n- Definitions\n- Practice questions\n- Memory aids',
		variables: [
			{ name: 'selection', defaultValue: '', required: true, description: 'Content to study' }
		],
		icon: '📖'
	},
	{
		id: 'quiz-generator',
		name: 'Generate Quiz',
		description: 'Create quiz questions from content',
		category: 'learning',
		content: 'Generate {{count}} quiz questions from:\n\n{{selection}}\n\nInclude:\n- Multiple choice questions\n- True/false questions\n- Answer key with explanations',
		variables: [
			{ name: 'selection', defaultValue: '', required: true, description: 'Content for quiz' },
			{ name: 'count', defaultValue: '5', description: 'Number of questions' }
		],
		icon: '❓'
	}
];

export class TemplateManager {
	private templates: Map<string, PromptTemplate> = new Map();
	private customTemplates: Map<string, PromptTemplate> = new Map();

	constructor() {
		// Load built-in templates
		for (const template of BUILTIN_TEMPLATES) {
			this.templates.set(template.id, template);
		}
		this.loadCustomTemplates();
	}

	getTemplate(id: string): PromptTemplate | undefined {
		return this.templates.get(id) || this.customTemplates.get(id);
	}

	getAllTemplates(): PromptTemplate[] {
		return [
			...Array.from(this.templates.values()),
			...Array.from(this.customTemplates.values())
		];
	}

	getTemplatesByCategory(category: TemplateCategory): PromptTemplate[] {
		return this.getAllTemplates().filter(t => t.category === category);
	}

	searchTemplates(query: string): PromptTemplate[] {
		const lowerQuery = query.toLowerCase();
		return this.getAllTemplates().filter(t =>
			t.name.toLowerCase().includes(lowerQuery) ||
			t.description.toLowerCase().includes(lowerQuery)
		);
	}

	createTemplate(template: Omit<PromptTemplate, 'id'>): PromptTemplate {
		const id = `custom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		const newTemplate: PromptTemplate = { ...template, id };
		this.customTemplates.set(id, newTemplate);
		this.saveCustomTemplates();
		return newTemplate;
	}

	updateTemplate(id: string, updates: Partial<PromptTemplate>): void {
		const template = this.customTemplates.get(id);
		if (!template) return;

		const updated = { ...template, ...updates };
		this.customTemplates.set(id, updated);
		this.saveCustomTemplates();
	}

	deleteTemplate(id: string): void {
		this.customTemplates.delete(id);
		this.saveCustomTemplates();
	}

	renderTemplate(id: string, variables: Record<string, string>): string {
		const template = this.getTemplate(id);
		if (!template) throw new Error('Template not found');

		// Check required variables
		if (template.variables) {
			for (const v of template.variables) {
				if (v.required && !variables[v.name] && !v.defaultValue) {
					throw new Error(`Required variable '${v.name}' is missing`);
				}
			}
		}

		let content = template.content;

		// Replace variables
		if (template.variables) {
			for (const v of template.variables) {
				const value = variables[v.name] || v.defaultValue || '';
				const regex = new RegExp(`{{${v.name}}}`, 'g');
				content = content.replace(regex, value);
			}
		}

		return content;
	}

	getTemplateVariables(id: string): TemplateVariable[] {
		const template = this.getTemplate(id);
		return template?.variables || [];
	}

	private saveCustomTemplates(): void {
		const data = Array.from(this.customTemplates.entries());
		localStorage.setItem('ai-custom-templates', JSON.stringify(data));
	}

	private loadCustomTemplates(): void {
		const stored = localStorage.getItem('ai-custom-templates');
		if (stored) {
			try {
				const data = JSON.parse(stored);
				this.customTemplates = new Map(data);
			} catch (e) {
				console.error('Failed to load custom templates:', e);
			}
		}
	}

	exportTemplates(): string {
		const data = {
			version: 1,
			exportedAt: new Date().toISOString(),
			templates: Array.from(this.customTemplates.values())
		};
		return JSON.stringify(data, null, 2);
	}

	importTemplates(jsonString: string): void {
		try {
			const data = JSON.parse(jsonString);
			if (data.version === 1 && Array.isArray(data.templates)) {
				for (const template of data.templates) {
					this.customTemplates.set(template.id, template);
				}
				this.saveCustomTemplates();
			}
		} catch (e) {
			throw new Error(`Failed to import templates: ${(e as Error).message}`);
		}
	}
}
