// Narrow, validated bridge between one page and the engine client. No Electron dependency: main.js passes in the
// sender's identity, so this file can be tested with Node and a fake engine. A page never names operations, paths or
// handles; it works with tokens that only this module can map to engine handles, and only for the page that made them.
const { randomUUID } = require('node:crypto');

const MAX_CHUNK = 1048576, MAX_BUFFER = 256 * 1024 * 1024, MAX_TOKENS_PER_PAGE = 512, MAX_RELEASE = 64, MAX_ANALYSES_PER_PAGE = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const DTYPES = new Set(['u8', 'i32le', 'u32le', 'u64le', 'f64le', 'utf8json']);
// Mirrors METHOD_INPUTS in src/sedcoretool/engine/specs.py; tests/app/engine-ipc.test.mjs compares the two files.
const ANALYSES = {
  'section.intervals/1': {
    required: ['labels', 'exclude', 'objects', 'classes', 'stack_offsets', 'settings', 'age_model', 'manual_indices'],
    optional: ['stack_members'],
  },
};

class Rejected extends Error {
  constructor(code, field = null) { super(code); this.code = code; this.field = field; }
}
const reject = (code, field) => { throw new Rejected(code, field); };
const isCount = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
const isPlain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

const COLUMN_NAME = /^[A-Za-z][A-Za-z_]{0,63}$/;
const COLUMN_DTYPES = new Set(['u8', 'i32le', 'u32le', 'u64le', 'f64le']);
/** The layout of the packed result buffer as the page may see it: only the four known fields of at most 64 columns, nothing else. */
function cleanLayout(layout) {
  if (!isPlain(layout)) reject('INTERNAL', 'layout');
  const names = Object.keys(layout);
  if (!names.length || names.length > 64) reject('INTERNAL', 'layout');
  const clean = {};
  for (const name of names) {
    const part = layout[name];
    const ok = COLUMN_NAME.test(name) && isPlain(part) && COLUMN_DTYPES.has(part.dtype) && Array.isArray(part.shape) && part.shape.length >= 1 && part.shape.length <= 3
      && part.shape.every((n) => isCount(n, 1)) && isCount(part.offset) && isCount(part.byte_length, 1);
    if (!ok) reject('INTERNAL', 'layout');
    clean[name] = { dtype: part.dtype, shape: [...part.shape], offset: part.offset, byte_length: part.byte_length };
  }
  return clean;
}

/** The error a page sees: a stable code and, for a rejected input, the field at fault. Never a message or a stack. */
function failure(error) {
  if (error instanceof Rejected) return { error: { code: error.code, ...(error.field ? { field: error.field } : {}) } };
  const code = typeof error?.code === 'string' && /^[A-Z_]{3,40}$/.test(error.code) ? error.code : 'INTERNAL';
  return { error: { code, ...(typeof error?.field === 'string' ? { field: error.field.slice(0, 80) } : {}) } };
}

function bytesOf(value) {
  if (Buffer.isBuffer(value)) return value;
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  return null;
}

/**
 * @param engine the engine service of desktop/engine.js: `request(op, payload, binary)` returning a promise that carries
 *   `requestId`, and `session()` returning the current session or null.
 */
function createEngineIpc({ engine }) {
  const tokens = new Map();      // token -> {owner, session, handle, state, length, next, dtype, shape, sha256}
  const analyses = new Map();    // `${owner}/${requestKey}` -> {owner, engineRequest}

  const countOf = (owner) => { let n = 0; for (const entry of tokens.values()) if (entry.owner === owner) n++; return n; };
  function own(owner, token, { committed } = {}) {
    const entry = typeof token === 'string' ? tokens.get(token) : undefined;
    if (!entry || entry.owner !== owner) reject('INVALID_BUFFER', 'token');
    if (entry.session !== engine.session()) { tokens.delete(token); reject('INVALID_BUFFER', 'token'); }   // the engine restarted
    if (committed === true && entry.state !== 'committed') reject('INVALID_BUFFER', 'token');
    if (committed === false && entry.state !== 'staging') reject('INVALID_BUFFER', 'token');
    return entry;
  }
  function release(handles) {
    // Failure to release is not actionable: a stopped engine has already dropped everything.
    for (let i = 0; i < handles.length; i += MAX_RELEASE) engine.request('buffer.release', { handles: handles.slice(i, i + MAX_RELEASE) }).catch(() => {});
  }

  const operations = {
    async beginBuffer(owner, descriptor) {
      if (!isPlain(descriptor) || Object.keys(descriptor).sort().join() !== 'byte_length,dtype,sha256,shape') reject('INVALID_REQUEST', 'descriptor');
      const { dtype, shape, byte_length: length, sha256 } = descriptor;
      if (!DTYPES.has(dtype)) reject('INVALID_REQUEST', 'dtype');
      if (!Array.isArray(shape) || shape.length < 1 || shape.length > 3 || !shape.every((n) => isCount(n, 1))) reject('INVALID_REQUEST', 'shape');
      if (!isCount(length, 1) || length > MAX_BUFFER) reject('LIMIT_EXCEEDED', 'byte_length');
      if (typeof sha256 !== 'string' || !SHA256.test(sha256)) reject('INVALID_REQUEST', 'sha256');
      if (countOf(owner) >= MAX_TOKENS_PER_PAGE) reject('LIMIT_EXCEEDED', 'tokens');
      const { handle } = await engine.request('buffer.begin', { dtype, shape, byte_length: length, sha256 });
      const session = engine.session(), token = randomUUID();
      tokens.set(token, { owner, session, handle, state: 'staging', length, next: 0, dtype, shape, sha256 });
      return { token };
    },
    /** A new buffer that starts as a copy of the committed buffer `baseToken` (same type, shape and length) and receives only the parts that
     *  changed, at ascending offsets, before `commitBuffer`; the engine accepts the result only if its whole content has the declared SHA-256. */
    async deriveBuffer(owner, baseToken, descriptor) {
      const base = own(owner, baseToken, { committed: true });
      if (!isPlain(descriptor) || Object.keys(descriptor).sort().join() !== 'byte_length,dtype,sha256,shape') reject('INVALID_REQUEST', 'descriptor');
      const { dtype, shape, byte_length: length, sha256 } = descriptor;
      if (dtype === 'utf8json' || dtype !== base.dtype) reject('INVALID_REQUEST', 'dtype');
      if (!Array.isArray(shape) || shape.length !== base.shape.length || !shape.every((n, i) => n === base.shape[i])) reject('INVALID_REQUEST', 'shape');
      if (length !== base.length) reject('INVALID_REQUEST', 'byte_length');
      if (typeof sha256 !== 'string' || !SHA256.test(sha256)) reject('INVALID_REQUEST', 'sha256');
      if (countOf(owner) >= MAX_TOKENS_PER_PAGE) reject('LIMIT_EXCEEDED', 'tokens');
      const { handle } = await engine.request('buffer.derive', { base: base.handle, dtype, shape, byte_length: length, sha256 });
      const session = engine.session(), token = randomUUID();
      tokens.set(token, { owner, session, handle, state: 'staging', length, next: 0, dtype, shape: [...shape], sha256, derived: true });
      return { token };
    },
    async appendBuffer(owner, token, offset, data) {
      const entry = own(owner, token, { committed: false }), bytes = bytesOf(data);
      if (!bytes || bytes.length < 1 || bytes.length > MAX_CHUNK) reject('INVALID_REQUEST', 'bytes');
      // A derived buffer takes its parts at ascending, non-overlapping offsets; any other buffer takes them in order, without gaps.
      const inOrder = entry.derived ? isCount(offset) && offset >= entry.next : offset === entry.next;
      if (!isCount(offset) || !inOrder || offset + bytes.length > entry.length) reject('INVALID_REQUEST', 'offset');
      entry.next = offset + bytes.length;   // reserved before the first await, so two appends cannot take the same offset
      try { return await engine.request('buffer.chunk', { handle: entry.handle, offset, byte_length: bytes.length }, Buffer.from(bytes)); }
      catch (error) { tokens.delete(token); throw error; }   // a rejected chunk leaves the engine buffer unusable
    },
    async commitBuffer(owner, token) {
      const entry = own(owner, token, { committed: false });
      if (!entry.derived && entry.next !== entry.length) reject('INVALID_BUFFER', 'byte_length');
      const result = await engine.request('buffer.commit', { handle: entry.handle });
      entry.state = 'committed';
      return { token, byte_length: result.byte_length, sha256: result.sha256 };
    },
    async readBuffer(owner, token, offset, length) {
      const entry = own(owner, token, { committed: true });
      if (!isCount(offset) || !isCount(length, 1) || length > MAX_CHUNK || offset + length > entry.length) reject('INVALID_REQUEST', 'range');
      const result = await engine.request('buffer.read', { handle: entry.handle, offset, byte_length: length });
      return { offset: result.offset, bytes: result.bytes };
    },
    async analyzeSection(owner, request) {
      if (!isPlain(request)) reject('INVALID_REQUEST', 'request');
      const { requestKey, method, project, section, revision, settings_hash: settingsHash, inputs } = request;
      const allowed = Object.keys(request).every((key) => ['requestKey', 'method', 'project', 'section', 'revision', 'settings_hash', 'inputs'].includes(key));
      if (!allowed) reject('INVALID_REQUEST', 'request');
      if (typeof requestKey !== 'string' || !UUID.test(requestKey)) reject('INVALID_REQUEST', 'requestKey');
      const spec = typeof method === 'string' && Object.hasOwn(ANALYSES, method) ? ANALYSES[method] : reject('UNSUPPORTED_METHOD', 'method');
      if (typeof project !== 'string' || !UUID.test(project)) reject('INVALID_REQUEST', 'project');
      if (typeof section !== 'string' || !UUID.test(section)) reject('INVALID_REQUEST', 'section');
      if (!isCount(revision)) reject('INVALID_REQUEST', 'revision');
      if (typeof settingsHash !== 'string' || !SHA256.test(settingsHash)) reject('INVALID_REQUEST', 'settings_hash');
      if (!isPlain(inputs)) reject('INVALID_REQUEST', 'inputs');
      const names = Object.keys(inputs), known = new Set([...spec.required, ...spec.optional]);
      for (const name of names) if (!known.has(name)) reject('INVALID_REQUEST', `inputs.${name}`);
      for (const name of spec.required) if (!names.includes(name)) reject('INVALID_REQUEST', `inputs.${name}`);
      const key = `${owner}/${requestKey}`;
      if (analyses.has(key)) reject('INVALID_REQUEST', 'requestKey');
      if ([...analyses.values()].filter((item) => item.owner === owner).length >= MAX_ANALYSES_PER_PAGE) reject('BUSY');
      const handles = {};
      for (const name of names) handles[name] = own(owner, inputs[name], { committed: true }).handle;
      const session = engine.session();
      const call = engine.request('section.analyze', { method, project, section, revision, settings_hash: settingsHash, inputs: handles });
      const running = { owner, engineRequest: call.requestId, abandoned: false };
      analyses.set(key, running);
      let result;
      try { result = await call; }
      finally { analyses.delete(key); }
      if (result?.cancelled) return { cancelled: true };
      if (running.abandoned) {   // the page went away while the job ran: nobody can ever read or release these results
        release(Object.values(result.outputs).map((output) => output.handle));
        return { cancelled: true };
      }
      const outputs = {};
      for (const [name, output] of Object.entries(result.outputs)) {
        const token = randomUUID();
        tokens.set(token, { owner, session, handle: output.handle, state: 'committed', length: output.byte_length, next: output.byte_length,
          dtype: output.dtype, shape: output.shape, sha256: output.sha256 });
        outputs[name] = { token, dtype: output.dtype, shape: output.shape, byte_length: output.byte_length, sha256: output.sha256 };
      }
      let layout;
      try { layout = cleanLayout(result.layout); }
      catch (error) { for (const output of Object.values(outputs)) { tokens.delete(output.token); } release(Object.values(result.outputs).map((output) => output.handle)); throw error; }
      return { project: result.project, section: result.section, revision: result.revision, settings_hash: result.settings_hash, method: result.method,
        dimensions: result.dimensions, outputs, layout, provenance: result.provenance };
    },
    async cancel(owner, requestKey) {
      if (typeof requestKey !== 'string' || !UUID.test(requestKey)) reject('INVALID_REQUEST', 'requestKey');
      const running = analyses.get(`${owner}/${requestKey}`);
      if (!running) return { state: 'already_terminal' };
      return engine.request('job.cancel', { request_id: running.engineRequest });
    },
    async release(owner, list) {
      if (!Array.isArray(list) || list.length > MAX_RELEASE || !list.every((token) => typeof token === 'string')) reject('INVALID_REQUEST', 'tokens');
      const handles = [];
      for (const token of new Set(list)) {
        const entry = tokens.get(token);
        if (entry && entry.owner === owner) { tokens.delete(token); if (entry.session === engine.session()) handles.push(entry.handle); }
      }
      if (handles.length) release(handles);
      return { released: handles.length };
    },
  };

  return {
    /** Runs one bridge operation for `owner` (the sender's id). Always resolves: a failure is `{error: {code, field?}}`. */
    async call(owner, name, ...args) {
      if (!Object.hasOwn(operations, name)) return failure(new Rejected('UNSUPPORTED_METHOD'));
      try { return await operations[name](owner, ...args); }
      catch (error) { return failure(error); }
    },
    /** A page reloaded or closed: stop its analyses and let go of every buffer it holds. */
    releasePage(owner) {
      for (const running of analyses.values()) {
        if (running.owner !== owner) continue;
        running.abandoned = true;
        engine.request('job.cancel', { request_id: running.engineRequest }).catch(() => {});
      }
      const handles = [];
      for (const [token, entry] of tokens) {
        if (entry.owner !== owner) continue;
        tokens.delete(token);
        if (entry.session === engine.session()) handles.push(entry.handle);
      }
      if (handles.length) release(handles);
    },
    size: () => tokens.size,
    OPERATIONS: Object.keys(operations),
  };
}

module.exports = { createEngineIpc, ANALYSES, MAX_TOKENS_PER_PAGE };
