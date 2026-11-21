"""Verified tile reads of the coordinator (contract §8.5, store/tiles.py): what the reader keeps in memory is bounded (card M8.4.40)."""

import hashlib

import pytest

from sedcoretool.store import format as fmt
from sedcoretool.store import tiles


def hand_made_pyramid(root, value, width=300, height=200):
    """A grey pyramid of one level and one tile, written as contract §8.2 describes it (no libvips needed). Returns its name and tile."""
    tile = bytes([value]) * fmt.tile_bytes(1, 8)
    name = hashlib.sha256(b'source %d' % value).hexdigest()
    folder = root / name
    (folder / '0').mkdir(parents=True)
    (folder / '0' / fmt.tile_name(0, 0)).write_bytes(tile)
    (folder / '0' / '.tiles.sha256').write_bytes(hashlib.sha256(tile).digest())
    fmt.write_json_atomically(folder / 'pyramid.json', fmt.description(sha256=name, size=10, name='x.tif', width=width, height=height,
                                                                       channels=1, bits=8, compressor=None))
    return name, tile


def test_descriptions_are_bounded_and_a_pyramid_that_leaves_keeps_nothing(tmp_path, monkeypatch):
    monkeypatch.setattr(tiles, 'MAX_DESCRIPTIONS', 3)
    reader = tiles.TileReader(tmp_path)
    made = [hand_made_pyramid(tmp_path, value) for value in range(5)]
    for name, tile in made[:3]:
        assert reader.read(name, 0, [[0, 0]]) == [tile]
    reader.describe(made[0][0])                                          # used again: the least recently used is now the second
    for name, tile in made[3:]:
        assert reader.read(name, 0, [[0, 0]]) == [tile]
    assert list(reader.descriptions) == [made[0][0], made[3][0], made[4][0]]
    gone = {made[1][0], made[2][0]}
    assert not any(key[0] in gone for key in reader.hashes) and not any(key[0] in gone for key in reader.cache)
    assert reader.cached == sum(len(data) for data in reader.cache.values())
    assert reader.read(made[1][0], 0, [[0, 0]]) == [made[1][1]]           # read again from the disk, verified as before


def test_level_hash_lists_are_kept_within_their_byte_budget(tmp_path, monkeypatch):
    monkeypatch.setattr(tiles, 'HASH_CACHE_BYTES', 64)                   # two lists of one tile each
    reader = tiles.TileReader(tmp_path)
    made = [hand_made_pyramid(tmp_path, value) for value in range(3)]
    for name, tile in made:
        assert reader.read(name, 0, [[0, 0]]) == [tile]
    assert list(reader.hashes) == [(made[1][0], 0), (made[2][0], 0)] and reader.hashed == 64
    monkeypatch.setattr(tiles, 'HASH_CACHE_BYTES', 31)                   # a list larger than the budget is used, not kept
    reader = tiles.TileReader(tmp_path)
    assert reader.read(made[0][0], 0, [[0, 0]]) == [made[0][1]] and reader.hashes == {} and reader.hashed == 0


def test_an_altered_tile_is_still_refused(tmp_path):
    name, tile = hand_made_pyramid(tmp_path, 9)
    (tmp_path / name / '0' / fmt.tile_name(0, 0)).write_bytes(tile[:-1] + b'\x00')
    with pytest.raises(tiles.TileError) as error:
        tiles.TileReader(tmp_path).read(name, 0, [[0, 0]])
    assert error.value.field == 'tile'
