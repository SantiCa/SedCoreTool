// Card M8.4.15 step 3: which tiles the viewer needs, the bounded cache and the batched requests (app/js/tilecache.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { TileCache, TileScheduler, coarserCover, levelForZoom, tileKey, tileRange, tilesByDistance } from '../../app/js/tilecache.js';
import { TILE } from '../../app/js/tiledsection.js';

// The levels of the 8 GiB fixture (8,192 x 349,526), as pyramid.json lists them.
const levels = [];
for (let w = 8192, h = 349526; ; w = Math.ceil(w / 2), h = Math.ceil(h / 2)) {
  levels.push({ width: w, height: h, rows: Math.ceil(h / TILE), cols: Math.ceil(w / TILE) });
  if (w <= TILE && h <= TILE) break;
}

test('the level is the coarsest with at least one level pixel per screen pixel', () => {
  assert.equal(levelForZoom(levels, 1), 0);
  assert.equal(levelForZoom(levels, 4), 0);                // magnified beyond the source: level 0
  assert.equal(levelForZoom(levels, 0.5), 1);
  assert.equal(levelForZoom(levels, 0.3), 1);              // 2^1 = 2 <= 3.3 < 2^2
  assert.equal(levelForZoom(levels, 0.25), 2);
  assert.equal(levelForZoom(levels, 1e-6), levels.length - 1);
  assert.equal(levelForZoom(levels, 0), levels.length - 1);
});

test('the tile range covers the view plus one ring, clamped to the grid, and the centre comes first', () => {
  // A 1,440 x 900 screen at zoom 0.25 shows 5,760 x 3,600 source pixels: level 2, whose tiles span 2,048 source pixels.
  const range = tileRange(levels, 2, { x0: 1000, y0: 100000, x1: 6760, y1: 103600 });
  assert.deepEqual(range, { k: 2, row0: 47, row1: 51, col0: 0, col1: 3 });   // cols 0-3 clamped (level 2 has 4 columns)
  const positions = tilesByDistance(range, { x: 3880, y: 101800 });
  assert.equal(positions.length, 5 * 4);
  assert.deepEqual(positions[0], [49, 1]);                 // the tile under the centre
  assert.deepEqual(tileRange(levels, 0, { x0: 0, y0: 0, x1: 512, y1: 512 }, 0), { k: 0, row0: 0, row1: 0, col0: 0, col1: 0 });
  const last = levels.length - 1;
  assert.deepEqual(tileRange(levels, last, { x0: -5000, y0: -5000, x1: 1e9, y1: 1e9 }), { k: last, row0: 0, row1: 0, col0: 0, col1: 0 });
});

test('a missing tile is drawn from the nearest coarser cached tile, with the matching part of it', () => {
  const cached = new Set([tileKey(3, 6, 0), tileKey(5, 1, 0)]);
  // Tile (1, 25, 1): two levels up is (3, 6, 0); 4 x 4 level-1 tiles per level-3 tile, so it is the 128 x 128 square at (128, 128).
  assert.deepEqual(coarserCover(levels, 1, 25, 1, (key) => cached.has(key)), { key: '3/6/0', k: 3, row: 6, col: 0, sx: 128, sy: 128, sw: 128, sh: 128 });
  assert.deepEqual(coarserCover(levels, 1, 30, 1, (key) => cached.has(key))?.key, '5/1/0');   // level-3 parent (3, 7, 0) not cached: level 5
  assert.equal(coarserCover(levels, 1, 41, 1, () => false), null);
});

test('the cache drops the least recently used tiles beyond its budget, never those on screen', () => {
  const cache = new TileCache(300);
  cache.set('a', { name: 'a' }, 100); cache.set('b', { name: 'b' }, 100); cache.set('c', { name: 'c' }, 100);
  cache.get('a');                                           // a is now the most recent
  const dropped = cache.set('d', { name: 'd' }, 100, new Set(['b']));
  assert.deepEqual(dropped.map((value) => value.name), ['c']);   // b is protected, a was used: c goes
  assert.deepEqual([...cache.entries.keys()], ['b', 'a', 'd']);
  assert.equal(cache.bytes, 300);
  cache.set('a', { name: 'a2' }, 50);                        // replacing an entry updates its size
  assert.equal(cache.bytes, 250);
  assert.deepEqual(cache.clear().map((value) => value.name).sort(), ['a2', 'b', 'd']);
  assert.equal(cache.bytes, 0);
});

function deferredFetch() {
  const calls = [];
  const fetch = (k, positions) => new Promise((resolve, reject) => { calls.push({ k, positions, resolve, reject }); });
  const answer = (call) => call.resolve(call.positions.map(([row, col]) => ({ row, col, value: { closed: false, close() { this.closed = true; } }, bytes: 10 })));
  return { calls, fetch, answer };
}

test('tiles are requested in batches of 16, two batches at a time, without duplicates', async () => {
  const { calls, fetch, answer } = deferredFetch(), loaded = [];
  const scheduler = new TileScheduler({ fetch, cache: new TileCache(1e6), onLoaded: (keys) => loaded.push(...keys) });
  const positions = Array.from({ length: 40 }, (_, i) => [Math.floor(i / 4), i % 4]);
  scheduler.want(0, positions);
  assert.deepEqual(calls.map((call) => call.positions.length), [16, 16]);
  scheduler.want(0, positions);                              // asked again while in flight: nothing new is requested
  assert.equal(calls.length, 2);
  answer(calls[0]); await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls.map((call) => call.positions.length), [16, 16, 8]);
  answer(calls[1]); answer(calls[2]); await new Promise((r) => setTimeout(r, 0));
  assert.equal(loaded.length, 40); assert.ok(scheduler.idle);
  scheduler.want(0, positions);                              // all cached now
  assert.equal(calls.length, 3);
});

test('tiles no longer wanted are not requested; failures free the tiles for a later attempt', async () => {
  const { calls, fetch, answer } = deferredFetch(), errors = [];
  const scheduler = new TileScheduler({ fetch, cache: new TileCache(1e6), onError: (error) => errors.push(error), maxInFlight: 1 });
  scheduler.want(2, [[0, 0], [0, 1]], new Set());
  scheduler.want(3, [[5, 5]]);                               // the view moved: the queue is replaced
  assert.equal(calls.length, 1);
  calls[0].reject(new Error('engine restarted')); await new Promise((r) => setTimeout(r, 0));
  assert.equal(errors.length, 1);
  assert.deepEqual(calls[1], { ...calls[1], k: 3, positions: [[5, 5]] });   // the level-2 tiles were dropped, not retried
  answer(calls[1]); await new Promise((r) => setTimeout(r, 0));
  scheduler.want(2, [[0, 0]]);                               // the failed tile can be asked for again
  assert.deepEqual(calls[2].positions, [[0, 0]]);
});

test('after a failed read the scheduler is not idle and asks again after a growing pause, until the tile arrives', async () => {
  const { calls, fetch, answer } = deferredFetch(), pauses = [], waiting = [];
  let retries = 0;
  const scheduler = new TileScheduler({ fetch, cache: new TileCache(1e6), retryMs: [10, 20], wait: (ms, then) => { pauses.push(ms); waiting.push(then); },
    onRetry: () => { retries++; scheduler.want(0, [[1, 1]]); } });
  scheduler.want(0, [[1, 1]]);
  calls[0].reject(new Error('ENGINE_UNAVAILABLE')); await new Promise((r) => setTimeout(r, 0));
  assert.equal(scheduler.idle, false, 'a failed tile is not "done"');
  waiting.shift()();                                          // the first pause ends: the view asks again
  assert.equal(retries, 1); assert.deepEqual(calls[1].positions, [[1, 1]]);
  calls[1].reject(new Error('ENGINE_UNAVAILABLE')); await new Promise((r) => setTimeout(r, 0));
  waiting.shift()();
  assert.deepEqual(pauses, [10, 20], 'the pause grows');
  answer(calls[2]); await new Promise((r) => setTimeout(r, 0));
  assert.equal(scheduler.idle, true);
  assert.equal(scheduler.failures, 0);
});

test('a tile evicted by the cache is closed (its bitmap memory released)', async () => {
  const { calls, fetch, answer } = deferredFetch();
  const cache = new TileCache(25);                           // room for two tiles of 10 bytes
  const scheduler = new TileScheduler({ fetch, cache, batch: 3 });
  scheduler.want(0, [[0, 0], [0, 1], [0, 2]]);
  const values = [];
  calls[0].resolve(calls[0].positions.map(([row, col]) => { const value = { closed: false, close() { this.closed = true; } }; values.push(value); return { row, col, value, bytes: 10 }; }));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(values.map((value) => value.closed), [true, false, false]);
  assert.equal(cache.bytes, 20);
  void answer;
});

test('a tile is placed on screen from the working image\'s view, and only its real pixels are drawn', async () => {
  const { tilePlacement } = await import('../../app/js/tilecache.js');
  // Working image = level 5 (one working pixel = 32 source pixels); view from working pixel (10, 3000) at zoom 8 (screen px per working px).
  const view = { vx: 10, vy: 3000, zoom: 8, workingLevel: 5 };
  // Level 2 tile (row 47, col 1): one level-2 pixel is 1/8 working pixel, so 512 pixels are 64 working pixels and 512 screen pixels.
  assert.deepEqual(tilePlacement(levels, 2, 47, 1, view), { dx: (64 - 10) * 8, dy: (47 * 64 - 3000) * 8, dw: 512, dh: 512, w: 512, h: 512 });
  // The last column of level 0 is a full tile (8,192 = 16 x 512); the last row is 349,526 - 682 x 512 = 342 pixels high.
  const edge = tilePlacement(levels, 0, 682, 15, view);
  assert.deepEqual([edge.w, edge.h], [512, 342]);
  assert.equal(edge.dh, 342 * 8 / 32);
});

test('the scheduler keeps the keys of several pyramids apart in one shared cache', async () => {
  const { calls, fetch, answer } = deferredFetch(), cache = new TileCache(1e6);
  const a = new TileScheduler({ fetch, cache, prefix: 'a/' }), b = new TileScheduler({ fetch, cache, prefix: 'b/' });
  a.want(0, [[0, 0]]); answer(calls[0]); await new Promise((r) => setTimeout(r, 0));
  b.want(0, [[0, 0]]);                                       // same position, other pyramid: requested
  assert.equal(calls.length, 2);
  assert.ok(cache.has('a/0/0/0'));
});
