// Card M8.5.8: per-core row ages from `core.ages/1` (engineages.js + coredata.js hook).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngineAges } from '../../app/js/engineages.js';
import { mergeCoreData } from '../../app/js/coredata.js';

function fakeClient(handler) {
  let runCalls = 0, ensureCalls = 0, forgetCalls = 0;
  const restarts = [];
  const client = {
    async ensureTable(_owner, key, snapshot) {
      ensureCalls++;
      return { identity: snapshot.identity, meta: `${key}:meta`, values: `${key}:val`, valid: `${key}:ok` };
    },
    async run(method, req, opts) {
      runCalls++;
      return handler(method, req, opts, runCalls);
    },
    forget() { forgetCalls++; },
    async restart(opts) { restarts.push(opts); },
  };
  return { client, stats: () => ({ runCalls, ensureCalls, forgetCalls, restarts }) };
}

// Wait until the engine request has reached the fake client, instead of a fixed sleep: under a loaded full test run a fixed
// 10 ms was not always enough for the request chain to call `client.run` (Q16 session, 26 Nov 2026). Bounded by event-loop turns.
async function until(ready, what) {
  for (let turn = 0; turn < 10000; turn++) { if (ready()) return; await new Promise((r) => setImmediate(r)); }
  throw new Error(`never happened: ${what}`);
}

function makeCore(model) {
  return {
    units: 'm',
    sections: [],
    records: [],
    ageModel: { text: '0,0\n10,100', units: 'ka', model },
    imp: { depth: [0, 5, 10, 15], age: [null, 999, null, null], proxies: { Ca: [1, 2, 3, 4] } },
    user: {},
    depth: null,
    age: null,
    proxies: {},
    src: {},
    ageText: '',
  };
}

test('M8.5.8: engineages computes row ages, preserves imported ages, caches unchanged inputs, and never runs JS fallback while pending', async () => {
  let resolveRun;
  const { client, stats } = fakeClient((method, req) => {
    assert.equal(method, 'core.ages/1');
    assert.equal(req.scope, 'core');
    assert.equal(req.priority, 'interactive');
    assert.deepEqual(req.inputs.settings, { version: 1 });
    return new Promise((resolve) => {
      resolveRun = () => resolve({
        tables: { ages: [{ name: 'age', unit: 'ka', values: [0, 50, 100, null] }] },
        summary: { rows: 4, outside: 1 },
      });
    });
  });
  const published = [];
  const engineAges = createEngineAges({ client, onPublish: (c) => published.push(c) });
  const core = makeCore({ depth: [0, 10], age: [0, 100] });

  mergeCoreData(core, {
    resolveAges: (c, req) => { void engineAges.request(c, req); },
    clearAges: (c) => engineAges.clear(c),
  });
  assert.deepEqual(core.ageAnalysis, { state: 'pending' });
  assert.deepEqual(core.age, [null, 999, null, null], 'while pending, only imported ages are shown (no JS interpolation)');
  await until(() => resolveRun, 'client.run called');
  resolveRun();
  await engineAges.all([core]);
  assert.deepEqual(core.ageAnalysis, { state: 'ready', summary: { rows: 4, outside: 1 } });
  assert.deepEqual(core.age, [0, 999, 100, null], 'imported age at row 1 is preserved; engine ages fill missing slots');
  assert.equal(published.length, 1);
  assert.equal(stats().runCalls, 1);

  // Unchanged inputs hit cache synchronously without another engine call.
  mergeCoreData(core, {
    resolveAges: (c, req) => { void engineAges.request(c, req); },
    clearAges: (c) => engineAges.clear(c),
  });
  await engineAges.all([core]);
  assert.equal(stats().runCalls, 1, 'unchanged inputs reuse the cached ready result');
  assert.deepEqual(core.age, [0, 999, 100, null]);
});

test('M8.5.8: superseding revision aborts older request and publishes only the latest revision', async () => {
  const resolvers = [], signals = [], targets = [], revisions = [];
  const { client } = fakeClient((_method, req, opts) => {
    targets.push(req.target);
    revisions.push(req.revision);
    signals.push(opts.signal);
    return new Promise((resolve) => resolvers.push(resolve));
  });
  const engineAges = createEngineAges({ client });
  const core = makeCore({ depth: [0, 10], age: [0, 100] });

  const p1 = engineAges.request(core, { depths: [0, 5], importedAges: [null, null], model: { depth: [0, 10], age: [0, 100] } });
  await until(() => resolvers.length === 1, 'first request reached client.run');
  const p2 = engineAges.request(core, { depths: [0, 5], importedAges: [null, null], model: { depth: [0, 10], age: [0, 200] } });
  await until(() => resolvers.length === 2, 'second request reached client.run');

  assert.equal(signals[0].aborted, true, 'first request was aborted when superseded');
  assert.equal(targets[0], targets[1], 'same core keeps one session-local target UUID');
  assert.deepEqual(revisions, [1, 2]);

  // Resolve stale job first — must not publish.
  resolvers[0]({ tables: { ages: [{ name: 'age', unit: 'ka', values: [0, 50] }] }, summary: { rows: 2, outside: 0 } });
  await p1;
  assert.equal(core.ageAnalysis.state, 'pending');

  // Resolve current job — publishes.
  resolvers[1]({ tables: { ages: [{ name: 'age', unit: 'ka', values: [0, 100] }] }, summary: { rows: 2, outside: 0 } });
  await p2;
  assert.equal(core.ageAnalysis.state, 'ready');
  assert.deepEqual(core.age, [0, 100]);
});

test('M8.5.8: error state is visible with no JS fallback, and restartAndRetry recovers', async () => {
  let fail = true;
  const notices = [];
  const { client, stats } = fakeClient(() => {
    if (fail) return Promise.reject(Object.assign(new Error('down'), { code: 'ENGINE_UNAVAILABLE', field: null }));
    return Promise.resolve({ tables: { ages: [{ name: 'age', unit: 'ka', values: [0, 50, 100, null] }] }, summary: { rows: 4, outside: 1 } });
  });
  client.restart = async (opts) => {
    stats().restarts.push(opts);
    if (opts.automatic) throw Object.assign(new Error('refused'), { code: 'LIMIT_EXCEEDED' });
  };
  const engineAges = createEngineAges({ client, onNotice: (k) => notices.push(k) });
  const core = makeCore({ depth: [0, 10], age: [0, 100] });

  mergeCoreData(core, { resolveAges: (c, req) => { void engineAges.request(c, req); }, clearAges: (c) => engineAges.clear(c) });
  await engineAges.all([core]);
  assert.deepEqual(core.ageAnalysis, { state: 'error', code: 'ENGINE_UNAVAILABLE', field: null });
  assert.deepEqual(core.age, [null, 999, null, null], 'on error, never falls back to JavaScript calculation');

  fail = false;
  await engineAges.restartAndRetry([core]);
  assert.equal(core.ageAnalysis.state, 'ready');
  assert.deepEqual(core.age, [0, 999, 100, null]);
  assert.deepEqual(stats().restarts, [{ automatic: true }, { automatic: false }]);
});

test('M8.5.8: automatic recovery on INVALID_BUFFER and ENGINE_UNAVAILABLE, plus releaseAll cancellation', async () => {
  const notices = [];
  const { client, stats } = fakeClient((_method, _req, _opts, call) => {
    if (call === 1) return Promise.reject(Object.assign(new Error('lost'), { code: 'INVALID_BUFFER' }));
    if (call === 2) return Promise.reject(Object.assign(new Error('died'), { code: 'ENGINE_UNAVAILABLE' }));
    return Promise.resolve({ tables: { ages: [{ name: 'age', unit: 'ka', values: [10, 20] }] }, summary: { rows: 2, outside: 0 } });
  });
  const engineAges = createEngineAges({ client, onNotice: (k) => notices.push(k) });
  const core = makeCore({ depth: [0, 10], age: [10, 20] });

  await engineAges.request(core, { depths: [0, 10], importedAges: [null, null], model: { depth: [0, 10], age: [10, 20] } });
  assert.equal(core.ageAnalysis.state, 'ready');
  assert.deepEqual(core.age, [10, 20]);
  assert.equal(stats().forgetCalls, 1);
  assert.deepEqual(stats().restarts, [{ automatic: true }]);
  assert.deepEqual(notices, ['engine.restarted']);

  // Flag off: mergeCoreData without resolveAges keeps synchronous JS unchanged.
  const plain = makeCore({ depth: [0, 10], age: [0, 100] });
  mergeCoreData(plain);
  assert.equal(plain.ageAnalysis, undefined);
  assert.deepEqual(plain.age, [0, 999, 100, null]);

  // releaseAll cancels pending work without publishing.
  let resolvePending;
  const { client: slowClient } = fakeClient(() => new Promise((r) => { resolvePending = r; }));
  const slowAges = createEngineAges({ client: slowClient });
  const c2 = makeCore({ depth: [0, 10], age: [0, 100] });
  const pending = slowAges.request(c2, { depths: [0, 5], importedAges: [null, null], model: { depth: [0, 10], age: [0, 100] } });
  await until(() => resolvePending, 'slow client.run called');
  slowAges.releaseAll();
  resolvePending({ tables: { ages: [{ name: 'age', unit: 'ka', values: [0, 50] }] }, summary: { rows: 2, outside: 0 } });
  await pending;
  assert.equal(c2.age, null, 'cancelled job after releaseAll does not publish');
});
