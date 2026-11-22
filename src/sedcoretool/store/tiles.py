"""Verified tile reads for the engine's coordinator (contract §8.5, ``tile.read``). Standard library only.

A tile is served only after its uncompressed bytes have the SHA-256 that ``<k>/.tiles.sha256`` lists for it (ARCHITECTURE §3.4 rule 3).
Verified tiles are kept in a least-recently-used cache with a byte budget. The descriptions of the last ``MAX_DESCRIPTIONS`` pyramids used and
their levels' hash lists (within ``HASH_CACHE_BYTES``) are kept too, least recently used first out; a pyramid whose description leaves keeps
nothing else (card M8.4.40).
"""

from __future__ import annotations

import hashlib
import zlib
from collections import OrderedDict
from pathlib import Path

from . import format as fmt

CACHE_BYTES = 256 * 2**20
MAX_POSITIONS = 16
MAX_DESCRIPTIONS = 64                    # pyramids whose pyramid.json is kept in memory
HASH_CACHE_BYTES = 64 * 2**20            # level hash lists kept in memory (32 bytes per tile: about 2 million tiles)


class TileError(Exception):
    """A tile that cannot be served: missing, unreadable or not matching its hash. ``field`` names what was wrong."""

    def __init__(self, field: str):
        super().__init__(field)
        self.field = field


class TileReader:
    def __init__(self, root: Path, cache_bytes: int = CACHE_BYTES):
        self.root = Path(root)
        self.cache_bytes = cache_bytes
        self.cache: OrderedDict[tuple, bytes] = OrderedDict()
        self.cached = 0
        self.descriptions: OrderedDict[str, dict] = OrderedDict()
        self.hashes: OrderedDict[tuple[str, int], bytes] = OrderedDict()
        self.hashed = 0

    def describe(self, pyramid: str) -> dict:
        """The validated ``pyramid.json`` of a complete pyramid (``fmt.InvalidPyramid`` otherwise)."""
        if not isinstance(pyramid, str) or not fmt.HEX64.fullmatch(pyramid):
            raise fmt.InvalidPyramid('pyramid identifier')
        if pyramid in self.descriptions:
            self.descriptions.move_to_end(pyramid)
            return self.descriptions[pyramid]
        folder = self.root / pyramid
        if not folder.is_dir() or folder.is_symlink():
            raise fmt.InvalidPyramid('no such pyramid')
        description = fmt.read_description(folder)
        self.descriptions[pyramid] = description
        while len(self.descriptions) > MAX_DESCRIPTIONS:
            self.forget(next(iter(self.descriptions)))         # its hash lists and tiles go with it
        return description

    def forget(self, pyramid: str) -> None:
        """Drop everything kept for a pyramid (it was deleted or rebuilt)."""
        self.descriptions.pop(pyramid, None)
        for key in [key for key in self.hashes if key[0] == pyramid]:
            self.hashed -= len(self.hashes.pop(key))
        for key in [key for key in self.cache if key[0] == pyramid]:
            self.cached -= len(self.cache.pop(key))

    def level_hashes(self, pyramid: str, level: dict) -> bytes:
        key = (pyramid, level['level'])
        if key in self.hashes:
            self.hashes.move_to_end(key)
            return self.hashes[key]
        try:
            data = (self.root / pyramid / str(level['level']) / '.tiles.sha256').read_bytes()
        except OSError:
            raise TileError('tile') from None
        if len(data) != level['rows'] * level['cols'] * 32:
            raise TileError('tile')
        if len(data) <= HASH_CACHE_BYTES:                      # a larger list is used for this read only
            self.hashes[key] = data
            self.hashed += len(data)
            while self.hashed > HASH_CACHE_BYTES:
                self.hashed -= len(self.hashes.popitem(last=False)[1])
        return data

    def read(self, pyramid: str, level_index: int, positions) -> list[bytes]:
        """The uncompressed bytes of each requested tile, in request order. Raises ``TileError`` (nothing partial is returned)."""
        description = self.describe(pyramid)
        if type(level_index) is not int or not 0 <= level_index < len(description['levels']):
            raise TileError('level')
        level = description['levels'][level_index]
        if not isinstance(positions, list) or not 1 <= len(positions) <= MAX_POSITIONS:
            raise TileError('positions')
        for position in positions:
            if (not isinstance(position, list) or len(position) != 2 or not all(type(value) is int for value in position)
                    or not 0 <= position[0] < level['rows'] or not 0 <= position[1] < level['cols']):
                raise TileError('positions')
        expected_length = fmt.tile_bytes(description['channels'], description['bits'])
        hashes = self.level_hashes(pyramid, level)
        out = []
        for row, col in positions:
            key = (pyramid, level_index, row, col)
            if key in self.cache:
                self.cache.move_to_end(key)
                out.append(self.cache[key])
                continue
            try:
                raw = (self.root / pyramid / str(level_index) / fmt.tile_name(row, col)).read_bytes()
                data = zlib.decompress(raw) if description['compressor'] else raw
            except (OSError, zlib.error):
                raise TileError('tile') from None
            index = (row * level['cols'] + col) * 32
            if len(data) != expected_length or hashlib.sha256(data).digest() != hashes[index:index + 32]:
                raise TileError('tile')
            self.remember(key, data)
            out.append(data)
        return out

    def remember(self, key: tuple, data: bytes) -> None:
        if len(data) > self.cache_bytes:
            return
        self.cache[key] = data
        self.cached += len(data)
        while self.cached > self.cache_bytes:
            _, dropped = self.cache.popitem(last=False)
            self.cached -= len(dropped)
