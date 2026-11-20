// Card M8.4.15: the page's bridge to the tile store (desktop/tile-ipc.js) and the main process's own tile reader (desktop/tile-reader.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { TileReader } = require('../../desktop/tile-reader.js');
const { createTileIpc, MAX_SOURCES_PER_PAGE } = require('../../desktop/tile-ipc.js');
const sha = (data) => createHash('sha256').update(data).digest();

/** A small pyramid written by hand as contract §8.2 describes it (keys sorted, as the engine writes them): 600 x 300 grey, two levels. */
function writePyramid(root, { compress = false } = {}) {
  const pyramid = sha(Buffer.from(`source ${compress}`)).toString('hex');
  const folder = path.join(root, pyramid);
  const levels = [{ cols: 2, height: 300, level: 0, rows: 1, width: 600 }, { cols: 1, height: 150, level: 1, rows: 1, width: 300 }];
  const tiles = {};
  for (const level of levels) {
    fs.mkdirSync(path.join(folder, String(level.level)), { recursive: true });
    const hashes = [];
    for (let col = 0; col < level.cols; col++) {
      const data = Buffer.alloc(512 * 512, (level.level * 16 + col * 3 + 1) & 255);
      tiles[`${level.level}/0/${col}`] = data;
      hashes.push(sha(data));
      fs.writeFileSync(path.join(folder, String(level.level), `0.${col}.0`), compress ? zlib.deflateSync(data, { level: 1 }) : data);
    }
    fs.writeFileSync(path.join(folder, String(level.level), '.tiles.sha256'), Buffer.concat(hashes));
  }
  const description = { bits: 8, channels: 1, complete: true, compressor: compress ? { id: 'zlib', level: 1 } : null, format: 'sedcoretool.pyramid',
    height: 300, levels, source: { name: 'x.tif', sha256: pyramid, size: 10 }, tile: 512, version: 1, width: 600 };
  fs.writeFileSync(path.join(folder, 'pyramid.json'), JSON.stringify(description));
  return { pyramid, folder, tiles, description };
}

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sedcoretool-tiles-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('the main-process reader serves verified tiles of a pyramid written with sorted keys, raw or zlib', (t) => {
  const root = temporary(t);
  for (const compress of [false, true]) {
    const { pyramid, tiles } = writePyramid(root, { compress });
    const reader = new TileReader(root);
    const read = reader.read(pyramid, 0, [[0, 1], [0, 0]]);
    assert.deepEqual(read.tiles, [{ row: 0, col: 1, byte_length: 262144 }, { row: 0, col: 0, byte_length: 262144 }]);
    assert.ok(read.bytes.equals(Buffer.concat([tiles['0/0/1'], tiles['0/0/0']])));
    assert.ok(reader.read(pyramid, 1, [[0, 0]]).bytes.equals(tiles['1/0/0']));
    assert.equal(reader.describe(pyramid).width, 600);
  }
});

test('the reader refuses altered tiles, bad positions and anything that is not a complete pyramid of version 1', (t) => {
  const root = temporary(t);
  const { pyramid, folder, description } = writePyramid(root);
  const reader = new TileReader(root);
  const code = (fn) => { try { fn(); return 'none'; } catch (error) { return `${error.code}/${error.field}`; } };
  assert.equal(code(() => reader.read(pyramid, 0, [[1, 0]])), 'INVALID_REQUEST/positions');
  assert.equal(code(() => reader.read(pyramid, 0, [])), 'INVALID_REQUEST/positions');
  assert.equal(code(() => reader.read(pyramid, 0, Array(17).fill([0, 0]))), 'INVALID_REQUEST/positions');
  assert.equal(code(() => reader.read(pyramid, 2, [[0, 0]])), 'INVALID_REQUEST/level');
  assert.equal(code(() => reader.read('../' + pyramid.slice(3), 0, [[0, 0]])), 'INVALID_REQUEST/pyramid');
  const file = path.join(folder, '0', '0.1.0'), data = fs.readFileSync(file);
  data[7] ^= 1; fs.writeFileSync(file, data);
  assert.equal(code(() => new TileReader(root).read(pyramid, 0, [[0, 1]])), 'INVALID_BUFFER/tile');
  for (const change of [{ version: 2 }, { complete: false }, { width: 601 }, { bits: 12 }, { compressor: { id: 'blosc' } }]) {
    fs.writeFileSync(path.join(folder, 'pyramid.json'), JSON.stringify({ ...description, ...change }));
    assert.equal(code(() => new TileReader(root).describe(pyramid)), 'INVALID_REQUEST/pyramid', JSON.stringify(change));
  }
});

function fakeEngine(pyramid) {
  const calls = [];
  return {
    calls,
    request(op, payload, binary, options) {
      calls.push({ op, payload });
      let value;
      if (op === 'pyramid.build') {
        options?.onEvent?.({ stage: 'hash', completed: 1, total: 2 });
        value = { pyramid, width: 600, height: 300, channels: 1, bits: 8, levels: 2, reused: false, disk_bytes: 1 };
      } else if (op === 'tile.read') value = { tiles: payload.positions.map(([row, col]) => ({ row, col, byte_length: 1, sha256: 'x' })), frames: [1], bytes: Buffer.alloc(payload.positions.length) };
      else value = { op };
      const promise = Promise.resolve(value);
      promise.requestId = randomUUID();
      return promise;
    },
  };
}

test('a page gets a token for a chosen file, builds with progress and reads only the pyramids it built', async (t) => {
  const root = temporary(t);
  const file = path.join(root, 'core.tif');
  fs.writeFileSync(file, 'pixels');
  const pyramid = 'a'.repeat(64), engine = fakeEngine(pyramid), ipc = createTileIpc({ engine });
  const registered = await ipc.call(1, 'register', file);
  assert.deepEqual(Object.keys(registered.ok).sort(), ['name', 'size', 'token']);
  assert.equal(registered.ok.name, 'core.tif');
  assert.ok(!JSON.stringify(registered).includes(root), 'the page never sees the path');
  const progress = [];
  const built = await ipc.call(1, 'build', registered.ok.token, randomUUID(), (event) => progress.push(event));
  assert.equal(built.ok.pyramid, pyramid);
  assert.deepEqual(progress, [{ stage: 'hash', completed: 1, total: 2 }]);
  assert.deepEqual(engine.calls[0], { op: 'pyramid.build', payload: { path: file, name: 'core.tif' } });
  assert.ok((await ipc.call(1, 'read', pyramid, 0, [[0, 0]])).ok);
  assert.ok((await ipc.call(1, 'info', pyramid)).ok);
  assert.deepEqual(await ipc.call(2, 'read', pyramid, 0, [[0, 0]]), { error: { code: 'INVALID_REQUEST', field: 'pyramid' } });   // another page
  assert.deepEqual(await ipc.call(2, 'build', registered.ok.token, randomUUID()), { error: { code: 'INVALID_REQUEST', field: 'token' } });
  ipc.releasePage(1);
  assert.deepEqual(await ipc.call(1, 'read', pyramid, 0, [[0, 0]]), { error: { code: 'INVALID_REQUEST', field: 'pyramid' } });
});

test('registration refuses anything that is not an absolute path to a file, and bounds the tokens of a page', async (t) => {
  const root = temporary(t);
  const ipc = createTileIpc({ engine: fakeEngine('b'.repeat(64)) });
  for (const value of ['relative.tif', '', path.join(root, 'missing.tif'), root, 42, null, `${root}\0x`]) {
    assert.deepEqual(await ipc.call(1, 'register', value), { error: { code: 'INVALID_REQUEST', field: 'file' } }, String(value));
  }
  const file = path.join(root, 'x.tif');
  fs.writeFileSync(file, 'x');
  for (let i = 0; i < MAX_SOURCES_PER_PAGE; i++) assert.ok((await ipc.call(1, 'register', file)).ok);
  assert.deepEqual(await ipc.call(1, 'register', file), { error: { code: 'LIMIT_EXCEEDED', field: 'sources' } });
  assert.ok((await ipc.call(2, 'register', file)).ok, 'the limit is per page');
  assert.deepEqual(await ipc.call(1, 'build', randomUUID(), 'not-a-uuid'), { error: { code: 'INVALID_REQUEST', field: 'token' } });
});

test('cancelling a build sends job.cancel for its engine request; the direct delivery reads the store itself', async (t) => {
  const root = temporary(t);
  const { pyramid, tiles } = writePyramid(root);
  const file = path.join(root, 'x.tif');
  fs.writeFileSync(file, 'x');
  let release;
  const engine = fakeEngine(pyramid);
  const slow = { ...engine, request(op, payload, binary, options) {
    if (op !== 'pyramid.build') return engine.request(op, payload, binary, options);
    const promise = new Promise((resolve) => { release = () => resolve({ cancelled: true }); });
    promise.requestId = 'request-1';
    return promise;
  } };
  const ipc = createTileIpc({ engine: slow, pyramidRoot: root, delivery: 'direct' });
  const token = (await ipc.call(1, 'register', file)).ok.token, key = randomUUID();
  const building = ipc.call(1, 'build', token, key);
  await new Promise((resolve) => setImmediate(resolve));
  await ipc.call(1, 'cancel', key);
  assert.deepEqual(engine.calls.at(-1), { op: 'job.cancel', payload: { request_id: 'request-1' } });
  release();
  assert.deepEqual(await building, { ok: { cancelled: true } });
  assert.deepEqual(await ipc.call(1, 'cancel', key), { ok: { state: 'already_terminal' } });
  const direct = createTileIpc({ engine: fakeEngine(pyramid), pyramidRoot: root, delivery: 'direct' });
  await direct.call(1, 'build', (await direct.call(1, 'register', file)).ok.token, randomUUID());
  const read = await direct.call(1, 'read', pyramid, 0, [[0, 1]]);
  assert.ok(read.ok.bytes.equals(tiles['0/0/1']));
});

test('card M8.4.18a: the source of a saved section is remembered per project, and reopening rebuilds a pyramid only from the same file', async (t) => {
  const root = temporary(t), projects = path.join(root, 'projects'), file = path.join(root, 'core.tif');
  fs.writeFileSync(file, 'pixels');
  const pyramid = 'b'.repeat(64);
  let cached = false;
  const engine = fakeEngine(pyramid), request = engine.request.bind(engine);
  engine.request = (op, payload, binary, options) => {
    if (op === 'pyramid.info' && !cached) { const p = Promise.reject(Object.assign(new Error('INVALID_REQUEST'), { code: 'INVALID_REQUEST' })); p.requestId = randomUUID(); return p; }
    return request(op, payload, binary, options);
  };
  const ipc = createTileIpc({ engine, projectsRoot: projects });
  const token = (await ipc.call(1, 'register', file)).ok.token;
  await ipc.call(1, 'build', token, randomUUID());
  assert.deepEqual(await ipc.call(1, 'rememberSource', 'p1', pyramid), { ok: { remembered: true } });
  const record = JSON.parse(fs.readFileSync(path.join(projects, 'p1', 'sources.json'), 'utf8'));
  assert.deepEqual(record, { format: 'sedcoretool.sources', version: 1, sources: { [pyramid]: { path: file, size: 6, name: 'core.tif' } } });
  assert.deepEqual(await ipc.call(3, 'rememberSource', 'p1', pyramid), { error: { code: 'INVALID_REQUEST', field: 'pyramid' } }, 'only a page that built it');
  // a new page (the program reopened): the pyramid is not cached any more, so it is built again from the remembered file
  const progress = [];
  const reopened = await ipc.call(2, 'reopen', 'p1', pyramid, randomUUID(), (event) => progress.push(event));
  assert.deepEqual(reopened, { ok: { available: true, rebuilt: true } });
  assert.equal(progress.length, 1);
  assert.ok((await ipc.call(2, 'read', pyramid, 0, [[0, 0]])).ok, 'the reopening page may read it');
  cached = true;
  assert.deepEqual(await ipc.call(4, 'reopen', 'p1', pyramid, randomUUID()), { ok: { available: true, rebuilt: false } }, 'cached: nothing is built');
  cached = false;
  fs.writeFileSync(file, 'other pixels');                                   // another size at the remembered path
  assert.deepEqual(await ipc.call(5, 'reopen', 'p1', pyramid, randomUUID()), { ok: { available: false, rebuilt: false } });
  fs.writeFileSync(file, 'pixelz');                                          // same size, other bytes: the engine's hash decides
  const changedEngine = fakeEngine('c'.repeat(64)), changedRequest = changedEngine.request.bind(changedEngine);
  changedEngine.request = (op, payload, binary, options) => {
    if (op === 'pyramid.info') { const p = Promise.reject(new Error('missing')); p.requestId = randomUUID(); return p; }
    return changedRequest(op, payload, binary, options);
  };
  const other = createTileIpc({ engine: changedEngine, projectsRoot: projects });
  assert.deepEqual(await other.call(6, 'reopen', 'p1', pyramid, randomUUID()), { ok: { available: false, rebuilt: false, changed: true } });
  assert.deepEqual(await ipc.call(7, 'reopen', 'p2', pyramid, randomUUID()), { ok: { available: false, rebuilt: false } }, 'another project remembers nothing');
  assert.deepEqual(await ipc.call(7, 'reopen', 'P2', pyramid, randomUUID()), { error: { code: 'INVALID_REQUEST', field: 'project' } });
});

test('card M8.4.18a: retain and info are checked before they reach the engine', async (t) => {
  const engine = fakeEngine('a'.repeat(64)), request = engine.request.bind(engine);
  engine.request = (op, payload, binary, options) => {
    if (op === 'mask.retain' || op === 'mask.info') engine.calls.push({ op, payload });
    if (op === 'mask.retain') { const p = Promise.resolve({ removed: { manifests: 2, blobs: 5 } }); p.requestId = randomUUID(); return p; }
    if (op === 'mask.info') { const p = Promise.resolve({ section: 's1', width: 600, height: 300, tiles: 1, positions: [0, 1, 3], next: null }); p.requestId = randomUUID(); return p; }
    return request(op, payload, binary, options);
  };
  const ipc = createTileIpc({ engine }), m = 'd'.repeat(64);
  assert.deepEqual(await ipc.call(1, 'maskRetain', 'p1', [m]), { ok: { removed: { manifests: 2, blobs: 5 } } });
  assert.deepEqual(engine.calls.at(-1), { op: 'mask.retain', payload: { project: 'p1', keep: [m] } });
  for (const keep of ['all', [m, 'x'], Array(1025).fill(m)]) assert.deepEqual(await ipc.call(1, 'maskRetain', 'p1', keep), { error: { code: 'INVALID_REQUEST', field: 'keep' } });
  assert.deepEqual(await ipc.call(1, 'maskInfo', 'p1', m, 0), { ok: { section: 's1', width: 600, height: 300, tiles: 1, positions: [0, 1, 3], next: null } });
  assert.deepEqual(await ipc.call(1, 'maskInfo', 'p1', m, -1), { error: { code: 'INVALID_REQUEST', field: 'start' } });
  assert.deepEqual(await ipc.call(1, 'maskInfo', 'p1', 'x', 0), { error: { code: 'INVALID_REQUEST', field: 'manifest' } });
});
