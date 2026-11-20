// Cards M8.4.16 step 7 and M8.4.22: how many objects and overlap stacks fit the limits of the stored tables (contract §8.7), measured with the
// page's own table builder (`maskTables`) and limit check (`tableLimit`), not estimated. Card M8.4.25 adds `rounds`: how long a sending round
// keeps the page's thread busy with 2^20 objects, after a stroke that changed no object and after a class change (the longest task between
// two pauses, and the whole round with an instant store). Writes a JSON record.
//   node tools/measure_mask_tables.mjs --out docs/validation/M8.4.25-mask-rounds.json
import fs from 'node:fs';
import os from 'node:os';
import { maskTables, buildMaskTables, classesText, tableLimit, MaskSync, MAX_OBJECTS, MAX_STACK_BYTES } from '../app/js/tiledsync.js';
import { MaskTiles } from '../app/js/tiledmasks.js';

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
  const s = section(n, k), started = performance.now(), tables = maskTables(s, classes), ms = performance.now() - started;   // the build alone (card M8.4.25)
  const bytes = Object.fromEntries(Object.entries(tables).map(([name, data]) => [name, data?.length ?? 0]));
  return { objects: n, stacks: k, bytes, objectBytes: bytes.object_ids + bytes.object_class + bytes.object_predicted + bytes.object_confidence,
    buildMs: Math.round(ms), limit: tableLimit(tables) };
};

/**
 * One round of `MaskSync` as the page runs it (cheap checks of app.js, slices with a macrotask pause), on an instant in-memory store and with
 * no dirty tile, so that what is measured is the tables' part. Each synchronous stretch of the round is timed: from the start of the round
 * (the cheap checks) to the first pause, between pauses, and from the last pause to the commit.
 */
async function round(s, groupsOf, edit) {
  const tiles = new MaskTiles({ width: 512, height: 512 }), stretches = [];
  let mark = 0, seen = null;
  const store = { begin: async () => { stretches.push(performance.now() - mark); return 'staged'; }, put: async () => {},
    commit: async () => { mark = performance.now(); return 'manifest'; }, discard: async () => {} };
  const changed = () => {
    mark = performance.now();
    const now = { classes: classesText(classes), objects: s.objects.size, nextId: s.nextId, stacks: s.stacks, stackCount: s.stacks.length };
    const groups = [];
    if (!seen || now.classes !== seen.classes || now.objects !== seen.objects || now.nextId !== seen.nextId) groups.push('objects');
    if (!seen || now.stacks !== seen.stacks || now.stackCount !== seen.stackCount) groups.push('stacks');
    seen = now;
    return groups;
  };
  const pause = async () => { stretches.push(performance.now() - mark); await new Promise((r) => setTimeout(r, 0)); mark = performance.now(); };
  const sync = new MaskSync({ tiles, api: /** @type {any} */ (store), sha256: async () => '0'.repeat(64), changed, pause, delayMs: 0, wait: async () => {},
    tables: (groups, p) => buildMaskTables(s, classes, groups, p) });
  await sync.request();                                                     // the first round: every table
  edit(s);
  stretches.length = 0;
  const started = performance.now();
  await sync.request(groupsOf);
  const wallMs = performance.now() - started;
  return { groups: groupsOf, longestTaskMs: +Math.max(...stretches).toFixed(2), threadMs: +stretches.reduce((a, b) => a + b, 0).toFixed(2),
    tasks: stretches.length, wallMs: +wallMs.toFixed(2) };
}
const big = { ...section(MAX_OBJECTS, 1000), nextId: MAX_OBJECTS + 1 };
const rounds = {
  objects: MAX_OBJECTS,
  afterStrokeNoObjectChanged: await round(big, [], () => {}),
  afterClassChange: await round(big, ['objects'], (s) => { s.objects.get(1).cls = classes[0].id; }),
  afterClassRename: await round(big, [], () => { classes[0].name = 'renamed'; }),
};

const rows = [1000, 65536, MAX_OBJECTS, MAX_OBJECTS + 1].map((n) => measure(n, 0));
const stackRows = [1000, 1_000_000].map((k) => measure(1000, k));
const record = {
  date: new Date().toISOString(), computer: `${os.type()} ${os.release()}, ${os.cpus()[0].model}, ${Math.round(os.totalmem() / 2 ** 30)} GiB`, node: process.version,
  limits: { objects: MAX_OBJECTS, stackBytes: MAX_STACK_BYTES }, rounds, objectTable: rows, stackTables: stackRows,
  bytesPerObject: rows[2].objectBytes / MAX_OBJECTS, largestObjectCount: MAX_OBJECTS,
  stacksWithinLimits: { byOffsets: Math.floor((MAX_STACK_BYTES - 4) / 4), byMembersOf3: Math.floor(MAX_STACK_BYTES / 12) },
};
console.log(JSON.stringify(record, null, 2));
if (out) fs.writeFileSync(out, JSON.stringify(record, null, 2) + '\n');
