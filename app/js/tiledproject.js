// @ts-check
// The project side of tiled sections (card M8.4.30 step 1; moved out of app.js without changing behaviour): reopening a saved tiled section,
// the lock of a section whose stored version is missing, the store folder that follows its project (delete, copy), and the store's part of a
// save (settle every section, then keep only the saved versions). app.js passes what these need from the page in one context object.
import { MaskTiles, reduceTile } from './tiledmasks.js';
import { tileHistogram } from './tiledcounts.js';
import { TiledObjectStats } from './tiledit.js';
import { CacheRejected, decodeReopenCache, encodeReopenCache, statsCover } from './tiledcache.js';
import { backupTiledSections, restoreVersion, restoreSource, packageTiledSections, keptSourceBytes } from './tiledbackup.js';
import { recordFitsPyramid, validTiledRecord } from './tiledrecord.js';
import { features } from './imageproc.js';
import { pxPerCm } from './sectiondepth.js';
import { t } from './i18n.js';
import { APP, S } from './state.js';

/**
 * @param {{TILES: any, readonly settleDeadlineMs: number, toast: (text: string, ms?: number) => void, storeProject: (id: string) => string,
 *   maskSync: (s: any) => any, maskLoader: (s: any) => any, newSection: (options: any) => any, sectionFields: (q: any) => any,
 *   greyRgba: (w: number, h: number) => Uint8ClampedArray, sourceRoi: (s: any) => any, tileBuildDialog: (name: string, onCancel: () => void, title?: string) => any,
 *   tiledCounts: (s: any) => any, tiledStatsRunner: (s: any) => any, tiledWorkingImage: (tiled: any) => Promise<any>, serTiledSection: (s: any, manifest: string) => any,
 *   hexDigest: (bytes: Uint8Array) => Promise<string>}} ctx
 */
export function createTiledProject(ctx) {
  const { toast, storeProject, maskSync, maskLoader, newSection, sectionFields, greyRgba, sourceRoi, tileBuildDialog, tiledCounts, tiledStatsRunner,
    tiledWorkingImage, serTiledSection, hexDigest } = ctx;

  /**
   * A saved tiled section (card M8.4.18a): its pyramid from the engine's cache or built again from the remembered source (a grey image and no edits when
   * neither is there), its masks from the stored version, and the three things derived from the stored tiles: the reduced copy, the row histograms and the
   * statistics of its objects. Card M8.4.29: they come from the reopening cache saved with the version when it passes its checks (`tiledcache.js`); otherwise
   * every stored tile is read back once for the first two and the statistics are computed again in the background (saved ones are shown meanwhile).
   */
  async function loadTiledSection(q) {
    const rec = q.tiled, project = storeProject(S.id);
    if (!validTiledRecord(rec)) throw new Error(t('load.badMask', { s: q.name || '?', k: 'tiled' }));
    const key = crypto.randomUUID(), dialog = tileBuildDialog(q.file.name, () => { void ctx.TILES.cancel(key); });
    const stop = ctx.TILES.onProgress((k, progress) => { if (k === key) dialog.update(progress); });
    try {
      const opened = await ctx.TILES.reopen(project, rec.source.sha256, key);
      if (opened.error) throw new Error(t('tiles.err', { code: opened.error.code, field: opened.error.field || '' }));
      let /** @type {any} */ tiled, working;
      const window = rec.window ? { window: { y0: rec.window.y0, y1: rec.window.y1 } } : {};   // card M8.4.42: the rows of the stored image it covers
      if (opened.ok.available) {
        const info = (await ctx.TILES.info(rec.source.sha256)).ok;
        if (!info || !recordFitsPyramid(rec, info)) throw new Error(t('load.badMask', { s: q.name || '?', k: 'tiled' }));
        tiled = { pyramid: rec.source.sha256, level: rec.level, levels: info.levels, channels: info.channels, bits: info.bits, source: { name: rec.source.name, size: rec.source.size }, ...window };
        working = await tiledWorkingImage(tiled);
      } else {
        tiled = { pyramid: rec.source.sha256, level: rec.level, levels: null, channels: 3, bits: 8, source: { name: rec.source.name, size: rec.source.size }, missing: true, ...window };
        working = { w: q.w, h: q.h, rgba: greyRgba(q.w, q.h), rgba16: null };
      }
      const s = newSection({ name: q.name, file: { name: q.file.name, type: q.file.type, tiled: true }, w: working.w, h: working.h, orig: working.rgba,
        orig16: working.rgba16, ds: q.ds || 1, full: q.full || { w: rec.width, h: rec.height } });
      Object.assign(s, sectionFields(q));
      s.tiled = tiled;
      s.maskTiles = new MaskTiles({ width: rec.width, height: rec.height });
      s.stacks = Array.isArray(q.stacks) ? q.stacks : [null]; s._six = null;
      if (tiled.missing) s.frozen = 'source';
      const ppu = pxPerCm(s) * s.ds;
      for (const o of q.objects || []) {
        const st = o.st || null, order = s.nextTraceOrder++;
        s.objects.set(o.id, { id: o.id, order, cls: o.cls, src: o.src, nt: !!o.nt, pred: null, conf: 0, area: st?.n || 0, bbox: st ? [Math.floor(st.x0 / s.ds), Math.floor(st.y0 / s.ds), Math.floor(st.x1 / s.ds), Math.floor(st.y1 / s.ds)] : null,
          sbox: st ? [st.x0, st.y0, st.x1, st.y1] : null, stats: st, feat: st ? features(st, ppu) : null, ...(o.th ? { _thumb: o.th } : {}), ...(o.em ? { emb: o.em } : {}) });
      }
      // The tiles of the stored version, then every one read back once: the reduced copy for the overview and the row counts (card M8.4.17).
      // Card M8.4.27: a stored version that is missing or damaged locks the section (no masks, no table, record saved back as read).
      const positions = /** @type {[number, number][]} */ ([]);
      let cache = null;
      try {
      for (let start = 0; start !== null;) {
        const page = await ctx.TILES.maskInfo(project, rec.manifest, start);
        if (page.error) throw Object.assign(new Error(t('tiles.err', { code: page.error.code, field: page.error.field || '' })), page.error);
        if (page.ok.section !== q.id || page.ok.width !== rec.width || page.ok.height !== rec.height) throw new Error(t('load.badMask', { s: q.name || '?', k: 'tiled' }));
        for (let k = 0; k < page.ok.positions.length; k += 3) { const [row, col] = page.ok.positions.slice(k, k + 2); positions.push([row, col]); s.maskTiles.stored.add(s.maskTiles.index(row, col)); }
        start = page.ok.next;
      }
      maskSync(s).manifest = rec.manifest;
      s._savedRecord = q;
      const { counts } = tiledCounts(s), area = sourceRoi(s);
      cache = await readReopenCache(s, rec, project);
      let todo = positions;
      if (cache) {                                                    // card M8.4.29: nothing read from the tiles, except those of changed analysis columns
        s.labels.set(cache.labels); s.exclude.set(cache.exclude);
        counts.restore(cache.columns, cache.hists);
        counts.setArea(area);
        todo = positions.filter(([row, col]) => counts.needed.has(s.maskTiles.index(row, col)));
        if (!tiled.missing) for (const [tile, perTile] of cache.stats) tiledStatsRunner(s).stats.replaceTile(tile, perTile);
        s._reopenCached = rec.manifest;
      } else counts.setArea(area);
      for (let i = 0; i < todo.length; i += 16) {
        dialog.update({ stage: 'masks', completed: i, total: todo.length });
        const batch = todo.slice(i, i + 16);
        await maskLoader(s).want(batch);
        for (const [row, col] of batch) {
          const entry = s.maskTiles.get(row, col);
          if (!cache) reduceTile(s, s.ds, row, col, entry?.labels || null, entry?.exclude || null);
          counts.commit(s.maskTiles.index(row, col), tileHistogram(entry, row, col, rec.width, rec.height, area.x0, area.x1));
        }
      }
      } catch (error) {
        if (!['INVALID_REQUEST', 'INVALID_BUFFER'].includes(/** @type {any} */ (error)?.code)) throw error;
        return storeLocked(s, q);
      }
      if (!cache && !tiled.missing && positions.length) void tiledStatsRunner(s).queue(positions);   // only the tiles: an object without pixels is kept, as saved
      return s;
    } finally { stop(); dialog.close(); }
  }

  /**
   * Card M8.4.29: the reopening cache of a stored version, decoded and checked against the section being opened and against the objects of its record;
   * null when there is none, or it is refused (the reason goes to the console and everything is rebuilt from the tiles, as without a cache). Nothing of
   * the section is changed here.
   */
  async function readReopenCache(s, rec, project) {
    if (!ctx.TILES.derivedGet || s.labels?.length !== s.w * s.h) return null;
    try {
      const got = await ctx.TILES.derivedGet(project, rec.manifest, 'reopen');
      if (got.error) throw Object.assign(new Error(got.error.code), got.error);
      if (!got.ok.found) return null;
      const b = got.ok.bytes, bytes = b instanceof Uint8Array ? b : new Uint8Array(b.buffer || b, b.byteOffset || 0, b.byteLength);
      const cache = await decodeReopenCache(bytes, { manifest: rec.manifest, source: rec.source.sha256, ds: s.ds, width: rec.width, height: rec.height,
        working: { w: s.w, h: s.h }, stored: s.maskTiles.stored }, hexDigest);
      const totals = new TiledObjectStats();
      for (const [tile, perTile] of cache.stats) totals.replaceTile(tile, perTile);
      for (const id of totals.tilesOf.keys()) {                       // the statistics must be the ones the record was saved with
        const o = s.objects.get(id), a = totals.total(id);
        if (o && (!o.stats || !a || o.stats.n !== a.n || o.stats.x0 !== a.x0 || o.stats.x1 !== a.x1 || o.stats.y0 !== a.y0 || o.stats.y1 !== a.y1)) throw new CacheRejected('objects');
      }
      // Card M8.4.39: and every object saved with pixels must have them in the cache (otherwise its statistics would never be computed again)
      for (const [id, o] of s.objects) if (o.stats?.n > 0 && !totals.tilesOf.has(id)) throw new CacheRejected('objects');
      return cache;
    } catch (error) {
      console.warn('reopening cache not used:', error?.reason || error?.code || error);
      return null;
    }
  }

  /**
   * Card M8.4.29: after a save, the reopening cache of each tiled section's saved version, unless this session has already read or written it. It is
   * written only while the page still holds exactly that version (the send is settled on the saved manifest, every tile counted, no statistic waiting),
   * checked again after the encoding; a failure is logged and the next save tries again, because the cache only saves time.
   */
  async function writeReopenCaches() {
    if (!ctx.TILES?.derivedPut) return;
    for (const q of S.cores.flatMap((c) => c.sections)) {
      const rec = q._savedRecord?.tiled, manifest = rec?.manifest;
      if (!manifest || !q.tiled || q.frozen || !q.maskTiles || q._reopenCached === manifest || q._reopenWriting || q.labels?.length !== q.w * q.h) continue;
      const holds = () => !!q._maskSync?.settled && q._maskSync.manifest === manifest && !!q._statsRunner?.idle && !q._statsRunner.failed.size && !!q._counts?.counts.ready
        && q._savedRecord?.tiled?.manifest === manifest;
      if (!holds()) continue;
      q._reopenWriting = true;
      try {
        const snapshot = q._counts.counts.snapshot();
        // Objects saved without statistics, or statistics dropped beyond their budget (card M8.4.37): rebuilt at the next opening, which computes them
        if (!snapshot || q._statsRunner.stats.exceeded || !statsCover(snapshot.hists, q._statsRunner.stats.byTile)) continue;
        const bytes = await encodeReopenCache({ manifest, source: rec.source.sha256, ds: q.ds, width: rec.width, height: rec.height, working: q,
          columns: snapshot.columns, hists: snapshot.hists, stats: q._statsRunner.stats.byTile }, hexDigest);
        if (!holds()) continue;                                       // edited while the cache was being made: the next save writes it
        const result = await ctx.TILES.derivedPut(storeProject(S.id), manifest, 'reopen', bytes);
        if (result.error) console.warn('reopening cache not saved:', result.error);
        else q._reopenCached = manifest;
      } catch (error) {
        console.warn('reopening cache not saved:', error?.name === 'CacheTooLarge' ? 'it would exceed the limit' : error);
      } finally { q._reopenWriting = false; }
    }
  }

  /**
   * Card M8.4.18c: the masks of the tiled sections of `json` (the project as the folder backup writes it) into its backup folder `dir`. Without the
   * engine they cannot be read, and the sections are left out as before (cards M8.4.18d and M8.4.33). Returns the sections left out.
   */
  async function backupTiledOf(dir, id, json) {
    if (ctx.TILES?.maskExport) return backupTiledSections(ctx.TILES, dir, storeProject(id), json, hexDigest, (name, size) => toast(t('bk.sourceCopy', { n: name, s: sizeText(size) }), 12000));
    const leftOut = (json.cores || [json]).flatMap((c) => (Array.isArray(c.sections) ? c.sections.filter((q) => q.tiled).map((q) => ({ core: c.name ?? null, section: q.name ?? q.id })) : []));
    for (const c of json.cores || [json]) if (Array.isArray(c.sections)) c.sections = c.sections.filter((q) => !q.tiled);
    if (leftOut.length) json.left_out = [...(json.left_out || []), ...leftOut];
    return leftOut;
  }

  /**
   * Card M8.4.18c: at a restore, the stored versions of the project's tiled sections from the backup folder (`readFile` reads one of its files by
   * relative path; null for a file restored on its own) into the store of the project's (final) identifier, unless the store has them already. A
   * section whose version cannot be restored keeps its record and opens locked (card M8.4.27); the user is told which file was missing or damaged.
   */
  async function restoreTiledOf(p, readFile) {
    const tiled = (p.cores || [p]).flatMap((c) => (Array.isArray(c.sections) ? c.sections : [])).filter((q) => q.tiled?.manifest);
    if (!tiled.length) return;
    if (!ctx.TILES?.maskImport) { toast(t('bk.tiledNeedsEngine', { p: p.name || APP, n: tiled.length }), 12000); return; }
    const project = storeProject(p.id);
    for (const q of tiled) {
      if (!(await ctx.TILES.maskInfo(project, q.tiled.manifest, 0)).error) continue;            // already in this computer's store
      const failed = readFile ? await restoreVersion(ctx.TILES, project, q.tiled.manifest, readFile) : 'manifest';
      if (failed) toast(t('bk.tiledRefused', { s: q.name || '?', p: p.name || APP, w: failed }), 15000);
    }
    // Step 3: a copy of each source the folder holds goes into the project, so the section opens with its image on this computer too.
    const sources = new Map(tiled.filter((q) => q.tiled.source?.sha256).map((q) => [q.tiled.source.sha256, q.tiled.source.name || '']));
    if (!readFile || !ctx.TILES.sourceImportBegin) return;
    for (const [pyramid, name] of sources) {
      const outcome = await restoreSource(ctx.TILES, project, pyramid, name, readFile).catch((error) => { console.warn('source copy not restored', error); return 'failed'; });
      if (outcome === 'damaged' || outcome === 'failed') toast(t('bk.sourceDamaged', { n: name || pyramid.slice(0, 12) }), 12000);
    }
  }
  /**
   * Card M8.4.18d (D4): how a package carries the tiled sections of `list` (projects as saved). Null when it cannot (no engine) or need not (no tiled
   * section): they are then left out as before. Otherwise asks once whether to include the copies of sources the projects keep (with their total
   * size), and returns `(json, id, prefix) => {files, leftOut}` for `projectForExport`'s output of each project.
   */
  async function packageTiledPlan(list) {
    const tiledOf = (d) => (d.cores || []).flatMap((c) => c.sections || []).filter((q) => q.tiled?.manifest);
    if (!ctx.TILES?.maskExport || !list.some((d) => tiledOf(d).length)) return null;
    const pairs = list.flatMap((d) => [...new Set(tiledOf(d).map((q) => q.tiled.source?.sha256).filter(Boolean))].map((pyramid) => [storeProject(d.id), pyramid]));
    const bytes = ctx.TILES.sourceCopyRead ? await keptSourceBytes(ctx.TILES, pairs) : 0;
    const withSources = bytes > 0 && confirm(t('pkg.withSources', { s: sizeText(bytes) }));
    return (json, id, prefix) => packageTiledSections(ctx.TILES, storeProject(id), json, prefix, hexDigest, withSources);
  }
  /** A size in bytes as the user reads it (MB below 1 GB). @param {number} bytes */
  const sizeText = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`);

  /** Card M8.4.34: tell the main process which stores belong to the projects of the library listing (it deletes only those, after asking when the page did not open them). Returns the list unchanged. */
  function announceStoreProjects(list) {
    if (ctx.TILES?.announceProjects && Array.isArray(list)) void ctx.TILES.announceProjects(list.map((m) => storeProject(m.id)).slice(0, 8192)).catch(() => {});
    return list;
  }

  /** Card M8.4.27: the store folder of a deleted project goes too, once the sends of its sections that were open have stopped. */
  async function deleteStoreOf(id, sections) {
    if (!ctx.TILES) return;
    for (const q of sections) q._maskSync?.stop();
    // A round already on its way finishes (a stopped send starts no other) and closes its staged version; after many edits it can take more
    // than the few seconds allowed before (seen on 20 Nov 2026: the folder stayed), so up to 60 s.
    await Promise.race([Promise.all(sections.map((q) => q._maskSync?.running?.catch(() => {}))), new Promise((r) => setTimeout(r, 60000))]);
    let error = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await ctx.TILES.deleteProjectStore(storeProject(id));
      if (!result.error) return;
      error = result.error;
      if (result.error.code !== 'BUSY') break;
      await new Promise((r) => setTimeout(r, 1000));                   // a version still being sent: the engine closes it shortly
    }
    toast(t('tiles.deleteFailed') + ` (${error?.code || '?'}${error?.field ? ' ' + error.field : ''})`, 9000);   // the reason, for a report
  }
  /** Card M8.4.27: before a project is kept under a new identifier, its tiled sections' stored versions and sources are copied to it; throws
   *  (and nothing is kept) when that is not possible. */
  async function copyTiledStore(record, to) {
    const tiled = (record.cores || []).flatMap((c) => c.sections || []).filter((q) => q.tiled?.manifest);
    if (!tiled.length) return;
    if (!ctx.TILES) throw new Error(t('tiles.copyNeedsEngine'));
    const key = crypto.randomUUID(), dialog = tileBuildDialog('', () => { void ctx.TILES.cancel(key); }, t('tiles.copyingProject', { n: record.name || APP }));
    const stop = ctx.TILES.onProgress((k, progress) => { if (k === key) dialog.update(progress); });
    try {
      const result = await ctx.TILES.copyProjectStore(storeProject(record.id), storeProject(to), tiled.map((q) => q.tiled.manifest), tiled.map((q) => q.tiled.source.sha256), key);
      if (result.error) throw new Error(t('tiles.err', { code: result.error.code, field: result.error.field || '' }));
      if (result.ok.cancelled) throw new Error(t('tiles.cancelled'));
    } finally { stop(); dialog.close(); }
  }

  /** Card M8.4.27: the section without its masks, locked; its saved record is what a save writes, and the store keeps everything (`retainStore`). */
  function storeLocked(s, q) {
    s._maskSync?.stop(); s._maskSync = null; s._maskLoader = null; s._counts = null;
    s.maskTiles = new MaskTiles({ width: q.tiled.width, height: q.tiled.height });
    s.labels?.fill(0); s.exclude?.fill(0);                   // the reduced copy of tiles read before the failure
    s.frozen = 'store'; s._savedRecord = q; s.bins = [];
    toast(t('tiles.storeMissing', { s: q.name || '?' }), 12000);
    return s;
  }

  /*
   * Card M8.4.18a, D1: before a save, every tiled section's store must hold all of its edits. The record is built in the same moment the sync is found
   * settled, so masks, objects and stacks are one state. A section that does not settle within the deadline keeps its last saved record and the save
   * of everything else goes on; the project stays "unsaved" and the next save tries again. Returns how many sections did not settle.
   */
  async function settleTiledSections(deadlineMs = ctx.settleDeadlineMs) {
    const sections = S.cores.flatMap((c) => c.sections).filter((q) => q.tiled && q.maskTiles && !q.frozen);
    let unsaved = 0;
    await Promise.all(sections.map(async (q) => {
      const sync = maskSync(q), until = performance.now() + deadlineMs;
      q._tiledRecord = null;
      if (!sync.settled) void sync.request([]);
      for (;;) {
        if (sync.settled) { q._tiledRecord = serTiledSection(q, sync.manifest); return; }
        if (performance.now() > until || sync.stopped) { unsaved++; return; }   // card M8.4.39: stopped (project closed meanwhile): it never settles
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }));
    for (const q of S.cores.flatMap((c) => c.sections)) if (q.frozen === 'source' || q.frozen === 'store') q._tiledRecord = q._savedRecord;   // locked: saved back as it was read
    return unsaved;
  }
  /**
   * Card M8.4.39: a section leaves the page (deleted, or its project closed): its mask sends, statistics and row counts stop. Nothing is lost: a project
   * is closed only after a save that settled every send (`canLeaveProject`), or deleted on purpose; statistics and counts are derived from the masks
   * and computed again at the next opening.
   */
  function stopTiledWork(q) {
    q._maskSync?.stop();
    q._statsRunner?.stop();
    q._counts?.runner.cancel();
  }
  /** After a save that wrote the records `settleTiledSections` made: they are the saved versions now, in every core. Card M8.4.39: not only when the
   *  core on screen has sections (a save made from an empty core left the others' saved versions behind, and the store kept the old ones). */
  function markTiledSaved() {
    for (const q of S.cores.flatMap((c) => c.sections)) if (q.tiled && q._tiledRecord) q._savedRecord = q._tiledRecord;
  }
  /** After a save: the store keeps only the versions the saved records name and the current ones (rule 4: the last good save stays until a newer one). */
  async function retainStore() {
    if (!ctx.TILES) return;
    const sections = S.cores.flatMap((c) => c.sections).filter((q) => q.tiled && q.maskTiles);
    if (!sections.length || sections.some((q) => q.frozen === 'store')) return;   // card M8.4.27: nothing is deleted while a stored version is missing
    const keep = new Set();
    for (const q of sections) {
      if (q._savedRecord?.tiled?.manifest) keep.add(q._savedRecord.tiled.manifest);
      if (q._maskSync?.manifest) keep.add(q._maskSync.manifest);
    }
    const result = await ctx.TILES.maskRetain(storeProject(S.id), [...keep]).catch((error) => ({ error }));
    if (result?.error) console.warn('retain', result.error);
    await writeReopenCaches();                                           // after the clean-up, so that it never removes a cache that was just written
  }

  return { loadTiledSection, readReopenCache, deleteStoreOf, copyTiledStore, storeLocked, settleTiledSections, markTiledSaved, stopTiledWork, retainStore, announceStoreProjects, backupTiledOf, restoreTiledOf,
    packageTiledPlan };
}
