// @ts-check
// Renderer side of the engine bridge (window.corantoolDesktop.engine, see desktop/engine-ipc.js): uploads the inputs of
// one section analysis in bounded chunks, requests it, downloads the result columns and always releases every token.
// It also keeps the working pixels of sections (card M8.4.9) and record tables (card M8.4.10) in the engine. Pure: the bridge is passed in, so Node can test it
// with a fake. No DOM.
import { createResidentStore } from './residentstore.js';
import { describePixels, PIXEL_INPUTS } from './sectionpixels.js';
import { TABLE_METADATA_CHARGE } from './tablesnapshot.js';

const CHUNK_BYTES = 1048576;
const OUTPUT_TYPES = /** @type {const} */ ({ u8: Uint8Array, u16le: Uint16Array, i32le: Int32Array, u32le: Uint32Array, u64le: BigUint64Array, f64le: Float64Array });
const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/** A failure reported by the engine or its bridge: a stable `code` and, for a rejected input, the `field` at fault. */
export class EngineError extends Error {
  /** @param {string} code @param {string | null} [field] */
  constructor(code, field = null) { super(field ? `${code}: ${field}` : code); this.name = 'EngineError'; this.code = code; this.field = field; }
}

/** @param {unknown} value @returns {value is {error: {code: string, field?: string}}} */
const isFailure = (value) => !!value && typeof value === 'object' && 'error' in value && !!/** @type {any} */ (value).error;
/** @template T @param {T} value @returns {T} */
function unwrap(value) {
  if (isFailure(value)) throw new EngineError(String(value.error.code), value.error.field ?? null);
  return value;
}

/** @param {Uint8Array} bytes @returns {Promise<string>} */
async function sha256(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', /** @type {Uint8Array<ArrayBuffer>} */ (bytes)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
/** @param {ArrayLike<number> & {buffer: ArrayBufferLike, byteOffset: number, byteLength: number}} typed @returns {Uint8Array} */
const bytesOf = (typed) => new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
const abortError = () => Object.assign(new Error('Analysis cancelled'), { name: 'AbortError' });

// Inputs of one analysis. The four masks are large and change only when the section's mask version does; the tables are small.
const MASK_INPUTS = /** @type {const} */ (['labels', 'exclude', 'stack_offsets', 'stack_members']);
const TABLE_INPUTS = /** @type {const} */ (['objects', 'classes', 'settings', 'age_model', 'manual_indices']);
/** Buffers of sections that the engine keeps between analyses (card M8.4.2): total bytes and number of sections. */
export const RESIDENT_BYTES = 256 * 1048576, RESIDENT_SECTIONS = 16;
/** Working pixels of sections that the engine keeps (card M8.4.9): their own byte bound, at most RESIDENT_SECTIONS sections. Contract §3. */
export const RESIDENT_PIXEL_BYTES = 192 * 1048576;
/** Record tables that the engine keeps (card M8.4.10): their bytes as the engine charges them (a `utf8json` description 64 times) and
 * their number. With the inputs (256 MiB), the pixels (192 MiB) and the engine's reserve (16 MiB) they take 480 of the 512 MiB session
 * budget, and the 3 buffers of 16 tables keep a page within the engine's 256 handles. Contract §3. */
export const RESIDENT_TABLE_BYTES = 16 * 1048576, RESIDENT_TABLES = 16;
/** The buffers of one table (tablesnapshot.js), replaced together when its identity changes. */
const TABLE_BUFFERS = /** @type {const} */ (['meta', 'values', 'valid']);

/** @typedef {import('./residentstore.js').ResidentInput} ResidentInput @typedef {import('./residentstore.js').ResidentEntry} ResidentEntry */

/**
 * @param {{status: () => Promise<any>, beginBuffer: Function, appendBuffer: Function, commitBuffer: Function,
 *   analyzeSection: Function, cancel: Function, readBuffer: Function, release: Function, deriveBuffer?: Function, restart?: Function}} bridge
 * @param {{readyTimeoutMs?: number, residentBytes?: number, residentSections?: number, pixelBytes?: number, tableBytes?: number, tables?: number}} [options]
 */
export function createEngineClient(bridge, { readyTimeoutMs = 60000, residentBytes = RESIDENT_BYTES, residentSections = RESIDENT_SECTIONS, pixelBytes = RESIDENT_PIXEL_BYTES,
  tableBytes = RESIDENT_TABLE_BYTES, tables: tableCount = RESIDENT_TABLES } = {}) {
  if (!LITTLE_ENDIAN) throw new Error('The engine transport requires a little-endian computer');

  /** @param {string[]} tokens */
  async function releaseTokens(tokens) {
    for (let i = 0; i < tokens.length; i += 64) await bridge.release(tokens.slice(i, i + 64)).catch(() => {});
  }
  const release = (/** @type {string[]} */ tokens) => { void releaseTokens(tokens); };
  // Inputs that stay in the engine between analyses of the same section ("owner", the section object). The mask buffers are valid
  // for one key (sectionanalysis.js::maskIdentity); each table is valid for the SHA-256 of its bytes (residentstore.js).
  const resident = createResidentStore({ maxBytes: residentBytes, maxOwners: residentSections, release });
  // Working pixels of sections (card M8.4.9), valid for one sectionpixels.js::describePixels identity, with a byte budget of their own.
  const pixels = createResidentStore({ maxBytes: pixelBytes, maxOwners: residentSections, release });
  /** Uploads of pixels still running, by owner, so that two requests for the same pixels share one upload. @type {WeakMap<object, {identity: string, promise: Promise<any>}>} */
  const pixelUploads = new WeakMap();
  // Record tables (card M8.4.10), valid for one tablesnapshot.js identity. The registry's owner is one slot per (owner, key): an owner
  // may hold several tables, and a slot lives exactly as long as its owner.
  const tables = createResidentStore({ maxBytes: tableBytes, maxOwners: tableCount, release });
  /** @type {WeakMap<object, Map<string, object>>} */
  const tableSlots = new WeakMap();
  /** Uploads of tables still running, by slot. @type {WeakMap<object, {identity: string, promise: Promise<any>}>} */
  const tableUploads = new WeakMap();
  /** How masks reached the engine so far (whole, or as the changed rows of what it held), and how often its budget was full (card M8.4.9). */
  const stats = { fullMaskUploads: 0, derivations: 0, budgetFull: 0 };

  /** Waits until the engine process has started or failed; a failed engine is an error, never a fallback. */
  async function ready() {
    const deadline = Date.now() + readyTimeoutMs;
    for (;;) {
      const status = await bridge.status();
      if (status.state === 'ready') return status;
      if (status.state !== 'starting' && status.state !== 'stopped') throw new EngineError('ENGINE_UNAVAILABLE');
      if (Date.now() > deadline) throw new EngineError('ENGINE_UNAVAILABLE');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /**
   * @param {Uint8Array} bytes @param {string} dtype @param {number[]} shape @param {AbortSignal | undefined} signal
   * @param {Set<string>} tokens receives the token as soon as it exists so a later failure still releases it
   * @param {string} [digest] SHA-256 of `bytes` when the caller has it already
   * @param {() => void} [makeSpace] called once when the engine reports that its budget is full, to free buffers of other sections
   */
  async function put(bytes, dtype, shape, signal, tokens, digest, makeSpace) {
    if (signal?.aborted) throw abortError();
    const descriptor = { dtype, shape, byte_length: bytes.length, sha256: digest ?? await sha256(bytes) };
    let begun = await bridge.beginBuffer(descriptor);
    if (isFailure(begun) && begun.error.code === 'LIMIT_EXCEEDED' && makeSpace) { stats.budgetFull++; makeSpace(); begun = await bridge.beginBuffer(descriptor); }
    const { token } = unwrap(begun);
    tokens.add(token);
    for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
      if (signal?.aborted) throw abortError();
      unwrap(await bridge.appendBuffer(token, offset, bytes.slice(offset, offset + CHUNK_BYTES)));
    }
    unwrap(await bridge.commitBuffer(token));
    return token;
  }

  /**
   * A mask that differs from the one the engine holds only in some rows: the engine copies `baseToken`, the changed rows are sent into
   * the copy, and the engine commits it only if the whole content has the SHA-256 the page computed from the real array. Any refusal is
   * reported as `DERIVE_FAILED`: the caller then sends the whole mask.
   * @param {string} baseToken @param {{dtype: string, shape: number[], derive: {first: number, end: number, bytes: Uint8Array, sha256: Promise<string>}}} spec
   * @param {AbortSignal | undefined} signal @param {Set<string>} tokens
   */
  async function putDerived(baseToken, spec, signal, tokens) {
    if (signal?.aborted) throw abortError();
    const { first, bytes } = spec.derive, width = spec.shape[1];
    const total = spec.shape.reduce((n, d) => n * d, 1) * (spec.dtype === 'i32le' ? 4 : 1);
    if (typeof bridge.deriveBuffer !== 'function') throw new EngineError('DERIVE_FAILED');
    const begun = await bridge.deriveBuffer(baseToken, { dtype: spec.dtype, shape: spec.shape, byte_length: total, sha256: await spec.derive.sha256 });
    if (isFailure(begun)) throw new EngineError('DERIVE_FAILED');
    const { token } = begun;
    tokens.add(token);
    const start = first * width * (spec.dtype === 'i32le' ? 4 : 1);
    try {
      for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
        if (signal?.aborted) throw abortError();
        unwrap(await bridge.appendBuffer(token, start + offset, bytes.slice(offset, offset + CHUNK_BYTES)));
      }
      unwrap(await bridge.commitBuffer(token));
    } catch (error) {
      if (error instanceof EngineError && error.code !== 'ENGINE_UNAVAILABLE') throw new EngineError('DERIVE_FAILED');
      throw error;
    }
    return token;
  }

  /** The packed result buffer, read in ranges of at most 1 MiB and checked against the hash the engine reported. */
  async function download(/** @type {{token: string, byte_length: number, sha256: string}} */ output) {
    const bytes = new Uint8Array(output.byte_length);
    for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
      const read = unwrap(await bridge.readBuffer(output.token, offset, Math.min(CHUNK_BYTES, bytes.length - offset)));
      if (read.offset !== offset || !(read.bytes instanceof Uint8Array) || read.bytes.length !== Math.min(CHUNK_BYTES, bytes.length - offset)) throw new EngineError('INTERNAL', 'result');
      bytes.set(read.bytes, offset);
    }
    if ((await sha256(bytes)) !== output.sha256) throw new EngineError('INTERNAL', 'result');
    return bytes;
  }

  /**
   * The columns of a packed result, cut up by its layout. The layout comes from another process, so every entry is checked against the
   * buffer before it is read: a known type, a shape that matches the length, a start that is a multiple of 8, and no overlap.
   * @param {Uint8Array} bytes
   * @param {Record<string, {dtype: string, shape: number[], offset: number, byte_length: number}>} layout
   * @returns {Record<string, number[]>}
   */
  function unpack(bytes, layout) {
    /** @type {Record<string, number[]>} */
    const columns = {};
    let end = 0;
    for (const [name, part] of Object.entries(layout).sort((a, b) => a[1].offset - b[1].offset)) {
      const Type = /** @type {Record<string, any>} */ (OUTPUT_TYPES)[part.dtype];
      const items = Array.isArray(part.shape) ? part.shape.reduce((n, d) => n * d, 1) : NaN;
      const sound = !!Type && Number.isSafeInteger(part.offset) && part.offset % 8 === 0 && part.offset >= end && Number.isSafeInteger(part.byte_length)
        && part.byte_length > 0 && items * Type.BYTES_PER_ELEMENT === part.byte_length && part.offset + part.byte_length <= bytes.length;
      if (!sound) throw new EngineError('INTERNAL', 'result');
      end = part.offset + part.byte_length;
      columns[name] = Array.from(new Type(bytes.buffer, bytes.byteOffset + part.offset, items), Number);
    }
    return columns;
  }

  /** True when the engine already holds the mask buffers of `owner` for `maskKey` (so the snapshot may leave them out). */
  function hasMasks(/** @type {object} */ owner, /** @type {string} */ maskKey) {
    const entry = resident.get(owner);
    return !!entry && entry.key === maskKey && !!entry.inputs.labels && !!entry.inputs.exclude && !!entry.inputs.stack_offsets;
  }
  /** True when the engine holds complete masks of the size of `section`, so that a change of some rows can be sent instead of all of them. */
  function canDerive(/** @type {object} */ owner, /** @type {{w: number, h: number}} */ section) {
    const entry = resident.get(owner), area = section.w * section.h;
    return !!entry && entry.inputs.labels?.bytes === 4 * area && entry.inputs.exclude?.bytes === area;
  }
  /** Releases everything the engine holds for `owner`: its analysis inputs, its pixels and its tables. */
  function forget(/** @type {object} */ owner) {
    resident.forget(owner); pixels.forget(owner);
    for (const slot of tableSlots.get(owner)?.values() ?? []) tables.forget(slot);
    tableSlots.delete(owner);
  }
  /** Releases everything the engine holds for this page (a project is being replaced). */
  function releaseAll() { resident.releaseAll(); pixels.releaseAll(); tables.releaseAll(); }

  /**
   * The analysis succeeded: the freshly uploaded buffers replace the ones they supersede and stay in the engine, unless the section is
   * too large to be kept. Tokens that become resident leave `transient`; replaced ones join it.
   * @param {object} owner @param {ResidentEntry | undefined} entry @param {Record<string, ResidentInput>} fresh
   * @param {string | undefined} maskKey @param {Set<string>} transient
   */
  function keep(owner, entry, fresh, maskKey, transient) {
    const { kept, superseded } = resident.keep(owner, entry, fresh, { group: MASK_INPUTS, key: maskKey ?? null });
    if (!kept) return;
    for (const token of superseded) transient.add(token);
    for (const input of Object.values(fresh)) transient.delete(input.token);
  }

  /** True when the engine holds the working pixels of `owner` for `identity` (sectionpixels.js::describePixels). */
  function hasPixels(/** @type {object} */ owner, /** @type {string} */ identity) {
    const entry = pixels.get(owner);
    return !!entry && entry.key === identity && !!entry.inputs.rgba;
  }

  /**
   * Makes the working pixels of `section` resident in the engine for `owner` (card M8.4.9) and returns their tokens: `rgba`
   * (`u8[h,w,4]`) and, for a 16-bit image, `rgba16` (`u16le[h,w,4]`). Nothing is uploaded when the engine already holds pixels of the
   * same identity; otherwise the new buffers replace the old ones of this owner. The pixels must be in memory (`section.orig`).
   * Pixels larger than the pixel budget are never kept: the call rejects with `LIMIT_EXCEEDED` (field `pixels`) before uploading and
   * forgets older pixels of the owner (part C keeps large images in the tile store). The tokens stay valid until another section's
   * pixels push these out of the budget, `forget`, `releaseAll` or a restart; request the method that uses them right away.
   * @param {object} owner @param {any} section @param {{signal?: AbortSignal}} [options]
   * @returns {Promise<{identity: string, rgba: string, rgba16?: string}>}
   */
  async function ensurePixels(owner, section, { signal } = {}) {
    const described = await describePixels(section);
    for (;;) {
      const running = pixelUploads.get(owner);
      if (!running) break;
      if (running.identity === described.identity) return running.promise;
      await running.promise.catch(() => {});
    }
    pixels.pruneGone();
    const entry = pixels.get(owner);
    if (entry && entry.key === described.identity && entry.inputs.rgba && !!entry.inputs.rgba16 === !!described.buffers.rgba16) {
      pixels.touch(entry);
      return tokensOf(described.identity, entry);
    }
    const needed = Object.values(described.buffers).reduce((sum, buffer) => sum + buffer.data.byteLength, 0);
    if (needed > pixelBytes) { pixels.forget(owner); throw new EngineError('LIMIT_EXCEEDED', 'pixels'); }
    const promise = uploadPixels(owner, entry, described, needed, signal);
    pixelUploads.set(owner, { identity: described.identity, promise });
    try { return await promise; } finally { if (pixelUploads.get(owner)?.promise === promise) pixelUploads.delete(owner); }
  }
  /** @param {string} identity @param {ResidentEntry} entry */
  const tokensOf = (identity, entry) => ({ identity, rgba: entry.inputs.rgba.token, ...(entry.inputs.rgba16 ? { rgba16: entry.inputs.rgba16.token } : {}) });

  /**
   * @param {object} owner @param {ResidentEntry | undefined} entry
   * @param {Awaited<ReturnType<typeof describePixels>>} described @param {number} needed @param {AbortSignal | undefined} signal
   */
  async function uploadPixels(owner, entry, described, needed, signal) {
    await ready();
    const transient = /** @type {Set<string>} */ (new Set());
    try {
      pixels.makeRoom(entry, needed);
      // The engine's budget is full: drop the pixels of other sections (never their analysis inputs) and try once more.
      const makeSpace = () => pixels.makeRoom(pixels.get(owner), Infinity);
      /** @type {Record<string, ResidentInput>} */
      const fresh = {};
      for (const name of PIXEL_INPUTS) {
        const buffer = described.buffers[name];
        if (!buffer) continue;
        const token = await put(bytesOf(buffer.data), buffer.dtype, buffer.shape, signal, transient, buffer.sha256, makeSpace);
        fresh[name] = { token, identity: described.identity, bytes: buffer.data.byteLength };
      }
      const { kept, superseded } = pixels.keep(owner, pixels.get(owner) ?? entry, fresh, { group: PIXEL_INPUTS, key: described.identity });
      if (!kept) throw new EngineError('LIMIT_EXCEEDED', 'pixels');
      for (const token of superseded) transient.add(token);
      for (const input of Object.values(fresh)) transient.delete(input.token);
      return tokensOf(described.identity, /** @type {ResidentEntry} */ (pixels.get(owner)));
    } finally {
      void releaseTokens([...transient]);
    }
  }

  /** The registry slot of the table `key` of `owner`, made on first use when `create` is true. */
  function tableSlot(/** @type {object} */ owner, /** @type {string} */ key, create = false) {
    let slots = tableSlots.get(owner);
    if (!slots && create) tableSlots.set(owner, (slots = new Map()));
    let slot = slots?.get(key);
    if (!slot && create && slots) slots.set(key, (slot = {}));
    return slot;
  }
  /** True when the engine holds the table `key` of `owner` for `identity` (tablesnapshot.js::buildTableSnapshot). */
  function hasTable(/** @type {object} */ owner, /** @type {string} */ key, /** @type {string} */ identity) {
    const slot = tableSlot(owner, key), entry = slot && tables.get(slot);
    return !!entry && entry.key === identity && TABLE_BUFFERS.every((name) => !!entry.inputs[name]);
  }

  /**
   * Makes a record table resident in the engine as the table `key` of `owner` (card M8.4.10) and returns the tokens of its three buffers:
   * `meta` (`utf8json`), `values` (`f64le[columns, rows]`) and `valid` (`u8[columns, rows]`), which a method receives under the input
   * names of `tablesnapshot.js::tableInputNames`. `snapshot` comes from `buildTableSnapshot`. Nothing is uploaded when the engine already
   * holds this table with the same identity; otherwise the new buffers replace the old ones of that key. A table whose charge is larger
   * than the table budget is never kept (`LIMIT_EXCEEDED`, field `table`, before anything is sent). The tokens stay valid until other
   * tables push this one out of the budget, `forget(owner)`, `releaseAll` or a restart; request the method that uses them right away.
   * @param {object} owner @param {string} key @param {import('./tablesnapshot.js').TableSnapshot} snapshot @param {{signal?: AbortSignal}} [options]
   * @returns {Promise<{identity: string, meta: string, values: string, valid: string}>}
   */
  async function ensureTable(owner, key, snapshot, { signal } = {}) {
    if (!owner || typeof owner !== 'object' || typeof key !== 'string' || !key) throw new EngineError('INVALID_REQUEST', 'table');
    const { identity, buffers, chargedBytes } = snapshot ?? {};
    const sound = typeof identity === 'string' && /^[0-9a-f]{64}$/.test(identity) && Number.isSafeInteger(chargedBytes) && chargedBytes > 0
      && buffers?.meta?.dtype === 'utf8json' && buffers?.values?.dtype === 'f64le' && buffers?.valid?.dtype === 'u8'
      && buffers.meta.data instanceof Uint8Array && buffers.values.data instanceof Float64Array && buffers.valid.data instanceof Uint8Array;
    if (!sound) throw new EngineError('INVALID_REQUEST', 'table');
    const slot = /** @type {object} */ (tableSlot(owner, key, true));
    for (;;) {
      const running = tableUploads.get(slot);
      if (!running) break;
      if (running.identity === identity) return running.promise;
      await running.promise.catch(() => {});
    }
    tables.pruneGone();
    const entry = tables.get(slot);
    if (entry && entry.key === identity && TABLE_BUFFERS.every((name) => !!entry.inputs[name])) {
      tables.touch(entry);
      return tableTokens(identity, entry);
    }
    if (chargedBytes > tableBytes) { tables.forget(slot); throw new EngineError('LIMIT_EXCEEDED', 'table'); }
    const promise = uploadTable(slot, entry, snapshot, signal);
    tableUploads.set(slot, { identity, promise });
    try { return await promise; } finally { if (tableUploads.get(slot)?.promise === promise) tableUploads.delete(slot); }
  }
  /** @param {string} identity @param {ResidentEntry} entry */
  const tableTokens = (identity, entry) => ({ identity, meta: entry.inputs.meta.token, values: entry.inputs.values.token, valid: entry.inputs.valid.token });

  /**
   * @param {object} slot @param {ResidentEntry | undefined} entry @param {import('./tablesnapshot.js').TableSnapshot} snapshot
   * @param {AbortSignal | undefined} signal
   */
  async function uploadTable(slot, entry, snapshot, signal) {
    await ready();
    const transient = /** @type {Set<string>} */ (new Set());
    try {
      tables.makeRoom(entry, snapshot.chargedBytes);
      // The engine's budget is full: drop the other tables and the pixels of every section (both are sent again on demand), then try once more.
      const makeSpace = () => { tables.makeRoom(tables.get(slot), Infinity); pixels.makeRoom(undefined, Infinity); };
      /** @type {Record<string, ResidentInput>} */
      const fresh = {};
      for (const name of TABLE_BUFFERS) {
        const buffer = snapshot.buffers[name];
        const token = await put(bytesOf(buffer.data), buffer.dtype, buffer.shape, signal, transient, buffer.sha256, makeSpace);
        fresh[name] = { token, identity: snapshot.identity, bytes: buffer.data.byteLength * (buffer.dtype === 'utf8json' ? TABLE_METADATA_CHARGE : 1) };
      }
      const { kept, superseded } = tables.keep(slot, tables.get(slot) ?? entry, fresh, { group: TABLE_BUFFERS, key: snapshot.identity });
      if (!kept) throw new EngineError('LIMIT_EXCEEDED', 'table');
      for (const token of superseded) transient.add(token);
      for (const input of Object.values(fresh)) transient.delete(input.token);
      return tableTokens(snapshot.identity, /** @type {ResidentEntry} */ (tables.get(slot)));
    } finally {
      void releaseTokens([...transient]);
    }
  }

  /**
   * Runs `section.intervals/1` on a snapshot of `buildIntervalSnapshot` and returns the decoded result columns.
   * Rejects with an `EngineError` (code and field), or with an `AbortError` when the signal fires first.
   *
   * With `owner` (the section) and `maskKey` the inputs stay in the engine afterwards: the next call reuses the masks when
   * `maskKey` is the same (the snapshot may then carry `null` masks, see `hasMasks`) and every table whose bytes did not change.
   * It rejects with `RESIDENT_LOST` when the snapshot has no masks and the engine no longer has them; the caller builds a full
   * snapshot and asks again.
   * @param {any} snapshot
   * @param {{signal?: AbortSignal, owner?: object, maskKey?: string}} [options]
   * @returns {Promise<{dimensions: {bins: number, classes: number, schemes: number}, columns: Record<string, {data: number[], valid?: number[]}>, provenance: any,
   *   timing: {upload_ms: number, engine_ms: number, download_ms: number}}>}
   */
  async function analyze(snapshot, { signal, owner, maskKey } = {}) {
    await ready();
    const started = performance.now();
    /** Tokens released when the call ends, except those that become resident. */
    const transient = /** @type {Set<string>} */ (new Set());
    const requestKey = crypto.randomUUID();
    const onAbort = () => { void bridge.cancel(requestKey); };
    signal?.addEventListener('abort', onAbort, { once: true });
    resident.pruneGone();
    const entry = owner ? resident.get(owner) : undefined;
    /** @type {Record<string, ResidentInput>} */
    const fresh = {};
    /** @type {Record<string, string>} */
    const inputs = {};
    // The engine's budget is full: drop the inputs and the pixels of other sections (pixels are only a reserve), then try once more.
    const makeSpace = owner ? () => { resident.makeRoom(entry, Infinity); pixels.makeRoom(pixels.get(owner), Infinity); } : undefined;
    let reused = false, derivedMasks = false;
    try {
      if (snapshot.labels === null) {
        if (!owner || !entry || entry.key !== maskKey || !entry.inputs.labels || !entry.inputs.exclude || !entry.inputs.stack_offsets) throw new EngineError('RESIDENT_LOST');
        for (const name of MASK_INPUTS) if (entry.inputs[name]) inputs[name] = entry.inputs[name].token;
        reused = true;
        resident.touch(entry);
      } else {
        const masks = MASK_INPUTS.filter((name) => snapshot[name]);
        const sizeOf = (/** @type {any} */ spec) => (spec.derive ? spec.shape.reduce((/** @type {number} */ n, /** @type {number} */ d) => n * d, 1) * (spec.dtype === 'i32le' ? 4 : 1) : bytesOf(spec.data).length);
        if (owner) resident.makeRoom(entry, masks.reduce((sum, name) => sum + sizeOf(snapshot[name]), 0));
        for (const name of masks) {
          const spec = snapshot[name];
          let token;
          if (spec.derive) {
            if (!owner || !entry?.inputs[name]) throw new EngineError('DERIVE_FAILED');
            token = await putDerived(entry.inputs[name].token, spec, signal, transient);
            derivedMasks = true;
          } else {
            token = await put(bytesOf(spec.data), spec.dtype, spec.shape, signal, transient, undefined, makeSpace);
          }
          inputs[name] = token;
          fresh[name] = { token, identity: maskKey ?? '', bytes: sizeOf(spec) };
        }
      }
      let settingsHash = '';
      for (const name of TABLE_INPUTS) {
        const bytes = new TextEncoder().encode(JSON.stringify(snapshot[name])), digest = await sha256(bytes);
        if (name === 'settings') settingsHash = digest;
        const resident = entry?.inputs[name];
        if (resident && resident.identity === digest) { inputs[name] = resident.token; reused = true; continue; }
        const token = await put(bytes, 'utf8json', [bytes.length], signal, transient, digest, makeSpace);
        inputs[name] = token;
        fresh[name] = { token, identity: digest, bytes: bytes.length };
      }
      if (signal?.aborted) throw abortError();
      const uploaded = performance.now();
      let result;
      try {
        result = unwrap(await bridge.analyzeSection({ requestKey, method: 'section.intervals/1', project: crypto.randomUUID(), section: crypto.randomUUID(),
          revision: 0, settings_hash: settingsHash, inputs }));
      } catch (error) {
        // The engine was restarted since the buffers were uploaded: it no longer knows them.
        if (reused && owner && error instanceof EngineError && error.code === 'INVALID_BUFFER') { forget(owner); throw new EngineError('RESIDENT_LOST'); }
        throw error;
      }
      if (result.cancelled) throw abortError();
      const analysed = performance.now();
      for (const output of Object.values(result.outputs)) transient.add(/** @type {any} */ (output).token);
      const packed = result.outputs?.result;
      if (!packed || Object.keys(result.outputs).length !== 1 || !result.layout || typeof result.layout !== 'object') throw new EngineError('INTERNAL', 'result');
      const cells = unpack(await download(packed), result.layout);
      if (signal?.aborted) throw abortError();
      /** @type {Record<string, {data: number[], valid?: number[]}>} */
      const columns = {};
      for (const name of Object.keys(cells)) {
        if (name.endsWith('_valid')) continue;
        columns[name] = { data: cells[name], ...(cells[`${name}_valid`] ? { valid: cells[`${name}_valid`] } : {}) };
      }
      const finished = performance.now();
      if (MASK_INPUTS.some((name) => fresh[name])) stats[derivedMasks ? 'derivations' : 'fullMaskUploads']++;
      if (owner) keep(owner, entry, fresh, maskKey, transient);
      return { dimensions: result.dimensions, columns, provenance: result.provenance,
        timing: { upload_ms: uploaded - started, engine_ms: analysed - uploaded, download_ms: finished - analysed } };
    } finally {
      signal?.removeEventListener('abort', onAbort);
      void releaseTokens([...transient]);   // the engine frees them in the background: the caller does not wait for it
    }
  }

  /**
   * Starts a new engine session (card M8.4.7). Everything the old session held is gone, so every resident input is forgotten without
   * asking the engine to release it, and the next analysis of each section uploads its inputs whole. `automatic` marks the one restart per
   * program session that the interface may make by itself; the main process refuses a second one with `LIMIT_EXCEEDED`.
   * @param {{automatic?: boolean}} [options]
   */
  async function restart({ automatic = false } = {}) {
    if (typeof bridge.restart !== 'function') throw new EngineError('ENGINE_UNAVAILABLE');
    resident.invalidateAll();
    pixels.invalidateAll();
    tables.invalidateAll();
    unwrap(await bridge.restart({ automatic }));
    await ready();
  }

  return { analyze, ready, restart, hasMasks, canDerive, forget, releaseAll, ensurePixels, hasPixels, ensureTable, hasTable,
    residentBytes: resident.bytes, residentSections: resident.owners, residentPixelBytes: pixels.bytes, residentPixelSections: pixels.owners,
    residentTableBytes: tables.bytes, residentTables: tables.owners,
    stats: () => ({ ...stats, residentBytes: resident.bytes(), residentPixelBytes: pixels.bytes(), residentPixelSections: pixels.owners(),
      residentTableBytes: tables.bytes(), residentTables: tables.owners() }) };
}
