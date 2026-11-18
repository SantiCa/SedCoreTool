// @ts-check
// Editing the masks of a tiled section (card M8.4.16 step 3, decisions A and B of the card). No DOM: tested in Node.
//
// Decision A: an edit runs on an *edit window*, a rectangle of whole level-0 mask tiles copied into flat arrays (clipped at the section's
// edge), so that today's editing code (brush, erase, exclusion) runs on it unchanged; what it wrote is copied back into the tiles.
// Decision B: the window covers the visible tiles plus a margin of the brush radius, and editing refuses when that is more than WINDOW_TILES
// tiles (the user zooms in).
// Object statistics stay exact at any size: they are kept per tile (`tileStats`: the contribution of the pixels of one tile, computed with the
// 3-pixel neighbourhood that `objectStats` reads) and summed per object (`TiledObjectStats`); an edit recomputes only the tiles within 3 pixels
// of what it changed (`affectedTiles`), from the level-0 pixels (`TiledStatsRunner`).

import { TILE } from './tiledsection.js';
import { objectStats } from './imageproc.js';

export const WINDOW_TILES = 96;                  // decision B: 96 tiles of labels and exclusion are 120 MiB
const TILE_PIXELS = TILE * TILE;
const STATS_MARGIN = 3;                                   // objectStats reads labels and pixels up to 3 pixels away

/** @typedef {{row0: number, row1: number, col0: number, col1: number, count: number}} TileRange */
/** @typedef {import('./tiledmasks.js').MaskTiles} MaskTiles */
/** @typedef {import('./imageproc.js').TraceStats} TraceStats */

/**
 * The tiles of a window: those covering `rect` (source pixels, half-open) and `ring` more on every side, clamped to the grid.
 * @param {{rows: number, cols: number}} grid @param {{x0: number, y0: number, x1: number, y1: number}} rect @param {number} ring
 * @returns {TileRange}
 */
export function windowRange(grid, rect, ring) {
  const col0 = Math.max(0, Math.floor(rect.x0 / TILE) - ring), col1 = Math.min(grid.cols - 1, Math.floor((rect.x1 - 1) / TILE) + ring);
  const row0 = Math.max(0, Math.floor(rect.y0 / TILE) - ring), row1 = Math.min(grid.rows - 1, Math.floor((rect.y1 - 1) / TILE) + ring);
  return { row0, row1, col0, col1, count: Math.max(0, row1 - row0 + 1) * Math.max(0, col1 - col0 + 1) };
}

/** Decision A: the masks of a rectangle of tiles as flat arrays, `w` x `h` source pixels from (ox, oy). */
export class EditWindow {
  /** @param {MaskTiles} tiles @param {TileRange} range */
  constructor(tiles, range) {
    if (range.count < 1) throw new Error('empty edit window');
    for (let row = range.row0; row <= range.row1; row++) for (let col = range.col0; col <= range.col1; col++) {
      if (tiles.state(row, col) === 'missing') throw new Error('mask tile not loaded');
    }
    this.tiles = tiles; this.range = range;
    this.ox = range.col0 * TILE; this.oy = range.row0 * TILE;
    this.w = Math.min((range.col1 + 1) * TILE, tiles.width) - this.ox;
    this.h = Math.min((range.row1 + 1) * TILE, tiles.height) - this.oy;
    this.labels = new Int32Array(this.w * this.h);
    this.exclude = new Uint8Array(this.w * this.h);
    /** Tiles pinned while the window lives, so that the page never drops a tile the window copies back into. @type {Set<number>} */
    this.pinned = new Set();
    for (let row = range.row0; row <= range.row1; row++) {
      for (let col = range.col0; col <= range.col1; col++) {
        const entry = tiles.get(row, col);
        this.pin(row, col);
        if (!entry || (!entry.labels && !entry.exclude)) continue;
        const x0 = col * TILE - this.ox, y0 = row * TILE - this.oy, cols = Math.min(TILE, this.w - x0), rows = Math.min(TILE, this.h - y0);
        for (let y = 0; y < rows; y++) {
          if (entry.labels) this.labels.set(entry.labels.subarray(y * TILE, y * TILE + cols), (y0 + y) * this.w + x0);
          if (entry.exclude) this.exclude.set(entry.exclude.subarray(y * TILE, y * TILE + cols), (y0 + y) * this.w + x0);
        }
      }
    }
    this.version = tiles.version;
  }
  /** @param {number} row @param {number} col */
  pin(row, col) {
    const i = this.tiles.index(row, col);
    if (this.pinned.has(i) || !this.tiles.entries.has(i)) return;
    this.tiles.pin(row, col); this.pinned.add(i);
  }
  /** Unpin the window's tiles (the window is no longer used). */
  release() {
    for (const i of this.pinned) this.tiles.unpin(Math.floor(i / this.tiles.cols), i % this.tiles.cols);
    this.pinned.clear();
  }
  /** Whether this window is the given range of these tiles and nothing else wrote them since. @param {MaskTiles} tiles @param {TileRange} range */
  matches(tiles, range) {
    const r = this.range;
    return this.tiles === tiles && this.version === tiles.version && r.row0 === range.row0 && r.row1 === range.row1 && r.col0 === range.col0 && r.col1 === range.col1;
  }
  /** The label at source pixel (x, y), or null outside the window. @param {number} x @param {number} y */
  labelAt(x, y) {
    const wx = Math.floor(x) - this.ox, wy = Math.floor(y) - this.oy;
    return wx >= 0 && wy >= 0 && wx < this.w && wy < this.h ? this.labels[wy * this.w + wx] : null;
  }
  /**
   * Copy a rectangle of the window (window pixels, inclusive) back into the tiles, which become dirty. Returns the tiles written.
   * `capture(row, col)` is called before a tile is written (the undo step copies it there, card M8.4.16 step 5).
   * @param {{x0: number, y0: number, x1: number, y1: number}} rect
   * @param {(row: number, col: number) => void} [capture]
   * @returns {[number, number][]}
   */
  writeBack(rect, capture) {
    const x0 = Math.max(0, Math.floor(rect.x0)), y0 = Math.max(0, Math.floor(rect.y0));
    const x1 = Math.min(this.w - 1, Math.ceil(rect.x1)), y1 = Math.min(this.h - 1, Math.ceil(rect.y1));
    const written = /** @type {[number, number][]} */ ([]);
    if (x1 < x0 || y1 < y0) return written;
    const tiles = this.tiles;
    for (let row = Math.floor((y0 + this.oy) / TILE); row <= Math.floor((y1 + this.oy) / TILE); row++) {
      for (let col = Math.floor((x0 + this.ox) / TILE); col <= Math.floor((x1 + this.ox) / TILE); col++) {
        capture?.(row, col);
        const entry = tiles.get(row, col), tx = col * TILE - this.ox, ty = row * TILE - this.oy;
        const part = { x0: Math.max(x0, tx), x1: Math.min(x1, tx + TILE - 1, this.w - 1), y0: Math.max(y0, ty), y1: Math.min(y1, ty + TILE - 1, this.h - 1) };
        // A layer the tile does not hold (all zeros, or a tile no longer in the page) is copied whole: the window is the truth for its tiles.
        const whole = { x0: Math.max(0, tx), x1: Math.min(tx + TILE - 1, this.w - 1), y0: Math.max(0, ty), y1: Math.min(ty + TILE - 1, this.h - 1) };
        const labels = entry?.labels || new Int32Array(TILE_PIXELS), exclude = entry?.exclude || new Uint8Array(TILE_PIXELS);
        this.copyInto(labels, this.labels, entry?.labels ? part : whole, tx, ty);
        this.copyInto(exclude, this.exclude, entry?.exclude ? part : whole, tx, ty);
        tiles.set(row, col, labels, exclude);
        this.pin(row, col);
        written.push([row, col]);
      }
    }
    this.version = tiles.version;
    return written;
  }
  /** @param {Int32Array | Uint8Array} tile @param {Int32Array | Uint8Array} window @param {{x0: number, x1: number, y0: number, y1: number}} r @param {number} tx @param {number} ty */
  copyInto(tile, window, r, tx, ty) {
    for (let y = r.y0; y <= r.y1; y++) {
      const from = y * this.w, to = (y - ty) * TILE - tx;
      tile.set(window.subarray(from + r.x0, from + r.x1 + 1), to + r.x0);
    }
  }
}

/**
 * The tiles whose statistics change when the source pixels of `rect` (inclusive) change: those within 3 pixels of it.
 * @param {{rows: number, cols: number}} grid @param {{x0: number, y0: number, x1: number, y1: number}} rect @returns {[number, number][]}
 */
export function affectedTiles(grid, rect) {
  const out = /** @type {[number, number][]} */ ([]);
  const row0 = Math.max(0, Math.floor((rect.y0 - STATS_MARGIN) / TILE)), row1 = Math.min(grid.rows - 1, Math.floor((rect.y1 + STATS_MARGIN) / TILE));
  const col0 = Math.max(0, Math.floor((rect.x0 - STATS_MARGIN) / TILE)), col1 = Math.min(grid.cols - 1, Math.floor((rect.x1 + STATS_MARGIN) / TILE));
  for (let row = row0; row <= row1; row++) for (let col = col0; col <= col1; col++) out.push([row, col]);
  return out;
}

/**
 * Statistics accumulated in other coordinates, moved by (ox, oy): the sums of x, y and their products are those of x + ox and y + oy.
 * @param {TraceStats} a @param {number} ox @param {number} oy @returns {TraceStats}
 */
export function shiftStats(a, ox, oy) {
  return { ...a, sx: a.sx + a.n * ox, sy: a.sy + a.n * oy, sxx: a.sxx + 2 * ox * a.sx + a.n * ox * ox, syy: a.syy + 2 * oy * a.sy + a.n * oy * oy,
    sxy: a.sxy + oy * a.sx + ox * a.sy + a.n * ox * oy, x0: a.x0 + ox, x1: a.x1 + ox, y0: a.y0 + oy, y1: a.y1 + oy };
}

/** The statistics of the union of two disjoint sets of pixels. @param {TraceStats} a @param {TraceStats} b @returns {TraceStats} */
export function addStats(a, b) {
  return { n: a.n + b.n, sx: a.sx + b.sx, sy: a.sy + b.sy, sxx: a.sxx + b.sxx, syy: a.syy + b.syy, sxy: a.sxy + b.sxy,
    x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1), per: a.per + b.per,
    sL: a.sL + b.sL, sLL: a.sLL + b.sLL, sA: a.sA + b.sA, sB: a.sB + b.sB, rL: a.rL + b.rL, rN: a.rN + b.rN };
}

/**
 * The contribution of the pixels of tile (row, col) to each object's statistics, in source coordinates: `objectStats` over the tile, on
 * arrays padded by 3 pixels from the neighbouring tiles so that edges and the surrounding contrast are those of the whole image.
 * @param {{width: number, height: number, stacks: number[][], labelsAt: (row: number, col: number) => Int32Array | null,
 *   rgbaAt: (row: number, col: number) => Uint8ClampedArray | Uint8Array | null}} source tiles of TILE x TILE (RGBA: 4 bytes per pixel)
 * @param {number} row @param {number} col
 * @returns {Map<number, TraceStats>}
 */
export function tileStats(source, row, col) {
  const centre = source.labelsAt(row, col);
  if (!centre) return new Map();
  const size = TILE + 2 * STATS_MARGIN, X0 = col * TILE - STATS_MARGIN, Y0 = row * TILE - STATS_MARGIN;
  const labels = new Int32Array(size * size), rgba = new Uint8ClampedArray(size * size * 4);
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const r = row + dr, c = col + dc;
      if (r < 0 || c < 0 || r * TILE >= source.height || c * TILE >= source.width) continue;
      const tileLabels = source.labelsAt(r, c), tileRgba = source.rgbaAt(r, c);
      const ax = Math.max(X0, c * TILE), bx = Math.min(X0 + size, (c + 1) * TILE), ay = Math.max(Y0, r * TILE), by = Math.min(Y0 + size, (r + 1) * TILE);
      for (let y = ay; y < by; y++) {
        const into = (y - Y0) * size - X0, from = (y - r * TILE) * TILE - c * TILE;
        if (tileLabels) labels.set(tileLabels.subarray(from + ax, from + bx), into + ax);
        if (tileRgba) rgba.set(tileRgba.subarray((from + ax) * 4, (from + bx) * 4), (into + ax) * 4);
      }
    }
  }
  const bounds = { x0: Math.max(0, -X0), y0: Math.max(0, -Y0), x1: Math.min(size, source.width - X0), y1: Math.min(size, source.height - Y0) };
  const region = { x0: STATS_MARGIN, y0: STATS_MARGIN, x1: Math.min(STATS_MARGIN + TILE, source.width - X0), y1: Math.min(STATS_MARGIN + TILE, source.height - Y0) };
  const out = new Map();
  for (const [id, a] of objectStats(labels, size, size, rgba, null, region, source.stacks, bounds)) out.set(id, shiftStats(a, X0, Y0));
  return out;
}

/** Per-tile statistics of every object of a tiled section and their totals. Tile indices are `row * cols + col`. */
export class TiledObjectStats {
  constructor() {
    /** @type {Map<number, Map<number, TraceStats>>} */
    this.byTile = new Map();
    /** @type {Map<number, Set<number>>} */
    this.tilesOf = new Map();
  }
  /** Replace the contributions of one tile; returns the ids whose totals changed. @param {number} tile @param {Map<number, TraceStats>} stats */
  replaceTile(tile, stats) {
    const changed = new Set();
    for (const id of this.byTile.get(tile)?.keys() || []) { changed.add(id); this.tilesOf.get(id)?.delete(tile); }
    if (stats.size) this.byTile.set(tile, stats); else this.byTile.delete(tile);
    for (const id of stats.keys()) {
      changed.add(id);
      let set = this.tilesOf.get(id);
      if (!set) this.tilesOf.set(id, set = new Set());
      set.add(tile);
    }
    for (const id of changed) if (!this.tilesOf.get(id)?.size) this.tilesOf.delete(id);
    return changed;
  }
  /** An object's statistics over the whole section, or null when it has no pixel. @param {number} id */
  total(id) {
    let sum = null;
    for (const tile of [...(this.tilesOf.get(id) || [])].sort((a, b) => a - b)) {
      const part = /** @type {TraceStats} */ (this.byTile.get(tile)?.get(id));
      sum = sum ? addStats(sum, part) : part;
    }
    return sum;
  }
}

/**
 * Recomputes the statistics of queued tiles one after another, between frames: it reads the level-0 pixels it needs (the tile and its
 * neighbours) through `fetchRgba`, keeps them in a small cache, reads the labels as they are when the tile's turn comes (so a later edit is
 * never undone by an older computation), and reports the objects whose totals changed.
 */
export class TiledStatsRunner {
  /**
   * @param {{tiles: MaskTiles, stats: TiledObjectStats, stacks: () => number[][],
   *   fetchRgba: (positions: [number, number][]) => Promise<(Uint8ClampedArray | Uint8Array)[]>,
   *   onUpdate: (ids: Set<number>) => void, onError?: (error: any) => void, cacheTiles?: number,
   *   loadMasks?: (positions: [number, number][]) => Promise<void>}} options `loadMasks` brings back mask tiles the page dropped
   *   (`MaskLoader.want`); a tile is never computed while it or a neighbour is not in the page.
   */
  constructor({ tiles, stats, stacks, fetchRgba, onUpdate, onError = () => {}, cacheTiles = 48, loadMasks = async () => {} }) {
    this.tiles = tiles; this.stats = stats; this.stacks = stacks; this.fetchRgba = fetchRgba; this.onUpdate = onUpdate; this.onError = onError;
    this.loadMasks = loadMasks;
    this.cacheTiles = cacheTiles;
    /** @type {Map<number, Uint8ClampedArray | Uint8Array>} */
    this.rgba = new Map();
    /** @type {Set<number>} */
    this.pending = new Set();
    /** Tiles whose computation failed (a tile or pixels could not be read): queued again with the next request. @type {Set<number>} */
    this.failed = new Set();
    /** @type {Set<number>} ids to report even when no tile holds them any more (a new object never painted) */
    this.ids = new Set();
    /** @type {Promise<void> | null} */
    this.running = null;
  }
  /** @param {[number, number][]} positions @param {Iterable<number>} [ids] */
  queue(positions, ids = []) {
    for (const [row, col] of positions) this.pending.add(this.tiles.index(row, col));
    if (positions.length) { for (const tile of this.failed) this.pending.add(tile); this.failed.clear(); }
    for (const id of ids) this.ids.add(id);
    if (!this.running) this.running = this.run().finally(() => { this.running = null; if (this.pending.size || this.ids.size) this.queue([]); });
    return this.running;
  }
  get idle() { return !this.running && !this.pending.size; }
  /** Compute again the tiles whose computation failed (for example once the engine is back). */
  retry() { return this.failed.size ? this.queue([...this.failed].map((i) => [Math.floor(i / this.tiles.cols), i % this.tiles.cols])) : Promise.resolve(); }
  async run() {
    const cols = this.tiles.cols;
    while (this.pending.size) {
      const tile = /** @type {number} */ (this.pending.values().next().value);
      this.pending.delete(tile);
      const row = Math.floor(tile / cols), col = tile % cols;
      try {
        const around = /** @type {[number, number][]} */ ([]);
        for (let r = row - 1; r <= row + 1; r++) for (let c = col - 1; c <= col + 1; c++) if (r >= 0 && c >= 0 && r < this.tiles.rows && c < cols) around.push([r, c]);
        await this.loadMasks(around);
        if (around.some(([r, c]) => this.tiles.state(r, c) === 'missing')) throw new Error('mask tile not loaded');
        if (this.tiles.get(row, col)?.labels) await this.loadPixels(row, col);
        const changed = this.stats.replaceTile(tile, tileStats({ width: this.tiles.width, height: this.tiles.height, stacks: this.stacks(),
          labelsAt: (r, c) => this.tiles.get(r, c)?.labels || null, rgbaAt: (r, c) => this.rgba.get(r * cols + c) || null }, row, col));
        for (const id of changed) this.ids.add(id);
      } catch (error) { this.failed.add(tile); this.onError(error); }
      if (!this.pending.size || this.ids.size > 256) { const ids = this.ids; this.ids = new Set(); if (ids.size) this.onUpdate(ids); }
      await new Promise((resolve) => setTimeout(resolve, 0));         // let the page draw and take input between tiles
    }
    if (this.ids.size) { const ids = this.ids; this.ids = new Set(); this.onUpdate(ids); }
  }
  /** The level-0 pixels of a tile and of its neighbours that hold image. @param {number} row @param {number} col */
  async loadPixels(row, col) {
    const cols = this.tiles.cols, want = /** @type {[number, number][]} */ ([]);
    for (let r = row - 1; r <= row + 1; r++) for (let c = col - 1; c <= col + 1; c++) {
      if (r >= 0 && c >= 0 && r < this.tiles.rows && c < cols && !this.rgba.has(r * cols + c)) want.push([r, c]);
    }
    if (want.length) {
      const read = await this.fetchRgba(want);
      want.forEach(([r, c], k) => { this.rgba.delete(r * cols + c); this.rgba.set(r * cols + c, read[k]); });
    }
    for (let r = row - 1; r <= row + 1; r++) for (let c = col - 1; c <= col + 1; c++) {      // most recently used last
      const i = r * cols + c, value = this.rgba.get(i);
      if (value) { this.rgba.delete(i); this.rgba.set(i, value); }
    }
    while (this.rgba.size > this.cacheTiles) this.rgba.delete(/** @type {number} */ (this.rgba.keys().next().value));
  }
}
