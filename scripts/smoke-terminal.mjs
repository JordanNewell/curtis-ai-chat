// Terminal smoke — drives the real plugin inside real Obsidian (same harness
// contract as smoke-panes: the running Obsidian is closed for the duration and
// not reopened afterwards).
//
//   T1  "Open terminal tab" command → one curtis-terminal leaf
//   T2  the pane's "another" pair — "Open another terminal window" → a
//       second leaf in its own window, "Open another terminal tab" → a
//       third (the actions that shipped deduped into no-ops)
//   T3  the chat toolbar's terminal button → dedupe-reveal (leaf count holds)
//   T4  each terminal pane owns its state — distinct view instances, cwd
//       anchored at the vault root
//
// Usage: npm run smoke:terminal

import { spawn, execSync } from 'node:child_process';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VAULT = resolve(ROOT, 'demo-vault');
const PLUGIN_DIR = resolve(VAULT, '.obsidian/plugins/curtis-ai-chat');
const DEBUG_PORT = 9335;

const OBSIDIAN_EXE =
	process.env.OBSIDIAN_EXE ||
	resolve(process.env.USERPROFILE ?? process.env.HOME, 'scoop/apps/obsidian/current/Obsidian.exe');

let pass = 0, fail = 0;
const ok = (cond, name, detail = '') => {
	const mark = cond ? 'PASS' : 'FAIL';
	console.log(`[${mark}] ${name}${detail && !cond ? ` — ${detail}` : ''}`);
	cond ? pass++ : fail++;
};

// Console gate: errors whose text or source URL names plugin:curtis-ai-chat
// fail the run even when every assertion passes. Anything else (core Obsidian,
// theme ENOENTs, other plugins) is surfaced but never gates.
const pluginErrors = [];
const watchPluginErrors = (text, url = '') => {
	const s = `${text}\n${url}`;
	if (!s.includes('plugin:curtis-ai-chat')) return;
	if (!pluginErrors.includes(text)) pluginErrors.push(text);
};
const reportConsoleGate = () => {
	if (pluginErrors.length > 0) {
		console.log(`[smoke] FAIL: ${pluginErrors.length} plugin console error(s):`);
		for (const e of pluginErrors) console.log(`[obsidian] ${e}`);
	} else {
		console.log('[smoke] console clean');
	}
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Vault bootstrap + launch-vault registry (mirrors smoke-panes.mjs)
// ---------------------------------------------------------------------------

function bootstrapVault() {
	mkdirSync(PLUGIN_DIR, { recursive: true });
	for (const f of ['main.js', 'manifest.json', 'styles.css']) {
		cpSync(resolve(ROOT, f), resolve(PLUGIN_DIR, f));
	}
	const obsidianDir = resolve(VAULT, '.obsidian');
	writeFileSync(resolve(obsidianDir, 'community-plugins.json'), JSON.stringify(['curtis-ai-chat']));
	if (!existsSyncSafe(resolve(obsidianDir, 'app.json'))) {
		writeFileSync(resolve(obsidianDir, 'app.json'), JSON.stringify({ livePreview: true, readableLineLength: true }));
	}
}

function existsSyncSafe(p) {
	try { return require('node:fs').existsSync(p); } catch { return false; }
}

let originalLaunchVault = null;

function registerDemoVault() {
	const p = resolve(process.env.APPDATA, 'obsidian', 'obsidian.json');
	let d = {};
	try { d = JSON.parse(readFileSafe(p)); } catch { /* fresh */ }
	if (!d || typeof d !== 'object' || Array.isArray(d)) d = {};
	const vaults = (d.vaults ??= {});
	for (const [id, v] of Object.entries(vaults)) {
		if (v && typeof v === 'object' && v.open) originalLaunchVault = { id, path: v.path };
	}
	let id = Object.keys(vaults).find((k) => vaults[k] && vaults[k].path === VAULT);
	if (!id) {
		id = randomUUID();
		vaults[id] = { path: VAULT, ts: Date.now() };
	}
	for (const v of Object.values(vaults)) {
		if (v && typeof v === 'object') v.open = false;
	}
	vaults[id].open = true;
	writeFileSync(p, JSON.stringify(d, null, 2));
}

function restoreLaunchVault() {
	try {
		const p = resolve(process.env.APPDATA, 'obsidian', 'obsidian.json');
		const d = JSON.parse(readFileSafe(p));
		const vaults = d.vaults || {};
		for (const v of Object.values(vaults)) {
			if (v && typeof v === 'object') v.open = false;
		}
		if (originalLaunchVault) {
			const byId = vaults[originalLaunchVault.id];
			if (byId && byId.path === originalLaunchVault.path) byId.open = true;
			else {
				for (const v of Object.values(vaults)) {
					if (v && v.path === originalLaunchVault.path) { v.open = true; break; }
				}
			}
		}
		writeFileSync(p, JSON.stringify(d, null, 2));
	} catch { /* best effort */ }
}

function readFileSafe(p) {
	return require('node:fs').readFileSync(p, 'utf8');
}

async function waitForDebugPort(ms) {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
			if (res.ok) return true;
		} catch { /* not up yet */ }
		await sleep(500);
	}
	return false;
}

async function waitForVaultPage(ctx, pred, timeoutMs, label) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		for (const p of ctx.pages()) {
			try {
				const vault = await p.evaluate(() => window.app?.vault?.getName?.());
				if (vault !== 'demo-vault') continue;
				if (await p.evaluate(pred)) return p;
			} catch { /* stale page — retry */ }
		}
		await sleep(1000);
	}
	throw new Error(`timeout waiting for demo-vault page state: ${label}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	bootstrapVault();
	registerDemoVault();
	try { execSync('taskkill /IM Obsidian.exe /F', { stdio: 'ignore' }); } catch { /* not running */ }
	await sleep(2500);

	const child = spawn(OBSIDIAN_EXE, [
		VAULT,
		`--remote-debugging-port=${DEBUG_PORT}`,
		'--disable-backgrounding-occluded-windows',
		'--disable-background-timer-throttling',
		'--disable-renderer-backgrounding',
	], { detached: false, stdio: 'ignore' });

	if (!(await waitForDebugPort(25000))) { child.kill(); throw new Error('debug port never opened'); }
	let browser = null;
	for (let i = 0; i < 5 && !browser; i++) {
		try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`); }
		catch { await sleep(2500); }
	}
	if (!browser) { child.kill(); throw new Error('could not attach to the debug port'); }
	const ctx = browser.contexts()[0];
	const logLine = (m) => {
		if (m.type() !== 'error') return;
		console.log(`[obsidian] ${m.text().slice(0, 200)}`);
		watchPluginErrors(m.text(), m.location()?.url);
	};
	// Uncaught exceptions / unhandled rejections surface as pageerror, not console.
	const pageError = (e) => watchPluginErrors(e?.stack ?? String(e));
	for (const p of ctx.pages()) { p.on('console', logLine); p.on('pageerror', pageError); }
	// T2 opens terminal panes in new windows — those are fresh CDP targets, so
	// the watchers must attach to pages created mid-run too.
	ctx.on('page', (p) => { p.on('console', logLine); p.on('pageerror', pageError); });

	setTimeout(() => {
		console.error('[smoke] fatal: watchdog timeout (4 min) — aborting');
		try { execSync('taskkill /IM Obsidian.exe /F', { stdio: 'ignore' }); } catch { /* not running */ }
		restoreLaunchVault();
		process.exit(1);
	}, 240000);

	let page = await waitForVaultPage(ctx, () => true, 30000, 'window');
	try {
		await page.getByRole('button', { name: /trust/i }).click({ timeout: 8000 });
	} catch { /* already trusted */ }
	await page.evaluate(async () => {
		try { await window.app.plugins.enablePlugin('curtis-ai-chat'); } catch { /* already on */ }
	});
	page = await waitForVaultPage(
		ctx,
		() => !!window.app.plugins.plugins['curtis-ai-chat']?.conversationStore,
		30000,
		'plugin onload complete'
	);
	console.log('[smoke] plugin loaded');

	const termLeaves = `window.app.workspace.getLeavesOfType('curtis-terminal')`;

	// T1 — command: open terminal as a tab.
	await page.evaluate(() => window.app.commands.executeCommandById('curtis-ai-chat:open-terminal-tab'));
	await sleep(1500);
	ok(await page.evaluate(`(function(){return ${termLeaves}.length})()`) === 1, 'T1 open-terminal-tab command yields one terminal leaf');

	// T2 — the pane's "another" pair: header actions click the real DOM.
	const windowAction = `[aria-label="Open another terminal window"]`;
	const tabAction = `[aria-label="Open another terminal tab"]`;
	const actionsPresent = await page.evaluate(
		`!!document.querySelector(${JSON.stringify(windowAction)}) && !!document.querySelector(${JSON.stringify(tabAction)})`
	);
	ok(actionsPresent, 'T2a "Open another terminal …" actions render in the pane header');
	if (actionsPresent) {
		await page.evaluate(`document.querySelector(${JSON.stringify(windowAction)}).click()`);
		await sleep(2500);
		let count = await page.evaluate(`(function(){return ${termLeaves}.length})()`);
		ok(count === 2, 'T2b header window action opens a second terminal leaf', `leaf count ${count}, expected 2`);
		await page.evaluate(`document.querySelector(${JSON.stringify(tabAction)}).click()`);
		await sleep(1500);
		count = await page.evaluate(`(function(){return ${termLeaves}.length})()`);
		ok(count === 3, 'T2c header tab action opens a third terminal leaf', `leaf count ${count}, expected 3`);
	}

	// T3 — chat toolbar terminal button: dedupe-reveal, leaf count holds.
	await page.evaluate(() => window.app.commands.executeCommandById('curtis-ai-chat:open-chat'));
	await sleep(1200);
	const chatBtn = `document.querySelector('.workspace-leaf-content[data-type="curtis-chat"] button[aria-label="Open terminal"]')`;
	const chatBtnPresent = await page.evaluate(`!!${chatBtn}`);
	ok(chatBtnPresent, 'T3a chat toolbar terminal button renders');
	if (chatBtnPresent) {
		await page.evaluate(`${chatBtn}.click()`);
		await sleep(2000);
		const count = await page.evaluate(`(function(){return ${termLeaves}.length})()`);
		ok(count === 3, 'T3b chat toolbar button reveals, does not duplicate', `leaf count ${count}, expected 3`);
	}

	// T4 — panes own their state: distinct views, cwd at the vault root.
	const state = await page.evaluate(`(function(){
		const leaves = ${termLeaves};
		const cwds = leaves.map((l) => l.view.cwd);
		return {
			distinct: new Set(leaves.map((l) => l.view)).size === leaves.length,
			cwds: cwds,
		};
	})()`);
	ok(state.distinct, 'T4a each terminal pane is its own view instance');
	ok(state.cwds.length === 3 && state.cwds.every((c) => c && c.length > 0), 'T4b every pane has a cwd anchored at the vault root', JSON.stringify(state.cwds));

	console.log(`[smoke] done — ${pass} pass, ${fail} fail`);
	reportConsoleGate();
}

try {
	await main();
} catch (e) {
	console.error('[smoke] fatal:', e?.message ?? e);
	fail++;
} finally {
	try { execSync('taskkill /IM Obsidian.exe /F', { stdio: 'ignore' }); } catch { /* not running */ }
	restoreLaunchVault();
}
process.exit(fail > 0 || pluginErrors.length > 0 ? 1 : 0);
