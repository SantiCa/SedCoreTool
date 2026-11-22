// @ts-check
// The working pixels of a section as the engine receives them (card M8.4.9): the arrays the interface decoded (after crop,
// downsampling and rotation), described as engine buffers, and an identity that names exactly those bytes. Pure: no DOM.
//
// `orig` is the 8-bit RGBA working image (`Uint8ClampedArray`, w*h*4) and `orig16`, when the source has 16 bits per channel,
// the same image at 16 bits (`Uint16Array`, w*h*4). Both are replaced by new arrays, never written in place, whenever the pixels
// change (load, reload, crop, rotation, a new downsampling factor), so the identity is computed once per array and remembered in
// `section._pxid` (weak references: it never keeps an array alive after the interface has released it).

/** Engine input names of the working pixels, in upload order; a new `rgba` replaces an older `rgba16` too (residentstore.js group). */
export const PIXEL_INPUTS = /** @type {const} */ (['rgba', 'rgba16']);
const PIXEL_IDENTITY_VERSION = 'pixels/1';

/** @param {Uint8Array} bytes @returns {Promise<string>} */
async function digestHex(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', /** @type {Uint8Array<ArrayBuffer>} */ (bytes)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
/** @param {ArrayBufferView} typed */
const viewBytes = (typed) => new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);

/**
 * @typedef {{dtype: 'u8' | 'u16le', shape: [number, number, number], data: Uint8Array | Uint8ClampedArray | Uint16Array}} PixelBuffer
 * @typedef {{rgba: PixelBuffer, rgba16?: PixelBuffer}} PixelBuffers
 */

/**
 * The working pixels of `section` as engine buffers: views of the interface's own arrays, nothing is copied. `rgba` is `u8[h,w,4]`,
 * `rgba16` (16-bit images only) `u16le[h,w,4]`, both C order with row 0 at the top. Throws for a section whose pixels are not in
 * memory, are not a working image of its size, or live in the tile store (a tiled section's `orig` is only a reduced copy).
 * @param {{w: number, h: number, orig?: any, orig16?: any, tiled?: any}} section
 * @returns {PixelBuffers}
 */
export function buildPixelBuffers(section) {
  const { w, h, orig, orig16 } = section;
  if (section.tiled) throw new Error('A tiled section keeps its pixels in the tile store');
  if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w < 1 || h < 1) throw new Error('The section has no valid working size');
  if (!orig) throw new Error('The section\'s pixels are not in memory');
  if (!(orig instanceof Uint8ClampedArray || orig instanceof Uint8Array) || orig.length !== w * h * 4) throw new Error('The 8-bit working image does not match the section size');
  if (orig16 != null && (!(orig16 instanceof Uint16Array) || orig16.length !== w * h * 4)) throw new Error('The 16-bit working image does not match the section size');
  /** @type {PixelBuffers} */
  const buffers = { rgba: { dtype: 'u8', shape: [h, w, 4], data: orig } };
  if (orig16) buffers.rgba16 = { dtype: 'u16le', shape: [h, w, 4], data: orig16 };
  return buffers;
}

/**
 * The buffers of `buildPixelBuffers` with the SHA-256 of each, and the identity of the whole: the SHA-256 of a short text that names
 * the width, height, bit depth and the hash of each buffer. The identity changes with any pixel, the size or the bit depth, and
 * with nothing else (filters, depths, settings and masks are not pixels). Hashing runs once per pair of arrays; later calls for the
 * same arrays answer from `section._pxid`.
 * @param {{w: number, h: number, orig?: any, orig16?: any, tiled?: any, _pxid?: any}} section
 * @returns {Promise<{identity: string, buffers: {rgba: PixelBuffer & {sha256: string}, rgba16?: PixelBuffer & {sha256: string}}}>}
 */
export async function describePixels(section) {
  const buffers = buildPixelBuffers(section);
  const cached = section._pxid;
  const current = cached && cached.w === section.w && cached.h === section.h && cached.rgba.deref() === section.orig
    && (cached.rgba16 ? cached.rgba16.deref() === section.orig16 : !section.orig16);
  if (!current) {
    const rgba = await digestHex(viewBytes(buffers.rgba.data)), rgba16 = buffers.rgba16 ? await digestHex(viewBytes(buffers.rgba16.data)) : '';
    const bits = buffers.rgba16 ? 16 : 8;
    const identity = await digestHex(new TextEncoder().encode(`${PIXEL_IDENTITY_VERSION}|${section.w}|${section.h}|${bits}|${rgba}|${rgba16}`));
    section._pxid = { w: section.w, h: section.h, rgba: new WeakRef(buffers.rgba.data), rgba16: buffers.rgba16 ? new WeakRef(buffers.rgba16.data) : null,
      identity, digests: { rgba, rgba16 } };
  }
  const { identity, digests } = section._pxid;
  return { identity, buffers: { rgba: { ...buffers.rgba, sha256: digests.rgba }, ...(buffers.rgba16 ? { rgba16: { ...buffers.rgba16, sha256: digests.rgba16 } } : {}) } };
}

/** The identity of the section's working pixels (see `describePixels`). @param {any} section @returns {Promise<string>} */
export async function pixelIdentity(section) { return (await describePixels(section)).identity; }
