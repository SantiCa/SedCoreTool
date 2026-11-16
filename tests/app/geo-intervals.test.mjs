// Card M2.1.6, step 1: which samples fall in which intervals, today. These tests pass on the code that scans every interval for every sample and on
// the code that answers with an interval lookup. The references below are copies of the implementation of 16 November 2026 (exact equality).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSamples, intervalsOnAxis, labelSamples, seededRandom } from '../../app/js/geo.js';

function referenceCategoryColumns(samples, core, cfg, layers) {
  const ivs = intervalsOnAxis((cfg.intervals || []).filter((q) => q.core === (core.id ?? core.name) && !q.auto), cfg.axis, core);
  return samples.map((r) => layers.flatMap((l) => l.cats.map((c) => (ivs.some((q) => q.layer === l.id && (q.cat ?? q.label) === c.id && r.x >= q.from && r.x < q.to) ? 1 : 0))));
}
function referenceLabelSamples(samples, { intervals = [], axis, cores, layer = null }) {
  const byCore = new Map(cores.map((c) => [c.id ?? c.name, c]));
  const iv = intervals.filter((q) => !q.auto && (layer == null || q.layer === layer)).flatMap((q) => intervalsOnAxis([q], axis, byCore.get(q.core)));
  return samples.map((s) => {
    const hit = iv.find((q) => q.core === s.core && s.x >= q.from && s.x < q.to);
    return hit ? { label: hit.cat ?? hit.label, source: 'interval' } : { label: null, source: null };
  });
}

function fixture(random, { coresCount = 2, rows = 90 } = {}) {
  const cores = Array.from({ length: coresCount }, (_, k) => {
    const depth = Array.from({ length: rows }, (_, i) => i * 2 + k);
    const age = depth.map((d) => d * 10 + 3);
    return { id: `core${k}`, name: `Core ${k}`, depth, age, proxies: { A: depth.map((d) => Math.sin(d / 5)), B: depth.map((d) => (d * 7) % 11) } };
  });
  const layers = [
    { id: 'L1', name: 'Layer 1', cats: [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }] },
    { id: 'L2', name: 'Layer 2', cats: [{ id: 'x', name: 'x' }] },
  ];
  const intervals = [];
  for (let n = 0; n < 60; n++) {
    const core = cores[Math.floor(random() * cores.length)], axis = random() < 0.5 ? 'depth' : 'age', scale = axis === 'depth' ? 1 : 10;
    const from = Math.round(random() * 170) * scale, to = from + Math.round(random() * 30) * scale;     // some are empty (to == from): they never match
    const layer = layers[Math.floor(random() * layers.length)], cat = layer.cats[Math.floor(random() * layer.cats.length)];
    intervals.push({ id: `i${n}`, core: core.id, layer: layer.id, axis, from, to, cat: random() < 0.8 ? cat.id : undefined, label: cat.id, auto: random() < 0.15 });
  }
  // Boundaries shared between neighbours and an exact duplicate: half-open ends and "first match wins" must be kept.
  intervals.push({ id: 'n1', core: 'core0', layer: 'L1', axis: 'depth', from: 10, to: 20, cat: 'a' }, { id: 'n2', core: 'core0', layer: 'L1', axis: 'depth', from: 20, to: 30, cat: 'b' },
    { id: 'n3', core: 'core0', layer: 'L1', axis: 'depth', from: 10, to: 20, cat: 'b' });
  return { cores, layers, intervals };
}

test('buildSamples: the 0/1 column of every layer category equals "some interval of that category contains the sample" (half-open, any overlap)', () => {
  const random = seededRandom(138501);
  let ones = 0, zeros = 0;
  for (let round = 0; round < 6; round++) {
    const { cores, layers, intervals } = fixture(random);
    for (const axis of ['depth', 'age']) {
      const cfg = { axis, step: axis === 'depth' ? 1 : 10, features: ['A', 'B'], ratios: [], logs: [], scaling: 'none', maxGap: null, layers, intervals };
      const samples = buildSamples(cores, cfg);
      assert.ok(samples.length > 100);
      for (const core of cores) {
        const mine = samples.filter((s) => s.core === core.id), expected = referenceCategoryColumns(mine, core, cfg, layers);
        mine.forEach((s, i) => { assert.deepEqual(s.raw.slice(2), expected[i], `${core.id} ${axis} x=${s.x}`); for (const v of s.raw.slice(2)) if (v) ones++; else zeros++; });
      }
    }
  }
  assert.ok(ones > 200 && zeros > 200, `the fixture must exercise both outcomes (${ones} ones, ${zeros} zeros)`);
});

test('buildSamples: intervals with non-finite or reversed ends and string numbers behave as before', () => {
  const random = seededRandom(5);
  const { cores, layers } = fixture(random, { coresCount: 1, rows: 40 });
  const intervals = [
    { core: 'core0', layer: 'L1', axis: 'depth', from: 10, to: 30, cat: 'a' },
    { core: 'core0', layer: 'L1', axis: 'depth', from: 25, to: 15, cat: 'b' },            // reversed: never matches
    { core: 'core0', layer: 'L1', axis: 'depth', from: 40, to: Infinity, cat: 'b' },       // open end
    { core: 'core0', layer: 'L2', axis: 'depth', from: '50', to: '60', cat: 'x' },         // strings are coerced by the comparison
    { core: 'core0', layer: 'L2', axis: 'depth', from: NaN, to: 20, cat: 'x' },
    { core: 'core0', layer: 'nope', axis: 'depth', from: 0, to: 100, cat: 'a' },           // a layer that is not requested
  ];
  const cfg = { axis: 'depth', step: 1, features: ['A'], ratios: [], logs: [], scaling: 'none', maxGap: null, layers, intervals };
  const samples = buildSamples(cores, cfg), expected = referenceCategoryColumns(samples, cores[0], cfg, layers);
  samples.forEach((s, i) => assert.deepEqual(s.raw.slice(1), expected[i], `x=${s.x}`));
});

test('labelSamples: the first matching interval wins; other cores, auto intervals and other layers are ignored', () => {
  const random = seededRandom(99);
  for (let round = 0; round < 6; round++) {
    const { cores, intervals } = fixture(random);
    for (const axis of ['depth', 'age']) {
      const samples = buildSamples(cores, { axis, step: axis === 'depth' ? 1 : 10, features: ['A'], ratios: [], logs: [], scaling: 'none', maxGap: null });
      for (const layer of [null, 'L1', 'L2']) {
        const got = labelSamples(samples, { intervals, rules: [], axis, cores, layer, features: ['A'] });
        assert.deepEqual(got, referenceLabelSamples(samples, { intervals, axis, cores, layer }), `${axis} layer=${layer}`);
      }
    }
  }
});

test('labelSamples: intervals of an unknown core are ignored and no intervals gives no labels', () => {
  const { cores } = fixture(seededRandom(3), { coresCount: 1, rows: 20 });
  const samples = buildSamples(cores, { axis: 'depth', step: 1, features: ['A'], ratios: [], logs: [], scaling: 'none', maxGap: null });
  const lost = [{ core: 'ghost', layer: 'L1', axis: 'depth', from: 0, to: 100, cat: 'a' }];
  assert.deepEqual(labelSamples(samples, { intervals: lost, rules: [], axis: 'depth', cores, features: ['A'] }), referenceLabelSamples(samples, { intervals: lost, axis: 'depth', cores }));
  assert.ok(labelSamples(samples, { intervals: [], rules: [], axis: 'depth', cores, features: ['A'] }).every((l) => l.label === null));
});

test('labelSamples: the fixture labels some samples and leaves others unlabelled (the comparison is not trivial)', () => {
  const { cores, intervals } = fixture(seededRandom(138501));
  const samples = buildSamples(cores, { axis: 'depth', step: 1, features: ['A'], ratios: [], logs: [], scaling: 'none', maxGap: null });
  const labels = labelSamples(samples, { intervals, rules: [], axis: 'depth', cores, features: ['A'] });
  assert.ok(labels.filter((l) => l.label).length > 50 && labels.filter((l) => !l.label).length > 50);
});
