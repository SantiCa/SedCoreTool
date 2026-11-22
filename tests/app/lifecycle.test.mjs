// Card M8.4.39: closing, switching or reopening a project tears down what ran in the background for it, and a reopened tiled section is
// repainted as its tiles arrive. The page's modules are driven with small stand-ins for the engine bridge and the browser's bitmaps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngineAnalysis } from '../../app/js/engineanalysis.js';
import { TILE } from '../../app/js/tiledsection.js';

globalThis.ImageData ??= class { constructor(data, width, height) { this.data = data; this.width = width; this.height = height; } };
globalThis.createImageBitmap ??= async (image) => ({ width: image.width, height: image.height, closed: false, close() { this.closed = true; } });
const { createTiledView } = await import('../../app/js/tiledview.js');
const { S } = await import('../../app/js/state.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(condition, ms = 2000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(2)) if (condition()) return true;
  return false;
}

/* ───────────── the viewer's tile schedulers (tiledview.js) ───────────── */

const PYRAMID = 'a'.repeat(64);
const tiledOf = () => ({ pyramid: PYRAMID, level: 1, levels: [{ level: 0, width: 1024, height: 1024, rows: 2, cols: 2 }, { level: 1, width: 512, height: 512, rows: 1, cols: 1 }],
  channels: 1, bits: 8 });
/** A bridge whose reads return grey tiles of one channel, or fail with `code` while `failing.code` is set. */
function bridge(failing = { code: '' }) {
  return { reads: 0, async read(pyramid, k, positions) {
    this.reads++;
    if (failing.code) return { error: { code: failing.code } };
    return { ok: { bytes: new Uint8Array(positions.length * TILE * TILE).fill(90), tiles: positions.map(() => ({ byte_length: TILE * TILE })) } };
  } };
}
function viewer(TILES) {
  const seen = { renders: 0, toasts: /** @type {string[]} */ ([]) };
  const view = createTiledView({ TILES, toast: (text) => seen.toasts.push(text), requestRender: () => { seen.renders++; }, esc: String, maskLoader: () => null,
    recoverEngine: async () => {} });
  return { view, seen };
}
/** The open project holds these sections in one core, the first one on screen. */
function openProject(...sections) { S.sections = sections; S.cores = [/** @type {any} */ ({ sections })]; S.cur = 0; }

test('a tiled section opened again is repainted when its tiles arrive (the scheduler of its pyramid finds the live section)', async () => {
  const TILES = bridge(), { view, seen } = viewer(TILES);
  const first = { tiled: tiledOf() };
  openProject(first);
  const scheduler = view.tileScheduler(first);
  const reopened = { tiled: tiledOf() };                          // the project reopened: a new section object over the same pyramid
  openProject(reopened);
  assert.equal(view.tileScheduler(reopened), scheduler, 'one scheduler per pyramid');
  scheduler.want(0, [[0, 0], [0, 1]]);
  assert.ok(await until(() => scheduler.idle && TILES.reads > 0), 'the tiles were read');
  assert.ok(seen.renders > 0, 'the view was asked to draw the loaded tiles');
  assert.equal(view.tileCache.entries.size, 2, 'the tiles are cached');
});

test('a failed tile read is recorded on the section on screen, not on the section of an earlier opening', async () => {
  const failing = { code: 'ENGINE_UNAVAILABLE' }, { view, seen } = viewer(bridge(failing));
  const first = { tiled: tiledOf() };
  openProject(first);
  const scheduler = view.tileScheduler(first);
  const reopened = { tiled: /** @type {any} */ (tiledOf()) };
  openProject(reopened);
  scheduler.want(0, [[0, 0]]);
  assert.ok(await until(() => scheduler.failures > 0), 'the read failed');
  failing.code = '';
  assert.match(String(reopened.tiled.lastError), /ENGINE_UNAVAILABLE/, 'the live section shows the error');
  assert.equal(/** @type {any} */ (first.tiled).lastError, undefined, 'the closed section is left alone');
  assert.equal(seen.toasts.length, 1);
  scheduler.want(0, []);
  await until(() => scheduler.idle, 5000);
});

test('closing the project drops the schedulers and the cached tiles, and closes their bitmaps', async () => {
  const TILES = bridge(), { view } = viewer(TILES);
  const s = { tiled: tiledOf() };
  openProject(s);
  const scheduler = view.tileScheduler(s);
  scheduler.want(0, [[0, 0]]);
  assert.ok(await until(() => scheduler.idle && view.tileCache.entries.size === 1));
  const bitmap = [...view.tileCache.entries.values()][0].value;
  view.resetTiles();
  assert.equal(view.tileSchedulers.size, 0, 'no scheduler left');
  assert.equal(view.tileCache.entries.size, 0, 'no tile left');
  assert.equal(bitmap.closed, true, 'the bitmap was closed');
  assert.notEqual(view.tileScheduler(s), scheduler, 'a new scheduler for the next project');
});

/* ───────────── queued engine analyses (engineanalysis.js) ───────────── */

const CLASSES = [{ id: 'a', name: 'A', counts: true }, { id: 'undet', name: 'undet', counts: true }];
const project = () => ({ classes: CLASSES, settings: { includePred: true, predThr: 0.5, countCandidates: true, binCm: 1, minValid: 20, noDataPad: 0 }, ageModel: null, ageUnits: 'ka' });
function section(seed) {
  const w = 8, h = 40, labels = new Int32Array(w * h).fill(seed % 2), exclude = new Uint8Array(w * h);
  return { w, h, roi: { x0: 0, y0: 0, x1: w, y1: h }, top: 0, bottom: 10, units: 'cm', labels, exclude, objects: new Map([[1, { id: 1, cls: 'a' }]]),
    stacks: [null], nextId: 2, manual: [], _mv: seed };
}

test('releaseAll aborts the running analysis and every queued one: each settles, nothing is published and no later analysis is sent', async () => {
  const sent = [], published = [];
  let released = 0;
  const client = {
    analyze: (snapshot, { signal, owner }) => {
      sent.push(owner);
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    },
    releaseAll: () => { released++; },
  };
  const analysis = createEngineAnalysis({ client, project, onChange: (s) => published.push(s) });
  const a = section(1), b = section(2), c = section(3);
  const done = [analysis.request(a), analysis.request(b), analysis.request(c)];
  assert.ok(await until(() => sent.length === 1), 'the first analysis is running');
  analysis.releaseAll();
  const settled = await Promise.race([Promise.all(done).then(() => 'settled'), sleep(1000).then(() => 'still waiting')]);
  assert.equal(settled, 'settled', 'every request settles once the project is released');
  await sleep(20);
  assert.deepEqual(sent, [a], 'the queued analyses were never sent');
  assert.deepEqual(published, [], 'nothing is published for the old project');
  assert.equal(released, 1, 'the engine drops what it kept');
  void analysis.request(a);                                       // the same section asked again (it was not analysed): a new job
  assert.ok(await until(() => sent.length === 2), 'a later request runs again');
  analysis.releaseAll();
});

/* ───────────── the reopening cache must cover every object saved with statistics (tiledproject.js) ───────────── */

const { createTiledProject } = await import('../../app/js/tiledproject.js');
const { MaskTiles } = await import('../../app/js/tiledmasks.js');
const { TiledRowCounts, tileHistogram } = await import('../../app/js/tiledcounts.js');
const { TiledObjectStats, tileStats } = await import('../../app/js/tiledit.js');
const { encodeReopenCache } = await import('../../app/js/tiledcache.js');
const { createHash } = await import('node:crypto');
const sha256 = async (bytes) => createHash('sha256').update(bytes).digest('hex');

/** A tiled section of 700 x 600 source pixels (2 x 2 tiles, factor 2) with objects 1 and 2 painted, and its reopening cache. */
async function reopenFixture() {
  const w = 700, h = 600, ds = 2, tiles = new MaskTiles({ width: w, height: h, budget: Infinity }), cols = tiles.cols;
  const tileLabels = new Map(), tileRgba = new Map(), stored = new Set();
  for (let row = 0; row < tiles.rows; row++) for (let col = 0; col < cols; col++) {
    const labels = new Int32Array(TILE * TILE), exclude = new Uint8Array(TILE * TILE), rgba = new Uint8Array(TILE * TILE * 4).fill(120);
    if (row === 0 && col === 0) for (let y = 10; y < 40; y++) labels.fill(1, y * TILE + 10, y * TILE + 50);
    if (row === 1 && col === 1) for (let y = 5; y < 20; y++) labels.fill(2, y * TILE + 3, y * TILE + 30);
    tiles.set(row, col, labels, exclude); tileLabels.set(row * cols + col, labels); tileRgba.set(row * cols + col, rgba);
    if (labels.some(Boolean)) stored.add(row * cols + col);
  }
  const counts = new TiledRowCounts({ width: w, height: h, rows: tiles.rows, cols }, { nonEmpty: () => stored });
  counts.setArea({ x0: 0, x1: w, y0: 0, y1: h });
  const stats = new TiledObjectStats(), source = { width: w, height: h, stacks: [null], labelsAt: (r, c) => tileLabels.get(r * cols + c), rgbaAt: (r, c) => tileRgba.get(r * cols + c) };
  for (const tile of stored) {
    const row = Math.floor(tile / cols), col = tile % cols;
    counts.commit(tile, tileHistogram(tiles.get(row, col), row, col, w, h, 0, w));
    stats.replaceTile(tile, tileStats(source, row, col));
  }
  const working = { w: Math.ceil(w / ds), h: Math.ceil(h / ds) }, snapshot = counts.snapshot();
  const rec = { manifest: 'c3'.repeat(32), source: { sha256: 'd4'.repeat(32) }, width: w, height: h };
  const bytes = await encodeReopenCache({ manifest: rec.manifest, source: rec.source.sha256, ds, width: w, height: h,
    working: { ...working, labels: new Int32Array(working.w * working.h), exclude: new Uint8Array(working.w * working.h) },
    columns: snapshot.columns, hists: snapshot.hists, stats: stats.byTile }, sha256);
  const maskTiles = new MaskTiles({ width: w, height: h });
  for (const tile of stored) maskTiles.stored.add(tile);
  const objects = new Map([1, 2].map((id) => [id, { id, stats: stats.total(id) }]));
  const s = { w: working.w, h: working.h, ds, labels: new Int32Array(working.w * working.h), maskTiles, objects };
  const TILES = { derivedGet: async () => ({ ok: { found: true, bytes } }) };
  const project = createTiledProject(/** @type {any} */ ({ TILES, settleDeadlineMs: 1000, toast: () => {}, hexDigest: sha256 }));
  return { s, rec, project };
}

test('a reopening cache that lacks the statistics of an object saved with statistics is refused', async () => {
  const warn = console.warn; console.warn = () => {};
  try {
    const { s, rec, project } = await reopenFixture();
    assert.ok(await project.readReopenCache(s, rec, 'p'), 'control: the cache of exactly the saved objects is used');
    s.objects.set(3, { id: 3, stats: null });                      // saved without statistics (no pixels): nothing to cover
    assert.ok(await project.readReopenCache(s, rec, 'p'), 'an object without statistics does not refuse the cache');
    s.objects.set(4, { id: 4, stats: { n: 12, x0: 400, y0: 20, x1: 410, y1: 30 } });   // saved with pixels the cache knows nothing of
    assert.ok((await project.readReopenCache(s, rec, 'p')) === null, 'the cache is refused');   // not assert.equal: printing a cache takes gigabytes
  } finally { console.warn = warn; }
});

/* ───────────── a save marks the saved versions of every core (tiledproject.js, used by app.js saveOnce) ───────────── */

test('after a save every core\'s tiled sections hold their saved version, also when the core on screen has no section', () => {
  const project = createTiledProject(/** @type {any} */ ({ TILES: null, settleDeadlineMs: 1000, toast: () => {} }));
  const written = { tiled: { manifest: 'e5'.repeat(32) } }, older = { tiled: { manifest: 'f6'.repeat(32) } };
  const q = { tiled: { pyramid: PYRAMID }, _savedRecord: older, _tiledRecord: written }, plain = { _tiledRecord: null };
  const empty = { sections: [] }, other = { sections: [plain, q] };
  S.cores = /** @type {any} */ ([empty, other]); S.sections = /** @type {any} */ (empty.sections); S.cur = -1;
  project.markTiledSaved();
  assert.equal(q._savedRecord, written, 'the record the save wrote is the saved version');
  assert.equal(/** @type {any} */ (plain)._savedRecord, undefined, 'a section that is not tiled is left alone');
});

/* ───────────── the statistics runner of a tiled section (tiledit.js) ───────────── */

const { TiledStatsRunner } = await import('../../app/js/tiledit.js');

/** A section of 2 x 2 tiles with an object in each tile; `gate` holds every pixel read until it is opened. */
function statsFixture() {
  const tiles = new MaskTiles({ width: 2 * TILE, height: 2 * TILE }), all = /** @type {[number, number][]} */ ([]);
  for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) {
    const labels = new Int32Array(TILE * TILE); for (let y = 10; y < 20; y++) labels.fill(1 + row * 2 + col, y * TILE + 10, y * TILE + 40);
    tiles.set(row, col, labels, null); all.push([row, col]);
  }
  const updates = [], errors = [], gate = { open: /** @type {() => void} */ (() => {}), closed: false, reads: 0 };
  const runner = new TiledStatsRunner({ tiles, stats: new TiledObjectStats(), stacks: () => [null], onUpdate: (ids) => updates.push([...ids]), onError: (e) => errors.push(e),
    fetchRgba: async (positions) => {
      gate.reads++;
      if (gate.closed) await new Promise((resolve) => { gate.open = () => resolve(undefined); });
      return positions.map(() => new Uint8ClampedArray(TILE * TILE * 4).fill(60));
    } });
  return { runner, all, updates, errors, gate };
}

test('a stopped statistics runner computes and reports nothing more, empties its pixel cache and releases whoever waits', async () => {
  const { runner, all, updates, errors, gate } = statsFixture();
  gate.closed = true;
  const running = runner.queue(all, [1, 2, 3, 4]);
  const waiting = runner.prioritise([[1, 1]]);
  assert.ok(await until(() => gate.reads === 1), 'the first tile is reading its pixels');
  runner.stop();                                                   // the project is closed while the read is on its way
  gate.closed = false; gate.open();
  await running;
  const released = await Promise.race([waiting.then(() => true), sleep(500).then(() => false)]);
  assert.equal(released, true, 'a caller waiting for tiles is released');
  assert.deepEqual(updates, [], 'nothing is reported for the closed section');
  assert.deepEqual(errors, []);
  assert.equal(runner.rgba.size, 0, 'the pixel cache is empty');
  assert.equal(gate.reads, 1, 'no other tile was read');
  await runner.queue(all, [1]);
  assert.equal(gate.reads, 1, 'a request after the stop reads nothing');
  assert.ok(runner.idle);
});

test('a section that is left drops the level-0 pixels of its statistics runner, at once or when the run on its way ends', async () => {
  const { runner, all, updates, gate } = statsFixture();
  await runner.queue(all, [1, 2, 3, 4]);
  assert.ok(runner.rgba.size > 0 && updates.length > 0, 'control: pixels are cached while the section is edited');
  runner.releasePixels();
  assert.equal(runner.rgba.size, 0, 'idle: dropped at once');
  gate.closed = true;
  const readsBefore = gate.reads, running = runner.queue([[0, 0]], [1]);
  assert.ok(await until(() => gate.reads > readsBefore));
  runner.releasePixels();                                          // left while a tile is reading its pixels: the run still needs them
  gate.closed = false; gate.open();
  await running;
  assert.equal(runner.stats.total(1).n, 10 * 30, 'the tile was computed with its pixels');
  assert.equal(runner.rgba.size, 0, 'dropped when the run ended');
});

/* ───────────── the busy sign of overlapping operations (singleflight.js, used by app.js busy and tiledtools.js) ───────────── */

const { nestedIndicator } = await import('../../app/js/singleflight.js');

test('the busy sign stays while any of several overlapping or nested operations runs, and goes when the last one ends', async () => {
  let shown = false, shows = 0;
  const sign = nestedIndicator(() => { shown = true; shows++; }, () => { shown = false; });
  const operation = async (ms, inner = null) => { sign.enter(); try { await sleep(ms); if (inner) await inner(); } finally { sign.leave(); } };
  const long = operation(60);
  await sleep(5);
  await operation(5);                                              // a shorter one started and ended meanwhile (a log redraw during a load)
  assert.equal(shown, true, 'still shown while the longer operation runs');
  await long;
  assert.equal(shown, false, 'hidden after the last one');
  await operation(1, () => operation(1));                          // nested
  assert.equal(shown, false);
  assert.equal(shows, 2, 'shown once per busy period');
  sign.leave();                                                    // an unmatched end changes nothing
  assert.equal(sign.depth, 0);
  sign.enter();
  assert.equal(shown, true);
  sign.leave();
});

/* ───────────── the folder backup writes the open project when any core holds data (state.js, used by app.js backupNow) ───────────── */

const { projectHasData } = await import('../../app/js/state.js');

test('a project whose core on screen is empty but whose other core has sections or records counts as holding data', () => {
  const empty = { sections: [], records: [] };
  const withSection = { sections: [{}], records: [] }, withRecord = { sections: [], records: [{}] };
  assert.equal(projectHasData({ cores: [empty, withSection], sections: empty.sections, records: empty.records }), true, 'a section in another core');
  assert.equal(projectHasData({ cores: [empty, withRecord], sections: empty.sections, records: empty.records }), true, 'a record in another core');
  assert.equal(projectHasData({ cores: [empty, { sections: [], records: [] }], sections: empty.sections, records: empty.records }), false, 'an empty project is not written');
});

/* ───────────── closing a project or deleting a section stops its background work (tiledproject.js, tiledtools.js) ───────────── */

const { TiledCountsRunner } = await import('../../app/js/tiledcounts.js');
const { createTiledTools } = await import('../../app/js/tiledtools.js');

test('a closed or deleted tiled section stops its mask sends, its statistics and its row counts', async () => {
  const project = createTiledProject(/** @type {any} */ ({ TILES: null, settleDeadlineMs: 1000, toast: () => {} }));
  const { runner } = statsFixture();
  const tiles = new MaskTiles({ width: TILE, height: TILE }), counts = new TiledRowCounts({ width: TILE, height: TILE, rows: 1, cols: 1 }, { nonEmpty: () => new Set() });
  const sync = { stopped: false, stop() { this.stopped = true; } };
  const q = { _maskSync: sync, _statsRunner: runner, _counts: { counts, runner: new TiledCountsRunner({ tiles, counts }) } };
  project.stopTiledWork(q);
  assert.equal(sync.stopped, true, 'mask sends');
  assert.equal(runner.stopped, true, 'statistics');
  assert.equal(q._counts.runner.cancelled, true, 'row counts');
  project.stopTiledWork({});                                       // a section that is not tiled
});

test('closing the project ends a wait for objects\' statistics without running its operation, and lowers the busy sign', async () => {
  const sign = { hidden: true, textContent: '' }, listeners = new Set();
  const savedDocument = globalThis.document;
  globalThis.document = /** @type {any} */ ({ getElementById: () => sign, addEventListener: (type, fn) => listeners.add(fn), removeEventListener: (type, fn) => listeners.delete(fn) });
  try {
    const busyShown = nestedIndicator(() => { sign.hidden = false; }, () => { sign.hidden = true; });
    const tools = createTiledTools({ toast: () => {}, busyShown, sourceBox: (o) => o.box, maskLoader: () => ({ want: async () => {} }) });
    const { runner, gate } = statsFixture();
    gate.closed = true;
    void runner.queue([[0, 0], [0, 1], [1, 0], [1, 1]], [1]);
    const s = { frozen: null, _statsRunner: runner, maskTiles: runner.tiles };
    openProject(/** @type {any} */ (s));
    let ran = 0;
    assert.equal(tools.objectsReady(s, [{ id: 1, box: { x0: TILE + 10, y0: TILE + 10, x1: TILE + 40, y1: TILE + 20 } }], () => { ran++; }), false, 'it waits');
    assert.equal(tools.objectsWaiting(), true);
    assert.equal(sign.hidden, false, 'the busy sign shows');
    tools.resetTiledTools();                                       // the project is closed meanwhile
    assert.equal(tools.objectsWaiting(), false, 'the wait ended');
    assert.equal(sign.hidden, true, 'the busy sign went');
    assert.equal(listeners.size, 0, 'no key handler left');
    runner.stop(); gate.closed = false; gate.open();
    await sleep(20);
    assert.equal(ran, 0, 'the operation did not run');
  } finally { globalThis.document = savedDocument; }
});

test('a save does not wait for the mask sends of sections whose work was stopped (a project closed while the save waited)', async () => {
  const stoppedSync = { settled: false, stopped: true, manifest: null, request() {} };
  const project = createTiledProject(/** @type {any} */ ({ TILES: null, settleDeadlineMs: 2000, toast: () => {}, maskSync: (q) => q._maskSync, serTiledSection: () => ({}) }));
  const q = { tiled: { pyramid: PYRAMID }, maskTiles: {}, frozen: null, _maskSync: stoppedSync };
  S.cores = /** @type {any} */ ([{ sections: [q] }]); S.sections = S.cores[0].sections; S.cur = 0;
  const started = Date.now(), unsaved = await project.settleTiledSections();
  assert.equal(unsaved, 1, 'the section is counted as not saved');
  assert.ok(Date.now() - started < 1000, `returned at once, not after the 2 s deadline (${Date.now() - started} ms)`);
});
