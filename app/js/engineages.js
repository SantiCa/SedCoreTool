// @ts-check
// With the engine experiment on, a core's merged-table row ages come from `core.ages/1` instead of JavaScript (M8.5.8).
// Keeps per-core state (`core.ageAnalysis`: pending, ready, error) keyed by (target, revision), preserves imported ages,
// skips re-running when inputs are unchanged, cancels superseded requests, and never falls back to JavaScript on failure.
// Pure module: no DOM; the engine client is injected.
import { buildTableSnapshot, tableInputNames } from './tablesnapshot.js';

/**
 * @typedef {import('./core.js').AgeModel} AgeModel
 * @typedef {{state: 'pending'} | {state: 'ready', summary: {rows: number, outside: number}}
 *   | {state: 'error', code: string, field: string | null}} CoreAgeState
 * @typedef {{depths: readonly number[], importedAges: readonly (number | null)[], model: AgeModel,
 *   depthUnit?: string, ageUnit?: string}} CoreAgeRequest
 * @typedef {{depths: number[], importedAges: (number | null)[], model: {depth: number[], age: number[],
 *   min: number[] | null, max: number[] | null}, depthUnit: string, ageUnit: string}} FrozenAgeInputs
 * @typedef {{revision: number, inputs: FrozenAgeInputs, controller: AbortController, settled: boolean,
 *   state: 'pending' | 'ready' | 'error', resolvedAges: (number | null)[] | null,
 *   summary?: {rows: number, outside: number}, done: Promise<void>}} CoreAgeJob
 */

/** @param {readonly (number | null)[] | null} a @param {readonly (number | null)[] | null} b */
function sameAgeNumberList(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** @param {CoreAgeRequest} req @returns {FrozenAgeInputs} */
function freezeAgeInputs(req) {
  const ranged = !!(req.model.min && req.model.max);
  return {
    depths: Array.from(req.depths),
    importedAges: Array.from(req.importedAges),
    model: {
      depth: Array.from(req.model.depth),
      age: Array.from(req.model.age),
      min: ranged ? Array.from(/** @type {number[]} */ (req.model.min)) : null,
      max: ranged ? Array.from(/** @type {number[]} */ (req.model.max)) : null,
    },
    depthUnit: req.depthUnit || 'm',
    ageUnit: req.ageUnit || 'ka',
  };
}

/** @param {FrozenAgeInputs} a @param {FrozenAgeInputs} b */
function sameCoreAgeInputs(a, b) {
  return a.depthUnit === b.depthUnit && a.ageUnit === b.ageUnit
    && sameAgeNumberList(a.depths, b.depths)
    && sameAgeNumberList(a.importedAges, b.importedAges)
    && sameAgeNumberList(a.model.depth, b.model.depth)
    && sameAgeNumberList(a.model.age, b.model.age)
    && sameAgeNumberList(a.model.min, b.model.min)
    && sameAgeNumberList(a.model.max, b.model.max);
}

/** @param {readonly (number | null)[]} importedAges @returns {(number | null)[] | null} */
function importedOnlyAges(importedAges) {
  return importedAges.some((v) => v != null) ? Array.from(importedAges) : null;
}

/**
 * @param {string} name
 * @param {{meta: string, values: string, valid: string}} tokens
 * @returns {Record<string, string>}
 */
function tableTokensToInputs(name, tokens) {
  const names = tableInputNames(name);
  return { [names.meta]: tokens.meta, [names.values]: tokens.values, [names.valid]: tokens.valid };
}

/**
 * @param {{client: {
 *   ensureTable: (owner: object, key: string, snapshot: import('./tablesnapshot.js').TableSnapshot, options?: {signal?: AbortSignal}) => Promise<{identity: string, meta: string, values: string, valid: string}>,
 *   run: (method: string, request: {scope: string, target: string, revision: number, priority?: 'interactive' | 'batch', inputs: Record<string, any>}, options?: {signal?: AbortSignal}) => Promise<{tables: Record<string, {name: string, unit: string, values: (number | null)[]}[]>, summary: Record<string, any>}>,
 *   forget?: (owner: object) => void,
 *   restart?: (options: {automatic: boolean}) => Promise<void>,
 * }, onPublish?: (core: any) => void, onNotice?: (key: 'engine.restarted' | 'engine.restartFailed') => void}} deps
 */
export function createEngineAges({ client, onPublish, onNotice }) {
  /** @type {WeakMap<object, string>} */
  const targets = new WeakMap();
  /** @type {WeakMap<object, number>} */
  const revisions = new WeakMap();
  /** @type {WeakMap<object, CoreAgeJob>} */
  const jobs = new WeakMap();
  /** @type {Map<object, CoreAgeJob>} */
  const unsettled = new Map();

  /** @param {object} core */
  function targetOf(core) {
    let id = targets.get(core);
    if (!id) {
      id = crypto.randomUUID();
      targets.set(core, id);
    }
    return id;
  }

  /** @param {any} core @param {CoreAgeJob} job */
  const isCurrentJob = (core, job) => jobs.get(core) === job && !job.controller.signal.aborted;

  /**
   * Run `core.ages/1` for one core, retrying once after a resident-table loss (`INVALID_BUFFER`) or
   * one automatic engine restart on `ENGINE_UNAVAILABLE`.
   * @param {any} core @param {CoreAgeJob} job
   */
  async function runCoreAges(core, job) {
    const { depths, model, depthUnit, ageUnit } = job.inputs;
    const modelColumns = [
      { name: 'depth', unit: depthUnit, values: model.depth },
      { name: 'age', unit: ageUnit, values: model.age },
      ...(model.min && model.max ? [
        { name: 'age_min', unit: ageUnit, values: model.min },
        { name: 'age_max', unit: ageUnit, values: model.max },
      ] : []),
    ];
    const queryColumns = [{ name: 'depth', unit: depthUnit, values: depths }];
    const [modelSnapshot, querySnapshot] = await Promise.all([
      buildTableSnapshot(modelColumns),
      buildTableSnapshot(queryColumns),
    ]);
    const signal = job.controller.signal;
    const target = targetOf(core);
    let restarted = false;
    for (let attempt = 0; ; attempt++) {
      try {
        const modelTokens = await client.ensureTable(core, 'age_model', modelSnapshot, { signal });
        const queryTokens = await client.ensureTable(core, 'query', querySnapshot, { signal });
        return await client.run('core.ages/1', {
          scope: 'core',
          target,
          revision: job.revision,
          priority: 'interactive',
          inputs: {
            ...tableTokensToInputs('age_model', modelTokens),
            ...tableTokensToInputs('query', queryTokens),
            settings: { version: 1 },
          },
        }, { signal });
      } catch (error) {
        const code = /** @type {any} */ (error)?.code;
        if (attempt === 0 && code === 'INVALID_BUFFER' && !signal.aborted) {
          client.forget?.(core);
          continue;
        }
        if (code === 'ENGINE_UNAVAILABLE' && !restarted && !signal.aborted && client.restart) {
          restarted = true;
          try { await client.restart({ automatic: true }); } catch { throw error; }
          onNotice?.('engine.restarted');
          continue;
        }
        throw error;
      }
    }
  }

  /**
   * Ensure `core.age` is computed by `core.ages/1` for `req`. Synchronous on cache hit; otherwise sets
   * `core.ageAnalysis = { state: 'pending' }` with imported-only ages and starts a background job.
   * @param {any} core @param {CoreAgeRequest} req
   * @returns {Promise<void>}
   */
  function request(core, req) {
    if (!core || !req?.model || !req.depths?.length) return Promise.resolve();
    const frozen = freezeAgeInputs(req);
    const previous = jobs.get(core);
    if (previous && sameCoreAgeInputs(previous.inputs, frozen)) {
      if (previous.state === 'ready') {
        core.age = previous.resolvedAges ? Array.from(previous.resolvedAges) : null;
        core.ageAnalysis = { state: 'ready', summary: previous.summary ?? { rows: frozen.depths.length, outside: 0 } };
      } else if (previous.state === 'pending') {
        core.age = importedOnlyAges(frozen.importedAges);
        core.ageAnalysis = { state: 'pending' };
      }
      return previous.done;
    }
    previous?.controller.abort();
    const revision = (revisions.get(core) || 0) + 1;
    revisions.set(core, revision);
    core.age = importedOnlyAges(frozen.importedAges);
    core.ageAnalysis = { state: 'pending' };
    const controller = new AbortController();
    /** @type {CoreAgeJob} */
    const job = { revision, inputs: frozen, controller, settled: false, state: 'pending', resolvedAges: null, done: Promise.resolve() };
    job.done = (async () => {
      let published = false;
      try {
        const result = await runCoreAges(core, job);
        if (!isCurrentJob(core, job)) return;
        const ageColumn = result.tables?.ages?.find((col) => col.name === 'age');
        if (!ageColumn || ageColumn.values.length !== frozen.depths.length) {
          throw Object.assign(new Error('INTERNAL'), { code: 'INTERNAL', field: 'tables.ages' });
        }
        const merged = frozen.depths.map((_, i) => frozen.importedAges[i] ?? ageColumn.values[i] ?? null);
        job.resolvedAges = merged.some((v) => v != null) ? merged : null;
        job.summary = { rows: Number(result.summary?.rows ?? frozen.depths.length), outside: Number(result.summary?.outside ?? 0) };
        job.state = 'ready';
        core.age = job.resolvedAges ? Array.from(job.resolvedAges) : null;
        core.ageAnalysis = { state: 'ready', summary: job.summary };
        published = true;
      } catch (error) {
        const failure = /** @type {any} */ (error);
        if (failure?.name === 'AbortError' || !isCurrentJob(core, job)) return;
        job.state = 'error';
        job.resolvedAges = null;
        core.age = importedOnlyAges(frozen.importedAges);
        core.ageAnalysis = {
          state: 'error',
          code: typeof failure?.code === 'string' ? failure.code : 'INTERNAL',
          field: failure?.field ?? null,
        };
        published = true;
      } finally {
        job.settled = true;
        if (unsettled.get(core) === job) unsettled.delete(core);
        if (published) onPublish?.(core);
      }
    })();
    jobs.set(core, job);
    unsettled.set(core, job);
    return job.done;
  }

  /** Clear state for a core that no longer needs engine ages (no model, no depths, or all ages imported). @param {any} core */
  function clear(core) {
    if (!core) return;
    const job = jobs.get(core);
    if (job) {
      job.controller.abort();
      jobs.delete(core);
      if (unsettled.get(core) === job) unsettled.delete(core);
    }
    delete core.ageAnalysis;
  }

  /** Wait until every core in `cores` with a pending job settles (re-checking if superseded while awaiting). @param {readonly any[]} cores */
  async function all(cores) {
    await Promise.all((cores || []).map(async (core) => {
      for (let round = 0; round < 50; round++) {
        const job = core ? jobs.get(core) : undefined;
        if (!job) return;
        await job.done;
        if (jobs.get(core) === job && job.settled) return;
      }
    }));
  }

  /** Restart the engine (manual Retry) and re-run every core in error state. @param {readonly any[]} cores */
  async function restartAndRetry(cores) {
    try { await client.restart?.({ automatic: false }); }
    catch { onNotice?.('engine.restartFailed'); return; }
    const failed = (cores || []).filter((core) => core?.ageAnalysis?.state === 'error');
    const retries = [];
    for (const core of failed) {
      const previous = jobs.get(core);
      if (!previous) continue;
      previous.controller.abort();
      jobs.delete(core);
      unsettled.delete(core);
      const m = previous.inputs.model;
      retries.push(request(core, {
        ...previous.inputs,
        model: { depth: m.depth, age: m.age, ...(m.min && m.max ? { min: m.min, max: m.max } : {}) },
      }));
    }
    await Promise.all(retries);
  }

  /** Cancel every in-flight core age job (project closed or replaced). */
  function releaseAll() {
    for (const [core, job] of unsettled) {
      job.controller.abort();
      jobs.delete(core);
    }
    unsettled.clear();
  }

  return {
    request,
    clear,
    all,
    restartAndRetry,
    forget: clear,
    releaseAll,
    /** @param {any} core @returns {CoreAgeState | undefined} */
    stateOf: (core) => core?.ageAnalysis,
  };
}
