// Card Q23: zero-presence taxon line removal, photo/proxies in range charts, and compact distribution view.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLogSVG, buildRangeSVG, taxaOptions } from '../../app/js/log.js';

const classes = [
  { name: 'Chondrites', index: 0, color: '#123456' },
  { name: 'Planolites', index: 1, color: '#654321' },
];

const abundanceGroups = (svg) => [...svg.matchAll(/<g data-taxon="([^"]*)" data-role="abundance"[^>]*>(.*?)<\/g>/gs)].map((m) => [m[1], m[2]]);

const parsePoints = (pointsStr) => pointsStr.trim().split(/\s+/).map((pair) => pair.split(',').map(Number));

test('zero-presence intervals emit no coloured polygon or polyline across 0% spans in kite, line, and area modes', () => {
  const values = [0, 0, 25, 0, 0, 15, 0];
  const rows = values.map((v, i) => ({ a0: i, a1: i + 1, pct: 30, classPct: [v, 0] }));
  const base = { from: 0, to: 7, height: 700, rows, classes, records: [], tracks: { species: true }, colWidths: { 'sp:Chondrites': 80 } };

  for (const abundance of ['kite', 'line', 'area']) {
    const tag = abundance === 'line' ? /<polyline points="([^"]*)"/g : /<polygon points="([^"]*)"/g;
    for (const [label, res] of [
      ['buildLogSVG', buildLogSVG({ ...base, taxa: { layout: 'separate', abundance, scale: 'percent' } })],
      ['buildRangeSVG(taxa)', buildRangeSVG({ ...base, colW: 80, taxa: { layout: 'separate', abundance, scale: 'percent' } })],
    ]) {
      const chGroup = abundanceGroups(res.svg).find(([name]) => name === 'Chondrites')?.[1] ?? '';
      const shapes = [...chGroup.matchAll(tag)].map((m) => parsePoints(m[1]));
      assert.equal(shapes.length, 2, `${label} ${abundance} emits two separate positive lobes`);

      const top = label === 'buildLogSVG' ? res.plotTop : +(/<line x1="72" y1="([\d.]+)" x2="72"/.exec(res.svg)?.[1] ?? 0);
      assert.ok(top > 0, `${label} ${abundance} parsed plotTop`);
      const yAt = (d) => top + (d / 7) * 700;
      const zeroMidLo = yAt(3), zeroMidHi = yAt(5);
      for (const pts of shapes) {
        for (const [, y] of pts) {
          assert.ok(y <= zeroMidLo + 0.05 || y >= zeroMidHi - 0.05, `${label} ${abundance} vertex y=${y} must not lie inside zero-only span (${zeroMidLo}, ${zeroMidHi})`);
        }
      }
      if (abundance === 'kite') {
        assert.match(res.svg, /stroke-opacity="0\.25"/, `${label} keeps faint center axis guide`);
      }
    }
  }

  // Legacy buildRangeSVG kite mode (without taxa object) also splits at 0-presence intervals.
  const legacyKite = buildRangeSVG({ from: 0, to: 7, height: 700, rows, classes, display: 'kite', colW: 60 }).svg;
  const legacyPolys = [...legacyKite.matchAll(/<polygon points="([^"]+)" fill="#123456"/g)].map((m) => parsePoints(m[1]));
  assert.equal(legacyPolys.length, 2);
});

test('buildRangeSVG supports core images and proxy records with gap breaks, colOrder, and colHide while preserving default output', () => {
  const rows = [
    { a0: 0, a1: 5, pct: 20, classPct: [20, 0] },
    { a0: 5, a1: 10, pct: 30, classPct: [10, 15] },
  ];
  const baseInput = { from: 0, to: 10, height: 200, rows, classes, display: 'kite', total: true };
  const plain = buildRangeSVG(baseInput);
  assert.deepEqual(plain.columns.map((c) => c.id), ['sp:Chondrites', 'sp:Planolites']);
  assert.doesNotMatch(plain.svg, /<image|<polyline/);

  const images = [{ href: 'data:image/png;base64,AAA', w: 50, title: 'Enh' }];
  const records = [{
    name: 'Ca',
    color: '#0b5394',
    reverse: false,
    pts: [[0, 1], [2, 3], [5, null], [7, 5], [10, 7]],
  }];
  const full = buildRangeSVG({ ...baseInput, images, records });
  assert.deepEqual(full.columns.map((c) => c.id), ['image:Enh', 'total', 'sp:Chondrites', 'sp:Planolites', 'rec:Ca']);
  assert.match(full.svg, /<image [^>]*href="data:image\/png;base64,AAA"/);
  // Null at depth 5 splits Ca into two separate polylines rather than bridging the gap.
  const polylines = [...full.svg.matchAll(/<polyline fill="none" stroke="#0b5394"[^>]*points="([^"]+)"/g)];
  assert.equal(polylines.length, 2);

  // Respects colOrder and colHide on image:* and rec:* without dropping them from columns.
  const reordered = buildRangeSVG({
    ...baseInput,
    images,
    records,
    style: {
      colHide: ['image:Enh'],
      colOrder: ['rec:Ca', 'sp:Planolites', 'sp:Chondrites', 'total'],
    },
  });
  assert.ok(reordered.columns.some((c) => c.id === 'image:Enh'));
  assert.doesNotMatch(reordered.svg, /<image /);
  const recMatch = /<text x="([\d.]+)"[^>]*><tspan[^>]*>Ca<\/tspan><\/text>/.exec(reordered.svg);
  const chMatch = /translate\(([\d.]+),[\d.]+\) rotate\(-60\)[^>]*>Chondrites<\/text>/.exec(reordered.svg);
  assert.ok(recMatch && chMatch && +recMatch[1] < +chMatch[1], 'rec:Ca ordered before sp:Chondrites');

  // Supports record axis limits via style.axes['rec:...'] and rejects invalid log/min/max.
  assert.throws(() => buildRangeSVG({
    ...baseInput,
    records,
    style: { axes: { 'rec:Ca': { min: 10, max: 5 } } },
  }), /Invalid horizontal axis/);
});

test('buildLogSVG compact distribution mode forces separate layout, rotated italic headers, and narrow widths while defaults stay unchanged', () => {
  const rows = [
    { a0: 0, a1: 5, pct: 30, classPct: [20, 10] },
    { a0: 5, a1: 10, pct: 40, classPct: [15, 25] },
  ];
  const longClasses = [
    { name: 'Chondrites', index: 0, color: '#123456' },
    { name: 'Thalassinoides longissimus', index: 1, color: '#654321' },
  ];
  const baseLog = {
    from: 0, to: 10, height: 240, rows, classes: longClasses,
    records: [{ name: 'Ca', pts: [[0, 1], [10, 4]] }],
    tracks: { total: true, species: true },
  };

  assert.equal(taxaOptions({ layout: 'stack', compact: true }).layout, 'separate');
  assert.equal(taxaOptions().compact, false);

  const normal = buildLogSVG({ ...baseLog, taxa: { layout: 'separate', abundance: 'kite', occurrence: 'symbols', compact: false } });
  assert.equal(normal.plotTop, 84);
  assert.doesNotMatch(normal.svg, /rotate\(-60\)/);

  const compact = buildLogSVG({ ...baseLog, taxa: { layout: 'stack', abundance: 'kite', occurrence: 'symbols', compact: true } });
  assert.ok(compact.plotTop > 84, `compact plotTop (${compact.plotTop}) grows for tilted taxon names`);
  const spCols = compact.layout.filter((c) => c.key === 'sp1');
  assert.equal(spCols.length, 2);
  assert.ok(spCols.every((c) => c.w <= 34), `compact sp1 widths (${spCols.map((c) => c.w)}) <= 34`);
  assert.match(compact.svg, /rotate\(-60\)" font-style="italic" font-weight="600"[^>]*>Chondrites<\/text>/);
  assert.match(compact.svg, /rotate\(-60\)" font-style="italic" font-weight="600"[^>]*>Thalassinoides longissimus<\/text>/);
  assert.doesNotMatch(compact.svg, /NaN|Infinity/);
});
