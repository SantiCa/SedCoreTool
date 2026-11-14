// @ts-check
// With the engine experiment on, section bins come from the engine instead of the JavaScript calculation (M8.3.7).
// This module decides when a section needs a new analysis, keeps its state (pending, ready, error) and publishes a
// result only if the section's revision is still the one that was requested. It never computes bins itself and never
// falls back to the JavaScript calculation: a failure is shown as an error state. No DOM; the client is passed in.
import { analysisRevision, buildIntervalSnapshot, maskIdentity, resultToBins } from './sectionanalysis.js';

/**
 * @typedef {{state: 'pending'} | {state: 'ready'} | {state: 'error', code: string, field: string | null}} AnalysisState
 * @typedef {{revision: string, controller: AbortController, settled: boolean, done: Promise<void>}} Job
 */

/**
 * The client may keep a section's inputs in the engine between analyses (M8.4.2): then `hasMasks` tells whether the snapshot can leave
 * the masks out, `forget` releases a section's inputs and `analyze` rejects with `RESIDENT_LOST` when the engine no longer has them.
 * @param {{client: {analyze: (snapshot: any, options: {signal: AbortSignal, owner?: object, maskKey?: string}) => Promise<any>,
 *     hasMasks?: (owner: object, maskKey: string) => boolean, forget?: (owner: object) => void},
 *   project: () => import('./sectionanalysis.js').AnalysisProject, onChange: (section: any) => void}} deps
 */
export function createEngineAnalysis({ client, project, onChange }) {
  /** @type {WeakMap<object, Job>} */
  const jobs = new WeakMap();
  /** Jobs wait here: the engine runs one calculation at a time and a page may hold only a few (engine-ipc.js). */
  /** @type {(() => Promise<void>)[]} */
  const queue = [];
  let running = false;

  async function drain() {
    if (running) return;
    running = true;
    try { for (let next = queue.shift(); next; next = queue.shift()) await next(); }
    finally { running = false; }
  }

  /**
   * One analysis of `section` at its current state. The masks are left out of the snapshot when the engine already has them for the
   * same mask identity; if it turns out that it lost them (it restarted) they are uploaded again, once.
   * @param {any} section @param {AbortSignal} signal
   */
  async function analyseWithResidentInputs(section, signal) {
    const maskKey = maskIdentity(section);
    for (let attempt = 0; ; attempt++) {
      const masks = attempt > 0 || !client.hasMasks?.(section, maskKey);
      try { return await client.analyze(buildIntervalSnapshot(section, project(), { masks }), { signal, owner: section, maskKey }); }
      catch (error) {
        if (masks || /** @type {any} */ (error)?.code !== 'RESIDENT_LOST' || attempt > 0) throw error;
        client.forget?.(section);
      }
    }
  }

  /** @param {any} section @param {Job} job */
  const isCurrent = (section, job) => jobs.get(section) === job && !job.controller.signal.aborted && analysisRevision(section, project()) === job.revision;

  /**
   * A job found out of date: if it is still the section's job, its inputs changed without anyone asking again, so ask now.
   * Otherwise a newer request already replaced it. Without this the section would stay pending until the next edit.
   * @param {any} section @param {Job} job
   */
  function renew(section, job) {
    if (jobs.get(section) === job && !job.controller.signal.aborted) void request(section);
  }

  /**
   * Makes sure `section` has a result for its current revision, or a job on the way. While one is on the way the
   * section shows no bins: an older revision is never presented as current.
   * @param {any} section
   * @returns {Promise<void>} settles when the section's state for this revision is final
   */
  function request(section) {
    if (!section) return Promise.resolve();
    const revision = analysisRevision(section, project()), previous = jobs.get(section);
    if (previous && previous.revision === revision) return previous.done;   // pending, ready, or failed for this very revision (an edit retries)
    previous?.controller.abort();
    section.bins = [];
    section.analysis = { state: 'pending' };
    const controller = new AbortController();
    /** @type {Job} */
    const job = { revision, controller, settled: false, done: Promise.resolve() };
    job.done = new Promise((resolve) => {
      queue.push(async () => {
        let published = false;
        try {
          if (!isCurrent(section, job)) { renew(section, job); return; }
          const result = await analyseWithResidentInputs(section, controller.signal);
          if (!isCurrent(section, job)) { renew(section, job); return; }   // edited, replaced or cancelled while the engine worked: change nothing
          section.bins = resultToBins(result);
          section.analysis = { state: 'ready' };
          published = true;
        } catch (error) {
          const failure = /** @type {any} */ (error);
          if (failure?.name === 'AbortError') { renew(section, job); return; }
          if (!isCurrent(section, job)) { renew(section, job); return; }
          section.bins = [];
          section.analysis = { state: 'error', code: typeof failure?.code === 'string' ? failure.code : 'INTERNAL', field: failure?.field ?? null };
          published = true;
        } finally {
          job.settled = true;
          if (published) onChange(section);
          resolve();
        }
      });
    });
    jobs.set(section, job);
    void drain();
    return job.done;
  }

  return {
    request,
    /** Requests every section and resolves when all have a final state for their current revision (a section edited meanwhile is awaited again). */
    all: (/** @type {any[]} */ sections) => Promise.all(sections.map(async (section) => {
      for (let round = 0; round < 50; round++) {
        await request(section);
        const job = jobs.get(section);
        if (!job || (job.settled && job.revision === analysisRevision(section, project()))) return;
      }
    })).then(() => undefined),
    /** Forgets the state of a section so that the next request runs again (after a failure the user retries). */
    retry: (/** @type {any} */ section) => { jobs.get(section)?.controller.abort(); jobs.delete(section); client.forget?.(section); },
    /** Lets the engine drop everything it kept for `section` (the section is closed or replaced). */
    forget: (/** @type {any} */ section) => { jobs.get(section)?.controller.abort(); jobs.delete(section); client.forget?.(section); },
    /** @returns {AnalysisState | undefined} */
    stateOf: (/** @type {any} */ section) => section?.analysis,
  };
}
