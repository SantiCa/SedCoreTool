// Cards M8.4.16 step 7 and M8.4.22: how many objects and overlap stacks fit the limits of the stored tables (contract §8.7), measured with the
// page's own table builder (`maskTables`) and limit check (`tableLimit`), not estimated. Writes a JSON record.
//   node tools/measure_mask_tables.mjs --out docs/validation/M8.4.22-mask-tables.json
import fs from 'node:fs';
import os from 'node:os';
import { maskTables, tableLimit, MAX_OBJECTS, MAX_STACK_BYTES } from '../app/js/tiledsync.js';

const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
const uid = () => Math.random().toString(36).slice(2, 9);                          // the page's class identifiers (state.js)
const classes = ['burrow', 'planolites', 'thalassinoides', 'chondrites', 'skolithos', 'other'].map((name) => ({ id: uid(), name, counts: true }));

/** A section with `n` objects (half classified by hand, half only predicted) and `k` stacks of 2-4 members. */
function section(n, k) {
  const objects = new Map();
  for (let id = 1; id <= n; id++) {
    const c = classes[id % classes.length].id, byHand = id % 2 === 0;
    objects.set(id, { id, cls: byHand ? c : null, pred: byHand ? null : c, conf: byHand ? 0 : (id % 1000) / 1000 });
  }
  const stacks = [null];
  for (let s = 1; s <= k; s++) stacks.push(Array.from({ length: 2 + (s % 3) }, (_, m) => 1 + ((s * 7 + m * 13) % Math.max(1, n))));
  return { objects, stacks };
}
const measure = (n, k) => {
  const started = performance.now(), tables = maskTables(section(n, k), classes), ms = performance.now() - started;
  const bytes = Object.fromEntries(Object.entries(tables).map(([name, data]) => [name, data?.length ?? 0]));
  return { objects: n, stacks: k, bytes, objectBytes: bytes.object_ids + bytes.object_class + bytes.object_predicted + bytes.object_confidence,
    buildMs: Math.round(ms), limit: tableLimit(tables) };
};

const rows = [1000, 65536, MAX_OBJECTS, MAX_OBJECTS + 1].map((n) => measure(n, 0));
const stackRows = [1000, 1_000_000].map((k) => measure(1000, k));
const record = {
  date: new Date().toISOString(), computer: `${os.type()} ${os.release()}, ${os.cpus()[0].model}, ${Math.round(os.totalmem() / 2 ** 30)} GiB`, node: process.version,
  limits: { objects: MAX_OBJECTS, stackBytes: MAX_STACK_BYTES }, objectTable: rows, stackTables: stackRows,
  bytesPerObject: rows[2].objectBytes / MAX_OBJECTS, largestObjectCount: MAX_OBJECTS,
  stacksWithinLimits: { byOffsets: Math.floor((MAX_STACK_BYTES - 4) / 4), byMembersOf3: Math.floor(MAX_STACK_BYTES / 12) },
};
console.log(JSON.stringify(record, null, 2));
if (out) fs.writeFileSync(out, JSON.stringify(record, null, 2) + '\n');
