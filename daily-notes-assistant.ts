// Daily Notes Assistant - AI-powered daily note automation

import { App, TFile, Notice } from 'obsidian';
import { VaultIndexer, NoteMetadata, PremiumSettings } from './vault-indexer';

// Use window.moment since moment is already loaded in Obsidian
declare const moment: any;

// ============================================================================
// INTERFACES
// ============================================================================

export interface DailyNoteAnalysis {
	path: string;
	date: string;
	summary: string;
	tasks: ExtractedTask[];
	topics: string[];
	sentiment: 'positive' | 'neutral' | 'negative';
	relatedNotes: string[];
	suggestedPrompts: string[];
	wordCount: number;
}

export interface ExtractedTask {
	text: string;
	priority: 'high' | 'medium' | 'low';
	category?: string;
	dueDate?: string;
	completed: boolean;
	lineNumber?: number;
}

export interface JournalPrompt {
	id: string;
	prompt: string;
	category: 'reflection' | 'gratitude' | 'goals' | 'creativity' | 'productivity';
}

// ============================================================================
// DAILY NOTES ASSISTANT CLASS
// ============================================================================

export class DailyNotesAssistant {
	private analysisCache: Map<string, DailyNoteAnalysis> = new Map();
	private readonly CACHE_TTL = 10 * 60 * 1000; // 10 minutes

	constructor(
		private app: App,
		private indexer: VaultIndexer,
		private settings: PremiumSettings,
		private callAI: (messages: any[]) => Promise<{ content: string }>
	) {}

	// ============================================================================
	// PUBLIC METHODS
	// ============================================================================

	/**
	 * Check if a file is a daily note based on its path
	 */
	isDailyNote(path: string): boolean {
		const folder = this.settings.dailyNotesFolder;
		const format = this.settings.dailyNotesFormat;

		// Check if file is in the daily notes folder
		if (folder && !path.includes(folder)) {
			return false;
		}

		// Try to parse the filename as a date
		const basename = path.split('/').pop()?.replace('.md', '') || '';
		const date = moment(basename, format, true);

		return date.isValid();
	}

	/**
	 * Extract date from a daily note path
	 */
	extractDateFromPath(path: string): Date | null {
		const format = this.settings.dailyNotesFormat;
		const basename = path.split('/').pop()?.replace('.md', '') || '';
		const date = moment(basename, format, true);

		return date.isValid() ? date.toDate() : null;
	}

	/**
	 * Analyze a daily note comprehensively
	 */
	async analyzeDailyNote(path: string): Promise<DailyNoteAnalysis> {
		// Check cache
		const cached = this.analysisCache.get(path);
		if (cached && Date.now() - (cached as any).timestamp < this.CACHE_TTL) {
			return cached;
		}

		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			throw new Error('File not found');
		}

		const content = await this.app.vault.read(file);
		const date = this.extractDateFromPath(path);

		// Extract tasks
		const tasks = this.parseTasksFromContent(content);

		// Get topics from tags and headings
		const metadata = this.indexer.getNoteMetadata(path);
		const topics = metadata?.tags || [];

		// Analyze sentiment (simplified)
		const sentiment = this.analyzeSentiment(content);

		// Find related notes
		const relatedNotes = await this.findRelatedNotes(content, topics);

		// Generate summary if not already present
		let summary = this.extractExistingSummary(content);
		if (!summary) {
			summary = await this.generateSummary(content);
		}

		// Generate prompts
		const suggestedPrompts = await this.generatePersonalizedPrompts(content, topics, tasks);

		const analysis: DailyNoteAnalysis = {
			path,
			date: date ? moment(date).format('YYYY-MM-DD') : 'Unknown',
			summary,
			tasks,
			topics,
			sentiment,
			relatedNotes,
			suggestedPrompts,
			wordCount: content.split(/\s+/).length
		};

		// Cache with timestamp
		(analysis as any).timestamp = Date.now();
		this.analysisCache.set(path, analysis);

		return analysis;
	}

	/**
	 * Generate a summary of the daily note content
	 */
	async generateSummary(content: string): Promise<string> {
		const messages = [
			{
				role: 'system',
				content: 'You are a helpful assistant that summarizes daily journal entries and notes. Create a concise 2-3 sentence summary that captures the key points, main events, and overall mood of the day.'
			},
			{
				role: 'user',
				content: `Please summarize this daily note:\n\n${content.slice(0, 3000)}`
			}
		];

		try {
			const result = await this.callAI(messages);
			return result.content.trim();
		} catch (error) {
			console.error('Failed to generate summary:', error);
			return 'Summary generation failed.';
		}
	}

	/**
	 * Extract tasks from the daily note content
	 */
	async extractTasks(content: string): Promise<ExtractedTask[]> {
		const tasks = this.parseTasksFromContent(content);

		// Use AI to categorize and prioritize uncategorized tasks
		const uncategorized = tasks.filter(t => !t.category);
		if (uncategorized.length > 0) {
			const categorizedTasks = await this.categorizeTasksWithAI(uncategorized);

			// Merge back into original tasks
			for (const original of tasks) {
				const categorized = categorizedTasks.find(ct => ct.text === original.text);
				if (categorized && categorized.category) {
					original.category = categorized.category;
					original.priority = categorized.priority;
				}
			}
		}

		return tasks;
	}

	/**
	 * Generate personalized journal prompts based on recent activity
	 */
	async generatePrompts(recentDays: number = 7): Promise<JournalPrompt[]> {
		// Get recent daily notes
		const allNotes = this.indexer.getAllMetadata();
		const dailyNotes = allNotes.filter(note => this.isDailyNote(note.path));

		// Sort by date and get recent ones
		const recentNotes = dailyNotes
			.sort((a, b) => b.modifiedAt - a.modifiedAt)
			.slice(0, recentDays);

		// Analyze patterns
		const recentTopics = this.aggregateTopics(recentNotes);
		const recentTasks = this.aggregateTasks(recentNotes);

		// Generate personalized prompts
		const prompts: JournalPrompt[] = [];

		// Reflection prompts based on recent activity
		if (recentTasks.length > 5) {
			prompts.push({
				id: 'task-reflection',
				prompt: `You've had ${recentTasks.length} tasks recently. What tasks are most important to you right now, and why?`,
				category: 'reflection'
			});
		}

		// Topic-based prompts
		if (recentTopics.length > 0) {
			const topTopic = recentTopics[0];
			prompts.push({
				id: 'topic-reflection',
				prompt: `You've been writing about "${topTopic}" lately. What new insights or questions do you have about this topic?`,
				category: 'reflection'
			});
		}

		// Gratitude prompt
		prompts.push({
			id: 'gratitude',
			prompt: 'What are three things you\'re grateful for today, no matter how small?',
			category: 'gratitude'
		});

		// Goals prompt
		prompts.push({
			id: 'goals',
			prompt: 'What\'s one thing you want to accomplish tomorrow? What steps will you take to make it happen?',
			category: 'goals'
		});

		// Creativity prompt
		prompts.push({
			id: 'creativity',
			prompt: 'If you could start a new project or learn a new skill today with no constraints, what would it be?',
			category: 'creativity'
		});

		// Productivity prompt
		prompts.push({
			id: 'productivity',
			prompt: 'What was your biggest distraction today? How can you minimize it tomorrow?',
			category: 'productivity'
		});

		return prompts;
	}

	/**
	 * Auto-process a daily note when it's opened
	 */
	async autoProcessDailyNote(): Promise<void> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile || !this.isDailyNote(activeFile.path)) {
			return;
		}

		// Only auto-process if enabled
		if (!this.settings.autoSummarizeDaily && !this.settings.autoExtractTasks) {
			return;
		}

		try {
			const analysis = await this.analyzeDailyNote(activeFile.path);

			// Show a notice with quick stats
			const taskCount = analysis.tasks.filter(t => !t.completed).length;
			const noticeMsg = `Daily Note: ${analysis.wordCount} words, ${taskCount} pending tasks`;
			new Notice(noticeMsg, 3000);
		} catch (error) {
			console.error('Failed to auto-process daily note:', error);
		}
	}

	/**
	 * Append content to a specific section of a daily note
	 */
	async appendToDailyNote(
		path: string,
		content: string,
		section: 'summary' | 'tasks' | 'prompts'
	): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			throw new Error('File not found');
		}

		const currentContent = await this.app.vault.read(file);

		let sectionHeader = '';
		switch (section) {
			case 'summary':
				sectionHeader = '## 📝 AI Summary';
				break;
			case 'tasks':
				sectionHeader = '## ✅ Extracted Tasks';
				break;
			case 'prompts':
				sectionHeader = '## 💭 Journal Prompts';
				break;
		}

		// Check if section already exists
		const sectionRegex = new RegExp(`^${sectionHeader.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm');
		if (sectionRegex.test(currentContent)) {
			// Section exists, replace its content
			const updatedContent = currentContent.replace(
				/(## [^\n]+\n\n)([\s\S]*?)(?=\n##|$)/,
				(match, header, existingContent) => {
					if (header.startsWith(sectionHeader)) {
						return `${header}\n${content}\n\n`;
					}
					return match;
				}
			);
			await this.app.vault.modify(file, updatedContent);
		} else {
			// Section doesn't exist, append it
			const newContent = currentContent.trim() + `\n\n${sectionHeader}\n${content}\n`;
			await this.app.vault.modify(file, newContent);
		}
	}

	// ============================================================================
	// PRIVATE METHODS
	// ============================================================================

	/**
	 * Parse tasks from markdown content
	 */
	private parseTasksFromContent(content: string): ExtractedTask[] {
		const tasks: ExtractedTask[] = [];
		const lines = content.split('\n');

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

			// Match task lists: - [ ] task, - [x] task, * [ ] task, etc.
			const taskMatch = line.match(/^[\s]*(?:[-*+]|\d+\.)\s+\[(x| )\]\s*(.+)$/i);
			if (taskMatch) {
				const completed = taskMatch[1].toLowerCase() === 'x';
				const taskText = taskMatch[2].trim();

				tasks.push({
					text: taskText,
					priority: 'medium', // Default priority
					completed,
					lineNumber: i + 1
				});
			}
		}

		return tasks;
	}

	/**
	 * Use AI to categorize and prioritize tasks
	 */
	private async categorizeTasksWithAI(tasks: ExtractedTask[]): Promise<ExtractedTask[]> {
		if (tasks.length === 0) return tasks;

		const taskList = tasks.map((t, i) => `${i + 1}. ${t.text}`).join('\n');

		const messages = [
			{
				role: 'system',
				content: 'You are a task management assistant. For each task, provide a category (work, personal, health, learning, finance, other) and priority (high, medium, low). Return as JSON array with format: [{"index": 1, "category": "work", "priority": "high"}]'
			},
			{
				role: 'user',
				content: `Categorize and prioritize these tasks:\n\n${taskList}\n\nReturn only the JSON array.`
			}
		];

		try {
			const result = await this.callAI(messages);
			const categorizations = JSON.parse(result.content);

			return tasks.map(task => {
				const cat = categorizations.find((c: any) => {
					const taskText = `${c.index}. ${task.text}`;
					return taskList.includes(taskText);
				});

				return {
					...task,
					category: cat?.category || 'other',
					priority: cat?.priority || 'medium'
				};
			});
		} catch (error) {
			console.error('Failed to categorize tasks:', error);
			return tasks; // Return original tasks if categorization fails
		}
	}

	/**
	 * Analyze sentiment of content (simplified)
	 */
	private analyzeSentiment(content: string): 'positive' | 'neutral' | 'negative' {
		const lowerContent = content.toLowerCase();

		// Simple keyword-based sentiment analysis
		const positiveWords = ['happy', 'great', 'awesome', 'excited', 'grateful', 'love', 'wonderful', 'amazing', 'good', 'best'];
		const negativeWords = ['sad', 'bad', 'terrible', 'awful', 'hate', 'angry', 'frustrated', 'worst', 'disappointed', 'stressed'];

		let positiveCount = 0;
		let negativeCount = 0;

		for (const word of positiveWords) {
			if (lowerContent.includes(word)) positiveCount++;
		}

		for (const word of negativeWords) {
			if (lowerContent.includes(word)) negativeCount++;
		}

		if (positiveCount > negativeCount) return 'positive';
		if (negativeCount > positiveCount) return 'negative';
		return 'neutral';
	}

	/**
	 * Find notes related to the daily note content
	 */
	private async findRelatedNotes(content: string, topics: string[]): Promise<string[]> {
		const relatedPaths: string[] = [];

		// Find notes by shared topics
		for (const topic of topics) {
			const notes = this.indexer.getNotesByTag(topic);
			for (const note of notes) {
				if (!relatedPaths.includes(note.path)) {
					relatedPaths.push(note.path);
				}
			}
		}

		// Search for content matches
		const words = content.split(/\s+/).slice(0, 50); // First 50 words
		for (const word of words) {
			if (word.length > 4) { // Only meaningful words
				const notes = this.indexer.searchNotes(word);
				for (const note of notes.slice(0, 3)) { // Limit results
					if (!relatedPaths.includes(note.path)) {
						relatedPaths.push(note.path);
					}
				}
			}
		}

		return relatedPaths.slice(0, 10); // Limit to 10 related notes
	}

	/**
	 * Extract existing AI summary from content
	 */
	private extractExistingSummary(content: string): string | null {
		const summaryMatch = content.match(/## 📝 AI Summary\n\n([\s\S]*?)(?=\n##|$)/);
		return summaryMatch ? summaryMatch[1].trim() : null;
	}

	/**
	 * Generate personalized prompts based on content and topics
	 */
	private async generatePersonalizedPrompts(
		content: string,
		topics: string[],
		tasks: ExtractedTask[]
	): Promise<string[]> {
		const prompts: string[] = [];

		// Task-based prompt
		const pendingTasks = tasks.filter(t => !t.completed);
		if (pendingTasks.length > 0) {
			prompts.push(`You have ${pendingTasks.length} pending tasks. Which one should you tackle first?`);
		}

		// Topic-based prompt
		if (topics.length > 0) {
			prompts.push(`What new perspective can you explore about "${topics[0]}"?`);
		}

		// Reflection prompt
		prompts.push('What was the most important thing you learned today?');

		// Gratitude prompt
		prompts.push('What moment today made you smile or feel grateful?');

		return prompts;
	}

	/**
	 * Aggregate topics from multiple notes
	 */
	private aggregateTopics(notes: NoteMetadata[]): string[] {
		const topicCounts = new Map<string, number>();

		for (const note of notes) {
			for (const topic of note.tags) {
				topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
			}
		}

		return Array.from(topicCounts.entries())
			.sort((a, b) => b[1] - a[1])
			.map(([topic]) => topic)
			.slice(0, 10);
	}

	/**
	 * Aggregate tasks from multiple notes
	 */
	private aggregateTasks(notes: NoteMetadata[]): ExtractedTask[] {
		const allTasks: ExtractedTask[] = [];

		for (const note of notes) {
			const content = ''; // Would need to read file content
			const tasks = this.parseTasksFromContent(content);
			allTasks.push(...tasks);
		}

		return allTasks;
	}
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Create default journal prompts
 */
export function createDefaultJournalPrompts(): JournalPrompt[] {
	return [
		{
			id: 'morning-intention',
			prompt: 'What is your main intention for today? How do you want to feel?',
			category: 'reflection'
		},
		{
			id: 'gratitude',
			prompt: 'What are three things you\'re grateful for today?',
			category: 'gratitude'
		},
		{
			id: 'challenge',
			prompt: 'What challenge did you face today, and what did you learn from it?',
			category: 'reflection'
		},
		{
			id: 'accomplishment',
			prompt: 'What was your biggest accomplishment today, no matter how small?',
			category: 'productivity'
		},
		{
			id: 'tomorrow',
			prompt: 'What\'s one thing you\'re looking forward to tomorrow?',
			category: 'goals'
		},
		{
			id: 'creative',
			prompt: 'If today was a story, what would the title be?',
			category: 'creativity'
		}
	];
}
