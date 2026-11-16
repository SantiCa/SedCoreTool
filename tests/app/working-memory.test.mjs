// Card H6: a section's working image never exceeds the page's memory limit (choosing "full" for a 2 GiB image made the window go blank).
import test from 'node:test';
import assert from 'node:assert/strict';
import { factorThatFits, workingBytes, WORKING_MEMORY_LIMIT, WORKING_BYTES_PER_PIXEL, WORKING_BYTES_PER_PIXEL_16 } from '../../app/js/imageproc.js';

test('the memory estimate counts the original, its enhanced copy, labels and exclusion, plus the 16-bit copy', () => {
  assert.equal(WORKING_BYTES_PER_PIXEL, 4 + 4 + 4 + 1);
  assert.equal(WORKING_BYTES_PER_PIXEL_16, WORKING_BYTES_PER_PIXEL + 8);
  assert.equal(workingBytes(100, 20), 100 * 20 * 13);
  assert.equal(workingBytes(100, 20, true), 100 * 20 * 21);
});

test('the factor that fits is the smallest one at or above the requested factor', () => {
  assert.equal(factorThatFits(4000, 3000), 1);                          // 12 MP: 0.15 GiB
  assert.equal(factorThatFits(4000, 3000, 3), 3);                       // a larger requested factor is kept
  assert.equal(factorThatFits(4000, 3000, 2.2), 3);                     // and rounded up to an integer
  // The 2 GiB fixture of M8.4.13 (8,192 x 87,382 RGB): full resolution needs about 8.7 GiB; 1/3 needs 0.96 GiB and fits.
  assert.equal(factorThatFits(8192, 87382), 3);
  assert.ok(workingBytes(Math.floor(8192 / 3), Math.floor(87382 / 3)) <= WORKING_MEMORY_LIMIT);
  assert.ok(workingBytes(Math.floor(8192 / 2), Math.floor(87382 / 2)) > WORKING_MEMORY_LIMIT);
  // 16 bits need more memory per pixel, so a larger factor: the 16-bit fixture (8,192 x 131,072 grey).
  const k16 = factorThatFits(8192, 131072, 1, true);
  assert.ok(workingBytes(Math.floor(8192 / k16), Math.floor(131072 / k16), true) <= WORKING_MEMORY_LIMIT);
  assert.ok(workingBytes(Math.floor(8192 / (k16 - 1)), Math.floor(131072 / (k16 - 1)), true) > WORKING_MEMORY_LIMIT);
  assert.ok(k16 > factorThatFits(8192, 131072));
});

test('a custom limit is respected exactly at its boundary', () => {
  assert.equal(factorThatFits(10, 10, 1, false, 1300), 1);              // 100 px x 13 B = 1300: equality fits
  assert.equal(factorThatFits(10, 10, 1, false, 1299), 2);
});
