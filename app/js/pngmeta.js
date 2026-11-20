// SedCoreTool — PNG metadata chunks (card P1): physical resolution (`pHYs`) and text (`tEXt`). Pure: no DOM, bytes in, bytes out.
// A PNG is an 8-byte signature followed by chunks: length (4, big-endian), type (4), data, CRC-32 of type and data (4).
import { crc32 } from './zip.js';

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const MAX_TEXT_KEY = 79;

const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length), view = new DataView(out.buffer), name = ascii(type);
  view.setUint32(0, data.length);
  out.set(name, 4); out.set(data, 8);
  view.setUint32(8 + data.length, crc32(data, crc32(name)));
  return out;
}

/** Chunks of a PNG as {type, start, end} (offsets of the whole chunk). Throws on a missing signature or a chunk that runs past the end. */
function chunks(png) {
  if (!(png instanceof Uint8Array) || png.length < 33 || SIGNATURE.some((b, i) => png[i] !== b)) throw new Error('Not a PNG file');
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength), out = [];
  for (let at = 8; at < png.length;) {
    if (at + 12 > png.length) throw new Error('Truncated PNG chunk');
    const size = view.getUint32(at), end = at + 12 + size;
    if (end > png.length) throw new Error('Truncated PNG chunk');
    out.push({ type: String.fromCharCode(png[at + 4], png[at + 5], png[at + 6], png[at + 7]), start: at, end });
    at = end;
  }
  if (out[0]?.type !== 'IHDR') throw new Error('PNG does not start with IHDR');
  return out;
}

/** The PNG with `extra` chunks inserted after IHDR (or before the first IDAT) and the chunks of the types in `drop` removed. */
function rebuild(png, extra, drop, beforeIdat) {
  const list = chunks(png), parts = [png.subarray(0, 8)];
  let placed = false;
  const place = () => { if (!placed) { parts.push(...extra); placed = true; } };
  for (const c of list) {
    if (drop.includes(c.type)) continue;
    if (beforeIdat && c.type === 'IDAT') place();
    parts.push(png.subarray(c.start, c.end));
    if (!beforeIdat && c.type === 'IHDR') place();
  }
  place();
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/**
 * The PNG with a `pHYs` chunk giving `dpi` dots per inch in both directions (unit: metre), placed right after IHDR; an existing `pHYs` is replaced.
 * 600 dpi is stored as 23622 pixels per metre.
 */
export function withPhys(png, dpi) {
  if (!(dpi > 0) || !Number.isFinite(dpi)) throw new RangeError('dpi must be a positive number');
  const data = new Uint8Array(9), view = new DataView(data.buffer), ppm = Math.round(dpi / 0.0254);
  view.setUint32(0, ppm); view.setUint32(4, ppm); data[8] = 1;
  return rebuild(png, [chunk('pHYs', data)], ['pHYs'], false);
}

/**
 * The PNG with a `tEXt` chunk (Latin-1 keyword and text) before the image data. The keyword has 1-79 characters; characters outside Latin-1
 * in the text are replaced by `?` because the chunk cannot hold them. Chunks with the same keyword are kept (PNG allows repeats).
 */
export function withText(png, key, text) {
  if (typeof key !== 'string' || key.length < 1 || key.length > MAX_TEXT_KEY || /[^\x20-\x7e\xa1-\xff]/.test(key) || key.startsWith(' ') || key.endsWith(' ')) {
    throw new RangeError('PNG text keyword must be 1-79 printable Latin-1 characters without leading or trailing space');
  }
  const body = String(text).replace(/\0/g, ' '), latin = Uint8Array.from(body, (c) => (c.charCodeAt(0) <= 255 ? c.charCodeAt(0) : 63));
  const keyBytes = Uint8Array.from(key, (c) => c.charCodeAt(0)), data = new Uint8Array(keyBytes.length + 1 + latin.length);
  data.set(keyBytes); data.set(latin, keyBytes.length + 1);
  return rebuild(png, [chunk('tEXt', data)], [], true);
}

/** The `pHYs` chunk of a PNG as {ppmX, ppmY, dpiX, dpiY, unit}, or null when it has none. Used by tests and by the checks list. */
export function readPhys(png) {
  const c = chunks(png).find((x) => x.type === 'pHYs');
  if (!c || c.end - c.start !== 21) return null;
  const view = new DataView(png.buffer, png.byteOffset + c.start + 8, 9), ppmX = view.getUint32(0), ppmY = view.getUint32(4), unit = view.getUint8(8);
  return { ppmX, ppmY, unit, dpiX: ppmX * 0.0254, dpiY: ppmY * 0.0254 };
}
