// Card M8.4.10: record tables as engine buffers (tablesnapshot.js) and kept in the engine (engineclient.js::ensureTable), against an
// in-memory bridge and, when a development Python with NumPy is available, through the real bridge and engine. The decoding on the
// engine side and the probe of column sums are tested in tests/test_engine_tables.py.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createEngineClient, EngineError, RESIDENT_TABLE_BYTES, RESIDENT_TABLES } from '../../app/js/engineclient.js';
import { buildTableSnapshot, tableInputNames, TableSnapshotError, MAX_TABLE_COLUMNS, MAX_TABLE_ROWS, MAX_TABLE_DATA_BYTES, MAX_TABLE_META_BYTES,
  MAX_TABLE_NAME_BYTES, MAX_TABLE_UNIT_BYTES, TABLE_METADATA_CHARGE } from '../../app/js/tablesnapshot.js';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const bytesOf = (typed) => new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
const record = () => [
  { name: 'depth', unit: 'cm', values: [0, 1.5, 3, 4.5] },
  { name: 'Ca/Ti', unit: '', values: [0.25, null, -7, 1e-300] },
  { name: 'δ18O', unit: '‰', values: [null, null, null, null] },
];

// ---- the buffers ------------------------------------------------------------------------------------------------------------

test('a table becomes f64le[columns, rows] values, u8[columns, rows] validity and a utf8json description, missing slots 0', async () => {
  const snapshot = await buildTableSnapshot(record());
  const { meta, values, valid } = snapshot.buffers;
  assert.deepEqual([values.dtype, values.shape, valid.dtype, valid.shape, meta.dtype], ['f64le', [3, 4], 'u8', [3, 4], 'utf8json']);
  assert.deepEqual([...values.data], [0, 1.5, 3, 4.5, 0.25, 0, -7, 1e-300, 0, 0, 0, 0]);
  assert.deepEqual([...valid.data], [1, 1, 1, 1, 1, 0, 1, 1, 0, 0, 0, 0]);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(meta.data)),
    { version: 1, rows: 4, columns: [{ name: 'depth', unit: 'cm' }, { name: 'Ca/Ti', unit: '' }, { name: 'δ18O', unit: '‰' }] });
  assert.deepEqual([meta.shape, snapshot.rows, snapshot.columns.length], [[meta.data.length], 4, 3]);
  for (const buffer of [meta, values, valid]) assert.equal(buffer.sha256, sha(bytesOf(buffer.data)));
  assert.equal(snapshot.chargedBytes, 12 * 8 + 12 + TABLE_METADATA_CHARGE * meta.data.length);
  assert.deepEqual(tableInputNames('record'), { meta: 'record', values: 'record_values', valid: 'record_valid' });
});

test('every value and every missing slot survives exactly, -0 and subnormals included (seeded random tables)', async () => {
  let state = 41;
  const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const special = [-0, 5e-324, -5e-324, 1.7976931348623157e308, 2.2250738585072014e-308, 0.1];
  for (let t = 0; t < 50; t++) {
    const rows = 1 + Math.floor(random() * 200), count = 1 + Math.floor(random() * 6), p = random();
    const columns = Array.from({ length: count }, (_, i) => ({ name: `c${i}`, unit: '', values: Array.from({ length: rows },
      () => (random() < p ? null : random() < 0.2 ? special[Math.floor(random() * special.length)] : (random() - 0.5) * 10 ** Math.floor(random() * 60 - 30))) }));
    const { buffers } = await buildTableSnapshot(columns);
    columns.forEach((column, i) => column.values.forEach((v, j) => {
      assert.equal(buffers.valid.data[i * rows + j], v === null ? 0 : 1);
      assert.ok(Object.is(buffers.values.data[i * rows + j], v === null ? 0 : v), `table ${t} column ${i} row ${j}`);
    }));
  }
});

// ---- limits and refusals -------------------------------------------------------------------------------------------------------

async function refuses(columns, code, field) {
  await assert.rejects(buildTableSnapshot(columns), (error) => error instanceof TableSnapshotError && error.code === code && error.field === field);
}

test('malformed tables are refused naming the field', async () => {
  const one = (values, extra = {}) => [{ name: 'a', unit: '', values, ...extra }];
  await refuses([], 'INVALID_REQUEST', 'columns');
  await refuses(null, 'INVALID_REQUEST', 'columns');
  await refuses([null], 'INVALID_REQUEST', 'columns[0]');
  await refuses(one([]), 'INVALID_REQUEST', 'rows');
  await refuses(one(5), 'INVALID_REQUEST', 'columns[0].values');
  await refuses([{ name: 'a', values: [1, 2] }, { name: 'b', values: [1] }], 'INVALID_REQUEST', 'columns[1].values');
  for (const bad of [NaN, Infinity, -Infinity, undefined, '1', 1n, true]) await refuses(one([1, bad]), 'INVALID_REQUEST', 'columns[0].values[1]');
  await refuses(one(Float64Array.of(1, 2, NaN)), 'INVALID_REQUEST', 'columns[0].values[2]');
  await refuses([{ name: '', values: [1] }], 'INVALID_REQUEST', 'columns[0].name');
  await refuses([{ name: 7, values: [1] }], 'INVALID_REQUEST', 'columns[0].name');
  await refuses([{ name: 'a\uD800', values: [1] }], 'INVALID_REQUEST', 'columns[0].name');
  await refuses([{ name: 'a', values: [1] }, { name: 'a', values: [2] }], 'INVALID_REQUEST', 'columns[1].name');
  await refuses([{ name: 'a', unit: null, values: [1] }], 'INVALID_REQUEST', 'columns[0].unit');
  await refuses([{ name: 'a', unit: '\uDC00', values: [1] }], 'INVALID_REQUEST', 'columns[0].unit');
});

test('the limits on columns, rows, bytes, names and units are enforced at their edges', async () => {
  const column = (name, rows, unit = '') => ({ name, unit, values: new Float64Array(rows) });
  assert.ok(await buildTableSnapshot(Array.from({ length: MAX_TABLE_COLUMNS }, (_, i) => column(`c${i}`, 1))));
  await refuses(Array.from({ length: MAX_TABLE_COLUMNS + 1 }, (_, i) => column(`c${i}`, 1)), 'LIMIT_EXCEEDED', 'columns');
  await refuses([column('a', MAX_TABLE_ROWS + 1)], 'LIMIT_EXCEEDED', 'rows');
  const cells = Math.floor(MAX_TABLE_DATA_BYTES / 9);
  assert.ok(await buildTableSnapshot([column('a', cells)]));
  await refuses([column('a', cells + 1)], 'LIMIT_EXCEEDED', 'rows');
  await refuses([column('a', Math.floor(cells / 2) + 1), column('b', Math.floor(cells / 2) + 1)], 'LIMIT_EXCEEDED', 'rows');
  assert.ok(await buildTableSnapshot([column('é'.repeat(MAX_TABLE_NAME_BYTES / 2), 1, 'u'.repeat(MAX_TABLE_UNIT_BYTES))]));
  await refuses([column('é'.repeat(MAX_TABLE_NAME_BYTES / 2) + 'x', 1)], 'LIMIT_EXCEEDED', 'columns[0].name');
  await refuses([column('a', 1, 'u'.repeat(MAX_TABLE_UNIT_BYTES + 1))], 'LIMIT_EXCEEDED', 'columns[0].unit');
  // 256 long names fit every per-column limit but not the description's byte limit.
  const long = Array.from({ length: MAX_TABLE_COLUMNS }, (_, i) => column(`${i}`.padStart(200, 'n'), 1));
  await refuses(long, 'LIMIT_EXCEEDED', 'columns');
  assert.ok(MAX_TABLE_DATA_BYTES + TABLE_METADATA_CHARGE * MAX_TABLE_META_BYTES <= RESIDENT_TABLE_BYTES, 'the largest table fits the resident table budget alone');
});

// ---- identity -----------------------------------------------------------------------------------------------------------------

test('the identity changes with any value, missing slot, name, unit or column order, and with nothing else', async () => {
  const base = (await buildTableSnapshot(record())).identity;
  assert.match(base, /^[0-9a-f]{64}$/);
  const same = record().map((c) => ({ ...c, values: c.values.some((v) => v === null) ? [...c.values] : Float64Array.from(c.values) }));
  assert.equal((await buildTableSnapshot(same)).identity, base, 'a copy in another array type');
  assert.equal((await buildTableSnapshot(record().map(({ name, unit, values }) => ({ values, unit, name })))).identity, base, 'key order');
  const changed = async (edit) => { const columns = record(); edit(columns); return (await buildTableSnapshot(columns)).identity; };
  const identities = new Set([base]);
  for (const edit of [
    (c) => { c[0].values[2] = 3.0000000000000004; },          // one ulp
    (c) => { c[1].values[0] = -0.25; },
    (c) => { c[0].values[0] = -0; },                         // the sign of zero is a value
    (c) => { c[1].values[1] = 0; },                          // a missing slot becomes a present 0
    (c) => { c[1].values[0] = null; },                       // a value becomes missing
    (c) => { c[0].name = 'Depth'; },
    (c) => { c[2].unit = 'per mil'; },
    (c) => { c[0].unit = ''; },
    (c) => { c.reverse(); },
    (c) => { c.pop(); },
    (c) => { for (const col of c) col.values.pop(); },
  ]) identities.add(await changed(edit));
  assert.equal(identities.size, 12, 'every change gives a new identity');
});

// ---- resident in the engine (engineclient.js::ensureTable) -------------------------------------------------------------------

function memoryBridge() {
  const buffers = new Map(), released = [], begins = [];
  const bridge = {
    buffers, released, begins, refuseBegin: null,
    status: async () => ({ state: 'ready' }),
    beginBuffer: async (descriptor) => {
      begins.push(descriptor);
      if (bridge.refuseBegin?.(descriptor)) return { error: { code: 'LIMIT_EXCEEDED', field: 'byte_length' } };
      const token = crypto.randomUUID(); buffers.set(token, { ...descriptor, data: new Uint8Array(descriptor.byte_length), next: 0 }); return { token };
    },
    appendBuffer: async (token, offset, bytes) => { const b = buffers.get(token); assert.equal(offset, b.next); b.data.set(bytes, offset); b.next += bytes.length; return { next_offset: b.next }; },
    commitBuffer: async (token) => { const b = buffers.get(token); assert.equal(sha(b.data), b.sha256); return { token, byte_length: b.byte_length, sha256: b.sha256 }; },
    release: async (tokens) => { released.push(...tokens); for (const t of tokens) buffers.delete(t); return { released: tokens.length }; },
    readBuffer: async () => ({ error: { code: 'INVALID_BUFFER' } }), cancel: async () => ({}), analyzeSection: async () => ({ error: { code: 'INTERNAL' } }),
    restart: async () => ({}),
  };
  return bridge;
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const tableOf = (seed, rows = 5) => [{ name: 'depth', unit: 'cm', values: Array.from({ length: rows }, (_, i) => i + seed) }, { name: 'x', unit: '', values: Array.from({ length: rows }, (_, i) => (i % 2 ? null : seed * i)) }];

test('a table is sent once as its three buffers, byte for byte, and not again while its identity is the same', async () => {
  const bridge = memoryBridge(), client = createEngineClient(bridge), owner = {};
  const snapshot = await buildTableSnapshot(record());
  const tokens = await client.ensureTable(owner, 'record', snapshot);
  assert.deepEqual(Object.keys(tokens).sort(), ['identity', 'meta', 'valid', 'values']);
  assert.equal(tokens.identity, snapshot.identity);
  for (const name of ['meta', 'values', 'valid']) {
    const held = bridge.buffers.get(tokens[name]), buffer = snapshot.buffers[name];
    assert.deepEqual([held.dtype, held.shape], [buffer.dtype, buffer.shape]);
    assert.deepEqual(held.data, new Uint8Array(bytesOf(buffer.data)));
  }
  assert.equal(client.stats().residentTableBytes, snapshot.chargedBytes);
  const again = await client.ensureTable(owner, 'record', await buildTableSnapshot(record()));
  assert.deepEqual(again, tokens);
  assert.equal(bridge.begins.length, 3, 'nothing travels again');
  assert.ok(client.hasTable(owner, 'record', snapshot.identity));
  assert.ok(!client.hasTable(owner, 'other', snapshot.identity));
});

test('a changed table replaces and releases the three old buffers; other keys and owners keep theirs', async () => {
  const bridge = memoryBridge(), client = createEngineClient(bridge), owner = {}, other = {};
  const first = await client.ensureTable(owner, 'a', await buildTableSnapshot(tableOf(1)));
  const keptB = await client.ensureTable(owner, 'b', await buildTableSnapshot(tableOf(2)));
  const keptOther = await client.ensureTable(other, 'a', await buildTableSnapshot(tableOf(1)));
  const second = await client.ensureTable(owner, 'a', await buildTableSnapshot(tableOf(3)));
  await flush();
  assert.notEqual(second.identity, first.identity);
  assert.deepEqual(bridge.released.sort(), [first.meta, first.values, first.valid].sort());
  assert.equal(client.stats().residentTables, 3);
  for (const t of [second, keptB, keptOther]) for (const name of ['meta', 'values', 'valid']) assert.ok(bridge.buffers.has(t[name]));
});

test('tables have a budget of their own: the least recently used table is dropped first, by bytes and by count', async () => {
  const bridge = memoryBridge(), snapshots = await Promise.all([1, 2, 3].map((s) => buildTableSnapshot(tableOf(s, 100))));
  const client = createEngineClient(bridge, { tableBytes: snapshots[0].chargedBytes * 2 + 1 }), owner = {};
  const a = await client.ensureTable(owner, 'a', snapshots[0]);
  await client.ensureTable(owner, 'b', snapshots[1]);
  await client.ensureTable(owner, 'a', snapshots[0]);                 // a is used again: b is now the oldest
  await client.ensureTable(owner, 'c', snapshots[2]);
  await flush();
  assert.ok(client.hasTable(owner, 'a', a.identity) && client.hasTable(owner, 'c', snapshots[2].identity));
  assert.ok(!client.hasTable(owner, 'b', snapshots[1].identity));
  assert.equal(bridge.released.length, 3);
  const counted = createEngineClient(memoryBridge(), { tables: 2 });
  for (const key of ['a', 'b', 'c']) await counted.ensureTable(owner, key, snapshots[0]);
  assert.equal(counted.stats().residentTables, 2);
  assert.equal(RESIDENT_TABLES * 3 + 16 * 11 <= 256 - 16, true, 'tables, inputs and pixels of 16 sections leave room for an analysis in 256 handles');
});

test('a table larger than the table budget is refused before anything is sent and older buffers of its key are released', async () => {
  const bridge = memoryBridge(), small = await buildTableSnapshot(tableOf(1)), large = await buildTableSnapshot(tableOf(1, 1000));
  const client = createEngineClient(bridge, { tableBytes: small.chargedBytes + 100 }), owner = {};
  const held = await client.ensureTable(owner, 'a', small);
  await assert.rejects(client.ensureTable(owner, 'a', large), (e) => e instanceof EngineError && e.code === 'LIMIT_EXCEEDED' && e.field === 'table');
  await flush();
  assert.equal(bridge.begins.length, 3);
  assert.deepEqual(bridge.released.sort(), [held.meta, held.values, held.valid].sort());
  await assert.rejects(client.ensureTable(owner, 'a', { identity: 'x' }), (e) => e.code === 'INVALID_REQUEST' && e.field === 'table');
  await assert.rejects(client.ensureTable(owner, '', small), (e) => e.code === 'INVALID_REQUEST' && e.field === 'table');
});

test('two requests for the same table share one upload; a refused upload keeps the resident table and releases what it sent', async () => {
  const bridge = memoryBridge(), client = createEngineClient(bridge), owner = {};
  const snapshot = await buildTableSnapshot(tableOf(4));
  const [one, two] = await Promise.all([client.ensureTable(owner, 'a', snapshot), client.ensureTable(owner, 'a', snapshot)]);
  assert.deepEqual(one, two);
  assert.equal(bridge.begins.length, 3);
  bridge.refuseBegin = (d) => d.dtype === 'u8';
  await assert.rejects(client.ensureTable(owner, 'a', await buildTableSnapshot(tableOf(5))), (e) => e.code === 'LIMIT_EXCEEDED');
  await flush();
  assert.ok(client.hasTable(owner, 'a', snapshot.identity));
  assert.equal(bridge.released.length, 2, 'the new description and values were released');
  for (const name of ['meta', 'values', 'valid']) assert.ok(bridge.buffers.has(one[name]));
});

test('the engine reporting a full budget makes the client drop other tables and pixels, then try once more', async () => {
  const bridge = memoryBridge(), client = createEngineClient(bridge), owner = {};
  const old = await client.ensureTable(owner, 'old', await buildTableSnapshot(tableOf(6)));
  const section = { w: 2, h: 3, orig: new Uint8ClampedArray(24).fill(9) }, pixels = await client.ensurePixels(section, section);
  let refusals = 1;
  bridge.refuseBegin = () => refusals-- > 0;
  const fresh = await client.ensureTable(owner, 'new', await buildTableSnapshot(tableOf(7)));
  await flush();
  assert.equal(client.stats().budgetFull, 1);
  assert.deepEqual(bridge.released.sort(), [old.meta, old.values, old.valid, pixels.rgba].sort());
  assert.equal(client.stats().residentPixelBytes, 0);
  assert.ok(bridge.buffers.has(fresh.valid));
});

test('forget, releaseAll and a restart cover the tables', async () => {
  const bridge = memoryBridge(), client = createEngineClient(bridge), owner = {}, other = {};
  const mine = await client.ensureTable(owner, 'a', await buildTableSnapshot(tableOf(8)));
  const theirs = await client.ensureTable(other, 'a', await buildTableSnapshot(tableOf(9)));
  client.forget(owner); await flush();
  assert.deepEqual(bridge.released.sort(), [mine.meta, mine.values, mine.valid].sort());
  assert.equal(client.stats().residentTables, 1);
  client.releaseAll(); await flush();
  assert.equal(bridge.released.length, 6);
  for (const name of ['meta', 'values', 'valid']) assert.ok(bridge.released.includes(theirs[name]));
  await client.ensureTable(owner, 'a', await buildTableSnapshot(tableOf(8)));
  const before = bridge.released.length;
  await client.restart(); await flush();
  assert.equal(bridge.released.length, before, 'a restart forgets without asking the new session');
  assert.equal(client.stats().residentTables, 0);
});

// ---- through the real bridge and engine ----------------------------------------------------------------------------------

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../', import.meta.url));
const pythonCheck = spawnSync(process.platform === 'win32' ? 'py' : 'python3',
  [...(process.platform === 'win32' ? ['-3.12'] : []), '-c', 'import sys, numpy; print(sys.executable)'], { encoding: 'utf8', windowsHide: true });
const python = process.env.SEDCORETOOL_TEST_PYTHON || (pythonCheck.status === 0 ? pythonCheck.stdout.trim() : null);

test('a table through the real bridge and engine: every byte read back equals the snapshot', { skip: !python, timeout: 120000 }, async (t) => {
  const { createEngineIpc } = require('../../desktop/engine-ipc.js'), { createEngineService } = require('../../desktop/engine.js');
  const service = createEngineService({ enabled: true, packaged: false, executable: python, sourceDirectory: root, version: 'test' });
  await service.start();
  t.after(() => service.stop());
  const ipc = createEngineIpc({ engine: service });
  const page = Object.fromEntries(ipc.OPERATIONS.map((name) => [name, (...args) => ipc.call(7, name, ...args)]));
  const client = createEngineClient({ ...page, status: async () => service.status() });
  const rows = 60000, owner = {};                                    // 2.4 MB of values: three chunks of 1 MiB
  const snapshot = await buildTableSnapshot([
    { name: 'depth', unit: 'cm', values: Array.from({ length: rows }, (_, i) => i * 0.1) },
    { name: 'Ca/Ti', unit: '', values: Array.from({ length: rows }, (_, i) => (i % 7 ? Math.sin(i) * 1e3 : null)) },
    { name: 'δ18O', unit: '‰', values: Array.from({ length: rows }, (_, i) => (i % 3 ? null : -i / 3)) },
    { name: 'age', unit: 'ka', values: Array.from({ length: rows }, (_, i) => i / 1000) },
    { name: 'empty', unit: '', values: new Array(rows).fill(null) },
  ]);
  const tokens = await client.ensureTable(owner, 'record', snapshot);
  const readAll = async (token, length) => {
    const parts = [];
    for (let offset = 0; offset < length; offset += 1048576) {
      const read = await page.readBuffer(token, offset, Math.min(1048576, length - offset));
      assert.equal(read.error, undefined, JSON.stringify(read.error));
      parts.push(Buffer.from(read.bytes));
    }
    return Buffer.concat(parts);
  };
  for (const name of ['meta', 'values', 'valid']) {
    const data = bytesOf(snapshot.buffers[name].data);
    assert.ok(Buffer.from(data).equals(await readAll(tokens[name], data.byteLength)), `${name} bytes read back equal`);
  }
  assert.deepEqual(await client.ensureTable(owner, 'record', snapshot), tokens, 'resident: nothing travels again');
  client.releaseAll(); await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(ipc.size(), 0, 'the page holds no token after a project is replaced');
});
