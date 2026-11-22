import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipFiles, zipParts, unzipBlob, crc32 } from '../../app/js/zip.js';

test('V0.8: zip round trip (text and binary entries) and CRC-32', async () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const bin = new Uint8Array(3000).map((_, i) => (i * 7) & 255);
  const z = await zipFiles([{ name: 'project.json', data: '{"a":1}' }, { name: 'images/x ñ.jpg', data: new Blob([bin]) }]);
  const m = await unzipBlob(z);
  assert.equal(await (await m.get('project.json').get()).text(), '{"a":1}');
  assert.deepEqual(new Uint8Array(await (await m.get('images/x ñ.jpg').get()).arrayBuffer()), bin);
});

test('ZIP computes the CRC across bounded slices without reading the original as one buffer', async () => {
  class SliceOnlyBlob extends Blob {
    arrayBuffer() { throw new Error('whole input read'); }
  }
  const bytes = new Uint8Array(4 * 1024 * 1024 + 23);
  bytes.set([12, 34, 56, 78], 4 * 1024 * 1024 - 2);
  const zip = await zipFiles([{ name: 'images/core.tif', data: new SliceOnlyBlob([bytes]) }]);
  const header = new DataView(await zip.slice(0, 30).arrayBuffer());
  assert.equal(header.getUint32(14, true), crc32(bytes));
  const result = await (await unzipBlob(zip)).get('images/core.tif').get();
  assert.equal(result.size, bytes.length);
  assert.deepEqual(new Uint8Array(await result.slice(-25, -21).arrayBuffer()), new Uint8Array([12, 34, 56, 78]));
});

test('ZIP checks stored payloads in bounded reads and returns a sliceable Blob', async () => {
  const blockSize = 4 * 1024 ** 2, reads = [];
  class BoundedBlob extends Blob {
    slice(...args) { return new BoundedBlob([super.slice(...args)]); }
    arrayBuffer() {
      assert.ok(this.size <= blockSize, 'read exceeds the CRC block size');
      reads.push(this.size);
      return super.arrayBuffer();
    }
  }
  const payload = new Uint8Array(blockSize + 23);
  payload.set([12, 34, 56, 78], blockSize - 2);
  const name = 'images/core.tif';
  const zip = await zipFiles([{ name, data: payload }]);
  const entries = await unzipBlob(new BoundedBlob([zip]));
  reads.length = 0;
  const member = await entries.get(name).get();
  assert.deepEqual(reads.slice(-2), [blockSize, 23]);
  assert.equal(member.size, payload.length);
  assert.deepEqual(new Uint8Array(await member.slice(blockSize - 2, blockSize + 2).arrayBuffer()), new Uint8Array([12, 34, 56, 78]));
});

for (const [name, data, offset] of [
  ['project.json', '{"name":"Core"}', 9],
  ['images/core.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 1],
]) {
  test(`ZIP rejects a stored ${name} with one altered payload byte`, async () => {
    const zip = await zipFiles([{ name, data }]);
    const bytes = new Uint8Array(await zip.arrayBuffer()), header = new DataView(bytes.buffer);
    const start = 30 + header.getUint16(26, true) + header.getUint16(28, true);
    bytes[start + offset] ^= 1;
    const entries = await unzipBlob(new Blob([bytes]));
    await assert.rejects(entries.get(name).get(), /CRC mismatch/);
  });
}

async function deflatedMember(data, size = data.length) {
  const blob = await zipFiles([{ name: 'project.json', data: deflateRawSync(data) }]);
  const view = new DataView(await blob.arrayBuffer()), cd = view.getUint32(view.byteLength - 6, true);
  view.setUint16(8, 8, true); view.setUint16(cd + 10, 8, true);
  view.setUint32(14, crc32(data), true); view.setUint32(cd + 16, crc32(data), true);
  view.setUint32(22, size, true); view.setUint32(cd + 24, size, true);
  return new Blob([view.buffer]);
}

test('ZIP accepts valid deflate and rejects a forged low or oversized expanded size', async () => {
  const data = new TextEncoder().encode(JSON.stringify({ a: 'A'.repeat(64 * 1024) }));
  const valid = await unzipBlob(await deflatedMember(data));
  assert.deepEqual(new Uint8Array(await (await valid.get('project.json').get()).arrayBuffer()), data);
  const forged = await unzipBlob(await deflatedMember(data, 64));
  await assert.rejects(forged.get('project.json').get(), /inflated size/);
  await assert.rejects(unzipBlob(await deflatedMember(data, 129 * 1024**2)), /uncompressed size/);
});

test('ZIP rejects unsafe paths, duplicate names and overlapping member offsets', async () => {
  await assert.rejects(unzipBlob(await zipFiles([{ name: '../project.json', data: '{}' }])), /member name/);
  const repeated = [{ name: 'project.json', data: '{}' }, { name: 'project.json', data: '{}' }];
  await assert.rejects(unzipBlob(await zipFiles(repeated)), /duplicate/);
  const blob = await zipFiles([{ name: 'a', data: 'A' }, { name: 'b', data: 'B' }]);
  const view = new DataView(await blob.arrayBuffer()), cd = view.getUint32(view.byteLength - 6, true);
  view.setUint32(cd + 47 + 42, 0, true);
  await assert.rejects(unzipBlob(new Blob([view.buffer])), /Overlapping ZIP/);
});

// ---- Card M8.4.18d: ZIP64 ----

/** A Blob-like reader of a file on disk (Node's Blob reports sizes beyond 4 GiB wrongly), sliced without reading. */
class FileBlob {
  constructor(file, start = 0, end = fs.statSync(file).size) { this.file = file; this.start = start; this.end = end; }
  get size() { return this.end - this.start; }
  slice(a = 0, b = this.size) {
    const clamp = (v) => Math.max(0, Math.min(this.size, v < 0 ? this.size + v : v));
    return new FileBlob(this.file, this.start + clamp(a), this.start + Math.max(clamp(a), clamp(b)));
  }
  async arrayBuffer() {
    const out = Buffer.alloc(this.size), fd = fs.openSync(this.file, 'r');
    try { for (let done = 0; done < out.length;) done += fs.readSync(fd, out, done, out.length - done, this.start + done); } finally { fs.closeSync(fd); }
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.length);
  }
}

test('M8.4.18d: an archive that fits the classic format is written byte for byte as before ZIP64 existed', async () => {
  // The digest below is that of the archive written by zip.js before card M8.4.18d for the same members (checked on 20 Nov 2026).
  const bin = new Uint8Array(70000).map((_, i) => (i * 31 + (i >> 7)) & 255);
  const zip = await zipFiles([{ name: 'project.json', data: '{"app":"SedCoreTool","name":"Núcleo"}' }, { name: 'images/a b.png', data: new Blob([bin]) },
    { name: 'p2/tiles/' + 'a'.repeat(64), data: bin.subarray(5, 900) }, { name: 'settings.json', data: '{}' }]);
  assert.equal(createHash('sha256').update(new Uint8Array(await zip.arrayBuffer())).digest('hex'), 'e6729f2bb82c606b1211ab255c24b8711126f519347bf6b490095c04de007720');
  assert.equal(zip.size, 71485);
});

test('M8.4.18d: members beyond the ZIP64 limit get ZIP64 fields and end records, and read back exactly', async () => {
  const a = new Uint8Array(100).map((_, i) => i), b = new Uint8Array(3000).map((_, i) => (i * 7) & 255);
  const zip = await zipFiles([{ name: 'project.json', data: '{"a":1}' }, { name: 'tiles/a', data: a }, { name: 'sources/b', data: b }], { zip64Limit: 64 });
  const bytes = new Uint8Array(await zip.arrayBuffer()), view = new DataView(bytes.buffer);
  assert.equal(view.getUint16(4, true), 20, 'the first member (7 bytes at offset 0) stays classic');
  const second = 30 + 'project.json'.length + 7;
  assert.equal(view.getUint16(second + 4, true), 45, 'the second member is at or beyond the limit: ZIP64');
  assert.equal(view.getUint32(second + 18, true), 0xffffffff);
  assert.equal(view.getUint32(bytes.length - 22 - 20 - 56, true), 0x06064b50, 'ZIP64 end record');
  assert.equal(view.getUint32(bytes.length - 22 - 20, true), 0x07064b50, 'ZIP64 locator');
  const m = await unzipBlob(zip);
  assert.equal(await (await m.get('project.json').get()).text(), '{"a":1}');
  assert.deepEqual(new Uint8Array(await (await m.get('tiles/a').get()).arrayBuffer()), a);
  assert.deepEqual(new Uint8Array(await (await m.get('sources/b').get()).arrayBuffer()), b);
});

test('M8.4.18d: 65,536 members are written with ZIP64 end records and read back', async () => {
  const files = Array.from({ length: 65536 }, (_, i) => ({ name: `t/${i}`, data: new Uint8Array([i & 255]) }));
  const m = await unzipBlob(await zipFiles(files));
  assert.equal(m.size, 65536);
  assert.deepEqual(new Uint8Array(await (await m.get('t/65535').get()).arrayBuffer()), new Uint8Array([255]));
});

test('M8.4.18d: truncated or hostile ZIP64 records are refused before anything large is allocated', async () => {
  const zip = new Uint8Array(await (await zipFiles([{ name: 'a', data: 'A' }, { name: 'b', data: 'BB' }], { zip64Limit: 1 })).arrayBuffer());
  const end = zip.length - 22, locator = end - 20, record = locator - 56;
  const variant = (change) => { const copy = zip.slice(), view = new DataView(copy.buffer); change(view, copy); return new Blob([copy]); };
  const cases = {
    'locator signature': (v) => v.setUint32(locator, 0, true),
    'locator beyond the file': (v) => v.setBigUint64(locator + 8, 2n ** 40n, true),
    'record not just before the locator': (v) => v.setBigUint64(locator + 8, BigInt(record - 1), true),
    'record signature': (v) => v.setUint32(record, 0, true),
    'record size': (v) => v.setBigUint64(record + 4, 45n, true),
    'unsafe 64-bit value': (v) => v.setBigUint64(record + 40, 2n ** 60n, true),
    'members claimed far beyond the directory': (v) => { v.setBigUint64(record + 24, 2n ** 40n, true); v.setBigUint64(record + 32, 2n ** 40n, true); },
    'directory size beyond the limit': (v) => v.setBigUint64(record + 40, 2n ** 34n, true),
    'directory offset': (v) => v.setBigUint64(record + 48, 3n, true),
    'disk numbers': (v) => v.setUint32(record + 16, 1, true),
  };
  for (const [label, change] of Object.entries(cases)) await assert.rejects(unzipBlob(variant(change)), /ZIP/, label);
  await assert.rejects(unzipBlob(new Blob([zip.slice(0, record + 10), zip.slice(locator)])), /ZIP/, 'record cut short');
  // A directory entry that says 0xFFFFFFFF without its ZIP64 extra field, or with one too short.
  const cdAt = Number(new DataView(zip.buffer).getBigUint64(record + 48, true));
  await assert.rejects(unzipBlob(variant((v) => v.setUint16(cdAt + 30, 0, true))), /ZIP/, 'extra field missing');
  await assert.rejects(unzipBlob(variant((v) => v.setUint16(cdAt + 46 + 1 + 2, 8, true))), /ZIP/, 'extra field too short');
  // A member whose 64-bit size runs past the directory.
  await assert.rejects(unzipBlob(variant((v) => { v.setBigUint64(cdAt + 46 + 1 + 4, 2n ** 33n, true); v.setBigUint64(cdAt + 46 + 1 + 12, 2n ** 33n, true); })), /ZIP/, 'size past the directory');
});

test('M8.4.18d: a package above 4 GiB is written to disk in parts and read back with its members intact', { timeout: 600000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sedcoretool-zip64-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'source.bin'), size = 2 ** 32 + 12345;
  const fd = fs.openSync(source, 'w');
  fs.ftruncateSync(fd, size); fs.writeSync(fd, Buffer.from('HEAD'), 0, 4, 0); fs.writeSync(fd, Buffer.from('TAIL'), 0, 4, size - 4); fs.closeSync(fd);
  const parts = await zipParts([{ name: 'project.json', data: '{"app":"SedCoreTool"}' }, { name: 'sources/big', data: new FileBlob(source) }, { name: 'tiles/after', data: 'after' }]);
  const out = path.join(dir, 'package.sedcoretool'), w = fs.openSync(out, 'w');
  let written = 0;
  try {
    for (const part of parts) {
      if (part instanceof FileBlob || part instanceof Blob) {
        for (let at = 0; at < part.size; at += 64 * 2 ** 20) { const chunk = Buffer.from(await part.slice(at, at + 64 * 2 ** 20).arrayBuffer()); fs.writeSync(w, chunk, 0, chunk.length, written); written += chunk.length; }
      } else { const chunk = Buffer.from(part instanceof ArrayBuffer ? new Uint8Array(part) : part); fs.writeSync(w, chunk, 0, chunk.length, written); written += chunk.length; }
    }
  } finally { fs.closeSync(w); }
  assert.ok(fs.statSync(out).size > 2 ** 32);
  const members = await unzipBlob(new FileBlob(out));
  const big = await members.get('sources/big').get();                      // its CRC over 4 GiB is checked here
  assert.equal(big.size, size);
  assert.equal(Buffer.from(await big.slice(0, 4).arrayBuffer()).toString(), 'HEAD');
  assert.equal(Buffer.from(await big.slice(size - 4, size).arrayBuffer()).toString(), 'TAIL');
  assert.equal(Buffer.from(await (await members.get('tiles/after').get()).arrayBuffer()).toString(), 'after', 'a member after 4 GiB');
  assert.equal(Buffer.from(await (await members.get('project.json').get()).arrayBuffer()).toString(), '{"app":"SedCoreTool"}');
});
