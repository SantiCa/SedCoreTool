// Card Q10: precision of Data-tab edits, manual column names with `|`, and the record-list guard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteManualColumn, originalCellValue, removeById } from '../../app/js/dataedit.js';
import { fmt } from '../../app/js/state.js';

test('a small value is edited and restored exactly, not through its 6-decimal text', () => {
  const core = { depth: [0.5, 1.5], proxies: { Mn: [1.23e-8, 4] } };
  const shown = fmt(core.proxies.Mn[0], 6);
  assert.notEqual(+shown, 1.23e-8, 'the table text has lost the value');
  assert.equal(originalCellValue(core, 'Mn', 0.5), 1.23e-8);
  assert.equal(originalCellValue(core, 'Mn', '1.5'), 4);
  assert.equal(originalCellValue(core, 'Mn', 9), null);
  assert.equal(originalCellValue({ age: [3], proxies: { a: [null] } }, 'a', 3), null);
});

test('a manual column whose name contains | is deleted cleanly', () => {
  const cores = [{ id: 'c1', user: { 'Ba|Ti': { d: [], v: [] }, other: { d: [], v: [] } } }, { id: 'c1|x', user: { 'Ba|Ti': { d: [], v: [] } } }];
  assert.equal(deleteManualColumn(cores, 'c1', 'Ba|Ti'), true);
  assert.deepEqual(Object.keys(cores[0].user), ['other']);
  assert.deepEqual(Object.keys(cores[1].user), ['Ba|Ti']);
  assert.equal(deleteManualColumn(cores, 'c1', 'Ba|Ti'), false);
  assert.equal(deleteManualColumn(cores, 'missing', 'other'), false);
});

test('removing a record with an id that no longer exists changes nothing', () => {
  const list = [{ id: 'a' }, { id: 'b' }];
  assert.equal(removeById(list, 'zzz'), false);
  assert.deepEqual(list.map((r) => r.id), ['a', 'b']);
  assert.equal(removeById(list, 'a'), true);
  assert.deepEqual(list.map((r) => r.id), ['b']);
});
