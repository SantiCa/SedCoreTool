// Card M8.4.9: the working pixels of a section as engine buffers, and their identity (app/js/sectionpixels.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildPixelBuffers, describePixels, pixelIdentity, PIXEL_INPUTS } from '../../app/js/sectionpixels.js';
import { downsampleRGBA, rotate90 } from '../../app/js/imageproc.js';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** A seeded section as the interface keeps it; `bits: 16` adds the 16-bit working image. */
function section(seed, { w = 13, h = 21, bits = 8 } = {}) {
  let state = seed; const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const orig16 = bits === 16 ? Uint16Array.from({ length: w * h * 4 }, () => Math.floor(random() * 65536)) : null;
  const orig = orig16 ? Uint8ClampedArray.from(orig16, (v) => v >> 8) : Uint8ClampedArray.from({ length: w * h * 4 }, () => Math.floor(random() * 256));
  return { w, h, orig, orig16, top: 0, bottom: 100, units: 'cm', filters: { gamma: 1 }, roi: { x0: 0, y0: 0, x1: w, y1: h }, enh: null };
}
/** The crop of the interface (app.js::applyCrop): rows [y0, y1) of new arrays. */
function crop(s, y0, y1) {
  const cut = (arr) => arr.slice(y0 * s.w * 4, y1 * s.w * 4);
  s.orig = cut(s.orig); if (s.orig16) s.orig16 = cut(s.orig16); s.h = y1 - y0;
}
/** The rotation of the interface (app.js, rotate90 of every working array, then width and height swapped). */
function rotate(s, dir = 1) {
  s.orig = rotate90(s.orig, s.w, s.h, 4, dir); if (s.orig16) s.orig16 = rotate90(s.orig16, s.w, s.h, 4, dir); [s.w, s.h] = [s.h, s.w];
}

test('the buffers are views of the working arrays: u8[h,w,4] and, for 16 bits, u16le[h,w,4]', () => {
  const s8 = section(1), s16 = section(2, { bits: 16 });
  const b8 = buildPixelBuffers(s8), b16 = buildPixelBuffers(s16);
  assert.deepEqual(Object.keys(b8), ['rgba']);
  assert.deepEqual([b8.rgba.dtype, b8.rgba.shape], ['u8', [21, 13, 4]]);
  assert.equal(b8.rgba.data, s8.orig, 'no copy');
  assert.deepEqual(Object.keys(b16), [...PIXEL_INPUTS]);
  assert.deepEqual([b16.rgba16.dtype, b16.rgba16.shape], ['u16le', [21, 13, 4]]);
  assert.equal(b16.rgba16.data, s16.orig16);
});

test('sections without usable working pixels are refused, naming why', () => {
  assert.throws(() => buildPixelBuffers({ ...section(1), orig: null }), /not in memory/);
  assert.throws(() => buildPixelBuffers({ ...section(1), w: 12 }), /8-bit working image/);
  assert.throws(() => buildPixelBuffers({ ...section(1), orig: new Float32Array(13 * 21 * 4) }), /8-bit working image/);
  assert.throws(() => buildPixelBuffers({ ...section(1), orig16: new Uint16Array(3) }), /16-bit working image/);
  assert.throws(() => buildPixelBuffers({ ...section(1), orig16: new Uint8Array(13 * 21 * 4) }), /16-bit working image/);
  assert.throws(() => buildPixelBuffers({ ...section(1), w: 0 }), /working size/);
  assert.throws(() => buildPixelBuffers({ ...section(1), tiled: { levels: [] } }), /tile store/);
});

test('each buffer carries the SHA-256 of its bytes, and the identity names size, bit depth and both hashes', async () => {
  const s = section(3, { bits: 16 }), described = await describePixels(s);
  assert.equal(described.buffers.rgba.sha256, sha(Buffer.from(s.orig.buffer)));
  assert.equal(described.buffers.rgba16.sha256, sha(Buffer.from(s.orig16.buffer)));
  assert.equal(described.identity, sha(`pixels/1|13|21|16|${described.buffers.rgba.sha256}|${described.buffers.rgba16.sha256}`));
  const s8 = section(3);
  assert.equal(await pixelIdentity(s8), sha(`pixels/1|13|21|8|${sha(Buffer.from(s8.orig.buffer))}|`));
});

test('the identity changes on crop, rotation, downsampling and a reload with other pixels, for 8 and 16 bits', async () => {
  for (const bits of [8, 16]) {
    const s = section(4, { bits }), seen = new Set([await pixelIdentity(s)]);
    const changed = async (label) => { const id = await pixelIdentity(s); assert.ok(!seen.has(id), `${bits} bits: ${label} changes the identity`); seen.add(id); };
    crop(s, 2, 19); await changed('crop');
    rotate(s); await changed('rotation by 90 degrees');
    rotate(s); rotate(s); await changed('rotation by 180 degrees more');
    const { rgba: small, w, h } = downsampleRGBA(s.orig16 || s.orig, s.w, s.h, 2);
    s.orig = small instanceof Uint16Array ? Uint8ClampedArray.from(small, (v) => v >> 8) : small; s.orig16 = small instanceof Uint16Array ? small : null; s.w = w; s.h = h;
    await changed('a new downsampling factor');
    const reloaded = section(5, { bits, w: s.w, h: s.h }); s.orig = reloaded.orig; s.orig16 = reloaded.orig16;
    await changed('a reload with other pixels');
    const one = new Uint8ClampedArray(s.orig); one[7] ^= 1; s.orig = one;
    await changed('one 8-bit value');
    if (bits === 16) { const wide = new Uint16Array(s.orig16); wide[5] ^= 256; s.orig16 = wide; await changed('one 16-bit value'); }
  }
});

test('the identity does not change with settings, depths, filters, the enhanced image or a reload of the same pixels', async () => {
  const s = section(6, { bits: 16 }), before = await pixelIdentity(s);
  Object.assign(s, { top: 12, bottom: 40, units: 'mm', filters: { gamma: 2 }, roi: { x0: 1, y0: 2, x1: 5, y1: 9 }, enh: new Uint8ClampedArray(s.orig), binCm: 3 });
  assert.equal(await pixelIdentity(s), before);
  s.orig = new Uint8ClampedArray(s.orig); s.orig16 = new Uint16Array(s.orig16);   // the interface released the pixels and decoded them again
  assert.equal(await pixelIdentity(s), before, 'the same bytes have the same identity, so nothing is uploaded again');
  const shape = section(6, { bits: 16, w: 21, h: 13 }); shape.orig = s.orig; shape.orig16 = s.orig16;
  assert.notEqual(await pixelIdentity(shape), before, 'the same bytes in another shape are other pixels');
});

test('an 8-bit and a 16-bit image never share an identity', async () => {
  const s = section(7, { bits: 16 }), wide = await pixelIdentity(s);
  s.orig16 = null;
  assert.notEqual(await pixelIdentity(s), wide);
});

test('hashing runs once per pair of arrays; the remembered identity holds no reference to the arrays', async () => {
  const s = section(8, { bits: 16 }), digest = crypto.subtle.digest.bind(crypto.subtle);
  let calls = 0;
  crypto.subtle.digest = (...args) => { calls++; return digest(...args); };
  try {
    const first = await describePixels(s);
    assert.equal(calls, 3, 'two buffers and the identity text');
    const again = await describePixels(s);
    assert.equal(calls, 3, 'answered from section._pxid');
    assert.deepEqual(again, first);
    s.orig = new Uint8ClampedArray(s.orig);
    await describePixels(s);
    assert.equal(calls, 6, 'a new array is hashed again');
  } finally { crypto.subtle.digest = digest; }
  const strong = Object.values(s._pxid).filter((value) => ArrayBuffer.isView(value));
  assert.deepEqual(strong, [], 'only weak references: the interface can still release the pixels');
});
