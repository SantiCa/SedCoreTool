import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildFixtures, FIXTURE_DIR, FORMAT } from '../../tools/make_core_depths_fixtures.mjs';
import { invertModel, toAxis } from '../../app/js/log.js';

const FILES = readdirSync(FIXTURE_DIR).filter((f) => f !== 'README.md').sort();
const bytes = (file) => readFileSync(path.join(FIXTURE_DIR, file));
const load = (file) => JSON.parse(bytes(file).toString('utf8'));
const JSON_FILES = FILES.filter((f) => f.endsWith('.json'));

/** Query ages and expected depths of a case, from arrays or from its binary files; missing = null. */
function columns(doc) {
  const { query } = doc.inputs, { depths } = doc.expected;
  if (!query.age_file) return { age: query.age, depth: depths.depth };
  const read = (file, valid) => {
    const values = bytes(file), flags = bytes(valid);
    assert.equal(values.length, flags.length * 8);
    return Array.from(flags, (flag, i) => (flag ? values.readDoubleLE(i * 8) : null));
  };
  assert.equal(bytes(query.age_file).length, query.rows * 8);
  return { age: read(query.age_file, query.valid_file), depth: read(depths.depth_file, depths.valid_file) };
}

/** The contract rule of core.depths/1 (§9.10), written independently of interpAge (linear scan, explicit stable sort). */
function ruleDepth(model, a) {
  if (a == null) return null;
  const pairs = model.age.map((age, i) => ({ age, depth: model.depth[i], i })).sort((p, q) => p.age - q.age || p.i - q.i);
  const n = pairs.length;
  if (a < pairs[0].age || a > pairs[n - 1].age) return null;
  let lo = 0;
  for (let k = 0; k < n; k++) if (pairs[k].age <= a) lo = k;
  lo = Math.min(lo, n - 2);
  const hi = lo + 1, span = pairs[hi].age - pairs[lo].age;
  return span ? pairs[lo].depth + ((a - pairs[lo].age) / span) * (pairs[hi].depth - pairs[lo].depth) : pairs[lo].depth;
}

test('the generator writes the same bytes twice and the committed fixtures are what it writes', () => {
  const first = buildFixtures(), second = buildFixtures();
  assert.deepEqual([...first.keys()].sort(), FILES, 'same set of files');
  for (const [file, content] of first) {
    assert.ok(Buffer.from(content).equals(Buffer.from(second.get(file))), `${file} differs between two runs`);
    const committed = typeof content === 'string' ? Buffer.from(bytes(file).toString('utf8').replace(/\r\n/g, '\n')) : bytes(file);
    assert.ok(committed.equals(Buffer.from(content)), `${file} differs from a regeneration; run node tools/make_core_depths_fixtures.mjs only if the change is intended and reviewed`);
  }
});

test('the command line writes the same bytes into another folder', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'core-depths-'));
  try {
    execFileSync(process.execPath, [fileURLToPath(new URL('../../tools/make_core_depths_fixtures.mjs', import.meta.url)), '--out', dir], { stdio: 'pipe' });
    assert.deepEqual(readdirSync(dir).sort(), FILES);
    for (const [file, content] of buildFixtures()) assert.ok(readFileSync(path.join(dir, file)).equals(Buffer.from(content)), file);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('every fixture meets the contract of core.depths/1 and agrees exactly with the current toAxis', () => {
  assert.equal(JSON_FILES.length, 11);
  for (const file of JSON_FILES) {
    const doc = load(file), { age_model: m, settings } = doc.inputs, where = `${doc.name}: `;
    assert.equal(doc.format, FORMAT); assert.equal(file, `${doc.name}.json`); assert.deepEqual(settings, { version: 1 });
    // Model (contract §9.8, reused by §9.10).
    assert.ok(m.depth.length >= 2 && m.age.length === m.depth.length, where + 'model rows');
    assert.ok(m.depth.every((d, i) => Number.isFinite(d) && Number.isFinite(m.age[i]) && (i === 0 || d > m.depth[i - 1])), where + 'depth strictly increasing');
    assert.equal('age_min' in m, 'age_max' in m, where + 'range columns come together');
    const model = { depth: m.depth, age: m.age, min: m.age_min, max: m.age_max }, inverse = invertModel(model);
    const { age, depth } = columns(doc);
    const first = Math.min(...m.age), last = Math.max(...m.age);
    assert.equal(depth.length, age.length);
    assert.equal(inverse.depth[0], first); assert.equal(inverse.depth.at(-1), last);
    let outside = 0;
    age.forEach((a, i) => {
      const out = a != null && (a < first || a > last);
      if (out) outside++;
      const expected = a == null ? null : toAxis(a, 'age', 'depth', model);
      assert.ok(Object.is(depth[i], expected), `${where}depth at row ${i}: ${depth[i]} vs ${expected}`);   // bit-identical (Z4)
      assert.ok(Object.is(depth[i], ruleDepth(m, a)), `${where}contract rule at row ${i}: ${depth[i]} vs ${ruleDepth(m, a)}`);
      if (out || a == null) assert.equal(depth[i], null, where + 'missing outside the model and for a missing age (no extrapolation)');
    });
    assert.deepEqual(doc.expected.summary, { rows: age.length, outside }, where + 'summary');
    // Coverage the card asks for: every model age, both ends, just outside, missing ages.
    const present = new Set(age);
    assert.ok(m.age.every((a) => present.has(a)), where + 'every model age is queried');
    assert.ok(present.has(null) && age.some((a) => a != null && a < first) && age.some((a) => a != null && a > last), where + 'missing and outside ages');
    assert.ok(present.has(first - 1e-9) && present.has(last + 1e-9) && present.has(first) && present.has(last), where + 'both ends and just outside');
  }
});

test('fixtures keep the properties they were made to show', () => {
  const small = load('two-rows.json');
  assert.deepEqual(small.inputs.age_model, { depth: [2, 12], age: [5, 25] });
  assert.deepEqual(small.expected.depths.depth.slice(0, 3), [2, 12, 7]);
  const reversed = load('two-rows-reversal.json');
  assert.equal(reversed.expected.reversals, 1);
  assert.deepEqual(reversed.expected.depths.depth.slice(0, 3), [2, 12, 7]);     // queries 30, 10, 20: the inverse swaps the rows; linear between them
  const equal = load('two-rows-equal-ages.json');
  assert.equal(equal.expected.equal_neighbour_ages, 1);
  assert.equal(equal.expected.depths.depth[0], 2);                              // span 0: the depth of the first row of the inverse (stable sort)
  assert.ok('age_min' in load('two-rows-with-range.json').inputs.age_model && 'age_min' in load('rows-1000-reversals-equal-ages.json').inputs.age_model);
  for (const name of ['rows-1000-reversals', 'rows-1000-reversals-with-range', 'rows-1000-reversals-equal-ages', 'rows-1000-random-100000']) assert.ok(load(`${name}.json`).expected.reversals > 10, name);
  for (const name of ['rows-1000-equal-ages', 'rows-1000-reversals-equal-ages', 'rows-1000-random-100000']) assert.ok(load(`${name}.json`).expected.equal_neighbour_ages > 10, name);
  for (const name of ['rows-1000', 'rows-1000-with-range']) assert.equal(load(`${name}.json`).expected.reversals, 0, name);
  assert.equal(load('rows-1000-random-100000.json').inputs.query.rows, 102010);   // 100,000 random ages + 2,010 fixed ones
  assert.equal(load('rows-1000.json').inputs.age_model.depth.length, 1000);
});
