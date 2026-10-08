#!/usr/bin/env node
/**
 * fetch-plugin-stats.mjs — append one snapshot of marketplace downloads for
 * this plugin (id: curtis-ai-chat) to docs/metrics/downloads.csv.
 *
 * Data source (verified empirically 2026-10-08):
 *   https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugin-stats.json
 *   An object keyed by plugin id; each value carries a cumulative "downloads"
 *   total, an "updated" epoch-ms timestamp, and per-version download counts.
 *   (community-plugins.json in the same repo lists plugin metadata but has NO
 *   download counts. obsidian.md/plugins is an SPA, not a JSON API.)
 *
 * Behavior:
 *   - Appends exactly one row: date,downloads,version_downloads,plugin_version,plugin_updated_utc
 *   - Creates docs/metrics/downloads.csv with a header row if it does not exist.
 *   - Idempotent per UTC day: if today's date already has a row, nothing is
 *     appended and the script exits 0. This keeps the weekly CI commit loop
 *     finite (manual re-runs never produce duplicate rows).
 *
 * Usage: node scripts/fetch-plugin-stats.mjs
 *
 * No dependencies. Node >= 18 (global fetch). Network required.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATS_URL = 'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugin-stats.json';
const PLUGIN_ID = 'curtis-ai-chat';
const CSV_DIR = path.join(REPO_ROOT, 'docs', 'metrics');
const CSV_PATH = path.join(CSV_DIR, 'downloads.csv');
const CSV_HEADER = 'date,downloads,version_downloads,plugin_version,plugin_updated_utc';
const FETCH_TIMEOUT_MS = 30_000;

function fail(message) {
	console.error(`error: ${message}`);
	process.exit(1);
}

// ---- 1. Current plugin version (drives the per-version column) --------------

const manifest = JSON.parse(readFileSync(path.join(REPO_ROOT, 'manifest.json'), 'utf8'));
const { version } = manifest;
if (typeof version !== 'string') {
	fail('manifest.json is missing a string version');
}

// ---- 2. Fetch Obsidian's official plugin stats ------------------------------

let response;
try {
	response = await fetch(STATS_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
} catch (err) {
	fail(`cannot reach ${STATS_URL}: ${err.message}`);
}
if (!response.ok) {
	fail(`${STATS_URL} responded ${response.status} ${response.statusText}`);
}

let stats;
try {
	stats = JSON.parse(await response.text());
} catch (err) {
	fail(`response from ${STATS_URL} is not valid JSON: ${err.message}`);
}

// ---- 3. Extract this plugin's entry (fail loudly if absent) ------------------

const entry = stats[PLUGIN_ID];
if (entry === undefined) {
	fail(`${PLUGIN_ID} is not in the Obsidian community plugin stats yet`);
}
if (typeof entry.downloads !== 'number') {
	fail(`${PLUGIN_ID} entry has no numeric "downloads" field: ${JSON.stringify(entry).slice(0, 200)}`);
}
const versionDownloads = typeof entry[version] === 'number' ? entry[version] : 0;
const updatedUtc = typeof entry.updated === 'number' ? new Date(entry.updated).toISOString() : '';

// ---- 4. Append one row, unless today is already recorded ---------------------

const date = new Date().toISOString().slice(0, 10); // UTC date, matches cron
mkdirSync(CSV_DIR, { recursive: true });

const existing = existsSync(CSV_PATH) ? readFileSync(CSV_PATH, 'utf8') : '';

const lines = existing.split('\n').filter((line) => line.trim() !== '');
if (lines.some((line) => line.split(',')[0] === date)) {
	const recorded = lines.find((line) => line.split(',')[0] === date);
	console.log(`${date} already recorded in docs/metrics/downloads.csv (${recorded}) — nothing appended`);
	process.exit(0);
}

if (lines.length === 0) {
	appendFileSync(CSV_PATH, `${CSV_HEADER}\n`, 'utf8');
}

// Weekly delta for the summary line (vs. the previous snapshot row, if any).
const dataRows = lines.filter((line) => line.split(',')[0] !== 'date');
const lastRow = dataRows[dataRows.length - 1];
let deltaNote = '';
if (lastRow !== undefined) {
	const lastDownloads = Number.parseInt(lastRow.split(',')[1], 10);
	if (Number.isFinite(lastDownloads)) {
		deltaNote = `, +${entry.downloads - lastDownloads} since ${lastRow.split(',')[0]}`;
	}
}

appendFileSync(CSV_PATH, `${date},${entry.downloads},${versionDownloads},${version},${updatedUtc}\n`, 'utf8');
console.log(`recorded ${date}: ${PLUGIN_ID} ${entry.downloads} total downloads (v${version}: ${versionDownloads}${deltaNote}) -> docs/metrics/downloads.csv`);
