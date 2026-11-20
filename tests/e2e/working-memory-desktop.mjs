// Card H6, desktop check with a multi-gigabyte image (Windows, not part of CI: it needs the generated fixtures of card M8.4.13).
//
//   node tests/e2e/working-memory-desktop.mjs C:/sedcore-large-fixtures/rgb2g.tif
//
// Before H6, adding this 8,192 x 87,382 image with "No reduction", or choosing "Full" for its section, made the window go blank (out of
// memory). Now: the image is added at the smallest factor that fits the page's memory limit with a message; full resolution is disabled in
// the section form and refused if requested anyway; the window keeps working, and the largest allowed resolution really loads.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { requireFresh } from './preflight.mjs';

const { default: puppeteer } = await import(process.env.PUPPETEER_MODULE || 'puppeteer-core');
const root = fileURLToPath(new URL('../../', import.meta.url));
requireFresh(root);                                   // card M8.4.23: an old program copy or engine runtime stops the test here
const electron = createRequire(path.join(root, 'desktop/package.json'))('electron');
const file = process.argv[2];
assert.ok(file && fs.existsSync(file), 'give the path of a large TIFF (tools/make_large_fixtures.py)');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sedcoretool-h6-'));
const env = { ...process.env, SEDCORETOOL_TEST_PROFILE: profile };
delete env.ELECTRON_RUN_AS_NODE; delete env.SEDCORETOOL_ENGINE_EXPERIMENT;
const child = spawn(electron, [path.join(root, 'tests/e2e/desktop-bootstrap.cjs'), '--headless', '--no-sandbox', '--remote-debugging-port=0'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
const exited = new Promise((resolve) => child.once('exit', resolve));
let log = '', crashed = false;
const endpoint = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Electron startup timed out')), 60000);
  child.stderr.on('data', (bytes) => { log += bytes; const hit = log.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (hit) { clearTimeout(timer); resolve(hit[1]); } });
});
const browser = await puppeteer.connect({ browserWSEndpoint: endpoint, defaultViewport: null });
try {
  const target = await browser.waitForTarget((t) => t.url().startsWith('app://corantool/app/index.html'), { timeout: 60000 });
  const page = await target.page();
  page.setDefaultTimeout(600000);
  page.on('error', () => { crashed = true; });                      // the renderer process died (the blank window)
  page.on('dialog', (dialog) => dialog.accept().catch(() => {}));
  await page.waitForFunction(() => !!window.ichantool, { timeout: 60000 });
  await page.evaluate(() => document.getElementById('openTest').click());
  await page.waitForFunction(() => window.ichantool.S.sections.length === 6, { timeout: 120000 });
  await page.evaluate(() => { window.ichantool.S.settings.maxMP = 1000; });   // "No reduction (if it fits in memory)"
  const toasts = [];
  await page.exposeFunction('h6Toast', (text) => toasts.push(text));
  await page.evaluate(() => new MutationObserver(() => { const el = document.getElementById('toast'); if (el && !el.hidden) window.h6Toast(el.textContent); })
    .observe(document.getElementById('toast'), { attributes: true, childList: true, subtree: true, characterData: true }));
  await (await page.$('#addImg')).uploadFile(file);
  await page.waitForSelector('#pcOk', { timeout: 30000 });
  await page.click('#pcOk');
  await page.waitForFunction(() => window.ichantool.S.sections.length === 7, { timeout: 600000, polling: 500 });
  const added = await page.evaluate(() => { const s = window.ichantool.S.sections.at(-1); return { ds: s.ds, w: s.w, h: s.h, full: s.full }; });
  await page.waitForFunction(() => !document.getElementById('busy') || document.getElementById('busy').hidden !== false, { timeout: 60000 }).catch(() => {});
  await sleep(1000);
  const options = await page.evaluate(() => [...document.getElementById('secRes').options].map((o) => ({ k: +o.value, disabled: o.disabled, text: o.textContent })));
  // Ask for full resolution anyway (as if the disabled option had been chosen).
  await page.evaluate(() => { const el = document.getElementById('secRes'); el.value = '1'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await sleep(3000);
  const afterRefusal = await page.evaluate(() => window.ichantool.S.sections.at(-1).ds);
  const alive = await page.evaluate(() => 1 + 1).catch(() => 0);
  const report = { file: path.basename(file), added, options, afterRefusal, toasts: toasts.slice(-3), crashed, alive: alive === 2 };
  console.log(JSON.stringify(report, null, 1));
  assert.equal(crashed, false, 'the renderer died');
  assert.ok(added.ds > 1 && added.ds === Math.min(...options.filter((o) => !o.disabled).map((o) => o.k)), 'added at the smallest factor that fits');
  assert.ok(options.find((o) => o.k === 1)?.disabled, 'full resolution is disabled');
  assert.equal(afterRefusal, added.ds, 'full resolution was refused');
  assert.ok(toasts.some((text) => /1\/\d/.test(text)) && toasts.some((text) => /GB/.test(text)), 'both messages were shown');
  console.log('H6 desktop check passed');
} finally {
  try { browser.disconnect(); } catch { /* ignore */ }
  if (child.exitCode === null) child.kill();
  await exited;
  fs.rmSync(profile, { recursive: true, force: true });
}
