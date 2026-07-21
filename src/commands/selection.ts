export interface SelectionAction {
	systemPrompt: string;
	userPrompt: (text: string) => string;
	insertMode: 'replace' | 'insert-below' | 'none';
}

export const SELECTION_ACTIONS: Record<string, SelectionAction> = {
	summarize: {
		systemPrompt: 'Provide a concise summary. Use bullet points for key takeaways. Output only the summary.',
		userPrompt: (text) => `Summarize the following text:\n\n${text}`,
		insertMode: 'replace',
	},
	explain: {
		systemPrompt: 'Explain in clear, simple terms. Break down complex concepts step by step. Output only the explanation.',
		userPrompt: (text) => `Explain the following:\n\n${text}`,
		insertMode: 'replace',
	},
	improve: {
		systemPrompt: 'Improve the writing quality. Fix grammar, enhance clarity and flow. Maintain the original meaning and tone. Output only the improved text.',
		userPrompt: (text) => `Improve this text while preserving its meaning:\n\n${text}`,
		insertMode: 'replace',
	},
	translate: {
		systemPrompt: 'Translate the text accurately. Preserve markdown formatting. Output only the translation.',
		userPrompt: (text) => `Translate the following to English:\n\n${text}`,
		insertMode: 'replace',
	},
	'code-review': {
		systemPrompt: 'Review the code for bugs, security issues, performance, and best practices. Provide specific, actionable suggestions.',
		userPrompt: (text) => `Review this code:\n\n\`\`\`\n${text}\n\`\`\``,
		insertMode: 'replace',
	},
	'explain-code': {
		systemPrompt: 'Explain what this code does step by step. Include key concepts and patterns used.',
		userPrompt: (text) => `Explain what this code does:\n\n\`\`\`\n${text}\n\`\`\``,
		insertMode: 'replace',
	},
	generate: {
		systemPrompt: 'Generate content based on the user request. Use markdown formatting.',
		userPrompt: (text) => text,
		insertMode: 'insert-below',
	},
	'key-points': {
		systemPrompt: 'Extract the main ideas and key takeaways. Format as a structured list with categories if applicable.',
		userPrompt: (text) => `Extract key points from:\n\n${text}`,
		insertMode: 'replace',
	},
	'fix-grammar': {
		systemPrompt: 'Fix grammar, spelling, and punctuation errors. Preserve meaning, tone, and markdown formatting. Output only the corrected text.',
		userPrompt: (text) => `Fix the grammar of:\n\n${text}`,
		insertMode: 'replace',
	},
	shorten: {
		systemPrompt: 'Shorten the text while keeping all key information. Aim for roughly half the length. Output only the shortened text.',
		userPrompt: (text) => `Shorten this:\n\n${text}`,
		insertMode: 'replace',
	},
	tldr: {
		systemPrompt: 'Produce a one-sentence TL;DR followed by 3 bullet points. Output only the summary.',
		userPrompt: (text) => `TL;DR for:\n\n${text}`,
		insertMode: 'replace',
	},
	refactor: {
		systemPrompt: 'Refactor the code for clarity, naming, and structure without changing behavior. Follow language idioms. Output only the refactored code.',
		userPrompt: (text) => `Refactor this code:\n\n\`\`\`\n${text}\n\`\`\``,
		insertMode: 'replace',
	},
	'add-tests': {
		systemPrompt: 'Write unit tests for the given code. Use sensible framework conventions and cover edge cases.',
		userPrompt: (text) => `Write tests for:\n\n\`\`\`\n${text}\n\`\`\``,
		insertMode: 'insert-below',
	},
	'convert-callout': {
		systemPrompt: 'Wrap the user text as an Obsidian callout. Use a sensible callout type (note/tip/warning/info). Output only the callout block.',
		userPrompt: (text) => `Convert to an Obsidian callout:\n\n${text}`,
		insertMode: 'replace',
	},
	'extract-links': {
		systemPrompt: 'Identify key entities and concepts in the text that would make good Obsidian wikilinks. Output a comma-separated list of wikilinks like [[Topic Name]]. No prose.',
		userPrompt: (text) => `Extract wikilinks from:\n\n${text}`,
		insertMode: 'insert-below',
	},
	eli5: {
		systemPrompt: 'Explain the text like the reader is five years old. Use simple words and analogies. Output only the explanation.',
		userPrompt: (text) => `Explain like I am 5:\n\n${text}`,
		insertMode: 'replace',
	},
	'table-from-text': {
		systemPrompt: 'Convert the text into a clean markdown table. Pick sensible column headers. Output only the table.',
		userPrompt: (text) => `Make a markdown table from:\n\n${text}`,
		insertMode: 'replace',
	},
	'pros-cons': {
		systemPrompt: 'List pros and cons as two markdown sub-sections. Output only those sections.',
		userPrompt: (text) => `Pros and cons of:\n\n${text}`,
		insertMode: 'replace',
	},
};
