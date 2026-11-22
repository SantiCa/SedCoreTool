import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildFixtures, FIXTURE_DIR, FORMAT } from '../../tools/make_core_ages_fixtures.mjs';
import { interpAge, interpAgeRange } from '../../app/js/core.js';

const FILES = readdirSync(FIXTURE_DIR).filter((f) => f !== 'README.md').sort();
const bytes = (file) => readFileSync(path.join(FIXTURE_DIR, file));
const load = (file) => JSON.parse(bytes(file).toString('utf8'));
const JSON_FILES = FILES.filter((f) => f.endsWith('.json'));

/** Query depths and expected columns of a case, from arrays or from its binary files; missing = null. */
function columns(doc) {
  const { query } = doc.inputs, { ages } = doc.expected;
  if (!query.depth_file) return { depth: query.depth, age: ages.age, age_min: ages.age_min ?? null, age_max: ages.age_max ?? null };
  const read = (file, valid) => {
    const values = bytes(file), flags = bytes(valid);
    assert.equal(values.length, flags.length * 8);
    return Array.from(flags, (flag, i) => (flag ? values.readDoubleLE(i * 8) : null));
  };
  assert.equal(bytes(query.depth_file).length, query.rows * 8);
  return { depth: read(query.depth_file, query.valid_file), age: read(ages.age_file, ages.valid_file), age_min: null, age_max: null };
}

test('the generator writes the same bytes twice and the committed fixtures are what it writes', () => {
  const first = buildFixtures(), second = buildFixtures();
  assert.deepEqual([...first.keys()].sort(), FILES, 'same set of files');
  for (const [file, content] of first) {
    assert.ok(Buffer.from(content).equals(Buffer.from(second.get(file))), `${file} differs between two runs`);
    const committed = typeof content === 'string' ? Buffer.from(bytes(file).toString('utf8').replace(/\r\n/g, '\n')) : bytes(file);
    assert.ok(committed.equals(Buffer.from(content)), `${file} differs from a regeneration; run node tools/make_core_ages_fixtures.mjs only if the change is intended and reviewed`);
  }
});

test('the command line writes the same bytes into another folder', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'core-ages-'));
  try {
    execFileSync(process.execPath, [fileURLToPath(new URL('../../tools/make_core_ages_fixtures.mjs', import.meta.url)), '--out', dir], { stdio: 'pipe' });
    assert.deepEqual(readdirSync(dir).sort(), FILES);
    for (const [file, content] of buildFixtures()) assert.ok(readFileSync(path.join(dir, file)).equals(Buffer.from(content)), file);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('every fixture meets the contract of core.ages/1 and agrees with the current interpAge and interpAgeRange', () => {
  assert.equal(JSON_FILES.length, 8);
  for (const file of JSON_FILES) {
    const doc = load(file), { age_model: m, settings } = doc.inputs, where = `${doc.name}: `;
    assert.equal(doc.format, FORMAT); assert.equal(file, `${doc.name}.json`); assert.deepEqual(settings, { version: 1 });
    // Model (contract §9.8): at least 2 rows, nothing missing, depth strictly increasing, range columns together with min <= age <= max.
    assert.ok(m.depth.length >= 2 && m.age.length === m.depth.length, where + 'model rows');
    assert.ok(m.depth.every((d, i) => Number.isFinite(d) && Number.isFinite(m.age[i]) && (i === 0 || d > m.depth[i - 1])), where + 'depth strictly increasing');
    assert.equal('age_min' in m, 'age_max' in m, where + 'range columns come together');
    const range = 'age_min' in m;
    if (range) assert.ok(m.age.every((a, i) => m.age_min[i] <= a && a <= m.age_max[i]), where + 'range contains the age');
    // Result: recomputed row by row with today's functions.
    const { depth, age, age_min, age_max } = columns(doc), model = { depth: m.depth, age: m.age, min: m.age_min, max: m.age_max };
    const first = m.depth[0], last = m.depth.at(-1);
    assert.equal(age.length, depth.length);
    let outside = 0;
    depth.forEach((d, i) => {
      const out = d != null && (d < first || d > last);
      if (out) outside++;
      assert.equal(age[i], d == null ? null : interpAge(model, d), `${where}age at row ${i}`);
      if (range) {
        const r = d == null ? null : interpAgeRange(model, d);
        assert.equal(age_min[i], r ? r.min : null, `${where}age_min at row ${i}`);
        assert.equal(age_max[i], r ? r.max : null, `${where}age_max at row ${i}`);
        assert.equal(age_min[i] == null, age[i] == null, where + 'range is missing exactly where the age is');
      }
      if (out || d == null) assert.equal(age[i], null, where + 'missing outside the model and for a missing depth (no extrapolation)');
    });
    assert.deepEqual(doc.expected.summary, { rows: depth.length, outside }, where + 'summary');
    // Coverage the card asks for: knots, both ends, just outside, missing depths.
    const present = new Set(depth);
    assert.ok(m.depth.every((d) => present.has(d)), where + 'every knot is queried');
    assert.ok(present.has(null) && depth.some((d) => d != null && d < first) && depth.some((d) => d != null && d > last), where + 'missing and outside depths');
    assert.ok(present.has(first - 1e-9) && present.has(last + 1e-9), where + 'just outside both ends');
  }
});

test('fixtures keep the properties they were made to show', () => {
  const small = load('two-rows.json');
  assert.deepEqual(small.inputs.age_model, { depth: [2, 12], age: [5, 25] });
  assert.deepEqual(small.expected.ages.age.slice(0, 3), [5, 25, 15]);
  assert.ok(!('age_min' in small.expected.ages));
  const reversed = load('two-rows-reversal.json');
  assert.equal(reversed.expected.reversals, 1);
  assert.equal(reversed.expected.ages.age[2], 20);                       // linear between 30 and 10 even though age decreases downwards
  assert.ok('age_min' in load('two-rows-with-range.json').expected.ages && 'age_min' in load('rows-1000-reversals-with-range.json').expected.ages);
  for (const name of ['rows-1000-reversals', 'rows-1000-reversals-with-range', 'rows-1000-random-100000']) assert.ok(load(`${name}.json`).expected.reversals > 10, name);
  for (const name of ['rows-1000', 'rows-1000-with-range']) assert.equal(load(`${name}.json`).expected.reversals, 0, name);
  assert.equal(load('rows-1000-random-100000.json').inputs.query.rows, 102010);   // 100,000 random depths + 2,010 fixed ones
  assert.equal(load('rows-1000.json').inputs.age_model.depth.length, 1000);
});
