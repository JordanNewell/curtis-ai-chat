// Settings-pane live inspection — boots the demo vault, opens the Curtis
// settings tab, and dumps the facts that decide whether the round-2 settings
// design system is actually applying: container classes, computed row
// padding, the real group-heading class name, readouts, plus a screenshot.
// Same contract as theme-audit: closes running Obsidian, relaunches at end.
//
// Usage: node scripts/settings-inspect.mjs

import { spawn, execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VAULT = resolve(ROOT, 'demo-vault');
const DEBUG_PORT = 9337;
const OBSIDIAN_EXE =
	process.env.OBSIDIAN_EXE ||
	resolve(process.env.USERPROFILE ?? process.env.HOME, 'scoop/apps/obsidian/current/Obsidian.exe');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDebugPort(ms) {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
			if (res.ok) return true;
		} catch { /* not yet */ }
		await sleep(500);
	}
	return false;
}

function relaunch() {
	try { spawn(OBSIDIAN_EXE, [VAULT], { detached: true, stdio: 'ignore' }).unref(); } catch { /* */ }
}

try {
	try { execSync('taskkill /IM Obsidian.exe /F', { stdio: 'ignore' }); } catch { /* not running */ }
	await sleep(2500);

	const child = spawn(OBSIDIAN_EXE, [
		VAULT,
		`--remote-debugging-port=${DEBUG_PORT}`,
		'--window-size=1500,1000',
		'--window-position=40,40',
	], { detached: false, stdio: 'ignore' });

	if (!(await waitForDebugPort(25000))) { child.kill(); throw new Error('debug port never opened'); }
	let browser = null;
	for (let i = 0; i < 5 && !browser; i++) {
		try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`); }
		catch { await sleep(2500); }
	}
	if (!browser) { child.kill(); throw new Error('could not attach'); }
	const ctx = browser.contexts()[0];
	const page = ctx.pages().find((p) => p.url()) ?? ctx.pages()[0];

	setTimeout(() => { console.error('[inspect] watchdog timeout'); relaunch(); process.exit(1); }, 120000);

	const deadline = Date.now() + 30000;
	while (Date.now() < deadline) {
		try {
			if (await page.evaluate(() => window.app?.vault?.getName?.() === 'demo-vault')) break;
		} catch { /* retry */ }
		await sleep(1000);
	}
	try { await page.getByRole('button', { name: /trust/i }).click({ timeout: 5000 }); } catch { /* trusted */ }

	await page.evaluate(async () => {
		try { await window.app.plugins.enablePlugin('curtis-ai-chat'); } catch { /* on */ }
	});
	await sleep(1200);

	// Open settings on the Curtis tab.
	const openErr = await page.evaluate(() => {
		try {
			window.app.setting.open();
			window.app.setting.openTabById('curtis-ai-chat');
			return null;
		} catch (e) { return String(e); }
	});
	await sleep(3000);

	// Settings may render in its own window/target — find where it lives.
	const pages = ctx.pages();
	console.log('[inspect] targets:', JSON.stringify(pages.map((p) => p.url().slice(0, 60))));
	let target = null;
	for (const p of pages) {
		try {
			const n = await p.evaluate(() => document.querySelectorAll('.setting-item, .vertical-tab-content, .settings-modal').length);
			console.log('[inspect] target settings nodes:', n, p.url().slice(0, 60));
			if (n > 0) { target = p; break; }
		} catch { /* dead target */ }
	}
	const probe = target ?? page;

	const facts = await probe.evaluate(() => {
		const vtc = document.querySelector('.vertical-tab-content');
		return {
			openErr: null,
			vtcClass: vtc?.className,
			vtcInDoc: !!vtc,
			curtisAnywhere: [...document.querySelectorAll('[class*="curtis"]')].slice(0, 6).map((e) => e.tagName + '.' + String(e.className).slice(0, 60)),
			activeTabText: (document.querySelector('.modal-sidebar .active, .vertical-tab-nav .active')?.textContent || '').slice(0, 30),
			settingItems: document.querySelectorAll('.setting-item').length,
			groups: document.querySelectorAll('.setting-group').length,
			headings: [...document.querySelectorAll('.setting-item-heading')].slice(0, 5).map((h) => (h.textContent || '').slice(0, 24)),
		};
	});
	facts.openErr = openErr;
	console.log(JSON.stringify(facts, null, 2));

	await probe.screenshot({ path: resolve(ROOT, "shots", "settings-live.png"), clip: { x: 300, y: 80, width: 900, height: 850 } });
	console.log('[inspect] screenshot: shots/settings-live.png');

	await browser.close();
	execSync('taskkill /IM Obsidian.exe /F', { stdio: 'ignore' });
	await sleep(1500);
	relaunch();
	console.log('[inspect] done');
	process.exit(0);
} catch (e) {
	console.error('[inspect] fatal:', e.message);
	relaunch();
	process.exit(1);
}
