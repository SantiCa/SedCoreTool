// Card M8.4.16 step 7: how many objects and overlap stacks fit the metadata limits of the engine contract (§3, §8.7), measured with the page's own
// table builders (`maskTables`), not estimated. Writes a JSON record.
//   node tools/measure_mask_tables.mjs --out docs/validation/M8.4.16-step7-mask-tables.json
import fs from 'node:fs';
import os from 'node:os';
import { maskTables } from '../app/js/tiledsync.js';

const LIMITS = { records: 65536, metadataBytes: 4 * 2 ** 20, stackBytes: 16 * 2 ** 20 };
const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
const uid = () => Math.random().toString(36).slice(2, 9);                          // the page's class identifiers (state.js)
const classes = ['burrow', 'planolites', 'thalassinoides', 'chondrites', 'skolithos', 'other'].map((name) => ({ id: uid(), name, counts: true }));

/** A section with `n` objects, a share of them classified (class id), predicted or neither, and `k` stacks of 2-4 members. */
function section(n, stacks, classified = 1) {
  const objects = new Map();
  for (let id = 1; id <= n; id++) {
    const c = classes[id % classes.length].id, labelled = Math.random() < classified;
    objects.set(id, { id, cls: labelled ? c : null, pred: !labelled ? c : null, conf: !labelled ? Math.round(Math.random() * 1e6) / 1e6 : 0 });
  }
  const list = [null];
  for (let k = 1; k <= stacks; k++) list.push(Array.from({ length: 2 + (k % 3) }, (_, m) => 1 + ((k * 7 + m * 13) % n)));
  return { objects, stacks: list };
}
const size = (n, stacks, classified) => {
  const t = maskTables(section(n, stacks, classified), classes);
  return { objects: t.objects.length, classes: t.classes.length, stack_offsets: t.stack_offsets.length, stack_members: t.stack_members?.length ?? 0 };
};

const rows = [];
for (const n of [1000, 10000, 50000, 65536]) for (const classified of [1, 0]) rows.push({ objects: n, stacks: 0, classified, ...size(n, 0, classified) });
// The largest object count that fits both limits, found by doubling and bisection for each shape of record.
const fits = (classified) => {
  let lo = 1, hi = LIMITS.records;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (size(mid, 0, classified).objects <= LIMITS.metadataBytes) lo = mid; else hi = mid - 1; }
  return lo;
};
const maxClassified = fits(1), maxPredicted = fits(0);
const stackRows = [];
for (const k of [1000, 100000, 1000000]) stackRows.push({ stacks: k, ...size(1000, k, 1) });
// Per table (each has its own 16 MiB cap): offsets take 4 bytes per stack, members 4 bytes per member; the test stacks have 2-4 members (3 on average).
const stacksByOffsets = Math.floor((LIMITS.stackBytes - 4) / 4), stacksByMembers = Math.floor(LIMITS.stackBytes / (4 * 3));
const record = {
  date: new Date().toISOString(), computer: `${os.type()} ${os.release()}, ${os.cpus()[0].model}, ${Math.round(os.totalmem() / 2 ** 30)} GiB`, limits: LIMITS,
  objectTable: rows, largestObjectCount: { classifiedByHand: maxClassified, predictedOnly: maxPredicted, bytesPerRecordClassified: size(maxClassified, 0, 1).objects / maxClassified },
  stackTables: stackRows, stacksByOffsets, stacksByMembers, stacksWithinLimits: Math.min(stacksByOffsets, stacksByMembers),
  recordLimitBinds: maxClassified >= LIMITS.records && maxPredicted >= LIMITS.records,
};
console.log(JSON.stringify(record, null, 2));
if (out) fs.writeFileSync(out, JSON.stringify(record, null, 2) + '\n');
