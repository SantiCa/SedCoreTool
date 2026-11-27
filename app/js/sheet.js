// SedCoreTool web — formulas of the Data tab (no DOM, no eval).
// Column formulas work on whole columns of one core: [XRF Ba/Ti] / TOC_pct, log10(x), zscore(x), movavg(x, 5)…
// Cell formulas work like a small spreadsheet: =A1*2, =SUM(A1:A5), =MEAN(COL("TOC_pct")), =CORR(COL("a"), COL("b")).
import { minOf, maxOf } from './core.js';

/** Formula error carrying a key + args; the UI translates it with fxText() (i18n.js). `message` is the key. */
const ferr = (key, args = {}) => Object.assign(new Error(key), { key, args });
/** Any error without a key (a bug, or a hostile input reaching a browser built-in) is shown as `invalid`, never as browser text. */
const keyed = (e) => (e && e.key ? e : ferr('invalid'));

/**
 * Card M8.5.8f (decision Z10): bounds of the formula language, because formulas come from project files. Each excess is a named error
 * of that formula (fx.* in i18n.js).
 */
export const FORMULA_LIMITS = Object.freeze({ bytes: 4096, tokens: 1024, depth: 64, args: 64, columnsPerCore: 256, movavgAdditions: 1e8 });
const utf8Bytes = (s) => new TextEncoder().encode(s).length;

/* ───────── tokenizer and parser (recursive descent) ───────── */

function tokenize(src) {
  const out = []; let i = 0;
  while (i < src.length) {
    if (out.length > FORMULA_LIMITS.tokens) throw ferr('tooManyTokens', { n: FORMULA_LIMITS.tokens });
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9.]/.test(ch)) { const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i)); if (!m) throw ferr('badChar', { v: ch }); out.push({ t: 'num', v: +m[0] }); i += m[0].length; continue; }
    if (ch === '[') { const j = src.indexOf(']', i); if (j < 0) throw ferr('noBracket'); out.push({ t: 'name', v: src.slice(i + 1, j) }); i = j + 1; continue; }
    if (ch === '"' || ch === "'") { const j = src.indexOf(ch, i + 1); if (j < 0) throw ferr('noQuote'); out.push({ t: 'str', v: src.slice(i + 1, j) }); i = j + 1; continue; }
    const id = /^[A-Za-z_$][\w.$]*(:[A-Za-z]+\d+)?/.exec(src.slice(i));
    if (id) { out.push({ t: 'id', v: id[0] }); i += id[0].length; continue; }
    const op = /^(<=|>=|==|!=|[-+*/^(),<>])/.exec(src.slice(i));
    if (op) { out.push({ t: 'op', v: op[0] }); i += op[0].length; continue; }
    throw ferr('badChar', { v: ch });
  }
  if (out.length > FORMULA_LIMITS.tokens) throw ferr('tooManyTokens', { n: FORMULA_LIMITS.tokens });
  return out;
}

/** Parse to an AST: {k:'num'|'str'|'ref'|'call'|'bin'|'neg', ...}. */
export function parseFormula(src) {
  const text = String(src);
  if (text.length > FORMULA_LIMITS.bytes || utf8Bytes(text) > FORMULA_LIMITS.bytes) throw ferr('tooLong', { n: FORMULA_LIMITS.bytes });
  const tk = tokenize(text.replace(/^\s*=/, '')); let p = 0, depth = 0;
  const peek = () => tk[p], eat = (v) => { if (tk[p]?.v !== v) throw ferr('expected', { v }); p++; };
  /** Parentheses, calls, unary minus and the right side of ^ nest; at most FORMULA_LIMITS.depth deep. */
  const nest = (parse) => { if (++depth > FORMULA_LIMITS.depth) throw ferr('tooDeep', { n: FORMULA_LIMITS.depth }); const r = parse(); depth--; return r; };
  const binary = (next, ops) => () => { let a = next(); while (tk[p]?.t === 'op' && ops.includes(tk[p].v)) { const op = tk[p++].v; a = { k: 'bin', op, a, b: next() }; } return a; };
  const primary = () => {
    const x = peek(); if (!x) throw ferr('incomplete');
    if (x.t === 'num') { p++; return { k: 'num', v: x.v }; }
    if (x.t === 'str') { p++; return { k: 'str', v: x.v }; }
    if (x.t === 'name') { p++; return { k: 'ref', v: x.v }; }
    if (x.t === 'op' && x.v === '(') { p++; return nest(() => { const e = cmp(); eat(')'); return e; }); }
    if (x.t === 'op' && x.v === '-') { p++; return { k: 'neg', a: nest(power) }; }
    if (x.t === 'id') {
      p++;
      if (tk[p]?.v === '(') { p++; return nest(() => { const f = x.v.toLowerCase(), args = []; if (tk[p]?.v !== ')') { args.push(cmp()); while (tk[p]?.v === ',') { p++; if (args.length >= FORMULA_LIMITS.args) throw ferr('tooManyArgs', { v: f, n: FORMULA_LIMITS.args }); args.push(cmp()); } } eat(')'); return { k: 'call', f, args }; }); }
      return { k: 'ref', v: x.v };
    }
    throw ferr('unexpected', { v: x.v });
  };
  const power = () => { const a = primary(); if (tk[p]?.v === '^') { p++; return { k: 'bin', op: '^', a, b: nest(power) }; } return a; };
  const unary = () => (tk[p]?.v === '-' ? (p++, { k: 'neg', a: nest(unary) }) : power());
  const mul = binary(unary, ['*', '/']);
  const add = binary(mul, ['+', '-']);
  const cmp = binary(add, ['<', '>', '<=', '>=', '==', '!=']);
  const e = cmp(); if (p < tk.length) throw ferr('extra', { v: tk[p].v });
  return e;
}

/* ───────── helpers on arrays with missing values (null) ───────── */
const ok = (v) => v != null && Number.isFinite(v);
const vals = (a) => (Array.isArray(a) ? a.flat(Infinity) : [a]).filter(ok);
const meanOf = (a) => { const v = vals(a); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const stdOf = (a) => { const v = vals(a), m = meanOf(v); return v.length > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1)) : null; };
function corrOf(a, b) {
  const pr = a.map((x, i) => [x, b[i]]).filter(([x, y]) => ok(x) && ok(y)); if (pr.length < 3) return null;
  const ma = meanOf(pr.map((q) => q[0])), mb = meanOf(pr.map((q) => q[1]));
  let sab = 0, saa = 0, sbb = 0; for (const [x, y] of pr) { sab += (x - ma) * (y - mb); saa += (x - ma) ** 2; sbb += (y - mb) ** 2; }
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : null;
}
/** Element-wise operation; scalars broadcast; null propagates. */
function zip(a, b, f) {
  if (!Array.isArray(a) && !Array.isArray(b)) return ok(a) && ok(b) ? f(a, b) : null;
  const n = Array.isArray(a) ? a.length : b.length, out = new Array(n);
  for (let i = 0; i < n; i++) { const x = Array.isArray(a) ? a[i] : a, y = Array.isArray(b) ? b[i] : b; const r = ok(x) && ok(y) ? f(x, y) : null; out[i] = ok(r) ? r : null; }
  return out;
}
/** Argument kinds (decision Z9): a function that needs a column refuses a single value, and the reverse. */
const needCol = (fn, x) => { if (!Array.isArray(x)) throw ferr('argKind', { v: fn }); return x; };
const needOne = (fn, x) => { if (Array.isArray(x)) throw ferr('argKind', { v: fn }); return x; };
/** Digits of round(): Number.prototype.toFixed accepts 0..100 after truncation (NaN counts as 0); anything else is argKind. */
const roundDigits = (d) => { needOne('round', d); const k = Number(d), t = Number.isNaN(k) ? 0 : Math.trunc(k); if (!(t >= 0 && t <= 100)) throw ferr('argKind', { v: 'round' }); return d; };
const map1 = (a, f) => (Array.isArray(a) ? a.map((x) => { const r = ok(x) ? f(x) : null; return ok(r) ? r : null; }) : ok(a) ? f(a) : null);

const FUN = {
  log10: (x) => map1(x, Math.log10), ln: (x) => map1(x, Math.log), log: (x) => map1(x, Math.log), exp: (x) => map1(x, Math.exp),
  sqrt: (x) => map1(x, Math.sqrt), abs: (x) => map1(x, Math.abs), round: (x, d = 0) => { roundDigits(d); return map1(x, (v) => +v.toFixed(d)); },
  pow: (x, y) => zip(x, y, Math.pow), min2: (x, y) => zip(x, y, Math.min), max2: (x, y) => zip(x, y, Math.max),
  mean: meanOf, average: meanOf, std: stdOf, stdev: stdOf, median: (a) => { const v = vals(a).sort((p, q) => p - q); return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null; },
  sum: (...a) => { const v = vals(a); return v.length ? v.reduce((s, x) => s + x, 0) : 0; }, count: (...a) => vals(a).length,
  min: (...a) => { if (a.length === 2 && Array.isArray(a[0]) && Array.isArray(a[1])) return zip(a[0], a[1], Math.min); const v = vals(a); return v.length ? minOf(v) : null; },
  max: (...a) => { if (a.length === 2 && Array.isArray(a[0]) && Array.isArray(a[1])) return zip(a[0], a[1], Math.max); const v = vals(a); return v.length ? maxOf(v) : null; },
  zscore: (x) => { const m = meanOf(x), s = stdOf(x); return map1(x, (v) => (s ? (v - m) / s : 0)); },
  norm01: (x) => { const v = vals(x), lo = minOf(v), hi = maxOf(v); return map1(x, (q) => (hi > lo ? (q - lo) / (hi - lo) : 0)); },
  movavg: (x, n = 3) => {
    needCol('movavg', x); needOne('movavg', n); const h = Math.floor(n / 2);
    if (x.length * (2 * h + 1) > FORMULA_LIMITS.movavgAdditions) throw ferr('tooCostly', { v: 'movavg', n: FORMULA_LIMITS.movavgAdditions });
    return x.map((_, i) => meanOf(x.slice(Math.max(0, i - h), i + h + 1)));
  },
  diff: (x) => needCol('diff', x).map((v, i) => (i && ok(v) && ok(x[i - 1]) ? v - x[i - 1] : null)),
  cumsum: (x) => { let s = 0; return needCol('cumsum', x).map((v) => (ok(v) ? (s += v) : null)); },
  if: (c, a, b) => (Array.isArray(c) ? c.map((v, i) => (v == null ? null : v ? (Array.isArray(a) ? a[i] : a) : (Array.isArray(b) ? b[i] : b))) : c ? a : b),
  corr: (a, b) => corrOf(needCol('corr', a), needCol('corr', b)),
};
export const FUNCTIONS = Object.keys(FUN);

function evalAst(e, resolve) {
  switch (e.k) {
    case 'num': case 'str': return e.v;
    case 'ref': return resolve(e.v);
    case 'neg': return map1(evalAst(e.a, resolve), (v) => -v);
    case 'bin': {
      const a = evalAst(e.a, resolve), b = evalAst(e.b, resolve);
      const f = { '+': (x, y) => x + y, '-': (x, y) => x - y, '*': (x, y) => x * y, '/': (x, y) => (y === 0 ? null : x / y), '^': Math.pow,
        '<': (x, y) => +(x < y), '>': (x, y) => +(x > y), '<=': (x, y) => +(x <= y), '>=': (x, y) => +(x >= y), '==': (x, y) => +(x === y), '!=': (x, y) => +(x !== y) }[e.op];
      return zip(a, b, f);
    }
    case 'call': {
      if (e.f === 'col') return resolve({ col: evalAst(e.args[0], resolve), core: e.args[1] ? evalAst(e.args[1], resolve) : null });
      if (!Object.hasOwn(FUN, e.f)) throw ferr('unkFn', { v: e.f });   // own properties only: never constructor, __proto__...
      const fn = FUN[e.f];
      return fn(...e.args.map((a) => evalAst(a, resolve)));
    }
    default: throw ferr('invalid');
  }
}

/** Parse and evaluate one formula (column or cell); every error carries a key. */
function evaluate(src, resolve) {
  try { return evalAst(parseFormula(src), resolve); } catch (e) { throw keyed(e); }
}

/**
 * Evaluate a column formula over the columns of one core. Returns an array of length n whose cells are numbers or null: a text result
 * (`if(c, "a", "b")`) is a missing value (decision Z9).
 */
export function evalColumn(formula, columns, n) {
  const r = evaluate(formula, (name) => {
    if (typeof name !== 'string') throw ferr('colOnly');
    if (!Object.hasOwn(columns, name)) throw ferr('noCol', { v: name });   // own properties only: never toString, __proto__...
    return columns[name];
  });
  if (!Array.isArray(r)) return new Array(n).fill(ok(r) ? r : null);
  return r.every((v) => v === null || typeof v === 'number') ? r : r.map((v) => (typeof v === 'number' ? v : null));
}

/** Decision Z10: at most FORMULA_LIMITS.columnsPerCore computed columns apply to one core; `count` is the 1-based position. */
export function checkComputedCount(count) {
  if (count > FORMULA_LIMITS.columnsPerCore) throw ferr('tooManyCols', { n: FORMULA_LIMITS.columnsPerCore });
}

/* ───────── free cells (A1 notation) ───────── */
const colIdx = (letters) => [...letters.toUpperCase()].reduce((s, ch) => s * 26 + ch.charCodeAt(0) - 64, 0) - 1;
export const cellName = (c, r) => { let s = '', x = c + 1; while (x) { s = String.fromCharCode(65 + ((x - 1) % 26)) + s; x = Math.floor((x - 1) / 26); } return s + (r + 1); };

/**
 * Evaluate all cells. cells = {A1: '12' | '=A1*2' | 'texto'}; getCol(name, core) gives a core column.
 * Returns {A1: value | {error}}. Cycles give an error.
 */
export function evalCells(cells, getCol) {
  const out = {}, state = {};
  const value = (ref) => {
    ref = ref.toUpperCase();
    if (state[ref] === 2) return out[ref];
    if (state[ref] === 1) throw ferr('circular');
    state[ref] = 1;
    const raw = cells[ref];
    let v;
    try {
      if (raw == null || raw === '') v = null;
      else if (String(raw).startsWith('=')) v = evaluate(raw, resolve);
      else v = Number.isFinite(+raw) && String(raw).trim() !== '' ? +raw : raw;
      if (Array.isArray(v)) v = meanOf(v); // a cell shows one value
    } catch (e) { v = { error: e.message, err: e }; }
    out[ref] = v; state[ref] = 2;
    return v;
  };
  const resolve = (name) => {
    if (typeof name === 'object') return getCol(name.col, name.core);
    const m = /^([A-Za-z]+)(\d+)(?::([A-Za-z]+)(\d+))?$/.exec(name);
    if (!m) throw ferr('badRef', { v: name });
    if (!m[3]) { const v = value(m[1] + m[2]); if (v && v.error) throw v.err; return v; }
    const c0 = colIdx(m[1]), r0 = +m[2] - 1, c1 = colIdx(m[3]), r1 = +m[4] - 1, arr = [];
    for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) { const v = value(cellName(c, r)); arr.push(typeof v === 'number' ? v : null); }
    return arr;
  };
  for (const ref of Object.keys(cells)) value(ref);
  return out;
}

/**
 * Decision Z13: saved computed columns (`project.sheet.columns`) come from a file. Keeps entries whose `name` is non-empty text of at
 * most 256 UTF-8 bytes and not `__proto__`, `formula` is text, `core` is text or absent and `interp` is boolean or absent; returns fresh
 * objects with only those fields (`error` is recomputed, never trusted) and how many entries were dropped.
 * @param {unknown} value
 * @returns {{columns: {name: string, formula: string, core?: string, interp?: boolean}[], dropped: number}}
 */
export function cleanSheetColumns(value) {
  if (value == null) return { columns: [], dropped: 0 };
  if (!Array.isArray(value)) return { columns: [], dropped: 1 };
  const columns = [];
  for (const q of value) {
    if (!q || typeof q !== 'object' || Array.isArray(q)) continue;
    const { name, formula, core, interp } = q, has = (k) => Object.hasOwn(q, k);
    if (typeof name !== 'string' || !name || name === '__proto__' || name.length > 256 || utf8Bytes(name) > 256) continue;
    if (typeof formula !== 'string' || (has('core') && typeof core !== 'string') || (has('interp') && typeof interp !== 'boolean')) continue;
    columns.push({ name, formula, ...(has('core') ? { core } : {}), ...(has('interp') ? { interp } : {}) });
  }
  return { columns, dropped: value.length - columns.length };
}

/** V0.35: names of the columns a formula refers to. */
export function formulaRefs(src) {
  const out = new Set(), walk = (n) => { if (!n) return; if (n.k === 'ref') out.add(n.v); for (const k of ['a', 'b']) walk(n[k]); (n.args || []).forEach(walk); };
  walk(parseFormula(src));
  return [...out];
}

/**
 * V0.35: values of a column at every row, linearly interpolated along x (depth or age, ascending) between the nearest
 * rows that have a value; no extrapolation beyond the first and last values, and no filling across gaps wider than
 * maxGap (in x units). Rows that already have a value keep it.
 */
export function fillLinear(x, v, maxGap = Infinity) {
  const n = v.length, out = v.slice();
  let prev = -1;
  for (let i = 0; i < n; i++) {
    if (v[i] == null || x[i] == null) continue;
    if (prev >= 0 && i - prev > 1 && x[i] - x[prev] <= maxGap) {
      for (let k = prev + 1; k < i; k++) if (x[k] != null && x[i] !== x[prev]) out[k] = v[prev] + ((v[i] - v[prev]) * (x[k] - x[prev])) / (x[i] - x[prev]);
    }
    prev = i;
  }
  return out;
}
