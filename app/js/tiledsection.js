// @ts-check
// Tiled sections (card M8.4.15, ARCHITECTURE §3.4 "Design of part C"): pure helpers, no DOM, tested in Node.
//
// A tiled section keeps a small working image taken from one level of its pixel pyramid (at most the "maximum size when adding images"),
// so the rest of the program works on it as on a reduced section of today's path; the viewer draws full-resolution tiles over it when the
// zoom needs them. These helpers decide when an image goes to the tile store, which level is the working image, and assemble a level's tiles.
import { decodeTiffBlocks, highBytes } from './tiff.js';

export const TILE = 512;
const HEAD_BYTES = 256 * 1024, MAX_HEAD_BYTES = 4 * 1024 * 1024;
const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/**
 * Width and height of a TIFF, JPEG or PNG read from its header, without decoding pixels; null when the format or header is not recognised.
 * @param {Blob} blob
 * @returns {Promise<{w: number, h: number} | null>}
 */
export async function imageDimensions(blob) {
  const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  if (head.length >= 8 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    const ihdr = new DataView(await blob.slice(16, 24).arrayBuffer());
    return ihdr.byteLength === 8 ? { w: ihdr.getUint32(0), h: ihdr.getUint32(4) } : null;
  }
  if (head[0] === 0xff && head[1] === 0xd8) {
    for (let size = HEAD_BYTES; size <= MAX_HEAD_BYTES; size *= 4) {     // the frame header follows the metadata segments
      const bytes = new Uint8Array(await blob.slice(0, size).arrayBuffer());
      let i = 2;
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) return null;
        const marker = bytes[i + 1];
        if (marker === 0xff) { i++; continue; }                         // fill byte
        if (JPEG_SOF.has(marker)) return { h: (bytes[i + 5] << 8) | bytes[i + 6], w: (bytes[i + 7] << 8) | bytes[i + 8] };
        if (marker === 0xd9 || marker === 0xda) return null;            // end of image or start of scan before a frame header
        i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
      }
      if (bytes.length < size) return null;
    }
    return null;
  }
  const tiff = (head[0] === 0x49 && head[1] === 0x49) || (head[0] === 0x4d && head[1] === 0x4d);
  if (!tiff) return null;
  const found = { dims: /** @type {{w: number, h: number} | null} */ (null) };
  const stop = new Error('dimensions read');
  try {
    // The program's own block reader reads the header and the first directory, then asks for the area: stop there.
    const result = await decodeTiffBlocks(blob, (w, h) => { found.dims = { w, h }; throw stop; }, () => 1);
    if (result && 'fw' in result && !('rgba' in result)) return { w: result.fw, h: result.fh };   // a layout the block reader leaves to the old decoder
  } catch (error) {
    if (error !== stop) return null;
  }
  return found.dims;
}

/**
 * The working image of a tiled section: the finest level whose pixels do not exceed `maxPixels` (the last level otherwise).
 * @param {{width: number, height: number}[]} levels finest first, as pyramid.json lists them
 * @param {number} maxPixels
 */
export function proxyLevel(levels, maxPixels) {
  const index = levels.findIndex((level) => level.width * level.height <= maxPixels);
  return index < 0 ? levels.length - 1 : index;
}

/** @param {{rows: number, cols: number}} level @returns {[number, number][]} every tile position, row by row */
export function levelPositions(level) {
  const out = /** @type {[number, number][]} */ ([]);
  for (let row = 0; row < level.rows; row++) for (let col = 0; col < level.cols; col++) out.push([row, col]);
  return out;
}

/**
 * One tile's samples as 8-bit RGBA for display (TILE x TILE, padding included): grey copied to R, G and B, 16-bit shown by its high byte
 * (as `tiff.js` shows 16-bit images), alpha 255 unless the source has an alpha channel.
 * @param {Uint8Array} bytes @param {number} channels 1, 3 or 4 @param {number} bits 8 or 16
 */
export function tileRgba(bytes, channels, bits) {
  const pixels = TILE * TILE, wide = bits === 16;
  if (![1, 3, 4].includes(channels) || ![8, 16].includes(bits) || bytes.byteLength !== pixels * channels * (bits / 8)) throw new Error('tile does not match its samples');
  const samples = wide ? new Uint16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) : bytes, shift = wide ? 8 : 0;
  const out = new Uint8ClampedArray(pixels * 4);
  for (let p = 0, s = 0, o = 0; p < pixels; p++, s += channels, o += 4) {
    const r = samples[s] >>> shift;
    out[o] = r;
    out[o + 1] = channels === 1 ? r : samples[s + 1] >>> shift;
    out[o + 2] = channels === 1 ? r : samples[s + 2] >>> shift;
    out[o + 3] = channels === 4 ? samples[s + 3] >>> shift : 255;
  }
  return out;
}

/**
 * One level of a pyramid as the RGBA working image of today's path: 8-bit RGBA for display, and, for a 16-bit source, the 16-bit RGBA
 * samples too (the 8-bit value is the 16-bit one shifted right by 8, as `tiff.js` does). Grey is copied to R, G and B; alpha is 255 (65535)
 * unless the source has an alpha channel.
 * @param {{row: number, col: number, bytes: Uint8Array}[]} tiles every tile of the level (each TILE x TILE x channels samples, C order)
 * @param {{width: number, height: number, rows: number, cols: number}} level
 * @param {number} channels 1, 3 or 4
 * @param {number} bits 8 or 16
 */
export function assembleLevel(tiles, level, channels, bits) {
  if (![1, 3, 4].includes(channels) || ![8, 16].includes(bits)) throw new Error('unsupported tile samples');
  const { width: w, height: h } = level, wide = bits === 16, max = wide ? 65535 : 255;
  const output = wide ? new Uint16Array(w * h * 4) : new Uint8ClampedArray(w * h * 4);
  const tileBytes = TILE * TILE * channels * (bits / 8);
  const seen = new Set();
  for (const { row, col, bytes } of tiles) {
    if (bytes.byteLength !== tileBytes || row < 0 || row >= level.rows || col < 0 || col >= level.cols) throw new Error('tile does not match the level');
    seen.add(row * level.cols + col);
    const samples = wide ? new Uint16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) : bytes;
    const y0 = row * TILE, x0 = col * TILE, rows = Math.min(TILE, h - y0), cols = Math.min(TILE, w - x0);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const s = (y * TILE + x) * channels, o = ((y0 + y) * w + x0 + x) * 4;
        const r = samples[s];
        output[o] = r;
        output[o + 1] = channels === 1 ? r : samples[s + 1];
        output[o + 2] = channels === 1 ? r : samples[s + 2];
        output[o + 3] = channels === 4 ? samples[s + 3] : max;
      }
    }
  }
  if (seen.size !== level.rows * level.cols) throw new Error('missing tiles');
  const rgba = wide ? highBytes(/** @type {Uint16Array} */ (output)) : /** @type {Uint8ClampedArray} */ (output);
  return { w, h, rgba, rgba16: wide ? /** @type {Uint16Array} */ (output) : null };
}
