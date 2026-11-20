// Card H7: a 16-bit image above about 28 megapixels made the page die of a fatal out-of-memory error while it was decoded (the 8-bit display
// copy was made with Uint8ClampedArray.from and a mapping function). Found with a maintainer's project: opening the Core log decoded a
// 2,249 x 14,020 16-bit section again and the window stopped answering.
//
//   node tests/e2e/large-16bit-desktop.mjs
//
// The test writes its own 16-bit greyscale TIFF of 6,000 x 5,000 pixels (120 million RGBA samples, above the 112 million at which the old
// code died), adds it with "No reduction", opens the Core log three times with the section's pixels released in between (each opening
// decodes the image again) and checks that the page keeps answering and that the decoded samples are the file's.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const W = 6000, H = 5000;
const sample = (x, y) => (x * 7 + y * 13) & 0xffff;              // every 16-bit value has a distinct high and low byte somewhere

/** Little-endian baseline TIFF, one uncompressed strip per 256 rows, 16-bit greyscale. */
function grey16Tiff(w, h) {
  const rowsPerStrip = 256, strips = Math.ceil(h / rowsPerStrip), entries = 10, ifd = 8, ifdBytes = 2 + entries * 12 + 4;
  const offsetsAt = ifd + ifdBytes, countsAt = offsetsAt + strips * 4, pixelsAt = countsAt + strips * 4;
  const buffer = Buffer.alloc(pixelsAt + w * h * 2), view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  buffer.write('II', 0, 'latin1'); view.setUint16(2, 42, true); view.setUint32(4, ifd, true); view.setUint16(ifd, entries, true);
  const tags = [[256, 4, 1, w], [257, 4, 1, h], [258, 3, 1, 16], [259, 3, 1, 1], [262, 3, 1, 1], [273, 4, strips, offsetsAt],
    [277, 3, 1, 1], [278, 4, 1, rowsPerStrip], [279, 4, strips, countsAt], [284, 3, 1, 1]];
  tags.forEach(([tag, type, count, value], i) => {
    const at = ifd + 2 + i * 12;
    view.setUint16(at, tag, true); view.setUint16(at + 2, type, true); view.setUint32(at + 4, count, true);
    if (type === 3 && count === 1) view.setUint16(at + 8, value, true); else view.setUint32(at + 8, value, true);
  });
  for (let s = 0; s < strips; s++) {
    const rows = Math.min(rowsPerStrip, h - s * rowsPerStrip);
    view.setUint32(offsetsAt + s * 4, pixelsAt + s * rowsPerStrip * w * 2, true); view.setUint32(countsAt + s * 4, rows * w * 2, true);
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) view.setUint16(pixelsAt + (y * w + x) * 2, sample(x, y), true);
  return buffer;
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sedcoretool-h7-'));
const image = path.join(work, 'grey16_6000x5000.tif');
fs.writeFileSync(image, grey16Tiff(W, H));
const env = { ...process.env, SEDCORETOOL_TEST_PROFILE: path.join(work, 'profile') };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [path.join(root, 'tests/e2e/desktop-bootstrap.cjs'), '--headless', '--no-sandbox', '--remote-debugging-port=0'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
const exited = new Promise((resolve) => child.once('exit', resolve));
let log = '', crashed = false;
const endpoint = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Electron startup timed out: ' + log.slice(-500))), 60000);
  child.stderr.on('data', (bytes) => { log += bytes; const hit = log.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (hit) { clearTimeout(timer); resolve(hit[1]); } });
});
const browser = await puppeteer.connect({ browserWSEndpoint: endpoint, defaultViewport: null, protocolTimeout: 300000 });
const answers = (page) => Promise.race([page.evaluate(() => true), sleep(20000).then(() => false)]);   // a dead renderer never answers
try {
  const page = await (await browser.waitForTarget((t) => t.url().startsWith('app://corantool/app/index.html'), { timeout: 60000 })).page();
  page.setDefaultTimeout(300000);
  const errors = [];
  page.on('error', () => { crashed = true; });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept().catch(() => {}));
  await page.waitForFunction(() => !!window.ichantool && !document.getElementById('home').hidden, { timeout: 60000 });
  await page.click('#newProjOpen'); await page.type('#newProjName', 'H7 large 16-bit'); await page.click('#newProjBtn');
  await page.waitForFunction(() => window.ichantool.S.id, { timeout: 60000 });
  await page.evaluate(() => { window.ichantool.S.settings.maxMP = 0; });   // "No reduction": 30 MP x 21 bytes fits the page's 1.5 GiB limit
  await (await page.$('#addImg')).uploadFile(image);
  await page.waitForSelector('#pcOk', { visible: true, timeout: 30000 }); await page.click('#pcOk');
  await page.waitForFunction(() => window.ichantool.S.sections.length === 1 && window.ichantool.S.sections[0].orig, { timeout: 120000, polling: 200 }).catch(() => {});
  assert.ok(await answers(page) && !crashed, 'the page keeps answering after adding the image (before H7 it died decoding it)');
  const added = await page.evaluate(() => { const s = window.ichantool.S.sections[0]; return { w: s.w, h: s.h, ds: s.ds, wide: !!s.orig16 }; });
  assert.deepEqual(added, { w: W, h: H, ds: 1, wide: true }, 'the image is added at full resolution with its 16-bit samples');
  for (let round = 0; round < 3; round++) {
    const t0 = Date.now();
    // Release the pixels (as the memory manager does for sections out of view) and open the Core log, which decodes the image again.
    await page.evaluate(() => { const s = window.ichantool.S.sections[0]; s.orig = null; s.orig16 = null; s.enh = null; document.getElementById('modeLog').click(); });
    await page.waitForFunction(() => window.ichantool.S.sections[0].orig && document.getElementById('busy').hidden, { timeout: 120000, polling: 200 }).catch(() => {});
    assert.ok(await answers(page) && !crashed, `the page keeps answering after opening the Core log (round ${round + 1})`);
    const check = await page.evaluate((points) => {
      const s = window.ichantool.S.sections[0];
      return points.map(([x, y]) => { const o = (y * s.w + x) * 4; return [s.orig16[o], s.orig16[o + 1], s.orig[o], s.orig[o + 3], s.orig16[o + 3]]; });
    }, [[0, 0], [5999, 0], [1234, 4321], [5999, 4999]]);
    for (const [i, [x, y]] of [[0, 0], [5999, 0], [1234, 4321], [5999, 4999]].entries()) {
      const v = sample(x, y);
      assert.deepEqual(check[i], [v, v, v >>> 8, 255, 65535], `decoded sample at (${x}, ${y})`);
    }
    await page.evaluate(() => document.getElementById('modeSection').click());
    await sleep(500);
    console.log(`round ${round + 1}: Core log opened with the 16-bit image decoded again in ${Date.now() - t0} ms`);
  }
  assert.deepEqual(errors, []);
  console.log(`H7 ok: a ${W} x ${H} 16-bit image (${W * H * 4 / 1e6} million samples) decodes and the Core log opens with the window alive`);
} finally {
  try { browser.disconnect(); } catch { /* ignore */ }
  if (child.exitCode === null) child.kill();
  await Promise.race([exited, sleep(15000)]);
  fs.rmSync(work, { recursive: true, force: true });
}
