// Card M8.4.37: the per-tile statistics of the objects of a tiled section have a memory budget (`STATS_BUDGET_BYTES`), with the behaviour of the row
// histograms' budget (card M8.4.36): beyond it they are all dropped, none is kept until the section is opened again, the page says that the objects'
// measurements are not available, and no reopening cache is written from such a state. Under the budget nothing changes (the equality of the per-tile
// totals with `objectStats` over the whole image is the test of tiledit.test.mjs, unchanged).
import test from 'node:test';
import assert from 'node:assert/strict';
import { TILE } from '../../app/js/tiledsection.js';
import { MaskTiles } from '../../app/js/tiledmasks.js';
import { TiledObjectStats, TiledStatsRunner, STATS_BUDGET_BYTES, STATS_SPLIT_MARGIN, STATS_SPLIT_MAX_PARTS, estimateSectionStatsBytes, partsToFitStats, STATS_ENTRY_BYTES, STATS_OBJECT_BYTES, tileStats } from '../../app/js/tiledit.js';
import { objectsTable } from '../../app/js/exportio.js';
import { t } from '../../app/js/i18n.js';
import { S } from '../../app/js/state.js';

const { createTiledState } = await import('../../app/js/tiledstate.js');
const { createTiledProject } = await import('../../app/js/tiledproject.js');
const { createTiledTools } = await import('../../app/js/tiledtools.js');
const { createHash } = await import('node:crypto');
const sha256 = async (bytes) => createHash('sha256').update(bytes).digest('hex');

const SAMPLE = { n: 4, sx: 1, sy: 1, sxx: 1, syy: 1, sxy: 1, x0: 0, x1: 1, y0: 0, y1: 1, per: 4, sL: 1, sLL: 1, sA: 0, sB: 0, rL: 0, rN: 0 };
/** The statistics of a tile holding `count` objects from `first` on (one shared record: the test measures the estimate, not the heap). */
const denseTile = (first, count) => new Map(Array.from({ length: count }, (_, k) => [first + k, SAMPLE]));

test('card M8.4.37: beyond the budget the statistics are all dropped, the page is told once, and nothing more is kept until the section is opened again', () => {
  let told = 0;
  const stats = new TiledObjectStats({ onExceeded: () => { told++; } });
  // As the synthetic section of M8.4.18d: about 64,300 of 65,535 objects in every tile (10 MB of statistics per tile by the estimate).
  const perTile = 64_300, oneTile = perTile * STATS_ENTRY_BYTES + 65_535 * STATS_OBJECT_BYTES;
  let peak = 0, kept = 0, changedAtTrip = null;
  for (let tile = 0; tile < 64; tile++) {
    const changed = stats.replaceTile(tile, denseTile(1 + (tile * 997) % 1235, perTile));
    peak = Math.max(peak, stats.bytes);
    if (stats.exceeded) { changedAtTrip = changed; break; }
    kept++;
    assert.equal(changed.size, perTile, 'under the budget: every object of the tile is reported');
  }
  assert.ok(stats.exceeded, 'the budget was exceeded after ' + kept + ' tiles');
  assert.ok(kept >= 20 && kept <= 30, 'about 26 tiles of the synthetic section fit: ' + kept);
  assert.ok(peak <= STATS_BUDGET_BYTES + oneTile, 'never more than the budget and one tile: ' + peak);
  assert.equal(told, 1, 'the page is told once');
  assert.deepEqual([stats.bytes, stats.byTile.size, stats.tilesOf.size], [0, 0, 0], 'everything dropped');
  assert.equal(changedAtTrip.size, 0, 'no object is reported when the statistics are dropped (it would be taken for an object without pixels)');
  assert.equal(stats.total(1), null);
  assert.equal(stats.replaceTile(0, denseTile(1, 10)).size, 0, 'a later tile is not kept');
  assert.deepEqual([stats.bytes, stats.byTile.size, told], [0, 0, 1]);
  assert.equal(new TiledObjectStats().exceeded, false, 'a section opened again starts within the budget');
});

test('card M8.4.37: the estimate counts tiles, entries and objects, and follows replacements', () => {
  const stats = new TiledObjectStats();
  stats.replaceTile(0, denseTile(1, 10));
  const one = stats.bytes;
  assert.ok(one >= 10 * (STATS_ENTRY_BYTES + STATS_OBJECT_BYTES), String(one));
  stats.replaceTile(1, denseTile(1, 10));                          // the same objects in a second tile: entries, no new object
  assert.equal(stats.bytes - one, one - 10 * STATS_OBJECT_BYTES);
  stats.replaceTile(1, new Map());
  assert.equal(stats.bytes, one, 'an emptied tile gives its memory back');
  stats.replaceTile(0, new Map());
  assert.equal(stats.bytes, 0);
});

/** A section of rows x cols tiles, each with its own small object, and a runner over statistics with a budget of `tiles` tiles. */
function budgetSection(rows, cols, fitTiles) {
  const tiles = new MaskTiles({ width: cols * TILE, height: rows * TILE }), all = /** @type {[number, number][]} */ ([]);
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const labels = new Int32Array(TILE * TILE); for (let y = 10; y < 20; y++) labels.fill(1 + row * cols + col, y * TILE + 10, y * TILE + 40);
    tiles.set(row, col, labels, null); all.push([row, col]);
  }
  const oneTile = 128 + STATS_ENTRY_BYTES + STATS_OBJECT_BYTES, updates = [], told = [];
  const stats = new TiledObjectStats({ budget: fitTiles * oneTile, onExceeded: () => told.push(updates.length) });
  const runner = new TiledStatsRunner({ tiles, stats, stacks: () => [null], onUpdate: (ids) => updates.push(...[...ids].map((id) => [id, stats.total(id)])),
    fetchRgba: async (positions) => positions.map(() => new Uint8ClampedArray(TILE * TILE * 4).fill(60)) });
  return { tiles, stats, runner, all, updates, told };
}

test('card M8.4.37: the statistics runner stops when the budget is exceeded, never reports an object as having no pixels, and releases whoever waits', async () => {
  const { stats, runner, all, updates, told } = budgetSection(3, 3, 4);
  const running = runner.queue(all, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const waiting = runner.prioritise(all);                          // waits for every tile: only the stop can release it
  await running;
  assert.equal(await Promise.race([waiting.then(() => true), new Promise((r) => setTimeout(() => r(false), 500))]), true, 'a caller waiting for tiles is released');
  assert.ok(stats.exceeded && told.length === 1, 'exceeded at the fifth tile');
  assert.ok(updates.every(([, total]) => total), 'every report has a total: none would delete an object');
  assert.ok(runner.idle && runner.stopped && runner.rgba.size === 0, 'nothing waits, no pixels kept');
  const reported = updates.length;
  await runner.queue([[0, 0]], [1]);
  assert.equal(updates.length, reported, 'an edit afterwards computes and reports nothing');
  // Control: the same section within the budget computes every tile, with the totals of an unbounded computation.
  const within = budgetSection(3, 3, 100), source = { width: 3 * TILE, height: 3 * TILE, stacks: [null], labelsAt: (r, c) => within.tiles.get(r, c)?.labels || null,
    rgbaAt: () => new Uint8ClampedArray(TILE * TILE * 4).fill(60) };
  await within.runner.queue(within.all);
  assert.ok(!within.stats.exceeded);
  for (const [row, col] of within.all) assert.deepEqual(within.stats.total(1 + row * 3 + col), tileStats(source, row, col).get(1 + row * 3 + col));
});

/** The page's state of one tiled section with three objects whose statistics were computed. */
function pageSection() {
  const toasts = [], changes = [];
  const state = createTiledState(/** @type {any} */ ({ TILES: null, TILES_ONLY: ['tiles'], toast: (text) => toasts.push(text), afterChange: (s, tables) => changes.push(tables),
    analysisProject: () => ({}), analyze: () => {}, effClassArray: () => [], renderResults: () => {}, requestRender: () => {}, sourceBox: () => null, sourceRoi: () => null }));
  const objects = new Map([1, 2, 3].map((id) => [id, { id, cls: 'c0', stats: { ...SAMPLE }, feat: { areaCm2: 1, cy: 3 }, area: 4, bbox: [0, 0, 1, 1], sbox: [0, 0, 1, 1] }]));
  const s = { id: 'q', name: 'tiled', objects, stacks: [null], maskTiles: new MaskTiles({ width: TILE, height: TILE }) };
  return { state, s, toasts, changes };
}

test('card M8.4.37: when the statistics are dropped every object of the section loses its measurements and box, and the page says so', () => {
  const { state, s, toasts, changes } = pageSection();
  S.sections = /** @type {any} */ ([s]); S.cores = /** @type {any} */ ([{ sections: S.sections }]); S.cur = 0;
  const runner = state.tiledStatsRunner(s);
  runner.stats.exceed();
  for (const o of s.objects.values()) assert.deepEqual([o.stats, o.feat, o.area, o.bbox, o.sbox], [null, null, 0, null, null], 'object ' + o.id);
  assert.equal(s.objects.size, 3, 'no object is deleted');
  assert.deepEqual(toasts, [t('tiles.statsLimit', { n: 2 })]);
  assert.deepEqual(changes, [['tiles']], 'the page redraws the section (tiles only: nothing to send)');
  // The objects table keeps the rows, with depths and measurements empty, and the operations that need a box say why they cannot run.
  const rows = objectsTable([...s.objects.values()].map((o) => ({ section: s.name, units: 'cm', o, status: 'manual', counted: true, depth: (r) => r, unavailable: true })));
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[1].slice(6, 9).concat(rows[1].slice(10, 18)), Array(11).fill(null));
  const tools = createTiledTools(/** @type {any} */ ({ toast: (text) => toasts.push(text), sourceBox: () => null, maskLoader: () => ({ want: async () => {} }) }));
  assert.equal(tools.tiledPlan(/** @type {any} */ ({ ...s, frozen: null, _statsRunner: runner }), [null]), null);
  assert.equal(toasts.at(-1), t('tiles.statsLimit', { n: 2 }), 'not "try again in a moment": it would never succeed');
});

test('card M8.4.37: no reopening cache is written for a section whose statistics were dropped', async () => {
  const puts = [], width = TILE, height = TILE, manifest = 'b7'.repeat(32);
  const TILES = { maskRetain: async () => ({ ok: {} }), derivedPut: async (...args) => { puts.push(args); return { ok: {} }; } };
  const project = createTiledProject(/** @type {any} */ ({ TILES, settleDeadlineMs: 1000, toast: () => {}, hexDigest: sha256, storeProject: (id) => id }));
  const stats = new TiledObjectStats();
  const counts = { ready: true, snapshot: () => ({ columns: [0, width], hists: new Map() }) };
  const q = { tiled: { pyramid: 'e'.repeat(64) }, frozen: null, ds: 1, w: width, h: height, labels: new Int32Array(width * height), exclude: new Uint8Array(width * height),
    maskTiles: new MaskTiles({ width, height }), _savedRecord: { tiled: { manifest, width, height, source: { sha256: 'e'.repeat(64) } } },
    _maskSync: { settled: true, manifest }, _statsRunner: { idle: true, failed: new Set(), stats }, _counts: { counts } };
  S.id = 'p'; S.cores = /** @type {any} */ ([{ sections: [q] }]); S.sections = S.cores[0].sections; S.cur = 0;
  await project.retainStore();
  assert.equal(puts.length, 1, 'control: the cache of a section whose statistics are kept is written');
  q._reopenCached = null;
  stats.exceed();
  await project.retainStore();
  assert.equal(puts.length, 1, 'none after the statistics were dropped');
});

test('card M8.4.41: the estimate of the whole section is the counted bytes per tile times the tiles that hold labels, never below what was counted', () => {
  assert.equal(estimateSectionStatsBytes({ bytesCounted: 300, tilesCounted: 3, labelledTiles: 30 }), 3000, 'dense: ten times the tiles counted');
  assert.equal(estimateSectionStatsBytes({ bytesCounted: 300, tilesCounted: 3, labelledTiles: 3 }), 300, 'sparse: all tiles already counted');
  assert.equal(estimateSectionStatsBytes({ bytesCounted: 300, tilesCounted: 3, labelledTiles: 1 }), 300, 'never below what was counted');
  assert.equal(estimateSectionStatsBytes({ bytesCounted: 500, tilesCounted: 1, labelledTiles: 10 }), 5000, 'a trip on the first tile');
  assert.equal(estimateSectionStatsBytes({ bytesCounted: 500, tilesCounted: 0, labelledTiles: 10 }), 500, 'no tile counted: the bytes');
});

test('card M8.4.41: the parts to fit the statistics keep each within 80 % of the budget, 2 at least, and null beyond 8', () => {
  const B = 1000, limit = B * STATS_SPLIT_MARGIN;       // 800
  assert.equal(STATS_SPLIT_MAX_PARTS, 8);
  assert.equal(partsToFitStats(1, B), 2, 'a tiny estimate still asks for 2');
  assert.equal(partsToFitStats(limit - 1, B), 2);
  assert.equal(partsToFitStats(limit * 2, B), 2, 'exactly 2 parts');
  assert.equal(partsToFitStats(limit * 2 + 1, B), 3);
  assert.equal(partsToFitStats(limit * 3, B), 3, 'exactly 3 parts');
  assert.equal(partsToFitStats(limit * 8, B), 8, 'exactly 8 parts');
  assert.equal(partsToFitStats(limit * 8 + 1, B), null, 'just over 8 parts: splitting would not be enough');
  assert.equal(partsToFitStats(STATS_BUDGET_BYTES * 2), 3, 'default budget: 2 x budget needs 3 parts of at most 80 %');
});

test('card M8.4.41: the statistics record the estimate of the whole section at the trip, before they are cleared', () => {
  let seen = null;
  const stats = new TiledObjectStats({ budget: 3 * (128 + 2 * STATS_ENTRY_BYTES + 2 * STATS_OBJECT_BYTES) - 1, labelledTiles: () => 12, onExceeded: () => { seen = stats.estimateBytes; } });
  assert.equal(stats.estimateBytes, null, 'unknown until the trip');
  stats.replaceTile(0, denseTile(1, 2)); stats.replaceTile(1, denseTile(3, 2));
  assert.equal(stats.exceeded, false);
  stats.replaceTile(2, denseTile(5, 2));                // the third tile trips the budget
  assert.ok(stats.exceeded);
  const perTile = 128 + 2 * STATS_ENTRY_BYTES, counted = 3 * perTile + 6 * STATS_OBJECT_BYTES;
  assert.equal(stats.estimateBytes, (counted / 3) * 12, 'bytes per counted tile x labelled tiles, measured before clearing');
  assert.equal(seen, stats.estimateBytes, 'already set when the page is told');
  assert.deepEqual([stats.bytes, stats.byTile.size], [0, 0]);
  assert.equal(new TiledObjectStats().labelledTiles(), 0, 'default callback');
});

test('card M8.4.41: the tiles that hold labels are those loaded with labels plus those stored in the engine and not loaded', () => {
  const tiles = new MaskTiles({ width: 4 * TILE, height: TILE }), labels = new Int32Array(TILE * TILE).fill(1);
  assert.equal(tiles.labelledTileCount(), 0);
  tiles.set(0, 0, labels, null); tiles.set(0, 1, new Int32Array(TILE * TILE), new Uint8Array(TILE * TILE).fill(1));   // labels / exclusion only
  assert.equal(tiles.labelledTileCount(), 1, 'an exclusion-only tile holds no labels');
  tiles.acknowledge([[0, 0], [0, 1]]);
  tiles.stored.add(3);                                              // stored in the engine, not in the page
  assert.equal(tiles.labelledTileCount(), 2, 'tile 0 loaded with labels, tile 3 stored and not loaded; the loaded exclusion-only tile is not counted');
});
