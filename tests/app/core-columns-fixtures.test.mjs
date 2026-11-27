// M8.5.8g: the reference fixtures of core.columns/1 (contract §9.12) are what the generator writes, meet the contract, and agree exactly
// (Object.is) with app/js/sheet.js, both through the contract's own rule and through the transcription of app.js::applyComputedColumns.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ARG_BYTES, FIXTURE_DIR, FORMAT, buildFixtures, cutUtf8, formulaClass, pageRequest, pageRun } from '../../tools/make_core_columns_fixtures.mjs';
import { evalColumn, fillLinear, formulaRefs, FORMULA_LIMITS, FUNCTIONS } from '../../app/js/sheet.js';

const FILES = readdirSync(FIXTURE_DIR).filter((f) => f !== 'README.md').sort();
const bytes = (file) => readFileSync(path.join(FIXTURE_DIR, file));
const text = (file) => bytes(file).toString('utf8').replace(/\r\n/g, '\n');
const load = (file) => JSON.parse(text(file));
const JSON_FILES = FILES.filter((f) => f.endsWith('.json'));
const DOCS = JSON_FILES.map((f) => ({ file: f, doc: load(f) }));
const utf8Length = (s) => new TextEncoder().encode(s).length;
const KEYS = new Set(['noBracket', 'noQuote', 'badChar', 'expected', 'incomplete', 'unexpected', 'extra', 'unkFn', 'invalid', 'colOnly', 'noCol', 'argKind',
  'tooManyTokens', 'tooDeep', 'tooManyArgs', 'tooCostly']);
const KEYS_WITH_ARG = new Set(['badChar', 'expected', 'unexpected', 'extra', 'unkFn', 'noCol', 'argKind', 'tooManyArgs', 'tooCostly']);
const finiteOrMissing = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Columns of a fixture's `data` table and of its expected output, from arrays or from the binary files (missing = null). */
function tables(doc) {
  const names = doc.inputs.data.columns.map((c) => c.name), outNames = doc.expected.tables.columns.columns.map((c) => c.name), rows = doc.inputs.data.rows;
  if (!doc.inputs.data_values_file) return { data: doc.inputs.data_columns, out: doc.expected.columns, names, outNames };
  const read = (valuesFile, validFile, list) => {
    const values = bytes(valuesFile), valid = bytes(validFile);
    assert.equal(values.length, list.length * rows * 8); assert.equal(valid.length, list.length * rows);
    return Object.fromEntries(list.map((name, j) => [name, Array.from({ length: rows }, (_, i) => (valid[j * rows + i] ? values.readDoubleLE((j * rows + i) * 8) : null))]));
  };
  return { data: read(doc.inputs.data_values_file, doc.inputs.data_valid_file, names), out: read(doc.expected.columns_values_file, doc.expected.columns_valid_file, outNames), names, outNames };
}

/** The contract rule of §9.12 written on the method's inputs only (a Map of named columns, depth/age, interp), evaluated by sheet.js. */
function contractRun(settings, data) {
  const n = data.x.length, missing = new Array(n).fill(null);
  const named = new Map(settings.columns.map((c, j) => [c.name, data[`c${j}`]]));
  return settings.formulas.map((f) => {
    try {
      const env = {}, put = (k, v) => Object.defineProperty(env, k, { value: v, enumerable: true, writable: true, configurable: true });
      for (const [k, v] of named) put(k, v);
      put('depth', data.depth ?? missing); put('age', data.age ?? missing);
      if (f.interp) for (const r of formulaRefs(f.formula)) if (named.has(r)) put(r, fillLinear(data.x, named.get(r)));
      const v = evalColumn(f.formula, env, n);
      named.set(f.name, v);
      return { values: v.map(finiteOrMissing) };
    } catch (e) {
      assert.ok(e.key, `an error without a key: ${e.message}`);
      return { error: { key: e.key, arg: e.args?.v === undefined ? null : String(e.args.v) } };
    }
  });
}

/** The core the page would hold, rebuilt from the fixture (only the columns the formulas name matter). */
function pageCore(doc, data) {
  const axis = doc.page_core.axis, proxies = {};
  doc.inputs.settings.columns.forEach((c, j) => { proxies[c.name] = data[`c${j}`]; });
  return { id: doc.page_core.id ?? 'core-a', depth: axis === 'depth' ? data.x : null, age: data.age ?? (axis === 'age' ? data.x : null), proxies };
}

function sameColumn(actual, expected, where) {
  assert.equal(actual.length, expected.length, `${where}: length`);
  actual.forEach((v, i) => assert.ok(Object.is(v, expected[i]), `${where}[${i}]: ${v} vs ${expected[i]}`));
}

/** ECMAScript toFixed as the contract states it, by exact integer arithmetic: n / 10^d closest to |x|, ties to the larger n. */
function roundRule(x, d) {
  if (Math.abs(x) >= 1e21) return x;
  const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, x);
  const hi = view.getUint32(0), lo = view.getUint32(4), exp = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo), e = exp - 1075;
  if (exp) mant |= 1n << 52n; else e = -1074;
  let num = mant * 10n ** BigInt(d), den = 1n;
  if (e >= 0) num <<= BigInt(e); else den <<= BigInt(-e);
  let q = num / den; if (2n * (num % den) >= den) q += 1n;
  const digits = q.toString().padStart(d + 1, '0');
  const body = d ? `${digits.slice(0, -d)}.${digits.slice(-d)}` : digits;
  return Number((x < 0 ? '-' : '') + body);
}

test('the generator writes the same bytes twice and the committed fixtures are what it writes', () => {
  const first = buildFixtures(), second = buildFixtures();
  assert.deepEqual([...first.keys()].sort(), FILES, 'same set of files');
  for (const [file, content] of first) {
    assert.ok(Buffer.from(content).equals(Buffer.from(second.get(file))), `${file} differs between two runs`);
    const committed = typeof content === 'string' ? Buffer.from(text(file)) : bytes(file);
    assert.ok(committed.equals(Buffer.from(content)), `${file} differs from a regeneration; run node tools/make_core_columns_fixtures.mjs only if the change is intended and reviewed`);
    if (typeof content === 'string') assert.match(content, /^[\x20-\x7e]*\n$/, `${file}: one line of printable ASCII`);
  }
});

test('the command line writes the same bytes into another folder', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'core-columns-'));
  try {
    execFileSync(process.execPath, [fileURLToPath(new URL('../../tools/make_core_columns_fixtures.mjs', import.meta.url)), '--out', dir], { stdio: 'pipe' });
    assert.deepEqual(readdirSync(dir).sort(), FILES);
    for (const [file, content] of buildFixtures()) assert.ok(readFileSync(path.join(dir, file)).equals(Buffer.from(content)), file);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('every fixture has the inputs and outputs of the contract (Z12)', () => {
  for (const { file, doc } of DOCS) {
    const where = `${doc.name}: `, { settings, data } = doc.inputs;
    assert.equal(doc.format, FORMAT); assert.equal(file, `${doc.name}.json`);
    assert.deepEqual(Object.keys(settings), ['version', 'formulas', 'columns']); assert.equal(settings.version, 1);
    assert.ok(settings.formulas.length >= 1 && settings.formulas.length <= FORMULA_LIMITS.columnsPerCore, where + '1-256 formulas');
    for (const f of settings.formulas) {
      assert.deepEqual(Object.keys(f), ['name', 'formula', 'interp']);
      assert.ok(typeof f.name === 'string' && f.name && utf8Length(f.name) <= 256 && f.name !== '__proto__', where + 'formula name');
      assert.ok(typeof f.formula === 'string' && utf8Length(f.formula) <= FORMULA_LIMITS.bytes, where + 'formula text within 4,096 bytes');
      assert.equal(typeof f.interp, 'boolean');
    }
    const names = settings.columns.map((c) => c.name);
    assert.equal(new Set(names).size, names.length, where + 'unique column names');
    settings.columns.forEach((c) => assert.deepEqual(Object.keys(c), ['name']));
    const expectedNames = ['x', ...names.map((_, j) => `c${j}`)];
    const tableNames = data.columns.map((c) => c.name);
    assert.deepEqual(tableNames.slice(0, expectedNames.length), expectedNames, where + 'x, then c0…');
    assert.ok(['', 'depth', 'age', 'depth,age'].includes(tableNames.slice(expectedNames.length).join(',')), where + 'then depth and age when named');
    assert.ok(data.columns.every((c) => c.unit === ''));
    const rows = data.rows;
    assert.ok(rows >= 1 && data.columns.length * rows * 9 <= 8 * 1048576, where + 'input table within §4 limits');
    const { data: cols, out } = tables(doc);
    for (const name of tableNames) { assert.equal(cols[name].length, rows); assert.ok(cols[name].every((v) => v === null || Number.isFinite(v)), where + name); }
    assert.deepEqual(doc.expected.dimensions, { rows });
    assert.deepEqual(doc.expected.tables.columns, { version: 1, rows, columns: settings.formulas.map((_, k) => ({ name: `f${k}`, unit: '' })) });
    assert.ok(settings.formulas.length * rows * 9 <= 8 * 1048576, where + 'output table within §4 limits');
    for (let k = 0; k < settings.formulas.length; k++) { assert.equal(out[`f${k}`].length, rows); assert.ok(out[`f${k}`].every((v) => v === null || Number.isFinite(v))); }
    const { errors } = doc.expected.summary;
    assert.deepEqual(Object.keys(doc.expected.summary), ['rows', 'errors']); assert.equal(doc.expected.summary.rows, rows);
    errors.forEach((e, i) => {
      assert.deepEqual(Object.keys(e), ['index', 'key', 'arg']);
      assert.ok(KEYS.has(e.key), where + e.key);
      assert.ok(i === 0 || e.index > errors[i - 1].index, where + 'errors in formula order');
      assert.equal(e.arg === null, !KEYS_WITH_ARG.has(e.key), where + `${e.key} has an argument exactly when its message has one`);
      if (e.arg !== null) assert.ok(utf8Length(e.arg) <= ARG_BYTES, where + 'argument cut to 128 bytes');
      assert.ok(out[`f${e.index}`].every((v) => v === null), where + 'a failed formula gives a missing column');
    });
    assert.equal(doc.expected.tolerance.length, settings.formulas.length);
    assert.ok(doc.expected.tolerance.every((t) => ['exact', 'ulp2', 'rel'].includes(t)));
  }
});

test('every fixture agrees exactly with sheet.js through the contract rule and through the transcription of applyComputedColumns', () => {
  for (const { doc } of DOCS) {
    const where = `${doc.name}: `, { settings } = doc.inputs, { data, out } = tables(doc);
    const errors = new Map(doc.expected.summary.errors.map((e) => [e.index, e]));
    const full = doc.expected.full_args ?? {};
    // 1. The contract rule, from the method's inputs only.
    contractRun(settings, data).forEach((r, k) => {
      if (r.error) {
        const e = errors.get(k);
        assert.ok(e, `${where}f${k} failed (${r.error.key}) but the fixture has no error`);
        assert.equal(e.key, r.error.key, `${where}f${k} key`);
        assert.equal(e.arg, r.error.arg === null ? null : cutUtf8(r.error.arg), `${where}f${k} argument`);
        assert.equal(full[k] ?? e.arg, r.error.arg, `${where}f${k} full argument`);
      } else {
        assert.ok(!errors.has(k), `${where}f${k} succeeded but the fixture has an error`);
        sameColumn(r.values, out[`f${k}`], `${where}f${k}`);
      }
    });
    // 2. The page: the same request and the same results from the transcription of app.js (core filter and page refusals included).
    const core = pageCore(doc, data), formulas = doc.page?.formulas ?? settings.formulas;
    const request = pageRequest(core, formulas);
    assert.deepEqual(request.settings, settings, where + 'the page sends these settings');
    for (const [name, column] of Object.entries(request.columns)) sameColumn(column, data[name], `${where}data ${name}`);
    assert.deepEqual(request.refused, doc.page?.refused ?? [], where + 'page refusals');
    assert.deepEqual(request.sent, doc.page?.sent ?? settings.formulas.map((_, k) => k));
    const byPosition = new Map(pageRun(core, formulas).results.map((r) => [r.position, r]));
    request.sent.forEach((position, k) => {
      const r = byPosition.get(position);
      if (r.error) assert.equal(errors.get(k)?.key, r.error.key, `${where}page f${k}`);
      else sameColumn(r.values.map(finiteOrMissing), out[`f${k}`], `${where}page f${k}`);
    });
    for (const p of request.refused) assert.equal(byPosition.get(p.position).error.key, p.key, `${where}page refusal ${p.position}`);
    // 3. Tolerance classes are what the formulas give (Z11).
    const classes = new Map();
    settings.formulas.forEach((f, k) => {
      if (errors.has(k)) { assert.equal(doc.expected.tolerance[k], 'exact'); return; }
      const c = formulaClass(f.formula, (n) => classes.get(n) ?? 'exact');
      classes.set(f.name, c.tolerance);
      assert.equal(doc.expected.tolerance[k], c.tolerance, `${where}f${k} tolerance`);
      assert.equal(doc.expected.fragile.includes(k), c.fragile, `${where}f${k} fragile`);
    });
  }
});

test('round() in the fixtures is ECMAScript toFixed: ties away from zero on the exact binary value', () => {
  let checked = 0;
  for (const name of ['round-ties', 'round-random']) {
    const doc = DOCS.find((d) => d.doc.name === name).doc, { data, out } = tables(doc);
    doc.inputs.settings.formulas.forEach((f, k) => {
      const m = /^round\(\[v\](?:, (\d+))?\)$/.exec(f.formula); if (!m) return;
      const d = m[1] === undefined ? 0 : +m[1];
      if (d > 100) { assert.ok(doc.expected.summary.errors.some((e) => e.index === k && e.key === 'argKind')); return; }
      data.c0.forEach((v, i) => {
        if (v === null) return;
        const expected = Object.is(v, -0) ? 0 : roundRule(v, d);   // -0 is not < 0: "0", read back as +0
        assert.ok(Object.is(out[`f${k}`][i], finiteOrMissing(expected)), `${name} ${f.formula} row ${i}: ${v} -> ${out[`f${k}`][i]} vs ${expected}`);
        checked++;
      });
    });
  }
  assert.ok(checked > 4000, `${checked} rounded values checked`);
});

test('fixtures cover what card M8.5.8g asks for', () => {
  const all = DOCS.map((d) => d.doc), formulas = all.flatMap((d) => d.inputs.settings.formulas.map((f) => f.formula.toLowerCase()));
  for (const fn of FUNCTIONS) assert.ok(formulas.some((f) => f.includes(`${fn}(`)), `function ${fn} is used`);
  const keys = new Set(all.flatMap((d) => [...d.expected.summary.errors.map((e) => e.key), ...(d.page?.refused ?? []).map((e) => e.key)]));
  for (const key of [...KEYS, 'tooLong', 'tooManyCols']) assert.ok(keys.has(key), `error key ${key} occurs`);
  const random = all.filter((d) => d.name.startsWith('random-'));
  assert.ok(random.reduce((n, d) => n + d.inputs.settings.formulas.length, 0) >= 2000, 'about 2,000 random formulas');
  for (const d of random) { assert.equal(d.expected.summary.errors.length, 0, `${d.name}: random formulas are well formed`); assert.deepEqual(d.expected.fragile, [], `${d.name}: no fragile result`); }
  assert.ok(random.some((d) => d.page_core.axis === 'age'), 'a random age-only core');
  const large = all.find((d) => d.name === 'rows-100000');
  assert.equal(large.inputs.data.rows, 100000);
  assert.equal(all.find((d) => d.name === 'page-too-many-columns').inputs.settings.formulas.length, 256);
  assert.deepEqual(all.find((d) => d.name === 'page-too-many-columns').page.refused.map((r) => r.key), ['tooManyCols', 'tooManyCols']);
  assert.deepEqual(all.find((d) => d.name === 'page-too-long').page.refused.map((r) => r.key), ['tooLong', 'tooLong']);
  assert.ok(all.find((d) => d.name === 'age-only-core').page_core.axis === 'age');
  assert.ok(all.find((d) => d.name === 'column-named-depth').inputs.settings.columns.some((c) => c.name === 'depth'));
  // Each bound at its limit succeeds and beyond it fails (bounds.json, in pairs).
  const bounds = all.find((d) => d.name === 'bounds'), failed = new Map(bounds.expected.summary.errors.map((e) => [e.index, e.key]));
  const at = (formula) => bounds.inputs.settings.formulas.findIndex((f) => f.formula === formula);
  assert.equal(failed.get(at(`-${Array(512).fill('1').join('+')}`)), undefined, '1,024 tokens');
  assert.equal(failed.get(at(Array(513).fill('1').join('+'))), 'tooManyTokens');
  assert.equal(failed.get(at(`${'('.repeat(64)}1${')'.repeat(64)}`)), undefined, 'depth 64');
  assert.equal(failed.get(at(`${'('.repeat(65)}1${')'.repeat(65)}`)), 'tooDeep');
  assert.equal(failed.get(at('movavg([a], 390625)')), undefined, '10^8 additions');
  assert.equal(failed.get(at('movavg([a], 390626)')), 'tooCostly');
  assert.ok(bounds.inputs.settings.formulas.some((f) => utf8Length(f.formula) === FORMULA_LIMITS.bytes), '4,096 bytes are sent');
  // The 128-byte cut keeps whole characters.
  const errorsDoc = all.find((d) => d.name === 'errors');
  assert.ok(Object.values(errorsDoc.expected.full_args).some((a) => utf8Length(a) > ARG_BYTES));
  assert.ok(errorsDoc.expected.summary.errors.some((e) => e.arg && /\u{1F600}$/u.test(e.arg) && utf8Length(e.arg) === 128));
});
