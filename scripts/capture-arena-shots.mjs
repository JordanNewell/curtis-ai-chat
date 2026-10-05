// Arena-mode test captures for Curtis AI Chat.
//
// Same machinery as capture-screenshots.mjs (real Obsidian on the demo vault,
// driven over CDP), but exercises the arena flow end-to-end with the two
// key'd providers (zai-glm + deepseek): picker modal, parallel streaming,
// per-column stop, and promote-to-chat. Verifies store behavior after each
// step and saves shots to assets/screenshots/.
//
// Usage:  node scripts/capture-arena-shots.mjs
// Env:    OBSIDIAN_EXE (default: %LOCALAPPDATA%\Programs\Obsidian\Obsidian.exe)
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

const OBSIDIAN_EXE =
	process.env.OBSIDIAN_EXE ||
	resolve(process.env.LOCALAPPDATA, 'Programs/Obsidian/Obsidian.exe');

// The arena pair — the two providers with keychain keys. Turbos/flashes keep
// the run cheap and fast.
const PROVIDER_A = 'zai-glm';
const MODEL_A = 'glm-5-turbo';
const PROVIDER_B = 'deepseek';
const MODEL_B = 'deepseek-v4-flash';

const PROMPT =
	'Write a tight 120-word comparison of side-by-side model testing versus picking an LLM from leaderboards. Use two bullet points and one closing sentence. No preamble.';

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
	const child = spawn(OBSIDIAN_EXE, [VAULT, `--remote-debugging-port=${port}`], {
		detached: false,
		stdio: 'ignore',
	});

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

/** Point the active provider at the arena pair's first member so the picker
 *  pre-selects it; also start from a clean conversation. */
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
			tokens: m.tokens?.totalTokens ?? null,
		})),
	};
};

async function main() {
	const watchdog = setTimeout(() => {
		console.error('[arena] watchdog: exceeded 8 minutes — aborting');
		restoreLaunchVault();
		try { execSync('taskkill /IM Obsidian.exe /F', { stdio: 'ignore' }); } catch { /* not running */ }
		process.exit(9);
	}, 8 * 60 * 1000);
	watchdog.unref?.();

	bootstrapVault();
	registerDemoVault();
	mkdirSync(OUT_DIR, { recursive: true });
	console.log('[arena] closing Obsidian if running…');
	await killObsidian();

	const inst = await bootInstance(9225);
	try {
		let { page, ctx } = inst;

		// Preflight: providers + keys + model lists.
		const report = await page.evaluate(authReport);
		console.log('[arena] enabled providers:', JSON.stringify(report));
		const authed = Object.fromEntries(report.map((r) => [r.id, r]));
		for (const [pid, mid] of [[PROVIDER_A, MODEL_A], [PROVIDER_B, MODEL_B]]) {
			if (!authed[pid]?.authed) throw new Error(`${pid} is not authenticated — key missing from keychain`);
			if (authed[pid].models === 0) throw new Error(`${pid} has no models loaded`);
		}
		if (!report.some((r) => r.id === PROVIDER_A && r.models > 0 && r.authed) ||
			!report.some((r) => r.id === PROVIDER_B && r.authed)) {
			throw new Error('arena pair not ready — see provider report above');
		}
		// Curated models exist statically; if auto-discovery replaced the
		// curated ids, fall back to each provider's first model.
		const resolveModel = (pid, wanted) =>
			page.evaluate(
				([p, w]) => {
					const prov = window.app.plugins.plugins['curtis-ai-chat'].providerRegistry.getProvider(p);
					const m = prov?.models.find((x) => x.id === w) ?? prov?.models[0];
					return m ? { id: m.id, name: m.name } : null;
				},
				[pid, wanted]
			);
		const modelA = await resolveModel(PROVIDER_A, MODEL_A);
		const modelB = await resolveModel(PROVIDER_B, MODEL_B);
		if (!modelA || !modelB) throw new Error('could not resolve a model for both providers');
		console.log(`[arena] pair: ${PROVIDER_A}/${modelA.id} vs ${PROVIDER_B}/${modelB.id}`);

		await page.evaluate(
			([a, m]) => {
				const plugin = window.app.plugins.plugins['curtis-ai-chat'];
				plugin.settings.activeProvider = a;
				plugin.settings.activeModel = m;
				plugin.saveSettings();
				plugin.conversationStore.createConversation(a, m);
			},
			[PROVIDER_A, modelA.id]
		);

		await page.evaluate(openChatAndRender);
		page = await waitForVaultPage(ctx, () => !!document.querySelector('.ai-chat-arena-btn'), 20000, 'chat header');
		console.log('[arena] chat view open');

		// --- 1. Picker -----------------------------------------------------
		await page.click('.ai-chat-arena-btn');
		page = await waitForVaultPage(ctx, () => !!document.querySelector('.ai-arena-picker-modal'), 10000, 'picker modal');
		// Rows display model NAMES — click by name, not id.
		await page.evaluate((name) => {
			const rows = Array.from(document.querySelectorAll('.ai-arena-picker-row'));
			const row = rows.find((r) => r.querySelector('.ai-arena-picker-name')?.textContent === name);
			if (!row) throw new Error('picker row not found for ' + name);
			row.click();
		}, modelB.name);
		await page.waitForTimeout(400);
		const counter = await page.locator('.ai-arena-picker-counter').textContent();
		console.log(`[arena] picker counter: "${counter?.trim()}"`);
		await page.screenshot({ path: resolve(OUT_DIR, 'arena-picker.png') });
		console.log('[arena] arena-picker.png');

		await page.locator('.ai-arena-picker-start').click();
		await page.waitForTimeout(600);
		const arenaActive = await page.locator('.ai-chat-arena-btn.is-active').count();
		if (arenaActive !== 1) throw new Error('arena toggle did not activate after Start');

		// --- 2. Send + streaming -------------------------------------------
		const input = page.locator('.ai-chat-input');
		await input.fill(PROMPT);
		await page.click('.ai-chat-send-btn');
		page = await waitForVaultPage(ctx, () => document.querySelectorAll('.ai-arena-column').length === 2, 20000, 'two columns');
		console.log('[arena] two columns live');
		await page.waitForTimeout(2600);
		const shot = (name) => page.screenshot({ path: resolve(OUT_DIR, name) });
		await shot('arena-streaming.png');
		console.log('[arena] arena-streaming.png');

		// --- 3. Per-column stop ---------------------------------------------
		const stopBtns = page.locator('.ai-arena-stop-btn');
		const stopCount = await stopBtns.count();
		console.log(`[arena] stop buttons present: ${stopCount}`);
		if (stopCount > 0) {
			await stopBtns.first().click();
			await page.waitForTimeout(900);
			await shot('arena-stopped.png');
			console.log('[arena] arena-stopped.png (column 1 stopped)');
		}

		// --- 4. Wait for the other column to settle --------------------------
		page = await waitForVaultPage(
			ctx,
			() => document.querySelectorAll('.ai-arena-column .ai-arena-stop-btn').length === 0
				&& document.querySelectorAll('.ai-arena-column-response').length === 2,
			120000,
			'all columns settled'
		);
		await page.waitForTimeout(1200);
		await shot('arena-final.png');
		console.log('[arena] arena-final.png');
		const storeAfterRound = await page.evaluate(storeSnapshot);
		console.log('[arena] store after round:', JSON.stringify(storeAfterRound?.messages));

		// --- 5. Promote -------------------------------------------------------
		// Promote the column that is NOT the stopped one (the second column
		// kept streaming). Promote buttons are enabled once content exists.
		const promoteBtns = page.locator('.ai-arena-promote-btn:not([disabled])');
		const promotable = await promoteBtns.count();
		console.log(`[arena] promotable columns: ${promotable}`);
		if (promotable > 0) {
			await promoteBtns.last().click();
			await page.waitForTimeout(2500);
			const postDom = await page.evaluate(() => ({
				arenaLayouts: document.querySelectorAll('.ai-arena-layout').length,
				assistantBubbles: document.querySelectorAll('.ai-message-assistant').length,
				userBubbles: document.querySelectorAll('.ai-message-user').length,
			}));
			console.log('[arena] post-promote DOM:', JSON.stringify(postDom));
			await shot('arena-promoted.png');
			console.log('[arena] arena-promoted.png');
			const storeAfterPromote = await page.evaluate(storeSnapshot);
			console.log('[arena] store after promote:', JSON.stringify(storeAfterPromote?.messages));
			const arenaStillOn = await page.locator('.ai-chat-arena-btn.is-active').count();
			console.log(`[arena] arena toggle active after promote: ${arenaStillOn === 1}`);
		}
	} finally {
		await shutdownInstance(inst);
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
