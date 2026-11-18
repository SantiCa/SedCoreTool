// Card M8.4.18a: how long reopening a saved tiled section takes in the desktop program, on the `rgb8g` fixture of card M8.4.13 (8,192 x 349,526 pixels,
// 10,928 mask tiles) with masks painted into a stated fraction of its tiles. Measures, from the start of the reopening: the project loaded (pyramid
// found, stored tiles listed and read back once for the reduced copy and the row counts), the interval table published, and the statistics of the objects
// computed again from the tiles. Writes a JSON record.
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
try {
  await page.waitForFunction(() => !!window.ichantool, { timeout: 60000 });
  await page.waitForFunction(async () => (await window.corantoolDesktop.engine.status()).state === 'ready', { timeout: 90000 });
  await page.evaluate(() => document.getElementById('openTest').click());
  await page.waitForFunction(() => window.ichantool.S.sections.length === 6, { timeout: 120000 });
  const added = Date.now();
  await (await page.$('#addImg')).uploadFile(fixture);
  await page.waitForSelector('#pcOk', { timeout: 60000 }); await page.click('#pcOk');
  await page.waitForFunction(() => window.ichantool.S.sections.length === 7, { timeout: 3600000, polling: 500 });
  await page.waitForFunction(() => document.getElementById('busy').hidden, { timeout: 3600000 });
  const addMs = Date.now() - added;
  // Masks: in a stated fraction of the tiles, 12 rectangles of objects and, in one tile of five, an excluded band; saved in batches so that the page
  // never holds more than one batch of unsent tiles.
  const painted = await page.evaluate(async (fill) => {
    const { S } = window.ichantool, s = S.sections.at(-1), tiles = s.maskTiles, TILE = 512;
    let state = 20261118; const rand = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    window.ichantool.selectSection(S.sections.length - 1); window.ichantool.settleDeadline(3600000);
    let count = 0, objects = 0;
    const chosen = [];
    for (let row = 0; row < tiles.rows; row++) for (let col = 0; col < tiles.cols; col++) if (rand() < fill) chosen.push([row, col]);
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
    return { tiles: count, objects, saved: window.ichantool.tiledSaved() };
  }, fill);
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
    return { loadedMs: Math.round(loadedMs), tableMs: Math.round(tableMs), statisticsMs: Math.round(performance.now() - started), bins, storedTiles: s.maskTiles.stored.size };
  });
  const record = {
    date: new Date().toISOString(), computer: `${os.type()} ${os.release()}, ${os.cpus()[0].model.trim()}, ${Math.round(os.totalmem() / 2 ** 30)} GiB`,
    fixture: path.basename(fixture), fill, addMs, painted: { tiles: painted.tiles, objects: painted.objects }, reopen,
    note: 'loadedMs: the project open (pyramid from the cache, tiles listed and read back once); tableMs: the interval table; statisticsMs: objects recomputed from tiles and pixels',
  };
  console.log(JSON.stringify(record, null, 2));
  if (out) fs.writeFileSync(out, JSON.stringify(record, null, 2) + '\n');
} finally {
  try { browser.disconnect(); } catch { /* ignore */ }
  child.kill();
  await new Promise((r) => setTimeout(r, 3000));
  fs.rmSync(profile, { recursive: true, force: true });
}
