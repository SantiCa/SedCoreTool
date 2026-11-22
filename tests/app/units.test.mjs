// Card Q3: units of external records: proposed from the header, converted to the core's unit, a record outside the core reported.
import test from 'node:test';
import assert from 'node:assert/strict';
import { guessRecordUnit, unitFactor, rangeOverlaps } from '../../app/js/core.js';
import { recordSeries } from '../../app/js/exportio.js';

test('the unit of an axis column is proposed from its header', () => {
  for (const [header, unit] of [['Depth (mbsf)', 'm'], ['CCSF-A (m)', 'm'], ['depth_cm', 'cm'], ['Depth (mm)', 'mm'], ['depth', null], ['Profundidad', null]]) {
    assert.equal(guessRecordUnit(header, 'depth'), unit, header);
  }
  for (const [header, unit] of [['Age (ka BP)', 'ka'], ['age_Ma', 'Ma'], ['cal yr BP', 'a'], ['Age (kyr)', 'ka'], ['edad', null]]) {
    assert.equal(guessRecordUnit(header, 'age'), unit, header);
  }
});

test('conversion factors between depth units and between age units', () => {
  assert.equal(unitFactor('m', 'cm', 'depth'), 100);
  assert.equal(unitFactor('mm', 'cm', 'depth'), 0.1);
  assert.equal(unitFactor('cm', 'm', 'depth'), 0.01);
  assert.equal(unitFactor('ka', 'a', 'age'), 1000);
  assert.equal(unitFactor('a', 'Ma', 'age'), 1e-6);
  assert.equal(unitFactor('cm', 'cm', 'depth'), 1);
  assert.equal(unitFactor('ft', 'cm', 'depth'), 1, 'an unknown unit converts nothing');
});

test('a record read in metres is stored in the core\'s centimetres, and its range is checked against the core', () => {
  const tab = { headers: ['Depth (m)', 'Fe'], rows: [[1.5, 10], [0.5, 20], [null, 5]] };
  const [series] = recordSeries(tab, 0, [1], ['#000'], 0, unitFactor('m', 'cm', 'depth'));
  assert.deepEqual(series.x, [50, 150], 'converted and sorted');
  assert.deepEqual(series.y, [20, 10]);
  assert.equal(rangeOverlaps(series.x, 0, 200), true);
  assert.equal(rangeOverlaps([1.5, 0.5], 100, 200), false, 'metres taken as centimetres lie outside a 100-200 cm core');
  assert.equal(rangeOverlaps([], 0, 10), false);
});
