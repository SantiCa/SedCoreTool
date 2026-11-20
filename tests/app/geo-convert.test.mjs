// Card M2.1.5, step 1: what coreConvert and buildSamples do today. These tests must pass on the code before the change
// (the per-call implementation) and on the code after it (a converter prepared once per core). The reference below is a copy of the
// implementation of 16 November 2026; it stays in this file so that "old equals new" can be checked exactly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSamples, coreAges, coreConvert, seededRandom } from '../../app/js/geo.js';
import { interpAge } from '../../app/js/core.js';

function referenceConvert(core, v, from, to, clamp = false) {
  if (from === to || v == null) return v;
  const ages = coreAges(core); if (!ages || !core.depth) return null;
  const pairs = core.depth.map((d, i) => [d, ages[i]]).filter((p) => p[0] != null && p[1] != null);
  if (!pairs.length) return null;
  const src = from === 'depth' ? 0 : 1, dst = 1 - src;
  pairs.sort((a, b) => a[src] - b[src]);
  if (clamp) v = Math.min(pairs[pairs.length - 1][src], Math.max(pairs[0][src], v));
  return interpAge({ depth: pairs.map((p) => p[src]), age: pairs.map((p) => p[dst]) }, v);
}

const core = (depth, age) => ({ name: 'C', depth, age });

test('coreConvert: linear interpolation between rows, both directions', () => {
  const c = core([0, 10, 20, 30], [0, 100, 200, 400]);
  assert.equal(coreConvert(c, 15, 'depth', 'age'), 150);
  assert.equal(coreConvert(c, 250, 'age', 'depth'), 22.5);
  assert.equal(coreConvert(c, 20, 'depth', 'age'), 200);                   // a row's own value is exact
  assert.equal(coreConvert(c, 400, 'age', 'depth'), 30);                   // the last row belongs to the relation
});

test('coreConvert: same axis and missing values pass through; no relation gives null', () => {
  const c = core([0, 10], [0, 100]);
  assert.equal(coreConvert(c, 7, 'depth', 'depth'), 7);
  assert.equal(coreConvert(c, null, 'depth', 'age'), null);
  assert.equal(coreConvert(c, undefined, 'depth', 'age'), undefined);
  assert.equal(coreConvert({ name: 'no depth', age: [0, 1] }, 1, 'depth', 'age'), null);
  assert.equal(coreConvert({ name: 'nothing' }, 1, 'depth', 'age'), null);
  assert.equal(coreConvert(core([null, null], [1, 2]), 1, 'depth', 'age'), null);   // no complete pair
});

test('coreConvert: outside the relation it is null unless clamped; clamping uses the first and last pair', () => {
  const c = core([5, 10, 20], [50, 100, 300]);
  assert.equal(coreConvert(c, 4, 'depth', 'age'), null);
  assert.equal(coreConvert(c, 21, 'depth', 'age'), null);
  assert.equal(coreConvert(c, 4, 'depth', 'age', true), 50);
  assert.equal(coreConvert(c, 21, 'depth', 'age', true), 300);
  assert.equal(coreConvert(c, 1000, 'age', 'depth', true), 20);
  assert.equal(coreConvert(c, -1000, 'age', 'depth', true), 5);
});

test('coreConvert: unsorted rows, rows with a missing member, repeated values and a single pair', () => {
  const sorted = core([0, 10, 20, 30], [0, 100, 200, 400]);
  const shuffled = core([20, 0, 30, 10, null], [200, 0, 400, 100, 999]);        // a row whose depth is missing is ignored
  const holes = core([0, 10, 20, 30, 40], [0, 100, null, 400, null]);          // rows with a missing age are ignored
  for (const v of [0, 5, 15, 25, 30]) assert.equal(coreConvert(shuffled, v, 'depth', 'age'), coreConvert(sorted, v, 'depth', 'age'));
  assert.equal(coreConvert(holes, 20, 'depth', 'age'), 250);                   // interpolated between 10 -> 100 and 30 -> 400
  assert.equal(coreConvert(core([10, 10], [1, 2]), 10, 'depth', 'age') != null, true);
  assert.equal(coreConvert(core([10], [1]), 10, 'depth', 'age'), 1);
  assert.equal(coreConvert(core([10], [1]), 11, 'depth', 'age'), null);
});

test('coreConvert: ages from the age-model text when the core has no age column', () => {
  const c = { name: 'model', depth: [0, 10, 20], ageText: '0\t0\n10\t100\n20\t400' };
  const ages = coreAges(c);
  assert.deepEqual(ages, [0, 100, 400]);
  assert.equal(coreConvert(c, 15, 'depth', 'age'), 250);
  assert.equal(coreConvert(c, 250, 'age', 'depth'), 15);
});

test('coreConvert equals the reference exactly on random cores (nulls, unsorted, repeated, clamp on and off)', () => {
  const random = seededRandom(138501);
  for (let n = 0; n < 300; n++) {
    const rows = Math.floor(random() * 40);
    const depth = Array.from({ length: rows }, () => (random() < 0.1 ? null : Math.round(random() * 400) / 4));
    const age = Array.from({ length: rows }, () => (random() < 0.1 ? null : Math.round(random() * 4000) / 4));
    const c = random() < 0.1 ? { name: 'age only', age } : core(depth, age);
    for (let k = 0; k < 12; k++) {
      const v = random() < 0.1 ? null : Math.round((random() * 500 - 50) * 4) / 4;
      for (const [from, to] of [['depth', 'age'], ['age', 'depth'], ['depth', 'depth']]) for (const clamp of [false, true]) {
        assert.ok(Object.is(coreConvert(c, v, from, to, clamp), referenceConvert(c, v, from, to, clamp)), `core ${n} ${from}->${to} v=${v} clamp=${clamp}`);
      }
    }
  }
});

test('buildSamples: the depth and age of every sample are the conversions of its grid value', () => {
  const random = seededRandom(7);
  for (const axis of ['depth', 'age']) {
    const depth = Array.from({ length: 80 }, (_, i) => i * 2.5);
    const age = depth.map((d, i) => d * 11 + Math.round(random() * 3));          // increasing, with small irregularities
    const c = { id: 'c1', name: 'C1', depth, age, proxies: { A: depth.map((d) => Math.sin(d / 7)), B: depth.map((d) => d % 9) } };
    const samples = buildSamples([c], { axis, step: axis === 'depth' ? 1.5 : 20, features: ['A', 'B'], ratios: [], logs: [], scaling: 'none', maxGap: null });
    assert.ok(samples.length > 50);
    for (const s of samples) {
      assert.ok(Object.is(s.depth, axis === 'depth' ? s.x : referenceConvert(c, s.x, 'age', 'depth')), `depth at ${s.x}`);
      assert.ok(Object.is(s.age, axis === 'age' ? s.x : referenceConvert(c, s.x, 'depth', 'age')), `age at ${s.x}`);
    }
  }
});
