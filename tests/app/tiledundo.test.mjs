// Card M8.4.16 step 5: undo and redo of tiled edits by tile copies (decision C), with their own budget.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TileChanges, trimTileHistory, UNDO_TILE_BYTES } from '../../app/js/tiledundo.js';
import { MaskTiles, LABEL_BYTES, EXCLUDE_BYTES } from '../../app/js/tiledmasks.js';
import { EditWindow, windowRange } from '../../app/js/tiledit.js';
import { TILE } from '../../app/js/tiledsection.js';

const N = TILE * TILE;
const labelsWith = (value, at = 7) => { const a = new Int32Array(N); a[at] = value; return a; };
/** Every tile of the page as plain arrays (null for empty layers), to compare states exactly. */
const snapshot = (tiles) => {
  const out = {};
  for (let row = 0; row < tiles.rows; row++) for (let col = 0; col < tiles.cols; col++) {
    const entry = tiles.get(row, col);
    if (entry && (entry.labels || entry.exclude)) out[`${row}.${col}`] = [entry.labels ? Array.from(entry.labels) : null, entry.exclude ? Array.from(entry.exclude) : null];
  }
  return out;
};

/** A stroke through an edit window: `paint(window)` writes the window, then the rectangle is copied back with copy on first write. */
function stroke(tiles, rect, paint) {
  const win = new EditWindow(tiles, windowRange(tiles, rect, 0)), changes = new TileChanges(tiles);
  paint(win);
  win.writeBack({ x0: rect.x0 - win.ox, y0: rect.y0 - win.oy, x1: rect.x1 - 1 - win.ox, y1: rect.y1 - 1 - win.oy }, (row, col) => changes.capture(row, col));
  win.release();
  return changes.seal();
}

test('undo and redo swap the tile copies and give back each state exactly, empty tiles included', () => {
  const tiles = new MaskTiles({ width: 1300, height: 1100 });
  tiles.set(0, 0, labelsWith(3), null); tiles.set(1, 1, null, Uint8Array.from({ length: N }, (_, i) => (i % 5 === 0 ? 1 : 0)));
  tiles.acknowledge([[0, 0], [1, 1]]);
  const before = snapshot(tiles);
  // A stroke across four tiles: labels 9 on a band that crosses (0, 0), (0, 1), (1, 0) and (1, 1); (0, 1) and (1, 0) were empty.
  const rect = { x0: 500, y0: 500, x1: 530, y1: 530 };
  const changes = stroke(tiles, rect, (win) => {
    for (let y = rect.y0; y < rect.y1; y++) for (let x = rect.x0; x < rect.x1; x++) win.labels[(y - win.oy) * win.w + x - win.ox] = 9;
  });
  const after = snapshot(tiles);
  assert.deepEqual(changes.positions().map(String).sort(), ['0,0', '0,1', '1,0', '1,1']);
  assert.notDeepEqual(after, before);
  const swapped = changes.swap();                                     // undo
  assert.equal(swapped.length, 4);
  assert.deepEqual(snapshot(tiles), before);
  assert.equal(tiles.state(0, 1), 'loaded', 'a tile that was empty is an (empty) edit again, sent to the store as such');
  assert.deepEqual(tiles.dirtyPositions().map(String).sort(), ['0,0', '0,1', '1,0', '1,1'], 'undo is an edit the store has not acknowledged');
  changes.swap();                                                     // redo
  assert.deepEqual(snapshot(tiles), after);
  changes.swap();                                                     // and undo again
  assert.deepEqual(snapshot(tiles), before);
});

test('copy on first write: a tile written twice by one edit is kept as it was before the edit', () => {
  const tiles = new MaskTiles({ width: 512, height: 512 });
  tiles.set(0, 0, labelsWith(1), null);
  const before = snapshot(tiles), win = new EditWindow(tiles, windowRange(tiles, { x0: 0, y0: 0, x1: 512, y1: 512 }, 0)), changes = new TileChanges(tiles);
  const capture = (row, col) => changes.capture(row, col);
  win.labels[7] = 2; win.writeBack({ x0: 7, y0: 0, x1: 7, y1: 0 }, capture);
  win.labels[8] = 3; win.writeBack({ x0: 8, y0: 0, x1: 8, y1: 0 }, capture);
  assert.equal(tiles.get(0, 0).labels[7], 2, 'the window writes in place into the tile');
  changes.seal().swap();
  assert.deepEqual(snapshot(tiles), before);
});

test('a step whose tiles the page dropped asks for them before it swaps, and changes nothing until then', () => {
  const tiles = new MaskTiles({ width: 1024, height: 512, budget: LABEL_BYTES });
  tiles.set(0, 0, labelsWith(1), null);
  const changes = stroke(tiles, { x0: 0, y0: 0, x1: 10, y1: 10 }, (win) => { win.labels[0] = 5; });
  tiles.acknowledge([[0, 0]]);
  tiles.set(0, 1, labelsWith(2), null); tiles.acknowledge([[0, 1]]);     // the budget drops (0, 0), clean now
  assert.equal(tiles.state(0, 0), 'missing');
  assert.deepEqual(changes.missing(), [[0, 0]]);
  const version = tiles.version;
  assert.throws(() => changes.swap(), /not loaded/);
  assert.equal(tiles.version, version);
  tiles.set(0, 0, (() => { const a = labelsWith(1); a[0] = 5; return a; })(), null, { dirty: false });   // read back from the store
  changes.swap();
  assert.equal(tiles.get(0, 0).labels[0], 0);
  assert.equal(tiles.get(0, 0).labels[7], 1);
  assert.throws(() => new TileChanges(tiles).capture(9, 9), /position/);
});

test('a step counts the larger of its two states; empty layers count nothing', () => {
  const tiles = new MaskTiles({ width: 1024, height: 512 });
  tiles.set(0, 0, labelsWith(1), new Uint8Array(N).fill(1));
  const erase = stroke(tiles, { x0: 0, y0: 0, x1: 1024, y1: 512 }, (win) => { win.labels.fill(0); win.exclude.fill(0); });
  assert.equal(erase.bytes, LABEL_BYTES + EXCLUDE_BYTES, 'before: one tile with both layers; after: nothing');
  const paint = stroke(tiles, { x0: 0, y0: 0, x1: 1024, y1: 512 }, (win) => { win.labels.fill(4); });
  assert.equal(paint.bytes, 2 * LABEL_BYTES, 'before: nothing; after: labels on two tiles');
  assert.equal(new TileChanges(tiles).seal().bytes, 0);
});

test('trimTileHistory drops the oldest steps (whole groups) beyond the budget and always keeps the newest', () => {
  const step = (mib, group = '') => ({ group, tiles: /** @type {any} */ ({ bytes: mib * 2 ** 20 }) });
  const steps = [step(2, 'g'), step(2, 'g'), { group: '' }, step(30), step(31)];
  assert.equal(trimTileHistory(steps), 2, '65 MiB: the oldest group goes as a whole');
  assert.deepEqual(steps.map((s) => (s.tiles ? s.tiles.bytes / 2 ** 20 : null)), [null, 30, 31]);
  assert.equal(trimTileHistory(steps), 0, '61 MiB fits');
  const huge = [step(10), step(100)];
  assert.equal(trimTileHistory(huge), 1);
  assert.equal(huge.length, 1, 'the newest step stays even when it alone exceeds the budget');
  assert.equal(UNDO_TILE_BYTES, 64 * 2 ** 20);
});
