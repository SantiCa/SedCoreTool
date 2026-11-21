// @ts-check
// Splitting a tiled section from the interface (card M8.4.43, decisions X1-X4): the actionable M8.4.41 banner, the section-panel button,
// the confirmation dialog listing every part and its depth range (X3a), and the failure-safe replacement (settle -> mask.slice -> loadTiledSection
// -> atomic swap). Controller module: uses the DOM and calls `window.corantoolDesktop.tiles.maskSlice`.
import { buildPartRecord, canSplitSection, decodeSlicePayload, planSplitParts, splitSuggestion } from './tiledsplit.js';
import { statsLimitMessage } from './tiledit.js';
import { t } from './i18n.js';
import { $, S, fmt, sec, uid } from './state.js';

/**
 * @param {{TILES: any, readonly settleDeadlineMs: number, readOnlyProject: () => boolean, storeProject: (id: string) => string,
 *   maskSync: (s: any) => any, loadTiledSection: (q: any) => Promise<any>, stopTiledWork: (s: any) => void,
 *   discardEditHistory: (s: any) => void, resetTiledTools: () => void, tileBuildDialog: (name: string, onCancel: () => void, title?: string) => any,
 *   analyze: (s: any) => void, selectSection: (index: number, fresh?: boolean) => void, scheduleLearn: () => void, scheduleLog: () => void,
 *   markDirty: () => void, toast: (text: string, ms?: number) => void, esc: (text: string) => string}} ctx
 */
export function createTiledSplitController(ctx) {
  const { storeProject, maskSync, loadTiledSection, stopTiledWork, discardEditHistory, resetTiledTools, tileBuildDialog,
    analyze, selectSection, scheduleLearn, scheduleLog, markDirty, toast, esc } = ctx;
  const splitBtn = /** @type {HTMLButtonElement | null} */ ($('secSplit'));
  const statsBox = $('secStatsWarning');
  const statsMsg = $('secStatsMsg');
  const statsBtn = /** @type {HTMLButtonElement | null} */ ($('secStatsSplit'));
  let splitting = false;

  /** Update the section-panel Split button and the M8.4.41 statistics-budget banner for `s`. @param {any} s */
  function render(s) {
    const available = !!ctx.TILES?.maskSlice && !ctx.readOnlyProject();
    const info = splitSuggestion(s);
    if (splitBtn) {
      splitBtn.hidden = !(available && info.canSplit);
      splitBtn.disabled = splitting;
    }
    if (!statsBox || !statsMsg || !statsBtn) return;
    if (!s?.tiled || !info.exceeded) {
      statsBox.hidden = true;
      statsBtn.hidden = true;
      return;
    }
    const { key, vars } = statsLimitMessage(s._statsRunner.stats);
    statsMsg.textContent = t(key, vars);
    statsBox.hidden = false;
    const offerSplit = available && info.canSplit && info.suggested !== null;
    statsBtn.hidden = !offerSplit;
    if (offerSplit) {
      statsBtn.textContent = t('tiles.split.action', { n: info.suggested });
      statsBtn.disabled = splitting;
    }
  }

  /**
   * Confirmation dialog (X3a): lets the user pick 2..maxParts (defaulting to `initialParts`), lists every part's name and depth range live,
   * and explains that the original section will be replaced. Returns the chosen part count or null when cancelled.
   * @param {any} s @param {number} initialParts @returns {Promise<number | null>}
   */
  function confirmSplit(s, initialParts) {
    const { maxParts } = splitSuggestion(s);
    const chosenDefault = Math.max(2, Math.min(maxParts, initialParts || 2));
    return new Promise((resolve) => {
      const dlg = document.createElement('dialog');
      const options = Array.from({ length: maxParts - 1 }, (_, i) => i + 2)
        .map((n) => `<option value="${n}" ${n === chosenDefault ? 'selected' : ''}>${n}</option>`).join('');
      dlg.innerHTML = `<form method="dialog" style="display:grid;gap:10px;min-width:340px;max-width:480px">`
        + `<h3 style="margin:0">${esc(t('tiles.split.title', { name: s.name }))}</h3>`
        + `<label class="f"><span>${esc(t('tiles.split.partsLabel'))}</span><select id="splitCount">${options}</select></label>`
        + `<ul id="splitList" style="margin:0;padding-left:18px;font-size:13px;display:grid;gap:4px"></ul>`
        + `<p class="note" style="margin:0">${esc(t('tiles.split.note'))}</p>`
        + `<div class="row" style="justify-content:flex-end;gap:8px">`
        + `<button class="btn" value="cancel">${esc(t('cl.cancel'))}</button>`
        + `<button class="btn primary" value="ok" id="splitOk">${esc(t('tiles.split.confirm'))}</button></div></form>`;
      document.body.appendChild(dlg);
      const sel = /** @type {HTMLSelectElement} */ (dlg.querySelector('#splitCount'));
      const list = /** @type {HTMLUListElement} */ (dlg.querySelector('#splitList'));
      const updateList = () => {
        const count = Number(sel.value);
        const specs = planSplitParts(s, count, { nameOf: (i, n) => t('tiles.split.partName', { name: s.name, i: i + 1, n }) });
        list.textContent = '';
        for (const p of specs) {
          const li = document.createElement('li');
          li.textContent = t('tiles.split.partLine', { name: p.name, top: fmt(p.top, 2), bottom: fmt(p.bottom, 2), u: p.units, h: p.height });
          list.appendChild(li);
        }
      };
      sel.addEventListener('change', updateList);
      updateList();
      dlg.addEventListener('close', () => {
        const value = dlg.returnValue === 'ok' ? Number(sel.value) : null;
        dlg.remove();
        resolve(value);
      });
      dlg.showModal();
    });
  }

  /** Wait until `s`'s mask sync has committed every edit and holds a manifest, or throw. @param {any} s */
  async function settleOne(s) {
    const sync = maskSync(s), until = performance.now() + ctx.settleDeadlineMs;
    if (!sync.settled) void sync.request([]);
    for (;;) {
      if (sync.settled && sync.manifest) return sync.manifest;
      if (sync.stopped || performance.now() > until) throw Object.assign(new Error('UNSENT'), { code: 'UNSENT' });
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  /** Friendly message for a failed split; the original section is always intact when this runs. @param {any} error */
  function reportFailure(error) {
    if (error?.code === 'UNSENT') toast(t('tiles.split.unsent'), 10000);
    else if (error?.code === 'LIMIT_EXCEEDED' && error?.field === 'disk') toast(t('tiles.split.diskFull'), 10000);
    else toast(t('tiles.split.failed', { code: error?.code || error?.message || 'ERROR', field: error?.field || '' }), 10000);
  }

  /**
   * Split tiled section `s` into `requestedCount` parts (or the X1/dialog count). Atomic on failure: any failure during settling, slicing
   * (`mask.slice`) or loading leaves `s`, `core.sections` and the original stored manifest completely untouched.
   * @param {any} s @param {number | null} [requestedCount] @param {{confirm?: boolean, slice?: Function | null}} [options]
   */
  async function splitSection(s, requestedCount = null, { confirm = true, slice = null } = {}) {
    if (splitting || !ctx.TILES?.maskSlice || ctx.readOnlyProject() || !canSplitSection(s)) return null;
    const core = S.cores.find((c) => c.sections.includes(s));
    if (!core) return null;
    const info = splitSuggestion(s);
    let count = requestedCount ?? info.suggested ?? 2;
    if (confirm) {
      count = await confirmSplit(s, count);
      if (count === null) return null;
    }
    if (!Number.isSafeInteger(count) || count < 2 || count > info.maxParts) return null;

    splitting = true;
    render(sec());
    const projectId = S.id, project = storeProject(projectId);
    const sliceFn = slice || ((proj, man, id, r0, r1) => ctx.TILES.maskSlice(proj, man, id, r0, r1));
    const loaded = [];
    let cancelled = false;
    try {
      const sourceManifest = await settleOne(s);
      const specs = planSplitParts(s, count, {
        nameOf: (i, n) => t('tiles.split.partName', { name: s.name, i: i + 1, n }),
        idOf: () => uid(),
      });
      const records = [];
      const dialog = tileBuildDialog(s.name, () => { cancelled = true; }, t('tiles.split.working', { name: s.name }));
      try {
        for (let i = 0; i < specs.length; i++) {
          if (cancelled) return null;
          dialog.update({ stage: 'split', completed: i, total: specs.length });
          const part = specs[i];
          const res = await sliceFn(project, sourceManifest, part.id, part.row0, part.row1);
          if (res.error) throw Object.assign(new Error(res.error.code), res.error);
          if (cancelled) return null;
          const { objectIds, stackIndices } = decodeSlicePayload(res.ok.bytes, res.ok.objectCount, res.ok.stackCount);
          records.push(buildPartRecord(s, part, res.ok.manifest, objectIds, stackIndices));
        }
        dialog.update({ stage: 'split', completed: specs.length, total: specs.length });
      } finally { dialog.close(); }

      for (const rec of records) {
        if (cancelled) { for (const p of loaded) stopTiledWork(p); return null; }
        const partSection = await loadTiledSection(rec);
        if (partSection.frozen === 'store') {
          stopTiledWork(partSection);
          throw Object.assign(new Error('INVALID_BUFFER'), { code: 'INVALID_BUFFER', field: 'store' });
        }
        for (const [id, obj] of partSection.objects) {
          const orig = s.objects.get(id);
          if (orig) { obj.pred = orig.pred; obj.conf = orig.conf; }
        }
        loaded.push(partSection);
      }

      if (S.id !== projectId || !S.cores.includes(core) || !core.sections.includes(s)) {
        for (const p of loaded) stopTiledWork(p);
        return null;
      }
      const idx = core.sections.indexOf(s);
      discardEditHistory(s);
      stopTiledWork(s);
      resetTiledTools();
      core.sections.splice(idx, 1, ...loaded);
      for (const p of loaded) analyze(p);
      if (core.id === S.curCore) selectSection(idx, true);
      scheduleLearn();
      scheduleLog();
      markDirty();
      toast(t('tiles.split.done', { n: loaded.length }), 6000);
      return loaded;
    } catch (error) {
      for (const p of loaded) stopTiledWork(p);
      reportFailure(error);
      return null;
    } finally {
      splitting = false;
      render(sec());
    }
  }

  splitBtn?.addEventListener('click', () => { const s = sec(); if (s) void splitSection(s, null, { confirm: true }); });
  statsBtn?.addEventListener('click', () => {
    const s = sec();
    if (!s) return;
    const { suggested } = splitSuggestion(s);
    if (suggested !== null) void splitSection(s, suggested, { confirm: true });
  });

  return { render, splitSection, confirmSplit };
}
