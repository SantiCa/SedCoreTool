// Card M8.4.17: the row counts of a tiled section, counted tile by tile, equal `rowCounts` of the masks assembled whole.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TILE } from '../../app/js/tiledsection.js';
import { MaskTiles } from '../../app/js/tiledmasks.js';
import { rowCounts, binRows } from '../../app/js/core.js';
import { TiledRowCounts, TiledCountsRunner, tileHistogram, columnSpan, COUNT_HISTOGRAM_BYTES } from '../../app/js/tiledcounts.js';
import { allCases } from '../../tools/make_interval_fixtures.mjs';
import { computeSectionBins, binsFromRowCounts, binRowsOfSection, effectiveClassIndex } from '../../app/js/sectionanalysis.js';

/** A small seeded generator (mulberry32), so a failure can be repeated. */
function random(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Masks of w x h: rectangles of objects (some overlapping as stacks) and of exclusion; whole arrays and the same cut into tiles. */
function makeMasks(rand, w, h, { objects = 24, stacksCount = 6, rects = 40 } = {}) {
  const labels = new Int32Array(w * h), exclude = new Uint8Array(w * h);
  const stacks = [null];
  for (let k = 1; k <= stacksCount; k++) stacks.push([1 + Math.floor(rand() * objects), 1 + Math.floor(rand() * objects)]);
  for (let r = 0; r < rects; r++) {
    const x0 = Math.floor(rand() * w), y0 = Math.floor(rand() * h), x1 = Math.min(w, x0 + 1 + Math.floor(rand() * 700)), y1 = Math.min(h, y0 + 1 + Math.floor(rand() * 500));
    const kind = rand(), value = kind < 0.2 ? -(1 + Math.floor(rand() * stacksCount)) : kind < 0.3 ? 0 : 1 + Math.floor(rand() * objects);
    const into = rand() < 0.2 ? exclude : labels;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) into[y * w + x] = into === exclude ? (value === 0 ? 0 : 1) : value;
  }
  const tiles = new MaskTiles({ width: w, height: h, budget: Infinity });
  for (let row = 0; row < tiles.rows; row++) for (let col = 0; col < tiles.cols; col++) {
    const l = new Int32Array(TILE * TILE), e = new Uint8Array(TILE * TILE);
    for (let y = 0; y < TILE && row * TILE + y < h; y++) for (let x = 0; x < TILE && col * TILE + x < w; x++) {
      l[y * TILE + x] = labels[(row * TILE + y) * w + col * TILE + x]; e[y * TILE + x] = exclude[(row * TILE + y) * w + col * TILE + x];
    }
    tiles.set(row, col, l, e);
  }
  return { labels, exclude, stacks, tiles, w, h, objects };
}

const counter = (m) => new TiledRowCounts({ width: m.w, height: m.h, rows: m.tiles.rows, cols: m.tiles.cols },
  { nonEmpty: () => [...m.tiles.entries.keys()].filter((i) => { const e = m.tiles.entries.get(i); return e.labels || e.exclude; }) });
/** Count every needed tile now and ask for the row counts. */
function counts(c, m, runner, eff, nClasses, area) {
  c.setArea(area);
  assert.deepEqual(runner.flush(), [], 'every tile is in the page');
  return c.rowCounts({ effClass: eff, nClasses, stacks: m.stacks, area });
}
const whole = (m, eff, nClasses, area) => rowCounts({ labels: m.labels, width: m.w, roi: area, exclude: m.exclude, effClass: eff, nClasses, stacks: m.stacks });
const same = (a, b, message) => {
  assert.equal(a.nRows, b.nRows, message); assert.equal(a.nCols, b.nCols, message);
  assert.deepEqual([...a.valid], [...b.valid], message + ': valid'); assert.deepEqual([...a.bio], [...b.bio], message + ': bio'); assert.deepEqual([...a.cls], [...b.cls], message + ': cls');
};
const randomEff = (rand, objects, nClasses) => Int16Array.from({ length: objects + 1 }, (_, id) => (id === 0 || rand() < 0.2 ? -1 : Math.floor(rand() * nClasses)));

test('tileHistogram: nothing for an empty tile, nothing outside the columns, exclusion and labels per row otherwise', () => {
  const l = new Int32Array(TILE * TILE), e = new Uint8Array(TILE * TILE);
  assert.equal(tileHistogram(undefined, 0, 0, 1300, 1100, 0, 1300), null);
  assert.equal(tileHistogram({ labels: null, exclude: null }, 0, 0, 1300, 1100, 0, 1300), null);
  l[3] = 7; l[4] = 7; l[5] = -2; e[5] = 1; l[TILE + 1] = 9;                    // row 0: two of 7, one stack pixel excluded; row 1: one of 9
  const h = tileHistogram({ labels: l, exclude: e }, 0, 0, 1300, 1100, 0, 1300);
  assert.deepEqual([...h.excluded.subarray(0, 2)], [1, 0]);
  assert.deepEqual([...h.offsets.subarray(0, 3)], [0, 1, 2]);
  assert.deepEqual([[...h.labels], [...h.counts]], [[7, 9], [2, 1]], 'the excluded pixel is not counted as a label');
  assert.equal(tileHistogram({ labels: l, exclude: e }, 0, 0, 1300, 1100, 4, 1300).counts[0], 1, 'columns left of 4 are outside');
  assert.equal(tileHistogram({ labels: l, exclude: e }, 0, 0, 1300, 1100, 6, 7), null, 'columns 6 only: no label, no exclusion there');
  assert.deepEqual(columnSpan(2, 1300, 100, 1200), [1024, 1200]);
  assert.deepEqual(columnSpan(0, 1300, 600, 1200), [0, 0]);
});

test('seams: an object and a stack crossing tile borders in both directions, exclusion across a seam, an area not aligned with tiles', () => {
  const w = 1300, h = 1100, m = makeMasks(random(1), w, h, { rects: 0 });
  const paint = (arr, x0, y0, x1, y1, v) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) arr[y * w + x] = v; };
  paint(m.labels, 500, 500, 1030, 1030, 1);                                       // crosses the borders at 512 and 1024 in both directions
  paint(m.labels, 900, 100, 1100, 700, -1);                                       // a stack across a vertical seam
  paint(m.exclude, 0, 505, 1300, 520, 1);                                         // a band across a horizontal seam
  m.stacks.push([1, 2]);
  m.stacks[1] = [1, 2];
  // rebuild the tiles from the arrays
  const tiles = new MaskTiles({ width: w, height: h, budget: Infinity });
  for (let row = 0; row < tiles.rows; row++) for (let col = 0; col < tiles.cols; col++) {
    const l = new Int32Array(TILE * TILE), e = new Uint8Array(TILE * TILE);
    for (let y = 0; y < TILE && row * TILE + y < h; y++) for (let x = 0; x < TILE && col * TILE + x < w; x++) {
      l[y * TILE + x] = m.labels[(row * TILE + y) * w + col * TILE + x]; e[y * TILE + x] = m.exclude[(row * TILE + y) * w + col * TILE + x];
    }
    tiles.set(row, col, l, e);
  }
  m.tiles = tiles;
  const eff = Int16Array.from([-1, 0, 1]);
  for (const area of [{ x0: 0, y0: 0, x1: w, y1: h }, { x0: 37, y0: 311, x1: 1171, y1: 1003 }, { x0: 512, y0: 512, x1: 1024, y1: 1024 }]) {
    const c = counter(m), runner = new TiledCountsRunner({ tiles, counts: c });
    same(counts(c, m, runner, eff, 2, area), whole(m, eff, 2, area), JSON.stringify(area));
  }
});

test('random masks, classes, stacks, exclusion and areas: the tiled counts equal rowCounts exactly', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const rand = random(seed), w = 300 + Math.floor(rand() * 1300), h = 300 + Math.floor(rand() * 1100), m = makeMasks(rand, w, h);
    const nClasses = 1 + Math.floor(rand() * 4), eff = randomEff(rand, m.objects, nClasses);
    const x0 = Math.floor(rand() * w * 0.4), y0 = Math.floor(rand() * h * 0.4);
    const area = { x0, y0, x1: x0 + 1 + Math.floor(rand() * (w - x0)), y1: y0 + 1 + Math.floor(rand() * (h - y0)) };
    const c = counter(m), runner = new TiledCountsRunner({ tiles: m.tiles, counts: c });
    same(counts(c, m, runner, eff, nClasses, area), whole(m, eff, nClasses, area), `seed ${seed}`);
    const bins = (rc) => binRows(rc, { top: 0, bottom: 100, binPx: 37.3, minValid: 0.2 });
    assert.deepEqual(bins(c.rowCounts({ effClass: eff, nClasses, stacks: m.stacks, area })), bins(whole(m, eff, nClasses, area)), `seed ${seed}: bins`);
  }
});

test('edits, class changes, a new object, an area change and a recount of dropped tiles keep the counts exact', async () => {
  for (let seed = 21; seed <= 28; seed++) {
    const rand = random(seed), w = 600 + Math.floor(rand() * 900), h = 500 + Math.floor(rand() * 700), m = makeMasks(rand, w, h, { objects: 20 });
    const nClasses = 3;
    let eff = randomEff(rand, 20, nClasses), area = { x0: 20, y0: 15, x1: w - 30, y1: h - 25 };
    const c = counter(m), runner = new TiledCountsRunner({ tiles: m.tiles, counts: c });
    same(counts(c, m, runner, eff, nClasses, area), whole(m, eff, nClasses, area), `seed ${seed} first`);
    for (let step = 0; step < 6; step++) {
      const kind = step % 3;
      if (kind === 0) {                                                           // an edit of two tiles, a new object (the classes array grows)
        const row = Math.floor(rand() * m.tiles.rows), col = Math.floor(rand() * m.tiles.cols), touched = [[row, col], [row, Math.min(m.tiles.cols - 1, col + 1)]];
        const id = eff.length;
        eff = Int16Array.from([...eff, Math.floor(rand() * nClasses)]);
        for (const [r, cc] of touched) {
          const entry = m.tiles.get(r, cc), l = entry?.labels ? entry.labels.slice() : new Int32Array(TILE * TILE), e = entry?.exclude ? entry.exclude.slice() : new Uint8Array(TILE * TILE);
          for (let k = 0; k < 4000; k++) { const i = Math.floor(rand() * TILE * TILE); l[i] = rand() < 0.5 ? id : 1 + Math.floor(rand() * 20); if (rand() < 0.1) e[i] = 1 - e[i]; }
          m.tiles.set(r, cc, l, e);
          for (let y = 0; y < TILE && r * TILE + y < h; y++) for (let x = 0; x < TILE && cc * TILE + x < w; x++) {
            m.labels[(r * TILE + y) * w + cc * TILE + x] = l[y * TILE + x]; m.exclude[(r * TILE + y) * w + cc * TILE + x] = e[y * TILE + x];
          }
        }
        c.markChanged(touched);
      } else if (kind === 1) {                                                    // a reclassification: only the aggregation changes
        eff = Int16Array.from(eff, (v, id) => (id === 0 ? -1 : rand() < 0.3 ? Math.floor(rand() * nClasses) : v));
      } else {                                                                    // the area moves
        area = { x0: Math.floor(rand() * w * 0.3), y0: Math.floor(rand() * h * 0.3), x1: w - Math.floor(rand() * w * 0.3), y1: h - Math.floor(rand() * h * 0.3) };
      }
      same(counts(c, m, runner, eff, nClasses, area), whole(m, eff, nClasses, area), `seed ${seed} step ${step}`);
    }
    // an erased tile leaves the totals
    const [row, col] = [0, 0];
    m.tiles.set(row, col, null, null);
    for (let y = 0; y < Math.min(TILE, h); y++) for (let x = 0; x < Math.min(TILE, w); x++) { m.labels[y * w + x] = 0; m.exclude[y * w + x] = 0; }
    c.markChanged([[row, col]]);
    same(counts(c, m, runner, eff, nClasses, area), whole(m, eff, nClasses, area), `seed ${seed} erased`);
  }
});

test('tiles the page dropped are read back only when the area columns change; the counts need no read for anything else', async () => {
  const rand = random(77), w = 1300, h = 1100, m = makeMasks(rand, w, h), nClasses = 2, eff = randomEff(rand, 24, nClasses);
  const reads = [];
  const stored = new MaskTiles({ width: w, height: h, budget: Infinity });
  const c = new TiledRowCounts({ width: w, height: h, rows: m.tiles.rows, cols: m.tiles.cols },
    { nonEmpty: () => [...new Set([...stored.entries.keys(), ...stored.stored])] });
  for (const [i, entry] of m.tiles.entries) stored.set(Math.floor(i / stored.cols), i % stored.cols, entry.labels, entry.exclude);
  stored.acknowledge([...m.tiles.entries.keys()].map((i) => [Math.floor(i / stored.cols), i % stored.cols]));
  const runner = new TiledCountsRunner({ tiles: stored, counts: c, loadMasks: async (positions) => {
    reads.push(positions.length);
    for (const [r, cc] of positions) { const e = m.tiles.get(r, cc); stored.set(r, cc, e.labels, e.exclude, { dirty: false }); }
  } });
  let area = { x0: 0, y0: 0, x1: w, y1: h };
  c.setArea(area); await runner.start();
  assert.ok(c.ready);
  same(c.rowCounts({ effClass: eff, nClasses, stacks: m.stacks, area }), whole(m, eff, nClasses, area), 'first');
  for (const [i] of [...stored.entries]) stored.entries.delete(i), stored.bytes = 0;                      // the page drops every tile
  reads.length = 0;
  const eff2 = Int16Array.from(eff, (v, id) => (id === 0 ? -1 : (v + 1) % nClasses));
  c.setArea(area);
  same(c.rowCounts({ effClass: eff2, nClasses, stacks: m.stacks, area }), whole(m, eff2, nClasses, area), 'classes changed');
  area = { ...area, y0: 100, y1: 900 };
  c.setArea(area);
  same(c.rowCounts({ effClass: eff2, nClasses, stacks: m.stacks, area }), whole(m, eff2, nClasses, area), 'rows changed');
  assert.deepEqual(reads, [], 'no tile was read for a class or row change');
  area = { x0: 300, y0: 100, x1: 1100, y1: 900 };
  assert.equal(c.setArea(area), true);
  assert.throws(() => c.rowCounts({ effClass: eff2, nClasses, stacks: m.stacks, area }), /still to count/);
  await runner.start();
  assert.ok(reads.length > 0 && reads.every((n) => n <= 16));
  same(c.rowCounts({ effClass: eff2, nClasses, stacks: m.stacks, area }), whole(m, eff2, nClasses, area), 'columns changed, tiles read back');
});

test('a stack code that changes members would corrupt the counts: the stack table of a tiled section only grows', async () => {
  const { codeFor } = await import('../../app/js/core.js');
  const stacks = [null], index = new Map();
  const a = codeFor([1, 2], stacks, index), b = codeFor([2, 3], stacks, index), again = codeFor([1, 2], stacks, index);
  assert.deepEqual([a, again, stacks[-a], stacks[-b]], [a, a, [1, 2], [2, 3]], 'a code keeps its members and is reused');
});

test('every interval fixture case, cut into tiles and counted tile by tile, gives exactly the table of the whole-image calculation', () => {
  let multiTile = 0;
  for (const { name, section, project } of allCases()) {
    const tiles = new MaskTiles({ width: section.w, height: section.h, budget: Infinity });
    for (let row = 0; row < tiles.rows; row++) for (let col = 0; col < tiles.cols; col++) {
      const l = new Int32Array(TILE * TILE), e = new Uint8Array(TILE * TILE);
      for (let y = 0; y < TILE && row * TILE + y < section.h; y++) for (let x = 0; x < TILE && col * TILE + x < section.w; x++) {
        l[y * TILE + x] = section.labels[(row * TILE + y) * section.w + col * TILE + x]; e[y * TILE + x] = section.exclude[(row * TILE + y) * section.w + col * TILE + x];
      }
      tiles.set(row, col, l, e);
    }
    if (tiles.rows * tiles.cols > 1) multiTile++;
    const c = new TiledRowCounts({ width: section.w, height: section.h, rows: tiles.rows, cols: tiles.cols }, { nonEmpty: () => tiles.entries.keys() });
    const runner = new TiledCountsRunner({ tiles, counts: c }), area = section.roi;
    c.setArea(area); assert.deepEqual(runner.flush(), []);
    const rc = c.rowCounts({ effClass: effectiveClassIndex(section, project.classes, project.settings), nClasses: project.classes.length, stacks: section.stacks, area });
    const tiled = binsFromRowCounts(section, rc, project, binRowsOfSection(section, project.settings));
    assert.deepEqual(tiled, computeSectionBins(section, project).bins, name);
  }
  assert.ok(multiTile >= 4, 'cases larger than one tile are included: ' + multiTile);
});

test('card M8.4.36: beyond the budget the histograms are dropped, nothing more is kept, and the table is refused until the section is opened again', () => {
  const width = 8 * TILE, height = 8 * TILE, grid = { width, height, rows: 8, cols: 8 };
  const counts = new TiledRowCounts(grid, { nonEmpty: () => Array.from({ length: 64 }, (_, i) => i) });
  counts.setArea({ x0: 0, y0: 0, x1: width, y1: height });
  // A tile whose every row holds 512 different labels: its histogram takes about 1.5 MiB, more than the labels themselves.
  const noisy = (seed) => { const labels = new Int32Array(TILE * TILE); for (let i = 0; i < labels.length; i++) labels[i] = 1 + ((i * 2654435761 + seed) >>> 0) % 65535; return { labels, exclude: null }; };
  const first = tileHistogram(noisy(1), 0, 0, width, height, 0, width);
  assert.ok(first.bytes > 1.4 * 2 ** 20, 'one noisy tile: ' + first.bytes);
  let peak = 0, committed = 0;
  for (let tile = 0; tile < 64; tile++) {
    counts.commit(tile, tileHistogram(noisy(tile), Math.floor(tile / 8), tile % 8, width, height, 0, width));
    committed++; peak = Math.max(peak, counts.bytes);
    if (counts.exceeded) break;
  }
  assert.ok(counts.exceeded && counts.overBudget, 'the budget was exceeded after ' + committed + ' tiles');
  assert.ok(peak <= COUNT_HISTOGRAM_BYTES + 2 * 2 ** 20, 'never more than the budget and one tile: ' + peak);
  assert.deepEqual([counts.bytes, counts.hists.size, counts.fresh.size], [0, 0, 0], 'everything dropped');
  for (let tile = committed; tile < 64; tile++) counts.commit(tile, tileHistogram(noisy(tile), Math.floor(tile / 8), tile % 8, width, height, 0, width));
  assert.deepEqual([counts.bytes, counts.fresh.size], [0, 0], 'later tiles are not kept');
  counts.markChanged([[0, 0]]);
  assert.equal(counts.setArea({ x0: 0, y0: 0, x1: width / 2, y1: height }), false, 'nothing to count after an edit or an area change');
  assert.ok(counts.ready && counts.snapshot() === null, 'no reopening cache from such a state');
  counts.restore([0, width], new Map([[0, tileHistogram({ labels: new Int32Array(TILE * TILE).fill(3), exclude: null }, 0, 0, width, height, 0, width)]]));
  assert.equal(counts.overBudget, false, 'a section opened again starts within the budget');
});
