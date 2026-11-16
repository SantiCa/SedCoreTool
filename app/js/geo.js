// SedCoreTool web — multi-proxy geochemical interpretation (no DOM).
// Cores → resampled samples → labels (intervals + rules) → machine learning → classes per sample → maps.
import { parseAgeModel, interpAge } from './core.js';
import { finiteStyleNumber, niceTicks } from './log.js';

/* ───────── utilities ───────── */

/** Geographic coordinates accepted for multiproxy maps (decimal degrees). */
export const validMapCoords = (p) => Number.isFinite(p.lat) && p.lat >= -90 && p.lat <= 90 && Number.isFinite(p.lon) && p.lon >= -180 && p.lon <= 180;

/** Seeded pseudo-random generator (mulberry32): every training run is reproducible from its seed. */
export function seededRandom(seed = 42) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const std = (a, m = mean(a)) => Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length) || 1;

/* ───────── import ───────── */

/** Merge two age-only imports without losing either series. */
export function mergeAgeImports(a, b) {
  if (a.age.length === b.age.length && a.age.every((v, i) => v === b.age[i]))
    return { depth: null, age: a.age.slice(), proxies: { ...a.proxies, ...b.proxies } };
  const rows = [a, b].flatMap((source) => source.age.map((age, i) => ({ age, source, i }))).sort((x, y) => x.age - y.age);
  const names = [...new Set([...Object.keys(a.proxies), ...Object.keys(b.proxies)])];
  return { depth: null, age: rows.map((r) => r.age), proxies: Object.fromEntries(names.map((name) => [name, rows.map((r) => r.source.proxies[name]?.[r.i] ?? null)])) };
}

/** Combine age-only and depth-based imports using an invertible depth–age relation, without extrapolation. */
export function mergeMixedImports(a, b, model) {
  const pairs = model?.depth?.map((d, i) => [d, model.age[i]]) ?? [a, b].flatMap((s) => (s.depth && s.age ? s.depth.map((d, i) => [d, s.age[i]]) : []));
  const valid = pairs.filter(([d, age]) => Number.isFinite(d) && Number.isFinite(age)).sort((x, y) => x[0] - y[0]);
  if (valid.length < 2 || valid.some((p, i) => i && (p[0] <= valid[i - 1][0] || p[1] <= valid[i - 1][1]))) return null;
  const inverse = { depth: valid.map((p) => p[1]), age: valid.map((p) => p[0]) };
  const rows = [a, b].flatMap((s) => (s.depth || s.age).map((v, i) => ({ d: s.depth ? v : interpAge(inverse, v), age: s.age?.[i] ?? null, s, i })));
  if (rows.some((r) => !Number.isFinite(r.d))) return null;
  rows.sort((x, y) => x.d - y.d);
  const names = [...new Set([...Object.keys(a.proxies), ...Object.keys(b.proxies)])];
  return { depth: rows.map((r) => r.d), age: rows.map((r) => r.age), proxies: Object.fromEntries(names.map((n) => [n, rows.map((r) => r.s.proxies[n]?.[r.i] ?? null)])) };
}

/**
 * Cores from a long table. roles = {core, lat, lon, depth, age, proxies:[col]} (column indices; -1 = none).
 * tab = parseTable output, but with the core column kept as text (rowsText).
 */
export function coresFromLongTable(tab, roles) {
  const by = new Map();
  tab.rows.forEach((r, i) => {
    const name = String(tab.text[i][roles.core] ?? '').trim(); if (!name) return;
    if (!by.has(name)) by.set(name, { name, lat: null, lon: null, rows: [] });
    const c = by.get(name);
    if (roles.lat >= 0 && c.lat == null && r[roles.lat] != null) c.lat = r[roles.lat];
    if (roles.lon >= 0 && c.lon == null && r[roles.lon] != null) c.lon = r[roles.lon];
    c.rows.push(r);
  });
  return [...by.values()].map((c) => coreFromRows(c.name, c.rows, tab.headers, roles, c.lat, c.lon));
}

/** One core from a table (rows of numbers). */
export function coreFromRows(name, rows, headers, roles, lat = null, lon = null) {
  const key = roles.depth >= 0 ? roles.depth : roles.age;
  const sorted = rows.filter((r) => r[key] != null).sort((a, b) => a[key] - b[key]);
  const proxies = {};
  for (const c of roles.proxies) proxies[headers[c]] = sorted.map((r) => r[c]);
  return {
    name, lat, lon,
    depth: roles.depth >= 0 ? sorted.map((r) => r[roles.depth]) : null,
    age: roles.age >= 0 ? sorted.map((r) => r[roles.age]) : null,
    proxies,
  };
}

/** Assign coordinates (and water depth) from a catalogue table, matching core names case-insensitively. */
export function applyCatalogue(cores, tab, roles) {
  const norm = (s) => String(s ?? '').trim().toLowerCase();
  let n = 0;
  tab.text.forEach((row, i) => {
    const c = cores.find((k) => norm(k.name) === norm(row[roles.core])); if (!c) return;
    const r = tab.rows[i];
    if (roles.lat >= 0 && r[roles.lat] != null) c.lat = r[roles.lat];
    if (roles.lon >= 0 && r[roles.lon] != null) c.lon = r[roles.lon];
    if (roles.wd >= 0 && r[roles.wd] != null) c.waterDepth = r[roles.wd];
    n++;
  });
  return n;
}

/** Age of each row: the age column if present, else the core's age model applied to depth. */
export function coreAges(core) {
  if (core.age) return core.age;
  const m = parseAgeModel(core.ageText || '');
  return core.depth && m ? core.depth.map((d) => interpAge(m, d)) : null;
}

/**
 * Prepare the conversion of one core in one direction: the ages, the pairs and their order are built once, so converting many values (every sample of a
 * grid) costs one interpolation each. Returns `(v, clamp = false) => number | null`; the result equals `coreConvert(core, v, from, to, clamp)`.
 * Nothing is kept after the returned function is dropped, so edits to the core's arrays are seen by the next call to this function.
 */
export function coreConverter(core, from, to) {
  if (from === to) return (v) => v;
  const ages = coreAges(core);
  const pairs = ages && core.depth ? core.depth.map((d, i) => [d, ages[i]]).filter((p) => p[0] != null && p[1] != null) : [];
  if (!pairs.length) return (v) => (v == null ? v : null);
  const src = from === 'depth' ? 0 : 1, dst = 1 - src;
  pairs.sort((a, b) => a[src] - b[src]);
  const relation = { depth: pairs.map((p) => p[src]), age: pairs.map((p) => p[dst]) }, first = relation.depth[0], last = relation.depth[relation.depth.length - 1];
  return (v, clamp = false) => (v == null ? v : interpAge(relation, clamp ? Math.min(last, Math.max(first, v)) : v));
}

/** Convert a value between depth and age within one core (linear interpolation between its rows). For many values use `coreConverter`. */
export function coreConvert(core, v, from, to, clamp = false) {
  return coreConverter(core, from, to)(v, clamp);
}

/* ───────── samples ───────── */

/** Raw (untransformed) value series of one feature in a core; ratios "A/B" are computed row by row. */
export function featureSeries(core, name, ratios = []) {
  if (core.proxies[name]) return core.proxies[name];
  const r = ratios.find((q) => `${q.a}/${q.b}` === name);
  if (r && core.proxies[r.a] && core.proxies[r.b]) return core.proxies[r.a].map((v, i) => { const d = core.proxies[r.b][i]; return v != null && d ? v / d : null; });
  return null;
}

/** Default largest gap bridged by resampling: 3 × the median spacing of the real (non-missing) samples of that series. */
export function autoGap(xs, ys) {
  const x = xs.filter((v, i) => v != null && ys[i] != null).sort((a, b) => a - b), d = x.slice(1).map((v, i) => v - x[i]).filter((v) => v > 0).sort((a, b) => a - b);
  return d.length ? 3 * d[d.length >> 1] : Infinity;
}

/** Linear resampling onto a grid; null outside the data range or across gaps wider than maxGap. */
export function resample(xs, ys, grid, maxGap = Infinity) {
  const p = xs.map((x, i) => [x, ys[i]]).filter((q) => q[0] != null && q[1] != null).sort((a, b) => a[0] - b[0]);
  const X = p.map((q) => q[0]), Y = p.map((q) => q[1]);
  return grid.map((g) => {
    if (!X.length || g < X[0] || g > X[X.length - 1]) return null;
    let lo = 0, hi = X.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (X[m] <= g) lo = m; else hi = m; }
    if (X[lo] === g) return Y[lo];
    if (X[hi] === g) return Y[hi];
    if (X[hi] - X[lo] > maxGap) return null;
    return X[hi] === X[lo] ? Y[lo] : Y[lo] + ((g - X[lo]) / (X[hi] - X[lo])) * (Y[hi] - Y[lo]);
  });
}

/**
 * Build samples on a regular grid of the chosen axis.
 * cfg = {axis, step, features, ratios, logs (array of names), scaling: 'global'|'core'|'none', maxGap}
 * Each sample: {core, x, depth, age, raw[], zc[] (per-core z), f[] (model features)}.
 */
export function buildSamples(cores, cfg) {
  const F = cfg.features, LF = cfg.layers || [], out = [];
  for (const core of cores) {
    const ages = coreAges(core);
    const xs = cfg.axis === 'age' ? ages : core.depth;
    if (!xs) continue;
    const valid = xs.filter((v) => v != null); if (valid.length < 2) continue;
    const lo = Math.ceil(Math.min(...valid) / cfg.step) * cfg.step, hi = Math.max(...valid);
    const grid = []; for (let g = lo; g <= hi + 1e-9; g += cfg.step) grid.push(+g.toFixed(10));
    const toDepth = coreConverter(core, 'age', 'depth'), toAge = coreConverter(core, 'depth', 'age');   // once per core, not once per sample
    const cols = F.map((name) => {
      const s = featureSeries(core, name, cfg.ratios); if (!s) return grid.map(() => null);
      return resample(xs, s, grid, cfg.maxGap ?? autoGap(xs, s));
    });
    const tr = cols.map((col, j) => (cfg.logs?.includes(F[j]) ? col.map((v) => (v != null && v > 0 ? Math.log10(v) : null)) : col));
    const rows = [];
    grid.forEach((g, i) => {
      const raw = cols.map((c) => c[i]), tv = tr.map((c) => c[i]);
      // 'drop' (default): every variable must have a value. 'mean': at least one; the missing ones take the mean (0 after z-scoring).
      if (cfg.missing === 'mean' ? F.length && tv.every((v) => v == null) : tv.some((v) => v == null)) return;
      rows.push({ core: core.id ?? core.name, x: g, raw, t: tv,
        depth: cfg.axis === 'depth' ? g : toDepth(g),
        age: cfg.axis === 'age' ? g : toAge(g) });
    });
    if (rows.length) {
      const { mu, sd } = colStats(rows, F.length);
      for (const r of rows) r.zc = r.t.map((v, j) => (v == null ? 0 : (v - mu[j]) / sd[j]));
    }
    if (LF.length) {
      const ivs = intervalsOnAxis((cfg.intervals || []).filter((q) => q.core === (core.id ?? core.name) && !q.auto), cfg.axis, core);
      for (const r of rows) r.cat = LF.flatMap((l) => l.cats.map((c) => (ivs.some((q) => q.layer === l.id && (q.cat ?? q.label) === c.id && r.x >= q.from && r.x < q.to) ? 1 : 0)));
    }
    out.push(...rows);
  }
  if (cfg.scaling === 'core') for (const r of out) r.f = r.zc.slice();
  else if (out.length) {
    const { mu, sd } = colStats(out, F.length);
    for (const r of out) r.f = r.t.map((v, j) => (cfg.scaling === 'none' ? (v == null ? mu[j] : v) : v == null ? 0 : (v - mu[j]) / sd[j]));
  }
  // Interval layers: one 0/1 column per category, appended unscaled after the numeric variables.
  for (const r of out) if (r.cat) { r.raw.push(...r.cat); r.t.push(...r.cat); r.zc.push(...r.cat); r.f.push(...r.cat); delete r.cat; }
  return out;
}

/** Names of the 0/1 columns created from interval layers ("Layer: category"). */
export function layerFeatureNames(layers) { return layers.flatMap((l) => l.cats.map((c) => `${l.name}: ${c.name}`)); }

/** Intervals expressed on one axis of one core (converted with the core's depth–age relation when needed). */
export function intervalsOnAxis(list, axis, core) {
  const converters = new Map();                                    // one prepared conversion per source axis, not one per interval end
  const convert = (from) => { if (!converters.has(from)) converters.set(from, coreConverter(core, from, axis)); return converters.get(from); };
  return list.map((q) => {
    if (q.axis === axis) return q;
    if (!core) return null;
    // Ends beyond the core's depth–age data are clamped to the first/last value (no extrapolation).
    const a = convert(q.axis)(q.from, true), b = convert(q.axis)(q.to, true);
    return a == null || b == null || a === b ? null : { ...q, from: Math.min(a, b), to: Math.max(a, b) };
  }).filter(Boolean);
}

/** Convert complete classification bands, preserving their labels and source-axis interval thickness. */
export function segmentsOnAxis(segments, sourceAxis, targetAxis, core) {
  if (sourceAxis === targetAxis) return segments;
  return intervalsOnAxis(segments.map((segment) => ({ ...segment, axis: sourceAxis, from: segment.a0, to: segment.a1 })), targetAxis, core)
    .map(({ axis, from, to, ...segment }) => ({ ...segment, a0: from, a1: to }));
}

/** First half-open match for a fixed interval set; rebuild after changing interval bounds. */
export function createIntervalLookup(intervals) {
  const linear = (x) => intervals.find((q) => x >= q.from && x < q.to);
  if (intervals.some((q) => !Number.isFinite(q.from) || !Number.isFinite(q.to) || q.from >= q.to)) return linear;
  const sorted = intervals.slice().sort((a, b) => a.from - b.from);
  // Overlaps must retain source-order priority; irregular inputs retain the predicate's coercion.
  if (sorted.some((q, i) => i > 0 && sorted[i - 1].to > q.from)) return linear;
  return (x) => {
    if (!Number.isFinite(x)) return linear(x);
    let lo = 0, hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sorted[mid].from <= x) lo = mid + 1; else hi = mid;
    }
    const match = sorted[lo - 1];
    return match && x < match.to ? match : undefined;
  };
}

/** Ids of intervals of a child layer that are not inside any interval of its parent layer (same core). */
export function orphanIntervals(intervals, layers, cores) {
  const parent = new Map(layers.map((l) => [l.id, l.parent])), byCore = new Map(cores.map((c) => [c.id ?? c.name, c]));
  return intervals.filter((q) => {
    const p = parent.get(q.layer); if (!p) return false;
    const ps = intervalsOnAxis(intervals.filter((x) => x.layer === p && x.core === q.core), q.axis, byCore.get(q.core));
    return !ps.some((x) => x.from <= q.from + 1e-9 && x.to >= q.to - 1e-9);
  }).map((q) => q.id);
}

/**
 * Intervals from a table. roles = {core (-1 = use defaultCore), from, to, layer (-1 = each value column is a layer), values:[col]}.
 * Returns [{core, layer, value, from, to}] with names (text), skipping empty values.
 */
export function intervalsFromTable(tab, roles, defaultCore = '') {
  const out = [];
  tab.rows.forEach((r, i) => {
    const a = r[roles.from], b = r[roles.to]; if (a == null || b == null || a === b) return;
    const txt = tab.text[i], core = roles.core >= 0 ? String(txt[roles.core] ?? '').trim() : defaultCore; if (!core) return;
    const from = Math.min(a, b), to = Math.max(a, b);
    if (roles.layer >= 0) {
      const layer = String(txt[roles.layer] ?? '').trim(), value = String(txt[roles.values[0]] ?? '').trim();
      if (layer && value) out.push({ core, layer, value, from, to });
    } else for (const c of roles.values) { const value = String(txt[c] ?? '').trim(); if (value) out.push({ core, layer: tab.headers[c], value, from, to }); }
  });
  return out;
}

/** Mean and population SD of the first n columns of r.t, ignoring missing values (SD 0 or no data → 1). */
export function colStats(rows, n) {
  const mu = [], sd = [];
  for (let j = 0; j < n; j++) {
    const v = rows.map((r) => r.t[j]).filter((x) => x != null);
    const m = v.length ? mean(v) : 0; mu.push(m); sd.push(v.length ? std(v, m) : 1);
  }
  return { mu, sd };
}

/** Fit numeric transforms using training rows only; core scaling is already computed per core. */
export function fitSampleTransform(rows, n, scaling) {
  const stats = colStats(rows, n);
  return { scaling, ...stats };
}
export function transformSample(row, columns, n, transform) {
  return columns.map((j) => {
    if (j >= n || transform.scaling === 'core') return row.f[j];
    const value = row.t[j] == null ? transform.mu[j] : row.t[j];
    return transform.scaling === 'global' ? (value - transform.mu[j]) / transform.sd[j] : value;
  });
}

/* ───────── labels ───────── */

/** Rule condition: {feature, op: 'z>'|'z<'|'>'|'<', value}. 'z' uses the per-core z-score. */
export function ruleMatches(rule, sample, features) {
  return rule.conds.length > 0 && rule.conds.every((c) => {
    const j = features.indexOf(c.feature); if (j < 0) return false;
    const v = c.op.startsWith('z') ? (sample.raw[j] == null ? null : sample.zc[j]) : sample.raw[j];
    if (v == null) return false;
    return c.op.endsWith('>') ? v > c.value : v < c.value;
  });
}

/**
 * Label of every sample: manual intervals first; then the first enabled rule that matches (if useRules).
 * intervals: [{core, layer, axis, from, to, cat}] (axis in which they were drawn; converted when needed).
 * With `layer`, only intervals and rules of that layer (the classification target) are used.
 * Intervals with `auto` (accepted predictions) never become training labels.
 */
export function labelSamples(samples, { intervals = [], rules = [], useRules = true, features, axis, cores, layer = null }) {
  const byCore = new Map(cores.map((c) => [c.id ?? c.name, c]));
  const mine = intervals.filter((q) => !q.auto && (layer == null || q.layer === layer));
  const iv = mine.flatMap((q) => intervalsOnAxis([q], axis, byCore.get(q.core)));
  const rl = rules.filter((r) => layer == null || r.layer === layer);
  return samples.map((s) => {
    const hit = iv.find((q) => q.core === s.core && s.x >= q.from && s.x < q.to);
    if (hit) return { label: hit.cat ?? hit.label, source: 'interval' };
    if (useRules) for (const r of rl) if (r.enabled !== false && ruleMatches(r, s, features)) return { label: r.cat ?? r.label, source: 'rule' };
    return { label: null, source: null };
  });
}

/* ───────── classifiers ───────── */

export const METHODS = {
  rf: { defaults: { trees: 100, maxDepth: 12, minLeaf: 3, mtry: 'sqrt', bins: 32, bootstrap: true, balanced: true } },
  knn: { defaults: { k: 7, weights: 'distance' } },
  nb: { defaults: { smoothing: 1e-6, priors: 'uniform' } },
  kmeans: { defaults: { k: 4, restarts: 5, maxIter: 100 } },
  mlp: { defaults: { hidden: '16', activation: 'relu', epochs: 200, lr: 0.01, l2: 0.0001, batch: 32, balanced: true, patience: 25 } },
};

function knnFit(X, y, p) { return { kind: 'knn', X, y, k: p.k, weights: p.weights, classes: [...new Set(y)] }; }
function knnProba(m, x) {
  const d = m.X.map((xi, i) => [Math.hypot(...xi.map((v, j) => v - x[j])), m.y[i]]).sort((a, b) => a[0] - b[0]).slice(0, m.k);
  const out = {}; let tot = 0;
  for (const [dist, c] of d) { const w = m.weights === 'distance' ? 1 / (dist + 0.05) : 1; /* +0.05 (z units): no near-certain votes next to near-duplicate resampled points */ out[c] = (out[c] || 0) + w; tot += w; }
  for (const c in out) out[c] /= tot;
  return out;
}

function nbFit(X, y, p) {
  const classes = [...new Set(y)], d = X[0].length, model = { kind: 'nb', classes, stats: {} };
  const maxVar = Math.max(...Array.from({ length: d }, (_, j) => std(X.map((r) => r[j])) ** 2));
  for (const c of classes) {
    const rows = X.filter((_, i) => y[i] === c);
    const mu = Array.from({ length: d }, (_, j) => mean(rows.map((r) => r[j])));
    const va = mu.map((m, j) => rows.reduce((a, r) => a + (r[j] - m) ** 2, 0) / rows.length + Math.max(p.smoothing, 1e-9) * (maxVar || 1));
    model.stats[c] = { mu, va, prior: p.priors === 'uniform' ? 1 / classes.length : rows.length / X.length };
  }
  return model;
}
function nbProba(m, x) {
  const ll = {};
  for (const c of m.classes) {
    const { mu, va, prior } = m.stats[c];
    ll[c] = Math.log(prior) + x.reduce((s, v, j) => s - 0.5 * Math.log(2 * Math.PI * va[j]) - ((v - mu[j]) ** 2) / (2 * va[j]), 0);
  }
  const mx = Math.max(...Object.values(ll)); let tot = 0; const out = {};
  for (const c in ll) { out[c] = Math.exp(ll[c] - mx); tot += out[c]; }
  for (const c in out) out[c] /= tot;
  return out;
}

/** Random forest of CART trees (Gini), candidate thresholds at feature quantiles (`bins`). */
function rfFit(X, y, p, seed) {
  const rnd = seededRandom(seed), n = X.length, d = X[0].length, classes = [...new Set(y)], K = classes.length;
  const yi = y.map((c) => classes.indexOf(c));
  const counts = classes.map((_, k) => yi.filter((v) => v === k).length);
  const cw = classes.map((_, k) => (p.balanced ? n / (K * counts[k]) : 1));
  const thr = Array.from({ length: d }, (_, j) => {
    const v = X.map((r) => r[j]).sort((a, b) => a - b), t = new Set();
    for (let b = 1; b < p.bins; b++) t.add(v[Math.floor((b / p.bins) * (n - 1))]);
    return [...t];
  });
  const mtry = p.mtry === 'all' ? d : p.mtry === 'log2' ? Math.max(1, Math.round(Math.log2(d))) : p.mtry === 'sqrt' ? Math.max(1, Math.round(Math.sqrt(d))) : Math.min(d, Math.max(1, +p.mtry));
  const importance = new Array(d).fill(0);
  const gini = (h, w) => { if (!w) return 0; let s = 1; for (const v of h) s -= (v / w) ** 2; return s; };
  const hist = (idx) => { const h = new Array(K).fill(0); for (const i of idx) h[yi[i]] += cw[yi[i]]; return h; };
  function grow(idx, depth) {
    const h = hist(idx), w = h.reduce((a, b) => a + b, 0);
    const leaf = () => ({ p: h.map((v) => v / w) });
    if (depth >= p.maxDepth || idx.length < 2 * p.minLeaf || h.filter((v) => v > 0).length < 2) return leaf();
    const feats = []; const pool = [...Array(d).keys()];
    while (feats.length < mtry) feats.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
    const g0 = gini(h, w); let best = null;
    for (const j of feats) {
      for (const t of thr[j]) {
        const hl = new Array(K).fill(0); let nl = 0;
        for (const i of idx) if (X[i][j] <= t) { hl[yi[i]] += cw[yi[i]]; nl++; }
        const nr = idx.length - nl; if (nl < p.minLeaf || nr < p.minLeaf) continue;
        const wl = hl.reduce((a, b) => a + b, 0), hr = h.map((v, k) => v - hl[k]), wr = w - wl;
        const gain = g0 - (wl / w) * gini(hl, wl) - (wr / w) * gini(hr, wr);
        if (!best || gain > best.gain) best = { j, t, gain };
      }
    }
    if (!best || best.gain <= 1e-12) return leaf();
    importance[best.j] += best.gain * w;
    const L = [], R = []; for (const i of idx) (X[i][best.j] <= best.t ? L : R).push(i);
    return { j: best.j, t: best.t, l: grow(L, depth + 1), r: grow(R, depth + 1) };
  }
  const trees = [];
  for (let b = 0; b < p.trees; b++) {
    const idx = p.bootstrap ? Array.from({ length: n }, () => Math.floor(rnd() * n)) : [...Array(n).keys()];
    trees.push(grow(idx, 0));
  }
  const tot = importance.reduce((a, b) => a + b, 0) || 1;
  return { kind: 'rf', classes, trees, importance: importance.map((v) => v / tot) };
}
function rfProba(m, x) {
  const acc = new Array(m.classes.length).fill(0);
  for (const tree of m.trees) { let nd = tree; while (!nd.p) nd = x[nd.j] <= nd.t ? nd.l : nd.r; nd.p.forEach((v, k) => (acc[k] += v)); }
  const out = {}; m.classes.forEach((c, k) => (out[c] = acc[k] / m.trees.length));
  return out;
}

/** k-means (k-means++ initialisation, several restarts; best inertia kept). Unsupervised: classes are groups. */
export function kmeansFit(X, p, seed) {
  const rnd = seededRandom(seed); let best = null;
  const d2 = (a, b) => a.reduce((s, v, j) => s + (v - b[j]) ** 2, 0);
  for (let rs = 0; rs < p.restarts; rs++) {
    const C = [X[Math.floor(rnd() * X.length)].slice()];
    while (C.length < p.k) {
      const dist = X.map((x) => Math.min(...C.map((c) => d2(x, c)))), tot = dist.reduce((a, b) => a + b, 0);
      let r = rnd() * tot, i = 0; while (i < X.length - 1 && (r -= dist[i]) > 0) i++;
      C.push(X[i].slice());
    }
    let assign = new Array(X.length).fill(-1);
    for (let it = 0; it < p.maxIter; it++) {
      const next = X.map((x) => { let bi = 0, bd = Infinity; C.forEach((c, k) => { const dd = d2(x, c); if (dd < bd) { bd = dd; bi = k; } }); return bi; });
      const changed = next.some((v, i) => v !== assign[i]); assign = next;
      for (let k = 0; k < p.k; k++) { const rows = X.filter((_, i) => assign[i] === k); if (rows.length) C[k] = rows[0].map((_, j) => mean(rows.map((r) => r[j]))); }
      if (!changed) break;
    }
    const inertia = X.reduce((s, x, i) => s + d2(x, C[assign[i]]), 0);
    if (!best || inertia < best.inertia) best = { centers: C, inertia };
  }
  return { kind: 'kmeans', classes: best.centers.map((_, k) => `G${k + 1}`), centers: best.centers, inertia: best.inertia };
}
function kmeansProba(m, x) {
  const d = m.centers.map((c) => Math.sqrt(c.reduce((s, v, j) => s + (v - x[j]) ** 2, 0)));
  const k = d.indexOf(Math.min(...d)), out = {}; m.classes.forEach((c, i) => (out[c] = i === k ? 1 : 0));
  return out;
}

/* ───────── multilayer perceptron (neural network, V26) ─────────
   Inputs standardised inside the model; hidden layers ReLU or tanh; softmax output; cross-entropy with optional
   class weights (balanced: n / (K · n_c)); L2 penalty; mini-batch Adam (β1 0.9, β2 0.999); He/Xavier initialisation;
   early stopping on 15 % of the training samples (stratified, when n ≥ 40) keeping the weights with the lowest
   validation loss. Deterministic for a given seed. */
function mlpFit(X, y, p, seed) { return runSteps(mlpFitSteps(X, y, p, seed)); }
/** Generator version: yields {epoch, epochs} after each epoch (V27: progress and cancel). */
function* mlpFitSteps(X, y, p, seed) {
  const rnd = seededRandom(seed), n = X.length, d = X[0]?.length || 0, classes = [...new Set(y)].sort(), K = classes.length;
  const sizes = [d, ...String(p.hidden || '16').split(/[,; ]+/).map(Number).filter((v) => v > 0).map(Math.round), K];
  const mu = Array(d).fill(0), sd = Array(d).fill(0);
  for (const x of X) for (let j = 0; j < d; j++) mu[j] += x[j] / n;
  for (const x of X) for (let j = 0; j < d; j++) sd[j] += (x[j] - mu[j]) ** 2 / n;
  for (let j = 0; j < d; j++) sd[j] = Math.sqrt(sd[j]) || 1;
  const Z = X.map((x) => x.map((v, j) => (v - mu[j]) / sd[j])), Y = y.map((c) => classes.indexOf(c));
  const gauss = () => { const u = Math.max(1e-12, rnd()), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const W = [], B = [];
  for (let l = 0; l < sizes.length - 1; l++) {
    const a = sizes[l], b = sizes[l + 1], sc = p.activation === 'tanh' || l === sizes.length - 2 ? Math.sqrt(1 / a) : Math.sqrt(2 / a);
    W.push(Array.from({ length: b }, () => Array.from({ length: a }, () => gauss() * sc))); B.push(Array(b).fill(0));
  }
  const cnt = classes.map((_, k) => Y.filter((v) => v === k).length), cw = cnt.map((c) => (p.balanced ? n / (K * Math.max(1, c)) : 1));
  // validation split (stratified)
  let tr = [...Array(n).keys()], va = [];
  if (n >= 40) {
    tr = []; for (let k = 0; k < K; k++) { const ids = Y.map((v, i) => (v === k ? i : -1)).filter((i) => i >= 0); for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; } const nv = ids.length >= 4 ? Math.round(ids.length * 0.15) : 0; va.push(...ids.slice(0, nv)); tr.push(...ids.slice(nv)); }
  }
  const act = p.activation === 'tanh' ? Math.tanh : (v) => (v > 0 ? v : 0), dact = p.activation === 'tanh' ? (a) => 1 - a * a : (a) => (a > 0 ? 1 : 0);
  const forward = (x) => { const A = [x]; for (let l = 0; l < W.length; l++) { const prev = A[l], out = W[l].map((w, i) => { let s = B[l][i]; for (let j = 0; j < w.length; j++) s += w[j] * prev[j]; return s; }); if (l < W.length - 1) A.push(out.map(act)); else { const m = Math.max(...out), e = out.map((v) => Math.exp(v - m)), t = e.reduce((a, b) => a + b, 0); A.push(e.map((v) => v / t)); } } return A; };
  const lossOf = (ids) => ids.reduce((s, i) => s - cw[Y[i]] * Math.log(Math.max(1e-12, forward(Z[i])[W.length][Y[i]])), 0) / Math.max(1, ids.length);
  const mW = W.map((w) => w.map((r) => r.map(() => 0))), vW = W.map((w) => w.map((r) => r.map(() => 0))), mB = B.map((b) => b.map(() => 0)), vB = B.map((b) => b.map(() => 0));
  const lr = p.lr, l2 = p.l2 || 0, bs = Math.max(1, Math.min(p.batch || 32, tr.length)), b1 = 0.9, b2 = 0.999;
  let step = 0, best = Infinity, bestW = null, bestB = null, wait = 0, epochs = 0;
  for (let ep = 0; ep < p.epochs; ep++) {
    epochs = ep + 1;
    for (let i = tr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [tr[i], tr[j]] = [tr[j], tr[i]]; }
    for (let s0 = 0; s0 < tr.length; s0 += bs) {
      const batch = tr.slice(s0, s0 + bs), gW = W.map((w) => w.map((r) => r.map(() => 0))), gB = B.map((b) => b.map(() => 0));
      for (const i of batch) {
        const A = forward(Z[i]); let delta = A[W.length].map((pk, k) => (pk - (k === Y[i] ? 1 : 0)) * cw[Y[i]]);
        for (let l = W.length - 1; l >= 0; l--) {
          const prev = A[l];
          for (let a = 0; a < delta.length; a++) { gB[l][a] += delta[a]; const g = gW[l][a]; for (let j = 0; j < prev.length; j++) g[j] += delta[a] * prev[j]; }
          if (l) delta = prev.map((v, j) => { let s = 0; for (let a = 0; a < delta.length; a++) s += W[l][a][j] * delta[a]; return s * dact(v); });
        }
      }
      step++; const c1 = 1 - b1 ** step, c2 = 1 - b2 ** step;
      for (let l = 0; l < W.length; l++) for (let a = 0; a < W[l].length; a++) {
        for (let j = 0; j < W[l][a].length; j++) { const g = gW[l][a][j] / batch.length + l2 * W[l][a][j]; mW[l][a][j] = b1 * mW[l][a][j] + (1 - b1) * g; vW[l][a][j] = b2 * vW[l][a][j] + (1 - b2) * g * g; W[l][a][j] -= (lr * mW[l][a][j] / c1) / (Math.sqrt(vW[l][a][j] / c2) + 1e-8); }
        const g = gB[l][a] / batch.length; mB[l][a] = b1 * mB[l][a] + (1 - b1) * g; vB[l][a] = b2 * vB[l][a] + (1 - b2) * g * g; B[l][a] -= (lr * mB[l][a] / c1) / (Math.sqrt(vB[l][a] / c2) + 1e-8);
      }
    }
    yield { epoch: epochs, epochs: p.epochs };
    if (va.length) {
      const L = lossOf(va);
      if (L < best - 1e-6) { best = L; bestW = W.map((w) => w.map((r) => r.slice())); bestB = B.map((b) => b.slice()); wait = 0; } else if (++wait >= (p.patience || 25)) break;
    }
  }
  if (bestW) { for (let l = 0; l < W.length; l++) { W[l] = bestW[l]; B[l] = bestB[l]; } }
  return { kind: 'mlp', W, B, mu, sd, classes, activation: p.activation, sizes, epochs, valLoss: va.length ? best : null };
}
function mlpProba(m, x) {
  const act = m.activation === 'tanh' ? Math.tanh : (v) => (v > 0 ? v : 0);
  let a = x.map((v, j) => (v - m.mu[j]) / m.sd[j]);
  for (let l = 0; l < m.W.length; l++) {
    const out = m.W[l].map((w, i) => { let s = m.B[l][i]; for (let j = 0; j < w.length; j++) s += w[j] * a[j]; return s; });
    if (l < m.W.length - 1) a = out.map(act); else { const mx = Math.max(...out), e = out.map((v) => Math.exp(v - mx)), t = e.reduce((q, r) => q + r, 0); a = e.map((v) => v / t); }
  }
  return Object.fromEntries(m.classes.map((c, k) => [c, a[k]]));
}

const runSteps = (it) => { let r; while (!(r = it.next()).done); return r.value; };
/** Any model as a generator (only the neural network yields, once per epoch); returns the fitted model. */
export function* fitModelSteps(method, X, y, params, seed = 42) {
  if (method === 'mlp') return yield* mlpFitSteps(X, y, { ...METHODS.mlp.defaults, ...params }, seed);
  return fitModel(method, X, y, params, seed);
}
export function fitModel(method, X, y, params, seed = 42) {
  const p = { ...METHODS[method].defaults, ...params };
  if (method === 'rf') return rfFit(X, y, p, seed);
  if (method === 'knn') return knnFit(X, y, p);
  if (method === 'nb') return nbFit(X, y, p);
  if (method === 'kmeans') return kmeansFit(X, p, seed);
  if (method === 'mlp') return mlpFit(X, y, p, seed);
  throw new Error('unknown method ' + method);
}
export function predictProba(model, x) {
  return model.kind === 'rf' ? rfProba(model, x) : model.kind === 'knn' ? knnProba(model, x) : model.kind === 'nb' ? nbProba(model, x) : model.kind === 'mlp' ? mlpProba(model, x) : kmeansProba(model, x);
}
export function predictLabel(model, x, minProb = 0) {
  const pr = predictProba(model, x); let best = null, bp = -1;
  for (const [c, v] of Object.entries(pr)) if (v > bp) { best = c; bp = v; }
  return { label: bp >= minProb ? best : null, prob: bp };
}

/* ───────── validation ───────── */

/**
 * Cross-validation. With ≥2 labelled cores: leave-one-core-out (no core is both trained and tested).
 * Otherwise: 5 folds of contiguous blocks along the axis within each core (limits autocorrelation leakage).
 * V0.37: in blocked folds, training leaves out the samples closer than opt.gap to the test block (default 5 % of the
 * labelled range, reported as `gap`); with opt.rescale (one flag per column: numeric?) the numeric columns are z-scored
 * in each fold with the mean and SD of its training samples only (from sample.t), so the test core does not enter the
 * scaling.
 */
/** Same as crossValidateSteps, run to the end. */
export function crossValidate(samples, labels, method, params, seed = 42, opt = {}) {
  const it = crossValidateSteps(samples, labels, method, params, seed, opt); let r;
  while (!(r = it.next()).done);
  return r.value;
}
/** Cross-validation as a generator: yields {fold, folds} before each fold (V27: lets the interface show progress), returns the result. */
export function* crossValidateSteps(samples, labels, method, params, seed = 42, opt = {}) {
  // opt.scored(i): only these labelled samples are scored (e.g. described intervals, not rule labels, which would be circular);
  // all labelled samples may still be used for training. opt.minProb: threshold used in practice (coverage reported).
  const idx = samples.map((_, i) => i).filter((i) => labels[i] != null), scored = opt.scored || (() => true);
  const cores = [...new Set(idx.map((i) => samples[i].core))];
  let folds, gap = 0;
  if (cores.length >= 2) folds = cores.map((c) => idx.filter((i) => samples[i].core === c));
  else {
    const sorted = [...idx].sort((a, b) => samples[a].x - samples[b].x), k = Math.min(5, sorted.length);
    folds = Array.from({ length: k }, (_, f) => sorted.slice(Math.floor((f * sorted.length) / k), Math.floor(((f + 1) * sorted.length) / k)));
    gap = opt.gap ?? (sorted.length ? (samples[sorted.at(-1)].x - samples[sorted[0]].x) * 0.05 : 0);
  }
  const resc = (opt.rescale || opt.impute) && samples.length && samples[0].t ? (opt.rescale || opt.impute) : null;
  const zf = (train) => {   // per-fold z-score of the numeric columns (training statistics only)
    if (!resc) return (i) => samples[i].f;
    const mu = resc.map((on, j) => (on ? mean(train.map((i) => samples[i].t[j]).filter((v) => v != null)) : 0));
    const sd = resc.map((on, j) => { if (!on || opt.impute) return 1; const v = train.map((i) => samples[i].t[j]).filter((x) => x != null); const m = mu[j]; const q = v.length > 1 ? Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1)) : 0; return q || 1; });
    return (i) => samples[i].f.map((v, j) => (resc[j] ? opt.impute ? (samples[i].t[j] ?? mu[j]) : (samples[i].t[j] == null ? 0 : (samples[i].t[j] - mu[j]) / sd[j]) : v));
  };
  const classes = [...new Set(idx.map((i) => labels[i]))].sort(), cm = classes.map(() => classes.map(() => 0));
  const perFold = []; let nScored = 0, nCovered = 0, nCovOk = 0;
  for (const [fi, test] of folds.entries()) {
    yield { fold: fi, folds: folds.length };
    const tset = new Set(test), lo = Math.min(...test.map((i) => samples[i].x)) - gap, hi = Math.max(...test.map((i) => samples[i].x)) + gap;
    const train = idx.filter((i) => !tset.has(i) && !(gap > 0 && samples[i].x > lo && samples[i].x < hi)), tst = test.filter(scored);
    if (new Set(train.map((i) => labels[i])).size < 2 || !tst.length) continue;
    const X = zf(train);
    const fit = fitModelSteps(method, train.map(X), train.map((i) => labels[i]), params, seed);
    let fr; while (!(fr = fit.next()).done) yield { fold: fi, folds: folds.length, ...fr.value };
    const m = fr.value;
    const rc = {};
    for (const i of tst) {
      const pr = predictLabel(m, X(i)), a = classes.indexOf(labels[i]), b = classes.indexOf(pr.label); nScored++;
      if (a >= 0 && b >= 0) cm[a][b]++;
      (rc[labels[i]] ||= [0, 0])[1]++; if (pr.label === labels[i]) rc[labels[i]][0]++;
      if (opt.minProb != null && pr.prob >= opt.minProb) { nCovered++; if (pr.label === labels[i]) nCovOk++; }
    }
    const recs = Object.values(rc).map(([k, n]) => k / n); if (recs.length) perFold.push(mean(recs));
  }
  const total = cm.flat().reduce((a, b) => a + b, 0), correct = classes.reduce((s, _, k) => s + cm[k][k], 0);
  const perClass = classes.map((c, k) => {
    const tp = cm[k][k], fn = cm[k].reduce((a, b) => a + b, 0) - tp, fp = cm.reduce((s, r) => s + r[k], 0) - tp;
    const precision = tp + fp ? tp / (tp + fp) : null, recall = tp + fn ? tp / (tp + fn) : null;
    return { label: c, precision, recall, f1: precision && recall ? (2 * precision * recall) / (precision + recall) : 0, n: tp + fn };
  });
  const rec = perClass.filter((q) => q.recall != null);
  const sdF = perFold.length > 1 ? Math.sqrt(perFold.reduce((a, v) => a + (v - mean(perFold)) ** 2, 0) / (perFold.length - 1)) : null;
  return { scheme: cores.length >= 2 ? 'leave-one-core-out' : 'blocked-5-fold', folds: folds.length, gap, rescaled: !!resc, classes, cm, total, nScored,
    accuracy: total ? correct / total : null, balancedAccuracy: rec.length ? mean(rec.map((q) => q.recall)) : null, perClass,
    foldBalanced: { mean: perFold.length ? mean(perFold) : null, sd: sdF, n: perFold.length },
    coverage: opt.minProb != null && nScored ? { minProb: opt.minProb, share: nCovered / nScored, accuracy: nCovered ? nCovOk / nCovered : null } : null };
}

/* ───────── maps ───────── */

/**
 * Per-core summary inside an age window [a0, a1).
 * mode 'class': fraction of samples per predicted class (dominant class reported);
 * mode 'value': mean of feature j (z-scored per core), optionally minus the mean in a reference window.
 */
export function mapSummary(samples, preds, cores, { a0, a1, mode, feature = 0, ref = null }) {
  return cores.filter(validMapCoords).map((c) => {
    const id = c.id ?? c.name;
    const sel = samples.map((s, i) => [s, i]).filter(([s]) => s.core === id && s.age != null && s.age >= a0 && s.age < a1);
    if (!sel.length) return { core: id, name: c.name, lat: c.lat, lon: c.lon, n: 0 };
    if (mode === 'class') {
      const cnt = {}; for (const [, i] of sel) { const l = preds[i]?.label; if (l != null) cnt[l] = (cnt[l] || 0) + 1; }
      const [dom, k] = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0] || [null, 0];
      return { core: id, name: c.name, lat: c.lat, lon: c.lon, n: sel.length, dominant: dom, fraction: k / sel.length, counts: cnt };
    }
    // only samples with a real value of the variable (with missing = 'mean' the filled ones are z = 0 and would bias the map)
    const real = sel.filter(([s]) => s.t?.[feature] != null);
    if (!real.length) return { core: id, name: c.name, lat: c.lat, lon: c.lon, n: 0 };
    let v = mean(real.map(([s]) => s.zc[feature]));
    if (ref) {
      const r = samples.filter((s) => s.core === id && s.age != null && s.age >= ref[0] && s.age < ref[1] && s.t?.[feature] != null);
      if (!r.length) return { core: id, name: c.name, lat: c.lat, lon: c.lon, n: 0 };
      v -= mean(r.map((s) => s.zc[feature]));
    }
    return { core: id, name: c.name, lat: c.lat, lon: c.lon, n: real.length, value: v };
  });
}

const esc2 = (s) => {
  try { return String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]); }
  catch { return ''; }
};

/** Diverging colour (blue–cream–red) for z values clipped at ±2. */
export function divColor(v) {
  const t = Math.max(-1, Math.min(1, v / 2));
  const a = [242, 236, 219], b = t < 0 ? [38, 110, 150] : [196, 80, 46], f = Math.abs(t);
  return `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * f)).join(',')})`;
}

/** Default look of the maps (V15). Every key can be changed by the user. */
export const MAP_STYLE = {
  bg: 'vector', bgOpacity: 1, coast: true, symbol: 'circle', size: 1, sizeByFraction: true,
  labels: true, labelSize: 11, labelColor: '#1c2422', halo: true, labelValue: true,
  pointColor: '#ffffff', stroke: '#1c2422', land: '#e6e6dc', sea: '#f4f8f9', textColor: '#1c2422', subColor: '#5b6763', bgColor: '#ffffff', graticule: true, scaleBar: true, north: false, proj: 'plate',
};
export const MAP_SYMBOLS = ['circle', 'square', 'triangle', 'diamond', 'star', 'hexagon', 'cross'];

/** SVG markup of a symbol of radius r centred at (cx, cy). */
export function symbolSVG(sym, cx, cy, r, attrs) {
  const poly = (pts) => `<polygon points="${pts.map(([x, y]) => `${(cx + x).toFixed(1)},${(cy + y).toFixed(1)}`).join(' ')}" ${attrs}/>`;
  const ring = (n, rad, rot = -Math.PI / 2) => Array.from({ length: n }, (_, k) => [rad * Math.cos(rot + (2 * Math.PI * k) / n), rad * Math.sin(rot + (2 * Math.PI * k) / n)]);
  switch (sym) {
    case 'square': { const a = r * 0.89; return `<rect x="${(cx - a).toFixed(1)}" y="${(cy - a).toFixed(1)}" width="${(2 * a).toFixed(1)}" height="${(2 * a).toFixed(1)}" ${attrs}/>`; }
    case 'triangle': return poly(ring(3, r * 1.25).map(([x, y]) => [x, y + r * 0.2]));
    case 'diamond': return poly(ring(4, r * 1.2));
    case 'hexagon': return poly(ring(6, r * 1.05));
    case 'star': return poly(ring(10, r * 1.35).map(([x, y], k) => (k % 2 ? [x * 0.45, y * 0.45] : [x, y])));
    case 'cross': { const a = r * 1.1, b = r * 0.38; return poly([[-b, -a], [b, -a], [b, -b], [a, -b], [a, b], [b, b], [b, a], [-b, a], [-b, b], [-a, b], [-a, -b], [-b, -b]]); }
    default: return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" ${attrs}/>`;
  }
}

/** Map projections (V20): plate carrée with cos(φ0) scaling (default), Mercator and Lambert azimuthal equal-area. */
export const MAP_PROJECTIONS = ['plate', 'mercator', 'laea'];
const RAD = Math.PI / 180;
/** Projection centred on the extent: fwd(lon, lat) → [x, y] (y up), inv(x, y) → [lon, lat]. */
export function makeProjection(kind, bbox) {
  const [x0, y0, x1, y1] = bbox, l0 = ((x0 + x1) / 2) * RAD, p0 = ((y0 + y1) / 2) * RAD, cosl = Math.cos(p0);
  if (kind === 'mercator') return { kind, fwd: (lon, lat) => [lon * RAD, Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * RAD) / 2))], inv: (x, y) => [x / RAD, (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / RAD] };
  if (kind === 'laea') return {
    kind,
    fwd: (lon, lat) => { const l = lon * RAD - l0, p = lat * RAD, k = Math.sqrt(2 / (1 + Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(l))); return [k * Math.cos(p) * Math.sin(l), k * (Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(l))]; },
    inv: (x, y) => { const r = Math.hypot(x, y); if (r < 1e-12) return [l0 / RAD, p0 / RAD]; const c = 2 * Math.asin(Math.min(1, r / 2)); const p = Math.asin(Math.cos(c) * Math.sin(p0) + (y * Math.sin(c) * Math.cos(p0)) / r); const l = l0 + Math.atan2(x * Math.sin(c), r * Math.cos(p0) * Math.cos(c) - y * Math.sin(p0) * Math.sin(c)); return [l / RAD, p / RAD]; },
  };
  return { kind: 'plate', fwd: (lon, lat) => [lon * cosl, lat], inv: (x, y) => [x / cosl, y] };
}
/**
 * Plot frame of a map: 900 px wide, height from the projected extent (the bbox edges are sampled, so curved
 * edges of conic/azimuthal projections fit). P(lon, lat) → [px, py]; Pinv(px, py) → [lon, lat].
 */
export function mapFrame(bbox, kind = 'plate') {
  const pr = makeProjection(kind, bbox), [x0, y0, x1, y1] = bbox, xs = [], ys = [];
  for (let k = 0; k <= 20; k++) for (const [lo, la] of [[x0 + ((x1 - x0) * k) / 20, y0], [x0 + ((x1 - x0) * k) / 20, y1], [x0, y0 + ((y1 - y0) * k) / 20], [x1, y0 + ((y1 - y0) * k) / 20]]) { const [x, y] = pr.fwd(lo, la); xs.push(x); ys.push(y); }
  const X0 = Math.min(...xs), X1 = Math.max(...xs), Y0 = Math.min(...ys), Y1 = Math.max(...ys);
  const W = 900, H = Math.max(60, Math.round((W * (Y1 - Y0)) / (X1 - X0 || 1))), top = 44, bottom = 70;
  const P = (lon, lat) => { const [x, y] = pr.fwd(lon, lat); return [((x - X0) / (X1 - X0)) * W, top + ((Y1 - y) / (Y1 - Y0)) * H]; };
  const Pinv = (px, py) => pr.inv(X0 + (px / W) * (X1 - X0), Y1 - ((py - top) / H) * (Y1 - Y0));
  return { W, H, top, bottom, P, Pinv, kind: pr.kind };
}
/** Size of the plot area of a map with this extent and projection. */
export function mapGeometry(bbox, kind = 'plate') { const f = mapFrame(bbox, kind); return { W: f.W, H: f.H, top: f.top, bottom: f.bottom }; }

/** Widen an extent (never narrow it) so that its plot area has height/width = ratio (V23: resizable map frames). */
export function fitBBoxAspect(bbox, ratio, kind = 'plate') {
  if (!(ratio > 0.05)) return bbox;
  const err = (q) => { const g = mapFrame(q, kind); return Math.abs(Math.log(g.H / g.W / ratio)); };
  let b = [...bbox], best = b, bestErr = err(b);
  for (let it = 0; it < 12 && bestErr > 0.01; it++) {
    const g = mapFrame(b, kind), cur = g.H / g.W, cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2, n = [...b];
    if (cur < ratio) { const h = ((b[3] - b[1]) / 2) * (ratio / cur); n[1] = Math.max(-85, cy - h); n[3] = Math.min(85, cy + h); }
    else { const w = Math.min(180, ((b[2] - b[0]) / 2) * (cur / ratio)); n[0] = cx - w; n[2] = cx + w; }
    const e = err(n); if (e >= bestErr - 1e-4) break;   // e.g. very wide Lambert maps curve and cannot get wider
    b = n; best = n; bestErr = e;
  }
  return best.map((v) => +v.toFixed(4));
}

/** Zoom an extent by factor f (>1 zooms in) around (lon, lat); pan by (dlon, dlat). Latitudes stay in [-85, 85]. */
export function zoomBBox(bbox, f, lon, lat, dlon = 0, dlat = 0) {
  let [x0, y0, x1, y1] = bbox;
  if (lon == null) lon = (x0 + x1) / 2; if (lat == null) lat = (y0 + y1) / 2;
  x0 = lon - (lon - x0) / f + dlon; x1 = lon + (x1 - lon) / f + dlon; y0 = lat - (lat - y0) / f + dlat; y1 = lat + (y1 - lat) / f + dlat;
  if (x1 - x0 > 360) { x0 = -180; x1 = 180; }
  if (y1 - y0 > 170) { y0 = -85; y1 = 85; }
  if (y0 < -85) { y1 += -85 - y0; y0 = -85; } if (y1 > 85) { y0 -= y1 - 85; y1 = 85; }
  return [x0, y0, x1, y1].map((v) => +v.toFixed(4));
}

/** Kilometres in a "nice" scale bar of about maxPx pixels, measured at the centre of the map. */
function scaleBarKm(bbox, P, maxPx = 160) {
  const lat = (bbox[1] + bbox[3]) / 2, lon = (bbox[0] + bbox[2]) / 2, a = P(lon - 0.5, lat), b = P(lon + 0.5, lat);
  const kmPerPx = (111.32 * Math.cos(lat * RAD)) / (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1), raw = kmPerPx * maxPx;
  const p = 10 ** Math.floor(Math.log10(raw)), km = [5, 2, 1].map((k) => k * p).find((k) => k <= raw) || p;
  return { km, px: km / kmPerPx };
}

/**
 * SVG map. o = {land, bbox, points, mode: 'class'|'value', colors, grid, nx, ny, title, subtitle, note, legend, tipFn (point → hover text),
 *               style (see MAP_STYLE), bg: {href, href2, attribution}}.
 * bg.href is an image already projected in EPSG:4326 over the bbox (it is stretched onto the plot area);
 * bg.href2 (optional) is drawn on top clipped to the land polygons (e.g. aerial photo over a bathymetry).
 */
export function buildMapSVG(o) {
  const raw = o.style && typeof o.style === 'object' && !Array.isArray(o.style) ? o.style : {};
  const st = { ...MAP_STYLE, ...raw }, bg = o.bg || null;
  for (const k of ['bgOpacity', 'size', 'labelSize']) st[k] = finiteStyleNumber(st[k], MAP_STYLE[k]);
  const hexRe = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;
  for (const k of ['labelColor', 'pointColor', 'stroke', 'land', 'sea', 'textColor', 'subColor', 'bgColor']) {
    if (typeof st[k] !== 'string' || !hexRe.test(st[k])) st[k] = MAP_STYLE[k];
  }
  const [x0, y0, x1, y1] = o.bbox, F = mapFrame(o.bbox, st.proj || 'plate'), { W, H, top, P } = F;
  const bottom = F.bottom + (o.coverageNote && bg?.attribution ? 16 : 0);
  const xy = (lon, lat) => P(lon, lat).map((v) => v.toFixed(1)).join(' ');
  const linear = F.kind === 'plate' || F.kind === 'mercator'; // grid cells stay rectangles
  const raster = !!(bg && bg.href) && linear;
  const s = [`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H + top + bottom}" viewBox="0 0 ${W} ${H + top + bottom}" font-family="IBM Plex Sans, Arial, sans-serif" font-size="11">`,
    `<rect width="${W}" height="${H + top + bottom}" fill="${esc2(st.bgColor)}"/><rect x="0" y="${top}" width="${W}" height="${H}" fill="${esc2(st.sea)}"/>`,
    `<text x="8" y="18" font-size="14" font-weight="600" fill="${esc2(st.textColor)}">${esc2(o.title || '')}</text>`,
    `<text x="8" y="34" fill="${esc2(st.subColor)}">${esc2(o.subtitle || '')}</text>`];
  // land paths (used for drawing and, with a second image, as clip path)
  const landD = [];
  for (const r of o.land || []) {
    let d = '', inBox = false;
    for (let k = 0; k < r.length; k += 2) { if (r[k] >= x0 - 5 && r[k] <= x1 + 5 && r[k + 1] >= y0 - 5 && r[k + 1] <= y1 + 5) inBox = true; d += `${k ? 'L' : 'M'}${xy(r[k], r[k + 1])}`; }
    if (inBox) landD.push(`${d}Z`);
  }
  s.push(`<defs><clipPath id="mapclip"><rect x="0" y="${top}" width="${W}" height="${H}"/></clipPath>${raster && bg.href2 ? `<clipPath id="landclip">${landD.map((d) => `<path d="${d}"/>`).join('')}</clipPath>` : ''}</defs><g clip-path="url(#mapclip)">`);
  const img = (href, extra = '') => `<image x="0" y="${top}" width="${W}" height="${H}" preserveAspectRatio="none" href="${href}" xlink:href="${href}" opacity="${st.bgOpacity}"${extra}/>`;
  if (raster) { s.push(img(bg.href)); if (bg.href2) s.push(`<g clip-path="url(#landclip)">${img(bg.href2)}</g>`); }
  if (o.grid) {
    const cf = o.colorFn || divColor, op = o.gridOpacity ?? (raster ? 0.55 : 0.75), dl = (x1 - x0) / o.nx, dp = (y1 - y0) / o.ny;
    // cell (ix, iy) covers lon x0+ix·dl … +dl and lat y1−iy·dp … −dp; drawn as a rectangle (plate, Mercator) or a projected quadrilateral
    // the opacity goes on the group, so overlapping cell edges leave no seams
    s.push(`<g opacity="${op}" class="grid">`);
    o.grid.forEach((v, i) => {
      if (v == null) return; const ix = i % o.nx, iy = Math.floor(i / o.nx), lo = x0 + ix * dl, la = y1 - iy * dp;
      if (linear) { const [ax, ay] = P(lo, la), [bx, by] = P(lo + dl, la - dp); s.push(`<rect x="${ax.toFixed(2)}" y="${ay.toFixed(2)}" width="${(bx - ax + 0.5).toFixed(2)}" height="${(by - ay + 0.5).toFixed(2)}" fill="${cf(v)}"/>`); }
      else s.push(`<path d="M${xy(lo, la)}L${xy(lo + dl, la)}L${xy(lo + dl, la - dp)}L${xy(lo, la - dp)}Z" fill="${cf(v)}" stroke="${cf(v)}" stroke-width="0.5"/>`);
    });
    s.push('</g>');
    // contour lines (segments in cell units from interp.js contourSegments: u = column of cell centres, v = row)
    const C = (u, w) => xy(x0 + (u + 0.5) * dl, y1 - (w + 0.5) * dp);
    for (const c of o.contours || []) {
      if (c.segs.length) s.push(`<path d="${c.segs.map((q) => `M${C(q[0], q[1])}L${C(q[2], q[3])}`).join('')}" fill="none" stroke="#1c2422" stroke-opacity="0.75" stroke-width="0.8"/>`);
      if (o.contourLabels) for (let k = 0; k < c.segs.length; k += Math.max(25, Math.round(c.segs.length / 3))) { const q = c.segs[k], [tx, ty] = P(x0 + ((q[0] + q[2]) / 2 + 0.5) * dl, y1 - ((q[1] + q[3]) / 2 + 0.5) * dp); s.push(`<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" font-size="8.5" fill="${esc2(st.textColor)}" stroke="#ffffff" stroke-width="2.5" paint-order="stroke" text-anchor="middle">${esc2(c.label ?? c.level)}</text>`); }
    }
  }
  if (!raster) for (const d of landD) s.push(`<path d="${d}" fill="${esc2(st.land)}" stroke="#b9b9a8" stroke-width="0.6"/>`);
  else if (st.coast) for (const d of landD) s.push(`<path d="${d}" fill="none" stroke="#ffffff" stroke-opacity="0.7" stroke-width="0.6"/>`);
  if (st.graticule) {
    const gc = raster ? '#ffffff' : '#c9d3d6', tc = raster ? '#ffffff' : '#7a8682';
    const line = (pts) => `<path d="${pts.map((q, k) => `${k ? 'L' : 'M'}${xy(q[0], q[1])}`).join('')}" fill="none" stroke="${gc}" stroke-opacity="0.8" stroke-width="0.4" stroke-dasharray="2 3"/>`;
    const lat0 = y0 - (y1 - y0), lat1 = y1 + (y1 - y0), lon0 = x0 - (x1 - x0), lon1 = x1 + (x1 - x0); // drawn beyond the frame (clipped) so curved lines reach the edges
    for (const v of niceTicks(x0, x1, 6)) { s.push(line(Array.from({ length: 41 }, (_, k) => [v, Math.max(-85, Math.min(85, lat0 + ((lat1 - lat0) * k) / 40))]))); const [tx] = P(v, y0); s.push(`<text x="${(tx + 2).toFixed(1)}" y="${top + H - 4}" fill="${tc}" font-size="9">${v}°</text>`); }
    for (const v of niceTicks(y0, y1, 4)) { s.push(line(Array.from({ length: 41 }, (_, k) => [lon0 + ((lon1 - lon0) * k) / 40, v]))); const [, ty] = P(x0, v); s.push(`<text x="3" y="${(ty - 2).toFixed(1)}" fill="${tc}" font-size="9">${v}°</text>`); }
  }
  const halo = st.halo ? ` stroke="${raster ? '#000000' : '#ffffff'}" stroke-opacity="0.6" stroke-width="3" paint-order="stroke" stroke-linejoin="round"` : '';
  const lblColor = raster && st.labelColor === MAP_STYLE.labelColor && st.halo ? '#ffffff' : st.labelColor;
  for (const p of o.points) {
    const [cx, cy] = P(p.lon, p.lat);
    if (cx < -20 || cx > W + 20 || cy < top - 20 || cy > top + H + 20) continue;
    let fill = st.pointColor, r = 6, label = p.name;
    if (!p.n) r = 4;
    else if (o.mode === 'class') { fill = (p.dominant && o.colors[p.dominant]) || '#9aa5a1'; r = st.sizeByFraction ? 5 + 5 * (p.fraction ?? 0.6) : 7; if (st.labelValue && p.dominant && p.fraction != null) label += ` ${Math.round(p.fraction * 100)}%`; }
    else { fill = (o.colorFn || divColor)(p.value); if (st.labelValue) label += ` ${(+p.value).toFixed(2)}`; }
    r *= st.size;
    const sym = symbolSVG(p.symbol || st.symbol, cx, cy, r, `fill="${esc2(p.color || fill)}" stroke="${esc2(st.stroke)}" stroke-width="${p.n ? 1 : 0.6}"${p.n ? '' : ' stroke-dasharray="2 2"'}`);
    s.push(o.tipFn ? `<g data-tip="${esc2(o.tipFn(p))}" style="cursor:help">${sym}</g>` : sym);   // V25: hover information
    if (st.labels) s.push(`<text x="${(cx + r + 3).toFixed(1)}" y="${(cy + st.labelSize * 0.36).toFixed(1)}" font-size="${st.labelSize}" fill="${esc2(lblColor)}"${halo}>${esc2(label)}</text>`);
  }
  if (st.scaleBar) {
    const { km, px: L } = scaleBarKm(o.bbox, P), bx = W - L - 16, by = top + H - 14, c = raster ? '#ffffff' : '#1c2422';
    s.push(`<g><rect x="${bx.toFixed(1)}" y="${by}" width="${(L / 2).toFixed(1)}" height="5" fill="${c}" stroke="${c}"/><rect x="${(bx + L / 2).toFixed(1)}" y="${by}" width="${(L / 2).toFixed(1)}" height="5" fill="none" stroke="${c}"/><text x="${(bx + L).toFixed(1)}" y="${by - 4}" text-anchor="end" font-size="9" fill="${c}">${km} km</text></g>`);
  }
  if (st.north) { const nx = W - 24, ny = top + 14, c = raster ? '#ffffff' : '#1c2422'; s.push(`<polygon points="${nx},${ny} ${nx - 7},${ny + 20} ${nx},${ny + 15} ${nx + 7},${ny + 20}" fill="${c}"/><text x="${nx}" y="${ny + 32}" text-anchor="middle" font-size="10" font-weight="600" fill="${c}">N</text>`); }
  s.push('</g>');
  let lx = 8; const ly = top + H + 20;
  for (const [name, color, symbol] of o.legend || []) { s.push(`${symbolSVG(symbol || st.symbol, lx + 5.5, ly - 3.5, 5.5, `fill="${esc2(color)}" stroke="#1c2422" stroke-width="0.5"`)}<text x="${lx + 15}" y="${ly}" fill="${esc2(st.textColor)}">${esc2(name)}</text>`); lx += 30 + name.length * 6.2; }
  if (o.colorbar) { // horizontal colour bar under the map, right side
    const cb = o.colorbar, bw = 240, bx = W - bw - 16, by = top + H + 12, nst = 60, ticks = cb.ticks || niceTicks(cb.min, cb.max, 5);
    for (let k = 0; k < nst; k++) { const v = cb.min + ((k + 0.5) / nst) * (cb.max - cb.min); s.push(`<rect x="${(bx + (k * bw) / nst).toFixed(1)}" y="${by}" width="${(bw / nst + 0.4).toFixed(1)}" height="10" fill="${cb.fn(v)}"/>`); }
    s.push(`<rect x="${bx}" y="${by}" width="${bw}" height="10" fill="none" stroke="#1c2422" stroke-width="0.5"/>`);
    for (const v of ticks) { if (v < cb.min - 1e-9 || v > cb.max + 1e-9) continue; const x = bx + ((v - cb.min) / (cb.max - cb.min || 1)) * bw; s.push(`<line x1="${x.toFixed(1)}" y1="${by + 10}" x2="${x.toFixed(1)}" y2="${by + 13}" stroke="${esc2(st.textColor)}" stroke-width="0.6"/><text x="${x.toFixed(1)}" y="${by + 22}" font-size="8.5" text-anchor="middle" fill="${esc2(st.textColor)}">${+v.toFixed(3)}</text>`); }
    if (cb.label) s.push(`<text x="${bx - 6}" y="${by + 9}" font-size="9" text-anchor="end" fill="${esc2(st.textColor)}">${esc2(cb.label)}</text>`);
  }
  if (o.note) s.push(`<text x="8" y="${top + H + 46}" fill="${esc2(st.subColor)}" font-size="10">${esc2(o.note)}</text>`);
  if (o.coverageNote) s.push(`<text x="8" y="${top + H + 62}" fill="${esc2(st.subColor)}" font-size="10">${esc2(o.coverageNote)}</text>`);
  if (bg && bg.attribution) s.push(`<text x="${W - 6}" y="${top + H + (o.coverageNote ? 78 : 62)}" text-anchor="end" fill="${esc2(st.subColor)}" font-size="8.5">${esc2(bg.attribution)}</text>`);
  s.push('</svg>');
  return s.join('');
}

/** Map extent around the cores with a margin (degrees). */
export function mapBBox(points, margin = 3) {
  const p = points.filter(validMapCoords);
  if (!p.length) return [-10, 30, 40, 48];
  const lon = p.map((q) => q.lon), lat = p.map((q) => q.lat);
  return [Math.min(...lon) - margin, Math.min(...lat) - margin, Math.max(...lon) + margin, Math.max(...lat) + margin];
}


/**
 * V0.34: within one core and family (layer), intervals never overlap and touching intervals of the same class are
 * joined. Intervals are grouped by core, layer, axis and automatic flag. `priority` = id of the interval just drawn or
 * edited: where it overlaps others it wins and they are trimmed (or split in two). `newId()` names the extra pieces.
 * Returns { list, changed }.
 */
export function tidyIntervals(list, { priority = null, newId = () => Math.random().toString(36).slice(2) } = {}) {
  const eps = 1e-9, groups = new Map();
  for (const q of list) {
    if (!(q.to > q.from)) continue;
    const k = `${q.core}|${q.layer}|${q.axis}|${q.auto ? 1 : 0}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(q);
  }
  const out = []; let changed = list.some((q) => !(q.to > q.from));
  for (const g of groups.values()) {
    const ord = [...g].sort((a, b) => (a.id === priority ? -1 : b.id === priority ? 1 : 0));   // the priority interval is placed first
    const acc = [];
    for (const q of ord) {
      let parts = [{ from: q.from, to: q.to }];
      for (const p of acc) {
        parts = parts.flatMap((r) => {
          if (r.to <= p.from + eps || r.from >= p.to - eps) return [r];
          changed = true;
          return [r.from < p.from - eps ? { from: r.from, to: p.from } : null, r.to > p.to + eps ? { from: p.to, to: r.to } : null].filter(Boolean);
        });
      }
      parts.forEach((r, i) => acc.push({ ...q, id: i ? newId() : q.id, from: r.from, to: r.to }));
    }
    acc.sort((a, b) => a.from - b.from);
    const merged = [];
    for (const q of acc) {
      const p = merged[merged.length - 1];
      if (p && p.cat === q.cat && q.from <= p.to + eps) { p.to = Math.max(p.to, q.to); if (q.id === priority) p.id = q.id; changed = true; }
      else merged.push(q);
    }
    out.push(...merged);
  }
  return { list: out, changed };
}
