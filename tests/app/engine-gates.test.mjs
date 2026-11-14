import test from 'node:test';
import assert from 'node:assert/strict';
import { nearestRank, timingVerdict, memoryPeakVerdict, MEDIAN_LIMIT, P95_LIMIT, MEMORY_LIMIT } from '../../tools/engine_gates.mjs';

test('nearest-rank percentile: the p95 of few samples is the maximum, the median is the lower middle', () => {
  assert.equal(nearestRank([5, 1, 3], 0.95), 5);
  assert.equal(nearestRank([4, 1, 3, 2], 0.5), 2);               // rank ceil(0.5 * 4) = 2
  assert.equal(nearestRank([7], 0.95), 7);
  assert.equal(nearestRank(Array.from({ length: 20 }, (_, i) => i + 1), 0.95), 19);   // rank 19 of 20
  assert.throws(() => nearestRank([], 0.5), RangeError);
});

test('median limit is the larger of 25 % more and 50 ms more', () => {
  assert.equal(MEDIAN_LIMIT(20), 70);       // 1.25 * 20 = 25 < 20 + 50
  assert.equal(MEDIAN_LIMIT(200), 250);     // 1.25 * 200 = 250 = 200 + 50
  assert.equal(MEDIAN_LIMIT(400), 500);     // 1.25 * 400 = 500 > 450
});

test('p95 limit is the larger of 50 % more and 100 ms more', () => {
  assert.equal(P95_LIMIT(20), 120);
  assert.equal(P95_LIMIT(200), 300);
  assert.equal(P95_LIMIT(400), 600);
});

test('timing verdict passes exactly at the limit and fails just above it', () => {
  const off = [20, 20, 20];
  assert.equal(timingVerdict(off, [70, 70, 70]).pass, true);          // median 70 = limit 70, p95 70 <= 120
  assert.equal(timingVerdict(off, [70.01, 70.01, 70.01]).pass, false);
  assert.equal(timingVerdict(off, [20, 20, 120]).pass, true);         // median 20, p95 120 = limit 120
  assert.equal(timingVerdict(off, [20, 20, 120.01]).pass, false);
  assert.equal(timingVerdict(off, [20, 20, 120.01]).median.pass, true, 'only the p95 failed');
  assert.equal(timingVerdict(off, [20, 20, 120.01]).p95.pass, false);
});

test('the engine being much faster passes, and unequal sample counts are refused', () => {
  assert.equal(timingVerdict([100, 100], [1, 1]).pass, true);
  assert.throws(() => timingVerdict([1, 2], [1]), RangeError);
  assert.throws(() => timingVerdict([], []), RangeError);
});

test('the measured first slice fails: 1,541 ms against a limit of 76.9 ms', () => {
  const verdict = timingVerdict([26.9], [1540.6]);
  assert.equal(verdict.pass, false);
  assert.ok(Math.abs(verdict.median.limit - 76.9) < 1e-9);
});

test('memory peak limit is the larger of 10 % more and 256 MiB more', () => {
  assert.equal(MEMORY_LIMIT(1000), 1256);   // 1100 < 1256
  assert.equal(MEMORY_LIMIT(5000), 5500);   // 5500 > 5256
  assert.equal(memoryPeakVerdict(1000, 1256).pass, true);
  assert.equal(memoryPeakVerdict(1000, 1256.1).pass, false);
  assert.equal(memoryPeakVerdict(5000, 5500).pass, true);
  assert.equal(memoryPeakVerdict(5000, 5500.1).pass, false);
});
