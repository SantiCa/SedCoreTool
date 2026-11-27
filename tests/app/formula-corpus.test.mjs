// Card M8.5.8f: regression corpus of well-formed formulas. tests/fixtures/formula-corpus.json was written from sheet.js BEFORE the fixes
// of Z9/Z10 (three generated cores with missing values, column formulas and free-sheet cells); every cell must stay identical (Object.is).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evalColumn, evalCells } from '../../app/js/sheet.js';

const corpus = JSON.parse(readFileSync(new URL('../fixtures/formula-corpus.json', import.meta.url), 'utf8'));

/** Fixture encoding: JSON number, null, "-0", {text}, {error: key}. */
const decode = (v) => (v === '-0' ? -0 : v && typeof v === 'object' && 'text' in v ? v.text : v);
const encodeCell = (v) => (v && typeof v === 'object' && 'error' in v ? { error: v.err?.key ?? String(v.error) } : v);

test('corpus: about 70 well-formed column formulas give exactly the stored results on three cores', () => {
  assert.ok(corpus.formulas.length >= 60);
  for (const [coreName, core] of Object.entries(corpus.cores)) {
    for (const formula of corpus.formulas) {
      const expected = corpus.results[coreName][formula];
      let actual;
      try { actual = evalColumn(formula, core.columns, core.n); } catch (e) { actual = { error: e.key ?? String(e.message) }; }
      if (!Array.isArray(expected)) { assert.deepEqual(actual, expected, `${coreName}: ${formula}`); continue; }
      assert.ok(Array.isArray(actual), `${coreName}: ${formula} gave ${JSON.stringify(actual)}`);
      assert.equal(actual.length, expected.length, `${coreName}: ${formula} length`);
      expected.forEach((e, i) => assert.ok(Object.is(actual[i], decode(e)), `${coreName}: ${formula} row ${i}: ${actual[i]} !== ${JSON.stringify(e)}`));
    }
  }
});

test('corpus: free-sheet cells give exactly the stored results', () => {
  const cols = corpus.cores[corpus.cellCore].columns;
  const r = evalCells(corpus.cells, (name) => cols[name]);
  for (const [ref, expected] of Object.entries(corpus.cellResults)) {
    const actual = encodeCell(r[ref]);
    if (expected && typeof expected === 'object' && 'error' in expected) assert.deepEqual(actual, expected, ref);
    else assert.ok(Object.is(actual, decode(expected)), `${ref}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
});
