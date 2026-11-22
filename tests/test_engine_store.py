"""The tile store through the engine's coordinator (card M8.4.14, contract §8.5): pyramid.build as a worker job with progress
events, pyramid.info, and tile.read with verified tiles in several binary frames."""

import hashlib
import importlib
import io
import sys
import time
import zlib
from pathlib import Path
from uuid import uuid4

import numpy as np
import pytest
from PIL import Image

from conftest import require_pyvips

require_pyvips()

from sedcoretool.engine import worker as engine_worker  # noqa: E402
from sedcoretool.engine.protocol import BINARY_FRAME, MAX_CHUNK, read_frame, strict_json  # noqa: E402
from sedcoretool.engine.server import Coordinator  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]


def request(session, operation, payload):
    return {'v': 1, 'kind': 'request', 'session': session, 'id': str(uuid4()), 'op': operation, 'payload': payload}


def frames(coordinator):
    """Every frame written so far: ('json', value) or ('binary', bytes), in order."""
    stream, out = io.BytesIO(coordinator.output.getvalue()), []
    while frame := read_frame(stream):
        out.append(('binary', frame[1]) if frame[0] == BINARY_FRAME else ('json', strict_json(frame[1])))
    return out


def answer(coordinator, request_id):
    """The terminal response of a request, the binary frames right after it, and the events sent for it."""
    found = frames(coordinator)
    events = [value for kind, value in found if kind == 'json' and value['id'] == request_id and value['kind'] == 'event']
    for index, (kind, value) in enumerate(found):
        if kind == 'json' and value['id'] == request_id and value['kind'] == 'response':
            following = []
            for kind2, value2 in found[index + 1:]:
                if kind2 != 'binary':
                    break
                following.append(value2)
            return value, following, events
    return None, [], events


def wait(coordinator, request_id, seconds=60):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        coordinator.poll()
        response, binary, events = answer(coordinator, request_id)
        if response is not None and coordinator.active is None:
            return response, binary, events
        time.sleep(0.01)
    raise AssertionError('no answer')


@pytest.fixture
def engine(tmp_path):
    coordinators = []

    def make(pyramids=True):
        coordinator = Coordinator(io.BytesIO(), version='test', runtime_id='0' * 64, scratch_directory=str(tmp_path / 'scratch'),
                                  pyramid_directory=str(tmp_path / 'pyramids') if pyramids else None, pyramid_budget=50 * 2**30)
        session = str(uuid4())
        coordinator.receive(request(session, 'hello', {'protocol': 1}))
        coordinators.append(coordinator)
        return coordinator, session
    (tmp_path / 'scratch').mkdir()
    yield make
    for coordinator in coordinators:
        coordinator.close()


def source_png(tmp_path, size=(1100, 1300), seed=0):
    path = tmp_path / f'source-{seed}.png'
    Image.fromarray(np.random.default_rng(seed).integers(0, 256, size=(*size, 3), dtype=np.uint8)).save(path)
    return path


def build(coordinator, session, path, name='source.png'):
    item = request(session, 'pyramid.build', {'path': str(path), 'name': name})
    coordinator.receive(item)
    return wait(coordinator, item['id'])


def test_without_a_pyramid_folder_the_store_operations_are_unsupported(engine, tmp_path):
    coordinator, session = engine(pyramids=False)
    for operation, payload in (('pyramid.build', {'path': str(source_png(tmp_path)), 'name': 'x'}), ('pyramid.info', {'pyramid': '0' * 64}),
                               ('tile.read', {'pyramid': '0' * 64, 'level': 0, 'positions': [[0, 0]]})):
        item = request(session, operation, payload)
        coordinator.receive(item)
        assert answer(coordinator, item['id'])[0]['error']['code'] == 'UNSUPPORTED_METHOD'


def test_a_build_sends_progress_and_answers_once_then_is_reused(engine, tmp_path):
    coordinator, session = engine()
    source = source_png(tmp_path)
    response, binary, events = build(coordinator, session, source)
    assert response['status'] == 'ok' and binary == [], response
    result = response['result']
    assert result['pyramid'] == hashlib.sha256(source.read_bytes()).hexdigest()
    assert (result['width'], result['height'], result['channels'], result['bits'], result['levels'], result['reused']) == (1300, 1100, 3, 8, 3, False)
    assert events and all(set(event['payload']) == {'stage', 'completed', 'total'} for event in events)
    assert {event['payload']['stage'] for event in events} <= {'hash', 'level0', 'levels'}
    again, _, _ = build(coordinator, session, source)
    assert again.get('result') == {**result, 'reused': True}, again
    item = request(session, 'pyramid.info', {'pyramid': result['pyramid']})
    coordinator.receive(item)
    info = answer(coordinator, item['id'])[0]['result']
    assert info['source']['name'] == 'source.png' and info['levels'][1] == {'level': 1, 'width': 650, 'height': 550, 'rows': 2, 'cols': 2}
    assert not list((tmp_path / 'scratch').glob('*/job-*'))                     # job folders are removed


def test_tiles_arrive_verified_in_request_order_cut_into_frames_of_at_most_1_mib(engine, tmp_path):
    coordinator, session = engine()
    pyramid = build(coordinator, session, source_png(tmp_path))[0]['result']['pyramid']
    positions = [[1, 2], [0, 0], [1, 0], [0, 1]]
    item = request(session, 'tile.read', {'pyramid': pyramid, 'level': 0, 'positions': positions})
    coordinator.receive(item)
    response, binary, _ = answer(coordinator, item['id'])
    tiles = response['result']['tiles']
    assert [[tile['row'], tile['col']] for tile in tiles] == positions
    assert response['result']['frames'] == [len(part) for part in binary] and all(len(part) <= MAX_CHUNK for part in binary)
    joined = b''.join(binary)
    assert len(joined) == 4 * 512 * 512 * 3 == sum(tile['byte_length'] for tile in tiles)
    folder = tmp_path / 'pyramids' / pyramid / '0'
    for index, (row, col) in enumerate(positions):
        data = joined[index * 786432:(index + 1) * 786432]
        assert data == (folder / f'{row}.{col}.0').read_bytes()
        assert hashlib.sha256(data).hexdigest() == tiles[index]['sha256']


def test_store_requests_are_validated(engine, tmp_path):
    coordinator, session = engine()
    pyramid = build(coordinator, session, source_png(tmp_path))[0]['result']['pyramid']
    cases = [
        ('pyramid.build', {'path': 'relative/source.png', 'name': 'x'}, 'INVALID_REQUEST', 'path'),
        ('pyramid.build', {'path': str(tmp_path / 'missing.png'), 'name': 'x'}, 'UNSUPPORTED_INPUT', 'source'),
        ('pyramid.build', {'path': str(tmp_path), 'name': 'x'}, 'UNSUPPORTED_INPUT', 'source'),
        ('pyramid.build', {'path': str(source_png(tmp_path, seed=1)), 'name': '../x'}, 'INVALID_REQUEST', 'name'),
        ('pyramid.build', {'path': str(source_png(tmp_path, seed=1)), 'name': 'x', 'extra': 1}, 'INVALID_REQUEST', None),
        ('pyramid.build', {'path': str(source_png(tmp_path, seed=1)), 'name': 'x', 'expect': 'F' * 64}, 'INVALID_REQUEST', 'expect'),
        ('pyramid.info', {'pyramid': 'f' * 64}, 'INVALID_REQUEST', 'pyramid'),
        ('pyramid.info', {'pyramid': '../' + pyramid[3:]}, 'INVALID_REQUEST', 'pyramid'),
        ('tile.read', {'pyramid': pyramid, 'level': 3, 'positions': [[0, 0]]}, 'INVALID_REQUEST', 'level'),
        ('tile.read', {'pyramid': pyramid, 'level': 0, 'positions': [[3, 0]]}, 'INVALID_REQUEST', 'positions'),
        ('tile.read', {'pyramid': pyramid, 'level': 0, 'positions': [[0, 3]]}, 'INVALID_REQUEST', 'positions'),
        ('tile.read', {'pyramid': pyramid, 'level': 0, 'positions': [[0, 0]] * 17}, 'INVALID_REQUEST', 'positions'),
        ('tile.read', {'pyramid': pyramid, 'level': 0, 'positions': []}, 'INVALID_REQUEST', 'positions'),
        ('tile.read', {'pyramid': pyramid, 'level': True, 'positions': [[0, 0]]}, 'INVALID_REQUEST', 'level'),
    ]
    for operation, payload, code, field in cases:
        item = request(session, operation, payload)
        coordinator.receive(item)
        response, binary, _ = answer(coordinator, item['id'])
        assert response['status'] == 'error' and response['error']['code'] == code, (operation, payload, response)
        if field:
            assert response['error']['details'] == {'field': field}
        assert binary == []


def test_a_build_that_expects_another_sha256_is_refused(engine, tmp_path):
    """Card M8.4.18b: locating a moved source sends the saved SHA-256 as ``expect``; another file ends the job with an error."""
    coordinator, session = engine()
    source = source_png(tmp_path)
    pyramid = build(coordinator, session, source)[0]['result']['pyramid']
    for path, expect, outcome in ((source_png(tmp_path, seed=1), pyramid, ('UNSUPPORTED_INPUT', 'source.sha256')), (source, pyramid, None)):
        item = request(session, 'pyramid.build', {'path': str(path), 'name': 'source.png', 'expect': expect})
        coordinator.receive(item)
        response = wait(coordinator, item['id'])[0]
        if outcome:
            assert response['status'] == 'error' and (response['error']['code'], response['error']['details']['field']) == outcome
        else:
            assert response['result']['pyramid'] == pyramid and response['result']['reused'] is True


def test_an_altered_or_missing_tile_is_never_served(engine, tmp_path):
    coordinator, session = engine()
    pyramid = build(coordinator, session, source_png(tmp_path))[0]['result']['pyramid']
    tile = tmp_path / 'pyramids' / pyramid / '0' / '0.1.0'
    data = bytearray(tile.read_bytes())
    data[1000] ^= 1
    tile.write_bytes(bytes(data))
    for positions in ([[0, 1]], [[0, 0], [0, 1]]):                              # alone, or after a good tile: nothing at all is sent
        item = request(session, 'tile.read', {'pyramid': pyramid, 'level': 0, 'positions': positions})
        coordinator.receive(item)
        response, binary, _ = answer(coordinator, item['id'])
        assert response['error']['code'] == 'INVALID_BUFFER' and response['error']['details'] == {'field': 'tile'} and binary == []
    (tmp_path / 'pyramids' / pyramid / '1' / '0.0.0').unlink()
    item = request(session, 'tile.read', {'pyramid': pyramid, 'level': 1, 'positions': [[0, 0]]})
    coordinator.receive(item)
    assert answer(coordinator, item['id'])[0]['error']['code'] == 'INVALID_BUFFER'


def test_compressed_tiles_are_served_uncompressed(engine, tmp_path):
    coordinator, session = engine()
    coordinator.pyramid_compressor = {'id': 'zlib', 'level': 1}
    source = tmp_path / 'smooth.png'
    gradient = np.add.outer(np.arange(1100), np.arange(1300)) % 256
    Image.fromarray(np.stack([gradient, gradient // 2, 255 - gradient], axis=-1).astype(np.uint8)).save(source)
    pyramid = build(coordinator, session, source)[0]['result']['pyramid']
    raw = (tmp_path / 'pyramids' / pyramid / '0' / '0.0.0').read_bytes()
    assert len(raw) < 786432                                                     # stored compressed
    item = request(session, 'tile.read', {'pyramid': pyramid, 'level': 0, 'positions': [[0, 0]]})
    coordinator.receive(item)
    _, binary, _ = answer(coordinator, item['id'])
    assert b''.join(binary) == zlib.decompress(raw) and len(b''.join(binary)) == 786432


def test_a_cancelled_build_answers_cancelled_and_leaves_nothing(engine, tmp_path):
    coordinator, session = engine()
    sys.path.insert(0, str(ROOT / 'tools'))
    gen = importlib.import_module('make_large_fixtures')
    sys.path.pop(0)
    source = tmp_path / 'big.tif'
    gen.write_bigtiff(source, width=gen.WIDTH, rows=6000, channels=3, bits=8, kind='tiled', compression=1)
    item = request(session, 'pyramid.build', {'path': str(source), 'name': 'big.tif'})
    coordinator.receive(item)
    coordinator.receive(request(session, 'job.cancel', {'request_id': item['id']}))
    response, _, _ = wait(coordinator, item['id'])
    assert response['status'] == 'cancelled'
    until = time.monotonic() + 10                                                  # the worker deletes the partial folder after answering
    while any((tmp_path / 'pyramids').iterdir()) and time.monotonic() < until:
        time.sleep(0.02)
    assert [p.name for p in (tmp_path / 'pyramids').iterdir()] == []


def test_a_build_without_progress_is_stopped(engine, tmp_path, monkeypatch):
    monkeypatch.setattr(engine_worker.PyramidJob, 'stall_seconds', 0)
    coordinator, session = engine()
    response, _, _ = build(coordinator, session, source_png(tmp_path))
    assert response['status'] == 'error' and response['error']['code'] == 'INTERNAL'
    coordinator.receive(item := request(session, 'pyramid.info', {'pyramid': '0' * 64}))   # the coordinator still answers
    assert answer(coordinator, item['id'])[0]['status'] == 'error'


def test_a_starting_coordinator_removes_interrupted_builds(engine, tmp_path):
    (tmp_path / 'pyramids' / '.partial-abc' / '0').mkdir(parents=True)
    (tmp_path / 'pyramids' / '.partial-abc' / '0' / '0.0.0').write_bytes(b'x')
    engine()
    assert list((tmp_path / 'pyramids').iterdir()) == []
