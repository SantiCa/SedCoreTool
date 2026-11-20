// SedCoreTool web — scientific plots of the Data tab (V21), in the spirit of Golden Software Grapher. No DOM.
// XY plots (line, scatter, line + symbols, step, area, bars; secondary Y axis; log or inverted axes; curve fits with
// equation and R²) and stratigraphic plots (one panel per variable sharing a vertical depth/age axis).
import { minOf, maxOf } from './core.js';

const esc3 = (s) => String(s ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m]);
export const PLOT_TYPES = ['line', 'scatter', 'linesym', 'step', 'area', 'bar'];
export const FIT_KINDS = ['none', 'linear', 'poly', 'exp', 'power', 'log', 'movavg'];
export const PLOT_COLORS = ['#1f6fb2', '#c0392b', '#2e7d4f', '#8e44ad', '#d68910', '#16a085', '#7f8c8d', '#c2185b', '#5d4037', '#283593'];

/* ───────── statistics and fits ───────── */
const okv = (v) => v != null && Number.isFinite(v);
export function xyPairs(x, y) { const out = []; for (let i = 0; i < Math.min(x.length, y.length); i++) if (okv(x[i]) && okv(y[i])) out.push([x[i], y[i]]); return out; }
export function plotStats(v) {
  const a = v.filter(okv), n = a.length; if (!n) return { n: 0 };
  const m = a.reduce((s, q) => s + q, 0) / n, sd = n > 1 ? Math.sqrt(a.reduce((s, q) => s + (q - m) ** 2, 0) / (n - 1)) : 0;
  const so = [...a].sort((p, q) => p - q), med = n % 2 ? so[(n - 1) / 2] : (so[n / 2 - 1] + so[n / 2]) / 2;
  return { n, mean: m, sd, min: so[0], max: so[n - 1], median: med };
}
export function pearson(x, y) {
  const p = xyPairs(x, y); if (p.length < 3) return null;
  const mx = p.reduce((s, q) => s + q[0], 0) / p.length, my = p.reduce((s, q) => s + q[1], 0) / p.length;
  let sxy = 0, sxx = 0, syy = 0; for (const [a, b] of p) { sxy += (a - mx) * (b - my); sxx += (a - mx) ** 2; syy += (b - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}
/** Least squares polynomial of degree d (normal equations, Gaussian elimination). */
function polyfit(p, d) {
  const m = d + 1, A = Array.from({ length: m }, () => new Array(m + 1).fill(0));
  for (const [x, y] of p) for (let i = 0; i < m; i++) { for (let j = 0; j < m; j++) A[i][j] += x ** (i + j); A[i][m] += y * x ** i; }
  for (let c = 0; c < m; c++) {
    let r = c; for (let k = c + 1; k < m; k++) if (Math.abs(A[k][c]) > Math.abs(A[r][c])) r = k;
    [A[c], A[r]] = [A[r], A[c]]; if (Math.abs(A[c][c]) < 1e-14) return null;
    for (let k = 0; k < m; k++) if (k !== c) { const f = A[k][c] / A[c][c]; for (let j = c; j <= m; j++) A[k][j] -= f * A[c][j]; }
  }
  return A.map((r, i) => r[m] / r[i]);
}
const r2of = (p, f) => { const my = p.reduce((s, q) => s + q[1], 0) / p.length; let ss = 0, sr = 0; for (const [x, y] of p) { ss += (y - my) ** 2; sr += (y - f(x)) ** 2; } return ss ? 1 - sr / ss : null; };
const fmtN = (v) => (Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(3) : +v.toPrecision(4));
/**
 * Curve fit. kind: linear | poly (deg) | exp (y = a·e^(b·x), fitted on ln y) | power (y = a·x^b, on ln x, ln y) |
 * log (y = a + b·ln x) | movavg (centred moving average of `window` points, along x). Returns {fn, eq, r2, n} or null.
 */
export function fitCurve(x, y, kind, { deg = 2, window = 5 } = {}) {
  let p = xyPairs(x, y).sort((a, b) => a[0] - b[0]); if (p.length < 3) return null;
  if (kind === 'linear' || kind === 'poly') {
    const d = kind === 'linear' ? 1 : Math.max(2, Math.min(6, deg)), c = polyfit(p, d); if (!c) return null;
    const fn = (t) => c.reduce((s, k, i) => s + k * t ** i, 0);
    const eq = 'y = ' + c.map((k, i) => (i === 0 ? fmtN(k) : `${k < 0 ? '−' : '+'} ${fmtN(Math.abs(k))}${i === 1 ? 'x' : `x^${i}`}`)).join(' ');
    return { fn, eq, r2: r2of(p, fn), n: p.length, coef: c };
  }
  if (kind === 'exp') { const q = p.filter((r) => r[1] > 0); const c = polyfit(q.map(([a, b]) => [a, Math.log(b)]), 1); if (!c) return null; const A = Math.exp(c[0]), B = c[1], fn = (t) => A * Math.exp(B * t); return { fn, eq: `y = ${fmtN(A)}·e^(${fmtN(B)}x)`, r2: r2of(q, fn), n: q.length, coef: [A, B] }; }
  if (kind === 'power') { const q = p.filter((r) => r[0] > 0 && r[1] > 0); const c = polyfit(q.map(([a, b]) => [Math.log(a), Math.log(b)]), 1); if (!c) return null; const A = Math.exp(c[0]), B = c[1], fn = (t) => A * t ** B; return { fn, eq: `y = ${fmtN(A)}·x^${fmtN(B)}`, r2: r2of(q, fn), n: q.length, coef: [A, B] }; }
  if (kind === 'log') { const q = p.filter((r) => r[0] > 0); const c = polyfit(q.map(([a, b]) => [Math.log(a), b]), 1); if (!c) return null; const fn = (t) => c[0] + c[1] * Math.log(t); return { fn, eq: `y = ${fmtN(c[0])} ${c[1] < 0 ? '−' : '+'} ${fmtN(Math.abs(c[1]))}·ln x`, r2: r2of(q, fn), n: q.length, coef: c }; }
  if (kind === 'movavg') {
    const h = Math.floor(Math.max(2, window) / 2), sm = p.map((_, i) => { const w = p.slice(Math.max(0, i - h), i + h + 1); return [p[i][0], w.reduce((s, r) => s + r[1], 0) / w.length]; });
    return { pts: sm, eq: `movavg(${2 * h + 1})`, r2: null, n: p.length };
  }
  return null;
}

/* ───────── axes ───────── */
export function plotStep(span, n = 6) { const raw = span / n || 1, p = 10 ** Math.floor(Math.log10(raw)); return [1, 2, 2.5, 5, 10].map((k) => k * p).find((k) => k >= raw) || raw; }
function ticksOf(lo, hi, log, n = 6) {
  if (log) { const out = []; for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) for (const m of [1, 2, 5]) { const v = m * 10 ** e; if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v); } return out; }
  const st = plotStep(hi - lo, n), out = []; for (let v = Math.ceil(lo / st) * st; v <= hi + st * 1e-9; v += st) out.push(+v.toPrecision(12)); return out;
}
/** Axis range from data (with 4 % padding) unless min/max are given. */
export function axisRange(vals, ax = {}) {
  let v = vals.filter(okv); if (ax.log) v = v.filter((q) => q > 0);
  let lo = okv(ax.min) ? ax.min : minOf(v), hi = okv(ax.max) ? ax.max : maxOf(v);
  if (!v.length && !(okv(ax.min) && okv(ax.max))) return [0, 1];
  if (lo === hi) { lo -= 1; hi += 1; }
  if (!ax.log) { const pad = (hi - lo) * 0.04; if (!okv(ax.min)) lo -= pad; if (!okv(ax.max)) hi += pad; } else if (lo <= 0) lo = hi / 1000;
  return [lo, hi];
}
const scaler = (lo, hi, a, b, log, inv) => { const f = log ? (v) => (Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo)) : (v) => (v - lo) / (hi - lo); return (v) => (inv ? b - f(v) * (b - a) : a + f(v) * (b - a)); };
const fmtT = (v) => (Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(1) : +v.toPrecision(6));

function plotSymbol(kind, x, y, r, col) {
  if (kind === 'square') return `<rect x="${(x - r).toFixed(1)}" y="${(y - r).toFixed(1)}" width="${2 * r}" height="${2 * r}" fill="${col}"/>`;
  if (kind === 'triangle') return `<polygon points="${x},${(y - r * 1.2).toFixed(1)} ${(x - r).toFixed(1)},${(y + r * 0.8).toFixed(1)} ${(x + r).toFixed(1)},${(y + r * 0.8).toFixed(1)}" fill="${col}"/>`;
  if (kind === 'diamond') return `<polygon points="${x},${(y - r * 1.3).toFixed(1)} ${(x + r).toFixed(1)},${y} ${x},${(y + r * 1.3).toFixed(1)} ${(x - r).toFixed(1)},${y}" fill="${col}"/>`;
  return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${col}"/>`;
}
const SYMS = ['circle', 'square', 'triangle', 'diamond'];

/** One series drawn with scale functions sx, sy (data → px). Series {x, y, type, color, width, size, symbol, dash, base}. */
function drawSeries(se, sx, sy, horizontal = false) {
  const P = xyPairs(se.x, se.y), out = [], col = se.color, w = se.width ?? 1.4, r = se.size ?? 2.6;
  if (!P.length) return '';
  const pt = ([a, b]) => (horizontal ? [sx(b), sy(a)] : [sx(a), sy(b)]); // stratigraphic panels: x = value, y = depth
  const sorted = [...P].sort((p, q) => p[0] - q[0]), dash = se.dash ? ` stroke-dasharray="${se.dash}"` : '';
  const path = (pts) => pts.map((p, k) => `${k ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('');
  if (se.type === 'area') {
    const base = horizontal ? sx(se.base ?? 0) : sy(se.base ?? 0), pts = sorted.map(pt);
    const poly = horizontal ? [[base, pts[0][1]], ...pts, [base, pts[pts.length - 1][1]]] : [[pts[0][0], base], ...pts, [pts[pts.length - 1][0], base]];
    out.push(`<path d="${path(poly)}Z" fill="${col}" fill-opacity="0.35" stroke="${col}" stroke-width="${w}"/>`);
  } else if (se.type === 'bar') {
    const n = sorted.length, span = sorted.length > 1 ? (sorted[n - 1][0] - sorted[0][0]) / (n - 1) : 1;
    for (const [a, b] of sorted) {
      if (horizontal) { const y1 = sy(a - span * 0.4), y2 = sy(a + span * 0.4), x0 = sx(se.base ?? 0), x1 = sx(b); out.push(`<rect x="${Math.min(x0, x1).toFixed(1)}" y="${Math.min(y1, y2).toFixed(1)}" width="${Math.abs(x1 - x0).toFixed(1)}" height="${Math.max(0.5, Math.abs(y2 - y1)).toFixed(1)}" fill="${col}" fill-opacity="0.8"/>`); }
      else { const x1 = sx(a - span * 0.4), x2 = sx(a + span * 0.4), y0 = sy(se.base ?? 0), y1 = sy(b); out.push(`<rect x="${Math.min(x1, x2).toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${Math.max(0.5, Math.abs(x2 - x1)).toFixed(1)}" height="${Math.abs(y1 - y0).toFixed(1)}" fill="${col}" fill-opacity="0.8"/>`); }
    }
  } else if (se.type === 'step') {
    const pts = []; sorted.forEach(([a, b], k) => { if (k) pts.push(pt([a, sorted[k - 1][1]])); pts.push(pt([a, b])); });
    out.push(`<path d="${path(pts)}" fill="none" stroke="${col}" stroke-width="${w}"${dash}/>`);
  } else if (se.type !== 'scatter') {
    // a gap larger than 5× the median spacing breaks the line (no line across missing intervals)
    const dx = sorted.slice(1).map((p, k) => p[0] - sorted[k][0]).sort((a, b) => a - b), med = dx[dx.length >> 1] || 0;
    let seg = [];
    sorted.forEach((p, k) => { if (k && med && p[0] - sorted[k - 1][0] > 5 * med) { if (seg.length > 1) out.push(`<path d="${path(seg)}" fill="none" stroke="${col}" stroke-width="${w}"${dash}/>`); seg = []; } seg.push(pt(p)); });
    if (seg.length > 1) out.push(`<path d="${path(seg)}" fill="none" stroke="${col}" stroke-width="${w}"${dash}/>`);
  }
  if (se.type === 'scatter' || se.type === 'linesym') for (const p of P) { const [a, b] = pt(p); out.push(plotSymbol(se.symbol || 'circle', a, b, r, col)); }
  return out.join('');
}

function drawFit(se, fit, sx, sy, lo, hi, horizontal = false) {
  if (!fit) return '';
  let pts;
  if (fit.pts) pts = fit.pts; else { pts = []; for (let k = 0; k <= 120; k++) { const t = lo + ((hi - lo) * k) / 120, v = fit.fn(t); if (okv(v)) pts.push([t, v]); } }
  const d = pts.map((p, k) => { const [a, b] = horizontal ? [sx(p[1]), sy(p[0])] : [sx(p[0]), sy(p[1])]; return `${k ? 'L' : 'M'}${a.toFixed(1)} ${b.toFixed(1)}`; }).join('');
  return `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="1.6" stroke-dasharray="6 3" opacity="0.9"/>`;
}

/**
 * XY plot. spec = {title, width, height, x: axis, y: axis, y2: axis|null, series: [{name, x, y, type, color, symbol, y2, fit, deg, window}],
 * legend, grid, font}. axis = {label, min, max, log, invert}. Returns {svg, fits: [{name, eq, r2, n}], stats}.
 */
export function buildXYPlot(spec) {
  const W = spec.width || 760, H = spec.height || 480, fs = spec.font || 11;
  const hasY2 = spec.series.some((s) => s.y2), L = 64, R = hasY2 ? 66 : 20, T = spec.title ? 34 : 14, B = 48 + (spec.legend !== false ? 18 * Math.ceil(spec.series.length / 4) : 0);
  const pw = W - L - R, ph = H - T - B;
  const xr = axisRange(spec.series.flatMap((s) => s.x), spec.x), yr = axisRange(spec.series.filter((s) => !s.y2).flatMap((s) => s.y), spec.y), y2r = hasY2 ? axisRange(spec.series.filter((s) => s.y2).flatMap((s) => s.y), spec.y2 || {}) : null;
  const sx = scaler(xr[0], xr[1], L, L + pw, spec.x?.log, spec.x?.invert), sy = scaler(yr[0], yr[1], T + ph, T, spec.y?.log, spec.y?.invert);
  const sy2 = hasY2 ? scaler(y2r[0], y2r[1], T + ph, T, spec.y2?.log, spec.y2?.invert) : null;
  const s = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="IBM Plex Sans, Arial, sans-serif" font-size="${fs}"><rect width="${W}" height="${H}" fill="#fff"/>`];
  if (spec.title) s.push(`<text x="${W / 2}" y="20" text-anchor="middle" font-size="${fs + 3}" font-weight="600">${esc3(spec.title)}</text>`);
  const xt = ticksOf(xr[0], xr[1], spec.x?.log), yt = ticksOf(yr[0], yr[1], spec.y?.log);
  if (spec.grid !== false) { for (const v of xt) s.push(`<line x1="${sx(v).toFixed(1)}" y1="${T}" x2="${sx(v).toFixed(1)}" y2="${T + ph}" stroke="#e3e7e6"/>`); for (const v of yt) s.push(`<line x1="${L}" y1="${sy(v).toFixed(1)}" x2="${L + pw}" y2="${sy(v).toFixed(1)}" stroke="#e3e7e6"/>`); }
  s.push(`<defs><clipPath id="pc"><rect x="${L}" y="${T}" width="${pw}" height="${ph}"/></clipPath></defs><g clip-path="url(#pc)">`);
  const fits = [], st = [];
  spec.series.forEach((se, i) => {
    const color = se.color || PLOT_COLORS[i % PLOT_COLORS.length], ser = { ...se, color, symbol: se.symbol || SYMS[i % SYMS.length] }, ys = se.y2 ? sy2 : sy;
    s.push(drawSeries(ser, sx, ys));
    if (se.fit && se.fit !== 'none') { const f = fitCurve(se.x, se.y, se.fit, { deg: se.deg, window: se.window }); if (f) { s.push(drawFit(ser, f, sx, ys, xr[0], xr[1])); fits.push({ name: se.name, eq: f.eq, r2: f.r2, n: f.n }); } }
    st.push({ name: se.name, ...plotStats(se.y), r: pearson(se.x, se.y) });
  });
  s.push('</g>');
  s.push(`<rect x="${L}" y="${T}" width="${pw}" height="${ph}" fill="none" stroke="#1c2422" stroke-width="0.8"/>`);
  for (const v of xt) s.push(`<line x1="${sx(v).toFixed(1)}" y1="${T + ph}" x2="${sx(v).toFixed(1)}" y2="${T + ph + 4}" stroke="#1c2422"/><text x="${sx(v).toFixed(1)}" y="${T + ph + 16}" text-anchor="middle">${fmtT(v)}</text>`);
  for (const v of yt) s.push(`<line x1="${L - 4}" y1="${sy(v).toFixed(1)}" x2="${L}" y2="${sy(v).toFixed(1)}" stroke="#1c2422"/><text x="${L - 6}" y="${(sy(v) + 3.5).toFixed(1)}" text-anchor="end">${fmtT(v)}</text>`);
  if (hasY2) for (const v of ticksOf(y2r[0], y2r[1], spec.y2?.log)) s.push(`<line x1="${L + pw}" y1="${sy2(v).toFixed(1)}" x2="${L + pw + 4}" y2="${sy2(v).toFixed(1)}" stroke="#1c2422"/><text x="${L + pw + 6}" y="${(sy2(v) + 3.5).toFixed(1)}">${fmtT(v)}</text>`);
  s.push(`<text x="${L + pw / 2}" y="${T + ph + 34}" text-anchor="middle" font-weight="600">${esc3(spec.x?.label)}</text>`);
  s.push(`<text transform="translate(16 ${T + ph / 2}) rotate(-90)" text-anchor="middle" font-weight="600">${esc3(spec.y?.label)}</text>`);
  if (hasY2) s.push(`<text transform="translate(${W - 12} ${T + ph / 2}) rotate(90)" text-anchor="middle" font-weight="600">${esc3(spec.y2?.label)}</text>`);
  if (spec.legend !== false) spec.series.forEach((se, i) => {
    const col = se.color || PLOT_COLORS[i % PLOT_COLORS.length], x = L + (i % 4) * (pw / 4), y = T + ph + 50 + 18 * Math.floor(i / 4);
    s.push(`<line x1="${x}" y1="${y - 4}" x2="${x + 18}" y2="${y - 4}" stroke="${col}" stroke-width="2"/>${se.type === 'scatter' || se.type === 'linesym' ? plotSymbol(se.symbol || SYMS[i % SYMS.length], x + 9, y - 4, 3, col) : ''}<text x="${x + 24}" y="${y}">${esc3(se.name)}${se.y2 ? ' (Y2)' : ''}</text>`);
  });
  s.push('</svg>');
  return { svg: s.join(''), fits, stats: st };
}

/**
 * Stratigraphic plot: one panel per variable, all sharing the vertical axis (depth or age, downwards).
 * spec = {title, width, height, v: axis (vertical), panels: [{label, series: [{name, x: depth/age, y: value, type, color}], log, min, max, fit}]}.
 */
export function buildStratPlot(spec) {
  const np = Math.max(1, spec.panels.length), H = spec.height || 640, fs = spec.font || 11, L = 64, T = (spec.title ? 34 : 14) + 34, B = 26 + (spec.legend !== false ? 18 : 0);
  const pw = spec.panelWidth || 150, gap = 14, W = Math.max(spec.width || 0, L + np * (pw + gap) + 10), ph = H - T - B;
  const all = spec.panels.flatMap((p) => p.series.flatMap((se) => se.x));
  const vr = axisRange(all, spec.v), inv = spec.v?.invert !== false;
  const sv = scaler(vr[0], vr[1], T, T + ph, false, !inv); // depth grows downwards
  const s = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="IBM Plex Sans, Arial, sans-serif" font-size="${fs}"><rect width="${W}" height="${H}" fill="#fff"/>`];
  if (spec.title) s.push(`<text x="${W / 2}" y="20" text-anchor="middle" font-size="${fs + 3}" font-weight="600">${esc3(spec.title)}</text>`);
  const vt = ticksOf(vr[0], vr[1], false, 10);
  for (const v of vt) s.push(`<line x1="${L - 4}" y1="${sv(v).toFixed(1)}" x2="${L}" y2="${sv(v).toFixed(1)}" stroke="#1c2422"/><text x="${L - 6}" y="${(sv(v) + 3.5).toFixed(1)}" text-anchor="end">${fmtT(v)}</text>`);
  s.push(`<text transform="translate(16 ${T + ph / 2}) rotate(-90)" text-anchor="middle" font-weight="600">${esc3(spec.v?.label)}</text>`);
  const fits = [], st = [], names = new Map();
  spec.panels.forEach((p, k) => {
    const x0 = L + k * (pw + gap), xr = axisRange(p.series.flatMap((se) => se.y), p), sx = scaler(xr[0], xr[1], x0, x0 + pw, p.log, p.invert);
    if (spec.grid !== false) { for (const v of vt) s.push(`<line x1="${x0}" y1="${sv(v).toFixed(1)}" x2="${x0 + pw}" y2="${sv(v).toFixed(1)}" stroke="#eef1f0"/>`); }
    s.push(`<clipPath id="sp${k}"><rect x="${x0}" y="${T}" width="${pw}" height="${ph}"/></clipPath><g clip-path="url(#sp${k})">`);
    p.series.forEach((se, i) => {
      const color = se.color || PLOT_COLORS[i % PLOT_COLORS.length]; names.set(se.core || se.name, color);
      const ser = { ...se, color, symbol: se.symbol || SYMS[i % SYMS.length] };
      s.push(drawSeries(ser, sx, sv, true));
      if (p.fit && p.fit !== 'none') { const f = fitCurve(se.x, se.y, p.fit === 'movavg' ? 'movavg' : p.fit, { deg: p.deg, window: p.window }); if (f) { s.push(drawFit(ser, f, sx, sv, vr[0], vr[1], true)); fits.push({ name: `${p.label} · ${se.name}`, eq: f.eq, r2: f.r2, n: f.n }); } }
      st.push({ name: `${p.label} · ${se.name}`, ...plotStats(se.y) });
    });
    s.push('</g>');
    s.push(`<rect x="${x0}" y="${T}" width="${pw}" height="${ph}" fill="none" stroke="#1c2422" stroke-width="0.8"/>`);
    const xt = ticksOf(xr[0], xr[1], p.log, 3);
    for (const v of xt) s.push(`<line x1="${sx(v).toFixed(1)}" y1="${T - 4}" x2="${sx(v).toFixed(1)}" y2="${T}" stroke="#1c2422"/><text x="${sx(v).toFixed(1)}" y="${T - 7}" text-anchor="middle" font-size="${fs - 1.5}">${fmtT(v)}</text>`);
    s.push(`<text x="${x0 + pw / 2}" y="${T - 22}" text-anchor="middle" font-weight="600">${esc3(p.label)}</text>`);
  });
  if (spec.legend !== false) { let x = L; for (const [n, c] of names) { s.push(`<line x1="${x}" y1="${H - 12}" x2="${x + 18}" y2="${H - 12}" stroke="${c}" stroke-width="2"/><text x="${x + 24}" y="${H - 8}">${esc3(n)}</text>`); x += 40 + String(n).length * 6.5; } }
  s.push('</svg>');
  return { svg: s.join(''), fits, stats: st };
}
