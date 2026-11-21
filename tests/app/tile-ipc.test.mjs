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
    if (op === 'mask.begin') return Promise.resolve({ staged: randomUUID(), rows: 1, cols: 2 });
    if (op === 'mask.retain') { const p = Promise.resolve({ removed: { manifests: 2, blobs: 5 } }); p.requestId = randomUUID(); return p; }
    if (op === 'mask.info') { const p = Promise.resolve({ section: 's1', width: 600, height: 300, tiles: 1, positions: [0, 1, 3], next: null }); p.requestId = randomUUID(); return p; }
    return request(op, payload, binary, options);
  };
  const ipc = createTileIpc({ engine, projectsRoot: temporary(t) }), m = 'd'.repeat(64);
  await ipc.call(1, 'maskBegin', 'p1', 's1', 600, 300, null);                  // a store this session creates (cards M8.4.34, M8.4.38)
  assert.deepEqual(await ipc.call(1, 'maskRetain', 'p1', [m]), { ok: { removed: { manifests: 2, blobs: 5 } } });
  assert.deepEqual(engine.calls.at(-1), { op: 'mask.retain', payload: { project: 'p1', keep: [m] } });
  for (const keep of ['all', [m, 'x'], Array(1025).fill(m)]) assert.deepEqual(await ipc.call(1, 'maskRetain', 'p1', keep), { error: { code: 'INVALID_REQUEST', field: 'keep' } });
  assert.deepEqual(await ipc.call(1, 'maskInfo', 'p1', m, 0), { ok: { section: 's1', width: 600, height: 300, tiles: 1, positions: [0, 1, 3], next: null } });
  assert.deepEqual(await ipc.call(1, 'maskInfo', 'p1', m, -1), { error: { code: 'INVALID_REQUEST', field: 'start' } });
  assert.deepEqual(await ipc.call(1, 'maskInfo', 'p1', 'x', 0), { error: { code: 'INVALID_REQUEST', field: 'manifest' } });
});

test('card M8.4.29: derived files are checked before they reach the engine and sent as a u8 buffer in chunks', async () => {
  const engine = fakeEngine('a'.repeat(64)), request = engine.request.bind(engine), calls = [], m = 'e'.repeat(64);
  const answer = (value) => { const p = Promise.resolve(value); p.requestId = randomUUID(); return p; };
  let found = null;
  engine.request = (op, payload, binary, options) => {
    if (op.startsWith('buffer.') || op.startsWith('mask.derived')) calls.push({ op, payload, size: binary?.length });
    if (op === 'buffer.begin') return answer({ handle: 'h1' });
    if (op === 'buffer.chunk' || op === 'buffer.commit' || op === 'buffer.release') return answer({});
    if (op === 'mask.derived.put') return answer({ byte_length: payload.handle === 'h1' ? 2_500_000 : 0 });
    if (op === 'mask.derived.get') return answer(found);
    return request(op, payload, binary, options);
  };
  const ipc = createTileIpc({ engine }), body = Buffer.alloc(2_500_000, 7);
  await ipc.call(1, 'announceProjects', ['p1']);                                 // a project of the library (card M8.4.38)
  assert.deepEqual(await ipc.call(1, 'derivedPut', 'p1', m, 'reopen', body), { ok: { byte_length: 2_500_000 } });
  const sent = calls.filter((c) => c.op === 'buffer.chunk');
  assert.deepEqual(sent.map((c) => c.size), [1048576, 1048576, 402848]);
  assert.deepEqual(calls.find((c) => c.op === 'buffer.begin').payload, { dtype: 'u8', shape: [2_500_000], byte_length: 2_500_000, sha256: sha(body).toString('hex') });
  assert.deepEqual(calls.find((c) => c.op === 'mask.derived.put').payload, { project: 'p1', manifest: m, kind: 'reopen', handle: 'h1' });
  assert.ok(calls.some((c) => c.op === 'buffer.release'), 'the buffer is released');
  const before = calls.length;
  for (const [args, field] of [[['p1', 'x', 'reopen', body], 'manifest'], [['p1', m, 'other', body], 'kind'], [['p1', m, 'reopen', 'text'], 'bytes'], [['p1', m, 'reopen', Buffer.alloc(0)], 'bytes']]) {
    assert.deepEqual(await ipc.call(1, 'derivedPut', ...args), { error: { code: 'INVALID_REQUEST', field } });
  }
  assert.deepEqual(await ipc.call(1, 'derivedPut', 'P1', m, 'reopen', body), { error: { code: 'INVALID_REQUEST', field: 'project' } });
  assert.deepEqual(await ipc.call(1, 'derivedPut', 'p1', m, 'reopen', Buffer.alloc(134217729)), { error: { code: 'LIMIT_EXCEEDED', field: 'derived' } });
  assert.equal(calls.length, before, 'nothing reached the engine');
  found = { found: false };
  assert.deepEqual(await ipc.call(1, 'derivedGet', 'p1', m, 'reopen'), { ok: { found: false } });
  found = { found: true, byte_length: 3, bytes: Buffer.from([1, 2, 3]) };
  const got = await ipc.call(1, 'derivedGet', 'p1', m, 'reopen');
  assert.ok(got.ok.found && got.ok.bytes.equals(Buffer.from([1, 2, 3])));
  found = { found: true, byte_length: 4, bytes: Buffer.from([1, 2, 3]) };
  assert.deepEqual(await ipc.call(1, 'derivedGet', 'p1', m, 'reopen'), { error: { code: 'INTERNAL', field: 'derived' } });
  assert.deepEqual(await ipc.call(1, 'derivedGet', 'p1', 'x', 'reopen'), { error: { code: 'INVALID_REQUEST', field: 'manifest' } });
  assert.deepEqual(await ipc.call(1, 'derivedGet', 'p1', m, 'nope'), { error: { code: 'INVALID_REQUEST', field: 'kind' } });
});

test('card M8.4.18c step 3: a project\'s copy of a source is read in pieces, and read back into another project only whole and with its SHA-256', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sedcoretool-source-backup-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const image = Buffer.alloc(20 * 2 ** 20 + 123);
  for (let i = 0; i < image.length; i += 4096) image[i] = (i / 4096) & 255;
  const pyramid = sha(image).toString('hex'), copy = pyramid + '.png';
  fs.mkdirSync(path.join(root, 'p1', 'sources'), { recursive: true });
  fs.writeFileSync(path.join(root, 'p1', 'sources', copy), image);
  fs.writeFileSync(path.join(root, 'p1', 'sources.json'), JSON.stringify({ format: 'sedcoretool.sources', version: 1, sources: { [pyramid]: { size: image.length, name: 'core.png', copy } } }));
  const ipc = createTileIpc({ engine: fakeEngine(pyramid), projectsRoot: root });
  await ipc.call(1, 'announceProjects', ['p1']);                                 // a project of the library, read for a backup (card M8.4.38)
  // Read in pieces of 8 MiB, each with its SHA-256; a project without a copy says so.
  const pieces = [];
  for (let offset = 0; offset < image.length;) {
    const got = (await ipc.call(1, 'sourceCopyRead', 'p1', pyramid, offset)).ok;
    assert.equal(got.copied, true); assert.equal(got.size, image.length); assert.equal(got.name, 'core.png');
    assert.equal(got.sha256, sha(got.bytes).toString('hex'));
    pieces.push(Buffer.from(got.bytes)); offset += got.bytes.length;
  }
  assert.deepEqual(pieces.map((p) => p.length), [8388608, 8388608, 4194427]);
  assert.ok(Buffer.concat(pieces).equals(image));
  assert.deepEqual(await ipc.call(1, 'sourceCopyRead', 'p2', pyramid, 0), { ok: { copied: false } });
  assert.deepEqual(await ipc.call(1, 'sourceCopyRead', 'p1', pyramid, image.length + 1), { error: { code: 'INVALID_REQUEST', field: 'offset' } });
  // Import into p2: in order, whole, with its hash; then p2 holds a copy under the same name and remembers it.
  const begun = (await ipc.call(1, 'sourceImportBegin', 'p2', pyramid, 'core.png', image.length)).ok;
  assert.match(begun.token, /^[0-9a-f-]{36}$/);
  let offset = 0;
  for (const piece of pieces) { assert.deepEqual(await ipc.call(1, 'sourceImportChunk', begun.token, offset, piece), { ok: { written: offset + piece.length } }); offset += piece.length; }
  assert.deepEqual(await ipc.call(2, 'sourceImportEnd', begun.token), { error: { code: 'INVALID_REQUEST', field: 'token' } }, 'another page cannot finish it');
  assert.deepEqual(await ipc.call(1, 'sourceImportEnd', begun.token), { ok: { copied: true } });
  assert.ok(fs.readFileSync(path.join(root, 'p2', 'sources', copy)).equals(image));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'p2', 'sources.json'), 'utf8')).sources[pyramid], { size: image.length, name: 'core.png', copy });
  assert.deepEqual(await ipc.call(1, 'sourceImportBegin', 'p2', pyramid, 'core.png', image.length), { ok: { present: true } });
  assert.deepEqual(await ipc.call(1, 'sourceCopyRead', 'p2', pyramid, 0).then((r) => r.ok.copied), true);
  const leftovers = (project) => fs.readdirSync(path.join(root, project, 'sources')).filter((name) => name.endsWith('.part'));
  // Another file under that identity: refused at the end, nothing kept.
  const other = Buffer.from(image); other[5] ^= 1;
  let job = (await ipc.call(1, 'sourceImportBegin', 'p3', pyramid, 'core.png', other.length)).ok;
  for (let at = 0; at < other.length; at += 8388608) await ipc.call(1, 'sourceImportChunk', job.token, at, other.subarray(at, at + 8388608));
  assert.deepEqual(await ipc.call(1, 'sourceImportEnd', job.token), { error: { code: 'INVALID_BUFFER', field: 'source' } });
  assert.deepEqual(fs.readdirSync(path.join(root, 'p3', 'sources')), []);
  // Short, out of order, too large: refused and dropped.
  job = (await ipc.call(1, 'sourceImportBegin', 'p3', pyramid, 'core.png', image.length)).ok;
  assert.deepEqual(await ipc.call(1, 'sourceImportEnd', job.token), { error: { code: 'INVALID_BUFFER', field: 'size' } });
  job = (await ipc.call(1, 'sourceImportBegin', 'p3', pyramid, 'core.png', image.length)).ok;
  assert.deepEqual(await ipc.call(1, 'sourceImportChunk', job.token, 5, pieces[0]), { error: { code: 'INVALID_REQUEST', field: 'bytes' } });
  assert.deepEqual(await ipc.call(1, 'sourceImportChunk', job.token, 0, pieces[0]), { error: { code: 'INVALID_REQUEST', field: 'token' } }, 'dropped');
  job = (await ipc.call(1, 'sourceImportBegin', 'p3', pyramid, 'core.png', image.length)).ok;
  assert.deepEqual(await ipc.call(1, 'sourceImportChunk', job.token, 0, Buffer.alloc(8388609)), { error: { code: 'INVALID_REQUEST', field: 'bytes' } });
  assert.deepEqual(leftovers('p3'), []);
  // At most two at a time per page; a page that goes away leaves no piece file; another program start removes leftovers.
  const a = (await ipc.call(1, 'sourceImportBegin', 'p4', pyramid, 'core.png', image.length)).ok, b = (await ipc.call(1, 'sourceImportBegin', 'p5', pyramid, 'core.png', image.length)).ok;
  assert.deepEqual(await ipc.call(1, 'sourceImportBegin', 'p6', pyramid, 'core.png', image.length), { error: { code: 'LIMIT_EXCEEDED', field: 'imports' } });
  await ipc.call(1, 'sourceImportChunk', a.token, 0, pieces[0]);
  assert.equal(leftovers('p4').length, 1);
  ipc.releasePage(1);
  assert.deepEqual([leftovers('p4'), leftovers('p5')], [[], []]);
  fs.writeFileSync(path.join(root, 'p4', 'sources', `.import-${randomUUID()}.part`), 'x');
  createTileIpc({ engine: fakeEngine(pyramid), projectsRoot: root });
  assert.deepEqual(leftovers('p4'), [], 'swept at the next start');
  for (const [args, field] of [[['P1', pyramid, 'a.png', 5], 'project'], [['p7', 'x', 'a.png', 5], 'pyramid'], [['p7', pyramid, '', 5], 'name'], [['p7', pyramid, 'a.png', 0], 'size']]) {
    assert.deepEqual(await ipc.call(1, 'sourceImportBegin', ...args), { error: { code: 'INVALID_REQUEST', field } });
  }
  void b;
});

test('card M8.4.40: a table buffer whose chunk or commit fails is released, with the tables sent before it', async (t) => {
  for (const failing of ['buffer.chunk', 'buffer.commit']) {
    const engine = fakeEngine('a'.repeat(64)), request = engine.request.bind(engine), released = [];
    const answer = (value) => { const p = Promise.resolve(value); p.requestId = randomUUID(); return p; };
    let next = 0;
    engine.request = (op, payload, binary, options) => {
      if (op === 'mask.begin') return answer({ staged: randomUUID(), rows: 1, cols: 2 });
      if (op === 'buffer.begin') return answer({ handle: `h${++next}` });
      if (op === failing && payload.handle === 'h2') {
        const p = Promise.reject(Object.assign(new Error('INTERNAL'), { code: 'INTERNAL' })); p.requestId = randomUUID(); return p;
      }
      if (op === 'buffer.release') released.push(...payload.handles);
      if (op.startsWith('buffer.')) return answer({});
      return request(op, payload, binary, options);
    };
    const ipc = createTileIpc({ engine, projectsRoot: temporary(t) });
    const { staged } = (await ipc.call(1, 'maskBegin', 'p1', 's1', 600, 300, null)).ok;
    const tables = { object_ids: new Uint32Array([1]), object_class: new Int32Array([0]) };
    assert.deepEqual(await ipc.call(1, 'maskCommit', staged, tables), { error: { code: 'INTERNAL' } }, failing);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(released.sort(), ['h1', 'h2'], `${failing}: every staged buffer is released`);
    assert.ok(!engine.calls.some((c) => c.op === 'mask.commit'), 'the commit is not sent');
  }
});

/** Card Q13: an engine stand-in whose requests named in `refuse` are rejected with the codes listed for them, one per call, then answered. */
function refusingEngine(refuse) {
  const engine = fakeEngine('a'.repeat(64)), request = engine.request.bind(engine), discarded = [];
  const answer = (value) => { const p = Promise.resolve(value); p.requestId = randomUUID(); return p; };
  let next = 0;
  engine.request = (op, payload, binary, options) => {
    if (op === 'mask.discard') discarded.push(payload.staged);
    const code = refuse[op]?.shift();
    if (code) { const p = Promise.reject(Object.assign(new Error(code), { code })); p.requestId = randomUUID(); return p; }
    if (op === 'mask.begin') return answer({ staged: randomUUID(), rows: 1, cols: 2 });
    if (op === 'mask.commit') return answer({ manifest: 'f'.repeat(64) });
    if (op === 'mask.discard') return answer({});
    if (op === 'buffer.begin') return answer({ handle: `h${++next}` });
    if (op.startsWith('buffer.')) return answer({});
    return request(op, payload, binary, options);
  };
  return { engine, discarded };
}

test('card Q13: a commit that fails before the engine answers closes its staged version with mask.discard', async (t) => {
  const tables = { object_ids: new Uint32Array([1]) };
  for (const failing of ['mask.commit', 'buffer.chunk', 'buffer.begin']) {
    const { engine, discarded } = refusingEngine({ [failing]: ['BUSY'] });
    const ipc = createTileIpc({ engine, projectsRoot: temporary(t) });
    const { staged } = (await ipc.call(1, 'maskBegin', 'p1', 's1', 600, 300, null)).ok;
    assert.deepEqual(await ipc.call(1, 'maskCommit', staged, tables), { error: { code: 'BUSY' } }, failing);
    assert.deepEqual(discarded, [staged], `${failing}: the staged version is discarded before the failure reaches the page`);
    // The record is gone as before: the page's own discard is refused, and closing the page sends nothing more.
    assert.deepEqual(await ipc.call(1, 'maskDiscard', staged), { error: { code: 'INVALID_REQUEST', field: 'staged' } });
    ipc.releasePage(1);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(discarded, [staged], `${failing}: nothing is left for the page's closing`);
  }
});

test('card Q13: a successful commit sends no discard', async (t) => {
  const { engine, discarded } = refusingEngine({});
  const ipc = createTileIpc({ engine, projectsRoot: temporary(t) });
  const { staged } = (await ipc.call(1, 'maskBegin', 'p1', 's1', 600, 300, null)).ok;
  assert.deepEqual(await ipc.call(1, 'maskCommit', staged, { object_ids: new Uint32Array([1]) }), { ok: { manifest: 'f'.repeat(64) } });
  ipc.releasePage(1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(discarded, []);
});

test('card Q13: a discard refused with BUSY is tried again; one refused otherwise keeps the record so it can be tried again', async (t) => {
  const busy = refusingEngine({ 'mask.discard': ['BUSY', 'BUSY'] });
  const ipc = createTileIpc({ engine: busy.engine, projectsRoot: temporary(t) });
  const { staged } = (await ipc.call(1, 'maskBegin', 'p1', 's1', 600, 300, null)).ok;
  assert.deepEqual(await ipc.call(1, 'maskDiscard', staged), { ok: {} });
  assert.deepEqual(busy.discarded, [staged, staged, staged], 'two refusals, then the discard that reached the engine');

  const failing = refusingEngine({ 'mask.discard': ['INTERNAL'] });
  const other = createTileIpc({ engine: failing.engine, projectsRoot: temporary(t) });
  const second = (await other.call(1, 'maskBegin', 'p1', 's1', 600, 300, null)).ok.staged;
  assert.deepEqual(await other.call(1, 'maskDiscard', second), { error: { code: 'INTERNAL' } });
  assert.deepEqual(await other.call(1, 'maskDiscard', second), { ok: {} }, 'the record was kept, so the page may try again');
  assert.deepEqual(failing.discarded, [second, second]);
});

test('card M8.4.43: maskSlice validates arguments, forwards to the engine and records the written manifest', async (t) => {
  const calls = [];
  const manifest = 'a'.repeat(64), sliced = 'b'.repeat(64);
  const payload = Buffer.from(new Uint32Array([7, 9, 1]).buffer);
  const engine = {
    async request(op, arg) {
      calls.push([op, arg]);
      if (op === 'mask.slice') return { manifest: sliced, width: 600, height: 1024, tile_count: 2, object_count: 2, stack_count: 1, bytes: payload };
      return {};
    },
  };
  const ipc = createTileIpc({ engine, projectsRoot: temporary(t) });
  const bad = await ipc.call(1, 'maskSlice', 'p1', 'not-a-hash', 'part1', 0, 2);
  assert.deepEqual(bad, { error: { code: 'INVALID_REQUEST', field: 'manifest' } });
  assert.deepEqual(await ipc.call(1, 'maskSlice', 'p1', manifest, 'bad/sec', 0, 2), { error: { code: 'INVALID_REQUEST', field: 'section' } });
  assert.deepEqual(await ipc.call(1, 'maskSlice', 'p1', manifest, 'part1', 2, 2), { error: { code: 'INVALID_REQUEST', field: 'rows' } });
  assert.deepEqual(await ipc.call(1, 'maskSlice', 'p1', manifest, 'part1', -1, 2), { error: { code: 'INVALID_REQUEST', field: 'rows' } });
  assert.equal(calls.length, 0, 'invalid arguments never reach the engine');

  const ok = await ipc.call(1, 'maskSlice', 'p1', manifest, 'part1', 0, 2);
  assert.deepEqual(ok, { ok: { manifest: sliced, width: 600, height: 1024, tileCount: 2, objectCount: 2, stackCount: 1, bytes: payload } });
  assert.deepEqual(calls, [['mask.slice', { project: 'p1', manifest, section: 'part1', row0: 0, row1: 2 }]]);
});
