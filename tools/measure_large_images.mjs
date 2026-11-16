// Card M8.4.13: what the current program does with the multi-gigabyte images of tools/make_large_fixtures.py (Windows only).
//
//   node tools/measure_large_images.mjs FIXTURE_FOLDER --out docs/validation/M8.4.13-large-baseline-windows.json [--only rgb2g,jpeg] [--original rgb2g]
//
// For each file and each of engine off / engine on, a fresh desktop program opens the public example project, imports the file through the
// interface (file input, then "add here"), and records: what happened (added, or the message shown), the working size the program chose, the
// time to the section being selected and drawn, the process-tree memory peak (tools/process_tree_sampler.py, 25 ms), and, if the section was
// added: frame gaps while panning for 3 s and zooming ten steps, input-to-next-frame during a brush stroke, and the time of an interval-table
// analysis. `--original` names files that are also imported with the working-resolution limit set to "original" (engine off only); a file whose
// decoded raster would not fit in an ArrayBuffer is not attempted there and the reason is recorded. Failures are results, not defects.
// Needs `npm i --no-save puppeteer-core@23` and `node desktop/scripts/prepare.js --with-examples`.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { default: puppeteer } = await import(process.env.PUPPETEER_MODULE || 'puppeteer-core');
const root = fileURLToPath(new URL('../', import.meta.url));
const electron = createRequire(path.join(root, 'desktop/package.json'))('electron');
const args = process.argv.slice(2);
const folder = args[0];
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
assert.ok(folder && fs.existsSync(path.join(folder, 'fixtures.json')), 'give the folder written by tools/make_large_fixtures.py (it holds fixtures.json)');
assert.equal(process.platform, 'win32', 'the process-tree sampler is written for Windows');
const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'fixtures.json'), 'utf8'));
const names = (option('only', null)?.split(',') ?? Object.keys(manifest.files));
const originalNames = new Set(option('original', '')?.split(',').filter(Boolean));
const OUT = option('out', null), MiB = 1048576, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round = (v, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const percentile = (values, p) => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : null; };

// (Copied from tools/measure_engine_analysis.mjs, which is a script and exports nothing.)
async function start(mode) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sedcoretool-large-'));
  const env = { ...process.env, SEDCORETOOL_TEST_PROFILE: profile };
  delete env.ELECTRON_RUN_AS_NODE; delete env.SEDCORETOOL_ENGINE_EXPERIMENT;
  if (mode === 'on') env.SEDCORETOOL_ENGINE_EXPERIMENT = '1';
  const child = spawn(electron, [path.join(root, 'tests/e2e/desktop-bootstrap.cjs'), '--headless', '--no-sandbox', '--remote-debugging-port=0'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  let log = '';
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Electron startup timed out: ' + log.slice(-800))), 60000);
    child.stderr.on('data', (bytes) => { log += bytes; const hit = log.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (hit) { clearTimeout(timer); resolve(hit[1]); } });
  });
  const browser = await puppeteer.connect({ browserWSEndpoint: endpoint, defaultViewport: null });
  const target = await browser.waitForTarget((t) => t.url().startsWith('app://corantool/app/index.html'), { timeout: 60000 });
  const page = await target.page();
  page.setDefaultTimeout(60000);
  page.on('dialog', (dialog) => dialog.accept().catch(() => {}));
  await page.waitForFunction(() => !!window.ichantool, { timeout: 60000 });
  if (mode === 'on') await page.waitForFunction(async () => (await window.corantoolDesktop.engine.status()).state === 'ready', { timeout: 90000 });
  return { child, browser, page, exited, profile, async stop() {
    try { await page.close({ runBeforeUnload: false }); } catch { /* closing */ }
    await Promise.race([exited, sleep(15000)]);
    try { browser.disconnect(); } catch { /* ignore */ }
    if (child.exitCode === null) child.kill();
    await exited;
    fs.rmSync(profile, { recursive: true, force: true });
  } };
}
function startSampler(rootPid) {
  const python = execFileSync('py', ['-3.12', '-c', 'import sys; print(sys.executable)'], { encoding: 'utf8', windowsHide: true }).trim();
  const child = spawn(python, [path.join(root, 'tools', 'process_tree_sampler.py'), String(rootPid), '25'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  const samples = []; let buffer = '';
  child.stdout.on('data', (bytes) => {
    buffer += bytes; const lines = buffer.split(String.fromCharCode(10)); buffer = lines.pop();
    for (const line of lines) { const [t, n, b] = line.split('|').map(Number); if (Number.isFinite(b)) samples.push({ t, processes: n, mib: b / MiB }); }
  });
  return { samples, stop: () => child.kill() };
}

async function interactions(page) {
  return page.evaluate(async () => {
    const I = window.ichantool, S = I.S, pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const s = S.sections[S.sections.length - 1], out = {};
    const frames = (ms) => new Promise((resolve) => {
      const gaps = []; let last = performance.now(); const end = last + ms;
      const tick = (t) => { gaps.push(t - last); last = t; if (t < end) requestAnimationFrame(tick); else resolve(gaps); };
      requestAnimationFrame(tick);
    });
    const view = document.getElementById('view'), box = view.getBoundingClientRect();
    const fire = (type, x, y, extra = {}) => view.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1, button: 0, buttons: type === 'pointerup' ? 0 : 1, ...extra }));
    // Pan: drag with the pan tool for 3 s while frames are counted.
    I.setTool('pan');
    const watching = frames(3000);
    fire('pointerdown', box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 90; i++) { fire('pointermove', box.x + box.width / 2 + (i % 40) * 3, box.y + box.height / 2 + i * 2); await pause(30); }
    fire('pointerup', box.x + box.width / 2, box.y + box.height / 2);
    const pan = await watching;
    out.pan = { frames: pan.length, gap_median_ms: [...pan].sort((a, b) => a - b)[Math.floor(pan.length / 2)], gap_p95_ms: [...pan].sort((a, b) => a - b)[Math.min(pan.length - 1, Math.ceil(0.95 * pan.length) - 1)] };
    // Zoom: ten wheel steps.
    const zoomWatching = frames(1500);
    for (let i = 0; i < 10; i++) { view.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: i < 5 ? -240 : 240, ctrlKey: true, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 })); await pause(100); }
    const zoom = await zoomWatching;
    out.zoom = { frames: zoom.length, gap_p95_ms: [...zoom].sort((a, b) => a - b)[Math.min(zoom.length - 1, Math.ceil(0.95 * zoom.length) - 1)] };
    // Brush stroke: input-to-next-frame.
    I.setTool('brush');
    const latency = [];
    const stroke = new Promise((resolve) => {
      const x0 = box.x + box.width * 0.3, y0 = box.y + box.height * 0.4; let i = 0;
      fire('pointerdown', x0, y0);
      const step = () => {
        if (i >= 60) { fire('pointerup', x0, y0); resolve(); return; }
        const t0 = performance.now(); fire('pointermove', x0 + (i % 30) * 4, y0 + Math.floor(i / 30) * 8); i++;
        requestAnimationFrame(() => { latency.push(performance.now() - t0); setTimeout(step, 15); });
      };
      step();
    });
    await stroke;
    const ordered = [...latency].sort((a, b) => a - b);
    out.stroke = { events: latency.length, input_to_frame_p95_ms: ordered[Math.min(ordered.length - 1, Math.ceil(0.95 * ordered.length) - 1)] };
    // Interval table of the new section.
    const t0 = performance.now();
    S.settings.binCm = (S.settings.binCm || 1) * 1.17; s._rc = undefined; s._mv = (s._mv || 0) + 1;
    await I.analyzeSections([s]);
    out.analysis_ms = performance.now() - t0; out.analysis_state = s.analysis?.state ?? 'javascript';
    return out;
  });
}

async function importFile(mode, name, { original = false } = {}) {
  const spec = manifest.files[name], file = path.join(folder, spec.file);
  const record = { file: name, mode, working_resolution_limit: original ? 'original' : '8 MP (default)', fixture: { rows: spec.rows, width: spec.width, bits: spec.bits, encoded_bytes: spec.encoded_bytes, decoded_bytes: spec.decoded_bytes } };
  const decodedRgba = spec.width * spec.rows * 4;
  if (original && decodedRgba > 2 ** 31 - 1) return { ...record, outcome: 'not attempted', reason: `the decoded RGBA raster would be ${(decodedRgba / 2 ** 30).toFixed(1)} GiB, above the 2 GiB a single typed array can address in this program` };
  const session = await start(mode), sampler = startSampler(session.child.pid);
  try {
    const { page } = session;
    await page.evaluate(() => document.getElementById('openTest').click());
    await page.waitForFunction(() => window.ichantool.S.sections.length === 6, { timeout: 120000 });
    if (original) await page.evaluate(() => { window.ichantool.S.settings.maxMP = 1000; });
    await sleep(1500);
    const idle = sampler.samples.at(-1)?.mib ?? null, mark = sampler.samples.length;
    const input = await page.$('#addImg');
    const started = Date.now();
    await input.uploadFile(file);
    await page.waitForSelector('#pcOk', { timeout: 30000 });
    await page.click('#pcOk');
    let outcome = 'timeout after 600 s', message = null;
    for (let waited = 0; waited < 600000; waited += 500) {
      await sleep(500);
      const state = await page.evaluate(() => ({ n: window.ichantool.S.sections.length, toast: document.getElementById('toast')?.hidden === false ? document.getElementById('toast').textContent : null }));
      if (state.n === 7) { outcome = 'added'; break; }
      if (state.toast) { outcome = 'refused'; message = state.toast; break; }
    }
    record.outcome = outcome; if (message) record.message = message.slice(0, 300);
    record.import_ms = Date.now() - started;
    if (outcome === 'added') {
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      record.to_first_frame_ms = Date.now() - started;
      record.section = await page.evaluate(() => { const s = window.ichantool.S.sections.at(-1); return { w: s.w, h: s.h, downsample: s.ds, full: s.full, bits16: !!s.orig16 }; });
      record.interactions = await interactions(page);
    }
    const mem = sampler.samples.slice(mark).map((x) => x.mib);
    record.memory = { idle_mib: round(idle), peak_mib: round(Math.max(...mem, 0)), samples: mem.length, max_processes: Math.max(...sampler.samples.slice(mark).map((x) => x.processes), 0) };
  } catch (error) {
    record.outcome = record.outcome ?? 'error'; record.error = String(error.message).slice(0, 400);
    const mem = sampler.samples.map((x) => x.mib); record.memory = { peak_mib: round(Math.max(...mem, 0)) };
  } finally { sampler.stop(); await session.stop(); }
  return record;
}

const report = { tool: 'tools/measure_large_images.mjs', card: 'M8.4.13', commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), generated: new Date().toISOString(),
  environment: { os: `${os.type()} ${os.release()}`, cpu: os.cpus()[0].model.trim(), logical_cpus: os.cpus().length, memory_gib: round(os.totalmem() / 2 ** 30), node: process.version, electron: createRequire(path.join(root, 'desktop/package.json'))('electron/package.json').version },
  fixtures: manifest, results: [] };
for (const name of names) {
  for (const mode of ['off', 'on']) {
    console.error(new Date().toTimeString().slice(0, 8), name, mode);
    report.results.push(await importFile(mode, name));
    if (OUT) fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  }
  if (originalNames.has(name)) {
    console.error(new Date().toTimeString().slice(0, 8), name, 'off, original resolution');
    report.results.push(await importFile('off', name, { original: true }));
    if (OUT) fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  }
}
if (OUT) fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.results.map((r) => ({ file: r.file, mode: r.mode, limit: r.working_resolution_limit, outcome: r.outcome, import_ms: r.import_ms, peak_mib: r.memory?.peak_mib })), null, 1));
