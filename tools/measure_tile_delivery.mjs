// Card M8.4.15, step 1: how tiles should reach the page. Windows measurement with the real desktop program.
//
//   node tools/measure_tile_delivery.mjs C:/sedcore-large-fixtures/rgb8g.tif --out docs/validation/M8.4.15-delivery-windows.json
//
// The program runs with the engine experiment and SEDCORETOOL_TILED_SECTIONS=1, once with SEDCORETOOL_TILE_DELIVERY=engine (a: tile.read through
// the main process and the engine) and once with =direct (b: the main process reads and verifies the store itself), on one test profile, so the
// second run reuses the pyramid built by the first. From the page: 40 reads of one level-0 tile and 10 reads of 16 tiles, at random positions
// (the tile caches start empty in each run; the disk cache is warm). Rule of the card, stated before measuring: (a) if 16 tiles arrive with
// p95 <= 150 ms and one tile with p95 <= 40 ms; otherwise (b). Both runs must deliver the same bytes for the same positions.
// Needs `npm i --no-save puppeteer-core@23` and `node desktop/scripts/prepare.js --with-examples`.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { default: puppeteer } = await import(process.env.PUPPETEER_MODULE || 'puppeteer-core');
const root = fileURLToPath(new URL('../', import.meta.url));
const electron = createRequire(path.join(root, 'desktop/package.json'))('electron');
const args = process.argv.slice(2), file = args[0];
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const OUT = option('out', null);
assert.ok(file && fs.existsSync(file), 'give a large TIFF of tools/make_large_fixtures.py');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const percentile = (values, p) => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : null; };
const round = (v) => Math.round(v * 100) / 100;

async function run(profile, delivery) {
  const env = { ...process.env, SEDCORETOOL_TEST_PROFILE: profile, SEDCORETOOL_ENGINE_EXPERIMENT: '1', SEDCORETOOL_TILED_SECTIONS: '1', SEDCORETOOL_TILE_DELIVERY: delivery };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [path.join(root, 'tests/e2e/desktop-bootstrap.cjs'), '--headless', '--no-sandbox', '--remote-debugging-port=0'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  let log = '';
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Electron startup timed out')), 60000);
    child.stderr.on('data', (bytes) => { log += bytes; const hit = log.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (hit) { clearTimeout(timer); resolve(hit[1]); } });
  });
  const browser = await puppeteer.connect({ browserWSEndpoint: endpoint, defaultViewport: null, protocolTimeout: 900000 });
  try {
    const target = await browser.waitForTarget((t) => t.url().startsWith('app://corantool/app/index.html'), { timeout: 60000 });
    const page = await target.page();
    page.setDefaultTimeout(900000);
    await page.waitForFunction(() => !!window.ichantool, { timeout: 60000 });
    await page.waitForFunction(async () => (await window.corantoolDesktop.engine.status()).state === 'ready', { timeout: 90000 });
    assert.equal(await page.evaluate(() => window.corantoolDesktop.tiles.enabled), true);
    await page.evaluate(() => { const input = document.createElement('input'); input.type = 'file'; input.id = 'measureTiles'; document.body.append(input); });
    await (await page.$('#measureTiles')).uploadFile(file);
    const started = Date.now();
    const built = await page.evaluate(async () => {
      const tiles = window.corantoolDesktop.tiles, chosen = document.getElementById('measureTiles').files[0];
      const registered = await tiles.register(chosen);
      if (registered.error) return registered;
      let events = 0; const stop = tiles.onProgress(() => { events++; });
      const result = await tiles.build(registered.ok.token, crypto.randomUUID());
      stop();
      return { ...result, events, name: registered.ok.name };
    });
    assert.ok(built.ok, JSON.stringify(built));
    const buildSeconds = (Date.now() - started) / 1000;
    const timings = await page.evaluate(async (pyramid) => {
      const tiles = window.corantoolDesktop.tiles, answer = await tiles.info(pyramid);
      if (!answer.ok) throw new Error('info: ' + JSON.stringify(answer));
      const info = answer.ok, level = info.levels[0];
      let seed = 138501; const random = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
      const single = [], batch = [], digests = [];
      const digest = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
      for (const position of [[0, 0], [5, 3], [level.rows - 1, level.cols - 1]]) {           // the same positions in both runs
        const read = await tiles.read(pyramid, 0, [position]);
        digests.push(await digest(read.ok.bytes));
      }
      for (let i = 0; i < 40; i++) {
        const t0 = performance.now(); const read = await tiles.read(pyramid, 0, [[random(level.rows), random(level.cols)]]);
        single.push(performance.now() - t0);
        if (!read.ok || read.ok.bytes.byteLength !== 512 * 512 * info.channels) throw new Error('bad tile');
      }
      for (let i = 0; i < 10; i++) {
        const row = random(level.rows - 1), positions = Array.from({ length: 16 }, (_, k) => [row + Math.floor(k / level.cols), k % level.cols]);
        const t0 = performance.now(); const read = await tiles.read(pyramid, 0, positions);
        batch.push(performance.now() - t0);
        if (!read.ok || read.ok.bytes.byteLength !== 16 * 512 * 512 * info.channels) throw new Error('bad batch');
      }
      return { single, batch, digests, levels: info.levels.length, width: info.width, height: info.height };
    }, built.ok.pyramid);
    return { delivery, build_seconds: round(buildSeconds), reused: built.ok.reused, progress_events: built.events, ...timings,
      single_ms: { p50: round(percentile(timings.single, 0.5)), p95: round(percentile(timings.single, 0.95)), max: round(Math.max(...timings.single)) },
      batch16_ms: { p50: round(percentile(timings.batch, 0.5)), p95: round(percentile(timings.batch, 0.95)), max: round(Math.max(...timings.batch)) } };
  } finally {
    try { browser.disconnect(); } catch { /* ignore */ }
    if (child.exitCode === null) child.kill();
    await Promise.race([exited, sleep(15000)]);
  }
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sedcoretool-delivery-'));
try {
  const engine = await run(profile, 'engine');
  console.error('engine', JSON.stringify({ single: engine.single_ms, batch: engine.batch16_ms, build: engine.build_seconds }));
  const direct = await run(profile, 'direct');
  console.error('direct', JSON.stringify({ single: direct.single_ms, batch: direct.batch16_ms, reused: direct.reused }));
  assert.deepEqual(direct.digests, engine.digests, 'both paths deliver the same bytes');
  const passes = (r) => r.batch16_ms.p95 <= 150 && r.single_ms.p95 <= 40;
  const report = { tool: 'tools/measure_tile_delivery.mjs', card: 'M8.4.15', file: path.basename(file),
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), generated: new Date().toISOString(),
    environment: { os: `${os.type()} ${os.release()}`, cpu: os.cpus()[0].model.trim(), logical_cpus: os.cpus().length, memory_gib: Math.round(os.totalmem() / 2 ** 30) },
    rule: '(a) engine if 16 tiles p95 <= 150 ms and one tile p95 <= 40 ms; otherwise (b) direct', engine_passes: passes(engine), direct_passes: passes(direct),
    chosen: passes(engine) ? 'engine' : 'direct', runs: [engine, direct].map(({ single, batch, ...rest }) => ({ ...rest, single_samples_ms: single.map(round), batch_samples_ms: batch.map(round) })) };
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
  console.log(JSON.stringify({ chosen: report.chosen, engine: { single: engine.single_ms, batch: engine.batch16_ms }, direct: { single: direct.single_ms, batch: direct.batch16_ms } }));
} finally { fs.rmSync(profile, { recursive: true, force: true }); }
