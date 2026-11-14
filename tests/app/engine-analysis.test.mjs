import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { analysisRevision, buildIntervalSnapshot, computeSectionBins, maskIdentity, referenceColumns, resultToBins } from '../../app/js/sectionanalysis.js';
import { createEngineClient, EngineError } from '../../app/js/engineclient.js';
import { createEngineAnalysis } from '../../app/js/engineanalysis.js';

const CLASSES = [{ id: 'a', name: 'A', counts: true }, { id: 'b', name: 'B', counts: true }, { id: 'n', name: 'N', counts: false }, { id: 'undet', name: 'undet', counts: true }];
const SETTINGS = { includePred: true, predThr: 0.5, countCandidates: true, binCm: 3.7, minValid: 20, noDataPad: 2 };
const MODEL = { depth: [0, 10, 40], age: [1, 2.5, 9], min: [0.5, 2, 8], max: [1.5, 3, 10] };
const project = (over = {}) => ({ classes: CLASSES, settings: { ...SETTINGS, ...over.settings }, ageModel: over.ageModel === undefined ? MODEL : over.ageModel, ageUnits: 'ka' });

/** A seeded section as the interface keeps it, with objects, predictions, exclusions, an overlap stack and a manual range. */
function section(seed, { w = 24, h = 90 } = {}) {
  let state = seed; const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const objects = new Map([[1, { id: 1, cls: 'a' }], [2, { id: 2, cls: 'b' }], [3, { id: 3, cls: 'n' }], [4, { id: 4, pred: 'a', conf: 0.7 }], [5, { id: 5, pred: 'b', conf: 0.3 }], [6, { id: 6 }]]);
  const labels = new Int32Array(w * h), exclude = new Uint8Array(w * h);
  for (let i = 0; i < labels.length; i++) { if (random() < 0.45) labels[i] = 1 + Math.floor(random() * 6); if (random() < 0.08) exclude[i] = 1; }
  for (let r = 40; r < 55; r++) exclude.fill(1, r * w, (r + 1) * w);     // a gap that the no-data padding widens
  labels[10] = 7; labels[11] = 7;                                         // an overlap stack made of objects 1 and 2
  return { w, h, roi: { x0: 2, y0: 3, x1: w - 1, y1: h - 4 }, top: 12.5, bottom: 77.25, units: 'cm', labels, exclude, objects,
    stacks: [null, null, null, null, null, null, null, [1, 2]], nextId: 8, manual: [{ from: 20, to: 30, BI: 3, ii: null }], _mv: 1 };
}

test('result columns convert to exactly the bins of the JavaScript calculation, with and without ages and overlap', () => {
  for (let seed = 1; seed <= 24; seed++) {
    const s = section(seed), p = project(seed % 3 === 0 ? { ageModel: null } : seed % 3 === 1 ? { ageModel: { depth: MODEL.depth, age: MODEL.age } } : {});
    if (seed % 4 === 0) s.stacks = [null];
    const reference = computeSectionBins(s, p).bins, converted = resultToBins(referenceColumns(s, p));
    assert.deepEqual(converted, reference, `seed ${seed}`);
    assert.ok(reference.some((b) => b.classPct.some((x) => x > 0)) && reference.some((b) => b.noData) && reference.some((b) => b.BI !== null), `seed ${seed} exercises classes, no-data and indices`);
  }
});

test('resultToBins rejects results it cannot interpret', () => {
  const good = referenceColumns(section(1), project());
  assert.throws(() => resultToBins({ ...good, dimensions: { ...good.dimensions, schemes: 3 } }), /two index schemes/);
  const { depth, ...missing } = good.columns;
  assert.throws(() => resultToBins({ dimensions: good.dimensions, columns: missing }), /Missing result column depth/);
});

test('the revision changes with every input of the calculation and with nothing else', () => {
  const base = () => section(5), p = project(), reference = analysisRevision(base(), p);
  assert.equal(analysisRevision(base(), p), reference, 'stable');
  const edits = {
    'mask version': (s) => { s._mv++; }, 'roi': (s) => { s.roi.y1--; }, 'top': (s) => { s.top += 1; }, 'bottom': (s) => { s.bottom += 1; }, 'units': (s) => { s.units = 'mm'; },
    'manual range': (s) => { s.manual[0].BI = 4; }, 'size': (s) => { s.w += 1; }, 'class assigned': (s) => { s.objects.get(6).cls = 'b'; },
    'prediction class': (s) => { s.objects.get(4).pred = 'b'; }, 'load warning': (s) => { s.loadWarnings = { region: true, mask: false }; },
  };
  for (const [name, edit] of Object.entries(edits)) { const s = base(); edit(s); assert.notEqual(analysisRevision(s, p), reference, name); }
  const settings = { includePred: false, predThr: 0.9, countCandidates: false, binCm: 4, minValid: 30, noDataPad: 3 };
  for (const [key, value] of Object.entries(settings)) assert.notEqual(analysisRevision(base(), project({ settings: { [key]: value } })), reference, `setting ${key}`);
  assert.notEqual(analysisRevision(base(), project({ ageModel: null })), reference, 'age model removed');
  assert.notEqual(analysisRevision(base(), project({ ageModel: { ...MODEL, age: [1, 2.5, 9.1] } })), reference, 'age value');
  assert.notEqual(analysisRevision(base(), project({ ageModel: { ...MODEL, depth: [0, 10, 41] } })), reference, 'age depth');
  assert.notEqual(analysisRevision(base(), { ...p, classes: [CLASSES[0], { ...CLASSES[1], counts: false }, ...CLASSES.slice(2)] }), reference, 'counted classes');
  assert.notEqual(analysisRevision(base(), { ...p, ageUnits: 'Ma' }), reference, 'age units');
  const untouched = base(); untouched.objects.get(1).name = 'renamed'; untouched.view = { zoom: 3 }; untouched.bins = [{}];
  assert.equal(analysisRevision(untouched, p), reference, 'display state is not an input');
});

// ---- the renderer client against an in-memory bridge -----------------------------------------------------------------

const TYPES = { u8: Uint8Array, i32le: Int32Array, u32le: Uint32Array, u64le: BigUint64Array, f64le: Float64Array };
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** A bridge that stores uploads, "analyses" by answering with the JavaScript reference, and serves downloads in ranges. */
function memoryBridge({ state = 'ready', answer = 'reference', failAt = null, override = {} } = {}) {
  const buffers = new Map(), released = [], calls = [], log = [];
  let reference = null, hold = null;
  const bridge = {
    buffers, released, calls, log,
    setReference: (value) => { reference = value; },
    holdAnalysis: () => new Promise((resolve) => { hold = resolve; }),
    status: async () => ({ state }),
    beginBuffer: async (descriptor) => { log.push('begin'); if (failAt === 'begin') return { error: { code: 'LIMIT_EXCEEDED', field: 'byte_length' } };
      const token = crypto.randomUUID(); buffers.set(token, { ...descriptor, data: new Uint8Array(descriptor.byte_length), next: 0, committed: false }); return { token }; },
    appendBuffer: async (token, offset, bytes) => { log.push('append'); const b = buffers.get(token); assert.equal(offset, b.next); assert.ok(bytes.length >= 1 && bytes.length <= 1048576);
      b.data.set(bytes, offset); b.next += bytes.length; return { next_offset: b.next }; },
    commitBuffer: async (token) => { log.push('commit'); const b = buffers.get(token); assert.equal(b.next, b.byte_length); assert.equal(sha(b.data), b.sha256); b.committed = true; return { token, byte_length: b.byte_length, sha256: b.sha256 }; },
    cancel: async (key) => { calls.push(['cancel', key]); return { state: 'requested' }; },
    release: async (tokens) => { released.push(...tokens); for (const t of tokens) buffers.delete(t); return { released: tokens.length }; },
    readBuffer: async (token, offset, length) => { const b = buffers.get(token); if (!b) return { error: { code: 'INVALID_BUFFER', field: 'token' } };
      return { offset, bytes: new Uint8Array(b.data.subarray(offset, offset + length)) }; },
    analyzeSection: async (request) => {
      calls.push(['analyze', request]);
      for (const token of Object.values(request.inputs)) if (!buffers.has(token)) return { error: { code: 'INVALID_BUFFER', field: 'token' } };
      if (hold) await new Promise((resolve) => { const done = hold; hold = null; done(() => resolve()); });
      if (answer === 'error') return { error: { code: 'UNSUPPORTED_INPUT', field: 'settings.roi' } };
      if (answer === 'cancelled') return { cancelled: true };
      // Every column in ONE buffer, each starting at a multiple of 8 bytes, with a layout (what the engine does).
      const layout = {}, parts = []; let size = 0;
      for (const [name, column] of Object.entries(reference.columns)) {
        const add = (key, dtype, values) => {
          const typed = TYPES[dtype].from(values, (v) => (dtype === 'u64le' ? BigInt(v) : v)), bytes = new Uint8Array(typed.buffer.slice(0));
          layout[key] = { dtype, shape: column.shape, offset: size, byte_length: bytes.length }; parts.push([size, bytes]); size += Math.ceil(bytes.length / 8) * 8;
        };
        add(name, column.dtype, column.data); if (column.valid) add(name + '_valid', 'u8', column.valid);
      }
      const packed = new Uint8Array(size), token = crypto.randomUUID();
      for (const [offset, bytes] of parts) packed.set(bytes, offset);
      buffers.set(token, { data: packed, byte_length: size, committed: true });
      const outputs = { result: { token, dtype: 'u8', shape: [size], byte_length: size, sha256: sha(packed) } };
      return { dimensions: reference.dimensions, outputs, layout: override.layout ? override.layout(layout) : layout, provenance: { engine_version: 'test' }, ...request, ...(override.outputs ? { outputs: override.outputs(outputs, buffers) } : {}) };
    },
  };
  return bridge;
}

test('the client uploads every input in bounded chunks, downloads the columns and releases every token', async () => {
  const s = section(3, { w: 600, h: 700 }), p = project(), bridge = memoryBridge();
  bridge.setReference(referenceColumns(s, p));
  const client = createEngineClient(bridge), snapshot = buildIntervalSnapshot(s, p);
  const result = await client.analyze(snapshot);
  assert.deepEqual(resultToBins(result), computeSectionBins(s, p).bins, 'the decoded result is the reference');
  const [, request] = bridge.calls.find(([kind]) => kind === 'analyze');
  assert.deepEqual(Object.keys(request.inputs).sort(), ['age_model', 'classes', 'exclude', 'labels', 'manual_indices', 'objects', 'settings', 'stack_members', 'stack_offsets']);
  assert.equal(request.method, 'section.intervals/1');
  assert.equal(request.settings_hash, sha(new TextEncoder().encode(JSON.stringify(snapshot.settings))), 'the settings hash is the hash of the settings buffer');
  assert.ok(bridge.log.filter((entry) => entry === 'append').length >= 2, 'the 1.6 MB label image went in more than one chunk');
  assert.equal(bridge.buffers.size, 0, 'nothing is left in the engine');
  assert.equal(bridge.released.length, 9 + 1, 'the nine inputs and the one packed result');
});

test('the result comes back as one packed buffer that the client reads in one go and cuts up by its layout', async () => {
  const s = section(3, { w: 600, h: 700 }), p = project(), bridge = memoryBridge(); bridge.setReference(referenceColumns(s, p));
  const reads = []; const read = bridge.readBuffer; bridge.readBuffer = async (token, offset, length) => { reads.push([offset, length]); return read(token, offset, length); };
  const result = await createEngineClient(bridge).analyze(buildIntervalSnapshot(s, p));
  const reference = referenceColumns(s, p);
  assert.deepEqual(Object.keys(result.columns), Object.keys(reference.columns), 'every column of the contract, in order');
  for (const [name, column] of Object.entries(reference.columns)) {
    assert.deepEqual(result.columns[name].data, column.data, name);
    assert.deepEqual(result.columns[name].valid, column.valid, `${name} validity`);
  }
  assert.ok(reads.length <= 2, `about one read for the whole result, not one per column (${reads.length})`);
});

test('a packed result whose layout is wrong is an internal error, never data', async () => {
  const s = section(3), p = project();
  const cases = {
    'a column that overlaps the previous one': (layout) => ({ ...layout, depth: { ...layout.depth, offset: layout.depth_top.offset } }),
    'a column that starts off a multiple of 8': (layout) => ({ ...layout, depth: { ...layout.depth, offset: layout.depth.offset + 4 } }),
    'a column past the end of the buffer': (layout) => ({ ...layout, depth: { ...layout.depth, offset: 1 << 20 } }),
    'a shape that does not match the length': (layout) => ({ ...layout, depth: { ...layout.depth, shape: [layout.depth.shape[0] + 1] } }),
    'an unknown type': (layout) => ({ ...layout, depth: { ...layout.depth, dtype: 'f32le' } }),
    'an empty column': (layout) => ({ ...layout, depth: { ...layout.depth, byte_length: 0 } }),
    'a layout of the wrong kind': () => 'depth',
  };
  for (const [label, layout] of Object.entries(cases)) {
    const bridge = memoryBridge({ override: { layout } }); bridge.setReference(referenceColumns(s, p));
    await assert.rejects(createEngineClient(bridge).analyze(buildIntervalSnapshot(s, p)), (error) => error instanceof EngineError && error.code === 'INTERNAL', label);
    assert.equal(bridge.buffers.size, 0, `${label}: everything was released`);
  }
  const hashed = memoryBridge({ override: { outputs: (outputs) => ({ result: { ...outputs.result, sha256: 'f'.repeat(64) } }) } }); hashed.setReference(referenceColumns(s, p));
  await assert.rejects(createEngineClient(hashed).analyze(buildIntervalSnapshot(s, p)), { code: 'INTERNAL', field: 'result' }, 'a hash that does not match the bytes');
  const two = memoryBridge({ override: { outputs: (outputs) => ({ ...outputs, extra: outputs.result }) } }); two.setReference(referenceColumns(s, p));
  await assert.rejects(createEngineClient(two).analyze(buildIntervalSnapshot(s, p)), { code: 'INTERNAL' }, 'a second output');
});

test('a section without overlap sends no stack_members buffer', async () => {
  const s = section(2); s.stacks = [null]; s.labels.fill(0);
  const bridge = memoryBridge(); bridge.setReference(referenceColumns(s, project()));
  await createEngineClient(bridge).analyze(buildIntervalSnapshot(s, project()));
  assert.ok(!('stack_members' in bridge.calls.find(([kind]) => kind === 'analyze')[1].inputs));
});

test('engine failures reach the caller as an EngineError and every uploaded token is still released', async () => {
  const s = section(4), p = project();
  const failing = memoryBridge({ answer: 'error' }), client = createEngineClient(failing);
  await assert.rejects(client.analyze(buildIntervalSnapshot(s, p)), (error) => error instanceof EngineError && error.code === 'UNSUPPORTED_INPUT' && error.field === 'settings.roi');
  assert.equal(failing.buffers.size, 0);
  const limited = memoryBridge({ failAt: 'begin' });
  await assert.rejects(createEngineClient(limited).analyze(buildIntervalSnapshot(s, p)), { code: 'LIMIT_EXCEEDED', field: 'byte_length' });
  const cancelled = memoryBridge({ answer: 'cancelled' });
  await assert.rejects(createEngineClient(cancelled).analyze(buildIntervalSnapshot(s, p)), { name: 'AbortError' });
  assert.equal(cancelled.buffers.size, 0);
});

test('an unavailable engine is an error before anything is uploaded, never a silent fallback', async () => {
  for (const state of ['unavailable', 'disabled']) {
    const bridge = memoryBridge({ state });
    await assert.rejects(createEngineClient(bridge).analyze(buildIntervalSnapshot(section(1), project())), { code: 'ENGINE_UNAVAILABLE' }, state);
    assert.deepEqual(bridge.log, []);
    let polls = 0; const status = bridge.status; bridge.status = async () => { polls++; return status(); };
    await assert.rejects(createEngineClient(bridge, { readyTimeoutMs: 5000 }).analyze(buildIntervalSnapshot(section(1), project())), { code: 'ENGINE_UNAVAILABLE' });
    assert.equal(polls, 1, `${state}: a failed engine is reported at once, without waiting`);
  }
});

test('the client waits for an engine that is still starting', async () => {
  const bridge = memoryBridge(); bridge.setReference(referenceColumns(section(1), project()));
  let polls = 0; bridge.status = async () => ({ state: ++polls < 3 ? 'starting' : 'ready' });
  await createEngineClient(bridge).analyze(buildIntervalSnapshot(section(1), project()));
  assert.equal(polls, 3);
  const never = memoryBridge({ state: 'starting' });
  await assert.rejects(createEngineClient(never, { readyTimeoutMs: 250 }).analyze(buildIntervalSnapshot(section(1), project())), { code: 'ENGINE_UNAVAILABLE' });
});

test('aborting a running analysis cancels it in the engine and releases the uploads', async () => {
  const s = section(6), p = project(), bridge = memoryBridge(); bridge.setReference(referenceColumns(s, p));
  const controller = new AbortController(), release = bridge.holdAnalysis();
  const running = createEngineClient(bridge).analyze(buildIntervalSnapshot(s, p), { signal: controller.signal });
  const resume = await release;   // the engine has the request
  controller.abort(); resume();
  await assert.rejects(running, { name: 'AbortError' });
  const [, key] = bridge.calls.find(([kind]) => kind === 'cancel');
  assert.equal(key, bridge.calls.find(([kind]) => kind === 'analyze')[1].requestKey, 'the engine was asked to cancel this very request');
  assert.equal(bridge.buffers.size, 0);
});

test('a download answer for another range or of the wrong length is rejected', async () => {
  for (const tamper of [(r, offset) => ({ ...r, offset: offset + 1 }), (r) => ({ ...r, bytes: r.bytes.subarray(1) }), (r) => ({ ...r, bytes: Array.from(r.bytes) })]) {
    const s = section(7), p = project(), bridge = memoryBridge(); bridge.setReference(referenceColumns(s, p));
    const read = bridge.readBuffer; bridge.readBuffer = async (token, offset, length) => tamper(await read(token, offset, length), offset);
    await assert.rejects(createEngineClient(bridge).analyze(buildIntervalSnapshot(s, p)), { code: 'INTERNAL' });
  }
});

test('a corrupted download is rejected', async () => {
  const s = section(7), p = project(), bridge = memoryBridge(); bridge.setReference(referenceColumns(s, p));
  const read = bridge.readBuffer; bridge.readBuffer = async (...args) => { const r = await read(...args); if (r.bytes) r.bytes[0] ^= 1; return r; };
  await assert.rejects(createEngineClient(bridge).analyze(buildIntervalSnapshot(s, p)), { code: 'INTERNAL' });
  assert.equal(bridge.buffers.size, 0);
});

// ---- publication rules ------------------------------------------------------------------------------------------------

/** A client that answers from the JavaScript reference, optionally waiting for the test to let each call finish. */
function manualClient(p) {
  const pending = [];
  return { pending, analyze: (snapshot, { signal }) => new Promise((resolve, reject) => {
    const entry = { snapshot, signal, finish: (value) => resolve(value), fail: (error) => reject(error) };
    signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })));
    pending.push(entry);
  }) };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('a result is published only for the revision that was requested and older revisions are never shown', async () => {
  const s = section(8), p = project(), client = manualClient(p), changes = [];
  const analysis = createEngineAnalysis({ client, project: () => p, onChange: (x) => changes.push(x) });
  s.bins = [{ stale: true }];
  const first = analysis.request(s);
  assert.deepEqual(s.bins, [], 'while waiting, the section shows no bins');
  assert.deepEqual(s.analysis, { state: 'pending' });
  await flush(); assert.equal(client.pending.length, 1);
  s._mv++;                                              // the user edits the mask while the engine works
  const second = analysis.request(s);
  assert.equal(client.pending[0].signal.aborted, true, 'the older request is cancelled');
  assert.deepEqual(s.bins, []);
  client.pending[0].finish(referenceColumns(section(8), p));   // a late answer for the old revision
  await first; assert.deepEqual(s.bins, [], 'the old answer changes nothing'); assert.equal(changes.length, 0);
  await flush(); assert.equal(client.pending.length, 2);
  client.pending[1].finish(referenceColumns(s, p));
  await second;
  assert.deepEqual(s.bins, computeSectionBins(s, p).bins);
  assert.deepEqual(s.analysis, { state: 'ready' }); assert.deepEqual(changes, [s]);
});

test('a result that finishes after the section changed again is discarded', async () => {
  const s = section(9), p = project(), client = manualClient(p), changes = [];
  const analysis = createEngineAnalysis({ client, project: () => p, onChange: (x) => changes.push(x) });
  const done = analysis.request(s); await flush();
  s.roi.y1--;                                           // changed, but no new request yet (the next render has not asked)
  client.pending[0].finish(referenceColumns(section(9), p));
  await done;
  assert.deepEqual(s.bins, []); assert.equal(changes.length, 0);
  assert.deepEqual(s.analysis, { state: 'pending' }, 'still waiting for a result of the current revision');
});

test('an unchanged revision does not start a second analysis, and a finished one is not repeated', async () => {
  const s = section(10), p = project(), client = manualClient(p);
  const analysis = createEngineAnalysis({ client, project: () => p, onChange() {} });
  const a = analysis.request(s), b = analysis.request(s); await flush();
  assert.equal(client.pending.length, 1, 'two requests for one revision are one analysis');
  client.pending[0].finish(referenceColumns(s, p)); await Promise.all([a, b]);
  await analysis.request(s); await flush();
  assert.equal(client.pending.length, 1, 'the ready result is reused');
  assert.equal(s.analysis.state, 'ready');
});

test('a failure is shown as an error state with no bins and no JavaScript calculation, until an edit or a retry', async () => {
  const s = section(11), p = project(), calls = [];
  const client = { analyze: async () => { calls.push(1); throw new EngineError('LIMIT_EXCEEDED', 'byte_length'); } };
  const analysis = createEngineAnalysis({ client, project: () => p, onChange() {} });
  await analysis.request(s);
  assert.deepEqual(s.analysis, { state: 'error', code: 'LIMIT_EXCEEDED', field: 'byte_length' }); assert.deepEqual(s.bins, []); assert.equal(s._rc, undefined, 'the JavaScript row counts were not built');
  await analysis.request(s); assert.equal(calls.length, 1, 'the same revision is not retried on every render');
  s._mv++; await analysis.request(s); assert.equal(calls.length, 2, 'an edit tries again');
  analysis.retry(s); await analysis.request(s); assert.equal(calls.length, 3, 'so does an explicit retry');
  const odd = createEngineAnalysis({ client: { analyze: async () => { throw new Error('boom'); } }, project: () => p, onChange() {} });
  const t = section(12); await odd.request(t);
  assert.deepEqual(t.analysis, { state: 'error', code: 'INTERNAL', field: null }, 'an unexpected error never leaks its message');
});

test('sections are analysed one at a time, in request order', async () => {
  const p = project(), client = manualClient(p), sections = [section(1), section(2), section(3)];
  const analysis = createEngineAnalysis({ client, project: () => p, onChange() {} });
  const all = analysis.all(sections); await flush();
  assert.equal(client.pending.length, 1, 'only the first is with the engine');
  for (let i = 0; i < 3; i++) { await flush(); assert.equal(client.pending.length, i + 1); client.pending[i].finish(referenceColumns(sections[i], p)); }
  await all;
  sections.forEach((s) => assert.equal(s.analysis.state, 'ready'));
  assert.deepEqual(sections.map((s) => s.bins.length > 0), [true, true, true]);
});

test('a request that was replaced while it waited in the queue never reaches the engine', async () => {
  const p = project(), client = manualClient(p), a = section(1), b = section(2);
  const analysis = createEngineAnalysis({ client, project: () => p, onChange() {} });
  void analysis.request(a); void analysis.request(b); await flush();
  b._mv++; const current = analysis.request(b);         // b changes while a is still running
  client.pending[0].finish(referenceColumns(a, p)); await flush(); await flush();
  assert.equal(client.pending.length, 2, 'one request for b, the current one');
  assert.equal(client.pending[1].snapshot.settings.width, b.w);
  client.pending[1].finish(referenceColumns(b, p)); await current;   // the promise of the request that is current, not of the replaced one
  assert.equal(b.analysis.state, 'ready');
});

test('a section whose inputs change without a new request is analysed again instead of staying pending', async () => {
  const s = section(13), p = project(), client = manualClient(p), changes = [];
  const analysis = createEngineAnalysis({ client, project: () => p, onChange: (x) => changes.push(x) });
  void analysis.request(s); await flush();          // one plain request: nobody calls again afterwards
  s.roi.y1--;                                           // the inputs change behind the controller's back
  client.pending[0].finish(referenceColumns(section(13), p));   // the old answer arrives and is discarded
  for (let i = 0; i < 10 && client.pending.length < 2; i++) await flush();
  assert.equal(client.pending.length, 2, 'a fresh request for the new revision was made by itself');
  client.pending[1].finish(referenceColumns(s, p));
  for (let i = 0; i < 10 && s.analysis.state !== 'ready'; i++) await flush();
  assert.deepEqual(s.analysis, { state: 'ready' });
  assert.deepEqual(s.bins, computeSectionBins(s, p).bins, 'the published bins are those of the new revision');
});

test('analyzeSections does not resolve while a section it awaits is still waiting for its newest revision', async () => {
  const s = section(14), p = project(), client = manualClient(p);
  const analysis = createEngineAnalysis({ client, project: () => p, onChange() {} });
  let resolved = false;
  const all = analysis.all([s]).then(() => { resolved = true; }); await flush();
  s.roi.y1--;
  client.pending[0].finish(referenceColumns(section(14), p));
  for (let i = 0; i < 10 && client.pending.length < 2; i++) await flush();
  await flush(); await flush();
  assert.equal(resolved, false, 'the old revision was discarded and the new one is not done');
  client.pending[1].finish(referenceColumns(s, p));
  await all;
  assert.deepEqual(s.analysis, { state: 'ready' });
});

// ---- inputs that stay in the engine between analyses (card M8.4.2) -----------------------------------------------------

const begins = (bridge) => bridge.log.filter((entry) => entry === 'begin').length;
const analysesOf = (bridge) => bridge.calls.filter(([kind]) => kind === 'analyze').map(([, request]) => request);
/** One analysis the way engineanalysis.js makes it: masks only when the engine does not have them for this mask identity. */
async function analyseResident(client, bridge, s, p) {
  bridge.setReference(referenceColumns(s, p));
  const maskKey = maskIdentity(s), masks = !client.hasMasks(s, maskKey);
  return client.analyze(buildIntervalSnapshot(s, p, { masks }), { owner: s, maskKey });
}

test('a snapshot built without masks carries no mask buffer and the same tables', () => {
  const s = section(3), p = project(), full = buildIntervalSnapshot(s, p), light = buildIntervalSnapshot(s, p, { masks: false });
  for (const name of ['labels', 'exclude', 'stack_offsets', 'stack_members']) assert.equal(light[name], null, name);
  for (const name of ['objects', 'classes', 'settings', 'age_model', 'manual_indices']) assert.deepEqual(light[name], full[name], name);
});

test('the mask identity moves with the mask version, the size and the stack table, and with nothing else', () => {
  const base = maskIdentity(section(5));
  assert.equal(maskIdentity(section(5)), base);
  const edits = { version: (s) => { s._mv++; }, width: (s) => { s.w++; }, height: (s) => { s.h++; }, stack: (s) => { s.stacks.push([1]); }, member: (s) => { s.stacks[7].push(3); } };
  for (const [name, edit] of Object.entries(edits)) { const s = section(5); edit(s); assert.notEqual(maskIdentity(s), base, name); }
  const s = section(5); s.roi.y1--; s.top += 1; s.objects.get(1).cls = 'b'; s.manual.length = 0;
  assert.equal(maskIdentity(s), base, 'settings, objects and ROI are not part of the masks');
});

test('after the first analysis, a change of interval size uploads only the settings table and keeps everything else in the engine', async () => {
  const s = section(3, { w: 600, h: 700 }), p = project(), bridge = memoryBridge(), client = createEngineClient(bridge);
  const first = await analyseResident(client, bridge, s, p);
  assert.deepEqual(resultToBins(first), computeSectionBins(s, p).bins);
  assert.equal(begins(bridge), 9, 'four masks and five tables the first time');
  assert.equal(bridge.buffers.size, 9, 'the nine inputs stay in the engine; only the result columns were released');
  const held = new Set(bridge.buffers.keys());
  bridge.log.length = 0;
  const q = project({ settings: { binCm: 5.3 } });
  const second = await analyseResident(client, bridge, s, q);
  assert.deepEqual(resultToBins(second), computeSectionBins(s, q).bins, 'the new interval size is the one analysed');
  assert.equal(begins(bridge), 1, 'only the settings table is uploaded');
  assert.equal(bridge.log.filter((entry) => entry === 'append').length, 1);
  assert.equal(bridge.buffers.size, 9, 'still nine inputs, the old settings replaced by the new');
  const request = analysesOf(bridge)[1];
  const reused = ['labels', 'exclude', 'stack_offsets', 'stack_members', 'objects', 'classes', 'age_model', 'manual_indices'];
  for (const name of reused) assert.ok(held.has(request.inputs[name]), `${name} is the buffer that was already in the engine`);
  assert.ok(!held.has(request.inputs.settings), 'settings is new');
  assert.equal(request.settings_hash, sha(new TextEncoder().encode(JSON.stringify(buildIntervalSnapshot(s, q, { masks: false }).settings))));
});

test('a repeated analysis with nothing changed uploads nothing', async () => {
  const s = section(3), p = project(), bridge = memoryBridge(), client = createEngineClient(bridge);
  await analyseResident(client, bridge, s, p); bridge.log.length = 0;
  await analyseResident(client, bridge, s, p);
  assert.equal(begins(bridge), 0);
});

test('a changed mask version uploads the four masks again and releases the ones they replace', async () => {
  const s = section(3), p = project(), bridge = memoryBridge(), client = createEngineClient(bridge);
  await analyseResident(client, bridge, s, p);
  const oldMasks = analysesOf(bridge)[0].inputs; bridge.released.length = 0; bridge.log.length = 0;
  s._mv++; s.labels[200] = 2;
  const result = await analyseResident(client, bridge, s, p);
  assert.deepEqual(resultToBins(result), computeSectionBins(s, p).bins);
  assert.equal(begins(bridge), 4, 'labels, exclude and the two stack tables; the five tables are unchanged');
  for (const name of ['labels', 'exclude', 'stack_offsets', 'stack_members']) assert.ok(bridge.released.includes(oldMasks[name]), `old ${name} released`);
  assert.equal(bridge.buffers.size, 9);
  assert.ok(!client.hasMasks(s, 'an older identity'));
  assert.ok(client.hasMasks(s, maskIdentity(s)));
});

test('a snapshot without masks is refused when the engine does not hold them', async () => {
  const s = section(3), p = project(), bridge = memoryBridge(), client = createEngineClient(bridge);
  bridge.setReference(referenceColumns(s, p));
  await assert.rejects(client.analyze(buildIntervalSnapshot(s, p, { masks: false }), { owner: s, maskKey: maskIdentity(s) }), { code: 'RESIDENT_LOST' });
  assert.equal(bridge.log.length, 0, 'nothing was uploaded');
  await analyseResident(client, bridge, s, p);
  s._mv++;                                                              // the held masks are for another identity
  await assert.rejects(client.analyze(buildIntervalSnapshot(s, p, { masks: false }), { owner: s, maskKey: maskIdentity(s) }), { code: 'RESIDENT_LOST' });
});

test('buffers the engine no longer knows (it restarted) make the analysis ask for a full snapshot, and the section recovers', async () => {
  const s = section(3), p = project(), bridge = memoryBridge(), client = createEngineClient(bridge);
  const answer = bridge.analyzeSection;
  bridge.analyzeSection = async (request) => {
    for (const token of Object.values(request.inputs)) if (!bridge.buffers.has(token)) return { error: { code: 'INVALID_BUFFER', field: 'token' } };
    bridge.setReference(referenceColumns(s, p)); return answer(request);
  };
  const analysis = createEngineAnalysis({ client, project: () => p, onChange() {} });
  await analysis.request(s);
  assert.equal(s.analysis.state, 'ready');
  bridge.buffers.clear();                                               // a new engine session: every old buffer is gone
  s.roi.y1--; bridge.log.length = 0;                                    // only the interval table changes, so the masks would be reused
  await analysis.request(s);
  assert.equal(s.analysis.state, 'ready', 'the section recovered by itself');
  assert.deepEqual(s.bins, computeSectionBins(s, p).bins);
  assert.equal(begins(bridge), 10, 'the failed attempt had uploaded the new settings table; then all nine inputs went up again');
  assert.equal(bridge.buffers.size, 9, 'and nothing from the failed attempt is left behind');
  assert.equal(analysesOf(bridge).length, 2, 'the first analysis and the full one (the refused attempt is answered before the recording function)');
});

test('the least recently used section is dropped when the byte budget is full, and the section in use is never dropped', async () => {
  const a = section(1, { w: 40, h: 50 }), b = section(2, { w: 40, h: 50 }), c = section(3, { w: 40, h: 50 }), p = project();
  const bridge = memoryBridge(), perSection = 40 * 50 * 5 + 100;       // labels and exclude dominate; the small tables are well below this
  const client = createEngineClient(bridge, { residentBytes: perSection * 2 + 4000 });
  await analyseResident(client, bridge, a, p); await analyseResident(client, bridge, b, p);
  assert.equal(client.residentSections(), 2);
  await analyseResident(client, bridge, a, p);                          // a was used last: b is the oldest
  await analyseResident(client, bridge, c, p);
  assert.ok(client.hasMasks(a, maskIdentity(a)) && client.hasMasks(c, maskIdentity(c)), 'a and c are resident');
  assert.ok(!client.hasMasks(b, maskIdentity(b)), 'b was dropped');
  assert.ok(client.residentBytes() <= perSection * 2 + 4000);
  assert.equal(bridge.buffers.size, client.residentSections() * 9, 'the engine holds exactly what the client says it holds');
});

test('a section too large to keep is analysed and then released completely', async () => {
  const s = section(3), p = project(), bridge = memoryBridge(), client = createEngineClient(bridge, { residentBytes: 1000 });
  const result = await analyseResident(client, bridge, s, p);
  assert.deepEqual(resultToBins(result), computeSectionBins(s, p).bins);
  assert.equal(bridge.buffers.size, 0);
  assert.equal(client.residentSections(), 0);
  assert.ok(!client.hasMasks(s, maskIdentity(s)));
});

test('at most the configured number of sections stays resident', async () => {
  const bridge = memoryBridge(), client = createEngineClient(bridge, { residentSections: 3 }), p = project(), sections = [1, 2, 3, 4, 5].map((n) => section(n, { w: 20, h: 40 }));
  for (const s of sections) await analyseResident(client, bridge, s, p);
  assert.equal(client.residentSections(), 3);
  assert.deepEqual(sections.map((s) => client.hasMasks(s, maskIdentity(s))), [false, false, true, true, true]);
  assert.equal(bridge.buffers.size, 27);
});

test('the engine reporting a full budget makes the client drop other sections and try once more', async () => {
  const a = section(1, { w: 20, h: 40 }), b = section(2, { w: 20, h: 40 }), p = project(), bridge = memoryBridge(), client = createEngineClient(bridge);
  await analyseResident(client, bridge, a, p);
  const begin = bridge.beginBuffer; let refused = 0;
  bridge.beginBuffer = async (descriptor) => { if (refused < 1 && bridge.buffers.size >= 9) { refused++; return { error: { code: 'LIMIT_EXCEEDED', field: 'byte_length' } }; } return begin(descriptor); };
  const result = await analyseResident(client, bridge, b, p);
  assert.equal(refused, 1);
  assert.deepEqual(resultToBins(result), computeSectionBins(b, p).bins);
  assert.ok(!client.hasMasks(a, maskIdentity(a)), 'a was dropped to make room');
  assert.ok(client.hasMasks(b, maskIdentity(b)));
});

test('an analysis that fails or is aborted keeps what was resident and releases what it uploaded', async () => {
  const s = section(3), p = project(), bridge = memoryBridge(), client = createEngineClient(bridge);
  await analyseResident(client, bridge, s, p);
  const before = new Set(bridge.buffers.keys());
  s._mv++;
  const answer = bridge.analyzeSection; bridge.analyzeSection = async () => ({ error: { code: 'UNSUPPORTED_INPUT', field: 'settings.roi' } });
  await assert.rejects(analyseResident(client, bridge, s, p), { code: 'UNSUPPORTED_INPUT' });
  assert.deepEqual(new Set(bridge.buffers.keys()), before, 'the new masks were released, the old ones are still there');
  bridge.analyzeSection = answer;
  const controller = new AbortController(); bridge.setReference(referenceColumns(s, p));
  const running = client.analyze(buildIntervalSnapshot(s, p), { owner: s, maskKey: maskIdentity(s), signal: controller.signal });
  controller.abort();
  await assert.rejects(running, { name: 'AbortError' });
  assert.deepEqual(new Set(bridge.buffers.keys()), before);
  assert.ok(!client.hasMasks(s, maskIdentity(s)), 'the held masks belong to the older identity');
});

test('forget and releaseAll hand every resident buffer back to the engine', async () => {
  const a = section(1, { w: 20, h: 40 }), b = section(2, { w: 20, h: 40 }), p = project(), bridge = memoryBridge(), client = createEngineClient(bridge);
  await analyseResident(client, bridge, a, p); await analyseResident(client, bridge, b, p);
  client.forget(a); await flush();
  assert.equal(bridge.buffers.size, 9);
  client.releaseAll(); await flush();
  assert.equal(bridge.buffers.size, 0);
  assert.equal(client.residentSections(), 0);
});

test('through the analysis controller: an interval change reuses the masks, an edit does not, and every result is the reference', async () => {
  const s = section(3, { w: 300, h: 400 }); let p = project(), uploadedMasks = 0;
  const bridge = memoryBridge(), client = createEngineClient(bridge);
  const answer = bridge.analyzeSection;
  bridge.analyzeSection = async (request) => { bridge.setReference(referenceColumns(s, p)); return answer(request); };
  const begin = bridge.beginBuffer; bridge.beginBuffer = async (descriptor) => { if (descriptor.dtype !== 'utf8json') uploadedMasks++; return begin(descriptor); };
  const analysis = createEngineAnalysis({ client, project: () => p, onChange() {} });
  await analysis.request(s);
  assert.equal(uploadedMasks, 4); assert.deepEqual(s.bins, computeSectionBins(s, p).bins);
  p = project({ settings: { binCm: 6.1 } }); await analysis.request(s);
  assert.equal(uploadedMasks, 4, 'the interval size changed: no mask went up');
  assert.deepEqual(s.bins, computeSectionBins(s, p).bins);
  s._mv++; s.labels[500] = 3; await analysis.request(s);
  assert.equal(uploadedMasks, 8, 'a mask edit uploads the masks');
  assert.deepEqual(s.bins, computeSectionBins(s, p).bins);
  analysis.forget(s); await flush();
  assert.equal(bridge.buffers.size, 0, 'closing a section releases everything it held');
});
