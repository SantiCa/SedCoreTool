"""Building a pixel pyramid from a source image (contract §8.4). Runs in the engine's method worker (NumPy and libvips).

The source is read once, in bands of 512 rows. Each band of level ``k`` is cut into tiles and also halved into the next level, whose rows
accumulate until they fill a band of their own, so memory stays near one band per level whatever the image size. Everything is written
into ``<root>/.partial-<uuid>/`` and renamed to ``<root>/<sha256>/`` only after ``pyramid.json``; a failure removes the partial folder.
"""

from __future__ import annotations

import errno
import hashlib
import os
import shutil
import uuid
import zlib
from pathlib import Path

import numpy as np

from sedcoretool.methods.errors import Cancelled, MethodError

from . import format as fmt
from .source import Source

HASH_CHUNK = 4 * 2**20
FREE_SPACE_RESERVE = 2**30            # the disk keeps at least this much free (contract §8.4)
DISK_FULL = {errno.ENOSPC, getattr(errno, 'EDQUOT', errno.ENOSPC)}
WINDOWS_DISK_FULL = {39, 112}         # ERROR_HANDLE_DISK_FULL, ERROR_DISK_FULL


def halve(band: np.ndarray) -> np.ndarray:
    """The next level of a band: for each channel, the mean of the 1, 2 or 4 pixels covered, rounded half up, ``(sum + n // 2) // n``."""
    data = band.astype(np.uint32)
    height, width, channels = data.shape
    total = np.zeros(((height + 1) // 2, (width + 1) // 2, channels), np.uint32)
    count = np.zeros(((height + 1) // 2, (width + 1) // 2, 1), np.uint32)
    for dy in (0, 1):
        for dx in (0, 1):
            part = data[dy::2, dx::2]
            total[:part.shape[0], :part.shape[1]] += part
            count[:part.shape[0], :part.shape[1]] += 1
    return ((total + count // 2) // count).astype(band.dtype)


def source_digest(path: Path, cancelled, progress) -> tuple[str, int]:
    digest, done, size = hashlib.sha256(), 0, path.stat().st_size
    with path.open('rb') as stream:
        while block := stream.read(HASH_CHUNK):
            if cancelled():
                raise Cancelled()
            digest.update(block)
            done += len(block)
            progress('hash', done, size)
    return digest.hexdigest(), done


def folder_bytes(folder: Path) -> int:
    return sum(item.stat().st_size for item in folder.rglob('*') if item.is_file())


def complete_pyramids(root: Path) -> list[tuple[Path, dict]]:
    found = []
    for item in root.iterdir():
        if item.is_dir() and not item.is_symlink() and fmt.HEX64.fullmatch(item.name):
            try:
                found.append((item, fmt.read_description(item)))
            except fmt.InvalidPyramid:
                continue
    return found


def make_room(root: Path, need: int, budget: int, keep: set[str]) -> list[str]:
    """Delete complete pyramids not in ``keep``, least recently used first, until ``need`` fits the budget and the disk's reserve."""
    pyramids = [(folder, folder_bytes(folder), (folder / 'pyramid.json').stat().st_mtime) for folder, _ in complete_pyramids(root)]
    used = sum(size for _, size, _ in pyramids)
    free = shutil.disk_usage(root).free
    deleted = []
    for folder, size, _ in sorted((item for item in pyramids if item[0].name not in keep), key=lambda item: item[2]):
        if used + need <= budget and free - need >= FREE_SPACE_RESERVE:
            break
        shutil.rmtree(folder)
        used, free = used - size, free + size
        deleted.append(folder.name)
    if used + need > budget or free - need < FREE_SPACE_RESERVE:
        raise MethodError('LIMIT_EXCEEDED', 'disk')
    return deleted


class LevelWriter:
    """Writes one level's tiles row by row and remembers their hashes."""

    def __init__(self, folder: Path, level: fmt.Level, channels: int, bits: int, compressor):
        self.folder, self.level, self.channels, self.bits, self.compressor = folder / str(level.level), level, channels, bits, compressor
        self.folder.mkdir()
        self.hashes = bytearray(level.rows * level.cols * 32)
        self.next_row = 0

    def write_band(self, band: np.ndarray) -> int:
        """Write tile row ``next_row`` from a band of at most 512 rows; returns the number of tiles written."""
        row, rows = self.next_row, band.shape[0]
        if row >= self.level.rows or rows > fmt.TILE or (row < self.level.rows - 1 and rows != fmt.TILE):
            raise RuntimeError('band out of order')
        for col in range(self.level.cols):
            tile = np.zeros((fmt.TILE, fmt.TILE, self.channels), band.dtype)
            part = band[:, col * fmt.TILE:(col + 1) * fmt.TILE]
            tile[:rows, :part.shape[1]] = part
            data = tile.tobytes()
            index = (row * self.level.cols + col) * 32
            self.hashes[index:index + 32] = hashlib.sha256(data).digest()
            (self.folder / fmt.tile_name(row, col)).write_bytes(zlib.compress(data, 1) if self.compressor else data)
        self.next_row += 1
        return self.level.cols

    def finish(self) -> None:
        if self.next_row != self.level.rows:
            raise RuntimeError('level not complete')
        (self.folder / '.tiles.sha256').write_bytes(bytes(self.hashes))
        fmt.write_json_atomically(self.folder / '.zarray', fmt.zarray(self.level, self.channels, self.bits, self.compressor))


def is_disk_full(error: OSError) -> bool:
    return error.errno in DISK_FULL or getattr(error, 'winerror', None) in WINDOWS_DISK_FULL


def build(path: Path, root: Path, *, name: str, budget: int, compressor=None, keep=(), cancelled=lambda: False, progress=lambda *_: None) -> dict:
    """Build (or reuse) the pyramid of ``path`` in ``root``. Returns ``{pyramid, width, height, channels, bits, levels, reused, disk_bytes}``.

    Raises ``Cancelled`` or ``MethodError``; in every failure the partial folder is removed."""
    path, root = Path(path), Path(root)
    if compressor not in (None, fmt.ZLIB):
        raise ValueError('unknown compressor')
    root.mkdir(parents=True, exist_ok=True)
    fmt.remove_partials(root)
    sha256, size = source_digest(path, cancelled, progress)
    final = root / sha256
    if final.is_dir():
        try:
            existing = fmt.read_description(final)
            if existing['source']['size'] == size:
                os.utime(final / 'pyramid.json')                       # the least-recently-used order of make_room
                return result(existing, reused=True, disk_bytes=folder_bytes(final))
        except fmt.InvalidPyramid:
            pass
        shutil.rmtree(final)                                           # not a complete pyramid of this version: build it again
    source = Source(path)
    info = source.info
    make_room(root, fmt.estimated_bytes(info.width, info.height, info.channels, info.bits), budget, set(keep) | {sha256})
    partial = root / f'{fmt.PARTIAL_PREFIX}{uuid.uuid4().hex}'
    partial.mkdir()
    try:
        levels = fmt.levels_for(info.width, info.height)
        fmt.write_json_atomically(partial / '.zgroup', {'zarr_format': 2})
        fmt.write_json_atomically(partial / '.zattrs', fmt.zattrs(levels))
        writers = [LevelWriter(partial, level, info.channels, info.bits, compressor) for level in levels]
        pending: list[list[np.ndarray]] = [[] for _ in levels]       # rows waiting to fill a band, per level >= 1
        written, total = 0, sum(level.rows * level.cols for level in levels)

        def push(k: int, band: np.ndarray) -> None:
            nonlocal written
            written += writers[k].write_band(band)
            if k + 1 < len(levels):
                pending[k + 1].append(halve(band))
                rows = sum(part.shape[0] for part in pending[k + 1])
                if rows >= fmt.TILE:                                   # bands of level k are 512 rows, so halves are 256: exactly two fill a band
                    joined, pending[k + 1] = np.concatenate(pending[k + 1]), []
                    push(k + 1, joined)

        for y0 in range(0, info.height, fmt.TILE):
            if cancelled():
                raise Cancelled()
            push(0, source.band(y0))
            progress('level0', min(y0 + fmt.TILE, info.height), info.height)
        for k in range(1, len(levels)):                                # the last, shorter band of each level
            if pending[k]:
                joined, pending[k] = np.concatenate(pending[k]), []
                push(k, joined)
            progress('levels', written, total)
        for writer in writers:
            writer.finish()
        value = fmt.description(sha256=sha256, size=size, name=name, width=info.width, height=info.height,
                                channels=info.channels, bits=info.bits, compressor=compressor)
        fmt.write_json_atomically(partial / 'pyramid.json', value)
        try:
            os.replace(partial, final)
        except OSError:
            if not final.is_dir():
                raise
            shutil.rmtree(partial, ignore_errors=True)                 # another build finished the same pyramid first
            value = fmt.read_description(final)
        return result(value, reused=False, disk_bytes=folder_bytes(final))
    except OSError as error:
        shutil.rmtree(partial, ignore_errors=True)
        if is_disk_full(error):
            raise MethodError('LIMIT_EXCEEDED', 'disk') from None
        raise
    except BaseException:
        shutil.rmtree(partial, ignore_errors=True)
        raise


def result(value: dict, *, reused: bool, disk_bytes: int) -> dict:
    return {'pyramid': value['source']['sha256'], 'width': value['width'], 'height': value['height'], 'channels': value['channels'],
            'bits': value['bits'], 'levels': len(value['levels']), 'reused': reused, 'disk_bytes': disk_bytes}
