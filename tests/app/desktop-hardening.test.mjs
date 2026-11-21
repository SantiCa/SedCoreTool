// Card M8.4.34: desktop hardening. Which addresses leave the program, which navigations are refused, the script policy of the app pages, which stores
// a page may delete, copy or clean up, and the deadlines of the mask-store operations. Card M8.4.38: clean-up and deletion follow what this program
// session wrote, the operations a page may call on another project, the IPC frame check, and the trainer's options, child processes and cancel.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import desktopMain from '../../desktop/main.js';

const require = createRequire(import.meta.url);
const { createTileIpc } = require('../../desktop/tile-ipc.js');
const { EngineClient, STORE_DEADLINES_MS } = require('../../desktop/engine.js');
const { Trainer, trainingOptions, capture, MAX_TRAINING_ZIP_BYTES } = require('../../desktop/trainer.js');
const { safeExternalUrl, isAppNavigation, handleAppRequest, fromTopAppFrame, DESKTOP_SCRIPT_POLICY } = desktopMain;

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

// ---- which stores a page may touch (cards M8.4.34 and M8.4.38) ----
const temporary = (t) => { const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sedcoretool-hard-')); t.after(() => fs.rmSync(folder, { recursive: true, force: true })); return folder; };
/**
 * An engine stub that keeps the store on disk as the engine lays it out (`<project>/tiles/manifests/<sha256>.json`): `mask.commit` writes a new
 * version, `mask.retain` removes every version it is not told to keep.
 */
function engineStub(projects = null) {
  const calls = [], stagedProject = new Map();
  const manifests = (project) => path.join(projects, project, 'tiles', 'manifests');
  const answer = (op, payload) => {
    if (op === 'mask.begin') { const staged = randomUUID(); stagedProject.set(staged, payload.project); return { staged, rows: 1, cols: 1 }; }
    if (op === 'mask.commit') {
      const manifest = createHash('sha256').update(randomUUID()).digest('hex'), project = stagedProject.get(payload.staged);
      fs.mkdirSync(manifests(project), { recursive: true }); fs.writeFileSync(path.join(manifests(project), manifest + '.json'), '{}');
      return { manifest };
    }
    if (op === 'mask.retain') {
      let removed = 0;
      for (const file of fs.existsSync(manifests(payload.project)) ? fs.readdirSync(manifests(payload.project)) : []) {
        if (!payload.keep.includes(file.slice(0, 64))) { fs.rmSync(path.join(manifests(payload.project), file)); removed++; }
      }
      return { removed: { manifests: removed, blobs: 0 } };
    }
    if (op === 'mask.copy') return { next: null, tiles: 1 };
    if (op === 'buffer.begin') return { handle: 'h1' };
    if (op === 'mask.export') return { bytes: Buffer.alloc(0), files: [] };
    if (op === 'mask.derived.get') return { found: false };
    return {};
  };
  return { calls, request(op, payload) { calls.push({ op, payload }); const value = Promise.resolve(answer(op, payload)); value.requestId = randomUUID(); return value; } };
}
const makeFolder = (projects, id) => { fs.mkdirSync(path.join(projects, id, 'tiles'), { recursive: true }); fs.writeFileSync(path.join(projects, id, 'tiles', 'x'), '1'); };
/** A project stored by an earlier session: its folder with these versions. */
function storedBefore(projects, id, versions) {
  fs.mkdirSync(path.join(projects, id, 'tiles', 'manifests'), { recursive: true });
  for (const name of versions) fs.writeFileSync(path.join(projects, id, 'tiles', 'manifests', name + '.json'), '{}');
}
const versionsOf = (projects, id) => fs.readdirSync(path.join(projects, id, 'tiles', 'manifests')).map((file) => file.slice(0, 64)).sort();
const oldVersions = ['1'.repeat(64), '2'.repeat(64), '3'.repeat(64)];
const tablesOf = { classes: Buffer.from('[]') };

test('a store this session created is deleted without a question; any other only if opened or announced and the user agrees; an unknown one is refused', async (t) => {
  const projects = temporary(t), asked = [];
  let answer = false;
  const engine = engineStub(projects), ipc = createTileIpc({ engine, projectsRoot: projects, confirm: async (what) => { asked.push(what); return answer; } });
  for (const id of ['reopened', 'listed', 'stranger']) makeFolder(projects, id);
  await ipc.call(1, 'maskBegin', 'mine', 's1', 600, 300, null);                       // a new project: its folder appears with this session's work
  makeFolder(projects, 'mine');
  await ipc.call(1, 'reopen', 'reopened', 'a'.repeat(64), randomUUID());            // a project saved in an earlier session, opened again
  await ipc.call(1, 'announceProjects', ['listed', 'Bad Name', 'con', 7]);             // invalid entries are ignored
  assert.deepEqual(await ipc.call(1, 'deleteProjectStore', 'stranger'), { error: { code: 'INVALID_REQUEST', field: 'project' } });
  assert.ok(fs.existsSync(path.join(projects, 'stranger')) && asked.length === 0, 'unknown: refused without a question');
  for (const id of ['listed', 'reopened']) {
    assert.deepEqual(await ipc.call(1, 'deleteProjectStore', id), { ok: { deleted: false, declined: true } }, id);
    assert.ok(fs.existsSync(path.join(projects, id)), 'declined: the folder stays: ' + id);
  }
  assert.deepEqual(asked, [{ kind: 'delete', project: 'listed' }, { kind: 'delete', project: 'reopened' }]);
  answer = true;
  assert.deepEqual(await ipc.call(1, 'deleteProjectStore', 'listed'), { ok: { deleted: true } });
  assert.ok(!fs.existsSync(path.join(projects, 'listed')));
  asked.length = 0;
  assert.deepEqual(await ipc.call(1, 'deleteProjectStore', 'mine'), { ok: { deleted: true } });
  assert.equal(asked.length, 0, 'a store this session created is deleted without a question');
  assert.deepEqual(await ipc.call(1, 'deleteProjectStore', 'nothing-here'), { ok: { deleted: false } }, 'no folder: nothing to ask');
  assert.deepEqual(await ipc.call(1, 'announceProjects', 'all'), { error: { code: 'INVALID_REQUEST', field: 'projects' } });
});

test('card M8.4.38: a script that reopens another project can neither delete its store without the user nor wipe its versions with a clean-up', async (t) => {
  const projects = temporary(t), asked = [], engine = engineStub(projects);
  const ipc = createTileIpc({ engine, projectsRoot: projects, confirm: async (what) => { asked.push(what); return false; } });
  storedBefore(projects, 'victim', oldVersions);
  assert.ok((await ipc.call(1, 'reopen', 'victim', 'a'.repeat(64), randomUUID())).ok, 'any project can be reopened');
  assert.deepEqual(await ipc.call(1, 'announceProjects', ['victim']), { ok: { known: 1 } });
  assert.deepEqual(await ipc.call(1, 'deleteProjectStore', 'victim'), { ok: { deleted: false, declined: true } });
  assert.deepEqual(asked, [{ kind: 'delete', project: 'victim' }], 'the main process asked');
  assert.deepEqual((await ipc.call(1, 'maskRetain', 'victim', [])).ok, { removed: { manifests: 0, blobs: 0 } });
  assert.deepEqual([...engine.calls.findLast((c) => c.op === 'mask.retain').payload.keep].sort(), oldVersions, 'every earlier version is named to be kept');
  // Versions committed in this session (a script's or the user's) may be cleaned up; the earlier ones still stay.
  const begun = (await ipc.call(1, 'maskBegin', 'victim', 's1', 600, 300, oldVersions[0])).ok;
  const first = (await ipc.call(1, 'maskCommit', begun.staged, tablesOf)).ok.manifest;
  const again = (await ipc.call(1, 'maskBegin', 'victim', 's1', 600, 300, first)).ok;
  const second = (await ipc.call(1, 'maskCommit', again.staged, tablesOf)).ok.manifest;
  assert.deepEqual((await ipc.call(1, 'maskRetain', 'victim', [])).ok, { removed: { manifests: 2, blobs: 0 } });
  assert.deepEqual(versionsOf(projects, 'victim'), oldVersions, 'only the versions of this session were removed');
  assert.ok(![first, second].some((name) => versionsOf(projects, 'victim').includes(name)));
  assert.ok(fs.existsSync(path.join(projects, 'victim')), 'the folder stays');
});

test('a clean-up keeps the saved versions and removes the superseded ones this session wrote; in a store it created it removes any other', async (t) => {
  const projects = temporary(t), engine = engineStub(projects), ipc = createTileIpc({ engine, projectsRoot: projects });
  storedBefore(projects, 'reopened', oldVersions);
  await ipc.call(1, 'reopen', 'reopened', 'a'.repeat(64), randomUUID());
  const write = async (project, base) => { const { staged } = (await ipc.call(1, 'maskBegin', project, 's1', 600, 300, base)).ok; return (await ipc.call(1, 'maskCommit', staged, tablesOf)).ok.manifest; };
  const edited = await write('reopened', oldVersions[0]), saved = await write('reopened', edited);
  await ipc.call(1, 'maskRetain', 'reopened', [saved]);                              // the save: the section now names `saved`
  assert.deepEqual(versionsOf(projects, 'reopened'), [...oldVersions, saved].sort(), 'the intermediate version went; the earlier ones stay');
  const one = await write('fresh', null), two = await write('fresh', one);            // a project new in this session
  storedBefore(projects, 'fresh', ['9'.repeat(64)]);                                // a version that appeared there, not named by the save
  await ipc.call(1, 'maskRetain', 'fresh', [two]);
  assert.deepEqual(versionsOf(projects, 'fresh'), [two]);
  assert.deepEqual(await ipc.call(1, 'maskRetain', 'reopened', Array(1025).fill(saved)), { error: { code: 'INVALID_REQUEST', field: 'keep' } });
});

test('a clean-up that would have to keep more versions than the engine accepts is refused whole', async (t) => {
  const projects = temporary(t), engine = engineStub(projects), ipc = createTileIpc({ engine, projectsRoot: projects });
  storedBefore(projects, 'crowded', Array.from({ length: 1025 }, (_, k) => createHash('sha256').update(String(k)).digest('hex')));
  await ipc.call(1, 'announceProjects', ['crowded']);
  assert.deepEqual(await ipc.call(1, 'maskRetain', 'crowded', []), { error: { code: 'LIMIT_EXCEEDED', field: 'keep' } });
  assert.ok(!engine.calls.some((c) => c.op === 'mask.retain'), 'nothing reached the engine');
});

test('the operations on a project refuse a store the page neither opened, announced nor created in this session', async (t) => {
  const projects = temporary(t), engine = engineStub(projects), ipc = createTileIpc({ engine, projectsRoot: projects }), m = 'd'.repeat(64), p = 'b'.repeat(64);
  storedBefore(projects, 'stranger', [m]);
  const calls = [['maskBegin', 'stranger', 's1', 600, 300, null], ['maskRetain', 'stranger', [m]], ['maskInfo', 'stranger', m, 0], ['maskRead', 'stranger', m, 'labels', [[0, 0]]],
    ['derivedPut', 'stranger', m, 'reopen', Buffer.alloc(4)], ['derivedGet', 'stranger', m, 'reopen'], ['maskExport', 'stranger', m, null],
    ['maskImport', 'stranger', 'manifest', [{ name: m, bytes: Buffer.from('{}') }]], ['rememberSource', 'stranger', p], ['sourceCopyRead', 'stranger', p, 0],
    ['sourceImportBegin', 'stranger', p, 'a.png', 5], ['sourceInfo', 'stranger', p], ['locate', 'stranger', p, 5, randomUUID(), randomUUID()],
    ['copySource', 'stranger', p, randomUUID()], ['copyProjectStore', 'stranger', 'copy', [m], [], randomUUID()]];
  for (const [name, ...args] of calls) {
    const field = name === 'copyProjectStore' ? 'from' : 'project';
    assert.deepEqual(await ipc.call(1, name, ...args), { error: { code: 'INVALID_REQUEST', field } }, name);
  }
  assert.deepEqual(engine.calls, [], 'nothing reached the engine');
  await ipc.call(1, 'announceProjects', ['stranger']);                                // a project of the library: a backup may read it
  assert.ok((await ipc.call(1, 'maskExport', 'stranger', m, null)).ok);
  assert.ok((await ipc.call(1, 'derivedGet', 'stranger', m, 'reopen')).ok);
  assert.deepEqual((await ipc.call(1, 'sourceCopyRead', 'stranger', p, 0)).ok, { copied: false });
});

test('a copy goes only from an opened, announced or created store and only into a folder this session created', async (t) => {
  const projects = temporary(t), engine = engineStub(projects), ipc = createTileIpc({ engine, projectsRoot: projects, confirm: async () => false });
  for (const id of ['source', 'announced', 'taken']) makeFolder(projects, id);
  const manifests = ['1'.repeat(64)], key = () => randomUUID();
  assert.deepEqual(await ipc.call(1, 'copyProjectStore', 'announced', 'target', manifests, [], key()), { error: { code: 'INVALID_REQUEST', field: 'from' } }, 'neither opened nor announced');
  await ipc.call(1, 'announceProjects', ['announced', 'taken']);
  await ipc.call(1, 'reopen', 'source', 'a'.repeat(64), key());
  assert.deepEqual(await ipc.call(1, 'copyProjectStore', 'source', 'taken', manifests, [], key()), { error: { code: 'INVALID_REQUEST', field: 'to' } }, 'another project folder is never overwritten');
  await ipc.call(1, 'reopen', 'taken', 'a'.repeat(64), key());
  assert.deepEqual(await ipc.call(1, 'copyProjectStore', 'source', 'taken', manifests, [], key()), { error: { code: 'INVALID_REQUEST', field: 'to' } }, 'not even one the page reopened');
  assert.deepEqual(await ipc.call(1, 'copyProjectStore', 'source', 'target', manifests, [], key()), { ok: { copied: true } });
  assert.deepEqual(await ipc.call(1, 'copyProjectStore', 'announced', 'target2', manifests, [], key()), { ok: { copied: true } }, 'an announced store can be copied from');
  makeFolder(projects, 'target');
  assert.deepEqual(await ipc.call(1, 'copyProjectStore', 'source', 'target', manifests, [], key()), { ok: { copied: true } }, 'the page may copy again into a store it created');
  assert.deepEqual(await ipc.call(1, 'deleteProjectStore', 'target'), { ok: { deleted: true } }, 'a store the copy created is this session\'s');
});

test('a store deleted after the user agreed is this session\'s when it is written again', async (t) => {
  const projects = temporary(t), engine = engineStub(projects), asked = [];
  const ipc = createTileIpc({ engine, projectsRoot: projects, confirm: async (what) => { asked.push(what); return true; } });
  storedBefore(projects, 'again', oldVersions);
  await ipc.call(1, 'announceProjects', ['again']);
  assert.deepEqual(await ipc.call(1, 'deleteProjectStore', 'again'), { ok: { deleted: true } });
  assert.equal(asked.length, 1);
  makeFolder(projects, 'again');
  assert.deepEqual(await ipc.call(1, 'deleteProjectStore', 'again'), { ok: { deleted: true } });
  assert.equal(asked.length, 1, 'no second question');
});

// ---- IPC frames (card M8.4.38) ----
test('only the top frame of an app page may call the engine, tile and trainer channels', () => {
  const mainFrame = { url: 'app://corantool/app/index.html' }, sender = { mainFrame };
  assert.equal(fromTopAppFrame({ senderFrame: mainFrame, sender }), true);
  assert.equal(fromTopAppFrame({ senderFrame: { url: 'app://corantool/app/index.html' }, sender }), false, 'a frame inside the page');
  const web = { url: 'https://example.org/' };
  assert.equal(fromTopAppFrame({ senderFrame: web, sender: { mainFrame: web } }), false, 'not an app page');
  for (const event of [null, {}, { senderFrame: null, sender }, { senderFrame: mainFrame }]) assert.equal(fromTopAppFrame(event), false);
  const source = fs.readFileSync(new URL('../../desktop/main.js', import.meta.url), 'utf8');
  assert.ok(source.includes("const handle = (ch, fn) => ipcMain.handle(ch, (e, ...a) => { if (!fromTopAppFrame(e)) throw new Error('forbidden');"), 'trainer: channels use it');
  assert.equal(source.split("if (!fromTopAppFrame(event)) throw new Error('forbidden');").length - 1, 2, 'engine: and tiles: channels use it');
});

// ---- training requests (card M8.4.38) ----
const ZIP = Uint8Array.from([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]);
test('a training request is checked against strict types and bounds before anything runs', () => {
  const ok = trainingOptions({ name: 'core v1', zip: ZIP, epochs: 4, pretrained: false, val: ['A 1'], test: ['B'] });
  assert.deepEqual({ ...ok, zip: ok.zip.length }, { name: 'core_v1', resume: false, epochs: 4, pretrained: false, tile: 512, overlap: 64, encoder: 'resnet34', val: ['A 1'], test: ['B'], zip: 22 });
  assert.equal(trainingOptions({ name: 'm', resume: true }).zip, null, 'a resumed run sends no ZIP');
  const refused = [[{ zip: ZIP, val: ['--device=cpu'] }, 'val'], [{ zip: ZIP, test: ['-x'] }, 'test'], [{ zip: ZIP, val: ['a\nb'] }, 'val'], [{ zip: ZIP, val: [''] }, 'val'],
    [{ zip: ZIP, val: 'A' }, 'val'], [{ zip: ZIP, val: Array(1025).fill('a') }, 'val'], [{ zip: ZIP, encoder: '--no-pretrained' }, 'encoder'], [{ zip: ZIP, encoder: 'vgg' }, 'encoder'],
    [{ zip: ZIP, epochs: '60 --lr 1' }, 'epochs'], [{ zip: ZIP, epochs: 2.5 }, 'epochs'], [{ zip: ZIP, epochs: 0 }, 'epochs'], [{ zip: ZIP, epochs: 10001 }, 'epochs'],
    [{ zip: ZIP, tile: 32 }, 'tile'], [{ zip: ZIP, overlap: 512 }, 'overlap'], [{ zip: ZIP, overlap: -1 }, 'overlap'], [{ zip: ZIP, pretrained: 'no' }, 'pretrained'],
    [{ zip: ZIP, resume: 1 }, 'resume'], [{ zip: ZIP, name: 7 }, 'name'], [{ zip: ZIP, device: 'cpu' }, 'device'], [{}, 'zip'], [{ zip: 'PK' }, 'zip'],
    [{ zip: new Uint8Array(22) }, 'zip'], [{ zip: ZIP.subarray(0, 10) }, 'zip'], [null, 'options'], [[ZIP], 'options']];
  for (const [options, field] of refused) {
    assert.throws(() => trainingOptions(options), (error) => error.code === 'INVALID_OPTION' && error.field === field, String(JSON.stringify(options)).slice(0, 60));
  }
});

test('a training ZIP larger than the limit, or a request with an option that is not allowed, is refused before anything is written', async (t) => {
  const root = temporary(t), trainer = new Trainer({ root, python: 'fake-python' });
  trainer.run = async () => { throw new Error('nothing may run'); };
  const big = Buffer.alloc(64); big.set([0x50, 0x4b, 0x03, 0x04]);
  assert.throws(() => trainingOptions({ zip: big }, { maxZipBytes: 63 }), (error) => error.field === 'zip');
  assert.ok(trainingOptions({ zip: big }, { maxZipBytes: 64 }).zip.length === 64);
  assert.equal(MAX_TRAINING_ZIP_BYTES, 2 * 2 ** 30);
  await assert.rejects(trainer.train({ name: 'm', zip: ZIP, val: ['--evil'] }), (error) => error.code === 'INVALID_OPTION');
  assert.equal(trainer.busy, null);
  assert.deepEqual(fs.readdirSync(path.join(root, 'staging')), [], 'no run was prepared');
});

test('the trainer never blocks the main process: no synchronous child process, and a slow command leaves the event loop free', async () => {
  const source = fs.readFileSync(new URL('../../desktop/trainer.js', import.meta.url), 'utf8');
  assert.ok(!/spawnSync|execSync|execFileSync/.test(source), 'no synchronous child process in trainer.js');
  let ticks = 0;
  const timer = setInterval(() => { ticks++; }, 20);
  try {
    const slow = await capture(process.execPath, ['-e', 'setTimeout(() => console.log("done"), 400)'], { timeoutMs: 10000 });
    assert.deepEqual([slow.status, slow.stdout.trim()], [0, 'done']);
    assert.ok(ticks >= 5, 'timers ran while the command ran: ' + ticks);
    const cut = await capture(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 300 });
    assert.equal(cut.status, null, 'a command past its time is stopped');
    assert.equal((await capture(path.join(os.tmpdir(), 'no-such-program-' + randomUUID()), [], { timeoutMs: 1000 })).status, null);
  } finally { clearInterval(timer); }
});

test('cancelling a training ends the command and every process it started', { timeout: 30000 }, async (t) => {
  const root = temporary(t), trainer = new Trainer({ root, python: 'fake-python' }), pidFile = path.join(root, 'grandchild.pid');
  // The command starts a grandchild that would outlive a plain kill of its parent, writes its process id, and waits.
  const script = `const { spawn } = require('node:child_process'); const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(g.pid)); setInterval(() => {}, 1000);`;
  trainer.busy = 'train';
  const running = trainer.run(process.execPath, ['-e', script]);
  for (let i = 0; i < 200 && !fs.existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 50));
  const grandchild = Number(fs.readFileSync(pidFile, 'utf8')), child = trainer.child.pid;
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  assert.ok(alive(grandchild) && alive(child));
  trainer.cancel();
  assert.notEqual(await running, 0, 'the command was stopped (-1 for a signal; taskkill /F ends it with exit code 1)');
  for (let i = 0; i < 200 && alive(grandchild); i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(alive(grandchild), false, 'the grandchild was stopped too');
  trainer.busy = null;
});

// ---- deadlines of the store operations ----
const script = fileURLToPath(new URL('../../src/sedcoretool/engine/server.py', import.meta.url));
const pythonCheck = spawnSync(process.platform === 'win32' ? 'py' : 'python3', [...(process.platform === 'win32' ? ['-3.12'] : []), '-c', 'import sys; print(sys.executable)'], { encoding: 'utf8', windowsHide: true });
const python = process.env.SEDCORETOOL_TEST_PYTHON || (pythonCheck.status === 0 ? pythonCheck.stdout.trim() : null);

test('every mask-store operation has a deadline longer than an ordinary request', () => {
  const ops = ['mask.begin', 'mask.put', 'mask.commit', 'mask.discard', 'mask.read', 'mask.retain', 'mask.info', 'mask.copy', 'mask.slice', 'mask.forget', 'mask.derived.put', 'mask.derived.get', 'mask.export', 'mask.import'];
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
