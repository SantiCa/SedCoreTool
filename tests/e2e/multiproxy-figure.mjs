import assert from 'node:assert/strict';
import { taxonFigureFixture } from './taxon-figures.mjs';

export function multiproxyFigureFixture() {
  const fixture = taxonFigureFixture(), first = fixture.cores[0];
  first.imp = { depth: [0, 5, 10], proxies: { Ca: [1, 3, 2], Ti: [4, 2, 5] } };
  const second = structuredClone(first);
  second.id = 'other-core'; second.name = 'Other core'; second.units = 'm';
  second.age.text = '1, 100\n2, 200';
  second.imp = { depth: [1, 1.5, 2], proxies: { Ca: [10, 30, 20], Ti: [40, 20, 50] } };
  second.sections[0].id = 'other-section'; second.sections[0].top = 100; second.sections[0].bottom = 200;
  const importedAge = structuredClone(first);
  importedAge.id = 'imp-age-core'; importedAge.name = 'Imported age core';
  importedAge.age = { text: '', units: 'ka' };
  importedAge.imp = { depth: [0, 5, 10], age: [10, 20, 40], proxies: { Ca: [1, 3, 2], Ti: [4, 2, 5] } };
  importedAge.sections[0].id = 'imp-age-section';
  fixture.cores.push(second, importedAge, { id: 'numeric-core', name: 'Numeric only', units: 'cm', sections: [],
    imp: { depth: [0, 5, 10], proxies: { Ca: [5, 6, 7] } } });
  fixture.geo = { settings: { axis: 'depth', step: 1, features: ['Ca', 'Ti'] } };
  return fixture;
}

/** Exercise real controls and saved projects in both served and offline builds. */
export async function verifyMultiproxyFigure(browser, url, { screenshots = false } = {}) {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.setDefaultTimeout(15000);
  const change = (selector, value) => page.evaluate((selector, value) => {
    const input = document.querySelector(selector);
    if (!input) throw new Error('Missing figure control: ' + selector);
    if (input.type === 'checkbox') input.checked = value; else input.value = String(value);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, selector, value);
  const click = (selector) => page.evaluate((selector) => document.querySelector(selector).click(), selector);
  const taxa = (key, value) => change(`[data-taxa-scope="figure"] [data-taxa="${key}"]`, value);
  const globalState = () => page.evaluate(() => {
    const S = window.ichantool.S;
    return JSON.stringify({ core: S.curCore, age: S.age.text, analysis: S.geo.settings, view: S.geo.view, log: S.logView,
      data: S.cores.map((c) => ({ imp: c.imp, proxies: c.proxies, sections: c.sections.map((s) => ({
        labels: [...s.labels], exclude: [...s.exclude], marks: s.marks,
        objects: [...s.objects.values()].map((o) => [o.id, o.cls]),
        bins: s.bins })) })) });
  });
  try {
    await page.goto(url, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.ichantool);
    await page.evaluate(async (fixture) => {
      const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 100;
      const context = canvas.getContext('2d'); context.fillStyle = '#b4b4b4'; context.fillRect(0, 0, 8, 100);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve));
      for (const core of fixture.cores) for (const section of core.sections) section.file = { name: 'synthetic.png', type: 'image/png', blob };
      const I = window.ichantool; await I.loadProject(fixture); document.getElementById('home').hidden = true;
      for (const core of I.S.cores) for (const section of core.sections) I.analyze(section);
      I.S.fig.type = 'geolog'; I.setMode('fig');
    }, multiproxyFigureFixture());
    await page.waitForSelector('#figOut svg');
    const original = await globalState(), firstTab = await page.evaluate(() => window.ichantool.S.figTab);
    assert.equal(await page.evaluate(() => window.ichantool.S.fig.geoView == null), true);
    await page.waitForSelector('#figOut image[href^="data:image/"]');
    await taxa('abundance', 'kite'); await taxa('occurrence', 'names'); await taxa('source', 'marks');
    await taxa('opacity', 35); await taxa('scale', 'percent'); await taxa('values', true);
    await change('[data-fgeo-track="image"]', false);
    await change('[data-fgeo-track="BI"]', true);
    await change('[data-fgeo-track="secs"]', true);
    await change('[data-fgeo-field="height"]', 600);
    await page.waitForSelector('#figOut [data-role="abundance"] polygon');
    assert.equal(await page.$$eval('#figOut [data-role="occurrence"]', (groups) => groups.length), 2);
    assert.match(await page.$eval('#figOut svg', (svg) => svg.textContent), /50%/);
    const proxyPosition = () => page.$$eval('[data-colord="figure"] [data-colid]', (items) => items.findIndex((item) => item.dataset.colid === 'rec:Ca'));
    const originalProxyPosition = await proxyPosition();
    await click('[data-colord="figure"] [data-colid="rec:Ca"] [data-colmv="-1"]');
    assert.equal(await proxyPosition(), originalProxyPosition - 1);
    await change('[data-colord="figure"] [data-colshow="sp:Planolites"]', false);
    await change('[data-colord="figure"] [data-colshow="rec:Ti"]', false);
    await change('[data-colord="figure"] [data-colshow="band:fam:events"]', false);
    await change('[data-figure-style] [data-axw="sp:Chondrites"]', 110);
    await page.waitForFunction(() => !document.querySelector('#figOut [data-taxon="Planolites"]'));
    assert.equal(await globalState(), original);
    await change('#figGeoCore', 'other-core');
    await page.waitForFunction(() => document.querySelector('#figOut svg')?.textContent.includes('Other core'));
    const markDepth = await page.$eval('#figOut [data-role="occurrence"][data-taxon="Chondrites"] text', (text) => {
      const clip = document.querySelector('#figOut clipPath[id$="plot"] rect');
      return (+text.getAttribute('y') - 3 - +clip.getAttribute('y')) / +clip.getAttribute('height');
    });
    assert.ok(Math.abs(markDepth - 0.75) < 0.0001, 'Selected core marks use its centimetre-to-metre conversion');
    assert.equal(await globalState(), original);
    if (screenshots) await page.screenshot({ path: 'dist/multiproxy-composition.png' });
    await click('#figTabs [data-ftabadd]');
    await taxa('layout', 'overlay'); await taxa('abundance', 'area'); await taxa('opacity', 80);
    const secondTab = await page.evaluate(() => window.ichantool.S.figTab);
    await change('[data-fgeo-field="from"]', 1.2); await change('[data-fgeo-field="to"]', 1.9);
    await page.waitForSelector('#figOut [data-role="abundance"][opacity="0.8"]');
    await click(`[data-ftab="${firstTab}"] .ftl`);
    await page.waitForSelector('#figOut [data-role="abundance"][opacity="0.35"] polygon');
    assert.equal(await page.evaluate(() => window.ichantool.S.fig.geoView.from == null), true);
    const saved = await page.evaluate(async () => { await window.ichantool.saveToDB(); return window.ichantool.serialize(); });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.evaluate(async (project) => { const I = window.ichantool; await I.loadProject(project); document.getElementById('home').hidden = true; I.setMode('fig'); }, saved);
    await page.waitForSelector('#figOut [data-role="abundance"][opacity="0.35"] polygon');
    assert.deepEqual(await page.evaluate(() => window.ichantool.S.fig.geoView.style.colHide), ['sp:Planolites', 'rec:Ti', 'band:fam:events']);
    assert.equal(await page.evaluate(() => window.ichantool.S.curCore), 'taxon-core');
    await change('[data-fview="axis"]', 'age');
    await page.waitForFunction(() => document.querySelector('#figOut svg')?.textContent.includes('(ka)'));
    const agePosition = await page.$eval('#figOut [data-role="occurrence"][data-taxon="Chondrites"] text', (text) => {
      const clip = document.querySelector('#figOut clipPath[id$="plot"] rect');
      return (+text.getAttribute('y') - 3 - +clip.getAttribute('y')) / +clip.getAttribute('height');
    });
    assert.ok(Math.abs(agePosition - 0.75) < 0.0001, 'Selected core uses its own age model');
    await change('[data-fgeo-track="image"]', true);
    await page.waitForSelector('#figOut image[href^="data:image/"]');
    await change('[data-colord="figure"] [data-colshow^="image:"]', false);
    await page.waitForFunction(() => !document.querySelector('#figOut image'));
    await change('[data-fgeo-track="image"]', false);
    await change('[data-fgeo-track="image"]', true);
    await page.waitForSelector('#figOut image[href^="data:image/"]');
    await page.evaluate(() => {
      window.__figureExports = []; const createURL = URL.createObjectURL;
      URL.createObjectURL = (blob) => { if (['image/svg+xml', 'image/png'].includes(blob.type)) window.__figureExports.push(blob); return createURL(blob); };
      document.addEventListener('click', (event) => { if (event.target.closest?.('a[download]')) event.preventDefault(); }, true);
    });
    await click('#figSvg'); await click('#figPng');
    await page.waitForFunction(() => window.__figureExports.some((blob) => blob.type === 'image/png'));
    const exports = await page.evaluate(async () => ({ svg: await window.__figureExports.find((b) => b.type === 'image/svg+xml').text(),
      signature: [...new Uint8Array(await window.__figureExports.find((b) => b.type === 'image/png').arrayBuffer()).slice(0, 8)] }));
    assert.match(exports.svg, /data-role="abundance" opacity="0.35"/);
    assert.deepEqual(exports.signature, [137, 80, 78, 71, 13, 10, 26, 10]);
    await change('[data-fview="axis"]', 'depth');
    await change('#figGeoCore', 'numeric-core');
    await page.waitForFunction(() => document.querySelector('#figOut svg')?.textContent.includes('Numeric only'));
    assert.equal(await page.$('#figOut [data-role="abundance"]'), null);
    assert.equal(await page.$eval('[data-fgeo-track="species"]', (input) => input.disabled), true);
    await click('#figGeoCompositionReset');
    assert.equal(await page.evaluate(() => window.ichantool.S.fig.geoView == null && window.ichantool.S.fig.taxaStyles.geolog == null), true);
    await change('#figGeoCore', 'imp-age-core');
    await page.waitForFunction(() => document.querySelector('#figOut svg')?.textContent.includes('Imported age core'));
    await change('[data-fview="axis"]', 'age');
    await page.waitForFunction(() => document.querySelector('#figOut svg')?.textContent.includes('(ka)') && document.querySelector('#figOut image[href^="data:image/"]'));
    await click(`[data-ftab="${secondTab}"] .ftl`);
    assert.equal(await page.evaluate(() => window.ichantool.S.fig.taxaStyles.geolog.opacity), 0.8);
    assert.deepEqual(errors, []);
    console.log('Multiproxy figures: taxa/proxies, independent composition, mixed core units, own age model, exact data, tabs, save/reload, reset and SVG/PNG verified.');
  } catch (error) {
    console.error('Multiproxy figure errors:', errors);
    console.error('Multiproxy figure state:', await page.evaluate(() => JSON.stringify({ fig: window.ichantool.S.fig, output: document.getElementById('figOut').textContent.slice(0, 500) })));
    throw error;
  } finally { await page.close(); }
}
