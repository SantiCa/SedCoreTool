// Card M8.4.37 step 1: the memory the per-tile statistics of the objects of a tiled section take (`TiledObjectStats`, card M8.4.16 step 3), measured
// with the page's own code (tiledit.js) on a grid of tiles like those of the synthetic section of M8.4.18d (`tools/make_large_mask_version.py`: every
// pixel one of `--objects` object IDs drawn at random, so a tile of 512 x 512 holds about 64,300 different objects), with random level-0 pixels.
//
//   node --expose-gc tools/measure_tiled_stats_memory.mjs [--rows 4] [--cols 4] [--objects 65535 | --per-tile 2000] [--out file.json]
//   (in Electron's V8, which compresses pointers: set ELECTRON_RUN_AS_NODE=1 and run desktop/node_modules/electron/dist/electron the same way)
//
// Part 1 ("unbounded"): every tile computed with `tileStats` and kept in one `TiledObjectStats`, the JavaScript heap measured after a forced collection
// before and after; the bytes per kept (object, tile) entry are the heap growth divided by the entries, and the section's total is extrapolated to the
// 7,168 tiles of the synthetic section (32,768 x 57,344 pixels) from the measured entries per tile.
// Part 2 ("bounded"): the same tiles through `TiledStatsRunner` with the budget of the page (`STATS_BUDGET_BYTES`): the peak of the live heap (after a
// forced collection, before each tile is kept) and of the estimate (`TiledObjectStats.bytes`), the tile at which the budget is exceeded, and what is
// kept afterwards. The synthetic section exceeds it after about 26 tiles, so a grid of 6 x 6 shows the whole behaviour.
import fs from 'node:fs';
import os from 'node:os';
import { TILE } from '../app/js/tiledsection.js';
import { MaskTiles } from '../app/js/tiledmasks.js';
import { TiledObjectStats, TiledStatsRunner, tileStats, STATS_BUDGET_BYTES } from '../app/js/tiledit.js';

const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const ROWS = Number(arg('--rows', '4')), COLS = Number(arg('--cols', '4')), OBJECTS = Number(arg('--objects', '65535')), out = arg('--out', null);
const PER_TILE = Number(arg('--per-tile', '0'));                  // > 0: tile t holds only objects t * PER_TILE + 1 .. (t + 1) * PER_TILE (each object in one tile)
const SYNTHETIC_TILES = 64 * 112;
const gc = /** @type {any} */ (globalThis).gc;
if (!gc) throw new Error('run with --expose-gc');
const heap = () => { gc(); gc(); return process.memoryUsage().heapUsed; };
const MiB = (bytes) => Math.round(bytes / 2 ** 20 * 10) / 10;

let state = 20261121;
const rand = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const width = COLS * TILE, height = ROWS * TILE, tiles = new MaskTiles({ width, height, budget: Infinity }), rgba = new Map();
for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
  const labels = new Int32Array(TILE * TILE), pixels = new Uint8ClampedArray(TILE * TILE * 4);
  const first = (row * COLS + col) * PER_TILE;
  for (let i = 0; i < labels.length; i++) labels[i] = PER_TILE ? first + 1 + Math.floor(rand() * PER_TILE) : 1 + Math.floor(rand() * OBJECTS);
  for (let i = 0; i < pixels.length; i++) pixels[i] = (i & 3) === 3 ? 255 : Math.floor(rand() * 256);
  tiles.set(row, col, labels, null, { dirty: false });
  rgba.set(row * COLS + col, pixels);
}
const all = /** @type {[number, number][]} */ ([]);
for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) all.push([row, col]);
const record = { card: 'M8.4.37', measured: new Date().toISOString(), runtime: { node: process.versions.node, v8: process.versions.v8, electron: process.versions.electron ?? null },
  host: { os: `${os.type()} ${os.release()}`, cpu: os.cpus()[0]?.model, cpus: os.cpus().length, memory_gib: Math.round(os.totalmem() / 2 ** 30) },
  input: { rows: ROWS, cols: COLS, tile: TILE, objects: PER_TILE ? PER_TILE * ROWS * COLS : OBJECTS, per_tile: PER_TILE || null,
    labels: PER_TILE ? 'each tile its own PER_TILE objects, uniform random within the tile' : 'uniform random over every object, as tools/make_large_mask_version.py', pixels: 'uniform random RGB' } };

// Part 1: unbounded.
{
  const source = { width, height, stacks: [null], labelsAt: (r, c) => tiles.get(r, c)?.labels || null, rgbaAt: (r, c) => rgba.get(r * COLS + c) || null };
  const stats = new TiledObjectStats({ budget: Infinity }), before = heap(), t0 = performance.now();
  for (const [row, col] of all) stats.replaceTile(row * COLS + col, tileStats(source, row, col));
  const seconds = (performance.now() - t0) / 1000, after = heap();
  let entries = 0;
  for (const perTile of stats.byTile.values()) entries += perTile.size;
  const perEntry = (after - before) / entries, perTileEntries = entries / all.length;
  record.unbounded = { tiles: all.length, entries, entries_per_tile: Math.round(perTileEntries), heap_bytes: after - before, heap_bytes_per_entry: Math.round(perEntry),
    estimate_bytes: stats.bytes, estimate_bytes_per_entry: Math.round(stats.bytes / entries), seconds_per_tile: Math.round(seconds / all.length * 1000) / 1000,
    synthetic_section_extrapolated: { tiles: SYNTHETIC_TILES, entries: Math.round(perTileEntries * SYNTHETIC_TILES), gib: Math.round(perEntry * perTileEntries * SYNTHETIC_TILES / 2 ** 30 * 10) / 10 } };
  console.log('unbounded:', JSON.stringify(record.unbounded));
}

// Part 2: bounded, through the runner as the page uses it.
{
  let exceededCalls = 0;
  const stats = new TiledObjectStats({ onExceeded: () => { exceededCalls++; } }), base = heap();
  let peakHeap = 0, peakEstimate = 0, computed = 0, exceededAfter = null, updates = 0;
  const replace = stats.replaceTile.bind(stats);
  stats.replaceTile = (tile, perTile) => {
    peakHeap = Math.max(peakHeap, heap() - base);                 // live: what is kept so far and the new tile's statistics
    const changed = replace(tile, perTile);
    computed++; peakEstimate = Math.max(peakEstimate, stats.bytes);
    if (stats.exceeded && exceededAfter === null) exceededAfter = computed;
    return changed;
  };
  const runner = new TiledStatsRunner({ tiles, stats, stacks: () => [null], fetchRgba: async (positions) => positions.map(([r, c]) => rgba.get(r * COLS + c)),
    onUpdate: () => { updates++; } });
  await runner.queue(all);
  const kept = heap() - base;
  record.bounded = { budget_bytes: STATS_BUDGET_BYTES, tiles_computed: computed, exceeded_after_tiles: exceededAfter, exceeded_reported: exceededCalls, updates_reported: updates,
    peak_estimate_bytes: peakEstimate, peak_heap_bytes: peakHeap, kept_heap_bytes_after: kept, kept_entries: stats.byTile.size, runner_idle: runner.idle };
  console.log('bounded:', JSON.stringify(record.bounded), `(peak heap ${MiB(peakHeap)} MiB, budget ${MiB(STATS_BUDGET_BYTES)} MiB)`);
}
if (out) fs.writeFileSync(out, JSON.stringify(record, null, 2) + '\n');
