import assert from 'node:assert/strict';

/**
 * Verify card Q16: the view and profile canvases are exactly as tall as the visible viewport pane after every window resize,
 * whatever the first window size was. Before Q16 the implicit grid row of `.viewport` was sized by the canvas content, so the
 * canvas kept the height of an earlier window (1754 px tall in a pane of about 860 px at 1600 x 1000).
 */
export async function verifyCanvasViewport(browser, url) {
  const context = await browser.createBrowserContext(), page = await context.newPage(), errors = [];
  page.setDefaultTimeout(60000);
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.setViewport({ width: 884, height: 561 });   // the headless window size before a test resizes it
    await page.goto(url, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.ichantool);
    await page.evaluate(() => window.ichantool.ready);
    await page.evaluate(() => document.getElementById('openTest').click());
    await page.waitForFunction(() => window.ichantool?.S.sections.length === 6, { timeout: 60000 });

    const measure = () => page.evaluate(() => new Promise((resolve) => {
      // Two frames let the ResizeObserver run resizeCanvases and the layout settle.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const pane = document.getElementById('viewport').getBoundingClientRect();
        const sizes = ['view', 'profile'].map((id) => {
          const canvas = document.getElementById(id), box = canvas.getBoundingClientRect();
          return { id, height: canvas.height, boxHeight: Math.round(box.height), boxBottom: Math.round(box.bottom) };
        });
        resolve({ paneHeight: Math.round(pane.height), paneBottom: Math.round(pane.bottom), sizes });
      }));
    }));

    for (const [width, height] of [[1600, 1000], [900, 600], [1440, 900], [1200, 1300], [1600, 1000]]) {
      await page.setViewport({ width, height });
      const m = await measure();
      for (const s of m.sizes) {
        const where = `${s.id} at ${width} x ${height}: ${JSON.stringify(m)}`;
        assert.ok(m.paneHeight > 0, `visible pane has no height (${where})`);
        assert.equal(s.boxHeight, m.paneHeight, `canvas box height differs from the visible pane (${where})`);
        assert.equal(s.height, m.paneHeight, `canvas pixel height differs from the visible pane (${where})`);
        assert.ok(s.boxBottom <= m.paneBottom, `canvas extends below the visible pane (${where})`);
      }
    }
    assert.deepEqual(errors, []);
    console.log('canvas height follows the visible pane on every resize: OK');
  } finally {
    await context.close();
  }
}
