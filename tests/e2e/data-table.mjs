import { prepareDataTableFixture, captureDataTableCSV } from '../../tools/data_table_fixture.mjs';

export async function verifyDataTable(browser, url) {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(url, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.ichantool);
    await page.evaluate(prepareDataTableFixture, 2400);
    const result = await page.evaluate(async () => {
      const { t } = await import('./js/i18n.js');
      document.getElementById('modeData').click();
      // The visible-rows rendering is the default; this test covers the native table, which stays available as the session rollback.
      { const box = document.getElementById('dsViewport'); if (box.checked) box.click(); }
      const { S } = window.ichantool;
      const initial = document.querySelectorAll('#dBody tbody tr').length;
      const total = document.getElementById('dInfo').textContent === t('data.info', { r: 2400, c: 6 });
      let reads = 0;
      const originals = S.cores.map((core) => core.proxies);
      try {
        for (const core of S.cores) core.proxies = Object.fromEntries(Object.entries(core.proxies).map(([name, values]) => [name,
          new Proxy(values, { get(target, property, receiver) { if (/^\d+$/.test(String(property))) reads++; return Reflect.get(target, property, receiver); } }),
        ]));
        document.getElementById('dsEdit').click();
      } finally { S.cores.forEach((core, index) => { core.proxies = originals[index]; }); }
      const bounded = reads === 400 * 6;
      document.getElementById('dMore').click();
      const rows = [...document.querySelectorAll('#dBody tbody tr')];
      const coreBoundary = rows[1200].querySelector('[data-col="value_1"]').dataset.core === 'table-core-1'
        && rows[1200].children[0].textContent === '1201';
      const cell = rows[1].querySelector('[data-col="value_0"]');
      cell.focus();
      const range = document.createRange(); range.selectNodeContents(cell);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      const selected = selection.toString() === cell.textContent && document.activeElement === cell;
      cell.textContent = '-901.234567'; cell.blur();
      const edited = S.cores[0].edits.value_0['1'].v === -901.234567;
      return { initial, expanded: rows.length, total, bounded, coreBoundary, selected, edited };
    });
    if (result.initial !== 400 || result.expanded !== 1400 || !['total', 'bounded', 'coreBoundary', 'selected', 'edited'].every((key) => result[key])) {
      throw new Error('Data table regression: ' + JSON.stringify(result));
    }
    await page.evaluate(captureDataTableCSV, { rowCount: 2400, edited: { row: 1, column: 0, value: -901.234567 } });
    await page.evaluate(() => { document.getElementById('dsRestoreAll').click(); document.getElementById('dsRestoreAll').click(); });
    await page.evaluate(captureDataTableCSV, { rowCount: 2400 });
    const filtered = await page.evaluate(async () => {
      const { t } = await import('./js/i18n.js');
      const core = document.getElementById('dCore'); core.value = 'table-core-1';
      core.dispatchEvent(new Event('change', { bubbles: true }));
      const correctCore = document.querySelector('#dBody td[data-col]').dataset.core === 'table-core-1'
        && document.getElementById('dInfo').textContent === t('data.info', { r: 1200, c: 6 });
      const layers = document.getElementById('dLayers'); layers.click();
      const hiddenLayers = document.querySelectorAll('#dBody th.src-lay').length === 0;
      layers.click();
      return correctCore && hiddenLayers && document.querySelectorAll('#dBody th.src-lay').length === 2
        && document.querySelectorAll('#dBody tbody tr').length === 400;
    });
    if (!filtered) throw new Error('Core/layer selection did not reset the displayed prefix correctly');
    const ageOnly = await page.evaluate(async () => {
      const I = window.ichantool, { t } = await import('./js/i18n.js');
      I.setMode('section');
      await I.loadProject({ app: 'SedCoreTool', kind: 'project', version: 5, id: 'data-table-axes',
        cores: [
          { id: 'depth', name: 'Depth', imp: { depth: Array.from({ length: 250 }, (_, i) => i), proxies: { upper: Array(250).fill(7) } } },
          { id: 'empty', name: 'Empty' },
          { id: 'age', name: 'Age only', imp: { age: Array.from({ length: 300 }, (_, i) => 2 * i), proxies: { lower: Array(300).fill(9) } } },
        ] });
      const selector = document.getElementById('dCore');
      selector.innerHTML = '<option value="__all">All cores</option>'; selector.value = '__all';
      I.setMode('data');
      const rows = document.querySelectorAll('#dBody tbody tr');
      return rows.length === 400 && rows[250].querySelector('[data-col="lower"]').dataset.core === 'age'
        && rows[250].querySelector('[data-col="lower"]').dataset.x === '0'
        && rows[0].querySelector('[data-col="lower"]').textContent === ''
        && document.getElementById('dInfo').textContent === t('data.info', { r: 550, c: 2 });
    });
    if (!ageOnly) throw new Error('Empty or age-only cores changed table boundaries, columns or row counts');
    const intervalLabels = await page.evaluate(async () => {
      const I = window.ichantool, { parseTable } = await import('./js/log.js');
      I.setMode('section');
      const values = Array.from({ length: 11 }, (_, i) => i);
      const layers = ['disjoint', 'overlap'].map((id) => ({ id, name: id,
        cats: ['Early', 'Middle', 'Late', 'First', 'Second'].map((name) => ({ id: id + name, name, color: '#567890' })) }));
      const intervals = ['depth', 'age'].flatMap((core) => {
        const scale = core === 'depth' ? 2 : 1;
        return [['disjoint', 6, 8, 'Late'], ['disjoint', 0, 2, 'Early'], ['disjoint', 2, 4, 'Middle'],
          ['overlap', 2, 8, 'First'], ['overlap', 0, 6, 'Second']].map(([layer, from, to, category], index) => ({
          id: core + index, core, layer, from: from * scale, to: to * scale, cat: layer + category, axis: 'age',
        }));
      });
      await I.loadProject({ app: 'SedCoreTool', kind: 'project', version: 5, id: 'data-table-intervals',
        cores: [{ id: 'depth', name: 'Depth', imp: { depth: values, age: values.map((x) => x * 2), proxies: { A: values } } },
          { id: 'age', name: 'Age', imp: { age: values, proxies: { A: values } } }], geo: { layers, intervals } });
      const selector = document.getElementById('dCore');
      selector.innerHTML = '<option value="__all">All cores</option>'; selector.value = '__all';
      document.getElementById('dLayers').checked = true;
      I.setMode('data');
      const disjoint = ['Early', 'Early', 'Middle', 'Middle', '', '', 'Late', 'Late', '', '', ''];
      const overlap = ['Second', 'Second', 'First', 'First', 'First', 'First', 'First', 'First', '', '', ''];
      const expected = [...values, ...values].map((x) => [disjoint[x], overlap[x]]);
      const displayed = [...document.querySelectorAll('#dBody tbody tr')].map((row) => [...row.children].slice(-2).map((cell) => cell.textContent));
      const createURL = URL.createObjectURL;
      const preventDownload = (event) => { if (event.target.closest?.('a[download]')) event.preventDefault(); };
      let csv;
      document.addEventListener('click', preventDownload, true);
      URL.createObjectURL = (blob) => { if (blob.type === 'text/csv') csv = blob; return createURL(blob); };
      try {
        document.getElementById('dCsv').click();
        const exported = parseTable(await csv.text()).text.map((row) => row.slice(-2));
        return JSON.stringify(displayed) === JSON.stringify(expected) && JSON.stringify(exported) === JSON.stringify(expected);
      } finally { URL.createObjectURL = createURL; document.removeEventListener('click', preventDownload, true); }
    });
    if (!intervalLabels) throw new Error('Table/CSV interval labels changed at overlaps, boundaries, gaps or axis conversion');
    if (errors.length) throw new Error('Data table page errors: ' + errors.join(' | '));
    console.log('Data table: bounded preparation, selection, edit/restore, complete CSV and interval labels verified.');
  } finally { await page.close(); }
}
