// Card M8.4.17 step 8: how long the interval table of a tiled section takes, measured with the page's own code (tiledcounts.js, sectionanalysis.js)
// on a synthetic section of the size of the `rgb8g` fixture (8,192 x 349,526 pixels, 16 x 683 = 10,928 tiles of 512). Masks fill a stated fraction of the
// tiles with rectangles of objects, a few overlaps and exclusions. Writes a JSON record.
//   node tools/measure_tiled_counts.mjs --out docs/validation/M8.4.17-tiled-counts.json [--fill 0.03] [--edits 60]
//
// Scenario (b) of contract §7, "interval table after an edit that touches at most 4 tiles": from the analysis request (the edit's tiles are queued; the
// 100 ms grouping delay of the interface is not part of it, as the contract says) to the published table: counting the 4 tiles, the effective classes,
// the aggregation of the totals and the binning. Scenario (a), "a setting changed for the whole project (interval size)": the table again, with the totals kept.
import fs from 'node:fs';
import os from 'node:os';
import { TILE } from '../app/js/tiledsection.js';
import { MaskTiles } from '../app/js/tiledmasks.js';
import { TiledRowCounts, TiledCountsRunner } from '../app/js/tiledcounts.js';
import { binsFromRowCounts, binRowsOfSection, effectiveClassIndex } from '../app/js/sectionanalysis.js';

const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const out = arg('--out', null), fill = Number(arg('--fill', '0.03')), edits = Number(arg('--edits', '60'));
const WIDTH = 8192, HEIGHT = 349_526;
let state = 20261118;
const rand = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const classes = ['burrow', 'planolites', 'thalassinoides', 'chondrites', 'skolithos', 'other'].map((name, k) => ({ id: 'c' + k, name, counts: k < 5 }));
const settings = { includePred: false, predThr: 0.5, countCandidates: false, binCm: 1, minValid: 20, noDataPad: 0 };
const project = { classes, settings, ageModel: null };

const tiles = new MaskTiles({ width: WIDTH, height: HEIGHT, budget: Infinity });
const section = { top: 0, bottom: HEIGHT / 100, units: 'cm', manual: [], objects: new Map(), nextId: 1, stacks: [null], roi: { x0: 0, y0: 0, x1: WIDTH, y1: HEIGHT } };
const area = { x0: 0, y0: 0, x1: WIDTH, y1: HEIGHT };                                   // ds = 1: the analysis area is the whole image
const newObject = (cls) => { const o = { id: section.nextId++, cls, pred: null, conf: 0 }; section.objects.set(o.id, o); return o; };

/** Paint `rects` rectangles of one object each, inside the tile (row, col), into a copy of its arrays; returns them. */
function paintTile(row, col, rects, withExclusion) {
  const entry = tiles.get(row, col), labels = entry?.labels ? entry.labels.slice() : new Int32Array(TILE * TILE), exclude = entry?.exclude ? entry.exclude.slice() : new Uint8Array(TILE * TILE);
  for (let r = 0; r < rects; r++) {
    const o = newObject(classes[Math.floor(rand() * classes.length)].id);
    const x0 = Math.floor(rand() * 440), y0 = Math.floor(rand() * 440), w = 4 + Math.floor(rand() * 60), h = 4 + Math.floor(rand() * 60);
    for (let y = y0; y < Math.min(TILE, y0 + h); y++) for (let x = x0; x < Math.min(TILE, x0 + w); x++) labels[y * TILE + x] = o.id;
  }
  if (withExclusion) for (let y = 100; y < 120; y++) exclude.fill(1, y * TILE + 200, y * TILE + 300);
  tiles.set(row, col, labels, exclude);
}

const rows = tiles.rows, cols = tiles.cols, total = rows * cols;
let filled = 0;
const build = performance.now();
for (let i = 0; i < total; i++) if (rand() < fill) { paintTile(Math.floor(i / cols), i % cols, 12, rand() < 0.2); filled++; }
const buildMs = Math.round(performance.now() - build);

const counts = new TiledRowCounts({ width: WIDTH, height: HEIGHT, rows, cols }, { nonEmpty: () => [...tiles.entries.keys()] });
const runner = new TiledCountsRunner({ tiles, counts });

/** What `analyzeTiled` of app.js does, without the interface. @returns {{bins: any[], ms: number}} */
function analyse() {
  const started = performance.now();
  counts.setArea(area);
  if (runner.flush().length) throw new Error('a tile is not in the page');
  const eff = effectiveClassIndex(section, classes, settings);
  const rc = counts.rowCounts({ effClass: eff, nClasses: classes.length, stacks: section.stacks, area });
  const counted = { top: section.top, bottom: section.bottom, units: section.units, roi: { y0: area.y0, y1: area.y1 } };
  const bins = binsFromRowCounts(section, rc, project, binRowsOfSection(counted, settings));
  return { bins, ms: performance.now() - started };
}
const percentile = (values, p) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]; };
const summary = (values) => ({ n: values.length, median: +percentile(values, 0.5).toFixed(2), p95: +percentile(values, 0.95).toFixed(2), max: +Math.max(...values).toFixed(2) });

const first = analyse();                                                                  // counts every tile with content and aggregates once
const firstMs = Math.round(first.ms);

// Scenario (b): 60 edits, each a stroke over a block of 2 x 2 tiles with a new object (so the effective classes array grows, as in the interface).
const editMs = [];
for (let k = 0; k < edits; k++) {
  const row = Math.floor(rand() * (rows - 1)), col = Math.floor(rand() * (cols - 1)), touched = [];
  const o = newObject('c0');
  for (const [r, c] of [[row, col], [row + 1, col], [row, col + 1], [row + 1, col + 1]]) {
    const entry = tiles.get(r, c), labels = entry?.labels ? entry.labels.slice() : new Int32Array(TILE * TILE);
    for (let y = 200; y < 320; y++) labels.fill(o.id, y * TILE + 150, y * TILE + 400);
    tiles.set(r, c, labels, entry?.exclude ? entry.exclude.slice() : null);
    touched.push([r, c]);
  }
  counts.markChanged(touched);
  editMs.push(analyse().ms);
}

// Scenario (a): the interval size changes; nothing is counted again, only the binning.
const binMs = [];
for (const binCm of [0.5, 2, 5, 1, 0.25, 10, 1, 3, 0.75, 1]) {
  settings.binCm = binCm;
  binMs.push(analyse().ms);
}
settings.binCm = 1;

// Reported: a change of the effective classes (a reclassified object) aggregates every histogram again; no tile is read.
const classMs = [];
for (let k = 0; k < 5; k++) {
  const o = section.objects.get(1 + Math.floor(rand() * (section.nextId - 1)));
  o.cls = classes[(classes.findIndex((c) => c.id === o.cls) + 1) % classes.length].id;
  classMs.push(analyse().ms);
}

// Reported: the analysis area's columns change (x0 moves by 1,000 pixels): the tile columns whose span changed are counted again, here from the page.
const columnMs = [];
for (const x0 of [1000, 0, 1500, 0]) {
  area.x0 = x0;
  columnMs.push(analyse().ms);
}

// The incremental totals equal a fresh counter's, after all of this.
const final = analyse();
const fresh = new TiledRowCounts({ width: WIDTH, height: HEIGHT, rows, cols }, { nonEmpty: () => [...tiles.entries.keys()] });
const freshRunner = new TiledCountsRunner({ tiles, counts: fresh });
fresh.setArea(area); freshRunner.flush();
const rc = fresh.rowCounts({ effClass: effectiveClassIndex(section, classes, settings), nClasses: classes.length, stacks: section.stacks, area });
const kept = counts.rowCounts({ effClass: effectiveClassIndex(section, classes, settings), nClasses: classes.length, stacks: section.stacks, area });
let equal = rc.nRows === kept.nRows;
for (let i = 0; equal && i < rc.valid.length; i++) equal = rc.valid[i] === kept.valid[i] && rc.bio[i] === kept.bio[i];
for (let i = 0; equal && i < rc.cls.length; i++) equal = rc.cls[i] === kept.cls[i];

const record = {
  date: new Date().toISOString(), computer: `${os.type()} ${os.release()}, ${os.cpus()[0].model.trim()}, ${Math.round(os.totalmem() / 2 ** 30)} GiB`, node: process.version,
  section: { width: WIDTH, height: HEIGHT, tiles: total, tilesWithContent: filled, fill, objects: section.objects.size, bins: final.bins.length, buildMs },
  firstCountMs: firstMs,
  scenarioB_editOf4TilesMs: { ...summary(editMs), target_p95: 150 },
  scenarioA_intervalSizeChangeMs: { ...summary(binMs), target_p95: 300, note: 'one section; the totals are kept, only the binning runs' },
  reported_classChangeAggregationMs: summary(classMs),
  reported_areaColumnsChangeMs: summary(columnMs),
  memory: { histogramBytes: counts.bytes, histograms: counts.hists.size, budgetBytes: 64 * 2 ** 20, maskTilesBytes: tiles.bytes },
  incrementalEqualsFresh: equal,
};
console.log(JSON.stringify(record, null, 2));
if (out) fs.writeFileSync(out, JSON.stringify(record, null, 2) + '\n');
if (!equal) process.exit(1);
