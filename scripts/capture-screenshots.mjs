// Automated screenshot capture for Curtis AI Chat.
//
// Boots Obsidian with the demo vault (plugin pre-installed), drives the UI
// through Obsidian's command/settings APIs over the Chrome DevTools Protocol,
// seeds a realistic agent conversation, and saves desktop + mobile shots to
// assets/screenshots/.
//
// Two passes: desktop at full window size, then a fresh launch with
// --window-size=400,830 for the mobile shots (Electron ignores in-page
// viewport emulation and resizeTo on a maximized window; a fresh small window
// is the only reliable way to get a phone-width layout).
//
// Usage:  npm run shots
// Env:    OBSIDIAN_EXE (default: %LOCALAPPDATA%\Programs\Obsidian\Obsidian.exe)
//
// The user's running Obsidian is closed for the duration (nothing is lost —
// Obsidian autosaves) and relaunched at the end.

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
	resolve(process.env.LOCALAPPDATA, 'Programs/Obsidian/Obsidian.exe');

// ---------------------------------------------------------------------------
// Vault bootstrap
// ---------------------------------------------------------------------------

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
	// A few real notes so the file explorer looks alive in full-window shots.
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
		'Daily/2026-09-30.md': [
			'# 2026-09-30',
			'',
			'- Mapped the agent tool-calling architecture',
			'- Found the ghost calculator tool bug',
			'- Comparison table refresh vs Copilot v4',
		].join('\n'),
		'Projects/Curtis AI Chat.md': [
			'# Curtis AI Chat',
			'',
			'Polyglot AI chat for Obsidian. 30+ providers, agent mode, arena.',
			'',
			'## v1.1 shipped',
			'- Anthropic native tool use',
			'- Calculator tool',
			'- Honest provider copy',
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
}

/**
 * Register the demo vault in Obsidian's registry and make it the vault the
 * app restores on launch. Without this, Obsidian ignores the vault-folder
 * launch argument and reopens the last session's vault. Additive only —
 * removable via the vault switcher; the user's original launch vault is
 * restored at the end of the run.
 */
function registerDemoVault() {
	const p = resolve(process.env.APPDATA, 'obsidian', 'obsidian.json');
	let d = {};
	try { d = JSON.parse(readFileSync(p, 'utf8')); } catch { /* fresh */ }
	if (!d || typeof d !== 'object' || Array.isArray(d)) d = {};
	const vaults = (d.vaults ??= {});
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

/** Put the user's original launch-vault selection back (newell > demo). */
function restoreLaunchVault() {
	try {
		const p = resolve(process.env.APPDATA, 'obsidian', 'obsidian.json');
		const d = JSON.parse(readFileSync(p, 'utf8'));
		let hasOther = false;
		for (const v of Object.values(d.vaults || {})) {
			if (v && typeof v === 'object') {
				v.open = v.path === 'E:\\vaults\\newell';
				if (v.open) hasOther = true;
			}
		}
		if (!hasOther) {
			for (const v of Object.values(d.vaults || {})) {
				if (v && v.path !== VAULT) { v.open = true; break; }
			}
		}
		writeFileSync(p, JSON.stringify(d, null, 2));
	} catch { /* best effort */ }
}

// ---------------------------------------------------------------------------
// Page-side helpers (serialized into the renderer by Playwright)
// ---------------------------------------------------------------------------

const SEED_MESSAGES = [
	{
		role: 'user',
		content: 'Summarize my week from the daily notes and file it under Weekly/.',
		attachedNotes: ['Daily/2026-10-02.md'],
	},
	{
		role: 'assistant',
		content: '',
		tool_calls: [{ id: 'tc_1', name: 'read_note', arguments: { path: 'Daily/2026-10-02.md' } }],
	},
	{
		role: 'tool',
		content: '(read 412 words from Daily/2026-10-02.md)',
		tool_call_id: 'tc_1',
	},
	{
		role: 'assistant',
		content: [
			'**Week of Sep 28 - Oct 2**',
			'',
			'- **v1.1.0 shipped** - agent mode now works on every provider (Anthropic native tool use landed).',
			'- **Fixed #6** - LM Studio/Ollama no longer prompt for an API key they never needed.',
			'- **Launch prep** - r/ObsidianMD post drafted, comparison table refreshed.',
			'- Ran 5k twice, coffee ratio locked in at 1:16.',
			'',
			'Filed under Weekly/2026-W40.md.',
		].join('\n'),
		provider: 'ollama',
		model: 'qwen2.5:7b-instruct',
		tokens: { promptTokens: 1834, completionTokens: 96, totalTokens: 1930 },
	},
];

const seedConversation = (messages) => {
	const plugin = window.app.plugins.plugins['curtis-ai-chat'];
	if (!plugin) throw new Error('plugin not loaded');
	const store = plugin.conversationStore;
	const conv = store.createConversation('ollama', 'qwen2.5:7b-instruct');
	for (const m of messages) store.addMessage(m);
	store.setCurrentConversation(conv.id);
	return conv.id;
};

const selectLatestConversation = () => {
	const plugin = window.app.plugins.plugins['curtis-ai-chat'];
	const convs = plugin.conversationStore.getAllConversations();
	if (convs.length > 0) plugin.conversationStore.setCurrentConversation(convs[0].id);
	return convs[0]?.id ?? null;
};

const enableOllama = () => {
	const plugin = window.app.plugins.plugins['curtis-ai-chat'];
	plugin.settings.providerConfigs.ollama = Object.assign(
		{ enabled: true },
		plugin.settings.providerConfigs.ollama || {}
	);
	plugin.settings.providerConfigs.ollama.enabled = true;
	plugin.saveSettings();
	return true;
};

const openChatAndRender = async () => {
	window.app.commands.executeCommandById('curtis-ai-chat:open-chat');
	// Wait for the view's DOM to exist before forcing a re-render —
	// refreshChatViews on a half-constructed view is a no-op at best.
	const deadline = Date.now() + 10000;
	while (Date.now() < deadline) {
		if (document.querySelector('.workspace-leaf-content[data-type="curtis-chat"]')) break;
		await new Promise((r) => setTimeout(r, 200));
	}
	window.app.plugins.plugins['curtis-ai-chat'].refreshChatViews?.();
};

const scrollChatToTop = () => {
	const els = document.querySelectorAll(
		'.workspace-leaf-content[data-type="curtis-chat"] .view-content, .workspace-leaf-content[data-type="curtis-chat"] .curtis-messages'
	);
	for (const c of els) c.scrollTop = 0;
	return els.length;
};

// ---------------------------------------------------------------------------
// Boot + attach
// ---------------------------------------------------------------------------

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

/**
 * Poll all windows until one belongs to demo-vault AND satisfies `pred`.
 * Re-queries pages every cycle so renderer reloads never leave us holding
 * a stale page handle.
 */
async function waitForVaultPage(ctx, pred, timeoutMs, label) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		for (const p of ctx.pages()) {
			try {
				const vault = await p.evaluate(() => window.app?.vault?.getName?.());
				if (vault !== 'demo-vault') continue;
				if (await p.evaluate(pred)) return p;
			} catch { /* stale/closed page — retry */ }
		}
		await new Promise((r) => setTimeout(r, 1000));
	}
	throw new Error(`timeout waiting for demo-vault page state: ${label}`);
}

/** Poll all pages (any window — includes Obsidian 1.13's settings window). */
async function waitForAnyPage(ctx, pred, timeoutMs, label) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		for (const p of ctx.pages()) {
			try {
				if (await p.evaluate(pred)) return p;
			} catch { /* stale/closed page — retry */ }
		}
		await new Promise((r) => setTimeout(r, 1000));
	}
	throw new Error(`timeout waiting for page state: ${label}`);
}

async function killObsidian() {
	try {
		execSync('taskkill /IM Obsidian.exe /F', { stdio: 'ignore' });
	} catch { /* not running */ }
	await new Promise((r) => setTimeout(r, 2500));
}

/**
 * Launch Obsidian on the demo vault with a debug port and return a fully
 * booted handle: plugin enabled, onload complete, commands registered.
 */
async function bootInstance(port, extraArgs = []) {
	const child = spawn(OBSIDIAN_EXE, [VAULT, `--remote-debugging-port=${port}`, ...extraArgs], {
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
	const logLine = (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[obsidian] ${m.type()}: ${m.text().slice(0, 200)}`); };
	const bind = (p) => {
		p.on('console', logLine);
		p.on('pageerror', (e) => console.log(`[obsidian] pageerror: ${e.message.slice(0, 200)}`));
	};
	for (const p of ctx.pages()) bind(p);
	ctx.on('page', bind);

	// Trust-author modal on fresh vaults. Clicking it reloads the renderer,
	// which is why every later page access re-resolves.
	let page = await waitForVaultPage(ctx, () => true, 30000, 'window');
	try {
		await page.getByRole('button', { name: /trust/i }).click({ timeout: 8000 });
		console.log('[shots] dismissed trust-vault modal');
	} catch { /* no modal — vault already trusted */ }

	// The trust grant doesn't always survive force-kills between runs — the
	// plugin can end up loaded-but-disabled (restricted mode) with no modal
	// shown. Enable programmatically; no-op when already enabled.
	await page.evaluate(async () => {
		try { await window.app.plugins.enablePlugin('curtis-ai-chat'); } catch { /* restricted or already on */ }
	});

	// conversationStore is created in onload step 3 (after settings, before
	// commands) — its presence means the full init sequence completed.
	page = await waitForVaultPage(
		ctx,
		() => !!window.app?.plugins?.plugins?.['curtis-ai-chat']?.conversationStore,
		45000,
		'plugin onload'
	);
	// Commands register in onload step 5 — executing before that silently
	// no-ops.
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

// ---------------------------------------------------------------------------
// Main — two passes
// ---------------------------------------------------------------------------

async function main() {
	const watchdog = setTimeout(() => {
		console.error('[shots] watchdog: exceeded 6 minutes — aborting');
		restoreLaunchVault();
		try { execSync('taskkill /IM Obsidian.exe /F', { stdio: 'ignore' }); } catch { /* not running */ }
		process.exit(9);
	}, 6 * 60 * 1000);
	watchdog.unref?.();

	bootstrapVault();
	registerDemoVault();
	mkdirSync(OUT_DIR, { recursive: true });
	console.log('[shots] closing Obsidian if running…');
	await killObsidian();

	// ---- Pass 1: desktop ----
	console.log('[shots] pass 1: desktop');
	const desk = await bootInstance(9222);
	try {
		let { page, ctx } = desk;
		await page.evaluate(enableOllama);
		await page.evaluate(seedConversation, SEED_MESSAGES);
		console.log('[shots] seeded conversation + enabled Ollama');

		await page.evaluate(openChatAndRender);
		// A real note behind the chat makes the vault look lived-in.
		await page.evaluate(() => window.app.workspace.openLinkText('Daily/2026-10-02.md', ''));
		page = await waitForVaultPage(
			ctx,
			() => document.body.innerText.includes('Week of Sep 28'),
			30000,
			'seeded conversation rendered'
		);
		await page.evaluate(scrollChatToTop);
		await page.waitForTimeout(1500);
		await page.screenshot({ path: resolve(OUT_DIR, 'desktop-chat.png') });
		console.log('[shots] desktop-chat.png');

		await page.evaluate(() => {
			window.app.setting.open();
			window.app.setting.openTabById('curtis-ai-chat');
		});
		const settingsPage = await waitForAnyPage(
			ctx,
			() => document.body.innerText.includes('Provider configuration'),
			20000,
			'settings open'
		);
		await settingsPage.evaluate(() => {
			const el = Array.from(document.querySelectorAll('.setting-item-heading, h3, h2')).find(
				(e) => e.textContent?.includes('Provider configuration')
			);
			el?.scrollIntoView({ block: 'start' });
		});
		await settingsPage.waitForTimeout(800);
		await settingsPage.screenshot({ path: resolve(OUT_DIR, 'desktop-settings-providers.png') });
		console.log('[shots] desktop-settings-providers.png');
	} finally {
		// Reset the workspace so the mobile pass starts with a fresh (small)
		// window instead of restoring maximized bounds.
		await shutdownInstance(desk);
		try { rmSync(resolve(VAULT, '.obsidian/workspace.json')); } catch { /* none */ }
	}

	// ---- Pass 2: phone-width shots ----
	// Emulation renders fine as long as Obsidian's desktop chrome is left
	// alone (the is-mobile body class blanks it). So: dock the chat to the
	// LEFT, hide the ribbon/editor/status bar via injected CSS, and the
	// emulated viewport becomes a clean full-bleed phone screen — captured at
	// 2x DPR (900x1600, the directory's recommended mobile size).
	console.log('[shots] pass 2: phone-width (450x800 @2x DPR, chat docked left)');
	const mob = await bootInstance(9223);
	try {
		let { page, ctx } = mob;
		// Persisted settings: dock the chat panel on the left for phone framing.
		await page.evaluate(() => {
			const plugin = window.app.plugins.plugins['curtis-ai-chat'];
			plugin.settings.chatViewPosition = 'left';
			plugin.saveSettings();
		});
		// Phone metrics at 2x DPR via raw CDP. Page-level session — Obsidian's
		// build exposes Emulation domains there, but not Browser.* domains.
		const cdp = await ctx.newCDPSession(page);
		await cdp.send('Emulation.setDeviceMetricsOverride', {
			width: 450,
			height: 800,
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
		await page.evaluate(selectLatestConversation);
		await page.evaluate(() => {
			window.app.workspace.getLeavesOfType('curtis-chat').forEach((l) => l.detach());
		});
		await page.evaluate(openChatAndRender);
		page = await waitForVaultPage(
			ctx,
			() => document.body.innerText.includes('Week of Sep 28'),
			30000,
			'phone chat rendered'
		);
		// Strip desktop chrome so the emulated viewport is pure app surface.
		await page.addStyleTag({
			content: `
				.workspace-ribbon, .workspace-split.mod-root, .status-bar,
		.titlebar-button-container, .workspace-sidedock-vault-profile,
				.workspace-tabs .workspace-tab-header-container { display: none !important; }
				.workspace-split.mod-left-split { width: 100% !important; max-width: 100% !important; border: none !important; }
				.workspace-leaf-content[data-type="curtis-chat"] { width: 100% !important; }
				.workspace-tabs { flex: 1 !important; }
			`,
		});
		await page.evaluate(scrollChatToTop);
		await page.waitForTimeout(1500);
		// Capture via raw CDP — Playwright's screenshot imposes 1x capture
		// metrics and clobbers the DPR override; Page.captureScreenshot
		// respects it (900x1600 physical).
		const captureViaCdp = async (outName) => {
			const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
			writeFileSync(resolve(OUT_DIR, outName), Buffer.from(data, 'base64'));
		};
		await captureViaCdp('phone-chat.png');
		console.log('[shots] phone-chat.png');
		// Second mobile shot: scrolled to the bottom — input box + last reply.
		await page.evaluate(() => {
			const els = document.querySelectorAll(
				'.workspace-leaf-content[data-type="curtis-chat"] .view-content, .workspace-leaf-content[data-type="curtis-chat"] .curtis-messages'
			);
			for (const c of els) c.scrollTop = c.scrollHeight;
		});
		await page.waitForTimeout(700);
		await captureViaCdp('phone-chat-bottom.png');
		console.log('[shots] phone-chat-bottom.png');

		await page.evaluate(() => {
			window.app.setting.open();
			window.app.setting.openTabById('curtis-ai-chat');
		});
		const settingsPage = await waitForAnyPage(
			ctx,
			() => document.body.innerText.includes('Provider configuration'),
			20000,
			'settings open'
		);
		await settingsPage.waitForTimeout(800);
		// Element crop of the Ollama section — no key field by design.
		const ollamaSection = settingsPage
			.locator('.ai-provider-settings')
			.filter({ hasText: 'Ollama' })
			.last();
		await ollamaSection.scrollIntoViewIfNeeded().catch(() => {});
		await settingsPage.waitForTimeout(400);
		await ollamaSection.screenshot({ path: resolve(OUT_DIR, 'ollama-provider-settings.png') });
		console.log('[shots] ollama-provider-settings.png');
	} finally {
		await shutdownInstance(mob);
	}

	restoreLaunchVault();
	console.log('[shots] done — assets in assets/screenshots/');
	console.log('[shots] relaunching your Obsidian session…');
	spawn(OBSIDIAN_EXE, [], { detached: true, stdio: 'ignore' }).unref();
	clearTimeout(watchdog);
	process.exit(0);
}

main().catch((e) => {
	console.error('[shots] failed:', e);
	restoreLaunchVault();
	try { execSync('taskkill /IM Obsidian.exe /F', { stdio: 'ignore' }); } catch { /* not running */ }
	process.exit(1);
});
