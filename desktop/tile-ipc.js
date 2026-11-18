// Narrow bridge between one page and the tile store (contract §8, card M8.4.15). No Electron dependency: main.js passes in the
// sender's identity and the path of a file the user chose (from webUtils.getPathForFile in the preload), so this file can be tested with
// Node and a fake engine. A page never sees or names a path: a chosen file becomes an opaque token, and the page may read only the
// pyramids that it built itself in this session.
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { TileReader } = require('./tile-reader');

const MAX_SOURCES_PER_PAGE = 64, MAX_BUILDS_PER_PAGE = 4, MAX_STAGED_PER_PAGE = 8, MAX_CHUNK = 1048576;
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
function createTileIpc({ engine, pyramidRoot = null, delivery = 'engine' }) {
  if (!['engine', 'direct'].includes(delivery)) throw new Error('unknown tile delivery');
  const reader = delivery === 'direct' ? new TileReader(pyramidRoot) : null;
  const sources = new Map();            // token -> {owner, path, name, size}
  const pyramids = new Map();           // owner -> Set of pyramid identifiers built by that page
  const builds = new Map();             // `${owner}/${key}` -> engine request id
  const staged = new Map();             // staged mask version (engine UUID) -> owner page

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
      if (typeof key !== 'string' || !UUID.test(key) || builds.has(`${owner}/${key}`)) reject('INVALID_REQUEST', 'key');
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
        if (!pyramids.has(owner)) pyramids.set(owner, new Set());
        pyramids.get(owner).add(clean.pyramid);
        return clean;
      } finally { builds.delete(`${owner}/${key}`); }
    },
    async cancel(owner, key) {
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
      for (const [id, page] of staged) if (page === owner) { staged.delete(id); engine.request('mask.discard', { staged: id }).catch(() => {}); }
    },
    OPERATIONS: Object.keys(operations),
  };
}

module.exports = { createTileIpc, MAX_SOURCES_PER_PAGE, MAX_BUILDS_PER_PAGE };
