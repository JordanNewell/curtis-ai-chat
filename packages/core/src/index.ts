// @curtis/core — public API.
// Platform ports (ports.ts) + the brain: types, providers' pure logic,
// system prompt, migrations, events, hooks, tool types, JSON helpers, diff.
export * from './ports';
export * from './types';
export { EventBus } from './core/events';
export type { EventBusEvents } from './core/events';
export { HookSystem } from './core/hooks';
export type { HookContext, HookDefinitions } from './core/hooks';
export { runMigrations, CURRENT_VERSION, MIGRATIONS } from './core/migration';
export type { Migration, SettingsData } from './core/migration';
export { CORE_SYSTEM_PROMPT, composeSystemPrompt } from './core/system-prompt';
export type {
	ToolContext,
	ToolDefinition,
	ToolParameter,
	ToolCall,
	ToolResult,
} from './core/tool-types';
export { isRecord, hasStringProp, hasNumberProp, hasArrayProp, hasProp, asStringArray, asString, asNumber, requireRecord } from './core/types/json-helpers';
export { diffLines } from './utils/diff';
export type { DiffLine } from './utils/diff';
