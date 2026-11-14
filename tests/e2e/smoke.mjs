// V0.42: end-to-end check in a headless Chrome. Needs the repository served (python3 -m http.server 8765) and
// puppeteer-core (npm i --no-save puppeteer-core@23). CHROME = path of Chrome (default /usr/bin/google-chrome).
// Opens the IODP test core, detects, undoes, saves, reloads and compares; fails on any page error.
// V0.49: also compares the web analysis of the idealized core (browser JPEG decoder) with the V2.1 reference CSV.
import assert from 'node:assert/strict';
import { verifyUnetModel } from './unet-model.mjs';
import { verifyInterruptedSaves } from './interrupted-saves.mjs';
import { verifyBackupControls } from './backup-controls.mjs';
import { verifyNavigationPreview, verifyLegacyNavigation } from './navigation-preview.mjs';
import { verifyNavigationPreviewCache } from './navigation-preview-cache.mjs';
import { verifyFirstRun } from './first-run.mjs';
import { verifyDataTable } from './data-table.mjs';
import { verifyTableViewport } from './table-viewport.mjs';
import { verifyTaxonFigures } from './taxon-figures.mjs';
import { verifyMultiproxyFigure } from './multiproxy-figure.mjs';
import { verifyProxyMapCoverage } from './proxy-map-coverage.mjs';
import { verifyEventShading } from './event-shading.mjs';
import { verifyFigureComposition } from './figure-composition.mjs';
const { default: puppeteer } = await import(process.env.PUPPETEER_MODULE || 'puppeteer-core');

const URL = process.env.APP_URL || 'http://localhost:8765/app/index.html';
// Elapsed time on every log line: the suite takes 80-180 s and a slow step is otherwise invisible (roadmap card H5).
const started = Date.now(), print = console.log.bind(console);
console.log = (...parts) => print(`[${String(Math.round((Date.now() - started) / 1000)).padStart(3)} s]`, ...parts);
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1440, height: 900 } });
const p = await b.newPage(), errs = [], consoleChecks = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => {
  if (m.type() !== 'error' || /404|Failed to load resource|simulated quota exceeded/.test(m.text())) return;
  consoleChecks.push(Promise.all(m.args().map((arg) => arg.evaluate((value) => value?.stack || String(value))
    .catch(() => m.text()))).then((details) => { errs.push(details.join(' ') || m.text()); }));
});
p.on('dialog', (d) => d.accept());
// Name any page call that takes more than 5 s, so a slow or hanging step is identified by its code (roadmap card H5).
const evaluateOnPage = p.evaluate.bind(p);
p.evaluate = async (fn, ...args) => {
  const t0 = Date.now();
  try { return await evaluateOnPage(fn, ...args); } finally {
    const ms = Date.now() - t0;
    if (ms > 5000) console.log(`slow page call (${(ms / 1000).toFixed(1)} s): ${String(fn).replace(/\s+/g, ' ').slice(0, 140)}`);
  }
};
const W = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await p.evaluate(fn)) return; await W(500); } throw new Error('timeout: ' + fn); };
// A line starting with ::error:: becomes a GitHub annotation, readable from the workflow run without the full log. It bypasses
// console.log on purpose: that adds a time prefix, and the runner only parses lines that start with the command.
const annotate = (m) => process.stdout.write(`::error title=E2E smoke test::${String(m).replace(/[\r\n]+/g, ' ').slice(0, 2400)}\n`);
const fail = (m) => { console.error('E2E FAIL:', m); annotate(m); process.exitCode = 1; };
try {
  await verifyUnetModel(b, URL);
  await verifyFirstRun(b, URL);
  await verifyNavigationPreview(b, URL);
  await verifyLegacyNavigation(b, URL);
  await verifyNavigationPreviewCache(b, URL);
  await verifyInterruptedSaves(b, URL);
  await verifyBackupControls(b, URL);
  await verifyDataTable(b, URL);
  await verifyTableViewport(b, URL);
  await verifyTaxonFigures(b, URL);
  await verifyMultiproxyFigure(b, URL);
  await verifyProxyMapCoverage(b, URL);
  await verifyEventShading(b, URL);
  await verifyFigureComposition(b, URL);
  await p.goto(URL, { waitUntil: 'networkidle0' });
  assert.equal(await p.evaluate(async () => {
    const app = await import('./js/app.js'), depth = await import('./js/sectiondepth.js');
    return ['pxPerCm', 'depthAtRow', 'rowAtDepth'].every((name) => app[name] === depth[name]);
  }), true, 'app.js must preserve the original depth-selector exports');
  await p.evaluate(() => document.getElementById('openTest').click());
  await until(() => window.ichantool?.S.sections.length === 6 && window.ichantool.S.sections.every((s) => s.objects.size > 0));
  await until(() => document.getElementById('saveState').dataset.state === 'saved');
  // The column controls change only the drawing and can restore their defaults.
  const ui = await p.evaluate(async () => {
    const I = window.ichantool; I.setMode('log');
    const mark = document.querySelector('#logTracks [data-track="marks"]');
    const initial = mark.checked; mark.checked = false; mark.dispatchEvent(new Event('change', { bubbles: true }));
    const hidden = I.S.logView.tracks.marks === false;
    const color = document.querySelector('#logStyle [data-st="biColor"]');
    color.value = '#123456'; color.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    const applied = document.querySelector('#logSvg svg')?.outerHTML.includes('#123456');
    document.querySelector('#logStyle [data-colreset="log"]').click();
    const reset = I.S.logView.style.biColor == null;
    document.querySelector('#logTracks [data-track="marks"]').click(); I.setMode('section');
    return { initial, hidden, applied, reset };
  });
  if (!Object.values(ui).every(Boolean)) fail(`column controls: ${JSON.stringify(ui)}`);
  // A drawing failure must invalidate the previously exportable figure.
  const figureFailure = await p.evaluate(async () => {
    const I = window.ichantool, figures = await import('./js/figures.js');
    I.setMode('log'); I.setMode('fig'); I.S.fig.type = 'log'; figures.renderFigure();
    const hadFigure = !!document.querySelector('#figOut svg');
    const fig = I.S.fig, previous = fig.type, logError = console.error, createURL = URL.createObjectURL;
    let exports = 0; URL.createObjectURL = (...args) => { exports++; return createURL(...args); };
    console.error = () => {};
    try {
      Object.defineProperty(fig, 'type', { configurable: true, get() { throw new Error('simulated drawing failure'); } });
      figures.renderFigure();
      document.getElementById('figSvg').click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { hadFigure, errorShown: document.getElementById('figOut').textContent.includes('simulated drawing failure'), exports };
    } finally {
      Object.defineProperty(fig, 'type', { configurable: true, writable: true, enumerable: true, value: previous });
      URL.createObjectURL = createURL; console.error = logError; I.setMode('section');
    }
  });
  if (!figureFailure.hadFigure || !figureFailure.errorShown || figureFailure.exports) fail(`stale figure export: ${JSON.stringify(figureFailure)}`);
  const first = await p.evaluate(() => window.ichantool.S.sections[window.ichantool.S.cur].objects.size);
  const sectionMask = () => {
    const { S, serialize } = window.ichantool;
    const section = serialize().cores.find((core) => core.id === S.curCore).sections[S.cur];
    return { nextId: section.nextId, labels: section.labels, stacks: section.stacks,
      objects: section.objects.map(({ id, cls, src, st }) => ({ id, cls, src, st })) };
  };
  const beforeDetection = await p.evaluate(sectionMask);
  await p.evaluate(() => window.ichantool.runDetection()); await W(3000);
  const again = await p.evaluate(() => window.ichantool.S.sections[window.ichantool.S.cur].objects.size);
  if (again !== first) fail(`detection is not repeatable: ${first} → ${again}`);
  const detected = await p.evaluate(sectionMask);
  await p.evaluate(() => document.getElementById('undoBtn').click());
  assert.deepEqual(await p.evaluate(sectionMask), beforeDetection, 'undo restores detection masks, IDs and statistics');
  await p.evaluate(() => document.getElementById('redoBtn').click());
  assert.deepEqual(await p.evaluate(sectionMask), detected, 'redo restores detection masks, IDs and statistics');
  // one undoable edit: delete a trace, then undo
  const del = await p.evaluate(() => { const I = window.ichantool, s = I.S.sections[I.S.cur], id = [...s.objects.keys()][0]; I.S.selected = id; document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })); return [s.objects.size, s.objects.has(id), id]; });
  if (del[1]) fail('delete did not remove the trace');
  await p.evaluate(() => document.getElementById('undoBtn').click()); await W(500);
  const undone = await p.evaluate((id) => window.ichantool.S.sections[window.ichantool.S.cur].objects.has(id), del[2]);
  if (!undone) fail('undo did not restore the trace');
  // Fill the stack table, then delete a trace whose overlap will only be needed by undo.
  const compacted = await p.evaluate(async () => {
    const { idsAt } = await import('./js/core.js');
    const I = window.ichantool, s = I.S.sections[I.S.cur], [firstId, secondId] = s.objects.keys();
    const pixel = s.labels.indexOf(firstId);
    const shared = [secondId, firstId];
    for (let i = 0; i < 64; i++) s.stacks.push([s.nextId + 2 * i, s.nextId + 2 * i + 1]);
    s.stacks.push(shared);
    s.labels[pixel] = 1 - s.stacks.length;
    s._six = null;
    I.S.selected = firstId;
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    const reclaimed = s.labels[pixel] === secondId && s.stacks.length < 64 && !s.stacks.includes(shared);
    document.getElementById('undoBtn').click();
    const restored = JSON.stringify(idsAt(s.labels[pixel], s.stacks)) === JSON.stringify(shared);
    document.getElementById('redoBtn').click();
    const deletedAgain = s.labels[pixel] === secondId && !s.objects.has(firstId);
    document.getElementById('undoBtn').click();
    const restoredAgain = JSON.stringify(idsAt(s.labels[pixel], s.stacks)) === JSON.stringify(shared);
    s.labels[pixel] = firstId;
    return [reclaimed, restored, deletedAgain, restoredAgain];
  });
  assert.deepEqual(compacted, [true, true, true, true], 'undo and redo preserve overlap order across compaction');

  const exclusion = () => {
    const { S, serialize } = window.ichantool;
    return serialize().cores.find((core) => core.id === S.curCore).sections[S.cur].exclude;
  };
  const beforeExclude = await p.evaluate(exclusion);
  await until(() => !!window.ichantool.S.sections[window.ichantool.S.cur].orig);
  const point = await p.evaluate(async () => {
    const { S, setTool } = window.ichantool, s = S.sections[S.cur];
    setTool('exclude'); S.exShape = 'brush';
    await new Promise(requestAnimationFrame);
    const canvas = document.getElementById('view');
    const { left, top, width, height } = canvas.getBoundingClientRect();
    const x = left + width / 2, y = top + height / 2;
    const hit = document.elementFromPoint(x, y);
    if (hit !== canvas) throw new Error(`Exclusion brush target covered by ${hit?.id || hit?.tagName}`);
    S.view = { zoom: 1, x: s.roi.x0 + 5.5 - width / 2, y: s.roi.y0 + 5.5 - height / 2 };
    return { x, y };
  });
  await p.mouse.click(point.x, point.y);
  const afterExclude = await p.evaluate(exclusion);
  assert.notDeepEqual(afterExclude, beforeExclude, 'exclusion brush changes the mask');
  await p.evaluate(() => document.getElementById('undoBtn').click());
  assert.deepEqual(await p.evaluate(exclusion), beforeExclude, 'undo restores the previous exclusion mask');
  await p.evaluate(() => document.getElementById('redoBtn').click());
  assert.deepEqual(await p.evaluate(exclusion), afterExclude, 'redo restores the edited exclusion mask');
  await p.evaluate(() => window.ichantool.saveToDB()); await W(1500);
  const sig = () => window.ichantool.S.sections.map((s) => `${s.objects.size}:${s.labels.reduce((a, v) => a + (v ? 1 : 0), 0)}`).join(',');
  const before = await p.evaluate(sig);
  await p.reload({ waitUntil: 'networkidle0' });
  await until(() => window.ichantool?.S.sections.length === 6);
  await p.evaluate(async () => { for (const s of window.ichantool.S.sections) void s.labels; });
  const after = await p.evaluate(sig);
  if (before !== after) fail(`saved and reloaded project differs:\n${before}\n${after}`);
  assert.deepEqual(await p.evaluate(exclusion), afterExclude, 'the redone exclusion survives reload');
  assert.equal(await p.evaluate(() => {
    const { undo, redo } = window.ichantool.S;
    return !undo.length && !redo.length && document.getElementById('undoBtn').disabled && document.getElementById('redoBtn').disabled;
  }), true, 'history is empty on reload');
  // V0.49: web–V2 comparison with the browser's own JPEG decoder (L < 6, rowCounts, binRows of 150 px). The decoder
  // differs from Pillow's at the edges of the painted traces, so percentages may differ slightly; BI and ii must not.
  const v2 = await p.evaluate(async () => {
    const { rowCounts, binRows } = await import('./js/core.js'), { parseTable } = await import('./js/log.js');
    const img = new Image(); img.src = '../examples/data/idealized_core_0-500cm.jpg'; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data, labels = new Int32Array(c.width * c.height);
    for (let i = 0; i < labels.length; i++) labels[i] = 0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2] < 6 ? 1 : 0;
    const bins = binRows(rowCounts({ labels, width: c.width, roi: { x0: 0, x1: c.width, y0: 0, y1: c.height }, exclude: null, effClass: [-1, 0], nClasses: 1 }), { top: 0, bottom: 500, binPx: 150 });
    const t = parseTable(await (await fetch('../legacy/v2.1_console/example_output.csv')).text()), k = (n) => t.headers.indexOf(n);
    const dp = t.rows.map((r, i) => Math.abs(bins[i].pct - r[k('Bioturbation Percentage')]));
    return { n: t.rows.length, bi: t.rows.filter((r, i) => bins[i].BI === r[k('BI')]).length, ii: t.rows.filter((r, i) => bins[i].ii === r[k('II')]).length,
      depth: Math.max(...t.rows.map((r, i) => Math.abs(bins[i].depth - r[k('Depth')]))), max: Math.max(...dp), mean: dp.reduce((a, v) => a + v, 0) / dp.length };
  });
  if (v2.bi !== v2.n || v2.ii !== v2.n || v2.depth > 1e-9 || v2.max > 0.6) fail(`web–V2 in the browser: BI ${v2.bi}/${v2.n}, ii ${v2.ii}/${v2.n}, depth ${v2.depth}, max Δ% ${v2.max}`);
  console.log(`web–V2 in the browser: ${v2.n} intervals, BI and ii identical, max Δ ${v2.max.toFixed(2)} points, mean ${v2.mean.toFixed(2)}`);
  // Simulate a failed desktop save: the page must remain open with its changes pending.
  const failure = await p.evaluate(async () => {
    const I = window.ichantool; document.getElementById('projClose').click(); I.setMode('section');
    const s = I.S.sections[I.S.cur], id = s.objects.keys().next().value;
    I.S.selected = id; document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    if (s.objects.has(id)) throw new Error('failed to create an unsaved edit');
    const tx = IDBDatabase.prototype.transaction, close = window.close, desktop = window.corantoolDesktop, logError = console.error;
    console.error = (error) => { if (error?.message !== 'simulated quota exceeded') logError(error); };
    let closed = false; window.close = () => { closed = true; }; window.corantoolDesktop = {};
    IDBDatabase.prototype.transaction = function (stores, mode, ...args) {
      if (mode === 'readwrite') throw new DOMException('simulated quota exceeded', 'QuotaExceededError');
      return tx.call(this, stores, mode, ...args);
    };
    window.dispatchEvent(new Event('beforeunload', { cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const dlg = document.querySelector('dialog.saveFail'), result = { closed, state: document.getElementById('saveState').dataset.state, dialog: !!dlg?.open }; dlg?.remove();
    IDBDatabase.prototype.transaction = tx; window.close = close; window.corantoolDesktop = desktop; console.error = logError;
    return result;
  });
  if (failure.closed || failure.state !== 'error' || !failure.dialog) fail(`failed save did not keep the window open and ask: ${JSON.stringify(failure)}`);
  const multiproxy = await p.evaluate(async () => {
    const I = window.ichantool, { normalizeGeo, buildGeoLog } = await import('./js/multiproxy.js');
    const { renderFigPanel, renderFigure, figTabsData, loadFigTabs } = await import('./js/figures.js');
    I.S.geo = normalizeGeo({ classifiers: [{ id: 'smoke-nb', name: 'Smoke classifier', method: 'nb', targets: ['events'] }] });
    I.setMode('geo');
    await I.loadGeoDemo();
    const ready = () => document.querySelector('#geoColumnsForm [data-colshow^="band:auto:"]');
    for (let i = 0; i < 200 && !ready(); i++) await new Promise((resolve) => setTimeout(resolve, 50));
    const auto = ready();
    if (!auto) throw new Error('The demo did not draw the automatic classification column');
    const core = I.S.cores.find((c) => c.id === I.S.geo.view.core), id = auto.dataset.colshow;
    const layout = () => buildGeoLog(core).res.layout.map((c) => c.id);
    const original = layout().indexOf(id);
    auto.closest('li').querySelector('[data-colmv="-1"]').click();
    const reordered = layout().indexOf(id) === original - 1;
    auto.click();
    const hidden = !layout().includes(id);
    auto.click();
    const restored = layout().includes(id);
    const feats = document.querySelector('#geoFeats'), numeric = feats.closest('details');
    const expandedHeight = numeric.offsetHeight;
    numeric.querySelector('summary').click();
    const collapsed = !numeric.open && numeric.offsetHeight < expandedHeight;
    numeric.querySelector('summary').click();
    const field = document.querySelector('#geoLabels .name');
    const readableName = field.getBoundingClientRect().width > 100 && field.title === field.value;
    const [a, b] = I.S.geo.settings.features;
    I.S.geo.settings.features = [a];
    I.renderGeo();
    I.setMode('fig'); I.S.fig.type = 'geolog'; renderFigPanel();
    const proxy = (name) => [...document.querySelectorAll('[data-fgeo]')].find((el) => el.dataset.fgeo === name);
    proxy(a).click(); proxy(b).click();
    loadFigTabs(JSON.parse(JSON.stringify(figTabsData())));
    renderFigPanel(); renderFigure();
    const independent = proxy(b).checked && !proxy(a).checked &&
      I.S.geo.settings.features.join() === a && !layout().includes('rec:' + b) &&
      document.querySelector('#figOut svg')?.textContent.includes(b);
    document.getElementById('figGeoReset').click(); renderFigure();
    const follows = proxy(a).checked && !proxy(b).checked;
    return { reordered, hidden, restored, collapsed, readableName, independent, follows };
  });
  if (!Object.values(multiproxy).every(Boolean)) fail(`multiproxy controls: ${JSON.stringify(multiproxy)}`);
  // A section whose picture is not loaded yet answers every strip request with one grey canvas, not a new full-size one each
  // time (the image strip of a core asks once per output row; thousands of new canvases took tens of seconds, roadmap card H5).
  const pendingStrip = await p.evaluate(async () => {
    const I = window.ichantool, { sectionCanvas } = await import('./js/columns.js');
    const s = I.S.sections[0], saved = { orig: s.orig, lb: s._lb, lc: s._lc };
    try {
      s.orig = null; s._lb = null; s._lc = null;
      const first = sectionCanvas(s), canvases = new Set([first]);
      for (let i = 0; i < 50; i++) canvases.add(sectionCanvas(s));
      return { distinct: canvases.size, grey: first.getContext('2d').getImageData(0, 0, 1, 1).data.join() };
    } finally { s.orig = saved.orig; s._lb = saved.lb; s._lc = saved.lc; }
  });
  if (pendingStrip.distinct !== 1 || pendingStrip.grey !== '207,212,210,255') fail(`pending section strip: ${JSON.stringify(pendingStrip)}`);
  const nameHandle = '#geoLabels .geo-name-handle';
  await p.evaluate(() => window.ichantool.setMode('geo'));
  await until(() => document.getElementById('busy').hidden);
  // Measure only after the multiproxy panel has been laid out: the handle's neighbour has a width once it is.
  await p.waitForFunction((selector) => document.querySelector(selector)?.previousElementSibling?.offsetWidth > 0, { timeout: 30000, polling: 100 }, nameHandle);
  const beforeDrag = await p.$eval(nameHandle, (handle) => {
    handle.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = handle.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, width: handle.previousElementSibling.offsetWidth,
      panel: document.getElementById('geoPanel').offsetWidth };
  });
  await p.mouse.move(beforeDrag.x, beforeDrag.y);
  await p.mouse.down();
  await p.mouse.move(beforeDrag.x + 180, beforeDrag.y, { steps: 6 });
  await p.mouse.up();
  const afterDrag = await p.$eval(nameHandle, (handle) => {
    const scroll = handle.closest('.geo-label-scroll');
    return { width: handle.previousElementSibling.offsetWidth, panel: document.getElementById('geoPanel').offsetWidth,
      overflow: scroll.scrollWidth > scroll.clientWidth,
      saved: JSON.parse(localStorage.getItem('ichantool.panels') || '{}').geo?.classNameW };
  });
  if (Math.abs(afterDrag.width - beforeDrag.width - 180) > 1 || afterDrag.panel !== beforeDrag.panel ||
      !afterDrag.overflow || afterDrag.saved !== afterDrag.width) fail(`name column drag: ${JSON.stringify({ beforeDrag, afterDrag })}`);
  await p.click(nameHandle, { clickCount: 2 });
  const resetWidth = await p.$eval(nameHandle, (handle) => handle.previousElementSibling.offsetWidth);
  if (resetWidth !== beforeDrag.width) fail(`name column reset: ${resetWidth} instead of ${beforeDrag.width}`);
  // Import a native 16-bit TIFF through the file input and reopen it from the project library.
  await p.evaluate(() => {
    const w = 3, h = 12, start = 512, data = new DataView(new ArrayBuffer(9 * 1024 * 1024));
    const tags = [[256, 4, w], [257, 4, h], [258, 3, 16], [259, 3, 1], [262, 3, 1],
      [273, 4, start], [277, 3, 1], [278, 4, h], [279, 4, w * h * 2]];
    data.setUint16(0, 0x4949);
    data.setUint16(2, 42, true); data.setUint32(4, 8, true); data.setUint16(8, tags.length, true);
    tags.forEach(([tag, type, value], i) => {
      const offset = 10 + 12 * i;
      data.setUint16(offset, tag, true); data.setUint16(offset + 2, type, true);
      data.setUint32(offset + 4, 1, true); data.setUint32(offset + 8, value, true);
    });
    for (let i = 0; i < w * h; i++) data.setUint16(start + 2 * i, 32768 + i, true);
    const file = new File([data.buffer], 'Native 16 bit.tif', { type: 'image/tiff' });
    const transfer = new DataTransfer(); transfer.items.add(file);
    const input = document.getElementById('addImg2');
    input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await until(() => document.querySelector('#pcSel'));
  await p.evaluate(() => document.querySelector('#pcSel').form.querySelector('[value=ok]').click());
  await until(() => window.ichantool.S.sections.some((s) => s.name === 'Native 16 bit' && s.orig16?.[4] === 32769));
  const reopenedTiff = await p.evaluate(async () => {
    const I = window.ichantool, { getImage, getProject } = await import('./js/storage.js');
    document.getElementById('cropCancel').click();
    const s = I.S.sections.find((q) => q.name === 'Native 16 bit');
    const { DEFAULT_FILTERS } = await import('./js/imageproc.js');
    s.filters = { ...DEFAULT_FILTERS, autoLevels: true };
    s.preset = 'custom';
    await I.saveToDB();
    const original = await getImage(s.file.key, true);
    const first = new DataView(await original.slice(512, 516).arrayBuffer());
    await I.loadProject(await getProject(I.S.id));
    return [original.size, first.getUint16(0, true), first.getUint16(2, true)];
  });
  assert.deepEqual(reopenedTiff, [9 * 1024 * 1024, 32768, 32769]);
  await until(() => window.ichantool.S.sections.some((s) => s.name === 'Native 16 bit' && s.orig16?.[4] === 32769));
  const enhancedTiff = await p.evaluate(() => {
    const s = window.ichantool.S.sections.find((q) => q.name === 'Native 16 bit');
    return { orig: [s.orig[0], s.orig[4]], enh: [s.enh[0], s.enh[4]] };
  });
  assert.ok(enhancedTiff.orig[0] === enhancedTiff.orig[1] && enhancedTiff.enh[0] < enhancedTiff.enh[1],
    'worker enhancement uses low bits after reopening the TIFF: ' + JSON.stringify(enhancedTiff));

  // Isolate storage fault injection from the main page's pending OPFS image reads.
  const fallbackContext = await b.createBrowserContext();
  try {
    const fallbackPage = await fallbackContext.newPage();
    fallbackPage.on('pageerror', (e) => errs.push(e.message));
    await fallbackPage.goto(URL, { waitUntil: 'networkidle0' });
    // Force the IndexedDB fallback, verify cross-chunk reads and fail a replacement mid-write.
    const fallback = await fallbackPage.evaluate(async () => {
    const { putImage, getImage } = await import('./js/storage.js');
    Object.defineProperty(navigator.storage, 'getDirectory', { configurable: true, value: undefined });
    const boundary = 4 * 1024 * 1024, key = 'e2e-image-fallback';
    const source = new Blob([new Uint8Array(boundary - 1), new Uint8Array([14, 27, 42])]);
    try {
      await putImage(key, source);
      let failed = false;
      await putImage(key, {
        size: source.size, type: source.type,
        slice(start, end) {
          if (start > 0) throw new Error('simulated chunk write failure');
          return source.slice(start, end);
        },
      }).catch(() => { failed = true; });
      const stored = await getImage(key, true);
      const sample = new Uint8Array(await stored.slice(boundary - 1, boundary + 2).arrayBuffer());
      const legacy = await new Promise((resolve, reject) => {
        const req = indexedDB.open('ichantool');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result, tx = db.transaction('images', 'readwrite');
          tx.objectStore('images').put({ key: 'e2e-legacy-image', bytes: new Uint8Array([81]).buffer, type: 'image/tiff' });
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onabort = () => { db.close(); reject(tx.error); };
        };
      }).then(() => getImage('e2e-legacy-image'));
      return [failed, ...sample, ...new Uint8Array(await legacy.arrayBuffer())];
    } finally { delete navigator.storage.getDirectory; }
    });
    assert.deepEqual(fallback, [true, 14, 27, 42, 81]);
  } finally { await fallbackContext.close(); }

  const across = await p.evaluate(async () => {
    const { putLite } = await import('./js/storage.js');
    const id = 'smoke-marker-project';
    await putLite(id, { name: 'Marker smoke test', cores: [
      { id: 'a', name: 'Marker Alpha', lat: 40, lon: -6 }, { id: 'b', name: 'Marker Beta', lat: 41, lon: -5 },
    ] });
    await window.ichantool.showHome();
    document.querySelector('[data-htab="all"]').click();
    const project = document.querySelector(`[data-mp-project="${id}"]`);
    const cores = [...document.querySelectorAll(`[data-p="${id}"] .mpchk`)];
    project.click();
    const selected = cores.length === 2 && cores.every((c) => c.checked);
    cores[0].click();
    const partial = project.indeterminate;
    const change = (id, value) => {
      const el = document.getElementById(id); el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    change('amMode', 'sites');
    for (let i = 0; i < 100 && document.getElementById('amMarkers').hidden; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    change('amMarkerFor', 'project:' + id);
    change('amMarkerColor', '#123456'); change('amMarkerSymbol', 'square');
    change('amMarkerFor', 'ck:markeralpha');
    change('amMarkerColor', '#654321'); change('amMarkerSymbol', 'diamond');
    const shape = (name) => [...document.querySelectorAll('#allMap g[data-tip]')]
      .find((g) => g.dataset.tip.includes(name))?.firstElementChild;
    const styled = shape('Marker Alpha')?.matches('polygon[fill="#654321"]') &&
      shape('Marker Beta')?.matches('rect[fill="#123456"]');
    document.getElementById('amMarkerReset').click();
    const inherited = shape('Marker Alpha')?.matches('rect[fill="#123456"]');
    return { selected, partial, styled, inherited };
  });
  if (!Object.values(across).every(Boolean)) fail(`across-project controls: ${JSON.stringify(across)}`);

  // A legacy project ZIP still opens through the normal picker. A hostile ZIP is rejected before saving.
  const importZip = await p.evaluate(async () => {
    const { zipFiles } = await import('./js/zip.js');
    const { DEFAULT_FILTERS, DEFAULT_DETECT } = await import('./js/imageproc.js');
    const input = document.getElementById('impProj');
    const sendFile = (file) => {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const send = async (path, id) => {
      const data = JSON.stringify({ app: 'CorAnTool', kind: 'project', version: 5, id, name: id, cores: [] });
      const blob = await zipFiles([{ name: path, data }]);
      sendFile(new File([blob], id + '.corantool', { type: 'application/zip' }));
    };
    const { getProject, listProjects } = await import('./js/storage.js');
    const waitFor = async (predicate) => {
      for (let i = 0; i < 300; i++) {
        if (await predicate()) return true;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return false;
    };
    await send('project.json', 'legacy-zip-smoke');
    const opened = await waitFor(() => window.ichantool.S.id === 'legacy-zip-smoke');
    const saved = !!(await getProject('legacy-zip-smoke'));

    // Current files keep their valid interval results; older and current files with suspect depths can still open.
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2;
    const section = {
      id: 'depth-test-section', name: 'Depth test', w: 2, h: 2, ds: 1, top: 0, bottom: 2, units: 'cm',
      file: { name: 'section.png', type: 'image/png', b64: canvas.toDataURL().split(',')[1] },
      roi: { x0: 0, y0: 0, x1: 2, y1: 2 }, filters: DEFAULT_FILTERS, detect: DEFAULT_DETECT,
      labels: [0, 4], exclude: [0, 4], objects: [], nextId: 1,
    };
    const { S } = window.ichantool;
    const warning = document.getElementById('secDepthWarning');
    const importProject = async (project) => {
      sendFile(new File([JSON.stringify({ ...project, name: project.id, kind: 'project' })], project.id + '.json'));
      if (!(await waitFor(() => S.id === project.id && S.sections.length === 1 && document.getElementById('busy').hidden))) {
        throw new Error(`Project did not open: ${project.id}`);
      }
    };
    const valid = { app: 'SedCoreTool', version: 5, id: 'valid-depth-smoke', cores: [{ id: 'c', sections: [section] }] };
    await importProject(valid);
    const validBins = S.sections[0].bins.map((b) => [b.dTop, b.dBottom, b.pct, b.BI, b.ii]);
    const validQuiet = warning.hidden;
    await importProject({ ...valid, id: 'invalid-unit-smoke', cores: [{ id: 'c', sections: [{ ...section, units: 'in' }] }] });
    const currentWarns = !warning.hidden && S.sections[0].units === 'in';
    await importProject({
      app: 'IchAnTool', version: 2, id: 'invalid-legacy-depth-smoke', settings: { binPx: 1 },
      sections: [{ ...section, bottom: 0 }],
    });
    const legacyWarns = !warning.hidden && S.cores[0].id === 'main' && S.sections[0].bottom === 0
      && S.settings.binCm === 1 && (await getProject(S.id)).sections[0].bottom === 0;
    const bottom = document.getElementById('secBottom');
    bottom.value = '2'; bottom.dispatchEvent(new Event('change', { bubbles: true }));
    const corrected = warning.hidden && S.sections[0].bottom === 2;

    const visible = (id) => !document.getElementById(id).hidden;
    const originalRegion = { ...section.roi, y0: 3 };
    const originalLabels = [9, 1, 0, 3];
    await importProject({
      app: 'IchAnTool', version: 2, id: 'bad-legacy-mask-smoke',
      sections: [{ ...section, roi: originalRegion, labels: originalLabels }],
    });
    const legacyPreview = visible('projectValidation') && visible('secRegionWarning') && visible('secMaskWarning')
      && S.sections[0].roi.y0 === 0 && S.sections[0].roi.y1 === 2 && S.sections[0].bins.length === 0;
    // Edits in the preview must neither overwrite the saved project nor leak into its exported source.
    S.sections[0].top = 1;
    S.sections[0].filters.gamma = 2;
    await window.ichantool.saveToDB();
    const storedLegacy = (await getProject(S.id)).sections[0];
    const exportedLegacy = window.ichantool.serialize().sections[0];
    const sourcePreserved = [storedLegacy, exportedLegacy].every((s) =>
      s.top === 0 && s.roi.y0 === 3 && s.labels[0] === 9 && s.filters.gamma === DEFAULT_FILTERS.gamma);

    await importProject({ ...valid, id: 'bad-current-stack-smoke', cores: [{ id: 'c', sections: [{
      ...section, labels: [-3, 1, 0, 3], stacks: [null, [1, 2]],
    }] }] });
    const currentPreview = visible('projectValidation') && !visible('secRegionWarning') && visible('secMaskWarning')
      && S.sections[0].bins.length === 0 && S.sections[0].labels[0] === 0
      && window.ichantool.serialize().cores[0].sections[0].labels[0] === -3;

    await importProject({ ...valid, id: 'valid-overlap-smoke', cores: [{ id: 'c', sections: [{
      ...section, labels: [1, 1, -1, 1, 0, 2], stacks: [null, [1, 2]], nextId: 3,
      objects: [{ id: 2, cls: null, src: 'draw' }, { id: 1, cls: null, src: 'draw' }],
    }] }] });
    window.ichantool.setMode('section');
    const healthyOverlap = !visible('projectValidation') && !visible('secRegionWarning') && !visible('secMaskWarning')
      && JSON.stringify(S.sections[0].bins.map((b) => [b.pct, b.BI, b.ii])) === '[[100,6,6],[0,0,1]]';
    const { analyze, assignClass, serialize } = window.ichantool, overlapSection = S.sections[0];
    const undo = () => document.getElementById('undoBtn').click();
    const redo = document.getElementById('redoBtn');
    const shortcut = (key, modifiers, target = document.body) =>
      !target.dispatchEvent(new KeyboardEvent('keydown', { key, ...modifiers, bubbles: true, cancelable: true }));
    const snapshot = () => {
      analyze(overlapSection);
      const { labels, stacks, exclude, nextId, objects } = serialize().cores[0].sections[0];
      return JSON.stringify({ labels, stacks, exclude, nextId, objects: objects.map(({ id, cls, src, st }) => ({ id, cls, src, st })),
        bins: overlapSection.bins });
    };
    const unclassified = snapshot();
    document.getElementById('clearCand').click();
    const deleted = overlapSection.objects.size === 0 && S.undo.at(-1).objs.size === 2;
    undo();
    const undoClear = deleted && snapshot() === unclassified && [...overlapSection.objects.keys()].join() === '2,1';

    const cls = S.classes.find((entry) => entry.counts).id;
    const untouched = overlapSection.objects.get(2);
    const stats = overlapSection.objects.get(1).stats;
    assignClass(1, cls);
    const classDelta = S.undo.at(-1).objs.size === 1 && S.undo.at(-1).objs.get(1).stats === stats
      && overlapSection.objects.get(2) === untouched;
    const classified = snapshot();
    assignClass(2, cls);
    const merged = overlapSection.objects.size === 1;
    const mergedState = snapshot();
    undo();
    const undoMerge = merged && snapshot() === classified;
    const editable = document.createElement('div');
    editable.contentEditable = 'true'; document.body.append(editable);
    const nativeShortcuts = [document.getElementById('secName'), editable].every((target) =>
      !shortcut('z', { ctrlKey: true }, target) && !shortcut('y', { ctrlKey: true }, target)
      && !shortcut('Z', { metaKey: true, shiftKey: true }, target));
    editable.remove();
    const redoMerge = !redo.disabled && snapshot() === classified
      && [{ ctrlKey: true, key: 'y' }, { ctrlKey: true, shiftKey: true, key: 'Z' }, { metaKey: true, shiftKey: true, key: 'Z' }]
        .every(({ key, ...modifiers }) => {
          const redone = shortcut(key, modifiers) && redo.disabled && snapshot() === mergedState;
          return redone && shortcut('z', { metaKey: true }) && snapshot() === classified;
        });
    const restoredUntouched = overlapSection.objects.get(2);
    undo();
    const undoClass = classDelta && snapshot() === unclassified && overlapSection.objects.get(2) === restoredUntouched;
    assignClass(2, cls);
    const invalidatedRedo = redo.disabled && S.redo.length === 0;
    undo();
    const top = document.getElementById('secTop');
    top.value = '1'; top.dispatchEvent(new Event('change', { bubbles: true }));
    await window.ichantool.saveToDB();
    const healthySave = (await getProject(S.id)).cores[0].sections[0].top === 1;

    const crcId = 'crc-zip-smoke', crcName = 'CRC sample', imagePath = 'images/section.png';
    const crcProject = JSON.stringify({ ...valid, id: crcId, name: crcName, kind: 'project', cores: [{
      id: 'c', sections: [{ ...section, file: { name: 'section.png', type: 'image/png', path: imagePath } }],
    }] });
    const image = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const crcZip = await zipFiles([{ name: 'project.json', data: crcProject }, { name: imagePath, data: image }]);
    sendFile(new File([crcZip], crcId + '.sedcoretool'));
    const intactZipOpened = await waitFor(() => S.id === crcId && S.sections[0]?.enh
      && document.getElementById('busy').hidden);
    const beforeCrc = JSON.stringify(await getProject(crcId));
    const projectsBeforeCrc = (await listProjects()).length;
    const bytes = new Uint8Array(await crcZip.arrayBuffer()), headers = new DataView(bytes.buffer);
    const payloadAt = (local) => local + 30 + headers.getUint16(local + 26, true) + headers.getUint16(local + 28, true);
    const encoder = new TextEncoder(), jsonStart = payloadAt(0);
    const nameOffset = encoder.encode(crcProject.slice(0, crcProject.indexOf(crcName))).length;
    const imageStart = payloadAt(jsonStart + encoder.encode(crcProject).length);

    const log = console.error;
    const confirmReplace = window.confirm;
    let rejected = false;
    let replacePrompts = 0;
    const crcErrors = [], crcChecks = [];
    console.error = (error, ...args) => {
      if (String(error).includes('ZIP member name')) rejected = true;
      else if (String(error).includes('ZIP CRC mismatch')) crcErrors.push(String(error));
      else log(error, ...args);
    };
    window.confirm = () => { replacePrompts++; return true; };
    try {
      for (const [name, offset] of [['project.json', jsonStart + nameOffset], [imagePath, imageStart + image.size - 1]]) {
        const changed = bytes.slice(); changed[offset] ^= 1;
        sendFile(new File([changed], 'altered.sedcoretool'));
        const message = 'ZIP CRC mismatch for ' + name;
        const warned = await waitFor(() => crcErrors.some((error) => error.includes(message))
          && document.getElementById('toast').textContent.includes(message));
        crcChecks.push(warned && S.id === crcId && S.name === crcName
          && JSON.stringify(await getProject(crcId)) === beforeCrc && (await listProjects()).length === projectsBeforeCrc);
      }
      await send('../project.json', 'hostile-zip-smoke');
      await waitFor(() => rejected);
      return { opened, saved, rejected, notStored: !(await getProject('hostile-zip-smoke')),
        validQuiet, validBins, currentWarns, legacyWarns, corrected,
        legacyPreview, sourcePreserved, currentPreview, healthyOverlap, undoClear, undoMerge, redoMerge, nativeShortcuts,
        undoClass, invalidatedRedo, healthySave,
        intactZipOpened, crcChecks, replacePrompts };
    } finally { console.error = log; window.confirm = confirmReplace; }
  });
  assert.deepEqual(importZip, { opened: true, saved: true, rejected: true, notStored: true,
    validQuiet: true, validBins: [[0, 1, 0, 0, 1], [1, 2, 0, 0, 1]], currentWarns: true, legacyWarns: true, corrected: true,
    legacyPreview: true, sourcePreserved: true, currentPreview: true, healthyOverlap: true,
    undoClear: true, undoMerge: true, redoMerge: true, nativeShortcuts: true, undoClass: true, invalidatedRedo: true, healthySave: true,
    intactZipOpened: true, crcChecks: [true, true], replacePrompts: 0 });
  await Promise.all(consoleChecks);
  if (errs.length) fail('page errors: ' + errs.join(' | '));
  console.log(process.exitCode ? 'E2E finished with failures' : `E2E ok (${first} traces in the first section; reload identical)`);
} catch (e) { fail(e.stack || e.message); } finally { await b.close(); }
