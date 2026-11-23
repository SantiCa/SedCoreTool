// Card Q22: coreAgeRelation unit handling and inherited colHide for geolog core images.
import test from 'node:test';
import assert from 'node:assert/strict';
import { coreAgeRelation } from '../../app/js/coredata.js';
import { figureViewOf } from '../../app/js/figview.js';

test('coreAgeRelation keeps textual age model in core units untouched', () => {
  const model = { depth: [1, 2], age: [100, 200] };
  const core = {
    units: 'm',
    sections: [{ name: 'S1', units: 'cm', top: 100, bottom: 200, bins: [] }],
    ageModel: { text: '1, 100\n2, 200', model },
    depth: [1, 2],
    age: [100, 200],
  };
  assert.equal(coreAgeRelation(core), model);
});

test('coreAgeRelation scales textual age model entered in section units to core units', () => {
  const model = { depth: [100, 500, 900], age: [10, 50, 90], min: [9, 48, 87], max: [11, 52, 93], bacon: true };
  const core = {
    units: 'm',
    sections: [{ name: 'S1', units: 'cm', top: 100, bottom: 900, bins: [] }],
    ageModel: { text: '', model },
    depth: [1, 5, 9],
    age: null,
  };
  const relation = coreAgeRelation(core);
  assert.notEqual(relation, model);
  assert.deepEqual(relation, {
    depth: [1, 5, 9],
    age: [10, 50, 90],
    min: [9, 48, 87],
    max: [11, 52, 93],
    bacon: true,
  });
  assert.deepEqual(model.depth, [100, 500, 900]);
});

test('coreAgeRelation derives sorted, deduplicated relation from imported depth/age columns', () => {
  const core = {
    units: 'cm',
    sections: [{ name: 'S1', units: 'cm', top: 0, bottom: 20, bins: [] }],
    ageModel: { text: '', model: null },
    depth: [20, null, 10, 5, 10, 15],
    age: [40, 99, 25, 10, 15, NaN],
  };
  assert.deepEqual(coreAgeRelation(core), {
    depth: [5, 10, 20],
    age: [10, 20, 40],
  });
});

test('coreAgeRelation returns null when fewer than two distinct finite depth-age pairs exist', () => {
  assert.equal(coreAgeRelation(null), null);
  assert.equal(coreAgeRelation({ ageModel: { text: '', model: null }, depth: [5], age: [10] }), null);
  assert.equal(coreAgeRelation({ ageModel: { text: '', model: null }, depth: [5, 5, 10], age: [10, 20, null] }), null);
});

test('figureViewOf ignores inherited image:* colHide before the figure edits its own view', () => {
  const log = { imgMode: 'enh', imgPanels: undefined, overlay: true, hideExcl: false, style: {} };
  const geo = { style: { colHide: ['image:0', 'rec:Ca'] } };
  const originalGeo = JSON.stringify(geo);
  const inherited = figureViewOf({ type: 'geolog' }, log, geo, 'depth');
  assert.deepEqual(inherited.style.colHide, ['rec:Ca']);
  assert.equal(JSON.stringify(geo), originalGeo);

  const edited = figureViewOf({ type: 'geolog', geoView: { style: { colHide: ['image:0'] } } }, log, geo, 'depth');
  assert.deepEqual(edited.style.colHide, ['image:0']);
});
