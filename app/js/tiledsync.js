// @ts-check
// Sending the masks of a tiled section to the engine's store in the background (card M8.4.16 step 4, contract §8.7). No DOM: tested in Node.
//
// The page owns its edits until the store has them (ARCHITECTURE §3.4 rule 4). A *round* begins a staged version on the last acknowledged
// manifest, sends every dirty tile (each copied just before it is sent, so a newer edit of a tile not sent yet goes out instead of the
// older one), sends the tables and commits. Only then are the tiles acknowledged, and only those that did not change after their copy was
// taken; a tile edited during the round stays dirty and goes out in the next one. A round that fails acknowledges nothing: the tiles stay
// dirty in the page, the staged version is dropped, and the round is tried again (after `recover`, which may restart the engine) with
// growing pauses, from the last acknowledged manifest. Rounds never overlap and never block a stroke.
//
// Card M8.4.25: the tables form two groups, the objects (four columns with the classes, which the store takes together) and the overlap
// stacks. Each group has a version, raised by `request(groups)` and by what the page finds changed at the start of a round (`changed`); a
// round sends only the groups whose version the store has not acknowledged (a table left out keeps the base's, contract §8.7), and builds
// them in slices of about SLICE_MS between which the page runs, starting again when the group changes meanwhile.

import { classRecords, stackTables } from './sectionanalysis.js';
import { LABEL_BYTES, EXCLUDE_BYTES } from './tiledmasks.js';

const ZERO_LABELS = new Uint8Array(LABEL_BYTES), ZERO_EXCLUDE = new Uint8Array(EXCLUDE_BYTES);
const tableText = new TextEncoder();

/** Limits of the stored tables (contract §8.7, card M8.4.22): objects, and bytes of the classes and overlap-stack tables. */
export const MAX_OBJECTS = 2 ** 20, MAX_CLASSES_BYTES = 4 * 2 ** 20, MAX_STACK_BYTES = 16 * 2 ** 20;
/** The groups of tables sent together (card M8.4.25); a group is sent whole or left out. @type {readonly ('objects' | 'stacks')[]} */
export const TABLE_GROUPS = Object.freeze(/** @type {const} */ (['objects', 'stacks']));
/** Longest stretch of table building between two pauses of a round, in milliseconds (one frame is 16.7 ms at 60 Hz). */
export const SLICE_MS = 8;
/** Objects handled between two looks at the clock while the object columns are built. */
const OBJECTS_PER_STEP = 4096;
/** Thrown inside a build when a group changed meanwhile, or the objects did not match their count: the round builds again. */
const REBUILD = Object.freeze({ rebuild: true });

/** The classes table as text (contract §8.7 `classes`); also what the page compares to find a class edit. @param {{id: string, name?: string, counts?: boolean}[]} classes */
export const classesText = (classes) => JSON.stringify(classRecords(classes));

/**
 * The building of the tables, in steps: it yields every OBJECTS_PER_STEP objects and returns the tables of `groups`. Throws REBUILD when the
 * objects visited do not match their count (they changed between two steps).
 * @param {any} s @param {{id: string, name?: string, counts?: boolean}[]} classes @param {Iterable<string>} groups
 */
function* tableSteps(s, classes, groups) {
  const want = new Set(groups), tables = /** @type {Partial<ReturnType<typeof maskTables>>} */ ({});
  if (want.has('objects')) {
    const index = new Map(classes.map((c, k) => [c.id, k])), n = s.objects.size;
    const ids = new Uint32Array(n), cls = new Int32Array(n), pred = new Int32Array(n), conf = new Float64Array(n);
    let k = 0;
    for (const o of s.objects.values()) {
      if (k === n) throw REBUILD;
      ids[k] = o.id; cls[k] = index.get(o.cls) ?? -1; pred[k] = index.get(o.pred) ?? -1; conf[k] = Number.isFinite(o.conf) ? o.conf : 0;
      if (++k % OBJECTS_PER_STEP === 0) yield;
    }
    if (k !== n) throw REBUILD;
    const bytes = (/** @type {ArrayBufferView} */ array) => (n ? new Uint8Array(array.buffer) : null);
    Object.assign(tables, { object_ids: bytes(ids), object_class: bytes(cls), object_predicted: bytes(pred), object_confidence: bytes(conf),
      classes: tableText.encode(classesText(classes)) });
  }
  if (want.has('stacks')) {
    const stacks = stackTables(s.stacks || [null]);
    Object.assign(tables, { stack_offsets: new Uint8Array(stacks.offsets.buffer), stack_members: stacks.total ? new Uint8Array(stacks.members.buffer) : null });
  }
  return tables;
}

/**
 * The tables stored with the masks (contract §8.7): the objects as four little-endian columns in the order of `s.objects` (id `u32`, class and
 * predicted class as indices into `classes`, -1 for none or for an identifier `classes` does not hold, confidence `f64`; all null when there is
 * no object), the classes as `utf8json`, and the overlap stacks of §4. Typed arrays are little-endian on every platform the program supports.
 * Only the tables of `groups` are built (card M8.4.25); all of them by default.
 * @param {any} s section @param {{id: string, name?: string, counts?: boolean}[]} classes @param {Iterable<string>} [groups]
 * @returns {{object_ids: Uint8Array | null, object_class: Uint8Array | null, object_predicted: Uint8Array | null, object_confidence: Uint8Array | null,
 *   classes: Uint8Array, stack_offsets: Uint8Array, stack_members: Uint8Array | null}}
 */
export function maskTables(s, classes, groups = TABLE_GROUPS) {
  const steps = tableSteps(s, classes, groups);
  for (;;) { const step = steps.next(); if (step.done) return /** @type {any} */ (step.value); }
}

/**
 * `maskTables` in slices: after about `sliceMs` of building it awaits `pause()` (the page draws and handles input meanwhile), which may throw
 * to stop the build. Builds again from the start when the objects changed in a way their count shows.
 * @param {any} s @param {{id: string, name?: string, counts?: boolean}[]} classes @param {Iterable<string>} groups
 * @param {() => Promise<unknown>} pause @param {{sliceMs?: number, now?: () => number}} [options]
 */
export async function buildMaskTables(s, classes, groups, pause, { sliceMs = SLICE_MS, now = () => performance.now() } = {}) {
  for (;;) {
    const steps = tableSteps(s, classes, [...groups]);
    let started = now();
    for (;;) {
      let step;
      try { step = steps.next(); } catch (error) { if (error !== REBUILD) throw error; break; }   // the objects changed: from the start
      if (step.done) return /** @type {ReturnType<typeof maskTables>} */ (step.value);
      if (now() - started >= sliceMs) { await pause(); started = now(); }                       // `pause` may throw: the caller decides
    }
    await pause();
  }
}

/**
 * The first limit of contract §8.7 the tables exceed, or null. Checked in the page before a round, so that a section beyond a limit is not
 * sent again and again. @param {ReturnType<typeof maskTables>} tables @returns {{field: string, limit: number} | null}
 */
export function tableLimit(tables) {
  if ((tables.object_ids?.length ?? 0) / 4 > MAX_OBJECTS) return { field: 'objects', limit: MAX_OBJECTS };
  if ((tables.classes?.length ?? 0) > MAX_CLASSES_BYTES) return { field: 'classes', limit: MAX_CLASSES_BYTES };
  for (const name of /** @type {const} */ (['stack_offsets', 'stack_members'])) if ((tables[name]?.length ?? 0) > MAX_STACK_BYTES) return { field: name, limit: MAX_STACK_BYTES };
  return null;
}

/** @typedef {'objects' | 'stacks'} TableGroup */
/**
 * @typedef {{begin: (base: string | null) => Promise<string>, put: (staged: string, layer: 'labels' | 'exclude', row: number, col: number,
 *   sha256: string, bytes: Uint8Array) => Promise<unknown>, commit: (staged: string, tables: object) => Promise<string>,
 *   discard: (staged: string) => Promise<unknown>}} MaskStoreApi `begin` returns the staged id, `commit` the new manifest's SHA-256.
 */

export class MaskSync {
  /**
   * @param {{tiles: import('./tiledmasks.js').MaskTiles, api: MaskStoreApi, tables: (groups: Set<TableGroup>, pause: () => Promise<void>) => object | Promise<object>,
   *   sha256: (bytes: Uint8Array) => Promise<string>, changed?: () => Iterable<TableGroup>, pause?: () => Promise<unknown>,
   *   recover?: (error: any) => Promise<unknown>, onState?: (state: {state: 'sending' | 'stored' | 'failed' | 'limit', manifest?: string | null, error?: any}) => void,
   *   delayMs?: number, retryMs?: number[], wait?: (ms: number) => Promise<void>}} options
   *   `tables(groups, pause)`: the tables of those groups (it may await `pause` between slices of work, which throws when a group being built
   *   changed). `changed()`: groups the page finds changed by cheap checks, asked at the start of each round. `pause`: lets the page run (a
   *   macrotask by default). `delayMs`: pause before a round, so that a burst of edits goes out together. `retryMs`: pauses after successive
   *   failures (the last repeats). A section whose tables exceed a limit (`tableLimit`) is not sent: state 'limit' (with `error.field`,
   *   `error.limit`), and no retry until the next change.
   */
  constructor({ tiles, api, tables, sha256, changed = () => [], pause = () => new Promise((resolve) => setTimeout(resolve, 0)), recover = async () => {},
    onState = () => {}, delayMs = 300, retryMs = [1000, 2000, 5000, 15000, 30000], wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
    this.tiles = tiles; this.api = api; this.tables = tables; this.sha256 = sha256; this.changed = changed; this.pause = pause; this.recover = recover;
    this.onState = onState; this.delayMs = delayMs; this.retryMs = retryMs; this.wait = wait;
    /** Version of each group of tables, and the version the store acknowledged (card M8.4.25). @type {Record<TableGroup, number>} */
    this.versions = { objects: 1, stacks: 1 };
    /** @type {Record<TableGroup, number>} */
    this.acked = { objects: 0, stacks: 0 };
    /** The last manifest the store acknowledged; null before the first. @type {string | null} */
    this.manifest = null;
    this.wanted = false;
    this.failures = 0;
    /** @type {Promise<void> | null} */
    this.running = null;
    this.stopped = false;
    /** Layers sent so far (both layers of a tile count two); tests use it to act while a round is on its way. */
    this.puts = 0;
    /** Tests only (card M8.4.35): awaited after the last tile of a round is sent and before its commit, so a test can stop the engine there
     *  without racing the round. Null in the program. @type {(() => Promise<void>) | null} */
    this.beforeCommit = null;
  }
  /**
   * Something changed: send it (soon). `groups`: the groups of tables whose content may have changed (all by default; none when only mask
   * tiles changed). Returns the promise of the running sends. @param {Iterable<TableGroup>} [groups]
   */
  request(groups = TABLE_GROUPS) {
    this.mark(groups);
    this.wanted = true;
    if (!this.running && !this.stopped) this.running = this.loop().finally(() => { this.running = null; });
    return this.running || Promise.resolve();
  }
  /** @param {Iterable<TableGroup>} groups */
  mark(groups) { for (const group of groups) if (TABLE_GROUPS.includes(group)) this.versions[group]++; }
  /** Nothing is sent any more (the section was removed). */
  stop() { this.stopped = true; }
  /** True when the store holds everything the page holds. */
  get settled() {
    return !this.running && !this.wanted && this.manifest !== null && this.tiles.dirtyPositions().length === 0
      && TABLE_GROUPS.every((group) => this.versions[group] === this.acked[group]);
  }
  async loop() {
    await this.wait(this.delayMs);
    while (this.wanted && !this.stopped) {
      this.wanted = false;
      try {
        this.onState({ state: 'sending', manifest: this.manifest });
        await this.round();
        this.failures = 0;
        this.onState({ state: 'stored', manifest: this.manifest });
      } catch (error) {
        if (this.stopped) break;
        if (/** @type {any} */ (error)?.local) { this.onState({ state: 'limit', manifest: this.manifest, error }); break; }   // waits for the next change
        this.wanted = true;
        this.onState({ state: 'failed', manifest: this.manifest, error });
        const pause = this.retryMs[Math.min(this.failures, this.retryMs.length - 1)];
        this.failures++;
        try { await this.recover(error); } catch { /* the next round shows whether the engine is back */ }
        await this.wait(pause);
      }
    }
  }
  /** The groups this round sends: those the store has not acknowledged, or all of them for the first version (no base to keep). */
  pendingGroups() {
    this.mark(this.changed());
    return TABLE_GROUPS.filter((group) => this.manifest === null || this.versions[group] !== this.acked[group]);
  }
  /**
   * The tables of `groups` as they are now, with the versions they show, or a local error (nothing is sent) when one exceeds a limit of the
   * store. A group changed while it was being built is built again. @param {TableGroup[]} groups
   */
  async checkedTables(groups) {
    for (;;) {
      const built = /** @type {Record<TableGroup, number>} */ ({ ...this.versions });
      const pause = async () => {
        await this.pause();
        if (this.stopped) throw Object.assign(new Error('STOPPED'), { code: 'STOPPED' });
        if (groups.some((group) => this.versions[group] !== built[group])) throw REBUILD;
      };
      let tables;
      try { tables = /** @type {ReturnType<typeof maskTables>} */ (groups.length ? await this.tables(new Set(groups), pause) : {}); }
      catch (error) { if (error === REBUILD) continue; throw error; }
      const over = tableLimit(tables);
      if (over) throw Object.assign(new Error('LIMIT_EXCEEDED'), { code: 'LIMIT_EXCEEDED', local: true, ...over });
      return { tables, built };
    }
  }
  async round() {
    // Built before anything is sent, only for the groups that changed, in slices (card M8.4.25): a change during the round asks for another.
    const groups = this.pendingGroups(), { tables, built } = await this.checkedTables(groups);
    const staged = await this.api.begin(this.manifest);
    try {
      const sent = /** @type {[number, number, number][]} */ ([]);
      for (const [row, col] of this.tiles.dirtyPositions()) {
        const entry = this.tiles.get(row, col);
        if (!entry?.dirty) continue;
        const edit = entry.edit;
        // Copies taken now: a stroke may change the arrays while the bytes are on their way.
        const labels = entry.labels ? new Uint8Array(entry.labels.buffer.slice(entry.labels.byteOffset, entry.labels.byteOffset + entry.labels.byteLength)) : ZERO_LABELS;
        const exclude = entry.exclude ? entry.exclude.slice() : ZERO_EXCLUDE;
        await this.api.put(staged, 'labels', row, col, await this.sha256(labels), labels);
        this.puts++;
        await this.api.put(staged, 'exclude', row, col, await this.sha256(exclude), exclude);
        this.puts++;
        sent.push([row, col, edit]);
      }
      if (this.beforeCommit) await this.beforeCommit();
      const manifest = await this.api.commit(staged, tables);
      this.manifest = manifest;
      for (const group of groups) this.acked[group] = built[group];
      this.tiles.acknowledge(sent.filter(([row, col, edit]) => this.tiles.get(row, col)?.edit === edit).map(([row, col]) => [row, col]));
    } catch (error) {
      this.api.discard(staged).catch(() => {});
      throw error;
    }
  }
}

/**
 * Reads back mask tiles that the page dropped (clean tiles beyond the cache budget, `MaskTiles.state` 'missing') from the last acknowledged
 * manifest, 16 positions per request, each position once at a time. A tile read never replaces one edited meanwhile (`MaskTiles.set`).
 */
export class MaskLoader {
  /**
   * @param {{tiles: import('./tiledmasks.js').MaskTiles, manifest: () => string | null,
   *   read: (manifest: string, layer: 'labels' | 'exclude', positions: [number, number][]) => Promise<(Uint8Array | null)[]>,
   *   onLoaded?: (positions: [number, number][]) => void, onError?: (error: any) => void}} options `read` gives each layer's bytes or null (empty)
   */
  constructor({ tiles, manifest, read, onLoaded = () => {}, onError = () => {} }) {
    this.tiles = tiles; this.manifest = manifest; this.read = read; this.onLoaded = onLoaded; this.onError = onError;
    /** @type {Map<number, Promise<void>>} */
    this.loading = new Map();
  }
  /** Load the missing tiles among `positions`; resolves when they are in the page (rejects if a read failed). @param {[number, number][]} positions */
  want(positions) {
    const missing = positions.filter(([row, col]) => this.tiles.state(row, col) === 'missing' && !this.loading.has(this.tiles.index(row, col)));
    const waits = positions.map(([row, col]) => this.loading.get(this.tiles.index(row, col))).filter(Boolean);
    for (let i = 0; i < missing.length; i += 16) {
      const batch = missing.slice(i, i + 16), job = this.load(batch);
      for (const [row, col] of batch) this.loading.set(this.tiles.index(row, col), job);
      job.catch(() => {}).finally(() => { for (const [row, col] of batch) this.loading.delete(this.tiles.index(row, col)); });
      waits.push(job);
    }
    return Promise.all(waits).then(() => undefined);
  }
  /** @param {[number, number][]} batch */
  async load(batch) {
    const manifest = this.manifest();
    if (!manifest) throw new Error('no stored version to read');
    try {
      const [labels, exclude] = await Promise.all([this.read(manifest, 'labels', batch), this.read(manifest, 'exclude', batch)]);
      batch.forEach(([row, col], k) => {
        const l = labels[k], e = exclude[k];
        this.tiles.set(row, col, l ? new Int32Array(l.buffer.slice(l.byteOffset, l.byteOffset + l.byteLength)) : null, e ? e.slice() : null, { dirty: false });
      });
      this.onLoaded(batch);
    } catch (error) { this.onError(error); throw error; }
  }
}
