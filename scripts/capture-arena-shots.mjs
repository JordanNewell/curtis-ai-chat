// Arena-mode screenshot captures for Curtis AI Chat.
//
// Same machinery as capture-screenshots.mjs (real Obsidian on the demo vault,
// driven over CDP), exercising the arena flow end-to-end with the two key'd
// providers (zai-glm + deepseek). Produces the full asset matrix:
//
//   desktop × {dark, light}: picker, streaming, stopped, final, promoted
//   phone   × {dark, light}: streaming (stacked columns), promoted, + framed
//
// Quality rules learned from the first (bad) attempt:
//   - a real daily note stays open behind the chat so the workspace reads
//     lived-in instead of an empty "New tab" pane;
//   - the chat sidebar is widened (min(62vw, 980px)) so arena columns get
//     ~450px each instead of a 3-words-per-line sliver;
//   - themes are flipped in-session via body classes (verified by measuring
//     the rendered background luminance) — nothing persists to the vault;
//   - the prompt asks for ~180 words so both streams last long enough for a
//     distinct mid-stream shot, a per-column stop while the sibling still
//     streams, and a settled final;
//   - memory + RAG are disabled for the run so the "Worth remembering?" bar
//     and retrieval excerpts never wander into a shot.
//
// Usage:  node scripts/capture-arena-shots.mjs
// Env:    OBSIDIAN_EXE (default: scoop obsidian current)
//
// The user's running Obsidian is closed for the duration and relaunched at
// the end (same contract as npm run shots).

import { spawn, execSync } from 'node:child_process';
import { cpSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
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

const OBSIDIAN_EXE =
	process.env.OBSIDIAN_EXE ||
	resolve(process.env.USERPROFILE ?? process.env.HOME, 'scoop/apps/obsidian/current/Obsidian.exe');

// The arena pair — two deepseek models. z.ai throttles under repeated
// capture runs (big GLMs answer too slowly to catch mid-flight; flash
// bursts and then degenerates into ~40-char stubs), while deepseek serves
// reliably all night. Two models from one provider is a valid duel — the
// arena keys columns by provider:model, and same-provider pairs are exactly
// the "same model via two plans" variance test. V4.1 Flash vs V4 Pro is
// today's speed-vs-quality pairing (slugs verified 2026-10-08).
const PROVIDER_A = 'deepseek';
const MODEL_A = 'deepseek-flash';
const PROVIDER_B = 'deepseek';
const MODEL_B = 'deepseek-v4-pro';

// ~400 words keeps both streams alive well past first tokens: a mid-stream
// shot with real partial text, a per-column stop with the sibling still
// streaming, then a settled final. (Fixed-delay timing failed both ways:
// 3.5s could land after the fast pair finished; 1.2s landed before the first
// token and captured empty skeletons. Flash models burst ~800 chars/s, so
// longer answers are what widens the catchable window.)
const PROMPT =
	'Write a 400-word comparison of side-by-side model testing versus picking an LLM from leaderboards. Use two bullet points and one closing sentence. No preamble. The answer must be at least 380 words.';

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
	// A few real notes so the editor pane behind the widened chat looks alive.
	const notes = {
		'Daily/2026-10-02.md': [
			'# 2026-10-02',
			'',
			'- Shipped v1.1.0 — agent mode for every provider',
			'- Fixed the LM Studio key prompt bug (#6)',
			'- Wrote the r/ObsidianMD launch post',
			'- Coffee experiment: 1:16 ratio, 92C, 3:00 — best cup yet',
			'',
			'## Reading',
			'- [[The Pragmatic Programmer]] ch. 7',
		].join('\n'),
		'Daily/2026-10-01.md': [
			'# 2026-10-01',
			'',
			'- Anthropic native tool-use: tool_use/tool_result blocks wired',
			'- Calculator tool registered (recursive descent, no eval)',
			'- Ran 5k, 26:12',
		].join('\n'),
		'Projects/Curtis AI Chat.md': [
			'# Curtis AI Chat',
			'',
			'Polyglot AI chat for Obsidian. 30+ providers, agent mode, arena.',
			'',
			'## Next',
			'- Word-level diff rewrite',
			'- Settings import/export',
		].join('\n'),
	};
	for (const [path, content] of Object.entries(notes)) {
		const full = resolve(VAULT, path);
		mkdirSync(dirname(full), { recursive: true });
		if (!existsSync(full)) writeFileSync(full, content);
	}
	// The note behind the chat is rewritten unconditionally WITHOUT an H1 —
	// Obsidian's inline title already renders the filename, so an H1 shows a
	// duplicated heading in every full-window shot.
	const heroNote = resolve(VAULT, 'Daily/2026-10-02.md');
	writeFileSync(
		heroNote,
		[
			'- Shipped v1.1.0 — agent mode for every provider',
			'- Fixed the LM Studio key prompt bug (#6)',
			'- Wrote the r/ObsidianMD launch post',
			'- Coffee experiment: 1:16 ratio, 92C, 3:00 — best cup yet',
			'',
			'## Reading',
			'- [[The Pragmatic Programmer]] ch. 7',
		].join('\n')
	);
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

// --- boot + attach (same machinery as shots) ---------------------------------

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
	try {
		execSync('taskkill /IM Obsidian.exe /F', { stdio: 'ignore' });
	} catch { /* not running */ }
	await new Promise((r) => setTimeout(r, 2500));
}

async function bootInstance(port) {
	const child = spawn(
		OBSIDIAN_EXE,
		[
			VAULT,
			`--remote-debugging-port=${port}`,
			// Windows pauses an occluded Electron window's renderer, which
			// stalls page.screenshot's wait-for-frame when the capture window
			// gets buried under other windows mid-run.
			'--disable-backgrounding-occluded-windows',
			'--disable-background-timer-throttling',
			'--disable-renderer-backgrounding',
		],
		{
			detached: false,
			stdio: 'ignore',
		},
	);

	const version = await waitForDebugPort(port, 25000);
	if (!version) {
		child.kill();
		throw new Error('debug port never opened');
	}

	let browser = null;
	for (let attempt = 1; attempt <= 5 && !browser; attempt++) {
		try {
			browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
		} catch {
			await new Promise((r) => setTimeout(r, 2500));
		}
	}
	if (!browser) {
		child.kill();
		throw new Error('could not attach to the debug port');
	}

	const ctx = browser.contexts()[0];
	const logLine = (m) => {
		if (m.type() === 'error' || m.type() === 'warning') console.log(`[obsidian] ${m.type()}: ${m.text().slice(0, 160)}`);
	};
	const bind = (p) => {
		p.on('console', logLine);
		p.on('pageerror', (e) => console.log(`[obsidian] pageerror: ${e.message.slice(0, 160)}`));
	};
	for (const p of ctx.pages()) bind(p);
	ctx.on('page', bind);

	let page = await waitForVaultPage(ctx, () => true, 30000, 'window');
	try {
		await page.getByRole('button', { name: /trust/i }).click({ timeout: 8000 });
		console.log('[arena] dismissed trust-vault modal');
	} catch { /* already trusted */ }

	await page.evaluate(async () => {
		try { await window.app.plugins.enablePlugin('curtis-ai-chat'); } catch { /* restricted or already on */ }
	});

	page = await waitForVaultPage(
		ctx,
		() => !!window.app?.plugins?.plugins?.['curtis-ai-chat']?.conversationStore,
		45000,
		'plugin onload'
	);
	await waitForVaultPage(
		ctx,
		() => !!window.app?.commands?.commands?.['curtis-ai-chat:open-chat'],
		15000,
		'command registration'
	);
	return { child, browser, ctx, page };
}

async function shutdownInstance(instance) {
	if (!instance) return;
	try { await instance.browser.close(); } catch { /* already dead */ }
	try { instance.child.kill(); } catch { /* already dead */ }
	await killObsidian();
}

// --- page-side steps ---------------------------------------------------------

const configureForCapture = () => {
	const plugin = window.app.plugins.plugins['curtis-ai-chat'];
	// Deterministic shots: no memory proposals, no retrieval excerpts, no
	// background extraction call after each turn.
	plugin.settings.enableMemory = false;
	plugin.settings.enableRag = false;
	plugin.saveSettings();
	return true;
};

const openChatAndRender = async () => {
	window.app.commands.executeCommandById('curtis-ai-chat:open-chat');
	const deadline = Date.now() + 10000;
	while (Date.now() < deadline) {
		if (document.querySelector('.workspace-leaf-content[data-type="curtis-chat"]')) break;
		await new Promise((r) => setTimeout(r, 200));
	}
	window.app.plugins.plugins['curtis-ai-chat'].refreshChatViews?.();
};

/** Report which enabled providers actually pass the auth check. */
const authReport = () => {
	const plugin = window.app.plugins.plugins['curtis-ai-chat'];
	const enabled = plugin.providerRegistry.getAllEnabledProviders().map(({ id }) => id);
	const out = [];
	for (const id of enabled) {
		let authed = false;
		try { plugin.getAuthenticatedProviderById(id); authed = true; } catch { /* no key */ }
		const models = plugin.providerRegistry.getProvider(id)?.models.length ?? 0;
		out.push({ id, authed, models });
	}
	return out;
};

const storeSnapshot = () => {
	const plugin = window.app.plugins.plugins['curtis-ai-chat'];
	const conv = plugin.conversationStore.getCurrentConversation();
	if (!conv) return null;
	return {
		id: conv.id,
		messages: conv.messages.map((m) => ({
			role: m.role,
			provider: m.provider ?? null,
			model: m.model ?? null,
			chars: m.content.length,
		})),
	};
};

/** Flip Obsidian's theme classes in-session (nothing persists) and return the
 *  measured background luminance so the caller can verify it took. */
const setBodyTheme = (theme) => {
	document.body.classList.remove('theme-light', 'theme-dark', 'theme-type-light', 'theme-type-dark');
	document.body.classList.add(`theme-${theme}`, `theme-type-${theme}`);
	const el = document.querySelector('.curtis-messages') || document.body;
	const m = getComputedStyle(el).backgroundColor.match(/\d+/g) || ['255', '255', '255'];
	const [r, g, b] = m.map(Number);
	return { bg: m.join(','), lum: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 };
};

const scrollChatToTop = () => {
	const els = document.querySelectorAll(
		'.workspace-leaf-content[data-type="curtis-chat"] .view-content, .workspace-leaf-content[data-type="curtis-chat"] .curtis-messages'
	);
	for (const c of els) c.scrollTop = 0;
};

// Column answer areas keep whatever scroll offset streaming left them at,
// which slices a line mid-glyph at the card edge in settled shots. Park the
// scroll at a whole-line offset (clean top edge) and fade the last 18px out
// (no visible cut at the bottom) — no layout shift, safe mid-stream.
const scrollArenaColumnsToEnd = () => {
	for (const col of document.querySelectorAll('.ai-arena-column')) {
		for (const el of [col, ...col.querySelectorAll('*')]) {
			if (el.clientHeight < 40 || el.scrollHeight <= el.clientHeight + 4) continue;
			const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
			el.scrollTop = Math.floor((el.scrollHeight - el.clientHeight) / lh) * lh;
			const fade = 'linear-gradient(to bottom, black calc(100% - 18px), transparent 100%)';
			el.style.webkitMaskImage = fade;
			el.style.maskImage = fade;
		}
	}
};

// Hover tooltips ("Stop generating", "Send") linger over the button a scripted
// click just left and photobomb the next shot; park the pointer over plain
// message text right-of-center (dead corner (2,2) is the sidebar collapse
// toggle's hover zone in this layout) and let the tooltip drop.
async function parkMouse(page) {
	const box = page.viewportSize() ?? { width: 1280, height: 800 };
	await page.mouse.move(Math.round(box.width * 0.55), Math.round(box.height * 0.35));
	await page.waitForTimeout(450);
}

// --- shared arena flow -------------------------------------------------------

/** Point the active provider at pair member A (the picker pre-selects it),
 *  start a clean conversation, and make sure the chat renders it. */
async function resetRound(page, ctx, providerId, modelId) {
	await page.evaluate(([p, m]) => {
		const plugin = window.app.plugins.plugins['curtis-ai-chat'];
		plugin.settings.activeProvider = p;
		plugin.settings.activeModel = m;
		plugin.saveSettings();
		const conv = plugin.conversationStore.createConversation(p, m);
		plugin.conversationStore.setCurrentConversation(conv.id);
		plugin.refreshChatViews?.();
	}, [providerId, modelId]);
	await page.evaluate(scrollChatToTop);
}

/** Get the picker open, resiliently. A rejected round can leave arena mode
 *  on (toggle-off needed first), and the toggle is a no-op while the view
 *  thinks it is still generating — so verify the modal appeared and fall
 *  back to driving the view's own toggle method before giving up. */
async function openArenaPicker(page, ctx) {
	for (let i = 0; i < 3; i++) {
		if (await page.locator('.ai-chat-arena-btn.is-active').count()) {
			await page.click('.ai-chat-arena-btn');
			await page.waitForTimeout(500);
		}
		await page.click('.ai-chat-arena-btn');
		await page.waitForTimeout(500);
		let modal = await pollVaultState(ctx, () => !!document.querySelector('.ai-arena-picker-modal'), 4000);
		if (modal) return modal;
		// Fall back to the view's own method (compile-time private only).
		console.log('[arena] picker did not open — driving the view toggle directly');
		await page.evaluate(() => {
			const leaf = window.app.workspace.getLeavesOfType('curtis-chat')[0];
			const view = leaf?.view;
			console.log('[arena] view state:', JSON.stringify({
				leaves: window.app.workspace.getLeavesOfType('curtis-chat').length,
				arenaMode: view?.arenaMode,
				isGenerating: view?.isGenerating,
			}));
			const btn = document.querySelector('.ai-chat-arena-btn');
			if (view && btn instanceof HTMLElement && typeof view.toggleArenaMode === 'function') {
				view.toggleArenaMode(btn);
			}
		});
		modal = await pollVaultState(ctx, () => !!document.querySelector('.ai-arena-picker-modal'), 4000);
		if (modal) return modal;
	}
	throw new Error('picker modal would not open');
}

/** Open the picker, select pair member B, capture the modal, and start. */
async function startArena(page, ctx, modelBName, pickerShot) {
	page = await openArenaPicker(page, ctx);
	page = await waitForVaultPage(ctx, () => !!document.querySelector('.ai-arena-picker-modal'), 10000, 'picker modal');
	await page.evaluate((name) => {
		const rows = Array.from(document.querySelectorAll('.ai-arena-picker-row'));
		const row = rows.find((r) => r.querySelector('.ai-arena-picker-name')?.textContent === name);
		if (!row) throw new Error('picker row not found for ' + name);
		row.scrollIntoView({ block: 'center' });
		row.click();
	}, modelBName);
	await page.waitForTimeout(400);
	if (pickerShot) {
		const counter = await page.locator('.ai-arena-picker-counter').textContent();
		console.log(`[arena] picker counter: "${counter?.trim()}"`);
		await parkMouse(page);
		await page.screenshot({ path: resolve(OUT_DIR, pickerShot) });
		console.log(`[arena] ${pickerShot}`);
	}
	await page.locator('.ai-arena-picker-start').click();
	await page.waitForTimeout(600);
	const arenaActive = await page.locator('.ai-chat-arena-btn.is-active').count();
	if (arenaActive !== 1) throw new Error('arena toggle did not activate after Start');
	return page;
}

/** Send the prompt and wait for both columns to exist. */
async function sendArenaPrompt(page, ctx) {
	const input = page.locator('.ai-chat-input');
	await input.fill(PROMPT);
	await page.click('.ai-chat-send-btn');
	return waitForVaultPage(ctx, () => document.querySelectorAll('.ai-arena-column').length === 2, 20000, 'two columns');
}

/** Force the chat split wide via inline !important properties and verify the
 *  measured width. The stylesheet injection alone races Obsidian's own layout
 *  pass (the first round captured 116px columns); inline properties win
 *  deterministically, and the retry loop covers async re-layouts. Fixed px,
 *  not 62vw: a narrow restored window collapses the vw math and the arena
 *  columns end up cramped (same fix as record-arena-demo.mjs). */
async function ensureWideChat(page) {
	let lastWidth = -1;
	for (let i = 0; i < 10; i++) {
		lastWidth = await page.evaluate(() => {
			const leaf = document.querySelector('.workspace-leaf-content[data-type="curtis-chat"]');
			const split = leaf?.closest('.workspace-split');
			if (!split) return -1;
			for (const prop of ['width', 'max-width', 'flex-basis']) {
				split.style.setProperty(prop, '980px', 'important');
			}
			return split.offsetWidth;
		});
		if (lastWidth >= 700) return lastWidth;
		await page.waitForTimeout(400);
	}
	throw new Error(`chat split would not widen (last width ${lastWidth}px)`);
}

async function waitColumnsSettled(page, ctx) {
	return waitForVaultPage(
		ctx,
		() => document.querySelectorAll('.ai-arena-column .ai-arena-stop-btn').length === 0
			&& document.querySelectorAll('.ai-arena-column-response').length === 2,
		120000,
		'all columns settled'
	);
}

/** Page-side diagnostic when a column refuses to stream (provider error,
 *  rate limit) — surfaces in the log instead of a bare timeout. */
const diagnoseColumns = () =>
	Array.from(document.querySelectorAll('.ai-arena-column')).map((c) => ({
		chars: (c.querySelector('.ai-arena-column-response')?.textContent || '').trim().length,
		error: c.querySelector('.ai-arena-column-error')?.textContent?.slice(0, 140) ?? null,
	}));

/** Any arena column visibly live: real text on screen while its stop button
 *  is still up. Catching BOTH columns mid-flight is a race the fast sibling
 *  always loses (the flash sibling settles before V4 Pro's first token), so
 *  "one live column beside a settled sibling" is the honest streaming shot.
 *  NOTE: predicates passed to page.evaluate must be self-contained —
 *  Playwright evaluates the function SOURCE in the page, so closure
 *  variables arrive undefined and silently break the check. */
/** Column 1 (the slow opener) live with real text — the streaming/stop
 *  target. */
const col0Live = () => {
	const c = document.querySelectorAll('.ai-arena-column')[0];
	if (!c) return false;
	const chars = (c.querySelector('.ai-arena-column-response')?.textContent || '').trim().length;
	return chars >= 80 && !!c.querySelector('.ai-arena-stop-btn');
};

/** Click every per-column stop button — frees hung arena streams (a provider
 *  connection can stall after many rapid calls; without this the settle wait
 *  burns its whole timeout and the run dies). Tolerates a page that died
 *  mid-hang — nothing to abort then; the caller's re-roll or the outer error
 *  path takes over. */
async function abortArenaStreams(page) {
	try {
		for (let i = await page.locator('.ai-arena-stop-btn').count(); i > 0; i--) {
			await page.locator('.ai-arena-stop-btn').first().click().catch(() => { /* already gone */ });
			await page.waitForTimeout(200);
		}
		await page.waitForTimeout(1500);
	} catch (e) {
		console.log(`[arena] abort found the page already closed: ${e.message?.slice(0, 80)}`);
	}
}

/** Column N settled: its stop button is gone (aborted or finished). */
const col0Settled = () => {
	const cols = document.querySelectorAll('.ai-arena-column');
	return cols.length >= 2 && !cols[0].querySelector('.ai-arena-stop-btn');
};
const col1Settled = () => {
	const cols = document.querySelectorAll('.ai-arena-column');
	return cols.length >= 2 && !cols[1].querySelector('.ai-arena-stop-btn');
};

/** Like waitForVaultPage but returns null instead of throwing on timeout. */
async function pollVaultState(ctx, pred, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		for (const p of ctx.pages()) {
			try {
				const vault = await p.evaluate(() => window.app?.vault?.getName?.());
				if (vault !== 'demo-vault') continue;
				if (await p.evaluate(pred)) return p;
			} catch { /* stale page — retry */ }
		}
		await new Promise((r) => setTimeout(r, 300));
	}
	return null;
}

// --- passes ------------------------------------------------------------------

/** DeepSeek V4.1 defaults to thinking mode server-side — temperature is
 *  ignored and the first content token lands 10-30s late, which empties the
 *  mid-flight streaming shots. Patch the live provider instance (built once
 *  at onload, so it survives settings saves and reloads are handled by
 *  re-patching) to send thinking:disabled per DeepSeek's API. */
async function patchDeepseekThinking(page) {
	await page.evaluate(() => {
		const prov = window.app.plugins.plugins['curtis-ai-chat'].providerRegistry.getProvider('deepseek');
		if (!prov) throw new Error('deepseek provider not initialized');
		if (prov.__thinkingPatched) return;
		const orig = prov.formatRequest.bind(prov);
		prov.formatRequest = (messages, options) => {
			const init = orig(messages, options);
			try {
				const body = JSON.parse(init.body);
				body.thinking = { type: 'disabled' };
				init.body = JSON.stringify(body);
			} catch { /* body already gone — leave it untouched */ }
			return init;
		};
		prov.__thinkingPatched = true;
	});
}

async function desktopPass() {
	console.log('[arena] pass 1: desktop × both themes');
	const inst = await bootInstance(9225);
	try {
		let { page, ctx } = inst;
		await page.evaluate(configureForCapture);
		// The phone pass (which reloads after configure) never hit the
		// zai-glm failure the desktop pass did — reload here too so both
		// passes run from the same clean post-settings state.
		await page.evaluate(() => location.reload());
		page = await waitForVaultPage(
			ctx,
			() => !!window.app?.plugins?.plugins?.['curtis-ai-chat']?.conversationStore,
			45000,
			'desktop reload'
		);
		await waitForVaultPage(
			ctx,
			() => !!window.app?.commands?.commands?.['curtis-ai-chat:open-chat'],
			15000,
			'command registration (desktop reload)'
		);
		await patchDeepseekThinking(page);

		// Electron ignores --window-size in packaged apps and Obsidian's
		// restored bounds are whatever the last window was (a ~840px window
		// collapses the min(62vw,…) math and the chat split won't widen —
		// the 2026-10-08 run died at 521px exactly this way). resizeTo works
		// on non-maximized windows — resize and verify, like the recorder.
		await page.evaluate(() => window.resizeTo(1440, 900));
		await page.waitForTimeout(800);
		const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
		console.log(`[arena] viewport: ${vp.w}x${vp.h}`);
		if (!vp.w || vp.w < 1100) {
			throw new Error(`window too narrow after resizeTo (${vp.w}px) — close other Obsidian windows and retry`);
		}

		const report = await page.evaluate(authReport);
		const authed = Object.fromEntries(report.map((r) => [r.id, r]));
		for (const pid of [PROVIDER_A, PROVIDER_B]) {
			if (!authed[pid]?.authed) throw new Error(`${pid} is not authenticated — key missing from keychain`);
			if (authed[pid].models === 0) throw new Error(`${pid} has no models loaded`);
		}
		// If auto-discovery replaced the curated ids, fall back to the
		// provider's first model.
		const resolveModel = (pid, wanted) =>
			page.evaluate(
				([p, w]) => {
					const prov = window.app.plugins.plugins['curtis-ai-chat'].providerRegistry.getProvider(p);
					const m = prov?.models.find((x) => x.id === w) ?? prov?.models.find((x) => w && x.id.includes(w)) ?? prov?.models[0];
					return m ? { id: m.id, name: m.name } : null;
				},
				[pid, wanted]
			);
		const modelA = await resolveModel(PROVIDER_A, MODEL_A);
		const modelB = await resolveModel(PROVIDER_B, MODEL_B);
		if (!modelA || !modelB) throw new Error('could not resolve a model for both providers');
		if (modelA.id === modelB.id) throw new Error('both pair members resolved to the same model — picker cannot duel one model against itself');
		console.log(`[arena] pair: ${PROVIDER_A}/${modelA.id} vs ${PROVIDER_B}/${modelB.id}`);

		await page.evaluate(openChatAndRender);
		// Widen the chat sidebar so the arena grid gets ~450px per column,
		// and put a real note behind it so the workspace reads lived-in.
		await page.addStyleTag({
			content: `
				.workspace-split.mod-right-split { width: 980px !important; max-width: 980px !important; }
				.workspace-leaf-content[data-type="curtis-chat"] { width: 100% !important; }
				.notice-container { display: none !important; }
			`,
		});
		await page.evaluate(() => window.app.workspace.openLinkText('Daily/2026-10-02.md', ''));
		await page.waitForTimeout(800);

		for (const theme of THEMES) {
			console.log(`[arena] --- theme: ${theme} ---`);
			const meas = await page.evaluate(setBodyTheme, theme);
			if (theme === 'dark' ? meas.lum > 0.25 : meas.lum < 0.25) {
				throw new Error(`theme flip to ${theme} failed (bg rgb(${meas.bg}), lum ${meas.lum.toFixed(2)})`);
			}
			console.log(`[arena] theme ok — bg rgb(${meas.bg})`);

			const chatWidth = await ensureWideChat(page);
			console.log(`[arena] chat split width: ${chatWidth}px`);

			// glm-5.3 intermittently answers a 250-word ask with a ~40-char
			// stub — no timing scheme survives that, so gate on content and
			// re-roll the round (fresh conversation) until both columns carry
			// real text. Up to 3 attempts per theme.
			let accepted = false;
			for (let attempt = 1; attempt <= 3 && !accepted; attempt++) {
				console.log(`[arena] round ${attempt} for ${theme}`);
				await resetRound(page, ctx, PROVIDER_A, modelA.id);
				page = await startArena(page, ctx, modelB.name, attempt === 1 ? `arena-picker-${theme}.png` : null);
				page = await sendArenaPrompt(page, ctx);

				if (attempt === 1) {
					const colWidths = await page.evaluate(() =>
						Array.from(document.querySelectorAll('.ai-arena-column')).map((c) => c.clientWidth)
					);
					console.log(`[arena] column widths: ${colWidths.join('/')}px`);
					if (Math.min(...colWidths) < 320) console.log('[arena] WARNING: columns look cramped');
				}

				// Streaming shot: wait until column 1 (zai-glm flash) holds
				// real partial text — with a flash pair both columns are
				// visibly live at that point and the shot shows two real
				// streams, not one column beside a skeleton. Generous window:
				// z.ai TTFB swings from ~2s to ~30s run to run.
				let stoppedIdx = -1;
				const livePage = await pollVaultState(ctx, col0Live, 45000);
				let caughtLive = false;
				if (livePage) {
					page = livePage;
					await page.waitForTimeout(500);
					await page.evaluate(scrollArenaColumnsToEnd);
					await parkMouse(page);
					await page.screenshot({ path: resolve(OUT_DIR, `arena-streaming-${theme}.png`) });
					console.log(`[arena] arena-streaming-${theme}.png (column 1 live with text)`);
					caughtLive = true;

					// Stopped shot: halt column 1 while it holds partial
					// text; the sibling keeps streaming beside it. Captured
					// the instant column 1 settles, before the sibling can
					// finish (otherwise it is pixel-identical to final).
					// Streaming re-renders replace the button node on every
					// chunk, so Playwright's stability check can stall out —
					// click via JS dispatch and retry across re-renders.
					for (let click = 0; click < 4; click++) {
						try {
							await page.locator('.ai-arena-stop-btn').first().evaluate((el) => el.click());
							break;
						} catch { /* button detached mid-click — retry */ }
						await page.waitForTimeout(250);
					}
					const stoppedPage = await pollVaultState(ctx, col0Settled, 8000);
					if (!stoppedPage) console.log('[arena] WARNING: column 1 did not settle after stop');
					page = stoppedPage ?? page;
					await page.evaluate(scrollArenaColumnsToEnd);
					await parkMouse(page);
					await page.screenshot({ path: resolve(OUT_DIR, `arena-stopped-${theme}.png`) });
					console.log(`[arena] arena-stopped-${theme}.png (column 1 stopped mid-stream)`);
					stoppedIdx = 0;
				}

				try {
					page = await waitColumnsSettled(page, ctx);
				} catch {
					console.log('[arena] columns would not settle (hung stream) — aborting and re-rolling');
					await abortArenaStreams(page);
					continue;
				}
				const cols = await page.evaluate(diagnoseColumns);
				console.log('[arena] columns settled:', JSON.stringify(cols));
				// Content gate: both columns carry real text. The column we
				// deliberately stopped mid-stream only needs a partial (≥120);
				// everything else must be a full answer (≥300).
				const gateOk = cols.every((c, i) => {
					if (c.error) return false;
					return i === stoppedIdx ? c.chars >= 120 : c.chars >= 300;
				});
				if (!gateOk) {
					console.log(`[arena] WARNING: thin round (${cols.map((c) => c.chars).join('/')} chars) — re-rolling`);
					continue;
				}

				if (!caughtLive) {
					// No live moment caught (fast pair settled inside the
					// poll window) — the settled round is still a honest,
					// full-content shot.
					await page.evaluate(scrollChatToTop);
					await page.evaluate(scrollArenaColumnsToEnd);
					await page.waitForTimeout(400);
					await parkMouse(page);
					await page.screenshot({ path: resolve(OUT_DIR, `arena-streaming-${theme}.png`) });
					console.log(`[arena] arena-streaming-${theme}.png (settled — no live moment caught)`);
				}

				await page.waitForTimeout(1200);
				await page.evaluate(scrollChatToTop);
				await page.evaluate(scrollArenaColumnsToEnd);
				await parkMouse(page);
				await page.screenshot({ path: resolve(OUT_DIR, `arena-final-${theme}.png`) });
				console.log(`[arena] arena-final-${theme}.png`);
				// Guard against a stopped shot captured after everything
				// settled: it would be pixel-identical to final.
				const stoppedPath = resolve(OUT_DIR, `arena-stopped-${theme}.png`);
				const finalPath = resolve(OUT_DIR, `arena-final-${theme}.png`);
				if (existsSync(stoppedPath) && existsSync(finalPath) &&
					readFileSync(stoppedPath).equals(readFileSync(finalPath))) {
					console.log(`[arena] WARNING: stopped and final are identical for ${theme}`);
				}
				const storeAfterRound = await page.evaluate(storeSnapshot);
				console.log('[arena] store after round:', JSON.stringify(storeAfterRound?.messages));

				const promoteBtns = page.locator('.ai-arena-promote-btn:not([disabled])');
				if (await promoteBtns.count() > 0) {
					await promoteBtns.last().click();
					await page.waitForTimeout(2500);
					const postDom = await page.evaluate(() => ({
						arenaLayouts: document.querySelectorAll('.ai-arena-layout').length,
						assistantBubbles: document.querySelectorAll('.ai-message-assistant').length,
						userBubbles: document.querySelectorAll('.ai-message-user').length,
					}));
					console.log('[arena] post-promote DOM:', JSON.stringify(postDom));
					await parkMouse(page);
					await page.screenshot({ path: resolve(OUT_DIR, `arena-promoted-${theme}.png`) });
					console.log(`[arena] arena-promoted-${theme}.png`);
					const storeAfterPromote = await page.evaluate(storeSnapshot);
					console.log('[arena] store after promote:', JSON.stringify(storeAfterPromote?.messages));
				}
				accepted = true;
			}
			if (!accepted) console.log(`[arena] ERROR: no full round for ${theme} after 3 attempts — keeping the last shots`);
		}
	} finally {
		await shutdownInstance(inst);
		try { rmSync(resolve(VAULT, '.obsidian/workspace.json')); } catch { /* none */ }
	}
}

async function phonePass() {
	// Phone-width pass, same trick as capture-screenshots.mjs: dock the chat
	// LEFT, strip desktop chrome, emulate a 360×778 @2x DPR viewport (360 is
	// the plugin's real arena-stacking breakpoint; 778 cover-scales into the
	// 390×844 mockup frame with <1px crop). Capture via raw CDP so the DPR
	// override survives.
	console.log('[arena] pass 2: phone-width (360x778 @2x DPR) × both themes');
	const inst = await bootInstance(9226);
	try {
		let { page, ctx } = inst;
		await page.evaluate(configureForCapture);
		await page.evaluate(() => {
			const plugin = window.app.plugins.plugins['curtis-ai-chat'];
			plugin.settings.chatViewPosition = 'left';
			plugin.saveSettings();
		});

		const cdp = await ctx.newCDPSession(page);
		await cdp.send('Emulation.setDeviceMetricsOverride', {
			width: 360,
			height: 778,
			deviceScaleFactor: 2,
			mobile: true,
		});
		await page.evaluate(() => location.reload());
		page = await waitForVaultPage(
			ctx,
			() => !!window.app?.plugins?.plugins?.['curtis-ai-chat']?.conversationStore,
			45000,
			'phone reload'
		);
		await waitForVaultPage(
			ctx,
			() => !!window.app?.commands?.commands?.['curtis-ai-chat:open-chat'],
			15000,
			'command registration (phone)'
		);
		await patchDeepseekThinking(page);
		await page.evaluate(openChatAndRender);
		await page.addStyleTag({
			content: `
				.workspace-ribbon, .workspace-split.mod-root, .status-bar,
				.titlebar-button-container, .workspace-sidedock-vault-profile,
				.workspace-tabs .workspace-tab-header-container { display: none !important; }
				.workspace-split.mod-left-split { width: 100% !important; max-width: 100% !important; border: none !important; }
				.workspace-leaf-content[data-type="curtis-chat"] { width: 100% !important; }
				.workspace-tabs { flex: 1 !important; }
				.notice-container { display: none !important; }
			`,
		});
		const captureViaCdp = async (outName) => {
			const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
			writeFileSync(resolve(OUT_DIR, outName), Buffer.from(data, 'base64'));
		};

		const resolveModel = (pid, wanted) =>
			page.evaluate(
				([p, w]) => {
					const prov = window.app.plugins.plugins['curtis-ai-chat'].providerRegistry.getProvider(p);
					const m = prov?.models.find((x) => x.id === w) ?? prov?.models.find((x) => w && x.id.includes(w)) ?? prov?.models[0];
					return m ? { id: m.id, name: m.name } : null;
				},
				[pid, wanted]
			);
		const modelA = await resolveModel(PROVIDER_A, MODEL_A);
		const modelB = await resolveModel(PROVIDER_B, MODEL_B);
		if (!modelA || !modelB) throw new Error('could not resolve a model for both providers (phone)');
		if (modelA.id === modelB.id) throw new Error('both pair members resolved to the same model (phone)');

		for (const theme of THEMES) {
			console.log(`[arena] --- phone theme: ${theme} ---`);
			const meas = await page.evaluate(setBodyTheme, theme);
			if (theme === 'dark' ? meas.lum > 0.25 : meas.lum < 0.25) {
				throw new Error(`phone theme flip to ${theme} failed (bg rgb(${meas.bg}))`);
			}

			// Same content gate as the desktop pass: re-roll until both
			// columns carry real text (glm-5.3 intermittently stubs out).
			let accepted = false;
			for (let attempt = 1; attempt <= 3 && !accepted; attempt++) {
				await resetRound(page, ctx, PROVIDER_A, modelA.id);
				page = await startArena(page, ctx, modelB.name, null);
				page = await sendArenaPrompt(page, ctx);

				const stacked = await page.evaluate(() => {
					const layout = document.querySelector('.ai-arena-layout');
					if (!layout) return false;
					const cols = getComputedStyle(layout).gridTemplateColumns.split(' ').filter((t) => t !== '0px');
					return cols.length === 1;
				});
				console.log(`[arena] phone columns stacked: ${stacked}`);

				// Mobile: catching both columns mid-flight is a race the fast
				// sibling always loses — capture the settled stacked
				// comparison instead.
				try {
					page = await waitColumnsSettled(page, ctx);
				} catch {
					console.log('[arena] phone columns would not settle (hung stream) — aborting and re-rolling');
					await abortArenaStreams(page);
					continue;
				}
				const cols = await page.evaluate(diagnoseColumns);
				console.log('[arena] phone columns settled:', JSON.stringify(cols));
				if (!cols.every((c) => c.chars >= 300 && !c.error)) {
					console.log(`[arena] WARNING: thin phone round (${cols.map((c) => c.chars).join('/')} chars) — re-rolling`);
					continue;
				}
				await page.waitForTimeout(800);
				await page.evaluate(scrollChatToTop);
				await page.evaluate(scrollArenaColumnsToEnd);
				await page.waitForTimeout(300);
				await parkMouse(page);
				await captureViaCdp(`phone-arena-${theme}.png`);
				console.log(`[arena] phone-arena-${theme}.png (settled, stacked)`);

				const promoteBtns = page.locator('.ai-arena-promote-btn:not([disabled])');
				if (await promoteBtns.count() > 0) {
					await promoteBtns.last().click();
					await page.waitForTimeout(2200);
					await page.evaluate(scrollChatToTop);
					await page.waitForTimeout(400);
					await parkMouse(page);
					await captureViaCdp(`phone-arena-promoted-${theme}.png`);
					console.log(`[arena] phone-arena-promoted-${theme}.png`);
				}
				accepted = true;
			}
			if (!accepted) console.log(`[arena] ERROR: no full phone round for ${theme} after 3 attempts — keeping the last shots`);
		}
	} finally {
		await shutdownInstance(inst);
		try { rmSync(resolve(VAULT, '.obsidian/workspace.json')); } catch { /* none */ }
	}
}

// --- main --------------------------------------------------------------------

async function main() {
	const watchdog = setTimeout(() => {
		console.error('[arena] watchdog: exceeded 15 minutes — aborting');
		restoreLaunchVault();
		try { execSync('taskkill /IM Obsidian.exe /F', { stdio: 'ignore' }); } catch { /* not running */ }
		process.exit(9);
	}, 15 * 60 * 1000);
	watchdog.unref?.();

	bootstrapVault();
	registerDemoVault();
	mkdirSync(OUT_DIR, { recursive: true });
	console.log('[arena] closing Obsidian if running…');
	await killObsidian();

	// ARENA_PASS=desktop|phone runs a single pass (e.g. re-shooting just the
	// phone set after a hang) without gambling the other pass's good shots.
	const pass = process.env.ARENA_PASS;
	if (pass !== 'phone') await desktopPass();
	if (pass !== 'desktop') await phonePass();

	// Frame the hero phone shots (same treatment as npm run mockups).
	for (const theme of THEMES) {
		try {
			execSync(
				`python scripts/phone_mockup.py assets/screenshots/phone-arena-${theme}.png assets/screenshots/phone-arena-framed-${theme}.png`,
				{ cwd: ROOT, stdio: 'inherit' }
			);
		} catch (e) {
			console.log(`[arena] framing skipped for ${theme} (python/PIL unavailable): ${e.message}`);
		}
	}

	restoreLaunchVault();
	console.log('[arena] done — shots in assets/screenshots/');
	console.log('[arena] relaunching your Obsidian session…');
	spawn(OBSIDIAN_EXE, [], { detached: true, stdio: 'ignore' }).unref();
	clearTimeout(watchdog);
	process.exit(0);
}

main().catch((e) => {
	console.error('[arena] failed:', e);
	restoreLaunchVault();
	try { execSync('taskkill /IM Obsidian.exe /F', { stdio: 'ignore' }); } catch { /* not running */ }
	process.exit(1);
});
