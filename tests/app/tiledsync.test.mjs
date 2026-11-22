// Card M8.4.16 step 4: the masks of tiled sections sent to the engine's store in the background, acknowledged only after the commit, sent
// again after a failure, and read back when the page dropped them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { MaskSync, MaskLoader, maskTables, buildMaskTables, classesText, tableLimit, MAX_OBJECTS } from '../../app/js/tiledsync.js';
import { MaskTiles, LABEL_BYTES, EXCLUDE_BYTES } from '../../app/js/tiledmasks.js';
import { TILE } from '../../app/js/tiledsection.js';

const N = TILE * TILE;
const sha = async (bytes) => createHash('sha256').update(bytes).digest('hex');
const labelsWith = (value, at = 7) => { const a = new Int32Array(N); a[at] = value; return a; };

/** An in-memory store with the semantics of contract §8.7: staged versions copy their base; `failOn` makes one call fail once. */
function fakeStore() {
  const manifests = new Map(), staged = new Map(), calls = [];
  let counter = 0;
  const store = {
    manifests, calls, failOn: null,
    fail(name) { if (store.failOn === name) { store.failOn = null; throw Object.assign(new Error('ENGINE_UNAVAILABLE'), { code: 'ENGINE_UNAVAILABLE' }); } },
    api: {
      begin: async (base) => { calls.push('begin'); store.fail('begin'); const id = `s${++counter}`; staged.set(id, new Map(base ? manifests.get(base).tiles : [])); return id; },
      put: async (id, layer, row, col, sha256, bytes) => {
        calls.push(`put ${layer} ${row}.${col}`); store.fail('put');
        assert.equal(sha256, await sha(bytes)); assert.equal(bytes.length, layer === 'labels' ? LABEL_BYTES : EXCLUDE_BYTES);
        const tiles = staged.get(id), entry = { ...(tiles.get(`${row}.${col}`) || {}) };
        entry[layer] = bytes.every((v) => v === 0) ? null : bytes.slice();
        if (!entry.labels && !entry.exclude) tiles.delete(`${row}.${col}`); else tiles.set(`${row}.${col}`, entry);
      },
      commit: async (id, tables) => {
        calls.push('commit'); const tiles = staged.get(id); staged.delete(id);
        const name = `m${++counter}`; manifests.set(name, { tiles, tables });
        store.fail('commit');                                          // written, but the answer is lost
        return name;
      },
      discard: async (id) => { calls.push('discard'); staged.delete(id); },
    },
  };
  return store;
}

const instant = { delayMs: 0, retryMs: [0], wait: async () => {} };

test('a round sends the dirty tiles and the tables, then acknowledges them; erased tiles leave the stored version', async () => {
  const tiles = new MaskTiles({ width: 1300, height: 1100 }), store = fakeStore();
  tiles.set(0, 0, labelsWith(3), null); tiles.set(1, 2, null, Uint8Array.from({ length: N }, (_, i) => (i === 9 ? 1 : 0)));
  const sync = new MaskSync({ tiles, api: store.api, tables: () => ({ objects: new Uint8Array([91, 93]) }), sha256: sha, ...instant });
  await sync.request();
  assert.ok(sync.settled);
  const stored = store.manifests.get(sync.manifest);
  assert.deepEqual([...stored.tiles.keys()].sort(), ['0.0', '1.2']);
  assert.equal(new Int32Array(stored.tiles.get('0.0').labels.buffer)[7], 3);
  assert.equal(stored.tiles.get('0.0').exclude, null);
  assert.deepEqual(tiles.dirtyPositions(), []);
  assert.ok(tiles.stored.has(0) && tiles.stored.has(5));
  tiles.set(0, 0, null, null);                                          // erased
  const first = sync.manifest;
  await sync.request();
  assert.notEqual(sync.manifest, first);
  assert.deepEqual([...store.manifests.get(sync.manifest).tiles.keys()], ['1.2'], 'the new version starts from the last acknowledged one');
  assert.equal(tiles.stored.has(0), false);
});

test('a tile edited while its round is on its way stays dirty and goes out in the next round', async () => {
  const tiles = new MaskTiles({ width: 1024, height: 512 }), store = fakeStore();
  tiles.set(0, 0, labelsWith(1), null); tiles.set(0, 1, labelsWith(2), null);
  const put = store.api.put;
  let edited = false;
  store.api.put = async (...args) => {
    await put(...args);
    if (!edited && args[1] === 'exclude' && args[2] === 0 && args[3] === 0) { edited = true; tiles.set(0, 0, labelsWith(5), null); sync.request(); }
  };
  const sync = new MaskSync({ tiles, api: store.api, tables: () => ({}), sha256: sha, ...instant });
  await sync.request();
  while (sync.running) await sync.running;
  assert.ok(sync.settled);
  assert.equal(new Int32Array(store.manifests.get(sync.manifest).tiles.get('0.0').labels.buffer)[7], 5, 'the newer edit is stored');
  assert.equal(store.calls.filter((c) => c === 'commit').length, 2);
});

test('a failure at any step acknowledges nothing, drops the staged version, recovers and sends everything again', async () => {
  for (const failing of ['begin', 'put', 'commit']) {
    const tiles = new MaskTiles({ width: 1024, height: 1024 }), store = fakeStore(), states = [];
    tiles.set(0, 0, labelsWith(1), null); tiles.set(1, 1, labelsWith(2, 300), null);
    let recovered = 0;
    const sync = new MaskSync({ tiles, api: store.api, tables: () => ({ objects: new Uint8Array([91, 93]) }), sha256: sha, ...instant,
      recover: async (error) => { assert.equal(error.code, 'ENGINE_UNAVAILABLE'); recovered++; }, onState: ({ state }) => states.push(state) });
    store.failOn = failing;
    await sync.request();
    assert.equal(recovered, 1, failing);
    assert.ok(states.includes('failed') && states.at(-1) === 'stored', failing);
    assert.ok(sync.settled, failing);
    const stored = store.manifests.get(sync.manifest);
    assert.deepEqual([...stored.tiles.keys()].sort(), ['0.0', '1.1'], `${failing}: complete after the retry`);
    if (failing !== 'begin') assert.ok(store.calls.includes('discard'), `${failing}: the failed staged version is dropped`);
    assert.equal(store.manifests.size, failing === 'commit' ? 2 : 1, 'a commit whose answer was lost may leave one unused version, never a partial one');
  }
});

test('a round keeps trying with growing pauses while the store stays unreachable, and the page keeps every edit', async () => {
  const tiles = new MaskTiles({ width: 512, height: 512 }), store = fakeStore(), pauses = [];
  tiles.set(0, 0, labelsWith(4), null);
  let failures = 3;
  const begin = store.api.begin;
  store.api.begin = async (base) => { if (failures-- > 0) throw Object.assign(new Error('ENGINE_UNAVAILABLE'), { code: 'ENGINE_UNAVAILABLE' }); return begin(base); };
  const sync = new MaskSync({ tiles, api: store.api, tables: () => ({}), sha256: sha, delayMs: 0, retryMs: [10, 20, 40], wait: async (ms) => { pauses.push(ms); } });
  await sync.request();
  assert.deepEqual(pauses, [0, 10, 20, 40]);
  assert.equal(tiles.get(0, 0).labels[7], 4);
  assert.ok(sync.settled);
});

test('maskTables: the objects as four columns of contract §8.7, the classes and the stack tables as bytes', () => {
  const s = { objects: new Map([[9, { id: 9, cls: null, pred: 'b', conf: 0.25 }], [3, { id: 3, cls: 'a', pred: null, conf: 1 }],
    [4, { id: 4, cls: 'gone', pred: null, conf: NaN }]]), stacks: [null, [3, 4]] };
  const classes = [{ id: 'a', name: 'Burrow', counts: true }, { id: 'b', name: 'Other', counts: false }], tables = maskTables(s, classes);
  const view = (bytes, Type) => [...new Type(bytes.buffer, bytes.byteOffset, bytes.byteLength / Type.BYTES_PER_ELEMENT)];
  assert.deepEqual(view(tables.object_ids, Uint32Array), [9, 3, 4], 'in the order of the objects map');
  assert.deepEqual(view(tables.object_class, Int32Array), [-1, 0, -1], 'none, and an identifier the classes do not hold, are -1');
  assert.deepEqual(view(tables.object_predicted, Int32Array), [1, -1, -1]);
  assert.deepEqual(view(tables.object_confidence, Float64Array), [0.25, 1, 0]);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(tables.classes)), [{ id: 'a', name: 'Burrow', counts: true }, { id: 'b', name: 'Other', counts: false }]);
  assert.deepEqual([...new Uint32Array(tables.stack_offsets.buffer)], [0, 0, 2]);
  assert.deepEqual([...new Uint32Array(tables.stack_members.buffer)], [3, 4]);
  const empty = maskTables({ objects: new Map(), stacks: [null] }, []);
  assert.deepEqual([empty.object_ids, empty.object_class, empty.object_predicted, empty.object_confidence, empty.stack_members], [null, null, null, null, null]);
});

test('tableLimit: 2^20 objects pass, one more is refused in the page; a round beyond a limit sends nothing and waits for the next change', async () => {
  const columns = (n) => ({ object_ids: new Uint8Array(4 * n), classes: new Uint8Array(2), stack_offsets: new Uint8Array(8), stack_members: null });
  assert.equal(tableLimit(/** @type {any} */ (columns(MAX_OBJECTS))), null);
  assert.deepEqual(tableLimit(/** @type {any} */ (columns(MAX_OBJECTS + 1))), { field: 'objects', limit: MAX_OBJECTS });
  assert.deepEqual(tableLimit(/** @type {any} */ ({ ...columns(1), stack_members: new Uint8Array(16 * 2 ** 20 + 4) })), { field: 'stack_members', limit: 16 * 2 ** 20 });
  const tiles = new MaskTiles({ width: 512, height: 512 }), store = fakeStore(), states = [];
  tiles.set(0, 0, labelsWith(4), null);
  let over = true;
  const sync = new MaskSync({ tiles, api: store.api, tables: () => columns(over ? MAX_OBJECTS + 1 : 3), sha256: sha, ...instant,
    onState: ({ state, error }) => states.push(state === 'limit' ? `limit ${error.field}` : state) });
  await sync.request();
  assert.deepEqual(store.calls, [], 'no request reaches the store');
  assert.deepEqual(states, ['sending', 'limit objects']);
  assert.equal(sync.settled, false);
  assert.equal(tiles.get(0, 0).dirty, true, 'the masks stay in the page');
  over = false;
  await sync.request();
  assert.ok(sync.settled, 'below the limit again, the next change sends everything');
});

// Card M8.4.25: only the groups of tables that changed are sent; the page's checks find what an edit marked "tiles only" may still carry.
const CLASSES = [{ id: 'a', name: 'Burrow', counts: true }, { id: 'b', name: 'Other', counts: true }];
function pageSection() {
  return { objects: new Map([[1, { id: 1, cls: 'a', pred: null, conf: 0 }], [2, { id: 2, cls: null, pred: 'b', conf: 0.5 }]]), stacks: [null], nextId: 3 };
}
/** A sync wired as app.js wires it: real table building in slices, and the same cheap checks. */
function pageSync(s, classes, tiles, store, extra = {}) {
  let seen = null;
  const changed = () => {
    const now = { classes: classesText(classes), objects: s.objects.size, nextId: s.nextId, stacks: s.stacks, stackCount: s.stacks.length };
    const groups = [];
    if (!seen || now.classes !== seen.classes || now.objects !== seen.objects || now.nextId !== seen.nextId) groups.push('objects');
    if (!seen || now.stacks !== seen.stacks || now.stackCount !== seen.stackCount) groups.push('stacks');
    seen = now;
    return groups;
  };
  return new MaskSync({ tiles, api: store.api, sha256: sha, ...instant, pause: async () => {}, changed,
    tables: (groups, pause) => buildMaskTables(s, classes, groups, pause, { sliceMs: 0 }), ...extra });
}
const sentTables = (store, manifest) => Object.keys(store.manifests.get(manifest).tables).sort();
const OBJECT_TABLES = ['classes', 'object_class', 'object_confidence', 'object_ids', 'object_predicted'];

test('the first round sends every table; a round with only tile changes sends none', async () => {
  const s = pageSection(), tiles = new MaskTiles({ width: 512, height: 512 }), store = fakeStore(), sync = pageSync(s, CLASSES, tiles, store);
  tiles.set(0, 0, labelsWith(1), null);
  await sync.request([]);
  assert.deepEqual(sentTables(store, sync.manifest), [...OBJECT_TABLES, 'stack_members', 'stack_offsets'].sort(), 'no base yet: everything');
  tiles.set(0, 0, labelsWith(2), null);
  await sync.request([]);                                                   // a stroke on existing objects
  assert.deepEqual(sentTables(store, sync.manifest), [], 'the base keeps every table');
  assert.ok(sync.settled);
  s.objects.get(1).area = 99;                                               // statistics alone
  await sync.request([]);
  assert.deepEqual(sentTables(store, sync.manifest), []);
});

test('card Q14: a section reopened on a stored version is settled only after one round, which only a request starts; that round sends the tables and no tile', async () => {
  const s = pageSection(), tiles = new MaskTiles({ width: 512, height: 512 }), store = fakeStore(), first = pageSync(s, CLASSES, tiles, store);
  tiles.set(0, 0, labelsWith(1), null);
  await first.request();
  const saved = first.manifest, calls = store.calls.length;
  const reopened = new MaskTiles({ width: 512, height: 512 }), sync = pageSync(s, CLASSES, reopened, store);
  reopened.stored.add(reopened.index(0, 0));
  sync.manifest = saved;                                                  // as loadTiledSection does
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(sync.settled, false, 'its tables are not acknowledged yet (the page rebuilt them from the record)');
  assert.equal(sync.running, null, 'and nothing sends them by itself: a save or an edit asks for the round');
  assert.equal(store.calls.length, calls);
  await sync.request([]);
  assert.ok(sync.settled);
  assert.deepEqual(store.calls.slice(calls), ['begin', 'commit'], 'no tile is sent again');
  assert.deepEqual(sentTables(store, sync.manifest), [...OBJECT_TABLES, 'stack_members', 'stack_offsets'].sort());
  assert.deepEqual([...store.manifests.get(sync.manifest).tiles.keys()], ['0.0'], 'on the stored version as its base');
});

test('a class change sends the object columns and the classes; a new object and a new stack are found though the edit said "tiles only"', async () => {
  const s = pageSection(), classes = CLASSES.map((c) => ({ ...c })), tiles = new MaskTiles({ width: 512, height: 512 }), store = fakeStore();
  const sync = pageSync(s, classes, tiles, store);
  await sync.request();
  s.objects.get(1).cls = 'b';                                               // reclassified: the editing code asks for the objects
  await sync.request(['objects']);
  assert.deepEqual(sentTables(store, sync.manifest), OBJECT_TABLES);
  assert.deepEqual([...new Int32Array(store.manifests.get(sync.manifest).tables.object_class.buffer)], [1, -1]);
  classes[1].name = 'Renamed';                                              // a class edit that asked for nothing
  await sync.request([]);
  assert.deepEqual(sentTables(store, sync.manifest), OBJECT_TABLES, 'the classes text changed');
  s.objects.set(3, { id: 3, cls: null, pred: null, conf: 0 }); s.nextId = 4;   // a stroke that began a new trace
  await sync.request([]);
  assert.deepEqual(sentTables(store, sync.manifest), OBJECT_TABLES);
  s.stacks.push([1, 3]);                                                    // a stroke that overlapped two traces
  await sync.request([]);
  assert.deepEqual(sentTables(store, sync.manifest), ['stack_members', 'stack_offsets']);
  s.stacks = [null];                                                        // stacks compacted (a new array)
  await sync.request([]);
  assert.deepEqual(sentTables(store, sync.manifest), ['stack_members', 'stack_offsets']);
  assert.equal(store.manifests.get(sync.manifest).tables.stack_members, null);
  s.objects.delete(3);                                                      // removed by the statistics (no area left)
  await sync.request([]);
  assert.deepEqual(sentTables(store, sync.manifest), OBJECT_TABLES);
  assert.ok(sync.settled);
});

test('after a failed round, every group not acknowledged is sent again with the tiles', async () => {
  for (const failing of ['begin', 'put', 'commit']) {
    const s = pageSection(), tiles = new MaskTiles({ width: 512, height: 512 }), store = fakeStore(), sync = pageSync(s, CLASSES, tiles, store);
    await sync.request();
    s.objects.get(2).pred = 'a';
    tiles.set(0, 0, labelsWith(7), null);
    store.failOn = failing;
    await sync.request(['objects']);
    assert.ok(sync.settled, failing);
    const stored = store.manifests.get(sync.manifest);
    assert.deepEqual(sentTables(store, sync.manifest), OBJECT_TABLES, `${failing}: the objects again`);
    assert.deepEqual([...new Int32Array(stored.tables.object_predicted.buffer)], [-1, 0], failing);
    assert.equal(new Int32Array(stored.tiles.get('0.0').labels.buffer)[7], 7, failing);
  }
});

test('buildMaskTables: the same bytes as maskTables, in slices; built again when the objects change between two slices', async () => {
  const s = { objects: new Map(), stacks: [null, [1, 2]] };
  for (let id = 1; id <= 10000; id++) s.objects.set(id, { id, cls: id % 3 ? 'a' : null, pred: id % 3 ? null : 'b', conf: id % 3 ? 0 : 0.5 });
  let pauses = 0;
  const sliced = await buildMaskTables(s, CLASSES, ['objects', 'stacks'], async () => { pauses++; }, { sliceMs: 0 });
  assert.ok(pauses >= 2, 'the page ran between slices');
  assert.deepEqual(sliced, maskTables(s, CLASSES));
  assert.deepEqual(Object.keys(maskTables(s, CLASSES, ['stacks'])).sort(), ['stack_members', 'stack_offsets']);
  let first = true;
  const changed = await buildMaskTables(s, CLASSES, ['objects'], async () => {
    if (first) { first = false; s.objects.set(10001, { id: 10001, cls: null, pred: null, conf: 0 }); }   // a new trace during the build
  }, { sliceMs: 0 });
  assert.equal(changed.object_ids.length / 4, 10001, 'built again from the start, with the new object');
  assert.deepEqual(changed, maskTables(s, CLASSES, ['objects']));
});

test('a group changed while it is being built is built again before anything is sent; a removed section stops building', async () => {
  const s = pageSection(), tiles = new MaskTiles({ width: 512, height: 512 }), store = fakeStore();
  let builds = 0, sync;
  sync = pageSync(s, CLASSES, tiles, store, { tables: async (groups, pause) => {
    builds++;
    const tables = maskTables(s, CLASSES, groups);
    if (builds === 2) { s.objects.get(1).cls = 'b'; sync.mark(['objects']); }   // reclassified during the build
    await pause();
    return tables;
  } });
  await sync.request();
  await sync.request(['objects']);
  assert.equal(builds, 3, 'the build that saw the change is dropped');
  assert.deepEqual([...new Int32Array(store.manifests.get(sync.manifest).tables.object_class.buffer)], [1, -1]);
  assert.equal(store.calls.filter((c) => c === 'begin').length, 2, 'nothing was sent for the dropped build');
  const stopping = pageSync(s, CLASSES, tiles, fakeStore(), { tables: async (groups, pause) => { stopping.stop(); await pause(); return {}; } });
  await stopping.request();
  assert.equal(stopping.manifest, null);
});

test('MaskLoader: tiles the page dropped are read back once, and a read never replaces an edit', async () => {
  const tiles = new MaskTiles({ width: 2048, height: 512, budget: LABEL_BYTES }), reads = [];
  tiles.set(0, 0, labelsWith(1), null); tiles.set(0, 1, labelsWith(2), null);
  tiles.acknowledge([[0, 0], [0, 1]]);                                // the budget drops the older clean tile
  assert.equal(tiles.state(0, 0), 'missing');
  const loader = new MaskLoader({ tiles, manifest: () => 'm1', read: async (manifest, layer, positions) => {
    reads.push([manifest, layer, positions.map(String)]);
    return positions.map(([, col]) => (layer === 'labels' ? new Uint8Array(labelsWith(col + 1).buffer) : null));
  } });
  await Promise.all([loader.want([[0, 0], [0, 1]]), loader.want([[0, 0]])]);
  assert.deepEqual(reads, [['m1', 'labels', ['0,0']], ['m1', 'exclude', ['0,0']]], 'one read per layer, only the missing tile');
  assert.equal(tiles.state(0, 0), 'loaded');
  assert.equal(tiles.get(0, 0).labels[7], 1);
  assert.equal(tiles.get(0, 0).dirty, false);
  const failing = new MaskLoader({ tiles, manifest: () => null, read: async () => [] });
  tiles.acknowledge([]); tiles.set(0, 3, labelsWith(9), null); tiles.acknowledge([[0, 3]]);
  const missing = [[0, 0], [0, 1], [0, 3]].filter(([r, c]) => tiles.state(r, c) === 'missing');
  if (missing.length) await assert.rejects(failing.want(missing));
});

test('card M8.4.35: a test hook holds a round after its last tile and before its commit; without it nothing waits', async () => {
  const tiles = new MaskTiles({ width: 1300, height: 1100 }), store = fakeStore();
  tiles.set(0, 0, labelsWith(3), null);
  const sync = new MaskSync({ tiles, api: store.api, tables: () => ({ objects: new Uint8Array([1]) }), sha256: sha, ...instant });
  assert.equal(sync.beforeCommit, null);
  let release;
  sync.beforeCommit = () => new Promise((resolve) => { release = resolve; });
  const sending = sync.request();
  for (let i = 0; i < 50 && !release; i++) await new Promise((r) => setTimeout(r, 1));
  assert.ok(release, 'held');
  assert.deepEqual(store.calls, ['begin', 'put labels 0.0', 'put exclude 0.0'], 'every tile sent, nothing committed');
  assert.equal(sync.puts, 2);
  release();
  await sending;
  assert.equal(store.calls.at(-1), 'commit');
  assert.ok(sync.settled);
});
