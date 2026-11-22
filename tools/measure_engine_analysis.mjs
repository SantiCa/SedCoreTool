// M8.3.8: measures the acceptance gates of docs/roadmap-engine-contract.md §7 for the first engine slice
// (`section.intervals/1`) in the desktop program run from source with the bundled runtime. Windows only.
//
//   node tools/measure_engine_analysis.mjs --out docs/validation/M8.3.8-windows-v0.150.json [--pairs 6] [--cycles 10]
//     [--synthetic path/to/package.sedcoretool]     (written by tools/benchmark.py::make_synthetic; needed for the eight-section fixture)
//     [--only timing,scenarios,responsiveness,stages,cancel,cycles,kill,pixels,ages] [--pixel-pairs 2]   (pixels: card M8.4.9; ages: card M8.5.6)
//
// Needs `npm i --no-save puppeteer-core@23` at the repository root and `node desktop/scripts/prepare.js --with-examples`.
// Every sample is recorded. Gates are evaluated from the recorded samples in `verdicts`; nothing is relaxed afterwards.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { memoryPeakVerdict, timingVerdict } from './engine_gates.mjs';

const { default: puppeteer } = await import(process.env.PUPPETEER_MODULE || 'puppeteer-core');
const root = fileURLToPath(new URL('../', import.meta.url));
const requireDesktop = createRequire(path.join(root, 'desktop/package.json'));
const electron = requireDesktop('electron');
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const only = option('only', null), want = (name) => !only || only.split(',').includes(name);
const PAIRS = Number(option('pairs', 6)), CYCLES = Number(option('cycles', 10)), OUT = option('out', null), SYNTHETIC = option('synthetic', null);
assert.equal(process.platform, 'win32', 'the process-tree sampler is written for Windows');

const round = (v, d = 1) => (v === null || v === undefined ? null : Math.round(v * 10 ** d) / 10 ** d);
const percentile = (values, p) => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : null; };
const median = (values) => percentile(values, 0.5);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MiB = 1048576;

// ---- launching the desktop program ----------------------------------------------------------------------------------

async function start(mode) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sedcoretool-measure-'));
  const env = { ...process.env, SEDCORETOOL_TEST_PROFILE: profile };
  delete env.ELECTRON_RUN_AS_NODE; delete env.SEDCORETOOL_ENGINE_PYTHON; delete env.SEDCORETOOL_ENGINE_EXPERIMENT;
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
  page.setDefaultTimeout(180000);
  page.on('dialog', (dialog) => dialog.accept().catch(() => {}));
  await page.waitForFunction(() => !!window.ichantool, { timeout: 60000 });
  if (mode === 'on') await page.waitForFunction(async () => (await window.corantoolDesktop.engine.status()).state === 'ready', { timeout: 90000 });
  child.stdout.on('data', (bytes) => { log += bytes; });
  return { child, exited, browser, page, profile, mode, tail: () => log.slice(-1500),
    async stop() {
      try { await page.close({ runBeforeUnload: false }); } catch { /* already closing */ }
      await Promise.race([exited, sleep(15000)]);
      try { browser.disconnect(); } catch { /* ignore */ }
      if (child.exitCode === null) child.kill();
      await exited;
      fs.rmSync(profile, { recursive: true, force: true });
    } };
}

async function loadFixture(page, fixture) {
  if (fixture === 'public') {
    await page.evaluate(() => document.getElementById('openTest').click());
    await page.waitForFunction(() => window.ichantool.S.sections.length === 6 && window.ichantool.S.sections.every((s) => s.objects.size > 0), { timeout: 120000 });
  } else {
    assert.ok(SYNTHETIC && fs.existsSync(SYNTHETIC), 'pass --synthetic <package> for the eight-section fixture');
    await page.waitForFunction(() => document.querySelector('#projList .pempty') || document.querySelector('#projList'), { timeout: 60000 });
    await (await page.$('#impProj')).uploadFile(SYNTHETIC);
    await page.waitForFunction(() => window.ichantool.S.sections.length === 8 && window.ichantool.S.sections.every((s) => s.objects.size > 0), { timeout: 180000 });
  }
  await page.waitForFunction(() => document.getElementById('saveState').dataset.state === 'saved', { timeout: 60000 });
  // The comparison uses the program's ordinary settings: the interval size is set below, everything else is the default.
  await page.evaluate(async () => { await window.ichantool.analyzeSections(window.ichantool.S.sections); });
}

// ---- in-page procedures ---------------------------------------------------------------------------------------------

/** Sets the interval size, brings every section up to date and compares with the JavaScript reference. `cold` empties the JavaScript row caches. */
async function analyseAt(page, binCm) {
  return page.evaluate(async (binCm) => {
    const I = window.ichantool, S = I.S;
    S.settings.binCm = binCm;
    for (const s of S.sections) { s._rc = undefined; s._mv = (s._mv || 0) + 1; }      // a new mask version: both calculations start from nothing
    const t0 = performance.now(); await I.analyzeSections(S.sections); const cold = performance.now() - t0;
    const t1 = performance.now(); await I.analyzeSections(S.sections); const unchanged = performance.now() - t1;
    const mismatches = []; let bins = 0;
    S.sections.forEach((s, i) => {
      const reference = I.referenceBins(s);
      if (reference.length !== s.bins.length) { mismatches.push(`section ${i}: ${s.bins.length} bins, expected ${reference.length}`); return; }
      reference.forEach((expected, j) => {
        bins++;
        const actual = s.bins[j];
        for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
          const a = actual[key], e = expected[key], close = (x, y) => (typeof x === 'number' && typeof y === 'number' ? Math.abs(x - y) <= 1e-9 : x === y);
          if (!(Array.isArray(e) ? Array.isArray(a) && a.length === e.length && e.every((v, k) => close(a[k], v)) : close(a, e))) mismatches.push(`s${i} b${j} ${key}: engine ${JSON.stringify(a)} vs javascript ${JSON.stringify(e)}`);
        }
      });
    });
    return { binCm, sections: S.sections.length, bins, cold_ms: cold, unchanged_ms: unchanged, mismatches: mismatches.slice(0, 20), mismatch_count: mismatches.length,
      states: S.sections.map((s) => (s.analysis?.state === 'error' ? `error ${s.analysis.code} ${s.analysis.field ?? ''}` : s.analysis?.state ?? null)) };
  }, binCm);
}

// ---- process-tree sampling ------------------------------------------------------------------------------------------

/** `tools/process_tree_sampler.py` sums the working sets of the Electron main process and all its descendants (Electron, the engine
 *  coordinator, the method worker) every 25 ms; the cadence it really achieves is measured and reported with each summary. */
function startSampler(rootPid) {
  const python = execFileSync('py', ['-3.12', '-c', 'import sys; print(sys.executable)'], { encoding: 'utf8', windowsHide: true }).trim();
  const child = spawn(python, [path.join(root, 'tools', 'process_tree_sampler.py'), String(rootPid), '25'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  const samples = []; let buffer = '';
  child.stdout.on('data', (bytes) => {
    buffer += bytes; const lines = buffer.split(String.fromCharCode(10)); buffer = lines.pop();
    for (const line of lines) { const [t, n, b] = line.split('|').map(Number); if (Number.isFinite(b)) samples.push({ t, processes: n, mib: b / MiB, at: performance.now() }); }
  });
  return { samples, mark: () => samples.length, stop: () => child.kill() };
}
function summarise(samples) {
  if (!samples.length) return null;
  const gaps = samples.slice(1).map((s, i) => s.t - samples[i].t);
  return { samples: samples.length, peak_mib: round(Math.max(...samples.map((s) => s.mib))), median_mib: round(median(samples.map((s) => s.mib))), max_processes: Math.max(...samples.map((s) => s.processes)),
    cadence_median_ms: round(median(gaps)), cadence_max_gap_ms: round(Math.max(...gaps, 0)) };
}

// ---- process lookups for the kill test -------------------------------------------------------------------------------

/** Process ids of every python.exe (tasklist answers in tens of milliseconds; a CIM query takes a second). */
function pythonPids() {
  try {
    return new Set(execFileSync('tasklist', ['/FI', 'IMAGENAME eq python.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true })
      .split(String.fromCharCode(10)).map((line) => Number((line.split('","')[1] || '').replace(/"/g, ''))).filter(Number.isInteger));
  } catch { return new Set(); }
}
/** Command line of one process, or '' when it is gone. */
function commandLineOf(pid) {
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`], { encoding: 'utf8', windowsHide: true });
  } catch { return ''; }
}
const scratchFiles = () => fs.readdirSync(os.tmpdir(), { withFileTypes: true }).filter((d) => d.isDirectory() && d.name.startsWith('sedcoretool-engine-'))
  .reduce((sum, d) => { const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? 1 + walk(path.join(dir, e.name)) : 1), 0); try { return sum + 1 + walk(path.join(os.tmpdir(), d.name)); } catch { return sum; } }, 0);

/** Reloads the page the way the program itself would (the dialog handler accepts a beforeunload prompt) and waits for the new document. */
async function reloadPage(page) {
  await page.evaluate(() => { window.__before = Math.random(); setTimeout(() => location.reload(), 0); }).catch(() => {});
  for (let i = 0; i < 600; i++) {
    await sleep(100);
    const fresh = await page.evaluate(() => !!window.ichantool && window.__before === undefined).catch(() => false);
    if (fresh) return;
  }
  throw new Error('The page did not reload');
}

// ---- the measurements -----------------------------------------------------------------------------------------------

const report = { schema: 1, tool: 'tools/measure_engine_analysis.mjs', started: new Date().toISOString(), commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  host: { os: `${os.type()} ${os.release()}`, cpu: os.cpus()[0]?.model, logical_cpus: os.cpus().length, memory_gib: round(os.totalmem() / 2 ** 30), node: process.version, electron: requireDesktop('electron/package.json').version,
    runtime: JSON.parse(fs.readFileSync(path.join(root, 'desktop', 'runtime', 'win32-x64', 'manifest.json'), 'utf8')).python_version },
  fixtures: {}, parameters: { pairs: PAIRS, cycles: CYCLES, bin_sizes_cm: [2, 1.37] }, results: {}, verdicts: {} };
const fixtures = ['public', ...(SYNTHETIC ? ['synthetic'] : [])];
if (SYNTHETIC) report.fixtures.synthetic = { package: path.basename(SYNTHETIC), bytes: fs.statSync(SYNTHETIC).size, sha256: execFileSync('certutil', ['-hashfile', SYNTHETIC, 'SHA256'], { encoding: 'utf8' }).split(/\r?\n/)[1].trim() };
const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a);

/** One fresh process: load the fixture, then cold analysis at each interval size. Returns the samples. */
async function timedRun(mode, fixture) {
  const session = await start(mode);
  try {
    await loadFixture(session.page, fixture);
    const runs = []; for (const binCm of [2, 1.37]) runs.push(await analyseAt(session.page, binCm));
    return runs;
  } finally { await session.stop(); }
}

for (const fixture of want('timing') ? fixtures : []) {
  log('timing', fixture);
  const record = { warmup: null, pairs: [] };
  record.warmup = { off: await timedRun('off', fixture), on: await timedRun('on', fixture) };
  for (let pair = 0; pair < PAIRS; pair++) {
    const order = pair % 2 === 0 ? ['off', 'on'] : ['on', 'off'];   // AB, BA, AB, ...
    const entry = { order };
    for (const mode of order) entry[mode] = await timedRun(mode, fixture);
    record.pairs.push(entry);
  }
  const collect = (mode, bin, field) => record.pairs.map((p) => p[mode].find((r) => r.binCm === bin)[field]);
  record.summary = {};
  for (const bin of [2, 1.37]) record.summary[`${bin}cm`] = Object.fromEntries(['cold_ms', 'unchanged_ms'].flatMap((field) => ['off', 'on'].map((mode) => [`${field}_${mode}`,
    { median: round(median(collect(mode, bin, field))), min: round(Math.min(...collect(mode, bin, field))), max: round(Math.max(...collect(mode, bin, field))) }])));
  record.parity = { total_bins: record.pairs.reduce((n, p) => n + p.on.reduce((m, r) => m + r.bins, 0), 0),
    mismatches: record.pairs.reduce((n, p) => n + p.on.reduce((m, r) => m + r.mismatch_count, 0), 0), engine_states_ready: record.pairs.every((p) => p.on.every((r) => r.states.every((s) => s === 'ready'))) };
  report.results[`timing_${fixture}`] = record;
}

const largest = SYNTHETIC ? 'synthetic' : 'public';

// ---- warm scenarios of contract §7 (card M8.4.1) ----------------------------------------------------------------------
// One fresh process per run. The project is loaded and analysed once (warm-up), then each scenario is timed from the request
// to the published result for every section it touches:
//   (a) the interval size changes on all sections (no new mask version),
//   (b) one edit on the largest section, its undo and its redo (the edit is the deletion of the trace whose area is closest to
//       2,000 pixels, through the interface's own Delete key; undo and redo through the interface's buttons),
//   (c) the same analysis requested again with nothing changed.
// A run also records the peak of the summed working set of the Electron process tree (sampler at 25 ms) in both modes.
async function scenarioRun(mode, fixture) {
  const session = await start(mode), sampler = startSampler(session.child.pid);
  try {
    await loadFixture(session.page, fixture); await sleep(1500);
    const mark = sampler.mark();
    const timed = await session.page.evaluate(async () => {
      const I = window.ichantool, S = I.S, pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const time = async (action) => { const t0 = performance.now(); await action(); return performance.now() - t0; };
      const out = { interval_ms: [], edit_ms: null, undo_ms: null, redo_ms: null, unchanged_ms: [], notes: [] };
      for (const binCm of [1.37, 2]) { out.interval_ms.push(await time(async () => { S.settings.binCm = binCm; await I.analyzeSections(S.sections); })); await pause(300); }
      const index = S.sections.indexOf([...S.sections].sort((a, b) => b.w * b.h - a.w * a.h)[0]), s = S.sections[index];
      S.cur = index; await pause(300);
      const trace = [...s.objects.values()].filter((o) => o.area).sort((a, b) => Math.abs(a.area - 2000) - Math.abs(b.area - 2000))[0];
      out.trace_area_px = trace.area;
      S.selected = trace.id;
      out.edit_ms = await time(async () => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })); await I.analyzeSections([s]); });
      out.deleted = !s.objects.has(trace.id); await pause(400);
      out.undo_ms = await time(async () => { document.getElementById('undoBtn').click(); await I.analyzeSections([s]); });
      out.restored = s.objects.has(trace.id); await pause(400);
      out.redo_ms = await time(async () => { document.getElementById('redoBtn').click(); await I.analyzeSections([s]); });
      out.deleted_again = !s.objects.has(trace.id); await pause(400);
      for (let i = 0; i < 2; i++) out.unchanged_ms.push(await time(() => I.analyzeSections(S.sections)));
      const mismatches = [];
      S.sections.forEach((section, i) => {
        const reference = I.referenceBins(section);
        if (reference.length !== section.bins.length) { mismatches.push(`section ${i}: ${section.bins.length} bins, expected ${reference.length}`); return; }
        reference.forEach((expected, j) => { const a = section.bins[j]; for (const key of ['r0', 'r1', 'valid', 'pct', 'BI', 'ii']) if (a[key] !== expected[key] && !(typeof a[key] === 'number' && Math.abs(a[key] - expected[key]) <= 1e-9)) mismatches.push(`s${i} b${j} ${key}`); });
      });
      out.mismatch_count = mismatches.length; out.states = S.sections.map((section) => section.analysis?.state ?? null);
      return out;
    });
    return { ...timed, memory: summarise(sampler.samples.slice(mark)) };
  } finally { sampler.stop(); await session.stop(); }
}

for (const fixture of want('scenarios') ? fixtures : []) {
  log('scenarios', fixture);
  const record = { warmup: { off: await scenarioRun('off', fixture), on: await scenarioRun('on', fixture) }, pairs: [] };
  for (let pair = 0; pair < PAIRS; pair++) {
    const order = pair % 2 === 0 ? ['off', 'on'] : ['on', 'off'], entry = { order };
    for (const mode of order) entry[mode] = await scenarioRun(mode, fixture);
    record.pairs.push(entry);
  }
  report.results[`scenarios_${fixture}`] = record;
}

// Responsiveness, cancellation, memory, cycles and failures: engine on, largest fixture.
if (want('responsiveness')) {
  log('responsiveness and memory', largest);
  const results = {};
  for (const mode of ['off', 'on']) {
    const session = await start(mode), sampler = mode === 'on' ? startSampler(session.child.pid) : null;
    try {
      await loadFixture(session.page, largest); await sleep(1500);
      const idle = sampler ? summarise(sampler.samples.slice(-20)) : null;
      const startMark = sampler ? sampler.mark() : 0;
      // Frame gaps and input-to-next-frame latency while a recount runs (the interval size changes, so every section is new).
      await session.page.evaluate(() => {
        window.__gaps = []; window.__latency = []; let last = performance.now();
        const frame = (t) => { window.__gaps.push(t - last); last = t; if (window.__watch) requestAnimationFrame(frame); };
        window.__watch = true; requestAnimationFrame(frame);
        document.addEventListener('pointermove', (e) => requestAnimationFrame((t) => window.__latency.push(t - e.timeStamp)), { passive: true });
      });
      const analysis = session.page.evaluate(async () => { const I = window.ichantool; I.S.settings.binCm = 1.1; for (const s of I.S.sections) s._rc = undefined; const t = performance.now(); await I.analyzeSections(I.S.sections); return performance.now() - t; });
      for (let i = 0; i < 60; i++) { await session.page.mouse.move(300 + (i % 20) * 7, 300 + (i % 11) * 5); await sleep(15); }
      const elapsed = await analysis;
      const measured = await session.page.evaluate(() => { window.__watch = false; return { gaps: window.__gaps, latency: window.__latency }; });
      results[mode] = { analysis_ms: round(elapsed), frames: measured.gaps.length, frame_gap_p95_ms: round(percentile(measured.gaps, 0.95)), frame_gap_max_ms: round(Math.max(...measured.gaps, 0)),
        input_to_frame_p95_ms: round(percentile(measured.latency, 0.95)), input_to_frame_max_ms: round(Math.max(...measured.latency, 0)), input_events: measured.latency.length,
        memory: sampler ? { idle, during_analysis: summarise(sampler.samples.slice(startMark)) } : 'engine off: the sampler measures the engine tree only' };
      // Guarantee (4) of card M8.4.4: input-to-next-frame during a brush stroke, while the analysis of the previous stroke is still on its way.
      await session.page.evaluate(() => { window.ichantool.setTool('brush'); });
      const box = await session.page.evaluate(() => { const r = document.getElementById('view').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
      const stroke = async (moves, pause) => {
        await session.page.mouse.move(box.x + box.w * 0.3, box.y + box.h * 0.4); await session.page.mouse.down();
        for (let i = 0; i < moves; i++) { await session.page.mouse.move(box.x + box.w * 0.3 + (i % 30) * 6, box.y + box.h * 0.4 + Math.floor(i / 30) * 12); await sleep(pause); }
        await session.page.mouse.up();
      };
      await stroke(30, 10);                                                       // its analysis starts 100 ms later and runs while the next stroke is drawn
      await session.page.evaluate(() => { window.__latency = []; window.__gaps = []; window.__watch = true; let last = performance.now(); const frame = (t) => { window.__gaps.push(t - last); last = t; if (window.__watch) requestAnimationFrame(frame); }; requestAnimationFrame(frame); });
      await stroke(60, 15);
      const settled = await session.page.evaluate(async () => { const I = window.ichantool; await I.analyzeSections(I.S.sections); return I.S.sections.every((s) => s.analysis?.state === 'ready' || s.analysis === undefined); });
      const strokeMeasured = await session.page.evaluate(() => { window.__watch = false; return { gaps: window.__gaps, latency: window.__latency }; });
      results[mode].stroke = { input_to_frame_p95_ms: round(percentile(strokeMeasured.latency, 0.95)), input_to_frame_max_ms: round(Math.max(...strokeMeasured.latency, 0)), input_events: strokeMeasured.latency.length,
        frame_gap_p95_ms: round(percentile(strokeMeasured.gaps, 0.95)), settled };
    } finally { sampler?.stop(); await session.stop(); }
  }
  report.results.responsiveness_memory = { fixture: largest, ...results };
}

if (want('stages')) {
  log('stages', largest);
  const session = await start('on');
  try {
    await loadFixture(session.page, largest);
    report.results.stages = { fixture: largest, ...(await session.page.evaluate(async () => {
      const { createEngineClient } = await import('app://corantool/app/js/engineclient.js');
      const { buildIntervalSnapshot, computeSectionBins } = await import('app://corantool/app/js/sectionanalysis.js');
      const I = window.ichantool, S = I.S, s = [...S.sections].sort((a, b) => b.w * b.h - a.w * a.h)[0];
      const project = { classes: S.classes, settings: S.settings, ageModel: S.age.model, ageUnits: S.age.units }, client = createEngineClient(window.corantoolDesktop.engine);
      const runs = [];
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now(), snapshot = buildIntervalSnapshot(s, project), snapshotMs = performance.now() - t0;
        const result = await client.analyze(snapshot);
        const t1 = performance.now(); s._rc = undefined; computeSectionBins(s, project); const javascriptMs = performance.now() - t1;
        runs.push({ snapshot_ms: snapshotMs, ...result.timing, engine_reported_ms: result.provenance.elapsed_ms, javascript_ms: javascriptMs });
      }
      return { section_pixels: s.w * s.h, label_bytes: s.w * s.h * 4, runs };
    })) };
  } finally { await session.stop(); }
}

if (want('cancel')) {
  log('cancellation', largest);
  const session = await start('on');
  try {
    await loadFixture(session.page, largest);
    const samples = [];
    for (let i = 0; i < 5; i++) {
      samples.push(await session.page.evaluate(async () => {
        const { createEngineClient } = await import('app://corantool/app/js/engineclient.js');
        const { buildIntervalSnapshot } = await import('app://corantool/app/js/sectionanalysis.js');
        const I = window.ichantool, S = I.S, s = [...S.sections].sort((a, b) => b.w * b.h - a.w * a.h)[0];
        const real = window.corantoolDesktop.engine, marks = {};
        const bridge = { ...real, analyzeSection: (request) => { marks.sent = performance.now(); return real.analyzeSection(request).then((r) => { marks.done = performance.now(); return r; }); },
          cancel: (key) => { marks.cancelAsked = performance.now(); return real.cancel(key).then((r) => { marks.acknowledged = performance.now(); return r; }); } };
        const client = createEngineClient(bridge), controller = new AbortController();
        const running = client.analyze(buildIntervalSnapshot(s, { classes: S.classes, settings: S.settings, ageModel: S.age.model, ageUnits: S.age.units }), { signal: controller.signal });
        while (!marks.sent) await new Promise((r) => setTimeout(r, 1));
        controller.abort(); const aborted = performance.now();
        let outcome = 'completed';
        try { await running; } catch (error) { outcome = error?.name === 'AbortError' ? 'cancelled' : `error ${error?.code}`; }
        return { outcome, abort_to_ack_ms: marks.acknowledged ? marks.acknowledged - aborted : null, abort_to_terminal_ms: performance.now() - aborted, analysis_sent_to_done_ms: marks.done ? marks.done - marks.sent : null };
      }));
      await sleep(300);
    }
    await sleep(1500);
    report.results.cancellation = { fixture: largest, samples: samples.map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, typeof v === 'number' ? round(v) : v]))), scratch_files_after: scratchFiles() };
  } finally { await session.stop(); }
}

if (want('cycles')) {
  log('cycles');
  const session = await start('on'), sampler = startSampler(session.child.pid);
  try {
    const cycles = []; await sleep(3000);
    // Cycle -1 is the warm-up of the contract ("after warm-up"): it is run exactly like the others and not counted.
    for (let i = -1; i < CYCLES; i++) {
      await reloadPage(session.page);
      await session.page.waitForFunction(() => !!window.ichantool, { timeout: 60000 });
      await session.page.evaluate(() => window.ichantool.ready); await sleep(i <= 0 ? 4000 : 1500);
      const closed = summarise(sampler.samples.slice(-12));
      await loadFixture(session.page, 'public');
      const run = await analyseAt(session.page, 1.5 + (i + 1) * 0.1);
      if (i < 0) continue;
      cycles.push({ cycle: i + 1, closed_state_mib: closed?.median_mib, analysis_cold_ms: round(run.cold_ms), mismatches: run.mismatch_count, mismatch_detail: run.mismatches, states: run.states, scratch_files: scratchFiles() });
    }
    await reloadPage(session.page); await session.page.waitForFunction(() => !!window.ichantool); await sleep(2500);
    const final = summarise(sampler.samples.slice(-12));
    report.results.cycles = { fixture: 'public', cycles, final_closed_state_mib: final?.median_mib,
      status_after: await session.page.evaluate(async () => (await window.corantoolDesktop.engine.status()).state) };
  } finally { sampler.stop(); await session.stop(); }
}

if (want('kill')) {
  log('worker and coordinator kill');
  const session = await start('on');
  try {
    await loadFixture(session.page, largest);
    const result = {};
    for (let attempt = 1; attempt <= 3; attempt++) {
      // Kill workers while they calculate: the sections they were serving must show an engine error, the engine must stay usable.
      // One PowerShell process looks for children of the coordinator (workers) in a loop and ends every one it sees.
      const coordinatorPid = [...pythonPids()].find((pid) => /engine[\\/]+server\.py/.test(commandLineOf(pid)));
      assert.ok(coordinatorPid, 'the coordinator is running');
      const killer = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `$end=(Get-Date).AddSeconds(60); while((Get-Date) -lt $end){ $c=Get-CimInstance Win32_Process -Filter "ParentProcessId=${coordinatorPid} AND Name='python.exe'"; if($c){ $id=@($c)[0].ProcessId; Stop-Process -Id $id -Force -ErrorAction SilentlyContinue; Write-Output $id } }`],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      const killedWorkers = [];
      killer.stdout.on('data', (bytes) => { for (const id of String(bytes).split(String.fromCharCode(10))) if (Number(id)) killedWorkers.push(Number(id)); });
      const racing = session.page.evaluate(async (attempt) => {
        const I = window.ichantool; I.S.settings.binCm = 1.05 + attempt * 0.01; for (const s of I.S.sections) { s._rc = undefined; s._mv = (s._mv || 0) + 1; }
        await I.analyzeSections(I.S.sections);
        return I.S.sections.map((s) => (s.analysis?.state === 'error' ? s.analysis.code : s.analysis?.state));
      }, attempt).catch((error) => ({ page_error: String(error.message).slice(0, 200), electron_exit_code: session.child.exitCode, electron_output_tail: session.tail().slice(-1200) }));
      const states = await racing;
      killer.kill();
      result.worker = { attempt, killed_pids: [...new Set(killedWorkers)], section_states: states, status: await session.page.evaluate(async () => (await window.corantoolDesktop.engine.status()).state) };
      if (result.worker.killed_pids.length && result.worker.section_states.includes('INTERNAL')) break;
      await sleep(500);   // the killer missed every worker this time: the contract asks for a kill during a job, so try again
    }
    // The next edit must work again if the coordinator is alive.
    if (result.worker.status === 'ready') result.worker.next_analysis = await analyseAt(session.page, 1.9).then((r) => ({ mismatches: r.mismatch_count, states: r.states }));
    // Kill the coordinator.
    log('worker phase', JSON.stringify(result.worker));
    const before = scratchFiles(), coordinator = { pid: [...pythonPids()].find((pid) => /engine[\\/]+server\.py/.test(commandLineOf(pid))) };
    if (coordinator.pid) { try { execFileSync('taskkill', ['/pid', String(coordinator.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* already gone */ } }
    await sleep(1500);
    const after = await session.page.evaluate(async () => {
      const I = window.ichantool; I.S.settings.binCm = 1.8; for (const s of I.S.sections) s._rc = undefined; await I.analyzeSections(I.S.sections);
      return { status: (await window.corantoolDesktop.engine.status()).state, section_states: I.S.sections.map((s) => s.analysis?.state === 'error' ? s.analysis.code : s.analysis?.state), responsive: true };
    });
    result.coordinator = { killed_pid: coordinator.pid ?? null, scratch_files_before: before, scratch_files_after: scratchFiles(), ...after };
    report.results.kill = result;
  } finally { await session.stop(); }
}

// ---- working pixels of small sections resident in the engine (card M8.4.9) ----------------------------------------------------
// One fresh process per run, engine off and on in alternating order. Every section's pixels are decoded in the page; with the engine on
// they are then made resident through the program's own client (window.ichantool.enginePixels), next to the masks and tables the first
// analysis left there. Then every section gets a new mask version (all masks are sent again) and the interval size changes, with the
// pixels resident. Recorded: the bytes of pixels, masks and tables of each section, what the client keeps resident, how often the
// engine reported its session budget full (`budgetFull`), the analysis states, and the process-tree memory from the moment the
// pixels are uploaded to the end of the analyses.
async function pixelRun(mode, fixture) {
  const session = await start(mode), sampler = startSampler(session.child.pid);
  try {
    await loadFixture(session.page, fixture);
    const loaded = await session.page.evaluate(async () => {
      const I = window.ichantool, t0 = performance.now();
      for (const s of I.S.sections) I.needPixels(s);
      while (!I.S.sections.every((s) => s.orig) && performance.now() - t0 < 120000) await new Promise((resolve) => setTimeout(resolve, 50));
      return I.S.sections.every((s) => s.orig);
    });
    await sleep(1500);
    const idle = summarise(sampler.samples.slice(-20)), mark = sampler.mark();
    const run = await session.page.evaluate(async (on) => {
      const I = window.ichantool, S = I.S, { buildIntervalSnapshot } = await import('app://corantool/app/js/sectionanalysis.js');
      const project = { classes: S.classes, settings: S.settings, ageModel: S.age.model, ageUnits: S.age.units }, encoder = new TextEncoder();
      const sizes = S.sections.map((s) => {
        const snapshot = buildIntervalSnapshot(s, project);
        return { w: s.w, h: s.h, bits: s.orig16 ? 16 : 8, pixel_bytes: s.orig.byteLength + (s.orig16?.byteLength ?? 0),
          mask_bytes: ['labels', 'exclude', 'stack_offsets', 'stack_members'].reduce((n, k) => n + (snapshot[k]?.data?.byteLength ?? 0), 0),
          table_bytes: ['objects', 'classes', 'settings', 'age_model', 'manual_indices'].reduce((n, k) => n + encoder.encode(JSON.stringify(snapshot[k])).length, 0) };
      });
      const time = async (action) => { const t0 = performance.now(); await action(); return performance.now() - t0; };
      const uploads = [];
      if (on) for (const s of S.sections) {
        const t0 = performance.now();
        try { const tokens = await I.enginePixels(s); uploads.push({ ok: true, ms: performance.now() - t0, rgba16: !!tokens.rgba16 }); }
        catch (error) { uploads.push({ ok: false, ms: performance.now() - t0, code: error?.code ?? String(error?.message).slice(0, 80) }); }
      }
      const afterUpload = I.engineStats();
      for (const s of S.sections) { s._rc = undefined; s._mv = (s._mv || 0) + 1; }      // a new mask version everywhere: every mask is sent again
      const fullMs = await time(() => I.analyzeSections(S.sections));
      S.settings.binCm = 1.37;
      const intervalMs = await time(() => I.analyzeSections(S.sections));
      const againMs = on ? await time(async () => { for (const s of S.sections) await I.enginePixels(s); }) : null;
      const pick = (stats) => stats && { fullMaskUploads: stats.fullMaskUploads, derivations: stats.derivations, budgetFull: stats.budgetFull, residentBytes: stats.residentBytes,
        residentPixelBytes: stats.residentPixelBytes, residentPixelSections: stats.residentPixelSections };
      return { sizes, uploads, full_ms: fullMs, interval_ms: intervalMs, pixels_again_ms: againMs, after_upload: pick(afterUpload), after_analyses: pick(I.engineStats()),
        states: S.sections.map((s) => (s.analysis?.state === 'error' ? `error ${s.analysis.code} ${s.analysis.field ?? ''}` : s.analysis?.state ?? null)) };
    }, mode === 'on');
    return { ...run, pixels_loaded: loaded, idle_memory: idle, memory: summarise(sampler.samples.slice(mark)) };
  } finally { sampler.stop(); await session.stop(); }
}

const RESIDENT_MASK_BYTES = 256 * MiB, RESIDENT_PIXELS = 192 * MiB, TRANSIENT_RESERVE = 16 * MiB;
/** The engine's charge for what the client keeps (buffers.py: a metadata table is charged 64 times its bytes, plus the transient reserve). */
function engineChargeModel(run) {
  const sum = (key) => run.sizes.reduce((n, s) => n + s[key], 0);
  const masks = sum('mask_bytes'), tables = sum('table_bytes'), pixels = sum('pixel_bytes'), largestMasks = Math.max(...run.sizes.map((s) => s.mask_bytes));
  const charge = (maskAndTableBytes) => Math.min(maskAndTableBytes, RESIDENT_MASK_BYTES) + 63 * tables + Math.min(pixels, RESIDENT_PIXELS) + TRANSIENT_RESERVE;
  // While a section's masks are sent again, its old copy stays until the analysis ends; the client bounds both together by its 256 MiB.
  return { masks_mib: round(masks / MiB), tables_mib: round(tables / MiB), table_charge_mib: round(64 * tables / MiB), pixels_mib: round(pixels / MiB),
    resident_charge_mib: round(charge(masks + tables) / MiB), during_full_upload_charge_mib: round(charge(masks + tables + largestMasks) / MiB) };
}
const PIXEL_PAIRS = Number(option('pixel-pairs', 2));

for (const fixture of want('pixels') ? fixtures : []) {
  log('pixels', fixture);
  const record = { pairs: [] };
  for (let pair = 0; pair < PIXEL_PAIRS; pair++) {
    const order = pair % 2 === 0 ? ['off', 'on'] : ['on', 'off'], entry = { order };
    for (const mode of order) entry[mode] = await pixelRun(mode, fixture);
    record.pairs.push(entry);
  }
  record.charge_model = engineChargeModel(record.pairs[0].on);
  report.results[`pixels_${fixture}`] = record;
}

// ---- core.ages/1 matched timing and Y9 target (card M8.5.6) ---------------------------------------------------------
// One fresh process per run, engine off and on in alternating order (1 warm-up pair + PAIRS pairs).
// Cases: each core of the public example (U1385I-1H) plus deterministic generated cores of 1,000, 10,000 and 100,000 rows
// (200-knot age model with reversals and age_min/age_max range; query depths with knots, inside, outside and nulls).
// Scenarios per case (timed warm inside each fresh process):
//   first:       buildTableSnapshot(age_model, query) -> ensureTable(both) -> client.run('core.ages/1', ...) -> decoded tables.ages
//   unchanged:   re-run buildTableSnapshot(age_model, query) -> ensureTable(both, cache hit) -> client.run('core.ages/1', ...)
//   one_changed: middle finite depth perturbed -> buildTableSnapshot(query) -> ensureTable(query) -> client.run('core.ages/1', ...)
async function agesRun(mode) {
  const session = await start(mode);
  try {
    await loadFixture(session.page, 'public');
    return await session.page.evaluate(async (on) => {
      const { createEngineClient } = await import('app://corantool/app/js/engineclient.js');
      const { buildTableSnapshot, tableInputNames } = await import('app://corantool/app/js/tablesnapshot.js');
      const { interpAge, interpAgeRange } = await import('app://corantool/app/js/core.js');
      const I = window.ichantool, S = I.S;

      function seeded(seed) {
        let state = seed >>> 0;
        return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
      }

      function makeGeneratedCase(rows) {
        const next = seeded(856000 + rows);
        const knots = 200;
        const mDepth = new Array(knots), mAge = new Array(knots), mMin = new Array(knots), mMax = new Array(knots);
        let d = 0, a = 0;
        for (let i = 0; i < knots; i++) {
          mDepth[i] = d; mAge[i] = a;
          mMin[i] = a - (0.05 + next() * 0.4);
          mMax[i] = a + (0.05 + next() * 0.4);
          d += 0.25 + next() * 3.75;
          a += (i + 1) % 37 === 0 ? -(0.1 + next() * 1.5) : 0.05 + next() * 2.5;
        }
        const model = { depth: mDepth, age: mAge, min: mMin, max: mMax };
        const first = mDepth[0], last = mDepth[knots - 1], span = last - first;
        const depths = new Array(rows);
        const mid = Math.floor(rows / 2);
        const fixed = new Map([
          [0, first],
          [1, mDepth[Math.floor(knots / 2)]],
          [2, last],
          [3, first - 1],
          [4, first - 1e-6],
          [5, last + 1e-6],
          [6, last + 1],
          [7, null],
          [8, null],
          [9, null],
          [10, null],
          [11, null],
          [mid, (first + last) / 2],
        ]);
        for (let i = 0; i < rows; i++) {
          depths[i] = fixed.has(i) ? fixed.get(i) : first - 0.02 * span + next() * 1.04 * span;
        }
        return { name: `gen_${rows}`, description: `${rows} rows, 200-knot model with reversals and age_min/age_max`, depthUnit: 'm', ageUnit: 'ka', model, depths };
      }

      function runJs(model, depths) {
        const hasRange = !!model.min, n = depths.length;
        const age = new Array(n);
        const ageMin = hasRange ? new Array(n) : null;
        const ageMax = hasRange ? new Array(n) : null;
        const first = model.depth[0], last = model.depth[model.depth.length - 1];
        let outside = 0;
        for (let i = 0; i < n; i++) {
          const d = depths[i];
          if (d == null) {
            age[i] = null;
            if (hasRange) { ageMin[i] = null; ageMax[i] = null; }
            continue;
          }
          if (d < first || d > last) outside++;
          age[i] = interpAge(model, d);
          if (hasRange) {
            const r = interpAgeRange(model, d);
            ageMin[i] = r ? r.min : null;
            ageMax[i] = r ? r.max : null;
          }
        }
        return { age, ageMin, ageMax, summary: { rows: n, outside } };
      }

      function perturbMiddle(depths) {
        const out = depths.slice();
        let idx = Math.floor(out.length / 2);
        if (out[idx] == null) idx = out.findIndex((v) => v != null);
        if (idx >= 0) out[idx] += 0.001;
        return out;
      }

      function checkParity(res, expected, hasRange) {
        const cols = Object.fromEntries((res.tables?.ages ?? []).map((c) => [c.name, c.values]));
        const expectedCols = hasRange ? ['age', 'age_min', 'age_max'] : ['age'];
        const colNamesOk = expectedCols.every((k) => Array.isArray(cols[k]) && cols[k].length === expected.age.length)
          && (res.tables?.ages?.length === expectedCols.length);
        let mismatches = colNamesOk ? 0 : 1, missingMismatches = 0, maxAbsError = 0;
        if (colNamesOk) {
          const pairs = [['age', expected.age], ...(hasRange ? [['age_min', expected.ageMin], ['age_max', expected.ageMax]] : [])];
          for (const [colName, expArr] of pairs) {
            const actArr = cols[colName];
            for (let i = 0; i < expArr.length; i++) {
              const a = actArr[i], e = expArr[i];
              if ((a == null) !== (e == null)) { missingMismatches++; continue; }
              if (a != null) {
                const err = Math.abs(a - e);
                if (err > maxAbsError) maxAbsError = err;
                if (err > 1e-9) mismatches++;
              }
            }
          }
        }
        const summaryMatch = res.summary?.rows === expected.summary.rows && res.summary?.outside === expected.summary.outside;
        return { mismatches, missing_mismatches: missingMismatches, max_abs_error: maxAbsError, summary_match: summaryMatch,
          rows: res.summary?.rows ?? null, outside: res.summary?.outside ?? null };
      }

      const cases = [];
      const publicCores = S.cores.filter((c) => (c.ageModel?.model ?? S.age?.model) && Array.isArray(c.depth) && c.depth.length > 0);
      publicCores.forEach((c, idx) => {
        const model = c.ageModel?.model ?? S.age?.model;
        cases.push({
          name: publicCores.length === 1 ? 'public' : `public_${idx}`,
          description: `Public example core ${c.name}`,
          depthUnit: c.units || 'm',
          ageUnit: c.ageModel?.units ?? S.age?.units ?? 'ka',
          model,
          depths: [...c.depth],
        });
      });
      for (const rows of [1000, 10000, 100000]) cases.push(makeGeneratedCase(rows));

      const client = on ? createEngineClient(window.corantoolDesktop.engine) : null;
      const modelNames = tableInputNames('age_model'), queryNames = tableInputNames('query');

      // Warm up the JS interpolators and the core.ages/1 path on a throwaway 2-row core so measured `first` is still non-resident.
      {
        const warmModel = { depth: [0, 10], age: [0, 100] }, warmDepths = [1, 5, 11, null];
        runJs(warmModel, warmDepths);
        if (on) {
          const warmOwner = {};
          const mSnap = await buildTableSnapshot([{ name: 'depth', unit: 'm', values: warmModel.depth }, { name: 'age', unit: 'ka', values: warmModel.age }]);
          const qSnap = await buildTableSnapshot([{ name: 'depth', unit: 'm', values: warmDepths }]);
          const mTok = await client.ensureTable(warmOwner, 'age_model', mSnap);
          const qTok = await client.ensureTable(warmOwner, 'query', qSnap);
          await client.run('core.ages/1', { scope: 'core', target: crypto.randomUUID(), revision: 1, priority: 'interactive',
            inputs: { settings: { version: 1 }, [modelNames.meta]: mTok.meta, [modelNames.values]: mTok.values, [modelNames.valid]: mTok.valid,
              [queryNames.meta]: qTok.meta, [queryNames.values]: qTok.values, [queryNames.valid]: qTok.valid } });
          client.forget(warmOwner);
        }
      }

      const out = {};
      for (const c of cases) {
        const hasRange = !!c.model.min;
        const modelCols = [
          { name: 'depth', unit: c.depthUnit, values: c.model.depth },
          { name: 'age', unit: c.ageUnit, values: c.model.age },
          ...(hasRange ? [{ name: 'age_min', unit: c.ageUnit, values: c.model.min }, { name: 'age_max', unit: c.ageUnit, values: c.model.max }] : []),
        ];
        const perturbedDepths = perturbMiddle(c.depths);
        const caseMeta = { rows: c.depths.length, model_knots: c.model.depth.length, has_range: hasRange, description: c.description };

        if (!on) {
          const tFirst0 = performance.now(); const rFirst = runJs(c.model, c.depths); const firstMs = performance.now() - tFirst0;
          const tUnch0 = performance.now(); const rUnch = runJs(c.model, c.depths); const unchangedMs = performance.now() - tUnch0;
          const tChg0 = performance.now(); const rChg = runJs(c.model, perturbedDepths); const changedMs = performance.now() - tChg0;
          out[c.name] = {
            ...caseMeta,
            first: { total_ms: firstMs, rows: rFirst.summary.rows, outside: rFirst.summary.outside },
            unchanged: { total_ms: unchangedMs, rows: rUnch.summary.rows, outside: rUnch.summary.outside },
            one_changed: { total_ms: changedMs, rows: rChg.summary.rows, outside: rChg.summary.outside },
          };
        } else {
          const owner = {};
          const target = crypto.randomUUID();
          const expBase = runJs(c.model, c.depths);
          const expChanged = runJs(c.model, perturbedDepths);

          // Scenario 1: first (nothing resident yet)
          const t1Start = performance.now();
          const t1Snap0 = performance.now();
          const mSnap1 = await buildTableSnapshot(modelCols);
          const qSnap1 = await buildTableSnapshot([{ name: 'depth', unit: c.depthUnit, values: c.depths }]);
          const t1SnapMs = performance.now() - t1Snap0;
          const t1Ens0 = performance.now();
          const mTok1 = await client.ensureTable(owner, 'age_model', mSnap1);
          const qTok1 = await client.ensureTable(owner, 'query', qSnap1);
          const t1EnsMs = performance.now() - t1Ens0;
          const t1Run0 = performance.now();
          const res1 = await client.run('core.ages/1', { scope: 'core', target, revision: 1, priority: 'interactive',
            inputs: { settings: { version: 1 }, [modelNames.meta]: mTok1.meta, [modelNames.values]: mTok1.values, [modelNames.valid]: mTok1.valid,
              [queryNames.meta]: qTok1.meta, [queryNames.values]: qTok1.values, [queryNames.valid]: qTok1.valid } });
          const t1RunMs = performance.now() - t1Run0;
          const t1TotalMs = performance.now() - t1Start;

          // Scenario 2: unchanged (re-builds snapshots, hits resident table cache in ensureTable)
          const t2Start = performance.now();
          const t2Snap0 = performance.now();
          const mSnap2 = await buildTableSnapshot(modelCols);
          const qSnap2 = await buildTableSnapshot([{ name: 'depth', unit: c.depthUnit, values: c.depths }]);
          const t2SnapMs = performance.now() - t2Snap0;
          const t2Ens0 = performance.now();
          const mTok2 = await client.ensureTable(owner, 'age_model', mSnap2);
          const qTok2 = await client.ensureTable(owner, 'query', qSnap2);
          const t2EnsMs = performance.now() - t2Ens0;
          const t2Run0 = performance.now();
          const res2 = await client.run('core.ages/1', { scope: 'core', target, revision: 2, priority: 'interactive',
            inputs: { settings: { version: 1 }, [modelNames.meta]: mTok2.meta, [modelNames.values]: mTok2.values, [modelNames.valid]: mTok2.valid,
              [queryNames.meta]: qTok2.meta, [queryNames.values]: qTok2.values, [queryNames.valid]: qTok2.valid } });
          const t2RunMs = performance.now() - t2Run0;
          const t2TotalMs = performance.now() - t2Start;

          // Scenario 3: one_changed (age_model stays resident, query re-built and re-uploaded)
          const t3Start = performance.now();
          const t3Snap0 = performance.now();
          const qSnap3 = await buildTableSnapshot([{ name: 'depth', unit: c.depthUnit, values: perturbedDepths }]);
          const t3SnapMs = performance.now() - t3Snap0;
          const t3Ens0 = performance.now();
          const mTok3 = await client.ensureTable(owner, 'age_model', mSnap2);
          const qTok3 = await client.ensureTable(owner, 'query', qSnap3);
          const t3EnsMs = performance.now() - t3Ens0;
          const t3Run0 = performance.now();
          const res3 = await client.run('core.ages/1', { scope: 'core', target, revision: 3, priority: 'interactive',
            inputs: { settings: { version: 1 }, [modelNames.meta]: mTok3.meta, [modelNames.values]: mTok3.values, [modelNames.valid]: mTok3.valid,
              [queryNames.meta]: qTok3.meta, [queryNames.values]: qTok3.values, [queryNames.valid]: qTok3.valid } });
          const t3RunMs = performance.now() - t3Run0;
          const t3TotalMs = performance.now() - t3Start;

          client.forget(owner);

          out[c.name] = {
            ...caseMeta,
            first: { snapshot_ms: t1SnapMs, ensure_ms: t1EnsMs, run_ms: t1RunMs, total_ms: t1TotalMs,
              engine_queued_ms: res1.provenance?.queued_ms ?? null, engine_reported_ms: res1.provenance?.elapsed_ms ?? null,
              ...checkParity(res1, expBase, hasRange) },
            unchanged: { snapshot_ms: t2SnapMs, ensure_ms: t2EnsMs, run_ms: t2RunMs, total_ms: t2TotalMs,
              engine_queued_ms: res2.provenance?.queued_ms ?? null, engine_reported_ms: res2.provenance?.elapsed_ms ?? null,
              ...checkParity(res2, expBase, hasRange) },
            one_changed: { snapshot_ms: t3SnapMs, ensure_ms: t3EnsMs, run_ms: t3RunMs, total_ms: t3TotalMs,
              engine_queued_ms: res3.provenance?.queued_ms ?? null, engine_reported_ms: res3.provenance?.elapsed_ms ?? null,
              ...checkParity(res3, expChanged, hasRange) },
          };
        }
      }
      return out;
    }, mode === 'on');
  } finally { await session.stop(); }
}

if (want('ages')) {
  log('ages');
  const record = { warmup: { off: await agesRun('off'), on: await agesRun('on') }, pairs: [] };
  for (let pair = 0; pair < PAIRS; pair++) {
    const order = pair % 2 === 0 ? ['off', 'on'] : ['on', 'off'], entry = { order };
    for (const mode of order) entry[mode] = await agesRun(mode);
    record.pairs.push(entry);
  }
  report.results.ages = record;
}

// ---- verdicts (the gates of contract §7, evaluated on the recorded samples) -------------------------------------------------

const v = report.verdicts, R = report.results;
for (const fixture of fixtures) {
  const timing = R[`timing_${fixture}`];
  if (timing) v[`numerical_parity_${fixture}`] = { pass: timing.parity.mismatches === 0 && timing.parity.engine_states_ready, bins: timing.parity.total_bins, mismatches: timing.parity.mismatches };
}
if (R.responsiveness_memory) {
  const rm = R.responsiveness_memory;
  // Gate of card M8.4.4 (4): a stroke with the engine on is not worse than with it off, beyond measurement noise (the larger of 1.25 x and +16 ms) and within the 100 ms of the gate.
  v.stroke_responsiveness = { pass: rm.on.stroke.settled && rm.on.stroke.input_to_frame_p95_ms <= Math.min(100, Math.max(1.25 * rm.off.stroke.input_to_frame_p95_ms, rm.off.stroke.input_to_frame_p95_ms + 16)),
    p95_on_ms: rm.on.stroke.input_to_frame_p95_ms, p95_off_ms: rm.off.stroke.input_to_frame_p95_ms, events_on: rm.on.stroke.input_events, events_off: rm.off.stroke.input_events };
  v.responsiveness = { pass: rm.on.input_to_frame_p95_ms <= 100, input_to_frame_p95_ms_on: rm.on.input_to_frame_p95_ms, input_to_frame_p95_ms_off: rm.off.input_to_frame_p95_ms, gate_ms: 100 };
}
if (R.cancellation) {
  const cancel = R.cancellation.samples;
  v.cancellation = { pass: cancel.every((c) => c.outcome === 'completed' || (c.abort_to_ack_ms !== null && c.abort_to_ack_ms <= 250 && c.abort_to_terminal_ms <= 2000)),
    outcomes: cancel.map((c) => c.outcome), max_ack_ms: Math.max(...cancel.map((c) => c.abort_to_ack_ms ?? 0)), max_terminal_ms: Math.max(...cancel.map((c) => c.abort_to_terminal_ms)) };
}
if (R.cycles) {
  const cy = R.cycles;
  v.recovery_cycles = { pass: cy.cycles.every((c) => c.mismatches === 0) && cy.final_closed_state_mib <= cy.cycles[0].closed_state_mib + 64 && cy.cycles.at(-1).scratch_files <= cy.cycles[0].scratch_files,
    first_closed_mib: cy.cycles[0].closed_state_mib, final_closed_mib: cy.final_closed_state_mib, scratch_files_first_last: [cy.cycles[0].scratch_files, cy.cycles.at(-1).scratch_files] };
}
if (R.kill) {
  const kill = R.kill;
  v.kill_recovery = { pass: kill.worker.killed_pids.length > 0 && kill.worker.section_states.includes('INTERNAL') && kill.worker.status === 'ready' && kill.worker.next_analysis?.mismatches === 0
      && kill.coordinator.status === 'ready' && kill.coordinator.section_states.every((s) => s === 'ready'),
    workers_killed: kill.worker.killed_pids.length, worker_section_states: kill.worker.section_states, engine_after_worker_kill: kill.worker.status,
    coordinator_section_states: kill.coordinator.section_states, engine_after_coordinator_kill: kill.coordinator.status,
    note: 'After a coordinator death the first analysis starts a new engine session by itself (card M8.4.7), sends every input again and every section is analysed; the JavaScript calculation is never used.' };
}
// Matched timing is a gate of contract §7 (rules in tools/engine_gates.mjs). Scenario samples are pooled over the six pairs.
for (const fixture of fixtures) {
  const sc = R[`scenarios_${fixture}`];
  if (!sc) continue;
  const pool = (mode, pick) => sc.pairs.flatMap((p) => pick(p[mode]));
  const scenarios = {
    interval_change: (r) => r.interval_ms,
    edit_undo_redo: (r) => [r.edit_ms, r.undo_ms, r.redo_ms],
    unchanged: (r) => r.unchanged_ms,
  };
  const out = { n_pairs: sc.pairs.length, note: 'p95 of few samples is the maximum (nearest rank)' };
  for (const [name, pick] of Object.entries(scenarios)) out[name] = timingVerdict(pool('off', pick), pool('on', pick));
  const peak = (mode) => median(sc.pairs.map((p) => p[mode].memory.peak_mib));
  out.memory_peak = { ...memoryPeakVerdict(peak('off'), peak('on')), basis: 'median over the pairs of the peak of each run',
    max_off_mib: Math.max(...sc.pairs.map((p) => p.off.memory.peak_mib)), max_on_mib: Math.max(...sc.pairs.map((p) => p.on.memory.peak_mib)) };
  out.parity = { pass: sc.pairs.every((p) => p.on.mismatch_count === 0 && p.on.deleted && p.on.restored && p.on.deleted_again && p.on.states.every((s) => s === 'ready')),
    mismatches: sc.pairs.reduce((n, p) => n + p.on.mismatch_count, 0) };
  out.pass = [out.interval_change, out.edit_undo_redo, out.unchanged, out.memory_peak, out.parity].every((x) => x.pass);
  v[`scenarios_${fixture}`] = out;
}
for (const fixture of fixtures) {
  const px = R[`pixels_${fixture}`];
  if (!px) continue;
  const peak = (mode) => median(px.pairs.map((p) => p[mode].memory.peak_mib)), on = px.pairs.map((p) => p.on);
  v[`pixels_${fixture}`] = {
    memory_peak: { ...memoryPeakVerdict(peak('off'), peak('on')), basis: 'median over the pairs of the peak of each run, from the pixel upload to the end of the analyses',
      max_on_mib: Math.max(...on.map((r) => r.memory.peak_mib)), interactive_target_mib: 2048 },
    all_resident: on.every((r) => r.uploads.every((u) => u.ok) && r.after_analyses.residentPixelSections === r.sizes.length),
    budget_full_events: on.reduce((n, r) => n + r.after_analyses.budgetFull, 0),
    states_ready: px.pairs.every((p) => ['off', 'on'].every((mode) => p[mode].states.every((s) => s === 'ready' || s === null))),
    charge_model: px.charge_model, session_budget_mib: 512 };
}
if (R.ages) {
  const ag = R.ages;
  const caseNames = Object.keys(ag.pairs[0].on);
  const scenarios = ['first', 'unchanged', 'one_changed'];
  const y9LimitMs = 150;
  const cases = {};
  let allPass = true;
  for (const caseName of caseNames) {
    cases[caseName] = {};
    for (const scenario of scenarios) {
      const offSamples = ag.pairs.map((p) => p.off[caseName][scenario].total_ms);
      const onItems = ag.pairs.map((p) => p.on[caseName][scenario]);
      const onSamples = onItems.map((x) => x.total_ms);
      const p95On = percentile(onSamples, 0.95), medianOn = median(onSamples), maxOn = Math.max(...onSamples);
      const y9Pass = p95On <= y9LimitMs;
      const mismatches = onItems.reduce((n, x) => n + x.mismatches, 0);
      const missingMismatches = onItems.reduce((n, x) => n + x.missing_mismatches, 0);
      const summaryMismatches = onItems.filter((x) => !x.summary_match).length;
      const maxAbsError = Math.max(...onItems.map((x) => x.max_abs_error));
      const parityPass = mismatches === 0 && missingMismatches === 0 && summaryMismatches === 0;
      if (!y9Pass || !parityPass) allPass = false;
      cases[caseName][scenario] = {
        y9_target: { pass: y9Pass, p95_on_ms: round(p95On, 2), median_on_ms: round(medianOn, 2), max_on_ms: round(maxOn, 2), limit_ms: y9LimitMs,
          note: `nearest-rank p95 of ${onSamples.length} samples is the maximum` },
        matched_timing: timingVerdict(offSamples, onSamples),
        stages_median_ms: {
          snapshot_ms: round(median(onItems.map((x) => x.snapshot_ms)), 2),
          ensure_ms: round(median(onItems.map((x) => x.ensure_ms)), 2),
          run_ms: round(median(onItems.map((x) => x.run_ms)), 2),
          engine_queued_ms: round(median(onItems.map((x) => x.engine_queued_ms)), 2),
          engine_reported_ms: round(median(onItems.map((x) => x.engine_reported_ms)), 2),
          total_ms: round(medianOn, 2),
        },
        parity: { pass: parityPass, mismatches, max_abs_error: maxAbsError, missing_mismatches: missingMismatches, summary_mismatches: summaryMismatches },
      };
    }
  }
  v.ages = { pass: allPass, n_pairs: ag.pairs.length, cases };
}
v.not_measured = ['macOS and Linux', 'a clean Windows machine', 'cold cache after a reboot', 'saturated CPU', 'save interrupted during a job (covered separately by tests/e2e/interrupted-saves.mjs)'];

report.finished = new Date().toISOString();
let final = report;
if (only && OUT && fs.existsSync(OUT)) {   // a partial rerun replaces only the phases it ran and says so
  final = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  Object.assign(final.results, report.results); Object.assign(final.verdicts, report.verdicts);
  (final.reruns ||= []).push({ phases: only, commit: report.commit, finished: report.finished });
}
const text = JSON.stringify(final, null, 1);
if (OUT) { fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true }); fs.writeFileSync(OUT, text + '\n'); log('written', OUT); } else console.log(text);
