// Vault Intelligence - Comprehensive vault analysis and insights

import { Notice } from 'obsidian';
import { VaultIndexer, NoteMetadata, PremiumSettings } from './vault-indexer';
import { LinkIntelligence, LinkGraphAnalysis } from './link-intelligence';
import { DailyNotesAssistant, DailyNoteAnalysis } from './daily-notes-assistant';
import MultiProviderAIPlugin from './main';

// ============================================================================
// INTERFACES
// ============================================================================

export interface VaultInsights {
	overview: VaultOverview;
	health: VaultHealth;
	topics: TopicAnalysis;
	activity: ActivityData;
	recommendations: VaultRecommendation[];
	lastAnalyzed: number;
}

export interface VaultOverview {
	totalNotes: number;
	totalWords: number;
	totalLinks: number;
	totalTags: number;
	growthRate: number; // notes per week
	avgWordsPerNote: number;
	avgLinksPerNote: number;
	orphanedNotes: number;
	largestNotes: NoteMetadata[];
	mostLinkedNotes: NoteMetadata[];
}

export interface VaultHealth {
	orphanedNotes: NoteMetadata[];
	weakConnections: WeakConnection[];
	outdatedNotes: NoteMetadata[];
	brokenLinks: Array<{ source: string; target: string }>;
	healthScore: number; // 0-100
}

export interface WeakConnection {
	source: string;
	target: string;
	basename: string;
	path: string;
	strength: number;
	reason: string;
}

export interface TopicAnalysis {
	clusters: Map<string, NoteMetadata[]>; // topic -> notes
	gaps: TopicGap[];
	trending: TrendingTopic[];
	underexplored: string[];
	completenessScore: number; // 0-100
}

export interface TrendingTopic {
	topic: string;
	growth: number;
}

export interface TopicGap {
	topic: string;
	importance: 'high' | 'medium' | 'low';
	reason: string;
	suggestedNoteCount: number;
	suggestedNotes: string;
}

export interface ActivityData {
	mostActive: NoteMetadata[];
	recentlyCreated: NoteMetadata[];
	recentlyModified: NoteMetadata[];
	streakDays: number;
	totalActivityThisWeek: number;
	streak: number;
	mostActiveNotes: NoteMetadata[];
	recentActivity: ActivityEvent[];
}

export interface ActivityEvent {
	action: string;
	path: string;
	timestamp: number;
}

export interface VaultRecommendation {
	type: 'orphan' | 'link' | 'update' | 'create' | 'consolidate' | 'cleanup' | 'tag';
	priority: 'high' | 'medium' | 'low';
	title: string;
	description: string;
	actions: RecommendationAction[];
	impact: string;
	actionable: boolean;
	targetPath?: string;
}

export interface RecommendationAction {
	label: string;
	action: () => void | Promise<void>;
	icon?: string;
}

// ============================================================================
// VAULT INTELLIGENCE CLASS
// ============================================================================

export class VaultIntelligence {
	private insightsCache: VaultInsights | null = null;
	private readonly CACHE_TTL = 15 * 60 * 1000; // 15 minutes

	constructor(
		private indexer: VaultIndexer,
		private linkIntel: LinkIntelligence,
		private dailyNotes: DailyNotesAssistant | undefined,
		private plugin: MultiProviderAIPlugin
	) {}

	// ============================================================================
	// PUBLIC METHODS
	// ============================================================================

	/**
	 * Generate comprehensive vault insights
	 */
	async generateInsights(): Promise<VaultInsights> {
		// Check cache
		if (this.insightsCache && Date.now() - this.insightsCache.lastAnalyzed < this.CACHE_TTL) {
			return this.insightsCache;
		}

		const stats = this.indexer.getVaultStats();
		const allNotes = this.indexer.getAllMetadata();

		// Generate all insights
		const overview = this.analyzeOverview(stats, allNotes);
		const health = await this.analyzeHealth(allNotes);
		const topics = await this.analyzeTopics(allNotes);
		const activity = this.analyzeActivity(allNotes);
		const recommendations = await this.generateRecommendations(overview, health, topics, activity);

		const insights: VaultInsights = {
			overview,
			health,
			topics,
			activity,
			recommendations,
			lastAnalyzed: Date.now()
		};

		this.insightsCache = insights;
		return insights;
	}

	/**
	 * Find knowledge gaps using AI
	 */
	async findKnowledgeGaps(): Promise<TopicGap[]> {
		const stats = this.indexer.getVaultStats();
		const allNotes = this.indexer.getAllMetadata();

		// Get existing topics
		const existingTopics = Object.keys(stats.tagCounts);

		// Use AI to identify potential gaps
		const gaps: TopicGap[] = [];

		// Find topics with few notes (underexplored)
		for (const [topic, count] of Object.entries(stats.tagCounts)) {
			if (count < 3) {
				gaps.push({
					topic,
					importance: count === 0 ? 'high' : 'medium',
					reason: `Only ${count} note${count === 1 ? '' : 's'} about this topic`,
					suggestedNoteCount: 3 - count,
					suggestedNotes: `${3 - count} note${(3 - count) === 1 ? '' : 's'}`
				});
			}
		}

		// Find potential topics from headings that aren't tags
		const headingTopics = this.extractTopicsFromHeadings(allNotes);
		for (const topic of headingTopics) {
			if (!existingTopics.includes(topic) && !gaps.find(g => g.topic === topic)) {
				gaps.push({
					topic,
					importance: 'medium',
					reason: 'Topic appears in headings but no dedicated notes',
					suggestedNoteCount: 1,
					suggestedNotes: '1 note'
				});
			}
		}

		// Sort by importance
		const importanceOrder = { high: 0, medium: 1, low: 2 };
		gaps.sort((a, b) => importanceOrder[a.importance] - importanceOrder[b.importance]);

		return gaps.slice(0, 10);
	}

	/**
	 * Generate actionable recommendations
	 */
	async generateRecommendations(
		overview?: VaultOverview,
		health?: VaultHealth,
		topics?: TopicAnalysis,
		activity?: ActivityData
	): Promise<VaultRecommendation[]> {
		const recommendations: VaultRecommendation[] = [];

		// Health-based recommendations
		if (health && health.orphanedNotes.length > 0) {
			const orphanCount = health.orphanedNotes.length;
			const firstOrphan = health.orphanedNotes[0];
			recommendations.push({
				type: 'link',
				priority: orphanCount > 10 ? 'high' : 'medium',
				title: `${orphanCount} orphaned note${orphanCount === 1 ? '' : 's'} found`,
				description: `These notes have no backlinks and might be forgotten. Consider linking them to related content.`,
				actions: [
					{
						label: 'View First Orphan',
						icon: '🔍',
						action: () => {
							if (firstOrphan) {
								this.plugin.app.workspace.openLinkText(firstOrphan.path, '');
							}
						}
					}
				],
				impact: 'Improves discoverability and connects isolated knowledge',
				actionable: true,
				targetPath: firstOrphan?.path
			});
		}

		if (health && health.weakConnections.length > 0) {
			const weakCount = Math.min(health.weakConnections.length, 5);
			const firstWeak = health.weakConnections[0];
			recommendations.push({
				type: 'link',
				priority: 'medium',
				title: `${weakCount} weak connection${weakCount === 1 ? '' : 's'} detected`,
				description: 'Some notes are linked but may not be strongly related. Review these connections.',
				actions: [
					{
						label: 'View Note',
						icon: '🔗',
						action: () => {
							if (firstWeak) {
								this.plugin.app.workspace.openLinkText(firstWeak.path, '');
							}
						}
					}
				],
				impact: 'Strengthens knowledge graph integrity',
				actionable: true,
				targetPath: firstWeak?.path
			});
		}

		if (health && health.outdatedNotes.length > 0) {
			const outdatedCount = health.outdatedNotes.length;
			const firstOutdated = health.outdatedNotes[0];
			recommendations.push({
				type: 'update',
				priority: 'low',
				title: `${outdatedCount} note${outdatedCount === 1 ? '' : 's'} not updated in 30+ days`,
				description: 'Consider reviewing and updating these notes with new insights.',
				actions: [
					{
						label: 'View Note',
						icon: '📅',
						action: () => {
							if (firstOutdated) {
								this.plugin.app.workspace.openLinkText(firstOutdated.path, '');
							}
						}
					}
				],
				impact: 'Keeps knowledge fresh and relevant',
				actionable: true,
				targetPath: firstOutdated?.path
			});
		}

		// Topic-based recommendations
		if (topics && topics.gaps.length > 0) {
			const topGap = topics.gaps[0];
			recommendations.push({
				type: 'create',
				priority: topGap.importance,
				title: `Knowledge gap: "${topGap.topic}"`,
				description: topGap.reason,
				actions: [
					{
						label: 'Create Note',
						icon: '✏️',
						action: async () => {
							// Create a new note with the topic as a template
							const filename = `${topGap.topic}.md`;
							await this.plugin.app.vault.create(filename, `# ${topGap.topic}\n\n## Overview\n\n## Key Points\n\n## Resources\n\n`);
							await this.plugin.app.workspace.openLinkText(filename, '');
							new Notice(`Created note: ${filename}`);
						}
					}
				],
				impact: 'Addresses knowledge gap and improves topic coverage',
				actionable: true
			});
		}

		// Activity-based recommendations
		if (overview && overview.growthRate < 1) {
			recommendations.push({
				type: 'create',
				priority: 'low',
				title: 'Low note creation rate',
				description: `You're creating less than 1 note per week. Consider capturing more ideas and insights.`,
				actions: [
					{
						label: 'Create New Note',
						icon: '💡',
						action: () => {
							// Create a new note
							this.plugin.app.workspace.openLinkText('', '');
						}
					}
				],
				impact: 'Increases knowledge capture and retention',
				actionable: true
			});
		}

		// Consolidation recommendations
		if (topics && topics.clusters.size > 0) {
			// Find topics with many notes that might benefit from consolidation
			for (const [topic, notes] of topics.clusters.entries()) {
				if (notes.length >= 5) {
					const firstNote = notes[0];
					recommendations.push({
						type: 'consolidate',
						priority: 'low',
						title: `Consider consolidating "${topic}" notes`,
						description: `You have ${notes.length} notes about ${topic}. Some might be merged or better organized.`,
						actions: [
							{
								label: 'View First Note',
								icon: '📚',
								action: () => {
									if (firstNote) {
										this.plugin.app.workspace.openLinkText(firstNote.path, '');
									}
								}
							}
						],
						impact: 'Reduces duplication and improves organization',
						actionable: true,
						targetPath: firstNote?.path
					});
					break; // Only add one consolidation recommendation
				}
			}
		}

		// Sort by priority and limit
		const priorityOrder = { high: 0, medium: 1, low: 2 };
		recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

		return recommendations.slice(0, 8);
	}

	/**
	 * Get a quick vault health score
	 */
	getHealthScore(): number {
		const stats = this.indexer.getVaultStats();

		let score = 100;

		// Deduct for orphaned notes
		const orphanPenalty = Math.min(stats.orphanedNotes * 2, 20);
		score -= orphanPenalty;

		// Deduct for low link density
		const linkDensity = stats.totalNotes > 0 ? stats.totalLinks / stats.totalNotes : 0;
		if (linkDensity < 0.5) {
			score -= 10;
		}

		// Bonus for good tag coverage
		const tagCoverage = stats.totalNotes > 0 ? stats.totalTags / stats.totalNotes : 0;
		if (tagCoverage > 0.5) {
			score += 5;
		}

		return Math.max(0, Math.min(100, score));
	}

	// ============================================================================
	// PRIVATE METHODS
	// ============================================================================

	/**
	 * Analyze vault overview statistics
	 */
	private analyzeOverview(stats: any, allNotes: NoteMetadata[]): VaultOverview {
		// Calculate growth rate (notes created in last 7 days / 7)
		const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
		const recentNotes = allNotes.filter(n => n.createdAt >= oneWeekAgo);
		const growthRate = recentNotes.length / 7;

		return {
			totalNotes: stats.totalNotes,
			totalWords: stats.totalWords,
			totalLinks: stats.totalLinks,
			totalTags: stats.totalTags,
			growthRate: Math.round(growthRate * 10) / 10,
			avgWordsPerNote: stats.totalNotes > 0 ? Math.round(stats.totalWords / stats.totalNotes) : 0,
			avgLinksPerNote: stats.totalNotes > 0 ? Math.round(stats.totalLinks / stats.totalNotes * 10) / 10 : 0,
			orphanedNotes: stats.orphanedNotes,
			largestNotes: stats.largestNotes || [],
			mostLinkedNotes: stats.mostLinkedNotes || []
		};
	}

	/**
	 * Analyze vault health
	 */
	private async analyzeHealth(allNotes: NoteMetadata[]): Promise<VaultHealth> {
		// Find orphaned notes
		const orphanedNotes = this.indexer.getOrphanedNotes();

		// Find weak connections
		const weakConnections: WeakConnection[] = [];
		const linkGraph = await this.linkIntel.analyzeLinkGraph();

		for (const weak of linkGraph.weakConnections) {
			const sourceNote = this.indexer.getNoteMetadata(weak.source);
			const targetNote = this.indexer.getNoteMetadata(weak.target);

			weakConnections.push({
				source: weak.source,
				target: weak.target,
				basename: sourceNote?.basename || weak.source,
				path: sourceNote?.path || weak.source,
				strength: weak.strength,
				reason: this.generateWeakConnectionReason(sourceNote, targetNote, weak.strength)
			});
		}

		// Find outdated notes (not modified in 30 days)
		const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
		const outdatedNotes = allNotes.filter(n => n.modifiedAt < thirtyDaysAgo);

		// Find broken links (links that don't resolve)
		const brokenLinks: Array<{ source: string; target: string }> = [];
		// This would require checking each link - simplified for now

		// Calculate health score
		let healthScore = 100;
		healthScore -= Math.min(orphanedNotes.length * 2, 20);
		healthScore -= Math.min(weakConnections.length, 15);
		healthScore -= Math.min(outdatedNotes.length * 0.5, 10);

		return {
			orphanedNotes,
			weakConnections,
			outdatedNotes,
			brokenLinks,
			healthScore: Math.max(0, Math.round(healthScore))
		};
	}

	/**
	 * Analyze topics and clusters
	 */
	private async analyzeTopics(allNotes: NoteMetadata[]): Promise<TopicAnalysis> {
		const stats = this.indexer.getVaultStats();

		// Find topic clusters (tags with multiple notes)
		const clusters = new Map<string, NoteMetadata[]>();
		for (const [tag, count] of Object.entries(stats.tagCounts)) {
			if (count >= 2) {
				const notes = this.indexer.getNotesByTag(tag);
				clusters.set(tag, notes);
			}
		}

		// Find knowledge gaps
		const gaps: TopicGap[] = await this.findKnowledgeGaps();

		// Add suggestedNotes to gaps
		for (const gap of gaps) {
			gap.suggestedNotes = `${gap.suggestedNoteCount} note${gap.suggestedNoteCount === 1 ? '' : 's'}`;
		}

		// Find trending topics (with growth calculation)
		const trending: TrendingTopic[] = Object.entries(stats.tagCounts)
			.sort((a, b) => b[1] - a[1])
			.slice(0, 10)
			.map(([topic, count]) => ({
				topic,
				growth: Math.round(count / 10) // Simplified growth calculation
			}));

		// Find underexplored topics
		const underexplored = gaps
			.filter(g => g.importance === 'high')
			.map(g => g.topic)
			.slice(0, 5);

		// Calculate completeness score
		const totalTopics = clusters.size + gaps.length;
		const developedTopics = clusters.size;
		const completenessScore = totalTopics > 0 ? Math.round((developedTopics / totalTopics) * 100) : 100;

		return {
			clusters,
			gaps,
			trending,
			underexplored,
			completenessScore
		};
	}

	/**
	 * Analyze vault activity
	 */
	private analyzeActivity(allNotes: NoteMetadata[]): ActivityData {
		// Sort by different metrics
		const mostLinked = [...allNotes].sort((a, b) => b.backlinks.length - a.backlinks.length);
		const recentlyCreated = [...allNotes].sort((a, b) => b.createdAt - a.createdAt);
		const recentlyModified = [...allNotes].sort((a, b) => b.modifiedAt - a.modifiedAt);

		// Calculate activity streak (days with at least one note created)
		let streakDays = 0;
		const today = new Date();
		today.setHours(0, 0, 0, 0);

		for (let i = 0; i < 365; i++) {
			const checkDate = new Date(today);
			checkDate.setDate(checkDate.getDate() - i);

			const hasNoteOnDay = allNotes.some(n => {
				const noteDate = new Date(n.createdAt);
				return noteDate.getDate() === checkDate.getDate() &&
					noteDate.getMonth() === checkDate.getMonth() &&
					noteDate.getFullYear() === checkDate.getFullYear();
			});

			if (hasNoteOnDay) {
				streakDays++;
			} else if (i > 0) {
				// Allow for occasional gaps but break the streak
				break;
			}
		}

		// Activity this week
		const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
		const activityThisWeek = allNotes.filter(n => n.modifiedAt >= oneWeekAgo).length;

		// Generate recent activity events
		const recentActivity: ActivityEvent[] = recentlyCreated.slice(0, 10).map(note => ({
			action: 'Created',
			path: note.path,
			timestamp: note.createdAt
		}));

		// Add modifications
		for (const note of recentlyModified.slice(0, 5)) {
			if (!recentActivity.find(a => a.path === note.path)) {
				recentActivity.push({
					action: 'Modified',
					path: note.path,
					timestamp: note.modifiedAt
				});
			}
		}

		// Sort by timestamp and limit
		recentActivity.sort((a, b) => b.timestamp - a.timestamp);

		return {
			mostActive: mostLinked.slice(0, 10),
			recentlyCreated: recentlyCreated.slice(0, 10),
			recentlyModified: recentlyModified.slice(0, 10),
			streakDays,
			totalActivityThisWeek: activityThisWeek,
			streak: streakDays,
			mostActiveNotes: mostLinked.slice(0, 10),
			recentActivity: recentActivity.slice(0, 10)
		};
	}

	/**
	 * Extract topics from headings
	 */
	private extractTopicsFromHeadings(allNotes: NoteMetadata[]): string[] {
		const topicCounts = new Map<string, number>();

		for (const note of allNotes) {
			for (const heading of note.headings) {
				const words = heading.text.split(/\s+/);
				for (const word of words) {
					if (word.length > 4) {
						const lower = word.toLowerCase().replace(/[^a-z]/g, '');
						if (lower.length > 4) {
							topicCounts.set(lower, (topicCounts.get(lower) || 0) + 1);
						}
					}
				}
			}
		}

		return Array.from(topicCounts.entries())
			.filter(([_, count]) => count >= 3)
			.map(([topic, _]) => topic)
			.slice(0, 20);
	}

	/**
	 * Generate reason for weak connection
	 */
	private generateWeakConnectionReason(source: NoteMetadata | undefined, target: NoteMetadata | undefined, strength: number): string {
		if (!source || !target) return 'Low similarity';

		if (strength < 0.2) {
			return 'Very low content similarity';
		} else if (strength < 0.3) {
			return 'Minimal topical overlap';
		} else {
			return 'Some shared terms but weak connection';
		}
	}

	/**
	 * Clear insights cache
	 */
	clearCache(): void {
		this.insightsCache = null;
	}
}
