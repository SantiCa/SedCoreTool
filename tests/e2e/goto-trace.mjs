import assert from 'node:assert/strict';

/** Verify card Q18: centering on a trace in an unseen section is not overwritten by delayed fitView, while plain selection still fits. */
export async function verifyGotoTrace(browser, url) {
  const context = await browser.createBrowserContext(), page = await context.newPage(), errors = [];
  page.setDefaultTimeout(60000);
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(url, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.ichantool);
    await page.evaluate(() => window.ichantool.ready);
    await page.evaluate(() => document.getElementById('openTest').click());
    await page.waitForFunction(() => window.ichantool?.S.sections.length === 6
      && window.ichantool.S.sections.every((s) => s.objects.size > 0), { timeout: 60000 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    const result = await page.evaluate(async () => {
      const I = window.ichantool, { S, selectSection, centerOn } = I;
      const canvas = document.getElementById('view');
      const frames = (n) => new Promise((resolve) => {
        const step = (left) => (left <= 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
        step(n);
      });

      const i = S.sections.findIndex((s, idx) => idx > 0 && !s.view && s.objects.size > 0);
      const secA = S.sections[i];
      const midY = secA.h * 0.5;
      const target = [...secA.objects.values()].filter((o) => o.bbox).reduce((best, o) => {
        const cy = (o.bbox[1] + o.bbox[3]) / 2;
        const bestY = (best.bbox[1] + best.bbox[3]) / 2;
        return Math.abs(cy - midY) < Math.abs(bestY - midY) ? o : best;
      });
      const cx = (target.bbox[0] + target.bbox[2]) / 2;
      const cy = (target.bbox[1] + target.bbox[3]) / 2;

      selectSection(i);
      centerOn(target);
      const expectedView = { ...S.view };

      await frames(6);
      const afterGoto = { ...S.view };
      const curAfterGoto = S.cur;
      const screenCenter = {
        x: (cx - S.view.x) * S.view.zoom,
        y: (cy - S.view.y) * S.view.zoom,
        canvasW: canvas.width,
        canvasH: canvas.height,
        secH: secA.h,
      };

      const j = S.sections.findIndex((s, idx) => idx > 0 && idx !== i && !s.view);
      const secB = S.sections[j];
      const viewBeforePlain = { ...S.view };
      selectSection(j);
      await frames(6);
      const afterPlain = { ...S.view };
      const curAfterPlain = S.cur;

      return {
        i, j, curAfterGoto, expectedView, afterGoto, screenCenter, cy,
        curAfterPlain, viewBeforePlain, afterPlain,
        secBRoiY0: secB.roi.y0,
      };
    });

    assert.equal(result.curAfterGoto, result.i, 'S.cur stays on the target section');
    assert.ok(result.cy > result.screenCenter.secH * 0.3, `target cy (${result.cy}) is away from top-left`);
    assert.deepEqual(result.afterGoto, result.expectedView, 'S.view was not overwritten by delayed fitView');
    assert.ok(
      Math.abs(result.screenCenter.y - result.screenCenter.canvasH / 2) <= 2,
      `target bbox center y (${result.screenCenter.y}) should stay near #view vertical center (${result.screenCenter.canvasH / 2})`,
    );
    assert.ok(
      result.screenCenter.x >= 0 && result.screenCenter.x <= result.screenCenter.canvasW,
      `target bbox center x (${result.screenCenter.x}) should stay within #view width (${result.screenCenter.canvasW})`,
    );

    assert.equal(result.curAfterPlain, result.j, 'S.cur switches to the second unseen section');
    assert.notDeepEqual(result.afterPlain, result.viewBeforePlain, 'selecting an unseen section without changing view still runs delayed fitView');
    const expectedFitY = result.secBRoiY0 - 12 / result.afterPlain.zoom;
    assert.ok(Math.abs(result.afterPlain.y - expectedFitY) < 1e-6, `plain unseen section y (${result.afterPlain.y}) matches fitView (${expectedFitY})`);
    assert.deepEqual(errors, []);
    console.log('Go-to-trace: centerOn preserved on unseen section; plain unseen selection still runs fitView.');
  } finally {
    await context.close();
  }
}
