// Card M8.5.7: merging all sources of one core into its unified depth/age table without DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectCoreParts, computeCoreAges, mergeCoreData } from '../../app/js/coredata.js';

const linearModel = { depth: [0, 10], age: [0, 100] }; // 10 ka per m

function makeSection(name, units, bins) {
  return { name, units, bins };
}

test('mergeCoreData merges images (with unit conversion and counted classes), depth records, imported data and manual columns', () => {
  const secCm = makeSection('S1', 'cm', [
    // 50 cm = 0.5 m, 150 cm = 1.5 m; classes: [undet(counted, >0), chondrites(counted, 0), artifact(not counted, >0)]
    { dTop: 0, dBottom: 100, depth: 50, pct: 20, BI: 2, ii: 3, classPct: [20, 0, 10] },
    { dTop: 100, dBottom: 200, depth: 150, pct: 40, BI: 3, ii: 4, classPct: [40, 0, 5] },
  ]);
  const classes = [
    { name: 'Undifferentiated', counts: true },
    { name: 'Chondrites', counts: true },
    { name: 'Artifact', counts: false },
  ];
  const core = {
    units: 'm',
    sections: [secCm],
    records: [
      { axis: 'depth', series: [{ name: 'MS', x: [1.0], y: [5.5] }] },
    ],
    ageModel: { text: '0, 0\n10, 100', model: linearModel },
    imp: {
      depth: [0.2, 2.0],
      age: [999, null], // first row keeps imported age; second falls back to age model (20)
      proxies: { Ca: [11, 22] },
    },
    user: {
      NotesVal: { d: [0.8], v: [42] },
    },
    depth: null,
    age: null,
    proxies: {},
    src: {},
    ageText: '',
  };

  mergeCoreData(core, { classes, bioLabel: 'Bioturbation %' });

  assert.equal(core.ageText, '0, 0\n10, 100');
  assert.deepEqual(core.depth, [0.2, 0.5, 0.8, 1.0, 1.5, 2.0]);
  assert.deepEqual(core.age, [999, 5, 8, 10, 15, 20]);
  assert.deepEqual(core.src, {
    'Bioturbation %': 'img',
    BI: 'img',
    ii: 'img',
    '% Undifferentiated': 'img',
    MS: 'rec',
    Ca: 'imp',
    NotesVal: 'man',
  });
  assert.deepEqual(core.proxies['Bioturbation %'], [null, 20, null, null, 40, null]);
  assert.deepEqual(core.proxies.BI, [null, 2, null, null, 3, null]);
  assert.deepEqual(core.proxies.ii, [null, 3, null, null, 4, null]);
  assert.deepEqual(core.proxies['% Undifferentiated'], [null, 20, null, null, 40, null]);
  assert.deepEqual(core.proxies.MS, [null, null, null, 5.5, null, null]);
  assert.deepEqual(core.proxies.Ca, [11, null, null, null, null, 22]);
  assert.deepEqual(core.proxies.NotesVal, [null, null, 42, null, null, null]);
  assert.equal('% Chondrites' in core.proxies, false, 'all-zero counted class is omitted');
  assert.equal('% Artifact' in core.proxies, false, 'non-counted class is omitted');
});

test('age-only core keeps null depth and preserves imported ages and proxies', () => {
  const core = {
    units: 'm',
    sections: [],
    records: [],
    ageModel: { text: '', model: null },
    imp: { depth: null, age: [1.5, 3.0, 4.5], proxies: { d18O: [2.1, 2.4, 2.7] } },
    user: {},
    depth: [999],
    age: null,
    proxies: {},
    src: {},
    ageText: '',
  };

  mergeCoreData(core);

  assert.equal(core.depth, null);
  assert.deepEqual(core.age, [1.5, 3.0, 4.5]);
  assert.deepEqual(core.proxies, { d18O: [2.1, 2.4, 2.7] });
  assert.deepEqual(core.src, { d18O: 'imp' });
});

test('age-axis external records convert to depth via inverted model and keep original ages, or skip without model', () => {
  const withModel = {
    units: 'm',
    sections: [],
    records: [{ axis: 'age', series: [{ name: 'SST', x: [25, 75], y: [18.2, 16.4] }] }],
    ageModel: { text: '0, 0\n10, 100', model: linearModel },
    imp: null,
    user: {},
    depth: null,
    age: null,
    proxies: {},
    src: {},
    ageText: '',
  };
  mergeCoreData(withModel);
  assert.deepEqual(withModel.depth, [2.5, 7.5]);
  assert.deepEqual(withModel.age, [25, 75]);
  assert.deepEqual(withModel.proxies, { SST: [18.2, 16.4] });
  assert.deepEqual(withModel.src, { SST: 'rec' });

  const withoutModel = {
    units: 'm',
    sections: [],
    records: [{ axis: 'age', series: [{ name: 'SST', x: [25, 75], y: [18.2, 16.4] }] }],
    ageModel: { text: '', model: null },
    imp: null,
    user: {},
    depth: null,
    age: null,
    proxies: {},
    src: {},
    ageText: '',
  };
  assert.deepEqual(collectCoreParts(withoutModel), []);
  mergeCoreData(withoutModel);
  assert.equal(withoutModel.depth, null);
  assert.equal(withoutModel.age, null);
  assert.deepEqual(withoutModel.proxies, {});
});

test('frozen core is left untouched', () => {
  const sentinelProxies = { Fe: [1, 2] };
  const core = {
    frozen: true,
    units: 'm',
    sections: [],
    records: [],
    ageModel: { text: 'changed', model: linearModel },
    imp: { depth: [1], age: [10], proxies: { Ca: [9] } },
    user: {},
    depth: [5, 6],
    age: [50, 60],
    proxies: sentinelProxies,
    src: { Fe: 'imp' },
    ageText: 'original',
  };

  mergeCoreData(core);

  assert.deepEqual(core.depth, [5, 6]);
  assert.deepEqual(core.age, [50, 60]);
  assert.equal(core.proxies, sentinelProxies);
  assert.equal(core.ageText, 'original');
});

test('afterMerge receives populated core so cell edits and computed columns run after merge', () => {
  const core = {
    units: 'm',
    sections: [],
    records: [],
    ageModel: { text: '0, 0\n10, 100', model: linearModel },
    imp: { depth: [1, 2], age: null, proxies: { Fe: [10, 20] } },
    user: {},
    depth: null,
    age: null,
    proxies: {},
    src: {},
    ageText: '',
  };

  let seenDepth = null;
  mergeCoreData(core, {
    afterMerge(c) {
      seenDepth = c.depth ? [...c.depth] : null;
      c.proxies.Fe[0] = 99;
      c.proxies.Fe2 = c.proxies.Fe.map((v) => (v == null ? null : v * 2));
      c.src.Fe2 = 'calc';
    },
  });

  assert.deepEqual(seenDepth, [1, 2]);
  assert.deepEqual(core.proxies.Fe, [99, 20]);
  assert.deepEqual(core.proxies.Fe2, [198, 40]);
  assert.equal(core.src.Fe2, 'calc');
});

test('analyzeSection runs once per section before compositing', () => {
  const analyzed = [];
  const core = {
    units: 'cm',
    sections: [
      makeSection('A', 'cm', [{ dTop: 0, dBottom: 10, depth: 5, pct: 0, BI: 0, ii: 1, classPct: [0] }]),
      makeSection('B', 'cm', []),
    ],
    records: [],
    ageModel: { text: '', model: null },
    imp: null,
    user: {},
    depth: null,
    age: null,
    proxies: {},
    src: {},
    ageText: '',
  };

  mergeCoreData(core, {
    classes: [{ name: 'Chondrites', counts: true }],
    analyzeSection(s) {
      analyzed.push(s.name);
      if (s.name === 'B') s.bins.push({ dTop: 10, dBottom: 20, depth: 15, pct: 30, BI: 2, ii: 3, classPct: [30] });
    },
  });

  assert.deepEqual(analyzed, ['A', 'B']);
  assert.deepEqual(core.depth, [5, 15]);
  assert.deepEqual(core.proxies['% Chondrites'], [0, 30]);
});

test('computeCoreAges preserves imported ages and interpolates missing ones', () => {
  assert.deepEqual(computeCoreAges([0, 5, 10], [null, 42, null], linearModel), [0, 42, 100]);
  assert.deepEqual(computeCoreAges([0, 5], [null, 42], null), [null, 42]);
});
