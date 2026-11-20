// Reads verified tiles of a pixel pyramid directly from the store (contract §8.2), in the main process. Delivery path (b) of card M8.4.15:
// the engine writes the store; this module only reads it, and serves a tile only if its uncompressed bytes have the SHA-256 that
// `<level>/.tiles.sha256` lists (ARCHITECTURE §3.4 rule 3). No Electron dependency, so Node tests can use it.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { createHash } = require('node:crypto');

const TILE = 512, MAX_POSITIONS = 16, SHA256 = /^[0-9a-f]{64}$/;

class TileReadError extends Error {
  constructor(field) { super(field); this.code = field === 'tile' ? 'INVALID_BUFFER' : 'INVALID_REQUEST'; this.field = field; }
}

/** The validated `pyramid.json` of a complete pyramid of format version 1, as contract §8.2 describes it. */
function readDescription(root, pyramid) {
  if (typeof pyramid !== 'string' || !SHA256.test(pyramid)) throw new TileReadError('pyramid');
  let value;
  try { value = JSON.parse(fs.readFileSync(path.join(root, pyramid, 'pyramid.json'), 'utf8')); } catch { throw new TileReadError('pyramid'); }
  const levels = [];
  let width = value?.width, height = value?.height;
  for (let level = 0; Number.isSafeInteger(width) && width > 0 && Number.isSafeInteger(height) && height > 0; level++) {
    levels.push({ level, width, height, rows: Math.ceil(height / TILE), cols: Math.ceil(width / TILE) });
    if (width <= TILE && height <= TILE) break;
    width = Math.ceil(width / 2); height = Math.ceil(height / 2);
  }
  const zlibCompressor = value?.compressor && value.compressor.id === 'zlib' && value.compressor.level === 1 && Object.keys(value.compressor).length === 2;
  const ok = value && value.format === 'sedcoretool.pyramid' && value.version === 1 && value.complete === true && value.tile === TILE
    && [1, 3, 4].includes(value.channels) && [8, 16].includes(value.bits) && (value.compressor === null || zlibCompressor)
    && value.source?.sha256 === pyramid && Array.isArray(value.levels) && value.levels.length === levels.length
    // Field by field: the engine writes pyramid.json with sorted keys, so the order of keys is not part of the format.
    && levels.every((level, index) => Object.keys(level).length === Object.keys(value.levels[index] || {}).length
      && Object.entries(level).every(([key, expected]) => value.levels[index][key] === expected));
  if (!ok) throw new TileReadError('pyramid');
  return value;
}

class TileReader {
  constructor(root, { cacheBytes = 256 * 2 ** 20 } = {}) {
    if (!path.isAbsolute(root || '')) throw new Error('the pyramid root must be absolute');
    this.root = root; this.cacheBytes = cacheBytes;
    this.descriptions = new Map(); this.hashes = new Map(); this.cache = new Map(); this.cached = 0;
  }
  describe(pyramid) {
    if (!this.descriptions.has(pyramid)) this.descriptions.set(pyramid, readDescription(this.root, pyramid));
    return this.descriptions.get(pyramid);
  }
  levelHashes(pyramid, level) {
    const key = `${pyramid}/${level.level}`;
    if (!this.hashes.has(key)) {
      let data;
      try { data = fs.readFileSync(path.join(this.root, pyramid, String(level.level), '.tiles.sha256')); } catch { throw new TileReadError('tile'); }
      if (data.length !== level.rows * level.cols * 32) throw new TileReadError('tile');
      this.hashes.set(key, data);
    }
    return this.hashes.get(key);
  }
  /** The uncompressed bytes of each requested tile, in request order, as one Buffer plus the per-tile record. Nothing partial is returned. */
  read(pyramid, levelIndex, positions) {
    const description = this.describe(pyramid);
    if (!Number.isInteger(levelIndex) || levelIndex < 0 || levelIndex >= description.levels.length) throw new TileReadError('level');
    const level = description.levels[levelIndex];
    if (!Array.isArray(positions) || !positions.length || positions.length > MAX_POSITIONS
        || positions.some((p) => !Array.isArray(p) || p.length !== 2 || !Number.isInteger(p[0]) || !Number.isInteger(p[1])
          || p[0] < 0 || p[0] >= level.rows || p[1] < 0 || p[1] >= level.cols)) throw new TileReadError('positions');
    const expected = TILE * TILE * description.channels * (description.bits / 8), hashes = this.levelHashes(pyramid, level);
    const parts = [], tiles = [];
    for (const [row, col] of positions) {
      const key = `${pyramid}/${levelIndex}/${row}/${col}`;
      let data = this.cache.get(key);
      if (data) { this.cache.delete(key); this.cache.set(key, data); }
      else {
        try {
          const raw = fs.readFileSync(path.join(this.root, pyramid, String(levelIndex), `${row}.${col}.0`));
          data = description.compressor ? zlib.inflateSync(raw) : raw;
        } catch { throw new TileReadError('tile'); }
        const index = (row * level.cols + col) * 32;
        if (data.length !== expected || !createHash('sha256').update(data).digest().equals(hashes.subarray(index, index + 32))) throw new TileReadError('tile');
        this.remember(key, data);
      }
      parts.push(data);
      tiles.push({ row, col, byte_length: data.length });
    }
    return { tiles, bytes: Buffer.concat(parts) };
  }
  remember(key, data) {
    if (data.length > this.cacheBytes) return;
    this.cache.set(key, data); this.cached += data.length;
    for (const [oldKey, old] of this.cache) {
      if (this.cached <= this.cacheBytes) break;
      this.cache.delete(oldKey); this.cached -= old.length;
    }
  }
}

module.exports = { TileReader, TileReadError, readDescription, TILE, MAX_POSITIONS };
