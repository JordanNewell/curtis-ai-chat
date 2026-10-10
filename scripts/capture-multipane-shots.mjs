// Multi-pane screenshot captures for Curtis AI Chat.
//
// Same machinery as capture-arena-shots.mjs (real Obsidian on the demo vault,
// driven over CDP) but fully OFFLINE: responses come from a monkeypatched
// plugin.callAI, so no provider keys are touched. Produces:
//
//   multipane-tabs-{dark,light}.png — a note tab + two TITLED chat tabs in
//     the center tab strip, the active chat mid-conversation
//   multipane-menu-{dark,light}.png — the pane "..." menu open over a chat
//     tab, showing Rename conversation / Open new chat tab / Open chat in
//     new window
//
// These are the only shots that show the 2.0 multi-pane surface — titled
// tabs and the pane menu — which the older sets predate.
//
// Usage:  node scripts/capture-multipane-shots.mjs
// Env:    OBSIDIAN_EXE (default: scoop obsidian current)
//
// The user's running Obsidian is closed for the duration and relaunched at
// the end (same contract as npm run shots).

import { spawn, execSync } from 'node:child_process';
import { cpSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VAULT = resolve(ROOT, 'demo-vault');
const PLUGIN_DIR = resolve(VAULT, '.obsidian/plugins/curtis-ai-chat');
const OUT_DIR = resolve(ROOT, 'assets/screenshots');
const DOCS_OUT_DIR = resolve(ROOT, 'docs/assets/screenshots');
const PORT = 9345;

const OBSIDIAN_EXE =
	process.env.OBSIDIAN_EXE ||
	resolve(process.env.USERPROFILE ?? process.env.HOME, 'scoop/apps/obsidian/current/Obsidian.exe');

const THEMES = ['light', 'dark'];

function bootstrapVault() {
	mkdirSync(PLUGIN_DIR, { recursive: true });
	for (const f of ['main.js', 'manifest.json', 'styles.css']) {
		cpSync(resolve(ROOT, f), resolve(PLUGIN_DIR, f));
	}
	const obsidianDir = resolve(VAULT, '.obsidian');
	writeFileSync(resolve(obsidianDir, 'community-plugins.json'), JSON.stringify(['curtis-ai-chat']));
	if (!existsSync(resolve(obsidianDir, 'app.json'))) {
		writeFileSync(resolve(obsidianDir, 'app.json'), JSON.stringify({ livePreview: true, readableLineLength: true }));
	}
	// The note tab beside the chat tabs (created by arena runs too; idempotent).
	const note = resolve(VAULT, 'Daily/2026-10-02.md');
	if (!existsSync(note)) {
		mkdirSync(dirname(note), { recursive: true });
		writeFileSync(note, '- Shipped v1.1.0 — agent mode for every provider\n- Fixed the LM Studio key prompt bug (#6)\n');
	}
}

// --- obsidian.json vault-registry helpers (same contract as shots) ----------

let originalLaunchVault = null;

function registerDemoVault() {
	const p = resolve(process.env.APPDATA, 'obsidian', 'obsidian.json');
	let d = {};
	try { d = JSON.parse(readFileSync(p, 'utf8')); } catch { /* fresh */ }
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
		const d = JSON.parse(readFileSync(p, 'utf8'));
		const vaults = d.vaults || {};
		for (const v of Object.values(vaults)) {
			if (v && typeof v === 'object') v.open = false;
		}
		let restored = false;
		if (originalLaunchVault) {
			for (const v of Object.values(vaults)) {
				if (v && v.path === originalLaunchVault.path) { v.open = true; restored = true; break; }
			}
		}
		if (!restored) {
			for (const v of Object.values(vaults)) {
				if (v && v.path !== VAULT) { v.open = true; break; }
			}
		}
		writeFileSync(p, JSON.stringify(d, null, 2));
	} catch { /* best effort */ }
}

// --- boot + attach -----------------------------------------------------------

async function waitForDebugPort(port, ms) {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`http://127.0.0.1:${port}/json/version`);
			if (res.ok) return await res.json();
		} catch { /* not up yet */ }
		await new Promise((r) => setTimeout(r, 500));
	}
	return null;
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
		await new Promise((r) => setTimeout(r, 1000));
	}
	throw new Error(`timeout waiting for demo-vault page state: ${label}`);
}

async function killObsidian() {
	try { execSync('taskkill /IM Obsidian.exe /F', { stdio: 'ignore' }); } catch { /* not running */ }
	await new Promise((r) => setTimeout(r, 2500));
}

async function bootInstance() {
	const child = spawn(
		OBSIDIAN_EXE,
		[
			VAULT,
			`--remote-debugging-port=${PORT}`,
			'--disable-backgrounding-occluded-windows',
			'--disable-background-timer-throttling',
			'--disable-renderer-backgrounding',
		],
		{ detached: false, stdio: 'ignore' }
	);
	if (!(await waitForDebugPort(PORT, 25000))) { child.kill(); throw new Error('debug port never opened'); }
	let browser = null;
	for (let i = 0; i < 5 && !browser; i++) {
		try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); }
		catch { await new Promise((r) => setTimeout(r, 2500)); }
	}
	if (!browser) { child.kill(); throw new Error('could not attach to the debug port'); }
	const ctx = browser.contexts()[0];
	let page = await waitForVaultPage(ctx, () => true, 30000, 'window');
	try { await page.getByRole('button', { name: /trust/i }).click({ timeout: 8000 }); } catch { /* trusted */ }
	await page.evaluate(async () => {
		try { await window.app.plugins.enablePlugin('curtis-ai-chat'); } catch { /* already on */ }
	});
	page = await waitForVaultPage(
		ctx,
		() => !!window.app?.plugins?.plugins?.['curtis-ai-chat']?.conversationStore,
		45000,
		'plugin onload'
	);
	return { child, browser, ctx, page };
}

async function shutdownInstance(instance) {
	if (!instance) return;
	try { await instance.browser.close(); } catch { /* already dead */ }
	try { instance.child.kill(); } catch { /* already dead */ }
	await killObsidian();
}

// --- scene -------------------------------------------------------------------

/** Deterministic offline AI — same trick as smoke-panes, no keys touched. */
const installFakeAI = () => {
	const plugin = window.app.plugins.plugins['curtis-ai-chat'];
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
	plugin.callAI = async (messages, _modelId, cb = {}) => {
		await sleep(120);
		const text = messages.filter((m) => m.role === 'user').pop()?.content ?? '';
		const body = String(text).includes('sync script')
			? 'The loop closes the file before the last write lands — the final iteration writes into a closed handle and the error is swallowed by the retry wrapper. Move the close after the loop and the dropped file comes back.'
			: '- Multi-pane chat — two titled chats, each with its own model\n- Chat import — bring ChatGPT and Claude history in as vault files\n- Memory with provenance — every fact shows the chat it came from\n\nClose with the upgrade line: "One sidebar, every model — now side by side."';
		for (const piece of [body.slice(0, Math.ceil(body.length / 2)), body.slice(Math.ceil(body.length / 2))]) {
			cb.onChunk?.(piece);
			await sleep(60);
		}
	};
	return true;
};

/** Build the tab strip: note tab first, then two titled chat tabs. */
const buildScene = async () => {
	const app = window.app;
	const plugin = app.plugins.plugins['curtis-ai-chat'];
	plugin.settings.enableMemory = false;
	plugin.settings.enableRag = false;
	plugin.settings.activeProvider = 'ollama';
	plugin.settings.activeModel = 'qwen3:8b';
	plugin.saveSettings();

	// Normalise: drop every chat leaf and center split from earlier runs.
	const root = app.workspace.rootSplit;
	for (const child of (root.children ?? []).slice(1)) child.detach?.();
	for (const l of app.workspace.getLeavesOfType('curtis-chat')) l.detach();

	// A note tab so the strip reads lived-in: [note] [chat] [chat].
	const file = app.vault.getAbstractFileByPath('Daily/2026-10-02.md');
	const noteLeaf = app.workspace.getLeaf(false);
	if (file) await noteLeaf.openFile(file);

	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
	const views = [];
	for (const [prompt, title] of [
		['Draft three bullet points for the Curtis 2.0 launch post', 'Launch post draft'],
		['Why does my sync script drop the last file in the folder?', 'Sync script bug'],
	]) {
		app.commands.executeCommandById('curtis-ai-chat:open-new-chat-tab');
		const deadline = Date.now() + 10000;
		while (Date.now() < deadline) {
			const last = app.workspace.getLeavesOfType('curtis-chat').pop()?.view;
			if (last && last.contentEl?.querySelector('.ai-chat-input-wrap')) { views.push(last); break; }
			await sleep(200);
		}
		const v = views[views.length - 1];
		v.inputEl.value = prompt;
		await v.sendMessage();
		plugin.conversationStore.renameCurrentConversation(title, v.conversationId);
	}
	// Face the first chat for the tab-strip shots.
	app.workspace.setActiveLeaf(views[0].leaf);
	await sleep(400);
	return { chatCount: app.workspace.getLeavesOfType('curtis-chat').length };
};

/** Flip Obsidian's theme classes in-session (nothing persists). */
const setBodyTheme = (theme) => {
	document.body.classList.remove('theme-light', 'theme-dark', 'theme-type-light', 'theme-type-dark');
	document.body.classList.add(`theme-${theme}`, `theme-type-${theme}`);
	return true;
};

/** Locate the ACTIVE leaf's "..." button — synthetic DOM clicks don't open
 *  Obsidian menus, so the Node side clicks it with a real mouse event. */
const findMenuButton = () => {
	const scope = document.querySelector('.workspace-leaf.mod-active') ?? document;
	const btn = scope.querySelector('.view-action[aria-label="More options"]')
		|| scope.querySelector('.mod-more-options');
	if (!btn) return null;
	const r = btn.getBoundingClientRect();
	return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
};

const menuIsOpen = () => {
	const menu = document.querySelector('.menu');
	return !!menu && menu.textContent.includes('Rename conversation');
};

const closeMenus = () => {
	for (const m of document.querySelectorAll('.menu')) m.remove();
	document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
	return true;
};

async function main() {
	bootstrapVault();
	registerDemoVault();
	await killObsidian();
	let instance = null;
	try {
		instance = await bootInstance();
		const { page } = instance;

		await page.evaluate(installFakeAI);
		const scene = await page.evaluate(buildScene);
		console.log(`[multipane] scene built: ${scene.chatCount} chat tabs`);
		if (scene.chatCount < 2) throw new Error('expected two chat tabs');

		for (const theme of THEMES) {
			await page.evaluate(setBodyTheme, theme);
			await page.evaluate(closeMenus);
			await page.waitForTimeout(400);
			await page.screenshot({ path: resolve(OUT_DIR, `multipane-tabs-${theme}.png`) });
			console.log(`[multipane] tabs-${theme} captured`);

			const pos = await page.evaluate(findMenuButton);
			if (!pos) throw new Error('more-options button not found on the active leaf');
			await page.mouse.click(pos.x, pos.y);
			await page.waitForFunction(menuIsOpen, null, { timeout: 5000 })
				.catch(() => { throw new Error('pane menu never showed Rename conversation'); });
			await page.waitForTimeout(300);
			await page.screenshot({ path: resolve(OUT_DIR, `multipane-menu-${theme}.png`) });
			console.log(`[multipane] menu-${theme} captured`);
		}

		for (const f of ['multipane-tabs-dark', 'multipane-tabs-light', 'multipane-menu-dark', 'multipane-menu-light']) {
			cpSync(resolve(OUT_DIR, `${f}.png`), resolve(DOCS_OUT_DIR, `${f}.png`));
		}
		console.log('[multipane] done — assets in assets/screenshots/ (+ docs copies)');
	} finally {
		await shutdownInstance(instance);
		restoreLaunchVault();
		if (originalLaunchVault) {
			spawn(OBSIDIAN_EXE, [originalLaunchVault.path], { detached: true, stdio: 'ignore' }).unref();
		}
	}
}

main().catch((err) => {
	console.error(`[multipane] fatal: ${err.message}`);
	restoreLaunchVault();
	process.exit(1);
});
