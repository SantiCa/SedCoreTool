// @ts-check
// Which part of a section's masks changed since the engine last received them (card M8.4.4). The editing code reports the
// pixels it writes; the engine path asks for the rows that differ and sends only those. No DOM.
//
// This record is a hint, never a proof: the engine accepts a derived mask only when its whole content has the SHA-256 that the page
// computed from the real array (engine/buffers.py, `buffer.derive`). A writer that forgets to report costs a full upload instead of
// a small one, never a wrong result.

/**
 * @typedef {{all: boolean, first: number, end: number}} MaskChange rows [first, end) when `all` is false
 * @typedef {{first: number, last: number, all: boolean}} Dirty indices of the first and last changed pixel (-1 and -1 when none)
 */

/** Records changed pixel ranges per section object. */
export function createMaskChanges() {
  /** @type {WeakMap<object, Dirty>} */
  const dirty = new WeakMap();
  /** @param {object} section @returns {Dirty} */
  const entry = (section) => { let d = dirty.get(section); if (!d) { d = { first: -1, last: -1, all: false }; dirty.set(section, d); } return d; };
  return {
    /** A pixel at flat index `index` of the label or exclusion mask was written. Cheap enough to call for every pixel of a stroke. */
    mark(/** @type {object} */ section, /** @type {number} */ index) {
      const d = entry(section);
      if (d.first < 0) { d.first = d.last = index; return; }
      if (index < d.first) d.first = index; else if (index > d.last) d.last = index;
    },
    /** Pixels from flat index `first` to `last` (inclusive) were written. */
    markRange(/** @type {object} */ section, /** @type {number} */ first, /** @type {number} */ last) { this.mark(section, first); this.mark(section, last); },
    /** Everything may have changed: the mask was replaced, rotated, cut or its stacks renumbered. */
    markAll(/** @type {object} */ section) { entry(section).all = true; },
    /**
     * Takes what changed since the last `take` and starts again from nothing.
     * @param {{w: number, h: number}} section
     * @returns {MaskChange}
     */
    take(section) {
      const d = entry(section), w = Math.max(1, section.w);
      /** @type {MaskChange} */
      const taken = d.all ? { all: true, first: 0, end: section.h }
        : d.first < 0 ? { all: false, first: 0, end: 0 } : { all: false, first: Math.floor(d.first / w), end: Math.min(section.h, Math.floor(d.last / w) + 1) };
      d.first = d.last = -1; d.all = false;
      return taken;
    },
    /** The change that `take` returned was not used (the engine did not receive it): it still has to be sent. */
    restore(/** @type {{w: number, h: number}} */ section, /** @type {MaskChange} */ taken) {
      const d = entry(section);
      if (taken.all) { d.all = true; return; }
      if (taken.end > taken.first) this.markRange(section, taken.first * section.w, taken.end * section.w - 1);
    },
  };
}

/**
 * The flat index range [first, last] of the pixels named by an edit-history list `[index, old, index, old, ...]`.
 * @param {ArrayLike<any>} pairs @returns {{first: number, last: number} | null}
 */
export function indexRangeOfPairs(pairs) {
  let first = Infinity, last = -1;
  for (let i = 0; i < pairs.length; i += 2) { const index = pairs[i]; if (index < first) first = index; if (index > last) last = index; }
  return last < 0 ? null : { first, last };
}
