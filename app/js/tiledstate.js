// @ts-check
// One tiled section's state behind the page (card M8.4.30 step 2; moved out of app.js without changing behaviour): its per-tile object
// statistics (TiledStatsRunner), its row counts and interval table (card M8.4.17), the reads of level-0 pixels and of dropped mask tiles, and
// the sends of its masks to the engine's store (MaskSync). app.js passes what these need from the page in one context object.
import { MaskLoader, MaskSync, buildMaskTables, classesText } from './tiledsync.js';
import { TiledCountsRunner, TiledRowCounts } from './tiledcounts.js';
import { TiledObjectStats, TiledStatsRunner, tilesUnder } from './tiledit.js';
import { binRowsOfSection, binsFromRowCounts } from './sectionanalysis.js';
import { features } from './imageproc.js';
import { pxPerCm } from './sectiondepth.js';
import { tileRgba } from './tiledsection.js';
import { t } from './i18n.js';
import { S, sec } from './state.js';

/**
 * @param {{TILES: any, readonly TILES_ONLY: readonly string[], toast: (text: string, ms?: number) => void, afterChange: (s: any, tables?: any) => void,
 *   analysisProject: () => any, analyze: (s: any) => void, effClassArray: (s: any) => any, renderResults: () => void, requestRender: () => void,
 *   sourceBox: (o: any) => any, sourceRoi: (s: any) => any}} ctx
 */
export function createTiledState(ctx) {
  const { toast, afterChange, analysisProject, analyze, effClassArray, renderResults, requestRender, sourceBox, sourceRoi } = ctx;
  /** Object statistics of a tiled section, per tile and from the level-0 pixels (card M8.4.16 step 3); bounding boxes also in working pixels. */
  /** RGBA level-0 pixel tiles of a tiled section, read through the engine in batches of 16. */
  async function level0Rgba(s, positions) {
    const tiled = s.tiled, out = [];
    for (let i = 0; i < positions.length; i += 16) {
      const batch = positions.slice(i, i + 16), read = await ctx.TILES.read(tiled.pyramid, 0, batch);
      if (read.error) throw new Error(t('tiles.err', { code: read.error.code, field: read.error.field || '' }));
      const bytes = new Uint8Array(read.ok.bytes.buffer || read.ok.bytes, read.ok.bytes.byteOffset || 0, read.ok.bytes.byteLength);
      let offset = 0;
      for (const tile of read.ok.tiles) { out.push(tileRgba(bytes.subarray(offset, offset + tile.byte_length), tiled.channels, tiled.bits)); offset += tile.byte_length; }
    }
    return out;
  }

  function tiledStatsRunner(s) {
    if (s._statsRunner) return s._statsRunner;
    const stats = new TiledObjectStats({ onExceeded: () => statsDropped(s) }), fetchRgba = (positions) => level0Rgba(s, positions);
    const onUpdate = (ids) => {
      const ppu = pxPerCm(s) * s.ds;                       // source pixels per centimetre
      for (const id of ids) {
        const o = s.objects.get(id);
        if (!o) continue;
        const a = stats.total(id);
        if (!a) { s.objects.delete(id); if (S.selected === id) S.selected = 0; continue; }
        const box = [Math.floor(a.x0 / s.ds), Math.floor(a.y0 / s.ds), Math.floor(a.x1 / s.ds), Math.floor(a.y1 / s.ds)];
        if (o.emb && (a.n !== o.area || String(box) !== String(o.bbox))) o.emb = null;   // V0.17: the trace changed
        o.area = a.n; o.bbox = box; o.sbox = [a.x0, a.y0, a.x1, a.y1]; o.stats = a; o.feat = features(a, ppu);
      }
      afterChange(s, ctx.TILES_ONLY);
    };
    const tilesOf = (id) => { const o = s.objects.get(id), box = sourceBox(o); return !o ? [] : box ? tilesUnder(s.maskTiles, box) : null; };
    s._statsRunner = new TiledStatsRunner({ tiles: s.maskTiles, stats, stacks: () => s.stacks, fetchRgba, onUpdate, tilesOf,
      loadMasks: (positions) => maskLoader(s).want(positions), onError: (error) => toast(error.message || String(error), 9000) });
    return s._statsRunner;
  }
  /**
   * Card M8.4.37: the statistics of the section's objects went beyond their budget and were dropped (`TiledObjectStats.exceed`). Every object loses
   * its statistics, features and boxes, which are no longer known (they would be stale after the next edit): the object panel and the objects table
   * say they are not available, the classifier does not use them, a save writes the objects without them (as objects saved before their statistics
   * were computed), and operations that need an object's box refuse. They are computed again when the section is opened again.
   */
  function statsDropped(s) {
    for (const o of s.objects.values()) { o.stats = null; o.feat = null; o.area = 0; o.bbox = null; o.sbox = null; }
    toast(t('tiles.statsLimit'), 12000);
    if (S.sections.includes(s)) afterChange(s, ctx.TILES_ONLY);
  }

  /* The interval table of a tiled section (card M8.4.17, decision F of ARCHITECTURE §3.4): the page counts each tile it holds into a row histogram
     (`tiledcounts.js`) when an edit, an undo or a redo changes it, and the table is the aggregation of the histograms under the current classes and
     settings, binned as for any section (`binsFromRowCounts`). A change of classes, predictions or settings reads no tile; a change of the analysis
     area's columns reads back the tiles the page dropped. Until every tile is counted the table is empty, never partial. */
  function tiledCounts(s) {
    if (s._counts) return s._counts;
    const tiles = s.maskTiles;
    const counts = new TiledRowCounts({ width: tiles.width, height: tiles.height, rows: tiles.rows, cols: tiles.cols }, { nonEmpty: () => {
      const out = new Set(tiles.stored);
      for (const [i, entry] of tiles.entries) if (entry.labels || entry.exclude) out.add(i);
      return out;
    } });
    const runner = new TiledCountsRunner({ tiles, counts, loadMasks: (positions) => maskLoader(s).want(positions),
      onReady: () => { if (S.sections.includes(s)) { analyze(s); if (sec() === s) { renderResults(); requestRender(); } } },
      onError: (error) => toast(t('tiles.countErr', { m: error.message || String(error) }), 9000) });
    s._counts = { counts, runner, limitShown: false };
    return s._counts;
  }
  /** The tiles at these positions changed: count them again with the next analysis. @param {any} s @param {[number, number][]} positions */
  function queueTileCounts(s, positions) { if (s?.maskTiles) tiledCounts(s).counts.markChanged(positions); }

  function analyzeTiled(s) {
    const { counts, runner } = tiledCounts(s), area = sourceRoi(s);
    s.bins = [];
    if (!(area.x1 > area.x0 && area.y1 > area.y0)) return;
    counts.setArea(area);
    if (runner.flush().length) { void runner.start(); return; }         // tiles to read back: the table appears when they are counted
    if (counts.overBudget) {
      if (!s._counts.limitShown) { s._counts.limitShown = true; toast(t('tiles.countLimit'), 12000); }
      return;
    }
    s._counts.limitShown = false;
    const rowCounts = counts.rowCounts({ effClass: effClassArray(s), nClasses: S.classes.length, stacks: s.stacks, area });
    const counted = { top: s.top, bottom: s.bottom, units: s.units, roi: { y0: area.y0, y1: area.y1 } };   // rows per cm of the source rows that were counted
    s.bins = binsFromRowCounts(s, rowCounts, analysisProject(), binRowsOfSection(counted, S.settings));
  }

  /** After a failed engine request: ask for the one automatic restart of the engine (card M8.4.7) when it is not ready. Used by the mask sends
   *  and, since card M8.4.24, by the tile reads of the viewer, which before never asked for it and failed until another part of the program did. */
  async function recoverEngine() {
    const desktopEngine = /** @type {any} */ (window).corantoolDesktop?.engine;
    if (desktopEngine && (await desktopEngine.status()).state !== 'ready') await desktopEngine.restart({ automatic: true });
  }

  /* Sending the masks of a tiled section to the engine's store (card M8.4.16 step 4): `MaskSync` sends the dirty tiles and the tables after
     each change and acknowledges them only after `mask.commit`; after a failure it keeps them and tries again, first asking for the one
     automatic restart of the engine (card M8.4.7). `MaskLoader` reads back the tiles the page dropped. */
  const hexDigest = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
  /** The project's identifier as the store accepts it (contract §8.7: lower case, never a Windows device name). */
  const storeProject = (id) => { const key = String(id || 'project').toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 60) || 'project'; return /^(con|prn|aux|nul|com\d|lpt\d)$/.test(key) ? 'p-' + key : key; };
  async function bridgeResult(promise) {
    const result = await promise;
    if (result.error) throw Object.assign(new Error(result.error.code), result.error);
    return result.ok;
  }

  function maskLoader(s) {
    if (s._maskLoader) return s._maskLoader;
    const project = storeProject(S.id);
    const read = async (manifest, layer, positions) => {
      const result = await bridgeResult(ctx.TILES.maskRead(project, manifest, layer, positions));
      const bytes = new Uint8Array(result.bytes.buffer || result.bytes, result.bytes.byteOffset || 0, result.bytes.byteLength);
      let offset = 0;
      return result.tiles.map((tile) => { const part = tile.byte_length ? bytes.subarray(offset, offset + tile.byte_length) : null; offset += tile.byte_length; return part; });
    };
    s._maskLoader = new MaskLoader({ tiles: s.maskTiles, manifest: () => s._maskSync?.manifest ?? null, read,
      onLoaded: () => { if (sec() === s) requestRender(); }, onError: (error) => toast(t('tiles.err', { code: error.code || 'MASKS', field: error.field || '' }), 9000) });
    return s._maskLoader;
  }

  function maskSync(s) {
    if (s._maskSync) return s._maskSync;
    const project = storeProject(S.id), section = s.id, { width, height } = s.maskTiles;
    const api = {
      begin: async (base) => (await bridgeResult(ctx.TILES.maskBegin(project, section, width, height, base))).staged,
      put: (staged, layer, row, col, sha256, bytes) => bridgeResult(ctx.TILES.maskPut(staged, layer, row, col, sha256, bytes)),
      commit: async (staged, tables) => (await bridgeResult(ctx.TILES.maskCommit(staged, tables))).manifest,
      discard: (staged) => bridgeResult(ctx.TILES.maskDiscard(staged)),
    };
    let failing = false, limited = false;
    const recover = recoverEngine;
    // Card M8.4.25: cheap checks for table changes that an edit marked "tiles only" may still carry (a new or removed object, a new overlap
    // stack) and for class edits, which do not always ask for a round: a group found changed is sent with the next round.
    let seen = null;
    /** @returns {('objects' | 'stacks')[]} */
    const changed = () => {
      const now = { classes: classesText(S.classes), objects: s.objects.size, nextId: s.nextId, stacks: s.stacks, stackCount: s.stacks?.length ?? 0 };
      const groups = /** @type {('objects' | 'stacks')[]} */ ([]);
      if (!seen || now.classes !== seen.classes || now.objects !== seen.objects || now.nextId !== seen.nextId) groups.push('objects');
      if (!seen || now.stacks !== seen.stacks || now.stackCount !== seen.stackCount) groups.push('stacks');
      seen = now;
      return groups;
    };
    s._maskSync = new MaskSync({ tiles: s.maskTiles, api, tables: (groups, pause) => buildMaskTables(s, S.classes, groups, pause), changed, sha256: hexDigest, recover,
      onState: ({ state, error }) => {
        if (state === 'limit' && !limited) { limited = true; toast(t('tiles.storeLimit', { field: error.field, n: error.limit }), 12000); }
        if (state === 'failed' && !failing) { failing = true; toast(t('tiles.masksUnsent'), 9000); }
        if (state === 'stored') limited = false;
        if (state === 'stored' && failing) { failing = false; toast(t('tiles.masksSent')); void s._statsRunner?.retry(); }
      } });
    return s._maskSync;
  }

  return { level0Rgba, tiledStatsRunner, tiledCounts, queueTileCounts, analyzeTiled, recoverEngine, hexDigest, storeProject, bridgeResult, maskLoader, maskSync };
}
