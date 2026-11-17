"""Mask tiles and manifests of tiled sections (contract §8.7, card M8.4.16). Standard library only: the engine's coordinator imports it.

The masks of a tiled section are project data in ``<projects>/<project>/tiles/``: every mask tile (labels ``i32le`` or exclusion ``u8``,
512 x 512 samples) and every table (objects, classes, overlap stacks) is a *blob*, stored zlib-compressed under the SHA-256 of its
uncompressed bytes, and one *manifest* (canonical JSON, named by its own SHA-256) lists the blobs of one version of one section. All-zero
layers are not stored. Blobs and manifests are immutable and written through a temporary file that is flushed and renamed, so a stopped
engine leaves every earlier manifest readable. A blob or manifest is used only after its bytes have been checked against its name
(ARCHITECTURE §3.4 rule 3).
"""

from __future__ import annotations

import errno
import hashlib
import json
import os
import re
import zlib
from collections import OrderedDict
from pathlib import Path
from uuid import uuid4

FORMAT = 'sedcoretool.masks'
VERSION = 1
TILE = 512
SAMPLE_BYTES = {'labels': 4, 'exclude': 1}
LAYER_BYTES = {layer: TILE * TILE * item for layer, item in SAMPLE_BYTES.items()}
TABLES = ('objects', 'classes', 'stack_offsets', 'stack_members')
TABLE_DTYPES = {'objects': 'utf8json', 'classes': 'utf8json', 'stack_offsets': 'u32le', 'stack_members': 'u32le'}
REQUIRED_TABLES = ('objects', 'classes', 'stack_offsets')
MAX_METADATA_BYTES = 4 * 2**20
MAX_STACK_BYTES = 16 * 2**20
MAX_WIDTH = 262_144
MAX_HEIGHT = 16_777_216
MAX_POSITIONS = 262_144
MAX_MANIFEST_BYTES = 64 * 2**20
COMPRESSION_LEVEL = 1
BLOB_CACHE_BYTES = 64 * 2**20
HEX64 = re.compile('[0-9a-f]{64}')
PROJECT = re.compile('[a-z0-9_-]{1,64}')
SECTION = re.compile('[A-Za-z0-9_-]{1,64}')
POSITION_KEY = re.compile(r'(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})')
WINDOWS_DEVICES = {'con', 'prn', 'aux', 'nul', *(f'com{i}' for i in range(10)), *(f'lpt{i}' for i in range(10))}
ZEROS = bytes(LAYER_BYTES['labels'])
ZERO_LAYER = {layer: bytes(length) for layer, length in LAYER_BYTES.items()}


class MaskError(Exception):
    """A request or stored object the mask store refuses. ``code`` is one of the stable codes of contract §3, ``field`` names what was wrong."""

    def __init__(self, code: str, field: str):
        super().__init__(f'{code}: {field}')
        self.code = code
        self.field = field


def valid_project(project) -> bool:
    """A project identifier names a folder: lower case only (one folder on every file system) and never a Windows device name."""
    return isinstance(project, str) and PROJECT.fullmatch(project) is not None and project not in WINDOWS_DEVICES


def valid_section(section) -> bool:
    return isinstance(section, str) and SECTION.fullmatch(section) is not None


def grid(width: int, height: int) -> tuple[int, int]:
    """``(rows, cols)`` of the tile grid of a section, after checking its size (``MaskError`` otherwise)."""
    if type(width) is not int or not 1 <= width <= MAX_WIDTH:
        raise MaskError('INVALID_REQUEST', 'width')
    if type(height) is not int or not 1 <= height <= MAX_HEIGHT:
        raise MaskError('INVALID_REQUEST', 'height')
    rows, cols = -(-height // TILE), -(-width // TILE)
    if rows * cols > MAX_POSITIONS:
        raise MaskError('LIMIT_EXCEEDED', 'section.size')
    return rows, cols


def tile_is_empty(layer: str, row: int, col: int, data: bytes, width: int, height: int) -> bool:
    """Check one layer of one tile and say whether all its samples are zero.

    The bytes must have the layer's exact length, zeros outside the section (tiles on the right and bottom edges) and, for the exclusion
    layer, only the values 0 and 1. Raises ``MaskError('INVALID_BUFFER', 'tile')`` otherwise. The SHA-256 is checked by the caller."""
    item = SAMPLE_BYTES[layer]
    if len(data) != LAYER_BYTES[layer]:
        raise MaskError('INVALID_BUFFER', 'tile')
    if data == ZERO_LAYER[layer]:
        return True
    row_bytes = TILE * item
    inside_rows = min(TILE, height - row * TILE)
    inside_bytes = min(TILE, width - col * TILE) * item
    if inside_bytes < row_bytes:
        margin = ZEROS[:row_bytes - inside_bytes]
        for y in range(inside_rows):
            if data[y * row_bytes + inside_bytes:(y + 1) * row_bytes] != margin:
                raise MaskError('INVALID_BUFFER', 'tile')
    if inside_rows < TILE and data[inside_rows * row_bytes:] != ZEROS[:(TILE - inside_rows) * row_bytes]:
        raise MaskError('INVALID_BUFFER', 'tile')
    if layer == 'exclude' and data.translate(None, b'\x00\x01'):
        raise MaskError('INVALID_BUFFER', 'tile')
    return False


def table_length_ok(name: str, byte_length) -> bool:
    if type(byte_length) is not int:
        return False
    if TABLE_DTYPES[name] == 'utf8json':
        return 1 <= byte_length <= MAX_METADATA_BYTES
    minimum = 8 if name == 'stack_offsets' else 4
    return minimum <= byte_length <= MAX_STACK_BYTES and byte_length % 4 == 0


def canonical(manifest: dict) -> bytes:
    return json.dumps(manifest, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False).encode('ascii')


def _is_hash_or_none(value) -> bool:
    return value is None or (isinstance(value, str) and HEX64.fullmatch(value) is not None)


def check_manifest(value) -> dict[tuple[int, int], dict]:
    """Check a parsed manifest against every rule of contract §8.7; returns its tiles keyed by ``(row, col)``. Raises ``MaskError``."""
    def bad():
        return MaskError('INVALID_BUFFER', 'manifest')
    if not isinstance(value, dict) or set(value) != {'format', 'version', 'section', 'width', 'height', 'tile', 'tiles', 'tables'}:
        raise bad()
    if value['format'] != FORMAT or type(value['version']) is not int or value['version'] != VERSION or type(value['tile']) is not int \
            or value['tile'] != TILE or not valid_section(value['section']):
        raise bad()
    try:
        rows, cols = grid(value['width'], value['height'])
    except MaskError:
        raise bad() from None
    tiles, tables = value['tiles'], value['tables']
    if not isinstance(tiles, dict) or len(tiles) > rows * cols or not isinstance(tables, dict) or set(tables) != set(TABLES):
        raise bad()
    out = {}
    for key, entry in tiles.items():
        match = POSITION_KEY.fullmatch(key)
        if match is None or not isinstance(entry, dict) or set(entry) != {'labels', 'exclude'}:
            raise bad()
        row, col = int(match.group(1)), int(match.group(2))
        if not (row < rows and col < cols) or not all(_is_hash_or_none(entry[layer]) for layer in SAMPLE_BYTES) \
                or entry['labels'] is None and entry['exclude'] is None:
            raise bad()
        out[(row, col)] = entry
    for name in TABLES:
        table = tables[name]
        if table is None and name == 'stack_members':
            continue
        if not isinstance(table, dict) or set(table) != {'sha256', 'byte_length'} or not isinstance(table['sha256'], str) \
                or not HEX64.fullmatch(table['sha256']) or not table_length_ok(name, table['byte_length']):
            raise bad()
    return out


def _reject_constant(_name):
    raise ValueError('not JSON of the manifest format')


def parse_manifest(data: bytes, name: str) -> tuple[dict, dict[tuple[int, int], dict]]:
    """``(manifest, tiles)`` of a manifest file's bytes named ``name``; the bytes must hash to the name and be the canonical form."""
    if len(data) > MAX_MANIFEST_BYTES or hashlib.sha256(data).hexdigest() != name:
        raise MaskError('INVALID_BUFFER', 'manifest')
    try:
        value = json.loads(data.decode('ascii'), parse_constant=_reject_constant)
    except (UnicodeDecodeError, ValueError, RecursionError):
        raise MaskError('INVALID_BUFFER', 'manifest') from None
    tiles = check_manifest(value)
    if canonical(value) != data:                     # also refuses duplicate keys, which the parser would have merged
        raise MaskError('INVALID_BUFFER', 'manifest')
    return value, tiles


class BlobCache:
    """Verified, uncompressed blobs by ``(folder, sha256)``, least recently used first out, within a byte budget."""

    def __init__(self, budget: int = BLOB_CACHE_BYTES):
        self.budget = budget
        self.items: OrderedDict[tuple, bytes] = OrderedDict()
        self.size = 0

    def get(self, key):
        data = self.items.get(key)
        if data is not None:
            self.items.move_to_end(key)
        return data

    def put(self, key, data: bytes) -> None:
        if len(data) > self.budget or key in self.items:
            return
        self.items[key] = data
        self.size += len(data)
        while self.size > self.budget:
            _, dropped = self.items.popitem(last=False)
            self.size -= len(dropped)


def _write_durably(path: Path, data: bytes) -> None:
    """Temporary file in the same folder, flushed to the disk, then renamed over ``path``: a reader sees the old file or the whole new one."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f'{path.name}.{uuid4().hex}.tmp')
    try:
        with temporary.open('xb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise


class MaskStore:
    """The mask store of one project: ``<projects>/<project>/tiles/``. Only the engine writes it."""

    def __init__(self, folder: Path, cache: BlobCache | None = None):
        self.folder = Path(folder)
        self.cache = cache if cache is not None else BlobCache()
        self.manifests: OrderedDict[str, tuple[dict, dict]] = OrderedDict()

    def blob_path(self, sha256: str) -> Path:
        return self.folder / 'blobs' / sha256[:2] / sha256

    def manifest_path(self, sha256: str) -> Path:
        return self.folder / 'manifests' / f'{sha256}.json'

    def read_blob(self, sha256: str, length: int, field: str) -> bytes:
        """The verified, uncompressed bytes of a blob of ``length`` bytes; ``MaskError('INVALID_BUFFER', field)`` if anything differs."""
        key = (self.folder, sha256)
        data = self.cache.get(key)
        if data is not None and len(data) == length:
            return data
        path = self.blob_path(sha256)
        try:
            if path.is_symlink() or path.stat().st_size > length + length // 100 + 1024:   # more than zlib can need: not ours
                raise MaskError('INVALID_BUFFER', field)
            raw = path.read_bytes()
            inflater = zlib.decompressobj()
            data = inflater.decompress(raw, length + 1)
        except (OSError, zlib.error):
            raise MaskError('INVALID_BUFFER', field) from None
        if len(data) != length or not inflater.eof or inflater.unused_data or inflater.unconsumed_tail \
                or hashlib.sha256(data).hexdigest() != sha256:
            raise MaskError('INVALID_BUFFER', field)
        self.cache.put(key, data)
        return data

    def write_blob(self, data: bytes, sha256: str, field: str) -> None:
        """Store ``data`` (whose SHA-256 the caller has checked) unless a valid blob with that name is already there."""
        try:
            self.read_blob(sha256, len(data), field)
            return
        except MaskError:
            pass                                        # missing, or damaged by an earlier failure: written again
        _write_durably(self.blob_path(sha256), zlib.compress(data, COMPRESSION_LEVEL))
        self.cache.put((self.folder, sha256), data)

    def read_manifest(self, sha256: str) -> tuple[dict, dict[tuple[int, int], dict]]:
        """``(manifest, tiles)`` of a stored manifest. Missing: ``MaskError('INVALID_REQUEST', 'manifest')``; damaged: ``INVALID_BUFFER``."""
        if not isinstance(sha256, str) or not HEX64.fullmatch(sha256):
            raise MaskError('INVALID_REQUEST', 'manifest')
        if sha256 in self.manifests:
            self.manifests.move_to_end(sha256)
            return self.manifests[sha256]
        path = self.manifest_path(sha256)
        try:
            if path.is_symlink() or path.stat().st_size > MAX_MANIFEST_BYTES:
                raise MaskError('INVALID_BUFFER', 'manifest')
            data = path.read_bytes()
        except FileNotFoundError:
            raise MaskError('INVALID_REQUEST', 'manifest') from None
        except OSError:
            raise MaskError('INVALID_BUFFER', 'manifest') from None
        parsed = parse_manifest(data, sha256)
        self.manifests[sha256] = parsed
        while len(self.manifests) > 8:
            self.manifests.popitem(last=False)
        return parsed

    def write_manifest(self, manifest: dict) -> str:
        data = canonical(manifest)
        name = hashlib.sha256(data).hexdigest()
        parse_manifest(data, name)                      # never write a file that a reader would refuse
        path = self.manifest_path(name)
        try:
            if path.read_bytes() == data:
                return name
        except OSError:
            pass
        _write_durably(path, data)
        return name

    def read_tile(self, manifest: str, layer: str, row: int, col: int) -> bytes | None:
        """The verified bytes of one layer of one tile of a stored version, or None when that layer is empty there."""
        _, tiles = self.read_manifest(manifest)
        entry = tiles.get((row, col))
        sha256 = entry[layer] if entry else None
        return None if sha256 is None else self.read_blob(sha256, LAYER_BYTES[layer], 'tile')


class Staging:
    """A version of one section's masks in preparation: a copy of a base version (or of empty masks) that ``put`` changes tile by tile and
    ``commit`` writes as a new manifest. It lives only in memory; nothing it holds is a manifest until ``commit`` has returned."""

    def __init__(self, store: MaskStore, section, width, height, base):
        if not valid_section(section):
            raise MaskError('INVALID_REQUEST', 'section')
        self.rows, self.cols = grid(width, height)
        self.store, self.section, self.width, self.height = store, section, width, height
        self.tables = None
        self.tiles: dict[tuple[int, int], dict] = {}
        if base is not None:
            manifest, tiles = store.read_manifest(base)
            if (manifest['section'], manifest['width'], manifest['height']) != (section, width, height):
                raise MaskError('INVALID_REQUEST', 'base')
            self.tiles = {position: dict(entry) for position, entry in tiles.items()}
            self.tables = dict(manifest['tables'])

    def put(self, layer, row, col, sha256, data: bytes) -> bool:
        """Replace one layer of one tile; returns whether it is stored (False: all zeros, no entry). The staging is unchanged on error."""
        if layer not in SAMPLE_BYTES:
            raise MaskError('INVALID_REQUEST', 'layer')
        if type(row) is not int or not 0 <= row < self.rows:
            raise MaskError('INVALID_REQUEST', 'row')
        if type(col) is not int or not 0 <= col < self.cols:
            raise MaskError('INVALID_REQUEST', 'col')
        if not isinstance(sha256, str) or not HEX64.fullmatch(sha256):
            raise MaskError('INVALID_REQUEST', 'sha256')
        if not isinstance(data, (bytes, bytearray)) or len(data) != LAYER_BYTES[layer] or hashlib.sha256(data).hexdigest() != sha256:
            raise MaskError('INVALID_BUFFER', 'tile')
        data = bytes(data)
        empty = tile_is_empty(layer, row, col, data, self.width, self.height)
        if not empty:
            write_or_disk_error(self.store.write_blob, data, sha256, 'tile')
        entry = dict(self.tiles.get((row, col)) or {'labels': None, 'exclude': None})
        entry[layer] = None if empty else sha256
        if entry['labels'] is None and entry['exclude'] is None:
            self.tiles.pop((row, col), None)
        else:
            self.tiles[(row, col)] = entry
        return not empty

    def commit(self, tables: dict) -> str:
        """Write the given tables (``name -> bytes``, or None for ``stack_members`` only), then the manifest; returns its SHA-256.
        A table left out keeps the base's; without a base, objects, classes and stack offsets are required."""
        merged = dict(self.tables) if self.tables else {'stack_members': None}
        for name, data in tables.items():
            if name not in TABLES or (data is None and name != 'stack_members'):
                raise MaskError('INVALID_REQUEST', f'tables.{name}' if name in TABLES else 'tables')
            if data is None:
                merged[name] = None
                continue
            if not table_length_ok(name, len(data)):
                limit = MAX_METADATA_BYTES if TABLE_DTYPES[name] == 'utf8json' else MAX_STACK_BYTES
                raise MaskError('LIMIT_EXCEEDED' if len(data) > limit else 'INVALID_BUFFER', f'tables.{name}')
            sha256 = hashlib.sha256(data).hexdigest()
            write_or_disk_error(self.store.write_blob, bytes(data), sha256, 'table')
            merged[name] = {'sha256': sha256, 'byte_length': len(data)}
        for name in REQUIRED_TABLES:
            if name not in merged:
                raise MaskError('INVALID_REQUEST', f'tables.{name}')
        manifest = {'format': FORMAT, 'version': VERSION, 'section': self.section, 'width': self.width, 'height': self.height, 'tile': TILE,
                    'tiles': {f'{row}.{col}': entry for (row, col), entry in sorted(self.tiles.items())},
                    'tables': {name: merged[name] for name in TABLES}}
        return write_or_disk_error(self.store.write_manifest, manifest)


def write_or_disk_error(write, *arguments):
    """Run a store write; a full disk is ``MaskError('LIMIT_EXCEEDED', 'disk')`` (contract §8.4), any other failure stays an ``OSError``."""
    try:
        return write(*arguments)
    except OSError as error:
        if error.errno in (errno.ENOSPC, getattr(errno, 'EDQUOT', errno.ENOSPC)):
            raise MaskError('LIMIT_EXCEEDED', 'disk') from None
        raise
