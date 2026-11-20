"""Mask tiles and manifests of tiled sections (contract §8.7, card M8.4.16). Standard library only: the engine's coordinator imports it.

The masks of a tiled section are project data in ``<projects>/<project>/tiles/``: every mask tile (labels ``i32le`` or exclusion ``u8``,
512 x 512 samples) and every table (objects, classes, overlap stacks) is a *blob*, stored zlib-compressed under the SHA-256 of its
uncompressed bytes, and one *manifest* (canonical JSON, named by its own SHA-256) lists the blobs of one version of one section. The objects
are four binary columns (card M8.4.22: up to 2^20 objects), checked against each other and the classes table when they are committed. All-zero
layers are not stored. Blobs and manifests are immutable and written through a temporary file that is flushed and renamed, so a stopped
engine leaves every earlier manifest readable. A blob or manifest is used only after its bytes have been checked against its name
(ARCHITECTURE §3.4 rule 3).
"""

from __future__ import annotations

import errno
import hashlib
import json
import math
import os
import re
import sys
import zlib
from array import array
from collections import OrderedDict
from pathlib import Path
from uuid import uuid4

FORMAT = 'sedcoretool.masks'
VERSION = 2                                     # 1 (utf8json objects table) is refused: no project named a version 1 manifest (card M8.4.22)
TILE = 512
SAMPLE_BYTES = {'labels': 4, 'exclude': 1}
LAYER_BYTES = {layer: TILE * TILE * item for layer, item in SAMPLE_BYTES.items()}
OBJECT_COLUMNS = ('object_ids', 'object_class', 'object_predicted', 'object_confidence')
TABLES = (*OBJECT_COLUMNS, 'classes', 'stack_offsets', 'stack_members')
TABLE_DTYPES = {'object_ids': 'u32le', 'object_class': 'i32le', 'object_predicted': 'i32le', 'object_confidence': 'f64le',
                'classes': 'utf8json', 'stack_offsets': 'u32le', 'stack_members': 'u32le'}
ITEM_BYTES = {'u32le': 4, 'i32le': 4, 'f64le': 8, 'utf8json': 1}
NULLABLE_TABLES = (*OBJECT_COLUMNS, 'stack_members')   # the object columns together (no objects), stack_members alone (no overlap)
REQUIRED_TABLES = (*OBJECT_COLUMNS, 'classes', 'stack_offsets')
MAX_OBJECTS = 2**20
MAX_METADATA_BYTES = 4 * 2**20
MAX_STACK_BYTES = 16 * 2**20
TABLE_LIMITS = {**{name: MAX_OBJECTS * ITEM_BYTES[TABLE_DTYPES[name]] for name in OBJECT_COLUMNS}, 'classes': MAX_METADATA_BYTES,
                'stack_offsets': MAX_STACK_BYTES, 'stack_members': MAX_STACK_BYTES}
MAX_OBJECT_ID = 2**31 - 1                        # a positive label (i32)
MAX_WIDTH = 262_144
MAX_HEIGHT = 16_777_216
MAX_POSITIONS = 262_144
MAX_MANIFEST_BYTES = 64 * 2**20
MAX_RETAINED = 1024                             # manifests one `mask.retain` may keep (card M8.4.18a)
INFO_PAGE = 2048                                # tile positions per `mask.info` answer (the JSON of an answer stays far below 64 KiB)
COPY_PAGE = 32                                  # tiles per `mask.copy` answer (card M8.4.27): at most 40 MiB read, verified and written
DERIVED_KINDS = ('reopen',)                     # card M8.4.29: what the page derived from a stored version (decision G); a cache, never project data
MAX_DERIVED_BYTES = 128 * 2**20                 # uncompressed; the page's limit is stated in the card before measuring, then recorded against the measurement
DERIVED_NAME = re.compile(r'([0-9a-f]{64})\.([a-z]{1,16})')
COMPRESSION_LEVEL = 1
EXPORT_PAGE = 32                                # blobs per `mask.export` or `mask.import` (card M8.4.18c: folder backup and restore)
BLOB_CACHE_BYTES = 64 * 2**20
HEX64 = re.compile('[0-9a-f]{64}')
PROJECT = re.compile('[a-z0-9_-]{1,64}')
SECTION = re.compile('[A-Za-z0-9_-]{1,64}')
POSITION_KEY = re.compile(r'(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})')
WINDOWS_DEVICES = {'con', 'prn', 'aux', 'nul', *(f'com{i}' for i in range(10)), *(f'lpt{i}' for i in range(10))}
ZEROS = bytes(LAYER_BYTES['labels'])
MAX_BLOB_BYTES = max(*LAYER_BYTES.values(), *TABLE_LIMITS.values())   # the largest uncompressed blob: a stack table of 16 MiB
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
    item = ITEM_BYTES[TABLE_DTYPES[name]]
    minimum = 8 if name == 'stack_offsets' else item
    return minimum <= byte_length <= TABLE_LIMITS[name] and byte_length % item == 0


def _column(name: str, data: bytes) -> array:
    values = array({'u32le': 'I', 'i32le': 'i', 'f64le': 'd'}[TABLE_DTYPES[name]])
    if values.itemsize != ITEM_BYTES[TABLE_DTYPES[name]]:      # never on the supported platforms; refuse rather than misread
        raise MaskError('INTERNAL', name)
    values.frombytes(data)
    if sys.byteorder == 'big':
        values.byteswap()
    return values


def check_objects(columns: dict, classes: bytes) -> None:
    """Check the object columns against each other and the classes table (contract §8.7); ``MaskError`` with the column's name otherwise.
    ``columns`` maps every name of ``OBJECT_COLUMNS`` to bytes, or every one to None (no objects)."""
    try:
        records = json.loads(classes.decode('utf-8'), parse_constant=_reject_constant)
    except (UnicodeDecodeError, ValueError, RecursionError):
        raise MaskError('INVALID_BUFFER', 'tables.classes') from None
    if not isinstance(records, list):
        raise MaskError('INVALID_BUFFER', 'tables.classes')
    present = [columns[name] is not None for name in OBJECT_COLUMNS]
    if not any(present):
        return
    if not all(present):
        raise MaskError('INVALID_REQUEST', 'tables.' + OBJECT_COLUMNS[present.index(False)])
    counts = {name: len(columns[name]) // ITEM_BYTES[TABLE_DTYPES[name]] for name in OBJECT_COLUMNS}
    if counts['object_ids'] > MAX_OBJECTS:
        raise MaskError('LIMIT_EXCEEDED', 'tables.object_ids')
    for name in OBJECT_COLUMNS[1:]:
        if counts[name] != counts['object_ids']:
            raise MaskError('INVALID_BUFFER', f'tables.{name}')
    ids = _column('object_ids', columns['object_ids'])
    if min(ids) < 1 or max(ids) > MAX_OBJECT_ID or len(set(ids)) != len(ids):
        raise MaskError('INVALID_BUFFER', 'tables.object_ids')
    for name in ('object_class', 'object_predicted'):
        values = _column(name, columns[name])
        if min(values) < -1 or max(values) >= len(records):
            raise MaskError('INVALID_BUFFER', f'tables.{name}')
    if not all(math.isfinite(c) and 0 <= c <= 1 for c in _column('object_confidence', columns['object_confidence'])):
        raise MaskError('INVALID_BUFFER', 'tables.object_confidence')


def canonical(manifest: dict) -> bytes:
    return json.dumps(manifest, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False).encode('ascii')


def _is_hash_or_none(value) -> bool:
    return value is None or (isinstance(value, str) and HEX64.fullmatch(value) is not None)


def check_manifest(value) -> dict[tuple[int, int], dict]:
    """Check a parsed manifest against every rule of contract §8.7; returns its tiles keyed by ``(row, col)``. Raises ``MaskError``."""
    def bad():
        return MaskError('INVALID_BUFFER', 'manifest')
    if isinstance(value, dict) and value.get('format') == FORMAT and type(value.get('version')) is int and value['version'] < VERSION:
        raise MaskError('UNSUPPORTED_INPUT', 'manifest.version')       # version 1: objects as JSON, never named by a project (card M8.4.22)
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
        if table is None and name in NULLABLE_TABLES:
            continue
        if not isinstance(table, dict) or set(table) != {'sha256', 'byte_length'} or not isinstance(table['sha256'], str) \
                or not HEX64.fullmatch(table['sha256']) or not table_length_ok(name, table['byte_length']):
            raise bad()
    columns = [tables[name] for name in OBJECT_COLUMNS]
    if any(column is None for column in columns):
        if any(column is not None for column in columns):
            raise bad()
    elif len({column['byte_length'] // ITEM_BYTES[TABLE_DTYPES[name]] for column, name in zip(columns, OBJECT_COLUMNS)}) != 1:
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


def inflate_blob(raw: bytes, sha256: str, length: int | None, field: str) -> bytes:
    """The uncompressed bytes of the zlib stream ``raw``: exactly ``length`` bytes (at most ``MAX_BLOB_BYTES`` when ``length`` is None), one whole
    stream with nothing after it, hashing to ``sha256``; otherwise ``MaskError('INVALID_BUFFER', field)``."""
    bound = MAX_BLOB_BYTES if length is None else length
    try:
        inflater = zlib.decompressobj()
        data = inflater.decompress(raw, bound + 1)
    except zlib.error:
        raise MaskError('INVALID_BUFFER', field) from None
    if (len(data) != length if length is not None else not 0 < len(data) <= bound) or not inflater.eof or inflater.unused_data \
            or inflater.unconsumed_tail or hashlib.sha256(data).hexdigest() != sha256:
        raise MaskError('INVALID_BUFFER', field)
    return data


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
        data = inflate_blob(self._raw_blob(sha256, length, field), sha256, length, field)
        self.cache.put(key, data)
        return data

    def _raw_blob(self, sha256: str, length: int, field: str) -> bytes:
        """The file of a blob as it is on disk (not verified here)."""
        path = self.blob_path(sha256)
        try:
            if path.is_symlink() or path.stat().st_size > length + length // 100 + 1024:   # more than zlib can need: not ours
                raise MaskError('INVALID_BUFFER', field)
            return path.read_bytes()
        except OSError:
            raise MaskError('INVALID_BUFFER', field) from None

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

    def derived_path(self, manifest: str, kind: str) -> Path:
        return self.folder / 'derived' / f'{manifest}.{kind}'

    def put_derived(self, manifest: str, kind: str, data: bytes) -> int:
        """Store ``data`` as the derived file ``kind`` of a stored manifest (card M8.4.29), replacing one that is there. The bytes are not read.
        Returns their length. An unknown kind or a manifest that is not stored is ``INVALID_REQUEST``, too many bytes ``LIMIT_EXCEEDED``."""
        if kind not in DERIVED_KINDS:
            raise MaskError('INVALID_REQUEST', 'kind')
        if not 1 <= len(data) <= MAX_DERIVED_BYTES:
            raise MaskError('LIMIT_EXCEEDED' if len(data) > MAX_DERIVED_BYTES else 'INVALID_BUFFER', 'derived')
        self.read_manifest(manifest)                     # raises for a manifest that is not stored or is damaged
        _write_durably(self.derived_path(manifest, kind), zlib.compress(data, COMPRESSION_LEVEL))
        return len(data)

    def get_derived(self, manifest: str, kind: str) -> bytes | None:
        """The bytes of a derived file, or None when there is none. A file that does not decompress to a whole stream of at most
        ``MAX_DERIVED_BYTES`` is ``MaskError('INVALID_BUFFER', 'derived')``. The manifest need not be readable: the file is a cache."""
        if kind not in DERIVED_KINDS or not isinstance(manifest, str) or not HEX64.fullmatch(manifest):
            raise MaskError('INVALID_REQUEST', 'kind' if kind not in DERIVED_KINDS else 'manifest')
        path = self.derived_path(manifest, kind)
        try:
            if path.is_symlink():
                raise MaskError('INVALID_BUFFER', 'derived')
            if not path.is_file():
                return None
            if path.stat().st_size > MAX_DERIVED_BYTES + MAX_DERIVED_BYTES // 100 + 1024:
                raise MaskError('INVALID_BUFFER', 'derived')
            raw = path.read_bytes()
            inflater = zlib.decompressobj()
            data = inflater.decompress(raw, MAX_DERIVED_BYTES + 1)
        except (OSError, zlib.error):
            raise MaskError('INVALID_BUFFER', 'derived') from None
        if not data or len(data) > MAX_DERIVED_BYTES or not inflater.eof or inflater.unused_data or inflater.unconsumed_tail:
            raise MaskError('INVALID_BUFFER', 'derived')
        return data

    def blob_lengths(self, sha256: str) -> dict[str, tuple[int, str]]:
        """Every blob a stored manifest names, with its uncompressed length and the field an error names (``tile`` or ``tables.<name>``)."""
        manifest, tiles = self.read_manifest(sha256)
        named = {name: (LAYER_BYTES[layer], 'tile') for entry in tiles.values() for layer in SAMPLE_BYTES if (name := entry[layer])}
        named.update({table['sha256']: (table['byte_length'], f'tables.{key}') for key, table in manifest['tables'].items() if table})
        return named

    def export_manifest(self, sha256: str) -> bytes:
        """The file of a stored manifest, checked (card M8.4.18c): its bytes are its canonical form and hash to its name."""
        manifest, _ = self.read_manifest(sha256)
        return canonical(manifest)

    def export_blobs(self, sha256: str, names) -> list[bytes]:
        """The files of 1 to ``EXPORT_PAGE`` blobs that the stored manifest ``sha256`` names, exactly as stored (zlib streams), each checked
        to decompress to bytes with its name's hash before it is returned (card M8.4.18c). A name the manifest does not use is
        ``INVALID_REQUEST`` (``blobs``); a damaged blob ``INVALID_BUFFER`` with its field."""
        named = self.blob_lengths(sha256)
        if not isinstance(names, list) or not 1 <= len(names) <= EXPORT_PAGE or not all(isinstance(name, str) and name in named for name in names):
            raise MaskError('INVALID_REQUEST', 'blobs')
        files = []
        for name in names:
            length, field = named[name]
            raw = self._raw_blob(name, length, field)
            inflate_blob(raw, name, length, field)
            files.append(raw)
        return files

    def import_blobs(self, files) -> list[bool]:
        """Store blobs given as ``(name, zlib stream)`` pairs, from a backup (card M8.4.18c). Each is accepted only if it decompresses, within
        ``MAX_BLOB_BYTES``, to one whole stream whose SHA-256 is its name; returns, in order, whether each was accepted (a refused one is not
        written, and does not stop the others)."""
        accepted = []
        for name, raw in files:
            try:
                if not (isinstance(name, str) and HEX64.fullmatch(name)) or len(raw) > MAX_BLOB_BYTES + MAX_BLOB_BYTES // 100 + 1024:
                    raise MaskError('INVALID_BUFFER', 'blob')
                data = inflate_blob(raw, name, None, 'blob')
            except MaskError:
                accepted.append(False)
                continue
            self.write_blob(data, name, 'blob')
            accepted.append(True)
        return accepted

    def import_manifest(self, sha256: str, data: bytes) -> str:
        """Store a manifest file from a backup (card M8.4.18c): it must pass every check of a stored one, and every blob it names must already be
        in this store (else ``INVALID_REQUEST``, ``blobs``, and nothing is written). Written last, so a restore stopped half-way leaves only
        blobs that no manifest names."""
        if not isinstance(sha256, str) or not HEX64.fullmatch(sha256):
            raise MaskError('INVALID_REQUEST', 'manifest')
        manifest, tiles = parse_manifest(data, sha256)
        names = {name for entry in tiles.values() for name in (entry['labels'], entry['exclude']) if name}
        names.update(table['sha256'] for table in manifest['tables'].values() if table)
        if not all(self.blob_path(name).is_file() and not self.blob_path(name).is_symlink() for name in names):
            raise MaskError('INVALID_REQUEST', 'blobs')
        if self.write_manifest(manifest) != sha256:
            raise MaskError('INTERNAL', 'manifest')
        return sha256

    def blobs_of(self, sha256: str) -> set[str]:
        """Every blob a stored manifest names: its tiles' layers and its tables."""
        manifest, tiles = self.read_manifest(sha256)
        used = {name for entry in tiles.values() for name in (entry['labels'], entry['exclude']) if name}
        used.update(table['sha256'] for table in manifest['tables'].values() if table)
        return used

    def retain(self, keep, protected: set[str], recent=()) -> dict:
        """Delete every manifest not in ``keep`` and then every blob that no kept manifest names and ``protected`` (the blobs of open
        staged versions) does not hold (card M8.4.18a). Every kept manifest must be readable, or nothing is deleted. ``recent`` are manifests
        committed in this session after those the request names (card M8.4.31): kept too, with their blobs, when they are still on disk.
        Manifests go first, so a stop half-way leaves only unreferenced blobs behind, never a manifest without its blobs. Returns the counts
        removed."""
        if not isinstance(keep, list) or len(keep) > MAX_RETAINED or not all(isinstance(name, str) and HEX64.fullmatch(name) for name in keep):
            raise MaskError('INVALID_REQUEST', 'keep')
        used = set(protected)
        for name in keep:
            try:
                used |= self.blobs_of(name)
            except MaskError as error:
                raise MaskError(error.code, 'keep') from None
        kept = set(keep)
        for name in recent:
            try:
                used |= self.blobs_of(name)
            except MaskError:
                continue                                                  # gone already (the folder was forgotten): nothing to protect
            kept.add(name)
        removed = {'manifests': 0, 'blobs': 0}
        for path in sorted((self.folder / 'manifests').glob('*.json')):
            name = path.name[:-len('.json')]
            if HEX64.fullmatch(name) and name not in kept and not path.is_symlink():
                path.unlink(missing_ok=True)
                self.manifests.pop(name, None)
                removed['manifests'] += 1
        for path in sorted((self.folder / 'derived').glob('*')):                    # card M8.4.29: a derived file goes with its manifest
            match = DERIVED_NAME.fullmatch(path.name)
            if path.is_symlink():
                continue
            if (match and match.group(2) in DERIVED_KINDS and match.group(1) not in kept) or path.name.endswith('.tmp'):
                path.unlink(missing_ok=True)                                         # also a temporary file a stop left half-way
        for path in sorted((self.folder / 'blobs').glob('*/*')):
            name = path.name
            if HEX64.fullmatch(name) and path.parent.name == name[:2] and name not in used and not path.is_symlink():
                path.unlink(missing_ok=True)
                self.cache.items.pop((self.folder, name), None)          # a cached copy would make `write_blob` skip a file that is gone
                removed['blobs'] += 1
        self.cache.size = sum(len(data) for data in self.cache.items.values())
        return removed

    def copy_from(self, source: 'MaskStore', sha256: str, start: int) -> dict:
        """Copy a stored manifest of ``source`` into this store, ``COPY_PAGE`` tiles per call, in the manifest's order (card M8.4.27): each blob
        is read and verified from ``source`` and written here unless a valid one is already here; the tables go with the first page. The
        manifest is written last, and only when every blob it names is here, so a copy stopped half-way leaves only blobs no manifest names
        (``retain`` removes them). Returns ``{'next': start of the next page or None, 'tiles': number of tiles}``."""
        if source.folder == self.folder:
            raise MaskError('INVALID_REQUEST', 'to')
        manifest, tiles = source.read_manifest(sha256)
        if type(start) is not int or not 0 <= start <= len(tiles):
            raise MaskError('INVALID_REQUEST', 'start')
        if start == 0:
            for name, table in manifest['tables'].items():
                if table:
                    self.write_blob(source.read_blob(table['sha256'], table['byte_length'], f'tables.{name}'), table['sha256'], f'tables.{name}')
        entries = list(tiles.values())[start:start + COPY_PAGE]
        for entry in entries:
            for layer, length in LAYER_BYTES.items():
                if entry[layer]:
                    self.write_blob(source.read_blob(entry[layer], length, 'tile'), entry[layer], 'tile')
        end = start + len(entries)
        if end < len(tiles):
            return {'next': end, 'tiles': len(tiles)}
        if not all(self.blob_path(name).is_file() for name in source.blobs_of(sha256)):
            raise MaskError('INVALID_REQUEST', 'start')                # a page was skipped: the copy is not complete
        if self.write_manifest(manifest) != sha256:
            raise MaskError('INTERNAL', 'manifest')
        return {'next': None, 'tiles': len(tiles)}

    def forget(self) -> None:
        """Drop what this store keeps in memory (card M8.4.27: its folder is about to be deleted)."""
        self.manifests.clear()
        for key in [key for key in self.cache.items if key[0] == self.folder]:
            self.cache.items.pop(key)
        self.cache.size = sum(len(data) for data in self.cache.items.values())

    def info(self, sha256: str, start: int) -> dict:
        """One page of the tile positions of a stored manifest, in its order: ``[row, col, layers, ...]`` with layers 1 = labels, 2 =
        exclusion (card M8.4.18a: a reopened section learns which tiles it must read back)."""
        manifest, tiles = self.read_manifest(sha256)
        if type(start) is not int or start < 0:
            raise MaskError('INVALID_REQUEST', 'start')
        entries = list(tiles.items())[start:start + INFO_PAGE]
        positions = [value for (row, col), entry in entries for value in (row, col, (1 if entry['labels'] else 0) | (2 if entry['exclude'] else 0))]
        end = start + len(entries)
        return {'section': manifest['section'], 'width': manifest['width'], 'height': manifest['height'], 'tiles': len(tiles),
                'positions': positions, 'next': end if end < len(tiles) else None}

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
        """Write the given tables (``name -> bytes``, or None for a nullable table), then the manifest; returns its SHA-256.
        A table left out keeps the base's. The four object columns and ``classes`` are given together or not at all, and are checked against
        each other before anything is written; without a base they, and ``stack_offsets``, are required."""
        merged = dict(self.tables) if self.tables else {'stack_members': None}
        for name, data in tables.items():
            if name not in TABLES or (data is None and name not in NULLABLE_TABLES):
                raise MaskError('INVALID_REQUEST', f'tables.{name}' if name in TABLES else 'tables')
            if data is not None and not table_length_ok(name, len(data)):
                raise MaskError('LIMIT_EXCEEDED' if len(data) > TABLE_LIMITS[name] else 'INVALID_BUFFER', f'tables.{name}')
        objects = [name for name in (*OBJECT_COLUMNS, 'classes') if name in tables]
        if objects:
            if len(objects) != len(OBJECT_COLUMNS) + 1:
                missing = next(name for name in (*OBJECT_COLUMNS, 'classes') if name not in tables)
                raise MaskError('INVALID_REQUEST', f'tables.{missing}')
            check_objects({name: tables[name] for name in OBJECT_COLUMNS}, tables['classes'])
        for name, data in tables.items():
            if data is None:
                merged[name] = None
                continue
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
