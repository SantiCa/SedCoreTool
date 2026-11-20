// M8.3.2: reference fixtures for engine method section.intervals/1 (docs/roadmap-engine-contract.md §4 and §5).
//
// Each fixture holds the inputs of the contract and the result of the CURRENT JavaScript calculation
// (app/js/sectionanalysis.js). The Python method of card M8.3.4 must reproduce them: exact equality for counts, row
// bounds, indices, no_data and every `_valid` column; absolute error <= 1e-9 for the floating-point columns.
// All data is synthetic and seeded; no file is read except the shared fractional-boundary fixture.
//
// Usage (repository root):
//   node tools/make_interval_fixtures.mjs           write tests/fixtures/section-intervals/*.json
//   node tools/make_interval_fixtures.mjs --check   fail if a committed file differs from a regeneration
//
// File format (one JSON line): { format, name, description, inputs, expected }
//   A numeric buffer is { dtype, shape, data: [...] } or, for the large label and exclusion images,
//   { dtype, shape, runs: [[value, count], ...] } which expands to `data` in row-major order.
//   inputs.stack_members is null when there is no overlap. expected is { dimensions, columns }; a nullable column
//   carries a `valid` array of 0/1 and holds 0 in invalid slots.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIntervalSnapshot, referenceColumns } from '../app/js/sectionanalysis.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURE_DIR = path.join(root, 'tests/fixtures/section-intervals');
const FORMAT = 'section-intervals-fixture/1';

const CLASSES = [
  { id: 'a', name: 'Planolites', counts: true }, { id: 'b', name: 'Chondrites', counts: true },
  { id: 'n', name: 'Artifact', counts: false }, { id: 'undet', name: 'Undetermined', counts: true },
];
const SETTINGS = { includePred: false, predThr: 0.5, countCandidates: false, binCm: 5, minValid: 20, noDataPad: 0 };

/** Section as the interface keeps it (labels, exclusion, objects by id, overlap stacks, depth geometry). */
function makeSection({ w, h, roi = { x0: 0, y0: 0, x1: w, y1: h }, top = 0, bottom = h, units = 'cm', objects = [], stacks = [null], manual = [] }) {
  return { w, h, roi, top, bottom, units, labels: new Int32Array(w * h), exclude: new Uint8Array(w * h), stacks,
    objects: new Map(objects.map((o) => [o.id, o])), manual, nextId: Math.max(0, ...objects.map((o) => o.id)) + 1, _mv: 0 };
}
/** Sets s[field][row, col] = value over rows [r0, r1) and columns [c0, c1). */
function paint(s, field, [r0, r1], [c0, c1], value) {
  for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) s[field][r * s.w + c] = value;
}
function seeded(seed) {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}
/** @returns {{name: string, description: string, section: any, project: any}} */
function fixture(name, description, section, { settings = {}, ageModel = null, ageUnits = null } = {}) {
  return { name, description, section, project: { classes: CLASSES, settings: { ...SETTINGS, ...settings }, ageModel, ageUnits } };
}

// ---- cases -----------------------------------------------------------------------------------------------------------

function basicFourIntervals() {
  // 10 x 20 pixels, 1 pixel per cm, 5 cm intervals => 4 intervals of 50 pixels.
  const s = makeSection({ w: 10, h: 20, objects: [{ id: 1, cls: 'a' }, { id: 2, cls: 'b' }, { id: 3, cls: 'n' }] });
  paint(s, 'labels', [0, 5], [0, 5], 1);        // interval 0: class a on 25 of 50 pixels
  paint(s, 'labels', [5, 7], [0, 10], 2);       // interval 1: class b on 20 of 50
  paint(s, 'labels', [10, 15], [0, 10], 3);     // interval 2: object of a class that does not count
  paint(s, 'exclude', [10, 15], [0, 5], 1);     //   with 25 pixels excluded
  paint(s, 'exclude', [15, 20], [0, 10], 1);    // interval 3: all excluded except 5 pixels (below the 20 % minimum)
  paint(s, 'exclude', [19, 20], [0, 5], 0);
  return fixture('basic-four-intervals', 'Assigned classes, excluded pixels, a class that does not count, minimum valid fraction.', s);
}

function predictions(on) {
  const s = makeSection({ w: 8, h: 24, objects: [
    { id: 1, cls: 'a', conf: 0 }, { id: 2, pred: 'b', conf: 0.9 }, { id: 3, pred: 'b', conf: 0.3 },
    { id: 4, conf: 0 }, { id: 5, cls: 'n', conf: 0 }, { id: 6, cls: 'b', pred: 'a', conf: 0.99 }] });
  paint(s, 'labels', [0, 6], [0, 3], 1);        // assigned class a
  paint(s, 'labels', [6, 12], [0, 4], 2);       // predicted b with confidence 0.9
  paint(s, 'labels', [12, 18], [0, 2], 3);      // predicted b with confidence 0.3 (a candidate below a 0.5 threshold)
  paint(s, 'labels', [12, 18], [2, 4], 4);      // no class and no prediction (a candidate)
  paint(s, 'labels', [18, 20], [0, 8], 5);      // assigned class that does not count
  paint(s, 'labels', [20, 24], [0, 2], 6);      // assigned b beats its own prediction of a
  const name = on ? 'predictions-and-candidates-counted' : 'predictions-and-candidates-ignored';
  return fixture(name, on ? 'Predictions at or above the threshold and undetermined candidates count.' : 'Predictions and candidates do not count.',
    s, { settings: { binCm: 6, includePred: on, predThr: 0.5, countCandidates: on } });
}

function overlapSameAndDifferentClass() {
  const s = makeSection({ w: 4, h: 4, objects: [{ id: 1, cls: 'a' }, { id: 2, cls: 'b' }, { id: 4, cls: 'a' }], stacks: [null, [1, 2], [1, 4]] });
  paint(s, 'labels', [0, 1], [0, 4], -1);      // objects of classes a and b overlap: a pixel counts once in total, once per class
  paint(s, 'labels', [1, 2], [0, 4], -2);      // two objects of class a overlap: class a counts once
  return fixture('overlap-same-and-different-class', 'Overlap stacks; class percentages add up to more than the total.', s, { settings: { binCm: 4 } });
}

function overlapWithExcludedPixels() {
  const s = makeSection({ w: 4, h: 4, objects: [{ id: 1, cls: 'a' }, { id: 2, cls: 'b' }], stacks: [null, [1, 2]] });
  paint(s, 'labels', [0, 2], [0, 4], -1);
  paint(s, 'exclude', [0, 1], [0, 2], 1);       // excluded overlap pixels leave numerator and denominator
  return fixture('overlap-with-excluded-pixels', 'Excluded pixels inside an overlap.', s, { settings: { binCm: 4 } });
}

function roiOffset() {
  const s = makeSection({ w: 6, h: 10, roi: { x0: 2, y0: 3, x1: 6, y1: 9 }, top: 0, bottom: 6, objects: [{ id: 1, cls: 'a' }] });
  paint(s, 'labels', [0, 3], [0, 6], 1);        // above the region of interest
  paint(s, 'labels', [3, 10], [0, 2], 1);       // left of it
  paint(s, 'labels', [3, 6], [2, 4], 1);        // inside: 6 of the 12 pixels of the first interval
  return fixture('roi-offset', 'A region of interest that does not start at the origin; pixels outside it are ignored.', s, { settings: { binCm: 3 } });
}

function units(unit, top, bottom) {
  const s = makeSection({ w: 6, h: 40, top, bottom, units: unit, objects: [{ id: 1, cls: 'a' }, { id: 2, cls: 'b' }] });
  for (let r = 0; r < 40; r++) if (r % 4 < 2) paint(s, 'labels', [r, r + 1], [0, 3], r < 20 ? 1 : 2);
  return fixture(`units-${unit}`, `A 40 cm section expressed in ${unit}.`, s, { settings: { binCm: 5 } });
}

function noValidPixels() {
  const s = makeSection({ w: 4, h: 8, objects: [{ id: 1, cls: 'a' }] });
  paint(s, 'labels', [0, 8], [0, 4], 1);
  paint(s, 'exclude', [0, 8], [0, 4], 1);
  return fixture('no-valid-pixels', 'Everything excluded: every interval has no data.', s, { settings: { binCm: 4 } });
}

function minValidBoundary(excluded) {
  const s = makeSection({ w: 10, h: 4, objects: [{ id: 1, cls: 'a' }] });   // one interval of 40 pixels; 20 % = 8 pixels
  paint(s, 'labels', [0, 4], [0, 10], 1);
  for (let i = 0; i < excluded; i++) s.exclude[i] = 1;
  return fixture(excluded === 32 ? 'min-valid-exactly-at-limit' : 'min-valid-one-pixel-below',
    excluded === 32 ? '8 valid pixels of 40 = exactly 20 %: data.' : '7 valid pixels of 40: no data.', s, { settings: { binCm: 4, minValid: 20 } });
}

function padding(pad, unit = 'cm') {
  const bottom = { mm: 100, cm: 10, m: 0.1 }[unit];                          // always 10 cm of core
  const s = makeSection({ w: 2, h: 10, top: 0, bottom, units: unit, objects: [{ id: 1, cls: 'a' }] });   // five intervals of 2 cm
  paint(s, 'labels', [0, 10], [0, 2], 1);
  paint(s, 'exclude', [4, 6], [0, 2], 1);                                    // the middle interval has no data
  const suffix = unit === 'cm' ? '' : `-in-${unit}`;                         // the pad is always given in cm
  return fixture(`no-data-padding-${pad}-cm${suffix}`, pad ? `A ${pad} cm pad widens the gap (section in ${unit}); intervals that only touch it stay.` : 'No padding.', s, { settings: { binCm: 2, noDataPad: pad } });
}

function predictionConfidenceAtThreshold() {
  // One row of four pixels per object; the threshold is 0.5 and the confidences sit on both sides of it, to the last bit.
  const s = makeSection({ w: 4, h: 4, objects: [{ id: 1, pred: 'b', conf: 0.5 }, { id: 2, pred: 'b', conf: 0.5000000000000001 }, { id: 3, pred: 'b', conf: 0.4999999999999999 }] });
  for (let r = 0; r < 3; r++) paint(s, 'labels', [r, r + 1], [0, 4], r + 1);
  return fixture('prediction-confidence-at-threshold', 'A prediction counts when its confidence equals the threshold, not when it is a bit below.', s,
    { settings: { binCm: 1, includePred: true, predThr: 0.5, countCandidates: false } });
}

function intervalThinnerThanOneRow() {
  const s = makeSection({ w: 3, h: 20, objects: [{ id: 1, cls: 'a' }] });    // 1 row per cm
  for (let r = 0; r < 20; r += 3) paint(s, 'labels', [r, r + 1], [0, 3], 1);
  return fixture('interval-thinner-than-one-row', 'An interval of 0.4 cm is one pixel row thick: it is raised to one row.', s, { settings: { binCm: 0.4 } });
}

/** Four 5 cm intervals with bin centres 2.5, 7.5, 12.5 and 17.5, every pixel bioturbated. */
function agesSection(name, description, ageModel, extra = {}) {
  const s = makeSection({ w: 10, h: 20, objects: [{ id: 1, cls: 'a' }], manual: extra.manual || [] });
  paint(s, 'labels', [0, 20], [0, 10], 1);
  return fixture(name, description, s, { ageModel, ageUnits: ageModel ? 'ka' : null });
}

function manualRanges() {
  return agesSection('manual-ranges', 'Half-open manual ranges; the last matching range wins; indices may be null.', null, {
    manual: [{ from: 2.5, to: 7.5, BI: 3, ii: 4 }, { from: 5, to: 15, BI: null, ii: 2 }, { from: 12.5, to: 17.5, BI: 5, ii: null }] });
}

function fractionalBoundaries() {
  const cases = JSON.parse(readFileSync(path.join(root, 'tests/fixtures/fractional-boundaries.json'), 'utf8'));
  return cases.map((c, index) => {
    const s = makeSection({ w: 1, h: c.rows, top: c.top, bottom: c.bottom, units: c.units, objects: [{ id: 1, cls: 'a' }] });
    for (let r = 0; r < c.rows; r++) if ((r * 37) % 11 < 4) s.labels[r] = 1;   // a fixed pseudo-random pattern, so a one-row shift changes counts
    return fixture(`fractional-${String(index).padStart(2, '0')}`,
      `Shared fractional-boundary case ${index}: ${c.rows} rows, ${c.units}, interval ${c.bin_cm} cm.`, s, { settings: { binCm: c.bin_cm } });
  });
}

function large() {
  const next = seeded(138501), w = 600, h = 2000;
  const objects = Array.from({ length: 150 }, (_, i) => ({ id: i + 1, cls: ['a', 'b', 'n', undefined, undefined][i % 5],
    pred: i % 5 === 3 ? 'b' : i % 5 === 4 ? 'a' : undefined, conf: next() }));
  const stacks = [null, ...Array.from({ length: 12 }, (_, k) => [1 + k * 7, 2 + k * 7, ...(k % 3 === 0 ? [3 + k * 7] : [])])];
  const s = makeSection({ w, h, top: 100, bottom: 300, units: 'cm', objects, stacks, roi: { x0: 40, y0: 30, x1: 560, y1: 1970 },
    manual: [{ from: 120, to: 160, BI: 2, ii: 3 }, { from: 150, to: 210, BI: null, ii: 5 }] });
  for (const o of objects) {
    const r0 = Math.floor(next() * (h - 130)), c0 = Math.floor(next() * (w - 70));
    paint(s, 'labels', [r0, r0 + 10 + Math.floor(next() * 110)], [c0, c0 + 5 + Math.floor(next() * 60)], o.id);
  }
  for (let k = 1; k < stacks.length; k++) { const r0 = Math.floor(next() * (h - 60)), c0 = Math.floor(next() * (w - 40)); paint(s, 'labels', [r0, r0 + 20 + Math.floor(next() * 30)], [c0, c0 + 10 + Math.floor(next() * 25)], -k); }
  for (let k = 0; k < 8; k++) { const r0 = Math.floor(next() * (h - 150)), c0 = Math.floor(next() * (w - 100)); paint(s, 'exclude', [r0, r0 + 20 + Math.floor(next() * 120)], [c0, c0 + 10 + Math.floor(next() * 90)], 1); }
  return fixture('large-mixed', '600 x 2000 pixels, 150 objects, 12 overlap stacks, exclusions, a region of interest, ages and manual ranges.', s, {
    settings: { binCm: 2.5, includePred: true, predThr: 0.6, countCandidates: true, minValid: 30, noDataPad: 3 },
    ageModel: { depth: [100, 200, 300], age: [0, 50, 120], min: [0, 40, 100], max: [0, 60, 140] }, ageUnits: 'ka' });
}

/**
 * Cases whose objects, overlaps and exclusions cross the 512-pixel tile borders in both directions (card M8.4.17): a tiled section counts them tile by
 * tile and must give exactly these columns, which come from the whole-image calculation. Python reproduces them like every other fixture.
 */
function seamObjectsAndOverlaps() {
  const s = makeSection({ w: 1300, h: 1100, top: 0, bottom: 110, units: 'cm', stacks: [null, [1, 2], [3, 4, 5], [2, 6]],
    objects: [{ id: 1, cls: 'a' }, { id: 2, cls: 'b' }, { id: 3, cls: 'a' }, { id: 4, cls: 'n' }, { id: 5, cls: 'b' }, { id: 6, cls: 'a' }] });
  paint(s, 'labels', [500, 1030], [500, 1030], 1);                      // across both borders at 512 and 1024, in both directions
  paint(s, 'labels', [100, 700], [900, 1100], 2);                       // across the vertical border at 1024
  paint(s, 'labels', [0, 1100], [255, 262], 3);                         // a thin object along the whole height, across every horizontal border
  paint(s, 'labels', [510, 514], [0, 1300], 4);                         // a thin object along the whole width, on the horizontal border at 512
  paint(s, 'labels', [600, 900], [600, 700], -1);                       // an overlap of 1 and 2 over part of object 1
  paint(s, 'labels', [1000, 1100], [1000, 1300], -2);                   // an overlap of three objects at the corner tiles
  paint(s, 'labels', [20, 60], [1250, 1300], -3);
  paint(s, 'labels', [700, 760], [20, 60], 5); paint(s, 'labels', [800, 830], [30, 90], 6);
  return fixture('seams-objects-and-overlaps', '1,300 x 1,100 pixels (3 x 3 tiles of 512): objects and overlaps across the tile borders, thin objects along them.', s, { settings: { binCm: 3 } });
}

function seamExclusionUnalignedRoi() {
  const s = makeSection({ w: 1300, h: 1100, roi: { x0: 37, y0: 311, x1: 1171, y1: 1003 }, top: 50, bottom: 120, units: 'cm', stacks: [null, [1, 2]],
    objects: [{ id: 1, cls: 'a' }, { id: 2, pred: 'b', conf: 0.8 }, { id: 3, pred: 'a', conf: 0.2 }, { id: 4 }, { id: 5, cls: 'b' }] });
  paint(s, 'labels', [300, 1010], [20, 1190], 5); paint(s, 'labels', [400, 900], [300, 1100], 1);
  paint(s, 'labels', [450, 700], [500, 1200], 2); paint(s, 'labels', [600, 800], [700, 900], -1);
  paint(s, 'labels', [850, 1000], [100, 600], 3); paint(s, 'labels', [850, 1000], [600, 900], 4);
  paint(s, 'exclude', [505, 520], [0, 1300], 1);                        // a band across the horizontal border at 512
  paint(s, 'exclude', [0, 1100], [1020, 1030], 1);                      // a band across the vertical border at 1024
  paint(s, 'exclude', [900, 1000], [40, 300], 1);
  return fixture('seams-exclusion-unaligned-roi', 'A region of interest that starts and ends inside tiles, exclusion across the borders, predictions and candidates counted, a fractional interval.',
    s, { settings: { binCm: 2.7, includePred: true, predThr: 0.5, countCandidates: true, noDataPad: 1, minValid: 25 },
      ageModel: { depth: [50, 90, 120], age: [0, 40, 100] }, ageUnits: 'ka' });
}

function seamSparseEmptyTiles() {
  const s = makeSection({ w: 1100, h: 1600, top: 0, bottom: 160, units: 'cm', objects: [{ id: 1, cls: 'a' }, { id: 2, cls: 'b' }] });
  paint(s, 'labels', [0, 40], [0, 40], 1); paint(s, 'labels', [1560, 1600], [1060, 1100], 2);   // only the corner tiles hold anything; the last row and column are partial
  paint(s, 'exclude', [1550, 1600], [0, 1100], 1);
  return fixture('seams-sparse-empty-tiles', 'Tiles with nothing in them between objects in the corners; partial tiles at the bottom and right.', s, { settings: { binCm: 10 } });
}

export function allCases() {
  const model = { depth: [0, 10], age: [0, 100], min: [0, 80], max: [0, 120] };
  return [
    basicFourIntervals(), predictions(true), predictions(false), overlapSameAndDifferentClass(), overlapWithExcludedPixels(), roiOffset(),
    units('mm', 0, 400), units('cm', 0, 40), units('m', 0, 0.4), noValidPixels(), minValidBoundary(32), minValidBoundary(33),
    padding(0), padding(2), padding(2, 'mm'), padding(2, 'm'), predictionConfidenceAtThreshold(), intervalThinnerThanOneRow(),
    agesSection('ages-with-range', 'Ages and ranges inside the model; intervals beyond its last depth have no age.', model),
    agesSection('ages-at-model-ends', 'Interval centres exactly at the first and last model depth are inside the model.', { depth: [2.5, 17.5], age: [10, 40], min: [8, 30], max: [12, 50] }),
    agesSection('ages-without-range', 'An age model without minimum and maximum.', { depth: [0, 10], age: [0, 100] }),
    agesSection('ages-no-model', 'No age model.', null),
    manualRanges(), ...fractionalBoundaries(), large(), seamObjectsAndOverlaps(), seamExclusionUnalignedRoi(), seamSparseEmptyTiles(),
  ];
}

// ---- serialisation ---------------------------------------------------------------------------------------------------

function encode(buffer, runs) {
  const data = Array.from(buffer.data);
  if (!runs) return { dtype: buffer.dtype, shape: buffer.shape, data };
  const out = [];
  for (const value of data) { const last = out[out.length - 1]; if (last && last[0] === value) last[1] += 1; else out.push([value, 1]); }
  return { dtype: buffer.dtype, shape: buffer.shape, runs: out };
}

function serialise({ name, description, section, project }) {
  const inputs = buildIntervalSnapshot(section, project);
  const document = {
    format: FORMAT, name, description,
    inputs: { ...inputs, labels: encode(inputs.labels, true), exclude: encode(inputs.exclude, true),
      stack_offsets: encode(inputs.stack_offsets, false), stack_members: inputs.stack_members && encode(inputs.stack_members, false) },
    expected: referenceColumns(section, project),
  };
  return `${JSON.stringify(document)}\n`;
}

/** @returns {Map<string, string>} file name -> exact file text */
export function buildFixtures() {
  const files = new Map();
  for (const c of allCases()) {
    const file = `${c.name}.json`;
    if (files.has(file)) throw new Error(`Duplicate fixture name ${c.name}`);
    files.set(file, serialise(c));
  }
  return files;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = buildFixtures();
  if (process.argv.includes('--check')) {
    const committed = existsSync(FIXTURE_DIR) ? readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json')) : [];
    const problems = [...files.keys()].filter((f) => !committed.includes(f) || readFileSync(path.join(FIXTURE_DIR, f), 'utf8').replace(/\r\n/g, '\n') !== files.get(f))
      .concat(committed.filter((f) => !files.has(f)));
    if (problems.length) { console.error(`Fixtures differ from a regeneration: ${problems.join(', ')}`); process.exit(1); }
    console.log(`${files.size} fixtures match a regeneration`);
  } else {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    for (const [file, text] of files) writeFileSync(path.join(FIXTURE_DIR, file), text);
    const bytes = [...files.values()].reduce((sum, text) => sum + text.length, 0);
    console.log(`${files.size} fixtures written to ${path.relative(root, FIXTURE_DIR)} (${(bytes / 1024).toFixed(0)} KiB)`);
  }
}
