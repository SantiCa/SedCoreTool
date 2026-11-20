import assert from 'node:assert/strict';
import { multiproxyFigureFixture } from './multiproxy-figure.mjs';
import { verifyFigureStyleSafety } from './figure-style-safety.mjs';

/** Independent figure settings, nonlinear image/occurrence mapping and saved-profile recovery. */
export async function verifyFigureComposition(browser, url, { screenshots = false } = {}) {
  const page = await browser.newPage(), errors = [];
  page.setDefaultTimeout(15000); page.on('pageerror', (error) => errors.push(error.message));
  const change = (selector, value) => page.evaluate((selector, value) => {
    const input = document.querySelector(selector);
    if (!input) throw new Error('Missing composition control: ' + selector);
    if (input.type === 'checkbox') input.checked = value; else input.value = String(value);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, selector, value);
  const click = (selector) => page.evaluate((selector) => document.querySelector(selector).click(), selector);
  const taxa = (key, value) => change(`[data-taxa-scope="figure"] [data-taxa="${key}"]`, value);
  const globals = () => page.evaluate(() => {
    const S = window.ichantool.S;
    return JSON.stringify({ log: S.logView, geo: S.geo, core: S.curCore, age: S.age, opacity: S.ovAlpha,
      data: S.cores.map((core) => ({ imp: core.imp, proxies: core.proxies, sections: core.sections.map((section) => ({
        labels: [...section.labels], exclude: [...section.exclude], marks: section.marks, bins: section.bins,
        assignments: [...section.objects.values()].map((object) => [object.id, object.cls]) })) })) });
  });
  const type = async (next) => {
    const previous = await page.$eval('#figOut', (element) => element.innerHTML);
    await change('#figType', next);
    await page.waitForFunction((previous) => document.querySelector('#figOut svg') && document.getElementById('figOut').innerHTML !== previous, {}, previous);
  };
  try {
    const fixture = multiproxyFigureFixture();
    fixture.cores[0].logView.textEdits = { '["Cu",0]': { text: 'Copper', x: 3, y: 0 } };
    fixture.cores[0].age.text = '0, 0\n5, 10\n10, 30';
    fixture.cores[0].records = [{ id: 'record', name: 'Synthetic Cu', axis: 'depth',
      series: [{ name: 'Cu', x: [0, 5, 10], y: [2, 4, 3], show: true, color: '#663399' }] }];
    await page.goto(url, { waitUntil: 'networkidle0' }); await page.waitForFunction(() => window.ichantool);
    await page.evaluate(async (fixture) => {
      const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 100;
      const context = canvas.getContext('2d'); context.fillStyle = '#b4b4b4'; context.fillRect(0, 0, 8, 100);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve));
      for (const core of fixture.cores) for (const section of core.sections) section.file = { name: 'synthetic.png', type: 'image/png', blob };
      const I = window.ichantool; await I.loadProject(fixture); document.getElementById('home').hidden = true;
      for (const core of I.S.cores) for (const section of core.sections) I.analyze(section);
      I.S.fig.type = 'log'; I.S.fig.coreH = 500; I.setMode('fig');
    }, fixture);
    await page.waitForSelector('#figOut svg');
    assert.match(await page.$eval('#figOut svg', (svg) => svg.textContent), /Copper/);
    const original = await globals(), firstTab = await page.evaluate(() => window.ichantool.S.figTab);
    assert.equal(await page.evaluate(() => window.ichantool.S.fig.views == null), true);
    await change('[data-ftrack="image"]', true);
    await change('[data-fview="axis"]', 'age');
    await change('[data-fimage="mask"]', true);
    await change('[data-fview="height"]', 600);
    await change('[data-fview="hideExcl"]', true);
    await change('[data-fview="overlayAlpha"]', 0.7);
    await change('[data-figure-style] [data-st="bgColor"]', '#fff8e8');
    await change('[data-figure-style] [data-axw="total"]', 95);
    await taxa('abundance', 'kite'); await taxa('occurrence', 'names'); await taxa('source', 'marks');
    await page.waitForSelector('#figOut [data-role="abundance"] polygon');
    await page.waitForFunction(() => document.querySelector('#figOut image')?.getAttribute('href')?.startsWith('data:image/png'));
    const pixel = await page.$eval('#figOut image', async (image) => {
      const bitmap = await createImageBitmap(await (await fetch(image.getAttribute('href'))).blob());
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0);
      return [...context.getImageData(Math.floor(bitmap.width / 4), Math.floor(bitmap.height * 4 / 30), 1, 1).data];
    });
    assert.deepEqual(pixel, [18, 102, 130, 255], 'Age-aligned mask pixels use the inverse nonlinear model');
    const mark = await page.$eval('#figOut [data-role="occurrence"][data-taxon="Chondrites"] text', (text) => {
      const clip = document.querySelector('#figOut clipPath[id$="plot"] rect');
      return (+text.getAttribute('y') - 3 - +clip.getAttribute('y')) / +clip.getAttribute('height');
    });
    assert.ok(Math.abs(mark - 2 / 3) < 0.0001);
    await change('[data-colord="figure"] [data-colshow="rec:Cu"]', false);
    await change('[data-fview="from"]', 2); await change('[data-fview="to"]', 28);
    await page.waitForFunction(() => /2.28 ka/.test(document.querySelector('#figOut svg')?.textContent) && !document.querySelector('#figOut svg')?.textContent.includes('Copper'));
    if (screenshots) await page.screenshot({ path: 'dist/figure-composition-log.png' });
    assert.equal(await globals(), original);
    await type('core');
    assert.equal(await page.$eval('[data-fview="axis"]', (input) => input.value), 'depth');
    await change('[data-fview="axis"]', 'age');
    await change('[data-figure-style] [data-st="bgColor"]', '#eef4ee');
    await change('[data-ftrack="BI"]', true);
    await change('[data-ftrack="image"]', true);
    await change('[data-corep="bw"]', true);
    await page.waitForFunction(() => document.querySelector('#figOut svg')?.textContent.includes('(ka)') && document.querySelector('#figOut image')?.getAttribute('href')?.startsWith('data:image/png'));
    await change('#figKeepRatio', true);
    assert.equal(await page.$eval('#figCoreH', (input) => input.disabled), true);
    await change('#figKeepRatio', false);
    assert.equal(await page.$eval('#figCoreH', (input) => input.disabled), false);
    await type('range'); await change('[data-figure-style] [data-st="bgColor"]', '#f0f0ff');
    await change('#figRangeAxis', 'age');
    await type('sections'); await change('[data-figure-style] [data-st="yStep"]', 2);
    await change('#figSecFrom', 1);
    await type('log');
    assert.equal(await page.evaluate(() => window.ichantool.S.fig.views.log.style.bgColor), '#fff8e8');
    assert.equal(await page.$eval('[data-fview="from"]', (input) => input.value), '2');
    assert.equal(await globals(), original);
    await click('#figTabs [data-ftabadd]');
    const secondTab = await page.evaluate(() => window.ichantool.S.figTab);
    await change('[data-figure-style] [data-st="bgColor"]', '#ffdddd');
    await click(`[data-ftab="${firstTab}"] .ftl`);
    assert.equal(await page.evaluate(() => window.ichantool.S.fig.views.log.style.bgColor), '#fff8e8');
    const saved = await page.evaluate(async () => { await window.ichantool.saveToDB(); return window.ichantool.serialize(); });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.evaluate(async (project) => { const I = window.ichantool; await I.loadProject(project); document.getElementById('home').hidden = true; I.setMode('fig'); }, saved);
    await page.waitForSelector('#figOut [data-role="abundance"] polygon');
    assert.equal(await page.evaluate(() => window.ichantool.S.fig.views.log.axis), 'age');
    assert.equal(await page.evaluate(() => window.ichantool.S.fig.views.core.style.bgColor), '#eef4ee');
    assert.equal(await page.evaluate(() => window.ichantool.S.fig.views.sections.style.yStep), 2);
    assert.equal(await page.evaluate(() => window.ichantool.S.fig.views.sections.depthFrom), 1);
    await page.evaluate(() => {
      window.__compositionExports = []; const createURL = URL.createObjectURL;
      URL.createObjectURL = (blob) => { if (['image/svg+xml', 'image/png'].includes(blob.type)) window.__compositionExports.push(blob); return createURL(blob); };
      document.addEventListener('click', (event) => { if (event.target.closest?.('a[download]')) event.preventDefault(); }, true);
    });
    await click('#figSvg'); await click('#figPng');
    await page.waitForFunction(() => window.__compositionExports.some((blob) => blob.type === 'image/png'));
    const exported = await page.evaluate(async () => ({ svg: await window.__compositionExports.find((b) => b.type === 'image/svg+xml').text(),
      png: [...new Uint8Array(await window.__compositionExports.find((b) => b.type === 'image/png').arrayBuffer()).slice(0, 8)] }));
    assert.match(exported.svg, /data-role="abundance"/); assert.match(exported.svg, /#fff8e8/);
    assert.deepEqual(exported.png, [137, 80, 78, 71, 13, 10, 26, 10]);
    // Card P1: at 600 dpi the PNG carries a pHYs chunk right after IHDR (23622 px/m, unit metre); the default export has none.
    const physOf = (bytes) => (String.fromCharCode(...bytes.slice(37, 41)) === 'pHYs'   // IHDR ends at byte 33; the next chunk is length (4), type (4), data
      ? { ppmX: new DataView(bytes.buffer).getUint32(41), ppmY: new DataView(bytes.buffer).getUint32(45), unit: bytes[49] } : null);
    const firstPng = await page.evaluate(async () => [...new Uint8Array(await window.__compositionExports.find((b) => b.type === 'image/png').arrayBuffer()).slice(0, 56)]);
    assert.equal(physOf(Uint8Array.from(firstPng)), null);
    await page.evaluate(() => { window.__compositionExports.length = 0; });
    await page.select('#figPngDpi', '600'); await click('#figPng');
    await page.waitForFunction(() => window.__compositionExports.some((blob) => blob.type === 'image/png'), { timeout: 60000 });
    const highPng = await page.evaluate(async () => [...new Uint8Array(await window.__compositionExports.find((b) => b.type === 'image/png').arrayBuffer()).slice(0, 56)]);
    assert.deepEqual(physOf(Uint8Array.from(highPng)), { ppmX: 23622, ppmY: 23622, unit: 1 });
    await page.select('#figPngDpi', '0');
    await click('#figCompositionReset');
    assert.equal(await page.evaluate(() => window.ichantool.S.fig.views.log == null), true);
    assert.equal(await page.$eval('[data-fview="axis"]', (input) => input.value), 'depth');
    assert.equal(await page.evaluate(() => window.ichantool.S.fig.views.core.style.bgColor), '#eef4ee');
    await click(`[data-ftab="${secondTab}"] .ftl`);
    assert.equal(await page.evaluate(() => window.ichantool.S.fig.views.log.style.bgColor), '#ffdddd');
    await verifyFigureStyleSafety(page);
    assert.deepEqual(errors, []);
    console.log('Figure composition: independent types/tabs, read-only analysis views, nonlinear age images/marks, tracks, styles, save/reload, reset and exports verified.');
  } catch (error) {
    console.error('Figure composition errors:', errors);
    console.error('Figure composition state:', await page.evaluate(() => JSON.stringify({ figure: window.ichantool?.S.fig, output: document.getElementById('figOut')?.textContent.slice(0, 500) })).catch(() => 'Page unavailable'));
    throw error;
  } finally { await page.close(); }
}
