// Card Q9: text and URLs from a project file or a laboratory table cannot become markup. Unit tests of the guards (image URLs, thumbnails,
// plot colours and sizes) and a static check that every interpolation inside a double-quoted HTML attribute of the view modules is escaped.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeImageURL, sanitizeThumbs } from '../../app/js/core.js';
import { buildXYPlot, buildStratPlot } from '../../app/js/plot.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBD';
const WEBP = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';

test('safeImageURL accepts base64 PNG, JPEG and WebP data URLs only', () => {
  for (const ok of [PNG, JPEG, WEBP]) assert.equal(safeImageURL(ok), ok);
  for (const bad of ['javascript:window.__xss=1', 'data:text/html;base64,PHNjcmlwdD4=', 'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/svg+xml,<svg onload=alert(1)>', 'x" onerror="window.__xss=1', 'data:image/png;base64,AAAA" onerror="x', 'data:image/png;base64,AA AA',
    "data:image/png;base64,AA'AA", 'DATA:image/png;base64,AAAA', 'data:image/jpg;base64,AAAA', 'http://example.org/a.png', 'https://example.org/a.png',
    'data:image/png;base64,', 'data:image/png;base64,AAAA===', '', null, undefined, 42, {}, ['x']]) assert.equal(safeImageURL(bad), '', String(bad));
});

test('sanitizeThumbs drops hostile thumbnails of a project and keeps valid ones unchanged', () => {
  const p = {
    library: [{ name: 'a', thumb: PNG }, { name: 'b', thumb: 'javascript:window.__xss=1' }, { name: 'c', thumb: 'x" onerror="window.__xss=1' }, { name: 'd' }, { name: 'e', thumb: null }],
    cores: [{ sections: [{ objects: [{ id: 1, th: JPEG }, { id: 2, th: 'data:image/svg+xml;base64,PHN2Zz4=' }, { id: 3 }] }] }, { sections: [] }, {}],
    sections: [{ objects: [{ id: 9, th: '"><img src=x onerror=1>' }, { id: 10, th: WEBP }] }],
  };
  assert.equal(sanitizeThumbs(p), p);
  assert.deepEqual(p.library, [{ name: 'a', thumb: PNG }, { name: 'b' }, { name: 'c' }, { name: 'd' }, { name: 'e', thumb: null }]);
  assert.deepEqual(p.cores[0].sections[0].objects, [{ id: 1, th: JPEG }, { id: 2 }, { id: 3 }]);
  assert.deepEqual(p.sections[0].objects, [{ id: 9 }, { id: 10, th: WEBP }]);
  for (const odd of [null, undefined, 'x', 3, { library: 'x', cores: 'y' }, { cores: [null, { sections: [null, { objects: [null, 'x'] }] }] }]) assert.doesNotThrow(() => sanitizeThumbs(odd));
});

/* Reference plots recorded with plot.js before card Q9 (SHA-256 of the SVG): valid colours and sizes must draw byte-identical output. */
const x = [0, 1, 2, 3, 4, 5, 6, 7], y = [1, 3, 2, 5, 4, 6, 5, 8];
const XY = { title: 'T', width: 640, height: 400, x: { label: 'X' }, y: { label: 'Y' }, series: [
  { name: 'a', x, y, type: 'linesym', fit: 'linear', color: '#1f6fb2' },
  { name: 'b', x, y: y.map((v) => v * 10), type: 'bar', y2: true, color: '#abc' },
  { name: 'c', x, y, type: 'scatter', symbol: 'square' }, { name: 'd', x, y, type: 'area', color: '#C0392B' }, { name: 'e', x, y, type: 'step' }] };
const STRAT = { title: 'S', width: 300, height: 500, panelWidth: 120, v: { label: 'Depth' }, panels: [
  { label: 'Ti', series: [{ name: 'A', core: 'A', x, y, color: '#2e7d4f', type: 'linesym' }, { name: 'B', core: 'B', x, y, type: 'bar' }], fit: 'linear' },
  { label: 'TOC', series: [{ name: 'A', core: 'A', x, y, type: 'area', color: '#8e44ad' }] }] };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

test('plots with valid colours and sizes are byte-identical to the output before card Q9', () => {
  assert.equal(sha(buildXYPlot(XY).svg), 'b00ad2c8e9f6ebe0de34aa491a9dc9e806af22602fdf3c18d4085b3cf09bd92b');
  assert.equal(sha(buildStratPlot(STRAT).svg), '4cdbb4dc977a32801927f5f6502ead088e2f20b4f1bff7d5ba270f10b3b056fb');
  assert.equal(sha(buildXYPlot({ ...XY, width: undefined, height: 0 }).svg), 'caaf993042d24832f978eb46dbb925a49257d5a20cbc53b87725cee627e7b1b8');
  assert.equal(sha(buildStratPlot({ ...STRAT, width: undefined, height: undefined, panelWidth: undefined }).svg), 'b2eafdeff6bdb61667db1abc457ddff5a5e9f310559a3ee7d0c348f34f026925');
});

test('hostile plot colours and sizes cannot break out of the SVG attributes', () => {
  const colour = 'red"/><script>x</script>', size = '1" onload="x';
  const xy = buildXYPlot({ ...XY, width: size, height: size, font: size, series: XY.series.map((s) => ({ ...s, color: colour })) }).svg;
  const strat = buildStratPlot({ ...STRAT, width: size, height: size, panelWidth: size, panels: STRAT.panels.map((p) => ({ ...p, series: p.series.map((s) => ({ ...s, color: colour })) })) }).svg;
  for (const svg of [xy, strat]) {
    assert.ok(!/<script/i.test(svg), 'no script element');
    assert.ok(!/onload=/i.test(svg), 'no event attribute');
    assert.ok(!svg.includes('"/><script'), 'no attribute break-out');
    assert.ok(!svg.includes('red"'), 'the hostile colour is replaced by a default colour');
  }
  assert.match(xy, /^<svg [^>]*width="760" height="480"/, 'invalid sizes fall back to the defaults');
});

/* ───────── static check: interpolations inside double-quoted HTML attributes of the view modules ───────── */
const VIEW_MODULES = ['app.js', 'datatab.js', 'multiproxy.js', 'columns.js', 'figures.js', 'tableview.js', 'tiledview.js', 'panels.js'];

/** Expressions that are safe in a quoted attribute without escaping: one guard or formatter call, or a number made by code. */
const SAFE_CALL = /^(esc|validHexColor|safeImageURL|fmt|Number|Math\.\w+)\(/;
function closingParen(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'" || ch === '"' || ch === '`') { i = skipString(s, i); continue; }
    if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return i;
  }
  return -1;
}
function skipString(s, i) {
  const q = s[i];
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue; }
    if (q === '`' && s[j] === '$' && s[j + 1] === '{') { j = skipBraces(s, j + 1); continue; }
    if (s[j] === q) return j;
  }
  return s.length;
}
function skipBraces(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'" || ch === '"' || ch === '`') { i = skipString(s, i); continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i;
  }
  return s.length;
}
function safeExpression(e) {
  const call = SAFE_CALL.exec(e);
  if (call && closingParen(e, call[0].length - 1) === e.length - 1) return true;
  if (/^t\('[\w.]+'\)$/.test(e)) return true;                                    // a constant interface text
  if (/^\+[\w.]+$/.test(e) || /^\+[\w.[\]]+\.to(Fixed|Precision)\(\d+\)$/.test(e)) return true; // numeric coercion
  if (/^'[^'$]*'$/.test(e)) return true;                                          // a constant string
  if (/^[\w.]+\s*[-*/]\s*[\d.]+$/.test(e) || /^\d+(\.\d+)?$/.test(e)) return true; // arithmetic that always gives a number
  if (/^[\w.?]+\.length$/.test(e)) return true;                                   // a count
  if (/^[^?`]+\?\s*('[^'$]*'|"[^"$]*")\s*:\s*('[^'$]*'|"[^"$]*")$/.test(e)) return true; // a choice between two constant strings
  return false;
}

/** Attributes of the HTML forms and lists. Geometry and paint attributes (x, d, fill, ...) belong to the SVG builders of figures.js, which
 * escape their text and validate colours themselves (log.js, geo.js, locmap.js, plot.js are covered by their own tests). */
const HTML_ATTRIBUTE = /^(data-[\w-]+|aria-[\w-]+|value|name|id|for|class|style|title|alt|label|placeholder|src|href|min|max|step|type|role|lang|dir)$/;

/**
 * Every `${expr}` inside a double-quoted HTML attribute value of a template literal: [line, attribute, expression]. An attribute selector
 * (`[data-id="${id}"]`, preceded by `[`) is a CSS query, not markup, and is not listed.
 */
function attributeInterpolations(src) {
  const out = [];
  for (const m of src.matchAll(/([\w-]+)="/g)) {
    if (src[m.index - 1] === '[' || !HTML_ATTRIBUTE.test(m[1])) continue;
    let i = m.index + m[0].length;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (ch === '"' || ch === '\n' || ch === '`') break;
      if (ch === '$' && src[i + 1] === '{') {
        const end = skipBraces(src, i + 1), expr = src.slice(i + 2, end).trim();
        out.push([src.slice(0, i).split('\n').length, m[1], expr]);
        i = end;
      }
    }
  }
  return out;
}

/** Reviewed exceptions: [file, exact expression, reason]. Each value is made by code, never read from a project, table or settings. */
const ALLOWED = [
  ['app.js', "d[4] || ''", 'DETECT_SLIDERS, a constant table (the line keeps its typecheck baseline entry)'],
  ['app.js', 'g', "['section', 'core'], a constant list (the line keeps its typecheck baseline entry)"],
  ['multiproxy.js', 'note', 'geoCoreNote() returns esc(...) of the whole note; escaping again would show entities'],
  ['multiproxy.js', 'resizeName', 'esc(t(...)) assigned just above'],
  ['figures.js', "tc.canvas.toDataURL(mask || img === 'none' ? 'image/png' : 'image/jpeg', 0.92)", 'a data URL drawn by this code (SVG export)'],
  ['figures.js', 'href', 'panelDataURL(): a data URL drawn by this code (SVG export)'],
  ['figures.js', 'q', 'a regular expression of ids in a template literal, not markup'],
];

test('static check: every interpolation in a double-quoted HTML attribute of the view modules is escaped or made by code', () => {
  const offenders = [], used = new Set();
  for (const file of VIEW_MODULES) {
    const src = fs.readFileSync(path.join(root, 'app/js', file), 'utf8');
    for (const [line, attr, expr] of attributeInterpolations(src)) {
      if (safeExpression(expr)) continue;
      const allow = ALLOWED.find(([f, e]) => f === file && e === expr);
      if (allow) { used.add(allow); continue; }
      offenders.push(`${file}:${line} ${attr}="\${${expr}}"`);
    }
  }
  assert.deepEqual(offenders, [], 'wrap these in esc(...) (or validHexColor/safeImageURL), or justify them in ALLOWED');
  assert.deepEqual(ALLOWED.filter((a) => !used.has(a)).map((a) => a.slice(0, 2)), [], 'stale entries of ALLOWED');
});

test('the static check finds an unescaped identifier in an attribute', () => {
  const found = attributeInterpolations('const h = `<li data-id="${c.id}" title="${esc(c.name)}" class="a ${x ? \'on\' : \'\'}">`; q(`[data-id="${c.id}"]`);');
  assert.deepEqual(found.map(([, a, e]) => [a, e]), [['data-id', 'c.id'], ['title', 'esc(c.name)'], ['class', "x ? 'on' : ''"]]);
  assert.equal(safeExpression('c.id'), false);
  assert.equal(safeExpression('esc(c.id)'), true);
  assert.equal(safeExpression('esc(a) + b'), false);
  assert.equal(safeExpression("x ? 'on' : ''"), true);
  assert.equal(safeExpression('q.repeat + 1'), false);
  assert.deepEqual(attributeInterpolations('`<path d="M${x}" fill="${c}"/>`'), [], 'SVG geometry and paint are not HTML attributes');
});
