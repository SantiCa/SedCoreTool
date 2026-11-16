import test from 'node:test';
import assert from 'node:assert/strict';
import { createMaskChanges, indexRangeOfPairs } from '../../app/js/maskchanges.js';

const section = (w = 10, h = 20) => ({ w, h });

test('a section nobody wrote to has no changed rows', () => {
  const changes = createMaskChanges(), s = section();
  assert.deepEqual(changes.take(s), { all: false, first: 0, end: 0 });
});

test('the changed rows run from the row of the first pixel to the row of the last, whatever the order of the writes', () => {
  const changes = createMaskChanges(), s = section(10, 20);
  changes.mark(s, 57); changes.mark(s, 23); changes.mark(s, 24); changes.mark(s, 150);
  assert.deepEqual(changes.take(s), { all: false, first: 2, end: 16 });            // pixel 23 is in row 2, pixel 150 in row 15
  assert.deepEqual(changes.take(s), { all: false, first: 0, end: 0 }, 'taking starts again from nothing');
});

test('one pixel changes exactly its row, and the last pixel of the image is inside the image', () => {
  const changes = createMaskChanges(), s = section(10, 20);
  changes.mark(s, 0);
  assert.deepEqual(changes.take(s), { all: false, first: 0, end: 1 });
  changes.mark(s, 199);
  assert.deepEqual(changes.take(s), { all: false, first: 19, end: 20 });
  changes.mark(s, 205);                                                              // a writer that is off the image does not extend it
  assert.deepEqual(changes.take(s), { all: false, first: 20, end: 20 });
});

test('markRange covers both ends, and markAll wins over any rows', () => {
  const changes = createMaskChanges(), s = section(10, 20);
  changes.markRange(s, 31, 72);
  assert.deepEqual(changes.take(s), { all: false, first: 3, end: 8 });
  changes.mark(s, 5); changes.markAll(s); changes.mark(s, 6);
  assert.deepEqual(changes.take(s), { all: true, first: 0, end: 20 });
  assert.deepEqual(changes.take(s), { all: false, first: 0, end: 0 });
});

test('a change that was taken and not delivered can be put back and merges with newer writes', () => {
  const changes = createMaskChanges(), s = section(10, 20);
  changes.markRange(s, 30, 49);
  const taken = changes.take(s);
  changes.mark(s, 120);                                                              // an edit while the engine was busy
  changes.restore(s, taken);
  assert.deepEqual(changes.take(s), { all: false, first: 3, end: 13 });
  changes.markAll(s); const all = changes.take(s); changes.restore(s, all);
  assert.deepEqual(changes.take(s), { all: true, first: 0, end: 20 });
  changes.restore(s, { all: false, first: 0, end: 0 });                              // restoring nothing changes nothing
  assert.deepEqual(changes.take(s), { all: false, first: 0, end: 0 });
});

test('sections are independent, and a section that is gone is not kept alive', () => {
  const changes = createMaskChanges(), a = section(), b = section();
  changes.mark(a, 55);
  assert.deepEqual(changes.take(b), { all: false, first: 0, end: 0 });
  assert.deepEqual(changes.take(a), { all: false, first: 5, end: 6 });
});

test('the pixels named by an edit-history list are found from its even positions', () => {
  assert.equal(indexRangeOfPairs([]), null);
  assert.deepEqual(indexRangeOfPairs([40, 'old', 7, [1, 2], 90, 0]), { first: 7, last: 90 });
  assert.deepEqual(indexRangeOfPairs([5, 99]), { first: 5, last: 5 }, 'the old values at odd positions are not indices');
});
