// Reads regions of a TIFF/BigTIFF with the program's own block reader (app/js/tiff.js) and prints the SHA-256 of their pixel bytes.
// Used by tools/make_large_fixtures.py (--verify) to check the files against the generator's pure function, and by card M8.4.13.
//
//   node tools/verify_large_fixtures.mjs FILE '[{"x":0,"y":0,"w":512,"h":512}, ...]'
//
// Output: JSON lines {x, y, w, h, bits, channels, sha256, ms}; 8-bit RGB regions hash R,G,B bytes row by row; 16-bit grey regions hash the
// little-endian 16-bit samples. Memory: one region at a time. The file is read by ranges, never loaded whole.
import { createHash } from 'node:crypto';
import { open, stat } from 'node:fs/promises';
import { decodeTiffBlocks } from '../app/js/tiff.js';

const [file, regionsJson] = process.argv.slice(2);
if (!file || !regionsJson) { console.error('usage: node tools/verify_large_fixtures.mjs FILE REGIONS_JSON'); process.exit(2); }
// Node 22's fs.openAsBlob reports the size of a file larger than 4 GiB modulo 2^32 on Windows (measured: 5,561,655,263 bytes -> 1,266,687,967), so the
// reader gets the two things it uses of a Blob (size, slice(...).arrayBuffer()) from a file handle instead. The program's File objects in a browser are not affected.
const handle = await open(file, 'r');
const source = { size: (await stat(file)).size, slice: (start, end) => ({ arrayBuffer: async () => {
  const bytes = Buffer.alloc(end - start), { bytesRead } = await handle.read(bytes, 0, end - start, start);
  if (bytesRead !== end - start) throw new Error('Short read');
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
} }) };
for (const { x, y, w, h } of JSON.parse(regionsJson)) {
  const started = performance.now();
  const decoded = await decodeTiffBlocks(source, () => ({ x, y, w, h }), () => 1);
  if (!decoded.rgba) throw new Error('The reader did not decode the file (unsupported layout)');
  const grey16 = decoded.rgba16 !== null;
  const hash = createHash('sha256');
  if (grey16) {
    const samples = new Uint16Array(w * h);
    for (let i = 0; i < samples.length; i++) samples[i] = decoded.rgba16[i * 4];
    hash.update(new Uint8Array(samples.buffer));
  } else {
    const rgb = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) { rgb[i * 3] = decoded.rgba[i * 4]; rgb[i * 3 + 1] = decoded.rgba[i * 4 + 1]; rgb[i * 3 + 2] = decoded.rgba[i * 4 + 2]; }
    hash.update(rgb);
  }
  console.log(JSON.stringify({ x, y, w, h, bits: grey16 ? 16 : 8, channels: grey16 ? 1 : 3, sha256: hash.digest('hex'), ms: Math.round(performance.now() - started) }));
}
await handle.close();
