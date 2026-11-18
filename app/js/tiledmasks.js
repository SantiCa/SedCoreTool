// @ts-check
// Masks of tiled sections in the page (card M8.4.16 step 2, decisions C-D of the card). No DOM: tested in Node.
//
// The labels (i32) and exclusion (u8) of a tiled section live at full resolution in tiles of TILE x TILE source pixels, on the grid of level 0
// of its pixel pyramid (contract §8.7). The page keeps the tiles it uses in a `MaskTiles` cache: a tile changed in the page and not yet
// acknowledged by the engine is *dirty* and is never dropped (it exists nowhere else); a *pinned* tile is in use and is not dropped either;
// any other tile can be dropped and read again from the engine. The section's working image keeps a reduced copy of the masks for the overview
// (`reduceTile`: the label of the source pixel at the top-left of each working pixel); nothing is counted from it. At fine zoom the viewer
// paints the full-resolution masks over the pixel tiles (`paintOverlay`), with the colours and edges of today's viewer.

import { TILE } from './tiledsection.js';

export const MASK_CACHE_BYTES = 128 * 2 ** 20;      // clean (re-readable) tiles kept per section
export const LABEL_BYTES = TILE * TILE * 4;
export const EXCLUDE_BYTES = TILE * TILE;
const OUTSIDE = -2147483648;                         // a neighbour outside the image or the grid (never a label: stacks are small)

/** @param {ArrayLike<number> | null} array @returns {boolean} true when every value is 0 (or there is no array) */
export function isEmptyLayer(array) {
  if (!array) return true;
  for (let i = 0; i < array.length; i++) if (array[i] !== 0) return false;
  return true;
}

/**
 * @typedef {{labels: Int32Array | null, exclude: Uint8Array | null, dirty: boolean, pins: number, bytes: number, edit: number}} MaskTile
 * `null` layers are all zeros. `edit` counts the times the tile was set, so a send knows whether the tile changed after it was copied.
 */

/** The mask tiles of one tiled section that the page holds. Positions are `row * cols + col` on the level-0 grid. */
export class MaskTiles {
  /** @param {{width: number, height: number, budget?: number}} options source size in pixels */
  constructor({ width, height, budget = MASK_CACHE_BYTES }) {
    if (!(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0)) throw new Error('mask size');
    this.width = width; this.height = height; this.budget = budget;
    this.rows = Math.ceil(height / TILE); this.cols = Math.ceil(width / TILE);
    /** @type {Map<number, MaskTile>} least recently used first */
    this.entries = new Map();
    /** Positions with a stored layer in the version the engine acknowledged; a position neither here nor cached is empty. @type {Set<number>} */
    this.stored = new Set();
    this.bytes = 0;
    /** Changes with every `set`, so that a copy of the tiles (an edit window) knows whether it is still current. */
    this.version = 0;
  }
  /** @param {number} row @param {number} col */
  index(row, col) {
    if (!(Number.isInteger(row) && Number.isInteger(col) && row >= 0 && row < this.rows && col >= 0 && col < this.cols)) throw new Error('mask tile position');
    return row * this.cols + col;
  }
  /** 'loaded' (in the page), 'empty' (all zeros, nothing to read) or 'missing' (stored in the engine, not in the page). @param {number} row @param {number} col */
  state(row, col) {
    const i = this.index(row, col);
    return this.entries.has(i) ? 'loaded' : this.stored.has(i) ? 'missing' : 'empty';
  }
  /** The tile, most recently used now; undefined when not loaded. @param {number} row @param {number} col */
  get(row, col) {
    const i = this.index(row, col), entry = this.entries.get(i);
    if (entry) { this.entries.delete(i); this.entries.set(i, entry); }
    return entry;
  }
  /**
   * Put a tile in the page. `dirty` (the default) marks a change the engine has not acknowledged; `false` is a tile read from the engine.
   * All-zero layers are kept as null. Returns the positions dropped to respect the budget.
   * @param {number} row @param {number} col @param {Int32Array | null} labels @param {Uint8Array | null} exclude @param {{dirty?: boolean}} [options]
   */
  set(row, col, labels, exclude, { dirty = true } = {}) {
    if (labels && labels.length !== TILE * TILE) throw new Error('labels tile size');
    if (exclude && exclude.length !== TILE * TILE) throw new Error('exclusion tile size');
    const i = this.index(row, col), old = this.entries.get(i);
    if (!dirty && old?.dirty) return [];                    // a read never replaces an edit the engine has not acknowledged
    const kept = { labels: isEmptyLayer(labels) ? null : labels, exclude: isEmptyLayer(exclude) ? null : exclude };
    const bytes = (kept.labels ? LABEL_BYTES : 0) + (kept.exclude ? EXCLUDE_BYTES : 0);
    if (old) { this.bytes -= old.bytes; this.entries.delete(i); }
    this.entries.set(i, { ...kept, dirty, pins: old?.pins || 0, bytes, edit: (old?.edit || 0) + 1 });
    this.bytes += bytes;
    this.version++;
    return this.evict();
  }
  /**
   * The engine acknowledged a version containing these tiles as the page holds them: they are clean (may be dropped and read again), and the
   * positions with a stored layer are remembered. @param {[number, number][]} positions
   */
  acknowledge(positions) {
    for (const [row, col] of positions) {
      const i = this.index(row, col), entry = this.entries.get(i);
      if (!entry) continue;
      entry.dirty = false;
      if (entry.labels || entry.exclude) this.stored.add(i); else this.stored.delete(i);
    }
    return this.evict();
  }
  /**
   * The label at source pixel (x, y): 0 for an empty tile, null when the tile is stored in the engine but not in the page, or outside.
   * @param {number} x @param {number} y
   */
  labelAt(x, y) {
    if (!(x >= 0 && y >= 0 && x < this.width && y < this.height)) return null;
    const row = Math.floor(y / TILE), col = Math.floor(x / TILE), i = row * this.cols + col, entry = this.entries.get(i);
    if (!entry) return this.stored.has(i) ? null : 0;
    return entry.labels ? entry.labels[(Math.floor(y) - row * TILE) * TILE + Math.floor(x) - col * TILE] : 0;
  }
  /** @param {number} row @param {number} col */
  pin(row, col) { const entry = this.entries.get(this.index(row, col)); if (entry) entry.pins++; }
  /** @param {number} row @param {number} col */
  unpin(row, col) { const entry = this.entries.get(this.index(row, col)); if (entry && entry.pins > 0) entry.pins--; }
  /** Positions [row, col] of the tiles not acknowledged yet, in the order they were last used. */
  dirtyPositions() {
    const out = /** @type {[number, number][]} */ ([]);
    for (const [i, entry] of this.entries) if (entry.dirty) out.push([Math.floor(i / this.cols), i % this.cols]);
    return out;
  }
  /** Whether any layer of the section is non-zero, in the page or in the engine. */
  hasContent() {
    if (this.stored.size) return true;
    for (const entry of this.entries.values()) if (entry.labels || entry.exclude) return true;
    return false;
  }
  /** Drop clean, unpinned tiles, least recently used first, until the budget holds; dirty and pinned tiles always stay. @returns {[number, number][]} */
  evict() {
    const dropped = /** @type {[number, number][]} */ ([]);
    for (const [i, entry] of this.entries) {
      if (this.bytes <= this.budget) break;
      if (entry.dirty || entry.pins) continue;
      this.entries.delete(i); this.bytes -= entry.bytes;
      dropped.push([Math.floor(i / this.cols), i % this.cols]);
    }
    return dropped;
  }
}

/**
 * Write one tile into the section's reduced masks (decision D): working pixel (wx, wy) of a working image at `ds` source pixels per working
 * pixel takes the value of source pixel (wx * ds, wy * ds). Only the working pixels whose top-left source pixel lies in this tile change.
 * @param {{w: number, h: number, labels: Int32Array, exclude: Uint8Array}} working
 * @param {number} ds a power of two @param {number} row @param {number} col
 * @param {Int32Array | null} labels @param {Uint8Array | null} exclude null: all zeros
 */
export function reduceTile(working, ds, row, col, labels, exclude) {
  const x0 = col * TILE, y0 = row * TILE;
  const wx0 = Math.ceil(x0 / ds), wx1 = Math.min(working.w, Math.ceil((x0 + TILE) / ds));
  const wy0 = Math.ceil(y0 / ds), wy1 = Math.min(working.h, Math.ceil((y0 + TILE) / ds));
  for (let wy = wy0; wy < wy1; wy++) {
    const ty = wy * ds - y0, out = wy * working.w;
    for (let wx = wx0; wx < wx1; wx++) {
      const t = ty * TILE + wx * ds - x0;
      working.labels[out + wx] = labels ? labels[t] : 0;
      working.exclude[out + wx] = exclude ? exclude[t] : 0;
    }
  }
}

/**
 * Where the screen pixels along one axis fall in a grid of tiles. Screen pixel `s` shows source coordinate `floor(origin + (s + 0.5) * scale)`
 * (plus `delta`, for the neighbour `delta` source pixels away); `tile` is its tile index counted from tile `first` (-1 outside [0, extent) or
 * outside the `count` tiles of the grid) and `off` its offset inside that tile.
 * @param {number} n screen pixels @param {number} origin @param {number} scale source pixels per screen pixel @param {number} extent
 * @param {number} first @param {number} count @param {number} size tile size along the axis @param {number} [delta]
 */
export function axisMap(n, origin, scale, extent, first, count, size, delta = 0) {
  const tile = new Int32Array(n), off = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    const x = Math.floor(origin + (s + 0.5) * scale) + delta, t = Math.floor(x / size) - first;
    if (x < 0 || x >= extent || t < 0 || t >= count) { tile[s] = -1; continue; }
    tile[s] = t; off[s] = x - (t + first) * size;
  }
  return { tile, off };
}

/**
 * What the viewer paints over the pixel tiles of a tiled section: the screen rectangle of the analysis area's visible part and the arguments of
 * `paintOverlay` for it. At full resolution (`k` = 0) the masks come from the page's mask tiles (tiles not in the page count as empty until
 * card M8.4.16 step 4 reads them); between full resolution and the working image (0 < k < the working level) from the working image's reduced
 * masks. Null when nothing is visible or the section has no masks.
 * @param {{maskTiles: MaskTiles, levels: {width: number, height: number, rows: number, cols: number}[], ds: number, w: number, h: number,
 *   labels: Int32Array, exclude: Uint8Array}} section
 * @param {{x: number, y: number, zoom: number}} view working pixel at the top left, screen pixels per working pixel
 * @param {number} k pyramid level drawn @param {{x0: number, y0: number, x1: number, y1: number}} rect visible analysis area, working pixels
 * @param {number} viewWidth @param {number} viewHeight
 */
export function overlayLayout(section, view, k, rect, viewWidth, viewHeight) {
  if (!section.maskTiles.hasContent()) return null;
  const { x: vx, y: vy, zoom: z } = view, ds = section.ds;
  const sx0 = Math.max(0, Math.floor((rect.x0 - vx) * z)), sy0 = Math.max(0, Math.floor((rect.y0 - vy) * z));
  const cw = Math.min(viewWidth, Math.ceil((rect.x1 - vx) * z)) - sx0, ch = Math.min(viewHeight, Math.ceil((rect.y1 - vy) * z)) - sy0;
  if (cw <= 0 || ch <= 0) return null;
  /** @param {number} n @param {number} origin @param {number} scale @param {number} extent @param {number} first @param {number} count @param {number} size @param {number} step */
  const axis = (n, origin, scale, extent, first, count, size, step) => ({ at: axisMap(n, origin, scale, extent, first, count, size),
    before: axisMap(n, origin, scale, extent, first, count, size, -step), after: axisMap(n, origin, scale, extent, first, count, size, step) });
  if (k === 0) {
    const tiles = section.maskTiles, scale = ds / z, step = Math.max(1, Math.round(scale));
    const x0 = rect.x0 * ds, y0 = rect.y0 * ds, x1 = rect.x1 * ds, y1 = rect.y1 * ds;
    const row0 = Math.max(0, Math.floor(y0 / TILE) - 1), row1 = Math.min(tiles.rows - 1, Math.floor((y1 - 1) / TILE) + 1);
    const col0 = Math.max(0, Math.floor(x0 / TILE) - 1), col1 = Math.min(tiles.cols - 1, Math.floor((x1 - 1) / TILE) + 1);
    const labels = [], exclude = [];
    for (let row = row0; row <= row1; row++) {
      for (let col = col0; col <= col1; col++) { const entry = tiles.get(row, col); labels.push(entry?.labels || null); exclude.push(entry?.exclude || null); }
    }
    const cols = col1 - col0 + 1, rows = row1 - row0 + 1;
    return { sx0, sy0, cw, ch, xs: axis(cw, (vx + sx0 / z) * ds, scale, tiles.width, col0, cols, TILE, step),
      ys: axis(ch, (vy + sy0 / z) * ds, scale, tiles.height, row0, rows, TILE, step), gridCols: cols, stride: TILE, labels, exclude };
  }
  const scale = 1 / z, step = Math.max(1, Math.round(scale));
  return { sx0, sy0, cw, ch, xs: axis(cw, vx + sx0 / z, scale, section.w, 0, 1, section.w, step), ys: axis(ch, vy + sy0 / z, scale, section.h, 0, 1, section.h, step),
    gridCols: 1, stride: section.w, labels: [section.labels], exclude: [section.exclude] };
}

/**
 * @typedef {{tile: Int32Array, off: Int32Array}} Axis
 * @typedef {{at: Axis, before: Axis, after: Axis}} AxisWithNeighbours `before`/`after`: the source pixel `step` before and after
 * @typedef {{fill: ArrayLike<number>, line: ArrayLike<number>, sty: ArrayLike<number>, stacks: number[][], selected: number | null,
 *   inSel: ArrayLike<number>}} OverlayStyle the viewer's colour tables (`rebuildLUT` in app.js) and selection
 */

/**
 * Paint the masks of a grid of tiles as an RGBA layer to draw over the pixels (source-over), with the colours of today's viewer: each object's
 * fill at its alpha (overlaps bottom to top), its edge opaque (white when selected; predicted objects dashed; hidden objects skipped), and the
 * exclusion hatching. Drawing this layer over a pixel gives what `render()` in app.js computes for that pixel. Pixels without masks stay
 * transparent. A pixel is on an edge when the source pixel `step` before or after it, in x or in y, does not hold the object (or lies outside).
 * @param {{out: Uint8ClampedArray, cw: number, ch: number, xs: AxisWithNeighbours, ys: AxisWithNeighbours, gridCols: number, stride: number,
 *   labels: (Int32Array | null)[], exclude: (Uint8Array | null)[], style: OverlayStyle, px0?: number, py0?: number}} p
 *   `labels[t]`/`exclude[t]` of tile `t = ys tile * gridCols + xs tile`; offsets inside a tile are `y * stride + x`. `px0`, `py0`: the screen
 *   position of the layer's first pixel, so that dashes and hatching follow the screen as in `render()`.
 */
export function paintOverlay(p) {
  const { out, cw, ch, xs, ys, gridCols, stride, labels, exclude, px0 = 0, py0 = 0 } = p, { fill, line, sty, stacks, selected, inSel } = p.style;
  const words = new Uint32Array(out.buffer, out.byteOffset, cw * ch);     // one RGBA pixel per write (little-endian: r in the low byte)
  const pixel = new Uint8ClampedArray(4), pixelWord = new Uint32Array(pixel.buffer);
  /** The RGBA word of a premultiplied colour, rounded as an ImageData assignment rounds it. */
  const word = (/** @type {number} */ r, /** @type {number} */ g, /** @type {number} */ b, /** @type {number} */ a) => {
    if (a === 0) return 0;
    pixel[0] = r / a; pixel[1] = g / a; pixel[2] = b / a; pixel[3] = a * 255;
    return pixelWord[0];
  };
  // Exclusion, today: hatching r*0.3+70 (b: +80) on 2 of every 8 diagonals, else r*0.55; as layers: (100, 100, 114.3) at 0.7, black at 0.45.
  const HATCH = word(70, 70, 80, 0.7), DARK = word(0, 0, 0, 0.45);
  // The inside of one object (no edge), alone, over hatching and over darkening: computed once per object and call.
  const ids = fill.length >> 2, known = new Uint8Array(ids), inside = new Uint32Array(ids * 3);
  const insideWord = (/** @type {number} */ id, /** @type {number} */ variant) => {
    if (!known[id]) {
      known[id] = 1;
      const k = id * 4, alpha = sty[id] === 3 ? 0 : fill[k + 3] / 255;
      const r = fill[k] * alpha, g = fill[k + 1] * alpha, b = fill[k + 2] * alpha;
      inside[id * 3] = word(r, g, b, alpha);
      inside[id * 3 + 1] = word(70 + r * 0.3, 70 + g * 0.3, 80 + b * 0.3, 0.7 + alpha * 0.3);
      inside[id * 3 + 2] = word(r * 0.55, g * 0.55, b * 0.55, 0.45 + alpha * 0.55);
    }
    return inside[id * 3 + variant];
  };
  const xt = xs.at.tile, xo = xs.at.off, xbt = xs.before.tile, xbo = xs.before.off, xat = xs.after.tile, xao = xs.after.off;
  /** The label of a neighbour: tile column `tx` of the grid row starting at `base`, offset `at`; OUTSIDE when it lies outside. */
  const sample = (/** @type {number} */ base, /** @type {number} */ tx, /** @type {number} */ at) => {
    if (base < 0 || tx < 0) return OUTSIDE;
    const layer = labels[base + tx];
    return layer ? layer[at] : 0;
  };
  const own = (/** @type {number} */ w, /** @type {number} */ id) => w === id || (w < 0 && w !== OUTSIDE && stacks[-w].includes(id));
  for (let sy = 0, o = 0; sy < ch; sy++) {
    const ty = ys.at.tile[sy];
    if (ty < 0) { words.fill(0, o, o + cw); o += cw; continue; }
    const base = ty * gridCols, row = ys.at.off[sy] * stride;
    const up = ys.before.tile[sy], upBase = up < 0 ? -1 : up * gridCols, upRow = ys.before.off[sy] * stride;
    const down = ys.after.tile[sy], downBase = down < 0 ? -1 : down * gridCols, downRow = ys.after.off[sy] * stride;
    for (let sx = 0; sx < cw; sx++, o++) {
      const tx = xt[sx];
      if (tx < 0) { words[o] = 0; continue; }
      const lab = labels[base + tx], exl = exclude[base + tx];
      if (!lab && !exl) { words[o] = 0; continue; }
      const at = row + xo[sx], v = lab ? lab[at] : 0, ex = exl ? exl[at] : 0;
      const phase = sx + px0 + sy + py0, variant = ex ? ((phase & 7) < 2 ? 1 : 2) : 0;
      if (!v) { words[o] = variant === 0 ? 0 : variant === 1 ? HATCH : DARK; continue; }
      // The four neighbours once per pixel; an id is on an edge only where a neighbour differs from this pixel and does not hold it.
      // Most neighbours lie in the same tile: read them directly (`lab` is set, v is not 0).
      const label = /** @type {Int32Array} */ (lab), bt = xbt[sx], ft = xat[sx];
      const left = bt === tx ? label[row + xbo[sx]] : sample(base, bt, row + xbo[sx]), right = ft === tx ? label[row + xao[sx]] : sample(base, ft, row + xao[sx]);
      const above = up === ty ? label[upRow + xo[sx]] : sample(upBase, tx, upRow + xo[sx]), below = down === ty ? label[downRow + xo[sx]] : sample(downBase, tx, downRow + xo[sx]);
      if (v > 0 && left === v && right === v && above === v && below === v) { words[o] = insideWord(v, variant); continue; }
      let r = 0, g = 0, b = 0, a = 0;                       // premultiplied
      const list = v < 0 ? stacks[-v] : null;
      for (let q = 0, n = list ? list.length : 1; q < n; q++) {
        const id = list ? list[q] : v;
        if (sty[id] === 3) continue;
        const k = id * 4, alpha = fill[k + 3] / 255;
        if (alpha) { const keep = 1 - alpha; r = fill[k] * alpha + r * keep; g = fill[k + 1] * alpha + g * keep; b = fill[k + 2] * alpha + b * keep; a = alpha + a * keep; }
        const edge = (left !== v && !own(left, id)) || (right !== v && !own(right, id)) || (above !== v && !own(above, id)) || (below !== v && !own(below, id));
        if (edge) {
          if (id === selected || inSel[id]) { r = 255; g = 255; b = 255; a = 1; }
          else if (sty[id] !== 1 || (phase & 4)) { r = line[k]; g = line[k + 1]; b = line[k + 2]; a = 1; }
        }
      }
      if (variant) {
        const hatch = variant === 1, alpha = hatch ? 0.7 : 0.45, keep = 1 - alpha;
        r = (hatch ? 70 : 0) + r * keep; g = (hatch ? 70 : 0) + g * keep; b = (hatch ? 80 : 0) + b * keep; a = alpha + a * keep;
      }
      words[o] = word(r, g, b, a);
    }
  }
}
