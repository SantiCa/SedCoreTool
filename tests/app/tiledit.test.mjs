// Card M8.4.16 step 3: the edit window of tiled sections and object statistics kept per tile.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EditWindow, windowRange, affectedTiles, tileStats, TiledObjectStats, TiledStatsRunner, shiftStats, WINDOW_TILES } from '../../app/js/tiledit.js';
import { MaskTiles } from '../../app/js/tiledmasks.js';
import { objectStats } from '../../app/js/imageproc.js';
import { TILE } from '../../app/js/tiledsection.js';

const N = TILE * TILE;

function random(seed) { let state = seed; return () => { state = (state * 1103515245 + 12345) >>> 0; return state / 2 ** 32; }; }

/** Whole-image masks with rectangles of objects 1..6, overlaps -1 = [2, 5] and -2 = [3, 6], and exclusion. */
function wholeMasks(width, height, seed = 3) {
  const rnd = random(seed), labels = new Int32Array(width * height), exclude = new Uint8Array(width * height);
  for (let n = 0; n < 30; n++) {
    const x0 = Math.floor(rnd() * width), y0 = Math.floor(rnd() * height), w = 1 + Math.floor(rnd() * 400), h = 1 + Math.floor(rnd() * 400);
    const id = [1, 2, 3, 4, 5, 6, -1, -2][Math.floor(rnd() * 8)];
    for (let y = y0; y < Math.min(height, y0 + h); y++) for (let x = x0; x < Math.min(width, x0 + w); x++) labels[y * width + x] = id;
  }
  for (let i = 0; i < exclude.length; i += 37) exclude[i] = 1;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < rgba.length; i++) rgba[i] = Math.floor(rnd() * 256);
  return { labels, exclude, rgba };
}

/** The tiles of a whole-image array, zero-padded. */
function tileOf(whole, width, height, row, col, perPixel = 1, Type = Int32Array) {
  const out = new Type(N * perPixel);
  for (let y = 0; y < TILE && row * TILE + y < height; y++) {
    const from = ((row * TILE + y) * width + col * TILE) * perPixel, cols = Math.min(TILE, width - col * TILE);
    out.set(whole.subarray(from, from + cols * perPixel), y * TILE * perPixel);
  }
  return out;
}

function loadTiles(width, height, masks) {
  const tiles = new MaskTiles({ width, height });
  for (let row = 0; row < tiles.rows; row++) for (let col = 0; col < tiles.cols; col++) {
    tiles.set(row, col, tileOf(masks.labels, width, height, row, col), tileOf(masks.exclude, width, height, row, col, 1, Uint8Array), { dirty: false });
  }
  return tiles;
}

test('windowRange and affectedTiles: tiles covering a rectangle plus a margin, within the grid', () => {
  assert.deepEqual(windowRange({ rows: 10, cols: 4 }, { x0: 600, y0: 1100, x1: 1100, y1: 1600 }, 1), { row0: 1, row1: 4, col0: 0, col1: 3, count: 16 });
  assert.deepEqual(windowRange({ rows: 10, cols: 4 }, { x0: 0, y0: 0, x1: 10, y1: 10 }, 0), { row0: 0, row1: 0, col0: 0, col1: 0, count: 1 });
  assert.equal(WINDOW_TILES, 96);
  assert.deepEqual(affectedTiles({ rows: 3, cols: 3 }, { x0: 600, y0: 600, x1: 700, y1: 700 }), [[1, 1]]);
  assert.deepEqual(affectedTiles({ rows: 3, cols: 3 }, { x0: 514, y0: 600, x1: 700, y1: 1022 }), [[1, 0], [1, 1], [2, 0], [2, 1]]);
});

test('EditWindow: the masks of a range as flat arrays, clipped at the section, and written back into dirty tiles', () => {
  const width = 1300, height = 1100, masks = wholeMasks(width, height), tiles = loadTiles(width, height, masks);
  const range = windowRange(tiles, { x0: 600, y0: 0, x1: 1300, y1: 1100 }, 0);
  const window = new EditWindow(tiles, range);
  assert.deepEqual([window.ox, window.oy, window.w, window.h], [512, 0, 788, 1100]);
  for (let y = 0; y < window.h; y += 7) for (let x = 0; x < window.w; x += 5) {
    assert.equal(window.labels[y * window.w + x], masks.labels[y * width + x + 512]);
    assert.equal(window.exclude[y * window.w + x], masks.exclude[y * width + x + 512]);
  }
  assert.equal(window.labelAt(700, 50), masks.labels[50 * width + 700]);
  assert.equal(window.labelAt(100, 50), null);
  assert.ok(window.matches(tiles, range));
  // A rectangle across four tiles, up to the section's right edge: written back, and the padding of the edge tiles stays zero.
  for (let y = 500; y <= 530; y++) for (let x = 480; x < 788; x++) { window.labels[y * window.w + x] = 77; window.exclude[y * window.w + x] = 1; }
  const written = window.writeBack({ x0: 480, y0: 500, x1: 787, y1: 530 });
  assert.deepEqual(written, [[0, 1], [0, 2], [1, 1], [1, 2]]);
  assert.ok(window.matches(tiles, range), 'its own writes keep the window current');
  const edge = tiles.get(1, 2);
  assert.equal(edge.dirty, true);
  assert.equal(edge.labels[(520 - 512) * TILE + (1299 - 1024)], 77);
  assert.equal(edge.labels[(520 - 512) * TILE + (1300 - 1024)], 0, 'padding beyond the section stays 0');
  assert.equal(tiles.labelAt(1000, 500), 77);
  assert.equal(tiles.labelAt(1000, 499), masks.labels[499 * width + 1000]);
  tiles.set(2, 0, null, null);                                     // another writer: the window is no longer current
  assert.equal(window.matches(tiles, range), false);
  const stale = new MaskTiles({ width, height }); stale.stored.add(0);
  assert.throws(() => new EditWindow(stale, windowRange(stale, { x0: 0, y0: 0, x1: 10, y1: 10 }, 0)), /not loaded/);
});

test('tileStats summed per object equal objectStats over the whole image, overlaps and edges included', () => {
  // Tolerance, stated before comparing: integer-valued sums (counts, coordinates and their products, bounding boxes, perimeter, colour
  // differences) exactly; the luminance sums sL, sLL and rL are sums of non-integers added in another order, relative 1e-12.
  const width = 1300, height = 1100, masks = wholeMasks(width, height, 11), stacks = [[], [2, 5], [3, 6]];
  const tiles = loadTiles(width, height, masks), stats = new TiledObjectStats();
  const rgbaTiles = new Map();
  for (let row = 0; row < tiles.rows; row++) for (let col = 0; col < tiles.cols; col++) rgbaTiles.set(row * tiles.cols + col, tileOf(masks.rgba, width, height, row, col, 4, Uint8ClampedArray));
  const source = { width, height, stacks, labelsAt: (r, c) => tiles.get(r, c)?.labels || null, rgbaAt: (r, c) => rgbaTiles.get(r * tiles.cols + c) };
  for (let row = 0; row < tiles.rows; row++) for (let col = 0; col < tiles.cols; col++) stats.replaceTile(row * tiles.cols + col, tileStats(source, row, col));
  const whole = objectStats(masks.labels, width, height, masks.rgba, null, null, stacks);
  assert.ok(whole.size >= 5);
  for (const [id, expected] of whole) {
    const total = stats.total(id);
    for (const key of ['n', 'sx', 'sy', 'sxx', 'syy', 'sxy', 'x0', 'x1', 'y0', 'y1', 'per', 'sA', 'sB', 'rN']) assert.equal(total[key], expected[key], `object ${id} ${key}`);
    for (const key of ['sL', 'sLL', 'rL']) assert.ok(Math.abs(total[key] - expected[key]) <= 1e-12 * Math.abs(expected[key]), `object ${id} ${key}`);
  }
  assert.equal(stats.total(99), null);
  // Erasing an object from one tile changes only its total; erasing it everywhere removes it.
  const id = [...whole.keys()].find((k) => (stats.tilesOf.get(k)?.size || 0) > 1);
  const [first] = [...stats.tilesOf.get(id)];
  assert.ok(stats.replaceTile(first, new Map()).has(id));
  assert.ok(stats.total(id).n < whole.get(id).n);
  for (const tile of [...stats.tilesOf.get(id)]) stats.replaceTile(tile, new Map());
  assert.equal(stats.total(id), null);
});

test('shiftStats: moving the origin is the same as accumulating in the other coordinates', () => {
  const labels = new Int32Array(40 * 30), rgba = new Uint8ClampedArray(40 * 30 * 4).fill(90);
  for (let y = 5; y < 20; y++) for (let x = 7; x < 33; x++) labels[y * 40 + x] = 1;
  const a = objectStats(labels, 40, 30, rgba).get(1);
  const moved = shiftStats(a, 1000, 2000);
  const big = new Int32Array(1040 * 2030), bigRgba = new Uint8ClampedArray(1040 * 2030 * 4).fill(90);
  for (let y = 5; y < 20; y++) for (let x = 7; x < 33; x++) big[(y + 2000) * 1040 + x + 1000] = 1;
  const b = objectStats(big, 1040, 2030, bigRgba, null, { x0: 1000, y0: 2000, x1: 1040, y1: 2030 }).get(1);
  for (const key of ['n', 'sx', 'sy', 'sxx', 'syy', 'sxy', 'x0', 'x1', 'y0', 'y1']) assert.equal(moved[key], b[key], key);
});

test('TiledStatsRunner: recomputes queued tiles from the labels as they are when their turn comes, and reports changed objects', async () => {
  const width = 1024, height = 512, tiles = new MaskTiles({ width, height }), stats = new TiledObjectStats(), fetched = [], updates = [];
  const left = new Int32Array(N); for (let y = 10; y < 20; y++) for (let x = 500; x < 512; x++) left[y * TILE + x] = 4;
  const right = new Int32Array(N); for (let y = 10; y < 20; y++) for (let x = 0; x < 30; x++) right[y * TILE + x] = 4;
  tiles.set(0, 0, left, null); tiles.set(0, 1, right, null);
  const runner = new TiledStatsRunner({ tiles, stats, stacks: () => [[]], fetchRgba: async (positions) => { fetched.push(...positions); return positions.map(() => new Uint8ClampedArray(N * 4).fill(50)); },
    onUpdate: (ids) => updates.push([...ids]) });
  await runner.queue([[0, 0], [0, 1]], [9]);
  assert.equal(stats.total(4).n, 10 * 12 + 10 * 30);
  assert.deepEqual(stats.total(4).x0, 500); assert.deepEqual(stats.total(4).x1, 541);
  assert.equal(stats.total(4).per, 2 * 42 + 2 * 8, 'no edge at the seam between the two tiles');
  assert.ok(updates.flat().includes(4) && updates.flat().includes(9), 'a requested id is reported even when no tile holds it');
  assert.equal(new Set(fetched.map(String)).size, fetched.length, 'pixels are read once');
  // A change made after the computation was queued is the one counted.
  const pending = runner.queue([[0, 1]]);
  tiles.set(0, 1, null, null);
  await pending;
  assert.equal(stats.total(4).n, 120);
  assert.ok(runner.idle);
});
