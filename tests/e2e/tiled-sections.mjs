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
import { execFileSync, spawn } from 'node:child_process';
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
  return { page, errors, pid: child.pid, async close() {
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
  // Navigation strip, ruler and readouts (step 5). The strip is drawn from the working image; the readout gives the source pixel and the depth of
  // the source row. Tolerance of the depth: one working row, because the working image has ceil(full height / ds) rows and the depth is
  // linear over them (3 decimals are shown).
  const nav = await on.page.evaluate(async () => {
    const { S } = window.ichantool, s = S.sections.at(-1), canvas = document.getElementById('view');
    S.view = { x: 0, y: Math.floor(s.h / 3), zoom: 1 };
    window.ichantool.requestRender(); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const box = canvas.getBoundingClientRect(), sx = 300, sy = 211;
    canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: box.left + sx, clientY: box.top + sy, bubbles: true, pointerId: 1 }));
    await new Promise((r) => setTimeout(r, 100));
    const strip = canvas.getContext('2d').getImageData(6, 14, 8, canvas.height - 40).data, colours = new Set();
    for (let i = 0; i < strip.length; i += 4 * 7) colours.add(strip[i] + ',' + strip[i + 1] + ',' + strip[i + 2]);
    return { px: document.getElementById('stPx').textContent, depth: document.getElementById('stDepth').textContent, stripColours: colours.size,
      row: (S.view.y + sy / S.view.zoom), ds: s.ds, h: s.h, full: s.full, top: s.top, bottom: s.bottom, y0: s.roi.y0, y1: s.roi.y1, x: S.view.x + sx / S.view.zoom };
  });
  const sourceRow = Math.floor(nav.row * nav.ds), sourceX = Math.floor(nav.x * nav.ds);
  assert.equal(nav.px, `x ${sourceX} · y ${sourceRow}`, 'the readout gives the source pixel: ' + JSON.stringify(nav));
  const readDepth = parseFloat(nav.depth.replace(/^[^0-9-]*/, '')), expected = nav.top + (sourceRow / nav.full.h) * (nav.bottom - nav.top);
  assert.ok(Math.abs(readDepth - expected) <= (nav.bottom - nav.top) / nav.h + 0.0006, `depth of the source row ${sourceRow}: read ${readDepth}, expected ${expected}`);
  assert.ok(nav.stripColours >= 2, 'the navigation strip shows the section image: ' + nav.stripColours + ' colours');
  // Step 6 of M8.4.15, updated by M8.4.16 step 3: every tool of the Section mode on a tiled section. Wand, lasso, scissors, detection, crop,
  // rotation, resolution and filters refuse with the one message; select, pan, mark, the analysis area and the strokes (brush, erase, exclude,
  // include) work. A blocked tool selected on another section does not follow into a tiled one.
  const gating = await on.page.evaluate(async () => {
    const { S } = window.ichantool, s = S.sections.at(-1), toastText = () => document.getElementById('toast').textContent, out = { tools: {}, actions: {} };
    const pause = () => new Promise((r) => setTimeout(r, 120));
    for (const tool of ['select', 'pan', 'mark', 'wand', 'brush', 'lasso', 'cut', 'erase', 'exclude', 'include']) {
      window.ichantool.setTool('pan'); document.getElementById('toast').textContent = '';
      document.querySelector(`.tool[data-tool="${tool}"]`).click(); await pause();
      out.tools[tool] = { active: S.tool === tool, message: toastText() };
    }
    window.ichantool.setTool('pan');
    const roi = document.getElementById('roiBtn'); roi.click(); await pause(); out.tools.roi = S.tool === 'roi'; window.ichantool.setTool('pan');
    const before = { w: s.w, h: s.h, ds: s.ds, rot: s.rot, crop: s.crop, filters: JSON.stringify(s.filters) };
    for (const id of ['detectBtn', 'cropBtn', 'rotL', 'rotR']) { document.getElementById('toast').textContent = ''; document.getElementById(id).click(); await pause(); out.actions[id] = toastText(); }
    const select = document.getElementById('secRes'); select.value = String(s.ds * 2); select.dispatchEvent(new Event('change', { bubbles: true })); await pause(); out.actions.secRes = toastText(); out.resValue = select.value;
    const gamma = document.getElementById('f-gamma'); document.getElementById('toast').textContent = '';
    gamma.value = '1.8'; gamma.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => setTimeout(r, 300)); out.actions.filter = toastText();
    out.unchanged = JSON.stringify(before) === JSON.stringify({ w: s.w, h: s.h, ds: s.ds, rot: s.rot, crop: s.crop, filters: JSON.stringify(s.filters) });
    // A wand chosen on the first section does not follow into the tiled one.
    S.cur = 0; window.ichantool.setTool('wand'); S.cur = S.sections.length - 1; window.ichantool.renderSectionForm?.(); out.carried = S.tool;
    return out;
  });
  for (const tool of ['select', 'pan', 'mark', 'brush', 'erase', 'exclude', 'include']) assert.equal(gating.tools[tool].active, true, tool + ' is available on a tiled section');
  assert.equal(gating.tools.roi, true, 'the analysis area is available');
  const message = await on.page.evaluate(() => window.ichantool.t?.('tiles.unavailable'));
  for (const tool of ['wand', 'lasso', 'cut']) {
    assert.equal(gating.tools[tool].active, false, tool + ' is refused');
    assert.ok(gating.tools[tool].message.length > 10 && (!message || gating.tools[tool].message === message), `${tool} shows the one message: ${gating.tools[tool].message}`);
  }
  for (const [action, text] of Object.entries(gating.actions)) assert.equal(text, gating.tools.wand.message, `${action} shows the same message`);
  assert.equal(gating.carried, 'pan', 'a wand chosen on another section does not follow into a tiled one');
  assert.equal(gating.unchanged, true, 'the refused tools changed nothing');
  assert.equal(gating.resValue, String(section.ds), 'the resolution control returns to the current value');
  // Card M8.4.16 step 2: a mask tile put in the page shows at full resolution over the pixel tiles and, reduced, in the working image at every
  // coarser zoom. One object (a rectangle) and one excluded rectangle in tile row 10; each probe is compared with the same screen pixel without
  // the mask, through today's formulas. Tolerance, stated before comparing: 2 levels per channel (8-bit colour and alpha of the drawn layer).
  const masks = await on.page.evaluate(async () => {
    const { S } = window.ichantool, s = S.sections.at(-1), canvas = document.getElementById('view'), ctx = canvas.getContext('2d');
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const TILE = 512, row = 10, id = s.nextId;
    s.objects.set(id, { id, order: s.nextTraceOrder++, cls: S.classes[0].id, pred: null, conf: 0, src: 'test', area: 0, bbox: null, stats: null, feat: null });
    s.nextId = id + 1; s.lutFill = null; S.selected = null; S.multi.clear?.();
    const labels = new Int32Array(TILE * TILE), exclude = new Uint8Array(TILE * TILE);
    for (let y = 100; y < 200; y++) for (let x = 300; x < 460; x++) labels[y * TILE + x] = id;            // source x 300-459, y 5220-5319
    for (let y = 300; y < 350; y++) for (let x = 300; x < 380; x++) exclude[y * TILE + x] = 1;            // source x 300-379, y 5420-5469
    const probes = [['inside', 380, 5270], ['edge', 300, 5270], ['excluded', 340, 5445], ['outside', 520, 5270]];
    const views = [['full resolution (level 0)', { x: 0, y: 2560, zoom: s.ds }], ['working image, 1 : 1', { x: -300, y: 2510, zoom: 1 }],
      ['working image, 1 : 2', { x: -600, y: 2400, zoom: 0.5 }]];
    const read = async (view) => {
      S.view = { ...view }; window.ichantool.requestRender(); await frame();
      for (let i = 0; i < 400 && !window.ichantool.tilesIdle(); i++) await new Promise((r) => setTimeout(r, 25));
      window.ichantool.requestRender(); await frame();
      return probes.map(([name, X, Y]) => {
        const sx = Math.floor((X / s.ds - view.x) * view.zoom), sy = Math.floor((Y / s.ds - view.y) * view.zoom);
        return { name, sx, sy, rgb: [...ctx.getImageData(sx, sy, 1, 1).data.subarray(0, 3)] };
      });
    };
    const out = [];
    for (const [name, view] of views) {
      window.ichantool.putMaskTile(row, 0, null, null);
      const before = await read(view);
      window.ichantool.putMaskTile(row, 0, labels, exclude);
      const after = await read(view);
      out.push({ name, before, after });
    }
    window.ichantool.putMaskTile(row, 0, null, null);
    const k = id * 4;
    return { views: out, fill: [...s.lutFill.subarray(k, k + 4)], line: [...s.lutLine.subarray(k, k + 3)], reduced: s.labels[(5270 / s.ds) * s.w + 380 / s.ds] };
  });
  const close = (actual, expected, what) => assert.ok(actual.every((v, c) => Math.abs(v - Math.round(expected[c])) <= 2), `${what}: ${actual} vs ${expected.map(Math.round)}`);
  const alpha = masks.fill[3] / 255;
  for (const { name, before, after } of masks.views) {
    const at = (list, probe) => list.find((p) => p.name === probe);
    const inside = at(before, 'inside').rgb, edge = at(after, 'edge'), excluded = at(after, 'excluded');
    close(at(after, 'inside').rgb, inside.map((v, c) => v * (1 - alpha) + masks.fill[c] * alpha), `${name}: object fill`);
    close(edge.rgb, masks.line, `${name}: object edge`);
    const base = at(before, 'excluded').rgb, hatch = ((excluded.sx + excluded.sy) & 7) < 2;
    close(excluded.rgb, base.map((v, c) => (hatch ? v * 0.3 + (c === 2 ? 80 : 70) : v * 0.55)), `${name}: exclusion`);
    assert.deepEqual(at(after, 'outside').rgb, at(before, 'outside').rgb, `${name}: unchanged outside the masks`);
  }
  assert.equal(masks.reduced, 0, 'removing the tile clears the reduced masks');
  // Card M8.4.16 step 3: strokes with the real mouse at full resolution (1 screen pixel per source pixel). Brush radius 10 working pixels =
  // 20 source pixels. The tiles hold the stroke exactly where it was drawn; the object's statistics, recomputed per tile from the level-0
  // pixels, count exactly the labelled source pixels; erase, exclude and include change the tiles and the reduced copy.
  const strokes = await (async () => {
    const page = on.page, box = await page.evaluate(() => {
      const { S } = window.ichantool, s = S.sections.at(-1), r = document.getElementById('view').getBoundingClientRect();
      S.view = { x: 0, y: 3000, zoom: s.ds }; S.brushSize = 10; S.exShape = 'free'; S.overlap = false; window.ichantool.requestRender();
      return { left: r.left, top: r.top };
    });
    const stroke = async (tool, y, x0, x1) => {
      await page.evaluate((tool) => window.ichantool.setTool(tool), tool);
      await page.mouse.move(box.left + x0, box.top + y); await page.mouse.down();
      for (let x = x0; x <= x1; x += 10) await page.mouse.move(box.left + x, box.top + y);
      await page.mouse.up();
      await page.waitForFunction(() => window.ichantool.tiledStatsIdle(), { polling: 50 });
    };
    const read = () => page.evaluate(() => {
      const { S } = window.ichantool, s = S.sections.at(-1), tiles = s.maskTiles, at = (x, y) => tiles.labelAt(x, y);
      const ex = (x, y) => { const e = tiles.get(Math.floor(y / 512), Math.floor(x / 512)); return e?.exclude ? e.exclude[(y % 512) * 512 + (x % 512)] : 0; };
      const id = at(350, 6200), counts = new Map();
      for (let row = 0; row < tiles.rows; row++) for (let col = 0; col < tiles.cols; col++) {
        const labels = tiles.get(row, col)?.labels; if (!labels) continue;
        for (const v of labels) if (v > 0) counts.set(v, (counts.get(v) || 0) + 1);
      }
      const o = s.objects.get(id);
      return { id, centre: at(350, 6200), radius: [at(350, 6219), at(350, 6221), at(281, 6200), at(279, 6200)], far: at(350, 6230),
        counted: counts.get(id) || 0, area: o?.area, n: o?.stats?.n, sbox: o?.sbox, bbox: o?.bbox, ds: s.ds, excluded: ex(350, 6400), excludedOut: ex(350, 6430),
        reducedLabel: s.labels[(6200 / s.ds) * s.w + 350 / s.ds], reducedExclude: s.exclude[(6400 / s.ds) * s.w + 350 / s.ds], objects: s.objects.size };
    });
    await stroke('brush', 200, 300, 400);
    const painted = await read();
    await stroke('erase', 200, 380, 420);   // erases x 360-439: the probe at x 350 stays
    const erased = await read();
    await stroke('exclude', 400, 300, 400);
    const excluded = await read();
    await stroke('include', 400, 300, 400);
    const included = await read();
    return { painted, erased, excluded, included };
  })();
  const { painted, erased, excluded, included } = strokes;
  assert.ok(painted.id > 0, 'the brush wrote an object into the tiles: ' + JSON.stringify(painted));
  assert.deepEqual(painted.radius, [painted.id, 0, painted.id, 0], 'the stroke has the brush radius in source pixels (20): ' + JSON.stringify(painted));
  assert.equal(painted.far, 0);
  assert.equal(painted.area, painted.counted, 'the area is the number of labelled source pixels in the tiles');
  assert.equal(painted.n, painted.counted);
  assert.deepEqual(painted.sbox, [280, 6180, 419, 6219], 'source bounding box of a stroke from x 300 to 400 at y 6200 with radius 20 (a pixel is painted when its centre is within the radius)');
  assert.deepEqual(painted.bbox, painted.sbox.map((v) => Math.floor(v / painted.ds)), 'the working bounding box is the source one divided by ds');
  assert.equal(painted.reducedLabel, painted.id, 'the reduced copy shows the stroke');
  assert.ok(erased.area < painted.area && erased.area === erased.counted && erased.centre === erased.id, 'erasing part of the stroke: ' + JSON.stringify(erased));
  assert.equal(excluded.excluded, 1); assert.equal(excluded.excludedOut, 0); assert.equal(excluded.reducedExclude, 1);
  assert.equal(excluded.area, erased.area, 'exclusion does not change the object');
  assert.equal(included.excluded, 0); assert.equal(included.reducedExclude, 0);
  // Card M8.4.16 step 4: the strokes reach the engine's store in the background. Then a stroke over six tiles, and the engine's coordinator
  // killed while they are on their way: the page's masks do not change, the program restarts the engine (once, automatically) and sends them
  // again, and the store then holds exactly what the page holds.
  const storeMatchesPage = () => on.page.evaluate(async () => {
    const { S } = window.ichantool, s = S.sections.at(-1), tiles = s.maskTiles, tilesApi = window.corantoolDesktop.tiles;
    const hex = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
    const manifest = s._maskSync.manifest, project = window.ichantool.S.id.toLowerCase(), positions = [], page = {};
    for (let row = 0; row < tiles.rows; row++) for (let col = 0; col < tiles.cols; col++) {
      const entry = tiles.get(row, col);
      if (!entry) continue;
      positions.push([row, col]);
      page[`${row}.${col}`] = [entry.labels ? await hex(new Uint8Array(entry.labels.buffer)) : null, entry.exclude ? await hex(entry.exclude) : null];
    }
    const stored = {};
    for (let i = 0; i < positions.length; i += 16) {
      const batch = positions.slice(i, i + 16);
      for (const [k, layer] of [[0, 'labels'], [1, 'exclude']]) {
        const read = await tilesApi.maskRead(project, manifest, layer, batch);
        if (read.error) return { error: read.error };
        const bytes = new Uint8Array(read.ok.bytes.buffer || read.ok.bytes, read.ok.bytes.byteOffset || 0, read.ok.bytes.byteLength);
        let offset = 0;
        for (const tile of read.ok.tiles) {
          const key = `${tile.row}.${tile.col}`; stored[key] ||= [null, null];
          stored[key][k] = tile.byte_length ? await hex(bytes.subarray(offset, offset + tile.byte_length)) : null; offset += tile.byte_length;
        }
      }
    }
    return { manifest, page, stored, dirty: tiles.dirtyPositions().length, withContent: Object.values(page).filter(([a, b]) => a || b).length };
  });
  await on.page.waitForFunction(() => window.ichantool.masksSettled(), { polling: 100, timeout: 60000 });
  const settled = await storeMatchesPage();
  assert.ok(settled.manifest && settled.dirty === 0 && settled.withContent >= 1, 'the strokes reached the store: ' + JSON.stringify({ ...settled, page: undefined, stored: undefined }));
  assert.deepEqual(settled.stored, settled.page, 'the store holds exactly the page\'s masks');
  await on.page.evaluate(() => { window.ichantool.setTool('brush'); window.ichantool.S.brushSize = 10; });
  const box = await on.page.evaluate(() => { const r = document.getElementById('view').getBoundingClientRect(); return { left: r.left, top: r.top }; });
  // Found before the stroke: looking it up takes about a second, longer than a round.
  const coordinator = Number(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*server.py*' -and $_.CommandLine -like '*projects-dir*' } | Where-Object { $p = $_; $chain = $p.ParentProcessId; $hit = $false; for ($k = 0; $k -lt 6 -and $chain; $k++) { if ($chain -eq ${on.pid}) { $hit = $true; break }; $chain = (Get-CimInstance Win32_Process -Filter "ProcessId=$chain").ParentProcessId }; $hit } | Select-Object -First 1).ProcessId`],
    { encoding: 'utf8', windowsHide: true }).trim());
  assert.ok(coordinator > 0, 'the engine coordinator of this program was found');
  const putsBefore = await on.page.evaluate(() => window.ichantool.S.sections.at(-1)._maskSync.puts);
  await on.page.mouse.move(box.left + 500, box.top + 40); await on.page.mouse.down();
  for (let y = 40; y <= 900; y += 20) await on.page.mouse.move(box.left + 500 + (y % 40), box.top + y);
  await on.page.mouse.up();
  const before = await on.page.evaluate(async () => {
    const s = window.ichantool.S.sections.at(-1), tiles = s.maskTiles, out = {};
    for (const [row, col] of tiles.dirtyPositions()) out[`${row}.${col}`] = Array.from(tiles.get(row, col).labels || []).reduce((a, v, i) => (a + v * (i % 9973 + 1)) % 1e9, 0);
    return out;
  });
  assert.ok(Object.keys(before).length >= 4, 'the stroke changed several tiles: ' + Object.keys(before));
  // Wait until the round is on its way (its first tile sent, not committed), then kill the coordinator.
  await on.page.waitForFunction((base) => { const sync = window.ichantool.S.sections.at(-1)._maskSync; return !!sync.running && sync.puts > base; },
    { polling: 'raf', timeout: 30000 }, putsBefore);
  const manifestAtKill = await on.page.evaluate(() => window.ichantool.S.sections.at(-1)._maskSync.manifest);
  process.kill(coordinator, 'SIGKILL');
  const kept = await on.page.evaluate(async (expected) => {
    const s = window.ichantool.S.sections.at(-1), tiles = s.maskTiles;
    return Object.entries(expected).every(([key, sum]) => { const [row, col] = key.split('.').map(Number);
      return Array.from(tiles.get(row, col).labels || []).reduce((a, v, i) => (a + v * (i % 9973 + 1)) % 1e9, 0) === sum; });
  }, before);
  assert.equal(kept, true, 'the page keeps its masks when the engine dies');
  await on.page.waitForFunction(() => window.ichantool.masksSettled(), { polling: 200, timeout: 120000 });
  const midway = await on.page.evaluate(() => { const sync = window.ichantool.S.sections.at(-1)._maskSync; return { running: !!sync.running, manifest: sync.manifest }; });
  const resent = await storeMatchesPage();
  assert.ok(!resent.error, 'the restarted engine answers: ' + JSON.stringify(resent.error));
  assert.equal(resent.dirty, 0);
  assert.notEqual(resent.manifest, settled.manifest);
  assert.equal(manifestAtKill, settled.manifest, 'the engine was killed before the round committed');
  assert.equal(midway.running, false);
  assert.deepEqual(resent.stored, resent.page, 'after the restart the store holds exactly the page\'s masks, the stroke included');
  for (const key of Object.keys(before)) assert.ok(resent.page[key]?.[0], `tile ${key} of the stroke is stored`);
  const messages = await on.page.evaluate(() => [window.ichantool.t('tiles.masksUnsent'), window.ichantool.t('tiles.masksSent')]);
  assert.ok(toasts.includes(messages[0]) && toasts.indexOf(messages[1], toasts.indexOf(messages[0])) > 0,
    'the failure of the round was shown, then its recovery: ' + JSON.stringify(toasts.slice(-4)));
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
