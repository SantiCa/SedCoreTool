// Card M8.4.30: the layer rules of ARCHITECTURE §3.2 for JavaScript, as tests/test_architecture.py checks them for Python. The lists of pure
// modules and of controllers are read from that table, so the document and the check cannot drift apart.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const js = (name) => fs.readFileSync(path.join(root, 'app/js', name), 'utf8');
/** `app.js` may not grow beyond this many lines; a card that makes it shorter lowers the number (AGENTS §4, card M8.4.30). */
const APP_JS_CEILING = 4666;

function tableRow(label) {
  const line = fs.readFileSync(path.join(root, 'docs/ARCHITECTURE.md'), 'utf8').split('\n').find((l) => l.startsWith(`| ${label} |`));
  assert.ok(line, `ARCHITECTURE §3.2 has a row "${label}"`);
  return [...line.split('|').at(-2).matchAll(/`([a-z0-9]+\.js)`/g)].map((m) => m[1]);
}
const pure = tableRow('Pure modules'), controllers = tableRow('Controllers and views');
/** The code without comments and string contents, so that a word in a comment or a message is not taken for a use. */
const codeOf = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, "''");

test('the lists of ARCHITECTURE §3.2 name existing files, each in one list', () => {
  for (const name of [...pure, ...controllers]) assert.ok(fs.existsSync(path.join(root, 'app/js', name)), name);
  assert.deepEqual(pure.filter((name) => controllers.includes(name)), []);
});

test('pure modules use no DOM: no document, no window object', () => {
  const offenders = [];
  for (const name of pure) {
    const code = codeOf(js(name));
    const windowIsLocal = /[(,]\s*window\s*[,)=]|\b(const|let)\s+window\b/.test(code);   // a parameter or variable named `window`
    if (/\bdocument\b/.test(code) || (!windowIsLocal && /\bwindow\s*[.?[]/.test(code))) offenders.push(name);
  }
  assert.deepEqual(offenders, [], 'pure modules that use the DOM (move them to the controllers or remove the use)');
});

test('pure modules import no controller', () => {
  const offenders = [];
  for (const name of pure) {
    for (const m of js(name).matchAll(/^import\s[^;]*?from\s+'\.\/([a-z0-9]+\.js)'/gm)) if (controllers.includes(m[1])) offenders.push(`${name} → ${m[1]}`);
  }
  assert.deepEqual(offenders, []);
});

test(`app.js stays at or below ${APP_JS_CEILING} lines`, () => {
  const lines = js('app.js').split('\n').length - (js('app.js').endsWith('\n') ? 1 : 0);
  assert.ok(lines <= APP_JS_CEILING, `app.js has ${lines} lines (ceiling ${APP_JS_CEILING}): put new logic in a module (AGENTS §4)`);
});
