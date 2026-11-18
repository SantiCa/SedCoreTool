// Card M8.4.27: the store folder of a project (<user data>/projects/<id>/: masks, sources.json, copies of sources) follows its project: it is
// deleted with it and copied when the project is saved under a new identifier (desktop/tile-ipc.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createTileIpc } = require('../../desktop/tile-ipc.js');
const hex = (data) => createHash('sha256').update(data).digest('hex');

function temporary(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sedcoretool-projects-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  return folder;
}
/** An engine that records requests; `mask.copy` answers in pages of two tiles of a five-tile version; `failWith` makes one operation fail. */
function recordingEngine({ failWith = {} } = {}) {
  const calls = [];
  return {
    calls,
    request(op, payload) {
      calls.push({ op, payload });
      let value;
      if (failWith[op]) value = Promise.reject(Object.assign(new Error(failWith[op]), { code: failWith[op] }));
      else if (op === 'mask.copy') value = Promise.resolve({ next: payload.start + 2 < 5 ? payload.start + 2 : null, tiles: 5 });
      else value = Promise.resolve({});
      value.requestId = randomUUID();
      return value;
    },
  };
}
function projectFolder(projects, id, { copy = null } = {}) {
  const folder = path.join(projects, id);
  fs.mkdirSync(path.join(folder, 'tiles', 'manifests'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'tiles', 'manifests', 'a'.repeat(64) + '.json'), '{}');
  if (copy) { fs.mkdirSync(path.join(folder, 'sources'), { recursive: true }); fs.writeFileSync(path.join(folder, 'sources', copy.name), copy.data); }
  return folder;
}

test('deleting a project removes its folder after the engine forgot it, and nothing else', async (t) => {
  const projects = temporary(t), engine = recordingEngine(), ipc = createTileIpc({ engine, projectsRoot: projects });
  const doomed = projectFolder(projects, 'p1'), kept = projectFolder(projects, 'p2');
  assert.deepEqual(await ipc.call(1, 'deleteProjectStore', 'p1'), { ok: { deleted: true } });
  assert.deepEqual(engine.calls, [{ op: 'mask.forget', payload: { project: 'p1' } }]);
  assert.ok(!fs.existsSync(doomed) && fs.existsSync(kept));
  assert.deepEqual(fs.readdirSync(projects), ['p2'], 'no renamed folder left');
  assert.deepEqual(await ipc.call(1, 'deleteProjectStore', 'p1'), { ok: { deleted: false } }, 'nothing to delete: the engine is not asked');
  assert.equal(engine.calls.length, 1);
  for (const bad of ['..', '../p2', 'P2', 'con', 'a/b', '', 'x'.repeat(65), 7]) {
    assert.deepEqual(await ipc.call(1, 'deleteProjectStore', bad), { error: { code: 'INVALID_REQUEST', field: 'project' } }, String(bad));
  }
  assert.ok(fs.existsSync(kept));
});

test('a project whose masks are being sent is not deleted; an engine that is not running holds nothing', async (t) => {
  const projects = temporary(t), folder = projectFolder(projects, 'p1');
  const busy = createTileIpc({ engine: recordingEngine({ failWith: { 'mask.forget': 'BUSY' } }), projectsRoot: projects });
  assert.deepEqual(await busy.call(1, 'deleteProjectStore', 'p1'), { error: { code: 'BUSY' } });
  assert.ok(fs.existsSync(folder));
  const stopped = createTileIpc({ engine: recordingEngine({ failWith: { 'mask.forget': 'ENGINE_UNAVAILABLE' } }), projectsRoot: projects });
  assert.deepEqual(await stopped.call(1, 'deleteProjectStore', 'p1'), { ok: { deleted: true } });
  assert.ok(!fs.existsSync(folder));
});

test('a delete stopped after the rename leaves a folder that the next start removes', (t) => {
  const projects = temporary(t);
  projectFolder(projects, 'p2');
  fs.renameSync(projectFolder(projects, 'p1'), path.join(projects, '.deleting-' + randomUUID()));
  createTileIpc({ engine: recordingEngine(), projectsRoot: projects });
  assert.deepEqual(fs.readdirSync(projects), ['p2']);
});

test('a project saved under a new identifier gets the named versions, its sources record and its copies of sources', async (t) => {
  const projects = temporary(t), data = Buffer.from('the original image'), pyramid = hex(data), other = 'c'.repeat(64);
  projectFolder(projects, 'p1', { copy: { name: pyramid + '.tif', data } });
  fs.writeFileSync(path.join(projects, 'p1', 'sources.json'), JSON.stringify({ format: 'sedcoretool.sources', version: 1, sources: {
    [pyramid]: { path: path.join(projects, 'core.tif'), size: data.length, name: 'core.tif', copy: pyramid + '.tif' },
    [other]: { path: path.join(projects, 'other.tif'), size: 3 } } }));
  const engine = recordingEngine(), ipc = createTileIpc({ engine, projectsRoot: projects }), progress = [];
  const [m1, m2] = ['1'.repeat(64), '2'.repeat(64)];
  const result = await ipc.call(1, 'copyProjectStore', 'p1', 'p9', [m1, m2, m1], [pyramid], randomUUID(), (event) => progress.push(event));
  assert.deepEqual(result, { ok: { copied: true } });
  assert.deepEqual(engine.calls.map((call) => [call.payload.manifest, call.payload.start]), [[m1, 0], [m1, 2], [m1, 4], [m2, 0], [m2, 2], [m2, 4]], 'each version once, page by page');
  assert.ok(engine.calls.every((call) => call.op === 'mask.copy' && call.payload.from === 'p1' && call.payload.to === 'p9'));
  assert.deepEqual(progress.at(-1), { stage: 'copy', completed: 10, total: 10 });
  const record = JSON.parse(fs.readFileSync(path.join(projects, 'p9', 'sources.json'), 'utf8'));
  assert.deepEqual(Object.keys(record.sources), [pyramid], 'only the sources of the copied sections');
  assert.equal(record.sources[pyramid].copy, pyramid + '.tif');
  assert.ok(fs.readFileSync(path.join(projects, 'p9', 'sources', pyramid + '.tif')).equals(data));
  fs.rmSync(path.join(projects, 'p1'), { recursive: true });                // the copy does not depend on the first project
  assert.ok(fs.readFileSync(path.join(projects, 'p9', 'sources', pyramid + '.tif')).equals(data));
  for (const [args, field] of [[['p1', 'p1', [], []], 'to'], [['p1', 'p9', ['x'], []], 'manifests'], [['p1', 'p9', [], ['x']], 'sources'], [['../p1', 'p9', [], []], 'project']]) {
    assert.deepEqual(await ipc.call(1, 'copyProjectStore', ...args, randomUUID()), { error: { code: 'INVALID_REQUEST', field } }, field);
  }
});

test('a failed copy of the versions writes no sources record', async (t) => {
  const projects = temporary(t);
  projectFolder(projects, 'p1');
  const ipc = createTileIpc({ engine: recordingEngine({ failWith: { 'mask.copy': 'INVALID_BUFFER' } }), projectsRoot: projects });
  assert.deepEqual(await ipc.call(1, 'copyProjectStore', 'p1', 'p9', ['1'.repeat(64)], ['d'.repeat(64)], randomUUID()), { error: { code: 'INVALID_BUFFER' } });
  assert.ok(!fs.existsSync(path.join(projects, 'p9', 'sources.json')));
});
