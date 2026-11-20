// @ts-check
/**
 * @typedef {{name: string, tiers: readonly (readonly [number, number, number])[], ref?: string}} IndexScheme
 * @typedef {{x0: number, y0: number, x1: number, y1: number}} Roi
 * @typedef {keyof typeof UNIT_TO_CM} DepthUnit
 * @typedef {(number[] | null)[]} StackTable
 * @typedef {{nRows: number, valid: ArrayLike<number>, bio: ArrayLike<number>, cls: ArrayLike<number>, nClasses: number, nCols?: number}} RowCounts
 * @typedef {{index: number, r0: number, r1: number, depth: number, dTop: number, dBottom: number,
 *   valid: number, pct: number | null, noData?: boolean, classPct: (number | null)[], BI: number | null, ii: number | null}} Bin
 * @typedef {{depth: number[], age: number[], min?: number[], max?: number[], rangeIgnored?: number, bacon?: boolean, reversals?: number}} AgeModel
 * @typedef {{model: AgeModel | null, issue: {kind: 'dupDepth', depth: number} | null}} AgeParseResult
 * @typedef {string | number | boolean | null | undefined} CsvCell
 */
// SedCoreTool web — analysis core (no DOM). Mirrors src/sedcoretool/pipeline.py and indices.py.

/** @type {IndexScheme} */
export const BI = {
  name: 'BI',
  tiers: [[0, 1, 0], [1, 5, 1], [5, 31, 2], [31, 61, 3], [61, 91, 4], [91, 100, 5], [100, 101, 6]],
  ref: 'Reineck (1963); Taylor & Goldring (1993)',
};
/** @type {IndexScheme} */
export const II = {
  name: 'ii',
  tiers: [[0, 1, 1], [1, 10, 2], [10, 40, 3], [40, 60, 4], [60, 100, 5], [100, 101, 6]],
  ref: 'Droser & Bottjer (1986)',
};

/**
 * @param {IndexScheme} scheme
 * @param {number | null | undefined} pct
 * @returns {number | null}
 */
export function classify(scheme, pct) {
  if (pct == null || Number.isNaN(pct)) return null;
  for (const [lo, hi, v] of scheme.tiers) if (pct >= lo && pct < hi) return v;
  return null;
}

/* ───────── V0.20: overlapping traces ─────────
 * labels[i] > 0: one object id; 0: matrix; < 0: stack −labels[i] in `stacks` (list of ids, bottom → top).
 * stacks[0] is unused. Treat stack entries as immutable so undo can share them independently of their codes.
 */
/** @type {number[]} */
const NO_IDS = [];
/**
 * @param {number} v
 * @param {StackTable} stacks
 * @returns {number[]}
 */
export const idsAt = (v, stacks) => (v > 0 ? [v] : v < 0 ? /** @type {number[]} */ (stacks[-v]) : NO_IDS);
/**
 * @param {number} v
 * @param {StackTable} stacks
 * @returns {number}
 */
export const topAt = (v, stacks) => {
  if (v >= 0) return v;
  const ids = /** @type {number[]} */ (stacks[-v]);
  return ids[ids.length - 1];
};
/**
 * @param {number} v
 * @param {number} id
 * @param {StackTable} stacks
 * @returns {boolean}
 */
export const hasId = (v, id, stacks) => v === id || (v < 0 && (/** @type {number[]} */ (stacks[-v])).includes(id));
/** Index key → code of a stack table (rebuilt when a table is loaded).
 *
 * @param {StackTable} stacks
 * @returns {Map<string, number>}
 */
export function stackIndex(stacks) { const m = new Map(); for (let k = 1; k < stacks.length; k++) m.set((/** @type {number[]} */ (stacks[k])).join(','), k); return m; }
/** Pixel value for an ordered list of ids (0, the id itself, or a negative stack code; new stacks are appended).
 *
 * @param {readonly number[]} ids
 * @param {StackTable} stacks
 * @param {Map<string, number>} index
 * @returns {number}
 */
export function codeFor(ids, stacks, index) {
  if (!ids.length) return 0;
  if (ids.length === 1) return ids[0];
  const key = ids.join(',');
  let k = index.get(key);
  if (k == null) { k = stacks.length; stacks.push(ids.slice()); index.set(key, k); }
  return -k;
}
/** Value with id on top (moved to the top if already present).
 *
 * @param {number} v
 * @param {number} id
 * @param {StackTable} stacks
 * @param {Map<string, number>} index
 */
export function withId(v, id, stacks, index) { if (v === 0 || v === id) return id; return codeFor([...idsAt(v, stacks).filter((x) => x !== id), id], stacks, index); }
/** Value without id.
 *
 * @param {number} v
 * @param {number} id
 * @param {StackTable} stacks
 * @param {Map<string, number>} index
 */
export function withoutId(v, id, stacks, index) { if (v === id) return 0; if (v >= 0) return v; return codeFor((/** @type {number[]} */ (stacks[-v])).filter((x) => x !== id), stacks, index); }
/** Value with id `a` renamed to `b` (used to split and to merge; if b is already in the stack, a is just dropped).
 *
 * @param {number} v
 * @param {number} a
 * @param {number} b
 * @param {StackTable} stacks
 * @param {Map<string, number>} index
 */
export function renameId(v, a, b, stacks, index) {
  if (v === a) return b; if (v >= 0) return v;
  const ids = /** @type {number[]} */ (stacks[-v]); if (!ids.includes(a)) return v;
  return codeFor(ids.includes(b) ? ids.filter((x) => x !== a) : ids.map((x) => (x === a ? b : x)), stacks, index);
}
/** Drop unused stacks and renumber the codes in labels (in place; step = 2 for an RLE array). Returns the new table.
 *
 * @param {number[] | Int32Array} labels
 * @param {StackTable | null | undefined} stacks
 * @param {number} [step]
 * @returns {StackTable}
 */
export function compactStacks(labels, stacks, step = 1) {
  if (!stacks || stacks.length < 2) return [null];
  const map = new Int32Array(stacks.length);
  /** @type {StackTable} */
  const out = [null];
  for (let i = 0; i < labels.length; i += step) {
    const v = labels[i]; if (v >= 0 || (step === 2 && labels[i + 1] === 0)) continue;
    let k = map[-v]; if (!k) { k = map[-v] = out.length; out.push(stacks[-v]); }
    labels[i] = -k;
  }
  return out;
}

export const UNIT_TO_CM = { mm: 0.1, cm: 1, m: 100 };
/** Years per age unit of the program (`a`, `ka`, `Ma`). */
export const AGE_YEARS = { a: 1, ka: 1000, Ma: 1e6 };

/**
 * Card Q3: the unit a record's axis column is probably in, from its header ("Depth (mbsf)" → m, "depth_cm" → cm, "Age (ka BP)" → ka);
 * null when the header does not say.
 * @param {string} header @param {'depth' | 'age'} axis @returns {string | null}
 */
export function guessRecordUnit(header, axis) {
  const h = String(header || '').toLowerCase();
  if (axis === 'depth') {
    if (/\bmm\b|_mm\b|\(mm\)/.test(h)) return 'mm';
    if (/\bcm\b|_cm\b|\(cm\)/.test(h)) return 'cm';
    if (/mbsf|mcd|ccsf|csf|\bm\b|_m\b|\(m\)|metres|meters/.test(h)) return 'm';
    return null;
  }
  if (/\bma\b|myr|\(ma\)|_ma\b/.test(h)) return 'Ma';
  if (/\bka\b|kyr|\(ka|_ka\b|cal ka/.test(h)) return 'ka';
  if (/\byr|years|años|\ba\b|\bbp\b|\(a\)|cal yr/.test(h)) return 'a';
  return null;
}

/**
 * Card Q3: the factor that turns values in `from` into `to` (depth units or age units); 1 when either is unknown.
 * @param {string} from @param {string} to @param {'depth' | 'age'} axis
 */
export function unitFactor(from, to, axis) {
  const table = /** @type {Record<string, number>} */ (axis === 'depth' ? UNIT_TO_CM : AGE_YEARS);
  return table[from] && table[to] ? table[from] / table[to] : 1;
}

/**
 * Card Q3: whether two ranges overlap (a record that lies wholly outside its core's range is probably in another unit).
 * @param {readonly number[]} xs @param {number} lo @param {number} hi
 */
export function rangeOverlaps(xs, lo, hi) {
  let min = Infinity, max = -Infinity;
  for (const x of xs) { if (x < min) min = x; if (x > max) max = x; }
  return xs.length > 0 && max >= Math.min(lo, hi) && min <= Math.max(lo, hi);
}

/**
 * Per-row pixel counts inside the ROI.
 * effClass[id] = class index counted as bioturbation, or -1 (not counted).
 *
 * @param {{labels: ArrayLike<number>, width: number, roi: Roi, exclude?: ArrayLike<number> | null,
 *   effClass: ArrayLike<number>, nClasses: number, stacks?: StackTable | null}} options
 * @returns {RowCounts}
 */
export function rowCounts({ labels, width, roi, exclude, effClass, nClasses, stacks = null }) {
  // V0.20: in an overlap (stack) the pixel is bioturbated once, and once for each distinct class present,
  // so the class percentages may add up to more than the total.
  const { x0, x1, y0, y1 } = roi;
  const nRows = y1 - y0;
  const valid = new Uint32Array(nRows);
  const bio = new Uint32Array(nRows);
  const cls = new Uint32Array(nRows * nClasses);
  const seen = new Int32Array(nClasses); let stamp = 0;
  for (let r = 0; r < nRows; r++) {
    const base = (y0 + r) * width;
    let v = 0, b = 0;
    for (let x = x0; x < x1; x++) {
      const i = base + x;
      if (exclude && exclude[i]) continue;
      v++;
      const id = labels[i];
      if (id > 0) {
        const c = effClass[id];
        if (c >= 0) { b++; cls[r * nClasses + c]++; }
      } else if (id < 0) {
        stamp++; let any = false;
        for (const o of /** @type {number[]} */ ((/** @type {StackTable} */ (stacks))[-id])) { const c = effClass[o]; if (c >= 0 && seen[c] !== stamp) { seen[c] = stamp; any = true; cls[r * nClasses + c]++; } }
        if (any) b++;
      }
    }
    valid[r] = v; bio[r] = b;
  }
  return { nRows, valid, bio, cls, nClasses, nCols: x1 - x0 };
}

/**
 * Aggregate rows into bins of binPx rows (last partial bin kept, as in the Python package).
 * V0.1: binPx may be fractional (an interval given in cm × px/cm); bin j spans rows
 * [⌊j·binPx + ½⌋, ⌊(j+1)·binPx + ½⌋), so the boundaries never drift. Integer binPx gives the old bins.
 *
 * @param {number} j
 * @param {number} binPx
 */
export const binEdge = (j, binPx) => Math.floor(j * binPx + 0.5);
/**
 * @param {RowCounts} counts
 * @param {{top: number, bottom: number, binPx: number, minValid?: number}} options
 * @returns {Bin[]}
 */
export function binRows(counts, { top, bottom, binPx, minValid = 0 }) {
  const { nRows, valid, bio, cls, nClasses, nCols = 0 } = counts;
  const step = (bottom - top) / nRows;
  const out = [];
  binPx = Math.max(1, binPx);
  for (let j = 0, r0 = 0; r0 < nRows; j++, r0 = binEdge(j, binPx)) {
    const r1 = Math.min(nRows, binEdge(j + 1, binPx));
    let v = 0, b = 0;
    const c = /** @type {number[]} */ (new Array(nClasses).fill(0));
    for (let r = r0; r < r1; r++) {
      v += valid[r]; b += bio[r];
      for (let k = 0; k < nClasses; k++) c[k] += cls[r * nClasses + k];
    }
    // V0.3: an interval with less than minValid (fraction) of its pixels valid (not excluded) has no data (null, not 0)
    const ok = v > 0 && !(minValid > 0 && nCols > 0 && v < minValid * (r1 - r0) * nCols);
    const pct = ok ? (b / v) * 100 : null;
    out.push({
      index: out.length, r0, r1,
      depth: top + ((r0 + r1) / 2) * step,
      dTop: top + r0 * step, dBottom: top + r1 * step,
      valid: v, pct, ...(ok ? {} : { noData: true }),
      classPct: c.map((x) => (ok ? (x / v) * 100 : null)),
      BI: classify(BI, pct), ii: classify(II, pct),
    });
  }
  return out;
}

/**
 * Age model "depth, age[, min, max]" per line; comment (#) and invalid lines ignored.
 * V0.37: decimal comma when the separator is ";" or tab ("10,5;3,2"); a header line picks the columns by name
 * (depth/prof…, age/edad/median/mean, min/lower, max/upper); without a header the 3rd and 4th columns are an age
 * range only if every row has min ≤ age ≤ max. m.bacon flags a pasted Bacon table (depth, min, max, median, mean).
 *
 * @param {string | null | undefined} text
 * @returns {AgeModel | null}
 */
export function parseAgeModel(text) { return parseAgeModelDetailed(text).model; }
/**
 * Same as parseAgeModel, also returning why a text was rejected: {model, issue}. issue = {kind: 'dupDepth', depth}
 * when one depth has two different ages (repeated identical rows are merged). A hiatus must be written as two
 * depths a small distance apart.
 *
 * @param {string | null | undefined} text
 * @returns {AgeParseResult}
 */
export function parseAgeModelDetailed(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  /** @param {string} l */
  const split = (l) => (/[;\t]/.test(l) ? l.split(/\s*[;\t]\s*/).map((x) => x.replace(/\s+/g, '').replace(',', '.')) : l.includes(',') ? l.split(/\s*,\s*/) : l.split(/\s+/));
  let iD = 0, iA = 1, iMin = 2, iMax = 3, named = false, bacon = false;
  const first = lines.length ? split(lines[0]).map((x) => x.replace(/"/g, '').toLowerCase()) : [];
  if (first.length >= 2 && first.some((x) => x && !Number.isFinite(Number(x)))) {   // header line
    /** @param {RegExp} re */
    const find = (re) => first.findIndex((x) => re.test(x));
    bacon = ['depth', 'min', 'max', 'median', 'mean'].every((k) => first.includes(k));
    const d = find(/^(depth|prof|mcd|mbsf|cmcd|ccsf|z)/), a = find(/^(age|edad|median|mean|cal)/);
    iD = d >= 0 ? d : 0; iA = a >= 0 ? a : (iD === 0 ? 1 : 0);
    iMin = find(/^(min|lower|low|age_?min|2\.5)/); iMax = find(/^(max|upper|high|age_?max|97\.5)/); named = true;
    lines.shift();
  }
  const pts = [];
  for (const line of lines) {
    const p = split(line).map((v) => v === '' ? NaN : Number(v));
    if (Number.isFinite(p[iD]) && Number.isFinite(p[iA])) pts.push([p[iD], p[iA], iMin >= 0 ? p[iMin] : NaN, iMax >= 0 ? p[iMax] : NaN]);
  }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  /** @param {number[]} p @param {number[]} q */
  const same = (p, q) => p.every((v, k) => v === q[k] || (Number.isNaN(v) && Number.isNaN(q[k])));
  for (let i = pts.length - 1; i > 0; i--) if (pts[i][0] === pts[i - 1][0]) {
    if (same(pts[i], pts[i - 1])) pts.splice(i, 1);
    else return { model: null, issue: { kind: 'dupDepth', depth: pts[i][0] } };
  }
  if (pts.length < 2) return { model: null, issue: null };
  /** @type {AgeModel} */
  const m = { depth: pts.map((p) => p[0]), age: pts.map((p) => p[1]) };
  // V0.28: age range (e.g. the 95 % interval of a Bacon model), only if every row has one that contains the age
  /** @param {number[]} p */
  const lo = (p) => Math.min(p[2], p[3]);
  /** @param {number[]} p */
  const hi = (p) => Math.max(p[2], p[3]);
  // a named range column with blank or inconsistent cells is ignored (the model is kept without range) and reported
  const badRange = pts.filter((p) => !Number.isFinite(p[2]) || !Number.isFinite(p[3]) || p[1] < lo(p) || p[1] > hi(p)).length;
  if (!badRange) { m.min = pts.map(lo); m.max = pts.map(hi); }
  else if (named && iMin >= 0 && iMax >= 0) m.rangeIgnored = badRange;
  if (bacon) m.bacon = true;
  // reversals (age decreasing downwards) make depth↔age conversion ambiguous: flagged for the interface
  m.reversals = m.age.reduce((k, a, i) => k + (i && a < m.age[i - 1] ? 1 : 0), 0);
  return { model: m, issue: null };
}

/** Linear interpolation; null outside the model (no extrapolation).
 *
 * @param {AgeModel | null | undefined} model
 * @param {number | null | undefined} d
 * @returns {number | null}
 */
export function interpAge(model, d) {
  if (!model || d == null) return null;
  const { depth, age } = model;
  if (d < depth[0] || d > depth[depth.length - 1]) return null;
  let lo = 0, hi = depth.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (depth[m] <= d) lo = m; else hi = m; }
  const span = depth[hi] - depth[lo];
  return span ? age[lo] + ((d - depth[lo]) / span) * (age[hi] - age[lo]) : age[lo];
}

/** V0.28: age range at depth d, linearly interpolated like the central age; null without a range or outside the model.
 *
 * @param {AgeModel | null | undefined} model
 * @param {number | null | undefined} d
 */
export function interpAgeRange(model, d) {
  if (!model?.min || d == null) return null;
  const lo = interpAge({ depth: model.depth, age: model.min }, d), hi = interpAge({ depth: model.depth, age: /** @type {number[]} */ (model.max) }, d);
  return lo == null ? null : { min: lo, max: hi };
}

/**
 * V0.28: age–depth table written by Bacon (rbacon, *_ages.txt: depth, min, max, median, mean; depth in cm,
 * ages in cal yr BP, min–max = 95 % interval). Returns age-model text in the core units: "depth, age, min, max".
 * center: 'median' (default) or 'mean'; depthUnit: unit of the core depths; ageDiv: years per age unit (ka = 1000).
 *
 * @param {string | null | undefined} text
 * @param {{center?: string, depthUnit?: DepthUnit, ageDiv?: number}} [options]
 * @returns {string[] | null}
 */
export function baconToAgeText(text, { center = 'median', depthUnit = 'cm', ageDiv = 1000 } = {}) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return null;
  const head = lines[0].trim().replace(/"/g, '').toLowerCase().split(/[,;\t ]+/);
  /** @param {string} k */
  const col = (k) => head.indexOf(k);
  const iD = col('depth'), iMin = col('min'), iMax = col('max'), iC = col(center) >= 0 ? col(center) : col('median') >= 0 ? col('median') : col('mean');
  if (iD < 0 || iMin < 0 || iMax < 0 || iC < 0) return null;
  const f = 1 / UNIT_TO_CM[depthUnit], out = [];
  /** @param {number} v */
  const r = (v) => +(+v).toPrecision(8);
  for (const l of lines.slice(1)) {
    const p = l.trim().split(/[,;\t ]+/).map(Number);
    if ([iD, iMin, iMax, iC].some((i) => !Number.isFinite(p[i]))) continue;
    out.push(`${r(p[iD] * f)}, ${r(p[iC] / ageDiv)}, ${r(p[iMin] / ageDiv)}, ${r(p[iMax] / ageDiv)}`);
  }
  return out.length >= 2 ? out : null;
}

/**
 * @param {readonly (readonly CsvCell[])[]} rows
 * @returns {string}
 */
export function toCSV(rows) {
  /** @param {CsvCell} value */
  const formatCell = (value) => {
    if (value == null) return '';
    if (typeof value === 'number') {
      // Card Q4 (decision N): 15 significant digits, so that small values (a mass susceptibility of 1e-8) are kept and binary noise
      // (0.30000000000000004) is not written; a value that is not a finite number is an empty cell.
      if (!Number.isFinite(value)) return '';
      return String(Number.isInteger(value) ? value : +value.toPrecision(15));
    }
    let text = String(value);
    if (/^[ \u00a0]*[\t\r\n]/.test(text) || /^[\s\u0000-\u001f]*[=+@\-＝＋－＠]/u.test(text)) text = "'" + text;
    return /[",;|\t\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return rows.map((row) => row.map(formatCell).join(',')).join('\n') + '\n';
}

/**
 * The largest gap a record's values are interpolated across: 3 × the median spacing of its samples that have a value (card Q4; the rule of
 * the cursor and of multiproxy resampling, `geo.js::autoGap`). Infinity with fewer than two distinct positions.
 * @param {readonly (number | null)[]} xs @param {readonly (number | null)[]} ys @returns {number}
 */
export function seriesGap(xs, ys) {
  const x = /** @type {number[]} */ (xs.filter((v, i) => v != null && ys[i] != null)).sort((a, b) => a - b);
  const d = x.slice(1).map((v, i) => v - x[i]).filter((v) => v > 0).sort((a, b) => a - b);
  return d.length ? 3 * d[d.length >> 1] : Infinity;
}

/**
 * A record's samples sorted once (card Q4): `at(x)` is the linear interpolation at x, null outside the samples or across a gap wider than
 * `maxGap`; `mean(lo, hi)` is the mean and the number of the samples with lo <= x < hi (`{mean: null, n: 0}` when there are none).
 * @param {readonly (number | null)[]} xs @param {readonly (number | null)[]} ys @param {number} [maxGap]
 */
export function seriesSampler(xs, ys, maxGap = seriesGap(xs, ys)) {
  const p = xs.map((x, i) => [x, ys[i]]).filter((q) => q[0] != null && q[1] != null && Number.isFinite(q[0]) && Number.isFinite(q[1]))
    .sort((a, b) => /** @type {number} */ (a[0]) - /** @type {number} */ (b[0]));
  const X = p.map((q) => /** @type {number} */ (q[0])), Y = p.map((q) => /** @type {number} */ (q[1]));
  const first = (/** @type {number} */ v) => { let lo = 0, hi = X.length; while (lo < hi) { const m = (lo + hi) >> 1; if (X[m] < v) lo = m + 1; else hi = m; } return lo; };
  return {
    /** @param {number | null} x */
    at(x) {
      if (x == null || !X.length || x < X[0] || x > X[X.length - 1]) return null;
      const i = first(x);
      if (X[i] === x) return Y[i];
      const lo = i - 1, hi = i;
      if (X[hi] - X[lo] > maxGap) return null;
      return Y[lo] + ((x - X[lo]) / (X[hi] - X[lo])) * (Y[hi] - Y[lo]);
    },
    /** @param {number | null} lo @param {number | null} hi */
    mean(lo, hi) {
      if (lo == null || hi == null) return { mean: null, n: 0 };
      let sum = 0, n = 0;
      for (let i = first(Math.min(lo, hi)); i < X.length && X[i] < Math.max(lo, hi); i++) { sum += Y[i]; n++; }
      return { mean: n ? sum / n : null, n };
    },
  };
}

/** Run-length encoding for label/exclusion layers in project files: [value, run, value, run, ...].
 *
 * @param {ArrayLike<number>} arr
 * @returns {number[]}
 */
export function rleEncode(arr) {
  /** @type {number[]} */
  const out = [];
  if (!arr.length) return out;
  let prev = arr[0], run = 1;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] === prev) run++;
    else { out.push(prev, run); prev = arr[i]; run = 1; }
  }
  out.push(prev, run);
  return out;
}

/** V0.36: an RLE mask is valid when its runs are non-negative integers that add up to exactly n pixels.
 *
 * @param {unknown} rle
 * @param {number} n
 * @returns {boolean}
 */
export function rleValid(rle, n) {
  if (!Array.isArray(rle) && !ArrayBuffer.isView(rle)) return false;
  const values = /** @type {ArrayLike<number>} */ (rle);
  if (values.length % 2) return false;
  let p = 0; for (let k = 1; k < values.length; k += 2) { const r = values[k]; if (!(r >= 0) || r !== Math.floor(r)) return false; p += r; }
  return p === n;
}

/**
 * @overload
 * @param {ArrayLike<number>} rle
 * @param {number} n
 * @returns {Int32Array}
 */
/**
 * @template {{fill(value: number, start?: number, end?: number): unknown}} T
 * @overload
 * @param {ArrayLike<number>} rle
 * @param {number} n
 * @param {new (length: number) => T} Type
 * @returns {T}
 */
/**
 * @param {ArrayLike<number>} rle
 * @param {number} n
 * @param {new (length: number) => {fill(value: number, start?: number, end?: number): unknown}} [Type]
 */
export function rleDecode(rle, n, Type = Int32Array) {
  const out = new Type(n);
  let p = 0;
  for (let k = 0; k < rle.length; k += 2) { out.fill(rle[k], p, p + rle[k + 1]); p += rle[k + 1]; }
  return out;
}
