// v2.0 feature smoke test — drives the real plugin inside real Obsidian.
//
// Boots Obsidian on the demo vault (plugin freshly copied from the build
// output), attaches over CDP, then exercises the four v2.0 features through
// the real code paths:
//
//   T0  migration v7 — existing install has onboardingCompleted === true
//   T1  onboarding panel — renders for fresh installs, chip fills input,
//       skip retires it
//   T2  memory provenance — conv id rides in the memory file's hidden
//       comment and survives a reload round-trip
//   T3  send flow — memoriesUsedIds attached to the stored reply, chip
//       rendered, onboarding retired by the first send, confirm-mode
//       proposal bar → Save → fact carries the source conversation
//   T4  conversation-file round-trip — "mem" survives in the msg marker
//   T5  memory popover — facts, provenance links, footer
//   T6  /recap — recap message lands in the chat AND the journal file
//   T7  relevance pulse — seeded index vectors surface the bar on note
//       open, click jumps into the conversation, non-matching note stays
//       silent
//
// AI responses are faked by monkeypatching plugin.callAI in the renderer —
// deterministic, offline, and it still exercises the full view pipeline.
// In-page helpers are installed once as window.__smoke so every evaluate()
// shares them.
//
// Usage: npm run smoke:v2
// Env:   OBSIDIAN_EXE (default: %LOCALAPPDATA%\Programs\Obsidian\Obsidian.exe)
//
// The user's running Obsidian is closed for the duration and relaunched at
// the end (same contract as npm run shots).

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
const DEBUG_PORT = 9333;

const OBSIDIAN_EXE =
	process.env.OBSIDIAN_EXE ||
	resolve(process.env.LOCALAPPDATA, 'Programs/Obsidian/Obsidian.exe');

let pass = 0, fail = 0;
const ok = (cond, name, detail = '') => {
	const mark = cond ? 'PASS' : 'FAIL';
	console.log(`[${mark}] ${name}${detail && !cond ? ` — ${detail}` : ''}`);
	cond ? pass++ : fail++;
};

// ---------------------------------------------------------------------------
// Vault bootstrap (mirrors capture-screenshots.mjs)
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
	if (!existsSync(resolve(VAULT, 'Daily/2026-10-02.md'))) {
		mkdirSync(resolve(VAULT, 'Daily'), { recursive: true });
		writeFileSync(resolve(VAULT, 'Daily/2026-10-02.md'), '# 2026-10-02\n\n- smoke test anchor note\n');
	}
	if (!existsSync(resolve(VAULT, 'Daily/2026-10-01.md'))) {
		writeFileSync(resolve(VAULT, 'Daily/2026-10-01.md'), '# 2026-10-01\n\n- other note\n');
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

// ---------------------------------------------------------------------------
// Boot + attach (mirrors capture-screenshots.mjs)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// In-page helpers — installed once as window.__smoke
// ---------------------------------------------------------------------------

const INSTALL_HELPERS = `(() => {
	const sleepP = (ms) => new Promise((r) => setTimeout(r, ms));
	window.__smoke = {
		plugin: () => window.app.plugins.plugins['curtis-ai-chat'],
		chatView: () => {
			const leaves = window.app.workspace.getLeavesOfType('curtis-chat');
			if (leaves.length === 0) throw new Error('no chat view open');
			return leaves[0].view;
		},
		async openChat() {
			window.app.commands.executeCommandById('curtis-ai-chat:open-chat');
			const deadline = Date.now() + 10000;
			while (Date.now() < deadline) {
				if (document.querySelector('.workspace-leaf-content[data-type="curtis-chat"]')) return true;
				await sleepP(200);
			}
			throw new Error('chat view never opened');
		},
		/** Deterministic offline AI: extraction prompts get fact JSON, recap
		 *  prompts get bullets, everything else gets a plain reply. */
		installFakeAI() {
			const p = this.plugin();
			p.callAI = async (messages, _modelId, cb = {}) => {
				await sleepP(120);
				const sys = messages[0]?.role === 'system' ? String(messages[0].content) : '';
				let text;
				if (sys.includes('extract DURABLE facts')) {
					text = JSON.stringify([{ content: 'User prefers terse answers', category: 'preference' }]);
				} else if (sys.includes('terse bullet points')) {
					text = '- Worked on the v2.0 smoke test\\n- Decided Curtis 2.0 ships today\\n- Left open: pulse threshold tuning';
				} else {
					text = 'Fake reply from the smoke-test model. Two sentences, deterministic.';
				}
				const mid = Math.ceil(text.length / 2);
				for (const piece of [text.slice(0, mid), text.slice(mid)]) {
					cb.onChunk?.(piece);
					await sleepP(40);
				}
				cb.onUsage?.({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
			};
			return true;
		},
	};
	return true;
})()`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll an in-page predicate until it holds or timeout (ms). */
async function until(page, expr, timeoutMs, label) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await page.evaluate(expr)) return true;
		await sleep(250);
	}
	throw new Error(`timeout: ${label}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	const hadDataJson = existsSync(resolve(PLUGIN_DIR, 'data.json'));
	console.log(`[smoke] data.json existed pre-boot: ${hadDataJson} (migration path ${hadDataJson ? 'will' : 'will not'} run)`);

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
	const logLine = (m) => { if (m.type() === 'error') console.log(`[obsidian] ${m.text().slice(0, 160)}`); };
	for (const p of ctx.pages()) p.on('console', logLine);
	ctx.on('page', (p) => p.on('console', logLine));

	// If Obsidian dies MID-RUN, CDP calls can hang forever — bail loudly.
	// (During normal teardown the script kills Obsidian itself; that
	// disconnect is expected and must not flip the exit code.)
	let finished = false;
	browser.on('disconnected', () => {
		if (finished) return;
		console.error('[smoke] fatal: Obsidian (CDP) disconnected mid-run');
		restoreLaunchVault();
		process.exit(1);
	});
	// Hard ceiling: nothing in this suite should take 4 minutes.
	setTimeout(() => {
		console.error('[smoke] fatal: watchdog timeout (4 min) — aborting');
		try { execSync('taskkill /IM Obsidian.exe /F', { stdio: 'ignore' }); } catch { /* not running */ }
		restoreLaunchVault();
		process.exit(1);
	}, 240000);

	const created = { convIds: [], factIds: [], journalPath: null };
	let page = await waitForVaultPage(ctx, () => true, 30000, 'window');
	try {
		await page.getByRole('button', { name: /trust/i }).click({ timeout: 8000 });
		console.log('[smoke] dismissed trust-vault modal');
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

	// --- T0: migration ------------------------------------------------------
	if (hadDataJson) {
		const migrated = await page.evaluate(() => __smoke.plugin().settings.onboardingCompleted === true);
		ok(migrated, 'T0 migration v7: existing install marked onboarded');
	} else {
		const fresh = await page.evaluate(() => __smoke.plugin().settings.onboardingCompleted === false);
		ok(fresh, 'T0 fresh install: onboarding not completed');
	}

	await page.evaluate(() => __smoke.openChat());
	await page.evaluate(() => __smoke.installFakeAI());
	const viewReady = await page.evaluate(() => !!__smoke.chatView()?.messagesContainer);
	ok(viewReady, 'chat view open');

	// --- T1: onboarding panel ------------------------------------------------
	await page.evaluate(() => {
		__smoke.plugin().settings.onboardingCompleted = false;
		void __smoke.plugin().saveSettings();
		__smoke.chatView().startNewChat();
	});
	const onboardShown = await page.evaluate(() => ({
		panel: !!document.querySelector('.ai-onboard'),
		chips: document.querySelectorAll('.ai-onboard-chip').length,
		skip: !!document.querySelector('.ai-onboard-skip'),
	}));
	ok(onboardShown.panel && onboardShown.chips === 2 && onboardShown.skip,
		'T1 onboarding panel renders (copy, 2 starter questions, skip)',
		JSON.stringify(onboardShown));

	await page.evaluate(() => {
		document.querySelector('.ai-onboard-chip')?.click();
	});
	const chipFilled = await page.evaluate(() => __smoke.chatView().inputEl.value.includes('vault for?'));
	ok(chipFilled, 'T1 starter question fills the input');

	await page.evaluate(() => document.querySelector('.ai-onboard-skip')?.click());
	const skipWorked = await page.evaluate(() => ({
		gone: !document.querySelector('.ai-onboard'),
		normalHint: !!document.querySelector('.ai-chat-empty-hint'),
		flag: __smoke.plugin().settings.onboardingCompleted === true,
	}));
	ok(skipWorked.gone && skipWorked.normalHint && skipWorked.flag, 'T1 skip retires onboarding', JSON.stringify(skipWorked));

	// --- T2: memory provenance round-trip ------------------------------------
	const t2 = await page.evaluate(async () => {
		const p = __smoke.plugin();
		const conv = p.conversationStore.createConversation('ollama', 'smoke-model');
		const fact = await p.memoryStore.addFact('Smoke fact with provenance', 'project', conv.id);
		const raw = await app.vault.adapter.read(p.settings.memoryFilePath);
		const inFile = raw.includes(`conv:${conv.id}`);
		await p.memoryStore.reload(p);
		const survived = p.memoryStore.getFacts().some((f) => f.id === fact.id && f.sourceConversationId === conv.id);
		return { convId: conv.id, factId: fact.id, inFile, survived };
	});
	created.convIds.push(t2.convId);
	created.factIds.push(t2.factId);
	ok(t2.inFile, 'T2 provenance written to memory file (conv: in hidden comment)');
	ok(t2.survived, 'T2 provenance survives a memory reload round-trip');

	// --- T3: send flow (chips + retirement + proposal save) -------------------
	// The demo vault may have memory disabled from earlier capture runs — the
	// features under test need it on, in confirm mode.
	const origMemory = await page.evaluate(() => ({
		enableMemory: __smoke.plugin().settings.enableMemory,
		mode: __smoke.plugin().settings.memoryCaptureMode,
	}));
	await page.evaluate(() => {
		const s = __smoke.plugin().settings;
		s.enableMemory = true;
		s.memoryCaptureMode = 'confirm';
		void __smoke.plugin().saveSettings();
	});
	const preFactCount = await page.evaluate(() => __smoke.plugin().memoryStore.getFacts().length);
	await page.evaluate(() => {
		__smoke.plugin().settings.onboardingCompleted = false; // verify first-send retirement
		void __smoke.plugin().saveSettings();
		__smoke.chatView().startNewChat();
		__smoke.chatView().inputEl.value = 'Hello Curtis, this is a smoke test';
	});
	const t3convId = await page.evaluate(() => __smoke.plugin().conversationStore.getCurrentConversation().id);
	created.convIds.push(t3convId);
	await page.evaluate(() => __smoke.chatView().sendMessage());

	const sent = await page.evaluate((expected) => {
		const conv = __smoke.plugin().conversationStore.getCurrentConversation();
		const last = conv.messages[conv.messages.length - 1];
		return {
			chip: document.querySelector('.ai-message-mem')?.textContent ?? null,
			storedIds: last?.memoriesUsedIds?.length ?? 0,
			flag: __smoke.plugin().settings.onboardingCompleted === true,
			msgCount: conv.messages.length,
			expected,
		};
	}, preFactCount);
	ok(sent.msgCount === 2, 'T3 user + assistant messages stored');
	ok(sent.storedIds === preFactCount && sent.chip === String(preFactCount),
		'T3 memoriesUsedIds stored on reply and chip shows the fact count',
		JSON.stringify(sent));
	ok(sent.flag, 'T3 first send retires onboarding');

	// Second exchange so /recap has ≥3 messages.
	await page.evaluate(() => {
		__smoke.chatView().inputEl.value = 'One more turn for recap material';
	});
	await page.evaluate(() => __smoke.chatView().sendMessage());

	// Confirm-mode proposal bar → Save.
	await until(page, () => !!document.querySelector('.ai-memory-proposal-bar'), 8000, 'memory proposal bar');
	await page.evaluate(() => {
		document.querySelector('.ai-memory-proposal-bar button.mod-cta')?.click();
	});
	await until(
		page,
		() => __smoke.plugin().memoryStore.getFacts().some((f) => f.content === 'User prefers terse answers'),
		8000,
		'saved proposal fact'
	);
	const proposalFact = await page.evaluate((convId) => {
		const f = __smoke.plugin().memoryStore.getFacts().find((x) => x.content === 'User prefers terse answers');
		return { id: f?.id, src: f?.sourceConversationId, want: convId };
	}, t3convId);
	created.factIds.push(proposalFact.id);
	ok(proposalFact.src === t3convId, 'T3 saved proposal carries the source conversation id',
		JSON.stringify(proposalFact));

	// --- T4: conversation-file round-trip of memoriesUsedIds ------------------
	await sleep(800); // debounced write
	const t4 = await page.evaluate(async (convId) => {
		const p = __smoke.plugin();
		const path = p.conversationStore.getConversationPath(convId);
		if (!path) return { ok: false, why: 'no path' };
		const raw = await app.vault.adapter.read(path);
		return { ok: raw.includes('"mem":['), why: path };
	}, t3convId);
	ok(t4.ok, 'T4 memoriesUsedIds persists in the conversation file marker', t4.why);

	// --- T5: memory popover ----------------------------------------------------
	await page.evaluate(() => __smoke.chatView().renderCurrentConversation());
	await page.evaluate(() => {
		document.querySelector('.ai-message-mem')?.click();
	});
	const pop = await page.evaluate(() => ({
		open: !!document.querySelector('.ai-mem-popover'),
		rows: document.querySelectorAll('.ai-mem-popover-row').length,
		links: document.querySelectorAll('.ai-mem-popover-link').length,
		footer: !!document.querySelector('.ai-mem-popover-footer'),
	}));
	ok(pop.open && pop.rows >= preFactCount && pop.links >= 1 && pop.footer,
		'T5 popover lists facts with provenance links + memory-file footer',
		JSON.stringify(pop));
	await page.evaluate(() => document.querySelector('.ai-message-mem')?.click());
	const popClosed = await page.evaluate(() => !document.querySelector('.ai-mem-popover'));
	ok(popClosed, 'T5 popover toggles closed');

	// --- T6: /recap + journal --------------------------------------------------
	await page.evaluate(() => {
		__smoke.chatView().inputEl.value = '/recap';
	});
	await page.evaluate(() => __smoke.chatView().sendMessage());
	await until(
		page,
		() => __smoke.plugin().conversationStore.getCurrentConversation().messages.slice(-1)[0]?.content.startsWith('**Recap**'),
		15000,
		'recap message stored'
	);
	const t6 = await page.evaluate(async () => {
		const p = __smoke.plugin();
		const path = p.settings.journalFilePath;
		if (!(await app.vault.adapter.exists(path))) return { ok: false, why: 'journal missing' };
		const raw = await app.vault.adapter.read(path);
		return {
			ok: raw.includes('## 20') && raw.includes('- Worked on the v2.0 smoke test') && raw.includes('[['),
			why: path,
		};
	});
	created.journalPath = await page.evaluate(() => __smoke.plugin().settings.journalFilePath);
	ok(t6.ok, 'T6 journal entry written (date heading, bullets, conversation link)', t6.why);

	// --- T7: relevance pulse ---------------------------------------------------
	// Seed the in-memory index with hand-made vectors: note A ≈ conversation A'
	// (cosine ~0.999, above the 0.8 floor); note B ⊥ everything.
	const t7 = await page.evaluate(async (convId) => {
		const p = __smoke.plugin();
		await p.ragIndex.ensureLoaded();
		p.ragIndex.files.clear();
		p.ragIndex.lastBuilt = Date.now();
		p.settings.enableRag = true;
		await p.saveSettings();

		const mk = (filePath, embedding, startIndex) => ({
			id: `${filePath}#${startIndex}`,
			filePath,
			content: 'seed',
			embedding,
			startIndex,
			endIndex: startIndex + 5,
		});
		const A = [1, 0, 0, 0, 0, 0, 0, 0];
		const Ap = [0.99, 0.05, 0, 0, 0, 0, 0, 0];
		const B = [0, 1, 0, 0, 0, 0, 0, 0];
		const convPath = p.conversationStore.getConversationPath(convId);
		p.ragIndex.files.set('Daily/2026-10-02.md', { mtime: Date.now(), size: 10, chunks: [mk('Daily/2026-10-02.md', A, 0)] });
		p.ragIndex.files.set('Daily/2026-10-01.md', { mtime: Date.now(), size: 10, chunks: [mk('Daily/2026-10-01.md', B, 0)] });
		if (convPath) p.ragIndex.files.set(convPath, { mtime: Date.now(), size: 10, chunks: [mk(convPath, Ap, 0)] });

		// Direct API check before the event-driven one.
		const hits = await p.ragIndex.findRelatedConversations('Daily/2026-10-02.md', 1);
		const misses = await p.ragIndex.findRelatedConversations('Daily/2026-10-01.md', 1);
		return { convPath, hitPath: hits[0]?.filePath ?? null, hitScore: hits[0]?.score ?? 0, missCount: misses.length };
	}, t3convId);
	ok(t7.hitPath === t7.convPath && t7.hitScore >= 0.8, 'T7 findRelatedConversations matches the seeded conversation',
		JSON.stringify(t7));
	ok(t7.missCount === 0, 'T7 orthogonal note produces no match');

	// Event-driven: switch to a fresh chat first (the pulse correctly stays
	// silent when you're ALREADY in the matching conversation), then open the
	// matching note. Obsidian doesn't emit file-open from a spawned, unfocused
	// window (verified by probe), so the test opens the note for real and then
	// synthesizes the file-open event a focused window would have emitted —
	// everything downstream (debounce, guards, cosine, bar, jump) is real.
	await page.evaluate(() => __smoke.chatView().startNewChat());
	await page.evaluate(() => {
		// Diagnostics — how far does the event chain get?
		window.__fileOpens = 0;
		window.app.workspace.on('file-open', () => window.__fileOpens++);
		const v = __smoke.chatView();
		const orig = v.computePulse.bind(v);
		window.__pulseCalls = 0;
		v.computePulse = async (f) => { window.__pulseCalls++; return orig(f); };
		window.__pulseState = {
			views: window.app.workspace.getLeavesOfType('curtis-chat').length,
			enablePulse: __smoke.plugin().settings.enableRelevancePulse,
			enableRag: __smoke.plugin().settings.enableRag,
		};
	});
	const openNote = (path) =>
		page.evaluate(async (p) => {
			await app.workspace.openLinkText(p, '', true);
			app.workspace.trigger('file-open', app.vault.getAbstractFileByPath(p));
		}, path);
	await openNote('Daily/2026-10-02.md');
	await sleep(5000);
	const pulseDbg = await page.evaluate(() => ({
		fileOpens: window.__fileOpens,
		pulseCalls: window.__pulseCalls,
		bar: !!document.querySelector('.ai-chat-pulse'),
		...window.__pulseState,
	}));
	console.log(`[smoke] pulse diagnostics: ${JSON.stringify(pulseDbg)}`);
	await until(page, () => !!document.querySelector('.ai-chat-pulse'), 12000, 'pulse bar on matching note');
	const pulseLabel = await page.evaluate(() => document.querySelector('.ai-chat-pulse-label')?.textContent ?? '');
	ok(pulseLabel.includes('Discussed in'), 'T7 pulse bar labels the conversation', pulseLabel);

	await page.evaluate(() => document.querySelector('.ai-chat-pulse-label')?.click());
	const jumped = await page.evaluate((want) => __smoke.plugin().conversationStore.getCurrentConversation()?.id === want, t3convId);
	ok(jumped, 'T7 pulse click jumps into the conversation');

	await openNote('Daily/2026-10-01.md');
	await sleep(4000);
	const noFalsePulse = await page.evaluate(() => !document.querySelector('.ai-chat-pulse'));
	ok(noFalsePulse, 'T7 non-matching note stays silent');

	// --- cleanup ---------------------------------------------------------------
	await page.evaluate(async (state) => {
		const p = __smoke.plugin();
		for (const id of state.convIds) p.conversationStore.deleteConversation(id);
		for (const fid of state.factIds) await p.memoryStore.deleteFact(fid);
		if (state.journalPath && (await app.vault.adapter.exists(state.journalPath))) {
			try { await app.vault.adapter.remove(state.journalPath); } catch { /* best effort */ }
		}
		p.settings.enableRag = false;
		p.settings.onboardingCompleted = true;
		p.settings.enableMemory = state.origMemory.enableMemory;
		p.settings.memoryCaptureMode = state.origMemory.mode;
		await p.saveSettings();
		return true;
	}, { ...created, origMemory });
	console.log('[smoke] cleaned up seeded artifacts');

	// --- summary ----------------------------------------------------------------
	console.log(`\n[smoke] ${pass} passed, ${fail} failed`);
	finished = true;
	await browser.close();
	child.kill();
	restoreLaunchVault();
	// Relaunch the user's Obsidian on their original vault, as the harness took it over.
	try { spawn(OBSIDIAN_EXE, [], { detached: true, stdio: 'ignore' }).unref(); } catch { /* best effort */ }
	process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
	console.error('[smoke] fatal:', e.message);
	restoreLaunchVault();
	try { execSync('taskkill /IM Obsidian.exe /F', { stdio: 'ignore' }); } catch { /* not running */ }
	process.exit(1);
});
