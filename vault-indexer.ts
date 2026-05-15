// Vault Indexer - Core indexing system for premium AI features

import { App, TFile, CachedMetadata, HeadingCache, LinkCache } from 'obsidian';

// ============================================================================
// INTERFACES
// ============================================================================

export interface NoteMetadata {
	path: string;
	basename: string;
	tags: string[];
	headings: Heading[];
	links: Link[];
	backlinks: string[]; // Files that link to this note
	frontmatter: Record<string, any>;
	wordCount: number;
	createdAt: number;
	modifiedAt: number;
	lastIndexed: number;
}

export interface Heading {
	level: number;
	text: string;
	position: { start: { line: number } };
}

export interface Link {
	link: string;
	displayText?: string;
	position: { start: { line: number } };
	isExternal: boolean;
}

export interface VaultStats {
	totalNotes: number;
	totalWords: number;
	totalTags: number;
	totalLinks: number;
	orphanedNotes: number;
	largestNotes: NoteMetadata[];
	mostLinkedNotes: NoteMetadata[];
	tagCounts: Record<string, number>;
}

export interface IndexingProgress {
	current: number;
	total: number;
	file: string;
}

// ============================================================================
// PREMIUM SETTINGS INTERFACE
// ============================================================================

export interface PremiumSettings {
	// Feature toggles
	enablePremiumFeatures: boolean;
	enableVaultIntelligence: boolean;
	enableLinkSuggestions: boolean;
	enableDailyNotesAssistant: boolean;

	// Indexer settings
	autoReindexInterval: number; // minutes
	excludePatterns: string[]; // glob patterns for files to exclude
	maxCacheSize: number; // MB

	// Daily notes settings
	dailyNotesFolder: string;
	dailyNotesFormat: string; // moment.js format
	autoSummarizeDaily: boolean;
	autoExtractTasks: boolean;

	// Link intelligence settings
	minLinkStrength: number; // 0-1
	suggestBacklinks: boolean;
	maxSuggestions: number;
}

// ============================================================================
// VAULT INDEXER CLASS
// ============================================================================

export class VaultIndexer {
	private cache: Map<string, NoteMetadata> = new Map();
	private linkGraph: Map<string, Set<string>> = new Map(); // source -> targets
	private reverseLinkGraph: Map<string, Set<string>> = new Map(); // target -> sources
	private indexingInProgress: boolean = false;
	private lastFullIndex: number = 0;
	private progressCallback?: (progress: IndexingProgress) => void;

	constructor(
		private app: App,
		private settings: PremiumSettings
	) {
		this.loadFromCache();
	}

	// ============================================================================
	// PUBLIC METHODS
	// ============================================================================

	/**
	 * Index all markdown files in the vault
	 */
	async indexVault(force: boolean = false): Promise<void> {
		if (this.indexingInProgress) {
			return;
		}

		// Check if reindex is needed
		if (!force && !this.isStale()) {
			return;
		}

		this.indexingInProgress = true;
		const startTime = Date.now();

		try {
			// Get all markdown files
			const files = this.app.vault.getMarkdownFiles();

			// Filter out excluded patterns
			const filteredFiles = this.filterExcludedFiles(files);

			// Clear existing cache if forced
			if (force) {
				this.cache.clear();
				this.linkGraph.clear();
				this.reverseLinkGraph.clear();
			}

			// Index each file
			for (let i = 0; i < filteredFiles.length; i++) {
				const file = filteredFiles[i];

				// Report progress
				if (this.progressCallback) {
					this.progressCallback({
						current: i + 1,
						total: filteredFiles.length,
						file: file.path
					});
				}

				await this.indexFile(file);
			}

			// Build link graphs
			this.buildLinkGraph();

			// Save to cache
			this.saveToCache();

			this.lastFullIndex = Date.now();

			console.log(`[VaultIndexer] Indexed ${filteredFiles.length} files in ${Date.now() - startTime}ms`);
		} finally {
			this.indexingInProgress = false;
		}
	}

	/**
	 * Index a single file
	 */
	async indexFile(file: TFile): Promise<NoteMetadata | null> {
		// Check if should be excluded
		if (this.isExcluded(file)) {
			return null;
		}

		// Read file content
		const content = await this.app.vault.cachedRead(file);

		// Get cached metadata
		const cachedMetadata = this.app.metadataCache.getFileCache(file);

		if (!cachedMetadata) {
			return null;
		}

		// Extract metadata
		const metadata: NoteMetadata = {
			path: file.path,
			basename: file.basename,
			tags: this.extractTags(cachedMetadata, content),
			headings: this.extractHeadings(cachedMetadata),
			links: this.extractLinks(cachedMetadata),
			backlinks: [], // Will be populated by buildLinkGraph
			frontmatter: this.extractFrontmatter(cachedMetadata),
			wordCount: this.countWords(content),
			createdAt: file.stat.ctime,
			modifiedAt: file.stat.mtime,
			lastIndexed: Date.now()
		};

		// Update cache
		this.cache.set(file.path, metadata);

		return metadata;
	}

	/**
	 * Remove a file from the index
	 */
	async removeFile(path: string): Promise<void> {
		this.cache.delete(path);

		// Remove from link graphs
		this.linkGraph.delete(path);
		this.reverseLinkGraph.delete(path);

		// Remove links pointing to this file
		for (const [source, targets] of this.linkGraph.entries()) {
			targets.delete(path);
		}

		this.saveToCache();
	}

	/**
	 * Get metadata for a specific note
	 */
	getNoteMetadata(path: string): NoteMetadata | undefined {
		return this.cache.get(path);
	}

	/**
	 * Get all indexed metadata
	 */
	getAllMetadata(): NoteMetadata[] {
		return Array.from(this.cache.values());
	}

	/**
	 * Get orphaned notes (notes with no backlinks)
	 */
	getOrphanedNotes(): NoteMetadata[] {
		return this.getAllMetadata().filter(note => {
			const backlinks = this.reverseLinkGraph.get(note.path);
			return !backlinks || backlinks.size === 0;
		});
	}

	/**
	 * Get notes that link to the specified note
	 */
	getBacklinks(path: string): NoteMetadata[] {
		const sources = this.reverseLinkGraph.get(path);
		if (!sources) {
			return [];
		}

		return Array.from(sources)
			.map(sourcePath => this.cache.get(sourcePath))
			.filter((note): note is NoteMetadata => note !== undefined);
	}

	/**
	 * Get notes linked from the specified note
	 */
	getLinkedNotes(path: string): NoteMetadata[] {
		const targets = this.linkGraph.get(path);
		if (!targets) {
			return [];
		}

		return Array.from(targets)
			.map(targetPath => this.cache.get(targetPath))
			.filter((note): note is NoteMetadata => note !== undefined);
	}

	/**
	 * Get notes by tag
	 */
	getNotesByTag(tag: string): NoteMetadata[] {
		return this.getAllMetadata().filter(note =>
			note.tags.includes(tag)
		);
	}

	/**
	 * Search notes by query
	 */
	searchNotes(query: string): NoteMetadata[] {
		const lowerQuery = query.toLowerCase();

		return this.getAllMetadata().filter(note =>
			note.basename.toLowerCase().includes(lowerQuery) ||
			note.tags.some(tag => tag.toLowerCase().includes(lowerQuery)) ||
			note.headings.some(heading => heading.text.toLowerCase().includes(lowerQuery))
		);
	}

	/**
	 * Get vault statistics
	 */
	getVaultStats(): VaultStats {
		const allNotes = this.getAllMetadata();

		// Count tags
		const tagCounts: Record<string, number> = {};
		allNotes.forEach(note => {
			note.tags.forEach(tag => {
				tagCounts[tag] = (tagCounts[tag] || 0) + 1;
			});
		});

		// Count total links
		let totalLinks = 0;
		this.linkGraph.forEach(targets => {
			totalLinks += targets.size;
		});

		// Find largest notes
		const largestNotes = [...allNotes]
			.sort((a, b) => b.wordCount - a.wordCount)
			.slice(0, 10);

		// Find most linked notes
		const mostLinkedNotes = [...allNotes]
			.sort((a, b) => {
				const aLinks = this.reverseLinkGraph.get(a.path)?.size || 0;
				const bLinks = this.reverseLinkGraph.get(b.path)?.size || 0;
				return bLinks - aLinks;
			})
			.slice(0, 10);

		return {
			totalNotes: allNotes.length,
			totalWords: allNotes.reduce((sum, note) => sum + note.wordCount, 0),
			totalTags: Object.keys(tagCounts).length,
			totalLinks,
			orphanedNotes: this.getOrphanedNotes().length,
			largestNotes,
			mostLinkedNotes,
			tagCounts
		};
	}

	/**
	 * Check if the index is stale and needs refreshing
	 */
	isStale(): boolean {
		const elapsed = Date.now() - this.lastFullIndex;
		const staleTime = this.settings.autoReindexInterval * 60 * 1000; // Convert minutes to ms
		return elapsed > staleTime;
	}

	/**
	 * Set progress callback for indexing
	 */
	setProgressCallback(callback: (progress: IndexingProgress) => void): void {
		this.progressCallback = callback;
	}

	// ============================================================================
	// PRIVATE METHODS
	// ============================================================================

	/**
	 * Extract tags from cached metadata and content
	 */
	private extractTags(cache: CachedMetadata, content: string): string[] {
		const tags = new Set<string>();

		// Get tags from frontmatter
		if (cache.frontmatter && cache.frontmatter.tags) {
			const frontmatterTags = cache.frontmatter.tags;
			if (Array.isArray(frontmatterTags)) {
				frontmatterTags.forEach(tag => tags.add(String(tag)));
			} else if (typeof frontmatterTags === 'string') {
				tags.add(frontmatterTags);
			}
		}

		// Get inline tags from content
		// Matches #tag but not in code blocks or URLs
		const tagRegex = /(?<![\w#])#([\w-]+)/g;
		let match;
		while ((match = tagRegex.exec(content)) !== null) {
			tags.add(match[1]);
		}

		return Array.from(tags);
	}

	/**
	 * Extract headings from cached metadata
	 */
	private extractHeadings(cache: CachedMetadata): Heading[] {
		if (!cache.headings) {
			return [];
		}

		return cache.headings.map(heading => ({
			level: heading.level,
			text: heading.heading,
			position: { start: { line: heading.position.start.line } }
		}));
	}

	/**
	 * Extract links from cached metadata
	 */
	private extractLinks(cache: CachedMetadata): Link[] {
		if (!cache.links) {
			return [];
		}

		return cache.links.map(link => ({
			link: link.link,
			displayText: link.displayText,
			position: { start: { line: link.position.start.line } },
			isExternal: link.link.startsWith('http://') || link.link.startsWith('https://')
		}));
	}

	/**
	 * Extract frontmatter from cached metadata
	 */
	private extractFrontmatter(cache: CachedMetadata): Record<string, any> {
		return cache.frontmatter || {};
	}

	/**
	 * Count words in content
	 */
	private countWords(content: string): number {
		// Remove code blocks
		const withoutCodeBlocks = content.replace(/```[\s\S]*?```/g, '');

		// Count words (split by whitespace)
		const words = withoutCodeBlocks.trim().split(/\s+/).filter(word => word.length > 0);

		return words.length;
	}

	/**
	 * Build link graphs for fast lookups
	 */
	private buildLinkGraph(): void {
		// Clear existing graphs
		this.linkGraph.clear();
		this.reverseLinkGraph.clear();

		// Build forward and reverse link graphs
		for (const [sourcePath, metadata] of this.cache.entries()) {
			// Initialize source in forward graph
			if (!this.linkGraph.has(sourcePath)) {
				this.linkGraph.set(sourcePath, new Set());
			}

			// Process each link
			for (const link of metadata.links) {
				if (link.isExternal) {
					continue; // Skip external links
				}

				// Resolve link target
				const targetPath = this.app.metadataCache.getFirstLinkpathDest(link.link, sourcePath)?.path;

				if (!targetPath) {
					continue; // Skip broken links
				}

				// Add to forward graph
				this.linkGraph.get(sourcePath)?.add(targetPath);

				// Add to reverse graph
				if (!this.reverseLinkGraph.has(targetPath)) {
					this.reverseLinkGraph.set(targetPath, new Set());
				}
				this.reverseLinkGraph.get(targetPath)?.add(sourcePath);
			}
		}

		// Update backlinks in metadata
		for (const [targetPath, sources] of this.reverseLinkGraph.entries()) {
			const metadata = this.cache.get(targetPath);
			if (metadata) {
				metadata.backlinks = Array.from(sources);
			}
		}
	}

	/**
	 * Filter out excluded files
	 */
	private filterExcludedFiles(files: TFile[]): TFile[] {
		return files.filter(file => !this.isExcluded(file));
	}

	/**
	 * Check if a file should be excluded from indexing
	 */
	private isExcluded(file: TFile): boolean {
		if (file.extension !== 'md') {
			return true;
		}

		// Check against exclude patterns
		for (const pattern of this.settings.excludePatterns) {
			// Simple glob pattern matching
			const regex = new RegExp(
				'^' +
				pattern
					.replace(/\*/g, '.*')
					.replace(/\?/g, '.') +
				'$'
			);

			if (regex.test(file.path) || regex.test(file.name)) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Save index to cache
	 */
	private saveToCache(): void {
		try {
			const data = {
				version: 1,
				lastFullIndex: this.lastFullIndex,
				cache: Array.from(this.cache.entries()),
				linkGraph: Array.from(this.linkGraph.entries()).map(([k, v]) => [k, Array.from(v)]),
				reverseLinkGraph: Array.from(this.reverseLinkGraph.entries()).map(([k, v]) => [k, Array.from(v)])
			};

			localStorage.setItem('ai-vault-index', JSON.stringify(data));
		} catch (e) {
			console.error('[VaultIndexer] Failed to save cache:', e);
		}
	}

	/**
	 * Load index from cache
	 */
	private loadFromCache(): void {
		try {
			const stored = localStorage.getItem('ai-vault-index');
			if (stored) {
				const data = JSON.parse(stored);

				if (data.version === 1) {
					this.lastFullIndex = data.lastFullIndex || 0;
					this.cache = new Map(data.cache);
					this.linkGraph = new Map(data.linkGraph.map(([k, v]: [string, string[]]) => [k, new Set(v)]));
					this.reverseLinkGraph = new Map(data.reverseLinkGraph.map(([k, v]: [string, string[]]) => [k, new Set(v)]));

					console.log(`[VaultIndexer] Loaded ${this.cache.size} cached entries`);
				}
			}
		} catch (e) {
			console.error('[VaultIndexer] Failed to load cache:', e);
		}
	}
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Create default premium settings
 */
export function createDefaultPremiumSettings(): PremiumSettings {
	return {
		enablePremiumFeatures: false,
		enableVaultIntelligence: true,
		enableLinkSuggestions: true,
		enableDailyNotesAssistant: true,
		autoReindexInterval: 60, // 1 hour
		excludePatterns: ['*.excalidraw.md', '*.canvas'],
		maxCacheSize: 50, // 50MB
		dailyNotesFolder: 'Daily Notes',
		dailyNotesFormat: 'YYYY-MM-DD',
		autoSummarizeDaily: true,
		autoExtractTasks: true,
		minLinkStrength: 0.3,
		suggestBacklinks: true,
		maxSuggestions: 5
	};
}
