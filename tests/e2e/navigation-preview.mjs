import assert from 'node:assert/strict';
import { objectStats } from '../../app/js/imageproc.js';
import { rleDecode, rleEncode } from '../../app/js/core.js';
import { zipFiles } from '../../app/js/zip.js';
import { taxonFigureFixture } from './taxon-figures.mjs';

/** Reference preparation is confined to a separate correctness trial, never to a timed/RSS trial. */
export async function compareNavigationPreview(page) {
  return page.evaluate(async () => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await document.fonts.ready;
    const checkbox = document.getElementById('navPreview'), view = document.getElementById('view');
    const context = view.getContext('2d'), before = checkbox.checked;
    const select = async (enabled) => { checkbox.checked = enabled; checkbox.dispatchEvent(new Event('change', { bubbles: true })); await frame(); await frame(); };
    await select(false);
    const reference = context.getImageData(0, 0, 66, view.height).data;
    await select(true);
    const actual = context.getImageData(0, 0, 66, view.height).data;
    if (reference.length !== actual.length) throw new Error('Navigation geometry changed');
    // Exact equality stays the contract. On a mismatch the message carries what is needed to tell a platform rasteriser detail from a
    // real discrepancy of the preview path (how many pixels, how far apart, where, and which renderer the browser used).
    let differing = 0, largest = 0; const first = [];
    for (let i = 0; i < actual.length; i++) if (actual[i] !== reference[i]) {
      differing++; largest = Math.max(largest, Math.abs(actual[i] - reference[i]));
      if (first.length < 3) first.push({ x: Math.floor(i / 4) % 66, y: Math.floor(i / 4 / 66), channel: i % 4, expected: reference[i], received: actual[i] });
    }
    if (differing) {
      // Probe: does the way a source canvas is built, or the 2-D backend (GPU or CPU), change a plain bilinear stretch of the same pixels?
      // Both canvases below hold the same vertical gradient; each is stretched 80x100 -> 24x(view height - 30) like the strip.
      const stretch = (build, options) => {
        const source = document.createElement('canvas'); source.width = 80; source.height = 100; build(source.getContext('2d', options));
        const target = document.createElement('canvas'); target.width = 24; target.height = view.height - 30;
        const targetContext = target.getContext('2d', options); targetContext.drawImage(source, 0, 0, 80, 100, 0, 0, 24, target.height);
        return targetContext.getImageData(0, 0, 24, target.height).data;
      };
      const strips = (y) => { const data = new Uint8ClampedArray(80 * 4); for (let x = 0; x < 80; x++) data.set([y + 60, y + 90, 200 - y, 255], x * 4); return data; };
      const filled = (context) => { for (let y = 0; y < 100; y++) { context.fillStyle = `rgb(${y + 60},${y + 90},${200 - y})`; context.fillRect(0, y, 80, 1); } };
      const put = (context) => { for (let y = 0; y < 100; y++) context.putImageData(new ImageData(strips(y), 80, 1), 0, y); };
      const same = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };
      // Same stretch drawn at the origin of its own canvas (the preview) and at (6, 14) of a larger one (the legacy draw into the view).
      const placed = (dx, dy) => {
        const source = document.createElement('canvas'); source.width = 80; source.height = 100; filled(source.getContext('2d'));
        const target = document.createElement('canvas'); target.width = 40; target.height = view.height; const context = target.getContext('2d');
        context.drawImage(source, 0, 3, 80, 45, dx, dy, 24, view.height - 30);
        return context.getImageData(dx, dy, 24, view.height - 30).data;
      };
      const offset = same(placed(0, 0), placed(6, 14));
      const probe = { offset, creation: same(stretch(filled), stretch(put)), backend: same(stretch(filled), stretch(filled, { willReadFrequently: true })),
        cpuCreation: same(stretch(filled, { willReadFrequently: true }), stretch(put, { willReadFrequently: true })) };
      // Where the first mismatching row samples the source: a fraction of exactly .5 is a rounding tie between two source rows.
      const section = window.ichantool.S.sections[0], k = section._lc?.k || 1, roi = section.roi, strip = view.height - 30;
      const sourceRow = first.length ? ((first[0].y - 14 + 0.5) * (roi.y1 - roi.y0) * k) / strip - 0.5 : null;
      probe.source = { k, rows: (roi.y1 - roi.y0) * k, strip, row: first[0]?.y, position: sourceRow, tie: sourceRow === null ? null : Math.abs(sourceRow - Math.floor(sourceRow) - 0.5) < 1e-9 };
      const gl = document.createElement('canvas').getContext('webgl'), info = gl?.getExtension('WEBGL_debug_renderer_info');
      throw new Error(`Navigation preview differs from the legacy renderer: ${JSON.stringify({ differing, of: actual.length, largest, first,
        probe, canvas: [view.width, view.height], ratio: devicePixelRatio, renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null, agent: navigator.userAgent })}`);
    }
    await select(before);
    return { width: 66, height: view.height, exact_pixels: reference.length / 4 };
  });
}

export async function verifyNavigationPreview(browser, url, { screenshots = false } = {}) {
  const page = await browser.newPage(), errors = [];
  page.setDefaultTimeout(20000); page.on('pageerror', (error) => errors.push(error.message)); page.on('dialog', (dialog) => dialog.accept());
  const change = (selector, value, event = 'change') => page.evaluate((selector, value, event) => {
    const field = document.querySelector(selector); if (field.type === 'checkbox') field.checked = value; else field.value = String(value);
    field.dispatchEvent(new Event(event, { bubbles: true }));
  }, selector, value, event);
  const frame = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const science = () => page.evaluate(() => {
    const I = window.ichantool;
    return JSON.stringify(I.S.sections.map((s) => { I.analyze(s); return { labels: s._mk.labels.rle(), exclude: s._mk.exclude.rle(),
      objects: [...s.objects.values()].sort((a, b) => a.id - b.id).map((o) => [o.id, o.cls]), marks: s.marks, bins: s.bins }; }));
  });
  try {
    const fixture = taxonFigureFixture(), section = fixture.cores[0].sections[0], originalLabels = rleDecode(section.labels, section.w * section.h, Int32Array);
    const labels = new Int32Array(80 * section.h), rgba = new Uint8ClampedArray(labels.length * 4);
    for (let y = 0; y < section.h; y++) for (let x = 0; x < 80; x++) {
      const i = y * 80 + x; labels[i] = originalLabels[y * 8 + Math.floor(x / 10)]; rgba.set([y + 60, y + 90, 200 - y, 255], i * 4);
    }
    section.w = 80; section.roi.x1 = 80; section.labels = rleEncode(labels);
    const statistics = objectStats(labels, section.w, section.h, rgba);
    for (const object of section.objects) object.st = statistics.get(object.id);
    for (const mark of section.marks) mark.x *= 10;
    const exclude = new Uint8Array(section.w * section.h);
    exclude.fill(1, 30 * section.w, 33 * section.w); exclude[55 * section.w + 3] = 1; section.exclude = rleEncode(exclude);
    await page.goto(url, { waitUntil: 'networkidle0' }); await page.waitForFunction(() => window.ichantool);
    await page.evaluate(async (fixture) => {
      const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 100;
      const context = canvas.getContext('2d');
      for (let y = 0; y < 100; y++) { context.fillStyle = `rgb(${y + 60},${y + 90},${200 - y})`; context.fillRect(0, y, 80, 1); }
      fixture.cores[0].sections[0].file = { name: 'synthetic.png', type: 'image/png', blob: await new Promise((resolve) => canvas.toBlob(resolve)) };
      const I = window.ichantool; await I.loadProject(fixture); document.getElementById('home').hidden = true; I.setMode('section');
      await I.saveToDB();
    }, fixture);
    await page.waitForFunction(() => window.ichantool.S.sections[0]?.enh);
    await frame(); const original = await science();
    assert.equal(await page.$eval('#navPreview', (checkbox) => checkbox.checked), true);
    await compareNavigationPreview(page);
    assert.equal(await science(), original);
    assert.equal(await page.$eval('#saveState', (status) => status.dataset.state), 'saved');
    for (const source of ['orig', 'enh']) for (const overlay of [false, true]) for (const hidden of [false, true]) {
      await change('#logImgMode', source); await change('#logOverlay', overlay); await change('#logHideExcl', hidden);
      for (const opacity of [35, 65, 100]) { await change('#ovAlpha', opacity, 'input'); await compareNavigationPreview(page); }
    }
    assert.equal(await science(), original);
    await change('#navPreview', true);
    await page.evaluate(() => {
      const I = window.ichantool; I.S.selected = 1; I.assignClass('pl');
      I.S.classes[0].color = '#b32d8a'; const s = I.S.sections[0]; s.roi = { x0: 1, x1: 7, y0: 5, y1: 95 }; s.logVer++;
      I.setMode('section');
    });
    await compareNavigationPreview(page);
    await page.setViewport({ width: 1280, height: 800 }); await compareNavigationPreview(page);
    await page.setViewport({ width: 1440, height: 900 }); await compareNavigationPreview(page);
    await page.evaluate(() => {
      const I = window.ichantool; I.S.view.zoom = 8; I.setMode('section');
      document.addEventListener('pointerdown', (event) => { if (event.target.id === 'view') window.__navPoint = event.clientY; }, true);
      document.addEventListener('pointermove', (event) => { if (event.target.id === 'view') window.__navPoint = event.clientY; }, true);
    });
    await frame(); const beforePointer = await science(), bounds = await page.$eval('#view', (canvas) => {
      const rect = canvas.getBoundingClientRect(); return { x: rect.left, y: rect.top, height: canvas.height };
    });
    const checkPosition = async () => {
      const measured = await page.evaluate(() => {
        const { S } = window.ichantool, view = document.getElementById('view'), section = S.sections[0], top = view.getBoundingClientRect().top;
        const fraction = Math.min(1, Math.max(0, (window.__navPoint - top - 14) / (view.height - 30)));
        const expected = section.roi.y0 + fraction * (section.roi.y1 - section.roi.y0), got = S.view.y + view.height / (2 * S.view.zoom);
        // The values are part of the message so that a failure on another machine can be diagnosed from the log alone.
        return { ok: Math.abs(got - expected) <= 1e-9, got, expected, point: window.__navPoint, top, canvas: [view.width, view.height], zoom: S.view.zoom,
          view: [S.view.x, S.view.y], roi: section.roi, image: [section.w, section.h] };
      });
      assert.ok(measured.ok, `Navigation click/drag must preserve depth mapping: ${JSON.stringify(measured)}`);
    };
    const x = Math.round(bounds.x + 16), start = Math.round(bounds.y + 14 + (bounds.height - 30) * 0.4), end = Math.round(bounds.y + 14 + (bounds.height - 30) * 0.7);
    await page.mouse.click(x, start); await checkPosition();
    await page.mouse.move(x, start); await page.mouse.down(); await page.mouse.move(x, end, { steps: 3 }); await page.mouse.up(); await checkPosition();
    assert.equal(await science(), beforePointer);
    await page.select('#secRes', '2');
    await page.waitForFunction(() => window.ichantool.S.sections[0].ds === 2 && !window.ichantool.S.sections[0]._loading && document.getElementById('busy').hidden);
    await compareNavigationPreview(page);
    if (screenshots) await page.screenshot({ path: 'dist/navigation-preview.png' });
    const saved = await page.evaluate(async () => { await window.ichantool.saveToDB(); return window.ichantool.serialize(); });
    assert.equal(JSON.stringify(saved).includes('navPreview'), false);
    await change('#navPreview', false);
    assert.equal(await page.$eval('#navPreview', (checkbox) => checkbox.checked), false);
    await page.evaluate(() => window.ichantool.saveToDB());
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.ichantool?.S.sections[0]?.enh);
    assert.equal(await page.$eval('#navPreview', (checkbox) => checkbox.checked), true);
    await compareNavigationPreview(page);
    assert.deepEqual(errors, []);
    console.log('Navigation preview: exact display pixels, source/overlay/exclusion/opacity, edits, ROI, resize, resolution, pointer depth, rollback and session-only state verified.');
  } finally { await page.close(); }
}

/** Older project formats enter through the ordinary importer, with real inline image bytes and masks. */
export async function verifyLegacyNavigation(browser, url) {
  for (const version of [2, 3]) {
    const context = await browser.createBrowserContext(), page = await context.newPage(), errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.goto(url, { waitUntil: 'networkidle0' });
      await page.waitForFunction(() => window.ichantool);
      const fixture = taxonFigureFixture(), core = fixture.cores[0], section = core.sections[0];
      section.file = await page.evaluate(() => {
        const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 100;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#b4b4b4'; ctx.fillRect(0, 0, 8, 100);
        return { name: 'legacy.png', type: 'image/png', b64: canvas.toDataURL().split(',')[1] };
      });
      fixture.version = version; fixture.id = `navigation-v${version}`; fixture.app = version === 2 ? 'IchAnTool' : 'CorAnTool';
      if (version === 2) {
        Object.assign(fixture, { sections: core.sections, age: core.age, logView: core.logView });
        delete fixture.cores;
      }
      const json = JSON.stringify(fixture), file = version === 2 ? new Blob([json]) : await zipFiles([{ name: 'project.json', data: json }]);
      await page.evaluate((bytes, name) => {
        const input = document.getElementById('impProj'), transfer = new DataTransfer();
        transfer.items.add(new File([new Uint8Array(bytes)], name)); input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, [...new Uint8Array(await file.arrayBuffer())], version === 2 ? 'navigation-v2.json' : 'navigation-v3.corantool');
      await page.waitForFunction((id) => window.ichantool.S.id === id && window.ichantool.S.sections[0]?.enh
        && document.getElementById('busy').hidden && document.getElementById('saveState').dataset.state === 'saved', {}, fixture.id);
      const snapshot = () => page.evaluate(() => {
        const I = window.ichantool, section = I.S.sections[0]; I.analyze(section);
        return { labels: section._mk.labels.rle(), exclude: section._mk.exclude.rle(), bins: section.bins,
          objects: [...section.objects.values()].map((o) => [o.id, o.cls]) };
      });
      const before = await snapshot();
      assert.deepEqual(before.labels, section.labels); assert.deepEqual(before.exclude, section.exclude);
      assert.equal(await page.$eval('#navPreview', (checkbox) => checkbox.checked), true);
      await compareNavigationPreview(page); assert.deepEqual(await snapshot(), before);
      await page.$eval('#navPreview', (checkbox) => checkbox.click());
      await page.evaluate(() => window.ichantool.saveToDB());
      assert.equal(JSON.stringify(await page.evaluate(() => window.ichantool.serialize())).includes('navPreview'), false);
      await page.reload({ waitUntil: 'networkidle0' });
      await page.waitForFunction(() => window.ichantool?.S.sections[0]?.enh);
      assert.equal(await page.$eval('#navPreview', (checkbox) => checkbox.checked), true);
      assert.deepEqual(await snapshot(), before); await compareNavigationPreview(page);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
  console.log('Navigation defaults: IchAnTool v2 JSON and CorAnTool v3 package import, exact masks/results, session rollback and migrated reload verified.');
}
