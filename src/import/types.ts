// Chat import — shared shapes for external-format conversion.
//
// Every source parser (ChatGPT export, Claude export, generic markdown,
// .curt bundles) normalizes into ParsedChat / ParsedMessage; the importer
// turns those into real Conversation objects with fresh ids. Keeping the
// intermediate shape source-agnostic means a future standalone importer
// plugin can lift this module wholesale.

import type { Conversation } from '../types';

export type ImportFormat = 'curt' | 'curtis-md' | 'chatgpt' | 'claude' | 'generic-json' | 'generic-md';

/** One message pulled out of a foreign export. */
export interface ParsedMessage {
	role: 'user' | 'assistant' | 'system' | 'tool';
	content: string;
	/** Epoch ms when known (ChatGPT exports seconds; Claude ISO strings). */
	timestamp?: number;
	/** Model id recorded on assistant messages, when the export carries it. */
	model?: string;
}

/** A conversation extracted from a foreign export, before id assignment. */
export interface ParsedChat {
	title: string;
	messages: ParsedMessage[];
	createdAt?: number;
	updatedAt?: number;
	/** Original provider/model recorded as display metadata only —
	 *  continuation always uses the user's currently active provider. */
	provider?: string;
	model?: string;
}

export interface ImportedFileReport {
	file: string;
	format: ImportFormat | 'unknown';
	/** Conversations successfully written to the vault. */
	imported: number;
	/** Conversations skipped as already-present duplicates. */
	skipped: number;
	/** Reason when the whole file failed. */
	error?: string;
}

export interface ImportSummary {
	reports: ImportedFileReport[];
	totalImported: number;
	totalSkipped: number;
}

/** Result of detection: the format plus, lazily, the parsed chats. */
export interface DetectedFile {
	format: ImportFormat | 'unknown';
	chats: ParsedChat[];
	/** Only set when format is 'curt' — a .curt round-trips a full
	 *  Conversation (ids, tokens, images) so it skips normalization. */
	conversations?: Conversation[];
}
