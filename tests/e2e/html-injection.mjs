// Card Q9: a hostile project file, imported as a user would (the "import project" file input), cannot add elements or event attributes to the
// pages that show its names, identifiers, units, settings, colours and thumbnails, and its text is shown literally.
import assert from 'node:assert/strict';
import { eventShadingFixture } from './event-shading.mjs';

const PAYLOAD = '"><img src=x data-injected="1" onerror="window.__xss=1">';
const PAYLOAD_SQ = "'><img src=x data-injected=\"1\" onerror=\"window.__xss=1\">";

/** The synthetic project of the event-shading test with a payload in every field that reaches the interface as markup. */
export function hostileProjectFixture() {
  const p = eventShadingFixture(), core = p.cores[0], other = p.cores[1], section = core.sections[0];
  const coreId = 'core' + PAYLOAD, layerId = 'climate' + PAYLOAD, clfId = 'model' + PAYLOAD;
  p.id = 'project' + PAYLOAD; p.name = 'Project ' + PAYLOAD_SQ;
  core.id = coreId; core.name = 'Core ' + PAYLOAD; core.units = 'cm'; core.lat = PAYLOAD; core.lon = PAYLOAD_SQ;
  other.name = 'Other ' + PAYLOAD_SQ; other.units = PAYLOAD;
  section.id = 'section' + PAYLOAD; section.name = 'Section ' + PAYLOAD_SQ;
  section.objects[0].th = 'x" onerror="window.__xss=1';
  section.objects[1].th = 'javascript:window.__xss=1';
  p.classes.forEach((c) => { c.name = c.name + ' ' + PAYLOAD_SQ; });
  const g = p.geo;
  g.layers[0].id = layerId; g.layers[0].name = 'Climate ' + PAYLOAD; g.layers[1].name = 'Beds ' + PAYLOAD_SQ;
  g.layers[0].cats.forEach((cat) => { cat.name += ' ' + PAYLOAD; });
  g.settings.target = layerId;
  for (const iv of g.intervals) { if (iv.core === core.id || iv.core === 'taxon-core') iv.core = coreId; if (iv.layer === 'climate') iv.layer = layerId; }
  Object.assign(g.classifiers[0], { id: clfId, name: 'Model ' + PAYLOAD, targets: [layerId], minProb: PAYLOAD, seed: PAYLOAD_SQ, params: { knn: { k: PAYLOAD } } });
  p.comments = [{ id: 'comment' + PAYLOAD, author: 'A ' + PAYLOAD, date: Date.UTC(2026, 0, 1), text: 'Text ' + PAYLOAD,
    replies: [{ id: 'reply' + PAYLOAD_SQ, author: PAYLOAD_SQ, date: Date.UTC(2026, 0, 2), text: PAYLOAD }] }];
  p.plots = [{ name: 'Plot ' + PAYLOAD, layout: 'xy', cores: [coreId, 'shade-other'], v: 'depth', title: PAYLOAD, width: '1" onload="window.__xss=1', height: PAYLOAD,
    panelWidth: PAYLOAD, legend: true, grid: true, xmin: PAYLOAD, xmax: null, ymin: null, ymax: null, y2label: PAYLOAD,
    ys: [{ col: 'Ca', type: 'linesym', y2: false, fit: 'poly', deg: PAYLOAD, window: PAYLOAD, log: false, inv: false, color: 'red"/><script>window.__xss=1</script>' }] }];
  p.plotCur = 0;
  // ml.method and ml.k stay valid: an unknown method or a non-numeric k stops the classifier (learn.js, geo.js fitModel), a robustness
  // defect outside this card.
  p.settings = { ...p.settings, ml: { method: 'knn', k: 3, trees: PAYLOAD_SQ, maxDepth: PAYLOAD, minLeaf: PAYLOAD },
    novelty: PAYLOAD, trainOpt: { epochs: PAYLOAD }, sideW: { total: PAYLOAD } };
  p.finalTests = [{ at: '2026-01-01T00:00:00Z', repeat: PAYLOAD, n: PAYLOAD, target: PAYLOAD, method: PAYLOAD, scope: PAYLOAD, classifier: PAYLOAD,
    cores: [PAYLOAD], balanced: 0.5, accuracy: 0.5 }];
  p.library = [
    { key: 'lib-a', name: p.classes[0].name, x: [1, 2, 3], from: 'From ' + PAYLOAD, thumb: 'javascript:window.__xss=1' },
    { key: 'lib-b', name: p.classes[1].name, x: [1, 2, 3], from: PAYLOAD_SQ, thumb: 'x" onerror="window.__xss=1' },
  ];
  return p;
}

/**
 * Import the hostile project through the real file input and visit the views that render its fields. `page` shows the application
 * (fresh storage) and is left on the project.
 */
export async function verifyHtmlInjection(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => window.ichantool); await page.evaluate(() => window.ichantool.ready);
  const baseline = await page.evaluate(() => document.querySelectorAll('script, iframe, object, embed').length);
  // A small PNG for the section, written into the project file as base64 like an exported project.
  const project = hostileProjectFixture();
  await page.evaluate(async (project) => {
    const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 100;
    const context = canvas.getContext('2d'); context.fillStyle = '#bbbbbb'; context.fillRect(0, 0, 8, 100);
    project.cores[0].sections[0].file = { name: 'synthetic.png', type: 'image/png', b64: canvas.toDataURL('image/png').split(',')[1] };
    const presets = { app: 'SedCoreTool', kind: 'settings', presets: [{ id: 'preset' + project.id, name: 'Preset ' + project.name, filters: {}, detect: {} }] };
    const files = [new File([JSON.stringify(project)], 'hostile.sedcoretool.json', { type: 'application/json' }),
      new File([JSON.stringify(presets)], 'hostile-settings.json', { type: 'application/json' })];
    const input = document.getElementById('impProj'), transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  }, project);
  await page.waitForFunction((id) => window.ichantool.S.id === id && document.getElementById('busy').hidden, { timeout: 30000 }, project.id);

  const stored = await page.evaluate(() => {
    const { S } = window.ichantool;
    return { library: S.library.map((e) => e.thumb ?? null), objects: S.sections.flatMap((s) => [...s.objects.values()].map((o) => o._thumb ?? null)) };
  });
  assert.deepEqual(stored, { library: [null, null], objects: [null, null] }, 'hostile thumbnails are dropped on import');

  const check = async (where) => {
    await new Promise((resolve) => setTimeout(resolve, 150));   // an injected <img src=x onerror> would fire by now
    const found = await page.evaluate((baseline) => {
      const all = [...document.querySelectorAll('*')];
      return {
        injected: [...document.querySelectorAll('[data-injected]')].map((element) => {
          const path = []; for (let e = element.parentElement; e && path.length < 4; e = e.parentElement) path.push(e.id ? '#' + e.id : e.tagName.toLowerCase() + (e.className ? '.' + String(e.className).split(' ')[0] : ''));
          return path.join(' < ');
        }),
        active: document.querySelectorAll('script, iframe, object, embed').length - baseline,
        handlers: all.filter((element) => [...element.attributes].some((attribute) => /^on/i.test(attribute.name))).map((element) => element.outerHTML.slice(0, 120)),
        badImages: [...document.querySelectorAll('#mlBody img, #home img')].map((img) => img.getAttribute('src') || '').filter((src) => src && !src.startsWith('data:image/')),
        xss: window.__xss ?? null,
      };
    }, baseline);
    assert.deepEqual(found, { injected: [], active: 0, handlers: [], badImages: [], xss: null }, where);
  };
  const run = (fn, ...args) => page.evaluate(fn, ...args);
  const settle = () => page.waitForFunction(() => document.getElementById('busy').hidden);

  // Section mode: core and section selectors, objects list and the object panel, results, comments.
  await run(() => { document.getElementById('home').hidden = true; window.ichantool.setMode('section'); });
  await settle(); await check('section view');
  assert.ok(await run(() => [...document.querySelectorAll('#coreSel option')].some((o) => o.textContent.includes('Core "><img'))), 'core names are shown as text');
  for (const tab of ['object', 'learn', 'results', 'classes']) {
    await run((tab) => document.querySelector(`#sideTabs [data-tab="${tab}"]`)?.click(), tab);
    await settle(); await check(`side tab ${tab}`);
  }
  await run(() => { const list = document.getElementById('objList'); if (list) list.open = true; list?.dispatchEvent(new Event('toggle')); });
  await check('objects list');
  await run(() => document.getElementById('cmtBtn').click());
  await check('comments');
  assert.ok(await run(() => document.getElementById('cmtDlg').textContent.includes('Text "><img')), 'comment text is shown as text');
  await run(() => document.getElementById('cmtDlg').close());

  // Machine-learning panel, both lists of examples.
  await run(() => document.querySelector('#sideTabs [data-tab="learn"]')?.click());
  await settle();
  for (const scope of await run(() => [...(document.getElementById('mlScopeSel')?.options || [])].map((o) => o.value))) {
    await run((scope) => { const s = document.getElementById('mlScopeSel'); s.value = scope; s.dispatchEvent(new Event('change', { bubbles: true })); }, scope);
    await check(`ML examples (${scope})`);
  }

  // Data tab with the hostile plot, and the table.
  await run(() => window.ichantool.setMode('data')); await settle();
  for (const v of ['plot', 'table']) {
    await run((v) => { const s = document.getElementById('dView'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, v);
    await settle(); await check(`data ${v}`);
  }
  assert.ok(await run(() => !!document.querySelector('#plOut svg') || document.getElementById('dView').value === 'table'));

  // Multiproxy: cores, layers, classifiers, intervals, model.
  await run(() => window.ichantool.setMode('geo')); await settle(); await check('multiproxy');
  for (const tab of ['logs', 'map', 'model']) {
    await run((tab) => document.querySelector(`#sideTabs [data-tab="${tab}"], [data-tab="${tab}"]`)?.click(), tab);
    await settle(); await check(`multiproxy ${tab}`);
  }
  await run(async () => { await window.ichantool.geoTrain(true, window.ichantool.S.geo.classifiers[0]?.id); window.ichantool.renderGeo(); });
  await settle(); await check('multiproxy after training');

  // Start screen: project cards and the table of all projects and cores.
  await run(async () => { await window.ichantool.saveToDB(); await window.ichantool.showHome(); });
  await settle(); await check('start screen');
  for (const tab of await run(() => [...document.querySelectorAll('[data-htab]')].map((b) => b.dataset.htab))) {
    await run((tab) => document.querySelector(`[data-htab="${tab}"]`).click(), tab);
    await new Promise((resolve) => setTimeout(resolve, 400));
    await check(`start screen tab ${tab}`);
  }
  assert.ok(await run(() => document.getElementById('home').textContent.includes('Project \'><img')), 'project names are shown as text');
  assert.deepEqual(errors, [], 'no page errors');
}
