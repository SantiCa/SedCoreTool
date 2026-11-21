// Card M8.4.9: the working pixels of sections kept in the engine (engineclient.js::ensurePixels), against an in-memory bridge and,
// when a development Python with NumPy is available, through the real bridge and engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngineClient, EngineError, RESIDENT_PIXEL_BYTES } from '../../app/js/engineclient.js';
import { createEngineAnalysis } from '../../app/js/engineanalysis.js';
import { buildIntervalSnapshot, maskIdentity, referenceColumns } from '../../app/js/sectionanalysis.js';
import { pixelIdentity } from '../../app/js/sectionpixels.js';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const bytesOf = (typed) => new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);

/** A section with working pixels (8-bit, or 8- and 16-bit), small masks and one object, as the interface keeps it. */
function section(seed, { w = 16, h = 24, bits = 8 } = {}) {
  let state = seed; const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const orig16 = bits === 16 ? Uint16Array.from({ length: w * h * 4 }, () => Math.floor(random() * 65536)) : null;
  const orig = orig16 ? Uint8ClampedArray.from(orig16, (v) => v >> 8) : Uint8ClampedArray.from({ length: w * h * 4 }, () => Math.floor(random() * 256));
  const labels = new Int32Array(w * h).fill(0, 0), exclude = new Uint8Array(w * h);
  labels.fill(1, 0, w * 3);
  return { w, h, orig, orig16, roi: { x0: 0, y0: 0, x1: w, y1: h }, top: 0, bottom: 10, units: 'cm', labels, exclude,
    objects: new Map([[1, { id: 1, cls: 'a' }]]), stacks: [null], nextId: 2, manual: [], _mv: 1 };
}
const project = () => ({ classes: [{ id: 'a', name: 'A', counts: true }, { id: 'undet', name: 'undet', counts: true }],
  settings: { includePred: true, predThr: 0.5, countCandidates: true, binCm: 2, minValid: 20, noDataPad: 0 }, ageModel: null, ageUnits: null });

/** Stores uploads in memory, answers analyses from the JavaScript reference, records every call. */
function memoryBridge() {
  const buffers = new Map(), released = [], begins = [];
  let reference = null;
  const bridge = {
    buffers, released, begins, refuseBegin: null,
    setReference: (value) => { reference = value; },
    status: async () => ({ state: 'ready' }),
    beginBuffer: async (descriptor) => {
      begins.push(descriptor);
      if (bridge.refuseBegin?.(descriptor)) return { error: { code: 'LIMIT_EXCEEDED', field: 'byte_length' } };
      const token = crypto.randomUUID(); buffers.set(token, { ...descriptor, data: new Uint8Array(descriptor.byte_length), next: 0 }); return { token };
    },
    appendBuffer: async (token, offset, bytes) => { const b = buffers.get(token); assert.equal(offset, b.next); assert.ok(bytes.length >= 1 && bytes.length <= 1048576);
      b.data.set(bytes, offset); b.next += bytes.length; return { next_offset: b.next }; },
    commitBuffer: async (token) => { const b = buffers.get(token); assert.equal(b.next, b.byte_length); assert.equal(sha(b.data), b.sha256); return { token, byte_length: b.byte_length, sha256: b.sha256 }; },
    release: async (tokens) => { released.push(...tokens); for (const t of tokens) buffers.delete(t); return { released: tokens.length }; },
    readBuffer: async (token, offset, length) => ({ offset, bytes: new Uint8Array(buffers.get(token).data.subarray(offset, offset + length)) }),
    cancel: async () => ({ state: 'requested' }),
    analyzeSection: async (request) => {
      for (const token of Object.values(request.inputs)) if (!buffers.has(token)) return { error: { code: 'INVALID_BUFFER', field: 'token' } };
      const layout = {}, parts = []; let size = 0;
      for (const [name, column] of Object.entries(reference.columns)) {
        const add = (key, dtype, values) => {
          const Type = { u8: Uint8Array, i32le: Int32Array, u32le: Uint32Array, u64le: BigUint64Array, f64le: Float64Array }[dtype];
          const bytes = new Uint8Array(Type.from(values, (v) => (dtype === 'u64le' ? BigInt(v) : v)).buffer);
          layout[key] = { dtype, shape: column.shape, offset: size, byte_length: bytes.length }; parts.push([size, bytes]); size += Math.ceil(bytes.length / 8) * 8;
        };
        add(name, column.dtype, column.data); if (column.valid) add(name + '_valid', 'u8', column.valid);
      }
      const packed = new Uint8Array(size), token = crypto.randomUUID();
      for (const [offset, bytes] of parts) packed.set(bytes, offset);
      buffers.set(token, { data: packed, byte_length: size });
      return { dimensions: reference.dimensions, outputs: { result: { token, dtype: 'u8', shape: [size], byte_length: size, sha256: sha(packed) } }, layout, provenance: {} };
    },
  };
  return bridge;
}
const pixelBegins = (bridge) => bridge.begins.filter((d) => d.shape.length === 3);

test('the pixels of an 8-bit and of a 16-bit section are uploaded as u8[h,w,4] and u16le[h,w,4], byte for byte', async () => {
  const bridge = memoryBridge(), client = createEngineClient(bridge), s8 = section(1), s16 = section(2, { bits: 16, w: 300, h: 500 });
  const t8 = await client.ensurePixels(s8, s8), t16 = await client.ensurePixels(s16, s16);
  assert.deepEqual(Object.keys(t8).sort(), ['identity', 'rgba']);
  assert.deepEqual(Object.keys(t16).sort(), ['identity', 'rgba', 'rgba16']);
  assert.equal(t16.identity, await pixelIdentity(s16));
  const held = (token) => bridge.buffers.get(token);
  assert.deepEqual([held(t8.rgba).dtype, held(t8.rgba).shape], ['u8', [24, 16, 4]]);
  assert.deepEqual([held(t16.rgba16).dtype, held(t16.rgba16).shape, held(t16.rgba16).byte_length], ['u16le', [500, 300, 4], 300 * 500 * 8]);
  assert.deepEqual(held(t8.rgba).data, bytesOf(s8.orig));
  assert.deepEqual(held(t16.rgba).data, bytesOf(s16.orig));
  assert.deepEqual(held(t16.rgba16).data, bytesOf(s16.orig16));
  assert.equal(client.residentPixelSections(), 2);
  assert.equal(client.residentPixelBytes(), 16 * 24 * 4 + 300 * 500 * 12);
  assert.ok(client.hasPixels(s16, t16.identity));
  assert.equal(client.residentSections(), 0, 'pixels are not analysis inputs');
});

test('pixels of the same identity are not uploaded again, also after the interface decoded them again', async () => {
  const bridge = memoryBridge(), client = createEngineClient(bridge), s = section(3, { bits: 16 });
  const first = await client.ensurePixels(s, s);
  s.orig = new Uint8ClampedArray(s.orig); s.orig16 = new Uint16Array(s.orig16);
  assert.deepEqual(await client.ensurePixels(s, s), first);
  assert.equal(pixelBegins(bridge).length, 2);
  assert.deepEqual(bridge.released, []);
});

test('new pixels replace the old ones of the section, which are released, also the 16-bit buffer of an image that is now 8-bit', async () => {
  const bridge = memoryBridge(), client = createEngineClient(bridge), s = section(4, { bits: 16 });
  const first = await client.ensurePixels(s, s);
  s.orig = s.orig.slice(4 * s.w * 2); s.orig16 = s.orig16.slice(4 * s.w * 2); s.h -= 2;         // a crop
  const cropped = await client.ensurePixels(s, s); await flush();
  assert.notEqual(cropped.identity, first.identity);
  assert.deepEqual(bridge.released.sort(), [first.rgba, first.rgba16].sort());
  s.orig16 = null;                                                                             // reloaded as an 8-bit image
  const narrow = await client.ensurePixels(s, s); await flush();
  assert.deepEqual(Object.keys(narrow).sort(), ['identity', 'rgba']);
  assert.ok(bridge.released.includes(cropped.rgba16) && bridge.released.includes(cropped.rgba));
  assert.deepEqual([...bridge.buffers.keys()], [narrow.rgba]);
  assert.equal(client.residentPixelBytes(), s.w * s.h * 4);
});

test('pixels have a budget of their own: the least recently used section is dropped, analysis inputs are not touched', async () => {
  const one = 16 * 24 * 4, bridge = memoryBridge(), client = createEngineClient(bridge, { pixelBytes: 2 * one + 10 }), p = project();
  const [a, b, c] = [5, 6, 7].map((seed) => section(seed));
  bridge.setReference(referenceColumns(a, p));
  await client.analyze(buildIntervalSnapshot(a, p), { owner: a, maskKey: maskIdentity(a) }); await flush();
  const inputs = client.residentBytes(), releasedByAnalysis = bridge.released.length;
  const ta = await client.ensurePixels(a, a), tb = await client.ensurePixels(b, b);
  await client.ensurePixels(a, a);                                    // a used last: b is the oldest
  await client.ensurePixels(c, c); await flush();
  assert.ok(client.hasPixels(a, ta.identity) && !client.hasPixels(b, tb.identity));
  assert.deepEqual(bridge.released.slice(releasedByAnalysis), [tb.rgba]);
  assert.equal(client.residentPixelSections(), 2);
  assert.ok(client.hasMasks(a, maskIdentity(a)) && client.residentBytes() === inputs, 'the masks and tables of a stayed');
});

test('a section whose pixels do not fit the pixel budget is not kept and nothing is uploaded; older pixels of it are released', async () => {
  const bridge = memoryBridge(), client = createEngineClient(bridge, { pixelBytes: 16 * 24 * 4 }), s = section(8), other = section(9);
  const small = await client.ensurePixels(s, s), kept = await client.ensurePixels(other, other);
  const big = section(8, { w: 16, h: 25 }); s.orig = big.orig; s.h = 25;
  await assert.rejects(client.ensurePixels(s, s), (error) => error instanceof EngineError && error.code === 'LIMIT_EXCEEDED' && error.field === 'pixels');
  await flush();
  assert.equal(pixelBegins(bridge).length, 2, 'the large pixels were never sent');
  assert.ok(bridge.released.includes(small.rgba), 'the stale pixels of the section are gone');
  assert.ok(client.hasPixels(other, kept.identity), 'other sections are not dropped for pixels that can never fit');
  assert.ok(RESIDENT_PIXEL_BYTES >= 8 * 960 * 6400 * 4, 'the default budget holds the eight sections of the generated project');
});

test('a tiled section or one without pixels in memory is refused before anything is uploaded', async () => {
  const bridge = memoryBridge(), client = createEngineClient(bridge), s = section(10);
  await assert.rejects(client.ensurePixels(s, { ...s, tiled: {} }), /tile store/);
  await assert.rejects(client.ensurePixels(s, { ...s, orig: null }), /not in memory/);
  assert.equal(bridge.begins.length, 0);
});

test('two requests for the same pixels share one upload', async () => {
  const bridge = memoryBridge(), client = createEngineClient(bridge), s = section(11, { bits: 16 });
  const [x, y] = await Promise.all([client.ensurePixels(s, s), client.ensurePixels(s, s)]);
  assert.deepEqual(x, y);
  assert.equal(pixelBegins(bridge).length, 2);
});

test('an upload that is aborted or refused keeps the pixels that were resident and releases what it sent', async () => {
  const bridge = memoryBridge(), client = createEngineClient(bridge), s = section(12, { bits: 16 });
  const before = await client.ensurePixels(s, s);
  s.orig = new Uint8ClampedArray(s.orig); s.orig[0] ^= 1;
  const controller = new AbortController(); controller.abort();
  await assert.rejects(client.ensurePixels(s, s, { signal: controller.signal }), { name: 'AbortError' });
  bridge.refuseBegin = (descriptor) => descriptor.dtype === 'u16le';
  await assert.rejects(client.ensurePixels(s, s), { code: 'LIMIT_EXCEEDED' });
  await flush();
  assert.deepEqual([...bridge.buffers.keys()].sort(), [before.rgba, before.rgba16].sort(), 'the new 8-bit buffer was released, the old pixels are still there');
  assert.ok(client.hasPixels(s, before.identity));
});

test('the engine reporting a full budget makes the client drop the pixels of other sections and try once more', async () => {
  const bridge = memoryBridge(), client = createEngineClient(bridge), a = section(13), b = section(14);
  const ta = await client.ensurePixels(a, a);
  let refused = 0;
  bridge.refuseBegin = () => (refused++ === 0);
  const tb = await client.ensurePixels(b, b); await flush();
  assert.equal(refused, 2);
  assert.ok(!client.hasPixels(a, ta.identity) && client.hasPixels(b, tb.identity));
  assert.deepEqual(bridge.released, [ta.rgba]);
});

test('forget, releaseAll and the analysis controller of a replaced project release the pixels; a restart forgets them without asking', async () => {
  const bridge = memoryBridge(), client = createEngineClient(bridge), [a, b] = [section(15), section(16, { bits: 16 })];
  await client.ensurePixels(a, a); await client.ensurePixels(b, b);
  client.forget(a); await flush();
  assert.equal(bridge.buffers.size, 2);
  const controller = createEngineAnalysis({ client, project: project() });
  controller.releaseAll(); await flush();
  assert.equal(bridge.buffers.size, 0);
  assert.equal(client.residentPixelSections(), 0);
  await client.ensurePixels(a, a);
  const released = bridge.released.length;
  bridge.restart = async () => ({ restarted: true });
  await client.restart();
  assert.equal(client.residentPixelSections(), 0);
  assert.equal(bridge.released.length, released, 'tokens of the old session are not sent back');
});

test('a u16le result column is decoded as unsigned 16-bit values', async () => {
  const bridge = memoryBridge(), client = createEngineClient(bridge), p = project(), s = section(17);
  const answer = bridge.analyzeSection;
  bridge.setReference(referenceColumns(s, p));
  bridge.analyzeSection = async (request) => {
    const result = await answer(request), packed = bridge.buffers.get(result.outputs.result.token).data, extra = new Uint8Array(new Uint16Array([0, 1, 65535]).buffer);
    const size = packed.length + 8, joined = new Uint8Array(size); joined.set(packed); joined.set(extra, packed.length);
    bridge.buffers.set(result.outputs.result.token, { data: joined, byte_length: size });
    return { ...result, outputs: { result: { ...result.outputs.result, byte_length: size, shape: [size], sha256: sha(joined) } },
      layout: { ...result.layout, probe: { dtype: 'u16le', shape: [3], offset: packed.length, byte_length: 6 } } };
  };
  const out = await client.analyze(buildIntervalSnapshot(s, p));
  assert.deepEqual(out.columns.probe.data, [0, 1, 65535]);
});

// ---- the type u16le in the bridge ------------------------------------------------------------------------------------------

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../', import.meta.url));

test('the bridge knows the engine\'s buffer types, u16le included, for uploads and for result columns', async () => {
  const { createEngineIpc, DTYPES, COLUMN_DTYPES } = require('../../desktop/engine-ipc.js');
  const source = readFileSync(path.join(root, 'src/sedcoretool/engine/buffers.py'), 'utf8');
  const engineTypes = [...source.match(/^ITEM_BYTES = \{([^}]*)\}/m)[1].matchAll(/'([a-z0-9]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...DTYPES].sort(), engineTypes.sort(), 'desktop/engine-ipc.js DTYPES mirrors ITEM_BYTES');
  assert.deepEqual([...COLUMN_DTYPES].sort(), engineTypes.filter((name) => name !== 'utf8json').sort());
  const calls = [], engine = { session: () => 's', request: async (op, payload) => { calls.push({ op, payload }); return op === 'buffer.begin' ? { handle: 'h' } : {}; } };
  const ipc = createEngineIpc({ engine }), bytes = new Uint8Array(new Uint16Array([1, 2, 65535, 4]).buffer);
  const begun = await ipc.call(1, 'beginBuffer', { dtype: 'u16le', shape: [1, 1, 4], byte_length: 8, sha256: sha(bytes) });
  assert.ok(begun.token, JSON.stringify(begun));
  assert.deepEqual(calls[0].payload.dtype, 'u16le');
  assert.deepEqual(await ipc.call(1, 'beginBuffer', { dtype: 'u16', shape: [4], byte_length: 8, sha256: sha(bytes) }), { error: { code: 'INVALID_REQUEST', field: 'dtype' } });
});

// ---- through the real bridge and engine ----------------------------------------------------------------------------------

const pythonCheck = spawnSync(process.platform === 'win32' ? 'py' : 'python3',
  [...(process.platform === 'win32' ? ['-3.12'] : []), '-c', 'import sys, numpy; print(sys.executable)'], { encoding: 'utf8', windowsHide: true });
const python = process.env.SEDCORETOOL_TEST_PYTHON || (pythonCheck.status === 0 ? pythonCheck.stdout.trim() : null);

test('a 16-bit section through the real bridge and engine: every byte read back equals the interface\'s arrays', { skip: !python, timeout: 120000 }, async (t) => {
  const { createEngineIpc } = require('../../desktop/engine-ipc.js'), { createEngineService } = require('../../desktop/engine.js');
  const service = createEngineService({ enabled: true, packaged: false, executable: python, sourceDirectory: root, version: 'test' });
  await service.start();
  t.after(() => service.stop());
  const ipc = createEngineIpc({ engine: service }), owner = 7;
  const page = Object.fromEntries(ipc.OPERATIONS.map((name) => [name, (...args) => ipc.call(owner, name, ...args)]));
  const client = createEngineClient({ ...page, status: async () => service.status() });
  const s = section(18, { bits: 16, w: 640, h: 700 });                     // 3.6 MB of 16-bit pixels: four chunks of 1 MiB
  const tokens = await client.ensurePixels(s, s);
  const readAll = async (token, length) => {
    const parts = [];
    for (let offset = 0; offset < length; offset += 1048576) {
      const read = await page.readBuffer(token, offset, Math.min(1048576, length - offset));
      assert.equal(read.error, undefined, JSON.stringify(read.error));
      parts.push(Buffer.from(read.bytes));
    }
    return Buffer.concat(parts);
  };
  assert.ok(Buffer.from(bytesOf(s.orig)).equals(await readAll(tokens.rgba, s.orig.byteLength)), '8-bit bytes read back equal');
  const wide = await readAll(tokens.rgba16, s.orig16.byteLength);
  assert.ok(Buffer.from(bytesOf(s.orig16)).equals(wide), '16-bit bytes read back equal');
  assert.deepEqual(new Uint16Array(wide.buffer, wide.byteOffset, 8), s.orig16.subarray(0, 8), 'little-endian 16-bit values');
  assert.deepEqual(await client.ensurePixels(s, s), tokens, 'resident: nothing travels again');
  client.releaseAll(); await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(ipc.size(), 0, 'the page holds no token after a project is replaced');
  const gone = await page.readBuffer(tokens.rgba, 0, 1);
  assert.equal(gone.error?.code, 'INVALID_BUFFER');
});
