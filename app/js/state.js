// @ts-check
/**
 * @typedef {{id: string, name: string, color: string, counts: boolean, fixed?: boolean, plain?: boolean, symbol?: string}} TraceClass
 * @typedef {{x: number, y: number, zoom: number}} SectionView
 * @typedef {{text: string, units: string, model: import('./core.js').AgeModel | null, bacon?: string | null, center?: string}} AgeState
 * @typedef {{name: string, x: number[], y: number[], color: string, show?: boolean, reverse?: boolean}} RecordSeries
 * @typedef {{id: string, name: string, axis: string, series: RecordSeries[]}} ExternalRecord
 * @typedef {import('./core.js').Bin & {age?: number | null, ageMin?: number | null, ageMax?: number | null,
 *   BIm?: number | null, iim?: number | null}} SectionBin
 * @typedef {{key: string, canvas: HTMLCanvasElement, k?: number}} SectionCanvasCache
 * @typedef {{name: string, type: string, key?: string, blob?: Blob, size?: number, bytes?: Uint8Array<ArrayBuffer>}} SectionFile
 * @typedef {{id: string, x: number, y: number, cls: string}} TraceMark
 * @typedef {{id: number, order: number, cls: string | null, pred: string | null, conf: number, src: string,
 *   area: number, bbox: number[] | null, nt?: boolean, stats?: import('./imageproc.js').TraceStats | null,
 *   feat?: ReturnType<typeof import('./imageproc.js').features> | null}} TraceObject
 * @typedef {{from: number, to: number, BI: number | null, ii: number | null}} ManualIndex
 * @typedef {{axis: string, from: number | null, to: number | null, height: number, imgMode: string,
 *   overlay: boolean, hideExcl: boolean, overlayAlpha?: number, tracks: Record<string, boolean>, imgPanels?: string[],
 *   colW?: Record<string, number>, textEdits?: Record<string, string>, style?: object}} LogView
 * @typedef {{depth: number[] | null, age: (number | null)[] | null, proxies: Record<string, (number | null)[]>}} CoreData
 * @typedef {{v: number | null, o: number | null, at: string}} CellEdit
 * @typedef {{id: string, name: string, w: number, h: number, top: number, bottom: number,
 *   units: import('./core.js').DepthUnit, roi: import('./core.js').Roi, labels: Int32Array, exclude: Uint8Array,
 *   stacks: import('./core.js').StackTable, bins: SectionBin[], orig: Uint8ClampedArray | null,
 *   orig16?: Uint16Array | null, enh: Uint8ClampedArray | null, ds: number, rot: number,
 *   tiled?: {pyramid: string, level: number, levels: {level: number, width: number, height: number, rows: number, cols: number}[], channels: number, bits: number},
 *   maskTiles?: import('./tiledmasks.js').MaskTiles,
 *   _statsRunner?: import('./tiledit.js').TiledStatsRunner,
 *   logVer: number, view: SectionView | null, crop: import('./core.js').Roi | null,
 *   filters: import('./imageproc.js').FilterSettings, _lc?: SectionCanvasCache | null,
 *   _lb?: SectionCanvasCache | null, file: SectionFile, objects: Map<number, TraceObject>, nextId: number, nextTraceOrder: number,
 *   marks: TraceMark[], manual: ManualIndex[], detect: import('./imageproc.js').DetectionSettings, preset: string,
 *   loadWarnings?: {region: boolean, mask: boolean},
 *   lutFill?: Uint8ClampedArray, lutLine?: Uint8ClampedArray, lutStyle?: Uint8Array, _pxErr?: string,
 *   _unet?: {key: string, prob: Float32Array} | null,
 *   analysis?: {state: 'pending'} | {state: 'ready'} | {state: 'error', code: string, field: string | null}}} SectionState
 * @typedef {{id: string, name: string, units: import('./core.js').DepthUnit, sections: SectionState[],
 *   records: ExternalRecord[], ageModel: AgeState, holdout: boolean, lat: number | null, lon: number | null,
 *   waterDepth: number | null, notes: string, source: string | null, logView: LogView, imp: CoreData | null,
 *   depth: number[] | null, age: (number | null)[] | null, proxies: Record<string, (number | null)[]>,
 *   src: Record<string, string>, ageText: string, user: Record<string, {d: number[], v: (number | null)[]}>,
 *   edits: Record<string, Record<string, CellEdit>>}} CoreState
 * @typedef {{s: SectionState, lm: (number | number[])[], ex: number[], nextId: number, sel: number,
 *   objs: Map<number, TraceObject | null>, group?: string, stackChanged?: boolean}} UndoStep
 */
/* Shared application state and small helpers (no DOM work at load time). */
import { t } from './i18n.js';

/** App name (V16: IchAnTool → CorAnTool; V0.52: → SedCoreTool). Files written with the old names are still accepted;
 *  browser storage keys, the IndexedDB name and the desktop origin keep the old names so saved data stays. */
export const APP = 'SedCoreTool', APP_NAMES = ['SedCoreTool', 'CorAnTool', 'IchAnTool'];
/** @param {string} id */
export const $ = (id) => document.getElementById(id);
export const VERSION = '3.0.0-dev';
const ASSET_BASES = ['', '../examples/'];

/** Bundled files (example images, test core). The standalone build injects them as data URIs.
 *
 * @param {string} path
 * @returns {Promise<Response>}
 */
export async function fetchAsset(path) {
  const inline = window.ICHANTOOL_ASSETS?.[path];
  for (const u of inline ? [inline] : ASSET_BASES.map((b) => b + path)) {
    try { const r = await fetch(u); if (r.ok) return r; } catch { /* next */ }
  }
  throw new Error('file not found: ' + path);
}

/** V0.50: whether an example file is available (the downloads carry no sample data; the repository does, for tests).
 *
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function assetExists(path) {
  if (window.ICHANTOOL_ASSETS?.[path]) return true;
  for (const b of ASSET_BASES) { try { const r = await fetch(b + path, { method: 'HEAD' }); if (r.ok) return true; } catch { /* next */ } }
  return false;
}
/** V0.50: example and demo buttons only where their files exist. */
export async function hideMissingExamples() {
  for (const [id, path] of [['loadExample', 'data/idealized_core_0-500cm.jpg'], ['openIdeal', 'data/idealized_core_0-500cm.jpg'], ['openTest', 'U1385I-1H/records/397-U1385I-1H_MS.csv'], ['geoDemo', 'geochem_demo/intervals.csv'], ['openTutorial', 'tutorial/cores.csv']]) {
    const el = $(id); if (el && !(await assetExists(path))) el.hidden = true;
  }
}

/** @returns {TraceClass[]} */
export function defaultClasses() {
  return [
    { id: 'undet', name: t('cls.undet'), color: '#d9a441', counts: true, fixed: true, plain: true },
    { id: 'chondrites', name: 'Chondrites', color: '#4c8dff', counts: true },
    { id: 'planolites', name: 'Planolites', color: '#ef5b3b', counts: true },
    { id: 'thalassinoides', name: 'Thalassinoides', color: '#a26bf0', counts: true },
    { id: 'zoophycos', name: 'Zoophycos', color: '#1fb58f', counts: true },
    { id: 'palaeophycus', name: 'Palaeophycus', color: '#f062b0', counts: true },
    { id: 'teichichnus', name: 'Teichichnus', color: '#22b8e6', counts: true },
    { id: 'scolicia', name: 'Scolicia', color: '#8cc63f', counts: true },
    { id: 'mottled', name: t('cls.mottled'), color: '#b49a7a', counts: true, plain: true },
    { id: 'trichichnus', name: 'Trichichnus', color: '#f2d23c', counts: true },
    { id: 'phycosiphon', name: 'Phycosiphon', color: '#ff9b4a', counts: true },
    { id: 'artifact', name: t('cls.artifact'), color: '#8c8c8c', counts: false, fixed: true, plain: true },
  ];
}

export const S = {
  multi: /** @type {Set<number>} */ (new Set()), exShape: 'brush',
  name: 'ichantool-project',
  classes: defaultClasses(), active: 'undet',
  sections: /** @type {SectionState[]} */ ([]), cur: -1,
  cores: /** @type {CoreState[]} */ ([]), curCore: /** @type {string | null} */ (null),
  sheet: { columns: /** @type {object[]} */ ([]), cells: /** @type {Record<string, string>} */ ({}) },
  id: '', notes: '', records: /** @type {ExternalRecord[]} */ ([]), logView: /** @type {LogView | null} */ (null),
  settings: { binCm: 1, minValid: 20, noDataPad: 0, includePred: true, predThr: 0.7, countCandidates: true, novelty: 3, maxMP: 8, clfScope: 'project', ml: { method: 'knn', k: 5, weights: 'distance', trees: 100, maxDepth: 12, minLeaf: 2, balanced: true, priors: 'uniform' } },
  age: /** @type {AgeState} */ ({ text: '', units: 'ka', model: null }),
  library: /** @type {object[]} */ ([]),
  tool: 'select', prevTool: 'select', brushSize: 10, wandTol: 30,
  selected: 0, view: { x: 0, y: 0, zoom: 1 }, showOrig: false, ovAlpha: 0.5,
  undo: /** @type {UndoStep[]} */ ([]),
  redo: /** @type {UndoStep[]} */ ([]),
};
/** Three ichnotaxon models (V16): trained on the open core, on every core of the project, or on every project. */
export const CLF_SCOPES = ['core', 'project', 'all'];
/** Training settings of the ichnotaxon models (V18); stored in the project settings. */
export const ML_DEFAULT = { method: 'knn', k: 5, weights: 'distance', trees: 100, maxDepth: 12, minLeaf: 2, balanced: true, priors: 'uniform', features: 'shape' };
/** @returns {SectionState | undefined} */
export const sec = () => S.sections[S.cur];
export const uid = () => Math.random().toString(36).slice(2, 9);
/**
 * @param {string} id
 * @returns {TraceClass | undefined}
 */
export const clsById = (id) => S.classes.find((c) => c.id === id);
/**
 * @param {string} h
 * @returns {number[]}
 */
export const hex = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
/**
 * @param {number | null | undefined} v
 * @param {number} [d]
 * @returns {string}
 */
export const fmt = (v, d = 2) => (v == null || !Number.isFinite(v) ? '—' : (+v.toFixed(d)).toString());
/**
 * @param {TraceClass} c
 * @returns {string}
 */
export const keyOf = (c) => { const k = S.classes.indexOf(c); return c.id === 'artifact' ? '0' : k < 9 ? String(k + 1) : ''; };
