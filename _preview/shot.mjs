// Throwaway preview renderer for docs/index.html — desktop + mobile full-page shots.
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = 'file:///' + resolve(ROOT, 'docs/index.html').replaceAll('\\', '/');
const OUT = dirname(fileURLToPath(import.meta.url));

const candidates = [
	process.env.CHROME_EXE,
	'C:/Program Files/Google/Chrome/Application/chrome.exe',
	'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
	'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
	'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);

const exe = candidates.find((p) => { try { require('node:fs').accessSync(p); return true; } catch { return false; } });
if (!exe) { console.error('no chromium executable found'); process.exit(1); }

const browser = await chromium.launch({ executablePath: exe, headless: true });

// optional target page: node shot.mjs docs/research/memory-system-design-memo.html
const target = process.argv[2];
if (target) {
	const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
	await page.goto('file:///' + resolve(ROOT, target).replaceAll('\\', '/'), { waitUntil: 'networkidle' });
	await page.evaluate(() => document.fonts.ready);
	const name = target.replaceAll(/[\\/]/g, '-').replace(/\.html?$/, '');
	await page.screenshot({ path: resolve(OUT, name + '.png'), fullPage: true });
	const checks = await page.evaluate(() => ({
		bodyBg: getComputedStyle(document.body).backgroundColor,
		bodyFont: getComputedStyle(document.body).fontFamily.split(',')[0].replace(/"/g, ''),
		monoLoaded: document.fonts.check('15px "JetBrains Mono"'),
		emojiInBody: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(document.body.textContent),
		brokenImgs: [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.src),
	}));
	console.log(JSON.stringify(checks, null, 2));
	await page.close();
	await browser.close();
	process.exit(0);
}

// desktop
let page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(PAGE, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: resolve(OUT, 'desktop-full.png'), fullPage: true });
await page.screenshot({ path: resolve(OUT, 'desktop-hero.png') });
await page.close();

// mobile
page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 2 });
await page.goto(PAGE, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: resolve(OUT, 'mobile-full.png'), fullPage: true });
await page.close();

// pre-flight: computed tokens + font + offending CSS
page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(PAGE, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
const checks = await page.evaluate(() => {
	const cs = (sel, prop) => {
		const el = document.querySelector(sel);
		return el ? getComputedStyle(el)[prop] : 'MISSING';
	};
	const font = (sel) => {
		const el = document.querySelector(sel);
		return el ? getComputedStyle(el).fontFamily.split(',')[0].replace(/"/g, '') : 'MISSING';
	};
	const bad = [];
	for (const sheet of document.styleSheets) {
		let rules; try { rules = sheet.cssRules; } catch { continue; }
		for (const r of rules) {
			const t = r.cssText || '';
			if (/gradient\(/.test(t)) bad.push('gradient: ' + r.selectorText);
			if (/box-shadow/.test(t) && !/none/.test(t)) bad.push('box-shadow: ' + r.selectorText);
			if (/backdrop-filter/.test(t) && !/none/.test(t)) bad.push('backdrop-filter: ' + r.selectorText);
			if (/animation\s*:/.test(t) && !/none/.test(t)) bad.push('animation: ' + r.selectorText);
		}
	}
	return {
		bodyBg: cs('body', 'backgroundColor'),
		h1Color: cs('.hero h1', 'color'),
		greenUsed: cs('.hero .kicker', 'color'),
		border: cs('.feat', 'borderColor'),
		surface: cs('.feat', 'backgroundColor'),
		h1Font: font('.hero h1'),
		bodyFont: font('body'),
		monoLoaded: document.fonts.check('15px "JetBrains Mono"'),
		emojiInBody: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(document.body.textContent),
		offenders: bad,
	};
});
console.log(JSON.stringify(checks, null, 2));
await page.close();
await browser.close();
