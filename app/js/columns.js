import { rowAtDepth } from './sectiondepth.js';
/* Composite log: shared drawing for the column view and independent figures, records and track controls. */
import { $, S, fmt, hex, uid } from './state.js';
import { analyze, armed, busy, compositeMarks, compositeTaxonPoints, effClassArray, esc, idListOf, idMode, legendOf, markDirty, needPixels, requestRender, resizeCanvases, safe, saveFile, toast, updateTip, withProv } from './app.js';
import { geoOverlay, loadLand, logInteract, readTableFile, renderGeo, renderGeoLogs } from './multiproxy.js';
import { applyPanels } from './panels.js';
import { disposeDataTable, renderData } from './datatab.js';
import { FIG_PANELS, arrowMarksSVG, axisErr, coreRatio, editSVGLabels, figTraces, panelDataURL, renderFigPanel, renderFigure, scheduleFigure } from './figures.js';

import { UNIT_TO_CM, interpAge, topAt } from './core.js';
import { validSavedRegion } from './edit.js';
import { LOG_STYLE, ND_STYLE, mergedStyle, taxaOptions, validHexColor, buildLogSVG, compositeRows, guessAxisColumn, invertModel, orderCols, rowsRange, toAxis, windowCSV } from './log.js';
import { t } from './i18n.js';
import { buildNavigationLayers, NavigationPreviewCache } from './navpreview.js';
import { figureViewOf, editFigureView } from './figview.js';
import { recordSeries } from './exportio.js';

/* ───────────── composite log ───────────── */

export function defaultLogView() {
  return { axis: 'depth', from: null, to: null, height: 900, imgMode: 'enh', overlay: true, hideExcl: false,
    tracks: { image: true, total: true, species: true, BI: true, ii: true, manual: true, secs: false } };
}
S.logView = defaultLogView();
export let mode = 'section', logTimer = 0, lastLog = null;

export function setMode(m) {
  if (mode === 'data' && m !== 'data') disposeDataTable();
  mode = m; setTimeout(updateTip, 0); setTimeout(() => applyPanels(), 0);
  $('work').classList.toggle('log', m === 'log');
  $('work').classList.toggle('geo', m === 'geo');
  $('work').classList.toggle('data', m === 'data');
  $('work').classList.toggle('fig', m === 'fig');
  for (const [id, k] of [['modeSection', 'section'], ['modeLog', 'log'], ['modeData', 'data'], ['modeGeo', 'geo'], ['modeFig', 'fig']]) $(id).setAttribute('aria-pressed', String(m === k));
  if (m === 'data') { renderData(); return; }
  if (m === 'fig') { busy(async () => { await loadLand(); renderFigPanel(); renderFigure(); }); return; }
  if (m === 'log') { renderLogPanel(); scheduleLog(0); }
  else if (m === 'geo') busy(async () => { await loadLand(); renderGeo(); });
  else requestAnimationFrame(resizeCanvases);
}
$('modeSection').addEventListener('click', () => setMode('section'));
$('modeLog').addEventListener('click', () => setMode('log'));
$('modeGeo').addEventListener('click', () => setMode('geo'));
$('modeData').addEventListener('click', () => setMode('data'));
$('modeFig').addEventListener('click', () => setMode('fig'));

export function scheduleLog(ms = 200) { if (mode !== 'log') return; clearTimeout(logTimer); logTimer = setTimeout(() => busy(renderLog), ms); }

export function compositeData(axisPref = S.logView.axis, core = null) {
  const secs = [...(core?.sections || S.sections)].sort((a, b) => a.top * UNIT_TO_CM[a.units] - b.top * UNIT_TO_CM[b.units]);
  const base = core?.units || secs[0]?.units || 'cm';
  const f = (s) => UNIT_TO_CM[s.units] / UNIT_TO_CM[base];
  for (const s of secs) analyze(s);
  const model = (core?.ageModel || S.age).model, axis = axisPref === 'age' && model ? 'age' : 'depth';
  const rows = compositeRows(secs.map((s) => ({ name: s.name, bins: s.bins.map((b) => ({ ...b, dTop: b.dTop * f(s), dBottom: b.dBottom * f(s), depth: b.depth * f(s) })) })), { axis, model });
  return { secs, base, f, model, axis, rows };
}

/**
 * V0.41: box-filter reduction of a w × h layer to sw × sh without a full-size canvas: pix(i) returns [r, g, b, a] for
 * source pixel i (or null = transparent); colours are averaged with premultiplied alpha, as a canvas downscale does.
 */
export function reduceRGBA(w, h, sw, sh, pix) {
  const n = sw * sh, acc = new Float32Array(n * 4), cnt = new Uint32Array(n), cx = new Int32Array(w);
  for (let x = 0; x < w; x++) cx[x] = Math.min(sw - 1, Math.floor((x * sw) / w));
  for (let y = 0; y < h; y++) {
    const oy = Math.min(sh - 1, Math.floor((y * sh) / h)) * sw, row = y * w;
    for (let x = 0; x < w; x++) {
      const o = oy + cx[x]; cnt[o]++; const p = pix(row + x); if (!p) continue;
      const a = p[3], j = o * 4; acc[j] += p[0] * a; acc[j + 1] += p[1] * a; acc[j + 2] += p[2] * a; acc[j + 3] += a;
    }
  }
  const im = new ImageData(sw, sh), d = im.data;
  for (let o = 0; o < n; o++) { const j = o * 4, A = acc[j + 3]; if (!A) continue; d[j] = acc[j] / A; d[j + 1] = acc[j + 1] / A; d[j + 2] = acc[j + 2] / A; d[j + 3] = A / cnt[o]; }
  return im;
}

/**
 * Column strip of a section (≤ 512 px wide). V0.1: the reduced picture (original or treated) is cached apart from the
 * coloured traces, so changing overlay settings only needs the masks, not the picture on disk.
 *
 * @param {import('./state.js').SectionState} s
 */
export function sectionCanvas(s, lv = S.logView) {
  const opacity = Number.isFinite(lv.overlayAlpha) ? Math.max(0, Math.min(1, lv.overlayAlpha)) : S.ovAlpha;
  const key = `${s.logVer}|${lv.imgMode}|${lv.overlay}|${lv.hideExcl}|${opacity}|${S.settings.predThr}|${S.settings.includePred}|${S.settings.countCandidates}|${s.w}x${s.h}`;
  if (s._lc?.key === key) return s._lc.canvas;
  const k = Math.min(1, 512 / s.w), sw = Math.max(1, Math.round(s.w * k)), sh = Math.max(1, Math.round(s.h * k));
  const bkey = `${lv.imgMode}|${s.ds}|${s.w}x${s.h}|${s.rot}|${JSON.stringify(s.crop)}|${lv.imgMode === 'orig' ? '' : JSON.stringify(s.filters) + JSON.stringify(s.roi)}`;
  if (s._lb?.key !== bkey) {
    if (!s.orig) {   // grey strip until the picture is read from disk
      needPixels(s);
      // stripDataURL asks once per output row: a new canvas of the full strip size each time took tens of seconds on a core
      // whose pictures were not loaded yet, so keep the grey one while the section stays pending at the same size.
      if (s._lc?.key === 'pending' && s._lc.canvas.width === sw && s._lc.canvas.height === sh) return s._lc.canvas;
      const p = document.createElement('canvas'); p.width = sw; p.height = sh;
      const g = p.getContext('2d'); g.fillStyle = '#cfd4d2'; g.fillRect(0, 0, sw, sh); s._lc = { key: 'pending', canvas: p, k: sw / s.w }; return p;
    }
    const src = lv.imgMode === 'orig' ? s.orig : s.enh, px = [0, 0, 0, 255];
    const b = document.createElement('canvas'); b.width = sw; b.height = sh;
    b.getContext('2d').putImageData(reduceRGBA(s.w, s.h, sw, sh, (i) => { const j = i * 4; px[0] = src[j]; px[1] = src[j + 1]; px[2] = src[j + 2]; return px; }), 0, 0);   // V0.41
    s._lb = { key: bkey, canvas: b };
  }
  const out = document.createElement('canvas'); out.width = sw; out.height = sh;
  const oc = out.getContext('2d'); oc.drawImage(s._lb.canvas, 0, 0);
  if (lv.overlay || lv.hideExcl) {   // traces (alpha a) and blank excluded zones, averaged straight into the strip (V0.41)
    const L = s.labels, ex = s.exclude, eff = lv.overlay ? effClassArray(s) : null, cols = S.classes.map((q) => hex(q.color)), a = Math.round(255 * Math.max(0.35, opacity));
    const W = 255, px = [0, 0, 0, 0];
    const im = reduceRGBA(s.w, s.h, sw, sh, (i) => {
      if (ex[i]) { if (!lv.hideExcl) return null; px[0] = px[1] = px[2] = px[3] = W; return px; }   // V31: excluded zones left blank
      if (!eff) return null; const id = topAt(L[i], s.stacks); if (!id) return null; const q = eff[id]; if (q < 0) return null;
      const col = cols[q]; px[0] = col[0]; px[1] = col[1]; px[2] = col[2]; px[3] = a; return px;
    });
    const t2 = document.createElement('canvas'); t2.width = sw; t2.height = sh; t2.getContext('2d').putImageData(im, 0, 0);
    oc.drawImage(t2, 0, 0); t2.width = t2.height = 0;
  }
  s._lc = { key, canvas: out, k: sw / s.w };
  return out;
}

const navigationPreviews = new NavigationPreviewCache(8 * 1024 * 1024, (canvas) => { canvas.width = canvas.height = 0; });
export const clearNavigationPreviews = () => navigationPreviews.clear();

/**
 * Navigation-only preview. Temporary legacy-size layers preserve exact display pixels; only the final strip is retained.
 * `origin` is where the caller will place the strip in the view. The strip is stretched at that same offset inside the returned canvas
 * (which is then `origin` larger on the left and top) because software rasterisers such as SwiftShader round a stretch differently at
 * different destination positions, and the preview must equal the legacy draw pixel for pixel; the caller copies the strip 1:1.
 */
export function navigationPreviewCanvas(s, width, height, origin = { x: 0, y: 0 }) {
  if (!s.orig || !s.enh || !validSavedRegion(s.roi, s.w, s.h)
    || !Number.isInteger(width) || width < 1 || width > 24 || !Number.isInteger(height) || height < 1 || height > 4096) return null;
  const lv = S.logView, roi = s.roi, palette = S.classes.map((c) => c.color), opacity = Number.isFinite(lv.overlayAlpha) ? lv.overlayAlpha : S.ovAlpha;
  const key = JSON.stringify([s.logVer, s.w, s.h, s.ds, s.rot, s.crop, roi, s.filters, lv.imgMode, lv.overlay, lv.hideExcl,
    opacity, palette, S.settings.predThr, S.settings.includePred, S.settings.countCandidates, width, height, origin.x, origin.y]);
  const cached = navigationPreviews.get(s, key); if (cached) return cached;
  const layers = buildNavigationLayers({ width: s.w, height: s.h, rgba: lv.imgMode === 'orig' ? s.orig : s.enh,
    labels: lv.overlay ? s.labels : null, exclude: lv.overlay || lv.hideExcl ? s.exclude : null,
    classIndices: lv.overlay ? effClassArray(s) : [], colors: palette.map(hex), stacks: s.stacks,
    overlay: !!lv.overlay, hideExcluded: !!lv.hideExcl, alpha: Math.round(255 * Math.max(0.35, Math.min(1, opacity))) });
  const image = document.createElement('canvas'); image.width = layers.width; image.height = layers.height;
  const context = image.getContext('2d'); context.putImageData(new ImageData(layers.photo, layers.width, layers.height), 0, 0);
  if (layers.trace) {
    const overlay = document.createElement('canvas'); overlay.width = layers.width; overlay.height = layers.height;
    overlay.getContext('2d').putImageData(new ImageData(layers.trace, layers.width, layers.height), 0, 0);
    context.drawImage(overlay, 0, 0); overlay.width = overlay.height = 0;
  }
  const result = document.createElement('canvas'); result.width = origin.x + width; result.height = origin.y + height;
  const scale = layers.width / s.w;
  result.getContext('2d').drawImage(image, roi.x0 * scale, roi.y0 * scale, (roi.x1 - roi.x0) * scale, (roi.y1 - roi.y0) * scale, origin.x, origin.y, width, height);
  image.width = image.height = 0;
  navigationPreviews.set(s, key, result, result.width * result.height * 4); return result;
}

/** Core image strip for the window, resampled row by row onto the depth or age axis. */
/**
 * V0.23–V0.25: image panels of a core (core column, Figures › core, Multiproxy): original, enhanced, traces painted,
 * outlined, traces only, black and white, arrows, side by side. o = { panels, w, hideExcl, keep, stretch }:
 * width keeps the photo proportions (keep) × stretch, or w px. Panels other than the plain image need the depth axis.
 */
export function coreImages(D, from, to, H, o) {
  const panels = (o.panels?.length ? o.panels : [o.mode === 'orig' ? 'orig' : 'enh']).filter((p) => FIG_PANELS.includes(p));
  let w = +o.w > 0 ? +o.w : 64;
  if (o.keep) { if (D.axis === 'depth') { const r = coreRatio(D, from, to); if (r) w = H / r; } w *= +o.stretch > 0 ? +o.stretch : 1; }
  w = Math.round(Math.max(8, Math.min(600, w)));
  if ((D.axis !== 'depth' && !o.axisPanels) || (o.plain && panels.length === 1 && panels[0] === (o.mode === 'orig' ? 'orig' : 'enh'))) return [{ href: stripDataURL(D, from, to, H, w * 2, o.view), w }];
  const tr = panels.includes('arrows') ? figTraces(D, from, to) : null, multi = panels.length > 1;
  return panels.map((p) => {
    const im = { href: panelDataURL(D, from, to, H, w, p === 'arrows' ? 'enh' : p, !!o.hideExcl, o.view?.alpha), w, title: multi ? t('fig.p.' + p) : null };
    if (p === 'arrows') { im.draw = (x, cw, y) => arrowMarksSVG(tr, x, cw, y); im.marks = false; }
    return im;
  });
}
/** Core column and Multiproxy: the panels and width chosen in the core column. */
export function columnImages(D, from, to, H, lv = S.logView) {
  const st = lv.style || {};
  return coreImages(D, from, to, H, { axisPanels: lv !== S.logView, view: lv, panels: lv.imgPanels, mode: lv.imgMode, hideExcl: lv.hideExcl, keep: (st.imgAspect || 'keep') === 'keep', stretch: st.imgStretch, w: st.imgW, plain: true });
}

function stripDataURL(D, from, to, H, W, lv = S.logView) {
  const Hc = Math.min(4000, Math.round(H * 2)), c = document.createElement('canvas'); c.width = W; c.height = Hc;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, Hc);
  const inv = invertModel(D.model);
  for (let r = 0; r < Hc; r++) {
    const v = from + ((r + 0.5) / Hc) * (to - from);
    const d = D.axis === 'age' ? interpAge(inv, v) : v; if (d == null) continue;
    const s = D.secs.find((q) => d >= q.top * D.f(q) && d < q.bottom * D.f(q)); if (!s) continue;
    const row = Math.floor(rowAtDepth(s, d / D.f(s))); if (row < s.roi.y0 || row >= s.roi.y1) continue;
    const cv = sectionCanvas(s, lv), k = s._lc.k;
    ctx.drawImage(cv, s.roi.x0 * k, Math.min(cv.height - 1, Math.floor(row * k)), Math.max(1, (s.roi.x1 - s.roi.x0) * k), 1, 0, r, W, 1);
  }
  return c.toDataURL('image/jpeg', 0.88);
}

export function logRecords(D, lv = S.logView, records = S.records, selected = null) {
  const inv = invertModel(D.model), out = [];
  for (const r of records) for (const s of r.series) if (selected ? selected.includes(s.name) : s.show) out.push({ name: s.name, color: s.color, reverse: s.reverse, axis: r.axis, x: s.x, y: s.y, pts: s.x.map((x, i) => [toAxis(x, r.axis, D.axis, D.model, inv), s.y[i]]) });
  // V0.28: width of the age interval (e.g. Bacon 95 %) as one more track, when the age model has it
  const m = S.age.model;
  if (m?.min && lv.tracks.ageErr !== false) {
    const name = t('age.errTrack', { u: S.age.units || 'ka' }), y = m.depth.map((_, i) => m.max[i] - m.min[i]);
    out.push({ name, color: '#6b5e4b', reverse: false, axis: 'depth', x: m.depth, y, pts: m.depth.map((d, i) => [toAxis(d, 'depth', D.axis, D.model, inv), y[i]]) });
  }
  return out;
}

/** V0.23: which image panels the core column shows and how wide the image is. */
function renderImgPanelsForm() {
  const lv = S.logView, st = lv.style || {}, on = new Set(Array.isArray(lv.imgPanels) ? lv.imgPanels : []), asp = st.imgAspect || 'keep';
  $('logImgPanels').innerHTML = `<div class="f"><span>${t('log.panels')}</span><div class="chk2">${FIG_PANELS.map((p) => `<label class="chk"><input type="checkbox" data-imgp="${p}" ${on.has(p) ? 'checked' : ''}><span>${t('fig.p.' + p)}</span></label>`).join('')}</div><p class="note">${t('log.panelsNote')}</p></div>
    <div class="grid2" style="grid-template-columns:minmax(0,1.2fr) minmax(0,.8fr)"><label class="f"><span>${t('log.imgAspect')}</span><select data-st="imgAspect"><option value="keep" ${asp === 'keep' ? 'selected' : ''}>${t('log.asp.keep')}</option><option value="fixed" ${asp === 'fixed' ? 'selected' : ''}>${t('log.asp.fixed')}</option></select></label>
    ${asp === 'keep' ? `<label class="f"><span>${t('log.imgStretch')}</span><input type="number" data-st="imgStretch" min="0.05" step="0.1" value="${esc(st.imgStretch ?? '')}" placeholder="1"></label>` : `<label class="f"><span>${t('log.imgW')}</span><input type="number" data-st="imgW" min="8" max="600" step="2" value="${esc(st.imgW ?? '')}" placeholder="64"></label>`}</div>`;
}
/** V0.23: NO DATA and marker fields of the column style (shared by the core column and the figures). */
export function ndFormHTML(st) {
  const raw = st && typeof st === 'object' && !Array.isArray(st) ? st : {};
  const q = mergedStyle(raw);
  const stroke = validHexColor(raw.markStroke, '#ffffff');
  return `<div class="f"><span>${t('nd.title')}</span><div class="grid2">
    <label class="f"><span>${t('nd.fill')}</span><select data-st="ndFill">${['hatch', 'solid', 'none'].map((v) => `<option value="${v}" ${q.ndFill === v ? 'selected' : ''}>${t('nd.f.' + v)}</option>`).join('')}</select></label>
    <label class="f"><span>${t('nd.colors')}</span><span class="row"><input type="color" data-st="ndColor" value="${esc(q.ndColor)}"><input type="color" data-st="ndLine" value="${esc(q.ndLine)}"></span></label>
    <label class="f"><span>${t('nd.text')}</span><input type="text" data-st="ndText" value="${esc(q.ndText || '')}" placeholder="${esc(t('log.noData'))}"></label>
    <span></span></div><div class="chk2"><label class="chk"><input type="checkbox" data-st="ndShow" ${q.ndShow ? 'checked' : ''}><span>${t('nd.show')}</span></label><label class="chk"><input type="checkbox" data-st="ndLabel" ${q.ndLabel ? 'checked' : ''}><span>${t('nd.label')}</span></label><label class="chk"><input type="checkbox" data-st="ndImage" ${q.ndImage ? 'checked' : ''}><span>${t('nd.image')}</span></label></div></div>
    <div class="f"><span>${t('mk.title')}</span><div class="grid2">
    <label class="f"><span>${t('mk.size')}</span><input type="number" data-st="markSize" min="0.2" max="5" step="0.1" value="${esc(raw.markSize ?? '')}" placeholder="1"></label>
    <label class="f"><span>${t('mk.stroke')}</span><span class="row"><input type="color" data-st="markStroke" value="${esc(stroke)}"><input type="number" data-st="markStrokeW" min="0" max="4" step="0.2" value="${esc(raw.markStrokeW ?? '')}" placeholder="0.8" style="width:60px" title="${esc(t('mk.strokeW'))}"></span></label></div></div>`;
}
/** V0.23: markers and labels of the arrows panel (section figure and core column). */
export function arrowFormHTML() {
  const F = S.fig, ex = new Set(Array.isArray(F.arrowExcl) ? F.arrowExcl : []);
  const stroke = validHexColor(F.markStroke, '#ffffff'), labelColor = validHexColor(F.labelColor, '#1c2422');
  return `<div class="grid2"><label class="f"><span>${t('ar.src')}</span><select id="figArrowSrc">${['all', 'marks', 'objects'].map((v) => `<option value="${v}" ${(F.arrowSrc || 'all') === v ? 'selected' : ''}>${t('ar.src.' + v)}</option>`).join('')}</select></label>
    <label class="f"><span>${t('ar.objScale')}</span><input type="number" id="figObjScale" min="0.2" max="3" step="0.1" value="${esc(F.objScale ?? 1)}"></label>
    <label class="f"><span>${t('mk.size')}</span><input type="number" id="figMarkScale" min="0.2" max="5" step="0.1" value="${esc(F.markScale ?? 1)}"></label>
    <label class="f"><span>${t('mk.stroke')}</span><span class="row"><input type="color" id="figMarkStroke" value="${esc(stroke)}"><input type="number" id="figMarkStrokeW" min="0" max="4" step="0.2" value="${esc(F.markStrokeW ?? 0.8)}" style="width:60px" title="${esc(t('mk.strokeW'))}"></span></label>
    <label class="f"><span>${t('ar.labelSize')}</span><input type="number" id="figLabelSize" min="5" max="30" step="1" value="${esc(F.labelSize ?? 10)}"></label>
    <label class="f"><span>${t('ar.labelColor')}</span><span class="row"><input type="color" id="figLabelColor" value="${esc(labelColor)}"><label class="chk"><input type="checkbox" id="figLabelHalo" ${F.labelHalo !== false ? 'checked' : ''}><span>${t('ar.halo')}</span></label></span></label></div>
    <div class="f"><span>${t('ar.excl')}</span><div class="chk2">${S.classes.filter((c) => c.id !== 'artifact').map((c) => `<label class="chk"><input type="checkbox" data-arex="${esc(c.id)}" ${ex.has(c.id) ? 'checked' : ''}><span>${esc(c.name)}</span></label>`).join('')}</div></div>`;
}

export function buildColumnLog(lv = S.logView, selected = null, figure = false) {
  if (!S.sections.length) return null;
  const D = compositeData(lv.axis);
  const [r0, r1] = rowsRange(D.rows);
  let from = lv.from ?? r0, to = lv.to ?? r1;
  if (!(to > from)) { from = r0; to = r1; }
  const classes = S.classes.map((c, i) => ({ name: c.name, color: c.color, symbol: c.symbol || 'triDown', index: i, counts: c.counts })).filter((c) => c.counts);
  const records = logRecords(D, lv, S.records, selected), imgW = 64;
  const images = lv.tracks.image ? columnImages(D, from, to, lv.height, figure ? lv : S.logView) : null, image = images?.[0] || null;
  const boundaries = D.secs.map((s, i) => { const ax = (v) => (D.axis === 'age' ? interpAge(D.model, v * D.f(s)) : v * D.f(s)); return { a: ax(s.top), a1: ax(s.bottom), label: s.name, n: i + 1 }; }).filter((b) => b.a != null);
  const { style, label: axisLabel } = logStyleOf(D, lv);
  const marks = lv.tracks.marks !== false ? compositeMarks(D) : [], idm = idMode();
  const taxa = figure ? S.fig.taxaStyles?.log ?? lv.style?.taxa : lv.style?.taxa;
  const res = buildLogSVG({
    style, title: S.name, subtitle: idm && !['total', 'species', 'BI', 'ii'].some((k) => lv.tracks[k]) ? t('id.subtitle', { n: marks.length, from: fmt(from, 4), to: fmt(to, 4), u: D.axis === 'age' ? S.age.units : D.base }) : t('log.subtitle', { n: D.secs.length, b: fmt(S.settings.binCm || 1, 3), from: fmt(from, 4), to: fmt(to, 4), u: D.axis === 'age' ? S.age.units : D.base }),
    axisLabel, from, to, height: lv.height, rows: D.rows, classes, tracks: lv.tracks, image, images, imageWidth: image?.w || imgW, records, boundaries,   // V0.2: identification marks and quantified tracks can be shown together
    taxa, taxonPoints: taxa ? compositeTaxonPoints(D) : [],
    taxonClasses: S.classes.map((c, index) => ({ ...c, index })).filter((c) => c.id !== 'artifact'),
    marks, idList: idm || marks.length ? idListOf(D.rows, marks) : null, legendClasses: legendOf(lv.overlay || lv.tracks.species ? classes.filter((c) => D.rows.some((r) => r.classPct?.[c.index] > 0)) : [], marks),
    ...geoOverlay(D.axis, figure ? lv : null),
    labels: { secs: t('log.secs'), noData: t('log.noData'), total: t('log.total'), species: t('log.species'), image: t('log.image'), marks: t('id.marks'), idList: t('id.list') },
    colWidths: lv.colW || {}, respectTaxonColumnVisibility: figure,
  });
  return { ...D, from, to, classes, records, res, axisLabel, svg: res.svg };
}

export function renderLog() {
  $('logStage').querySelector('[data-label-editor]')?.remove();
  const box = $('logSvg');
  if (!S.sections.length) { box.innerHTML = `<p class="note" style="padding:24px">${t('log.empty')}</p>`; lastLog = null; return; }
  const lv = S.logView;
  let log;
  try { log = buildColumnLog(lv); }
  catch (e) { console.error(e); box.innerHTML = `<p class="note">${esc(axisErr(e))}</p>`; lastLog = null; return; }
  const { res, from, to, classes, records, axisLabel } = log, D = log;
  $('logFrom').value = +from.toPrecision(6); $('logTo').value = +to.toPrecision(6);
  lv.colW ||= {};
  box.innerHTML = res.svg;
  lastLog = { ...D, from, to, classes, records, svg: res.svg };
  syncColOrder('log', res.columns);   // V0.33
  editSVGLabels(box, (lv.textEdits ||= {}), (svg) => { if (lastLog) lastLog.svg = svg; });
  const ov = geoOverlay(D.axis);
  logInteract(box, res, { from, to, axisLabel, records, bands: ov.bands || [], widths: lv.colW, onResize: () => { markDirty(); renderLog(); if ($('logStyle')) $('logStyle').innerHTML = styleFormHTML(); },
    extra: (a) => {
      const r = D.rows.find((q) => q.a0 <= a && a < q.a1); if (!r) return [];
      const out = [[t('log.total'), `${fmt(r.pct ?? 0, 3)} %`]];
      if (r.BI != null) out.push(['BI', r.BI]); if (r.ii != null) out.push(['ii', r.ii]);
      classes.map((c) => [c.name, r.classPct?.[c.index] || 0]).filter((q) => q[1] > 0).sort((x, y) => y[1] - x[1]).slice(0, 4).forEach(([n, v]) => out.push([n, `${fmt(v, 3)} %`]));
      return out;
    } });
}

/* Column presentation; explicit view arguments keep figure profiles separate from analysis views. */
const AGE_TO_KA = { a: 0.001, ka: 1, Ma: 1000 };
export function logStyleOf(D, lv = S.logView, ageUnits = S.age.units) {
  const st = mergedStyle(lv?.style);
  let unit, f = 1;
  if (D.axis === 'age') { unit = st.yUnitAge && AGE_TO_KA[st.yUnitAge] && AGE_TO_KA[ageUnits] ? st.yUnitAge : ageUnits; f = AGE_TO_KA[ageUnits] / (AGE_TO_KA[unit] || AGE_TO_KA[ageUnits] || 1) || 1; }
  else { unit = st.yUnit && UNIT_TO_CM[st.yUnit] ? st.yUnit : D.base; f = UNIT_TO_CM[D.base] / UNIT_TO_CM[unit]; }
  return { style: { ...st, yFactor: f }, label: `${t(D.axis === 'age' ? 'r.age' : 'r.depth')} (${unit})` };
}
/* ───────────── V0.33: order and visibility of the columns of every chart ───────────── */
const lastCols = { log: [], geo: [], range: [], figure: [] };
export const colView = (kind) => kind === 'figure' ? figureViewOf(S.fig, S.logView, S.geo.view, S.geo.settings.axis) : kind === 'geo' ? S.geo.view : S.logView;
export function editableColView(kind) {
  if (kind === 'figure') {
    const view = editFigureView(S.fig, S.logView, S.geo.view, S.geo.settings.axis);
    view.overlayAlpha ??= S.ovAlpha;
    return view;
  }
  return colView(kind);
}
export function colOrderHTML(kind) {
  const lv = colView(kind), st = lv.style || {}, hide = new Set(Array.isArray(st.colHide) ? st.colHide : []);
  const cols = orderCols((lastCols[kind] || []).map((c) => ({ ...c })), { colOrder: st.colOrder });
  const li = (c) => `<li draggable="true" data-colid="${esc(c.id)}"><span class="grip" aria-hidden="true">⋮⋮</span><label class="chk"><input type="checkbox" data-colshow="${esc(c.id)}" ${hide.has(c.id) ? '' : 'checked'}><span title="${esc(c.title || c.id)}">${esc(c.title || c.id)}</span></label><button type="button" class="btn small ghost" data-colmv="-1" aria-label="${esc(t('co.up'))}">↑</button><button type="button" class="btn small ghost" data-colmv="1" aria-label="${esc(t('co.down'))}">↓</button></li>`;
  return `<div class="f" data-colord="${esc(kind)}"><span>${t('co.title')}</span>${cols.length ? `<ol class="colord">${cols.map(li).join('')}</ol><p class="note">${t('co.note')}</p>` : `<p class="note">${t('co.empty')}</p>`}</div>`;
}
/** After a chart is built: remember its columns and refresh the list if the set of columns changed. */
export function syncColOrder(kind, columns) {
  if (!columns) return;
  const key = (a) => a.map((c) => c.id).sort().join('|'), changed = key(columns) !== key(lastCols[kind]);
  lastCols[kind] = columns;
  if (changed) document.querySelectorAll(`[data-colord="${kind}"]`).forEach((el) => { el.outerHTML = colOrderHTML(kind); });
}
function afterColChange(kind) {
  markDirty();
  if (kind === 'geo') setTimeout(renderGeoLogs, 0); else { scheduleLog(); requestRender(); }
  if (mode === 'fig') scheduleFigure();
}
function saveColOrder(box) {
  const kind = box.dataset.colord, lv = editableColView(kind); lv.style ||= {};
  lv.style.colOrder = [...box.querySelectorAll('li[data-colid]')].map((l) => l.dataset.colid);
  afterColChange(kind);
}
document.addEventListener('change', (e) => {
  const el = /** @type {HTMLInputElement} */ (e.target); if (el.dataset?.colshow == null) return;
  const box = /** @type {HTMLElement} */ (el.closest('[data-colord]')), lv = editableColView(box.dataset.colord); lv.style ||= {};
  const h = new Set(lv.style.colHide || []); if (el.checked) h.delete(el.dataset.colshow); else h.add(el.dataset.colshow);
  lv.style.colHide = [...h];
  if (box.dataset.colord === 'geo' && el.dataset.colshow === 'band:fam:' + S.geo.activeLayer) $('geoLayerShow').checked = el.checked;
  afterColChange(box.dataset.colord);
});
document.addEventListener('click', (e) => {
  const b = e.target.closest?.('[data-colmv]'); if (!b) return;
  const li = b.closest('li'), box = b.closest('[data-colord]'), d = +b.dataset.colmv;
  const sib = d < 0 ? li.previousElementSibling : li.nextElementSibling; if (!sib) return;
  if (d < 0) sib.before(li); else sib.after(li);
  b.focus(); saveColOrder(box);
});
let colDrag = null;
document.addEventListener('dragstart', (e) => { const li = e.target.closest?.('li[data-colid]'); if (!li) return; colDrag = li; li.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', li.dataset.colid); } catch { /* old browsers */ } });
document.addEventListener('dragover', (e) => {
  if (!colDrag) return; const li = e.target.closest?.('li[data-colid]'); if (!li || li === colDrag || li.parentElement !== colDrag.parentElement) return;
  e.preventDefault(); const r = li.getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) li.before(colDrag); else li.after(colDrag);
});
document.addEventListener('dragend', () => { if (!colDrag) return; const box = colDrag.closest('[data-colord]'); colDrag.classList.remove('dragging'); colDrag = null; if (box) saveColOrder(box); });

const COLOR_FIELDS = {
  log: ['barColor', 'lineColor', 'biColor', 'iiColor', 'manualColor', 'textColor', 'subColor', 'frameColor', 'gridColor', 'boundaryColor', 'bgColor'],
  range: ['barColor', 'textColor', 'subColor', 'frameColor', 'gridColor', 'bgColor'],
  geo: ['barColor', 'lineColor', 'textColor', 'subColor', 'frameColor', 'gridColor', 'bgColor'],
};
export function colorsFormHTML(style, kind) {
  const st = mergedStyle(style), fields = COLOR_FIELDS[kind] || COLOR_FIELDS.log;
  return `<div class="f"><span>${t('color.title')}</span><div class="grid2">${fields.map((key) => `<label class="f"><span>${t('color.' + key)}</span><input type="color" data-st="${key}" value="${esc(st[key])}"></label>`).join('')}</div><button type="button" class="btn small" data-colreset="${esc(kind)}">${t('color.reset')}</button><p class="note">${t('color.note')}</p></div>`;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-colreset]'); if (!b) return;
  const kind = b.dataset.colreset, figure = !!b.closest('[data-figure-style]'), lv = editableColView(figure ? 'figure' : kind);
  lv.style ||= {}; for (const key of COLOR_FIELDS[kind] || COLOR_FIELDS.log) delete lv.style[key];
  markDirty();
  if (figure) { renderFigPanel(); scheduleFigure(); }
  else if (kind === 'geo') { $('geoStyleForm').innerHTML = ''; renderGeoLogs(); }
  else { renderLogPanel(); scheduleLog(); if (mode === 'fig') { renderFigPanel(); scheduleFigure(); } }
});
/** V0.69: ruler-style vertical scale — number, long, medium and short ticks, each with its own interval and length. */
export function tickFieldsHTML(st) {
  const f = (k, step, min, ph) => `<label class="f"><span>${t('st.' + k)}</span><input type="number" data-st="${k}" step="${step}" min="${min}" value="${esc(st?.[k] ?? '')}" placeholder="${esc(ph)}"></label>`;
  const none = t('st.none'), auto = t('fig.auto2'), au = t('st.auto');
  return `${f('yStep', 'any', 0, au)}${f('yDiv', 1, 1, au)}${f('yMajor', 'any', 0, none)}${f('yMedium', 'any', 0, none)}${f('yMinor', 'any', 0, none)}<span></span>
    ${f('yLabelLen', 0.5, 0.5, 6)}${f('yMajorLen', 0.5, 0.5, 6)}${f('yMediumLen', 0.5, 0.5, 4.5)}${f('yMinorLen', 0.5, 0.5, 3)}
    <div class="f" style="grid-column:1/-1"><span>${t('st.ruler')}</span><span class="row"><input type="number" data-rulern step="any" min="0" value="${esc(rulerN)}" placeholder="1" style="max-width:6em"><button type="button" class="btn small" data-rulerbtn title="${esc(t('st.rulerTip'))}">${t('st.rulerGo')}</button></span></div>
    <p class="note" style="grid-column:1/-1;margin:0">${t('st.tickHelp')}</p>`;
}
/* V0.74: one-click ruler scale. The panel is redrawn after every change, so each field is looked up again. */
let rulerN = '';
document.addEventListener('input', (e) => { if (e.target.dataset?.rulern != null) rulerN = e.target.value; });
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-rulerbtn]'); if (!b) return;
  const n = +b.closest('.f').querySelector('[data-rulern]').value;
  if (!(n > 0)) { toast(t('st.rulerNeed')); return; }
  const r = (x) => String(+x.toFixed(6));
  for (const [k, v] of [['yMinor', r(n)], ['yMedium', r(5 * n)], ['yStep', r(10 * n)], ['yMajor', ''], ['yMinorLen', '3'], ['yMediumLen', '5'], ['yLabelLen', '8']]) {
    const el = [...document.querySelectorAll(`input[data-st="${k}"]`)].find((x) => x.offsetParent);
    if (el) { el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }
  }
});
export function styleFormHTML(showTaxa = true, lv = S.logView, kind = 'log') {
  const st = mergedStyle(lv?.style), num = (k, lab, step = 'any', min = 0) => `<label class="f"><span>${t(lab)}</span><input type="number" data-st="${k}" step="${step}" min="${min}" value="${esc(st[k] ?? '')}" placeholder="${esc(t('fig.auto2'))}"></label>`;
  const chk = (k, lab) => `<label class="chk"><input type="checkbox" data-st="${k}" ${st[k] ? 'checked' : ''}><span>${t(lab)}</span></label>`;
  const sel = (k, lab, opts) => `<label class="f"><span>${t(lab)}</span><select data-st="${k}">${opts.map(([v, l]) => `<option value="${v}" ${String(st[k] ?? '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
  return `${colOrderHTML(kind)}<div class="grid2">
    ${sel('yUnit', 'st.yUnit', [['', t('st.native')], ['m', 'm'], ['cm', 'cm'], ['mm', 'mm']])}
    ${sel('yUnitAge', 'st.yUnitAge', [['', t('st.native')], ['a', 'a'], ['ka', 'ka'], ['Ma', 'Ma']])}
    ${tickFieldsHTML(st)}
    ${num('fontSize', 'st.fontSize', 1, 6)}</div>
    <div class="chk2">${chk('frame', 'st.frame')}${chk('grid', 'st.grid')}${chk('boundaries', 'st.boundaries')}${chk('showTitle', 'st.showTitle')}</div>
    ${colorsFormHTML(st, 'log')}${showTaxa ? (kind === 'figure' ? taxaFormHTML(taxaOptions(S.fig.taxaStyles?.[S.fig.type] ?? st.taxa, { style: st })) : speciesFormHTML(st)) : ''}
    ${ndFormHTML(st)}
    ${axesFormHTML(null, lv)}`;
}
/** V0.31: ichnotaxa shown in «By ichnotaxon» (and the distribution chart), stacked or each in its own column. */
export function speciesFormHTML(st) {
  return taxaFormHTML(taxaOptions(st.taxa, { style: st }), 'column');
}
/** Figure-specific controls use the same vocabulary and settings as the core column. */
export function taxaFormHTML(q, scope = 'figure') {
  const select = (key, choices) => `<label class="f"><span>${t('taxa.' + key)}</span><select data-taxa="${key}">${choices.map((value) =>
    `<option value="${value}" ${q[key] === value ? 'selected' : ''} ${key === 'layout' && value === 'stack' && ['none', 'kite'].includes(q.abundance) ? 'disabled' : ''}>${t('taxa.' + key + '.' + value)}</option>`).join('')}</select></label>`;
  const names = S.classes.filter((c) => c.id !== 'artifact').map((c) => c.name), hidden = new Set(q.hidden);
  return `<div class="f" data-taxa-scope="${scope}"><span>${t('sp.title')}</span><div class="grid2">
    ${select('layout', ['stack', 'overlay', 'separate'])}${select('abundance', ['none', 'bars', 'line', 'area', 'kite'])}
    ${select('occurrence', ['none', 'symbols', 'names', 'both'])}${select('source', ['all', 'objects', 'marks'])}
    ${select('scale', ['auto', 'percent'])}<label class="f"><span>${t('taxa.opacity')}</span><input type="number" data-taxa="opacity" min="0" max="100" step="5" value="${Math.round(q.opacity * 100)}"></label></div>
    <label class="chk"><input type="checkbox" data-taxa="values" ${q.values ? 'checked' : ''}><span>${t('taxa.values')}</span></label>
    <div class="chk2">${names.map((name) => `<label class="chk"><input type="checkbox" data-taxa-hide="${esc(name)}" ${hidden.has(name) ? '' : 'checked'}><span><i>${esc(name)}</i></span></label>`).join('')}</div>
    <div class="row"><button type="button" class="btn small" data-taxa-all="1">${t('mp.all')}</button><button type="button" class="btn small" data-taxa-all="0">${t('mp.none')}</button></div>
    <p class="note">${t('taxa.note')}</p><button type="button" class="btn small ghost" data-taxa-reset>${t('taxa.reset')}</button></div>`;
}

function changeTaxaPresentation(el, reset = false) {
  const figure = el.closest('[data-taxa-scope]')?.dataset.taxaScope === 'figure', F = S.fig;
  const context = { style: (figure ? colView('figure') : S.logView).style || {}, range: figure && F.type === 'range', display: F.rangeDisplay, source: F.rangeSrc || 'all' };
  if (figure && F.type === 'geolog') context.style = { ...context.style, colHide: [] };
  const current = figure ? F.taxaStyles?.[F.type] ?? (['core', 'log'].includes(F.type) ? colView('figure').style?.taxa : undefined) : S.logView.style?.taxa;
  const q = taxaOptions(current, context);
  const rebuild = reset || ['layout', 'abundance', 'occurrence', 'source'].includes(el.dataset.taxa);
  if (el.dataset.taxaAll != null) {
    q.hidden = el.dataset.taxaAll === '1' ? [] : S.classes.filter((c) => c.id !== 'artifact').map((c) => c.name);
  } else if (el.dataset.taxaHide != null) {
    const hidden = new Set(q.hidden); if (el.checked) hidden.delete(el.dataset.taxaHide); else hidden.add(el.dataset.taxaHide); q.hidden = [...hidden];
  } else if (el.dataset.taxa) {
    const key = el.dataset.taxa;
    q[key] = el.type === 'checkbox' ? el.checked : key === 'opacity' ? (el.value === '' ? 1 : +el.value / 100) : el.value;
  }
  if (figure) {
    const enableTaxa = !reset && F.type === 'geolog' && !colView('figure').tracks?.species;
    if (enableTaxa) { const view = editableColView('figure'); view.tracks = { ...view.tracks, species: true }; }
    F.taxaStyles ||= {};
    if (reset) delete F.taxaStyles[F.type]; else F.taxaStyles[F.type] = taxaOptions(q, context);
    if (!reset && F.type === 'range' && !F.rangeColW) F.rangeColW = ['names', 'both'].includes(q.occurrence) ? 120 : 70;
    if (rebuild || enableTaxa || el.dataset.taxaAll != null) renderFigPanel(); scheduleFigure();
  } else {
    S.logView.style ||= {};
    if (reset) delete S.logView.style.taxa; else S.logView.style.taxa = taxaOptions(q, context);
    if (rebuild || el.dataset.taxaAll != null) $('logStyle').innerHTML = styleFormHTML(); scheduleLog();
  }
  markDirty();
}
document.addEventListener('click', (e) => {
  const el = e.target instanceof Element ? e.target.closest('[data-taxa-reset], [data-taxa-all]') : null;
  if (el) changeTaxaPresentation(el, el.hasAttribute('data-taxa-reset'));
});
/** V0.6: width and axis format of each column at the right of the core (total, ichnotaxa, BI, ii and records). */
export function axesFormHTML(only = null, lv = S.logView, recNames = null) {
  const ax = lv.style?.axes || {}, W = lv.colW || {};
  const recs = recNames || [...new Set(S.records.flatMap((r) => r.series.map((x) => x.name)))];
  const figureTaxa = mode === 'fig' && lv !== S.logView ? S.fig.taxaStyles?.[S.fig.type] : null;
  const sep = (figureTaxa || lv.style?.taxa)?.layout === 'separate' || (!(figureTaxa || lv.style?.taxa) && lv.style?.speciesMode === 'separate');
  const spHide = new Set(Array.isArray(lv.style?.speciesHide) ? lv.style.speciesHide : []);
  const spCols = sep ? S.classes.filter((c) => c.counts !== false && c.id !== 'artifact' && !spHide.has(c.name)).map((c) => ['sp:' + c.name, c.name, 70]) : [['species', t('log.species'), 150]];
  const cols = [['secs', t('log.secs'), 40], ['total', t('log.total'), 150], ...spCols, ['BI', 'BI', 46], ['ii', 'ii', 46], ...recs.map((n) => ['rec:' + n, n, 120])];
  /* V0.75: the settings of the two percentage columns (title, shape of the bioturbation column, divisions) live in their table rows. */
  const pct = (id) => id === 'total' || id === 'species' || id.startsWith('sp:'), pctDiv = Math.round(lv.style?.pctDiv) || 4, stl = lv.style || {};
  const sub = (id) => {
    if (id === 'secs') return `<tr class="axsub"><td></td><td colspan="8"><span style="display:grid;gap:6px;width:270px;max-width:100%;text-align:left"><label class="f"><span>${t('st.secOrient')}</span><select data-st="secOrient"><option value="v" ${stl.secOrient !== 'h' ? 'selected' : ''}>${t('st.secV')}</option><option value="h" ${stl.secOrient === 'h' ? 'selected' : ''}>${t('st.secH')}</option></select></label><label class="f"><span>${t('st.secLabel')}</span><select data-st="secLabel"><option value="name" ${stl.secLabel !== 'num' ? 'selected' : ''}>${t('st.secName')}</option><option value="num" ${stl.secLabel === 'num' ? 'selected' : ''}>${t('st.secNum')}</option></select></label></span></td></tr>`;
    if (id !== 'total' && id !== 'species') return '';
    const title = id === 'total' ? 'totalTitle' : 'speciesTitle', lab = id === 'total' ? 'st.totalTitle' : 'st.speciesTitle', ph = id === 'total' ? 'log.total' : 'log.species';
    const shape = id === 'total' ? `<label class="f"><span>${t('st.totalStyle')}</span><select data-st="totalStyle">${['barsline', 'bars', 'line', 'points'].map((v) => `<option value="${v}" ${(stl.totalStyle || 'barsline') === v ? 'selected' : ''}>${t('st.ts.' + v)}</option>`).join('')}</select></label>` : '';
    return `<tr class="axsub"><td></td><td colspan="8"><span style="display:grid;gap:6px;width:270px;max-width:100%;text-align:left"><label class="f"><span>${t(lab)}</span><input type="text" data-st="${title}" value="${esc(stl[title] || '')}" placeholder="${esc(t(ph))}"></label>${shape}</span></td></tr>`;
  };
  const cell = (id, k, ph, step = 'any') => `<input type="number" data-ax="${esc(id)}" data-k="${k}" step="${step}" value="${esc(ax[id]?.[k] ?? '')}" placeholder="${esc(ph)}" aria-label="${esc(id + ' ' + k)}" style="width:100%;min-width:54px">`;
  return `<div class="f"><span>${t('st.axes')}</span><div style="overflow-x:auto"><table class="axtab" style="font-size:11px;border-collapse:collapse;width:100%">
    <tr><th></th><th>${t('st.ax.w')}</th><th>${t('st.ax.min')}</th><th>${t('st.ax.max')}</th><th>${t('st.ax.div')}</th><th>${t('st.ax.dec')}</th><th>${t('edit.step')}</th><th title="${esc(t('st.ax.revTip'))}">⇄</th><th title="${esc(t('st.ax.logTip'))}">log</th></tr>
    ${cols.filter(([id]) => !only || only.includes(id)).map(([id, name, w]) => `<tr><td title="${esc(name)}" style="max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}</td>
      <td><input type="number" data-axw="${esc(id)}" min="30" max="600" step="10" value="${esc(W[id] ?? '')}" placeholder="${esc(w)}" style="width:100%"></td>
      <td>${cell(id, 'min', 'auto')}</td><td>${cell(id, 'max', 'auto')}</td><td>${cell(id, 'div', pct(id) ? String(pctDiv) : 'auto', 1)}</td><td>${cell(id, 'dec', 'auto', 1)}</td><td>${cell(id, 'step', 'auto')}</td>
      <td><input type="checkbox" data-ax="${esc(id)}" data-k="rev" ${ax[id]?.rev ? 'checked' : ''}></td>
      <td><input type="checkbox" data-ax="${esc(id)}" data-k="log" ${ax[id]?.log ? 'checked' : ''}></td></tr>${sub(id)}`).join('')}
    </table></div><p class="note">${t('st.axesNote')}</p></div>`;
}
export function onStyleInput(e) {
  if (e.target.dataset.taxa || e.target.dataset.taxaHide != null) { changeTaxaPresentation(e.target); return; }
  const el = e.target, geo = !!el.closest('[data-stt="geo"]'), figure = !!el.closest('[data-figure-style]'), lv = editableColView(figure ? 'figure' : geo ? 'geo' : 'log');
  if (geo) setTimeout(renderGeoLogs, 0);
  if (el.dataset.axw != null) { lv.colW ||= {}; const v = +el.value; if (v >= 30) lv.colW[el.dataset.axw] = Math.min(600, v); else delete lv.colW[el.dataset.axw]; markDirty(); scheduleLog(); if (mode === 'fig') scheduleFigure(); return; }
  if (el.dataset.ax != null) {
    lv.style ||= {}; lv.style.axes ||= {}; const a = (lv.style.axes[el.dataset.ax] ||= {}), k2 = el.dataset.k;
    const previous = a[k2];
    a[k2] = el.type === 'checkbox' ? el.checked : el.value === '' ? null : +el.value;
    const invalid = (a.min != null && a.max != null && !(a.max > a.min)) || (a.log && ((a.min != null && a.min <= 0) || (a.max != null && a.max <= 0)));
    if (invalid) { a[k2] = previous; el.setCustomValidity(t('edit.invalidAxis')); el.reportValidity(); return; }
    el.setCustomValidity('');
    markDirty(); scheduleLog(); if (mode === 'fig') scheduleFigure(); return;
  }
  if (el.dataset.sph != null) {   // V0.31: ichnotaxa shown
    lv.style ||= {}; const h = new Set(lv.style.speciesHide || []); if (el.checked) h.delete(el.dataset.sph); else h.add(el.dataset.sph);
    lv.style.speciesHide = [...h]; markDirty(); scheduleLog(); requestRender(); if (mode === 'fig') scheduleFigure(); return;
  }
  const k = el.dataset.st; if (!k) return;
  lv.style ||= {};
  if (el.type === 'checkbox') lv.style[k] = el.checked;
  else if (el.type === 'number') lv.style[k] = el.value === '' ? null : Math.max(0, +el.value);
  else lv.style[k] = el.value;
  markDirty(); scheduleLog(); if (mode === 'fig') scheduleFigure();
}
export function renderLogPanel() {
  if ($('logStyle')) $('logStyle').innerHTML = styleFormHTML();
  const lv = S.logView;
  $('logAxis').value = lv.axis === 'age' && S.age.model ? 'age' : 'depth';
  $('logHeight').value = lv.height; $('logHeightOut').textContent = lv.height + ' px';
  renderImgPanelsForm();
  $('logImgMode').value = lv.imgMode; $('logOverlay').checked = lv.overlay; $('logHideExcl').checked = !!lv.hideExcl;
  document.querySelectorAll('#logTracks [data-track]').forEach((el) => (el.checked = ['ageErr', 'marks'].includes(el.dataset.track) ? lv.tracks[el.dataset.track] !== false : !!lv.tracks[el.dataset.track]));
}

$('logStyle').addEventListener('change', onStyleInput);   // V0.5
$('geoStyleForm').addEventListener('change', onStyleInput);   // V0.22
$('geoLayerShow').addEventListener('change', (e) => {   // V0.33: hide or show the active interval family in every chart, without deleting it
  const id = 'band:fam:' + S.geo.activeLayer;
  for (const lv of [S.geo.view, S.logView]) { lv.style ||= {}; const h = new Set(lv.style.colHide || []); if (e.target.checked) h.delete(id); else h.add(id); lv.style.colHide = [...h]; }
  document.querySelectorAll('[data-colshow]').forEach((c) => { if (c.dataset.colshow === id) c.checked = e.target.checked; });
  markDirty(); setTimeout(renderGeoLogs, 0); scheduleLog();
});
$('logPanel').addEventListener('change', (e) => {
  if (e.target.closest('#logStyle')) return;
  const el = e.target, lv = S.logView;
  if (el.closest('#logImgPanels') && el.dataset.st) { onStyleInput(e); renderImgPanelsForm(); return; }   // V0.23
  if (el.dataset.imgp) { lv.imgPanels = [...$('logImgPanels').querySelectorAll('[data-imgp]:checked')].map((i) => i.dataset.imgp); }
  else if (el.dataset.track) lv.tracks[el.dataset.track] = el.checked;
  else if (el.id === 'logAxis') { lv.axis = el.value; lv.from = lv.to = null; }
  else if (el.id === 'logFrom' || el.id === 'logTo') { const a = parseFloat($('logFrom').value), b = parseFloat($('logTo').value); if (b > a) { lv.from = a; lv.to = b; } }
  else if (el.id === 'logImgMode') lv.imgMode = el.value;
  else if (el.id === 'logOverlay') lv.overlay = el.checked;
  else if (el.id === 'logHideExcl') lv.hideExcl = el.checked;
  else if (el.id === 'logHeight') lv.height = +el.value;
  else if (el.closest('#recList')) return;
  else return;
  markDirty(); scheduleLog(50);
});
$('logHeight').addEventListener('input', (e) => { $('logHeightOut').textContent = e.target.value + ' px'; });
$('logAll').addEventListener('click', () => { S.logView.from = S.logView.to = null; markDirty(); scheduleLog(0); });
$('logSVGBtn').addEventListener('click', () => { if (lastLog) saveFile(`${safe(S.name)}_registro.svg`, lastLog.svg, 'image/svg+xml'); });
$('logCSVBtn').addEventListener('click', () => {
  if (!lastLog) return;
  saveFile(`${safe(S.name)}_registro.csv`, withProv(windowCSV({ rows: lastLog.rows, from: lastLog.from, to: lastLog.to, classes: lastLog.classes, records: lastLog.records, units: lastLog.base, ageUnits: S.age.units })), 'text/csv');
});

/* external records (CSV, TXT, Excel) */
// V0.27: record colours told apart in print and by colour-blind readers, away from the ochre of bioturbation
const REC_COLORS = ['#0b5394', '#1b7f6a', '#8c2d5a', '#5c4ea0', '#0e7490', '#3c7d22', '#6b5e4b'];
let pendingTable = null;

export function addRecordFromTable(name, tab, xCol, axis, yCols) {
  const n0 = S.records.reduce((k, r) => k + r.series.length, 0);
  const series = recordSeries(tab, xCol, yCols, REC_COLORS, n0);   // V0.44: exportio.js
  if (!series.length) return false;
  S.records.push({ id: uid(), name, axis, series });
  renderRecList(); markDirty(); scheduleLog();
  return true;
}

export function renderRecList() {
  $('recList').innerHTML = S.records.map((r) => `
    <div class="rec" data-id="${esc(r.id)}">
      <div class="row" style="justify-content:space-between;flex-wrap:nowrap"><b>${esc(r.name)}</b><button class="btn small ghost" data-del="1" aria-label="${esc(t('a11y.delete'))}">✕</button></div>
      <span class="note">${t(r.axis === 'age' ? 'log.age' : 'log.depth')} · ${r.series[0]?.x.length || 0} ${t('log.points')}</span>
      ${r.series.map((s, i) => `<div class="row srow"><label class="chk"><input type="checkbox" data-s="${i}" data-k="show" ${s.show ? 'checked' : ''}><span>${esc(s.name)}</span></label>
        <input type="color" data-s="${i}" data-k="color" value="${esc(validHexColor(s.color, REC_COLORS[i % REC_COLORS.length]))}" aria-label="${esc(t('a11y.color'))}">
        <label class="chk note"><input type="checkbox" data-s="${i}" data-k="reverse" ${s.reverse ? 'checked' : ''}>${t('log.reverse')}</label></div>`).join('')}
    </div>`).join('') || `<p class="note">${t('log.noRecords')}</p>`;
}
$('recList').addEventListener('change', (e) => {
  const box = e.target.closest('.rec'), r = S.records.find((x) => x.id === box?.dataset.id); if (!r) return;
  const s = r.series[+e.target.dataset.s]; if (!s) return;
  const k = e.target.dataset.k; s[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  markDirty(); scheduleLog(50);
});
$('recList').addEventListener('click', (e) => {
  if (!e.target.dataset.del) return;
  if (!armed(e.target, '?')) return;
  const id = e.target.closest('.rec').dataset.id;
  S.records.splice(S.records.findIndex((r) => r.id === id), 1); renderRecList(); markDirty(); scheduleLog(0);
});

$('recFile').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const tab = await readTableFile(f);
    if (tab.headers.length < 2 || !tab.rows.length) throw new Error(t('rec.short'));
    pendingTable = tab;
    const g = guessAxisColumn(tab.headers);
    $('recName').value = f.name.replace(/\.[^.]+$/, '');
    $('recX').innerHTML = tab.headers.map((h, i) => `<option value="${i}" ${i === g.col ? 'selected' : ''}>${esc(h)}</option>`).join('');
    $('recAxis').value = g.axis;
    const fillCols = () => {
      const xc = +$('recX').value;
      $('recCols').innerHTML = tab.headers.map((h, i) => i === xc ? '' : `<label class="chk"><input type="checkbox" value="${i}" ${tab.rows.some((r) => r[i] != null) ? 'checked' : 'disabled'}><span>${esc(h)}</span></label>`).join('');
    };
    $('recX').onchange = fillCols; fillCols();
    $('recDlg').showModal();
  } catch (err) { toast(t('rec.err', { m: err.message || err })); }
});
$('recCancel').addEventListener('click', () => $('recDlg').close());
$('recAdd').addEventListener('click', () => {
  if (!pendingTable) return;
  const cols = [...$('recCols').querySelectorAll('input:checked')].map((i) => +i.value);
  if (addRecordFromTable($('recName').value.trim() || 'Registro', pendingTable, +$('recX').value, $('recAxis').value, cols)) $('recDlg').close();
  else toast(t('rec.err', { m: t('rec.short') }));
});
