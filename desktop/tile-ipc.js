// Narrow bridge between one page and the tile store (contract §8, card M8.4.15). No Electron dependency: main.js passes in the
// sender's identity and the path of a file the user chose (from webUtils.getPathForFile in the preload), so this file can be tested with
// Node and a fake engine. A page never sees or names a path: a chosen file becomes an opaque token, and the page may read only the
// pyramids that it built itself in this session.
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { TileReader } = require('./tile-reader');
const { copyVerified, freeBytes } = require('./source-copy');

const MAX_SOURCES_PER_PAGE = 64, MAX_BUILDS_PER_PAGE = 4, MAX_STAGED_PER_PAGE = 8, MAX_CHUNK = 1048576;
// Card M8.4.18a: the main process remembers where the source of each tiled section was, per project; the page never sees it.
const SOURCES_FILE = 'sources.json', MAX_REMEMBERED_SOURCES = 4096, MAX_RETAINED = 1024;
// Card M8.4.18b: copies of sources inside the project, named by their SHA-256 and the original extension; the disk keeps 1 GiB free.
const SOURCES_DIR = 'sources', COPY_NAME = /^[0-9a-f]{64}(\.[a-z0-9]{1,8})?$/, COPY_RESERVE = 2 ** 30;
const copyName = (sha256, name) => sha256 + ((/\.[A-Za-z0-9]{1,8}$/.exec(name)?.[0] || '').toLowerCase());
// Card M8.4.27: a deleted project's folder is first renamed to this prefix (never a store identifier), then removed; leftovers go at start.
const DELETING = '.deleting-', MAX_COPIED_SOURCES = 1024;

// Card A2 (brought forward on 19 Nov 2026): on Windows a file just written can stay held for a moment (antivirus, indexer), and a rename or
// a removal fails with EPERM, EBUSY or EACCES; both are tried again a few times before the failure is reported.
const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY']), RETRY_MS = [50, 100, 200, 400, 800, 1600];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function renameRetrying(from, to) {
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(from, to); return; } catch (error) {
      if (!TRANSIENT.has(error?.code) || attempt >= RETRY_MS.length) throw error;
      await pause(RETRY_MS[attempt]);
    }
  }
}
const removeTree = (folder) => fs.rmSync(folder, { recursive: true, force: true, maxRetries: RETRY_MS.length, retryDelay: 100 });

/** Remove the folders a delete renamed but did not finish removing (the program stopped half-way). */
function sweepDeleted(projectsRoot) {
  let names = [];
  try { names = fs.readdirSync(projectsRoot); } catch { return; }
  for (const name of names) if (name.startsWith(DELETING)) { try { removeTree(path.join(projectsRoot, name)); } catch { /* tried again at the next start */ } }
}
/** A new name for a copy of a source: a hard link when the file system allows it, otherwise a verified copy. */
async function linkOrCopy(from, to, sha256, size, signal) {
  try { fs.linkSync(from, to); return { copied: true }; } catch { /* another disk, or no hard links */ }
  return copyVerified({ from, to, sha256, size, signal });
}
// Mask tiles and tables (contract §8.7, card M8.4.16 step 4); the engine checks all of this again.
const LAYER_BYTES = { labels: 1048576, exclude: 262144 };
const PROJECT = /^[a-z0-9_-]{1,64}$/, SECTION = /^[A-Za-z0-9_-]{1,64}$/;
const WINDOWS_DEVICES = new Set(['con', 'prn', 'aux', 'nul', ...[...'0123456789'].flatMap((d) => [`com${d}`, `lpt${d}`])]);
const MAX_OBJECTS = 2 ** 20;                       // card M8.4.22: the objects are four columns of at most 2^20 rows
const TABLES = { object_ids: { dtype: 'u32le', item: 4, limit: 4 * MAX_OBJECTS }, object_class: { dtype: 'i32le', item: 4, limit: 4 * MAX_OBJECTS },
  object_predicted: { dtype: 'i32le', item: 4, limit: 4 * MAX_OBJECTS }, object_confidence: { dtype: 'f64le', item: 8, limit: 8 * MAX_OBJECTS },
  classes: { dtype: 'utf8json', item: 1, limit: 4 * 2 ** 20 },
  stack_offsets: { dtype: 'u32le', item: 4, limit: 16 * 2 ** 20 }, stack_members: { dtype: 'u32le', item: 4, limit: 16 * 2 ** 20 } };
const NULLABLE_TABLES = new Set(['object_ids', 'object_class', 'object_predicted', 'object_confidence', 'stack_members']);
const isPosition = (value) => Number.isSafeInteger(value) && value >= 0;
function bytesOf(value) {
  if (Buffer.isBuffer(value)) return value;
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  return null;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
// The engine's own display-name rule (server.py PYRAMID_NAME): no folder separators or control characters, 1-255 characters.
const displayName = (filePath) => path.basename(filePath).replace(/[/\\:\x00-\x1f]/g, '_').slice(0, 255) || 'image';

class Rejected extends Error {
  constructor(code, field = null) { super(code); this.code = code; this.field = field; }
}
const reject = (code, field) => { throw new Rejected(code, field); };

function failure(error) {
  if (error instanceof Rejected) return { error: { code: error.code, ...(error.field ? { field: error.field } : {}) } };
  const code = typeof error?.code === 'string' && /^[A-Z_]{3,40}$/.test(error.code) ? error.code : 'INTERNAL';
  return { error: { code, ...(typeof error?.field === 'string' ? { field: error.field.slice(0, 80) } : {}) } };
}

/**
 * @param engine the engine service of desktop/engine.js (`request(op, payload, binary, {onEvent})`, whose promise carries `requestId`).
 * @param pyramidRoot the folder the engine was started with (`--pyramid-dir`), for delivery path (b).
 * @param delivery 'engine' (tile.read through the engine) or 'direct' (the main process reads the store itself; card M8.4.15 step 1).
 */
/** The remembered sources of a project's tiled sections (`{format, version, sources: {sha256: {path, size}}}`), or an empty record. */
function readSources(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (value?.format !== 'sedcoretool.sources' || value.version !== 1 || typeof value.sources !== 'object' || !value.sources) throw new Error('format');
    return value;
  } catch { return { format: 'sedcoretool.sources', version: 1, sources: {} }; }
}
/** Temporary file in the same folder, flushed, then renamed over `file`. */
function writeAtomically(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temporary, 'wx');
    try { fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, file);
  } catch (error) { fs.rmSync(temporary, { force: true }); throw error; }
}

function createTileIpc({ engine, pyramidRoot = null, projectsRoot = null, delivery = 'engine' }) {
  if (!['engine', 'direct'].includes(delivery)) throw new Error('unknown tile delivery');
  const reader = delivery === 'direct' ? new TileReader(pyramidRoot) : null;
  if (projectsRoot) sweepDeleted(projectsRoot);
  const sources = new Map();            // token -> {owner, path, name, size}
  const pyramids = new Map();           // owner -> Set of pyramid identifiers built by that page
  const builds = new Map();             // `${owner}/${key}` -> engine request id
  const staged = new Map();             // staged mask version (engine UUID) -> owner page
  const builtFrom = new Map();          // pyramid (source SHA-256) -> {path, size} of the file it was built from in this session
  const copies = new Map();             // `${owner}/${key}` -> AbortController of a copy into the project (card M8.4.18b)

  const ownedStaging = (owner, id) => {
    if (typeof id !== 'string' || !UUID.test(id) || staged.get(id) !== owner) reject('INVALID_REQUEST', 'staged');
  };
  const checkProject = (project) => {
    if (typeof project !== 'string' || !PROJECT.test(project) || WINDOWS_DEVICES.has(project)) reject('INVALID_REQUEST', 'project');
  };
  /** One table as a committed engine buffer; returns its handle. The caller releases it. */
  async function uploadTable(name, data) {
    const spec = TABLES[name], bytes = bytesOf(data);
    if (!bytes || bytes.length < spec.item || bytes.length % spec.item) reject('INVALID_REQUEST', `tables.${name}`);
    if (bytes.length > spec.limit) reject('LIMIT_EXCEEDED', `tables.${name}`);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const { handle } = await engine.request('buffer.begin', { dtype: spec.dtype, shape: [bytes.length / spec.item], byte_length: bytes.length, sha256 });
    for (let offset = 0; offset < bytes.length; offset += MAX_CHUNK) {
      const part = bytes.subarray(offset, offset + MAX_CHUNK);
      await engine.request('buffer.chunk', { handle, offset, byte_length: part.length }, Buffer.from(part));
    }
    await engine.request('buffer.commit', { handle });
    return handle;
  }

  const owned = (owner, pyramid) => {
    if (typeof pyramid !== 'string' || !SHA256.test(pyramid) || !pyramids.get(owner)?.has(pyramid)) reject('INVALID_REQUEST', 'pyramid');
  };
  const own = (owner, pyramid) => { if (!pyramids.has(owner)) pyramids.set(owner, new Set()); pyramids.get(owner).add(pyramid); };
  const checkKey = (owner, key) => { if (typeof key !== 'string' || !UUID.test(key) || builds.has(`${owner}/${key}`) || copies.has(`${owner}/${key}`)) reject('INVALID_REQUEST', 'key'); };
  const sourcesFile = (project) => path.join(projectsRoot, project, SOURCES_FILE);
  /** This project's record of a source: `{path, size, name?, copy?}` or null. */
  const remembered = (project, pyramid) => (projectsRoot ? readSources(sourcesFile(project)).sources[pyramid] || null : null);
  /** Change this project's record of a source (written atomically; the oldest entries beyond the limit are dropped). */
  function updateSource(project, pyramid, fields) {
    const file = sourcesFile(project), record = readSources(file), entry = { ...(record.sources[pyramid] || {}), ...fields };
    delete record.sources[pyramid];
    record.sources[pyramid] = entry;
    const names = Object.keys(record.sources);
    for (const name of names.slice(0, Math.max(0, names.length - MAX_REMEMBERED_SOURCES))) delete record.sources[name];
    writeAtomically(file, JSON.stringify(record));
  }
  /** A file that is still there with the saved size, or null. */
  const sameSize = (file, size) => {
    try { const stat = typeof file === 'string' && path.isAbsolute(file) ? fs.statSync(file) : null; return stat?.isFile() && stat.size === size ? file : null; } catch { return null; }
  };
  /** The project's own copy of a source (card M8.4.18b), when it is there with the saved size. */
  const copyOf = (project, entry) => (entry && typeof entry.copy === 'string' && COPY_NAME.test(entry.copy)
    ? sameSize(path.join(projectsRoot, project, SOURCES_DIR, entry.copy), entry.size) : null);
  /** Build the pyramid of `file` only if its SHA-256 is `pyramid`: 'built', 'reused', 'changed' (another file) or 'cancelled'. */
  async function buildExpected(owner, key, file, pyramid, name, onProgress) {
    const promise = engine.request('pyramid.build', { path: file, name, expect: pyramid }, null, { onEvent: onProgress });
    builds.set(`${owner}/${key}`, promise.requestId);
    try {
      const result = await promise;
      if (result?.cancelled) return 'cancelled';
      if (result?.pyramid !== pyramid) return 'changed';
      own(owner, pyramid);
      return result.reused ? 'reused' : 'built';
    } catch (error) {
      if (error?.code === 'UNSUPPORTED_INPUT' && error.field === 'source.sha256') return 'changed';
      throw error;
    } finally { builds.delete(`${owner}/${key}`); }
  }

  const operations = {
    /** A file the user chose; the main process passes its path. Returns an opaque token and what the page may show. */
    register(owner, filePath) {
      if (typeof filePath !== 'string' || !filePath || filePath.length > 4096 || !path.isAbsolute(filePath) || filePath.includes('\0')) reject('INVALID_REQUEST', 'file');
      let stat;
      try { stat = fs.statSync(filePath); } catch { reject('INVALID_REQUEST', 'file'); }
      if (!stat.isFile()) reject('INVALID_REQUEST', 'file');
      if ([...sources.values()].filter((source) => source.owner === owner).length >= MAX_SOURCES_PER_PAGE) reject('LIMIT_EXCEEDED', 'sources');
      const token = randomUUID(), name = displayName(filePath);
      sources.set(token, { owner, path: filePath, name, size: stat.size });
      return { token, name, size: stat.size };
    },
    /** Build (or reuse) the pyramid of a registered source. `onProgress({stage, completed, total})` receives the engine's events. */
    async build(owner, token, key, onProgress = () => {}) {
      const source = typeof token === 'string' && UUID.test(token) ? sources.get(token) : null;
      if (!source || source.owner !== owner) reject('INVALID_REQUEST', 'token');
      checkKey(owner, key);
      if ([...builds.keys()].filter((name) => name.startsWith(`${owner}/`)).length >= MAX_BUILDS_PER_PAGE) reject('BUSY');
      const promise = engine.request('pyramid.build', { path: source.path, name: source.name }, null, { onEvent: onProgress });
      builds.set(`${owner}/${key}`, promise.requestId);
      try {
        const result = await promise;
        if (result?.cancelled) return { cancelled: true };
        const clean = { pyramid: result.pyramid, width: result.width, height: result.height, channels: result.channels, bits: result.bits,
          levels: result.levels, reused: result.reused };
        if (!SHA256.test(clean.pyramid) || ![clean.width, clean.height, clean.levels].every((n) => Number.isSafeInteger(n) && n > 0)
            || ![1, 3, 4].includes(clean.channels) || ![8, 16].includes(clean.bits) || typeof clean.reused !== 'boolean') reject('INTERNAL', 'build');
        own(owner, clean.pyramid);
        builtFrom.set(clean.pyramid, { path: source.path, size: source.size });
        return clean;
      } finally { builds.delete(`${owner}/${key}`); }
    },
    async cancel(owner, key) {
      const copy = typeof key === 'string' ? copies.get(`${owner}/${key}`) : undefined;
      if (copy) { copy.abort(); return { state: 'cancelling' }; }
      const id = typeof key === 'string' ? builds.get(`${owner}/${key}`) : undefined;
      if (!id) return { state: 'already_terminal' };
      return engine.request('job.cancel', { request_id: id });
    },
    async info(owner, pyramid) {
      owned(owner, pyramid);
      return reader ? reader.describe(pyramid) : engine.request('pyramid.info', { pyramid });
    },
    /** Verified tiles, in request order: `{tiles: [{row, col, byte_length}], bytes}` (uncompressed, concatenated). */
    async read(owner, pyramid, level, positions) {
      owned(owner, pyramid);
      if (reader) return reader.read(pyramid, level, positions);
      const result = await engine.request('tile.read', { pyramid, level, positions });
      return { tiles: result.tiles.map(({ row, col, byte_length }) => ({ row, col, byte_length })), bytes: result.bytes };
    },
    /* Masks of tiled sections (contract §8.7). A page names a project and a section by identifier, never by path; it may use only the
       staged versions it began. A staged version dies with the engine session: the page then begins a new one and sends its tiles again. */
    async maskBegin(owner, project, section, width, height, base) {
      checkProject(project);
      if (typeof section !== 'string' || !SECTION.test(section)) reject('INVALID_REQUEST', 'section');
      if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) reject('INVALID_REQUEST', 'size');
      if (base !== null && (typeof base !== 'string' || !SHA256.test(base))) reject('INVALID_REQUEST', 'base');
      if ([...staged.values()].filter((page) => page === owner).length >= MAX_STAGED_PER_PAGE) reject('LIMIT_EXCEEDED', 'staged');
      const result = await engine.request('mask.begin', { project, section, width, height, base });
      if (typeof result?.staged !== 'string' || !UUID.test(result.staged)) reject('INTERNAL', 'staged');
      staged.set(result.staged, owner);
      return { staged: result.staged, rows: result.rows, cols: result.cols };
    },
    async maskPut(owner, id, layer, row, col, sha256, data) {
      ownedStaging(owner, id);
      if (!Object.hasOwn(LAYER_BYTES, layer)) reject('INVALID_REQUEST', 'layer');
      if (!isPosition(row) || !isPosition(col)) reject('INVALID_REQUEST', 'position');
      if (typeof sha256 !== 'string' || !SHA256.test(sha256)) reject('INVALID_REQUEST', 'sha256');
      const bytes = bytesOf(data);
      if (!bytes || bytes.length !== LAYER_BYTES[layer]) reject('INVALID_REQUEST', 'bytes');
      const result = await engine.request('mask.put', { staged: id, layer, row, col, sha256 }, Buffer.from(bytes));
      return { stored: result.stored === true };
    },
    /** `tables`: any of the tables of contract §8.7 as bytes (the object columns null when there is no object, stack_members null when there
     *  is no overlap); left out = the base's. */
    async maskCommit(owner, id, tables) {
      ownedStaging(owner, id);
      if (!tables || typeof tables !== 'object' || Array.isArray(tables) || !Object.keys(tables).every((name) => Object.hasOwn(TABLES, name))) reject('INVALID_REQUEST', 'tables');
      const handles = {}, uploaded = [];
      try {
        for (const [name, data] of Object.entries(tables)) {
          if (data === null && NULLABLE_TABLES.has(name)) { handles[name] = null; continue; }
          handles[name] = await uploadTable(name, data);
          uploaded.push(handles[name]);
        }
        const result = await engine.request('mask.commit', { staged: id, tables: handles });
        if (typeof result?.manifest !== 'string' || !SHA256.test(result.manifest)) reject('INTERNAL', 'manifest');
        return { manifest: result.manifest };
      } finally {
        staged.delete(id);                                         // the engine closes a staged version on commit, also when it fails
        if (uploaded.length) engine.request('buffer.release', { handles: uploaded }).catch(() => {});
      }
    },
    async maskDiscard(owner, id) {
      ownedStaging(owner, id);
      staged.delete(id);
      await engine.request('mask.discard', { staged: id });
      return {};
    },
    /** Verified mask tiles of a stored version: `{tiles: [{row, col, byte_length}], bytes}`; an empty layer has byte_length 0. */
    /** Card M8.4.18a: after a save, the store keeps only these manifests of the project (and what open staged versions hold). */
    async maskRetain(owner, project, keep) {
      checkProject(project);
      if (!Array.isArray(keep) || keep.length > MAX_RETAINED || !keep.every((name) => typeof name === 'string' && SHA256.test(name))) reject('INVALID_REQUEST', 'keep');
      const result = await engine.request('mask.retain', { project, keep });
      return { removed: { manifests: Number(result?.removed?.manifests) || 0, blobs: Number(result?.removed?.blobs) || 0 } };
    },
    /** One page of the tile positions of a stored version: `[row, col, layers, ...]` (1 labels, 2 exclusion) and the start of the next page. */
    async maskInfo(owner, project, manifest, start) {
      checkProject(project);
      if (typeof manifest !== 'string' || !SHA256.test(manifest)) reject('INVALID_REQUEST', 'manifest');
      if (!Number.isSafeInteger(start) || start < 0) reject('INVALID_REQUEST', 'start');
      const r = await engine.request('mask.info', { project, manifest, start });
      if (!Array.isArray(r?.positions) || r.positions.length % 3 || !r.positions.every((v) => Number.isSafeInteger(v) && v >= 0)
          || !(r.next === null || Number.isSafeInteger(r.next))) reject('INTERNAL', 'info');
      return { section: r.section, width: r.width, height: r.height, tiles: r.tiles, positions: r.positions, next: r.next };
    },
    /** Remember, for this project, the file a pyramid this page built came from (its path stays in the main process). */
    async rememberSource(owner, project, pyramid) {
      checkProject(project);
      owned(owner, pyramid);
      if (!projectsRoot) reject('UNSUPPORTED_METHOD');
      const from = builtFrom.get(pyramid);
      if (!from) return { remembered: false };
      updateSource(project, pyramid, { path: from.path, size: from.size, name: displayName(from.path) });   // the name the copy keeps
      return { remembered: true };
    },
    /**
     * Make a saved section's pyramid readable by this page: the cached pyramid if the engine still has it; otherwise built again from the
     * project's copy of the source (card M8.4.18b) or else the file remembered for this project, each accepted only if its SHA-256 is the
     * saved one (checked by the engine before it builds anything). `{available: false}` when none is possible.
     */
    async reopen(owner, project, pyramid, key, onProgress = () => {}) {
      checkProject(project);
      if (typeof pyramid !== 'string' || !SHA256.test(pyramid)) reject('INVALID_REQUEST', 'pyramid');
      checkKey(owner, key);
      try { await (reader ? reader.describe(pyramid) : engine.request('pyramid.info', { pyramid })); own(owner, pyramid); return { available: true, rebuilt: false }; } catch { /* not in the cache */ }
      const entry = remembered(project, pyramid);
      const candidates = [copyOf(project, entry), sameSize(entry?.path, entry?.size)].filter(Boolean);
      let changed = false;
      for (const file of candidates) {
        const outcome = await buildExpected(owner, key, file, pyramid, entry.name || displayName(entry.path || file), onProgress);
        if (outcome === 'cancelled') return { available: false, rebuilt: false, cancelled: true };
        if (outcome === 'changed') { changed = true; continue; }               // the file at that path is another image now
        builtFrom.set(pyramid, { path: file, size: entry.size });
        return { available: true, rebuilt: true };
      }
      return { available: false, rebuilt: false, ...(changed ? { changed: true } : {}) };
    },
    /** What the main process knows about a saved section's source, for the page to show (never a path): whether the project holds a copy,
     *  whether the remembered original is there with the saved size, and the free space of the disk that holds the projects. */
    async sourceInfo(owner, project, pyramid) {
      checkProject(project);
      if (typeof pyramid !== 'string' || !SHA256.test(pyramid)) reject('INVALID_REQUEST', 'pyramid');
      if (!projectsRoot) reject('UNSUPPORTED_METHOD');
      const entry = remembered(project, pyramid), from = builtFrom.get(pyramid);
      const original = !!(sameSize(entry?.path, entry?.size) || sameSize(from?.path, from?.size));
      return { copied: !!copyOf(project, entry), original, size: entry?.size ?? from?.size ?? null, free: freeBytes(projectsRoot) };
    },
    /** Card M8.4.18b: the user chose `token` as the moved source of a saved section; accepted only with the saved size and SHA-256. */
    async locate(owner, project, pyramid, size, token, key, onProgress = () => {}) {
      checkProject(project);
      if (typeof pyramid !== 'string' || !SHA256.test(pyramid)) reject('INVALID_REQUEST', 'pyramid');
      if (!Number.isSafeInteger(size) || size < 1) reject('INVALID_REQUEST', 'size');
      const source = typeof token === 'string' && UUID.test(token) ? sources.get(token) : null;
      if (!source || source.owner !== owner) reject('INVALID_REQUEST', 'token');
      checkKey(owner, key);
      if (!projectsRoot) reject('UNSUPPORTED_METHOD');
      if (source.size !== size) return { matched: false, size: source.size };   // another file: not even hashed
      const outcome = await buildExpected(owner, key, source.path, pyramid, source.name, onProgress);
      if (outcome === 'cancelled') return { cancelled: true };
      if (outcome === 'changed') return { matched: false, size: source.size };
      builtFrom.set(pyramid, { path: source.path, size: source.size });
      updateSource(project, pyramid, { path: source.path, size: source.size });               // the remembered name stays the original's
      return { matched: true, rebuilt: outcome === 'built' };
    },
    /**
     * Card M8.4.18b (D3): copy the source of a pyramid this page has open into the project (`sources/<sha256>.<ext>`), verified on the way;
     * refused when the disk would keep less than 1 GiB free. `{copied: true}` or `{cancelled: true}`.
     */
    async copySource(owner, project, pyramid, key, onProgress = () => {}) {
      checkProject(project);
      owned(owner, pyramid);
      checkKey(owner, key);
      if (!projectsRoot) reject('UNSUPPORTED_METHOD');
      const entry = remembered(project, pyramid);
      if (copyOf(project, entry)) return { copied: true };
      const session = builtFrom.get(pyramid);
      const from = sameSize(session?.path, session?.size) ? session : sameSize(entry?.path, entry?.size) ? entry : null;
      if (!from) reject('UNSUPPORTED_INPUT', 'source');
      const folder = path.join(projectsRoot, project, SOURCES_DIR), free = freeBytes(projectsRoot);
      if (free !== null && free < from.size + COPY_RESERVE) reject('LIMIT_EXCEEDED', 'disk');
      fs.mkdirSync(folder, { recursive: true });
      const name = copyName(pyramid, entry?.name || displayName(from.path)), controller = new AbortController();
      copies.set(`${owner}/${key}`, controller);
      try {
        const result = await copyVerified({ from: from.path, to: path.join(folder, name), sha256: pyramid, size: from.size, onProgress, signal: controller.signal });
        if (result.cancelled) return { cancelled: true };
      } finally { copies.delete(`${owner}/${key}`); }
      updateSource(project, pyramid, { path: from.path, size: from.size, name: entry?.name || displayName(from.path), copy: name });
      return { copied: true };
    },
    /**
     * Card M8.4.27: the folder of a deleted project (masks, `sources.json`, copies of sources) goes too. The engine first forgets the store
     * (refused with BUSY while one of its versions is being sent); the folder is renamed to `.deleting-<uuid>` and then removed, so a stop half-way
     * leaves a folder nothing opens, removed at the next start. `{deleted: false}` when there is no folder.
     */
    async deleteProjectStore(owner, project) {
      checkProject(project);
      if (!projectsRoot) reject('UNSUPPORTED_METHOD');
      const folder = path.join(projectsRoot, project);
      try { fs.lstatSync(folder); } catch { return { deleted: false }; }
      try { await engine.request('mask.forget', { project }); } catch (error) {
        if (error?.code === 'BUSY' || error?.code === 'INVALID_REQUEST') throw error;
        // the engine is not running: it holds nothing of this project
      }
      const away = path.join(projectsRoot, DELETING + randomUUID());
      await renameRetrying(folder, away);
      removeTree(away);
      return { deleted: true };
    },
    /**
     * Card M8.4.27: a project saved under a new identifier gets the stored versions its tiled sections name (`manifests`, copied by the engine
     * page by page, verified, manifest last) and its record of their sources (`sources`: their SHA-256), with the project's copies of those
     * sources (hard links when possible). Events `{stage: 'copy', completed, total}` count tiles. `{copied: true}` or `{cancelled: true}`.
     */
    async copyProjectStore(owner, from, to, manifests, pyramidList, key, onProgress = () => {}) {
      checkProject(from); checkProject(to);
      if (from === to) reject('INVALID_REQUEST', 'to');
      if (!Array.isArray(manifests) || manifests.length > MAX_RETAINED || !manifests.every((name) => typeof name === 'string' && SHA256.test(name))) reject('INVALID_REQUEST', 'manifests');
      if (!Array.isArray(pyramidList) || pyramidList.length > MAX_COPIED_SOURCES || !pyramidList.every((name) => typeof name === 'string' && SHA256.test(name))) reject('INVALID_REQUEST', 'sources');
      checkKey(owner, key);
      if (!projectsRoot) reject('UNSUPPORTED_METHOD');
      const controller = new AbortController();
      copies.set(`${owner}/${key}`, controller);
      try {
        let completed = 0, total = 0;
        for (const manifest of new Set(manifests)) {
          for (let start = 0; start !== null;) {
            if (controller.signal.aborted) return { cancelled: true };
            const page = await engine.request('mask.copy', { from, to, manifest, start });
            if (!Number.isSafeInteger(page?.tiles) || !(page.next === null || (Number.isSafeInteger(page.next) && page.next > start))) reject('INTERNAL', 'copy');
            if (start === 0) total += page.tiles;
            completed += (page.next ?? page.tiles) - start;
            onProgress({ stage: 'copy', completed, total });
            start = page.next;
          }
        }
        const record = readSources(sourcesFile(from)).sources;
        for (const pyramid of new Set(pyramidList)) {
          const entry = record[pyramid];
          if (!entry) continue;
          const fields = { path: entry.path, size: entry.size, ...(entry.name ? { name: entry.name } : {}) };
          const own = copyOf(from, entry);
          if (own) {
            fs.mkdirSync(path.join(projectsRoot, to, SOURCES_DIR), { recursive: true });
            const target = path.join(projectsRoot, to, SOURCES_DIR, entry.copy);
            if (!sameSize(target, entry.size)) {
              const result = await linkOrCopy(own, target, pyramid, entry.size, controller.signal);
              if (result.cancelled) return { cancelled: true };
            }
            fields.copy = entry.copy;
          }
          updateSource(to, pyramid, fields);
        }
        return { copied: true };
      } finally { copies.delete(`${owner}/${key}`); }
    },
    async maskRead(owner, project, manifest, layer, positions) {
      checkProject(project);
      if (typeof manifest !== 'string' || !SHA256.test(manifest)) reject('INVALID_REQUEST', 'manifest');
      if (!Object.hasOwn(LAYER_BYTES, layer)) reject('INVALID_REQUEST', 'layer');
      if (!Array.isArray(positions) || positions.length < 1 || positions.length > 16
          || !positions.every((p) => Array.isArray(p) && p.length === 2 && isPosition(p[0]) && isPosition(p[1]))) reject('INVALID_REQUEST', 'positions');
      const result = await engine.request('mask.read', { project, manifest, layer, positions });
      return { tiles: result.tiles.map(({ row, col, byte_length }) => ({ row, col, byte_length })), bytes: result.bytes };
    },
  };

  return {
    delivery,
    async call(owner, name, ...args) {
      try { return { ok: await operations[name](owner, ...args) }; } catch (error) { return failure(error); }
    },
    releasePage(owner) {
      for (const [token, source] of sources) if (source.owner === owner) sources.delete(token);
      pyramids.delete(owner);
      for (const name of [...builds.keys()]) if (name.startsWith(`${owner}/`)) builds.delete(name);
      for (const [name, controller] of copies) if (name.startsWith(`${owner}/`)) { controller.abort(); copies.delete(name); }
      for (const [id, page] of staged) if (page === owner) { staged.delete(id); engine.request('mask.discard', { staged: id }).catch(() => {}); }
    },
    OPERATIONS: Object.keys(operations),
  };
}

module.exports = { createTileIpc, MAX_SOURCES_PER_PAGE, MAX_BUILDS_PER_PAGE };
