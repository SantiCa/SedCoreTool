// Card M8.4.18a: how long reopening a saved tiled section takes in the desktop program, on the `rgb8g` fixture of card M8.4.13 (8,192 x 349,526 pixels,
// 10,928 mask tiles) with masks painted into a stated fraction of its tiles. Measures, from the start of the reopening: the project loaded (pyramid
// found, stored tiles listed and read back once for the reduced copy and the row counts), the interval table published, and the statistics of the objects
// computed again from the tiles. Writes a JSON record.
// Card M8.4.28 (field `deleteAtOnce`): one more object covers the corner of four tiles; the project is reopened a second time and that object is
// deleted as soon as the project is open, while the reopening's tiles still wait for their statistics: the time from the delete to the object gone.
//   node tools/measure_tiled_reopen.mjs --fixture C:/sedcore-large-fixtures/rgb8g.tif --fill 0.03 --out docs/validation/M8.4.18a-reopen-3pct.json
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const fixture = arg('--fixture', 'C:/sedcore-large-fixtures/rgb8g.tif'), fill = Number(arg('--fill', '0.03')), out = arg('--out', null);
const { default: puppeteer } = await import(process.env.PUPPETEER_MODULE || 'puppeteer-core');
const root = fileURLToPath(new URL('../', import.meta.url));
const electron = createRequire(path.join(root, 'desktop/package.json'))('electron');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sedcoretool-reopen-'));
const env = { ...process.env, SEDCORETOOL_TEST_PROFILE: profile, SEDCORETOOL_ENGINE_EXPERIMENT: '1', SEDCORETOOL_TILED_SECTIONS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [path.join(root, 'tests/e2e/desktop-bootstrap.cjs'), '--headless', '--no-sandbox', '--remote-debugging-port=0'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
const endpoint = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Electron startup timed out')), 60000);
  child.stderr.on('data', (bytes) => { log += bytes; const hit = log.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (hit) { clearTimeout(timer); resolve(hit[1]); } });
});
const browser = await puppeteer.connect({ browserWSEndpoint: endpoint, defaultViewport: null, protocolTimeout: 3600000 });
const page = await (await browser.waitForTarget((t) => t.url().startsWith('app://corantool/app/index.html'), { timeout: 60000 })).page();
page.setDefaultTimeout(3600000);
const step = (text) => console.error(`[${new Date().toISOString().slice(11, 19)}] ${text}`);
page.on('dialog', (dialog) => { step('dialog: ' + dialog.message()); void dialog.accept(); });
try {
  await page.waitForFunction(() => !!window.ichantool, { timeout: 60000 });
  await page.waitForFunction(async () => (await window.corantoolDesktop.engine.status()).state === 'ready', { timeout: 90000 });
  await page.evaluate(() => document.getElementById('openTest').click());
  await page.waitForFunction(() => window.ichantool.S.sections.length === 6, { timeout: 120000 });
  step('test project open; adding the fixture');
  const added = Date.now();
  await (await page.$('#addImg')).uploadFile(fixture);
  await page.waitForSelector('#pcOk', { timeout: 60000 }); await page.click('#pcOk');
  await page.waitForFunction(() => window.ichantool.S.sections.length === 7, { timeout: 3600000, polling: 500 });
  await page.waitForFunction(() => document.getElementById('busy').hidden, { timeout: 3600000 });
  const addMs = Date.now() - added;
  step('added; painting masks');
  // Masks: in a stated fraction of the tiles, 12 rectangles of objects and, in one tile of five, an excluded band; saved in batches so that the page
  // never holds more than one batch of unsent tiles.
  const painted = await page.evaluate(async (fill) => {
    const { S } = window.ichantool, s = S.sections.at(-1), tiles = s.maskTiles, TILE = 512;
    let state = 20261118; const rand = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    window.ichantool.selectSection(S.sections.length - 1); window.ichantool.settleDeadline(3600000);
    let count = 0, objects = 0;
    const chosen = [];
    for (let row = 0; row < tiles.rows; row++) for (let col = 0; col < tiles.cols; col++) if (rand() < fill) chosen.push([row, col]);
    // Card M8.4.28: an object of 120 x 120 pixels centred on the corner shared by four tiles in the middle of the section (those tiles hold only it).
    const r0 = Math.floor(tiles.rows / 2) - 1, c0 = Math.floor(tiles.cols / 2) - 1, spanId = s.nextId++;
    s.objects.set(spanId, { id: spanId, order: s.nextTraceOrder++, cls: S.classes[0].id, src: 'brush', nt: false, pred: null, conf: 0, area: 0, bbox: null, stats: null, feat: null });
    for (const [row, col] of [[r0, c0], [r0, c0 + 1], [r0 + 1, c0], [r0 + 1, c0 + 1]]) {
      const k = chosen.findIndex(([r, c]) => r === row && c === col);
      if (k >= 0) chosen.splice(k, 1);
      const labels = new Int32Array(TILE * TILE), x0 = (c0 + 1) * TILE - 60 - col * TILE, y0 = (r0 + 1) * TILE - 60 - row * TILE;
      for (let y = Math.max(0, y0); y < Math.min(TILE, y0 + 120); y++) labels.fill(spanId, y * TILE + Math.max(0, x0), y * TILE + Math.min(TILE, x0 + 120));
      window.ichantool.putMaskTile(row, col, labels, null);
    }
    objects++;
    for (let i = 0; i < chosen.length; i++) {
      const [row, col] = chosen[i], labels = new Int32Array(TILE * TILE);
      const h = Math.min(TILE, tiles.height - row * TILE), w = Math.min(TILE, tiles.width - col * TILE);
      for (let r = 0; r < 12; r++) {
        const id = s.nextId++; objects++;
        s.objects.set(id, { id, order: s.nextTraceOrder++, cls: S.classes[r % 3].id, src: 'brush', nt: false, pred: null, conf: 0, area: 0, bbox: null, stats: null, feat: null });
        const x0 = Math.floor(rand() * (w - 70)), y0 = Math.floor(rand() * (h - 70)), ww = 4 + Math.floor(rand() * 60), hh = 4 + Math.floor(rand() * 60);
        for (let y = y0; y < y0 + hh; y++) labels.fill(id, y * TILE + x0, y * TILE + x0 + ww);
      }
      let exclude = null;
      if (rand() < 0.2) { exclude = new Uint8Array(TILE * TILE); for (let y = 100; y < Math.min(h, 120); y++) exclude.fill(1, y * TILE, y * TILE + w); }
      window.ichantool.putMaskTile(row, col, labels, exclude);
      count++;
      if (count % 64 === 0 || i === chosen.length - 1) await window.ichantool.saveNow();
    }
    for (let k = 0; k < 72000 && !window.ichantool.tiledStatsIdle(); k++) await new Promise((r) => setTimeout(r, 50));
    await window.ichantool.saveNow();
    return { tiles: count + 4, objects, spanId, saved: window.ichantool.tiledSaved() };
  }, fill);
  step('painted; reopening');
  // Reopen from the library and time it.
  const reopen = await page.evaluate(async () => {
    const { getProject } = await import(new URL('js/storage.js', location.href).href);
    const project = await getProject(window.ichantool.S.id), started = performance.now();
    await window.ichantool.loadProject(project);
    const loadedMs = performance.now() - started;
    const s = window.ichantool.S.cores.flatMap((c) => c.sections).find((q) => q.tiled);
    window.ichantool.selectSection(window.ichantool.S.sections.indexOf(s));
    await window.ichantool.analyzeSections([s]);
    const tableMs = performance.now() - started, bins = s.bins.length;
    for (let k = 0; k < 72000 && !window.ichantool.tiledStatsIdle(); k++) await new Promise((r) => setTimeout(r, 50));
    const statisticsMs = performance.now() - started;
    // Card M8.4.28: the painted objects were saved before their statistics existed (`putMaskTile` does not compute them); saved again now,
    // as a user's project would be, so that the second reopening knows each object's box.
    for (let k = 0; k < 600 && !window.ichantool.masksSettled(); k++) await new Promise((r) => setTimeout(r, 50));
    await window.ichantool.saveNow();
    return { loadedMs: Math.round(loadedMs), tableMs: Math.round(tableMs), statisticsMs: Math.round(statisticsMs), bins, storedTiles: s.maskTiles.stored.size };
  });
  step('reopened; reopening again and deleting at once');
  // Card M8.4.28: reopened again, the object over four tiles is deleted at once.
  const deleteAtOnce = await page.evaluate(async (spanId) => {
    const { getProject } = await import(new URL('js/storage.js', location.href).href), { S } = window.ichantool;
    const started = performance.now();
    await window.ichantool.loadProject(await getProject(S.id));
    const openedMs = performance.now() - started, s = S.cores.flatMap((c) => c.sections).find((q) => q.tiled);
    window.ichantool.selectSection(S.sections.indexOf(s));
    const waiting = s._statsRunner.pending.size, toastBefore = document.getElementById('toast').textContent, asked = performance.now();
    window.ichantool.deleteObjects([spanId]);
    for (let k = 0; k < 30000 && s.objects.has(spanId); k++) await new Promise((r) => setTimeout(r, 10));
    const deleteMs = performance.now() - asked, toast = document.getElementById('toast').textContent, o = s.objects.get(spanId);
    const box = o?.sbox, missing = box ? [0, 1].flatMap((dr) => [0, 1].map((dc) => s.maskTiles.state(Math.floor(box[1] / 512) + dr, Math.floor(box[0] / 512) + dc))) : null;
    return { openedMs: Math.round(openedMs), deleteMs: Math.round(deleteMs), deleted: !s.objects.has(spanId), tilesWaitingAtDelete: waiting,
      tilesWaitingAfter: s._statsRunner.pending.size, refused: toast !== toastBefore && toast === window.ichantool.t('tiles.busy'),
      diagnosis: o ? { toast, sbox: box ?? null, savedBox: !!o.stats, failed: s._statsRunner.failed.size, tileStates: missing, busyShown: !document.getElementById('busy').hidden } : null };
  }, painted.spanId);
  const record = {
    date: new Date().toISOString(), computer: `${os.type()} ${os.release()}, ${os.cpus()[0].model.trim()}, ${Math.round(os.totalmem() / 2 ** 30)} GiB`,
    fixture: path.basename(fixture), fill, addMs, painted: { tiles: painted.tiles, objects: painted.objects }, reopen, deleteAtOnce,
    note: 'loadedMs: the project open (pyramid from the cache, tiles listed and read back once); tableMs: the interval table; statisticsMs: objects recomputed from tiles and pixels; deleteAtOnce: a second reopening, then the object over four tiles deleted at once (deleteMs: from the delete to the object gone, target under 2 s; refused: "try again" shown)',
  };
  console.log(JSON.stringify(record, null, 2));
  if (out) fs.writeFileSync(out, JSON.stringify(record, null, 2) + '\n');
} finally {
  try { browser.disconnect(); } catch { /* ignore */ }
  child.kill();
  await new Promise((r) => setTimeout(r, 3000));
  fs.rmSync(profile, { recursive: true, force: true });
}
