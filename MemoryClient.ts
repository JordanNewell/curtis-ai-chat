// MemoryClient - Direct file access to Claude Code memory system

import { App, Notice } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import {
	MemoryMessage,
	WorkingMemoryState,
	Episode,
	EpisodeIndex,
	Fact,
	MemorySearchResult,
	MemoryClientConfig
} from './memory-types';

const DEFAULT_CONFIG: MemoryClientConfig = {
	basePath: '<vault>/memory',
	maxFactsToLoad: 50,
	sessionId: `obsidian_${Date.now()}`
};

export class MemoryClient {
	private config: MemoryClientConfig;
	private app: App;
	private rememberEnabled: boolean = true;

	constructor(app: App, config?: Partial<MemoryClientConfig>) {
		this.app = app;
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.ensureDirectories();
	}

	// Ensure memory directories exist
	private ensureDirectories(): void {
		const dirs = [
			this.config.basePath,
			`${this.config.basePath}/working_memory`,
			`${this.config.basePath}/episodic`,
			`${this.config.basePath}/consolidation`
		];
		for (const dir of dirs) {
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}
		}
	}

	// Toggle "remember" state
	setRemember(enabled: boolean): void {
		this.rememberEnabled = enabled;
	}

	getRemember(): boolean {
		return this.rememberEnabled;
	}

	// Generate unique ID
	private generateId(): string {
		return Math.random().toString(16).slice(2, 10);
	}

	// Get current ISO timestamp
	private timestamp(): string {
		return new Date().toISOString();
	}

	// Working memory file path
	private get workingMemoryPath(): string {
		return `${this.config.basePath}/working_memory/working_memory_state.json`;
	}

	private get workingMemoryBufferPath(): string {
		return `${this.config.basePath}/working_memory/buffer.jsonl`;
	}

	// Capture a message to working memory
	async capture(message: Omit<MemoryMessage, 'timestamp'>): Promise<boolean> {
		if (!this.rememberEnabled) {
			return false;
		}

		const fullMessage: MemoryMessage = {
			...message,
			timestamp: this.timestamp(),
			metadata: {
				...message.metadata,
				session_id: this.config.sessionId,
				source: 'obsidian_plugin'
			}
		};

		try {
			// Append to buffer file (JSONL format) using Node.js fs
			const line = JSON.stringify(fullMessage) + '\n';

			if (fs.existsSync(this.workingMemoryBufferPath)) {
				fs.appendFileSync(this.workingMemoryBufferPath, line, 'utf-8');
			} else {
				fs.writeFileSync(this.workingMemoryBufferPath, line, 'utf-8');
			}

			// Update state
			this.updateWorkingMemoryState();

			return true;
		} catch (error) {
			console.error('[MemoryClient] Failed to capture:', error);
			return false;
		}
	}

	// Update working memory state file
	private updateWorkingMemoryState(): void {
		try {
			const state: WorkingMemoryState = {
				buffer: [],
				max_turns: 3,
				updated_at: this.timestamp()
			};

			const content = JSON.stringify(state, null, 2);
			fs.writeFileSync(this.workingMemoryPath, content, 'utf-8');
		} catch (error) {
			console.error('[MemoryClient] Failed to update state:', error);
		}
	}

	// Path to consolidated facts
	private get factsPath(): string {
		return `${this.config.basePath}/consolidation/facts.jsonl`;
	}

	// Search consolidated facts by query
	async searchFacts(query: string, limit: number = 20): Promise<Fact[]> {
		try {
			if (!fs.existsSync(this.factsPath)) {
				return [];
			}

			const content = fs.readFileSync(this.factsPath, 'utf-8');
			const lines = content.trim().split('\n');

			const queryLower = query.toLowerCase();
			const scoredFacts: Array<{ fact: Fact; score: number }> = [];

			for (const line of lines) {
				if (!line.trim()) continue;

				try {
					const fact: Fact = JSON.parse(line);
					let score = 0;

					// Content match
					if (fact.content.toLowerCase().includes(queryLower)) {
						score += 1.0;
					}

					// Topic match
					for (const topic of fact.topics || []) {
						if (topic.toLowerCase().includes(queryLower)) {
							score += 0.5;
						}
					}

					// Entity match
					for (const entity of fact.entities || []) {
						if (entity.toLowerCase().includes(queryLower)) {
							score += 0.3;
						}
					}

					// Importance boost
					score *= (1 + (fact.importance || 0));

					if (score > 0) {
						scoredFacts.push({ fact, score });
					}
				} catch (e) {
					// Skip malformed lines
				}
			}

			// Sort by score, return top results
			scoredFacts.sort((a, b) => b.score - a.score);
			return scoredFacts.slice(0, limit).map(s => s.fact);

		} catch (error) {
			console.error('[MemoryClient] Failed to search facts:', error);
			return [];
		}
	}

	// Get recent facts for context injection
	async getRecentFacts(limit: number = 10): Promise<Fact[]> {
		try {
			if (!fs.existsSync(this.factsPath)) {
				return [];
			}

			const content = fs.readFileSync(this.factsPath, 'utf-8');
			const lines = content.trim().split('\n');

			const facts: Fact[] = [];
			for (const line of lines.reverse()) {
				if (!line.trim()) continue;
				try {
					facts.push(JSON.parse(line));
					if (facts.length >= limit) break;
				} catch (e) {
					// Skip malformed
				}
			}

			return facts;
		} catch (error) {
			console.error('[MemoryClient] Failed to get recent facts:', error);
			return [];
		}
	}

	// Generate context string for AI prompt
	async getContext(topic?: string): Promise<string> {
		const facts = topic
			? await this.searchFacts(topic, this.config.maxFactsToLoad)
			: await this.getRecentFacts(this.config.maxFactsToLoad);

		if (facts.length === 0) {
			return '';
		}

		const contextLines = facts.map(fact => {
			const importance = fact.importance > 0.7 ? '⭐ ' : '';
			return `${importance}${fact.content}`;
		});

		return `## Relevant Context from Memory\n\n${contextLines.join('\n')}\n\n---\n\n`;
	}

	// Get memory stats for UI display
	async getStats(): Promise<{ factCount: number; episodeCount: number }> {
		let factCount = 0;
		let episodeCount = 0;

		try {
			if (fs.existsSync(this.factsPath)) {
				const content = fs.readFileSync(this.factsPath, 'utf-8');
				factCount = content.trim().split('\n').filter(l => l).length;
			}
		} catch (e) {}

		try {
			const episodePath = `${this.config.basePath}/episodic/episode_index.json`;
			if (fs.existsSync(episodePath)) {
				const content = fs.readFileSync(episodePath, 'utf-8');
				const index = JSON.parse(content);
				episodeCount = index.episodes?.length || 0;
			}
		} catch (e) {}

		return { factCount, episodeCount };
	}
}
