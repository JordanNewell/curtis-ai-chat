// Curtis — Shared Types & Interfaces

// ============================================================================
// TOOL TYPES (re-exported so callers can stay on a single import surface)
// ============================================================================
//
// ToolCall / ToolResult / ToolDefinition live in core/tools.ts alongside
// ToolRegistry; re-export them here so consumers that already pull from
// '../types' don't have to thread a second import. The definitions below
// depend on these shapes.
import type { ToolDefinition, ToolCall } from './core/tools';
export type { ToolDefinition, ToolParameter, ToolCall, ToolResult, ToolContext } from './core/tools';

// ============================================================================
// PROVIDER TYPES
// ============================================================================

export interface AIMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string | MessageContent[];
	/** When role='assistant' and the model returned tool_calls. */
	tool_calls?: ToolCall[];
	/** When role='tool' — id of the originating assistant tool call. */
	tool_call_id?: string;
	/** Optional name of the tool that produced this result (role='tool'). */
	name?: string;
}

export interface MessageContent {
	type: 'text' | 'image_url';
	text?: string;
	image_url?: { url: string };
}

export interface AIModel {
	id: string;
	name: string;
	contextLength: number;
	inputPrice?: number;   // per million tokens USD
	outputPrice?: number;
	visionSupported?: boolean;
	functionCallingSupported?: boolean;
}

export interface AIRequestOptions {
	model: string;
	temperature: number;
	maxTokens: number;
	stream?: boolean;
	/** When set, the provider advertises tools to the model (agent mode). */
	tools?: ToolDefinition[];
}

export interface AIResponse {
	content: string;
	usage?: TokenUsage;
	reasoning?: string;
	/** Tool calls the model wants executed. Empty/absent means: final answer. */
	tool_calls?: ToolCall[];
}

export interface TokenUsage {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	cachedTokens?: number;
}

export interface StreamChunk {
	delta: string;
	usage?: TokenUsage;
	done: boolean;
}

export type StreamCallback = (chunk: string) => void;
export type UsageCallback = (usage: TokenUsage) => void;
export type ErrorCallback = (error: Error) => void;

/**
 * Relaxed response shape that the transport layer produces.
 * Both native `Response` and our Node-https / requestUrl shims satisfy this.
 * Provider parseStream/parseResponse methods consume it via `.body.getReader()`
 * or `.json()`/`.text()`.
 */
export interface StreamResponse {
	readonly ok: boolean;
	readonly status: number;
	json(): Promise<unknown>;
	text(): Promise<string>;
	body?: ReadableLike;
}

/**
 * Minimal ReadableStream-like interface. Native fetch returns a full
 * ReadableStream<Uint8Array>; our Node IncomingMessage shim wraps it.
 * Provider parsers use `body.getReader()` + `read()` only.
 */
export interface ReadableLike {
	getReader(): ReadableReader;
}

export interface ReadableReader {
	read(): Promise<{ done: true; value?: undefined } | { done: false; value: Uint8Array }>;
	releaseLock(): void;
}

export interface AIProvider {
	readonly id: string;
	readonly name: string;
	readonly endpoint: string;
	models: AIModel[];  // mutable so auto-discovery can update in place
	readonly supportsStreaming: boolean;
	readonly supportsVision: boolean;

	formatRequest(messages: AIMessage[], options: AIRequestOptions): RequestInit;
	parseResponse(response: StreamResponse): Promise<AIResponse>;
	parseStream(response: StreamResponse, onChunk: StreamCallback, onUsage?: UsageCallback, onError?: ErrorCallback): Promise<void>;
	isAuthenticated(): boolean;
	getModelPricing(modelId: string): { inputPrice: number; outputPrice: number } | null;
	/** Replace this provider's model list (used by auto-discovery). */
	setModels?(models: AIModel[]): void;
	/** True when this provider speaks the OpenAI tool-calling dialect.
	 *  Optional — providers that don't implement it return falsy via
	 *  `provider?.supportsToolCalls?.()`. v1 agent mode is gated on this. */
	supportsToolCalls?(): boolean;
}

export type AuthType = 'bearer' | 'anthropic' | 'none' | 'oauth';

export interface ProviderDefinition {
	id: string;
	name: string;
	endpoint: string;
	authType: AuthType;
	models: AIModel[];
	autoDiscoverModels?: boolean;  // fetch /v1/models at runtime
	icon?: string;
}

export interface ProviderConfig {
	/** Plaintext API key. Deprecated — prefer apiKeyRef (OS keychain). */
	apiKey?: string;
	/** Reference to OS keychain entry. When set, apiKey is empty. */
	apiKeyRef?: string;
	enabled: boolean;
	defaultModel?: string;
	customEndpoint?: string;  // user override
}

// ============================================================================
// CONVERSATION TYPES
// ============================================================================

export interface ConversationMessage {
	id: string;
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
	timestamp: number;
	cost?: number;
	tokens?: TokenUsage;
	provider?: string;
	model?: string;
	images?: string[];  // base64
	parentId?: string;  // for branching
	/** Vault paths of notes attached via @-mention. Their contents are
	 *  prepended to `content` when building the message sent to the AI,
	 *  but never shown in the user's chat bubble. Presists across
	 *  regen / edit-resend so the AI sees consistent context. */
	attachedNotes?: string[];
	/** Tool calls the assistant requested (role='assistant' only).
	 *  v1 agent mode emits at most one per turn. */
	tool_calls?: ToolCall[];
	/** Set when role='tool' — links the result back to the originating call. */
	tool_call_id?: string;
	/** True when a tool returned an error — used to style the result bubble. */
	tool_error?: boolean;
}

export interface ConversationBranch {
	id: string;
	parentMessageId: string;
	messageId: string;
	label?: string;
}

export interface Conversation {
	id: string;
	title: string;
	messages: ConversationMessage[];
	branches: ConversationBranch[];
	createdAt: number;
	updatedAt: number;
	provider: string;
	model: string;
	tags?: string[];
	starred?: boolean;
	activeBranch?: string;
}

export interface ConversationStats {
	totalConversations: number;
	totalMessages: number;
	totalTokens: number;
	totalCost: number;
	providerBreakdown: Record<string, { tokens: number; cost: number }>;
	modelBreakdown: Record<string, { tokens: number; cost: number; count: number }>;
}

// ============================================================================
// SETTINGS TYPES
// ============================================================================

export interface CurtisSettings {
	// Active provider/model
	activeProvider: string;
	activeModel: string;

	// Per-provider configs keyed by provider id
	providerConfigs: Record<string, ProviderConfig>;

	// Custom providers (user-added)
	customProviders: ProviderDefinition[];

	// Shared generation settings
	temperature: number;
	maxTokens: number;
	systemPrompt: string;
	streamResponse: boolean;
	showTokenUsage: boolean;

	// Chat settings
	chatViewPosition: 'right' | 'left';
	chatWidth: number;  // pixels

	/** Folder where Save-as-note and slash /note drop new notes. '' = vault root. */
	noteSaveFolder: string;
	/** Auto-save each assistant response to a note (no prompt). */
	autoSaveAssistantResponses: boolean;
	/** Folder for auto-saved responses. Defaults to noteSaveFolder when empty. */
	autoSaveFolder: string;

	/** Enter key behavior in the chat input.
	 *  - 'send': Enter sends, Shift+Enter newline (default, current behavior)
	 *  - 'newline': Enter inserts newline, Ctrl/Cmd+Enter sends */
	enterKeyBehavior: 'send' | 'newline';
	/** Chat background — theme default, or a custom wallpaper image. */
	chatBackground: 'theme' | 'wallpaper';
	/** Vault path of the wallpaper image (when chatBackground = 'wallpaper'). */
	chatWallpaperPath: string;

	// Cost tracking
	enableCostTracking: boolean;
	budgetLimit?: number;

	// Memory
	enableMemory: boolean;
	/** 'off' = manual only, 'auto' = LLM extracts after each turn. */
	memoryCaptureMode: 'off' | 'auto';
	/** Path (relative to vault root) of the markdown memory file. */
	memoryFilePath: string;

	enableDailyNotesAssistant: boolean;
	dailyNotesFolder: string;
	dailyNotesFormat: string;

	// RAG
	enableRag: boolean;
	ragChunkSize: number;
	ragChunkOverlap: number;
	ragTopK: number;
	ragEmbeddingProvider: string;
	ragEmbeddingModel: string;

	// Agent — lets the AI invoke tools to read/modify the vault. v1 ships
	// OpenAI-compat only; other families fall back to plain chat silently.
	enableAgent: boolean;
	/** Safety cap on tool invocations per user message (loop guard). */
	agentMaxTurns: number;
	/** Opt-in web tools (web_search + read_url). Off by default — Curtis is
	 *  vault-first. When enabled, requires enableAgent=true to take effect. */
	enableWebSearch: boolean;
	/** Render "Today / Yesterday / date" dividers between messages that
	 *  cross a calendar-date boundary. Matches iMessage/Telegram feel. */
	showDaySeparators: boolean;

	// Hotkeys
	hotkeys: HotkeyConfig;
}

export interface HotkeyConfig {
	toggleChat: string;
	quickAction: string;
	explainSelection: string;
}

// ============================================================================
// TEMPLATE TYPES
// ============================================================================

export interface TemplateVariable {
	name: string;
	defaultValue?: string;
	required?: boolean;
	description?: string;
}

export interface PromptTemplate {
	id: string;
	name: string;
	description: string;
	category: TemplateCategory;
	content: string;
	variables?: TemplateVariable[];
	systemPrompt?: string;
	icon?: string;
}

export type TemplateCategory = 'writing' | 'coding' | 'analysis' | 'creative' | 'productivity' | 'learning' | 'custom';

// ============================================================================
// MEMORY TYPES
// ============================================================================

export interface MemoryFact {
	id: string;
	content: string;
	category?: string;
	timestamp: number;
	accessCount: number;
	lastAccessed: number;
}

// ============================================================================
// RAG TYPES
// ============================================================================

export interface EmbeddingChunk {
	id: string;
	filePath: string;
	content: string;
	embedding: number[];
	startIndex: number;
	endIndex: number;
}

export interface RetrievalResult {
	chunk: EmbeddingChunk;
	score: number;
}
