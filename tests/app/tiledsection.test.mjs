// Card M8.4.15: pure helpers of tiled sections (app/js/tiledsection.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleLevel, imageDimensions, levelPositions, proxyLevel, TILE } from '../../app/js/tiledsection.js';

function png(w, h) {
  const bytes = new Uint8Array(33), view = new DataView(bytes.buffer);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  view.setUint32(8, 13); bytes.set([0x49, 0x48, 0x44, 0x52], 12);       // IHDR
  view.setUint32(16, w); view.setUint32(20, h);
  return new Blob([bytes]);
}

function jpeg(w, h, { metadata = 0, sof = 0xc0 } = {}) {
  const app1 = new Uint8Array(4 + metadata); app1.set([0xff, 0xe1, ((metadata + 2) >> 8) & 255, (metadata + 2) & 255]);
  const frame = new Uint8Array([0xff, sof, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  return new Blob([new Uint8Array([0xff, 0xd8]), app1, frame, new Uint8Array([0xff, 0xd9])]);
}

function tiff(w, h) {
  // Little-endian classic TIFF, one strip of 8-bit grey samples.
  const entries = [[256, 3, w], [257, 3, h], [258, 3, 8], [259, 3, 1], [262, 3, 1], [273, 4, 8 + 2 + 9 * 12 + 4], [277, 3, 1], [278, 3, h], [279, 4, w * h]];
  const header = new Uint8Array(8 + 2 + entries.length * 12 + 4), view = new DataView(header.buffer);
  header.set([0x49, 0x49, 42, 0]); view.setUint32(4, 8, true); view.setUint16(8, entries.length, true);
  entries.forEach(([tag, type, value], i) => {
    const at = 10 + i * 12;
    view.setUint16(at, tag, true); view.setUint16(at + 2, type, true); view.setUint32(at + 4, 1, true);
    if (type === 3) view.setUint16(at + 8, value, true); else view.setUint32(at + 8, value, true);
  });
  return new Blob([header, new Uint8Array(w * h)]);
}

test('image dimensions come from the header of a PNG, a JPEG (after metadata) and a TIFF', async () => {
  assert.deepEqual(await imageDimensions(png(8192, 349526)), { w: 8192, h: 349526 });
  assert.deepEqual(await imageDimensions(jpeg(4096, 65500)), { w: 4096, h: 65500 });
  assert.deepEqual(await imageDimensions(jpeg(300, 200, { metadata: 60000, sof: 0xc2 })), { w: 300, h: 200 });   // progressive, large EXIF
  assert.deepEqual(await imageDimensions(tiff(37, 11)), { w: 37, h: 11 });
});

test('unknown or broken headers give null instead of a guess', async () => {
  assert.equal(await imageDimensions(new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])])), null);
  assert.equal(await imageDimensions(new Blob([new Uint8Array([0xff, 0xd8, 0x12, 0x34, 0, 0, 0, 0, 0, 0, 0, 0])])), null);
  assert.equal(await imageDimensions(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2, 0, 0, 0, 0, 0, 0])])), null);   // scan before frame
  assert.equal(await imageDimensions(new Blob([new Uint8Array([0x49, 0x49, 42, 0, 255, 255, 0, 0])])), null);               // directory past the end
});

test('the working level is the finest one within the pixel limit', () => {
  const levels = [{ width: 8192, height: 349526 }, { width: 4096, height: 174763 }, { width: 2048, height: 87382 }, { width: 1024, height: 43691 },
    { width: 512, height: 21846 }, { width: 256, height: 10923 }, { width: 128, height: 5462 }];
  assert.equal(proxyLevel(levels, 8e6), 5);                               // 256 x 10,923 = 2.8 MP; 512 x 21,846 = 11.2 MP is too many
  assert.equal(proxyLevel(levels, 1e12), 0);
  assert.equal(proxyLevel(levels, 10), levels.length - 1);                // nothing fits: the coarsest
  assert.deepEqual(levelPositions({ rows: 2, cols: 3 }), [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]]);
});

function tileOf(channels, bits, fill) {
  const samples = bits === 16 ? new Uint16Array(TILE * TILE * channels) : new Uint8Array(TILE * TILE * channels);
  for (let i = 0; i < samples.length; i++) samples[i] = fill(i);
  return new Uint8Array(samples.buffer);
}

test('a level is assembled from its tiles into RGBA, edge tiles cut to the level size', () => {
  const level = { width: 600, height: 520, rows: 2, cols: 2 };
  const tiles = levelPositions(level).map(([row, col]) => ({ row, col, bytes: tileOf(3, 8, (i) => (row * 50 + col * 7 + (i % 3)) & 255) }));
  const { w, h, rgba, rgba16 } = assembleLevel(tiles, level, 3, 8);
  assert.deepEqual([w, h, rgba.length, rgba16], [600, 520, 600 * 520 * 4, null]);
  assert.deepEqual([...rgba.subarray(0, 4)], [0, 1, 2, 255]);
  const at = (x, y) => [...rgba.subarray((y * 600 + x) * 4, (y * 600 + x) * 4 + 4)];
  assert.deepEqual(at(599, 0), [7, 8, 9, 255]);                           // tile (0, 1)
  assert.deepEqual(at(0, 519), [50, 51, 52, 255]);                        // tile (1, 0)
  assert.deepEqual(at(599, 519), [57, 58, 59, 255]);
});

test('grey is copied to R, G and B; RGBA keeps its alpha; 16 bits keep their samples and show the high byte', () => {
  const level = { width: 3, height: 2, rows: 1, cols: 1 };
  const grey = assembleLevel([{ row: 0, col: 0, bytes: tileOf(1, 8, () => 77) }], level, 1, 8);
  assert.deepEqual([...grey.rgba.subarray(0, 4)], [77, 77, 77, 255]);
  const rgba = assembleLevel([{ row: 0, col: 0, bytes: tileOf(4, 8, (i) => (i % 4 === 3 ? 9 : 100)) }], level, 4, 8);
  assert.deepEqual([...rgba.rgba.subarray(0, 4)], [100, 100, 100, 9]);
  const wide = assembleLevel([{ row: 0, col: 0, bytes: tileOf(1, 16, () => 0x1234) }], level, 1, 16);
  assert.deepEqual([...wide.rgba16.subarray(0, 4)], [0x1234, 0x1234, 0x1234, 65535]);
  assert.deepEqual([...wide.rgba.subarray(0, 4)], [0x12, 0x12, 0x12, 255]);
});

test('a missing, misplaced or wrongly sized tile is an error, never a partial image', () => {
  const level = { width: 600, height: 300, rows: 1, cols: 2 };
  assert.throws(() => assembleLevel([{ row: 0, col: 0, bytes: tileOf(1, 8, () => 1) }], level, 1, 8), /missing tiles/);
  assert.throws(() => assembleLevel([{ row: 0, col: 2, bytes: tileOf(1, 8, () => 1) }], level, 1, 8), /does not match/);
  assert.throws(() => assembleLevel([{ row: 0, col: 0, bytes: new Uint8Array(10) }], level, 1, 8), /does not match/);
  assert.throws(() => assembleLevel([], level, 2, 8), /unsupported/);
});

test('a tile becomes 8-bit RGBA for display, padding included', async () => {
  const { tileRgba } = await import('../../app/js/tiledsection.js');
  const grey16 = tileRgba(tileOf(1, 16, (i) => (i === 0 ? 0xabcd : 0x0100)), 1, 16);
  assert.equal(grey16.length, TILE * TILE * 4);
  assert.deepEqual([...grey16.subarray(0, 8)], [0xab, 0xab, 0xab, 255, 1, 1, 1, 255]);
  const rgba = tileRgba(tileOf(4, 8, (i) => i % 4 * 10), 4, 8);
  assert.deepEqual([...rgba.subarray(0, 4)], [0, 10, 20, 30]);
  assert.throws(() => tileRgba(new Uint8Array(10), 3, 8), /does not match/);
});
