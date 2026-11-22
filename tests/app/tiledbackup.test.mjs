// Card M8.4.18c: tiled sections in the folder backup and back into the store (app/js/tiledbackup.js), with a folder and an engine simulated in
// memory. The engine side (export and import verified by SHA-256) has its own tests in tests/test_engine_masks.py and tests/app/engine.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import { backupTiledSections, restoreVersion, restoreSource, manifestBlobs, TiledBackupError, EXPORT_PAGE, SOURCE_PIECE, packageTiledSections, keptSourceBytes } from '../../app/js/tiledbackup.js';
import { zipFiles, unzipBlob } from '../../app/js/zip.js';
import { historyDays } from '../../app/js/folderversion.js';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hexDigest = async (bytes) => sha(bytes);

/** A directory handle of the File System Access API, in memory. `corrupt(name)` makes the next write of that name change one byte. */
class Dir {
  constructor() { this.dirs = new Map(); this.files = new Map(); this.corrupt = new Set(); this.failAfter = Infinity; this.writes = 0; }
  async getDirectoryHandle(name, { create = false } = {}) {
    if (!this.dirs.has(name)) { if (!create) throw Object.assign(new Error('not found'), { name: 'NotFoundError' }); this.dirs.set(name, new Dir()); }
    const dir = this.dirs.get(name); dir.root = this.root || this; return dir;
  }
  async getFileHandle(name, { create = false } = {}) {
    if (!this.files.has(name) && !create) throw Object.assign(new Error('not found'), { name: 'NotFoundError' });
    const dir = this, root = this.root || this;
    return {
      kind: 'file',
      getFile: async () => new Blob([dir.files.get(name) || new Uint8Array(0)]),
      createWritable: async () => {
        let data = null;
        return {
          write: async (bytes) => { const add = new Uint8Array(bytes), next = new Uint8Array((data?.length || 0) + add.length); if (data) next.set(data); next.set(add, data?.length || 0); data = next; },
          close: async () => {
            if (++root.writes > root.failAfter) throw new Error('disk stopped');
            if (dir.corrupt.has(name)) { data = data.slice(); data[0] ^= 1; }
            dir.files.set(name, data);
          },
          abort: async () => {},
        };
      },
    };
  }
  async *entries() {
    for (const name of this.files.keys()) yield [name, { kind: 'file' }];
    for (const [name, dir] of this.dirs) yield [name, dir];
  }
  /** Read a file by relative path, as the restore of a project folder does (throws when it is not there). */
  readFile = async (path) => {
    const parts = path.split('/');
    let dir = this;
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
    if (!dir.files.has(parts.at(-1))) throw Object.assign(new Error('not found'), { name: 'NotFoundError' });
    return new Blob([dir.files.get(parts.at(-1))]);
  };
}

/** The engine's store of each project, behind the page bridge's maskExport, maskImport and maskInfo, with what was asked of it. */
class Engine {
  constructor() { this.stores = new Map(); this.calls = []; this.failExportAfter = Infinity; this.damaged = new Set(); }
  store(project) { if (!this.stores.has(project)) this.stores.set(project, { manifests: new Map(), blobs: new Map() }); return this.stores.get(project); }
  /** A version of `tiles` (`{"r.c": bytes}`) and one classes table, committed in `project`; returns its manifest's name. */
  commit(project, tiles) {
    const store = this.store(project), entry = {};
    for (const [where, content] of Object.entries(tiles)) { store.blobs.set(sha(content), deflateSync(content)); entry[where] = { labels: sha(content), exclude: null }; }
    const classes = Buffer.from('[{"id":"a"}]'); store.blobs.set(sha(classes), deflateSync(classes));
    const text = Buffer.from(JSON.stringify({ format: 'sedcoretool.masks', version: 2, section: 's1', width: 600, height: 600, tile: 512, tiles: entry,
      tables: { classes: { sha256: sha(classes), byte_length: classes.length }, object_ids: null, object_class: null, object_predicted: null, object_confidence: null,
        stack_offsets: null, stack_members: null } }));
    store.manifests.set(sha(text), text);
    return sha(text);
  }
  async maskExport(project, manifest, blobs) {
    this.calls.push({ op: 'export', blobs: blobs?.length ?? 0 });
    if (this.calls.filter((c) => c.op === 'export').length > this.failExportAfter) return { error: { code: 'ENGINE_UNAVAILABLE' } };
    const store = this.store(project), text = store.manifests.get(manifest);
    if (!text || this.damaged.has(manifest)) return { error: { code: text ? 'INVALID_BUFFER' : 'INVALID_REQUEST', field: 'manifest' } };
    if (blobs === null) return { ok: { files: [{ name: manifest, sha256: sha(text), bytes: new Uint8Array(text) }] } };
    return { ok: { files: blobs.map((name) => ({ name, sha256: sha(store.blobs.get(name)), bytes: new Uint8Array(store.blobs.get(name)) })) } };
  }
  async maskImport(project, kind, files) {
    this.calls.push({ op: 'import', kind, files: files.length });
    const store = this.store(project);
    if (kind === 'blobs') {
      return { ok: { accepted: files.map(({ name, bytes }) => {
        try { if (sha(inflateSync(bytes)) !== name) return false; } catch { return false; }
        store.blobs.set(name, Buffer.from(bytes)); return true;
      }) } };
    }
    const [{ name, bytes }] = files;
    if (sha(bytes) !== name) return { error: { code: 'INVALID_BUFFER', field: 'manifest' } };
    if (![...manifestBlobs(bytes).keys()].every((blob) => store.blobs.has(blob))) return { error: { code: 'INVALID_REQUEST', field: 'blobs' } };
    store.manifests.set(name, Buffer.from(bytes));
    return { ok: { manifest: name } };
  }
  async maskInfo(project, manifest) { return this.store(project).manifests.has(manifest) ? { ok: { tiles: 1 } } : { error: { code: 'INVALID_REQUEST', field: 'manifest' } }; }
}

const tile = (value) => Buffer.alloc(4096, value);
const project = (manifests) => ({ app: 'SedCoreTool', id: 'p1', name: 'P', cores: [{ name: 'C1', sections: [{ id: 'a', name: 'normal', file: { path: 'images/a.png' } },
  ...manifests.map((manifest, k) => ({ id: `t${k}`, name: `tiled ${k}`, file: { name: 'x.tif', tiled: true }, tiled: { manifest } }))] }] });

test('a backup copies the files of a tiled version once, by name, and checks every file it wrote', async () => {
  const engine = new Engine(), dir = new Dir();
  const first = engine.commit('p1', { '0.0': tile(1), '0.1': tile(2) });
  const json = project([first]);
  assert.deepEqual(await backupTiledSections(engine, dir, 'p1', json, hexDigest), []);
  assert.equal(json.cores[0].sections.length, 2, 'the tiled section stays in the project file');
  const tiles = dir.dirs.get('tiles'), manifests = dir.dirs.get('manifests');
  assert.deepEqual([...manifests.files.keys()], [`${first}.json`]);
  assert.equal(tiles.files.size, 3);                                         // two tiles and the classes table
  for (const [name, bytes] of tiles.files) assert.equal(sha(inflateSync(bytes)), name, 'a file of the folder decompresses to its name');
  // Unchanged: nothing is asked of the engine. A new version with one changed tile: only that tile travels.
  engine.calls.length = 0;
  await backupTiledSections(engine, dir, 'p1', project([first]), hexDigest);
  assert.deepEqual(engine.calls, []);
  const second = engine.commit('p1', { '0.0': tile(1), '0.1': tile(3) });
  await backupTiledSections(engine, dir, 'p1', project([second]), hexDigest);
  assert.deepEqual(engine.calls, [{ op: 'export', blobs: 0 }, { op: 'export', blobs: 1 }]);
  assert.equal(tiles.files.size, 4);
  assert.deepEqual([...manifests.files.keys()].sort(), [`${first}.json`, `${second}.json`].sort(), 'the older version stays for the history files');
});

test('a version with more blobs than one request takes several, and a write that comes back different stops the backup', async () => {
  const engine = new Engine(), dir = new Dir(), tiles = {};
  for (let k = 0; k < EXPORT_PAGE + 5; k++) tiles[`0.${k}`] = tile(k + 1);
  const manifest = engine.commit('p1', tiles);
  await backupTiledSections(engine, dir, 'p1', project([manifest]), hexDigest);
  assert.deepEqual(engine.calls.map((c) => c.blobs), [0, EXPORT_PAGE, 6]);
  const other = new Dir(), bad = sha(tile(7));
  await other.getDirectoryHandle('tiles', { create: true }).then((d) => d.corrupt.add(bad));
  await assert.rejects(backupTiledSections(engine, other, 'p1', project([manifest]), hexDigest), (error) => error instanceof TiledBackupError && error.code === 'BACKUP_MISMATCH');
  assert.equal(other.dirs.get('manifests').files.size, 0, 'no manifest names a version that is not whole in the folder');
});

test('an interrupted backup throws and leaves the previous version of the folder whole and restorable', async () => {
  const engine = new Engine(), dir = new Dir();
  const first = engine.commit('p1', { '0.0': tile(1) });
  await backupTiledSections(engine, dir, 'p1', project([first]), hexDigest);
  const second = engine.commit('p1', { '0.0': tile(9), '0.1': tile(8) });
  engine.failExportAfter = engine.calls.length + 1;                          // the manifest is read, then the engine stops
  await assert.rejects(backupTiledSections(engine, dir, 'p1', project([second]), hexDigest), (error) => error.code === 'ENGINE_UNAVAILABLE');
  assert.deepEqual([...dir.dirs.get('manifests').files.keys()], [`${first}.json`]);
  dir.root = null; dir.writes = 0; dir.failAfter = 1;                        // and a disk that stops after one more file
  engine.failExportAfter = Infinity;
  await assert.rejects(backupTiledSections(engine, dir, 'p1', project([second]), hexDigest), /disk stopped/);
  assert.deepEqual([...dir.dirs.get('manifests').files.keys()], [`${first}.json`]);
  const fresh = new Engine();
  assert.equal(await restoreVersion(fresh, 'p9', first, dir.readFile), null);
  assert.deepEqual(fresh.store('p9').manifests.get(first), engine.store('p1').manifests.get(first));
});

test('a section whose version is missing or damaged in the store is left out and named; the others are kept', async () => {
  const engine = new Engine(), dir = new Dir();
  const good = engine.commit('p1', { '0.0': tile(1) }), damaged = engine.commit('p1', { '0.0': tile(2) });
  engine.damaged.add(damaged);
  const json = project([good, damaged, 'f'.repeat(64)]);
  const leftOut = await backupTiledSections(engine, dir, 'p1', json, hexDigest);
  assert.deepEqual(leftOut, [{ core: 'C1', section: 'tiled 1' }, { core: 'C1', section: 'tiled 2' }]);
  assert.deepEqual(json.cores[0].sections.map((q) => q.id), ['a', 't0']);
  assert.deepEqual(json.left_out, leftOut);
});

test('a restore on an empty store brings every file back identically; a project without tiled sections touches no folder', async () => {
  const engine = new Engine(), dir = new Dir();
  const manifest = engine.commit('p1', { '0.0': tile(1), '1.2': tile(5) });
  await backupTiledSections(engine, dir, 'p1', project([manifest]), hexDigest);
  const other = new Engine();                                                // another computer
  assert.equal(await restoreVersion(other, 'p1', manifest, dir.readFile), null);
  assert.deepEqual(other.store('p1').manifests, engine.store('p1').manifests);
  assert.deepEqual(new Map([...other.store('p1').blobs].map(([k, v]) => [k, sha(inflateSync(v))])), new Map([...engine.store('p1').blobs].map(([k, v]) => [k, sha(inflateSync(v))])));
  const empty = new Dir();
  assert.deepEqual(await backupTiledSections(engine, empty, 'p1', project([]), hexDigest), []);
  assert.equal(empty.dirs.size, 0);
});

test('a missing or corrupt file of the folder refuses the whole version, named by where it is used', async () => {
  const engine = new Engine(), dir = new Dir();
  const manifest = engine.commit('p1', { '0.0': tile(1), '3.4': tile(6) });
  await backupTiledSections(engine, dir, 'p1', project([manifest]), hexDigest);
  const tiles = dir.dirs.get('tiles'), bad = sha(tile(6)), original = tiles.files.get(bad);
  tiles.files.set(bad, original.slice(0, -2));                               // truncated
  let other = new Engine();
  assert.equal(await restoreVersion(other, 'p1', manifest, dir.readFile), '3.4');
  assert.equal(other.store('p1').manifests.size, 0, 'never a partial version');
  tiles.files.set(bad, deflateSync(tile(7)));                                 // another tile under its name
  assert.equal(await restoreVersion(other = new Engine(), 'p1', manifest, dir.readFile), '3.4');
  tiles.files.delete(bad);                                                    // missing
  assert.equal(await restoreVersion(other = new Engine(), 'p1', manifest, dir.readFile), '3.4');
  assert.equal(other.calls.filter((c) => c.kind === 'manifest').length, 0);
  tiles.files.set(bad, original);
  const classes = [...engine.store('p1').blobs.keys()].find((name) => name !== bad && name !== sha(tile(1)));
  tiles.files.delete(classes);
  assert.equal(await restoreVersion(new Engine(), 'p1', manifest, dir.readFile), 'tables.classes');
  dir.dirs.get('manifests').files.set(`${manifest}.json`, Buffer.from('{"format":"other"}'));
  assert.equal(await restoreVersion(new Engine(), 'p1', manifest, dir.readFile), 'manifest');
  assert.equal(await restoreVersion(new Engine(), 'p1', 'e'.repeat(64), dir.readFile), 'manifest');
});

test('manifestBlobs names every blob once with the first place it is used, and refuses what is not a manifest', () => {
  const a = 'a'.repeat(64), b = 'b'.repeat(64), c = 'c'.repeat(64);
  const text = (value) => new TextEncoder().encode(JSON.stringify(value));
  const named = manifestBlobs(text({ format: 'sedcoretool.masks', tiles: { '0.0': { labels: a, exclude: b }, '0.1': { labels: a, exclude: null } },
    tables: { classes: { sha256: c, byte_length: 2 }, stack_members: null } }));
  assert.deepEqual([...named], [[a, '0.0'], [b, '0.0'], [c, 'tables.classes']]);
  for (const bad of [{ format: 'x', tiles: {}, tables: {} }, { format: 'sedcoretool.masks', tiles: { '0.0': { labels: '../x' } }, tables: {} },
    { format: 'sedcoretool.masks', tiles: {}, tables: { classes: { sha256: 'z' } } }]) assert.throws(() => manifestBlobs(text(bad)));
  assert.throws(() => manifestBlobs(new Uint8Array([0xff, 0xfe])));
});

/** The main process's side of step 3: copies of sources per project, read in pieces and imported whole with their SHA-256. */
function withSources(engine) {
  engine.copies = new Map();                     // `${project}/${pyramid}` -> {bytes, name}
  engine.imports = new Map();
  engine.sourceCopyRead = async (project, pyramid, offset) => {
    engine.calls.push({ op: 'read', offset });
    const copy = engine.copies.get(`${project}/${pyramid}`);
    if (!copy) return { ok: { copied: false } };
    const bytes = copy.bytes.subarray(offset, offset + SOURCE_PIECE);
    return { ok: { copied: true, size: copy.bytes.length, name: copy.name, sha256: sha(bytes), bytes: new Uint8Array(bytes) } };
  };
  engine.sourceImportBegin = async (project, pyramid, name, size) => {
    if (engine.copies.has(`${project}/${pyramid}`)) return { ok: { present: true } };
    const token = `t${engine.imports.size + 1}`;
    engine.imports.set(token, { project, pyramid, name, size, parts: [] });
    return { ok: { token } };
  };
  engine.sourceImportChunk = async (token, offset, bytes) => {
    const job = engine.imports.get(token);
    if (!job || offset !== job.parts.reduce((n, p) => n + p.length, 0)) return { error: { code: 'INVALID_REQUEST', field: 'bytes' } };
    job.parts.push(Buffer.from(bytes)); return { ok: { written: offset + bytes.length } };
  };
  engine.sourceImportEnd = async (token) => {
    const job = engine.imports.get(token), whole = Buffer.concat(job.parts);
    engine.imports.delete(token);
    if (whole.length !== job.size || sha(whole) !== job.pyramid) return { error: { code: 'INVALID_BUFFER', field: 'source' } };
    engine.copies.set(`${job.project}/${job.pyramid}`, { bytes: whole, name: job.name });
    return { ok: { copied: true } };
  };
  engine.sourceImportAbort = async (token) => { engine.imports.delete(token); return { ok: {} }; };
  return engine;
}

test('step 3: the project\'s copy of a source goes to the folder once, checked piece by piece, and comes back whole into another computer\'s project', async () => {
  const engine = withSources(new Engine()), dir = new Dir(), told = [];
  const image = Buffer.alloc(2 * SOURCE_PIECE + 77);
  for (let i = 0; i < image.length; i += 999) image[i] = i & 255;
  const pyramid = sha(image), manifest = engine.commit('p1', { '0.0': tile(1) });
  engine.copies.set(`p1/${pyramid}`, { bytes: image, name: 'core.tif' });
  const json = project([manifest]);
  json.cores[0].sections[1].tiled.source = { sha256: pyramid, name: 'core.tif', size: image.length };
  await backupTiledSections(engine, dir, 'p1', json, hexDigest, (name, size) => told.push([name, size]));
  assert.deepEqual(told, [['core.tif', image.length]], 'the user is told before the copy');
  assert.ok(Buffer.from(dir.dirs.get('sources').files.get(pyramid)).equals(image));
  assert.deepEqual(engine.calls.filter((c) => c.op === 'read').map((c) => c.offset), [0, SOURCE_PIECE, 2 * SOURCE_PIECE]);
  engine.calls.length = 0; told.length = 0;
  await backupTiledSections(engine, dir, 'p1', json, hexDigest, (name, size) => told.push([name, size]));
  assert.deepEqual([engine.calls.filter((c) => c.op === 'read').length, told.length], [1, 0], 'already in the folder: only its size is asked');
  // A section whose source the project does not keep: only its identity, nothing in sources/.
  const bare = new Dir(), json2 = project([manifest]);
  json2.cores[0].sections[1].tiled.source = { sha256: 'd'.repeat(64), name: 'x.tif', size: 5 };
  await backupTiledSections(engine, bare, 'p1', json2, hexDigest);
  assert.equal(bare.dirs.get('sources').files.size, 0);
  // A written file that comes back different stops the backup.
  const bad = new Dir();
  (await bad.getDirectoryHandle('sources', { create: true })).corrupt.add(pyramid);
  await assert.rejects(backupTiledSections(engine, bad, 'p1', json, hexDigest), (error) => error.code === 'BACKUP_MISMATCH');
  // Restored on another computer; again: present; a damaged copy is refused and nothing is kept; none in the folder: absent.
  const other = withSources(new Engine());
  assert.equal(await restoreSource(other, 'p1', pyramid, 'core.tif', dir.readFile), 'restored');
  assert.ok(other.copies.get(`p1/${pyramid}`).bytes.equals(image));
  assert.equal(await restoreSource(other, 'p1', pyramid, 'core.tif', dir.readFile), 'present');
  const damaged = Buffer.from(image); damaged[SOURCE_PIECE + 3] ^= 1;
  dir.dirs.get('sources').files.set(pyramid, damaged);
  const third = withSources(new Engine());
  assert.equal(await restoreSource(third, 'p1', pyramid, 'core.tif', dir.readFile), 'damaged');
  assert.equal(third.copies.size, 0);
  assert.equal(await restoreSource(third, 'p1', 'e'.repeat(64), 'x.tif', dir.readFile), 'absent');
});

test('the days of a project folder history, newest first; none without a history', async () => {
  const dir = new Dir(), history = await dir.getDirectoryHandle('historial', { create: true });
  for (const name of ['2026-11-18.json', '2026-11-20.json', 'notes.txt', '2026-11-19.json']) history.files.set(name, new Uint8Array([123, 125]));
  await history.getDirectoryHandle('2026-11-21.json', { create: true });        // a folder with that name is not a day
  assert.deepEqual((await historyDays(dir)).map((d) => d.day), ['2026-11-20', '2026-11-19', '2026-11-18']);
  assert.deepEqual(await historyDays(new Dir()), []);
});

test('card M8.4.18d: a package carries the tiled versions (each file once) and, when asked, the kept source; a restore from it brings them back', async () => {
  const engine = withSources(new Engine());
  const image = Buffer.alloc(SOURCE_PIECE + 999);
  for (let i = 0; i < image.length; i += 777) image[i] = i & 255;
  const pyramid = sha(image), shared = engine.commit('p1', { '0.0': tile(1), '0.1': tile(2) }), damaged = engine.commit('p1', { '0.0': tile(3) });
  engine.damaged.add(damaged);
  engine.copies.set(`p1/${pyramid}`, { bytes: image, name: 'core.tif' });
  const json = project([shared, shared, damaged]);
  for (const q of json.cores[0].sections.slice(1)) q.tiled.source = { sha256: pyramid, name: 'core.tif', size: image.length };
  assert.equal(await keptSourceBytes(engine, [['p1', pyramid], ['p1', 'f'.repeat(64)]]), image.length);
  const { files, leftOut } = await packageTiledSections(engine, 'p1', json, 'p2/', hexDigest, true);
  assert.deepEqual(leftOut, [{ core: 'C1', section: 'tiled 2' }]);
  assert.deepEqual(json.cores[0].sections.map((q) => q.id), ['a', 't0', 't1'], 'the damaged version is left out, named');
  const names = files.map((f) => f.name);
  assert.equal(new Set(names).size, names.length, 'each file once');
  assert.deepEqual(names.filter((n) => n.startsWith('p2/manifests/')), [`p2/manifests/${shared}.json`]);
  assert.equal(names.filter((n) => n.startsWith('p2/tiles/')).length, 3);
  assert.ok(names.includes(`p2/sources/${pyramid}`));
  const members = await unzipBlob(await zipFiles([{ name: 'p2/project.json', data: JSON.stringify(json) }, ...files]));
  const readFile = async (path) => { const e = members.get('p2/' + path); return e ? e.get() : null; };
  const other = withSources(new Engine());
  assert.equal(await restoreVersion(other, 'p9', shared, readFile), null);
  assert.deepEqual(other.store('p9').manifests.get(shared), engine.store('p1').manifests.get(shared));
  assert.equal(await restoreSource(other, 'p9', pyramid, 'core.tif', readFile), 'restored');
  assert.ok(other.copies.get(`p9/${pyramid}`).bytes.equals(image));
  const without = await packageTiledSections(engine, 'p1', project([shared]), '', hexDigest, false);
  assert.ok(!without.files.some((f) => f.name.startsWith('sources/')), 'no source unless asked');
});
