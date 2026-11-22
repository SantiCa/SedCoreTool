// SedCoreTool web — gridding of scattered core values for maps (V20), in the spirit of Surfer.
// No DOM. Distances are in km on a Lambert azimuthal equal-area projection centred on the map (V22; before: degrees).
// Methods: inverse distance, nearest neighbour, triangulation with linear interpolation (Delaunay),
// radial basis functions (thin-plate spline = minimum curvature, multiquadric, gaussian), ordinary kriging
// (spherical / exponential / gaussian / linear variogram, fitted automatically or by hand) and moving average.
// Contours by marching squares; colour ramps for the grid and the colour bar.

import { makeProjection, validMapCoords } from './geo.js';
import { minOf, maxOf } from './core.js';

export const INTERP_METHODS = ['idw', 'nearest', 'tin', 'mincurv', 'rbf', 'kriging', 'movavg'];
export const INTERP_DEFAULT = {
  method: 'idw', power: 2, radius: 0, neighbours: 0, rbf: 'multiquadric', shape: 200, smooth: 0,
  variogram: 'spherical', autoVario: true, nugget: 0, sill: 1, range: 500, res: 90, hull: true, mask: 'sea',
  contours: false, levels: 8, labels: true, ramp: 'div', reverse: false, scale: 'sym2', vmin: -2, vmax: 2, steps: 0, opacity: 0.75, on: true,
};

/** Explicit preset: estimate over the visible sea using IDW without a distance or hull cut-off. */
export function visibleSeaOptions(options = {}) {
  return { ...options, on: true, method: 'idw', radius: 0, hull: false, mask: 'sea' };
}

/** Linear system A x = b (Gaussian elimination with partial pivoting); returns null if singular. */
export function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]), tol = 1e-12 * Math.max(1, maxOf(A.map((r) => maxOf(r.map(Math.abs)))));
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < tol) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r]; }
  return x;
}

/** Delaunay triangulation (Bowyer–Watson). pts = [[x, y]]; returns triangles as index triples. */
export function delaunay(pts) {
  const n = pts.length; if (n < 3) return [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const d = Math.max(x1 - x0, y1 - y0) * 20 || 1, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const P = [...pts, [mx - d, my - d], [mx + d, my - d], [mx, my + d]];
  const circ = (a, b, c) => {
    const [ax, ay] = P[a], [bx, by] = P[b], [cx, cy] = P[c], D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(D) < 1e-14) return { x: 0, y: 0, r: Infinity };
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / D;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / D;
    return { x: ux, y: uy, r: (ax - ux) ** 2 + (ay - uy) ** 2 };
  };
  let tris = [{ v: [n, n + 1, n + 2], c: circ(n, n + 1, n + 2) }];
  for (let i = 0; i < n; i++) {
    const [px, py] = P[i], bad = [], keep = [];
    for (const t of tris) ((px - t.c.x) ** 2 + (py - t.c.y) ** 2 < t.c.r ? bad : keep).push(t);
    const edges = new Map();
    for (const t of bad) for (const [a, b] of [[t.v[0], t.v[1]], [t.v[1], t.v[2]], [t.v[2], t.v[0]]]) { const k = a < b ? `${a},${b}` : `${b},${a}`; edges.set(k, edges.has(k) ? null : [a, b]); }
    for (const e of edges.values()) if (e) keep.push({ v: [e[0], e[1], i], c: circ(e[0], e[1], i) });
    tris = keep;
  }
  return tris.filter((t) => t.v.every((k) => k < n)).map((t) => t.v);
}

const phi = (kind, r, c) => (kind === 'tps' ? (r > 0 ? r * r * Math.log(r) : 0) : kind === 'gaussian' ? Math.exp(-((r / c) ** 2)) : Math.sqrt(r * r + c * c));

/** Semivariogram model γ(h). */
export function variogram(model, h, nugget, sill, range) {
  if (h <= 0) return 0;
  const ps = Math.max(sill - nugget, 0), a = Math.max(range, 1e-9);
  if (model === 'linear') return nugget + ps * Math.min(h / a, 1);
  if (model === 'exponential') return nugget + ps * (1 - Math.exp((-3 * h) / a));
  if (model === 'gaussian') return nugget + ps * (1 - Math.exp(-3 * (h / a) ** 2));
  return h >= a ? sill : nugget + ps * (1.5 * (h / a) - 0.5 * (h / a) ** 3); // spherical
}

/** Empirical semivariogram (8 distance classes up to half the largest distance) and least-squares fit of range and nugget. */
export function fitVariogram(xy, v, model = 'spherical') {
  const n = v.length, pairs = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push([Math.hypot(xy[i][0] - xy[j][0], xy[i][1] - xy[j][1]), 0.5 * (v[i] - v[j]) ** 2]);
  const mean = v.reduce((a, b) => a + b, 0) / (n || 1), sill = v.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(n - 1, 1) || 1;
  if (pairs.length < 3) return { nugget: 0, sill, range: 1, bins: [] };
  const hmax = maxOf(pairs.map((p) => p[0])) / 2 || 1, nb = 8, bins = [];
  for (let k = 0; k < nb; k++) {
    const a = (k * hmax) / nb, b = ((k + 1) * hmax) / nb, sel = pairs.filter((p) => p[0] > a && p[0] <= b);
    if (sel.length) bins.push({ h: sel.reduce((s, p) => s + p[0], 0) / sel.length, g: sel.reduce((s, p) => s + p[1], 0) / sel.length, n: sel.length });
  }
  let best = { err: Infinity, nugget: 0, range: hmax };
  for (let r = 1; r <= 30; r++) for (let q = 0; q <= 5; q++) {
    const range = (hmax * 2 * r) / 30, nugget = (sill * q) / 10;
    const err = bins.reduce((s, b) => s + (b.n / (b.h * b.h)) * (variogram(model, b.h, nugget, sill, range) - b.g) ** 2, 0); // weights n_h/h² (gstat fit.method 7, Pebesma 2004; Cressie 1985 uses n_h/γ(h)²)
    if (err < best.err) best = { err, nugget, range };
  }
  return { nugget: best.nugget, sill, range: best.range, bins };
}

/**
 * Grid of interpolated values. points = [{lat, lon, value}]; bbox = [x0, y0, x1, y1]; o = INTERP_DEFAULT-like options.
 * Returns {grid (row-major from the north, null = empty), nx, ny, info} with info.variogram for kriging.
 */
export function interpolate(points, bbox, nx, ny, opt = {}) {
  const o = { ...INTERP_DEFAULT, ...opt }, raw = points.filter((p) => Number.isFinite(p.value) && validMapCoords(p));
  const pr = makeProjection('laea', bbox), X = (lon, lat) => pr.fwd(lon, lat).map((q) => q * 6371); // km
  // co-located cores (< 10 m apart) are averaged: duplicates would make the kriging and RBF systems singular
  const merged = [];
  for (const p of raw) { const q = X(p.lon, p.lat), m = merged.find((r) => Math.hypot(r.xy[0] - q[0], r.xy[1] - q[1]) < 0.01); if (m) { m.s += p.value; m.k++; } else merged.push({ xy: q, s: p.value, k: 1 }); }
  const xy = merged.map((m) => m.xy), v = merged.map((m) => m.s / m.k), n = merged.length, grid = new Array(nx * ny).fill(null), info = { merged: raw.length - n };
  if (!n) return { grid, nx, ny, info };
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let at; // function of a cell centre [x, y] → value
  if (o.method === 'nearest') at = (c) => { let b = 0, d = Infinity; xy.forEach((q, i) => { const e = dist(q, c); if (e < d) { d = e; b = i; } }); return o.radius > 0 && d > o.radius ? null : v[b]; };
  else if (o.method === 'movavg') at = (c) => { let s = 0, k = 0; const r = o.radius > 0 ? o.radius : 500; xy.forEach((q, i) => { if (dist(q, c) <= r) { s += v[i]; k++; } }); return k ? s / k : null; };
  else if (o.method === 'tin') {
    const T = delaunay(xy);
    at = (c) => {
      for (const [a, b, d] of T) {
        const [x1, y1] = xy[a], [x2, y2] = xy[b], [x3, y3] = xy[d], D = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
        if (!D) continue;
        const l1 = ((y2 - y3) * (c[0] - x3) + (x3 - x2) * (c[1] - y3)) / D, l2 = ((y3 - y1) * (c[0] - x3) + (x1 - x3) * (c[1] - y3)) / D, l3 = 1 - l1 - l2;
        if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) return l1 * v[a] + l2 * v[b] + l3 * v[d];
      }
      return null;
    };
  } else if (o.method === 'rbf' || o.method === 'mincurv') {
    const kind = o.method === 'mincurv' ? 'tps' : o.rbf, c0 = o.shape || 1;
    const A = [], b = [];
    for (let i = 0; i < n; i++) { A.push([...xy.map((q, j) => phi(kind, dist(xy[i], q), c0) + (i === j ? o.smooth : 0)), 1, xy[i][0], xy[i][1]]); b.push(v[i]); }
    for (let k = 0; k < 3; k++) { A.push([...xy.map((q) => (k === 0 ? 1 : q[k - 1])), 0, 0, 0]); b.push(0); }
    const w = n >= 3 ? solve(A, b) : null;
    at = w ? (c) => { let s = w[n] + w[n + 1] * c[0] + w[n + 2] * c[1]; for (let i = 0; i < n; i++) s += w[i] * phi(kind, dist(xy[i], c), c0); return s; } : null;
  } else if (o.method === 'kriging') {
    const vg = o.autoVario ? fitVariogram(xy, v, o.variogram) : { nugget: o.nugget, sill: o.sill, range: o.range, bins: fitVariogram(xy, v, o.variogram).bins };
    info.variogram = { model: o.variogram, ...vg }; info.few = n < 15;
    const g = (h) => variogram(o.variogram, h, vg.nugget, vg.sill, vg.range);
    const A = xy.map((p) => [...xy.map((q) => g(dist(p, q))), 1]).concat([[...xy.map(() => 1), 0]]);
    // V0.41: estimate = λᵀv with λ = A⁻¹b; A is symmetric, so λᵀv = bᵀ(A⁻¹[v; 0]) = bᵀu: one solve, then O(n) per cell
    // (before: n + 1 solves and O(n²) per cell; same values up to rounding)
    const u = solve(A, [...v, 0]);
    if (u) at = (c) => { let s = u[n]; for (let i = 0; i < n; i++) s += u[i] * g(dist(xy[i], c)); return s; };
  }
  if (!at) { // inverse distance (also the fallback when a system cannot be solved)
    at = (c) => {
      let ds = xy.map((q, i) => [dist(q, c), i]);
      if (o.radius > 0) ds = ds.filter((q) => q[0] <= o.radius);
      if (o.neighbours > 0) ds = ds.sort((a, b) => a[0] - b[0]).slice(0, o.neighbours);
      let sw = 0, sv = 0;
      for (const [d, i] of ds) { if (d < 1e-9) return v[i]; const w = 1 / d ** o.power; sw += w; sv += w * v[i]; }
      return sw ? sv / sw : null;
    };
    if (o.method !== 'idw') info.fallback = 'idw';
  }
  const hull = o.hull && n >= 3 ? convexHull(xy) : null;
  for (let iy = 0; iy < ny; iy++) {
    const lat = bbox[3] - ((iy + 0.5) / ny) * (bbox[3] - bbox[1]);
    for (let ix = 0; ix < nx; ix++) {
      const lon = bbox[0] + ((ix + 0.5) / nx) * (bbox[2] - bbox[0]), c = X(lon, lat);
      if (hull && !inPoly(c, hull)) continue;
      const val = at(c);
      grid[iy * nx + ix] = val != null && Number.isFinite(val) ? val : null;
    }
  }
  return { grid, nx, ny, info };
}

/** Convex hull (monotone chain) of [[x, y]]. */
export function convexHull(p) {
  const s = [...p].sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of s) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of s.reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
export function inPoly([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** keep = 'sea': cells whose centre is on land (Natural Earth rings, flat [lon, lat, …]) become null; 'land': cells at sea become null; 'both': unchanged. */
export function maskLand(grid, nx, ny, bbox, rings, keep = 'sea') {
  if (keep === 'both') return grid;
  const near = rings.filter((r) => { let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity; for (let k = 0; k < r.length; k += 2) { a = Math.min(a, r[k]); b = Math.max(b, r[k]); c = Math.min(c, r[k + 1]); d = Math.max(d, r[k + 1]); } return b >= bbox[0] && a <= bbox[2] && d >= bbox[1] && c <= bbox[3]; })
    .map((r) => { const p = []; for (let k = 0; k < r.length; k += 2) p.push([r[k], r[k + 1]]); return p; });
  return grid.map((v, i) => {
    if (v == null) return v;
    const ix = i % nx, iy = Math.floor(i / nx), lon = bbox[0] + ((ix + 0.5) / nx) * (bbox[2] - bbox[0]), lat = bbox[3] - ((iy + 0.5) / ny) * (bbox[3] - bbox[1]);
    const onLand = near.some((p) => inPoly([lon, lat], p));
    return (keep === 'sea' && onLand) || (keep === 'land' && !onLand) ? null : v;
  });
}

/* ───────── colour ramps ───────── */
export const RAMPS = {
  div: [[38, 110, 150], [242, 236, 219], [196, 80, 46]],
  bluered: [[49, 54, 149], [116, 173, 209], [255, 255, 191], [244, 109, 67], [165, 0, 38]],
  viridis: [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]],
  magma: [[0, 0, 4], [81, 18, 124], [183, 55, 121], [252, 137, 97], [252, 253, 191]],
  terrain: [[0, 104, 55], [102, 189, 99], [217, 239, 139], [254, 224, 139], [166, 97, 26], [255, 255, 255]],
  ocean: [[8, 29, 88], [37, 52, 148], [34, 94, 168], [65, 182, 196], [199, 233, 180]],
  grey: [[30, 30, 30], [235, 235, 235]],
  rainbow: [[110, 64, 170], [38, 150, 230], [40, 200, 120], [230, 220, 50], [235, 120, 40], [200, 30, 30]],
};
/** Colour of value v on a ramp between vmin and vmax (steps > 0: discrete classes). */
export function rampColor(ramp, v, vmin, vmax, steps = 0, reverse = false) {
  const R = RAMPS[ramp] || RAMPS.div;
  let t = vmax > vmin ? (v - vmin) / (vmax - vmin) : 0.5;
  t = Math.max(0, Math.min(1, t)); if (steps > 1) t = Math.min(steps - 1, Math.floor(t * steps)) / (steps - 1); if (reverse) t = 1 - t;
  const f = t * (R.length - 1), k = Math.min(R.length - 2, Math.floor(f)), u = f - k;
  return `rgb(${R[k].map((a, j) => Math.round(a + (R[k + 1][j] - a) * u)).join(',')})`;
}
/** Colour range of a grid: 'sym2' = −2…2 (z-scores), 'auto' = min…max, 'symauto' = ±max|v|, 'manual' = vmin…vmax. */
export function colorRange(values, o) {
  const v = values.filter((x) => x != null && Number.isFinite(x));
  if (o.scale === 'manual') return [o.vmin, o.vmax];
  if (o.scale === 'sym2' || !v.length) return [-2, 2];
  const lo = minOf(v), hi = maxOf(v);
  if (o.scale === 'symauto') { const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1; return [-m, m]; }
  return lo === hi ? [lo - 1, hi + 1] : [lo, hi];
}

/* ───────── contours (marching squares on cell centres) ───────── */
/** Levels evenly spaced inside [vmin, vmax] (n levels, round numbers when possible). */
export function contourLevels(vmin, vmax, n) {
  const raw = (vmax - vmin) / (n + 1), p = 10 ** Math.floor(Math.log10(raw || 1)), st = [1, 2, 2.5, 5, 10].map((k) => k * p).find((k) => k >= raw) || raw;
  const out = []; for (let x = Math.ceil(vmin / st) * st; x < vmax - 1e-12; x += st) if (x > vmin + 1e-12) out.push(+x.toFixed(10));
  return out;
}
/** Segments [[x1, y1, x2, y2]] in grid-cell units (x = column centre index, y = row) for one level. */
export function contourSegments(grid, nx, ny, level) {
  const seg = [], g = (x, y) => grid[y * nx + x];
  for (let y = 0; y < ny - 1; y++) for (let x = 0; x < nx - 1; x++) {
    const a = g(x, y), b = g(x + 1, y), c = g(x + 1, y + 1), d = g(x, y + 1);
    if (a == null || b == null || c == null || d == null) continue;
    const k = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
    if (k === 0 || k === 15) continue;
    const L = (p, q) => (level - p) / (q - p || 1e-12);
    const T = [x + L(a, b), y], R = [x + 1, y + L(b, c)], B = [x + L(d, c), y + 1], Lf = [x, y + L(a, d)];
    const cases = { 1: [[Lf, B]], 2: [[B, R]], 3: [[Lf, R]], 4: [[T, R]], 5: [[Lf, T], [B, R]], 6: [[T, B]], 7: [[Lf, T]], 8: [[Lf, T]], 9: [[T, B]], 10: [[T, R], [Lf, B]], 11: [[T, R]], 12: [[Lf, R]], 13: [[B, R]], 14: [[Lf, B]] };
    for (const [p, q] of cases[k]) seg.push([p[0], p[1], q[0], q[1]]);
  }
  return seg;
}
