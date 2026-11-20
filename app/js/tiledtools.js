// @ts-check
// Editing tiled sections (card M8.4.30 step 3; moved out of app.js without changing behaviour): brush, erase and exclusion strokes on edit
// windows, undo and redo of tiled edits, and the wand, lasso, scissors and object operations, with the wait for objects' statistics of card
// M8.4.28. app.js passes what these need from the page (its editing primitives, the drag in progress, the view) in one context object.
import { EditWindow, WINDOW_TILES, affectedTiles, pinRanges, planWindows, tilesUnder, toWindowRect, windowRange, windowRgba } from './tiledit.js';
import { TILE } from './tiledsection.js';
import { TileChanges, trimTileHistory } from './tiledundo.js';
import { hasId, renameId, topAt } from './core.js';
import { polygonPixels, regionGrow } from './imageproc.js';
import { reduceTile } from './tiledmasks.js';
import { sameTaxonGroups, splitPieces, trimEditHistory } from './edit.js';
import { t } from './i18n.js';
import { $, S, sec } from './state.js';

/** @param {any} ctx the page's editing primitives and shared state (see the call in app.js) */
export function createTiledTools(ctx) {
  const { toast, afterChange, beginOp, level0Rgba, linePixels, maskLoader, newObject, paintAt, paintPixels, paintSeg, pixelTarget, queueTileCounts,
    rebuildLUT, rememberTrace, removeTrace, requestRender, select, setLabel, six, subPx, tiledStatsRunner, updateHistoryButtons, sourceBox, sourceRoi } = ctx;
  const NO_PIXEL_LOG = /** @type {any} */ ({ push() { return 0; }, length: 0 });
  const canvasSize = () => { const c = /** @type {HTMLCanvasElement} */ (ctx.view); return { w: c.width, h: c.height }; };
  let editWindow = null;                                   // one window for the page (up to 120 MiB), kept while it stays current

  function tiledEditWindow(s, rect, ring) {
    const range = windowRange(s.maskTiles, rect, ring);
    if (range.count > WINDOW_TILES) { toast(t('tiles.zoomIn')); return null; }
    const missing = [];
    for (let row = range.row0; row <= range.row1; row++) for (let col = range.col0; col <= range.col1; col++) if (s.maskTiles.state(row, col) === 'missing') missing.push([row, col]);
    if (missing.length) { void maskLoader(s).want(missing).catch(() => {}); toast(t('tiles.loadingMasks')); return null; }
    if (!editWindow?.matches(s.maskTiles, range)) {
      editWindow?.release();
      editWindow = null;
      try { editWindow = new EditWindow(s.maskTiles, range); } catch (error) { toast(t('tiles.err', { code: 'MASKS', field: error.message })); return null; }
    }
    return editWindow;
  }

  /** The section with the window's masks in place of its own: today's editing code writes through it (the stack index stays the section's). */
  function windowSection(s, win) {
    const shared = (key) => ({ get: () => s[key], set: (value) => { s[key] = value; } });
    return Object.create(s, { labels: { value: win.labels }, exclude: { value: win.exclude }, w: { value: win.w }, h: { value: win.h },
      _six: shared('_six'), nextId: shared('nextId'), nextTraceOrder: shared('nextTraceOrder') });
  }

  /** The visible part of a tiled section in source pixels (half-open), or null. */
  function visibleSource(s) {
    const ds = s.ds, { x: vx, y: vy, zoom: z } = S.view;
    const r = { x0: Math.max(0, vx) * ds, y0: Math.max(0, vy) * ds, x1: Math.min(s.w, vx + canvasSize().w / z) * ds, y1: Math.min(s.h, vy + canvasSize().h / z) * ds };
    return r.x1 > r.x0 && r.y1 > r.y0 ? r : null;
  }

  function startTiledStroke(s, p, e, tool) {
    const ds = s.ds, radius = S.brushSize * ds, visible = visibleSource(s);
    if (!visible) return;
    const win = tiledEditWindow(s, visible, Math.max(1, Math.ceil(radius / TILE)));
    if (!win) return;
    const op = beginOp(s); op.mode = tool; op.lm = NO_PIXEL_LOG; op.ex = NO_PIXEL_LOG; op.win = win; op.section = s; op.radius = radius;
    op.tiles = new TileChanges(s.maskTiles);
    const at = { x: p.x * ds - win.ox, y: p.y * ds - win.oy };
    if (tool === 'brush') {
      const under = topAt(win.labelAt(p.x * ds, p.y * ds) ?? 0, s.stacks);
      op.target = e.shiftKey && S.selected ? S.selected : ((!S.overlap || s.objects.get(under)?.cls === S.active) && under) || newObject(op, S.active, 'brush').id;
      rebuildLUT(s);
    }
    if (tool === 'erase' && e.shiftKey && S.selected) op.only = S.selected;
    op.s = windowSection(s, win);
    paintAt(op, at.x, at.y, radius);
    tiledWriteBack(op, at, at);
    ctx.drag = { type: 'tpaint', op, last: at };
  }

  function moveTiledStroke(p) {
    const op = ctx.drag.op, at = { x: p.x * op.section.ds - op.win.ox, y: p.y * op.section.ds - op.win.oy };
    paintSeg(op, ctx.drag.last, at, op.radius);
    tiledWriteBack(op, ctx.drag.last, at);
    ctx.drag.last = at;
  }

  /** Copy what a stroke segment from a to b (window pixels) may have written back into the tiles and the reduced masks. */
  function tiledWriteBack(op, a, b) {
    const s = op.section, r = op.radius + 1, capture = (row, col) => op.tiles.capture(row, col);
    for (const [row, col] of op.win.writeBack({ x0: Math.min(a.x, b.x) - r, y0: Math.min(a.y, b.y) - r, x1: Math.max(a.x, b.x) + r, y1: Math.max(a.y, b.y) + r }, capture)) {
      const entry = s.maskTiles.get(row, col);
      reduceTile(s, s.ds, row, col, entry?.labels || null, entry?.exclude || null);
    }
    s._mv = (s._mv || 0) + 1;
    requestRender();
  }

  /** The exclusion rectangle on a tiled section: the source pixels covered by working pixels x0..x1, y0..y1 (inclusive). */
  function tiledExcludeRect(s, r, mode) {
    const ds = s.ds, rect = { x0: r.x0 * ds, y0: r.y0 * ds, x1: Math.min((r.x1 + 1) * ds, s.maskTiles.width), y1: Math.min((r.y1 + 1) * ds, s.maskTiles.height) };
    const win = tiledEditWindow(s, rect, 0);
    if (!win) { requestRender(); return; }
    const value = mode === 'exclude' ? 1 : 0;
    for (let y = rect.y0 - win.oy; y < rect.y1 - win.oy; y++) win.exclude.fill(value, y * win.w + rect.x0 - win.ox, y * win.w + rect.x1 - win.ox);
    const op = beginOp(s); op.section = s; op.win = win; op.radius = 0; op.tiles = new TileChanges(s.maskTiles);
    tiledWriteBack(op, { x: rect.x0 - win.ox, y: rect.y0 - win.oy }, { x: rect.x1 - 1 - win.ox, y: rect.y1 - 1 - win.oy });
    commitTiledOp(op);
    afterChange(s, ctx.TILES_ONLY);
  }

  function finishTiledStroke(op) {
    const s = op.section, e = op.ext;
    if (op.replaced && !ctx.ovHint) { ctx.ovHint = true; toast(t('ov.hint')); }
    if (op.target) op.touched.add(op.target);
    if (op.mode === 'brush' || op.mode === 'erase') {
      const changed = e.x1 >= e.x0 ? affectedTiles(s.maskTiles, { x0: e.x0 + op.win.ox, y0: e.y0 + op.win.oy, x1: e.x1 + op.win.ox, y1: e.y1 + op.win.oy }) : [];
      void tiledStatsRunner(s).queue(changed, op.touched);
      prioritiseObjects(s, op.touched);
    }
    commitTiledOp(op);
    afterChange(s, ctx.TILES_ONLY);
  }

  /* Undo and redo of tiled edits (card M8.4.16 step 5, decision C): a step keeps the tiles the edit changed as they were before it
     (`TileChanges`), and undo or redo swaps them with the page's tiles; the copies of all steps share UNDO_TILE_BYTES, beyond which the oldest
     steps are dropped. The objects' records are kept as for other edits (`objs`); their statistics are recomputed from the swapped tiles. */
  function commitTiledOp(op) {
    const s = op.section, step = { s, group: '', lm: [], ex: [], objs: op.objs, nextId: op.nextId, sel: op.sel, tiles: op.tiles.seal() };
    queueTileCounts(s, op.tiles.positions());
    for (const id of op.touched) rememberTrace(step, id);
    for (const [id, previous] of step.objs) if (!previous && !s.objects.has(id)) step.objs.delete(id);
    if (step.tiles.empty && !step.objs.size) return;
    S.redo.length = 0;
    S.undo.push(step);
    trimEditHistory(S.undo);
    if (trimTileHistory(S.undo) && !s._undoTrimShown) { s._undoTrimShown = true; toast(t('tiles.undoTrimmed'), 9000); }
    updateHistoryButtons();
  }

  function swapTiledStep(op) {
    const s = op.s, around = new Map();
    for (const [row, col] of op.tiles.swap()) {
      const entry = s.maskTiles.get(row, col);
      reduceTile(s, s.ds, row, col, entry?.labels || null, entry?.exclude || null);
      for (const [r, c] of affectedTiles(s.maskTiles, { x0: col * TILE, y0: row * TILE, x1: (col + 1) * TILE - 1, y1: (row + 1) * TILE - 1 })) around.set(r * s.maskTiles.cols + c, [r, c]);
    }
    void tiledStatsRunner(s).queue([...around.values()], op.objs.keys());
    queueTileCounts(s, op.tiles.positions());
  }

  /* Wand, lasso, scissors and object operations on a tiled section (card M8.4.16 step 6, decisions A-B): today's code runs on edit windows, one
     per object box (`o.sbox`), the lasso's box or the visible area for the wand, seen through `windowSection`; what it wrote is copied back into
     the tiles (copied first for undo) and the statistics of the tiles around it are recomputed. Every window of an operation is checked before
     anything is written: a box of more than WINDOW_TILES tiles refuses, tiles the page dropped are read back first, and an operation that reads
     objects' boxes needs their statistics current: it waits for their tiles (`objectsReady`, card M8.4.28) and refuses ("try again in a moment")
     only when one of them could not be computed. */

  /** The windows of an operation on these source rectangles, or null after telling the user why it cannot run now. */
  function tiledPlan(s, rects, { boxes = true, tooLarge = 'tiles.boxTooLarge' } = {}) {
    if (s.frozen) { toast(t('tiles.frozen.' + s.frozen)); return null; }   // card M8.4.18a: a section without its pixels is not edited
    const runner = s._statsRunner, waiting = (r) => { const under = tilesUnder(s.maskTiles, r); return runner.pendingIn(under) || runner.failedIn(under); };
    if (boxes && (rects.some((r) => !r) || (runner && rects.some(waiting)))) { void runner?.retry(); toast(t('tiles.busy')); return null; }
    const plan = planWindows(s.maskTiles, rects);
    if (plan.tooLarge) { toast(t(tooLarge, { n: WINDOW_TILES })); return null; }
    if (plan.missing.length) { void maskLoader(s).want(plan.missing).catch(() => {}); toast(t('tiles.loadingMasks')); return null; }
    return plan;
  }

  /* Card M8.4.28: after a reopening every stored tile waits for its statistics (about 0.1 s each). An operation on some objects does not wait
     for all of them: their tiles go first, the busy indicator shows, and the operation runs again once they are done (Escape cancels). The
     mask tiles under their boxes that the page dropped are read back in the same wait, instead of asking to try again. */
  let statsWait = null;
  /** True when the objects' statistics are current and their mask tiles are in the page; otherwise false, and `again` runs once they are
   *  (unless a tile failed, a read failed or Escape was pressed). */
  function objectsReady(s, objs, again) {
    if (s.frozen) return true;                                               // tiledPlan says why a locked section is not edited
    const runner = s._statsRunner;
    if (!runner || objs.every((o) => runner.isCurrent(o.id))) {
      runner?.publish();                                                     // their totals, if still in the runner's batch
      const plan = planWindows(s.maskTiles, objs.map(sourceBox).filter(Boolean));
      return plan.tooLarge || !plan.missing.length || waitThenRun(s, () => maskLoader(s).want(plan.missing), again);   // tiledPlan says "too large"
    }
    const all = tilesUnder(s.maskTiles, { x0: 0, y0: 0, x1: s.maskTiles.width, y1: s.maskTiles.height });
    const positions = objs.flatMap((o) => runner.tilesFor(o.id) || all);
    if (runner.failedIn(positions)) { void runner.retry(); toast(t('tiles.busy')); return false; }
    return waitThenRun(s, () => runner.prioritise(positions), again);
  }
  /** Show the busy indicator while `work()` runs, then run `again` if the same section is open and Escape was not pressed; always false. */
  function waitThenRun(s, work, again) {
    if (statsWait) return false;                                             // one wait at a time
    const wait = statsWait = { done: false }, indicator = $('busy');
    const end = () => {
      if (wait.done) return;
      wait.done = true; statsWait = null;
      indicator.hidden = true; indicator.textContent = t('busy');
      document.removeEventListener('keydown', onKey, true);
    };
    const onKey = (e) => { if (e.key === 'Escape') end(); };
    indicator.textContent = t('tiles.waiting'); indicator.hidden = false;
    document.addEventListener('keydown', onKey, true);
    work().then(() => { if (wait.done) return; end(); if (sec() === s) again(); },
      (error) => { if (wait.done) return; end(); toast(error?.message || String(error), 9000); });
    return false;
  }
  /** The tiles of the objects an edit touched go first, so that their statistics are current soon even while a reopening's tiles wait. */
  function prioritiseObjects(s, ids) {
    const runner = tiledStatsRunner(s), positions = [...ids].flatMap((id) => runner.tilesFor(id) || []);
    if (positions.length) void runner.prioritise(positions);
  }

  function tiledOp(s, group = '') {
    const op = beginOp(s, group);
    Object.assign(op, { section: s, lm: NO_PIXEL_LOG, ex: NO_PIXEL_LOG, tiles: new TileChanges(s.maskTiles), boxes: [] });
    return op;
  }

  /** Open an edit window of `range` for `op`: today's code then writes through `op.s`. */
  function openEditWindow(op, range) {
    const win = new EditWindow(op.section.maskTiles, range);
    op.s = windowSection(op.section, win);
    return win;
  }

  /** Copy what the window may have written inside `rect` (source, half-open) back into the tiles and the reduced copy; close the window. */
  function closeEditWindow(op, win, rect) {
    const s = op.section, r = toWindowRect(win, rect);
    if (r.x1 > r.x0 && r.y1 > r.y0) {
      for (const [row, col] of win.writeBack({ x0: r.x0, y0: r.y0, x1: r.x1 - 1, y1: r.y1 - 1 }, (row, col) => op.tiles.capture(row, col))) {
        const entry = s.maskTiles.get(row, col);
        reduceTile(s, s.ds, row, col, entry?.labels || null, entry?.exclude || null);
      }
      op.boxes.push({ x0: r.x0 + win.ox, y0: r.y0 + win.oy, x1: r.x1 + win.ox, y1: r.y1 + win.oy });
    }
    win.release();
    op.s = s;
  }

  /** Statistics of the tiles around what the operation wrote, one undo step, and the usual refresh. */
  function finishTiledOp(op, target = 0) {
    const s = op.section, around = new Map();
    if (target) op.touched.add(target);
    for (const r of op.boxes) for (const [row, col] of affectedTiles(s.maskTiles, { x0: r.x0, y0: r.y0, x1: r.x1 - 1, y1: r.y1 - 1 })) around.set(row * s.maskTiles.cols + col, [row, col]);
    if (around.size) { void tiledStatsRunner(s).queue([...around.values()], op.touched); prioritiseObjects(s, op.touched); }
    commitTiledOp(op);
    afterChange(s);
  }

  /** Run `edit(op, o, win, box)` for each object on the window of its box (box in window coordinates, half-open), as one operation. */
  function eachObjectWindow(s, objs, group, edit) {
    const rects = objs.map(sourceBox), plan = tiledPlan(s, rects);
    if (!plan) return null;
    const op = tiledOp(s, group), release = pinRanges(s.maskTiles, plan.ranges);
    try {
      objs.forEach((o, k) => { const win = openEditWindow(op, plan.ranges[k]); edit(op, o, win, toWindowRect(win, rects[k])); closeEditWindow(op, win, rects[k]); });
    } finally { release(); op.s = s; }
    return op;
  }

  /** Remove objects from a tiled section (Delete, clearing candidates). */
  function deleteTiledObjects(s, objs) {
    const op = eachObjectWindow(s, objs, '', (step, o, win, b) => {
      for (let y = b.y0; y < b.y1; y++) for (let i = y * win.w + b.x0, e = y * win.w + b.x1; i < e; i++) if (hasId(win.labels[i], o.id, s.stacks)) subPx(step, i, o.id);
    });
    if (!op) return false;
    for (const o of objs) removeTrace(op, o.id);
    if (objs.some((o) => o.id === S.selected)) S.selected = 0;
    S.multi.clear();
    finishTiledOp(op);
    return true;
  }

  /** Merge on a tiled section: every pixel of the other objects (all inside their boxes) takes the keeper's id. */
  function mergeTiledObjects(s, objs, keep, group) {
    const others = objs.filter((o) => o !== keep);
    const op = eachObjectWindow(s, others, group, (step, o, win, b) => {
      for (let y = b.y0; y < b.y1; y++) for (let i = y * win.w + b.x0, e = y * win.w + b.x1; i < e; i++) {
        if (hasId(win.labels[i], o.id, s.stacks)) setLabel(step, i, renameId(win.labels[i], o.id, keep.id, s.stacks, six(s)));
      }
    });
    if (!op) return;
    for (const o of others) removeTrace(op, o.id);
    S.multi.clear();
    finishTiledOp(op, keep.id);
    select(keep.id);
  }

  /** V0.30 on a tiled section: overlapping objects of the same ichnotaxon, found in each object's window. */
  function tiledSameTaxonGroups(s, ids) {
    const objs = ids.map((id) => s.objects.get(id)).filter(Boolean), rects = objs.map(sourceBox), plan = tiledPlan(s, rects);
    if (!plan) return [];
    const groups = [], release = pinRanges(s.maskTiles, plan.ranges);
    try {
      objs.forEach((o, k) => {
        const win = new EditWindow(s.maskTiles, plan.ranges[k]), b = toWindowRect(win, rects[k]);
        const view = { get: (id) => (id === o.id ? { ...o, bbox: [b.x0, b.y0, b.x1 - 1, b.y1 - 1] } : s.objects.get(id)) };
        groups.push(...sameTaxonGroups(win.labels, win.w, s.stacks, view, [o.id]));
        win.release();
      });
    } finally { release(); }
    return groups;
  }

  /** Scissors on a tiled section: the line is 3 source pixels wide; the object is split on the window of its box. */
  function splitTiled(s, pts) {
    const tiles = s.maskTiles, W = tiles.width, st = s.stacks, ds = s.ds;
    const cut = linePixels({ w: W, h: tiles.height }, pts.map(([x, y]) => [x * ds, y * ds])), at = (i) => tiles.labelAt(i % W, Math.floor(i / W)) ?? 0;
    let id = 0;
    if (S.selected && [...cut].some((i) => hasId(at(i), S.selected, st))) id = S.selected;
    else for (const i of cut) { const v = topAt(at(i), st); if (v) { id = v; break; } }
    const o = id && s.objects.get(id);
    if (!o) { toast(t('cut.none')); return; }
    if (!objectsReady(s, [o], () => splitTiled(s, pts))) return;
    const rect = sourceBox(o), plan = tiledPlan(s, [rect]);
    if (!plan) return;
    const op = tiledOp(s), win = openEditWindow(op, plan.ranges[0]), b = toWindowRect(win, rect), inWindow = new Set();
    for (const i of cut) { const x = i % W - win.ox, y = Math.floor(i / W) - win.oy; if (x >= 0 && y >= 0 && x < win.w && y < win.h) inWindow.add(y * win.w + x); }
    const { comp, bw, n, main } = splitPieces(win.labels, win.w, st, [b.x0, b.y0, b.x1 - 1, b.y1 - 1], id, inWindow);
    if (n < 2) { win.release(); op.s = s; toast(t('cut.noSplit')); return; }
    const ids = [0];
    for (let k = 1; k <= n; k++) ids.push(k === main ? id : newObject(op, o.cls, o.src).id);
    for (let k = 1; k <= n; k++) if (k !== main) { const c = s.objects.get(ids[k]); c.pred = o.pred; c.conf = o.conf; c.nt = o.nt; op.touched.add(ids[k]); }
    for (let j = 0; j < comp.length; j++) {
      const k = comp[j]; if (k <= 0 || k === main) continue;
      const i = (b.y0 + ((j / bw) | 0)) * win.w + b.x0 + (j % bw);
      setLabel(op, i, renameId(win.labels[i], id, ids[k], st, six(s)));
    }
    closeEditWindow(op, win, rect);
    finishTiledOp(op, id);
    toast(t('cut.done', { n }));
  }

  /** Wand and lasso on a tiled section: `pixelsIn(win)` gives the window's pixels to add or remove; `rect` is the area they may lie in. */
  function tiledPixels(s, rect, mode, pixelsIn) {
    const plan = tiledPlan(s, [rect], { boxes: false, tooLarge: 'tiles.zoomIn' });
    if (!plan) return;
    const op = tiledOp(s), win = openEditWindow(op, plan.ranges[0]), pixels = pixelsIn(win);
    if (!pixels.length) { win.release(); op.s = s; return; }
    const target = pixelTarget(op, s, mode);
    paintPixels(op, pixels, mode, target);
    const e = op.ext;
    closeEditWindow(op, win, { x0: e.x0 + win.ox, y0: e.y0 + win.oy, x1: e.x1 + 1 + win.ox, y1: e.y1 + 1 + win.oy });
    finishTiledOp(op, target);
    if (target && s.objects.has(target)) select(target);
  }


  function tiledLasso(s, pts, mode) {
    if (!pts || pts.length < 3) return;
    const src = pts.map(([x, y]) => [x * s.ds, y * s.ds]), roi = sourceRoi(s);
    const xs = src.map((p) => p[0]), ys = src.map((p) => p[1]);
    const rect = { x0: Math.max(roi.x0, Math.floor(Math.min(...xs))), y0: Math.max(roi.y0, Math.floor(Math.min(...ys))),
      x1: Math.min(roi.x1, Math.ceil(Math.max(...xs)) + 1), y1: Math.min(roi.y1, Math.ceil(Math.max(...ys)) + 1) };
    if (rect.x1 <= rect.x0 || rect.y1 <= rect.y0) return;
    tiledPixels(s, rect, mode, (win) => polygonPixels(src.map(([x, y]) => [x - win.ox, y - win.oy]), win.w, toWindowRect(win, roi)));
  }

  let wandBusy = false;
  /** The wand on a tiled section grows over the level-0 pixels of the visible area (plus nothing beyond it). */
  async function tiledWand(s, p, mode) {
    const visible = visibleSource(s), x = Math.floor(p.x * s.ds), y = Math.floor(p.y * s.ds);
    if (!visible || wandBusy || !tiledPlan(s, [visible], { boxes: false, tooLarge: 'tiles.zoomIn' })) return;
    const range = windowRange(s.maskTiles, visible, 0), positions = [];
    for (let row = range.row0; row <= range.row1; row++) for (let col = range.col0; col <= range.col1; col++) positions.push([row, col]);
    wandBusy = true;
    let rgba;
    try { rgba = await level0Rgba(s, positions); } catch (error) { toast(error.message || String(error), 9000); return; } finally { wandBusy = false; }
    if (sec() !== s) return;
    const byTile = new Map(positions.map(([row, col], k) => [row * s.maskTiles.cols + col, rgba[k]]));
    tiledPixels(s, visible, mode, (win) => {
      const roi = toWindowRect(win, sourceRoi(s)), wx = x - win.ox, wy = y - win.oy;
      if (wx < roi.x0 || wy < roi.y0 || wx >= roi.x1 || wy >= roi.y1) return [];
      const pixels = windowRgba(win, (row, col) => /** @type {Uint8ClampedArray} */ (byTile.get(row * s.maskTiles.cols + col)));
      return regionGrow(pixels, win.w, win.h, wy * win.w + wx, S.wandTol, roi, win.exclude);
    });
  }

  /** Card M8.4.28: whether an object operation is waiting for its objects' tiles (tests). */
  const objectsWaiting = () => !!statsWait;
  return { startTiledStroke, moveTiledStroke, finishTiledStroke, tiledExcludeRect, swapTiledStep, tiledPlan, objectsReady, objectsWaiting, deleteTiledObjects,
    mergeTiledObjects, tiledSameTaxonGroups, splitTiled, tiledLasso, tiledWand, windowSection };
}
