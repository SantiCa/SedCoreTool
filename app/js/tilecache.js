// @ts-check
// Which tiles of a tiled section the viewer needs, kept in a bounded cache and fetched in batches (card M8.4.15 step 3). No DOM: tested in Node.
//
// Coordinates: a pyramid level k has its own pixels; one level-k pixel covers 2^k x 2^k source pixels (level 0 = the source). A tile is
// TILE x TILE level pixels, so tile (k, row, col) covers source x in [col * TILE * 2^k, (col + 1) * TILE * 2^k), and the same for y.

import { TILE } from './tiledsection.js';

export const CACHE_BYTES = 256 * 2 ** 20;      // the page's tile budget (card M8.4.15, contract §8 limits)
export const BATCH = 16;                       // tile.read takes at most 16 positions
export const MAX_IN_FLIGHT = 2;                // batches requested at once

/** @typedef {{width: number, height: number, rows: number, cols: number}} Level */
/** @typedef {{x0: number, y0: number, x1: number, y1: number}} Rect */

/**
 * The level to draw at a zoom of `zoom` screen pixels per source pixel: the coarsest level that still has at least one level pixel per screen
 * pixel (2^k <= 1 / zoom), so nothing is magnified beyond the source's own resolution, clamped to the levels that exist.
 * @param {Level[]} levels
 * @param {number} zoom
 */
export function levelForZoom(levels, zoom) {
  if (!(zoom > 0)) return levels.length - 1;
  const k = Math.floor(Math.log2(1 / zoom) + 1e-9);
  return Math.max(0, Math.min(levels.length - 1, k));
}

/**
 * The tiles of level `k` that cover `rect` (source pixels, half-open), plus `margin` tiles around it, clamped to the level's grid.
 * @param {Level[]} levels @param {number} k @param {Rect} rect @param {number} [margin]
 */
export function tileRange(levels, k, rect, margin = 1) {
  const level = levels[k], span = TILE * 2 ** k;
  const col0 = Math.max(0, Math.floor(rect.x0 / span) - margin), col1 = Math.min(level.cols - 1, Math.floor((rect.x1 - 1) / span) + margin);
  const row0 = Math.max(0, Math.floor(rect.y0 / span) - margin), row1 = Math.min(level.rows - 1, Math.floor((rect.y1 - 1) / span) + margin);
  return { k, row0, row1, col0, col1 };
}

/**
 * The positions of a range, nearest to `center` (source pixels) first: what the user looks at arrives first.
 * @param {{k: number, row0: number, row1: number, col0: number, col1: number}} range @param {{x: number, y: number}} center
 * @returns {[number, number][]}
 */
export function tilesByDistance(range, center) {
  const span = TILE * 2 ** range.k, out = /** @type {[number, number, number][]} */ ([]);
  for (let row = range.row0; row <= range.row1; row++) {
    for (let col = range.col0; col <= range.col1; col++) {
      const dx = (col + 0.5) * span - center.x, dy = (row + 0.5) * span - center.y;
      out.push([row, col, dx * dx + dy * dy]);
    }
  }
  return out.sort((a, b) => a[2] - b[2] || a[0] - b[0] || a[1] - b[1]).map(([row, col]) => [row, col]);
}

/** @param {number} k @param {number} row @param {number} col */
export const tileKey = (k, row, col) => `${k}/${row}/${col}`;

/**
 * Where to draw tile (k, row, col) from while it is missing: the nearest coarser level whose covering tile `has(key)`, and the part of that
 * tile (in its own pixels) that corresponds to the missing one. Null when no coarser tile is cached.
 * @param {Level[]} levels @param {number} k @param {number} row @param {number} col @param {(key: string) => boolean} has
 */
export function coarserCover(levels, k, row, col, has) {
  for (let k2 = k + 1; k2 < levels.length; k2++) {
    const factor = 2 ** (k2 - k), size = TILE / factor;
    const prow = Math.floor(row / factor), pcol = Math.floor(col / factor);
    const key = tileKey(k2, prow, pcol);
    if (has(key)) return { key, k: k2, row: prow, col: pcol, sx: (col - pcol * factor) * size, sy: (row - prow * factor) * size, sw: size, sh: size };
  }
  return null;
}

/** A least-recently-used cache with a byte budget. `evict(protect)` never drops the keys in `protect` (the tiles on screen). */
export class TileCache {
  /** @param {number} [budget] */
  constructor(budget = CACHE_BYTES) {
    this.budget = budget;
    /** @type {Map<string, {value: any, bytes: number}>} */
    this.entries = new Map();
    this.bytes = 0;
  }
  /** @param {string} key */
  has(key) { return this.entries.has(key); }
  /** @param {string} key */
  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key); this.entries.set(key, entry);           // most recently used last
    return entry.value;
  }
  /** @param {string} key @param {any} value @param {number} bytes @param {Set<string>} [protect] */
  set(key, value, bytes, protect = new Set()) {
    const old = this.entries.get(key);
    if (old) { this.bytes -= old.bytes; this.entries.delete(key); }
    this.entries.set(key, { value, bytes });
    this.bytes += bytes;
    return this.evict(protect);
  }
  /** Drop least recently used entries until the budget holds; returns the dropped values (the caller may close them). @param {Set<string>} [protect] */
  evict(protect = new Set()) {
    const dropped = [];
    for (const [key, entry] of this.entries) {
      if (this.bytes <= this.budget) break;
      if (protect.has(key)) continue;
      this.entries.delete(key); this.bytes -= entry.bytes;
      dropped.push(entry.value);
    }
    return dropped;
  }
  clear() { const values = [...this.entries.values()].map((entry) => entry.value); this.entries.clear(); this.bytes = 0; return values; }
}

/**
 * Fetches the tiles the view wants, at most BATCH per request and MAX_IN_FLIGHT requests at a time. `want` replaces the list of wanted tiles:
 * tiles that are no longer wanted and not yet requested are dropped (the cancellation of obsolete requests); a batch already sent completes and
 * its tiles are cached anyway, which is cheap and often useful when panning back.
 */
export class TileScheduler {
  /**
   * @param {{fetch: (k: number, positions: [number, number][]) => Promise<{row: number, col: number, value: any, bytes: number}[]>,
   *   cache: TileCache, onLoaded?: (keys: string[]) => void, onError?: (error: any) => void, batch?: number, maxInFlight?: number}} options
   */
  constructor({ fetch, cache, onLoaded = () => {}, onError = () => {}, batch = BATCH, maxInFlight = MAX_IN_FLIGHT }) {
    this.fetch = fetch; this.cache = cache; this.onLoaded = onLoaded; this.onError = onError; this.batch = batch; this.maxInFlight = maxInFlight;
    /** @type {{k: number, row: number, col: number}[]} */
    this.queue = [];
    /** @type {Set<string>} */
    this.inFlight = new Set();
    /** @type {Set<string>} */
    this.protect = new Set();
    this.running = 0;
  }
  /** @param {number} k @param {[number, number][]} positions in order of priority @param {Set<string>} [protect] keys on screen */
  want(k, positions, protect = new Set()) {
    this.protect = protect;
    this.queue = positions.filter(([row, col]) => { const key = tileKey(k, row, col); return !this.cache.has(key) && !this.inFlight.has(key); })
      .map(([row, col]) => ({ k, row, col }));
    this.pump();
  }
  get idle() { return this.running === 0 && this.queue.length === 0; }
  pump() {
    while (this.running < this.maxInFlight && this.queue.length) {
      const k = this.queue[0].k, batch = [];
      while (batch.length < this.batch && this.queue.length && this.queue[0].k === k) batch.push(/** @type {{k: number, row: number, col: number}} */ (this.queue.shift()));
      const keys = batch.map((tile) => tileKey(tile.k, tile.row, tile.col));
      keys.forEach((key) => this.inFlight.add(key));
      this.running++;
      this.fetch(k, batch.map((tile) => [tile.row, tile.col])).then((tiles) => {
        const loaded = [];
        for (const tile of tiles) {
          const key = tileKey(k, tile.row, tile.col);
          for (const dropped of this.cache.set(key, tile.value, tile.bytes, this.protect)) dropped?.close?.();
          loaded.push(key);
        }
        this.onLoaded(loaded);
      }, (error) => this.onError(error)).finally(() => {
        keys.forEach((key) => this.inFlight.delete(key));
        this.running--;
        this.pump();
      });
    }
  }
}
