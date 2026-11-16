// Private engine framing. No Electron dependency, filesystem access or scientific calculation.
const { TextDecoder } = require('node:util');
const MAX_JSON = 65536, MAX_CHUNK = 1048576;
const decoder = new TextDecoder('utf-8', { fatal: true });

function parseControl(bytes) {
  const text = decoder.decode(bytes), stack = [];
  // JSON.parse supplies syntax validation; this pass rejects excessive depth and duplicate keys first.
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      const start = i++;
      while (i < text.length && text[i] !== '"') { if (text[i] === '\\') i++; i++; }
      if (i === text.length) throw new Error('Invalid control string');
      let following = i + 1;
      while (/\s/.test(text[following] || '') && following < text.length) following++;
      if (text[following] === ':') {
        const keys = stack.at(-1);
        if (!(keys instanceof Set)) throw new Error('Invalid control key');
        const key = JSON.parse(text.slice(start, i + 1));
        if (keys.has(key)) throw new Error('Duplicate control key');
        keys.add(key);
      }
    } else if (char === '{' || char === '[') {
      stack.push(char === '{' ? new Set() : null);
      if (stack.length > 16) throw new Error('Control nesting limit');
    } else if (char === '}' || char === ']') stack.pop();
  }
  return JSON.parse(text, (_key, value) => {
    if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) throw new Error('Invalid control number');
    return value;
  });
}

function frame(kind, bytes) {
  const limit = kind === 1 ? MAX_JSON : MAX_CHUNK;
  if (![1, 2].includes(kind) || !Buffer.isBuffer(bytes) || !bytes.length || bytes.length > limit) throw new Error('Frame limit');
  const header = Buffer.alloc(12);
  header.write('SCE1'); header[4] = kind; header.writeUInt32LE(bytes.length, 8);
  return [header, bytes];
}

function controlFrame(value) { return frame(1, Buffer.from(JSON.stringify(value))); }

/**
 * Reads engine frames. A binary frame is accepted only straight after a control frame whose handler returned its exact
 * length as `{ binaryBytes }` (a successful `buffer.read` response announces one), or as one of the lengths it returned in order as
 * `{ binaryFrames: [...] }` (a `tile.read` response announces up to 64); any other binary frame invalidates the session.
 */
class ControlReader {
  constructor(onControl, onBinary = null) {
    this.onControl = onControl; this.onBinary = onBinary; this.header = Buffer.alloc(12); this.used = 0; this.payload = null;
    this.kind = 1; this.expected = null; this.following = [];
  }
  push(chunk) {
    let offset = 0;
    while (offset < chunk.length) {
      const target = this.payload || this.header;
      const length = Math.min(target.length - this.used, chunk.length - offset);
      chunk.copy(target, this.used, offset); this.used += length; offset += length;
      if (this.used !== target.length) continue;
      this.used = 0;
      if (!this.payload) {
        const size = this.header.readUInt32LE(8), kind = this.header[4];
        const sizeOk = this.expected === null ? kind === 1 && size > 0 && size <= MAX_JSON : kind === 2 && size === this.expected;
        if (!this.header.subarray(0, 4).equals(Buffer.from('SCE1')) || this.header[5] || this.header.readUInt16LE(6) || !sizeOk) throw new Error('Invalid response header');
        this.payload = Buffer.alloc(size); this.kind = kind;
      } else if (this.kind === 1) {
        const value = parseControl(this.payload); this.payload = null;
        const announced = this.onControl(value);
        if (announced && typeof announced === 'object' && 'binaryBytes' in announced) {
          const size = announced.binaryBytes;
          if (!this.onBinary || !Number.isSafeInteger(size) || size < 1 || size > MAX_CHUNK) throw new Error('Invalid binary announcement');
          this.expected = size;
        } else if (announced && typeof announced === 'object' && 'binaryFrames' in announced) {
          const sizes = announced.binaryFrames;
          if (!this.onBinary || !Array.isArray(sizes) || !sizes.length || sizes.length > 64
              || sizes.some((size) => !Number.isSafeInteger(size) || size < 1 || size > MAX_CHUNK)) throw new Error('Invalid binary announcement');
          [this.expected, ...this.following] = sizes;
        }
      } else {
        const bytes = this.payload; this.payload = null;
        this.expected = this.following.length ? this.following.shift() : null;
        this.onBinary(bytes);
      }
    }
  }
  end() { if (this.used || this.payload || this.expected !== null || this.following.length) throw new Error('Truncated response'); }
}

module.exports = { MAX_JSON, MAX_CHUNK, parseControl, frame, controlFrame, ControlReader };
