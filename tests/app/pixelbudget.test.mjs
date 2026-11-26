// Card Q21: separating full-pixel and reduced-canvas LRU budgets plus wave-guarded loading prevents infinite eviction loops.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPixelBudget,
  createPixelLoader,
  pixelSourceKind,
  reducedCacheBytes,
  workingPixelBytes,
} from '../../app/js/pixelbudget.js';

function fakeCanvas(width, height) {
  return { width, height };
}

function makeSection(name, w = 10, h = 5) {
  return {
    name,
    w,
    h,
    orig: null,
    orig16: null,
    enh: null,
    _unet: null,
    _fc: null,
    _lc: null,
    _lb: null,
  };
}

test('workingPixelBytes and reducedCacheBytes measure their own buffers independently', () => {
  const s = makeSection('s1', 10, 5);
  s.orig = new Uint8ClampedArray(10 * 5 * 4);
  s.enh = new Uint8ClampedArray(10 * 5 * 4);
  s.orig16 = new Uint16Array(10 * 5 * 4); // 400 B
  s._unet = { key: 'm', prob: new Float32Array(10 * 5) }; // 200 B
  assert.equal(workingPixelBytes(s), 400 + 400 + 200);

  s._lc = { key: 'k', canvas: fakeCanvas(4, 5) }; // 80 B
  s._lb = { key: 'bk', canvas: fakeCanvas(4, 5) }; // 80 B
  s._fc = new Map([
    ['orig', { key: 'f1', canvas: fakeCanvas(5, 4) }], // 80 B
    ['enh', { key: 'f2', canvas: fakeCanvas(2, 5) }], // 40 B
  ]);
  assert.equal(reducedCacheBytes(s), 280);
  // Adding reduced caches does not inflate workingPixelBytes.
  assert.equal(workingPixelBytes(s), 1000);
});

test('6-section whole-core render converges in one decode per section when full pixels exceed pxBudget', async () => {
  const sections = Array.from({ length: 6 }, (_, i) => makeSection(`sec-${i + 1}`, 10, 5)); // 400 B each
  const decodeCounts = new Map(sections.map((s) => [s, 0]));
  const budget = createPixelBudget({ pxBudget: 1000, reducedBudget: 10000 });
  const maxObservedWorkingBytes = { value: 0 };

  const loader = createPixelLoader({
    pin: (s) => budget.pinned.add(s),
    unpin: (s) => budget.pinned.delete(s),
    ensurePixels: async (s) => {
      decodeCounts.set(s, (decodeCounts.get(s) || 0) + 1);
      s.orig = new Uint8ClampedArray(s.w * s.h * 4);
      s.enh = new Uint8ClampedArray(s.w * s.h * 4);
      budget.touchWorkingPixels(s);
      maxObservedWorkingBytes.value = Math.max(maxObservedWorkingBytes.value, budget.workingBytes());
    },
    onBatchRendered: () => renderWholeCore(),
  });

  function renderWholeCore() {
    for (const s of sections) {
      if (s._fc?.get('enh')?.key === 'ready' && s._lc?.key === 'ready') continue;
      if (!s.orig) {
        loader.need(s);
        continue;
      }
      s._fc ||= new Map();
      s._fc.set('enh', { key: 'ready', canvas: fakeCanvas(4, 5), k: 0.4 });
      s._lc = { key: 'ready', canvas: fakeCanvas(4, 5), k: 0.4 };
      budget.touchReducedCache(s);
    }
  }

  renderWholeCore();
  assert.equal(loader.wanted.size, 6);

  await loader.drain();

  assert.ok(maxObservedWorkingBytes.value <= 1000, `working pixels peaked at ${maxObservedWorkingBytes.value} B`);
  assert.ok(budget.workingBytes() <= 1000, `final working pixels ${budget.workingBytes()} B exceed pxBudget`);
  assert.equal(loader.wanted.size, 0);
  assert.equal(loader.loadedInWave.size, 0);

  for (const s of sections) {
    assert.equal(decodeCounts.get(s), 1, `${s.name} decoded once (no eviction loop)`);
    assert.equal(s._fc?.get('enh')?.key, 'ready', `${s.name} kept reduced figure canvas`);
    assert.equal(s._lc?.key, 'ready', `${s.name} kept reduced column canvas`);
  }
  // Older sections lost working pixels under pxBudget, yet a subsequent render does not re-decode them.
  assert.equal(sections[0].orig, null);
  renderWholeCore();
  assert.equal(loader.wanted.size, 0);
  assert.deepEqual([...decodeCounts.values()], [1, 1, 1, 1, 1, 1]);
});

test('extreme tiny reducedBudget still terminates in one wave without infinite re-decoding', async () => {
  const sections = Array.from({ length: 6 }, (_, i) => makeSection(`tiny-${i + 1}`, 10, 5)); // 400 B working each
  const decodeCounts = new Map(sections.map((s) => [s, 0]));
  // Reduced cache budget (160 B) holds only 2 of the 6 sections (80 B each = 480 B total).
  const budget = createPixelBudget({ pxBudget: 1000, reducedBudget: 160 });
  let renderPasses = 0;

  const loader = createPixelLoader({
    pin: (s) => budget.pinned.add(s),
    unpin: (s) => budget.pinned.delete(s),
    ensurePixels: async (s) => {
      decodeCounts.set(s, (decodeCounts.get(s) || 0) + 1);
      s.orig = new Uint8ClampedArray(s.w * s.h * 4);
      s.enh = new Uint8ClampedArray(s.w * s.h * 4);
      budget.touchWorkingPixels(s);
    },
    onBatchRendered: () => renderWholeCore(),
  });

  function renderWholeCore() {
    renderPasses++;
    for (const s of sections) {
      if (s._fc?.get('enh')?.key === 'ready') continue;
      if (!s.orig) {
        loader.need(s);
        continue;
      }
      s._fc ||= new Map();
      s._fc.set('enh', { key: 'ready', canvas: fakeCanvas(4, 5), k: 0.4 });
      budget.touchReducedCache(s);
    }
  }

  renderWholeCore();
  await loader.drain();

  assert.deepEqual([...decodeCounts.values()], [1, 1, 1, 1, 1, 1], 'every section decoded at most once in the wave');
  assert.equal(renderPasses, 4, 'initial pass + 3 batches of 2 sections');
  assert.equal(loader.wanted.size, 0);
  assert.equal(loader.loadedInWave.size, 0);
  assert.ok(budget.reducedBytes() <= 160, `reduced cache stayed within 160 B (${budget.reducedBytes()} B)`);

  // Once the wave finishes, loadedInWave is cleared so later user actions can decode evicted sections again.
  renderWholeCore();
  assert.ok(loader.wanted.size > 0);
});

test('forgetSection and clearAll zero canvas dimensions, null caches, and empty LRUs and loader sets', () => {
  const s1 = makeSection('s1', 10, 5);
  const s2 = makeSection('s2', 10, 5);
  const s3 = makeSection('s3', 10, 5);
  const canvases = [];
  for (const s of [s1, s2, s3]) {
    s.orig = new Uint8ClampedArray(200);
    s.orig16 = new Uint16Array(200);
    s.enh = new Uint8ClampedArray(200);
    s._unet = { key: 'm', prob: new Float32Array(50) };
    const lc = fakeCanvas(12, 24);
    const lb = fakeCanvas(12, 24);
    const fc1 = fakeCanvas(20, 40);
    const fc2 = fakeCanvas(15, 30);
    canvases.push(lc, lb, fc1, fc2);
    s._lc = { key: 'lc', canvas: lc };
    s._lb = { key: 'lb', canvas: lb };
    s._fc = new Map([['orig', { key: 'orig', canvas: fc1 }], ['enh', { key: 'enh', canvas: fc2 }]]);
  }

  let loader;
  const budget = createPixelBudget({
    pxBudget: 1e6,
    reducedBudget: 1e6,
    onForget: (s) => loader.forget(s),
    onClearAll: () => loader.clear(),
  });
  loader = createPixelLoader({
    ensurePixels: async () => {},
    schedule: () => {},
  });

  for (const s of [s1, s2, s3]) {
    budget.touchWorkingPixels(s);
    budget.touchReducedCache(s);
    budget.pinned.add(s);
    loader.need(s);
    loader.loadedInWave.add(s);
  }

  budget.forgetSection(s1);
  assert.equal(s1.orig, null);
  assert.equal(s1.orig16, null);
  assert.equal(s1.enh, null);
  assert.equal(s1._unet, null);
  assert.equal(s1._fc, null);
  assert.equal(s1._lc, null);
  assert.equal(s1._lb, null);
  for (const c of canvases.slice(0, 4)) {
    assert.equal(c.width, 0);
    assert.equal(c.height, 0);
  }
  assert.equal(budget.px.includes(s1), false);
  assert.equal(budget.reduced.includes(s1), false);
  assert.equal(budget.pinned.has(s1), false);
  assert.equal(loader.wanted.has(s1), false);
  assert.equal(loader.loadedInWave.has(s1), false);

  // s2 is kept in `sections` only (not even in reduced LRU if never touched), s3 is in LRU: clearAll clears both.
  budget.clearAll([s2]);
  for (const s of [s2, s3]) {
    assert.equal(s._fc, null);
    assert.equal(s._lc, null);
    assert.equal(s._lb, null);
  }
  for (const c of canvases.slice(4)) {
    assert.equal(c.width, 0);
    assert.equal(c.height, 0);
  }
  assert.equal(budget.px.length, 0);
  assert.equal(budget.reduced.length, 0);
  assert.equal(budget.pinned.size, 0);
  assert.equal(loader.wanted.size, 0);
  assert.equal(loader.loadedInWave.size, 0);
});

test('touchWorkingPixels and touchReducedCache respect protected sections', () => {
  const active = makeSection('active', 10, 5); // 400 B
  const other = makeSection('other', 10, 5);   // 400 B
  const newest = makeSection('newest', 10, 5); // 400 B
  const budget = createPixelBudget({
    pxBudget: 900,
    reducedBudget: 150,
    isProtected: (s) => s === active,
  });

  for (const s of [active, other, newest]) {
    s.orig = new Uint8ClampedArray(200);
    s.enh = new Uint8ClampedArray(200);
    budget.touchWorkingPixels(s);
    s._lc = { key: 'k', canvas: fakeCanvas(4, 5) }; // 80 B
    budget.touchReducedCache(s);
  }

  // `active` is oldest but protected, so `other` was evicted instead.
  assert.ok(active.orig !== null);
  assert.equal(other.orig, null);
  assert.ok(newest.orig !== null);

  assert.ok(active._lc !== null);
  assert.equal(other._lc, null);
  assert.ok(newest._lc !== null);
});

test('pixelSourceKind classifies normal, tiled, missing-tiled, placeholder, and frozen-engine sections', () => {
  assert.equal(pixelSourceKind({ name: 'normal' }), 'decode');
  assert.equal(pixelSourceKind({ name: 'tiled', tiled: { manifest: 'm1' } }), 'tiled');
  assert.equal(pixelSourceKind({ name: 'missing', tiled: { missing: true } }), 'grey');
  assert.equal(pixelSourceKind({ frozen: 'engine', placeholder: { name: 'orig' } }), 'grey');
  assert.equal(pixelSourceKind({ frozen: 'engine' }), 'grey');
});

test('placeholder section evicted under pxBudget reloads grey working pixels without error or mutating placeholder', async () => {
  const placeholder = Object.freeze({ name: 'saved', tiled: Object.freeze({ manifest: 'abc' }) });
  const placeholderSec = makeSection('placeholder', 10, 5); // 400 B working
  placeholderSec.frozen = 'engine';
  placeholderSec.placeholder = placeholder;
  placeholderSec.orig = new Uint8ClampedArray(10 * 5 * 4).fill(128);
  placeholderSec.enh = new Uint8ClampedArray(10 * 5 * 4).fill(128);

  const otherSec = makeSection('other', 10, 5); // 400 B working
  otherSec.orig = new Uint8ClampedArray(10 * 5 * 4);
  otherSec.enh = new Uint8ClampedArray(10 * 5 * 4);

  const budget = createPixelBudget({ pxBudget: 500, reducedBudget: 1000 });
  budget.touchWorkingPixels(placeholderSec);
  budget.touchWorkingPixels(otherSec);

  assert.equal(placeholderSec.orig, null);
  assert.equal(placeholderSec.enh, null);

  const errors = [];
  const greyRgba = (w, h) => {
    const out = new Uint8ClampedArray(w * h * 4).fill(128);
    for (let i = 3; i < out.length; i += 4) out[i] = 255;
    return out;
  };
  const loader = createPixelLoader({
    pin: (s) => budget.pinned.add(s),
    unpin: (s) => budget.pinned.delete(s),
    onError: (err) => errors.push(err),
    ensurePixels: async (s) => {
      const kind = pixelSourceKind(s);
      if (kind === 'decode') throw new Error('locked');
      const rgba = kind === 'grey' ? greyRgba(s.w, s.h) : new Uint8ClampedArray(s.w * s.h * 4);
      s.orig = rgba;
      s.enh = new Uint8ClampedArray(rgba);
      budget.touchWorkingPixels(s);
      return s;
    },
  });

  loader.need(placeholderSec);
  await loader.drain();

  assert.deepEqual(errors, []);
  assert.ok(placeholderSec.orig instanceof Uint8ClampedArray);
  assert.equal(placeholderSec.orig.length, 10 * 5 * 4);
  assert.equal(placeholderSec.orig[0], 128);
  assert.equal(placeholderSec.orig[3], 255);
  assert.ok(placeholderSec.enh instanceof Uint8ClampedArray);
  assert.equal(placeholderSec.enh.length, 10 * 5 * 4);
  assert.equal(placeholderSec.placeholder, placeholder);
  assert.deepEqual(placeholderSec.placeholder, { name: 'saved', tiled: { manifest: 'abc' } });
});

test('a section asked for while a drain of a closed project is still decoding is loaded once that drain ends', async () => {
  // Found by tests/e2e/large-16bit-desktop.mjs: a new project was created while the loader was still decoding a section of the project
  // opened at start-up. The old drain ended on the generation check and left the new request in `wanted` with nothing scheduled.
  let releaseOld;
  const oldSec = makeSection('old', 10, 5), newSec = makeSection('new', 10, 5), decoded = [];
  const loader = createPixelLoader({
    ensurePixels: async (s) => {
      if (s === oldSec) await new Promise((resolve) => { releaseOld = resolve; });
      decoded.push(s.name);
      s.orig = new Uint8ClampedArray(s.w * s.h * 4);
    },
  });
  loader.need(oldSec);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(loader.busy, 'the drain is awaiting the old section');
  loader.clear();                                     // the project is closed and a new one opened
  assert.equal(loader.need(newSec), true);            // the new project's view asks for its section while the old drain still runs
  releaseOld();
  for (let i = 0; i < 20 && !newSec.orig; i++) await new Promise((resolve) => setTimeout(resolve, 0));   // no manual drain: only the loader may wake itself
  assert.ok(newSec.orig, 'the section asked for during the old drain is decoded');
  assert.deepEqual(decoded, ['old', 'new']);
  assert.equal(loader.wanted.size, 0);
  assert.equal(loader.busy, false);
});
