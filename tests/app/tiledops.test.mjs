// Card M8.4.16 step 6: wand, lasso, scissors and object operations of tiled sections run today's functions on edit windows. The windows of
// one operation are planned (and refused beyond the budget) before anything is written, and the functions give on a window exactly what
// they give on the whole image, shifted by the window's origin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EditWindow, planWindows, pinRanges, toWindowRect, windowRgba, windowRange } from '../../app/js/tiledit.js';
import { MaskTiles, LABEL_BYTES } from '../../app/js/tiledmasks.js';
import { TILE } from '../../app/js/tiledsection.js';
import { polygonPixels, regionGrow } from '../../app/js/imageproc.js';
import { splitPieces } from '../../app/js/edit.js';

const W = 1300, H = 1100;

/** A synthetic section: labels with two objects and an RGBA image with a bright disc, cut into mask tiles and RGBA tiles. */
function section() {
  const labels = new Int32Array(W * H), rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 480; y < 560; y++) for (let x = 470; x < 620; x++) labels[y * W + x] = 3;          // object 3 crosses four tiles
  for (let y = 900; y < 1000; y++) for (let x = 1100; x < 1250; x++) labels[y * W + x] = 4;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const inside = (x - 640) ** 2 + (y - 500) ** 2 < 140 ** 2, j = (y * W + x) * 4;
    rgba[j] = inside ? 200 : 40 + ((x * 7 + y * 3) % 30); rgba[j + 1] = inside ? 190 : 50; rgba[j + 2] = inside ? 180 : 60; rgba[j + 3] = 255;
  }
  const tiles = new MaskTiles({ width: W, height: H }), rgbaTiles = new Map();
  for (let row = 0; row < tiles.rows; row++) for (let col = 0; col < tiles.cols; col++) {
    const t = new Int32Array(TILE * TILE), p = new Uint8ClampedArray(TILE * TILE * 4);
    for (let y = 0; y < TILE && row * TILE + y < H; y++) for (let x = 0; x < TILE && col * TILE + x < W; x++) {
      const i = (row * TILE + y) * W + col * TILE + x;
      t[y * TILE + x] = labels[i]; p.set(rgba.subarray(i * 4, i * 4 + 4), (y * TILE + x) * 4);
    }
    tiles.set(row, col, t, null);
    rgbaTiles.set(row * tiles.cols + col, p);
  }
  return { labels, rgba, tiles, rgbaTiles };
}
const toSource = (win, pixels) => pixels.map((i) => (win.oy + Math.floor(i / win.w)) * W + win.ox + (i % win.w)).sort((a, b) => a - b);

test('planWindows: one range per box, refusal beyond the budget, and the dropped tiles of all boxes once', () => {
  const tiles = new MaskTiles({ width: 4096, height: 4096, budget: LABEL_BYTES });
  tiles.set(0, 0, new Int32Array(TILE * TILE).fill(1), null); tiles.acknowledge([[0, 0]]);
  tiles.set(0, 1, new Int32Array(TILE * TILE).fill(2), null); tiles.acknowledge([[0, 1]]);   // (0, 0) is dropped
  const plan = planWindows(tiles, [{ x0: 10, y0: 10, x1: 600, y1: 20 }, { x0: 0, y0: 0, x1: 5, y1: 5 }]);
  assert.deepEqual(plan.ranges.map((r) => r.count), [2, 1]);
  assert.deepEqual(plan.missing, [[0, 0]]);
  assert.equal(plan.tooLarge, false);
  assert.equal(planWindows(tiles, [{ x0: 0, y0: 0, x1: 4096, y1: 4096 }]).tooLarge, false, '64 tiles fit the default 96');
  assert.equal(planWindows(tiles, [{ x0: 0, y0: 0, x1: 4096, y1: 4096 }], 63).tooLarge, true);
});

test('pinRanges keeps the planned tiles in the page until released', () => {
  const tiles = new MaskTiles({ width: 2048, height: 512, budget: LABEL_BYTES });
  tiles.set(0, 0, new Int32Array(TILE * TILE).fill(1), null); tiles.acknowledge([[0, 0]]);
  const release = pinRanges(tiles, [windowRange(tiles, { x0: 0, y0: 0, x1: 10, y1: 10 }, 0), windowRange(tiles, { x0: 0, y0: 0, x1: 600, y1: 10 }, 0)]);
  tiles.set(0, 1, new Int32Array(TILE * TILE).fill(2), null);            // over the budget: only clean, unpinned tiles may go
  assert.equal(tiles.state(0, 0), 'loaded');
  release();
  assert.equal(tiles.entries.get(0).pins, 0, 'each tile pinned once and unpinned once');
  tiles.acknowledge([[0, 1]]);
  assert.equal(tiles.state(0, 0), 'missing');
});

test('windowRgba and toWindowRect: the window sees the source pixels at its own coordinates, clipped at the section edge', () => {
  const { rgba, tiles, rgbaTiles } = section();
  const win = new EditWindow(tiles, windowRange(tiles, { x0: 1030, y0: 600, x1: W, y1: H }, 0));
  assert.deepEqual([win.ox, win.oy, win.w, win.h], [1024, 512, W - 1024, H - 512]);
  const pixels = windowRgba(win, (row, col) => rgbaTiles.get(row * tiles.cols + col));
  for (const [x, y] of [[1024, 512], [W - 1, H - 1], [1100, 700]]) {
    const j = ((y - win.oy) * win.w + x - win.ox) * 4, k = (y * W + x) * 4;
    assert.deepEqual([...pixels.subarray(j, j + 4)], [...rgba.subarray(k, k + 4)], `pixel ${x}, ${y}`);
  }
  assert.deepEqual(toWindowRect(win, { x0: 0, y0: 600, x1: 5000, y1: 700 }), { x0: 0, y0: 88, x1: W - 1024, y1: 188 });
  win.release();
});

test('lasso, wand and scissors on a window give exactly the whole image\'s result, shifted', () => {
  const { labels, rgba, tiles, rgbaTiles } = section(), roi = { x0: 0, y0: 0, x1: W, y1: H };
  // Lasso: a polygon across a tile seam.
  const polygon = [[450.5, 430.2], [700.3, 470.8], [650.1, 640.6], [480.9, 600.4]];
  const rect = { x0: 450, y0: 430, x1: 702, y1: 642 }, lassoWin = new EditWindow(tiles, windowRange(tiles, rect, 0));
  const lasso = polygonPixels(polygon.map(([x, y]) => [x - lassoWin.ox, y - lassoWin.oy]), lassoWin.w, toWindowRect(lassoWin, roi));
  assert.deepEqual(toSource(lassoWin, lasso), polygonPixels(polygon, W, roi).sort((a, b) => a - b));
  // Wand: the disc lies inside the window of the visible area.
  const visible = { x0: 400, y0: 300, x1: 900, y1: 700 }, wandWin = new EditWindow(tiles, windowRange(tiles, visible, 0));
  const wandRgba = windowRgba(wandWin, (row, col) => rgbaTiles.get(row * tiles.cols + col));
  const seed = [640, 500], whole = regionGrow(rgba, W, H, seed[1] * W + seed[0], 30, roi, null).sort((a, b) => a - b);
  const part = regionGrow(wandRgba, wandWin.w, wandWin.h, (seed[1] - wandWin.oy) * wandWin.w + seed[0] - wandWin.ox, 30, toWindowRect(wandWin, roi), wandWin.exclude);
  assert.ok(whole.length > 60000);
  assert.deepEqual(toSource(wandWin, part), whole);
  // Scissors: object 3 (box 470-619 x 480-559) cut by a vertical line at x 540-542.
  const cut = new Set(), box = [470, 480, 619, 559];
  for (let y = 470; y < 570; y++) for (let x = 540; x <= 542; x++) cut.add(y * W + x);
  const boxRect = { x0: 470, y0: 480, x1: 620, y1: 560 }, cutWin = new EditWindow(tiles, windowRange(tiles, boxRect, 0)), b = toWindowRect(cutWin, boxRect);
  const cutInWindow = new Set([...cut].map((i) => (Math.floor(i / W) - cutWin.oy) * cutWin.w + (i % W) - cutWin.ox));
  const a = splitPieces(labels, W, [null], box, 3, cut), c = splitPieces(cutWin.labels, cutWin.w, [null], [b.x0, b.y0, b.x1 - 1, b.y1 - 1], 3, cutInWindow);
  assert.equal(a.n, 2);
  assert.deepEqual([c.n, c.main, c.bw, [...c.comp]], [a.n, a.main, a.bw, [...a.comp]]);
  for (const w of [lassoWin, wandWin, cutWin]) w.release();
});
