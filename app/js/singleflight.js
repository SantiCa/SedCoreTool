// @ts-check
// One run at a time (card M8.4.31): a request made while a run is under way waits for it and then runs once more only if `revision()`
// changed after the last run started, so several requests made during one run give at most one more run and two runs never overlap. A
// request made while nothing runs always runs. Used for project saves (the revision counts the project's changes: a save that could not store
// everything is not repeated for every waiting request). No DOM: tested in Node.

/**
 * @param {() => Promise<void>} run one run; its failure is reported to the request that started it
 * @param {() => number} revision a number that changes whenever there is something new for a run
 * @returns {{request: () => Promise<void>, readonly running: Promise<void> | null}}
 */
export function singleFlight(run, revision) {
  /** @type {Promise<void> | null} */
  let running = null, started = NaN;
  async function request() {
    let waited = false;
    while (running) { waited = true; await running.catch(() => {}); }
    if (waited && revision() === started) return;
    started = revision();
    const current = running = run();
    try { await current; } finally { if (running === current) running = null; }
  }
  return { request, get running() { return running; } };
}
