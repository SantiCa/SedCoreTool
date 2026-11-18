// Card M8.4.16 step 4: the masks of tiled sections sent to the engine's store in the background, acknowledged only after the commit, sent
// again after a failure, and read back when the page dropped them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { MaskSync, MaskLoader, maskTables } from '../../app/js/tiledsync.js';
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

test('maskTables: the objects, classes and stack tables of contract §4 as bytes', () => {
  const s = { objects: new Map([[3, { id: 3, cls: 'a', pred: null, conf: 1 }]]), stacks: [null, [3, 4]] };
  const tables = maskTables(s, [{ id: 'a', name: 'Burrow', counts: true }]);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(tables.objects)), [{ id: 3, class_id: 'a', predicted_class_id: null, confidence: 1 }]);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(tables.classes)), [{ id: 'a', name: 'Burrow', counts: true }]);
  assert.deepEqual([...new Uint32Array(tables.stack_offsets.buffer)], [0, 0, 2]);
  assert.deepEqual([...new Uint32Array(tables.stack_members.buffer)], [3, 4]);
  assert.equal(maskTables({ objects: new Map(), stacks: [null] }, []).stack_members, null);
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
