// Card M8.4.15: tiled sections in the desktop program (SEDCORETOOL_TILED_SECTIONS=1 with the engine experiment).
//
//   node tests/e2e/tiled-sections.mjs [IMAGE]
//
// IMAGE defaults to the public example examples/data/idealized_core_0-500cm.jpg (620 x 16,726 = 10.4 MP, above the default maximum of 8 MP), so the
// test needs no generated fixture. Checks: the image is added through the interface as a tiled section (pyramid built with progress, a working
// image from one pyramid level within the size limit), the section is not saved yet and the project's other sections are, the working image is
// read again from the pyramid after it was released, and tools that would decode the source refuse visibly. With the flag off, the same image
// takes today's path.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { requireFresh } from './preflight.mjs';

const { default: puppeteer } = await import(process.env.PUPPETEER_MODULE || 'puppeteer-core');
const root = fileURLToPath(new URL('../../', import.meta.url));
requireFresh(root);                                   // card M8.4.23: an old program copy or engine runtime stops the test here
const electron = createRequire(path.join(root, 'desktop/package.json'))('electron');
const image = process.argv[2] || path.join(root, 'examples/data/idealized_core_0-500cm.jpg');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Card M8.4.32: the process id of this program's engine coordinator (its command line names server.py and the projects folder), found among the
 * descendants of the program's process (at most six levels down): PowerShell on Windows, `ps` on macOS and Linux. 0 when there is none.
 * @param {number} rootPid
 */
function findCoordinator(rootPid) {
  if (process.platform === 'win32') {
    return Number(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*server.py*' -and $_.CommandLine -like '*projects-dir*' } | Where-Object { $p = $_; $chain = $p.ParentProcessId; $hit = $false; for ($k = 0; $k -lt 6 -and $chain; $k++) { if ($chain -eq ${rootPid}) { $hit = $true; break }; $chain = (Get-CimInstance Win32_Process -Filter "ProcessId=$chain").ParentProcessId }; $hit } | Select-Object -First 1).ProcessId`],
      { encoding: 'utf8', windowsHide: true }).trim()) || 0;
  }
  const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,args='], { encoding: 'utf8' }).split('\n').map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)).filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), args: m[3] }));
  const parent = new Map(rows.map((r) => [r.pid, r.ppid]));
  for (const r of rows) {
    if (!r.args.includes('server.py') || !r.args.includes('projects-dir')) continue;
    for (let chain = r.ppid, k = 0; chain && k < 6; chain = parent.get(chain), k++) if (chain === rootPid) return r.pid;
  }
  return 0;
}

/** Where a failing step saves its screenshot: SEDCORETOOL_SHOT_DIR on GitHub (uploaded as an artifact, card M8.4.32), else the temporary folder. */
function shotDir() { const dir = process.env.SEDCORETOOL_SHOT_DIR || os.tmpdir(); fs.mkdirSync(dir, { recursive: true }); return dir; }
/** The file of a screenshot named `name` in that folder (a function, because the editing steps below have their own `path`). */
const shotFile = (name) => path.join(shotDir(), name);

async function program(tiled) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sedcoretool-tiled-'));
  const env = { ...process.env, SEDCORETOOL_TEST_PROFILE: profile, SEDCORETOOL_ENGINE_EXPERIMENT: '1' };
  if (tiled) env.SEDCORETOOL_TILED_SECTIONS = '1'; else delete env.SEDCORETOOL_TILED_SECTIONS;
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [path.join(root, 'tests/e2e/desktop-bootstrap.cjs'), '--headless', '--no-sandbox', '--remote-debugging-port=0'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  let log = '';
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Electron startup timed out: ' + log.slice(-500))), 60000);
    child.stderr.on('data', (bytes) => { log += bytes; const hit = log.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (hit) { clearTimeout(timer); resolve(hit[1]); } });
  });
  const browser = await puppeteer.connect({ browserWSEndpoint: endpoint, defaultViewport: null, protocolTimeout: 600000 });
  const page = await (await browser.waitForTarget((t) => t.url().startsWith('app://corantool/app/index.html'), { timeout: 60000 })).page();
  page.setDefaultTimeout(600000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message + ' @ ' + String(error.stack).split('\n').slice(1, 4).join(' | ')));
  page.on('dialog', (dialog) => dialog.accept().catch(() => {}));
  await page.waitForFunction(() => !!window.ichantool, { timeout: 60000 });
  await page.waitForFunction(async () => (await window.corantoolDesktop.engine.status()).state === 'ready', { timeout: 90000 });
  return { page, errors, pid: child.pid, profile, async close() {
    try { browser.disconnect(); } catch { /* ignore */ }
    if (child.exitCode === null) child.kill();
    await Promise.race([exited, sleep(15000)]);
    fs.rmSync(profile, { recursive: true, force: true });
  } };
}

async function addImage(page) {
  await page.evaluate(() => document.getElementById('openTest').click());
  await page.waitForFunction(() => window.ichantool.S.sections.length === 6, { timeout: 120000 });
  // The six sections appear before the test project has finished loading (detection, records); its end selects the first section. On GitHub's
  // machines that came after the tiled section was added, so the probe and the strokes met another image (card M8.4.32, 20 Nov 2026).
  await page.waitForFunction(() => !window.ichantool.saveBlockers().loading && document.getElementById('busy').hidden, { polling: 200, timeout: 600000 });
  assert.equal(await page.evaluate(() => window.ichantool.serialize().version), 5, 'card M8.4.18a: a project without tiled sections stays format version 5');
  await (await page.$('#addImg')).uploadFile(image);
  await page.waitForSelector('#pcOk', { timeout: 30000 });
  await page.click('#pcOk');
  await page.waitForFunction(() => window.ichantool.S.sections.length === 7, { timeout: 600000, polling: 200 });
  await page.waitForFunction(() => document.getElementById('busy').hidden, { timeout: 600000 });
}

let projectRecord = null;                             // card M8.4.18a: the saved project, opened again without tiled sections (D2)
const on = await program(true);
try {
  assert.equal(await on.page.evaluate(() => window.corantoolDesktop.tiles.enabled), true);
  const toasts = [];
  await on.page.exposeFunction('tiledToast', (text) => toasts.push(text));
  await on.page.evaluate(() => new MutationObserver(() => { const el = document.getElementById('toast'); if (el && !el.hidden) window.tiledToast(el.textContent); })
    .observe(document.getElementById('toast'), { attributes: true, childList: true, subtree: true, characterData: true }));
  await addImage(on.page);
  const section = await on.page.evaluate(() => {
    const { S } = window.ichantool, s = S.sections.at(-1);
    return { tiled: s.tiled && { level: s.tiled.level, levels: s.tiled.levels.length, pyramid: s.tiled.pyramid.length }, w: s.w, h: s.h, ds: s.ds, full: s.full,
      orig: s.orig?.length, maxMP: S.settings.maxMP, bins: s.bins.length, bioturbated: s.bins.some((b) => b.pct > 0) };
  });
  assert.ok(section.tiled, 'the image became a tiled section');
  assert.equal(section.tiled.pyramid, 64);
  assert.equal(section.ds, 2 ** section.tiled.level);
  assert.ok(section.w * section.h <= section.maxMP * 1e6, 'the working image is within the size limit');
  assert.equal(section.orig, section.w * section.h * 4);
  if (!process.argv[2]) assert.deepEqual(section.full, { w: 620, h: 16726 });
  assert.ok(section.full.w * section.full.h > section.maxMP * 1e6, 'only images above the size limit are tiled');
  assert.ok(section.bins > 0 && !section.bioturbated, 'card M8.4.17: the interval table is counted from the full-resolution masks, which are empty: bins without any bioturbation');
  assert.ok(toasts.some((text) => text.includes(String(section.full.h))), 'the user is told what a tiled section is: ' + JSON.stringify(toasts));
  // D1: a save waits up to 15 s for the section's masks to reach the store and otherwise keeps it for the next save; on GitHub's machines the
  // first round of a new section can take longer, so the test saves again, as the program does, until the section is in the record.
  const saved = await on.page.evaluate(async () => {
    for (let attempt = 0; attempt < 10 && !window.ichantool.tiledSaved().some(Boolean); attempt++) {
      await window.ichantool.saveNow();                                  // card M8.4.18a: a tiled section is saved like the others
      for (let k = 0; k < 600 && !window.ichantool.masksSettled(); k++) await new Promise((r) => setTimeout(r, 100));
    }
    const project = window.ichantool.serialize(), q = window.ichantool.S.sections.at(-1);
    return { names: project.cores.flatMap((core) => core.sections.map((q) => q.name)), version: project.version, manifests: window.ichantool.tiledSaved(),
      why: { blockers: window.ichantool.saveBlockers(), inCores: window.ichantool.S.cores.some((c) => c.sections.includes(q)), tiled: !!q.tiled, maskTiles: !!q.maskTiles,
        saveState: document.getElementById('saveState')?.dataset.state, settled: window.ichantool.masksSettled(), sync: q._maskSync ? { manifest: q._maskSync.manifest,
        running: !!q._maskSync.running, wanted: q._maskSync.wanted, stopped: q._maskSync.stopped, failures: q._maskSync.failures } : null, frozen: q.frozen ?? null } };
  });
  assert.equal(saved.names.length, 7, 'the tiled section is saved with the six others: ' + JSON.stringify(saved.why) + ' ' + JSON.stringify(toasts.slice(-4)));
  // Card M8.4.33, changed by card M8.4.18d (decision D4): with the engine a package carries the tiled section and says nothing is left out; the
  // project as `projectForExport` alone writes it still leaves it out and names it (the path of a package made without the engine, checked below
  // in the program with the flag off).
  const toastsBeforePackage = toasts.length;
  const exported = await on.page.evaluate(async () => { const json = window.ichantool.exportedProject(); await window.ichantool.packageNow();
    return { sections: json.cores.flatMap((c) => c.sections).length, leftOut: json.left_out, tiled: json.cores.flatMap((c) => c.sections).some((q) => q.tiled) }; });
  assert.equal(exported.sections, 6, 'the six ordinary sections are packaged');
  assert.equal(exported.tiled, false);
  assert.equal(exported.leftOut?.length, 1, 'the tiled section is named in left_out: ' + JSON.stringify(exported.leftOut));
  assert.ok(!toasts.slice(toastsBeforePackage).some((text) => /secciones grandes por piezas|large tiled sections/.test(text)), 'the package carries it: nothing is said to be left out: ' + JSON.stringify(toasts.slice(toastsBeforePackage)));
  assert.equal(saved.version, 6, 'a project with a tiled section is format version 6');
  assert.ok(saved.manifests.length === 1 && /^[0-9a-f]{64}$/.test(saved.manifests[0]), 'saved with its stored version: ' + JSON.stringify(saved.manifests));
  // Release the working image and ask for it again: it comes back from the pyramid, never from the source file.
  const reloaded = await on.page.evaluate(async () => {
    const { S } = window.ichantool, s = S.sections.at(-1), before = s.orig.slice(0, 4000);
    s.orig = null; s.enh = null;
    window.ichantool.needPixels?.(s);
    for (let i = 0; i < 200 && !s.orig; i++) await new Promise((r) => setTimeout(r, 50));
    return s.orig ? [...s.orig.slice(0, 4000)].every((v, i) => v === before[i]) : null;
  });
  assert.equal(reloaded, true, 'the working image is read again from the pyramid');
  // Zoomed to one screen pixel per source pixel, the viewer draws level-0 tiles: screen pixels equal the source's pixels at the same place.
  await on.page.setViewport({ width: 1600, height: 1000 });
  await on.page.evaluate(() => new Promise((r) => setTimeout(r, 300)));
  // Card M8.4.24: the probe is a function, so it can be repeated (SEDCORETOOL_PROBE_REPEAT=n) with the tile cache emptied each time; a wait that
  // never completes fails here instead of reading a coarser stand-in tile, and a failed probe keeps its evidence.
  const probe = (fraction = 1 / 3) => on.page.evaluate(async (fraction) => {
    const { S } = window.ichantool, s = S.sections.at(-1), canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('view'));
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    // Working pixel (vx, vy) at the top left, integer, so source pixel (vx * ds + sx, vy * ds + sy) is at screen (sx, sy).
    const vx = Math.floor(s.w / 2 - canvas.width / s.ds / 2), vy = Math.floor(s.h * fraction);
    S.view = { x: vx, y: vy, zoom: s.ds };
    const started = performance.now();
    window.ichantool.requestRender(); await frame();
    let waits = 0;
    for (; waits < 1200 && !window.ichantool.tilesIdle(); waits++) await new Promise((r) => setTimeout(r, 25));
    const waitedMs = Math.round(performance.now() - started), completed = window.ichantool.tilesIdle();
    window.ichantool.requestRender(); await frame();
    // Probes: source pixels that differ from the working image at the same place, so only a drawn level-0 tile can show them.
    const ctx = canvas.getContext('2d'), probes = [], left = 160;   // left of this: the strip and the ruler
    // Card M8.4.24: never on the first or last source row or column of the analysis area, where the viewer draws its dashed border (#e0995a,
    // dashes of 6 and gaps of 4 pixels) over the image: a probe there failed whenever it met a dash (found by repeating the probe).
    const X0 = Math.max(vx * s.ds + left, s.roi.x0 * s.ds + 1), Y0 = Math.max(vy * s.ds, s.roi.y0 * s.ds + 1);
    const X1 = Math.min(s.full.w, s.roi.x1 * s.ds - 1, vx * s.ds + canvas.width), Y1 = Math.min(s.full.h, s.roi.y1 * s.ds - 1, vy * s.ds + canvas.height);
    const row = Math.floor((Y0 + Y1) / 2 / 512), tiles = {};
    for (let col = Math.floor(X0 / 512); col * 512 < X1; col++) {
      let read = await window.corantoolDesktop.tiles.read(s.tiled.pyramid, 0, [[row, col]]);
      for (let k = 0; k < 120 && read.error; k++) {          // the reference read waits for an engine that is restarting (repetitions with kills)
        await new Promise((r) => setTimeout(r, 250)); read = await window.corantoolDesktop.tiles.read(s.tiled.pyramid, 0, [[row, col]]);
      }
      if (read.error) throw new Error('reference tile read: ' + JSON.stringify(read.error));
      tiles[col] = new Uint8Array(read.ok.bytes.buffer || read.ok.bytes, read.ok.bytes.byteOffset || 0, read.ok.bytes.byteLength);
    }
    const sourceAt = (X, Y) => { const at = ((Y % 512) * 512 + (X % 512)) * s.tiled.channels, b = tiles[Math.floor(X / 512)]; return s.tiled.channels === 1 ? [b[at], b[at], b[at]] : [...b.subarray(at, at + 3)]; };
    let differing = 0;
    for (let Y = Math.max(Y0, row * 512); Y < Math.min(Y1, row * 512 + 512) && probes.length < 40; Y += 3) {
      for (let X = X0; X < X1 && probes.length < 40; X += 7) {
        const source = sourceAt(X, Y), w = ((Y >> s.tiled.level) * s.w + (X >> s.tiled.level)) * 4, working = [...s.orig.subarray(w, w + 3)];
        if (source.every((v, i) => v === working[i])) continue;
        differing++;
        const sx = X - vx * s.ds, sy = Y - vy * s.ds;
        probes.push({ sx, sy, screen: [...ctx.getImageData(sx, sy, 1, 1).data.subarray(0, 3)], source, working });
      }
    }
    const bad = probes.find((p) => p.screen.some((v, i) => v !== p.source[i]));
    const evidence = bad ? window.ichantool.tileState(0, Math.floor((bad.sy + vy * s.ds) / 512), Math.floor((bad.sx + vx * s.ds) / 512)) : null;
    return { probes, level: s.tiled.level, canvas: [canvas.width, canvas.height], view: S.view, roi: s.roi, w: s.w, waitedMs, completed, evidence };
  }, fraction);
  const checkProbe = async (drawn, label) => {
    assert.ok(drawn.completed, `${label}: the visible tiles were loaded within 30 s (waited ${drawn.waitedMs} ms): ` + JSON.stringify(drawn.evidence));
    assert.ok(drawn.probes.length >= 10, 'probes where full resolution differs from the working image: ' + JSON.stringify(drawn));
    if (drawn.evidence) {
      const shot = shotFile(`sedcoretool-probe-${process.pid}-${Date.now()}.png`);
      await on.page.screenshot({ path: shot });
      console.log(`${label}: probe failed; screenshot ${shot}; tile state ${JSON.stringify(drawn.evidence)}; waited ${drawn.waitedMs} ms`);
    }
    for (const p of drawn.probes) assert.deepEqual(p.screen, p.source, `${label}: drawn pixel = source pixel at ` + JSON.stringify({ ...p, evidence: drawn.evidence }));
  };
  // Card M8.4.32: the probe and the strokes read the last section; it must be the one on screen.
  const current = await on.page.evaluate(() => { const { S } = window.ichantool; return { cur: S.cur, last: S.sections.length - 1, name: S.sections[S.cur]?.name }; });
  assert.equal(current.cur, current.last, 'the tiled section is the current section: ' + JSON.stringify(current));
  const drawn = await probe();
  await checkProbe(drawn, 'probe');
  const repeat = Number(process.env.SEDCORETOOL_PROBE_REPEAT || 0);
  if (repeat) {
    // Repetitions for card M8.4.24: the tile cache emptied before each; with SEDCORETOOL_PROBE_LOAD=1 every CPU core busy meanwhile; with
    // SEDCORETOOL_PROBE_KILL=1 the engine's coordinator killed before the fifth probe, so tile reads fail until the automatic restart.
    const burners = process.env.SEDCORETOOL_PROBE_LOAD === '1'
      ? os.cpus().map(() => spawn(process.execPath, ['-e', 'for(;;){}'], { stdio: 'ignore', windowsHide: true })) : [];
    const timesMs = [];
    try {
      for (let n = 1; n <= repeat; n++) {
        await on.page.evaluate(() => window.ichantool.clearTiles());
        if (process.env.SEDCORETOOL_PROBE_KILL === '1' && n === 5) {          // once: the program restarts the engine once per session
          const coordinator = findCoordinator(on.pid);
          if (coordinator > 0) process.kill(coordinator, 'SIGKILL');
        }
        const again = await probe(0.2 + (n % 7) * 0.08);
        timesMs.push(again.waitedMs);
        await checkProbe(again, `repetition ${n}`);
      }
    } finally { for (const burner of burners) burner.kill(); }
    console.log(`Viewer probe repeated ${repeat} times, all passed; wait for the tiles (ms):`, JSON.stringify(timesMs));
    if (process.env.SEDCORETOOL_PROBE_KILL === '1') {   // the one automatic restart is used up: the rest of the test needs it, so stop here
      console.log('SEDCORETOOL_PROBE_KILL=1: the one automatic restart of the engine was used; the rest of the test is not run in this mode.');
      await on.close();
      process.exit(on.errors.length ? 1 : 0);
    }
  }
  // A tool that decodes the source refuses with a message instead of reading gigabytes.
  const refused = await on.page.evaluate(async () => {
    const { S } = window.ichantool, s = S.sections.at(-1);
    const select = document.getElementById('secRes'); select.value = String(Math.max(1, s.ds / 2)); select.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 1500));
    return s.ds;
  });
  assert.equal(refused, section.ds, 'changing the resolution of a tiled section is refused');
  // Navigation strip, ruler and readouts (step 5). The strip is drawn from the working image; the readout gives the source pixel and the depth of
  // the source row. Tolerance of the depth: one working row, because the working image has ceil(full height / ds) rows and the depth is
  // linear over them (3 decimals are shown).
  const nav = await on.page.evaluate(async () => {
    const { S } = window.ichantool, s = S.sections.at(-1), canvas = document.getElementById('view');
    S.view = { x: 0, y: Math.floor(s.h / 3), zoom: 1 };
    window.ichantool.requestRender(); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const box = canvas.getBoundingClientRect(), sx = 300, sy = 211;
    canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: box.left + sx, clientY: box.top + sy, bubbles: true, pointerId: 1 }));
    await new Promise((r) => setTimeout(r, 100));
    const strip = canvas.getContext('2d').getImageData(6, 14, 8, canvas.height - 40).data, colours = new Set();
    for (let i = 0; i < strip.length; i += 4 * 7) colours.add(strip[i] + ',' + strip[i + 1] + ',' + strip[i + 2]);
    return { px: document.getElementById('stPx').textContent, depth: document.getElementById('stDepth').textContent, stripColours: colours.size,
      row: (S.view.y + sy / S.view.zoom), ds: s.ds, h: s.h, full: s.full, top: s.top, bottom: s.bottom, y0: s.roi.y0, y1: s.roi.y1, x: S.view.x + sx / S.view.zoom };
  });
  const sourceRow = Math.floor(nav.row * nav.ds), sourceX = Math.floor(nav.x * nav.ds);
  assert.equal(nav.px, `x ${sourceX} · y ${sourceRow}`, 'the readout gives the source pixel: ' + JSON.stringify(nav));
  const readDepth = parseFloat(nav.depth.replace(/^[^0-9-]*/, '')), expected = nav.top + (sourceRow / nav.full.h) * (nav.bottom - nav.top);
  assert.ok(Math.abs(readDepth - expected) <= (nav.bottom - nav.top) / nav.h + 0.0006, `depth of the source row ${sourceRow}: read ${readDepth}, expected ${expected}`);
  assert.ok(nav.stripColours >= 2, 'the navigation strip shows the section image: ' + nav.stripColours + ' colours');
  // Step 6 of M8.4.15, updated by M8.4.16 steps 3 and 6: every tool of the Section mode works on a tiled section; detection, crop, rotation,
  // resolution and filters refuse with the one message. A tool selected on another section stays selected in a tiled one.
  const gating = await on.page.evaluate(async () => {
    const { S } = window.ichantool, s = S.sections.at(-1), toastText = () => document.getElementById('toast').textContent, out = { tools: {}, actions: {} };
    const pause = () => new Promise((r) => setTimeout(r, 120));
    for (const tool of ['select', 'pan', 'mark', 'wand', 'brush', 'lasso', 'cut', 'erase', 'exclude', 'include']) {
      window.ichantool.setTool('pan'); document.getElementById('toast').textContent = '';
      document.querySelector(`.tool[data-tool="${tool}"]`).click(); await pause();
      out.tools[tool] = { active: S.tool === tool, message: toastText() };
    }
    window.ichantool.setTool('pan');
    const roi = document.getElementById('roiBtn'); roi.click(); await pause(); out.tools.roi = S.tool === 'roi'; window.ichantool.setTool('pan');
    const before = { w: s.w, h: s.h, ds: s.ds, rot: s.rot, crop: s.crop, filters: JSON.stringify(s.filters) };
    for (const id of ['detectBtn', 'cropBtn', 'rotL', 'rotR']) { document.getElementById('toast').textContent = ''; document.getElementById(id).click(); await pause(); out.actions[id] = toastText(); }
    const select = document.getElementById('secRes'); select.value = String(s.ds * 2); select.dispatchEvent(new Event('change', { bubbles: true })); await pause(); out.actions.secRes = toastText(); out.resValue = select.value;
    const gamma = document.getElementById('f-gamma'); document.getElementById('toast').textContent = '';
    gamma.value = '1.8'; gamma.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => setTimeout(r, 300)); out.actions.filter = toastText();
    out.unchanged = JSON.stringify(before) === JSON.stringify({ w: s.w, h: s.h, ds: s.ds, rot: s.rot, crop: s.crop, filters: JSON.stringify(s.filters) });
    // A wand chosen on the first section does not follow into the tiled one.
    S.cur = 0; window.ichantool.setTool('wand'); S.cur = S.sections.length - 1; window.ichantool.renderSectionForm?.(); out.carried = S.tool;
    return out;
  });
  for (const tool of ['select', 'pan', 'mark', 'wand', 'brush', 'lasso', 'cut', 'erase', 'exclude', 'include']) {
    assert.equal(gating.tools[tool].active, true, tool + ' is available on a tiled section');
    assert.equal(gating.tools[tool].message, '', tool + ' shows no message');
  }
  assert.equal(gating.tools.roi, true, 'the analysis area is available');
  const message = await on.page.evaluate(() => window.ichantool.t('tiles.unavailable'));
  for (const [action, text] of Object.entries(gating.actions)) assert.equal(text, message, `${action} shows the one message`);
  assert.equal(gating.carried, 'wand', 'the wand chosen on another section stays selected in a tiled one');
  assert.equal(gating.unchanged, true, 'the refused tools changed nothing');
  assert.equal(gating.resValue, String(section.ds), 'the resolution control returns to the current value');
  // Card M8.4.16 step 2: a mask tile put in the page shows at full resolution over the pixel tiles and, reduced, in the working image at every
  // coarser zoom. One object (a rectangle) and one excluded rectangle in tile row 10; each probe is compared with the same screen pixel without
  // the mask, through today's formulas. Tolerance, stated before comparing: 2 levels per channel (8-bit colour and alpha of the drawn layer).
  const masks = await on.page.evaluate(async () => {
    const { S } = window.ichantool, s = S.sections.at(-1), canvas = document.getElementById('view'), ctx = canvas.getContext('2d');
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const TILE = 512, row = 10, id = s.nextId;
    s.objects.set(id, { id, order: s.nextTraceOrder++, cls: S.classes[0].id, pred: null, conf: 0, src: 'test', area: 0, bbox: null, stats: null, feat: null });
    s.nextId = id + 1; s.lutFill = null; S.selected = null; S.multi.clear?.();
    const labels = new Int32Array(TILE * TILE), exclude = new Uint8Array(TILE * TILE);
    for (let y = 100; y < 200; y++) for (let x = 300; x < 460; x++) labels[y * TILE + x] = id;            // source x 300-459, y 5220-5319
    for (let y = 300; y < 350; y++) for (let x = 300; x < 380; x++) exclude[y * TILE + x] = 1;            // source x 300-379, y 5420-5469
    const probes = [['inside', 380, 5270], ['edge', 300, 5270], ['excluded', 340, 5445], ['outside', 520, 5270]];
    const views = [['full resolution (level 0)', { x: 0, y: 2560, zoom: s.ds }], ['working image, 1 : 1', { x: -300, y: 2510, zoom: 1 }],
      ['working image, 1 : 2', { x: -600, y: 2400, zoom: 0.5 }]];
    const read = async (view) => {
      S.view = { ...view }; window.ichantool.requestRender(); await frame();
      for (let i = 0; i < 400 && !window.ichantool.tilesIdle(); i++) await new Promise((r) => setTimeout(r, 25));
      window.ichantool.requestRender(); await frame();
      return probes.map(([name, X, Y]) => {
        const sx = Math.floor((X / s.ds - view.x) * view.zoom), sy = Math.floor((Y / s.ds - view.y) * view.zoom);
        return { name, sx, sy, rgb: [...ctx.getImageData(sx, sy, 1, 1).data.subarray(0, 3)] };
      });
    };
    const out = [];
    for (const [name, view] of views) {
      window.ichantool.putMaskTile(row, 0, null, null);
      const before = await read(view);
      window.ichantool.putMaskTile(row, 0, labels, exclude);
      const after = await read(view);
      out.push({ name, before, after });
    }
    window.ichantool.putMaskTile(row, 0, null, null);
    const k = id * 4;
    return { views: out, fill: [...s.lutFill.subarray(k, k + 4)], line: [...s.lutLine.subarray(k, k + 3)], reduced: s.labels[(5270 / s.ds) * s.w + 380 / s.ds] };
  });
  const close = (actual, expected, what) => assert.ok(actual.every((v, c) => Math.abs(v - Math.round(expected[c])) <= 2), `${what}: ${actual} vs ${expected.map(Math.round)}`);
  const alpha = masks.fill[3] / 255;
  for (const { name, before, after } of masks.views) {
    const at = (list, probe) => list.find((p) => p.name === probe);
    const inside = at(before, 'inside').rgb, edge = at(after, 'edge'), excluded = at(after, 'excluded');
    close(at(after, 'inside').rgb, inside.map((v, c) => v * (1 - alpha) + masks.fill[c] * alpha), `${name}: object fill`);
    close(edge.rgb, masks.line, `${name}: object edge`);
    const base = at(before, 'excluded').rgb, hatch = ((excluded.sx + excluded.sy) & 7) < 2;
    close(excluded.rgb, base.map((v, c) => (hatch ? v * 0.3 + (c === 2 ? 80 : 70) : v * 0.55)), `${name}: exclusion`);
    assert.deepEqual(at(after, 'outside').rgb, at(before, 'outside').rgb, `${name}: unchanged outside the masks`);
  }
  assert.equal(masks.reduced, 0, 'removing the tile clears the reduced masks');
  // Card M8.4.16 step 3: strokes with the real mouse at full resolution (1 screen pixel per source pixel). Brush radius 10 working pixels =
  // 20 source pixels. The tiles hold the stroke exactly where it was drawn; the object's statistics, recomputed per tile from the level-0
  // pixels, count exactly the labelled source pixels; erase, exclude and include change the tiles and the reduced copy.
  const strokes = await (async () => {
    const page = on.page, box = await page.evaluate(() => {
      const { S } = window.ichantool, s = S.sections.at(-1), r = document.getElementById('view').getBoundingClientRect();
      S.view = { x: 0, y: 3000, zoom: s.ds }; S.brushSize = 10; S.exShape = 'free'; S.overlap = false; window.ichantool.requestRender();
      return { left: r.left, top: r.top };
    });
    const stroke = async (tool, y, x0, x1) => {
      await page.evaluate((tool) => window.ichantool.setTool(tool), tool);
      await page.mouse.move(box.left + x0, box.top + y); await page.mouse.down();
      for (let x = x0; x <= x1; x += 10) await page.mouse.move(box.left + x, box.top + y);
      await page.mouse.up();
      await page.waitForFunction(() => window.ichantool.tiledStatsIdle(), { polling: 50 });
    };
    const read = () => page.evaluate(() => {
      const { S } = window.ichantool, s = S.sections.at(-1), tiles = s.maskTiles, at = (x, y) => tiles.labelAt(x, y);
      const ex = (x, y) => { const e = tiles.get(Math.floor(y / 512), Math.floor(x / 512)); return e?.exclude ? e.exclude[(y % 512) * 512 + (x % 512)] : 0; };
      const id = at(350, 6200), counts = new Map();
      for (let row = 0; row < tiles.rows; row++) for (let col = 0; col < tiles.cols; col++) {
        const labels = tiles.get(row, col)?.labels; if (!labels) continue;
        for (const v of labels) if (v > 0) counts.set(v, (counts.get(v) || 0) + 1);
      }
      const o = s.objects.get(id);
      return { id, centre: at(350, 6200), radius: [at(350, 6219), at(350, 6221), at(281, 6200), at(279, 6200)], far: at(350, 6230),
        counted: counts.get(id) || 0, area: o?.area, n: o?.stats?.n, sbox: o?.sbox, bbox: o?.bbox, ds: s.ds, excluded: ex(350, 6400), excludedOut: ex(350, 6430),
        reducedLabel: s.labels[(6200 / s.ds) * s.w + 350 / s.ds], reducedExclude: s.exclude[(6400 / s.ds) * s.w + 350 / s.ds], objects: s.objects.size };
    });
    await stroke('brush', 200, 300, 400);
    const painted = await read();
    await stroke('erase', 200, 380, 420);   // erases x 360-439: the probe at x 350 stays
    const erased = await read();
    await stroke('exclude', 400, 300, 400);
    const excluded = await read();
    await stroke('include', 400, 300, 400);
    const included = await read();
    return { painted, erased, excluded, included };
  })();
  const { painted, erased, excluded, included } = strokes;
  assert.ok(painted.id > 0, 'the brush wrote an object into the tiles: ' + JSON.stringify(painted));
  assert.deepEqual(painted.radius, [painted.id, 0, painted.id, 0], 'the stroke has the brush radius in source pixels (20): ' + JSON.stringify(painted));
  assert.equal(painted.far, 0);
  assert.equal(painted.area, painted.counted, 'the area is the number of labelled source pixels in the tiles');
  assert.equal(painted.n, painted.counted);
  assert.deepEqual(painted.sbox, [280, 6180, 419, 6219], 'source bounding box of a stroke from x 300 to 400 at y 6200 with radius 20 (a pixel is painted when its centre is within the radius)');
  assert.deepEqual(painted.bbox, painted.sbox.map((v) => Math.floor(v / painted.ds)), 'the working bounding box is the source one divided by ds');
  assert.equal(painted.reducedLabel, painted.id, 'the reduced copy shows the stroke');
  assert.ok(erased.area < painted.area && erased.area === erased.counted && erased.centre === erased.id, 'erasing part of the stroke: ' + JSON.stringify(erased));
  assert.equal(excluded.excluded, 1); assert.equal(excluded.excludedOut, 0); assert.equal(excluded.reducedExclude, 1);
  assert.equal(excluded.area, erased.area, 'exclusion does not change the object');
  assert.equal(included.excluded, 0); assert.equal(included.reducedExclude, 0);
  // Card M8.4.16 step 6: lasso, scissors, merge, a class change that merges overlapping objects of one ichnotaxon, delete and the wand, with the
  // real mouse at 1 screen pixel per source pixel (screen x, y is source x, 6000 + y), each checked against the labels in the tiles; delete is
  // undone and redone. Expected areas follow from the rules of `polygonPixels` (pixel centres) and `splitPieces` (cut pixels join the piece on
  // their left first).
  const ops = await (async () => {
    // The canvas is measured before every stroke: on GitHub's machines it is taller than the window and its pane scrolled by about 29 px between
    // the lasso and the scissors, so positions measured once put the cut 29 px too low (card M8.4.32, 20 Nov 2026).
    const page = on.page, viewBox = () => page.evaluate(() => { const r = document.getElementById('view').getBoundingClientRect(); return { left: r.left, top: r.top }; });
    let box = await viewBox();
    const idle = () => page.waitForFunction(() => window.ichantool.tiledStatsIdle() && window.ichantool.masksSettled() && !window.ichantool.objectsWaiting(), { polling: 50, timeout: 60000 });
    const path = async (tool, points, keys = []) => {
      await page.evaluate((tool) => window.ichantool.setTool(tool), tool);
      box = await viewBox();
      for (const key of keys) await page.keyboard.down(key);
      await page.mouse.move(box.left + points[0][0], box.top + points[0][1]); await page.mouse.down();
      for (let k = 1; k < points.length; k++) {
        const [ax, ay] = points[k - 1], [bx, by] = points[k];
        for (let q = 1; q <= 4; q++) await page.mouse.move(box.left + ax + ((bx - ax) * q) / 4, box.top + ay + ((by - ay) * q) / 4);
      }
      await page.mouse.up();
      for (const key of keys) await page.keyboard.up(key);
      await idle();
    };
    const state = () => page.evaluate(() => {
      const s = window.ichantool.S.sections.at(-1), tiles = s.maskTiles, counted = {};
      for (let row = 0; row < tiles.rows; row++) for (let col = 0; col < tiles.cols; col++) {
        const labels = tiles.get(row, col)?.labels; if (!labels) continue;
        for (const v of labels) if (v) for (const id of v > 0 ? [v] : s.stacks[-v]) counted[id] = (counted[id] || 0) + 1;
      }
      const objects = {};
      for (const o of s.objects.values()) if (o.sbox) objects[o.id] = { area: o.area, sbox: o.sbox, cls: o.cls };
      return { objects, counted, toast: document.getElementById('toast').textContent, undo: window.ichantool.S.undo.length };
    });
    await page.evaluate(() => { const { S } = window.ichantool; S.active = S.classes[0].id; S.overlap = true; S.selected = 0; S.multi.clear(); });
    const start = await state();
    await path('lasso', [[100, 520], [200, 520], [200, 580], [100, 580]]);
    const lassoed = await state();
    // Card M8.4.32: the pointer events the page receives during the cut, to tell a lost or merged move from a wrong mapping if it fails.
    await page.evaluate(() => {
      const seen = window.__cutEvents = [], view = document.getElementById('view');
      for (const type of ['pointerdown', 'pointermove', 'pointerup']) view.addEventListener(type, (e) => { if (seen.length < 200) seen.push([type[7] || type[5], e.clientX, e.clientY, e.getCoalescedEvents?.().length ?? 0]); }, { capture: true });
      window.addEventListener('pointerup', (e) => { if (seen.length < 200) seen.push(['window-up', e.clientX, e.clientY]); }, { capture: true });
    });
    await path('cut', [[150, 500], [150, 600]]);
    const cut = await state();
    cut.pointer = await page.evaluate(() => { const s = window.ichantool.S.sections.at(-1), r = document.getElementById('view').getBoundingClientRect();
      return { events: window.__cutEvents, view: window.ichantool.S.view, ds: s.ds, rect: [r.left, r.top, r.width, r.height], dpr: window.devicePixelRatio }; });
    cut.box = box;
    if (Object.keys(cut.objects).filter((id) => !start.objects[id]).length !== 2) {
      const shot = shotFile(`sedcoretool-scissors-${process.pid}.png`); await page.screenshot({ path: shot }); cut.shot = shot;
    }
    const pieces = Object.keys(cut.objects).filter((id) => !start.objects[id]).map(Number);
    await page.evaluate((ids) => window.ichantool.mergeObjects(ids), pieces); await idle();
    const merged = await state();
    await page.evaluate(() => { const { S } = window.ichantool; S.active = S.classes[1].id; S.selected = 0; });
    await path('lasso', [[180, 540], [260, 540], [260, 600], [180, 600]]);
    const overlapped = await state();
    const second = Object.keys(overlapped.objects).map(Number).find((id) => !merged.objects[id]);
    await page.evaluate((id) => window.ichantool.assignClass(id, window.ichantool.S.classes[0].id), second); await idle();
    const sameTaxon = await state();
    // An operation that reads objects' boxes waits while their statistics are being computed, with the busy indicator, and then runs by itself
    // (card M8.4.28; before, it refused with "try again in a moment").
    const kept = Object.keys(sameTaxon.objects).map(Number).find((id) => !start.objects[id]);
    const busy = await page.evaluate((id) => { const s = window.ichantool.S.sections.at(-1), runner = s._statsRunner; void runner.queue(runner.tilesFor(id));
      window.ichantool.deleteObjects([id]); const indicator = document.getElementById('busy');
      return { waiting: !indicator.hidden && indicator.textContent === window.ichantool.t('tiles.waiting'), still: s.objects.has(id) }; }, kept);
    await page.waitForFunction((id) => !window.ichantool.S.sections.at(-1).objects.has(id), { polling: 50, timeout: 60000 }, kept); await idle();
    busy.refused = await page.evaluate(() => document.getElementById('toast').textContent === window.ichantool.t('tiles.busy'));
    busy.indicatorAfter = await page.evaluate(() => !document.getElementById('busy').hidden);
    const deleted = await state();
    await page.click('#undoBtn'); await idle();
    const undone = await state();
    await page.click('#redoBtn'); await idle();
    const redone = await state();
    const count = await page.evaluate(() => window.ichantool.S.sections.at(-1).objects.size);
    await page.evaluate(() => window.ichantool.setTool('wand'));
    box = await viewBox();
    await page.mouse.click(box.left + 400, box.top + 650);
    await page.waitForFunction((n) => window.ichantool.S.sections.at(-1).objects.size > n, { polling: 50, timeout: 60000 }, count);
    await idle();
    const wanded = await state();
    const canvas = await page.evaluate(() => ({ w: document.getElementById('view').width, h: document.getElementById('view').height }));
    return { start, lassoed, cut, pieces, merged, overlapped, second, sameTaxon, kept, busy, deleted, undone, redone, wanded, canvas };
  })();
  const fresh = (after, before) => Object.keys(after.objects).filter((id) => !before.objects[id]).map(Number);
  const [lassoId] = fresh(ops.lassoed, ops.start);
  assert.deepEqual(ops.lassoed.objects[lassoId], { area: 6000, sbox: [100, 6520, 199, 6579], cls: ops.lassoed.objects[lassoId].cls }, 'the lasso labels the source pixels whose centres are inside the polygon');
  assert.equal(ops.lassoed.counted[lassoId], 6000);
  assert.deepEqual(ops.pieces.length, 2, 'the scissors split the object in two: ' + JSON.stringify({ objects: ops.cut.objects, toast: ops.cut.toast, undo: [ops.lassoed.undo, ops.cut.undo], canvas: ops.canvas, pointer: ops.cut.pointer, box: ops.cut.box, shot: ops.cut.shot }));
  assert.deepEqual(ops.pieces.map((id) => ops.cut.objects[id].area).sort(), [2880, 3120], 'left 49 + 3 cut columns, right 48 columns, 60 rows');
  for (const id of ops.pieces) assert.equal(ops.cut.counted[id], ops.cut.objects[id].area);
  const [mergedId] = fresh(ops.merged, ops.start);
  assert.equal(fresh(ops.merged, ops.start).length, 1);
  assert.equal(ops.merged.objects[mergedId].area, 6000, 'merging gives back the lassoed object');
  assert.equal(ops.merged.counted[mergedId], 6000);
  assert.equal(ops.overlapped.objects[ops.second].area, 4800);
  assert.equal(ops.overlapped.counted[mergedId] + ops.overlapped.counted[ops.second], 10800, 'the second lasso overlaps the first on 20 x 40 pixels (another class)');
  assert.deepEqual(fresh(ops.sameTaxon, ops.start), [ops.kept]);
  assert.equal(ops.sameTaxon.objects[ops.kept].area, 10000, 'the same ichnotaxon: the two objects become one (their union)');
  assert.equal(ops.sameTaxon.counted[ops.kept], 10000);
  assert.deepEqual(ops.busy, { waiting: true, still: true, refused: false, indicatorAfter: false }, 'delete waits for its object\'s statistics, then runs by itself');
  assert.equal(ops.deleted.objects[ops.kept], undefined); assert.equal(ops.deleted.counted[ops.kept], undefined, 'delete removes the object from the tiles');
  assert.deepEqual(ops.undone.objects[ops.kept], ops.sameTaxon.objects[ops.kept], 'undo brings the object back as it was');
  assert.equal(ops.undone.counted[ops.kept], 10000);
  assert.equal(ops.redone.counted[ops.kept], undefined);
  const [wandId] = fresh(ops.wanded, ops.redone);
  assert.ok(wandId && ops.wanded.objects[wandId].area > 0 && ops.wanded.counted[wandId] === ops.wanded.objects[wandId].area, 'the wand labels the region it grows: ' + JSON.stringify(ops.wanded.objects[wandId]));
  // The visible area is source x 0-619 (the whole width), y 6000 to 6000 + canvas height; its window is whole tiles of 512.
  const wandBox = ops.wanded.objects[wandId].sbox, lastRow = Math.floor((6000 + ops.canvas.h - 1) / 512);
  assert.ok(wandBox[0] >= 0 && wandBox[2] < 620 && wandBox[1] >= 11 * 512 && wandBox[3] < (lastRow + 1) * 512, 'the wand grows within the tiles of the visible area: ' + wandBox);
  // Card M8.4.16 step 4: the strokes reach the engine's store in the background. Then a stroke over six tiles, and the engine's coordinator
  // killed while they are on their way: the page's masks do not change, the program restarts the engine (once, automatically) and sends them
  // again, and the store then holds exactly what the page holds.
  const storeMatchesPage = () => on.page.evaluate(async () => {
    const { S } = window.ichantool, s = S.sections.at(-1), tiles = s.maskTiles, tilesApi = window.corantoolDesktop.tiles;
    const hex = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
    const manifest = s._maskSync.manifest, project = window.ichantool.S.id.toLowerCase(), positions = [], page = {};
    for (let row = 0; row < tiles.rows; row++) for (let col = 0; col < tiles.cols; col++) {
      const entry = tiles.get(row, col);
      if (!entry) continue;
      positions.push([row, col]);
      page[`${row}.${col}`] = [entry.labels ? await hex(new Uint8Array(entry.labels.buffer)) : null, entry.exclude ? await hex(entry.exclude) : null];
    }
    const stored = {};
    for (let i = 0; i < positions.length; i += 16) {
      const batch = positions.slice(i, i + 16);
      for (const [k, layer] of [[0, 'labels'], [1, 'exclude']]) {
        const read = await tilesApi.maskRead(project, manifest, layer, batch);
        if (read.error) return { error: read.error };
        const bytes = new Uint8Array(read.ok.bytes.buffer || read.ok.bytes, read.ok.bytes.byteOffset || 0, read.ok.bytes.byteLength);
        let offset = 0;
        for (const tile of read.ok.tiles) {
          const key = `${tile.row}.${tile.col}`; stored[key] ||= [null, null];
          stored[key][k] = tile.byte_length ? await hex(bytes.subarray(offset, offset + tile.byte_length)) : null; offset += tile.byte_length;
        }
      }
    }
    return { manifest, page, stored, dirty: tiles.dirtyPositions().length, withContent: Object.values(page).filter(([a, b]) => a || b).length };
  });
  await on.page.waitForFunction(() => window.ichantool.masksSettled(), { polling: 100, timeout: 60000 });
  const settled = await storeMatchesPage();
  assert.ok(settled.manifest && settled.dirty === 0 && settled.withContent >= 1, 'the strokes reached the store: ' + JSON.stringify({ ...settled, page: undefined, stored: undefined }));
  assert.deepEqual(settled.stored, settled.page, 'the store holds exactly the page\'s masks');
  await on.page.evaluate(() => { window.ichantool.setTool('brush'); window.ichantool.S.brushSize = 10; });
  const box = await on.page.evaluate(() => { const r = document.getElementById('view').getBoundingClientRect(); return { left: r.left, top: r.top }; });
  // Found before the stroke: looking it up takes about a second, longer than a round.
  const coordinator = findCoordinator(on.pid);
  assert.ok(coordinator > 0, 'the engine coordinator of this program was found');
  // Card M8.4.16 step 5: the stroke is undone while the engine is down and redone after it is back; each state reaches the store exactly.
  const objectsNow = () => on.page.evaluate(() => [...window.ichantool.S.sections.at(-1).objects.values()].map((o) => [o.id, o.area, String(o.sbox)]));
  const withLayers = (page) => Object.fromEntries(Object.entries(page).filter(([, layers]) => layers[0] || layers[1]));
  await on.page.waitForFunction(() => window.ichantool.tiledStatsIdle(), { polling: 100, timeout: 60000 });
  // Nothing may be pending when the stroke starts: a save started by the earlier edits sends a round, and one that lands during the stroke
  // commits before the stroke's own round (seen on 19 Nov 2026, depending on how long the process lookup above took).
  await on.page.evaluate(() => window.ichantool.saveNow());
  await on.page.waitForFunction(() => window.ichantool.masksSettled(), { polling: 100, timeout: 60000 });
  const manifestBeforeStroke = await on.page.evaluate(() => window.ichantool.S.sections.at(-1)._maskSync.manifest);
  const objectsBefore = await objectsNow();
  const putsBefore = await on.page.evaluate(() => window.ichantool.S.sections.at(-1)._maskSync.puts);
  // Card M8.4.35: the round is held after its last tile and before its commit, so the engine is killed while it is on its way without racing it
  // (a wait on animation frames timed out on GitHub's macOS, twice in November 2026: the round had committed, or frames did not run).
  await on.page.evaluate(() => { const sync = window.ichantool.S.sections.at(-1)._maskSync; sync.beforeCommit = () => new Promise((resolve) => { window.__heldRound = resolve; }); });
  await on.page.mouse.move(box.left + 500, box.top + 40); await on.page.mouse.down();
  for (let y = 40; y <= 900; y += 20) await on.page.mouse.move(box.left + 500 + (y % 40), box.top + y);
  await on.page.mouse.up();
  const before = await on.page.evaluate(async () => {
    const s = window.ichantool.S.sections.at(-1), tiles = s.maskTiles, out = {};
    for (const [row, col] of tiles.dirtyPositions()) out[`${row}.${col}`] = Array.from(tiles.get(row, col).labels || []).reduce((a, v, i) => (a + v * (i % 9973 + 1)) % 1e9, 0);
    return out;
  });
  assert.ok(Object.keys(before).length >= 4, 'the stroke changed several tiles: ' + Object.keys(before));
  // Wait until the round is on its way (its first tile sent, not committed), then kill the coordinator.
  await on.page.waitForFunction((base) => { const sync = window.ichantool.S.sections.at(-1)._maskSync; return !!sync.running && sync.puts > base && !!window.__heldRound; },
    { polling: 50, timeout: 60000 }, putsBefore);
  const manifestAtKill = await on.page.evaluate(() => window.ichantool.S.sections.at(-1)._maskSync.manifest);
  process.kill(coordinator, 'SIGKILL');
  await on.page.evaluate(() => { const sync = window.ichantool.S.sections.at(-1)._maskSync; sync.beforeCommit = null; window.__heldRound(); window.__heldRound = null; });   // its commit now fails
  const kept = await on.page.evaluate(async (expected) => {
    const s = window.ichantool.S.sections.at(-1), tiles = s.maskTiles;
    return Object.entries(expected).every(([key, sum]) => { const [row, col] = key.split('.').map(Number);
      return Array.from(tiles.get(row, col).labels || []).reduce((a, v, i) => (a + v * (i % 9973 + 1)) % 1e9, 0) === sum; });
  }, before);
  assert.equal(kept, true, 'the page keeps its masks when the engine dies');
  await on.page.click('#undoBtn');                                       // while the engine is down
  await on.page.waitForFunction(() => window.ichantool.masksSettled(), { polling: 200, timeout: 120000 });
  const midway = await on.page.evaluate(() => { const sync = window.ichantool.S.sections.at(-1)._maskSync; return { running: !!sync.running, manifest: sync.manifest }; });
  const resent = await storeMatchesPage();
  assert.ok(!resent.error, 'the restarted engine answers: ' + JSON.stringify(resent.error));
  assert.equal(resent.dirty, 0);
  assert.equal(manifestAtKill, manifestBeforeStroke, 'the engine was killed before the round committed');
  assert.equal(midway.running, false);
  assert.deepEqual(resent.stored, resent.page, 'after the restart the store holds exactly the page\'s masks');
  assert.deepEqual(withLayers(resent.page), withLayers(settled.page), 'the undone stroke is gone from the page and from the store');
  await on.page.waitForFunction(() => window.ichantool.tiledStatsIdle(), { polling: 100, timeout: 60000 });
  assert.deepEqual(await objectsNow(), objectsBefore, 'the objects and their statistics are those before the stroke');
  await on.page.click('#redoBtn');
  await on.page.waitForFunction(() => window.ichantool.masksSettled() && window.ichantool.tiledStatsIdle(), { polling: 200, timeout: 120000 });
  const redone = await storeMatchesPage();
  assert.deepEqual(redone.stored, redone.page, 'after the redo the store holds exactly the page\'s masks, the stroke included');
  assert.notEqual(redone.manifest, resent.manifest);
  const again = await on.page.evaluate(async (keys) => {
    const tiles = window.ichantool.S.sections.at(-1).maskTiles, out = {};
    for (const key of keys) { const [row, col] = key.split('.').map(Number); out[key] = Array.from(tiles.get(row, col)?.labels || []).reduce((a, v, i) => (a + v * (i % 9973 + 1)) % 1e9, 0); }
    return out;
  }, Object.keys(before));
  assert.deepEqual(again, before, 'the redo gives back the stroke exactly');
  assert.notDeepEqual(await objectsNow(), objectsBefore);
  const messages = await on.page.evaluate(() => [window.ichantool.t('tiles.masksUnsent'), window.ichantool.t('tiles.masksSent')]);
  assert.ok(toasts.includes(messages[0]) && toasts.indexOf(messages[1], toasts.indexOf(messages[0])) > 0,
    'the failure of the round was shown, then its recovery: ' + JSON.stringify(toasts.slice(-4)));
  // Card M8.4.16 step 8: exact equality. The same image (620 x 16726, 10.4 Mpixel) is opened whole (maximum size raised to 12 Mpixel, section
  // factor 1) and forced tiled at full resolution (factor 1), and the same scripted edits are made on both with the real mouse: brushes of two
  // classes that overlap, erase, exclude, include, lasso, scissors, merge, a class change that merges, the wand, delete, undo and redo. Labels
  // (overlap codes compared as sets of object ids), exclusion, objects and stacks must be identical; sums of luminance (`sL`, `sLL`, `rL`) are
  // added in another order by tiles and are compared within a relative 1e-12, stated before comparing; every other field exactly.
  // Two decoders (the browser's for the whole image, libvips for the pyramid) differ by up to 9 levels on about 1 % of the samples of a JPEG, so
  // the equality is checked on a lossless copy of the same pixels, written once by the page itself.
  const lossless = path.join(os.tmpdir(), `sedcoretool-equality-${process.pid}.png`);
  fs.writeFileSync(lossless, Buffer.from(await on.page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)), bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height); canvas.getContext('2d').drawImage(bitmap, 0, 0);
    const out = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()); let text = '';
    for (let k = 0; k < out.length; k += 8192) text += String.fromCharCode(...out.subarray(k, k + 8192));
    return btoa(text);
  }, fs.readFileSync(image).toString('base64')), 'base64'));
  const added = async (force) => {
    await on.page.evaluate((force) => { window.ichantool.forceTiledSections(force); window.ichantool.S.settings.maxMP = 12; }, force);
    const before = await on.page.evaluate(() => window.ichantool.S.sections.length);
    await (await on.page.$('#addImg')).uploadFile(lossless);
    await on.page.waitForSelector('#pcOk', { timeout: 30000 }); await on.page.click('#pcOk');
    await on.page.waitForFunction((n) => window.ichantool.S.sections.length === n + 1, { timeout: 600000, polling: 200 }, before);
    await on.page.waitForFunction(() => document.getElementById('busy').hidden, { timeout: 600000 });
    await on.page.evaluate(() => window.ichantool.forceTiledSections(false));
    return before;
  };
  const wholeAt = await added(false), tiledAt = await added(true);
  const kinds = await on.page.evaluate(([a, b]) => [a, b].map((k) => { const q = window.ichantool.S.sections[k]; return { tiled: !!q.tiled, ds: q.ds, w: q.w, h: q.h }; }), [wholeAt, tiledAt]);
  assert.deepEqual(kinds, [{ tiled: false, ds: 1, w: 620, h: 16726 }, { tiled: true, ds: 1, w: 620, h: 16726 }], 'the same image opened both ways, factor 1');
  const script = async (index) => {
    const page = on.page;
    await page.evaluate((index) => {
      const { S } = window.ichantool; S.cur = index; window.ichantool.selectSection?.(index);
      S.view = { x: 0, y: 3000, zoom: 1 }; S.brushSize = 10; S.exShape = 'free'; S.overlap = true; S.wandTol = 20; S.selected = 0; S.multi.clear();
      S.active = S.classes[0].id; S.sections[index].roi = { x0: 0, y0: 3000, x1: 620, y1: 4400 };   // bounds the wand and the lasso alike on both paths
      window.ichantool.requestRender();
    }, index);
    // Measured before every stroke, as in the editing steps above (the pane may scroll; card M8.4.32).
    const viewBox = () => page.evaluate(() => { const r = document.getElementById('view').getBoundingClientRect(); return { left: r.left, top: r.top }; });
    let box = await viewBox();
    const idle = () => page.waitForFunction(() => window.ichantool.tiledStatsIdle() && window.ichantool.masksSettled() && !window.ichantool.objectsWaiting(), { polling: 50, timeout: 60000 });
    const draw = async (tool, points) => {
      await page.evaluate((tool) => window.ichantool.setTool(tool), tool);
      box = await viewBox();
      await page.mouse.move(box.left + points[0][0], box.top + points[0][1]); await page.mouse.down();
      for (let k = 1; k < points.length; k++) {
        const [ax, ay] = points[k - 1], [bx, by] = points[k];
        for (let q = 1; q <= 5; q++) await page.mouse.move(box.left + ax + ((bx - ax) * q) / 5, box.top + ay + ((by - ay) * q) / 5);
      }
      await page.mouse.up(); await idle();
    };
    const objects = () => page.evaluate(() => [...window.ichantool.S.sections[window.ichantool.S.cur].objects.keys()]);
    await draw('brush', [[100, 200], [300, 200]]);
    await page.evaluate(() => { const { S } = window.ichantool; S.active = S.classes[1].id; S.selected = 0; });
    await draw('brush', [[200, 215], [400, 230]]);                     // overlaps the first stroke: stacks
    await page.evaluate(() => { const { S } = window.ichantool; S.active = S.classes[0].id; S.selected = 0; });
    await draw('erase', [[250, 200], [300, 200]]);
    await draw('exclude', [[100, 400], [200, 400]]);
    await draw('include', [[120, 400], [160, 400]]);
    await draw('lasso', [[100, 500], [260, 500], [260, 560], [100, 560]]);
    await draw('cut', [[180, 480], [180, 580]]);
    const ids = await objects();
    await page.evaluate((ids) => window.ichantool.mergeObjects(ids.slice(-2)), ids); await idle();
    await page.evaluate(() => { const { S } = window.ichantool; S.selected = 0; });
    await page.evaluate(() => window.ichantool.setTool('wand'));
    box = await viewBox();
    await page.mouse.click(box.left + 500, box.top + 700); await idle();
    await page.evaluate((id) => window.ichantool.assignClass(id, window.ichantool.S.classes[1].id), ids[0]); await idle();
    await page.evaluate((id) => window.ichantool.deleteObjects([id]), ids[1]); await idle();
    await page.click('#undoBtn'); await idle();
    await page.click('#redoBtn'); await idle();
    await page.click('#undoBtn'); await idle();
  };
  const dumpIn = (page, index) => page.evaluate((index) => {
    const s = window.ichantool.S.sections[index], width = s.tiled ? s.maskTiles.width : s.w, height = s.tiled ? s.maskTiles.height : s.h;
    const at = s.tiled ? (x, y) => s.maskTiles.labelAt(x, y) : (x, y) => s.labels[y * s.w + x];
    const exAt = s.tiled ? (x, y) => { const e = s.maskTiles.get(Math.floor(y / 512), Math.floor(x / 512)); return e?.exclude ? e.exclude[(y % 512) * 512 + (x % 512)] : 0; } : (x, y) => s.exclude[y * s.w + x];
    const names = (v) => (v === 0 ? '' : v > 0 ? String(v) : s.stacks[-v].slice().sort((a, b) => a - b).join('+'));
    const runs = [], exRuns = [];
    for (let y = 0; y < height; y++) {
      let last = '', start = 0, exLast = 0, exStart = 0;
      for (let x = 0; x <= width; x++) {
        const key = x < width ? names(at(x, y)) : null, ex = x < width ? exAt(x, y) : null;
        if (key !== last) { if (last !== '') runs.push([y, start, x, last]); last = key ?? ''; start = x; }
        if (ex !== exLast) { if (exLast) exRuns.push([y, exStart, x]); exLast = ex ?? 0; exStart = x; }
      }
    }
    const objects = [...s.objects.values()].map((o) => ({ id: o.id, cls: o.cls, pred: o.pred, conf: o.conf, area: o.area, bbox: o.bbox, stats: o.stats }));
    const stacks = s.stacks.map((m) => (m ? m.slice().sort((a, b) => a - b) : null));
    return { runs, exRuns, objects, usedStacks: [...new Set(runs.map((r) => r[3]).filter((n) => n.includes('+')))].sort(), stackCount: stacks.length, nextId: s.nextId };
  }, index);
  const dump = (index) => dumpIn(on.page, index);
  await script(wholeAt); await script(tiledAt);
  const whole = await dump(wholeAt), tiledDump = await dump(tiledAt);
  assert.ok(whole.runs.length > 50 && whole.exRuns.length > 0 && whole.usedStacks.length > 0 && whole.objects.length >= 2, 'the script made labels, exclusion and overlaps: ' + JSON.stringify({ r: whole.runs.length, e: whole.exRuns.length, s: whole.usedStacks, o: whole.objects.length }));
  assert.deepEqual(tiledDump.runs, whole.runs, 'labels are identical (overlap codes compared as sets of object ids)');
  assert.deepEqual(tiledDump.exRuns, whole.exRuns, 'exclusion is identical');
  assert.deepEqual(tiledDump.usedStacks, whole.usedStacks, 'the overlapping sets are identical');
  assert.equal(tiledDump.nextId, whole.nextId);
  assert.deepEqual(tiledDump.objects.map((o) => o.id), whole.objects.map((o) => o.id));
  const near = (a, b, what) => assert.ok(Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b)), `${what}: ${a} vs ${b}`);
  for (const [i, o] of whole.objects.entries()) {
    const t2 = tiledDump.objects[i];
    for (const key of ['cls', 'pred', 'conf', 'area', 'bbox']) assert.deepEqual(t2[key], o[key], `object ${o.id} ${key}`);
    assert.deepEqual(!!t2.stats, !!o.stats, `object ${o.id} has statistics`);
    for (const key of Object.keys(o.stats || {})) {
      if (['sL', 'sLL', 'rL'].includes(key)) near(t2.stats[key], o.stats[key], `object ${o.id} ${key}`); else assert.deepEqual(t2.stats[key], o.stats[key], `object ${o.id} stats.${key}`);
    }
  }
  // Card M8.4.17: the interval table. The tiled section counts its full-resolution tiles in the page; the whole section counts its labels. Same image,
  // same edits, same analysis area and classes, so every column of every bin is identical (the floating-point columns come from the same integers).
  const table = (index) => on.page.evaluate(async (index) => {
    const { S } = window.ichantool, s = S.sections[index];
    S.settings.binCm = 0.5; S.settings.minValid = 20;
    await window.ichantool.analyzeSections([s]);
    // The whole section is compared through the JavaScript calculation itself (`referenceBins`), not the engine's: with the engine experiment on, the
    // engine refuses this script's overlap table (INVALID_BUFFER, stack_members), which is noted in the roadmap under card M8.4.17.
    return { bins: JSON.parse(JSON.stringify(s.tiled ? s.bins : window.ichantool.referenceBins(s))), tiled: !!s.tiled, roi: s.roi };
  }, index);
  await on.page.evaluate(([a, b]) => { const { S } = window.ichantool, q = S.sections[a]; Object.assign(S.sections[b], { top: q.top, bottom: q.bottom, units: q.units }); }, [wholeAt, tiledAt]);   // the second section continues the core's depth: compare on the same depths
  const wholeTable = await table(wholeAt), tiledTable = await table(tiledAt);
  assert.ok(wholeTable.bins.length > 10 && wholeTable.bins.some((b) => b.pct > 0), 'the whole section has an interval table with bioturbation: ' + wholeTable.bins.length);
  assert.deepEqual(tiledTable.bins, wholeTable.bins, 'interval table: every column of every bin is identical');
  // a class change reaches the table with no tile read, an exclusion across tile seams too
  await on.page.evaluate((a, b) => { const { S } = window.ichantool; for (const k of [a, b]) { const s = S.sections[k]; for (const o of s.objects.values()) o.cls = S.classes[2].id; } }, wholeAt, tiledAt);
  const wholeClass = await table(wholeAt), tiledClass = await table(tiledAt);
  assert.deepEqual(tiledClass.bins, wholeClass.bins, 'interval table after a class change');
  assert.notDeepEqual(tiledClass.bins, tiledTable.bins, 'the class change changed the table');
  console.log('Interval table, whole against tiled:', tiledTable.bins.length, 'bins identical; after a class change identical too');

  // Card M8.4.18a: saving and reopening. The store keeps only the saved versions; the reopened section has the same masks, objects (with their
  // statistics, computed again from the tiles) and table; without its pyramid it is built again from the source; without both it opens grey and locked.
  await on.page.evaluate((index) => { window.__tiledId = window.ichantool.S.sections[index].id; }, tiledAt);   // the edited tiled section (both tiled sections are 620 wide)
  const manifestsOnDisk = async () => {
    const project = await on.page.evaluate(() => window.ichantool.storeProject());
    const folder = path.join(on.profile, 'projects', project, 'tiles', 'manifests');
    return fs.existsSync(folder) ? fs.readdirSync(folder).filter((f) => /^[0-9a-f]{64}\.json$/.test(f)).map((f) => f.slice(0, 64)).sort() : [];
  };
  // Card M8.4.35: when the section is not there after the load, the reason goes into the failure message (a failed load, its message, and
  // what the stored project holds), since the failure seen on GitHub (`grey: null`) did not say why.
  const reopenFailures = [];
  const reopen = async () => {
    const got = await on.page.evaluate(async () => {
      const { getProject } = await import(new URL('js/storage.js', location.href).href), id = window.ichantool.S.id, stored = await getProject(id);
      const errors = [], log = console.error;
      console.error = (...args) => { errors.push(args.map((a) => String(a?.stack || a?.message || a)).join(' ').slice(0, 600)); log(...args); };
      let loaded;
      try { loaded = await window.ichantool.loadProject(stored); } finally { console.error = log; }
      for (let i = 0; i < 2400 && !(window.ichantool.tiledStatsIdle() && window.ichantool.tiledCountsIdle()); i++) await new Promise((r) => setTimeout(r, 50));
      const s = window.ichantool.S.sections.find((q) => q.id === window.__tiledId);
      const result = { frozen: s?.frozen ?? null, missing: !!s?.tiled?.missing, grey: s ? s.orig.subarray(0, 400).every((v, i) => (i % 4 === 3 ? v === 255 : v === 128)) : null };
      return s ? { result } : { result, why: { loaded, errors, toast: document.getElementById('toast')?.textContent ?? '', id, sameId: window.ichantool.S.id === id,
        storedSections: stored?.cores?.flatMap((c) => c.sections.map((q) => q.id + (q.tiled ? ':tiled' : ''))) ?? null, sections: window.ichantool.S.sections.map((q) => q.id) } };
    });
    if (got.why) { reopenFailures.push(got.why); console.error('reopen: the tiled section is not there:', JSON.stringify(got.why)); }
    return got.result;
  };
  const sameAsSaved = async (label) => {
    const index = await on.page.evaluate(() => window.ichantool.S.sections.findIndex((q) => q.id === window.__tiledId));
    await on.page.evaluate((i) => window.ichantool.tiledMasksLoad(i), index);      // reopened from the cache, the stored tiles are not in the page yet
    const after = await dump(index), afterTable = await table(index);
    assert.deepEqual(after.runs, beforeSave.runs, label + ': labels'); assert.deepEqual(after.exRuns, beforeSave.exRuns, label + ': exclusion');
    assert.deepEqual(after.usedStacks, beforeSave.usedStacks, label + ': overlaps'); assert.equal(after.nextId, beforeSave.nextId, label + ': nextId');
    assert.deepEqual(after.objects.map((o) => [o.id, o.cls, o.area, o.bbox]), beforeSave.objects.map((o) => [o.id, o.cls, o.area, o.bbox]), label + ': objects');
    for (const [i, o] of beforeSave.objects.entries()) {             // recomputed from the tiles: equal, with the tolerance of the M8.4.16 block for three float sums
      const got = after.objects[i].stats || {};
      assert.deepEqual(Object.keys(got).sort(), Object.keys(o.stats || {}).sort(), label + `: statistics of ${o.id}`);
      for (const key of Object.keys(o.stats || {})) {
        if (['sL', 'sLL', 'rL'].includes(key)) assert.ok(Math.abs(got[key] - o.stats[key]) <= 1e-12 * Math.max(1, Math.abs(got[key]), Math.abs(o.stats[key])), `${label}: ${o.id} ${key}`);
        else assert.deepEqual(got[key], o.stats[key], `${label}: ${o.id} stats.${key}`);
      }
    }
    assert.deepEqual(afterTable.bins, beforeTable.bins, label + ': interval table');
    return index;
  };
  const tiledIndex = await on.page.evaluate(() => window.ichantool.S.sections.findIndex((q) => q.id === window.__tiledId));
  // Card M8.4.29: the reopening cache is written after a save in which every statistic and count is current, and read when the section is opened.
  await on.page.waitForFunction(() => window.ichantool.tiledStatsIdle() && window.ichantool.tiledCountsIdle(), { polling: 200, timeout: 600000 });
  await on.page.evaluate(() => window.ichantool.saveNow());
  const beforeSave = await dump(tiledIndex), beforeTable = await table(tiledIndex);
  const savedManifests = await on.page.evaluate(() => window.ichantool.tiledSaved());
  assert.deepEqual(await manifestsOnDisk(), [...new Set(savedManifests)].sort(), 'after a save the store holds only the saved versions');
  const sectionState = () => on.page.evaluate(() => { const q = window.ichantool.S.sections.find((x) => x.id === window.__tiledId); return { saved: q._savedRecord?.tiled?.manifest, cached: q._reopenCached ?? null }; });
  const cacheFile = async () => path.join(on.profile, 'projects', await on.page.evaluate(() => window.ichantool.storeProject()), 'tiles', 'derived', `${(await sectionState()).saved}.reopen`);
  const waitForCache = async (file) => {
    for (let i = 0; i < 600 && !fs.existsSync(file); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(fs.existsSync(file), 'the reopening cache was written after the save: ' + file + ' ' + JSON.stringify(fs.existsSync(path.dirname(file)) ? fs.readdirSync(path.dirname(file)) : 'no folder') + JSON.stringify(await on.page.evaluate(() => {
      const q = window.ichantool.S.sections.find((x) => x.id === window.__tiledId);
      return { sync: q._maskSync && { settled: q._maskSync.settled, manifest: q._maskSync.manifest }, saved: q._savedRecord?.tiled?.manifest, idle: q._statsRunner?.idle, failed: q._statsRunner?.failed.size,
        ready: q._counts?.counts.ready, writing: q._reopenWriting, cached: q._reopenCached, frozen: q.frozen };
    })));
  };
  const cachePath = await cacheFile();
  await waitForCache(cachePath);
  assert.deepEqual(await reopen(), { frozen: null, missing: false, grey: false });
  assert.equal((await sectionState()).cached, (await sectionState()).saved, 'the section was reopened from the cache');
  await sameAsSaved('reopened');
  // A damaged cache is refused whole: the section is rebuilt from its tiles, equal to what was saved, and the next save writes the cache again
  // (rebuilding may commit a new version, so the file of the version saved afterwards is the one to look for).
  const damaged = fs.readFileSync(cachePath);
  damaged[Math.floor(damaged.length / 2)] ^= 0xff; fs.writeFileSync(cachePath, damaged);
  assert.deepEqual(await reopen(), { frozen: null, missing: false, grey: false });
  assert.equal((await sectionState()).cached, null, 'the damaged cache was not used');
  await sameAsSaved('damaged cache');
  await on.page.evaluate(() => window.ichantool.saveNow());
  await waitForCache(await cacheFile());
  assert.deepEqual(await reopen(), { frozen: null, missing: false, grey: false });
  assert.equal((await sectionState()).cached, (await sectionState()).saved, 'reopened from the cache written again');
  await sameAsSaved('cache written again');
  fs.rmSync(await cacheFile());                                     // no cache at all: the same result from the tiles
  assert.deepEqual(await reopen(), { frozen: null, missing: false, grey: false });
  assert.equal((await sectionState()).cached, null, 'no cache, none used');
  await sameAsSaved('no cache');
  await on.page.evaluate(() => window.ichantool.saveNow());
  await waitForCache(await cacheFile());
  assert.deepEqual(await reopen(), { frozen: null, missing: false, grey: false });
  assert.equal((await sectionState()).cached, (await sectionState()).saved, 'reopened from the cache written after a reopening without one');
  console.log('Reopening cache: written after the save, used on reopening with identical masks, objects and table; a damaged one is refused and rebuilt');
  const pyramid = await on.page.evaluate(() => window.ichantool.S.sections.find((q) => q.id === window.__tiledId).tiled.pyramid);
  fs.rmSync(path.join(on.profile, 'pyramids', pyramid), { recursive: true, force: true });
  assert.deepEqual(await reopen(), { frozen: null, missing: false, grey: false });
  assert.ok(fs.existsSync(path.join(on.profile, 'pyramids', pyramid, 'pyramid.json')), 'the pyramid was built again from the source');
  await sameAsSaved('pyramid rebuilt');
  const moved = lossless + '.moved';
  fs.renameSync(lossless, moved);
  fs.rmSync(path.join(on.profile, 'pyramids', pyramid), { recursive: true, force: true });
  assert.deepEqual(await reopen(), { frozen: 'source', missing: true, grey: true }, 'no pyramid and no source: grey and locked');
  const lockedIndex = await sameAsSaved('source missing');
  const nextBefore = await on.page.evaluate((index) => { window.ichantool.S.cur = index; window.ichantool.selectSection(index); const before = window.ichantool.S.sections[index].nextId; window.ichantool.setTool('brush'); return before; }, lockedIndex);
  const viewBox = await on.page.evaluate(() => { const r = document.getElementById('view').getBoundingClientRect(); return { left: r.left, top: r.top }; });
  await on.page.mouse.move(viewBox.left + 300, viewBox.top + 300); await on.page.mouse.down(); await on.page.mouse.move(viewBox.left + 340, viewBox.top + 300); await on.page.mouse.up();
  assert.equal(await on.page.evaluate((index) => window.ichantool.S.sections[index].nextId, lockedIndex), nextBefore, 'a locked section is not edited');
  // Card M8.4.18b: the section's form says the image is missing and offers to locate it. Another file of the same size is refused by its SHA-256
  // (nothing built); the moved file is accepted and the section opens with its pixels, unlocked and identical to the saved one. Then the image is
  // copied into the project, and with the original and the pyramid gone the section is reopened from the copy.
  const panel = (want) => on.page.evaluate(async (want) => {
    const read = () => ({ hidden: document.getElementById('secSource').hidden, note: document.getElementById('secSourceNote').textContent,
      locate: !document.getElementById('secLocateLabel').hidden, copy: !document.getElementById('secCopySource').hidden });
    for (let i = 0; i < 200 && !(read().note && read().locate === want.locate && read().copy === want.copy); i++) await new Promise((r) => setTimeout(r, 50));
    return read();
  }, want);
  let shown = await panel({ locate: true, copy: false });
  assert.ok(!shown.hidden && shown.locate && !shown.copy && /no se encuentra|cannot be found/i.test(shown.note), 'missing image: locate offered: ' + JSON.stringify(shown));
  const impostor = lossless + '.other.png', bytes = fs.readFileSync(moved);
  bytes[bytes.length - 5] ^= 0xff;                                        // same size, other bytes (in the last chunk's checksum)
  fs.writeFileSync(impostor, bytes);
  const toastsBefore = toasts.length;
  await (await on.page.$('#secLocate')).uploadFile(impostor);
  const refusedText = () => toasts.slice(toastsBefore).find((text) => /no es la imagen original|not the original image/i.test(text));
  for (let i = 0; i < 1200 && !refusedText(); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(refusedText(), 'another file is refused: ' + JSON.stringify(toasts.slice(toastsBefore)));
  assert.equal(await on.page.evaluate(() => window.ichantool.S.sections.find((q) => q.id === window.__tiledId).frozen), 'source', 'still locked');
  assert.ok(!fs.existsSync(path.join(on.profile, 'pyramids', pyramid)), 'nothing was built from the other file');
  fs.rmSync(impostor);
  await (await on.page.$('#secLocate')).uploadFile(moved);
  await on.page.waitForFunction(() => { const s = window.ichantool.S.sections.find((q) => q.id === window.__tiledId); return s && !s.frozen && window.ichantool.tiledStatsIdle() && window.ichantool.tiledCountsIdle(); }, { timeout: 240000, polling: 100 });
  const locatedIndex = await sameAsSaved('located');
  assert.equal(await on.page.evaluate((index) => window.ichantool.S.sections[index].orig.subarray(0, 400).every((v, i) => (i % 4 === 3 ? v === 255 : v === 128)), locatedIndex), false, 'the located section shows its image');
  assert.equal(await on.page.evaluate(() => /** @type {HTMLInputElement} */ (document.getElementById('secName')).disabled), false, 'the located section can be edited');
  shown = await panel({ locate: false, copy: true });
  assert.ok(shown.copy && /sigue en su sitio|still in its place/i.test(shown.note), 'the original is found again; copy offered: ' + JSON.stringify(shown));
  const project = await on.page.evaluate(() => window.ichantool.storeProject());
  let asked = '';
  on.page.once('dialog', (dialog) => { asked = dialog.message(); });          // accepted by the handler of `program()`
  await on.page.click('#secCopySource');
  shown = await panel({ locate: false, copy: false });
  assert.match(asked, /libre|free/i, 'the size and the free space are shown first');
  assert.ok(/propia copia|own copy/i.test(shown.note), 'the project holds a copy: ' + JSON.stringify(shown));
  const copies = fs.readdirSync(path.join(on.profile, 'projects', project, 'sources'));
  assert.deepEqual(copies, [pyramid + '.png'], 'one copy, named by its SHA-256');
  assert.ok(fs.readFileSync(path.join(on.profile, 'projects', project, 'sources', copies[0])).equals(fs.readFileSync(moved)), 'the copy is the image');
  fs.renameSync(moved, moved + '.away');
  fs.rmSync(path.join(on.profile, 'pyramids', pyramid), { recursive: true, force: true });
  assert.deepEqual(await reopen(), { frozen: null, missing: false, grey: false }, 'reopened from the copy');
  await sameAsSaved('from the copy');
  fs.renameSync(moved + '.away', lossless);
  // D1: the engine cannot take the last edits: the rest is saved and the section keeps its saved version.
  assert.deepEqual(await reopen(), { frozen: null, missing: false, grey: false });
  const d1 = await on.page.evaluate(async () => {
    const { S } = window.ichantool, index = S.sections.findIndex((q) => q.id === window.__tiledId), s = S.sections[index];
    window.ichantool.selectSection(index);
    const before = window.ichantool.tiledSaved();
    window.ichantool.stopMaskSync();                                      // nothing reaches the store any more
    window.ichantool.putMaskTile(2, 0, new Int32Array(512 * 512).fill(s.nextId - 1), null);
    window.ichantool.settleDeadline(500);
    S.name = S.name + ' (renamed)';
    await window.ichantool.saveNow();
    window.ichantool.settleDeadline(15000);
    const { getProject } = await import(new URL('js/storage.js', location.href).href), stored = await getProject(S.id);
    return { before, after: window.ichantool.tiledSaved(), name: stored.name, record: stored.cores.flatMap((c) => c.sections).filter((q) => q.tiled).map((q) => q.tiled.manifest) };
  });
  assert.deepEqual(d1.after, d1.before, 'D1: the section keeps its saved version');
  assert.ok(d1.name.endsWith('(renamed)'), 'D1: the rest of the project was saved');
  assert.ok(d1.record.includes(d1.before.find((m) => m)), 'D1: the stored record names the saved version');
  assert.ok(toasts.some((text) => /almac|store/i.test(text)), 'D1: the user is told the large section was not saved');
  assert.deepEqual(await reopen(), { frozen: null, missing: false, grey: false });
  await sameAsSaved('after D1');
  // Card M8.4.35: a save still waiting for a tiled section when a project is opened writes nothing: it used to write the half-loaded project over the
  // stored one (GitHub, Linux and macOS, November 2026: the stored project had no section left, and the next reopening found none).
  const raced = await on.page.evaluate(async () => {
    const { getProject, getMeta } = await import(new URL('js/storage.js', location.href).href), id = window.ichantool.S.id;
    const before = await getProject(id), metaBefore = await getMeta(id), count = (d) => d.cores.flatMap((c) => c.sections).length;
    const index = window.ichantool.S.sections.findIndex((q) => q.id === window.__tiledId), s = window.ichantool.S.sections[index];
    window.ichantool.selectSection(index);
    window.ichantool.stopMaskSync();                                      // the section cannot settle: the save waits for its deadline
    window.ichantool.putMaskTile(2, 0, new Int32Array(512 * 512).fill(s.nextId - 1), null);
    window.ichantool.settleDeadline(2000);
    const saving = window.ichantool.saveNow();
    await new Promise((r) => setTimeout(r, 300));
    const opening = window.ichantool.loadProject(before);                 // opened while the save waits
    await Promise.all([saving, opening]);
    window.ichantool.settleDeadline(15000);
    const after = await getProject(id), metaAfter = await getMeta(id);
    return { sections: [count(before), count(after)], unchanged: JSON.stringify(after) === JSON.stringify(before), written: metaAfter.updated !== metaBefore.updated };
  });
  assert.deepEqual(raced, { sections: [raced.sections[0], raced.sections[0]], unchanged: true, written: false }, 'a save overtaken by an opening writes nothing');
  assert.deepEqual(await reopen(), { frozen: null, missing: false, grey: false });
  await sameAsSaved('after a save overtaken by an opening');
  // D2: the same project in a program without tiled sections: a placeholder whose record is saved back byte for byte.
  projectRecord = await on.page.evaluate(async () => { const { getProject } = await import(new URL('js/storage.js', location.href).href); return JSON.parse(JSON.stringify(await getProject(window.ichantool.S.id))); });
  console.log('Saving and reopening: identical masks, objects and table after a reopen, a rebuilt pyramid and a missing source (grey, locked); the moved image located (another file refused), copied into the project and reopened from the copy; D1 keeps the saved version');
  // Card M8.4.18c: the folder backup carries the tiled section: the files of its version are written once, by name (a second backup rewrites none of
  // them); a restore in another program with an empty store (another computer: another profile) opens it with identical masks and objects; a damaged
  // file of the folder refuses the section, which opens locked. The folder is a directory of the origin's private file system (as a chosen folder).
  const backupFiles = (page, folder) => page.evaluate(async (folder) => {
    const b64 = (bytes) => { let text = ''; for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 32768))); return btoa(text); };
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(folder, { create: true });
    await window.ichantool.projectFolderTo(dir);
    const out = {};
    const walk = async (handle, prefix) => {
      for await (const [name, child] of handle.entries()) {
        if (child.kind === 'directory') await walk(child, prefix + name + '/');
        else { const file = await child.getFile(); out[prefix + name] = { modified: file.lastModified, b64: b64(new Uint8Array(await file.arrayBuffer())) }; }
      }
    };
    await walk(dir, '');
    return out;
  }, folder);
  const backupTiledId = await on.page.evaluate(() => window.__tiledId);
  const firstBackup = await backupFiles(on.page, 'backup-m8418c');
  const backupFolderName = Object.keys(firstBackup).find((name) => name.endsWith('/project.json')).split('/')[0];
  const backupProject = JSON.parse(Buffer.from(firstBackup[backupFolderName + '/project.json'].b64, 'base64').toString('utf8'));
  const backedTiled = backupProject.cores.flatMap((c) => c.sections).filter((q) => q.tiled);
  assert.ok(backedTiled.some((q) => q.id === backupTiledId) && !backupProject.left_out, 'the backup keeps its tiled sections: ' + JSON.stringify(backupProject.left_out ?? null));
  const versionFiles = Object.keys(firstBackup).filter((name) => name.startsWith(backupFolderName + '/tiles/') || name.startsWith(backupFolderName + '/manifests/'));
  for (const q of backedTiled) assert.ok(firstBackup[`${backupFolderName}/manifests/${q.tiled.manifest}.json`], 'the version of ' + q.id + ' is in the folder');
  assert.ok(versionFiles.some((name) => name.includes('/tiles/')), 'its tiles are in the folder');
  // Step 3: the image the project keeps (copied into it above) is in the folder once, named by its SHA-256, and the user was told its size.
  const sourceFile = `${backupFolderName}/sources/${pyramid}`;
  assert.ok(firstBackup[sourceFile] && Buffer.from(firstBackup[sourceFile].b64, 'base64').equals(fs.readFileSync(lossless)), 'the image of the project is in the folder');
  assert.ok(toasts.some((text) => /imagen original|original image/.test(text)), 'the user was told before the image was copied');
  const secondBackup = await backupFiles(on.page, 'backup-m8418c');
  for (const name of [...versionFiles, sourceFile]) assert.equal(secondBackup[name].modified, firstBackup[name].modified, 'not written again: ' + name);
  const expectedRestore = beforeSave;
  // Card M8.4.18d: the package of the project carries the tiled versions and, the user agreeing (the dialog is accepted), the image the project keeps.
  const packaged = Buffer.from(await on.page.evaluate(async () => {
    const bytes = new Uint8Array(await (await window.ichantool.packageBlob()).arrayBuffer());
    let text = ''; for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 32768)));
    return btoa(text);
  }), 'base64');
  const { unzipBlob } = await import(new URL('../../app/js/zip.js', import.meta.url).href);
  const packageMembers = await unzipBlob(new Blob([packaged]));
  const packagedProject = JSON.parse(await (await packageMembers.get('project.json').get()).text());
  assert.ok(!packagedProject.left_out && packagedProject.cores.flatMap((c) => c.sections).some((q) => q.id === backupTiledId), 'the package keeps the tiled sections');
  for (const q of backedTiled) assert.ok(packageMembers.has(`manifests/${q.tiled.manifest}.json`), 'the package holds the version of ' + q.id);
  assert.ok(packageMembers.has(`sources/${pyramid}`) && Buffer.from(await (await packageMembers.get(`sources/${pyramid}`).get()).arrayBuffer()).equals(fs.readFileSync(lossless)), 'and the image');
  const other = await program(true);
  try {
    const otherToasts = [];
    await other.page.exposeFunction('tiledToast', (text) => otherToasts.push(text));
    await other.page.evaluate(() => new MutationObserver(() => { const el = document.getElementById('toast'); if (el && !el.hidden) window.tiledToast(el.textContent); })
      .observe(document.getElementById('toast'), { attributes: true, childList: true, subtree: true, characterData: true }));
    const restoreIn = (files, folder, id, chooser = false) => other.page.evaluate(async (files, folder, folderName, id, chooser) => {
      const top = await (await navigator.storage.getDirectory()).getDirectoryHandle(folder, { create: true });
      for (const [name, file] of Object.entries(files)) {
        const parts = name.split('/');
        let dir = top;
        for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
        const writable = await (await dir.getFileHandle(parts.at(-1), { create: true })).createWritable();
        await writable.write(Uint8Array.from(atob(file.b64), (c) => c.charCodeAt(0))); await writable.close();
      }
      const projectFolder = await top.getDirectoryHandle(folderName);
      const record = JSON.parse(chooser ? await window.ichantool.chooseFolderVersion(projectFolder) : await (await (await projectFolder.getFileHandle('project.json')).getFile()).text());
      if (id) { record.id = id; record.name += ' (damaged copy)'; }
      await window.ichantool.restoreFolders([{ folder: projectFolder, text: JSON.stringify(record) }]);
      for (let i = 0; i < 2400 && !(window.ichantool.tiledStatsIdle() && window.ichantool.tiledCountsIdle()); i++) await new Promise((r) => setTimeout(r, 50));
      const index = window.ichantool.S.sections.findIndex((q) => q.id === window.__tiledId);
      return { index, id: window.ichantool.S.id, frozen: index < 0 ? 'absent' : (window.ichantool.S.sections[index].frozen ?? null), manifest: window.ichantool.S.sections[index]?._savedRecord?.tiled?.manifest ?? null,
        seen: { name: window.ichantool.S.name, sections: window.ichantool.S.sections.map((q) => q.id), record: record.id, recordSections: record.cores?.flatMap((c) => c.sections.map((q) => q.id)) } };
    }, files, folder, backupFolderName, id, chooser);
    await other.page.evaluate((id) => { window.__tiledId = id; }, backupTiledId);
    // The package opened on another computer (empty profile): the section with its image and the same masks and objects.
    const fromPackage = await other.page.evaluate(async (b64) => {
      await window.ichantool.restoreFiles([new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'project.sedcoretool')]);
      for (let i = 0; i < 2400 && !(window.ichantool.tiledStatsIdle() && window.ichantool.tiledCountsIdle()); i++) await new Promise((r) => setTimeout(r, 50));
      const index = window.ichantool.S.sections.findIndex((q) => q.id === window.__tiledId), s = window.ichantool.S.sections[index];
      return { index, frozen: index < 0 ? 'absent' : (s.frozen ?? null), grey: s ? s.orig.subarray(0, 400).every((v, i) => (i % 4 === 3 ? v === 255 : v === 128)) : null };
    }, packaged.toString('base64'));
    assert.deepEqual([fromPackage.frozen, fromPackage.grey], [null, false], 'the package opens with its image: ' + JSON.stringify({ fromPackage, toasts: otherToasts.slice(-4) }));
    await other.page.evaluate((index) => window.ichantool.tiledMasksLoad(index), fromPackage.index);
    const fromPackageDump = await dumpIn(other.page, fromPackage.index);
    assert.deepEqual([fromPackageDump.runs, fromPackageDump.exRuns, fromPackageDump.nextId], [expectedRestore.runs, expectedRestore.exRuns, expectedRestore.nextId], 'masks from the package identical');
    assert.deepEqual(fromPackageDump.objects.map((o) => [o.id, o.cls, o.area, o.bbox]), expectedRestore.objects.map((o) => [o.id, o.cls, o.area, o.bbox]), 'objects from the package identical');
    // A damaged tile: the section's version is refused whole and it opens locked; the user is told which tile.
    const ownVersion = backedTiled.find((q) => q.id === backupTiledId).tiled.manifest;
    const ownTiles = Object.values(JSON.parse(Buffer.from(firstBackup[`${backupFolderName}/manifests/${ownVersion}.json`].b64, 'base64').toString('ascii')).tiles);
    const damagedFiles = structuredClone(firstBackup), victim = `${backupFolderName}/tiles/${ownTiles[0].labels ?? ownTiles[0].exclude}`;
    const victimBytes = Buffer.from(damagedFiles[victim].b64, 'base64'); victimBytes[Math.floor(victimBytes.length / 2)] ^= 0xff;
    damagedFiles[victim].b64 = victimBytes.toString('base64');
    const damagedRestore = await restoreIn(damagedFiles, 'restore-damaged', 'e2e-damaged-copy');
    assert.equal(damagedRestore.frozen, 'store', 'a damaged file of the folder: the section opens locked');
    assert.ok(otherToasts.some((text) => /no se han restaurado|were not restored/.test(text)), 'the user is told: ' + JSON.stringify(otherToasts));
    assert.ok(!fs.existsSync(path.join(other.profile, 'projects', 'e2e-damaged-copy', 'tiles', 'manifests', damagedRestore.manifest + '.json')), 'never a partial version in the store');
    // The intact folder, opened at the day of its history (the dialog of «Open project folder»): every version back in the empty store, the
    // project's image back into the project, and the section opens with its image and the same masks.
    const day = Object.keys(firstBackup).find((name) => name.startsWith(backupFolderName + '/historial/')).slice(-15, -5);
    const restoring = restoreIn(firstBackup, 'restore-good', null, true);
    await other.page.waitForSelector('#folderVersion', { timeout: 120000 });
    assert.deepEqual(await other.page.$$eval('#folderVersion option', (options) => options.map((o) => o.value)), ['', day], 'the last save and the day of the history');
    await other.page.select('#folderVersion', day);
    await other.page.click('#folderVersionOpen');
    const restored = await restoring;
    assert.equal(restored.manifest, backedTiled.find((q) => q.id === backupTiledId).tiled.manifest);
    assert.equal(restored.frozen, null, 'restored on another computer with its image: ' + JSON.stringify({ seen: restored.seen, tiledId: backupTiledId, historyIsProject: firstBackup[`${backupFolderName}/historial/${day}.json`].b64 === firstBackup[`${backupFolderName}/project.json`].b64, historySections: JSON.parse(Buffer.from(firstBackup[`${backupFolderName}/historial/${day}.json`].b64, 'base64').toString('utf8')).cores.flatMap((c) => c.sections.map((q) => q.id)) }));
    assert.equal(await other.page.evaluate((index) => window.ichantool.S.sections[index].orig.subarray(0, 400).every((v, i) => (i % 4 === 3 ? v === 255 : v === 128)), restored.index), false, 'not grey');
    const store = await other.page.evaluate(() => window.ichantool.storeProject());
    for (const q of backedTiled) assert.ok(fs.existsSync(path.join(other.profile, 'projects', store, 'tiles', 'manifests', q.tiled.manifest + '.json')), 'version restored into the store: ' + q.id);
    assert.ok(fs.readFileSync(path.join(other.profile, 'projects', store, 'sources', pyramid + '.png')).equals(fs.readFileSync(lossless)), 'the image is the copy of the project again');
    await other.page.evaluate((index) => window.ichantool.tiledMasksLoad(index), restored.index);
    const got = await dumpIn(other.page, restored.index);
    assert.deepEqual([got.runs, got.exRuns, got.usedStacks, got.nextId], [expectedRestore.runs, expectedRestore.exRuns, expectedRestore.usedStacks, expectedRestore.nextId], 'restored masks identical');
    assert.deepEqual(got.objects.map((o) => [o.id, o.cls, o.area, o.bbox]), expectedRestore.objects.map((o) => [o.id, o.cls, o.area, o.bbox]), 'restored objects identical');
    assert.deepEqual(other.errors, []);
  } finally { await other.close(); }
  console.log(`Folder backup: ${versionFiles.length} files of tiled versions written once (a second backup rewrote none); restored in another profile (at a day of its history, chosen in the dialog) with identical masks and objects and its image; a damaged tile refused the section (locked); the package (${packaged.length} bytes, versions and image) opened there identically`);
  // Card M8.4.27: the store folder follows its project. (1) A missing stored version: the project opens, the section is locked and says so, its
  // record is saved back unchanged, the rest is edited and saved; with the version back it opens as before.
  const storeFolder = async (id = null) => path.join(on.profile, 'projects', await on.page.evaluate((id) => window.ichantool.storeProject(id), id));
  const tiledId = await on.page.evaluate(() => window.__tiledId);
  const savedTiled = JSON.stringify(projectRecord.cores.flatMap((c) => c.sections).find((q) => q.id === tiledId));
  const manifestFile = path.join(await storeFolder(), 'tiles', 'manifests', JSON.parse(savedTiled).tiled.manifest + '.json');
  fs.renameSync(manifestFile, manifestFile + '.away');
  await on.page.evaluate(() => window.corantoolDesktop.engine.restart());   // the engine keeps recent versions in memory: as after a new start
  const toastsBeforeLock = toasts.length;
  assert.deepEqual(await reopen(), { frozen: 'store', missing: false, grey: false }, 'a missing stored version locks the section');
  assert.ok(toasts.slice(toastsBeforeLock).some((text) => /faltan o están dañadas|missing or damaged/i.test(text)), 'the user is told: ' + JSON.stringify(toasts.slice(toastsBeforeLock)));
  const lockedSave = await on.page.evaluate(async () => {
    const { S } = window.ichantool, all = S.cores.flatMap((c) => c.sections), s = all.find((q) => q.id === window.__tiledId), other = all.find((q) => !q.tiled);
    other.name += ' (edited)';
    await window.ichantool.saveNow();
    const stored = (await (await import(new URL('js/storage.js', location.href).href)).getProject(S.id)).cores.flatMap((c) => c.sections);
    return { bins: s.bins.length, other: stored.find((q) => q.id === other.id).name, tiled: JSON.stringify(stored.find((q) => q.id === window.__tiledId)) };
  });
  assert.equal(lockedSave.bins, 0, 'no table without masks');
  assert.ok(lockedSave.other.endsWith('(edited)'), 'the rest of the project is edited and saved');
  assert.equal(lockedSave.tiled, savedTiled, 'the locked section is saved back as it was read');
  fs.renameSync(manifestFile + '.away', manifestFile);
  assert.deepEqual(await reopen(), { frozen: null, missing: false, grey: false });
  await sameAsSaved('stored version back');
  // (2) The same project imported again (a file without its tiled section) and both versions kept: the local version becomes a copy under a new
  // identifier that has its own stored versions, opens identical, and a save of the imported one does not remove them.
  const projectsBefore = await on.page.evaluate(async () => (await (await import(new URL('js/storage.js', location.href).href)).listProjects()).map((m) => m.id));
  const sameProject = path.join(os.tmpdir(), `sedcoretool-same-project-${process.pid}.json`);
  fs.writeFileSync(sameProject, await on.page.evaluate(async () => {
    const record = await (await import(new URL('js/storage.js', location.href).href)).getProject(window.ichantool.S.id);
    return JSON.stringify({ ...record, cores: record.cores.map((c) => ({ ...c, sections: c.sections.filter((q) => !q.tiled) })) });
  }));
  await (await on.page.$('#impProj')).uploadFile(sameProject);
  await on.page.waitForFunction(async (n) => (await (await import(new URL('js/storage.js', location.href).href)).listProjects()).length > n && document.getElementById('busy').hidden,
    { timeout: 240000, polling: 200 }, projectsBefore.length);
  fs.rmSync(sameProject);
  const keptId = (await on.page.evaluate(async () => (await (await import(new URL('js/storage.js', location.href).href)).listProjects()).map((m) => m.id))).find((id) => !projectsBefore.includes(id));
  const keptFolder = await storeFolder(keptId);
  assert.ok(fs.existsSync(manifestFile.replace(await storeFolder(), keptFolder)), 'the kept copy has its own stored version');
  await on.page.evaluate(() => window.ichantool.saveNow());                // the imported project (no tiled section) is saved
  await on.page.evaluate(async (id) => window.ichantool.loadProject(await (await import(new URL('js/storage.js', location.href).href)).getProject(id)), keptId);
  for (let i = 0; i < 2400 && !(await on.page.evaluate(() => window.ichantool.tiledStatsIdle() && window.ichantool.tiledCountsIdle())); i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(await on.page.evaluate(() => { const s = window.ichantool.S.sections.find((q) => q.id === window.__tiledId); return s ? s.frozen ?? null : 'absent'; }), null, 'the kept copy opens unlocked');
  await sameAsSaved('kept copy');
  // Card M8.4.28 (on the kept copy, deleted below): reopened, an object spanning two tiles is deleted at once, without "try again": its tiles are
  // computed first. Masks, objects and table then equal those of the same deletion made with every statistic current (undone, done again).
  const toastsBeforeQuick = toasts.length, tBusy = await on.page.evaluate(() => window.ichantool.t('tiles.busy'));
  const quick = await on.page.evaluate(async () => {
    const { S } = window.ichantool, { getProject } = await import(new URL('js/storage.js', location.href).href);
    await window.ichantool.loadProject(await getProject(S.id));
    const index = S.sections.findIndex((q) => q.id === window.__tiledId), s = S.sections[index];
    window.ichantool.selectSection(index);
    const tile = (v) => Math.floor(v / 512), spans = (o) => o.stats && (tile(o.stats.x0) !== tile(o.stats.x1) || tile(o.stats.y0) !== tile(o.stats.y1));
    const target = [...s.objects.values()].filter(spans).sort((a, b) => a.area - b.area)[0];
    if (!target) return { target: null };
    const waitingAtStart = s._statsRunner.pending.size, started = performance.now();
    window.ichantool.deleteObjects([target.id]);
    for (let i = 0; i < 2400 && s.objects.has(target.id); i++) await new Promise((r) => setTimeout(r, 25));
    return { target: target.id, index, waitingAtStart, deleted: !s.objects.has(target.id), ms: Math.round(performance.now() - started), waitingAfter: s._statsRunner.pending.size };
  });
  assert.ok(quick.target, 'the saved section has an object spanning two tiles');
  assert.ok(quick.waitingAtStart > 0 && quick.deleted, 'deleted while the reopening\'s tiles were waiting: ' + JSON.stringify(quick));
  const sectionIdle = () => on.page.waitForFunction(() => window.ichantool.tiledStatsIdle() && window.ichantool.tiledCountsIdle() && window.ichantool.masksSettled(), { polling: 50, timeout: 240000 });
  await sectionIdle();
  const quickDump = await dump(quick.index), quickTable = await table(quick.index);
  await on.page.click('#undoBtn');
  await on.page.waitForFunction((id) => window.ichantool.S.sections.find((q) => q.id === window.__tiledId).objects.has(id), { polling: 50, timeout: 60000 }, quick.target);
  await sectionIdle();
  const atOnce = await on.page.evaluate((id) => { const s = window.ichantool.S.sections.find((q) => q.id === window.__tiledId); window.ichantool.deleteObjects([id]); return !s.objects.has(id); }, quick.target);
  assert.ok(atOnce, 'with every statistic current the delete runs at once');
  await sectionIdle();
  const slowDump = await dump(quick.index), slowTable = await table(quick.index);
  assert.deepEqual(quickDump, slowDump, 'masks and objects (with their statistics) equal those of the deletion made with every statistic current');
  assert.deepEqual(quickTable.bins, slowTable.bins, 'interval table too');
  assert.ok(!quickDump.objects.some((o) => o.id === quick.target));
  // The same deletion after the page dropped the clean mask tiles: they are read back in the same wait, without "try again".
  await on.page.click('#undoBtn');
  await on.page.waitForFunction((id) => window.ichantool.S.sections.find((q) => q.id === window.__tiledId).objects.has(id), { polling: 50, timeout: 60000 }, quick.target);
  await sectionIdle();
  const tLoading = await on.page.evaluate(() => window.ichantool.t('tiles.loadingMasks'));
  const dropped = await on.page.evaluate((id) => {
    const s = window.ichantool.S.sections.find((q) => q.id === window.__tiledId), budget = s.maskTiles.budget;
    s.maskTiles.budget = 0; const n = s.maskTiles.evict().length; s.maskTiles.budget = budget;
    window.ichantool.deleteObjects([id]);
    return { n, still: s.objects.has(id) };
  }, quick.target);
  assert.ok(dropped.n > 0 && dropped.still, 'mask tiles dropped, the delete waits for them: ' + JSON.stringify(dropped));
  await on.page.waitForFunction((id) => !window.ichantool.S.sections.find((q) => q.id === window.__tiledId).objects.has(id), { polling: 50, timeout: 60000 }, quick.target);
  await sectionIdle();
  assert.deepEqual(await dump(quick.index), slowDump, 'the same result after reading the masks back');
  assert.ok(!toasts.slice(toastsBeforeQuick).some((text) => text === tBusy || text === tLoading), 'never "try again"');
  console.log('Reopened, an object spanning two tiles deleted at once (' + quick.ms + ' ms, ' + quick.waitingAtStart + ' tiles waiting at the start, ' + quick.waitingAfter + ' after): equal to the deletion with every statistic current');
  // Card M8.4.31: 150 edits and 75 saves overlap (a tile changes every 100 ms, a save is requested every 200 ms without waiting for the
  // previous one; about 20 s), so that clean-ups of the store run while versions are being committed. The loop counts edits rather than
  // running for 20 s: on GitHub's macOS machines 100 ms timers took about 135 ms and 20 s gave 148 edits (card M8.4.32, 20 Nov 2026). After a final save the store holds exactly the
  // saved versions and the reopened section has the masks it had.
  const race = await on.page.evaluate(async () => {
    const { S } = window.ichantool, app = await import(new URL('js/app.js', location.href).href);
    const index = S.sections.findIndex((q) => q.id === window.__tiledId), s = S.sections[index];
    window.ichantool.selectSection(index);
    const id = [...s.objects.keys()][0], requests = [];
    let edits = 0;
    while (edits < 150) {
      const row = edits % s.maskTiles.rows, col = Math.floor(edits / s.maskTiles.rows) % s.maskTiles.cols, labels = new Int32Array(512 * 512);
      const width = Math.min(512, s.maskTiles.width - col * 512), height = Math.min(1 + (edits % 50), s.maskTiles.height - row * 512);
      for (let y = 0; y < height; y++) labels.fill(id, y * 512, y * 512 + width);   // a band inside the section whose height changes with every edit
      window.ichantool.putMaskTile(row, col, labels, null);
      app.markDirty();
      if (edits++ % 2 === 1) requests.push(window.ichantool.saveNow());
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await Promise.all(requests);
    for (let k = 0; k < 600 && !window.ichantool.masksSettled(); k++) await new Promise((resolve) => setTimeout(resolve, 50));
    await window.ichantool.saveNow();
    return { edits, requests: requests.length, saved: window.ichantool.tiledSaved().filter(Boolean) };
  });
  assert.ok(race.edits >= 150 && race.requests >= 75, 'edits and saves overlapped: ' + JSON.stringify({ edits: race.edits, requests: race.requests }));
  for (let i = 0; i < 100 && JSON.stringify(await manifestsOnDisk()) !== JSON.stringify([...new Set(race.saved)].sort()); i++) await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(await manifestsOnDisk(), [...new Set(race.saved)].sort(), 'after the final save the store holds exactly the saved versions');
  const raceIndex = await on.page.evaluate(() => window.ichantool.S.sections.findIndex((q) => q.id === window.__tiledId));
  const raceDump = await dump(raceIndex);
  assert.deepEqual(await reopen(), { frozen: null, missing: false, grey: false }, 'reopened after the race, unlocked');
  const reopenedDump = await dump(await on.page.evaluate(() => window.ichantool.S.sections.findIndex((q) => q.id === window.__tiledId)));
  assert.deepEqual([reopenedDump.runs, reopenedDump.exRuns], [raceDump.runs, raceDump.exRuns], 'the reopened masks are the last saved ones');
  console.log(`Edits and saves overlapping for 20 s (${race.edits} edits, ${race.requests} saves requested): the store holds the saved versions and the reopened masks are the last saved ones`);
  // (3) Deleting a project from the library deletes its folder, and only that one.
  const originalFolder = manifestFile.slice(0, manifestFile.indexOf(path.sep + 'tiles' + path.sep));
  await on.page.evaluate(async (id) => {
    await window.ichantool.showHome();
    for (let i = 0; i < 100 && !document.querySelector(`.pcard[data-id="${id}"] [data-act=del]`); i++) await new Promise((r) => setTimeout(r, 50));
    const button = /** @type {HTMLElement} */ (document.querySelector(`.pcard[data-id="${id}"] [data-act=del]`));
    button.click(); button.click();                                       // armed, then confirmed
  }, keptId);
  // The folder is renamed first and removed afterwards: wait (the same 10 s) until both are finished, not only the rename (a check between
  // the two found the renamed folder still being removed, 19 Nov 2026).
  const deleting = () => fs.readdirSync(path.join(on.profile, 'projects')).some((name) => name.startsWith('.deleting-'));
  // The page first lets a send round on its way finish, up to 60 s (deleteStoreOf, 20 Nov 2026): the wait follows that bound.
  for (let i = 0; i < 1400 && (fs.existsSync(keptFolder) || deleting()); i++) await new Promise((r) => setTimeout(r, 50));
  const listTree = (folder) => { try { return fs.readdirSync(folder, { recursive: true }).slice(0, 20); } catch (error) { return String(error.code); } };
  assert.ok(!fs.existsSync(keptFolder), 'the deleted project\'s folder is gone: ' + JSON.stringify({ left: listTree(keptFolder), deleting: deleting(), toasts: toasts.slice(-4) }));   // what was left, if it fails again (once in Nov 2026)
  assert.ok(fs.existsSync(originalFolder), 'the other project\'s folder stays');
  assert.ok(!fs.readdirSync(path.join(on.profile, 'projects')).some((name) => name.startsWith('.deleting-')), 'nothing left half-deleted');
  console.log('Store folder: a missing stored version locks its section (record kept, the rest saved); a copy kept on import has its own versions; a deleted project takes its folder');
  fs.rmSync(lossless, { force: true });
  console.log('Exact equality, whole against tiled at factor 1:', whole.runs.length, 'label runs,', whole.exRuns.length, 'exclusion runs,', whole.objects.length, 'objects,', whole.usedStacks.length, 'overlap sets');
  assert.deepEqual(on.errors, []);
  console.log('Tiled sections: added through the interface, working image from the pyramid, not saved, reloaded, whole-image actions refused, every editing tool works; full-resolution tiles drawn (' + drawn.probes.length + ' probes):', JSON.stringify(section));
} finally { await on.close(); }

const off = await program(false);
try {
  assert.equal(await off.page.evaluate(() => window.corantoolDesktop.tiles.enabled), false);
  await addImage(off.page);
  const section = await off.page.evaluate(() => { const s = window.ichantool.S.sections.at(-1); return { tiled: !!s.tiled, ds: s.ds }; });
  assert.deepEqual(section.tiled, false, 'with the flag off the image takes today\'s path');
  // D2 of card M8.4.18: the project saved with a tiled section opens here with a placeholder, and saving writes its record back byte for byte.
  const d2 = await off.page.evaluate(async (record) => {
    await window.ichantool.loadProject(record);
    const s = window.ichantool.S.sections.find((q) => q.frozen === 'engine') || window.ichantool.S.cores.flatMap((c) => c.sections).find((q) => q.frozen === 'engine');
    if (!s) return { placeholder: false };
    window.ichantool.S.name = record.name + ' (other build)';
    await window.ichantool.saveNow();
    const { getProject } = await import(new URL('js/storage.js', location.href).href), stored = await getProject(record.id);
    const tiledOf = (d) => d.cores.flatMap((c) => c.sections).filter((q) => q.tiled).map((q) => JSON.stringify(q));
    return { placeholder: true, bins: s.bins.length, same: JSON.stringify(tiledOf(stored)) === JSON.stringify(tiledOf(record)), name: stored.name, version: stored.version };
  }, projectRecord);
  assert.deepEqual(d2, { placeholder: true, bins: 0, same: true, name: projectRecord.name + ' (other build)', version: 6 }, 'D2: placeholder, record unchanged, the rest saved');
  // Cards M8.4.33 and M8.4.18d: without the engine a package cannot carry the tiled section: it is left out, named, and the user is told first.
  // (A copy of the project with only its tiled sections: the images of its other sections are in the other program's profile, not in this one.)
  const offPackage = await off.page.evaluate(async (record) => {
    await window.ichantool.loadProject({ ...record, id: record.id + '-tiled-only', cores: record.cores.map((c) => ({ ...c, sections: c.sections.filter((q) => q.tiled) })) });
    const told = [], observer = new MutationObserver(() => { const el = document.getElementById('toast'); if (el && !el.hidden) told.push(el.textContent); });
    observer.observe(document.getElementById('toast'), { attributes: true, childList: true, subtree: true, characterData: true });
    const size = await window.ichantool.packageNow();
    await new Promise((r) => setTimeout(r, 100)); observer.disconnect();
    return { size, told };
  }, projectRecord);
  assert.ok(offPackage.size > 0 && offPackage.told.some((text) => /secciones grandes por piezas|large tiled sections/.test(text)), 'without the engine the package leaves it out and says so: ' + JSON.stringify(offPackage.told));
  assert.deepEqual(off.errors, []);
  console.log('Flag off: today\'s path (factor', section.ds + '); a saved tiled section is a placeholder whose record is saved back unchanged');
} finally { await off.close(); }
