// Card M8.5.3: `method.run` from the page (contract §9). The main process's checks of a request and of its answer (desktop/engine-ipc.js
// `runMethod`, against probe method tables and against the mirror of the engine's method table), the renderer's `run` against an
// in-memory bridge (engineclient.js), the inverse of a table snapshot (tablesnapshot.js `readTableResult`) and, when a development Python
// with NumPy is available, `section.intervals/1` through `method.run`, the real bridge and the real engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createEngineClient, EngineError } from '../../app/js/engineclient.js';
import { buildTableSnapshot, readTableResult, TableSnapshotError } from '../../app/js/tablesnapshot.js';

const require = createRequire(import.meta.url);
const { createEngineIpc, METHODS, FAMILY_BUFFERS, MAX_FAMILY_MEMBERS, MAX_REQUEST_INPUTS, MAX_RUNS_PER_PAGE, MAX_TOKENS_PER_PAGE } = require('../../desktop/engine-ipc.js');
const { createEngineService, RUN_TIMEOUTS_MS } = require('../../desktop/engine.js');
const root = fileURLToPath(new URL('../../', import.meta.url));
const sha = (data) => createHash('sha256').update(data).digest('hex');
const uuid = () => randomUUID();
const tick = () => new Promise((resolve) => setImmediate(resolve));

// Probe methods of the three scopes, as tests/test_engine_method_run.py registers them in the engine.
const PROBES = {
  'probe.core/1': { scope: 'core', required: ['record', 'record_values', 'record_valid', 'settings'], optional: [], families: [],
    priorities: ['interactive'], dimensions: ['columns'], tables: ['sums'] },
  'probe.project/1': { scope: 'project', required: ['settings'], optional: [], families: [{ prefix: 'core', kind: 'table', maximum: 128 }],
    priorities: ['interactive', 'batch'], dimensions: ['tables'], tables: ['totals'] },
};

/** An engine that records every request and answers from a script (as in engine-ipc.test.mjs). */
function fakeEngine(answers = {}) {
  const engine = {
    calls: [], pending: [], current: 'session-1',
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
    session: () => engine.current,
    restart: async () => ({ restarted: true }),
  };
  return engine;
}
const bufferAnswers = () => ({
  'buffer.begin': () => ({ handle: uuid() }),
  'buffer.chunk': (payload) => ({ next_offset: payload.offset + payload.byte_length }),
  'buffer.commit': (payload) => ({ handle: payload.handle, byte_length: 1, sha256: '1'.repeat(64) }),
  'buffer.release': (payload) => ({ released: payload.handles }),
});
async function committed(ipc, owner) {
  const { token } = await ipc.call(owner, 'beginBuffer', { dtype: 'u8', shape: [1], byte_length: 1, sha256: sha(Buffer.from([1])) });
  await ipc.call(owner, 'appendBuffer', token, 0, Buffer.from([1]));
  assert.equal((await ipc.call(owner, 'commitBuffer', token)).error, undefined);
  return token;
}
const tableTokens = async (ipc, owner, name) => ({ [name]: await committed(ipc, owner), [`${name}_values`]: await committed(ipc, owner), [`${name}_valid`]: await committed(ipc, owner) });
const coreRequest = (inputs, change = {}) => ({ requestKey: uuid(), method: 'probe.core/1', scope: 'core', target: uuid(), revision: 4, priority: 'interactive',
  settings_hash: '2'.repeat(64), inputs, ...change });
const projectRequest = (inputs, change = {}) => ({ ...coreRequest(inputs), method: 'probe.project/1', scope: 'project', priority: 'batch', ...change });

/** The answer of the engine to `payload` for the core probe: one table output `sums` of 2 columns and 1 row, in a packed buffer of 24 bytes. */
const coreAnswer = (payload, change = {}) => ({ method: payload.method, scope: payload.scope, target: payload.target, revision: payload.revision,
  settings_hash: payload.settings_hash, inputs_key: 'e'.repeat(64), dimensions: { columns: 2 },
  outputs: { result: { handle: 'result-handle', dtype: 'u8', shape: [24], byte_length: 24, sha256: 'a'.repeat(64) } },
  layout: { sums_values: { dtype: 'f64le', shape: [2, 1], offset: 0, byte_length: 16 }, sums_valid: { dtype: 'u8', shape: [2, 1], offset: 16, byte_length: 2 } },
  tables: { sums: { version: 1, rows: 1, columns: [{ name: 'depth', unit: 'cm' }, { name: 'Ca', unit: '' }] } }, summary: { rows: 5 },
  provenance: { engine_version: 'test', inputs_key: 'e'.repeat(64) }, ...change });

// ---- the main process: requests (engine-ipc.js runMethod) -------------------------------------------------------------------

test('runMethod is a bridge operation; a page holds up to 1,024 tokens (contract §9.7)', () => {
  const ipc = createEngineIpc({ engine: fakeEngine() });
  assert.ok(ipc.OPERATIONS.includes('runMethod'));
  assert.equal(MAX_TOKENS_PER_PAGE, 1024);
  assert.equal(MAX_REQUEST_INPUTS, 3 * 128 + 32);
  assert.deepEqual(RUN_TIMEOUTS_MS, { interactive: 10 * 60 * 1000, batch: 20 * 60 * 1000 });
});

test('runMethod refuses each malformed request before the engine and names the field', async () => {
  const engine = fakeEngine(bufferAnswers()), ipc = createEngineIpc({ engine, methods: PROBES });
  const core = { ...(await tableTokens(ipc, 1, 'record')), settings: await committed(ipc, 1) };
  const settings = await committed(ipc, 1), members = [];
  for (let k = 0; k < 3; k++) members.push(await tableTokens(ipc, 1, `core${k}`));
  const family = (...ks) => Object.assign({ settings }, ...ks.map((k) => members[k]));
  const staging = (await ipc.call(1, 'beginBuffer', { dtype: 'u8', shape: [1], byte_length: 1, sha256: sha(Buffer.from([1])) })).token;
  const foreign = await committed(ipc, 2);
  const without = (inputs, name) => Object.fromEntries(Object.entries(inputs).filter(([key]) => key !== name));
  const many = Object.fromEntries(Array.from({ length: MAX_REQUEST_INPUTS + 1 }, (_, i) => [`core${Math.floor(i / 3)}${FAMILY_BUFFERS.table[i % 3]}`, settings]));
  const calls = engine.calls.length;
  const cases = [
    [null, 'INVALID_REQUEST', 'request'], [[], 'INVALID_REQUEST', 'request'], ['x', 'INVALID_REQUEST', 'request'],
    [coreRequest(core, { surprise: 1 }), 'INVALID_REQUEST', 'request'], [coreRequest(core, { project: uuid() }), 'INVALID_REQUEST', 'request'],
    [coreRequest(core, { requestKey: 'abc' }), 'INVALID_REQUEST', 'requestKey'],
    [coreRequest(core, { method: 'probe.core/2' }), 'UNSUPPORTED_METHOD', 'method'], [coreRequest(core, { method: '__proto__' }), 'UNSUPPORTED_METHOD', 'method'],
    [coreRequest(core, { method: 'section.intervals/1' }), 'UNSUPPORTED_METHOD', 'method'], [coreRequest(core, { method: 7 }), 'UNSUPPORTED_METHOD', 'method'],
    [coreRequest(core, { scope: 'project' }), 'INVALID_REQUEST', 'scope'], [coreRequest(core, { scope: undefined }), 'INVALID_REQUEST', 'scope'],
    [coreRequest(core, { target: 'T'.repeat(36) }), 'INVALID_REQUEST', 'target'], [coreRequest(core, { target: undefined }), 'INVALID_REQUEST', 'target'],
    [coreRequest(core, { revision: -1 }), 'INVALID_REQUEST', 'revision'], [coreRequest(core, { revision: 2 ** 53 }), 'INVALID_REQUEST', 'revision'],
    [coreRequest(core, { priority: 'batch' }), 'INVALID_REQUEST', 'priority'], [coreRequest(core, { priority: 'urgent' }), 'INVALID_REQUEST', 'priority'],
    [coreRequest(core, { priority: undefined }), 'INVALID_REQUEST', 'priority'],
    [coreRequest(core, { settings_hash: 'F'.repeat(64) }), 'INVALID_REQUEST', 'settings_hash'],
    [coreRequest(core, { inputs: [] }), 'INVALID_REQUEST', 'inputs'], [coreRequest(core, { inputs: null }), 'INVALID_REQUEST', 'inputs'],
    [coreRequest({ ...core, extra: settings }), 'INVALID_REQUEST', 'inputs.extra'], [coreRequest({ ...core, core0: settings }), 'INVALID_REQUEST', 'inputs.core0'],
    ...Object.keys(core).map((name) => [coreRequest(without(core, name)), 'INVALID_REQUEST', `inputs.${name}`]),
    [projectRequest(family(0, 2)), 'INVALID_REQUEST', 'inputs'], [projectRequest(family(1)), 'INVALID_REQUEST', 'inputs'],
    [projectRequest(without(family(0, 1), 'core1_valid')), 'INVALID_REQUEST', 'inputs'],
    [projectRequest({ ...family(0), core128: settings, core128_values: settings, core128_valid: settings }), 'INVALID_REQUEST', 'inputs.core128'],
    [projectRequest({ ...family(0), core01: settings }), 'INVALID_REQUEST', 'inputs.core01'], [projectRequest({ ...family(0), core0_extra: settings }), 'INVALID_REQUEST', 'inputs.core0_extra'],
    [projectRequest({ ...many, settings }), 'INVALID_REQUEST', 'inputs'],
    [coreRequest({ ...core, record: foreign }), 'INVALID_BUFFER', 'token'], [coreRequest({ ...core, record: staging }), 'INVALID_BUFFER', 'token'],
    [coreRequest({ ...core, record: 'nope' }), 'INVALID_BUFFER', 'token'],
  ];
  for (const [request, code, field] of cases) {
    const label = JSON.stringify(request)?.slice(0, 120);
    assert.deepEqual(await ipc.call(1, 'runMethod', request), { error: { code, field } }, label);
  }
  assert.equal(engine.calls.length, calls, 'the engine never saw a malformed request');
  // The same family complete, within its maximum and contiguous from 0, is accepted; so is a project with no core at all.
  for (const inputs of [family(0, 1, 2), family()]) {
    const result = await ipc.call(1, 'runMethod', projectRequest(inputs));
    assert.equal(result.error?.field === 'inputs' || result.error?.field === 'request', false, JSON.stringify(result));
  }
  assert.equal(engine.calls.filter((call) => call.op === 'method.run').length, 2, 'both complete families reached the engine');
});

test('runMethod sends handles, returns a token for the packed result, its layout and tables, and hides every handle', async () => {
  const engine = fakeEngine({ ...bufferAnswers(), 'method.run': (payload) => coreAnswer(payload) }), ipc = createEngineIpc({ engine, methods: PROBES });
  const inputs = { ...(await tableTokens(ipc, 1, 'record')), settings: await committed(ipc, 1) }, request = coreRequest(inputs);
  const result = await ipc.call(1, 'runMethod', request);
  const sent = engine.calls.find((call) => call.op === 'method.run').payload;
  assert.deepEqual(Object.keys(sent).sort(), ['inputs', 'method', 'priority', 'revision', 'scope', 'settings_hash', 'target']);
  assert.deepEqual(Object.keys(sent.inputs).sort(), Object.keys(inputs).sort());
  assert.ok(Object.values(sent.inputs).every((handle) => !Object.values(inputs).includes(handle)), 'tokens were replaced by engine handles');
  const expected = coreAnswer(sent);
  assert.deepEqual(Object.keys(result).sort(), ['dimensions', 'inputs_key', 'layout', 'method', 'outputs', 'provenance', 'revision', 'scope', 'settings_hash', 'summary', 'tables', 'target']);
  assert.deepEqual([result.method, result.scope, result.target, result.revision, result.settings_hash, result.inputs_key],
    [request.method, 'core', request.target, 4, request.settings_hash, 'e'.repeat(64)]);
  assert.deepEqual([result.dimensions, result.layout, result.tables, result.summary], [expected.dimensions, expected.layout, expected.tables, expected.summary]);
  assert.match(result.outputs.result.token, /^[0-9a-f-]{36}$/);
  assert.ok(!JSON.stringify(result).includes('result-handle') && !Object.values(sent.inputs).some((handle) => JSON.stringify(result).includes(handle)));
  assert.equal((await ipc.call(2, 'readBuffer', result.outputs.result.token, 0, 1)).error.code, 'INVALID_BUFFER', 'another page cannot read it');
  assert.equal((await ipc.call(1, 'release', [result.outputs.result.token])).released, 1);
  assert.deepEqual(engine.calls.at(-1).payload, { handles: ['result-handle'] });
});

test('an empty result has no token; a result that does not answer the request is internal and handed back to the engine', async () => {
  const empty = (payload) => coreAnswer(payload, { outputs: {}, dimensions: { columns: 0 },
    layout: { sums_values: { dtype: 'f64le', shape: [0, 1], offset: 0, byte_length: 0 }, sums_valid: { dtype: 'u8', shape: [0, 1], offset: 0, byte_length: 0 } } });
  const engine = fakeEngine({ ...bufferAnswers(), 'method.run': empty }), ipc = createEngineIpc({ engine, methods: PROBES });
  const inputs = { ...(await tableTokens(ipc, 1, 'record')), settings: await committed(ipc, 1) }, before = ipc.size();
  const result = await ipc.call(1, 'runMethod', coreRequest(inputs));
  assert.deepEqual([result.outputs, result.dimensions, result.layout.sums_valid.byte_length, ipc.size()], [{}, { columns: 0 }, 0, before]);
  const bad = {
    'another target': { target: uuid() }, 'another revision': { revision: 5 }, 'another method': { method: 'probe.project/1' }, 'no inputs key': { inputs_key: 'x' },
    'an unknown dimension': { dimensions: { columns: 2, rows: 1 } }, 'a negative dimension': { dimensions: { columns: -1 } }, 'a missing table': { tables: {} },
    'a table of another version': { tables: { sums: { version: 2, rows: 1, columns: [{ name: 'a', unit: '' }] } } }, 'no summary': { summary: null },
    'two outputs': { outputs: { result: coreAnswer({}).outputs.result, other: coreAnswer({}).outputs.result } }, 'a layout of 65 columns':
      { layout: Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`c${'x'.repeat(i)}`, { dtype: 'u8', shape: [1], offset: 0, byte_length: 1 }])) },
    'a layout of an unknown dtype': { layout: { sums_values: { dtype: 'f32le', shape: [1], offset: 0, byte_length: 4 } } },
  };
  for (const [label, change] of Object.entries(bad)) {
    const failing = fakeEngine({ ...bufferAnswers(), 'method.run': (payload) => coreAnswer(payload, change) }), page = createEngineIpc({ engine: failing, methods: PROBES });
    const tokens = { ...(await tableTokens(page, 1, 'record')), settings: await committed(page, 1) }, held = page.size();
    const answer = await page.call(1, 'runMethod', coreRequest(tokens));
    assert.equal(answer.error?.code, 'INTERNAL', label);
    assert.equal(page.size(), held, `${label}: no token for the refused result`);
    assert.ok(failing.calls.some((call) => call.op === 'buffer.release' && call.payload.handles.includes('result-handle')), `${label}: the result was released`);
  }
});

test('a page runs a bounded number of methods at once, a request key once, and only its own can be cancelled', async () => {
  const engine = fakeEngine({ ...bufferAnswers(), 'method.run': 'hold', 'job.cancel': { state: 'requested' } }), ipc = createEngineIpc({ engine, methods: PROBES });
  const inputs = { ...(await tableTokens(ipc, 1, 'record')), settings: await committed(ipc, 1) };
  const requests = Array.from({ length: MAX_RUNS_PER_PAGE }, () => coreRequest(inputs));
  const running = requests.map((request) => ipc.call(1, 'runMethod', request));
  await tick();
  assert.deepEqual(await ipc.call(1, 'runMethod', requests[0]), { error: { code: 'INVALID_REQUEST', field: 'requestKey' } }, 'a key that runs');
  assert.deepEqual(await ipc.call(1, 'runMethod', coreRequest(inputs)), { error: { code: 'BUSY' } }, 'one call beyond the limit');
  const other = ipc.call(2, 'runMethod', coreRequest({ ...(await tableTokens(ipc, 2, 'record')), settings: await committed(ipc, 2) }));
  await tick();
  assert.equal(engine.pending.length, MAX_RUNS_PER_PAGE + 1, 'another page is not blocked');
  assert.equal((await ipc.call(2, 'cancel', requests[0].requestKey)).state, 'already_terminal', 'another page cannot cancel it');
  assert.deepEqual(await ipc.call(1, 'cancel', requests[0].requestKey), { state: 'requested' });
  assert.equal(engine.calls.find((call) => call.op === 'job.cancel').payload.request_id, engine.pending[0].requestId);
  for (const job of engine.pending) job.resolve({ cancelled: true });
  assert.ok((await Promise.all([...running, other])).every((value) => value.cancelled === true));
  assert.equal((await ipc.call(1, 'cancel', requests[0].requestKey)).state, 'already_terminal');
});

test('closing a page cancels its runs and a result that arrives afterwards is released, never handed out', async () => {
  const engine = fakeEngine({ ...bufferAnswers(), 'method.run': 'hold' }), ipc = createEngineIpc({ engine, methods: PROBES });
  const inputs = { ...(await tableTokens(ipc, 1, 'record')), settings: await committed(ipc, 1) };
  const running = ipc.call(1, 'runMethod', coreRequest(inputs));
  await tick();
  ipc.releasePage(1);
  assert.equal(engine.calls.filter((call) => call.op === 'job.cancel').length, 1);
  engine.pending[0].resolve(coreAnswer(engine.pending[0].payload));
  assert.deepEqual(await running, { cancelled: true });
  assert.deepEqual(engine.calls.at(-1).payload, { handles: ['result-handle'] });
  assert.equal(ipc.size(), 0);
});

// ---- the mirror of the engine's method table ---------------------------------------------------------------------------------

/** A Python interpreter of any version: specs.py needs only the standard library. */
function anyPython() {
  const candidates = [process.env.SEDCORETOOL_TEST_PYTHON && [process.env.SEDCORETOOL_TEST_PYTHON], process.platform === 'win32' && ['py', '-3'], ['python3'], ['python']].filter(Boolean);
  for (const [command, ...args] of candidates) {
    const probe = spawnSync(command, [...args, '-c', 'import sys; print(sys.version_info[0])'], { encoding: 'utf8', windowsHide: true });
    if (probe.status === 0 && probe.stdout.trim() === '3') return [command, ...args];
  }
  return null;
}

test('the mirror of the method table equals METHOD_SPECS of specs.py', () => {
  const python = anyPython();
  assert.ok(python, 'a Python 3 interpreter is needed to read src/sedcoretool/engine/specs.py (set SEDCORETOOL_TEST_PYTHON)');
  const script = [
    'import importlib.util, json, sys',
    "spec = importlib.util.spec_from_file_location('engine_specs', sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)",
    "methods = {name: {'scope': s.scope, 'required': sorted(n for n, (_, _, r) in s.inputs.items() if r), 'optional': sorted(n for n, (_, _, r) in s.inputs.items() if not r),",
    "  'families': [{'prefix': f.prefix, 'kind': f.kind, 'maximum': f.maximum} for f in s.families], 'priorities': list(s.priorities),",
    "  'dimensions': list(s.dimensions), 'tables': list(s.tables)} for name, s in m.METHOD_SPECS.items()}",
    "print(json.dumps({'methods': methods, 'family_buffers': {k: list(v) for k, v in m.FAMILY_KINDS.items()}, 'members': m.MAX_FAMILY_MEMBERS, 'inputs': m.MAX_REQUEST_INPUTS}))",
  ].join('\n');
  const [command, ...args] = python;
  const run = spawnSync(command, [...args, '-I', '-c', script, path.join(root, 'src', 'sedcoretool', 'engine', 'specs.py')], { encoding: 'utf8', windowsHide: true });
  assert.equal(run.status, 0, run.stderr);
  const engine = JSON.parse(run.stdout);
  const mirror = Object.fromEntries(Object.entries(METHODS).map(([name, entry]) => [name, { ...entry, required: [...entry.required].sort(), optional: [...entry.optional].sort() }]));
  assert.deepEqual(mirror, engine.methods);
  assert.deepEqual(FAMILY_BUFFERS, engine.family_buffers);
  assert.deepEqual([MAX_FAMILY_MEMBERS, MAX_REQUEST_INPUTS], [engine.members, engine.inputs]);
  assert.ok(Object.isFrozen(METHODS['section.intervals/1'].required), 'a page cannot change the table');
});

// ---- the renderer (engineclient.js run) --------------------------------------------------------------------------------------

/** A bridge that keeps buffers in memory and answers `runMethod` with `answer(request)` (or holds it when `answer` is 'hold'). */
function memoryBridge(answer) {
  const buffers = new Map(), released = [], cancelled = [], runs = [], pending = [];
  const bridge = {
    buffers, released, cancelled, runs, pending,
    status: async () => ({ state: 'ready' }),
    beginBuffer: async (descriptor) => { const token = uuid(); buffers.set(token, { ...descriptor, data: new Uint8Array(descriptor.byte_length), next: 0 }); return { token }; },
    appendBuffer: async (token, offset, bytes) => { const b = buffers.get(token); b.data.set(bytes, offset); b.next += bytes.length; return { next_offset: b.next }; },
    commitBuffer: async (token) => { const b = buffers.get(token); assert.equal(sha(b.data), b.sha256); return { token, byte_length: b.byte_length, sha256: b.sha256 }; },
    readBuffer: async (token, offset, length) => ({ offset, bytes: buffers.get(token).data.slice(offset, offset + length) }),
    release: async (tokens) => { released.push(...tokens); return { released: tokens.length }; },
    cancel: async (key) => { cancelled.push(key); return { state: 'requested' }; },
    analyzeSection: async () => ({ error: { code: 'INTERNAL' } }),
    runMethod: (request) => {
      runs.push(request);
      if (answer === 'hold') return new Promise((resolve) => pending.push(resolve));
      return Promise.resolve(answer(request));
    },
  };
  /** Stores `bytes` as a committed buffer and returns its output descriptor. */
  bridge.output = (bytes) => { const token = uuid(); buffers.set(token, { data: bytes }); return { token, dtype: 'u8', shape: [bytes.length], byte_length: bytes.length, sha256: sha(bytes) }; };
  return bridge;
}

/** A packed result as the engine writes it: each column at a multiple of 8 bytes. Returns the bytes and the layout. */
function pack(columns) {
  const types = { u8: Uint8Array, u32le: Uint32Array, i32le: Int32Array, f64le: Float64Array };
  const layout = {}, parts = [];
  let offset = 0;
  for (const [name, { dtype, shape, data }] of Object.entries(columns)) {
    const typed = types[dtype].from(data), length = typed.byteLength;
    layout[name] = { dtype, shape, offset, byte_length: length };
    parts.push([offset, new Uint8Array(typed.buffer)]);
    offset = Math.ceil((offset + length) / 8) * 8;
  }
  const bytes = new Uint8Array(offset);
  for (const [at, part] of parts) bytes.set(part, at);
  return { bytes, layout };
}

const runRequest = (inputs) => ({ scope: 'core', target: uuid(), revision: 7, inputs: { record: 't1', record_values: 't2', record_valid: 't3', settings: { version: 1 }, ...inputs } });

test('run sends the settings itself, decodes columns and table outputs exactly, and releases only what it made', async () => {
  const huge = 2 ** 53 - 1, tiny = 5e-324;
  const { bytes, layout } = pack({
    count: { dtype: 'u32le', shape: [3], data: [0, 4294967295, 7] }, count_valid: { dtype: 'u8', shape: [3], data: [1, 0, 1] },
    labels: { dtype: 'i32le', shape: [2, 2], data: [-1, 2, -2147483648, 2147483647] },
    sums_values: { dtype: 'f64le', shape: [2, 3], data: [-0, huge, 0, tiny, 0, -1.5] }, sums_valid: { dtype: 'u8', shape: [2, 3], data: [1, 1, 0, 1, 0, 1] },
  });
  let output;
  const bridge = memoryBridge((request) => {
    output = bridge.output(bytes);
    return { method: request.method, scope: request.scope, target: request.target, revision: request.revision, settings_hash: request.settings_hash,
      inputs_key: 'e'.repeat(64), dimensions: { columns: 2 }, outputs: { result: output }, layout,
      tables: { sums: { version: 1, rows: 3, columns: [{ name: 'depth', unit: 'cm' }, { name: 'δ18O', unit: '‰' }] } }, summary: { rows: 3 }, provenance: { method: request.method } };
  });
  const client = createEngineClient(bridge), request = runRequest({ settings: { version: 1, step: 0.5 } });
  const result = await client.run('probe.core/1', request);
  const sent = bridge.runs[0];
  assert.deepEqual(Object.keys(sent).sort(), ['inputs', 'method', 'priority', 'requestKey', 'revision', 'scope', 'settings_hash', 'target']);
  assert.deepEqual([sent.method, sent.scope, sent.target, sent.revision, sent.priority], ['probe.core/1', 'core', request.target, 7, 'interactive']);
  const settings = bridge.buffers.get(sent.inputs.settings);
  assert.deepEqual([settings.dtype, new TextDecoder().decode(settings.data)], ['utf8json', '{"version":1,"step":0.5}']);
  assert.equal(sent.settings_hash, sha(settings.data), 'settings_hash is the SHA-256 of the settings bytes sent');
  assert.deepEqual([sent.inputs.record, sent.inputs.record_values, sent.inputs.record_valid], ['t1', 't2', 't3']);
  assert.deepEqual(result.columns, { count: { data: [0, 4294967295, 7], shape: [3], valid: [1, 0, 1] }, labels: { data: [-1, 2, -2147483648, 2147483647], shape: [2, 2] } });
  assert.deepEqual(result.tables, { sums: [{ name: 'depth', unit: 'cm', values: [-0, huge, null] }, { name: 'δ18O', unit: '‰', values: [tiny, null, -1.5] }] });
  assert.ok(Object.is(result.tables.sums[0].values[0], -0), '-0 survives');
  assert.deepEqual([result.dimensions, result.summary, result.provenance, result.inputsKey], [{ columns: 2 }, { rows: 3 }, { method: 'probe.core/1' }, 'e'.repeat(64)]);
  await tick();
  assert.deepEqual(bridge.released.sort(), [sent.inputs.settings, output.token].sort(), 'the settings and the result are released, the caller\'s tokens are not');
});

test('an empty result needs no download; a project request may name batch priority', async () => {
  const bridge = memoryBridge((request) => ({ method: request.method, scope: request.scope, target: request.target, revision: request.revision,
    settings_hash: request.settings_hash, inputs_key: 'e'.repeat(64), dimensions: { tables: 0 }, outputs: {},
    layout: { totals_values: { dtype: 'f64le', shape: [2, 0], offset: 0, byte_length: 0 }, totals_valid: { dtype: 'u8', shape: [2, 0], offset: 0, byte_length: 0 } },
    tables: { totals: { version: 1, rows: 0, columns: [{ name: 'a', unit: '' }, { name: 'b', unit: '' }] } }, summary: { tables: 0 }, provenance: {} }));
  bridge.readBuffer = async () => assert.fail('nothing to read');
  const result = await createEngineClient(bridge).run('probe.project/1', { scope: 'project', target: uuid(), revision: 0, priority: 'batch', inputs: { settings: { version: 1 } } });
  assert.equal(bridge.runs[0].priority, 'batch');
  assert.deepEqual([result.columns, result.tables], [{}, { totals: [{ name: 'a', unit: '', values: [] }, { name: 'b', unit: '', values: [] }] }]);
});

test('an abort cancels the job; a cancelled or failed job rejects', async () => {
  const held = memoryBridge('hold'), client = createEngineClient(held), controller = new AbortController();
  const running = client.run('probe.core/1', runRequest(), { signal: controller.signal });
  while (!held.runs.length) await tick();
  controller.abort();
  assert.deepEqual(held.cancelled, [held.runs[0].requestKey], 'the abort cancelled this request in the engine');
  held.pending[0]({ cancelled: true });
  await assert.rejects(running, (error) => error.name === 'AbortError');
  // Superseded by a newer request of the same method and target: the engine answers `cancelled` without any abort here.
  await assert.rejects(createEngineClient(memoryBridge(() => ({ cancelled: true }))).run('probe.core/1', runRequest()), (error) => error.name === 'AbortError');
  await assert.rejects(createEngineClient(memoryBridge(() => ({ error: { code: 'UNSUPPORTED_INPUT', field: 'record.depth' } }))).run('probe.core/1', runRequest()),
    (error) => error instanceof EngineError && error.code === 'UNSUPPORTED_INPUT' && error.field === 'record.depth');
  const before = createEngineClient(memoryBridge(() => assert.fail('not sent'))), aborted = new AbortController();
  aborted.abort();
  await assert.rejects(before.run('probe.core/1', runRequest(), { signal: aborted.signal }), (error) => error.name === 'AbortError');
});

test('run refuses missing settings and table cells that do not match their description', async () => {
  const client = createEngineClient(memoryBridge(() => assert.fail('not sent')));
  for (const settings of [undefined, null, 'x', [1]]) {
    await assert.rejects(client.run('probe.core/1', runRequest({ settings })), (error) => error instanceof EngineError && error.field === 'inputs.settings');
  }
  for (const [shape, valid, label] of [[[2, 1], [1, 1], 'a shape that is not [columns, rows]'], [[1, 2], [1, 2], 'a validity of 2']]) {
    const { bytes, layout } = pack({ sums_values: { dtype: 'f64le', shape, data: [1, 2] }, sums_valid: { dtype: 'u8', shape, data: valid } });
    const bridge = memoryBridge((request) => ({ method: request.method, scope: request.scope, target: request.target, revision: request.revision,
      settings_hash: request.settings_hash, inputs_key: 'e'.repeat(64), dimensions: {}, outputs: { result: bridge.output(bytes) }, layout,
      tables: { sums: { version: 1, rows: 2, columns: [{ name: 'a', unit: '' }] } }, summary: {}, provenance: {} }));
    await assert.rejects(createEngineClient(bridge).run('probe.core/1', runRequest()), (error) => error instanceof EngineError && error.code === 'INTERNAL' && error.field === 'tables.sums', label);
  }
});

// ---- tablesnapshot.js readTableResult ----------------------------------------------------------------------------------------

test('readTableResult of buildTableSnapshot(x) equals x for random tables with missing values', async () => {
  let state = 2024;
  const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const special = [-0, 5e-324, -5e-324, 1.7976931348623157e308, 2 ** 53, 0.1];
  for (let t = 0; t < 60; t++) {
    const rows = 1 + Math.floor(random() * 300), count = 1 + Math.floor(random() * 8), p = random();
    const columns = Array.from({ length: count }, (_, i) => ({ name: `c${i}·${t}`, unit: i % 2 ? 'cm' : '', values: Array.from({ length: rows },
      () => (random() < p ? null : random() < 0.2 ? special[Math.floor(random() * special.length)] : (random() - 0.5) * 10 ** Math.floor(random() * 60 - 30))) }));
    const snapshot = await buildTableSnapshot(columns), { meta, values, valid } = snapshot.buffers;
    const read = readTableResult(JSON.parse(new TextDecoder().decode(meta.data)), values.data, valid.data);
    assert.deepEqual(read, columns, `table ${t}`);
    read.forEach((column, i) => column.values.forEach((value, j) => assert.ok(Object.is(value, columns[i].values[j]), `table ${t} [${i}][${j}]`)));
  }
});

test('readTableResult refuses what is not a table and accepts an output table of 0 rows', () => {
  const description = { version: 1, rows: 2, columns: [{ name: 'a', unit: '' }] };
  assert.deepEqual(readTableResult({ ...description, rows: 0 }, [], []), [{ name: 'a', unit: '', values: [] }]);
  const cases = [
    [[null, [1, 2], [1, 1]], 'description'], [[{ ...description, version: 2 }, [1, 2], [1, 1]], 'description'],
    [[{ ...description, rows: -1 }, [], []], 'rows'], [[{ ...description, rows: 1.5 }, [1, 2], [1, 1]], 'rows'],
    [[{ ...description, columns: [] }, [], []], 'columns'], [[{ ...description, columns: 'a' }, [1, 2], [1, 1]], 'columns'],
    [[description, [1], [1, 1]], 'values'], [[description, [1, 2], [1]], 'valid'], [[description, null, [1, 1]], 'values'],
    [[{ ...description, columns: [{ name: '', unit: '' }] }, [1, 2], [1, 1]], 'columns[0]'], [[{ ...description, columns: [{ name: 'a' }] }, [1, 2], [1, 1]], 'columns[0]'],
    [[description, [1, NaN], [1, 1]], 'columns[0].values[1]'], [[description, [1, Infinity], [1, 1]], 'columns[0].values[1]'], [[description, [1, 2], [1, 2]], 'columns[0].values[1]'],
  ];
  for (const [args, field] of cases) {
    assert.throws(() => readTableResult(...args), (error) => error instanceof TableSnapshotError && error.code === 'INVALID_REQUEST' && error.field === field, field);
  }
  assert.deepEqual(readTableResult(description, [1, NaN], [1, 0]), [{ name: 'a', unit: '', values: [1, null] }], 'a missing slot is never read');
});

// ---- through the real bridge and engine -------------------------------------------------------------------------------------

const pythonCheck = spawnSync(process.platform === 'win32' ? 'py' : 'python3',
  [...(process.platform === 'win32' ? ['-3.12'] : []), '-c', 'import sys, numpy; print(sys.executable)'], { encoding: 'utf8', windowsHide: true });
const python = process.env.SEDCORETOOL_TEST_PYTHON || (pythonCheck.status === 0 ? pythonCheck.stdout.trim() : null);

test('section.intervals/1 through method.run, the real bridge and engine gives the reference fixture', { skip: !python, timeout: 120000 }, async (t) => {
  const service = createEngineService({ enabled: true, packaged: false, executable: python, sourceDirectory: root, version: 'test' });
  await service.start();
  t.after(() => service.stop());
  const ipc = createEngineIpc({ engine: service }), owner = 9;
  const page = Object.fromEntries(ipc.OPERATIONS.map((name) => [name, (...args) => ipc.call(owner, name, ...args)]));
  const client = createEngineClient({ ...page, status: async () => service.status() });
  const fixture = JSON.parse(readFileSync(path.join(root, 'tests', 'fixtures', 'section-intervals', 'basic-four-intervals.json'), 'utf8')), raw = fixture.inputs;
  const typed = { u8: Uint8Array, i32le: Int32Array, u32le: Uint32Array };
  const expand = (buffer) => (buffer.runs ? buffer.runs.flatMap(([value, count]) => Array(count).fill(value)) : buffer.data);
  const put = async (bytes, dtype, shape) => {
    const { token } = await page.beginBuffer({ dtype, shape, byte_length: bytes.length, sha256: sha(bytes) });
    assert.equal((await page.appendBuffer(token, 0, bytes)).error, undefined);
    assert.equal((await page.commitBuffer(token)).error, undefined);
    return token;
  };
  const inputs = { settings: raw.settings };
  for (const name of ['labels', 'exclude', 'stack_offsets', 'stack_members']) {
    if (raw[name]) inputs[name] = await put(new Uint8Array(typed[raw[name].dtype].from(expand(raw[name])).buffer), raw[name].dtype, raw[name].shape);
  }
  for (const name of ['objects', 'classes', 'age_model', 'manual_indices']) { const bytes = Buffer.from(JSON.stringify(raw[name])); inputs[name] = await put(bytes, 'utf8json', [bytes.length]); }
  const target = uuid(), result = await client.run('section.intervals/1', { scope: 'section', target, revision: 3, inputs });
  assert.deepEqual(result.dimensions, fixture.expected.dimensions);
  assert.deepEqual(result.tables, {});
  assert.match(result.inputsKey, /^[0-9a-f]{64}$/);
  assert.deepEqual([result.provenance.method, result.provenance.scope, result.provenance.revision], ['section.intervals/1', 'section', 3]);
  const exact = new Set(['row_start', 'row_end', 'valid_count', 'bio_count', 'class_count', 'no_data', 'manual_BI', 'manual_ii', 'indices']);
  for (const [column, expected] of Object.entries(fixture.expected.columns)) {
    const actual = result.columns[column];
    assert.equal(actual.data.length, expected.data.length, column);
    expected.data.forEach((value, i) => {
      if (actual.valid && !actual.valid[i]) return;
      // The tolerance of the section-interval fixtures (1e-9, as tests/app/engine-ipc.test.mjs) for the columns that are not counts.
      if (exact.has(column)) assert.equal(actual.data[i], value, `${column}[${i}]`);
      else assert.ok(Math.abs(actual.data[i] - value) <= 1e-9, `${column}[${i}]: ${actual.data[i]} vs ${value}`);
    });
  }
  const again = await client.run('section.intervals/1', { scope: 'section', target, revision: 4, inputs });
  assert.equal(again.inputsKey, result.inputsKey, 'equal inputs give an equal key under another revision');
  await assert.rejects(client.run('section.intervals/1', { scope: 'core', target, revision: 5, inputs }), (error) => error.code === 'INVALID_REQUEST' && error.field === 'scope');
  ipc.releasePage(owner);
  assert.equal(service.status().state, 'ready');
});
