// Fine-tooth settings audit — boots the demo vault, opens the Curtis
// settings tab, and for every .setting-group checks the three failure
// signatures from the round of flex-smear fixes: (1) sibling .setting-item
// rows smeared side-by-side at narrow widths, plus any control-bearing row
// under 100px; (2) bare controls (checkbox/select/input/button) whose row
// has no visible label; (3) .setting-item-control horizontal overflow.
// Then screenshots the tab at 4 scroll positions and does a chat-view
// sanity shot (open-chat command, topbar-tools button count).
// Same contract as provider-probe: kills running Obsidian, boots demo-vault
// over CDP, relaunches Obsidian at the end. Usage: node scripts/fine-tooth.mjs

import { spawn, execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VAULT = resolve(ROOT, 'demo-vault');
const DEBUG_PORT = 9339;
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

	setTimeout(() => { console.error('[fine-tooth] watchdog timeout'); relaunch(); process.exit(1); }, 240000);

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

	// Open the Curtis settings tab.
	await page.evaluate(() => {
		window.app.setting.open();
		window.app.setting.openTabById('curtis-ai-chat');
	});
	await sleep(2500);
	const pages = ctx.pages();
	let target = null;
	for (const p of pages) {
		try {
			const n = await p.evaluate(() => document.querySelectorAll('.curtis-settings .setting-group').length);
			if (n > 0) { target = p; break; }
		} catch { /* dead target */ }
	}
	const probe = target ?? page;

	// --- Per-group fine-tooth audit, all in-page for consistency ---
	const report = await probe.evaluate(() => {
		const fmt = (el) => {
			const r = el.getBoundingClientRect();
			return `w=${Math.round(r.width)} h=${Math.round(r.height)} top=${Math.round(r.top)}`;
		};
		const visibleText = (el) =>
			!!el && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' &&
			el.getBoundingClientRect().height > 0 && !!el.textContent?.trim();

		const groups = [...document.querySelectorAll('.curtis-settings .setting-group')];
		return groups.map((group) => {
			const groupName =
				group.querySelector('.setting-item-heading .setting-item-name')?.textContent?.trim() ||
				group.querySelector('.setting-item-heading')?.textContent?.trim().slice(0, 40) || '(unnamed group)';
			// Rows: every .setting-item except the group heading itself.
			const rows = [...group.querySelectorAll('.setting-item')].filter((r) => !r.classList.contains('setting-item-heading'));
			const anomalies = [];

			// 1. SMEAR: sibling rows that ended up side-by-side and narrow.
			//    Signature of the horizontal flex-row smear bug.
			const byParent = new Map();
			for (const row of rows) {
				const key = row.parentElement;
				if (!byParent.has(key)) byParent.set(key, []);
				byParent.get(key).push(row);
			}
			const smearPairs = [];
			for (const siblings of byParent.values()) {
				for (let i = 0; i < siblings.length; i++) {
					for (let j = i + 1; j < siblings.length; j++) {
						const a = siblings[i].getBoundingClientRect();
						const b = siblings[j].getBoundingClientRect();
						const horizontallyDisjoint = a.right <= b.left + 1 || b.right <= a.left + 1;
						const verticallyOverlapping = a.top < b.bottom - 1 && b.top < a.bottom - 1;
						if (horizontallyDisjoint && verticallyOverlapping && a.width < 200 && b.width < 200) {
							smearPairs.push({
								rows: [
									{ text: siblings[i].querySelector('.setting-item-name')?.textContent?.trim().slice(0, 30) || '(no name)', box: fmt(siblings[i]) },
									{ text: siblings[j].querySelector('.setting-item-name')?.textContent?.trim().slice(0, 30) || '(no name)', box: fmt(siblings[j]) },
								],
							});
						}
					}
				}
			}
			for (const p of smearPairs) {
				anomalies.push({ kind: 'SMEAR side-by-side siblings <200px', pair: p.rows });
			}
			// Also: any control-bearing row squeezed under 100px.
			for (const row of rows) {
				const w = row.getBoundingClientRect().width;
				const hasControls = !!row.querySelector('.setting-item-control .checkbox-container, .setting-item-control select, .setting-item-control input, .setting-item-control button');
				if (w < 100 && hasControls) {
					anomalies.push({
						kind: 'SMEAR narrow row <100px with controls',
						row: row.querySelector('.setting-item-name')?.textContent?.trim().slice(0, 30) || '(no name)',
						box: fmt(row),
					});
				}
			}

			// 2. BARE CONTROLS: control with no visible label on its row.
			for (const row of rows) {
				const nameEl = row.querySelector('.setting-item-name');
				const bareControls = [...row.querySelectorAll('.checkbox-container, select, input, button')]
					.filter((c) => c.closest('.setting-item') === row)
					.map((c) => c.className.split(' ')[0] || c.tagName.toLowerCase());
				if (bareControls.length && !visibleText(nameEl)) {
					anomalies.push({ kind: 'BARE control with no visible label', controls: bareControls });
				}
			}

			// 3. OVERFLOW: control content wider than its box.
			for (const ctrl of group.querySelectorAll('.setting-item-control')) {
				if (ctrl.scrollWidth > ctrl.clientWidth + 4) {
					const row = ctrl.closest('.setting-item');
					anomalies.push({
						kind: 'OVERFLOW scrollWidth>clientWidth+4',
						row: row?.querySelector('.setting-item-name')?.textContent?.trim().slice(0, 30) || '(no name)',
						scrollWidth: ctrl.scrollWidth,
						clientWidth: ctrl.clientWidth,
					});
				}
			}

			return { group: groupName, rowCount: rows.length, anomalies };
		});
	});

	console.log('=== PER-GROUP AUDIT ===');
	for (const g of report) {
		console.log(`\n[${g.group}] rows=${g.rowCount}`);
		if (g.anomalies.length === 0) console.log('  CLEAN');
		for (const a of g.anomalies) console.log('  ' + JSON.stringify(a));
	}

	// --- 4 scrolled screenshots of the settings tab ---
	const scrollerInfo = await probe.evaluate(() => {
		let el = document.querySelector('.curtis-settings');
		while (el && el.scrollHeight <= el.clientHeight + 2) el = el.parentElement;
		if (!el) el = document.querySelector('.vertical-tab-content');
		return el ? { selector: el.className || el.tagName, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight } : null;
	});
	console.log('\n[scroller]', JSON.stringify(scrollerInfo));
	const positions = ['top', 'third', 'two-thirds', 'bottom'];
	for (let i = 0; i < positions.length; i++) {
		await probe.evaluate((idx) => {
			let el = document.querySelector('.curtis-settings');
			while (el && el.scrollHeight <= el.clientHeight + 2) el = el.parentElement;
			if (!el) el = document.querySelector('.vertical-tab-content');
			if (!el) return;
			el.scrollTop = idx === 0 ? 0 : idx === 3 ? el.scrollHeight : Math.round((el.scrollHeight - el.clientHeight) * idx / 3);
			if (idx === 3) el.scrollTop = el.scrollHeight; // ensure true bottom
		}, i);
		await sleep(400);
		await probe.screenshot({ path: resolve(ROOT, 'shots', `fine-tooth-${i + 1}.png`), fullPage: false });
		console.log(`[shot] shots/fine-tooth-${i + 1}.png @ ${positions[i]}`);
	}
	// Reset scroll to top before leaving settings.
	await probe.evaluate(() => {
		let el = document.querySelector('.curtis-settings');
		while (el && el.scrollHeight <= el.clientHeight + 2) el = el.parentElement;
		if (el) el.scrollTop = 0;
	});

	// --- Chat-view sanity ---
	await page.evaluate(() => {
		try { window.app.setting.close(); } catch { /* already closed */ }
	});
	await sleep(500);
	await page.evaluate(() => {
		window.app.commands.executeCommandById('curtis-ai-chat:open-chat');
	});
	await sleep(2000);
	const chat = await page.evaluate(() => {
		const bar = document.querySelector('.ai-chat-topbar-tools');
		return {
			topbarPresent: !!bar,
			buttonCount: bar ? bar.querySelectorAll('button').length : 0,
			buttonTitles: bar ? [...bar.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') || b.title || '?') : [],
		};
	});
	console.log('\n[chat]', JSON.stringify(chat));
	await page.screenshot({ path: resolve(ROOT, 'shots', 'fine-tooth-chat.png'), fullPage: false });

	await browser.close();
	execSync('taskkill /IM Obsidian.exe /F', { stdio: 'ignore' });
	await sleep(1500);
	relaunch();
	console.log('\n[fine-tooth] done');
	process.exit(0);
} catch (e) {
	console.error('[fine-tooth] fatal:', e.message);
	relaunch();
	process.exit(1);
}
