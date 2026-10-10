// Theme audit — boots the demo vault once, then switches between the most
// popular community themes live and screenshots the chat view in each, so
// color/contrast clashes are judged on real renders instead of guesses.
//
// Downloads each theme's CSS from GitHub into the vault's themes folder on
// first run. Same harness contract as smoke-panes: closes the running
// Obsidian, does NOT relaunch it afterwards.
//
// Usage: node scripts/theme-audit.mjs

import { spawn, execSync } from 'node:child_process';
import { cpSync, mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VAULT = resolve(ROOT, 'demo-vault');
const PLUGIN_DIR = resolve(VAULT, '.obsidian/plugins/curtis-ai-chat');
const THEMES_DIR = resolve(VAULT, '.obsidian/themes');
const OUT_DIR = resolve(ROOT, 'shots', 'theme-audit');
const DEBUG_PORT = 9335;

const OBSIDIAN_EXE =
	process.env.OBSIDIAN_EXE ||
	resolve(process.env.USERPROFILE ?? process.env.HOME, 'scoop/apps/obsidian/current/Obsidian.exe');

// name → candidate raw URLs (tried in order).
const THEMES = [
	{ name: 'Minimal', urls: ['https://raw.githubusercontent.com/kepano/obsidian-minimal/master/theme.css'] },
	{ name: 'Things', urls: ['https://raw.githubusercontent.com/colineckert/obsidian-things/main/theme.css', 'https://raw.githubusercontent.com/colineckert/obsidian-things/master/theme.css'] },
	{ name: 'AnuPpuccin', urls: ['https://raw.githubusercontent.com/AnubisNekhet/AnuPpuccin/main/theme.css', 'https://raw.githubusercontent.com/AnubisNekhet/AnuPpuccin/master/theme.css'] },
	{ name: 'Sanctum', urls: ['https://raw.githubusercontent.com/jdanielmourao/obsidian-sanctum/main/theme.css', 'https://raw.githubusercontent.com/jdanielmourao/obsidian-sanctum/master/theme.css'] },
	{ name: 'Tokyo Night', urls: ['https://raw.githubusercontent.com/tcmmichaelb139/obsidian-tokyonight/main/theme.css', 'https://raw.githubusercontent.com/tcmmichaelb139/obsidian-tokyonight/master/theme.css'] },
	{ name: 'Nord', urls: ['https://raw.githubusercontent.com/insanum/obsidian_nord/master/obsidian.css'] },
	{ name: 'Cybertron', urls: ['https://raw.githubusercontent.com/nickmilo/Cybertron/main/theme.css', 'https://raw.githubusercontent.com/nickmilo/Cybertron/master/theme.css', 'https://raw.githubusercontent.com/nickmilo/Cybertron/main/obsidian.css', 'https://raw.githubusercontent.com/nickmilo/Cybertron/master/obsidian.css'] },
	{ name: 'border', urls: ['https://raw.githubusercontent.com/Akifyss/obsidian-border/main/theme.css', 'https://raw.githubusercontent.com/Akifyss/obsidian-border/master/theme.css'] },
	{ name: 'Royal Velvet', urls: ['https://raw.githubusercontent.com/caro401/royal-velvet/main/theme.css', 'https://raw.githubusercontent.com/caro401/royal-velvet/master/theme.css'] },
];

async function downloadTheme(t) {
	const dir = resolve(THEMES_DIR, t.name);
	const file = resolve(dir, 'theme.css');
	if (existsSync(file)) return true;
	mkdirSync(dir, { recursive: true });
	const urls = [...t.urls];
	// Resolve the repo's default branch via the API and try that too —
	// guessing main/master misses renamed defaults.
	for (const u of t.urls) {
		const m = u.match(/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\//);
		if (m) urls.push(`https://api.github.com/repos/${m[1]}/${m[2]}`);
	}
	for (const url of urls) {
		try {
			if (url.includes('api.github.com')) {
				const meta = await (await fetch(url)).json();
				if (meta?.default_branch) {
					const first = t.urls[0].replace(/(raw\.githubusercontent\.com\/[^/]+\/[^/]+\/)[^/]+\//, `$1${meta.default_branch}/`);
					urls.splice(urls.indexOf(url) + 1, 0, first);
				}
				continue;
			}
			const res = await fetch(url);
			if (!res.ok) continue;
			const css = await res.text();
			if (css.length < 500) continue; // 404 page, not a theme
			writeFileSync(file, css);
			return true;
		} catch { /* next URL */ }
	}
	return false;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function main() {
	mkdirSync(OUT_DIR, { recursive: true });
	mkdirSync(PLUGIN_DIR, { recursive: true });
	for (const f of ['main.js', 'manifest.json', 'styles.css']) {
		cpSync(resolve(ROOT, f), resolve(PLUGIN_DIR, f));
	}
	const obsidianDir = resolve(VAULT, '.obsidian');
	writeFileSync(resolve(obsidianDir, 'community-plugins.json'), JSON.stringify(['curtis-ai-chat']));

	console.log('[audit] downloading themes...');
	for (const t of THEMES) {
		const ok = await downloadTheme(t);
		console.log(`[audit]   ${t.name}: ${ok ? 'ok' : 'DOWNLOAD FAILED'}`);
	}

	// register + open the demo vault
	let registry = {};
	const regPath = resolve(process.env.APPDATA, 'obsidian', 'obsidian.json');
	try { registry = JSON.parse(readFileSync(regPath, 'utf8')); } catch { /* fresh */ }
	const vaults = (registry.vaults ??= {});
	let id = Object.keys(vaults).find((k) => vaults[k]?.path === VAULT);
	if (!id) {
		id = randomUUID();
		vaults[id] = { path: VAULT, ts: Date.now() };
	}
	for (const v of Object.values(vaults)) if (v && typeof v === 'object') v.open = false;
	vaults[id].open = true;
	writeFileSync(regPath, JSON.stringify(registry, null, 2));

	try { execSync('taskkill /IM Obsidian.exe /F', { stdio: 'ignore' }); } catch { /* not running */ }
	await sleep(2500);

	const child = spawn(OBSIDIAN_EXE, [
		VAULT,
		`--remote-debugging-port=${DEBUG_PORT}`,
		'--window-size=1680,1050',
		'--window-position=40,40',
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
	if (!browser) { child.kill(); throw new Error('could not attach'); }
	const ctx = browser.contexts()[0];

	setTimeout(() => {
		console.error('[audit] fatal: watchdog timeout (4 min)');
		try { execSync('taskkill /IM Obsidian.exe /F', { stdio: 'ignore' }); } catch { /* */ }
		process.exit(1);
	}, 240000);

	let page = ctx.pages().find((p) => p.url()) ?? ctx.pages()[0];
	const deadline = Date.now() + 30000;
	while (Date.now() < deadline) {
		try {
			if (await page.evaluate(() => window.app?.vault?.getName?.() === 'demo-vault')) break;
		} catch { /* retry */ }
		await sleep(1000);
	}
	try { await page.getByRole('button', { name: /trust/i }).click({ timeout: 5000 }); } catch { /* trusted */ }
	// Force a real desktop window — Obsidian restores its own (possibly tiny)
	// saved geometry, ignoring --window-size. Two levers: CDP window bounds
	// (two-step: state first, then size) and Electron's own API in-page.
	const resizeLog = [];
	try {
		const cdp = await ctx.newCDPSession(page);
		const { windowId } = await cdp.send('Browser.getWindowForTarget');
		await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
		await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width: 1680, height: 1050 } });
		resizeLog.push('cdp-ok');
	} catch (e) {
		resizeLog.push(`cdp-fail: ${e.message}`);
	}
	try {
		resizeLog.push(await page.evaluate(() => {
			const el = window.electron ?? window.require?.('electron');
			const win = el?.remote?.getCurrentWindow?.();
			if (!win) return 'electron-api: not available';
			win.setSize(1680, 1050);
			return 'electron-setSize-ok';
		}));
	} catch (e) {
		resizeLog.push(`electron-fail: ${e.message}`);
	}
	await sleep(1200);
	resizeLog.push(await page.evaluate(() => `viewport ${window.innerWidth}x${window.innerHeight}`));
	console.log(`[audit] resize: ${resizeLog.join(' | ')}`);
	await page.evaluate(async () => {
		try { await window.app.plugins.enablePlugin('curtis-ai-chat'); } catch { /* on */ }
	});
	await sleep(1500);

	// Seed a REAL-looking conversation instead of one canned exchange —
	// multiple turns across two days (day separators), a markdown list, a
	// code block, short and long bubbles, token counts. Rendered from the
	// store like any other history.
	const fixtureId = await page.evaluate(() => {
		const p = window.app.plugins.plugins['curtis-ai-chat'];
		const store = p.conversationStore;
		const conv = store.createConversation('ollama', 'ling-3.0-flash-vl');
		const DAY = 86400000;
		const now = Date.now();
		const turns = [
			['user', 'Planning to ship v2 on Friday — what should the changelog cover?', now - DAY],
			['assistant', 'Keep it to three sections:\n\n- **Shipped** — user-visible changes only\n- **Fixed** — bugs with a one-line repro each\n- **Internal** — deps, CI, tooling (one line, or cut it)\n\nLead with the one sentence a user would actually care about, then the sections. No emoji.', now - DAY + 45000],
			['user', 'Give me the release-note snippet as markdown I can paste.'],
			['assistant', '```markdown\n## v2.0 — Curtis Composer\n\nThe chat input is now a single composer: model picker, arena, attach and mic live inside one box.\n\n- Glass surface with scroll-under blur\n- Terminal caret while Curtis thinks\n- Send button follows your theme accent\n```\n\nTrim if it feels long — three bullets max per section.', now - 60000],
			['user', 'Perfect, shipping it.'],
			['assistant', 'Ship it. The composer finally reads like the big-model apps — ping me when the notes are up and I\u2019ll sanity-check them.', now - 30000],
		];
		for (const [role, content, ts] of turns) {
			const m = store.addMessageTo(conv.id, {
				role,
				content,
				provider: 'ollama',
				model: 'ling-3.0-flash-vl',
				tokens: role === 'assistant'
					? { promptTokens: 120, completionTokens: 64, totalTokens: 184 }
					: undefined,
			});
			// Turns without an explicit ts keep the store's real timestamp —
			// never overwrite with undefined (that renders "Invalid Date").
			if (m && ts !== undefined) m.timestamp = ts;
		}
		store.setCurrentConversation(conv.id);
		p.__auditFixtureId = conv.id;
		return conv.id;
	});
	await sleep(400);

	// Probe where theme switching lives in this Obsidian build.
	const themeApi = await page.evaluate(() => {
		const c = window.app.customCss ?? window.app.customCSS;
		if (!c) return { missing: true };
		const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(c));
		return {
			own: Object.keys(c),
			methods: proto.filter((m) => /them|load|read/i.test(m)),
		};
	});
	console.log(`[audit] theme API: ${JSON.stringify(themeApi)}`);
	const setThemeExpr = (name) => `(() => {
		const c = window.app.customCss ?? window.app.customCSS;
		if (!c) throw new Error('no theme API');
		if (typeof c.setTheme === 'function') return c.setTheme(${JSON.stringify(name)});
		if (typeof c.requestLoadTheme === 'function') return c.requestLoadTheme(${JSON.stringify(name)});
		if (typeof c.loadTheme === 'function') return c.loadTheme(${JSON.stringify(name)});
		throw new Error('no switcher method');
	})()`;
	await sleep(200);
	await page.evaluate(() => { try { window.app.customCss?.requestReadThemes?.(); } catch { /* */ } });
	await sleep(500);

	await page.evaluate(() => {
		window.app.commands.executeCommandById('curtis-ai-chat:open-chat');
	});
	// The view binds to the current conversation on open — the fixture. Make
	// sure it renders (onOpen may have raced the seed).
	await page.evaluate(() => {
		for (const v of window.app.workspace.getLeavesOfType('curtis-chat')) {
			if (typeof v.renderCurrentConversation === 'function') v.renderCurrentConversation();
		}
	});
	await sleep(800);

	// Screenshot helper: crop to the chat leaf.
	async function shoot(label) {
		const rect = await page.evaluate(() => {
			const el = document.querySelector('.workspace-leaf-content[data-type="curtis-chat"]');
			if (!el) return null;
			const r = el.getBoundingClientRect();
			return { x: r.x, y: r.y, width: r.width, height: r.height };
		});
		if (!rect) { console.log(`[audit]   ${label}: no chat leaf`); return; }
		// Note: Obsidian's collapsed left ribbon overlays the first ~44px of
		// the pane — that's app chrome visible in the shots, not ours.
		await page.screenshot({
			path: resolve(OUT_DIR, `${label}.png`),
			clip: rect,
		});
		console.log(`[audit]   ${label}: captured`);
	}

	const installed = await page.evaluate(async () => {
		const c = window.app.customCss ?? window.app.customCSS;
		if (!c) return [];
		try { await c.requestReadThemes?.(); } catch { /* sync impl */ }
		const t = c.themes;
		if (Array.isArray(t)) return t;
		return t && typeof t === 'object' ? Object.keys(t) : [];
	});
	console.log(`[audit] installed themes: ${JSON.stringify(installed)}`);
	void installed;

	// Baseline: default Obsidian, dark then light.
	await page.evaluate(setThemeExpr(''));
	await page.evaluate(() => { try { window.app.vault.setConfig('theme', 'obsidian'); } catch { /* */ } });
	await sleep(700);
	await shoot('default-dark');
	await page.evaluate(() => {
		try { window.app.vault.setConfig('theme', 'moonstone'); } catch { /* */ }
		document.body.removeClass('theme-dark');
		document.body.addClass('theme-light');
	});
	await sleep(700);
	await shoot('default-light');
	await page.evaluate(() => {
		try { window.app.vault.setConfig('theme', 'obsidian'); } catch { /* */ }
		document.body.removeClass('theme-light');
		document.body.addClass('theme-dark');
	});

	for (const t of THEMES) {
		// Apply, then verify by reading back the active theme — no manifest
		// list needed.
		const applied = await page.evaluate(async (name) => {
			const c = window.app.customCss ?? window.app.customCSS;
			if (!c) return false;
			try { await c.setTheme(name); } catch { return false; }
			return c.theme === name;
		}, t.name);
		if (!applied) { console.log(`[audit]   ${t.name}: setTheme failed, skipped`); continue; }
		await sleep(900);
		await shoot(t.name.toLowerCase().replace(/\s+/g, '-'));
	}
	// Back to default so the vault isn't left on a downloaded theme.
	await page.evaluate(async () => { try { await (window.app.customCss ?? window.app.customCSS)?.setTheme(''); } catch { /* */ } });
	await sleep(300);

	// ------------------------------------------------------------------
	// DESKTOP pass — move the chat into a full-window CENTER pane and
	// recapture every theme at real desktop width (the narrow loop above
	// is a ~435px sidebar; this is how it reads maximized).
	// ------------------------------------------------------------------
	await page.evaluate(() => {
		const ws = window.app.workspace;
		const leaf = ws.createLeafInParent(ws.rootSplit, ws.rootSplit.children.length);
		leaf.setViewState({ type: 'curtis-chat', active: true });
		// The saved center layout can carry leftover splits — walk the
		// rootSplit tree and detach every leaf that is not ours, so the chat
		// pane takes the FULL window width.
		const collect = (node, out) => {
			if (!node) return out;
			if (node.view) { out.push(node); return out; }
			for (const c of node.children ?? []) collect(c, out);
			return out;
		};
		const centerLeaves = [];
		for (const child of ws.rootSplit.children ?? []) collect(child, centerLeaves);
		// Pass 1 — remove every NON-chat leaf from the center area (leftover
		// editors, empties from saved layouts).
		const chatLeaves = new Set(ws.getLeavesOfType('curtis-chat'));
		for (const l of centerLeaves) {
			if (!chatLeaves.has(l)) { try { l.detach(); } catch { /* */ } }
		}
		// Pass 2 — earlier audit runs leave EXTRA chat panes behind; every
		// chat leaf that is not the fresh center one goes too. One pane,
		// full width.
		for (const l of ws.getLeavesOfType('curtis-chat')) {
			if (l !== leaf) { try { l.detach(); } catch { /* */ } }
		}
		// Collapse both side docks — the center pane takes the whole window.
		try { ws.leftSplit?.collapse(); } catch { /* */ }
		try { ws.rightSplit?.collapse(); } catch { /* */ }
	});
	await sleep(400);
	// Pin the chat leaf's flex width — Obsidian's split math reflows on its
	// own, but for a screenshot pass a hard width is the guarantee.
	await page.evaluate(() => {
		const el = document
			.querySelector('.workspace-leaf-content[data-type="curtis-chat"]')
			?.closest('.workspace-leaf');
		if (el) {
			el.style.flex = '0 0 1800px';
			el.style.maxWidth = 'none';
		}
	});
	await sleep(1200);
	// The fresh center view binds to the current conversation (the fixture)
	// on open — make sure it renders, and that it shows the FIXTURE (a
	// previous run's stray current-conversation pointer would show instead
	// if the seed raced).
	await page.evaluate(() => {
		const p = window.app.plugins.plugins['curtis-ai-chat'];
		p.conversationStore.setCurrentConversation(p.__auditFixtureId);
		for (const v of window.app.workspace.getLeavesOfType('curtis-chat')) {
			if (typeof v.renderCurrentConversation === 'function') v.renderCurrentConversation();
		}
	});
	await sleep(800);

	await page.evaluate(() => { try { window.app.vault.setConfig('theme', 'obsidian'); } catch { /* */ } });
	await sleep(600);
	await shoot('desktop-default-dark');
	await page.evaluate(() => {
		try { window.app.vault.setConfig('theme', 'moonstone'); } catch { /* */ }
		document.body.removeClass('theme-dark');
		document.body.addClass('theme-light');
	});
	await sleep(600);
	await shoot('desktop-default-light');
	await page.evaluate(() => {
		try { window.app.vault.setConfig('theme', 'obsidian'); } catch { /* */ }
		document.body.removeClass('theme-light');
		document.body.addClass('theme-dark');
	});

	for (const t of THEMES) {
		const applied = await page.evaluate(async (name) => {
			const c = window.app.customCss ?? window.app.customCSS;
			if (!c) return false;
			try { await c.setTheme(name); } catch { return false; }
			return c.theme === name;
		}, t.name);
		if (!applied) { console.log(`[audit]   desktop ${t.name}: setTheme failed, skipped`); continue; }
		await sleep(900);
		await shoot(`desktop-${t.name.toLowerCase().replace(/\s+/g, '-')}`);
	}
	await page.evaluate(async () => { try { await (window.app.customCss ?? window.app.customCSS)?.setTheme(''); } catch { /* */ } });
	await sleep(300);
	// Remove the fixture conversation — runs don't litter the vault.
	// (deleteConversation clears the current pointer if the fixture is it.)
	await page.evaluate(() => {
		const p = window.app.plugins.plugins['curtis-ai-chat'];
		if (p.__auditFixtureId) p.conversationStore.deleteConversation(p.__auditFixtureId);
	});
	await sleep(300);

	console.log('[audit] done — shots in shots/theme-audit/');
	await browser.close();
	child.kill();
	process.exit(0);
}

main().catch((e) => {
	console.error('[audit] fatal:', e.message);
	try { execSync('taskkill /IM Obsidian.exe /F', { stdio: 'ignore' }); } catch { /* */ }
	process.exit(1);
});
