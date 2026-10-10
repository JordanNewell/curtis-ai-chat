// Pure tool-calling type definitions. The ToolRegistry implementation stays
// in the Obsidian shell for now (it touches the vault directly); these types
// are the contract any host implements against.
/** Platform-agnostic tool context. Host shells narrow `app` to their concrete handle. */
export interface ToolContext {
	app: unknown;
	conversationId?: string;
}

export interface ToolParameter {
	type: 'string' | 'number' | 'boolean';
	description: string;
	required?: boolean;
	enum?: string[];
	default?: unknown;
}

export interface ToolDefinition {
	name: string;
	description: string;
	parameters: Record<string, ToolParameter>;
	execute: (params: Record<string, unknown>, context: ToolContext) => Promise<string>;
}

export interface ToolCall {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

export interface ToolResult {
	tool_call_id: string;
	content: string;
	is_error?: boolean;
}
