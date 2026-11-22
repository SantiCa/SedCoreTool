// @ts-check
// The viewer of tiled sections (card M8.4.30 step 4; moved out of app.js without changing behaviour): the working image read from the
// pyramid, the tile cache and schedulers that read pixel tiles around the view, the mask overlay drawn over them, and the dialog of a long
// build or copy. app.js passes the view, the bridge and a few page functions in one context object.
import { DEFAULT_FILTERS } from './imageproc.js';
import { TileCache, TileScheduler, coarserCover, levelForZoom, tileKey, tilePlacement, tileRange, tilesByDistance } from './tilecache.js';
import { TILE, assembleLevel, levelPositions, tileRgba } from './tiledsection.js';
import { overlayLayout, paintOverlay } from './tiledmasks.js';
import { windowRange } from './tiledit.js';
import { bandPositions, cropRows, windowTop, workingBand } from './tiledrecord.js';
import { t } from './i18n.js';
import { $, S, sec } from './state.js';

/** @param {any} ctx the view, the bridge and the page functions the viewer uses (see the call in app.js) */
export function createTiledView(ctx) {
  const { toast, requestRender, esc, maskLoader, recoverEngine } = ctx;
  /** The working image of a tiled section: its proxy level of the pyramid, read through the engine in batches of 16 verified tiles. Card M8.4.42:
   *  with a window, only the tile rows under it are read and the window's rows are cut from them (`workingBand`). */
  async function tiledWorkingImage(tiled) {
    const level = tiled.levels[tiled.level], band = workingBand(level, tiled.level, tiled.window), positions = band ? bandPositions(band) : levelPositions(level), tiles = [];
    const firstRow = band ? band.row0 : 0;
    for (let i = 0; i < positions.length; i += 16) {
      const batch = positions.slice(i, i + 16), read = await ctx.TILES.read(tiled.pyramid, tiled.level, batch);
      if (read.error) throw new Error(t('tiles.err', { code: read.error.code }));
      const bytes = new Uint8Array(read.ok.bytes.buffer || read.ok.bytes, read.ok.bytes.byteOffset || 0, read.ok.bytes.byteLength);
      let offset = 0;
      read.ok.tiles.forEach((tile, k) => { tiles.push({ row: batch[k][0] - firstRow, col: batch[k][1], bytes: bytes.subarray(offset, offset + tile.byte_length) }); offset += tile.byte_length; });
    }
    if (!band) return assembleLevel(tiles, level, tiled.channels, tiled.bits);
    return cropRows(assembleLevel(tiles, band.level, tiled.channels, tiled.bits), band.cropY, band.height);
  }

  /* The viewer's full-resolution tiles (card M8.4.15 step 4): one page cache with one budget, one scheduler per pyramid. A tile becomes an
     ImageBitmap (16-bit shown by its high byte, as the working image); evicted bitmaps are closed. */
  const tileCache = new TileCache();
  const tileSchedulers = new Map();

  /**
   * The scheduler of a section's pyramid. Card M8.4.39: it keeps only what the pyramid fixes (identifier, channels, bits) and finds the section
   * it draws for when tiles arrive, so a section opened again (a new object over the same pyramid) is repainted as its tiles load.
   * @returns {TileScheduler}
   */
  function tileScheduler(s) {
    const { pyramid, channels, bits } = s.tiled;
    let scheduler = tileSchedulers.get(pyramid);
    if (scheduler) return scheduler;
    const shown = () => sec()?.tiled?.pyramid === pyramid;
    const liveTiled = () => (shown() ? sec().tiled : S.cores.flatMap((c) => c.sections).find((q) => q.tiled?.pyramid === pyramid)?.tiled ?? null);
    const fetch = async (k, positions) => {
      const read = await ctx.TILES.read(pyramid, k, positions);
      if (read.error) throw new Error(t('tiles.err', { code: read.error.code, field: read.error.field || '' }));
      const bytes = new Uint8Array(read.ok.bytes.buffer || read.ok.bytes, read.ok.bytes.byteOffset || 0, read.ok.bytes.byteLength);
      const out = [];
      let offset = 0;
      for (let i = 0; i < read.ok.tiles.length; i++) {
        const length = read.ok.tiles[i].byte_length, rgba = tileRgba(bytes.subarray(offset, offset + length), channels, bits);
        offset += length;
        out.push({ row: positions[i][0], col: positions[i][1], value: await createImageBitmap(new ImageData(rgba, TILE, TILE)), bytes: rgba.byteLength });
      }
      return out;
    };
    scheduler = new TileScheduler({ fetch, cache: tileCache, prefix: pyramid + '/',
      onLoaded: () => { if (shown()) requestRender(); },
      onRetry: () => { if (shown()) requestRender(); },     // the view asks again for the tiles it still wants
      onError: (error) => {
        const tiled = liveTiled();
        if (tiled) {
          tiled.lastError = error.message || String(error);
          if (!tiled.errorShown) { tiled.errorShown = true; toast(tiled.lastError, 9000); }
        }
        void recoverEngine().catch(() => {});                // the retry then reads from the restarted engine
      } });
    tileSchedulers.set(pyramid, scheduler);
    return scheduler;
  }

  /** Card M8.4.39: the project is closed: no scheduler asks for more tiles, and the cached tiles are dropped (their bitmaps closed). */
  function resetTiles() {
    for (const scheduler of tileSchedulers.values()) scheduler.want(0, []);
    tileSchedulers.clear();
    for (const bitmap of tileCache.clear()) bitmap?.close?.();
  }

  /** Tiles show the source's pixels: drawn only while the working image under them shows them too (no filter). Masks are drawn over them. */
  function tilesShowSource(s) {
    return S.showOrig || !Object.keys(DEFAULT_FILTERS).some((key) => s.filters[key] !== DEFAULT_FILTERS[key]);
  }

  /* The masks of a tiled section over its pixel tiles (card M8.4.16 step 2): one RGBA layer (`overlayLayout`, `paintOverlay`) drawn over them. */
  const maskLayer = { canvas: /** @type {HTMLCanvasElement | null} */ (null), data: /** @type {ImageData | null} */ (null) };

  function drawMaskOverlay(s, k, rect, viewWidth, viewHeight) {
    if (k === 0 && s.maskTiles.stored.size) {
      const range = windowRange(s.maskTiles, { x0: rect.x0 * s.ds, y0: rect.y0 * s.ds, x1: rect.x1 * s.ds, y1: rect.y1 * s.ds }, 1), missing = [];
      for (let row = range.row0; row <= range.row1; row++) for (let col = range.col0; col <= range.col1; col++) if (s.maskTiles.state(row, col) === 'missing') missing.push([row, col]);
      if (missing.length && ctx.TILES) void maskLoader(s).want(missing).catch(() => {});   // drawn as empty until they arrive
    }
    const layout = overlayLayout(s, S.view, k, rect, viewWidth, viewHeight);
    if (!layout) return;
    const { sx0, sy0, cw, ch } = layout, canvas = maskLayer.canvas ||= document.createElement('canvas');
    if (canvas.width < cw || canvas.height < ch) { canvas.width = Math.max(cw, canvas.width); canvas.height = Math.max(ch, canvas.height); }
    const context = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    if (maskLayer.data?.width !== cw || maskLayer.data.height !== ch) maskLayer.data = context.createImageData(cw, ch);
    const inSel = new Uint8Array(s.nextId + 1); for (const id of S.multi) if (id <= s.nextId) inSel[id] = 1;
    paintOverlay({ ...layout, out: maskLayer.data.data, px0: sx0, py0: sy0, style: { fill: s.lutFill, line: s.lutLine, sty: s.lutStyle, stacks: s.stacks, selected: S.selected, inSel } });
    context.putImageData(maskLayer.data, 0, 0);
    ctx.vctx.drawImage(canvas, 0, 0, cw, ch, sx0, sy0, cw, ch);
  }

  /**
   * Draw the full-resolution tiles of a tiled section over its working image, inside the analysis area, when the zoom needs a level finer than
   * the working image. A tile not loaded yet is drawn from the nearest finer-than-working level already cached, else the working image shows.
   */
  function drawTiles(s, cw, ch) {
    if (s.tiled.missing) return;                               // card M8.4.18a: no pyramid and no source; the grey working image stays
    const tiled = s.tiled, levels = tiled.levels, { x: vx, y: vy, zoom: z } = S.view, ds = s.ds, roi = s.roi, scheduler = tileScheduler(s);
    const k = levelForZoom(levels, z / ds);
    if (k >= tiled.level || !tilesShowSource(s)) { scheduler.want(k, []); return; }
    const x0 = Math.max(vx, roi.x0), y0 = Math.max(vy, roi.y0), x1 = Math.min(vx + cw / z, roi.x1), y1 = Math.min(vy + ch / z, roi.y1);
    if (x1 <= x0 || y1 <= y0) { scheduler.want(k, []); return; }
    // Card M8.4.42: tiles are chosen and placed in the pyramid's rows, the section's rows shifted by its window (the clip stays in the section's)
    const oy = windowTop(tiled), rect = { x0: x0 * ds, y0: y0 * ds + oy, x1: x1 * ds, y1: y1 * ds + oy }, visible = tileRange(levels, k, rect, 0), prefix = tiled.pyramid + '/';
    const protect = new Set();
    for (let row = visible.row0; row <= visible.row1; row++) for (let col = visible.col0; col <= visible.col1; col++) protect.add(prefix + tileKey(k, row, col));
    scheduler.want(k, tilesByDistance(tileRange(levels, k, rect, 1), { x: (rect.x0 + rect.x1) / 2, y: (rect.y0 + rect.y1) / 2 }), protect);
    const placement = { vx, vy: vy + oy / ds, zoom: z, workingLevel: tiled.level };
    ctx.vctx.save();
    ctx.vctx.beginPath(); ctx.vctx.rect((x0 - vx) * z, (y0 - vy) * z, (x1 - x0) * z, (y1 - y0) * z); ctx.vctx.clip();
    ctx.vctx.imageSmoothingEnabled = false;                    // nearest pixel, as the working image is drawn
    for (let row = visible.row0; row <= visible.row1; row++) {
      for (let col = visible.col0; col <= visible.col1; col++) {
        const at = tilePlacement(levels, k, row, col, placement);
        const dx = Math.round(at.dx), dy = Math.round(at.dy), dw = Math.round(at.dx + at.dw) - dx, dh = Math.round(at.dy + at.dh) - dy;   // no seams
        const bitmap = tileCache.get(prefix + tileKey(k, row, col));
        if (bitmap) { ctx.vctx.drawImage(bitmap, 0, 0, at.w, at.h, dx, dy, dw, dh); continue; }
        const cover = coarserCover(levels, k, row, col, (key) => tileCache.has(prefix + key));
        if (cover && cover.k < tiled.level) ctx.vctx.drawImage(tileCache.get(prefix + cover.key), cover.sx, cover.sy, cover.sw * at.w / TILE, cover.sh * at.h / TILE, dx, dy, dw, dh);
      }
    }
    drawMaskOverlay(s, k, { x0, y0, x1, y1 }, cw, ch);
    ctx.vctx.restore();
  }

  /** A small modal with the pyramid's progress and a Cancel button. */
  function tileBuildDialog(name, onCancel, title = t('tiles.building', { n: name })) {
    const dlg = document.createElement('dialog');
    dlg.innerHTML = `<div style="display:grid;gap:10px;min-width:340px"><h3 style="margin:0">${esc(title)}</h3>
      <progress id="tbProgress" max="1" value="0" style="width:100%"></progress><span class="note" id="tbStage"></span>
      <div class="row" style="justify-content:flex-end"><button class="btn" id="tbCancel">${esc(t('cl.cancel'))}</button></div></div>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); onCancel(); });
    dlg.querySelector('#tbCancel').addEventListener('click', () => { /** @type {HTMLButtonElement} */ (dlg.querySelector('#tbCancel')).disabled = true; onCancel(); });
    dlg.showModal();
    return {
      update({ stage, completed, total }) {
        const bar = /** @type {HTMLProgressElement} */ (dlg.querySelector('#tbProgress'));
        bar.value = total ? completed / total : 0;
        dlg.querySelector('#tbStage').textContent = t('tiles.stage.' + stage);
      },
      close() { dlg.close(); dlg.remove(); },
    };
  }

  return { tiledWorkingImage, tileCache, tileSchedulers, tileScheduler, resetTiles, tilesShowSource, drawTiles, tileBuildDialog };
}
