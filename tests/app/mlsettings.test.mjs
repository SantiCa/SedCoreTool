import test from 'node:test';
import assert from 'node:assert/strict';
import { GEO_PARAMS, sanitizeGeoClassifier, sanitizeIchnoMl } from '../../app/js/mlsettings.js';
import { fitModel } from '../../app/js/geo.js';

const DEF = { method: 'knn', k: 5, weights: 'distance', trees: 100, maxDepth: 12, minLeaf: 2, balanced: true, priors: 'uniform', features: 'shape' };

test('ichnotaxa ML: a fully valid default is returned unchanged', () => {
  const r = sanitizeIchnoMl(DEF, DEF);
  assert.deepEqual(r.value, DEF);
  assert.deepEqual(r.reset, []);
});

test('ichnotaxa ML: bad k values are reset to the default', () => {
  for (const k of ['abc', '<img src=x onerror=alert(1)>', NaN, Infinity, 0, 300, null, {}]) {
    const r = sanitizeIchnoMl({ ...DEF, k }, DEF);
    assert.equal(r.value.k, 5, String(k));
    assert.deepEqual(r.reset, ['ml.k']);
  }
});

test('ichnotaxa ML: values typed past the form maximum or fractional are kept', () => {
  assert.equal(sanitizeIchnoMl({ ...DEF, k: 40 }, DEF).value.k, 40);
  assert.equal(sanitizeIchnoMl({ ...DEF, k: 2.5 }, DEF).value.k, 2.5);
  assert.deepEqual(sanitizeIchnoMl({ ...DEF, k: 40 }, DEF).reset, []);
});

test('ichnotaxa ML: unknown method and bad selects, booleans', () => {
  assert.equal(sanitizeIchnoMl({ ...DEF, method: '<script>' }, DEF).value.method, 'knn');
  const r = sanitizeIchnoMl({ weights: 'x', priors: 7, features: '<b>', cvGroup: 'nope', balanced: 'yes', trees: 'many', maxDepth: -1, minLeaf: 1e9 }, DEF);
  assert.equal(r.value.weights, 'distance');
  assert.equal(r.value.priors, 'uniform');
  assert.equal(r.value.features, 'shape');
  assert.equal('cvGroup' in r.value, false);
  assert.equal(r.value.balanced, true);
  assert.equal(r.value.trees, 100);
  assert.equal(r.value.maxDepth, 12);
  assert.equal(r.value.minLeaf, 2);
  assert.deepEqual(r.reset.sort(), ['ml.balanced', 'ml.cvGroup', 'ml.features', 'ml.maxDepth', 'ml.minLeaf', 'ml.priors', 'ml.trees', 'ml.weights']);
  assert.equal(sanitizeIchnoMl({ cvGroup: 'core' }, DEF).value.cvGroup, 'core');
});

test('ichnotaxa ML: unknown keys are kept; non-objects fall back to the defaults', () => {
  assert.equal(sanitizeIchnoMl({ future: 1 }, DEF).value.future, 1);
  assert.deepEqual(sanitizeIchnoMl(null, DEF), { value: DEF, reset: [] });
  assert.deepEqual(sanitizeIchnoMl(undefined, DEF).reset, []);
  assert.deepEqual(sanitizeIchnoMl('x', DEF), { value: DEF, reset: ['ml'] });
  assert.deepEqual(sanitizeIchnoMl([1], DEF), { value: DEF, reset: ['ml'] });
});

test('multiproxy classifier: unknown method and params', () => {
  assert.deepEqual(sanitizeGeoClassifier({ method: '<x>', params: {} }), { value: { method: 'rf', params: {} }, reset: ['method'] });
  assert.equal(sanitizeGeoClassifier({ method: 'zz' }, 'knn').value.method, 'knn');
  const r = sanitizeGeoClassifier({ method: 'rf', params: 'bad' });
  assert.deepEqual(r.value.params, {});
  assert.deepEqual(r.reset, ['params']);
  const k = sanitizeGeoClassifier({ method: 'knn', name: 'a', params: { knn: { k: '<b>', weights: 'uniform' }, rf: 3, other: 1 } });
  assert.deepEqual(k.value.params, { knn: { weights: 'uniform' }, other: 1 });
  assert.deepEqual(k.reset.sort(), ['knn.k', 'rf']);
  assert.equal(k.value.name, 'a');
});

test('multiproxy classifier: a sanitized classifier fits for every method', () => {
  const X = [[0, 0], [0.1, 0.2], [0.2, 0.1], [1, 1], [0.9, 1.1], [1.1, 0.9], [0, 0.2], [1, 0.8]];
  const y = ['a', 'a', 'a', 'b', 'b', 'b', 'a', 'b'];
  for (const m of Object.keys(GEO_PARAMS)) {
    if (m === 'kmeans') continue;
    const bad = { method: m, params: { [m]: Object.fromEntries(GEO_PARAMS[m].map(([n]) => [n, '<b>'])) } };
    const { value } = sanitizeGeoClassifier(bad);
    assert.doesNotThrow(() => fitModel(value.method, X, y, value.params[value.method] || {}), m);
  }
  const { value } = sanitizeGeoClassifier({ method: 'zz', params: {} });
  assert.doesNotThrow(() => fitModel(value.method, X, y, value.params[value.method] || {}));
});

test('multiproxy classifier: a valid classifier is returned equal', () => {
  const c = { id: 'c1', method: 'knn', params: { knn: { k: 7, weights: 'uniform' }, mlp: { balanced: false, l2: 0 } } };
  const r = sanitizeGeoClassifier(c);
  assert.deepEqual(r.value, c);
  assert.deepEqual(r.reset, []);
});
