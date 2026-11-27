// M8.5.8g: reference fixtures for engine method core.columns/1 (docs/roadmap-engine-contract.md §9.12).
//
// Each fixture holds the method's inputs exactly as the page will send them (decision Z12: `settings` and the table `data`
// with `x` and positional columns `c0…`) and the result of the CURRENT JavaScript calculation: the formulas of app/js/sheet.js
// (as fixed by card M8.5.8f) run in the order, with the `interp` and error behaviour, of app.js::applyComputedColumns.
// The part of applyComputedColumns that lives in app.js is transcribed below (pageRun); see the README for the lines it mirrors.
// The Python method of card M8.5.8h must reproduce the results within decision Z11 (each output column names its tolerance).
// All data is synthetic and seeded (no clock, no Math.random); a regeneration is byte-identical.
//
// Usage (repository root):
//   node tools/make_core_columns_fixtures.mjs                write tests/fixtures/core_columns/
//   node tools/make_core_columns_fixtures.mjs --check        fail if a committed file differs from a regeneration
//   node tools/make_core_columns_fixtures.mjs --out <dir>    write somewhere else (used by the test)
//
// File formats: see tests/fixtures/core_columns/README.md. JSON files are one line of printable ASCII.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkComputedCount, evalColumn, fillLinear, formulaRefs, parseFormula, FORMULA_LIMITS } from '../app/js/sheet.js';
import { stableJSON } from './make_age_model_fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURE_DIR = path.join(root, 'tests/fixtures/core_columns');
export const FORMAT = 'core-columns-fixture/1';
/** Decision Z12: an error's argument is cut to this many UTF-8 bytes (whole characters). */
export const ARG_BYTES = 128;
/** Contract §4 "Tables": values and validity of a table together, 9 bytes per cell. */
export const TABLE_CELL_BYTES = 9, TABLE_DATA_BYTES = 8 * 1048576;

/** Deterministic generator (same one as make_core_ages_fixtures.mjs): uniform in [0, 1). */
function seeded(seed) {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}
const utf8Length = (s) => new TextEncoder().encode(s).length;

/** The longest prefix of whole characters of `s` that has at most `max` UTF-8 bytes. */
export function cutUtf8(s, max = ARG_BYTES) {
  let out = '', bytes = 0;
  for (const ch of s) { const b = utf8Length(ch); if (bytes + b > max) break; out += ch; bytes += b; }
  return out;
}

/** The method's form of a sheet.js error: its key and the text of its `v` argument (`n` is the fixed bound of the key). */
export function errorOf(e) {
  if (!e || !e.key) throw new Error(`an error without a key reached the generator: ${e && e.message}`);
  const v = e.args?.v;
  return { key: e.key, arg: v === undefined ? null : String(v) };
}

// ---- transcription of app.js::applyComputedColumns ---------------------------------------------------------------------

/**
 * Mirrors app.js::applyComputedColumns (the loop over S.sheet.columns) for one core. Differences, on purpose: `proxies` is a
 * null-prototype object, so `c.proxies[r]` never finds `constructor`, `toString`…; the error is kept as {key, args} instead of
 * the translated text; the results are returned instead of written into the project.
 * @param {{id: string, depth: number[] | null, age: (number|null)[] | null, proxies: Record<string, (number|null)[]>}} core
 * @param {{name: string, formula: string, core?: string, interp?: boolean}[]} sheetColumns
 */
export function pageRun(core, sheetColumns) {
  const c = { id: core.id, depth: core.depth, age: core.age, proxies: Object.assign(Object.create(null), core.proxies) };
  const n = (c.depth || c.age || []).length; let applied = 0;
  const results = [];
  sheetColumns.forEach((col, position) => {
    if (col.core && col.core !== 'all' && col.core !== c.id) return;
    try { checkComputedCount(++applied);
      const cols = { ...c.proxies, depth: c.depth || new Array(n).fill(null), age: c.age || new Array(n).fill(null) };
      if (col.interp !== false) { const x = c.depth || c.age || []; for (const r of formulaRefs(col.formula)) if (c.proxies[r]) cols[r] = fillLinear(x, c.proxies[r]); }
      const v = evalColumn(col.formula, cols, n);
      c.proxies[col.name] = v;
      results.push({ position, values: v, error: null });
    } catch (e) { results.push({ position, values: null, error: errorOf(e) }); }
  });
  return { n, results };
}

// ---- what the page sends (decision Z12) --------------------------------------------------------------------------------

/**
 * The method's inputs for one core: the formulas that apply to it, minus those the page refuses itself (position beyond
 * FORMULA_LIMITS.columnsPerCore: `tooManyCols`; more than FORMULA_LIMITS.bytes UTF-8 bytes: `tooLong`, which a `utf8json`
 * string cannot carry), and the core's columns named by them (formulaRefs; a formula that does not parse names nothing).
 */
export function pageRequest(core, sheetColumns) {
  const applying = sheetColumns.map((col, position) => ({ col, position })).filter(({ col }) => !(col.core && col.core !== 'all' && col.core !== core.id));
  const sent = [], refused = [];
  applying.forEach(({ col, position }, k) => {
    if (k + 1 > FORMULA_LIMITS.columnsPerCore) refused.push({ position, key: 'tooManyCols', arg: null });
    else if (utf8Length(String(col.formula)) > FORMULA_LIMITS.bytes) refused.push({ position, key: 'tooLong', arg: null });
    else sent.push({ col, position });
  });
  const named = [];
  for (const { col } of sent) { let refs = []; try { refs = formulaRefs(col.formula); } catch { /* the method reports the error */ } for (const r of refs) if (!named.includes(r)) named.push(r); }
  const dataNames = named.filter((r) => Object.hasOwn(core.proxies, r));
  const n = (core.depth || core.age || []).length;
  const missing = () => new Array(n).fill(null);
  const present = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const columns = { x: (core.depth || core.age).map(present) };
  dataNames.forEach((name, j) => { columns[`c${j}`] = core.proxies[name].map(present); });
  if (named.includes('depth')) columns.depth = (core.depth || missing()).map(present);
  if (named.includes('age')) columns.age = (core.age || missing()).map(present);
  const settings = { version: 1, formulas: sent.map(({ col }) => ({ name: col.name, formula: col.formula, interp: col.interp !== false })), columns: dataNames.map((name) => ({ name })) };
  const data = { version: 1, rows: n, columns: Object.keys(columns).map((name) => ({ name, unit: '' })) };
  return { settings, data, columns, sent: sent.map((s) => s.position), refused };
}

// ---- tolerance class of an output column (decision Z11) ----------------------------------------------------------------

const ULP2 = new Set(['log10', 'ln', 'log', 'exp', 'pow']);
const REL = new Set(['mean', 'average', 'std', 'stdev', 'zscore', 'movavg', 'corr']);
const worse = (classes) => (classes.every((k) => k === 'exact') ? 'exact' : 'rel');
/**
 * Z11 for one formula: `exact`, `ulp2` (a log10, ln/log, exp, pow or ^ of exact operands, possibly negated or under abs) or `rel`
 * (|Δ| ≤ 1e-12 · max(1, |reference|)). `fragile` is true when a comparison, a `round` or the condition of an `if` depends on a
 * value that is not exact (Z11: such a result must agree exactly, and a difference goes to the maintainer).
 * @param {string} formula @param {(name: string) => 'exact'|'ulp2'|'rel'} nameClass
 */
export function formulaClass(formula, nameClass) {
  let fragile = false;
  const walk = (e) => {
    if (!e) return 'exact';
    switch (e.k) {
      case 'num': case 'str': return 'exact';
      case 'ref': { const k = nameClass(e.v); return k === 'ulp2' ? 'rel' : k; }
      case 'neg': return walk(e.a);
      case 'bin': {
        const a = walk(e.a), b = walk(e.b);
        if (e.op === '^') return a === 'exact' && b === 'exact' ? 'ulp2' : 'rel';
        if (['<', '>', '<=', '>=', '==', '!='].includes(e.op) && (a !== 'exact' || b !== 'exact')) fragile = true;
        return worse([a, b]);
      }
      case 'call': {
        const args = e.args.map(walk);
        if (e.f === 'count') return 'exact';
        if (REL.has(e.f)) return 'rel';
        if (ULP2.has(e.f)) return args.every((k) => k === 'exact') ? 'ulp2' : 'rel';
        if (e.f === 'abs') return args[0] ?? 'exact';
        if (e.f === 'round' && args.some((k) => k !== 'exact')) fragile = true;
        if (e.f === 'if') { if (args[0] && args[0] !== 'exact') fragile = true; return worse(args.slice(1)); }
        return worse(args);
      }
      default: return 'exact';
    }
  };
  let tolerance = 'exact';
  try { tolerance = walk(parseFormula(formula)); } catch { /* an error: every slot missing, exact */ }
  return { tolerance, fragile };
}

// ---- one case ----------------------------------------------------------------------------------------------------------

const isAgeOnly = (core) => !core.depth;

/** Builds the fixture document (and binary files for large cases) of one case. */
function buildCase({ name, description, core, formulas, binary = false }) {
  const request = pageRequest(core, formulas);
  const run = pageRun(core, formulas);
  const byPosition = new Map(run.results.map((r) => [r.position, r]));
  const classes = new Map();
  const nameClass = (n) => classes.get(n) ?? 'exact';
  const out = {}, errors = [], fullArgs = {}, tolerance = [], fragile = [];
  request.sent.forEach((position, index) => {
    const r = byPosition.get(position), col = formulas[position];
    if (r.error) {
      const arg = r.error.arg === null ? null : cutUtf8(r.error.arg);
      errors.push({ index, key: r.error.key, arg });
      if (arg !== r.error.arg) fullArgs[index] = r.error.arg;
      out[`f${index}`] = new Array(run.n).fill(null);
      tolerance.push('exact');
    } else {
      out[`f${index}`] = r.values.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null));
      const cls = formulaClass(col.formula, nameClass);
      classes.set(col.name, cls.tolerance);
      tolerance.push(cls.tolerance);
      if (cls.fragile) fragile.push(index);
    }
  });
  // Page-side refusals must be exactly what the transcription of app.js gives for those positions.
  for (const p of request.refused) {
    const r = byPosition.get(p.position);
    if (!r.error || r.error.key !== p.key) throw new Error(`${name}: page refusal at ${p.position} is not what app.js gives`);
  }
  const rows = run.n;
  if (request.settings.formulas.length * rows * TABLE_CELL_BYTES > TABLE_DATA_BYTES) throw new Error(`${name}: output table beyond 8 MiB`);
  if (request.data.columns.length * rows * TABLE_CELL_BYTES > TABLE_DATA_BYTES) throw new Error(`${name}: input table beyond 8 MiB`);
  const page = request.refused.length || formulas.some((f) => 'core' in f) ? { core_id: core.id, formulas, sent: request.sent, refused: request.refused } : undefined;
  const document = {
    format: FORMAT, name, description,
    page_core: { axis: isAgeOnly(core) ? 'age' : 'depth', ...(page ? { id: core.id } : {}) },
    inputs: { settings: request.settings, data: request.data },
    ...(page ? { page } : {}),
    expected: {
      dimensions: { rows },
      tables: { columns: { version: 1, rows, columns: request.settings.formulas.map((_, k) => ({ name: `f${k}`, unit: '' })) } },
      summary: { rows, errors },
      tolerance, fragile,
      ...(Object.keys(fullArgs).length ? { full_args: fullArgs } : {}),
    },
  };
  const files = new Map();
  if (binary) {
    const names = request.data.columns.map((c) => c.name), outNames = Object.keys(out);
    document.inputs.data_values_file = `${name}.data_values.f64le`; document.inputs.data_valid_file = `${name}.data_valid.u8`;
    document.expected.columns_values_file = `${name}.columns_values.f64le`; document.expected.columns_valid_file = `${name}.columns_valid.u8`;
    files.set(document.inputs.data_values_file, f64le(names.map((k) => request.columns[k])));
    files.set(document.inputs.data_valid_file, u8(names.map((k) => request.columns[k])));
    files.set(document.expected.columns_values_file, f64le(outNames.map((k) => out[k])));
    files.set(document.expected.columns_valid_file, u8(outNames.map((k) => out[k])));
  } else {
    document.inputs.data_columns = request.columns;
    document.expected.columns = out;
  }
  files.set(`${name}.json`, `${stableJSON(document)}\n`);
  for (const [file, content] of files) if (typeof content === 'string' && /\\ud[89ab][0-9a-f]{2}(?!\\ud[c-f])/i.test(content)) throw new Error(`${file}: lone surrogate`);
  return files;
}

/** Column-major [columns, rows] doubles, as contract §4 "Tables" lays out `<name>_values` (missing slot: 0). */
function f64le(columns) {
  const rows = columns[0].length, buffer = Buffer.alloc(columns.length * rows * 8);
  columns.forEach((col, j) => col.forEach((v, i) => buffer.writeDoubleLE(v == null ? 0 : v, (j * rows + i) * 8)));
  return buffer;
}
const u8 = (columns) => Buffer.from(columns.flatMap((col) => col.map((v) => (v == null ? 0 : 1))));

// ---- hand-written cases --------------------------------------------------------------------------------------------------

const depthCore = (depth, proxies, age = null) => ({ id: 'core-a', depth, age, proxies });
const ageCore = (age, proxies) => ({ id: 'core-a', depth: null, age, proxies });
const F = (formula, name, interp = true) => ({ name, formula, interp });
/** Formulas named r0, r1… (no name collides with a data column unless the case says so). */
const list = (formulas, interp = true) => formulas.map((f, i) => F(f, `r${i}`, interp));

const D8 = [0, 1, 2, 3, 4, 5, 6, 7];
const BASE = {
  a: [1, -2, null, 0, -0, 2.5, 10, -7.25],
  b: [2, 0, 4, null, -0, -3, 0.5, 8],
  c: [3, 3, 3, 3, 3, 3, 3, 3],
  e: [null, null, null, null, null, null, null, null],
  'XRF Ba/Ti': [0.5, 0.25, null, 1, 2, 4, null, 8],
};

function handCases() {
  const cases = [];
  const add = (name, description, core, formulas) => cases.push({ name, description, core, formulas });

  add('operators-scalars', 'Every operator on scalars: the result is broadcast to every row; division by +0 and -0 and overflow give missing.',
    depthCore([10, 20, 30], { a: [1, 2, 3] }),
    list(['1 + 2', '7 - 10', '2 * -0', '-0 * -0', '0 - 0', '-0 + -0', '-0 - 0', '1 / 0', '1 / -0', '0 / 0', '-1 / 3', '1e308 * 10', '-1e308 - 1e308',
      '5e-324 / 2', '2 ^ 10', '2 ^ 0.5', '3 < 4', '3 > 4', '3 <= 3', '3 >= 4', '0 == -0', '0 != -0', '1 == 1.0000000000000002', '2 - -3', '--3', '- -0',
      '"a"', '"a" + 1', '"a" == "a"', '-"a"', '1e400', '-1e400', '.5', '1.', '1.e2', '5E-1', '0.1 + 0.2', '1 - 0.9']));

  add('operators-columns', 'Operators with columns, scalars and missing values; zero divisors in a column; -0 kept; precedence and associativity.',
    depthCore(D8, BASE),
    list(['[a] + [b]', '[a] - [b]', '[a] * [b]', '[a] / [b]', '[b] / [a]', '[a] / 0', '[a] * 2', '3 - [a]', '-[a]', '-[b] * 0', '[a] < [b]', '[a] > [b]',
      '[a] <= [b]', '[a] >= [b]', '[a] == [b]', '[a] != [b]', '[a] == 0', '[e] + 1', '[a] + [e]', '[XRF Ba/Ti] / [a]', '1 - 2 - 3', '8 / 4 / 2', '2 * 3 ^ 2',
      '-2 ^ 2', '2 ^ -2 ^ 2', '2 ^ 3 ^ 2', '(2 ^ 3) ^ 2', '-[a] ^ 2', '(-[a]) ^ 2', '1 + 2 * 3 - 4 / 2', '1 < 2 == 1', '1 < 2 < 3', '3 > 2 > 1',
      '1 + 2 < 2 * 2', '[a] - -[b]', '[c] / [c] - 1']));

  add('power-negative-bases', 'Powers: negative bases with integer and fractional exponents, zero and minus-zero bases, overflow and underflow.',
    depthCore(D8, { neg: [-8, -2, -0.5, -1, -0, 0, 2, null], k: [3, 2, 0.5, 1e308, -1, -1, 0.5, 2], h: [1 / 3, 0.5, -2, 3, 3, 0, -1, 1] }),
    list(['(-8) ^ (1/3)', '(-2) ^ 3', '(-2) ^ 2', '(-2) ^ 0.5', '(-0) ^ 3', '(-0) ^ 2', '(-0) ^ 0.5', '(-0) ^ -1', '0 ^ 0', '0 ^ -1', '(-1) ^ 1e308',
      '10 ^ 308', '10 ^ 309', '2 ^ -1074', '2 ^ -1075', '[neg] ^ 2', '[neg] ^ 3', '[neg] ^ [h]', '[neg] ^ [k]', 'pow([neg], [k])', 'pow([neg], 3)',
      'pow(2, [h])', 'pow([neg])', 'pow([neg], [h], 99)', '[k] ^ [h]', '2 ^ [neg]']));

  const ties = [0.5, 1.5, 2.5, -0.5, -1.5, -2.5, 0.125, -0.125, 0.375, 1.005, 2.675, 1.45, -0.4, -0, 0, 1e-7, -1e-7, 1e21, -1e21, 123456.785,
    9.995, 0.045, 1.25, 1.35, 5e-324, 1.7976931348623157e308, 4.35, 1e20 + 0.5];
  const tieCore = depthCore(ties.map((_, i) => i), { v: ties, d: ties.map((_, i) => i % 4) });
  add('round-ties', 'round(): ties away from zero on the exact binary value (ECMAScript toFixed), digits 0-100, -0, values of 1e21 and more, digits as text.',
    tieCore,
    list(['round([v])', 'round([v], 1)', 'round([v], 2)', 'round([v], 3)', 'round([v], 20)', 'round([v], 100)', 'round([v], 100.9)', 'round([v], -0.5)',
      'round([v], "2")', 'round([v], "0x2")', 'round([v], "")', 'round([v], " 1 ")', 'round([v], "abc")', 'round([v], mean("x"))', 'round([v], if(1))',
      'round(-0)', 'round(-0.4)', 'round(-0.0000001, 2)', 'round(0.5)', 'round(2.5)', 'round(-2.5)', 'round(1.005, 2)', 'round(1e21, 2)',
      'round([v], 101)', 'round([v], -1)', 'round([v], 1e400)', 'round([v], [d])', 'round()', 'round("a")']));

  const roundNext = seeded(858201), rv = [];
  for (let i = 0; i < 400; i++) {
    const kind = i % 4;
    const d = Math.floor(roundNext() * 8);
    let v;
    if (kind === 0) v = (Math.floor(roundNext() * 2e6) - 1e6 + 0.5) / 10 ** d;              // decimal ties (rarely exact in binary)
    else if (kind === 1) v = (Math.floor(roundNext() * 2e6) - 1e6) / 2 ** (1 + Math.floor(roundNext() * 12));   // exact binary fractions
    else if (kind === 2) v = (roundNext() - 0.5) * 10 ** (Math.floor(roundNext() * 30) - 10);
    else v = Math.floor((roundNext() - 0.5) * 1e9) / 1e3;
    rv.push(v);
  }
  add('round-random', 'round() of 400 seeded values (decimal ties, exact binary fractions, wide magnitudes) at 0-7, 12 and 17 digits.',
    depthCore(rv.map((_, i) => i), { v: rv }),
    list([0, 1, 2, 3, 4, 5, 6, 7, 12, 17].map((d) => `round([v], ${d})`)));

  add('functions-unary', 'log10, ln, log (natural), exp, sqrt, abs on columns with negatives, zeros, -0, missing and extremes; scalars; missing and extra arguments.',
    depthCore(D8, { a: [1, 10, -1, 0, -0, 1e-320, 1e308, null], b: [0.5, 2, 3, 709, 710, -745, -746, 100] }),
    list(['log10([a])', 'ln([a])', 'log([a])', 'exp([b])', 'sqrt([a])', 'abs([a])', 'log10(1000)', 'ln(0)', 'exp(1)', 'sqrt(-0)', 'abs(-0)', 'sqrt(2)',
      'LOG10([a])', 'Exp([b])', 'log10()', 'abs()', 'log10([a], [b])', 'sqrt("4")', 'abs(-[b])']));

  add('aggregates', 'mean/average, std/stdev (sample, first argument only), median (first argument only), sum and count (every argument), min/max (fold, or element-wise with exactly two columns).',
    depthCore(D8, BASE),
    list(['mean([a])', 'average([a])', 'mean([a], [b])', 'mean(3)', 'mean("x")', 'mean([e])', 'mean()', 'std([a])', 'stdev([a])', 'std(3)', 'std([c])',
      'median([a])', 'median([b])', 'median([a], [b])', 'median(-0, 0)', 'median(0, -0)', 'median([e])', 'sum([a])', 'sum([a], [b])', 'sum([a], 3, [b])',
      'sum()', 'sum("3", 1)', 'sum([e])', 'sum(-0)', 'count([a])', 'count([a], "a", 3, [e])', 'count()', 'min([a])', 'max([a])', 'min([a], [b])',
      'max([a], [b])', 'min([a], 2)', 'min([a], [b], [c])', 'min()', 'max()', 'min(0, -0)', 'max(-0, 0)', 'max(-0)', 'min2([a], [b])', 'max2([a], 1)',
      'min2(-0, 0)', 'max2(-0, 0)', 'sum(1e308, 1e308)', 'mean([a]) + std([a])', '[a] - mean([a])']));

  add('series', 'zscore, norm01, movavg (windows 2⌊n/2⌋+1, ends shorter, negative and text n), diff, cumsum (gaps), corr (at least 3 pairs).',
    depthCore(D8, BASE),
    list(['zscore([a])', 'zscore([c])', 'zscore(3)', 'norm01([a])', 'norm01([c])', 'norm01(5)', 'norm01([e])', 'movavg([a])', 'movavg([a], 1)',
      'movavg([a], 2)', 'movavg([a], 3)', 'movavg([a], 4)', 'movavg([a], 5)', 'movavg([a], 0)', 'movavg([a], -3)', 'movavg([a], -1)', 'movavg([a], 2.5)',
      'movavg([a], "5")', 'movavg([a], "0x3")', 'movavg([a], "abc")', 'movavg([a], mean("x"))', 'movavg([a], if(1))', 'movavg([a], 1e9)', 'movavg([e], 3)',
      'diff([a])', 'diff([b])', 'cumsum([a])', 'cumsum([b])', 'cumsum([e])', 'corr([a], [b])', 'corr([a], [a])', 'corr([a], -[a])', 'corr([a], [c])',
      'corr([a], [XRF Ba/Ti])', 'corr([a], [e])', 'movavg([a], 3, 99)', 'diff(-[a])']));

  add('series-short', 'Functions over one-row and two-pair columns: corr needs 3 pairs, std 2 values, movavg windows beyond the ends.',
    depthCore([5, 6], { a: [1, 2], b: [3, 5] }),
    list(['corr([a], [b])', 'std([a])', 'zscore([a])', 'movavg([a], 9)', 'diff([a])', 'cumsum([a])', 'median([a])', 'norm01([a])']));

  add('overflow-kept', 'Overflow inside movavg, diff and cumsum stays in the computed column (±Infinity) for later formulas, but is written as missing.',
    depthCore([0, 1, 2, 3, 4, 5], { big: [1e308, 1e308, 1e308, -1e308, null, 1], s: [1, 2, 3, 4, 5, 6] }),
    [F('movavg([big], 3)', 'm'), F('diff([big])', 'd'), F('cumsum([big])', 'cs'), F('[m]', 'copy', false), F('if([m], 1, 2)', 'truth', false),
      F('[m] + 0', 'plus', false), F('[cs]', 'filled', true), F('if([m] > 0, [m], 0)', 'pick', false), F('movavg([big], -3)', 'wrap')]);

  add('if-truthiness', 'if(): a column condition picks row by row (missing condition: missing; 0 and -0 false); a scalar condition picks a whole argument by truthiness (missing, "" false; any other text true); text results become missing.',
    depthCore(D8, BASE),
    list(['if([a], 1, 2)', 'if([b], [a], [c])', 'if([a] > 0, [a], -[a])', 'if([e], 1, 2)', 'if(1, [a], [b])', 'if(0, [a], [b])', 'if(-0, 1, 2)', 'if("", 1, 2)',
      'if("a", 1, 2)', 'if(mean("x"), 1, 2)', 'if(mean([a]), [a], 0)', 'if([a], "yes", 7)', 'if([a])', 'if([a], 1)', 'if()', 'if(1)', 'if([a], [b], [c], [e])',
      'if(if([a], "", "t"), 1, 2)', 'if([a] / 0, 1, 2)', 'if(1, "a", 2)']));

  add('chains', 'Each result is a column for later formulas by its name; a computed column replaces a data column of the same name; a failed formula leaves its name to the data column (or absent: noCol); a name used before it is defined is noCol; a repeated name is replaced.',
    depthCore([0, 1, 2, 3, 4], { a: [1, 2, 3, 4, 5], b: [10, 20, 30, 40, 50] }),
    [F('[later] + 1', 'early'), F('[a] * 2', 'twice'), F('[twice] + [a]', 'thrice'), F('[thrice] / [twice]', 'ratio'), F('[b] - 1', 'b'), F('[b] * 10', 'b10'),
      F('nosuch([a])', 'a'), F('[a] + 0', 'a_after_failure'), F('nosuch(1)', 'gone'), F('[gone]', 'uses_gone'), F('[a] + 100', 'later'), F('[later]', 'later2'),
      F('[twice] * 0', 'twice'), F('[twice]', 'twice_again'), F('cumsum([ratio])', 'acc')]);

  const gapDepth = [0, 1, 2, 3, 10, 11, 12, 12, 13, 20];
  add('interp-gaps', 'interp on and off across gaps of any width: linear between the nearest present values along x, no extrapolation, no fill between equal x; earlier computed columns are filled too; depth and age are never filled.',
    depthCore(gapDepth, { a: [null, 1, null, 3, null, null, 10, 20, null, 40], b: [5, null, null, null, null, null, null, null, null, 6], one: [null, null, 7, null, null, null, null, null, null, null] },
      [100, null, 102, 103, null, 111, 112, 112, 113, null]),
    [F('[a]', 'a_on', true), F('[a]', 'a_off', false), F('[a] + [b]', 'sum_on', true), F('[a] + [b]', 'sum_off', false), F('[one] * 2', 'one_on', true),
      F('[a] * 1', 'sparse', false), F('[sparse]', 'sparse_filled', true), F('if([a] > 2, [a], mean("x"))', 'withmissing', false), F('[withmissing]', 'withmissing_filled', true),
      F('[age]', 'age_on', true), F('[depth] + [age]', 'depth_age', true), F('movavg([a], 3)', 'smooth_on', true), F('movavg([a], 3)', 'smooth_off', false),
      F('cumsum([b])', 'cum_on', true), F('diff([a])', 'diff_on', true)]);

  add('age-only-core', 'A core with ages only: x is the age (unsorted, some missing); depth is all missing; interpolation follows the ages as given.',
    ageCore([5, 6, null, 8, 7, 9, 12, 12, 15], { a: [1, null, 3, null, null, 9, null, 12, 15], b: [null, 2, 2, null, 4, null, null, null, 8] }),
    [F('[a]', 'a_on', true), F('[a]', 'a_off', false), F('[depth]', 'depth', true), F('[age]', 'age_copy', true), F('[age] * 1000', 'age_years', false),
      F('[a] / [b]', 'ratio_on', true), F('[a] / [b]', 'ratio_off', false), F('count([depth])', 'n_depth', true)]);

  add('column-named-depth', 'A data column named "depth" (and one named "age"): with interp on the filled data column replaces the core depth for that formula; with interp off the core depth wins. A computed column named depth behaves the same way for later formulas.',
    depthCore([0, 2, 4, 6, 8], { depth: [100, null, 300, null, 500], age: [null, 7, null, 9, null], v: [1, 2, 3, 4, 5] }, [1, 2, 3, null, 5]),
    [F('[depth]', 'on', true), F('[depth]', 'off', false), F('[age]', 'age_on', true), F('[age]', 'age_off', false), F('[v] * 10', 'depth', false),
      F('depth', 'after_on', true), F('depth', 'after_off', false), F('depth + age', 'bare_names', false)]);

  add('names-and-tokens', 'Names in brackets (any text but "]") and bare identifiers with "." and "$"; A1-like names are column names here; function names in any case; whitespace set; a leading "="; text tokens that act as "( ) , ^ -".',
    depthCore([1, 2, 3], { 'XRF Ba/Ti': [1, 2, 3], 'x.y': [4, 5, 6], '$k': [7, 8, 9], A1: [1, 1, 1], 'A1:B2': [2, 2, 2], 'd13C (‰)': [0.5, 0.25, 0.125], '-': [3, 3, 3], ')': [4, 4, 4], '': [9, 9, 9] }),
    list(['[XRF Ba/Ti] * 2', 'x.y + $k', 'A1 + A1:B2', '[d13C (‰)] * 8', '[]', '= 1 + [A1]', ' \t= 2', 'SUM([x.y])', 'Abs(-1)', ' 1 +﻿2　',
      '(1 ")"', 'sum(1 "," 2)', '2 "^" 3', '"-" 3', '[-]5', '2 ^ [-]', 'sum"(" 1)', '([)]', 'sum(1 [,] 2)', 'x.y.z', '$k$', '[x.y]+[$k]', 'col("a")', 'COL([A1], "core")',
      'col()', '[constructor]', '[toString]', '[__proto__]', '[hasOwnProperty]', 'constructor(1)', 'tostring(1)', '__proto__(1)', 'valueOf']));

  const long = 'L'.repeat(200), wide = 'é'.repeat(70), emoji = '\u{1F600}'.repeat(40);
  add('errors', 'Every error key of a column formula with its argument; the argument is cut to 128 UTF-8 bytes of whole characters.',
    depthCore([1, 2, 3], { a: [1, 2, 3] }),
    list(['[abc', '"abc', '1 + !', '1 = 2', '..5', 'a:b', '1 # 2', '\u00851', '\u001c1', '᠎1', 'é', '(1', 'sum(1', '', '   ', '1 +', '-', '+3', ')', '1 <> 2',
      'f(,)', 'sum(1,)', '1 2', '1 1e21', '1 1e-7', '1 123456789012345680000', '1 1e400', '1 0.1', '1.2.3', '0x10', '1e', '1 "x"', '1 [na me]', '[a] [a]',
      'nosuch(1)', 'a.b(1)', 'sum:A1(1)', 'nosuch([nocol])', '[nocol] + nosuch(1)', 'col()', 'col("a")', 'col("a", [nocol])', 'COL([nocol])',
      '[nocol]', 'x.y', '[a] + [b]', 'movavg(3)', 'movavg()', 'movavg([a], [a])', 'diff(3)', 'cumsum(1)', 'corr(3, [a])', 'corr([a], 3)', 'corr([a])',
      'round([a], [a])', 'round([a], 101)', 'movavg(3, [nocol])', 'abs([nocol], nosuch(1))', `[${long}]`, `[${wide}]`, `[${emoji}]`, `nosuch${'x'.repeat(150)}(1)`,
      `1 "${long}"`]));

  // Bounds of Z10, at and beyond each limit (the byte and column limits are refused by the page: cases page-*).
  const tok = (k) => Array(k).fill('1').join('+');   // 2k-1 tokens
  // 256 rows: movavg(x, 390625) costs 256 × 390,625 = 10^8 additions exactly (allowed); n = 390,626 costs 256 × 390,627 (refused).
  add('bounds', 'Each bound of FORMULA_LIMITS at and beyond its limit: 1,024 tokens, depth 64 (parentheses, calls, unary minus, ^), 64 arguments, 10^8 movavg additions, 4,096 bytes.',
    depthCore(Array.from({ length: 256 }, (_, i) => i * 0.5), { a: Array.from({ length: 256 }, (_, i) => (i % 3 === 2 ? null : ((i * 7919) % 1000) / 10)) }),
    list([`${tok(512)} -`, `-${tok(512)}`, `${tok(512)}+1`, `${tok(513)}`, `${tok(513)} !`, `! ${tok(513)}`, `${tok(512)}+!`,
      `${'('.repeat(64)}1${')'.repeat(64)}`, `${'('.repeat(65)}1${')'.repeat(65)}`, `${'abs('.repeat(64)}[a]${')'.repeat(64)}`, `${'abs('.repeat(65)}[a]${')'.repeat(65)}`,
      `${'-'.repeat(64)}1`, `${'-'.repeat(65)}1`, `1${'^1'.repeat(64)}`, `1${'^1'.repeat(65)}`, `${'('.repeat(63)}-1${')'.repeat(63)}`, `${'('.repeat(64)}-1${')'.repeat(64)}`,
      `sum(${Array(64).fill('[a]').join(',')})`, `sum(${Array(65).fill('1').join(',')})`, `nosuch(${Array(65).fill('1').join(',')})`,
      'movavg([a], 390625)', 'movavg([a], 390624)', 'movavg([a], 390626)', 'movavg([a], 1e400)', 'movavg([a], -1e9)',
      `${'1+'.repeat(1)}"${'x'.repeat(4096 - 4)}"`, `"${'é'.repeat(2047)}"`]));

  // Page-side refusals and the core filter: the page does not send these formulas (contract §9.12, "The page").
  add('page-too-long', 'A formula of 4,097 UTF-8 bytes is refused by the page (tooLong) and not sent; 4,096 bytes are sent; the refused column is absent for later formulas.',
    depthCore([1, 2, 3], { a: [1, 2, 3] }),
    [F(`[a] + "${'y'.repeat(4096 - 8)}"`, 'at_limit'), F(`[a] + "${'y'.repeat(4096 - 7)}"`, 'beyond'), F(`"${'é'.repeat(2048)}"`, 'beyond_wide'), F('[beyond]', 'uses_beyond'), F('[at_limit]', 'uses_at_limit')]);

  const many = Array.from({ length: 258 }, (_, i) => F(i === 0 ? '[a]' : `[k${i - 1}] + 1`, `k${i}`, i % 2 === 0));
  add('page-too-many-columns', 'Formulas 257 and 258 that apply to the core get tooManyCols from the page and are not sent; 256 are sent (output table of 256 columns).',
    depthCore([1, 2], { a: [1, 2] }), many);

  add('page-core-filter', 'Formulas for another core are skipped by the page and do not count; "all" and the core\'s own id apply.',
    { id: 'core-a', depth: [1, 2, 3], age: null, proxies: { a: [1, 2, 3] } },
    [{ name: 'mine', formula: '[a] + 1', core: 'core-a' }, { name: 'other', formula: '[a] + 2', core: 'core-b' }, { name: 'every', formula: '[a] + 3', core: 'all' },
      { name: 'nocore', formula: '[other]' }, { name: 'off', formula: '[a]', interp: false }]);
  return cases;
}

// ---- seeded random formulas over random cores ------------------------------------------------------------------------

const NAME_POOL = ['a', 'b', 'TOC_pct', 'XRF Ba/Ti', 'd13C', 'x.y', '$k', 'Ca', 'Sr/Ca', 'mag sus'];
const ref = (name) => (/^[A-Za-z_$][\w.$]*$/.test(name) ? name : `[${name}]`);
const LITERALS = ['0', '1', '2', '3', '0.5', '2.5', '10', '0.1', '1e3', '0.25', '7', '100', '1.5', '4'];

function randomCore(next, index) {
  const pick = (a) => a[Math.floor(next() * a.length)];
  const rows = pick([1, 2, 3, 4, 5, 8, 13, 20, 35, 60]);
  const ageOnly = next() < 0.15;
  const axis = []; let p = pick([0, 5, 100]);
  for (let i = 0; i < rows; i++) { axis.push(p); p += pick([0.5, 1, 1, 2.5, 0.1, 0, 3]); }
  let age = null;
  if (ageOnly) age = axis.map((a) => (next() < 0.1 ? null : a + (next() < 0.1 ? -2 : 0)));
  else if (next() < 0.5) age = axis.map((d) => (next() < 0.15 ? null : d * 10 + 1));
  const m = 1 + Math.floor(next() * 4), names = [];
  while (names.length < m) { const nm = pick(NAME_POOL); if (!names.includes(nm)) names.push(nm); }
  const proxies = {};
  for (const nm of names) {
    const style = pick(['int', 'dec', 'pos', 'sparse', 'gappy']);
    let run = 0;
    proxies[nm] = Array.from({ length: rows }, () => {
      if (style === 'sparse' && next() < 0.7) return null;
      if (style === 'gappy') { if (run > 0) { run--; return null; } if (next() < 0.2) { run = Math.floor(next() * 4); return null; } }
      if (next() < 0.12) return null;
      if (style === 'int') { const v = Math.floor(next() * 11) - 5; return v === 0 && next() < 0.3 ? -0 : v; }
      if (style === 'pos') return Math.round((0.1 + next() * 1000) * 100) / 100;
      return Math.round((next() - 0.5) * 2000) / 100;
    });
  }
  return { id: `core-${index}`, depth: ageOnly ? null : axis, age, proxies };
}

/** Random well-formed formulas: comparisons, round and if-conditions only over exact values (no fragile results). */
function randomFormulas(next, core, count) {
  const pick = (a) => a[Math.floor(next() * a.length)];
  const dataNames = Object.keys(core.proxies);
  /** Z11 class of every name defined so far (data columns, depth and age are exact). */
  const nameClass = new Map([...dataNames, 'depth', ...(core.age ? ['age'] : [])].map((nm) => [nm, 'exact']));
  const formulas = [];
  let exactNames = [...nameClass.keys()], anyNames = [...exactNames];
  const leaf = (names) => (next() < 0.6 ? { t: ref(pick(names)), col: true } : { t: pick(LITERALS), col: false });
  const colLeaf = (names) => ({ t: ref(pick(names)), col: true });
  const par = (e) => `(${e.t})`;
  function exact(dp, names = exactNames) {
    if (dp <= 0) return leaf(names);
    const r = next();
    if (r < 0.25) { const a = exact(dp - 1, names), b = exact(dp - 1, names); return { t: `${par(a)} ${pick(['+', '-', '*', '/'])} ${par(b)}`, col: a.col || b.col }; }
    if (r < 0.32) { const a = exact(dp - 1, names), b = exact(dp - 1, names); return { t: `${par(a)} ${pick(['<', '>', '<=', '>=', '==', '!='])} ${par(b)}`, col: a.col || b.col }; }
    if (r < 0.37) { const a = exact(dp - 1, names); return { t: `-${par(a)}`, col: a.col }; }
    if (r < 0.45) { const a = exact(dp - 1, names); return { t: `${pick(['abs', 'sqrt'])}(${a.t})`, col: a.col }; }
    if (r < 0.52) { const a = exact(dp - 1, names); return { t: next() < 0.5 ? `round(${a.t})` : `round(${a.t}, ${Math.floor(next() * 5)})`, col: a.col }; }
    if (r < 0.60) { const c = colOf(dp - 1, names); return { t: `${pick(['cumsum', 'diff', 'norm01'])}(${c.t})`, col: true }; }
    if (r < 0.68) { const a = exact(dp - 1, names); return { t: `${pick(['median', 'count', 'sum', 'min', 'max'])}(${a.t})`, col: false }; }
    if (r < 0.74) { const a = colOf(dp - 1, names), b = colOf(dp - 1, names); return { t: `${pick(['min', 'max', 'min2', 'max2'])}(${a.t}, ${b.t})`, col: true }; }
    if (r < 0.78) { const a = exact(dp - 1, names), b = exact(dp - 1, names); return { t: `sum(${a.t}, ${b.t})`, col: false }; }
    if (r < 0.88) { const c = exact(dp - 1, names), a = exact(dp - 1, names), b = exact(dp - 1, names); return { t: `if(${c.t}, ${a.t}, ${b.t})`, col: c.col }; }
    return leaf(names);
  }
  function colOf(dp, names) {
    if (dp <= 0 || next() < 0.5) return colLeaf(names);
    const a = colOf(dp - 1, names), b = exact(dp - 1, names);
    return { t: `${par(a)} ${pick(['+', '-', '*'])} ${par(b)}`, col: true };
  }
  function any(dp) {
    const r = next();
    if (r < 0.4 || dp <= 0) return next() < 0.3 ? colLeaf(anyNames) : exact(dp);
    const a = exact(dp - 1);
    if (r < 0.5) return { t: `${pick(['log10', 'ln', 'log'])}(abs(${a.t}) + 1)` };
    if (r < 0.55) return { t: `exp(${par(a)} / 100)` };
    if (r < 0.62) return { t: next() < 0.5 ? `pow(${a.t}, ${pick(['2', '3', '0.5', '-1'])})` : `${par(a)} ^ ${pick(['2', '3', '0.5'])}` };
    if (r < 0.7) return { t: `${pick(['mean', 'std', 'average', 'stdev'])}(${a.t})` };
    if (r < 0.78) { const c = colOf(dp - 1, exactNames); return { t: `zscore(${c.t})` }; }
    if (r < 0.86) { const c = colOf(dp - 1, exactNames); return { t: `movavg(${c.t}, ${pick(['1', '2', '3', '5', '7'])})` }; }
    if (r < 0.92) { const c = colOf(dp - 1, exactNames), d = colOf(dp - 1, exactNames); return { t: `corr(${c.t}, ${d.t})` }; }
    const b = any(dp - 1), c = exact(dp - 1);
    return { t: `${par(b)} ${pick(['+', '*'])} ${par(c)}` };
  }
  for (let i = 0; i < count; i++) {
    const usesInexact = next() < 0.45;
    const e = usesInexact ? any(1 + Math.floor(next() * 3)) : exact(1 + Math.floor(next() * 4));
    const rr = next();
    const name = rr < 0.08 ? pick(dataNames) : rr < 0.12 && formulas.length ? pick(formulas).name : `r${i}`;
    const interp = next() < 0.7;
    formulas.push(F(e.t, name, interp));
    const { tolerance, fragile } = formulaClass(e.t, (nm) => nameClass.get(nm) ?? 'exact');
    if (fragile) throw new Error(`random formula is fragile: ${e.t}`);
    nameClass.set(name, tolerance);
    exactNames = [...nameClass].filter(([, k]) => k === 'exact').map(([nm]) => nm);
    anyNames = [...nameClass.keys()];
  }
  return formulas;
}

function randomCases() {
  const next = seeded(858207), cases = [];
  for (let i = 0; i < 40; i++) {
    const core = randomCore(next, i);
    cases.push({ name: `random-${String(i).padStart(2, '0')}`, description: `Seeded random core ${i} with 50 random well-formed formulas.`, core, formulas: randomFormulas(next, core, 50) });
  }
  return cases;
}

function largeCase() {
  const next = seeded(858208), rows = 100000;
  const depth = [], c0 = [], c1 = [];
  let d = 0, run = 0;
  for (let i = 0; i < rows; i++) {
    depth.push(Math.round(d * 1000) / 1000); d += next() < 0.02 ? 0 : 0.01 + next() * 0.05;
    if (run > 0) { run--; c0.push(null); } else if (next() < 0.01) { run = Math.floor(next() * 50); c0.push(null); } else c0.push(Math.round((0.5 + next() * 20) * 1000) / 1000);
    c1.push(next() < 0.5 ? null : Math.round((next() - 0.3) * 100000) / 1000);
  }
  return {
    name: 'rows-100000', description: '100,000 rows, two data columns with runs of gaps and sparse values, four chained formulas (timing case of card M8.5.8i; binary columns).',
    core: depthCore(depth, { 'XRF Ca': c0, TOC: c1 }),
    formulas: [F('[XRF Ca] / [TOC] * 100', 'ratio', true), F('movavg([ratio], 11)', 'smooth', true), F('zscore([TOC])', 'z', false),
      F('if([XRF Ca] > 1, round([XRF Ca], 2), cumsum(diff([TOC])))', 'step', false)],
    binary: true,
  };
}

/** @returns {{name: string, description: string, core: any, formulas: any[], binary?: boolean}[]} */
export function allCases() { return [...handCases(), ...randomCases(), largeCase()]; }

/** @returns {Map<string, string | Buffer>} file name -> exact file content */
export function buildFixtures() {
  const files = new Map();
  for (const c of allCases()) for (const [file, content] of buildCase(c)) files.set(file, content);
  return files;
}

/** Writes `files` into `dir` (created when missing). */
export function writeFixtures(files, dir) {
  mkdirSync(dir, { recursive: true });
  for (const [file, content] of files) writeFileSync(path.join(dir, file), content);
}

const same = (file, content) => {
  const bytes = readFileSync(path.join(FIXTURE_DIR, file));
  return typeof content === 'string' ? bytes.toString('utf8').replace(/\r\n/g, '\n') === content : bytes.equals(content);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = buildFixtures();
  const out = process.argv.indexOf('--out');
  if (process.argv.includes('--check')) {
    const committed = existsSync(FIXTURE_DIR) ? readdirSync(FIXTURE_DIR).filter((f) => f !== 'README.md') : [];
    const problems = [...files.keys()].filter((f) => !committed.includes(f) || !same(f, files.get(f))).concat(committed.filter((f) => !files.has(f)));
    if (problems.length) { console.error(`Fixtures differ from a regeneration: ${problems.join(', ')}`); process.exit(1); }
    console.log(`${files.size} fixture files match a regeneration`);
  } else {
    const dir = out > 0 ? path.resolve(process.argv[out + 1]) : FIXTURE_DIR;
    writeFixtures(files, dir);
    const bytes = [...files.values()].reduce((sum, c) => sum + Buffer.byteLength(c), 0);
    console.log(`${files.size} fixture files written to ${dir} (${(bytes / 1024).toFixed(0)} KiB)`);
  }
}
