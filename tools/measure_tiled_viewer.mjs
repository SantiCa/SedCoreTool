// Card M8.4.15, step 7: the viewer of tiled sections against the targets of contract §7. Windows measurement with the real desktop program.
//
//   node tools/measure_tiled_viewer.mjs C:/sedcore-large-fixtures/rgb8g.tif --out docs/validation/M8.4.15-viewer-rgb8g-windows.json
//   node tools/measure_tiled_viewer.mjs --small examples/data/idealized_core_0-500cm.jpg --out docs/validation/M8.4.15-small-windows.json
//
// Large file: run 1 (fresh program, persistent profile) adds the file and builds its pyramid; run 2 (fresh program, same profile, so the
// pyramid is cached) is measured:
//   first useful view   from the click on "Add here" to the first drawn frame of the section (targets: <= 2 s)
//   cached pan and zoom 120 frames of a scripted pan and zoom at 1 : 1 and up to 2.5 : 1 over tiles already loaded; cost of one frame =
//                       time from the start of the animation frame to the end of the page's render (targets: median <= 17 ms, p95 <= 33 ms)
//   uncached jumps      20 jumps to random rows at 1 : 1; cost of the first frame after the jump, whether that frame shows image (never
//                       blank), and the time until the scheduler has nothing left to fetch (visible tiles and the ring of one tile around
//                       them, so it overstates the time of the visible ones) (target: <= 250 ms p95)
//   memory              working set summed over the program's whole process tree (Electron and the engine), sampled every 250 ms
//                       (target: peak <= 2 GiB). Working sets count shared pages in each process, so the sum is an upper bound.
//   pan and zoom with masks (card M8.4.16 step 2): the same 120 frames after putting dense full-resolution masks in the page around the path
//                       (6 x 5 level-0 tiles: objects in 200-pixel blocks over 60 % of the area, 8 objects, and a band of exclusion every
//                       1,000 rows), so the masks are painted over the pixel tiles in every frame (same targets as cached pan and zoom).
// --small: the same scripted pan and zoom, in working-image coordinates, on a section that is small enough for today's path, shown tiled
// (flag on) and not tiled (flag off), to compare frame costs (evidence for rule 6 of the card). The disk cache is warm in every run.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { default: puppeteer } = await import(process.env.PUPPETEER_MODULE || 'puppeteer-core');
const root = fileURLToPath(new URL('../', import.meta.url));
const electron = createRequire(path.join(root, 'desktop/package.json'))('electron');
const args = process.argv.slice(2), small = args.includes('--small');
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const file = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--out'))[0];
assert.ok(file && fs.existsSync(file), 'give an image file');
const OUT = option('out', null), PROFILE = option('profile', 'C:/sedcore-pyramids/viewer-profile');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Sum of the working sets of a process and all its descendants, every 250 ms, until stopped. */
function sampleTree(pid) {
  const script = `$root=${pid}; while ($true) { $all = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize; $ids = @($root); $grew = $true;
    while ($grew) { $grew = $false; foreach ($p in $all) { if (($ids -contains $p.ParentProcessId) -and -not ($ids -contains $p.ProcessId)) { $ids += $p.ProcessId; $grew = $true } } }
    $sum = 0; foreach ($p in $all) { if ($ids -contains $p.ProcessId) { $sum += $p.WorkingSetSize } }; [math]::Round($sum / 1MB); Start-Sleep -Milliseconds 250 }`;
  const child = spawn('powershell', ['-NoProfile', '-Command', script], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  const values = [];
  child.stdout.on('data', (bytes) => { for (const line of bytes.toString().split(/\r?\n/)) if (line.trim()) values.push(+line); });
  return { stop() { child.kill(); return values.length ? { samples: values.length, peakMiB: Math.max(...values) } : null; } };
}

async function program({ tiled, profile }) {
  fs.mkdirSync(profile, { recursive: true });
  const env = { ...process.env, SEDCORETOOL_TEST_PROFILE: profile, SEDCORETOOL_ENGINE_EXPERIMENT: '1' };
  if (tiled) env.SEDCORETOOL_TILED_SECTIONS = '1'; else delete env.SEDCORETOOL_TILED_SECTIONS;
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [path.join(root, 'tests/e2e/desktop-bootstrap.cjs'), '--headless', '--no-sandbox', '--remote-debugging-port=0'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  const memory = sampleTree(child.pid);
  let log = '';
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Electron startup timed out: ' + log.slice(-500))), 60000);
    child.stderr.on('data', (bytes) => { log += bytes; const hit = log.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (hit) { clearTimeout(timer); resolve(hit[1]); } });
  });
  const browser = await puppeteer.connect({ browserWSEndpoint: endpoint, defaultViewport: null, protocolTimeout: 1800000 });
  const page = await (await browser.waitForTarget((t) => t.url().startsWith('app://corantool/app/index.html'), { timeout: 60000 })).page();
  page.setDefaultTimeout(1800000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  if (process.env.PHASES) page.on('console', (m) => { if (m.text().startsWith('PHASE')) console.log(m.text()); });
  page.on('dialog', (dialog) => dialog.accept().catch(() => {}));
  await page.setViewport({ width: 1440, height: 900 });
  await page.waitForFunction(() => !!window.ichantool && !document.getElementById('home').hidden, { timeout: 60000 });
  await page.waitForFunction(async () => (await window.corantoolDesktop.engine.status()).state === 'ready', { timeout: 90000 });
  return { page, errors, memory, async close() {
    const peak = memory.stop();
    try { browser.disconnect(); } catch { /* ignore */ }
    if (child.exitCode === null) child.kill();
    await Promise.race([exited, sleep(15000)]);
    return peak;
  } };
}

/** Creates the project once, then adds the file; returns the time from the click on "Add here" to the first frame of the section. */
async function addFile(page, { projectExists }) {
  if (!projectExists) {
    await page.click('#newProjOpen'); await page.type('#newProjName', 'Viewer measurement'); await page.click('#newProjBtn');
    await page.waitForFunction(() => window.ichantool.S.id, { timeout: 60000 });
  } else {
    await page.evaluate(async () => { const storage = await import('/app/js/storage.js'), metas = await storage.listProjects(); const meta = metas.find((m) => m.name === 'Viewer measurement'); await window.ichantool.loadProject(await storage.getProject(meta.id)); });
    await page.waitForFunction(() => document.getElementById('busy').hidden, { timeout: 60000 });
  }
  await page.evaluate(() => { window.ichantool.S.settings.maxMP = 8; });
  const n = await page.evaluate(() => window.ichantool.S.sections.length);
  await (await page.$('#addImg')).uploadFile(file);
  await page.waitForSelector('#pcOk', { visible: true, timeout: 30000 });
  await page.evaluate(() => { document.getElementById('pcOk').addEventListener('click', () => { window.__t0 = performance.now(); }, { capture: true }); });
  await page.click('#pcOk');
  await page.waitForFunction((n) => window.ichantool.S.sections.length === n + 1 && window.ichantool.S.sections[n].orig && document.getElementById('busy').hidden, { timeout: 1800000, polling: 50 }, n);
  return page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return Math.round(performance.now() - window.__t0);
  });
}

/** In the page: the scripted pan and zoom, and the jumps. Costs are in ms. */
const inPage = {
  panZoom: async function ({ frames, base }) {
    const { S } = window.ichantool, s = S.sections.at(-1), canvas = document.getElementById('view');
    const ds = s.ds, cw = canvas.width, ch = canvas.height, frame = () => new Promise((r) => requestAnimationFrame(r));
    // centre of the animation in working pixels; base = working-image zoom at the start (screen pixels per working pixel)
    const cx = s.w / 2, cy = s.h / 2, costs = [], intervals = [];
    const place = (i) => {
      const zoom = base * (1 + 0.75 * (1 + Math.sin(i / 17))), dx = (150 / ds) * Math.sin(i / 10), dy = (150 / ds) * Math.sin(i / 13);
      S.view = { zoom, x: cx + dx - cw / 2 / zoom, y: cy + dy - ch / 2 / zoom };
    };
    for (let i = 0; i < 40; i++) { place(i * 3); window.ichantool.requestRender(); await frame(); }      // visit the whole path first: tiles load
    for (let i = 0; i < 200 && window.ichantool.tilesIdle && !window.ichantool.tilesIdle(); i++) await new Promise((r) => setTimeout(r, 25));
    await new Promise((r) => setTimeout(r, 300));
    let last = null;
    for (let i = 0; i < frames; i++) {
      place(i);
      await new Promise((resolve) => {
        window.ichantool.requestRender();
        requestAnimationFrame((ts) => { costs.push(performance.now() - ts); if (last !== null) intervals.push(ts - last); last = ts; resolve(); });
      });
    }
    return { costs, intervals };
  },
  jumps: async function ({ count, seed }) {
    const { S } = window.ichantool, s = S.sections.at(-1), canvas = document.getElementById('view'), ds = s.ds;
    const cw = canvas.width, ch = canvas.height, ctx = canvas.getContext('2d'), frame = () => new Promise((r) => requestAnimationFrame(r));
    let state = seed; const random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32; };
    const results = [];
    for (let i = 0; i < count; i++) {
      const row = (0.05 + 0.9 * random()) * s.h, zoom = ds;           // 1 screen pixel per source pixel
      S.view = { zoom, x: s.w / 2 - cw / 2 / zoom, y: row - ch / 2 / zoom };
      const started = performance.now();
      const cost = await new Promise((resolve) => { window.ichantool.requestRender(); requestAnimationFrame((ts) => resolve(performance.now() - ts)); });
      // the first frame after the jump must show an image, never the empty background
      let image = 0, total = 0;
      for (let k = 0; k < 60; k++) { const px = ctx.getImageData(120 + Math.floor(random() * (cw - 160)), Math.floor(random() * ch), 1, 1).data; total++; if (!(px[0] === 22 && px[1] === 26 && px[2] === 25)) image++; }
      let idleAt = null;
      for (let k = 0; k < 400; k++) { await frame(); if (window.ichantool.tilesIdle()) { idleAt = performance.now() - started; break; } }
      results.push({ firstFrameMs: cost, imageShare: image / total, completeMs: idleAt });
      await new Promise((r) => setTimeout(r, 60));
    }
    return results;
  },
  /** Dense masks around the centre of the pan-and-zoom path (card M8.4.16 step 2). */
  putMasks: async function () {
    const { S } = window.ichantool, s = S.sections.at(-1), TILE = 512, objects = 8;
    for (let n = 0; n < objects; n++) {
      const id = s.nextId++;
      s.objects.set(id, { id, order: s.nextTraceOrder++, cls: S.classes[n % S.classes.length].id, pred: null, conf: 0, src: 'measure', area: 0, bbox: null, stats: null, feat: null });
    }
    s.lutFill = null;
    const first = s.nextId - objects, cx = s.w / 2 * s.ds, cy = s.h / 2 * s.ds;
    const row0 = Math.max(0, Math.floor(cy / TILE) - 2), col0 = Math.max(0, Math.floor(cx / TILE) - 3);
    let tiles = 0;
    for (let row = row0; row < Math.min(s.maskTiles.rows, row0 + 5); row++) {
      for (let col = col0; col < Math.min(s.maskTiles.cols, col0 + 6); col++) {
        const labels = new Int32Array(TILE * TILE), exclude = new Uint8Array(TILE * TILE);
        for (let y = 0; y < TILE; y++) {
          const Y = row * TILE + y, by = Math.floor(Y / 200);
          for (let x = 0; x < TILE; x++) {
            const X = col * TILE + x, bx = Math.floor(X / 200);
            if (X >= s.maskTiles.width || Y >= s.maskTiles.height) continue;
            if ((bx + by) % 5 < 3) labels[y * TILE + x] = first + (bx * 3 + by) % objects;
            if (Y % 1000 < 100) exclude[y * TILE + x] = 1;
          }
        }
        window.ichantool.putMaskTile(row, col, labels, exclude); tiles++;
      }
    }
    return tiles;
  },
};

const percentile = (values, p) => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : null; };
const round = (v) => v == null ? null : Math.round(v * 100) / 100;
const summary = (values) => ({ n: values.length, median: round(percentile(values, 0.5)), p95: round(percentile(values, 0.95)), max: round(Math.max(...values)) });

async function measure(page, { frames, base }) {
  const pan = await page.evaluate(inPage.panZoom, { frames, base });
  return { frameCost: summary(pan.costs), frameInterval: summary(pan.intervals) };
}

const result = { file: path.basename(file), date: new Date().toISOString(), computer: 'Windows 11, AMD Ryzen 7 7700X, 31 GiB (maintainer\'s computer)', viewport: '1440 x 900' };
if (small) {
  for (const tiled of [false, true]) {
    const profile = path.join(PROFILE, tiled ? 'small-tiled' : 'small-today');
    fs.rmSync(profile, { recursive: true, force: true });
    const run = await program({ tiled, profile });
    try {
      const first = await addFile(run.page, { projectExists: false });
      const info = await run.page.evaluate(() => { const s = window.ichantool.S.sections.at(-1); return { tiled: !!s.tiled, ds: s.ds, w: s.w, h: s.h, full: s.full }; });
      // working zoom from 2 to 5 screen pixels per working pixel: 1 to 2.5 source pixels per screen pixel... in source terms zoom / ds
      const m = await measure(run.page, { frames: 120, base: 2 });
      result[tiled ? 'tiled' : 'today'] = { ...info, firstUsefulViewMs: first, ...m };
      assert.deepEqual(run.errors, []);
    } finally { result[tiled ? 'tiledMemory' : 'todayMemory'] = await run.close(); fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); }
  }
} else {
  // Run 1: build the pyramid (not a target; recorded).
  const buildStart = Date.now();
  let run = await program({ tiled: true, profile: PROFILE });
  try { await addFile(run.page, { projectExists: false }); result.firstRunSeconds = round((Date.now() - buildStart) / 1000); }
  finally { await run.close(); }
  // Run 2: a fresh program, pyramid cached.
  run = await program({ tiled: true, profile: PROFILE });
  try {
    const first = await addFile(run.page, { projectExists: true });
    const info = await run.page.evaluate(() => { const s = window.ichantool.S.sections.at(-1); return { tiled: !!s.tiled, ds: s.ds, level: s.tiled?.level, w: s.w, h: s.h, full: s.full, bits: s.tiled?.bits, channels: s.tiled?.channels }; });
    assert.equal(info.tiled, true);
    result.section = info; result.firstUsefulViewMs = first;
    const m = await measure(run.page, { frames: 120, base: info.ds });
    result.cachedPanZoom = m;
    const jumps = await run.page.evaluate(inPage.jumps, { count: 20, seed: 138501 });
    result.jumps = { firstFrameMs: summary(jumps.map((j) => j.firstFrameMs)), completeMs: summary(jumps.map((j) => j.completeMs ?? 1e9)), minImageShare: Math.min(...jumps.map((j) => j.imageShare)), incomplete: jumps.filter((j) => j.completeMs == null).length };
    result.maskTiles = await run.page.evaluate(inPage.putMasks);
    result.maskedPanZoom = await measure(run.page, { frames: 120, base: info.ds });
    assert.deepEqual(run.errors, []);
  } finally { result.memory = await run.close(); }
  result.targets = {
    firstUsefulViewMs: { target: 2000, value: result.firstUsefulViewMs, ok: result.firstUsefulViewMs <= 2000 },
    cachedFrameMedianMs: { target: 17, value: result.cachedPanZoom.frameCost.median, ok: result.cachedPanZoom.frameCost.median <= 17 },
    cachedFrameP95Ms: { target: 33, value: result.cachedPanZoom.frameCost.p95, ok: result.cachedPanZoom.frameCost.p95 <= 33 },
    maskedFrameMedianMs: { target: 17, value: result.maskedPanZoom.frameCost.median, ok: result.maskedPanZoom.frameCost.median <= 17 },
    maskedFrameP95Ms: { target: 33, value: result.maskedPanZoom.frameCost.p95, ok: result.maskedPanZoom.frameCost.p95 <= 33 },
    jumpFirstFrameShowsImage: { target: 1, value: result.jumps.minImageShare, ok: result.jumps.minImageShare >= 0.95 },
    jumpCompleteP95Ms: { target: 250, value: result.jumps.completeMs.p95, ok: result.jumps.completeMs.p95 <= 250 },
    processTreePeakMiB: { target: 2048, value: result.memory?.peakMiB ?? null, ok: (result.memory?.peakMiB ?? Infinity) <= 2048 },
  };
}
console.log(JSON.stringify(result, null, 2));
if (OUT) fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
