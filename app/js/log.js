// SedCoreTool web — composite core log (no DOM): table parsing, axis transforms, SVG and CSV of a window.
import { interpAge, toCSV, seriesSampler } from './core.js';

/** Normalise optional saved event presentation at the rendering/editing boundary. */
export function eventShadeOptions(value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const styles = Object.fromEntries(Object.entries(raw.styles && typeof raw.styles === 'object' && !Array.isArray(raw.styles) ? raw.styles : {}).map(([key, value]) => {
    const style = value && typeof value === 'object' ? value : {}, opacity = style.opacity;
    const colors = Object.fromEntries(Object.entries(style.colors && typeof style.colors === 'object' ? style.colors : {}).filter(([, color]) => validHexColor(color, null)));
    return [key, { opacity: typeof opacity === 'number' && Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 0.22, colors }];
  }));
  return { on: raw.on === true, sources: [...new Set((Array.isArray(raw.sources) ? raw.sources : []).filter((key) => typeof key === 'string'))],
    mode: raw.mode === 'split' ? 'split' : 'mix', area: raw.area === 'curve' ? 'curve' : 'panel', styles };
}

/** Compose figure-only event shading from selected interval/classifier bands, without changing their data. */
export function eventShading(bands, settings) {
  settings = eventShadeOptions(settings);
  if (!settings.on) return {};
  const sources = settings.sources.map((key) => bands.find((band) => band.key === key)).filter(Boolean);
  const split = settings.mode === 'split', shadeLegend = [], seen = new Set();
  const shade = sources.flatMap((band, lane) => {
    const style = settings.styles[band.key] || { opacity: 0.22, colors: {} }, fo = style.opacity;
    return band.segs.map((segment) => {
      const color = validHexColor(style.colors?.[segment.label], validHexColor(segment.color, '#999999'));
      const key = band.key + ':' + segment.label;
      if (!seen.has(key)) {
        seen.add(key); shadeLegend.push({ name: `${band.title} · ${segment.name || segment.label}`, color });
      }
      return { ...segment, color, fo, lane: split ? lane : 0, source: band.key };
    });
  });
  return { shade, shadeLanes: split ? Math.max(1, sources.length) : 1, shadeArea: settings.area === 'curve' ? 'curve' : 'panel', shadeLegend };
}

/** Event rectangles behind a record, optionally clipped between its curve and the axis baseline. */
function recordShadingSVG(shade, { column, points, sx, y, from, to, lanes, area }) {
  if (!shade?.length) return '';
  let clip = '', clipAttribute = '';
  if (area === 'curve') {
    const paths = []; let run = [];
    const closeRun = () => {
      if (run.length > 1) paths.push(`M${sx.base} ${y(run[0][0])} ` + run.map((p) => `L${sx(p[1])} ${y(p[0])}`).join(' ') + ` L${sx.base} ${y(run[run.length - 1][0])} Z`);
      run = [];
    };
    for (const point of points) {
      if (point[0] == null || point[1] == null || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || (sx.log && point[1] <= 0)) closeRun();
      else run.push(point);
    }
    closeRun();
    const id = `event-area-${column.x}`;
    clip = `<defs><clipPath id="${id}"><path d="${paths.join(' ')}"/></clipPath></defs>`;
    clipAttribute = ` clip-path="url(#${id})"`;
  }
  const count = Math.max(1, lanes || 1);
  const rectangles = shade.filter((segment) => segment.a1 > from && segment.a0 < to).map((segment) =>
    `<rect data-event-source="${escXml(segment.source || '')}" x="${f2(column.x + ((segment.lane || 0) * column.w) / count)}" y="${y(Math.max(segment.a0, from))}" width="${f2(column.w / count)}" height="${f2(Math.max(0.4, y(Math.min(segment.a1, to)) - y(Math.max(segment.a0, from))))}" fill="${validHexColor(segment.color, '#999999')}" fill-opacity="${Number.isFinite(+segment.fo) ? Math.max(0, Math.min(1, +segment.fo)) : 0.22}"/>`);
  return `${clip}<g data-role="event-shading"${clipAttribute}>${rectangles.join('')}</g>`;
}

/** Card Q2: numeric codes that mean "no value" in laboratory files (-999 of many instruments, -999.25 of LAS, -9999). */
export const MISSING_CODES = Object.freeze([-999, -999.25, -9999]);
/** Card Q2: text that means "below the detection limit" when it has no number: bdl, b.d.l., n.d., <dl, <ld. */
const CENSORED_TEXT = /^(b\.?d\.?l\.?|n\.?d\.?|<\s*(d\.?l\.?|l\.?d\.?))$/i;

/**
 * Parse CSV / TXT tables: delimiter , ; tab | or spaces; optional header; decimal comma; '#' comments.
 * Card Q2: lines before the first line with the table's shape are a preamble and are skipped; the decimal separator is decided per column
 * ("0.500" is never 500; "1,250" in a column without other evidence is reported as ambiguous); values equal to a missing-value code are
 * empty; values below a detection limit ("<0.01", "bdl") follow `censored` (decision M: `empty` by default, `half` or `limit` of the stated
 * limit); repeated header names get a suffix; every cell read as empty, row skipped or name changed is counted in the result.
 * @param {string} text
 * @param {{missing?: readonly number[], censored?: 'empty' | 'half' | 'limit'}} [options]
 */
export function parseTable(text, { missing = MISSING_CODES, censored = 'empty' } = {}) {
  const all = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() && !/^\s*#/.test(l));
  const empty = { headers: [], rows: [], text: [], dropped: 0, droppedCols: [], short: 0, long: 0, preamble: 0, missingCodes: 0, censored: 0,
    renamed: [], ambiguousCols: [] };
  if (!all.length) return empty;
  // V0.38: fields between double quotes may contain the delimiter ("a, b") and "" for a quote
  const splitQ = (l, d) => {
    if (!l.includes('"')) return l.split(d);
    const out = []; let cur = '', q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (q) { if (ch === '"') { if (l[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"' && !cur.trim()) { q = true; cur = ''; }
      else if (l.startsWith(d, i)) { out.push(cur); cur = ''; i += d.length - 1; }
      else cur += ch;
    }
    out.push(cur); return out;
  };
  // Card Q2: the delimiter is the one giving the same number (> 1) of fields on most of the first 30 lines; lines before the first line with
  // that number are a preamble (a title, an instrument's notes). Without such a delimiter: spaces, as before.
  const probe = all.slice(0, 30);
  const mode = (counts) => { const f = new Map(); for (const c of counts) if (c > 1) f.set(c, (f.get(c) || 0) + 1); return [...f].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0] || [0, 0]; };
  const choices = ['\t', ';', ',', '|'].map((d) => { const [n, k] = mode(probe.map((l) => splitQ(l, d).length)); return { d, n, k }; });
  const best = choices.filter((c) => c.n > 1 && c.k >= Math.max(1, probe.length - (probe.length > 2 ? 1 : 0) - choices.reduce(() => 0, 0)) * 0.5)
    .sort((a, b) => b.k - a.k)[0];
  const delim = best ? best.d : /\s+/;
  const width = (l) => (delim instanceof RegExp ? l.trim().split(delim).length : splitQ(l, delim).length);
  let skip = 0;
  if (best) while (skip < all.length - 1 && width(all[skip]) < best.n) skip++;
  const lines = all.slice(skip);
  const split = (l) => (delim instanceof RegExp ? l.trim().split(delim) : splitQ(l, delim)).map((c) => c.trim().replace(/^"(.*)"$/, '$1'));
  const firstCells = split(lines[0]);
  const looksNumber = (c) => /^[-+]?(\d[\d., ]*|\.\d+)([eE][-+]?\d+)?$/.test(c);
  const hasHeader = firstCells.some((c) => c !== '' && !looksNumber(c) && !CENSORED_TEXT.test(c) && !/^<\s*[\d.,]+$/.test(c));
  const names = hasHeader ? firstCells : firstCells.map((_, i) => `col${i + 1}`);
  const seen = new Map(), renamed = [];
  const headers = names.map((h) => {                                   // card Q2: a repeated name gets " (2)", " (3)"…
    const k = (seen.get(h) || 0) + 1; seen.set(h, k);
    if (k === 1) return h;
    renamed.push(h); return `${h} (${k})`;
  });
  const body = (hasHeader ? lines.slice(1) : lines).map(split);
  const cells = body.map((c) => headers.map((_, i) => c[i] ?? ''));
  // Card Q2: decimal separator per column. Evidence for a decimal comma: "1,5", "12,3456", "1.234,5"; for a decimal point: "1.5", "1,234.5".
  // A column whose only commas are "1,250"-like (three digits after each comma) has no evidence: ambiguous, read as before (decimal comma
  // unless the delimiter is a comma) and reported.
  const commaDecimal = /^[-+]?\d+,(\d{1,2}|\d{4,})$|^[-+]?\d{1,3}(\.\d{3})+,\d+$/, pointDecimal = /^[-+]?\d*\.\d+$|^[-+]?\d{1,3}(,\d{3})+\.\d+$/;
  const threeAfterComma = /^[-+]?\d{1,3}(,\d{3})+$/;
  const ambiguousCols = [];
  const columnComma = headers.map((h, i) => {
    if (delim === ',') return false;
    const col = cells.map((r) => r[i].replace(/^</, '').trim()).filter(Boolean);
    const comma = col.some((c) => commaDecimal.test(c)), point = col.some((c) => pointDecimal.test(c) && !/^[-+]?0\.\d{3}$/.test(c) || /^[-+]?\d{1,3}(,\d{3})+\.\d+$/.test(c));
    if (comma && !point) return true;
    if (point && !comma) return false;
    if (!comma && !point && col.some((c) => threeAfterComma.test(c))) { ambiguousCols.push(h); return true; }
    return comma;
  });
  let missingCodes = 0, censoredCount = 0;
  const number = (c, comma) => {
    let x = c.replace(/^\+/, '');
    if (comma && /^-?[1-9]\d{0,2}(\.\d{3})+(,\d+)?$/.test(x)) x = x.replace(/\./g, '');                 // "1.234,5"; "0.500" is never 500
    else if (!comma && delim !== ',' && /^-?[1-9]\d{0,2}(,\d{3})+(\.\d+)?$/.test(x)) x = x.replace(/,/g, ''); // "1,234.5"
    if (/^-?\d{1,3}( \d{3})+([.,]\d+)?$/.test(x)) x = x.replace(/ /g, '');
    const v = Number(comma ? x.replace(',', '.') : x);
    return Number.isFinite(v) ? v : null;
  };
  const value = (c, i) => {
    if (c == null || c === '') return null;
    if (CENSORED_TEXT.test(c)) { censoredCount++; return null; }
    const below = /^<\s*(.+)$/.exec(c);
    if (below) {
      const limit = number(below[1], columnComma[i]);
      if (limit == null) return null;
      censoredCount++;
      return censored === 'limit' ? limit : censored === 'half' ? limit / 2 : null;
    }
    const v = number(c, columnComma[i]);
    if (v != null && missing.includes(v)) { missingCodes++; return null; }
    return v;
  };
  const rows = cells.map((r) => r.map((c, i) => value(c, i)));
  // V0.38: cells with text in mostly numeric columns are read as empty: counted so the interface can warn
  let dropped = 0; const droppedCols = [];
  headers.forEach((h, i) => {
    const filled = cells.filter((r) => r[i] !== '' && !CENSORED_TEXT.test(r[i]) && !/^<\s*/.test(r[i]) && !missing.includes(number(r[i], columnComma[i]) ?? NaN));
    const ok = rows.filter((r) => r[i] != null).length, bad = filled.length - Math.min(ok, filled.length);
    if (bad > 0 && ok >= bad) { dropped += bad; droppedCols.push(h); }
  });
  const short = body.filter((c) => c.length < headers.length).length, long = body.filter((c) => c.length > headers.length).length;
  return { headers, rows, text: cells, dropped, droppedCols, short, long, preamble: skip, missingCodes, censored: censoredCount, renamed, ambiguousCols };
}

/** V0.38: text of a file, as UTF-8 or, if it is not valid UTF-8 (e.g. Excel CSV on Windows), as Windows-1252. */
export function decodeText(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  // Card Q2: Excel's "Unicode text" and other UTF-16 files start with a byte-order mark
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return new TextDecoder('windows-1252').decode(b); }
}

/** Guess which column holds depth/age and which axis it is. */
export function guessAxisColumn(headers) {
  const i = headers.findIndex((h) => /age|edad|\bka\b|\bma\b|yr|años|cal/i.test(h));
  const j = headers.findIndex((h) => /depth|prof|mbsf|csf|ccsf|mcd|\bm\b|cm/i.test(h));
  if (j >= 0) return { col: j, axis: 'depth' };
  if (i >= 0) return { col: i, axis: 'age' };
  return { col: 0, axis: 'depth' };
}

export function niceTicks(a, b, n = 5) {
  if (!(b > a)) return [a];
  const raw = (b - a) / n, mag = 10 ** Math.floor(Math.log10(raw));
  const st = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const out = [];
  for (let v = Math.ceil(a / st - 1e-9) * st; v <= b + st * 1e-9; v += st) out.push(+v.toFixed(10));
  return out;
}

/** Vertical ticks in displayed units, shared by column and publication figures. */
export function verticalTicks(from, to, height, style = {}) {
  const f = +style.yFactor || 1, step = +style.yStep;
  if (step > 0) {
    const out = [], a = Math.ceil(from * f / step - 1e-9), b = Math.floor(to * f / step + 1e-9);
    for (let k = a; k <= b && out.length < 400; k++) out.push(k * step / f || 0);
    return out;
  }
  return niceTicks(from * f, to * f, style.yDiv > 0 ? style.yDiv : Math.max(3, Math.round(height / 70))).map((v) => v / f);
}

/**
 * V0.22: extra ticks of the vertical axis without labels. Steps are in displayed units (× yFactor):
 * yMajor = long ticks, yMedium = medium ticks (V0.69), yMinor = short ticks (none by default). Where several coincide the
 * highest level wins: labelled > long > medium > short. Lengths: yMajorLen, yMediumLen, yMinorLen. Returns [{ v, len }] in axis units,
 * skipping positions that already carry a labelled tick (or a long tick, for the short ones).
 */
export function extraTicks(from, to, height, style = {}) {
  const f = +style.yFactor || 1, out = [], lab = verticalTicks(from, to, height, style), eps = Math.abs(to - from) * 1e-7 + 1e-12;
  const near = (list, v) => list.some((u) => Math.abs(u - v) < eps);
  const steps = (step) => { const r = []; if (!(step > 0)) return r; const a = Math.ceil(Math.min(from, to) * f / step - 1e-9), b = Math.floor(Math.max(from, to) * f / step + 1e-9); if (b - a > 4000) return r; for (let k = a; k <= b; k++) r.push(k * step / f || 0); return r; };
  const major = steps(+style.yMajor).filter((v) => !near(lab, v));
  const medium = steps(+style.yMedium).filter((v) => !near(lab, v) && !near(major, v));
  const minor = steps(+style.yMinor).filter((v) => !near(lab, v) && !near(major, v) && !near(medium, v));
  const len = (k, d) => (+style[k] > 0 ? +style[k] : d);
  for (const v of major) out.push({ v, len: len('yMajorLen', 6) });
  for (const v of medium) out.push({ v, len: len('yMediumLen', 4.5) });
  for (const v of minor) out.push({ v, len: len('yMinorLen', 3) });
  return out;
}
const labelLen = (st) => (+st?.yLabelLen > 0 ? +st.yLabelLen : 6);

/** V0.33: reorder (st.colOrder) and hide (st.colHide) columns in place, keeping the first `keep` columns fixed. */
export function orderCols(cols, st = {}, keep = 0) {
  const ord = Array.isArray(st?.colOrder) ? st.colOrder : [], hide = new Set(Array.isArray(st?.colHide) ? st.colHide : []), rank = (c) => { const k = ord.indexOf(c.id); return k < 0 ? 1e6 : k; };
  const body = cols.slice(keep).map((c, i) => ({ c, i })).filter(({ c }) => !hide.has(c.id)).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).map(({ c }) => c);
  cols.splice(keep, cols.length - keep, ...body);
  return cols;
}

export function niceRange(min, max) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) { min -= Math.abs(min) * 0.1 || 1; max += Math.abs(max) * 0.1 || 1; }
  const t = niceTicks(min, max, 4), st = t.length > 1 ? t[1] - t[0] : 1;
  return [Math.floor(min / st + 1e-9) * st, Math.ceil(max / st - 1e-9) * st];
}

/** Age model swapped to age → depth (assumes ages increase monotonically with depth). */
export function invertModel(m) {
  if (!m) return null;
  const p = m.depth.map((d, i) => [m.age[i], d]).sort((a, b) => a[0] - b[0]);
  return { depth: p.map((x) => x[0]), age: p.map((x) => x[1]) };
}

/** Convert a value from one axis (depth/age) to another with the age model; null if impossible. */
export function toAxis(v, from, to, model, inverse = invertModel(model)) {
  if (v == null) return null;
  if (from === to) return v;
  if (!model) return null;
  return from === 'depth' ? interpAge(model, v) : interpAge(inverse, v);
}

/**
 * Interval rows of all sections on the chosen axis.
 * sections: [{name, bins}] with bins in common depth units (dTop, dBottom, depth, pct, classPct, BI, ii, BIm, iim).
 */
export function compositeRows(sections, { axis, model }) {
  const rows = [];
  let outside = 0;
  for (const s of sections) {
    for (const b of s.bins) {
      const age = interpAge(model, b.depth);
      let a0 = b.dTop, a1 = b.dBottom, c = b.depth;
      let reversed = false;
      if (axis === 'age') {
        a0 = interpAge(model, b.dTop); a1 = interpAge(model, b.dBottom); c = age;
        if (a0 == null || a1 == null) { outside++; continue; }   // card Q4: counted, and the CSV says how many
        reversed = a0 > a1;                                        // an age reversal in the model: marked in the CSV
      }
      rows.push({ ...b, section: s.name, a0: Math.min(a0, a1), a1: Math.max(a0, a1), c, age, reversed });
    }
  }
  return Object.assign(rows.sort((p, q) => p.a0 - q.a0), { outside });
}

export function rowsRange(rows) {
  if (!rows.length) return [0, 1];
  return [Math.min(...rows.map((r) => r.a0)), Math.max(...rows.map((r) => r.a1))];
}

/** Identification marker: its reference point remains at the trace depth. */
export function traceSymbolPath(kind = 'triDown') {
  if (kind === 'circle') return 'M4.5 -4a4.5 4.5 0 1 0 -9 0a4.5 4.5 0 1 0 9 0';
  if (kind === 'square') return 'M-4 -8h8v8h-8z';
  if (kind === 'diamond') return 'M0 -9L5 -4L0 1L-5 -4z';
  if (kind === 'tri') return 'M0 -8L4.5 0h-9z';
  if (kind === 'cross') return 'M-5 -7L-3 -9L0 -6L3 -9L5 -7L2 -4L5 -1L3 1L0 -2L-3 1L-5 -1L-2 -4z';
  if (kind === 'star') return Array.from({length:10}, (_, i) => { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 2.2 : 5.5; return `${i ? 'L' : 'M'}${f2(r * Math.cos(a))} ${f2(-4 + r * Math.sin(a))}`; }).join('') + 'z';
  return 'M0 0l-4.5 -8h9z';
}
const HEX_COLOR = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;
export const validHexColor = (value, fallback) => (typeof value === 'string' && HEX_COLOR.test(value) ? value : fallback);
/** Read a finite presentation number without coercing objects, booleans or empty strings.
 * @param {unknown} value @param {number} fallback
 */
export function finiteStyleNumber(value, fallback) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
let SYM = { k: 1, stroke: '#ffffff', sw: 0.8 };   // V0.23: marker size and border of the current figure
const traceSymbol = (x, y, color, kind) => `<path transform="translate(${f2(x)} ${f2(y)})${SYM.k !== 1 ? ` scale(${f2(SYM.k)})` : ''}" d="${traceSymbolPath(kind)}" fill="${validHexColor(color, '#777777')}" stroke="${SYM.stroke === 'none' ? 'none' : validHexColor(SYM.stroke, '#ffffff')}" stroke-width="${f2(SYM.sw)}"/>`;
/** V0.23: style of NO DATA intervals: show, fill (hatch / solid / none), colours and label. */
export const ND_STYLE = { ndShow: true, ndFill: 'hatch', ndColor: '#f2f2f0', ndLine: '#b9bdbb', ndLabel: true, ndText: '', ndImage: false };
export function noDataDefs(st) {
  const q = mergedStyle(st);
  return `<pattern id="nodata" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="${q.ndColor}"/>${q.ndFill === 'hatch' ? `<line x1="0" y1="0" x2="0" y2="6" stroke="${q.ndLine}" stroke-width="1.6"/>` : ''}</pattern>`;
}
/** NO DATA rectangle (and label) for one column; '' when hidden. */
export function noDataRect(st, x, w, ya, h, text) {
  const q = mergedStyle(st);
  if (!q.ndShow || q.ndFill === 'none' || h <= 0) return '';
  let r = `<rect x="${f2(x)}" y="${f2(ya)}" width="${f2(w)}" height="${f2(Math.max(0.4, h))}" fill="url(#nodata)"/>`;
  if (q.ndLabel && h >= 12 && w >= 44) r += `<text x="${f2(x + w / 2)}" y="${f2(ya + h / 2 + 3)}" text-anchor="middle" font-size="8.5" font-weight="600" fill="#6b7471">${escXml(q.ndText || text || 'NO DATA')}</text>`;
  return r;
}
/** Intervals without data among rows (merged when contiguous). */
export function noDataGaps(rows) {
  const gaps = [];
  for (const r of rows) {
    if (r.pct != null) continue;
    const g = gaps[gaps.length - 1];
    if (g && Math.abs(r.a0 - g.a1) < 1e-9) g.a1 = r.a1; else gaps.push({ a0: r.a0, a1: r.a1 });
  }
  return gaps;
}
const escXml = (s) => {
  try { return String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]); }
  catch { return ''; }
};
const f2 = (v) => +(+v).toFixed(2);
const lbl = (v) => String(+(+v).toPrecision(6));

/** Split a track name into at most two lines of about w px (10 px font); the second line ends in … if cut. */
export function wrapTitle(text, w) {
  // V0.27: long names also break after "_", "-" or "/" (magnetic_ / susceptibility_IU)
  const max = Math.max(4, Math.floor((w - 4) / 5.6)), parts = String(text ?? '').match(/\s*[^\s_\-/]+[_\-/]*|\s*[_\-/]+/g) || [], lines = [''];
  for (const raw of parts) {
    const sp = /^\s/.test(raw), wd = raw.trim(), cur = lines[lines.length - 1], next = cur ? cur + (sp ? ' ' : '') + wd : wd;
    if (next.length <= max || !cur) lines[lines.length - 1] = next; else lines.push(wd);
  }
  const out = lines.slice(0, 2).map((l) => (l.length > max ? l.slice(0, max - 1) + '…' : l));
  if (lines.length > 2) out[1] = (out[1].length >= max ? out[1].slice(0, max - 1) : out[1]) + '…';
  return out;
}

/**
 * Build the composite log as an SVG string.
 * o = { title, subtitle, axisLabel, from, to, height, rows, classes:[{name,color,index}],
 *       tracks:{image,total,species,BI,ii,manual}, image:{href}|null, imageWidth,
 *       records:[{name, color, reverse, pts:[[axisValue, y], ...]}], boundaries:[{a,label}], labels:{...},
 *       bands:[{title, full, key, w, segs:[{a0,a1,color,opacity}]}] (key: stable id for widths and clicks),
 *       marks:[{a, xf, color, abbr}] (identified traces: triangle on the image at relative x xf),
 *       idList:[{a0, a1, items:[{name, abbr, color, plain}]}] (identified ichnotaxa per interval, column at the right),
 *       respectTaxonColumnVisibility: boolean (keep style.colHide separate from taxa.hidden; hide columns and legend together),
 *       legendClasses:[{name, color}] (ichnotaxa legend, always drawn when given), bandLegend, shade:[{a0,a1,color}] (class colours behind the record curves) }
 */
/**
 * V0.5: style of the column and its figure. yFactor converts axis values to the displayed unit (e.g. m → cm: 100);
 * yStep (displayed units) or yDiv (approximate number of divisions) set the vertical ticks; pctDiv the divisions of
 * the 0–100 % axes; totalStyle: 'barsline' | 'bars' | 'line' | 'points'; frame/grid/boundaries on or off; custom
 * titles for the bioturbation and ichnotaxa columns; fontSize and whether title/subtitle are drawn.
 */
/**
 * Resolve new presentation options without changing the defaults of existing figures.
 * @param {Partial<{layout:string, abundance:string, occurrence:string, source:string, opacity:number, scale:string, values:boolean, hidden:string[]}>} [value]
 * @param {{range?:boolean, style?:{speciesMode?:string, speciesHide?:string[], colHide?:string[]}, display?:string, source?:string}} [context]
 */
export function taxaOptions(value = {}, { range = false, style = {}, display = 'symbols', source = 'all' } = {}) {
  const kite = display === 'kite' || display === 'kiteSymbols';
  const spHide = Array.isArray(style?.speciesHide) ? style.speciesHide.filter((s) => typeof s === 'string') : [];
  const colHide = Array.isArray(style?.colHide) ? style.colHide.filter((id) => typeof id === 'string' && id.startsWith('sp:')).map((id) => id.slice(3)) : [];
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const defaults = { layout: range ? 'separate' : style?.speciesMode || 'stack',
    abundance: range ? (kite ? 'kite' : ['bars', 'both'].includes(display) ? 'bars' : 'none') : 'bars',
    occurrence: range && ['symbols', 'both', 'kiteSymbols'].includes(display) ? 'symbols' : 'none',
    source, opacity: range && kite ? 0.85 : 1, scale: 'auto', values: false,
    hidden: [...spHide, ...colHide] };
  const q = { ...defaults, ...raw };
  for (const [key, choices] of Object.entries({ layout: ['stack', 'overlay', 'separate'], abundance: ['none', 'bars', 'line', 'area', 'kite'],
    occurrence: ['none', 'symbols', 'names', 'both'], source: ['all', 'objects', 'marks'], scale: ['auto', 'percent'] })) {
    if (!choices.includes(q[key])) q[key] = defaults[key];
  }
  q.opacity = (typeof q.opacity === 'number' || typeof q.opacity === 'string') && Number.isFinite(+q.opacity) ? Math.max(0, Math.min(1, +q.opacity)) : defaults.opacity;
  q.values = q.values === true;
  q.hidden = Array.isArray(q.hidden) ? q.hidden.filter((name) => typeof name === 'string') : [];
  if (q.layout === 'stack' && ['kite', 'none'].includes(q.abundance)) q.layout = 'separate';
  return q;
}

const taxonPointIncluded = (point, q) => q.source === 'all' || (q.source === 'marks' ? point.kind === 'mark' : point.kind !== 'mark');
function visibleTaxa(classes, rows, points, q, from, to) {
  const hidden = new Set(q.hidden);
  return classes.filter((c) => !hidden.has(c.name) &&
    (((q.abundance !== 'none' || q.values) && rows.some((r) => Number.isFinite(r.classPct?.[c.index]) && r.classPct[c.index] > 0)) ||
      (q.occurrence !== 'none' && points.some((p) => p.index === c.index && p.a >= from && p.a <= to && taxonPointIncluded(p, q)))));
}

/**
 * Shared percentage geometry and occurrence marks for the column and distribution figures.
 * @param {{rows:{a0:number,a1:number,pct?:number|null,classPct?:ArrayLike<number|null>}[],
 * classes:{name:string,index:number,color:string,symbol?:string,plain?:boolean}[], points:{a:number,index:number,kind:string}[],
 * q:ReturnType<typeof taxaOptions>, x:number, width:number, top:number, height:number, y:(v:number)=>number,
 * from:number, to:number, axis?:{min?:number,max?:number,log?:boolean,rev?:boolean,div?:number,step?:number,dec?:number}, ink:string, axisY:number, markHollow?:boolean}} options
 */
function taxonColumnSVG({ rows, classes, points, q, x, width, top, height, y, from, to, axis = {}, ink, axisY, markHollow = false }) {
  if (q.scale === 'percent') axis = { ...axis, min: 0, max: 100, log: false };
  const abundance = q.abundance !== 'none', mirrored = q.abundance === 'kite', stacked = q.layout === 'stack';
  const measured = (row, c) => row.pct != null && Number.isFinite(row.classPct?.[c.index]) ? row.classPct[c.index] : null;
  let maximum = 1;
  for (const row of rows) maximum = Math.max(maximum, stacked ? classes.reduce((sum, c) => sum + (measured(row, c) || 0), 0)
    : classes.reduce((max, c) => Math.max(max, measured(row, c) || 0), 0));
  const [, automaticMax] = niceRange(0, maximum);
  const hi = axis.max != null ? +axis.max : q.scale === 'percent' ? 100 : automaticMax;
  const lo = axis.min != null ? +axis.min : axis.log ? hi / 1000 : 0;
  if (abundance && (!Number.isFinite(hi) || !Number.isFinite(lo) || !(hi > lo) || (axis.log && !(lo > 0)))) throw new Error('Invalid horizontal axis: max > min; logarithmic limits must be positive.');
  const transform = (v) => axis.log ? Math.log10(Math.max(v, 1e-12)) : v;
  const ratio = (v) => (transform(v) - transform(lo)) / (transform(hi) - transform(lo));
  const sx = (v) => x + (axis.rev ? 1 - ratio(v) : ratio(v)) * width;
  const baseline = axis.log ? lo : Math.min(hi, Math.max(0, lo)), baseX = sx(baseline), center = x + width / 2;
  const colorOf = (c) => validHexColor(c?.color, '#777777');
  const plot = [], axes = [];
  if (abundance) {
    let ticks = mirrored || width < 60 ? [hi] : [lo, hi];
    if (axis.step > 0 && Number.isFinite(axis.step) && !axis.log) {
      ticks = []; for (let value = Math.ceil(lo / axis.step) * axis.step; value <= hi && ticks.length < 400; value += axis.step) ticks.push(value);
    } else if (axis.div > 0 && !axis.log) {
      const count = Math.min(400, Math.max(1, Math.round(axis.div)));
      ticks = Array.from({ length: count + 1 }, (_, index) => lo + index * (hi - lo) / count);
    }
    const tickLabel = (value) => axis.dec != null ? value.toFixed(Math.min(6, Math.max(0, +axis.dec || 0))) : lbl(value);
    for (const value of ticks) {
      if (mirrored && value === baseline) continue;
      const positions = mirrored ? [center - Math.abs(sx(value) - baseX) / 2, center + Math.abs(sx(value) - baseX) / 2] : [sx(value)];
      for (const xx of new Set(positions)) {
        const anchor = Math.abs(xx - x) < 0.01 ? 'start' : Math.abs(xx - x - width) < 0.01 ? 'end' : 'middle';
        axes.push(`<text x="${f2(xx)}" y="${axisY}" text-anchor="${anchor}" font-size="8" fill="${ink}">${tickLabel(value)}%</text>`);
      }
    }
    if (mirrored) axes.push(`<text x="${f2(center)}" y="${axisY}" text-anchor="middle" font-size="8" fill="${ink}">${lbl(baseline)}%</text>`);
  }
  if (mirrored || !abundance) plot.push(`<line x1="${f2(center)}" y1="${top}" x2="${f2(center)}" y2="${top + height}" stroke="${ink}" stroke-opacity="0.25"/>`);
  const orderedRows = [...rows].sort((a, b) => a.a0 - b.a0);
  classes.forEach((c, classPosition) => {
    const color = colorOf(c), name = escXml(c.name), segments = [], valueLabels = [];
    const valueAt = (row) => measured(row, c);
    const beforeAt = (row) => stacked ? classes.slice(0, classPosition).reduce((sum, prior) => sum + (measured(row, prior) || 0), 0) : 0;
    let run = [];
    const runs = [];
    for (const row of orderedRows) {
      const value = valueAt(row), previous = run.at(-1);
      if (value == null || (axis.log && value <= 0) || (previous && Math.abs(previous.a1 - row.a0) > 1e-9)) {
        if (run.length) runs.push(run); run = [];
      }
      if (value != null && (!axis.log || value > 0)) run.push(row);
    }
    if (run.length) runs.push(run);
    for (const data of runs) {
      if (!data.some((row) => valueAt(row) > 0)) continue;
      if (q.abundance === 'bars') for (const row of data) {
        const value = valueAt(row); if (!(value > 0)) continue;
        const left = stacked ? sx(beforeAt(row)) : baseX, right = sx(beforeAt(row) + value);
        segments.push(`<rect x="${f2(Math.min(left, right))}" y="${y(row.a0)}" width="${f2(Math.abs(right - left))}" height="${f2(Math.max(0.3, y(row.a1) - y(row.a0)))}" fill="${color}"><title>${name}: ${lbl(value)}%</title></rect>`);
      }
      if (mirrored) {
        const half = (row) => Math.max(0, Math.min(width / 2, Math.abs(sx(valueAt(row)) - baseX) / 2));
        const coords = [[center, y(data[0].a0)], ...data.map((row) => [center + half(row), y((row.a0 + row.a1) / 2)]),
          [center, y(data.at(-1).a1)], ...[...data].reverse().map((row) => [center - half(row), y((row.a0 + row.a1) / 2)])];
        segments.push(`<polygon points="${coords.map(([xx, yy]) => `${f2(xx)},${yy}`).join(' ')}" fill="${color}" stroke="${color}" stroke-width="0.8"/>`);
      } else if (q.abundance === 'line' || q.abundance === 'area') {
        const rightAt = (row) => sx(beforeAt(row) + valueAt(row));
        const right = [[rightAt(data[0]), y(data[0].a0)], ...data.map((row) => [rightAt(row), y((row.a0 + row.a1) / 2)]),
          [rightAt(data.at(-1)), y(data.at(-1).a1)]];
        if (q.abundance === 'line') segments.push(`<polyline points="${right.map(([xx, yy]) => `${f2(xx)},${yy}`).join(' ')}" fill="none" stroke="${color}" stroke-width="1.2"/>`);
        else {
          const leftAt = (row) => stacked ? sx(beforeAt(row)) : baseX;
          const left = [[leftAt(data.at(-1)), y(data.at(-1).a1)], ...[...data].reverse().map((row) => [leftAt(row), y((row.a0 + row.a1) / 2)]),
            [leftAt(data[0]), y(data[0].a0)]];
          segments.push(`<polygon points="${[...right, ...left].map(([xx, yy]) => `${f2(xx)},${yy}`).join(' ')}" fill="${color}" stroke="${color}" stroke-width="0.8"/>`);
        }
      }
      if (q.values) for (const row of data) {
        const value = valueAt(row);
        if (!(value > 0) || y(row.a1) - y(row.a0) < 10) continue;
        const labelX = stacked ? (sx(beforeAt(row)) + sx(beforeAt(row) + value)) / 2 : x + (classPosition + 0.5) * width / classes.length;
        valueLabels.push(`<text data-role="percentage" x="${f2(labelX)}" y="${f2(y((row.a0 + row.a1) / 2) + 3)}" text-anchor="middle" font-size="8" fill="${ink}">${lbl(value)}%</text>`);
      }
    }
    plot.push(`<g data-taxon="${name}" data-role="abundance" opacity="${q.opacity}">${segments.join('')}</g>`);
    plot.push(valueLabels.join(''));
    if (q.occurrence !== 'none') {
      const px = q.occurrence === 'both' ? x + 5 + classPosition * width / classes.length : x + (classPosition + 0.5) * width / classes.length;
      let last = null;
      for (const point of points) {
        if (point.index !== c.index || point.a < from || point.a > to || !taxonPointIncluded(point, q)) continue;
        if (last && Math.abs(point.a - last.a) < 1e-12 && point.kind === last.kind) continue;
        last = point;
        const yy = y(point.a), size = Math.min(10, Math.max(6, (width - (q.occurrence === 'both' ? 16 : 4)) / Math.max(1, c.name.length * 0.55)));
        const labelY = Math.max(top + size, Math.min(top + height - 2, yy + 3));
        const symbol = markHollow && point.kind === 'mark' ? traceSymbol(px, yy, '#ffffff', c.symbol).replace(/stroke="[^"]*"/, `stroke="${color}"`) : traceSymbol(px, yy, color, c.symbol);
        plot.push(`<g data-taxon="${name}" data-role="occurrence" data-kind="${point.kind === 'mark' ? 'mark' : 'object'}"><title>${name}: ${lbl(point.a)}</title>`);
        if (q.occurrence === 'symbols' || q.occurrence === 'both') plot.push(symbol);
        if (q.occurrence === 'names' || q.occurrence === 'both') plot.push(`<text x="${f2(q.occurrence === 'both' ? px + 6 : px)}" y="${f2(labelY)}" text-anchor="${q.occurrence === 'both' ? 'start' : 'middle'}" font-size="${f2(size)}" font-style="${c.plain ? 'normal' : 'italic'}" fill="${color}">${name}</text>`);
        plot.push('</g>');
      }
    }
  });
  return { body: plot.join(''), axis: axes.join('') };
}

export const LOG_STYLE = { yFactor: 1, yStep: null, yDiv: null, pctDiv: 4, totalStyle: 'barsline', barColor: '#e7c9a5', lineColor: '#a85f1c',
  bgColor: '#ffffff', textColor: '#1c2422', subColor: '#5b6763', frameColor: '#9aa5a1', gridColor: '#e3e8e6',
  boundaryColor: '#5b6763', biColor: '#c98a4b', iiColor: '#c98a4b', manualColor: '#1c2422',
  frame: true, grid: true, boundaries: true, secOrient: 'v', secLabel: 'name', totalTitle: '', speciesTitle: '', fontSize: 10, showTitle: true,
  axes: {} };   // V0.6: per column {min, max, div, dec, rev, log} keyed by column id (total, species, BI, ii, rec:<name>)
/** Style merged with ND_STYLE and LOG_STYLE; any colour that is not a hex colour falls back to its default (project files are untrusted). */
export function mergedStyle(style) {
  const raw = style && typeof style === 'object' && !Array.isArray(style) ? style : {};
  const st = { ...ND_STYLE, ...LOG_STYLE, ...raw };
  for (const k of Object.keys(LOG_STYLE)) if (k.endsWith('Color')) st[k] = validHexColor(st[k], LOG_STYLE[k]);
  st.ndColor = validHexColor(st.ndColor, ND_STYLE.ndColor);
  st.ndLine = validHexColor(st.ndLine, ND_STYLE.ndLine);
  if (!['hatch', 'solid', 'none'].includes(st.ndFill)) st.ndFill = ND_STYLE.ndFill;
  if (st.ndShow === undefined) st.ndShow = ND_STYLE.ndShow;
  if (st.ndLabel === undefined) st.ndLabel = ND_STYLE.ndLabel;
  if (st.ndImage === undefined) st.ndImage = ND_STYLE.ndImage;
  st.ndText = typeof st.ndText === 'string' ? st.ndText : ND_STYLE.ndText;
  if (st.markStroke !== undefined && st.markStroke !== 'none') st.markStroke = validHexColor(st.markStroke, '#ffffff');
  if (raw.fontSize === null) st.fontSize = null;
  else st.fontSize = (typeof st.fontSize === 'number' || typeof st.fontSize === 'string') && +st.fontSize > 0 ? +st.fontSize : LOG_STYLE.fontSize;
  return st;
}
export function buildLogSVG(o) {
  const st = mergedStyle(o.style), fs = +st.fontSize > 0 ? +st.fontSize : LOG_STYLE.fontSize;
  const colHideArr = Array.isArray(st.colHide) ? st.colHide.filter((id) => typeof id === 'string') : [];
  const taxa = o.taxa ? taxaOptions(o.taxa, { style: o.respectTaxonColumnVisibility ? { ...st, colHide: [] } : st }) : null;
  SYM = { k: +st.markSize > 0 ? +st.markSize : 1, stroke: st.markStroke === 'none' ? 'none' : validHexColor(st.markStroke, '#ffffff'), sw: +st.markStrokeW >= 0 && st.markStrokeW != null ? +st.markStrokeW : 0.8 };
  const L = { total: 'Bioturbation (%)', species: 'Ichnotaxa (%)', image: 'Core', ...(o.labels || {}) };
  if (st.totalTitle) L.total = st.totalTitle;
  if (st.speciesTitle) L.species = st.speciesTitle;
  const H = o.height, top = 84, from = o.from, to = o.to;
  const span = to - from || 1;
  const y = (v) => f2(top + ((v - from) / span) * H);
  const rows = o.rows.filter((r) => r.a1 > from && r.a0 < to);
  /** @type {{key:string, w:number, x?:number, id?:string, title?:string, full?:string, cls?:any, img?:any, band?:any, rec?:any}[]} */
  const cols = [];
  const t = o.tracks, cw = o.colWidths || {}, wOf = (id, d) => Math.max(30, Math.min(600, +cw[id] || d));
  cols.push({ key: 'axis', w: 64 });
  if (t.image && o.images?.length) for (const im of o.images) cols.push({ key: 'image', w: im.w || o.imageWidth || 60, title: im.title || L.image, img: im });   // V0.23: several panels
  else if (t.image && o.image) cols.push({ key: 'image', w: o.imageWidth || 60, title: L.image, img: o.image });
  if (t.total) cols.push({ key: 'total', id: 'total', w: wOf('total', 150), title: L.total });
  // V0.31: ichnotaxa can be hidden (style.speciesHide, names) and drawn stacked in one column or each in its own (speciesMode 'separate')
  const spHide = new Set(Array.isArray(st.speciesHide) ? st.speciesHide : []), presentClasses = taxa
    ? visibleTaxa(o.taxonClasses || o.classes, rows, o.taxonPoints || [], taxa, from, to)
    : o.classes.filter((c) => !spHide.has(c.name) && rows.some((r) => (r.classPct[c.index] || 0) > 0));
  if (t.species && (taxa ? taxa.layout === 'separate' : st.speciesMode === 'separate')) for (const k of presentClasses) { const id = 'sp:' + k.name; cols.push({ key: 'sp1', id, w: wOf(id, taxa?.occurrence === 'names' || taxa?.occurrence === 'both' ? 140 : 70), title: k.name, cls: k }); }
  else if (t.species) cols.push({ key: 'species', id: 'species', w: wOf('species', 150), title: L.species });
  if (t.BI) cols.push({ key: 'BI', id: 'BI', w: wOf('BI', 46), title: 'BI' });
  if (t.ii) cols.push({ key: 'ii', id: 'ii', w: wOf('ii', 46), title: 'ii' });
  for (const b of o.bands || []) { const id = 'band:' + (b.key || b.full || b.title); cols.push({ key: 'band', id, w: wOf(id, b.w || 46), title: b.title, full: b.full, band: b }); }
  for (const r of o.records) { const id = 'rec:' + r.name; cols.push({ key: 'rec', id, w: wOf(id, o.recWidth || 120), title: r.name, rec: r }); }
  if (t.secs && o.boundaries?.length) cols.splice(1, 0, { key: 'secs', id: 'secs', w: wOf('secs', 40), title: L.secs || 'Section' });   // V0.78: empty column with a box per section
  if (o.marks?.length && !(t.image && o.image)) cols.splice(1, 0, { key: 'marks', id: 'marks', w: wOf('marks', 40), title: L.marks || 'Traces' });
  if (o.idList && (!taxa || taxa.occurrence === 'none')) cols.push({ key: 'idlist', id: 'idlist', w: wOf('idlist', 150), title: L.idList || 'Identified ichnotaxa' });
  // V0.33: column order (style.colOrder, ids) and hidden columns (style.colHide, ids; nothing is deleted); the axis stays first
  cols.forEach((c, i) => { if (!c.id && c.key === 'image') c.id = 'image:' + (c.img?.title || i); });
  const allCols = cols.filter((c) => c.key !== 'axis').map((c) => ({ id: c.id, title: c.full || c.title, key: c.key }));
  orderCols(cols, taxa && !o.respectTaxonColumnVisibility ? { ...st, colHide: colHideArr.filter((id) => !id.startsWith('sp:')) } : st, 1);
  let x = 8;
  for (const c of cols) { c.x = x; x += c.w + 14; }
  const W = x;
  const taxonLegend = [...(t.species ? presentClasses : []), ...(o.legendClasses || [])].filter((c) =>
    (!taxa || !taxa.hidden.includes(c.name)) && (!o.respectTaxonColumnVisibility || !colHideArr.includes(taxa?.layout === 'separate' ? 'sp:' + c.name : 'species')));
  const seenL = new Set(), legendItems = [...taxonLegend, ...(o.bandLegend || []), ...(o.shadeLegend || [])].filter((k) => !seenL.has(k.name) && seenL.add(k.name));
  const eventLegend = !!o.shadeLegend?.length, legendCellWidth = eventLegend ? Math.min(230, W - 16) : 170, legendRowHeight = eventLegend ? 30 : 16;
  const perRow = Math.max(1, Math.floor((W - 16) / legendCellWidth));
  const legendH = legendItems.length ? Math.ceil(legendItems.length / perRow) * legendRowHeight + 14 : 0;
  const Htot = top + H + 22 + legendH;
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${Htot}" viewBox="0 0 ${W} ${Htot}" font-family="IBM Plex Sans, Arial, Helvetica, sans-serif" font-size="${fs}">`);
  out.push(`<rect x="0" y="0" width="${W}" height="${Htot}" fill="${st.bgColor}"/>`);
  out.push(`<defs><clipPath id="plot"><rect x="0" y="${top}" width="${W}" height="${H}"/></clipPath>${noDataDefs(st)}</defs>`);
  // V0.3: intervals without data (excluded or too few valid pixels) are drawn as NO DATA, never as 0
  const gaps = noDataGaps(rows);
  if (st.showTitle) {
    out.push(`<text x="8" y="16" font-size="${fs + 3}" font-weight="600" fill="${st.textColor}">${escXml(o.title || '')}</text>`);
    if (o.subtitle) out.push(`<text x="8" y="31" fill="${st.subColor}">${escXml(o.subtitle)}</text>`);
  }

  const fy = +st.yFactor || 1, yTicks = verticalTicks(from, to, H, st);
  const frame = (c) => { if (st.frame) out.push(`<rect x="${c.x}" y="${top}" width="${c.w}" height="${H}" fill="none" stroke="${st.frameColor}" stroke-width="0.8"/>`); };
  // track names: up to two lines that fit the column width (V25); the full name is in the returned layout
  const title = (c) => {
    if (c.w < 34 && c.title) { out.push(`<text transform="translate(${f2(c.x + c.w / 2 + 3)},80) rotate(-90)" text-anchor="start" font-size="9" font-weight="600" fill="${st.textColor}">${escXml(c.title)}</text>`); return; }   // V0.27: narrow columns, upright title
    const ls = wrapTitle(c.title, c.w);
    out.push(`<text x="${c.x + c.w / 2}" y="${ls.length > 1 ? 46 : 54}" text-anchor="middle" font-weight="600" fill="${st.textColor}">${ls.map((l, i) => `<tspan x="${c.x + c.w / 2}" dy="${i ? 12 : 0}">${escXml(l)}</tspan>`).join('')}</text>`);
  };
  // V0.6: axis of a column; the user may fix min/max, divisions, decimals, invert it or (records) use a log scale
  const xScale = (c, lo, hi, reverse = false, ticks = null) => {
    const ax = (st.axes || {})[c.id || c.key] || {};
    if (ax.min != null && ax.min !== '') lo = +ax.min;
    if (ax.max != null && ax.max !== '') hi = +ax.max;
    if (ax.rev) reverse = !reverse;
    if (ax.log && !(lo > 0) && ax.min == null) lo = hi > 0 ? hi / 1000 : 0.001;
    if (!(hi > lo) || (ax.log && !(lo > 0))) throw new Error('Invalid horizontal axis: max > min; logarithmic limits must be positive.');
    const lg = !!ax.log, tf = (v) => (lg ? Math.log10(Math.max(v, 1e-12)) : v), L0 = tf(lo), L1 = tf(hi);
    const sx = (v) => f2(c.x + ((reverse ? L1 - tf(v) : tf(v) - L0) / (L1 - L0 || 1)) * c.w);
    sx.base = sx(lg ? lo : Math.min(Math.max(0, lo), hi));
    if (ax.step > 0 && !lg) { ticks = []; for (let v = Math.ceil(lo / ax.step) * ax.step; v <= hi && ticks.length < 400; v += ax.step) ticks.push(v); }
    else if (ax.div > 0 || lg) {
      if (lg) { ticks = []; for (let e = Math.floor(L0); e <= Math.ceil(L1); e++) { const v = 10 ** e; if (v >= lo * 0.999 && v <= hi * 1.001) ticks.push(v); } }
      else ticks = Array.from({ length: Math.min(400, Math.round(ax.div)) + 1 }, (_, k) => lo + ((hi - lo) * k) / Math.min(400, Math.round(ax.div)));
    }
    const fmtT = (v) => (ax.dec != null && ax.dec !== '' ? (+v).toFixed(Math.max(0, Math.min(6, +ax.dec))) : lbl(v));
    out.push('</g><g>');
    for (const tv of (ticks || niceTicks(lo, hi, 3)).filter((v) => v >= lo && v <= hi)) {
      const xx = sx(tv);
      if (st.grid) out.push(`<line x1="${xx}" y1="${top}" x2="${xx}" y2="${top + H}" stroke="${st.gridColor}" stroke-width="0.6"/>`);
      out.push(`<line x1="${xx}" y1="${top - 4}" x2="${xx}" y2="${top}" stroke="${st.subColor}" stroke-width="0.6"/>`);
      out.push(`<text x="${xx}" y="${top - 7}" text-anchor="middle" fill="${st.subColor}" font-size="9">${fmtT(tv)}</text>`);
    }
    out.push(`</g><g clip-path="url(#track-${c.x})">`);
    sx.log = lg; return sx;
  };

  for (const c of cols) {
    if (c.key === 'axis') {
      out.push(`<text transform="translate(${c.x + 10},${top + H / 2}) rotate(-90)" text-anchor="middle" fill="${st.textColor}" font-weight="600">${escXml(o.axisLabel)}</text>`);
      for (const v of yTicks) {
        const yy = y(v);
        out.push(`<line x1="${c.x + c.w - labelLen(st)}" y1="${yy}" x2="${c.x + c.w}" y2="${yy}" stroke="${st.textColor}" stroke-width="0.8"/>`);
        out.push(`<text x="${c.x + c.w - labelLen(st) - 3}" y="${yy + 3}" text-anchor="end" fill="${st.textColor}">${lbl(v * fy)}</text>`);
      }
      for (const e of extraTicks(from, to, H, st)) out.push(`<line x1="${c.x + c.w - e.len}" y1="${y(e.v)}" x2="${c.x + c.w}" y2="${y(e.v)}" stroke="${st.textColor}" stroke-width="0.6"/>`);
      out.push(`<line x1="${c.x + c.w}" y1="${top}" x2="${c.x + c.w}" y2="${top + H}" stroke="${st.textColor}" stroke-width="0.8"/>`);
      continue;
    }
    title(c);
    out.push(`<defs><clipPath id="track-${c.x}"><rect x="${c.x}" y="${top}" width="${c.w}" height="${H}"/></clipPath></defs><g clip-path="url(#track-${c.x})">`);
    if (['total', 'species', 'sp1', 'BI', 'ii'].includes(c.key)) for (const g of gaps) {
      const ya = y(Math.max(g.a0, from)), yb = y(Math.min(g.a1, to));
      out.push(noDataRect(st, c.x, c.w, ya, yb - ya, L.noData));
    }
    if (c.key === 'image') {
      out.push(`<image x="${c.x}" y="${top}" width="${c.w}" height="${H}" preserveAspectRatio="none" href="${escXml(c.img.href)}" xlink:href="${escXml(c.img.href)}"/>`);
      if (st.ndImage) for (const g of gaps) { const ya = y(Math.max(g.a0, from)), yb = y(Math.min(g.a1, to)); out.push(noDataRect(st, c.x, c.w, ya, yb - ya, L.noData)); }
      if (typeof c.img.draw === 'function') out.push(c.img.draw(c.x, c.w, y));   // V0.23: overlay (e.g. arrows) drawn by the caller
      if (c.img.marks !== false) for (const m of o.marks || []) if (m.a >= from && m.a <= to) out.push(traceSymbol(c.x + Math.min(1, Math.max(0, m.xf)) * c.w, y(m.a), m.color, m.symbol));
    } else if (c.key === 'total') {
      const nd = Math.max(1, Math.min(20, Math.round(st.pctDiv) || 4)), sx = xScale(c, 0, 100, false, Array.from({ length: nd + 1 }, (_, k) => +((100 * k) / nd).toFixed(4)));
      const bars = st.totalStyle === 'barsline' || st.totalStyle === 'bars', line = st.totalStyle === 'barsline' || st.totalStyle === 'line';
      let d = '', prev = null;
      for (const r of rows) {
        if (r.pct == null || (sx.log && r.pct <= 0)) { prev = null; continue; }
        if (bars) out.push(`<rect x="${f2(Math.min(sx.base, sx(r.pct)))}" y="${y(r.a0)}" width="${f2(Math.abs(sx(r.pct) - sx.base))}" height="${f2(Math.max(0.3, y(r.a1) - y(r.a0)))}" fill="${st.barColor}"/>`);
        if (st.totalStyle === 'points') out.push(`<circle cx="${sx(r.pct)}" cy="${f2((y(r.a0) + y(r.a1)) / 2)}" r="2.2" fill="${st.lineColor}"/>`);
        d += prev && Math.abs(r.a0 - prev.a1) < 1e-9 ? `L${sx(r.pct)} ${y(r.a0)}` : `M${sx(r.pct)} ${y(r.a0)}`;
        d += `L${sx(r.pct)} ${y(r.a1)}`;
        prev = r;
      }
      if (d && line) out.push(`<path d="${d}" fill="none" stroke="${st.lineColor}" stroke-width="1.2"/>`);
    } else if (taxa && (c.key === 'species' || c.key === 'sp1')) {
      const drawing = taxonColumnSVG({ rows, classes: c.key === 'sp1' ? [c.cls] : presentClasses, points: o.taxonPoints || [],
        q: taxa, x: c.x, width: c.w, top, height: H, y, from, to, axis: st.axes?.[c.id] || {}, ink: st.textColor, axisY: top - 7 });
      out.push(`</g>${drawing.axis}<g clip-path="url(#track-${c.x})">${drawing.body}`);
    } else if (c.key === 'species') {
      const max = Math.max(1, ...rows.map((r) => presentClasses.reduce((s, k) => s + (r.classPct[k.index] || 0), 0)));
      const [, hi] = niceRange(0, max);
      const sx = xScale(c, 0, hi);
      for (const r of rows) {
        let acc = 0;
        for (const k of presentClasses) {
          const v = r.classPct[k.index] || 0; if (!v) continue;
          out.push(`<rect x="${f2(Math.min(sx(acc), sx(acc + v)))}" y="${y(r.a0)}" width="${f2(Math.abs(sx(acc + v) - sx(acc)))}" height="${f2(Math.max(0.3, y(r.a1) - y(r.a0)))}" fill="${validHexColor(k.color, '#777777')}"/>`);
          acc += v;
        }
      }
    } else if (c.key === 'sp1') {   // V0.31: one ichnotaxon per column, own scale (editable in the axes table as sp:<name>)
      const k = c.cls, kc = validHexColor(k.color, '#777777'), [, hi] = niceRange(0, Math.max(1, ...rows.map((r) => r.classPct[k.index] || 0))), sx = xScale(c, 0, hi);
      for (const r of rows) {
        const v = r.classPct[k.index] || 0; if (!v || (sx.log && v <= 0)) continue;
        out.push(`<rect x="${f2(Math.min(sx.base, sx(v)))}" y="${y(r.a0)}" width="${f2(Math.abs(sx(v) - (sx.base)))}" height="${f2(Math.max(0.3, y(r.a1) - y(r.a0)))}" fill="${kc}"/>`);
      }
    } else if (c.key === 'BI' || c.key === 'ii') {
      const lo = c.key === 'BI' ? 0 : 1;
      const sx = xScale(c, 0, 6, false, c.key === 'BI' ? [0, 3, 6] : [1, 3, 6]);
      for (const r of rows) {
        const v = r[c.key];
        if (v != null && v >= lo && (!sx.log || v > 0)) out.push(`<rect x="${f2(Math.min(sx.base, sx(v)))}" y="${y(r.a0)}" width="${f2(Math.abs(sx(v) - sx.base))}" height="${f2(Math.max(0.3, y(r.a1) - y(r.a0)))}" fill="${c.key === 'BI' ? st.biColor : st.iiColor}"/>`);
        const m = t.manual ? r[c.key === 'BI' ? 'BIm' : 'iim'] : null;
        if (m != null) out.push(`<line x1="${sx(m)}" y1="${y(r.a0)}" x2="${sx(m)}" y2="${y(r.a1)}" stroke="${st.manualColor}" stroke-width="2"/>`);
      }
    } else if (c.key === 'band') {
      for (const g of c.band.segs) {
        if (g.a1 <= from || g.a0 >= to) continue;
        out.push(`<rect x="${c.x}" y="${y(g.a0)}" width="${c.w}" height="${f2(Math.max(0.4, y(g.a1) - y(g.a0)))}" fill="${validHexColor(g.color, '#999999')}"${g.opacity != null && Number.isFinite(+g.opacity) ? ` fill-opacity="${+g.opacity}"` : ''}/>`);
      }
    } else if (c.key === 'idlist') {
      // identified ichnotaxa per interval: thin bracket and one line per taxon (abbreviations if the interval is short)
      let lastY = -Infinity;
      for (const g of o.idList) {
        if (g.a1 <= from || g.a0 >= to || !g.items.length) continue;
        const ya = y(Math.max(g.a0, from)), yb = y(Math.min(g.a1, to));
        out.push(`<path d="M${c.x + 6} ${ya}h-3V${yb}h3" fill="none" stroke="${st.frameColor}" stroke-width="0.8"/>`);
        const short = (yb - ya) < g.items.length * 11, lines = short ? [g.items] : g.items.map((k) => [k]);
        let yy = Math.max(ya + 9, lastY + 11);
        for (const line of lines) {
          if (yy > top + H - 2) break;
          let xx = c.x + 10;
          out.push(`<text x="${xx}" y="${yy}" fill="${st.textColor}" font-size="9.5">${line.map((k, i) => `<tspan fill="${validHexColor(k.color, '#777777')}" font-weight="700">■</tspan><tspan font-style="${k.plain ? 'normal' : 'italic'}"> ${escXml(short ? k.abbr : k.name)}${i < line.length - 1 ? ', ' : ''}</tspan>`).join('')}</text>`);
          lastY = yy; yy += 11;
        }
      }
    } else if (c.key === 'secs') {
      // V0.78: one box per section with its name or number, vertical or horizontal (as in published core logs)
      for (const b of o.boundaries) {
        if (b.a1 == null) continue;
        const lo = Math.min(b.a, b.a1), hi = Math.max(b.a, b.a1);
        if (hi <= from || lo >= to) continue;
        const ya = y(Math.max(lo, from)), yb = y(Math.min(hi, to)), cx = c.x + c.w / 2, cy = (ya + yb) / 2, txt = st.secLabel === 'num' ? String(b.n) : b.label || String(b.n);
        out.push(`<rect x="${c.x}" y="${ya}" width="${c.w}" height="${f2(Math.max(0.4, yb - ya))}" fill="none" stroke="${st.frameColor}" stroke-width="0.8"/>`);
        out.push(st.secOrient === 'h' ? `<text x="${f2(cx)}" y="${f2(cy + 3)}" text-anchor="middle" font-size="${fs}" fill="${st.textColor}">${escXml(txt)}</text>`
          : `<text transform="translate(${f2(cx + 3)},${f2(cy)}) rotate(-90)" text-anchor="middle" font-size="${fs}" fill="${st.textColor}">${escXml(txt)}</text>`);
      }
    } else if (c.key === 'marks') {
      for (const m of o.marks) if (m.a >= from && m.a <= to) out.push(traceSymbol(c.x + c.w / 2, y(m.a), m.color, m.symbol));
    } else if (c.key === 'rec') {
      const pts = c.rec.pts.filter((p) => p[0] != null && p[1] != null && p[0] >= from - span * 0.02 && p[0] <= to + span * 0.02);
      if (pts.length) {
        const [lo, hi] = niceRange(Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1])));
        const sx = xScale(c, lo, hi, c.rec.reverse);
        const recColor = validHexColor(c.rec.color, '#0b5394');
        out.push(recordShadingSVG(o.shade, { column: c, points: pts, sx, y, from, to, lanes: o.shadeLanes, area: o.shadeArea }));
        if (!sx.log) out.push(`<polyline fill="none" stroke="${recColor}" stroke-width="1.1" points="${pts.map((p) => `${sx(p[1])},${y(p[0])}`).join(' ')}"/>`);
        let path = '', connected = false;
        for (const p of sx.log ? pts : []) { if (sx.log && p[1] <= 0) { connected = false; continue; } path += `${connected ? 'L' : 'M'}${sx(p[1])} ${y(p[0])}`; connected = true; }
        if (sx.log) out.push(`<path fill="none" stroke="${recColor}" stroke-width="1.1" d="${path}"/>`);
      }
    }
    out.push('</g>');
    frame(c);
  }
  for (const b of st.boundaries ? o.boundaries || [] : []) {
    if (b.a <= from || b.a >= to) continue;
    out.push(`<line x1="${cols[0].x + cols[0].w}" y1="${y(b.a)}" x2="${W - 14}" y2="${y(b.a)}" stroke="${st.boundaryColor}" stroke-width="0.6" stroke-dasharray="3 3"/>`);
    if (b.label) out.push(`<text x="${W - 16}" y="${y(b.a) - 2}" text-anchor="end" fill="${st.boundaryColor}" font-size="8">${escXml(b.label)}</text>`);
  }
  legendItems.forEach((k, i) => {
    const lx = 8 + (i % perRow) * legendCellWidth, ly = top + H + 22 + Math.floor(i / perRow) * legendRowHeight, kc = validHexColor(k.color, '#777777');
    const label = eventLegend ? wrapTitle(k.name, legendCellWidth - 20).map((line, index) => `<tspan x="${lx + 14}" dy="${index ? 12 : 0}">${escXml(line)}</tspan>`).join('') : escXml(k.name);
    out.push(`${k.symbol ? traceSymbol(lx + 5, ly + 9, kc, k.symbol) : `<rect x="${lx}" y="${ly}" width="10" height="10" fill="${kc}"/>`}<text x="${lx + 14}" y="${ly + 9}" fill="${st.textColor}">${label}</text>`);
  });
  out.push('</svg>');
  return { svg: out.join(''), width: W, height: Htot, plotTop: top, plotHeight: H, columns: allCols,
    layout: cols.filter((c) => c.key !== 'axis').map((c) => ({ id: c.id || null, key: c.key, x: c.x, w: c.w, title: c.full || c.title, bkey: c.band?.key || null })) };
}

/** Unique short labels for ichnotaxa (Chondrites → Ch, Planolites → Pl…): 2 letters, 3 if two names collide. */
export function abbrevs(names) {
  const out = new Map(), used = new Set();
  for (const n of names) {
    const w = String(n).replace(/\(.*?\)/g, '').trim(), letters = w.replace(/[^\p{L}]/gu, '');
    const cand = [letters.slice(0, 2), letters[0] + (letters[2] || ''), letters.slice(0, 3), letters.slice(0, 4)].map((c) => c && c[0].toUpperCase() + c.slice(1).toLowerCase());
    let a = cand.find((c) => c && !used.has(c)) || `${letters.slice(0, 2)}${out.size}`;
    used.add(a); out.set(n, a);
  }
  return out;
}

/**
 * Ichnotaxa range chart: one column per ichnotaxon along depth or age; bars proportional to its percentage in each
 * interval (scaled to its own maximum) or, with presence, a mark where it was identified. o = {title, subtitle,
 * axisLabel, from, to, height, rows:[{a0,a1,classPct}], classes:[{name,color,index,plain}], presence:[{a0,a1,index}],
 * total: bool (bioturbation % column)}.
 */
export function buildRangeSVG(o) {
  const K = mergedStyle(o.style);
  const taxa = o.taxa ? taxaOptions(o.taxa, { range: true, style: K, display: o.display }) : null;
  if (taxa && taxa.layout !== 'separate') return buildLogSVG({ ...o, taxa, taxonPoints: o.points || [], records: [], tracks: { species: true, total: !!o.total }, labels: { total: o.totalLabel || 'Bioturbation (%)' } });
  const H = o.height, from = o.from, to = o.to, span = to - from || 1, colW = Math.max(16, Math.min(200, +o.colW || 30)), x0 = 72;   // V0.51: column width
  const longest = Math.max(8, ...o.classes.map((c) => String(c.name).length)), top = 46 + Math.min(150, longest * 5.2 * 0.87);   // room for names at 60°
  const y = (v) => f2(top + ((v - from) / span) * H);
  const rows = (o.rows || []).filter((r) => r.a1 > from && r.a0 < to), display = o.display || 'symbols';
  const spHide = new Set(Array.isArray(K.speciesHide) ? K.speciesHide : []);   // V0.31
  const inWin = (p) => (p.a != null ? p.a >= from && p.a <= to : p.a1 > from && p.a0 < to);
  const cols = taxa ? visibleTaxa(o.classes, rows, o.points || [], taxa, from, to).map((c) => ({ ...c }))
    : o.classes.filter((c) => !spHide.has(c.name)).filter((c) => rows.some((r) => (r.classPct?.[c.index] || 0) > 0) || [...(o.presence || []), ...(o.points || [])].some((p) => p.index === c.index && inWin(p)));
  const allCols = cols.map((c) => ({ id: 'sp:' + c.name, title: c.name, key: 'sp' }));   // V0.33: ichnotaxon columns can be reordered and hidden
  cols.forEach((c) => { c.id = 'sp:' + c.name; });
  const colHideArr = Array.isArray(K.colHide) ? K.colHide.filter((id) => typeof id === 'string') : [];
  orderCols(cols, taxa ? { ...K, colHide: colHideArr.filter((id) => !id.startsWith('sp:')) } : K);
  const totW = o.total ? 90 : 0, W = x0 + totW + (o.total ? 14 : 0) + cols.length * colW + 20 + Math.min(110, longest * 5.2 * 0.5), Htot = top + H + 26;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Htot}" viewBox="0 0 ${W} ${Htot}" font-family="IBM Plex Sans, Arial, Helvetica, sans-serif" font-size="10">`,
    `<rect width="${W}" height="${Htot}" fill="${K.bgColor}"/>`, `<text x="8" y="16" font-size="13" font-weight="600" fill="${K.textColor}">${escXml(o.title || '')}</text>`];
  if (o.subtitle) out.push(`<text x="8" y="31" fill="${K.subColor}">${escXml(o.subtitle)}</text>`);
  for (const v of verticalTicks(from, to, H, K)) {
    out.push(`<line x1="${x0 - labelLen(K)}" y1="${y(v)}" x2="${x0}" y2="${y(v)}" stroke="${K.textColor}" stroke-width="0.8"/><text x="${x0 - labelLen(K) - 3}" y="${y(v) + 3}" text-anchor="end" fill="${K.textColor}">${lbl(v * (+K.yFactor || 1))}</text>`);
    out.push(`<line x1="${x0}" y1="${y(v)}" x2="${W - 14}" y2="${y(v)}" stroke="${K.gridColor}" stroke-width="0.6"/>`);
  }
  for (const e of extraTicks(from, to, H, K)) out.push(`<line x1="${x0 - e.len}" y1="${y(e.v)}" x2="${x0}" y2="${y(e.v)}" stroke="${K.textColor}" stroke-width="0.6"/>`);
  out.push(`<line x1="${x0}" y1="${top}" x2="${x0}" y2="${top + H}" stroke="${K.textColor}" stroke-width="0.8"/>`);
  out.push(`<text transform="translate(16,${top + H / 2}) rotate(-90)" text-anchor="middle" font-weight="600" fill="${K.textColor}">${escXml(o.axisLabel || '')}</text>`);
  {   // V0.23: NO DATA intervals across the plot (style: show, fill, colours, label)
    SYM = { k: +K.markSize > 0 ? +K.markSize : 1, stroke: K.markStroke === 'none' ? 'none' : validHexColor(K.markStroke, '#ffffff'), sw: K.markStrokeW != null && +K.markStrokeW >= 0 ? +K.markStrokeW : 0.8 };
    out.push(`<defs>${noDataDefs(K)}</defs>`);
    for (const g of noDataGaps(rows)) { const ya = y(Math.max(g.a0, from)), yb = y(Math.min(g.a1, to)); out.push(noDataRect(K, x0, W - 14 - x0, ya, yb - ya, o.labels?.noData)); }
  }
  const rangeScale = (id, x, w, defaultMax) => {
    const ax = id === 'species' && display === 'symbols' ? {} : K.axes?.[id] || {}, hi = ax.max ?? defaultMax, lo = ax.min ?? (ax.log ? hi / 1000 : 0);
    if (!(hi > lo) || (ax.log && !(lo > 0))) throw new Error('Invalid horizontal axis: max > min; logarithmic limits must be positive.');
    const tf = (v) => ax.log ? Math.log10(Math.max(v, 1e-12)) : v;
    const sx = (v) => x + (ax.rev ? 1 - (tf(v) - tf(lo)) / (tf(hi) - tf(lo)) : (tf(v) - tf(lo)) / (tf(hi) - tf(lo))) * w;
    let ticks = niceTicks(lo, hi, ax.div || 3);
    if (ax.log) { ticks = []; for (let e = Math.ceil(Math.log10(lo)); e <= Math.floor(Math.log10(hi)); e++) ticks.push(10 ** e); }
    else if (ax.step > 0) { ticks = []; for (let k = Math.ceil(lo / ax.step); k * ax.step <= hi && ticks.length < 400; k++) ticks.push(k * ax.step); }
    else if (ax.div > 0) { const n = Math.min(400, Math.max(1, Math.round(ax.div))); ticks = Array.from({length:n + 1}, (_, i) => lo + i * (hi - lo) / n); }
    for (const v of (Object.keys(ax).length ? ticks : []).filter((v) => v >= lo && v <= hi)) out.push(`<text x="${f2(sx(v))}" y="${top + H + 14}" text-anchor="middle" font-size="8">${ax.dec != null ? v.toFixed(Math.min(6, Math.max(0, ax.dec))) : lbl(v)}</text>`);
    out.push(`<defs><clipPath id="range-${x}"><rect x="${x}" y="${top}" width="${id === 'species' && !Object.keys(ax).length ? w + 6 : w}" height="${H}"/></clipPath></defs>`);
    sx.base = sx(lo); sx.log = !!ax.log; return sx;
  };
  let x = x0 + 10;
  if (o.total) {
    out.push(`<text x="${x + totW / 2}" y="${top - 8}" text-anchor="middle" font-weight="600" fill="${K.textColor}">${escXml(o.totalLabel || 'Bioturbation (%)')}</text>`);
    const sx = rangeScale('total', x, totW, 100);
    out.push(`<g clip-path="url(#range-${x})">`);
    for (const r of rows) if (r.pct != null && (!sx.log || r.pct > 0)) out.push(`<rect x="${f2(Math.min(sx.base, sx(r.pct)))}" y="${y(r.a0)}" width="${f2(Math.abs(sx(r.pct) - sx.base))}" height="${f2(Math.max(0.4, y(r.a1) - y(r.a0)))}" fill="${K.barColor}"/>`);
    out.push('</g>');
    out.push(`<rect x="${x}" y="${top}" width="${totW}" height="${H}" fill="none" stroke="${K.frameColor}" stroke-width="0.8"/>`);
    x += totW + 14;
  }
  for (const c of cols) {
    const cx = x + colW / 2, max = Math.max(1e-9, ...rows.map((r) => r.classPct?.[c.index] || 0)), cColor = validHexColor(c.color, '#777777');
    out.push(`<text transform="translate(${cx + 3},${top - 6}) rotate(-60)" font-style="${c.plain ? 'normal' : 'italic'}" font-weight="600" fill="${K.textColor}">${escXml(c.name)}</text>`);
    out.push(`<line x1="${cx}" y1="${top}" x2="${cx}" y2="${top + H}" stroke="${K.gridColor}" stroke-width="0.6"/>`);
    if (taxa) {
      const drawing = taxonColumnSVG({ rows, classes: [c], points: o.points || [], q: taxa, x: x + 3, width: colW - 6,
        top, height: H, y, from, to, axis: K.axes?.['sp:' + c.name] || K.axes?.species || {},
        ink: K.textColor, axisY: top + H + 14, markHollow: o.markHollow });
      out.push(drawing.axis, `<defs><clipPath id="range-${x}"><rect x="${x}" y="${top}" width="${colW}" height="${H}"/></clipPath></defs><g clip-path="url(#range-${x})">${drawing.body}</g>`);
      x += colW; continue;
    }
    const sx = rangeScale('species', x, colW - 6, max);
    out.push(`<g clip-path="url(#range-${x})">`);
    // V0.51: display = symbols | bars | both | kite (abundance as two symmetric curves) | kiteSymbols
    const showSym = display === 'symbols' || display === 'both' || display === 'kiteSymbols', kite = display === 'kite' || display === 'kiteSymbols';
    const custom = Object.keys(K.axes?.species || {}).length > 0;
    if (kite) {   // one closed outline per run of intervals with data: right side downwards, left side back up
      const half = (v) => (custom ? Math.abs(sx(v) - sx.base) : (v / max) * (colW - 6)) / 2;
      const runs = []; let cur = [];
      for (const r of [...rows].sort((a, b) => a.a0 - b.a0)) { if (r.classPct?.[c.index] == null || r.pct == null) { if (cur.length) runs.push(cur); cur = []; continue; } cur.push(r); }
      if (cur.length) runs.push(cur);
      for (const run of runs) {
        if (!run.some((r) => r.classPct[c.index] > 0)) continue;
        const pts = run.map((r) => [half(r.classPct[c.index]), y((r.a0 + r.a1) / 2)]), y0 = y(run[0].a0), y1 = y(run.at(-1).a1);
        const right = [[0, y0], ...pts, [0, y1]].map(([h, yy]) => `${f2(cx + h)},${f2(yy)}`), left = [...pts].reverse().map(([h, yy]) => `${f2(cx - h)},${f2(yy)}`);
        out.push(`<polygon points="${[...right, ...left].join(' ')}" fill="${cColor}" fill-opacity="0.85" stroke="${cColor}" stroke-width="0.6" stroke-linejoin="round"/>`);
      }
    }
    for (const r of display === 'bars' || display === 'both' ? rows : []) {
      const v = r.classPct?.[c.index] || 0; if (!v) continue;
      const w = custom ? Math.abs(sx(v) - sx.base) : Math.max(2, (v / max) * (colW - 6));
      out.push(`<rect x="${f2(custom ? Math.min(sx(v), sx.base) : cx - w / 2)}" y="${y(r.a0)}" width="${f2(w)}" height="${f2(Math.max(0.4, y(r.a1) - y(r.a0)))}" fill="${cColor}"/>`);
    }
    if (o.points && showSym) {   // V0.32: one symbol per identified trace or mark, at its own depth or age
      let lastY = -1e9, lastK = '';
      for (const p of o.points) {
        if (p.index !== c.index || p.a < from || p.a > to) continue;
        const yy = y(p.a) + 4; if (Math.abs(yy - lastY) < 0.6 && lastK === p.kind) continue;   // symbols are drawn above their origin: +4 centres them on the depth
        lastY = yy; lastK = p.kind;
        out.push(o.markHollow && p.kind === 'mark' ? traceSymbol(cx, yy, '#ffffff', c.symbol).replace(/stroke="[^"]*"/, `stroke="${cColor}"`).replace(/stroke-width="[^"]*"/, 'stroke-width="1.4"') : traceSymbol(cx, yy, cColor, c.symbol));
      }
    }
    const presence = o.points ? [] : [...(o.presence || []).filter((q) => q.index === c.index)];
    if (!o.points) for (const r of rows) if ((r.classPct?.[c.index] || 0) > 0 && !presence.some((p) => p.a0 === r.a0 && p.a1 === r.a1)) presence.push({a0:r.a0,a1:r.a1});
    if (showSym) for (const p of presence) {
      if (p.a1 <= from || p.a0 >= to) continue;
      const mid = (Math.max(from, p.a0) + Math.min(to, p.a1)) / 2;
      out.push(traceSymbol(cx, y(mid) + 4, cColor, c.symbol));
    }
    out.push('</g>');
    x += colW;
  }
  out.push('</svg>');
  return { svg: out.join(''), width: W, height: Htot, columns: allCols };
}

/** CSV of the intervals inside the window, plus external records interpolated at each interval centre. */
export function windowCSV({ rows, from, to, classes, records, units, ageUnits, recordMode = 'mean', model = null }) {
  const sel = rows.filter((r) => r.a1 > from && r.a0 < to);
  // Card Q4 (decision P): a record's column is the mean of its samples inside the interval, with their number, or (`point`) its value
  // interpolated at the centre, never across a gap wider than three times its median spacing (the cursor's rule).
  const samplers = records.map((s) => seriesSampler(s.x, s.y));
  const ageAt = (depth) => (model ? interpAge(model, depth) : null);
  const head = ['section', `depth_top_${units}`, `depth_bottom_${units}`, `depth_${units}`, `age_${ageUnits}`, 'bioturbation_pct',
    ...classes.map((c) => `${c.name}_pct`), 'BI', 'ii', 'BI_manual', 'ii_manual',
    ...records.flatMap((r) => (recordMode === 'point' ? [`${r.name} (interp.)`] : [`${r.name} (mean)`, `${r.name} (n)`])), 'note'];
  const out = [head];
  for (const r of sel) {
    const cells = records.flatMap((s, k) => {
      const onDepth = s.axis === 'depth';
      if (recordMode === 'point') return [samplers[k].at(onDepth ? r.depth : r.age)];
      const { mean, n } = onDepth ? samplers[k].mean(r.dTop, r.dBottom) : samplers[k].mean(ageAt(r.dTop), ageAt(r.dBottom));
      return [mean, n];
    });
    out.push([r.section, r.dTop, r.dBottom, r.depth, r.age, r.pct, ...classes.map((c) => r.classPct[c.index]), r.BI, r.ii, r.BIm, r.iim,
      ...cells, r.reversed ? 'age reversal' : '']);
  }
  const csv = toCSV(out);
  return rows.outside ? csv + `# ${rows.outside} intervals lie outside the age model and are not listed\n` : csv;
}
