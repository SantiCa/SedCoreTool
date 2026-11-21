/* Multiproxy tool: numeric records, interval layers, classifiers, composite-log readout, manual classification and maps. */
import { lang, t } from './i18n.js';
import { geoTrackOptions } from './figview.js';
import { mergeAgeImports, mergeMixedImports } from './geo.js';
import { MAP_PROJECTIONS, MAP_STYLE, MAP_SYMBOLS, METHODS, applyCatalogue, buildMapSVG, buildSamples, coreAges, coreFromRows, coresFromLongTable, crossValidateSteps, featureSeries, fitBBoxAspect, fitModel, fitModelSteps, fitSampleTransform, intervalsFromTable, intervalsOnAxis, labelSamples, layerFeatureNames, mapBBox, mapFrame, mapGeometry, mapSummary, orphanIntervals, predictLabel, segmentsOnAxis, tidyIntervals, transformSample, zoomBBox } from './geo.js';
import { $, S, fetchAsset, fmt, sec, uid } from './state.js';
import { DELIVERY, armed, busy, compositeMarks, compositeTaxonPoints, cropState, endCrop, esc, finalTestsHTML, holdoutHTML, holdoutIds, loadLib, makeCore, markDirty, openCoreDlg, refreshAllCores, refreshCoreData, renderCoreBar, runFinalGeo, safe, saveFile, scheduleFloat, toast, updateTip, view, withProv, zoomAt } from './app.js';
import { axesFormHTML, colOrderHTML, colorsFormHTML, columnImages, compositeData, logStyleOf, mode, scheduleLog, syncColOrder } from './columns.js';
import { interpAge, parseAgeModel, toCSV } from './core.js';
import { buildLogSVG, compositeRows, decodeText, eventShadeOptions, eventShading, mergedStyle, parseTable, validHexColor } from './log.js';
import { renderFigure, verticalStyleHTML } from './figures.js';
import { INTERP_DEFAULT, INTERP_METHODS, RAMPS, colorRange, contourLevels, contourSegments, interpolate, maskLand, rampColor, visibleSeaOptions } from './interp.js';
import { frameRatio, panelPrefs, placeSplitters, savePanels } from './panels.js';

/* ───────────── multiproxy tool: numeric records, interval layers and automatic interval classification ─────────────
   Independent of the ichnotaxon suggestions of the Section mode (learn.js). State lives in S.geo (key kept for file compatibility). */

export const GROUP_COLORS = ['#0b5394', '#a23b2a', '#1b7f6a', '#5c4ea0', '#8c2d5a', '#0e7490', '#3c7d22', '#6b5e4b', '#2f4b7c', '#7a6f00', '#9c4f96', '#4a6b8a'];   // V0.27

export function defaultGeo() {
  return {
    cores: [], ratios: [], intervals: [], rules: [], groupNames: {},
    layers: [{ id: 'events', name: t('geo.layerEvents'), parent: null, cats: [
      { id: 'lowox', name: t('geo.l.lowox'), color: '#2b6f8f' },
      { id: 'detrital', name: t('geo.l.detrital'), color: '#c07a2c' },
      { id: 'current', name: t('geo.l.current'), color: '#7a4fb2' },
      { id: 'background', name: t('geo.l.background'), color: '#cfc8b6' },
    ] }],
    activeLayer: 'events', activeCat: 'lowox',
    settings: { axis: 'age', step: 1, features: [], logs: [], scaling: 'global', maxGap: null, method: 'rf', params: { rf: {}, knn: {}, nb: {}, kmeans: {}, mlp: {} }, minProb: 0.5, useRules: true, seed: 42, target: 'events', useLayers: null, missing: 'drop' },
    classifiers: [], lastCat: {},
    map: { a0: 6, a1: 10, mode: 'class', feature: '', ref: false, r0: 0, r1: 4, idw: true, power: 2 },
    view: { core: null, tab: 'logs', clf: null, clfTarget: null, showEmpty: true },
  };
}

/** Project data (any version) → current structure. V9 files had a flat label list; it becomes the "Events" layer. */
export function normalizeGeo(pg = {}) {
  const gd = defaultGeo(), g = { ...gd, ...pg };
  g.settings = { ...gd.settings, ...(pg.settings || {}), params: { ...gd.settings.params, ...(pg.settings?.params || {}) } };
  g.map = { ...gd.map, ...(pg.map || {}) }; g.view = { ...gd.view, ...(pg.view || {}) };
  if (!pg.layers) {
    g.layers = pg.labels ? [{ id: 'events', name: gd.layers[0].name, parent: null, cats: pg.labels }] : gd.layers;
    g.intervals = (pg.intervals || []).map((q) => ({ ...q, layer: q.layer || 'events', cat: q.cat ?? q.label }));
    { const r = tidyIntervals(g.intervals, { newId: uid }); if (r.changed) { g.intervals = r.list; setTimeout(() => toast(t('iv.tidied')), 600); } }   // V0.34: older projects may have overlaps
    g.rules = (pg.rules || []).map((r) => ({ ...r, layer: r.layer || 'events', cat: r.cat ?? r.label }));
    g.activeCat = pg.activeLabel || g.layers[0].cats[0]?.id;
  }
  delete g.labels; delete g.activeLabel;
  g.classifiers = (pg.classifiers || []).map((c) => ({ ...classifierDefaults(), ...c, params: { ...(c.params || {}) } }));
  g.lastCat ||= {};
  return g;
}

export const geoRT = { samples: [], labels: [], preds: [], model: null, cv: null, dirty: true, featNames: [], orphans: new Set(), runs: new Map(), layerCols: new Map(), ruleLabels: new Map() };

/** Parameters shown for each method (help text in i18n: geo.p.<method>.<name>). */
const GEO_PARAMS = {
  mlp: [['hidden', 'select', ['8', '16', '32', '16,8', '32,16', '64,32']], ['activation', 'select', ['relu', 'tanh']], ['epochs', 'int', 20, 2000, 10], ['lr', 'float', 0.0005, 0.1, 0.0005], ['l2', 'float', 0, 0.1, 0.0001], ['batch', 'int', 4, 256, 4], ['balanced', 'bool'], ['patience', 'int', 5, 200, 5]],
  rf: [['trees', 'int', 10, 500, 10], ['maxDepth', 'int', 2, 30, 1], ['minLeaf', 'int', 1, 50, 1], ['mtry', 'select', ['sqrt', 'log2', 'all']], ['bins', 'int', 8, 128, 8], ['bootstrap', 'bool'], ['balanced', 'bool']],
  knn: [['k', 'int', 1, 50, 1], ['weights', 'select', ['distance', 'uniform']]],
  nb: [['smoothing', 'float', 1e-9, 0.1, 1e-6], ['priors', 'select', ['uniform', 'empirical']]],
  kmeans: [['k', 'int', 2, 12, 1], ['restarts', 'int', 1, 20, 1], ['maxIter', 'int', 10, 500, 10]],
};

const geoCore = (id) => S.cores.find((c) => c.id === id);
export const geoLayer = (id) => S.geo.layers.find((l) => l.id === id);
const geoLayerOf = (catId) => S.geo.layers.find((l) => l.cats.some((c) => c.id === catId));
export function geoCat(id) {
  if (id == null) return null;
  for (const l of S.geo.layers) { const c = l.cats.find((k) => k.id === id); if (c) return c; }
  if (id === '__ok') return { id, name: t('geo.testOk'), color: '#2e7d4f' };
  if (id === '__bad') return { id, name: t('geo.testBad'), color: '#c0392b' };
  if (/^G\d+$/.test(id)) return { id, name: S.geo.groupNames[id] || id, color: GROUP_COLORS[(parseInt(id.slice(1), 10) - 1) % GROUP_COLORS.length] };
  return null;
}
/** V0.34: every change to intervals keeps each family without overlaps and joins touching intervals of the same class. */
function tidyGeo(priority = geoSelIv) {
  const r = tidyIntervals(S.geo.intervals, { priority, newId: uid });
  if (!r.changed) return false;
  S.geo.intervals = r.list;
  if (geoSelIv && !r.list.some((q) => q.id === geoSelIv)) geoSelIv = null;
  return true;
}
export const geoMarkDirty = () => { tidyGeo(); geoRT.dirty = true; markDirty(); };
const shortTitle = (s, n = 9) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Layers in tree order (parents before children) with their depth in the hierarchy. */
function layerTree() {
  const out = [], L = S.geo.layers, seen = new Set();
  const walk = (parent, depth) => { for (const l of L) if ((l.parent || null) === parent && !seen.has(l.id)) { seen.add(l.id); out.push({ layer: l, depth }); walk(l.id, depth + 1); } };
  walk(null, 0);
  for (const l of L) if (!seen.has(l.id)) out.push({ layer: l, depth: 0 }); // broken parent links
  return out;
}
const isDescendant = (id, anc) => { for (let l = geoLayer(id); l?.parent; l = geoLayer(l.parent)) if (l.parent === anc) return true; return false; };

export function geoFigureVars(core, axis = S.geo.settings.axis) {
  if (!core) return [];
  const xs = axis === 'age' ? coreAges(core) : core.depth;
  return allNumericVars().filter((k) => featureSeries(core, k, S.geo.ratios)?.some((v, i) => v != null && xs?.[i] != null));
}
function allNumericVars() {
  const set = new Set();
  for (const c of S.cores) Object.keys(c.proxies).forEach((k) => set.add(k));
  for (const r of S.geo.ratios) set.add(`${r.a}/${r.b}`);
  return [...set];
}
/** Families (interval layers) that can feed a classifier: every one with classes and described intervals (V26: the pool; each classifier picks from it). */
function featLayers() {
  return S.geo.layers.filter((l) => l.cats.length && S.geo.intervals.some((q) => q.layer === l.id && !q.auto));
}

/* ── classifiers (V26): each one says what it classifies (one or more families), with what (variables and other families) and how (model) ── */
function classifierDefaults() {
  return { id: 'c' + uid(), name: '', targets: [], features: null, layers: null, method: 'rf', params: {}, minProb: 0.5, seed: 42, useRules: true, trained: null };
}
/** First classifier from the old single-model settings (files before V26 and the built-in examples). */
function ensureClassifiers() {
  const g = S.geo, st = g.settings;
  if (g.classifiers.length || g.clfCleared) return;
  const tgt = geoLayer(st.target) ? st.target : featLayers()[0]?.id; if (!tgt) return;
  g.classifiers.push({ ...classifierDefaults(), name: t('cl.default', { n: 1 }), targets: [tgt], layers: st.useLayers ?? null, method: st.method || 'rf', params: JSON.parse(JSON.stringify(st.params || {})), minProb: st.minProb ?? 0.5, seed: st.seed ?? 42, useRules: st.useRules !== false });
}
const curClf = () => S.geo.classifiers.find((c) => c.id === S.geo.view.clf) || S.geo.classifiers[0] || null;
/** Column indices of the sample matrix used by classifier c: its variables (default all of step 2) and the 0/1 columns of its input families. */
function clfCols(c) {
  const st = S.geo.settings, F = st.features, num = (c.features ?? F).map((k) => F.indexOf(k)).filter((j) => j >= 0);
  // V0.37: a target family never uses itself, its ancestors (e.g. "low oxygen" for "sapropel") or its descendants as input
  const rel = new Set(c.targets.flatMap(relatedLayers));
  const inputs = (c.layers ?? featLayers().map((l) => l.id)).filter((id) => !rel.has(id));
  return [...num, ...inputs.flatMap((id) => geoRT.layerCols?.get(id) || [])];
}
/** V0.37: the family itself, its ancestors and its descendants. */
function relatedLayers(id) {
  const L = S.geo.layers, out = new Set([id]);
  for (let p = L.find((l) => l.id === id)?.parent, n = 0; p && !out.has(p) && n < 50; p = L.find((l) => l.id === p)?.parent, n++) out.add(p);
  for (const l of L) if (isBelow(l.id, id)) out.add(l.id);
  return [...out];
}
function isBelow(a, b) { const L = S.geo.layers; for (let p = L.find((l) => l.id === a)?.parent, n = 0; p && n < 50; p = L.find((l) => l.id === p)?.parent, n++) if (p === b) return true; return false; }
/** Current position of the columns a model was trained on (by name, so adding families or variables does not invalidate it); null if one is gone. */
function modelIdx(m) {
  if (m.axis !== S.geo.settings.axis || m.scaling !== S.geo.settings.scaling) return null;
  const idx = m.colNames.map((n) => geoRT.featNames.indexOf(n));
  return idx.every((j) => j >= 0) ? idx : null;
}
/** Input vector of a sample for a trained model: numeric columns re-scaled with the statistics frozen at training (global z-score). */
function clfX(m, s, idx) { return m.transform ? transformSample(s, idx, m.nNum, m.transform) : idx.map((j, k) => (m.zmu && m.isNum[k] ? (s.t[j] == null ? 0 : (s.t[j] - m.zmu[k]) / m.zsd[k]) : s.f[j])); }
function predictRun(c) {
  const run = geoRT.runs.get(c.id); if (!run) return;
  for (const r of run.byTarget.values()) {
    if (!r.model) { r.preds = []; continue; }
    const idx = modelIdx(r.model); r.stale = !idx;
    r.preds = r.stale ? [] : geoRT.samples.map((s) => predictLabel(r.model, clfX(r.model, s, idx), r.model.kind === 'kmeans' ? 0 : c.minProb));
  }
}
function labelsFor(layerId, useRules = true) {
  const g = S.geo, st = g.settings;
  return labelSamples(geoRT.samples, { intervals: g.intervals, rules: g.rules, useRules, features: geoRT.featNames, axis: st.axis, cores: S.cores, layer: layerId });
}
/** Number of validation folds for a family: one per core with labels (≥ 2 cores) or 5 blocks. */
function foldsFor(labels) { const cores = new Set(geoRT.samples.filter((_, i) => labels[i].label).map((s) => s.core)); return cores.size >= 2 ? cores.size : Math.min(5, labels.filter((l) => l.label).length); }
/** Train classifier c on every family it targets; validation leaving one core out (or by blocks). tick(text) is awaited between steps. */
async function trainClassifier(c, tick = async () => {}) {
  const g = S.geo, st = g.settings, method = c.method, params = { ...METHODS[method].defaults, ...(c.params?.[method] || {}) }, seed = c.seed ?? 42;
  const cols = clfCols(c), run = { byTarget: new Map(), cols, at: Date.now(), held: [...holdoutIds()].sort().join() };
  if (!cols.length) { run.error = 'cl.noInputs'; geoRT.runs.set(c.id, run); return run; }
  const view = geoRT.samples.map((s) => ({ core: s.core, x: s.x, f: cols.map((j) => s.f[j]), t: cols.map((j) => s.t[j]) }));
  const rescale = st.scaling === 'global' ? cols.map((j) => j < geoRT.nNum) : null;   // V0.37: scaling refitted in each fold
  for (const lid of c.targets) {
    const L = geoLayer(lid); if (!L) continue;
    // V0.49: intervals of reserved cores (final test) are hidden from training and cross-validation
    const held = holdoutIds(), all = labelsFor(lid, c.useRules !== false), labels = all.map((l, i) => (held.has(view[i].core) ? { label: null, source: null } : l));
    const idx = labels.map((l, i) => (l.label ? i : -1)).filter((i) => i >= 0);
    if (method !== 'kmeans' && new Set(idx.map((i) => labels[i].label)).size < 2) { run.byTarget.set(lid, { labels, preds: [], error: 'cl.needLabels' }); continue; }
    const trainIdx = method === 'kmeans' ? view.map((v, i) => held.has(v.core) ? -1 : i).filter((i) => i >= 0) : idx;
    if (!trainIdx.length) { run.byTarget.set(lid, { labels, preds: [], error: 'cl.needLabels' }); continue; }
    const transform = fitSampleTransform(trainIdx.map((i) => geoRT.samples[i]), geoRT.nNum, st.scaling);
    const X = trainIdx.map((i) => transformSample(geoRT.samples[i], cols, geoRT.nNum, transform)), y = method === 'kmeans' ? null : idx.map((i) => labels[i].label);
    const fit = fitModelSteps(method, X, y, params, seed); let fr;
    if (await tick(t('cl.pFit', { c: c.name, f: L.name }), 0, true)) return null;
    while (!(fr = fit.next()).done) if (await tick(t('cl.pFit', { c: c.name, f: L.name }) + ' · ' + t('cl.pEpoch', { e: fr.value.epoch, n: fr.value.epochs }), fr.value.epoch / fr.value.epochs, false)) return null;
    const model = fr.value;
    Object.assign(model, { cols, nNum: geoRT.nNum, colNames: cols.map((j) => geoRT.featNames[j]), isNum: cols.map((j) => j < geoRT.nNum), transform,
      scaling: st.scaling, axis: st.axis, target: lid, features: cols.map((j) => geoRT.featNames[j]), n: X.length });
    let cv = null;
    if (method !== 'kmeans') {
      const it = crossValidateSteps(view, labels.map((l) => l.label), method, params, seed, { scored: (i) => labels[i].source !== 'rule', minProb: c.minProb, rescale, impute: st.scaling === 'none' ? cols.map((j) => j < geoRT.nNum) : null });
      for (let r = it.next(); ; r = it.next()) { if (r.done) { cv = r.value; break; } const v = r.value; if (await tick(t('cl.pFold', { c: c.name, f: L.name, k: v.fold + 1, n: v.folds }) + (v.epoch ? ' · ' + t('cl.pEpoch', { e: v.epoch, n: v.epochs }) : ''), v.epoch ? v.epoch / v.epochs : 0, !v.epoch)) return null; }
    }
    run.byTarget.set(lid, { model, cv, labels, all, preds: [] });
  }
  geoRT.runs.set(c.id, run); predictRun(c);
  c.trained = { at: new Date().toISOString(), n: [...run.byTarget.values()].reduce((a, r) => a + (r.model?.n || 0), 0) };
  return run;
}
/** Expose the selected classifier/family as geoRT.model/preds/cv/labels (used by the map, the core test and the CSV export). */
function syncCurrent() {
  const c = curClf(), st = S.geo.settings;
  const tgt = c && (c.targets.includes(S.geo.view.clfTarget) ? S.geo.view.clfTarget : c.targets[0]);
  const r = c && tgt ? geoRT.runs.get(c.id)?.byTarget.get(tgt) : null;
  geoRT.model = r?.model || null; geoRT.preds = r?.preds || []; geoRT.cv = r?.cv || null;
  geoRT.labels = r?.labels || (tgt ? labelsFor(tgt, c?.useRules !== false) : geoRT.samples.map(() => ({ label: null, source: null })));
  if (tgt) st.target = tgt;
  if (c) { st.method = c.method; st.minProb = c.minProb; st.seed = c.seed; st.params[c.method] = c.params?.[c.method] || {}; }
}

export function geoComputeSamples() {
  refreshAllCores();
  const g = S.geo, st = g.settings;
  ensureClassifiers();
  if (!st.features.length && !featLayers().length) st.features = allNumericVars().filter((k) => S.cores.some((c) => (c.proxies[k] || []).some((v) => v != null))).slice(0, 12);
  const layers = featLayers();
  geoRT.samples = buildSamples(S.cores, { axis: st.axis, step: st.step, features: st.features, ratios: g.ratios, logs: st.logs, scaling: st.scaling, maxGap: st.maxGap, layers, intervals: g.intervals, missing: st.missing });
  geoRT.featNames = [...st.features, ...layerFeatureNames(layers)];
  geoRT.nNum = st.features.length;
  geoRT.layerCols = new Map(); let j = st.features.length;
  for (const l of layers) { geoRT.layerCols.set(l.id, l.cats.map((_, k) => j + k)); j += l.cats.length; }
  geoRT.ruleLabels = new Map(g.layers.filter((l) => g.rules.some((r) => r.layer === l.id && r.enabled !== false)).map((l) => [l.id, labelsFor(l.id, true)]));
  geoRT.orphans = new Set(orphanIntervals(g.intervals, g.layers, S.cores));
  geoRT.dirty = false; geoRT.test = null;
  for (const c of g.classifiers) predictRun(c);
  syncCurrent();
}

export function geoReset() { Object.assign(geoRT, { samples: [], labels: [], preds: [], model: null, cv: null, dirty: true, featNames: [], orphans: new Set(), runs: new Map(), layerCols: new Map(), ruleLabels: new Map() }); }

/* ── V27: training runs in steps (one model fit or one validation fold each) with a visible progress bar and Cancel ── */
let geoTraining = null;
function trainProgress(on, frac = 0, text = '') {
  for (const el of document.querySelectorAll('.tprog')) { el.hidden = !on; const bar = el.querySelector('i'); if (bar) bar.style.width = `${Math.round(frac * 100)}%`; const tx = el.querySelector('.tptext'); if (tx) tx.textContent = text; el.setAttribute('aria-valuenow', String(Math.round(frac * 100))); }
  document.querySelectorAll('#geoTrainBtn, #clfList [data-c=train], #geoModelTrain').forEach((b) => (b.disabled = on));
  $('geoTrainState').hidden = on;
}
/** Train every classifier (or only the one given). */
export async function geoTrain(silent = false, only = null) {
  if (geoTraining) { if (!silent) toast(t('cl.busy')); return; }
  geoComputeSamples();
  if (!geoRT.samples.length || !geoRT.featNames.length) { if (!silent) toast(t('geo.noSamples')); return; }
  const list = only ? S.geo.classifiers.filter((c) => c.id === only) : S.geo.classifiers;
  if (!list.length) { if (!silent) toast(t('cl.none')); return; }
  // total steps: per classifier and family, 1 fit + the validation folds
  let total = 0;
  for (const c of list) for (const lid of c.targets) { if (!geoLayer(lid)) continue; const lab = labelsFor(lid, c.useRules !== false); total += 1 + (c.method === 'kmeans' ? 0 : foldsFor(lab)); }
  const job = (geoTraining = { cancel: false, done: 0, total: Math.max(1, total), t0: performance.now() });
  // tick(text, partial, newStep): newStep moves to the next of the total steps; partial = fraction of the current step.
  // The page is given a frame at most every 60 ms, so progress is visible and Cancel works without slowing training.
  let last = 0;
  const tick = async (text, partial = 0, newStep = true) => {
    if (newStep && job.started) job.done++;
    job.started = true;
    const frac = Math.min(1, (job.done + Math.min(0.99, partial)) / job.total), now = performance.now();
    if (now - last < 60) return job.cancel;
    last = now;
    const el = (now - job.t0) / 1000, eta = frac > 0.02 ? (el / frac) * (1 - frac) : null;
    trainProgress(true, frac, `${text}${eta != null && el > 1.5 ? ' · ' + t('cl.eta', { s: Math.max(1, Math.round(eta)) }) : ''}`);
    await new Promise((r) => setTimeout(r, 0));
    return job.cancel;
  };
  const problems = [];
  try {
    for (const c of list) {
      const run = await trainClassifier(c, tick);
      if (!run) break;   // cancelled
      if (run.error) problems.push(`${c.name}: ${t(run.error)}`);
      for (const [lid, r] of run.byTarget) if (r.error) problems.push(`${c.name} · ${geoLayer(lid)?.name}: ${t(r.error)}`);
    }
  } finally { geoTraining = null; trainProgress(false); }
  syncCurrent();
  if (!job.cancel) S.geo.trained = { at: new Date().toISOString() };
  if (!silent) { markDirty(); toast(job.cancel ? t('cl.cancelled') : problems.length ? problems.join(' · ') : t('cl.doneIn', { s: fmt((performance.now() - job.t0) / 1000, 2) })); }
  renderGeo(); scheduleLog();
}

// version tag everywhere it can be read (V27)

/* ── left panel ── */
function geoCoreNote(c) {
  const st = S.geo.settings, n = geoRT.samples.filter((x) => x.core === c.id).length;
  const miss = st.features.filter((k) => !(featureSeries(c, k, S.geo.ratios) || []).some((v) => v != null));
  const ni = S.geo.intervals.filter((q) => q.core === c.id).length;
  let s = `${(c.depth || c.age || []).length} ${t('log.points')} · ${Object.keys(c.proxies).length} ${t('geo.vars')} · ${ni} ${t('geo.ivs')} · ${t('geo.nSamples', { n })}`;
  if (!c.age && !c.ageText) s += ' · ' + t('geo.noAge');
  if (!c.depth && !c.age) s += ' · ' + t('geo.noAxisData');
  if (miss.length) s += ' · ' + t(st.missing === 'mean' ? 'geo.missingMean' : 'geo.missing', { f: miss.join(', ') });
  return esc(s);
}

/** One-line state of each step, shown in its header so a closed step still tells what it holds (V25). */
function renderGeoSummaries() {
  const g = S.geo, st = g.settings, L = geoLayer(st.target);
  const set = (id, txt) => { const el = $(id); if (el) { el.textContent = txt; el.title = txt; } };
  set('geoSum1', t('home.cores', { n: S.cores.length }));
  set('geoSum2', `${t('gx.nVars', { n: st.features.length })} · ${t(st.axis === 'age' ? 'log.age' : 'log.depth')} ${fmt(st.step, 3)}`);
  set('geoSum3', `${t('gx.nLayers', { n: g.layers.length })} · ${t('gx.nIvs', { n: g.intervals.filter((q) => !q.auto).length })}`);
  set('geoSum4', t('cl.nClf', { n: g.classifiers.length }));
  const c = curClf(), ts = $('geoTrainState'); if (ts) ts.textContent = c ? `${c.name}: ${clfState(c).txt}` : t('cl.empty');
}
function renderGeoPanel() {
  const g = S.geo, st = g.settings, vars = allNumericVars();
  if (!geoLayer(g.activeLayer)) g.activeLayer = g.layers[0]?.id;
  const L = geoLayer(g.activeLayer);
  if (L && !L.cats.some((c) => c.id === g.activeCat)) g.activeCat = L.cats[0]?.id;
  // V25: compact table of cores (name · lat · lon · variables/intervals), full details on hover
  $('geoCores').innerHTML = S.cores.length ? `<table class="gctab"><thead><tr><th>${t('geo.core')}</th><th>Lat</th><th>Lon</th><th title="${esc(t('gx.tip.vi'))}">${t('gx.vi')}</th><th></th></tr></thead><tbody>${S.cores.map((c) => {
    const ni = g.intervals.filter((q) => q.core === c.id).length, nv = Object.keys(c.proxies || {}).length, note = geoCoreNote(c), bad = (!c.age && !c.ageText) || st.features.some((k) => !(featureSeries(c, k, g.ratios) || []).some((v) => v != null));
    return `<tr class="gcore ${c.id === g.view.core ? 'current' : ''}" data-id="${esc(c.id)}"><td><button class="gcname" data-tip="${note}">${esc(c.name)}</button></td>
      <td><input type="number" step="any" data-k="lat" value="${esc(c.lat ?? '')}" aria-label="lat ${esc(c.name)}"></td><td><input type="number" step="any" data-k="lon" value="${esc(c.lon ?? '')}" aria-label="lon ${esc(c.name)}"></td>
      <td><span class="gcn ${bad ? 'warn' : ''}" data-tip="${note}">${nv} · ${ni}</span></td><td><button class="btn small ghost" data-act="del" data-tip="${esc(t('gx.tip.coreDlg'))}" aria-label="${esc(t('gx.tip.coreDlg'))}">✎</button></td></tr>`;
  }).join('')}</tbody></table>` : `<p class="note">${t('geo.noCores')}</p>`;
  renderGeoSummaries();
  $('geoMissing').value = st.missing || 'drop';
  $('geoAxis').value = st.axis; $('geoStep').value = st.step; $('geoScaling').value = st.scaling; $('geoMaxGap').value = st.maxGap ?? '';
  $('geoFeats').innerHTML = vars.map((k) => `<div class="row srow"><label class="chk"><input type="checkbox" data-feat="${esc(k)}" ${st.features.includes(k) ? 'checked' : ''}><span>${esc(k)}</span></label><label class="chk note"><input type="checkbox" data-log="${esc(k)}" ${st.logs.includes(k) ? 'checked' : ''}>log</label></div>`).join('') || `<p class="note">—</p>`;
  const opts = vars.map((k) => `<option>${esc(k)}</option>`).join('');
  $('geoRatioA').innerHTML = opts; $('geoRatioB').innerHTML = opts;
  // layers
  const tree = layerTree();
  { const id = 'band:fam:' + g.activeLayer, hidden = (S.geo.view.style?.colHide || []).includes(id);   // V0.33: family visible in the charts
    $('geoLayerShow').checked = !hidden; }
  $('geoLayerSel').innerHTML = tree.map(({ layer, depth }) => `<option value="${esc(layer.id)}" ${layer.id === g.activeLayer ? 'selected' : ''}>${'  '.repeat(depth)}${depth ? '↳ ' : ''}${esc(layer.name)}</option>`).join('');
  $('geoLayerName').value = L?.name || '';
  $('geoLayerParent').innerHTML = `<option value="">${t('geo.noParent')}</option>` + g.layers.filter((l) => L && l.id !== L.id && !isDescendant(l.id, L.id)).map((l) => `<option value="${esc(l.id)}" ${l.id === L?.parent ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
  const resizeName = esc(t('gx.resizeClassName'));
  $('geoLabels').innerHTML = (L?.cats || []).map((c, i) => `<li data-id="${esc(c.id)}" class="${c.id === g.activeCat ? 'active' : ''}">
    <input type="color" value="${esc(validHexColor(c.color, GROUP_COLORS[i % GROUP_COLORS.length]))}" aria-label="${esc(t('mp.color'))}">
    <input class="name" type="text" value="${esc(c.name)}" title="${esc(c.name)}" aria-label="${esc(t('geo.cats'))}">
    <button class="geo-name-handle" type="button" ${i ? 'tabindex="-1"' : ''} title="${resizeName}" aria-label="${resizeName}"></button>
    <span class="cnt" title="${esc(t('gx.tip.catCount'))}">${g.intervals.filter((q) => q.cat === c.id).length}</span>
    <button class="del" title="${esc(t('gx.delCat'))}" aria-label="${esc(t('gx.delCat'))}">✕</button></li>`).join('');
  const lopts = (sel) => (L?.cats || []).map((c) => `<option value="${esc(c.id)}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const names = geoRT.featNames.length ? geoRT.featNames : st.features;
  const fopts = (sel) => names.map((k) => `<option ${k === sel ? 'selected' : ''}>${esc(k)}</option>`).join('');
  const rules = g.rules.map((r, ri) => [r, ri]).filter(([r]) => r.layer === g.activeLayer);
  $('geoRules').innerHTML = rules.map(([r, ri]) => `<div class="rec rule" data-r="${esc(ri)}">
      <div class="row" style="flex-wrap:nowrap"><label class="chk"><input type="checkbox" data-k="enabled" ${r.enabled !== false ? 'checked' : ''}></label><select data-k="cat">${lopts(r.cat)}</select><button class="btn small ghost" data-act="delrule">✕</button></div>
      ${r.conds.map((c, ci) => `<div class="row cond" data-c="${esc(ci)}" style="flex-wrap:nowrap"><select data-k="feature">${fopts(c.feature)}</select><select data-k="op">${['z>', 'z<', '>', '<'].map((o) => `<option ${o === c.op ? 'selected' : ''}>${o}</option>`).join('')}</select><input type="number" step="any" data-k="value" value="${esc(c.value)}"><button class="btn small ghost" data-act="delcond">✕</button></div>`).join('')}
      <button class="btn small" data-act="addcond">${t('geo.addCond')}</button></div>`).join('') || `<p class="note">${t('geo.noRules')}</p>`;
  $('geoUseRules').checked = st.useRules;
  renderClassifiers();
}

/* ── V26: list of classifiers (step 4) ── */
const CLF_METHODS = ['rf', 'mlp', 'knn', 'nb', 'kmeans'];
function clfState(c) {
  const run = geoRT.runs.get(c.id);
  if (!run) return { cls: '', txt: c.trained ? t('cl.retrainNeeded') : t('gx.untrained') };
  if (run.error) return { cls: 'warn', txt: t(run.error) };
  if (run.outdated) return { cls: 'warn', txt: t('cl.changed') };
  const rs = [...run.byTarget.values()];
  if (rs.some((r) => r.stale)) return { cls: 'warn', txt: t('cl.stale') };
  const acc = rs.map((r) => r.cv?.balancedAccuracy).filter((v) => v != null);
  if (rs.every((r) => r.error)) return { cls: 'warn', txt: t('cl.needLabels') };
  return { cls: 'ok', txt: acc.length ? t('cl.acc', { a: fmt((100 * acc.reduce((x, y) => x + y, 0)) / acc.length, 0) }) : t('gx.trained', { m: t('geo.m.name.' + c.method) }) };
}
function renderClassifiers() {
  const g = S.geo, cur = curClf(), fams = layerTree().map((x) => x.layer), vars = g.settings.features;
  const wasOpen = [...$('clfList').querySelectorAll('.clf.sel details')].map((d) => d.open), wasId = $('clfList').querySelector('.clf.sel')?.dataset.id;
  const nDesc = (lid) => g.intervals.filter((q) => q.layer === lid && !q.auto).length;
  $('clfList').innerHTML = g.classifiers.map((c) => {
    const sel = c === cur, stt = clfState(c);
    let html = `<section class="clf ${sel ? 'sel' : ''}" data-id="${esc(c.id)}"><header data-c="sel" title="${esc(t('cl.tip.sel'))}"><b>⚙ ${esc(c.name || t('cl.unnamed'))}</b><span class="clfstate ${esc(stt.cls)}">${esc(stt.txt)}</span></header>`;
    if (!sel) return html + '</section>';
    const fv = c.features ?? vars, inFams = fams.filter((l) => !c.targets.includes(l.id)), fl = c.layers ?? featLayers().map((l) => l.id);
    const p = { ...METHODS[c.method].defaults, ...(c.params?.[c.method] || {}) };
    const params = GEO_PARAMS[c.method].map(([k, type, a, b, step]) => {
      const lab = `${c.method}.${k}`, name = t(lab) === lab ? k : t(lab), help = t(`geo.p.${c.method}.${k}`), tip = help === `geo.p.${c.method}.${k}` ? '' : ` title="${esc(help)}"`;
      if (type === 'bool') return `<label class="chk"${tip}><input type="checkbox" data-p="${esc(k)}" ${p[k] ? 'checked' : ''}><span>${esc(name)}</span></label>`;
      if (type === 'select') return `<label class="f"${tip}><span>${esc(name)}</span><select data-p="${esc(k)}">${a.map((o) => `<option ${String(o) === String(p[k]) ? 'selected' : ''}>${o}</option>`).join('')}</select></label>`;
      return `<label class="f"${tip}><span>${esc(name)}</span><input type="number" data-p="${esc(k)}" min="${esc(a)}" max="${esc(b)}" step="${esc(step)}" value="${esc(p[k])}"></label>`;
    }).join('');
    const run = geoRT.runs.get(c.id);
    const res = c.targets.map((lid) => { const r = run?.byTarget.get(lid), L = geoLayer(lid); if (!L) return ''; const cv = r?.cv;
      return `<div>${esc(L.name)}: ${r?.error ? `<span class="warn">${t(r.error)}</span>` : cv ? t('cl.res', { a: fmt(cv.balancedAccuracy * 100, 0), n: cv.total, k: cv.classes.length }) : r?.model ? t('gx.trained', { m: '' }) : t('gx.untrained')}</div>`; }).join('');
    html += `<div class="clfbody">
      <label class="f"><span>${t('cl.name')}</span><input type="text" data-c="name" value="${esc(c.name)}"></label>
      <div class="f" title="${esc(t('cl.tip.targets'))}"><span>${t('cl.targets')}</span><div class="chips">${fams.map((l) => `<label><input type="checkbox" data-c="target" value="${esc(l.id)}" ${c.targets.includes(l.id) ? 'checked' : ''}>${esc(l.name)} <span class="note">${nDesc(l.id)}</span></label>`).join('') || `<span class="note">${t('cl.noFams')}</span>`}</div></div>
      <div class="f" title="${esc(t('cl.tip.inputs'))}"><span>${t('cl.inputs')}</span>
        <details><summary>${t('cl.inVars', { n: fv.filter((k) => vars.includes(k)).length, m: vars.length })}</summary><div class="row"><button class="btn small ghost" data-c="vall">${t('cl.all')}</button><button class="btn small ghost" data-c="vnone">${t('cl.none2')}</button></div>
          <div class="chk2">${vars.map((k) => `<label class="chk"><input type="checkbox" data-c="feat" value="${esc(k)}" ${fv.includes(k) ? 'checked' : ''}><span>${esc(k)}</span></label>`).join('') || `<span class="note">${t('cl.noVars')}</span>`}</div></details>
        <details><summary>${t('cl.inFams', { n: inFams.filter((l) => fl.includes(l.id)).length })}</summary><div class="chk2">${inFams.map((l) => `<label class="chk"><input type="checkbox" data-c="lay" value="${esc(l.id)}" ${fl.includes(l.id) ? 'checked' : ''}><span>${esc(l.name)}</span></label>`).join('') || `<span class="note">${t('cl.noOtherFams')}</span>`}</div><p class="note">${t('cl.famsNote')}</p></details></div>
      <div class="f"><span>${t('cl.model')}</span><div class="clfmodels">${CLF_METHODS.map((m) => `<label title="${esc(t('geo.m.' + m))}"><input type="radio" name="clfm-${esc(c.id)}" data-c="method" value="${esc(m)}" ${m === c.method ? 'checked' : ''}><span><b>${t('geo.m.name.' + m)}</b><span class="note">${t('cl.m.' + m)}</span></span></label>`).join('')}</div></div>
      <details><summary>${t('cl.advanced')}</summary><div class="gparams">${params}
        ${c.method === 'kmeans' ? '' : `<label class="f" title="${esc(t('gx.tip.minProb'))}"><span>${t('geo.minProb')}</span><input type="number" data-c="minProb" min="0" max="1" step="0.05" value="${esc(c.minProb)}"></label>`}
        <label class="f" title="${esc(t('gx.tip.seed'))}"><span>${t('geo.seed')}</span><input type="number" data-c="seed" step="1" value="${esc(c.seed)}"></label>
        <label class="chk" title="${esc(t('gx.tip.rules'))}"><input type="checkbox" data-c="useRules" ${c.useRules !== false ? 'checked' : ''}><span>${t('geo.useRules')}</span></label>
        <button class="btn small" data-c="defaults" title="${esc(t('gx.tip.suggest'))}">${t('cl.defaults')}</button></div></details>
      <div class="clfres">${res}</div>
      <div class="row"><button class="btn small primary" data-c="train" title="${esc(t('gx.tip.train'))}">${t('cl.train')}</button><button class="btn small" data-c="results">${t('cl.results')}</button><button class="btn small ghost" data-c="del">${t('proj.del')}</button></div>
    </div></section>`;
    return html;
  }).join('') || `<p class="note">${t('cl.empty')}</p>`;
  if (wasId && wasId === cur?.id) $('clfList').querySelectorAll('.clf.sel details').forEach((d, i) => { if (wasOpen[i]) d.open = true; });
}
function newClassifier(base = null) {
  const g = S.geo, n = g.classifiers.length + 1;
  const c = base ? { ...JSON.parse(JSON.stringify(base)), id: 'c' + uid(), name: t('cl.copyOf', { n: base.name }), trained: null }
    : { ...classifierDefaults(), name: t('cl.default', { n }), targets: [featLayers()[0]?.id || g.layers[0]?.id].filter(Boolean) };
  g.classifiers.push(c); g.view.clf = c.id; g.clfCleared = false; markDirty(); renderGeoPanel(); renderGeo();
}

const clfOutdated = (c) => { const r = geoRT.runs.get(c.id); if (r) r.outdated = true; };

function addCat(layer, name) {
  const c = { id: 'k' + uid(), name, color: GROUP_COLORS[(S.geo.layers.reduce((n, l) => n + l.cats.length, 0)) % GROUP_COLORS.length] };
  layer.cats.push(c); return c;
}
function addLayer(name, parent = null) { const l = { id: 'L' + uid(), name, parent, cats: [] }; S.geo.layers.push(l); return l; }

/** Store a core read from a table as imported data of a project core (merging with a core of the same name). */
export function addImported(c, source, id = null) {
  const imp = { depth: c.depth, age: c.age, proxies: c.proxies };
  let core = S.cores.find((o) => (id && o.id === id) || norm(o.name) === norm(c.name));
  if (core) {
    if (core.imp && !!core.imp.depth !== !!imp.depth) {
      const merged = mergeMixedImports(core.imp, imp, core.ageModel?.model);
      if (!merged) return null;
      core.imp = merged;
    }
    else if (core.imp && !core.imp.depth && !imp.depth && core.imp.age && imp.age) core.imp = mergeAgeImports(core.imp, imp);
    else if (core.imp && core.imp.depth && imp.depth && core.imp.depth.length === imp.depth.length && core.imp.depth.every((d, i) => d === imp.depth[i])) core.imp.proxies = { ...core.imp.proxies, ...imp.proxies };
    else if (core.imp) { // different depths: keep both as one table on the union of rows
      const rows = [...(core.imp.depth || []).map((d, i) => ({ d, a: core.imp.age?.[i], v: core.imp.proxies, i })), ...(imp.depth || []).map((d, i) => ({ d, a: imp.age?.[i], v: imp.proxies, i }))].sort((x, y) => x.d - y.d);
      const names = [...new Set([...Object.keys(core.imp.proxies), ...Object.keys(imp.proxies)])], P = {};
      for (const n of names) P[n] = rows.map((r) => r.v[n]?.[r.i] ?? null);
      core.imp = { depth: rows.map((r) => r.d), age: rows.some((r) => r.a != null) ? rows.map((r) => r.a ?? null) : null, proxies: P };
    } else if (!imp.depth && imp.age && core.depth?.length) {
      const merged = mergeMixedImports({ depth: [], age: null, proxies: {} }, imp, core.ageModel?.model);
      if (!merged) return null;
      core.imp = merged;
    } else core.imp = imp;
    if (c.lat != null) core.lat = c.lat; if (c.lon != null) core.lon = c.lon;
  } else { core = makeCore({ id: id || undefined, name: c.name, lat: c.lat, lon: c.lon, source, imp, units: c.units, age: { text: c.ageText || '' } }); S.cores.push(core); }
  if (c.ageText) { core.ageModel.text = c.ageText; core.ageModel.model = parseAgeModel(c.ageText); }
  if (c.units) core.units = c.units;
  core.source ||= source;
  refreshCoreData(core);
  return core;
}

/* ── import: numeric records ── */
let geoPending = null;
const IMP_IDS = ['giCore', 'giLat', 'giLon', 'giDepth', 'giAge', 'giWd', 'giFrom', 'giTo', 'giLayer'];
function openGeoImport(kind, tabs, names) {
  const tab = tabs[0], H = tab.headers, guess = (re) => H.findIndex((h) => re.test(h));
  geoPending = { kind, tabs, names };
  const sel = (id, i) => { $(id).innerHTML = `<option value="-1">—</option>` + H.map((h, k) => `<option value="${esc(k)}" ${k === i ? 'selected' : ''}>${esc(h)}</option>`).join(''); };
  sel('giCore', guess(/^(core|sondeo|site|hole|station|name|id)/i)); sel('giLat', guess(/lat/i)); sel('giLon', guess(/lon|long/i));
  sel('giDepth', guess(/depth|prof|mbsf|csf|mcd/i)); sel('giAge', guess(/age|edad|\bka\b|cal/i)); sel('giWd', guess(/water|agua|wd/i));
  sel('giFrom', guess(/top|techo|from|desde|inicio|start/i)); sel('giTo', guess(/bot|base|muro|to$|hasta|fin|end/i)); sel('giLayer', guess(/^(layer|capa|tipo|type)$/i));
  const iv = kind === 'intervals';
  for (const [id, show] of [['giCoreRow', kind !== 'core'], ['giLatLonRow', !iv], ['giDepthRow', kind === 'long' || kind === 'core'], ['giWdRow', kind === 'catalogue'],
    ['giProxRow', kind === 'long' || kind === 'core'], ['giIvRow', iv], ['giValRow', iv], ['giDefRow', iv]]) $(id).hidden = !show;
  $('giDefCore').innerHTML = S.cores.map((c) => `<option value="${esc(c.id)}" ${c.id === S.geo.view.core ? 'selected' : ''}>${esc(c.name)}</option>`).join('') + `<option value="__file">${t('geo.r.byFile')}</option>`;
  const fill = () => {
    const used = IMP_IDS.filter((id) => !$(id).closest('[hidden]')).map((id) => +$(id).value);
    if (iv) {
      $('giVals').innerHTML = H.map((h, k) => used.includes(k) ? '' : `<label class="chk"><input type="checkbox" value="${esc(k)}" ${tab.rows.every((r) => r[k] == null) && tab.text.some((r) => String(r[k] ?? '').trim()) ? 'checked' : ''}><span>${esc(h)}</span></label>`).join('');
      $('giValNote').textContent = +$('giLayer').value >= 0 ? t('geo.r.valLong') : t('geo.r.valWide');
    } else $('giProx').innerHTML = H.map((h, k) => used.includes(k) ? '' : `<label class="chk"><input type="checkbox" value="${esc(k)}" ${tab.rows.some((r) => r[k] != null) ? 'checked' : 'disabled'}><span>${esc(h)}</span></label>`).join('');
  };
  IMP_IDS.forEach((id) => ($(id).onchange = fill)); fill();
  renderImportReport($('giReport'), tab, (next) => { tabs[0] = next; openGeoImport(kind, tabs, names); });   // card Q2
  $('giTitle').textContent = t('geo.imp.' + kind) + (names.length > 1 ? ` (${names.length})` : '');
  $('giNote').textContent = t(iv ? 'geo.r.noteIv' : 'geo.r.note');
  $('geoImpDlg').showModal();
}
/** V0.38: table file (CSV/TXT as UTF-8 or Windows-1252, or Excel/ODS); warns about text cells read as empty. */
export async function readTableFile(f) {
  let textOf, sheets = [];
  if (/\.xlsx?$|\.ods$/i.test(f.name)) {
    if (!window.XLSX) await loadLib('xlsx.full.min.js');
    const X = /** @type {any} */ (window).XLSX, wb = X.read(await f.arrayBuffer(), { type: 'array' });
    sheets = wb.SheetNames;
    // card Q2: the stored numbers, not the text the sheet's format shows (12.3456 shown as 12.35)
    textOf = (sheet) => X.utils.sheet_to_csv(wb.Sheets[sheets[sheet] ?? sheets[0]], { FS: '\t', rawNumbers: true });
  } else { const text = decodeText(await f.arrayBuffer()); textOf = () => text; }
  /** Card Q2: the same file read again with another sheet or another rule for values below a detection limit. */
  const read = (/** @type {{sheet?: number, censored?: any}} */ { sheet = 0, censored = 'empty' } = {}) => Object.assign(parseTable(textOf(sheet), { censored }), { file: f.name, sheets, sheet, censoredRule: censored, read });
  return read();
}
/** Card Q2: what the reader did with the file, in the user's words (one entry per kind of change, none when nothing was changed). */
export function importNotes(tab) {
  return [
    tab.sheets?.length > 1 ? t('imp.sheetOf', { s: tab.sheets[tab.sheet], n: tab.sheets.length }) : '',
    tab.preamble ? t('imp.preamble', { n: tab.preamble }) : '',
    tab.missingCodes ? t('imp.missing', { n: tab.missingCodes }) : '',
    tab.censored ? t('imp.censored.' + (tab.censoredRule || 'empty'), { n: tab.censored }) : '',
    tab.dropped ? t('imp.dropped', { n: tab.dropped, c: tab.droppedCols.slice(0, 4).join(', ') }) : '',
    tab.ambiguousCols?.length ? t('imp.ambiguous', { c: tab.ambiguousCols.slice(0, 4).join(', ') }) : '',
    tab.renamed?.length ? t('imp.renamed', { c: tab.renamed.slice(0, 4).join(', ') }) : '',
    tab.short ? t('imp.short', { r: tab.short }) : '',
    tab.long ? t('imp.long', { r: tab.long }) : '',
  ].filter(Boolean);
}
/**
 * Card Q2: the import report inside an import dialog: what the reader changed, the sheet and the rule for values below a detection limit
 * when they matter (changing them reads the file again and calls `onRead` with the new table), and the first rows as they were read.
 * @param {HTMLElement} box @param {any} tab @param {(tab: any) => void} onRead
 */
export function renderImportReport(box, tab, onRead) {
  const notes = importNotes(tab), rows = tab.rows.slice(0, 5);
  const cell = (v, raw) => (v == null ? (String(raw ?? '').trim() ? `<i title="${esc(raw)}">—</i>` : '') : esc(String(v)));
  box.innerHTML = `
    ${notes.length ? `<ul class="impnotes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : `<p class="note">${t('imp.clean')}</p>`}
    <div class="row">
      ${tab.sheets?.length > 1 ? `<label class="f"><span>${t('imp.sheet')}</span><select data-imp="sheet">${tab.sheets.map((s, k) => `<option value="${esc(k)}" ${k === tab.sheet ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>` : ''}
      ${tab.censored ? `<label class="f"><span>${t('imp.censoredRule')}</span><select data-imp="censored">${['empty', 'half', 'limit'].map((r) => `<option value="${esc(r)}" ${r === tab.censoredRule ? 'selected' : ''}>${t('imp.rule.' + r)}</option>`).join('')}</select></label>` : ''}
    </div>
    <div class="imppreview"><table><thead><tr>${tab.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r, i) => `<tr>${r.map((v, k) => `<td>${cell(v, tab.text[i]?.[k])}</td>`).join('')}</tr>`).join('')}</tbody></table>
      <p class="note">${t('imp.previewNote', { n: rows.length, m: tab.rows.length })}</p></div>`;
  box.querySelectorAll('select[data-imp]').forEach((/** @type {any} */ select) => select.addEventListener('change', () => {
    const value = /** @type {HTMLSelectElement} */ (select).value;
    const next = tab.read({ sheet: select.dataset.imp === 'sheet' ? +value : tab.sheet, censored: select.dataset.imp === 'censored' ? value : tab.censoredRule });
    onRead(next);
  }));
}

const norm = (s) => String(s ?? '').trim().toLowerCase();
function findOrAddCore(name) {
  let c = S.cores.find((k) => norm(k.name) === norm(name));
  if (!c) { c = makeCore({ name, source: 'import' }); S.cores.push(c); renderCoreBar(); }
  return c;
}
/** Add intervals given by names (core, layer, value); creates missing cores, layers and categories. */
export function addNamedIntervals(recs, axis) {
  const g = S.geo, newLayers = new Set();
  for (const r of recs) {
    let L = g.layers.find((l) => norm(l.name) === norm(r.layer));
    if (!L) { L = addLayer(r.layer); newLayers.add(L.id); }
    const cat = L.cats.find((c) => norm(c.name) === norm(r.value)) || addCat(L, r.value), core = findOrAddCore(r.core).id;
    const dup = g.intervals.some((q) => q.core === core && q.layer === L.id && q.axis === axis && q.cat === cat.id && Math.abs(q.from - r.from) < 1e-9 && Math.abs(q.to - r.to) < 1e-9);
    if (!dup) g.intervals.push({ id: uid(), core, layer: L.id, axis, from: r.from, to: r.to, cat: cat.id });
  }
  tidyGeo(null);   // V0.34: imported intervals follow the same rule
  return newLayers.size;
}

export async function loadGeoDemo() {
  const tab = parseTable(await (await fetchAsset('geochem_demo/demo_long.csv')).text());
  const H = tab.headers, ix = (n) => H.indexOf(n), P = ['Ti/Al', 'Zr/Rb', 'Ba/Al', 'Mn/Al', 'Ca_pct', 'TOC_pct'];
  const g = S.geo, cores = coresFromLongTable(tab, { core: ix('core'), lat: ix('lat'), lon: ix('lon'), depth: ix('depth_m'), age: ix('age_ka'), proxies: P.map(ix) });
  S.cores = S.cores.filter((c) => c.source !== 'demo');
  for (const c of cores) addImported(c, 'demo', 'demo-' + c.name);
  renderCoreBar();
  g.intervals = g.intervals.filter((q) => !String(q.core).startsWith('demo-'));
  // Described intervals (lithology with nested turbidites), as a user would import them.
  const it = parseTable(await (await fetchAsset('geochem_demo/intervals.csv')).text()), jx = (n) => it.headers.indexOf(n);
  addNamedIntervals(intervalsFromTable(it, { core: jx('core'), from: jx('top_m'), to: jx('bottom_m'), layer: -1, values: [jx('Litologia'), jx('Turbidita')] }), 'depth');
  const lit = g.layers.find((l) => l.name === 'Litologia'), tb = g.layers.find((l) => l.name === 'Turbidita');
  if (lit && tb) tb.parent = lit.id;
  const st = g.settings; st.features = P; st.logs = P; st.axis = 'age'; st.step = 0.5; st.target = 'events'; st.useLayers = null;
  // Example expert labels (two cores per event, so leave-one-core-out always has each class) and one example rule.
  const want = { 'DEMO-02': ['detrital_input', 'detrital'], 'DEMO-12': ['detrital_input', 'detrital'], 'DEMO-09': ['low_oxygenation', 'lowox'], 'DEMO-14': ['low_oxygenation', 'lowox'], 'DEMO-01': ['strong_bottom_current', 'current'], 'DEMO-04': ['strong_bottom_current', 'current'] };
  const ev = geoLayer('events') || (g.layers.unshift(defaultGeo().layers[0]), g.layers[0]);
  const has = (id) => ev.cats.some((c) => c.id === id);
  const evIv = [];
  tab.text.forEach((r) => {
    const w = want[r[ix('core')]]; if (!w) return;
    const e = r[ix('event_true')], a = +r[ix('age_ka')];
    const cat = e === w[0] ? w[1] : e === 'background' ? 'background' : null;
    if (cat && has(cat)) evIv.push({ id: uid(), core: 'demo-' + r[ix('core')], layer: 'events', axis: 'age', from: a - 0.25, to: a + 0.25, cat });
  });
  g.intervals.push(...mergeIntervals(evIv)); tidyGeo(null);   // V0.34
  if (!g.rules.some((r) => r.layer === 'events')) g.rules.push({ id: uid(), layer: 'events', cat: 'lowox', enabled: true, conds: [{ feature: 'Ba/Al', op: 'z>', value: 1.5 }, { feature: 'Mn/Al', op: 'z<', value: -0.5 }] });
  g.view.core = 'demo-DEMO-09'; g.map = { ...g.map, a0: 6, a1: 10, mode: 'class' };
  geoMarkDirty(); geoTrain();
}

/** Join touching intervals of the same core, layer and category (keeps the list short). */
function mergeIntervals(list) {
  const out = [], key = (q) => `${q.core}|${q.layer}|${q.axis}|${q.cat}|${q.auto ? 1 : 0}`;
  for (const q of [...list].sort((a, b) => key(a).localeCompare(key(b)) || a.from - b.from)) {
    const p = out[out.length - 1];
    if (p && key(p) === key(q) && q.from <= p.to + 1e-9) p.to = Math.max(p.to, q.to); else out.push({ ...q });
  }
  return out;
}

/* ── centre: logs, map, model ── */
let geoTimer = 0, geoLast = null, geoDrag = null;
export function scheduleGeo(ms = 150) { if (mode !== 'geo') return; clearTimeout(geoTimer); geoTimer = setTimeout(renderGeo, ms); }
export function renderGeo() {
  if (mode !== 'geo') return;
  if (geoRT.dirty) geoComputeSamples();
  renderGeoPanel();
  document.querySelectorAll('#geoTabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === S.geo.view.tab)));
  document.querySelectorAll('.gpane').forEach((p) => (p.hidden = p.dataset.pane !== S.geo.view.tab));
  if (S.geo.view.tab === 'logs') {
    $('geoColumnsForm').replaceChildren();
    renderGeoLogs();
  } else if (S.geo.view.tab === 'map') renderGeoMap(); else renderGeoModel();
}

/** Contiguous runs of samples of one core with the same class, as band segments. */
function segmentsFor(coreId, getLabel, axis, step, opacity) {
  if (axis !== S.geo.settings.axis) {
    const runs = segmentsFor(coreId, getLabel, S.geo.settings.axis, step, opacity);
    return segmentsOnAxis(runs, S.geo.settings.axis, axis, geoCore(coreId));
  }
  const segs = []; let cur = null;
  geoRT.samples.forEach((s, i) => {
    if (s.core !== coreId) return;
    const l = getLabel(i), a = axis === S.geo.settings.axis ? s.x : axis === 'age' ? s.age : s.depth;
    const cat = geoCat(l);
    if (l == null || a == null || !cat) { cur = null; return; }
    const half = step / 2;
    if (cur && cur.label === l && Math.abs(a - half - cur.a1) < step * 0.51) cur.a1 = a + half;
    else { cur = { label: l, a0: a - half, a1: a + half, color: cat.color, opacity: opacity?.(i) }; segs.push(cur); }
  });
  return segs;
}
/** Band segments drawn straight from the intervals of one layer in one core. */
function intervalSegs(core, layerId, axis) {
  return intervalsOnAxis(S.geo.intervals.filter((q) => q.core === core.id && q.layer === layerId), axis, core)
    .map((q) => ({ label: q.cat, a0: q.from, a1: q.to, color: geoCat(q.cat)?.color || '#999', opacity: q.auto ? 0.45 : 1 }));
}
/** All bands of a core: one per interval layer (tree order) + rule labels of the target + automatic classification. */
/**
 * Columns of a core: one per family (described intervals; rule labels lighter) — empty ones too when showEmpty —
 * each followed by the automatic columns of the classifiers that target it (opacity = probability), then the core test.
 */
function coreBands(core, axis, withPred = true, showEmpty = false) {
  const g = S.geo, st = g.settings, bands = [];
  for (const { layer, depth } of layerTree()) {
    let segs = intervalSegs(core, layer.id, axis);
    const rl = geoRT.ruleLabels?.get(layer.id);
    if (rl) segs = segs.concat(segmentsFor(core.id, (i) => (rl[i]?.source === 'rule' ? rl[i].label : null), axis, st.step, () => 0.45));
    if (segs.length || showEmpty) bands.push({ title: (depth ? '↳ ' : '') + layer.name, full: layer.name, key: 'fam:' + layer.id, segs, w: 56 });
    if (!withPred) continue;
    for (const c of g.classifiers) {
      const r = geoRT.runs.get(c.id)?.byTarget.get(layer.id); if (!r?.preds?.length) continue;
      const name = `⚙ ${c.name}${c.targets.length > 1 ? ' · ' + layer.name : ''}`;
      const sg = segmentsFor(core.id, (i) => r.preds[i]?.label, axis, st.step, (i) => +(0.3 + 0.7 * (r.preds[i]?.prob ?? 1)).toFixed(2));
      if (sg.length || showEmpty) bands.push({ title: name, full: `${name} (${t('geo.m.name.' + c.method)})`, key: `auto:${c.id}:${layer.id}`, segs: sg, w: 56 });
    }
  }
  const T = geoRT.test;
  if (withPred && T?.core === core.id) {
    bands.push({ title: t('geo.bandTest'), key: 'test', segs: segmentsFor(core.id, (i) => T.preds[i]?.label, axis, st.step), w: 56 });
    const hit = segmentsFor(core.id, (i) => (T.preds[i]?.label != null && geoRT.labels[i]?.label ? (T.preds[i].label === geoRT.labels[i].label ? '__ok' : '__bad') : null), axis, st.step);
    if (hit.length) bands.push({ title: t('geo.bandHit'), key: 'hit', segs: hit, w: 46 });
  }
  return bands;
}
const bandLegendOf = (bands) => [...new Set(bands.flatMap((b) => b.segs.map((s) => s.label)))].map(geoCat).filter(Boolean).map((c) => ({ name: c.name, color: c.color, index: -1 }));

function renderGeoMarkHint() { /* V26: classes are chosen on the columns themselves */ }

export const geoFigureTracks = (view = {}) => geoTrackOptions(view);

/** Keep the previous Multiproxy shading until a figure explicitly edits its own event presentation. */
export function eventShadeSettings(view) {
  return eventShadeOptions(view.eventShade ?? { on: !!view.shade, sources: view.shade ? (Array.isArray(view.shadeBy) && view.shadeBy.length ? view.shadeBy : ['target']).map((id) => id === 'target' ? id : 'fam:' + id) : [],
    mode: view.shadeMode || 'mix', area: 'panel', styles: {} });
}

function eventShadeSources(core, axis) {
  if (!core) return [];
  const test = geoRT.test?.core === core.id ? geoRT.test.preds : null;
  const target = segmentsFor(core.id, (i) => (test || (geoRT.preds.length ? geoRT.preds : geoRT.labels))[i]?.label, axis, S.geo.settings.step);
  return [{ key: 'target', title: t('sh.target'), full: t('sh.target'), segs: target }, ...coreBands(core, axis, true, true).filter((band) => band.key !== 'hit')]
    .map((band) => ({ ...band, segs: band.segs.map((segment) => ({ ...segment, name: geoCat(segment.label)?.name || segment.label })) }));
}

export function figureEventShading(core, axis, settings) {
  if (!settings?.on) return {};
  if (geoRT.dirty) geoComputeSamples();
  return eventShading(eventShadeSources(core, axis), settings);
}

/** Figure-local sources and class colours; existing interval data and classifier outputs stay untouched. */
export function eventShadeFormHTML(view, core, axis) {
  const settings = eventShadeSettings(view), selected = new Set(settings.sources || []);
  const sources = eventShadeSources(core, axis);
  const rows = sources.map((source) => {
    const style = settings.styles?.[source.key] || { opacity: 0.22, colors: {} }, on = selected.has(source.key);
    const opacity = style.opacity ?? 0.22;
    const layer = S.geo.layers.find((layer) => source.key === 'fam:' + layer.id || source.key.startsWith('auto:') && source.key.endsWith(':' + layer.id));
    const cats = [...new Set([...(layer?.cats.map((cat) => cat.id) || []), ...source.segs.map((segment) => segment.label)])].map(geoCat).filter(Boolean);
    return `<details class="mini" ${on ? 'open' : ''}><summary>${esc(source.full || source.title)}</summary>
      <label class="chk"><input type="checkbox" data-event-source="${esc(source.key)}" ${on ? 'checked' : ''}><span>${t('event.use')}</span></label>
      ${on ? `<label class="f"><span>${t('event.opacity')}</span><input type="number" min="0" max="100" step="1" data-event-opacity="${esc(source.key)}" value="${Math.round(opacity * 100)}"></label>
      <div class="grid2">${cats.map((cat) => {
        const color = validHexColor(style.colors?.[cat.id], validHexColor(cat.color, '#999999'));
        const inputColor = color.length === 4 ? '#' + [...color.slice(1)].map((digit) => digit + digit).join('') : color;
        return `<label class="f"><span>${esc(cat.name)}</span><input type="color" data-event-color="${esc(source.key)}" data-event-class="${esc(cat.id)}" value="${esc(inputColor)}"></label>`;
      }).join('')}</div>
      <button type="button" class="btn small ghost" data-event-reset="${esc(source.key)}">${t('event.resetColors')}</button>` : ''}</details>`;
  }).join('');
  return `<details class="mini" data-event-panel ${settings.on ? 'open' : ''}><summary>${t('event.title')}</summary>
    <label class="chk"><input type="checkbox" data-event-option="on" ${settings.on ? 'checked' : ''}><span>${t('event.enable')}</span></label>
    <div ${settings.on ? '' : 'hidden'}><p class="note">${t('event.help')}</p>
    <label class="f"><span>${t('event.area')}</span><select data-event-option="area">${['panel', 'curve'].map((key) => `<option value="${esc(key)}" ${settings.area === key ? 'selected' : ''}>${t('event.' + key)}</option>`).join('')}</select></label>
    <label class="f"><span>${t('sh.mode')}</span><select data-event-option="mode"><option value="mix" ${settings.mode !== 'split' ? 'selected' : ''}>${t('sh.mix')}</option><option value="split" ${settings.mode === 'split' ? 'selected' : ''}>${t('sh.split')}</option></select></label>
    ${rows || `<p class="note">${t('event.empty')}</p>`}</div></details>`;
}

/** Optional figure settings compose the same records without changing the Multiproxy analysis view. */
export function buildGeoLog(core, features = null, options = null) {
  const g = S.geo, st = g.settings;
  if (!core) return null;
  const view = { ...g.view, ...options }, axis = options?.axis === 'depth' || options?.axis === 'age' ? options.axis : st.axis, xs = axis === 'age' ? coreAges(core) : core.depth;
  const D = options && core.sections?.length && (axis === 'depth' || core.ageModel?.model) ? compositeData(axis, core) : null;
  const ivAxis = intervalsOnAxis(g.intervals.filter((q) => q.core === core.id), axis, core).flatMap((q) => [q.from, q.to]);
  const valid = [...(xs || []).filter((v) => v != null), ...ivAxis, ...(D?.rows.flatMap((r) => [r.a0, r.a1]) || [])];
  if (!valid.length) return null;
  const from = Number.isFinite(options?.from) ? options.from : valid.reduce((min, value) => Math.min(min, value), Infinity), to = Number.isFinite(options?.to) ? options.to : valid.reduce((max, value) => Math.max(max, value), -Infinity);
  if (!(to > from)) return null;
  const height = Math.max(200, Math.min(6000, +options?.height || 700));
  const vars = features ? allNumericVars() : st.features;
  const records = xs ? (features ?? st.features).map((k) => {
    const j = Math.max(0, (st.features.includes(k) ? st.features : vars).indexOf(k));
    const ser = featureSeries(core, k, g.ratios) || [];
    return { name: k, color: GROUP_COLORS[j % GROUP_COLORS.length], reverse: false, pts: xs.map((x, i) => [x, ser[i]]) };
  }).filter((r) => r.pts.some(([x, y]) => x != null && y != null)) : [];
  const bands = coreBands(core, axis, true, view.showEmpty !== false);
  let shade = null, shadeLanes = 1;
  if (view.shade && !view.eventShade) {
    // V0.34: colour by the chosen families (their intervals), side by side or blended; none chosen = classifier target/predictions
    const by = (view.shadeBy || []).filter((id) => id === 'target' || geoLayer(id));
    if (!by.length || (by.length === 1 && by[0] === 'target')) {
      const T = geoRT.test?.core === core.id ? geoRT.test.preds : null;
      shade = segmentsFor(core.id, T ? (i) => T[i]?.label : geoRT.preds.length ? (i) => geoRT.preds[i]?.label : (i) => geoRT.labels[i]?.label, axis, st.step);
    } else {
      const split = view.shadeMode === 'split', n = by.length, fo = split ? 0.3 : Math.max(0.12, 0.34 / n);
      shade = by.flatMap((id, lane) => (id === 'target'
        ? segmentsFor(core.id, (i) => (geoRT.preds[i] || geoRT.labels[i])?.label, axis, st.step)
        : intervalSegs(core, id, axis)).map((q) => ({ ...q, lane: split ? lane : 0, fo })));
      shadeLanes = split ? n : 1;
    }
  }
  let rows = [], image = null, images = null, tracks = { image: false, total: false, species: false, BI: false, ii: false, manual: false };
  if (!options && core.id === S.curCore && S.sections.length && (axis === 'depth' || S.age.model)) {
    const D = compositeData();
    rows = compositeRows(D.secs.map((s) => ({ name: s.name, bins: s.bins.map((b) => ({ ...b, dTop: b.dTop * D.f(s), dBottom: b.dBottom * D.f(s), depth: b.depth * D.f(s) })) })), { axis, model: S.age.model });
    tracks = { ...tracks, image: true, total: true };
    const ims = columnImages({ ...D, axis }, from, to, 700); image = ims[0]; images = ims;   // V0.25: same panels and width as the core column
  }
  if (D) {
    rows = D.rows;
    tracks = geoFigureTracks(options);
    if (tracks.image) { images = columnImages(D, from, to, height, options.imageView || S.logView); image = images[0]; }
  }
  const presentation = options ? logStyleOf({ axis, base: core.units || 'm' }, view, core.ageModel?.units || 'ka') : null;
  const style = presentation?.style || mergedStyle(view.style);
  if (features != null && !options?.style) style.colHide = (Array.isArray(style.colHide) ? style.colHide : []).filter((id) => !id.startsWith('rec:'));
  const visibleBands = bands.filter((b) => !(Array.isArray(style.colHide) && style.colHide.includes('band:' + b.key)));
  const res = buildLogSVG({
    title: core.name, subtitle: t('geo.subtitleLogs', { n: geoRT.samples.filter((s) => s.core === core.id).length, step: st.step }),
    axisLabel: presentation?.label || (axis === 'age' ? `${t('r.age')} (${core.ageModel?.units || 'ka'})` : `${t('r.depth')} (${core.units || 'm'})`),
    from, to, height, rows, classes: D ? S.classes.filter((c) => c.counts !== false && c.id !== 'artifact').map((c) => ({ ...c, index: S.classes.indexOf(c) })) : [],
    taxa: D && tracks.species ? options.taxa || {} : null, taxonClasses: S.classes.map((c, index) => ({ ...c, index })),
    taxonPoints: D && tracks.species ? compositeTaxonPoints(D, options.taxa?.source || 'all') : [], respectTaxonColumnVisibility: true,
    marks: D && tracks.marks ? compositeMarks(D) : [],
    tracks, image, images, imageWidth: image?.w || 64, records,
    boundaries: D ? D.secs.map((s, i) => ({ label: s.name, n: i + 1, a: axis === 'age' ? interpAge(D.model, s.top * D.f(s)) : s.top * D.f(s), a1: axis === 'age' ? interpAge(D.model, s.bottom * D.f(s)) : s.bottom * D.f(s) })).filter((b) => b.a != null && b.a1 != null) : [], bands, bandLegend: bandLegendOf(visibleBands), shade, shadeLanes,
    ...figureEventShading(core, axis, view.eventShade),
    labels: { noData: t('log.noData'), total: t('log.total'), species: t('log.species'), image: t('log.image'), secs: t('log.secs'), marks: t('color.marks') },
    colWidths: view.colW || {}, recWidth: view.trackW || 120, style,
  });
  return { res, axis, from, to, records, bands: visibleBands };
}

export function renderGeoLogs() {
  const g = S.geo, st = g.settings, box = $('geoLogSvg');
  renderGeoMarkHint();
  const core = geoCore(g.view.core) || S.cores[0];
  if (core) g.view.core = core.id;
  $('geoCoreSel').innerHTML = S.cores.map((c) => `<option value="${esc(c.id)}" ${c === core ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const log = buildGeoLog(core);
  syncColOrder('geo', log?.res.columns || []);
  if (!$('geoColumnsForm').innerHTML) $('geoColumnsForm').innerHTML = colOrderHTML('geo');
  if (!log) {
    box.innerHTML = `<p class="note" style="padding:20px">${t(core ? 'geo.noAxis' : 'geo.noCores')}</p>`;
    geoLast = null;
    if (core) renderIntervalList(core); else $('geoIntervals').innerHTML = '';
    return;
  }
  const { res, axis, from, to, records, bands } = log, T = geoRT.test;
  $('geoShade').checked = !!g.view.shade; $('geoShowEmpty').checked = g.view.showEmpty !== false;
  renderShadeBy();
  $('geoTestOut').textContent = T?.core === core.id ? t(T.n ? 'geo.testRes' : 'geo.testResNo', { s: t('geo.testScheme.' + T.scheme), p: T.n ? fmt((100 * T.ok) / T.n, 1) : '', n: T.n }) : '';
  if (!$('geoStyleBox').open || !$('geoStyleForm').innerHTML) $('geoStyleForm').innerHTML = verticalStyleHTML(g.view.style || {}) + colorsFormHTML(g.view.style || {}, 'geo') + axesFormHTML(['total', ...records.map((r) => 'rec:' + r.name)], g.view, records.map((r) => r.name));
  box.innerHTML = res.svg;
  geoLast = { core, from, to, top: res.plotTop, height: res.plotHeight, axis, layout: res.layout, width: res.width };
  $('geoTrackW').value = g.view.trackW || 120;
  const sIdx = geoRT.samples.map((sm, i) => [sm, i]).filter(([sm]) => sm.core === core.id);
  logInteract(box, res, { clickHint: t('gx.clickHint'), from, to, axisLabel: axis === 'age' ? `${t('r.age')} (${S.age.units || 'ka'})` : `${t('r.depth')} (${core.units || 'm'})`, records: records.filter((r) => !g.view.style?.colHide?.includes('rec:' + r.name)), bands, widths: (g.view.colW ||= {}),
    onResize: () => { markDirty(); renderGeoLogs(); },
    bandText: (bkey, a) => {   // automatic columns: class and probability of the nearest sample
      if (!bkey?.startsWith('auto:')) return null;
      const [, cid, lid] = bkey.split(':'), r = geoRT.runs.get(cid)?.byTarget.get(lid); if (!r?.preds?.length) return null;
      let best = null; for (const [sm, i] of sIdx) if (!best || Math.abs(sm.x - a) < Math.abs(best[0].x - a)) best = [sm, i];
      if (!best || Math.abs(best[0].x - a) > st.step) return '—';
      const pr = r.preds[best[1]]; return `${geoCat(pr?.label)?.name || t('gx.unsure')} (${Math.round((pr?.prob || 0) * 100)} %)`;
    },
    extra: (a) => {   // nearest resampled sample: its label and, after training, the class with its probability
      let best = null; for (const [sm, i] of sIdx) if (!best || Math.abs(sm.x - a) < Math.abs(best[0].x - a)) best = [sm, i];
      if (!best || Math.abs(best[0].x - a) > st.step) return [];
      const [sm, i] = best, out = [], lab = geoRT.labels[i], pr = geoRT.preds[i];
      if (axis === 'age' && sm.depth != null) out.push([t('r.depth'), +sm.depth.toPrecision(5)]);
      if (axis === 'depth' && sm.age != null) out.push([t('r.age'), +sm.age.toPrecision(5)]);
      if (lab?.label) out.push([t(lab.source === 'rule' ? 'gx.byRule' : 'gx.byInterval'), geoCat(lab.label)?.name || lab.label]);
      if (pr?.label || pr?.prob) out.push([t('gx.predicted'), `${geoCat(pr.label)?.name || t('gx.unsure')} (${Math.round((pr.prob || 0) * 100)} %)`]);
      return out;
    } });
  renderIntervalList(core);
}

/* ───────────── V25: hover readout and resizable tracks of composite logs (Columna, Multiproxy › Curvas) ───────────── */
/** Value of a record at axis value a: linear between the nearest non-empty points; null in gaps wider than gap. */
function recordAt(pts, a, gap) {
  let lo = null, hi = null;
  for (const p of pts) { if (p[0] == null || p[1] == null) continue; if (p[0] <= a && (!lo || p[0] > lo[0])) lo = p; if (p[0] >= a && (!hi || p[0] < hi[0])) hi = p; }
  if (!lo || !hi) return null;
  if (hi[0] === lo[0]) return lo[1];
  if (gap && hi[0] - lo[0] > gap) return null;
  return lo[1] + ((hi[1] - lo[1]) * (a - lo[0])) / (hi[0] - lo[0]);
}
const medianGap = (pts) => { const x = pts.filter((p) => p[0] != null && p[1] != null).map((p) => p[0]).sort((a, b) => a - b), d = []; for (let i = 1; i < x.length; i++) if (x[i] > x[i - 1]) d.push(x[i] - x[i - 1]); d.sort((a, b) => a - b); return d.length ? d[d.length >> 1] : 0; };
/**
 * Adds to a rendered log: a cursor that follows the mouse with the value of every record at that level
 * and a card with the bands (class) and extra lines; tooltips on track names; drag handles to change track widths.
 * ctx = {from, to, axisLabel, records, bands, widths (object), onResize(), extra(a) → [[label, value], …]}
 */
export function logInteract(box, res, ctx) {
  const svg = box.querySelector('svg'); if (!svg || !res.layout) return;
  box.classList.add('loghover'); box.querySelectorAll('.lgx, .lgrsz').forEach((e) => e.remove());
  const mk = (cls) => { const d = document.createElement('div'); d.className = 'lgx ' + cls; d.hidden = true; box.append(d); return d; };
  const line = mk('lgline'), card = mk('lgcard'), guide = mk('lgguide');
  const recs = new Map((ctx.records || []).map((r) => [r.name, { r, gap: 3 * medianGap(r.pts) }]));
  const chips = res.layout.filter((c) => c.key === 'rec').map((c) => ({ c, el: mk('lgval') }));
  const bandOf = new Map((ctx.bands || []).map((b) => ['band:' + (b.key || b.full || b.title), b]));
  const span = ctx.to - ctx.from, digits = (v) => (v == null || !Number.isFinite(v) ? '—' : Math.abs(v) >= 1000 ? Math.round(v).toLocaleString(lang()) : +v.toPrecision(4) + '');
  const geom = () => { const r = svg.getBoundingClientRect(), b = box.getBoundingClientRect(), s = r.width / res.width; return { r, s, ox: r.left - b.left + box.scrollLeft - box.clientLeft, oy: r.top - b.top + box.scrollTop - box.clientTop }; };
  const hide = () => { line.hidden = card.hidden = true; chips.forEach((k) => (k.el.hidden = true)); };
  const place = (G, X, Y) => {   // card next to the cursor, flipped near the right/bottom edge of the visible area
    card.hidden = false;
    const cw = card.offsetWidth, ch = card.offsetHeight, vx = box.scrollLeft + box.clientWidth, vy = box.scrollTop + box.clientHeight;
    let x = G.ox + X * G.s + 16, y = G.oy + Y * G.s + 12;
    if (x + cw > vx - 4) x = G.ox + X * G.s - cw - 16;
    if (y + ch > vy - 4) y = Math.max(box.scrollTop + 4, vy - ch - 4);
    card.style.left = x + 'px'; card.style.top = y + 'px';
  };
  svg.addEventListener('pointermove', (e) => {
    if (box.classList.contains('marking') && e.buttons) { hide(); return; }
    const G = geom(), X = (e.clientX - G.r.left) / G.s, Y = (e.clientY - G.r.top) / G.s;
    const col = res.layout.find((c) => X >= c.x && X <= c.x + c.w);
    if (Y < res.plotTop) {   // header: full track name
      line.hidden = true; chips.forEach((k) => (k.el.hidden = true));
      if (!col) { card.hidden = true; return; }
      card.innerHTML = `<h4>${esc(col.title)}</h4>${col.id ? `<p>${esc(t('gx.resizeHint'))}</p>` : ''}`; place(G, X, Y); return;
    }
    if (Y > res.plotTop + res.plotHeight) { hide(); return; }
    const a = ctx.from + ((Y - res.plotTop) / res.plotHeight) * span, yPx = G.oy + Y * G.s;
    line.hidden = false; line.style.left = G.ox + 'px'; line.style.width = res.width * G.s + 'px'; line.style.top = yPx + 'px';
    const rows = [];
    for (const c of res.layout) {
      if (c.key === 'band') {
        const b = bandOf.get(c.id), sg = b?.segs.find((q) => q.a0 <= a && a < q.a1);
        const lab = ctx.bandText?.(c.bkey, a) ?? (!sg ? '—' : sg.label === '__ok' ? t('gx.hitOk') : sg.label === '__bad' ? t('gx.hitBad') : geoCat(sg.label)?.name ?? sg.name ?? '—');
        const swCol = sg?.color ? validHexColor(sg.color, '#777777') : '';
        rows.push(`<tr class="${col === c ? 'on' : ''}"><td>${swCol ? `<span class="sw" style="background:${esc(swCol)}"></span>` : ''}${esc(c.title)}</td><td>${esc(lab)}</td></tr>`);
      } else if (c.key === 'rec') {
        const R = recs.get(c.title), v = R ? recordAt(R.r.pts, a, R.gap) : null;
        rows.push(`<tr class="${col === c ? 'on' : ''}"><td>${esc(c.title)}</td><td>${digits(v)}</td></tr>`);
        const k = chips.find((q) => q.c === c); if (k) { k.el.hidden = v == null; k.el.textContent = digits(v); k.el.style.left = G.ox + (c.x + c.w - 2) * G.s + 'px'; k.el.style.top = yPx + 'px'; }
      }
    }
    const extra = (ctx.extra?.(a) || []).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(String(v))}</td></tr>`);
    card.innerHTML = `<h4>${esc(ctx.axisLabel)}: ${digits(a)}</h4><table>${extra.join('')}${rows.join('')}</table>${ctx.clickHint ? `<p>${esc(ctx.clickHint)}</p>` : ''}`;
    place(G, X, Y);
  });
  svg.addEventListener('pointerleave', hide);
  // drag handles on the right edge of every resizable track (header zone)
  for (const c of res.layout.filter((q) => q.id)) {
    const h = document.createElement('div'); h.className = 'lgrsz'; h.dataset.tip = t('gx.resizeTip', { n: c.title }); box.append(h);
    const pos = () => { const G = geom(); h.style.left = G.ox + (c.x + c.w) * G.s + 2 + 'px'; h.style.top = G.oy + 36 * G.s + 'px'; h.style.height = (res.plotTop - 40) * G.s + 'px'; };
    pos();
    h.addEventListener('pointerdown', (e) => {
      e.preventDefault(); h.setPointerCapture(e.pointerId); h.classList.add('drag'); hide();
      const G = geom(), x0 = e.clientX; let w = c.w;
      guide.hidden = false; guide.style.top = G.oy + 'px'; guide.style.height = res.height * G.s + 'px'; guide.style.left = G.ox + (c.x + c.w) * G.s + 'px';
      const move = (ev) => { w = Math.max(30, Math.min(600, Math.round(c.w + (ev.clientX - x0) / G.s))); guide.style.left = G.ox + (c.x + w) * G.s + 'px'; };
      h.addEventListener('pointermove', move);
      h.addEventListener('pointerup', () => { h.removeEventListener('pointermove', move); guide.hidden = true; h.classList.remove('drag'); if (w !== c.w) { ctx.widths[c.id] = w; ctx.onResize(); } }, { once: true });
    });
    h.addEventListener('dblclick', () => { delete ctx.widths[c.id]; ctx.onResize(); });
  }
}

/** Editable list of the intervals of a core, grouped by layer (hierarchy order). */
function renderIntervalList(core) {
  const g = S.geo, rows = [];
  for (const { layer, depth } of layerTree()) {
    const ivs = g.intervals.filter((q) => q.core === core.id && q.layer === layer.id).sort((a, b) => a.from - b.from);
    if (!ivs.length) continue;
    rows.push(`<div class="ivhead" style="padding-left:${depth * 14}px">${depth ? '↳ ' : ''}<b>${esc(layer.name)}</b> <span class="note">(${ivs.length})</span></div>`);
    for (const q of ivs) {
      const c = geoCat(q.cat), col = validHexColor(c?.color, '#777777');
      rows.push(`<div class="row ivrow ${q.auto ? 'auto' : ''} ${q.id === geoSelIv ? 'sel' : ''}" data-id="${esc(q.id)}" style="padding-left:${depth * 14}px"><span class="swatch" style="background:${esc(col)}"></span>
        <select data-k="cat">${layer.cats.map((k) => `<option value="${esc(k.id)}" ${k.id === q.cat ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</select>
        <input type="number" step="any" data-k="from" value="${+q.from.toPrecision(6)}"><input type="number" step="any" data-k="to" value="${+q.to.toPrecision(6)}">
        <span class="note" title="${esc(t(q.axis === 'age' ? 'log.age' : 'log.depth'))}">${q.axis === 'age' ? esc(S.age.units || 'ka') : esc(core.units || 'm')}</span>
        ${geoRT.orphans.has(q.id) ? `<span class="warn" title="${esc(t('geo.orphan', { p: geoLayer(layer.parent)?.name || '' }))}">⚠</span>` : ''}
        ${q.auto ? `<button class="btn small ghost" data-ok="${esc(q.id)}" title="${esc(t('geo.confirmAuto'))}">✓</button>` : ''}
        <button class="btn small ghost" data-del="${esc(q.id)}">✕</button></div>`);
    }
  }
  $('geoIntervals').innerHTML = rows.join('') || `<p class="note">${t('geo.noIntervals')}</p>`;
}

let geoTrackT = 0;

/** V0.34: which families colour the records, and how several are combined. */
function renderShadeBy() {
  const v = S.geo.view, box = $('geoShadeBy'); if (!box) return;
  box.hidden = !v.shade;
  const on = new Set(v.shadeBy || []), opts = [['target', t('sh.target')], ...S.geo.layers.map((l) => [l.id, l.name])];
  box.innerHTML = `<div class="chk2">${opts.map(([id, n]) => `<label class="chk"><input type="checkbox" data-shby="${esc(id)}" ${on.has(id) ? 'checked' : ''}><span>${esc(n)}</span></label>`).join('')}</div>
    <label class="f"><span>${t('sh.mode')}</span><select id="geoShadeMode"><option value="mix" ${v.shadeMode !== 'split' ? 'selected' : ''}>${t('sh.mix')}</option><option value="split" ${v.shadeMode === 'split' ? 'selected' : ''}>${t('sh.split')}</option></select></label>`;
}

/**
 * Try the automatic classification on the current core without using its own labels:
 * trained on the other cores' labels when they cover ≥ 2 classes; otherwise 5 contiguous blocks
 * of this core, each predicted by a model trained without that block (out-of-block prediction).
 */
function geoTestCore() {
  if (geoRT.dirty) geoComputeSamples();
  const g = S.geo, st = g.settings, core = geoCore(g.view.core), c = curClf(); if (!core) return;
  if (!c) { toast(t('cl.none')); return; }
  syncCurrent();
  const method = c.method === 'kmeans' ? 'rf' : c.method, params = { ...METHODS[method].defaults, ...(c.params?.[method] || {}) }, cols = clfCols(c);
  const X = geoRT.samples.map((s) => ({ ...s, f: cols.map((j) => s.f[j]) })), lab = geoRT.labels, out = new Array(X.length).fill(null);
  const mine = X.map((s, i) => (s.core === core.id ? i : -1)).filter((i) => i >= 0);
  if (!mine.length) { toast(t('geo.testNoSamples')); return; }
  const fit = (idx) => fitModel(method, idx.map((i) => X[i].f), idx.map((i) => lab[i].label), params, c.seed ?? 42);
  const others = X.map((s, i) => (s.core !== core.id && lab[i].label ? i : -1)).filter((i) => i >= 0);
  let scheme;
  if (new Set(others.map((i) => lab[i].label)).size >= 2) { scheme = 'others'; const m = fit(others); for (const i of mine) out[i] = predictLabel(m, X[i].f, c.minProb); }
  else {
    scheme = 'blocks'; const sorted = [...mine].sort((a, b) => X[a].x - X[b].x), k = Math.min(5, sorted.length);
    for (let f = 0; f < k; f++) {
      const test = sorted.slice(Math.floor((f * sorted.length) / k), Math.floor(((f + 1) * sorted.length) / k)), ts = new Set(test);
      const train = X.map((s, i) => (lab[i].label && !ts.has(i) ? i : -1)).filter((i) => i >= 0);
      if (new Set(train.map((i) => lab[i].label)).size < 2) continue;
      const m = fit(train); for (const i of test) out[i] = predictLabel(m, X[i].f, c.minProb);
    }
  }
  const scored = mine.filter((i) => lab[i].label && out[i]?.label != null);
  geoRT.test = { core: core.id, preds: out, scheme, n: scored.length, ok: scored.filter((i) => out[i].label === lab[i].label).length };
  g.view.shade = true; renderGeo();
}

const geoValAt = (ev) => {
  const svg = $('geoLogSvg').querySelector('svg'); if (!svg || !geoLast) return null;
  const r = svg.getBoundingClientRect(), y = ((ev.clientY - r.top) / r.height) * svg.viewBox.baseVal.height;
  const f = (y - geoLast.top) / geoLast.height; if (f < 0 || f > 1) return null;
  return geoLast.from + f * (geoLast.to - geoLast.from);
};
/* ── V26: manual classification right on the columns: drag in a family column to draw, click to edit; automatic columns can be copied to their family ── */
let geoSelIv = null, famDrag = null;
function geoBoxGeom() {
  const box = $('geoLogSvg'), svg = box.querySelector('svg'); if (!svg || !geoLast) return null;
  const r = svg.getBoundingClientRect(), b = box.getBoundingClientRect(), sc = r.width / geoLast.width;
  return { box, r, sc, ox: r.left - b.left + box.scrollLeft - box.clientLeft, oy: r.top - b.top + box.scrollTop - box.clientTop };
}
function geoColAt(e) {
  const G = geoBoxGeom(); if (!G) return null;
  const X = (e.clientX - G.r.left) / G.sc, col = (geoLast.layout || []).find((c) => X >= c.x && X <= c.x + c.w);
  const a = geoValAt(e); return col && a != null ? { col, a, G } : null;
}
const geoIvAt = (layerId, a) => intervalsOnAxis(S.geo.intervals.filter((q) => q.core === geoLast.core.id && q.layer === layerId), geoLast.axis, geoLast.core).find((q) => q && a >= q.from && a <= q.to);
function closeIvPop() { document.querySelectorAll('.ivpop').forEach((p) => p.remove()); }
/** Small panel next to the cursor. html: content; onClick(btn): handles [data-pop] buttons. */
function ivPop(cx, cy, html, onClick) {
  closeIvPop();
  const G = geoBoxGeom(); if (!G) return;
  const p = document.createElement('div'); p.className = 'ivpop'; p.innerHTML = html; G.box.append(p);
  const x = cx - G.box.getBoundingClientRect().left + G.box.scrollLeft, y = cy - G.box.getBoundingClientRect().top + G.box.scrollTop;
  const w = p.offsetWidth, h = p.offsetHeight;
  p.style.left = Math.max(G.box.scrollLeft + 4, Math.min(x + 12, G.box.scrollLeft + G.box.clientWidth - w - 6)) + 'px';
  p.style.top = Math.max(G.box.scrollTop + 4, Math.min(y + 8, G.box.scrollTop + G.box.clientHeight - h - 6)) + 'px';
  p.addEventListener('pointerdown', (e) => e.stopPropagation());
  p.addEventListener('click', (e) => { const b = e.target.closest('[data-pop]'); if (b) onClick(b, p); });
  p.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input')) p.querySelector('[data-pop=newcat]')?.click(); });
  (p.querySelector('.on') || p.querySelector('button, input'))?.focus();
}
const fmtA = (v) => +(+v).toPrecision(5);
function axisUnit() { return geoLast.axis === 'age' ? S.age.units || 'ka' : geoLast.core.units || 'm'; }
/** Edit panel of a family interval: choose class, confirm a pending one, delete; add a class if the family has none. */
function famPop(cx, cy, q) {
  const g = S.geo, L = geoLayer(q.layer); if (!L) return;
  const qa = intervalsOnAxis([q], geoLast.axis, geoLast.core)[0] || q;
  const cats = L.cats.map((c) => `<button class="popcat ${c.id === q.cat ? 'on' : ''}" data-pop="cat" data-v="${esc(c.id)}"><span class="sw" style="background:${validHexColor(c.color, '#777777')}"></span>${esc(c.name)}</button>`).join('');
  ivPop(cx, cy, `<h4>${esc(L.name)} <span class="note">${fmtA(qa.from)}–${fmtA(qa.to)} ${esc(axisUnit())}</span></h4>
    ${q.auto ? `<p class="note">${t('cl.pending')}</p>` : ''}
    <div class="popcats">${cats || `<p class="note">${t('cl.noCats')}</p>`}</div>
    <div class="row popnew"><input type="text" placeholder="${esc(t('geo.newLabel'))}" aria-label="${esc(t('geo.newLabel'))}"><button class="btn small" data-pop="newcat">${t('geo.addLabel')}</button></div>
    <div class="row">${q.auto ? `<button class="btn small primary" data-pop="ok">${t('cl.confirm')}</button>` : ''}<button class="btn small" data-pop="del">${t('cl.delIv')}</button><button class="btn small ghost" data-pop="close">${t('help.close')}</button></div>`,
  (b, p) => {
    const act = b.dataset.pop;
    if (act === 'close') { closeIvPop(); return; }
    if (act === 'del') g.intervals = g.intervals.filter((x) => x !== q);
    else if (act === 'ok') delete q.auto;
    else if (act === 'cat') { q.cat = b.dataset.v; delete q.auto; g.lastCat[L.id] = q.cat; g.activeLayer = L.id; g.activeCat = q.cat; }
    else if (act === 'newcat') { const name = p.querySelector('input').value.trim(); if (!name) return; const c = addCat(L, name); q.cat = c.id; delete q.auto; g.lastCat[L.id] = c.id; }
    geoSelIv = act === 'del' ? null : q.id; geoMarkDirty(); renderGeoPanel(); renderGeo();
    if (act === 'newcat') famPop(cx, cy, q);
  });
}
/** Panel of an automatic column: copy the segment under the cursor, or the whole column of this core, to its family. */
function autoPop(cx, cy, bkey, a) {
  const [, cid, lid] = bkey.split(':'), c = S.geo.classifiers.find((x) => x.id === cid), L = geoLayer(lid), r = geoRT.runs.get(cid)?.byTarget.get(lid);
  if (!c || !L || !r?.preds?.length) return;
  const st = S.geo.settings, core = geoLast.core, segs = segmentsFor(core.id, (i) => r.preds[i]?.label, geoLast.axis, st.step);
  const seg = segs.find((q) => a >= q.a0 && a < q.a1), cat = geoCat(seg?.label);
  ivPop(cx, cy, `<h4>⚙ ${esc(c.name)} → ${esc(L.name)}</h4>
    <p>${cat ? `<span class="sw" style="background:${validHexColor(cat.color, '#777777')}"></span>${esc(cat.name)} · ${fmtA(seg.a0)}–${fmtA(seg.a1)} ${esc(axisUnit())}` : t('gx.unsure')}</p>
    <div class="popcol">${seg ? `<button class="btn small primary" data-pop="one">${t('cl.copyOne', { f: esc(L.name) })}</button>` : ''}
    <button class="btn small" data-pop="all">${t('cl.copyAll', { f: esc(L.name) })}</button><button class="btn small ghost" data-pop="close">${t('help.close')}</button></div>
    <p class="note">${t('cl.copyNote')}</p>`,
  (b) => {
    const act = b.dataset.pop, g = S.geo; if (act === 'close') { closeIvPop(); return; }
    if (act === 'one' && seg) g.intervals.push({ id: uid(), core: core.id, layer: lid, axis: geoLast.axis, from: seg.a0, to: seg.a1, cat: seg.label });
    if (act === 'all') {
      g.intervals = g.intervals.filter((q) => !(q.auto && q.core === core.id && q.layer === lid));
      g.intervals.push(...segs.filter((q) => geoLayerOf(q.label)?.id === lid).map((q) => ({ id: uid(), core: core.id, layer: lid, axis: geoLast.axis, from: q.a0, to: q.a1, cat: q.label, auto: true })));
      toast(t('geo.accepted', { n: segs.length }));
    }
    closeIvPop(); geoMarkDirty(); renderGeo();
  });
}

/** Hover text of a map point (V25). */
export function mapTip(p, mode, feat) {
  const where = p.project ? ` — ${p.project}` : '';
  const val = mode === 'sites' ? '' : !p.n ? t('gx.mapNoData') : mode === 'class' ? `${geoCat(p.dominant)?.name ?? p.dominant ?? '—'}${p.fraction != null ? ` (${Math.round(p.fraction * 100)} %)` : ''}` : `${feat}: ${(+p.value).toFixed(2)}`;
  return [p.name + where, val, p.n ? t('gx.mapN', { n: p.n }) : '', `${fmt(p.lat, 4)}°, ${fmt(p.lon, 4)}°`].filter(Boolean).join('\n');
}
export function renderGeoMap() {
  const g = S.geo, m = g.map, st = g.settings, box = $('geoMapSvg');
  $('gmA0').value = m.a0; $('gmA1').value = m.a1; $('gmMode').value = m.mode; $('gmIdw').checked = m.idw; $('gmPower').value = m.power;
  $('gmRef').checked = m.ref; $('gmR0').value = m.r0; $('gmR1').value = m.r1;
  const names = geoRT.featNames;
  if (!names.includes(m.feature)) m.feature = names[0] || '';
  $('gmFeature').innerHTML = names.map((k) => `<option ${k === m.feature ? 'selected' : ''}>${esc(k)}</option>`).join('');
  for (const id of ['gmFeatRow', 'gmIdwRow', 'gmRefRow']) $(id).hidden = m.mode !== 'value';
  if (!geoRT.samples.some((s) => s.age != null)) { box.innerHTML = `<p class="note" style="padding:20px">${t('geo.mapNoAge')}</p>`; return; }
  // V26: what the class map shows — a family (described intervals) or an automatic column
  const srcs = [];
  for (const { layer } of layerTree()) {
    if (S.geo.intervals.some((q) => q.layer === layer.id && !q.auto)) srcs.push({ v: 'fam:' + layer.id, name: layer.name, lid: layer.id });
    for (const c of S.geo.classifiers) { const r = geoRT.runs.get(c.id)?.byTarget.get(layer.id); if (r?.preds?.length) srcs.push({ v: `auto:${c.id}:${layer.id}`, name: `⚙ ${c.name} → ${layer.name}`, lid: layer.id, r, c }); }
  }
  if (!srcs.some((x) => x.v === m.src)) m.src = srcs.find((x) => x.r)?.v || srcs[0]?.v || '';
  $('gmSrc').innerHTML = srcs.map((x) => `<option value="${esc(x.v)}" ${x.v === m.src ? 'selected' : ''}>${esc(x.name)}</option>`).join(''); $('gmSrcRow').hidden = m.mode !== 'class';
  const src = srcs.find((x) => x.v === m.src);
  const preds = src?.r ? src.r.preds : src ? labelsFor(src.lid, false).map((l) => ({ label: l.label })) : geoRT.labels.map((l) => ({ label: l.label }));
  const off = new Set(m.off || []);
  const pts = mapSummary(geoRT.samples, preds, S.cores, { a0: m.a0, a1: m.a1, mode: m.mode, feature: names.indexOf(m.feature), ref: m.ref ? [m.r0, m.r1] : null }).filter((p) => !off.has(p.core));
  m.interp ||= {}; for (const [k, v] of Object.entries(INTERP_DEFAULT)) if (!(k in m.interp)) m.interp[k] = v; m.interp.on = m.idw;
  const style = geoMapStyle(), fr = frameRatio('gmFrame');
  let auto = mapBBox(pts); auto[2] += 3; if (fr) { auto = fitBBoxAspect(auto, fr, style.proj); if (m.view) m.view = fitBBoxAspect(m.view, fr, style.proj); } geoAutoBBox = auto;
  const bbox = m.view || auto;
  const nx = 90, ny = Math.max(10, Math.round((90 * (bbox[3] - bbox[1])) / ((bbox[2] - bbox[0]) * Math.cos((((bbox[1] + bbox[3]) / 2) * Math.PI) / 180))));
  const bg = mapBackground(style.bg, bbox, refreshProjectMaps, style.proj);
  const vl = m.mode === 'value' ? valueLayer(pts, bbox, m.interp, m.ref ? `Δ ${m.feature}` : `z ${m.feature}`) : null;
  const colors = {}, legend = [];
  if (m.mode === 'class') for (const p of pts) if (p.dominant && !colors[p.dominant]) { const c = geoCat(p.dominant); if (c) { colors[p.dominant] = c.color; legend.push([c.name, c.color]); } }
  const target = src ? geoLayer(src.lid)?.name || '' : geoLayer(st.target)?.name || '';
  const svg = buildMapSVG({ tipFn: (p) => mapTip(p, m.mode, m.feature),
    land: geoLand, bbox, points: pts, mode: m.mode, colors, legend, style, bg, ...(vl ? { grid: vl.grid, nx: vl.nx, ny: vl.ny, colorFn: vl.colorFn, contours: vl.contours, contourLabels: vl.contourLabels, gridOpacity: vl.gridOpacity, colorbar: vl.colorbar } : {}),
    title: m.mode === 'class' ? t('geo.mapTitleClass', { l: target, a0: m.a0, a1: m.a1 }) : t('geo.mapTitleValue', { f: m.feature, a0: m.a0, a1: m.a1 }),
    subtitle: m.mode === 'class' ? (src?.r ? t('cl.mapSub', { c: src.c.name, m: t('geo.m.name.' + src.c.method) }) : t('geo.mapSubLabels')) : (m.ref ? t('geo.mapSubRef', { r0: m.r0, r1: m.r1 }) : t('geo.mapSubZ')),
    note: t('geo.mapNote'), coverageNote: vl?.coverageNote,
  });
  box.innerHTML = svg; geoLastMap = { svg, pts };
  mapStyleUI('gmStyle', geoMapGet, (s2, v) => { S.geo.map.style = s2; S.geo.map.view = v; markDirty(); }, refreshProjectMaps);
  $('gmInterp').hidden = m.mode !== 'value';
  if (m.mode === 'value') interpUI('gmInterp', () => m.interp, () => { m.idw = m.interp.on; markDirty(); }, refreshProjectMaps, vl?.info);
  const offSet = new Set(m.off || []);
  coreListUI('gmCores', S.cores.map((c) => ({ id: c.id, name: c.name, lat: c.lat })), offSet, () => { m.off = [...offSet]; markDirty(); }, refreshProjectMaps);
  return svg;
}
export let geoLand = [], geoLastMap = null;
export async function loadLand() { if (geoLand.length) return; try { geoLand = (await (await fetchAsset('data/land-50m.json')).json()).rings; } catch { geoLand = []; } }

/* ───────────── map interpolation (Surfer-like), colour scale and list of cores (V20) ───────────── */
/** Grid, colour function, contours and colour bar of a value map. pts = map points with .value; ip = interpolation options. */
export function valueLayer(pts, bbox, ip, label) {
  const o = { ...INTERP_DEFAULT, ...ip }, g = mapGeometry(bbox), nx = Math.max(10, Math.min(400, Math.round(o.res)));
  const ny = Math.max(6, Math.round((nx * g.H) / g.W));
  let grid = null, info = {};
  if (o.on !== false && pts.filter((p) => p.value != null).length >= 3) {
    const r = interpolate(pts, bbox, nx, ny, o); info = r.info;
    grid = o.mask && o.mask !== 'both' && geoLand.length ? maskLand(r.grid, nx, ny, bbox, geoLand, o.mask) : r.grid;
  }
  const [lo, hi] = colorRange((grid || []).concat(pts.map((p) => p.value)), o);
  const colorFn = (v) => rampColor(o.ramp, v, lo, hi, o.steps, o.reverse);
  const contours = grid && o.contours ? contourLevels(lo, hi, o.levels).map((level) => ({ level, label: +level.toFixed(3), segs: contourSegments(grid, nx, ny, level) })) : [];
  const coverageNote = grid && o.hull === false && o.method !== 'tin' ? t('ip.extrapolated') : '';
  return { grid, nx, ny, colorFn, contours, contourLabels: o.labels, gridOpacity: o.opacity, colorbar: { min: lo, max: hi, fn: colorFn, label }, info, coverageNote };
}

/** Panel of interpolation and colour options. get() → options object (mutated by the panel); redraw() renders the map. */
export function interpUI(boxId, get, save, redraw, info) {
  const box = $(boxId), o = get();
  box.dataset.key ||= '';
  const key = `${lang()}|${o.method}|${o.scale}|${o.autoVario}|${o.contours}|${o.on}|${o.hull}|${o.mask}`;
  const fill = () => {
    for (const el of box.querySelectorAll('[data-ip]')) if (el !== document.activeElement) { const k = el.dataset.ip; if (el.type === 'checkbox') el.checked = !!o[k]; else el.value = o[k]; }
    const inf = box.querySelector('.ipinfo');
    if (inf) inf.textContent = info?.variogram ? t('ip.vario', { m: t('ip.v.' + info.variogram.model), n: +info.variogram.nugget.toFixed(3), s: +info.variogram.sill.toFixed(3), r: Math.round(info.variogram.range) }) + (info.variogram && info.few ? ' ' + t('ip.few') : '') : info?.fallback ? t('ip.fallback') : '';
  };
  if (box.dataset.key === key) { fill(); return; }
  const open = box.querySelector('details')?.open;
  box.dataset.key = key;
  const num = (k, l, a, b, st, dis = false) => `<label class="f"><span>${t(l)}</span><input type="number" data-ip="${esc(k)}" min="${esc(a)}" max="${esc(b)}" step="${esc(st)}" ${dis ? 'disabled' : ''}></label>`;
  const chk = (k, l) => `<label class="chk"><input type="checkbox" data-ip="${esc(k)}"><span>${t(l)}</span></label>`;
  const sel = (k, l, opts) => `<label class="f"><span>${t(l)}</span><select data-ip="${esc(k)}">${opts.map(([v, n]) => `<option value="${esc(v)}">${n}</option>`).join('')}</select></label>`;
  const m = o.method, P = {
    idw: num('power', 'ip.power', 1, 6, 0.5) + num('radius', 'ip.radius', 0, 5000, 10) + num('neighbours', 'ip.neigh', 0, 100, 1),
    nearest: num('radius', 'ip.radius', 0, 5000, 10), tin: '', mincurv: num('smooth', 'ip.smooth', 0, 10, 0.1),
    rbf: sel('rbf', 'ip.rbf', [['multiquadric', t('ip.r.mq')], ['gaussian', t('ip.r.gauss')], ['tps', t('ip.r.tps')]]) + num('shape', 'ip.shape', 1, 5000, 10) + num('smooth', 'ip.smooth', 0, 10, 0.1),
    kriging: sel('variogram', 'ip.vmodel', ['spherical', 'exponential', 'gaussian', 'linear'].map((v) => [v, t('ip.v.' + v)])) + chk('autoVario', 'ip.auto') + num('nugget', 'ip.nugget', 0, 1e6, 'any', o.autoVario) + num('sill', 'ip.sill', 0, 1e6, 'any', o.autoVario) + num('range', 'ip.range', 1, 20000, 'any', o.autoVario),
    movavg: num('radius', 'ip.radius', 0, 5000, 10),
  };
  box.innerHTML = `<details ${open ? 'open' : ''}><summary>${t('ip.title')}</summary><div class="msgrid">
    <div style="flex-basis:100%"><button type="button" class="btn small" data-ip-preset="sea">${t('ip.visibleSea')}</button><p class="note" style="margin:6px 0">${t('ip.visibleSeaHelp')}</p></div>
    ${chk('on', 'ip.on')}${sel('method', 'ip.method', INTERP_METHODS.map((k) => [k, t('ip.m.' + k)]))}${P[m] || ''}
    <p class="note" style="flex-basis:100%;margin:0">${t('ip.d.' + m)}</p>
    ${num('res', 'ip.res', 10, 400, 10)}${chk('hull', 'ip.hull')}${sel('mask', 'ip.mask', [['both', t('ip.mask.both')], ['sea', t('ip.mask.sea')], ['land', t('ip.mask.land')]])}
    ${num('opacity', 'ip.opacity', 0.1, 1, 0.05)}${chk('contours', 'ip.contours')}${o.contours ? num('levels', 'ip.levels', 1, 30, 1) + chk('labels', 'ip.labels') : ''}
    ${sel('ramp', 'ip.ramp', Object.keys(RAMPS).map((k) => [k, t('ip.ramp.' + k)]))}${chk('reverse', 'ip.reverse')}
    ${sel('scale', 'ip.scale', ['sym2', 'auto', 'symauto', 'manual'].map((k) => [k, t('ip.sc.' + k)]))}${o.scale === 'manual' ? num('vmin', 'ip.vmin', -1e9, 1e9, 'any') + num('vmax', 'ip.vmax', -1e9, 1e9, 'any') : ''}${num('steps', 'ip.steps', 0, 20, 1)}
    <p class="note ipinfo" style="flex-basis:100%;margin:0"></p></div></details>`;
  fill();
  box.onchange = (e) => {
    const el = e.target, k = el.dataset.ip; if (!k) return;
    const cur = get(); cur[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? +el.value : el.value;
    save(); setTimeout(redraw, 0);
  };
  box.onclick = async (event) => {
    if (!(event.target instanceof Element) || !event.target.closest('[data-ip-preset="sea"]')) return;
    await loadLand();
    if (!geoLand.length) { box.querySelector('.ipinfo').textContent = t('ip.needCoast'); return; }
    Object.assign(get(), visibleSeaOptions(get()));
    save(); setTimeout(redraw, 0);
  };
}

/** List of the cores of a map with a checkbox each (unticked cores are left out of the map and of the interpolation). */
export function coreListUI(boxId, cores, off, save, redraw) {
  const box = $(boxId), open = box.querySelector('details')?.open;
  box.innerHTML = `<details ${open ? 'open' : ''}><summary>${t('ip.cores', { n: cores.filter((c) => !off.has(c.id)).length, t: cores.length })}</summary>
    <div class="row" style="margin:6px 0"><button class="btn small" data-cl="all">${t('mp.all')}</button><button class="btn small" data-cl="none">${t('mp.none')}</button></div>
    <div class="chklist">${cores.map((c) => `<label class="chk" title="${esc(c.where || '')}"><input type="checkbox" data-id="${esc(c.id)}" ${off.has(c.id) ? '' : 'checked'} ${c.lat == null ? 'disabled' : ''}><span>${esc(c.name)}${c.lat == null ? ` <i class="note">(${t('ip.noPos')})</i>` : ''}</span></label>`).join('')}</div></details>`;
  box.onchange = (e) => { const id = e.target.dataset.id; if (id == null) return; if (e.target.checked) off.delete(id); else off.add(id); save(); setTimeout(redraw, 0); };
  box.onclick = (e) => { const a = e.target.dataset.cl; if (!a) return; if (a === 'all') off.clear(); else cores.forEach((c) => off.add(c.id)); save(); setTimeout(redraw, 0); };
}

/* ───────────── map customisation, backgrounds and zoom (V15) ───────────── */
// Backgrounds come as single images in EPSG:4326 (lon/lat) for the exact extent, so they lie on the plate carrée map unchanged.
// Mercator maps ask for EPSG:3857 images (linear in Mercator y), so they also lie on the map unchanged.
const R_EARTH = 6378137, merc = (lon, lat) => [R_EARTH * lon * Math.PI / 180, R_EARTH * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))];
const ESRI = (svc) => (b, w, h, pr) => `https://server.arcgisonline.com/ArcGIS/rest/services/${svc}/MapServer/export?bbox=${b.join(',')}&bboxSR=4326&imageSR=${pr === 'mercator' ? 3857 : 4326}&size=${w},${h}&format=jpg&f=image`;
const GEBCO = (b, w, h, pr) => pr === 'mercator'
  ? `https://wms.gebco.net/mapserv?service=WMS&version=1.1.1&request=GetMap&layers=GEBCO_LATEST&styles=&srs=EPSG:3857&bbox=${[...merc(b[0], b[1]), ...merc(b[2], b[3])].map((v) => v.toFixed(0)).join(',')}&width=${w}&height=${h}&format=image/jpeg`
  : `https://wms.gebco.net/mapserv?service=WMS&version=1.1.1&request=GetMap&layers=GEBCO_LATEST&styles=&srs=EPSG:4326&bbox=${b.join(',')}&width=${w}&height=${h}&format=image/jpeg`;
let bgWidth = 1600; // pixels across of the background image (raised temporarily for high-resolution exports)
const MAP_BG = {
  vector: null,
  physical: { url: ESRI('World_Physical_Map'), attr: 'map.attr.physical' },
  relief: { url: ESRI('World_Shaded_Relief'), attr: 'map.attr.relief' },
  topo: { url: ESRI('World_Topo_Map'), attr: 'map.attr.topo' },
  bathy: { url: ESRI('Ocean/World_Ocean_Base'), attr: 'map.attr.bathy' },
  gebco: { url: GEBCO, attr: 'map.attr.gebco' },
  photo: { url: ESRI('World_Imagery'), attr: 'map.attr.photo' },
  photobathy: { url: GEBCO, url2: ESRI('World_Imagery'), attr: 'map.attr.photobathy' },
};
const bgCache = new Map(), bgPromises = new Map(); let bgFailShown = false, mapNetAsked = null;
export function mapNetConsent() {
  try { if (localStorage.getItem('ichantool.mapNet') === 'yes') return true; } catch { /* storage blocked */ }
  if (mapNetAsked !== null) return mapNetAsked;
  mapNetAsked = confirm(t('map.netAsk'));
  if (mapNetAsked) try { localStorage.setItem('ichantool.mapNet', 'yes'); } catch { /* storage blocked */ }
  return mapNetAsked;
}
const blobToDataURL = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
export async function fetchImage(url) { const r = await fetch(url); if (!r.ok || !/^image\//.test(r.headers.get('content-type') || '')) throw new Error(`HTTP ${r.status}`); return blobToDataURL(await r.blob()); }
/** Background for a map: returns {href, href2, attribution} when cached; otherwise starts the download and calls onReady. */
export function mapBackground(kind, bbox, onReady, proj = 'plate') {
  const def = MAP_BG[kind]; if (!def || (proj !== 'plate' && proj !== 'mercator')) return null;
  const key = `${kind}|${proj}|${bgWidth}|${bbox.join(',')}`, hit = bgCache.get(key);
  if (hit && hit !== 'pending') return hit === 'fail' ? null : hit;
  if (!hit) {
    if (!mapNetConsent()) return null;   // V0.38: explicit consent before the study area is sent to Esri/GEBCO
    bgCache.set(key, 'pending');
    // square pixels in degrees (ArcGIS would otherwise widen the extent); the image is then stretched onto the cos(lat) map
    const [mx0, my0] = merc(bbox[0], bbox[1]), [mx1, my1] = merc(bbox[2], bbox[3]);
    let w = Math.min(4096, bgWidth), h = Math.round(proj === 'mercator' ? (w * (my1 - my0)) / (mx1 - mx0) : (w * (bbox[3] - bbox[1])) / (bbox[2] - bbox[0]));
    if (h > 4096) { w = Math.round((w * 4096) / h); h = 4096; } h = Math.max(h, 50);
    bgPromises.set(key, Promise.all([fetchImage(def.url(bbox, w, h, proj)), def.url2 ? fetchImage(def.url2(bbox, w, h, proj)) : null])
      .then(([href, href2]) => { bgCache.set(key, { href, href2, attribution: t(def.attr) }); onReady(); })
      .catch(() => { bgCache.set(key, 'fail'); if (!bgFailShown) { bgFailShown = true; toast(t('ms.bgFail')); } onReady(); }));
  }
  return null;
}
const bgPending = (kind, bbox, proj = 'plate') => bgCache.get(`${kind}|${proj}|${bgWidth}|${bbox.join(',')}`) === 'pending';

/** Style panel for a map. get() → {style, view}; set(style, view) stores; redraw() renders; fit() resets the extent. */
export function mapStyleUI(boxId, get, set, redraw) {
  const box = $(boxId), { style: st, view } = get();
  if (box.dataset.built === lang()) { // already built: only refresh the values (rebuilding would steal the focus)
    for (const el of box.querySelectorAll('[data-k]')) if (el !== document.activeElement) { if (el.type === 'checkbox') el.checked = !!st[el.dataset.k]; else el.value = st[el.dataset.k]; }
    for (const el of box.querySelectorAll('[data-e]')) if (el !== document.activeElement) el.value = view ? view[+el.dataset.e] : '';
    box.querySelector('.msload').textContent = bgPending(st.bg, view || get().auto || [0, 0, 0, 0], st.proj) ? ' · ' + t('ms.loading') : '';
    return;
  }
  box.dataset.built = lang();
  const chk = (k, l) => `<label class="chk"><input type="checkbox" data-k="${esc(k)}" ${st[k] ? 'checked' : ''}><span>${t(l)}</span></label>`;
  const col = (k, l) => `<label class="f"><span>${t(l)}</span><input type="color" data-k="${esc(k)}" value="${esc(validHexColor(st[k], MAP_STYLE[k] || '#000000'))}"></label>`;
  const num = (k, l, a, b, s) => `<label class="f"><span>${t(l)}</span><input type="number" data-k="${esc(k)}" min="${esc(a)}" max="${esc(b)}" step="${esc(s)}" value="${esc(st[k])}"></label>`;
  const ext = view || ['', '', '', ''];
  box.innerHTML = `<details><summary>${t('ms.title')}</summary><div class="msgrid">
    <label class="f"><span>${t('ms.bg')}</span><select data-k="bg">${Object.keys(MAP_BG).map((k) => `<option value="${esc(k)}" ${k === st.bg ? 'selected' : ''}>${t('ms.bg.' + k)}</option>`).join('')}</select></label>
    ${num('bgOpacity', 'ms.opacity', 0.1, 1, 0.1)}${chk('coast', 'ms.coast')}
    <label class="f"><span>${t('ms.proj')}</span><select data-k="proj">${MAP_PROJECTIONS.map((k) => `<option value="${esc(k)}" ${k === (st.proj || 'plate') ? 'selected' : ''}>${t('ms.proj.' + k)}</option>`).join('')}</select></label>
    <label class="f"><span>${t('ms.symbol')}</span><select data-k="symbol">${MAP_SYMBOLS.map((k) => `<option value="${esc(k)}" ${k === st.symbol ? 'selected' : ''}>${t('ms.sym.' + k)}</option>`).join('')}</select></label>
    ${num('size', 'ms.size', 0.3, 4, 0.1)}${chk('sizeByFraction', 'ms.sizeFrac')}${col('pointColor', 'ms.pointColor')}${col('stroke', 'ms.stroke')}
    ${chk('labels', 'ms.labels')}${num('labelSize', 'ms.labelSize', 6, 30, 1)}${col('labelColor', 'ms.labelColor')}${chk('halo', 'ms.halo')}${chk('labelValue', 'ms.labelValue')}
    ${col('land', 'ms.land')}${col('sea', 'ms.sea')}${col('textColor', 'color.textColor')}${col('subColor', 'color.subColor')}${col('bgColor', 'color.bgColor')}${chk('graticule', 'ms.grat')}${chk('scaleBar', 'ms.scale')}${chk('north', 'ms.north')}
    <label class="f"><span>${t('ms.extent')}</span><span class="row">${[0, 1, 2, 3].map((i) => `<input type="number" step="any" data-e="${esc(i)}" value="${esc(ext[i])}">`).join('')}</span></label>
    <div class="zbtn"><button class="btn small" data-z="in" title="Zoom +">＋</button><button class="btn small" data-z="out" title="Zoom −">－</button><button class="btn small" data-z="fit">${t('ms.fit')}</button><button class="btn small" data-z="reset">${t('ms.reset')}</button></div>
    <p class="note" style="margin:0;flex-basis:100%">${t('ms.zoomHelp')}<span class="msload"></span></p></div></details>`;
  box.onchange = (e) => {
    const el = e.target, cur = get();
    if (el.dataset.k) { const k = el.dataset.k; cur.style[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? +el.value : el.value; set(cur.style, cur.view); }
    else if (el.dataset.e != null) {
      const v = [...box.querySelectorAll('[data-e]')].map((x) => +x.value);
      if (v.every(Number.isFinite) && v[2] > v[0] && v[3] > v[1]) set(cur.style, v);
    }
    redraw();
  };
  box.onclick = (e) => {
    const z = e.target.closest('[data-z]')?.dataset.z; if (!z) return;
    const cur = get(), vb = cur.view || cur.auto;
    if (z === 'in' || z === 'out') set(cur.style, zoomBBox(vb, z === 'in' ? 1.5 : 1 / 1.5));
    else if (z === 'fit') set(cur.style, null);
    else set({ ...MAP_STYLE }, cur.view);
    redraw();
  };
}

/** Wheel zoom, drag pan and double-click zoom on a map container. get() → {view, auto}; set(bbox); redraw(). */
export function attachMapZoom(el, get, set, redraw) {
  const frameOf = (b) => mapFrame(b, get().style?.proj || 'plate');
  const lonlat = (e, b) => {
    const svg = el.querySelector('svg'); if (!svg) return null;
    const r = svg.getBoundingClientRect(), f = frameOf(b), k = r.width / f.W;
    return f.Pinv((e.clientX - r.left) / k, (e.clientY - r.top) / k);
  };
  let raf = 0;
  const zoomAt = (e, f) => { const c = get(), b = c.view || c.auto; if (!b) return; const p = lonlat(e, b); if (!p || !p.every(Number.isFinite)) return; set(zoomBBox(b, f, p[0], p[1])); cancelAnimationFrame(raf); raf = requestAnimationFrame(redraw); };
  el.addEventListener('wheel', (e) => { if (!el.querySelector('svg')) return; e.preventDefault(); zoomAt(e, e.deltaY < 0 ? 1.2 : 1 / 1.2); }, { passive: false });
  el.addEventListener('dblclick', (e) => zoomAt(e, e.shiftKey ? 1 / 2 : 2));
  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    const svg = el.querySelector('svg'); if (!svg || e.button !== 0) return;
    const c = get(), b = c.view || c.auto; if (!b) return;
    const p0 = lonlat(e, b); if (!p0) return;
    drag = { x: e.clientX, y: e.clientY, b, p0, moved: false }; el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    const svg = el.querySelector('svg');
    if (svg && Math.abs(dx) + Math.abs(dy) > 3) { drag.moved = true; el.classList.add('dragging'); svg.style.transform = `translate(${dx}px, ${dy}px)`; }
  });
  const end = (e) => {
    if (!drag) return; const d = drag; drag = null; el.classList.remove('dragging'); const svg = el.querySelector('svg'); if (svg) svg.style.transform = '';
    if (!d.moved) return;
    const p1 = lonlat(e, d.b); if (!p1 || !p1.every(Number.isFinite)) return;
    set(zoomBBox(d.b, 1, null, null, d.p0[0] - p1[0], d.p0[1] - p1[1])); redraw();
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
}

/** PNG of a map at a chosen width (px); the raster background is downloaded again at that resolution (max. 4096 px). */
export async function exportMapPNG(build, name, width) {
  const prev = bgWidth;
  try {
    bgWidth = Math.min(4096, width);
    let svg = build(); await Promise.all([...bgPromises.values()].map((p) => p.catch(() => {})));
    svg = build(); // second pass uses the high-resolution images now in the cache
    const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); await img.decode();
    const k = width / img.width, c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png')); if (blob) await saveFile(name, blob, 'image/png');
  } finally { bgWidth = prev; }
}

// project map: style and extent are saved with the project (S.geo.map.style, S.geo.map.view)
const geoMapStyle = () => {
  const raw = S.geo.map.style && typeof S.geo.map.style === 'object' && !Array.isArray(S.geo.map.style) ? S.geo.map.style : {};
  const st = { ...MAP_STYLE, ...raw };
  for (const k of ['labelColor', 'pointColor', 'stroke', 'land', 'sea', 'textColor', 'subColor', 'bgColor']) st[k] = validHexColor(st[k], MAP_STYLE[k]);
  S.geo.map.style = st;
  return st;
};
let geoAutoBBox = null;
function refreshProjectMaps() { renderGeoMap(); scheduleFloat(); if (mode === 'fig') renderFigure(); }
const geoMapGet = () => ({ style: geoMapStyle(), view: S.geo.map.view || null, auto: geoAutoBBox });

function renderGeoModel() {
  const box = $('geoModelOut'), st = S.geo.settings, target = geoLayer(st.target), g = S.geo, curC = curClf();
  // V26: comparison of every classifier and family, then the details of the selected one
  let cmp = '';
  if (g.classifiers.length) {
    const rows = g.classifiers.flatMap((c) => c.targets.map((lid) => { const r = geoRT.runs.get(c.id)?.byTarget.get(lid), cv = r?.cv;
      return `<tr data-c="${esc(c.id)}" data-l="${esc(lid)}" class="${c === curC && lid === st.target ? 'sel' : ''}"><td>⚙ ${esc(c.name)}</td><td>${esc(geoLayer(lid)?.name || '')}</td><td>${t('geo.m.name.' + c.method)}</td>
        <td>${cv ? fmt(cv.balancedAccuracy * 100, 1) + ' %' : r?.error ? `<span class="warn">${t(r.error)}</span>` : '—'}</td><td>${cv ? fmt(cv.accuracy * 100, 1) + ' %' : '—'}</td><td>${r?.model?.n ?? '—'}</td></tr>`; })).join('');
    cmp = `<h3>${t('cl.compare')}</h3><div class="tablewrap"><table class="cmpt"><thead><tr><th>${t('cl.clf')}</th><th>${t('cl.family')}</th><th>${t('cl.model')}</th><th title="${esc(t('gx.baccTip'))}">${t('geo.bacc')}</th><th title="${esc(t('gx.accTip'))}">${t('geo.acc')}</th><th>n</th></tr></thead><tbody>${rows}</tbody></table></div><p class="note">${t('cl.compareNote')}</p>`;
  } else { box.innerHTML = `<p class="note">${t('cl.empty')}</p><button class="btn primary" id="geoModelNew">${t('cl.add')}</button>`; $('geoModelNew').onclick = () => newClassifier(); return; }
  const counts = {}; geoRT.labels.forEach((l) => { if (l.label) counts[l.label] = (counts[l.label] || 0) + 1; });
  const nInt = geoRT.labels.filter((l) => l.source === 'interval').length, nRule = geoRT.labels.filter((l) => l.source === 'rule').length;
  const mc = geoRT.model?.isNum || (curC ? clfCols(curC).map((j) => j < (geoRT.nNum ?? 0)) : []), nn = mc.filter(Boolean).length;
  let html = cmp + `<h3>⚙ ${esc(curC?.name || '')} → ${esc(target?.name || '')}</h3><p class="note">${t('geo.modelIntro', { l: esc(target?.name || ''), v: nn, c: mc.length - nn })}</p>`;
  html += `<div class="stat"><div data-tip="${esc(t('gx.tip.samples'))}"><b>${geoRT.samples.length}</b><span>${t('geo.samples')}</span></div><div data-tip="${esc(t('gx.tip.byIv'))}"><b>${nInt}</b><span>${t('geo.byIntervals')}</span></div><div data-tip="${esc(t('gx.tip.byRule'))}"><b>${nRule}</b><span>${t('geo.byRules')}</span></div></div>`;
  html += `<div class="bars">${Object.entries(counts).map(([id, n]) => { const c = geoCat(id); return `<div><span><span class="swatch" style="background:${validHexColor(c?.color, '#777777')}"></span>${esc(c?.name || id)}</span><em>${n}</em></div>`; }).join('')}</div>`;
  if (!geoRT.model || !geoRT.preds.length) { box.innerHTML = html + `<p class="note">${t(geoRT.model ? 'geo.retrain' : 'geo.notTrained')}</p><button class="btn primary" id="geoModelTrain">${t('geo.modelTrain')}</button>`; $('geoModelTrain').onclick = () => curC && geoTrain(false, curC.id); return; }
  html += `<h3>${t('geo.m.name.' + geoRT.model.kind)} · ${t('geo.trainedOn', { n: geoRT.model.n ?? '' })}${geoRT.model.kind === 'mlp' ? ` · ${t('cl.mlpInfo', { s: esc(geoRT.model.sizes.join('–')), e: esc(geoRT.model.epochs) })}` : ''}</h3>`;
  if (geoRT.cv) {
    const cv = geoRT.cv, name = (id) => esc(geoCat(id)?.name || id);
    html += `<p>${t('geo.cvScheme.' + (cv.scheme === 'leave-one-core-out' ? 'loco' : 'blocks'), { k: cv.folds })}: <span data-tip="${esc(t('gx.accTip'))}">${t('geo.acc')} <b>${fmt(cv.accuracy * 100, 1)}%</b></span> · <span data-tip="${esc(t('gx.baccTip'))}">${t('geo.bacc')} <b>${fmt(cv.balancedAccuracy * 100, 1)}%</b></span> (n = ${cv.total})</p>`;
    if (cv.foldBalanced?.n > 1 && cv.foldBalanced.sd != null) html += `<p class="note">${t('cv.fold', { m: fmt(cv.foldBalanced.mean * 100, 1), sd: fmt(cv.foldBalanced.sd * 100, 1), n: cv.foldBalanced.n })}</p>`;
    if (cv.coverage) html += `<p class="note">${t('cv.cover', { p: esc(cv.coverage.minProb), s: fmt(cv.coverage.share * 100, 1), a: cv.coverage.accuracy == null ? '—' : fmt(cv.coverage.accuracy * 100, 1) })}</p>`;
    if (nRule) html += `<p class="note">${t('cv.rules')}</p>`;
    html += `<div class="tablewrap"><table><thead><tr><th data-tip="${esc(t('gx.cmTip'))}">${t('geo.trueVsPred')}</th>${cv.classes.map((c) => `<th>${name(c)}</th>`).join('')}<th>${t('geo.recall')}</th></tr></thead><tbody>${cv.classes.map((c, i) => `<tr><th>${name(c)}</th>${cv.cm[i].map((v, j) => `<td style="${i === j ? 'font-weight:600' : ''}" data-tip="${esc(t(i === j ? 'gx.cmOk' : 'gx.cmBad', { n: v, a: geoCat(c)?.name || c, b: geoCat(cv.classes[j])?.name || cv.classes[j] }))}">${v}</td>`).join('')}<td data-tip="${esc(t('gx.recallTip', { a: geoCat(c)?.name || c, p: fmt((cv.perClass[i].recall ?? 0) * 100, 0) }))}">${fmt((cv.perClass[i].recall ?? 0) * 100, 0)}%</td></tr>`).join('')}</tbody></table></div>`;
    html += `<p class="note">${t('geo.cvNote')}</p>`;
  } else html += `<p class="note">${t('geo.kmeansNote')}</p>${geoRT.model.classes.map((c) => `<label class="f"><span><span class="swatch" style="background:${validHexColor(geoCat(c)?.color, '#777777')}"></span>${esc(c)}</span><input type="text" data-group="${esc(c)}" value="${esc(S.geo.groupNames[c] || '')}" placeholder="${esc(t('geo.groupName'))}"></label>`).join('')}`;
  if (geoRT.model.importance) {
    const imp = geoRT.model.features.map((k, j) => [k, geoRT.model.importance[j]]).sort((a, b) => b[1] - a[1]);
    html += `<h3>${t('geo.importance')}</h3><div class="bars">${imp.map(([k, v]) => `<div><span>${esc(k)}<i style="width:${Math.max(2, v * 100)}%;background:var(--accent)"></i></span><em>${fmt(v * 100, 1)}%</em></div>`).join('')}</div><p class="note">${t('geo.importanceNote')}</p>`;
  }
  html += `<details class="mini"${S.cores.some((c) => c.holdout) ? ' open' : ''}><summary>${t('ft.title')}</summary><p class="note">${t('ft.intro')}</p>${holdoutHTML()}
    ${curC && geoRT.model?.kind !== 'kmeans' ? `<button class="btn small primary" type="button" id="geoFinalBtn">${t('ft.run')}</button>` : ''}${finalTestsHTML('geo')}</details>`;   // V0.49
  box.innerHTML = html;
  $('geoFinalBtn') && ($('geoFinalBtn').onclick = () => { if (confirm(t('ft.confirm'))) runFinalGeo(curC); });
}

/** Interval layers and automatic classes of the image core, as bands of the composite log (overlay between tools). */
export function geoOverlay(axis, view = null) {
  const core = geoCore(S.curCore); if (!core) return {};
  if (view?.eventShade?.on && geoRT.dirty) geoComputeSamples();
  const bands = coreBands(core, axis);
  return { ...(bands.length ? { bands, bandLegend: bandLegendOf(bands) } : {}), ...figureEventShading(core, axis, view?.eventShade) };
}

/** Event wiring and start-up work of this module; called from app.js at the point where this code used to run. */
function initGeoNameResize() {
  const list = $('geoLabels'), scroller = list.parentElement;
  const clamp = (width) => Math.max(60, Math.min(1600, Math.round(width)));
  let width = Number.isFinite(panelPrefs.geo?.classNameW) ? clamp(panelPrefs.geo.classNameW) : null;
  let drag = null;
  const apply = (next) => {
    width = next;
    if (width == null) list.style.removeProperty('--geo-name-width');
    else list.style.setProperty('--geo-name-width', width + 'px');
  };
  const save = () => {
    const prefs = (panelPrefs.geo ||= {});
    if (width == null) delete prefs.classNameW;
    else prefs.classNameW = width;
    savePanels();
  };
  const reset = () => { apply(null); save(); };
  const nameWidth = (handle) => handle.previousElementSibling.getBoundingClientRect().width;
  apply(width);
  list.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.geo-name-handle');
    if (!handle || e.button !== 0 || drag) return;
    drag = { id: e.pointerId, x: e.clientX, scroll: scroller.scrollLeft, start: nameWidth(handle), previous: width };
  });
  document.addEventListener('pointermove', (e) => {
    if (drag?.id !== e.pointerId) return;
    const dx = e.clientX - drag.x + scroller.scrollLeft - drag.scroll;
    if (dx && !list.hasPointerCapture(e.pointerId)) list.setPointerCapture(e.pointerId);
    apply(dx ? clamp(drag.start + dx) : drag.previous);
  });
  document.addEventListener('pointerup', (e) => {
    if (drag?.id !== e.pointerId) return;
    drag = null; save();
  });
  document.addEventListener('pointercancel', (e) => {
    if (drag?.id !== e.pointerId) return;
    apply(drag.previous); drag = null;
  });
  list.addEventListener('dblclick', (e) => { if (e.target.closest('.geo-name-handle')) reset(); });
  list.addEventListener('click', (e) => { if (e.detail === 0 && e.target.closest('.geo-name-handle')) reset(); });
  list.addEventListener('keydown', (e) => {
    const handle = e.target.closest('.geo-name-handle');
    if (!handle || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    apply(clamp(nameWidth(handle) + (e.key === 'ArrowLeft' ? -10 : 10)));
    save();
  });
}

export function initMultiproxy() {
  initGeoNameResize();
  S.geo = defaultGeo();
  document.addEventListener('click', (e) => { if (e.target.closest('[data-tcancel]') && geoTraining) geoTraining.cancel = true; });
  for (const el of document.querySelectorAll('[data-version]')) el.textContent = DELIVERY;
  document.title = `SedCoreTool ${DELIVERY}`;
  $('clfAdd').addEventListener('click', () => newClassifier());
  $('clfDup').addEventListener('click', () => { const c = curClf(); if (c) newClassifier(c); });
  $('clfList').addEventListener('click', (e) => {
    const sec = e.target.closest('.clf'); if (!sec) return;
    const g = S.geo, c = g.classifiers.find((x) => x.id === sec.dataset.id), b = e.target.closest('[data-c]'); if (!c || !b) return;
    const act = b.dataset.c;
    if (act === 'sel') { g.view.clf = c.id; g.view.clfTarget = null; syncCurrent(); renderGeoPanel(); renderGeo(); return; }
    if (act === 'train') { geoTrain(false, c.id); return; }
    if (act === 'results') { g.view.clf = c.id; g.view.tab = 'model'; syncCurrent(); renderGeo(); return; }
    if (act === 'del') { if (!armed(b, t('cl.delConfirm'))) return; g.classifiers = g.classifiers.filter((x) => x !== c); geoRT.runs.delete(c.id); if (!g.classifiers.length) g.clfCleared = true; syncCurrent(); markDirty(); renderGeoPanel(); renderGeo(); return; }
    if (act === 'vall') c.features = null; else if (act === 'vnone') c.features = [];
    else if (act === 'defaults') { c.params[c.method] = {}; c.minProb = 0.5; }
    else return;
    clfOutdated(c); markDirty(); renderClassifiers();
  });
  $('clfList').addEventListener('change', (e) => {
    const sec = e.target.closest('.clf'); if (!sec) return;
    const g = S.geo, c = g.classifiers.find((x) => x.id === sec.dataset.id), el = e.target; if (!c) return;
    const k = el.dataset.c, vars = g.settings.features;
    if (k === 'name') c.name = el.value.trim() || c.name;
    else if (k === 'target') { c.targets = el.checked ? [...new Set([...c.targets, el.value])] : c.targets.filter((x) => x !== el.value); if (c.layers) c.layers = c.layers.filter((x) => !c.targets.includes(x)); }
    else if (k === 'feat') { const cur = new Set(c.features ?? vars); if (el.checked) cur.add(el.value); else cur.delete(el.value); c.features = vars.filter((v) => cur.has(v)); if (c.features.length === vars.length) c.features = null; }
    else if (k === 'lay') { const cur = new Set(c.layers ?? featLayers().map((l) => l.id)); if (el.checked) cur.add(el.value); else cur.delete(el.value); c.layers = [...cur]; }
    else if (k === 'method') c.method = el.value;
    else if (k === 'minProb') c.minProb = Math.max(0, Math.min(1, +el.value || 0));
    else if (k === 'seed') c.seed = Math.round(+el.value) || 0;
    else if (k === 'useRules') c.useRules = el.checked;
    else if (el.dataset.p) { const pk = el.dataset.p; (c.params[c.method] ||= {})[pk] = el.type === 'checkbox' ? el.checked : el.tagName === 'SELECT' ? (isNaN(+el.value) || pk === 'hidden' ? el.value : +el.value) : +el.value; }
    else return;
    if (k === 'minProb') { predictRun(c); syncCurrent(); renderGeo(); } else clfOutdated(c);
    markDirty(); renderClassifiers(); if (k === 'name' || k === 'target') renderGeo();
  });
  $('geoPanel').addEventListener('change', (e) => {
    const el = e.target, g = S.geo, st = g.settings, L = geoLayer(g.activeLayer);
    if (el.closest('#clfList')) return;   // classifiers have their own handler
    if (el.dataset.feat != null) { const k = el.dataset.feat; st.features = el.checked ? [...new Set([...st.features, k])] : st.features.filter((x) => x !== k); }
    else if (el.dataset.log != null) { const k = el.dataset.log; st.logs = el.checked ? [...new Set([...st.logs, k])] : st.logs.filter((x) => x !== k); }
    else if (el.id === 'geoAxis') st.axis = el.value;
    else if (el.id === 'geoStep') st.step = Math.max(1e-6, +el.value || 1);
    else if (el.id === 'geoScaling') st.scaling = el.value;
    else if (el.id === 'geoMissing') st.missing = el.value;
    else if (el.id === 'geoMaxGap') st.maxGap = el.value === '' ? null : +el.value;
    else if (el.id === 'geoUseRules') st.useRules = el.checked;
    else if (el.id === 'geoLayerSel') { g.activeLayer = el.value; renderGeoPanel(); scheduleGeo(); return; }
    else if (el.id === 'geoLayerName') { if (L && el.value.trim()) L.name = el.value.trim(); }
    else if (el.id === 'geoLayerParent') { if (L) L.parent = el.value || null; }
    else if (el.closest('.gcore')) { const c = geoCore(el.closest('.gcore').dataset.id); if (c) c[el.dataset.k] = el.value === '' ? null : +el.value; }
    else if (el.closest('#geoLabels')) {
      const c = L?.cats.find((x) => x.id === el.closest('li').dataset.id);
      if (c) { if (el.type === 'color') c.color = el.value; else c.name = el.value; }
    } else if (el.closest('.rule')) {
      const r = g.rules[+el.closest('.rule').dataset.r], cEl = el.closest('.cond');
      if (cEl) { const c = r.conds[+cEl.dataset.c]; c[el.dataset.k] = el.dataset.k === 'value' ? +el.value : el.value; }
      else if (el.dataset.k === 'enabled') r.enabled = el.checked; else if (el.dataset.k === 'cat') r.cat = el.value;
    } else return;
    geoMarkDirty(); renderGeoPanel(); scheduleGeo();
  });
  $('geoPanel').addEventListener('click', (e) => {
    const b = e.target.closest('button'), g = S.geo; if (!b) return;
    if (b.dataset.act === 'del') { const c = geoCore(b.closest('.gcore').dataset.id); if (c) openCoreDlg(c); return; }
    else if (b.classList.contains('del') && b.closest('#geoLabels')) {
      const id = b.closest('li').dataset.id, L = geoLayer(g.activeLayer), n = g.intervals.filter((q) => q.cat === id).length;
      if (n && !armed(b, t('gx.delCatN', { n }))) return;
      if (g.activeCat === id) g.activeCat = L.cats.find((c) => c.id !== id)?.id;
      L.cats = L.cats.filter((c) => c.id !== id); g.intervals = g.intervals.filter((q) => q.cat !== id); g.rules = g.rules.filter((r) => r.cat !== id);
    } else if (b.dataset.act === 'delrule') g.rules.splice(+b.closest('.rule').dataset.r, 1);
    else if (b.dataset.act === 'addcond') g.rules[+b.closest('.rule').dataset.r].conds.push({ feature: (geoRT.featNames[0] || g.settings.features[0]), op: 'z>', value: 1 });
    else if (b.dataset.act === 'delcond') g.rules[+b.closest('.rule').dataset.r].conds.splice(+b.closest('.cond').dataset.c, 1);
    else return;
    geoMarkDirty(); renderGeoPanel(); scheduleGeo();
  });
  $('geoCores').addEventListener('click', (e) => { const el = e.target.closest('.gcore'); if (el && !e.target.closest('input, button:not(.gcname)')) { S.geo.view.core = el.dataset.id; S.geo.view.tab = 'logs'; renderGeo(); } });
  $('geoLabels').addEventListener('click', (e) => { const li = e.target.closest('li'); if (li && e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') { S.geo.activeCat = li.dataset.id; renderGeoPanel(); renderGeoMarkHint(); } });
  $('geoAddLabel').addEventListener('click', () => {
    const name = $('geoNewLabel').value.trim(), L = geoLayer(S.geo.activeLayer); if (!name || !L) return;
    S.geo.activeCat = addCat(L, name).id; $('geoNewLabel').value = ''; geoMarkDirty(); renderGeoPanel(); renderGeoMarkHint();
  });
  $('geoAddLayer').addEventListener('click', () => {
    const name = $('geoNewLayer').value.trim(); if (!name) return;
    const l = addLayer(name, $('geoNewLayerChild').checked ? S.geo.activeLayer : null);
    S.geo.activeLayer = l.id; $('geoNewLayer').value = ''; geoMarkDirty(); renderGeoPanel(); renderGeoMarkHint();
  });
  $('geoLayerDel').addEventListener('click', (e) => {
    const g = S.geo, L = geoLayer(g.activeLayer); if (!L || g.layers.length < 2) return;
    if (!armed(e.currentTarget, t('confirm.layerDel', { n: g.intervals.filter((q) => q.layer === L.id).length }))) return;
    for (const l of g.layers) if (l.parent === L.id) l.parent = L.parent;
    g.layers = g.layers.filter((l) => l !== L); g.intervals = g.intervals.filter((q) => q.layer !== L.id); g.rules = g.rules.filter((r) => r.layer !== L.id);
    g.activeLayer = g.layers[0].id; geoMarkDirty(); renderGeo();
  });
  $('geoAddRule').addEventListener('click', () => { const g = S.geo; if (!geoLayer(g.activeLayer)?.cats.length) return; g.rules.push({ id: uid(), layer: g.activeLayer, cat: g.activeCat, enabled: true, conds: [{ feature: geoRT.featNames[0] || g.settings.features[0] || allNumericVars()[0], op: 'z>', value: 1 }] }); geoMarkDirty(); renderGeoPanel(); });
  $('geoAddRatio').addEventListener('click', () => { const a = $('geoRatioA').value, b = $('geoRatioB').value; if (a && b && a !== b && !S.geo.ratios.some((r) => r.a === a && r.b === b)) { S.geo.ratios.push({ a, b }); geoMarkDirty(); renderGeoPanel(); } });
  $('geoTrainBtn').addEventListener('click', () => geoTrain());
  $('geoDemo').addEventListener('click', () => busy(loadGeoDemo));
  for (const [id, kind] of [['giFileLong', 'long'], ['giFileCore', 'core'], ['giFileCat', 'catalogue'], ['giFileIv', 'intervals']]) {
    $(id).addEventListener('change', async (e) => {
      const files = [...e.target.files]; e.target.value = ''; if (!files.length) return;
      try { const tabs = await Promise.all(files.map(readTableFile)); openGeoImport(kind, tabs, files.map((f) => f.name.replace(/\.[^.]+$/, ''))); }
      catch (err) { toast(t('rec.err', { m: err.message || err })); }
    });
  }
  $('giCancel').addEventListener('click', () => $('geoImpDlg').close());
  $('giOk').addEventListener('click', () => {
    const p = geoPending; if (!p) return;
    const v = (id) => +$(id).value, H0 = p.tabs[0].headers, g = S.geo;
    if (p.kind === 'catalogue') {
      const n = applyCatalogue(S.cores, p.tabs[0], { core: v('giCore'), lat: v('giLat'), lon: v('giLon'), wd: v('giWd') });
      toast(t('geo.catApplied', { n }));
    } else if (p.kind === 'intervals') {
      const vals = [...$('giVals').querySelectorAll('input:checked')].map((i) => H0[+i.value]);
      let recs = [];
      p.tabs.forEach((tab, k) => {
        const ix = (name) => tab.headers.indexOf(name), def = $('giDefCore').value;
        const coreName = def === '__file' ? p.names[k] : geoCore(def)?.name || p.names[k];
        recs = recs.concat(intervalsFromTable(tab, { core: v('giCore') >= 0 ? ix(H0[v('giCore')]) : -1, from: ix(H0[v('giFrom')]), to: ix(H0[v('giTo')]), layer: v('giLayer') >= 0 ? ix(H0[v('giLayer')]) : -1, values: vals.map(ix).filter((i) => i >= 0) }, coreName));
      });
      if (!recs.length) { toast(t('geo.r.noIv')); return; }
      const nl = addNamedIntervals(recs, $('giIvAxis').value);
      geoComputeSamples();
      toast(t('geo.ivImported', { n: recs.length, l: nl, o: geoRT.orphans.size }));
    } else {
      const prox = [...$('giProx').querySelectorAll('input:checked')].map((i) => H0[+i.value]);
      let added = [];
      p.tabs.forEach((tab, k) => {
        const ix = (name) => tab.headers.indexOf(name);
        const roles = { core: v('giCore') >= 0 ? ix(H0[v('giCore')]) : -1, lat: v('giLat') >= 0 ? ix(H0[v('giLat')]) : -1, lon: v('giLon') >= 0 ? ix(H0[v('giLon')]) : -1, depth: ix(H0[v('giDepth')] ?? '\0'), age: ix(H0[v('giAge')] ?? '\0'), proxies: prox.map(ix).filter((i) => i >= 0) };
        if (roles.depth < 0 && roles.age < 0) return;
        added = added.concat(p.kind === 'long' ? coresFromLongTable(tab, roles) : [coreFromRows(p.names[k], tab.rows, tab.headers, roles)]);
      });
      const rejected = added.filter((c) => !addImported(c, 'import'));
      renderCoreBar();
      toast(rejected.length ? t('geo.mixedImportFailed', { n: rejected.length, names: rejected.map((c) => c.name).join(', ') }) : t('geo.imported', { n: added.length }));
    }
    if (!g.view.core && S.cores.length) g.view.core = S.cores[0].id;
    $('geoImpDlg').close(); geoMarkDirty(); renderGeo();
  });
  document.querySelectorAll('#geoTabs button').forEach((b) => b.addEventListener('click', () => { S.geo.view.tab = b.dataset.tab; renderGeo(); updateTip(); }));
  $('geoCoreSel').addEventListener('change', (e) => { S.geo.view.core = e.target.value; renderGeo(); });
  for (const [id, d] of [['geoCorePrev', -1], ['geoCoreNext', 1]]) $(id).addEventListener('click', () => { const i = S.cores.findIndex((c) => c.id === S.geo.view.core); if (!S.cores.length) return; S.geo.view.core = S.cores[(i + d + S.cores.length) % S.cores.length].id; renderGeo(); });
  $('geoTrackW').addEventListener('input', (e) => { S.geo.view.trackW = +e.target.value; clearTimeout(geoTrackT); geoTrackT = setTimeout(() => { markDirty(); renderGeoLogs(); }, 120); });
  $('geoTrackReset').addEventListener('click', () => { S.geo.view.colW = {}; S.geo.view.trackW = 120; markDirty(); renderGeoLogs(); });
  $('geoShowEmpty').addEventListener('change', (e) => { S.geo.view.showEmpty = e.target.checked; markDirty(); renderGeoLogs(); });
  $('geoShade').addEventListener('change', (e) => { S.geo.view.shade = e.target.checked; markDirty(); renderGeo(); });
  $('geoShadeBy').addEventListener('change', (e) => {
    const v = S.geo.view;
    if (e.target.id === 'geoShadeMode') v.shadeMode = e.target.value;
    else v.shadeBy = [...$('geoShadeBy').querySelectorAll('[data-shby]:checked')].map((i) => i.dataset.shby);
    markDirty(); renderGeo();
  });
  $('geoTestBtn').addEventListener('click', () => busy(geoTestCore));
  $('geoIntervals').addEventListener('click', (e) => {
    const g = S.geo, d = e.target.closest('button')?.dataset; if (!d) return;
    if (d.del) g.intervals = g.intervals.filter((q) => q.id !== d.del);
    else if (d.ok) { const q = g.intervals.find((x) => x.id === d.ok); if (q) delete q.auto; }
    else return;
    geoMarkDirty(); renderGeo();
  });
  $('geoIntervals').addEventListener('change', (e) => {
    const row = e.target.closest('.ivrow'); if (!row) return;
    const q = S.geo.intervals.find((x) => x.id === row.dataset.id), k = e.target.dataset.k; if (!q) return;
    if (k === 'cat') q.cat = e.target.value;
    else { const v = parseFloat(e.target.value); if (!Number.isFinite(v)) return; q[k] = v; if (q.from > q.to) [q.from, q.to] = [q.to, q.from]; }
    geoMarkDirty(); renderGeo();
  });
  $('geoClearAuto').addEventListener('click', (e) => { if (!armed(e.currentTarget)) return; const id = S.geo.view.core; S.geo.intervals = S.geo.intervals.filter((q) => !(q.auto && q.core === id)); geoMarkDirty(); renderGeo(); });
  $('geoIvCsv').addEventListener('click', () => {
    const g = S.geo, rows = [['core', 'layer', 'parent_layer', 'category', 'axis', 'from', 'to', 'automatic', 'outside_parent']];
    for (const q of g.intervals) { const L = geoLayer(q.layer); rows.push([geoCore(q.core)?.name, L?.name, geoLayer(L?.parent)?.name ?? '', geoCat(q.cat)?.name, q.axis, q.from, q.to, q.auto ? 1 : 0, geoRT.orphans.has(q.id) ? 1 : 0]); }
    saveFile(`${safe(S.name)}_intervalos.csv`, withProv(toCSV(rows)), 'text/csv');
  });
  $('geoLogSvg').addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.lgrsz, .ivpop')) return;
    closeIvPop();
    const hit = geoColAt(e); if (!hit || !hit.col.bkey?.startsWith('fam:')) return;
    const G = hit.G, prev = document.createElement('div'); prev.className = 'lgx ivprev'; G.box.append(prev);
    famDrag = { layer: hit.col.bkey.slice(4), a: hit.a, y0: e.clientY, col: hit.col, prev, G };
    e.preventDefault();
  });
  window.addEventListener('pointermove', (e) => {
    if (!famDrag) return;
    const { G, col, prev, y0 } = famDrag, y1 = e.clientY, top = Math.min(y0, y1), h = Math.abs(y1 - y0);
    prev.hidden = h < 3; prev.style.left = G.ox + col.x * G.sc + 'px'; prev.style.width = col.w * G.sc + 'px';
    prev.style.top = top - G.r.top + G.oy + 'px'; prev.style.height = h + 'px';
  });
  window.addEventListener('pointerup', (e) => {
    if (!famDrag) return;
    const d = famDrag; famDrag = null; d.prev.remove();
    const g = S.geo, L = geoLayer(d.layer); if (!L || !geoLast) return;
    if (Math.abs(e.clientY - d.y0) < 4) {   // click: edit the interval at that level
      const q = geoIvAt(L.id, d.a), orig = q && g.intervals.find((x) => x.id === q.id);
      geoSelIv = orig?.id || null; renderIntervalList(geoLast.core);
      if (orig) famPop(e.clientX, e.clientY, orig);
      else ivPop(e.clientX, e.clientY, `<h4>${esc(L.name)}</h4><p class="note">${t('cl.dragHere', { f: esc(L.name) })}</p><div class="row"><button class="btn small ghost" data-pop="close">${t('help.close')}</button></div>`, () => closeIvPop());
      return;
    }
    const v = geoValAt(e) ?? d.a; let a = Math.min(d.a, v), b = Math.max(d.a, v);
    if (L.parent) {   // a subdivision stays inside the parent interval where the drag started
      const par = intervalsOnAxis(g.intervals.filter((q) => q.core === geoLast.core.id && q.layer === L.parent), geoLast.axis, geoLast.core).find((q) => q && d.a >= q.from && d.a < q.to);
      if (par) { a = Math.max(a, par.from); b = Math.min(b, par.to); } else toast(t('geo.orphan', { p: geoLayer(L.parent)?.name || '' }));
    }
    if (!(b > a)) return;
    const cat = L.cats.some((c) => c.id === g.lastCat[L.id]) ? g.lastCat[L.id] : L.cats[0]?.id ?? null;
    const q = { id: uid(), core: geoLast.core.id, layer: L.id, axis: geoLast.axis, from: a, to: b, cat };
    g.intervals.push(q); geoSelIv = q.id; geoMarkDirty(); renderGeo();
    famPop(e.clientX, e.clientY, q);
  });
  $('geoLogSvg').addEventListener('click', (e) => {
    if (!geoLast || e.target.closest('.lgrsz, .ivpop')) return;
    const hit = geoColAt(e); if (!hit?.col.bkey?.startsWith('auto:')) return;
    autoPop(e.clientX, e.clientY, hit.col.bkey, hit.a);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeIvPop(); if (cropState) endCrop(); } });
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.ivpop, #geoLogSvg')) closeIvPop(); });
  attachMapZoom($('geoMapSvg'), geoMapGet, (b) => { S.geo.map.view = b; markDirty(); }, refreshProjectMaps);
  $('geoMapCtl').addEventListener('change', (e) => {
    const m = S.geo.map, el = e.target, num = (v) => (v === '' ? null : +v);
    if (el.id === 'gmA0') m.a0 = num(el.value); else if (el.id === 'gmA1') m.a1 = num(el.value); else if (el.id === 'gmMode') m.mode = el.value; else if (el.id === 'gmSrc') m.src = el.value;
    else if (el.id === 'gmFeature') m.feature = el.value; else if (el.id === 'gmIdw') m.idw = el.checked; else if (el.id === 'gmPower') m.power = +el.value;
    else if (el.id === 'gmRef') m.ref = el.checked; else if (el.id === 'gmR0') m.r0 = +el.value; else if (el.id === 'gmR1') m.r1 = +el.value;
    markDirty(); renderGeoMap();
  });
  for (const [id, dir] of [['gmPrev', -1], ['gmNext', 1]]) $(id).addEventListener('click', () => { const m = S.geo.map, w = m.a1 - m.a0; m.a0 += dir * w; m.a1 += dir * w; markDirty(); renderGeoMap(); });
  $('gmPng').addEventListener('click', () => busy(() => exportMapPNG(() => renderGeoMap() || '', `${safe(S.name)}_mapa_${S.geo.map.a0}-${S.geo.map.a1}.png`, +$('gmPngW').value)));
  $('gmBig').addEventListener('click', () => { $('work').classList.toggle('mapwide'); $('gmBig').setAttribute('aria-pressed', String($('work').classList.contains('mapwide'))); placeSplitters(); renderGeoMap(); });
  $('gmFull').addEventListener('click', () => { const el = $('geoMapSvg'); if (document.fullscreenElement) document.exitFullscreen(); else el.requestFullscreen?.().catch(() => toast(t('ms.noFull'))); });
  $('gmSvg').addEventListener('click', () => { if (geoLastMap) saveFile(`${safe(S.name)}_mapa_${S.geo.map.a0}-${S.geo.map.a1}.svg`, geoLastMap.svg, 'image/svg+xml'); });
  $('gmCsv').addEventListener('click', () => {
    if (!geoLastMap) return;
    const rows = [['core', 'lat', 'lon', 'n_samples', 'dominant_class', 'fraction', 'value']];
    for (const p of geoLastMap.pts) rows.push([p.name, p.lat, p.lon, p.n, p.dominant ? geoCat(p.dominant)?.name : null, p.fraction, p.value]);
    saveFile(`${safe(S.name)}_mapa_${S.geo.map.a0}-${S.geo.map.a1}.csv`, withProv(toCSV(rows)), 'text/csv');
  });
  $('geoModelOut').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-c]'); if (!tr) return; S.geo.view.clf = tr.dataset.c; S.geo.view.clfTarget = tr.dataset.l; syncCurrent(); renderGeoPanel(); renderGeoModel(); });
  $('geoModelOut').addEventListener('change', (e) => { const g = e.target.dataset.group; if (!g) return; S.geo.groupNames[g] = e.target.value; markDirty(); scheduleLog(); });
  $('geoPredCsv').addEventListener('click', () => {
    if (!geoRT.samples.length) return;
    const st = S.geo.settings, rows = [['core', st.axis, 'depth', 'age', ...geoRT.featNames, 'label', 'label_source', 'predicted', 'probability']];
    geoRT.samples.forEach((s, i) => rows.push([geoCore(s.core)?.name, s.x, s.depth, s.age, ...s.raw, geoCat(geoRT.labels[i]?.label)?.name ?? '', geoRT.labels[i]?.source ?? '', geoCat(geoRT.preds[i]?.label)?.name ?? '', geoRT.preds[i]?.prob]));
    saveFile(`${safe(S.name)}_clasificacion_intervalos.csv`, withProv(toCSV(rows)), 'text/csv');
  });
}
