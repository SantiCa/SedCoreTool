import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AGE_FORMAT, BACON_FORMAT, NUMBERS_FILE, NUMBERS_FORMAT, buildFixtures, FIXTURE_DIR } from '../../tools/make_age_model_fixtures.mjs';
import { baconToAgeText, parseAgeModelDetailed } from '../../app/js/core.js';

const FILES = readdirSync(FIXTURE_DIR).filter((f) => f !== 'README.md').sort();
const text = (file) => readFileSync(path.join(FIXTURE_DIR, file), 'utf8').replace(/\r\n/g, '\n');
const load = (file) => JSON.parse(text(file));
const AGE_FILES = FILES.filter((f) => f.startsWith('age-')), BACON_FILES = FILES.filter((f) => f.startsWith('bacon-'));
const MIB4 = 4 * 1024 * 1024;
const MODEL_KEYS = new Set(['depth', 'age', 'min', 'max', 'rangeIgnored', 'bacon', 'reversals']);

/** Numbers exactly as the fixtures write them: -0 kept, non-finite values named by strings. */
const value = (v) => (v === 'NaN' ? NaN : v === 'Infinity' ? Infinity : v === '-Infinity' ? -Infinity : v);
/** Two columns equal slot by slot with Object.is (bit-identical, -0 distinct from 0, null = missing). */
function sameColumn(actual, expected, where) {
  assert.equal(actual.length, expected.length, `${where}: length`);
  actual.forEach((v, i) => assert.ok(Object.is(v, expected[i]), `${where}[${i}]: ${v} vs ${expected[i]}`));
}

/** The bytes the client sends (Z6): UTF-8 of the text, 1 byte to 4 MiB, decoded strictly back to the same text. */
function checkTransportable(s, where) {
  const bytes = new TextEncoder().encode(s);
  assert.ok(bytes.length >= 1 && bytes.length <= MIB4, `${where}: 1 byte to 4 MiB`);
  assert.equal(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), s, `${where}: strict UTF-8 round trip (no lone surrogate, BOM kept)`);
}

test('the generator writes the same bytes twice and the committed fixtures are what it writes', () => {
  const first = buildFixtures(), second = buildFixtures();
  assert.deepEqual([...first.keys()].sort(), FILES, 'same set of files');
  for (const [file, content] of first) {
    assert.equal(content, second.get(file), `${file} differs between two runs`);
    assert.equal(text(file), content, `${file} differs from a regeneration; run node tools/make_age_model_fixtures.mjs only if the change is intended and reviewed`);
    assert.match(content, /^[\x20-\x7e]*\n$/, `${file}: one line of printable ASCII (git cannot change an input's bytes)`);
  }
});

test('the command line writes the same bytes into another folder', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'age-model-'));
  try {
    execFileSync(process.execPath, [fileURLToPath(new URL('../../tools/make_age_model_fixtures.mjs', import.meta.url)), '--out', dir], { stdio: 'pipe' });
    assert.deepEqual(readdirSync(dir).sort(), FILES);
    for (const [file, content] of buildFixtures()) assert.equal(readFileSync(path.join(dir, file), 'utf8'), content, file);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('every core.age_model/1 fixture agrees exactly with the current parseAgeModelDetailed', () => {
  assert.ok(AGE_FILES.length >= 40);
  for (const file of AGE_FILES) {
    const doc = load(file), where = doc.name, { summary, model } = doc.expected;
    assert.equal(doc.format, AGE_FORMAT); assert.equal(file, `${doc.name}.json`); assert.deepEqual(doc.inputs.settings, { version: 1 });
    checkTransportable(doc.inputs.text, where);
    const { model: m, issue } = parseAgeModelDetailed(doc.inputs.text);
    if (m) assert.ok(Object.keys(m).every((k) => MODEL_KEYS.has(k)), `${where}: no model field beyond those the contract maps`);
    assert.deepEqual(summary, {
      rows: m ? m.depth.length : 0, reversals: m ? m.reversals : 0, range_ignored: m?.rangeIgnored || 0, bacon: !!m?.bacon,
      issue: issue ? issue.kind : null, issue_depth: issue ? issue.depth : null,
    }, `${where}: summary`);
    assert.deepEqual(Object.keys(model), m?.min ? ['depth', 'age', 'age_min', 'age_max'] : ['depth', 'age'], `${where}: columns`);
    sameColumn(model.depth.map(value), m ? m.depth : [], `${where} depth`);
    sameColumn(model.age.map(value), m ? m.age : [], `${where} age`);
    if (m?.min) { sameColumn(model.age_min.map(value), m.min, `${where} age_min`); sameColumn(model.age_max.map(value), /** @type {number[]} */ (m.max), `${where} age_max`); }
    // What the contract says of the output: a model is either absent (0 rows) or a valid §9.8 age model.
    assert.ok(summary.rows === 0 || summary.rows >= 2, where);
    assert.equal(summary.issue === null || summary.rows === 0, true, `${where}: an issue means no model`);
    const d = model.depth.map(value);
    assert.ok(d.every((x, i) => Number.isFinite(x) && Number.isFinite(value(model.age[i])) && (i === 0 || x > d[i - 1])), `${where}: finite, depth strictly increasing`);
    if (model.age_min) assert.ok(model.age.every((a, i) => model.age_min[i] <= a && a <= model.age_max[i]), `${where}: range contains the age`);
  }
});

test('every core.bacon/1 fixture agrees exactly with the current baconToAgeText (numbers and text)', () => {
  assert.ok(BACON_FILES.length >= 20);
  const seen = { center: new Set(), depth_unit: new Set(), age_divisor: new Set() };
  for (const file of BACON_FILES) {
    const doc = load(file), where = doc.name, { settings, table_text: table } = doc.inputs, { summary, rows, text_lines: lines } = doc.expected;
    assert.equal(doc.format, BACON_FORMAT); assert.equal(file, `${doc.name}.json`);
    assert.deepEqual(Object.keys(settings), ['version', 'center', 'depth_unit', 'age_divisor']);
    assert.equal(settings.version, 1);
    assert.ok(['median', 'mean'].includes(settings.center) && ['mm', 'cm', 'm'].includes(settings.depth_unit) && [1, 1000, 1000000].includes(settings.age_divisor), where);
    for (const k of /** @type {const} */ (['center', 'depth_unit', 'age_divisor'])) seen[k].add(settings[k]);
    checkTransportable(table, where);
    const out = baconToAgeText(table, { center: settings.center, depthUnit: settings.depth_unit, ageDiv: settings.age_divisor });
    assert.deepEqual(lines, out, `${where}: text lines`);
    assert.deepEqual(Object.keys(rows), ['depth', 'age', 'age_min', 'age_max']);
    assert.deepEqual(summary, { rows: out ? out.length : 0 }, `${where}: summary`);
    const cells = (out || []).map((l) => l.split(', ').map(Number));
    ['depth', 'age', 'age_min', 'age_max'].forEach((name, k) => {
      // The method's number is the one the program writes; the program's text is that number's shortest form (Z7).
      sameColumn(rows[name], cells.map((c) => (Number.isFinite(c[k]) ? c[k] : null)), `${where} ${name}`);
      rows[name].forEach((v, i) => { if (v !== null) assert.equal(`${v}`, /** @type {string[]} */ (out)[i].split(', ')[k], `${where} ${name}[${i}] text`); });
    });
  }
  assert.deepEqual([...seen.center].sort(), ['mean', 'median']);
  assert.deepEqual([...seen.depth_unit].sort(), ['cm', 'm', 'mm']);
  assert.deepEqual([...seen.age_divisor].sort((a, b) => a - b), [1, 1000, 1000000]);
});

test('js-numbers.json records ECMAScript Number() and toPrecision(8) exactly', () => {
  const doc = load(NUMBERS_FILE);
  assert.equal(doc.format, NUMBERS_FORMAT);
  assert.ok(doc.number.length > 250 && doc.to_precision_8.length > 900);
  for (const [s, n] of doc.number) assert.ok(Object.is(Number(s), value(n)), `Number(${JSON.stringify(s)})`);
  for (const [x, t, back] of doc.to_precision_8) {
    assert.equal(x.toPrecision(8), t, `(${x}).toPrecision(8)`);
    assert.ok(Object.is(+t, value(back)), `+${t}`);
  }
});

test('fixtures keep the properties they were made to show', () => {
  const age = (n) => load(`age-${n}.json`).expected, bacon = (n) => load(`bacon-${n}.json`).expected;
  assert.ok(Object.is(age('negative-zero-first').model.depth[0], -0) && Object.is(age('negative-zero-second').model.depth[0], 0));
  assert.deepEqual(age('absent-vs-empty-range-cell').summary, { rows: 0, reversals: 0, range_ignored: 0, bacon: false, issue: 'dupDepth', issue_depth: 5 });
  assert.equal(age('dup-depth-largest').summary.issue_depth, 4);
  assert.equal(age('range-ignored-named').summary.range_ignored, 2);
  assert.ok(!('age_min' in age('range-ignored-unnamed').model) && age('range-ignored-unnamed').summary.range_ignored === 0);
  assert.deepEqual(age('range-swapped').model.age_min, [1.5, 3.5, 5]);
  assert.equal(age('reversals').summary.reversals, 2);
  assert.equal(age('one-row').summary.rows, 0);
  assert.equal(age('bacon-pasted').summary.bacon, true);
  assert.deepEqual(age('header-age-min-first').model.age, [2, 4]);              // the age_min column, not "age"
  assert.deepEqual(age('header-same-column').model.depth, age('header-same-column').model.age);
  assert.deepEqual(age('number-forms').model.depth, [-0, 0.5, 5, 26, 31, 33, 40, 1000]);
  assert.equal(age('large-10000').summary.rows, 10000);
  assert.ok(age('large-10000').summary.reversals > 50 && 'age_min' in age('large-10000').model);
  assert.deepEqual(bacon('rounding-ties').text_lines[0], '123456790, 100000000, 12345679, -123456790');   // ties rounded away from zero
  assert.equal(bacon('rounding-ties-mm').rows.depth[0], 123456790);
  assert.deepEqual(bacon('depth-overflow-mm').rows.depth, [null, null, 50]);
  assert.deepEqual(bacon('depth-overflow-mm').text_lines.map((l) => l.split(', ')[0]), ['Infinity', '-Infinity', '50']);
  for (const n of ['no-centre-column', 'no-min-column', 'one-row', 'comment-first-line']) assert.equal(bacon(n).text_lines, null, n);
  assert.deepEqual(bacon('empty-cell-is-zero').rows.depth[0], 0);
  assert.equal(bacon('large-10000').summary.rows, 10000);
});
