// Card M8.4.18d: a package above 4 GiB through the desktop program, with a synthetic tiled section whose stored version takes more than 4 GiB
// (`tools/make_large_mask_version.py`). Windows, real program from source with the engine experiment and tiled sections on.
//
//   node tools/check_large_package.mjs [--profile C:/sedcore-pyramids/package-check] [--cols 64] [--rows 112] [--out docs/validation/M8.4.18d-large-package-windows.json]
//
// 1. A fresh profile; the test project gives the fields of a section; a project record with one tiled section of COLS x ROWS tiles of 512 is made
//    in the page, and its version is written into the project's store by the generator (65,535 objects drawn at random in every pixel).
// 2. The page packages that record (`packageProjects`, as «Export this project»): a Chromium Blob above 4 GiB with ZIP64 records.
// 3. The store folder is moved aside and the engine restarted (nothing of the version is left on this computer's store), then the package is
//    imported (`restoreFiles`, as «Import file…»): the version is read from the package and verified by the engine.
// 4. The store's manifest and blob files are compared, by name and bytes, with those moved aside; the project is opened (its section reads every
//    tile back, verified; the source image does not exist, so it is grey).
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { requireFresh } from '../tests/e2e/preflight.mjs';

const { default: puppeteer } = await import(process.env.PUPPETEER_MODULE || 'puppeteer-core');
const root = fileURLToPath(new URL('../', import.meta.url));
requireFresh(root);
const electron = createRequire(path.join(root, 'desktop/package.json'))('electron');
const args = process.argv.slice(2), option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const PROFILE = option('profile', 'C:/sedcore-pyramids/package-check'), COLS = Number(option('cols', 64)), ROWS = Number(option('rows', 112)), OUT = option('out', null);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const seconds = (t0) => Math.round((performance.now() - t0) / 100) / 10;

fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
const env = { ...process.env, SEDCORETOOL_TEST_PROFILE: PROFILE, SEDCORETOOL_ENGINE_EXPERIMENT: '1', SEDCORETOOL_TILED_SECTIONS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [path.join(root, 'tests/e2e/desktop-bootstrap.cjs'), '--headless', '--no-sandbox', '--remote-debugging-port=0'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
const endpoint = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Electron startup timed out: ' + log.slice(-500))), 60000);
  child.stderr.on('data', (bytes) => { log += bytes; const hit = log.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (hit) { clearTimeout(timer); resolve(hit[1]); } });
});
const browser = await puppeteer.connect({ browserWSEndpoint: endpoint, defaultViewport: null, protocolTimeout: 3600000 });
const record = { started: new Date().toISOString(), host: { os: `${os.type()} ${os.release()}`, cpu: os.cpus()[0]?.model, cpus: os.cpus().length, memory_gib: Math.round(os.totalmem() / 2 ** 30) },
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), electron_node: execFileSync(electron, ['--version'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' }).trim(),   // the Node inside Electron
  grid: { cols: COLS, rows: ROWS } };
try {
  const page = await (await browser.waitForTarget((t) => t.url().startsWith('app://corantool/app/index.html'), { timeout: 60000 })).page();
  page.setDefaultTimeout(3600000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept().catch(() => {}));
  await page.waitForFunction(() => !!window.ichantool, { timeout: 60000 });
  await page.waitForFunction(async () => (await window.corantoolDesktop.engine.status()).state === 'ready', { timeout: 90000 });
  // 1. The record (fields of a section from the test project) and its store.
  await page.evaluate(() => document.getElementById('openTest').click());
  await page.waitForFunction(() => window.ichantool.S.sections.length === 6 && !window.ichantool.saveBlockers().loading && document.getElementById('busy').hidden, { polling: 200, timeout: 600000 });
  const id = 'large-package-check', store = await page.evaluate((id) => window.ichantool.storeProject(id), id);
  const tiles = path.join(PROFILE, 'projects', store, 'tiles');
  let t0 = performance.now();
  const made = JSON.parse(execFileSync(process.platform === 'win32' ? 'py' : 'python3', [...(process.platform === 'win32' ? ['-3.12'] : []), path.join(root, 'tools/make_large_mask_version.py'), tiles,
    '--cols', String(COLS), '--rows', String(ROWS), '--objects', '65535'], { encoding: 'utf8', maxBuffer: 1 << 20, stdio: ['ignore', 'pipe', 'inherit'] }).trim().split('\n').at(-1));
  record.version = { ...made, generated_s: seconds(t0) };
  console.log('version written:', JSON.stringify(record.version));
  // 2. The package of that record, made by the page.
  t0 = performance.now();
  const packaged = await page.evaluate(async ({ id, made }) => {
    const template = window.ichantool.serialize(), q0 = template.cores[0].sections[0], ds = 8, w = made.width / ds, h = made.height / ds;
    const section = { ...q0, id: 'synthetic', name: 'Synthetic > 4 GiB', ds, rot: 0, w, h, crop: null, full: { w: made.width, h: made.height }, file: { name: 'synthetic.tif', type: 'image/tiff', tiled: true },
      roi: { x0: 0, y0: 0, x1: w, y1: h }, nextId: made.objects + 1, objects: Array.from({ length: made.objects }, (_, k) => ({ id: k + 1, cls: 'undet', src: 'manual' })), stacks: [null], marks: [],
      tiled: { version: 1, store: 2, manifest: made.manifest, width: made.width, height: made.height, level: 3, source: { sha256: 'e'.repeat(64), size: 1, name: 'synthetic.tif' } } };
    delete section.labels; delete section.exclude;
    const project = { ...template, id, name: 'Package above 4 GiB', version: 6, cores: [{ ...template.cores[0], sections: [section] }] };
    window.__largeProject = project;
    const blob = await window.ichantool.packageBlob(project);
    window.__largePackage = blob;
    const tail = new DataView(await blob.slice(blob.size - 22).arrayBuffer());
    return { bytes: blob.size, zip64: tail.getUint32(16, true) === 0xffffffff && tail.getUint16(10, true) === 0xffff };
  }, { id, made });
  record.package = { ...packaged, seconds: seconds(t0) };
  console.log('packaged:', JSON.stringify(record.package));
  if (COLS * ROWS >= 6200) assert.ok(packaged.bytes > 2 ** 32 && packaged.zip64, 'a package above 4 GiB with ZIP64 end records');   // a smaller grid only tries the path
  // 3. Nothing of the version left in the store; the package imported.
  const aside = path.join(PROFILE, 'moved-aside');
  fs.renameSync(path.join(PROFILE, 'projects', store), aside);
  await page.evaluate(() => window.corantoolDesktop.engine.restart());
  await page.waitForFunction(async () => (await window.corantoolDesktop.engine.status()).state === 'ready', { timeout: 90000 });
  t0 = performance.now();
  const restored = await page.evaluate(async () => {
    await window.ichantool.restoreFiles([new File([window.__largePackage], 'large.sedcoretool')]);
    const s = window.ichantool.S.sections.find((q) => q.id === 'synthetic');
    return { project: window.ichantool.S.id, found: !!s, frozen: s ? s.frozen ?? null : 'absent', stored: s?.maskTiles?.stored.size ?? 0, toast: document.getElementById('toast')?.textContent ?? '' };
  });
  record.restore = { ...restored, seconds_with_opening: seconds(t0) };
  console.log('restored and opened:', JSON.stringify(record.restore));
  // 4. The same files, byte for byte.
  const listing = (folder) => {
    const out = new Map();
    for (const name of fs.readdirSync(path.join(folder, 'manifests'))) out.set('manifests/' + name, path.join(folder, 'manifests', name));
    for (const sub of fs.readdirSync(path.join(folder, 'blobs'))) for (const name of fs.readdirSync(path.join(folder, 'blobs', sub))) out.set(name, path.join(folder, 'blobs', sub, name));
    return out;
  };
  const before = listing(path.join(aside, 'tiles')), after = listing(path.join(PROFILE, 'projects', store, 'tiles'));
  assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(), 'the same files in the store');
  const manifestName = `manifests/${made.manifest}.json`;
  assert.ok(fs.readFileSync(after.get(manifestName)).equals(fs.readFileSync(before.get(manifestName))), 'the manifest, byte for byte');
  const inflate = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  let checked = 0;
  for (const [name, file] of after) if (!name.startsWith('manifests/') && checked++ < 64) assert.equal(createHash('sha256').update((await import('node:zlib')).inflateSync(fs.readFileSync(file))).digest('hex'), name, 'a restored blob decompresses to its name');
  record.compared = { files: after.size, blobs_decompressed_and_hashed: Math.min(checked, 64), manifest_identical: true };
  void inflate;
  assert.deepEqual([restored.found, restored.frozen, restored.stored], [true, 'source', made.tiles], 'the section opens with every tile (grey: no source image)');
  assert.deepEqual(errors, []);
  record.result = 'passed';
  console.log(`Package above 4 GiB: ${packaged.bytes} bytes (ZIP64), version of ${made.tiles} tiles restored into an empty store identical (${after.size} files), the section opened with every tile`);
} catch (error) {
  record.result = 'failed'; record.error = String(error?.stack || error).slice(0, 2000);
  throw error;
} finally {
  record.finished = new Date().toISOString();
  if (OUT) fs.writeFileSync(path.join(root, OUT), JSON.stringify(record, null, 2) + '\n');
  try { browser.disconnect(); } catch { /* ignore */ }
  if (child.exitCode === null) child.kill();
  await sleep(3000);
}
