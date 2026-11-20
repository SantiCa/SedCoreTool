// Card M8.4.29: the reopening cache of a tiled section. What comes back from the cache equals what is rebuilt from the tiles, and every kind of
// mismatch or damage rejects the whole cache.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { TILE } from '../../app/js/tiledsection.js';
import { MaskTiles, reduceTile } from '../../app/js/tiledmasks.js';
import { TiledRowCounts, tileHistogram } from '../../app/js/tiledcounts.js';
import { TiledObjectStats, tileStats } from '../../app/js/tiledit.js';
import { CACHE_VERSION, CacheRejected, CacheTooLarge, HEADER_BYTES, STAT_FIELDS, decodeReopenCache, encodeReopenCache, statsCover } from '../../app/js/tiledcache.js';

const sha256 = async (bytes) => createHash('sha256').update(bytes).digest('hex');
const MANIFEST = 'a1'.repeat(32), SOURCE = 'b2'.repeat(32);

function random(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** A section of w x h with random objects, stacks and exclusion, and everything the page derives from it, rebuilt from the tiles as `loadTiledSection` does. */
function section(seed, { w = 1300, h = 1100, ds = 2, columns = [37, 1250], objects = 20, rects = 30 } = {}) {
  const rand = random(seed), tiles = new MaskTiles({ width: w, height: h, budget: Infinity });
  const labels = new Int32Array(w * h), exclude = new Uint8Array(w * h), stacks = [null];
  for (let k = 1; k <= 4; k++) stacks.push([1 + Math.floor(rand() * objects), 1 + Math.floor(rand() * objects)]);
  for (let r = 0; r < rects; r++) {
    const x0 = Math.floor(rand() * w), y0 = Math.floor(rand() * h), x1 = Math.min(w, x0 + 1 + Math.floor(rand() * 500)), y1 = Math.min(h, y0 + 1 + Math.floor(rand() * 400));
    const into = rand() < 0.2 ? exclude : labels, value = rand() < 0.15 ? -(1 + Math.floor(rand() * 4)) : 1 + Math.floor(rand() * objects);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) into[y * w + x] = into === exclude ? 1 : value;
  }
  const rgba = new Uint8Array(w * h * 4).map(() => Math.floor(rand() * 256));
  const stored = new Set(), tileLabels = new Map(), tileRgbaMap = new Map();
  for (let row = 0; row < tiles.rows; row++) for (let col = 0; col < tiles.cols; col++) {
    const l = new Int32Array(TILE * TILE), e = new Uint8Array(TILE * TILE), c = new Uint8Array(TILE * TILE * 4);
    for (let y = 0; y < TILE && row * TILE + y < h; y++) for (let x = 0; x < TILE && col * TILE + x < w; x++) {
      const at = (row * TILE + y) * w + col * TILE + x;
      l[y * TILE + x] = labels[at]; e[y * TILE + x] = exclude[at]; c.set(rgba.subarray(at * 4, at * 4 + 4), (y * TILE + x) * 4);
    }
    tiles.set(row, col, l, e); tileLabels.set(row * tiles.cols + col, l); tileRgbaMap.set(row * tiles.cols + col, c);
    if (l.some(Boolean) || e.some(Boolean)) stored.add(row * tiles.cols + col);
  }
  const ww = Math.ceil(w / ds), wh = Math.ceil(h / ds), working = { w: ww, h: wh, labels: new Int32Array(ww * wh), exclude: new Uint8Array(ww * wh) };
  const counts = new TiledRowCounts({ width: w, height: h, rows: tiles.rows, cols: tiles.cols }, { nonEmpty: () => stored });
  counts.setArea({ x0: columns[0], x1: columns[1], y0: 0, y1: h });
  const stats = new TiledObjectStats(), source = { width: w, height: h, stacks, labelsAt: (r, c) => tileLabels.get(r * tiles.cols + c), rgbaAt: (r, c) => tileRgbaMap.get(r * tiles.cols + c) };
  for (const tile of [...stored].sort((a, b) => a - b)) {
    const row = Math.floor(tile / tiles.cols), col = tile % tiles.cols, entry = tiles.get(row, col);
    reduceTile(working, ds, row, col, entry.labels, entry.exclude);
    counts.commit(tile, tileHistogram(entry, row, col, w, h, columns[0], columns[1]));
    stats.replaceTile(tile, tileStats(source, row, col));
  }
  return { w, h, ds, columns, tiles, stored, working, counts, stats, stacks, objects };
}

const inputOf = (m) => {
  const snap = m.counts.snapshot();
  return { manifest: MANIFEST, source: SOURCE, ds: m.ds, width: m.w, height: m.h, working: m.working, columns: snap.columns, hists: snap.hists, stats: m.stats.byTile };
};
const expectOf = (m) => ({ manifest: MANIFEST, source: SOURCE, ds: m.ds, width: m.w, height: m.h, working: { w: m.working.w, h: m.working.h }, stored: m.stored });
const sameArray = (a, b) => assert.ok(a === b || (a && b && a.length === b.length && a.every((v, i) => v === b[i])), 'arrays differ');

test('round trip: histograms, reduced copy and statistics come back identical, over random sections', async () => {
  for (const [seed, options] of [[1, {}], [2, { ds: 1, w: 700, h: 530, columns: [0, 700] }], [3, { ds: 4, rects: 3 }], [4, { rects: 0 }], [5, { w: 513, h: 513, columns: [100, 400] }]]) {
    const m = section(seed, options), bytes = await encodeReopenCache(inputOf(m), sha256), out = await decodeReopenCache(bytes, expectOf(m), sha256);
    const snap = m.counts.snapshot();
    assert.deepEqual(out.columns, snap.columns);
    assert.deepEqual([...out.hists.keys()], [...snap.hists.keys()].sort((a, b) => a - b));
    for (const [tile, h] of snap.hists) {
      const g = out.hists.get(tile);
      assert.equal(g.rows, h.rows); assert.equal(g.bytes, h.bytes);
      for (const part of ['excluded', 'offsets', 'labels', 'counts']) sameArray(g[part], h[part]);
    }
    sameArray(out.labels, m.working.labels); sameArray(out.exclude, m.working.exclude);
    assert.deepEqual([...out.stats.keys()], [...m.stats.byTile.keys()].sort((a, b) => a - b));
    for (const [tile, perTile] of m.stats.byTile) for (const [id, s] of perTile) assert.deepEqual(out.stats.get(tile).get(id), s, `statistics of object ${id} in tile ${tile}`);
  }
});

test('the row counts and the totals of the objects from the cache equal those rebuilt from the tiles', async () => {
  const m = section(7), bytes = await encodeReopenCache(inputOf(m), sha256), out = await decodeReopenCache(bytes, expectOf(m), sha256);
  const area = { x0: m.columns[0], x1: m.columns[1], y0: 0, y1: m.h }, eff = Int16Array.from({ length: m.objects + 1 }, (_, i) => (i % 3) - 1);
  const rebuilt = m.counts.rowCounts({ effClass: eff, nClasses: 2, stacks: m.stacks, area });
  const from = new TiledRowCounts({ width: m.w, height: m.h, rows: m.tiles.rows, cols: m.tiles.cols }, { nonEmpty: () => m.stored });
  from.restore(out.columns, out.hists);
  assert.equal(from.setArea(area), false, 'the same columns: nothing to count again');
  assert.ok(from.ready);
  const got = from.rowCounts({ effClass: eff, nClasses: 2, stacks: m.stacks, area });
  for (const key of ['nRows', 'nClasses', 'nCols']) assert.equal(got[key], rebuilt[key]);
  for (const key of ['valid', 'bio', 'cls']) sameArray(got[key], rebuilt[key]);
  const stats = new TiledObjectStats();
  for (const [tile, perTile] of out.stats) stats.replaceTile(tile, perTile);
  for (let id = 1; id <= m.objects; id++) assert.deepEqual(stats.total(id), m.stats.total(id), `total of object ${id}`);
});

test('other analysis columns count again only the tiles of the columns that differ', async () => {
  const m = section(8, { columns: [0, 1300] }), bytes = await encodeReopenCache(inputOf(m), sha256), out = await decodeReopenCache(bytes, expectOf(m), sha256);
  const from = new TiledRowCounts({ width: m.w, height: m.h, rows: m.tiles.rows, cols: m.tiles.cols }, { nonEmpty: () => m.stored });
  from.restore(out.columns, out.hists);
  assert.equal(from.setArea({ x0: 0, x1: 600, y0: 0, y1: m.h }), true);
  const cols = new Set([...from.needed].map((tile) => tile % m.tiles.cols));
  assert.deepEqual([...cols].sort(), [1, 2], 'columns 1 (partly) and 2 (outside) changed; column 0 did not');
  assert.ok(!from.ready);
});

test('snapshot is null while a tile still has to be counted', () => {
  const m = section(9);
  const fresh = new TiledRowCounts({ width: m.w, height: m.h, rows: m.tiles.rows, cols: m.tiles.cols }, { nonEmpty: () => m.stored });
  assert.equal(fresh.snapshot(), null);
  fresh.setArea({ x0: 0, x1: m.w, y0: 0, y1: m.h });
  assert.equal(fresh.snapshot(), null, 'tiles are needed');
  m.counts.markChanged([[0, 0]]);
  assert.equal(m.counts.snapshot(), null);
});

const seal = async (bytes) => { bytes.set(Buffer.from(await sha256(bytes.subarray(HEADER_BYTES)), 'hex'), 104); return bytes; };
const view = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
async function rejected(bytes, expect, reason) {
  await assert.rejects(() => decodeReopenCache(bytes, expect, sha256), (error) => error instanceof CacheRejected && (!reason || error.reason === reason), reason);
}

test('every mismatch with the section being opened rejects the whole cache', async () => {
  const m = section(11), good = await encodeReopenCache(inputOf(m), sha256), expect = expectOf(m);
  await decodeReopenCache(good, expect, sha256);
  await rejected(good, { ...expect, manifest: 'c3'.repeat(32) }, 'manifest');
  await rejected(good, { ...expect, source: 'c3'.repeat(32) }, 'source');
  await rejected(good, { ...expect, ds: 4 }, 'sizes');
  await rejected(good, { ...expect, width: m.w + 1 }, 'sizes');
  await rejected(good, { ...expect, height: m.h + 1 }, 'sizes');
  await rejected(good, { ...expect, working: { w: m.working.w + 1, h: m.working.h } }, 'sizes');
  await rejected(good, { ...expect, stored: new Set([...m.stored].slice(1)) });                       // a tile with a histogram that the stored version does not have
  const version = good.slice(); view(version).setUint32(4, CACHE_VERSION + 1, true);
  await rejected(version, expect, 'version');
  const magic = good.slice(); magic[0] = 0x58;
  await rejected(magic, expect, 'magic');
  const reserved = good.slice(); reserved[140] = 1;
  await rejected(reserved, expect, 'reserved bytes');
});

test('damage rejects the cache: a flipped byte, truncation, extra bytes, a wrong length, an empty or foreign file', async () => {
  const m = section(12), good = await encodeReopenCache(inputOf(m), sha256), expect = expectOf(m);
  for (const at of [HEADER_BYTES, HEADER_BYTES + 100, Math.floor(good.length / 2), good.length - 1]) {
    const flipped = good.slice(); flipped[at] ^= 0x40;
    await rejected(flipped, expect, 'body hash');
  }
  await rejected(good.slice(0, good.length - 1), expect, 'body length');
  await rejected(good.slice(0, HEADER_BYTES - 1), expect, 'size');
  await rejected(good.slice(0, HEADER_BYTES), expect, 'body length');
  await rejected(Uint8Array.from([...good, 0]), expect, 'body length');
  await rejected(new Uint8Array(0), expect, 'size');
  await rejected(new Uint8Array(HEADER_BYTES + 10), expect, 'magic');
  const length = good.slice(); view(length).setUint32(100, good.length, true);
  await rejected(await seal(length), expect, 'body length');
});

test('a body with a correct hash but wrong structure is rejected: counts, offsets and values that do not add up', async () => {
  const m = section(13), good = await encodeReopenCache(inputOf(m), sha256), expect = expectOf(m), v = (b) => view(b);
  const histLength = v(good).getUint32(HEADER_BYTES, true);
  // the histogram part claims more bytes than the body has
  let bad = good.slice(); v(bad).setUint32(HEADER_BYTES, good.length, true);
  await rejected(await seal(bad), expect, 'a count or offset lies outside the body');
  // more tiles than the stored version has
  bad = good.slice(); v(bad).setUint32(HEADER_BYTES + 4, m.stored.size + 1, true);
  await rejected(await seal(bad), expect, 'histogram count');
  // the first histogram's tile out of the grid / not stored / not ascending
  bad = good.slice(); v(bad).setUint32(HEADER_BYTES + 8, 99, true);
  await rejected(await seal(bad), expect, 'histogram tile');
  // the first histogram's row count
  bad = good.slice(); v(bad).setUint32(HEADER_BYTES + 12, 511, true);
  await rejected(await seal(bad), expect, 'histogram shape');
  // flags 0 and 4
  for (const flags of [0, 4]) { bad = good.slice(); v(bad).setUint32(HEADER_BYTES + 16, flags, true); await rejected(await seal(bad), expect, 'histogram shape'); }
  // the reduced copy part: a run that overruns its size
  const reducedAt = HEADER_BYTES + 4 + histLength;
  bad = good.slice(); v(bad).setUint32(reducedAt + 4, 0xffffff, true);
  await rejected(await seal(bad), expect, 'the reduced copy does not cover its size exactly');
  // a part length that leaves bytes over
  bad = good.slice(); v(bad).setUint32(HEADER_BYTES, histLength - 1, true);
  await rejected(await seal(bad), expect);
});

test('statistics that cannot be right are rejected: non-finite values, a box outside the source, repeated or descending ids and tiles', async () => {
  const m = section(14), expect = expectOf(m), input = inputOf(m);
  const tile = [...m.stats.byTile.keys()][0], id = [...m.stats.byTile.get(tile).keys()][0], original = m.stats.byTile.get(tile).get(id);
  const withStat = async (change) => {
    const stats = new Map(input.stats), perTile = new Map(stats.get(tile));
    perTile.set(id, { ...original, ...change }); stats.set(tile, perTile);
    return encodeReopenCache({ ...input, stats }, sha256);
  };
  await rejected(await withStat({ sx: NaN }), expect, 'statistics value');
  await rejected(await withStat({ sy: Infinity }), expect, 'statistics value');
  await rejected(await withStat({ x1: m.w }), expect, 'statistics box');
  await rejected(await withStat({ x0: original.x1 + 1 }), expect, 'statistics box');
  await rejected(await withStat({ n: 0 }), expect, 'statistics box');
  await rejected(await withStat({ n: 1.5 }), expect, 'statistics box');
  const dup = new Map(input.stats); dup.set(m.tiles.rows * m.tiles.cols + 5, new Map([[1, original]]));
  await rejected(await encodeReopenCache({ ...input, stats: dup }, sha256), expect);   // a tile the stored version does not have (the count or the tile check)
  const empty = new Map(input.stats); empty.set(tile, new Map());
  await rejected(await encodeReopenCache({ ...input, stats: empty }, sha256), expect, 'statistics tile');
});

test('a histogram whose pairs or totals are impossible is rejected', async () => {
  const m = section(15), expect = expectOf(m), input = inputOf(m);
  const tile = [...input.hists.keys()].find((t) => input.hists.get(t).offsets), h = input.hists.get(tile);
  const make = (change) => { const hists = new Map(input.hists); hists.set(tile, { ...h, ...change }); return encodeReopenCache({ ...input, hists }, sha256); };
  await rejected(await make({ counts: Uint16Array.from(h.counts, () => 0) }), expect, 'histogram pair');
  await rejected(await make({ labels: Int32Array.from(h.labels, () => 3) }), expect, 'histogram pair');            // not ascending inside a row (or zero)
  await rejected(await make({ counts: Uint16Array.from(h.counts, () => 65535) }), expect, 'histogram row total');
  await rejected(await make({ offsets: Uint32Array.from(h.offsets, (v, i) => (i === 0 ? 1 : v)) }), expect, 'histogram offsets');
  await rejected(await make({ excluded: Uint16Array.from({ length: h.rows }, () => 65535) }), expect, 'excluded pixels');
});

test('the reduced copy must cover its size exactly and the exclusion holds only 0 and 1', async () => {
  const m = section(16), expect = expectOf(m), input = inputOf(m);
  const exclude = input.working.exclude.slice(); exclude[10] = 2;
  await rejected(await encodeReopenCache({ ...input, working: { ...input.working, exclude } }, sha256), expect, 'reduced copy');
  await assert.rejects(() => encodeReopenCache({ ...input, working: { ...input.working, labels: new Int32Array(5) } }, sha256), RangeError);
});

test('a cache beyond the engine limit is not written, and bad arguments are refused', async () => {
  const m = section(17, { w: 600, h: 600, ds: 1, columns: [0, 600] }), input = inputOf(m);
  const huge = { w: 6000, h: 6000, labels: new Int32Array(6000 * 6000).map((_, i) => (i * 2654435761) | 1), exclude: new Uint8Array(6000 * 6000).fill(1) };
  await assert.rejects(() => encodeReopenCache({ ...input, working: huge }, sha256), CacheTooLarge);
  await assert.rejects(() => encodeReopenCache({ ...input, manifest: 'xyz' }, sha256), RangeError);
});

test('the fields of a statistic are the ones imageproc.js defines', () => {
  const m = section(18), any = [...m.stats.byTile.values()][0].values().next().value;
  assert.deepEqual(Object.keys(any).sort(), [...STAT_FIELDS].sort());
});

test('statistics must cover the labelled tiles: a section saved before its statistics existed is not reopened from a cache', async () => {
  const m = section(19), input = inputOf(m), snapshot = m.counts.snapshot();
  assert.ok(statsCover(snapshot.hists, m.stats.byTile));
  const tile = [...m.stats.byTile.keys()][0], without = new Map(input.stats); without.delete(tile);
  assert.ok(!statsCover(snapshot.hists, without));
  await rejected(await encodeReopenCache({ ...input, stats: without }, sha256), expectOf(m), 'statistics missing for a labelled tile');
  assert.ok(!statsCover(snapshot.hists, new Map()));
  assert.ok(statsCover(new Map(), new Map()), 'a section with no labelled tile needs none');
});
