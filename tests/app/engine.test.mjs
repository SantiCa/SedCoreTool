import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { EngineClient, createEngineService } = require('../../desktop/engine.js');
const { MAX_JSON, MAX_CHUNK, parseControl, controlFrame, frame, ControlReader } = require('../../desktop/engine-protocol.js');
const script = fileURLToPath(new URL('../../src/sedcoretool/engine/server.py', import.meta.url));
const runtimeId = '0'.repeat(64);
const pythonCheck = spawnSync(process.platform === 'win32' ? 'py' : 'python3',
  [...(process.platform === 'win32' ? ['-3.12'] : []), '-c', 'import sys; print(sys.executable)'], { encoding: 'utf8', windowsHide: true });
const python = process.env.SEDCORETOOL_TEST_PYTHON || (pythonCheck.status === 0 ? pythonCheck.stdout.trim() : null);
const digest = (data) => createHash('sha256').update(data).digest('hex');

test('engine response framing handles arbitrary splits, coalescing and exact control limits', () => {
  const value = { depth: -10, result: ['one', 'two'] };
  const encoded = Buffer.concat(controlFrame(value));
  for (let split = 1; split < encoded.length; split++) {
    const decoded = [], reader = new ControlReader((item) => decoded.push(item));
    reader.push(encoded.subarray(0, split)); reader.push(Buffer.concat([encoded.subarray(split), encoded])); reader.end();
    assert.deepEqual(decoded, [value, value]);
  }
  const oversized = Buffer.alloc(12); oversized.write('SCE1'); oversized[4] = 1; oversized.writeUInt32LE(MAX_JSON + 1, 8);
  assert.throws(() => new ControlReader(() => {}).push(oversized), /header/);
  const highBit = Buffer.from(encoded); highBit[0] |= 128;
  assert.throws(() => new ControlReader(() => {}).push(highBit), /header/);
  const reader = new ControlReader(() => {}); reader.push(encoded.subarray(0, -1));
  assert.throws(() => reader.end(), /Truncated/);
});

test('engine controls reject duplicate keys, malformed UTF-8, deep structures and unsafe numbers', () => {
  for (const text of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"x":1e309}', '{"x":9007199254740992}', '['.repeat(17) + '0' + ']'.repeat(17)]) {
    assert.throws(() => parseControl(Buffer.from(text)));
  }
  assert.throws(() => parseControl(Buffer.from([0xff])));
  assert.deepEqual(parseControl(Buffer.from('{"a":{"x":1},"b":{"x":2},"literal":"{\\\"x\\\":1}"}')).b, { x: 2 });
});

// Card M8.4.26: a start that fails explains itself (once on GitHub's Windows runner the engine was unavailable at start and the rerun passed).
// The evidence: time from spawn to failure against the request deadline, whether the process exited first (code, signal) or failed to
// spawn, and the last lines of its standard error. SEDCORETOOL_ENGINE_START_LOG=<file> also appends every start (JSON lines).
const startLog = process.env.SEDCORETOOL_ENGINE_START_LOG;
async function clientFixture(t, options = {}) {
  const client = new EngineClient({ executable: python, script, version: 'test', runtimeId, captureDiagnostics: true, ...options });
  t.after(() => client.stop());
  const started = performance.now(), starting = client.start(), child = client.child;
  let exited = null, spawnError = null;
  child?.once('exit', (code, signal) => { exited ??= { code, signal, atMs: Math.round(performance.now() - started) }; });
  child?.once('error', (error) => { spawnError ??= String(error?.message || error); });
  const record = async (entry) => { if (startLog) await fs.appendFile(startLog, JSON.stringify({ test: t.name, platform: process.platform, ...entry }) + '\n'); };
  try {
    await starting;
  } catch (error) {
    const failedMs = Math.round(performance.now() - started);
    const exitedFirst = exited !== null && exited.atMs <= failedMs;
    await Promise.race([client.exited, new Promise((resolve) => setTimeout(resolve, 2000))]);
    const evidence = {
      code: error?.code ?? null, failedMs, deadlineMs: client.options.timeoutMs, spawnError,
      reason: spawnError ? 'the process could not be started'
        : exitedFirst ? 'the process exited before its handshake'
          : failedMs >= client.options.timeoutMs - 50 ? 'no handshake within the request deadline' : 'the handshake was refused or malformed',
      exit: exitedFirst ? exited : null, stderr: client.stderr.toString('utf8').split(/\r?\n/).filter(Boolean).slice(-20),
    };
    await record({ ok: false, ...evidence });
    throw Object.assign(new Error('engine did not start: ' + JSON.stringify(evidence)), { code: error?.code, cause: error });
  }
  await record({ ok: true, startMs: Math.round(performance.now() - started) });
  return client;
}

async function upload(client, data) {
  const { handle } = await client.request('buffer.begin', { dtype: 'u8', shape: [data.length], byte_length: data.length, sha256: digest(data) });
  for (let offset = 0; offset < data.length; offset += MAX_CHUNK) {
    const chunk = data.subarray(offset, offset + MAX_CHUNK);
    const result = await client.request('buffer.chunk', { handle, offset, byte_length: chunk.length }, chunk);
    assert.equal(result.next_offset, offset + chunk.length);
  }
  await client.request('buffer.commit', { handle });
  return handle;
}

test('a start that fails says why: the process exited first, or no handshake came within the deadline', { skip: !python }, async (t) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'engine-start-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const exits = path.join(folder, 'exits.py'), silent = path.join(folder, 'silent.py');
  await fs.writeFile(exits, "import sys\nsys.stderr.write('engine could not import its runtime\\n')\nsys.exit(3)\n");
  await fs.writeFile(silent, 'import time\ntime.sleep(30)\n');
  await assert.rejects(clientFixture(t, { script: exits }), (error) => {
    const evidence = JSON.parse(error.message.replace('engine did not start: ', ''));
    assert.equal(error.code, 'ENGINE_UNAVAILABLE');
    assert.equal(evidence.reason, 'the process exited before its handshake');
    assert.equal(evidence.exit.code, 3);
    assert.deepEqual(evidence.stderr, ['engine could not import its runtime']);
    return true;
  });
  await assert.rejects(clientFixture(t, { script: silent, timeoutMs: 400 }), (error) => {
    const evidence = JSON.parse(error.message.replace('engine did not start: ', ''));
    assert.equal(evidence.reason, 'no handshake within the request deadline');
    assert.ok(evidence.failedMs >= 350 && evidence.deadlineMs === 400, JSON.stringify(evidence));
    return true;
  });
});

test('actual isolated Python transfers multiple bounded chunks and runs the diagnostic', { skip: !python }, async (t) => {
  const client = await clientFixture(t);
  assert.deepEqual(client.status().methods, ['buffer.digest/1', 'section.intervals/1']);
  const data = Buffer.alloc(MAX_CHUNK * 2 + 137, 93), handle = await upload(client, data);
  assert.deepEqual(await client.request('buffer.digest', { handle }), { sha256: digest(data), byte_length: data.length });
  assert.deepEqual(await client.request('buffer.release', { handles: [handle] }), { released: [handle] });
  await assert.rejects(client.request('buffer.digest', { handle }), { code: 'INVALID_BUFFER' });
  assert.equal(client.status().state, 'ready');
  const scratch = client.scratchDirectory;
  const child = client.child;
  await client.stop();
  assert.equal(child.exitCode, 0, 'normal shutdown exits without a forced kill');
  assert.equal(existsSync(scratch), false, 'normal shutdown removes private staging data');
});

test('local saturation, invalid chunks and cancelled jobs preserve the responding session', { skip: !python }, async (t) => {
  const client = await clientFixture(t);
  const pending = Array.from({ length: 32 }, () => client.request('buffer.release', { handles: [] }));
  await assert.rejects(client.request('buffer.release', { handles: [] }), { code: 'BUSY' });
  await Promise.all(pending);
  const handle = await upload(client, Buffer.alloc(123456, 17));
  await assert.rejects(client.request('buffer.chunk', { handle, offset: 0, byte_length: 1 }, Buffer.from([1])), { code: 'INVALID_BUFFER' });
  const chunks = Array.from({ length: 2 }, () => assert.rejects(
    client.request('buffer.chunk', { handle, offset: 0, byte_length: 1 }, Buffer.from([1])), { code: 'INVALID_BUFFER' }));
  await assert.rejects(client.request('buffer.chunk', { handle, offset: 0, byte_length: 1 }, Buffer.from([1])), { code: 'BUSY' });
  await Promise.all(chunks);
  const job = client.request('buffer.digest', { handle });
  const cancellation = await client.request('job.cancel', { request_id: job.requestId });
  assert.equal(cancellation.state, 'requested');
  assert.deepEqual(await job, { cancelled: true });
  assert.equal(client.status().state, 'ready');
});

test('coordinator death invalidates handles, rejects in-flight work and permits a new clean session', { skip: !python }, async (t) => {
  const client = await clientFixture(t);
  const handle = await upload(client, Buffer.alloc(32, 4));
  const session = client.session, scratch = client.scratchDirectory;
  const inFlight = client.request('buffer.digest', { handle });
  const rejected = assert.rejects(inFlight, { code: 'ENGINE_UNAVAILABLE' });
  client.child.kill();
  await client.exited;
  await rejected;
  assert.equal(client.status().state, 'unavailable');
  assert.equal(existsSync(scratch), false, 'failed coordinator staging is reaped by its main-process owner');
  await assert.rejects(client.request('buffer.digest', { handle }), { code: 'ENGINE_UNAVAILABLE' });
  await client.start();
  assert.notEqual(client.session, session);
  await assert.rejects(client.request('buffer.digest', { handle }), { code: 'INVALID_BUFFER' });
});

test('a handshake that advertises a method the client does not know makes the engine unavailable', { skip: !python }, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sedcoretool-engine-fixture-'));
  const fixture = path.join(directory, 'unknown-method.py');
  const engine = path.dirname(script).replace(/\\/g, '/');
  await fs.writeFile(fixture, [
    'import sys', `sys.path.insert(0, ${JSON.stringify(engine)})`, 'from protocol import read_frame, strict_json, write_json',
    'request = strict_json(read_frame(sys.stdin.buffer)[1])',
    'write_json(sys.stdout.buffer, {"v": 1, "kind": "response", "session": request["session"], "id": request["id"], "op": "hello", "status": "ok",',
    `  "result": {"protocol": 1, "engine_version": "test", "runtime_id": ${JSON.stringify(runtimeId)}, "methods": ["buffer.digest/1", "teapot.brew/1"], "limits": {}}})`,
    'sys.stdin.buffer.read()', ''].join('\n'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const client = new EngineClient({ executable: python, script: fixture, version: 'test', runtimeId, timeoutMs: 3000 });
  t.after(() => client.stop());
  await assert.rejects(client.start(), { code: 'ENGINE_UNAVAILABLE' });
  assert.equal(client.status().state, 'unavailable');
  assert.deepEqual(client.status().methods, []);
});

test('a stalled child fails within the startup deadline and is reaped', { skip: !python }, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sedcoretool-engine-fixture-'));
  const fixture = path.join(directory, 'stalled.py');
  await fs.writeFile(fixture, 'import time\ntime.sleep(30)\n');
  t.after(async () => {
    const absolute = path.resolve(directory);
    assert.equal(path.dirname(absolute), path.resolve(os.tmpdir()));
    assert.match(path.basename(absolute), /^sedcoretool-engine-fixture-[a-zA-Z0-9]+$/);
    await fs.rm(absolute, { recursive: true, force: true });
  });
  const client = new EngineClient({ executable: python, script: fixture, version: 'test', runtimeId, timeoutMs: 150 });
  t.after(() => client.stop());
  await assert.rejects(client.start(), { code: 'ENGINE_UNAVAILABLE' });
  await client.exited;
  assert.equal(client.status().state, 'unavailable');
  assert.equal(existsSync(client.scratchDirectory), false);
});

test('unexpected binary frames invalidate and clean the session', { skip: !python }, async (t) => {
  const client = await clientFixture(t);
  const scratch = client.scratchDirectory;
  for (const part of frame(2, Buffer.from([1]))) client.child.stdin.write(part);
  await client.exited;
  assert.equal(client.status().state, 'unavailable');
  assert.equal(existsSync(scratch), false);
});

test('disabled and packaged services never launch a user interpreter', async () => {
  for (const [enabled, packaged, state] of [[false, false, 'disabled'], [true, true, 'unavailable'], [true, false, 'unavailable']]) {
    const service = createEngineService({ enabled, packaged, executable: 'untrusted-relative-path', version: 'test', sourceDirectory: '/not-used' });
    await service.start();
    assert.equal(service.status().state, state);
    assert.deepEqual(service.status().methods, []);
    await service.stop();
  }
});

test('binary frames are accepted only when the previous control frame announced their exact length', () => {
  const control = Buffer.concat(controlFrame({ ok: true })), binary = Buffer.concat(frame(2, Buffer.from('abcde')));
  const stream = Buffer.concat([control, binary]);
  for (let split = 1; split < stream.length; split++) {
    const controls = [], payloads = [], reader = new ControlReader((value) => { controls.push(value); return { binaryBytes: 5 }; }, (bytes) => payloads.push(bytes.toString()));
    reader.push(stream.subarray(0, split)); reader.push(stream.subarray(split)); reader.end();
    assert.deepEqual([controls, payloads], [[{ ok: true }], ['abcde']]);
  }
  const announce = (n) => new ControlReader(() => ({ binaryBytes: n }), () => {});
  assert.throws(() => new ControlReader(() => {}, () => {}).push(binary), /header/, 'unannounced binary frame');
  assert.throws(() => announce(4).push(stream), /header/, 'announced 4 bytes, received 5');
  assert.throws(() => announce(5).push(Buffer.concat([control, control])), /header/, 'announced a binary frame, received a control frame');
  assert.throws(() => new ControlReader(() => ({ binaryBytes: 5 })).push(control), /announcement/, 'no binary handler');
  assert.throws(() => announce(MAX_CHUNK + 1).push(control), /announcement/);
  const truncated = announce(5); truncated.push(control);
  assert.throws(() => truncated.end(), /Truncated/, 'the announced frame never came');
});

test('buffer.read returns exact ranges, rejects bad ranges without a binary frame and keeps the session', { skip: !python }, async (t) => {
  const client = await clientFixture(t);
  const data = Buffer.from(Array.from({ length: MAX_CHUNK + 4097 }, (_, i) => (i * 7 + 3) % 251)), handle = await upload(client, data);
  for (const [offset, length] of [[0, 1], [0, MAX_CHUNK], [MAX_CHUNK, 4097], [12345, 777], [data.length - 1, 1]]) {
    const read = await client.request('buffer.read', { handle, offset, byte_length: length });
    assert.equal(read.offset, offset); assert.equal(read.byte_length, length);
    assert.ok(read.bytes.equals(data.subarray(offset, offset + length)), `bytes at ${offset}+${length}`);
  }
  for (const [offset, length] of [[0, 0], [0, MAX_CHUNK + 1], [data.length, 1], [data.length - 1, 2]]) {
    await assert.rejects(client.request('buffer.read', { handle, offset, byte_length: length }), { code: 'INVALID_REQUEST' });
  }
  await assert.rejects(client.request('buffer.read', { handle: '0'.repeat(8) + '-0000-4000-8000-' + '0'.repeat(12), offset: 0, byte_length: 1 }), { code: 'INVALID_BUFFER' });
  assert.equal(client.status().state, 'ready');
  assert.equal((await client.request('buffer.read', { handle, offset: 5, byte_length: 3 })).bytes.length, 3, 'still usable after the rejections');
});

test('concurrent buffer.read requests each receive their own bytes', { skip: !python }, async (t) => {
  const client = await clientFixture(t);
  const data = Buffer.from(Array.from({ length: 300000 }, (_, i) => i % 253)), handle = await upload(client, data);
  const ranges = Array.from({ length: 12 }, (_, i) => [i * 20011, 10000 + i]);
  const reads = await Promise.all(ranges.map(([offset, length]) => client.request('buffer.read', { handle, offset, byte_length: length })));
  reads.forEach((read, i) => assert.ok(read.bytes.equals(data.subarray(ranges[i][0], ranges[i][0] + ranges[i][1])), `range ${i}`));
});

test('a buffer.read answer that does not match its request makes the engine unavailable', { skip: !python }, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sedcoretool-engine-fixture-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const engine = path.dirname(script).replaceAll(path.sep, '/');
  // Each variant answers hello correctly, then answers the first buffer.read with the given result and binary payload.
  const variants = {
    'another range': ['{"offset": 1, "byte_length": 2}', 'b"ab"'],
    'a different length': ['{"offset": 0, "byte_length": 3}', 'b"abc"'],
    'a shorter binary frame': ['{"offset": 0, "byte_length": 2}', 'b"a"'],
    'extra result fields': ['{"offset": 0, "byte_length": 2, "extra": 1}', 'b"ab"'],
    'no binary frame': ['{"offset": 0, "byte_length": 2}', null],
  };
  for (const [name, [result, binary]] of Object.entries(variants)) {
    const fixture = path.join(directory, `${name.replace(/\W+/g, '-')}.py`);
    await fs.writeFile(fixture, [
      'import json, sys', `sys.path.insert(0, ${JSON.stringify(engine)})`, 'from protocol import read_frame, strict_json, write_json, write_binary',
      'def answer(request, result):',
      '  write_json(sys.stdout.buffer, {"v": 1, "kind": "response", "session": request["session"], "id": request["id"], "op": request["op"], "status": "ok", "result": result})',
      'hello = strict_json(read_frame(sys.stdin.buffer)[1])',
      `answer(hello, {"protocol": 1, "engine_version": "test", "runtime_id": ${JSON.stringify(runtimeId)}, "methods": ["buffer.digest/1"], "limits": {}})`,
      'read = strict_json(read_frame(sys.stdin.buffer)[1])',
      `answer(read, json.loads(${JSON.stringify(result)}))`,
      ...(binary ? [`write_binary(sys.stdout.buffer, ${binary})`] : []),
      'sys.stdin.buffer.read()', ''].join('\n'));
    const client = new EngineClient({ executable: python, script: fixture, version: 'test', runtimeId, timeoutMs: 1500 });
    t.after(() => client.stop());
    await client.start();
    await assert.rejects(client.request('buffer.read', { handle: '0'.repeat(8) + '-0000-4000-8000-' + '0'.repeat(12), offset: 0, byte_length: 2 }),
      { code: 'ENGINE_UNAVAILABLE' }, name);
    assert.equal(client.status().state, 'unavailable', name);
    await client.stop();
  }
});

test('buffer.derive through the real client and engine: a copy that takes only the changed parts, and a hash that must match', { skip: !python }, async (t) => {
  const client = await clientFixture(t);
  const data = Buffer.from(Array.from({ length: 300000 }, (_, i) => (i * 5 + 1) % 253)), base = await upload(client, data);
  const edited = Buffer.from(data); edited.fill(250, 1000, 1500); edited.fill(251, 200000, 200010);
  const sha = createHash('sha256').update(edited).digest('hex'), descriptor = { dtype: 'u8', shape: [data.length], byte_length: data.length, sha256: sha };
  const { handle } = await client.request('buffer.derive', { base, ...descriptor });
  await client.request('buffer.chunk', { handle, offset: 1000, byte_length: 500 }, edited.subarray(1000, 1500));
  await client.request('buffer.chunk', { handle, offset: 200000, byte_length: 10 }, edited.subarray(200000, 200010));
  assert.deepEqual((await client.request('buffer.commit', { handle })).sha256, sha);
  assert.ok((await client.request('buffer.read', { handle, offset: 0, byte_length: 4096 })).bytes.equals(edited.subarray(0, 4096)));
  assert.ok((await client.request('buffer.read', { handle: base, offset: 1000, byte_length: 8 })).bytes.equals(data.subarray(1000, 1008)), 'the base is untouched');
  const missed = (await client.request('buffer.derive', { base, ...descriptor })).handle;          // announces the edit and sends nothing
  await assert.rejects(client.request('buffer.commit', { handle: missed }), { code: 'INVALID_BUFFER' });
  await assert.rejects(client.request('buffer.derive', { base, ...descriptor, shape: [data.length - 1], byte_length: data.length - 1 }), { code: 'INVALID_BUFFER' });
  assert.equal(client.status().state, 'ready');
});

// ---- the engine service starts a new session (card M8.4.7) ----------------------------------------------------------------

const serviceRoot = fileURLToPath(new URL('../../', import.meta.url));
const newService = () => createEngineService({ enabled: true, packaged: false, executable: python, sourceDirectory: serviceRoot, version: 'test' });

test('restart gives a new ready session, ends the old process and keeps working; one restart at a time', { skip: !python, timeout: 60000 }, async (t) => {
  const service = newService();
  await service.start();
  t.after(() => service.stop());
  const first = service.session();
  assert.ok(first);
  const [a, b] = [service.restart(), service.restart()];
  assert.equal(service.status().state, 'starting', 'the old engine is not offered while the new one starts');
  assert.equal(service.session(), null);
  assert.deepEqual(await a, { restarted: true });
  assert.deepEqual(await b, { restarted: true });
  assert.equal(service.status().state, 'ready');
  assert.notEqual(service.session(), first);
  const second = service.session();
  assert.deepEqual(await service.restart(), { restarted: true });
  assert.notEqual(service.session(), second, 'two requests at the same time share one restart; a later one starts another');
});

test('a restart after the engine died brings it back, and buffers of the old session are gone', { skip: !python, timeout: 60000 }, async (t) => {
  const service = newService();
  await service.start();
  t.after(() => service.stop());
  const handle = (await service.request('buffer.begin', { dtype: 'u8', shape: [4], byte_length: 4, sha256: digest(Buffer.alloc(4, 1)) })).handle;
  const before = service.session();
  await service.request('shutdown', {});                                          // the coordinator ends by itself, as if it had crashed
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.notEqual(service.status().state, 'ready');
  assert.deepEqual(await service.restart(), { restarted: true });
  assert.equal(service.status().state, 'ready');
  assert.notEqual(service.session(), before);
  await assert.rejects(service.request('buffer.digest', { handle }), { code: 'INVALID_BUFFER' });
});

test('an automatic restart is allowed once per program session; the user may restart as often as they like', { skip: !python, timeout: 60000 }, async (t) => {
  const service = newService();
  await service.start();
  t.after(() => service.stop());
  assert.deepEqual(await service.restart({ automatic: true }), { restarted: true });
  assert.equal(service.automaticRestarts(), 1);
  const session = service.session();
  await assert.rejects(service.restart({ automatic: true }), { code: 'LIMIT_EXCEEDED', field: 'automatic' });
  assert.equal(service.session(), session, 'a refused restart changes nothing');
  assert.equal(service.status().state, 'ready');
  assert.deepEqual(await service.restart({ automatic: false }), { restarted: true });
  assert.notEqual(service.session(), session);
  assert.equal(service.automaticRestarts(), 1);
});

test('a disabled service and one that is closing never restart', { skip: !python, timeout: 60000 }, async () => {
  const disabled = createEngineService({ enabled: false, packaged: false, version: 'test', sourceDirectory: '/not-used' });
  await assert.rejects(disabled.restart(), { code: 'ENGINE_UNAVAILABLE' });
  const service = newService();
  await service.start();
  await service.stop();
  await assert.rejects(service.restart(), { code: 'ENGINE_UNAVAILABLE' });
  assert.equal(service.status().state, 'stopped');
});

test('closing the program while a restart is running starts nothing', { skip: !python, timeout: 60000 }, async () => {
  const service = newService();
  await service.start();
  const restarting = service.restart().catch((error) => error.code);
  await service.stop();
  assert.equal(await restarting, 'ENGINE_UNAVAILABLE');
  assert.equal(service.status().state, 'stopped');
  assert.equal(service.session(), null, 'no engine was started behind the closing program');
});

// ---- tile store (card M8.4.14, contract §8.5) ----------------------------------------------------------------------------------------

test('a control frame may announce several binary frames, which must arrive exactly and in order', () => {
  const control = Buffer.concat(controlFrame({ ok: true }));
  const parts = ['abc', 'defgh', 'i'].map((text) => Buffer.concat(frame(2, Buffer.from(text))));
  const stream = Buffer.concat([control, ...parts, control]);
  for (let split = 1; split < stream.length; split += 3) {
    const controls = [], payloads = [], reader = new ControlReader((value) => { controls.push(value); return controls.length === 1 ? { binaryFrames: [3, 5, 1] } : undefined; },
      (bytes) => payloads.push(bytes.toString()));
    reader.push(stream.subarray(0, split)); reader.push(stream.subarray(split)); reader.end();
    assert.deepEqual([controls.length, payloads], [2, ['abc', 'defgh', 'i']]);
  }
  const announce = (sizes) => new ControlReader(() => ({ binaryFrames: sizes }), () => {});
  assert.throws(() => announce([3, 5]).push(Buffer.concat([control, parts[0], control])), /header/, 'a control frame where a binary frame was announced');
  assert.throws(() => announce([3, 4]).push(Buffer.concat([control, parts[0], parts[1]])), /header/, 'a frame of the wrong length');
  for (const bad of [[], [0], [MAX_CHUNK + 1], Array(65).fill(1), [1.5], 'x']) assert.throws(() => announce(bad).push(control), /announcement/);
  const truncated = announce([3, 5]); truncated.push(Buffer.concat([control, parts[0]]));
  assert.throws(() => truncated.end(), /Truncated/, 'the second announced frame never came');
});

const pyvipsCheck = python ? spawnSync(python, ['-c', 'import pyvips'], { windowsHide: true }) : null;
const withPyvips = Boolean(python) && pyvipsCheck.status === 0;

test('the tile store through the real client: a build with progress events, pyramid.info and verified tiles in several frames', { skip: !withPyvips, timeout: 120000 }, async (t) => {
  const pyramidDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'sedcoretool-pyramids-test-'));
  t.after(() => fs.rm(pyramidDirectory, { recursive: true, force: true }));
  const client = await clientFixture(t, { pyramidDirectory });
  const source = fileURLToPath(new URL('../../examples/data/idealized_core_0-500cm.jpg', import.meta.url));
  const events = [];
  const built = await client.request('pyramid.build', { path: source, name: 'idealized_core_0-500cm.jpg' }, null, { onEvent: (event) => events.push(event) });
  assert.equal(built.pyramid, digest(await fs.readFile(source)));
  assert.equal(built.reused, false);
  assert.ok(events.length >= 1 && events.every((event) => ['hash', 'level0', 'levels'].includes(event.stage)));
  const info = await client.request('pyramid.info', { pyramid: built.pyramid });
  assert.equal(info.width, built.width); assert.equal(info.levels.length, built.levels);
  const positions = [[0, 0], [1, 0]].filter(([row]) => row < info.levels[0].rows);
  const read = await client.request('tile.read', { pyramid: built.pyramid, level: 0, positions });
  const tileBytes = 512 * 512 * info.channels;
  assert.equal(read.bytes.length, tileBytes * positions.length);
  read.tiles.forEach((tile, index) => assert.equal(digest(read.bytes.subarray(index * tileBytes, (index + 1) * tileBytes)), tile.sha256));
  assert.equal(read.frames.length, Math.ceil(read.bytes.length / MAX_CHUNK));
  await assert.rejects(client.request('tile.read', { pyramid: built.pyramid, level: 0, positions: [[999, 0]] }), { code: 'INVALID_REQUEST', field: 'positions' });
  const again = await client.request('pyramid.build', { path: source, name: 'idealized_core_0-500cm.jpg' });
  assert.equal(again.reused, true);
  assert.equal(client.status().state, 'ready');
});

test('without a pyramid folder the engine refuses the tile-store operations, and the page bridge never forwards them', { skip: !python }, async (t) => {
  const client = await clientFixture(t);
  await assert.rejects(client.request('pyramid.info', { pyramid: '0'.repeat(64) }), { code: 'UNSUPPORTED_METHOD' });
  const { createEngineIpc } = require('../../desktop/engine-ipc.js');
  const ipc = createEngineIpc({ engine: { request: async () => ({}), session: () => null, status: () => ({}) } });
  for (const op of ['pyramid.build', 'pyramid.info', 'tile.read']) assert.ok(!ipc.OPERATIONS.includes(op), op);
});

test('mask tiles through the real client and the page bridge: a version written, read back, and refused requests (card M8.4.16 step 4)', { skip: !python, timeout: 60000 }, async (t) => {
  const projectsDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'sedcoretool-projects-test-'));
  t.after(() => fs.rm(projectsDirectory, { recursive: true, force: true }));
  const client = await clientFixture(t, { projectsDirectory });
  const { createTileIpc } = require('../../desktop/tile-ipc.js');
  const bridge = createTileIpc({ engine: { request: (op, payload, binary, options) => client.request(op, payload, binary, options) } });
  const page = 7, other = 8;
  const begun = await bridge.call(page, 'maskBegin', 'p1', 's1', 1300, 1100, null);
  assert.deepEqual([begun.ok.rows, begun.ok.cols], [3, 3]);
  const labels = new Int32Array(512 * 512); labels[5] = 42;
  const labelBytes = new Uint8Array(labels.buffer), excludeBytes = new Uint8Array(512 * 512); excludeBytes[6] = 1;
  assert.deepEqual(await bridge.call(page, 'maskPut', begun.ok.staged, 'labels', 1, 2, digest(labelBytes), labelBytes), { ok: { stored: true } });
  assert.deepEqual(await bridge.call(page, 'maskPut', begun.ok.staged, 'exclude', 1, 2, digest(excludeBytes), excludeBytes), { ok: { stored: true } });
  assert.equal((await bridge.call(other, 'maskPut', begun.ok.staged, 'labels', 1, 2, digest(labelBytes), labelBytes)).error.field, 'staged', 'another page cannot use it');
  // Card M8.4.22: the objects as four binary columns; an index the classes table does not hold is refused by the engine.
  const columns = (cls) => ({ object_ids: new Uint8Array(new Uint32Array([42]).buffer), object_class: new Uint8Array(new Int32Array([cls]).buffer),
    object_predicted: new Uint8Array(new Int32Array([-1]).buffer), object_confidence: new Uint8Array(new Float64Array([0]).buffer) });
  const classes = new TextEncoder().encode('[{"id":"a","name":"Burrow","counts":true}]'), offsets = new Uint8Array(new Uint32Array([0, 0]).buffer);
  const unknownClass = await bridge.call(page, 'maskCommit', begun.ok.staged, { ...columns(1), classes, stack_offsets: offsets, stack_members: null });
  assert.deepEqual(unknownClass.error, { code: 'INVALID_BUFFER', field: 'tables.object_class' });
  const retry = await bridge.call(page, 'maskBegin', 'p1', 's1', 1300, 1100, null);              // a failed commit closes the staged version
  assert.deepEqual(await bridge.call(page, 'maskPut', retry.ok.staged, 'labels', 1, 2, digest(labelBytes), labelBytes), { ok: { stored: true } });
  assert.deepEqual(await bridge.call(page, 'maskPut', retry.ok.staged, 'exclude', 1, 2, digest(excludeBytes), excludeBytes), { ok: { stored: true } });
  const committed = await bridge.call(page, 'maskCommit', retry.ok.staged, { ...columns(0), classes, stack_offsets: offsets, stack_members: null });
  assert.match(committed.ok.manifest, /^[0-9a-f]{64}$/);
  const read = await bridge.call(page, 'maskRead', 'p1', committed.ok.manifest, 'labels', [[1, 2], [0, 0]]);
  assert.deepEqual(read.ok.tiles, [{ row: 1, col: 2, byte_length: 1048576 }, { row: 0, col: 0, byte_length: 0 }]);
  assert.equal(Buffer.compare(Buffer.from(read.ok.bytes), Buffer.from(labelBytes)), 0);
  const empty = await bridge.call(page, 'maskRead', 'p1', committed.ok.manifest, 'exclude', [[0, 0]]);
  assert.deepEqual(empty.ok.tiles, [{ row: 0, col: 0, byte_length: 0 }]); assert.equal(empty.ok.bytes.length, 0);
  // Refused before reaching the engine, or by it; the session stays usable.
  for (const [args, field] of [[['maskBegin', 'P1', 's1', 10, 10, null], 'project'], [['maskBegin', 'con', 's1', 10, 10, null], 'project'],
    [['maskBegin', 'p1', 's/1', 10, 10, null], 'section'], [['maskPut', begun.ok.staged, 'labels', 0, 0, digest(labelBytes), labelBytes], 'staged'],
    [['maskRead', 'p1', 'f'.repeat(64), 'labels', [[0, 0]]], 'manifest'], [['maskCommit', 'x', {}], 'staged']]) {
    const answer = await bridge.call(page, ...args);
    assert.equal(answer.error?.field, field, JSON.stringify(args.slice(0, 2)));
  }
  const again = await bridge.call(page, 'maskBegin', 'p1', 's1', 1300, 1100, committed.ok.manifest);
  assert.deepEqual(await bridge.call(page, 'maskPut', again.ok.staged, 'labels', 1, 2, digest(labelBytes), labelBytes.subarray(1)), { error: { code: 'INVALID_REQUEST', field: 'bytes' } });
  assert.deepEqual(await bridge.call(page, 'maskDiscard', again.ok.staged), { ok: {} });
  assert.equal(client.status().state, 'ready');
});
