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
import type { McpServerConfig } from './mcp/types';
export type { ToolDefinition, ToolParameter, ToolCall, ToolResult, ToolContext } from './core/tools';
export type { McpServerConfig, McpServerStatus, McpConnectionState } from './mcp/types';
export type { GcpConnectorStatus, GcpServiceAccount } from './gcp/types';

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
	/** When role='tool' — the tool reported an error (maps to Anthropic is_error). */
	is_error?: boolean;
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
	/** Undefined = omit the field entirely (reasoning models often reject it).
	 *  Providers must never send `temperature` when this is undefined. */
	temperature?: number;
	maxTokens: number;
	stream?: boolean;
	/** When set, the provider advertises tools to the model (agent mode). */
	tools?: ToolDefinition[];
	// --- Advanced per-provider overrides (all undefined = don't send) ---
	topP?: number;
	topK?: number;
	minP?: number;
	seed?: number;
	/** Stop sequences (OpenAI `stop`, Anthropic `stop_sequences`). */
	stop?: string[];
	frequencyPenalty?: number;
	presencePenalty?: number;
	repetitionPenalty?: number;
	/** Raw passthrough deep-merged into the request body last. Reserved keys
	 *  (model/messages/stream/stream_options) cannot be overridden. */
	extra?: Record<string, unknown>;
	/** Reasoning effort for models that expose the knob. Resolved through the
	 *  override layers; translated to the provider's wire dialect into
	 *  reasoningBody (see getReasoningWire). */
	reasoningEffort?: ReasoningEffort;
	/** Provider-dialect body fragments for the reasoning request
	 *  (reasoning_effort / thinking / think …). Merged into the request body
	 *  after the structured sampling knobs and before the user's extra body. */
	reasoningBody?: Record<string, unknown>;
	/** Ollama-native hardware knobs (options{}/keep_alive). Ignored by the
	 *  OpenAI-compatible providers — only OllamaProvider consumes them. */
	ollama?: OllamaRequestParams;
}

/** Reasoning-effort levels Curtis understands. Providers translate these into
 *  their own dialects (reasoning_effort, thinking, think) — see
 *  getReasoningWire in the provider registry. 'off' explicitly disables
 *  reasoning where a provider can; undefined means "don't send anything". */
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'max' | 'off';

/** Ollama native /api/chat knobs that have no OpenAI-compat equivalent. */
export interface OllamaRequestParams {
	/** options.num_ctx — context window in tokens (server default is
	 *  VRAM-adaptive; practical floor 4096). */
	numCtx?: number;
	/** options.num_gpu — layers offloaded to GPU; 0 forces CPU. */
	numGpu?: number;
	/** options.num_thread — compute threads (server auto-detects). */
	numThread?: number;
	/** keep_alive — "10m"/"24h" duration, seconds as number string,
	 *  negative = keep forever, 0 = unload after response. */
	keepAlive?: string;
}

/**
 * Per-provider advanced parameter overrides. Every field is optional; a
 * missing/undefined field means "not set" — the global default is used (or
 * the parameter is not sent at all, for the optional sampling knobs).
 * Persisted inside ProviderConfig, so it round-trips through settings.json
 * and .curt exports untouched.
 */
export interface ModelOverrides {
	/** Overrides the global Generation → temperature. */
	temperature?: number;
	/** Overrides the global Generation → max tokens. */
	maxTokens?: number;
	/** Never send temperature (for models that 400 on it, e.g. OpenAI
	 *  reasoning models when reasoning effort is active). */
	omitTemperature?: boolean;
	topP?: number;
	topK?: number;
	minP?: number;
	seed?: number;
	/** Comma-separated in the UI; split into an array on the wire. */
	stopSequences?: string;
	frequencyPenalty?: number;
	presencePenalty?: number;
	repetitionPenalty?: number;
	/** Raw JSON object merged into the request body last. */
	extraBodyJson?: string;
	// Ollama-only (rendered only on the Ollama card):
	numCtx?: number;
	numGpu?: number;
	numThread?: number;
	keepAlive?: string;
	/** Reasoning effort for the scoped provider or model — translated to the
	 *  provider's dialect at request time. */
	reasoningEffort?: ReasoningEffort;
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
	/** Called by the host just before a request is dispatched. Providers with
	 *  time-limited credentials (OAuth subscriptions) refresh here, since
	 *  formatRequest builds its headers synchronously and cannot await. */
	prepare?(): Promise<void>;
	/** True when this provider speaks the OpenAI tool-calling dialect.
	 *  Optional — providers that don't implement it return falsy via
	 *  `provider?.supportsToolCalls?.()`. v1 agent mode is gated on this. */
	supportsToolCalls?(): boolean;
}

export type AuthType = 'bearer' | 'anthropic' | 'none' | 'oauth' | 'key';

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
	/** Reference to the OS keychain entry holding this provider's OAuth token
	 *  blob (JSON: access/refresh tokens, expiry, issued client id). Set by
	 *  the Sign in with ChatGPT flow; when unset the provider is signed out. */
	oauthRef?: string;
	/** Plaintext OAuth token blob. Fallback for Obsidian builds without
	 *  secretStorage — mirrors the apiKey/apiKeyRef split. */
	oauthJson?: string;
	enabled: boolean;
	defaultModel?: string;
	customEndpoint?: string;  // user override
	/** Model ids the user typed in manually (Settings → "Add model").
	 *  Escape hatch for providers whose /models listing lags what the plan
	 *  actually serves — these ids are always offered in the picker and are
	 *  never pruned by discovery. */
	extraModels?: string[];
	/** Per-provider advanced request parameters (sampling knobs, raw extra
	 *  body, Ollama hardware options). Absent = all defaults. Provider-level
	 *  defaults for every model this provider serves. */
	modelOverrides?: ModelOverrides;
	/** Per-model advanced overrides keyed by model id, layered above
	 *  modelOverrides. Field-level: a defined value wins; undefined falls
	 *  through to the provider default. */
	perModelOverrides?: Record<string, ModelOverrides>;
}

// ============================================================================
// AGENT TYPES (named workers — persona + model routing + tool ACL)
// ============================================================================

/** Tool-class visibility for an agent. The registry already enforces the
 *  global toggles (a web tool only exists when enableWebSearch is on), so an
 *  agent's ACL can only ever NARROW what the globals allow — never widen. */
export interface AgentToolAcl {
	/** Vault tools: read/search/create/edit notes, semantic search, shell. */
	vault: boolean;
	/** web_search + read_url. */
	web: boolean;
	/** MCP tools (mcp__<server>__<tool>). */
	mcp: boolean;
	/** GCP connector tools (gcp__storage__*, read-only Cloud Storage). */
	gcp: boolean;
}

/** A named agent: a reusable role the user binds to any conversation or
 *  hands to the swarm's spawn_agent. Not a runtime — it resolves to
 *  (persona, provider, model, tool filter, loop cap) inside the existing
 *  agent loop. The lane is the product; the model is a swappable part. */
export interface Agent {
	id: string;
	name: string;
	/** Emoji shown on the header pill and in pickers. */
	emoji: string;
	/** Role persona. Layered AFTER the CORE system prompt and the user's
	 *  global extension — the role wins ties; standing orders survive it. */
	systemPrompt: string;
	/** Model routing — this agent's requests go to this provider/model. */
	providerId: string;
	modelId: string;
	tools: AgentToolAcl;
	/** Optional sampling overrides. Undefined = global/provider defaults. */
	temperature?: number;
	maxTokens?: number;
	/** Optional override of the global agentMaxTurns loop cap. */
	maxTurns?: number;
	/** Memory participation. 'inherit' follows the global memory toggle;
	 *  'on'/'off' force it. A local-only agent MUST ship with 'off' — under
	 *  shared memory, a fact this agent learns would later ride out to a
	 *  cloud chat through the memory file. */
	memory: 'inherit' | 'on' | 'off';
	/** PCP-0 consent policy: which claim classes from the profile file
	 *  (settings.pcpFilePath, e.g. PEP-P personality, PEP-D developer) this
	 *  agent may see injected. Undefined/empty = no profile claims at all.
	 *  `*` allows every class in the file. Evaluated at send time —
	 *  most-restrictive-wins, default deny. */
	claims?: string[];
	/** Programmatic invocation gate. False/undefined = this agent can only
	 *  ever run in chats the user started. True = MCP clients (run_agent)
	 *  and plugin-API callers (api.runAgent) may invoke it headlessly —
	 *  the model still routes to the agent's own provider at the user's
	 *  cost, but the task text arrives from outside. One switch gates both
	 *  inbound surfaces so the security story stays tellable. */
	remote?: boolean;
	createdAt: number;
}

// ============================================================================
// SCHEDULED RUNS
// ============================================================================

/** When a scheduled job should fire. Two shapes cover the real jobs —
 *  wall-clock precision is impossible anyway (an Obsidian plugin only runs
 *  while the app is open), so a full cron grammar would be precision theater. */
export type ScheduledJobSchedule =
	| { kind: 'daily'; /** Local wall-clock time, 'HH:MM' (24h). */ time: string }
	| { kind: 'interval'; /** Minutes between runs (5–10080). */ minutes: number };

/** One scheduled agent run: a task prompt (optionally run through a named
 *  agent) fired on a cadence while Obsidian is open. Persisted in data.json;
 *  bookkeeping fields (last*) feed the settings list, not the model. */
export interface ScheduledJob {
	id: string;
	/** User label — also names the output note ("<name> YYYY-MM-DD HH-mm.md"). */
	name: string;
	enabled: boolean;
	/** The task. Runs headlessly through the same agent loop as chat. */
	prompt: string;
	/** Named agent to run through (its persona + routing + tool ACL apply).
	 *  ''/undefined = the default assistant via api.chat(). The agent must
	 *  have "Remote invocation" enabled or every run fails with a clear
	 *  error written into the run note. */
	agentName?: string;
	schedule: ScheduledJobSchedule;
	createdAt: number;
	/** Epoch ms of the last fire ATTEMPT (success or failure) — set before
	 *  the run starts so a crash mid-run can't re-fire in a tight loop. */
	lastFiredAt?: number;
	lastStatus?: 'ok' | 'error';
	lastError?: string;
	lastDurationMs?: number;
	/** Vault path of the most recent run note. */
	lastRunPath?: string;
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
	/** Named agent that produced this message (assistant) or that the turn
	 *  ran under (user) — per-message attribution for mid-conversation
	 *  agent switching. Ids only; the agent may later be deleted or edited. */
	agentId?: string;
	images?: string[];  // base64
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
	/** Ids of the memory facts injected into the system prompt for this turn
	 *  (role='assistant' only). Powers the "N memories" chip; stored as ids —
	 *  not contents — so the chip stays truthful after facts are edited or
	 *  removed. */
	memoriesUsedIds?: string[];
}

export interface Conversation {
	id: string;
	title: string;
	messages: ConversationMessage[];
	createdAt: number;
	updatedAt: number;
	provider: string;
	model: string;
	/** Swarm role. 'leader' chats may spawn follower agents via the
	 *  spawn_agent tool; 'follower' chats are driven by a leader. Undefined
	 *  for ordinary chats. */
	role?: 'leader' | 'follower';
	/** For followers: the conversation id of the leader that spawned them. */
	leaderId?: string;
	/** Named agent bound to this chat — resolves persona, model routing, and
	 *  tool ACL at request time. Undefined = the default assistant (global
	 *  system prompt, pane-level model). */
	agentId?: string;
}

export interface ConversationStats {
	totalConversations: number;
	totalMessages: number;
	totalTokens: number;
	totalCost: number;
	providerBreakdown: Record<string, { tokens: number }>;
	modelBreakdown: Record<string, { tokens: number; count: number }>;
}

// ============================================================================
// SETTINGS TYPES
// ============================================================================

/** User-defined selection action, shown alongside the built-in editor
 *  actions (context menu, command palette). {{selection}} in
 *  userPromptTemplate is replaced with the selected text at run time. */
export interface CustomSelectionAction {
	id: string;
	name: string;
	systemPrompt: string;
	userPromptTemplate: string;
	insertMode: 'replace' | 'insert-below';
}

export interface CurtisSettings {
	// Active provider/model
	activeProvider: string;
	activeModel: string;

	// Per-provider configs keyed by provider id
	providerConfigs: Record<string, ProviderConfig>;

	// Custom providers (user-added)
	customProviders: ProviderDefinition[];

	/** Last successful model-discovery result per provider id. Seeds model
	 *  lists on startup so the picker never falls back to the (possibly
	 *  months-old) built-in list while offline or before the background
	 *  refresh lands. Written by the registry, never by user action. */
	discoveredModels?: Record<string, AIModel[]>;

	/** Per-installation host id (a UUID, sent as urn:uuid:…) for Sign in with
	 *  ChatGPT dynamic client registration. Generated on first sign-in, then
	 *  stable so OpenAI recognizes the installation on re-auth. */
	chatgptHostId?: string;

	// Shared generation settings
	temperature: number;
	maxTokens: number;
	systemPrompt: string;
	streamResponse: boolean;
	showTokenUsage: boolean;

	// Chat settings
	chatViewPosition: 'right' | 'left';

	/** System notification when a response finishes. Suppressed while the
	 *  user is viewing the chat pane; in-app Notice fallback on mobile. */
	notifyOnCompletion: boolean;
	/** System notification when a request fails. */
	notifyOnError: boolean;

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

	// Voice I/O
	/** voiceURI of the preferred system read-aloud voice; '' = auto-pick
	 *  (en-US default heuristic). Voices are platform-specific: a stored
	 *  voiceURI missing on this machine falls back to auto silently. */
	ttsVoiceUri: string;
	/** Default read-aloud rate. The player's rate button is a session-level
	 *  override on top of this and does not write back. */
	ttsRate: number;
	/** Read-aloud voice pitch (0.5–1.5). */
	ttsPitch: number;
	/** Speak each assistant response aloud as it completes. */
	ttsAutoSpeak: boolean;
	/** Highlight (and scroll to) the sentence being read during playback. */
	ttsHighlight: boolean;

	// Memory
	enableMemory: boolean;
	/** 'off' = manual only, 'confirm' = model proposes, user ratifies before
	 *  anything is saved (default), 'auto' = model extracts and saves silently. */
	memoryCaptureMode: 'off' | 'confirm' | 'auto';
	/** Path (relative to vault root) of the markdown memory file. */
	memoryFilePath: string;
	/** Path (relative to vault root) of the personal context profile —
	 *  structured claim sections (PEP-P, PEP-D, …) that agents inject per
	 *  their consent policy. PCP-0; see docs/plans/2026-10-09-agents.md. */
	pcpFilePath: string;

	/** Folder (relative to vault root) where conversation transcripts are
	 *  stored as one markdown file per conversation. */
	conversationsFolder: string;

	/** Session recaps: /recap and the header export menu summarize the
	 *  current conversation; when this is on, the summary is also appended
	 *  to the journal file below. */
	enableJournal: boolean;
	/** Path (relative to vault root) of the append-only journal markdown file. */
	journalFilePath: string;

	// RAG
	enableRag: boolean;
	/** Relevance pulse: when the active note closely matches an indexed past
	 *  conversation, show a quiet "discussed in …" hint under the chat header.
	 *  Local-only cosine over the existing index — costs no API calls. */
	enableRelevancePulse: boolean;
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
	/** Provider for agent-mode turns (the tool loop — vault tools, terminal
	 *  commands, swarm leaders). '' follows the active chat provider. A named
	 *  agent bound to the conversation still wins over this override. */
	agentProviderId: string;
	/** Model for agent-mode turns. '' follows the active chat model. */
	agentModelId: string;
	/** Swarm: how many follower agents a leader chat may spawn per send.
	 *  Each follower is a full agent run with its own conversation. */
	swarmMaxFollowers: number;
	/** Opt-in web tools (web_search + read_url). Off by default — Curtis is
	 *  vault-first. When enabled, requires enableAgent=true to take effect. */
	enableWebSearch: boolean;
	/** MCP client — connect to user-configured MCP servers and call their
	 *  tools alongside the built-ins. Requires enableAgent=true to take
	 *  effect (MCP tools ride the same agent loop). */
	enableMcp: boolean;
	/** MCP server configs (Streamable HTTP endpoints). */
	mcpServers: McpServerConfig[];
	/** GCP connector — call read-only Cloud Storage tools on the user's
	 *  Google Cloud project with a service-account key. Requires
	 *  enableAgent=true to take effect (GCP tools ride the agent loop). */
	enableGcp: boolean;
	/** GCP project id for bucket listing. Empty = the service-account key's
	 *  own project_id. */
	gcpProjectId: string;
	/** OS keychain reference for the service-account JSON
	 *  (curtis-api-key-gcp-service-account). Set only when the keychain is
	 *  available and accepted the secret. */
	gcpServiceAccountRef?: string;
	/** Plaintext fallback for the service-account JSON when the OS keychain
	 *  is unavailable. Never set when the ref is. */
	gcpServiceAccountJson?: string;
	/** MCP server mode — serve the vault (search, read, write, memory) as
	 *  MCP tools on localhost so external AI apps can use them. Desktop
	 *  only (mobile has no listening sockets). Off by default. */
	enableMcpServer: boolean;
	/** TCP port for the MCP server. Bound to 127.0.0.1 only. */
	mcpServerPort: number;
	/** Bearer token MCP clients must present. Generated on first start;
	 *  lives in data.json like the rest of the local-only config. */
	mcpServerToken: string;
	/** Expose write_note (create/overwrite/append) to MCP clients. Off by
	 *  default — reads are safe, writes are the part worth gating. */
	mcpServerAllowWrites: boolean;
	/** Named agents — reusable worker configs (persona + model + tool ACL)
	 *  the user can bind to any conversation or hand to the swarm. Settings-
	 *  backed (data.json); the shareable file format is an export concern. */
	agents: Agent[];
	/** Scheduled agent runs — prompt (+ optional named agent) on a cadence,
	 *  fired only while Obsidian is open. See src/scheduler/. */
	scheduledJobs: ScheduledJob[];
	/** Folder run notes are written to (one note per run, frontmatter carries
	 *  job/status/duration; the body is the agent's answer or the error). */
	scheduledOutputFolder: string;
	/** Render "Today / Yesterday / date" dividers between messages that
	 *  cross a calendar-date boundary. Matches iMessage/Telegram feel. */
	showDaySeparators: boolean;
	/** Show a site favicon next to external links in chat. Icons load from
	 *  DuckDuckGo's icon service — one request per domain, so off keeps chat
	 *  rendering fully local. */
	showLinkFavicons: boolean;

	// Terminal — desktop-only shell pane + the agent's run_command tool.
	/** Opt-in shell tool (run_command) for agent mode. Off by default —
	 *  same vault-first posture as the web tools. Requires enableAgent. */
	enableCommands: boolean;
	/** Show a dialog before every agent-initiated command, with a
	 *  per-session "always allow" escape hatch. */
	terminalConfirmCommands: boolean;
	/** Refuse a run_command working directory outside the vault root. */
	terminalRestrictToVault: boolean;
	/** Shell override: '', 'cmd', 'powershell', 'pwsh', or a custom
	 *  executable path. Empty = platform default. */
	terminalShell: string;
	/** Kill an agent-initiated command after this many seconds (clamped
	 *  1–600 at execution time). */
	terminalTimeoutSeconds: number;
	/** Remember terminal commands across panes and sessions. Off = each
	 *  pane keeps its own session-only history (the pre-memory behavior). */
	terminalMemory: boolean;
	/** The shared persistent command history — most recent last, capped at
	 *  TERMINAL_HISTORY_CAP. Only consulted when terminalMemory is on. */
	terminalHistory: string[];
	/** Last terminal working directory, restored on open when terminalMemory
	 *  is on. Desktop: absolute OS path. Vault mode: vault-relative. */
	terminalLastCwd: string;

	// Inline autocomplete — editor ghost text.
	/** Ghost-text suggestions while typing in notes. Default off: each
	 *  suggestion sends the text around the cursor to the selected provider. */
	enableAutocomplete: boolean;
	/** Provider for autocomplete requests. '' follows the active chat
	 *  provider. */
	autocompleteProviderId: string;
	/** Model for autocomplete requests. '' follows the active chat model.
	 *  Small, fast models are the right call — the request caps at 60 tokens. */
	autocompleteModelId: string;
	/** Idle wait after the last keystroke before a request fires. */
	autocompleteDebounceMs: number;
	/** Chars since the last whitespace required before triggering. */
	autocompleteMinChars: number;
	/** Key that accepts a visible suggestion. Tab is captured only while a
	 *  suggestion is showing, so vim-style Tab indentation is untouched
	 *  otherwise — but vim users may still prefer an alternative. */
	autocompleteAcceptKey: 'tab' | 'alt-tab' | 'ctrl-arrow';

	/** False until the user sends their first message (or skips) — gates the
	 *  first-run panel in the empty state. Existing installs are migrated to
	 *  true; only fresh installs ever see onboarding. */
	onboardingCompleted: boolean;

	// Selection actions (editor context menu / command palette).
	/** Last target language used by the translate action — prefill for the
	 *  next run of the language prompt. */
	selectionTranslateLanguage: string;
	/** User-defined selection actions shown alongside the built-ins. */
	customSelectionActions: CustomSelectionAction[];

	// Anthropic extended thinking.
	/** Show Claude's reasoning before the final answer. */
	anthropicExtendedThinking: boolean;
	/** Token budget for Anthropic extended thinking (1024–32000). */
	anthropicThinkingBudget: number;
}

// ============================================================================
// MEMORY TYPES
// ============================================================================

export interface MemoryFact {
	id: string;
	content: string;
	category?: string;
	/** Conversation the fact was learned from, when captured from chat.
	 *  Round-trips through the memory file's hidden comment as `conv:`. */
	sourceConversationId?: string;
	timestamp: number;
	accessCount: number;
	lastAccessed: number;
}

/** A fact the model extracted in 'confirm' capture mode, pending the user's
 *  Save/Skip decision. Nothing touches the memory file until Save. */
export interface MemoryProposal {
	content: string;
	category?: string;
	/** Conversation the proposal was extracted from — carried onto the saved
	 *  fact for provenance. */
	sourceConversationId?: string;
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
