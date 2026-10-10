// Multi-pane + notifications smoke test — drives the real plugin inside real
// Obsidian (same harness contract as v2-smoke, minus the relaunch: the user's
// running Obsidian is closed for the duration and NOT reopened afterwards).
//
//   P1  baseline send on pane one
//   P2  "Open new chat tab" → two distinct ChatViews, new tab starts fresh
//   P3  independent conversations — pane two's new chat leaves pane one alone
//   P4  cross-pane sync — a send in pane two re-renders pane one (same conv)
//   P5  delete-rebind — deleting the bound conversation rebinds every pane
//   N1  completion notification fires when the chat isn't visible
//   N2  suppressed while the user is viewing the pane
//   N3  no notification for an aborted stream
//   A1  arena round → exactly one notification listing both models
//
// AI responses are faked by monkeypatching plugin.callAI; system notifications
// are faked with a spy Notification class; focus is faked by patching
// Document.prototype.hasFocus. Everything else (views, store, events) is real.
//
// Usage: npm run smoke:panes

import { spawn, execSync } from 'node:child_process';
import { cpSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VAULT = resolve(ROOT, 'demo-vault');
const PLUGIN_DIR = resolve(VAULT, '.obsidian/plugins/curtis-ai-chat');
const DEBUG_PORT = 9334;

const OBSIDIAN_EXE =
	process.env.OBSIDIAN_EXE ||
	resolve(process.env.USERPROFILE ?? process.env.HOME, 'scoop/apps/obsidian/current/Obsidian.exe');

let pass = 0, fail = 0;
const ok = (cond, name, detail = '') => {
	const mark = cond ? 'PASS' : 'FAIL';
	console.log(`[${mark}] ${name}${detail && !cond ? ` — ${detail}` : ''}`);
	cond ? pass++ : fail++;
};

// Console gate: errors whose text or source URL names plugin:curtis-ai-chat
// fail the run even when every assertion passes. Anything else (core Obsidian,
// theme ENOENTs, other plugins) is surfaced but never gates.
const pluginErrors = [];
const watchPluginErrors = (text, url = '') => {
	const s = `${text}\n${url}`;
	if (!s.includes('plugin:curtis-ai-chat')) return;
	if (!pluginErrors.includes(text)) pluginErrors.push(text);
};
const reportConsoleGate = () => {
	if (pluginErrors.length > 0) {
		console.log(`[smoke] FAIL: ${pluginErrors.length} plugin console error(s):`);
		for (const e of pluginErrors) console.log(`[obsidian] ${e}`);
	} else {
		console.log('[smoke] console clean');
	}
};

// ---------------------------------------------------------------------------
// Vault bootstrap (mirrors v2-smoke.mjs)
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
}

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
		if (originalLaunchVault) {
			const byId = vaults[originalLaunchVault.id];
			if (byId && byId.path === originalLaunchVault.path) byId.open = true;
			else {
				for (const v of Object.values(vaults)) {
					if (v && v.path === originalLaunchVault.path) { v.open = true; break; }
				}
			}
		}
		writeFileSync(p, JSON.stringify(d, null, 2));
	} catch { /* best effort */ }
}

async function waitForDebugPort(ms) {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
			if (res.ok) return true;
		} catch { /* not up yet */ }
		await new Promise((r) => setTimeout(r, 500));
	}
	return false;
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(page, expr, timeoutMs, label) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await page.evaluate(expr)) return true;
		await sleep(200);
	}
	throw new Error(`timeout: ${label}`);
}

// ---------------------------------------------------------------------------
// In-page helpers — installed once as window.__smoke
// ---------------------------------------------------------------------------

const INSTALL_HELPERS = `(() => {
	const sleepP = (ms) => new Promise((r) => setTimeout(r, ms));
	window.__smoke = {
		plugin: () => window.app.plugins.plugins['curtis-ai-chat'],
		chatViews: () => window.app.workspace.getLeavesOfType('curtis-chat').map((l) => l.view),
		chatView() {
			const views = this.chatViews();
			if (views.length === 0) throw new Error('no chat view open');
			return views[0];
		},
		async openChat() {
			window.app.commands.executeCommandById('curtis-ai-chat:open-chat');
			const deadline = Date.now() + 10000;
			while (Date.now() < deadline) {
				// Wait for the COMPOSER, not just the leaf — the leaf-content
				// element exists before async onOpen finishes, and driving a
				// half-open view (no textarea/imageStrip) crashes the helpers.
				if (document.querySelector('.workspace-leaf-content[data-type="curtis-chat"] .ai-chat-input-wrap')) return true;
				await sleepP(200);
			}
			throw new Error('chat view never opened');
		},
		openNewTab() {
			window.app.commands.executeCommandById('curtis-ai-chat:open-new-chat-tab');
		},
		/** Deterministic offline AI. chunkDelay controls stream length so the
		 *  abort test has a window to click Stop in. Both call paths are
		 *  faked — the agent loop uses callProviderOnce, not callAI. */
		installFakeAI(chunkDelay = 40) {
			const p = this.plugin();
			const fakeText = (messages) => {
				const sys = messages[0]?.role === 'system' ? String(messages[0].content) : '';
				if (sys.includes('extract DURABLE facts')) return JSON.stringify([]);
				if (sys.includes('terse bullet points')) return '- Smoke recap bullet';
				return 'Fake reply from the smoke-test model. Deterministic.';
			};
			p.callAI = async (messages, _modelId, cb = {}) => {
				await sleepP(80);
				const text = fakeText(messages);
				const mid = Math.ceil(text.length / 2);
				for (const piece of [text.slice(0, mid), text.slice(mid)]) {
					cb.onChunk?.(piece);
					await sleepP(chunkDelay);
				}
				cb.onUsage?.({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
			};
			p.callProviderOnce = async (provider, messages) => {
				await sleepP(80);
				return { content: fakeText(messages), usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } };
			};
			return true;
		},
		/** Spy on system notifications. notifyResponse checks the static
		 *  permission getter, so the spy has to satisfy it. */
		spyNotifications() {
			window.__notifs = [];
			window.__origNotification = window.Notification;
			window.Notification = class {
				constructor(title, options) { window.__notifs.push({ title, body: options?.body ?? '' }); }
				close() {}
				onclick = null;
				static get permission() { return 'granted'; }
				static requestPermission() { return Promise.resolve('granted'); }
			};
		},
		restoreNotifications() {
			if (window.__origNotification) window.Notification = window.__origNotification;
		},
		/** isChatVisible() = document.hasFocus() && activeView === pane. Patch
		 *  the focus half; the caller arranges the active leaf. */
		patchHasFocus(v) {
			if (!window.__origHasFocus) window.__origHasFocus = Document.prototype.hasFocus;
			Document.prototype.hasFocus = () => v;
		},
		restoreHasFocus() {
			if (window.__origHasFocus) Document.prototype.hasFocus = window.__origHasFocus;
		},
	};
	return true;
})()`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	bootstrapVault();
	registerDemoVault();
	try { execSync('taskkill /IM Obsidian.exe /F', { stdio: 'ignore' }); } catch { /* not running */ }
	await sleep(2500);

	const child = spawn(OBSIDIAN_EXE, [
		VAULT,
		`--remote-debugging-port=${DEBUG_PORT}`,
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
	if (!browser) { child.kill(); throw new Error('could not attach to the debug port'); }
	const ctx = browser.contexts()[0];
	const logLine = (m) => {
		if (m.type() !== 'error') return;
		console.log(`[obsidian] ${m.text().slice(0, 160)}`);
		watchPluginErrors(m.text(), m.location()?.url);
	};
	// Uncaught exceptions / unhandled rejections surface as pageerror, not console.
	const pageError = (e) => watchPluginErrors(e?.stack ?? String(e));
	for (const p of ctx.pages()) { p.on('console', logLine); p.on('pageerror', pageError); }
	ctx.on('page', (p) => { p.on('console', logLine); p.on('pageerror', pageError); });

	let finished = false;
	browser.on('disconnected', () => {
		if (finished) return;
		console.error('[smoke] fatal: Obsidian (CDP) disconnected mid-run');
		restoreLaunchVault();
		process.exit(1);
	});
	setTimeout(() => {
		console.error('[smoke] fatal: watchdog timeout (4 min) — aborting');
		try { execSync('taskkill /IM Obsidian.exe /F', { stdio: 'ignore' }); } catch { /* not running */ }
		restoreLaunchVault();
		process.exit(1);
	}, 240000);

	const created = { convIds: [] };
	const origSettings = {};
	let page = await waitForVaultPage(ctx, () => true, 30000, 'window');
	try {
		await page.getByRole('button', { name: /trust/i }).click({ timeout: 8000 });
	} catch { /* already trusted */ }
	await page.evaluate(async () => {
		try { await window.app.plugins.enablePlugin('curtis-ai-chat'); } catch { /* already on */ }
	});
	page = await waitForVaultPage(
		ctx,
		() => !!window.app.plugins.plugins['curtis-ai-chat']?.conversationStore,
		30000,
		'plugin onload complete'
	);
	console.log('[smoke] plugin loaded');
	await page.evaluate(INSTALL_HELPERS);
	await page.evaluate(() => __smoke.openChat());
	// The demo vault's saved workspace can carry chat panes and center splits
	// from earlier capture/smoke runs. Collapse the center FIRST (a surviving
	// chat pane may itself live there), then reduce to one chat pane — and
	// recreate one if the collapse removed them all.
	await page.evaluate(() => {
		const root = window.app.workspace.rootSplit;
		for (const child of (root.children ?? []).slice(1)) child.detach?.();
		const leaves = window.app.workspace.getLeavesOfType('curtis-chat');
		for (const l of leaves.slice(1)) l.detach();
	});
	await page.evaluate(() => {
		if (window.app.workspace.getLeavesOfType('curtis-chat').length === 0) {
			window.app.commands.executeCommandById('curtis-ai-chat:open-chat');
		}
	});
	// The command path above doesn't wait for onOpen — hold here until the
	// composer exists, for the same half-open-view reason as openChat().
	await until(page, () => !!document.querySelector('.ai-chat-view .ai-chat-input-wrap'), 10000, 'chat composer ready');
	await until(page, () => __smoke.chatViews().length === 1, 5000, 'normalized to one pane');
	// Stable identity for pane one — the second pane opens in the CENTER area,
	// which changes getLeavesOfType order, so index-based access is not stable.
	await page.evaluate(() => {
		__smoke.p1 = __smoke.chatViews()[0];
	});
	await page.evaluate(() => __smoke.installFakeAI());

	// Snapshot settings we mutate so cleanup can restore them.
	Object.assign(origSettings, await page.evaluate(() => ({
		notifyOnCompletion: __smoke.plugin().settings.notifyOnCompletion,
		notifyOnError: __smoke.plugin().settings.notifyOnError,
		activeProvider: __smoke.plugin().settings.activeProvider,
		enableAgent: __smoke.plugin().settings.enableAgent,
		enableMemory: __smoke.plugin().settings.enableMemory,
	})));
	// The vault's saved active provider may only have a keychain ref this
	// machine can't resolve — pin ollama (enabled, keyless) so the auth gate
	// passes. The fake AI never touches the network.
	await page.evaluate(() => {
		const p = __smoke.plugin();
		p.settings.activeProvider = 'ollama';
		p.settings.activeModel = 'smoke-model';
		p.settings.enableAgent = false; // demo vault may have it on; the fake AI covers both paths anyway
		void p.saveSettings();
	});

	// --- P1: baseline send ----------------------------------------------------
	await page.evaluate(() => {
		__smoke.p1.startNewChat();
		__smoke.p1.inputEl.value = 'Pane one smoke message';
	});
	await page.evaluate(() => __smoke.p1.sendMessage());
	const pane1 = await page.evaluate(() => {
		const v = __smoke.p1;
		return { id: v.conversationId, html: v.messagesContainer.innerHTML };
	});
	created.convIds.push(pane1.id);
	const p1ok = await page.evaluate((id) => {
		const conv = __smoke.plugin().conversationStore.getConversation(id);
		return conv
			? { stored: conv.messages.length, reply: conv.messages[1]?.content ?? '' }
			: { stored: -1, reply: 'conv missing' };
	}, pane1.id);
	ok(p1ok.stored === 2 && p1ok.reply.includes('Fake reply'),
		'P1 baseline send stores user + assistant in the pane conversation', JSON.stringify(p1ok));

	// --- P2: open a second chat tab --------------------------------------------
	const cmdResult = await page.evaluate(() => {
		try {
			const r = window.app.commands.executeCommandById('curtis-ai-chat:open-new-chat-tab');
			return { ran: r !== false, leaves: __smoke.chatViews().length };
		} catch (e) {
			return { err: String(e) };
		}
	});
	console.log(`[smoke] P2 open-new-chat-tab command: ${JSON.stringify(cmdResult)}`);
	await until(page, () => __smoke.chatViews().length === 2, 10000, 'second chat pane');
	const p2 = await page.evaluate((firstId) => {
		const views = __smoke.chatViews();
		__smoke.p2 = views.find((v) => v !== __smoke.p1);
		// The new tab must live in the CENTER root split, not a sidebar —
		// walk the leaf's ancestor chain to find which root owns it.
		let root = __smoke.p2?.leaf?.parent ?? null;
		while (root && root.parent) root = root.parent;
		// A tab, not a sliver split: it should own a healthy share of the window.
		const paneWidth = __smoke.p2?.contentEl?.getBoundingClientRect().width ?? 0;
		const windowWidth = window.innerWidth;
		return {
			count: views.length,
			distinct: __smoke.p2 !== undefined && __smoke.p2 !== __smoke.p1,
			inCenter: root === window.app.workspace.rootSplit,
			paneWidth,
			windowWidth,
			share: windowWidth > 0 ? +(paneWidth / windowWidth).toFixed(2) : 0,
			freshBound: __smoke.p2?.conversationId != null && __smoke.p2.conversationId !== firstId,
			freshTitle: __smoke.p2?.getDisplayText?.(),
		};
	}, pane1.id);
	ok(p2.count === 2 && p2.distinct, 'P2 two distinct ChatView instances', JSON.stringify(p2));
	ok(p2.inCenter, 'P2 new tab opens in the center area (not a sidebar)', JSON.stringify(p2));
	console.log(`[smoke] P2 pane width: ${p2.paneWidth}px of ${p2.windowWidth}px window (${Math.round(p2.share * 100)}%)`);
	ok(p2.share >= 0.25, 'P2 new tab gets a roomy share of the window (≥25%)', JSON.stringify(p2));
	ok(p2.freshBound && p2.freshTitle === 'New chat',
		'P2 new tab starts a fresh conversation (not a mirror of pane one)', JSON.stringify(p2));

	// --- P2b: composer + top bar layout contract -----------------------------
	// The composer holds textarea + the control row (attach, mic, arena,
	// auto-speak left; send anchored right). The top bar holds the session
	// chrome with the model picker centered between title and tools. All
	// classes the demo scripts click by name must be present and inside the
	// right container.
	const p2b = await page.evaluate(() => {
		const pane = __smoke.p2.contentEl;
		const composer = pane.querySelector('.ai-chat-input-wrap');
		const topbar = pane.querySelector('.ai-chat-topbar');
		const row = composer?.querySelector('.ai-chat-btn-row');
		const inComposer = (sel) => !!composer?.querySelector(sel);
		const inTopbar = (sel) => !!topbar?.querySelector(sel);
		const attachCol = row?.querySelector('.ai-chat-attach-col');
		return {
			composer: !!composer,
			topbar: !!topbar,
			textarea: inComposer('.ai-chat-input'),
			controlRow: inComposer('.ai-chat-btn-row'),
			attach: !!attachCol?.querySelector('.ai-chat-attach-btn'),
			mic: !!attachCol?.querySelector('.ai-chat-mic-button'),
			arena: inComposer('.ai-chat-arena-btn'),
			send: inComposer('.ai-chat-send-col .ai-chat-send-btn'),
			modelPicker: inTopbar('.ai-model-picker-btn'),
			topbarNewChat: inTopbar('.ai-chat-icon-btn'),
			hintGone: !pane.querySelector('.ai-chat-input-hint'),
			oldHeaderGone: !pane.querySelector('.ai-chat-header'),
		};
	});
	const p2bOk = p2b.composer && p2b.topbar && p2b.textarea && p2b.controlRow
		&& p2b.attach && p2b.mic && p2b.arena && p2b.send
		&& p2b.modelPicker && p2b.topbarNewChat && p2b.hintGone && p2b.oldHeaderGone;
	ok(p2bOk, 'P2b composer + top bar layout contract holds', JSON.stringify(p2b));

	// --- P2c: titled panes — the tab names the conversation; renames flow ------
	const pane2Fresh = await page.evaluate(() => __smoke.p2.conversationId);
	created.convIds.push(pane2Fresh);
	await page.evaluate((id) => {
		__smoke.plugin().conversationStore.renameCurrentConversation('Pane two renamed', id);
	}, pane2Fresh);
	await sleep(300);
	const p2c = await page.evaluate(() => {
		const v = __smoke.p2;
		return {
			tabTitle: v.getDisplayText(),
			label: v.contentEl.querySelector('.ai-chat-topbar-title')?.textContent ?? null,
			// Debug-only: the real tab header DOM (internal API, may be absent).
			leafHeader: v.leaf?.tabHeaderEl?.innerText ?? null,
		};
	});
	ok(p2c.tabTitle === 'Pane two renamed' && p2c.label === 'Pane two renamed',
		'P2c tab + topbar title follow the conversation rename', JSON.stringify(p2c));

	// --- P3: independent conversations -----------------------------------------
	await page.evaluate(() => {
		__smoke.p2.startNewChat();
		__smoke.p2.inputEl.value = 'Pane two separate topic';
	});
	const pane2conv = await page.evaluate(() => __smoke.p2.conversationId);
	created.convIds.push(pane2conv);
	await page.evaluate(() => __smoke.p2.sendMessage());
	const p3 = await page.evaluate(({ a, b }) => {
		return {
			independent: __smoke.p1.conversationId === a && __smoke.p2.conversationId === b && a !== b,
			pane1ShowsOwn: __smoke.p1.messagesContainer.innerHTML.includes('Pane one smoke message'),
			pane1NoBleed: !__smoke.p1.messagesContainer.innerHTML.includes('Pane two separate topic'),
			pane2HasOwn: __smoke.plugin().conversationStore.getConversation(b).messages.length === 2,
			storeCurrentIsPane2: __smoke.plugin().conversationStore.getCurrentConversation().id === b,
		};
	}, { a: pane1.id, b: pane2conv });
	ok(p3.independent && p3.pane1ShowsOwn && p3.pane1NoBleed && p3.pane2HasOwn,
		'P3 panes hold independent conversations (no bleed)', JSON.stringify(p3));
	ok(p3.storeCurrentIsPane2, 'P3 last-active pane owns the store default');

	// --- P4: cross-pane sync on a shared conversation ---------------------------
	await page.evaluate((id) => {
		__smoke.p2.switchConversation(id);
		__smoke.p2.inputEl.value = 'Cross pane sync message';
	}, pane1.id);
	await page.evaluate(() => __smoke.p2.sendMessage());
	const p4 = await page.evaluate((id) => {
		const conv = __smoke.plugin().conversationStore.getConversation(id);
		return {
			stored: conv.messages.length,
			pane1User: __smoke.p1.messagesContainer.innerHTML.includes('Cross pane sync message'),
			pane1Reply: __smoke.p1.messagesContainer.innerHTML.includes('Fake reply'),
			bound: __smoke.p1.conversationId === id,
		};
	}, pane1.id);
	ok(p4.stored === 4 && p4.pane1User && p4.pane1Reply && p4.bound,
		'P4 send in pane two re-renders pane one on the shared conversation', JSON.stringify(p4));

	// --- P5: delete-rebind --------------------------------------------------------
	const convC = await page.evaluate(() => __smoke.plugin().conversationStore.createConversation('ollama', 'smoke-c').id);
	created.convIds.push(convC);
	await page.evaluate((id) => __smoke.plugin().conversationStore.deleteConversation(id), pane1.id);
	created.convIds = created.convIds.filter((x) => x !== pane1.id);
	await sleep(300);
	const p5 = await page.evaluate((want) => {
		return {
			pane1: __smoke.p1.conversationId,
			pane2: __smoke.p2.conversationId,
			want,
		};
	}, convC);
	ok(p5.pane1 === convC && p5.pane2 === convC,
		'P5 deleting the bound conversation rebinds every pane to the store default', JSON.stringify(p5));

	// --- N1: completion notification fires when the chat is not visible ----------
	await page.evaluate(() => {
		const p = __smoke.plugin();
		p.settings.notifyOnCompletion = true;
		p.settings.notifyOnError = true;
		void p.saveSettings();
		__smoke.spyNotifications();
		__smoke.patchHasFocus(false);
	});
	await page.evaluate(() => {
		__smoke.p1.inputEl.value = 'Notification trigger message';
	});
	await page.evaluate(() => __smoke.p1.sendMessage());
	const n1 = await page.evaluate(() => window.__notifs.slice());
	ok(n1.length === 1 && n1[0].title.startsWith('Curtis —') && n1[0].body.includes('Fake reply'),
		'N1 completion notification fires once with title + preview', JSON.stringify(n1));

	// --- N2: suppressed while viewing the pane -----------------------------------
	await page.evaluate(() => {
		__smoke.patchHasFocus(true);
		window.app.workspace.setActiveLeaf(__smoke.p1.leaf);
		__smoke.p1.inputEl.value = 'Watching this one';
	});
	await page.evaluate(() => __smoke.p1.sendMessage());
	const n2 = await page.evaluate(() => window.__notifs.length);
	ok(n2 === 1, 'N2 no notification while the user is viewing the pane', `count=${n2}`);
	await page.evaluate(() => __smoke.patchHasFocus(false));

	// --- N3: no notification for an aborted stream -------------------------------
	await page.evaluate(() => __smoke.installFakeAI(700));
	const sendPromise = page.evaluate(() => {
		__smoke.p1.inputEl.value = 'Abort me midway';
		return __smoke.p1.sendMessage();
	});
	await until(page, () => !document.querySelector('.ai-chat-abort-btn')?.classList.contains('is-hidden'), 5000, 'stop button visible');
	await page.evaluate(() => document.querySelector('.ai-chat-abort-btn')?.click());
	await sendPromise;
	await sleep(300);
	const n3 = await page.evaluate(() => ({ count: window.__notifs.length, generating: __smoke.p1.isGenerating }));
	ok(n3.count === 1 && n3.generating === false,
		'N3 aborted stream fires no notification', JSON.stringify(n3));
	await page.evaluate(() => __smoke.installFakeAI());

	// --- A1: arena round → one notification listing both models -------------------
	await page.evaluate(() => {
		const v = __smoke.p1;
		v.arenaMode = true;
		v.arenaSelectedModels = [
			{ providerId: 'ollama', modelId: 'smoke-a', providerName: 'Ollama', modelName: 'Smoke A' },
			{ providerId: 'ollama', modelId: 'smoke-b', providerName: 'Ollama', modelName: 'Smoke B' },
		];
		v.sendArenaMessage('Arena round prompt');
	});
	await until(page, () => __smoke.p1.isGenerating === false && __smoke.p1.arenaAbortControllers.size === 0, 15000, 'arena round settled');
	await sleep(400);
	const a1 = await page.evaluate(() => ({ notifs: window.__notifs.slice(1) }));
	const arenaNotif = a1.notifs.find((n) => n.body.includes('Arena round finished'));
	ok(a1.notifs.length === 1 && !!arenaNotif && arenaNotif.body.includes('Smoke A · Smoke B'),
		'A1 arena round produces exactly one notification naming both models', JSON.stringify(a1.notifs));

	// --- A2: two arenas at once — one per pane, four concurrent streams ---------
	const a2setup = await page.evaluate(() => {
		__smoke.p1.startNewChat();
		__smoke.p2.startNewChat();
		const selections = (sfx) => [
			{ providerId: 'ollama', modelId: `smoke-${sfx}-1`, providerName: 'Ollama', modelName: `Dual ${sfx}1` },
			{ providerId: 'ollama', modelId: `smoke-${sfx}-2`, providerName: 'Ollama', modelName: `Dual ${sfx}2` },
		];
		__smoke.p1.arenaMode = true;
		__smoke.p1.arenaSelectedModels = selections('L');
		__smoke.p1.sendArenaMessage('Concurrent arena left');
		__smoke.p2.arenaMode = true;
		__smoke.p2.arenaSelectedModels = selections('R');
		__smoke.p2.sendArenaMessage('Concurrent arena right');
		return { c1: __smoke.p1.conversationId, c2: __smoke.p2.conversationId };
	});
	created.convIds.push(a2setup.c1, a2setup.c2);
	await until(
		page,
		() => __smoke.p1.isGenerating === false && __smoke.p1.arenaAbortControllers.size === 0
			&& __smoke.p2.isGenerating === false && __smoke.p2.arenaAbortControllers.size === 0,
		20000,
		'both concurrent arena rounds settled'
	);
	await sleep(400);
	const a2 = await page.evaluate(({ c1, c2 }) => {
		const store = __smoke.plugin().conversationStore;
		const tally = (id) => {
			const conv = store.getConversation(id);
			const assistants = conv ? conv.messages.filter((m) => m.role === 'assistant') : [];
			return {
				user: conv ? conv.messages.filter((m) => m.role === 'user').length : -1,
				assistants: assistants.length,
				models: assistants.map((m) => m.model).sort().join(','),
			};
		};
		return {
			left: tally(c1),
			right: tally(c2),
			arenaNotifs: window.__notifs.slice(2).filter((n) => n.body.includes('Arena round finished')).map((n) => n.title),
		};
	}, a2setup);
	ok(
		a2.left.user === 1 && a2.left.assistants === 2 && a2.left.models === 'smoke-L-1,smoke-L-2'
			&& a2.right.user === 1 && a2.right.assistants === 2 && a2.right.models === 'smoke-R-1,smoke-R-2',
		'A2 two concurrent arena rounds (four streams) land in their own conversations',
		JSON.stringify(a2)
	);
	ok(a2.arenaNotifs.length === 2, 'A2 each pane fires its own arena completion notification', JSON.stringify(a2.arenaNotifs));

	// --- cleanup -------------------------------------------------------------------
	await page.evaluate(async (state) => {
		const p = __smoke.plugin();
		for (const v of __smoke.chatViews()) {
			v.arenaMode = false;
			v.arenaSelectedModels = [];
		}
		p.settings.notifyOnCompletion = state.orig.notifyOnCompletion;
		p.settings.notifyOnError = state.orig.notifyOnError;
		p.settings.activeProvider = state.orig.activeProvider;
		p.settings.enableAgent = state.orig.enableAgent;
		await p.saveSettings();
		__smoke.restoreNotifications();
		__smoke.restoreHasFocus();
		for (const id of state.convIds) p.conversationStore.deleteConversation(id);
		return true;
	}, { convIds: created.convIds, orig: origSettings });
	console.log('[smoke] cleaned up');

	console.log(`\n[smoke] ${pass} passed, ${fail} failed`);
	reportConsoleGate();
	finished = true;
	await browser.close();
	child.kill();
	restoreLaunchVault();
	// No relaunch — the user asked the harness to leave Obsidian closed.
	process.exit(fail > 0 || pluginErrors.length > 0 ? 1 : 0);
}

main().catch((e) => {
	console.error('[smoke] fatal:', e.message);
	restoreLaunchVault();
	try { execSync('taskkill /IM Obsidian.exe /F', { stdio: 'ignore' }); } catch { /* not running */ }
	process.exit(1);
});
