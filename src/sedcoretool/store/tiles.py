"""Verified tile reads for the engine's coordinator (contract §8.5, ``tile.read``). Standard library only.

A tile is served only after its uncompressed bytes have the SHA-256 that ``<k>/.tiles.sha256`` lists for it (ARCHITECTURE §3.4 rule 3).
Verified tiles are kept in a least-recently-used cache with a byte budget; a pyramid's description is read once and kept while it is used.
"""

from __future__ import annotations

import hashlib
import zlib
from collections import OrderedDict
from pathlib import Path

from . import format as fmt

CACHE_BYTES = 256 * 2**20
MAX_POSITIONS = 16


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
        self.descriptions: dict[str, dict] = {}
        self.hashes: dict[tuple[str, int], bytes] = {}

    def describe(self, pyramid: str) -> dict:
        """The validated ``pyramid.json`` of a complete pyramid (``fmt.InvalidPyramid`` otherwise)."""
        if not isinstance(pyramid, str) or not fmt.HEX64.fullmatch(pyramid):
            raise fmt.InvalidPyramid('pyramid identifier')
        if pyramid not in self.descriptions:
            folder = self.root / pyramid
            if not folder.is_dir() or folder.is_symlink():
                raise fmt.InvalidPyramid('no such pyramid')
            self.descriptions[pyramid] = fmt.read_description(folder)
        return self.descriptions[pyramid]

    def forget(self, pyramid: str) -> None:
        """Drop everything kept for a pyramid (it was deleted or rebuilt)."""
        self.descriptions.pop(pyramid, None)
        for key in [key for key in self.hashes if key[0] == pyramid]:
            del self.hashes[key]
        for key in [key for key in self.cache if key[0] == pyramid]:
            self.cached -= len(self.cache.pop(key))

    def level_hashes(self, pyramid: str, level: dict) -> bytes:
        key = (pyramid, level['level'])
        if key not in self.hashes:
            try:
                data = (self.root / pyramid / str(level['level']) / '.tiles.sha256').read_bytes()
            except OSError:
                raise TileError('tile') from None
            if len(data) != level['rows'] * level['cols'] * 32:
                raise TileError('tile')
            self.hashes[key] = data
        return self.hashes[key]

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
