// @ts-check
// Undo and redo on the masks of a tiled section (card M8.4.16 step 5, decision C of the card). No DOM: tested in Node.
//
// An edit of a tiled section keeps no pixel log (a large brush at full resolution writes millions of pixels). Instead its undo step keeps a
// copy of each mask tile it changed, taken just before the edit first wrote that tile (`TileChanges.capture`). Undo and redo swap those copies
// with the tiles in the page (`TileChanges.swap`), so a step always holds the other state of its tiles. The tiles of all such steps share one
// budget (`UNDO_TILE_BYTES`); beyond it the oldest steps are dropped (`trimTileHistory`).

import { LABEL_BYTES, EXCLUDE_BYTES } from './tiledmasks.js';

export const UNDO_TILE_BYTES = 64 * 2 ** 20;           // decision C: the tile copies kept by the undo history of the page

/** @typedef {import('./tiledmasks.js').MaskTiles} MaskTiles */
/** @typedef {{labels: Int32Array | null, exclude: Uint8Array | null}} TileLayers `null` layers are all zeros */

/** @param {TileLayers | undefined} layers */
const layerBytes = (layers) => (layers?.labels ? LABEL_BYTES : 0) + (layers?.exclude ? EXCLUDE_BYTES : 0);

/** The tiles one edit changed, as they were before it (or, after an undo, as they were after it). Positions are `row * cols + col`. */
export class TileChanges {
  /** @param {MaskTiles} tiles */
  constructor(tiles) {
    this.tiles = tiles;
    /** @type {Map<number, TileLayers>} */
    this.saved = new Map();
    /** Memory the step may hold in either state, set by `seal` (the larger of the two). */
    this.bytes = 0;
  }
  /**
   * Copy a tile before the edit first writes it; later writes of the same tile keep the first copy. The tile must be in the page.
   * @param {number} row @param {number} col
   */
  capture(row, col) {
    const i = this.tiles.index(row, col);
    if (this.saved.has(i)) return;
    if (this.tiles.state(row, col) === 'missing') throw new Error('mask tile not loaded');
    const entry = this.tiles.entries.get(i);
    this.saved.set(i, { labels: entry?.labels ? entry.labels.slice() : null, exclude: entry?.exclude ? entry.exclude.slice() : null });
  }
  /** Whether the edit wrote any tile. */
  get empty() { return this.saved.size === 0; }
  /** @returns {[number, number][]} the positions of the tiles this step holds */
  positions() {
    const cols = this.tiles.cols;
    return [...this.saved.keys()].map((i) => [Math.floor(i / cols), i % cols]);
  }
  /** The edit is finished: its size is the larger of the copies and of the tiles as the edit left them (what an undo will keep). */
  seal() {
    let before = 0, after = 0;
    for (const [i, layers] of this.saved) { before += layerBytes(layers); after += layerBytes(this.tiles.entries.get(i)); }
    this.bytes = Math.max(before, after);
    return this;
  }
  /** Positions of this step's tiles that the page dropped (they must be read back before `swap`). @returns {[number, number][]} */
  missing() {
    return this.positions().filter(([row, col]) => this.tiles.state(row, col) === 'missing');
  }
  /**
   * Undo or redo: put the kept tiles in the page (as unacknowledged edits) and keep the page's tiles instead. Throws, changing nothing, when a
   * tile is not in the page. @returns {[number, number][]} the positions swapped
   */
  swap() {
    if (this.missing().length) throw new Error('mask tile not loaded');
    const out = this.positions();
    for (const [row, col] of out) {
      const i = this.tiles.index(row, col), entry = this.tiles.entries.get(i), kept = /** @type {TileLayers} */ (this.saved.get(i));
      // The page's arrays move into the step as they are: after `set` the page holds the kept arrays and nothing else writes the old ones.
      this.saved.set(i, { labels: entry?.labels || null, exclude: entry?.exclude || null });
      this.tiles.set(row, col, kept.labels, kept.exclude);
    }
    return out;
  }
}

/**
 * Drop the oldest steps (whole groups) until the tile copies of `steps` fit `budget`; the newest step is always kept, even when it is larger.
 * Steps without tile copies count nothing. Returns how many steps were dropped.
 * @param {{group?: string, tiles?: TileChanges}[]} steps oldest first
 * @param {number} [budget]
 */
export function trimTileHistory(steps, budget = UNDO_TILE_BYTES) {
  const size = (/** @type {{tiles?: TileChanges}} */ step) => step.tiles?.bytes || 0;
  let bytes = steps.reduce((total, step) => total + size(step), 0), first = 0;
  while (bytes > budget) {
    const group = steps[first].group;
    let end = first + 1;
    while (group && steps[end]?.group === group) end++;
    if (end === steps.length) break;
    for (; first < end; first++) bytes -= size(steps[first]);
  }
  steps.splice(0, first);
  return first;
}
