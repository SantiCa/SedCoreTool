// Card Q1: deleting an ichnotaxon reaches every core, can be undone, and orphaned labels are repaired.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classUse, deleteClass, restoreClass, repairOrphanLabels } from '../../app/js/taxa.js';

/** Two cores of two sections; class `p` (Planolites) labels traces in both cores and is predicted for one. */
function project() {
  const section = (entries) => ({ objects: new Map(entries.map(([id, cls, pred = null, nt = false]) => [id, { id, cls, pred, nt }])) });
  return {
    classes: [{ id: 'undet', name: 'Undetermined' }, { id: 'p', name: 'Planolites' }, { id: 'z', name: 'Zoophycos' }],
    cores: [
      { sections: [section([[1, 'p'], [2, 'z'], [3, null, 'p']]), section([[1, 'p', null, true]])] },
      { sections: [section([[1, 'z'], [2, 'p', 'z']]), section([])] },
    ],
  };
}
const labels = (value) => value.cores.map((c) => c.sections.map((s) => [...s.objects.values()].map((o) => [o.cls, o.pred])));

test('the use of a class counts every core: labelled traces, examples, predictions', () => {
  assert.deepEqual(classUse(project().cores, 'p'), { traces: 3, examples: 2, predictions: 1, cores: 2 });
  assert.deepEqual(classUse(project().cores, 'none'), { traces: 0, examples: 0, predictions: 0, cores: 0 });
});

test('deleting a class used in two cores leaves no trace with its id; restoring brings every label back', () => {
  const value = project(), before = labels(value);
  const deleted = deleteClass(value, 'p');
  assert.ok(deleted);
  assert.deepEqual(value.classes.map((c) => c.id), ['undet', 'z']);
  assert.equal(JSON.stringify(labels(value)).includes('"p"'), false, 'no trace keeps the deleted id, in either core');
  assert.deepEqual(labels(value)[1][0], [['z', null], [null, 'z']], 'other labels and predictions untouched');
  assert.deepEqual(restoreClass(value, deleted), { restored: 4, skipped: 0 });
  assert.deepEqual(labels(value), before);
  assert.deepEqual(value.classes.map((c) => c.id), ['undet', 'p', 'z'], 'back in its place');
});

test('restoring leaves alone a trace labelled again meanwhile and a trace that is gone', () => {
  const value = project(), deleted = deleteClass(value, 'p');
  value.cores[0].sections[0].objects.get(1).cls = 'z';                // labelled again by the user
  value.cores[1].sections[0].objects.delete(2);                       // deleted
  assert.deepEqual(restoreClass(value, deleted), { restored: 2, skipped: 2 });
  assert.equal(value.cores[0].sections[0].objects.get(1).cls, 'z');
  assert.equal(deleteClass(value, 'none'), null);
});

test('a project with labels of a class it no longer has opens repaired, with the count', () => {
  const value = project();
  value.classes = value.classes.filter((c) => c.id !== 'p');           // saved after a deletion that reached one core only
  const repaired = repairOrphanLabels(value.cores, value.classes);
  assert.equal(repaired.traces, 3);
  assert.equal(repaired.predictions, 1);
  assert.equal(repaired.sections.size, 3);
  assert.equal(JSON.stringify(labels(value)).includes('"p"'), false);
  assert.deepEqual(repairOrphanLabels(value.cores, value.classes), { traces: 0, predictions: 0, sections: new Set() }, 'a second pass finds nothing');
});
