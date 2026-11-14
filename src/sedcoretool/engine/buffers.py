"""Session-scoped staged buffers with checked admission and immutable commit."""

import hashlib
import math
import os
import re
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
        if value.committed or data is None or length != len(data) or offset != value.received or offset + length > value.length:
            raise RequestError('INVALID_BUFFER')
        with value.path.open('ab') as stream:
            stream.write(data)
        value.received += length
        return {'next_offset': value.received}

    def commit(self, payload):
        require_fields(payload, ('handle',))
        value = self.get(payload['handle'])
        if value.received != value.length:
            raise RequestError('INVALID_BUFFER')
        if not value.committed:
            self.verify(value)
            value.committed = True
        return {'handle': payload['handle'], 'byte_length': value.length, 'sha256': value.expected_hash}

    @staticmethod
    def verify(value):
        """Size, SHA-256, finite float64 data and strict metadata of a complete file; raises RequestError."""
        digest = hashlib.sha256()
        with value.path.open('rb') as stream:
            while chunk := stream.read(MAX_CHUNK):
                digest.update(chunk)
                if value.dtype == 'f64le' and any(not math.isfinite(item[0]) for item in struct.iter_unpack('<d', chunk)):
                    raise RequestError('INVALID_BUFFER')
        if digest.hexdigest() != value.expected_hash:
            raise RequestError('INVALID_BUFFER', 'sha256')
        if value.dtype == 'utf8json':
            try:
                strict_json(value.path.read_bytes(), metadata=True)
            except ProtocolError as error:
                raise RequestError('INVALID_BUFFER') from error

    def adopt(self, source, dtype, shape, byte_length, sha256):
        """Take a result file written by a worker as a committed, immutable buffer; returns its handle.

        The file moves into the store (it must be on the same filesystem) after the same checks a client upload gets,
        so a worker cannot publish data that does not match the size, shape or hash it declared."""
        if len(self.buffers) >= MAX_HANDLES:
            raise RequestError('LIMIT_EXCEEDED')
        if not isinstance(dtype, str) or dtype not in ITEM_BYTES or dtype == 'utf8json':
            raise RequestError('INVALID_BUFFER', 'dtype')
        if not isinstance(shape, list) or not 1 <= len(shape) <= 3 or not all(type(item) is int and item >= 1 for item in shape):
            raise RequestError('INVALID_BUFFER', 'shape')
        length = require_integer(byte_length, 'byte_length', 1, MAX_BUFFER)
        elements = math.prod(shape)
        if elements * ITEM_BYTES[dtype] != length or not isinstance(sha256, str) or not re.fullmatch('[0-9a-f]{64}', sha256):
            raise RequestError('INVALID_BUFFER', 'shape')
        if self.reserved + length > self.budget:
            raise RequestError('LIMIT_EXCEEDED', 'byte_length')
        if not source.is_file() or source.is_symlink() or source.stat().st_size != length:
            raise RequestError('INVALID_BUFFER', 'byte_length')
        handle = str(uuid4())
        target = Path(self.directory.name) / handle
        value = StagedBuffer(target, dtype, length, sha256, length, received=length, committed=True, shape=tuple(shape))
        os.replace(source, target)
        try:
            self.verify(value)
        except RequestError:
            target.unlink(missing_ok=True)
            raise
        self.buffers[handle] = value
        self.reserved += length
        return handle

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
