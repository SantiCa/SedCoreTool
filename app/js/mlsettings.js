// @ts-check
/* Load-time validation of classifier settings stored in project files (card Q11). Pure module: no DOM, no state import.
   A project file is untrusted input: a non-numeric `k`, an unknown `method` or hostile `params` must not reach the
   classifiers, where they would throw or let a value be used as a loop bound. */

/** Parameters shown for each multiproxy method (help text in i18n: geo.p.<method>.<name>). Entries: [name, type, a, b, step]; for `select`, `a` is the option list. */
export const GEO_PARAMS = {
  mlp: [['hidden', 'select', ['8', '16', '32', '16,8', '32,16', '64,32']], ['activation', 'select', ['relu', 'tanh']], ['epochs', 'int', 20, 2000, 10], ['lr', 'float', 0.0005, 0.1, 0.0005], ['l2', 'float', 0, 0.1, 0.0001], ['batch', 'int', 4, 256, 4], ['balanced', 'bool'], ['patience', 'int', 5, 200, 5]],
  rf: [['trees', 'int', 10, 500, 10], ['maxDepth', 'int', 2, 30, 1], ['minLeaf', 'int', 1, 50, 1], ['mtry', 'select', ['sqrt', 'log2', 'all']], ['bins', 'int', 8, 128, 8], ['bootstrap', 'bool'], ['balanced', 'bool']],
  knn: [['k', 'int', 1, 50, 1], ['weights', 'select', ['distance', 'uniform']]],
  nb: [['smoothing', 'float', 1e-9, 0.1, 1e-6], ['priors', 'select', ['uniform', 'empirical']]],
  kmeans: [['k', 'int', 2, 12, 1], ['restarts', 'int', 1, 20, 1], ['maxIter', 'int', 10, 500, 10]],
};

/** Ichnotaxa classifier fields of the training form (`mlTrainHTML` in app.js), same [name, type, a, b] shape. */
/** @type {any[][]} */
export const ICHNO_ML_PARAMS = [
  ['method', 'select', ['knn', 'rf', 'nb']],
  ['k', 'int', 1, 25],
  ['weights', 'select', ['distance', 'uniform']],
  ['trees', 'int', 10, 500],
  ['maxDepth', 'int', 2, 30],
  ['minLeaf', 'int', 1, 20],
  ['balanced', 'bool'],
  ['priors', 'select', ['uniform', 'empirical']],
  ['features', 'select', ['shape', 'vision']],
  ['cvGroup', 'select', ['section', 'core']],
];

/** @param {unknown} v @returns {v is Record<string, any>} */
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Whether `v` is acceptable for a field. Numbers may exceed the form's maximum by up to 10x (the form accepts typed
 * values past it) but stay bounded; they are not rounded, so values accepted before keep giving the same results.
 * @param {any[]} spec [name, type, a, b]
 * @param {unknown} v
 */
function validField(spec, v) {
  const [, type, a, b] = spec;
  if (type === 'int' || type === 'float') return typeof v === 'number' && Number.isFinite(v) && v >= a && v <= 10 * b;
  if (type === 'select') return (typeof v === 'string' || typeof v === 'number') && a.some((/** @type {any} */ o) => String(o) === String(v));
  if (type === 'bool') return typeof v === 'boolean';
  return false;
}

/**
 * Ichnotaxa classifier settings (`settings.ml`) of a loaded project.
 * @template {Record<string, any>} T
 * @param {unknown} raw stored value
 * @param {T} defaults ML_DEFAULT
 * @returns {{ value: T, reset: string[] }} value to use and the `ml.<field>` names that were reset
 */
export function sanitizeIchnoMl(raw, defaults) {
  if (!isPlainObject(raw)) return { value: { ...defaults }, reset: raw == null ? [] : ['ml'] };
  const value = /** @type {any} */ ({ ...defaults, ...raw }), reset = [];
  for (const spec of ICHNO_ML_PARAMS) {
    /** @type {string} */ const name = spec[0];
    if (!(name in raw) || validField(spec, raw[name])) continue;
    reset.push('ml.' + name);
    if (name in defaults) value[name] = defaults[name]; else delete value[name];
  }
  return { value, reset };
}

/**
 * Multiproxy classifier: known method, object parameters, valid parameter values.
 * @param {Record<string, any>} c classifier as stored
 * @param {string} [fallbackMethod]
 * @returns {{ value: Record<string, any>, reset: string[] }} classifier to use and the fields that were reset
 */
export function sanitizeGeoClassifier(c, fallbackMethod = 'rf') {
  const reset = [], value = { ...c };
  if (typeof value.method !== 'string' || !Object.hasOwn(GEO_PARAMS, value.method)) { value.method = fallbackMethod; reset.push('method'); }
  if (!isPlainObject(value.params)) { value.params = {}; reset.push('params'); }
  else {
    const params = {};
    for (const [m, p] of Object.entries(value.params)) {
      if (!Object.hasOwn(GEO_PARAMS, m)) { params[m] = p; continue; }
      if (!isPlainObject(p)) { reset.push(m); continue; }
      const clean = { ...p };
      for (const spec of /** @type {any[][]} */ (GEO_PARAMS[/** @type {keyof typeof GEO_PARAMS} */ (m)])) {
        if (spec[0] in p && !validField(spec, p[spec[0]])) { delete clean[spec[0]]; reset.push(`${m}.${spec[0]}`); }
      }
      params[m] = clean;
    }
    value.params = params;
  }
  return { value, reset };
}
