# Unified Memory Integration - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Connect Obsidian GLM plugin to Claude Code's memory system for bidirectional context sharing.

**Architecture:** Direct file access - Obsidian reads/writes to the same JSONL/JSON files that Claude Code uses. MemoryClient class handles all operations. Chat UI gets a "Remember" toggle.

**Tech Stack:** TypeScript, Obsidian API, file system operations, JSONL append-only storage

**Memory Paths:**
- Working Memory: `<vault>/memory/working_memory/`
- Episodic: `<vault>/memory/episodic/`
- Consolidation: `<vault>/memory/consolidation/`

---

## Task 1: Create Memory Types

**Files:**
- Create: `E:/dev/projects/obsidian-glm-plugin/memory-types.ts`

**Step 1: Create the types file**

```typescript
// Memory system types for Claude Code integration

export interface MemoryMessage {
	role: 'user' | 'assistant' | 'system';
	content: string;
	timestamp: string;
	metadata?: {
		session_id?: string;
		source?: string;
		provider?: string;
		model?: string;
	};
}

export interface WorkingMemoryState {
	buffer: MemoryMessage[];
	max_turns: number;
	updated_at: string;
}

export interface Episode {
	episode_id: string;
	session_id: string;
	started_at: string;
	ended_at: string;
	context: {
		source: string;
		session_id?: string;
		project?: string;
	};
	messages: MemoryMessage[];
	summary: string;
	key_topics: string[];
	metadata: Record<string, any>;
	duration_seconds: number;
}

export interface EpisodeIndex {
	created: string;
	episodes: Episode[];
	current_episode: string | null;
}

export interface Fact {
	fact_id: string;
	episode_id: string;
	content: string;
	type: 'consolidated_memory' | 'extracted_fact';
	entities: string[];
	topics: string[];
	importance: number;
	message_count: number;
	timestamp: string;
	confidence: number;
	consolidated_at: string;
}

export interface MemorySearchResult {
	facts: Fact[];
	episodes: Episode[];
	total: number;
}

export interface MemoryClientConfig {
	basePath: string;
	maxFactsToLoad: number;
	sessionId: string;
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd E:/dev/projects/obsidian-glm-plugin && npx tsc --noEmit memory-types.ts`
Expected: No errors

**Step 3: Commit**

```bash
cd E:/dev/projects/obsidian-glm-plugin && git add memory-types.ts && git commit -m "feat(memory): add memory types for Claude Code integration"
```

---

## Task 2: Create MemoryClient Core

**Files:**
- Create: `E:/dev/projects/obsidian-glm-plugin/MemoryClient.ts`

**Step 1: Create MemoryClient with constructor and config**

```typescript
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
```

**Step 2: Verify TypeScript compiles**

Run: `cd E:/dev/projects/obsidian-glm-plugin && npx tsc --noEmit MemoryClient.ts`
Expected: No errors

**Step 3: Commit**

```bash
cd E:/dev/projects/obsidian-glm-plugin && git add MemoryClient.ts && git commit -m "feat(memory): add MemoryClient core structure"
```

---

## Task 3: Add Working Memory Operations

**Files:**
- Modify: `E:/dev/projects/obsidian-glm-plugin/MemoryClient.ts`

**Step 1: Add working memory file path and capture method**

Add these methods to the MemoryClient class:

```typescript
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
```

**Step 2: Verify TypeScript compiles**

Run: `cd E:/dev/projects/obsidian-glm-plugin && npx tsc --noEmit MemoryClient.ts`
Expected: No errors

**Step 3: Commit**

```bash
cd E:/dev/projects/obsidian-glm-plugin && git add MemoryClient.ts && git commit -m "feat(memory): add working memory capture operations"
```

---

## Task 4: Add Fact Search Operations

**Files:**
- Modify: `E:/dev/projects/obsidian-glm-plugin/MemoryClient.ts`

**Step 1: Add fact search methods**

Add these methods to the MemoryClient class:

```typescript
	// Path to consolidated facts
	private get factsPath(): string {
		return `${this.config.basePath}/consolidation/facts.jsonl`;
	}

	// Search consolidated facts by query
	async searchFacts(query: string, limit: number = 20): Promise<Fact[]> {
		try {
			const factsFile = this.app.vault.getAbstractFileByPath(this.factsPath);

			if (!(factsFile instanceof TFile)) {
				return [];
			}

			const content = await this.app.vault.read(factsFile);
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
			const factsFile = this.app.vault.getAbstractFileByPath(this.factsPath);

			if (!(factsFile instanceof TFile)) {
				return [];
			}

			const content = await this.app.vault.read(factsFile);
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
```

**Step 2: Verify TypeScript compiles**

Run: `cd E:/dev/projects/obsidian-glm-plugin && npx tsc --noEmit MemoryClient.ts`
Expected: No errors

**Step 3: Commit**

```bash
cd E:/dev/projects/obsidian-glm-plugin && git add MemoryClient.ts && git commit -m "feat(memory): add fact search operations"
```

---

## Task 5: Add Context Generation

**Files:**
- Modify: `E:/dev/projects/obsidian-glm-plugin/MemoryClient.ts`

**Step 1: Add context generation method**

Add this method to the MemoryClient class:

```typescript
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
			const factsFile = this.app.vault.getAbstractFileByPath(this.factsPath);
			if (factsFile instanceof TFile) {
				const content = await this.app.vault.read(factsFile);
				factCount = content.trim().split('\n').filter(l => l).length;
			}
		} catch (e) {}

		try {
			const episodePath = `${this.config.basePath}/episodic/episode_index.json`;
			const episodeFile = this.app.vault.getAbstractFileByPath(episodePath);
			if (episodeFile instanceof TFile) {
				const content = await this.app.vault.read(episodeFile);
				const index = JSON.parse(content);
				episodeCount = index.episodes?.length || 0;
			}
		} catch (e) {}

		return { factCount, episodeCount };
	}
```

**Step 2: Verify TypeScript compiles**

Run: `cd E:/dev/projects/obsidian-glm-plugin && npx tsc --noEmit MemoryClient.ts`
Expected: No errors

**Step 3: Commit**

```bash
cd E:/dev/projects/obsidian-glm-plugin && git add MemoryClient.ts && git commit -m "feat(memory): add context generation and stats"
```

---

## Task 6: Integrate MemoryClient into Plugin

**Files:**
- Modify: `E:/dev/projects/obsidian-glm-plugin/main.ts`

**Step 1: Import MemoryClient at top of main.ts**

Add after the existing imports (around line 1-30):

```typescript
import { MemoryClient } from './MemoryClient';
```

**Step 2: Add memoryClient property to plugin class**

Find the `MultiProviderAIPlugin` class (around line 180-220) and add:

```typescript
	memoryClient: MemoryClient;
```

**Step 3: Initialize MemoryClient in onload()**

Find the `onload()` method and add after other initializations:

```typescript
		// Initialize memory client
		this.memoryClient = new MemoryClient(this.app, {
			sessionId: `obsidian_${Date.now()}`
		});
		console.log('[GLM Plugin] Memory client initialized');
```

**Step 4: Verify build succeeds**

Run: `cd E:/dev/projects/obsidian-glm-plugin && npm run build`
Expected: Build completes without errors

**Step 5: Commit**

```bash
cd E:/dev/projects/obsidian-glm-plugin && git add main.ts && git commit -m "feat(memory): integrate MemoryClient into plugin"
```

---

## Task 7: Add Memory Toggle to Chat UI

**Files:**
- Modify: `E:/dev/projects/obsidian-glm-plugin/main.ts`

**Step 1: Add toggle UI in AIChatModal.onOpen()**

Find the `AIChatModal` class `onOpen()` method (around line 817). Add after the template button (around line 874):

```typescript
		// Memory toggle
		const memoryContainer = contentEl.createDiv({ cls: 'ai-memory-toggle' });
		const memoryToggle = memoryContainer.createEl('input', {
			type: 'checkbox',
			attr: { id: 'memory-toggle' }
		});
		memoryToggle.checked = this.plugin.memoryClient.getRemember();
		memoryToggle.addEventListener('change', () => {
			this.plugin.memoryClient.setRemember(memoryToggle.checked);
		});

		const memoryLabel = memoryContainer.createEl('label', {
			attr: { for: 'memory-toggle' },
			text: '🧠 Remember conversation'
		});

		// Memory stats indicator
		this.updateMemoryStats(memoryContainer);
```

**Step 2: Add updateMemoryStats method to AIChatModal**

Add this method inside the `AIChatModal` class (after `scrollToBottom()` around line 1020):

```typescript
	async updateMemoryStats(container: HTMLElement) {
		const stats = await this.plugin.memoryClient.getStats();
		const statsEl = container.createSpan({
			cls: 'ai-memory-stats',
			text: ` (${stats.factCount} facts)`
		});
	}
```

**Step 3: Add basic styles for toggle**

Add to the `addStyles()` method or create styles in the plugin's CSS:

```typescript
	// In addStyles() method or styles.css:
	.ai-memory-toggle {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 8px 0;
		padding: 8px;
		background: var(--background-secondary);
		border-radius: 6px;
	}

	.ai-memory-toggle label {
		cursor: pointer;
		font-size: 14px;
	}

	.ai-memory-stats {
		opacity: 0.6;
		font-size: 12px;
		margin-left: auto;
	}
```

**Step 4: Verify build succeeds**

Run: `cd E:/dev/projects/obsidian-glm-plugin && npm run build`
Expected: Build completes without errors

**Step 5: Commit**

```bash
cd E:/dev/projects/obsidian-glm-plugin && git add main.ts && git commit -m "feat(memory): add remember toggle to chat UI"
```

---

## Task 8: Hook Memory into Message Flow

**Files:**
- Modify: `E:/dev/projects/obsidian-glm-plugin/main.ts`

**Step 1: Capture user messages**

Find the `sendMessage()` method in `AIChatModal` (around line 961). After the user message is added (around line 972), add:

```typescript
		// Capture user message to memory
		this.plugin.memoryClient.capture({
			role: 'user',
			content: content,
			metadata: {
				provider: this.plugin.settings.provider,
				model: this.modelSelect.value
			}
		});
```

**Step 2: Capture assistant responses**

In the same `sendMessage()` method, after the assistant response is added (around line 990-991), add:

```typescript
			// Capture assistant response to memory
			this.plugin.memoryClient.capture({
				role: 'assistant',
				content: responseContent,
				metadata: {
					provider: this.plugin.settings.provider,
					model: this.modelSelect.value
				}
			});
```

**Step 3: Inject context at conversation start**

Find where the messages array is built (around line 979-982). Modify to include memory context:

```typescript
		// Get memory context
		const memoryContext = await this.plugin.memoryClient.getContext(content);

		const messages: any[] = [
			{ role: 'system', content: this.plugin.settings.systemPrompt },
			...(memoryContext ? [{ role: 'system', content: memoryContext }] : []),
			...this.messages,
		];
```

**Step 4: Verify build succeeds**

Run: `cd E:/dev/projects/obsidian-glm-plugin && npm run build`
Expected: Build completes without errors

**Step 5: Commit**

```bash
cd E:/dev/projects/obsidian-glm-plugin && git add main.ts && git commit -m "feat(memory): hook memory capture into message flow"
```

---

## Task 9: Manual Testing

**Files:**
- None (testing only)

**Step 1: Build the plugin**

Run: `cd E:/dev/projects/obsidian-glm-plugin && npm run build`
Expected: `main.js` generated successfully

**Step 2: Reload Obsidian**

- Open Obsidian
- Reload plugin (CMD+P → "Reload app without saving" or restart Obsidian)

**Step 3: Test memory capture**

1. Open AI Chat in Obsidian
2. Verify "🧠 Remember conversation" toggle is visible and checked
3. Send a message: "My favorite color is blue"
4. Check that the file was created:
   - Run: `cat "<vault>/memory/working_memory/buffer.jsonl"`
   - Expected: JSON lines with your message

**Step 4: Test memory context**

1. Start a new chat in Obsidian
2. Ask: "What's my favorite color?"
3. Verify the memory context was injected (check console logs or the AI's response)

**Step 5: Test toggle**

1. Uncheck "Remember conversation"
2. Send a message
3. Verify it was NOT captured to memory

---

## Task 10: Final Commit and Documentation

**Files:**
- Modify: `E:/dev/projects/obsidian-glm-plugin/README.md` (if exists)

**Step 1: Update README with memory feature**

Add a section to README.md:

```markdown
## 🧠 Memory Integration

This plugin integrates with Claude Code's memory system for cross-tool context sharing.

### Features
- **Bidirectional sync**: Conversations in Obsidian are captured to memory
- **Context injection**: Relevant facts are loaded when starting new chats
- **Toggle control**: "Remember conversation" toggle in chat UI

### Memory Paths
- Working Memory: `<vault>/memory/working_memory/`
- Consolidated Facts: `<vault>/memory/consolidation/facts.jsonl`

### How It Works
1. When you send a message, it's captured to working memory
2. Claude Code's consolidation process extracts facts
3. Future chats automatically load relevant context
```

**Step 2: Final commit**

```bash
cd E:/dev/projects/obsidian-glm-plugin && git add . && git commit -m "feat(memory): complete unified memory integration"
```

**Step 3: Tag release (optional)**

```bash
cd E:/dev/projects/obsidian-glm-plugin && git tag -a v1.1.0 -m "Add unified memory integration"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Create types | `memory-types.ts` |
| 2 | Create MemoryClient core | `MemoryClient.ts` |
| 3 | Working memory ops | `MemoryClient.ts` |
| 4 | Fact search | `MemoryClient.ts` |
| 5 | Context generation | `MemoryClient.ts` |
| 6 | Plugin integration | `main.ts` |
| 7 | UI toggle | `main.ts` |
| 8 | Message hooks | `main.ts` |
| 9 | Manual testing | - |
| 10 | Documentation | `README.md` |
