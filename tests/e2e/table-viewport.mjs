import assert from 'node:assert/strict';
import { prepareDataTableFixture, captureDataTableCSV } from '../../tools/data_table_fixture.mjs';

export async function verifyTableViewport(browser, url) {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const press = async (shortcut) => {
    const keys = shortcut.split('+'), key = keys.pop();
    for (const modifier of keys) await page.keyboard.down(modifier);
    try { await page.keyboard.press(key); }
    finally { for (const modifier of keys.reverse()) await page.keyboard.up(modifier); }
  };
  const frame = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const scrollTo = async (row) => {
    await page.evaluate((index) => {
      window.getSelection().removeAllRanges();
      document.querySelector('#dBody .dsgrid').scrollTop = index * 28;
    }, row);
    await frame();
  };
  try {
    await page.goto(url, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.ichantool);
    await page.evaluate(prepareDataTableFixture, 2400);
    await page.click('#modeData');
    // Default since 16 November 2026: the window is mounted without touching the checkbox.
    assert.equal(await page.$eval('#dsViewport', (input) => input.checked), true);
    assert.ok(await page.$$eval('#dBody tbody tr', (rows) => rows.length) < 100);
    // Rollback: unchecking returns to the native table for the session (400 rows), and checking again below restores the window.
    await page.click('#dsViewport');
    assert.equal(await page.$eval('#dsViewport', (input) => input.checked), false);
    assert.equal(await page.$$eval('#dBody tbody tr', (rows) => rows.length), 400);
    const bounded = await page.evaluate(() => {
      const { S } = window.ichantool, originals = S.cores.map((core) => core.proxies);
      let reads = 0;
      try {
        for (const core of S.cores) core.proxies = Object.fromEntries(Object.entries(core.proxies).map(([name, values]) => [name,
          new Proxy(values, { get(target, property, receiver) { if (/^\d+$/.test(String(property))) reads++; return Reflect.get(target, property, receiver); } }),
        ]));
        document.getElementById('dsViewport').click();
      } finally { S.cores.forEach((core, index) => { core.proxies = originals[index]; }); }
      const rows = [...document.querySelectorAll('#dBody tr[data-row]')];
      return { reads, rows: rows.length, heights: rows.map((row) => row.getBoundingClientRect().height) };
    });
    assert.ok(bounded.rows > 0 && bounded.rows < 100);
    assert.equal(bounded.reads, bounded.rows * 6);
    assert.ok(bounded.heights.every((height) => height === 28), JSON.stringify(bounded.heights));
    await page.click('#dsEdit');
    await page.focus('tr[data-row="1"] td[data-col="value_0"]');
    await press('Control+A'); await page.keyboard.type('-901.234567');
    await press('PageDown');
    assert.ok(await page.evaluate(() => Number(document.activeElement.closest('tr').dataset.row) > 1));
    await press('Control+End');
    // Card Q10: the window covers every row; there is no 400-row cap and no "Show more" button.
    assert.equal(await page.evaluate(() => document.activeElement.closest('tr').dataset.row), '2399');
    assert.equal(await page.$('#dMore'), null);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.col), 'value_5');
    assert.ok(await page.evaluate(() => {
      const grid = document.querySelector('.dsgrid').getBoundingClientRect();
      const header = document.querySelector('.dsgrid thead th').getBoundingClientRect();
      return Math.abs(header.top - grid.top) <= 2;
    }));
    await press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.col), 'value_4');
    await press('ArrowUp');
    assert.equal(await page.evaluate(() => document.activeElement.closest('tr').dataset.row), '2398');
    await press('Control+Home');
    assert.equal(await page.evaluate(() => document.activeElement.closest('tr').dataset.row), '0');
    await press('PageDown'); await press('PageUp');
    assert.equal(await page.evaluate(() => document.activeElement.closest('tr').dataset.row), '0');
    await page.evaluate(captureDataTableCSV, { rowCount: 2400, edited: { row: 1, column: 0, value: -901.234567 } });
    await page.focus('tr[data-row="1"] td[data-col="value_0"]');
    await page.click('#dsRestoreCell');
    await page.evaluate(captureDataTableCSV, { rowCount: 2400 });
    await page.setViewport({ width: 900, height: 900 });
    await scrollTo(1190);
    await page.focus('tr[data-row="1199"] td[data-col="value_5"]');
    await press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.closest('tr').dataset.row), '1200');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.core), 'table-core-1');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.col), 'value_0');
    await press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement.closest('tr').dataset.row), '1199');
    assert.ok(await page.evaluate(() => {
      const grid = document.querySelector('.dsgrid').getBoundingClientRect(), cell = document.activeElement.getBoundingClientRect();
      return cell.left >= grid.left && cell.right <= grid.right + 1;
    }));
    await page.setViewport({ width: 1440, height: 900 });
    await scrollTo(1290);
    await page.focus('tr[data-row="1300"] td[data-col="value_1"]');
    await press('Control+A'); await page.keyboard.type('42.125');
    // Collapsing the text selection lets the focused edit leave the mounted window.
    await press('ArrowRight');
    await scrollTo(0);
    assert.equal(await page.evaluate(() => window.ichantool.S.cores[1].edits.value_1['100'].v), 42.125);
    await page.evaluate(captureDataTableCSV, { rowCount: 2400, edited: { row: 1300, column: 1, value: 42.125 } });
    await page.click('#dsRestoreAll'); await page.click('#dsRestoreAll');
    await page.evaluate(captureDataTableCSV, { rowCount: 2400 });
    await scrollTo(0);
    await page.focus('tr[data-row="2"] td[data-col="value_0"]');
    const pasted = await page.evaluate(() => {
      const cell = document.activeElement, range = document.createRange(); range.selectNodeContents(cell);
      window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
      document.execCommand('insertHTML', false, '<div>1</div><div>2</div>');
      return { text: cell.textContent, height: cell.closest('tr').getBoundingClientRect().height };
    });
    assert.deepEqual(pasted, { text: '12', height: 28 });
    await press('Escape');
    await page.focus('tr[data-row="2"] td[data-col="value_0"]');
    await press('Control+A'); await page.keyboard.type('999'); await press('Escape');
    assert.equal(await page.evaluate(() => Object.keys(window.ichantool.S.cores[0].edits || {}).length), 0);
    await page.click('#dsEdit');
    const selected = await page.evaluate(() => {
      const cell = document.querySelector('tr[data-row="2"] td[data-col="value_0"]');
      const range = document.createRange(); range.selectNodeContents(cell);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      return selection.toString();
    });
    await page.evaluate(() => { document.querySelector('#dBody .dsgrid').scrollTop = 1350 * 28; });
    await frame();
    assert.equal(await page.evaluate(() => window.getSelection().toString()), selected);
    assert.ok(await page.$$eval('tr[data-row]', (rows) => rows.length > 1000));
    await scrollTo(1399);
    assert.ok(await page.$$eval('tr[data-row]', (rows) => rows.length < 100));
    assert.ok(await page.$('tr[data-row="1399"]'));
    await scrollTo(0);
    const point = await page.evaluate(() => {
      const cell = document.querySelector('tr[data-row="3"] td[data-col="value_0"]').getBoundingClientRect();
      const grid = document.querySelector('#dBody .dsgrid').getBoundingClientRect();
      return { x: cell.left + 12, y: cell.top + 12, bottom: grid.bottom - 8 };
    });
    await page.mouse.move(point.x, point.y); await page.mouse.down();
    await page.mouse.move(point.x, point.bottom, { steps: 12 });
    for (let step = 0; step < 4; step++) {
      await page.mouse.wheel({ deltaY: 420 }); await frame();
      await page.mouse.move(point.x + step % 2, point.bottom);
    }
    await page.mouse.up(); await frame();
    const drag = await page.evaluate(() => {
      const selection = window.getSelection();
      const row = (node) => (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement).closest('tr[data-row]');
      const anchor = row(selection.anchorNode), focus = row(selection.focusNode);
      const from = Number(anchor?.dataset.row), to = Number(focus?.dataset.row);
      const contiguous = Number.isFinite(from) && Number.isFinite(to) && Array.from({ length: Math.abs(to - from) + 1 }, (_, i) =>
        document.querySelector(`tr[data-row="${Math.min(from, to) + i}"]`)).every(Boolean);
      return { from, to, text: selection.toString().length, contiguous };
    });
    assert.ok(drag.text > 0 && drag.to > drag.from + 40 && drag.contiguous, JSON.stringify(drag));
    await scrollTo(1399);
    await page.click('#dsViewport');
    assert.equal(await page.$$eval('#dBody tbody tr', (rows) => rows.length), 400);
    await page.click('#dsViewport');
    await page.select('#dCore', 'table-core-1');
    assert.equal(await page.$eval('.dsgrid', (grid) => grid.dataset.available), '1200');
    assert.equal(await page.$eval('tr[data-row="0"] td[data-col]', (cell) => cell.dataset.core), 'table-core-1');
    await page.click('#dLayers');
    assert.equal(await page.$$eval('#dBody th.src-lay', (cells) => cells.length), 0);
    await page.click('#dLayers');
    await page.select('#dView', 'plot'); await page.select('#dView', 'table');
    assert.ok(await page.$('.dtable.dsviewport'));
    await page.evaluate(async () => {
      const I = window.ichantool; I.setMode('section');
      await I.loadProject({ app: 'SedCoreTool', kind: 'project', version: 5, id: 'viewport-axes', cores: [
        { id: 'depth', name: 'Depth', imp: { depth: Array.from({ length: 250 }, (_, i) => i), proxies: { upper: Array(250).fill(7) } } },
        { id: 'empty', name: 'Empty' },
        { id: 'age', name: 'Age only', imp: { age: Array.from({ length: 300 }, (_, i) => 2 * i), proxies: { lower: Array(300).fill(9) } } },
      ] });
      const selector = document.getElementById('dCore'); selector.innerHTML = '<option value="__all">All cores</option>'; selector.value = '__all';
      I.setMode('data');
    });
    await scrollTo(549);
    assert.equal(await page.$eval('tr[data-row="549"] td[data-col="lower"]', (cell) => cell.textContent), '9');
    assert.equal(await page.$eval('tr[data-row="549"] td[data-col="lower"]', (cell) => cell.dataset.x), '598');
    assert.equal(await page.$eval('tr[data-row="549"] td[data-col="upper"]', (cell) => cell.textContent), '');
    await page.select('#dCore', 'empty');
    assert.equal(await page.$$eval('tr[data-row]', (rows) => rows.length), 0);
    await page.evaluate(async () => {
      const I = window.ichantool; I.setMode('section');
      const depth = Array.from({ length: 600 }, (_, i) => i);
      await I.loadProject({ app: 'SedCoreTool', kind: 'project', version: 5, id: 'viewport-columns',
        cores: [{ id: 'columns', name: 'Columns', imp: { depth, proxies: { A: depth } },
          user: { manual: { d: [], v: [] } } }],
        sheet: { columns: [{ name: 'double', formula: '[A] * 2', core: 'all', interp: true }], cells: {} } });
      const selector = document.getElementById('dCore'); selector.innerHTML = '<option value="columns">Columns</option>'; selector.value = 'columns';
      I.setMode('data');
    });
    await page.click('#dsEdit');
    assert.equal(await page.$eval('tr[data-row="2"] td[data-col="double"]', (cell) => cell.isContentEditable), false);
    assert.equal(await page.$eval('tr[data-row="2"] td[data-col="double"]', (cell) => cell.textContent), '4');
    await page.focus('tr[data-row="3"] td[data-col="A"]');
    await press('Control+A'); await page.keyboard.type('12.25');
    await page.click('#modeSection');
    assert.equal(await page.evaluate(() => window.ichantool.S.cores[0].edits.A['3'].v), 12.25);
    await page.click('#modeData');
    assert.equal(await page.$eval('tr[data-row="3"] td[data-col="double"]', (cell) => cell.textContent), '24.5');
    await page.focus('tr[data-row="3"] td[data-col="A"]');
    await page.click('#dsRestoreCell');
    assert.equal(await page.$eval('tr[data-row="3"] td[data-col="double"]', (cell) => cell.textContent), '6');
    await page.focus('tr[data-row="2"] td[data-col="manual"]');
    await page.keyboard.type('7.75'); await press('Enter');
    assert.equal(await page.evaluate(() => {
      const manual = window.ichantool.S.cores[0].user.manual;
      return manual.v[manual.d.indexOf(2)];
    }), 7.75);
    // Repeated entry/exit must leave only the current controller responding to scroll and selection.
    for (let index = 0; index < 3; index++) { await page.click('#modeSection'); await page.click('#modeData'); }
    await scrollTo(600);
    assert.equal(await page.$eval('tr[data-row="600"] td[data-col="double"]', (cell) => cell.textContent), '1198');
    assert.ok(await page.$$eval('tr[data-row]', (rows) => rows.length < 100));
    const inherited = await browser.newPage();
    try {
      await inherited.goto(url, { waitUntil: 'networkidle0' });
      await inherited.evaluate(prepareDataTableFixture, 2400); await inherited.click('#modeData');
      assert.equal(await inherited.$eval('#dsViewport', (input) => input.checked), true);
    } finally { await inherited.close(); }
    await page.evaluate(prepareDataTableFixture, 100000);
    await page.click('#modeData');
    assert.equal(await page.$('#dMore'), null);
    await scrollTo(99999);
    assert.equal(await page.$eval('tr[data-row="99999"] td[data-col]', (cell) => cell.dataset.core), 'table-core-1');
    assert.equal(await page.$eval('tr[data-row="99999"] td[data-col]', (cell) => cell.dataset.x), '49999');
    assert.ok(await page.$$eval('tr[data-row]', (rows) => rows.length < 100));
    await page.focus('tr[data-row="99999"] td[data-col="value_0"]');
    await press('Control+Home');
    assert.equal(await page.evaluate(() => document.activeElement.closest('tr').dataset.row), '0');
    await press('Control+End');
    assert.equal(await page.evaluate(() => document.activeElement.closest('tr').dataset.row), '99999');
    // Card Q10: 10,000 rows are reachable by scrolling alone, and a large SVG becomes a PNG through a Blob URL that is revoked afterwards.
    await page.evaluate(prepareDataTableFixture, 10000);
    await page.click('#modeSection'); await page.click('#modeData');
    assert.equal(await page.$('#dMore'), null);
    await scrollTo(9999);
    assert.ok(await page.$('tr[data-row="9999"]'));
    assert.ok(await page.$$eval('tr[data-row]', (rows) => rows.length < 100));
    const png = await page.evaluate(async () => {
      const { withSvgImage } = await import('./js/panels.js');
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="6000" height="4000">${Array.from({ length: 3000 }, (_, i) => `<rect x="${i}" y="${i % 4000}" width="40" height="40" fill="#369"/>`).join('')}</svg>`;
      let src = '';
      const blob = await withSvgImage(svg, async (img) => {
        src = img.src;
        const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
        canvas.getContext('2d').drawImage(img, 0, 0);
        return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      });
      const stillLoads = await fetch(src).then(() => true, () => false);
      return { blobUrl: src.startsWith('blob:'), bytes: blob?.size || 0, stillLoads };
    });
    assert.ok(png.blobUrl && png.bytes > 1000 && !png.stillLoads, JSON.stringify(png));
    assert.deepEqual(errors, []);
    console.log('Viewport table: bounded rows, native selection/drag, scrolling edits, keyboard navigation, filters, rollback and age-only cores verified.');
  } finally { await page.close(); }
}
