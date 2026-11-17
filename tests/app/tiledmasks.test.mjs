// Card M8.4.16 step 2: the page's mask tiles of tiled sections, the reduced overview masks and the overlay painted over pixel tiles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MaskTiles, reduceTile, axisMap, paintOverlay, isEmptyLayer, LABEL_BYTES, EXCLUDE_BYTES } from '../../app/js/tiledmasks.js';
import { TILE } from '../../app/js/tiledsection.js';

const N = TILE * TILE;
const labelsWith = (value) => { const a = new Int32Array(N); a[7] = value; return a; };

test('mask tiles: layers that are all zero take no memory and empty positions need no read', () => {
  const tiles = new MaskTiles({ width: 1300, height: 1100 });
  assert.deepEqual([tiles.rows, tiles.cols], [3, 3]);
  assert.equal(tiles.state(2, 2), 'empty');
  tiles.set(0, 0, new Int32Array(N), new Uint8Array(N));
  assert.equal(tiles.bytes, 0);
  assert.deepEqual(tiles.get(0, 0), { labels: null, exclude: null, dirty: true, pins: 0, bytes: 0 });
  assert.equal(tiles.hasContent(), false);
  const exclude = new Uint8Array(N); exclude[9] = 1;
  tiles.set(0, 1, labelsWith(3), exclude);
  assert.equal(tiles.bytes, LABEL_BYTES + EXCLUDE_BYTES);
  assert.equal(tiles.hasContent(), true);
  assert.throws(() => tiles.state(3, 0)); assert.throws(() => tiles.set(0, 0, new Int32Array(5), null)); assert.throws(() => tiles.get(0, -1));
  assert.ok(isEmptyLayer(null) && isEmptyLayer(new Uint8Array(3)) && !isEmptyLayer(Uint8Array.of(0, 1)));
});

test('mask tiles: a dirty or pinned tile is never dropped; clean tiles go least recently used first', () => {
  const tiles = new MaskTiles({ width: 6 * TILE, height: TILE, budget: 2 * LABEL_BYTES });
  assert.deepEqual(tiles.set(0, 0, labelsWith(1), null), []);                       // dirty
  assert.deepEqual(tiles.set(0, 1, labelsWith(2), null, { dirty: false }), []);
  assert.deepEqual(tiles.set(0, 2, labelsWith(3), null, { dirty: false }), [[0, 1]]);   // over budget: the oldest clean tile goes
  tiles.pin(0, 2);
  assert.deepEqual(tiles.set(0, 3, labelsWith(4), null), []);                       // dirty and pinned stay, even over the budget
  assert.equal(tiles.bytes, 3 * LABEL_BYTES);
  tiles.unpin(0, 2);
  assert.deepEqual(tiles.evict(), [[0, 2]]);
  assert.deepEqual(tiles.dirtyPositions(), [[0, 0], [0, 3]]);
  assert.equal(tiles.state(0, 1), 'empty');                                         // never acknowledged as stored
});

test('mask tiles: acknowledged tiles become clean and, when dropped, are known to be stored in the engine', () => {
  const tiles = new MaskTiles({ width: 4 * TILE, height: TILE, budget: LABEL_BYTES });
  tiles.set(0, 0, labelsWith(1), null);
  tiles.set(0, 1, new Int32Array(N), null);                                        // an erased tile: dirty, empty
  assert.deepEqual(tiles.acknowledge([[0, 0], [0, 1], [0, 2]]), []);
  assert.deepEqual(tiles.dirtyPositions(), []);
  tiles.set(0, 2, labelsWith(2), null);
  assert.equal(tiles.state(0, 0), 'missing');                                       // dropped for the budget, readable again from the engine
  assert.equal(tiles.state(0, 1), 'loaded');
  tiles.set(0, 1, labelsWith(5), null);
  tiles.acknowledge([[0, 1]]);
  tiles.set(0, 1, null, null);
  tiles.acknowledge([[0, 1]]);
  assert.equal(tiles.stored.has(1), false);                                         // erased and acknowledged: no longer stored
});

test('mask tiles: a tile read from the engine never replaces an edit that is not acknowledged', () => {
  const tiles = new MaskTiles({ width: TILE, height: TILE });
  const edited = labelsWith(9);
  tiles.set(0, 0, edited, null);
  assert.deepEqual(tiles.set(0, 0, labelsWith(1), null, { dirty: false }), []);
  assert.equal(tiles.get(0, 0).labels, edited);
  assert.equal(tiles.get(0, 0).dirty, true);
});

/** A full-resolution mask cut into tiles as the store keeps them. */
function cut(width, height, full, Type) {
  const rows = Math.ceil(height / TILE), cols = Math.ceil(width / TILE), out = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const tile = new Type(N);
      for (let y = 0; y < TILE && row * TILE + y < height; y++) for (let x = 0; x < TILE && col * TILE + x < width; x++) tile[y * TILE + x] = full[(row * TILE + y) * width + col * TILE + x];
      out.push({ row, col, tile });
    }
  }
  return out;
}

function randomMasks(width, height, seed = 1) {
  let state = seed;
  const random = () => { state = (state * 1103515245 + 12345) >>> 0; return state / 2 ** 32; };
  const labels = new Int32Array(width * height), exclude = new Uint8Array(width * height);
  for (let n = 0; n < 40; n++) {                                     // rectangles of objects 1..6 and overlaps (-1, -2)
    const x0 = Math.floor(random() * width), y0 = Math.floor(random() * height), w = 1 + Math.floor(random() * 300), h = 1 + Math.floor(random() * 300);
    const id = [1, 2, 3, 4, 5, 6, -1, -2][Math.floor(random() * 8)];
    for (let y = y0; y < Math.min(height, y0 + h); y++) for (let x = x0; x < Math.min(width, x0 + w); x++) labels[y * width + x] = id;
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if ((x * 7 + y * 3) % 211 < 9) exclude[y * width + x] = 1;
  return { labels, exclude };
}

test('reduceTile: each working pixel takes the source pixel at its top-left, tile by tile', () => {
  const width = 1300, height = 1100;
  const { labels, exclude } = randomMasks(width, height);
  for (const ds of [1, 2, 4, 1024]) {
    const w = Math.ceil(width / ds), h = Math.ceil(height / ds);
    const working = { w, h, labels: new Int32Array(w * h).fill(-99), exclude: new Uint8Array(w * h).fill(7) };
    const labelTiles = cut(width, height, labels, Int32Array), excludeTiles = cut(width, height, exclude, Uint8Array);
    labelTiles.forEach(({ row, col, tile }, i) => reduceTile(working, ds, row, col, tile, excludeTiles[i].tile));
    for (let wy = 0; wy < h; wy++) {
      for (let wx = 0; wx < w; wx++) {
        assert.equal(working.labels[wy * w + wx], labels[wy * ds * width + wx * ds]);
        assert.equal(working.exclude[wy * w + wx], exclude[wy * ds * width + wx * ds]);
      }
    }
    reduceTile(working, ds, 0, 0, null, null);                       // an erased tile clears its working pixels
    assert.equal(working.labels[0], 0); assert.equal(working.exclude[0], 0);
  }
});

test('axisMap: tile and offset of every screen pixel, outside the image or the grid marked -1', () => {
  const m = axisMap(6, 1020.2, 1.5, 1300, 1, 2, TILE);              // source x = floor(1020.2 + (s + 0.5) * 1.5): 1020, 1022, 1023, 1025, 1026, 1028
  assert.deepEqual([...m.tile], [0, 0, 0, 1, 1, 1]);
  assert.deepEqual([...m.off], [508, 510, 511, 1, 2, 4]);
  const edge = axisMap(3, 1298, 1, 1300, 0, 3, TILE, 1);           // the neighbour one pixel after: 1299, then outside
  assert.deepEqual([...edge.tile], [2, -1, -1]);
  assert.deepEqual([...axisMap(2, -1.5, 1, 1300, 0, 3, TILE).tile], [-1, 0]);
  assert.deepEqual([...axisMap(2, 0, 1, 1300, 1, 2, TILE).tile], [-1, -1]);   // left of the grid
});

/** The colour tables of rebuildLUT for 7 ids: 1-2 labelled, 3 predicted (dashed edges), 4 hidden, 5-6 labelled; 2 selected, 5 in the selection. */
function style() {
  const fill = new Uint8ClampedArray(8 * 4), line = new Uint8ClampedArray(8 * 4), sty = new Uint8Array(8);
  const colours = [[0, 0, 0], [230, 60, 40], [40, 200, 90], [80, 120, 250], [255, 255, 0], [200, 100, 220], [20, 220, 220]];
  colours.forEach(([r, g, b], id) => {
    if (!id) return;
    const alpha = id === 3 ? 0.4 * 0.45 : 0.4;
    fill.set([r, g, b, Math.round(alpha * 255)], id * 4); line.set([r, g, b, 255], id * 4);
  });
  sty[3] = 1; sty[4] = 3;
  const inSel = new Uint8Array(8); inSel[5] = 1;
  return { fill, line, sty, stacks: [[], [1, 3], [5, 6, 2]], selected: 2, inSel };
}

/** What render() in app.js computes for one pixel of a whole (not tiled) image: a copy of its loop body for masks and exclusion. */
function renderPixel(base, labels, exclude, width, height, ix, iy, sx, sy, step, st) {
  const own = (w, id) => w === id || (w < 0 && st.stacks[-w].includes(id));
  const i = iy * width + ix, v = labels[i], list = v < 0 ? st.stacks[-v] : null;
  let [r, g, b] = base;
  for (let q = 0, n = list ? list.length : v ? 1 : 0; q < n; q++) {
    const id = list ? list[q] : v; if (st.sty[id] === 3) continue;
    const k = id * 4, a = st.fill[k + 3] / 255;
    if (a) { r += (st.fill[k] - r) * a; g += (st.fill[k + 1] - g) * a; b += (st.fill[k + 2] - b) * a; }
    const edge = (ix < step || !own(labels[i - step], id)) || (ix + step >= width || !own(labels[i + step], id)) ||
      (iy < step || !own(labels[i - step * width], id)) || (iy + step >= height || !own(labels[i + step * width], id));
    if (edge) {
      if (id === st.selected || st.inSel[id]) { r = 255; g = 255; b = 255; }
      else if (st.sty[id] !== 1 || ((sx + sy) & 4)) { r = st.line[k]; g = st.line[k + 1]; b = st.line[k + 2]; }
    }
  }
  if (exclude[i]) { if (((sx + sy) & 7) < 2) { r = r * 0.3 + 70; g = g * 0.3 + 70; b = b * 0.3 + 80; } else { r *= 0.55; g *= 0.55; b *= 0.55; } }
  return [r, g, b];
}

test('paintOverlay: the masks drawn over the pixels give what render() computes, across tile seams and at every edge step', () => {
  // Tolerance, stated before comparing: 2 levels per channel. The layer stores its colour and alpha as 8-bit values (each rounded by at most
  // 0.5, together at most 1 level after compositing) and the composite itself is rounded once more (at most 1).
  const width = 1300, height = 1100, st = style();
  const { labels, exclude } = randomMasks(width, height, 7);
  const labelTiles = cut(width, height, labels, Int32Array), excludeTiles = cut(width, height, exclude, Uint8Array);
  for (const [origin, scale] of [[[500, 480], 1], [[1000, 1000], 0.5], [[0, 0], 2], [[900, 300], 1.75]]) {
    const step = Math.max(1, Math.round(scale)), cw = 160, ch = 120;
    const grid = { r0: 0, c0: 0, rows: 3, cols: 3 };
    const axis = (o, extent, first, count) => ({ at: axisMap(o.n, o.origin, scale, extent, first, count, TILE), before: axisMap(o.n, o.origin, scale, extent, first, count, TILE, -step),
      after: axisMap(o.n, o.origin, scale, extent, first, count, TILE, step) });
    const xs = axis({ n: cw, origin: origin[0] }, width, grid.c0, grid.cols), ys = axis({ n: ch, origin: origin[1] }, height, grid.r0, grid.rows);
    const out = new Uint8ClampedArray(cw * ch * 4);
    paintOverlay({ out, cw, ch, xs, ys, gridCols: grid.cols, stride: TILE, labels: labelTiles.map((t) => t.tile), exclude: excludeTiles.map((t) => t.tile), style: st });
    let checked = 0, masked = 0;
    for (let sy = 0; sy < ch; sy++) {
      for (let sx = 0; sx < cw; sx++) {
        const ix = Math.floor(origin[0] + (sx + 0.5) * scale), iy = Math.floor(origin[1] + (sy + 0.5) * scale);
        if (ix >= width || iy >= height) { assert.equal(out[(sy * cw + sx) * 4 + 3], 0); continue; }
        const base = [(ix * 13) & 255, (iy * 7) & 255, 128];
        const expected = renderPixel(base, labels, exclude, width, height, ix, iy, sx, sy, step, st);
        const o = (sy * cw + sx) * 4, a = out[o + 3] / 255;
        const drawn = [0, 1, 2].map((c) => Math.round(base[c] * (1 - a) + out[o + c] * a));
        for (let c = 0; c < 3; c++) assert.ok(Math.abs(drawn[c] - Math.round(expected[c])) <= 2, `pixel ${sx},${sy} (${ix},${iy}) channel ${c}: ${drawn} vs ${expected}`);
        checked++; if (a) masked++;
      }
    }
    assert.ok(checked > 10000 && masked > 2000, `${checked} pixels, ${masked} with masks`);
  }
});

test('paintOverlay: the working image as one tile (the overview between full resolution and the working image)', () => {
  const width = 300, height = 200, st = style(), { labels, exclude } = randomMasks(width, height, 3);
  const cw = 90, ch = 70, scale = 1 / 3, origin = [12.4, 40.1];
  const axis = (n, o, extent, delta = 0) => axisMap(n, o, scale, extent, 0, 1, extent, delta);
  const xs = { at: axis(cw, origin[0], width), before: axis(cw, origin[0], width, -1), after: axis(cw, origin[0], width, 1) };
  // Rows: one tile of `height` rows, offsets multiplied by the stride (the working width).
  const ys = { at: axis(ch, origin[1], height), before: axis(ch, origin[1], height, -1), after: axis(ch, origin[1], height, 1) };
  const out = new Uint8ClampedArray(cw * ch * 4);
  paintOverlay({ out, cw, ch, xs, ys, gridCols: 1, stride: width, labels: [labels], exclude: [exclude], style: st });
  for (let sy = 0; sy < ch; sy++) {
    for (let sx = 0; sx < cw; sx++) {
      const ix = Math.floor(origin[0] + (sx + 0.5) * scale), iy = Math.floor(origin[1] + (sy + 0.5) * scale);
      const base = [90, 90, 90], expected = renderPixel(base, labels, exclude, width, height, ix, iy, sx, sy, 1, st);
      const o = (sy * cw + sx) * 4, a = out[o + 3] / 255;
      for (let c = 0; c < 3; c++) assert.ok(Math.abs(Math.round(base[c] * (1 - a) + out[o + c] * a) - Math.round(expected[c])) <= 2);
    }
  }
});
