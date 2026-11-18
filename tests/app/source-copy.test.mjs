// Card M8.4.18b: the verified copy of a tiled section's source into the project (desktop/source-copy.js) and the bridge operations that
// locate a moved source, copy it and prefer the copy when the section is reopened (desktop/tile-ipc.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { copyVerified, COPY_CHUNK } = require('../../desktop/source-copy.js');
const { createTileIpc } = require('../../desktop/tile-ipc.js');
const hex = (data) => createHash('sha256').update(data).digest('hex');

function temporary(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sedcoretool-source-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  return folder;
}
/** A source of a few chunks with bytes that differ along the file. */
function sourceFile(folder, name = 'core.tif', bytes = 2 * COPY_CHUNK + 12345, seed = 1) {
  const data = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i += 4096) data[i] = (i / 4096 + seed) & 255;
  const file = path.join(folder, name);
  fs.writeFileSync(file, data);
  return { file, data, sha256: hex(data) };
}

test('a verified copy gets its name only when size and SHA-256 are the saved ones', async (t) => {
  const folder = temporary(t), { file, data, sha256 } = sourceFile(folder), to = path.join(folder, 'copy.tif'), progress = [];
  assert.deepEqual(await copyVerified({ from: file, to, sha256, size: data.length, onProgress: (event) => progress.push(event) }), { copied: true });
  assert.ok(fs.readFileSync(to).equals(data));
  assert.deepEqual(progress.at(-1), { stage: 'copy', completed: data.length, total: data.length });
  assert.deepEqual(fs.readdirSync(folder).sort(), ['copy.tif', 'core.tif'], 'no temporary file left');
  // another file of the same size, or a file longer than the saved one: refused, nothing left
  const other = sourceFile(folder, 'other.tif', data.length, 2);
  for (const [from, size] of [[other.file, data.length], [file, data.length - 1]]) {
    await assert.rejects(copyVerified({ from, to: path.join(folder, 'refused.tif'), sha256, size }), { code: 'UNSUPPORTED_INPUT', field: 'source.sha256' });
  }
  await assert.rejects(copyVerified({ from: path.join(folder, 'missing.tif'), to: path.join(folder, 'refused.tif'), sha256, size: 1 }), { code: 'UNSUPPORTED_INPUT', field: 'source' });
  assert.deepEqual(fs.readdirSync(folder).sort(), ['copy.tif', 'core.tif', 'other.tif']);
});

test('a full disk or a cancellation half-way leaves no partial file', async (t) => {
  const folder = temporary(t), { file, data, sha256 } = sourceFile(folder), to = path.join(folder, 'copy.tif');
  // the disk fills after the first chunk (simulated: the write fails as the system reports it)
  const fullAfterOneChunk = async (name, flags) => {
    const handle = await fsp.open(name, flags);
    let written = 0;
    return { sync: () => handle.sync(), close: () => handle.close(),
      async write(buffer, offset, length) {
        if (written >= COPY_CHUNK) throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
        written += length;
        return handle.write(buffer, offset, length);
      } };
  };
  await assert.rejects(copyVerified({ from: file, to, sha256, size: data.length, open: fullAfterOneChunk }), { code: 'LIMIT_EXCEEDED', field: 'disk' });
  assert.deepEqual(fs.readdirSync(folder), ['core.tif']);
  const controller = new AbortController();
  const result = await copyVerified({ from: file, to, sha256, size: data.length, signal: controller.signal,
    onProgress: (event) => { if (event.completed >= COPY_CHUNK) controller.abort(); } });
  assert.deepEqual(result, { cancelled: true });
  assert.deepEqual(fs.readdirSync(folder), ['core.tif']);
});

/** An engine that builds only when `expect` is the file's SHA-256, as the coordinator does (contract §8.5); nothing is cached at first. */
function hashingEngine() {
  const calls = [], cached = new Set();
  const answer = (value) => { const promise = value instanceof Error ? Promise.reject(value) : Promise.resolve(value); promise.requestId = randomUUID(); return promise; };
  return {
    calls, cached,
    request(op, payload, _binary, options) {
      calls.push({ op, payload });
      if (op === 'pyramid.info') return answer(cached.has(payload.pyramid) ? { complete: true } : Object.assign(new Error('INVALID_REQUEST'), { code: 'INVALID_REQUEST' }));
      if (op === 'pyramid.build') {
        options?.onEvent?.({ stage: 'hash', completed: 1, total: 1 });
        const pyramid = hex(fs.readFileSync(payload.path));
        if (payload.expect && payload.expect !== pyramid) return answer(Object.assign(new Error('UNSUPPORTED_INPUT'), { code: 'UNSUPPORTED_INPUT', field: 'source.sha256' }));
        const reused = cached.has(pyramid);
        cached.add(pyramid);
        return answer({ pyramid, width: 600, height: 300, channels: 3, bits: 8, levels: 2, reused, disk_bytes: 1 });
      }
      return answer({});
    },
  };
}

test('a moved source is located only with its saved size and SHA-256; a copy in the project is preferred when reopening', async (t) => {
  const root = temporary(t), projects = path.join(root, 'projects'), { file, data, sha256 } = sourceFile(root);
  const engine = hashingEngine(), ipc = createTileIpc({ engine, projectsRoot: projects });
  const token = (await ipc.call(1, 'register', file)).ok.token;
  assert.equal((await ipc.call(1, 'build', token, randomUUID())).ok.pyramid, sha256);
  await ipc.call(1, 'rememberSource', 'p1', sha256);
  const info = (await ipc.call(1, 'sourceInfo', 'p1', sha256)).ok;
  assert.deepEqual({ ...info, free: typeof info.free }, { copied: false, original: true, size: data.length, free: 'number' });
  // the source moves and the pyramid leaves the cache: a new page cannot reopen it
  const moved = path.join(root, 'elsewhere.tif');
  fs.renameSync(file, moved);
  engine.cached.clear();
  assert.deepEqual(await ipc.call(2, 'reopen', 'p1', sha256, randomUUID()), { ok: { available: false, rebuilt: false } });
  assert.equal((await ipc.call(2, 'sourceInfo', 'p1', sha256)).ok.original, false);
  // another file of another size is refused without being hashed; one of the same size by its SHA-256
  const smaller = sourceFile(root, 'smaller.tif', 1000), same = sourceFile(root, 'same-size.tif', data.length, 9);
  const builds = () => engine.calls.filter((call) => call.op === 'pyramid.build').length, before = builds();
  const locate = async (page, chosen) => ipc.call(page, 'locate', 'p1', sha256, data.length, (await ipc.call(page, 'register', chosen)).ok.token, randomUUID());
  assert.deepEqual(await locate(2, smaller.file), { ok: { matched: false, size: 1000 } });
  assert.equal(builds(), before, 'another size: not hashed');
  assert.deepEqual(await locate(2, same.file), { ok: { matched: false, size: data.length } });
  assert.deepEqual(engine.calls.at(-1).payload.expect, sha256, 'the engine checks the saved SHA-256 before it builds');
  assert.deepEqual(await ipc.call(2, 'read', sha256, 0, [[0, 0]]), { error: { code: 'INVALID_REQUEST', field: 'pyramid' } }, 'nothing readable yet');
  assert.deepEqual(await locate(2, moved), { ok: { matched: true, rebuilt: true } });
  assert.equal(JSON.parse(fs.readFileSync(path.join(projects, 'p1', 'sources.json'), 'utf8')).sources[sha256].path, moved, 'remembered at its new place');
  // copy into the project, then lose the original and the cache: reopening builds from the copy
  const progress = [];
  assert.deepEqual(await ipc.call(2, 'copySource', 'p1', sha256, randomUUID(), (event) => progress.push(event)), { ok: { copied: true } });
  const copy = path.join(projects, 'p1', 'sources', `${sha256}.tif`);
  assert.ok(fs.readFileSync(copy).equals(data) && progress.at(-1).completed === data.length);
  assert.deepEqual((await ipc.call(2, 'sourceInfo', 'p1', sha256)).ok.copied, true);
  assert.deepEqual(await ipc.call(2, 'copySource', 'p1', sha256, randomUUID()), { ok: { copied: true } }, 'already there');
  fs.rmSync(moved);
  engine.cached.clear();
  assert.deepEqual(await ipc.call(3, 'reopen', 'p1', sha256, randomUUID()), { ok: { available: true, rebuilt: true } });
  assert.equal(engine.calls.at(-1).payload.path, copy);
  // a copy that was altered is not taken for the source
  const altered = Buffer.from(data); altered[5] ^= 1; fs.writeFileSync(copy, altered);
  engine.cached.clear();
  assert.deepEqual(await ipc.call(4, 'reopen', 'p1', sha256, randomUUID()), { ok: { available: false, rebuilt: false, changed: true } });
  // only a page with the pyramid open may copy it; checks before anything is read
  assert.deepEqual(await ipc.call(9, 'copySource', 'p1', sha256, randomUUID()), { error: { code: 'INVALID_REQUEST', field: 'pyramid' } });
  assert.deepEqual(await ipc.call(2, 'locate', 'p1', sha256, 0, randomUUID(), randomUUID()), { error: { code: 'INVALID_REQUEST', field: 'size' } });
  assert.deepEqual(await ipc.call(2, 'locate', 'p1', sha256, 5, randomUUID(), randomUUID()), { error: { code: 'INVALID_REQUEST', field: 'token' } });
  assert.deepEqual(await ipc.call(2, 'sourceInfo', '../p1', sha256), { error: { code: 'INVALID_REQUEST', field: 'project' } });
});

test('a copy that would leave less than 1 GiB free is refused before it starts', async (t) => {
  const root = temporary(t), projects = path.join(root, 'projects'), { file, sha256 } = sourceFile(root);
  const engine = hashingEngine(), ipc = createTileIpc({ engine, projectsRoot: projects });
  await ipc.call(1, 'build', (await ipc.call(1, 'register', file)).ok.token, randomUUID());
  fs.mkdirSync(projects, { recursive: true });
  const statfs = fs.statfsSync;
  fs.statfsSync = () => ({ bavail: 1, bsize: 2 ** 30 });                     // exactly 1 GiB free
  t.after(() => { fs.statfsSync = statfs; });
  assert.deepEqual(await ipc.call(1, 'copySource', 'p1', sha256, randomUUID()), { error: { code: 'LIMIT_EXCEEDED', field: 'disk' } });
  assert.ok(!fs.existsSync(path.join(projects, 'p1', 'sources')));
});
