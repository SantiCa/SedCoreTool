// @ts-check
// Joining the tables of the same core chosen from several projects (card Q3; moved out of app.js): the depths and ages of every project are
// converted to the units of the first one before their rows are joined, and values that disagree at the same depth are counted instead of
// being dropped silently. No DOM: tested in Node.
import { unitFactor } from './core.js';

/**
 * @typedef {{depth: (number | null)[] | null, age: (number | null)[] | null, proxies: Record<string, (number | null)[]>}} CoreTable
 * @typedef {CoreTable & {units?: string, ageUnits?: string}} CoreTableIn
 */

/**
 * Join two tables of one core: rows sorted on depth when every row has one (else on age), rows at the same position (within 1e-6) merged,
 * a value kept from the first table and counted in `conflicts` when the second gives another one.
 * @param {CoreTable} a @param {CoreTable} b
 * @returns {CoreTable & {conflicts: number}}
 */
export function mergeImp(a, b) {
  const rows = [], add = (t0) => (t0.depth || t0.age || []).forEach((_, i) => rows.push({ d: t0.depth?.[i] ?? null, a: t0.age?.[i] ?? null, t: t0, i }));
  add(a); add(b);
  const names = [...new Set([...Object.keys(a.proxies || {}), ...Object.keys(b.proxies || {})])];
  // sort on depth only if every row has one, else on age if every row has one; otherwise keep the two series one after the other
  const key = rows.every((r) => r.d != null) ? 'd' : rows.every((r) => r.a != null) ? 'a' : null;
  if (key) rows.sort((x, y) => x[key] - y[key]);
  const out = [];
  let conflicts = 0;
  for (const r of rows) {
    const v = Object.fromEntries(names.map((n) => [n, r.t.proxies?.[n]?.[r.i] ?? null])), last = out[out.length - 1];
    if (key && last && Math.abs(last[key] - r[key]) < 1e-6) {
      for (const n of names) {
        if (last.v[n] == null) last.v[n] = v[n];
        else if (v[n] != null && v[n] !== last.v[n]) conflicts++;
      }
      if (last.d == null) last.d = r.d; if (last.a == null) last.a = r.a;
    } else out.push({ d: r.d, a: r.a, v });
  }
  const P = Object.fromEntries(names.map((n) => [n, out.map((r) => r.v[n])]));
  return { depth: out.some((r) => r.d != null) ? out.map((r) => r.d) : null, age: out.some((r) => r.a != null) ? out.map((r) => r.a) : null, proxies: P, conflicts };
}

/**
 * Join the tables of one core from several projects, in the depth and age units of the first one.
 * @param {CoreTableIn[]} tables
 * @returns {{table: CoreTable, units: string, ageUnits: string | undefined, conflicts: number, converted: number}}
 *   `converted`: tables whose depths or ages were converted
 */
export function joinCoreTables(tables) {
  const units = tables[0]?.units || 'cm', ageUnits = tables[0]?.ageUnits;
  let converted = 0, conflicts = 0;
  const scaled = tables.map((t0, k) => {
    const fd = k && t0.units ? unitFactor(t0.units, units, 'depth') : 1, fa = k && t0.ageUnits && ageUnits ? unitFactor(t0.ageUnits, ageUnits, 'age') : 1;
    if (fd !== 1 || fa !== 1) converted++;
    const scale = (xs, f) => (xs && f !== 1 ? xs.map((x) => (x == null ? null : +(x * f).toPrecision(15))) : xs);
    return { depth: scale(t0.depth, fd), age: scale(t0.age, fa), proxies: t0.proxies || {} };
  });
  let table = { depth: scaled[0]?.depth ?? null, age: scaled[0]?.age ?? null, proxies: scaled[0]?.proxies || {} };
  for (const next of scaled.slice(1)) { const m = mergeImp(table, next); conflicts += m.conflicts; table = { depth: m.depth, age: m.age, proxies: m.proxies }; }
  return { table, units, ageUnits, conflicts, converted };
}
