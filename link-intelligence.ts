// Link Intelligence - AI-powered backlink suggestions and link analysis

import { VaultIndexer, NoteMetadata, PremiumSettings } from './vault-indexer';

// ============================================================================
// INTERFACES
// ============================================================================

export interface LinkSuggestion {
	sourcePath: string;
	targetPath: string;
	targetBasename: string;
	reason: string;
	confidence: number; // 0-1
	suggestedContext?: string; // Where to place the link
	sharedTopics?: string[];
}

export interface LinkStrength {
	path: string;
	basename: string;
	strength: number; // 0-1, based on recency, proximity, mentions
	lastLinked: number;
	linkCount: number;
	connectionType: 'strong' | 'moderate' | 'weak';
}

export interface LinkGraphAnalysis {
	clusters: Map<string, string[]>; // Topic clusters
	bridges: string[]; // Notes that connect topics
	isolated: string[]; // Disconnected notes
	knowledgeHubs: string[]; // Most connected notes
	weakConnections: Array<{ source: string; target: string; strength: number }>;
}

export interface TopicAnalysis {
	topic: string;
	notes: NoteMetadata[];
	relatedTopics: string[];
	completeness: number; // 0-1, how well-covered this topic is
}

// ============================================================================
// LINK INTELLIGENCE CLASS
// ============================================================================

export class LinkIntelligence {
	private suggestionCache: Map<string, LinkSuggestion[]> = new Map();
	private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

	constructor(
		private indexer: VaultIndexer,
		private settings: PremiumSettings
	) {}

	// ============================================================================
	// PUBLIC METHODS
	// ============================================================================

	/**
	 * Get backlink suggestions for the current note
	 */
	async getBacklinkSuggestions(currentPath: string): Promise<LinkSuggestion[]> {
		// Check cache
		const cacheKey = `backlinks:${currentPath}`;
		const cached = this.suggestionCache.get(cacheKey);
		if (cached && Date.now() - (cached as any).timestamp < this.CACHE_TTL) {
			return (cached as any).suggestions;
		}

		const currentNote = this.indexer.getNoteMetadata(currentPath);
		if (!currentNote) {
			return [];
		}

		const suggestions: LinkSuggestion[] = [];

		// Get all notes that could potentially link to this one
		const allNotes = this.indexer.getAllMetadata();
		const existingBacklinks = new Set(currentNote.backlinks);

		for (const note of allNotes) {
			// Skip self and notes that already link
			if (note.path === currentPath || existingBacklinks.has(note.path)) {
				continue;
			}

			// Calculate similarity
			const similarity = this.calculateContentSimilarity(currentNote, note);

			// Only include if similarity is above threshold
			if (similarity >= this.settings.minLinkStrength) {
				const sharedTopics = this.findSharedTopics(currentNote, note);

				suggestions.push({
					sourcePath: note.path,
					targetPath: currentPath,
					targetBasename: currentNote.basename,
					reason: this.generateSuggestionReason(currentNote, note, similarity, sharedTopics),
					confidence: similarity,
					sharedTopics
				});
			}
		}

		// Sort by confidence and limit
		const topSuggestions = suggestions
			.sort((a, b) => b.confidence - a.confidence)
			.slice(0, this.settings.maxSuggestions);

		// Cache results
		(this.suggestionCache as any).set(cacheKey, {
			suggestions: topSuggestions,
			timestamp: Date.now()
		});

		return topSuggestions;
	}

	/**
	 * Get link strength analysis for a note
	 */
	async getLinkStrength(path: string): Promise<LinkStrength[]> {
		const currentNote = this.indexer.getNoteMetadata(path);
		if (!currentNote) {
			return [];
		}

		const linkedNotes = this.indexer.getLinkedNotes(path);
		const backlinks = this.indexer.getBacklinks(path);

		// Combine linked notes and backlinks
		const allConnected = new Set([...linkedNotes, ...backlinks]);

		const strengths: LinkStrength[] = [];

		for (const note of allConnected) {
			const strength = this.calculateLinkStrength(path, note.path);
			let connectionType: 'strong' | 'moderate' | 'weak';

			if (strength >= 0.7) {
				connectionType = 'strong';
			} else if (strength >= 0.4) {
				connectionType = 'moderate';
			} else {
				connectionType = 'weak';
			}

			strengths.push({
				path: note.path,
				basename: note.basename,
				strength,
				lastLinked: Math.max(note.modifiedAt, currentNote.modifiedAt),
				linkCount: this.countMutualLinks(path, note.path),
				connectionType
			});
		}

		return strengths.sort((a, b) => b.strength - a.strength);
	}

	/**
	 * Analyze the link graph to find clusters, bridges, and isolated notes
	 */
	async analyzeLinkGraph(): Promise<LinkGraphAnalysis> {
		const allNotes = this.indexer.getAllMetadata();

		// Find knowledge hubs (most linked notes)
		const linkCounts = new Map<string, number>();
		for (const note of allNotes) {
			linkCounts.set(note.path, note.backlinks.length);
		}

		const knowledgeHubs = Array.from(linkCounts.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, 10)
			.map(([path]) => path);

		// Find topic clusters using tags
		const tagToNotes = new Map<string, string[]>();
		for (const note of allNotes) {
			for (const tag of note.tags) {
				if (!tagToNotes.has(tag)) {
					tagToNotes.set(tag, []);
				}
				tagToNotes.get(tag)!.push(note.path);
			}
		}

		const clusters: Map<string, string[]> = new Map();
		for (const [tag, notes] of tagToNotes.entries()) {
			if (notes.length >= 2) {
				clusters.set(tag, notes);
			}
		}

		// Find bridges (notes that connect multiple clusters)
		const bridges: string[] = [];
		for (const note of allNotes) {
			const connectedTopics = new Set<string>();

			// Add topics from linked notes
			const linkedNotes = this.indexer.getLinkedNotes(note.path);
			for (const linked of linkedNotes) {
				for (const tag of linked.tags) {
					connectedTopics.add(tag);
				}
			}

			// Add topics from backlinks
			const backlinks = this.indexer.getBacklinks(note.path);
			for (const backlink of backlinks) {
				for (const tag of backlink.tags) {
					connectedTopics.add(tag);
				}
			}

			// If note connects 3+ topics, it's a bridge
			if (connectedTopics.size >= 3) {
				bridges.push(note.path);
			}
		}

		// Find isolated notes (no links in or out)
		const isolated: string[] = [];
		for (const note of allNotes) {
			const linked = this.indexer.getLinkedNotes(note.path);
			const backlinked = this.indexer.getBacklinks(note.path);

			if (linked.length === 0 && backlinked.length === 0) {
				isolated.push(note.path);
			}
		}

		// Find weak connections
		const weakConnections: Array<{ source: string; target: string; strength: number }> = [];
		for (const note of allNotes) {
			const linkedNotes = this.indexer.getLinkedNotes(note.path);
			for (const linked of linkedNotes) {
				const strength = this.calculateLinkStrength(note.path, linked.path);
				if (strength < this.settings.minLinkStrength) {
					weakConnections.push({
						source: note.path,
						target: linked.path,
						strength
					});
				}
			}
		}

		return {
			clusters,
			bridges,
			isolated,
			knowledgeHubs,
			weakConnections
		};
	}

	/**
	 * Get contextual suggestions using AI
	 */
	async getContextualSuggestions(
		currentPath: string,
		currentContent: string
	): Promise<LinkSuggestion[]> {
		// For now, use the content-based suggestions
		// In the future, this could use AI to analyze the actual content
		return this.getBacklinkSuggestions(currentPath);
	}

	/**
	 * Find orphan notes that are related to a topic
	 */
	async findOrphanNotesWithContext(topic: string): Promise<NoteMetadata[]> {
		const orphans = this.indexer.getOrphanedNotes();

		// Filter orphans by topic relevance
		const relevantOrphans = orphans.filter(note => {
			const lowerTopic = topic.toLowerCase();
			return (
				note.basename.toLowerCase().includes(lowerTopic) ||
				note.tags.some(tag => tag.toLowerCase().includes(lowerTopic)) ||
				note.headings.some(heading => heading.text.toLowerCase().includes(lowerTopic))
			);
		});

		return relevantOrphans;
	}

	// ============================================================================
	// PRIVATE METHODS
	// ============================================================================

	/**
	 * Calculate content similarity between two notes
	 */
	private calculateContentSimilarity(note1: NoteMetadata, note2: NoteMetadata): number {
		let similarity = 0;
		let factors = 0;

		// Tag overlap (40% weight)
		const tagOverlap = this.calculateOverlap(note1.tags, note2.tags);
		similarity += tagOverlap * 0.4;
		factors++;

		// Heading overlap (30% weight)
		const headings1 = new Set(note1.headings.map(h => h.text.toLowerCase()));
		const headings2 = new Set(note2.headings.map(h => h.text.toLowerCase()));
		const headingOverlap = this.calculateOverlap(
			Array.from(headings1),
			Array.from(headings2)
		);
		similarity += headingOverlap * 0.3;
		factors++;

		// Name similarity (20% weight)
		const nameSimilarity = this.calculateStringSimilarity(note1.basename, note2.basename);
		similarity += nameSimilarity * 0.2;
		factors++;

		// Link proximity (10% weight) - notes that link to similar things
		const links1 = new Set(note1.links.map(l => l.link.toLowerCase()));
		const links2 = new Set(note2.links.map(l => l.link.toLowerCase()));
		const linkOverlap = this.calculateOverlap(
			Array.from(links1),
			Array.from(links2)
		);
		similarity += linkOverlap * 0.1;
		factors++;

		return similarity;
	}

	/**
	 * Calculate link strength between two notes
	 */
	private calculateLinkStrength(source: string, target: string): number {
		const sourceNote = this.indexer.getNoteMetadata(source);
		const targetNote = this.indexer.getNoteMetadata(target);

		if (!sourceNote || !targetNote) {
			return 0;
		}

		let strength = 0;

		// Recency factor (more recent = stronger)
		const daysSinceLink = (Date.now() - Math.max(sourceNote.modifiedAt, targetNote.modifiedAt)) / (1000 * 60 * 60 * 24);
		const recencyScore = Math.max(0, 1 - daysSinceLink / 365); // Decays over a year
		strength += recencyScore * 0.3;

		// Link count (more links = stronger)
		const mutualLinks = this.countMutualLinks(source, target);
		const linkScore = Math.min(1, mutualLinks / 5); // Caps at 5 mutual links
		strength += linkScore * 0.4;

		// Content similarity
		const similarity = this.calculateContentSimilarity(sourceNote, targetNote);
		strength += similarity * 0.3;

		return Math.min(1, strength);
	}

	/**
	 * Find shared topics between two notes
	 */
	private findSharedTopics(note1: NoteMetadata, note2: NoteMetadata): string[] {
		const topics1 = new Set(note1.tags);
		const topics2 = new Set(note2.tags);

		const shared: string[] = [];
		for (const topic of topics1) {
			if (topics2.has(topic)) {
				shared.push(topic);
			}
		}

		// Also check heading similarities
		const headings1 = new Set(note1.headings.map(h => h.text.toLowerCase()));
		const headings2 = new Set(note2.headings.map(h => h.text.toLowerCase()));

		for (const heading of headings1) {
			if (headings2.has(heading) && !note1.tags.includes(heading)) {
				shared.push(heading);
			}
		}

		return shared;
	}

	/**
	 * Generate a human-readable reason for a suggestion
	 */
	private generateSuggestionReason(
		target: NoteMetadata,
		source: NoteMetadata,
		similarity: number,
		sharedTopics: string[]
	): string {
		if (sharedTopics.length > 0) {
			return `Both notes discuss "${sharedTopics[0]}"${sharedTopics.length > 1 ? ` and ${sharedTopics.length - 1} other topics` : ''}`;
		}

		if (similarity > 0.7) {
			return 'Highly related content';
		} else if (similarity > 0.5) {
			return 'Related content';
		} else {
			return 'Potentially relevant context';
		}
	}

	/**
	 * Calculate overlap between two arrays
	 */
	private calculateOverlap(arr1: string[], arr2: string[]): number {
		const set1 = new Set(arr1);
		const set2 = new Set(arr2);

		let intersection = 0;
		for (const item of set1) {
			if (set2.has(item)) {
				intersection++;
			}
		}

		const union = set1.size + set2.size - intersection;
		return union === 0 ? 0 : intersection / union;
	}

	/**
	 * Calculate string similarity (Jaro-Winkler-like)
	 */
	private calculateStringSimilarity(str1: string, str2: string): number {
		const s1 = str1.toLowerCase();
		const s2 = str2.toLowerCase();

		if (s1 === s2) return 1;

		// Check if one contains the other
		if (s1.includes(s2) || s2.includes(s1)) {
			return 0.8;
		}

		// Word overlap
		const words1 = new Set(s1.split(/\s+/));
		const words2 = new Set(s2.split(/\s+/));

		return this.calculateOverlap(Array.from(words1), Array.from(words2));
	}

	/**
	 * Count mutual links between two notes
	 */
	private countMutualLinks(path1: string, path2: string): number {
		const note1 = this.indexer.getNoteMetadata(path1);
		const note2 = this.indexer.getNoteMetadata(path2);

		if (!note1 || !note2) {
			return 0;
		}

		// Check if note1 links to note2
		const links1 = new Set(note1.links.map(l => l.link.toLowerCase()));
		const links2 = new Set(note2.links.map(l => l.link.toLowerCase()));

		const name1 = note1.basename.toLowerCase();
		const name2 = note2.basename.toLowerCase();

		let count = 0;

		// Direct links
		if (links1.has(name2) || links1.has(note2.path)) count++;
		if (links2.has(name1) || links2.has(note1.path)) count++;

		// Tag overlap
		for (const tag of note1.tags) {
			if (note2.tags.includes(tag)) {
				count++;
				break;
			}
		}

		return count;
	}

	/**
	 * Clear the suggestion cache
	 */
	clearCache(): void {
		this.suggestionCache.clear();
	}
}
