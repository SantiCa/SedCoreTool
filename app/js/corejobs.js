// @ts-check
// Card M8.5.8a: the page-side gate of core-scope engine jobs. The engine keeps one running and four waiting jobs per priority, shared
// with section analyses (contract §9.4), and refuses more with `BUSY`; a project with many cores would otherwise send one job per core
// at once. Core jobs therefore wait here, first in, first out, with at most `limit` of them in flight.
// Pure module: no DOM.

/** @returns {Error} */
const coreGateAbortError = () => Object.assign(new Error('Core job cancelled while waiting'), { name: 'AbortError' });

/**
 * A first-in, first-out gate with at most `limit` holders. `acquire(signal)` resolves to a release function once the caller's turn
 * comes; a waiter whose signal aborts before its turn leaves the queue and rejects with an `AbortError`. Calling a release function
 * more than once frees one place only.
 * @param {{limit?: number}} [options]
 */
export function createCoreJobGate({ limit = 2 } = {}) {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('core job gate limit must be a positive integer');
  let holders = 0;
  /** @type {{grant: (release: () => void) => void, signal: AbortSignal | undefined, onAbort: () => void}[]} */
  const waiting = [];

  /** @returns {() => void} */
  function newRelease() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      holders--;
      admitWaiting();
    };
  }

  function admitWaiting() {
    while (holders < limit && waiting.length) {
      const next = /** @type {(typeof waiting)[number]} */ (waiting.shift());
      next.signal?.removeEventListener('abort', next.onAbort);
      holders++;
      next.grant(newRelease());
    }
  }

  /**
   * @param {AbortSignal} [signal]
   * @returns {Promise<() => void>}
   */
  function acquire(signal) {
    if (signal?.aborted) return Promise.reject(coreGateAbortError());
    if (holders < limit && !waiting.length) {
      holders++;
      return Promise.resolve(newRelease());
    }
    return new Promise((resolve, reject) => {
      const entry = {
        grant: resolve,
        signal,
        onAbort: () => {
          const position = waiting.indexOf(entry);
          if (position >= 0) waiting.splice(position, 1);
          reject(coreGateAbortError());
        },
      };
      signal?.addEventListener('abort', entry.onAbort, { once: true });
      waiting.push(entry);
    });
  }

  return {
    acquire,
    limit,
    /** @returns {{holders: number, waiting: number}} */
    stats: () => ({ holders, waiting: waiting.length }),
  };
}
