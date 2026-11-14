"""Session-scoped staged buffers with checked admission and immutable commit."""

import hashlib
import math
import os
import re
import shutil
import struct
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

if __package__:
    from .protocol import MAX_CHUNK, MAX_METADATA, ProtocolError, RequestError, require_fields, require_integer, strict_json
else:
    from protocol import MAX_CHUNK, MAX_METADATA, ProtocolError, RequestError, require_fields, require_integer, strict_json

MAX_BUFFER = 256 * MAX_CHUNK
MAX_HANDLES = 256     # live buffers: a page keeps the inputs of up to 16 sections (9 buffers each) between analyses (card M8.4.2)
SESSION_BUDGET = 512 * MAX_CHUNK
TRANSIENT_RESERVE = 16 * MAX_CHUNK
ITEM_BYTES = {'u8': 1, 'i32le': 4, 'u32le': 4, 'u64le': 8, 'f64le': 8, 'utf8json': 1}


@dataclass
class StagedBuffer:
    path: Path
    dtype: str
    length: int
    expected_hash: str
    charge: int
    received: int = 0
    committed: bool = False
    pins: int = 0
    released: bool = False
    shape: tuple = ()
    derived: bool = False       # starts as a copy of a committed buffer; chunks may come at any ascending offsets
    written: int = 0            # derived buffers: the end of the last chunk


class BufferStore:
    def __init__(self, *, budget=SESSION_BUDGET, scratch_directory=None):
        self.directory = TemporaryDirectory(prefix='sedcoretool-engine-', dir=scratch_directory)
        self.buffers = {}
        self.budget = budget
        self.reserved = TRANSIENT_RESERVE

    def begin(self, payload):
        require_fields(payload, ('dtype', 'shape', 'byte_length', 'sha256'))
        if len(self.buffers) >= MAX_HANDLES:
            raise RequestError('LIMIT_EXCEEDED')
        dtype, shape = payload['dtype'], payload['shape']
        if not isinstance(dtype, str) or dtype not in ITEM_BYTES:
            raise RequestError('INVALID_BUFFER', 'dtype')
        if not isinstance(shape, list) or not 1 <= len(shape) <= 3:
            raise RequestError('INVALID_BUFFER', 'shape')
        length = require_integer(payload['byte_length'], 'byte_length', 1, MAX_BUFFER)
        elements = 1
        for dimension in shape:
            elements *= require_integer(dimension, 'shape', 1, MAX_BUFFER)
            if elements > MAX_BUFFER:
                raise RequestError('LIMIT_EXCEEDED', 'shape')
        if elements * ITEM_BYTES[dtype] != length:
            raise RequestError('INVALID_BUFFER', 'shape')
        if not isinstance(payload['sha256'], str) or not re.fullmatch('[0-9a-f]{64}', payload['sha256']):
            raise RequestError('INVALID_BUFFER', 'sha256')
        if dtype == 'utf8json' and (len(shape) != 1 or length > MAX_METADATA):
            raise RequestError('LIMIT_EXCEEDED', 'byte_length')
        charge = length * (64 if dtype == 'utf8json' else 1)
        if self.reserved + charge > self.budget:
            raise RequestError('LIMIT_EXCEEDED', 'byte_length')
        handle = str(uuid4())
        target = Path(self.directory.name) / handle
        target.touch(exist_ok=False)
        self.buffers[handle] = StagedBuffer(target, dtype, length, payload['sha256'], charge, shape=tuple(shape))
        self.reserved += charge
        return {'handle': handle}

    def derive(self, payload):
        """A staging buffer that starts as a copy of the committed buffer `base` and ends as a new, different one.

        The descriptor (dtype, shape, length) must be the base's: only the content may differ. The client then sends only the parts that
        changed, with `buffer.chunk` at ascending, non-overlapping offsets, and `buffer.commit` accepts the result only when the whole
        content has the declared SHA-256, exactly as for a buffer sent in full. A client that missed a change therefore gets a refused
        commit, never a wrong buffer. The base is not touched. Metadata buffers cannot be derived."""
        require_fields(payload, ('base', 'dtype', 'shape', 'byte_length', 'sha256'))
        base = self.get(payload['base'], committed=True)
        if base.dtype == 'utf8json' or payload['dtype'] != base.dtype or payload['shape'] != list(base.shape) or payload['byte_length'] != base.length:
            raise RequestError('INVALID_BUFFER', 'base')
        handle = self.begin({key: payload[key] for key in ('dtype', 'shape', 'byte_length', 'sha256')})['handle']
        value = self.buffers[handle]
        try:
            shutil.copyfile(base.path, value.path)
        except OSError:
            self.release(handle)
            raise RequestError('INTERNAL') from None
        value.derived = True
        return {'handle': handle}

    def get(self, handle, *, committed=False):
        if not isinstance(handle, str):
            raise RequestError('INVALID_BUFFER', 'handle')
        value = self.buffers.get(handle)
        if value is None or value.released or (committed and not value.committed):
            raise RequestError('INVALID_BUFFER', 'handle')
        return value

    def append(self, payload, data):
        require_fields(payload, ('handle', 'offset', 'byte_length'))
        value = self.get(payload['handle'])
        offset = require_integer(payload['offset'], 'offset')
        length = require_integer(payload['byte_length'], 'byte_length', 1, MAX_CHUNK)
        if value.derived:
            if value.committed or data is None or length != len(data) or offset < value.written or offset + length > value.length:
                raise RequestError('INVALID_BUFFER')
            with value.path.open('r+b') as stream:
                stream.seek(offset)
                stream.write(data)
            value.written = offset + length
            value.received += length
            return {'next_offset': value.written}
        if value.committed or data is None or length != len(data) or offset != value.received or offset + length > value.length:
            raise RequestError('INVALID_BUFFER')
        with value.path.open('ab') as stream:
            stream.write(data)
        value.received += length
        return {'next_offset': value.received}

    def commit(self, payload):
        require_fields(payload, ('handle',))
        value = self.get(payload['handle'])
        if value.received != value.length and not value.derived:
            raise RequestError('INVALID_BUFFER')
        if not value.committed:
            self.verify(value)
            value.committed = True
        return {'handle': payload['handle'], 'byte_length': value.length, 'sha256': value.expected_hash}

    @staticmethod
    def verify(value):
        """Size, SHA-256, finite float64 data and strict metadata of a complete file; raises RequestError."""
        digest = hashlib.sha256()
        text = bytearray()                       # a metadata buffer is read once, for the hash and for the JSON check
        with value.path.open('rb') as stream:
            while chunk := stream.read(MAX_CHUNK):
                digest.update(chunk)
                if value.dtype == 'utf8json':
                    text += chunk
                if value.dtype == 'f64le' and any(not math.isfinite(item[0]) for item in struct.iter_unpack('<d', chunk)):
                    raise RequestError('INVALID_BUFFER')
        if digest.hexdigest() != value.expected_hash:
            raise RequestError('INVALID_BUFFER', 'sha256')
        if value.dtype == 'utf8json':
            try:
                strict_json(bytes(text), metadata=True)
            except ProtocolError as error:
                raise RequestError('INVALID_BUFFER') from error

    def adopt_packed(self, source, byte_length, sha256, layout):
        """Take the single result file of a worker as a committed, immutable `u8` buffer; returns `(handle, layout)`.

        `layout` maps a column name to `{dtype, shape, offset, byte_length}`: every column must start at a multiple of 8 bytes, lie inside
        the file, not overlap another, have a length equal to its shape times its item size, and the file must end exactly where the last
        column's padding ends, so nothing in it is unaccounted for. The file moves into the store (same filesystem) and is then read once:
        its SHA-256 must be the declared one and every float64 column must hold finite numbers. Nothing stays adopted on failure.
        One file and one handle replace about 35 of each; opening a file is the expensive step on Windows."""
        if len(self.buffers) >= MAX_HANDLES:
            raise RequestError('LIMIT_EXCEEDED')
        total = require_integer(byte_length, 'byte_length', 8, MAX_BUFFER)
        if not isinstance(sha256, str) or not re.fullmatch('[0-9a-f]{64}', sha256) or not isinstance(layout, dict) or not 1 <= len(layout) <= 64:
            raise RequestError('INVALID_BUFFER', 'shape')
        end = 0
        for part in sorted(layout.values(), key=lambda item: item['offset'] if isinstance(item, dict) and type(item.get('offset')) is int else -1):
            valid = (isinstance(part, dict) and set(part) == {'dtype', 'shape', 'offset', 'byte_length'} and isinstance(part['dtype'], str)
                     and part['dtype'] in ITEM_BYTES and part['dtype'] != 'utf8json' and isinstance(part['shape'], list) and 1 <= len(part['shape']) <= 3
                     and all(type(item) is int and item >= 1 for item in part['shape']) and type(part['offset']) is int and type(part['byte_length']) is int)
            if not valid or part['offset'] % 8 or part['offset'] < end:
                raise RequestError('INVALID_BUFFER', 'shape')
            if math.prod(part['shape']) * ITEM_BYTES[part['dtype']] != part['byte_length'] or part['byte_length'] < 1:
                raise RequestError('INVALID_BUFFER', 'shape')
            end = part['offset'] + part['byte_length']
        if total != -(-end // 8) * 8:
            raise RequestError('INVALID_BUFFER', 'byte_length')
        if self.reserved + total > self.budget:
            raise RequestError('LIMIT_EXCEEDED', 'byte_length')
        if not source.is_file() or source.is_symlink() or source.stat().st_size != total:
            raise RequestError('INVALID_BUFFER', 'byte_length')
        handle = str(uuid4())
        target = Path(self.directory.name) / handle
        os.replace(source, target)
        try:
            digest = hashlib.sha256()
            with target.open('rb') as stream:
                while chunk := stream.read(MAX_CHUNK):
                    digest.update(chunk)
                if digest.hexdigest() != sha256:
                    raise RequestError('INVALID_BUFFER', 'sha256')
                for part in layout.values():
                    if part['dtype'] == 'f64le':
                        stream.seek(part['offset'])
                        remaining = part['byte_length']
                        while remaining:
                            chunk = stream.read(min(remaining, MAX_CHUNK))
                            remaining -= len(chunk)
                            if not chunk or any(not math.isfinite(item[0]) for item in struct.iter_unpack('<d', chunk)):
                                raise RequestError('INVALID_BUFFER')
        except BaseException:
            target.unlink(missing_ok=True)
            raise
        self.buffers[handle] = StagedBuffer(target, 'u8', total, sha256, total, received=total, committed=True, shape=(total,))
        self.reserved += total
        return handle, {name: dict(part, shape=list(part['shape'])) for name, part in layout.items()}

    def read(self, payload):
        """A range of a committed buffer: ``(result, bytes)``; the coordinator sends the bytes as one binary frame."""
        require_fields(payload, ('handle', 'offset', 'byte_length'))
        value = self.get(payload['handle'], committed=True)
        offset = require_integer(payload['offset'], 'offset')
        length = require_integer(payload['byte_length'], 'byte_length', 1, MAX_CHUNK)
        if offset + length > value.length:
            raise RequestError('INVALID_REQUEST', 'byte_length')
        with value.path.open('rb') as stream:
            stream.seek(offset)
            data = stream.read(length)
        if len(data) != length:
            raise RequestError('INTERNAL')
        return {'offset': offset, 'byte_length': length}, data

    def release(self, handle):
        value = self.buffers.get(handle)
        if value is not None:
            value.released = True
            if not value.pins:
                value.path.unlink(missing_ok=True)
                self.reserved -= value.charge
                del self.buffers[handle]

    def unpin(self, handle):
        value = self.buffers[handle]
        value.pins -= 1
        if value.released:
            self.release(handle)

    def close(self):
        self.buffers.clear()
        self.reserved = TRANSIENT_RESERVE
        self.directory.cleanup()
