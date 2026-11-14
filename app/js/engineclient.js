// @ts-check
// Renderer side of the engine bridge (window.corantoolDesktop.engine, see desktop/engine-ipc.js): uploads the inputs of
// one section analysis in bounded chunks, requests it, downloads the result columns and always releases every token.
// Pure: the bridge is passed in, so Node can test it with a fake. No DOM.

const CHUNK_BYTES = 1048576;
const OUTPUT_TYPES = /** @type {const} */ ({ u8: Uint8Array, i32le: Int32Array, u32le: Uint32Array, u64le: BigUint64Array, f64le: Float64Array });
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

/**
 * @typedef {{token: string, identity: string, bytes: number}} ResidentInput
 * @typedef {{owner: WeakRef<object>, maskKey: string | null, inputs: Record<string, ResidentInput>, used: number}} ResidentEntry
 */

/**
 * @param {{status: () => Promise<any>, beginBuffer: Function, appendBuffer: Function, commitBuffer: Function,
 *   analyzeSection: Function, cancel: Function, readBuffer: Function, release: Function}} bridge
 * @param {{readyTimeoutMs?: number, residentBytes?: number, residentSections?: number}} [options]
 */
export function createEngineClient(bridge, { readyTimeoutMs = 60000, residentBytes = RESIDENT_BYTES, residentSections = RESIDENT_SECTIONS } = {}) {
  if (!LITTLE_ENDIAN) throw new Error('The engine transport requires a little-endian computer');

  // Inputs that stay in the engine between analyses of the same section ("owner", the section object). The mask buffers are valid
  // for one `maskKey` (sectionanalysis.js::maskIdentity); each table is valid for the SHA-256 of its bytes. Entries do not keep their
  // owner alive: a section that is gone has its buffers released at the next analysis.
  /** @type {WeakMap<object, ResidentEntry>} */
  const byOwner = new WeakMap();
  /** @type {Set<ResidentEntry>} */
  const entries = new Set();
  let clock = 0;

  /** @param {string[]} tokens */
  async function releaseTokens(tokens) {
    for (let i = 0; i < tokens.length; i += 64) await bridge.release(tokens.slice(i, i + 64)).catch(() => {});
  }
  const entryBytes = (/** @type {ResidentEntry} */ entry) => Object.values(entry.inputs).reduce((sum, input) => sum + input.bytes, 0);
  const residentTotal = () => { let sum = 0; for (const entry of entries) sum += entryBytes(entry); return sum; };
  /** @param {ResidentEntry} entry */
  function drop(entry) {
    entries.delete(entry);
    const owner = entry.owner.deref();
    if (owner && byOwner.get(owner) === entry) byOwner.delete(owner);
    void releaseTokens(Object.values(entry.inputs).map((input) => input.token));
    entry.inputs = {};
  }
  function pruneGone() { for (const entry of [...entries]) if (!entry.owner.deref()) drop(entry); }
  /** Frees room for `needed` more bytes by dropping the least recently used entries other than `keepEntry`. */
  function makeRoom(/** @type {ResidentEntry | undefined} */ keepEntry, /** @type {number} */ needed) {
    pruneGone();
    const others = [...entries].filter((entry) => entry !== keepEntry).sort((a, b) => a.used - b.used);
    while (others.length && (residentTotal() + needed > residentBytes || others.length >= residentSections)) drop(/** @type {ResidentEntry} */ (others.shift()));
  }

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
    if (isFailure(begun) && begun.error.code === 'LIMIT_EXCEEDED' && makeSpace) { makeSpace(); begun = await bridge.beginBuffer(descriptor); }
    const { token } = unwrap(begun);
    tokens.add(token);
    for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
      if (signal?.aborted) throw abortError();
      unwrap(await bridge.appendBuffer(token, offset, bytes.slice(offset, offset + CHUNK_BYTES)));
    }
    unwrap(await bridge.commitBuffer(token));
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
    const entry = byOwner.get(owner);
    return !!entry && entry.maskKey === maskKey && !!entry.inputs.labels && !!entry.inputs.exclude && !!entry.inputs.stack_offsets;
  }
  function forget(/** @type {object} */ owner) { const entry = byOwner.get(owner); if (entry) drop(entry); }
  function releaseAll() { for (const entry of [...entries]) drop(entry); }

  /**
   * The analysis succeeded: the freshly uploaded buffers replace the ones they supersede and stay in the engine, unless the section is
   * too large to be kept. Tokens that become resident leave `transient`; replaced ones join it.
   * @param {object} owner @param {ResidentEntry | undefined} entry @param {Record<string, ResidentInput>} fresh
   * @param {string | undefined} maskKey @param {Set<string>} transient
   */
  function keep(owner, entry, fresh, maskKey, transient) {
    const names = Object.keys(fresh);
    if (!names.length) { if (entry) entry.used = ++clock; return; }
    const target = entry ?? { owner: new WeakRef(owner), maskKey: null, inputs: /** @type {Record<string, ResidentInput>} */ ({}), used: 0 };
    const newMasks = names.some((name) => /** @type {readonly string[]} */ (MASK_INPUTS).includes(name));
    const superseded = (newMasks ? [...MASK_INPUTS, ...names.filter((name) => !(/** @type {readonly string[]} */ (MASK_INPUTS).includes(name)))] : names).filter((name) => target.inputs[name]);
    const added = names.reduce((sum, name) => sum + fresh[name].bytes, 0);
    const freed = superseded.reduce((sum, name) => sum + target.inputs[name].bytes, 0);
    makeRoom(target, added - freed);
    if (residentTotal() + added - freed > residentBytes) {   // too large to keep: forget this section, release what it held
      if (entry) drop(entry);
      return;
    }
    for (const name of superseded) { transient.add(target.inputs[name].token); delete target.inputs[name]; }
    for (const name of names) { target.inputs[name] = fresh[name]; transient.delete(fresh[name].token); }
    if (newMasks) target.maskKey = maskKey ?? null;
    target.used = ++clock;
    entries.add(target);
    byOwner.set(owner, target);
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
    pruneGone();
    const entry = owner ? byOwner.get(owner) : undefined;
    /** @type {Record<string, ResidentInput>} */
    const fresh = {};
    /** @type {Record<string, string>} */
    const inputs = {};
    const makeSpace = owner ? () => makeRoom(entry, Infinity) : undefined;
    let reused = false;
    try {
      if (snapshot.labels === null) {
        if (!owner || !entry || entry.maskKey !== maskKey || !entry.inputs.labels || !entry.inputs.exclude || !entry.inputs.stack_offsets) throw new EngineError('RESIDENT_LOST');
        for (const name of MASK_INPUTS) if (entry.inputs[name]) inputs[name] = entry.inputs[name].token;
        reused = true;
        entry.used = ++clock;
      } else {
        const masks = MASK_INPUTS.filter((name) => snapshot[name]);
        if (owner) makeRoom(entry, masks.reduce((sum, name) => sum + bytesOf(snapshot[name].data).length, 0));
        for (const name of masks) {
          const bytes = bytesOf(snapshot[name].data);
          const token = await put(bytes, snapshot[name].dtype, snapshot[name].shape, signal, transient, undefined, makeSpace);
          inputs[name] = token;
          fresh[name] = { token, identity: maskKey ?? '', bytes: bytes.length };
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
      if (owner) keep(owner, entry, fresh, maskKey, transient);
      return { dimensions: result.dimensions, columns, provenance: result.provenance,
        timing: { upload_ms: uploaded - started, engine_ms: analysed - uploaded, download_ms: finished - analysed } };
    } finally {
      signal?.removeEventListener('abort', onAbort);
      void releaseTokens([...transient]);   // the engine frees them in the background: the caller does not wait for it
    }
  }

  return { analyze, ready, hasMasks, forget, releaseAll, residentBytes: residentTotal, residentSections: () => entries.size };
}
