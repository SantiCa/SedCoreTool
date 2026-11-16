// Measure the real Data table handlers in a disposable browser profile.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { prepareDataTableFixture, captureDataTableCSV } from './data_table_fixture.mjs';
const { default: puppeteer } = await import(process.env.PUPPETEER_MODULE || 'puppeteer-core');

const [url, profilePath, chrome, rowArgument, runMode, expansionArgument = '1', viewportArgument = 'native'] = process.argv.slice(2);
const rowCount = Number(rowArgument), profiling = runMode === 'profile';
const expansionSteps = Number(expansionArgument);
const viewport = viewportArgument === 'viewport';
const browser = await puppeteer.launch({ executablePath: chrome, userDataDir: profilePath,
  headless: true, args: ['--no-sandbox'], defaultViewport: { width: 1440, height: 900 } });
const errors = [];
try {
  const [page] = await browser.pages();
  page.setDefaultTimeout(120000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#projList .pempty');
  const fixture = await page.evaluate(prepareDataTableFixture, rowCount);
  // Configure the session through the real controls before measuring either rendering mode.
  await page.evaluate((enabled) => {
    document.getElementById('modeData').click();
    { const box = document.getElementById('dsViewport'); if (box.checked !== enabled) box.click(); }   // the visible-rows rendering has been the default since M2.1.3 was promoted
    document.getElementById('modeSection').click();
  }, viewport);
  await new Promise((resolve) => setTimeout(resolve, 400));
  const client = await page.createCDPSession();
  await client.send('HeapProfiler.collectGarbage');
  if (profiling) { await client.send('Profiler.enable'); await client.send('Profiler.start'); }
  const timings = await page.evaluate(async (steps) => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const measure = async (action) => { const start = performance.now(); action(); void document.getElementById('dBody').offsetHeight; await frame(); return performance.now() - start; };
    const open_ms = await measure(() => document.getElementById('modeData').click());
    const domRows = () => document.querySelectorAll('#dBody tbody tr:not([data-spacer])').length;
    const available = () => Number(document.querySelector('#dBody .dsgrid').dataset.available || domRows());
    const initial = available(), initial_dom_rows = domRows();
    const edit_ms = await measure(() => document.getElementById('dsEdit').click());
    const cell = document.querySelector('#dBody tr[data-row="1"] td[data-col="value_0"]')
      || document.querySelector('#dBody tbody tr:nth-child(2) td[data-col="value_0"]');
    const select_ms = await measure(() => {
      cell.focus(); const range = document.createRange(); range.selectNodeContents(cell);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    });
    const selected = window.getSelection().toString() === cell.textContent && document.activeElement === cell;
    const more_ms = await measure(() => document.getElementById('dMore').click());
    const expanded = available(), expanded_dom_rows = domRows();
    const expansion_timings = [{ rows: expanded, dom_rows: domRows(), render_ms: more_ms }];
    for (let step = 1; step < steps && document.getElementById('dMore'); step++) {
      const render_ms = await measure(() => document.getElementById('dMore').click());
      expansion_timings.push({ rows: available(), dom_rows: domRows(), render_ms });
    }
    const displayed = available();
    const grid = document.querySelector('#dBody .dsgrid');
    const scroll_ms = await measure(() => { grid.scrollTop = grid.scrollHeight; });
    const final_dom_rows = domRows();
    const final_row = document.querySelector('#dBody tbody tr:not([data-spacer]):last-child')
      || [...document.querySelectorAll('#dBody tbody tr[data-row]')].at(-1);
    const tail = [...document.querySelectorAll('#dBody td[data-col="value_0"]')].reverse().find((element) => element.textContent);
    const expanded_select_ms = await measure(() => {
      tail.focus(); const range = document.createRange(); range.selectNodeContents(tail);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    });
    return { open_ms, edit_ms, select_ms, more_ms, scroll_ms, initial, expanded, displayed, selected,
      initial_dom_rows, expanded_dom_rows, final_dom_rows,
      final_row_verified: Number(final_row?.children[0].textContent) === displayed,
      expanded_selected: window.getSelection().toString() === tail.textContent && document.activeElement === tail,
      expansion_timings, expansion_total_ms: expansion_timings.reduce((sum, step) => sum + step.render_ms, 0),
      last_expansion_ms: expansion_timings.at(-1).render_ms, expanded_select_ms,
      scroll_verified: grid.scrollTop > 0 && grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 2 };
  }, expansionSteps);
  let cpu, cpu_export;
  if (profiling) {
    const { profile } = await client.send('Profiler.stop');
    cpu = profileSites(profile);
    await client.send('Profiler.start');
    await page.evaluate(captureDataTableCSV, { rowCount, verify: false });
    const exportedProfile = await client.send('Profiler.stop');
    cpu_export = profileSites(exportedProfile.profile);
    await client.send('Profiler.disable');
  }
  const exported = await page.evaluate(captureDataTableCSV, { rowCount });
  assert.equal(timings.initial, 400); assert.equal(timings.expanded, fixture.more_display_rows);
  assert.equal(timings.displayed, Math.min(rowCount, 400 + 1000 * expansionSteps));
  assert.equal(timings.expanded_selected, true);
  assert.equal(timings.selected, true); assert.equal(timings.scroll_verified, true);
  assert.equal(timings.final_row_verified, true);
  if (viewport) for (const count of [timings.initial_dom_rows, timings.expanded_dom_rows, timings.final_dom_rows]) assert.ok(count <= 100);
  assert.deepEqual(errors, []);
  const { data, ...verification } = exported;
  console.log(JSON.stringify({ fixture, expansion_steps: expansionSteps, ...timings, ...verification,
    csv_sha256: createHash('sha256').update(data).digest('hex'), cpu, cpu_export,
    chrome: await browser.version(), node: process.version,
    puppeteer: createRequire(process.env.PUPPETEER_MODULE || import.meta.url)('puppeteer-core/package.json').version }));
  await client.detach();
} finally { await browser.close(); }

function profileSites(profile) {
  const durations = new Map();
  (profile.samples || []).forEach((id, index) => durations.set(id, (durations.get(id) || 0) + profile.timeDeltas[index]));
  const sites = new Map();
  for (const node of profile.nodes) {
    const url = node.callFrame.url;
    const source = url.startsWith('pptr:') ? '(benchmark)' : url.split('/').slice(-2).join('/') || '(runtime)';
    const key = `${source}:${node.callFrame.lineNumber}:${node.callFrame.functionName}`;
    const site = sites.get(key) || { function: node.callFrame.functionName || '(anonymous)', source,
      line: node.callFrame.lineNumber + 1, sampled_self_ms: 0 };
    site.sampled_self_ms += (durations.get(node.id) || 0) / 1000;
    sites.set(key, site);
  }
  return [...sites.values()].filter((site) => site.sampled_self_ms > 0)
    .sort((a, b) => b.sampled_self_ms - a.sampled_self_ms).slice(0, 25);
}
