// @ts-check
// The saved record of a tiled section and the row window it may cover (card M8.4.42, decisions X2a and X4). Pure: no DOM, tested in Node.
//
// A section with a window covers only source rows [y0, y1) of its stored image: its masks, objects, statistics, row counts and depths are in the
// window's coordinates (row 0 of the section is source row y0), exactly as for a section made from a source holding only those rows. Only the
// reads of the pyramid translate: level-0 tile rows shift by y0 / TILE, and the working image is cut from its level. The window starts on a mask-tile
// boundary (a multiple of 512 source rows) and on a working-image pixel (a multiple of 2^level), so both translations are whole tiles or pixels.
import { TILE } from './tiledsection.js';

/** Card M8.4.42 (X4): a project with a section that has a window is saved with this version, so an older SedCoreTool opens it read-only. */
export const FORMAT_VERSION_WINDOW = 7;

/**
 * Whether the window of a tiled record (if any) is one this program can draw: whole integers, starting on a mask-tile boundary and on a
 * working-image pixel, as tall as the record's masks. A record without a window is valid here.
 * @param {any} r the `tiled` object of a saved section
 */
export function validWindow(r) {
  if (r?.window === undefined) return true;
  const w = r.window;
  return !!w && typeof w === 'object' && Number.isSafeInteger(w.y0) && Number.isSafeInteger(w.y1) && w.y0 >= 0 && w.y1 > w.y0
    && w.y0 % TILE === 0 && w.y0 % 2 ** r.level === 0 && w.y1 - w.y0 === r.height;
}

/** The `tiled` object of a saved section, as this program reads it (moved from tiledproject.js; card M8.4.42 adds the window). @param {any} r */
export const validTiledRecord = (r) => !!r && r.version === 1 && r.store === 2 && /^[0-9a-f]{64}$/.test(r.manifest || '') && /^[0-9a-f]{64}$/.test(r.source?.sha256 || '')
  && Number.isSafeInteger(r.width) && r.width > 0 && Number.isSafeInteger(r.height) && r.height > 0 && Number.isSafeInteger(r.level) && r.level >= 0
  && validWindow(r);

/**
 * Whether a saved record fits the pyramid the engine has: the same width, and the window (or the whole record) within its height.
 * @param {any} r the `tiled` object of a saved section @param {{width: number, height: number}} info the pyramid's level 0
 */
export function recordFitsPyramid(r, info) {
  const { window: win } = r;          // the record's row window (read so, the architecture test reserves `window.` for the browser's object)
  return info.width === r.width && (win ? win.y1 <= info.height : info.height === r.height);
}

/**
 * The record of a tiled section (card M8.4.18a; moved from app.js by card M8.4.42): like any section, without the mask arrays, which are in the
 * engine's store under `manifest`, and with the overlap stacks as they are (a tiled section never renumbers them, card M8.4.17). `manifest` must hold
 * every edit of the section. The window is written only for a section that has one (X4), so every other record stays as it was, byte for byte.
 * @param {any} s @param {string} manifest
 */
export function serTiledSection(s, manifest) {
  const o2 = (o) => ({ id: o.id, cls: o.cls, src: o.src, ...(o.nt ? { nt: 1 } : {}), ...(o.stats ? { st: o.stats } : {}), ...(o.cls && o._thumb ? { th: o._thumb } : {}), ...(o.emb ? { em: o.emb } : {}) });
  const win = s.tiled.window;
  return {
    id: s.id, name: s.name, ds: s.ds, rot: 0, w: s.w, h: s.h, crop: null, full: s.full || null,
    file: { name: s.file.name, type: s.file.type, tiled: true },
    top: s.top, bottom: s.bottom, units: s.units, roi: s.roi, filters: s.filters, preset: s.preset, detect: s.detect, manual: s.manual,
    nextId: s.nextId, objects: [...s.objects.values()].map(o2), stacks: s.stacks, marks: s.marks || [],
    tiled: { version: 1, store: 2, manifest, width: s.maskTiles.width, height: s.maskTiles.height, level: s.tiled.level,
      source: { sha256: s.tiled.pyramid, size: s.tiled.source?.size ?? null, name: s.tiled.source?.name ?? s.file.name },
      ...(win ? { window: { y0: win.y0, y1: win.y1 } } : {}) },
  };
}

/**
 * The format version of a project whose sections are saved as `records` (X4): 7 when one of them has a window, otherwise `tiled` when the project has
 * a tiled section (6, card M8.4.18a) and `plain` (5) when it has none.
 * @param {any[]} records @param {boolean} tiledInside @param {number} plain @param {number} tiled
 */
export const projectFormatVersion = (records, tiledInside, plain, tiled) => (records.some((q) => q?.tiled?.window) ? FORMAT_VERSION_WINDOW : tiledInside ? tiled : plain);

/** A project written by a newer SedCoreTool than one that knows formats up to `newestKnown` opens read-only (V0.36). @param {any} version @param {number} newestKnown */
export const opensReadOnly = (version, newestKnown) => (Number(version) || 0) > newestKnown;

/** The first source row of a tiled section's window (0 without one). @param {any} tiled */
export const windowTop = (tiled) => { const { window: win } = tiled; return win ? win.y0 : 0; };

/**
 * Level-0 tile positions of a section (its mask-tile grid) as positions of the pyramid: the rows shift by the window's first tile row.
 * @param {any} tiled @param {[number, number][]} positions @returns {[number, number][]}
 */
export function pyramidPositions(tiled, positions) {
  const shift = windowTop(tiled) / TILE;
  return shift ? positions.map(([row, col]) => [row + shift, col]) : positions;
}

/**
 * One level-0 tile's samples as a section with a window sees them: rows of the tile below the window's last row are zero, as the padding of a
 * source that ends there. `row` is the tile row in the section's grid. The bytes are returned unchanged when the whole tile is inside.
 * @param {any} tiled @param {number} row @param {Uint8Array} bytes @param {number} channels @param {number} bits
 */
export function windowTileBytes(tiled, row, bytes, channels, bits) {
  const win = tiled.window;
  if (!win) return bytes;
  const keep = win.y1 - win.y0 - row * TILE;
  if (keep >= TILE) return bytes;
  const out = bytes.slice();
  out.fill(0, Math.max(0, keep) * TILE * channels * (bits / 8));
  return out;
}

/**
 * The part of pyramid level `k` that the working image of a section with a window uses: tile rows `row0`-`row1` read, then rows `cropY` to
 * `cropY + height` of what they assemble into. `height` is the height of level k of a source holding only the window's rows (ceil of the window's
 * height / 2^k, as `pyramid.halve` reduces). Null without a window (the whole level is used).
 * @param {{width: number, height: number, rows: number, cols: number}} level @param {number} k @param {{y0: number, y1: number} | undefined} win
 */
export function workingBand(level, k, win) {
  if (!win) return null;
  const factor = 2 ** k, top = win.y0 / factor, height = Math.ceil((win.y1 - win.y0) / factor);
  if (!Number.isInteger(top) || top + height > level.height) throw new Error('the window does not fit the pyramid level');
  const row0 = Math.floor(top / TILE), row1 = Math.floor((top + height - 1) / TILE);
  return { row0, row1, cropY: top - row0 * TILE, height,
    level: { width: level.width, height: Math.min(level.height, (row1 + 1) * TILE) - row0 * TILE, rows: row1 - row0 + 1, cols: level.cols } };
}

/** Every tile position of a band's rows, in pyramid coordinates. @param {{row0: number, row1: number, level: {cols: number}}} band @returns {[number, number][]} */
export function bandPositions(band) {
  const out = /** @type {[number, number][]} */ ([]);
  for (let row = band.row0; row <= band.row1; row++) for (let col = 0; col < band.level.cols; col++) out.push([row, col]);
  return out;
}

/**
 * Rows `y` to `y + h` of an assembled image (8-bit RGBA, and 16-bit RGBA when present).
 * @param {{w: number, h: number, rgba: Uint8ClampedArray, rgba16: Uint16Array | null}} image @param {number} y @param {number} h
 */
export function cropRows(image, y, h) {
  const a = y * image.w * 4, b = (y + h) * image.w * 4;
  return { w: image.w, h, rgba: image.rgba.slice(a, b), rgba16: image.rgba16 ? image.rgba16.slice(a, b) : null };
}
