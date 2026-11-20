// Card M8.4.23: the preflight of the desktop end-to-end tests finds a stale program copy or engine runtime and names the fixing command.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stale, requireFresh } from '../e2e/preflight.mjs';

const put = (root, relative, text) => { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-'));
  for (const [file, text] of [['app/js/a.js', 'a'], ['app/index.html', 'h'], ['src/sedcoretool/engine/server.py', 'server'], ['src/sedcoretool/x.py', 'x']]) {
    put(root, file, text);
    put(root, file.startsWith('app/') ? 'desktop/web/' + file : 'desktop/python/' + file, text);
  }
  put(root, 'app/README.md', 'not copied');
  put(root, 'desktop/web/app/vendor/ort/ort.js', 'added by prepare.js');
  const sources = ['sedcoretool/engine/server.py', 'sedcoretool/x.py'].map((p) => ({ path: p, size: 1, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'src', p))).digest('hex') }));
  put(root, 'desktop/runtime/test-x64/manifest.json', JSON.stringify({ sources }));
  return root;
}

test('a current program copy and runtime pass', () => {
  const root = project();
  assert.deepEqual(stale(root, 'test-x64'), []);
  fs.rmSync(root, { recursive: true });
});

test('one changed, one missing and one new file are found, each with the command that fixes it', () => {
  const root = project();
  put(root, 'app/js/a.js', 'changed');
  put(root, 'src/sedcoretool/engine/server.py', 'edited engine');
  fs.rmSync(path.join(root, 'desktop/web/app/index.html'));
  put(root, 'src/sedcoretool/new.py', 'new');
  const found = Object.fromEntries(stale(root, 'test-x64').map((p) => [p.what, p]));
  assert.deepEqual(found['desktop/web is older than app/'].files.sort(), ['differs js/a.js', 'missing index.html']);
  assert.match(found['desktop/web is older than app/'].fix, /prepare\.js/);
  assert.deepEqual(found['desktop/python is older than src/'].files.sort(), ['differs sedcoretool/engine/server.py', 'missing sedcoretool/new.py']);
  assert.deepEqual(found['the engine runtime does not match src/'].files.sort(), ['differs sedcoretool/engine/server.py', 'new sedcoretool/new.py']);
  assert.match(found['the engine runtime does not match src/'].fix, /prepare-runtime -- --offline/);
  fs.rmSync(root, { recursive: true });
});

test('requireFresh throws with every command when the copy is stale', () => {
  const root = project();
  fs.rmSync(path.join(root, 'desktop', 'runtime'), { recursive: true });
  put(root, 'app/js/a.js', 'changed');
  assert.throws(() => requireFresh(root), /desktop\/web is older[\s\S]*Run: node desktop\/scripts\/prepare\.js[\s\S]*no engine runtime[\s\S]*Run: npm run prepare-runtime/);
  fs.rmSync(root, { recursive: true });
});

test('no runtime for the platform is reported', () => {
  const root = project();
  assert.equal(stale(root, 'other-x64')[0].what, 'no engine runtime for other-x64');
  fs.rmSync(root, { recursive: true });
});
