"""Source images of the tile store, read in bands with libvips (contract §8.3).

A source is identified by its first bytes, never by its name, and opened only with the libvips loader of that format: TIFF (classic and
BigTIFF), JPEG or PNG. Everything else is refused, so none of libvips' other loaders ever sees a user file. Limits are checked on the
header before any pixel is read. Samples are returned as stored (no colour management, gamma or orientation), as ``app/js/tiff.js`` does.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from sedcoretool.methods.errors import MethodError

TILE = 512
MAX_WIDTH = 262_144
MAX_HEIGHT = 16_777_216
MAX_BAND_BYTES = 256 * 2**20            # one band of TILE rows of the source
MAX_DECODED_SEQUENTIAL = 2**30          # JPEG and PNG are decoded whole by their libraries; larger ones are refused (maintainer, 16 Nov 2026)
LIBVIPS_CACHE_BYTES = 64 * 2**20
LIBVIPS_CACHE_FILES = 16

SIGNATURES = (
    (b'II*\x00', 'tiff'), (b'MM\x00*', 'tiff'), (b'II+\x00', 'tiff'), (b'MM\x00+', 'tiff'),
    (b'\xff\xd8\xff', 'jpeg'),
    (b'\x89PNG\r\n\x1a\n', 'png'),
)
SAMPLE_TYPES = {'uchar': (8, np.dtype('u1')), 'ushort': (16, np.dtype('<u2'))}


def configure_libvips(threads: int) -> None:
    """Bound libvips' caches and thread pool (contract §8.4). Called once by the process that reads sources."""
    import pyvips

    pyvips.cache_set_max_mem(LIBVIPS_CACHE_BYTES)
    pyvips.cache_set_max_files(LIBVIPS_CACHE_FILES)
    pyvips.vips_lib.vips_concurrency_set(max(1, int(threads)))


def sniff(path: Path) -> str:
    """The format named by the file's first bytes: ``tiff``, ``jpeg`` or ``png``."""
    with Path(path).open('rb') as stream:
        head = stream.read(8)
    for signature, kind in SIGNATURES:
        if head.startswith(signature):
            return kind
    raise MethodError('UNSUPPORTED_INPUT', 'source')


@dataclass(frozen=True)
class SourceInfo:
    kind: str                 # tiff, jpeg or png
    width: int
    height: int
    channels: int             # 1, 3 or 4
    bits: int                 # 8 or 16

    @property
    def dtype(self) -> np.dtype:
        return np.dtype('u1') if self.bits == 8 else np.dtype('<u2')

    @property
    def band_bytes(self) -> int:
        return self.width * TILE * self.channels * (self.bits // 8)

    @property
    def decoded_bytes(self) -> int:
        return self.width * self.height * self.channels * (self.bits // 8)


class Source:
    """An opened source image. ``band(y0)`` returns rows ``y0 .. y0 + TILE`` (fewer at the bottom) as ``uint8``/``uint16[rows, width, channels]``.

    TIFF is opened for random access; JPEG and PNG sequentially, so their bands must be requested from the top down."""

    def __init__(self, path: Path):
        import pyvips

        if sys.byteorder != 'little':
            raise MethodError('UNSUPPORTED_INPUT', 'source')     # the store is little-endian; the program targets little-endian systems only
        self.path = Path(path)
        kind = sniff(self.path)
        self.sequential = kind != 'tiff'
        loader = {'tiff': pyvips.Image.tiffload, 'jpeg': pyvips.Image.jpegload, 'png': pyvips.Image.pngload}[kind]
        try:
            image = loader(str(self.path), access='sequential' if self.sequential else 'random', fail_on='error')
            width, height, bands, sample = image.width, image.height, image.bands, image.format
        except pyvips.Error:
            raise MethodError('UNSUPPORTED_INPUT', 'source') from None
        if sample not in SAMPLE_TYPES or bands not in (1, 3, 4):
            raise MethodError('UNSUPPORTED_INPUT', 'source')
        self.info = SourceInfo(kind, width, height, bands, SAMPLE_TYPES[sample][0])
        if not (0 < width <= MAX_WIDTH and 0 < height <= MAX_HEIGHT) or self.info.band_bytes > MAX_BAND_BYTES:
            raise MethodError('LIMIT_EXCEEDED', 'source.dimensions')
        if self.sequential and self.info.decoded_bytes > MAX_DECODED_SEQUENTIAL:
            raise MethodError('UNSUPPORTED_INPUT', 'source.size')   # the interface suggests TIFF
        self.image = image
        self.next_row = 0

    def band(self, y0: int) -> np.ndarray:
        import pyvips

        info = self.info
        if not (0 <= y0 < info.height) or y0 % TILE:
            raise ValueError('band start outside the image or not on a tile row')
        if self.sequential and y0 != self.next_row:
            raise ValueError('a sequential source is read from the top down')
        rows = min(TILE, info.height - y0)
        try:
            data = self.image.crop(0, y0, info.width, rows).write_to_memory()
        except pyvips.Error:
            raise MethodError('UNSUPPORTED_INPUT', 'source') from None   # a truncated or corrupt file
        if len(data) != rows * info.width * info.channels * (info.bits // 8):
            raise MethodError('UNSUPPORTED_INPUT', 'source')
        self.next_row = y0 + rows
        return np.frombuffer(data, dtype=info.dtype).reshape(rows, info.width, info.channels)
