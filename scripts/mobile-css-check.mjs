// Mobile CSS verification — the closest a desktop can get to a phone check.
// Boots the demo vault Obsidian over CDP, shrinks the window to a 390px-class
// width, enables touch emulation so (hover: none) media actually matches,
// then measures the round-2 mobile rules in the live composer:
//   M1  icon buttons 40px + hit-slop, send/abort 44px (the container-query
//       specificity bug this run fixed)
//   M3  safe-area inset present in composer/scrollback padding
// Same harness contract as theme-audit: closes running Obsidian; relaunches
// the vault (no debug port) at the end so the user finds it open.
//
// Usage: node scripts/mobile-css-check.mjs

import { spawn, execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VAULT = resolve(ROOT, 'demo-vault');
const DEBUG_PORT = 9336;
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

const results = [];
const check = (name, ok, detail) => {
	results.push({ name, ok });
	console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
};

try {
	try { execSync('taskkill /IM Obsidian.exe /F', { stdio: 'ignore' }); } catch { /* not running */ }
	await sleep(2500);

	const child = spawn(OBSIDIAN_EXE, [
		VAULT,
		`--remote-debugging-port=${DEBUG_PORT}`,
		'--window-size=430,900',
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

	setTimeout(() => { console.error('[mobile-check] watchdog timeout'); relaunch(); process.exit(1); }, 120000);

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

	// Phone-sized viewport via page-level emulation — this Electron build does
	// not expose browser-level Browser.getWindowForTarget / Browser.setWindowBounds.
	const cdp = await ctx.newCDPSession(page);
	await cdp.send('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 1, mobile: false });

	// Touch as the primary pointer — this is what makes (hover: none) match.
	await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

	// Open a chat pane.
	await page.evaluate(() => window.app.commands.executeCommandById('curtis-ai-chat:open-chat'));
	await sleep(2000);

	const m = await page.evaluate(() => {
		const out = {};
		out.hoverNone = matchMedia('(hover: none)').matches;
		out.viewW = window.innerWidth;
		const q = (s) => document.querySelector(s);
		const cs = (el) => (el ? getComputedStyle(el) : null);
		const icon = q('.ai-chat-view .ai-composer .ai-chat-icon-btn');
		out.icon = icon ? { w: cs(icon).width, h: cs(icon).height } : null;
		out.iconAfter = icon ? getComputedStyle(icon, '::after').content : null;
		const send = q('.ai-chat-view .ai-composer .ai-chat-send-btn');
		out.send = send ? { w: cs(send).width, h: cs(send).height } : null;
		const area = q('.ai-chat-view .ai-chat-input-area');
		out.areaPadBottom = area ? cs(area).paddingBottom : null;
		const scroll = q('.ai-chat-view .ai-chat-messages');
		out.scrollPadBottom = scroll ? cs(scroll).paddingBottom : null;
		out.paneW = document.querySelector('.ai-chat-view')?.getBoundingClientRect().width ?? null;
		return out;
	});

	check('touch emulation active ((hover: none) matches)', m.hoverNone === true);
	check('pane at phone width', m.paneW != null && m.paneW <= 460, `pane ${Math.round(m.paneW)}px`);
	check('M1 composer icon buttons 40px', m.icon?.w === '40px' && m.icon?.h === '40px', m.icon ? `${m.icon.w}x${m.icon.h}` : 'not found');
	check('M1 hit-slop ::after present', !!m.iconAfter && m.iconAfter !== 'none', String(m.iconAfter));
	check('M1 send/abort 44px', m.send?.w === '44px' && m.send?.h === '44px', m.send ? `${m.send.w}x${m.send.h}` : 'not found');
	check('M3 safe-area in composer padding', typeof m.areaPadBottom === 'string' && m.areaPadBottom.includes('safe-area') === false && parseFloat(m.areaPadBottom) >= 12, `resolved ${m.areaPadBottom} (calc with env() resolves when inset is 0 on desktop)`);

	await browser.close();
	execSync('taskkill /IM Obsidian.exe /F', { stdio: 'ignore' });
	await sleep(1500);
	relaunch();

	const failed = results.filter((r) => !r.ok).length;
	console.log(`\n[mobile-check] ${results.length - failed} passed, ${failed} failed`);
	process.exit(failed ? 1 : 0);
} catch (e) {
	console.error('[mobile-check] fatal:', e.message);
	relaunch();
	process.exit(1);
}
