// @ts-check
// Sending the masks of a tiled section to the engine's store in the background (card M8.4.16 step 4, contract §8.7). No DOM: tested in Node.
//
// The page owns its edits until the store has them (ARCHITECTURE §3.4 rule 4). A *round* begins a staged version on the last acknowledged
// manifest, sends every dirty tile (each copied just before it is sent, so a newer edit of a tile not sent yet goes out instead of the
// older one), sends the tables and commits. Only then are the tiles acknowledged, and only those that did not change after their copy was
// taken; a tile edited during the round stays dirty and goes out in the next one. A round that fails acknowledges nothing: the tiles stay
// dirty in the page, the staged version is dropped, and the round is tried again (after `recover`, which may restart the engine) with
// growing pauses, from the last acknowledged manifest. Rounds never overlap and never block a stroke.

import { objectRecords, classRecords, stackTables } from './sectionanalysis.js';
import { LABEL_BYTES, EXCLUDE_BYTES } from './tiledmasks.js';

const ZERO_LABELS = new Uint8Array(LABEL_BYTES), ZERO_EXCLUDE = new Uint8Array(EXCLUDE_BYTES);
const tableText = new TextEncoder();

/**
 * The tables stored with the masks (contract §8.7): the objects, classes and overlap-stack tables of §4 as bytes.
 * @param {any} s section @param {{id: string, name?: string, counts?: boolean}[]} classes
 * @returns {{objects: Uint8Array, classes: Uint8Array, stack_offsets: Uint8Array, stack_members: Uint8Array | null}}
 */
export function maskTables(s, classes) {
  const stacks = stackTables(s.stacks || [null]);
  return { objects: tableText.encode(JSON.stringify(objectRecords(s))), classes: tableText.encode(JSON.stringify(classRecords(classes))),
    stack_offsets: new Uint8Array(stacks.offsets.buffer), stack_members: stacks.total ? new Uint8Array(stacks.members.buffer) : null };
}

/**
 * @typedef {{begin: (base: string | null) => Promise<string>, put: (staged: string, layer: 'labels' | 'exclude', row: number, col: number,
 *   sha256: string, bytes: Uint8Array) => Promise<unknown>, commit: (staged: string, tables: object) => Promise<string>,
 *   discard: (staged: string) => Promise<unknown>}} MaskStoreApi `begin` returns the staged id, `commit` the new manifest's SHA-256.
 */

export class MaskSync {
  /**
   * @param {{tiles: import('./tiledmasks.js').MaskTiles, api: MaskStoreApi, tables: () => object, sha256: (bytes: Uint8Array) => Promise<string>,
   *   recover?: (error: any) => Promise<unknown>, onState?: (state: {state: 'sending' | 'stored' | 'failed', manifest?: string | null, error?: any}) => void,
   *   delayMs?: number, retryMs?: number[], wait?: (ms: number) => Promise<void>}} options
   *   `delayMs`: pause before a round, so that a burst of edits goes out together. `retryMs`: pauses after successive failures (the last repeats).
   */
  constructor({ tiles, api, tables, sha256, recover = async () => {}, onState = () => {}, delayMs = 300, retryMs = [1000, 2000, 5000, 15000, 30000],
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
    this.tiles = tiles; this.api = api; this.tables = tables; this.sha256 = sha256; this.recover = recover; this.onState = onState;
    this.delayMs = delayMs; this.retryMs = retryMs; this.wait = wait;
    /** The last manifest the store acknowledged; null before the first. @type {string | null} */
    this.manifest = null;
    this.wanted = false;
    this.failures = 0;
    /** @type {Promise<void> | null} */
    this.running = null;
    this.stopped = false;
    /** Layers sent so far (both layers of a tile count two); tests use it to act while a round is on its way. */
    this.puts = 0;
  }
  /** Something changed: send it (soon). Returns the promise of the running sends. */
  request() {
    this.wanted = true;
    if (!this.running && !this.stopped) this.running = this.loop().finally(() => { this.running = null; });
    return this.running || Promise.resolve();
  }
  /** Nothing is sent any more (the section was removed). */
  stop() { this.stopped = true; }
  /** True when the store holds everything the page holds. */
  get settled() { return !this.running && !this.wanted && this.manifest !== null && this.tiles.dirtyPositions().length === 0; }
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
        this.wanted = true;
        this.onState({ state: 'failed', manifest: this.manifest, error });
        const pause = this.retryMs[Math.min(this.failures, this.retryMs.length - 1)];
        this.failures++;
        try { await this.recover(error); } catch { /* the next round shows whether the engine is back */ }
        await this.wait(pause);
      }
    }
  }
  async round() {
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
      const manifest = await this.api.commit(staged, this.tables());
      this.manifest = manifest;
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
