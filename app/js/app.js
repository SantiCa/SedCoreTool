// SedCoreTool web (antes CorAnTool e IchAnTool) — application (UI, state, tools, rendering, files).
import { rleValid, baconToAgeText, BI, II, UNIT_TO_CM, idsAt, topAt, hasId, stackIndex, codeFor, withoutId, renameId, compactStacks, parseAgeModel, parseAgeModelDetailed, interpAge, toCSV, rleEncode, rleDecode } from './core.js';
import { pxPerCm, depthAtRow, rowAtDepth } from './sectiondepth.js';
import { effectiveClassId, effectiveClassIndex, computeSectionBins, binRowsOfSection } from './sectionanalysis.js';
import { createEngineClient } from './engineclient.js';
import { createEngineAnalysis } from './engineanalysis.js';
import { createMaskChanges, indexRangeOfPairs } from './maskchanges.js';
export { pxPerCm, depthAtRow, rowAtDepth };
import { withProvenance, ageModelText, bioturbationTable, objectsTable } from './exportio.js';

import { DEFAULT_FILTERS, FILTER_PRESETS, DEFAULT_DETECT, traceSeparation, localSeparability, applyFilters, detectMask, components, regionGrow, polygonPixels, objectStats, features, rotate90, downsampleRGBA, autoLevels, gammaForMedian } from './imageproc.js';
import { parseTable, decodeText, invertModel, toAxis, compositeRows, abbrevs, traceSymbolPath, validHexColor } from './log.js';
import { storageAvailable, listProjects, getProject, putProject, putMeta, deleteProject, getPref, setPref, putLite, listLite, getMeta, putImage, getImage, gcImages } from './storage.js';
import { INTERP_DEFAULT } from './interp.js';

import { evalColumn, formulaRefs, fillLinear } from './sheet.js';
import { TaxonModel, evaluateModels, finalTestMetrics, independentExternalExamples, descriptorSig, vec, FEATURES } from './learn.js';
import { splitPieces, mergeKeeper, sameTaxonGroups, swapHistoryPixels, trimEditHistory, upgradeProject, validSavedRegion, hasBrokenMaskRefs } from './edit.js';
import { t, lang, setLang, applyI18n, fxText } from './i18n.js';
import { initializeDiagnostics, diagnosticEvent, diagnosticOperation, renderDiagnosticStatus } from './diagnostics.js';
import { zipFiles, unzipBlob } from './zip.js';
import { decodeTiffBlocks } from './tiff.js';
import { IGNORE, doubtful, trainingMask, cropRGBA } from './unet.js';
import { createUnetController } from './unetmodel.js';
import { VISION_MODEL, visionFeatureId, traceWindow, traceInput, pickEmbedding } from './vision.js';
import { coresFromLongTable, applyCatalogue, coreAges, intervalsOnAxis, intervalsFromTable, fitModel, buildMapSVG, mapBBox, predictProba, MAP_STYLE, MAP_SYMBOLS, fitBBoxAspect, validMapCoords } from './geo.js';
import { $, APP, APP_NAMES, CLF_SCOPES, ML_DEFAULT, S, VERSION, clsById, defaultClasses, fetchAsset, fmt, hex, hideMissingExamples, keyOf, sec, uid } from './state.js';
import { figTabsData, loadFigTabs, renderFigPanel, renderFigure, resetFigTabs, scheduleFigure, traceCanvas } from './figures.js';
import { renderData } from './datatab.js';
import { frameRatio, panelPrefs, savePanels } from './panels.js';
import { addRecordFromTable, defaultLogView, lastLog, mode, renderLog, renderLogPanel, renderRecList, scheduleLog, sectionCanvas, navigationPreviewCanvas, clearNavigationPreviews, setMode } from './columns.js';
import { GROUP_COLORS, addImported, addNamedIntervals, attachMapZoom, coreListUI, defaultGeo, exportMapPNG, geoComputeSamples, geoLand, geoLayer, geoMarkDirty, geoRT, geoReset, geoTrain, interpUI, loadGeoDemo, loadLand, mapBackground, mapStyleUI, mapTip, normalizeGeo, renderGeo, renderGeoMap, scheduleGeo, valueLayer, initMultiproxy } from './multiproxy.js';
/** Delivery number (V27…): shown in the header, the start screen, the help, the window title, project files and the name of the offline file. */
export const DELIVERY = 'V0.150';
/* V0.17: input of the ichnotaxon classifier — 12 shape/colour descriptors ('shape') or the vector of a pre-trained
   vision model ('vision', DINOv2). Vectors of the two sets are never mixed. */
const visionOn = () => (S.settings.ml?.features || 'shape') === 'vision';
const featNames = () => (visionOn() ? visionFeatureId() : FEATURES);
const xOf = (o) => (visionOn() ? o.emb || null : o.feat ? vec(o.feat) : null);
const xOfLib = (e) => (visionOn() ? e.xv : e.x);
const mlOpt = () => { const m = { ...ML_DEFAULT, ...(S.settings.ml || {}) };
  return { method: m.method, k: m.k, weights: m.weights, novelty: S.settings.novelty, seed: 42, fitFn: fitModel, probaFn: predictProba, features: featNames(),
    rf: { trees: m.trees, maxDepth: m.maxDepth, minLeaf: m.minLeaf, balanced: m.balanced }, nb: { priors: m.priors } }; };
const mkModel = () => new TaxonModel(mlOpt());
const clfs = { core: new TaxonModel(), project: new TaxonModel(), all: new TaxonModel() };
let clf = clfs.project, otherExamples = [], mlReservedDropped = 0, mlExcluded = new Set(), mlEval = null;
getPref('ml.excluded').then((v) => { mlExcluded = new Set(v || []); }).catch(() => {});

/* ───────────── sections ───────────── */

/**
 * V0.1: `file` holds the original picture at full resolution — in memory (`blob`) only until it is written to the
 * image store (`key`). `crop` is the kept area in full-resolution pixels of the unrotated file (null = whole file);
 * `full` the file size. The working image is rotate(downsample(crop(file), ds), rot); it is decoded only while needed.
 * `labels`/`exclude` are packed (RLE) when the section is not in use and unpacked on first access.
 */
function newSection({ name, file, w, h, orig, orig16 = null, ds = 1, labels = null, exclude = null, full = null }) {
  if (file.bytes && !file.blob) { file = { name: file.name, type: file.type, blob: new Blob([file.bytes], { type: file.type || 'image/jpeg' }) }; }
  const s = {
    id: uid(), name, file, rot: 0, ds, crop: null, full, logVer: 0, w, h, orig, orig16, enh: null,
    objects: new Map(), nextId: 1, nextTraceOrder: 0, stacks: [null],   // V0.20: overlapping traces (core.js)
    top: 0, bottom: 100, units: 'cm', roi: { x0: 0, y0: 0, x1: w, y1: h }, marks: [],
    filters: { ...DEFAULT_FILTERS }, preset: 'none', detect: { ...DEFAULT_DETECT }, manual: [], bins: [], view: null,
  };
  lazyMask(s, 'labels', Int32Array, labels); lazyMask(s, 'exclude', Uint8Array, exclude);
  enhance(s);
  if (orig) pxTouch(s);
  // lazyMask installs the labels and exclude accessors before the section is exposed.
  return /** @type {typeof s & import('./state.js').SectionState} */ (s);
}

/** Which rows of each section's masks changed since the engine last received them (maskchanges.js). A hint for the engine path, see there. */
const maskChanges = createMaskChanges();

/* ───────────── V0.1: images on disk, pixels in memory only while a section is in use ───────────── */
const MEM = { px: [], mask: [], pinned: new Set(), pxBudget: 9e8, maskBudget: 5e8 };
/** A mask layer stored packed (RLE array) and unpacked on first access; `init` = array, { rle } or null (empty). */
function lazyMask(s, key, Type, init) {
  let arr = init && !init.rle ? init : null, rle = init?.rle || null;
  if (!arr && !rle) arr = new Type(s.w * s.h);
  Object.defineProperty(s, key, {
    enumerable: true, configurable: true,
    get() { if (!arr) { arr = rleDecode(rle, s.w * s.h, Type); rle = null; maskTouch(s); } return arr; },
    set(v) { arr = v; rle = null; s._mv = (s._mv || 0) + 1; maskChanges.markAll(s); },
  });
  // V0.2: the RLE of an unchanged mask is reused (saving no longer re-encodes every section every time)
  let cache = null;
  const enc = () => { if (rle) return rle; const v = `${s._mv || 0}|${s.w}x${s.h}`; if (cache?.v !== v) cache = { v, rle: rleEncode(arr) }; return cache.rle; };
  (s._mk ||= {})[key] = { pack() { if (arr) { rle = enc(); arr = null; } }, rle: enc, loaded: () => !!arr };
}
const lruPush = (list, s) => { const i = list.indexOf(s); if (i >= 0) list.splice(i, 1); list.push(s); };
const keepLoaded = (s) => s === sec() || MEM.pinned.has(s) || s._loading;
function maskTouch(s) {
  lruPush(MEM.mask, s);
  const bytes = () => MEM.mask.reduce((a, x) => a + 5 * x.w * x.h, 0);
  for (let i = 0; i < MEM.mask.length && MEM.mask.length > 3 && bytes() > MEM.maskBudget;) {
    const x = MEM.mask[i];
    if (x === s || keepLoaded(x)) { i++; continue; }
    x._mk.labels.pack(); x._mk.exclude.pack(); MEM.mask.splice(i, 1);
  }
}
function pxTouch(s) {
  lruPush(MEM.px, s);
  // V0.41: besides original + enhanced (8 B/px) it counts the U-Net probabilities (4 B/px) and the cached pictures
  const cv = (c) => (c ? 4 * c.width * c.height : 0);
  const one = (x) => 8 * x.w * x.h + (x.orig16?.byteLength || 0) + (x._unet?.prob?.byteLength || 0) + cv(x._lc?.canvas) + cv(x._lb?.canvas) + [...(x._fc?.values() || [])].reduce((a, r) => a + cv(r.canvas), 0);
  const bytes = () => MEM.px.reduce((a, x) => a + one(x), 0);
  for (let i = 0; i < MEM.px.length && MEM.px.length > 1 && bytes() > MEM.pxBudget;) {
    const x = MEM.px[i];
    if (x === s || keepLoaded(x)) { i++; continue; }
    x.orig = null; x.orig16 = null; x.enh = null; x._unet = null; x._fc = null; MEM.px.splice(i, 1);
  }
}
/** The original file of a section as a Blob (from memory if not yet stored, else from the image store on disk). */
async function sectionBlob(s) {
  if (s.file.blob) return s.file.blob;
  const b = s.file.key ? await getImage(s.file.key, isTiffImage(s.file.name, s.file.type)) : null;
  if (!b) throw new Error(t('err.imgMissing', { n: s.name }));
  return b;
}
/** Working image of a section at factor k (crop and rotation applied). */
async function decodeWorking(s, k) {
  let { w, h, rgba, rgba16, fw, fh } = await decodeBytes(await sectionBlob(s), s.file.name, s.file.type, { k, crop: s.crop });
  for (let r = 0; r < ((s.rot % 4) + 4) % 4; r++) { rgba = rotate90(rgba, w, h, 4, 1); if (rgba16) rgba16 = rotate90(rgba16, w, h, 4, 1); [w, h] = [h, w]; }
  if (!s.full) s.full = { w: fw, h: fh };
  return { w, h, rgba, rgba16 };
}
/** Decode the pixels of a section if they are not in memory. */
function ensurePixels(s) {
  if (s.orig) { pxTouch(s); return Promise.resolve(s); }
  if (s._loading) return s._loading;
  s._loading = (async () => {
    const r = await decodeWorking(s, s.ds);
    if (r.w !== s.w || r.h !== s.h) console.warn('image size differs from the stored masks', s.name, r.w, r.h, s.w, s.h);
    // V0.44: the enhancement of a section being opened is computed in the worker; orig and enh are set together
    const input = r.rgba16 || r.rgba;
    const f = effectiveFilters({ filters: s.filters, orig: input, w: r.w, h: r.h, roi: s.roi });
    const enh = await offload('filters', { rgba: input, w: r.w, h: r.h, f }, () => applyFilters(input, r.w, r.h, f));
    s.orig = r.rgba; s.orig16 = r.rgba16 || null; s.enh = enh;
    return s;
  })().catch((e) => { s._pxErr = e.message || String(e); toast(s._pxErr); throw e; }).finally(() => { s._loading = null; if (s.orig) pxTouch(s); });
  return s._loading;
}
/** Sections whose pictures a view asked for while they were not in memory: loaded two at a time, then the views redrawn. */
const pxWanted = new Set(); let pxBusy = false;
export function needPixels(s) { if (s._pxErr) return; pxWanted.add(s); if (!pxBusy) setTimeout(loadWanted, 0); }
async function loadWanted() {
  if (pxBusy) return; pxBusy = true;
  try {
    while (pxWanted.size) {
      const batch = [...pxWanted].slice(0, 2); batch.forEach((x) => pxWanted.delete(x));
      for (const x of batch) { MEM.pinned.add(x); try { await ensurePixels(x); } catch (e) { console.error(e); } }
      try { rerenderPixelViews(); } finally { batch.forEach((x) => MEM.pinned.delete(x)); }
    }
  } finally { pxBusy = false; }
}
function rerenderPixelViews() {
  requestRender();
  if (mode === 'log') renderLog();
  if (mode === 'fig') { renderFigPanel(); renderFigure(); }
}
/** Run fn(s) with the section's pixels in memory (they may be released afterwards). */
async function withPixels(s, fn) { MEM.pinned.add(s); try { await ensurePixels(s); return await fn(s); } finally { MEM.pinned.delete(s); } }
/** Write to the image store the originals that are still only in memory (new or legacy sections). */
async function storePendingImages() {
  for (const c of S.cores) for (const s of c.sections) {
    if (s.file.key || !s.file.blob) continue;
    const key = 'img_' + uid();
    await putImage(key, s.file.blob);
    s.file = { name: s.file.name, type: s.file.type, key, size: s.file.blob.size };
  }
}
/**
 * Replace inline images (bytes / base64) of a project file by references to the image store. V0.8: images of a
 * package or project folder (`file.path`) are read with getBlob(path).
 */
async function internImages(p, getBlob = null) {
  for (const c of p.cores || [{ sections: p.sections }]) for (const q of c.sections || []) {
    if (q.file.path && getBlob) {
      const blob = await getBlob(q.file.path); if (!blob) throw new Error(t('err.imgMissing', { n: q.name }));
      const b = new Blob([blob], { type: q.file.type || 'image/jpeg' });
      if (storageOK) { const key = 'img_' + uid(); await putImage(key, b); q.file = { name: q.file.name, type: q.file.type, key, size: b.size }; }
      else q.file = { name: q.file.name, type: q.file.type, blob: b };
      continue;
    }
    if (!storageOK) continue;
    if (q.file.key || !(q.file.bytes || q.file.b64)) continue;
    const bytes = q.file.bytes ? new Uint8Array(q.file.bytes) : b64decode(q.file.b64), key = 'img_' + uid();
    await putImage(key, new Blob([bytes], { type: q.file.type || 'image/jpeg' }));
    q.file = { name: q.file.name, type: q.file.type, key, size: bytes.length };
  }
  return p;
}

function effectiveFilters(s) {
  const f = s.filters; if ((!f.autoLevels && !f.autoGamma) || !s.orig) return f;
  const a = autoLevels(s.orig16 || s.orig, s.w, s.h, s.roi), out = { ...f };
  if (f.autoLevels) { out.blackPoint = a.blackPoint; out.whitePoint = a.whitePoint; }
  if (f.autoGamma) out.gamma = +gammaForMedian(a.median, out.blackPoint, out.whitePoint).toFixed(2);
  return out;
}
function enhance(s) { s.enh = s.orig ? applyFilters(s.orig16 || s.orig, s.w, s.h, effectiveFilters(s)) : null; }

/* V0.41: background worker for enhancement and detection; without it (offline single file, file://, old browser)
 * the same functions run on the main thread. */
let WK = null, wkSeq = 0, filterQueue = Promise.resolve();
const wkWait = new Map();
function worker() {
  if (WK !== null) return WK || null;
  try {
    if (location.protocol === 'file:' || typeof Worker === 'undefined') throw new Error('no worker');
    WK = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    WK.onmessage = ({ data }) => {
      const q = wkWait.get(data.id);
      if (!q) return;
      if (data.more) {
        try { q.sendChunk(); } catch (err) {
          wkWait.delete(data.id);
          WK.postMessage({ id: data.id, op: 'cancelFilter' });
          q.rej(err);
        }
        return;
      }
      wkWait.delete(data.id);
      if (data.err) q.rej(new Error(data.err)); else q.res(data.r);
    };
    WK.onerror = (e) => { e.preventDefault?.(); for (const q of wkWait.values()) q.fallback(); wkWait.clear(); WK.terminate(); WK = false; };
  } catch { WK = false; }
  return WK || null;
}
/** One enhancement job at a time bounds the number of live destination rasters. */
function offload(op, a, fallback) {
  if (op !== 'filters') return runWorker(op, a, fallback);
  const job = filterQueue.then(() => runWorker(op, a, fallback));
  filterQueue = job.catch(() => {});
  return job;
}

/** Run in the worker, sending enhancement input one transferable chunk at a time. */
function runWorker(op, a, fallback) {
  const w = worker(); if (!w) return Promise.resolve().then(fallback);
  return new Promise((res, rej) => {
    const id = ++wkSeq;
    const q = { res, rej, fallback: () => { try { res(fallback()); } catch (e) { rej(e); } } };
    wkWait.set(id, q);
    try {
      if (op === 'filters') {
        const { rgba, w: width, h, f } = a;
        const samples = (1024 * 1024) / rgba.BYTES_PER_ELEMENT;
        let offset = 0;
        q.sendChunk = () => {
          const chunk = rgba.slice(offset, Math.min(offset + samples, width * h * 4));
          offset += chunk.length;
          w.postMessage({ id, op: 'filterChunk', a: { rgba: chunk } }, [chunk.buffer]);
        };
        w.postMessage({ id, op, a: { w: width, h, f, wide: rgba instanceof Uint16Array } });
      } else w.postMessage({ id, op, a });
    } catch (err) {
      wkWait.delete(id);
      rej(err);
    }
  });
}
/** Enhancement in the background; only the latest request of a section is applied. */
function enhanceAsync(s) {
  if (!s.orig) { s.enh = null; return Promise.resolve(); }
  const f = effectiveFilters(s), gen = (s._eg = (s._eg || 0) + 1), orig = s.orig;
  const input = s.orig16 || orig, { w, h } = s;
  return offload('filters', { rgba: input, w, h, f }, () => applyFilters(input, w, h, f)).then((r) => { if (s._eg === gen && s.orig === orig) s.enh = r; return s._eg === gen; });
}

/* ───────────── image files ───────────── */

/** V0.14: the libraries ship with the program (app/vendor); the internet copy is only a fallback (e.g. single offline file). */
const ORT_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/';   // V0.15: U-Net engine (desktop build copies it to vendor/ort)
// V0.40: internet fallback pinned with Subresource Integrity (hashes of the npm files that jsDelivr serves; the
// bundled copies in app/vendor are byte-identical). V0.45: SheetJS is verified against its official CDN build.
const VENDOR = {
  'pako.min.js': ['https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js', 'sha384-rNlaE5fs9dGIjmxWDALQh/RBAaGRYT5ChrzHo6tRfgrZ36iRFAiquP5g41Jsv+0j'],
  'UTIF.js': ['https://cdn.jsdelivr.net/npm/utif@3.1.0/UTIF.js', 'sha384-RyBmXHdfZ/Uon+ud+/AqSyWpUWnKYt2tkRG/P4gWoRUGDU+qIAV3tGBPNlYTBZEF'],
  'xlsx.full.min.js': ['https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js', 'sha384-EnyY0/GSHQGSxSgMwaIPzSESbqoOLSexfnSMN2AP+39Ckmn92stwABZynq1JyzdT'],
  'ort/ort.wasm.min.js': [ORT_CDN + 'ort.wasm.min.js', 'sha384-tNxIwEqSlcdvKtUte98AsccPbDKM958LBXB/+3BLS42TTihXHKTWgdqPqXI/lot8'],
};
/** Loads a library from app/vendor, else from the internet; resolves to 'local' or 'cdn'. */
export function loadLib(file) { return loadScript(`vendor/${file}`).then(() => 'local', () => loadScript(...VENDOR[file]).then(() => 'cdn')); }
function loadScript(src, integrity = null) {
  return new Promise((res, rej) => {
    const el = document.createElement('script'); el.src = src; el.onload = res;
    if (integrity) { el.integrity = integrity; el.crossOrigin = 'anonymous'; }
    el.onerror = () => rej(new Error('library unavailable: ' + src)); document.head.appendChild(el);
  });
}

/**
 * Decode an image file (Blob or bytes) to the working image: optional crop (full-resolution pixels) and block
 * averaging by factor k (given, or chosen from maxMP). Returns { w, h, rgba, k, fw, fh } (fw × fh = file size).
 */
const isTiffImage = (name, type) => /\.(?:tiff?|tf8|btf)$/i.test(name) || /tiff/i.test(type || '');

async function decodeBytes(bytes, name, type, opt = {}) {
  const factor = (w, h) => opt.k ?? Math.max(1, Math.ceil(Math.sqrt((w * h) / ((opt.maxMP || 1e9) * 1e6))));
  const area = (fw, fh) => { const c = opt.crop; return c ? { x: Math.max(0, c.x0), y: Math.max(0, c.y0), w: Math.min(fw, c.x1) - Math.max(0, c.x0), h: Math.min(fh, c.y1) - Math.max(0, c.y0) } : { x: 0, y: 0, w: fw, h: fh }; };
  if (isTiffImage(name, type)) {
    const source = bytes instanceof Uint8Array ? new Blob([bytes]) : bytes;
    const decoded = await decodeTiffBlocks(source, area, factor);
    if (decoded.rgba) return decoded;
    if (source.size + decoded.legacyBytes > 64 * 1024 * 1024) throw new Error(t('err.largeTiffLayout'));
    if (!window.UTIF) {
      await loadLib('pako.min.js').catch(() => {});
      await loadLib('UTIF.js');
    }
    const buf = await source.slice(0, source.size).arrayBuffer();
    const ifds = window.UTIF.decode(buf);
    window.UTIF.decodeImage(buf, ifds[0], ifds);
    const fw = ifds[0].width, fh = ifds[0].height, A = area(fw, fh), k = factor(A.w, A.h);
    let rgba = window.UTIF.toRGBA8(ifds[0]);
    rgba = new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length);
    if (opt.crop) { const sub = new Uint8ClampedArray(A.w * A.h * 4); for (let y = 0; y < A.h; y++) sub.set(rgba.subarray(((A.y + y) * fw + A.x) * 4, ((A.y + y) * fw + A.x + A.w) * 4), y * A.w * 4); rgba = sub; }
    const r = downsampleRGBA(rgba, A.w, A.h, k);
    return { ...r, k, fw, fh };
  }
  const url = URL.createObjectURL(bytes instanceof Blob ? bytes : new Blob([bytes], { type: type || 'image/jpeg' }));
  try {
    const img = new Image(); img.src = url; await img.decode();
    const fw = img.naturalWidth, fh = img.naturalHeight, A = area(fw, fh), w = A.w, h = A.h, k = factor(w, h);
    const W = Math.floor(w / k), Hh = Math.floor(h / k), out = new Uint8ClampedArray(W * Hh * 4);
    const stripH = Math.max(k, Math.floor(Math.min(h, 4e6 / w) / k) * k);
    const c = document.createElement('canvas'); c.width = w; c.height = stripH;
    const x = c.getContext('2d', { willReadFrequently: true });
    for (let y = 0; y < Hh * k; y += stripH) {
      const sh = Math.min(stripH, Hh * k - y);
      x.clearRect(0, 0, w, stripH); x.drawImage(img, A.x, A.y + y, w, sh, 0, 0, w, sh);
      out.set(downsampleRGBA(x.getImageData(0, 0, w, sh).data, w, sh, k).rgba, (y / k) * W * 4);
    }
    c.width = c.height = 0;
    return { w: W, h: Hh, rgba: out, k, fw, fh };
  } finally { URL.revokeObjectURL(url); }
}

function b64decode(str) { const s = atob(str), out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; }

/**
 * V0.2: images are always added to a project and to a core chosen by the user (asked each time).
 * Returns the core id, or null if cancelled.
 */
function pickCore(n) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    const opts = S.cores.map((c) => `<option value="${c.id}" ${c.id === S.curCore ? 'selected' : ''}>${esc(c.name)} (${t('home.nImg', { n: c.sections.length })})</option>`).join('');
    dlg.innerHTML = `<form method="dialog" style="display:grid;gap:10px;min-width:320px"><h3 style="margin:0">${esc(t('sec.pickCoreTitle', { n }))}</h3>
      <label class="f"><span>${esc(t('sec.pickCore'))}</span><select id="pcSel">${opts}<option value="__new">${esc(t('sec.newCore'))}</option></select></label>
      <label class="f" id="pcNewBox" hidden><span>${esc(t('sec.newCoreName'))}</span><input type="text" id="pcNew"></label>
      <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn" value="cancel">${esc(t('cl.cancel'))}</button><button class="btn primary" value="ok" id="pcOk">${esc(t('sec.addHere'))}</button></div></form>`;
    document.body.appendChild(dlg);
    const sel = dlg.querySelector('#pcSel'), box = dlg.querySelector('#pcNewBox'), inp = dlg.querySelector('#pcNew');
    sel.addEventListener('change', () => { box.hidden = sel.value !== '__new'; if (!box.hidden) inp.focus(); });
    dlg.addEventListener('close', () => {
      let id = null;
      if (dlg.returnValue === 'ok') {
        if (sel.value === '__new') { const name = inp.value.trim(); if (name) { const c = makeCore({ name }); S.cores.push(c); id = c.id; } }
        else id = sel.value;
      }
      dlg.remove(); resolve(id);
    });
    dlg.showModal();
  });
}
async function addFiles(files) {
  if (!files.length) return;
  if (blankStart) { toast(t('sec.needProject')); await showHome(); $('newProjOpen').click(); return; }   // V0.2: no images outside a project
  const coreId = await pickCore(files.length); if (!coreId) return;
  if (coreId !== S.curCore) activateCore(coreId);
  for (const file of files) {
    await busy(async () => {
      try {
        const blob = file;
        const { w, h, rgba, rgba16, k, fw, fh } = await decodeBytes(blob, file.name, file.type, { maxMP: S.settings.maxMP });
        const s = newSection({ name: file.name.replace(/\.[^.]+$/, ''), file: { name: file.name, type: file.type, blob }, w, h, orig: rgba, orig16: rgba16, ds: k, full: { w: fw, h: fh } });
        const prev = sec();
        if (prev) { s.units = prev.units; s.top = prev.bottom; s.bottom = prev.bottom + (prev.bottom - prev.top); s.filters = { ...prev.filters }; s.preset = prev.preset; s.detect = { ...prev.detect }; enhance(s); }
        S.sections.push(s);
        selectSection(S.sections.length - 1, true); markDirty();
      } catch (e) { toast(t('err.image', { m: e.message || e })); }
    });
  }
  if (files.length === 1 && sec()) startCrop();   // V31: offer to cut scale bars or labels off a new image
}

async function loadExample() {
  for (const url of ['data/idealized_core_0-500cm.jpg']) {
    try {
      const bytes = new Uint8Array(await (await fetchAsset(url)).arrayBuffer());
      if (!(await canLeaveProject())) return false;
      resetState(); S.name = t('example.name');
      const { w, h, rgba } = await decodeBytes(bytes, url, 'image/jpeg', { k: 1 });
      const s = newSection({ name: t('example.name'), file: { name: 'idealized_core_0-500cm.jpg', type: 'image/jpeg', bytes }, w, h, orig: rgba, full: { w, h } });
      s.top = 0; s.bottom = 500; s.units = 'cm';
      s.detect = { ...DEFAULT_DETECT, method: 'global', polarity: 'dark', threshold: 6, minArea: 1, smooth: 0 };
      S.settings.binCm = 150 / pxPerCm(s);
      S.sections.push(s); syncSettingsForm(); selectSection(S.sections.length - 1, true);
      await detectSection(s); updateProjHeader(); renderRecList(); setAge(); await saveToDB();
      return true;
    } catch (e) { console.error('loadExample', e); }
  }
  return false;
}

/* ───────────── objects, undo ───────────── */

function newObject(op, cls, src) {
  const s = op.s;
  rememberTrace(op, s.nextId);
  const order = s.objects.get(s.nextId)?.order ?? s.nextTraceOrder++;
  const o = { id: s.nextId++, order, cls: cls || null, pred: null, conf: 0, src, area: 0, bbox: null, stats: null, feat: null };
  s.objects.set(o.id, o);
  return o;
}

/** Save the first value only. Geometry and descriptor data are replaced by edits and can be shared.
 * @param {import('./state.js').UndoStep} op
 * @param {number} id
 */
function rememberTrace(op, id) {
  if (op.objs.has(id)) return;
  const trace = op.s.objects.get(id);
  op.objs.set(id, trace ? { ...trace } : null);
}

/** @param {import('./state.js').UndoStep} op
 * @param {number} id
 */
function removeTrace(op, id) {
  rememberTrace(op, id);
  op.s.objects.delete(id);
}

/** @param {import('./state.js').UndoStep} op */
function swapHistoryTraces(op) {
  const { s, objs } = op;
  const removed = [];
  for (const [id, previous] of objs) {
    const current = s.objects.get(id);
    objs.set(id, current ? { ...current } : null);
    if (!previous) s.objects.delete(id);
    else if (current?.order === previous.order) s.objects.set(id, previous);
    else {
      s.objects.delete(id);
      removed.push(previous);
    }
  }
  if (!removed.length) return;

  // Restore removed traces at their original positions, including in projects saved out of ID order.
  removed.sort((a, b) => a.order - b.order);
  const restored = new Map();
  let next = 0;
  for (const [id, trace] of s.objects) {
    while (next < removed.length && removed[next].order < trace.order) {
      const previous = removed[next++];
      restored.set(previous.id, previous);
    }
    restored.set(id, trace);
  }
  for (; next < removed.length; next++) restored.set(removed[next].id, removed[next]);
  s.objects = restored;
}

function status(o) {
  if (o.cls) return 'labeled';
  if (o.pred && o.conf >= S.settings.predThr) return 'predicted';
  return 'candidate';
}

export function effClassId(o) { return effectiveClassId(o, S.settings); }

function refreshObjects(s, ids, region) {
  if (!s.orig) return;   // V0.1: stats are kept from the last time the pixels were in memory
  const R = region ? { x0: Math.max(0, region.x0), y0: Math.max(0, region.y0), x1: Math.min(s.w, region.x1), y1: Math.min(s.h, region.y1) } : null;
  const acc = objectStats(s.labels, s.w, s.h, s.orig, ids, R, s.stacks), ppu = pxPerCm(s);
  for (const id of ids) {
    const a = acc.get(id), o = s.objects.get(id);
    if (!o) continue;
    if (!a) { s.objects.delete(id); if (S.selected === id) S.selected = 0; continue; }
    if (o.emb && (a.n !== o.area || a.x0 !== o.bbox?.[0] || a.y0 !== o.bbox?.[1] || a.x1 !== o.bbox?.[2] || a.y1 !== o.bbox?.[3])) o.emb = null;   // V0.17: the trace changed
    o.area = a.n; o.bbox = [a.x0, a.y0, a.x1, a.y1]; o.stats = a; o.feat = features(a, ppu);
  }
}

function recomputeFeatures(s) { const ppu = pxPerCm(s); for (const o of s.objects.values()) if (o.stats) o.feat = features(o.stats, ppu); }

function beginOp(s, group = '') {
  s._mv = (s._mv || 0) + 1;   // V0.2: invalidates cached row counts and packed masks
  return { s, group, lm: [], ex: [], objs: new Map(), nextId: s.nextId, sel: S.selected, ext: { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }, touched: new Set() };
}
function setLabel(op, i, v) {
  const L = op.s.labels, old = L[i];
  if (old === v) return;
  const ids = idsAt(old, op.s.stacks);
  for (const id of ids) op.touched.add(id);
  op.lm.push(i, old < 0 ? ids : old);
  if (old < 0 || v < 0) op.stackChanged = true;
  L[i] = v;
  maskChanges.mark(op.s, i);
}
/* V0.20: overlapping traces. With «Superponer» a new trace keeps what is underneath; without it, it replaces it (as before). */
const six = (s) => s._six || (s._six = stackIndex(s.stacks));
/** Reclaim unused stacks between edits, without scanning the mask on every stroke. */
function compactSectionStacks(s, force = false) {
  if (s.stacks.length < 2) return;
  s._stackEdits = (s._stackEdits || 0) + 1;
  if (!force && s._stackEdits < 32 && s.stacks.length < (s._stackLimit || 64)) return;
  s.stacks = compactStacks(s.labels, s.stacks);
  maskChanges.markAll(s);                       // the overlap codes of the label image were renumbered
  s._six = null;
  s._stackEdits = 0;
  s._stackLimit = Math.max(64, 2 * s.stacks.length);
}
const topLab = (s, i) => topAt(s.labels[i], s.stacks);
/** V0.30: traces only overlap when their ichnotaxa differ; a trace of the same ichnotaxon underneath gives way to the new one. */
const clsKey = (s, id) => s.objects.get(id)?.cls ?? null;
const addPx = (op, i, id) => {
  const s = op.s, o = s.labels[i];
  if (!S.overlap) { if (o && o !== id) op.replaced = true; setLabel(op, i, id); return; }
  if (!o || o === id) { setLabel(op, i, id); return; }
  const c = clsKey(s, id), keep = idsAt(o, s.stacks).filter((x) => x !== id && clsKey(s, x) !== c);
  setLabel(op, i, codeFor([...keep, id], s.stacks, six(s)));
};
/** V0.30: after a class change, traces of the same ichnotaxon that overlap are merged into one. */
function mergeSameTaxon(s, ids, group) {
  for (const g of sameTaxonGroups(s.labels, s.w, s.stacks, s.objects, ids)) if (g.every((id) => s.objects.has(id))) mergeObjects(g, group);   // V0.42: edit.js
}
const subPx = (op, i, id) => setLabel(op, i, withoutId(op.s.labels[i], id, op.s.stacks, six(op.s)));
/** Remove a set of ids from every pixel. */
function dropIds(op, set) {
  const s = op.s, L = s.labels, st = s.stacks, w = s.w;
  // V0.44: only the union of the objects' rectangles is scanned (kept up to date by refreshObjects); a missing
  // rectangle falls back to the whole image
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (const id of set) { const b = s.objects.get(id)?.bbox; if (!b) { x0 = 0; y0 = 0; x1 = w - 1; y1 = s.h - 1; break; } x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]); }
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(w - 1, x1); y1 = Math.min(s.h - 1, y1);
  for (let y = y0; y <= y1; y++) for (let i = y * w + x0, e = y * w + x1; i <= e; i++) {
    const v = L[i]; if (!v) continue;
    if (v > 0) { if (set.has(v)) setLabel(op, i, 0); }
    else if (st[-v].some((x) => set.has(x))) setLabel(op, i, codeFor(st[-v].filter((x) => !set.has(x)), st, six(s)));
  }
}
function setEx(op, i, v) { const E = op.s.exclude; if (E[i] !== v) { op.ex.push(i, E[i]); E[i] = v; maskChanges.mark(op.s, i); } }
function grow(op, x, y) { const e = op.ext; if (x < e.x0) e.x0 = x; if (y < e.y0) e.y0 = y; if (x > e.x1) e.x1 = x; if (y > e.y1) e.y1 = y; }

let ovHint = false;
function finishPixelOp(op, target = 0) {
  const s = op.s;
  if (op.replaced && !ovHint) { ovHint = true; toast(t('ov.hint')); }   // V0.29: the user may have wanted the traces to overlap
  if (target) op.touched.add(target);
  if (op.touched.size) {
    const R = { ...op.ext };
    for (const id of op.touched) {
      const trace = s.objects.get(id);
      if (!trace) continue;
      rememberTrace(op, id);
      const { bbox } = trace;
      if (!bbox) continue;
      R.x0 = Math.min(R.x0, bbox[0]); R.y0 = Math.min(R.y0, bbox[1]); R.x1 = Math.max(R.x1, bbox[2]); R.y1 = Math.max(R.y1, bbox[3]);
    }
    refreshObjects(s, op.touched, { x0: R.x0, y0: R.y0, x1: R.x1 + 1, y1: R.y1 + 1 });
  }
  for (const o of s.objects.values()) if (!o.area) removeTrace(op, o.id);
  commitOp(op);
  afterChange(s);
}

function commitOp(op) {
  for (const [id, previous] of op.objs) if (!previous && !op.s.objects.has(id)) op.objs.delete(id);
  if (!op.lm.length && !op.ex.length && !op.objs.size) return;
  S.redo.length = 0;
  S.undo.push(op);
  trimEditHistory(S.undo);
  if (op.stackChanged) compactSectionStacks(op.s);
  updateHistoryButtons();
}

function updateHistoryButtons() {
  $('undoBtn').toggleAttribute('disabled', !S.undo.length);
  $('redoBtn').toggleAttribute('disabled', !S.redo.length);
}

function discardEditHistory(section) {
  S.undo = section ? S.undo.filter((op) => op.s !== section) : [];
  S.redo = section ? S.redo.filter((op) => op.s !== section) : [];
  updateHistoryButtons();
}

function undo() { replayEditHistory(S.undo, S.redo, false); }
function redo() { replayEditHistory(S.redo, S.undo, true); }

/** @param {import('./state.js').UndoStep[]} from
 * @param {import('./state.js').UndoStep[]} to
 * @param {boolean} forward
 */
function replayEditHistory(from, to, forward) {
  const last = from.at(-1);
  if (!last || drag?.type === 'paint') return;
  const { s, group } = last;
  if (s !== sec()) selectSection(S.sections.indexOf(s));
  S.multi.clear();
  do {
    const op = from.pop();
    swapEditStep(op, forward);
    to.push(op);
  } while (group && from.at(-1)?.group === group);
  updateHistoryButtons();
  afterChange(s);
}

/** @param {import('./state.js').UndoStep} op
 * @param {boolean} forward
 */
function swapEditStep(op, forward) {
  const s = op.s;
  swapHistoryPixels(s.labels, s.exclude, op.lm, op.ex, s.stacks, op.stackChanged ? six(s) : null, forward);
  for (const range of [indexRangeOfPairs(op.lm), indexRangeOfPairs(op.ex)]) if (range) maskChanges.markRange(s, range.first, range.last);
  if (op.stackChanged) compactSectionStacks(s);
  swapHistoryTraces(op);
  [s.nextId, op.nextId] = [op.nextId, s.nextId];
  [S.selected, op.sel] = [op.sel, S.selected];
}

function afterChange(s) { s._mv = (s._mv || 0) + 1; s.logVer = (s.logVer || 0) + 1; markDirty(); scheduleLog(); rebuildLUT(s); scheduleLearn(); scheduleAnalysis(); renderClasses(); renderObject(); requestRender(); scheduleEmbed(s); }

/* pixel-set edits from wand and lasso */
function applyPixels(pixels, mode) {
  const s = sec(); if (!pixels.length) return;
  const op = beginOp(s);
  let target = 0;
  if (mode === 'sub') target = 0;
  else if (mode === 'add' && S.selected && s.objects.has(S.selected)) target = S.selected;
  else target = newObject(op, S.active, S.tool).id;
  for (const i of pixels) {
    grow(op, i % s.w, (i / s.w) | 0);
    const old = s.labels[i];
    if (mode === 'sub') { if (old) { if (S.selected) { if (hasId(old, S.selected, s.stacks)) subPx(op, i, S.selected); } else setLabel(op, i, 0); } }
    else addPx(op, i, target);
  }
  finishPixelOp(op, target);
  if (target && s.objects.has(target)) select(target);
}

function deleteObject(id) { deleteObjects([id]); }
function deleteObjects(ids) {
  const s = sec(); if (!s) return;
  const objs = ids.map((id) => s.objects.get(id)).filter((o) => o?.bbox); if (!objs.length) return;
  const op = beginOp(s);
  for (const o of objs) {
    const [x0, y0, x1, y1] = o.bbox;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * s.w + x; if (hasId(s.labels[i], o.id, s.stacks)) subPx(op, i, o.id); }
    removeTrace(op, o.id);
  }
  S.selected = 0; S.multi.clear();
  commitOp(op); afterChange(s);
}

function assignClass(id, clsId) { assignClassMany([id], clsId); }
/** Assign one class to one or several objects (one undo step). The view does not move unless "jump to next" is on. */
function assignClassMany(ids, clsId) {
  const s = sec(); if (!s) return;
  const objs = ids.map((id) => s.objects.get(id)).filter(Boolean); if (!objs.length) return;
  const group = uid(), op = beginOp(s, group);
  for (const o of objs) {
    if (o.cls === clsId && o.pred === null && o.conf === 0) continue;
    rememberTrace(op, o.id);
    o.cls = clsId; o.pred = null; o.conf = 0;
  }
  commitOp(op); afterChange(s);
  mergeSameTaxon(s, objs.map((o) => o.id), group);
  if (objs.length === 1 && $('autoNext').checked) nextReview();
}
/** Objects selected now: the multi-selection if any, else the single selected object. */
function selectedIds() { const s = sec(); if (!s) return []; const ids = S.multi.size ? [...S.multi] : S.selected ? [S.selected] : []; return ids.filter((id) => s.objects.has(id)); }

/* ───────────── V0.20: split a trace along a drawn line (scissors) and merge traces ───────────── */
/** Pixels of a 3-px-wide polyline (indices). */
function linePixels(s, pts) {
  const out = new Set();
  for (let k = 1; k < pts.length; k++) {
    const [ax, ay] = pts[k - 1], [bx, by] = pts[k], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
    for (let q = 0; q <= n; q++) {
      const cx = ax + ((bx - ax) * q) / n, cy = ay + ((by - ay) * q) / n;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = Math.floor(cx) + dx, y = Math.floor(cy) + dy;
        if (x >= 0 && y >= 0 && x < s.w && y < s.h) out.add(y * s.w + x);
      }
    }
  }
  return out;
}
function splitAlong(pts) {
  const s = sec(); if (!s || !pts || pts.length < 2) return;
  const cut = linePixels(s, pts), L = s.labels, st = s.stacks;
  let id = 0;
  if (S.selected && [...cut].some((i) => hasId(L[i], S.selected, st))) id = S.selected;
  else for (const i of cut) { const v = topAt(L[i], st); if (v) { id = v; break; } }
  const o = id && s.objects.get(id);
  if (!o?.bbox) { toast(t('cut.none')); return; }
  const [x0, y0] = o.bbox, { comp, bw, n, main } = splitPieces(L, s.w, st, o.bbox, id, cut);   // V0.42: edit.js
  if (n < 2) { toast(t('cut.noSplit')); return; }
  const op = beginOp(s), ids = [0];
  for (let k = 1; k <= n; k++) ids.push(k === main ? id : newObject(op, o.cls, o.src).id);
  for (let k = 1; k <= n; k++) if (k !== main) { const c = s.objects.get(ids[k]); c.pred = o.pred; c.conf = o.conf; c.nt = o.nt; op.touched.add(ids[k]); }
  for (let j = 0; j < comp.length; j++) {
    const k = comp[j]; if (k <= 0 || k === main) continue;
    const i = (y0 + ((j / bw) | 0)) * s.w + x0 + (j % bw); grow(op, i % s.w, (i / s.w) | 0);
    setLabel(op, i, renameId(L[i], id, ids[k], st, six(s)));
  }
  finishPixelOp(op, id);
  toast(t('cut.done', { n }));
}
/** Merge the selected traces into one (the largest with a class given by hand, else the largest, keeps its id and class). */
function mergeObjects(list, group = '') {
  const s = sec(); if (!s) return;
  const objs = list.map((id) => s.objects.get(id)).filter((o) => o?.bbox); if (objs.length < 2) return;
  const keep = mergeKeeper(objs), L = s.labels, st = s.stacks;   // V0.42: edit.js
  const op = beginOp(s, group);
  for (const o of objs) {
    if (o === keep) continue;
    const [x0, y0, x1, y1] = o.bbox; grow(op, x0, y0); grow(op, x1, y1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * s.w + x; if (hasId(L[i], o.id, st)) setLabel(op, i, renameId(L[i], o.id, keep.id, st, six(s))); }
  }
  S.multi.clear();
  finishPixelOp(op, keep.id);
  select(keep.id);
}

/* ───────────── detection ───────────── */

function runDetection() {
  const s = sec(); if (!s) return;
  if (s.detect.method !== 'unet') { busy(() => withPixels(s, detectSection), 'detect'); return; }
  if (!unetController.model) { $('detectStatus').textContent = t('u.noModel'); return; }
  busy(() => withPixels(s, async (x) => { await unetProb(x); await detectSection(x); }), 'detect');
}

/* ───────────── V0.15: U-Net (model trained with `sedcoretool unet train`, run with ONNX Runtime Web) ───────────── */
/** @returns {import('./state.js').SectionState[]} */
function unetSections() { return S.cores.flatMap((c) => c.sections); }
const unetController = /** @type {typeof createUnetController<import('./state.js').SectionState>} */ (createUnetController)({
  getRuntime: async () => { await loadOrt(); return window.ort; },
  sections: unetSections,
  pixelsPerCm: pxPerCm, id: uid,
  progress: (k, n) => { $('detectStatus').textContent = t('u.progress', { k, n }); },
});
const unetKey = (s) => unetController.key(s);
async function loadOrt() {
  if (window.ort) return;
  const where = await loadLib('ort/ort.wasm.min.js');
  window.ort.env.wasm.wasmPaths = where === 'local' ? new URL('vendor/ort/', location.href).href : ORT_CDN;
  window.ort.env.wasm.numThreads = 1;   // works without cross-origin isolation (single file, browser, desktop)
}
/** Model files chosen by the user: the .onnx network and, optionally, the .json written next to it in training. */
async function loadUnet(files) {
  const onnx = files.find((f) => /\.onnx$/i.test(f.name)), js = files.find((f) => /\.json$/i.test(f.name));
  if (!onnx) { toast(t('u.needOnnx')); return; }
  await loadUnetBytes(new Uint8Array(await onnx.arrayBuffer()), js ? await js.text() : null, onnx.name);
}
/** V0.17: also used for models trained in the desktop program. */
async function loadUnetBytes(bytes, json, name) {
  await busy(async () => {
    try {
      await unetController.load(bytes, json, name);
      toast(t('u.loaded', { n: name }));
    } catch (e) { toast(t('u.loadErr') + ' ' + (e?.message || e)); }
    renderDetectForm();
  });
}

/* ───────────── V0.17: descriptors from a pre-trained vision model (DINOv2) for the ichnotaxon classifier ───────────── */
let VIS = null, embTimer = 0, embRunning = false;   // VIS = { session, src }
const VIS_CACHE = 'corantool-models';
async function visionCached() { try { const r = await (await caches.open(VIS_CACHE)).match(VISION_MODEL.url); return r ? new Uint8Array(await r.arrayBuffer()) : null; } catch { return null; } }
/** Loads the vision model from a chosen file, from the local cache, or (download = true) from Hugging Face, then caches it. */
async function loadVision(file = null, download = false) {
  const work = async () => {
    try {
      await loadOrt();
      let bytes = file ? new Uint8Array(await file.arrayBuffer()) : await visionCached();
      if (!bytes && download) {
        const r = await fetch(VISION_MODEL.url); if (!r.ok) throw new Error('HTTP ' + r.status);
        const blob = await r.blob(); bytes = new Uint8Array(await blob.arrayBuffer());
        try { await (await caches.open(VIS_CACHE)).put(VISION_MODEL.url, new Response(blob)); } catch { /* no cache here (single offline file) */ }
      }
      if (!bytes) return;
      // V0.38: SHA-256 of the model file; vectors from different files are not comparable
      let sha = null; try { sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((x) => x.toString(16).padStart(2, '0')).join(''); } catch { /* no WebCrypto (file://) */ }
      if (sha && VISION_MODEL.sha256 && sha !== VISION_MODEL.sha256 && !file) toast(t('vis.shaExpected'), 9000);
      const ml = (S.settings.ml ||= { ...ML_DEFAULT });
      if (sha && ml.visionSha && ml.visionSha !== sha) toast(t('vis.shaDiff', { a: ml.visionSha.slice(0, 12), b: sha.slice(0, 12) }), 10000);
      else if (sha && !ml.visionSha) { ml.visionSha = sha; markDirty(); }
      const session = await window.ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
      VIS = { session, src: file ? file.name : VISION_MODEL.name, sha256: sha };
      if (file || download) toast(t('vis.loaded', { n: VIS.src }));
    } catch (e) { VIS = null; toast(t('vis.err') + ' ' + (e?.message || e)); }
  };
  if (file || download) await busy(work); else await work();
  if ($('mlDlg')?.open) renderMl();
}
const pendingEmb = (secs = S.cores.flatMap((c) => c.sections)) => secs.reduce((n, s) => n + [...s.objects.values()].filter((o) => o.bbox && !o.emb).length, 0);
/** Vector of every trace (with a bounding box) that has none yet, in the given sections. */
async function computeEmbeddings(secs, progress = null) {
  if (!VIS) await loadVision();
  if (!VIS || embRunning) return 0;
  embRunning = true;
  const { session } = VIS, inName = session.inputNames[0], Z = VISION_MODEL.size, tot = pendingEmb(secs);
  let k = 0;
  try {
    for (const s of secs) {
      const objs = [...s.objects.values()].filter((o) => o.bbox && !o.emb); if (!objs.length) continue;
      await withPixels(s, async () => {
        for (const o of objs) {
          if (!o.bbox || o.emb) continue;
          const r = await session.run({ [inName]: new window.ort.Tensor('float32', traceInput(s.orig, s.w, s.h, traceWindow(o.bbox, VISION_MODEL.pad)), [1, 3, Z, Z]) });
          o.emb = pickEmbedding(Object.fromEntries(Object.entries(r).map(([n, v]) => [n, { data: v.data, dims: v.dims }])), session.outputNames);
          if (progress) progress(++k, tot);
        }
      });
    }
  } finally { embRunning = false; }
  if (k) { markDirty(); learnNow(); }
  return k;
}
/** In vision mode, new or edited traces of the open image get their vector shortly after the change. */
function scheduleEmbed(s) {
  if (!visionOn() || !VIS || !s) return;
  clearTimeout(embTimer); embTimer = setTimeout(() => { if (pendingEmb([s])) computeEmbeddings([s]).catch(() => {}); }, 700);
}

/* ───────────── V0.17: training the U-Net on this computer (desktop program) ───────────── */
const DESK = window.corantoolDesktop?.trainer || null;
const TR = { status: null, log: [], prog: null, running: false, last: null };
if (DESK) DESK.onEvent((type, d) => {
  if (type === 'log') { TR.log.push(d); if (TR.log.length > 300) TR.log.splice(0, TR.log.length - 300); }
  else if (type === 'progress') TR.prog = d;
  else if (type === 'state') TR.running = !!d.busy;
  else if (type === 'done') { TR.last = d; trainDone(d).catch((err) => toast(t('err.generic', { e: err?.message || String(err) }), 8000)); }
  if ($('trainDlg')?.open) renderTrain();
});
async function trainDone(d) {
  const m = await DESK.readModel(d.name);
  await loadUnetBytes(new Uint8Array(m.onnx), m.json, m.name + '.onnx');
  TR.status = await DESK.status();
  if ($('trainDlg')?.open) renderTrain();
}
/** Cores with reviewed traces (the ones that go into the training ZIP). */
function trainCores() {
  return S.cores.map((c) => { const imgs = c.sections.filter((s) => [...s.objects.values()].some((o) => o.cls)); return { c, imgs: imgs.length, traces: imgs.reduce((n, s) => n + [...s.objects.values()].filter((o) => o.cls).length, 0) }; }).filter((r) => r.imgs);
}
async function openTrain() {
  renderTrain(); if (!$('trainDlg').open) $('trainDlg').showModal();
  if (DESK) { TR.status = await DESK.status().catch((e) => ({ error: String(e) })); renderTrain(); }
}
function renderTrain() {
  const box = $('trainBody');
  if (!DESK) { box.innerHTML = `<p>${t('tr.web')}</p>`; return; }
  const st = TR.status, roles = (S.settings.trainRoles ||= {}), cores = trainCores();
  let h = `<p class="note">${t('tr.intro')}</p><h3>1. ${t('tr.module')}</h3>`;
  if (!st) h += `<p class="note">${t('busy')}</p>`;
  else if (!st.installed) {
    h += st.python && st.error ? `<p class="note">${esc(st.error)}</p>` : '';
    h += st.system || st.python ? `<p>${t('tr.noModule', { v: st.system?.version || '' })}</p><button class="btn primary" id="trInstall" ${TR.running ? 'disabled' : ''}>${t('tr.install')}</button>`
      : `<p>${t('tr.noPython')}</p>`;
  } else h += `<p>${t('tr.device', { n: esc(st.device?.name || '?'), d: st.device?.device || '?' })}</p>${st.device?.device === 'cpu' ? `<p class="note">${t('tr.cpu')}</p>` : ''}`;
  h += `<h3>2. ${t('tr.data')}</h3>`;
  if (!cores.length) h += `<p class="note">${t('u.noReviewed')}</p>`;
  else h += `<p class="note">${t('tr.roles')}</p><table class="dtable mtab"><thead><tr><th>${t('tr.core')}</th><th>${t('tr.imgs')}</th><th>${t('tr.traces')}</th><th>${t('tr.role')}</th></tr></thead><tbody>${cores.map(({ c, imgs, traces }) => `<tr><td class="txt">${esc(c.name)}</td><td>${imgs}</td><td>${traces}</td><td><select data-trrole="${esc(c.name)}">${['auto', 'val', 'test'].map((r) => `<option value="${r}" ${(roles[c.name] || 'auto') === r ? 'selected' : ''}>${t('tr.r.' + r)}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table>`;
  const o = (S.settings.trainOpt ||= { name: safe(S.name || 'modelo'), epochs: 60, pretrained: true });
  h += `<h3>3. ${t('tr.train')}</h3><div class="row" style="align-items:end;gap:12px"><label class="f"><span>${t('tr.name')}</span><input type="text" data-tropt="name" value="${esc(o.name)}"></label>
    <label class="f"><span>${t('tr.epochs')}</span><input type="number" data-tropt="epochs" min="1" max="500" value="${o.epochs}" style="width:80px"></label>
    <label class="chk"><input type="checkbox" data-tropt="pretrained" ${o.pretrained ? 'checked' : ''}><span>${t('tr.pretrained')}</span></label></div>
    <div class="row">${TR.running ? `<button class="btn" id="trCancel">${t('tr.cancel')}</button>` : `<button class="btn primary" id="trGo" ${st?.installed && cores.length ? '' : 'disabled'}>${t('tr.go')}</button><button class="btn" id="trResume" ${st?.installed ? '' : 'disabled'}>${t('tr.resume')}</button>`}</div>`;
  if (TR.prog) { const p = TR.prog; h += `<p><progress max="${p.epochs}" value="${p.epoch}" style="width:100%"></progress><br>${t('tr.prog', { e: p.epoch, n: p.epochs, d: fmt(p.val_dice, 3), b: fmt(p.best, 3), be: p.best_epoch, dev: p.device })}</p>`; }
  if (TR.last?.evaluation) { const q = TR.last.evaluation.pooled; h += `<p><b>${t('tr.test', { c: TR.last.evaluation.cores.join(', '), d: fmt(q.dice, 3), i: fmt(q.iou, 3) })}</b></p>`; }
  if (TR.log.length) h += `<details ${TR.running ? 'open' : ''}><summary>${t('tr.log')}</summary><pre class="trlog">${esc(TR.log.slice(-60).join('\n'))}</pre></details>`;
  const ms = st?.models || [];
  h += `<h3>4. ${t('tr.models')}</h3>` + (ms.length ? `<table class="dtable mtab"><thead><tr><th>${t('tr.name')}</th><th>${t('tr.valDice')}</th><th>${t('tr.testDice')}</th><th>${t('tr.date')}</th><th></th></tr></thead><tbody>${ms.map((m) => `<tr><td class="txt">${esc(m.name)}</td><td>${m.valDice != null ? fmt(m.valDice, 3) : '—'}</td><td>${m.test ? fmt(m.test.dice, 3) : '—'}</td><td class="txt">${esc(m.date.slice(0, 16).replace('T', ' '))}</td><td><button class="btn small" data-truse="${esc(m.name)}">${t('tr.use')}</button></td></tr>`).join('')}</tbody></table>` : `<p class="note">${t('tr.noModels')}</p>`)
    + `<p><button class="btn small ghost" id="trFolder">${t('tr.folder')}</button></p><p class="note">${t('tr.explain')}</p>`;
  box.innerHTML = h;
}
async function startTrain(resume) {
  const o = S.settings.trainOpt, roles = S.settings.trainRoles || {};
  TR.log = []; TR.prog = null; TR.last = null;
  try {
    const opt = { name: o.name, epochs: o.epochs, pretrained: o.pretrained, resume };
    if (!resume) {
      const z = await buildTrainingZip(); if (!z) return;
      const names = trainCores().map((r) => r.c.name);
      Object.assign(opt, { zip: new Uint8Array(await z.arrayBuffer()), val: names.filter((n) => roles[n] === 'val'), test: names.filter((n) => roles[n] === 'test') });
    }
    TR.running = true; renderTrain();
    await DESK.train(opt);
  } catch (e) { TR.log.push('✕ ' + (String(e?.message || e).includes('cancelled') ? t('tr.cancelled') : e?.message || e)); TR.running = false; renderTrain(); }
}
/** Probability map of bioturbation for the section (cached until the model, the analysis area or the scale change). */
function unetProb(s) { return unetController.probability(s); }

async function detectSection(s) {
  {
    const p = s.detect, prob = p.method === 'unet' && s._unet?.key === unetKey(s) ? s._unet.prob : null;
    if (s._eg && !s.enh) enhance(s);
    // V0.41: mask and components in the background worker (same functions), then applied here
    const enh = s.enh, roi = { ...s.roi }, exclude = s.exclude;
    const { labels: cl, count } = await offload('detect', { enh, w: s.w, h: s.h, roi, exclude, p: { ...p }, prob },
      () => components(detectMask(enh, s.w, s.h, roi, exclude, p, prob), s.w, s.h, p.minArea));
    const op = beginOp(s), L = s.labels;
    const cand = new Set();
    for (const o of s.objects.values()) if (!o.cls && o.src === 'auto') cand.add(o.id);
    if (cand.size) {
      dropIds(op, cand);
      for (const id of cand) removeTrace(op, id);
      if (cand.has(S.selected)) S.selected = 0;
    }
    const base = s.nextId;
    for (let i = 0; i < L.length; i++) { const k = cl[i]; if (k && !L[i]) { op.lm.push(i, 0); L[i] = base + k - 1; } }
    const ids = new Set();
    for (let k = 0; k < count; k++) { const o = newObject(op, null, 'auto'); ids.add(o.id); }
    const acc = objectStats(L, s.w, s.h, s.orig, ids, null, s.stacks), ppu = pxPerCm(s);
    let kept = 0;
    for (const id of ids) {
      const a = acc.get(id), o = s.objects.get(id);
      if (!a || a.n < p.minArea) {
        if (a) for (let y = a.y0; y <= a.y1; y++) for (let x = a.x0; x <= a.x1; x++) { const i = y * s.w + x; if (L[i] === id) { op.lm.push(i, id); L[i] = 0; } }
        s.objects.delete(id); continue;
      }
      o.area = a.n; o.bbox = [a.x0, a.y0, a.x1, a.y1]; o.stats = a; o.feat = features(a, ppu); kept++;
    }
    commitOp(op);
    $('detectStatus').textContent = t('d.result', { n: kept });
    afterChange(s);
  }
}

function clearCandidates() {
  const s = sec(); if (!s) return;
  const op = beginOp(s), cand = new Set([...s.objects.values()].filter((o) => !o.cls).map((o) => o.id));
  dropIds(op, cand);
  for (const id of cand) removeTrace(op, id);
  if (cand.has(S.selected)) S.selected = 0;
  commitOp(op); $('detectStatus').textContent = ''; afterChange(s);
}

/* ───────────── learning ───────────── */

let learnTimer = 0, learnIdle = 0;
function scheduleLearn() { clearTimeout(learnTimer); learnTimer = setTimeout(learnNow, (S.settings.ml?.method || 'knn') === 'knn' ? 60 : 500); }
/** Labelled examples of this project with a stable key; objects marked «not for training» (o.nt) are left out. */
function ownExamples(cores, withExcluded = false, withHoldout = false) {
  const ex = [];
  for (const c of cores) if (withHoldout || !c.holdout) for (const s of c.sections) for (const o of s.objects.values()) if (o.cls && xOf(o) && (withExcluded || !o.nt)) {
    const k = clsById(o.cls); if (k) ex.push({ key: `${S.id}|${c.id}|${s.id}|${o.id}`, g: `${S.id}|${c.id}|${s.id}`, y: k.name, x: xOf(o), c, s, o });
  }
  return ex;
}
function mlSets() {
  const grp = (k) => String(k).split('|').slice(0, 3).join('|');
  // V0.49: traces of reserved cores (final test) never train nor enter model selection, wherever they come from
  const held = new Set(S.cores.filter((c) => c.holdout).map((c) => `${S.id}|${c.id}|`)), notHeld = (e) => ![...held].some((h) => String(e.key || '').startsWith(h));
  // V0.58: external examples that may come from a reserved core (same core id or name, or identical descriptors) are left out
  const heldCores = S.cores.filter((c) => c.holdout);
  const reserved = heldCores.length ? { ids: new Set(heldCores.map((c) => c.id)), names: new Set(heldCores.map((c) => String(c.name || '').trim().toLowerCase()).filter(Boolean)),
    sigs: new Set(ownExamples(heldCores, true, true).map((e) => descriptorSig(e.x))) } : null;
  const libFree = independentExternalExamples(S.library, reserved, xOfLib), otherFree = independentExternalExamples(otherExamples, reserved, xOfLib);
  mlReservedDropped = S.library.length - libFree.length + otherExamples.length - otherFree.length;
  const lib = libFree.filter((e) => e.name && Array.isArray(xOfLib(e)) && notHeld(e)).map((e, i) => ({ key: e.key || `lib|${i}`, g: grp(e.key || `lib|${i}`), y: e.name, x: xOfLib(e), lib: e }));
  const cur = S.cores.find((c) => c.id === S.curCore), exCore = ownExamples(cur ? [cur] : []), exProj = ownExamples(S.cores);
  const keys = new Set([...exProj, ...lib].map((e) => e.key));
  // the same trace can exist in two projects (shared core, duplicated or imported project): identical descriptors are
  // used once, otherwise it would count twice and could be both trained on and tested in the evaluation
  const sig = (e) => e.x.map((v) => (+v).toFixed(3)).join(','), seen = new Set(exProj.concat(lib).map(sig));
  const other = otherFree.map((e) => ({ ...e, x: xOfLib(e) })).filter((e) => Array.isArray(e.x) && !mlExcluded.has(e.key) && !keys.has(e.key) && notHeld(e)).filter((e) => { const k = sig(e); if (seen.has(k)) return false; seen.add(k); return true; }).map((e) => ({ ...e, g: grp(e.key) }));
  // V0.17: only vectors of the current feature set and length
  const D = exProj[0]?.x.length ?? lib[0]?.x.length ?? other[0]?.x.length, ok = (e) => e.x.length === D;
  return { core: exCore.concat(lib).filter(ok), project: exProj.concat(lib).filter(ok), all: exProj.concat(lib, other).filter(ok) };
}
/* ───────────── V0.49: final test on reserved cores ─────────────
 * Cores marked as reserved (core.holdout) never train any model nor take part in choosing one (icnotaxa: example
 * sets and evaluation; multiproxy: training and cross-validation). The final test predicts their identified traces
 * (icnotaxa: the model in use) or described intervals (multiproxy: the trained classifier) once, and every run is
 * logged in S.finalTests so a re-test after changes is visible. */
export const holdoutIds = () => new Set(S.cores.filter((c) => c.holdout).map((c) => c.id));
function logFinal(entry) {
  const prev = (S.finalTests || []).filter((q) => q.kind === entry.kind && q.target === entry.target).length;
  (S.finalTests ||= []).push({ ...entry, at: new Date().toISOString(), delivery: DELIVERY, repeat: prev });
  markDirty(); return prev;
}
function runFinalIchno() {
  const cores = S.cores.filter((c) => c.holdout), ex = ownExamples(cores, true, true);
  if (!cores.length) { toast(t('ft.noCores')); return; }
  learnNow();   // the model in use, refitted now without the reserved cores if they just changed
  if (!ex.length || !clf) { toast(t('ft.noTraces')); return; }
  const m = finalTestMetrics(ex.map((e) => ({ y: e.y, p: clf.predict(e.x)?.y ?? null })));
  const active = CLF_SCOPES.includes(S.settings.clfScope) ? S.settings.clfScope : 'project';
  const prev = logFinal({ kind: 'ichno', target: 'ichnotaxa', method: S.settings.ml?.method || 'knn', scope: active, cores: cores.map((c) => c.name), nTrain: mlSets()[active].length, ...m });
  if (prev) toast(t('ft.repeat', { n: prev + 1 }), 9000);
  renderMl();
}
export function runFinalGeo(c) {
  const held = holdoutIds(); if (!held.size) { toast(t('ft.noCores')); return; }
  const run = geoRT.runs.get(c.id); if (!run) { toast(t('gx.untrained')); return; }
  if (run.held !== [...held].sort().join()) { toast(t('ft.retrain'), 8000); return; }   // trained with another reservation
  for (const [lid, r] of run.byTarget) {
    if (!r.model || !r.all) continue;
    const pairs = [];
    geoRT.samples.forEach((smp, i) => { const l = r.all[i]; if (held.has(smp.core) && l?.label && l.source !== 'rule') pairs.push({ y: l.label, p: r.preds[i]?.label ?? null }); });
    if (!pairs.length) continue;
    const m = finalTestMetrics(pairs), prev = logFinal({ kind: 'geo', target: geoLayer(lid)?.name || lid, classifier: c.name, method: c.method, cores: S.cores.filter((k) => k.holdout).map((k) => k.name), nTrain: r.model.n, ...m });
    if (prev) toast(t('ft.repeat', { n: prev + 1 }), 9000);
  }
  renderGeo();
}
export function finalTestsHTML(kind) {
  const list = (S.finalTests || []).filter((q) => q.kind === kind).slice(-8).reverse();
  if (!list.length) return `<p class="note">${t('ft.none')}</p>`;
  return `<table class="tbl"><tr><th>${t('ft.when')}</th><th>${t('ft.what')}</th><th>${t('geo.bacc')}</th><th>${t('geo.acc')}</th><th>n</th></tr>${list.map((q) => `<tr><td>${esc(q.at.slice(0, 16).replace('T', ' '))}${q.repeat ? ` <span class="warn" title="${esc(t('ft.repeatTip'))}">(${q.repeat + 1}.ª)</span>` : ''}</td><td>${esc(q.target)} · ${esc(q.method)}${q.scope ? ' · ' + esc(q.scope) : ''}${q.classifier ? ' · ' + esc(q.classifier) : ''}<br><span class="note">${esc(q.cores.join(', '))}</span></td><td><b>${fmt(q.balanced * 100, 1)} %</b></td><td>${fmt(q.accuracy * 100, 1)} %</td><td>${q.n}</td></tr>`).join('')}</table>`;
}
export function holdoutHTML() {
  if (S.cores.some((c) => c.holdout)) mlSets();   // updates the count of external examples left out
  return `${mlReservedDropped ? `<p class="note">${t('ft.dropped', { n: mlReservedDropped })}</p>` : ''}<div class="chk2">${S.cores.map((c) => `<label class="chk"><input type="checkbox" data-holdout="${esc(c.id)}" ${c.holdout ? 'checked' : ''}><span>${esc(c.name)}</span></label>`).join('')}</div>`;
}
document.addEventListener('change', (e) => {
  const id = e.target?.dataset?.holdout; if (id == null) return;
  const c = S.cores.find((k) => k.id === id); if (!c) return;
  c.holdout = e.target.checked; markDirty(); geoRT.dirty = true; mlEval = null; scheduleLearn();
  toast(t(c.holdout ? 'ft.reserved' : 'ft.released', { c: c.name }), 6000);
  if ($('mlDlg')?.open) renderMl();
});

/** V0.2: signature of a training set and of the model settings; the model is refitted only when it changes. */
function trainSig(set) {
  let h = 2166136261; const mix = (v) => { h = Math.imul(h ^ (typeof v === 'number' ? Math.round(v * 1e6) : [...String(v)].reduce((a, c) => Math.imul(a ^ c.charCodeAt(0), 16777619), 7)), 16777619); };
  mix(JSON.stringify(S.settings.ml || {})); mix(S.settings.novelty); mix(S.classes.map((c) => c.name).join('|'));
  for (const e of set || []) { mix(e.key); mix(e.y); for (const v of e.x || []) mix(v); }
  return h;
}
const clfSig = {}; let modelVer = 0;
function learnNow() {
  const sets = mlSets(), active = CLF_SCOPES.includes(S.settings.clfScope) ? S.settings.clfScope : 'project';
  const fitScope = (k) => {
    const sig = trainSig(sets[k]); if (clfs[k] && clfSig[k] === sig) return false;
    clfs[k] = mkModel(); clfs[k].cv = mlEval?.res?.[k]?.[clfs[k].method]?.balanced ?? null; clfs[k].fit(sets[k]); clfSig[k] = sig; return true;
  };
  if (fitScope(active) || clf !== clfs[active]) modelVer++; // the model in use is refitted at once (only if its examples changed); the other two when idle
  clearTimeout(learnIdle);
  learnIdle = setTimeout(() => { for (const k of CLF_SCOPES) if (k !== active) fitScope(k); renderLearn(); renderObject(); if ($('mlDlg')?.open) renderMl(); }, 350);
  clf = clfs[active];
  const idOf = (name) => S.classes.find((c) => c.name === name)?.id || null;
  for (const s of S.sections) {
    for (const o of s.objects.values()) {
      const x = xOf(o);
      if (o.cls || !x) { o.pred = null; o.conf = 0; o.novel = false; o._pv = 0; continue; }
      const xi = visionOn() ? o.emb : o.feat;
      if (o._pv === modelVer && o._pf === xi) continue;   // V0.2: prediction still valid
      o._pv = modelVer; o._pf = xi;
      const p = clf.predict(x);
      o.pred = p?.y ? idOf(p.y) : null; o.conf = o.pred ? p.conf : 0; o.novel = !!p?.novel;
    }
    rebuildLUT(s);
  }
  saveAllModel();
  renderLearn(); renderClasses(); renderObject(); scheduleAnalysis(); requestRender();
  if ($('mlDlg')?.open) renderMl();
}
/** Labelled examples of the other projects (light index), for the all-projects model. */
async function refreshOtherExamples() {
  if (!storageOK) return;
  const lites = await listLite().catch(() => []);
  otherExamples = lites.filter((l) => l.id !== S.id && l.kind !== 'multi').flatMap((l) => (l.examples || []).map((e, i) => ({ key: e.key || `${l.id}|${i}`, y: e.name, x: e.x, xv: e.xv, thumb: e.thumb || null, where: `${l.name} · ${e.core || ''}`, core: e.core || '', project: l.id })));
  scheduleLearn();
}
let allModelTimer = 0;
/** The all-projects model is kept in the browser preferences (available before the other projects are read). */
function saveAllModel() { clearTimeout(allModelTimer); allModelTimer = setTimeout(() => { if (storageOK && clfs.all.n) setPref('model.all', clfs.all.toJSON()).catch(() => {}); }, 3000); }
/** Stored models of the project ("weights"): the project model and one per core. */
function projectModels() {
  // the models already fitted (same method and settings as in use); the core model is kept per core as it was last fitted
  S.coreModels ||= {};
  if (S.curCore && clfs.core.n >= 2) S.coreModels[S.curCore] = clfs.core.toJSON();
  return { project: clfs.project.n ? clfs.project.toJSON() : null, all: null, cores: { ...S.coreModels } };
}

/* ───────────── analysis ───────────── */

let anaTimer = 0;
function scheduleAnalysis() { clearTimeout(anaTimer); anaTimer = setTimeout(() => { analyze(sec()); renderResults(); requestRender(); }, 100); }

// The calculation lives in sectionanalysis.js (pure); these wrappers pass the project state in.
export function effClassArray(s) { return effectiveClassIndex(s, S.classes, S.settings); }

// M8.3.7: with the engine experiment on (desktop only, SEDCORETOOL_ENGINE_EXPERIMENT=1) the bins of every section come from
// the engine; with it off only the JavaScript calculation below runs. There is no per-call choice and no fallback.
const analysisProject = () => ({ classes: S.classes, settings: S.settings, ageModel: S.age.model, ageUnits: S.age.units });
let engineRefresh = 0;
const engineBridge = /** @type {any} */ (window).corantoolDesktop?.engine;
const engineAnalysis = engineBridge?.enabled === true ? createEngineAnalysis({ client: createEngineClient(engineBridge), project: analysisProject, maskChanges, onChange: () => {
  clearTimeout(engineRefresh);
  engineRefresh = setTimeout(() => { renderResults(); requestRender(); if (mode === 'log') scheduleLog(0); else if (mode !== 'section') setMode(mode); }, 50);
} }) : null;
/** Brings the bins of the sections up to date. Resolves when every section has a final state (always, without the engine). */
export function analyzeSections(sections) {
  if (engineAnalysis) return engineAnalysis.all(sections);
  for (const s of sections) analyze(s);
  return Promise.resolve();
}

export function analyze(s) {
  if (!s) return;
  if (engineAnalysis) { void engineAnalysis.request(s); return; }   // asynchronous: the table shows a pending state until the engine answers
  const { bins, rowCache } = computeSectionBins(s, { classes: S.classes, settings: S.settings, ageModel: S.age.model });
  s.bins = bins;
  if (rowCache !== s._rc) s._rc = rowCache;
}

function binRowsOf(s) { return binRowsOfSection(s, S.settings); }
function setManual(s, b, key, val) {
  let m = s.manual.find((e) => Math.abs(e.from - b.dTop) < 1e-9 && Math.abs(e.to - b.dBottom) < 1e-9);
  if (!m) { m = { from: b.dTop, to: b.dBottom, BI: null, ii: null }; s.manual.push(m); }
  m[key] = val;
  if (m.BI == null && m.ii == null) s.manual.splice(s.manual.indexOf(m), 1);
}

/* ───────────── rendering ───────────── */

export const view = $('view'), vctx = view.getContext('2d');
export const prof = $('profile'), pctx = prof.getContext('2d');
let imgData = null, rq = false, cursor = null, lassoPts = null, roiDrag = null, boxDrag = null;

/** V0.2: ichnotaxa hidden while interpreting (view only: nothing is deleted; analysis and figures are unchanged). */
const hiddenCls = () => new Set(S.settings.hidden || []);
function rebuildLUT(s) {
  const n = s.nextId, fill = new Uint8ClampedArray(n * 4), line = new Uint8ClampedArray(n * 4), sty = new Uint8Array(n), hid = hiddenCls();
  for (const o of s.objects.values()) {
    const st = status(o), k = o.id * 4;
    if (hid.size && hid.has(st === 'labeled' ? o.cls : st === 'predicted' ? o.pred : 'undet')) { sty[o.id] = 3; continue; }
    let col, a;
    if (st === 'labeled') { col = hex(clsById(o.cls)?.color || '#ffffff'); a = S.ovAlpha; sty[o.id] = 0; }
    else if (st === 'predicted') { col = hex(clsById(o.pred)?.color || '#ffffff'); a = S.ovAlpha * 0.45; sty[o.id] = 1; }
    else { col = [255, 236, 150]; a = S.ovAlpha * 0.18; sty[o.id] = 2; }
    fill[k] = col[0]; fill[k + 1] = col[1]; fill[k + 2] = col[2]; fill[k + 3] = a * 255;
    line[k] = col[0]; line[k + 1] = col[1]; line[k + 2] = col[2]; line[k + 3] = 255;
  }
  s.lutFill = fill; s.lutLine = line; s.lutStyle = sty;
}

export function requestRender() { if (!rq) { rq = true; requestAnimationFrame(() => { rq = false; render(); renderProfile(); }); } }

export function resizeCanvases() {
  for (const c of [view, prof]) {
    const w = Math.max(1, Math.round(c.clientWidth)), h = Math.max(1, Math.round(c.clientHeight));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }
  requestRender();
}

function render() {
  const s = sec(), cw = view.width, ch = view.height;
  $('empty').hidden = !!s;
  if (!s) { vctx.fillStyle = '#161a19'; vctx.fillRect(0, 0, cw, ch); return; }
  if (!s.orig) {   // V0.1: pixels are being read from disk
    vctx.fillStyle = '#161a19'; vctx.fillRect(0, 0, cw, ch); vctx.fillStyle = '#9aa7a3'; vctx.font = '14px "IBM Plex Sans", sans-serif'; vctx.textAlign = 'center';
    vctx.fillText(s._pxErr || t('mem.loading'), cw / 2, ch / 2); vctx.textAlign = 'start'; needPixels(s); return;
  }
  if (!s.lutFill || s.lutFill.length < s.nextId * 4) rebuildLUT(s);
  if (!imgData || imgData.width !== cw || imgData.height !== ch) imgData = vctx.createImageData(cw, ch);
  const stk = s.stacks, own = (w, id) => w === id || (w < 0 && stk[-w].includes(id));
  const d = imgData.data, src = S.showOrig ? s.orig : s.enh, lab = s.labels, ex = s.exclude, dprob = S.showDoubt && s._unet?.key === unetKey(s) ? s._unet.prob : null;
  const W = s.w, H = s.h, { x: vx, y: vy, zoom: z } = S.view, roi = s.roi;
  const fill = s.lutFill, line = s.lutLine, sty = s.lutStyle, sel = S.selected, step = Math.max(1, Math.round(1 / z));
  const inSel = new Uint8Array(s.nextId + 1); for (const id of S.multi) if (id <= s.nextId) inSel[id] = 1;
  const ixs = new Int32Array(cw);
  for (let sx = 0; sx < cw; sx++) ixs[sx] = Math.floor(vx + (sx + 0.5) / z);
  let o = 0;
  for (let sy = 0; sy < ch; sy++) {
    const iy = Math.floor(vy + (sy + 0.5) / z), rowIn = iy >= 0 && iy < H, base = iy * W, inY = iy >= roi.y0 && iy < roi.y1;
    for (let sx = 0; sx < cw; sx++, o += 4) {
      const ix = ixs[sx];
      if (!rowIn || ix < 0 || ix >= W) { d[o] = 22; d[o + 1] = 26; d[o + 2] = 25; d[o + 3] = 255; continue; }
      const i = base + ix, j = i * 4;
      let r = src[j], g = src[j + 1], b = src[j + 2];
      const v = lab[i], list = v < 0 ? stk[-v] : null;   // V0.20: overlaps are drawn bottom → top
      for (let q = 0, n = list ? list.length : v ? 1 : 0; q < n; q++) {
        const id = list ? list[q] : v; if (sty[id] === 3) continue;
        const k = id * 4, a = fill[k + 3] / 255;
        if (a) { r += (fill[k] - r) * a; g += (fill[k + 1] - g) * a; b += (fill[k + 2] - b) * a; }
        const edge = (ix < step || !own(lab[i - step], id)) || (ix + step >= W || !own(lab[i + step], id)) ||
          (iy < step || !own(lab[i - step * W], id)) || (iy + step >= H || !own(lab[i + step * W], id));
        if (edge) {
          if (id === sel || inSel[id]) { r = 255; g = 255; b = 255; }
          else if (sty[id] !== 1 || ((sx + sy) & 4)) { r = line[k]; g = line[k + 1]; b = line[k + 2]; }
        }
      }
      if (dprob && dprob[i] && doubtful(dprob[i]) && !((sx + sy) & 3)) { r = 236; g = 72; b = 214; }   // V0.15: U-Net doubtful zone
      if (ex[i]) { if (((sx + sy) & 7) < 2) { r = r * 0.3 + 70; g = g * 0.3 + 70; b = b * 0.3 + 80; } else { r *= 0.55; g *= 0.55; b *= 0.55; } }
      if (!inY || ix < roi.x0 || ix >= roi.x1) { r *= 0.42; g *= 0.42; b *= 0.42; }
      d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
    }
  }
  vctx.putImageData(imgData, 0, 0);
  const toS = (x, y) => [(x - vx) * z, (y - vy) * z];
  // analysis area
  vctx.save();
  vctx.strokeStyle = '#e0995a'; vctx.lineWidth = 1; vctx.setLineDash([6, 4]);
  const [rx0, ry0] = toS(roi.x0, roi.y0), [rx1, ry1] = toS(roi.x1, roi.y1);
  vctx.strokeRect(rx0 + 0.5, ry0 + 0.5, rx1 - rx0 - 1, ry1 - ry0 - 1);
  vctx.setLineDash([]);
  for (const r of [roiDrag, boxDrag]) if (r) { const [a, b2] = toS(r.x0, r.y0), [c, e] = toS(r.x1, r.y1); vctx.strokeStyle = '#fff'; vctx.setLineDash(r === boxDrag ? [4, 3] : []); vctx.strokeRect(a, b2, c - a, e - b2); vctx.setLineDash([]); }
  if (lassoPts && lassoPts.length > 1) {
    vctx.strokeStyle = '#fff'; vctx.lineWidth = 1.5; vctx.beginPath();
    lassoPts.forEach(([x, y], k) => { const [a, b2] = toS(x, y); k ? vctx.lineTo(a, b2) : vctx.moveTo(a, b2); });
    vctx.stroke();
  }
  if (cursor && ['brush', 'erase', 'exclude', 'include'].includes(S.tool)) {
    const [a, b2] = toS(cursor.x, cursor.y);
    vctx.strokeStyle = S.tool === 'brush' ? clsById(S.active)?.color || '#fff' : '#fff'; vctx.lineWidth = 1.5;
    vctx.beginPath(); vctx.arc(a, b2, Math.max(2, S.brushSize * z), 0, Math.PI * 2); vctx.stroke();
  }
  drawMarks(s, toS); drawComments(s, toS);
  drawRuler(s, ch);
  drawNav(s, cw, ch);   // V0.26
  drawEdges(s, ch, cw, toS);
  vctx.restore();
  $('zoomLbl').textContent = Math.round(z * 100) + '%';
}

/* ── V32: identification mode — marks of identified traces (point + ichnotaxon), no quantification ── */
export const idMode = () => !!S.settings.idMode;
export function clsAbbr() { return abbrevs(S.classes.map((c) => c.name)); }
/** Click with the Mark tool: add a mark of the active ichnotaxon, or remove the mark under the pointer (also with Alt). */
function toggleMark(s, p, remove) {
  if (!inImg(s, p)) return;
  s.marks ||= [];
  const z = S.view.zoom, hit = s.marks.findIndex((m) => Math.hypot((m.x - p.x) * z, (m.y - p.y) * z) <= 9);
  if (hit >= 0) s.marks.splice(hit, 1);
  else if (!remove) { const c = clsById(S.active); if (!c || c.id === 'artifact') { toast(t('id.pickCls')); return; } s.marks.push({ id: uid(), x: Math.round(p.x), y: Math.round(p.y), cls: c.id }); }
  s.logVer++; markDirty(); scheduleLog(); renderClasses(); requestRender();
}
/* ───────────── V0.8: comments with date, replies, resolve and delete (team work) ───────────── */
const authorName = () => { try { return localStorage.getItem('corantool.author') || ''; } catch { return ''; } };
/** Union of two comment lists by id (replies too); for the same comment the most recently edited state wins. */
function mergeComments(a, b) {
  const by = new Map();
  for (const c of [...a, ...b]) {
    const o = by.get(c.id);
    if (!o) { by.set(c.id, { ...c, replies: [...(c.replies || [])] }); continue; }
    const newer = (c.edited || c.date) > (o.edited || o.date) ? c : o, reps = new Map([...o.replies, ...(c.replies || [])].map((r) => [r.id, r]));
    by.set(c.id, { ...newer, replies: [...reps.values()].sort((x, y) => (x.date < y.date ? -1 : 1)) });
  }
  return [...by.values()].sort((x, y) => (x.date < y.date ? -1 : 1));
}
function drawComments(s, toS) {
  const list = (S.comments || []).filter((c) => c.sec === s.id && c.x != null && !c.done); if (!list.length) return;
  vctx.font = '600 10px "IBM Plex Sans", sans-serif'; vctx.textBaseline = 'middle'; vctx.textAlign = 'center';
  for (const c of list) {
    const [x, y] = toS(c.x, c.y), n = S.comments.indexOf(c) + 1;
    vctx.fillStyle = '#2f6fdf'; vctx.strokeStyle = '#fff'; vctx.lineWidth = 1.5;
    vctx.beginPath(); vctx.arc(x, y - 12, 9, 0, Math.PI * 2); vctx.moveTo(x - 4, y - 5); vctx.lineTo(x, y); vctx.lineTo(x + 4, y - 5); vctx.fill(); vctx.stroke();
    vctx.fillStyle = '#fff'; vctx.fillText(String(n), x, y - 12);
  }
  vctx.textAlign = 'start';
}
function renderComments() {
  const box = $('cmtBody'); if (!box) return;
  const s = sec(), f = $('cmtFilter')?.value || 'all', fmtD = (d) => new Date(d).toLocaleString();
  const list = (S.comments || []).map((c, i) => ({ c, n: i + 1 })).filter(({ c }) => f === 'all' || (f === 'open' && !c.done) || (f === 'sec' && s && c.sec === s.id));
  const where = (c) => { const q = c.sec && S.cores.flatMap((k) => k.sections.map((x) => ({ k, x }))).find((o) => o.x.id === c.sec); return q ? `${esc(q.k.name)} · ${esc(q.x.name)}${c.depth != null ? ` · ${fmt(c.depth, 4)} ${esc(q.x.units)}` : ''}` : esc(t('cmt.general')); };
  box.innerHTML = list.length ? list.map(({ c, n }) => `<div class="cmt ${c.done ? 'done' : ''}" data-id="${c.id}" style="border:1px solid var(--line,#d7ddda);border-radius:8px;padding:8px;margin:6px 0;${c.done ? 'opacity:.6' : ''}">
      <div class="row" style="justify-content:space-between;gap:6px"><b>#${n} ${esc(c.author || '—')}</b><span class="note">${fmtD(c.date)}</span></div>
      <div class="note">${where(c)} ${c.sec ? `<button class="btn small" data-act="go">${t('cmt.go')}</button>` : ''}</div>
      <div style="white-space:pre-wrap;margin:4px 0">${esc(c.text)}</div>
      ${(c.replies || []).map((r) => `<div data-rid="${r.id}" style="margin-left:14px;border-left:3px solid var(--line,#d7ddda);padding-left:8px;margin-top:4px"><div class="row" style="justify-content:space-between"><b>${esc(r.author || '—')}</b><span class="note">${fmtD(r.date)} <button class="btn small ghost" data-act="delr" title="${esc(t('cmt.del'))}">✕</button></span></div><div style="white-space:pre-wrap">${esc(r.text)}</div></div>`).join('')}
      <div class="row" style="gap:6px;margin-top:6px"><input type="text" data-reply placeholder="${esc(t('cmt.replyPh'))}" style="flex:1"><button class="btn small" data-act="reply">${t('cmt.reply')}</button>
      <button class="btn small" data-act="done">${t(c.done ? 'cmt.reopen' : 'cmt.resolve')}</button><button class="btn small danger" data-act="del">${t('cmt.del')}</button></div></div>`).join('')
    : `<p class="note">${t('cmt.none')}</p>`;
  $('cmtBtn').textContent = `💬 ${(S.comments || []).filter((c) => !c.done).length || ''}`.trim();
}
function openComments() { $('cmtAuthor').value = authorName(); $('cmtLink').disabled = !sec(); renderComments(); $('cmtDlg').showModal(); }
function addComment() {
  const text = $('cmtText').value.trim(); if (!text) return;
  const author = $('cmtAuthor').value.trim(); try { localStorage.setItem('corantool.author', author); } catch { /* storage blocked */ }
  const s = sec(), link = $('cmtLink').checked && s, now = new Date().toISOString();
  const cx = link ? Math.round(S.view.x + view.width / 2 / S.view.zoom) : null, cy = link ? Math.round(S.view.y + view.height / 2 / S.view.zoom) : null;
  (S.comments ||= []).push({ id: uid(), author, date: now, edited: now, text, sec: link ? s.id : null, x: cx, y: cy, depth: link ? depthAtRow(s, cy) : null, done: false, replies: [] });
  $('cmtText').value = ''; markDirty(); renderComments(); requestRender();
}
function drawMarks(s, toS) {
  if (!s.marks?.length) return;
  const ab = clsAbbr();
  vctx.font = '600 11px "IBM Plex Sans Condensed", sans-serif'; vctx.textBaseline = 'middle';
  const hid = hiddenCls();
  for (const m of s.marks) {
    const c = clsById(m.cls); if (!c || hid.has(c.id)) continue;
    const [x, y] = toS(m.x, m.y);
    vctx.fillStyle = c.color; vctx.strokeStyle = '#fff'; vctx.lineWidth = 1.5;
    vctx.save(); vctx.translate(x, y); vctx.scale(1.6, 1.6); const shape = new Path2D(traceSymbolPath(c.symbol)); vctx.fill(shape); vctx.stroke(shape); vctx.restore();
    const lab = ab.get(c.name) || ''; vctx.lineWidth = 3; vctx.strokeStyle = 'rgba(0,0,0,.75)'; vctx.strokeText(lab, x + 9, y - 9); vctx.fillStyle = '#fff'; vctx.fillText(lab, x + 9, y - 9);
  }
}
$('idMode').addEventListener('change', (e) => {
  S.settings.idMode = e.target.checked; markDirty();
  if (S.settings.idMode) { setTool('mark'); toast(t('id.on')); } else toast(t('id.off'));
  scheduleLog(); renderClasses();
});
/** Identified traces of the composite on the log axis: marks of every section, plus traced objects if wanted. */
export function compositeMarks(D) {
  const ab = clsAbbr(), out = [];
  for (const s of D.secs) for (const m of s.marks || []) {
    const c = clsById(m.cls); if (!c || m.y < s.roi.y0 || m.y >= s.roi.y1) continue;
    const d = depthAtRow(s, m.y) * D.f(s), a = D.axis === 'age' ? interpAge(D.model, d) : d; if (a == null) continue;
    out.push({ a, xf: (m.x - s.roi.x0) / Math.max(1, s.roi.x1 - s.roi.x0), color: c.color, abbr: ab.get(c.name), name: c.name, symbol: c.symbol || 'triDown', plain: !!c.plain, cls: c.id });
  }
  return out.sort((p, q) => p.a - q.a);
}
/**
 * V0.32: positions of identified ichnotaxa for the distribution figure, on the figure axis (depth or age).
 * src: 'objects' = traces identified on the image (centroid of each object), 'marks' = identification marks placed by
 * hand, 'all' = both. Each point: { a, index (class), kind: 'obj' | 'mark' }.
 */
export function compositeTaxonPoints(D, src = 'all') {
  const out = [], idx = new Map(S.classes.map((c, i) => [c.id, i]));
  const put = (s, y, cid, kind) => {
    const c = clsById(cid); if (!c || c.id === 'artifact' || y < s.roi.y0 || y >= s.roi.y1) return;
    const d = depthAtRow(s, y) * D.f(s), a = D.axis === 'age' ? interpAge(D.model, d) : d;
    if (a != null) out.push({ a, index: idx.get(c.id), kind });
  };
  for (const s of D.secs) {
    if (src !== 'marks') for (const o of s.objects.values()) { const cid = effClassId(o); if (cid && o.stats?.n) put(s, o.stats.sy / o.stats.n, cid, 'obj'); }
    if (src !== 'objects') for (const m of s.marks || []) put(s, m.y, m.cls, 'mark');
  }
  return out.sort((p, q) => p.a - q.a);
}
/** Ichnotaxa identified in each interval of the log (consecutive intervals with the same set are merged). */
export function idListOf(rows, marks) {
  const groups = [];
  for (const r of rows) {
    const inR = marks.filter((m) => m.a >= r.a0 && m.a < r.a1), seen = new Map();
    for (const m of inR) if (!seen.has(m.cls)) seen.set(m.cls, { name: m.name, abbr: m.abbr, color: m.color, plain: m.plain });
    const items = [...seen.values()], key = items.map((k) => k.name).sort().join('|'), last = groups[groups.length - 1];
    if (!items.length) continue;
    if (last && last.key === key && Math.abs(last.a1 - r.a0) < 1e-9) last.a1 = r.a1; else groups.push({ a0: r.a0, a1: r.a1, items, key });
  }
  return groups;
}
/** Colour legend of the ichnotaxa shown (traced, predicted or marked). */
export function legendOf(classes, marks) {
  const names = new Set(marks.map((m) => m.name));
  return S.classes.filter((c) => c.id !== 'artifact' && (names.has(c.name) || classes.some((k) => k.name === c.name))).map((c) => ({ name: c.name, color: c.color, symbol: c.symbol || 'triDown' }));
}

/* ── V31: Start/End markers of the analysed interval and the crop lines ── */
export let cropState = null;   // {s, y0, y1} while cropping
function edgeYs(s) { return cropState?.s === s ? { a: cropState.y0, b: cropState.y1, crop: true } : { a: s.roi.y0, b: s.roi.y1, crop: false }; }
function drawEdges(s, ch, cw, toS) {
  const G = navGut(); vctx.save(); vctx.translate(G, 0);   // V0.27: right of the navigation gutter
  try { drawEdgesAt(s, ch, cw - G, toS); } finally { vctx.restore(); }
}
function drawEdgesAt(s, ch, cw, toS) {
  const E = edgeYs(s), [, ya] = toS(0, E.a), [, yb] = toS(0, E.b);
  if (E.crop) {   // darken what will be removed, dashed cut lines
    vctx.fillStyle = 'rgba(160,30,30,.38)';
    vctx.fillRect(54, 0, cw - 54, Math.max(0, ya)); vctx.fillRect(54, yb, cw - 54, Math.max(0, ch - yb));
    vctx.strokeStyle = '#ff6b5a'; vctx.lineWidth = 2; vctx.setLineDash([8, 5]);
    for (const y of [ya, yb]) { vctx.beginPath(); vctx.moveTo(54, y); vctx.lineTo(cw, y); vctx.stroke(); }
    vctx.setLineDash([]);
  }
  vctx.font = '600 10px "IBM Plex Sans Condensed", sans-serif'; vctx.textBaseline = 'middle';
  for (const [y, lab, up] of [[ya, E.crop ? 'Crop top' : 'Start', false], [yb, E.crop ? 'Crop bottom' : 'End', true]]) {
    if (y < -12 || y > ch + 12) continue;
    vctx.fillStyle = E.crop ? '#ff6b5a' : '#e0995a';
    vctx.beginPath(); vctx.moveTo(56, y - 9); vctx.lineTo(72, y); vctx.lineTo(56, y + 9); vctx.closePath(); vctx.fill();
    vctx.strokeStyle = '#14100c'; vctx.lineWidth = 1; vctx.stroke();
    const tw = vctx.measureText(lab).width + 8, ty = up ? y + 18 : y - 18;
    vctx.fillStyle = 'rgba(14,17,16,.85)'; vctx.fillRect(56, ty - 8, tw, 16);
    vctx.fillStyle = E.crop ? '#ff9b8f' : '#f0b87e'; vctx.fillText(lab, 60, ty);
  }
}
/** Which marker is under the pointer: 'a' (Start / crop top) or 'b' (End / crop bottom). */
function edgeHit(s, sx0, sy) {
  const sx = sx0 - navGut(), E = edgeYs(s), z = S.view.zoom, ya = (E.a - S.view.y) * z, yb = (E.b - S.view.y) * z;
  const near = (y) => (E.crop ? Math.abs(sy - y) <= 7 && sx >= 50 : sx >= 50 && sx <= 78 && Math.abs(sy - y) <= 11);
  return near(ya) ? 'a' : near(yb) ? 'b' : null;
}
function startCrop() {
  const s = sec(); if (!s?.orig) return;
  cropState = { s, y0: 0, y1: s.h }; $('cropBar').hidden = false; updateCropInfo(); requestRender();
}
export function endCrop() { cropState = null; $('cropBar').hidden = true; requestRender(); }
function cropResult() {
  const c = cropState, s = c.s, adjust = document.querySelector('input[name=cropMode]:checked')?.value !== 'keep';
  const r0 = Math.max(s.roi.y0, c.y0), r1 = Math.min(s.roi.y1, c.y1);
  return adjust ? { top: depthAtRow(s, r0), bottom: depthAtRow(s, r1), roi: { x0: s.roi.x0, x1: s.roi.x1, y0: r0 - c.y0, y1: r1 - c.y0 } }
    : { top: s.top, bottom: s.bottom, roi: { x0: s.roi.x0, x1: s.roi.x1, y0: 0, y1: c.y1 - c.y0 } };
}
function updateCropInfo() {
  if (!cropState) return; const s = cropState.s, r = cropResult();
  $('cropInfo').textContent = t('crop.info', { h: cropState.y1 - cropState.y0, H: s.h, a: fmt(r.top, 3), b: fmt(r.bottom, 3), u: s.units });
}
/** Rectangle [x0,x1)×[y0,y1) of the working image (rotated frame) → rectangle in full-resolution pixels of the file. */
function workToFull(s, R) {
  let w = s.w, h = s.h, x0 = R.x0, y0 = R.y0, x1 = R.x1, y1 = R.y1;
  for (let r = 0; r < ((s.rot % 4) + 4) % 4; r++) {   // undo one clockwise turn: (x, y) in w×h → (y, w − x) in h×w
    [x0, y0, x1, y1] = [Math.min(y0, y1), Math.min(w - x0, w - x1), Math.max(y0, y1), Math.max(w - x0, w - x1)]; [w, h] = [h, w];
  }
  const c = s.crop || { x0: 0, y0: 0 }, k = s.ds;
  return { x0: c.x0 + x0 * k, y0: c.y0 + y0 * k, x1: c.x0 + x1 * k, y1: c.y0 + y1 * k };
}
/** Remove the rows outside [y0, y1) from the image and its masks. V0.1: the original file is kept; the crop is stored in full-resolution pixels. */
async function applyCrop() {
  const c = cropState; if (!c) return; const s = c.s, { y0, y1 } = c;
  if (y0 <= 0 && y1 >= s.h) { endCrop(); return; }
  if (y1 - y0 < 10) { toast(t('crop.small')); return; }
  const r = cropResult(), W = s.w, H = y1 - y0;
  const crop = workToFull({ w: s.w, h: s.h, rot: s.rot, ds: s.ds, crop: s.crop }, { x0: 0, y0, x1: W, y1 });
  await busy(async () => {
    const cut = (arr, ch) => arr.slice(y0 * W * ch, y1 * W * ch);
    s.orig = cut(s.orig, 4); if (s.orig16) s.orig16 = cut(s.orig16, 4); s.labels = cut(s.labels, 1); s.exclude = cut(s.exclude, 1); s.h = H;
    compactSectionStacks(s, true);
    s.marks = (s.marks || []).filter((m) => m.y >= y0 && m.y < y1).map((m) => ({ ...m, y: m.y - y0 }));
    s.top = r.top; s.bottom = r.bottom; s.roi = r.roi;
    s.crop = crop; s.logVer++;
    s.view = null;
    enhance(s); refreshObjects(s, new Set(s.objects.keys()), null);
    discardEditHistory(s);
    endCrop(); selectSection(S.cur, true); afterChange(s);
    toast(t('crop.done', { a: fmt(s.top, 3), b: fmt(s.bottom, 3), u: s.units }));
  });
}
$('cropBtn').addEventListener('click', () => (cropState ? endCrop() : startCrop()));
$('cropApply').addEventListener('click', applyCrop);
$('cropCancel').addEventListener('click', endCrop);
$('cropBar').addEventListener('change', updateCropInfo);

function niceStep(pxPerUnit, minPx) {
  const steps = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
  return steps.find((v) => v * pxPerUnit >= minPx) || 10000;
}

/* ───────────── V0.26: navigation strip — the whole analysis area at the right edge of the view; click or drag to move ───────────── */
let navBox = null, navigationPreviewOn = true;
/** @type {HTMLInputElement} */ ($('navPreview')).checked = navigationPreviewOn;
$('navPreview').addEventListener('change', (event) => {
  event.stopPropagation(); // A session display choice must not trigger the generic project-change handler.
  navigationPreviewOn = /** @type {HTMLInputElement} */ (event.target).checked;
  if (!navigationPreviewOn) clearNavigationPreviews();
  requestRender();
});
/** V0.27: width of the navigation gutter at the left of the depth ruler (0 when turned off). */
const navGut = () => (S.settings?.nav === false ? 0 : 66);
function drawNav(s, cw, ch) {
  navBox = null;
  const G = navGut(); if (!G) return;
  vctx.fillStyle = '#0e1110'; vctx.fillRect(0, 0, G, ch);
  vctx.fillStyle = '#262c2b'; vctx.fillRect(G - 1, 0, 1, ch);
  if (!s.orig) return;
  const roi = s.roi, rh = roi.y1 - roi.y0, rw = roi.x1 - roi.x0, H = ch - 30, z = S.view.zoom, y = 14;
  if (H < 60) return;
  const W = Math.round(Math.max(8, Math.min(24, (H * rw) / rh))), x = 6;
  const preview = navigationPreviewOn ? navigationPreviewCanvas(s, W, H, { x, y }) : null;
  const cv = preview ? null : sectionCanvas(s), kk = s._lc?.k || 1;
  try {
    if (preview) vctx.drawImage(preview, x, y, W, H, x, y, W, H);
    else { vctx.drawImage(cv, roi.x0 * kk, roi.y0 * kk, rw * kk, rh * kk, x, y, W, H); }
  } catch { /* pending */ }
  vctx.strokeStyle = '#3a4240'; vctx.lineWidth = 1; vctx.strokeRect(x - 0.5, y - 0.5, W + 1, H + 1);
  // its own small ruler: the whole section from top to bottom
  const span = s.bottom - s.top;
  if (span > 0) {
    const st = niceStep(H / span, 34), tx = x + W + 3;
    vctx.font = '9px "IBM Plex Mono", monospace'; vctx.textBaseline = 'middle'; vctx.textAlign = 'left';
    for (let v = Math.ceil(s.top / st - 1e-9) * st; v <= s.bottom + 1e-9; v += st) {
      const yy = Math.round(y + ((v - s.top) / span) * H) + 0.5;
      vctx.fillStyle = '#e6e1d6'; vctx.fillRect(x + W - 4, yy, 4, 1);   // tick on the strip edge, so it is not read as a minus sign
      vctx.fillStyle = '#a49d91'; vctx.fillText(fmt(v, 3), tx + 1, yy);
    }
  }
  const a = Math.max(0, (S.view.y - roi.y0) / rh), b = Math.min(1, (S.view.y + ch / z - roi.y0) / rh);
  vctx.fillStyle = 'rgba(224,153,90,.22)'; vctx.fillRect(x, y + a * H, W, Math.max(3, (b - a) * H));
  vctx.strokeStyle = '#e0995a'; vctx.lineWidth = 2; vctx.strokeRect(x - 1.5, y + a * H, W + 3, Math.max(3, (b - a) * H));
  navBox = { x: 0, y, w: G, h: H, roi };
}
function navTo(py) {
  const s = sec(); if (!s || !navBox) return;
  const f = Math.min(1, Math.max(0, (py - navBox.y) / navBox.h)), z = S.view.zoom;
  S.view.y = navBox.roi.y0 + f * (navBox.roi.y1 - navBox.roi.y0) - view.height / (2 * z); clampView(); requestRender();
}
view.addEventListener('pointerdown', (e) => {
  if (!navBox) return;
  const r = view.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  if (px < navBox.x || px > navBox.x + navBox.w || py < navBox.y - 3 || py > navBox.y + navBox.h + 3) return;
  e.stopImmediatePropagation(); e.preventDefault(); view.setPointerCapture(e.pointerId); navTo(py);
  const move = (ev) => navTo(ev.clientY - r.top), up = () => view.removeEventListener('pointermove', move, true);
  view.addEventListener('pointermove', move, true); view.addEventListener('pointerup', up, { once: true, capture: true });
}, true);
/** Whole analysis area in view (height fits). */
function fitAll() {
  const s = sec(); if (!s) return;
  const G = navGut(), rh = s.roi.y1 - s.roi.y0, rw = s.roi.x1 - s.roi.x0, z = Math.min(8, Math.max(0.02, Math.min((view.height - 24) / rh, (view.width - 76 - G) / rw)));
  S.view = { zoom: z, x: s.roi.x0 - (G + 62) / z, y: s.roi.y0 - 12 / z }; clampView(); requestRender();
}
$('zoomAll').addEventListener('click', fitAll);
/** Page Up / Page Down move one screen (90 %); Home / End go to the top or bottom of the analysis area. */
document.addEventListener('keydown', (e) => {
  if (mode !== 'section' || !sec() || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  const s = sec(), z = S.view.zoom, page = (view.height / z) * 0.9;
  if (e.key === 'PageDown') S.view.y += page; else if (e.key === 'PageUp') S.view.y -= page;
  else if (e.key === 'Home') S.view.y = s.roi.y0 - 12 / z; else if (e.key === 'End') S.view.y = s.roi.y1 - view.height / z + 12 / z;
  else return;
  e.preventDefault(); clampView(); requestRender();
});

function drawRuler(s, ch) {
  const G = navGut(); vctx.save(); vctx.translate(G, 0);
  try { drawRulerAt(s, ch); } finally { vctx.restore(); }
}
function drawRulerAt(s, ch) {
  const span = s.bottom - s.top; if (!(span > 0)) return;
  const z = S.view.zoom, pxu = ((s.roi.y1 - s.roi.y0) / span) * z, st = niceStep(pxu, 56);
  const d0 = Math.max(s.top, depthAtRow(s, S.view.y)), d1 = Math.min(s.bottom, depthAtRow(s, S.view.y + ch / z));
  vctx.fillStyle = 'rgba(14,17,16,.78)'; vctx.fillRect(0, 0, 54, ch);
  vctx.strokeStyle = '#8f8a80'; vctx.fillStyle = '#e6e1d6'; vctx.font = '11px "IBM Plex Mono", monospace'; vctx.textBaseline = 'middle';
  const minor = st / 5;
  for (let v = Math.ceil(d0 / minor) * minor; v <= d1 + 1e-9; v += minor) {
    const y = Math.round((rowAtDepth(s, v) - S.view.y) * z) + 0.5, major = Math.abs(v / st - Math.round(v / st)) < 1e-6;
    vctx.beginPath(); vctx.moveTo(major ? 40 : 47, y); vctx.lineTo(54, y); vctx.stroke();
    if (major) vctx.fillText(fmt(v, 3), 4, y);
  }
  vctx.fillStyle = '#e0995a'; vctx.fillText(s.units, 4, ch - 10);
}

/* V0.21: side column — adjustable width (drag its left edge), fixed scales on top, and records from Data as extra tracks. */
const sideCache = new WeakMap();   // V0.41: side-column series cached per section until records, age model or units change
function sideSeries(s) {
  const wantL = S.settings.sideRecs || [], base0 = S.sections[0]?.units || s.units;
  const key = `${wantL.join('\u0001')}|${S.age.text}|${s.units}|${base0}|` + (S.records || []).map((r) => `${r.id}:${r.axis}:` + r.series.filter((se) => wantL.includes(se.name)).map((se) => `${se.name}/${se.color}/${!!se.reverse}/${se.x.length}/${se.y[0]}/${se.y[se.y.length - 1]}`).join(',')).join(';');
  const hit = sideCache.get(s); if (hit?.key === key) return hit.out;
  const out = sideSeriesCalc(s); sideCache.set(s, { key, out }); return out;
}
function sideSeriesCalc(s) {
  const want = new Set(S.settings.sideRecs || []), out = [], base = S.sections[0]?.units || s.units, inv = S.age.model ? invertModel(S.age.model) : null;
  for (const r of S.records || []) for (const se of r.series) {
    if (!want.has(se.name)) continue;
    const pts = [];
    for (let i = 0; i < se.x.length; i++) {
      const d = toAxis(se.x[i], r.axis, 'depth', S.age.model, inv), v = se.y[i];
      if (d == null || v == null || !Number.isFinite(+v)) continue;
      pts.push([(d * UNIT_TO_CM[base]) / UNIT_TO_CM[s.units], +v]);
    }
    if (!pts.length) continue;
    let lo = Infinity, hi = -Infinity; for (const [, v] of pts) { if (v < lo) lo = v; if (v > hi) hi = v; }
    out.push({ name: se.name, color: se.color || '#7fb8d4', reverse: !!se.reverse, pts, lo, hi: hi > lo ? hi : lo + 1 });
  }
  return out;
}
const tickTxt = (v) => (Math.abs(v) >= 1000 || (Math.abs(v) < 0.01 && v) ? v.toExponential(0) : String(+v.toPrecision(3)));
let profLayout = [];   // V0.24: tracks of the side column [{ id, x0, x1 }] for resizing them from the header
function renderProfile() {
  const s = sec(), W = prof.width, H = prof.height, HEAD = 36;
  pctx.fillStyle = '#121615'; pctx.fillRect(0, 0, W, H); profLayout = [];
  if (!s || !s.bins?.length) return;
  // V0.24: each track has its own width (S.settings.sideW, px; the bioturbation track fills the rest unless set) and can be hidden (sideHide)
  const SW = S.settings.sideW || {}, HID = new Set(S.settings.sideHide || []), showP = !HID.has('pct'), showB = !HID.has('BI'), showI = !HID.has('ii');
  const recs = sideSeries(s), gap = 6, x0 = 8, colW = Math.max(18, Math.min(30, W * 0.13)), recW = Math.max(48, Math.min(90, W * 0.22));
  const wB = SW.BI || colW, wI = SW.ii || colW, wR = recs.map((r) => SW['rec:' + r.name] || recW);
  const fixed = (showB ? wB + gap : 0) + (showI ? wI + gap : 0) + wR.reduce((a, w) => a + w + gap, 0);
  const pw = showP ? SW.pct || Math.max(40, W - x0 - fixed) : 0;
  let x = x0 + (showP ? pw + gap : 0); const bx = x; if (showB) x += wB + gap; const ix = x; if (showI) x += wI + gap;
  const rxs = wR.map((w) => { const a = x; x += w + gap; return a; });
  if (showP) profLayout.push({ id: 'pct', x0, x1: x0 + pw });
  if (showB) profLayout.push({ id: 'BI', x0: bx, x1: bx + wB });
  if (showI) profLayout.push({ id: 'ii', x0: ix, x1: ix + wI });
  recs.forEach((r, k) => profLayout.push({ id: 'rec:' + r.name, x0: rxs[k], x1: rxs[k] + wR[k] }));
  const z = S.view.zoom, vy = S.view.y, yOf = (r) => (s.roi.y0 + r - vy) * z;
  pctx.strokeStyle = '#2c3331'; pctx.lineWidth = 1;
  if (showP) for (const p of [0, 25, 50, 75, 100]) { const xx = Math.round(x0 + (p / 100) * pw) + 0.5; pctx.beginPath(); pctx.moveTo(xx, HEAD); pctx.lineTo(xx, H); pctx.stroke(); }
  const cols = S.classes.map((c) => hex(c.color));
  const pts = [];
  for (const b of s.bins) {
    const y0 = yOf(b.r0), y1 = yOf(b.r1);
    if (y1 < HEAD || y0 > H) continue;
    const hgt = Math.max(1, y1 - y0);
    if (showP) {
      // V0.20: with overlapping traces the class percentages may add up to more than the total: the stack is scaled to the total
      const sum = b.classPct.reduce((a, v) => a + (v || 0), 0), k0 = b.pct != null && sum > b.pct && sum > 0 ? b.pct / sum : 1;
      let acc = 0;
      const spH = new Set(S.logView?.style?.speciesHide || []);   // V0.31
      b.classPct.forEach((v, k) => {
        if (!v || spH.has(S.classes[k]?.name)) return;
        const [r, g, bl] = cols[k]; pctx.fillStyle = `rgba(${r},${g},${bl},.75)`;
        pctx.fillRect(x0 + (acc / 100) * pw, y0, ((v * k0) / 100) * pw, hgt); acc += v * k0;
      });
      if (b.pct != null) pts.push([x0 + (b.pct / 100) * pw, (y0 + y1) / 2]);
    }
    for (const [on, xx, w, val, max, man] of [[showB, bx, wB, b.BI, 6, b.BIm], [showI, ix, wI, b.ii, 6, b.iim]]) {
      if (!on) continue;
      if (val != null) { pctx.fillStyle = '#e0995a'; pctx.fillRect(xx, y0, (val / max) * w, Math.max(1, hgt - (hgt > 3 ? 1 : 0))); }
      if (man != null) { pctx.strokeStyle = '#ffffff'; pctx.strokeRect(xx + (man / max) * w - 1.5, y0 + 0.5, 3, Math.max(1, hgt - 1)); }
    }
  }
  pctx.strokeStyle = '#f3ece0'; pctx.lineWidth = 1.5; pctx.beginPath();
  pts.forEach(([px, py], k) => (k ? pctx.lineTo(px, py) : pctx.moveTo(px, py))); pctx.stroke();
  recs.forEach((r, k) => {   // records: own scale per track (min–max of the whole series)
    const xa = rxs[k], rw = wR[k], xOf = (v) => xa + 2 + (((r.reverse ? r.hi - v : v - r.lo) / (r.hi - r.lo)) * (rw - 4));
    pctx.strokeStyle = '#2c3331'; pctx.lineWidth = 1; pctx.strokeRect(xa + 0.5, HEAD + 0.5, rw - 1, H - HEAD - 1);
    pctx.save(); pctx.beginPath(); pctx.rect(xa, HEAD, rw, H - HEAD); pctx.clip();
    pctx.strokeStyle = r.color; pctx.lineWidth = 1.4; pctx.beginPath(); let on = false;
    for (const [d, v] of r.pts) {
      const yy = (rowAtDepth(s, d) - vy) * z;
      if (d < Math.min(s.top, s.bottom) || d > Math.max(s.top, s.bottom)) { on = false; continue; }
      if (on) pctx.lineTo(xOf(v), yy); else { pctx.moveTo(xOf(v), yy); on = true; }
    }
    pctx.stroke(); pctx.restore();
  });
  // fixed header: titles and horizontal scales (they stay while the view scrolls)
  pctx.fillStyle = '#121615'; pctx.fillRect(0, 0, W, HEAD);
  pctx.strokeStyle = '#3a4240'; pctx.beginPath(); pctx.moveTo(0, HEAD - 0.5); pctx.lineTo(W, HEAD - 0.5); pctx.stroke();
  pctx.fillStyle = '#b5aea2'; pctx.font = '600 10.5px "IBM Plex Sans Condensed", sans-serif'; pctx.textBaseline = 'middle'; pctx.textAlign = 'left';
  const clip = (txt, w) => { let t2 = txt; while (t2.length > 2 && pctx.measureText(t2).width > w) t2 = t2.slice(0, -2) + '…'; return t2; };
  if (showP) pctx.fillText(clip(t('p.pct'), pw), x0, 10); if (showB) pctx.fillText('BI', bx, 10); if (showI) pctx.fillText('ii', ix, 10);
  recs.forEach((r, k) => { pctx.fillStyle = r.color; pctx.fillText(clip(r.name, wR[k] - 2), rxs[k], 10); });
  pctx.font = '9.5px "IBM Plex Mono", monospace'; pctx.fillStyle = '#8f8a80';
  const tick = (xx, txt, align) => { pctx.textAlign = align; pctx.fillText(txt, xx, 26); pctx.fillRect(Math.round(xx), HEAD - 4, 1, 4); };
  if (showP) for (const p of pw < 110 ? [0, 50, 100] : [0, 25, 50, 75, 100]) tick(x0 + (p / 100) * pw, String(p), p === 0 ? 'left' : p === 100 ? 'right' : 'center');
  for (const [on, xx, w] of [[showB, bx, wB], [showI, ix, wI]]) if (on) { tick(xx, '0', 'left'); tick(xx + w, '6', 'right'); }
  recs.forEach((r, k) => {   // narrow tracks: the second number is left out when the two would touch
    const xa = rxs[k], lo = tickTxt(r.reverse ? r.hi : r.lo), hi = tickTxt(r.reverse ? r.lo : r.hi);
    tick(xa + 2, lo, 'left'); if (pctx.measureText(lo).width + pctx.measureText(hi).width + 6 < wR[k] - 4) tick(xa + wR[k] - 2, hi, 'right');
  });
  pctx.fillStyle = '#5b6763'; for (const L of profLayout) pctx.fillRect(Math.round(L.x1) + 2, 3, 1, HEAD - 6);   // resize handles
  pctx.textAlign = 'left';
}
/** Width of the side column: drag its left edge (double click restores it). */
const PROF_EDGE = 6;
function applyProfWidth() { const w = panelPrefs.profW; const vp = prof.parentElement; if (w) vp.style.setProperty('--pw', w + 'px'); else vp.style.removeProperty('--pw'); requestAnimationFrame(() => resizeCanvases()); }
const trackEdge = (e) => (e.offsetY <= 36 ? profLayout.find((L) => Math.abs(e.offsetX - (L.x1 + 2)) <= 4) : null);
prof.addEventListener('pointermove', (e) => { if (!prof._drag) prof.style.cursor = e.offsetX <= PROF_EDGE || trackEdge(e) ? 'col-resize' : ''; });
prof.addEventListener('pointerdown', (e) => {   // V0.24: drag the right edge of a track in the header to change its width
  const L = e.offsetX > PROF_EDGE && trackEdge(e); if (!L) return;
  e.preventDefault(); e.stopImmediatePropagation(); prof.setPointerCapture(e.pointerId); prof._drag = true;
  const r = prof.getBoundingClientRect();
  const move = (ev) => { (S.settings.sideW ||= {})[L.id] = Math.round(Math.max(16, ev.clientX - r.left - L.x0)); requestRender(); };
  const up = () => { prof._drag = false; prof.removeEventListener('pointermove', move); markDirty(); if ($('profMenu').open) renderProfMenu(); };
  prof.addEventListener('pointermove', move); prof.addEventListener('pointerup', up, { once: true });
});
prof.addEventListener('pointerdown', (e) => {
  if (e.offsetX > PROF_EDGE) return;
  e.preventDefault(); prof.setPointerCapture(e.pointerId); prof._drag = true;
  const vp = prof.parentElement, r = vp.getBoundingClientRect();
  const move = (ev) => { const w = Math.round(Math.max(140, Math.min(r.width - 200, r.right - ev.clientX))); panelPrefs.profW = w; vp.style.setProperty('--pw', w + 'px'); resizeCanvases(); };
  const up = () => { prof._drag = false; prof.removeEventListener('pointermove', move); savePanels(); };
  prof.addEventListener('pointermove', move); prof.addEventListener('pointerup', up, { once: true });
});
prof.addEventListener('dblclick', (e) => { if (e.offsetX <= PROF_EDGE) { delete panelPrefs.profW; savePanels(); applyProfWidth(); } });
/** Menu of the side column: each track shown or hidden, its width, and records from Data. */
function renderProfMenu() {
  const box = $('profRecs'); if (!box) return;
  const names = [...new Set((S.records || []).flatMap((r) => r.series.map((x) => x.name)))], on = new Set(S.settings.sideRecs || []), hid = new Set(S.settings.sideHide || []), SW = S.settings.sideW || {};
  const row = (id, label, checked, attr) => `<div class="row" style="gap:6px;flex-wrap:nowrap"><label class="chk" style="flex:1;min-width:0"><input type="checkbox" ${attr} ${checked ? 'checked' : ''}><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(label)}</span></label><input type="number" data-sw="${esc(id)}" min="16" max="800" step="5" value="${SW[id] ?? ''}" placeholder="${t('fig.auto2')}" title="${esc(t('p.width'))}" style="width:62px"></div>`;
  box.innerHTML = `<b style="font-size:11px">${t('p.tracks')}</b>${row('pct', t('p.pct'), !hid.has('pct'), 'data-sh="pct"')}${row('BI', 'BI', !hid.has('BI'), 'data-sh="BI"')}${row('ii', 'ii', !hid.has('ii'), 'data-sh="ii"')}
    <b style="font-size:11px;margin-top:4px">${t('log.records')}</b>${names.length ? names.map((n) => row('rec:' + n, n, on.has(n), `data-rec="${esc(n)}"`)).join('') : `<p class="note">${t('p.noRecs')}</p>`}
    <p class="note">${t('p.widthNote')}</p>`;
}
$('profRecs').addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.sw != null) { const W = (S.settings.sideW ||= {}); if (+el.value >= 16) W[el.dataset.sw] = Math.min(800, +el.value); else delete W[el.dataset.sw]; }
  else if (el.dataset.sh) { const h = new Set(S.settings.sideHide || []); if (el.checked) h.delete(el.dataset.sh); else h.add(el.dataset.sh); S.settings.sideHide = [...h]; }
  else S.settings.sideRecs = [...$('profRecs').querySelectorAll('[data-rec]:checked')].map((i) => i.dataset.rec);
  markDirty(); requestRender();
});
$('profMenu').addEventListener('toggle', () => { if ($('profMenu').open) renderProfMenu(); });

/* ───────────── view ───────────── */

function clampView() {
  const s = sec(); if (!s) return;
  const z = S.view.zoom, cw = view.width / z, ch = view.height / z;
  S.view.x = Math.min(Math.max(S.view.x, -cw + 40 / z), s.w - 40 / z);
  S.view.y = Math.min(Math.max(S.view.y, -ch + 40 / z), s.h - 40 / z);
}
function fitView() {
  const s = sec(); if (!s) return;
  const G = navGut(), rw = s.roi.x1 - s.roi.x0, z = Math.min(8, Math.max(0.02, (view.width - 76 - G) / rw));
  S.view = { zoom: z, x: s.roi.x0 - (62 + G) / z, y: s.roi.y0 - 12 / z };
  requestRender();
}
export function zoomAt(sx, sy, f) {
  const z0 = S.view.zoom, z = Math.min(40, Math.max(0.02, z0 * f));
  S.view.x += sx / z0 - sx / z; S.view.y += sy / z0 - sy / z; S.view.zoom = z;
  clampView(); requestRender();
}
function centerOn(o) {
  const [x0, y0, x1, y1] = o.bbox;   // pans only: the zoom chosen by the user is kept
  const z = S.view.zoom;
  S.view.x = (x0 + x1) / 2 - view.width / (2 * z); S.view.y = (y0 + y1) / 2 - view.height / (2 * z);
  clampView(); requestRender();
}

/* ───────────── pointer tools ───────────── */

let drag = null, spaceDown = false;
function toImg(e) { const r = view.getBoundingClientRect(); const sx = e.clientX - r.left, sy = e.clientY - r.top; return { sx, sy, x: S.view.x + sx / S.view.zoom, y: S.view.y + sy / S.view.zoom }; }
const inImg = (s, p) => p.x >= 0 && p.y >= 0 && p.x < s.w && p.y < s.h;

function paintAt(op, cx, cy) {
  const s = op.s, r = S.brushSize, r2 = r * r;
  const xa = Math.max(0, Math.floor(cx - r)), xb = Math.min(s.w - 1, Math.ceil(cx + r)), ya = Math.max(0, Math.floor(cy - r)), yb = Math.min(s.h - 1, Math.ceil(cy + r));
  for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
    if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > r2) continue;
    const i = y * s.w + x; grow(op, x, y);
    if (op.mode === 'brush') addPx(op, i, op.target);
    else if (op.mode === 'erase') { if (op.only) subPx(op, i, op.only); else setLabel(op, i, 0); }   // V0.20: Mayús = only the selected trace
    else setEx(op, i, op.mode === 'exclude' ? 1 : 0);
  }
}
function paintSeg(op, a, b) {
  const dist = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(dist / Math.max(1, S.brushSize / 3)));
  for (let k = 1; k <= n; k++) paintAt(op, a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n);
}

view.addEventListener('pointerdown', (e) => {
  const s = sec(); if (!s || !s.orig) return;
  view.setPointerCapture(e.pointerId);
  const p = toImg(e);
  if (e.button === 1 || S.tool === 'pan' || spaceDown) { drag = { type: 'pan', sx: e.clientX, sy: e.clientY, vx: S.view.x, vy: S.view.y }; return; }
  if (e.button !== 0) return;
  const eh = edgeHit(s, p.sx, p.sy);
  if (eh) { drag = { type: 'edge', which: eh }; return; }
  const tool = S.tool;
  // Selection: click selects; Shift/Ctrl+click adds or removes; dragging draws a box (Shift/Ctrl adds to the selection).
  if (tool === 'select') drag = { type: 'select', sx: e.clientX, sy: e.clientY, moved: false, p, add: e.shiftKey || e.ctrlKey || e.metaKey };
  else if ((tool === 'exclude' || tool === 'include') && (e.shiftKey || S.exShape === 'rect')) { boxDrag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }; drag = { type: 'exrect', mode: tool }; }
  else if (tool === 'roi') { roiDrag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }; drag = { type: 'roi' }; }
  else if (tool === 'mark') { toggleMark(s, p, e.altKey); return; }
  else if (tool === 'cut') { lassoPts = [[p.x, p.y]]; drag = { type: 'cut' }; }
  else if (tool === 'lasso') { lassoPts = [[p.x, p.y]]; drag = { type: 'lasso', mode: e.altKey ? 'sub' : e.shiftKey ? 'add' : 'new' }; }
  else if (tool === 'wand') {
    if (!inImg(s, p)) return;
    const seed = Math.floor(p.y) * s.w + Math.floor(p.x);
    applyPixels(regionGrow(S.showOrig ? s.orig : s.enh, s.w, s.h, seed, S.wandTol, s.roi, s.exclude), e.altKey ? 'sub' : e.shiftKey ? 'add' : 'new');
  } else {
    const op = beginOp(s); op.mode = tool;
    if (tool === 'brush') {
      const under = inImg(s, p) ? topLab(s, Math.floor(p.y) * s.w + Math.floor(p.x)) : 0;
      op.target = e.shiftKey && S.selected ? S.selected : ((!S.overlap || s.objects.get(under)?.cls === S.active) && under) || newObject(op, S.active, 'brush').id;   // V0.30: over a trace of the active ichnotaxon the brush extends it   // V0.20: with «Superponer», a new trace
      rebuildLUT(s);
    }
    if (tool === 'erase' && e.shiftKey && S.selected) op.only = S.selected;
    paintAt(op, p.x, p.y);
    drag = { type: 'paint', op, last: p };
    requestRender();
  }
});

view.addEventListener('pointermove', (e) => {
  const s = sec(); if (!s) return;
  const p = toImg(e); cursor = p;
  updateStatus(s, p);
  if (!drag) { view.style.cursor = edgeHit(s, p.sx, p.sy) ? 'ns-resize' : ''; if (['brush', 'erase', 'exclude', 'include'].includes(S.tool)) requestRender(); return; }
  if (drag.type === 'edge') {
    const y = Math.round(Math.min(s.h, Math.max(0, p.y)));
    if (cropState?.s === s) { if (drag.which === 'a') cropState.y0 = Math.min(y, cropState.y1 - 10); else cropState.y1 = Math.max(y, cropState.y0 + 10); updateCropInfo(); }
    else if (drag.which === 'a') s.roi = { ...s.roi, y0: Math.min(y, s.roi.y1 - 4) }; else s.roi = { ...s.roi, y1: Math.max(y, s.roi.y0 + 4) };
    requestRender(); return;
  }
  if (drag.type === 'select') {
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
    boxDrag = { x0: drag.p.x, y0: drag.p.y, x1: p.x, y1: p.y }; drag = { type: 'box', add: drag.add }; requestRender();
  } else if (drag.type === 'pan') {
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    S.view.x = drag.vx - dx / S.view.zoom; S.view.y = drag.vy - dy / S.view.zoom; clampView(); requestRender();
  } else if (drag.type === 'paint') { paintSeg(drag.op, drag.last, p); drag.last = p; requestRender(); }
  else if (drag.type === 'lasso' || drag.type === 'cut') { lassoPts.push([p.x, p.y]); requestRender(); }
  else if (drag.type === 'roi') { roiDrag.x1 = p.x; roiDrag.y1 = p.y; requestRender(); }
  else if (drag.type === 'box' || drag.type === 'exrect') { boxDrag.x1 = p.x; boxDrag.y1 = p.y; requestRender(); }
});

function endDrag() {
  const s = sec(); const d = drag; drag = null; if (!d || !s) return;
  if (d.type === 'edge') { if (!cropState) setRoi(s, { ...s.roi }); return; }
  if (d.type === 'select') {
    const p = d.p, v = inImg(s, p) ? s.labels[Math.floor(p.y) * s.w + Math.floor(p.x)] : 0, ids = idsAt(v, s.stacks);
    // V0.20: clicking again on an overlap selects the trace underneath
    const k = ids.indexOf(S.selected), id = ids.length > 1 && k >= 0 ? ids[(k + ids.length - 1) % ids.length] : topAt(v, s.stacks);
    if (d.add) toggleSelect(id); else select(id);
  } else if (d.type === 'exrect') {
    const r = boxDrag; boxDrag = null;
    const x0 = Math.max(0, Math.floor(Math.min(r.x0, r.x1))), x1 = Math.min(s.w - 1, Math.ceil(Math.max(r.x0, r.x1)));
    const y0 = Math.max(0, Math.floor(Math.min(r.y0, r.y1))), y1 = Math.min(s.h - 1, Math.ceil(Math.max(r.y0, r.y1)));
    if (x1 <= x0 || y1 <= y0) { requestRender(); return; }
    const op = beginOp(s); op.mode = d.mode;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { setEx(op, y * s.w + x, d.mode === 'exclude' ? 1 : 0); }
    grow(op, x0, y0); grow(op, x1, y1);
    finishPixelOp(op, 0);
  } else if (d.type === 'box') {
    const r = boxDrag; boxDrag = null;
    const x0 = Math.min(r.x0, r.x1), x1 = Math.max(r.x0, r.x1), y0 = Math.min(r.y0, r.y1), y1 = Math.max(r.y0, r.y1);
    if (!d.add) S.multi.clear(); else if (S.selected) S.multi.add(S.selected);
    for (const o of s.objects.values()) { if (!o.bbox) continue; const cx = (o.bbox[0] + o.bbox[2]) / 2, cy = (o.bbox[1] + o.bbox[3]) / 2; if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) S.multi.add(o.id); }
    S.selected = [...S.multi][0] || 0; renderObject(); requestRender(); if (S.multi.size) showTab('object', true);
  } else if (d.type === 'paint') finishPixelOp(d.op, d.op.mode === 'brush' ? d.op.target : 0);
  else if (d.type === 'cut') { const pts = lassoPts; lassoPts = null; splitAlong(pts); requestRender(); }
  else if (d.type === 'lasso') {
    const pts = lassoPts; lassoPts = null;
    applyPixels(polygonPixels(pts, s.w, s.roi), d.mode); requestRender();
  } else if (d.type === 'roi') {
    const r = roiDrag; roiDrag = null;
    const x0 = Math.max(0, Math.round(Math.min(r.x0, r.x1))), x1 = Math.min(s.w, Math.round(Math.max(r.x0, r.x1)));
    const y0 = Math.max(0, Math.round(Math.min(r.y0, r.y1))), y1 = Math.min(s.h, Math.round(Math.max(r.y0, r.y1)));
    if (x1 - x0 > 4 && y1 - y0 > 4) setRoi(s, { x0, y0, x1, y1 });
    setTool(S.prevTool);
  }
}
view.addEventListener('pointerup', endDrag);
view.addEventListener('pointercancel', endDrag);
view.addEventListener('pointerleave', () => { cursor = null; requestRender(); });
view.addEventListener('wheel', (e) => {
  if (!sec()) return;
  e.preventDefault();
  const k = e.deltaMode === 1 ? 16 : 1;
  if (e.ctrlKey || e.metaKey) { const p = toImg(e); zoomAt(p.sx, p.sy, Math.exp(-e.deltaY * k * 0.0025)); }
  else { S.view.x += (e.shiftKey ? e.deltaY : e.deltaX) * k / S.view.zoom; if (!e.shiftKey) S.view.y += e.deltaY * k / S.view.zoom; clampView(); requestRender(); }
}, { passive: false });

function updateStatus(s, p) {
  const inside = inImg(s, p);
  $('stDepth').textContent = inside ? t('status.depth', { d: fmt(depthAtRow(s, p.y), 3), u: s.units }) : '';
  $('stPx').textContent = inside ? `x ${Math.floor(p.x)} · y ${Math.floor(p.y)}` : '';
  const id = inside ? topLab(s, Math.floor(p.y) * s.w + Math.floor(p.x)) : 0, o = id && s.objects.get(id);
  $('stObj').textContent = o ? `#${o.id} ${clsById(o.cls || o.pred)?.name || t('obj.unassigned')} · ${t('obj.' + status(o))}` : '';
}

function setRoi(s, roi) {
  s.roi = roi; s.logVer++; markDirty(); if (s.filters.autoLevels) enhance(s); recomputeFeatures(s); scheduleLearn(); scheduleAnalysis(); renderSectionForm(); requestRender();
}

/* ───────────── keyboard ───────────── */

document.addEventListener('keydown', (e) => {
  const target = e.target;
  if (!(target instanceof Element) || target.closest('input, textarea, select, dialog')
    || (target instanceof HTMLElement && target.isContentEditable)) return;
  // shortcuts belong to the Bioturbation image only: not on the start screen, not in other modes, and a focused button keeps Space/Enter
  if (mode !== 'section' || !$('home').hidden || tourStep >= 0 || (target.closest('button, a, summary, [role=tab], label') && (e.key === ' ' || e.key === 'Enter'))) return;
  const k = e.key, s = sec();
  if (!e.altKey && (e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
    return;
  }
  if (!e.altKey && e.ctrlKey && !e.metaKey && !e.shiftKey && k.toLowerCase() === 'y') {
    e.preventDefault(); redo(); return;
  }
  if (!singleKeys && k.length === 1 && k !== ' ' && !e.ctrlKey && !e.metaKey) return;   // V0.39: single-character shortcuts can be turned off (WCAG 2.1.4)
  if (k === ' ') { spaceDown = true; view.classList.add('pan'); e.preventDefault(); return; }
  const tools = { v: 'select', w: 'wand', b: 'brush', l: 'lasso', c: 'cut', e: 'erase', x: 'exclude', h: 'pan', m: 'mark' };
  if (tools[k.toLowerCase()] && !e.ctrlKey && !e.metaKey) { setTool(tools[k.toLowerCase()]); return; }
  if (k.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey) { setOverlap(!S.overlap); toast(t(S.overlap ? 'ov.on' : 'ov.off')); return; }   // V0.29
  if (!s) return;
  if (/^[0-9]$/.test(k)) {
    const c = k === '0' ? clsById('artifact') : S.classes[+k - 1];
    if (!c) return;
    const ids = selectedIds();
    if (ids.length) assignClassMany(ids, c.id); else setActive(c.id);
    return;
  }
  switch (k) {
    case 'Escape': select(0); break;
    case 'Delete': case 'Backspace': { const ids = selectedIds(); if (ids.length) { e.preventDefault(); deleteObjects(ids); } break; }
    case 'Enter': acceptSuggestions(selectedIds()); break;
    case 'n': case 'N': e.preventDefault(); nextReview(e.shiftKey); break;
    case 'o': case 'O': $('showOrig').checked = S.showOrig = !S.showOrig; requestRender(); break;
    case 'f': case 'F': fitView(); break;
    case '+': case '=': zoomAt(view.width / 2, view.height / 2, 1.25); break;
    case '-': zoomAt(view.width / 2, view.height / 2, 0.8); break;
    case '[': setBrush(S.brushSize - Math.max(1, Math.round(S.brushSize * 0.15))); break;
    case ']': setBrush(S.brushSize + Math.max(1, Math.round(S.brushSize * 0.15))); break;
  }
});
document.addEventListener('keyup', (e) => { if (e.key === ' ') { spaceDown = false; view.classList.toggle('pan', S.tool === 'pan'); } });

function nextReview(back = false) {
  const s = sec(); if (!s) return;
  const list = [...s.objects.values()].filter((o) => !o.cls && o.bbox).sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
  if (!list.length) { select(0); return; }
  const cur = s.objects.get(S.selected);
  let o;
  if (!cur?.bbox) o = list[0];
  else {
    const key = (q) => q.bbox[1] * 1e6 + q.bbox[0] + q.id * 1e-6, kc = key(cur);
    o = back ? [...list].reverse().find((q) => key(q) < kc) || list[list.length - 1] : list.find((q) => key(q) > kc) || list[0];
  }
  select(o.id); centerOn(o); showTab('object');
}

/* ───────────── UI: panels ───────────── */

function setTool(tool) {
  if (tool === 'roi') S.prevTool = S.tool === 'roi' ? S.prevTool : S.tool;
  S.tool = tool;
  document.querySelectorAll('.tool').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
  $('optSize').hidden = !['brush', 'erase', 'exclude', 'include'].includes(tool);
  $('optTol').hidden = tool !== 'wand';
  $('optShape').hidden = !['exclude', 'include'].includes(tool);
  $('optOverlap').hidden = !['brush', 'wand', 'lasso'].includes(tool);
  view.classList.toggle('pan', tool === 'pan');
  requestRender();
}
$('exShape').addEventListener('change', (e) => { S.exShape = e.target.value; });
/* V0.29: «Superponer» is on by default and remembered in the browser; key S toggles it */
try { S.overlap = localStorage.getItem('ichantool.overlap') !== '0'; } catch { S.overlap = true; }
$('overlapMode').checked = S.overlap;
function setOverlap(on) { S.overlap = !!on; $('overlapMode').checked = S.overlap; try { localStorage.setItem('ichantool.overlap', S.overlap ? '1' : '0'); } catch { /* storage blocked */ } }
$('overlapMode').addEventListener('change', (e) => setOverlap(e.target.checked));
function setBrush(v) { S.brushSize = Math.max(1, Math.min(120, v)); $('brushSize').value = S.brushSize; $('brushOut').textContent = S.brushSize; requestRender(); }
function setActive(id) { S.active = id; if (S.settings.solo) { setHidden(S.classes.filter((c) => c.id !== id).map((c) => c.id)); } renderClasses(); renderSelTools(sec()); }
function select(id) { S.selected = id || 0; S.multi.clear(); renderObject(); requestRender(); if (id) showTab('object', true); }
function toggleSelect(id) {
  if (!id) return;
  if (S.selected && !S.multi.size) S.multi.add(S.selected);
  if (S.multi.has(id)) S.multi.delete(id); else S.multi.add(id);
  S.selected = S.multi.has(id) ? id : [...S.multi][0] || 0;
  if (S.multi.size === 1) S.multi.clear();
  renderObject(); requestRender(); showTab('object', true);
}
/** Select every object of the section that matches a filter (e.g. all suggested as a class). */
function selectWhere(fn) {
  const s = sec(); if (!s) return;
  S.multi = new Set([...s.objects.values()].filter((o) => o.bbox && fn(o)).map((o) => o.id));
  S.selected = [...S.multi][0] || 0; if (S.multi.size === 1) S.multi.clear();
  renderObject(); requestRender();
}

function showTab(name, soft = false) {
  if (soft && $('sideTabs').querySelector('[aria-selected="true"]')?.dataset.tab === 'results') return;
  setTimeout(() => { if (typeof updateTip === 'function') updateTip(); }, 0);
  $('sideTabs').querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  document.querySelectorAll('.pane').forEach((p) => (p.hidden = p.dataset.pane !== name));
}

function renderClasses() {
  const s = sec(), nObj = {}, nEx = {}, hid = hiddenCls();
  if (s) for (const o of s.objects.values()) { const c = effClassId(o); if (c) nObj[c] = (nObj[c] || 0) + 1; }
  for (const x of S.sections) for (const o of x.objects.values()) if (o.cls) nEx[o.cls] = (nEx[o.cls] || 0) + 1;
  $('classList').innerHTML = S.classes.map((c) => `
    <li data-id="${esc(c.id)}" class="${c.id === S.active ? 'active' : ''} ${c.plain ? 'plain' : ''} ${hid.has(c.id) ? 'hid' : ''}">
      <button class="eye ${hid.has(c.id) ? 'off' : ''}" title="${esc(t(hid.has(c.id) ? 'cls.show' : 'cls.hide'))}" aria-label="${esc(t(hid.has(c.id) ? 'cls.show' : 'cls.hide'))}">👁</button>
      <kbd>${esc(keyOf(c))}</kbd>
      <input type="color" value="${esc(validHexColor(c.color, '#777777'))}" aria-label="${esc(t('a11y.color'))}">
      <input class="name" type="text" value="${esc(c.name)}" aria-label="${esc(t('a11y.name'))}">
      <span class="cnt">${idMode() ? t('id.count', { n: S.sections.reduce((a, x) => a + (x.marks || []).filter((m) => m.cls === c.id).length, 0) }) : t('cls.counts', { n: nObj[c.id] || 0, e: nEx[c.id] || 0 })}</span>
      ${c.fixed ? `<span title="${esc(t('gx.fixedCls'))}"></span>` : `<button class="del" title="${esc(t('gx.delCls'))}" aria-label="${esc(t('gx.delCls'))}">✕</button>`}
    </li>`).join('');
}
/** Two-step confirmation for actions that cannot be undone: the first click arms the button (text and colour change) for 4 s. */
export function armed(btn, msg) {
  if (!btn) return true;
  if (btn.dataset.armed === '1') { btn.dataset.armed = ''; clearTimeout(btn._armT); btn.textContent = btn._armTxt; btn.classList.remove('danger'); return true; }
  btn._armTxt = btn.textContent; btn.dataset.armed = '1'; btn.textContent = msg || t('confirm.click'); btn.classList.add('danger');
  btn._armT = setTimeout(() => { btn.dataset.armed = ''; btn.textContent = btn._armTxt; btn.classList.remove('danger'); }, 4000);
  return false;
}
export const esc = (s) => {
  try { return String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]); }
  catch { return ''; }
};

function setHidden(ids) {
  S.settings.hidden = [...ids]; for (const x of S.sections) rebuildLUT(x);
  markDirty(); renderClasses(); requestRender();
}
$('clsSolo').addEventListener('click', () => { S.settings.solo = true; setHidden(S.classes.filter((c) => c.id !== S.active).map((c) => c.id)); });   // follows the active ichnotaxon until «Show all»
$('clsShowAll').addEventListener('click', () => { S.settings.solo = false; setHidden([]); });
$('classList').addEventListener('click', (e) => {
  const li = e.target.closest('li'); if (!li) return;
  if (e.target.classList.contains('eye')) { S.settings.solo = false; const h = hiddenCls(), id = li.dataset.id; if (h.has(id)) h.delete(id); else h.add(id); setHidden(h); return; }
  if (e.target.classList.contains('del')) {
    const id = li.dataset.id;
    discardEditHistory();
    for (const s of S.sections) for (const o of s.objects.values()) { if (o.cls === id) o.cls = null; if (o.pred === id) o.pred = null; }
    S.classes = S.classes.filter((c) => c.id !== id);
    if (S.active === id) S.active = 'undet';
    for (const s of S.sections) rebuildLUT(s);
    scheduleLearn(); renderClasses(); requestRender(); return;
  }
  if (e.target.tagName !== 'INPUT') setActive(li.dataset.id);
});
$('classList').addEventListener('input', (e) => {
  const li = e.target.closest('li'), c = clsById(li?.dataset.id); if (!c) return;
  if (e.target.type === 'color') { c.color = e.target.value; for (const s of S.sections) rebuildLUT(s); requestRender(); }
  else c.name = e.target.value;
});
$('classList').addEventListener('change', () => { renderObject(); renderLearn(); renderResults(); });
$('addClass').addEventListener('click', () => {
  const palette = ['#5ec2b7', '#c77dff', '#ffb703', '#e76f51', '#90be6d', '#4ea8de', '#f4978e', '#9a8c98'];
  const c = { id: 'c' + uid(), name: t('cls.new'), color: palette[S.classes.length % palette.length], counts: true };
  S.classes.splice(S.classes.length - 1, 0, c); setActive(c.id);
  const inp = document.querySelector(`#classList li[data-id="${c.id}"] input.name`); inp?.focus(); inp?.select();
});

/** Accept the automatic suggestion of each object that has one (one undo step). */
function acceptSuggestions(ids) {
  const s = sec(); if (!s) return;
  const objs = ids.map((id) => s.objects.get(id)).filter((o) => o?.pred && !o.cls); if (!objs.length) return;
  const op = beginOp(s);
  for (const o of objs) { rememberTrace(op, o.id); o.cls = o.pred; o.pred = null; o.conf = 0; }
  commitOp(op); afterChange(s);
}

function renderSelTools(s) {
  const el = $('selTools'); if (!el) return;
  const c = clsById(S.active);
  el.innerHTML = s ? `<button class="btn small" id="selPred">${t('obj.selPred', { c: esc(c?.name || '') })}</button><button class="btn small" id="selCand">${t('obj.selCand')}</button>` : '';
  if (!s) return;
  $('selPred').onclick = () => selectWhere((o) => !o.cls && o.pred === S.active);
  $('selCand').onclick = () => selectWhere((o) => !o.cls);
}

function renderMulti(s, box) {
  const objs = [...S.multi].map((id) => s.objects.get(id)).filter(Boolean);
  const n = (f) => objs.filter(f).length;
  const opts = S.classes.map((c) => `<option value="${esc(c.id)}" ${c.id === S.active ? 'selected' : ''}>${keyOf(c) ? esc(keyOf(c)) + ' · ' : ''}${esc(c.name)}</option>`).join('');
  box.innerHTML = `<p><b>${t('obj.multiN', { n: objs.length })}</b></p>
    <p class="note">${t('obj.multiDetail', { m: n((o) => o.cls), p: n((o) => !o.cls && o.pred), c: n((o) => !o.cls && !o.pred) })}</p>
    <select id="multiCls" style="width:100%">${opts}</select><div class="row"><button class="btn small primary" id="multiAssign">${t('obj.multiAssign')}</button>
    ${n((o) => !o.cls && o.pred) ? `<button class="btn small" id="multiAccept">${t('obj.multiAccept')}</button>` : ''}<button class="btn small" id="multiClear">${t('obj.multiClear')}</button><button class="btn small" id="multiMerge" data-tip="${esc(t('obj.mergeTip'))}">${t('obj.merge')}</button><button class="btn small" id="multiDel">${t('obj.multiDel')}</button></div>
    <p class="note">${t('obj.multiHint')}</p>`;
  $('multiAssign').onclick = () => assignClassMany(objs.map((o) => o.id), $('multiCls').value);
  if ($('multiAccept')) $('multiAccept').onclick = () => acceptSuggestions(objs.map((o) => o.id));
  $('multiClear').onclick = () => select(0);
  $('multiDel').onclick = () => deleteObjects(objs.map((o) => o.id));
  $('multiMerge').onclick = () => mergeObjects(objs.map((o) => o.id));
}

/** The list follows the current selection; without one it can show all traces in the section. */
let objListHasSelection = false;
function renderObjectList(s) {
  const list = $('objList'), ids = selectedIds(), selected = ids.length > 0;
  if (selected !== objListHasSelection) { list.open = selected; objListHasSelection = selected; }
  list.hidden = !s;
  if (!s) return;
  const objs = (selected ? ids.map((id) => s.objects.get(id)) : [...s.objects.values()])
    .filter((o) => o?.bbox).sort((a, b) => a.bbox[1] - b.bbox[1] || a.id - b.id);
  list.querySelector('summary').textContent = t(selected ? 'obj.listSelected' : 'obj.listAll', { n: objs.length });
  const items = list.querySelector('.obj-list-items');
  if (!list.open) { items.innerHTML = ''; return; }
  items.innerHTML = objs.map((o) => {
    const name = clsById(o.cls || o.pred)?.name || t('obj.unassigned');
    const depth = `${fmt(depthAtRow(s, o.bbox[1]), 3)}–${fmt(depthAtRow(s, o.bbox[3] + 1), 3)} ${s.units}`;
    return `<button class="btn small" data-obj-id="${o.id}" title="${esc(t(selected ? 'obj.listFocus' : 'obj.listSelect'))}">#${o.id} · ${esc(name)} · ${esc(depth)}</button>`;
  }).join('') || `<p class="note">${t('obj.listEmpty')}</p>`;
}
$('objList').addEventListener('toggle', () => renderObjectList(sec()));
$('objList').addEventListener('click', (e) => {
  const button = e.target.closest('[data-obj-id]'), s = sec();
  const o = button && s?.objects.get(Number(button.dataset.objId));
  if (!o?.bbox) return;
  if (!selectedIds().length) select(o.id);
  centerOn(o);
});

function renderObject() {
  const s = sec(), o = s?.objects.get(S.selected), box = $('objInfo');
  renderSelTools(s);
  renderObjectList(s);
  if (s && S.multi.size > 1) { renderMulti(s, box); return; }
  if (!o) { box.innerHTML = `<p class="note">${t('obj.none')}</p>`; return; }
  const st = status(o), ppu = pxPerCm(s), f = o.feat || {}, [, y0, , y1] = o.bbox;
  const opts = [`<option value="">${t('obj.unassigned')}</option>`].concat(S.classes.map((c) => `<option value="${esc(c.id)}" ${c.id === o.cls ? 'selected' : ''}>${keyOf(c) ? esc(keyOf(c)) + ' · ' : ''}${esc(c.name)}</option>`)).join('');
  const sugg = o.pred ? `<span class="swatch" style="background:${validHexColor(clsById(o.pred)?.color, '#777777')}"></span>${esc(clsById(o.pred)?.name || '')} · ${Math.round(o.conf * 100)}%` : 'novel' in o && o.novel ? t('obj.novel') : '—';
  const u = s.units, toU = (cm) => cm / UNIT_TO_CM[u];
  box.innerHTML = `
    <dl class="kv">
      <dt>${t('obj.class')}</dt><dd><select id="objCls">${opts}</select></dd>
      <dt>${t('obj.status')}</dt><dd><span class="pill ${st}">${t('obj.' + st)}</span></dd>
      ${o.cls ? '' : `<dt>${t('obj.suggest')}</dt><dd>${sugg}</dd>`}
      ${o.cls || !xOf(o) ? '' : `<dt>${t('obj.probs')}</dt><dd>${probTable(o)}</dd>`}
      <dt>${t('obj.depth')}</dt><dd>${fmt(depthAtRow(s, y0), 3)}–${fmt(depthAtRow(s, y1 + 1), 3)} ${u}</dd>
      <dt>${t('obj.size')}</dt><dd>${fmt(toU(f.majorCm), 3)} × ${fmt(toU(f.minorCm), 3)} ${u}</dd>
      <dt>${t('obj.area')}</dt><dd>${fmt(o.area / (ppu * ppu) / UNIT_TO_CM[u] ** 2, 4)} ${u}² · ${o.area} px</dd>
      <dt>${t('obj.shape')}</dt><dd>${t('obj.elong')} ${fmt(f.elong, 1)} · ${t('obj.vert')} ${fmt(f.vert, 2)}</dd>
    </dl>
    <div class="row">${o.pred && !o.cls ? `<button class="btn small primary" id="objAccept">${t('obj.accept')}</button>` : ''}<button class="btn small" id="objDel">${t('obj.delete')}</button></div>
    <p class="note">${t('obj.multiHint')}</p>`;
  const classSelect = /** @type {HTMLSelectElement} */ ($('objCls'));
  classSelect.onchange = () => {
    if (classSelect.value) { assignClass(o.id, classSelect.value); return; }
    const op = beginOp(s);
    if (o.cls !== null) rememberTrace(op, o.id);
    o.cls = null; commitOp(op); afterChange(s);
  };
  $('objDel').onclick = () => deleteObject(o.id);
  if ($('objAccept')) $('objAccept').onclick = () => assignClass(o.id, o.pred);
}

/** Probability of each ichnotaxon for one object according to the three models (top 4 classes). */
function probTable(o) {
  const x = xOf(o); if (!x) return '—';
  const P = Object.fromEntries(CLF_SCOPES.map((k) => [k, clfs[k].predict(x)]));
  const tot = {}; for (const k of CLF_SCOPES) for (const [n, v] of Object.entries(P[k]?.probs || {})) tot[n] = (tot[n] || 0) + v;
  const names = Object.keys(tot).sort((a, b) => tot[b] - tot[a]).slice(0, 4);
  if (!names.length) return '—';
  const sc = S.settings.clfScope || 'project', col = (n) => validHexColor(S.classes.find((c) => c.name === n)?.color, '#999999');
  return `<table class="dtable mtab"><thead><tr><th></th>${CLF_SCOPES.map((k) => `<th${k === sc ? ' class="on"' : ''}>${t('l.scope.' + k)}</th>`).join('')}</tr></thead><tbody>${
    names.map((n) => `<tr><td class="txt"><span class="swatch" style="background:${col(n)}"></span>${esc(n)}</td>${CLF_SCOPES.map((k) => `<td${k === sc ? ' class="on"' : ''}>${P[k] ? Math.round((P[k].probs[n] || 0) * 100) + '%' : '—'}</td>`).join('')}</tr>`).join('')}${
    CLF_SCOPES.some((k) => P[k]?.novel) ? `<tr><td class="txt" colspan="4">${t('obj.novelBy', { m: CLF_SCOPES.filter((k) => P[k]?.novel).map((k) => t('l.scope.' + k)).join(', ') })}</td></tr>` : ''}</tbody></table>`;
}

function renderLearn() {
  const counts = clf.counts || {}, total = clf.n || 0, s = sec();
  const sc = S.settings.clfScope || 'project';
  $('clfScopeBox').innerHTML = `<p class="note" style="margin:0">${t('ml.p.method')}: <b>${t('ml.m.' + (S.settings.ml?.method || 'knn'))}</b></p><label class="f"><span>${t('l.scope')}</span><select id="clfScope">${CLF_SCOPES.map((k) => `<option value="${k}" ${k === sc ? 'selected' : ''}>${t('l.scope.' + k)}</option>`).join('')}</select></label>
    <table class="dtable mtab"><thead><tr><th></th>${CLF_SCOPES.map((k) => `<th>${t('l.scope.' + k)}</th>`).join('')}</tr></thead><tbody>
    <tr><td class="txt">${t('l.examples')}</td>${CLF_SCOPES.map((k) => `<td>${clfs[k].n || 0}</td>`).join('')}</tr>
    <tr><td class="txt">${t('l.accuracy')}</td>${CLF_SCOPES.map((k) => `<td>${clfs[k].accuracy == null ? '—' : Math.round(clfs[k].accuracy * 100) + '%'}</td>`).join('')}</tr></tbody></table>`;
  $('clfScope').onchange = (e) => { S.settings.clfScope = e.target.value; markDirty(); learnNow(); };
  const pending = s ? [...s.objects.values()].filter((o) => status(o) === 'predicted').length : 0;
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([id, n]) => {
    const c = clsById(id); return c ? `<div><span><span class="swatch" style="background:${validHexColor(c.color, '#777777')}"></span>${esc(c.name)}</span><em>${n}</em></div>` : '';
  }).join('');
  $('learnStats').innerHTML = total ? `
    <div class="stat"><div><b>${total}</b><span>${t('l.examples')}</span></div>
      <div><b>${clf.accuracy == null ? '—' : Math.round(clf.accuracy * 100) + '%'}</b><span>${clf.accuracy == null ? t('l.accNA') : t('l.accuracy')}</span></div>
      <div><b>${pending}</b><span>${t('l.pending', { n: '' }).trim()}</span></div></div>
    <div class="bars">${rows}</div>
    ${S.library.length ? `<p class="note">${t('l.library')}: ${S.library.length}</p>` : ''}` : `<p class="note">${t('l.none')}</p>`;
  $('acceptPred').disabled = !pending;
}

function renderResults() {
  const s = sec(), sum = $('resSummary'), tab = $('resTable');
  if (s?.analysis?.state === 'pending') { sum.innerHTML = `<p class="note">${t('engine.pending')}</p>`; tab.innerHTML = ''; return; }
  if (s?.analysis?.state === 'error') { sum.innerHTML = `<p class="note" role="alert">${esc(t(`engine.error.${s.analysis.code}`) === `engine.error.${s.analysis.code}` ? t('engine.error.INTERNAL') : t(`engine.error.${s.analysis.code}`))}${s.analysis.field ? ` (${esc(s.analysis.field)})` : ''}</p>`; tab.innerHTML = ''; return; }
  if (!s || !s.bins?.length) { sum.innerHTML = `<p class="note">${t('r.empty')}</p>`; tab.innerHTML = ''; return; }
  let v = 0, b = 0; const cls = new Array(S.classes.length).fill(0);
  for (const x of s.bins) { if (!x.valid) continue; v += x.valid; b += (x.pct / 100) * x.valid; x.classPct.forEach((p, k) => (cls[k] += ((p || 0) / 100) * x.valid)); }
  const eff = effClassArray(s); let nObj = 0; for (const o of s.objects.values()) if (eff[o.id] >= 0) nObj++;
  const ppu = pxPerCm(s), area = v / (ppu * ppu) / UNIT_TO_CM[s.units] ** 2;
  const bars = S.classes.map((c, k) => ({ c, p: v ? (cls[k] / v) * 100 : 0 })).filter((x) => x.p > 0).sort((a, c) => c.p - a.p)
    .map(({ c, p }) => `<div><span>${esc(c.name)}<i style="width:${Math.max(2, p)}%;background:${validHexColor(c.color, '#777777')}"></i></span><em>${fmt(p, 2)}%</em></div>`).join('');
  sum.innerHTML = `
    <div class="stat"><div><b>${fmt(v ? (b / v) * 100 : null, 1)}%</b><span>${t('r.mean')}</span></div>
      <div><b>${fmt(area, area < 10 ? 2 : 0)}</b><span>${t('r.area')} (${s.units}²)</span></div>
      <div><b>${nObj}</b><span>${t('r.objects')}</span></div></div>
    ${bars ? `<div class="lbl">${t('r.byClass')}</div><div class="bars">${bars}</div>` : ''}`;
  const MAX = 600, hasAge = !!S.age.model;
  const opt = (lo, val) => `<option value=""></option>` + Array.from({ length: 7 - lo }, (_, k) => k + lo).map((n) => `<option ${val === n ? 'selected' : ''}>${n}</option>`).join('');
  const rows = s.bins.slice(0, MAX).map((x) => `<tr data-i="${x.index}"><td>${fmt(x.depth, 3)}</td>${hasAge ? `<td>${fmt(x.age, 3)}</td>` : ''}<td>${fmt(x.pct, 2)}</td>
    <td>${x.BI ?? '—'}</td><td><select data-k="BI" aria-label="BI ${t('r.manual')}">${opt(0, x.BIm)}</select></td>
    <td>${x.ii ?? '—'}</td><td><select data-k="ii" aria-label="ii ${t('r.manual')}">${opt(1, x.iim)}</select></td></tr>`).join('');
  tab.innerHTML = `<div class="tablewrap"><table><thead><tr><th>${t('r.depth')} (${s.units})</th>${hasAge ? `<th>${t('r.age')} (${esc(S.age.units)})</th>` : ''}<th>%</th><th>BI</th><th>BI ${t('r.manual')}</th><th>ii</th><th>ii ${t('r.manual')}</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${s.bins.length > MAX ? `<p class="note">${t('r.tooMany', { n: MAX })}</p>` : ''}`;
}
$('resTable').addEventListener('change', (e) => {
  const sel = e.target.closest('select'), tr = e.target.closest('tr'), s = sec(); if (!sel || !tr || !s) return;
  const b = s.bins[+tr.dataset.i]; setManual(s, b, sel.dataset.k, sel.value === '' ? null : +sel.value);
  analyze(s); requestRender();
});

/* section form */
function renderSectionForm() {
  const s = sec();
  $('secRegionWarning').hidden = !s?.loadWarnings?.region;
  $('secMaskWarning').hidden = !s?.loadWarnings?.mask;
  $('secDepthWarning').hidden = !s || (Number.isFinite(s.top) && Number.isFinite(s.bottom)
    && s.bottom > s.top && Object.hasOwn(UNIT_TO_CM, s.units));
  $('secSel').innerHTML = S.sections.map((x, k) => `<option value="${k}" ${k === S.cur ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  for (const id of ['secName', 'secTop', 'secBottom', 'secUnits', 'secDel', 'roiBtn', 'roiReset', 'rotL', 'rotR', 'detectBtn', 'clearCand', 'secRes', 'resAll']) $(id).disabled = !s;
  if (!s) return;
  $('secName').value = s.name; $('secTop').value = s.top; $('secBottom').value = s.bottom; $('secUnits').value = s.units;
  const ppu = pxPerCm(s);
  $('roiInfo').textContent = `x ${s.roi.x0}–${s.roi.x1} · y ${s.roi.y0}–${s.roi.y1} px · ${fmt(ppu * UNIT_TO_CM[s.units], 2)} px/${s.units}`;
  renderFilterForm(); renderDetectForm(); renderBinNote(); renderResForm(s);
}

/* ── V0.1: working resolution of a section, recomputed from the full-resolution original ── */
const RES_FACTORS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32];
function renderResForm(s) {
  const sel = $('secRes'); sel.disabled = $('resAll').disabled = !s; if (!s) return;
  const span = s.crop ? { w: s.crop.x1 - s.crop.x0, h: s.crop.y1 - s.crop.y0 } : s.full;
  const ppcFull = pxPerCm(s) * s.ds;   // px/cm of the original file
  if (!span) { sel.innerHTML = `<option>${t('sec.resUnknown', { k: s.ds })}</option>`; $('resNote').textContent = ''; return; }
  const ks = RES_FACTORS.filter((k) => k === s.ds || Math.min(span.w, span.h) / k >= 20);
  sel.innerHTML = ks.map((k) => {
    const W = Math.floor(span.w / k), H = Math.floor(span.h / k);
    return `<option value="${k}" ${k === s.ds ? 'selected' : ''}>${k === 1 ? t('sec.resFull') : '1/' + k} · ${fmt(ppcFull / k, 3)} px/cm · ${fmt((W * H) / 1e6, 2)} MP</option>`;
  }).join('');
  $('resNote').textContent = t('sec.resNote', { mb: Math.round((13 * s.w * s.h) / 2 ** 20) });
}
/** Recompute the working image of s at factor k2 from the original; masks, marks and analysis area follow (nearest pixel). */
async function changeResolution(s, k2) {
  if (!s || k2 === s.ds) return;
  await withPixels(s, async () => {
    const k1 = s.ds, turns = ((s.rot % 4) + 4) % 4, r = await decodeWorking(s, k2), q = k1 / k2;
    const U2 = turns % 2 ? { w: r.h, h: r.w } : { w: r.w, h: r.h };
    const remap = (arr, Type) => {
      let a = arr, w = s.w, h = s.h;
      for (let i = 0; i < turns; i++) { a = rotate90(a, w, h, 1, -1); [w, h] = [h, w]; }
      const out = new Type(U2.w * U2.h), xs = Int32Array.from({ length: U2.w }, (_, x) => Math.min(w - 1, Math.floor((x + 0.5) / q)));
      for (let y = 0; y < U2.h; y++) { const sy = Math.min(h - 1, Math.floor((y + 0.5) / q)) * w, o = y * U2.w; for (let x = 0; x < U2.w; x++) out[o + x] = a[sy + xs[x]]; }
      let b = out; w = U2.w; h = U2.h;
      for (let i = 0; i < turns; i++) { b = rotate90(b, w, h, 1, 1); [w, h] = [h, w]; }
      return b;
    };
    const pt = (x, y) => {   // continuous coordinates, old working frame → new working frame
      let w = s.w, h = s.h;
      for (let i = 0; i < turns; i++) { [x, y] = [y, w - x]; [w, h] = [h, w]; }
      x *= q; y *= q; w = U2.w; h = U2.h;
      for (let i = 0; i < turns; i++) { [x, y] = [h - y, x]; [w, h] = [h, w]; }
      return [x, y];
    };
    const clampR = (v, m) => Math.max(0, Math.min(m, Math.round(v)));
    const labels = remap(s.labels, Int32Array), exclude = remap(s.exclude, Uint8Array);
    const [ax, ay] = pt(s.roi.x0, s.roi.y0), [bx, by] = pt(s.roi.x1, s.roi.y1);
    const full = s.roi.x0 === 0 && s.roi.y0 === 0 && s.roi.x1 === s.w && s.roi.y1 === s.h;
    const roi = full ? { x0: 0, y0: 0, x1: r.w, y1: r.h } : { x0: clampR(Math.min(ax, bx), r.w), y0: clampR(Math.min(ay, by), r.h), x1: clampR(Math.max(ax, bx), r.w), y1: clampR(Math.max(ay, by), r.h) };
    s.marks = (s.marks || []).map((m) => { const [x, y] = pt(m.x + 0.5, m.y + 0.5); return { ...m, x: Math.min(r.w - 1, Math.floor(x)), y: Math.min(r.h - 1, Math.floor(y)) }; });
    s.w = r.w; s.h = r.h; s.orig = r.rgba; s.orig16 = r.rgba16 || null; s.labels = labels; s.exclude = exclude; s.roi = roi; s.ds = k2;
    compactSectionStacks(s, true);
    s.view = null; s._lc = null; s._lb = null; s._fc = null; s.logVer++;
    enhance(s); refreshObjects(s, new Set(s.objects.keys()), null);
    discardEditHistory(s);
  });
  pxTouch(s);
  if (s === sec()) selectSection(S.cur, true);
  afterChange(s); renderSectionForm();
}
$('secRes').addEventListener('change', (e) => { const s = sec(), k = +e.target.value; if (s && k) busy(() => changeResolution(s, k)); });
$('resAll').addEventListener('click', () => {
  const s = sec(); if (!s) return; const target = pxPerCm(s);
  busy(async () => {
    for (const o of S.sections) if (o !== s) await changeResolution(o, Math.max(1, Math.round((pxPerCm(o) * o.ds) / target)));
    toast(t('sec.resAllDone', { p: fmt(target, 3) }));
  });
});

function selectSection(k, fresh = false) {
  if (cropState) endCrop();
  const prev = sec(); if (prev) prev.view = { ...S.view };
  S.cur = k; S.selected = 0;
  const s = sec();
  if (s && !s.orig) ensurePixels(s).then(() => { if (sec() === s) { renderSectionForm(); requestRender(); } }).catch(() => requestRender());   // V0.1
  else if (s) pxTouch(s);
  renderSectionForm();
  if (s) { rebuildLUT(s); if (s.view && !fresh) { S.view = { ...s.view }; requestRender(); } else requestAnimationFrame(fitView); }
  analyze(s); renderResults(); renderClasses(); renderObject(); renderLearn(); requestRender();
}

const FILTER_SLIDERS = [['blackPoint', 0, 254, 1], ['whitePoint', 1, 255, 1], ['gamma', 0.2, 3, 0.01], ['brightness', -100, 100, 1], ['contrast', -100, 100, 1], ['saturation', 0, 300, 1], ['vibrance', -100, 100, 1], ['claheBlock', 0, 400, 1], ['claheSlope', 1, 10, 0.1], ['localAmount', 0, 100, 1], ['localRadius', 2, 150, 1]];
const BUILTIN_PRESETS = ['none', 'dorador2014', 'clahe2019', 'levels', 'local', 'strong'];
const DETECT_SLIDERS = [['offset', 1, 80, 1, 'adaptive'], ['radius', 3, 200, 1, 'adaptive'], ['threshold', 0, 255, 1, 'global'], ['pThr', 0.05, 0.95, 0.05, 'unet'], ['minArea', 1, 2000, 1], ['smooth', 0, 4, 1]];
let userPresets = [];
const slider = (prefix, [k, min, max, step]) => `<div class="slider" data-only="${''}"><span data-i18n="${prefix}.${k}" id="${prefix}l-${k}">${t(prefix + '.' + k)}</span><output id="${prefix}o-${k}" for="${prefix}-${k}"></output><input type="range" id="${prefix}-${k}" data-k="${k}" min="${min}" max="${max}" step="${step}" aria-labelledby="${prefix}l-${k}"></div>`;   // V0.39: accessible name

function buildForms() {
  $('filterCtl').innerHTML = FILTER_SLIDERS.map((d) => slider('f', d)).join('');
  $('detectCtl').innerHTML = DETECT_SLIDERS.map((d) => slider('d', d).replace('data-only=""', `data-only="${d[4] || ''}"`)).join('');
  renderPresetOptions();
  $('fChannel').innerHTML = ['rgb', 'gray', 'r', 'g', 'b'].map((c) => `<option value="${c}">${t('ch.' + c)}</option>`).join('');
}

function renderFilterForm() {
  const s = sec(); if (!s) return; const f = s.filters;
  const ef = effectiveFilters(s);
  for (const [k] of FILTER_SLIDERS) { $('f-' + k).value = ef[k] ?? DEFAULT_FILTERS[k]; $('fo-' + k).textContent = ef[k] ?? DEFAULT_FILTERS[k]; }
  for (const k of ['blackPoint', 'whitePoint']) $('f-' + k).disabled = !!f.autoLevels;
  $('f-gamma').disabled = !!f.autoGamma;
  $('fAuto').checked = !!f.autoLevels; $('fAutoG').checked = !!f.autoGamma;
  renderPresetOptions(); $('fPreset').value = s.preset || 'custom';
  $('presetDel').disabled = !String(s.preset || '').startsWith('u:');
  $('presetNote').textContent = BUILTIN_PRESETS.includes(s.preset) ? t('f.src.' + s.preset) : ''; $('fChannel').value = f.channel; $('fEqualize').checked = f.equalize; $('fInvert').checked = f.invert;
}
function renderDetectForm() {
  const s = sec(); if (!s) return; const p = s.detect;
  for (const [k] of DETECT_SLIDERS) { const v = p[k] ?? DEFAULT_DETECT[k]; $('d-' + k).value = v; $('do-' + k).textContent = v; }
  $('dMethod').value = p.method; $('dPol').value = p.polarity; $('dFill').checked = !!p.fillHoles;
  const u = p.method === 'unet'; $('unetBox').hidden = !u; $('dPolBox').hidden = u;   // V0.15
  $('unetName').textContent = unetController.model ? t('u.model', { n: unetController.model.name, c: (unetController.model.cfg.classes || []).join(', '), p: unetController.model.cfg.pxPerCm ? fmt(unetController.model.cfg.pxPerCm, 3) : '—' }) : t('u.noModel');
  document.querySelectorAll('#detectCtl [data-only]').forEach((el) => (el.hidden = !!el.dataset.only && el.dataset.only !== p.method));
}
function renderBinNote() {
  const s = sec(), cm = S.settings.binCm || 1; $('binCm').value = +cm.toPrecision(6);
  $('binNote').textContent = s ? t('a.binNote', { n: fmt(cm * pxPerCm(s), 3), p: fmt(pxPerCm(s), 3), m: Math.ceil((s.roi.y1 - s.roi.y0) / binRowsOf(s)) }) + (cm * pxPerCm(s) < 1 ? ' ' + t('a.binMin') : '') : '';
}

let filterTimer = 0;
function refilter() {
  const s = sec(); if (!s) return;
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => enhanceAsync(s).then((last) => { if (!last) return; s.logVer++; markDirty(); scheduleLog(); requestRender(); }).catch((e) => toast(t('err.generic', { e: e.message || e }))), 90);   // V0.41: in the worker
}
$('filterCtl').addEventListener('input', (e) => {
  const s = sec(), k = e.target.dataset.k; if (!s || !k) return;
  s.filters[k] = +e.target.value; $('fo-' + k).textContent = e.target.value; s.preset = 'custom'; $('fPreset').value = 'custom'; refilter();
});
$('fPreset').addEventListener('change', (e) => {
  const s = sec(), v = e.target.value; if (!s || v === 'custom') return;
  s.preset = v;
  if (v.startsWith('u:')) {
    const u = userPresets.find((x) => 'u:' + x.id === v); if (!u) return;
    s.filters = { ...DEFAULT_FILTERS, ...u.filters }; if (u.detect) s.detect = { ...DEFAULT_DETECT, ...u.detect };
  } else s.filters = { ...FILTER_PRESETS[v] };
  renderFilterForm(); renderDetectForm(); refilter();
});
/**
 * Choose the setting (built-in or user) that best separates two grey-level groups in the analysis area
 * (Otsu separability η on a reduced copy of the image). Own procedure; see docs/TECHNICAL_DOCUMENTATION.md §7.3.
 */
/**
 * V0.28: ranks enhancement settings (presets and their single-channel variants). With traces identified by hand in
 * this section it measures how well each one separates those traces from the matrix as the detection sees them
 * (`traceSeparation`); without them, the local grey-level separability (`localSeparability`).
 */
function rankPresets(s) {
  const k = Math.max(1, Math.round(Math.sqrt((s.w * s.h) / 4e5)));
  const sm = downsampleRGBA(s.orig16 || s.orig, s.w, s.h, k);
  const roi = { x0: Math.floor(s.roi.x0 / k), y0: Math.floor(s.roi.y0 / k), x1: Math.max(1, Math.floor(s.roi.x1 / k)), y1: Math.max(1, Math.floor(s.roi.y1 / k)) };
  const base = [...BUILTIN_PRESETS.map((v) => ({ id: v, name: t('f.p.' + v), filters: { ...FILTER_PRESETS[v] } })),
    ...userPresets.map((u) => ({ id: 'u:' + u.id, name: u.name, filters: { ...DEFAULT_FILTERS, ...u.filters }, detect: u.detect }))];
  const cands = [];
  for (const c of base) {
    cands.push(c);
    if (!c.id.startsWith('u:') && c.id !== 'none' && ['rgb', 'gray'].includes(c.filters.channel || 'rgb'))
      for (const ch of ['r', 'g', 'b']) cands.push({ ...c, id: 'custom', name: `${c.name} · ${t('ch.' + ch)}`, filters: { ...c.filters, channel: ch } });
  }
  // pixels of the downsampled image: 1 = trace identified by hand (a class that counts), 2 = matrix (no trace, or artefact), 0 = unused
  const cls = new Uint8Array(sm.w * sm.h), countable = new Set(S.classes.filter((c) => c.counts).map((c) => c.id));
  const own = new Set([...s.objects.values()].filter((o) => o.cls && countable.has(o.cls)).map((o) => o.id));
  // V0.37: each downsampled pixel takes the majority of its k×k block (mixed or mostly excluded blocks are not used)
  let nT = 0;
  if (own.size) for (let y = roi.y0; y < roi.y1; y++) for (let x = roi.x0; x < roi.x1; x++) {
    let nt = 0, nm = 0, nb = 0;
    for (let yy = y * k; yy < Math.min(s.h, (y + 1) * k); yy++) for (let xx = x * k; xx < Math.min(s.w, (x + 1) * k); xx++) {
      const i = yy * s.w + xx; nb++; if (s.exclude[i]) continue;
      const v = s.labels[i], id = v ? topAt(v, s.stacks) : 0, o = id && s.objects.get(id);
      if (!id || (o && o.cls && !countable.has(o.cls))) nm++; else if (own.has(id)) nt++;
    }
    if (nt * 2 > nb) { cls[y * sm.w + x] = 1; nT++; } else if (nm * 2 > nb) cls[y * sm.w + x] = 2;
  }
  const supervised = nT >= 50, dp = s.detect || DEFAULT_DETECT;
  const opt = { local: dp.method === 'adaptive', radius: (dp.radius || 40) / k, polarity: dp.polarity || 'dark' };   // V0.37: k-means and U-Net are not local
  const out = cands.map((c) => {
    const tmp = { filters: c.filters, orig: sm.rgba, w: sm.w, h: sm.h, roi };
    const enh = applyFilters(sm.rgba, sm.w, sm.h, effectiveFilters(tmp));
    return { ...c, eta: supervised ? traceSeparation(enh, sm.w, sm.h, roi, cls, opt).score : localSeparability(enh, sm.w, sm.h, roi, Math.max(16, Math.round(96 / k))) };
  }).sort((a, b) => b.eta - a.eta);
  // V0.37: without traces, a preset must beat the image without enhancement clearly, or no enhancement is proposed
  const ref = out.find((c) => c.id === 'none');
  if (!supervised && ref && out[0] !== ref && out[0].eta - ref.eta < Math.max(0.005, 0.05 * ref.eta)) { out.splice(out.indexOf(ref), 1); out.unshift(ref); out.noGain = true; }
  out.mode = supervised ? 'traces' : 'local'; out.nTraces = own.size; out.ref = ref?.eta ?? null;
  return out;
}
$('presetBest').addEventListener('click', () => busy(() => {
  const s = sec(); if (!s?.orig) return;
  const r = rankPresets(s), best = r[0];
  s.preset = best.id; s.filters = { ...best.filters }; if (best.detect) s.detect = { ...DEFAULT_DETECT, ...best.detect };
  renderFilterForm(); renderDetectForm(); refilter();
  $('presetRank').textContent = t(r.mode === 'traces' ? 'f.rankT' : 'f.rankL', { n: r.nTraces, list: r.slice(0, 4).map((c) => `${c.name} ${c.eta.toFixed(3)}`).join('; ') }) + (r.noGain ? ' ' + t('f.rankNoGain') : '');
}));
$('fAuto').addEventListener('change', (e) => { const s = sec(); if (!s) return; s.filters.autoLevels = e.target.checked; s.preset = 'custom'; renderFilterForm(); refilter(); });
$('fAutoG').addEventListener('change', (e) => { const s = sec(); if (!s) return; s.filters.autoGamma = e.target.checked; s.preset = 'custom'; renderFilterForm(); refilter(); });
$('dFill').addEventListener('change', (e) => { const s = sec(); if (s) s.detect.fillHoles = e.target.checked; });

/* user presets: enhancement + detection settings saved by the user, shared by all projects */
function renderPresetOptions() {
  const cur = $('fPreset').value;
  $('fPreset').innerHTML = `<optgroup label="${t('f.builtin')}">${BUILTIN_PRESETS.map((p) => `<option value="${p}">${t('f.p.' + p)}</option>`).join('')}</optgroup>`
    + (userPresets.length ? `<optgroup label="${t('f.mine')}">${userPresets.map((u) => `<option value="u:${u.id}">${esc(u.name)}</option>`).join('')}</optgroup>` : '')
    + `<option value="custom">${t('f.p.custom')}</option>`;
  if (cur) $('fPreset').value = cur;
}
async function storePresets() {
  try { localStorage.setItem('ichantool.presets', JSON.stringify(userPresets)); } catch { /* storage blocked */ }
  if (storageOK) await setPref('presets', userPresets).catch(() => {});
  scheduleBackup();
}
async function loadPresets() {
  let list = null;
  if (storageOK) list = await getPref('presets').catch(() => null);
  if (!list) { try { list = JSON.parse(localStorage.getItem('ichantool.presets') || 'null'); } catch { /* storage blocked */ } }
  userPresets = Array.isArray(list) ? list : [];
  renderPresetOptions();
}
function mergePresets(list) {
  let added = 0;
  for (const u of list || []) if (u?.id && !userPresets.some((x) => x.id === u.id)) { userPresets.push(u); added++; }
  if (added) { storePresets(); renderPresetOptions(); }
  return added;
}
$('presetSave').addEventListener('click', () => {
  const s = sec(); if (!s) return;
  const name = $('presetName').value.trim() || `${t('f.mine')} ${userPresets.length + 1}`;
  const u = { id: uid(), name, created: new Date().toISOString(), filters: { ...s.filters }, detect: { ...s.detect } };
  userPresets.push(u); $('presetName').value = ''; s.preset = 'u:' + u.id;
  storePresets(); renderFilterForm(); markDirty(); toast(t('f.saved', { n: name }));
});
$('presetDel').addEventListener('click', (e) => {
  const s = sec(); const v = s?.preset || ''; if (!v.startsWith('u:')) return;
  if (!armed(e.currentTarget)) return;
  userPresets = userPresets.filter((u) => 'u:' + u.id !== v); s.preset = 'custom';
  storePresets(); renderFilterForm();
});
$('presetAll').addEventListener('click', () => {
  const s = sec(); if (!s) return;
  busy(() => {
    for (const o of S.sections) if (o !== s) { o.filters = { ...s.filters }; o.preset = s.preset; o.detect = { ...s.detect }; enhance(o); o.logVer++; }
    markDirty(); scheduleLog(); toast(t('f.appliedAll', { n: S.sections.length }));
  });
});

$('fChannel').addEventListener('change', (e) => { const s = sec(); if (!s) return; s.filters.channel = e.target.value; s.preset = 'custom'; $('fPreset').value = 'custom'; refilter(); });
for (const [id, key] of [['fEqualize', 'equalize'], ['fInvert', 'invert']]) $(id).addEventListener('change', (e) => { const s = sec(); if (!s) return; s.filters[key] = e.target.checked; s.preset = 'custom'; $('fPreset').value = 'custom'; refilter(); });

$('detectCtl').addEventListener('input', (e) => { const s = sec(), k = e.target.dataset.k; if (!s || !k) return; s.detect[k] = +e.target.value; $('do-' + k).textContent = e.target.value; });
$('unetFile').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) loadUnet(f); });   // V0.15
$('showDoubt').addEventListener('change', (e) => { S.showDoubt = e.target.checked; requestRender(); });
$('trainOpen').addEventListener('click', openTrain);   // V0.17
$('trainClose').addEventListener('click', () => $('trainDlg').close());
$('trainBody').addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.trrole) { (S.settings.trainRoles ||= {})[el.dataset.trrole] = el.value; markDirty(); }
  else if (el.dataset.tropt) { const k = el.dataset.tropt; S.settings.trainOpt[k] = k === 'pretrained' ? el.checked : k === 'epochs' ? Math.max(1, +el.value || 60) : el.value.trim() || 'modelo'; markDirty(); }
});
$('trainBody').addEventListener('click', async (e) => {
  const el = e.target;
  if (el.id === 'trInstall') { TR.log = []; TR.running = true; renderTrain(); try { await DESK.install(); } catch (err) { TR.log.push('✕ ' + (err?.message || err)); } TR.running = false; TR.status = await DESK.status(); renderTrain(); }
  else if (el.id === 'trGo') startTrain(false);
  else if (el.id === 'trResume') { if (await DESK.unfinished(S.settings.trainOpt.name)) startTrain(true); else toast(t('tr.noResume')); }
  else if (el.id === 'trCancel') DESK.cancel();
  else if (el.id === 'trFolder') DESK.openFolder();
  else if (el.dataset.truse) { const m = await DESK.readModel(el.dataset.truse); await loadUnetBytes(new Uint8Array(m.onnx), m.json, m.name + '.onnx'); }
});
$('dMethod').addEventListener('change', (e) => { const s = sec(); if (s) { s.detect.method = e.target.value; renderDetectForm(); } });
$('dPol').addEventListener('change', (e) => { const s = sec(); if (s) s.detect.polarity = e.target.value; });
$('detectBtn').addEventListener('click', runDetection);
$('clearCand').addEventListener('click', clearCandidates);

$('maxMP').addEventListener('change', (e) => { S.settings.maxMP = +e.target.value; });
for (const [id, key, max] of [['minValid', 'minValid', 100], ['noDataPad', 'noDataPad', 1e6]]) $(id).addEventListener('change', (e) => {   // V0.3
  const v = Math.max(0, Math.min(max, +e.target.value || 0)); S.settings[key] = v; e.target.value = v;
  for (const s of S.sections) s.logVer++; markDirty(); scheduleAnalysis(); scheduleLog(); if (mode === 'fig') scheduleFigure();
});
$('binCm').addEventListener('change', (e) => { const v = +e.target.value; if (!(v > 0)) { renderBinNote(); return; } S.settings.binCm = v; markDirty(); renderBinNote(); scheduleAnalysis(); scheduleLog(); });
$('inclPred').addEventListener('change', (e) => { S.settings.includePred = e.target.checked; scheduleAnalysis(); renderClasses(); });
$('countCand').addEventListener('change', (e) => { S.settings.countCandidates = e.target.checked; scheduleAnalysis(); renderClasses(); });
$('predThr').addEventListener('input', (e) => { S.settings.predThr = +e.target.value; $('thrOut').textContent = Math.round(S.settings.predThr * 100) + '%'; for (const s of S.sections) rebuildLUT(s); renderLearn(); renderClasses(); scheduleAnalysis(); requestRender(); });
$('novelty').addEventListener('input', (e) => { S.settings.novelty = +e.target.value; $('novOut').textContent = '×' + S.settings.novelty; scheduleLearn(); });
$('acceptPred').addEventListener('click', () => {
  const s = sec(); if (!s) return; const op = beginOp(s);
  for (const o of s.objects.values()) if (status(o) === 'predicted') { rememberTrace(op, o.id); o.cls = o.pred; o.pred = null; o.conf = 0; }
  commitOp(op); afterChange(s);
});

$('secSel').addEventListener('change', (e) => selectSection(+e.target.value));
$('secName').addEventListener('input', (e) => { const s = sec(); if (!s) return; s.name = e.target.value; $('secSel').options[S.cur].textContent = s.name; });
for (const id of ['secTop', 'secBottom', 'secUnits']) $(id).addEventListener('change', () => {
  const s = sec(); if (!s) return;
  const top = parseFloat($('secTop').value), bottom = parseFloat($('secBottom').value);
  if (Number.isFinite(top) && Number.isFinite(bottom) && bottom > top) { s.top = top; s.bottom = bottom; }
  s.units = $('secUnits').value;
  recomputeFeatures(s); renderSectionForm(); scheduleLearn(); scheduleAnalysis(); requestRender();
});
$('secDel').addEventListener('click', (e) => {
  if (!sec()) return;
  if (!armed(e.currentTarget, t('confirm.secDel', { n: [...sec().objects.values()].filter((o) => o.cls).length }))) return;
  const [removed] = S.sections.splice(S.cur, 1); discardEditHistory(removed);
  selectSection(Math.min(S.cur, S.sections.length - 1)); scheduleLearn();
});
$('roiBtn').addEventListener('click', () => setTool('roi'));
$('roiReset').addEventListener('click', () => { const s = sec(); if (s) setRoi(s, { x0: 0, y0: 0, x1: s.w, y1: s.h }); });
for (const [id, dir] of [['rotL', -1], ['rotR', 1]]) $(id).addEventListener('click', () => {
  const s = sec(); if (!s?.orig) return;
  busy(() => {
    s.orig = rotate90(s.orig, s.w, s.h, 4, dir); if (s.orig16) s.orig16 = rotate90(s.orig16, s.w, s.h, 4, dir); s.labels = rotate90(s.labels, s.w, s.h, 1, dir); s.exclude = rotate90(s.exclude, s.w, s.h, 1, dir);
    s.marks = (s.marks || []).map((m) => (dir > 0 ? { ...m, x: s.h - 1 - m.y, y: m.x } : { ...m, x: m.y, y: s.w - 1 - m.x }));
    [s.w, s.h] = [s.h, s.w]; s.rot += dir; s.roi = { x0: 0, y0: 0, x1: s.w, y1: s.h };
    enhance(s);
    refreshObjects(s, new Set(s.objects.keys()), null);
    discardEditHistory(s);
    selectSection(S.cur, true); afterChange(s);
  });
});

function setAge() {
  S.age.text = $('ageText').value; S.age.units = $('ageUnits').value;
  const parsed = parseAgeModelDetailed(S.age.text); S.age.model = parsed.model;
  const m = S.age.model;
  $('ageStatus').textContent = m ? t('age.ok', { n: m.depth.length, a: fmt(Math.min(...m.age), 3), b: fmt(Math.max(...m.age), 3), u: S.age.units }) + (m.reversals ? ' ' + t('age.reversal', { n: m.reversals }) : '') + (m.bacon ? ' ' + t('age.baconPasted') : '') + (m.rangeIgnored ? ' ' + t('age.rangeIgnored', { n: m.rangeIgnored }) : '')
    : parsed.issue?.kind === 'dupDepth' ? t('age.dupDepth', { d: fmt(parsed.issue.depth, 4) }) : t('age.none');
  $('ageStatus').classList.toggle('warn', !!(m?.reversals || m?.bacon || m?.rangeIgnored || parsed.issue));
  const c = curCore(); if (c) c.ageText = S.age.text;
  scheduleAnalysis(); markDirty(); scheduleLog(); if (geoRT) geoRT.dirty = true;
  $('logAxis').querySelector('[value=age]').disabled = !m;
}
$('ageText').addEventListener('input', setAge);
$('ageUnits').addEventListener('change', setAge);
$('ageFile').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return; const txt = decodeText(await f.arrayBuffer()); e.target.value = '';
  // V0.28: a Bacon table (*_ages.txt) is converted to core units; other files are read as "depth, age[, min, max]"
  const units = S.sections[0]?.units || curCore()?.units || 'cm', div = { a: 1, ka: 1000, Ma: 1e6 }[$('ageUnits').value] || 1000;
  const bac = baconToAgeText(txt, { center: S.age.center || 'median', depthUnit: units, ageDiv: div });
  if (bac) { S.age.bacon = txt; $('ageText').value = `# ${t('age.baconHead', { f: f.name, c: t('age.c.' + (S.age.center || 'median')), u: units, a: $('ageUnits').value })}\n# ${t('age.cols')}\n` + bac.join('\n'); toast(t('age.baconOk', { n: bac.length })); }
  else { S.age.bacon = null; $('ageText').value = txt; }
  setAge(); renderAgeCenter();
});
/** V0.28: median or mean of a Bacon model (re-converted from the stored table). */
function renderAgeCenter() { $('ageCenterRow').hidden = !S.age.bacon; $('ageCenter').value = S.age.center || 'median'; }
$('ageCenter').addEventListener('change', (e) => {
  S.age.center = e.target.value; if (!S.age.bacon) return;
  const units = S.sections[0]?.units || curCore()?.units || 'cm', div = { a: 1, ka: 1000, Ma: 1e6 }[$('ageUnits').value] || 1000;
  const bac = baconToAgeText(S.age.bacon, { center: S.age.center, depthUnit: units, ageDiv: div }); if (!bac) return;
  $('ageText').value = `# ${t('age.baconHead', { f: 'Bacon', c: t('age.c.' + S.age.center), u: units, a: $('ageUnits').value })}\n# ${t('age.cols')}\n` + bac.join('\n'); setAge();
});

/* toolbar */
document.querySelectorAll('.tool').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
$('brushSize').addEventListener('input', (e) => setBrush(+e.target.value));
$('wandTol').addEventListener('input', (e) => { S.wandTol = +e.target.value; $('tolOut').textContent = S.wandTol; });
$('showOrig').addEventListener('change', (e) => { S.showOrig = e.target.checked; requestRender(); });
$('ovAlpha').addEventListener('input', (e) => { S.ovAlpha = +e.target.value / 100; for (const s of S.sections) rebuildLUT(s); requestRender(); });
$('zoomIn').addEventListener('click', () => zoomAt(view.width / 2, view.height / 2, 1.25));
$('zoomOut').addEventListener('click', () => zoomAt(view.width / 2, view.height / 2, 0.8));
$('zoomFit').addEventListener('click', fitView);
$('undoBtn').addEventListener('click', undo);
$('redoBtn').addEventListener('click', redo);
$('nextReview').addEventListener('click', () => nextReview());
try { $('autoNext').checked = localStorage.getItem('ichantool.autoNext') === '1'; } catch { $('autoNext').checked = false; }
$('autoNext').addEventListener('change', (e) => { try { localStorage.setItem('ichantool.autoNext', e.target.checked ? '1' : '0'); } catch { /* storage blocked */ } });
$('sideTabs').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

for (const id of ['addImg', 'addImg2']) $(id).addEventListener('change', (e) => { addFiles([...e.target.files]); e.target.value = ''; });
$('loadExample').addEventListener('click', loadExample);
const vp = $('viewport');
vp.addEventListener('dragover', (e) => { e.preventDefault(); vp.classList.add('drop'); });
vp.addEventListener('dragleave', () => vp.classList.remove('drop'));
vp.addEventListener('drop', (e) => { e.preventDefault(); vp.classList.remove('drop'); const f = [...e.dataTransfer.files]; if (f.length) addFiles(f); });

/* ───────────── files out ───────────── */

export async function saveFile(name, data, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const dl = window.claude?.use ? await window.claude.use('downloads').catch(() => null) : null;
  if (dl) {
    try { await dl.save({ filename: name, data: blob }); toast(t('saved')); }
    catch (e) { if (e?.code !== 'declined') toast(e?.message || String(e)); }
    return;
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
export const safe = (s) => String(s).replace(/[^\w.-]+/g, '_').slice(0, 80) || 'section';

$('expCSV').addEventListener('click', async () => {
  const counted = S.classes.map((c, k) => [c.name, k]).filter(([, k]) => S.classes[k].counts);
  await analyzeSections(S.sections);
  const rows = bioturbationTable(S.sections, { counted, range: !!S.age.model?.min, ageUnits: S.age.model ? S.age.units : null });   // V0.44: exportio.js
  analyze(sec());
  saveFile(`${safe(S.name)}_bioturbation.csv`, withProv(toCSV(rows)), 'text/csv');
});

$('expObjects').addEventListener('click', () => {
  const items = [];
  for (const s of S.sections) {
    const eff = effClassArray(s);
    for (const o of s.objects.values()) items.push({ section: s.name, units: s.units, o, cls: clsById(o.cls)?.name, status: status(o), pred: clsById(o.pred)?.name, counted: eff[o.id] >= 0, depth: (row) => depthAtRow(s, row) });
  }
  saveFile(`${safe(S.name)}_objects.csv`, withProv(toCSV(objectsTable(items))), 'text/csv');   // V0.44: exportio.js
});

$('expMask').addEventListener('click', () => {
  const s = sec(); if (!s) return;
  busy(async () => {
    const eff = effClassArray(s), cols = S.classes.map((c) => hex(c.color));
    const c = document.createElement('canvas'); c.width = s.w; c.height = s.h;
    const x = c.getContext('2d'), im = x.createImageData(s.w, s.h), d = im.data;
    for (let i = 0, j = 0; i < s.labels.length; i++, j += 4) {
      const k = s.labels[i] ? eff[topLab(s, i)] : -1;
      if (k >= 0 && !s.exclude[i]) { d[j] = cols[k][0]; d[j + 1] = cols[k][1]; d[j + 2] = cols[k][2]; }
      d[j + 3] = 255;
    }
    x.putImageData(im, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    await saveFile(`${safe(s.name)}_mask.png`, blob, 'image/png');
  });
});

/** V0.15: training set for the U-Net — for every image with reviewed traces, the original ROI (PNG), its label mask
 * (PNG, value = class index + 1, 0 = matrix or artefact, 255 = excluded or not reviewed) and manifest.json. */
$('expTrain').addEventListener('click', () => busy(async () => {
  const zip = await buildTrainingZip(); if (zip) await saveFile(`${safe(S.name)}_segmentation_dataset.zip`, zip, 'application/zip');
}));
/** The ZIP described above (Blob), or null with a message when no trace has been reviewed. */
async function buildTrainingZip() {
  const classes = S.classes.filter((c) => c.counts), idx = new Map(classes.map((c, k) => [c.id, k + 1]));
  const files = [], items = [];
  const png = async (rgba, w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').putImageData(new ImageData(rgba, w, h), 0, 0); return new Promise((r) => c.toBlob(r, 'image/png')); };
  for (const core of S.cores) for (const s of core.sections) {
    const objs = [...s.objects.values()], reviewed = objs.filter((o) => o.cls);
    if (!reviewed.length) continue;
    await withPixels(s, async () => {
      const lab = new Int16Array(s.nextId).fill(-1);
      for (const o of objs) if (o.cls) lab[o.id] = idx.get(o.cls) ?? 0;   // classes that do not count (artefacts) = matrix
      const roi = s.roi, w = roi.x1 - roi.x0, h = roi.y1 - roi.y0, m = trainingMask(s.labels, s.w, roi, s.exclude, lab, s.stacks);
      const g = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < m.length; i++) { g[i * 4] = g[i * 4 + 1] = g[i * 4 + 2] = m[i]; g[i * 4 + 3] = 255; }
      const base = `${safe(core.name)}__${safe(s.name)}`;
      files.push({ name: `images/${base}.png`, data: await png(cropRGBA(s.orig, s.w, roi), w, h) }, { name: `masks/${base}.png`, data: await png(g, w, h) });
      items.push({ image: `images/${base}.png`, mask: `masks/${base}.png`, core: core.name, section: s.name, top: s.top, bottom: s.bottom, units: s.units,
        pxPerCm: +pxPerCm(s).toFixed(5), width: w, height: h, downsample: s.ds || 1, objects: objs.length, reviewed: reviewed.length, unreviewed: objs.length - reviewed.length });
    });
  }
  if (!items.length) { toast(t('u.noReviewed')); return null; }
  const manifest = { app: APP, kind: 'segmentation-dataset', version: 1, delivery: DELIVERY, created: new Date().toISOString(), ignore: IGNORE,
    classes: classes.map((c, k) => ({ index: k + 1, name: c.name, color: c.color })), items };
  files.push({ name: 'manifest.json', data: JSON.stringify(manifest, null, 2) });
  return zipFiles(files);
}

$('expPalette').addEventListener('click', () => {
  const pal = Object.fromEntries(S.classes.filter((c) => c.counts).map((c) => [c.name, c.color]));
  saveFile(`${safe(S.name)}_palette.json`, JSON.stringify(pal, null, 2), 'application/json');
});

function modelExamples() {
  const ex = [];
  for (const e of ownExamples(S.cores.filter((c) => c.id === S.curCore), true, true)) ex.push({ key: e.key, name: e.y, x: e.x.map((v) => +v.toFixed(5)) });
  return ex.concat(S.library.filter((e) => Array.isArray(xOfLib(e))).map((e) => ({ ...e, x: xOfLib(e), xv: undefined })));
}
$('exportModel').addEventListener('click', () => {
  const used = new Set(modelExamples().map((e) => e.name));
  const model = { app: APP, kind: 'model', version: 1, features: featNames(), classes: S.classes.filter((c) => used.has(c.name)).map(({ name, color, counts }) => ({ name, color, counts })), examples: modelExamples() };
  saveFile('sedcoretool_model.json', JSON.stringify(model), 'application/json');
});
$('importModel').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const m = JSON.parse(await f.text());
    const vis = JSON.stringify(m.features) === JSON.stringify(visionFeatureId());   // V0.17: models of vision vectors
    if (m.kind !== 'model' || (!vis && JSON.stringify(m.features) !== JSON.stringify(FEATURES))) throw new Error();
    for (const c of m.classes) if (!S.classes.some((k) => k.name === c.name)) S.classes.splice(S.classes.length - 1, 0, { id: 'c' + uid(), name: c.name, color: c.color, counts: c.counts !== false });
    const D = vis ? VISION_MODEL.dim : FEATURES.length;
    S.library = S.library.concat(m.examples.filter((x) => Array.isArray(x.x) && x.x.length === D).map((x) => (vis ? { name: x.name, key: x.key, xv: x.x } : x)));
    scheduleLearn(); renderClasses();
  } catch { toast(t('err.project')); }
});
$('clearLib').addEventListener('click', (e) => { if (!S.library.length || !armed(e.currentTarget)) return; S.library = []; markDirty(); scheduleLearn(); });

/* ───────────── cores of a project ─────────────
   A project holds several cores. Each core has its image sections (bioturbation), external records,
   imported numeric data (imp), user columns, age model and log view. The active core's arrays are
   exposed as S.sections / S.records / S.age / S.logView so the image tools work unchanged.
   core.depth / core.age / core.proxies are derived (images + records + imported + user + computed). */

const VIEW_ONLY = /(^|[#&])win=/.test(location.hash);
export const curCore = () => S.cores.find((c) => c.id === S.curCore);

export function makeCore(q = {}) {
  const lv = defaultLogView();
  const c = {
    id: q.id || 'c' + uid(), name: q.name || t('core.new'), lat: q.lat ?? null, lon: q.lon ?? null, waterDepth: q.waterDepth ?? null, holdout: !!q.holdout,
    units: q.units || 'm', source: q.source || null, notes: q.notes || '',
    imp: q.imp || null, user: q.user || {}, edits: q.edits || {}, records: q.records || [], sections: [],
    logView: { ...lv, ...(q.logView || {}), tracks: { ...lv.tracks, ...(q.logView?.tracks || {}) } },
    ageModel: { text: q.age?.text || q.ageText || '', units: q.age?.units || 'ka', model: null, bacon: q.age?.bacon || null, center: q.age?.center || 'median' },
    depth: null, age: null, proxies: {}, src: {}, ageText: '',
  };
  c.ageModel.model = parseAgeModel(c.ageModel.text);
  return c;
}

/** Make a core the working core of the image tools and the composite log. */
function activateCore(id, silent = false) {
  const c = S.cores.find((x) => x.id === id) || S.cores[0]; if (!c) return;
  S.curCore = c.id;
  S.sections = c.sections; S.records = c.records; S.age = c.ageModel; S.logView = c.logView;
  discardEditHistory(); S.selected = 0; S.multi.clear();
  $('ageText').value = S.age.text; $('ageUnits').value = S.age.units; renderAgeCenter?.();
  const keep = loading; loading = true; setAge(); loading = keep;
  selectSection(S.sections.length ? 0 : -1, true);
  renderRecList(); renderLogPanel(); renderCoreBar(); scheduleLog(0);
  if (S.geo) S.geo.view.core = c.id;
  scheduleLearn(); // the core model depends on the open core
  if (!silent) { markDirty(); scheduleGeo(); renderData(); }
}

/** Series of one core from its images (bioturbation per interval) and external records, in core units. */
function coreImageParts(c) {
  const parts = [], base = c.units || 'm', model = c.ageModel.model;
  if (c.sections.length) {
    const f = (s) => UNIT_TO_CM[s.units] / UNIT_TO_CM[base];
    for (const s of c.sections) analyze(s);
    const rows = compositeRows(c.sections.map((s) => ({ name: s.name, bins: s.bins.map((b) => ({ ...b, dTop: b.dTop * f(s), dBottom: b.dBottom * f(s), depth: b.depth * f(s) })) })), { axis: 'depth', model });
    const vals = { [t('geo.p.bio')]: rows.map((r) => r.pct), BI: rows.map((r) => r.BI), ii: rows.map((r) => r.ii) };
    S.classes.forEach((k, j) => { if (k.counts && rows.some((r) => r.classPct[j] > 0)) vals[`% ${k.name}`] = rows.map((r) => r.classPct[j]); });
    parts.push({ depth: rows.map((r) => r.depth), age: null, vals, src: 'img' });
  }
  const inv = model ? invertModel(model) : null;
  for (const rec of c.records) for (const se of rec.series) {
    const depth = rec.axis === 'age' ? (inv ? se.x.map((a) => interpAge(inv, a)) : null) : se.x;
    if (depth) parts.push({ depth, age: rec.axis === 'age' ? se.x : null, vals: { [se.name]: se.y }, src: 'rec' });
  }
  return parts;
}

/** Recompute the derived arrays of a core (all sources merged on the union of depths). */
export function refreshCoreData(c) {
  if (c.frozen) return; // read-only copy (windows built from the light index)
  const parts = coreImageParts(c), model = c.ageModel.model;
  if (c.imp) parts.push({ depth: c.imp.depth, age: c.imp.age, vals: c.imp.proxies || {}, src: 'imp' });
  for (const [name, u] of Object.entries(c.user || {})) parts.push({ depth: u.d, age: null, vals: { [name]: u.v }, src: 'man' });
  c.ageText = c.ageModel.text; c.src = {};
  const withDepth = parts.filter((q) => q.depth);
  let rows = [];
  if (withDepth.length) {
    for (const q of withDepth) q.depth.forEach((d, i) => { if (d != null) rows.push({ d, a: q.age?.[i] ?? null, q, i }); });
    rows.sort((x, y) => x.d - y.d);
    c.depth = rows.map((r) => r.d);
    const ages = rows.map((r) => r.a ?? (model ? interpAge(model, r.d) : null));
    c.age = ages.some((v) => v != null) ? ages : null;
  } else {
    const q = parts.find((x) => x.age); // age-only core (no depth anywhere)
    if (q) q.age.forEach((a, i) => rows.push({ d: null, a, q, i }));
    c.depth = null; c.age = rows.length ? rows.map((r) => r.a) : null;
  }
  c.proxies = {};
  for (const q of parts) for (const name of Object.keys(q.vals)) { c.proxies[name] = rows.map(() => null); c.src[name] = q.src; }
  rows.forEach((r, k) => { for (const [name, arr] of Object.entries(r.q.vals)) c.proxies[name][k] = arr?.[r.i] ?? null; });
  applyCellEdits(c);   // V0.35
  applyComputedColumns(c);
}
export function refreshAllCores() { for (const c of S.cores) refreshCoreData(c); }

/**
 * V0.35: cells edited by hand in the Data sheet. c.edits[column][axisValue] = { v: new value (null = deleted), o: original
 * value, at: ISO date }. They are applied over the merged data (so analyses and computed columns use them) and the
 * original is kept to show and restore it. Rows are matched by depth (or age for age-only cores).
 */
function applyCellEdits(c) {
  if (!c.edits) return;
  const ax = c.depth || c.age || [], pos = new Map();
  ax.forEach((x, k) => { const key = String(x); if (!pos.has(key)) pos.set(key, k); });
  for (const [name, e] of Object.entries(c.edits)) {
    const arr = c.proxies[name]; if (!arr) continue;
    for (const [key, ed] of Object.entries(e)) { const k = pos.get(key); if (k == null) continue; ed.o = arr[k]; arr[k] = ed.v; }
  }
}
export const cellEdit = (c, name, x) => c.edits?.[name]?.[String(x)] || null;
export const editCount = (cores) => cores.reduce((n, c) => n + Object.values(c.edits || {}).reduce((m, e) => m + Object.keys(e).length, 0), 0);

/** Computed columns of the Data tab (formulas over the core's columns), applied after merging. */
function applyComputedColumns(c) {
  const n = (c.depth || c.age || []).length;
  for (const col of S.sheet.columns) {
    if (col.core && col.core !== 'all' && col.core !== c.id) continue;
    try {
      const cols = { ...c.proxies, depth: c.depth || new Array(n).fill(null), age: c.age || new Array(n).fill(null) };
      // V0.35: columns measured at different depths are interpolated to every row (linear, no extrapolation)
      if (col.interp !== false) { const x = c.depth || c.age || []; for (const r of formulaRefs(col.formula)) if (c.proxies[r]) cols[r] = fillLinear(x, c.proxies[r]); }
      const v = evalColumn(col.formula, cols, n);
      c.proxies[col.name] = v; c.src[col.name] = 'calc';
    } catch (e) { col.error = fxText(e); continue; }
    col.error = null;
  }
}

function projectMeta() {
  return { id: S.id, name: S.name, updated: Date.now(), sections: S.cores.reduce((n, c) => n + c.sections.length, 0), cores: S.cores.length,
    coreNames: S.cores.map((c) => c.name), kind: S.kind || 'normal' };
}
/** Light copy of the numeric data of the project, for the all-projects view and multiproject maps. */
function liteSnapshot() {
  return {
    id: S.id, name: S.name, updated: Date.now(), kind: S.kind || 'normal',
    examples: S.cores.flatMap((c) => c.sections.flatMap((s) => [...s.objects.values()].filter((o) => o.cls && !o.nt && clsById(o.cls) && (o.feat || o.emb)).map((o) => ({   // V0.17: both vector sets
      key: `${S.id}|${c.id}|${s.id}|${o.id}`, name: clsById(o.cls).name, x: o.feat ? vec(o.feat).map((v) => +v.toFixed(4)) : null, ...(o.emb ? { xv: o.emb } : {}), core: c.name, thumb: thumbOf(s, o) })))),
    layers: S.geo.layers, intervals: S.geo.intervals, geo: (({ cores: _c, ...g }) => g)(S.geo),
    cores: S.cores.map((c) => ({ id: c.id, name: c.name, lat: c.lat, lon: c.lon, units: c.units, ageText: c.ageText, depth: c.depth, age: c.age, proxies: c.proxies, src: c.src, nImages: c.sections.length })),
  };
}

let bc = null; try { bc = new BroadcastChannel('ichantool'); } catch { bc = null; }
function broadcast(msg) { try { bc?.postMessage(msg); } catch { /* channel unavailable */ } }

/* core bar in the header */
export function renderCoreBar() {
  const sel = $('coreSel'); if (!sel) return;
  sel.innerHTML = S.cores.map((c) => `<option value="${c.id}" ${c.id === S.curCore ? 'selected' : ''}>${esc(c.name)}${c.sections.length ? ` · ${c.sections.length} img` : ''}</option>`).join('');
}
$('coreSel').addEventListener('change', (e) => { activateCore(e.target.value); });
$('coreAdd').addEventListener('click', () => openCoreDlg(null));
$('coreEdit').addEventListener('click', () => openCoreDlg(curCore()));
let coreDlgFor = null;
export function openCoreDlg(c) {
  coreDlgFor = c;
  $('cdTitle').textContent = t(c ? 'core.edit' : 'core.add');
  $('cdName').value = c?.name || ''; $('cdLat').value = c?.lat ?? ''; $('cdLon').value = c?.lon ?? ''; $('cdWd').value = c?.waterDepth ?? ''; $('cdUnits').value = c?.units || 'm';
  $('cdNotes').value = c?.notes || ''; $('cdDel').hidden = !c || S.cores.length < 2; $('cdDel').dataset.armed = '';
  $('cdDel').textContent = t('core.del');
  $('coreDlg').showModal();
}
$('cdCancel').addEventListener('click', () => $('coreDlg').close());
$('cdOk').addEventListener('click', () => {
  const num = (v) => (v === '' ? null : +v);
  const vals = { name: $('cdName').value.trim() || t('core.new'), lat: num($('cdLat').value), lon: num($('cdLon').value), waterDepth: num($('cdWd').value), units: $('cdUnits').value, notes: $('cdNotes').value };
  if (coreDlgFor) Object.assign(coreDlgFor, vals);
  else { const c = makeCore(vals); S.cores.push(c); refreshCoreData(c); activateCore(c.id, true); }
  $('coreDlg').close(); renderCoreBar(); refreshAllCores(); geoMarkDirty(); markDirty(); scheduleGeo(); renderData();
});
$('cdDel').addEventListener('click', () => {
  const b = $('cdDel'), c = coreDlgFor; if (!c) return;
  if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = t('proj.delConfirm'); return; }
  S.cores = S.cores.filter((x) => x !== c); S.geo.intervals = S.geo.intervals.filter((q) => q.core !== c.id);
  $('coreDlg').close(); activateCore(S.cores[0].id); geoMarkDirty();
});

/* ───────────── projects: serialisation ───────────── */

/**
 * One section in a project. V0.1 (format v4): the image is a reference to the image store (`file.key`), or, before it
 * is stored, the Blob itself (`file.blob`); `projectForExport` turns both into image files of a package or folder. Object statistics
 * (`st`) are saved so that a section can be used without decoding its picture.
 */
function serSection(s) {
  const o2 = (o) => ({ id: o.id, cls: o.cls, src: o.src, ...(o.nt ? { nt: 1 } : {}), ...(o.stats ? { st: o.stats } : {}), ...(o.cls && o._thumb ? { th: o._thumb } : {}), ...(o.emb ? { em: o.emb } : {}) });
  // V0.41: the file keeps only the overlap stacks still in use (renumbered on a copy)
  let lab = s._mk.labels.rle(), stacks;
  if (s.stacks.length > 1) { lab = Array.from(lab); stacks = compactStacks(lab, s.stacks, 2); if (stacks.length < 2) stacks = undefined; }
  return {
    id: s.id, name: s.name, ds: s.ds, rot: s.rot, w: s.w, h: s.h, crop: s.crop || null, full: s.full || null,
    file: s.file.key ? { name: s.file.name, type: s.file.type, key: s.file.key, size: s.file.size } : { name: s.file.name, type: s.file.type, blob: s.file.blob },
    top: s.top, bottom: s.bottom, units: s.units, roi: s.roi, filters: s.filters, preset: s.preset, detect: s.detect, manual: s.manual,
    nextId: s.nextId, objects: [...s.objects.values()].map(o2),
    labels: lab, stacks, exclude: s._mk.exclude.rle(), marks: s.marks || [],
  };
}

/** Project file, format v3: project → cores (images, imported data, records, age model, intervals by core id). */
function serialize() {
  if (projectPreview) return projectPreview;
  const { cores: _c, ...geo } = S.geo;
  return {
    app: APP, kind: 'project', version: FORMAT_VERSION, appVersion: VERSION, delivery: DELIVERY, saved: new Date().toISOString(),
    id: S.id, name: S.name, notes: S.notes, comments: S.comments || [], classes: S.classes, active: S.active, settings: S.settings, library: S.library,
    projectKind: S.kind || 'normal', multiSource: S.multiSource || null, models: projectModels(), finalTests: S.finalTests || [],
    geo, sheet: S.sheet, fig: S.fig, ...figTabsData(), curCore: S.curCore, plots: S.plots || [], plotCur: S.plotCur || 0,
    cores: S.cores.map((c) => ({
      id: c.id, name: c.name, lat: c.lat, lon: c.lon, waterDepth: c.waterDepth ?? null, units: c.units, source: c.source || null, notes: c.notes || '', holdout: c.holdout || undefined,
      imp: c.imp, user: c.user || {}, edits: c.edits && Object.keys(c.edits).length ? c.edits : undefined, records: c.records, logView: c.logView, age: { text: c.ageModel.text, units: c.ageModel.units, bacon: c.ageModel.bacon || undefined, center: c.ageModel.center || undefined },
      sections: c.sections.map((q) => serSection(q)),
    })),
  };
}

/** V0.1: a section is opened without decoding its picture; files from older versions are decoded once (sizes, object statistics). */
async function loadSection(q) {
  const f = q.file, legacy = !f.key;
  const file = legacy ? { name: f.name, type: f.type, blob: f.blob || new Blob([f.bytes ? new Uint8Array(f.bytes) : b64decode(f.b64)], { type: f.type || 'image/jpeg' }) } : { name: f.name, type: f.type, key: f.key, size: f.size };
  let w = q.w, h = q.h, orig = null, orig16 = null;
  const mk = (s) => Object.assign(s, { id: q.id, rot: q.rot || 0, crop: q.crop || null, top: q.top, bottom: q.bottom, units: q.units, roi: q.roi, filters: q.filters, preset: q.preset, detect: q.detect, manual: q.manual || [], nextId: q.nextId, marks: q.marks || [] });
  if (!w || !h) {   // very old files without sizes
    const tmp = mk(newSection({ name: q.name, file, w: 1, h: 1, orig: null, ds: q.ds || 1 }));
    const r = await decodeWorking(tmp, q.ds || 1); ({ w, h } = r); orig = r.rgba; orig16 = r.rgba16 || null;
  }
  if (q.$missing) throw new Error(t('load.badMask', { s: q.name || '?', k: 'section' }));   // V0.44: section record missing in the library
  // V0.36: a damaged mask stops the load instead of being saved over the good copy
  for (const k of ['labels', 'exclude']) if (q[k] != null && !rleValid(q[k], w * h)) throw new Error(t('load.badMask', { s: q.name || '?', k }));
  const region = !validSavedRegion(q.roi, w, h), mask = hasBrokenMaskRefs(q.labels, q.stacks, q.objects);
  const preview = region || mask, hasStacks = Array.isArray(q.stacks) && q.labels != null;
  const labels = preview ? [0, w * h] : hasStacks ? q.labels.slice() : q.labels;
  const s = mk(newSection({ name: q.name, file, w, h, orig, orig16, ds: q.ds || 1, full: q.full || null, labels: { rle: labels }, exclude: { rle: q.exclude } }));
  if (preview) {
    if (region) s.roi = { x0: 0, y0: 0, x1: w, y1: h };
    s.nextId = 1;
    s.loadWarnings = { region, mask };
    return s;
  }
  if (hasStacks) { s.stacks = compactStacks(labels, q.stacks, 2); s._six = null; }   // Renumber a working copy before the first unpack.
  const ppu = pxPerCm(s);
  for (const o of q.objects) {
    const st = o.st || null;
    const order = s.objects.get(o.id)?.order ?? s.nextTraceOrder++;
    s.objects.set(o.id, { id: o.id, order, cls: o.cls, src: o.src, nt: !!o.nt, pred: null, conf: 0, area: st?.n || 0, bbox: st ? [st.x0, st.y0, st.x1, st.y1] : null, stats: st, feat: st ? features(st, ppu) : null, ...(o.th ? { _thumb: o.th } : {}), ...(o.em ? { emb: o.em } : {}) });
  }
  if (q.objects.some((o) => !o.st)) {   // older files: object statistics need the pixels once
    await withPixels(s, (x) => refreshObjects(x, new Set(x.objects.keys()), null));
    s._mk.labels.pack(); s._mk.exclude.pack();
  }
  if (legacy) loadMigrated = true;
  return s;
}
let loadMigrated = false;

/* V0.36: version 5 = trace overlaps (stacks, V0.20), cell edits (V0.35). A newer file opens read-only. */
const FORMAT_VERSION = 5;
let readOnlyProject = false;
let projectPreview = null;

async function loadProject(p) {
  const finishDiagnostic = diagnosticOperation('project.load');
  const source = p;
  blankStart = false;
  resetState(); loading = true; loadMigrated = false; clearTimeout(saveTimer);
  readOnlyProject = (p?.version || 0) > FORMAT_VERSION;   // V0.36: written by a newer SedCoreTool
  try {
    p = upgradeProject(p);
    S.id = p.id || uid(); S.name = p.name || APP; S.notes = p.notes || ''; S.comments = p.comments || [];
    S.classes = p.classes || defaultClasses(); S.active = p.active || 'undet';
    Object.assign(S.settings, p.settings || {}); S.library = p.library || []; S.kind = p.projectKind || 'normal'; S.multiSource = p.multiSource || null; S.plots = p.plots || []; S.plotCur = p.plotCur || 0; S.coreModels = p.models?.cores || {};
    S.sheet = { columns: [], cells: {}, ...(p.sheet || {}) };
    loadFigTabs(p); S.finalTests = p.finalTests || [];
    S.geo = normalizeGeo(p.geo);
    geoReset();
    S.cores = [];
    for (const q of p.cores || []) {
      const c = makeCore(q);
      for (const sq of q.sections || []) c.sections.push(await loadSection(sq));
      S.cores.push(c);
    }
    if (!S.cores.length) S.cores.push(makeCore({ name: t('core.first') }));
    if (S.settings.binPx != null) {   // V0.1: before V0.1 (V33) the interval was given in pixel rows
      const s0 = S.cores.flatMap((c) => c.sections)[0];
      if (p.settings?.binCm == null) S.settings.binCm = s0 ? S.settings.binPx / pxPerCm(s0) : 1;
      delete S.settings.binPx;
    }
    if (S.cores.some((c) => c.sections.some((s) => s.loadWarnings))) {
      // Keep the original package data separate from the temporary editing state.
      projectPreview = structuredClone(source);
      $('projectValidation').hidden = false;
    }
  } catch (err) {
    // V0.36: a failed load never leaves a half-built project that the autosave would write over the stored one
    console.error(err); loading = false; clearTimeout(saveTimer);
    resetState(); blankStart = true; dirty = false; readOnlyProject = false; setSaveState('off');
    toast(t('load.failed', { e: err?.message || String(err) }), 9000);
    finishDiagnostic(err);
    return false;
  } finally { loading = false; }
  if (readOnlyProject) setTimeout(() => { setSaveState('off'); toast(t('load.newer', { v: p.delivery || p.version }), 10000); }, 300);
  if (projectPreview) readOnlyProject = true;
  const cur = S.cores.find((c) => c.id === p.curCore) || S.cores[0];
  activateCore(cur.id, true);
  syncSettingsForm(); learnNow(); updateProjHeader(); refreshOtherExamples(); setTimeout(updateTip, 0);
  refreshAllCores();
  if (S.geo.trained) setTimeout(() => { geoTrain(true).catch(() => { /* retrained on demand */ }); }, 0); else scheduleGeo(0);
  try { localStorage.setItem('ichantool.last', S.id); } catch { /* storage blocked */ }
  dirty = false; setSaveState(storageOK && !projectPreview ? 'saved' : 'off');
  if (loadMigrated) markDirty();   // V0.1: move images of older projects to the image store
  renderComments();
  finishDiagnostic();
}

function resetState() {
  blankStart = false; clearTimeout(saveTimer);   // V0.36: a pending save of the previous project must not run afterwards
  readOnlyProject = false; projectPreview = null; $('projectValidation').hidden = true;
  const maxMP = S.settings.maxMP || 8;
  S.id = uid(); S.name = t('proj.untitled'); S.notes = ''; S.comments = []; S.finalTests = [];
  clearNavigationPreviews();
  MEM.px.length = 0; MEM.mask.length = 0; pxWanted.clear();   // V0.1: pictures of the previous project can be freed
  S.selected = 0; S.multi.clear(); S.library = []; S.sheet = { columns: [], cells: {} }; resetFigTabs(); S.kind = 'normal'; S.multiSource = null; S.plots = []; S.plotCur = 0; S.coreModels = {};
  S.geo = defaultGeo(); geoReset();
  S.classes = defaultClasses(); S.active = 'undet';
  S.settings = { binCm: 1, minValid: 20, noDataPad: 0, includePred: true, predThr: 0.7, countCandidates: true, novelty: 3, maxMP, clfScope: 'project', ml: { ...ML_DEFAULT } };
  $('detectStatus').textContent = '';
  S.cores = [makeCore({ name: t('core.first') })];
  activateCore(S.cores[0].id, true);
}

/* ───────────── projects: library and autosave ───────────── */

let storageOK = false, loading = false, dirty = false, saveTimer = 0;

/* V0.67: "Saved" only when the data are also copied to a backup folder; otherwise the label says where they are. */
let saveSt = 'off';
function setSaveState(st) {
  saveSt = st;
  const local = st === 'saved' && storageOK && (backupState !== 'ok' || backupPending || backupPromise);
  const key = local ? (backupState === 'none' ? 'save.local' : 'save.localPending') : 'save.' + st;
  const el = $('saveState'); el.textContent = t(key); el.dataset.state = st; el.title = local ? t('save.localTip') : '';
  if (local) el.dataset.backup = backupState; else delete el.dataset.backup;   // warning colour only; data-state stays 'saved'
  $('saveRetry').hidden = st !== 'error';
}
$('saveRetry').addEventListener('click', () => saveToDB());

export function markDirty() {
  if (loading || VIEW_ONLY) return;
  blankStart = false;   // V0.2: work started without creating a project is saved as a new project
  scheduleFloat();
  dirty = true; setSaveState(storageOK && !readOnlyProject ? 'dirty' : 'off');
  clearTimeout(saveTimer); if (storageOK) saveTimer = setTimeout(saveToDB, 1500);
}

let savePromise = null, lastSaveError = null;
/** Save the open project; saves never overlap (a new save waits for the one in progress). */
let blankStart = true;   // V31: nothing is saved until the user creates or opens a project
async function saveToDB() {
  if (blankStart || loading || readOnlyProject) return;   // V0.36: never during a load nor over a file of a newer version
  if (!S.id || !S.cores.length) return;   // V0.36: the initial state (before startup) is not a project
  if (!storageOK) return;
  clearTimeout(saveTimer);
  if (savePromise) { await savePromise.catch(() => {}); if (!dirty && !savePromise) return; }
  savePromise = (async () => {
    const finishDiagnostic = diagnosticOperation('save');
    try {
      setSaveState('saving'); dirty = false;
      await storePendingImages();
      await putProject(projectMeta(), serialize());
      try { await putLite(S.id, liteSnapshot()); } catch { /* lite index is optional */ }
      broadcast({ type: 'saved', id: S.id });
      if (saveCount++ % 10 === 0) checkQuota();   // V0.36
      try { localStorage.setItem('ichantool.last', S.id); } catch { /* storage blocked */ }
      lastSaveError = null;
      setSaveState(dirty ? 'dirty' : 'saved'); scheduleBackup();
      finishDiagnostic();
    } catch (e) {
      dirty = true; lastSaveError = e; setSaveState('error'); console.error(e);
      finishDiagnostic(e);
      if (e?.name === 'QuotaExceededError') toast(t('save.quota'));
    }
  })();
  try { await savePromise; } finally { savePromise = null; }
}
/** V0.36: the daily copies are kept for 30 days; older ones only the first of each month, for 12 months. */
async function rotateHistory(hist) {
  const names = []; for await (const [name, h] of hist.entries()) if (h.kind === 'file' && /^\d{4}-\d{2}-\d{2}\.json$/.test(name)) names.push(name);
  names.sort().reverse();   // newest first
  const keep = new Set(names.slice(0, 30)), months = [];
  for (const n of [...names.slice(30)].reverse()) { const mo = n.slice(0, 7); if (!months.some((x) => x.mo === mo)) months.push({ mo, n }); }   // first copy of each older month
  for (const { n } of months.sort((a, b) => b.mo.localeCompare(a.mo)).slice(0, 12)) keep.add(n);
  for (const n of names) if (!keep.has(n)) await hist.removeEntry(n);
}
/** V0.36: warn when the browser storage is almost full (once per session). */
let quotaWarned = false;
async function checkQuota() {
  try {
    const e = await navigator.storage?.estimate?.(); if (!e?.quota) return;
    const f = e.usage / e.quota; $('saveState').title = t('quota.use', { u: (e.usage / 1e6).toFixed(0), q: (e.quota / 1e6).toFixed(0), p: (f * 100).toFixed(0) });
    if (f > 0.8 && !quotaWarned) { quotaWarned = true; toast(t('quota.high', { p: (f * 100).toFixed(0) }), 10000); }
  } catch { /* not available */ }
}
let saveCount = 0;
async function flushSave() {
  if (savePromise) await savePromise;
  if (dirty) await saveToDB();
  if (backupPending) void backupNow();
}
/** Do not replace live state when the last save failed or newer edits are still pending. */
async function canLeaveProject() {
  if (!S.id && !S.cores.length) return true;   // Startup preferences are not an open project to preserve.
  await flushSave();
  if (!dirty) return true;
  toast(t('save.pending'), 8000);
  return false;
}
/* V0.36: do not lose the last changes when the page or the program is closed */
let closeOK = false;
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && dirty) saveToDB(); });
window.addEventListener('pagehide', () => { if (dirty) saveToDB(); });
window.addEventListener('beforeunload', (e) => {
  if ((!dirty && !savePromise) || closeOK || readOnlyProject || blankStart) return;
  e.preventDefault(); e.returnValue = '';
  if (window.corantoolDesktop) desktopClose();
});
/** V0.57 desktop: save, then close; if the changes cannot be saved, ask instead of refusing to close in silence. */
function desktopClose() {
  if (document.querySelector('dialog.saveFail')) return;
  flushSave().then(() => { if (dirty) saveFailDialog(lastSaveError); else { closeOK = true; window.close(); } }).catch((err) => { console.error(err); saveFailDialog(err); });
}
function saveFailDialog(err) {
  const dlg = document.createElement('dialog'); dlg.className = 'saveFail';
  const reason = !storageOK ? t('close.noStorage') : err?.name === 'QuotaExceededError' ? t('save.quota') : err?.message || '';
  dlg.innerHTML = `<form method="dialog" style="display:grid;gap:10px;max-width:460px"><h3 style="margin:0">${esc(t('close.failTitle'))}</h3><p style="margin:0">${esc(t('close.failText'))}</p>${reason ? `<p class="note" style="margin:0">${esc(reason)}</p>` : ''}
    <div class="row" style="justify-content:flex-end;gap:8px;flex-wrap:wrap"><button class="btn" value="cancel">${esc(t('cl.cancel'))}</button><button class="btn" value="discard">${esc(t('close.discard'))}</button><button class="btn" value="export">${esc(t('close.export'))}</button><button class="btn primary" value="retry" autofocus>${esc(t('close.retry'))}</button></div></form>`;
  document.body.appendChild(dlg);
  dlg.addEventListener('close', async () => {
    const v = dlg.returnValue; dlg.remove();
    if (v === 'retry') desktopClose();
    else if (v === 'discard') { closeOK = true; window.close(); }
    else if (v === 'export') {
      try { await saveFile(`${safe(S.name)}.sedcoretool`, await packageProjects([serialize()]), 'application/zip'); toast(t('close.exported'), 8000); }
      catch (e2) { console.error(e2); toast(t('close.exportFail'), 8000); }
    }
  });
  dlg.showModal();
}

function updateProjHeader() {
  $('projName').textContent = S.name;
  const multi = S.kind === 'multi';
  document.querySelector('#projBtn .lbl').textContent = t(multi ? 'mp.label' : 'proj.label');
  $('projClose').textContent = t(multi ? 'mp.back' : 'home.back');
}

/** Identity of a core across projects: the same name (ignoring case, spaces and punctuation). */
const coreKey = (name) => String(name ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
/** For each core identity, the projects that contain it (from the light index). */
function sharedCores(lites) {
  const m = new Map();
  for (const l of lites) if (l.kind !== 'multi') for (const c of l.cores || []) { const k = coreKey(c.name); if (!k) continue; if (!m.has(k)) m.set(k, new Map()); m.get(k).set(l.id, l.name); }
  return m;
}
/** Saved cross-project analyses (kind 'multi'), listed in the «Entre proyectos» tab, never among the projects (V24). */
function renderAnalyses(list, q = '') {
  const box = $('mpList'); if (!box) return;
  const shown = list.filter((p) => !q || coreKey(p.name).includes(q) || (p.coreNames || []).some((n) => coreKey(n).includes(q)));
  $('mpSaved').hidden = !list.length;
  box.innerHTML = shown.map((p) => `<article class="pcard ${p.id === S.id ? 'current' : ''}" data-id="${p.id}" tabindex="0" aria-label="${esc(p.name)}">
    <h3>${esc(p.name)}</h3>
    <p class="facts"><span>${t('home.cores', { n: p.cores ?? (p.coreNames || []).length })}</span><span class="note">${esc((p.coreNames || []).slice(0, 8).join(', '))}${(p.coreNames || []).length > 8 ? '…' : ''}</span>${p.id === S.id ? `<span>${t('proj.current')}</span>` : ''}</p>
    <div class="pacts"><button class="btn small primary" data-act="open">${t('proj.open')}</button><button class="btn small" data-act="mpupdate">${t('mp.update')}</button><button class="btn small" data-act="rename">${t('proj.rename')}</button><button class="btn small" data-act="del">${t('proj.del')}</button></div>
  </article>`).join('') || `<p class="note">${t('home.noMatch')}</p>`;
}
async function renderProjects() {
  const box = $('projList');
  if (!storageOK) { box.innerHTML = `<p class="note">${t('save.off')}</p>`; return; }
  let [list, lites] = await Promise.all([listProjects().catch(() => []), listLite().catch(() => [])]);
  list.sort((a, b) => b.updated - a.updated);
  const L = new Map(lites.map((l) => [l.id, l])), shared = sharedCores(lites), q = coreKey($('homeSearch').value);
  renderAnalyses(list.filter((p) => p.kind === 'multi'), q);   // V24: cross-project analyses are not projects
  list = list.filter((p) => p.kind !== 'multi');
  $('nProjects').textContent = list.length;
  $('nCores').textContent = shared.size;
  $('projClose').hidden = !S.cores.length && !S.sections.length;
  if (!list.length) {
    box.innerHTML = `<div class="pempty"><h3>${t('home.emptyTitle')}</h3><p class="note">${t('home.emptyText')}</p>
      <div class="row"><button class="btn primary" data-empty="new">${t('home.newProject')}</button><button class="btn" data-empty="tutorial">${t('tut.open')}</button></div></div>`;
    return;
  }
  const rel = (ms) => { const d = (Date.now() - ms) / 60000; return d < 1 ? t('home.now') : d < 60 ? t('home.min', { n: Math.round(d) }) : d < 1440 ? t('home.hours', { n: Math.round(d / 60) }) : new Date(ms).toLocaleDateString(lang(), { dateStyle: 'medium' }); };
  const shown = list.filter((p) => !q || coreKey(p.name).includes(q) || (p.coreNames || []).some((n) => coreKey(n).includes(q)));
  box.innerHTML = shown.map((p) => {
    const lite = L.get(p.id), cores = lite?.cores || (p.coreNames || []).map((n) => ({ name: n }));
    const len = (c) => { const d = (c.depth || []).filter((v) => v != null); return d.length ? Math.max(...d) - Math.min(...d) : 0; };
    const maxLen = Math.max(1, ...cores.map(len)), ivCores = new Set((lite?.intervals || []).map((iv) => iv.core));
    const nShared = cores.filter((c) => (shared.get(coreKey(c.name))?.size || 0) > 1).length;
    const liners = cores.slice(0, 22).map((c) => {
      const others = [...(shared.get(coreKey(c.name)) || new Map()).entries()].filter(([id]) => id !== p.id).map(([, n]) => n);
      const h = len(c) ? Math.max(16, Math.round((len(c) / maxLen) * 60)) : 30;
      const tip = `${c.name}${len(c) ? ` — ${fmt(len(c), 3)} ${c.units || ''}` : ''}${c.nImages ? `, ${t('home.nImg', { n: c.nImages })}` : ''}${Object.keys(c.proxies || {}).length ? `, ${t('home.nVar', { n: Object.keys(c.proxies).length })}` : ''}${others.length && p.kind !== 'multi' ? `. ${t('home.alsoIn', { p: others.join(', ') })}` : ''}`;
      return `<span class="liner ${c.nImages ? 'img' : ''} ${ivCores.has(c.id) ? 'iv' : ''} ${others.length && p.kind !== 'multi' ? 'shared' : ''}" style="height:${h}px" title="${esc(tip)}"></span>`;
    }).join('') + (cores.length > 22 ? `<span class="more">+${cores.length - 22}</span>` : '') || `<span class="emptytray">${t('home.noCores')}</span>`;
    const kind = p.kind === 'multi' ? t('mp.badge') : p.kind === 'tutorial' ? t('home.kindTutorial') : '';
    return `<article class="pcard ${p.id === S.id ? 'current' : ''}" data-id="${p.id}" tabindex="0" aria-label="${esc(p.name)}">
      <div class="tray" aria-hidden="true">${liners}</div>
      <h3>${esc(p.name)}</h3>
      <p class="facts"><span>${t('home.cores', { n: p.cores ?? cores.length })}</span><span>${t('home.nImg', { n: p.sections ?? 0 })}</span>${nShared && p.kind !== 'multi' ? `<span class="warnshare">${t('home.shared', { n: nShared })}</span>` : ''}<span>${p.id === S.id ? t('proj.current') : rel(p.updated)}</span></p>
      <div class="pacts"><button class="btn small primary" data-act="open">${t('proj.open')}</button><button class="btn small" data-act="rename">${t('proj.rename')}</button>${p.kind === 'multi' ? `<button class="btn small" data-act="mpupdate">${t('mp.update')}</button>` : ''}<button class="btn small ghost" data-act="del">${t('proj.del')}</button>${kind ? `<span class="tag">${esc(kind)}</span>` : ''}</div>
    </article>`;
  }).join('') || `<p class="note">${t('home.noMatch')}</p>`;
}
$('homeSearch').addEventListener('input', () => { renderProjects(); renderAllProjects(); });
for (const id of ['projList', 'mpList']) $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList.contains('pcard')) e.target.querySelector('[data-act=open]').click(); });
async function onProjectListClick(e) {
  const em = e.target.closest('[data-empty]')?.dataset.empty;
  if (em === 'new') { $('newProjOpen').click(); return; }
  if (em === 'tutorial') { openTutorial(true); return; }
  const row = e.target.closest('.pcard'); if (!row) return;
  const btn = e.target.closest('button') || (e.target.closest('input') ? null : row.querySelector('[data-act=open]')); if (!btn) return;
  const id = row.dataset.id, act = btn.dataset.act;
  if (act === 'mpupdate') { await updateMultiProject(id); return; }
  if (act === 'open') {
    if (id === S.id) { hideHome(); return; }
    if (!(await canLeaveProject())) return;
    hideHome();
    await busy(async () => { const data = await getProject(id); if (data) await loadProject(data); });
  } else if (act === 'del') {
    if (btn.dataset.armed !== '1') { btn.dataset.armed = '1'; btn.textContent = t('proj.delConfirm'); btn.classList.add('danger'); return; }
    await deleteProject(id);
    if (id === S.id) { resetState(); dirty = false; syncSettingsForm(); updateProjHeader(); setSaveState('saved'); }
    renderProjects(); renderAllProjects();
  } else if (act === 'rename') {
    const b = row.querySelector('h3'), inp = document.createElement('input');
    inp.type = 'text'; inp.value = b.textContent; b.replaceWith(inp); inp.focus(); inp.select();
    const commit = async () => {
      const name = inp.value.trim() || b.textContent;
      const metas = await listProjects(); const m = metas.find((x) => x.id === id);
      if (m) await putMeta({ ...m, name });
      if (id === S.id) { S.name = name; updateProjHeader(); markDirty(); }
      renderProjects();
    };
    inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') inp.blur(); });
    inp.addEventListener('blur', commit, { once: true });
  }
}
$('projList').addEventListener('click', onProjectListClick);
$('mpList').addEventListener('click', onProjectListClick);

$('projBtn').addEventListener('click', () => showHome());
$('projClose').addEventListener('click', () => hideHome());
$('newProjOpen').addEventListener('click', () => { $('newProjForm').hidden = false; $('newProjName').focus(); });
$('newProjCancel').addEventListener('click', () => { $('newProjForm').hidden = true; });
$('newProjForm').addEventListener('submit', (e) => e.preventDefault());
$('newProjBtn').addEventListener('click', async () => {
  if (!$('newProjName').value.trim()) { $('newProjName').focus(); return; }
  $('newProjForm').hidden = true;
  if (!(await canLeaveProject())) return;
  resetState(); S.name = $('newProjName').value.trim() || t('proj.untitled'); $('newProjName').value = '';
  syncSettingsForm(); learnNow(); updateProjHeader(); refreshOtherExamples(); setTimeout(updateTip, 0);
  await saveToDB(); renderProjects(); hideHome();
});
$('openTest').addEventListener('click', async () => { hideHome(); await openTestProject(); });
$('openIdeal').addEventListener('click', async () => { hideHome(); await busy(loadExample); });
$('expProj').addEventListener('click', () => busy(async () => { await flushSave(); await saveFile(`${safe(S.name)}.sedcoretool`, await packageProjects([serialize()]), 'application/zip'); }));   // V0.8: package with full-resolution images
$('cmtBtn').addEventListener('click', openComments);
$('cmtAdd').addEventListener('click', addComment);
$('cmtFilter').addEventListener('change', renderComments);
$('cmtClose').addEventListener('click', () => $('cmtDlg').close());
$('cmtBody').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const box = b.closest('.cmt'), c = S.comments.find((x) => x.id === box.dataset.id); if (!c) return;
  const act = b.dataset.act, now = new Date().toISOString();
  if (act === 'go') {
    const k = S.cores.find((q) => q.sections.some((x) => x.id === c.sec)); if (!k) return;
    if (k.id !== S.curCore) activateCore(k.id);
    const i = S.sections.findIndex((x) => x.id === c.sec); $('cmtDlg').close(); setMode('section'); selectSection(i);
    if (c.x != null) setTimeout(() => { S.view.zoom = Math.max(S.view.zoom, 1); S.view.x = c.x - view.width / 2 / S.view.zoom; S.view.y = c.y - view.height / 2 / S.view.zoom; requestRender(); }, 60);
    return;
  }
  if (act === 'reply') { const inp = box.querySelector('[data-reply]'), text = inp.value.trim(); if (!text) return; const author = $('cmtAuthor').value.trim(); try { localStorage.setItem('corantool.author', author); } catch { /* blocked */ } (c.replies ||= []).push({ id: uid(), author, date: now, text }); c.edited = now; }
  else if (act === 'done') { c.done = !c.done; c.edited = now; }
  else if (act === 'del') { if (!confirm(t('cmt.delAsk'))) return; S.comments = S.comments.filter((x) => x !== c); }
  else if (act === 'delr') { if (!confirm(t('cmt.delAsk'))) return; const rid = b.closest('[data-rid]').dataset.rid; c.replies = c.replies.filter((r) => r.id !== rid); c.edited = now; }
  markDirty(); renderComments(); requestRender();
});
$('openFolder').addEventListener('click', () => { hideHome(); openProjectFolder(); });
$('impProj').addEventListener('change', async (e) => {
  const files = [...e.target.files]; e.target.value = ''; if (!files.length) return;
  hideHome();
  await busy(() => restoreFiles(files));
});

/* ───────────── test core (IODP 397-U1385I-1H) ───────────── */

const TEST_CORE = {
  sections: [[1, 0, 1.5], [2, 1.5, 2.99], [3, 2.99, 4.49], [4, 4.49, 5.98], [5, 5.98, 7.48], [6, 7.48, 8.78]],
  records: [['U1385I-1H/records/397-U1385I-1H_RSC_color.csv', 'Color RSC'], ['U1385I-1H/records/397-U1385I-1H_MS.csv', '@test.ms']],
};

async function openTestProject() {
  if (!(await canLeaveProject())) return;
  await busy(async () => {
    resetState(); loading = true;
    try {
      S.name = t('test.name'); S.id = 'test-u1385'; Object.assign(curCore(), { name: 'U1385I-1H', lat: 37.571, lon: -10.126, waterDepth: 2578, units: 'm' }); renderCoreBar();
      S.notes = 'IODP Expedition 397, Site U1385, Hole I, Core 1H. Section-half images, colour reflectance (RSC) and magnetic susceptibility from the IODP LIMS (web.iodp.tamu.edu/LORE). Images reduced to 50 px/cm.';
      for (const [i, top, bottom] of TEST_CORE.sections) {
        const path = `U1385I-1H/web/397-U1385I-1H-${i}-A_50pxcm.jpg`;
        const bytes = new Uint8Array(await (await fetchAsset(path)).arrayBuffer());
        const { w, h, rgba } = await decodeBytes(bytes, path, 'image/jpeg', { k: 1 });
        const s = newSection({ name: `U1385I-1H-${i}`, file: { name: path.split('/').pop(), type: 'image/jpeg', bytes }, w, h, orig: rgba, full: { w, h } });
        const m = Math.round(w * 0.1);
        Object.assign(s, { top, bottom, units: 'm', roi: { x0: m, y0: 0, x1: w - m, y1: h }, preset: 'levels', filters: { ...FILTER_PRESETS.levels } });
        s.detect = { ...DEFAULT_DETECT, offset: 14, radius: 50, minArea: 20, smooth: 2 };
        enhance(s);
        S.sections.push(s);
      }
      if (S.sections[0]) S.settings.binCm = 100 / pxPerCm(S.sections[0]);
      $('ageText').value = t('test.age'); $('ageUnits').value = 'ka';
      for (const [path, name0] of TEST_CORE.records) { const name = name0.startsWith('@') ? t(name0.slice(1)) : name0;
        const tab = parseTable(await (await fetchAsset(path)).text());
        addRecordFromTable(name, tab, 0, 'depth', tab.headers.map((_, i) => i).slice(1));
      }
      for (const s of S.sections) await withPixels(s, detectSection);
    } catch (e) { toast(t('err.image', { m: e.message || e })); }
    finally { loading = false; }
    syncSettingsForm(); setAge(); selectSection(0, true); learnNow(); updateProjHeader(); refreshOtherExamples(); setTimeout(updateTip, 0); renderRecList(); renderLogPanel(); scheduleLog(0); refreshAllCores();
    await saveToDB();
  });
}

async function startup() {
  storageOK = await storageAvailable();
  setSaveState(storageOK ? 'saved' : 'off');
  if (VIEW_ONLY) { await startWindow(); return; }
  if (storageOK) setTimeout(() => gcImages().catch(() => {}), 15000);   // V0.1: images of deleted sections
  await loadPresets(); await initBackups(); setTimeout(() => checkBackupAge().catch(() => {}), 4000); hideMissingExamples().catch(() => {});
  const firstRun = storageOK && !(await listProjects().catch(() => [])).length;
  showHome();
  if (firstRun) { blankStart = true; return; }   // V31: clean start — the start screen invites to create or open a project (examples on demand)
  if (storageOK) {
    let last = null; try { last = localStorage.getItem('ichantool.last'); } catch { /* storage blocked */ }
    const list = await listProjects().catch(() => []);
    const target = list.find((p) => p.id === last) || list.sort((a, b) => b.updated - a.updated)[0];
    if (target) {
      const data = await getProject(target.id).catch(() => null);
      if (data) { await busy(() => loadProject(data)); return; }
    }
  }
  await openTestProject();
}

/* ───────────── backups ───────────── */
// Three layers: (1) the browser library (IndexedDB, marked persistent); (2) an automatic mirror in a
// folder chosen by the user — ideally one synced by OneDrive/Google Drive/Dropbox — with one current
// file per project, a daily history and the user settings; (3) on-demand full backup files.

let backupDir = null, backupState = 'none', lastBackup = 0, backupTimer = 0, backupPending = false, persisted = false;
let backupPromise = null, backupRevision = 0, backupError = '', choosingBackup = false, reactivatingBackup = false;
const fsSupported = () => typeof window.showDirectoryPicker === 'function';
const today = () => new Date().toISOString().slice(0, 10);

function settingsBundle() {
  return { app: APP, kind: 'settings', version: 1, saved: new Date().toISOString(), presets: userPresets, maxMP: S.settings.maxMP };
}

async function initBackups() {
  try { if (navigator.storage?.persist) persisted = await navigator.storage.persist(); } catch { /* not available */ }
  if (storageOK) {
    backupDir = await getPref('backupDir').catch(() => null);
    lastBackup = (await getPref('lastBackup').catch(() => 0)) || 0;
    if (backupDir?.queryPermission) {
      const perm = await backupDir.queryPermission({ mode: 'readwrite' }).catch(() => 'denied');
      backupState = perm === 'granted' ? 'ok' : 'needs';
    } else if (backupDir) backupState = 'needs';
    if (backupState === 'ok') scheduleBackup();
  }
  renderBackupState();
}

function renderBackupState() {
  const when = lastBackup ? new Date(lastBackup).toLocaleString(lang(), { dateStyle: 'short', timeStyle: 'short' }) : '—';
  const dir = backupDir?.name ? `«${backupDir.name}»` : '';
  const status = t('bk.' + backupState, { dir, when });
  $('bkStatus').textContent = backupError ? t('bk.failure', { status, e: backupError }) : status;
  $('bkStatus').dataset.state = backupState;
  $('bkStatus').setAttribute('aria-busy', String(Boolean(backupPromise)));
  $('bkPersist').textContent = t(persisted ? 'bk.persistOn' : 'bk.persistOff');
  $('bkChoose').hidden = !fsSupported();
  $('bkChoose').toggleAttribute('disabled', choosingBackup);
  $('bkNoFs').hidden = fsSupported();
  $('bkReactivate').hidden = !['needs', 'error'].includes(backupState);
  $('bkReactivateTop').hidden = !['needs', 'error'].includes(backupState);
  $('bkReactivate').toggleAttribute('disabled', reactivatingBackup);
  $('bkReactivateTop').toggleAttribute('disabled', reactivatingBackup);
  if (saveSt === 'saved') setSaveState('saved');
}

/**
 * V0.8: project folder (automatic copy, e.g. in a shared Drive folder): <name>__<id>/project.json, the original images
 * in images/ (each written once) and one copy per day in historial/. Another computer opens it with «Open project folder».
 */
async function writeProjectFolder(root, d) {
  const dir = await root.getDirectoryHandle(`${safe(d.name)}__${d.id}`, { create: true }), imgs = await dir.getDirectoryHandle('images', { create: true });
  const e = projectForExport(d, '', true);
  for (const im of e.images) {
    diagnosticEvent('operation.start', { operation: 'backup.image' });
    const name = im.path.slice('images/'.length);
    const source = await im.get(true);
    const fh = await imgs.getFileHandle(name, { create: true });
    if ((await fh.getFile()).size === source.size) { diagnosticEvent('operation.end', { operation: 'backup.image' }); continue; }
    await source.stream().pipeTo(await fh.createWritable());
    diagnosticEvent('operation.end', { operation: 'backup.image' });
  }
  const text = JSON.stringify(e.json);
  diagnosticEvent('operation.start', { operation: 'backup.manifest' });
  await writeText(dir, 'project.json', text);
  diagnosticEvent('operation.end', { operation: 'backup.manifest' });
  const hist = await dir.getDirectoryHandle('historial', { create: true });
  diagnosticEvent('operation.start', { operation: 'backup.history' });
  await writeText(hist, `${today()}.json`, text);
  await rotateHistory(hist).catch(() => { /* rotation is best effort */ });
  diagnosticEvent('operation.end', { operation: 'backup.history' });
}
/** Open a project folder written by writeProjectFolder (or its parent with several projects). */
async function openProjectFolder() {
  let dir; try { dir = await window.showDirectoryPicker({ id: 'corantool-project', mode: 'read' }); } catch (e) { if (e?.name !== 'AbortError') toast(e.message || String(e)); return; }
  /** @type {FileSystemDirectoryHandle[]} */
  const dirs = [];
  try { await dir.getFileHandle('project.json'); dirs.push(dir); }
  catch {
    for await (const h of dir.values()) if (h.kind === 'directory') {
      const folder = /** @type {FileSystemDirectoryHandle} */ (h);
      try { await folder.getFileHandle('project.json'); dirs.push(folder); } catch { /* not a project */ }
    }
  }
  if (!dirs.length) { toast(t('bk.noFolderProject')); return; }
  const files = [];
  for (const d of dirs) {
    const p = await (await (await d.getFileHandle('project.json')).getFile()).text();
    files.push({ folder: d, text: p });
  }
  await busy(() => restoreFolders(files));
}
async function writeText(dir, name, text) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  try { await w.write(text); await w.close(); }
  catch (error) {
    await w.abort().catch(() => {});
    throw error;
  }
}

function scheduleBackup() {
  if (backupState !== 'ok' && backupState !== 'error') return;
  backupRevision++;
  backupPending = true; clearTimeout(backupTimer); backupTimer = setTimeout(backupNow, 20000);
  if (saveSt === 'saved') setSaveState('saved');
}

let backupRetries = 0;
function backupNow() {
  clearTimeout(backupTimer);
  if (backupPromise) return backupPromise;
  if ((backupState !== 'ok' && backupState !== 'error') || !backupDir) return Promise.resolve();
  const root = backupDir, revision = backupRevision, since = lastBackup, started = Date.now();
  const finishDiagnostic = diagnosticOperation('backup');
  backupPromise = (async () => {
    try {
      // Capture live state before yielding; switching projects must not change this run's source or destination.
      const current = !projectPreview && (S.sections.length || S.records.length) ? serialize() : null;
      const settings = JSON.stringify(settingsBundle(), null, 1);
      if (current) await writeProjectFolder(root, current);
      if (storageOK) for (const m of await listProjects()) {
        if (m.id === current?.id || m.updated < since) continue;
        const d = await getProject(m.id); if (d) await writeProjectFolder(root, d);
      }
      diagnosticEvent('operation.start', { operation: 'backup.settings' });
      await writeText(root, 'sedcoretool_ajustes.json', settings);
      diagnosticEvent('operation.end', { operation: 'backup.settings' });
      if (root !== backupDir) return;
      // Edits saved during I/O belong to a later pass, even when their timestamps precede completion.
      lastBackup = started; backupPending = revision !== backupRevision; backupRetries = 0; backupState = 'ok'; backupError = '';
      await setPref('lastBackup', lastBackup);
    } catch (e) {
      finishDiagnostic(e);
      if (root !== backupDir) return;
      backupPending = true; backupState = 'error'; backupError = e?.message || String(e); console.error(e);
      if (backupRetries++ < 3) backupTimer = setTimeout(backupNow, 60000 * backupRetries);
    }
  })().finally(() => {
    finishDiagnostic();
    backupPromise = null;
    if (root !== backupDir || (backupPending && backupState === 'ok')) backupTimer = setTimeout(backupNow, 20000);
    renderBackupState();
  });
  $('bkStatus').setAttribute('aria-busy', 'true');
  return backupPromise;
}
/** V0.38: warning when the automatic copy is set but has not run for a week (or needs reactivating) and there are changes. */
async function checkBackupAge() {
  if (!backupDir || !storageOK) return;
  const newest = Math.max(0, ...(await listProjects().catch(() => [])).map((m) => m.updated || 0));
  if (newest > lastBackup && (backupState === 'needs' || Date.now() - lastBackup > 7 * 864e5)) toast(t('bk.old', { d: lastBackup ? Math.floor((Date.now() - lastBackup) / 864e5) : '?' }), 9000);
}

async function chooseBackupDirectory() {
  if (choosingBackup) return;
  choosingBackup = true; renderBackupState();
  const finishDiagnostic = diagnosticOperation('backup.choose');
  try {
    const selected = await window.showDirectoryPicker({ id: 'ichantool-backup', mode: 'readwrite' });
    backupDir = selected; lastBackup = 0; backupPending = true; backupRevision++; backupRetries = 0; backupError = '';
    await setPref('backupDir', backupDir).catch(() => {});
    await setPref('lastBackup', 0).catch(() => {});
    backupState = 'ok'; await backupNow();
  } catch (e) { finishDiagnostic(e); if (e?.name !== 'AbortError') toast(e.message || String(e)); }
  finally { finishDiagnostic(); choosingBackup = false; renderBackupState(); }
}
$('bkChoose').addEventListener('click', chooseBackupDirectory);
async function reactivateBackup() {
  if (!backupDir || reactivatingBackup) return;
  reactivatingBackup = true; renderBackupState();
  const finishDiagnostic = diagnosticOperation('backup.reactivate');
  try {
    if (typeof backupDir.requestPermission !== 'function') throw new Error(t('bk.chooseAgain'));
    const perm = await backupDir.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') throw new Error(t('bk.chooseAgain'));
    backupState = 'ok'; backupError = ''; backupRetries = 0;
    await backupNow();
  } catch (e) {
    finishDiagnostic(e);
    backupState = 'needs'; backupPending = true; backupError = e?.message || String(e);
    toast(t('bk.reactivateFailed', { e: backupError }), 10000);
  } finally { finishDiagnostic(); reactivatingBackup = false; renderBackupState(); }
}
for (const id of ['bkReactivate', 'bkReactivateTop']) $(id).addEventListener('click', reactivateBackup);

/* ── V0.8: shareable package (.sedcoretool, before V0.52 .corantool = ZIP with project.json and the original images at full resolution) ── */
const imgExt = (f) => (/\.[a-z0-9]{2,5}$/i.exec(f.name || '')?.[0] || (/png/.test(f.type) ? '.png' : /tif/.test(f.type) ? '.tif' : '.jpg'));
async function projectImageSource(file, ranged = false) {
  if (file.blob) return file.blob;
  if (file.key) {
    const stored = await getImage(file.key, ranged);
    if (stored) return stored;
  }
  if (file.bytes || file.b64) return new Blob([file.bytes ? new Uint8Array(file.bytes) : b64decode(file.b64)]);
  throw new Error(t('err.missingImage', { name: file.name || file.key || '?' }));
}
/** Folder copies use immutable image names so a failed manifest write cannot change the previous save's images. */
function projectForExport(d, prefix = '', immutableImages = false) {
  const p = JSON.parse(JSON.stringify(d, (k, v) => (v instanceof Blob ? undefined : v))), images = [];
  const src = new Map(); for (const c of d.cores || [{ sections: d.sections }]) for (const q of c.sections || []) src.set(q.id, q.file);
  for (const c of p.cores || [{ sections: p.sections }]) for (const q of c.sections || []) {
    const f = src.get(q.id) || q.file;
    const imageId = immutableImages ? `${q.id}__${f.key || uid()}` : q.id;
    const path = `images/${imageId}${imgExt(f)}`;
    images.push({ path: prefix + path, get: (ranged = false) => projectImageSource(f, ranged) });
    q.file = { name: f.name, type: f.type, path };
  }
  return { json: p, images };
}
async function packageProjects(list) {
  const files = [];
  if (list.length === 1) { const e = projectForExport(list[0]); files.push({ name: 'project.json', data: JSON.stringify(e.json) }); for (const im of e.images) files.push({ name: im.path, data: await im.get() }); }
  else list.forEach((d, i) => { const e = projectForExport(d, `p${i + 1}/`); files.push({ name: `p${i + 1}/project.json`, data: JSON.stringify(e.json) }, ...e.images.map((im) => ({ name: im.path, lazy: im.get }))); });
  for (const f of files) if (f.lazy) { f.data = await f.lazy(); delete f.lazy; }
  files.push({ name: 'settings.json', data: JSON.stringify(settingsBundle()) });
  return zipFiles(files);
}
/** One file with every project of the library plus the user settings. */
$('bkFull').addEventListener('click', () => busy(async () => {
  await flushSave();
  const projects = [];
  if (storageOK) for (const m of await listProjects()) { const d = await getProject(m.id); if (d) projects.push(d); }
  else projects.push(serialize());
  await saveFile(`sedcoretool_copia_${today()}.sedcoretool`, await packageProjects(projects), 'application/zip');   // V0.8: one package, images included
}));

/** Restore project files, full backups or settings files (several at once). */
async function restoreFolders(list) {
  const files = list.map((x) => { const f = new Blob([x.text]); f.name = 'project.json'; f.folder = x.folder; return f; });
  return restoreFiles(files);
}
async function restoreFiles(files) {
  let nProj = 0, nPre = 0, rejected = 0;
  /** @type {any} Last project accepted by the asynchronous import callback. */
  let lastLoaded = null;
  const existing = storageOK ? new Set((await listProjects()).map((m) => m.id)) : new Set();
  const addProject = async (p, getBlob = null) => {
    for (const c of p.cores || [{ sections: p.sections }]) for (const q of c.sections || [])   // V0.36: a damaged file is not stored
      for (const k of ['labels', 'exclude']) if (q.w && q.h && q[k] != null && !rleValid(q[k], q.w * q.h)) { rejected++; toast(t('load.failed', { e: t('load.badMask', { s: q.name || '?', k }) }), 9000); return; }
    // Verify and ingest the images before changing any existing project or its pending save.
    await internImages(p, getBlob);
    if (p.id && existing.has(p.id)) {   // V0.8: the same project (work by turns): replace the local version or keep both
      const m = await getMeta(p.id).catch(() => null);
      if (confirm(t('bk.replaceAsk', { n: p.name || APP, a: m?.updated ? new Date(m.updated).toLocaleString() : '?', b: p.saved ? new Date(p.saved).toLocaleString() : '?' }))) {
        if (p.id === S.id) { clearTimeout(saveTimer); if (savePromise) await savePromise; }
        const old = await getProject(p.id).catch(() => null);
        if (old && storageOK) {   // V0.36: the local version is kept as a copy before it is replaced
          const id2 = uid(), name2 = `${old.name || APP} (${t('bk.previous')} ${new Date(m?.updated || Date.now()).toLocaleDateString()})`;
          await putProject({ ...(m || {}), id: id2, name: name2, updated: Date.now() }, { ...old, id: id2, name: name2 });
        }
        const mine = p.id === S.id ? S.comments : old?.comments;
        p.comments = mergeComments(mine || [], p.comments || []);   // comments of both versions are kept
      }
      else { p.id = uid(); p.name = `${p.name || APP} (${t('bk.restored')})`; }
    } else if (!p.id) p.id = uid();
    existing.add(p.id);
    const nSec = p.cores ? p.cores.reduce((n, c) => n + (c.sections || []).length, 0) : (p.sections || []).length;
    if (storageOK) await putProject({ id: p.id, name: p.name, updated: Date.now(), sections: nSec, cores: p.cores?.length || 1, coreNames: p.cores?.map((c) => c.name) }, p);
    if (p.id === S.id) dirty = false;   // Clear pending edits only after the replacement succeeds.
    lastLoaded = p; nProj++;
  };
  for (const f of files) {
    let p;
    const head = new Uint8Array(await f.slice(0, 2).arrayBuffer());
    if (head[0] === 0x50 && head[1] === 0x4b) {   // V0.8: ZIP package (.sedcoretool or .corantool)
      try {
        const z = await unzipBlob(f), get = (base) => async (path) => { const e = z.get(base + path); return e ? e.get() : null; };
        for (const [name, e] of z) {
          if (!name.endsWith('project.json')) continue;
          const q = JSON.parse(await (await e.get()).text()); if (!APP_NAMES.includes(q.app)) continue;
          await addProject(q, get(name.slice(0, -'project.json'.length)));
        }
        if (z.get('settings.json')) nPre += mergePresets(JSON.parse(await (await z.get('settings.json').get()).text()).presets);
      } catch (e) { rejected++; console.error(e); toast(t('err.import', { f: f.name, m: e?.message || String(e) })); }
      continue;
    }
    try { p = JSON.parse(await f.text()); } catch { toast(t('err.project')); continue; }
    if (!APP_NAMES.includes(p.app)) { toast(t('err.project')); continue; }
    const fromFolder = f.folder ? async (path) => { let d = f.folder; const parts = path.split('/'); for (const x of parts.slice(0, -1)) d = await d.getDirectoryHandle(x); return (await d.getFileHandle(parts.at(-1))).getFile(); } : null;
    try {
      if (p.kind === 'project') await addProject(p, fromFolder);
      else if (p.kind === 'backup') { for (const q of p.projects || []) await addProject(q); nPre += mergePresets(p.settings?.presets); }
      else if (p.kind === 'settings') nPre += mergePresets(p.presets);
    } catch (e) { console.error(e); toast(t('err.import', { f: f.name, m: e?.message || e?.name || String(e) })); continue; }
  }
  if (lastLoaded) { if (lastLoaded.id !== S.id && !(await canLeaveProject())) return; if ((await loadProject(lastLoaded)) === false) return; if (!storageOK) dirty = true; }   // V0.36: keep the load error visible
  if (nProj || nPre || !rejected) toast(t('bk.restoredN', { p: nProj, s: nPre }));
}

document.addEventListener('change', (e) => { if (e.target.closest('.side.left:not(#logPanel):not(#geoPanel), .side.right')) markDirty(); });

/* ───────────── V25: styled tooltips for every [title] / [data-tip] (appear after 350 ms, also on keyboard focus) ───────────── */
const hoverTip = document.createElement('div'); hoverTip.className = 'hovertip'; hoverTip.setAttribute('role', 'tooltip'); hoverTip.hidden = true; document.body.append(hoverTip);
let tipTarget = null, tipTimer = 0;
function tipText(el) {
  const v = el.getAttribute('title');
  if (v) { el.dataset.tip = v; el.removeAttribute('title'); if (!el.getAttribute('aria-label') && !el.textContent.trim()) el.setAttribute('aria-label', v); }
  return el.dataset.tip || '';
}
/* V0.19: automatic hover help. A control without its own tip shows t('h.<key>'): key = its data-i18n, the data-i18n of its label, or '#<id>'. */
const TIP_CTL = 'button, select, input, textarea, summary, [role="tab"], label, .slider';
let hoverHelp = true; try { hoverHelp = localStorage.getItem('ichantool.hoverHelp') !== '0'; } catch { /* storage blocked */ }
function autoTip(el) {
  const box = el.closest('label, .slider') || el, ctl = box.querySelector?.('input, select, textarea');
  for (const k of [el.dataset.i18n, box.dataset.i18n, box.querySelector?.('[data-i18n]')?.dataset.i18n, el.id && '#' + el.id, ctl?.id && '#' + ctl.id]) {
    if (!k) continue; const s = t('h.' + k); if (s !== 'h.' + k) return s;
  }
  return '';
}
/** Element whose tip applies at target: the nearest of an explicit tip and (if hover help is on) a control with automatic help. */
function tipEl(target) {
  const own = target.closest?.('[data-tip], [title]'), c = hoverHelp ? target.closest?.(TIP_CTL) : null;
  const auto = c && !c.closest('.hovertip') && autoTip(c) ? c : null;
  if (own && auto) return own.contains(auto) && auto !== own ? auto : own;
  return own || auto;
}
function tipShowFor(el) {
  const txt = tipText(el) || (hoverHelp ? autoTip(el) : ''); if (!txt) return;
  hoverTip.textContent = txt; hoverTip.hidden = false;
  const r = el.getBoundingClientRect(), w = hoverTip.offsetWidth, h = hoverTip.offsetHeight;
  let x = Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2)), y = r.bottom + 8;
  if (y + h > window.innerHeight - 8) y = Math.max(8, r.top - h - 8);
  hoverTip.style.left = x + 'px'; hoverTip.style.top = y + 'px';
}
function tipHide() { clearTimeout(tipTimer); tipTarget = null; hoverTip.hidden = true; }
document.addEventListener('pointerover', (e) => {
  const el = tipEl(e.target);
  if (el === tipTarget) return;
  tipHide(); if (!el || el.closest('.lgrsz.drag')) return;
  if (el.hasAttribute('title')) tipText(el);   // suppress the native tooltip at once
  tipTarget = el; tipTimer = setTimeout(() => tipTarget === el && tipShowFor(el), 350);
});
document.addEventListener('pointerdown', tipHide, true);
document.addEventListener('scroll', tipHide, true);
document.addEventListener('focusin', (e) => { const el = tipEl(e.target); tipHide(); if (el && el.matches(':focus-visible')) { tipTarget = el; tipShowFor(el); } });
document.addEventListener('focusout', tipHide);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') tipHide(); });

// all-projects map: style and extent kept in this browser
let allStyle = { ...MAP_STYLE }, allView = null, allAutoBBox = null;
try { allStyle = { ...MAP_STYLE, ...JSON.parse(localStorage.getItem('ichantool.allMapStyle') || '{}') }; allView = JSON.parse(localStorage.getItem('ichantool.allMapView') || 'null'); } catch { /* storage blocked */ }
function saveAllStyle() { try { localStorage.setItem('ichantool.allMapStyle', JSON.stringify(allStyle)); localStorage.setItem('ichantool.allMapView', JSON.stringify(allView)); } catch { /* storage blocked */ } }
// Project defaults and individual overrides for the site map, local to this browser.
let allMarkers = new Map();
try { allMarkers = new Map(Object.entries(JSON.parse(localStorage.getItem('ichantool.allMarkers') || '{}'))); } catch { /* storage blocked */ }
function saveAllMarkers() {
  try { localStorage.setItem('ichantool.allMarkers', JSON.stringify(Object.fromEntries(allMarkers))); } catch { /* storage blocked */ }
}
const allMapGet = () => ({ style: allStyle, view: allView, auto: allAutoBBox });
let allInterp = { ...INTERP_DEFAULT }, allOff = new Set(), allCoreItems = [], allVl = null;
try { allInterp = { ...INTERP_DEFAULT, ...JSON.parse(localStorage.getItem('ichantool.allInterp') || '{}') }; allOff = new Set(JSON.parse(localStorage.getItem('ichantool.allOff') || '[]')); } catch { /* storage blocked */ }
function saveAllInterp() { try { localStorage.setItem('ichantool.allInterp', JSON.stringify(allInterp)); localStorage.setItem('ichantool.allOff', JSON.stringify([...allOff])); } catch { /* storage blocked */ } }
export function redrawAllMap() {
  allMapSvg = buildAllMap($('amMode').value); $('allMap').innerHTML = allMapSvg;
  mapStyleUI('amStyle', allMapGet, (s2, v) => { allStyle = s2; allView = v; saveAllStyle(); }, redrawAllMap);
  $('amInterp').hidden = $('amMode').value !== 'value';
  if ($('amMode').value === 'value') interpUI('amInterp', () => allInterp, saveAllInterp, redrawAllMap, allVl?.info);
  coreListUI('amCores', allCoreItems, allOff, saveAllInterp, redrawAllMap);
  renderAllMarkers();
}
attachMapZoom($('allMap'), allMapGet, (b) => { allView = b; saveAllStyle(); }, redrawAllMap);

initMultiproxy();

/* ───────────── home: projects, all-projects data and multiproject maps ───────────── */

async function showHome() {
  if (VIEW_ONLY) return;
  await flushSave();
  $('home').hidden = false;
  await renderProjects(); renderBackupState(); await loadLand(); await renderAllProjects();
}
function hideHome() { $('home').hidden = true; requestAnimationFrame(resizeCanvases); setTimeout(updateTip, 0); }

let allLite = [], allMapSvg = '';
async function renderAllProjects() {
  if (!storageOK) { $('allMap').innerHTML = `<p class="note">${t('save.off')}</p>`; return; }
  allLite = (await listLite().catch(() => [])).filter((l) => l.kind !== 'multi').sort((a, b) => a.name.localeCompare(b.name));
  const vars = new Set(), layers = new Set();
  for (const l of allLite) { for (const c of l.cores) Object.keys(c.proxies || {}).forEach((k) => vars.add(k)); for (const L of l.layers || []) if ((l.intervals || []).some((q) => q.layer === L.id)) layers.add(L.name); }
  const fill = (id, list) => { const el = $(id), cur = el.value; el.innerHTML = [...list].sort().map((v) => `<option ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join(''); };
  fill('amVar', vars); fill('amLayer', layers);
  const mode = $('amMode').value;
  $('amVarRow').hidden = mode !== 'value'; $('amLayRow').hidden = mode !== 'class';
  $('mpProjects').innerHTML = allLite.filter((l) => l.cores.length).map((l) => `<label class="chk"><input type="checkbox" data-mp-project="${esc(l.id)}"><span>${esc(l.name)}</span></label>`).join('');
  renderMpCount();
  const shared = sharedCores(allLite), q = coreKey($('homeSearch').value);
  const rows = allLite.flatMap((l) => l.cores.map((c) => ({ l, c }))).filter(({ l, c }) => !q || coreKey(c.name).includes(q) || coreKey(l.name).includes(q))
    .sort((a, b) => coreKey(a.c.name).localeCompare(coreKey(b.c.name)) || a.l.name.localeCompare(b.l.name));
  $('allTable').innerHTML = `<thead><tr><th></th><th>${t('geo.core')}</th><th>${t('home.project')}</th><th>Lat</th><th>Lon</th><th>${t('home.nVars')}</th><th>${t('geo.ivs')}</th><th>${t('home.images')}</th></tr></thead><tbody>${
    rows.map(({ l, c }) => { const n = shared.get(coreKey(c.name))?.size || 1; return `<tr data-p="${l.id}" data-c="${c.id}" style="cursor:pointer"><td><input type="checkbox" class="mpchk" ${mpSel.has(`${l.id}|${c.id}`) ? 'checked' : ''}></td><td class="txt">${esc(c.name)}${n > 1 ? ` <span class="sharedtag" title="${esc(t('home.alsoIn', { p: [...shared.get(coreKey(c.name)).values()].filter((x) => x !== l.name).join(', ') }))}">${t('home.inN', { n })}</span>` : ''}</td><td class="txt">${esc(l.name)}</td><td>${fmt(c.lat, 3)}</td><td>${fmt(c.lon, 3)}</td><td>${Object.keys(c.proxies || {}).length}</td><td>${(l.intervals || []).filter((iv) => iv.core === c.id).length}</td><td>${c.nImages || 0}</td></tr>`; }).join('')}</tbody>`;
  redrawAllMap();
}

/** Map of the cores of every project: sites, mean within-core z-score of a variable, or dominant category of a layer (by name). */
function buildAllMap(mode) {
  const a0 = +$('amA0').value, a1 = +$('amA1').value, pts = [], colors = {}, legend = [];
  allLite.forEach((l, pi) => {
    for (const c of l.cores) {
      if (!validMapCoords(c)) continue;
      const p = { name: c.name, lat: c.lat, lon: c.lon, n: 0, projectId: l.id, project: l.name };
      const ages = coreAges(c);
      if (mode === 'sites') {
        p.n = 1; p.dominant = l.id; p.fraction = null;
        if (!colors[l.id]) {
          const marker = allMarkers.get('project:' + l.id);
          colors[l.id] = marker?.color || GROUP_COLORS[pi % GROUP_COLORS.length];
          legend.push([l.name, colors[l.id], marker?.symbol]);
        }
      }
      else if (mode === 'value') {
        const v = c.proxies?.[$('amVar').value];
        if (v && ages) {
          const ok = v.map((x, i) => [x, ages[i]]).filter(([x, a]) => x != null && a != null);
          const m = ok.reduce((s2, q) => s2 + q[0], 0) / (ok.length || 1), sd = Math.sqrt(ok.reduce((s2, q) => s2 + (q[0] - m) ** 2, 0) / (ok.length || 1)) || 1;
          const win = ok.filter(([, a]) => a >= a0 && a < a1).map(([x]) => (x - m) / sd);
          if (win.length) { p.n = win.length; p.value = win.reduce((s2, x) => s2 + x, 0) / win.length; }
        }
      } else {
        const L = (l.layers || []).find((x) => x.name === $('amLayer').value);
        if (L) {
          const ivs = intervalsOnAxis((l.intervals || []).filter((q) => q.core === c.id && q.layer === L.id && !q.auto), 'age', c), cover = {};
          for (const q of ivs) { const o = Math.min(q.to, a1) - Math.max(q.from, a0); if (o > 0) cover[q.cat] = (cover[q.cat] || 0) + o; }
          const best = Object.entries(cover).sort((x, y) => y[1] - x[1])[0];
          if (best) {
            const cat = L.cats.find((k) => k.id === best[0]); p.n = 1; p.dominant = cat?.name || best[0]; p.fraction = best[1] / (a1 - a0);
            if (!colors[p.dominant]) { colors[p.dominant] = cat?.color || '#999'; legend.push([p.dominant, colors[p.dominant]]); }
          }
        }
      }
      pts.push(p);
    }
  });
  // the same core in several projects is one point: value = mean of the projects that have data; category = first with data
  const groups = new Map();
  for (const p of pts) { const k = 'ck:' + coreKey(p.name); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
  const merged = [...groups.entries()].map(([k, g]) => {
    const withData = g.filter((p) => p.n), base = { ...(withData[0] || g[0]) };
    if (mode === 'value' && withData.length > 1) { base.value = withData.reduce((a, p) => a + p.value, 0) / withData.length; base.n = withData.reduce((a, p) => a + p.n, 0); }
    base.key = k; base.project = [...new Set(g.map((p) => p.project))].join(', '); base.nProjects = new Set(g.map((p) => p.project)).size;
    if (mode === 'sites') {
      const project = allMarkers.get('project:' + base.projectId), core = allMarkers.get(k);
      base.color = core?.color || colors[base.projectId];
      base.symbol = core?.symbol || project?.symbol;
    }
    return base;
  });
  allCoreItems = merged.map((p) => ({ id: p.key, name: p.nProjects > 1 ? `${p.name} (${p.nProjects})` : p.name, lat: p.lat, where: p.project, projectId: p.projectId }));
  pts.length = 0; pts.push(...merged.filter((p) => !allOff.has(p.key)));
  if (!pts.length) return `<p class="note" style="padding:16px">${t('home.noSites')}</p>`;
  const fr = frameRatio('amFrame');
  let auto = mapBBox(pts); auto[2] += 3; if (fr) { auto = fitBBoxAspect(auto, fr, allStyle.proj); if (allView) allView = fitBBoxAspect(allView, fr, allStyle.proj); } allAutoBBox = auto;
  const bbox = allView || auto;
  const nx = 90, ny = Math.max(10, Math.round((90 * (bbox[3] - bbox[1])) / ((bbox[2] - bbox[0]) * Math.cos((((bbox[1] + bbox[3]) / 2) * Math.PI) / 180))));
  const bg = mapBackground(allStyle.bg, bbox, redrawAllMap, allStyle.proj);
  const vl = mode === 'value' ? valueLayer(pts, bbox, allInterp, `z ${$('amVar').value}`) : null; allVl = vl;
  const title = mode === 'sites' ? t('home.mapSites') : mode === 'value' ? t('home.mapValue', { f: $('amVar').value, a0, a1 }) : t('home.mapLayer', { l: $('amLayer').value, a0, a1 });
  const mapFeature = /** @type {HTMLSelectElement} */ ($('amVar')).value;
  return buildMapSVG({ tipFn: (p) => mapTip(p, mode, mapFeature), land: geoLand, bbox, points: pts, mode: mode === 'value' ? 'value' : 'class', colors, legend, title, ...(vl ? { grid: vl.grid, nx: vl.nx, ny: vl.ny, colorFn: vl.colorFn, contours: vl.contours, contourLabels: vl.contourLabels, gridOpacity: vl.gridOpacity, colorbar: vl.colorbar } : {}), subtitle: t('home.mapSub', { n: allLite.length }), note: t('geo.mapNote'), coverageNote: vl?.coverageNote, style: allStyle, bg });
}
function renderAllMarkers() {
  const box = $('amMarkers'), sel = $('amMarkerFor'), prev = sel.value;
  box.hidden = $('amMode').value !== 'sites' || !allCoreItems.length;
  if (box.hidden) return;
  const opt = (id, name) => `<option value="${esc(id)}">${esc(name)}</option>`;
  const projects = allLite.filter((l) => l.cores.some(validMapCoords));
  sel.innerHTML = `<optgroup label="${esc(t('home.tab.projects'))}">${projects.map((l) => opt('project:' + l.id, l.name)).join('')}</optgroup>
    <optgroup label="${esc(t('mp.cores'))}">${allCoreItems.map((c) => opt(c.id, c.name)).join('')}</optgroup>`;
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  syncAllMarkerFields();
}
function syncAllMarkerFields() {
  const key = $('amMarkerFor').value, own = allMarkers.get(key);
  const isProject = key.startsWith('project:');
  const projectId = isProject ? key.slice(8) : allCoreItems.find((c) => c.id === key)?.projectId;
  const project = isProject ? null : allMarkers.get('project:' + projectId);
  const i = allLite.findIndex((l) => l.id === projectId);
  $('amMarkerColor').value = own?.color || project?.color || GROUP_COLORS[Math.max(0, i) % GROUP_COLORS.length];
  $('amMarkerSymbol').innerHTML = `<option value="">${t('mp.markerDefault')}</option>` + MAP_SYMBOLS.map((k) => `<option value="${k}">${t('ms.sym.' + k)}</option>`).join('');
  $('amMarkerSymbol').value = own?.symbol || '';
  $('amMarkerReset').disabled = !own;
}
$('amMarkers').addEventListener('change', (e) => {
  const key = $('amMarkerFor').value;
  if (e.target.id === 'amMarkerFor') { syncAllMarkerFields(); return; }
  const marker = { ...allMarkers.get(key) };
  if (e.target.id === 'amMarkerColor') marker.color = e.target.value;
  else if (e.target.value) marker.symbol = e.target.value;
  else delete marker.symbol;
  if (Object.keys(marker).length) allMarkers.set(key, marker); else allMarkers.delete(key);
  saveAllMarkers(); redrawAllMap();
});
$('amMarkerReset').addEventListener('click', () => {
  allMarkers.delete($('amMarkerFor').value); saveAllMarkers(); redrawAllMap();
});
$('allCtl').addEventListener('change', () => renderAllProjects());
for (const [id, dir] of [['amPrev', -1], ['amNext', 1]]) $(id).addEventListener('click', () => { const a = +$('amA0').value, b = +$('amA1').value, w = b - a; $('amA0').value = a + dir * w; $('amA1').value = b + dir * w; renderAllProjects(); });
$('amPng').addEventListener('click', () => busy(() => exportMapPNG(() => buildAllMap($('amMode').value), 'sedcoretool_mapa_proyectos.png', +$('amPngW').value)));
$('amSvg').addEventListener('click', () => { if (allMapSvg.startsWith('<svg')) saveFile('sedcoretool_mapa_proyectos.svg', allMapSvg, 'image/svg+xml'); });
$('allTable').addEventListener('click', async (e) => {
  const tr = e.target.closest('tr[data-p]'); if (!tr) return;
  const { p, c } = tr.dataset;
  if (e.target.classList.contains('mpchk')) { const k = `${p}|${c}`; if (e.target.checked) mpSel.add(k); else mpSel.delete(k); renderMpCount(); return; }
  if (p !== S.id) { if (!(await canLeaveProject())) return; await busy(async () => { const d = await getProject(p); if (d) await loadProject(d); }); }
  activateCore(c, true); hideHome();
});

/* ───────────── training project, help cards and guided tour (V19) ───────────── */
const TUTORIAL_ID = 'tutorial-corantool';
/** Builds the synthetic training project (examples/tutorial, tools/make_tutorial.py): 7 fictitious cores, intervals and one core image with half of its traces labelled. */
async function buildTutorialProject() {
  const txt = async (f) => (await fetchAsset('tutorial/' + f)).text();
  if (!(await canLeaveProject())) return;
  resetState();
  S.id = TUTORIAL_ID; S.name = t('tut.name'); S.kind = 'tutorial'; S.notes = t('tut.notes'); S.settings.tips = true;
  const tab = parseTable(await txt('cores.csv')), H = tab.headers, ix = (n) => H.indexOf(n), P = H.slice(5);
  const cores = coresFromLongTable(tab, { core: ix('core'), lat: ix('lat'), lon: ix('lon'), depth: ix('depth_cm'), age: ix('age_ka'), proxies: P.map(ix) });
  const am = parseTable(await txt('age_models.csv'));
  S.cores = [];
  for (const c of cores) {
    c.units = 'cm'; c.ageText = am.rows.filter((r) => r[0] === c.name).map((r) => `${r[1]},${r[2]}`).join('\n');
    addImported(c, 'tutorial', 'tut-' + c.name);
  }
  applyCatalogue(S.cores, parseTable(await txt('catalogue.csv')), { core: 0, lat: 1, lon: 2, wd: 3 });
  for (const c of S.cores) c.notes = t('tut.coreNote');
  const g = S.geo;
  addNamedIntervals(intervalsFromTable(parseTable(await txt('intervals_depth.csv')), { core: 0, from: 1, to: 2, layer: 3, values: [4] }), 'depth');
  addNamedIntervals(intervalsFromTable(parseTable(await txt('intervals_age.csv')), { core: 0, from: 1, to: 2, layer: 3, values: [4] }), 'age');
  const col = { Sapropel: '#4a2f63', ORL: '#2b6f8f', 'Fuera de capa orgánica': '#d9d2bf', Turbidita: '#c07a2c', Tefra: '#9a9a9a', Holoceno: '#f2c14e', 'Younger Dryas': '#5b8bd9', 'Bølling-Allerød': '#e07a3f', HS1: '#8fc1e3', 'Último Máximo Glacial': '#2c4f8c' };
  for (const l of g.layers) for (const k of l.cats) if (col[k.name]) k.color = col[k.name];
  const org = g.layers.find((l) => l.name === 'Capas orgánicas');
  Object.assign(g.settings, { features: ['XRF Ti/Ca', 'XRF Ba/Ti', 'XRF Mn/Ti', 'XRF Fe/Ca', 'XRF Zr/Rb', 'XRF Br/Cl', 'TOC_pct', 'Bentonicos_bajo_O2_pct', 'Bioturbacion_pct'],
    logs: ['XRF Ba/Ti', 'TOC_pct', 'XRF Ti/Ca'], axis: 'age', step: 0.5, scaling: 'core', missing: 'mean', target: org?.id || g.settings.target, useLayers: [] });
  g.map = { ...g.map, a0: 6, a1: 10, mode: 'class', style: { ...MAP_STYLE, symbol: 'diamond' } };
  // core image of ENT-03 with half of the true traces labelled
  const core = S.cores.find((c) => c.name === 'ENT-03');
  activateCore(core.id, true);
  const bytes = new Uint8Array(await (await fetchAsset('tutorial/tutorial_core.jpg')).arrayBuffer());
  const truth = JSON.parse(await txt('tutorial_truth.json'));
  const { w, h, rgba } = await decodeBytes(bytes, 'tutorial_core.jpg', 'image/jpeg', { k: 1 });
  const s = newSection({ name: 'ENT-03 · 0-150 cm', file: { name: 'tutorial_core.jpg', type: 'image/jpeg', bytes }, w, h, orig: rgba, full: { w, h } });
  s.top = truth.top_cm; s.bottom = truth.bottom_cm; s.units = 'cm';
  s.detect = { ...DEFAULT_DETECT, method: 'global', polarity: 'dark', threshold: 105, minArea: 12, smooth: 1 };
  S.sections.push(s); syncSettingsForm(); selectSection(S.sections.length - 1, true);
  await detectSection(s);
  truth.traces.forEach((q, i) => {
    if (i % 2) return; // the other half stays for the suggestions
    const cls = S.classes.find((c) => c.name === q.taxon); if (!cls) return;
    const id = topLab(s, Math.round(q.y) * s.w + Math.round(q.x));
    const o = id > 0 ? s.objects.get(id) : null; if (o && !o.cls) o.cls = cls.id;
  });
  renderCoreBar(); refreshAllCores(); updateProjHeader(); renderRecList(); setAge(); learnNow(); geoReset(); geoMarkDirty();
  await saveToDB();
}
async function openTutorial(withTour = true) {
  hideHome();
  await busy(async () => {
    const have = (await listProjects().catch(() => [])).some((m) => m.id === TUTORIAL_ID);
    if (have) { const d = await getProject(TUTORIAL_ID); if (d) await loadProject(d); } else await buildTutorialProject();
  });
  setMode('section'); updateTip();
  if (withTour) startTour(0);
}
$('openTutorial').addEventListener('click', () => openTutorial(true));

$('tourBtn').addEventListener('click', () => { $('help').close(); startTour(0); });
$('hoverHelpToggle').checked = hoverHelp;
$('hoverHelpToggle').addEventListener('change', (e) => { hoverHelp = e.target.checked; tipHide(); try { localStorage.setItem('ichantool.hoverHelp', hoverHelp ? '1' : '0'); } catch { /* storage blocked */ } });
$('tipsToggle').addEventListener('change', (e) => { S.settings.tips = e.target.checked; markDirty(); updateTip(); });

/* help card of the current tab */
function tipContext() {
  if (!$('home').hidden) return null;
  if (mode === 'section') return 'section.' + ($('sideTabs').querySelector('[aria-selected="true"]')?.dataset.tab || 'classes');
  if (mode === 'geo') return 'geo.' + (S.geo.view.tab || 'logs');
  return mode;
}
export function updateTip() {
  const box = $('tipCard'), on = S.settings.tips ?? S.kind === 'tutorial', ctx = tipContext();
  $('tipsToggle').checked = !!on;
  if (!on || !ctx || tourStep >= 0) { box.hidden = true; return; }
  box.innerHTML = `<b>💡 ${t('tip.title')}</b><div>${t('tip.' + ctx)}</div><div class="row"><button class="btn small primary" data-tipact="tour">${t('tip.tour')}</button><button class="btn small ghost" data-tipact="hide">${t('tip.hide')}</button></div>`;
  box.hidden = false;
}
$('tipCard').addEventListener('click', (e) => {
  const a = e.target.closest('[data-tipact]')?.dataset.tipact; if (!a) return;
  if (a === 'hide') { S.settings.tips = false; markDirty(); updateTip(); }
  else { const ctx = tipContext(), k = TOUR.findIndex((st) => st.ctx === ctx || (ctx && st.ctx && ctx.startsWith(st.ctx))); startTour(Math.max(0, k)); }
});

/* guided tour: each step highlights one element (switching mode, side tab or start screen first) */
const TOUR = [
  { sel: '#projBtn' }, { sel: '.corebar' }, { mode: 'section', ctx: 'section', sel: '#modeSection' },
  { mode: 'section', sel: '#addImg' }, { mode: 'section', sel: '#fPreset' }, { mode: 'section', sel: '#detectBtn' }, { mode: 'section', sel: '#tools' },
  { mode: 'section', pane: 'classes', ctx: 'section.classes', sel: '#classList' }, { mode: 'section', pane: 'object', ctx: 'section.object', sel: '#objInfo', pick: true },
  { mode: 'section', pane: 'learn', ctx: 'section.learn', sel: '#mlOpen' }, { mode: 'section', pane: 'results', ctx: 'section.results', sel: '#resSummary' },
  { mode: 'log', ctx: 'log', sel: '#logTracks' }, { mode: 'data', ctx: 'data', sel: '#dataView' },
  { mode: 'geo', geoTab: 'logs', ctx: 'geo', sel: '#geoPanel' }, { mode: 'geo', geoTab: 'logs', sel: '#geoLayerSel' }, { mode: 'geo', geoTab: 'logs', sel: '#geoFeats' },
  { mode: 'geo', geoTab: 'logs', sel: '#geoTrainBtn' }, { mode: 'geo', geoTab: 'logs', sel: '#geoLogSvg' }, { mode: 'geo', geoTab: 'map', ctx: 'geo.map', sel: '#geoMapSvg' },
  { mode: 'geo', geoTab: 'model', ctx: 'geo.model', sel: '#geoModelOut', train: true }, { mode: 'fig', ctx: 'fig', sel: '#figPanel' },
  { home: 'projects', sel: '#projList' }, { home: 'all', sel: '#allMap' }, { home: 'all', sel: '.mpbox' }, { sel: '#helpBtn' },
];
// texts follow the order above: tour.<i>.t/b were written for the old order (home steps first), remapped here
const TOUR_TEXT = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 24];
let tourStep = -1;
function startTour(k = 0) { tourStep = k; $('tipCard').hidden = true; showTourStep(); }
function endTour() { tourStep = -1; $('tour').hidden = true; updateTip(); }
async function showTourStep() {
  const st = TOUR[tourStep]; if (!st) { endTour(); return; }
  if (st.home) { if ($('home').hidden) await showHome(); setHomeTab(st.home); } else if (!$('home').hidden) hideHome();
  if (st.mode && mode !== st.mode) setMode(st.mode);
  if (st.pane) showTab(st.pane);
  if (st.geoTab && S.geo.view.tab !== st.geoTab) { S.geo.view.tab = st.geoTab; renderGeo(); }
  if (st.train && !geoRT.model && !$('geoTrainBtn').disabled) { await geoTrain(); renderGeo(); }
  if (st.pick && !S.selected) { const s = sec(), o = s && [...s.objects.values()].find((q) => !q.cls && q.bbox && q.feat); if (o) { centerOn(o); select(o.id); showTab('object'); } }
  await new Promise((r) => setTimeout(r, st.home ? 700 : 260));
  const el = document.querySelector(st.sel); el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  const r = el?.getBoundingClientRect(), ov = $('tour'), hl = ov.querySelector('.tourhl'), box = ov.querySelector('.tourbox');
  ov.hidden = false;
  if (r && r.width && r.height) Object.assign(hl.style, { display: 'block', left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${Math.min(r.height, innerHeight - 24) + 12}px` });
  else hl.style.display = 'none';
  box.innerHTML = `<div class="tourn">${tourStep + 1} / ${TOUR.length}</div><h3>${t(`tour.${TOUR_TEXT[tourStep]}.t`)}</h3><div>${t(`tour.${TOUR_TEXT[tourStep]}.b`)}</div>
    <div class="row" style="justify-content:space-between"><button class="btn small ghost" data-tour="end">${t('tour.end')}</button><span class="row"><button class="btn small" data-tour="prev" ${tourStep ? '' : 'disabled'}>◀ ${t('tour.prev')}</button><button class="btn small primary" data-tour="next">${tourStep === TOUR.length - 1 ? t('tour.finish') : t('tour.next') + ' ▶'}</button></span></div>`;
  // bubble beside the element (below if there is room, else above, else centred)
  const bw = Math.min(380, innerWidth - 24); box.style.width = bw + 'px';
  const bh = box.offsetHeight || 220;
  let left = r && r.width ? Math.min(Math.max(12, r.left), innerWidth - bw - 12) : (innerWidth - bw) / 2, top;
  if (r && r.width && r.bottom + bh + 18 < innerHeight) top = r.bottom + 14;
  else if (r && r.width && r.top - bh - 18 > 0) top = r.top - bh - 14;
  else if (r && r.width && r.right + bw + 24 < innerWidth) { left = r.right + 16; top = Math.max(12, Math.min(r.top, innerHeight - bh - 12)); }
  else top = (innerHeight - bh) / 2;
  Object.assign(box.style, { left: `${left}px`, top: `${top}px` });
}
$('tour').addEventListener('click', (e) => {
  const a = e.target.closest('[data-tour]')?.dataset.tour; if (!a) return;
  if (a === 'end') endTour(); else { tourStep += a === 'next' ? 1 : -1; if (tourStep >= TOUR.length) endTour(); else showTourStep(); }
});
window.addEventListener('keydown', (e) => {
  if (tourStep < 0 || e.target.closest('input, textarea, select')) return;
  if (e.key === 'Escape') endTour(); else if (e.key === 'ArrowRight') { tourStep++; if (tourStep >= TOUR.length) endTour(); else showTourStep(); } else if (e.key === 'ArrowLeft' && tourStep > 0) { tourStep--; showTourStep(); }
});
window.addEventListener('resize', () => { if (tourStep >= 0) showTourStep(); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('home').hidden && tourStep < 0 && !document.querySelector('dialog[open]') && S.cores.length) hideHome(); });

/* ───────────── models and training dialog (V18): guide, method and parameters, evaluation, examples ───────────── */
/** Small cached image of a labelled trace (JPEG data URL), for the example galleries. */
function thumbOf(s, o) {
  if (o._thumb) return o._thumb;
  try { if (s.enh && o.bbox) o._thumb = traceCanvas(s, o, 64, 'enh', true).canvas.toDataURL('image/jpeg', 0.7); } catch { /* try again next time */ }
  return o._thumb || null;
}
let mlTab = 'guide', mlScope = null, mlOtherProj = '';
const mlPicked = new Set();
function openMl(tab) { if (tab) mlTab = tab; mlScope ||= S.settings.clfScope || 'project'; renderMl(); if (!$('mlDlg').open) $('mlDlg').showModal(); }
$('mlOpen').addEventListener('click', () => openMl());
$('mlClose').addEventListener('click', () => $('mlDlg').close());
$('mlTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-mltab]'); if (b) { mlTab = b.dataset.mltab; renderMl(); } });

function renderMl() {
  for (const b of document.querySelectorAll('[data-mltab]')) b.setAttribute('aria-selected', String(b.dataset.mltab === mlTab));
  const box = $('mlBody');
  if (mlTab === 'guide') box.innerHTML = t('ml.guide') + mlRecommendation();
  else if (mlTab === 'train') box.innerHTML = mlTrainHTML();
  else if (mlTab === 'examples') box.innerHTML = mlExamplesHTML();
  else box.innerHTML = mlOthersHTML();
}

/** Plain-language recommendation from the counts and, if done, from the last evaluation. */
function mlRecommendation() {
  const sets = mlSets(), cnt = (sc) => { const c = {}; for (const e of sets[sc]) c[e.y] = (c[e.y] || 0) + 1; return c; };
  const few = Object.entries(cnt('project')).filter(([, n]) => n < 10).map(([k]) => k);
  let h = `<h3>${t('ml.rec')}</h3><ul>`;
  if (!sets.project.length) h += `<li>${t('ml.recNone')}</li>`;
  else {
    h += `<li>${t('ml.recCounts', { c: sets.core.length, p: sets.project.length, a: sets.all.length })}</li>`;
    if (few.length) h += `<li>${t('ml.recFew', { l: few.map(esc).join(', ') })}</li>`;
    if (mlEval?.best) { const b = mlEval.best; h += `<li><b>${t('ml.recBest', { s: t('l.scope.' + b.scope), m: t('ml.m.' + b.method), v: Math.round(b.balanced * 100) })}</b> ${b.close ? t('ml.recClose') : ''}</li>`; }
    else h += `<li>${t('ml.recEval')}</li>`;
  }
  return h + '</ul>';
}

function mlTrainHTML() {
  const m = { ...ML_DEFAULT, ...(S.settings.ml || {}) }, num = (k, a, b, st) => `<input type="number" data-ml="${k}" min="${a}" max="${b}" step="${st}" value="${m[k]}" style="width:80px">`;
  const methods = ['knn', 'rf', 'nb'].map((k) => `<label class="mlm ${m.method === k ? 'on' : ''}"><input type="radio" name="mlMethod" data-ml="method" value="${k}" ${m.method === k ? 'checked' : ''}><b>${t('ml.m.' + k)}</b><span class="note">${t('ml.d.' + k)}</span></label>`).join('');
  const params = m.method === 'knn' ? `<label class="f"><span>${t('ml.p.k')}</span>${num('k', 1, 25, 1)}</label><label class="f"><span>${t('ml.p.weights')}</span><select data-ml="weights"><option value="distance" ${m.weights === 'distance' ? 'selected' : ''}>${t('ml.p.wDist')}</option><option value="uniform" ${m.weights === 'uniform' ? 'selected' : ''}>${t('ml.p.wUni')}</option></select></label>`
    : m.method === 'rf' ? `<label class="f"><span>${t('ml.p.trees')}</span>${num('trees', 10, 500, 10)}</label><label class="f"><span>${t('ml.p.depth')}</span>${num('maxDepth', 2, 30, 1)}</label><label class="f"><span>${t('ml.p.leaf')}</span>${num('minLeaf', 1, 20, 1)}</label><label class="chk"><input type="checkbox" data-ml="balanced" ${m.balanced ? 'checked' : ''}><span>${t('ml.p.balanced')}</span></label>`
      : `<label class="f"><span>${t('ml.p.priors')}</span><select data-ml="priors"><option value="uniform" ${m.priors === 'uniform' ? 'selected' : ''}>${t('ml.p.pUni')}</option><option value="empirical" ${m.priors === 'empirical' ? 'selected' : ''}>${t('ml.p.pEmp')}</option></select></label>`;
  let ev = '';
  if (mlEval) {
    const r = mlEval.res, cell = (sc, me) => { const v = r[sc]?.[me]; const on = mlEval.best && mlEval.best.scope === sc && mlEval.best.method === me; return `<td class="${on ? 'on' : ''}">${v?.balanced == null ? '—' : `${Math.round(v.balanced * 100)}% <span class="note">(${Math.round(v.accuracy * 100)}%)</span>`}</td>`; };
    const b = mlEval.best, cm = b ? r[b.scope][b.method] : null;
    const r0 = Object.values(r)[0]?.knn || {};   // V0.37: validation scheme and optimism warning
    ev = `<h3>${t('ml.evalTitle')}</h3><p class="note">${t('ml.evalNote', { n: mlEval.nTest, w: t(mlEval.on === 'core' ? 'ml.onCore' : 'ml.onProject') })}</p>
      <p class="note ${r0.scheme === 'examples' ? 'warn' : ''}">${t('ml.scheme.' + (r0.scheme || 'groups'), { g: r0.nGroups ?? '?', f: r0.folds ?? '?', u: t('ml.cvGroup.' + (S.settings.ml?.cvGroup || 'section')).toLowerCase() })} ${t('ml.optimistic')}</p>
      <table class="dtable mtab"><thead><tr><th></th>${['knn', 'rf', 'nb'].map((me) => `<th>${t('ml.m.' + me)}</th>`).join('')}</tr></thead><tbody>${CLF_SCOPES.map((sc) => `<tr><td class="txt">${t('l.scope.' + sc)}</td>${['knn', 'rf', 'nb'].map((me) => cell(sc, me)).join('')}</tr>`).join('')}</tbody></table>
      ${b ? `<p>${t('ml.recBest', { s: t('l.scope.' + b.scope), m: t('ml.m.' + b.method), v: Math.round(b.balanced * 100) })} ${b.close ? t('ml.recClose') : ''} <button class="btn small primary" id="mlUseBest">${t('ml.useBest')}</button></p>
      <details><summary>${t('ml.cm')}</summary><p class="note">${t('ml.cmNote')}</p><div class="tablewrap"><table class="dtable mtab"><thead><tr><th>${t('ml.real')} \\ ${t('ml.pred')}</th>${cm.classes.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${cm.classes.map((c, i) => `<tr><td class="txt">${esc(c)}</td>${cm.cm[i].map((v, j) => `<td class="${i === j ? 'on' : ''}">${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>` : ''}`;
  }
  const fset = m.features || 'shape', pend = fset === 'vision' ? pendingEmb() : 0;   // V0.17: input vectors
  const feats = `<h3>${t('vis.title')}</h3><div class="mlmethods">${['shape', 'vision'].map((k) => `<label class="mlm ${fset === k ? 'on' : ''}"><input type="radio" name="mlFeat" data-ml="features" value="${k}" ${fset === k ? 'checked' : ''}><b>${t('vis.f.' + k)}</b><span class="note">${t('vis.d.' + k)}</span></label>`).join('')}</div>`
    + (fset === 'vision' ? `<p class="note">${VIS ? t('vis.ready', { n: esc(VIS.src) }) + (VIS.sha256 ? ` <span class="note" title="SHA-256 ${VIS.sha256}">(${VIS.sha256.slice(0, 12)}…)</span>` : '') : t('vis.none', { mb: VISION_MODEL.mb })} ${t('vis.pending', { n: pend })}</p><div class="row">${VIS ? '' : `<button class="btn small primary" id="visDl">${t('vis.dl', { mb: VISION_MODEL.mb })}</button><label class="btn small file"><span>${t('vis.file')}</span><input type="file" id="visFile" accept=".onnx"></label>`}<button class="btn small" id="visCalc" ${VIS && pend ? '' : 'disabled'}>${t('vis.calc', { n: pend })}</button></div>` : '');
  return `${feats}<h3>${t('ml.tab.train')}</h3><p class="note">${t('ml.trainIntro')}</p><div class="mlmethods">${methods}</div><div class="row" style="align-items:end;gap:12px">${params}
    <label class="f"><span>${t('l.novelty')}</span><input type="number" data-ml="novelty" min="1" max="8" step="0.5" value="${S.settings.novelty}" style="width:80px"></label></div>
    <p class="note">${t('ml.paramHelp.' + m.method)} ${t('ml.noveltyHelp')}</p>
    <div class="row"><button class="btn primary" id="mlEvalBtn">${t('ml.eval')}</button><label class="f"><span>${t('ml.cvGroup')}</span><select data-ml="cvGroup">${['section', 'core'].map((g) => `<option value="${g}" ${(m.cvGroup || 'section') === g ? 'selected' : ''}>${t('ml.cvGroup.' + g)}</option>`).join('')}</select></label><span class="note">${t('ml.evalHint')}</span></div>${ev}
    <h3>${t('ft.title')}</h3><p class="note">${t('ft.intro')}</p>${holdoutHTML()}
    <div class="row"><button class="btn primary" id="mlFinalBtn" ${S.cores.some((c) => c.holdout) ? '' : 'disabled'}>${t('ft.run')}</button><span class="note">${t('ft.ichnoHint')}</span></div>${finalTestsHTML('ichno')}`;   // V0.49
}

function runMlEval() {
  const sets = mlSets(), cur = S.cores.find((c) => c.id === S.curCore);
  const coreTest = ownExamples(cur ? [cur] : []), on = coreTest.length >= 10 && new Set(coreTest.map((e) => e.y)).size >= 2 ? 'core' : 'project';
  const test = on === 'core' ? coreTest : sets.project;
  if (test.length < 6 || new Set(test.map((e) => e.y)).size < 2) { toast(t('ml.evalNeed')); return; }
  const byCore = (S.settings.ml?.cvGroup || 'section') === 'core', group = (e) => (e.g == null ? null : byCore ? String(e.g).split('|').slice(0, 2).join('|') : e.g);   // V0.37
  const res = evaluateModels({ test, pools: sets, methods: ['knn', 'rf', 'nb'], opt: mlOpt(), k: 5, seed: 42, group });
  // best = highest balanced accuracy; when another option is within 3 points, the simpler one is preferred (k-NN, then naive Bayes, then RF; this core, then project)
  const order = { knn: 0, nb: 1, rf: 2 }, list = [];
  for (const sc of CLF_SCOPES) for (const me of ['knn', 'rf', 'nb']) if (res[sc][me].balanced != null) list.push({ scope: sc, method: me, balanced: res[sc][me].balanced });
  list.sort((a, b) => b.balanced - a.balanced);
  let best = list[0];
  if (best) { const near = list.filter((q) => best.balanced - q.balanced <= 0.03).sort((a, b) => order[a.method] - order[b.method] || CLF_SCOPES.indexOf(a.scope) - CLF_SCOPES.indexOf(b.scope)); best = { ...near[0], close: near.length > 1 }; }
  mlEval = { res, best, on, nTest: test.length, when: Date.now() };
  learnNow(); renderMl();
}

function mlExamplesHTML() {
  const sc = mlScope || 'project', sets = mlSets();
  let list = sc === 'core' ? ownExamples(S.cores.filter((c) => c.id === S.curCore), true) : ownExamples(S.cores, true);
  const lib = S.library.map((e, i) => ({ key: e.key || `lib|${i}`, y: e.name, lib: e, libIndex: i, thumb: e.thumb || null, where: `${t('ml.library')}${e.from ? ': ' + e.from : ''}` }));
  list = list.map((e) => ({ ...e, thumb: thumbOf(e.s, e.o), where: `${e.c.name} · ${e.s.name}`, excluded: !!e.o.nt })).concat(lib);
  if (sc === 'all') list = list.concat(otherExamples.filter((e) => !list.some((q) => q.key === e.key)).map((e) => ({ ...e, other: true, excluded: mlExcluded.has(e.key) })));
  const by = {}; for (const e of list) (by[e.y] ||= []).push(e);
  const used = sets[sc].length;
  const card = (e) => `<figure class="mlx ${e.excluded ? 'off' : ''}" data-key="${esc(e.key)}">${e.thumb ? `<img src="${e.thumb}" alt="" ${e.o ? 'data-go="1"' : ''}>` : `<div class="noimg">${t('ml.noImg')}</div>`}
    <figcaption title="${esc(e.where)}">${esc(e.where)}</figcaption>
    <div class="row">${e.lib ? `<button class="btn small ghost" data-act="libdel">${t('ml.remove')}</button>` : `<label class="chk"><input type="checkbox" data-act="use" ${e.excluded ? '' : 'checked'}><span>${t('ml.use')}</span></label>`}</div></figure>`;
  return `<div class="row" style="align-items:end"><label class="f"><span>${t('ml.exScope')}</span><select id="mlScopeSel">${CLF_SCOPES.map((k) => `<option value="${k}" ${k === sc ? 'selected' : ''}>${t('l.scope.' + k)}</option>`).join('')}</select></label>
    <span class="note">${t('ml.exCount', { n: used, t: list.length })}</span></div><p class="note">${t('ml.exHelp')}</p>
    ${Object.keys(by).sort().map((y) => `<h3>${esc(y)} <span class="note">${by[y].filter((e) => !e.excluded).length}/${by[y].length}${by[y].filter((e) => !e.excluded).length < 10 ? ' · ' + t('ml.fewWarn') : ''}</span></h3><div class="mlgrid">${by[y].map(card).join('')}</div>`).join('') || `<p class="note">${t('l.none')}</p>`}`;
}

function mlOthersHTML() {
  const projs = [...new Map(otherExamples.map((e) => [e.project, e.where.split(' · ')[0]])).entries()];
  if (!projs.length) return `<p class="note">${t('ml.othersNone')}</p>`;
  if (!projs.some(([id]) => id === mlOtherProj)) mlOtherProj = projs[0][0];
  const inLib = new Set(S.library.map((e) => e.key)), list = otherExamples.filter((e) => e.project === mlOtherProj);
  const by = {}; for (const e of list) (by[e.y] ||= []).push(e);
  return `<p class="note">${t('ml.othersIntro')}</p><div class="row" style="align-items:end"><label class="f"><span>${t('home.project')}</span><select id="mlOtherSel">${projs.map(([id, n]) => `<option value="${id}" ${id === mlOtherProj ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
    <button class="btn small" id="mlPickAll">${t('mp.all')}</button><button class="btn small" id="mlPickNone">${t('mp.none')}</button><button class="btn small primary" id="mlAddLib">${t('ml.addLib', { n: mlPicked.size })}</button></div>
    ${Object.keys(by).sort().map((y) => `<h3>${esc(y)} <span class="note">${by[y].length}</span></h3><div class="mlgrid">${by[y].map((e) => `<figure class="mlx ${inLib.has(e.key) ? 'off' : ''}" data-key="${esc(e.key)}">${e.thumb ? `<img src="${e.thumb}" alt="">` : `<div class="noimg">${t('ml.noImg')}</div>`}<figcaption>${esc(e.where)}</figcaption>
      <div class="row">${inLib.has(e.key) ? `<span class="note">${t('ml.inLib')}</span>` : `<label class="chk"><input type="checkbox" data-act="pick" ${mlPicked.has(e.key) ? 'checked' : ''}><span>${t('ml.pick')}</span></label>`}</div></figure>`).join('')}</div>`).join('')}`;
}

$('mlBody').addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.ml) {
    const k = el.dataset.ml, v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? +el.value : el.value;
    if (k === 'novelty') { S.settings.novelty = v; $('novelty').value = v; $('novOut').textContent = '×' + v; }
    else S.settings.ml = { ...ML_DEFAULT, ...(S.settings.ml || {}), [k]: v };
    if (k === 'method') mlEval = mlEval && { ...mlEval };
    if (k === 'cvGroup') mlEval = null;
    if (k === 'features') { mlEval = null; for (const x of S.cores.flatMap((c) => c.sections)) for (const o of x.objects.values()) o._pv = 0; if (v === 'vision' && !VIS) loadVision(); }
    markDirty(); learnNow(); renderMl(); return;
  }
  if (el.id === 'visFile') { const f = el.files[0]; el.value = ''; if (f) loadVision(f); return; }
  if (el.id === 'mlScopeSel') { mlScope = el.value; renderMl(); return; }
  if (el.id === 'mlOtherSel') { mlOtherProj = el.value; mlPicked.clear(); renderMl(); return; }
  const fig = el.closest('.mlx'); if (!fig) return;
  const key = fig.dataset.key;
  if (el.dataset.act === 'use') {
    const own = ownExamples(S.cores, true).find((q) => q.key === key);
    if (own) { own.o.nt = !el.checked; markDirty(); }
    else { if (el.checked) mlExcluded.delete(key); else mlExcluded.add(key); setPref('ml.excluded', [...mlExcluded]).catch(() => {}); }
    learnNow();
  } else if (el.dataset.act === 'pick') { if (el.checked) mlPicked.add(key); else mlPicked.delete(key); const b = $('mlAddLib'); if (b) b.textContent = t('ml.addLib', { n: mlPicked.size }); }
});
$('mlBody').addEventListener('click', (e) => {
  const el = e.target;
  if (el.id === 'mlEvalBtn') { busy(async () => runMlEval()); return; }
  if (el.id === 'mlFinalBtn') { if (confirm(t('ft.confirm'))) runFinalIchno(); return; }
  if (el.id === 'visDl') { loadVision(null, true); return; }
  if (el.id === 'visCalc') { busy(async () => { const n = await computeEmbeddings(S.cores.flatMap((c) => c.sections), (k, tot) => { $('busy').textContent = t('vis.progress', { k, n: tot }); }); $('busy').textContent = t('busy'); toast(t('vis.done', { n })); renderMl(); }); return; }
  if (el.id === 'mlUseBest' && mlEval?.best) { S.settings.clfScope = mlEval.best.scope; S.settings.ml = { ...ML_DEFAULT, ...(S.settings.ml || {}), method: mlEval.best.method }; markDirty(); learnNow(); renderMl(); toast(t('ml.applied')); return; }
  if (el.id === 'mlPickAll') { for (const q of otherExamples) if (q.project === mlOtherProj) mlPicked.add(q.key); renderMl(); return; }
  if (el.id === 'mlPickNone') { mlPicked.clear(); renderMl(); return; }
  if (el.id === 'mlAddLib') {
    const have = new Set(S.library.map((q) => q.key));
    for (const q of otherExamples) if (mlPicked.has(q.key) && !have.has(q.key)) S.library.push({ key: q.key, name: q.y, x: q.x, xv: q.xv, thumb: q.thumb, from: q.where, core: q.core });
    if (!S.classes.length) return;
    for (const q of S.library) if (!S.classes.some((c) => c.name === q.name)) S.classes.splice(S.classes.length - 1, 0, { id: 'c' + uid(), name: q.name, color: GROUP_COLORS[S.classes.length % GROUP_COLORS.length], counts: true });
    toast(t('ml.added', { n: mlPicked.size })); mlPicked.clear(); markDirty(); renderClasses(); learnNow(); return;
  }
  const fig = el.closest('.mlx'); if (!fig) return;
  if (el.dataset.act === 'libdel') { const i = S.library.findIndex((q, k) => (q.key || `lib|${k}`) === fig.dataset.key); if (i >= 0) S.library.splice(i, 1); markDirty(); learnNow(); return; }
  if (el.dataset.go) { // go to the trace in the image
    const own = ownExamples(S.cores, true).find((q) => q.key === fig.dataset.key); if (!own) return;
    $('mlDlg').close();
    if (own.c.id !== S.curCore) activateCore(own.c.id, true);
    selectSection(S.sections.indexOf(own.s)); centerOn(own.o); select(own.o.id);
  }
});

/* ───────────── multiproject analysis (V17): cores of several projects in one analysis project ───────────── */
const mpSel = new Set(); // keys 'projectId|coreId'
/** Same core found in two projects (V23): one series on a common axis; rows at the same depth/age are fused (first non-empty value wins). */
function mergeImp(a, b) {
  const rows = [], add = (t0) => (t0.depth || t0.age || []).forEach((_, i) => rows.push({ d: t0.depth?.[i] ?? null, a: t0.age?.[i] ?? null, t: t0, i }));
  add(a); add(b);
  const names = [...new Set([...Object.keys(a.proxies || {}), ...Object.keys(b.proxies || {})])];
  // sort on depth only if every row has one, else on age if every row has one; otherwise keep the two series one after the other
  const key = rows.every((r) => r.d != null) ? 'd' : rows.every((r) => r.a != null) ? 'a' : null;
  if (key) rows.sort((x, y) => x[key] - y[key]);
  const out = [];
  for (const r of rows) {
    const v = Object.fromEntries(names.map((n) => [n, r.t.proxies?.[n]?.[r.i] ?? null])), last = out[out.length - 1];
    if (key && last && Math.abs(last[key] - r[key]) < 1e-6) { for (const n of names) if (last.v[n] == null) last.v[n] = v[n]; if (last.d == null) last.d = r.d; if (last.a == null) last.a = r.a; }
    else out.push({ d: r.d, a: r.a, v });
  }
  const P = Object.fromEntries(names.map((n) => [n, out.map((r) => r.v[n])]));
  return { depth: out.some((r) => r.d != null) ? out.map((r) => r.d) : null, age: out.some((r) => r.a != null) ? out.map((r) => r.a) : null, proxies: P };
}
/** Build (or refresh) a project of kind 'multi' from the light copies of the chosen cores; layers and categories are merged by name. */
async function buildMultiProject(name, keys, keepId = null) {
  const lites = (await listLite().catch(() => [])).filter((l) => l.kind !== 'multi');
  const chosen = [];
  for (const l of lites) for (const c of l.cores) if (keys.includes(`${l.id}|${c.id}`)) chosen.push({ l, c });
  if (chosen.length < 2) { toast(t('mp.need')); return false; }
  if (!(await canLeaveProject())) return false;
  const prev = keepId ? await getProject(keepId) : null;
  if (prev) await loadProject(prev); else { resetState(); S.id = 'mp' + uid(); }
  S.name = name; S.kind = 'multi'; S.multiSource = { keys: [...keys], built: new Date().toISOString() };
  S.notes = chosen.map(({ l, c }) => `${c.name} (${l.name})`).join('; ');
  // layers by name
  const layers = new Map(), layerId = new Map(), catId = new Map();
  for (const { l } of chosen) for (const L of l.layers || []) {
    let m = layers.get(L.name);
    if (!m) { m = { ...L, id: 'L' + uid(), cats: [], parentName: (l.layers || []).find((q) => q.id === L.parent)?.name || null }; layers.set(L.name, m); }
    layerId.set(`${l.id}|${L.id}`, m.id);
    for (const k of L.cats || []) { let mk = m.cats.find((q) => q.name === k.name); if (!mk) { mk = { ...k, id: 'k' + uid() }; m.cats.push(mk); } catId.set(`${l.id}|${L.id}|${k.id}`, mk.id); }
  }
  for (const m of layers.values()) { m.parent = m.parentName ? layers.get(m.parentName)?.id || null : null; delete m.parentName; }
  // cores: the same core chosen from several projects (same name, coreKey) becomes ONE core whose table joins the
  // rows of every project (no duplicated core, no double weight in models or maps)
  const coreId = new Map(), byKey = new Map();
  for (const { l, c } of chosen) { const k = coreKey(c.name) || `${l.id}|${c.id}`; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push({ l, c }); }
  S.cores = [...byKey.values()].map((grp) => {
    const { c } = grp[0], projects = grp.map((q) => q.l.name);
    let imp = { depth: c.depth, age: c.age, proxies: c.proxies || {} };
    for (const { c: o } of grp.slice(1)) imp = mergeImp(imp, { depth: o.depth, age: o.age, proxies: o.proxies || {} });
    const core = makeCore({ name: c.name, lat: c.lat ?? grp.find((q) => q.c.lat != null)?.c.lat, lon: c.lon ?? grp.find((q) => q.c.lon != null)?.c.lon, units: c.units, source: 'multi',
      notes: t('mp.from', { p: projects.join(', ') }), imp, age: { text: c.ageText || grp.find((q) => q.c.ageText)?.c.ageText || '' } });
    core.origin = grp.map((q) => ({ project: q.l.id, core: q.c.id }));
    for (const q of grp) coreId.set(`${q.l.id}|${q.c.id}`, core.id);
    return core;
  });
  const g = S.geo;
  g.layers = [...layers.values()];
  g.intervals = chosen.flatMap(({ l, c }) => (l.intervals || []).filter((q) => q.core === c.id && !q.auto).map((q) => ({
    ...q, id: uid(), core: coreId.get(`${l.id}|${c.id}`), layer: layerId.get(`${l.id}|${q.layer}`), cat: catId.get(`${l.id}|${q.layer}|${q.cat}`) }))).filter((q) => q.layer && q.cat)
    .filter((q, i, arr) => arr.findIndex((r) => r.core === q.core && r.layer === q.layer && r.cat === q.cat && r.axis === q.axis && Math.abs(r.from - q.from) < 1e-9 && Math.abs(r.to - q.to) < 1e-9) === i);
  const st = g.settings;
  if (!g.layers.some((L) => L.id === st.target)) st.target = g.layers.find((L) => g.intervals.some((q) => q.layer === L.id))?.id || g.layers[0]?.id || null;
  // default variables: columns present in at least two of the cores (up to 12)
  const cnt = {}; for (const c of S.cores) for (const k of Object.keys(c.imp.proxies)) cnt[k] = (cnt[k] || 0) + 1;
  const names2 = Object.keys(cnt);
  st.features = (st.features || []).filter((k) => names2.includes(k));
  if (!st.features.length) st.features = names2.filter((k) => cnt[k] >= 2).sort((a, b) => cnt[b] - cnt[a]).slice(0, 12);
  if (st.missing === 'drop' && st.features.length > 1) st.missing = 'mean';
  for (const c of S.cores) refreshCoreData(c);
  S.curCore = S.cores[0].id; activateCore(S.curCore, true); renderCoreBar();
  geoReset(); geoMarkDirty();
  await saveToDB(); updateProjHeader();
  return true;
}
async function updateMultiProject(id) {
  const meta = (await listProjects().catch(() => [])).find((m) => m.id === id); if (!meta) return;
  const data = await getProject(id); const keys = data?.multiSource?.keys || [];
  await busy(async () => { if (await buildMultiProject(meta.name, keys, id)) toast(t('mp.updated')); });
  await renderProjects();
}
function renderMpCount() {
  $('mpCount').textContent = t('mp.sel', { n: mpSel.size });
  for (const input of $('mpProjects').querySelectorAll('[data-mp-project]')) {
    const project = allLite.find((l) => l.id === input.dataset.mpProject);
    const count = project.cores.filter((c) => mpSel.has(`${project.id}|${c.id}`)).length;
    input.checked = count === project.cores.length;
    input.indeterminate = count > 0 && !input.checked;
  }
}
$('mpProjects').addEventListener('change', (e) => {
  const project = allLite.find((l) => l.id === e.target.dataset.mpProject);
  if (!project) return;
  for (const c of project.cores) {
    const key = `${project.id}|${c.id}`;
    if (e.target.checked) mpSel.add(key); else mpSel.delete(key);
  }
  for (const row of $('allTable').querySelectorAll('tr[data-p]')) {
    if (row.dataset.p === project.id) row.querySelector('.mpchk').checked = e.target.checked;
  }
  renderMpCount();
});
$('mpAll').addEventListener('click', () => { for (const l of allLite.filter((x) => x.kind !== 'multi')) for (const c of l.cores) mpSel.add(`${l.id}|${c.id}`); renderAllProjects(); });
$('mpNone').addEventListener('click', () => { mpSel.clear(); renderAllProjects(); });
$('mpCreate').addEventListener('click', async () => {
  const name = $('mpName').value.trim() || t('mp.title');
  const same = (await listProjects().catch(() => [])).find((m) => m.kind === 'multi' && m.name === name);
  let ok = false;
  await busy(async () => { ok = await buildMultiProject(name, [...mpSel], same?.id || null); });
  if (ok) { hideHome(); setMode('geo'); }
});
// tabs of the start screen
for (const b of document.querySelectorAll('[data-htab]')) b.addEventListener('click', () => setHomeTab(b.dataset.htab));
function setHomeTab(tab) {
  for (const b of document.querySelectorAll('[data-htab]')) b.setAttribute('aria-selected', String(b.dataset.htab === tab));
  for (const p of document.querySelectorAll('[data-hpane]')) p.hidden = p.dataset.hpane !== tab;
  try { localStorage.setItem('ichantool.homeTab', tab); } catch { /* storage blocked */ }
  if (tab === 'all') requestAnimationFrame(() => redrawAllMap());
}
try { setHomeTab(localStorage.getItem('ichantool.homeTab') || 'projects'); } catch { setHomeTab('projects'); }

/* ───────────── windows and floating panel (work on a core while watching the map) ───────────── */

document.addEventListener('click', (e) => {
  const w = e.target.closest('[data-win]'); if (w) { openWindow(w.dataset.win); return; }
  const f = e.target.closest('[data-float]'); if (f) openFloat(f.dataset.float);
});
async function openWindow(kind) {
  if (!(await canLeaveProject())) return;
  if (location.protocol === 'file:') toast(t('win.fileNote'));
  window.open(`${location.href.split('#')[0]}#win=${kind}&project=${encodeURIComponent(S.id)}&core=${encodeURIComponent(S.curCore)}`, '_blank', 'width=1200,height=850');
}
let floatKind = null, floatTimer = 0;
function openFloat(kind) { floatKind = kind; $('float').hidden = false; $('floatTitle').textContent = t('win.title.' + kind); updateFloat(); }
$('floatClose').addEventListener('click', () => { $('float').hidden = true; floatKind = null; });
export function scheduleFloat() { if (!floatKind) return; clearTimeout(floatTimer); floatTimer = setTimeout(updateFloat, 500); }
function updateFloat() {
  if (!floatKind) return;
  try {
    if (floatKind === 'map') { if (geoRT.dirty) geoComputeSamples(); $('floatBody').innerHTML = renderGeoMap() || ''; }
    else { renderLog(); $('floatBody').innerHTML = lastLog?.svg || ''; }
  } catch (e) { $('floatBody').innerHTML = `<p class="note">${esc(e.message)}</p>`; }
}
{ // drag the panel by its title bar
  let d = null;
  $('floatHead').addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; const r = $('float').getBoundingClientRect(); d = { x: e.clientX - r.left, y: e.clientY - r.top }; $('floatHead').setPointerCapture(e.pointerId); });
  $('floatHead').addEventListener('pointermove', (e) => { if (!d) return; const f = $('float'); f.style.left = e.clientX - d.x + 'px'; f.style.top = e.clientY - d.y + 'px'; f.style.right = 'auto'; f.style.bottom = 'auto'; });
  $('floatHead').addEventListener('pointerup', () => { d = null; });
}

/** A second window: read-only view of one project that follows the changes saved by the main window. */
async function startWindow() {
  document.body.classList.add('viewonly');
  const q = new URLSearchParams(location.hash.slice(1)), kind = q.get('win'), id = q.get('project'), coreId = q.get('core');
  let last = 0;
  const load = async () => {
    const meta = await getMeta(id).catch(() => null); if (!meta || meta.updated === last) return; last = meta.updated;
    if (kind === 'corelog') { const d = await getProject(id); if (d) await loadProject(d); activateCore(coreId, true); setMode('log'); return; }
    const lite = (await listLite()).find((l) => l.id === id); if (!lite) return;
    loading = true;
    S.id = id; S.name = lite.name; S.geo = normalizeGeo(lite.geo || { layers: lite.layers, intervals: lite.intervals });
    S.cores = lite.cores.map((c) => Object.assign(makeCore(c), { depth: c.depth, age: c.age, proxies: c.proxies, src: c.src || {}, ageText: c.ageText, frozen: true }));
    S.curCore = coreId; geoReset(); loading = false;
    updateProjHeader(); $('projName').textContent = `${lite.name} · ${t('win.title.' + kind)}`;
    S.geo.view.tab = kind === 'map' ? 'map' : 'logs'; S.geo.view.core = coreId || S.cores[0]?.id;
    await loadLand(); setMode('geo');
    if (S.geo.trained) geoTrain(true);
  };
  await busy(load);
  bc?.addEventListener('message', (e) => { if (e.data?.type === 'saved' && e.data.id === id) busy(load); });
  setInterval(() => load().catch(() => {}), 4000); // fallback when the channel is not shared (local files)
}
/* ───────────── misc ───────────── */

/* light / dark theme (follows the system until the user chooses) */
const currentTheme = () => document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
function applyTheme(th) {
  if (th === 'light' || th === 'dark') document.documentElement.dataset.theme = th; else delete document.documentElement.dataset.theme;
  $('themeBtn').textContent = currentTheme() === 'dark' ? '☀' : '☾'; $('themeBtn').setAttribute('aria-pressed', String(currentTheme() === 'dark'));
}
$('themeBtn').addEventListener('click', () => { const th = currentTheme() === 'dark' ? 'light' : 'dark'; applyTheme(th); try { localStorage.setItem('ichantool.theme', th); } catch { /* storage blocked */ } });
try { applyTheme(localStorage.getItem('ichantool.theme')); } catch { applyTheme(null); }

let toastTimer = 0;
/**
 * V0.36: every exported CSV starts with lines (beginning with #, ignored when read back) that say which version and
 * which settings produced it, so a table can be reproduced.
 */
export function withProv(csv) {
  const det = [...new Set(S.cores.flatMap((c) => c.sections.map((x) => (x.detect || DEFAULT_DETECT).method || 'adaptive')))].join('/');
  return withProvenance(csv, { delivery: DELIVERY, format: FORMAT_VERSION, date: new Date().toISOString(), project: S.name, settings: S.settings, detection: det, age: ageModelText(S.age.model, S.age) });   // V0.44: exportio.js
}
export function toast(msg, ms = 3200) { const el = $('toast'); el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), ms); }

export async function busy(fn, operation = 'work') {
  const finishDiagnostic = diagnosticOperation(operation);
  $('busy').hidden = false;
  await new Promise((r) => setTimeout(r, 30));
  try { await fn(); }
  catch (err) { finishDiagnostic(err); console.error(err); toast(t('err.generic', { e: err?.message || String(err) }), 8000); }   // V0.36: errors are shown
  finally { finishDiagnostic(); $('busy').hidden = true; }
}
/* V0.36: errors nobody caught are shown instead of being lost (once every 5 s at most) */
let lastErrToast = 0;
function showUncaught(err) {
  console.error(err);
  if (Date.now() - lastErrToast < 5000) return; lastErrToast = Date.now();
  toast(t('err.generic', { e: err?.message || String(err) }), 8000);
}
window.addEventListener('unhandledrejection', (e) => showUncaught(e.reason));
window.addEventListener('error', (e) => { if (e.error) showUncaught(e.error); });

function syncSettingsForm() {
  const st = S.settings;
  $('inclPred').checked = st.includePred; $('countCand').checked = st.countCandidates; $('idMode').checked = !!st.idMode;
  $('predThr').value = st.predThr; $('thrOut').textContent = Math.round(st.predThr * 100) + '%';
  $('novelty').value = st.novelty; $('novOut').textContent = '×' + st.novelty;
  $('maxMP').value = st.maxMP; $('minValid').value = st.minValid ?? 20; $('noDataPad').value = st.noDataPad || 0;
  renderBinNote();
}

/* ───────────── V0.39: accessibility helpers ───────────── */
/** Names for range inputs that are not inside a <label>: the text of the sibling <span> of their .slider. */
function nameSliders(root = document) {
  for (const inp of root.querySelectorAll('input[type=range]')) {
    if (inp.closest('label') || inp.hasAttribute('aria-labelledby')) continue;
    const sp = inp.closest('.slider')?.querySelector('span'); if (sp?.textContent) inp.setAttribute('aria-label', sp.textContent.trim());
  }
}
/** ARIA tab pattern for every [role=tablist]: roving tabindex and ←/→/Home/End to move between tabs. */
function tabsA11y() {
  const sync = (list) => { const tabs = [...list.querySelectorAll('[role=tab]')], on = tabs.find((b) => b.getAttribute('aria-selected') === 'true') || tabs[0]; tabs.forEach((b) => (b.tabIndex = b === on ? 0 : -1)); };
  for (const list of document.querySelectorAll('[role=tablist]')) {
    if (list.dataset.a11y) { sync(list); continue; }
    list.dataset.a11y = '1'; sync(list);
    new MutationObserver(() => sync(list)).observe(list, { subtree: true, attributes: true, attributeFilter: ['aria-selected'] });
    list.addEventListener('keydown', (e) => {
      const tabs = [...list.querySelectorAll('[role=tab]')].filter((b) => !b.hidden && !b.disabled), i = tabs.indexOf(document.activeElement); if (i < 0) return;
      const j = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: tabs.length - 1 }[e.key]; if (j == null) return;
      e.preventDefault(); const b = tabs[(j + tabs.length) % tabs.length]; b.focus(); b.click();
    });
  }
  for (const p of document.querySelectorAll('.pane[data-pane]')) { p.setAttribute('role', 'tabpanel'); const b = document.querySelector(`#sideTabs [data-tab="${p.dataset.pane}"]`); if (b) { b.id ||= 'tab-' + p.dataset.pane; p.setAttribute('aria-labelledby', b.id); p.id ||= 'pane-' + p.dataset.pane; b.setAttribute('aria-controls', p.id); } }
}

function applyLanguage() {
  applyI18n(); buildForms(); nameSliders(); tabsA11y(); renderSectionForm(); renderClasses(); renderObject(); renderLearn(); renderResults(); setAge();
  $('langBtn').textContent = lang() === 'es' ? 'EN' : 'ES';
  renderRecList(); updateProjHeader(); scheduleLog(0); scheduleGeo(0);
  requestRender();
  renderDiagnosticStatus();
}
$('langBtn').addEventListener('click', () => { setLang(lang() === 'es' ? 'en' : 'es'); applyLanguage(); });
let singleKeys = true; try { singleKeys = localStorage.getItem('ichantool.keys') !== 'off'; } catch { /* storage blocked */ }
$('keysToggle').checked = singleKeys;
$('keysToggle').addEventListener('change', (e) => { singleKeys = e.target.checked; try { localStorage.setItem('ichantool.keys', singleKeys ? 'on' : 'off'); } catch { /* storage blocked */ } });
$('helpBtn').addEventListener('click', () => $('help').showModal());
$('helpClose').addEventListener('click', () => $('help').close());

/* ───────────── start ───────────── */

new ResizeObserver(resizeCanvases).observe(vp);
buildForms(); applyLanguage(); syncSettingsForm();
setTool('select'); setBrush(10); $('wandTol').value = S.wandTol; $('tolOut').textContent = S.wandTol; $('ovAlpha').value = S.ovAlpha * 100;
resizeCanvases();
initializeDiagnostics({
  snapshot: () => {
    const section = sec();
    return { mode: $('home').hidden ? mode : 'home', tool: S.tool, cores: S.cores.length, sections: S.sections.length,
      width: section?.w || 0, height: section?.h || 0, objects: section?.objects.size || 0,
      saveState: saveSt, backupState, backupPending };
  },
  openHome: showHome,
});
const startupReady = startup();

// Exposed for automated tests.
window.ichantool = { S, engineStats: () => engineAnalysis?.stats() ?? null, ready: startupReady, saveToDB, renderProjects, showHome, runDetection, analyze, analyzeSections, referenceBins: (s) => computeSectionBins(s, analysisProject()).bins, assignClass, learnNow, setTool, nextReview, setMode, renderLog, openTestProject, loadProject, serialize, BI, II, geoRT, geoTrain, renderGeo, loadGeoDemo };
