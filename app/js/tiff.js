/** Range decoder for the first image in a classic TIFF or BigTIFF. */
const TIFF_BLOCK_BYTES = 64 * 1024 * 1024;
const TIFF_READ_BYTES = 4 * 1024 * 1024;
const TIFF_UINT_BYTES = { 1: 1, 3: 2, 4: 4, 16: 8 };

class TiffDirectory {
  constructor(source, little, big) {
    this.source = source;
    this.little = little;
    this.big = big;
    this.tags = new Map();
  }

  async read(offset, length) {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) ||
        offset < 0 || length < 0 || offset > this.source.size - length) throw new Error('Invalid TIFF byte range');
    const bytes = await this.source.slice(offset, offset + length).arrayBuffer();
    if (bytes.byteLength !== length) throw new Error('Truncated TIFF');
    return new DataView(bytes);
  }

  uint(view, offset, size) {
    if (size === 1) return view.getUint8(offset);
    if (size === 2) return view.getUint16(offset, this.little);
    if (size === 4) return view.getUint32(offset, this.little);
    const value = Number(view.getBigUint64(offset, this.little));
    if (!Number.isSafeInteger(value)) throw new Error('TIFF integer exceeds the supported range');
    return value;
  }

  async open() {
    const word = this.big ? 8 : 4, countBytes = this.big ? 8 : 2;
    const head = await this.read(0, this.big ? 16 : 8);
    if (this.big && (this.uint(head, 4, 2) !== 8 || this.uint(head, 6, 2) !== 0)) throw new Error('Invalid BigTIFF header');
    const offset = this.uint(head, this.big ? 8 : 4, word);
    const count = this.uint(await this.read(offset, countBytes), 0, countBytes);
    if (count > 65535) throw new Error('Too many TIFF tags');
    const entryBytes = this.big ? 20 : 12;
    const entries = await this.read(offset + countBytes, count * entryBytes);
    for (let i = 0; i < count; i++) {
      const pos = i * entryBytes, tag = this.uint(entries, pos, 2);
      const width = TIFF_UINT_BYTES[this.uint(entries, pos + 2, 2)];
      if (!width) continue;
      const n = this.uint(entries, pos + 4, word);
      const valuePos = pos + 4 + word;
      this.tags.set(tag, { n, width, entries, valuePos, word });
    }
  }

  async values(tag, start, count) {
    const entry = this.tags.get(tag);
    if (!entry || start + count > entry.n) throw new Error('Incomplete TIFF tag ' + tag);
    const { n, width, entries, valuePos, word } = entry;
    const inline = n * width <= word;
    const view = inline ? entries : await this.read(this.uint(entries, valuePos, word) + start * width, count * width);
    const base = inline ? valuePos + start * width : 0;
    return Array.from({ length: count }, (_, i) => this.uint(view, base + i * width, width));
  }

  async number(tag, fallback) {
    return this.tags.has(tag) ? (await this.values(tag, 0, 1))[0] : fallback;
  }
}

/** TIFF LZW uses MSB-first codes and increases the code size one entry early. */
function tiffLzw(input, output) {
  const prefix = new Uint16Array(4096), suffix = new Uint8Array(4096), stack = new Uint8Array(4096);
  let bit = 0, pos = 0, next = 258, width = 9, previous = -1, first = 0;
  while (bit + width <= input.length * 8) {
    let code = 0;
    for (let i = 0; i < width; i++, bit++) code = (code << 1) | ((input[bit >>> 3] >>> (7 - (bit & 7))) & 1);
    if (code === 256) { next = 258; width = 9; previous = -1; continue; }
    if (code === 257) break;
    if (code > next || (code === next && previous < 0)) throw new Error('Invalid TIFF LZW code');
    let size = 0, entry = code;
    if (code === next) { stack[size++] = first; entry = previous; }
    while (entry >= 258) { stack[size++] = suffix[entry]; entry = prefix[entry]; }
    first = entry;
    stack[size++] = first;
    if (pos + size > output.length) throw new Error('Oversized TIFF LZW block');
    while (size) output[pos++] = stack[--size];
    if (previous >= 0 && next < 4096) {
      prefix[next] = previous;
      suffix[next++] = first;
      if (width < 12 && next === (1 << width) - 1) width++;
    }
    previous = code;
  }
  return pos;
}

function tiffPackBits(input, output) {
  let pos = 0;
  for (let i = 0; i < input.length;) {
    const code = input[i++];
    if (code === 128) continue;
    const length = code < 128 ? code + 1 : 257 - code;
    const consumed = code < 128 ? length : 1;
    if (i + consumed > input.length || pos + length > output.length) throw new Error('Invalid TIFF PackBits block');
    if (code < 128) output.set(input.subarray(i, i + length), pos);
    else output.fill(input[i], pos, pos + length);
    i += consumed;
    pos += length;
  }
  return pos;
}

async function tiffInflate(input, output) {
  const reader = new Blob([input]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  let pos = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return pos;
      if (pos + value.length > output.length) throw new Error('Oversized TIFF Deflate block');
      output.set(value, pos);
      pos += value.length;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

async function tiffDecodeBlock(compression, input, length) {
  const out = new Uint8Array(length);
  const size = compression === 5 ? tiffLzw(input, out) :
    compression === 32773 ? tiffPackBits(input, out) : await tiffInflate(input, out);
  if (size !== length) throw new Error('Incomplete TIFF block');
  return new DataView(out.buffer);
}

/**
 * Decode only intersecting strips or tiles. Unsupported classic TIFF layouts
 * return metadata so the caller can bound its legacy decoder.
 */
export async function decodeTiffBlocks(source, chooseArea, chooseFactor) {
  const header = new DataView(await source.slice(0, 4).arrayBuffer());
  if (header.byteLength !== 4) throw new Error('Truncated TIFF header');
  const order = header.getUint16(0);
  if (order !== 0x4949 && order !== 0x4d4d) throw new Error('Invalid TIFF byte order');
  const little = order === 0x4949, version = header.getUint16(2, little), big = version === 43;
  if (version !== 42 && !big) throw new Error('Invalid TIFF version');
  const directory = new TiffDirectory(source, little, big);
  await directory.open();
  const fw = await directory.number(256, 0), fh = await directory.number(257, 0);
  if (!fw || !fh || !Number.isSafeInteger(fw * fh)) throw new Error('Invalid TIFF dimensions');
  const channels = await directory.number(277, 1);
  const bits = await directory.number(258, 1), compression = await directory.number(259, 1);
  const photometric = await directory.number(262, 1), predictor = await directory.number(317, 1);
  const tiled = directory.tags.has(322);
  const gray = channels === 1 && (photometric === 0 || photometric === 1);
  const signed = gray && bits === 16 && (await directory.number(339, 1)) === 2;
  const rgb = (channels === 3 || channels === 4) && photometric === 2;
  const matches = async (tag, value) => {
    const count = directory.tags.get(tag)?.n ?? 0;
    return !count || (count <= channels && (await directory.values(tag, 0, count)).every((v) => v === value));
  };
  if (!(gray || rgb) || ![8, 16].includes(bits) || !(await matches(258, bits)) || !(await matches(339, signed ? 2 : 1)) ||
      (await directory.number(284, 1)) !== 1 || (await directory.number(266, 1)) !== 1 ||
      ![1, 2].includes(predictor) || ![1, 5, 8, 32946, 32773].includes(compression) ||
      ((compression === 8 || compression === 32946) && typeof DecompressionStream !== 'function')) {
    if (big) throw new Error('Unsupported BigTIFF pixel layout or compression');
    const bitCount = directory.tags.get(258)?.n ?? 0;
    const declaredBits = bitCount > 64 ? Infinity : bitCount ?
      Math.max(bits * channels, (await directory.values(258, 0, bitCount)).reduce((a, b) => a + b, 0)) : channels;
    return { fw, fh, legacyBytes: fh * Math.ceil(fw * declaredBits / 8) + fw * fh * 4 };
  }

  const area = chooseArea(fw, fh), k = chooseFactor(area.w, area.h, bits);   // bits: the caller's memory estimate depends on 8 or 16 bits
  if (!Number.isInteger(k) || k < 1) throw new Error('Invalid TIFF reduction factor');
  const w = Math.floor(area.w / k), h = Math.floor(area.h / k), pixels = w * h;
  if (!w || !h || !Number.isSafeInteger(pixels)) throw new Error('Empty TIFF working area');
  const wide = bits === 16, max = wide ? 65535 : 255, bytes = bits / 8;
  const output = wide ? new Uint16Array(pixels * 4) : new Uint8ClampedArray(pixels * 4);
  const colorChannels = gray ? 1 : 3, divisor = k * k;
  const Sums = max * divisor <= 0xffffffff ? Uint32Array : Float64Array;
  const sums = k > 1 ? new Sums(pixels * colorChannels) : null;
  const bw = tiled ? await directory.number(322, 0) : fw;
  const bh = tiled ? await directory.number(323, 0) : Math.min(fh, await directory.number(278, fh));
  if (!bw || !bh || !Number.isSafeInteger(bw * bh * channels * bytes)) throw new Error('Invalid TIFF block dimensions');
  const across = Math.ceil(fw / bw), right = area.x + w * k, bottom = area.y + h * k;
  const offsetTag = tiled ? 324 : 273, lengthTag = tiled ? 325 : 279;
  const rowBytes = bw * channels * bytes;
  const value = (view, i) => wide ? view.getUint16(i * 2, little) : view.getUint8(i);

  function copyRows(view, x, y, rows) {
    const firstX = Math.max(x, area.x), lastX = Math.min(x + bw, right);
    for (let sy = Math.max(y, area.y); sy < Math.min(y + rows, bottom); sy++) {
      const base = (sy - y) * bw * channels;
      const row = Math.floor((sy - area.y) / k) * w;
      let red = 0, green = 0, blue = 0, alpha = 0;
      for (let sx = predictor === 2 ? x : firstX; sx < lastX; sx++) {
        const index = base + (sx - x) * channels;
        red = (value(view, index) + (predictor === 2 ? red : 0)) & max;
        if (rgb) {
          green = (value(view, index + 1) + (predictor === 2 ? green : 0)) & max;
          blue = (value(view, index + 2) + (predictor === 2 ? blue : 0)) & max;
          if (channels === 4) alpha = (value(view, index + 3) + (predictor === 2 ? alpha : 0)) & max;
        }
        if (sx < firstX) continue;
        const target = row + Math.floor((sx - area.x) / k);
        // Offset signed grayscale into the unsigned working domain without discarding any bits.
        const sample = signed ? red ^ 0x8000 : red;
        const r = photometric === 0 ? max - sample : sample;
        if (sums) {
          const o = target * colorChannels;
          sums[o] += r;
          if (rgb) { sums[o + 1] += green; sums[o + 2] += blue; }
        } else {
          const o = target * 4;
          output[o] = r; output[o + 1] = gray ? r : green; output[o + 2] = gray ? r : blue;
          output[o + 3] = channels === 4 ? alpha : max;
        }
      }
    }
  }

  const firstBlock = Math.floor(area.x / bw), lastBlock = Math.ceil(right / bw);
  for (let by = Math.floor(area.y / bh); by < Math.ceil(bottom / bh); by++) {
    for (let bx = firstBlock; bx < lastBlock;) {
      const n = Math.min(256, lastBlock - bx), index = by * across + bx;
      const offsets = await directory.values(offsetTag, index, n);
      const lengths = await directory.values(lengthTag, index, n);
      for (let i = 0; i < n; i++, bx++) {
        const x = bx * bw, y = by * bh, rows = tiled ? bh : Math.min(bh, fh - y);
        const offset = offsets[i], size = lengths[i], decodedSize = rows * rowBytes;
        if (size === 0 || offset > source.size - size) throw new Error('Invalid TIFF block range');
        if (compression === 1) {
          if (size < decodedSize || rowBytes > TIFF_BLOCK_BYTES) throw new Error('Invalid or oversized TIFF row');
          const batch = Math.max(1, Math.floor(TIFF_READ_BYTES / rowBytes));
          const end = Math.min(rows, bottom - y);
          for (let start = Math.max(0, area.y - y); start < end; start += batch) {
            const count = Math.min(batch, end - start);
            const view = await directory.read(offset + start * rowBytes, count * rowBytes);
            copyRows(view, x, y + start, count);
          }
        } else {
          if (size > TIFF_BLOCK_BYTES || decodedSize > TIFF_BLOCK_BYTES) throw new Error('TIFF block exceeds 64 MiB');
          const data = await directory.read(offset, size);
          const view = await tiffDecodeBlock(compression, new Uint8Array(data.buffer), decodedSize);
          copyRows(view, x, y, rows);
        }
      }
    }
  }

  if (sums) for (let i = 0; i < pixels; i++) {
    const o = i * 4, s = i * colorChannels;
    const r = sums[s] / divisor, g = gray ? r : sums[s + 1] / divisor, b = gray ? r : sums[s + 2] / divisor;
    output[o] = wide ? Math.round(r) : r;
    output[o + 1] = wide ? Math.round(g) : g;
    output[o + 2] = wide ? Math.round(b) : b;
    output[o + 3] = max;
  }
  const rgba = wide ? Uint8ClampedArray.from(output, (sample) => sample >>> 8) : output;
  return { w, h, rgba, rgba16: wide ? output : null, k, fw, fh };
}
