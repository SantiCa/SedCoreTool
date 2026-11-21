// @ts-check
// Registry of buffers that the engine keeps between requests (card M8.4.9, extracted from engineclient.js of card M8.4.2): for each
// owner (a section object) the named buffers it holds, the identity they were made for, their size and when they were last used.
// It bounds the total bytes and the number of owners, drops the least recently used owner first and hands the tokens of what it
// drops to `release`. Entries do not keep their owner alive: an owner that is gone has its buffers released at the next `makeRoom`.
// Pure: no DOM and no engine calls, so Node can test it; masks, pixels and tables each use one instance with their own bounds.

/**
 * @typedef {{token: string, identity: string, bytes: number}} ResidentInput
 * @typedef {{owner: WeakRef<object>, key: string | null, inputs: Record<string, ResidentInput>, used: number}} ResidentEntry
 */

/**
 * @param {{maxBytes: number, maxOwners: number, release: (tokens: string[]) => void}} options
 *   `release` receives the tokens of dropped buffers; it must not throw (the engine frees them in the background).
 */
export function createResidentStore({ maxBytes, maxOwners, release }) {
  if (!(maxBytes >= 0) || !(maxOwners >= 1)) throw new Error('A resident store needs a byte bound >= 0 and an owner bound >= 1');
  /** @type {WeakMap<object, ResidentEntry>} */
  const byOwner = new WeakMap();
  /** @type {Set<ResidentEntry>} */
  const entries = new Set();
  let clock = 0;

  const entryBytes = (/** @type {ResidentEntry} */ entry) => Object.values(entry.inputs).reduce((sum, input) => sum + input.bytes, 0);
  const total = () => { let sum = 0; for (const entry of entries) sum += entryBytes(entry); return sum; };

  /** @param {ResidentEntry} entry @param {boolean} [releaseTokens] false when the tokens are already invalid (the engine session ended) */
  function drop(entry, releaseTokens = true) {
    entries.delete(entry);
    const owner = entry.owner.deref();
    if (owner && byOwner.get(owner) === entry) byOwner.delete(owner);
    if (releaseTokens) release(Object.values(entry.inputs).map((input) => input.token));
    entry.inputs = {};
  }
  function pruneGone() { for (const entry of [...entries]) if (!entry.owner.deref()) drop(entry); }

  /** Frees room for `needed` more bytes (and one more owner) by dropping the least recently used entries other than `keepEntry`. */
  function makeRoom(/** @type {ResidentEntry | undefined} */ keepEntry, /** @type {number} */ needed) {
    pruneGone();
    const others = [...entries].filter((entry) => entry !== keepEntry).sort((a, b) => a.used - b.used);
    while (others.length && (total() + needed > maxBytes || others.length >= maxOwners)) drop(/** @type {ResidentEntry} */ (others.shift()));
  }

  /**
   * Makes `fresh` (buffers just committed in the engine) resident for `owner`, replacing the ones they supersede, unless they do not fit
   * even after dropping every other owner: then the owner is forgotten and what it held is released, and `kept` is false (the caller
   * still owns the fresh tokens and releases them). Names in `group` are replaced together: when any of them is fresh, every older
   * member of the group is superseded and the entry's key becomes `key`. `entry` is the owner's entry as the caller saw it before it
   * uploaded (it may have been dropped meanwhile; it is then reused, empty).
   * @param {object} owner @param {ResidentEntry | undefined} entry @param {Record<string, ResidentInput>} fresh
   * @param {{group?: readonly string[], key?: string | null}} [options]
   * @returns {{kept: boolean, superseded: string[]}} `superseded`: tokens no longer resident; the caller releases them when it is done
   */
  function keep(owner, entry, fresh, { group = [], key = null } = {}) {
    const names = Object.keys(fresh);
    if (!names.length) { if (entry) entry.used = ++clock; return { kept: true, superseded: [] }; }
    const target = entry ?? { owner: new WeakRef(owner), key: null, inputs: /** @type {Record<string, ResidentInput>} */ ({}), used: 0 };
    const newGroup = names.some((name) => group.includes(name));
    const superseded = (newGroup ? [...group, ...names.filter((name) => !group.includes(name))] : names).filter((name) => target.inputs[name]);
    const added = names.reduce((sum, name) => sum + fresh[name].bytes, 0);
    const freed = superseded.reduce((sum, name) => sum + target.inputs[name].bytes, 0);
    makeRoom(target, added - freed);
    if (total() + added - freed > maxBytes) {   // too large to keep: forget this owner, release what it held
      if (entry) drop(entry);
      return { kept: false, superseded: [] };
    }
    const tokens = superseded.map((name) => target.inputs[name].token);
    for (const name of superseded) delete target.inputs[name];
    for (const name of names) target.inputs[name] = fresh[name];
    if (newGroup) target.key = key;
    target.used = ++clock;
    entries.add(target);
    byOwner.set(owner, target);
    return { kept: true, superseded: tokens };
  }

  return {
    /** The entry of `owner`, or undefined. */
    get: (/** @type {object} */ owner) => byOwner.get(owner),
    /** Marks an entry as just used (it becomes the last to be dropped). */
    touch: (/** @type {ResidentEntry} */ entry) => { entry.used = ++clock; },
    makeRoom,
    keep,
    pruneGone,
    /** Releases everything `owner` holds. */
    forget(/** @type {object} */ owner) { const entry = byOwner.get(owner); if (entry) drop(entry); },
    /** Releases everything (a project is being replaced). */
    releaseAll() { for (const entry of [...entries]) drop(entry); },
    /** Forgets everything without releasing it: the engine session that held the buffers has ended. */
    invalidateAll() { for (const entry of [...entries]) drop(entry, false); },
    bytes: total,
    owners: () => entries.size,
    maxBytes,
  };
}
