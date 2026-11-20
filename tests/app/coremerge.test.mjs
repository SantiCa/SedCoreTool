// Card Q3: the same core from several projects is joined in the units of the first one, with disagreeing values counted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeImp, joinCoreTables } from '../../app/js/coremerge.js';

test('mergeImp joins two tables of one core on depth, merging rows at the same depth', () => {
  const a = { depth: [0, 10], age: null, proxies: { Fe: [1, 2] } };
  const b = { depth: [5, 10], age: null, proxies: { Fe: [3, null], Ti: [7, 8] } };
  const m = mergeImp(a, b);
  assert.deepEqual(m.depth, [0, 5, 10]);
  assert.deepEqual(m.proxies, { Fe: [1, 3, 2], Ti: [null, 7, 8] });
  assert.equal(m.conflicts, 0);
});

test('a value that disagrees at the same depth is counted and the first one is kept', () => {
  const m = mergeImp({ depth: [10], age: null, proxies: { Fe: [2] } }, { depth: [10], age: null, proxies: { Fe: [9] } });
  assert.deepEqual(m.proxies.Fe, [2]);
  assert.equal(m.conflicts, 1);
});

test('a core kept in metres in one project and in centimetres in another is joined in the units of the first', () => {
  const joined = joinCoreTables([
    { depth: [0, 100], age: [0, 5], proxies: { Fe: [1, 2] }, units: 'cm', ageUnits: 'ka' },
    { depth: [0.5, 1], age: [2500, 5000], proxies: { Fe: [3, 9] }, units: 'm', ageUnits: 'a' },
  ]);
  assert.equal(joined.units, 'cm');
  assert.equal(joined.converted, 1);
  assert.deepEqual(joined.table.depth, [0, 50, 100], 'metres became centimetres, the rows interleave');
  assert.deepEqual(joined.table.age, [0, 2.5, 5], 'years became thousands of years');
  assert.deepEqual(joined.table.proxies.Fe, [1, 3, 2]);
  assert.equal(joined.conflicts, 1, 'at 100 cm the second project says 9, the first 2');
});

test('tables already in the same units are joined exactly as before', () => {
  const tables = [{ depth: [1, 2], age: null, proxies: { A: [1, 2] }, units: 'cm' }, { depth: [3], age: null, proxies: { A: [3] }, units: 'cm' }];
  const joined = joinCoreTables(tables);
  const { conflicts: _c, ...direct } = mergeImp(tables[0], tables[1]);
  assert.deepEqual(joined.table, direct);
  assert.equal(joined.converted, 0);
});
