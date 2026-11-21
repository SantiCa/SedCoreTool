// SedCoreTool web — V0.44: tables written to files and records read from tables. DOM-free and tested
// (tests/app/exportio.test.mjs); app.js only gathers the data and saves the files.

/** Escape user text inside a single-line CSV comment, where normal field quoting is unavailable. */
export const csvCommentText = (value) => String(value).replace(/[\u0000-\u001f\u007f,;|"\u2028\u2029]/gu,
  (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

/** Provenance lines (start with #, ignored when read back) for an exported CSV. */
export function provenanceLines({ delivery, format, date, project, settings: st = {}, detection = '', age = 'none' }) {
  return [`# SedCoreTool ${delivery} (format ${format}); exported ${date}; project "${csvCommentText(String(project).replace(/"/g, "'"))}"`,
    `# settings: binCm=${csvCommentText(st.binCm)}; minValid=${csvCommentText(st.minValid)}%; includePred=${!!st.includePred}; predThr=${csvCommentText(st.predThr)}; countCandidates=${!!st.countCandidates}; detection=${csvCommentText(detection)}; age model=${csvCommentText(age)}`];
}
export const withProvenance = (csv, info) => [...provenanceLines(info), csv].join('\n');

/** Age-model description for the provenance line. */
export const ageModelText = (m, age = {}) => (m ? `${age.bacon ? `Bacon ${age.center || 'median'}` : 'table'}${m.min ? ' with range' : ''}, ${age.units || 'ka'}` : 'none');

/**
 * Bioturbation table: one row per interval and section. sections = [{name, units, bins}], counted = [[name, class
 * index]], range = age model with min/max, ageUnits = unit or null without a model.
 */
export function bioturbationTable(sections, { counted = [], range = false, ageUnits = null } = {}) {
  const rows = [['section', 'depth_top', 'depth_bottom', 'depth', 'units', 'age', ...(range ? ['age_min', 'age_max'] : []), 'age_units', 'valid_pixels', 'bioturbation_pct', ...counted.map(([n]) => n + '_pct'), 'BI', 'ii', 'BI_manual', 'ii_manual']];
  for (const s of sections) for (const b of s.bins || []) rows.push([s.name, b.dTop, b.dBottom, b.depth, s.units, b.age ?? null, ...(range ? [b.ageMin ?? null, b.ageMax ?? null] : []), ageUnits, b.valid, b.pct, ...counted.map(([, k]) => b.classPct?.[k] ?? null), b.BI ?? null, b.ii ?? null, b.BIm ?? null, b.iim ?? null]);
  return rows;
}

/**
 * Object table: one row per trace with a bounding box. Each item: {section, units, o (object), cls, status, pred,
 * counted, depth(row) → depth, unavailable}; o.feat holds the descriptors. Card M8.4.37: `unavailable` (the statistics of a tiled section were
 * dropped beyond their budget) keeps the row of an object without a box, with its depths and descriptors empty (not available).
 */
export function objectsTable(items) {
  const rows = [['section', 'object_id', 'class', 'status', 'suggested_class', 'confidence', 'depth_top', 'depth_bottom', 'depth_center', 'units', 'area_cm2', 'length_cm', 'width_cm', 'elongation', 'verticality', 'compactness', 'mean_luminance', 'contrast', 'counted']];
  for (const it of items) {
    const o = it.o; if (!o.bbox && !it.unavailable) continue; const f = o.feat || {};
    rows.push([it.section, o.id, it.cls ?? '', it.status, it.pred ?? '', o.cls ? 1 : o.conf ?? null, o.bbox ? it.depth(o.bbox[1]) : null, o.bbox ? it.depth(o.bbox[3] + 1) : null, f.cy != null ? it.depth(f.cy + 0.5) : null, it.units,
      f.areaCm2 ?? null, f.majorCm ?? null, f.minorCm ?? null, f.elong ?? null, f.vert ?? null, f.compact ?? null, f.meanL ?? null, f.contrast ?? null, it.counted ? 1 : 0]);
  }
  return rows;
}

/**
 * Series of a record from a parsed table (log.js parseTable): x from column xCol, one series per column in yCols;
 * rows without x or y are left out and points are sorted by x. Series without points are dropped.
 */
export function recordSeries(tab, xCol, yCols, colors, start = 0, factor = 1) {
  return yCols.map((c, k) => {
    // card Q3: the axis in the core's unit (`factor`)
    const pts = tab.rows.map((r) => [r[xCol] == null ? null : r[xCol] * factor, r[c]]).filter((p) => p[0] != null && p[1] != null && Number.isFinite(p[0]) && Number.isFinite(p[1])).sort((a, b) => a[0] - b[0]);
    return { name: tab.headers[c], x: pts.map((p) => p[0]), y: pts.map((p) => p[1]), color: colors[(start + k) % colors.length], show: true, reverse: false };
  }).filter((s) => s.x.length);
}
