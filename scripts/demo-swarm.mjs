// Swarm demo — drives the real plugin inside real Obsidian with a REAL model
// (same harness contract as smoke-panes.mjs: the running Obsidian is closed
// for the duration; this script leaves the demo vault OPEN at the end so the
// transcripts can be inspected).
//
// Scenario: a real Obsidian weekly-review. The user marks the chat as leader
// (/leader), then asks for a review across Daily + Projects notes. The leader
// spawns two followers (daily notes / project notes), collects both reports,
// synthesizes, and files a review note.
//
// Screenshots land in demo-swarm/, transcripts copied next to them.
//
// Usage: node scripts/demo-swarm.mjs

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
const OUT = resolve(ROOT, 'demo-swarm');
const DEBUG_PORT = 9334;

const OBSIDIAN_EXE =
	process.env.OBSIDIAN_EXE ||
	resolve(process.env.USERPROFILE ?? process.env.HOME, 'scoop/apps/obsidian/current/Obsidian.exe');

const REVIEW_NOTE = 'Projects/Weekly Review 2026-10-02.md';

const LEADER_PROMPT = [
	'Time for my weekly project review. Use two follower agents for this:',
	'one to read my three daily notes in Daily/ and summarize what I worked',
	'on this week and where momentum is good or stuck; another to read both',
	'notes in Projects/ and report the status of each project, including the',
	'provider landscape alerts from the Provider Parameter Matrix.',
	'When both reports are in, synthesize them into a weekly review and save',
	`it as a note at ${REVIEW_NOTE.replace('.md', '')}.`,
].join(' ');

// Provider candidates, probed in order. First that answers wins.
const PROVIDER_CANDIDATES = [
	{ provider: 'openrouter', model: 'anthropic/claude-sonnet-4.5' },
	{ provider: 'deepseek', model: 'deepseek-chat' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Vault bootstrap + launch vault registration (mirrors smoke-panes.mjs)
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

const until = async (page, expr, arg, timeoutMs, label) => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await page.evaluate(expr, arg)) return true;
		await sleep(300);
	}
	throw new Error(`timeout: ${label}`);
};

async function waitForVaultPage(ctx, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		for (const p of ctx.pages()) {
			try {
				if ((await p.evaluate(() => window.app?.vault?.getName?.())) === 'demo-vault') return p;
			} catch { /* stale page */ }
		}
		await sleep(1000);
	}
	throw new Error('demo-vault window never appeared');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

	// Outer scope so the fatal handler can screenshot whatever is on screen.
	let page = null;

	async function main() {
	mkdirSync(OUT, { recursive: true });
	mkdirSync(resolve(OUT, 'transcripts'), { recursive: true });
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

	const hardExit = (msg) => {
		console.error(`[demo] fatal: ${msg}`);
		try { execSync('taskkill /IM Obsidian.exe /F', { stdio: 'ignore' }); } catch { /* not running */ }
		restoreLaunchVault();
		process.exit(1);
	};
	if (!(await waitForDebugPort(25000))) hardExit('debug port never opened');
	let browser = null;
	for (let i = 0; i < 5 && !browser; i++) {
		try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`); }
		catch { await sleep(2500); }
	}
	if (!browser) hardExit('could not attach to the debug port');
	const ctx = browser.contexts()[0];
	for (const p of ctx.pages()) {
		p.on('console', (m) => { if (m.type() === 'error') console.log(`[obsidian] ${m.text().slice(0, 200)}`); });
	}
	let done = false;
	const watchdog = setTimeout(() => hardExit('watchdog timeout (10 min)'), 600000);
	browser.on('disconnected', () => { if (!done) hardExit('Obsidian (CDP) disconnected mid-run'); });

	page = await waitForVaultPage(ctx, 30000);
	try { await page.getByRole('button', { name: /trust/i }).click({ timeout: 8000 }); } catch { /* trusted */ }
	await page.evaluate(async () => {
		try { await window.app.plugins.enablePlugin('curtis-ai-chat'); } catch { /* on */ }
	});
	await until(page, () => !!window.app.plugins.plugins['curtis-ai-chat']?.conversationStore, undefined, 30000, 'plugin loaded');
	console.log('[demo] plugin loaded');

	// ---- Snapshot settings FIRST (the probe rewrites the active provider).
	const origSettings = await page.evaluate(() => {
		const s = window.app.plugins.plugins['curtis-ai-chat'].settings;
		return {
			enableMemory: s.enableMemory, notifyOnCompletion: s.notifyOnCompletion,
			notifyOnError: s.notifyOnError, agentMaxTurns: s.agentMaxTurns,
			swarmMaxFollowers: s.swarmMaxFollowers, temperature: s.temperature,
			activeProvider: s.activeProvider, activeModel: s.activeModel,
		};
	});

	// ---- Provider: probe candidates with a real round-trip, pin the winner.
	// Runs BEFORE the leader pane is staged — the pane (and its conversation)
	// capture the active provider/model at open.
	const probe = await page.evaluate(async (candidates) => {
		const p = window.app.plugins.plugins['curtis-ai-chat'];
		for (const c of candidates) {
			p.settings.activeProvider = c.provider;
			p.settings.activeModel = c.model;
			try {
				const provider = p.getAuthenticatedProvider();
				const r = await p.callProviderOnce(provider,
					[{ role: 'user', content: 'Reply with the single word OK.' }], c.model, undefined);
				if (!r.error && (r.content || '').trim().length > 0) {
					return { ok: true, provider: c.provider, model: c.model, reply: r.content.trim().slice(0, 20) };
				}
			} catch (e) { /* next candidate */ }
		}
		return { ok: false };
	}, PROVIDER_CANDIDATES);
	if (!probe.ok) hardExit('no working provider — neither OpenRouter nor DeepSeek resolved a key');
	console.log(`[demo] provider: ${probe.provider} / ${probe.model} (probe said "${probe.reply}")`);

	// ---- Stage the leader: create a fresh conversation and open it directly
	// ---- as a CENTER tab. Dissolve any floating windows first — the saved
	// ---- workspace can carry popouts from earlier runs, and getLeaf('tab')
	// ---- would happily land the chat in one (invisible to main-window shots).
	const leaderConvId = await page.evaluate(async () => {
		const p = window.app.plugins.plugins['curtis-ai-chat'];
		const ws = window.app.workspace;
		for (const c of (ws.floatingSplit?.children ?? []).slice()) c.detach?.();
		const conv = p.conversationStore.createConversation(p.settings.activeProvider, p.settings.activeModel);
		await p.openNewChatPane('tab', conv.id);
		return conv.id;
	});
	try {
		await until(page, (id) => {
			const leaf = window.app.workspace.getLeavesOfType('curtis-chat')
				.find((l) => l.view?.conversationId === id);
			return !!leaf?.view?.contentEl?.querySelector('.ai-chat-input-wrap textarea');
		}, leaderConvId, 30000, 'leader composer ready');
	} catch (e) {
		await page.screenshot({ path: resolve(OUT, 'fatal-composer.png') }).catch(() => undefined);
		const diag = await page.evaluate(() => ({
			chatLeaves: window.app.workspace.getLeavesOfType('curtis-chat').length,
			pluginEnabled: !!window.app.plugins.plugins['curtis-ai-chat'],
			modals: [...document.querySelectorAll('.modal-container')].map((m) => m.textContent?.slice(0, 120)),
		})).catch(() => null);
		console.error('[demo] composer diagnostics:', JSON.stringify(diag, null, 2));
		throw e;
	}
	// Detach any other chat leaf (sidebar copies from the saved layout) and
	// put the leader front and center.
	await page.evaluate((id) => {
		for (const l of window.app.workspace.getLeavesOfType('curtis-chat')) {
			if (l.view?.conversationId !== id) l.detach();
		}
		const leaf = window.app.workspace.getLeavesOfType('curtis-chat')[0];
		window.app.workspace.revealLeaf(leaf);
	}, leaderConvId);
	await until(page, (id) => {
		const views = window.app.workspace.getLeavesOfType('curtis-chat');
		return views.length === 1 && views[0].view?.conversationId === id;
	}, leaderConvId, 10000, 'single center leader pane');
	console.log('[demo] leader pane staged (center)');

	// ---- Demo-friendly settings (snapshot taken earlier; restore at the end).
	await page.evaluate(() => {
		const s = window.app.plugins.plugins['curtis-ai-chat'].settings;
		s.enableMemory = false;      // no memory-proposal noise mid-demo
		s.notifyOnCompletion = false;
		s.notifyOnError = true;
		s.agentMaxTurns = 9;         // scout + spawn + spawn + file note + synthesize
		s.swarmMaxFollowers = 3;
		s.temperature = 1;           // dodge per-model sampling rejections
	});
	await page.evaluate(() => window.app.plugins.plugins['curtis-ai-chat'].saveSettings());

	const shot = async (name) => {
		// The chat may live in a popout window (a separate CDP page) — shoot
		// whichever page actually shows the composer, not a fixed one.
		for (const p of ctx.pages()) {
			const visible = await p.evaluate(() => {
				const el = document.querySelector('.ai-chat-view .ai-chat-input-wrap');
				return !!el && el.offsetParent !== null;
			}).catch(() => false);
			if (visible) {
				await p.screenshot({ path: resolve(OUT, name) });
				console.log(`[demo] shot: ${name}`);
				return;
			}
		}
		await page.screenshot({ path: resolve(OUT, name) });
		console.log(`[demo] shot (fallback page): ${name}`);
	};

	// ---- Step 1: mark the chat as leader through the real slash command.
	const viewState = (id) => page.evaluate((cid) => {
		const leaf = window.app.workspace.getLeavesOfType('curtis-chat')
			.find((l) => l.view?.conversationId === cid);
		if (!leaf) return null;
		const v = leaf.view;
		return { role: v.store.getConversation(cid)?.role ?? null, generating: v.isGenerating };
	}, id);

	const composerSend = (text, id) => page.evaluate((args) => {
		const leaf = window.app.workspace.getLeavesOfType('curtis-chat')
			.find((l) => l.view?.conversationId === args.id);
		const v = leaf.view;
		v.inputEl.value = args.text;
		v.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
		v.sendBtn.click();
	}, { text, id });

	await composerSend('/leader', leaderConvId);
	await until(page, (id) => {
		const s = window.app.plugins.plugins['curtis-ai-chat'];
		return s.conversationStore.getConversation(id)?.role === 'leader';
	}, leaderConvId, 5000, 'leader role set');
	const leaderTitle = await page.evaluate((id) => {
		const s = window.app.plugins.plugins['curtis-ai-chat'];
		const t = s.conversationStore.getConversation(id).title;
		s.conversationStore.renameCurrentConversation('Weekly review (leader)', id);
		return t;
	}, leaderConvId);
	await sleep(400);
	await shot('01-leader-marked.png');
	console.log('[demo] leader marked:', leaderTitle, '→ renamed "Weekly review (leader)"');

	// ---- Step 2: send the swarm prompt through the real composer.
	await composerSend(LEADER_PROMPT, leaderConvId);
	await until(page, (id) => {
		const s = window.app.plugins.plugins['curtis-ai-chat'];
		const c = s.conversationStore.getConversation(id);
		return c.messages.some((m) => m.role === 'user' && m.content.includes('weekly project review'));
	}, leaderConvId, 8000, 'prompt sent');
	console.log('[demo] prompt sent — swarm running (real model, this takes a minute or two)');

	// ---- Step 3: watch the store; screenshot the stages as they happen.
	// The model can finish a follower between two polls, so also burst-capture
	// every 3s and pick representative frames afterwards.
	mkdirSync(resolve(OUT, 'burst'), { recursive: true });
	let burstN = 0;
	const burstTimer = setInterval(() => {
		void shot(`burst/burst-${String(burstN++).padStart(3, '0')}.png`).catch(() => undefined);
	}, 3000);
	const stage = { f1: false, f2: false, mid2: false };
	const t0 = Date.now();
	let final = null;
	while (Date.now() - t0 < 420000) {
		const snap = await page.evaluate((id) => {
			const s = window.app.plugins.plugins['curtis-ai-chat'];
			const leader = s.conversationStore.getConversation(id);
			const followers = s.conversationStore.getAllConversations().filter((c) => c.role === 'follower');
			const busy = s.swarm.isFollowerBusy(followers[0]?.id ?? '');
			const anyGenerating = window.app.workspace.getLeavesOfType('curtis-chat')
				.some((l) => l.view?.isGenerating || (l.view?.arenaAbortControllers?.size ?? 0) > 0);
			return {
				leaderMessages: leader.messages.length,
				followers: followers.map((f) => ({ id: f.id, title: f.title, messages: f.messages.length })),
				busy, anyGenerating,
				noteExists: !!window.app.vault.getAbstractFileByPath('Projects/Weekly Review 2026-10-02.md'),
			};
		}, leaderConvId);

		if (!stage.f1 && snap.followers.length >= 1) {
			stage.f1 = true;
			await sleep(3500); // let the task message + first tool call land
			await shot('02-follower-one-working.png');
			console.log(`[demo] follower 1 spawned: "${snap.followers[0]?.title}"`);
		}
		if (!stage.f2 && snap.followers.length >= 2) {
			stage.f2 = true;
			await sleep(3500);
			await shot('03-follower-two-working.png');
			console.log(`[demo] follower 2 spawned: "${snap.followers[1]?.title}"`);
		}
		if (!stage.mid2 && snap.followers.length >= 2 && snap.followers[1].messages >= 3 && !snap.anyGenerating) {
			// Follower 2 finished between polls — capture what the split looks
			// like while the leader synthesizes (busy leader = tool bubbles up).
			stage.mid2 = true;
			await shot('04-reports-collected.png');
		}
		if (snap.followers.length >= 1 && !snap.busy && !snap.anyGenerating && snap.leaderMessages >= 4) {
			final = snap;
			break;
		}
		await sleep(2000);
	}
	if (!final) { clearInterval(burstTimer); hardExit('swarm did not finish within 7 minutes'); }
	clearInterval(burstTimer);
	await sleep(1500);
	await shot('05-synthesis-final.png');
	console.log('[demo] swarm finished — leader at', final.leaderMessages, 'messages, review note:', final.noteExists);

	// ---- Step 4: transcript export + summary.
	const summary = await page.evaluate((id) => {
		const s = window.app.plugins.plugins['curtis-ai-chat'];
		const leader = s.conversationStore.getConversation(id);
		const followers = s.conversationStore.getAllConversations().filter((c) => c.role === 'follower');
		const lastAssistant = [...leader.messages].reverse().find((m) => m.role === 'assistant' && m.content.trim());
		return {
			leader: { title: leader.title, messages: leader.messages.length },
			followers: followers.map((f) => ({
				title: f.title, messages: f.messages.length,
				path: s.conversationStore.getConversationPath(f.id),
				lastMsgChars: ([...f.messages].reverse().find((m) => m.role === 'assistant' && m.content.trim())?.content ?? '').length,
			})),
			leaderPath: s.conversationStore.getConversationPath(id),
			synthesisHead: (lastAssistant?.content ?? '').slice(0, 700),
			spawnCalls: leader.messages.filter((m) => m.tool_calls?.some((c) => c.name === 'spawn_agent')).length,
		};
	}, leaderConvId);
	for (const p of [summary.leaderPath, ...summary.followers.map((f) => f.path)]) {
		if (p) cpSync(resolve(VAULT, p), resolve(OUT, 'transcripts', p.split('/').pop()));
	}
	writeFileSync(resolve(OUT, 'summary.json'), JSON.stringify({ provider: probe, leader: summary.leader, followers: summary.followers, spawnCalls: summary.spawnCalls, noteCreated: final.noteExists, synthesisHead: summary.synthesisHead }, null, 2));

	// ---- Settings back the way they were; leave the vault OPEN for browsing.
	await page.evaluate((snap) => {
		const s = window.app.plugins.plugins['curtis-ai-chat'].settings;
		Object.assign(s, snap);
	}, origSettings);
	await page.evaluate(() => window.app.plugins.plugins['curtis-ai-chat'].saveSettings());
	restoreLaunchVault();
	done = true;
	clearTimeout(watchdog);
	child.unref();
	console.log('[demo] DONE — demo-vault left open; your vault is the launch default again.');
	console.log(JSON.stringify({ ...summary, synthesisHead: undefined }, null, 2));
	console.log('[demo] synthesis head:\n' + summary.synthesisHead);
}

main().catch(async (e) => {
	console.error('[demo] fatal:', e);
	if (page) await page.screenshot({ path: resolve(OUT, 'fatal.png') }).catch(() => undefined);
	try { execSync('taskkill /IM Obsidian.exe /F', { stdio: 'ignore' }); } catch { /* not running */ }
	restoreLaunchVault();
	process.exit(1);
});
