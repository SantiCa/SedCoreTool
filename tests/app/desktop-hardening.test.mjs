// Card M8.4.34: desktop hardening. Which addresses leave the program, which navigations are refused, the script policy of the app pages, which stores
// a page may delete, copy or clean up, and the deadlines of the mask-store operations.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import desktopMain from '../../desktop/main.js';

const require = createRequire(import.meta.url);
const { createTileIpc } = require('../../desktop/tile-ipc.js');
const { EngineClient, STORE_DEADLINES_MS } = require('../../desktop/engine.js');
const { safeExternalUrl, isAppNavigation, handleAppRequest, DESKTOP_SCRIPT_POLICY } = desktopMain;

test('only web and mail addresses leave the program', () => {
  for (const ok of ['https://example.org/a?b=1#c', 'http://example.org', 'mailto:someone@example.org', 'HTTPS://EXAMPLE.ORG/']) assert.ok(safeExternalUrl(ok), ok);
  for (const bad of ['file:///C:/Windows/System32/calc.exe', 'javascript:alert(1)', 'data:text/html,<script>1</script>', 'vbscript:x', 'ms-msdt:/id', 'search-ms:query=a', 'ssh://host',
    'app://corantool/app/index.html', 'app://other/x', 'blob:https://example.org/1', 'ftp://example.org', 'https://user:pass@example.org/', '//example.org', 'not a url', '',
    null, undefined, 42, {}, 'https://example.org/' + 'a'.repeat(9000)]) assert.equal(safeExternalUrl(bad), null, String(bad).slice(0, 40));
});

test('navigation stays inside the app origin', () => {
  assert.equal(isAppNavigation('app://corantool/app/index.html'), true);
  assert.equal(isAppNavigation('app://corantool/app/index.html?x=1#y'), true);
  for (const bad of ['https://example.org/', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', 'app://evil/app/index.html', 'app://corantool//evil', 'about:blank', '', null]) {
    assert.equal(isAppNavigation(bad), false, String(bad));
  }
});

test('an HTML page of the app carries the script policy without remote origins; other files are untouched', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sedcoretool-web-'));
  try {
    fs.mkdirSync(path.join(root, 'app'), { recursive: true });
    fs.writeFileSync(path.join(root, 'app', 'index.html'), '<html></html>'); fs.writeFileSync(path.join(root, 'app', 'a.js'), '1');
    const fetchFile = async (file) => new Response(fs.readFileSync(file), { status: 200, headers: { 'content-type': file.endsWith('.html') ? 'text/html' : 'text/javascript', 'x-kept': 'yes' } });
    const page = await handleAppRequest({ url: 'app://corantool/app/index.html' }, { webRoot: root, fetchFile });
    assert.equal(page.status, 200); assert.equal(await page.text(), '<html></html>');
    assert.equal(page.headers.get('content-security-policy'), DESKTOP_SCRIPT_POLICY); assert.equal(page.headers.get('x-kept'), 'yes');
    assert.equal(page.headers.get('content-type'), 'text/html');
    assert.ok(/script-src 'self'/.test(DESKTOP_SCRIPT_POLICY) && !/https?:|\*/.test(DESKTOP_SCRIPT_POLICY), 'no remote script origin');
    const script = await handleAppRequest({ url: 'app://corantool/app/a.js' }, { webRoot: root, fetchFile });
    assert.equal(script.headers.get('content-security-policy'), null);
    const refused = await handleAppRequest({ url: 'app://evil/app/index.html' }, { webRoot: root, fetchFile });
    assert.equal(refused.status, 403);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---- which stores a page may touch ----
const temporary = (t) => { const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sedcoretool-hard-')); t.after(() => fs.rmSync(folder, { recursive: true, force: true })); return folder; };
function engineStub() {
  const calls = [];
  return { calls, request(op, payload) { calls.push({ op, payload }); const value = Promise.resolve(op === 'mask.begin' ? { staged: randomUUID(), rows: 1, cols: 1 } : op === 'mask.copy' ? { next: null, tiles: 1 } : op === 'mask.retain' ? { removed: { manifests: 0, blobs: 0 } } : {}); value.requestId = randomUUID(); return value; } };
}
const makeFolder = (projects, id) => { fs.mkdirSync(path.join(projects, id, 'tiles'), { recursive: true }); fs.writeFileSync(path.join(projects, id, 'tiles', 'x'), '1'); };

test('a store is deleted only if the page opened it, or announced it and the user agrees; an unknown one is refused', async (t) => {
  const projects = temporary(t), asked = [];
  let answer = false;
  const engine = engineStub(), ipc = createTileIpc({ engine, projectsRoot: projects, confirm: async (what) => { asked.push(what); return answer; } });
  for (const id of ['mine', 'listed', 'stranger']) makeFolder(projects, id);
  await ipc.call(1, 'maskBegin', 'mine', 's1', 600, 300, null);                       // the page works on it
  await ipc.call(1, 'announceProjects', ['mine', 'listed', 'Bad Name', 'con', 7]);       // invalid entries are ignored
  assert.deepEqual(await ipc.call(1, 'deleteProjectStore', 'stranger'), { error: { code: 'INVALID_REQUEST', field: 'project' } });
  assert.ok(fs.existsSync(path.join(projects, 'stranger')) && asked.length === 0, 'unknown: refused without a question');
  assert.deepEqual(await ipc.call(1, 'deleteProjectStore', 'listed'), { ok: { deleted: false, declined: true } });
  assert.deepEqual(asked, [{ kind: 'delete', project: 'listed' }]);
  assert.ok(fs.existsSync(path.join(projects, 'listed')), 'declined: the folder stays');
  answer = true;
  assert.deepEqual(await ipc.call(1, 'deleteProjectStore', 'listed'), { ok: { deleted: true } });
  assert.ok(!fs.existsSync(path.join(projects, 'listed')));
  asked.length = 0;
  assert.deepEqual(await ipc.call(1, 'deleteProjectStore', 'mine'), { ok: { deleted: true } });
  assert.equal(asked.length, 0, 'a store the page opened is deleted without a question');
  assert.deepEqual(await ipc.call(1, 'deleteProjectStore', 'nothing-here'), { ok: { deleted: false } }, 'no folder: nothing to ask');
  assert.deepEqual(await ipc.call(1, 'announceProjects', 'all'), { error: { code: 'INVALID_REQUEST', field: 'projects' } });
});

test('a reopened section also opens its project; a copy goes only from an opened or announced store and never over another folder', async (t) => {
  const projects = temporary(t), engine = engineStub(), ipc = createTileIpc({ engine, projectsRoot: projects, confirm: async () => false });
  for (const id of ['source', 'announced', 'taken', 'fresh']) makeFolder(projects, id);
  const manifests = ['1'.repeat(64)], key = () => randomUUID();
  assert.deepEqual(await ipc.call(1, 'copyProjectStore', 'announced', 'target', manifests, [], key()), { error: { code: 'INVALID_REQUEST', field: 'from' } }, 'neither opened nor announced');
  await ipc.call(1, 'announceProjects', ['announced', 'taken']);
  await ipc.call(1, 'maskBegin', 'source', 's1', 600, 300, null);
  assert.deepEqual(await ipc.call(1, 'copyProjectStore', 'source', 'taken', manifests, [], key()), { error: { code: 'INVALID_REQUEST', field: 'to' } }, 'another project folder is never overwritten');
  assert.deepEqual(await ipc.call(1, 'copyProjectStore', 'source', 'target', manifests, [], key()), { ok: { copied: true } });
  assert.deepEqual(await ipc.call(1, 'copyProjectStore', 'announced', 'target2', manifests, [], key()), { ok: { copied: true } }, 'an announced store can be copied from');
  makeFolder(projects, 'target');
  assert.deepEqual(await ipc.call(1, 'copyProjectStore', 'source', 'target', manifests, [], key()), { ok: { copied: true } }, 'the page may copy again into a store it created');
  assert.deepEqual(await ipc.call(1, 'deleteProjectStore', 'target'), { ok: { deleted: true } }, 'a store the copy created counts as opened');
});

test('a page cleans up only the store it works on', async (t) => {
  const projects = temporary(t), engine = engineStub(), ipc = createTileIpc({ engine, projectsRoot: projects });
  const keep = ['2'.repeat(64)];
  assert.deepEqual(await ipc.call(1, 'maskRetain', 'other', keep), { error: { code: 'INVALID_REQUEST', field: 'project' } });
  assert.ok(!engine.calls.some((c) => c.op === 'mask.retain'), 'nothing reached the engine');
  await ipc.call(1, 'maskBegin', 'other', 's1', 600, 300, null);
  assert.deepEqual(await ipc.call(1, 'maskRetain', 'other', keep), { ok: { removed: { manifests: 0, blobs: 0 } } });
});

// ---- deadlines of the store operations ----
const script = fileURLToPath(new URL('../../src/sedcoretool/engine/server.py', import.meta.url));
const pythonCheck = spawnSync(process.platform === 'win32' ? 'py' : 'python3', [...(process.platform === 'win32' ? ['-3.12'] : []), '-c', 'import sys; print(sys.executable)'], { encoding: 'utf8', windowsHide: true });
const python = process.env.SEDCORETOOL_TEST_PYTHON || (pythonCheck.status === 0 ? pythonCheck.stdout.trim() : null);

test('every mask-store operation has a deadline longer than an ordinary request', () => {
  const ops = ['mask.begin', 'mask.put', 'mask.commit', 'mask.discard', 'mask.read', 'mask.retain', 'mask.info', 'mask.copy', 'mask.forget', 'mask.derived.put', 'mask.derived.get', 'mask.export', 'mask.import'];
  assert.deepEqual(Object.keys(STORE_DEADLINES_MS).sort(), [...ops].sort());
  for (const op of ops) assert.ok(STORE_DEADLINES_MS[op] >= 30000 && Number.isInteger(STORE_DEADLINES_MS[op]), op);
  assert.ok(Object.isFrozen(STORE_DEADLINES_MS));
});

test('a store operation slower than the ordinary deadline completes without stopping the engine; an ordinary one is still cut', { skip: !python }, async (t) => {
  const folder = await fsp.mkdtemp(path.join(os.tmpdir(), 'engine-slow-store-'));
  t.after(() => fsp.rm(folder, { recursive: true, force: true }));
  const slow = path.join(folder, 'slow.py'), engine = path.dirname(script).replaceAll(path.sep, '/');
  // Answers the handshake at once and every other request after 0.8 s (a slow disk), always with an empty result.
  await fsp.writeFile(slow, ['import sys, time', `sys.path.insert(0, ${JSON.stringify(engine)})`, 'from protocol import read_frame, strict_json, write_json', 'stdin, stdout = sys.stdin.buffer, sys.stdout.buffer',
    'while True:', '    frame = read_frame(stdin)', '    if frame is None: break', '    request = strict_json(frame[1])',
    '    if request["op"] != "hello": time.sleep(0.8)',
    `    result = {"protocol": 1, "engine_version": "test", "runtime_id": ${JSON.stringify('0'.repeat(64))}, "methods": [], "limits": {}} if request["op"] == "hello" else {}`,
    '    write_json(stdout, {"v": 1, "kind": "response", "session": request["session"], "id": request["id"], "op": request["op"], "status": "ok", "result": result})', ''].join('\n'));
  const client = new EngineClient({ executable: python, script: slow, version: 'test', runtimeId: '0'.repeat(64), timeoutMs: 300, deadlines: { 'mask.info': 3000 } });
  t.after(() => client.stop());
  try { await client.start(); } catch (error) { t.skip('the fixture engine did not complete its handshake: ' + (error?.message || error)); return; }
  const child = client.child;
  assert.deepEqual(await client.request('mask.info', { project: 'p', manifest: 'a'.repeat(64), start: 0 }), {});     // 0.8 s > 0.3 s, within its own 3 s
  assert.equal(client.status().state, 'ready'); assert.equal(client.child, child, 'the same engine process');
  await assert.rejects(client.request('mask.discard', { staged: randomUUID() }), (error) => error?.code === 'ENGINE_UNAVAILABLE');   // no deadline of its own here: the ordinary 0.3 s applies
});
