// Card M2.1.4: where the program stops being fluid with tens of thousands of data rows. Measures only; the program is not changed.
//
//   node tools/measure_large_tables.mjs --chrome "C:/Program Files/Google/Chrome/Application/chrome.exe" --out docs/benchmarks/M2.1.4-windows.json [--rows 20000,100000] [--reps 3]
//
// Fixtures: the deterministic M2.1 project (tools/data_table_fixture.mjs): two cores, six numeric columns, ROWS rows in total. So 100,000 rows
// give 50,000 points per core and 100,000 for both cores. For each size and each of the table's two renderings (native, "visible rows only"),
// and for the figures, a fresh headless Chrome (1,440 x 900) opens the real application from a local static server and drives its controls.
// Time is measured as click -> forced layout -> two animation frames (the boundary of M2.1.2). Frame intervals are requestAnimationFrame gaps.
// Needs `npm i --no-save puppeteer-core@23` (or PUPPETEER_MODULE).
import { createServer } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareDataTableFixture } from './data_table_fixture.mjs';
const { default: puppeteer } = await import(process.env.PUPPETEER_MODULE || 'puppeteer-core');

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const chrome = option('chrome', process.env.CHROME), OUT = option('out', null);
const sizes = option('rows', '20000,100000').split(',').map(Number), reps = Number(option('reps', 3));
const parts = option('parts', 'table,figures').split(','), MERGE = args.includes('--merge'), PROFILE_FIRST_OPEN = args.includes('--profile-first-open'), PROTOCOL_MS = Number(option('step-timeout-s', 600)) * 1000;
if (!chrome || !fs.existsSync(chrome)) { console.error('give --chrome PATH'); process.exit(2); }
const round = (v, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const median = (v) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const percentile = (v, p) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : null; };

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.wasm': 'application/wasm' };
const server = createServer((request, response) => {
  const file = path.join(root, decodeURIComponent(new URL(request.url, 'http://x').pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { response.writeHead(404).end(); return; }
  response.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(response);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/app/index.html`;

/** Page-side helpers, installed once per page. */
const installHelpers = () => {
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  window.__m = {
    frame,
    time: async (action) => { const start = performance.now(); await action(); void document.body.offsetHeight; await frame(); return performance.now() - start; },
    /** rAF gaps for `ms` while `step(elapsedMs)` runs inside each frame; also counts long tasks (>50 ms) seen by the observer. */
    gaps: (ms, step = () => {}) => new Promise((resolve) => {
      const gaps = []; let longTasks = 0; const start = performance.now(); let last = start;
      let observer = null; try { observer = new PerformanceObserver((list) => { longTasks += list.getEntries().length; }); observer.observe({ entryTypes: ['longtask'] }); } catch { /* unsupported */ }
      const tick = (now) => { gaps.push(now - last); last = now; step(now - start); if (now - start < ms) requestAnimationFrame(tick); else { observer?.disconnect(); resolve({ gaps, longTasks }); } };
      requestAnimationFrame(tick);
    }),
  };
};
const stats = (gaps) => { const g = gaps.slice(2); return { frames: g.length, median_ms: round(median(g)), p95_ms: round(percentile(g, 0.95)), max_ms: round(Math.max(...g, 0)) }; };

async function openPage(profile) {
  const browser = await puppeteer.launch({ executablePath: chrome, userDataDir: profile, headless: true, args: ['--no-sandbox'], protocolTimeout: PROTOCOL_MS, defaultViewport: { width: 1440, height: 900 } });
  const [page] = await browser.pages(); page.setDefaultTimeout(180000);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#projList .pempty');
  await page.evaluate(installHelpers);
  return { browser, page, errors };
}
async function withPage(fn) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sedcoretool-tables-'));
  const session = await openPage(profile);
  try { return await fn(session); } finally { await session.browser.close(); fs.rmSync(profile, { recursive: true, force: true }); }
}
async function profiled(page, action) {
  const client = await page.createCDPSession();
  await client.send('Profiler.enable'); await client.send('Profiler.start');
  await action();
  const { profile } = await client.send('Profiler.stop'); await client.detach();
  const durations = new Map(); (profile.samples || []).forEach((id, i) => durations.set(id, (durations.get(id) || 0) + profile.timeDeltas[i]));
  const sites = new Map();
  for (const node of profile.nodes) {
    const u = node.callFrame.url, source = u.startsWith('pptr:') ? '(benchmark)' : u.split('/').slice(-2).join('/') || '(runtime)';
    const key = `${source}:${node.callFrame.lineNumber}:${node.callFrame.functionName}`;
    const site = sites.get(key) || { function: node.callFrame.functionName || '(anonymous)', source, line: node.callFrame.lineNumber + 1, self_ms: 0 };
    site.self_ms += (durations.get(node.id) || 0) / 1000; sites.set(key, site);
  }
  return [...sites.values()].filter((s) => s.self_ms > 0).sort((a, b) => b.self_ms - a.self_ms).slice(0, 10).map((s) => ({ ...s, self_ms: round(s.self_ms) }));
}

// ---- the Data table -----------------------------------------------------------------------------------------------------------------------
async function tableTrial(rows, visibleRows, withProfile) {
  return withPage(async ({ page, errors }) => {
    await page.evaluate(prepareDataTableFixture, rows);
    await page.evaluate((flag) => { document.getElementById('modeData').click(); { const box = document.getElementById('dsViewport'); if (box.checked !== flag) box.click(); } document.getElementById('modeSection').click(); }, visibleRows);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const run = async () => page.evaluate(async () => {
      const M = window.__m, out = {};
      out.open_ms = await M.time(() => document.getElementById('modeData').click());
      document.getElementById('dsEdit').click();
      const more = [];
      for (let i = 0; i < 10 && document.getElementById('dMore'); i++) more.push(await M.time(() => document.getElementById('dMore').click()));
      out.expansions_ms = more.reduce((a, b) => a + b, 0);
      const grid = document.querySelector('#dBody .dsgrid'), rowsDom = () => document.querySelectorAll('#dBody tbody tr:not([data-spacer])').length;
      out.dom_rows = rowsDom(); out.dom_elements = document.querySelectorAll('#dBody *').length; out.available = Number(grid.dataset.available || rowsDom());
      const travel = grid.scrollHeight - grid.clientHeight, speed = Math.max(2000, travel / 4);       // px/s: the whole travel in at most 4 s
      const { gaps, longTasks } = await M.gaps(5000, (t) => { grid.scrollTop = ((t / 1000) * speed) % Math.max(1, travel); });
      out.scroll = { ...gapStats(gaps), long_tasks: longTasks, travel_px: travel, speed_px_s: Math.round(speed) };
      function gapStats(g) { const x = g.slice(2).sort((a, b) => a - b); return { frames: x.length, median_ms: x[Math.floor(x.length / 2)], p95_ms: x[Math.min(x.length - 1, Math.ceil(0.95 * x.length) - 1)], max_ms: x.at(-1) }; }
      return out;
    });
    const result = await run();
    if (withProfile) result.profile_scroll_and_open = await profiled(page, run);
    return { ...result, errors };
  });
}

// ---- the figures --------------------------------------------------------------------------------------------------------------------------
async function figureTrial(rows, withProfile) {
  return withPage(async ({ page, browser, errors }) => {
    await page.evaluate(prepareDataTableFixture, rows);
    const out = { rows, points_one_core: rows / 2, points_two_cores: rows };
    const at = (name) => { out.in_progress = name; };
    try {
    const setSelect = (sel, value) => page.evaluate((s, v) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, sel, value);
    const svgInfo = () => page.evaluate(() => { const s = document.querySelector('#plOut svg'); return s ? { svg_elements: s.querySelectorAll('*').length, svg_chars: s.outerHTML.length } : null; });
    const hover = async (selector) => {                      // real mouse moves over the figure; frame gaps recorded in the page meanwhile
      const box = await (await page.$(selector)).boundingBox();
      await page.evaluate(() => { window.__hover = window.__m.gaps(2500); });
      for (let i = 0; i < 60; i++) { await page.mouse.move(box.x + 20 + (i * 7) % (box.width - 40), box.y + 20 + (i * 5) % (box.height - 40)); await new Promise((r) => setTimeout(r, 30)); }
      const { gaps, longTasks } = await page.evaluate(() => window.__hover);
      return { ...stats(gaps), long_tasks: longTasks };
    };
    // Data tab, plot view. Default layout is the stratigraphic panels; the cross-plot is the XY layout with scatter symbols.
    await page.evaluate(() => { document.getElementById('modeData').click(); });
    at('open_plot'); out.open_plot_ms = await page.evaluate(async () => window.__m.time(() => { const el = document.getElementById('dView'); el.value = 'plot'; el.dispatchEvent(new Event('change', { bubbles: true })); }));
    await page.evaluate(() => { for (const c of document.querySelectorAll('[data-core]')) if (c.checked) { c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); } });
    const checkCore = (index, on) => page.evaluate((i, state) => { const c = document.querySelectorAll('[data-core]')[i]; c.checked = state; c.dispatchEvent(new Event('change', { bubbles: true })); }, index, on);
    at('depth_plot_one_core'); out.depth_plot_one_core_ms = await page.evaluate(async () => window.__m.time(() => { const c = document.querySelectorAll('[data-core]')[0]; c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); }));
    out.depth_plot_one_core = await svgInfo();
    at('depth_plot_hover'); out.depth_plot_hover = await hover('#plOut svg');
    at('switch_to_cross_plot'); await setSelect('[data-p="layout"]', 'xy');
    await page.evaluate(() => { const el = document.querySelector('[data-yk="type"]'); el.value = 'scatter'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.evaluate(() => { const el = document.querySelector('[data-p="v"]'); el.value = 'value_1'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    out.cross_plot_one_core = await svgInfo();
    at('cross_plot_one_core_redraw'); out.cross_plot_one_core_redraw_ms = await page.evaluate(async () => window.__m.time(() => { const el = document.querySelector('[data-p="grid"]'); el.checked = !el.checked; el.dispatchEvent(new Event('change', { bubbles: true })); }));
    at('cross_plot_two_cores'); out.cross_plot_two_cores_ms = await page.evaluate(async () => window.__m.time(() => { const c = document.querySelectorAll('[data-core]')[1]; c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); }));
    out.cross_plot_two_cores = await svgInfo();
    at('cross_plot_two_cores_redraw'); out.cross_plot_two_cores_redraw_ms = await page.evaluate(async () => window.__m.time(() => { const el = document.querySelector('[data-p="grid"]'); el.checked = !el.checked; el.dispatchEvent(new Event('change', { bubbles: true })); }));
    at('cross_plot_hover'); out.cross_plot_hover = await hover('#plOut svg');
    at('profile_cross_plot'); if (withProfile) out.profile_cross_plot_two_cores_redraw = await profiled(page, () => page.evaluate(async () => window.__m.time(() => { const el = document.querySelector('[data-p="grid"]'); el.checked = !el.checked; el.dispatchEvent(new Event('change', { bubbles: true })); })));
    // Multiproxy chart: the same numeric columns as logs along depth.
    await page.evaluate(() => {
      const { S } = window.ichantool; S.geo.settings.axis = 'depth'; S.geo.settings.features = ['value_0', 'value_1', 'value_2']; S.geo.view.core = S.cores[0].id;
    });
    // The log is drawn from a timer after the mode switch, so time runs until a new SVG element exists (then two frames).
    const untilNewSvg = (action) => page.evaluate(async (src) => {
      const old = document.querySelector('#geoLogSvg svg'), start = performance.now();
      (new Function(src))();
      for (let i = 0; i < 4000; i++) { await new Promise((r) => requestAnimationFrame(r)); const s = document.querySelector('#geoLogSvg svg'); if (s && s !== old) break; }
      void document.body.offsetHeight; await window.__m.frame(); return performance.now() - start;
    }, action);
    const svgOfLog = () => page.evaluate(() => { const s = document.querySelector('#geoLogSvg svg'); return s ? { svg_elements: s.querySelectorAll('*').length, svg_chars: s.outerHTML.length } : null; });
    at('multiproxy_open');
    // With --profile-first-open the first (cold) opening of the multiproxy log is profiled; its time then includes the profiler's overhead.
    if (PROFILE_FIRST_OPEN) out.profile_multiproxy_first_open = await profiled(page, async () => { out.multiproxy_open_ms_profiled = await untilNewSvg("document.getElementById('modeGeo').click()"); });
    else out.multiproxy_open_ms = await untilNewSvg("document.getElementById('modeGeo').click()");
    out.multiproxy = await svgOfLog();
    const redraw = "const { S } = window.ichantool; const f = S.geo.settings.features; S.geo.settings.features = f.length > 3 ? f.slice(0, 3) : [...f, 'value_3']; document.getElementById('modeData').click(); document.getElementById('modeGeo').click();";
    at('multiproxy_redraw'); out.multiproxy_redraw_ms = await untilNewSvg(redraw);
    out.multiproxy_after = await svgOfLog();
    at('multiproxy_hover'); if (out.multiproxy_after) out.multiproxy_hover = await hover('#geoLogSvg svg');
    at('profile_multiproxy'); if (withProfile) out.profile_multiproxy_redraw = await profiled(page, () => untilNewSvg(redraw));
    out.in_progress = null;
    } catch (error) { out.stopped = { during: out.in_progress, error: String(error.message).slice(0, 200), after_s: PROTOCOL_MS / 1000 }; }
    out.errors = errors; try { out.chrome = await browser.version(); } catch { /* browser gone */ }
    return out;
  });
}

const report = { tool: 'tools/measure_large_tables.mjs', card: 'M2.1.4', commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), generated: new Date().toISOString(),
  environment: { os: `${os.type()} ${os.release()}`, cpu: os.cpus()[0].model.trim(), logical_cpus: os.cpus().length, memory_gib: round(os.totalmem() / 2 ** 30), node: process.version },
  parameters: { sizes, repetitions: reps, viewport: '1440 x 900', scroll_seconds: 5 }, table: {}, figures: {} };
if (MERGE && OUT && fs.existsSync(OUT)) { const old = JSON.parse(fs.readFileSync(OUT, 'utf8')); report.table = old.table; report.figures = old.figures; }
const save = () => { if (OUT) fs.writeFileSync(OUT, JSON.stringify(report, null, 1)); };
try {
  for (const rows of sizes) {
    if (parts.includes('table')) for (const visibleRows of [false, true]) {
      const key = `${rows}_${visibleRows ? 'visible_rows' : 'native'}`; report.table[key] = [];
      for (let rep = 0; rep < reps; rep++) { console.error(new Date().toTimeString().slice(0, 8), 'table', key, rep + 1); report.table[key].push(await tableTrial(rows, visibleRows, rep === reps - 1)); save(); }
    }
    if (parts.includes('figures')) { report.figures[rows] = [];
    for (let rep = 0; rep < reps; rep++) { console.error(new Date().toTimeString().slice(0, 8), 'figures', rows, rep + 1); report.figures[rows].push(await figureTrial(rows, rep === reps - 1)); save(); } }
  }
} finally { server.close(); save(); }
console.log('written', OUT);
