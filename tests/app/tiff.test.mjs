import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { decodeTiffBlocks } from '../../app/js/tiff.js';
import { applyFilters, autoLevels, DEFAULT_FILTERS } from '../../app/js/imageproc.js';

function tiffFixture({ big = false, little = true, tiled = false, rgb = false, virtual = false, signed = false } = {}) {
  const fw = 5, fh = 4, channels = rgb ? 3 : 1, bw = tiled ? 3 : fw, bh = 2;
  const across = Math.ceil(fw / bw), blocks = [], compression = tiled ? 8 : 1;
  const sample = (x, y, c) => 32768 + x * 7 + y * 25 + c * 120;
  for (let by = 0; by < fh / bh; by++) for (let bx = 0; bx < across; bx++) {
    const data = new DataView(new ArrayBuffer(bw * bh * channels * 2));
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) for (let c = 0; c < channels; c++) {
      const value = tiled && x > 0 ? 7 : sample(bx * bw + x, by * bh + y, c);
      data.setUint16(((y * bw + x) * channels + c) * 2, value, little);
    }
    blocks.push(tiled ? deflateSync(new Uint8Array(data.buffer)) : new Uint8Array(data.buffer));
  }
  const offsetTag = tiled ? 324 : 273, lengthTag = tiled ? 325 : 279;
  const long = big ? 16 : 4;
  const fields = [
    [256, 4, [fw]], [257, 4, [fh]], [258, 3, new Array(channels).fill(16)], [259, 3, [compression]],
    [262, 3, [rgb ? 2 : 1]], [277, 3, [channels]], [317, 3, [tiled ? 2 : 1]], [339, 3, [signed ? 2 : 1]],
    [offsetTag, long, blocks.map(() => 0)], [lengthTag, long, blocks.map((b) => b.length)],
    ...(tiled ? [[322, 4, [bw]], [323, 4, [bh]]] : [[278, 4, [bh]]]),
  ].sort((a, b) => a[0] - b[0]);
  const word = big ? 8 : 4, ifd = big ? 16 : 8, count = big ? 8 : 2, entry = big ? 20 : 12;
  const metadata = new DataView(new ArrayBuffer(2048));
  function put(o, n, value) {
    if (n === 2) metadata.setUint16(o, value, little);
    else if (n === 4) metadata.setUint32(o, value, little);
    else metadata.setBigUint64(o, BigInt(value), little);
  }
  metadata.setUint16(0, little ? 0x4949 : 0x4d4d);
  put(2, 2, big ? 43 : 42);
  if (big) put(4, 2, 8);
  put(big ? 8 : 4, word, ifd);
  put(ifd, count, fields.length);
  let dataOffset = virtual ? 2 ** 32 + 2048 : metadata.byteLength;
  const ranges = [[0, new Uint8Array(metadata.buffer)]];
  for (const block of blocks) { ranges.push([dataOffset, block]); dataOffset += block.length; }
  let extra = ifd + count + fields.length * entry + word;
  fields.forEach(([tag, type, values], i) => {
    const pos = ifd + count + i * entry, valuePos = pos + 4 + word;
    const width = { 3: 2, 4: 4, 16: 8 }[type];
    const raw = tag === offsetTag ? ranges.slice(1).map(([offset]) => offset) : values;
    put(pos, 2, tag); put(pos + 2, 2, type); put(pos + 4, word, raw.length);
    if (raw.length * width <= word) raw.forEach((v, j) => put(valuePos + j * width, width, v));
    else {
      extra = Math.ceil(extra / word) * word;
      put(valuePos, word, extra);
      raw.forEach((v, j) => put(extra + j * width, width, v));
      extra += raw.length * width;
    }
  });
  const reads = [];
  const source = {
    size: dataOffset,
    slice(start, end) {
      reads.push([start, end]);
      const range = ranges.find(([offset, bytes]) => start >= offset && end <= offset + bytes.length);
      assert.ok(range, `unexpected range ${start}..${end}`);
      const [offset, bytes] = range;
      return new Blob([bytes.subarray(start - offset, end - offset)]);
    },
  };
  return { source, sample, reads };
}

const wholeTiff = (w, h) => ({ x: 0, y: 0, w, h });

test('16-bit TIFF strips preserve neighboring samples and drive automatic levels', async () => {
  for (const little of [false, true]) {
    const { source, sample } = tiffFixture({ little });
    const { rgba, rgba16, w, h } = await decodeTiffBlocks(source, wholeTiff, () => 1);
    assert.deepEqual([w, h], [5, 4]);
    assert.equal(rgba[0], rgba[4]);
    assert.equal(rgba16[0], sample(0, 0, 0));
    assert.equal(rgba16[4], sample(1, 0, 0));
    const levels = autoLevels(rgba16, w, h);
    const out = applyFilters(rgba16, w, h, { ...DEFAULT_FILTERS, ...levels });
    assert.ok(out[4] > out[0]);
  }
});

test('the factor callback learns the sample depth, so a 16-bit image can be reduced more (card H6)', async () => {
  const seen = [];
  await decodeTiffBlocks(tiffFixture({ signed: true }).source, wholeTiff, (w, h, bits) => { seen.push(bits); return 1; });
  await decodeTiffBlocks(tiffFixture({ big: true, little: false, tiled: true, rgb: true, virtual: true }).source, () => ({ x: 2, y: 1, w: 2, h: 2 }), (w, h, bits) => { seen.push(bits); return 2; });
  assert.deepEqual(seen, [16, 16]);
});

test('signed grayscale TIFF keeps the 16-bit samples in an offset working domain', async () => {
  const { source } = tiffFixture({ signed: true });
  const { rgba16 } = await decodeTiffBlocks(source, wholeTiff, () => 1);
  assert.deepEqual([...rgba16.subarray(0, 8)], [0, 0, 0, 65535, 7, 7, 7, 65535]);
});

test('BigTIFF ranges beyond 4 GiB decode Deflate tiles and average across their boundary', async () => {
  const { source, sample, reads } = tiffFixture({ big: true, little: false, tiled: true, rgb: true, virtual: true });
  const { rgba16, w, h } = await decodeTiffBlocks(source, () => ({ x: 2, y: 1, w: 2, h: 2 }), () => 2);
  assert.deepEqual([w, h], [1, 1]);
  const expected = [0, 1, 2].map((c) => Math.round(
    (sample(2, 1, c) + sample(3, 1, c) + sample(2, 2, c) + sample(3, 2, c)) / 4
  ));
  assert.deepEqual([...rgba16], [...expected, 65535]);
  assert.equal(reads.filter(([offset]) => offset > 2 ** 32).length, 4);
  assert.ok(reads.every(([start, end]) => end - start <= 2048));
});

test('a crop only reads intersecting strips and rejects truncated ranges', async () => {
  const { source, reads } = tiffFixture();
  const result = await decodeTiffBlocks(source, () => ({ x: 0, y: 2, w: 1, h: 1 }), () => 1);
  assert.equal(result.rgba16[0], 32818);
  assert.ok(reads.every(([offset]) => offset !== 2048));
  await assert.rejects(decodeTiffBlocks({ ...source, size: source.size - 1 }, wholeTiff, () => 1), /TIFF block range/);
});
