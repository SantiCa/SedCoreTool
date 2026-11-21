"""Mask operations of the engine's coordinator (card M8.4.16 step 1, contract §8.7): mask.begin, mask.put (descriptor and binary frame),
mask.commit with tables from committed buffers, mask.discard and mask.read; and a real engine process killed between put and commit."""

import hashlib
import io
import json
import subprocess
import sys
import threading
import zlib
from pathlib import Path
from uuid import uuid4

import numpy as np
import pytest

from sedcoretool.engine.protocol import BINARY_FRAME, MAX_CHUNK, read_frame, strict_json, write_binary, write_json
from sedcoretool.engine.server import Coordinator
from sedcoretool.store import masks
from test_store_tiles import hand_made_pyramid

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

    def __init__(self, tmp_path, projects=True, pyramids=False):
        (tmp_path / 'scratch').mkdir(exist_ok=True)
        self.output = io.BytesIO()
        self.coordinator = Coordinator(self.output, version='test', runtime_id='0' * 64, scratch_directory=str(tmp_path / 'scratch'),
                                       projects_directory=str(tmp_path / 'projects') if projects else None,
                                       pyramid_directory=str(tmp_path / 'pyramids') if pyramids else None, pyramid_budget=2**30)
        self.session = str(uuid4())
        self.call('hello', {'protocol': 1})

    def call(self, operation, payload, data=None):
        """``(response, binary frames that followed it)``."""
        item = request(self.session, operation, payload)
        before = len(frames(self.output))
        self.coordinator.receive(item, data)
        self.coordinator.answer_masks(wait=True)           # card M8.4.40: mask requests are answered from the MaskIO thread
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
        size = {'u8': 1, 'utf8json': 1, 'u32le': 4, 'i32le': 4, 'f64le': 8}[dtype]
        handle = self.ok('buffer.begin', {'dtype': dtype, 'shape': [len(data) // size], 'byte_length': len(data), 'sha256': sha})[0]['handle']
        self.ok('buffer.chunk', {'handle': handle, 'offset': 0, 'byte_length': len(data)}, data)
        self.ok('buffer.commit', {'handle': handle})
        return handle

    def tables(self):
        return {'object_ids': self.buffer(np.array([1], dtype='<u4').tobytes(), 'u32le'),
                'object_class': self.buffer(np.array([0], dtype='<i4').tobytes(), 'i32le'),
                'object_predicted': self.buffer(np.array([-1], dtype='<i4').tobytes(), 'i32le'),
                'object_confidence': self.buffer(np.array([1.0], dtype='<f8').tobytes(), 'f64le'),
                'classes': self.buffer(json.dumps([{'id': 'a', 'name': 'Burrow', 'counts': True}]).encode(), 'utf8json'),
                'stack_offsets': self.buffer(np.array([0, 0], dtype='<u4').tobytes(), 'u32le')}

    def close(self):
        self.coordinator.close()


@pytest.fixture
def engine(tmp_path):
    made = []

    def make(projects=True, pyramids=False):
        made.append(Engine(tmp_path, projects, pyramids))
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
    wrong = {**tables, 'object_ids': value.buffer(b'\x01\x02\x03\x04', 'u8')}
    assert value.error('mask.commit', {'staged': staged, 'tables': wrong}) == ('INVALID_BUFFER', 'tables.object_ids')
    assert value.error('mask.commit', {'staged': staged, 'tables': tables}) == ('INVALID_REQUEST', 'staged')   # closed by the failed commit
    staged = begin(value)['staged']
    assert value.error('mask.commit', {'staged': staged, 'tables': {'object_ids': str(uuid4())}}) == ('INVALID_BUFFER', 'handle')
    staged = begin(value)['staged']
    assert value.error('mask.commit', {'staged': staged, 'tables': {'object_ids': tables['object_ids']}}) == ('INVALID_REQUEST', 'tables.object_class')
    staged = begin(value)['staged']
    unknown = {**tables, 'object_class': value.buffer(np.array([1], dtype='<i4').tobytes(), 'i32le')}   # one class only
    assert value.error('mask.commit', {'staged': staged, 'tables': unknown}) == ('INVALID_BUFFER', 'tables.object_class')
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
        handles = {}
        for name, data, dtype in (('object_ids', np.array([1], dtype='<u4').tobytes(), 'u32le'),
                                  ('object_class', np.array([-1], dtype='<i4').tobytes(), 'i32le'),
                                  ('object_predicted', np.array([-1], dtype='<i4').tobytes(), 'i32le'),
                                  ('object_confidence', np.array([0.0], dtype='<f8').tobytes(), 'f64le'), ('classes', b'[]', 'utf8json'),
                                  ('stack_offsets', np.array([0, 0], dtype='<u4').tobytes(), 'u32le')):
            sha = hashlib.sha256(data).hexdigest()
            size = {'u32le': 4, 'i32le': 4, 'f64le': 8}.get(dtype, 1)
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


def stored_names(value, project='p1'):
    folder = Path(value.coordinator.projects_root) / project / 'tiles'
    return ({path.name[:-5] for path in (folder / 'manifests').glob('*.json')}, {path.name for path in (folder / 'blobs').glob('*/*')})


def test_retain_keeps_the_listed_versions_and_their_blobs_and_removes_the_rest(engine):
    """Card M8.4.18a: after a save, only the manifests the project names (and the current ones) stay; a staged version's blobs are never removed."""
    value = engine()
    versions, data = [], {}
    base = None
    for k in range(3):                                                    # three versions, each changing tile (0, 0)
        staged = begin(value, base)['staged']
        data[k] = labels_tile(10 + k)
        put(value, staged, *data[k])
        base = value.ok('mask.commit', {'staged': staged, 'tables': value.tables() if k == 0 else {}})[0]['manifest']
        versions.append(base)
    open_staging = begin(value, versions[2])['staged']                    # an edit on its way: its new tile must survive
    pending = labels_tile(99)
    put(value, open_staging, *pending, 1, 1)
    removed = value.ok('mask.retain', {'project': 'p1', 'keep': [versions[0], versions[2]]})[0]['removed']
    manifests, blobs = stored_names(value)
    assert manifests == {versions[0], versions[2]} and removed['manifests'] == 1
    assert data[1][1] not in blobs and removed['blobs'] == 1, 'the tile only version 1 used is gone'
    assert {data[0][1], data[2][1], pending[1]} <= blobs, 'kept versions and the open staging keep their tiles'
    for name in (versions[0], versions[2]):                               # every kept version still reads whole
        assert b''.join(value.ok('mask.read', {'project': 'p1', 'manifest': name, 'layer': 'labels', 'positions': [[0, 0]]})[1])
    final = value.ok('mask.commit', {'staged': open_staging, 'tables': {}})[0]['manifest']
    assert b''.join(value.ok('mask.read', {'project': 'p1', 'manifest': final, 'layer': 'labels', 'positions': [[1, 1]]})[1]) == pending[0]
    assert value.error('mask.read', {'project': 'p1', 'manifest': versions[1], 'layer': 'labels', 'positions': [[0, 0]]})[0] == 'INVALID_REQUEST'


def test_retain_with_a_missing_kept_version_removes_nothing(engine):
    value = engine()
    staged = begin(value)['staged']
    put(value, staged, *labels_tile(5))
    version = value.ok('mask.commit', {'staged': staged, 'tables': value.tables()})[0]['manifest']
    before = stored_names(value)
    assert value.error('mask.retain', {'project': 'p1', 'keep': ['0' * 64]}) == ('INVALID_REQUEST', 'keep')
    assert value.error('mask.retain', {'project': 'p1', 'keep': 'all'}) == ('INVALID_REQUEST', 'keep')
    assert value.error('mask.retain', {'project': 'p1', 'keep': [version], 'extra': 1})[0] == 'INVALID_REQUEST'
    assert stored_names(value) == before


def test_a_cached_blob_that_retain_removed_is_written_again(engine):
    """A blob removed by retain and then needed by a new version must be on disk again, not only in the engine's cache."""
    value = engine()
    staged = begin(value)['staged']
    tile = labels_tile(7)
    put(value, staged, *tile)
    first = value.ok('mask.commit', {'staged': staged, 'tables': value.tables()})[0]['manifest']
    staged = begin(value, first)['staged']
    put(value, staged, *labels_tile(8))
    second = value.ok('mask.commit', {'staged': staged, 'tables': {}})[0]['manifest']
    value.ok('mask.retain', {'project': 'p1', 'keep': [second]})
    assert tile[1] not in stored_names(value)[1]
    staged = begin(value, second)['staged']
    put(value, staged, *tile)                                             # the same bytes as the removed blob
    third = value.ok('mask.commit', {'staged': staged, 'tables': {}})[0]['manifest']
    assert tile[1] in stored_names(value)[1]
    fresh = masks.MaskStore(Path(value.coordinator.projects_root) / 'p1' / 'tiles')
    assert fresh.read_tile(third, 'labels', 0, 0) == tile[0]


def test_info_lists_the_tiles_of_a_version_in_pages(engine, monkeypatch):
    monkeypatch.setattr(masks, 'INFO_PAGE', 2)
    value = engine()
    staged = begin(value)['staged']
    for row, col in [(0, 0), (1, 2), (2, 1)]:
        put(value, staged, *labels_tile(row * 3 + col + 1, rows=H - 1024 if row == 2 else 512, cols=W - 1024 if col == 2 else 512), row, col)   # padding stays zero
    exclusion = np.zeros(512 * 512, dtype=np.uint8); exclusion[5] = 1
    put(value, staged, exclusion.tobytes(), hashlib.sha256(exclusion.tobytes()).hexdigest(), 1, 2, 'exclude')
    version = value.ok('mask.commit', {'staged': staged, 'tables': value.tables()})[0]['manifest']
    first = value.ok('mask.info', {'project': 'p1', 'manifest': version, 'start': 0})[0]
    assert (first['section'], first['width'], first['height'], first['tiles'], first['positions'], first['next']) == ('s1', W, H, 3, [0, 0, 1, 1, 2, 3], 2)
    second = value.ok('mask.info', {'project': 'p1', 'manifest': version, 'start': 2})[0]
    assert (second['positions'], second['next']) == ([2, 1, 1], None)
    assert value.error('mask.info', {'project': 'p1', 'manifest': version, 'start': -1}) == ('INVALID_REQUEST', 'start')
    assert value.error('mask.info', {'project': 'p1', 'manifest': '1' * 64, 'start': 0}) == ('INVALID_REQUEST', 'manifest')


def test_a_retain_stopped_half_way_leaves_every_kept_version_readable(engine, monkeypatch):
    """Manifests are deleted before blobs: a stop while blobs are being deleted leaves only unreferenced blobs behind."""
    value = engine()
    staged = begin(value)['staged']
    put(value, staged, *labels_tile(3))
    old = value.ok('mask.commit', {'staged': staged, 'tables': value.tables()})[0]['manifest']
    staged = begin(value, old)['staged']
    kept_tile = labels_tile(4)
    put(value, staged, *kept_tile)
    kept = value.ok('mask.commit', {'staged': staged, 'tables': {}})[0]['manifest']
    original = Path.unlink
    def stop_at_blobs(self, *args, **kwargs):
        if self.parent.parent.name == 'blobs':
            raise OSError('stopped')
        return original(self, *args, **kwargs)
    monkeypatch.setattr(Path, 'unlink', stop_at_blobs)
    assert value.error('mask.retain', {'project': 'p1', 'keep': [kept]})[0] == 'INTERNAL'
    monkeypatch.setattr(Path, 'unlink', original)
    fresh = masks.MaskStore(Path(value.coordinator.projects_root) / 'p1' / 'tiles')
    assert fresh.read_tile(kept, 'labels', 0, 0) == kept_tile[0]
    assert stored_names(value)[0] == {kept}
    assert value.ok('mask.retain', {'project': 'p1', 'keep': [kept]})[0]['removed']['blobs'] >= 1, 'a later retain removes what was left'


def test_copy_puts_a_version_into_another_project_in_pages_and_its_manifest_last(engine, monkeypatch):
    """Card M8.4.27: a project saved under a new identifier gets the versions its tiled sections name, verified, manifest last."""
    monkeypatch.setattr(masks, 'COPY_PAGE', 2)
    value = engine()
    staged = begin(value)['staged']
    tiles = {(row, col): labels_tile(row * 3 + col + 1) for row, col in [(0, 0), (0, 1), (1, 1)]}
    for (row, col), tile in tiles.items():
        put(value, staged, *tile, row, col)
    version = value.ok('mask.commit', {'staged': staged, 'tables': value.tables()})[0]['manifest']
    first = value.ok('mask.copy', {'from': 'p1', 'to': 'p2', 'manifest': version, 'start': 0})[0]
    assert first == {'next': 2, 'tiles': 3}
    assert stored_names(value, 'p2')[0] == set(), 'no manifest before every page is copied'
    assert value.error('mask.copy', {'from': 'p1', 'to': 'p2', 'manifest': version, 'start': 4}) == ('INVALID_REQUEST', 'start')
    assert value.ok('mask.copy', {'from': 'p1', 'to': 'p2', 'manifest': version, 'start': 2})[0] == {'next': None, 'tiles': 3}
    assert stored_names(value, 'p2') == stored_names(value, 'p1')
    for (row, col), tile in tiles.items():
        assert b''.join(value.ok('mask.read', {'project': 'p2', 'manifest': version, 'layer': 'labels', 'positions': [[row, col]]})[1]) == tile[0]
    # a retain of the first project does not touch the copy (from a new engine process: card M8.4.31 keeps this session's commits)
    value.close()
    value = engine()
    value.ok('mask.retain', {'project': 'p1', 'keep': []})
    assert stored_names(value, 'p1')[0] == set() and stored_names(value, 'p2')[0] == {version}
    assert value.error('mask.copy', {'from': 'p2', 'to': 'p2', 'manifest': version, 'start': 0}) == ('INVALID_REQUEST', 'to')
    assert value.error('mask.copy', {'from': 'p1', 'to': 'p3', 'manifest': version, 'start': 0}) == ('INVALID_REQUEST', 'manifest')


def test_copy_refuses_a_damaged_tile_and_a_skipped_page(engine, monkeypatch):
    monkeypatch.setattr(masks, 'COPY_PAGE', 1)
    value = engine()
    staged = begin(value)['staged']
    for col in (0, 1):
        put(value, staged, *labels_tile(col + 5), 0, col)
    version = value.ok('mask.commit', {'staged': staged, 'tables': value.tables()})[0]['manifest']
    assert value.error('mask.copy', {'from': 'p1', 'to': 'p2', 'manifest': version, 'start': 1}) == ('INVALID_REQUEST', 'start'), 'page 0 skipped'
    assert stored_names(value, 'p2')[0] == set()
    blob = Path(value.coordinator.projects_root) / 'p1' / 'tiles' / 'blobs' / labels_tile(5)[1][:2] / labels_tile(5)[1]
    blob.write_bytes(b'not a tile')
    value.coordinator.mask_cache.items.clear()
    assert value.error('mask.copy', {'from': 'p1', 'to': 'p3', 'manifest': version, 'start': 0}) == ('INVALID_BUFFER', 'tile')
    assert stored_names(value, 'p3')[0] == set()


def test_forget_drops_a_project_from_memory_and_waits_for_its_open_versions(engine):
    value = engine()
    staged = begin(value)['staged']
    put(value, staged, *labels_tile(6))
    assert value.error('mask.forget', {'project': 'p1'})[0] == 'BUSY', 'a staged version of the project is open'
    version = value.ok('mask.commit', {'staged': staged, 'tables': value.tables()})[0]['manifest']
    value.ok('mask.read', {'project': 'p1', 'manifest': version, 'layer': 'labels', 'positions': [[0, 0]]})
    assert any(key[0].parent.name == 'p1' for key in value.coordinator.mask_cache.items)
    assert value.ok('mask.forget', {'project': 'p1'})[0] == {}
    assert 'p1' not in value.coordinator.mask_stores
    assert not any(key[0].parent.name == 'p1' for key in value.coordinator.mask_cache.items)
    assert value.error('mask.forget', {'project': '../p1'}) == ('INVALID_REQUEST', 'project')


def commit_version(value, base, tile, section='s1', project='p1'):
    staged = begin(value, base, project=project, section=section)['staged']
    put(value, staged, *tile)
    return value.ok('mask.commit', {'staged': staged, 'tables': value.tables() if base is None else {}})[0]['manifest']


def test_retain_keeps_a_version_committed_after_the_ones_it_names(engine):
    """Card M8.4.31: the page asks for a clean-up naming the version it knows while the engine has already committed the next one, whose
    answer is still on its way: that version and its tiles stay; a clean-up naming it removes the older one as before."""
    value = engine()
    first, second_tile = commit_version(value, None, labels_tile(1)), labels_tile(2)
    second = commit_version(value, first, second_tile)
    removed = value.ok('mask.retain', {'project': 'p1', 'keep': [first]})[0]['removed']
    manifests, blobs = stored_names(value)
    assert manifests == {first, second} and removed['manifests'] == 0
    assert second_tile[1] in blobs
    assert value.ok('mask.read', {'project': 'p1', 'manifest': second, 'layer': 'labels', 'positions': [[0, 0]]})[1]
    value.ok('mask.retain', {'project': 'p1', 'keep': [second]})
    assert stored_names(value)[0] == {second}, 'once named, the older version goes'


def test_retain_follows_each_section_on_its_own(engine):
    """Commits of two sections interleave; the page names the newest version it knows of each. A section's newer commit survives even
    when another section's commit came later, and versions before the named ones go."""
    value = engine()
    a1 = commit_version(value, None, labels_tile(1), section='s1')
    b1 = commit_version(value, None, labels_tile(2), section='s2')
    b2 = commit_version(value, b1, labels_tile(3), section='s2')        # its answer has not reached the page
    a2 = commit_version(value, a1, labels_tile(4), section='s1')
    value.ok('mask.retain', {'project': 'p1', 'keep': [a2, b1]})
    assert stored_names(value)[0] == {a2, b1, b2}
    value.ok('mask.retain', {'project': 'p1', 'keep': [a2, b2]})
    assert stored_names(value)[0] == {a2, b2}


def test_after_a_restart_retain_keeps_only_what_it_names(engine):
    """A new engine process has committed nothing: retain removes every version the request does not name, as before card M8.4.31."""
    value = engine()
    first = commit_version(value, None, labels_tile(1))
    second = commit_version(value, first, labels_tile(2))
    value.close()
    again = engine()
    again.ok('mask.retain', {'project': 'p1', 'keep': [first]})
    assert stored_names(again)[0] == {first}
    assert second not in stored_names(again)[0]


def test_a_forgotten_project_starts_without_a_session_record(engine):
    value = engine()
    first = commit_version(value, None, labels_tile(1))
    commit_version(value, first, labels_tile(2))
    value.ok('mask.forget', {'project': 'p1'})
    assert value.coordinator.session_commits == {}
    value.ok('mask.retain', {'project': 'p1', 'keep': [first]})
    assert stored_names(value)[0] == {first}


# ---- Card M8.4.29: derived files (contract §8.7, decision G) ----

def committed_version(value, project='p1', section='s1'):
    staged = begin(value, project=project, section=section)['staged']
    data, sha = labels_tile(5)
    put(value, staged, data, sha)
    return value.ok('mask.commit', {'staged': staged, 'tables': value.tables()})[0]['manifest']


def upload(value, data):
    """A committed u8 buffer, sent in chunks of at most MAX_CHUNK."""
    handle = value.ok('buffer.begin', {'dtype': 'u8', 'shape': [len(data)], 'byte_length': len(data), 'sha256': hashlib.sha256(data).hexdigest()})[0]['handle']
    for offset in range(0, len(data), MAX_CHUNK):
        part = data[offset:offset + MAX_CHUNK]
        value.ok('buffer.chunk', {'handle': handle, 'offset': offset, 'byte_length': len(part)}, part)
    value.ok('buffer.commit', {'handle': handle})
    return handle


def put_derived(value, manifest, data, project='p1', kind='reopen'):
    return value.ok('mask.derived.put', {'project': project, 'manifest': manifest, 'kind': kind, 'handle': upload(value, data)})[0]


def get_derived(value, manifest, project='p1', kind='reopen'):
    result, binary = value.ok('mask.derived.get', {'project': project, 'manifest': manifest, 'kind': kind})
    return result, b''.join(binary)


def test_a_derived_file_is_stored_with_its_manifest_and_read_back_in_frames(engine):
    value = engine()
    manifest = committed_version(value)
    assert get_derived(value, manifest) == ({'found': False}, b'')
    body = (b'reopen cache ' + bytes(range(256))) * 9000                       # about 2.4 MB: more than one frame
    assert put_derived(value, manifest, body) == {'byte_length': len(body)}
    result, joined = get_derived(value, manifest)
    assert joined == body and result['found'] is True and result['byte_length'] == len(body)
    assert result['sha256'] == hashlib.sha256(body).hexdigest() and sum(result['frames']) == len(body) and len(result['frames']) == 3
    assert all(size <= MAX_CHUNK for size in result['frames'])
    path = Path(value.coordinator.projects_root) / 'p1' / 'tiles' / 'derived' / f'{manifest}.reopen'
    assert path.is_file() and path.stat().st_size < len(body)                  # stored compressed
    assert put_derived(value, manifest, b'second') == {'byte_length': 6} and get_derived(value, manifest)[1] == b'second'   # replaced


def test_derived_requests_are_validated(engine):
    value = engine()
    manifest = committed_version(value)
    handle = value.buffer(b'x' * 10, 'u8')
    base = {'project': 'p1', 'manifest': manifest, 'kind': 'reopen', 'handle': handle}
    assert value.error('mask.derived.put', {**base, 'kind': 'other'}) == ('INVALID_REQUEST', 'kind')
    assert value.error('mask.derived.put', {**base, 'manifest': '1' * 64}) == ('INVALID_REQUEST', 'manifest')    # not stored
    assert value.error('mask.derived.put', {**base, 'manifest': 'xyz'}) == ('INVALID_REQUEST', 'manifest')
    assert value.error('mask.derived.put', {**base, 'project': 'Bad Name'}) == ('INVALID_REQUEST', 'project')
    assert value.error('mask.derived.put', {**base, 'handle': 'nope'})[0] == 'INVALID_BUFFER'   # an unknown handle, as for the tables of mask.commit
    wrong = value.buffer(np.array([1, 2], dtype='<u4').tobytes(), 'u32le')
    assert value.error('mask.derived.put', {**base, 'handle': wrong}) == ('INVALID_BUFFER', 'derived')            # not u8
    assert value.error('mask.derived.get', {'project': 'p1', 'manifest': manifest, 'kind': 'other'}) == ('INVALID_REQUEST', 'kind')
    assert value.error('mask.derived.get', {'project': 'p1', 'manifest': 'abc', 'kind': 'reopen'}) == ('INVALID_REQUEST', 'manifest')
    assert value.error('mask.derived.get', {'project': 'p1', 'manifest': manifest}) [0] == 'INVALID_REQUEST'


def test_the_size_limit_of_a_derived_file(engine, monkeypatch):
    value = engine()
    manifest = committed_version(value)
    monkeypatch.setattr(masks, 'MAX_DERIVED_BYTES', 100)
    assert put_derived(value, manifest, b'a' * 100) == {'byte_length': 100}
    handle = value.buffer(b'a' * 101, 'u8')
    assert value.error('mask.derived.put', {'project': 'p1', 'manifest': manifest, 'kind': 'reopen', 'handle': handle}) == ('LIMIT_EXCEEDED', 'derived')
    assert get_derived(value, manifest)[1] == b'a' * 100                        # the refused put left the old file


def test_a_damaged_derived_file_is_refused_and_replaced_by_the_next_put(engine):
    value = engine()
    manifest = committed_version(value)
    put_derived(value, manifest, b'good data' * 100)
    path = Path(value.coordinator.projects_root) / 'p1' / 'tiles' / 'derived' / f'{manifest}.reopen'
    for damaged in (b'not zlib', path.read_bytes()[:-6], path.read_bytes() + b'extra', b''):
        path.write_bytes(damaged)
        assert value.error('mask.derived.get', {'project': 'p1', 'manifest': manifest, 'kind': 'reopen'}) == ('INVALID_BUFFER', 'derived')
    put_derived(value, manifest, b'fresh')
    assert get_derived(value, manifest)[1] == b'fresh'


def test_retain_removes_the_derived_files_of_the_manifests_it_removes_and_leaves_other_files(engine):
    value = engine()
    keep, drop = committed_version(value), committed_version(value, section='s2')
    put_derived(value, keep, b'keep me')
    put_derived(value, drop, b'drop me')
    value.close()
    value = engine()                                                           # a new process has committed nothing: retain removes what it does not name
    folder = Path(value.coordinator.projects_root) / 'p1' / 'tiles' / 'derived'
    (folder / 'notes.txt').write_bytes(b'not ours')
    (folder / f'{keep}.future').write_bytes(b'a kind this version does not know')
    (folder / f'{drop}.reopen.0123abcd.tmp').write_bytes(b'half written')
    value.ok('mask.retain', {'project': 'p1', 'keep': [keep]})
    assert get_derived(value, keep)[1] == b'keep me'
    assert sorted(path.name for path in folder.iterdir()) == sorted([f'{keep}.reopen', f'{keep}.future', 'notes.txt'])
    assert value.error('mask.derived.put', {'project': 'p1', 'manifest': drop, 'kind': 'reopen', 'handle': upload(value, b'x')}) == ('INVALID_REQUEST', 'manifest')


def test_copy_does_not_carry_derived_files(engine):
    value = engine()
    manifest = committed_version(value)
    put_derived(value, manifest, b'cache')
    page = value.ok('mask.copy', {'from': 'p1', 'to': 'p2', 'manifest': manifest, 'start': 0})[0]
    assert page['next'] is None
    assert get_derived(value, manifest, project='p2') == ({'found': False}, b'')


# ---- Card M8.4.18c: export and import of a stored version (folder backup and restore, contract §8.7) ----

def export(value, manifest, blobs=None, project='p1'):
    """``{name: bytes}`` of a ``mask.export``; each file's bytes are checked against its announced SHA-256."""
    result, binary = value.ok('mask.export', {'project': project, 'manifest': manifest, 'blobs': blobs})
    joined, offset, out = b''.join(binary), 0, {}
    assert result['frames'] == [len(part) for part in binary] and all(len(part) <= MAX_CHUNK for part in binary)
    for item in result['files']:
        data = joined[offset:offset + item['byte_length']]
        assert hashlib.sha256(data).hexdigest() == item['sha256']
        out[item['name']] = data
        offset += item['byte_length']
    assert offset == len(joined)
    return out


def import_files(value, kind, files, project='p1'):
    joined = b''.join(data for _, data in files)
    return value.call('mask.import', {'project': project, 'kind': kind, 'handle': upload(value, joined),
                                      'files': [{'name': name, 'byte_length': len(data)} for name, data in files]})[0]


def backup_of(value, manifest, project='p1'):
    """Every file of a stored version as a backup folder holds them: ``(manifest bytes, {blob name: zlib stream})``."""
    text = export(value, manifest, project=project)[manifest]
    names = sorted(masks.MaskStore(Path(value.coordinator.projects_root) / project / 'tiles').blob_lengths(manifest))
    blobs = {}
    for start in range(0, len(names), masks.EXPORT_PAGE):
        blobs.update(export(value, manifest, names[start:start + masks.EXPORT_PAGE], project=project))
    return text, blobs


def test_a_version_exported_from_one_store_is_imported_into_another_and_reads_identically(engine):
    value = engine()
    manifest = committed_version(value)
    text, blobs = backup_of(value, manifest)
    assert hashlib.sha256(text).hexdigest() == manifest and len(blobs) == 7    # one tile and six tables
    for name, raw in blobs.items():                                            # the files as stored: zlib streams of the named bytes
        assert hashlib.sha256(zlib.decompress(raw)).hexdigest() == name
    assert import_files(value, 'manifest', [(manifest, text)], project='p2')['error']['details']['field'] == 'blobs'   # blobs first
    response = import_files(value, 'blobs', sorted(blobs.items()), project='p2')
    assert response['status'] == 'ok' and response['result'] == {'accepted': [True] * 7}
    assert import_files(value, 'manifest', [(manifest, text)], project='p2')['result'] == {'manifest': manifest}
    for project in ('p1', 'p2'):
        _, binary = value.ok('mask.read', {'project': project, 'manifest': manifest, 'layer': 'labels', 'positions': [[0, 0]]})
        assert b''.join(binary) == labels_tile(5)[0]
    assert import_files(value, 'blobs', sorted(blobs.items()), project='p2')['result'] == {'accepted': [True] * 7}   # again: nothing changes


def test_an_import_refuses_a_corrupt_or_misnamed_blob_and_keeps_the_others(engine):
    value = engine()
    manifest = committed_version(value)
    text, blobs = backup_of(value, manifest)
    names = sorted(blobs)
    damaged = bytearray(blobs[names[0]])
    damaged[len(damaged) // 2] ^= 0xFF
    trailing = blobs[names[1]] + b'x'
    swapped = (names[2], blobs[names[3]])
    bomb = zlib.compress(bytes(masks.MAX_BLOB_BYTES + 1))                     # decompresses beyond the largest blob
    files = [(names[0], bytes(damaged)), (names[1], trailing), swapped, (names[4], blobs[names[4]]), (hashlib.sha256(b'b').hexdigest(), bomb)]
    assert import_files(value, 'blobs', files, project='p2')['result'] == {'accepted': [False, False, False, True, False]}
    store = Path(value.coordinator.projects_root) / 'p2' / 'tiles' / 'blobs'
    assert sorted(path.name for path in store.glob('*/*')) == [names[4]]      # only the good one was written
    assert import_files(value, 'manifest', [(manifest, text)], project='p2')['error']['details']['field'] == 'blobs'
    assert not (Path(value.coordinator.projects_root) / 'p2' / 'tiles' / 'manifests').exists()


def test_an_import_refuses_a_manifest_that_is_not_one(engine):
    value = engine()
    manifest = committed_version(value)
    text, blobs = backup_of(value, manifest)
    assert import_files(value, 'blobs', sorted(blobs.items()), project='p2')['status'] == 'ok'
    for name, data in ((manifest, text + b' '), ('1' * 64, text), (manifest, text.replace(b'"tile":512', b'"tile":513'))):
        response = import_files(value, 'manifest', [(name, data)], project='p2')
        assert (response['error']['code'], response['error']['details']['field']) == ('INVALID_BUFFER', 'manifest')
    assert not (Path(value.coordinator.projects_root) / 'p2' / 'tiles' / 'manifests').exists()


def test_export_and_import_requests_are_validated(engine):
    value = engine()
    manifest = committed_version(value)
    _, blobs = backup_of(value, manifest)
    name = sorted(blobs)[0]
    assert value.error('mask.export', {'project': 'p1', 'manifest': '1' * 64, 'blobs': None}) == ('INVALID_REQUEST', 'manifest')
    assert value.error('mask.export', {'project': 'p1', 'manifest': manifest, 'blobs': ['2' * 64]}) == ('INVALID_REQUEST', 'blobs')   # not named by it
    assert value.error('mask.export', {'project': 'p1', 'manifest': manifest, 'blobs': []}) == ('INVALID_REQUEST', 'blobs')
    assert value.error('mask.export', {'project': 'p1', 'manifest': manifest, 'blobs': [name] * (masks.EXPORT_PAGE + 1)}) == ('INVALID_REQUEST', 'blobs')
    assert value.error('mask.export', {'project': 'Bad', 'manifest': manifest, 'blobs': None}) == ('INVALID_REQUEST', 'project')
    handle = upload(value, blobs[name])
    base = {'project': 'p2', 'kind': 'blobs', 'handle': handle, 'files': [{'name': name, 'byte_length': len(blobs[name])}]}
    assert value.error('mask.import', {**base, 'kind': 'other'}) == ('INVALID_REQUEST', 'kind')
    assert value.error('mask.import', {**base, 'files': []}) == ('INVALID_REQUEST', 'files')
    assert value.error('mask.import', {**base, 'files': [{'name': 'x', 'byte_length': 1}]}) == ('INVALID_REQUEST', 'files')
    assert value.error('mask.import', {**base, 'files': [{'name': name, 'byte_length': len(blobs[name]) + 1}]}) == ('INVALID_BUFFER', 'files')
    assert value.error('mask.import', {**base, 'kind': 'manifest', 'files': base['files'] * 2}) == ('INVALID_REQUEST', 'files')


def test_export_refuses_a_damaged_blob(engine):
    value = engine()
    manifest = committed_version(value)
    tile = labels_tile(5)[1]
    path = Path(value.coordinator.projects_root) / 'p1' / 'tiles' / 'blobs' / tile[:2] / tile
    path.write_bytes(path.read_bytes()[:-3])
    value.coordinator.mask_cache.items.clear()
    assert value.error('mask.export', {'project': 'p1', 'manifest': manifest, 'blobs': [tile]}) == ('INVALID_BUFFER', 'tile')


# ---- Card M8.4.40: mask requests run on their own thread, in order; an open staged version is protected by its folder ----

def slow_disk(monkeypatch, name='retain'):
    """Make ``MaskStore.<name>`` wait until the test lets it go, as on a slow disk: ``(started, release)`` events."""
    started, release = threading.Event(), threading.Event()
    original = getattr(masks.MaskStore, name)

    def slow(self, *args):
        started.set()
        assert release.wait(5), 'the test did not let the mask request finish'
        return original(self, *args)
    monkeypatch.setattr(masks.MaskStore, name, slow)
    return started, release


def answered(value):
    return [item['id'] for kind, item in frames(value.output) if kind == 'json']


def test_tile_reads_and_cancellations_are_answered_while_a_mask_request_runs(engine, monkeypatch):
    value = engine(pyramids=True)
    pyramid, tile = hand_made_pyramid(Path(value.coordinator.pyramid_root), 7)
    version = committed_version(value)
    started, release = slow_disk(monkeypatch)
    retain = request(value.session, 'mask.retain', {'project': 'p1', 'keep': [version]})
    value.coordinator.receive(retain)                                      # returns at once: the store works on the MaskIO thread
    assert started.wait(5)
    read = request(value.session, 'tile.read', {'pyramid': pyramid, 'level': 0, 'positions': [[0, 0]]})
    cancel = request(value.session, 'job.cancel', {'request_id': str(uuid4())})
    value.coordinator.receive(read)
    value.coordinator.receive(cancel)
    value.coordinator.poll()
    assert answered(value)[-2:] == [read['id'], cancel['id']] and retain['id'] not in answered(value)
    found = frames(value.output)
    at = next(k for k, (kind, item) in enumerate(found) if kind == 'json' and item['id'] == read['id'])
    assert found[at][1]['status'] == 'ok' and found[at + 1] == ('binary', tile)
    release.set()
    value.coordinator.answer_masks(wait=True)
    response = frames(value.output)[-1][1]
    assert response['id'] == retain['id'] and response['status'] == 'ok', response


def test_mask_requests_run_in_the_order_they_arrived(engine):
    value = engine()
    staged = begin(value)['staged']
    tiles = [labels_tile(k + 1) for k in range(3)]
    tables = value.tables()
    sent = []
    for col, (data, sha) in enumerate(tiles):                             # sent one after another, without waiting for an answer
        sent.append(request(value.session, 'mask.put', {'staged': staged, 'layer': 'labels', 'row': col // 2, 'col': col % 2, 'sha256': sha}))
        value.coordinator.receive(sent[-1], data)
    sent.append(request(value.session, 'mask.commit', {'staged': staged, 'tables': tables}))
    value.coordinator.receive(sent[-1])
    value.coordinator.answer_masks(wait=True)
    responses = {item['id']: item for kind, item in frames(value.output) if kind == 'json'}
    assert [responses[item['id']]['status'] for item in sent] == ['ok'] * 4
    manifest = responses[sent[-1]['id']]['result']['manifest']
    read = value.ok('mask.read', {'project': 'p1', 'manifest': manifest, 'layer': 'labels', 'positions': [[0, 0], [0, 1], [1, 0]]})[1]
    assert b''.join(read) == b''.join(data for data, _ in tiles)


def test_a_buffer_released_after_a_mask_request_arrived_is_still_read_by_it(engine, monkeypatch):
    value = engine()
    manifest = committed_version(value)
    _, blobs = backup_of(value, manifest)
    files = sorted(blobs.items())
    handle = upload(value, b''.join(data for _, data in files))
    started, release = slow_disk(monkeypatch)
    value.coordinator.receive(request(value.session, 'mask.retain', {'project': 'p9', 'keep': []}))
    assert started.wait(5)
    item = request(value.session, 'mask.import', {'project': 'p2', 'kind': 'blobs', 'handle': handle,
                                                  'files': [{'name': name, 'byte_length': len(data)} for name, data in files]})
    value.coordinator.receive(item)
    value.coordinator.receive(request(value.session, 'buffer.release', {'handles': [handle]}))    # answered at once
    assert frames(value.output)[-1][1]['result'] == {'released': [handle]}
    release.set()
    value.coordinator.answer_masks(wait=True)
    response = next(found for kind, found in frames(value.output) if kind == 'json' and found['id'] == item['id'])
    assert response['result'] == {'accepted': [True] * len(files)}
    assert handle not in value.coordinator.store.buffers, 'unpinned and removed once answered'


def test_shutdown_answers_the_mask_requests_received_before_it(engine, monkeypatch):
    value = engine()
    started, release = slow_disk(monkeypatch)
    retain = request(value.session, 'mask.retain', {'project': 'p1', 'keep': []})
    value.coordinator.receive(retain)
    assert started.wait(5)
    threading.Timer(0.2, release.set).start()
    shutdown = request(value.session, 'shutdown', {})
    value.coordinator.receive(shutdown)
    assert answered(value)[-2:] == [retain['id'], shutdown['id']]


def test_an_unexpected_error_on_the_mask_thread_still_ends_the_session(engine, monkeypatch):
    value = engine()
    manifest = committed_version(value)

    def broken(*_arguments):
        raise RuntimeError('a bug')
    monkeypatch.setattr(masks.MaskStore, 'info', broken)
    with pytest.raises(RuntimeError):
        value.call('mask.info', {'project': 'p1', 'manifest': manifest, 'start': 0})


def test_an_open_staged_version_keeps_its_blobs_after_its_store_left_the_open_stores(engine):
    """At most 64 stores stay open; a staged version still holds its own. Retain and forget recognise it by folder, not by object."""
    value = engine()
    staged = begin(value)['staged']
    pending = labels_tile(42)
    put(value, staged, *pending)
    for k in range(64):                                                    # 64 other projects push the store of p1 out
        value.ok('mask.retain', {'project': f'q{k}', 'keep': []})
    assert 'p1' not in value.coordinator.mask_stores
    assert value.error('mask.forget', {'project': 'p1'}) == ('BUSY', None)
    value.ok('mask.retain', {'project': 'p1', 'keep': []})
    assert pending[1] in stored_names(value)[1], 'the open staged version kept its tile'
    manifest = value.ok('mask.commit', {'staged': staged, 'tables': value.tables()})[0]['manifest']
    assert b''.join(value.ok('mask.read', {'project': 'p1', 'manifest': manifest, 'layer': 'labels', 'positions': [[0, 0]]})[1]) == pending[0]


def test_mask_slice_through_the_engine_reuses_blobs_and_returns_present_objects(engine, tmp_path):
    """Card M8.4.43: mask.slice writes a new version for tile rows [row0, row1), returns kept object IDs and stack indices in binary frames,
    reuses tile blobs, and refuses damaged blobs and bad arguments."""
    value = engine()
    staged = begin(value)['staged']                                         # W=600, H=1100 -> 3 tile rows, 2 cols
    t0 = labels_tile(10, rows=512, cols=512)
    t2 = labels_tile(20, rows=76, cols=512)                                 # row 2: 1100 - 1024 = 76 rows inside
    put(value, staged, *t0, row=0, col=0)
    put(value, staged, *t2, row=2, col=0)
    tables = {'object_ids': value.buffer(np.array([10, 20, 30], dtype='<u4').tobytes(), 'u32le'),
              'object_class': value.buffer(np.array([0, 0, -1], dtype='<i4').tobytes(), 'i32le'),
              'object_predicted': value.buffer(np.array([-1, -1, -1], dtype='<i4').tobytes(), 'i32le'),
              'object_confidence': value.buffer(np.array([0.0, 0.5, 0.0], dtype='<f8').tobytes(), 'f64le'),
              'classes': value.buffer(json.dumps([{'id': 'a', 'name': 'Burrow', 'counts': True}]).encode(), 'utf8json'),
              'stack_offsets': value.buffer(np.array([0, 0], dtype='<u4').tobytes(), 'u32le')}
    src = value.ok('mask.commit', {'staged': staged, 'tables': tables})[0]['manifest']

    res0, bin0 = value.ok('mask.slice', {'project': 'p1', 'manifest': src, 'section': 'p_top', 'row0': 0, 'row1': 2})
    res1, bin1 = value.ok('mask.slice', {'project': 'p1', 'manifest': src, 'section': 'p_bot', 'row0': 2, 'row1': 3})
    raw0, raw1 = b''.join(bin0), b''.join(bin1)
    assert res0['height'] == 1024 and res0['object_count'] == 1 and res0['stack_count'] == 0 and res0['sha256'] == hashlib.sha256(raw0).hexdigest()
    assert res1['height'] == 76 and res1['object_count'] == 1 and res1['stack_count'] == 0 and res1['sha256'] == hashlib.sha256(raw1).hexdigest()
    assert np.frombuffer(raw0, dtype='<u4').tolist() == [10]
    assert np.frombuffer(raw1, dtype='<u4').tolist() == [20]
    assert b''.join(value.ok('mask.read', {'project': 'p1', 'manifest': res0['manifest'], 'layer': 'labels', 'positions': [[0, 0]]})[1]) == t0[0]
    assert b''.join(value.ok('mask.read', {'project': 'p1', 'manifest': res1['manifest'], 'layer': 'labels', 'positions': [[0, 0]]})[1]) == t2[0]
    assert value.error('mask.slice', {'project': 'p1', 'manifest': src, 'section': 'p_bad', 'row0': 2, 'row1': 2}) == ('INVALID_REQUEST', 'rows')

    # Session commit tracking keeps the newly sliced manifest when retain runs before the page names it.
    value.ok('mask.retain', {'project': 'p1', 'keep': [src]})
    assert res0['manifest'] in stored_names(value)[0] and res1['manifest'] in stored_names(value)[0]

    # Damaged blob is refused cleanly.
    blob_path = tmp_path / 'projects' / 'p1' / 'tiles' / 'blobs' / t2[1][:2] / t2[1]
    blob_path.write_bytes(b'damaged')
    value.ok('mask.forget', {'project': 'p1'})
    assert value.error('mask.slice', {'project': 'p1', 'manifest': src, 'section': 'p_fail', 'row0': 2, 'row1': 3}) == ('INVALID_BUFFER', 'tile')
