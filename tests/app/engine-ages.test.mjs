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

// Card M8.5.8a: core jobs wait in the page behind one gate (corejobs.js).
import { createCoreJobGate } from '../../app/js/corejobs.js';

const abortable = (signal, work) => new Promise((resolve, reject) => {
  const onAbort = () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
  if (signal?.aborted) return onAbort();
  signal?.addEventListener('abort', onAbort, { once: true });
  work(resolve, reject);
});
const agesOf = (n) => ({ tables: { ages: [{ name: 'age', unit: 'ka', values: Array.from({ length: n }, (_, i) => i * 10) }] }, summary: { rows: n, outside: 0 } });
const plainRequest = (k) => ({ depths: [0, 1, 2], importedAges: [null, null, null], model: { depth: [0, 10], age: [k, 100 + k] } });

/** A fake engine that keeps at most 5 jobs (one running, four waiting) and answers `BUSY` beyond, as `server.py::WaitingJobs` does. */
function busyEngine() {
  let inFlight = 0, most = 0, busy = 0;
  const { client, stats } = fakeClient((_method, req, opts) => {
    if (inFlight >= 5) { busy++; return Promise.reject(Object.assign(new Error('busy'), { code: 'BUSY', field: null })); }
    inFlight++; most = Math.max(most, inFlight);
    return abortable(opts.signal, (resolve) => setTimeout(() => resolve(agesOf(req.inputs ? 3 : 0)), 2))
      .finally(() => { inFlight--; });
  });
  return { client, stats: () => ({ ...stats(), most, busy }) };
}

test('M8.5.8a: 20 cores against an engine that answers BUSY beyond 5 jobs: all ready with the gate, refused without it', async () => {
  const cores = Array.from({ length: 20 }, () => makeCore(null));

  const bare = busyEngine();
  const without = createEngineAges({ client: bare.client });
  await Promise.all(cores.map((core, k) => without.request(core, plainRequest(k))));
  const refused = cores.filter((core) => core.ageAnalysis.state === 'error' && core.ageAnalysis.code === 'BUSY').length;
  assert.ok(refused > 0, `without the gate some cores are refused (${refused})`);

  const gated = busyEngine();
  const gate = createCoreJobGate({ limit: 2 });
  const withGate = createEngineAges({ client: gated.client, gate });
  const fresh = Array.from({ length: 20 }, () => makeCore(null));
  await Promise.all(fresh.map((core, k) => withGate.request(core, plainRequest(k))));
  assert.deepEqual(fresh.map((core) => core.ageAnalysis.state), Array(20).fill('ready'));
  assert.deepEqual(fresh[7].age, [0, 10, 20]);
  assert.equal(gated.stats().busy, 0);
  assert.ok(gated.stats().most <= 2, `never more than 2 core jobs in flight (${gated.stats().most})`);
  assert.equal(gated.stats().runCalls, 20);
  assert.deepEqual(gate.stats(), { holders: 0, waiting: 0 });
});

test('M8.5.8a: superseded, failed, cleared and released jobs give their place back; a cleared waiter never runs', async () => {
  const gate = createCoreJobGate({ limit: 1 });
  const ran = [], resolvers = new Map();
  const { client } = fakeClient((_method, req, opts) => {
    ran.push(`${req.target}:${req.revision}`);
    if (req.inputs && resolvers.has('fail')) { resolvers.delete('fail'); return Promise.reject(Object.assign(new Error('bad'), { code: 'INVALID_INPUT', field: 'age_model' })); }
    return abortable(opts.signal, (resolve) => resolvers.set(`${req.target}:${req.revision}`, () => resolve(agesOf(3))));
  });
  const engineAges = createEngineAges({ client, gate });
  const [a, b, c] = [makeCore(null), makeCore(null), makeCore(null)];

  const a1 = engineAges.request(a, plainRequest(1));
  const b1 = engineAges.request(b, plainRequest(2));
  // Core b builds its snapshots before it queues, so wait for it to reach the gate rather than assume it already has.
  await until(() => ran.length === 1 && gate.stats().waiting === 1, 'core a holds the only place and core b waits');
  assert.deepEqual(gate.stats(), { holders: 1, waiting: 1 });

  // Superseding a's running job frees its place; b runs next and a's new revision waits behind it.
  const a2 = engineAges.request(a, plainRequest(3));
  await a1;
  await until(() => ran.length === 2, 'core b got the freed place');
  assert.equal(a.ageAnalysis.state, 'pending');
  await until(() => gate.stats().waiting === 1, 'the new revision of core a waits for a place');
  assert.deepEqual(gate.stats(), { holders: 1, waiting: 1 });

  // A waiter that is cleared before its turn never reaches the engine.
  engineAges.clear(a);
  await a2;
  assert.deepEqual(gate.stats(), { holders: 1, waiting: 0 }, 'the cleared waiter left the queue');
  resolvers.get(ran[1])();
  await b1;
  assert.equal(b.ageAnalysis.state, 'ready');
  assert.deepEqual(gate.stats(), { holders: 0, waiting: 0 });
  assert.equal(ran.length, 2, 'a\'s cleared revision never ran');

  // A failed job releases its place.
  resolvers.set('fail', true);
  await engineAges.request(c, plainRequest(4));
  assert.deepEqual(c.ageAnalysis, { state: 'error', code: 'INVALID_INPUT', field: 'age_model' });
  assert.deepEqual(gate.stats(), { holders: 0, waiting: 0 });

  // Restart and retry runs the failed core again through the gate and releases.
  resolvers.clear();
  const retried = engineAges.restartAndRetry([c]);
  await until(() => resolvers.size === 1, 'the retry reached the engine');
  [...resolvers.values()][0]();
  await retried;
  assert.equal(c.ageAnalysis.state, 'ready');
  assert.deepEqual(gate.stats(), { holders: 0, waiting: 0 });

  // releaseAll frees the holder and every waiter.
  resolvers.clear();
  const pending = [makeCore(null), makeCore(null), makeCore(null)].map((core, k) => engineAges.request(core, plainRequest(10 + k)));
  await until(() => resolvers.size === 1 && gate.stats().waiting === 2, 'one holder running, two waiting');
  assert.deepEqual(gate.stats(), { holders: 1, waiting: 2 });
  engineAges.releaseAll();
  await Promise.all(pending);
  assert.deepEqual(gate.stats(), { holders: 0, waiting: 0 });
  assert.equal(resolvers.size, 1, 'the released waiters never ran');
});
