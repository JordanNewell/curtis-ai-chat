// Theme × Generation-rows probe — switches the demo vault through every
// installed community theme and, in each, measures the Generation group's
// last two rows ('Stream responses', 'Show token usage'): does the label
// render visibly (height + readable color)? Boots fresh; relaunches at end.
// Usage: node scripts/gen-rows-theme-check.mjs

import { spawn, execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VAULT = resolve(ROOT, 'demo-vault');
const DEBUG_PORT = 9340;
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

	setTimeout(() => { console.error('[gen-check] watchdog timeout'); relaunch(); process.exit(1); }, 420000);

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

	const measure = () => probe.evaluate(() => {
		const rows = [...document.querySelectorAll('.curtis-settings .setting-item')];
		const pick = (label) => rows.filter((r) => (r.querySelector('.setting-item-name')?.textContent || '').trim() === label)[0];
		const readRow = (row) => {
			if (!row) return { found: false };
			const name = row.querySelector('.setting-item-name');
			const desc = row.querySelector('.setting-item-description');
			const info = row.querySelector('.setting-item-info');
			const r = row.getBoundingClientRect();
			const nRect = name?.getBoundingClientRect();
			const cs = name ? getComputedStyle(name) : null;
			return {
				found: true,
				nameText: name?.textContent?.trim() ?? null,
				nameH: nRect ? Math.round(nRect.height) : 0,
				nameW: nRect ? Math.round(nRect.width) : 0,
				infoW: info ? Math.round(info.getBoundingClientRect().width) : 0,
				rowH: Math.round(r.height),
				color: cs?.color ?? null,
				fontSize: cs?.fontSize ?? null,
				display: cs?.display ?? null,
				visibility: cs?.visibility ?? null,
				descText: desc?.textContent?.trim().slice(0, 30) ?? null,
			};
		};
		return {
			stream: readRow(pick('Stream responses')),
			token: readRow(pick('Show token usage')),
			instructions: readRow(pick('Additional instructions')),
		};
	});

	const themes = [''].concat(readdirSync(resolve(VAULT, '.obsidian/themes')));
	for (const t of themes) {
		try {
			await probe.evaluate((name) => {
				const c = window.app.customCss ?? window.app.customCSS;
				if (c?.setTheme) return c.setTheme(name || '');
				if (c?.requestLoadTheme) return c.requestLoadTheme(name || '');
				return false;
			}, t);
		} catch { /* switch best-effort */ }
		await sleep(900);
		const m = await measure();
		console.log(`[theme=${t || 'default'}]`, JSON.stringify(m));
	}

	await browser.close();
	execSync('taskkill /IM Obsidian.exe /F', { stdio: 'ignore' });
	await sleep(1500);
	relaunch();
	console.log('[gen-check] done');
	process.exit(0);
} catch (e) {
	console.error('[gen-check] fatal:', e.message);
	relaunch();
	process.exit(1);
}
