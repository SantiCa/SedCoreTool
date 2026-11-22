// SedCoreTool — physical sizes and checks for figures laid out for a journal page (card P1). Pure: no DOM.
// One user unit of a publication SVG is one point (1/72 in), so `font-size="8"` prints at 8 pt. Journal numbers and their sources:
// docs/design-publication-figures.md §2-3. A value marked `stated: false` is not given by the journal; the interface says so.

export const MM_PER_INCH = 25.4;
export const PT_PER_INCH = 72;

/** Okabe-Ito colour-blind-safe categorical palette (Okabe & Ito 2008). */
export const OKABE_ITO = Object.freeze(['#000000', '#E69F00', '#56B4E9', '#009E73', '#F0E442', '#0072B2', '#D55E00', '#CC79A7']);

const FONT = 'Arial, Helvetica, "Liberation Sans", Arimo, sans-serif';

const preset = (id, name, widths, maxHeight, text, lines, label, dpi, extra = {}) => Object.freeze({
  id, name, widths: Object.freeze({ single: widths[0], mid: widths[1], double: widths[2], page: widths[3] }), maxHeight,
  text: Object.freeze({ min: text[0], body: text[1], axis: text[2], label: text[3] }),
  lines: Object.freeze({ min: lines[0], axis: lines[1], data: lines[2] }),
  label, dpi: Object.freeze({ photo: dpi[0], combination: dpi[1], line: dpi[2] }), font: FONT,
  hardMinText: 6, maxHeightStated: true, ...extra,
});

/** Journal presets: widths in mm (single / 1.5 column / double / page), text sizes in pt, line weights in pt, panel-label style and dpi. */
export const PRESETS = Object.freeze({
  generic: preset('generic', 'Generic A4 journal', [84, 129, 170, 170], 225, [7, 8, 8, 9], [0.25, 0.5, 0.75], 'a', [300, 600, 1200]),
  elsevier: preset('elsevier', 'Elsevier', [90, 140, 190, 190], 240, [7, 8, 8, 9], [0.25, 0.5, 0.75], 'a', [300, 500, 1000], { maxHeightStated: false }),
  wiley: preset('wiley', 'Wiley', [80, 129, 180, 180], 225, [7, 8, 8, 9], [0.25, 0.5, 0.75], 'a', [300, 600, 600], { maxHeightStated: false }),
  agu: preset('agu', 'AGU', [85, 129, 170, 170], 225, [6, 8, 8, 9], [0.25, 0.5, 0.75], 'a', [300, 600, 600], { maxHeightStated: false }),
  gsa: preset('gsa', 'GSA', [91, 122.8, 185, 185], 225, [7, 8, 9, 14], [1, 1, 1], 'A', [300, 600, 1200]),
  copernicus: preset('copernicus', 'Copernicus', [84, 129, 170, 170], 225, [7, 8, 8, 9], [0.25, 0.5, 0.75], '(a)', [300, 300, 600], { maxHeightStated: false }),
  nature: preset('nature', 'Nature', [89, 129, 183, 183], 170, [5, 6, 7, 8], [0.25, 0.5, 0.75], 'a', [300, 450, 1200], { hardMinText: 5 }),
  sepm: preset('sepm', 'SEPM', [84, 129, 170, 170], 225, [7, 8, 8, 9], [0.5, 0.5, 0.75], 'A', [300, 300, 300], { maxHeightStated: false }),
  tandf: preset('tandf', 'Taylor & Francis', [84, 129, 170, 170], 225, [7, 8, 8, 9], [0.25, 0.5, 0.75], 'a', [300, 600, 1200], { maxHeightStated: false }),
});

const presetOf = (p) => (typeof p === 'string' ? PRESETS[p] : p) || PRESETS.generic;

/** Millimetres → points (1 pt = 1/72 in). */
export function mmToPt(mm) { return (mm / MM_PER_INCH) * PT_PER_INCH; }

/** Points → millimetres. */
export function ptToMm(pt) { return (pt / PT_PER_INCH) * MM_PER_INCH; }

/** Width in mm of `kind` ('single' | 'mid' | 'double' | 'page') for a preset (id or object); unknown kinds give the double-column width. */
export function widthMm(presetOrId, kind = 'double') {
  const p = presetOf(presetOrId);
  return p.widths[kind] ?? p.widths.double;
}

/** Pixels needed to print `mm` at `dpi`, rounded to the nearest pixel: 170 mm at 600 dpi → 4016. */
export function pixelsFor(mm, dpi) { return Math.round((mm / MM_PER_INCH) * dpi); }

/** Dots per inch → pixels per metre as stored in a PNG `pHYs` chunk (600 dpi → 23622). */
export function pixelsPerMetre(dpi) { return Math.round(dpi / 0.0254); }

/** The dpi a preset asks for an image of `kind` ('photo' | 'combination' | 'line'). */
export function recommendedDpi(presetOrId, kind = 'combination') {
  const p = presetOf(presetOrId);
  return p.dpi[kind] ?? p.dpi.combination;
}

/** Printed size in pt of text drawn at `fontSize` user units: `fontSize × ctmScale × (widthMm / 25.4 × 72) / viewBoxWidth`. */
export function effectiveSize(fontSize, widthMmOfFigure, viewBoxWidth, ctmScale = 1) {
  if (!(viewBoxWidth > 0)) throw new RangeError('viewBoxWidth must be positive');
  return fontSize * ctmScale * mmToPt(widthMmOfFigure) / viewBoxWidth;
}

// Sizes come from floating-point products (7 pt may arrive as 6.999999999999999); a thousandth of a point is far below any printed difference.
const EPS = 1e-3;

/**
 * Text sizes below the preset minimum. `sizesPt` are printed sizes in pt (see `effectiveSize`).
 * @param {number[]} sizesPt
 * @returns {{pt: number, level: 'warning' | 'error'}[]} one entry per offending size: `warning` below the preset minimum, `error` below 6 pt (5 pt for Nature)
 */
export function auditText(sizesPt, presetOrId = 'generic') {
  const p = presetOf(presetOrId), /** @type {{pt: number, level: 'warning' | 'error'}[]} */ out = [];
  for (const pt of sizesPt) {
    if (pt < p.hardMinText - EPS) out.push({ pt, level: 'error' });
    else if (pt < p.text.min - EPS) out.push({ pt, level: 'warning' });
  }
  return out;
}

/**
 * Stroke widths below the preset minimum. `widthsPt` are printed widths in pt.
 * @returns {{pt: number, level: 'warning' | 'error'}[]} `warning` below the preset minimum, `error` below 0.1 pt
 */
export function auditLines(widthsPt, presetOrId = 'generic') {
  const p = presetOf(presetOrId), /** @type {{pt: number, level: 'warning' | 'error'}[]} */ out = [];
  for (const pt of widthsPt) {
    if (pt < 0.1 - EPS) out.push({ pt, level: 'error' });
    else if (pt < p.lines.min - EPS) out.push({ pt, level: 'warning' });
  }
  return out;
}

/**
 * Embedded images whose resolution at the printed size is below what the preset asks for.
 * @param {{pixelWidth: number, widthMm: number, name?: string}[]} images pixel width of the image and the width it prints at
 * @param {'photo' | 'combination' | 'line'} kind
 * @returns {{name?: string, ppi: number, needed: number}[]}
 */
export function auditRaster(images, presetOrId = 'generic', kind = 'photo') {
  const needed = recommendedDpi(presetOrId, kind), out = [];
  for (const im of images) {
    const ppi = im.pixelWidth / (im.widthMm / MM_PER_INCH);
    if (ppi < needed - EPS) out.push({ name: im.name, ppi, needed });
  }
  return out;
}

/**
 * Panel label for the panel at zero-based `index`: style 'a' → a, b, …; 'A' → A, B, …; '(a)' or 'paren' → (a), (b), …; 'plain' is 'a'.
 * After z the label continues aa, ab, …
 */
export function panelLabel(index, style = 'a') {
  if (!Number.isInteger(index) || index < 0) throw new RangeError('index must be a non-negative integer');
  let n = index, letters = '';
  do { letters = String.fromCharCode(97 + (n % 26)) + letters; n = Math.floor(n / 26) - 1; } while (n >= 0);
  if (style === 'A' || style === 'upper') return letters.toUpperCase();
  if (style === '(a)' || style === 'paren') return `(${letters})`;
  return letters;
}

/**
 * Widths that keep the order and the proportions of `natural` and add up, with `gap` between neighbours, to `target` (all in one unit).
 * The last width takes the rounding remainder, so the total is exact.
 * @param {number[]} natural positive widths of the columns as they are today
 * @returns {number[]}
 */
export function fitWidths(natural, target, gap = 0) {
  if (!natural.length) return [];
  if (natural.some((w) => !(w > 0))) throw new RangeError('every natural width must be positive');
  const room = target - gap * (natural.length - 1);
  if (!(room > 0)) throw new RangeError('the gaps leave no room for the columns');
  const sum = natural.reduce((a, b) => a + b, 0), out = natural.map((w) => (w * room) / sum);
  out[out.length - 1] = room - out.slice(0, -1).reduce((a, b) => a + b, 0);
  return out;
}
