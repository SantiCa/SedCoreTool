// @ts-check
// The reopening cache of a tiled section (card M8.4.29, decision G). No DOM: tested in Node.
//
// Reopening a saved tiled section used to read every stored mask tile once, to rebuild three things the page derives from them: the row
// histograms of the interval table (M8.4.17), the reduced copy of the masks at the working size (decision D) and the per-tile statistics of the
// objects (M8.4.16 step 3). This module encodes them, as they are when a version has been saved, into one byte string that the engine keeps next to
// the version (`derived/<manifest>.reopen`, contract §8.7), and decodes and checks it when the section is opened again. The cache is only a
// shortcut: whatever does not match what is being opened, or does not pass a check, rejects the whole cache (`CacheRejected`) and the page
// rebuilds everything from the tiles, as before. Nothing in it is trusted because it is there: every count and offset is checked against the body
// before anything is allocated from it, and the body's SHA-256 is checked before it is parsed.
//
// Format (version 1, little-endian). Header, 152 bytes:
//    0  "SCRC"            4  u32 version (1)
//    8  manifest SHA-256 (32 bytes)             40 source SHA-256 (32 bytes)
//   72  u32 ds (source pixels per working pixel)          76 u32 source width          80 u32 source height
//   84  u32 working width    88 u32 working height       92 u32 area x0     96 u32 area x1 (the columns the histograms were clipped to)
//  100  u32 body length      104 body SHA-256 (32 bytes)   136..151 zeros (reserved; must be zero)
// Body: three parts, each a u32 byte length followed by its bytes.
//   histograms: u32 count, then per tile in ascending order: u32 tile (row * cols + col), u32 rows, u32 flags (1 = excluded counts,
//     2 = label pairs), u32 pairs; if flags & 1: rows x u16 excluded pixels per row; if flags & 2: (rows + 1) x u32 offsets, pairs x i32 labels,
//     pairs x u16 counts (the layout of `TileHistogram` in tiledcounts.js).
//   reduced copy: labels (w x h, i32) then exclusion (w x h, u8), each as zero-run coding: repeated {u32 zeros, u32 literal count, the
//     literal samples} until w x h samples are covered exactly.
//   statistics: u32 tiles, then per tile in ascending order: u32 tile, u32 objects, and per object in ascending id order: u32 id and the 17
//     fields of `TraceStats` as f64 in the order of STAT_FIELDS.

import { TILE } from './tiledsection.js';

export const CACHE_VERSION = 1;
/** The cache a page writes may not exceed this (the engine refuses more: contract §8.7). */
export const CACHE_MAX_BYTES = 128 * 2 ** 20;
export const HEADER_BYTES = 152;
/** The fields of a `TraceStats`, in the order they are stored. */
export const STAT_FIELDS = /** @type {const} */ (['n', 'sx', 'sy', 'sxx', 'syy', 'sxy', 'x0', 'x1', 'y0', 'y1', 'per', 'sL', 'sLL', 'sA', 'sB', 'rL', 'rN']);
const MAX_RUN_GAP = 8;                       // zeros inside a literal run before the run is ended (shorter gaps cost less than a new run header)
const IS_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
const HEX64 = /^[0-9a-f]{64}$/;

/** @typedef {import('./tiledcounts.js').TileHistogram} TileHistogram */
/** @typedef {import('./imageproc.js').TraceStats} TraceStats */
/** @typedef {{columns: [number, number], hists: Map<number, TileHistogram>, labels: Int32Array, exclude: Uint8Array,
 *   stats: Map<number, Map<number, TraceStats>>}} ReopenCache what a cache holds, decoded */

/**
 * Whether the statistics cover the histograms: a tile whose histogram lists labelled pixels has statistics for its objects. A section whose objects
 * were saved before their statistics were computed fails this, and is rebuilt (which computes them) rather than reopened without them.
 * @param {Map<number, TileHistogram>} hists @param {Map<number, Map<number, TraceStats>>} stats
 */
export function statsCover(hists, stats) {
  for (const [tile, hist] of hists) if (hist.offsets && !stats.get(tile)?.size) return false;
  return true;
}

/** The cache does not match what is being opened, or it does not pass a check. `reason` names the check (for the log, never for the user). */
export class CacheRejected extends Error {
  /** @param {string} reason */
  constructor(reason) { super(`reopening cache rejected: ${reason}`); this.name = 'CacheRejected'; this.reason = reason; }
}

/** @param {boolean} ok @param {string} reason */
function need(ok, reason) { if (!ok) throw new CacheRejected(reason); }

/** @param {string} hex @returns {Uint8Array} */
function hexBytes(hex) {
  if (!HEX64.test(hex)) throw new RangeError('SHA-256 as 64 lower-case hex digits expected');
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
/** @param {Uint8Array} bytes */
const bytesHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** Growing byte buffer with little-endian writers. */
class Writer {
  constructor() { this.bytes = new Uint8Array(1 << 16); this.view = new DataView(this.bytes.buffer); this.length = 0; }
  /** @param {number} extra */
  room(extra) {
    if (this.length + extra <= this.bytes.length) return;
    let size = this.bytes.length;
    while (size < this.length + extra) size *= 2;
    if (size > CACHE_MAX_BYTES + HEADER_BYTES) throw new CacheTooLarge();
    const bytes = new Uint8Array(size); bytes.set(this.bytes.subarray(0, this.length));
    this.bytes = bytes; this.view = new DataView(bytes.buffer);
  }
  /** @param {number} v */ u32(v) { this.room(4); this.view.setUint32(this.length, v, true); this.length += 4; }
  /** @param {number} v */ f64(v) { this.room(8); this.view.setFloat64(this.length, v, true); this.length += 8; }
  /** Raw bytes of a typed array (the platform is little-endian: checked by the callers). @param {ArrayBufferView} array */
  raw(array) {
    const n = array.byteLength; this.room(n);
    this.bytes.set(new Uint8Array(array.buffer, array.byteOffset, n), this.length); this.length += n;
  }
  /** Reserve a u32 to be filled by `patch`; returns its position. */
  hole() { this.room(4); this.length += 4; return this.length - 4; }
  /** @param {number} at @param {number} v */ patch(at, v) { this.view.setUint32(at, v, true); }
  done() { return this.bytes.subarray(0, this.length); }
}

/** The encoded cache would be larger than the engine accepts: none is written (the next reopening rebuilds, as before). */
export class CacheTooLarge extends Error { constructor() { super('reopening cache too large'); this.name = 'CacheTooLarge'; } }

/** @param {Writer} w @param {Int32Array | Uint8Array} samples */
function writeRuns(w, samples) {
  const n = samples.length;
  for (let i = 0; i < n;) {
    let zeros = 0;
    while (i < n && samples[i] === 0) { zeros++; i++; }
    const start = i;
    let end = i, gap = 0;
    for (; i < n; i++) {
      if (samples[i] === 0) { if (++gap >= MAX_RUN_GAP) break; } else { gap = 0; end = i + 1; }
    }
    i = end;
    w.u32(zeros); w.u32(end - start);
    if (end > start) w.raw(samples.subarray(start, end));
  }
}

/**
 * The bytes of the cache of a saved version.
 * @param {{manifest: string, source: string, ds: number, width: number, height: number, working: {w: number, h: number, labels: Int32Array, exclude: Uint8Array},
 *   columns: [number, number], hists: Map<number, TileHistogram>, stats: Map<number, Map<number, TraceStats>>}} input `manifest` and `source` as 64 hex digits
 * @param {(bytes: Uint8Array) => Promise<string>} sha256 hexadecimal SHA-256
 * @returns {Promise<Uint8Array>} throws `CacheTooLarge` (nothing should be written) or `RangeError` for arguments that are not a section
 */
export async function encodeReopenCache(input, sha256) {
  if (!IS_LITTLE_ENDIAN) throw new CacheTooLarge();                      // never on the supported platforms; no cache rather than a misread one
  const { manifest, source, ds, width, height, working, columns, hists, stats } = input;
  for (const v of [ds, width, height, working.w, working.h, columns[0], columns[1]]) if (!Number.isSafeInteger(v) || v < 0 || v > 0xffffffff) throw new RangeError('size');
  if (working.labels.length !== working.w * working.h || working.exclude.length !== working.w * working.h) throw new RangeError('working size');
  const body = new Writer();
  // histograms
  let at = body.hole(); const histStart = body.length;
  body.u32(hists.size);
  for (const tile of [...hists.keys()].sort((a, b) => a - b)) {
    const h = /** @type {TileHistogram} */ (hists.get(tile)), pairs = h.offsets ? h.offsets[h.rows] : 0;
    body.u32(tile); body.u32(h.rows); body.u32((h.excluded ? 1 : 0) | (h.offsets ? 2 : 0)); body.u32(pairs);
    if (h.excluded) body.raw(h.excluded);
    if (h.offsets) { body.raw(h.offsets); body.raw(/** @type {Int32Array} */ (h.labels).subarray(0, pairs)); body.raw(/** @type {Uint16Array} */ (h.counts).subarray(0, pairs)); }
  }
  body.patch(at, body.length - histStart);
  // reduced copy
  at = body.hole(); const reducedStart = body.length;
  writeRuns(body, working.labels); writeRuns(body, working.exclude);
  body.patch(at, body.length - reducedStart);
  // statistics
  at = body.hole(); const statsStart = body.length;
  body.u32(stats.size);
  for (const tile of [...stats.keys()].sort((a, b) => a - b)) {
    const perTile = /** @type {Map<number, TraceStats>} */ (stats.get(tile));
    body.u32(tile); body.u32(perTile.size);
    for (const id of [...perTile.keys()].sort((a, b) => a - b)) {
      const s = /** @type {TraceStats} */ (perTile.get(id));
      body.u32(id);
      for (const field of STAT_FIELDS) body.f64(s[field]);
    }
  }
  body.patch(at, body.length - statsStart);
  const payload = body.done();
  const out = new Uint8Array(HEADER_BYTES + payload.length), view = new DataView(out.buffer);
  out.set([0x53, 0x43, 0x52, 0x43]);                                  // "SCRC"
  view.setUint32(4, CACHE_VERSION, true);
  out.set(hexBytes(manifest), 8); out.set(hexBytes(source), 40);
  [ds, width, height, working.w, working.h, columns[0], columns[1], payload.length].forEach((v, k) => view.setUint32(72 + 4 * k, v, true));
  out.set(hexBytes(await sha256(payload)), 104);
  out.set(payload, HEADER_BYTES);
  return out;
}

/** Bounds-checked reader over the body. */
class Reader {
  /** @param {Uint8Array} bytes @param {number} start @param {number} end */
  constructor(bytes, start, end) { this.bytes = bytes; this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); this.at = start; this.end = end; }
  /** @param {number} n */ take(n) { need(Number.isSafeInteger(n) && n >= 0 && this.at + n <= this.end, 'a count or offset lies outside the body'); const from = this.at; this.at += n; return from; }
  u32() { return this.view.getUint32(this.take(4), true); }
  f64() { return this.view.getFloat64(this.take(8), true); }
  /** A copy as a typed array (the body is not aligned). @template T @param {new (buffer: ArrayBuffer) => T} Type @param {number} count @param {number} size */
  array(Type, count, size) {
    const from = this.take(count * size);
    return new Type(this.bytes.slice(from, from + count * size).buffer);
  }
  /** A sub-reader over the next `length` bytes, which the parent skips. @param {number} length */
  part(length) { const from = this.take(length); return new Reader(this.bytes, from, from + length); }
  get left() { return this.end - this.at; }
}

/** @param {Reader} r @param {number} n @param {boolean} wide */
function readRuns(r, n, wide) {
  const out = wide ? new Int32Array(n) : new Uint8Array(n);
  let i = 0;
  while (i < n) {
    const zeros = r.u32(), literal = r.u32();
    need(zeros + literal > 0 && zeros <= n - i && literal <= n - i - zeros, 'the reduced copy does not cover its size exactly');
    i += zeros;
    if (literal) {
      const values = wide ? r.array(Int32Array, literal, 4) : r.array(Uint8Array, literal, 1);
      out.set(/** @type {any} */ (values), i);
      i += literal;
    }
  }
  return out;
}

/**
 * Decode a cache and check it against the section being opened. The whole cache is accepted or `CacheRejected` is thrown; nothing is returned
 * partly. `expect.stored` are the tile indices (`row * cols + col`) of the stored version: only they can have a histogram or statistics.
 * @param {Uint8Array} bytes
 * @param {{manifest: string, source: string, ds: number, width: number, height: number, working: {w: number, h: number}, stored: Set<number>}} expect
 * @param {(bytes: Uint8Array) => Promise<string>} sha256
 * @returns {Promise<ReopenCache>}
 */
export async function decodeReopenCache(bytes, expect, sha256) {
  need(IS_LITTLE_ENDIAN, 'platform');
  need(bytes instanceof Uint8Array && bytes.length >= HEADER_BYTES && bytes.length <= CACHE_MAX_BYTES + HEADER_BYTES, 'size');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  need(bytes[0] === 0x53 && bytes[1] === 0x43 && bytes[2] === 0x52 && bytes[3] === 0x43, 'magic');
  need(view.getUint32(4, true) === CACHE_VERSION, 'version');
  need(bytesHex(bytes.subarray(8, 40)) === expect.manifest, 'manifest');
  need(bytesHex(bytes.subarray(40, 72)) === expect.source, 'source');
  const field = (k) => view.getUint32(72 + 4 * k, true);
  need(field(0) === expect.ds && field(1) === expect.width && field(2) === expect.height && field(3) === expect.working.w && field(4) === expect.working.h, 'sizes');
  const columns = /** @type {[number, number]} */ ([field(5), field(6)]), bodyLength = field(7);
  need(columns[0] <= columns[1] && columns[1] <= expect.width, 'area columns');
  need(bytes.subarray(136, HEADER_BYTES).every((b) => b === 0), 'reserved bytes');
  need(bodyLength === bytes.length - HEADER_BYTES, 'body length');
  const body = bytes.subarray(HEADER_BYTES);
  need(bytesHex(bytes.subarray(104, 136)) === await sha256(body), 'body hash');

  const rows = Math.ceil(expect.height / TILE), cols = Math.ceil(expect.width / TILE), root = new Reader(bytes, HEADER_BYTES, bytes.length);
  // histograms
  const hr = root.part(root.u32()), count = hr.u32();
  need(count <= expect.stored.size, 'histogram count');
  /** @type {Map<number, TileHistogram>} */
  const hists = new Map();
  let previous = -1;
  for (let k = 0; k < count; k++) {
    const tile = hr.u32(), tileRows = hr.u32(), flags = hr.u32(), pairs = hr.u32();
    need(tile > previous && tile < rows * cols && expect.stored.has(tile), 'histogram tile');
    previous = tile;
    const row = Math.floor(tile / cols), col = tile % cols, expectedRows = Math.min(expect.height, (row + 1) * TILE) - row * TILE;
    const span = Math.max(0, Math.min((col + 1) * TILE, expect.width, columns[1]) - Math.max(col * TILE, columns[0]));
    need(tileRows === expectedRows && flags >= 1 && flags <= 3 && span > 0, 'histogram shape');
    need((flags & 2) !== 0 || pairs === 0, 'histogram pairs');
    let excluded = null, offsets = null, labels = null, counts = null;
    if (flags & 1) {
      excluded = hr.array(Uint16Array, tileRows, 2);
      need(excluded.every((v) => v <= span), 'excluded pixels');
    }
    if (flags & 2) {
      need(pairs >= 1 && pairs <= tileRows * span, 'histogram pairs');
      offsets = hr.array(Uint32Array, tileRows + 1, 4); labels = hr.array(Int32Array, pairs, 4); counts = hr.array(Uint16Array, pairs, 2);
      need(offsets[0] === 0 && offsets[tileRows] === pairs, 'histogram offsets');
      for (let y = 0; y < tileRows; y++) {
        const a = offsets[y], b = offsets[y + 1];
        need(b >= a && b <= pairs, 'histogram offsets');
        let sum = excluded ? excluded[y] : 0;
        for (let p = a; p < b; p++) {
          need(labels[p] !== 0 && counts[p] >= 1 && (p === a || labels[p] > labels[p - 1]), 'histogram pair');
          sum += counts[p];
        }
        need(sum <= span, 'histogram row total');
      }
    }
    hists.set(tile, { rows: tileRows, excluded, offsets, labels, counts, bytes: 64 + (excluded ? excluded.byteLength : 0) + (offsets ? offsets.byteLength + pairs * 6 : 0) });
  }
  need(hr.left === 0, 'histogram part length');
  // reduced copy
  const rr = root.part(root.u32()), n = expect.working.w * expect.working.h;
  const labels = /** @type {Int32Array} */ (readRuns(rr, n, true)), exclude = /** @type {Uint8Array} */ (readRuns(rr, n, false));
  need(rr.left === 0 && exclude.every((v) => v <= 1), 'reduced copy');
  // statistics
  const sr = root.part(root.u32()), tiles = sr.u32();
  need(tiles <= expect.stored.size, 'statistics tile count');
  /** @type {Map<number, Map<number, TraceStats>>} */
  const stats = new Map();
  previous = -1;
  for (let k = 0; k < tiles; k++) {
    const tile = sr.u32(), objects = sr.u32();
    need(tile > previous && tile < rows * cols && expect.stored.has(tile) && objects >= 1 && objects * (4 + 8 * STAT_FIELDS.length) <= sr.left, 'statistics tile');
    previous = tile;
    /** @type {Map<number, TraceStats>} */
    const perTile = new Map();
    let last = 0;
    for (let j = 0; j < objects; j++) {
      const id = sr.u32();
      need(id > last && id <= 0x7fffffff, 'statistics object');
      last = id;
      const s = /** @type {any} */ ({});
      for (const name of STAT_FIELDS) { const v = sr.f64(); need(Number.isFinite(v), 'statistics value'); s[name] = v; }
      need(Number.isInteger(s.n) && s.n >= 1 && s.x0 <= s.x1 && s.y0 <= s.y1 && s.x0 >= 0 && s.y0 >= 0 && s.x1 < expect.width && s.y1 < expect.height, 'statistics box');
      perTile.set(id, s);
    }
    stats.set(tile, perTile);
  }
  need(sr.left === 0 && root.left === 0, 'statistics part length');
  need(statsCover(hists, stats), 'statistics missing for a labelled tile');
  return { columns, hists, labels, exclude, stats };
}
