// SedCoreTool web — V0.43: core location map (figure). DOM-free: coordinate reference systems (EPSG:4326, EPSG:3857,
// UTM/WGS 84 with zone and hemisphere), map frame, geographic graticule or metric grid, edge labels (DD, DMS or
// metres), scale bar, north arrow and the SVG. Names are prefixed (lm…) because the offline build joins all modules.
import { finiteStyleNumber } from './log.js';
import { minOf, maxOf } from './core.js';

const LM_D = Math.PI / 180, LM_A = 6378137, LM_F = 1 / 298.257223563;

/** Default settings of the figure (S.fig.loc). bbox = [W, S, E, N] in degrees or null (fitted to the cores). */
export const LOCMAP_DEFAULTS = {
  crs: 'EPSG:4326', utmZone: null, utmSouth: null, bbox: null, margin: 0.25, width: 900, aspect: '4:3',
  base: 'vector', baseOpacity: 1, land: '#e6e6dc', sea: '#eef4f6', coast: true,
  grid: true, gridType: 'auto', gridStep: null, gridColor: '#8a9592', gridWidth: 0.5, gridDash: true,
  labels: { top: false, bottom: true, left: true, right: false }, coordFmt: 'dd', metricUnit: 'm', rotateSide: true,
  labelSize: 10, ticks: true, textColor: '#1c2422', subColor: '#5b6763', bgColor: '#ffffff',
  scaleBar: true, scalePos: 'bl', north: true, northPos: 'tr', northSize: 1,
  symbol: 'circle', pointSize: 6, pointColor: '#c0392b', pointStroke: '#1c2422', coreLabels: true, coreLabelSize: 11,
  fmt: 'svg', scale: 3, quality: 0.92,
};

/* ── coordinate reference systems ── */

/** UTM zone (1–60) of a longitude. */
export const lmUtmZone = (lon) => Math.min(60, Math.max(1, Math.floor((((lon + 180) % 360) + 360) % 360 / 6) + 1));

/** Transverse Mercator (Krüger series to n⁴, WGS 84; sub-millimetre within the zone). */
function lmUTM(zone, south) {
  const n = LM_F / (2 - LM_F), n2 = n * n, n3 = n2 * n, n4 = n3 * n, e = (2 * Math.sqrt(n)) / (1 + n);
  const A = (LM_A / (1 + n)) * (1 + n2 / 4 + n4 / 64), k0 = 0.9996, E0 = 500000, N0 = south ? 1e7 : 0, l0 = (zone * 6 - 183) * LM_D;
  const al = [n / 2 - (2 * n2) / 3 + (5 * n3) / 16 + (41 * n4) / 180, (13 * n2) / 48 - (3 * n3) / 5 + (557 * n4) / 1440, (61 * n3) / 240 - (103 * n4) / 140, (49561 * n4) / 161280];
  const be = [n / 2 - (2 * n2) / 3 + (37 * n3) / 96 - n4 / 360, n2 / 48 + n3 / 15 - (437 * n4) / 1440, (17 * n3) / 480 - (37 * n4) / 840, (4397 * n4) / 161280];
  const de = [2 * n - (2 * n2) / 3 - 2 * n3 + (116 * n4) / 45, (7 * n2) / 3 - (8 * n3) / 5 - (227 * n4) / 45, (56 * n3) / 15 - (136 * n4) / 35, (4279 * n4) / 630];
  return {
    fwd(lon, lat) {
      let dl = lon * LM_D - l0; dl = Math.atan2(Math.sin(dl), Math.cos(dl)); dl = Math.max(-1.3, Math.min(1.3, dl));   // ±75° from the meridian at most
      const p = Math.max(-89.9, Math.min(89.9, lat)) * LM_D, s = Math.sin(p), tt = Math.sinh(Math.atanh(s) - e * Math.atanh(e * s));
      const xi = Math.atan2(tt, Math.cos(dl)), eta = Math.atanh(Math.sin(dl) / Math.sqrt(1 + tt * tt));
      let x = eta, y = xi;
      for (let j = 1; j <= 4; j++) { x += al[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta); y += al[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta); }
      return [E0 + k0 * A * x, N0 + k0 * A * y];
    },
    inv(E, N) {
      const xi = (N - N0) / (k0 * A), eta = (E - E0) / (k0 * A);
      let x = xi, y = eta;
      for (let j = 1; j <= 4; j++) { x -= be[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta); y -= be[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta); }
      const chi = Math.asin(Math.sin(x) / Math.cosh(y));
      let p = chi; for (let j = 1; j <= 4; j++) p += de[j - 1] * Math.sin(2 * j * chi);
      return [(l0 + Math.atan2(Math.sinh(y), Math.cos(x))) / LM_D, p / LM_D];
    },
  };
}

/**
 * Coordinate reference system: {id, name, epsg, geographic, unit, fwd(lon, lat) → [X, Y], inv(X, Y) → [lon, lat]}.
 * id: 'EPSG:4326' (X = lon, Y = lat, degrees), 'EPSG:3857' (Web Mercator, m) or 'UTM' with o.zone and o.south.
 */
export function lmCRS(id, o = {}) {
  if (id === 'EPSG:3857') {
    return { id, name: 'WGS 84 / Pseudo-Mercator', epsg: 3857, geographic: false, unit: 'm',
      fwd: (lon, lat) => [LM_A * lon * LM_D, LM_A * Math.log(Math.tan(Math.PI / 4 + (Math.max(-85.0511, Math.min(85.0511, lat)) * LM_D) / 2))],
      inv: (x, y) => [x / LM_A / LM_D, (2 * Math.atan(Math.exp(y / LM_A)) - Math.PI / 2) / LM_D] };
  }
  if (id === 'UTM') {
    const zone = Math.min(60, Math.max(1, Math.round(o.zone || 30))), south = !!o.south, t = lmUTM(zone, south);
    return { id, name: `WGS 84 / UTM ${zone}${south ? 'S' : 'N'}`, epsg: (south ? 32700 : 32600) + zone, geographic: false, unit: 'm', zone, south, ...t };
  }
  return { id: 'EPSG:4326', name: 'WGS 84 (geographic)', epsg: 4326, geographic: true, unit: '°', fwd: (lon, lat) => [lon, lat], inv: (x, y) => [x, y] };
}

/** Extent around the cores: [W, S, E, N] with a margin (fraction of the span, at least 0.2°). */
export function lmFitBBox(points, margin = 0.25) {
  const P = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (!P.length) return [-12, 34, 6, 45];
  let w = minOf(P.map((p) => p.lon)), e = maxOf(P.map((p) => p.lon)), s = minOf(P.map((p) => p.lat)), n = maxOf(P.map((p) => p.lat));
  const mx = Math.max(0.2, (e - w) * margin), my = Math.max(0.2, (n - s) * margin);
  w -= mx; e += mx; s = Math.max(-85, s - my); n = Math.min(85, n + my);
  return [w, s, e, n].map((v) => +v.toFixed(4));
}
/** Zoom (f > 1 in) and pan (fractions of the span) an extent. */
export function lmZoom(b, f = 1, dx = 0, dy = 0) {
  const cx = (b[0] + b[2]) / 2 + dx * (b[2] - b[0]), cy = (b[1] + b[3]) / 2 + dy * (b[3] - b[1]), hw = (b[2] - b[0]) / 2 / f, hh = (b[3] - b[1]) / 2 / f;
  return [cx - hw, Math.max(-85, cy - hh), cx + hw, Math.min(85, cy + hh)].map((v) => +v.toFixed(5));
}

/**
 * Frame: projected envelope of the bbox (its edges sampled, so curved UTM edges fit), size in px and transforms.
 * aspect 'auto' keeps the projected proportion; a number (height/width) widens the envelope to that ratio.
 */
export function lmFrame(crs, bbox, width = 900, aspect = 'auto') {
  const [w, s, e, n] = bbox, xs = [], ys = [];
  for (let k = 0; k <= 32; k++) {
    const lo = w + ((e - w) * k) / 32, la = s + ((n - s) * k) / 32;
    for (const [a, b] of [[lo, s], [lo, n], [w, la], [e, la]]) { const [x, y] = crs.fwd(a, b); xs.push(x); ys.push(y); }
  }
  let X0 = minOf(xs), X1 = maxOf(xs), Y0 = minOf(ys), Y1 = maxOf(ys);
  const r = +aspect;
  if (r > 0) { const cur = (Y1 - Y0) / (X1 - X0 || 1); if (cur < r) { const c = (Y0 + Y1) / 2, h = ((X1 - X0) * r) / 2; Y0 = c - h; Y1 = c + h; } else { const c = (X0 + X1) / 2, h = (Y1 - Y0) / r / 2; X0 = c - h; X1 = c + h; } }
  const W = Math.round(width), H = Math.max(40, Math.round((W * (Y1 - Y0)) / (X1 - X0 || 1)));
  const toPx = (X, Y) => [((X - X0) / (X1 - X0)) * W, ((Y1 - Y) / (Y1 - Y0)) * H];
  const fromPx = (px, py) => [X0 + (px / W) * (X1 - X0), Y1 - (py / H) * (Y1 - Y0)];
  return { X0, X1, Y0, Y1, W, H, toPx, fromPx, P: (lon, lat) => toPx(...crs.fwd(lon, lat)), Pinv: (px, py) => crs.inv(...fromPx(px, py)) };
}

/* ── grid steps and label formats ── */

const LM_DEG_STEPS = [1 / 3600, 2 / 3600, 5 / 3600, 10 / 3600, 15 / 3600, 30 / 3600, 1 / 60, 2 / 60, 5 / 60, 10 / 60, 15 / 60, 20 / 60, 0.5, 1, 2, 5, 10, 15, 20, 30, 45];
/** Step of a geographic graticule: sexagesimal-friendly values (minutes and seconds) giving about n lines. */
export function lmDegStep(span, n = 5) { const raw = span / n; return LM_DEG_STEPS.find((v) => v >= raw * 0.999) || 45; }
/** Step of a metric grid: 1, 2 or 5 × 10ᵏ m giving about n lines. */
export function lmMetricStep(span, n = 5) { const raw = span / n, p = 10 ** Math.floor(Math.log10(raw)); return [1, 2, 5, 10].map((k) => k * p).find((v) => v >= raw * 0.999); }
const lmMultiples = (a, b, st) => { const out = []; for (let v = Math.ceil(a / st - 1e-9) * st; v <= b + st * 1e-9; v += st) out.push(+v.toFixed(9)); return out; };

/** Degrees as text: fmt 'dd' (decimal, digits from the step) or 'dms'; axis 'lat' | 'lon' adds the hemisphere. */
export function lmFormatDeg(v, axis, fmt = 'dd', step = 1) {
  const hemi = axis === 'lat' ? (v > 1e-9 ? 'N' : v < -1e-9 ? 'S' : '') : (v > 1e-9 && v < 180 - 1e-9 ? 'E' : v < -1e-9 ? 'W' : ''), a = Math.abs(v);
  if (fmt === 'dms') {
    let tot = Math.round(a * 3600), d = Math.floor(tot / 3600), m = Math.floor((tot % 3600) / 60), s = tot % 60;
    if (s === 60) { s = 0; m++; } if (m === 60) { m = 0; d++; }
    const secs = step < 1 / 60 - 1e-12, mins = secs || step < 1 - 1e-12 || m || s;
    return `${d}°${mins ? String(m).padStart(2, '0') + '′' : ''}${secs ? String(s).padStart(2, '0') + '″' : ''}${hemi}`;
  }
  let dec = 0; while (dec < 6 && Math.abs(Math.round(step * 10 ** dec) - step * 10 ** dec) > 1e-6) dec++;
  return `${a.toFixed(dec)}°${hemi}`;
}
/** Metres as text with thin-space thousands (unit 'm' or 'km'). */
export function lmFormatMetric(v, unit = 'm', step = 1000) {
  if (unit === 'km') { const dec = step >= 1000 ? 0 : Math.min(3, Math.ceil(-Math.log10(step / 1000))); return (v / 1000).toFixed(dec).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' km'; }
  return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/* ── scale bar and north arrow ── */

const lmHav = (lo1, la1, lo2, la2) => { const p1 = la1 * LM_D, p2 = la2 * LM_D, dp = p2 - p1, dl = (lo2 - lo1) * LM_D, h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2; return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h))); };
/** Ground metres per pixel at a pixel of the frame (great-circle distance across ±10 px horizontally). */
export function lmMetresPerPx(fr, px, py) { const [a, b] = fr.Pinv(px - 10, py), [c, d] = fr.Pinv(px + 10, py); return lmHav(a, b, c, d) / 20; }
/** "Nice" scale-bar length (1, 2, 5 × 10ᵏ m) of at most maxPx pixels: {m, px, label}. */
export function lmScaleBar(mpp, maxPx) {
  const raw = mpp * maxPx, p = 10 ** Math.floor(Math.log10(raw)), m = [5, 2, 1].map((k) => k * p).find((k) => k <= raw) || p;
  return { m, px: m / mpp, label: m >= 1000 ? `${+(m / 1000).toFixed(3)} km` : `${m} m` };
}
/** Angle (degrees, clockwise from the top of the frame) of true north at a pixel; 0 in EPSG:4326/3857, the grid convergence in UTM. */
export function lmNorthAngle(fr, px, py) {
  const [lon, lat] = fr.Pinv(px, py), a = fr.P(lon, lat), b = fr.P(lon, Math.min(89.9, lat + 0.01));
  return (Math.atan2(b[0] - a[0], a[1] - b[1]) * 180) / Math.PI;
}

/* ── SVG ── */

const lmEsc = (s) => {
  try { return String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]); }
  catch { return ''; }
};
function lmSymbol(sym, x, y, r, attrs) {
  const f = (v) => v.toFixed(1);
  if (sym === 'square') return `<rect x="${f(x - r * 0.89)}" y="${f(y - r * 0.89)}" width="${f(r * 1.78)}" height="${f(r * 1.78)}" ${attrs}/>`;
  if (sym === 'triangle') return `<polygon points="${f(x)},${f(y - r * 1.15)} ${f(x + r)},${f(y + r * 0.6)} ${f(x - r)},${f(y + r * 0.6)}" ${attrs}/>`;
  if (sym === 'diamond') return `<polygon points="${f(x)},${f(y - r * 1.2)} ${f(x + r)},${f(y)} ${f(x)},${f(y + r * 1.2)} ${f(x - r)},${f(y)}" ${attrs}/>`;
  if (sym === 'star') { const p = []; for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 5, q = k % 2 ? r * 0.5 : r * 1.25; p.push(`${f(x + q * Math.cos(a))},${f(y + q * Math.sin(a))}`); } return `<polygon points="${p.join(' ')}" ${attrs}/>`; }
  return `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" ${attrs}/>`;
}
/** Where the polyline values v(t) along an edge cross level `level` (t in [0, 1]), by sampling. */
function lmCross(fn, level, n = 240) {
  const out = []; let a = fn(0) - level;
  for (let k = 1; k <= n; k++) { const b = fn(k / n) - level; if ((a <= 0 && b > 0) || (a >= 0 && b < 0)) out.push((k - 1 + Math.abs(a) / (Math.abs(a) + Math.abs(b) || 1)) / n); a = b; }
  return out;
}

/**
 * SVG of the location map. o = {settings (LOCMAP_DEFAULTS), points [{name, lat, lon}], land (rings of [lon, lat, …]),
 * bg {href, attribution} (an image of exactly the frame in the map CRS), title, labelsText {crs}}.
 * Returns {svg, frame, crs, bbox}.
 */
export function buildLocMapSVG(o) {
  const raw = o?.settings && typeof o.settings === 'object' && !Array.isArray(o.settings) ? o.settings : {};
  const st = { ...LOCMAP_DEFAULTS, ...raw, labels: { ...LOCMAP_DEFAULTS.labels, ...(raw.labels && typeof raw.labels === 'object' ? raw.labels : {}) } };
  for (const k of ['margin', 'width', 'baseOpacity', 'gridWidth', 'labelSize', 'northSize', 'pointSize', 'coreLabelSize']) {
    st[k] = finiteStyleNumber(st[k], LOCMAP_DEFAULTS[k]);
  }
  const hexRe = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;
  for (const k of ['land', 'sea', 'gridColor', 'textColor', 'subColor', 'bgColor', 'pointColor', 'pointStroke']) {
    if (typeof st[k] !== 'string' || !hexRe.test(st[k])) st[k] = LOCMAP_DEFAULTS[k];
  }
  const pts = (Array.isArray(o?.points) ? o.points : []).filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon));
  const bbox = st.bbox || lmFitBBox(pts, st.margin), cLon = (bbox[0] + bbox[2]) / 2, cLat = (bbox[1] + bbox[3]) / 2;
  const crs = lmCRS(st.crs, { zone: st.utmZone || lmUtmZone(cLon), south: st.utmSouth ?? cLat < 0 });
  const aspect = { auto: 'auto', '1:1': 1, '4:3': 0.75, '3:2': 2 / 3, '16:9': 0.5625, A4: 210 / 297, A4v: 297 / 210 }[st.aspect] ?? 'auto';
  const fr = lmFrame(crs, bbox, st.width, aspect), { W, H } = fr, fs = st.labelSize, L = st.labels;
  const geoGrid = st.gridType === 'geo' || crs.geographic;   // 'auto' and 'metric': metric grid in projected CRSs
  // margins: room for the labels on each chosen side
  const sideW = st.rotateSide ? fs + 10 : fs * (geoGrid ? 6.2 : 4.8) + 8;
  const m = { t: (L.top ? fs + 12 : 8) + (o.title ? 24 : 0), b: (L.bottom ? fs + 14 : 8) + 12, l: L.left ? sideW : 8, r: L.right ? sideW : 8 };
  const TW = W + m.l + m.r, TH = H + m.t + m.b, ox = m.l, oy = m.t, f1 = (v) => v.toFixed(1);
  const s = [`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${TW}" height="${TH}" viewBox="0 0 ${TW} ${TH}" font-family="IBM Plex Sans, Arial, sans-serif" font-size="${fs}">`,
    `<rect width="${TW}" height="${TH}" fill="${lmEsc(st.bgColor)}"/>`];
  if (o.title) s.push(`<text x="${ox}" y="18" font-size="14" font-weight="600" fill="${lmEsc(st.textColor)}">${lmEsc(o.title)}</text>`);
  s.push(`<defs><clipPath id="lmclip"><rect x="${ox}" y="${oy}" width="${W}" height="${H}"/></clipPath></defs><g clip-path="url(#lmclip)">`);
  const P = (lon, lat) => { const [x, y] = fr.P(lon, lat); return [x + ox, y + oy]; };
  const raster = !!o.bg?.href && st.base !== 'vector' && st.base !== 'blank';
  s.push(`<rect x="${ox}" y="${oy}" width="${W}" height="${H}" fill="${st.base === 'blank' ? '#ffffff' : lmEsc(st.sea)}"/>`);
  if (raster) s.push(`<image x="${ox}" y="${oy}" width="${W}" height="${H}" preserveAspectRatio="none" href="${o.bg.href}" xlink:href="${o.bg.href}" opacity="${st.baseOpacity}"/>`);
  // land (vector base) or coastline over a raster
  if ((st.base === 'vector' || (raster && st.coast)) && o.land?.length) {
    const [w, sb, e, n] = bbox, mx = (e - w) * 0.5 + 1, my = (n - sb) * 0.5 + 1;
    for (const r of o.land) {
      let inBox = false; for (let k = 0; k < r.length; k += 2) if (r[k] >= w - mx && r[k] <= e + mx && r[k + 1] >= sb - my && r[k + 1] <= n + my) { inBox = true; break; }
      if (!inBox) continue;
      let d = ''; for (let k = 0; k < r.length; k += 2) { const [x, y] = P(r[k], r[k + 1]); d += `${k ? 'L' : 'M'}${f1(x)} ${f1(y)}`; }
      s.push(st.base === 'vector' ? `<path d="${d}Z" fill="${lmEsc(st.land)}" stroke="#9a9a8a" stroke-width="0.6"/>` : `<path d="${d}Z" fill="none" stroke="#ffffff" stroke-opacity="0.75" stroke-width="0.7"/>`);
    }
  }
  // grid lines and where they cross each side of the frame
  const ticks = { top: [], bottom: [], left: [], right: [] };
  const gAttr = `fill="none" stroke="${lmEsc(st.gridColor)}" stroke-width="${st.gridWidth}" stroke-opacity="0.85"${st.gridDash ? ' stroke-dasharray="3 3"' : ''}`;
  if (geoGrid) {
    // geographic graticule: meridians and parallels over the whole frame (inverse-projected corners give the range)
    const cs = [[0, 0], [W, 0], [0, H], [W, H], [W / 2, 0], [W / 2, H], [0, H / 2], [W, H / 2]].map(([x, y]) => fr.Pinv(x, y));
    const lo0 = minOf(cs.map((c) => c[0])), lo1 = maxOf(cs.map((c) => c[0])), la0 = Math.max(-89, minOf(cs.map((c) => c[1]))), la1 = Math.min(89, maxOf(cs.map((c) => c[1])));
    const span = Math.min(lo1 - lo0, (la1 - la0) * 1.4), step = st.gridStep > 0 ? st.gridStep : st.coordFmt === 'dms' ? lmDegStep(span, 5) : lmMetricStep(span, 5);   // DD: 1, 2, 5 × 10ᵏ °
    const mer = lmMultiples(lo0, lo1, step), par = lmMultiples(la0, la1, step), N = 60;
    if (st.grid) {
      for (const v of mer) s.push(`<path d="${Array.from({ length: N + 1 }, (_, k) => { const [x, y] = P(v, la0 - 1 + ((la1 - la0 + 2) * k) / N); return `${k ? 'L' : 'M'}${f1(x)} ${f1(y)}`; }).join('')}" ${gAttr}/>`);
      for (const v of par) s.push(`<path d="${Array.from({ length: N + 1 }, (_, k) => { const [x, y] = P(lo0 - 1 + ((lo1 - lo0 + 2) * k) / N, v); return `${k ? 'L' : 'M'}${f1(x)} ${f1(y)}`; }).join('')}" ${gAttr}/>`);
    }
    for (const v of mer) {   // meridians are labelled on the top and bottom sides
      for (const t of lmCross((u) => fr.Pinv(u * W, H)[0], v)) ticks.bottom.push([t * W, lmFormatDeg(v, 'lon', st.coordFmt, step)]);
      for (const t of lmCross((u) => fr.Pinv(u * W, 0)[0], v)) ticks.top.push([t * W, lmFormatDeg(v, 'lon', st.coordFmt, step)]);
    }
    for (const v of par) {   // parallels on the left and right sides
      for (const t of lmCross((u) => fr.Pinv(0, u * H)[1], v)) ticks.left.push([t * H, lmFormatDeg(v, 'lat', st.coordFmt, step)]);
      for (const t of lmCross((u) => fr.Pinv(W, u * H)[1], v)) ticks.right.push([t * H, lmFormatDeg(v, 'lat', st.coordFmt, step)]);
    }
  } else {
    // metric grid of the projected CRS: straight lines X = const and Y = const
    const step = st.gridStep > 0 ? st.gridStep : lmMetricStep(Math.min(fr.X1 - fr.X0, (fr.Y1 - fr.Y0) * 1.4), 5);
    for (const X of lmMultiples(fr.X0, fr.X1, step)) {
      const [x] = fr.toPx(X, fr.Y0); if (st.grid) s.push(`<path d="M${f1(x + ox)} ${oy}V${oy + H}" ${gAttr}/>`);
      const txt = lmFormatMetric(X, st.metricUnit, step); ticks.top.push([x, txt]); ticks.bottom.push([x, txt]);
    }
    for (const Y of lmMultiples(fr.Y0, fr.Y1, step)) {
      const [, y] = fr.toPx(fr.X0, Y); if (st.grid) s.push(`<path d="M${ox} ${f1(y + oy)}H${ox + W}" ${gAttr}/>`);
      const txt = lmFormatMetric(Y, st.metricUnit, step); ticks.left.push([y, txt]); ticks.right.push([y, txt]);
    }
  }
  // cores
  for (const p of pts) {
    const [x, y] = P(p.lon, p.lat); if (x < ox - 20 || x > ox + W + 20 || y < oy - 20 || y > oy + H + 20) continue;
    s.push(lmSymbol(st.symbol, x, y, st.pointSize, `fill="${lmEsc(st.pointColor)}" stroke="${lmEsc(st.pointStroke)}" stroke-width="1"`));
    if (st.coreLabels) s.push(`<text x="${f1(x + st.pointSize + 3)}" y="${f1(y + st.coreLabelSize * 0.36)}" font-size="${st.coreLabelSize}" fill="${raster ? '#ffffff' : '#1c2422'}" stroke="${raster ? '#000000' : '#ffffff'}" stroke-opacity="0.65" stroke-width="3" paint-order="stroke" stroke-linejoin="round">${lmEsc(p.name)}</text>`);
  }
  const ink = raster ? '#ffffff' : '#1c2422', halo = raster ? '#000000' : '#ffffff';
  const corner = (pos, w, h, pad = 12) => [pos[1] === 'l' ? ox + pad : ox + W - w - pad, pos[0] === 't' ? oy + pad : oy + H - h - pad];
  if (st.scaleBar) {
    const sb = lmScaleBar(lmMetresPerPx(fr, W / 2, H / 2), Math.min(220, W * 0.28)), bw = sb.px, [bx, by] = corner(st.scalePos, bw, 22);
    s.push(`<g font-size="9" fill="${ink}"><rect x="${f1(bx - 4)}" y="${f1(by - 2)}" width="${f1(bw + 8)}" height="26" fill="${halo}" fill-opacity="${raster ? 0.35 : 0.7}" rx="2"/>`);
    for (let k = 0; k < 4; k++) s.push(`<rect x="${f1(bx + (k * bw) / 4)}" y="${f1(by + 14)}" width="${f1(bw / 4)}" height="5" fill="${k % 2 ? 'none' : ink}" stroke="${ink}" stroke-width="0.8"/>`);
    s.push(`<text x="${f1(bx)}" y="${f1(by + 10)}">0</text><text x="${f1(bx + bw)}" y="${f1(by + 10)}" text-anchor="end">${sb.label}</text></g>`);
  }
  if (st.north) {
    const z = 22 * st.northSize, [nx0, ny0] = corner(st.northPos, z, z * 1.6), cx = nx0 + z / 2, cy = ny0 + z * 0.9, ang = lmNorthAngle(fr, cx - ox, cy - oy);
    s.push(`<g transform="rotate(${ang.toFixed(2)} ${f1(cx)} ${f1(cy)})"><polygon points="${f1(cx)},${f1(cy - z * 0.9)} ${f1(cx - z * 0.32)},${f1(cy + z * 0.35)} ${f1(cx)},${f1(cy + z * 0.12)}" fill="${ink}"/><polygon points="${f1(cx)},${f1(cy - z * 0.9)} ${f1(cx + z * 0.32)},${f1(cy + z * 0.35)} ${f1(cx)},${f1(cy + z * 0.12)}" fill="${halo}" stroke="${ink}" stroke-width="0.8"/><text x="${f1(cx)}" y="${f1(cy - z * 0.98)}" text-anchor="middle" font-size="${f1(10 * st.northSize)}" font-weight="600" fill="${ink}" stroke="${halo}" stroke-width="2.5" paint-order="stroke">N</text></g>`);
  }
  s.push('</g>');
  // frame, ticks and edge labels
  s.push(`<rect x="${ox}" y="${oy}" width="${W}" height="${H}" fill="none" stroke="#1c2422" stroke-width="1"/>`);
  const tl = st.ticks ? 5 : 0;
  for (const side of ['top', 'bottom', 'left', 'right']) {
    const show = L[side];
    for (const [p, txt] of ticks[side]) {
      if (p < 0.5 || (side === 'top' || side === 'bottom' ? p > W - 0.5 : p > H - 0.5)) continue;
      if (side === 'top' || side === 'bottom') {
        const x = ox + p, y = side === 'top' ? oy : oy + H, d = side === 'top' ? -1 : 1;
        if (st.ticks && show) s.push(`<line x1="${f1(x)}" y1="${y}" x2="${f1(x)}" y2="${y + d * tl}" stroke="#1c2422" stroke-width="0.8"/>`);
        if (show) s.push(`<text x="${f1(x)}" y="${f1(side === 'top' ? y - tl - 3 : y + tl + fs + 1)}" text-anchor="middle" fill="${lmEsc(st.textColor)}">${lmEsc(txt)}</text>`);
      } else {
        const y = oy + p, x = side === 'left' ? ox : ox + W, d = side === 'left' ? -1 : 1;
        if (st.ticks && show) s.push(`<line x1="${x}" y1="${f1(y)}" x2="${x + d * tl}" y2="${f1(y)}" stroke="#1c2422" stroke-width="0.8"/>`);
        if (!show) continue;
        const tx = x + d * (tl + 3);
        s.push(st.rotateSide
          ? `<text transform="translate(${f1(tx + (side === 'left' ? -2 : fs - 1))} ${f1(y)}) rotate(-90)" text-anchor="middle" fill="${lmEsc(st.textColor)}">${lmEsc(txt)}</text>`
          : `<text x="${f1(tx)}" y="${f1(y + fs * 0.35)}" text-anchor="${side === 'left' ? 'end' : 'start'}" fill="${lmEsc(st.textColor)}">${lmEsc(txt)}</text>`);
      }
    }
  }
  const foot = [o.labelsText?.crs ? `${o.labelsText.crs}: ${crs.name} (EPSG:${crs.epsg})` : `${crs.name} (EPSG:${crs.epsg})`, raster ? o.bg.attribution : ''].filter(Boolean).join(' · ');
  s.push(`<text x="${ox + W}" y="${TH - 2}" text-anchor="end" font-size="8" fill="${lmEsc(st.subColor)}">${lmEsc(foot)}</text>`);
  s.push('</svg>');
  return { svg: s.join(''), frame: fr, crs, bbox, margins: m };
}
