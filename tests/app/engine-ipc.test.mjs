import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createEngineIpc, ANALYSES, MAX_TOKENS_PER_PAGE } = require('../../desktop/engine-ipc.js');
const { createEngineService } = require('../../desktop/engine.js');
const root = fileURLToPath(new URL('../../', import.meta.url));
const FIXTURES = path.join(root, 'tests', 'fixtures', 'section-intervals');
const sha = (data) => createHash('sha256').update(data).digest('hex');
const uuid = () => randomUUID();
const MiB = 1048576;

/** An engine that records every request and answers from a script; enough to test validation and ownership. */
function fakeEngine({ answers = {}, session = 'session-1' } = {}) {
  const engine = {
    session, calls: [], pending: [],
    request(op, payload, binary = null) {
      engine.calls.push({ op, payload, binary });
      let settle;
      const promise = new Promise((resolve, reject) => { settle = { resolve, reject }; });
      promise.requestId = uuid();
      const answer = answers[op];
      if (answer === 'hold') engine.pending.push({ op, payload, requestId: promise.requestId, ...settle });
      else if (answer instanceof Error) settle.reject(answer);
      else settle.resolve(typeof answer === 'function' ? answer(payload) : answer ?? {});
      return promise;
    },
  };
  return { request: engine.request, session: () => engine.session, calls: engine.calls, pending: engine.pending, setSession: (value) => { engine.session = value; } };
}
const fakeAnswers = () => ({
  'buffer.begin': () => ({ handle: uuid() }),
  'buffer.chunk': (payload) => ({ next_offset: payload.offset + payload.byte_length }),
  'buffer.commit': (payload) => ({ handle: payload.handle, byte_length: 4, sha256: '1'.repeat(64) }),
  'buffer.release': (payload) => ({ released: payload.handles }),
});
const descriptor = (change = {}) => ({ dtype: 'u8', shape: [4], byte_length: 4, sha256: sha(Buffer.from([1, 2, 3, 4])), ...change });

async function committed(ipc, owner, bytes = Buffer.from([1, 2, 3, 4]), dtype = 'u8') {
  const { token, error } = await ipc.call(owner, 'beginBuffer', descriptor({ dtype, byte_length: bytes.length, shape: [bytes.length], sha256: sha(bytes) }));
  assert.equal(error, undefined, JSON.stringify(error));
  assert.equal((await ipc.call(owner, 'appendBuffer', token, 0, bytes)).error, undefined);
  assert.equal((await ipc.call(owner, 'commitBuffer', token)).error, undefined);
  return token;
}
const analysisInputs = async (ipc, owner) => Object.fromEntries(await Promise.all(
  [...ANALYSES['section.intervals/1'].required].map(async (name) => [name, await committed(ipc, owner)])));
const analysisRequest = (inputs, change = {}) => ({ requestKey: uuid(), method: 'section.intervals/1', project: uuid(), section: uuid(), revision: 3, settings_hash: '2'.repeat(64), inputs, ...change });

test('the bridge offers exactly the documented operations and never an engine operation by name', async () => {
  const ipc = createEngineIpc({ engine: fakeEngine({ answers: fakeAnswers() }) });
  assert.deepEqual([...ipc.OPERATIONS].sort(), ['analyzeSection', 'appendBuffer', 'beginBuffer', 'cancel', 'commitBuffer', 'deriveBuffer', 'readBuffer', 'release']);
  for (const name of ['request', 'buffer.begin', 'shutdown', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 7, null, undefined]) {
    assert.deepEqual(await ipc.call(1, name), { error: { code: 'UNSUPPORTED_METHOD' } }, String(name));
  }
});

test('beginBuffer validates the descriptor before the engine sees it', async () => {
  const engine = fakeEngine({ answers: fakeAnswers() }), ipc = createEngineIpc({ engine });
  const bad = [
    [null, 'INVALID_REQUEST'], ['x', 'INVALID_REQUEST'], [[], 'INVALID_REQUEST'], [{}, 'INVALID_REQUEST'],
    [descriptor({ extra: 1 }), 'INVALID_REQUEST'], [descriptor({ dtype: 'f32le' }), 'INVALID_REQUEST'], [descriptor({ dtype: '__proto__' }), 'INVALID_REQUEST'],
    [descriptor({ shape: [] }), 'INVALID_REQUEST'], [descriptor({ shape: [1, 1, 1, 1] }), 'INVALID_REQUEST'], [descriptor({ shape: [0] }), 'INVALID_REQUEST'],
    [descriptor({ shape: [1.5] }), 'INVALID_REQUEST'], [descriptor({ shape: [-1] }), 'INVALID_REQUEST'], [descriptor({ shape: 'a' }), 'INVALID_REQUEST'],
    [descriptor({ byte_length: 0 }), 'LIMIT_EXCEEDED'], [descriptor({ byte_length: 1.5 }), 'LIMIT_EXCEEDED'], [descriptor({ byte_length: '4' }), 'LIMIT_EXCEEDED'],
    [descriptor({ byte_length: 256 * MiB + 1 }), 'LIMIT_EXCEEDED'], [descriptor({ byte_length: Number.MAX_SAFE_INTEGER + 2 }), 'LIMIT_EXCEEDED'],
    [descriptor({ sha256: 'A'.repeat(64) }), 'INVALID_REQUEST'], [descriptor({ sha256: 'a'.repeat(63) }), 'INVALID_REQUEST'], [descriptor({ sha256: 5 }), 'INVALID_REQUEST'],
  ];
  for (const [value, code] of bad) assert.equal((await ipc.call(1, 'beginBuffer', value)).error?.code, code, JSON.stringify(value));
  assert.equal(engine.calls.length, 0, 'nothing reached the engine');
  assert.equal(ipc.size(), 0);
  const ok = await ipc.call(1, 'beginBuffer', descriptor({ byte_length: 256 * MiB, shape: [256 * MiB] }));
  assert.match(ok.token, /^[0-9a-f-]{36}$/);
  assert.deepEqual(Object.keys(ok), ['token'], 'the page learns a token, never the engine handle');
});

test('a page can hold only a bounded number of buffers', async () => {
  const engine = fakeEngine({ answers: fakeAnswers() }), ipc = createEngineIpc({ engine });
  for (let i = 0; i < MAX_TOKENS_PER_PAGE; i++) assert.ok((await ipc.call(1, 'beginBuffer', descriptor())).token);
  assert.equal((await ipc.call(1, 'beginBuffer', descriptor())).error.code, 'LIMIT_EXCEEDED');
  assert.ok((await ipc.call(2, 'beginBuffer', descriptor())).token, 'another page is not affected');
});

test('appendBuffer accepts only contiguous, bounded bytes and commit needs the whole buffer', async () => {
  const engine = fakeEngine({ answers: fakeAnswers() }), ipc = createEngineIpc({ engine });
  const big = Buffer.alloc(2 * MiB + 10, 7), { token } = await ipc.call(1, 'beginBuffer', descriptor({ byte_length: big.length, shape: [big.length], sha256: sha(big) }));
  const append = (offset, data) => ipc.call(1, 'appendBuffer', token, offset, data);
  for (const [offset, data, field] of [[0, Buffer.alloc(0), 'bytes'], [0, Buffer.alloc(MiB + 1), 'bytes'], [0, 'text', 'bytes'], [0, [1, 2], 'bytes'], [0, null, 'bytes'],
    [5, big.subarray(0, 10), 'offset'], [-1, big.subarray(0, 10), 'offset'], [1.5, big.subarray(0, 10), 'offset'], ['0', big.subarray(0, 10), 'offset']]) {
    assert.deepEqual(await append(offset, data), { error: { code: 'INVALID_REQUEST', field } }, `${offset}`);
  }
  assert.equal(engine.calls.filter((call) => call.op === 'buffer.chunk').length, 0);
  assert.equal((await ipc.call(1, 'commitBuffer', token)).error.code, 'INVALID_BUFFER', 'commit before any byte');
  assert.deepEqual(await append(0, new Uint8Array(big.subarray(0, MiB))), { next_offset: MiB }, 'a Uint8Array works like a Buffer');
  assert.equal((await append(0, big.subarray(0, 10))).error.field, 'offset', 'a repeated offset');
  assert.deepEqual(await append(MiB, big.subarray(MiB, 2 * MiB)), { next_offset: 2 * MiB });
  assert.equal((await append(2 * MiB, Buffer.alloc(11))).error.field, 'offset', 'past the declared length');
  assert.equal((await ipc.call(1, 'commitBuffer', token)).error.code, 'INVALID_BUFFER', 'ten bytes are missing');
  assert.deepEqual(await append(2 * MiB, big.subarray(2 * MiB)), { next_offset: big.length });
  assert.deepEqual(await ipc.call(1, 'commitBuffer', token), { token, byte_length: 4, sha256: '1'.repeat(64) });
  assert.equal((await append(big.length, Buffer.alloc(1))).error.code, 'INVALID_BUFFER', 'a committed buffer is immutable');
  assert.equal((await ipc.call(1, 'commitBuffer', token)).error.code, 'INVALID_BUFFER', 'committed twice');
  const sent = engine.calls.filter((call) => call.op === 'buffer.chunk');
  assert.deepEqual(sent.map((call) => [call.payload.offset, call.payload.byte_length, call.binary.length]), [[0, MiB, MiB], [MiB, MiB, MiB], [2 * MiB, 10, 10]]);
});

test('two concurrent appends cannot take the same offset', async () => {
  const engine = fakeEngine({ answers: { ...fakeAnswers(), 'buffer.chunk': 'hold' } }), ipc = createEngineIpc({ engine });
  const { token } = await ipc.call(1, 'beginBuffer', descriptor({ byte_length: 8, shape: [8] }));
  const first = ipc.call(1, 'appendBuffer', token, 0, Buffer.alloc(4)), second = ipc.call(1, 'appendBuffer', token, 0, Buffer.alloc(4));
  assert.equal((await second).error.field, 'offset');
  engine.pending[0].resolve({ next_offset: 4 });
  assert.deepEqual(await first, { next_offset: 4 });
});

test('a rejected chunk makes the token unusable', async () => {
  const failing = Object.assign(new Error('INVALID_BUFFER'), { code: 'INVALID_BUFFER' });
  const engine = fakeEngine({ answers: { ...fakeAnswers(), 'buffer.chunk': failing } }), ipc = createEngineIpc({ engine });
  const { token } = await ipc.call(1, 'beginBuffer', descriptor());
  assert.equal((await ipc.call(1, 'appendBuffer', token, 0, Buffer.alloc(4))).error.code, 'INVALID_BUFFER');
  assert.equal((await ipc.call(1, 'appendBuffer', token, 0, Buffer.alloc(4))).error.field, 'token');
});

test('tokens belong to the page that created them', async () => {
  const engine = fakeEngine({ answers: fakeAnswers() }), ipc = createEngineIpc({ engine });
  const mine = await committed(ipc, 1), staging = (await ipc.call(1, 'beginBuffer', descriptor())).token;
  const before = engine.calls.length;
  const attempts = [['appendBuffer', staging, 0, Buffer.alloc(4)], ['commitBuffer', staging], ['readBuffer', mine, 0, 1],
    ['analyzeSection', analysisRequest(Object.fromEntries(ANALYSES['section.intervals/1'].required.map((name) => [name, mine])))]];
  for (const [name, ...args] of attempts) assert.equal((await ipc.call(2, name, ...args)).error?.code, 'INVALID_BUFFER', name);
  assert.equal((await ipc.call(2, 'cancel', uuid())).state, 'already_terminal');
  assert.deepEqual(await ipc.call(2, 'release', [mine, staging]), { released: 0 }, 'releasing the tokens of another page does nothing');
  assert.equal(engine.calls.length, before, 'another page reached the engine with nothing');
  assert.equal(ipc.size(), 2, 'and released nothing');
  for (const guess of ['', 'x', '__proto__', '00000000-0000-4000-8000-000000000000', 5, null, {}]) {
    assert.equal((await ipc.call(1, 'readBuffer', guess, 0, 1)).error?.code, 'INVALID_BUFFER', String(guess));
  }
});

test('readBuffer checks the range against the committed buffer and returns bytes and offset only', async () => {
  const data = Buffer.from([9, 8, 7, 6]);
  const engine = fakeEngine({ answers: { ...fakeAnswers(), 'buffer.read': (payload) => ({ offset: payload.offset, byte_length: payload.byte_length, bytes: data.subarray(payload.offset, payload.offset + payload.byte_length) }) } });
  const ipc = createEngineIpc({ engine }), token = await committed(ipc, 1, data), staging = (await ipc.call(1, 'beginBuffer', descriptor())).token;
  assert.deepEqual(await ipc.call(1, 'readBuffer', token, 1, 2), { offset: 1, bytes: data.subarray(1, 3) });
  for (const [offset, length] of [[0, 0], [0, 5], [4, 1], [3, 2], [-1, 1], [0, MiB + 1], [0.5, 1], [0, '1'], [Number.NaN, 1]]) {
    assert.equal((await ipc.call(1, 'readBuffer', token, offset, length)).error?.code, 'INVALID_REQUEST', `${offset}+${length}`);
  }
  assert.equal((await ipc.call(1, 'readBuffer', staging, 0, 1)).error.code, 'INVALID_BUFFER', 'a buffer still being uploaded');
});

test('analyzeSection rejects each malformed request before the engine and names the field', async () => {
  const engine = fakeEngine({ answers: fakeAnswers() }), ipc = createEngineIpc({ engine });
  const inputs = await analysisInputs(ipc, 1), staging = (await ipc.call(1, 'beginBuffer', descriptor())).token, calls = engine.calls.length;
  const without = (name) => Object.fromEntries(Object.entries(inputs).filter(([key]) => key !== name));
  const cases = [
    [null, 'request'], [[], 'request'], ['x', 'request'], [analysisRequest(inputs, { surprise: 1 }), 'request'],
    [analysisRequest(inputs, { requestKey: 'abc' }), 'requestKey'], [analysisRequest(inputs, { requestKey: undefined }), 'requestKey'],
    [analysisRequest(inputs, { method: 'section.intervals/2' }), 'method'], [analysisRequest(inputs, { method: '__proto__' }), 'method'], [analysisRequest(inputs, { method: 'buffer.digest/1' }), 'method'],
    [analysisRequest(inputs, { project: 'p' }), 'project'], [analysisRequest(inputs, { section: 'S'.repeat(36) }), 'section'],
    [analysisRequest(inputs, { revision: -1 }), 'revision'], [analysisRequest(inputs, { revision: 1.5 }), 'revision'], [analysisRequest(inputs, { revision: '1' }), 'revision'],
    [analysisRequest(inputs, { settings_hash: 'F'.repeat(64) }), 'settings_hash'], [analysisRequest(inputs, { inputs: [] }), 'inputs'], [analysisRequest(inputs, { inputs: null }), 'inputs'],
    [analysisRequest({ ...inputs, extra: inputs.labels }), 'inputs.extra'], [analysisRequest({ ...inputs, path: '/etc/passwd' }), 'inputs.path'],
    ...Object.keys(inputs).map((name) => [analysisRequest(without(name)), `inputs.${name}`]),
    [analysisRequest({ ...inputs, labels: staging }), 'token'], [analysisRequest({ ...inputs, labels: 'nope' }), 'token'], [analysisRequest({ ...inputs, exclude: undefined }), 'token'],
  ];
  for (const [request, field] of cases) {
    const { error } = await ipc.call(1, 'analyzeSection', request);
    assert.ok(error, JSON.stringify(request)?.slice(0, 80));
    assert.equal(error.field, field, JSON.stringify(request)?.slice(0, 80));
  }
  assert.equal(engine.calls.length, calls, 'the engine never saw a malformed request');
});

const PACKED = { handle: '', dtype: 'u8', shape: [24], byte_length: 24, sha256: 'a'.repeat(64) };
const LAYOUT = { row_start: { dtype: 'u32le', shape: [2], offset: 0, byte_length: 8 }, no_data: { dtype: 'u8', shape: [2], offset: 8, byte_length: 2 } };

test('analyzeSection sends handles, returns a token for the packed result and its layout, and hides every handle', async () => {
  const outputs = { result: { ...PACKED, handle: uuid() } };
  const engine = fakeEngine({ answers: { ...fakeAnswers(), 'section.analyze': (payload) => ({ project: payload.project, section: payload.section, revision: payload.revision,
    settings_hash: payload.settings_hash, method: payload.method, dimensions: { bins: 2, classes: 1, schemes: 2 }, outputs, layout: LAYOUT, provenance: { engine_version: 'test' } }) } });
  const ipc = createEngineIpc({ engine }), inputs = await analysisInputs(ipc, 1);
  const request = analysisRequest(inputs), result = await ipc.call(1, 'analyzeSection', request);
  const sent = engine.calls.find((call) => call.op === 'section.analyze').payload;
  assert.deepEqual(Object.keys(sent).sort(), ['inputs', 'method', 'project', 'revision', 'section', 'settings_hash']);
  assert.deepEqual(Object.keys(sent.inputs).sort(), Object.keys(inputs).sort());
  assert.ok(Object.values(sent.inputs).every((handle) => !Object.values(inputs).includes(handle)), 'tokens were replaced by engine handles');
  assert.deepEqual([result.project, result.section, result.revision, result.settings_hash, result.method], [request.project, request.section, 3, request.settings_hash, request.method]);
  assert.deepEqual(Object.keys(result.outputs), ['result']);
  assert.deepEqual(result.layout, LAYOUT, 'the page gets the layout of the packed buffer');
  assert.ok(Object.values(result.outputs).every((item) => /^[0-9a-f-]{36}$/.test(item.token) && !('handle' in item)));
  const text = JSON.stringify(result);
  for (const output of Object.values(outputs)) assert.ok(!text.includes(output.handle), 'an engine handle reached the page');
  for (const handle of Object.values(sent.inputs)) assert.ok(!text.includes(handle));
  // The result columns are readable and releasable by this page only.
  assert.equal((await ipc.call(2, 'readBuffer', result.outputs.result.token, 0, 1)).error.code, 'INVALID_BUFFER');
  assert.equal((await ipc.call(1, 'release', [result.outputs.result.token])).released, 1);
  assert.equal(engine.calls.at(-1).payload.handles[0], outputs.result.handle);
  assert.equal((await ipc.call(1, 'readBuffer', result.outputs.result.token, 0, 1)).error.code, 'INVALID_BUFFER', 'released');
});

test('a layout the page must not see is refused as an internal error and the result is handed back to the engine', async () => {
  const good = LAYOUT.row_start;
  const bad = { 'no layout': undefined, 'not an object': 5, 'empty': {}, 'a bad column name': { '../x': good }, 'an unknown dtype': { a: { ...good, dtype: 'f32le' } },
    'a negative offset': { a: { ...good, offset: -8 } }, 'a zero length': { a: { ...good, byte_length: 0 } }, 'a fractional offset': { a: { ...good, offset: 1.5 } },
    'a rank of four': { a: { ...good, shape: [1, 1, 1, 1] } }, 'a zero in the shape': { a: { ...good, shape: [0] } }, 'a column given as text': { a: 'u8' },
    'too many columns': Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`c${i}`, good])) };
  for (const [label, layout] of Object.entries(bad)) {
    const handle = uuid();
    const engine = fakeEngine({ answers: { ...fakeAnswers(), 'section.analyze': (payload) => ({ project: payload.project, section: payload.section, revision: payload.revision,
      settings_hash: payload.settings_hash, method: payload.method, dimensions: { bins: 2, classes: 1, schemes: 2 }, outputs: { result: { ...PACKED, handle } }, layout, provenance: {} }) } });
    const ipc = createEngineIpc({ engine }), inputs = await analysisInputs(ipc, 1), before = ipc.size();
    const result = await ipc.call(1, 'analyzeSection', analysisRequest(inputs));
    assert.equal(result.error?.code, 'INTERNAL', label);
    assert.equal(ipc.size(), before, `${label}: no token for the refused result`);
    assert.ok(engine.calls.some((call) => call.op === 'buffer.release' && call.payload.handles.includes(handle)), `${label}: the refused result was released`);
  }
});

test('only the known fields of a layout reach the page', async () => {
  const handle = uuid();
  const engine = fakeEngine({ answers: { ...fakeAnswers(), 'section.analyze': (payload) => ({ project: payload.project, section: payload.section, revision: payload.revision,
    settings_hash: payload.settings_hash, method: payload.method, dimensions: { bins: 2, classes: 1, schemes: 2 }, outputs: { result: { ...PACKED, handle } },
    layout: { row_start: { ...LAYOUT.row_start, path: 'C:/secret', handle } }, provenance: {} }) } });
  const ipc = createEngineIpc({ engine }), result = await ipc.call(1, 'analyzeSection', analysisRequest(await analysisInputs(ipc, 1)));
  assert.deepEqual(result.layout, { row_start: LAYOUT.row_start });
  assert.ok(!JSON.stringify(result).includes(handle) && !JSON.stringify(result).includes('secret'));
});

test('the same request key cannot run twice and a page runs a bounded number of analyses at once', async () => {
  const engine = fakeEngine({ answers: { ...fakeAnswers(), 'section.analyze': 'hold' } }), ipc = createEngineIpc({ engine });
  const inputs = await analysisInputs(ipc, 1), requests = Array.from({ length: 5 }, () => analysisRequest(inputs));
  const running = requests.map((request) => ipc.call(1, 'analyzeSection', request));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await ipc.call(1, 'analyzeSection', requests[0])).error.field, 'requestKey', 'duplicate key');
  assert.equal((await ipc.call(1, 'analyzeSection', analysisRequest(inputs))).error.code, 'BUSY', 'sixth analysis');
  const otherInputs = await analysisInputs(ipc, 2);
  const other = ipc.call(2, 'analyzeSection', analysisRequest(otherInputs));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(engine.pending.length, 6, 'another page is not blocked');
  for (const job of engine.pending) job.resolve({ cancelled: true });
  assert.ok((await Promise.all([...running, other])).every((value) => value.cancelled));
  const again = ipc.call(1, 'analyzeSection', requests[0]);   // the key is free once its analysis ended
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(engine.pending.length, 7);
  engine.pending.at(-1).resolve({ cancelled: true });
  assert.deepEqual(await again, { cancelled: true });
});

test('cancel targets the engine request of this page only', async () => {
  const engine = fakeEngine({ answers: { ...fakeAnswers(), 'section.analyze': 'hold', 'job.cancel': { state: 'requested' } } }), ipc = createEngineIpc({ engine });
  const inputs = await analysisInputs(ipc, 1), request = analysisRequest(inputs), running = ipc.call(1, 'analyzeSection', request);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await ipc.call(2, 'cancel', request.requestKey)).state, 'already_terminal', 'another page cannot cancel it');
  assert.equal(engine.calls.some((call) => call.op === 'job.cancel'), false);
  assert.deepEqual(await ipc.call(1, 'cancel', request.requestKey), { state: 'requested' });
  assert.equal(engine.calls.find((call) => call.op === 'job.cancel').payload.request_id, engine.pending[0].requestId);
  engine.pending[0].resolve({ cancelled: true });
  assert.deepEqual(await running, { cancelled: true });
  assert.equal((await ipc.call(1, 'cancel', request.requestKey)).state, 'already_terminal');
  assert.equal((await ipc.call(1, 'cancel', 'not a uuid')).error.field, 'requestKey');
});

test('engine failures reach the page as a stable code and field, never as a message or stack', async () => {
  const rejected = Object.assign(new Error('secret path C:\\Users\\someone\\scratch'), { code: 'UNSUPPORTED_INPUT', field: 'settings.roi' });
  const crashed = new Error('boom at C:\\private\\file.py');
  const weird = Object.assign(new Error('x'), { code: 'lowercase <script>' });
  for (const [failure, expected] of [[rejected, { error: { code: 'UNSUPPORTED_INPUT', field: 'settings.roi' } }], [crashed, { error: { code: 'INTERNAL' } }], [weird, { error: { code: 'INTERNAL' } }]]) {
    const ipc = createEngineIpc({ engine: fakeEngine({ answers: { ...fakeAnswers(), 'section.analyze': failure } }) });
    const result = await ipc.call(1, 'analyzeSection', analysisRequest(await analysisInputs(ipc, 1)));
    assert.deepEqual(result, expected);
    assert.ok(!JSON.stringify(result).includes('secret') && !JSON.stringify(result).includes('private'));
  }
  const unavailable = createEngineIpc({ engine: fakeEngine({ answers: { 'buffer.begin': Object.assign(new Error('ENGINE_UNAVAILABLE'), { code: 'ENGINE_UNAVAILABLE' }) } }) });
  assert.deepEqual(await unavailable.call(1, 'beginBuffer', descriptor()), { error: { code: 'ENGINE_UNAVAILABLE' } });
});

test('tokens do not survive an engine restart', async () => {
  const engine = fakeEngine({ answers: fakeAnswers() }), ipc = createEngineIpc({ engine });
  const token = await committed(ipc, 1);
  engine.setSession('session-2');
  const calls = engine.calls.length;
  assert.equal((await ipc.call(1, 'readBuffer', token, 0, 1)).error.code, 'INVALID_BUFFER');
  assert.equal((await ipc.call(1, 'release', [token])).released, 0);
  assert.equal(engine.calls.length, calls, 'a handle of a dead session is never sent to the new one');
  assert.equal(ipc.size(), 0);
});

test('release is bounded, idempotent and ignores tokens it does not know', async () => {
  const engine = fakeEngine({ answers: fakeAnswers() }), ipc = createEngineIpc({ engine });
  const first = await committed(ipc, 1), second = await committed(ipc, 1);
  for (const value of ['x', null, {}, Array(65).fill('a'), [1], [first, 7]]) assert.equal((await ipc.call(1, 'release', value)).error?.code, 'INVALID_REQUEST', JSON.stringify(value)?.slice(0, 30));
  assert.equal(ipc.size(), 2, 'a rejected list releases nothing');
  assert.deepEqual(await ipc.call(1, 'release', [first, first, 'unknown', second]), { released: 2 });
  assert.deepEqual(await ipc.call(1, 'release', [first, second]), { released: 0 });
  assert.equal(engine.calls.filter((call) => call.op === 'buffer.release').length, 1);
});

test('closing or reloading a page cancels its analyses and releases all of its buffers in bounded batches', async () => {
  const engine = fakeEngine({ answers: { ...fakeAnswers(), 'section.analyze': 'hold' } }), ipc = createEngineIpc({ engine });
  const kept = await committed(ipc, 2), inputs = await analysisInputs(ipc, 1);
  for (let i = 0; i < 150; i++) await committed(ipc, 1);
  const running = ipc.call(1, 'analyzeSection', analysisRequest(inputs));
  await new Promise((resolve) => setImmediate(resolve));
  ipc.releasePage(1);
  const released = engine.calls.filter((call) => call.op === 'buffer.release').map((call) => call.payload.handles.length);
  assert.ok(released.every((n) => n >= 1 && n <= 64), `batches ${released}`);
  assert.equal(released.reduce((a, b) => a + b, 0), 150 + Object.keys(inputs).length);
  assert.equal(engine.calls.filter((call) => call.op === 'job.cancel').length, 1);
  assert.equal(ipc.size(), 1, 'the other page keeps its buffer');
  assert.equal((await ipc.call(2, 'readBuffer', kept, 0, 1)).error, undefined, 'the other page still reads its buffer');
  // A result that arrives after the page is gone is released at once and never handed out.
  const handle = uuid();
  engine.pending[0].resolve({ project: 'p', section: 's', revision: 3, settings_hash: 'h', method: 'm', dimensions: {}, outputs: { x: { handle, dtype: 'u8', shape: [1], byte_length: 1, sha256: 'c'.repeat(64) } }, provenance: {} });
  assert.deepEqual(await running, { cancelled: true });
  assert.deepEqual(engine.calls.at(-1), { op: 'buffer.release', payload: { handles: [handle] }, binary: null });
  assert.equal(ipc.size(), 1);
});

test('the input names the bridge allows agree with the engine specification', () => {
  const specification = readFileSync(path.join(root, 'src', 'sedcoretool', 'engine', 'specs.py'), 'utf8');
  const table = specification.slice(specification.indexOf('METHOD_INPUTS = {'), specification.indexOf('SETTINGS_INPUT'));
  const entries = [...table.matchAll(/'([a-z_]+)': \('([a-z0-9]+)', (\d), (True|False)\)/g)].map((match) => ({ name: match[1], required: match[4] === 'True' }));
  assert.ok(entries.length >= 9);
  const spec = ANALYSES['section.intervals/1'];
  assert.deepEqual(entries.filter((entry) => entry.required).map((entry) => entry.name).sort(), [...spec.required].sort());
  assert.deepEqual(entries.filter((entry) => !entry.required).map((entry) => entry.name).sort(), [...spec.optional].sort());
});

// ---- the real engine -------------------------------------------------------------------------------------------------

const pythonCheck = spawnSync(process.platform === 'win32' ? 'py' : 'python3',
  [...(process.platform === 'win32' ? ['-3.12'] : []), '-c', 'import sys, numpy; print(sys.executable)'], { encoding: 'utf8', windowsHide: true });
const python = process.env.SEDCORETOOL_TEST_PYTHON || (pythonCheck.status === 0 ? pythonCheck.stdout.trim() : null);
const DTYPE_BYTES = { u8: [Uint8Array, 1], i32le: [Int32Array, 4], u32le: [Uint32Array, 4], u64le: [BigUint64Array, 8], f64le: [Float64Array, 8] };
const expand = (buffer) => (buffer.runs ? buffer.runs.flatMap(([value, count]) => Array(count).fill(value)) : buffer.data);
const numeric = (buffer) => { const [Type] = DTYPE_BYTES[buffer.dtype]; return Buffer.from(Type.from(expand(buffer), (v) => (Type === BigUint64Array ? BigInt(v) : v)).buffer); };

/** Uploads a fixture through the bridge in chunks of `chunk` bytes; returns the tokens and the settings hash. */
async function uploadFixture(ipc, owner, fixture, chunk = 300) {
  const put = async (bytes, dtype, shape) => {
    const { token, error } = await ipc.call(owner, 'beginBuffer', { dtype, shape, byte_length: bytes.length, sha256: sha(bytes) });
    assert.equal(error, undefined, JSON.stringify(error));
    for (let offset = 0; offset < bytes.length; offset += chunk) {
      const reply = await ipc.call(owner, 'appendBuffer', token, offset, bytes.subarray(offset, offset + chunk));
      assert.equal(reply.error, undefined, JSON.stringify(reply.error));
    }
    assert.equal((await ipc.call(owner, 'commitBuffer', token)).error, undefined);
    return token;
  };
  const raw = fixture.inputs, tokens = {};
  for (const name of ['labels', 'exclude', 'stack_offsets']) tokens[name] = await put(numeric(raw[name]), raw[name].dtype, raw[name].shape);
  if (raw.stack_members) tokens.stack_members = await put(numeric(raw.stack_members), 'u32le', raw.stack_members.shape);
  let settingsHash;
  for (const name of ['objects', 'classes', 'settings', 'age_model', 'manual_indices']) {
    const bytes = Buffer.from(JSON.stringify(raw[name]));
    tokens[name] = await put(bytes, 'utf8json', [bytes.length]);
    if (name === 'settings') settingsHash = sha(bytes);
  }
  return { tokens, settingsHash };
}

async function download(ipc, owner, output) {
  const parts = [];
  for (let offset = 0; offset < output.byte_length; offset += 1000) {
    const read = await ipc.call(owner, 'readBuffer', output.token, offset, Math.min(1000, output.byte_length - offset));
    assert.equal(read.error, undefined, JSON.stringify(read.error));
    parts.push(Buffer.from(read.bytes));
  }
  const bytes = Buffer.concat(parts);
  assert.equal(sha(bytes), output.sha256, 'downloaded bytes match the engine hash');
  const [Type] = DTYPE_BYTES[output.dtype], copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length);
  return Array.from(new Type(copy), (value) => Number(value));
}

/** The whole packed result buffer, read in ranges of 1,000 bytes. */
async function downloadPacked(ipc, owner, output) {
  const parts = [];
  for (let offset = 0; offset < output.byte_length; offset += 1000) {
    const read = await ipc.call(owner, 'readBuffer', output.token, offset, Math.min(1000, output.byte_length - offset));
    assert.equal(read.error, undefined, JSON.stringify(read.error));
    parts.push(Buffer.from(read.bytes));
  }
  const bytes = Buffer.concat(parts);
  assert.equal(sha(bytes), output.sha256, 'downloaded bytes match the engine hash');
  return bytes;
}

/** One column of the packed buffer as plain numbers (offsets are multiples of 8, so a typed array can view the copy). */
function unpack(packed, part) {
  assert.equal(part.offset % 8, 0);
  const [Type] = DTYPE_BYTES[part.dtype], copy = packed.buffer.slice(packed.byteOffset + part.offset, packed.byteOffset + part.offset + part.byte_length);
  return Array.from(new Type(copy), (value) => Number(value));
}

const EXACT = new Set(['row_start', 'row_end', 'valid_count', 'bio_count', 'class_count', 'no_data', 'manual_BI', 'manual_ii', 'indices']);

/** A request the engine rejects: the page must learn the code and the field, and the engine must stay usable. */
async function rejectedInputThrough(service) {
  const ipc = createEngineIpc({ engine: service }), owner = 42;
  const fixture = JSON.parse(readFileSync(path.join(FIXTURES, 'basic-four-intervals.json'), 'utf8'));
  fixture.inputs.settings.roi.x1 = fixture.inputs.settings.width + 1;
  const { tokens, settingsHash } = await uploadFixture(ipc, owner, fixture);
  const result = await ipc.call(owner, 'analyzeSection', { requestKey: uuid(), method: 'section.intervals/1', project: uuid(), section: uuid(), revision: 0, settings_hash: settingsHash, inputs: tokens });
  assert.deepEqual(result, { error: { code: 'INVALID_REQUEST', field: 'settings.roi' } });
  ipc.releasePage(owner);
}

async function runFixturesThrough(service, names) {
  const ipc = createEngineIpc({ engine: service }), owner = 41;
  for (const name of names) {
    const fixture = JSON.parse(readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8')), { tokens, settingsHash } = await uploadFixture(ipc, owner, fixture);
    const request = { requestKey: uuid(), method: 'section.intervals/1', project: uuid(), section: uuid(), revision: 11, settings_hash: settingsHash, inputs: tokens };
    const result = await ipc.call(owner, 'analyzeSection', request);
    assert.equal(result.error, undefined, `${name}: ${JSON.stringify(result.error)}`);
    assert.deepEqual([result.project, result.section, result.revision, result.settings_hash], [request.project, request.section, 11, settingsHash]);
    assert.deepEqual(result.dimensions, fixture.expected.dimensions, name);
    assert.deepEqual(Object.keys(result.outputs), ['result'], 'one buffer carries every column');
    assert.deepEqual(Object.keys(result.layout).filter((key) => !key.endsWith('_valid')).sort(), Object.keys(fixture.expected.columns).sort(), name);
    const packed = await downloadPacked(ipc, owner, result.outputs.result);
    for (const [column, expected] of Object.entries(fixture.expected.columns)) {
      const actual = unpack(packed, result.layout[column]), want = expected.data;
      assert.equal(actual.length, want.length, `${name}.${column}`);
      const valid = expected.valid ? unpack(packed, result.layout[`${column}_valid`]) : null;
      want.forEach((value, i) => {
        if (valid && !valid[i]) return;
        if (EXACT.has(column)) assert.equal(actual[i], value, `${name}.${column}[${i}]`);
        else assert.ok(Math.abs(actual[i] - value) <= 1e-9, `${name}.${column}[${i}]: ${actual[i]} vs ${value}`);
      });
    }
    ipc.releasePage(owner);
    assert.equal(ipc.size(), 0);
  }
}

const SAMPLE = ['basic-four-intervals', 'overlap-same-and-different-class', 'ages-with-range', 'manual-ranges', 'no-data-padding-2-cm-in-mm', 'fractional-07', 'no-valid-pixels', 'units-m'];

test('a development interpreter runs reference fixtures end to end through the bridge', { skip: !python, timeout: 120000 }, async (t) => {
  const service = createEngineService({ enabled: true, packaged: false, executable: python, sourceDirectory: root, version: 'test' });
  await service.start();
  t.after(() => service.stop());
  assert.equal(service.status().state, 'ready', 'the engine started');
  await runFixturesThrough(service, SAMPLE);
  await rejectedInputThrough(service);
  assert.equal(service.status().state, 'ready', 'a rejected input does not end the session');
});

const bundled = path.join(root, 'desktop', 'runtime', `${process.platform}-${process.arch}`, 'manifest.json');
test('the bundled runtime runs reference fixtures end to end through the bridge', { skip: !existsSync(bundled) || !existsSync(path.join(root, 'desktop', 'python', 'src')), timeout: 180000 }, async (t) => {
  const version = JSON.parse(readFileSync(path.join(root, 'desktop', 'package.json'), 'utf8')).version;
  const service = createEngineService({ enabled: true, packaged: true, version, sourceDirectory: path.join(root, 'desktop', 'python'),
    runtimeDirectory: path.join(root, 'desktop', 'runtime'), lockPath: path.join(root, 'desktop', 'runtime-lock.json') });
  await service.start();
  t.after(() => service.stop());
  assert.equal(service.status().state, 'ready', 'the verified bundled runtime started');
  assert.equal(service.status().runtime, 'bundled-verified');
  await runFixturesThrough(service, SAMPLE);
  const names = readdirSync(FIXTURES).filter((file) => file.endsWith('.json')).map((file) => file.slice(0, -5));
  assert.ok(SAMPLE.every((name) => names.includes(name)), 'every sampled fixture exists');
});

// ---- buffers derived from a committed one (card M8.4.4) -----------------------------------------------------------------

test('deriveBuffer starts a copy of a committed buffer and takes the changed parts at ascending offsets', async () => {
  const engine = fakeEngine({ answers: { ...fakeAnswers(), 'buffer.derive': () => ({ handle: uuid() }) } });
  const ipc = createEngineIpc({ engine }), bytes = Buffer.alloc(5000, 7);
  const base = await committed(ipc, 1, bytes);
  const changed = Buffer.from(bytes); changed.fill(9, 1000, 1010); changed.fill(8, 3000, 3005);
  const derived = await ipc.call(1, 'deriveBuffer', base, descriptor({ byte_length: 5000, shape: [5000], sha256: sha(changed) }));
  assert.equal(derived.error, undefined, JSON.stringify(derived.error));
  const sent = engine.calls.find((call) => call.op === 'buffer.derive').payload;
  assert.deepEqual(Object.keys(sent).sort(), ['base', 'byte_length', 'dtype', 'sha256', 'shape']);
  assert.ok(!JSON.stringify(derived).includes(sent.base) && /^[0-9a-f-]{36}$/.test(derived.token) && derived.token !== base);
  assert.equal((await ipc.call(1, 'appendBuffer', derived.token, 1000, changed.subarray(1000, 1010))).error, undefined);
  assert.equal((await ipc.call(1, 'appendBuffer', derived.token, 3000, changed.subarray(3000, 3005))).error, undefined);
  for (const [offset, length] of [[2000, 10], [3003, 4], [0, 10], [4995, 10]]) {
    assert.equal((await ipc.call(1, 'appendBuffer', derived.token, offset, Buffer.alloc(length))).error?.code, 'INVALID_REQUEST', `${offset}+${length}`);
  }
  assert.equal((await ipc.call(1, 'commitBuffer', derived.token)).error, undefined, 'a derived buffer commits without every byte being sent');
  assert.equal((await ipc.call(1, 'readBuffer', derived.token, 0, 1)).error?.code ?? 'readable', 'readable');
  assert.equal((await ipc.call(2, 'readBuffer', derived.token, 0, 1)).error.code, 'INVALID_BUFFER', 'owned by this page only');
});

test('an ordinary buffer still needs every byte and its parts in order', async () => {
  const ipc = createEngineIpc({ engine: fakeEngine({ answers: fakeAnswers() }) });
  const { token } = await ipc.call(1, 'beginBuffer', descriptor({ byte_length: 4000, shape: [4000] }));
  assert.equal((await ipc.call(1, 'appendBuffer', token, 1000, Buffer.alloc(10))).error.code, 'INVALID_REQUEST', 'a gap');
  assert.equal((await ipc.call(1, 'appendBuffer', token, 0, Buffer.alloc(10))).error, undefined);
  assert.equal((await ipc.call(1, 'commitBuffer', token)).error.code, 'INVALID_BUFFER', 'incomplete');
});

test('deriveBuffer refuses everything that is not a derivation of a committed buffer of this page', async () => {
  const engine = fakeEngine({ answers: { ...fakeAnswers(), 'buffer.derive': () => ({ handle: uuid() }) } });
  const ipc = createEngineIpc({ engine }), bytes = Buffer.alloc(100, 1);
  const base = await committed(ipc, 1, bytes), table = await committed(ipc, 1, Buffer.from('{"a":1}'), 'utf8json');
  const staging = (await ipc.call(1, 'beginBuffer', descriptor())).token;
  const good = descriptor({ byte_length: 100, shape: [100], sha256: sha(bytes) });
  const cases = [
    [base, null, 'INVALID_REQUEST'], [base, { ...good, extra: 1 }, 'INVALID_REQUEST'], [base, { ...good, dtype: 'i32le' }, 'INVALID_REQUEST'],
    [base, { ...good, shape: [10, 10] }, 'INVALID_REQUEST'], [base, { ...good, byte_length: 99 }, 'INVALID_REQUEST'], [base, { ...good, sha256: 'A'.repeat(64) }, 'INVALID_REQUEST'],
    [table, descriptor({ dtype: 'utf8json', byte_length: 7, shape: [7], sha256: sha(Buffer.from('{"a":1}')) }), 'INVALID_REQUEST'],
    [staging, good, 'INVALID_BUFFER'], [uuid(), good, 'INVALID_BUFFER'], [7, good, 'INVALID_BUFFER'],
  ];
  for (const [token, value, code] of cases) assert.equal((await ipc.call(1, 'deriveBuffer', token, value)).error?.code, code, JSON.stringify([token === base ? 'base' : 'other', value]));
  assert.equal((await ipc.call(2, 'deriveBuffer', base, good)).error.code, 'INVALID_BUFFER', 'another page cannot derive from this page\'s buffer');
  assert.ok(!engine.calls.some((call) => call.op === 'buffer.derive'), 'the engine never saw a refused request');
  const many = createEngineIpc({ engine });
  const kept = await committed(many, 1, bytes);
  for (let i = 1; i < MAX_TOKENS_PER_PAGE; i++) assert.ok((await many.call(1, 'beginBuffer', descriptor())).token);
  assert.equal((await many.call(1, 'deriveBuffer', kept, good)).error.code, 'LIMIT_EXCEEDED');
});
