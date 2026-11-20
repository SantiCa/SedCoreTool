// @ts-check
/**
 * @typedef {import('./core.js').Roi} Roi
 * @typedef {import('./core.js').StackTable} StackTable
 * @typedef {Uint8ClampedArray | Uint8Array | Uint16Array} RgbaRaster
 * @typedef {RgbaRaster | Int32Array | Float32Array} RasterArray
 * @typedef {Float32Array | Float64Array} LumaRow
 * @typedef {typeof DEFAULT_FILTERS} FilterSettings
 * @typedef {Omit<typeof DEFAULT_DETECT, 'pThr'> & {pThr?: number}} DetectionSettings
 * @typedef {{n: number, sx: number, sy: number, sxx: number, syy: number, sxy: number,
 *   x0: number, x1: number, y0: number, y1: number, per: number, sL: number,
 *   sLL: number, sA: number, sB: number, rL: number, rN: number}} TraceStats
 */
import { hasId } from './core.js';
// SedCoreTool web — image processing (no DOM): enhancement, detection, selection tools, shape features.

/** Bytes the page keeps for each pixel of a section's working image: the RGBA original and its enhanced copy (4 + 4), the labels (4)
 * and the exclusion (1); a 16-bit source adds its 16-bit RGBA copy (8). The section form shows the same estimate. */
export const WORKING_BYTES_PER_PIXEL = 13, WORKING_BYTES_PER_PIXEL_16 = 21;
/** Largest working image the page accepts (card H6, 16 November 2026). Choosing "full" resolution for a 2 GiB image needed several
 * gigabytes and the window went blank; above this the image is reduced, or the choice is refused with a message. */
export const WORKING_MEMORY_LIMIT = 1.5 * 2 ** 30;

/** Estimated page memory, in bytes, of a working image of w x h pixels.
 * @param {number} w @param {number} h @param {boolean} [bits16] */
export function workingBytes(w, h, bits16 = false) {
  return w * h * (bits16 ? WORKING_BYTES_PER_PIXEL_16 : WORKING_BYTES_PER_PIXEL);
}

/** Smallest reduction factor, at least `k0`, whose working image (floor(w / k) x floor(h / k)) fits `limit`.
 * @param {number} w @param {number} h @param {number} [k0] @param {boolean} [bits16] @param {number} [limit] */
export function factorThatFits(w, h, k0 = 1, bits16 = false, limit = WORKING_MEMORY_LIMIT) {
  let k = Math.max(1, Math.ceil(k0));
  while (workingBytes(Math.floor(w / k), Math.floor(h / k), bits16) > limit) k++;
  return k;
}

/**
 * @param {ArrayLike<number>} rgba
 * @param {number} j
 */
function pixelLuma(rgba, j) {
  return 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
}

/** Luminance in the original sample units, including unsigned 16-bit RGBA (0-65535).
 *
 * @param {ArrayLike<number>} rgba
 * @param {number} n
 * @returns {Float32Array}
 */
export function lumaOf(rgba, n) {
  const L = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) L[i] = pixelLuma(rgba, j);
  return L;
}

/**
 * Stream a separable box blur one row at a time. Only rows in the vertical window
 * and the next entering row are retained. The callback may overwrite an emitted row.
 *
 * @param {number} w
 * @param {number} h
 * @param {number} r
 * @param {(y: number, row: LumaRow) => void} readRow
 * @param {(y: number, blurred: Float32Array, source: LumaRow | null) => void} emitRow
 * @param {boolean} [keepInput]
 */
function blurRows(w, h, r, readRow, emitRow, keepInput = false) {
  if (!w || !h) return;
  const capacity = Math.min(h, 2 * r + 2);
  const horizontal = new Float32Array(capacity * w);
  const input = keepInput ? new Float32Array(capacity * w) : new Float64Array(w);
  const sums = new Float64Array(w), output = new Float32Array(w);
  /** @param {number} y @param {number} leaving */
  function addRow(y, leaving) {
    const offset = (y % capacity) * w, from = keepInput ? offset : 0;
    const row = input.subarray(from, from + w);
    readRow(y, row);
    let sum = 0, count = 0;
    for (let x = 0; x <= Math.min(r, w - 1); x++) { sum += row[x]; count++; }
    for (let x = 0; x < w; x++) {
      const value = Math.fround(sum / count);
      horizontal[offset + x] = value;
      sums[x] += value;
      if (leaving >= 0) sums[x] -= horizontal[leaving + x];
      const enter = x + r + 1, leave = x - r;
      if (enter < w) { sum += row[enter]; count++; }
      if (leave >= 0) { sum -= row[leave]; count--; }
    }
  }
  let count = Math.min(r + 1, h);
  for (let y = 0; y < count; y++) addRow(y, -1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) output[x] = sums[x] / count;
    const offset = (y % capacity) * w;
    emitRow(y, output, keepInput ? input.subarray(offset, offset + w) : null);
    const enter = y + r + 1, leave = y - r;
    const leaving = leave >= 0 ? (leave % capacity) * w : -1;
    if (enter < h) {
      addRow(enter, leaving);
      count++;
    } else if (leaving >= 0) {
      for (let x = 0; x < w; x++) sums[x] -= horizontal[leaving + x];
    }
    if (leaving >= 0) count--;
  }
}

/** Separable box blur with edge normalisation, window (2r+1)².
 *
 * @param {ArrayLike<number>} src
 * @param {number} w
 * @param {number} h
 * @param {number} r
 * @returns {Float32Array}
 */
export function boxBlur(src, w, h, r) {
  const out = new Float32Array(w * h);
  blurRows(w, h, r, (y, row) => {
    for (let x = 0; x < w; x++) row[x] = src[y * w + x];
  }, (y, row) => out.set(row, y * w));
  return out;
}

export const DEFAULT_FILTERS = {
  channel: 'rgb', autoLevels: false, autoGamma: false, blackPoint: 0, whitePoint: 255, gamma: 1, brightness: 0, contrast: 0,
  saturation: 100, vibrance: 0, equalize: false, claheBlock: 0, claheSlope: 3, localAmount: 0, localRadius: 30, invert: false,
};

/**
 * Built-in presets. `source` names the publication each one follows (shown in the interface and the
 * documentation); presets without a source are generic starting points.
 */
export const FILTER_PRESETS = {
  none: { ...DEFAULT_FILTERS },
  // Dorador, Rodríguez-Tovar & IODP Exp. 339 Scientists (2014, Facies 60: 39-44): Levels, then
  // Brightness/Contrast, then Vibrance/Saturation. Levels are image-specific in the paper (chosen case
  // by case), so they are computed from the histogram; grey (gamma 0.76), vibrance (-31) and saturation
  // (-66) are the published means; contrast/brightness are approximate equivalents of the Photoshop
  // means (70 / -8), whose scale differs from ours. autoGamma (our adaptation): gamma that maps the median
  // grey to mid-grey, limited to the published per-image range 0.19-1.
  dorador2014: { ...DEFAULT_FILTERS, autoLevels: true, autoGamma: true, gamma: 0.76, contrast: 20, brightness: -3, saturation: 34, vibrance: -31 },
  // Miguez-Salas, Dorador & Rodríguez-Tovar (2019, Marine Geology 413: 1-9): Fiji "Enhance Local
  // Contrast (CLAHE)". The paper gives no values; the Fiji defaults are used (block 127, slope 3).
  clahe2019: { ...DEFAULT_FILTERS, claheBlock: 127, claheSlope: 3 },
  levels: { ...DEFAULT_FILTERS, blackPoint: 40, whitePoint: 215, contrast: 25, saturation: 140 },
  local: { ...DEFAULT_FILTERS, localAmount: 60, localRadius: 25, contrast: 15 },
  strong: { ...DEFAULT_FILTERS, equalize: true, localAmount: 40, localRadius: 20, channel: 'gray' },
};

/** Luminance percentiles inside the ROI, used as black and white points ("auto levels").
 *
 * @param {ArrayLike<number>} rgba
 * @param {number} w
 * @param {number} h
 * @param {Roi | null} [roi]
 * @param {number} [lo]
 * @param {number} [hi]
 */
export function autoLevels(rgba, w, h, roi = null, lo = 0.005, hi = 0.995) {
  const R = roi || { x0: 0, y0: 0, x1: w, y1: h };
  const wide = rgba instanceof Uint16Array, max = wide ? 65535 : 255, scale = wide ? 257 : 1;
  const hist = new Uint32Array(max + 1);
  let n = 0;
  for (let y = R.y0; y < R.y1; y++) for (let x = R.x0; x < R.x1; x++) {
    const j = (y * w + x) * 4; hist[Math.min(max, Math.round(pixelLuma(rgba, j)))]++; n++;
  }
  /** @param {number} q */
  const pick = (q) => { let c = 0; for (let v = 0; v <= max; v++) { c += hist[v]; if (c >= Math.max(1, q * n)) return v; } return max; };
  const b = pick(lo), wt = Math.max(b + 1, pick(hi));
  return { blackPoint: b / scale, whitePoint: wt / scale, median: pick(0.5) / scale };
}

/** Gamma that maps the median to mid-grey after levels (out = in^(1/gamma)), limited to [min, max].
 *
 * @param {number} median
 * @param {number} blackPoint
 * @param {number} whitePoint
 * @param {number} [min]
 * @param {number} [max]
 */
export function gammaForMedian(median, blackPoint, whitePoint, min = 0.19, max = 1) {
  const m = Math.min(0.99, Math.max(0.01, (median - blackPoint) / (whitePoint - blackPoint)));
  return Math.min(max, Math.max(min, Math.log(m) / Math.log(0.5)));
}

/** CLAHE mapping for sequential rows. Retain the two histogram rows used for interpolation.
 *
 * @param {(index: number) => number} read
 * @param {number} w
 * @param {number} h
 * @param {number} block
 * @param {number} slope
 * @returns {(y: number, out: LumaRow) => void}
 */
function claheRows(read, w, h, block, slope) {
  const nx = Math.max(1, Math.round(w / block)), ny = Math.max(1, Math.round(h / block));
  const tw = w / nx, th = h / ny;
  const maps = [new Float32Array(nx * 256), new Float32Array(nx * 256)];
  const cached = [-1, -1], hist = new Float64Array(256);
  /** @param {number} value */
  const bin = (value) => Math.min(255, Math.max(0, value | 0));
  /** @param {number} ty */
  function mapRow(ty) {
    const slot = ty % 2, row = maps[slot];
    if (cached[slot] === ty) return row;
    const y0 = Math.floor(ty * th), y1 = Math.floor((ty + 1) * th);
    for (let tx = 0; tx < nx; tx++) {
      hist.fill(0);
      const x0 = Math.floor(tx * tw), x1 = Math.floor((tx + 1) * tw);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) hist[bin(read(y * w + x))]++;
      const n = (x1 - x0) * (y1 - y0), limit = Math.max(1, (slope * n) / 256);
      let excess = 0;
      for (let v = 0; v < 256; v++) if (hist[v] > limit) { excess += hist[v] - limit; hist[v] = limit; }
      const add = excess / 256, offset = tx * 256;
      let c = 0;
      for (let v = 0; v < 256; v++) { c += hist[v] + add; row[offset + v] = (c / n) * 255; }
    }
    cached[slot] = ty;
    return row;
  }
  return (y, out) => {
    const gy = Math.min(ny - 1, Math.max(0, (y + 0.5) / th - 0.5)), y0 = Math.floor(gy), fy = gy - y0;
    const a = mapRow(y0), b = mapRow(Math.min(ny - 1, y0 + 1));
    for (let x = 0; x < w; x++) {
      const gx = Math.min(nx - 1, Math.max(0, (x + 0.5) / tw - 0.5)), x0 = Math.floor(gx), fx = gx - x0;
      const v = bin(read(y * w + x)), i = x0 * 256 + v, j = Math.min(nx - 1, x0 + 1) * 256 + v;
      out[x] = (a[i] * (1 - fx) + a[j] * fx) * (1 - fy) + (b[i] * (1 - fx) + b[j] * fx) * fy;
    }
  };
}

/** Contrast-limited adaptive histogram equalisation (Zuiderveld, 1994) of 0-255 luminance.
 *
 * @param {ArrayLike<number>} L
 * @param {number} w
 * @param {number} h
 * @param {number} [block]
 * @param {number} [slope]
 * @returns {Float32Array}
 */
export function clahe(L, w, h, block = 127, slope = 3) {
  const out = new Float32Array(w * h);
  if (!w || !h) return out;
  const readRow = claheRows((i) => L[i], w, h, block, slope);
  for (let y = 0; y < h; y++) readRow(y, out.subarray(y * w, (y + 1) * w));
  return out;
}

/**
 * @param {FilterSettings} p
 * @param {boolean} wide
 * @returns {(src: ArrayLike<number>, dst: Uint8ClampedArray, offset: number) => void}
 */
function colorFilter(p, wide) {
  const scale = wide ? 257 : 1;
  const bp = p.blackPoint, wp = Math.max(p.whitePoint, bp + 1 / scale);
  const c = p.contrast * 2.55, cf = (259 * (c + 255)) / (255 * (259 - c));
  const lut = new Float32Array(wide ? 65536 : 256);
  for (let v = 0; v < lut.length; v++) {
    let x = Math.min(1, Math.max(0, (v / scale - bp) / (wp - bp)));
    x = Math.pow(x, 1 / p.gamma) * 255;
    lut[v] = (x - 128) * cf + 128 + p.brightness * 2.55;
  }
  const sat = p.saturation / 100, vib = (p.vibrance || 0) / 100, ch = p.channel;
  return (src, dst, offset) => {
    for (let j = 0; j < src.length; j += 4) {
      let r = src[j], g = src[j + 1], b = src[j + 2];
      if (ch === 'r') g = b = r; else if (ch === 'g') r = b = g; else if (ch === 'b') r = g = b;
      else if (ch === 'gray') r = g = b = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      r = lut[r]; g = lut[g]; b = lut[b];
      if (sat !== 1) { const l = 0.299 * r + 0.587 * g + 0.114 * b; r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat; }
      if (vib) { // vibrance: saturation change weighted towards weakly saturated pixels
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sv = mx > 0 ? Math.min(1, (mx - mn) / 255) : 0;
        const f = 1 + vib * (1 - sv), l = 0.299 * r + 0.587 * g + 0.114 * b;
        r = l + (r - l) * f; g = l + (g - l) * f; b = l + (b - l) * f;
      }
      const d = offset + j;
      dst[d] = r; dst[d + 1] = g; dst[d + 2] = b; dst[d + 3] = 255;
    }
  };
}

/**
 * Feed sequential RGBA chunks into the pointwise color stage. After all input
 * arrives, the global and neighbourhood stages run on the working result.
 *
 * @param {number} w
 * @param {number} h
 * @param {FilterSettings} p
 * @param {boolean} [wide]
 */
export function filterImageChunks(w, h, p, wide = false) {
  const dst = new Uint8ClampedArray(w * h * 4), filter = colorFilter(p, wide);
  let offset = 0;
  return {
    /** @param {ArrayLike<number>} src */
    append(src) {
      if (src.length % 4 || offset + src.length > dst.length) throw new Error('Invalid filter chunk length');
      filter(src, dst, offset);
      offset += src.length;
      return offset === dst.length;
    },
    finish() {
      if (offset !== dst.length) throw new Error('Incomplete filter input');
      return finishFilters(dst, w, h, p);
    },
  };
}

/**
 * @param {RgbaRaster} src
 * @param {number} w
 * @param {number} h
 * @param {FilterSettings} p
 * @returns {Uint8ClampedArray}
 */
export function applyFilters(src, w, h, p) {
  const work = filterImageChunks(w, h, p, src instanceof Uint16Array);
  work.append(src.subarray(0, w * h * 4));
  return work.finish();
}

/**
 * @param {Uint8ClampedArray} dst
 * @param {number} w
 * @param {number} h
 * @param {FilterSettings} p
 */
function finishFilters(dst, w, h, p) {
  const n = w * h;
  if (n && (p.equalize || p.claheBlock > 0 || p.localAmount > 0)) {
    /** @param {number} i */
    const luma = (i) => Math.fround(pixelLuma(dst, i * 4));
    let read = luma;
    if (p.equalize) {
      const hist = new Uint32Array(256);
      for (let i = 0; i < n; i++) hist[luma(i) | 0]++;
      const map = new Float32Array(256); let cum = 0, cmin = -1;
      for (let v = 0; v < 256; v++) { cum += hist[v]; if (cmin < 0 && cum) cmin = cum; map[v] = cum; }
      const den = Math.max(1, n - cmin);
      read = (i) => Math.fround(((map[luma(i) | 0] - cmin) / den) * 255);
    }
    /** @type {(y: number, row: LumaRow) => void} */
    const readRow = p.claheBlock > 0 ? claheRows(read, w, h, p.claheBlock, p.claheSlope) : (y, row) => {
      for (let x = 0; x < w; x++) row[x] = read(y * w + x);
    };
    /** @param {number} y @param {Float32Array} row @param {LumaRow | null} original */
    const adjustRow = (y, row, original) => {
      const amount = p.localAmount / 25;
      for (let x = 0; x < w; x++) {
        const i = y * w + x, j = i * 4;
        const target = original ? Math.fround(original[x] + amount * (original[x] - row[x])) : row[x];
        const d = target - luma(i);
        dst[j] += d; dst[j + 1] += d; dst[j + 2] += d;
      }
    };
    if (p.localAmount > 0) {
      blurRows(w, h, p.localRadius, readRow, adjustRow, true);
    } else {
      const row = new Float32Array(w);
      for (let y = 0; y < h; y++) {
        readRow(y, row);
        adjustRow(y, row, null);
      }
    }
  }
  if (p.invert) for (let j = 0; j < n * 4; j += 4) { dst[j] = 255 - dst[j]; dst[j + 1] = 255 - dst[j + 1]; dst[j + 2] = 255 - dst[j + 2]; }
  return dst;
}

/**
 * @param {Uint8Array} m
 * @param {number} w
 * @param {number} h
 * @param {boolean} dilate
 * @param {Uint8Array} [t]
 * @param {Uint8Array} [o]
 */
function morph(m, w, h, dilate, t = new Uint8Array(m.length), o = new Uint8Array(m.length)) {   // V0.41: t, o reusable
  for (let y = 0; y < h; y++) {
    const r = y * w;
    for (let x = 0; x < w; x++) {
      const i = r + x, a = x > 0 ? m[i - 1] : m[i], b = x < w - 1 ? m[i + 1] : m[i];
      t[i] = dilate ? (m[i] | a | b) : (m[i] & a & b);
    }
  }
  for (let y = 0; y < h; y++) {
    const r = y * w;
    for (let x = 0; x < w; x++) {
      const i = r + x, a = y > 0 ? t[i - w] : t[i], b = y < h - 1 ? t[i + w] : t[i];
      o[i] = dilate ? (t[i] | a | b) : (t[i] & a & b);
    }
  }
  return o;
}

export const DEFAULT_DETECT = { method: 'adaptive', polarity: 'dark', offset: 12, radius: 40, threshold: 80, minArea: 40, smooth: 1, fillHoles: false, pThr: 0.5 };

/** Two-class k-means on luminance inside the ROI (as the ICY K-Means option); returns the threshold between the centres.
 *
 * @param {ArrayLike<number>} L
 * @param {number} w
 * @param {Roi} roi
 * @param {ArrayLike<number> | null} exclude
 */
export function kmeansThreshold(L, w, roi, exclude) {
  const hist = new Float64Array(256);
  for (let y = roi.y0; y < roi.y1; y++) for (let x = roi.x0; x < roi.x1; x++) {
    const i = y * w + x; if (exclude && exclude[i]) continue; hist[Math.min(255, Math.max(0, L[i] | 0))]++;
  }
  const n = hist.reduce((a, b) => a + b, 0); if (!n) return 128;
  /** @param {number} f */
  const q = (f) => { let c = 0; for (let v = 0; v < 256; v++) { c += hist[v]; if (c >= f * n) return v; } return 255; };
  let c1 = q(0.1), c2 = q(0.9);
  for (let it = 0; it < 50; it++) {
    const t = (c1 + c2) / 2; let s1 = 0, n1 = 0, s2 = 0, n2 = 0;
    for (let v = 0; v < 256; v++) { if (v < t) { s1 += v * hist[v]; n1 += hist[v]; } else { s2 += v * hist[v]; n2 += hist[v]; } }
    const a = n1 ? s1 / n1 : c1, b = n2 ? s2 / n2 : c2;
    if (Math.abs(a - c1) < 1e-3 && Math.abs(b - c2) < 1e-3) break;
    c1 = a; c2 = b;
  }
  return (c1 + c2) / 2;
}

/** Fill holes: background regions (4-connected) not reached from the ROI border become foreground.
 *
 * @param {Uint8Array} mask
 * @param {number} w
 * @param {number} h
 * @param {Roi} roi
 */
export function fillHoles(mask, w, h, roi) {
  const seen = new Uint8Array(w * h);
  /** @type {number[]} */
  const stack = [];
  /** @param {number} x @param {number} y */
  const push = (x, y) => { const i = y * w + x; if (!mask[i] && !seen[i]) { seen[i] = 1; stack.push(i); } };
  for (let x = roi.x0; x < roi.x1; x++) { push(x, roi.y0); push(x, roi.y1 - 1); }
  for (let y = roi.y0; y < roi.y1; y++) { push(roi.x0, y); push(roi.x1 - 1, y); }
  while (stack.length) {
    const i = /** @type {number} */ (stack.pop()), x = i % w, y = (i - x) / w;
    if (x > roi.x0) push(x - 1, y); if (x < roi.x1 - 1) push(x + 1, y);
    if (y > roi.y0) push(x, y - 1); if (y < roi.y1 - 1) push(x, y + 1);
  }
  const out = mask.slice();
  for (let y = roi.y0; y < roi.y1; y++) for (let x = roi.x0; x < roi.x1; x++) { const i = y * w + x; if (!mask[i] && !seen[i]) out[i] = 1; }
  return out;
}

/**
 * Binary candidate mask from the enhanced image, restricted to the ROI and non-excluded pixels.
 * V0.15: method 'unet' thresholds a U-Net probability map (`prob`, one value per pixel) at p.pThr instead.
 *
 * @param {ArrayLike<number>} rgba
 * @param {number} w
 * @param {number} h
 * @param {Roi} roi
 * @param {ArrayLike<number> | null} exclude
 * @param {DetectionSettings} p
 * @param {ArrayLike<number> | null} [prob]
 * @returns {Uint8Array}
 */
export function detectMask(rgba, w, h, roi, exclude, p, prob = null) {
  const n = w * h;
  let m = new Uint8Array(n);
  if (p.method === 'unet') {
    const thr = p.pThr ?? 0.5;
    if (prob) for (let y = roi.y0; y < roi.y1; y++) for (let x = roi.x0; x < roi.x1; x++) { const i = y * w + x; if (!(exclude && exclude[i]) && prob[i] >= thr) m[i] = 1; }
    return postMask(m, w, h, roi, p);
  }
  const L = lumaOf(rgba, n);
  const mean = p.method === 'adaptive' ? boxBlur(L, w, h, p.radius) : null;
  const off = p.offset, t = p.method === 'kmeans' ? kmeansThreshold(L, w, roi, exclude) : p.threshold, pol = p.polarity;
  for (let y = roi.y0; y < roi.y1; y++) {
    for (let x = roi.x0; x < roi.x1; x++) {
      const i = y * w + x;
      if (exclude && exclude[i]) continue;
      let on;
      if (mean) {
        const d = L[i] - mean[i];
        on = pol === 'dark' ? d < -off : pol === 'light' ? d > off : Math.abs(d) > off;
      } else on = pol === 'light' ? L[i] > t : L[i] < t;
      m[i] = on ? 1 : 0;
    }
  }
  return postMask(m, w, h, roi, p);
}

/** Opening and closing `p.smooth` times with a 3 × 3 square (separable), then optional hole filling.
 *
 * @param {Uint8Array} m
 * @param {number} w
 * @param {number} h
 * @param {Roi} roi
 * @param {Pick<DetectionSettings, 'smooth' | 'fillHoles'>} p
 */
function postMask(m, w, h, roi, p) {
  // V0.41: three buffers reused in turn instead of two new arrays per pass (same result)
  if (p.smooth > 0) {
    const t = new Uint8Array(m.length);
    let a = m;
    /** @type {Uint8Array} */
    let b = new Uint8Array(m.length);
    /** @param {boolean} dil */
    const step = (dil) => { morph(a, w, h, dil, t, b); [a, b] = [b, a]; };
    for (let k = 0; k < p.smooth; k++) { step(false); step(true); } // opening
    for (let k = 0; k < p.smooth; k++) { step(true); step(false); } // closing
    m = a;
  }
  if (p.fillHoles) m = fillHoles(m, w, h, roi);
  return m;
}

/** 8-connected components; components smaller than minArea are dropped.
 *
 * @param {ArrayLike<number>} mask
 * @param {number} w
 * @param {number} h
 * @param {number} [minArea]
 */
export function components(mask, w, h, minArea = 1) {
  const n = w * h, lab = new Int32Array(n), q = new Int32Array(n), areas = [0];
  let next = 0;
  for (let s = 0; s < n; s++) {
    if (!mask[s] || lab[s]) continue;
    next++; let head = 0, tail = 0; q[tail++] = s; lab[s] = next;
    while (head < tail) {
      const p = q[head++], x = p % w, y = (p - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (mask[j] && !lab[j]) { lab[j] = next; q[tail++] = j; }
        }
      }
    }
    areas.push(tail);
  }
  const map = new Int32Array(next + 1); let count = 0;
  for (let k = 1; k <= next; k++) if (areas[k] >= minArea) map[k] = ++count;
  for (let i = 0; i < n; i++) if (lab[i]) lab[i] = map[lab[i]];
  return { labels: lab, count };
}

/** Magic wand: 4-connected flood fill by RGB distance to the seed colour.
 *
 * @param {ArrayLike<number>} rgba
 * @param {number} w
 * @param {number} h
 * @param {number} seed
 * @param {number} tol
 * @param {Roi} roi
 * @param {ArrayLike<number> | null} exclude
 * @param {number} [maxPx]
 * @returns {number[]}
 */
export function regionGrow(rgba, w, h, seed, tol, roi, exclude, maxPx = 4e6) {
  const n = w * h, seen = new Uint8Array(n), out = [];
  const sr = rgba[seed * 4], sg = rgba[seed * 4 + 1], sb = rgba[seed * 4 + 2], t2 = tol * tol;
  const stack = [seed]; seen[seed] = 1;
  while (stack.length && out.length < maxPx) {
    const p = /** @type {number} */ (stack.pop());
    const j = p * 4, dr = rgba[j] - sr, dg = rgba[j + 1] - sg, db = rgba[j + 2] - sb;
    if (dr * dr + dg * dg + db * db > t2) continue;
    out.push(p);
    const x = p % w, y = (p - x) / w;
    const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
    for (const [xx, yy] of nb) {
      if (xx < roi.x0 || xx >= roi.x1 || yy < roi.y0 || yy >= roi.y1) continue;
      const k = yy * w + xx;
      if (seen[k] || (exclude && exclude[k])) continue;
      seen[k] = 1; stack.push(k);
    }
  }
  return out;
}

/** Pixels inside a polygon (even-odd rule, pixel centres), clipped to the ROI.
 *
 * @param {readonly (readonly [number, number])[]} pts
 * @param {number} w
 * @param {Roi} roi
 * @returns {number[]}
 */
export function polygonPixels(pts, w, roi) {
  if (pts.length < 3) return [];
  let ymin = Infinity, ymax = -Infinity;
  for (const [, y] of pts) { ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); }
  const out = [];
  const y0 = Math.max(roi.y0, Math.floor(ymin)), y1 = Math.min(roi.y1 - 1, Math.ceil(ymax));
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5, xs = [];
    for (let k = 0; k < pts.length; k++) {
      const [ax, ay] = pts[k], [bx, by] = pts[(k + 1) % pts.length];
      if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) xs.push(ax + ((yc - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(roi.x0, Math.ceil(xs[k] - 0.5)), xb = Math.min(roi.x1 - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = xa; x <= xb; x++) out.push(y * w + x);
    }
  }
  return out;
}

/**
 * Accumulate per-object statistics over a region. ids: Set of ids to include, or null for all.
 * Colour statistics use the original (unfiltered) image so learning is independent of the display filters.
 *
 * @param {ArrayLike<number>} labels
 * @param {number} w
 * @param {number} h
 * @param {ArrayLike<number>} rgba
 * @param {ReadonlySet<number> | null} [ids]
 * @param {Roi | null} [region]
 * @param {StackTable | null} [stacks]
 * @param {Roi | null} [bounds] where the image lies in the arrays (default: all of them). Pixels outside it are beyond the image's edge: a
 *   trace pixel next to them is on the edge and they are never read for the surrounding contrast. Tiled sections (card M8.4.16) pass arrays
 *   padded around one tile.
 * @returns {Map<number, TraceStats>}
 */
export function objectStats(labels, w, h, rgba, ids = null, region = null, stacks = null, bounds = null) {
  // V0.20: with `stacks`, a pixel in an overlap counts for every object of its stack.
  const R = region || { x0: 0, y0: 0, x1: w, y1: h }, B = bounds || { x0: 0, y0: 0, x1: w, y1: h };
  /** @type {Map<number, TraceStats>} */
  const acc = new Map();
  /** @param {number} i */
  const lum = (i) => 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  /** @type {(k: number, id: number) => boolean} */
  const own = stacks ? (k, id) => hasId(labels[k], id, stacks) : (k, id) => labels[k] === id;
  /** @param {number} x @param {number} y @param {number} i @param {number} id */
  const add = (x, y, i, id) => {
    if (ids && !ids.has(id)) return;
    let a = acc.get(id);
    if (!a) {
      a = { n: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0, x0: x, x1: x, y0: y, y1: y, per: 0, sL: 0, sLL: 0, sA: 0, sB: 0, rL: 0, rN: 0 };
      acc.set(id, a);
    }
    const j = i * 4, r = rgba[j], g = rgba[j + 1], b = rgba[j + 2], L = 0.299 * r + 0.587 * g + 0.114 * b;
    a.n++; a.sx += x; a.sy += y; a.sxx += x * x; a.syy += y * y; a.sxy += x * y;
    if (x < a.x0) a.x0 = x; if (x > a.x1) a.x1 = x; if (y < a.y0) a.y0 = y; if (y > a.y1) a.y1 = y;
    a.sL += L; a.sLL += L * L; a.sA += r - g; a.sB += (r + g) / 2 - b;
    const edge = x === B.x0 || !own(i - 1, id) || x === B.x1 - 1 || !own(i + 1, id) ||
      y === B.y0 || !own(i - w, id) || y === B.y1 - 1 || !own(i + w, id);
    if (edge) {
      a.per++;
      for (const [dx, dy] of [[-3, 0], [3, 0], [0, -3], [0, 3]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < B.x0 || yy < B.y0 || xx >= B.x1 || yy >= B.y1) continue;
        const k = yy * w + xx;
        if (!own(k, id)) { a.rL += lum(k); a.rN++; }
      }
    }
  };
  for (let y = R.y0; y < R.y1; y++) {
    for (let x = R.x0; x < R.x1; x++) {
      const i = y * w + x, v = labels[i];
      if (v > 0) add(x, y, i, v);
      else if (v < 0) for (const id of /** @type {number[]} */ ((/** @type {StackTable} */ (stacks))[-v])) add(x, y, i, id);
    }
  }
  return acc;
}

/** Shape and colour descriptors from accumulated statistics. ppu = pixels per cm.
 *
 * @param {TraceStats} a
 * @param {number} ppu
 */
export function features(a, ppu) {
  const n = a.n, mx = a.sx / n, my = a.sy / n;
  const cxx = a.sxx / n - mx * mx + 1 / 12, cyy = a.syy / n - my * my + 1 / 12, cxy = a.sxy / n - mx * my;
  const tr = cxx + cyy, det = cxx * cyy - cxy * cxy, disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc, l2 = Math.max(tr / 2 - disc, 1 / 12);
  const theta = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  const meanL = a.sL / n;
  const majorCm = (4 * Math.sqrt(l1)) / ppu, minorCm = (4 * Math.sqrt(l2)) / ppu, areaCm2 = n / (ppu * ppu);
  return {
    areaCm2, majorCm, minorCm,
    logArea: Math.log10(areaCm2 + 1e-6),
    logMajor: Math.log10(majorCm + 1e-6),
    logMinor: Math.log10(minorCm + 1e-6),
    elong: Math.sqrt(l1 / l2),
    vert: Math.abs(Math.sin(theta)),
    compact: Math.min(1, (4 * Math.PI * n) / Math.max(1, a.per * a.per)),
    fill: n / ((a.x1 - a.x0 + 1) * (a.y1 - a.y0 + 1)),
    meanL,
    stdL: Math.sqrt(Math.max(0, a.sLL / n - meanL * meanL)),
    meanA: a.sA / n,
    meanB: a.sB / n,
    contrast: meanL - (a.rN ? a.rL / a.rN : meanL),
    cx: mx, cy: my,
  };
}

/** Box-average downsampling of an RGBA raster by an integer factor k (remainder rows/columns dropped).
 *
 * @param {RgbaRaster} src
 * @param {number} w
 * @param {number} h
 * @param {number} k
 */
export function downsampleRGBA(src, w, h, k) {
  if (k <= 1) return { rgba: src, w, h };
  const W = Math.floor(w / k), H = Math.floor(h / k), n = k * k;
  const wide = src instanceof Uint16Array;
  const out = wide ? new Uint16Array(W * H * 4) : new Uint8ClampedArray(W * H * 4);
  for (let Y = 0; Y < H; Y++) {
    for (let X = 0; X < W; X++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < k; dy++) {
        let j = ((Y * k + dy) * w + X * k) * 4;
        for (let dx = 0; dx < k; dx++, j += 4) { r += src[j]; g += src[j + 1]; b += src[j + 2]; }
      }
      const o = (Y * W + X) * 4;
      out[o] = wide ? Math.round(r / n) : r / n;
      out[o + 1] = wide ? Math.round(g / n) : g / n;
      out[o + 2] = wide ? Math.round(b / n) : b / n;
      out[o + 3] = wide ? 65535 : 255;
    }
  }
  return { rgba: out, w: W, h: H };
}

/** Rotate a w×h raster with `ch` channels by 90° (dir = 1 clockwise, -1 counter-clockwise).
 *
 * @template {RasterArray} T
 * @param {T} src
 * @param {number} w
 * @param {number} h
 * @param {number} ch
 * @param {number} dir
 * @returns {T}
 */
export function rotate90(src, w, h, ch, dir) {
  const Type = /** @type {new (length: number) => T} */ (src.constructor);
  const out = new Type(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = dir > 0 ? h - 1 - y : y, ny = dir > 0 ? x : w - 1 - x;
      const s = (y * w + x) * ch, d = (ny * h + nx) * ch;
      for (let c = 0; c < ch; c++) out[d + c] = src[s + c];
    }
  }
  return out;
}

/**
 * Separability of the luminance histogram inside the ROI: Otsu's between-class variance divided by the
 * total variance (η, 0–1; Otsu, 1979). High η = two well separated groups of grey levels (e.g. trace
 * infill vs host sediment). Used to rank enhancement settings on one image.
 *
 * @param {ArrayLike<number>} rgba
 * @param {number} w
 * @param {number} h
 * @param {Roi} [roi]
 */
export function separability(rgba, w, h, roi = { x0: 0, y0: 0, x1: w, y1: h }) {
  const hist = new Float64Array(256); let n = 0;
  for (let y = roi.y0; y < roi.y1; y++) for (let x = roi.x0; x < roi.x1; x++) {
    const j = (y * w + x) * 4; hist[Math.min(255, Math.round(0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]))]++; n++;
  }
  if (!n) return { eta: 0, threshold: 0 };
  let mu = 0; for (let v = 0; v < 256; v++) mu += v * hist[v] / n;
  let varT = 0; for (let v = 0; v < 256; v++) varT += (v - mu) ** 2 * hist[v] / n;
  if (!varT) return { eta: 0, threshold: 0 };
  let w0 = 0, m0 = 0, best = 0, thr = 0;
  for (let v = 0; v < 255; v++) {
    w0 += hist[v] / n; m0 += v * hist[v] / n;
    if (w0 <= 0 || w0 >= 1) continue;
    const sb = (mu * w0 - m0) ** 2 / (w0 * (1 - w0));
    if (sb > best) { best = sb; thr = v; }
  }
  return { eta: best / varT, threshold: thr };
}

/**
 * V0.28: how well an enhanced image separates traces from matrix, for ranking enhancement settings.
 * cls[i] (same size as the image): 1 = trace, 2 = matrix, 0 = not used. The feature is the luminance (global
 * threshold) or the luminance minus its local mean over `radius` px (adaptive threshold), as the detection uses it.
 * Score = 2·AUC − 1 in the expected direction (polarity 'dark': traces darker; 'light'; 'both' = either), 0–1.
 *
 * @param {ArrayLike<number>} rgba
 * @param {number} w
 * @param {number} h
 * @param {Roi} roi
 * @param {ArrayLike<number>} cls
 * @param {{local?: boolean, radius?: number, polarity?: string}} [options]
 */
export function traceSeparation(rgba, w, h, roi, cls, { local = true, radius = 40, polarity = 'dark' } = {}) {
  const L = lumaOf(rgba, w * h), M = local ? boxBlur(L, w, h, Math.max(1, Math.round(radius))) : null;
  const ht = new Float64Array(511), hm = new Float64Array(511); let nt = 0, nm = 0;
  for (let y = roi.y0; y < roi.y1; y++) for (let x = roi.x0; x < roi.x1; x++) {
    const i = y * w + x, c = cls[i]; if (!c) continue;
    const v = Math.max(0, Math.min(510, Math.round((M ? L[i] - M[i] : L[i]) + 255)));
    if (c === 1) { ht[v]++; nt++; } else { hm[v]++; nm++; }
  }
  if (!nt || !nm) return { score: 0, auc: 0.5, nTrace: nt, nMatrix: nm };
  // AUC = P(matrix value > trace value) + ½ P(equal): probability that a trace pixel is darker than a matrix pixel
  let below = 0, auc = 0;
  for (let v = 0; v < 511; v++) { auc += (ht[v] / nt) * ((nm - below - hm[v]) / nm + 0.5 * (hm[v] / nm)); below += hm[v]; }
  const dir = polarity === 'light' ? 1 - auc : polarity === 'both' ? Math.max(auc, 1 - auc) : auc;
  return { score: Math.max(0, 2 * dir - 1), auc, nTrace: nt, nMatrix: nm };
}

/**
 * V0.28: separability without reviewed traces, computed in tiles of `tile` px (so slow colour changes along the core
 * and large cracks weigh less than with one histogram of the whole area). In each tile not flat (std ≥ 4 grey levels)
 * the grey levels are split at Otsu's threshold and Fisher's ratio J = (μ₁ − μ₂)² / (σ₁² + σ₂²) is measured (invariant
 * only to linear stretches; equalisation or local contrast can raise it on pure noise).
 * V0.37: J/(J + 6) is multiplied by the spatial coherence of the split: κ = (A − E)/(1 − E), with A the share of
 * horizontal and vertical neighbour pairs on the same side of the threshold and E = p₀² + p₁² the share expected if
 * the pixels were scattered at random (κ ≤ 0 → 0). Noise gives κ ≈ 0 whatever the enhancement; compact traces give κ
 * near 1. Result: mean over the tiles (0–1).
 *
 * @param {ArrayLike<number>} rgba
 * @param {number} w
 * @param {number} h
 * @param {Roi} roi
 * @param {number} [tile]
 */
export function localSeparability(rgba, w, h, roi, tile = 48) {
  let sum = 0, n = 0;
  const hist = new Float64Array(256);
  for (let y0 = roi.y0; y0 < roi.y1; y0 += tile) for (let x0 = roi.x0; x0 < roi.x1; x0 += tile) {
    const x1 = Math.min(roi.x1, x0 + tile), y1 = Math.min(roi.y1, y0 + tile);
    if ((x1 - x0) * (y1 - y0) < tile * tile * 0.4) continue;
    hist.fill(0); let k = 0, s1 = 0, s2 = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const j = (y * w + x) * 4, v = Math.min(255, Math.round(0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2])); hist[v]++; k++; s1 += v; s2 += v * v; }
    if (Math.sqrt(Math.max(0, s2 / k - (s1 / k) ** 2)) < 4) continue;
    const thr = separability(rgba, w, h, { x0, y0, x1, y1 }).threshold;
    let n0 = 0, a0 = 0, b0 = 0, n1 = 0, a1 = 0, b1 = 0;
    for (let v = 0; v < 256; v++) { const c = hist[v]; if (v <= thr) { n0 += c; a0 += c * v; b0 += c * v * v; } else { n1 += c; a1 += c * v; b1 += c * v * v; } }
    if (!n0 || !n1) continue;
    const m0 = a0 / n0, m1 = a1 / n1, v0 = b0 / n0 - m0 * m0, v1 = b1 / n1 - m1 * m1, J = (m1 - m0) ** 2 / Math.max(1e-6, v0 + v1);
    let agree = 0, pairs = 0;
    /** @param {number} x @param {number} y */
    const g = (x, y) => { const j = (y * w + x) * 4; return 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2] > thr + 0.5; };
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const c = g(x, y);
      if (x + 1 < x1) { pairs++; if (g(x + 1, y) === c) agree++; }
      if (y + 1 < y1) { pairs++; if (g(x, y + 1) === c) agree++; }
    }
    const p0 = n0 / k, E = p0 * p0 + (1 - p0) ** 2, kappa = E < 1 ? Math.max(0, (agree / pairs - E) / (1 - E)) : 0;
    sum += (J / (J + 6)) * kappa; n++;
  }
  return n ? sum / n : 0;
}
