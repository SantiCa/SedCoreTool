// Pass/fail rules of docs/roadmap-engine-contract.md §7 as pure functions, so the measuring tool decides nothing by eye and
// the limits can be tested at both sides of each boundary. No file or process access.
//
// Matched timing (warm end-to-end):  median(on) <= max(1.25 x median(off), median(off) + 50 ms)
//                                    p95(on)    <= max(1.5  x p95(off),    p95(off)    + 100 ms)   (nearest-rank p95)
// Whole-process memory peak:         peak(on)   <= max(1.10 x peak(off),   peak(off)   + 256 MiB)
// Samples are milliseconds (or MiB for the peak). With few samples the nearest-rank p95 is the maximum; the report says so.

/** @param {number[]} values @param {number} p fraction in (0, 1] */
export function nearestRank(values, p) {
  if (!values.length) throw new RangeError('A percentile needs at least one sample');
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

/** Limits are inclusive: a value equal to its limit passes. */
export const MEDIAN_LIMIT = (off) => Math.max(1.25 * off, off + 50);
export const P95_LIMIT = (off) => Math.max(1.5 * off, off + 100);
export const MEMORY_LIMIT = (off) => Math.max(1.1 * off, off + 256);

/**
 * @param {number[]} off matched samples with the engine experiment off (the JavaScript calculation)
 * @param {number[]} on  matched samples with it on
 */
export function timingVerdict(off, on) {
  if (!off.length || off.length !== on.length) throw new RangeError('Matched timing needs the same, non-zero number of samples on both sides');
  const medianOff = nearestRank(off, 0.5), medianOn = nearestRank(on, 0.5), p95Off = nearestRank(off, 0.95), p95On = nearestRank(on, 0.95);
  const medianLimit = MEDIAN_LIMIT(medianOff), p95Limit = P95_LIMIT(p95Off);
  return { pass: medianOn <= medianLimit && p95On <= p95Limit, samples: on.length,
    median: { off: medianOff, on: medianOn, limit: medianLimit, pass: medianOn <= medianLimit },
    p95: { off: p95Off, on: p95On, limit: p95Limit, pass: p95On <= p95Limit } };
}

/** @param {number} peakOffMiB @param {number} peakOnMiB */
export function memoryPeakVerdict(peakOffMiB, peakOnMiB) {
  const limit = MEMORY_LIMIT(peakOffMiB);
  return { pass: peakOnMiB <= limit, off_mib: peakOffMiB, on_mib: peakOnMiB, limit_mib: limit };
}
