// Card M8.4.9: the registry of buffers the engine keeps between requests (app/js/residentstore.js), on its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createResidentStore } from '../../app/js/residentstore.js';

/** A store whose releases are recorded; `input(token, bytes)` makes a resident input. */
function store(options = {}) {
  const released = [];
  const resident = createResidentStore({ maxBytes: 1000, maxOwners: 3, release: (tokens) => released.push(...tokens), ...options });
  return { resident, released };
}
const input = (token, bytes, identity = 'id') => ({ token, identity, bytes });
/** Keeps `fresh` for `owner` the way a caller does after a successful upload. */
const keep = (resident, owner, fresh, options) => resident.keep(owner, resident.get(owner), fresh, options);

test('kept buffers are found by owner and counted in bytes and owners', () => {
  const { resident, released } = store(), a = {};
  assert.deepEqual(keep(resident, a, { x: input('t1', 100), y: input('t2', 50) }), { kept: true, superseded: [] });
  assert.equal(resident.get(a).inputs.x.token, 't1');
  assert.equal(resident.bytes(), 150);
  assert.equal(resident.owners(), 1);
  assert.deepEqual(released, []);
});

test('the least recently used owner is dropped first when the bytes do not fit, and its tokens are released', () => {
  const { resident, released } = store(), a = {}, b = {}, c = {};
  keep(resident, a, { x: input('a1', 400) });
  keep(resident, b, { x: input('b1', 400) });
  resident.touch(resident.get(a));                        // a was used last: b is the oldest
  resident.makeRoom(undefined, 300);
  keep(resident, c, { x: input('c1', 300) });
  assert.ok(resident.get(a) && resident.get(c) && !resident.get(b));
  assert.deepEqual(released, ['b1']);
  assert.equal(resident.bytes(), 700);
});

test('at most maxOwners owners stay resident, and the owner being kept is never the one dropped', () => {
  const { resident, released } = store({ maxBytes: 10000, maxOwners: 2 }), owners = [{}, {}, {}, {}];
  owners.forEach((owner, i) => keep(resident, owner, { x: input(`t${i}`, 10) }));
  assert.equal(resident.owners(), 2);
  assert.deepEqual(owners.map((owner) => !!resident.get(owner)), [false, false, true, true]);
  assert.deepEqual(released, ['t0', 't1']);
  // An owner already resident that grows does not drop itself, even when it must drop all others.
  const big = store({ maxBytes: 100, maxOwners: 5 });
  keep(big.resident, owners[0], { x: input('small', 10) }); keep(big.resident, owners[1], { x: input('other', 10) });
  keep(big.resident, owners[0], { x: input('grown', 95) });
  assert.equal(big.resident.get(owners[0]).inputs.x.token, 'grown');
  assert.ok(!big.resident.get(owners[1]));
  assert.deepEqual(big.released, ['other']);
});

test('fresh buffers replace the ones they supersede; the replaced tokens are handed back to the caller, not released by the store', () => {
  const { resident, released } = store(), a = {};
  keep(resident, a, { x: input('x1', 10), table: input('t1', 5) });
  const result = keep(resident, a, { x: input('x2', 10) });
  assert.deepEqual(result, { kept: true, superseded: ['x1'] });
  assert.deepEqual(Object.fromEntries(Object.entries(resident.get(a).inputs).map(([k, v]) => [k, v.token])), { x: 'x2', table: 't1' });
  assert.deepEqual(released, [], 'the caller releases superseded tokens when its request is over');
});

test('an identity change of a group replaces every member, also those the new identity does not have, and sets the key', () => {
  const { resident } = store(), a = {}, group = ['rgba', 'rgba16'];
  keep(resident, a, { rgba: input('r1', 40), rgba16: input('s1', 80) }, { group, key: 'id-16bit' });
  assert.equal(resident.get(a).key, 'id-16bit');
  const result = keep(resident, a, { rgba: input('r2', 40) }, { group, key: 'id-8bit' });
  assert.deepEqual(result.superseded.sort(), ['r1', 's1']);
  assert.deepEqual(Object.keys(resident.get(a).inputs), ['rgba']);
  assert.equal(resident.get(a).key, 'id-8bit');
  assert.equal(resident.bytes(), 40);
  // A member outside the group does not change the key and supersedes only itself.
  keep(resident, a, { table: input('t', 1) }, { group, key: 'ignored' });
  assert.equal(resident.get(a).key, 'id-8bit');
});

test('buffers too large to keep are not kept, and the owner forgets and releases what it held', () => {
  const { resident, released } = store({ maxBytes: 100 }), a = {}, b = {};
  keep(resident, b, { x: input('b1', 30) });
  keep(resident, a, { x: input('a1', 30) });
  assert.deepEqual(keep(resident, a, { x: input('a2', 101) }), { kept: false, superseded: [] });
  assert.ok(!resident.get(a), 'the owner is forgotten');
  assert.ok(!resident.get(b), 'others were dropped trying to make room');
  assert.deepEqual(released.sort(), ['a1', 'b1']);
  assert.equal(resident.bytes(), 0);
});

test('forget releases one owner, releaseAll everything, invalidateAll forgets without releasing', () => {
  const { resident, released } = store({ maxOwners: 5 }), a = {}, b = {}, c = {};
  keep(resident, a, { x: input('a1', 1) }); keep(resident, b, { x: input('b1', 1), y: input('b2', 1) }); keep(resident, c, { x: input('c1', 1) });
  resident.forget(a);
  assert.deepEqual(released, ['a1']);
  resident.forget(a);                                    // forgetting twice releases nothing more
  assert.deepEqual(released, ['a1']);
  resident.releaseAll();
  assert.deepEqual(released.sort(), ['a1', 'b1', 'b2', 'c1']);
  assert.equal(resident.owners(), 0);
  keep(resident, a, { x: input('a3', 1) });
  resident.invalidateAll();
  assert.equal(resident.owners(), 0);
  assert.ok(!resident.get(a));
  assert.ok(!released.includes('a3'), 'tokens of an ended engine session are not sent back');
});

test('keeping nothing only marks the owner as used', () => {
  const { resident } = store({ maxBytes: 100 }), a = {}, b = {};
  keep(resident, a, { x: input('a1', 50) }); keep(resident, b, { x: input('b1', 50) });
  keep(resident, a, {});                                  // a used again: b is now the oldest
  resident.makeRoom(undefined, 10);
  assert.ok(resident.get(a) && !resident.get(b));
  assert.deepEqual(keep(resident, {}, {}), { kept: true, superseded: [] });
  assert.equal(resident.owners(), 1, 'an owner that keeps nothing is not added');
});

test('an entry dropped while its owner was uploading is reused, empty, when the upload is kept', () => {
  const { resident } = store({ maxOwners: 1 }), a = {}, b = {};
  keep(resident, a, { x: input('a1', 10), t: input('a2', 10) });
  const seen = resident.get(a);
  keep(resident, b, { x: input('b1', 10) });             // drops a (one owner at most)
  assert.ok(!resident.get(a));
  resident.keep(a, seen, { x: input('a3', 10) });
  assert.deepEqual(Object.keys(resident.get(a).inputs), ['x'], 'what a held before was released with the drop and is not resurrected');
  assert.ok(!resident.get(b));
});

test('a store needs sound bounds', () => {
  assert.throws(() => createResidentStore({ maxBytes: -1, maxOwners: 1, release: () => {} }));
  assert.throws(() => createResidentStore({ maxBytes: 1, maxOwners: 0, release: () => {} }));
});
