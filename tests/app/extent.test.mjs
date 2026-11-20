// Card Q5: minOf and maxOf give exactly what Math.min(...values) and Math.max(...values) give, and also work for series too long to spread.
import test from 'node:test';
import assert from 'node:assert/strict';
import { minOf, maxOf } from '../../app/js/core.js';

const cases = [[], [3], [2, -1, 5], [0, -0], [-0, 0], [1, NaN, 2], [Infinity, -Infinity], ['4', 2, null], [undefined, 1], [1e308, -1e308, 5e-324]];

test('minOf and maxOf equal Math.min and Math.max with spread arguments, including empty, NaN, -0 and coercion', () => {
  for (const values of cases) {
    assert.ok(Object.is(minOf(values), Math.min(...values)), `min ${JSON.stringify(values)}`);
    assert.ok(Object.is(maxOf(values), Math.max(...values)), `max ${JSON.stringify(values)}`);
  }
});

test('typed arrays and other iterables', () => {
  const typed = Float64Array.from([4, -2.5, 9]);
  assert.equal(minOf(typed), -2.5); assert.equal(maxOf(typed), 9);
  assert.equal(maxOf(new Set([1, 7, 3])), 7);
});

test('a series of 10^6 values, where the spread throws', () => {
  const n = 1e6, values = Array.from({ length: n }, (_, i) => Math.sin(i) * 1000 + (i === 654321 ? -5000 : 0));
  values[123456] = 4321.5;
  assert.throws(() => Math.max(...values), RangeError);
  assert.equal(minOf(values), -5000 + Math.sin(654321) * 1000);
  assert.equal(maxOf(values), 4321.5);
});
