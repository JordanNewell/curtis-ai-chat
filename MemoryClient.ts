// MemoryClient - Direct file access to Claude Code memory system

import { App, Notice, TFile } from 'obsidian';
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
			// Append to buffer file (JSONL format)
			const line = JSON.stringify(fullMessage) + '\n';

			// Use Obsidian's vault API for file operations
			const bufferFile = this.app.vault.getAbstractFileByPath(this.workingMemoryBufferPath);

			if (bufferFile instanceof TFile) {
				const existing = await this.app.vault.read(bufferFile);
				await this.app.vault.modify(bufferFile, existing + line);
			} else {
				// File doesn't exist, create it
				await this.app.vault.create(this.workingMemoryBufferPath, line);
			}

			// Update state
			await this.updateWorkingMemoryState();

			return true;
		} catch (error) {
			console.error('[MemoryClient] Failed to capture:', error);
			return false;
		}
	}

	// Update working memory state file
	private async updateWorkingMemoryState(): Promise<void> {
		try {
			const stateFile = this.app.vault.getAbstractFileByPath(this.workingMemoryPath);

			const state: WorkingMemoryState = {
				buffer: [],
				max_turns: 3,
				updated_at: this.timestamp()
			};

			const content = JSON.stringify(state, null, 2);

			if (stateFile instanceof TFile) {
				await this.app.vault.modify(stateFile, content);
			} else {
				await this.app.vault.create(this.workingMemoryPath, content);
			}
		} catch (error) {
			console.error('[MemoryClient] Failed to update state:', error);
		}
	}
}
