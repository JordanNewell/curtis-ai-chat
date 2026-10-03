#!/usr/bin/env node
/**
 * site-sync.mjs — one-way sync of version/platform tokens from manifest.json
 * into the GitHub Pages site (docs/index.html).
 *
 * Contract:
 *   - data-sync="version" nodes get the manifest version as their text.
 *   - data-sync="platform-floor" nodes get "<floor>+" (e.g. "1.13+").
 *   - JSON-LD "softwareVersion" and "operatingSystem" ("Obsidian <floor>+")
 *     are rewritten in place.
 *
 * Invariants:
 *   - versions.json[manifest.version] must exist and equal manifest.minAppVersion
 *     (hard repo invariant; checked before anything is written).
 *   - The page must carry the sync contract at all. A page with zero data-sync
 *     nodes and zero JSON-LD version keys fails loudly instead of passing silently.
 *
 * Usage: node scripts/site-sync.mjs [--file <html-path>]
 *   --file overrides the target page (default docs/index.html) for testing.
 *   manifest.json / versions.json are always read from the repo root.
 *
 * No dependencies. Node >= 18.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_TARGET = path.join(REPO_ROOT, 'docs', 'index.html');

function fail(message) {
	console.error(`error: ${message}`);
	process.exit(1);
}

function parseArgs(argv) {
	let target = DEFAULT_TARGET;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--file') {
			const value = argv[i + 1];
			if (!value) fail('--file requires a path argument');
			target = path.resolve(value);
			i++;
		} else if (arg.startsWith('--file=')) {
			target = path.resolve(arg.slice('--file='.length));
		} else if (arg === '--help' || arg === '-h') {
			console.log('usage: node scripts/site-sync.mjs [--file <html-path>]');
			process.exit(0);
		} else {
			fail(`unknown argument: ${arg}`);
		}
	}
	return target;
}

// ---- 1. Hard invariant: manifest.json <-> versions.json --------------------

const manifest = JSON.parse(readFileSync(path.join(REPO_ROOT, 'manifest.json'), 'utf8'));
const versionsMap = JSON.parse(readFileSync(path.join(REPO_ROOT, 'versions.json'), 'utf8'));

const { version, minAppVersion } = manifest;
if (typeof version !== 'string' || typeof minAppVersion !== 'string') {
	fail('manifest.json is missing a string version or minAppVersion');
}
const mappedFloor = versionsMap[version];
if (mappedFloor === undefined) {
	fail(`versions.json has no entry for ${version}. Run \`npm run version\` (which bumps manifest.json and versions.json together) before syncing the site.`);
}
if (mappedFloor !== minAppVersion) {
	fail(`versions.json[${version}] says "${mappedFloor}" but manifest.json minAppVersion is "${minAppVersion}". Fix the mismatch before syncing the site.`);
}

// Floor display token: "1.13.0" -> "1.13+", "1.13.2" -> "1.13.2+"
const floorBase = minAppVersion.endsWith('.0') ? minAppVersion.slice(0, -2) : minAppVersion;
const floorToken = `${floorBase}+`;

// ---- 2. Read the page -------------------------------------------------------

const target = parseArgs(process.argv.slice(2));
let html;
try {
	html = readFileSync(target, 'utf8');
} catch (err) {
	fail(`cannot read ${target}: ${err.message}`);
}

const changes = [];
let markers = 0;

// ---- 2a. data-sync nodes: replace inner text only, keep tag + attributes ----

for (const [attr, value] of [['version', version], ['platform-floor', floorToken]]) {
	const re = new RegExp(`<([a-z]+)([^>]*\\sdata-sync="${attr}"[^>]*)>([^<]*)<`, 'gi');
	html = html.replace(re, (whole, tag, attrs, text) => {
		markers++;
		if (/\/\s*$/.test(attrs)) return whole; // self-closing tag: no inner text to sync
		if (text !== value) changes.push([`data-sync="${attr}"`, text, value]);
		return `<${tag}${attrs}>${value}<`;
	});
}

// ---- 2b. JSON-LD keys --------------------------------------------------------

html = html.replace(/("softwareVersion"\s*:\s*")([^"]*)(")/g, (whole, pre, old, post) => {
	markers++;
	if (old !== version) changes.push(['JSON-LD "softwareVersion"', old, version]);
	return `${pre}${version}${post}`;
});

html = html.replace(/("operatingSystem"\s*:\s*")(Obsidian [^"]*)(")/g, (whole, pre, old, post) => {
	markers++;
	const value = `Obsidian ${floorToken}`;
	if (old !== value) changes.push(['JSON-LD "operatingSystem"', old, value]);
	return `${pre}${value}${post}`;
});

// ---- 3. Missing contract: fail loudly, never pass silently -------------------

if (markers === 0) {
	console.error(`warning: ${target} carries no sync contract.`);
	console.error('Found zero data-sync="version"/"platform-floor" nodes and zero JSON-LD softwareVersion/operatingSystem keys.');
	console.error('The page may be mid-edit (markers not added yet). Nothing was written and this is not "in sync".');
	process.exit(1);
}

// ---- 4. Write only when something changed ------------------------------------

if (changes.length === 0) {
	console.log('site tokens in sync');
	process.exit(0);
}

writeFileSync(target, html, 'utf8');
const displayPath = path.relative(process.cwd(), target) || target;
console.log(`synced ${changes.length} token(s) in ${displayPath}:`);
for (const [name, from, to] of changes) {
	console.log(`  ${name}: "${from}" -> "${to}"`);
}
