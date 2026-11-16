/* Data tab: all data of the project, Grapher-like plots and the spreadsheet view. */
import { t, fxText } from './i18n.js';
import { $, S, fmt } from './state.js';
import { armed, busy, cellEdit, curCore, editCount, esc, markDirty, refreshAllCores, refreshCoreData, safe, saveFile, toast, view, withProv } from './app.js';
import { geoCat, geoRT } from './multiproxy.js';
import { mode } from './columns.js';

import { FIT_KINDS, PLOT_COLORS, PLOT_TYPES, buildStratPlot, buildXYPlot } from './plot.js';

import { toCSV } from './core.js';
import { csvCommentText } from './exportio.js';
import { mountTableViewport } from './tableview.js';
import { createIntervalLookup, intervalsOnAxis } from './geo.js';
import { FUNCTIONS, cellName, evalCells, parseFormula } from './sheet.js';

/* ───────────── data tab: all data of the project, computed and manual columns, free cells ───────────── */

/* ───────────── data tab: Grapher-like plots (V21) ───────────── */
const defaultPlot = (n = 1) => ({ name: `${t('pl.plot')} ${n}`, layout: 'strat', cores: S.curCore ? [S.curCore] : [], v: 'depth', ys: [], title: '', width: 900, height: 620, panelWidth: 150,
  legend: true, grid: true, xmin: null, xmax: null, ymin: null, ymax: null, xlog: false, ylog: false, xinv: false, yinv: false, y2label: '' });
const plotCol = (c, name) => (name === 'depth' ? c.depth : name === 'age' ? c.age : c.proxies?.[name]) || [];
function plotColumns() { const s = new Set(); for (const c of S.cores) Object.keys(c.proxies || {}).forEach((k) => s.add(k)); return [...s].sort(); }
const curPlot = () => { S.plots ||= []; if (!S.plots.length) S.plots.push(defaultPlot()); S.plotCur = Math.min(S.plotCur || 0, S.plots.length - 1); return S.plots[S.plotCur]; };
let plotLast = null;

function plotSpec(p) {
  const cores = S.cores.filter((c) => p.cores.includes(c.id)), axisName = (k) => (k === 'depth' ? `${t('log.depth')} (${cores[0]?.units || ''})` : k === 'age' ? `${t('log.age')} (ka)` : k);
  const num = (v) => (v === '' || v == null ? null : +v);
  if (p.layout === 'strat') {
    return { kind: 'strat', spec: { title: p.title, width: p.width, height: p.height, panelWidth: p.panelWidth, legend: p.legend, grid: p.grid, v: { label: axisName(p.v), min: num(p.ymin), max: num(p.ymax), invert: !p.yinv },
      panels: p.ys.map((y) => ({ label: y.col, log: y.log, invert: y.inv, fit: y.fit, deg: y.deg, window: y.window, series: cores.map((c, k) => ({ name: c.name, core: c.name, x: plotCol(c, p.v), y: plotCol(c, y.col), type: y.type, color: cores.length > 1 ? PLOT_COLORS[k % PLOT_COLORS.length] : (y.color || PLOT_COLORS[0]) })) })) } };
  }
  const series = [];
  p.ys.forEach((y, i) => cores.forEach((c, k) => series.push({ name: cores.length > 1 ? `${y.col} · ${c.name}` : y.col, x: plotCol(c, p.v), y: plotCol(c, y.col), type: y.type, y2: y.y2, fit: y.fit, deg: y.deg, window: y.window,
    color: cores.length > 1 && p.ys.length === 1 ? PLOT_COLORS[k % PLOT_COLORS.length] : y.color || PLOT_COLORS[(i * Math.max(1, cores.length) + k) % PLOT_COLORS.length], dash: cores.length > 1 && p.ys.length > 1 && k ? '4 2' : null })));
  return { kind: 'xy', spec: { title: p.title, width: p.width, height: p.height, legend: p.legend, grid: p.grid, series,
    x: { label: axisName(p.v), min: num(p.xmin), max: num(p.xmax), log: p.xlog, invert: p.xinv },
    y: { label: p.ys.filter((y) => !y.y2).map((y) => y.col).join(', '), min: num(p.ymin), max: num(p.ymax), log: p.ylog, invert: p.yinv },
    y2: { label: p.y2label || p.ys.filter((y) => y.y2).map((y) => y.col).join(', ') } } };
}

function renderDataPlot() {
  const p = curPlot(), cols = plotColumns(), box = $('dBody');
  if (!p.ys.length && cols.length) p.ys.push({ col: cols[0], type: 'line', y2: false, fit: 'none', deg: 2, window: 5, log: false, inv: false, color: '' });
  const opt = (list, v) => list.map(([k, n]) => `<option value="${esc(k)}" ${String(k) === String(v) ? 'selected' : ''}>${esc(n)}</option>`).join('');
  const axisOpts = [['depth', t('log.depth')], ['age', t('log.age')], ...cols.map((c) => [c, c])];
  const ck = (k, l) => `<label class="chk"><input type="checkbox" data-p="${k}" ${p[k] ? 'checked' : ''}><span>${t(l)}</span></label>`;
  const nm = (k, l, w = 80) => `<label class="f"><span>${t(l)}</span><input type="number" step="any" data-p="${k}" value="${p[k] ?? ''}" style="width:${w}px"></label>`;
  const yRows = p.ys.map((y, i) => `<div class="prow2" data-y="${i}">
      <select data-yk="col">${opt(cols.map((c) => [c, c]), y.col)}</select>
      <select data-yk="type">${opt(PLOT_TYPES.map((k) => [k, t('pl.t.' + k)]), y.type)}</select>
      <select data-yk="fit">${opt(FIT_KINDS.map((k) => [k, t('pl.f.' + k)]), y.fit)}</select>
      ${y.fit === 'poly' ? `<input type="number" data-yk="deg" min="2" max="6" value="${y.deg}" title="${t('pl.deg')}" style="width:50px">` : ''}${y.fit === 'movavg' ? `<input type="number" data-yk="window" min="3" max="99" step="2" value="${y.window}" title="${t('pl.window')}" style="width:56px">` : ''}
      ${p.layout === 'xy' ? `<label class="chk"><input type="checkbox" data-yk="y2" ${y.y2 ? 'checked' : ''}><span>Y2</span></label>` : `<label class="chk"><input type="checkbox" data-yk="log" ${y.log ? 'checked' : ''}><span>log</span></label><label class="chk"><input type="checkbox" data-yk="inv" ${y.inv ? 'checked' : ''}><span>${t('pl.inv')}</span></label>`}
      <input type="color" data-yk="color" value="${y.color || PLOT_COLORS[i % PLOT_COLORS.length]}" title="${t('pl.color')}">
      <button class="btn small ghost" data-pa="dely" title="${t('pl.del')}">×</button></div>`).join('');
  box.innerHTML = `<div class="plotwrap"><div class="pctl">
    <div class="row"><select id="plSel" style="flex:1">${opt(S.plots.map((q, i) => [i, q.name]), S.plotCur)}</select><button class="btn small" data-pa="new">+</button><button class="btn small" data-pa="dup">${t('pl.dup')}</button><button class="btn small ghost" data-pa="del">×</button></div>
    <label class="f"><span>${t('pl.name')}</span><input type="text" data-p="name" value="${esc(p.name)}"></label>
    <label class="f"><span>${t('pl.layout')}</span><select data-p="layout">${opt([['strat', t('pl.l.strat')], ['xy', t('pl.l.xy')]], p.layout)}</select></label>
    <p class="note">${t('pl.l.' + p.layout + 'Help')}</p>
    <div class="f"><span>${t('pl.cores')}</span><div class="chklist">${S.cores.map((c) => `<label class="chk"><input type="checkbox" data-core="${c.id}" ${p.cores.includes(c.id) ? 'checked' : ''}><span>${esc(c.name)}</span></label>`).join('')}</div></div>
    <label class="f"><span>${t(p.layout === 'strat' ? 'pl.vaxis' : 'pl.xaxis')}</span><select data-p="v">${opt(axisOpts, p.v)}</select></label>
    <div class="f"><span>${t(p.layout === 'strat' ? 'pl.panels' : 'pl.yvars')}</span>${yRows}<button class="btn small" data-pa="addy">+ ${t('pl.addy')}</button></div>
    <details><summary>${t('pl.axes')}</summary><div class="row" style="margin-top:6px">
      ${p.layout === 'xy' ? nm('xmin', 'pl.xmin') + nm('xmax', 'pl.xmax') + ck('xlog', 'pl.xlog') + ck('xinv', 'pl.xinv') : ''}
      ${nm('ymin', p.layout === 'strat' ? 'pl.vmin' : 'pl.ymin') + nm('ymax', p.layout === 'strat' ? 'pl.vmax' : 'pl.ymax')}${p.layout === 'xy' ? ck('ylog', 'pl.ylog') : ''}${ck('yinv', p.layout === 'strat' ? 'pl.vup' : 'pl.yinv')}
      ${p.layout === 'xy' ? `<label class="f"><span>${t('pl.y2label')}</span><input type="text" data-p="y2label" value="${esc(p.y2label || '')}"></label>` : ''}</div></details>
    <details><summary>${t('pl.look')}</summary><div class="row" style="margin-top:6px">
      <label class="f" style="flex-basis:100%"><span>${t('pl.title')}</span><input type="text" data-p="title" value="${esc(p.title || '')}"></label>
      ${nm('width', 'pl.width') + nm('height', 'pl.height')}${p.layout === 'strat' ? nm('panelWidth', 'pl.pw') : ''}${ck('legend', 'pl.legend')}${ck('grid', 'pl.grid')}</div></details>
    <div class="row"><button class="btn small primary" data-pa="svg">SVG</button><button class="btn small" data-pa="png">PNG ×3</button><button class="btn small" data-pa="csv">CSV</button></div>
  </div><div class="pout" id="plOut"></div></div>`;
  drawDataPlot();
}
function drawDataPlot() {
  const p = curPlot(), out = $('plOut'); if (!out) return;
  if (!p.cores.length || !p.ys.length) { out.innerHTML = `<p class="note">${t('pl.empty')}</p>`; plotLast = null; return; }
  const { kind, spec } = plotSpec(p), r = kind === 'strat' ? buildStratPlot(spec) : buildXYPlot(spec);
  plotLast = { ...r, spec, kind };
  const f3 = (v) => (v == null || !Number.isFinite(v) ? '—' : +v.toPrecision(4));
  out.innerHTML = `<div class="psvg">${r.svg}</div>
    ${r.fits.length ? `<h4>${t('pl.fits')}</h4><table class="dtable mtab"><thead><tr><th>${t('pl.series')}</th><th>${t('pl.eq')}</th><th>R²</th><th>n</th></tr></thead><tbody>${r.fits.map((f) => `<tr><td class="txt">${esc(f.name)}</td><td class="txt">${esc(f.eq)}</td><td>${f3(f.r2)}</td><td>${f.n}</td></tr>`).join('')}</tbody></table>` : ''}
    <h4>${t('pl.stats')}</h4><table class="dtable mtab"><thead><tr><th>${t('pl.series')}</th><th>n</th><th>${t('pl.mean')}</th><th>${t('pl.sd')}</th><th>${t('pl.min')}</th><th>${t('pl.median')}</th><th>${t('pl.max')}</th>${kind === 'xy' ? '<th>r (X, Y)</th>' : ''}</tr></thead><tbody>${r.stats.map((q) => `<tr><td class="txt">${esc(q.name)}</td><td>${q.n}</td><td>${f3(q.mean)}</td><td>${f3(q.sd)}</td><td>${f3(q.min)}</td><td>${f3(q.median)}</td><td>${f3(q.max)}</td>${kind === 'xy' ? `<td>${f3(q.r)}</td>` : ''}</tr>`).join('')}</tbody></table>`;
}
$('dBody').addEventListener('change', (e) => {
  if ($('dView').value !== 'plot') return;
  const el = e.target, p = curPlot(), val = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (el.value === '' ? null : +el.value) : el.value;
  if (el.id === 'plSel') { S.plotCur = +el.value; renderDataPlot(); return; }
  if (el.dataset.core) { if (el.checked) p.cores.push(el.dataset.core); else p.cores = p.cores.filter((id) => id !== el.dataset.core); }
  else if (el.dataset.p) { p[el.dataset.p] = val; if (el.dataset.p === 'layout' && val === 'strat' && (p.v !== 'depth' && p.v !== 'age')) p.v = 'depth'; }
  else if (el.dataset.yk) { const i = +el.closest('[data-y]').dataset.y; p.ys[i][el.dataset.yk] = val; }
  else return;
  markDirty();
  const rebuild = ['layout', 'fit'].includes(el.dataset.p || el.dataset.yk) || el.dataset.p === 'name';
  if (rebuild) renderDataPlot(); else drawDataPlot();
});
$('dBody').addEventListener('click', (e) => {
  const a = e.target.closest('[data-pa]')?.dataset.pa; if (!a || $('dView').value !== 'plot') return;
  const p = curPlot(), cols = plotColumns();
  if (a === 'addy') p.ys.push({ col: cols.find((c) => !p.ys.some((y) => y.col === c)) || cols[0], type: 'line', y2: false, fit: 'none', deg: 2, window: 5, log: false, inv: false, color: '' });
  else if (a === 'dely') p.ys.splice(+e.target.closest('[data-y]').dataset.y, 1);
  else if (a === 'new') { S.plots.push(defaultPlot(S.plots.length + 1)); S.plotCur = S.plots.length - 1; }
  else if (a === 'dup') { S.plots.push({ ...JSON.parse(JSON.stringify(p)), name: p.name + ' (2)' }); S.plotCur = S.plots.length - 1; }
  else if (a === 'del') { S.plots.splice(S.plotCur, 1); S.plotCur = 0; }
  else if (a === 'svg') { if (plotLast) saveFile(`${safe(p.name)}.svg`, plotLast.svg, 'image/svg+xml'); return; }
  else if (a === 'png') { if (plotLast) busy(async () => { const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(plotLast.svg); await img.decode(); const c = document.createElement('canvas'); c.width = img.width * 3; c.height = img.height * 3; const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height); const b = await new Promise((r) => c.toBlob(r, 'image/png')); if (b) await saveFile(`${safe(p.name)}.png`, b, 'image/png'); }); return; }
  else if (a === 'csv') {
    const rows = [['core', p.v, 'variable', 'value']];
    for (const c of S.cores.filter((q) => p.cores.includes(q.id))) for (const y of p.ys) { const X = plotCol(c, p.v), Y = plotCol(c, y.col); for (let i = 0; i < X.length; i++) if (X[i] != null && Y[i] != null) rows.push([c.name, X[i], y.col, Y[i]]); }
    saveFile(`${safe(p.name)}.csv`, withProv(toCSV(rows)), 'text/csv'); return;
  }
  markDirty(); renderDataPlot();
});

let dataLimit = 400, dataViewportOn = true;   // M2.1.3 rendering is the default since 16 Nov 2026; the checkbox returns to the native table for the session
/** @type {ReturnType<typeof mountTableViewport> | null} */
let dataViewport = null;
export function disposeDataTable() {
  dataViewport?.destroy(); dataViewport = null;
  const active = document.activeElement;
  if (active instanceof HTMLElement && $('dBody').contains(active)) active.blur();
}
const SRC_ORDER = { imp: 0, rec: 1, img: 2, man: 3, calc: 4 };
function dataCores() { const v = $('dCore').value; return v === '__all' ? S.cores : S.cores.filter((c) => c.id === (v || S.curCore)); }
export function renderData() {
  if (mode !== 'data') return;
  const sel = $('dCore'), cur = sel.value || S.curCore;
  sel.innerHTML = S.cores.map((c) => `<option value="${c.id}" ${c.id === cur ? 'selected' : ''}>${esc(c.name)}</option>`).join('') + `<option value="__all" ${cur === '__all' ? 'selected' : ''}>${t('data.allCores')}</option>`;
  refreshAllCores();
  // V0.35: the sheet replaces the old «computed columns» view; the free cell sheet stays only for projects that use it
  for (const o of $('dView').options) if (o.value === 'cols' || (o.value === 'cells' && !Object.keys(S.sheet.cells || {}).length)) o.hidden = true;
  if ($('dView').selectedOptions[0]?.hidden) $('dView').value = 'table';
  const view = $('dView').value;
  if (view !== 'table') disposeDataTable();
  if (view === 'cols') renderDataCols(); else if (view === 'cells') renderDataCells(); else if (view === 'plot') renderDataPlot(); else renderDataTable();
}
function tableModel(limit = Infinity, offset = 0) {
  const cores = dataCores(), names = new Map();
  for (const c of cores) for (const [k, v] of Object.entries(c.src)) if (!names.has(k)) names.set(k, v);
  const cols = [...names.entries()].sort((a, b) => SRC_ORDER[a[1]] - SRC_ORDER[b[1]] || a[0].localeCompare(b[0]));
  const layers = $('dLayers').checked ? S.geo.layers.filter((L) => S.geo.intervals.some((q) => q.layer === L.id && cores.some((c) => c.id === q.core))) : [];
  const rows = [];
  let totalRows = 0;
  for (const c of cores) {
    const n = (c.depth || c.age || []).length;
    const first = Math.min(n, Math.max(0, offset - totalRows));
    totalRows += n;
    const displayed = Math.min(n - first, Math.max(0, limit - rows.length));
    if (!displayed) continue;
    const intervalNames = new Map();
    const ivs = new Map(layers.map((L) => {
      const intervals = intervalsOnAxis(S.geo.intervals.filter((q) => q.core === c.id && q.layer === L.id), c.depth ? 'depth' : 'age', c);
      for (const q of intervals) intervalNames.set(q, geoCat(q.cat)?.name || '');
      return [L.id, createIntervalLookup(intervals)];
    }));
    for (let i = first; i < first + displayed; i++) {
      const x = c.depth ? c.depth[i] : c.age[i];
      rows.push({ c, i, depth: c.depth?.[i] ?? null, age: c.age?.[i] ?? null, vals: cols.map(([k]) => c.proxies[k]?.[i] ?? null),
        lay: layers.map((L) => intervalNames.get(ivs.get(L.id)(x)) || '') });
    }
  }
  return { cores, cols, layers, rows, totalRows };
}
/* ───────────── V0.35: Data as a spreadsheet — every value editable (flagged), computed columns ───────────── */
let dataEditOn = false, dataFormOpen = null, dataLastCell = null;
/** @param {ReturnType<typeof tableModel>} M @param {number} [offset] */
function tableRowsHTML(M, offset = 0) {
  const multi = M.cores.length > 1;
  return M.rows.map((r, ri) => {
    const x = r.depth ?? r.age;
    return `<tr data-row="${offset + ri}"><td class="rn">${offset + ri + 1}</td>${multi ? `<td class="txt">${esc(r.c.name)}</td>` : ''}<td class="ax">${fmt(r.depth, 4)}</td><td class="ax">${fmt(r.age, 3)}</td>${r.vals.map((v, j) => {
      const [k, src] = M.cols[j], ed = src !== 'man' && cellEdit(r.c, k, x), canEdit = dataEditOn && src !== 'calc' && x != null;
      const tip = ed ? t('ds.modTip', { o: ed.o == null ? '—' : fmt(ed.o, 6), d: (ed.at || '').slice(0, 10) }) : '';
      return `<td${canEdit ? ' contenteditable spellcheck="false"' : ''} class="${ed ? 'mod' : ''}${src === 'calc' ? ' calc' : ''}" data-core="${r.c.id}" data-col="${esc(k)}" data-src="${src}" data-x="${x}"${tip ? ` title="${esc(tip)}"` : ''}>${v == null ? '' : fmt(v, 6)}</td>`;
    }).join('')}${r.lay.map((v) => `<td class="txt">${esc(v)}</td>`).join('')}</tr>`;
  }).join('');
}
function renderDataTable() {
  const previous = /** @type {HTMLElement | null} */ ($('dBody').querySelector('.dsgrid'));
  const context = JSON.stringify([S.id, /** @type {HTMLSelectElement} */ ($('dCore')).value,
    /** @type {HTMLInputElement} */ ($('dLayers')).checked]);
  const scrollTop = dataViewportOn && previous?.dataset.context === context ? previous.scrollTop : 0;
  disposeDataTable();
  const M = tableModel(dataViewportOn ? 0 : dataLimit), multi = M.cores.length > 1, nEd = editCount(M.cores);
  $('dInfo').textContent = t('data.info', { r: M.totalRows, c: M.cols.length });
  const colLetter = (i) => cellName(i, 0).replace(/\d+$/, '');
  const fixed = (multi ? 1 : 0) + 2;
  const head = `<tr><th class="rn"></th>${multi ? `<th class="txt">${t('geo.core')}</th>` : ''}<th>${t('r.depth')}</th><th>${t('r.age')}</th>${M.cols.map(([k, src], j) => {
    const calc = S.sheet.columns.findIndex((x) => x.name === k);
    return `<th class="src-${src}" title="${esc(t('data.src.' + src))}"><span class="tag">${colLetter(fixed + j)} · ${t('data.src.' + src)}</span>${esc(k)}${src === 'calc' && calc >= 0 ? ` <button type="button" class="btn small ghost fx" data-fx="${calc}" title="${esc(t('ds.editFx'))}">ƒ</button>` : ''}</th>`;
  }).join('')}${M.layers.map((L) => `<th class="src-lay txt"><span class="tag">${t('data.src.lay')}</span>${esc(L.name)}</th>`).join('')}</tr>`;
  const body = tableRowsHTML(M);
  const cores = S.cores.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  const f = dataFormOpen, fcol = f?.i != null ? S.sheet.columns[f.i] : null;
  const names = [...new Set(M.cols.map(([k]) => k)), 'depth', 'age'];
  const form = f ? `<div class="dsform">
      <div class="row"><label class="f"><span>${t('ds.type')}</span><select id="dsType" ${fcol ? 'disabled' : ''}><option value="calc" ${f.type !== 'man' ? 'selected' : ''}>${t('ds.calc')}</option><option value="man" ${f.type === 'man' ? 'selected' : ''}>${t('ds.man')}</option></select></label>
      <label class="f" style="flex:1"><span>${t('ds.name')}</span><input type="text" id="dsName" value="${esc(fcol?.name || '')}"></label>
      <label class="f"><span>${t('data.core')}</span><select id="dsCore">${f.type === 'man' ? '' : `<option value="all">${t('data.allCores')}</option>`}${cores}</select></label></div>
      ${f.type !== 'man' ? `<label class="f"><span>${t('ds.formula')}</span><input type="text" id="dsFormula" value="${esc(fcol?.formula || '')}" placeholder="[reflectance_L*] / [reflectance_a*]" spellcheck="false"></label>
      <p class="note">${t('ds.formulaHelp', { f: FUNCTIONS.join(', ') })}</p>
      <div class="dsnames">${names.map((n) => `<button type="button" class="btn small ghost" data-ins="${esc(n)}">${esc(n)}</button>`).join('')}</div>` : `<p class="note">${t('ds.manHelp')}</p>`}
      ${f.type !== 'man' ? `<label class="chk"><input type="checkbox" id="dsInterp" ${fcol?.interp === false ? '' : 'checked'}><span>${t('ds.interp')}</span></label>` : ''}
      ${fcol?.error ? `<p class="note err">${esc(fcol.error)}</p>` : ''}
      <div class="row"><button type="button" class="btn small primary" id="dsSave">${t(fcol ? 'ds.save' : 'ds.add')}</button>${fcol ? `<button type="button" class="btn small" id="dsDel">${t('ds.del')}</button>` : ''}<button type="button" class="btn small ghost" id="dsCancel">${t('ds.cancel')}</button></div></div>` : '';
  $('dBody').innerHTML = `<div class="dsbar">
      <label class="chk ${dataEditOn ? 'on' : ''}"><input type="checkbox" id="dsEdit" ${dataEditOn ? 'checked' : ''}><span>${t('ds.edit')}</span></label>
      <label class="chk"><input type="checkbox" id="dsViewport" ${dataViewportOn ? 'checked' : ''}><span>${t('ds.viewport')}</span></label>
      <button type="button" class="btn small" id="dsNewCol">${t('ds.newCol')}</button>
      <span class="dsmod">${nEd ? t('ds.nMod', { n: nEd }) : ''}</span>
      ${nEd || dataViewportOn ? `<button type="button" class="btn small ghost" id="dsRestoreCell" disabled ${nEd ? '' : 'hidden'}>${t('ds.restoreCell')}</button><button type="button" class="btn small ghost" id="dsRestoreAll" ${nEd ? '' : 'hidden'}>${t('ds.restoreAll')}</button>` : ''}
    </div>
    ${dataEditOn ? `<p class="dswarn">${t('ds.warn')}</p>` : ''}${form}
    <div class="dsgrid"><table class="dtable sheet ${dataViewportOn ? 'dsviewport' : ''}" ${dataViewportOn ? `style="width:${50 + (multi ? 180 : 0) + 256 + M.cols.length * 132 + M.layers.length * 180}px"` : ''}>
      ${dataViewportOn ? `<colgroup>${[50, ...(multi ? [180] : []), 128, 128, ...M.cols.map(() => 132), ...M.layers.map(() => 180)].map((width) => `<col style="width:${width}px">`).join('')}</colgroup>` : ''}
      <thead>${head}</thead><tbody>${body}</tbody></table></div>
    ${M.totalRows > dataLimit ? `<p><button class="btn small" id="dMore">${t('data.more', { n: M.totalRows - dataLimit })}</button></p>` : ''}`;
  if (dataViewportOn) {
    const grid = /** @type {HTMLElement} */ ($('dBody').querySelector('.dsgrid')); grid.dataset.context = context;
    dataViewport = mountTableViewport({ grid, body: grid.querySelector('tbody'), rowCount: Math.min(dataLimit, M.totalRows),
      columnCount: fixed + 1 + M.cols.length + M.layers.length, scrollTop,
      renderRows: (start, end) => tableRowsHTML(tableModel(end - start, start), start) });
  }
  if ($('dMore')) $('dMore').onclick = () => { dataLimit += 1000; renderDataTable(); };
  if (f && $('dsCore')) $('dsCore').value = fcol?.core || (f.type === 'man' ? M.cores[0]?.id : 'all') || 'all';
}
$('dBody').addEventListener('change', (e) => {
  const target = /** @type {HTMLInputElement | HTMLSelectElement} */ (e.target);
  if (target instanceof HTMLInputElement && target.id === 'dsViewport') { dataViewportOn = target.checked; renderDataTable(); }
  else if (target instanceof HTMLInputElement && target.id === 'dsEdit') { dataEditOn = target.checked; renderDataTable(); }
  else if (target.id === 'dsType') { dataFormOpen = { type: target.value }; renderDataTable(); }
});
$('dBody').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.id === 'dsNewCol') { dataFormOpen = dataFormOpen ? null : { type: 'calc' }; renderDataTable(); }
  else if (b.dataset.fx != null) { dataFormOpen = { type: 'calc', i: +b.dataset.fx }; renderDataTable(); }
  else if (b.dataset.ins != null) { const i = $('dsFormula'), ins = /^[\w.]+$/.test(b.dataset.ins) ? b.dataset.ins : `[${b.dataset.ins}]`; const p0 = i.selectionStart ?? i.value.length; i.value = i.value.slice(0, p0) + ins + i.value.slice(i.selectionEnd ?? p0); i.focus(); i.selectionStart = i.selectionEnd = p0 + ins.length; }
  else if (b.id === 'dsCancel') { dataFormOpen = null; renderDataTable(); }
  else if (b.id === 'dsDel') { S.sheet.columns.splice(dataFormOpen.i, 1); dataFormOpen = null; refreshAllCores(); geoRT.dirty = true; markDirty(); renderDataTable(); }
  else if (b.id === 'dsSave') {
    const name = $('dsName').value.trim(), core = $('dsCore').value; if (!name) { toast(t('ds.needName')); return; }
    if (dataFormOpen.type === 'man') {
      const c = S.cores.find((x) => x.id === core); if (!c) return;
      c.user ||= {}; c.user[name] ||= { d: (c.depth || []).slice(), v: (c.depth || []).map(() => null) };
      dataEditOn = true; refreshCoreData(c);
    } else {
      const formula = $('dsFormula').value.trim(); if (!formula) { toast(t('ds.needFormula')); return; }
      try { parseFormula(formula); } catch (err) { toast(t('ds.badFormula', { e: fxText(err) })); return; }
      const interp = $('dsInterp')?.checked !== false;
      if (dataFormOpen.i != null) Object.assign(S.sheet.columns[dataFormOpen.i], { name, formula, core, interp }); else S.sheet.columns.push({ name, formula, core, interp });
      refreshAllCores();
    }
    dataFormOpen = null; geoRT.dirty = true; markDirty(); renderDataTable();
  }
  else if (b.id === 'dsRestoreAll') { if (!armed(b)) return; for (const c of dataCores()) c.edits = {}; refreshAllCores(); geoRT.dirty = true; markDirty(); renderDataTable(); }
  else if (b.id === 'dsRestoreCell' && dataLastCell) {
    const { core, col, x } = dataLastCell, c = S.cores.find((q) => q.id === core);
    if (c?.edits?.[col]) { delete c.edits[col][x]; if (!Object.keys(c.edits[col]).length) delete c.edits[col]; }
    dataLastCell = null; refreshCoreData(c); geoRT.dirty = true; markDirty(); renderDataTable();
  }
});
$('dBody').addEventListener('focusin', (e) => {
  const td = e.target.closest?.('td[data-col]'); if (!td) return;
  td.dataset.before = td.textContent;
  dataLastCell = td.classList.contains('mod') ? { core: td.dataset.core, col: td.dataset.col, x: td.dataset.x } : null;
  if ($('dsRestoreCell')) $('dsRestoreCell').disabled = !dataLastCell;
});
$('dBody').addEventListener('input', (e) => {
  if (!dataViewport || !(e instanceof InputEvent) || e.isComposing || !(e.target instanceof HTMLElement)) return;
  const cell = e.target.closest('td[contenteditable]');
  if (!cell || !cell.children.length) return;
  // Rich pasted markup must not change the fixed row geometry; numeric validation still uses its text.
  const text = cell.textContent || ''; cell.textContent = text;
  if (document.activeElement === cell) window.getSelection()?.collapse(cell.firstChild || cell, text.length);
});
$('dBody').addEventListener('keydown', (e) => {
  const td = e.target.closest?.('td[contenteditable]'); if (!td) return;
  if (e.key === 'Escape') { td.textContent = td.dataset.before || ''; td.blur(); return; }
  if (dataViewport) {
    const row = td.parentElement, grid = row.closest('.dsgrid');
    const available = Number(grid.dataset.available), index = Number(row.dataset.row);
    let target = index, column = td.cellIndex;
    if (e.key === 'Tab') {
      const editable = [...row.cells].filter((cell) => cell.isContentEditable).map((cell) => cell.cellIndex);
      const position = editable.indexOf(column) + (e.shiftKey ? -1 : 1);
      column = editable[(position + editable.length) % editable.length];
      if (position < 0) target--; else if (position >= editable.length) target++;
      if (target < 0 || target >= available) return;
    } else if ((e.ctrlKey || e.metaKey) && ['Home', 'End'].includes(e.key)) {
      const editable = [...row.cells].filter((cell) => cell.isContentEditable);
      target = e.key === 'Home' ? 0 : available - 1;
      column = (e.key === 'Home' ? editable[0] : editable.at(-1)).cellIndex;
    } else {
      if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Enter' || e.key === 'ArrowDown') target++;
      else if (e.key === 'ArrowUp') target--;
      else if (e.key === 'PageDown') target += dataViewport.pageRows();
      else if (e.key === 'PageUp') target -= dataViewport.pageRows();
      else return;
      if (e.key.startsWith('Page')) target = Math.max(0, Math.min(available - 1, target));
    }
    e.preventDefault();
    if (!dataViewport.focusCell(target, column)) td.blur();
    return;
  }
  const move = e.key === 'Enter' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0; if (!move) return;
  e.preventDefault();
  const tr = move > 0 ? td.parentElement.nextElementSibling : td.parentElement.previousElementSibling, nx = tr?.children[td.cellIndex];
  if (nx?.isContentEditable) nx.focus(); else td.blur();
});
$('dBody').addEventListener('focusout', (e) => {
  const td = e.target.closest('td[contenteditable]'); if (!td) return;
  const raw = td.textContent.trim(); if (raw === (td.dataset.before || '').trim()) return;
  const c = S.cores.find((x) => x.id === td.dataset.core); if (!c) return;
  const v = raw === '' ? null : +raw.replace(',', '.');
  if (raw !== '' && !Number.isFinite(v)) { td.textContent = td.dataset.before || ''; toast(t('ds.notNumber')); return; }
  const col = td.dataset.col, x = td.dataset.x;
  if (td.dataset.src === 'man') {   // manual column: the value is the data itself
    const u = c.user?.[col]; if (!u) return; const d = +x, k = u.d.indexOf(d);
    if (k >= 0) u.v[k] = v; else { u.d.push(d); u.v.push(v); }
  } else {   // V0.35: any other value is kept as an edit over the original, flagged and reversible
    c.edits ||= {}; const E = (c.edits[col] ||= {}), prev = E[x];
    const orig = prev ? prev.o : (td.dataset.before === '' ? null : +td.dataset.before.replace(',', '.'));
    if (orig != null && v != null && Math.abs(orig - v) <= 1e-12 * Math.max(1, Math.abs(orig))) delete E[x];
    else E[x] = { v, o: orig, at: new Date().toISOString() };
    if (!Object.keys(E).length) delete c.edits[col];
  }
  refreshCoreData(c); geoRT.dirty = true; markDirty();
  const ed = cellEdit(c, col, x); td.classList.toggle('mod', !!ed);
  if (ed) td.title = t('ds.modTip', { o: ed.o == null ? '—' : fmt(ed.o, 6), d: ed.at.slice(0, 10) }); else td.removeAttribute('title');
  const n = editCount(dataCores()); const m = $('dBody').querySelector('.dsmod'); if (m) m.textContent = n ? t('ds.nMod', { n }) : '';
  if (dataViewport) {
    for (const id of ['dsRestoreAll', 'dsRestoreCell']) if ($(id)) $(id).hidden = !n;
  } else if (n && !$('dsRestoreAll')) renderDataTable();
});
function renderDataCols() {
  const cores = S.cores.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  $('dInfo').textContent = '';
  $('dBody').innerHTML = `<h3>${t('data.calcTitle')}</h3><p class="note">${t('data.calcHelp', { f: FUNCTIONS.join(', ') })}</p>
    <div style="display:grid;gap:6px;max-width:1100px">${S.sheet.columns.map((col, i) => `<div class="colrow" data-i="${i}"><input type="text" data-k="name" value="${esc(col.name)}"><input type="text" data-k="formula" value="${esc(col.formula)}"><select data-k="core"><option value="all">${t('data.allCores')}</option>${S.cores.map((c) => `<option value="${c.id}" ${c.id === col.core ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select><button class="btn small ghost" data-del="${i}">✕</button>${col.error ? `<span class="note" style="grid-column:1/-1;color:var(--danger)">${esc(col.error)}</span>` : ''}</div>`).join('') || `<p class="note">—</p>`}
    <div class="colrow"><input type="text" id="ncName" placeholder="${t('data.newName')}"><input type="text" id="ncFormula" placeholder="[XRF Ba/Ti] / TOC_pct"><select id="ncCore"><option value="all">${t('data.allCores')}</option>${cores}</select><button class="btn small primary" id="ncAdd">${t('data.addCalc')}</button></div></div>
    <h3>${t('data.manTitle')}</h3><p class="note">${t('data.manHelp')}</p>
    <div class="row"><input type="text" id="nmName" placeholder="${t('data.newName')}"><select id="nmCore">${cores}</select><button class="btn small" id="nmAdd">${t('data.addMan')}</button></div>
    <div style="display:grid;gap:4px">${S.cores.flatMap((c) => Object.keys(c.user || {}).map((k) => `<div class="row"><span>${esc(c.name)} · <b>${esc(k)}</b> (${c.user[k].v.filter((v) => v != null).length})</span><button class="btn small ghost" data-delman="${c.id}|${esc(k)}">✕</button></div>`)).join('')}</div>`;
  $('ncAdd').onclick = () => {
    const name = $('ncName').value.trim(), formula = $('ncFormula').value.trim(); if (!name || !formula) return;
    S.sheet.columns.push({ name, formula, core: $('ncCore').value }); refreshAllCores(); geoRT.dirty = true; markDirty(); renderDataCols();
  };
  $('nmAdd').onclick = () => {
    const name = $('nmName').value.trim(), c = S.cores.find((x) => x.id === $('nmCore').value); if (!name || !c) return;
    c.user ||= {}; c.user[name] ||= { d: (c.depth || []).slice(), v: (c.depth || []).map(() => null) };
    refreshCoreData(c); markDirty(); $('dView').value = 'table'; $('dCore').value = c.id; renderData();
  };
}
$('dBody').addEventListener('change', (e) => {
  const row = e.target.closest('.colrow[data-i]'); if (!row) return;
  const col = S.sheet.columns[+row.dataset.i]; col[e.target.dataset.k] = e.target.value; refreshAllCores(); geoRT.dirty = true; markDirty(); renderDataCols();
});
$('dBody').addEventListener('click', (e) => {
  const d = e.target.closest('button')?.dataset; if (!d) return;
  if ((d.del != null || d.delman) && !armed(e.target, '?')) return;
  if (d.del != null) { S.sheet.columns.splice(+d.del, 1); refreshAllCores(); geoRT.dirty = true; markDirty(); renderDataCols(); }
  else if (d.delman) { const [id, k] = d.delman.split('|'), c = S.cores.find((x) => x.id === id); if (c) { delete c.user[k]; refreshCoreData(c); markDirty(); renderDataCols(); } }
});
const CELL_COLS = 10, CELL_ROWS = 40;
function cellResults() {
  return evalCells(S.sheet.cells, (name, coreName) => {
    const c = coreName ? S.cores.find((x) => x.name === coreName || x.id === coreName) : curCore();
    if (!c) throw Object.assign(new Error('noCore'), { key: 'noCore', args: { v: coreName } });
    if (name === 'depth' || name === 'age') return c[name] || [];
    if (!c.proxies[name]) throw Object.assign(new Error('noCol'), { key: 'noCol', args: { v: name } });
    return c.proxies[name];
  });
}
function renderDataCells() {
  const R = cellResults(), show = (v) => (v && v.error ? '#ERR' : typeof v === 'number' ? fmt(v, 6) : v ?? '');
  $('dInfo').textContent = t('data.cellsInfo');
  let h = `<table class="dtable cells"><thead><tr><th></th>${Array.from({ length: CELL_COLS }, (_, c) => `<th>${cellName(c, 0).replace(/\d+/, '')}</th>`).join('')}</tr></thead><tbody>`;
  for (let r = 0; r < CELL_ROWS; r++) {
    h += `<tr><th>${r + 1}</th>`;
    for (let c = 0; c < CELL_COLS; c++) { const ref = cellName(c, r), raw = S.sheet.cells[ref] ?? '', v = R[ref]; h += `<td class="${v && v.error ? 'err' : ''}" title="${esc(v && v.error ? fxText(v.err || v) : raw)}"><input data-ref="${ref}" data-raw="${esc(raw)}" value="${esc(String(raw).startsWith('=') ? show(v) : raw)}"></td>`; }
    h += '</tr>';
  }
  $('dBody').innerHTML = h + `</tbody></table><p class="note">${t('data.cellsHelp')}</p>`;
}
$('dBody').addEventListener('focusin', (e) => { const i = e.target.closest('input[data-ref]'); if (i) i.value = i.dataset.raw; });
$('dBody').addEventListener('focusout', (e) => {
  const i = e.target.closest('input[data-ref]'); if (!i) return;
  const v = i.value.trim(); if (v) S.sheet.cells[i.dataset.ref] = v; else delete S.sheet.cells[i.dataset.ref];
  markDirty(); setTimeout(() => { if (!document.activeElement?.dataset?.ref) renderDataCells(); else { const a = document.activeElement.dataset.ref; renderDataCells(); const n = $('dBody').querySelector(`input[data-ref="${a}"]`); n?.focus(); } }, 0);
});
$('dBody').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.dataset.ref) e.target.blur(); });
for (const id of ['dCore', 'dView', 'dLayers']) $(id).addEventListener('change', () => { dataLimit = 400; renderData(); });
$('dCsv').addEventListener('click', () => {
  const M = tableModel();
  const rows = [['core', 'depth', 'age', ...M.cols.map(([k]) => k), ...M.layers.map((L) => L.name)], ...M.rows.map((r) => [r.c.name, r.depth, r.age, ...r.vals, ...r.lay])];
  // V0.35: the cells edited by hand are listed in the header (lines starting with # are ignored when the file is read back)
  const notes = [];
  for (const c of M.cores) for (const [col, E] of Object.entries(c.edits || {})) for (const [x, ed] of Object.entries(E)) notes.push(`# edited by hand: ${csvCommentText(c.name)}; ${csvCommentText(col)}; ${c.depth ? 'depth' : 'age'} ${csvCommentText(x)}; original ${csvCommentText(ed.o ?? '')}; new ${csvCommentText(ed.v ?? '')}; ${csvCommentText(ed.at || '')}`);
  saveFile(`${safe(S.name)}_datos.csv`, notes.join('\n') + '\n' + withProv(toCSV(rows)), 'text/csv');
});
