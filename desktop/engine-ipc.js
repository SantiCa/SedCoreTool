// Narrow, validated bridge between one page and the engine client. No Electron dependency: main.js passes in the
// sender's identity, so this file can be tested with Node and a fake engine. A page never names operations, paths or
// handles; it works with tokens that only this module can map to engine handles, and only for the page that made them.
const { randomUUID } = require('node:crypto');

// Tokens per page (contract §9.7): a project request names up to 3 x 128 table buffers besides what the page keeps resident.
const MAX_CHUNK = 1048576, MAX_BUFFER = 256 * 1024 * 1024, MAX_TOKENS_PER_PAGE = 1024, MAX_RELEASE = 64, MAX_ANALYSES_PER_PAGE = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const DTYPES = new Set(['u8', 'u16le', 'i32le', 'u32le', 'u64le', 'f64le', 'utf8json']);   // mirrors ITEM_BYTES in src/sedcoretool/engine/buffers.py
// Mirrors METHOD_INPUTS in src/sedcoretool/engine/specs.py; tests/app/engine-ipc.test.mjs compares the two files.
const ANALYSES = {
  'section.intervals/1': {
    required: ['labels', 'exclude', 'objects', 'classes', 'stack_offsets', 'settings', 'age_model', 'manual_indices'],
    optional: ['stack_members'],
  },
};

// Mirrors METHOD_SPECS in src/sedcoretool/engine/specs.py (contract §9.6): scope, fixed input names, families, priorities, dimension
// names and table outputs of each method `method.run` may name. tests/app/engine-run.test.mjs compares the two (through Python).
const METHODS = deepFreeze({
  'section.intervals/1': {
    scope: 'section', required: [...ANALYSES['section.intervals/1'].required], optional: [...ANALYSES['section.intervals/1'].optional], families: [],
    priorities: ['interactive'], dimensions: ['bins', 'classes', 'schemes'], tables: [],
  },
  'core.ages/1': {
    scope: 'core', required: ['settings', 'age_model', 'age_model_values', 'age_model_valid', 'query', 'query_values', 'query_valid'], optional: [], families: [],
    priorities: ['interactive'], dimensions: ['rows'], tables: ['ages'],
  },
  'core.depths/1': {
    scope: 'core', required: ['settings', 'age_model', 'age_model_values', 'age_model_valid', 'query', 'query_values', 'query_valid'], optional: [], families: [],
    priorities: ['interactive'], dimensions: ['rows'], tables: ['depths'],
  },
  'core.age_model/1': {
    scope: 'core', required: ['settings', 'text'], optional: [], families: [], priorities: ['interactive'], dimensions: ['rows'], tables: ['model'],
  },
  'core.bacon/1': {
    scope: 'core', required: ['settings', 'table_text'], optional: [], families: [], priorities: ['interactive'], dimensions: ['rows'], tables: ['rows'],
  },
});
// Mirrors FAMILY_KINDS, MAX_FAMILY_MEMBERS and MAX_REQUEST_INPUTS of specs.py: a member `<prefix><k>` of kind `table` brings three buffers.
const FAMILY_BUFFERS = deepFreeze({ table: ['', '_values', '_valid'] });
const MAX_FAMILY_MEMBERS = 128, MAX_REQUEST_INPUTS = 3 * MAX_FAMILY_MEMBERS + 32;
// `method.run` jobs of one page that may wait for an answer at once: the engine runs one and keeps four waiting per priority (contract §9.4).
const MAX_RUNS_PER_PAGE = 9;
const RUN_FIELDS = ['requestKey', 'method', 'scope', 'target', 'revision', 'priority', 'settings_hash', 'inputs'];

function deepFreeze(value) {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) deepFreeze(item); Object.freeze(value); }
  return value;
}

class Rejected extends Error {
  constructor(code, field = null) { super(code); this.code = code; this.field = field; }
}
const reject = (code, field) => { throw new Rejected(code, field); };
const isCount = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
const isPlain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

const COLUMN_NAME = /^[A-Za-z][A-Za-z_]{0,63}$/;
const COLUMN_DTYPES = new Set(['u8', 'u16le', 'i32le', 'u32le', 'u64le', 'f64le']);
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

/**
 * The input names of a `method.run` request against the method's entry (contract §9.2): only its fixed names and family members, every
 * required name present, each family contiguous from 0, within its maximum and complete. The engine checks all of this again, and the
 * dtypes and ranks; here it keeps a page from naming what the method cannot take.
 */
function checkRunInputs(spec, names) {
  if (names.length > MAX_REQUEST_INPUTS) reject('INVALID_REQUEST', 'inputs');
  const fixed = new Set([...spec.required, ...spec.optional]);
  const members = spec.families.map(() => new Map());   // per family: k -> suffixes seen
  for (const name of names) {
    if (fixed.has(name)) continue;
    const found = spec.families.findIndex((family, index) => {
      if (!name.startsWith(family.prefix)) return false;
      const match = /^(0|[1-9][0-9]{0,2})(.*)$/.exec(name.slice(family.prefix.length));
      if (!match || Number(match[1]) >= family.maximum || !FAMILY_BUFFERS[family.kind].includes(match[2])) return false;
      const k = Number(match[1]), seen = members[index].get(k) ?? new Set();
      members[index].set(k, seen.add(match[2]));
      return true;
    });
    if (found < 0) reject('INVALID_REQUEST', `inputs.${name.slice(0, 64)}`);
  }
  for (const name of spec.required) if (!names.includes(name)) reject('INVALID_REQUEST', `inputs.${name}`);
  spec.families.forEach((family, index) => {
    const found = members[index], suffixes = FAMILY_BUFFERS[family.kind];
    for (let k = 0; k < found.size; k++) if (!found.has(k) || found.get(k).size !== suffixes.length) reject('INVALID_REQUEST', 'inputs');
  });
}

const isName = (value) => typeof value === 'string' && COLUMN_NAME.test(value);
/** The layout of a `method.run` result (contract §9.3): as `cleanLayout`, except that a column may be empty (length 0, a 0 in its shape)
 *  and a result may have no column at all. */
function cleanRunLayout(layout) {
  if (!isPlain(layout) || Object.keys(layout).length > 64) reject('INTERNAL', 'layout');
  const clean = {};
  for (const [name, part] of Object.entries(layout)) {
    const ok = isName(name) && isPlain(part) && COLUMN_DTYPES.has(part.dtype) && Array.isArray(part.shape) && part.shape.length >= 1 && part.shape.length <= 3
      && part.shape.every((n) => isCount(n)) && isCount(part.offset) && isCount(part.byte_length);
    if (!ok) reject('INTERNAL', 'layout');
    clean[name] = { dtype: part.dtype, shape: [...part.shape], offset: part.offset, byte_length: part.byte_length };
  }
  return clean;
}

/** The parts of a `method.run` answer a page may see, checked against the request and the method's entry; anything else is `INTERNAL`. */
function cleanRunResult(result, payload, spec) {
  if (!isPlain(result)) reject('INTERNAL', 'result');
  for (const field of ['method', 'scope', 'target', 'revision', 'settings_hash']) if (result[field] !== payload[field]) reject('INTERNAL', field);
  if (typeof result.inputs_key !== 'string' || !SHA256.test(result.inputs_key)) reject('INTERNAL', 'inputs_key');
  const { dimensions, tables, summary, provenance } = result;
  if (!isPlain(dimensions) || Object.keys(dimensions).sort().join() !== [...spec.dimensions].sort().join()
      || !Object.values(dimensions).every((n) => isCount(n))) reject('INTERNAL', 'dimensions');
  if (!isPlain(tables) || Object.keys(tables).sort().join() !== [...spec.tables].sort().join()) reject('INTERNAL', 'tables');
  const cleanTables = {};
  for (const [name, table] of Object.entries(tables)) {
    const ok = isPlain(table) && table.version === 1 && isCount(table.rows) && Array.isArray(table.columns) && table.columns.length >= 1 && table.columns.length <= 256
      && table.columns.every((column) => isPlain(column) && typeof column.name === 'string' && typeof column.unit === 'string');
    if (!ok) reject('INTERNAL', 'tables');
    cleanTables[name] = { version: 1, rows: table.rows, columns: table.columns.map((column) => ({ name: column.name, unit: column.unit })) };
  }
  if (!isPlain(summary)) reject('INTERNAL', 'summary');
  if (!isPlain(provenance)) reject('INTERNAL', 'provenance');
  const outputs = result.outputs, output = isPlain(outputs) ? outputs.result : undefined;
  const sound = isPlain(outputs) && (Object.keys(outputs).length === 0 || (Object.keys(outputs).join() === 'result' && isPlain(output)
    && typeof output.handle === 'string' && output.dtype === 'u8' && Array.isArray(output.shape) && output.shape.length === 1
    && isCount(output.byte_length, 1) && output.shape[0] === output.byte_length && typeof output.sha256 === 'string' && SHA256.test(output.sha256)));
  if (!sound) reject('INTERNAL', 'outputs');
  return { dimensions: { ...dimensions }, layout: cleanRunLayout(result.layout), tables: cleanTables, summary, provenance, output };
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
 * @param methods the method table `runMethod` checks against: the program always uses METHODS; tests pass probe methods.
 * @param engine the engine service of desktop/engine.js: `request(op, payload, binary)` returning a promise that carries
 *   `requestId`, `session()` returning the current session or null, and `restart({automatic})`.
 */
function createEngineIpc({ engine, methods = METHODS }) {
  const tokens = new Map();      // token -> {owner, session, handle, state, length, next, dtype, shape, sha256}
  const analyses = new Map();    // `${owner}/${requestKey}` -> {owner, engineRequest}
  const runs = new Map();        // the same, for `method.run`

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
    /**
     * `method.run` (contract §9.2) for this page: `{requestKey, method, scope, target, revision, priority, settings_hash, inputs}` with
     * `inputs` mapping input names to committed tokens of this page. Every field is checked against the mirror of the method table before
     * the engine sees the request. The answer carries a token for the packed result (none when every column is empty), its layout, the
     * table descriptions, dimensions, summary, `inputs_key` and provenance; `{cancelled: true}` when the job was cancelled or superseded.
     */
    async runMethod(owner, request) {
      if (!isPlain(request)) reject('INVALID_REQUEST', 'request');
      if (!Object.keys(request).every((key) => RUN_FIELDS.includes(key))) reject('INVALID_REQUEST', 'request');
      const { requestKey, method, scope, target, revision, priority, settings_hash: settingsHash, inputs } = request;
      if (typeof requestKey !== 'string' || !UUID.test(requestKey)) reject('INVALID_REQUEST', 'requestKey');
      const spec = typeof method === 'string' && Object.hasOwn(methods, method) ? methods[method] : reject('UNSUPPORTED_METHOD', 'method');
      if (scope !== spec.scope) reject('INVALID_REQUEST', 'scope');
      if (typeof target !== 'string' || !UUID.test(target)) reject('INVALID_REQUEST', 'target');
      if (!isCount(revision)) reject('INVALID_REQUEST', 'revision');
      if (typeof priority !== 'string' || !spec.priorities.includes(priority)) reject('INVALID_REQUEST', 'priority');
      if (typeof settingsHash !== 'string' || !SHA256.test(settingsHash)) reject('INVALID_REQUEST', 'settings_hash');
      if (!isPlain(inputs)) reject('INVALID_REQUEST', 'inputs');
      const names = Object.keys(inputs);
      checkRunInputs(spec, names);
      const key = `${owner}/${requestKey}`;
      if (runs.has(key) || analyses.has(key)) reject('INVALID_REQUEST', 'requestKey');
      if ([...runs.values()].filter((item) => item.owner === owner).length >= MAX_RUNS_PER_PAGE) reject('BUSY');
      const handles = {};
      for (const name of names) handles[name] = own(owner, inputs[name], { committed: true }).handle;
      const session = engine.session();
      const payload = { method, scope, target, revision, priority, settings_hash: settingsHash, inputs: handles };
      const call = engine.request('method.run', payload);
      const running = { owner, engineRequest: call.requestId, abandoned: false };
      runs.set(key, running);
      let result;
      try { result = await call; }
      finally { runs.delete(key); }
      if (result?.cancelled) return { cancelled: true };
      const outputHandles = Object.values(isPlain(result?.outputs) ? result.outputs : {}).map((output) => output?.handle).filter((handle) => typeof handle === 'string');
      if (running.abandoned) { release(outputHandles); return { cancelled: true }; }   // the page went away: nobody can read or release these results
      let clean;
      try { clean = cleanRunResult(result, payload, spec); }
      catch (error) { release(outputHandles); throw error; }
      const outputs = {};
      if (clean.output) {
        const token = randomUUID(), { handle, dtype, shape, byte_length: length, sha256 } = clean.output;
        tokens.set(token, { owner, session, handle, state: 'committed', length, next: length, dtype, shape: [...shape], sha256 });
        outputs.result = { token, dtype, shape: [...shape], byte_length: length, sha256 };
      }
      return { method, scope, target, revision, settings_hash: settingsHash, inputs_key: result.inputs_key, dimensions: clean.dimensions, outputs,
        layout: clean.layout, tables: clean.tables, summary: clean.summary, provenance: clean.provenance };
    },
    async cancel(owner, requestKey) {
      if (typeof requestKey !== 'string' || !UUID.test(requestKey)) reject('INVALID_REQUEST', 'requestKey');
      const running = analyses.get(`${owner}/${requestKey}`) ?? runs.get(`${owner}/${requestKey}`);
      if (!running) return { state: 'already_terminal' };
      return engine.request('job.cancel', { request_id: running.engineRequest });
    },
    /** A new engine session (card M8.4.7). Every token of every page belonged to the old session and is dropped; the pages upload again. */
    async restart(owner, options) {
      if (options !== undefined && (!isPlain(options) || Object.keys(options).some((key) => key !== 'automatic') || (options.automatic !== undefined && typeof options.automatic !== 'boolean'))) reject('INVALID_REQUEST', 'options');
      await engine.restart({ automatic: options?.automatic === true });
      tokens.clear();
      return { restarted: true };
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
      for (const running of [...analyses.values(), ...runs.values()]) {
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

module.exports = { createEngineIpc, ANALYSES, METHODS, FAMILY_BUFFERS, MAX_FAMILY_MEMBERS, MAX_REQUEST_INPUTS, MAX_RUNS_PER_PAGE, MAX_TOKENS_PER_PAGE, DTYPES,
  COLUMN_DTYPES };
