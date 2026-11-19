import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTable, guessAxisColumn, niceTicks, invertModel, toAxis, compositeRows, buildLogSVG, windowCSV, wrapTitle, abbrevs, buildRangeSVG, verticalTicks, traceSymbolPath } from '../../app/js/log.js';
import { downsampleRGBA } from '../../app/js/imageproc.js';

test('editable colours apply to core and range figures without showing hidden marks', () => {
  const style = { biColor: '#111112', iiColor: '#222223', manualColor: '#333334', textColor: '#444445', bgColor: '#555556', frameColor: '#666667', barColor: '#777778' };
  const rows = [{ a0: 0, a1: 1, pct: 30, classPct: [30], BI: 2, ii: 3, BIm: 1, iim: 2 }];
  const classes = [{ name: 'A', color: '#123456', index: 0 }];
  const result = buildLogSVG({ from: 0, to: 1, height: 100, rows, classes, tracks: { BI: true, ii: true, manual: true }, records: [], marks: [], idList: null, style });
  const { svg } = result;
  for (const color of ['#111112', '#222223', '#333334', '#444445', '#555556', '#666667']) assert.ok(svg.includes(color));
  assert.doesNotMatch(svg, /#c98a4b|#1c2422|Identified ichnotaxa/);
  assert.ok(!result.layout.some((c) => c.key === 'marks' || c.key === 'idlist'));
  const range = buildRangeSVG({ from: 0, to: 1, height: 100, rows, classes, total: true, style }).svg;
  for (const color of ['#777778', '#555556', '#444445']) assert.ok(range.includes(color));
});

test('parseTable: comma, semicolon with decimal comma, whitespace, comments', () => {
  assert.deepEqual(parseTable('depth,L*\n0.1,41.7\n0.2,45.5\n').rows, [[0.1, 41.7], [0.2, 45.5]]);
  assert.deepEqual(parseTable('# c\nprof;Ca\n1,5;3,25\n').rows, [[1.5, 3.25]]);
  assert.deepEqual(parseTable('1 2\n3 4').headers, ['col1', 'col2']);
});

test('axis column guess', () => {
  assert.deepEqual(guessAxisColumn(['sample', 'depth_m', 'Ca']), { col: 1, axis: 'depth' });
  assert.deepEqual(guessAxisColumn(['age_ka', 'd18O']), { col: 0, axis: 'age' });
});

test('ticks and axis transforms', () => {
  assert.deepEqual(niceTicks(0, 10, 5), [0, 2, 4, 6, 8, 10]);
  const m = { depth: [0, 10], age: [0, 100] };
  assert.equal(toAxis(5, 'depth', 'age', m), 50);
  assert.equal(toAxis(50, 'age', 'depth', m, invertModel(m)), 5);
  assert.equal(toAxis(5, 'depth', 'depth', null), 5);
});

test('composite rows, SVG and CSV', () => {
  const bins = [{ dTop: 0, dBottom: 1, depth: 0.5, pct: 20, classPct: [10, 10], BI: 2, ii: 3, BIm: 3, iim: null },
    { dTop: 1, dBottom: 2, depth: 1.5, pct: 40, classPct: [40, 0], BI: 3, ii: 4, BIm: null, iim: null }];
  const model = { depth: [0, 2], age: [0, 20] };
  const rows = compositeRows([{ name: 'S1', bins }], { axis: 'age', model });
  assert.deepEqual(rows.map((r) => [r.a0, r.a1, r.age]), [[0, 10, 5], [10, 20, 15]]);
  const classes = [{ name: 'A', color: '#ff0000', index: 0 }, { name: 'B', color: '#0000ff', index: 1 }];
  const { svg } = buildLogSVG({ title: 'T', axisLabel: 'Age (ka)', from: 0, to: 20, height: 200, rows, classes,
    tracks: { total: true, species: true, BI: true, ii: true, manual: true }, records: [{ name: 'L*', color: '#000', pts: [[2, 1], [18, 3]] }] });
  assert.ok(svg.startsWith('<svg') && svg.includes('polyline') && svg.includes('>A<'));
  const csv = windowCSV({ rows, from: 0, to: 20, classes, records: [{ name: 'L*', axis: 'depth', x: [0, 2], y: [0, 4] }], units: 'm', ageUnits: 'ka' });
  assert.deepEqual(csv.split('\n')[0].split(',').slice(-3), ['L* (mean)', 'L* (n)', 'note']);
  assert.deepEqual(csv.split('\n')[1].split(',').slice(-3), ['0', '1', ''], 'card Q4: the mean of the samples in [0, 1) by default');
  const point = windowCSV({ rows, from: 0, to: 20, classes, records: [{ name: 'L*', axis: 'depth', x: [0, 2], y: [0, 4] }], units: 'm', ageUnits: 'ka', recordMode: 'point' });
  assert.deepEqual(point.split('\n')[1].split(',').slice(-2), ['1', ''], 'or the value at the centre');
});

test('downsample averages blocks', () => {
  const src = new Uint8ClampedArray([0, 0, 0, 255, 100, 100, 100, 255, 200, 200, 200, 255, 100, 100, 100, 255]);
  const r = downsampleRGBA(src, 2, 2, 2);
  assert.equal(r.w, 1); assert.equal(r.rgba[0], 100);
});

test('track names wrap to two lines and column widths can be set per track (V25)', () => {
  assert.deepEqual(wrapTitle('XRF Ti/Ca', 120), ['XRF Ti/Ca']);
  assert.deepEqual(wrapTitle('Capas orgánicas de la cuenca', 56), ['Capas', 'orgánica…']);
  const recs = [{ name: 'A', color: '#000', pts: [[0, 1], [1, 2]] }, { name: 'B b b', color: '#000', pts: [[0, 1], [1, 3]] }];
  const base = { from: 0, to: 1, height: 100, rows: [], classes: [], tracks: {}, records: recs };
  const r1 = buildLogSVG(base), r2 = buildLogSVG({ ...base, colWidths: { 'rec:A': 200 }, recWidth: 90 });
  assert.equal(r1.layout.find((c) => c.id === 'rec:A').w, 120);
  assert.equal(r2.layout.find((c) => c.id === 'rec:A').w, 200);
  assert.equal(r2.layout.find((c) => c.id === 'rec:B b b').w, 90);
  assert.ok(r2.width > r1.width);
});

test('identification mode: marks, identified-ichnotaxa column, legend; unique abbreviations; range chart (V32)', () => {
  const ab = abbrevs(['Chondrites', 'Planolites', 'Phycosiphon', 'Palaeophycus', 'Chondrites b']);
  assert.equal(ab.get('Chondrites'), 'Ch'); assert.equal(ab.get('Planolites'), 'Pl'); assert.equal(new Set(ab.values()).size, 5);
  const base = { from: 0, to: 10, height: 200, rows: [], classes: [], tracks: {}, records: [] };
  const r = buildLogSVG({ ...base, marks: [{ a: 2, xf: 0.5, color: '#ff0000', abbr: 'Ch' }], idList: [{ a0: 0, a1: 5, items: [{ name: 'Chondrites', abbr: 'Ch', color: '#ff0000' }] }],
    legendClasses: [{ name: 'Chondrites', color: '#ff0000' }], labels: { idList: 'Identified' } });
  assert.ok(r.layout.some((c) => c.key === 'marks') && r.layout.some((c) => c.key === 'idlist'));
  assert.match(r.svg, /fill="#ff0000" stroke="#ffffff"/);   // triangle
  assert.match(r.svg, /Chondrites<\/text>/);                // legend entry
  const g = buildRangeSVG({ from: 0, to: 10, height: 100, rows: [{ a0: 0, a1: 5, classPct: [10, 0] }, { a0: 5, a1: 10, classPct: [20, 5] }],
    classes: [{ name: 'A', color: '#111111', index: 0 }, { name: 'B', color: '#222222', index: 1 }, { name: 'C', color: '#333333', index: 2 }], presence: [] });
  assert.match(g.svg, />A<\/text>/); assert.match(g.svg, />B<\/text>/); assert.doesNotMatch(g.svg, />C<\/text>/);   // absent taxa have no column
});


test('V0.11: display units and exact vertical spacing do not alter data coordinates', () => {
  assert.deepEqual(verticalTicks(0, 500, 900, {yFactor: 0.01, yStep: 1}), [0, 100, 200, 300, 400, 500]);
  assert.deepEqual(verticalTicks(1, 2, 500, {yFactor: 10, yStep: 5}), [1, 1.5, 2]);
});

test('V0.11: custom horizontal bounds clip each track and suppress ticks outside its range', () => {
  const options = {from:0, to:2, height:200, rows:[{a0:0,a1:1,pct:80,classPct:[],BI:5}], classes:[], records:[], tracks:{total:true,BI:true}, style:{axes:{total:{min:10,max:30,step:10},BI:{min:1,max:4,log:true}}}};
  const svg = buildLogSVG(options).svg;
  assert.match(svg, /clip-path="url\(#track-/);
  assert.match(svg, />20<\/text>/);
  assert.doesNotMatch(svg, />75<\/text>|>100<\/text>|NaN|Infinity/);
  assert.throws(() => buildLogSVG({...options,style:{axes:{total:{min:0,max:10,log:true}}}}), /Invalid horizontal axis/);
});

test('V0.11: logarithmic records break at nonpositive samples', () => {
  const svg = buildLogSVG({from:0,to:3,height:200,rows:[],classes:[],tracks:{},records:[{name:'R',color:'#f00',pts:[[0,1],[1,0],[2,10]]}],style:{axes:{'rec:R':{min:1,max:10,log:true}}}}).svg;
  const path = svg.match(/stroke="#f00" stroke-width="1.1" d="([^"]*)"/)[1];
  assert.equal((path.match(/M/g)||[]).length,2);
  assert.doesNotMatch(path,/L|NaN|Infinity/);
});


test('V0.11: distribution figures share converted ticks and bounded horizontal axes', () => {
  const svg = buildRangeSVG({display:'bars',from:0,to:200,height:300,rows:[{a0:0,a1:100,pct:80,classPct:[50]}],classes:[{name:'A',index:0,color:'#f00'}],total:true,style:{yFactor:0.01,yStep:1,axes:{total:{min:1,max:10,log:true},species:{min:10,max:40,step:10}}}}).svg;
  assert.match(svg, /clip-path="url\(#range-/);
  assert.doesNotMatch(svg, /NaN|Infinity/);
  assert.match(svg, />30<\/text>/);
  assert.match(svg, />2<\/text>/);
});


test('V0.12: distribution defaults to symbols, deduplicates measured and marked presence', () => {
  const base = {from:0,to:10,height:200,rows:[{a0:0,a1:5,classPct:[20]}],classes:[{name:'A',index:0,color:'#123456',symbol:'circle'}],presence:[{a0:0,a1:5,index:0}]};
  const svg = buildRangeSVG(base).svg;
  assert.equal((svg.match(/fill="#123456"/g)||[]).length,1);
  assert.ok(svg.includes(`d="${traceSymbolPath('circle')}"`));
  assert.doesNotMatch(svg, /<rect[^>]*fill="#123456"/);
  const bars = buildRangeSVG({...base,display:'bars'}).svg;
  assert.match(bars, /<rect[^>]*fill="#123456"/);
  assert.doesNotMatch(bars, /<path[^>]*fill="#123456"/);
});

test('V0.12: marker choice follows identification marks into the core column', () => {
  const svg = buildLogSVG({from:0,to:10,height:100,rows:[],classes:[],tracks:{},records:[],marks:[{a:2,xf:0.5,color:'#123456',symbol:'diamond'}]}).svg;
  assert.ok(svg.includes(`d="${traceSymbolPath('diamond')}"`));
  const range = buildRangeSVG({from:0,to:5,height:100,rows:[],classes:[{name:'Outside',color:'#123456',index:0}],presence:[{a0:10,a1:11,index:0}]}).svg;
  assert.doesNotMatch(range, /Outside/);
});

test('V0.22: extra vertical ticks skip labelled positions', async () => {
  const { extraTicks } = await import('../../app/js/log.js');
  const e = extraTicks(0, 20, 400, { yStep: 10, yMajor: 5, yMinor: 1 });
  const major = e.filter((x) => x.len === 6).map((x) => x.v), minor = e.filter((x) => x.len === 3).map((x) => x.v);
  assert.deepEqual(major, [5, 15]);
  assert.equal(minor.length, 21 - 3 - 2);
  assert.ok(!minor.includes(10) && !minor.includes(5));
});

test('V0.69: ruler scale — number every 10, long every 10, medium every 5, short every 1, own lengths', async () => {
  const { extraTicks, verticalTicks } = await import('../../app/js/log.js');
  const st = { yStep: 10, yMajor: 10, yMedium: 5, yMinor: 1, yMajorLen: 8, yMediumLen: 5, yMinorLen: 2 };
  assert.deepEqual(verticalTicks(0, 30, 400, st), [0, 10, 20, 30]);
  const e = extraTicks(0, 30, 400, st), at = (len) => e.filter((x) => x.len === len).map((x) => x.v);
  assert.deepEqual(at(8), []);                       // long ticks coincide with the numbered ones
  assert.deepEqual(at(5), [5, 15, 25]);
  assert.equal(at(2).length, 31 - 4 - 3);
  assert.ok(e.every((x) => ![0, 10, 20, 30].includes(x.v)));
  const f = extraTicks(0, 40, 400, { yStep: 20, yMajor: 10, yMedium: 5, yMinor: 1 });   // default lengths 6 / 4.5 / 3
  assert.deepEqual(f.filter((x) => x.len === 6).map((x) => x.v), [10, 30]);
  assert.deepEqual(f.filter((x) => x.len === 4.5).map((x) => x.v), [5, 15, 25, 35]);
});

test('V0.33: column order and hidden columns', async () => {
  const { orderCols } = await import('../../app/js/log.js');
  const cols = [{ id: 'axis' }, { id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(orderCols(cols.slice(), { colOrder: ['c', 'a'], colHide: ['b'] }, 1).map((c) => c.id), ['axis', 'c', 'a']);
  assert.deepEqual(orderCols(cols.slice(), {}, 1).map((c) => c.id), ['axis', 'a', 'b', 'c']);
});

test('V0.38: quoted fields, thousands separators, dropped cells and Latin-1', async () => {
  const { parseTable, decodeText } = await import('../../app/js/log.js');
  const a = parseTable('depth,name,val\n1,"a, b",2\n2,"say ""hi""",3');
  assert.deepEqual(a.text[0], ['1', 'a, b', '2']); assert.equal(a.text[1][1], 'say "hi"'); assert.deepEqual(a.rows.map((r) => r[2]), [2, 3]);
  const b = parseTable('depth;Ba\n1;1.234,5\n2;12,5\n3;n.d.');
  assert.deepEqual(b.rows.map((r) => r[1]), [1234.5, 12.5, null]); assert.equal(b.dropped, 1); assert.deepEqual(b.droppedCols, ['Ba']);
  const c = parseTable('depth\tBa\n1\t1,234.5\n2\t3');
  assert.deepEqual(c.rows.map((r) => r[1]), [1234.5, 3]);
  assert.equal(decodeText(new Uint8Array([0x50, 0x72, 0x6f, 0x66, 0x2e, 0x20, 0xb5, 0x6d])), 'Prof. µm');
  assert.equal(decodeText(new TextEncoder().encode('Profundidad (µm)')), 'Profundidad (µm)');
});

test('V0.51: ichnotaxa distribution as symmetric curves, column width and hidden taxa', () => {
  const rows = [{ a0: 0, a1: 5, pct: 10, classPct: [10, 0] }, { a0: 5, a1: 10, pct: 30, classPct: [20, 5] }];
  const classes = [{ name: 'A', color: '#111111', index: 0 }, { name: 'B', color: '#222222', index: 1 }];
  const k = buildRangeSVG({ from: 0, to: 10, height: 100, rows, classes, display: 'kite', colW: 60, points: [{ index: 0, a: 2, kind: 'object' }] }).svg;
  const poly = [...k.matchAll(/<polygon points="([^"]+)" fill="#111111"/g)];
  assert.equal(poly.length, 1);   // one outline for the run of intervals with data
  const xs = poly[0][1].split(' ').map((p) => +p.split(',')[0]), cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  assert.ok(xs.every((x) => Math.abs(x - cx) <= 27 + 1e-6));   // half-width ≤ (60 − 6)/2, symmetric about the column centre
  assert.ok(Math.abs(Math.max(...xs) - cx - 27) < 0.02);       // the largest abundance fills the column
  assert.doesNotMatch(k, /<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+" fill="#111111"/);   // no bars
  const ks = buildRangeSVG({ from: 0, to: 10, height: 100, rows, classes, display: 'kiteSymbols', points: [{ index: 0, a: 2, kind: 'object' }] }).svg;
  assert.ok(ks.length > k.length - 200 && /#111111/.test(ks));
  const hid = buildRangeSVG({ from: 0, to: 10, height: 100, rows, classes, display: 'kite', style: { colHide: ['sp:B'] } });
  assert.doesNotMatch(hid.svg, />B<\/text>/);
});

test('figure colours: hex colours are used, anything else falls back to the default', async () => {
  const { mergedStyle, LOG_STYLE, ND_STYLE, noDataDefs, noDataRect, validHexColor } = await import('../../app/js/log.js');
  const st = mergedStyle({ bgColor: '#000000', textColor: '"/><script>x</script>', gridColor: 'red' });
  assert.equal(st.bgColor, '#000000');
  assert.equal(st.textColor, LOG_STYLE.textColor);
  assert.equal(st.gridColor, LOG_STYLE.gridColor);
  const { svg } = buildLogSVG({ from: 0, to: 10, height: 200, rows: [], classes: [], records: [], tracks: { total: true }, style: { bgColor: '#101010', textColor: '<b>' }, title: 'T' });
  assert.match(svg, /fill="#101010"/);
  assert.doesNotMatch(svg, /<b>/);

  // Valid short (#rgb) and full (#rrggbb) hex colours are preserved for ndColor, ndLine and LOG_STYLE colours
  for (const [ndColor, ndLine, barColor] of [['#abc', '#DEF', '#09f'], ['#123456', '#aBcDeF', '#fedcba']]) {
    const valid = mergedStyle({ ndColor, ndLine, barColor, markStroke: ndColor });
    assert.equal(valid.ndColor, ndColor);
    assert.equal(valid.ndLine, ndLine);
    assert.equal(valid.barColor, barColor);
    assert.equal(valid.markStroke, ndColor);
    assert.match(noDataDefs(valid), new RegExp(`fill="${ndColor}"`));
    assert.match(noDataDefs(valid), new RegExp(`stroke="${ndLine}"`));
    const rectSolid = noDataRect({ ...valid, ndFill: 'solid', ndText: 'Gap <1>' }, 10, 50, 20, 40, 'No data');
    assert.match(rectSolid, /fill="url\(#nodata\)"/);
    assert.match(rectSolid, /Gap &lt;1&gt;/);
  }
  assert.equal(mergedStyle({ markStroke: 'none' }).markStroke, 'none');

  // Invalid strings and non-string types fall back to the actual ND_STYLE defaults (#f2f2f0 / #b9bdbb)
  const malformed = [
    '"/><script>alert(1)</script>',
    '" onmouseover="alert(1)" data-x="',
    "' onclick='alert(1)'",
    'red',
    'rgb(0,0,0)',
    '#12',
    '#1234',
    '#12345',
    '#1234567',
    '#gggggg',
    'url(#evil)',
    '',
    null,
    undefined,
    123,
    true,
    ['#123456'],
    { toString: () => '#123456' },
    Object.create(null),
  ];
  for (const bad of malformed) {
    assert.equal(validHexColor(bad, ND_STYLE.ndColor), ND_STYLE.ndColor);
    const m = mergedStyle({ ndColor: bad, ndLine: bad, bgColor: bad, textColor: bad, markStroke: bad, ndFill: bad, fontSize: bad });
    assert.equal(m.ndColor, ND_STYLE.ndColor);
    assert.equal(m.ndLine, ND_STYLE.ndLine);
    assert.equal(m.bgColor, LOG_STYLE.bgColor);
    assert.equal(m.textColor, LOG_STYLE.textColor);
    assert.equal(m.markStroke, bad === undefined ? undefined : '#ffffff');
    assert.equal(m.ndFill, 'hatch');
    assert.equal(m.fontSize, bad === null ? null : typeof bad === 'number' && bad > 0 ? bad : LOG_STYLE.fontSize);
    const defs = noDataDefs({ ndColor: bad, ndLine: bad, ndFill: 'hatch' });
    const rect = noDataRect({ ndColor: bad, ndLine: bad, ndFill: 'solid', ndText: '"/><script>x</script>' }, 0, 40, 0, 30, 'NO DATA');
    assert.match(defs, new RegExp(`fill="${ND_STYLE.ndColor}"`));
    assert.match(defs, new RegExp(`stroke="${ND_STYLE.ndLine}"`));
    assert.match(rect, /fill="url\(#nodata\)"/);
    assert.doesNotMatch(defs + rect, /<script|"\s*onmouseover|'\s*onclick|url\(#evil\)/i);
  }

  // Exported log and range SVGs reject untrusted colours across styles, classes, records, bands and marks while preserving scientific arrays
  const rows = [
    { a0: 0, a1: 5, pct: 25, classPct: [25], BI: 2, ii: 3, BIm: 1, iim: 2 },
    { a0: 5, a1: 10, pct: null, classPct: [null], BI: null, ii: null, BIm: null, iim: null },
  ];
  const rowsSnapshot = structuredClone(rows);
  const classes = [{ name: 'Chondrites"><script>', color: '"/><script>alert(1)</script>', symbol: '"/><script>', index: 0, counts: true }];
  const classesSnap = structuredClone(classes);
  const logOut = buildLogSVG({
    from: 0,
    to: 10,
    height: 240,
    rows,
    classes,
    tracks: { total: true, species: true, BI: true, ii: true, manual: true },
    records: [{ name: 'Rec"><img src=x onerror=alert(1)>', color: '" onload="alert(1)', pts: [[1, 2], [9, 4]] }],
    marks: [{ a: 2, xf: 0.5, color: '"/><script>', symbol: '"/><script>', abbr: 'Ch"x' }],
    idList: [{ a0: 0, a1: 5, items: [{ name: 'Ch', abbr: 'Ch', color: '"/><script>' }] }],
    legendClasses: [{ name: 'Ch', color: '"/><script>' }],
    bands: [{ key: 'fam:"/><script>', title: 'Events', segs: [{ a0: 0, a1: 5, label: 'lowox', color: '"/><script>' }] }],
    bandLegend: [{ name: 'Low ox', color: '"/><script>' }],
    shade: [{ a0: 0, a1: 5, color: '"/><script>' }],
    shadeLanes: [[{ a0: 0, a1: 5, color: '"/><script>' }]],
    style: {
      ndColor: '" onload="alert(1)',
      ndLine: '"/><script>alert(2)</script>',
      ndFill: 'hatch',
      barColor: '" onmouseover="alert(3)',
      markStroke: '" onclick="alert(4)',
      colOrder: 'not-an-array',
      colHide: 'not-an-array',
      speciesHide: 'not-an-array',
    },
  });
  const rangeOut = buildRangeSVG({
    from: 0,
    to: 10,
    height: 200,
    rows,
    classes,
    points: [{ a: 2, index: 0, kind: 'mark' }],
    total: true,
    style: {
      ndColor: '" onload="alert(1)',
      ndLine: '"/><script>alert(2)</script>',
      barColor: '" onmouseover="alert(3)',
      colOrder: null,
      colHide: 42,
    },
  });
  for (const svg of [logOut.svg, rangeOut.svg]) {
    assert.doesNotMatch(svg, /<script|<img|"\s*on(?:load|mouseover|click|error)=|'\s*on(?:load|mouseover|click|error)=/i);
    assert.match(svg, new RegExp(`fill="${ND_STYLE.ndColor}"`));
    assert.match(svg, new RegExp(`stroke="${ND_STYLE.ndLine}"`));
  }
  assert.deepEqual(rows, rowsSnapshot);
  assert.equal(classes[0].color, classesSnap[0].color);
  assert.equal(classes[0].index, classesSnap[0].index);
});

test('column and figure style form builders validate ndColor, ndLine and presentation colours', async () => {
  const fs = await import('node:fs');
  const vm = await import('node:vm');
  const { LOG_STYLE, ND_STYLE, mergedStyle, taxaOptions, validHexColor, orderCols } = await import('../../app/js/log.js');
  const { buildMapSVG, MAP_STYLE } = await import('../../app/js/geo.js');
  const src = fs.readFileSync(new URL('../../app/js/columns.js', import.meta.url), 'utf8');
  const extract = (name) => {
    const start = src.indexOf(`export function ${name}(`);
    assert.ok(start >= 0, `Missing ${name} in columns.js`);
    let depth = 0, i = src.indexOf('{', start);
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1).replace(/^export /, '');
    }
    throw new Error(`Unclosed ${name}`);
  };
  const colorFieldsBlock = /const COLOR_FIELDS = \{[\s\S]*?\};/.exec(src)[0];
  const esc = (s) => { try { return String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]); } catch { return ''; } };
  const S = {
    logView: { style: {} },
    fig: { type: 'log', arrowExcl: 'not-an-array', markStroke: '"/><script>alert(1)</script>', labelColor: '" onload="alert(2)', markStrokeW: '"><img src=x>', objScale: '"><script>', markScale: '" onclick="x', labelSize: '"><svg>' },
    classes: [{ id: 'ch"><script>', name: 'Chondrites"><script>', color: '"/><script>' }],
    records: [],
  };
  const ctx = vm.createContext({
    LOG_STYLE, ND_STYLE, mergedStyle, taxaOptions, validHexColor, orderCols, esc, S,
    t: (k) => k, rulerN: '"/><script>',
    colOrderHTML: (kind) => `<div data-colord="${esc(kind)}"></div>`,
    speciesFormHTML: () => '', taxaFormHTML: () => '', axesFormHTML: () => '',
  });
  vm.runInContext(`${colorFieldsBlock}\n${extract('ndFormHTML')}\n${extract('arrowFormHTML')}\n${extract('colorsFormHTML')}\n${extract('tickFieldsHTML')}\n${extract('styleFormHTML')}`, ctx);

  for (const bad of ['"/><script>alert(1)</script>', '" onmouseover="alert(1)', 'red', '#1234', null, 123, ['#123456'], Object.create(null)]) {
    const ndHtml = ctx.ndFormHTML({ ndColor: bad, ndLine: bad, markStroke: bad, markSize: '"/><script>', markStrokeW: '" onload="x', ndText: '"/><script>' });
    assert.match(ndHtml, new RegExp(`data-st="ndColor" value="${ND_STYLE.ndColor}"`));
    assert.match(ndHtml, new RegExp(`data-st="ndLine" value="${ND_STYLE.ndLine}"`));
    assert.match(ndHtml, /data-st="markStroke" value="#ffffff"/);
    assert.doesNotMatch(ndHtml, /<script|"\s*onmouseover|"\s*onload=/i);

    const colHtml = ctx.colorsFormHTML({ bgColor: bad, textColor: bad, barColor: bad }, 'log"><script>');
    assert.match(colHtml, new RegExp(`data-st="bgColor" value="${LOG_STYLE.bgColor}"`));
    assert.match(colHtml, new RegExp(`data-st="textColor" value="${LOG_STYLE.textColor}"`));
    assert.doesNotMatch(colHtml, /<script|"\s*onmouseover|"\s*onload=/i);

    const stHtml = ctx.styleFormHTML(false, { style: { ndColor: bad, ndLine: bad, bgColor: bad, fontSize: '"/><script>' } }, 'log');
    assert.match(stHtml, new RegExp(`data-st="ndColor" value="${ND_STYLE.ndColor}"`));
    assert.match(stHtml, new RegExp(`data-st="ndLine" value="${ND_STYLE.ndLine}"`));
    assert.doesNotMatch(stHtml, /<script|"\s*onmouseover|"\s*onload=/i);
  }
  const validNd = ctx.ndFormHTML({ ndColor: '#abc', ndLine: '#123456', markStroke: '#fed' });
  assert.match(validNd, /data-st="ndColor" value="#abc"/);
  assert.match(validNd, /data-st="ndLine" value="#123456"/);
  assert.match(validNd, /data-st="markStroke" value="#fed"/);

  const arrowHtml = ctx.arrowFormHTML();
  assert.match(arrowHtml, /id="figMarkStroke" value="#ffffff"/);
  assert.match(arrowHtml, /id="figLabelColor" value="#1c2422"/);
  assert.doesNotMatch(arrowHtml, /<script|<img|<svg|"\s*onload=|"\s*onclick=/i);

  const mapSvg = buildMapSVG({
    bbox: [-10, 35, -5, 40],
    points: [{ name: 'Core"><script>', lon: -8, lat: 37, n: 1, dominant: 'lowox', fraction: 0.8 }],
    mode: 'class',
    colors: { lowox: '#2b6f8f' },
    style: { bgColor: '"/><script>', sea: 'red', land: 123, textColor: null, stroke: '" onload="alert(1)', labelColor: '#gggggg' },
  });
  assert.doesNotMatch(mapSvg, /<script|onload=/i);
  assert.match(mapSvg, new RegExp(`fill="${MAP_STYLE.bgColor}"`));
  assert.match(mapSvg, new RegExp(`fill="${MAP_STYLE.sea}"`));
});

test('card Q4: the core-column CSV averages records per interval, never interpolates across a gap, marks reversals and counts intervals outside the model', () => {
  const bins = [0, 1, 2, 3].map((k) => ({ dTop: k, dBottom: k + 1, depth: k + 0.5, pct: 10, classPct: [10], BI: 2, ii: 3, BIm: null, iim: null }));
  const classes = [{ name: 'A', color: '#f00', index: 0 }];
  // samples every 0.1 between 0 and 1, then nothing until 3.5: the gap (2.5) is wider than three times the median spacing (0.3)
  const x = [...Array.from({ length: 11 }, (_, k) => k / 10), 3.5], y = x.map((v) => v * 10);
  const records = [{ name: 'XRF', axis: 'depth', x, y }];
  const rows = compositeRows([{ name: 'S1', bins }], { axis: 'depth', model: null });
  const lines = (csv) => csv.trim().split('\n').slice(1).map((line) => line.split(','));
  const mean = lines(windowCSV({ rows, from: 0, to: 4, classes, records, units: 'cm', ageUnits: 'ka' }));
  assert.deepEqual(mean.map((cells) => cells.slice(-3, -1)), [['4.5', '10'], ['10', '1'], ['', '0'], ['35', '1']], 'mean of the samples in [top, bottom) and their number');
  const point = lines(windowCSV({ rows, from: 0, to: 4, classes, records, units: 'cm', ageUnits: 'ka', recordMode: 'point' }));
  assert.deepEqual(point.map((cells) => cells.at(-2)), ['5', '', '', '35'], 'interpolated at the centre, empty across the gap; a sample at the centre is its own value');
  // an age model with a reversal between 1 and 2 cm, ending at 3 cm: the last interval lies outside it
  const model = { depth: [0, 1, 2, 3], age: [0, 10, 5, 20] };
  const aged = compositeRows([{ name: 'S1', bins }], { axis: 'age', model });
  assert.equal(aged.outside, 1);
  const csv = windowCSV({ rows: aged, from: 0, to: 30, classes, records: [], units: 'cm', ageUnits: 'ka', model });
  assert.deepEqual(lines(csv.split('#')[0]).map((cells) => cells.at(-1)), ['', 'age reversal', '']);
  assert.match(csv, /# 1 intervals lie outside the age model and are not listed\n$/);
});
