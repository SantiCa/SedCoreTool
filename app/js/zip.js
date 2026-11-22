// SedCoreTool — minimal ZIP writer and reader (V0.8), no external libraries.
// Used for the shareable project package (.sedcoretool; before V0.52 .corantool): project.json + images/… at full resolution.
// Writer: method 0 (stored, images are already compressed). Reader: stored and deflate (DecompressionStream).
// Works on Blobs, so large images are not copied into one big string. Card M8.4.18d: ZIP64 (APPNOTE 6.3.10 §4.3.14-4.3.15, §4.5.3) is written only
// when a size, an offset or the number of members needs it, so every package that fitted the classic format is written byte for byte as before;
// the reader accepts both and checks every size and offset against the file before it allocates anything.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(bytes, crc = 0) {
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}
const enc = new TextEncoder();
const ZIP_CRC_BLOCK_SIZE = 4 * 1024 ** 2;
const MAX32 = 0xffffffff, MAX16 = 0xffff;

async function storedZipCRC(blob) {
  let crc = 0;
  for (let start = 0; start < blob.size; start += ZIP_CRC_BLOCK_SIZE) {
    const bytes = new Uint8Array(await blob.slice(start, start + ZIP_CRC_BLOCK_SIZE).arrayBuffer());
    crc = crc32(bytes, crc);
  }
  return crc;
}

/** files: [{ name, data: Blob | Uint8Array | string }] → Blob (application/zip). See `zipParts`. */
export async function zipFiles(files, options = {}) {
  return new Blob(await zipParts(files, options), { type: 'application/zip' });
}

/** Something read like a Blob (`size`, `slice`, `arrayBuffer`): a Blob, or a reader of a file in tests (Node's Blob sizes wrap at 4 GiB). */
const blobLike = (value) => value instanceof Blob || (!!value && Number.isSafeInteger(value.size) && typeof value.slice === 'function' && typeof value.arrayBuffer === 'function');

/**
 * The parts of the archive of `files`, in order (ArrayBuffers, name bytes and the members' data). A member whose size or offset reaches
 * `zip64Limit` (2^32 - 1; tests pass a smaller one) gets ZIP64 fields; the archive gets the ZIP64 end records when its directory's size or
 * offset reaches it or it has 65,535 members or more.
 */
export async function zipParts(files, { zip64Limit = MAX32 } = {}) {
  const parts = [], central = []; let offset = 0;
  for (const f of files) {
    const data = typeof f.data === 'string' ? new Blob([enc.encode(f.data)]) : blobLike(f.data) ? f.data : new Blob([f.data]);
    const name = enc.encode(f.name), size = data.size, big = size >= zip64Limit || offset >= zip64Limit;
    if (!Number.isSafeInteger(offset + size + 50 + name.length)) throw new Error('ZIP too large');
    const crc = await storedZipCRC(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, big ? 45 : 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint32(14, crc, true); h.setUint32(18, big ? MAX32 : size, true); h.setUint32(22, big ? MAX32 : size, true); h.setUint16(26, name.length, true);
    h.setUint16(28, big ? 20 : 0, true);
    parts.push(h.buffer, name);
    if (big) { const x = new DataView(new ArrayBuffer(20)); x.setUint16(0, 1, true); x.setUint16(2, 16, true); x.setBigUint64(4, BigInt(size), true); x.setBigUint64(12, BigInt(size), true); parts.push(x.buffer); }
    parts.push(data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, big ? 45 : 20, true); c.setUint16(6, big ? 45 : 20, true); c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true); c.setUint32(20, big ? MAX32 : size, true); c.setUint32(24, big ? MAX32 : size, true); c.setUint16(28, name.length, true);
    c.setUint16(30, big ? 28 : 0, true); c.setUint32(42, big ? MAX32 : offset, true);
    central.push(c.buffer, name);
    if (big) {
      const x = new DataView(new ArrayBuffer(28)); x.setUint16(0, 1, true); x.setUint16(2, 24, true);
      x.setBigUint64(4, BigInt(size), true); x.setBigUint64(12, BigInt(size), true); x.setBigUint64(20, BigInt(offset), true); central.push(x.buffer);
    }
    offset += 30 + name.length + (big ? 20 : 0) + size;
  }
  const cdSize = central.reduce((a, p) => a + (p.byteLength ?? p.length), 0), e = new DataView(new ArrayBuffer(22));
  const tail = [];
  if (files.length >= MAX16 || cdSize >= zip64Limit || offset >= zip64Limit) {
    const r = new DataView(new ArrayBuffer(56)), l = new DataView(new ArrayBuffer(20));
    r.setUint32(0, 0x06064b50, true); r.setBigUint64(4, 44n, true); r.setUint16(12, 45, true); r.setUint16(14, 45, true);
    r.setBigUint64(24, BigInt(files.length), true); r.setBigUint64(32, BigInt(files.length), true);
    r.setBigUint64(40, BigInt(cdSize), true); r.setBigUint64(48, BigInt(offset), true);
    l.setUint32(0, 0x07064b50, true); l.setBigUint64(8, BigInt(offset + cdSize), true); l.setUint32(16, 1, true);
    tail.push(r.buffer, l.buffer);
    e.setUint16(8, MAX16, true); e.setUint16(10, MAX16, true); e.setUint32(12, MAX32, true); e.setUint32(16, MAX32, true);
  } else {
    e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
  }
  e.setUint32(0, 0x06054b50, true);
  return [...parts, ...central, ...tail, e.buffer];
}


const ZIP_DIRECTORY_LIMIT = 16 * 1024**2;
const ZIP_JSON_LIMIT = 128 * 1024**2;
const ZIP_INFLATE_ENTRY_LIMIT = 256 * 1024**2;
const ZIP_INFLATE_TOTAL_LIMIT = 1024**3;

function inflateZipMember(raw, size, expectedCRC) {
  let offset = 0, produced = 0, crc = 0;
  const input = new ReadableStream({
    async pull(controller) {
      if (offset === raw.size) { controller.close(); return; }
      const end = Math.min(raw.size, offset + 16 * 1024);
      controller.enqueue(new Uint8Array(await raw.slice(offset, end).arrayBuffer()));
      offset = end;
    },
  });
  const verify = new TransformStream({
    transform(chunk, controller) {
      produced += chunk.byteLength;
      if (produced > size) throw new Error('ZIP inflated size exceeds declared size');
      crc = crc32(chunk, crc);
      controller.enqueue(chunk);
    },
    flush() {
      if (produced !== size || crc !== expectedCRC) throw new Error('ZIP size or CRC mismatch');
    },
  });
  return new Response(input.pipeThrough(new DecompressionStream('deflate-raw')).pipeThrough(verify)).blob();
}

/** A little-endian u64 of `view` at `at` as a Number, refused when it is not a safe integer. */
function u64(view, at) {
  const value = view.getBigUint64(at, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Invalid ZIP64 value');
  return Number(value);
}

/**
 * The ZIP64 extended information of an extra field (header 0x0001): the values of the 32-bit fields that are 0xFFFFFFFF, in the order of
 * APPNOTE 4.5.3 (uncompressed size, compressed size, offset of the local header). Anything malformed is refused.
 */
function zip64Values(view, start, length, wanted) {
  for (let p = start; p < start + length;) {
    if (p + 4 > start + length) throw new Error('Invalid ZIP extra field');
    const id = view.getUint16(p, true), size = view.getUint16(p + 2, true);
    if (p + 4 + size > start + length) throw new Error('Invalid ZIP extra field');
    if (id === 1) {
      if (size < 8 * wanted) throw new Error('Invalid ZIP64 extra field');
      return Array.from({ length: wanted }, (_, k) => u64(view, p + 4 + 8 * k));
    }
    p += 4 + size;
  }
  throw new Error('Missing ZIP64 extra field');
}

/** Validate a classic or ZIP64 archive before exposing lazy, bounded readers for its members. */
export async function unzipBlob(blob) {
  if (!Number.isSafeInteger(blob.size)) throw new Error('ZIP exceeds the supported size');
  const tailLen = Math.min(blob.size, 65557), tail = new DataView(await blob.slice(blob.size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50 && i + 22 + tail.getUint16(i + 20, true) === tailLen) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a ZIP file');
  const eocdAt = blob.size - tailLen + eocd;
  let n = tail.getUint16(eocd + 10, true), cdSize = tail.getUint32(eocd + 12, true), cdOff = tail.getUint32(eocd + 16, true), cdEnd = eocdAt;
  if (tail.getUint16(eocd + 4, true) || tail.getUint16(eocd + 6, true) || tail.getUint16(eocd + 8, true) !== n) throw new Error('Invalid or oversized ZIP directory');
  if (n === MAX16 || cdSize === MAX32 || cdOff === MAX32) {             // ZIP64: the locator just before the end record names the ZIP64 end record
    if (eocdAt < 76) throw new Error('Invalid ZIP64 end records');
    const loc = new DataView(await blob.slice(eocdAt - 20, eocdAt).arrayBuffer());
    if (loc.getUint32(0, true) !== 0x07064b50 || loc.getUint32(4, true) || loc.getUint32(16, true) !== 1) throw new Error('Invalid ZIP64 end records');
    const recAt = u64(loc, 8);
    if (recAt + 56 > eocdAt - 20) throw new Error('Invalid ZIP64 end records');
    const rec = new DataView(await blob.slice(recAt, recAt + 56).arrayBuffer());
    if (rec.getUint32(0, true) !== 0x06064b50 || recAt + 12 + u64(rec, 4) !== eocdAt - 20 || rec.getUint32(16, true) || rec.getUint32(20, true) ||
        u64(rec, 24) !== u64(rec, 32)) throw new Error('Invalid ZIP64 end records');
    n = u64(rec, 32); cdSize = u64(rec, 40); cdOff = u64(rec, 48); cdEnd = recAt;
  }
  if (cdSize > ZIP_DIRECTORY_LIMIT || cdSize < 46 * n || cdOff + cdSize !== cdEnd) {
    throw new Error('Invalid or oversized ZIP directory');
  }
  const cd = new DataView(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const dec = new TextDecoder(), entries = [], out = new Map();
  // Stored members lie inside the file without overlapping (checked below), so together they are at most its size; deflated ones have their own limits.
  const storedLimit = Math.max(MAX32, blob.size), readLimit = Math.max(MAX32, 2 * blob.size);
  let p = 0, expanded = 0, inflated = 0, bytesRead = 0, bytesInflated = 0;
  for (let i = 0; i < n; i++) {
    if (p + 46 > cdSize || cd.getUint32(p, true) !== 0x02014b50) throw new Error('Invalid ZIP directory entry');
    const flags = cd.getUint16(p + 8, true), method = cd.getUint16(p + 10, true), crc = cd.getUint32(p + 16, true);
    let csize = cd.getUint32(p + 20, true), size = cd.getUint32(p + 24, true), lo = cd.getUint32(p + 42, true);
    const nl = cd.getUint16(p + 28, true), xl = cd.getUint16(p + 30, true), next = p + 46 + nl + xl + cd.getUint16(p + 32, true);
    if (!nl || next > cdSize || flags & 0x41 || cd.getUint16(p + 34, true) || ![0, 8].includes(method)) {
      throw new Error('Invalid or unsupported ZIP member');
    }
    const wide = [size === MAX32, csize === MAX32, lo === MAX32], wanted = wide.filter(Boolean).length;
    if (wanted) {
      const values = zip64Values(cd, p + 46 + nl, xl, wanted);
      if (wide[0]) size = values.shift();
      if (wide[1]) csize = values.shift();
      if (wide[2]) lo = values.shift();
    }
    const name = dec.decode(new Uint8Array(cd.buffer, p + 46, nl));
    if (/[\\\u0000]/.test(name) || name.startsWith('/') || /^[a-z]:/i.test(name) ||
        name.replace(/\/$/, '').split('/').some((part) => !part || part === '..' || part === '.') || out.has(name)) {
      throw new Error('Invalid or duplicate ZIP member name');
    }
    expanded += size;
    if (method === 8) inflated += size;
    if (expanded > storedLimit + inflated || inflated > ZIP_INFLATE_TOTAL_LIMIT ||
        (method === 8 && size > ZIP_INFLATE_ENTRY_LIMIT) ||
        ((name.endsWith('project.json') || name === 'settings.json') && size > ZIP_JSON_LIMIT)) {
      throw new Error('ZIP uncompressed size exceeds the import limit');
    }
    if ((method === 0 && size !== csize) || lo + 30 + csize > cdOff) throw new Error('Invalid ZIP member size or offset');
    const entry = { lo, csize, end: cdOff };
    entries.push(entry);
    out.set(name, {
      async get() {
        bytesRead += size;
        if (method === 8) bytesInflated += size;
        if (bytesRead > readLimit || bytesInflated > ZIP_INFLATE_TOTAL_LIMIT) throw new Error('ZIP read exceeds the import limit');
        const lh = new DataView(await blob.slice(lo, lo + 30).arrayBuffer());
        const localNameSize = lh.getUint16(26, true), localExtra = lh.getUint16(28, true), start = lo + 30 + localNameSize + localExtra;
        if (lh.getUint32(0, true) !== 0x04034b50 || lh.getUint16(6, true) !== flags || lh.getUint16(8, true) !== method) throw new Error('ZIP local header does not match directory');
        if (!(flags & 8)) {
          let localSize = lh.getUint32(22, true), localCsize = lh.getUint32(18, true);
          if (localSize === MAX32 && localCsize === MAX32 && wanted) {
            const x = new DataView(await blob.slice(lo + 30 + localNameSize, start).arrayBuffer());
            [localSize, localCsize] = zip64Values(x, 0, localExtra, 2);
          }
          if (lh.getUint32(14, true) !== crc || localCsize !== csize || localSize !== size) throw new Error('ZIP local header does not match directory');
        }
        if (localNameSize !== nl || start + csize > entry.end ||
            dec.decode(await blob.slice(lo + 30, lo + 30 + localNameSize).arrayBuffer()) !== name) {
          throw new Error('Invalid or overlapping ZIP member');
        }
        const raw = blob.slice(start, start + csize);
        if (method === 8) return inflateZipMember(raw, size, crc);
        if (await storedZipCRC(raw) !== crc) throw new Error(`ZIP CRC mismatch for ${name}`);
        return raw;
      },
    });
    p = next;
  }
  if (p !== cdSize) throw new Error('Invalid ZIP directory length');
  entries.sort((a, b) => a.lo - b.lo);
  for (let i = 0; i + 1 < entries.length; i++) {
    const current = entries[i];
    current.end = entries[i + 1].lo;
    if (current.lo + 30 + current.csize > current.end) throw new Error('Overlapping ZIP members');
  }
  return out;
}
