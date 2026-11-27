// @ts-check
// Merging all data sources of a core (image intervals, external records, imported table, manual columns) into one table
// on the union of depths (or ages for an age-only core). Pure module (no DOM): tested in Node (card M8.5.7).
import { UNIT_TO_CM, interpAge, rangeOverlaps } from './core.js';
import { compositeRows, invertModel } from './log.js';

/**
 * @typedef {import('./core.js').DepthUnit} DepthUnit
 * @typedef {import('./core.js').AgeModel} AgeModel
 * @typedef {{name: string, counts?: boolean}} ClassLike
 * @typedef {{name: string, units: DepthUnit, top?: number, bottom?: number, bins: {dTop: number, dBottom: number, depth: number, pct: number | null, BI: number | null, ii: number | null, classPct: (number | null)[]}[]}} SectionLike
 * @typedef {{axis: string, series: {name: string, x: (number | null)[], y: (number | null)[]}[]}} RecordLike
 * @typedef {{depth: (number | null)[] | null, age: (number | null)[] | null, vals: Record<string, (number | null)[]>, src: string}} CorePart
 * @typedef {{units?: DepthUnit, frozen?: boolean, sections: SectionLike[], records: RecordLike[],
 *   ageModel: {text: string, units?: string, model: AgeModel | null},
 *   imp?: {depth: (number | null)[] | null, age: (number | null)[] | null, proxies?: Record<string, (number | null)[]>} | null,
 *   user?: Record<string, {d: (number | null)[], v: (number | null)[]}>,
 *   depth: number[] | null, age: (number | null)[] | null, proxies: Record<string, (number | null)[]>,
 *   src: Record<string, string>, ageText: string, ageAnalysis?: any}} CoreLike
 */

/**
 * Series of one core from its images (bioturbation per interval) and external records, in core units.
 * @param {CoreLike} c
 * @param {{classes?: readonly ClassLike[], bioLabel?: string, analyzeSection?: ((s: SectionLike) => void) | null}} [options]
 * @returns {CorePart[]}
 */
export function collectCoreParts(c, { classes = [], bioLabel = 'Bioturbation %', analyzeSection = null } = {}) {
  /** @type {CorePart[]} */
  const parts = [];
  const base = c.units || 'm', model = c.ageModel.model;
  if (c.sections.length) {
    /** @param {SectionLike} s */
    const f = (s) => UNIT_TO_CM[s.units] / UNIT_TO_CM[base];
    for (const s of c.sections) analyzeSection?.(s);
    const rows = compositeRows(
      c.sections.map((s) => ({
        name: s.name,
        bins: s.bins.map((b) => ({ ...b, dTop: b.dTop * f(s), dBottom: b.dBottom * f(s), depth: b.depth * f(s) })),
      })),
      { axis: 'depth', model },
    );
    /** @type {Record<string, (number | null)[]>} */
    const vals = {
      [bioLabel]: rows.map((r) => r.pct),
      BI: rows.map((r) => r.BI),
      ii: rows.map((r) => r.ii),
    };
    classes.forEach((k, j) => {
      if (k.counts && rows.some((r) => (r.classPct[j] ?? 0) > 0)) vals[`% ${k.name}`] = rows.map((r) => r.classPct[j]);
    });
    parts.push({ depth: rows.map((r) => r.depth), age: null, vals, src: 'img' });
  }
  const inv = model ? invertModel(model) : null;
  for (const rec of c.records) {
    for (const se of rec.series) {
      const depth = rec.axis === 'age' ? (inv ? se.x.map((a) => (a == null ? null : interpAge(inv, a))) : null) : se.x;
      if (depth) parts.push({ depth, age: rec.axis === 'age' ? se.x : null, vals: { [se.name]: se.y }, src: 'rec' });
    }
  }
  return parts;
}

/**
 * Row ages for a depth-sorted core table: rows that already carry an age (imported or age-axis record) keep it;
 * otherwise interpolate from the core's age model.
 * @param {readonly number[]} depths
 * @param {readonly (number | null)[]} importedAges
 * @param {AgeModel | null | undefined} model
 * @returns {(number | null)[]}
 */
export function computeCoreAges(depths, importedAges, model) {
  return depths.map((d, i) => importedAges[i] ?? (model ? interpAge(model, d) : null));
}

/**
 * Recompute the derived arrays of a core (all sources merged on the union of depths).
 * @param {CoreLike} c
 * @param {{classes?: readonly ClassLike[], bioLabel?: string, analyzeSection?: ((s: SectionLike) => void) | null,
 *   afterMerge?: ((c: CoreLike) => void) | null,
 *   resolveAges?: ((c: CoreLike, req: {depths: number[], importedAges: (number | null)[], model: AgeModel, depthUnit: string, ageUnit: string}) => void) | null,
 *   clearAges?: ((c: CoreLike) => void) | null}} [options]
 */
export function mergeCoreData(c, { classes = [], bioLabel = 'Bioturbation %', analyzeSection = null, afterMerge = null, resolveAges = null, clearAges = null } = {}) {
  if (c.frozen) return; // read-only copy (windows built from the light index)
  const parts = collectCoreParts(c, { classes, bioLabel, analyzeSection }), model = c.ageModel.model;
  if (c.imp) parts.push({ depth: c.imp.depth, age: c.imp.age, vals: c.imp.proxies || {}, src: 'imp' });
  for (const [name, u] of Object.entries(c.user || {})) parts.push({ depth: u.d, age: null, vals: { [name]: u.v }, src: 'man' });
  c.ageText = c.ageModel.text; c.src = {};
  const withDepth = parts.filter((q) => q.depth);
  /** @type {{d: number | null, a: number | null, q: CorePart, i: number}[]} */
  const rows = [];
  if (withDepth.length) {
    for (const q of withDepth) /** @type {readonly (number | null)[]} */ (q.depth).forEach((d, i) => { if (d != null) rows.push({ d, a: q.age?.[i] ?? null, q, i }); });
    rows.sort((x, y) => /** @type {number} */ (x.d) - /** @type {number} */ (y.d));
    c.depth = rows.map((r) => /** @type {number} */ (r.d));
    const importedAges = rows.map((r) => r.a);
    if (resolveAges) {
      if (model && c.depth.length && importedAges.some((v) => v == null)) {
        resolveAges(c, { depths: c.depth, importedAges, model, depthUnit: c.units || 'm', ageUnit: c.ageModel.units || 'ka' });
      } else {
        clearAges?.(c);
        c.age = importedAges.some((v) => v != null) ? importedAges : null;
      }
    } else {
      const ages = computeCoreAges(c.depth, importedAges, model);
      c.age = ages.some((v) => v != null) ? ages : null;
    }
  } else {
    clearAges?.(c);
    const q = parts.find((x) => x.age); // age-only core (no depth anywhere)
    if (q && q.age) q.age.forEach((a, i) => rows.push({ d: null, a, q, i }));
    c.depth = null; c.age = rows.length ? rows.map((r) => r.a) : null;
  }
  c.proxies = {};
  for (const q of parts) for (const name of Object.keys(q.vals)) { c.proxies[name] = rows.map(() => null); c.src[name] = q.src; }
  rows.forEach((r, k) => { for (const [name, arr] of Object.entries(r.q.vals)) c.proxies[name][k] = arr?.[r.i] ?? null; });
  afterMerge?.(c);
}

/**
 * Depth-age relation of a core in core units: its parsed age model (rescaled from section units when entered in
 * section units and disjoint from the section span in core units), or a sorted relation from imported depth/age pairs.
 * @param {Partial<CoreLike> | {units?: DepthUnit, sections?: readonly SectionLike[], ageModel?: {text?: string, model?: AgeModel | null} | null, depth?: readonly (number | null)[] | null, age?: readonly (number | null)[] | null} | null | undefined} core
 * @returns {AgeModel | null}
 */
export function coreAgeRelation(core) {
  const model = core?.ageModel?.model;
  if (model) {
    if (core.sections?.length) {
      const base = core.units || core.sections[0].units || 'cm';
      const secUnit = core.sections[0].units || base;
      if (secUnit !== base) {
        let minBase = Infinity, maxBase = -Infinity, minSec = Infinity, maxSec = -Infinity;
        for (const s of core.sections) {
          const su = s.units || secUnit;
          const top = typeof s.top === 'number' ? s.top : s.bins?.[0]?.dTop;
          const bottom = typeof s.bottom === 'number' ? s.bottom : s.bins?.[s.bins.length - 1]?.dBottom;
          if (typeof top !== 'number' || typeof bottom !== 'number' || !Number.isFinite(top) || !Number.isFinite(bottom)) continue;
          const fb = UNIT_TO_CM[su] / UNIT_TO_CM[base], fs = UNIT_TO_CM[su] / UNIT_TO_CM[secUnit];
          minBase = Math.min(minBase, top * fb, bottom * fb);
          maxBase = Math.max(maxBase, top * fb, bottom * fb);
          minSec = Math.min(minSec, top * fs, bottom * fs);
          maxSec = Math.max(maxSec, top * fs, bottom * fs);
        }
        if (minBase <= maxBase && !rangeOverlaps(model.depth, minBase, maxBase) && rangeOverlaps(model.depth, minSec, maxSec)) {
          const factor = UNIT_TO_CM[secUnit] / UNIT_TO_CM[base];
          return { ...model, depth: model.depth.map((d) => d * factor) };
        }
      }
    }
    return model;
  }
  if (Array.isArray(core?.depth) && Array.isArray(core?.age)) {
    /** @type {[number, number][]} */
    const pairs = [];
    const n = Math.min(core.depth.length, core.age.length);
    for (let i = 0; i < n; i++) {
      const d = core.depth[i], a = core.age[i];
      if (typeof d === 'number' && Number.isFinite(d) && typeof a === 'number' && Number.isFinite(a)) pairs.push([d, a]);
    }
    pairs.sort((x, y) => x[0] - y[0]);
    /** @type {number[]} */
    const depth = [];
    /** @type {number[]} */
    const age = [];
    for (let i = 0; i < pairs.length; ) {
      const d = pairs[i][0];
      let sum = 0, count = 0;
      while (i < pairs.length && pairs[i][0] === d) { sum += pairs[i][1]; count++; i++; }
      depth.push(d);
      age.push(sum / count);
    }
    return depth.length >= 2 ? { depth, age } : null;
  }
  return null;
}
