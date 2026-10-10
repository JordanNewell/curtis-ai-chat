// Demo recording for Curtis AI Chat — motion assets for README + site.
//
// Same boot machinery as capture-arena-shots.mjs (real Obsidian on the demo
// vault over CDP), but instead of stills it records the screen while driving
// the flow. Frames come from Page.startScreencast, assembled by ffmpeg into
// MP4 + GIF.
//
// All-cloud lineup by design: local models load too slowly for a paced take
// (the Ollama duel was removed for exactly that reason — a column spinning
// empty while the cloud sibling finishes reads as broken). Stills can still
// feature Ollama; videos cannot.
//
// Outputs (assets/):
//   demo-arena-cloud-vs-cloud.mp4/.gif  — OpenRouter Gemini 3.1 Flash-Lite vs
//                                         DeepSeek V4.1 Flash (official API)
//   demo-memory.mp4/.gif                — ask-before-saving proposal bar
//
// Usage:  node scripts/record-arena-demo.mjs
// Env:    OBSIDIAN_EXE (default: scoop obsidian current)
//         DEMOS="cloud" — comma list to record a subset (cloud, memory)
//
// The user's running Obsidian is closed for the duration and relaunched at
// the end (same contract as npm run shots).

import { spawn, execSync } from 'node:child_process';
import { cpSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VAULT = resolve(ROOT, 'demo-vault');
const PLUGIN_DIR = resolve(VAULT, '.obsidian/plugins/curtis-ai-chat');
const OUT_DIR = resolve(ROOT, 'assets');

const OBSIDIAN_EXE =
	process.env.OBSIDIAN_EXE ||
	resolve(process.env.USERPROFILE ?? process.env.HOME, 'scoop/apps/obsidian/current/Obsidian.exe');

// Screen-record pacing: the prompt is typed character by character so the
// video shows a human driving, not a paste. ~300 words keeps BOTH columns
// visibly streaming long enough to overlap — the 120-word ask let the cloud
// flash models finish before the local model's first token landed.
const PROMPT =
	'Write a 220-word comparison of side-by-side model testing versus picking an LLM from leaderboards. Two bullet points, one closing sentence, no preamble. The answer must be at least 200 words.';

const DEMOS = (process.env.DEMOS || 'cloud,memory').split(',').map((s) => s.trim());

// ---------------------------------------------------------------------------
// Vault bootstrap + registry (same contract as the other capture scripts)
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
	// The note behind the chat: no H1 (inline title already renders the
	// filename — an H1 would show a duplicated heading in full-window frames).
	writeFileSync(
		resolve(VAULT, 'Daily/2026-10-02.md'),
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

// ---------------------------------------------------------------------------
// Boot + attach (same machinery as the other scripts)
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
			// Pin the window: restored bounds vary (a crashed prior run leaves
			// a small window, and min(62vw, 980px) chat-width math collapses
			// with the viewport). 1440x900 frames cleanly at 1280-wide capture.
			'--window-size=1440,900',
			// Windows pauses an occluded Electron window's renderer, which
			// would stall the screencast frames mid-recording when the
			// capture window gets buried under other windows.
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
	for (const p of ctx.pages()) {
		p.on('pageerror', (e) => console.log(`[obsidian] pageerror: ${e.message.slice(0, 120)}`));
	}
	ctx.on('page', (p) => p.on('pageerror', (e) => console.log(`[obsidian] pageerror: ${e.message.slice(0, 120)}`)));

	let page = await waitForVaultPage(ctx, () => true, 30000, 'window');
	try {
		await page.getByRole('button', { name: /trust/i }).click({ timeout: 8000 });
		console.log('[demo] dismissed trust-vault modal');
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

// ---------------------------------------------------------------------------
// Recording — polled CDP screenshots → ffmpeg → MP4 + GIF
// ---------------------------------------------------------------------------

/** Start recording the page; returns a recorder handle. Pull-based capture:
 *  Node asks CDP for a JPEG every ~150ms via Page.captureScreenshot, which
 *  forces the renderer to produce a frame on demand. The push-based
 *  screencast alternative died every take the moment both arena columns
 *  streamed — the starved compositor stopped emitting frames and the video
 *  just ended. captureScreenshot keeps the pipeline fed under load.
 *  captureScreenshot waits for each result, so a slow renderer slows the
 *  cadence instead of dropping it. Frames are deduped (identical consecutive
 *  shots are skipped) so idle stretches don't bloat the GIF. */
async function startRecording(page) {
	const cdp = await page.context().newCDPSession(page);
	const framesDir = resolve(tmpdir(), `curtis-demo-${randomUUID().slice(0, 8)}`);
	mkdirSync(framesDir, { recursive: true });
	let n = 0;
	let running = true;
	let lastData = null;
	let lastStamp = Date.now();
	let fails = 0;
	const manifest = [{ file: null, t: 0 }];
	const captureLoop = (async () => {
		while (running) {
			const started = Date.now();
			try {
				const shot = await cdp.send('Page.captureScreenshot', {
					format: 'jpeg',
					quality: 55,
				});
				if (fails > 0) console.log(`[demo] capture recovered after ${fails} misses`);
				fails = 0;
				const data = Buffer.from(shot.data, 'base64');
				if (!lastData || !data.equals(lastData)) {
					const now = Date.now();
					manifest.push({ file: `f_${String(n).padStart(5, '0')}.jpg`, t: now - lastStamp });
					lastStamp = now;
					writeFileSync(resolve(framesDir, manifest[manifest.length - 1].file), data);
					lastData = data;
					n++;
				}
			} catch (e) {
				fails++;
				if (fails === 1 || fails % 10 === 0) {
					console.log(`[demo] capture miss #${fails}: ${String(e.message).slice(0, 90)}`);
				}
			}
			const elapsed = Date.now() - started;
			await new Promise((r) => setTimeout(r, Math.max(0, 150 - elapsed)));
		}
	})();
	return {
		framesDir,
		manifest,
		async stop() {
			running = false;
			await captureLoop.catch(() => {});
			try { await cdp.detach(); } catch { /* already detached */ }
			await new Promise((r) => setTimeout(r, 400));
		},
	};
}

/** Assemble recorded frames into an MP4 and a README-friendly GIF. The
 *  capture cadence varies with renderer load (a saturated renderer serves a
 *  frame every few seconds), so frames carry their wall-clock gaps and the
 *  concat demuxer plays them at true speed — capped at 1s so dead air cuts
 *  instead of freezing, floored at 80ms so fast moments don't strobe. */
function encodeRecording(rec, outBase) {
	const frames = rec.manifest.filter((m) => m.file);
	if (frames.length < 10) throw new Error(`only ${frames.length} frames recorded — nothing to encode`);
	console.log(`[demo] encoding ${frames.length} frames → ${outBase}.mp4/.gif`);
	const listPath = resolve(rec.framesDir, 'list.txt');
	// manifest[i].t is the gap since the previous frame, so frame i's display
	// time is the NEXT entry's gap; the last frame gets a default half-second.
	const dur = (i) => {
		const next = frames[i + 1];
		const ms = next ? next.t : 500;
		return Math.min(1, Math.max(0.08, ms / 1000));
	};
	const list = frames
		.map((f, i) => `file '${f.file}'\nduration ${dur(i).toFixed(2)}`)
		.join('\n') + `\nfile '${frames[frames.length - 1].file}'`;
	writeFileSync(listPath, `ffconcat version 1.0\n${list}\n`);
	// Screencast frames can arrive at odd heights (e.g. 1280x719); yuv420p
	// H.264 requires even dimensions or libx264 refuses to open.
	execSync(
		`ffmpeg -y -f concat -safe 0 -i "${listPath}" ` +
		`-vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" ` +
		`-c:v libx264 -pix_fmt yuv420p -crf 22 -movflags +faststart "${resolve(OUT_DIR, outBase + '.mp4')}"`,
		{ stdio: 'ignore' }
	);
	execSync(
		`ffmpeg -y -f concat -safe 0 -i "${listPath}" ` +
		`-vf "scale=720:-2:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5" ` +
		`"${resolve(OUT_DIR, outBase + '.gif')}"`,
		{ stdio: 'ignore' }
	);
	rmSync(rec.framesDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Page-side helpers
// ---------------------------------------------------------------------------

const openChatAndRender = async () => {
	window.app.commands.executeCommandById('curtis-ai-chat:open-chat');
	const deadline = Date.now() + 10000;
	while (Date.now() < deadline) {
		if (document.querySelector('.workspace-leaf-content[data-type="curtis-chat"]')) break;
		await new Promise((r) => setTimeout(r, 200));
	}
	window.app.plugins.plugins['curtis-ai-chat'].refreshChatViews?.();
};

const setBodyTheme = (theme) => {
	document.body.classList.remove('theme-light', 'theme-dark', 'theme-type-light', 'theme-type-dark');
	document.body.classList.add(`theme-${theme}`, `theme-type-${theme}`);
	const el = document.querySelector('.curtis-messages') || document.body;
	const m = getComputedStyle(el).backgroundColor.match(/\d+/g) || ['255', '255', '255'];
	const [r, g, b] = m.map(Number);
	return { bg: m.join(','), lum: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 };
};

/** Force the chat split wide via inline !important properties (same trick
 *  as the still-capture script; verified against Obsidian's layout pass). */
async function ensureWideChat(page) {
	let lastWidth = -1;
	for (let i = 0; i < 10; i++) {
		lastWidth = await page.evaluate(() => {
			const leaf = document.querySelector('.workspace-leaf-content[data-type="curtis-chat"]');
			const split = leaf?.closest('.workspace-split');
			if (!split) return -1;
			for (const prop of ['width', 'max-width', 'flex-basis']) {
				// Fixed px, not 62vw: a narrow restored window collapses the
				// vw math and the arena columns end up cramped.
				split.style.setProperty(prop, '980px', 'important');
			}
			return split.offsetWidth;
		});
		if (lastWidth >= 700) return lastWidth;
		await page.waitForTimeout(400);
	}
	throw new Error(`chat split would not widen (last width ${lastWidth}px)`);
}

const anyColumnLive = () => {
	for (const c of document.querySelectorAll('.ai-arena-column')) {
		const chars = (c.querySelector('.ai-arena-column-response')?.textContent || '').trim().length;
		if (chars >= 60 && c.querySelector('.ai-arena-stop-btn')) return true;
	}
	return false;
};

async function pollState(ctx, pred, timeoutMs) {
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

const resolveModel = (page, pid, wanted) =>
	page.evaluate(
		([p, w]) => {
			const prov = window.app.plugins.plugins['curtis-ai-chat'].providerRegistry.getProvider(p);
			const m = prov?.models.find((x) => x.id === w) ?? prov?.models.find((x) => w && x.id.includes(w)) ?? prov?.models[0];
			return m ? { id: m.id, name: m.name } : null;
		},
		[pid, wanted]
	);

/** Since the per-pane redesign, each chat PANE owns its provider/model —
 *  plugin.settings hold only the default for NEWLY opened panes. Swapping
 *  settings alone leaves an open pane streaming with its old model (the
 *  memory take shipped a DeepSeek-400 on camera that way). Bind the pane
 *  fields + refresh its picker pill directly. */
const bindPaneModel = (page, providerId, modelId) =>
	page.evaluate(
		([p, m]) => {
			const view = window.app.workspace.getLeavesOfType('curtis-chat')[0]?.view;
			if (!view) throw new Error('no chat view open to bind');
			view.activeProviderId = p;
			view.activeModelId = m;
			const btn = view.contentEl.querySelector('.ai-model-picker-btn');
			if (btn && typeof view.updateModelPickerButton === 'function') view.updateModelPickerButton(btn);
		},
		[providerId, modelId]
	);

/** DeepSeek V4.1 defaults to thinking mode server-side: temperature is
 *  ignored, first content token lands 10-30s late, and the arena column
 *  sits on a dead spinner through all of it — fatal for a paced recording.
 *  Patch the live provider instance (built once at onload, so the patch
 *  survives settings saves) to send thinking:disabled per DeepSeek's API. */
const disableDeepseekThinking = (page) =>
	page.evaluate(() => {
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

// ---------------------------------------------------------------------------
// Demo flows
// ---------------------------------------------------------------------------

/** One recorded arena duel: pick two models, start, type, send, stop one
 *  column mid-stream, promote the winner. */
async function recordDuel(page, ctx, pair, outBase) {
	const { providerA, modelAId, providerB, modelBId } = pair;
	if (providerA === 'openrouter' || providerB === 'openrouter') {
		// initializeProviders() is fire-and-forget in onload, so OpenRouter's
		// /models discovery may still be in flight here — resolving early
		// would silently fall back to openrouter/auto and the duel would run
		// the wrong model on camera.
		await page
			.waitForFunction(() => {
				const prov = window.app.plugins.plugins['curtis-ai-chat'].providerRegistry.getProvider('openrouter');
				return !!prov && prov.models.length > 1;
			}, { timeout: 30000 })
			.catch(() => console.log('[demo] !! openrouter discovery never landed — auto router will stand in'));
	}
	const modelA = await resolveModel(page, providerA, modelAId);
	const modelB = await resolveModel(page, providerB, modelBId);
	if (!modelA || !modelB) throw new Error(`could not resolve models for ${providerA}/${modelAId} vs ${providerB}/${modelBId}`);
	if (modelA.id === modelB.id) throw new Error('both duel members resolved to the same model');
	console.log(`[demo] duel: ${providerA}/${modelA.id} vs ${providerB}/${modelB.id}`);

	await page.evaluate(([p, m]) => {
		const plugin = window.app.plugins.plugins['curtis-ai-chat'];
		plugin.settings.activeProvider = p;
		plugin.settings.activeModel = m;
		plugin.saveSettings();
		const conv = plugin.conversationStore.createConversation(p, m);
		plugin.conversationStore.setCurrentConversation(conv.id);
		// Per-pane redesign: an open pane keeps its own conversation binding —
		// switchConversation points the CAMERA pane at the fresh conversation
		// (setCurrentConversation alone only moves the default for new panes).
		const view = window.app.workspace.getLeavesOfType('curtis-chat')[0]?.view;
		if (view && typeof view.switchConversation === 'function') view.switchConversation(conv.id);
	}, [providerA, modelA.id]);
	await bindPaneModel(page, providerA, modelA.id);

	const rec = await startRecording(page);
	try {
		// Picker: open, select the second duelist, start.
		await page.click('.ai-chat-arena-btn');
		await pollState(ctx, () => !!document.querySelector('.ai-arena-picker-modal'), 8000);
		await page.waitForTimeout(700);
		await page.evaluate((name) => {
			const rows = Array.from(document.querySelectorAll('.ai-arena-picker-row'));
			const row = rows.find((r) => r.querySelector('.ai-arena-picker-name')?.textContent === name);
			if (!row) throw new Error('picker row not found for ' + name);
			row.scrollIntoView({ block: 'center' });
			row.click();
		}, modelB.name);
		await page.waitForTimeout(700);
		await page.locator('.ai-arena-picker-start').click();
		await page.waitForTimeout(600);

		// Type like a human, then send. Park the pointer afterwards: it rests
		// on the send button (which becomes stop-generating) and its tooltip
		// would ride the rest of the recording.
		await page.type('.ai-chat-input', PROMPT, { delay: 22 });
		await page.waitForTimeout(500);
		await page.click('.ai-chat-send-btn');
		const vp = page.viewportSize() ?? { width: 1280, height: 800 };
		await page.mouse.move(Math.round(vp.width * 0.85), Math.round(vp.height * 0.35));

		// Wait for a column to be visibly streaming, then stop the other
		// side mid-flight to demo the per-column stop.
		await pollState(ctx, anyColumnLive, 45000);
		await page.waitForTimeout(2500);
		const stoppable = await page.evaluate(() => {
			const cols = document.querySelectorAll('.ai-arena-column');
			// Stop whichever column still streams; prefer column 2 so the
			// local/first model's answer survives into the promote step.
			if (cols[1]?.querySelector('.ai-arena-stop-btn')) return 1;
			if (cols[0]?.querySelector('.ai-arena-stop-btn')) return 0;
			return -1;
		});
		if (stoppable >= 0) {
			// Streaming re-renders replace the stop button node on every
			// chunk, so Playwright's stability check can stall — click via
			// JS dispatch and retry across re-renders.
			for (let click = 0; click < 4; click++) {
				try {
					await page.locator('.ai-arena-stop-btn').nth(stoppable).evaluate((el) => el.click());
					break;
				} catch { /* button detached mid-click — retry */ }
				await page.waitForTimeout(250);
			}
			await page.waitForTimeout(1200);
		}

		// Let things settle, then abort any column that hung (cold provider,
		// stalled connection) — a blank stop button lingering into the
		// promote beat ruined the first take's ending. Cloud flash models
		// settle a 220-word answer well inside a minute.
		await pollState(
			ctx,
			() => document.querySelectorAll('.ai-arena-column .ai-arena-stop-btn').length === 0
				&& document.querySelectorAll('.ai-arena-column-response').length === 2,
			60000
		);
		const hungStops = await page.locator('.ai-arena-stop-btn').count();
		for (let i = 0; i < hungStops; i++) {
			await page.locator('.ai-arena-stop-btn').first().click().catch(() => { /* already gone */ });
			await page.waitForTimeout(400);
		}
		await page.waitForTimeout(900);

		// Promote the column with the most content (the winner the viewer
		// just watched), and hold on the clean thread for the outro beat.
		await page.evaluate(() => {
			const cols = Array.from(document.querySelectorAll('.ai-arena-column'));
			let best = -1;
			let bestChars = -1;
			cols.forEach((c, i) => {
				const chars = (c.querySelector('.ai-arena-column-response')?.textContent || '').trim().length;
				if (chars > bestChars) { bestChars = chars; best = i; }
			});
			const btn = cols[best]?.querySelector('.ai-arena-promote-btn:not([disabled])');
			if (btn instanceof HTMLElement) btn.click();
		});
		await page.waitForTimeout(3200);
	} finally {
		await rec.stop();
	}
	encodeRecording(rec, outBase);
}

/** The memory demo: confirm-mode capture proposes facts, the video shows
 *  Save on one and Skip on the other. Needs memory ON + a provider willing
 *  to return facts from a personal message. */
async function recordMemoryDemo(page, ctx, providerId, modelId, outBase) {
	const model = await resolveModel(page, providerId, modelId);
	if (!model) throw new Error(`could not resolve ${providerId}/${modelId} for the memory demo`);
	await page.evaluate(([p, m]) => {
		const plugin = window.app.plugins.plugins['curtis-ai-chat'];
		plugin.settings.enableMemory = true;
		plugin.settings.memoryCaptureMode = 'confirm';
		plugin.settings.enableRag = false;
		plugin.settings.activeProvider = p;
		plugin.settings.activeModel = m;
		plugin.saveSettings();
		const conv = plugin.conversationStore.createConversation(p, m);
		plugin.conversationStore.setCurrentConversation(conv.id);
		// Same per-pane binding fix as the duel — point the camera pane at
		// the fresh conversation.
		const view = window.app.workspace.getLeavesOfType('curtis-chat')[0]?.view;
		if (view && typeof view.switchConversation === 'function') view.switchConversation(conv.id);
	}, [providerId, model.id]);
	await bindPaneModel(page, providerId, model.id);

	const rec = await startRecording(page);
	try {
		await page.type(
			'.ai-chat-input',
			'Remember a few things about me: my name is Jordan, I prefer concise answers with no preamble, and my main side project is an Obsidian plugin called Curtis AI Chat.',
			{ delay: 18 }
		);
		await page.waitForTimeout(400);
		await page.click('.ai-chat-send-btn');
		const vp = page.viewportSize() ?? { width: 1280, height: 800 };
		await page.mouse.move(Math.round(vp.width * 0.85), Math.round(vp.height * 0.35));
		// Normal reply streams first; extraction runs after the turn.
		await pollState(ctx, () => !!document.querySelector('.ai-memory-proposal-bar'), 90000);
		await page.waitForTimeout(900);
		// Save the first proposal, skip the rest.
		const save = page.locator('.ai-memory-proposal-row .mod-cta').first();
		if (await save.count() > 0) {
			await save.click();
			await page.waitForTimeout(1600);
		}
		const skip = page.locator('.ai-memory-proposal-row button:not(.mod-cta)').first();
		if (await skip.count() > 0) {
			await skip.click();
			await page.waitForTimeout(900);
		}
	} finally {
		await rec.stop();
	}
	encodeRecording(rec, outBase);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	const watchdog = setTimeout(() => {
		console.error('[demo] watchdog: exceeded 15 minutes — aborting');
		restoreLaunchVault();
		try { execSync('taskkill /IM Obsidian.exe /F', { stdio: 'ignore' }); } catch { /* not running */ }
		process.exit(9);
	}, 15 * 60 * 1000);
	watchdog.unref?.();

	bootstrapVault();
	registerDemoVault();
	// Reset the demo vault's workspace so Obsidian doesn't restore stale
	// window bounds — a crashed prior run left a ~840px window once, which
	// clipped the 980px chat split. With no workspace.json the launch flag's
	// 1440x900 applies and main() reopens the daily note itself.
	try { rmSync(resolve(VAULT, '.obsidian/workspace.json')); } catch { /* none */ }
	console.log('[demo] closing Obsidian if running…');
	await killObsidian();

	const inst = await bootInstance(9227);
	try {
		let { page, ctx } = inst;
		page.on('crash', () => console.log('[demo] !! renderer crashed'));

		// Electron ignores --window-size in packaged apps and Obsidian's
		// restored bounds are whatever the last window was (a ~840px window
		// clips the 980px chat split). resizeTo works on non-maximized
		// windows — resize and verify, since a silent no-op breaks the stage.
		await page.evaluate(() => window.resizeTo(1440, 900));
		await page.waitForTimeout(800);
		const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
		console.log(`[demo] viewport: ${vp.w}x${vp.h}`);
		if (!vp.w || vp.w < 1100) {
			throw new Error(`window too narrow after resizeTo (${vp.w}px) — close other Obsidian windows and retry`);
		}

		// Deterministic stage: memory off for the duels, dark theme, wide
		// chat, note behind it.
		await page.evaluate(() => {
			const plugin = window.app.plugins.plugins['curtis-ai-chat'];
			plugin.settings.enableMemory = false;
			plugin.settings.enableRag = false;
			plugin.saveSettings();
		});
		await page.evaluate(() => location.reload());
		page = await waitForVaultPage(
			ctx,
			() => !!window.app?.plugins?.plugins?.['curtis-ai-chat']?.conversationStore,
			45000,
			'demo reload'
		);
		await waitForVaultPage(
			ctx,
			() => !!window.app?.commands?.commands?.['curtis-ai-chat:open-chat'],
			15000,
			'command registration (demo reload)'
		);

		await disableDeepseekThinking(page);

		await page.evaluate(openChatAndRender);
		// Toasts ("Arena ready…", "Enabled Ollama") linger into the recording.
		await page.addStyleTag({ content: `.notice-container { display: none !important; }` });
		const meas = await page.evaluate(setBodyTheme, 'dark');
		if (meas.lum > 0.25) throw new Error(`dark theme flip failed (bg rgb(${meas.bg}))`);
		await ensureWideChat(page);
		await page.evaluate(() => window.app.workspace.openLinkText('Daily/2026-10-02.md', ''));
		await page.waitForTimeout(800);

		if (DEMOS.includes('memory')) {
			console.log('[demo] recording: memory Save/Skip bar');
			await recordMemoryDemo(page, ctx, 'deepseek', 'deepseek-flash', 'demo-memory');
		}
		if (DEMOS.includes('cloud')) {
			// The two-API duel: same tier, different vendors and pipes —
			// Gemini 3.1 Flash-Lite served by OpenRouter against DeepSeek's
			// official V4.1 Flash. Two different APIs, visibly different prose.
			console.log('[demo] recording: OpenRouter Gemini vs official DeepSeek');
			await recordDuel(
				page, ctx,
				{ providerA: 'openrouter', modelAId: 'google/gemini-3.1-flash-lite', providerB: 'deepseek', modelBId: 'deepseek-flash' },
				'demo-arena-cloud-vs-cloud'
			);
		}
	} finally {
		await shutdownInstance(inst);
	}

	restoreLaunchVault();
	console.log('[demo] done — assets in assets/');
	console.log('[demo] relaunching your Obsidian session…');
	spawn(OBSIDIAN_EXE, [], { detached: true, stdio: 'ignore' }).unref();
	clearTimeout(watchdog);
	process.exit(0);
}

main().catch((e) => {
	console.error('[demo] failed:', e);
	restoreLaunchVault();
	try { execSync('taskkill /IM Obsidian.exe /F', { stdio: 'ignore' }); } catch { /* not running */ }
	process.exit(1);
});
