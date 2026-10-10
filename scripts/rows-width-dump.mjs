import { spawn, execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VAULT = resolve(ROOT, 'demo-vault');
const OBSIDIAN_EXE = resolve(process.env.USERPROFILE ?? process.env.HOME, 'scoop/apps/obsidian/current/Obsidian.exe');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitPort(ms) { const d = Date.now() + ms; while (Date.now() < d) { try { if ((await fetch('http://127.0.0.1:9341/json/version')).ok) return true; } catch {} await sleep(500); } return false; }
try {
  try { execSync('taskkill /IM Obsidian.exe /F', { stdio: 'ignore' }); } catch {}
  await sleep(2500);
  const child = spawn(OBSIDIAN_EXE, [VAULT, '--remote-debugging-port=9341', '--window-size=1500,1000'], { detached: false, stdio: 'ignore' });
  if (!(await waitPort(25000))) throw new Error('port');
  let browser = null;
  for (let i = 0; i < 5 && !browser; i++) { try { browser = await chromium.connectOverCDP('http://127.0.0.1:9341'); } catch { await sleep(2000); } }
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url()) ?? ctx.pages()[0];
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) { try { if (await page.evaluate(() => window.app?.vault?.getName?.() === 'demo-vault')) break; } catch {} await sleep(1000); }
  try { await page.getByRole('button', { name: /trust/i }).click({ timeout: 5000 }); } catch {}
  await page.evaluate(async () => { try { await window.app.plugins.enablePlugin('curtis-ai-chat'); } catch {} });
  await sleep(1200);
  await page.evaluate(() => { window.app.setting.open(); window.app.setting.openTabById('curtis-ai-chat'); });
  await sleep(2500);
  let target = null;
  for (const p of ctx.pages()) { try { if (await p.evaluate(() => document.querySelectorAll('.setting-item').length) > 0) { target = p; break; } } catch {} }
  const out = await target.evaluate(() => {
    // Ancestor chain for the two broken rows + one healthy toggle row.
    const chain = (label) => {
      const el = [...document.querySelectorAll('.curtis-settings .setting-item-name')]
        .find((n) => n.textContent.trim() === label)?.closest('.setting-item');
      if (!el) return { label, found: false };
      const up = [];
      let cur = el.parentElement;
      for (let i = 0; i < 5 && cur; i++) {
        up.push(cur.tagName + '.' + String(cur.className).slice(0, 50) + ' w=' + Math.round(cur.getBoundingClientRect().width));
        cur = cur.parentElement;
      }
      const r = el.getBoundingClientRect();
      return { label, found: true, rowX: Math.round(r.x), rowW: Math.round(r.width), prevSib: el.previousElementSibling?.tagName + '.' + String(el.previousElementSibling?.className).slice(0, 40), nextSib: el.nextElementSibling?.tagName + '.' + String(el.nextElementSibling?.className).slice(0, 40), up };
    };
    const get = (label) => [...document.querySelectorAll('.curtis-settings .setting-item-name')]
      .find((n) => n.textContent.trim() === label)?.closest('.setting-item');
    const stream = get('Stream responses');
    const token = get('Show token usage');
    const day = get('Day separators');
    const wrap = stream?.closest('.setting-items');
    const wcs = wrap ? getComputedStyle(wrap) : null;
    const results = [];
    if (stream && token && day && wcs) {
      const r = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
      const scs = getComputedStyle(stream);
      results.push({
        wrap: { display: wcs.display, grid: wcs.gridTemplateColumns.slice(0, 60), flow: wcs.gridAutoFlow, flexDir: wcs.flexDirection, flexWrap: wcs.flexWrap, justify: wcs.justifyContent, w: Math.round(wrap.getBoundingClientRect().width) },
        streamBox: r(stream), tokenBox: r(token), dayBox: r(day),
        streamStyle: { width: scs.width, flex: scs.flex, minW: scs.minWidth, justifySelf: scs.justifySelf, alignSelf: scs.alignSelf, display: scs.display },
        siblings: [...(wrap?.children ?? [])].slice(0, 14).map((c) => (c.querySelector('.setting-item-name')?.textContent ?? c.className).toString().slice(0, 24) + ' @' + Math.round(c.getBoundingClientRect().x) + ',' + Math.round(c.getBoundingClientRect().y) + ' w' + Math.round(c.getBoundingClientRect().width)),
      });
    }
    return { chains: results, rows: [] };
    for (const r of document.querySelectorAll('.curtis-settings .setting-item')) {
      if (r.classList.contains('setting-item-heading')) continue;
      const name = r.querySelector(':scope > .setting-item-info > .setting-item-name');
      if (!name) continue;
      const info = r.querySelector(':scope > .setting-item-info');
      const ctrl = r.querySelector(':scope > .setting-item-control');
      const rcs = getComputedStyle(r);
      const ics = info ? getComputedStyle(info) : null;
      const ccs = ctrl ? getComputedStyle(ctrl) : null;
      rows.push({
        name: name.textContent.trim().slice(0, 20),
        nameW: Math.round(name.getBoundingClientRect().width),
        infoW: info ? Math.round(info.getBoundingClientRect().width) : -1,
        ctrlW: ctrl ? Math.round(ctrl.getBoundingClientRect().width) : -1,
        tog: !!r.querySelector(':scope > .setting-item-control .checkbox-container'),
        rowDir: rcs.flexDirection,
        infoMinW: ics ? ics.minWidth : null,
        ctrlMinW: ccs ? ccs.minWidth : null,
        ctrlJus: ccs ? ccs.justifyContent : null,
      });
    }
    const content = document.querySelector('.curtis-settings');
    return { contentW: Math.round(content.getBoundingClientRect().width), rows };
  });
  console.log('content width:', out.contentW);
  for (const c of out.chains) console.log(JSON.stringify(c, null, 1));
  await browser.close();
  execSync('taskkill /IM Obsidian.exe /F', { stdio: 'ignore' });
  await sleep(1500);
  spawn(OBSIDIAN_EXE, [VAULT], { detached: true, stdio: 'ignore' }).unref();
  process.exit(0);
} catch (e) { console.error('fatal', e.message); process.exit(1); }
