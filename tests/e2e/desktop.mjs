// V0.48: actual Electron, app://, worker, preload IPC and save-on-close across process restarts.
// Needs desktop/npm ci + prepare-web and puppeteer-core at the repository root.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { verifyInterruptedSaves } from './interrupted-saves.mjs';
import { startDesktopDiagnosticCheck, crashDesktopDiagnosticCheck, finishDesktopDiagnosticCheck } from './desktop-diagnostics.mjs';
const { default: puppeteer } = await import(process.env.PUPPETEER_MODULE || 'puppeteer-core');
const root = fileURLToPath(new URL('../../', import.meta.url));
const requireDesktop = createRequire(path.join(root, 'desktop/package.json'));
const executable = requireDesktop('electron');
const profile = mkdtempSync(path.join(tmpdir(), 'sedcoretool-desktop-test-'));
const errors = [];
const signature = () => window.ichantool.S.sections.map((s) => `${s.objects.size}:${s.labels.reduce((a, v) => a + !!v, 0)}`).join(',');

async function start() {
  const env = { ...process.env, SEDCORETOOL_TEST_PROFILE: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, [path.join(root, 'tests/e2e/desktop-bootstrap.cjs'), '--headless', '--no-sandbox', '--remote-debugging-port=0'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  const exited = new Promise((resolve) => child.once('exit', resolve));
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Electron startup timed out: ' + log.slice(-1500))), 60000);
    child.once('error', reject);
    child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Electron exited (${code}): ${log.slice(-1500)}`)); });
    child.stderr.on('data', (bytes) => {
      log += bytes;
      const hit = log.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (hit) { clearTimeout(timeout); resolve(hit[1]); }
    });
    child.stdout.on('data', (bytes) => { log += bytes; });
  }).catch((error) => { child.kill(); throw error; });
  const browser = await puppeteer.connect({ browserWSEndpoint: endpoint, defaultViewport: null });
  const target = await browser.waitForTarget((t) => t.url().startsWith('app://corantool/app/index.html'), { timeout: 60000 });
  const page = await target.page();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (dialog) => dialog.accept().catch((e) => {
    // Electron may finish its deferred save and close before CDP can accept beforeunload.
    if (dialog.type() !== 'beforeunload') errors.push(e.message);
  }));
  await page.waitForFunction(() => !!window.ichantool, { timeout: 60000 });
  return { child, exited, browser, page };
}

async function close(run) {
  // Close the real BrowserWindow. beforeunload must finish pending saves before the process exits.
  await run.page.close({ runBeforeUnload: true });
  let timer;
  try {
    const code = await Promise.race([run.exited, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Electron did not finish saving and close')), 30000); })]);
    assert.equal(code, 0, 'Electron exit code');
  } finally { clearTimeout(timer); run.browser.disconnect(); }
}

const BRIDGE_OPERATIONS = ['analyzeSection', 'appendBuffer', 'beginBuffer', 'cancel', 'commitBuffer', 'readBuffer', 'release', 'status'];   // plus the boolean `enabled`
const fixture = JSON.parse(readFileSync(new URL('../fixtures/section-intervals/basic-four-intervals.json', import.meta.url), 'utf8'));

/** Runs in the page: uploads a reference fixture through window.corantoolDesktop.engine, analyses it and reads one result column. */
async function bridgeRoundTrip(fixture) {
  const engine = window.corantoolDesktop.engine, outcome = { operations: Object.keys(engine).filter((key) => typeof engine[key] === 'function').sort(), enabled: engine.enabled };
  const sha = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const expand = (buffer) => (buffer.runs ? buffer.runs.flatMap(([value, count]) => Array(count).fill(value)) : buffer.data);
  const TYPES = { u8: Uint8Array, i32le: Int32Array, u32le: Uint32Array };
  const put = async (bytes, dtype, shape) => {
    const begun = await engine.beginBuffer({ dtype, shape, byte_length: bytes.length, sha256: await sha(bytes) });
    if (begun.error) { outcome.begin = begun; return null; }
    for (let offset = 0; offset < bytes.length; offset += 500) {
      const reply = await engine.appendBuffer(begun.token, offset, bytes.slice(offset, offset + 500));
      if (reply.error) throw new Error('append: ' + JSON.stringify(reply));
    }
    const done = await engine.commitBuffer(begun.token);
    if (done.error) throw new Error('commit: ' + JSON.stringify(done));
    return begun.token;
  };
  const raw = fixture.inputs, tokens = {};
  for (const name of ['labels', 'exclude', 'stack_offsets']) {
    tokens[name] = await put(new Uint8Array(TYPES[raw[name].dtype].from(expand(raw[name])).buffer), raw[name].dtype, raw[name].shape);
    if (tokens[name] === null) return outcome;
  }
  if (raw.stack_members) tokens.stack_members = await put(new Uint8Array(Uint32Array.from(expand(raw.stack_members)).buffer), 'u32le', raw.stack_members.shape);
  let settingsHash;
  for (const name of ['objects', 'classes', 'settings', 'age_model', 'manual_indices']) {
    const bytes = new TextEncoder().encode(JSON.stringify(raw[name]));
    tokens[name] = await put(bytes, 'utf8json', [bytes.length]);
    if (name === 'settings') settingsHash = await sha(bytes);
  }
  const result = await engine.analyzeSection({ requestKey: crypto.randomUUID(), method: 'section.intervals/1', project: crypto.randomUUID(), section: crypto.randomUUID(),
    revision: 1, settings_hash: settingsHash, inputs: tokens });
  if (result.error) throw new Error('analyze: ' + JSON.stringify(result));
  outcome.dimensions = result.dimensions;
  const column = result.outputs.row_start, read = await engine.readBuffer(column.token, 0, column.byte_length);
  outcome.rowStart = Array.from(new Uint32Array(read.bytes.buffer, read.bytes.byteOffset, column.byte_length / 4));
  await engine.release([column.token, ...Object.values(tokens)]);
  outcome.afterRelease = await engine.readBuffer(column.token, 0, 1);
  outcome.forged = await engine.readBuffer(crypto.randomUUID(), 0, 1);
  return outcome;
}

/** Runs in the page: brings every section up to date and compares its bins with the JavaScript reference (exact for counts, indices and nulls, 1e-9 for floats). */
async function compareWithReference() {
  const I = window.ichantool;
  await I.analyzeSections(I.S.sections);
  const outcome = { sections: I.S.sections.length, states: I.S.sections.map((s) => s.analysis?.state ?? null), bins: 0, mismatches: [] };
  I.S.sections.forEach((s, i) => {
    const reference = I.referenceBins(s);
    if (reference.length !== s.bins.length) { outcome.mismatches.push(`section ${i}: ${s.bins.length} bins, expected ${reference.length}`); return; }
    reference.forEach((expected, j) => {
      outcome.bins++;
      const actual = s.bins[j], keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
      for (const key of keys) {
        const a = actual[key], e = expected[key], close = (x, y) => (typeof x === 'number' && typeof y === 'number' ? Math.abs(x - y) <= 1e-9 : x === y);
        const same = Array.isArray(e) ? Array.isArray(a) && a.length === e.length && e.every((value, k) => close(a[k], value)) : close(a, e);
        if (!same) outcome.mismatches.push(`section ${i} bin ${j} ${key}: ${JSON.stringify(a)} vs ${JSON.stringify(e)}`);
      }
    });
  });
  return outcome;
}

let run;
try {
  run = await start();
  const p = run.page;
  if (process.env.SEDCORETOOL_ENGINE_EXPERIMENT === '1') {
    await p.waitForFunction(async () => ['ready', 'unavailable'].includes((await window.corantoolDesktop.engine.status()).state))
      .catch(async () => { throw new Error('Engine startup did not settle: ' + JSON.stringify(await p.evaluate(() => window.corantoolDesktop.engine.status()))); });
    const engine = await p.evaluate(() => window.corantoolDesktop.engine.status());
    assert.equal(engine.state, 'ready', 'experimental engine must start from the selected runtime');
    assert.equal(engine.protocol, 1);
    assert.deepEqual(engine.methods, ['buffer.digest/1', 'section.intervals/1'], 'the engine advertises its diagnostic and the first scientific method; the interface does not call it yet');
    assert.equal(engine.runtime, process.env.SEDCORETOOL_ENGINE_PYTHON ? 'unverified-development' : 'bundled-verified');
    const outcome = await p.evaluate(bridgeRoundTrip, fixture);
    assert.deepEqual(outcome.operations, BRIDGE_OPERATIONS, 'the page sees exactly the documented engine bridge');
    assert.deepEqual(outcome.dimensions, fixture.expected.dimensions, 'a real analysis ran through the preload bridge');
    assert.deepEqual(outcome.rowStart, fixture.expected.columns.row_start.data);
    assert.deepEqual(outcome.afterRelease, { error: { code: 'INVALID_BUFFER', field: 'token' } }, 'released tokens are gone');
    assert.deepEqual(outcome.forged, { error: { code: 'INVALID_BUFFER', field: 'token' } }, 'a guessed token is refused');
  } else {
    assert.equal((await p.evaluate(() => window.corantoolDesktop.engine.status())).state, 'disabled');
    const outcome = await p.evaluate(bridgeRoundTrip, fixture);
    assert.deepEqual(outcome.operations, BRIDGE_OPERATIONS);
    assert.deepEqual(outcome.begin, { error: { code: 'ENGINE_UNAVAILABLE' } }, 'with the experiment off the bridge reports the engine as unavailable');
  }
  const desktop = await p.evaluate(async () => ({
    origin: location.origin,
    trainer: await window.corantoolDesktop.trainer.status(),
    ort: (await fetch('vendor/ort/ort.wasm.min.js')).ok,
    csp: !!document.querySelector('meta[http-equiv="Content-Security-Policy"]'),
    rejected: await Promise.all([
      'app://corantool/..%2fweb-sibling/secret.txt',
      'app://corantool/..%5cweb-sibling%5csecret.txt',
      'app://corantool/..%2fmain.js',
      'app://corantool/C:%5cWindows%5cwin.ini',
      'app://corantool/%E0%A4%A',
    ].map(async (u) => (await fetch(u)).status)),
  }));
  assert.equal(desktop.origin, 'app://corantool');
  assert.ok(!desktop.trainer.busy, 'trainer is idle');
  assert.ok(desktop.ort, 'bundled ONNX runtime');
  assert.ok(desktop.csp, 'CSP present');
  assert.deepEqual(desktop.rejected, [403, 403, 403, 403, 403], 'desktop protocol rejects outside and malformed paths');
  let backupWindow = 0;
  const backupBrowser = { newPage: async () => {
    const url = `app://corantool/app/index.html?backup-test=${++backupWindow}`;
    await p.evaluate((url) => { window.open(url, '_blank'); }, url);
    const target = await run.browser.waitForTarget((target) => target.url() === url);
    const page = await target.page();
    await page.waitForFunction(() => document.readyState === 'complete' && window.ichantool);
    await page.evaluate(() => window.ichantool.ready);
    return page;
  } };
  // These native windows already navigated; a second navigation invokes Electron's close-on-unload guard.
  await verifyInterruptedSaves(backupBrowser, 'app://corantool/app/index.html', { navigate: false });
  await startDesktopDiagnosticCheck(p, profile);
  // Optional real-model/network checks use a local pinned ONNX file and a fixed public map extent.
  // CI remains independent of external services and a large model download.
  if (process.env.SEDCORETOOL_VISION_MODEL) {
    await p.addScriptTag({ url: 'app://corantool/app/vendor/ort/ort.wasm.min.js' });
    await p.evaluate(() => { const input = document.createElement('input'); input.type = 'file'; input.id = 'smokeModel'; document.body.append(input); });
    await (await p.$('#smokeModel')).uploadFile(process.env.SEDCORETOOL_VISION_MODEL);
    const vision = await p.evaluate(async () => {
      const m = await import('app://corantool/app/js/vision.js');
      const bytes = await document.getElementById('smokeModel').files[0].arrayBuffer();
      const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (v) => v.toString(16).padStart(2, '0')).join('');
      if (sha !== m.VISION_MODEL.sha256) throw new Error('DINOv2 SHA-256 mismatch');
      window.ort.env.wasm.wasmPaths = 'app://corantool/app/vendor/ort/'; window.ort.env.wasm.numThreads = 1;
      const session = await window.ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
      const rgba = new Uint8ClampedArray(32 * 32 * 4);
      for (let i = 0; i < rgba.length; i++) rgba[i] = i % 4 === 3 ? 255 : (i * 17) % 256;
      const input = m.traceInput(rgba, 32, 32, m.traceWindow([3, 4, 25, 27]));
      const output = await session.run({ [session.inputNames[0]]: new window.ort.Tensor('float32', input, [1, 3, 224, 224]) });
      const embedding = m.pickEmbedding(output, session.outputNames);
      await session.release();
      return { sha, dim: embedding.length, finite: embedding.every(Number.isFinite), norm: Math.hypot(...embedding) };
    });
    assert.equal(vision.dim, 384); assert.ok(vision.finite); assert.ok(Math.abs(vision.norm - 1) < 0.001);
    console.log('DINOv2 real-model smoke ok:', JSON.stringify(vision));
  }
  if (process.env.SEDCORETOOL_NETWORK_SMOKE === '1') {
    const maps = await p.evaluate(async () => {
      const services = ['World_Imagery', 'World_Topo_Map', 'World_Shaded_Relief', 'World_Physical_Map', 'World_Street_Map', 'Ocean/World_Ocean_Base'];
      return Promise.all(services.map(async (service) => {
        const url = `https://server.arcgisonline.com/ArcGIS/rest/services/${service}/MapServer/export?bbox=0,35,5,40&bboxSR=4326&imageSR=4326&size=256,256&format=jpg&f=image`;
        const response = await fetch(url); if (!response.ok) throw new Error(service + ': HTTP ' + response.status);
        const image = await createImageBitmap(await response.blob());
        return { service, width: image.width, height: image.height };
      }));
    });
    for (const map of maps) { assert.equal(map.width, 256); assert.equal(map.height, 256); }
    console.log('Esri network smoke ok:', JSON.stringify(maps));
  }
  await p.evaluate(() => document.getElementById('openTest').click());
  await p.waitForFunction(() => window.ichantool.S.sections.length === 6 && window.ichantool.S.sections.every((s) => s.objects.size > 0), { timeout: 90000 });
  await p.waitForFunction(() => document.getElementById('saveState').dataset.state === 'saved', { timeout: 30000 });
  const before = await p.evaluate(signature);
  const engineOn = process.env.SEDCORETOOL_ENGINE_EXPERIMENT === '1';
  const parity = await p.evaluate(compareWithReference);
  assert.deepEqual(parity.mismatches, [], 'the interface shows the JavaScript reference');
  assert.ok(parity.bins > 100, `enough intervals compared (${parity.bins})`);
  assert.deepEqual(parity.states, Array(6).fill(engineOn ? 'ready' : null), engineOn ? 'every section was analysed by the engine' : 'without the experiment the JavaScript calculation runs');
  // An edit immediately followed by close exercises the desktop's deferred beforeunload save.
  const deleted = await p.evaluate(() => {
    const I = window.ichantool, s = I.S.sections[I.S.cur], id = s.objects.keys().next().value;
    I.S.selected = id;
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    return !s.objects.has(id);
  });
  assert.ok(deleted, 'trace deleted before closing');
  const edited = await p.evaluate(signature);
  assert.notEqual(edited, before);
  const afterEdit = await p.evaluate(compareWithReference);
  assert.deepEqual(afterEdit.mismatches, [], 'after a deletion the new result matches the reference too');
  // Undo and redo go through the same analysis path (M8.3.7 left them unchecked): every result must match the reference again.
  await p.evaluate(() => document.getElementById('undoBtn').click());
  assert.equal(await p.evaluate(signature), before, 'undo restores the trace');
  const afterUndo = await p.evaluate(compareWithReference);
  assert.deepEqual(afterUndo.mismatches, [], 'after undo the result matches the reference');
  assert.ok(afterUndo.bins > 100, 'undo leaves the intervals in place');
  await p.evaluate(() => document.getElementById('redoBtn').click());
  assert.equal(await p.evaluate(signature), edited, 'redo removes the trace again');
  const afterRedo = await p.evaluate(compareWithReference);
  assert.deepEqual(afterRedo.mismatches, [], 'after redo the result matches the reference');
  // The tabs that read the intervals must show them without a page error (checked only by eye in M8.3.7).
  const tabs = await p.evaluate(async () => {
    const seen = {};
    for (const id of ['modeData', 'modeFig', 'modeGeo', 'modeLog', 'modeSection']) {
      document.getElementById(id).click();
      await new Promise((resolve) => setTimeout(resolve, 400));
      seen[id] = { pressed: document.getElementById(id).getAttribute('aria-pressed'), rows: document.querySelectorAll('#dataTable tr, #figArea svg, #geoArea svg').length };
    }
    return seen;
  });
  for (const [id, state] of Object.entries(tabs)) assert.equal(state.pressed, 'true', `${id} opens`);
  assert.deepEqual(errors, [], 'no page error while the tabs show engine results');
  await close(run); run = null;
  run = await start();
  await run.page.waitForFunction(() => window.ichantool.S.sections.length === 6, { timeout: 60000 });
  assert.equal(await run.page.evaluate(signature), edited, 'pending edit survived a full process restart');
  await crashDesktopDiagnosticCheck(run.page, profile);
  run.browser.disconnect(); run.child.kill(); await run.exited; run = null;
  run = await start();
  await run.page.waitForFunction(() => window.ichantool.S.sections.length === 6, { timeout: 60000 });
  assert.equal(await run.page.evaluate(signature), edited, 'saved edit survived the renderer failure');
  await finishDesktopDiagnosticCheck(run.page, profile);
  assert.deepEqual(errors, [], 'renderer errors');
  await close(run); run = null;
  console.log('Desktop E2E ok: app://, CSP, bundled ORT, trainer IPC, detection and pending save across restart');
} finally {
  if (run) { run.browser.disconnect(); run.child.kill(); }
  // Profiles contain only public example data and remain in the temporary directory for diagnosis.
}
