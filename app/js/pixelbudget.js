// @ts-check
// Separate full-pixel working memory LRU, reduced-canvas cache LRU, and wave-guarded background pixel loader.
// Pure module: no DOM or controller imports so Node tests can verify eviction and convergence directly.

export const DEFAULT_PX_BUDGET = 9e8;
export const DEFAULT_REDUCED_BUDGET = 256 * 1024 * 1024;

/**
 * Push `item` to the most-recently-used end of `list`.
 * @template T
 * @param {T[]} list
 * @param {T} item
 */
export function lruPush(list, item) {
  const index = list.indexOf(item);
  if (index >= 0) list.splice(index, 1);
  list.push(item);
}

/**
 * Bytes of full working pixel buffers (`orig`, `enh`, optional `orig16`, optional `_unet.prob`) for `s`.
 * Reduced figure/column canvases (`_lc`, `_lb`, `_fc`) are accounted for separately by `reducedCacheBytes`.
 * @param {any} s
 * @returns {number}
 */
export function workingPixelBytes(s) {
  if (!s) return 0;
  return 8 * (s.w || 0) * (s.h || 0) + (s.orig16?.byteLength || 0) + (s._unet?.prob?.byteLength || 0);
}

const canvasBytes = (/** @type {{width?: number, height?: number} | null | undefined} */ canvas) => (
  canvas ? 4 * (canvas.width || 0) * (canvas.height || 0) : 0
);

/**
 * Bytes of reduced figure and column canvases (`_lc`, `_lb`, `_fc`) cached on `s`.
 * @param {any} s
 * @returns {number}
 */
export function reducedCacheBytes(s) {
  if (!s) return 0;
  let bytes = canvasBytes(s._lc?.canvas) + canvasBytes(s._lb?.canvas);
  if (s._fc) for (const entry of s._fc.values()) bytes += canvasBytes(entry?.canvas);
  return bytes;
}

/**
 * Manage full-pixel working memory and reduced-canvas caches under independent LRU budgets.
 * @param {{
 *   pxBudget?: number,
 *   reducedBudget?: number,
 *   isProtected?: (s: any) => boolean,
 *   onForget?: (s: any) => void,
 *   onClearAll?: () => void,
 * }} [options]
 */
export function createPixelBudget({
  pxBudget = DEFAULT_PX_BUDGET,
  reducedBudget = DEFAULT_REDUCED_BUDGET,
  isProtected = () => false,
  onForget,
  onClearAll,
} = {}) {
  /** @type {any[]} */
  const px = [];
  /** @type {any[]} */
  const reduced = [];
  /** @type {Set<any>} */
  const pinned = new Set();

  const budget = {
    px,
    reduced,
    pinned,
    pxBudget,
    reducedBudget,

    /** @param {any} s */
    isProtected(s) {
      return pinned.has(s) || Boolean(isProtected(s));
    },

    workingBytes() {
      let total = 0;
      for (const x of px) total += workingPixelBytes(x);
      return total;
    },

    reducedBytes() {
      let total = 0;
      for (const x of reduced) total += reducedCacheBytes(x);
      return total;
    },

    /** @param {any} s */
    clearWorkingPixels(s) {
      if (!s) return;
      s.orig = null;
      s.orig16 = null;
      s.enh = null;
      s._unet = null;
      const index = px.indexOf(s);
      if (index >= 0) px.splice(index, 1);
    },

    /** @param {any} s */
    clearReducedCache(s) {
      if (!s) return;
      if (s._lc?.canvas) { s._lc.canvas.width = 0; s._lc.canvas.height = 0; }
      if (s._lb?.canvas) { s._lb.canvas.width = 0; s._lb.canvas.height = 0; }
      if (s._fc) {
        for (const entry of s._fc.values()) {
          if (entry?.canvas) { entry.canvas.width = 0; entry.canvas.height = 0; }
        }
      }
      s._fc = null;
      s._lc = null;
      s._lb = null;
      const index = reduced.indexOf(s);
      if (index >= 0) reduced.splice(index, 1);
    },

    /** @param {any} s */
    touchWorkingPixels(s) {
      if (!s) return;
      lruPush(px, s);
      for (let i = 0; i < px.length && px.length > 1 && budget.workingBytes() > budget.pxBudget;) {
        const x = px[i];
        if (x === s || budget.isProtected(x)) { i++; continue; }
        // Keep _fc, _lc, _lb intact so evicted sections keep rendering reduced views without re-decoding.
        budget.clearWorkingPixels(x);
      }
    },

    /** @param {any} s */
    touchReducedCache(s) {
      if (!s) return;
      lruPush(reduced, s);
      for (let i = 0; i < reduced.length && reduced.length > 1 && budget.reducedBytes() > budget.reducedBudget;) {
        const x = reduced[i];
        if (x === s || budget.isProtected(x)) { i++; continue; }
        budget.clearReducedCache(x);
      }
    },

    /** @param {any} s */
    forgetSection(s) {
      if (!s) return;
      pinned.delete(s);
      budget.clearWorkingPixels(s);
      budget.clearReducedCache(s);
      onForget?.(s);
    },

    /** @param {Iterable<any>} [sections] */
    clearAll(sections = []) {
      const seen = new Set();
      for (const s of sections) {
        if (!s || seen.has(s)) continue;
        seen.add(s);
        budget.clearReducedCache(s);
      }
      for (const s of [...reduced]) {
        if (!seen.has(s)) budget.clearReducedCache(s);
      }
      px.length = 0;
      reduced.length = 0;
      pinned.clear();
      onClearAll?.();
    },
  };

  return budget;
}

/**
 * Wave-guarded background pixel loader.
 * Tracks sections decoded in the active wave (`loadedInWave`) so each section is decoded at most once per wave.
 * @param {{
 *   ensurePixels: (s: any) => Promise<any>,
 *   onBatchRendered?: () => void,
 *   pin?: (s: any) => void,
 *   unpin?: (s: any) => void,
 *   schedule?: (fn: () => void) => any,
 *   batchSize?: number,
 *   onError?: (err: unknown, s: any) => void,
 * }} options
 */
export function createPixelLoader({
  ensurePixels,
  onBatchRendered = () => {},
  pin = () => {},
  unpin = () => {},
  schedule = (fn) => setTimeout(fn, 0),
  batchSize = 2,
  onError = (err) => console.error(err),
}) {
  /** @type {Set<any>} */
  const wanted = new Set();
  /** @type {Set<any>} */
  const loadedInWave = new Set();
  let busy = false;
  let scheduled = false;
  let generation = 0;
  /** @type {Promise<void> | null} */
  let activeDrain = null;

  /** @param {any} s */
  function need(s) {
    if (!s || s._pxErr || loadedInWave.has(s)) return false;
    wanted.add(s);
    if (!busy && !scheduled) {
      scheduled = true;
      schedule(() => {
        scheduled = false;
        void drain();
      });
    }
    return true;
  }

  /** @returns {Promise<void>} */
  async function drain() {
    if (busy) return activeDrain ?? Promise.resolve();
    busy = true;
    scheduled = false;
    const gen = generation;
    activeDrain = (async () => {
      try {
        while (wanted.size > 0 && gen === generation) {
          /** @type {any[]} */
          const batch = [];
          for (const x of wanted) {
            wanted.delete(x);
            if (loadedInWave.has(x) || x._pxErr) continue;
            batch.push(x);
            if (batch.length >= batchSize) break;
          }
          if (!batch.length) continue;
          for (const x of batch) {
            loadedInWave.add(x);
            pin(x);
          }
          try {
            for (const x of batch) {
              if (gen !== generation) break;
              try {
                await ensurePixels(x);
              } catch (err) {
                onError(err, x);
              }
            }
            if (gen === generation) onBatchRendered();
          } finally {
            for (const x of batch) unpin(x);
          }
        }
      } finally {
        if (gen === generation) loadedInWave.clear();
        busy = false;
        activeDrain = null;
      }
    })();
    return activeDrain;
  }

  function clear() {
    generation++;
    wanted.clear();
    loadedInWave.clear();
  }

  /** @param {any} s */
  function forget(s) {
    if (!s) return;
    wanted.delete(s);
    loadedInWave.delete(s);
  }

  return {
    wanted,
    loadedInWave,
    get busy() { return busy; },
    need,
    drain,
    clear,
    forget,
  };
}
