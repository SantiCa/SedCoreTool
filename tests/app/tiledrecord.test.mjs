// Card M8.4.42: a tiled section can cover a row window of its stored image. A section with a window over rows [y0, y1) and a section made from a
// source holding only those rows read the same pixels, show the same working image and give identical statistics and interval table; a record
// without a window is saved byte for byte as before (format 6), and one with a window makes the project format 7, read-only for older builds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TILE } from '../../app/js/tiledsection.js';
import { MaskTiles } from '../../app/js/tiledmasks.js';
import { TiledObjectStats, TiledStatsRunner } from '../../app/js/tiledit.js';
import { TiledRowCounts, TiledCountsRunner } from '../../app/js/tiledcounts.js';
import { binsFromRowCounts, binRowsOfSection, effectiveClassIndex } from '../../app/js/sectionanalysis.js';
import { allCases } from '../../tools/make_interval_fixtures.mjs';
import { FORMAT_VERSION_WINDOW, cropRows, opensReadOnly, projectFormatVersion, pyramidPositions, recordFitsPyramid, serTiledSection, validTiledRecord,
  validWindow, windowTileBytes, workingBand } from '../../app/js/tiledrecord.js';

globalThis.ImageData ??= class { constructor(data, width, height) { this.data = data; this.width = width; this.height = height; } };
globalThis.createImageBitmap ??= async (image) => ({ width: image.width, height: image.height, close() {} });
const { createTiledView } = await import('../../app/js/tiledview.js');
const { createTiledState } = await import('../../app/js/tiledstate.js');

/** A small seeded generator (mulberry32), so a failure can be repeated. */
function random(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* ───────────── a pyramid as the engine builds it (store/pyramid.py: `halve`, tiles padded with zeros) ───────────── */

const CHANNELS = 3;
/** Image of w x h, 3 channels, 8 bits, noisy so that a shifted read cannot pass by chance. */
function makeImage(w, h, seed) {
  const rand = random(seed), data = new Uint8Array(w * h * CHANNELS);
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(rand() * 256);
  return { w, h, data };
}
const rowsOf = (image, y0, y1) => ({ w: image.w, h: y1 - y0, data: image.data.slice(y0 * image.w * CHANNELS, y1 * image.w * CHANNELS) });
/** pyramid.halve: the mean of the 1, 2 or 4 pixels covered, rounded half up. */
function halve(image) {
  const w = Math.ceil(image.w / 2), h = Math.ceil(image.h / 2), data = new Uint8Array(w * h * CHANNELS);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < CHANNELS; c++) {
    let total = 0, n = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const sy = 2 * y + dy, sx = 2 * x + dx;
      if (sy < image.h && sx < image.w) { total += image.data[(sy * image.w + sx) * CHANNELS + c]; n++; }
    }
    data[(y * w + x) * CHANNELS + c] = Math.floor((total + Math.floor(n / 2)) / n);
  }
  return { w, h, data };
}
function makePyramid(image, levels) {
  const images = [image];
  for (let k = 1; k < levels; k++) images.push(halve(images[k - 1]));
  return { images, levels: images.map((im, k) => ({ level: k, width: im.w, height: im.h, rows: Math.ceil(im.h / TILE), cols: Math.ceil(im.w / TILE) })) };
}
function tileBytes(image, row, col) {
  const out = new Uint8Array(TILE * TILE * CHANNELS);
  for (let y = 0; y < TILE && row * TILE + y < image.h; y++) {
    const sy = row * TILE + y, x0 = col * TILE, x1 = Math.min(image.w, x0 + TILE);
    out.set(image.data.subarray((sy * image.w + x0) * CHANNELS, (sy * image.w + x1) * CHANNELS), y * TILE * CHANNELS);
  }
  return out;
}
/** The engine bridge's `read` over pyramids by identifier; a position outside a level fails, as the engine refuses it. */
function bridge(pyramids) {
  return { async read(id, k, positions) {
    const p = pyramids[id], level = p.levels[k];
    if (positions.some(([row, col]) => row < 0 || col < 0 || row >= level.rows || col >= level.cols)) return { error: { code: 'INVALID_REQUEST', field: 'positions' } };
    const parts = positions.map(([row, col]) => tileBytes(p.images[k], row, col)), bytes = new Uint8Array(parts.length * TILE * TILE * CHANNELS);
    parts.forEach((part, i) => bytes.set(part, i * part.length));
    return { ok: { bytes, tiles: parts.map((part) => ({ byte_length: part.length })) } };
  } };
}

const W = 700, H = 2600, Y0 = 2 * TILE, Y1 = 2304, LEVEL = 1, FULL = 'a'.repeat(64), CUT = 'b'.repeat(64);
const image = makeImage(W, H, 42), full = makePyramid(image, 4), cut = makePyramid(rowsOf(image, Y0, Y1), 4);
const TILES = bridge({ [FULL]: full, [CUT]: cut });
const windowed = () => ({ pyramid: FULL, level: LEVEL, levels: full.levels, channels: CHANNELS, bits: 8, window: { y0: Y0, y1: Y1 } });
const fromCut = () => ({ pyramid: CUT, level: LEVEL, levels: cut.levels, channels: CHANNELS, bits: 8 });

/** Masks of the window's size: rectangles of 12 objects (two overlapping as a stack), one near its last row, and some exclusion. */
function makeMasks(seed) {
  const rand = random(seed), w = W, h = Y1 - Y0, labels = new Int32Array(w * h), exclude = new Uint8Array(w * h), stacks = [null, [3, 4]];
  const rect = (x0, y0, x1, y1, value, into = labels) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) into[y * w + x] = value; };
  for (let id = 1; id <= 11; id++) {
    const x0 = Math.floor(rand() * (w - 200)), y0 = Math.floor(rand() * (h - 300));
    rect(x0, y0, x0 + 20 + Math.floor(rand() * 180), y0 + 20 + Math.floor(rand() * 280), id);
  }
  rect(100, 400, 200, 600, -1);                                         // objects 3 and 4 overlap here
  rect(300, h - 40, 650, h, 12);                                        // the window's last rows (the tile below them is cut)
  rect(0, 900, 50, 1100, 1, exclude);
  const tiles = new MaskTiles({ width: w, height: h, budget: Infinity });
  for (let row = 0; row < tiles.rows; row++) for (let col = 0; col < tiles.cols; col++) {
    const l = new Int32Array(TILE * TILE), e = new Uint8Array(TILE * TILE);
    for (let y = 0; y < TILE && row * TILE + y < h; y++) for (let x = 0; x < TILE && col * TILE + x < w; x++) {
      l[y * TILE + x] = labels[(row * TILE + y) * w + col * TILE + x]; e[y * TILE + x] = exclude[(row * TILE + y) * w + col * TILE + x];
    }
    tiles.set(row, col, l, e);
  }
  return { tiles, stacks, w, h };
}
const allPositions = (tiles) => { const out = /** @type {[number, number][]} */ ([]); for (let row = 0; row < tiles.rows; row++) for (let col = 0; col < tiles.cols; col++) out.push([row, col]); return out; };

function pageState() {
  return createTiledState(/** @type {any} */ ({ TILES, TILES_ONLY: ['tiles'], toast: () => {}, afterChange: () => {}, analysisProject: () => ({}), analyze: () => {},
    effClassArray: () => [], renderResults: () => {}, requestRender: () => {}, sourceBox: () => null, sourceRoi: () => null }));
}

test('the level-0 reads of a section with a window equal those of a source holding only its rows, the cut last tile included', async () => {
  const state = pageState(), masks = makeMasks(1), positions = allPositions(masks.tiles);
  const a = await state.level0Rgba({ tiled: windowed() }, positions), b = await state.level0Rgba({ tiled: fromCut() }, positions);
  assert.equal(a.length, positions.length);
  for (let i = 0; i < a.length; i++) assert.ok(Buffer.from(a[i].buffer).equals(Buffer.from(b[i].buffer)), `tile ${positions[i]}`);
  const last = a[a.length - 1], keep = Y1 - Y0 - (masks.tiles.rows - 1) * TILE;
  assert.ok(keep > 0 && keep < TILE, 'the last tile row is cut by the window');
  assert.deepEqual([...last.subarray(keep * TILE * 4, keep * TILE * 4 + 4)], [0, 0, 0, 255], 'below the window: the padding of a source that ends there');
});

test('the working image of a section with a window is the same as that of a source holding only its rows', async () => {
  const view = createTiledView({ TILES, toast: () => {}, requestRender: () => {}, esc: String, maskLoader: () => null, recoverEngine: async () => {} });
  const a = await view.tiledWorkingImage(windowed()), b = await view.tiledWorkingImage(fromCut());
  assert.deepEqual([a.w, a.h], [b.w, b.h]);
  assert.deepEqual([a.w, a.h], [Math.ceil(W / 2), (Y1 - Y0) / 2]);
  assert.ok(Buffer.from(a.rgba.buffer).equals(Buffer.from(b.rgba.buffer)), 'identical pixels');
  const whole = await view.tiledWorkingImage({ ...windowed(), window: undefined });
  assert.deepEqual([whole.w, whole.h], [full.levels[LEVEL].width, full.levels[LEVEL].height], 'without a window: the whole level, as before');
});

test('statistics and interval table of a section with a window equal those of a source holding only its rows (exact)', async () => {
  const state = pageState(), results = [];
  for (const tiled of [windowed(), fromCut()]) {
    const masks = makeMasks(7), s = { tiled, maskTiles: masks.tiles }, stats = new TiledObjectStats();
    const runner = new TiledStatsRunner({ tiles: masks.tiles, stats, stacks: () => masks.stacks, fetchRgba: (positions) => state.level0Rgba(s, positions), onUpdate: () => {},
      onError: (error) => { throw error; } });
    await runner.queue(allPositions(masks.tiles));
    const ids = [...stats.tilesOf.keys()].sort((x, y) => x - y);
    const { section, project } = allCases()[0], area = { x0: 0, y0: 0, x1: masks.w, y1: masks.h };
    const counts = new TiledRowCounts({ width: masks.w, height: masks.h, rows: masks.tiles.rows, cols: masks.tiles.cols }, { nonEmpty: () => masks.tiles.entries.keys() });
    const countsRunner = new TiledCountsRunner({ tiles: masks.tiles, counts });
    counts.setArea(area); assert.deepEqual(countsRunner.flush(), []);
    const eff = effectiveClassIndex(section, project.classes, project.settings);
    const rowCounts = counts.rowCounts({ effClass: eff, nClasses: project.classes.length, stacks: masks.stacks, area });
    const depthOf = { top: 100, bottom: 164, units: 'cm', roi: { y0: 0, y1: masks.h }, manual: [] };   // 20 rows per cm: 13 intervals of 5 cm
    results.push({ ids, totals: ids.map((id) => stats.total(id)), bins: binsFromRowCounts(depthOf, rowCounts, project, binRowsOfSection(depthOf, project.settings)) });
  }
  const [a, b] = results;
  assert.equal(a.ids.length, 12, 'every object has statistics');
  assert.deepEqual(a.ids, b.ids);
  assert.deepEqual(a.totals, b.totals, 'object statistics, colours included');
  assert.ok(a.bins.length > 5);
  assert.deepEqual(a.bins, b.bins, 'interval table');
});

/* ───────────── the window's arithmetic ───────────── */

test('positions, cut tiles and the working band translate by whole tiles and pixels', () => {
  assert.deepEqual(pyramidPositions({ window: { y0: 1024 } }, [[0, 0], [2, 1]]), [[2, 0], [4, 1]]);
  const unchanged = [[0, 0]];
  assert.equal(pyramidPositions({}, unchanged), unchanged, 'no window: the same positions');
  const bytes = new Uint8Array(TILE * TILE).fill(9);
  assert.equal(windowTileBytes({}, 5, bytes, 1, 8), bytes);
  assert.equal(windowTileBytes({ window: { y0: 0, y1: 1100 } }, 1, bytes, 1, 8), bytes, 'a tile inside the window is not copied');
  const cutTile = windowTileBytes({ window: { y0: 0, y1: 1100 } }, 2, bytes, 1, 8);
  assert.equal(cutTile[76 * TILE - 1], 9); assert.equal(cutTile[76 * TILE], 0);
  assert.equal(bytes[76 * TILE], 9, 'the bytes read are not changed');
  const band = workingBand({ width: 350, height: 1300, rows: 3, cols: 1 }, 1, { y0: 1024, y1: 2304 });
  assert.deepEqual([band.row0, band.row1, band.cropY, band.height], [1, 2, 0, 640]);
  assert.deepEqual(band.level, { width: 350, height: 1300 - 512, rows: 2, cols: 1 });
  const odd = workingBand({ width: 100, height: 3000, rows: 6, cols: 1 }, 2, { y0: 1536, y1: 2049 });
  assert.deepEqual([odd.row0, odd.row1, odd.cropY, odd.height], [0, 1, 384, 129], 'level 2: ceil of the window height / 4');
  assert.throws(() => workingBand({ width: 100, height: 600, rows: 2, cols: 1 }, 1, { y0: 1024, y1: 2304 }), /does not fit/);
  assert.equal(workingBand({ width: 1, height: 1, rows: 1, cols: 1 }, 0, undefined), null);
  const crop = cropRows({ w: 2, h: 3, rgba: Uint8ClampedArray.from({ length: 24 }, (_, i) => i), rgba16: null }, 1, 2);
  assert.deepEqual([crop.w, crop.h, crop.rgba[0], crop.rgba.length, crop.rgba16], [2, 2, 8, 16, null]);
});

/* ───────────── the saved record ───────────── */

const SHA = (c) => c.repeat(64);
/** A tiled section's record as format 6 writes it (card M8.4.18a). */
function record6() {
  return {
    id: 'sec1', name: 'Core 1', ds: 2, rot: 0, w: 350, h: 640, crop: null, full: { w: 700, h: 1280 },
    file: { name: 'core.tif', type: 'image/tiff', tiled: true },
    top: 100, bottom: 112.8, units: 'cm', roi: { x0: 0, y0: 0, x1: 350, y1: 640 }, filters: { contrast: 1 }, preset: 'p', detect: { method: 'none' }, manual: [],
    nextId: 4, objects: [{ id: 1, cls: 'c0', src: 'manual', st: { n: 4, x0: 0, y0: 0, x1: 1, y1: 1 } }, { id: 2, cls: 'c1', src: 'auto', nt: 1, th: 'data:x' }, { id: 3, cls: '', src: 'auto', em: [0.5] }],
    stacks: [null, [1, 2]], marks: [],
    tiled: { version: 1, store: 2, manifest: SHA('c'), width: 700, height: 1280, level: 1, source: { sha256: SHA('d'), size: 123456, name: 'core.tif' } },
  };
}
/** The section the page builds from a record (as `loadTiledSection` does). */
function sectionOf(q) {
  const objects = new Map(q.objects.map((o) => [o.id, { id: o.id, order: 0, cls: o.cls, src: o.src, nt: !!o.nt, pred: null, conf: 0, stats: o.st || null,
    ...(o.th ? { _thumb: o.th } : {}), ...(o.em ? { emb: o.em } : {}) }]));
  return { id: q.id, name: q.name, ds: q.ds, w: q.w, h: q.h, full: q.full, file: { ...q.file }, top: q.top, bottom: q.bottom, units: q.units, roi: q.roi, filters: q.filters,
    preset: q.preset, detect: q.detect, manual: q.manual, nextId: q.nextId, marks: q.marks, objects, stacks: q.stacks,
    maskTiles: { width: q.tiled.width, height: q.tiled.height },
    tiled: { pyramid: q.tiled.source.sha256, level: q.tiled.level, source: { name: q.tiled.source.name, size: q.tiled.source.size },
      ...(q.tiled.window ? { window: { ...q.tiled.window } } : {}) } };
}

test('a format-6 record opens and is saved again byte for byte; a record with a window keeps it', () => {
  const q6 = record6();
  assert.ok(validTiledRecord(q6.tiled));
  assert.equal(JSON.stringify(serTiledSection(sectionOf(q6), q6.tiled.manifest)), JSON.stringify(q6), 'format 6: byte-equal');
  const q7 = record6();
  q7.tiled.window = { y0: 1024, y1: 2304 };
  assert.ok(validTiledRecord(q7.tiled));
  assert.equal(JSON.stringify(serTiledSection(sectionOf(q7), q7.tiled.manifest)), JSON.stringify(q7), 'the window is written as read');
});

test('a window is refused unless it starts on a mask tile and a working pixel and is as tall as the masks', () => {
  const base = record6().tiled, withWindow = (window, extra = {}) => ({ ...base, ...extra, window });
  assert.ok(validWindow(base));
  assert.ok(validWindow(withWindow({ y0: 0, y1: 1280 })));
  for (const [window, extra, why] of [
    [{ y0: 256, y1: 1536 }, {}, 'not on a mask tile'], [{ y0: 512, y1: 1792 }, { level: 10 }, 'not on a working pixel'], [{ y0: 1024, y1: 2000 }, {}, 'not as tall as the masks'],
    [{ y0: -512, y1: 768 }, {}, 'negative'], [{ y0: 0.5, y1: 1280.5 }, {}, 'not whole'], [null, {}, 'null'], ['0-1280', {}, 'not an object'], [{ y0: 1024 }, {}, 'no end'],
  ]) assert.equal(validTiledRecord(withWindow(window, extra)), false, why);
  assert.ok(recordFitsPyramid(base, { width: 700, height: 1280 }));
  assert.equal(recordFitsPyramid(base, { width: 700, height: 2600 }), false, 'without a window the pyramid is the whole record');
  assert.ok(recordFitsPyramid(withWindow({ y0: 1024, y1: 2304 }), { width: 700, height: 2600 }));
  assert.equal(recordFitsPyramid(withWindow({ y0: 1024, y1: 2304 }), { width: 700, height: 2300 }), false, 'a window beyond the image');
  assert.equal(recordFitsPyramid(withWindow({ y0: 1024, y1: 2304 }), { width: 701, height: 2600 }), false);
});

test('a project with a windowed section is format 7, and opens read-only in a build that knows only format 6 (simulated)', () => {
  const q6 = record6(), q7 = record6();
  q7.tiled.window = { y0: 1024, y1: 2304 };
  assert.equal(FORMAT_VERSION_WINDOW, 7);
  assert.equal(projectFormatVersion([], false, 5, 6), 5);
  assert.equal(projectFormatVersion([q6, { id: 'plain' }], true, 5, 6), 6, 'tiled sections without a window keep format 6');
  assert.equal(projectFormatVersion([q6, q7], true, 5, 6), 7);
  assert.equal(opensReadOnly(7, 6), true, 'a build that knows format 6 opens it read-only');
  assert.equal(opensReadOnly(7, FORMAT_VERSION_WINDOW), false, 'this build edits it');
  assert.equal(opensReadOnly(6, FORMAT_VERSION_WINDOW), false);
  assert.equal(opensReadOnly(8, FORMAT_VERSION_WINDOW), true);
  assert.equal(opensReadOnly(undefined, FORMAT_VERSION_WINDOW), false);
});
