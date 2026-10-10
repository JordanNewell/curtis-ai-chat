// ConversationStore boot-scan smoke test — cold-boots the demo vault TWICE and
// asserts the store ingests seeded conversations and writes no duplicate files.
// Guards the boot race where Obsidian's vault file tree is not yet populated
// when plugins load: the scan used to see 0 files, and the legacy localStorage
// import then re-wrote the same conversations on every boot (thousands of
// numbered copies accumulated in demo-vault).
//
// Kills the running Obsidian for the duration; does not reopen it.
//
//   boot 1: the scan must ingest the seeded files (store + path lookup)
//   boot 2: ZERO new copies of the known-duplicate series (loop is closed)
//
// Usage: node scripts/smoke-store.mjs
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { readdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VAULT = resolve(ROOT, 'demo-vault');
const CONVS = resolve(VAULT, 'AI/Conversations');
const PLUGIN_DIR = resolve(VAULT, '.obsidian/plugins/curtis-ai-chat');
const EXE = process.env.OBSIDIAN_EXE || resolve(process.env.USERPROFILE ?? process.env.HOME, 'scoop/apps/obsidian/current/Obsidian.exe');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { cpSync } = await import('node:fs');
cpSync(resolve(ROOT, 'main.js'), resolve(PLUGIN_DIR, 'main.js'));
cpSync(resolve(ROOT, 'styles.css'), resolve(PLUGIN_DIR, 'styles.css'));

const SEED_IDS = ['conv_verify_alpha_0001', 'conv_verify_bravo_0002', 'conv_verify_charlie_0003', 'conv_verify_delta_0004'];
const seedFile = (id) => `${id}.md`;
const seedBody = (id, title) => [
	'---',
	'curtis: conversation',
	`id: ${id}`,
	`created: 1791556000000`,
	`updated: 1791556000000`,
	'provider: deepseek',
	'model: deepseek-chat',
	'---',
	'',
	`# ${title}`,
	'',
	'## You',
	'<!-- curtis:msg {"id":"m1","ts":1791556000000,"role":"user"} -->',
	'',
	'Seed message for store verification.',
	'',
	'## AI',
	'<!-- curtis:msg {"id":"m2","ts":1791556000001,"role":"assistant"} -->',
	'',
	'Seed reply.',
	'',
].join('\n');

const rmSeeds = () => { for (const id of SEED_IDS) rmSync(resolve(CONVS, seedFile(id)), { force: true }); };
const seedAll = () => {
	rmSeeds();
	SEED_IDS.forEach((id, i) => writeFileSync(resolve(CONVS, seedFile(id)), seedBody(id, `Verify ${i + 1}`)));
};
const count2szvoi = () => readdirSync(CONVS).filter((f) => f.includes('2szvoi')).length;

async function bootOnce(label) {
	execSync('powershell -NoProfile -Command "Stop-Process -Name Obsidian -Force -ErrorAction SilentlyContinue; exit 0"');
	await sleep(3000);
	const zBefore = count2szvoi();
	spawn(EXE, [VAULT, '--remote-debugging-port=9334'], { stdio: 'ignore', detached: true }).unref();
	let up = false;
	for (let i = 0; i < 50 && !up; i++) {
		try { const r = await fetch('http://127.0.0.1:9334/json/version'); up = r.ok; } catch { await sleep(500); }
	}
	if (!up) throw new Error('debug port never opened');
	const browser = await chromium.connectOverCDP('http://127.0.0.1:9334');
	const ctx = browser.contexts()[0];
	const consoleLines = [];
	ctx.on('page', (p) => p.on('console', (m) => {
		if (m.text().includes('[Curtis]')) consoleLines.push(m.text().slice(0, 180));
	}));
	for (const p of ctx.pages()) {
		p.on('console', (m) => { if (m.text().includes('[Curtis]')) consoleLines.push(m.text().slice(0, 180)); });
	}
	let page = null;
	for (let i = 0; i < 30 && !page; i++) {
		for (const p of ctx.pages()) {
			try { if ((await p.evaluate(() => window.app?.vault?.getName?.())) === 'demo-vault') { page = p; break; } } catch { /* stale */ }
		}
		if (!page) await sleep(1000);
	}
	try { await page.getByRole('button', { name: /trust/i }).click({ timeout: 8000 }); } catch { /* trusted */ }
	// The settle runs in the background (up to ~45s on a racy boot) — wait
	// until every seed is found or 50s elapses, then report what landed.
	let seedsFound = 0;
	for (let i = 0; i < 50; i++) {
		seedsFound = await page.evaluate((ids) => {
			const s = window.app.plugins.plugins['curtis-ai-chat']?.conversationStore;
			return s ? ids.filter((id) => !!s.getConversation(id)).length : -1;
		}, SEED_IDS).catch(() => -1);
		if (seedsFound === SEED_IDS.length) break;
		await sleep(1000);
	}
	await sleep(1500);
	const diag = await page.evaluate((ids) => {
		const store = window.app.plugins.plugins['curtis-ai-chat'].conversationStore;
		return {
			total: store.getAllConversations().length,
			seedsFound: ids.filter((id) => !!store.getConversation(id)).length,
			alphaByPath: !!store.getConversationByPath(`AI/Conversations/${ids[0]}.md`),
			alphaRole: store.getConversation(ids[0])?.title ?? null,
		};
	}, SEED_IDS);
	await sleep(1000);
	execSync('powershell -NoProfile -Command "Stop-Process -Name Obsidian -Force -ErrorAction SilentlyContinue; exit 0"');
	await browser.close().catch(() => undefined);
	await sleep(2000);
	const zAfter = count2szvoi();
	console.log(`[${label}] store: ${diag.total} convs | seeds found: ${diag.seedsFound}/4 | byPath: ${diag.alphaByPath} | title: ${diag.alphaRole}`);
	console.log(`[${label}] 2szvoi copies before: ${zBefore}, after: ${zAfter}, new: ${zAfter - zBefore}`);
	for (const l of consoleLines) console.log(`[${label}] console: ${l}`);
	return { seedsFound: diag.seedsFound, byPath: diag.alphaByPath, zNew: zAfter - zBefore };
}

seedAll();
const boot1 = await bootOnce('boot-1');
const boot2 = await bootOnce('boot-2');
rmSeeds();
const pass = boot1.seedsFound === 4 && boot1.byPath && boot2.seedsFound === 4 && boot2.zNew === 0;
console.log(pass ? 'VERIFY: PASS' : `VERIFY: FAIL (boot1: ${JSON.stringify(boot1)}, boot2: ${JSON.stringify(boot2)})`);
process.exit(pass ? 0 : 1);
