// Main-process-only client. Renderer code cannot choose commands, paths or arbitrary engine operations.
const { spawn } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { controlFrame, frame, ControlReader } = require('./engine-protocol');

// Methods the engine may advertise in its handshake; anything else makes the engine unavailable.
const ADVERTISED_METHODS = new Set(['buffer.digest/1', 'section.intervals/1']);
// The tile-store operations (contract §8) are main-process only: engine-ipc.js never forwards them, and `pyramid.build` carries a path.
const OPERATIONS = new Set(['hello', 'buffer.begin', 'buffer.derive', 'buffer.chunk', 'buffer.commit', 'buffer.release', 'buffer.read', 'buffer.digest', 'section.analyze', 'job.cancel', 'shutdown',
  'pyramid.build', 'pyramid.info', 'tile.read', 'mask.begin', 'mask.put', 'mask.commit', 'mask.discard', 'mask.read', 'mask.retain', 'mask.info']);
// Requests followed by one binary frame (a descriptor/binary pair of contract §3); at most two of them wait for an answer at a time.
const WITH_BINARY = new Set(['buffer.chunk', 'mask.put']);
// A pyramid build has no fixed length: the engine stops a build whose progress stalls for 60 s. The client fails the session only
// when nothing at all (no progress event, no answer) arrives for this long.
const PYRAMID_IDLE_TIMEOUT_MS = 90 * 1000;
const PROGRESS_STAGES = new Set(['hash', 'level0', 'levels']);
const PYRAMID_BUDGET_BYTES = 50 * 2 ** 30;   // contract §8.4; the maintainer's default of 16 November 2026
// The engine ends every analysis within its own 120 s deadline; up to four more wait in its queue. This is only the backstop
// against a coordinator that stops answering, and it ends the whole session (see `request`).
const ANALYSIS_TIMEOUT_MS = 10 * 60 * 1000;

const MAX_AUTOMATIC_RESTARTS = 1;
// Card M8.4.26 (decided by the maintainer, 18 Nov 2026): the handshake has its own deadline. Starting Python took up to 4.7 s on a
// computer with every core busy (once more than the 5 s of an ordinary request), which made the engine unavailable and used the one
// automatic restart; idle it takes about 0.1 s.
const START_TIMEOUT_MS = 20 * 1000;

function unavailable() { return Object.assign(new Error('ENGINE_UNAVAILABLE'), { code: 'ENGINE_UNAVAILABLE' }); }

async function cleanupScratch(scratch) {
  const absolute = path.resolve(scratch);
  if (path.dirname(absolute) === path.resolve(os.tmpdir()) && /^sedcoretool-engine-[a-zA-Z0-9]+$/.test(path.basename(absolute))) {
    try { await fs.promises.rm(absolute, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
    catch { /* A failed cleanup must not resurrect a failed session. */ }
  }
}

function terminateTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null || !Number.isInteger(child.pid)) return;
  if (process.platform === 'win32') {
    // Ending the coordinator is immediate (about 2 ms) and the coordinator's Job Object (engine/lifetime.py) kills its
    // workers with it. taskkill /T alone takes about 1.7 s to start, so it only backs up a coordinator that could not
    // join the job; by then the coordinator is usually gone and it finds nothing to do.
    child.kill();
    const killer = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.on('error', () => {});
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  }
}

class EngineClient {
  constructor({ executable, script, version, runtimeId, timeoutMs = 5000, startTimeoutMs = START_TIMEOUT_MS, captureDiagnostics = false, pyramidDirectory = null, pyramidBudgetBytes = PYRAMID_BUDGET_BYTES,
    projectsDirectory = null }) {
    if (!path.isAbsolute(executable || '') || !path.isAbsolute(script || '') || !/^[0-9a-f]{64}$/.test(runtimeId || '')) throw unavailable();
    if (pyramidDirectory !== null && !path.isAbsolute(pyramidDirectory)) throw unavailable();
    if (projectsDirectory !== null && !path.isAbsolute(projectsDirectory)) throw unavailable();
    this.options = { executable, script, version, runtimeId, timeoutMs, startTimeoutMs, captureDiagnostics, pyramidDirectory, pyramidBudgetBytes, projectsDirectory };
    this.child = null; this.state = 'stopped'; this.pending = new Map(); this.queue = []; this.writing = false;
    this.stderr = Buffer.alloc(0); this.handshake = null; this.session = null; this.partial = null;
  }
  status() { return { state: this.state, protocol: this.handshake?.protocol || null, methods: this.handshake?.methods || [] }; }
  async start() {
    if (this.state === 'ready') return this.handshake;
    if (this.state === 'starting') return this.starting;
    if (this.child) { terminateTree(this.child); await this.exited; }
    this.state = 'starting'; this.session = randomUUID(); this.stderr = Buffer.alloc(0); this.handshake = null;
    const { executable, script, version, runtimeId, pyramidDirectory, pyramidBudgetBytes, projectsDirectory } = this.options;
    const storeArguments = [...(pyramidDirectory ? ['--pyramid-dir', pyramidDirectory, '--pyramid-budget-bytes', String(pyramidBudgetBytes)] : []),
      ...(projectsDirectory ? ['--projects-dir', projectsDirectory] : [])];
    let scratch;
    try { scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sedcoretool-engine-')); }
    catch { this.state = 'unavailable'; throw unavailable(); }
    this.scratchDirectory = scratch;
    const env = { ...process.env }; delete env.PYTHONPATH; delete env.PYTHONHOME;
    for (const variable of ['LD_LIBRARY_PATH', 'LD_PRELOAD', 'DYLD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES']) delete env[variable];
    let child;
    try {
      child = spawn(executable, ['-I', '-B', '-u', script, '--version', version, '--runtime-id', runtimeId, '--scratch-dir', scratch, ...storeArguments], {
        env, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch { this.state = 'unavailable'; await cleanupScratch(scratch); throw unavailable(); }
    this.child = child;
    this.exited = new Promise((resolve) => child.once('close', async () => {
      await cleanupScratch(scratch);
      resolve();
    }));
    const reader = new ControlReader((value) => this.receive(value), (bytes) => this.receiveBinary(bytes));
    child.stdout.on('data', (bytes) => { if (child !== this.child) return; try { reader.push(bytes); } catch { this.fail(child); } });
    child.stdout.on('end', () => { try { reader.end(); } catch { this.fail(child); } });
    child.stderr.on('data', (bytes) => {
      if (this.options.captureDiagnostics && child === this.child) this.stderr = Buffer.concat([this.stderr, bytes]).subarray(-65536);
    });
    child.on('error', () => this.fail(child)); child.stdin.on('error', () => this.fail(child));
    child.on('close', () => {
      if (child !== this.child) return;
      if (this.state !== 'stopping') this.fail(child);
      else this.state = 'stopped';
      this.rejectPending();
      this.child = null;
    });
    this.starting = this.request('hello', { protocol: 1 }, null, { timeoutMs: this.options.startTimeoutMs }).then((result) => {
      if (result.protocol !== 1 || result.engine_version !== version || result.runtime_id !== runtimeId || !Array.isArray(result.methods) || result.methods.some((method) => !ADVERTISED_METHODS.has(method))) throw unavailable();
      this.handshake = result; this.state = 'ready'; return result;
    }).catch((error) => { this.fail(child); throw error; });
    return this.starting;
  }
  /** `onEvent(payload)` receives the progress events of a `pyramid.build`; each event also restarts its idle timeout. */
  request(op, payload, binary = null, { timeoutMs = op === 'section.analyze' ? ANALYSIS_TIMEOUT_MS : op === 'pyramid.build' ? PYRAMID_IDLE_TIMEOUT_MS : this.options.timeoutMs, onEvent = null } = {}) {
    if (!OPERATIONS.has(op) || !this.child || !['starting', 'ready', 'stopping'].includes(this.state)) return Promise.reject(unavailable());
    if (this.pending.size >= 32) return Promise.reject(Object.assign(new Error('BUSY'), { code: 'BUSY' }));
    if (WITH_BINARY.has(op) && [...this.pending.values()].filter((item) => WITH_BINARY.has(item.op)).length >= 2) return Promise.reject(Object.assign(new Error('BUSY'), { code: 'BUSY' }));
    const id = randomUUID(), request = { v: 1, kind: 'request', session: this.session, id, op, payload };
    let parts;
    try {
      parts = controlFrame(request);
      if (WITH_BINARY.has(op)) parts.push(...frame(2, binary));
      else if (binary !== null) throw unavailable();
    } catch { return Promise.reject(Object.assign(new Error('INVALID_REQUEST'), { code: 'INVALID_REQUEST' })); }
    const promise = new Promise((resolve, reject) => {
      const child = this.child;
      const timer = setTimeout(() => this.fail(child), timeoutMs);
      this.pending.set(id, { resolve, reject, timer, op, payload, onEvent, timeoutMs, child });
    });
    // Expose only to trusted callers so they can send cancellation for an in-flight diagnostic.
    promise.requestId = id;
    const item = { id, parts };
    if (op === 'job.cancel') {
      const target = this.queue.findIndex((queued) => queued.id === payload.request_id);
      this.queue.splice(target + 1, 0, item);
    } else if (op === 'shutdown') this.queue.unshift(item);
    else this.queue.push(item);
    void this.flush();
    return promise;
  }
  async flush() {
    if (this.writing) return;
    this.writing = true;
    const child = this.child;
    try {
      while (this.queue.length && child === this.child) {
        const { parts } = this.queue.shift();
        for (const part of parts) await new Promise((resolve, reject) => child.stdin.write(part, (error) => error ? reject(error) : resolve()));
      }
    } catch { this.fail(child); }
    finally { this.writing = false; if (this.queue.length && this.child) void this.flush(); }
  }
  receive(value) {
    const pending = this.pending.get(value?.id);
    if (value?.kind === 'event') return this.receiveEvent(value, pending);
    if (!value || value.v !== 1 || value.kind !== 'response' || value.session !== this.session || !pending || value.op !== pending.op) throw unavailable();
    const fields = ['v', 'kind', 'session', 'id', 'op', 'status', ...(value.status === 'ok' ? ['result'] : value.status === 'error' ? ['error'] : [])];
    if (Object.keys(value).sort().join() !== fields.sort().join() || !['ok', 'error', 'cancelled'].includes(value.status)) throw unavailable();
    if (value.status === 'error' && (!value.error || !['INVALID_REQUEST', 'UNSUPPORTED_METHOD', 'UNSUPPORTED_INPUT', 'INVALID_BUFFER', 'LIMIT_EXCEEDED', 'BUSY', 'INTERNAL'].includes(value.error.code))) throw unavailable();
    if (value.status === 'ok' && pending.op === 'buffer.read') {
      // The result is followed by exactly one binary frame holding the bytes; the request completes when it arrives.
      const read = value.result, asked = pending.payload;
      if (!read || Object.keys(read).sort().join() !== 'byte_length,offset' || read.offset !== asked.offset || read.byte_length !== asked.byte_length) throw unavailable();
      this.partial = { pending, id: value.id, result: read };
      return { binaryBytes: read.byte_length };
    }
    if (value.status === 'ok' && pending.op === 'tile.read') {
      // The result is followed by the announced binary frames: the tiles' bytes, concatenated, cut at 1 MiB (contract §8.5).
      const read = value.result, asked = pending.payload, tiles = read?.tiles, frames = read?.frames;
      if (!read || Object.keys(read).sort().join() !== 'frames,tiles' || !Array.isArray(tiles) || tiles.length !== asked.positions.length
          || tiles.some((tile, index) => !tile || Object.keys(tile).sort().join() !== 'byte_length,col,row,sha256' || tile.row !== asked.positions[index][0]
            || tile.col !== asked.positions[index][1] || !Number.isSafeInteger(tile.byte_length) || tile.byte_length < 1 || !/^[0-9a-f]{64}$/.test(tile.sha256))
          || !Array.isArray(frames) || frames.reduce((sum, size) => sum + size, 0) !== tiles.reduce((sum, tile) => sum + tile.byte_length, 0)) throw unavailable();
      this.partial = { pending, id: value.id, result: read, parts: [], remaining: frames.length };
      return { binaryFrames: frames };
    }
    if (value.status === 'ok' && pending.op === 'mask.read') {
      // As tile.read, except that an empty layer has sha256 null and no bytes (contract §8.7); with no bytes at all no frame follows.
      const read = value.result, asked = pending.payload, tiles = read?.tiles, frames = read?.frames;
      if (!read || Object.keys(read).sort().join() !== 'frames,tiles' || !Array.isArray(tiles) || tiles.length !== asked.positions.length
          || tiles.some((tile, index) => !tile || Object.keys(tile).sort().join() !== 'byte_length,col,row,sha256' || tile.row !== asked.positions[index][0]
            || tile.col !== asked.positions[index][1] || !(tile.sha256 === null ? tile.byte_length === 0 : /^[0-9a-f]{64}$/.test(tile.sha256)
              && (tile.byte_length === 1048576 || tile.byte_length === 262144)))
          || !Array.isArray(frames) || frames.reduce((sum, size) => sum + size, 0) !== tiles.reduce((sum, tile) => sum + tile.byte_length, 0)) throw unavailable();
      if (frames.length) {
        this.partial = { pending, id: value.id, result: read, parts: [], remaining: frames.length };
        return { binaryFrames: frames };
      }
      clearTimeout(pending.timer); this.pending.delete(value.id);
      pending.resolve({ ...read, bytes: Buffer.alloc(0) });
      return undefined;
    }
    clearTimeout(pending.timer); this.pending.delete(value.id);
    if (value.status === 'ok') pending.resolve(value.result);
    else if (value.status === 'cancelled') pending.resolve({ cancelled: true });
    else {
      const field = value.error.details?.field;
      pending.reject(Object.assign(new Error(value.error.code), { code: value.error.code, ...(typeof field === 'string' ? { field } : {}) }));
    }
    return undefined;
  }
  receiveBinary(bytes) {
    const partial = this.partial;
    if (!partial) throw unavailable();
    if (partial.parts) {
      partial.parts.push(bytes);
      if (--partial.remaining) return;
      const joined = Buffer.concat(partial.parts);
      let offset = 0;
      for (const tile of partial.result.tiles) {          // the engine verified every tile; this checks the transport kept them apart
        if (!tile.byte_length) continue;                   // an empty mask layer (mask.read) has no bytes
        if (createHash('sha256').update(joined.subarray(offset, offset + tile.byte_length)).digest('hex') !== tile.sha256) throw unavailable();
        offset += tile.byte_length;
      }
      bytes = joined;
    }
    this.partial = null;
    clearTimeout(partial.pending.timer); this.pending.delete(partial.id);
    partial.pending.resolve({ ...partial.result, bytes });
  }
  /** A progress event of a running `pyramid.build` (contract §8.4); anything else invalidates the session. */
  receiveEvent(value, pending) {
    const payload = value.payload;
    if (value.v !== 1 || value.session !== this.session || !pending || pending.op !== 'pyramid.build' || value.op !== pending.op
        || Object.keys(value).sort().join() !== 'id,kind,op,payload,session,v' || !payload || Object.keys(payload).sort().join() !== 'completed,stage,total'
        || !PROGRESS_STAGES.has(payload.stage) || !Number.isSafeInteger(payload.completed) || !Number.isSafeInteger(payload.total)
        || payload.completed < 0 || payload.total < 0) throw unavailable();
    clearTimeout(pending.timer);
    pending.timer = setTimeout(() => this.fail(pending.child), pending.timeoutMs);
    try { pending.onEvent?.({ stage: payload.stage, completed: payload.completed, total: payload.total }); } catch { /* a listener error is not the engine's */ }
    return undefined;
  }
  fail(child) {
    if (!child || child !== this.child) return;
    this.state = 'unavailable'; this.handshake = null;
    this.rejectPending(); terminateTree(child);
  }
  rejectPending() {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(unavailable()); }
    this.pending.clear(); this.queue.length = 0; this.partial = null;
  }
  async stop() {
    if (!this.child) { this.state = 'stopped'; return; }
    if (this.state === 'ready') {
      this.state = 'stopping';
      try { await this.request('shutdown', {}, null, { timeoutMs: 1500 }); } catch { /* Failure still reaps the process tree. */ }
    }
    const child = this.child;
    let timer;
    try {
      timer = setTimeout(() => terminateTree(child), 1500);
      await this.exited;
    } finally { clearTimeout(timer); this.state = 'stopped'; }
  }
}

/** `cacheFile` (optional path or function returning one) holds the record of the last full runtime verification. */
function createEngineService({ enabled, packaged, executable, sourceDirectory, runtimeDirectory, lockPath, version, cacheFile = null, pyramidDirectory = null,
  projectsDirectory = null }) {
  let client, runtime = null, state = enabled ? 'stopped' : 'disabled', stopped = false;
  /** The restart that is running, if any: a second request while it runs waits for the same one. */
  let restarting = null;
  /** Restarts the interface asked for by itself (not by the user's Retry); at most MAX_AUTOMATIC_RESTARTS per program session. */
  let automaticRestarts = 0;
  const service = {
    status: () => ({ enabled, runtime, ...(client ? client.status() : { state, protocol: null, methods: [] }) }),
    /**
     * A new engine session: the old process tree is ended, a new coordinator starts and shakes hands. Every buffer handle of the old
     * session is invalid afterwards (engine-ipc.js drops the tokens). An automatic restart is refused with `LIMIT_EXCEEDED` after
     * the first one. A restart never happens once the program is closing. Resolves when the engine is `ready`, otherwise rejects
     * `ENGINE_UNAVAILABLE`; it never starts anything else.
     */
    restart: ({ automatic = false } = {}) => {
      if (!enabled || stopped) return Promise.reject(unavailable());
      if (restarting) return restarting;
      if (automatic && automaticRestarts >= MAX_AUTOMATIC_RESTARTS) return Promise.reject(Object.assign(new Error('LIMIT_EXCEEDED'), { code: 'LIMIT_EXCEEDED', field: 'automatic' }));
      if (automatic) automaticRestarts++;
      restarting = (async () => {
        const old = client;
        client = null; state = 'starting';
        if (old) await old.stop();
        if (stopped) throw unavailable();   // the program started closing while the old engine was ending: start nothing
        await service.start();
        if (!client || client.state !== 'ready') throw unavailable();
        return { restarted: true };
      })().finally(() => { restarting = null; });
      return restarting;
    },
    automaticRestarts: () => automaticRestarts,
    start: async () => {
      if (!enabled) return;
      stopped = false;
      state = 'starting';
      try {
        let options;
        if (!packaged && path.isAbsolute(executable || '')) {
          options = { executable, script: path.join(sourceDirectory, 'src', 'sedcoretool', 'engine', 'server.py'),
            runtimeId: require('node:crypto').createHash('sha256').update('unverified-development-runtime').digest('hex'), runtime: 'unverified-development' };
        } else {
          options = await require('./engine-runtime').loadRuntime({ runtimeDirectory, sourceDirectory: path.join(sourceDirectory, 'src'), lockPath, version,
            cacheFile: typeof cacheFile === 'function' ? cacheFile() : cacheFile });
        }
        if (stopped) return;
        runtime = options.runtime;
        const folder = (value) => (typeof value === 'function' ? value() : value);
        client = new EngineClient({ ...options, version, pyramidDirectory: folder(pyramidDirectory), projectsDirectory: folder(projectsDirectory) });
        await client.start();
      } catch { if (client) await client.stop(); client = null; state = stopped ? 'stopped' : 'unavailable'; }
    },
    stop: async () => { stopped = true; state = 'stopped'; if (client) await client.stop(); },
    // For engine-ipc.js, which validates everything a page sends. `request` keeps its allowlist of operations.
    request: (op, payload, binary = null, options = undefined) => (client && client.state === 'ready' ? client.request(op, payload, binary, options) : Promise.reject(unavailable())),
    session: () => (client && client.state === 'ready' ? client.session : null),
  };
  return service;
}

module.exports = { EngineClient, terminateTree, createEngineService, ADVERTISED_METHODS };
