// Narrow bridge between one page and the tile store (contract §8, card M8.4.15). No Electron dependency: main.js passes in the
// sender's identity and the path of a file the user chose (from webUtils.getPathForFile in the preload), so this file can be tested with
// Node and a fake engine. A page never sees or names a path: a chosen file becomes an opaque token, and the page may read only the
// pyramids that it built itself in this session.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { TileReader } = require('./tile-reader');

const MAX_SOURCES_PER_PAGE = 64, MAX_BUILDS_PER_PAGE = 4;
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
    },
    OPERATIONS: Object.keys(operations),
  };
}

module.exports = { createTileIpc, MAX_SOURCES_PER_PAGE, MAX_BUILDS_PER_PAGE };
