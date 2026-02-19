/**
 * Memory Types for Claude Code Integration
 *
 * These types define the interfaces for working with Claude Code's memory system,
 * including episodic memory, working memory, and fact storage.
 */

/**
 * Represents a single message in the conversation history
 */
export interface MemoryMessage {
    /** The role of the message sender (e.g., 'user', 'assistant', 'system') */
    role: 'user' | 'assistant' | 'system';
    /** The content of the message */
    content: string;
    /** ISO timestamp of when the message was created */
    timestamp: string;
    /** Optional metadata associated with the message */
    metadata?: Record<string, unknown>;
}

/**
 * Represents the state of working memory (short-term context buffer)
 */
export interface WorkingMemoryState {
    /** Array of messages in the working memory buffer */
    buffer: MemoryMessage[];
    /** Maximum number of turns to keep in the buffer */
    max_turns: number;
    /** ISO timestamp of when the working memory was last updated */
    updated_at: string;
}

/**
 * Represents a single episode (conversation session) in episodic memory
 */
export interface Episode {
    /** Unique identifier for this episode */
    episode_id: string;
    /** Session identifier this episode belongs to */
    session_id: string;
    /** ISO timestamp of when the episode started */
    started_at: string;
    /** ISO timestamp of when the episode ended (null if ongoing) */
    ended_at: string | null;
    /** Context or topic of the episode */
    context: string;
    /** Array of messages in this episode */
    messages: MemoryMessage[];
    /** Optional summary of the episode */
    summary?: string;
    /** Key topics discussed in this episode */
    key_topics: string[];
    /** Optional metadata associated with the episode */
    metadata?: Record<string, unknown>;
    /** Duration of the episode in seconds */
    duration_seconds?: number;
}

/**
 * Index of episodes for tracking and retrieval
 */
export interface EpisodeIndex {
    /** ISO timestamp of when the index was created */
    created: string;
    /** Array of episode IDs in chronological order */
    episodes: string[];
    /** ID of the current/active episode (null if none active) */
    current_episode: string | null;
}

/**
 * Type of fact for categorization
 */
export type FactType =
    | 'preference'
    | 'behavior'
    | 'knowledge'
    | 'relationship'
    | 'context'
    | 'decision'
    | 'goal'
    | 'other';

/**
 * Represents a single fact extracted from conversations
 */
export interface Fact {
    /** Unique identifier for this fact */
    fact_id: string;
    /** ID of the episode this fact was extracted from */
    episode_id: string;
    /** The factual content/statement */
    content: string;
    /** Type/category of the fact */
    type: FactType;
    /** Entities mentioned in or related to this fact */
    entities: string[];
    /** Topics related to this fact */
    topics: string[];
    /** Importance score (0-1, higher = more important) */
    importance: number;
    /** Number of messages this fact was derived from */
    message_count: number;
    /** ISO timestamp of when the fact was recorded */
    timestamp: string;
    /** Confidence score for the fact's accuracy (0-1) */
    confidence: number;
    /** ISO timestamp of when the fact was last consolidated (null if never) */
    consolidated_at: string | null;
}

/**
 * Result from searching memory
 */
export interface MemorySearchResult {
    /** Facts matching the search query */
    facts: Fact[];
    /** Episodes matching the search query */
    episodes: Episode[];
    /** Total number of results */
    total: number;
}

/**
 * Configuration for the MemoryClient
 */
export interface MemoryClientConfig {
    /** Base path to the memory storage directory */
    basePath: string;
    /** Maximum number of facts to load into context */
    maxFactsToLoad?: number;
    /** Optional session ID for the current session */
    sessionId?: string;
}

/**
 * Options for searching memory
 */
export interface MemorySearchOptions {
    /** Search query string */
    query: string;
    /** Maximum number of results to return */
    limit?: number;
    /** Filter by fact type */
    factType?: FactType;
    /** Filter by topic */
    topic?: string;
    /** Include episodes in results */
    includeEpisodes?: boolean;
    /** Include facts in results */
    includeFacts?: boolean;
}

/**
 * Options for saving an episode
 */
export interface SaveEpisodeOptions {
    /** The episode to save */
    episode: Episode;
    /** Whether to update the episode index */
    updateIndex?: boolean;
    /** Whether to extract facts from the episode */
    extractFacts?: boolean;
}

/**
 * Options for loading memory context
 */
export interface LoadContextOptions {
    /** Maximum number of relevant facts to include */
    maxFacts?: number;
    /** Maximum number of recent episodes to include */
    maxEpisodes?: number;
    /** Filter by topics */
    topics?: string[];
    /** Include working memory buffer */
    includeWorkingMemory?: boolean;
}

/**
 * Statistics about the memory system
 */
export interface MemoryStats {
    /** Total number of episodes */
    totalEpisodes: number;
    /** Total number of facts */
    totalFacts: number;
    /** Total number of messages across all episodes */
    totalMessages: number;
    /** Size of working memory buffer */
    workingMemorySize: number;
    /** Oldest episode timestamp */
    oldestEpisode?: string;
    /** Newest episode timestamp */
    newestEpisode?: string;
}
