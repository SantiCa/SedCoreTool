"""Mask operations of the engine's coordinator (card M8.4.16 step 1, contract §8.7): mask.begin, mask.put (descriptor and binary frame),
mask.commit with tables from committed buffers, mask.discard and mask.read; and a real engine process killed between put and commit."""

import hashlib
import io
import json
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

import numpy as np
import pytest

from sedcoretool.engine.protocol import BINARY_FRAME, MAX_CHUNK, read_frame, strict_json, write_binary, write_json
from sedcoretool.engine.server import Coordinator
from sedcoretool.store import masks

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / 'src' / 'sedcoretool' / 'engine' / 'server.py'
W, H = 1300, 1100


def request(session, operation, payload):
    return {'v': 1, 'kind': 'request', 'session': session, 'id': str(uuid4()), 'op': operation, 'payload': payload}


def frames(output):
    stream, out = io.BytesIO(output.getvalue()), []
    while frame := read_frame(stream):
        out.append(('binary', frame[1]) if frame[0] == BINARY_FRAME else ('json', strict_json(frame[1])))
    return out


class Engine:
    """One coordinator in this process, driven like the main process drives it."""

    def __init__(self, tmp_path, projects=True):
        (tmp_path / 'scratch').mkdir(exist_ok=True)
        self.output = io.BytesIO()
        self.coordinator = Coordinator(self.output, version='test', runtime_id='0' * 64, scratch_directory=str(tmp_path / 'scratch'),
                                       projects_directory=str(tmp_path / 'projects') if projects else None)
        self.session = str(uuid4())
        self.call('hello', {'protocol': 1})

    def call(self, operation, payload, data=None):
        """``(response, binary frames that followed it)``."""
        item = request(self.session, operation, payload)
        before = len(frames(self.output))
        self.coordinator.receive(item, data)
        found = frames(self.output)[before:]
        assert found[0][0] == 'json' and found[0][1]['id'] == item['id']
        return found[0][1], [value for kind, value in found[1:] if kind == 'binary']

    def ok(self, operation, payload, data=None):
        response, binary = self.call(operation, payload, data)
        assert response['status'] == 'ok', response
        return response['result'], binary

    def error(self, operation, payload, data=None):
        response, binary = self.call(operation, payload, data)
        assert response['status'] == 'error' and binary == [], response
        return response['error']['code'], response['error']['details'].get('field')

    def buffer(self, data, dtype):
        sha = hashlib.sha256(data).hexdigest()
        size = {'u8': 1, 'utf8json': 1, 'u32le': 4, 'i32le': 4}[dtype]
        handle = self.ok('buffer.begin', {'dtype': dtype, 'shape': [len(data) // size], 'byte_length': len(data), 'sha256': sha})[0]['handle']
        self.ok('buffer.chunk', {'handle': handle, 'offset': 0, 'byte_length': len(data)}, data)
        self.ok('buffer.commit', {'handle': handle})
        return handle

    def tables(self):
        return {'objects': self.buffer(json.dumps([{'id': 1, 'class_id': 'a', 'predicted_class_id': None, 'confidence': 1}]).encode(), 'utf8json'),
                'classes': self.buffer(json.dumps([{'id': 'a', 'name': 'Burrow', 'counts': True}]).encode(), 'utf8json'),
                'stack_offsets': self.buffer(np.array([0, 0], dtype='<u4').tobytes(), 'u32le')}

    def close(self):
        self.coordinator.close()


@pytest.fixture
def engine(tmp_path):
    made = []

    def make(projects=True):
        made.append(Engine(tmp_path, projects))
        return made[-1]
    yield make
    for value in made:
        value.close()


def labels_tile(value, rows=512, cols=512):
    tile = np.zeros((512, 512), dtype='<i4')
    tile[:rows, :cols] = value
    data = tile.tobytes()
    return data, hashlib.sha256(data).hexdigest()


def begin(engine, base=None, project='p1', section='s1'):
    return engine.ok('mask.begin', {'project': project, 'section': section, 'width': W, 'height': H, 'base': base})[0]


def put(engine, staged, data, sha, row=0, col=0, layer='labels'):
    return engine.ok('mask.put', {'staged': staged, 'layer': layer, 'row': row, 'col': col, 'sha256': sha}, data)[0]


def test_without_a_projects_folder_the_mask_operations_are_unsupported(engine):
    value = engine(projects=False)
    assert value.error('mask.begin', {'project': 'p1', 'section': 's1', 'width': W, 'height': H, 'base': None}) == ('UNSUPPORTED_METHOD', None)
    assert value.error('mask.read', {'project': 'p1', 'manifest': '0' * 64, 'layer': 'labels', 'positions': [[0, 0]]})[0] == 'UNSUPPORTED_METHOD'


def test_a_version_is_written_and_read_back_through_the_engine(engine):
    value = engine()
    staged = begin(value)
    assert (staged['rows'], staged['cols']) == (3, 3)
    tiles = {(0, 0): labels_tile(5), (0, 1): labels_tile(-2), (2, 2): labels_tile(9, rows=1100 - 1024, cols=1300 - 1024)}
    for (row, col), (data, sha) in tiles.items():
        assert put(value, staged['staged'], data, sha, row, col) == {'stored': True}
    empty = bytes(masks.LAYER_BYTES['labels'])
    assert put(value, staged['staged'], empty, hashlib.sha256(empty).hexdigest(), 1, 1) == {'stored': False}
    manifest = value.ok('mask.commit', {'staged': staged['staged'], 'tables': value.tables()})[0]['manifest']
    assert value.error('mask.put', {'staged': staged['staged'], 'layer': 'labels', 'row': 0, 'col': 0, 'sha256': tiles[(0, 0)][1]},
                       tiles[(0, 0)][0]) == ('INVALID_REQUEST', 'staged')                  # a committed version is closed
    positions = [[0, 1], [1, 1], [0, 0], [2, 2]]
    result, binary = value.ok('mask.read', {'project': 'p1', 'manifest': manifest, 'layer': 'labels', 'positions': positions})
    assert [(tile['row'], tile['col'], tile['sha256'], tile['byte_length']) for tile in result['tiles']] == [
        (0, 1, tiles[(0, 1)][1], 2**20), (1, 1, None, 0), (0, 0, tiles[(0, 0)][1], 2**20), (2, 2, tiles[(2, 2)][1], 2**20)]
    assert result['frames'] == [len(part) for part in binary] and all(len(part) <= MAX_CHUNK for part in binary)
    assert b''.join(binary) == tiles[(0, 1)][0] + tiles[(0, 0)][0] + tiles[(2, 2)][0]
    result, binary = value.ok('mask.read', {'project': 'p1', 'manifest': manifest, 'layer': 'exclude', 'positions': [[0, 0]]})
    assert result == {'tiles': [{'row': 0, 'col': 0, 'sha256': None, 'byte_length': 0}], 'frames': []} and binary == []


def test_a_new_version_starts_from_its_base_and_keeps_the_base_tables(engine):
    value = engine()
    first = begin(value)['staged']
    data, sha = labels_tile(5)
    put(value, first, data, sha)
    base = value.ok('mask.commit', {'staged': first, 'tables': value.tables()})[0]['manifest']
    second = begin(value, base)['staged']
    other, other_sha = labels_tile(6)
    put(value, second, other, other_sha, 1, 0)
    version = value.ok('mask.commit', {'staged': second, 'tables': {}})[0]['manifest']
    read = value.ok('mask.read', {'project': 'p1', 'manifest': version, 'layer': 'labels', 'positions': [[0, 0], [1, 0]]})[1]
    assert b''.join(read) == data + other
    store = masks.MaskStore(Path(value.coordinator.projects_root) / 'p1' / 'tiles')
    assert store.read_manifest(version)[0]['tables'] == store.read_manifest(base)[0]['tables']
    third = begin(value, base)['staged']                                  # discard: no manifest, idempotent
    assert value.ok('mask.discard', {'staged': third})[0] == {} and value.ok('mask.discard', {'staged': third})[0] == {}
    assert value.error('mask.commit', {'staged': third, 'tables': {}}) == ('INVALID_REQUEST', 'staged')


def test_mask_requests_are_validated(engine):
    value = engine()
    data, sha = labels_tile(5)
    for payload, expected in (({'project': 'P1', 'section': 's1', 'width': W, 'height': H, 'base': None}, ('INVALID_REQUEST', 'project')),
                              ({'project': '..', 'section': 's1', 'width': W, 'height': H, 'base': None}, ('INVALID_REQUEST', 'project')),
                              ({'project': 'p1', 'section': 's/1', 'width': W, 'height': H, 'base': None}, ('INVALID_REQUEST', 'section')),
                              ({'project': 'p1', 'section': 's1', 'width': 0, 'height': H, 'base': None}, ('INVALID_REQUEST', 'width')),
                              ({'project': 'p1', 'section': 's1', 'width': W, 'height': H, 'base': 'f' * 64}, ('INVALID_REQUEST', 'manifest')),
                              ({'project': 'p1', 'section': 's1', 'width': W, 'height': H}, ('INVALID_REQUEST', None))):
        assert value.error('mask.begin', payload) == expected
    staged = begin(value)['staged']
    assert value.error('mask.put', {'staged': staged, 'layer': 'labels', 'row': 0, 'col': 0, 'sha256': sha}, data[:-1]) == ('INVALID_BUFFER', 'tile')
    assert value.error('mask.put', {'staged': str(uuid4()), 'layer': 'labels', 'row': 0, 'col': 0, 'sha256': sha}, data) == ('INVALID_REQUEST', 'staged')
    assert value.error('mask.put', {'staged': staged, 'layer': 'labels', 'row': 9, 'col': 0, 'sha256': sha}, data) == ('INVALID_REQUEST', 'row')
    tables = value.tables()
    wrong = {**tables, 'objects': value.buffer(b'\x01\x02\x03\x04', 'u8')}
    assert value.error('mask.commit', {'staged': staged, 'tables': wrong}) == ('INVALID_BUFFER', 'tables.objects')
    assert value.error('mask.commit', {'staged': staged, 'tables': tables}) == ('INVALID_REQUEST', 'staged')   # closed by the failed commit
    staged = begin(value)['staged']
    assert value.error('mask.commit', {'staged': staged, 'tables': {'objects': str(uuid4())}}) == ('INVALID_BUFFER', 'handle')
    staged = begin(value)['staged']
    assert value.error('mask.commit', {'staged': staged, 'tables': {'objects': tables['objects']}}) == ('INVALID_REQUEST', 'tables.classes')
    for payload, expected in (({'project': 'p1', 'manifest': 'x', 'layer': 'labels', 'positions': [[0, 0]]}, ('INVALID_REQUEST', 'manifest')),
                              ({'project': 'p1', 'manifest': '0' * 64, 'layer': 'labels', 'positions': [[0, 0]]}, ('INVALID_REQUEST', 'manifest'))):
        assert value.error('mask.read', payload) == expected
    staged = begin(value)['staged']
    put(value, staged, data, sha)
    manifest = value.ok('mask.commit', {'staged': staged, 'tables': tables})[0]['manifest']
    for positions in ([], [[3, 0]], [[0, 0]] * 17, [[0]], [[0, True]]):
        assert value.error('mask.read', {'project': 'p1', 'manifest': manifest, 'layer': 'labels', 'positions': positions}) == ('INVALID_REQUEST', 'positions')
    assert value.error('mask.read', {'project': 'p1', 'manifest': manifest, 'layer': 'x', 'positions': [[0, 0]]}) == ('INVALID_REQUEST', 'layer')


def test_staged_versions_are_bounded_per_session(engine):
    value = engine()
    staged = [begin(value)['staged'] for _ in range(16)]
    assert value.error('mask.begin', {'project': 'p1', 'section': 's1', 'width': W, 'height': H, 'base': None}) == ('LIMIT_EXCEEDED', 'staged')
    value.ok('mask.discard', {'staged': staged[0]})
    begin(value)


def test_a_damaged_tile_is_never_sent(engine):
    value = engine()
    staged = begin(value)['staged']
    data, sha = labels_tile(5)
    put(value, staged, data, sha)
    manifest = value.ok('mask.commit', {'staged': staged, 'tables': value.tables()})[0]['manifest']
    blob = Path(value.coordinator.projects_root) / 'p1' / 'tiles' / 'blobs' / sha[:2] / sha
    blob.write_bytes(blob.read_bytes()[:-8])
    value.coordinator.mask_cache.items.clear()
    assert value.error('mask.read', {'project': 'p1', 'manifest': manifest, 'layer': 'labels', 'positions': [[0, 0]]}) == ('INVALID_BUFFER', 'tile')


class Process:
    """A real engine process on private pipes, as the main process starts it (contract §3)."""

    def __init__(self, tmp_path):
        (tmp_path / 'scratch').mkdir(exist_ok=True)
        self.process = subprocess.Popen([sys.executable, '-I', '-u', str(SERVER), '--version', 'test', '--runtime-id', '0' * 64,
                                         '--scratch-dir', str(tmp_path / 'scratch'), '--projects-dir', str(tmp_path / 'projects')],
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        self.session = str(uuid4())
        assert self.call('hello', {'protocol': 1})['status'] == 'ok'

    def call(self, operation, payload, data=None):
        item = request(self.session, operation, payload)
        write_json(self.process.stdin, item)
        if data is not None:
            write_binary(self.process.stdin, data)
        kind, body = read_frame(self.process.stdout)
        assert kind != BINARY_FRAME
        response = strict_json(body)
        assert response['id'] == item['id']
        response['binary'] = [read_frame(self.process.stdout)[1] for _ in response.get('result', {}).get('frames', [])] \
            if response['status'] == 'ok' and isinstance(response.get('result'), dict) else []
        return response

    def kill(self):
        self.process.kill()
        self.process.wait(timeout=10)


def test_an_engine_killed_between_put_and_commit_leaves_the_last_version_readable(tmp_path):
    engine = Process(tmp_path)
    try:
        objects = json.dumps([{'id': 1}]).encode()
        handles = {}
        for name, data, dtype in (('objects', objects, 'utf8json'), ('classes', b'[]', 'utf8json'),
                                  ('stack_offsets', np.array([0, 0], dtype='<u4').tobytes(), 'u32le')):
            sha = hashlib.sha256(data).hexdigest()
            size = 4 if dtype == 'u32le' else 1
            handle = engine.call('buffer.begin', {'dtype': dtype, 'shape': [len(data) // size], 'byte_length': len(data), 'sha256': sha})['result']['handle']
            engine.call('buffer.chunk', {'handle': handle, 'offset': 0, 'byte_length': len(data)}, data)
            assert engine.call('buffer.commit', {'handle': handle})['status'] == 'ok'
            handles[name] = handle
        staged = engine.call('mask.begin', {'project': 'p1', 'section': 's1', 'width': W, 'height': H, 'base': None})['result']['staged']
        data, sha = labels_tile(5)
        assert engine.call('mask.put', {'staged': staged, 'layer': 'labels', 'row': 0, 'col': 0, 'sha256': sha}, data)['result'] == {'stored': True}
        base = engine.call('mask.commit', {'staged': staged, 'tables': handles})['result']['manifest']
        staged = engine.call('mask.begin', {'project': 'p1', 'section': 's1', 'width': W, 'height': H, 'base': base})['result']['staged']
        other, other_sha = labels_tile(6)
        assert engine.call('mask.put', {'staged': staged, 'layer': 'labels', 'row': 0, 'col': 0, 'sha256': other_sha}, other)['status'] == 'ok'
    finally:
        engine.kill()                                                      # before mask.commit
    manifests = sorted(path.name for path in (tmp_path / 'projects' / 'p1' / 'tiles' / 'manifests').iterdir())
    assert manifests == [f'{base}.json']
    again = Process(tmp_path)
    try:
        response = again.call('mask.read', {'project': 'p1', 'manifest': base, 'layer': 'labels', 'positions': [[0, 0]]})
        assert response['status'] == 'ok' and b''.join(response['binary']) == data
        response = again.call('mask.put', {'staged': staged, 'layer': 'labels', 'row': 0, 'col': 0, 'sha256': other_sha}, other)
        assert response['status'] == 'error' and response['error']['details'] == {'field': 'staged'}     # the staged version died with the engine
        staged = again.call('mask.begin', {'project': 'p1', 'section': 's1', 'width': W, 'height': H, 'base': base})['result']['staged']
        assert again.call('mask.put', {'staged': staged, 'layer': 'labels', 'row': 0, 'col': 0, 'sha256': other_sha}, other)['status'] == 'ok'
        assert again.call('mask.commit', {'staged': staged, 'tables': {}})['status'] == 'ok'                                   # sent again
    finally:
        again.kill()
