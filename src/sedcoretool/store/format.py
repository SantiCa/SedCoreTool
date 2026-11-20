"""The on-disk format of pixel pyramids (contract §8.2). Standard library only: the engine's coordinator imports it to serve tiles.

A pyramid lives in ``<root>/<source sha256>/``: ``pyramid.json`` (written last), Zarr version 2 metadata (``.zgroup``, ``.zattrs``,
``<k>/.zarray``), one file per tile ``<k>/<i>.<j>.0`` (always 512 x 512 x channels samples, C order, zero-padded at the edges; raw or zlib)
and ``<k>/.tiles.sha256`` (the SHA-256 of every tile's uncompressed bytes, 32 bytes per tile, row-major).
"""

from __future__ import annotations

import json
import math
import os
import re
import shutil
from dataclasses import dataclass
from pathlib import Path

FORMAT = 'sedcoretool.pyramid'
VERSION = 1
TILE = 512
HEX64 = re.compile('[0-9a-f]{64}')
PARTIAL_PREFIX = '.partial-'
ZLIB = {'id': 'zlib', 'level': 1}


@dataclass(frozen=True)
class Level:
    level: int
    width: int
    height: int

    @property
    def rows(self) -> int:
        return math.ceil(self.height / TILE)

    @property
    def cols(self) -> int:
        return math.ceil(self.width / TILE)


def levels_for(width: int, height: int) -> list[Level]:
    """Level 0 is the source; each next level has ceil(w/2) x ceil(h/2) pixels; the last is the first that fits in one tile."""
    out = [Level(0, width, height)]
    while out[-1].width > TILE or out[-1].height > TILE:
        last = out[-1]
        out.append(Level(last.level + 1, -(-last.width // 2), -(-last.height // 2)))
    return out


def tile_bytes(channels: int, bits: int) -> int:
    return TILE * TILE * channels * (bits // 8)


def estimated_bytes(width: int, height: int, channels: int, bits: int) -> int:
    """Disk needed by all levels, uncompressed (an upper bound with compression), plus 1 % for metadata and the file system."""
    tiles = sum(level.rows * level.cols for level in levels_for(width, height))
    return int(tiles * (tile_bytes(channels, bits) + 32) * 1.01) + 65_536


def tile_name(row: int, col: int) -> str:
    return f'{row}.{col}.0'


def zarray(level: Level, channels: int, bits: int, compressor) -> dict:
    return {'zarr_format': 2, 'shape': [level.height, level.width, channels], 'chunks': [TILE, TILE, channels],
            'dtype': '|u1' if bits == 8 else '<u2', 'compressor': compressor, 'fill_value': 0, 'order': 'C', 'filters': None,
            'dimension_separator': '.'}


def zattrs(levels: list[Level]) -> dict:
    axes = [{'name': 'y', 'type': 'space'}, {'name': 'x', 'type': 'space'}, {'name': 'c', 'type': 'channel'}]
    datasets = [{'path': str(level.level), 'coordinateTransformations': [{'type': 'scale', 'scale': [2 ** level.level, 2 ** level.level, 1]}]}
                for level in levels]
    return {'multiscales': [{'version': '0.4', 'axes': axes, 'datasets': datasets}]}


def description(*, sha256: str, size: int, name: str, width: int, height: int, channels: int, bits: int, compressor) -> dict:
    return {'format': FORMAT, 'version': VERSION, 'source': {'sha256': sha256, 'size': size, 'name': name},
            'width': width, 'height': height, 'channels': channels, 'bits': bits, 'tile': TILE,
            'levels': [{'level': lv.level, 'width': lv.width, 'height': lv.height, 'rows': lv.rows, 'cols': lv.cols} for lv in levels_for(width, height)],
            'compressor': compressor, 'complete': True}


def write_json_atomically(path: Path, value) -> None:
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_bytes(json.dumps(value, separators=(',', ':'), sort_keys=True).encode('utf-8'))
    os.replace(temporary, path)


def remove_partials(root: Path) -> None:
    """Delete the folders of interrupted builds (contract §8.4: when a coordinator starts and before each build)."""
    if not root.is_dir():
        return
    for item in root.glob(PARTIAL_PREFIX + '*'):
        if item.is_dir() and not item.is_symlink():
            shutil.rmtree(item, ignore_errors=True)


class InvalidPyramid(ValueError):
    """A folder that is not a complete pyramid of this format version."""


def read_description(folder: Path) -> dict:
    """``pyramid.json`` of a complete pyramid, checked against everything the readers rely on."""
    try:
        value = json.loads((folder / 'pyramid.json').read_bytes())
    except (OSError, ValueError):
        raise InvalidPyramid('pyramid.json missing or unreadable') from None
    try:
        ok = (value['format'] == FORMAT and value['version'] == VERSION and value['complete'] is True and value['tile'] == TILE
              and value['channels'] in (1, 3, 4) and value['bits'] in (8, 16) and value['compressor'] in (None, ZLIB)
              and HEX64.fullmatch(value['source']['sha256']) and value['source']['sha256'] == folder.name
              and value['levels'] == description(sha256=folder.name, size=value['source']['size'], name=value['source']['name'],
                                                 width=value['width'], height=value['height'], channels=value['channels'],
                                                 bits=value['bits'], compressor=value['compressor'])['levels'])
    except (KeyError, TypeError):
        ok = False
    if not ok:
        raise InvalidPyramid('pyramid.json does not describe a complete pyramid of this version')
    return value
