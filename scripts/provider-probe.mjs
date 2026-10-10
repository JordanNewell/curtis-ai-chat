// Provider-card + ribbon visual probe — boots the demo vault, screenshots
// the left ribbon (icon present + crisp) and the settings provider-config
// group at full resolution for layout review. Same contract as the other
// harness scripts. Usage: node scripts/provider-probe.mjs

import { spawn, execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VAULT = resolve(ROOT, 'demo-vault');
const DEBUG_PORT = 9338;
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

	setTimeout(() => { console.error('[probe] watchdog timeout'); relaunch(); process.exit(1); }, 150000);

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
	await sleep(1500);

	// 1. Ribbon icon — present and sized like its siblings?
	const ribbon = await page.evaluate(() => {
		const icons = [...document.querySelectorAll('.side-dock-ribbon-action, .workspace-ribbon-side .clickable-icon')];
		const curtis = icons.find((el) => el.getAttribute('aria-label') === 'Open Curtis AI');
		return {
			ribbonIcons: icons.length,
			curtisPresent: !!curtis,
			svg: curtis ? !!curtis.querySelector('svg') : false,
			w: curtis ? Math.round(curtis.getBoundingClientRect().width) : 0,
			h: curtis ? Math.round(curtis.getBoundingClientRect().height) : 0,
			label: curtis?.getAttribute('aria-label') ?? null,
		};
	});
	console.log('[ribbon]', JSON.stringify(ribbon));
	await page.screenshot({ path: resolve(ROOT, 'shots', 'ribbon-live.png'), clip: { x: 0, y: 0, width: 60, height: 900 } });

	// 2. Settings — provider configuration card, full-res.
	await page.evaluate(() => {
		window.app.setting.open();
		window.app.setting.openTabById('curtis-ai-chat');
	});
	await sleep(2500);
	const pages = ctx.pages();
	let target = null;
	for (const p of pages) {
		try {
			const n = await p.evaluate(() => document.querySelectorAll('.setting-item').length);
			if (n > 0) { target = p; break; }
		} catch { /* dead target */ }
	}
	const probe = target ?? page;
	const layout = await probe.evaluate(() => {
		// Every toggle in the tab: its row's name/desc text (bare = bug).
		const toggles = [...document.querySelectorAll('.curtis-settings .checkbox-container')].map((t) => {
			const row = t.closest('.setting-item');
			const name = row?.querySelector('.setting-item-name');
			const desc = row?.querySelector('.setting-item-description');
			const r = row?.getBoundingClientRect();
			return {
				name: name?.textContent?.trim() ?? '(NO NAME)',
				desc: desc?.textContent?.trim().slice(0, 40) ?? '',
				section: row?.closest('.setting-group')?.querySelector('.setting-item-heading .setting-item-name')?.textContent?.trim().slice(0, 24) ?? '?',
				top: r ? Math.round(r.top) : -1,
				nameVisible: !!name && getComputedStyle(name).display !== 'none' && name.getBoundingClientRect().height > 0,
			};
		});
		return { toggles };
	});
	console.log('[toggles]', JSON.stringify(layout, null, 1));
	await probe.screenshot({ path: resolve(ROOT, 'shots', 'provider-card-live.png'), fullPage: false });

	await browser.close();
	execSync('taskkill /IM Obsidian.exe /F', { stdio: 'ignore' });
	await sleep(1500);
	relaunch();
	console.log('[probe] done');
	process.exit(0);
} catch (e) {
	console.error('[probe] fatal:', e.message);
	relaunch();
	process.exit(1);
}
