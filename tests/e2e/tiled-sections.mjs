// Card M8.4.15: tiled sections in the desktop program (SEDCORETOOL_TILED_SECTIONS=1 with the engine experiment).
//
//   node tests/e2e/tiled-sections.mjs [IMAGE]
//
// IMAGE defaults to the public example examples/data/idealized_core_0-500cm.jpg (620 x 16,726 = 10.4 MP, above the default maximum of 8 MP), so the
// test needs no generated fixture. Checks: the image is added through the interface as a tiled section (pyramid built with progress, a working
// image from one pyramid level within the size limit), the section is not saved yet and the project's other sections are, the working image is
// read again from the pyramid after it was released, and tools that would decode the source refuse visibly. With the flag off, the same image
// takes today's path.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { default: puppeteer } = await import(process.env.PUPPETEER_MODULE || 'puppeteer-core');
const root = fileURLToPath(new URL('../../', import.meta.url));
const electron = createRequire(path.join(root, 'desktop/package.json'))('electron');
const image = process.argv[2] || path.join(root, 'examples/data/idealized_core_0-500cm.jpg');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function program(tiled) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sedcoretool-tiled-'));
  const env = { ...process.env, SEDCORETOOL_TEST_PROFILE: profile, SEDCORETOOL_ENGINE_EXPERIMENT: '1' };
  if (tiled) env.SEDCORETOOL_TILED_SECTIONS = '1'; else delete env.SEDCORETOOL_TILED_SECTIONS;
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [path.join(root, 'tests/e2e/desktop-bootstrap.cjs'), '--headless', '--no-sandbox', '--remote-debugging-port=0'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  let log = '';
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Electron startup timed out: ' + log.slice(-500))), 60000);
    child.stderr.on('data', (bytes) => { log += bytes; const hit = log.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (hit) { clearTimeout(timer); resolve(hit[1]); } });
  });
  const browser = await puppeteer.connect({ browserWSEndpoint: endpoint, defaultViewport: null, protocolTimeout: 600000 });
  const page = await (await browser.waitForTarget((t) => t.url().startsWith('app://corantool/app/index.html'), { timeout: 60000 })).page();
  page.setDefaultTimeout(600000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept().catch(() => {}));
  await page.waitForFunction(() => !!window.ichantool, { timeout: 60000 });
  await page.waitForFunction(async () => (await window.corantoolDesktop.engine.status()).state === 'ready', { timeout: 90000 });
  return { page, errors, async close() {
    try { browser.disconnect(); } catch { /* ignore */ }
    if (child.exitCode === null) child.kill();
    await Promise.race([exited, sleep(15000)]);
    fs.rmSync(profile, { recursive: true, force: true });
  } };
}

async function addImage(page) {
  await page.evaluate(() => document.getElementById('openTest').click());
  await page.waitForFunction(() => window.ichantool.S.sections.length === 6, { timeout: 120000 });
  await (await page.$('#addImg')).uploadFile(image);
  await page.waitForSelector('#pcOk', { timeout: 30000 });
  await page.click('#pcOk');
  await page.waitForFunction(() => window.ichantool.S.sections.length === 7, { timeout: 600000, polling: 200 });
  await page.waitForFunction(() => document.getElementById('busy').hidden, { timeout: 600000 });
}

const on = await program(true);
try {
  assert.equal(await on.page.evaluate(() => window.corantoolDesktop.tiles.enabled), true);
  const toasts = [];
  await on.page.exposeFunction('tiledToast', (text) => toasts.push(text));
  await on.page.evaluate(() => new MutationObserver(() => { const el = document.getElementById('toast'); if (el && !el.hidden) window.tiledToast(el.textContent); })
    .observe(document.getElementById('toast'), { attributes: true, childList: true, subtree: true, characterData: true }));
  await addImage(on.page);
  const section = await on.page.evaluate(() => {
    const { S } = window.ichantool, s = S.sections.at(-1);
    return { tiled: s.tiled && { level: s.tiled.level, levels: s.tiled.levels.length, pyramid: s.tiled.pyramid.length }, w: s.w, h: s.h, ds: s.ds, full: s.full,
      orig: s.orig?.length, maxMP: S.settings.maxMP, bins: s.bins.length };
  });
  assert.ok(section.tiled, 'the image became a tiled section');
  assert.equal(section.tiled.pyramid, 64);
  assert.equal(section.ds, 2 ** section.tiled.level);
  assert.ok(section.w * section.h <= section.maxMP * 1e6, 'the working image is within the size limit');
  assert.equal(section.orig, section.w * section.h * 4);
  if (!process.argv[2]) assert.deepEqual(section.full, { w: 620, h: 16726 });
  assert.ok(section.full.w * section.full.h > section.maxMP * 1e6, 'only images above the size limit are tiled');
  assert.equal(section.bins, 0, 'no interval table from empty masks');
  assert.ok(toasts.some((text) => text.includes(String(section.full.h))), 'the user is told what a tiled section is: ' + JSON.stringify(toasts));
  const saved = await on.page.evaluate(() => {
    const project = window.ichantool.serialize();
    return project.cores.flatMap((core) => core.sections.map((q) => q.name));
  });
  assert.equal(saved.length, 6, 'the tiled section is not saved; the six others are');
  // Release the working image and ask for it again: it comes back from the pyramid, never from the source file.
  const reloaded = await on.page.evaluate(async () => {
    const { S } = window.ichantool, s = S.sections.at(-1), before = s.orig.slice(0, 4000);
    s.orig = null; s.enh = null;
    window.ichantool.needPixels?.(s);
    for (let i = 0; i < 200 && !s.orig; i++) await new Promise((r) => setTimeout(r, 50));
    return s.orig ? [...s.orig.slice(0, 4000)].every((v, i) => v === before[i]) : null;
  });
  assert.equal(reloaded, true, 'the working image is read again from the pyramid');
  // Zoomed to one screen pixel per source pixel, the viewer draws level-0 tiles: screen pixels equal the source's pixels at the same place.
  await on.page.setViewport({ width: 1600, height: 1000 });
  await on.page.evaluate(() => new Promise((r) => setTimeout(r, 300)));
  const drawn = await on.page.evaluate(async () => {
    const { S } = window.ichantool, s = S.sections.at(-1), canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('view'));
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    // Working pixel (vx, vy) at the top left, integer, so source pixel (vx * ds + sx, vy * ds + sy) is at screen (sx, sy).
    const vx = Math.floor(s.w / 2 - canvas.width / s.ds / 2), vy = Math.floor(s.h / 3);
    S.view = { x: vx, y: vy, zoom: s.ds };
    window.ichantool.requestRender(); await frame();
    for (let i = 0; i < 400 && !window.ichantool.tilesIdle(); i++) await new Promise((r) => setTimeout(r, 25));
    window.ichantool.requestRender(); await frame();
    // Probes: source pixels that differ from the working image at the same place, so only a drawn level-0 tile can show them.
    const ctx = canvas.getContext('2d'), probes = [], left = 160;   // left of this: the strip and the ruler
    const X0 = vx * s.ds + left, Y0 = vy * s.ds, X1 = Math.min(s.full.w, s.roi.x1 * s.ds, vx * s.ds + canvas.width), Y1 = Math.min(s.full.h, vy * s.ds + canvas.height);
    const row = Math.floor((Y0 + Y1) / 2 / 512), tiles = {};
    for (let col = Math.floor(X0 / 512); col * 512 < X1; col++) {
      const read = await window.corantoolDesktop.tiles.read(s.tiled.pyramid, 0, [[row, col]]);
      tiles[col] = new Uint8Array(read.ok.bytes.buffer || read.ok.bytes, read.ok.bytes.byteOffset || 0, read.ok.bytes.byteLength);
    }
    const sourceAt = (X, Y) => { const at = ((Y % 512) * 512 + (X % 512)) * s.tiled.channels, b = tiles[Math.floor(X / 512)]; return s.tiled.channels === 1 ? [b[at], b[at], b[at]] : [...b.subarray(at, at + 3)]; };
    let differing = 0;
    for (let Y = Math.max(Y0, row * 512); Y < Math.min(Y1, row * 512 + 512) && probes.length < 40; Y += 3) {
      for (let X = X0; X < X1 && probes.length < 40; X += 7) {
        const source = sourceAt(X, Y), w = ((Y >> s.tiled.level) * s.w + (X >> s.tiled.level)) * 4, working = [...s.orig.subarray(w, w + 3)];
        if (source.every((v, i) => v === working[i])) continue;
        differing++;
        const sx = X - vx * s.ds, sy = Y - vy * s.ds;
        probes.push({ sx, sy, screen: [...ctx.getImageData(sx, sy, 1, 1).data.subarray(0, 3)], source, working });
      }
    }
    return { probes, level: s.tiled.level, canvas: [canvas.width, canvas.height], view: S.view, roi: s.roi, w: s.w };
  });
  assert.ok(drawn.probes.length >= 10, 'probes where full resolution differs from the working image: ' + JSON.stringify(drawn));
  for (const probe of drawn.probes) assert.deepEqual(probe.screen, probe.source, 'drawn pixel = source pixel at ' + JSON.stringify(probe));
  // A tool that decodes the source refuses with a message instead of reading gigabytes.
  const refused = await on.page.evaluate(async () => {
    const { S } = window.ichantool, s = S.sections.at(-1);
    const select = document.getElementById('secRes'); select.value = String(Math.max(1, s.ds / 2)); select.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 1500));
    return s.ds;
  });
  assert.equal(refused, section.ds, 'changing the resolution of a tiled section is refused');
  assert.deepEqual(on.errors, []);
  console.log('Tiled sections: added through the interface, working image from the pyramid, not saved, reloaded, tools refused; full-resolution tiles drawn (' + drawn.probes.length + ' probes):', JSON.stringify(section));
} finally { await on.close(); }

const off = await program(false);
try {
  assert.equal(await off.page.evaluate(() => window.corantoolDesktop.tiles.enabled), false);
  await addImage(off.page);
  const section = await off.page.evaluate(() => { const s = window.ichantool.S.sections.at(-1); return { tiled: !!s.tiled, ds: s.ds }; });
  assert.deepEqual(section.tiled, false, 'with the flag off the image takes today\'s path');
  assert.deepEqual(off.errors, []);
  console.log('Flag off: today\'s path (factor', section.ds + ')');
} finally { await off.close(); }
