import test from 'node:test';
import assert from 'node:assert/strict';
import { evalColumn, evalCells, parseFormula, cellName } from '../../app/js/sheet.js';

test('column formulas: names with symbols, functions, missing values', () => {
  const cols = { 'XRF Ba/Ti': [2, 4, null, 8], TOC_pct: [1, 2, 2, 0], depth: [0, 1, 2, 3] };
  assert.deepEqual(evalColumn('[XRF Ba/Ti] / TOC_pct', cols, 4), [2, 2, null, null]);
  assert.deepEqual(evalColumn('=log10([XRF Ba/Ti]) * 0 + depth ^ 2', cols, 4), [0, 1, null, 9]);
  assert.deepEqual(evalColumn('if(TOC_pct > 1, 1, 0)', cols, 4), [0, 1, 1, 0]);
  const z = evalColumn('zscore(depth)', cols, 4); assert.ok(Math.abs(z[0] + 1.1619) < 1e-3 && Math.abs(z[3] - 1.1619) < 1e-3);
  assert.deepEqual(evalColumn('movavg(depth, 3)', cols, 4), [0.5, 1, 2, 2.5]);
  assert.deepEqual(evalColumn('5', cols, 4), [5, 5, 5, 5]);
  assert.throws(() => evalColumn('nope + 1', cols, 4), /noCol/);
  assert.throws(() => parseFormula('(1 + 2'), /expected/);
});

test('cells: references, ranges, aggregates, columns, cycles', () => {
  const r = evalCells({ A1: '2', A2: '3', A3: '=SUM(A1:A2)*2', B1: '=MEAN(COL("x"))', B2: '=CORR(COL("x"), COL("y"))', C1: '=C2', C2: '=C1', D1: 'texto' },
    (name) => ({ x: [1, 2, 3], y: [2, 4, 6] })[name]);
  assert.equal(r.A3, 10); assert.equal(r.B1, 2); assert.ok(Math.abs(r.B2 - 1) < 1e-12);
  assert.ok(r.C1.error); assert.equal(r.D1, 'texto');
  assert.equal(cellName(0, 0), 'A1'); assert.equal(cellName(27, 4), 'AB5');
});

test('V0.35: formula references and linear filling', async () => {
  const { formulaRefs, fillLinear } = await import('../../app/js/sheet.js');
  assert.deepEqual(formulaRefs('[reflectance_L*] / a + log(b)').sort(), ['a', 'b', 'reflectance_L*']);
  assert.deepEqual(fillLinear([0, 1, 2, 3, 4], [null, 10, null, 30, null]), [null, 10, 20, 30, null]);
  assert.deepEqual(fillLinear([0, 1, 5], [0, null, 10], 2), [0, null, 10]);
});

/* Card M8.5.8f: quirks of Z9 and bounds of Z10. Each test failed on sheet.js before the card. */
const qcols = { a: [1, 2, null, 4, 5], b: [2, 2, 2, 2, 2], depth: [0, 1, 2, 3, 4] };
const errKey = (fn) => { try { fn(); } catch (e) { return e.key ?? `untranslated: ${e.message}`; } return 'no error'; };

test('Z9 (1): function names are looked up as own properties only', () => {
  for (const f of ['constructor(a)', '__proto__(a)', 'valueOf(a)', 'hasOwnProperty(a)']) assert.equal(errKey(() => evalColumn(f, qcols, 5)), 'unkFn', f);
});

test('Z9 (2): column names are looked up as own properties only', () => {
  for (const f of ['[toString]', '[__proto__]', 'constructor', 'hasOwnProperty + 1']) assert.equal(errKey(() => evalColumn(f, qcols, 5)), 'noCol', f);
});

test('Z9 (3): a lone dot is an invalid character', () => {
  for (const f of ['.', 'a + .', '. * 2']) assert.equal(errKey(() => parseFormula(f)), 'badChar', f);
});

test('Z9 (4): a column where a number is expected gives argKind', () => {
  assert.equal(errKey(() => evalColumn('round(a, b)', qcols, 5)), 'argKind');
  assert.equal(errKey(() => evalColumn('movavg(a, b)', qcols, 5)), 'argKind');
});

test('Z9 (5): a number where a column is expected, and round digits out of range, give argKind', () => {
  for (const f of ['movavg(3)', 'diff(3)', 'cumsum(3)', 'corr(3, a)', 'corr(a, 3)', 'round(a, 101)', 'round(a, -1)']) assert.equal(errKey(() => evalColumn(f, qcols, 5)), 'argKind', f);
  assert.deepEqual(evalColumn('round(a / 3, 100)', qcols, 5).map((v) => v === null), [false, false, true, false, false]);   // 0..100 digits stay valid
});

test('Z9: any other thrown error is the key invalid, never a browser message', async () => {
  const { evalColumn: ev } = await import('../../app/js/sheet.js');
  const cols = { a: qcols.a, get boom() { throw new TypeError('browser text'); } };
  assert.equal(errKey(() => ev('boom + 1', cols, 5)), 'invalid');
  const r = evalCells({ A1: '=COL("x")' }, () => { throw new TypeError('browser text'); });
  assert.equal(r.A1.err.key, 'invalid');
});

test('Z9 (6): text results become missing values in computed columns', () => {
  assert.deepEqual(evalColumn('if(a > 2, "x", "y")', qcols, 5), [null, null, null, null, null]);
  assert.deepEqual(evalColumn('if(a > 2, a, "y")', qcols, 5), [null, null, null, 4, 5]);
  assert.deepEqual(evalColumn('"text"', qcols, 3), [null, null, null]);
});

test('Z9: behaviours kept on purpose', () => {
  assert.deepEqual(evalColumn('log(a)', qcols, 5), evalColumn('ln(a)', qcols, 5));
  assert.deepEqual(evalColumn('mean(a, b)', qcols, 5), evalColumn('mean(a)', qcols, 5));
  assert.deepEqual(evalColumn('sum(a, b)', qcols, 5)[0], 22);
  assert.deepEqual(evalColumn('movavg(depth, 4)', qcols, 5), evalColumn('movavg(depth, 5)', qcols, 5));   // 2*floor(n/2)+1 rows
  assert.deepEqual(evalColumn('sum()', qcols, 2), [0, 0]);
  assert.deepEqual(evalColumn('if("x", 1, 2)', qcols, 1), [1]);
});

test('Z10: formula length in UTF-8 bytes and number of tokens', () => {
  assert.doesNotThrow(() => parseFormula('1' + ' '.repeat(4095)));
  assert.equal(errKey(() => parseFormula('1' + ' '.repeat(4096))), 'tooLong');
  assert.doesNotThrow(() => parseFormula('[' + 'é'.repeat(2047) + ']'));   // exactly 4,096 bytes
  assert.equal(errKey(() => parseFormula('[' + 'é'.repeat(2048) + ']')), 'tooLong');   // 4,098 bytes but only 2,050 characters
  assert.doesNotThrow(() => parseFormula(Array(512).fill('1').join('+')));   // 512 numbers + 511 operators = 1,023 tokens
  assert.doesNotThrow(() => parseFormula('-' + Array(512).fill('1').join('+')));   // exactly 1,024 tokens
  assert.equal(errKey(() => parseFormula(Array(513).fill('1').join('+'))), 'tooManyTokens');   // 1,025 tokens
});

test('Z10: nesting depth and arguments per call', () => {
  assert.doesNotThrow(() => parseFormula('('.repeat(64) + '1' + ')'.repeat(64)));
  assert.equal(errKey(() => parseFormula('('.repeat(65) + '1' + ')'.repeat(65))), 'tooDeep');
  assert.equal(errKey(() => parseFormula('-'.repeat(65) + '1')), 'tooDeep');
  assert.equal(errKey(() => parseFormula('abs('.repeat(65) + '1' + ')'.repeat(65))), 'tooDeep');
  assert.equal(errKey(() => parseFormula(Array(66).fill('2').join('^'))), 'tooDeep');
  assert.doesNotThrow(() => parseFormula(`sum(${Array(64).fill('1').join(', ')})`));
  assert.equal(errKey(() => parseFormula(`sum(${Array(65).fill('1').join(', ')})`)), 'tooManyArgs');
  assert.equal(errKey(() => parseFormula('('.repeat(2000) + '1' + ')'.repeat(2000))), 'tooManyTokens');   // refused before any recursion
});

test('Z10: computed columns per core and the cost of movavg', async () => {
  const { checkComputedCount } = await import('../../app/js/sheet.js');
  assert.doesNotThrow(() => checkComputedCount(256));
  assert.equal(errKey(() => checkComputedCount(257)), 'tooManyCols');
  const n = 10000, x = Array.from({ length: n }, (_, i) => i);
  assert.equal(evalColumn('movavg(x, 9999)', { x }, n).length, n);   // 10,000 rows x 9,999 = 99,990,000 additions
  assert.equal(errKey(() => evalColumn('movavg(x, 10001)', { x }, n)), 'tooCostly');
});

test('Z13: cleanSheetColumns keeps well-formed saved computed columns and counts the others', async () => {
  const { cleanSheetColumns } = await import('../../app/js/sheet.js');
  const good = [{ name: 'r', formula: 'a / b' }, { name: 'é'.repeat(128), formula: '', core: 'all', interp: false, error: 'stale' }];
  const proto = JSON.parse('{"name": "__proto__", "formula": "a"}');
  const bad = [proto, null, 'x', [], { name: '', formula: 'a' }, { name: 3, formula: 'a' }, { name: 'n', formula: 3 }, { name: 'n' },
    { name: 'n', formula: 'a', core: 7 }, { name: 'n', formula: 'a', core: null }, { name: 'n', formula: 'a', interp: 'yes' },
    { name: 'é'.repeat(128) + 'x', formula: 'a' }];
  const r = cleanSheetColumns([good[0], ...bad, good[1]]);
  assert.equal(r.dropped, bad.length);
  assert.deepEqual(r.columns, [{ name: 'r', formula: 'a / b' }, { name: 'é'.repeat(128), formula: '', core: 'all', interp: false }]);   // error is never trusted
  assert.ok(r.columns.every((c) => Object.getPrototypeOf(c) === Object.prototype));
  assert.deepEqual(cleanSheetColumns(undefined), { columns: [], dropped: 0 });
  assert.deepEqual(cleanSheetColumns({ name: 'r', formula: 'a' }), { columns: [], dropped: 1 });
});
