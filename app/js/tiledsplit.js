// @ts-check
// Splitting a tiled section into parts along mask-tile boundaries (card M8.4.43, decisions X1-X4). Pure: no DOM, tested in Node.
//
// Each part covers a contiguous range of mask-tile rows [row0, row1) of the original section, aligned to both TILE (512) and 2^level
// (working-image pixels, as `validWindow` in tiledrecord.js requires). Depths are mapped linearly from the original analysis area so that
// adjacent parts meet at the exact same boundary depth; the analysis area, identification marks and manual index ranges are partitioned across
// the parts; object metadata and overlap stacks are filtered to what `mask.slice` found present in each part's tiles.
import { TILE } from './tiledsection.js';
import { STATS_SPLIT_MAX_PARTS, partsToFitStats } from './tiledit.js';
import { windowTop } from './tiledrecord.js';

/**
 * Maximum number of parts a tiled section of `height` source pixels at pyramid `level` can be split into (at least 1; < 2 means it cannot be split).
 * Every interior cut falls on a multiple of both TILE (512) and 2^level.
 * @param {number} height @param {number} level
 */
export function maxSplitParts(height, level) {
  if (!(Number.isSafeInteger(height) && height > 0 && Number.isSafeInteger(level) && level >= 0)) return 1;
  return Math.ceil(height / Math.max(TILE, 2 ** level));
}

/** Whether a section can be split into parts right now. @param {any} s */
export function canSplitSection(s) {
  return !!(s?.tiled && s.maskTiles && !s.frozen && maxSplitParts(s.maskTiles.height, s.tiled.level) >= 2);
}

/**
 * What the interface offers for splitting `s` (X1): when its object statistics exceeded their budget, the number of parts `partsToFitStats`
 * recommends (2..8, or null when splitting would not fit or the section does not have that many tile rows); otherwise 2 when splittable.
 * @param {any} s @returns {{exceeded: boolean, canSplit: boolean, maxParts: number, suggested: number | null}}
 */
export function splitSuggestion(s) {
  const maxParts = s?.tiled && s.maskTiles ? Math.min(STATS_SPLIT_MAX_PARTS, maxSplitParts(s.maskTiles.height, s.tiled.level)) : 1;
  const canSplit = !!(s?.tiled && s.maskTiles && !s.frozen && maxParts >= 2);
  const exceeded = !!s?._statsRunner?.stats?.exceeded;
  if (!exceeded) return { exceeded: false, canSplit, maxParts, suggested: canSplit ? 2 : null };
  const recommended = partsToFitStats(s._statsRunner.stats.estimateBytes ?? 0);
  const suggested = recommended !== null && recommended <= maxParts ? recommended : null;
  return { exceeded: true, canSplit, maxParts, suggested };
}

/**
 * Partition `height` source pixels into `count` contiguous bands at mask-tile boundaries near equal heights, each starting on a multiple of
 * `max(TILE, 2^level)` so its row window is valid (`validWindow`).
 * @param {number} height @param {number} level @param {number} count
 * @returns {{row0: number, row1: number, py0: number, py1: number, height: number}[]}
 */
export function splitRowBounds(height, level, count) {
  if (!(Number.isSafeInteger(height) && height > 0 && Number.isSafeInteger(level) && level >= 0)) throw new RangeError('split geometry');
  const tileRows = Math.ceil(height / TILE);
  const stepRows = Math.max(1, (2 ** level) / TILE);
  const blocks = Math.ceil(tileRows / stepRows);
  if (!Number.isSafeInteger(count) || count < 2 || count > blocks) throw new RangeError('split count');
  const cuts = [0];
  let prevBlock = 0;
  for (let k = 1; k < count; k++) {
    const targetBlock = Math.round(((height * k) / count) / (TILE * stepRows));
    const block = Math.max(prevBlock + 1, Math.min(blocks - (count - k), targetBlock));
    cuts.push(block * stepRows);
    prevBlock = block;
  }
  cuts.push(tileRows);
  const parts = [];
  for (let k = 0; k < count; k++) {
    const row0 = cuts[k], row1 = cuts[k + 1], py0 = row0 * TILE, py1 = Math.min(height, row1 * TILE);
    parts.push({ row0, row1, py0, py1, height: py1 - py0 });
  }
  return parts;
}

/**
 * @typedef {{index: number, id: string, name: string, row0: number, row1: number, py0: number, py1: number, width: number, height: number,
 *   w: number, h: number, top: number, bottom: number, units: string, roi: {x0: number, y0: number, x1: number, y1: number},
 *   marks: any[], manual: any[], window: {y0: number, y1: number}}} SplitPartSpec
 */

/**
 * Plan the `count` parts of tiled section `s`: tile rows, windows over the stored pyramid, working dimensions, clipped analysis area, continuous
 * depths, marks and manual index ranges. Does not touch `s` or the store.
 * @param {any} s @param {number} count
 * @param {{nameOf?: (index: number, count: number) => string, idOf?: (index: number) => string}} [options]
 * @returns {SplitPartSpec[]}
 */
export function planSplitParts(s, count, { nameOf = (i, n) => `${s.name} (${i + 1}/${n})`, idOf = (i) => `${s.id}_p${i + 1}` } = {}) {
  const W = s.maskTiles.width, H = s.maskTiles.height, ds = s.ds, level = s.tiled.level, baseY0 = windowTop(s.tiled);
  const area = { x0: s.roi.x0 * ds, y0: s.roi.y0 * ds, x1: Math.min(s.roi.x1 * ds, W), y1: Math.min(s.roi.y1 * ds, H) };
  const roiSpan = area.y1 - area.y0;
  /** Depth at source row `y` of `s`: exact at the ROI edges, linear in between (identical to `depthAtRow` on the counted source rows). @param {number} y */
  const depthAtSource = (y) => {
    if (!(roiSpan > 0)) return s.top + (y / H) * (s.bottom - s.top);
    if (y === area.y0) return s.top;
    if (y === area.y1) return s.bottom;
    return s.top + ((y - area.y0) / roiSpan) * (s.bottom - s.top);
  };
  return splitRowBounds(H, level, count).map((b, index) => {
    const partW = s.w, partH = Math.ceil(b.height / ds);
    const wy0 = b.py0 / ds, wy1 = wy0 + partH;
    const sy0 = Math.max(area.y0, b.py0), sy1 = Math.min(area.y1, b.py1);
    let top, bottom, roi;
    if (sy1 > sy0) {
      top = depthAtSource(sy0);
      bottom = depthAtSource(sy1);
      const roiY0 = Math.floor((sy0 - b.py0) / ds);
      const roiY1 = sy1 === b.py1 ? partH : Math.min(partH, Math.ceil((sy1 - b.py0) / ds));
      roi = { x0: s.roi.x0, y0: roiY0, x1: s.roi.x1, y1: roiY1 };
    } else {
      top = depthAtSource(b.py0);
      bottom = depthAtSource(b.py1);
      roi = { x0: s.roi.x0, y0: 0, x1: s.roi.x1, y1: partH };
    }
    const marks = (s.marks || []).filter((m) => m.y >= wy0 && m.y < wy1).map((m) => ({ ...m, y: m.y - wy0 }));
    const manual = (s.manual || []).filter((m) => m.to > top && m.from < bottom)
      .map((m) => ({ ...m, from: Math.max(m.from, top), to: Math.min(m.to, bottom) }));
    return {
      index, id: idOf(index), name: nameOf(index, count), row0: b.row0, row1: b.row1, py0: b.py0, py1: b.py1,
      width: W, height: b.height, w: partW, h: partH, top, bottom, units: s.units, roi, marks, manual,
      window: { y0: baseY0 + b.py0, y1: baseY0 + b.py1 },
    };
  });
}

/**
 * Decode the binary reply of `mask.slice`: `objectCount` little-endian u32 object IDs followed by `stackCount` little-endian u32 stack indices.
 * @param {Uint8Array | ArrayBufferView | ArrayBuffer} bytes @param {number} objectCount @param {number} stackCount
 * @returns {{objectIds: Uint32Array, stackIndices: Uint32Array}}
 */
export function decodeSlicePayload(bytes, objectCount, stackCount) {
  const view = ArrayBuffer.isView(bytes) ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) : new DataView(bytes);
  if (view.byteLength !== (objectCount + stackCount) * 4) throw new RangeError('slice payload length');
  const objectIds = new Uint32Array(objectCount), stackIndices = new Uint32Array(stackCount);
  for (let i = 0; i < objectCount; i++) objectIds[i] = view.getUint32(i * 4, true);
  const offset = objectCount * 4;
  for (let i = 0; i < stackCount; i++) stackIndices[i] = view.getUint32(offset + i * 4, true);
  return { objectIds, stackIndices };
}

/**
 * Saved record (format 7, with `tiled.window`) for one part produced by `mask.slice`, ready to be opened with `loadTiledSection`.
 * Keeps each present object's ID, class, source, note flag, thumbnail and embedding; omits `st` so statistics are recomputed in the part's
 * coordinates. Overlap stacks keep their original indices for every used stack (empty arrays at unused lower indices so tile blobs need no
 * re-encoding and `stackIndex` stays valid).
 * @param {any} s original tiled section @param {SplitPartSpec} part @param {string} manifest
 * @param {ArrayLike<number>} objectIds @param {ArrayLike<number>} stackIndices
 */
export function buildPartRecord(s, part, manifest, objectIds, stackIndices) {
  const objects = [];
  for (let i = 0; i < objectIds.length; i++) {
    const o = s.objects.get(objectIds[i]);
    if (!o) continue;
    objects.push({ id: o.id, cls: o.cls, src: o.src, ...(o.nt ? { nt: 1 } : {}), ...(o.cls && o._thumb ? { th: o._thumb } : {}), ...(o.emb ? { em: o.emb } : {}) });
  }
  /** @type {(number[] | null)[]} */
  const stacks = [null];
  if (stackIndices.length) {
    const used = new Set(/** @type {any} */ (stackIndices));
    let maxStack = 0;
    for (let i = 0; i < stackIndices.length; i++) if (stackIndices[i] > maxStack) maxStack = stackIndices[i];
    for (let k = 1; k <= maxStack; k++) stacks.push(used.has(k) && Array.isArray(s.stacks?.[k]) ? s.stacks[k].slice() : []);
  }
  const { window: win } = part;
  return {
    id: part.id, name: part.name, ds: s.ds, rot: 0, w: part.w, h: part.h, crop: null, full: { w: part.width, h: part.height },
    file: { name: s.file.name, type: s.file.type, tiled: true },
    top: part.top, bottom: part.bottom, units: part.units, roi: { ...part.roi },
    filters: { ...s.filters }, preset: s.preset, detect: { ...s.detect }, manual: part.manual,
    nextId: s.nextId, objects, stacks, marks: part.marks,
    tiled: { version: 1, store: 2, manifest, width: part.width, height: part.height, level: s.tiled.level,
      source: { sha256: s.tiled.pyramid, size: s.tiled.source?.size ?? null, name: s.tiled.source?.name ?? s.file.name },
      window: { y0: win.y0, y1: win.y1 } },
  };
}
