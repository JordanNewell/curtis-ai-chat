// Tool JSON Schema builder — deliberately Obsidian-free so provider modules
// (and their unit tests) can import it under node.
//
// Split out of core/tools.ts, which drags in the Obsidian App type for the
// ToolRegistry/ToolContext runtime. core/tools re-exports these names, so
// existing importers are unaffected; provider modules import from here
// directly to keep the Obsidian boundary out of src/providers.

/** JSON Schema object shape — deliberately loose so server-provided schemas
 *  ($defs, oneOf, nested arrays…) pass through untouched. */
export interface JsonSchemaObject {
	type: 'object';
	properties?: Record<string, unknown>;
	required?: string[];
	[key: string]: unknown;
}

export interface ToolParameter {
	type: 'string' | 'number' | 'boolean';
	description: string;
	required?: boolean;
	enum?: string[];
	default?: unknown;
}

/**
 * Structural slice of ToolDefinition the schema builder reads. The full
 * interface (with its App-typed execute context) lives in core/tools —
 * everything that satisfies ToolDefinition satisfies this.
 */
export interface ToolSchemaInput {
	description: string;
	parameters: Record<string, ToolParameter>;
	/**
	 * Full JSON Schema override for `parameters` — used by MCP tools, whose
	 * argument schemas come from the server and can be arbitrarily nested.
	 * When set, buildToolParametersSchema emits this verbatim and the
	 * registry skips its flat required-param pre-check (the MCP server
	 * validates its own arguments).
	 */
	inputSchema?: JsonSchemaObject;
}

/**
 * Build the JSON Schema `parameters` object for a tool definition. Shared by
 * every provider dialect: OpenAI-compat sends it as `parameters`, Anthropic
 * as `input_schema`, Gemini as the function-declaration body, Responses as
 * the flat `parameters` field.
 */
export function buildToolParametersSchema(tool: ToolSchemaInput): JsonSchemaObject {
	// MCP tools (and anything else with a server-provided schema) bypass the
	// flat builder — their schemas are already wire-ready JSON Schema.
	if (tool.inputSchema) return tool.inputSchema;
	const properties: Record<string, Record<string, unknown>> = {};
	const required: string[] = [];
	for (const key of Object.keys(tool.parameters)) {
		const param: ToolParameter = tool.parameters[key];
		const schema: Record<string, unknown> = {
			type: param.type,
			description: param.description,
		};
		if (param.enum) schema.enum = param.enum;
		if (param.default !== undefined) schema.default = param.default;
		properties[key] = schema;
		if (param.required) required.push(key);
	}
	return { type: 'object', properties, required };
}
