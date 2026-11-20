// @ts-check
// Row counts of tiled sections (card M8.4.17, decision F of ARCHITECTURE §3.4). No DOM: tested in Node.
//
// The interval table of a tiled section is counted in the page, tile by tile. Each tile that holds a label or an exclusion has a *histogram*:
// for every row of the tile, the excluded pixels and the `(label, pixels)` pairs of the valid pixels, inside the columns of the analysis area.
// Nothing in it depends on classes, predictions or settings, so a change of any of them only *aggregates* the histograms again, with no tile
// read. The aggregation is the rule of `core.js rowCounts` (V0.20): a valid pixel is bioturbated once if any counted class covers it, and counts
// once for each distinct counted class covering it (an overlap stack lists its members). Every quantity is an integer, so the result is exactly
// the `rowCounts` of the masks assembled whole. A tile without a histogram is empty (all valid, no label).
//
// The totals are kept between calls: a changed tile subtracts its old histogram and adds its new one, which costs the size of the edit. They are
// rebuilt from all the histograms when something they depend on changed: the class of an object that existed, the number of classes, the rows of
// the analysis area. A stack code must keep its members for the life of the section (the stack table only grows on a tiled section).

import { TILE } from './tiledsection.js';

/** Memory the histograms of one section may hold; beyond it no table is computed (never a partial one). */
export const COUNT_HISTOGRAM_BYTES = 64 * 2 ** 20;

/** @typedef {{x0: number, y0: number, x1: number, y1: number}} SourceArea the analysis area in source pixels, half-open */
/**
 * @typedef {{rows: number, excluded: Uint16Array | null, offsets: Uint32Array | null, labels: Int32Array | null, counts: Uint16Array | null,
 *   bytes: number}} TileHistogram `rows` rows from the tile's top; row k has the pairs `offsets[k]..offsets[k + 1]` of `labels` and `counts`
 */
/** @typedef {{nRows: number, valid: Uint32Array, bio: Uint32Array, cls: Uint32Array, nClasses: number, nCols: number}} RowCounts */

/** The columns of tile column `col` inside `[x0, x1)` as `[from, to)` in source pixels; empty when they do not meet.
 * @param {number} col @param {number} width @param {number} x0 @param {number} x1 @returns {[number, number]} */
export function columnSpan(col, width, x0, x1) {
  const from = Math.max(col * TILE, x0), to = Math.min((col + 1) * TILE, width, x1);
  return to > from ? [from, to] : [0, 0];
}

/**
 * The histogram of tile (row, col): excluded pixels and labels per row inside the columns `[x0, x1)`; null when the tile adds nothing (no label
 * and no exclusion there), which is also what an empty tile is.
 * @param {{labels: Int32Array | null, exclude: Uint8Array | null} | undefined} entry @param {number} row @param {number} col
 * @param {number} width @param {number} height source size @param {number} x0 @param {number} x1 the area's columns
 * @returns {TileHistogram | null}
 */
export function tileHistogram(entry, row, col, width, height, x0, x1) {
  if (!entry || (!entry.labels && !entry.exclude)) return null;
  const [from, to] = columnSpan(col, width, x0, x1);
  if (to <= from) return null;
  const rows = Math.min(height, (row + 1) * TILE) - row * TILE, { labels, exclude } = entry;
  const excluded = new Uint16Array(rows), offsets = new Uint32Array(rows + 1);
  const outLabels = /** @type {number[]} */ ([]), outCounts = /** @type {number[]} */ ([]);
  const seen = new Map(), x = from - col * TILE, xEnd = to - col * TILE;
  let anyExcluded = false;
  for (let k = 0; k < rows; k++) {
    const base = k * TILE;
    let out = 0;
    for (let i = base + x, end = base + xEnd; i < end; i++) {
      if (exclude && exclude[i]) { out++; continue; }
      const id = labels ? labels[i] : 0;
      if (id !== 0) seen.set(id, (seen.get(id) || 0) + 1);
    }
    excluded[k] = out; if (out) anyExcluded = true;
    if (seen.size) {
      for (const id of [...seen.keys()].sort((a, b) => a - b)) { outLabels.push(id); outCounts.push(seen.get(id)); }
      seen.clear();
    }
    offsets[k + 1] = outLabels.length;
  }
  if (!anyExcluded && !outLabels.length) return null;
  const hist = { rows, excluded: anyExcluded ? excluded : null, offsets: outLabels.length ? offsets : null,
    labels: outLabels.length ? Int32Array.from(outLabels) : null, counts: outLabels.length ? Uint16Array.from(outCounts) : null, bytes: 0 };
  hist.bytes = 64 + (hist.excluded ? excluded.byteLength : 0) + (hist.offsets ? offsets.byteLength + outLabels.length * 6 : 0);
  return hist;
}

/**
 * The histograms of a tiled section's tiles and the row counts they add up to.
 * `nonEmpty()` lists the tiles (indices `row * cols + col`) that hold a label or an exclusion in the page or in the store.
 */
export class TiledRowCounts {
  /** @param {{width: number, height: number, rows: number, cols: number}} grid @param {{nonEmpty?: () => Iterable<number>}} [options] */
  constructor(grid, { nonEmpty = () => [] } = {}) {
    this.grid = grid; this.nonEmpty = nonEmpty;
    /** @type {Map<number, TileHistogram>} */
    this.hists = new Map();
    /** Counted but not yet added to the totals; null = the tile is empty now. @type {Map<number, TileHistogram | null>} */
    this.fresh = new Map();
    /** Tiles whose histogram must be computed again. @type {Set<number>} */
    this.needed = new Set();
    /** The columns `[x0, x1)` the histograms were counted with; null before the first area. @type {[number, number] | null} */
    this.columns = null;
    this.bytes = 0;
    /** @type {{nRows: number, nClasses: number, y0: number, y1: number, eff: Int16Array, valid: Uint32Array, bio: Uint32Array, cls: Uint32Array} | null} */
    this.totals = null;
    /** @type {Map<number, number[]>} distinct counted classes of a stack code, for the effective classes of `totals` */
    this.stackMemo = new Map();
  }
  /** Tiles to count again (their pixels changed). @param {Iterable<[number, number]>} positions */
  markChanged(positions) { for (const [row, col] of positions) this.needed.add(row * this.grid.cols + col); }
  /**
   * The analysis area changed or is new: histograms of tile columns whose columns inside it differ are dropped and counted again; a change of rows
   * only rebuilds the totals. Returns whether anything must be counted. @param {SourceArea} area
   */
  setArea(area) {
    const { cols, width } = this.grid, old = this.columns;
    this.columns = [area.x0, area.x1];
    if (!old) { for (const tile of this.nonEmpty()) this.needed.add(tile); return this.needed.size > 0; }
    if (old[0] === area.x0 && old[1] === area.x1) return this.needed.size > 0;
    const changed = new Set();
    for (let col = 0; col < cols; col++) if (String(columnSpan(col, width, old[0], old[1])) !== String(columnSpan(col, width, area.x0, area.x1))) changed.add(col);
    for (const tile of this.nonEmpty()) if (changed.has(tile % cols)) this.needed.add(tile);
    for (const tile of [...this.hists.keys()]) if (changed.has(tile % cols)) this.drop(tile);
    for (const tile of [...this.fresh.keys()]) if (changed.has(tile % cols)) this.fresh.delete(tile);
    this.totals = null;
    return this.needed.size > 0;
  }
  /** @param {number} tile */
  drop(tile) { const old = this.hists.get(tile); if (old) { this.bytes -= old.bytes; this.hists.delete(tile); } }
  /** The counted histogram of a tile (null: the tile is empty now). Must follow `setArea`. @param {number} tile @param {TileHistogram | null} hist */
  commit(tile, hist) {
    this.needed.delete(tile);
    const pending = this.fresh.get(tile);
    if (pending) this.bytes -= pending.bytes;
    this.fresh.set(tile, hist);
    if (hist) this.bytes += hist.bytes;
  }
  /**
   * The histograms as they are now, counted ones included, for the reopening cache (card M8.4.29); null while a tile still has to be counted
   * or no area is set, because such a state is not one a saved version corresponds to.
   * @returns {{columns: [number, number], hists: Map<number, TileHistogram>} | null}
   */
  snapshot() {
    if (!this.ready || !this.columns) return null;
    const hists = new Map(this.hists);
    for (const [tile, hist] of this.fresh) { if (hist) hists.set(tile, hist); else hists.delete(tile); }
    return { columns: [this.columns[0], this.columns[1]], hists };
  }
  /**
   * Take the histograms of a reopening cache (card M8.4.29) as if every stored tile had been counted for these columns. Only for a fresh section:
   * it replaces whatever was there. A following `setArea` with other columns counts again the tiles of the columns that differ, as always.
   * @param {[number, number]} columns @param {Map<number, TileHistogram>} hists
   */
  restore(columns, hists) {
    this.hists = new Map(hists); this.fresh.clear(); this.needed.clear(); this.totals = null; this.stackMemo.clear();
    this.columns = [columns[0], columns[1]];
    this.bytes = 0;
    for (const hist of this.hists.values()) this.bytes += hist.bytes;
  }
  /** True when every tile that must be counted has been, so the row counts can be asked for. */
  get ready() { return this.needed.size === 0 && this.columns !== null; }
  get overBudget() { return this.bytes > COUNT_HISTOGRAM_BYTES; }
  /** The distinct counted classes of a stack code. @param {number[][]} stacks @param {ArrayLike<number>} eff @param {number} code */
  stackClasses(stacks, eff, code) {
    let found = this.stackMemo.get(code);
    if (!found) {
      const set = new Set();
      for (const id of stacks[code] || []) { const c = eff[id]; if (c >= 0) set.add(c); }
      found = [...set]; this.stackMemo.set(code, found);
    }
    return found;
  }
  /**
   * Add (`sign` 1) or remove (-1) one histogram's contribution to the totals.
   * @param {TileHistogram | null | undefined} hist @param {number} tileRow @param {1 | -1} sign @param {NonNullable<TiledRowCounts['totals']>} t
   * @param {number[][]} stacks @param {ArrayLike<number>} eff
   */
  contribute(hist, tileRow, sign, t, stacks, eff) {
    if (!hist) return;
    const { nClasses } = t;
    for (let k = 0; k < hist.rows; k++) {
      const y = tileRow * TILE + k - t.y0;
      if (y < 0 || y >= t.nRows) continue;
      if (hist.excluded) t.valid[y] -= sign * hist.excluded[k];
      if (!hist.offsets) continue;
      const labels = /** @type {Int32Array} */ (hist.labels), counts = /** @type {Uint16Array} */ (hist.counts);
      for (let p = hist.offsets[k], end = hist.offsets[k + 1]; p < end; p++) {
        const id = labels[p], n = sign * counts[p];
        if (id > 0) {
          const c = eff[id];
          if (c >= 0) { t.bio[y] += n; t.cls[y * nClasses + c] += n; }
        } else {
          const classes = this.stackClasses(stacks, eff, -id);
          if (classes.length) { t.bio[y] += n; for (const c of classes) t.cls[y * nClasses + c] += n; }
        }
      }
    }
  }
  /**
   * The row counts of the area's rows. `effClass[id]` is the class index counted for object `id`, or -1 (`effectiveClassIndex`).
   * The arrays are the section's own totals: use them before the next call. Throws when a tile still has to be counted.
   * @param {{effClass: ArrayLike<number>, nClasses: number, stacks: number[][], area: SourceArea}} options @returns {RowCounts}
   */
  rowCounts({ effClass, nClasses, stacks, area }) {
    if (!this.ready) throw new Error('tiles still to count');
    const { cols } = this.grid, nRows = area.y1 - area.y0, nCols = area.x1 - area.x0;
    let t = this.totals;
    if (t && (t.nRows !== nRows || t.nClasses !== nClasses || t.y0 !== area.y0 || !prefixEqual(t.eff, effClass))) t = this.totals = null;
    if (t) {
      for (const tile of this.fresh.keys()) this.contribute(this.hists.get(tile), Math.floor(tile / cols), -1, t, stacks, t.eff);   // with the classes they were added with
      if (t.eff.length !== effClass.length) this.stackMemo.clear();                  // an id may come back as another object after an undo
      t.eff = Int16Array.from(/** @type {ArrayLike<number>} */ (effClass));
      for (const [tile, hist] of this.fresh) this.contribute(hist, Math.floor(tile / cols), 1, t, stacks, t.eff);
      this.settle();
    } else {
      this.settle();
      this.stackMemo.clear();
      const valid = new Uint32Array(nRows).fill(nCols), bio = new Uint32Array(nRows), cls = new Uint32Array(nRows * nClasses);
      t = this.totals = { nRows, nClasses, y0: area.y0, y1: area.y1, eff: Int16Array.from(/** @type {ArrayLike<number>} */ (effClass)), valid, bio, cls };
      for (const [tile, hist] of this.hists) this.contribute(hist, Math.floor(tile / cols), 1, t, stacks, t.eff);
    }
    return { nRows, valid: t.valid, bio: t.bio, cls: t.cls, nClasses, nCols };
  }
  /** Move the fresh histograms into the stored ones. The totals must already count the old ones out when they are kept. */
  settle() {
    for (const [tile, hist] of this.fresh) {
      const old = this.hists.get(tile);
      if (old) this.bytes -= old.bytes;
      if (hist) this.hists.set(tile, hist); else this.hists.delete(tile);
    }
    this.fresh.clear();
  }
}

/** Whether two class arrays agree on the ids both hold (the ones beyond are new, or deleted, objects). @param {ArrayLike<number>} a @param {ArrayLike<number>} b */
function prefixEqual(a, b) {
  for (let i = 0, n = Math.min(a.length, b.length); i < n; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Counts the queued tiles between frames, as `TiledStatsRunner` does for statistics: tiles in the page at once, tiles the page dropped are read
 * back with `loadMasks` first. `onReady` is called when nothing is left to count.
 */
export class TiledCountsRunner {
  /**
   * @param {{tiles: import('./tiledmasks.js').MaskTiles, counts: TiledRowCounts, loadMasks?: (positions: [number, number][]) => Promise<void>,
   *   onReady?: () => void, onError?: (error: any) => void}} options
   */
  constructor({ tiles, counts, loadMasks = async () => {}, onReady = () => {}, onError = () => {} }) {
    this.tiles = tiles; this.counts = counts; this.loadMasks = loadMasks; this.onReady = onReady; this.onError = onError;
    /** @type {Promise<void> | null} */
    this.running = null;
    /** Tiles whose read failed; counted again with the next request. @type {Set<number>} */
    this.failed = new Set();
    /** Set by `cancel`: the loop stops after the tile it is on, leaving the rest needed. */
    this.cancelled = false;
  }
  /** Count, now, every needed tile that is in the page (or empty); returns the positions still to be read back. @returns {[number, number][]} */
  flush() {
    const { tiles, counts } = this, { cols, width, height } = tiles, missing = /** @type {[number, number][]} */ ([]);
    const [x0, x1] = counts.columns || [0, width];
    for (const tile of [...counts.needed]) {
      const row = Math.floor(tile / cols), col = tile % cols, state = tiles.state(row, col);
      if (state === 'missing') { missing.push([row, col]); continue; }
      counts.commit(tile, tileHistogram(state === 'loaded' ? tiles.get(row, col) : undefined, row, col, width, height, x0, x1));
    }
    return missing;
  }
  /** Start (or continue) counting what is needed. */
  start() {
    this.cancelled = false;
    if (!this.running) this.running = this.run().finally(() => { this.running = null; });
    return this.running;
  }
  /** Stop after the current tile; what is not counted stays needed. */
  cancel() { this.cancelled = true; }
  async run() {
    const { counts } = this;
    for (;;) {
      const missing = this.flush();
      if (!missing.length) break;
      if (this.cancelled) return;
      try { await this.loadMasks(missing.slice(0, 16)); } catch (error) { this.onError(error); for (const [r, c] of missing) this.failed.add(r * this.tiles.cols + c); return; }
      await new Promise((resolve) => setTimeout(resolve, 0));             // let the page draw and take input between reads
    }
    if (counts.ready) this.onReady();
  }
}
