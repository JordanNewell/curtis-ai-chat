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
}
