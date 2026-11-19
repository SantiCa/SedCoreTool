// Card M8.4.31: project saves run one at a time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { singleFlight } from '../../app/js/singleflight.js';

/** A stub store: each run copies the state after a delay and records whether two runs ever overlapped. */
function stubSaves() {
  const log = { runs: 0, active: 0, overlapped: false, saved: null, state: 0, dirty: false };
  const run = async () => {
    log.runs++; log.active++; if (log.active > 1) log.overlapped = true;
    log.dirty = false;
    const state = log.state;
    await new Promise((resolve) => setTimeout(resolve, 5));
    log.saved = state; log.active--;
  };
  return { log, saves: singleFlight(run, () => log.state) };
}
const change = (log) => { log.state++; log.dirty = true; };

test('requests made during a save give exactly one more save, never two at once, ending with the last state', async () => {
  const { log, saves } = stubSaves();
  change(log);
  const first = saves.request();
  change(log);
  const waiting = [saves.request(), saves.request(), saves.request()];   // three requests while the first save runs
  change(log);
  await Promise.all([first, ...waiting]);
  assert.equal(log.overlapped, false);
  assert.equal(log.runs, 2);
  assert.equal(log.saved, 3, 'the second save wrote the last state');
  assert.equal(saves.running, null);
});

test('a request that waited and finds nothing left to save does not run; a request when idle always runs', async () => {
  const { log, saves } = stubSaves();
  change(log);
  const first = saves.request();
  const second = saves.request();                                      // no change after the first save started
  await Promise.all([first, second]);
  assert.equal(log.runs, 1);
  await saves.request();                                               // idle: an explicit save runs even when nothing changed
  assert.equal(log.runs, 2);
});

test('random interleavings of changes and requests never overlap and always end saved', async () => {
  for (let seed = 1; seed <= 20; seed++) {
    let state = seed; const random = () => ((state = (state * 1103515245 + 12345) >>> 0) / 2 ** 32);
    const { log, saves } = stubSaves();
    const requests = [];
    for (let k = 0; k < 30; k++) {
      if (random() < 0.6) change(log);
      if (random() < 0.5) requests.push(saves.request());
      if (random() < 0.3) await new Promise((resolve) => setTimeout(resolve, Math.floor(random() * 8)));
    }
    requests.push(saves.request());
    await Promise.all(requests);
    assert.equal(log.overlapped, false, `seed ${seed}`);
    assert.equal(log.saved, log.state, `seed ${seed}: the last state is saved`);
  }
});

test('a failed save is reported to its request and the next request runs', async () => {
  let fail = true, runs = 0;
  let revision = 0;
  const saves = singleFlight(async () => { runs++; if (fail) throw new Error('disk'); }, () => revision);
  await assert.rejects(saves.request(), /disk/);
  fail = false; revision++;
  await saves.request();
  assert.equal(runs, 2);
  assert.equal(saves.running, null);
});

test('a run that leaves something unsaved is not repeated by every waiting request, only after a new change', async () => {
  let runs = 0, revision = 0, release;
  const saves = singleFlight(async () => { runs++; await new Promise((resolve) => { release = resolve; }); }, () => revision);
  const first = saves.request();
  const waiting = Array.from({ length: 20 }, () => saves.request());   // nothing changes while the first run is stuck
  release();
  await Promise.all([first, ...waiting]);
  assert.equal(runs, 1, 'twenty waiting requests, no change: no further run');
  revision++;
  const after = saves.request(); release(); await after;
  assert.equal(runs, 2);
});
