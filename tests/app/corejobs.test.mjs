// Card M8.5.8a: the page-side gate of core-scope engine jobs (corejobs.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoreJobGate } from '../../app/js/corejobs.js';

const turns = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

test('M8.5.8a: never more than `limit` holders, and places are given in order of arrival', async () => {
  const gate = createCoreJobGate({ limit: 2 });
  const order = [];
  let holding = 0, most = 0;
  const jobs = Array.from({ length: 12 }, (_, k) => (async () => {
    const release = await gate.acquire();
    order.push(k);
    holding++; most = Math.max(most, holding);
    await turns(1 + (k % 3));
    holding--;
    release();
  })());
  await Promise.all(jobs);
  assert.equal(most, 2);
  assert.deepEqual(order, [...Array(12).keys()]);
  assert.deepEqual(gate.stats(), { holders: 0, waiting: 0 });
});

test('M8.5.8a: an aborted waiter never runs and frees its place in the queue', async () => {
  const gate = createCoreJobGate({ limit: 1 });
  const first = await gate.acquire();
  const controller = new AbortController();
  const ran = [];
  const aborted = gate.acquire(controller.signal).then(() => ran.push('aborted'), (error) => error);
  const later = gate.acquire().then((release) => { ran.push('later'); return release; });
  assert.deepEqual(gate.stats(), { holders: 1, waiting: 2 });
  controller.abort();
  const error = await aborted;
  assert.equal(error.name, 'AbortError');
  assert.deepEqual(gate.stats(), { holders: 1, waiting: 1 }, 'the aborted waiter left the queue');
  first();
  const release = await later;
  assert.deepEqual(ran, ['later']);
  release();
  assert.deepEqual(gate.stats(), { holders: 0, waiting: 0 });
  await assert.rejects(gate.acquire(AbortSignal.abort()), { name: 'AbortError' }, 'an already aborted signal is refused at once');
  assert.deepEqual(gate.stats(), { holders: 0, waiting: 0 });
});

test('M8.5.8a: a release called twice frees one place only', async () => {
  const gate = createCoreJobGate({ limit: 1 });
  const release = await gate.acquire();
  const second = gate.acquire();
  const third = gate.acquire();
  release();
  release();
  await second;
  await turns();
  assert.deepEqual(gate.stats(), { holders: 1, waiting: 1 }, 'the third waiter still waits');
  (await second)();
  (await third)();
  assert.deepEqual(gate.stats(), { holders: 0, waiting: 0 });
});

test('M8.5.8a: the limit must be a positive integer', () => {
  for (const limit of [0, -1, 1.5, NaN]) assert.throws(() => createCoreJobGate({ limit }), RangeError);
});
