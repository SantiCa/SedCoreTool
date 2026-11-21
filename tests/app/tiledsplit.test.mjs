// Card M8.4.43: splitting a tiled section into parts along mask-tile boundaries (decisions X1-X4).
// Tests: geometry & window alignment, continuous depths & ROI/marks/manual partitioning, exact equality of masks, object pixels/classes,
// and summed interval tables (plus bin-for-bin equality on tile-aligned intervals), budget fit after splitting and M8.4.18d synthetic-density
// refusal, and failure safety when a split stops half-way (engine stopped or disk full).
import test from 'node:test';
import assert from 'node:assert/strict';
import { TILE } from '../../app/js/tiledsection.js';
import { MaskTiles } from '../../app/js/tiledmasks.js';
import { STATS_BUDGET_BYTES, STATS_ENTRY_BYTES, STATS_OBJECT_BYTES, TiledObjectStats, TiledStatsRunner } from '../../app/js/tiledit.js';
import { TiledCountsRunner, TiledRowCounts } from '../../app/js/tiledcounts.js';
import { binsFromRowCounts, binRowsOfSection, effectiveClassIndex } from '../../app/js/sectionanalysis.js';
import { depthAtRow } from '../../app/js/sectiondepth.js';
import { validTiledRecord } from '../../app/js/tiledrecord.js';
import { buildPartRecord, canSplitSection, decodeSlicePayload, maxSplitParts, planSplitParts, splitRowBounds, splitSuggestion } from '../../app/js/tiledsplit.js';
import { t } from '../../app/js/i18n.js';
import { S } from '../../app/js/state.js';
import { createTiledSplitController } from '../../app/js/tiledsplitui.js';

const SHA = (c) => c.repeat(64);
const CLASSES = [
  { id: 'c0', name: 'Planolites', counts: true },
  { id: 'c1', name: 'Thalassinoides', counts: true },
  { id: 'artifact', name: 'Artifact', counts: false },
];
const SETTINGS = { includePred: false, predThr: 0.7, countCandidates: false, binCm: 1, minValid: 20, noDataPad: 0 };

/** Synthetic full-resolution masks over W x H with objects in top, middle, bottom, one crossing every cut, overlaps and exclusion. */
function makeSection(W, H, level, { top = 100, bottom = 100 + H / 512, roi = null, baseY0 = 0 } = {}) {
  const ds = 2 ** level, w = Math.ceil(W / ds), h = Math.ceil(H / ds);
  const labels = new Int32Array(W * H), exclude = new Uint8Array(W * H);
  const stacks = [null, [2, 3], [4, 5]];
  const fillRect = (x0, y0, x1, y1, val, arr = labels) => {
    for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) arr[y * W + x] = val;
  };
  fillRect(20, 40, 140, 260, 1);                              // top part only
  fillRect(180, 460, 280, 700, 2);                            // crosses y = 512
  fillRect(220, 560, 320, 660, -1);                           // overlap [2, 3] in tile row 1
  fillRect(40, 800, 180, 1120, 3);                            // crosses y = 1024
  fillRect(300, 1100, 500, 1450, 4);                          // bottom half
  fillRect(350, 1300, 450, 1400, -2);                         // overlap [4, 5] in tile row 2
  fillRect(10, H - 120, 200, H - 5, 6);                       // near bottom edge
  fillRect(0, 200, 40, 900, 1, exclude);                      // exclusion spanning boundary
  fillRect(W - 60, 1100, W, H - 20, 1, exclude);

  const tiles = new MaskTiles({ width: W, height: H, budget: Infinity });
  for (let row = 0; row < tiles.rows; row++) for (let col = 0; col < tiles.cols; col++) {
    const l = new Int32Array(TILE * TILE), e = new Uint8Array(TILE * TILE);
    for (let y = 0; y < TILE && row * TILE + y < H; y++) for (let x = 0; x < TILE && col * TILE + x < W; x++) {
      l[y * TILE + x] = labels[(row * TILE + y) * W + col * TILE + x];
      e[y * TILE + x] = exclude[(row * TILE + y) * W + col * TILE + x];
    }
    tiles.set(row, col, l, e);
  }
  const objects = new Map([
    [1, { id: 1, cls: 'c0', src: 'manual', pred: null, conf: 0 }],
    [2, { id: 2, cls: 'c1', src: 'auto', pred: 'c1', conf: 0.9, nt: true }],
    [3, { id: 3, cls: 'c0', src: 'manual', pred: null, conf: 0 }],
    [4, { id: 4, cls: 'c1', src: 'auto', pred: null, conf: 0 }],
    [5, { id: 5, cls: 'artifact', src: 'manual', pred: null, conf: 0 }],
    [6, { id: 6, cls: 'c0', src: 'manual', pred: null, conf: 0 }],
    [9, { id: 9, cls: 'c1', src: 'manual', pred: null, conf: 0 }],   // empty object: dropped by slice
  ]);
  const marks = [
    { id: 'm1', x: 50, y: 10, cls: 'c0' },
    { id: 'm2', x: 100, y: Math.floor(h / 2) - 1, cls: 'c1' },
    { id: 'm3', x: 120, y: Math.floor(h / 2) + 2, cls: 'c0' },
    { id: 'm4', x: 80, y: h - 1, cls: 'c1' },
  ];
  const manual = [
    { from: top, to: top + (bottom - top) * 0.4, BI: 3, ii: 4 },
    { from: top + (bottom - top) * 0.3, to: bottom, BI: 5, ii: 5 },
  ];
  const s = {
    id: 'sec_orig', name: 'Core 1A', ds, w, h, top, bottom, units: 'cm',
    roi: roi || { x0: 0, y0: 0, x1: w, y1: h },
    file: { name: 'core.tif', type: 'image/tiff', tiled: true },
    filters: { contrast: 1 }, preset: 'none', detect: { method: 'adaptive' },
    marks, manual, nextId: 10, objects, stacks, maskTiles: tiles,
    tiled: { pyramid: SHA('a'), level, source: { name: 'core.tif', size: 12345 }, ...(baseY0 ? { window: { y0: baseY0, y1: baseY0 + H } } : {}) },
  };
  return { s, labels, exclude };
}

/** In-memory equivalent of `MaskStore.slice_rows` for pure Node verification of the JS split pipeline. */
function sliceInMemory(s, row0, row1) {
  const src = s.maskTiles, height = Math.min(src.height, row1 * TILE) - row0 * TILE;
  const out = new MaskTiles({ width: src.width, height, budget: Infinity });
  const present = new Set(), usedStacks = new Set();
  for (let row = row0; row < row1; row++) for (let col = 0; col < src.cols; col++) {
    const entry = src.get(row, col);
    if (!entry) continue;
    out.set(row - row0, col, entry.labels, entry.exclude, { dirty: false });
    if (entry.labels) {
      for (let i = 0; i < entry.labels.length; i++) {
        const v = entry.labels[i];
        if (v > 0) present.add(v);
        else if (v < 0) usedStacks.add(-v);
      }
    }
  }
  for (const k of usedStacks) for (const id of s.stacks[k]) present.add(id);
  const objectIds = [...s.objects.keys()].filter((id) => present.has(id));
  const stackIndices = [...usedStacks].sort((a, b) => a - b);
  return { tiles: out, objectIds, stackIndices };
}

function analyzeTiles(s, tiles, stacks, objects, settings = SETTINGS) {
  const area = { x0: s.roi.x0 * s.ds, y0: s.roi.y0 * s.ds, x1: Math.min(s.roi.x1 * s.ds, tiles.width), y1: Math.min(s.roi.y1 * s.ds, tiles.height) };
  const counts = new TiledRowCounts({ width: tiles.width, height: tiles.height, rows: tiles.rows, cols: tiles.cols }, { nonEmpty: () => tiles.entries.keys() });
  const runner = new TiledCountsRunner({ tiles, counts });
  counts.setArea(area);
  assert.deepEqual(runner.flush(), []);
  const eff = effectiveClassIndex({ nextId: s.nextId, objects }, CLASSES, settings);
  const rc = counts.rowCounts({ effClass: eff, nClasses: CLASSES.length, stacks, area });
  const counted = { top: s.top, bottom: s.bottom, units: s.units, roi: { y0: area.y0, y1: area.y1 } };
  const bins = binsFromRowCounts(s, rc, { classes: CLASSES, settings, ageModel: null }, binRowsOfSection(counted, settings));
  return { area, rc, bins };
}

test('card M8.4.43: splitRowBounds aligns every cut to mask tiles and 2^level with near-equal heights', () => {
  assert.equal(maxSplitParts(512, 0), 1);
  assert.equal(maxSplitParts(513, 0), 2);
  assert.equal(maxSplitParts(16726, 2), 33);
  assert.equal(maxSplitParts(2048, 10), 2, 'level 10 needs 1024-row alignment');
  const two = splitRowBounds(16726, 0, 2);
  assert.deepEqual(two, [
    { row0: 0, row1: 16, py0: 0, py1: 8192, height: 8192 },
    { row0: 16, row1: 33, py0: 8192, py1: 16726, height: 8534 },
  ]);
  const aligned10 = splitRowBounds(3072, 10, 3);
  assert.deepEqual(aligned10.map((b) => [b.row0, b.row1, b.py0, b.py1]), [[0, 2, 0, 1024], [2, 4, 1024, 2048], [4, 6, 2048, 3072]]);
  for (const b of aligned10) assert.equal(b.py0 % 1024, 0);
  assert.throws(() => splitRowBounds(512, 0, 2), /split count/);
  assert.throws(() => splitRowBounds(2000, 0, 1), /split count/);
});

test('card M8.4.43: split preserves masks, objects, classes, continuous depths, marks, ROI, and exact interval tables', () => {
  // Case 1: tile-aligned intervals (512 px/cm, binCm = 1 -> 512 rows per bin: every cut is a bin boundary -> bin-for-bin equality!)
  const { s, labels, exclude } = makeSection(620, 2048, 1, { top: 100, bottom: 104 });
  assert.ok(canSplitSection(s));
  const orig = analyzeTiles(s, s.maskTiles, s.stacks, s.objects);
  const specs = planSplitParts(s, 3);
  assert.equal(specs.length, 3);
  assert.equal(specs[0].top, s.top);
  assert.equal(specs.at(-1).bottom, s.bottom);
  for (let i = 0; i < specs.length - 1; i++) assert.equal(specs[i].bottom, specs[i + 1].top, 'depths continuous at boundary');

  const partRecords = [], partBins = [], partValid = [], partBio = [], partCls = [];
  const reassembledLabels = new Int32Array(s.maskTiles.width * s.maskTiles.height);
  const reassembledExclude = new Uint8Array(s.maskTiles.width * s.maskTiles.height);
  const pixelCountsById = new Map();

  for (const part of specs) {
    const sliced = sliceInMemory(s, part.row0, part.row1);
    const rec = buildPartRecord(s, part, SHA(String(part.index + 1)), sliced.objectIds, sliced.stackIndices);
    assert.ok(validTiledRecord(rec.tiled), 'every part writes a valid format-7 windowed record');
    partRecords.push(rec);

    // Check union of masks and per-object pixels/classes
    const objectsMap = new Map(rec.objects.map((o) => [o.id, { ...o, pred: null, conf: 0 }]));
    for (const [id, o] of objectsMap) assert.equal(o.cls, s.objects.get(id).cls, 'object keeps its class');
    assert.ok(!objectsMap.has(9), 'empty object is not carried into any part');

    for (let y = 0; y < part.height; y++) {
      const tr = Math.floor(y / TILE), ty = y - tr * TILE;
      for (let x = 0; x < part.width; x++) {
        const tc = Math.floor(x / TILE), tx = x - tc * TILE;
        const entry = sliced.tiles.get(tr, tc);
        const lv = entry?.labels ? entry.labels[ty * TILE + tx] : 0;
        const ev = entry?.exclude ? entry.exclude[ty * TILE + tx] : 0;
        reassembledLabels[(part.py0 + y) * part.width + x] = lv;
        reassembledExclude[(part.py0 + y) * part.width + x] = ev;
        if (lv > 0) pixelCountsById.set(lv, (pixelCountsById.get(lv) || 0) + 1);
        else if (lv < 0) for (const id of rec.stacks[-lv]) pixelCountsById.set(id, (pixelCountsById.get(id) || 0) + 1);
      }
    }

    const res = analyzeTiles(rec, sliced.tiles, rec.stacks, objectsMap);
    partBins.push(...res.bins);
    partValid.push(...res.rc.valid);
    partBio.push(...res.rc.bio);
    partCls.push(...res.rc.cls);
  }

  assert.deepEqual(reassembledLabels, labels, 'union of parts labels equals original');
  assert.deepEqual(reassembledExclude, exclude, 'union of parts exclusion equals original');
  // Every object pixel count summed over parts equals the original
  const origCounts = new Map();
  for (const v of labels) {
    if (v > 0) origCounts.set(v, (origCounts.get(v) || 0) + 1);
    else if (v < 0) for (const id of s.stacks[-v]) origCounts.set(id, (origCounts.get(id) || 0) + 1);
  }
  assert.deepEqual(pixelCountsById, origCounts, 'every object keeps its exact pixels');
  // Row counts and tile-aligned interval tables equal the original exactly
  assert.deepEqual(partValid, [...orig.rc.valid]);
  assert.deepEqual(partBio, [...orig.rc.bio]);
  assert.deepEqual(partCls, [...orig.rc.cls]);
  const stripLocal = ({ dTop, dBottom, depth, valid, pct, classPct, BI, ii, BIm, iim }) => ({ dTop, dBottom, depth, valid, pct, classPct, BI, ii, BIm, iim });
  assert.deepEqual(partBins.map(stripLocal), orig.bins.map(stripLocal), 'bin-for-bin equality on tile-aligned intervals');
  // Marks partitioned without loss or duplication, at identical depths
  const allMarks = partRecords.flatMap((rec) => rec.marks.map((m) => ({ id: m.id, cls: m.cls, x: m.x, depth: depthAtRow(rec, m.y) })));
  const origMarks = s.marks.map((m) => ({ id: m.id, cls: m.cls, x: m.x, depth: depthAtRow(s, m.y) }));
  assert.equal(allMarks.length, origMarks.length);
  for (let i = 0; i < origMarks.length; i++) {
    assert.equal(allMarks[i].id, origMarks[i].id);
    assert.ok(Math.abs(allMarks[i].depth - origMarks[i].depth) < 1e-9, 'mark depth preserved');
  }

  // Case 2: non-tile-aligned height (1700 px), partial ROI, arbitrary binCm (0.7 cm), already windowed section
  const { s: s2 } = makeSection(620, 1700, 1, { top: 50, bottom: 73.5, roi: { x0: 10, y0: 100, x1: 290, y1: 780 }, baseY0: 1024 });
  const orig2 = analyzeTiles(s2, s2.maskTiles, s2.stacks, s2.objects, { ...SETTINGS, binCm: 0.7 });
  const specs2 = planSplitParts(s2, 2);
  assert.deepEqual(specs2.map((p) => p.window), [{ y0: 1024, y1: 2048 }, { y0: 2048, y1: 2724 }], 'window shifts accumulate');
  assert.equal(specs2[0].bottom, specs2[1].top, 'boundary depth exact match');
  let validSum = 0, bioSum = 0;
  const clsSum = new Array(CLASSES.length).fill(0);
  for (const part of specs2) {
    const sliced = sliceInMemory(s2, part.row0, part.row1);
    const rec = buildPartRecord(s2, part, SHA('c'), sliced.objectIds, sliced.stackIndices);
    const objectsMap = new Map(rec.objects.map((o) => [o.id, { ...o, pred: null, conf: 0 }]));
    const res = analyzeTiles(rec, sliced.tiles, rec.stacks, objectsMap, { ...SETTINGS, binCm: 0.7 });
    for (const b of res.bins) {
      validSum += b.valid;
      if (b.pct !== null) {
        bioSum += Math.round((b.pct / 100) * b.valid);
        b.classPct.forEach((p, k) => { clsSum[k] += Math.round((p / 100) * b.valid); });
      }
    }
  }
  let origValid = 0, origBio = 0;
  const origCls = new Array(CLASSES.length).fill(0);
  for (const b of orig2.bins) {
    origValid += b.valid;
    if (b.pct !== null) {
      origBio += Math.round((b.pct / 100) * b.valid);
      b.classPct.forEach((p, k) => { origCls[k] += Math.round((p / 100) * b.valid); });
    }
  }
  assert.equal(validSum, origValid, 'summed valid pixels across parts equal original');
  assert.equal(bioSum, origBio, 'summed bioturbated pixels across parts equal original');
  assert.deepEqual(clsSum, origCls, 'summed per-class pixels across parts equal original');
});

test('card M8.4.43: decodeSlicePayload handles unaligned byteOffset and rejects wrong lengths', () => {
  const buf = new ArrayBuffer(17);
  const view = new DataView(buf, 1, 16);
  view.setUint32(0, 11, true); view.setUint32(4, 22, true); view.setUint32(8, 33, true); view.setUint32(12, 2, true);
  const { objectIds, stackIndices } = decodeSlicePayload(new Uint8Array(buf, 1, 16), 3, 1);
  assert.deepEqual([...objectIds], [11, 22, 33]);
  assert.deepEqual([...stackIndices], [2]);
  assert.throws(() => decodeSlicePayload(new Uint8Array(8), 3, 0), /length/);
});

test('card M8.4.43 (Done when): an over-budget section splits into X1 parts that each fit; M8.4.18d synthetic density refuses splitting (X1)', async () => {
  // (1) Synthetic section of M8.4.18d: 32,768 x 57,344 (7,168 tiles), ~64,333 objects in every tile (~69.5 GiB estimated) -> X1 says > 8 parts, no split.
  const synthStats = new TiledObjectStats({ labelledTiles: () => 7168 });
  const sample = { n: 4, sx: 1, sy: 1, sxx: 1, syy: 1, sxy: 1, x0: 0, x1: 1, y0: 0, y1: 1, per: 4, sL: 1, sLL: 1, sA: 0, sB: 0, rL: 0, rN: 0 };
  const dense = new Map(Array.from({ length: 64333 }, (_, i) => [i + 1, sample]));
  for (let tile = 0; tile < 64 && !synthStats.exceeded; tile++) synthStats.replaceTile(tile, dense);
  assert.ok(synthStats.exceeded && synthStats.estimateBytes > STATS_BUDGET_BYTES * 100);
  const synthSection = { tiled: { level: 3 }, maskTiles: { height: 57344 }, frozen: null, _statsRunner: { stats: synthStats } };
  assert.deepEqual(splitSuggestion(synthSection), { exceeded: true, canSplit: true, maxParts: 8, suggested: null },
    'M8.4.18d synthetic section: X1 says even 8 parts would not fit');

  // (2) Over-budget section (~2.2x budget -> X1 recommends 3 parts): after splitting into those 3 parts, every part stays under the budget!
  const tileRows = 9, cols = 1, objectsPerTile = 10;
  const oneTileBytes = 128 + objectsPerTile * (STATS_ENTRY_BYTES + STATS_OBJECT_BYTES);
  const budget = Math.floor(4.1 * oneTileBytes);               // 9 tiles need ~2.2x budget -> partsToFitStats = ceil(2.2 / 0.8) = 3 parts!
  const tiles = new MaskTiles({ width: cols * TILE, height: tileRows * TILE, budget: Infinity });
  const objects = new Map();
  let nextId = 1;
  for (let row = 0; row < tileRows; row++) {
    const l = new Int32Array(TILE * TILE);
    for (let k = 0; k < objectsPerTile; k++) {
      const id = nextId++;
      objects.set(id, { id, cls: 'c0', src: 'auto', pred: null, conf: 0 });
      for (let y = k * 40; y < k * 40 + 20; y++) l.fill(id, y * TILE + 10, y * TILE + 30);
    }
    tiles.set(row, 0, l, null);
  }
  const origStats = new TiledObjectStats({ budget, labelledTiles: () => tiles.labelledTileCount() });
  const origRunner = new TiledStatsRunner({ tiles, stats: origStats, stacks: () => [null], onUpdate: () => {},
    fetchRgba: async (pos) => pos.map(() => new Uint8ClampedArray(TILE * TILE * 4).fill(80)) });
  await origRunner.queue(Array.from({ length: tileRows }, (_, r) => [r, 0]));
  assert.ok(origStats.exceeded, 'whole section trips the budget');
  const nParts = Math.max(2, Math.ceil(origStats.estimateBytes / (budget * 0.8)));
  assert.equal(nParts, 3, 'X1 recommends 3 parts');

  const wholeSection = {
    id: 'dense', name: 'Dense', ds: 1, w: TILE, h: tileRows * TILE, top: 0, bottom: 9, units: 'cm',
    roi: { x0: 0, y0: 0, x1: TILE, y1: tileRows * TILE }, file: { name: 'd.tif', type: 'image/tiff', tiled: true },
    filters: {}, preset: 'none', detect: {}, marks: [], manual: [], nextId, objects, stacks: [null], maskTiles: tiles,
    tiled: { pyramid: SHA('d'), level: 0, source: { name: 'd.tif', size: 100 } }, _statsRunner: origRunner,
  };
  const specs = planSplitParts(wholeSection, nParts);
  assert.equal(specs.length, 3);
  for (const part of specs) {
    const sliced = sliceInMemory(wholeSection, part.row0, part.row1);
    const partStats = new TiledObjectStats({ budget, labelledTiles: () => sliced.tiles.labelledTileCount() });
    const partRunner = new TiledStatsRunner({ tiles: sliced.tiles, stats: partStats, stacks: () => [null], onUpdate: () => {},
      fetchRgba: async (pos) => pos.map(() => new Uint8ClampedArray(TILE * TILE * 4).fill(80)) });
    await partRunner.queue(Array.from({ length: sliced.tiles.rows }, (_, r) => [r, 0]));
    assert.equal(partStats.exceeded, false, `part ${part.index + 1} stays under budget (${partStats.bytes} <= ${budget})`);
    assert.equal(partStats.tilesOf.size, sliced.objectIds.length, 'every object in the part has its statistics');
  }
});

test('card M8.4.43: a split stopped half-way (engine stopped or disk full) leaves the original section and its saved version intact', async () => {
  const dom = Object.fromEntries(['secSplit', 'secStatsWarning', 'secStatsMsg', 'secStatsSplit'].map((id) => [id, { hidden: true, disabled: false, textContent: '', addEventListener() {} }]));
  const prevDoc = globalThis.document;
  globalThis.document = /** @type {any} */ ({ getElementById: (id) => dom[id] || null });
  try {
  for (const failure of [
    { code: 'ENGINE_UNAVAILABLE', expected: t('tiles.split.failed', { code: 'ENGINE_UNAVAILABLE', field: '' }) },
    { code: 'LIMIT_EXCEEDED', field: 'disk', expected: t('tiles.split.diskFull') },
  ]) {
    const { s } = makeSection(620, 1536, 1);
    const origManifest = SHA('9');
    s._savedRecord = { id: s.id, tiled: { manifest: origManifest } };
    const sync = { settled: true, stopped: false, manifest: origManifest, request: () => Promise.resolve() };
    S.id = 'proj1'; S.cores = /** @type {any} */ ([{ id: 'c1', sections: [s] }]); S.sections = S.cores[0].sections; S.curCore = 'c1'; S.cur = 0;

    let sliceCalls = 0, stoppedOriginal = false, dirty = false;
    const toasts = [];
    const controller = createTiledSplitController(/** @type {any} */ ({
      TILES: {
        async maskSlice(_project, _manifest, _sec, _r0, _r1) {
          sliceCalls++;
          if (sliceCalls === 2) return { error: { code: failure.code, ...(failure.field ? { field: failure.field } : {}) } };
          return { ok: { manifest: SHA('1'), width: 620, height: 1024, tileCount: 2, objectCount: 0, stackCount: 0, bytes: new Uint8Array(0) } };
        },
      },
      settleDeadlineMs: 1000, readOnlyProject: () => false, storeProject: (id) => id,
      maskSync: () => sync,
      loadTiledSection: async () => { throw new Error('must not load when slice failed'); },
      stopTiledWork: (q) => { if (q === s) stoppedOriginal = true; },
      discardEditHistory: () => { throw new Error('must not discard original history on failure'); },
      resetTiledTools: () => {},
      tileBuildDialog: () => ({ update() {}, close() {} }),
      analyze: () => {}, selectSection: () => {}, scheduleLearn: () => {}, scheduleLog: () => {},
      markDirty: () => { dirty = true; },
      toast: (msg) => toasts.push(msg),
      esc: String,
    }));

    // Banner rendering: shows split button when X1 gives 2..8 parts, hides it when too dense (> 8 parts).
    s._statsRunner = { stats: { exceeded: true, estimateBytes: STATS_BUDGET_BYTES * 2 } };
    controller.render(s);
    assert.equal(dom.secStatsWarning.hidden, false);
    assert.equal(dom.secStatsSplit.hidden, false);
    assert.equal(dom.secStatsSplit.textContent, t('tiles.split.action', { n: 3 }));
    s._statsRunner = { stats: { exceeded: true, estimateBytes: STATS_BUDGET_BYTES * 100 } };
    controller.render(s);
    assert.equal(dom.secStatsWarning.hidden, false);
    assert.equal(dom.secStatsSplit.hidden, true, 'no split button when > 8 parts');
    assert.equal(dom.secStatsMsg.textContent, t('tiles.statsLimitTooDense'));

    const result = await controller.splitSection(s, 2, { confirm: false });
    assert.equal(result, null, failure.code);
    assert.equal(sliceCalls, 2, 'stopped on part 2');
    assert.deepEqual(S.cores[0].sections, [s], 'original section stayed in place');
    assert.equal(s._savedRecord.tiled.manifest, origManifest, 'original saved version intact');
    assert.equal(stoppedOriginal, false);
    assert.equal(dirty, false);
    assert.equal(toasts.at(-1), failure.expected);
  }
  } finally { globalThis.document = prevDoc; }
});
