import test from 'node:test';
import assert from 'node:assert/strict';
import { fitCurve, buildXYPlot, buildStratPlot, pearson, plotStats, axisRange, decimatePerPixel } from '../../app/js/plot.js';
import { minOf, maxOf } from '../../app/js/core.js';

test('curve fits recover known functions', () => {
  const x = [1, 2, 3, 4, 5, 6], lin = x.map((v) => 2 + 3 * v), ex = x.map((v) => 1.5 * Math.exp(0.4 * v)), pw = x.map((v) => 2 * v ** 1.5), lg = x.map((v) => 1 + 2 * Math.log(v));
  const f1 = fitCurve(x, lin, 'linear'); assert.ok(Math.abs(f1.coef[1] - 3) < 1e-9 && Math.abs(f1.r2 - 1) < 1e-12);
  assert.ok(Math.abs(fitCurve(x, ex, 'exp').coef[1] - 0.4) < 1e-9);
  assert.ok(Math.abs(fitCurve(x, pw, 'power').coef[1] - 1.5) < 1e-9);
  assert.ok(Math.abs(fitCurve(x, lg, 'log').coef[1] - 2) < 1e-9);
  assert.ok(Math.abs(fitCurve(x, x.map((v) => v * v - v), 'poly', { deg: 2 }).coef[2] - 1) < 1e-9);
  assert.equal(fitCurve(x, lin, 'movavg', { window: 3 }).pts.length, 6);
  assert.ok(Math.abs(pearson(x, lin) - 1) < 1e-12); assert.equal(plotStats([1, 2, 3, null]).median, 2);
  assert.deepEqual(axisRange([1, 10], { log: true }), [1, 10]);
});

test('plots render SVG with fits and panels', () => {
  const x = [0, 1, 2, 3, 4], y = [1, 3, 2, 5, 4];
  const r = buildXYPlot({ title: 'T', x: { label: 'X' }, y: { label: 'Y' }, series: [{ name: 'a', x, y, type: 'linesym', fit: 'linear' }, { name: 'b', x, y: y.map((v) => v * 10), type: 'bar', y2: true }] });
  assert.match(r.svg, /<svg/); assert.equal(r.fits.length, 1); assert.match(r.svg, /\(Y2\)/);
  const s = buildStratPlot({ v: { label: 'Prof.' }, panels: [{ label: 'Ti/Ca', series: [{ name: 'A', x, y }] }, { label: 'TOC', series: [{ name: 'A', x, y, type: 'area' }] }] });
  assert.equal((s.svg.match(/clip-path="url\(#sp/g) || []).length, 2);
});

// Card Q5: long lines are thinned per pixel column on screen only.
test('decimatePerPixel keeps the first, lowest, highest and last point of each pixel column, in order', () => {
  const pts = [[0.1, 5], [0.4, 9], [0.6, 1], [0.9, 4], [1.2, 7], [2.5, 3]];
  assert.deepEqual(decimatePerPixel(pts, 0), [[0.1, 5], [0.4, 9], [0.6, 1], [0.9, 4], [1.2, 7], [2.5, 3]]);
  const many = [[3.0, 2], [3.1, 8], [3.2, 0], [3.3, 5], [3.4, 6], [3.9, 4]];
  assert.deepEqual(decimatePerPixel(many, 0), [[3.0, 2], [3.1, 8], [3.2, 0], [3.9, 4]]);
  assert.deepEqual(decimatePerPixel([[5, 10.2], [7, 10.7], [6, 11.1]], 1), [[5, 10.2], [7, 10.7], [6, 11.1]]);   // along y (stratigraphic panels)
  assert.deepEqual(decimatePerPixel([], 0), []);
});

test('a decimated plot of 10^5 points keeps the envelope of every pixel column; without `decimate` every point is drawn', () => {
  const n = 1e5, x = Array.from({ length: n }, (_, i) => i), y = x.map((i) => Math.sin(i / 50) * 10 + (i % 7));
  const spec = { width: 760, height: 480, x: { label: 'x' }, y: { label: 'y' }, series: [{ name: 's', x, y, type: 'line' }] };
  const commands = (svg) => (svg.match(/[ML]-?\d/g) || []).length;
  const full = buildXYPlot(spec).svg, thin = buildXYPlot({ ...spec, decimate: true }).svg;
  assert.ok(commands(full) >= n, `every point in the export (${commands(full)})`);
  assert.ok(commands(thin) <= 4 * 760, `at most four points per pixel column on screen (${commands(thin)})`);
  const extent = (svg) => { const ys = [...svg.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => +m[2]); return [minOf(ys), maxOf(ys)]; };
  assert.deepEqual(extent(thin), extent(full));
  const short = { ...spec, series: [{ name: 's', x: [1, 2, 3, 4], y: [4, 1, 3, 2], type: 'line' }] };
  assert.equal(buildXYPlot({ ...short, decimate: true }).svg, buildXYPlot(short).svg, 'a short series is drawn the same');
});
