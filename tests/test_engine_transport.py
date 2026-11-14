"""Private engine framing, admission, immutable ownership and worker failure regressions."""

import hashlib
import io
import json
import struct
import time
from pathlib import Path
from uuid import uuid4

import pytest

from sedcoretool.engine.buffers import MAX_HANDLES, TRANSIENT_RESERVE, BufferStore
from sedcoretool.engine.protocol import (
    HEADER,
    MAX_CHUNK,
    MAX_JSON,
    ProtocolError,
    RequestError,
    read_frame,
    strict_json,
    write_json,
)
from sedcoretool.engine.server import Coordinator
from sedcoretool.engine.worker import DigestJob


def committed(store, data=b'public synthetic bytes', dtype='u8'):
    handle = store.begin({'dtype': dtype, 'shape': [len(data)], 'byte_length': len(data),
                          'sha256': hashlib.sha256(data).hexdigest()})['handle']
    store.append({'handle': handle, 'offset': 0, 'byte_length': len(data)}, data)
    store.commit({'handle': handle})
    return handle


@pytest.mark.parametrize('value', [b'{"a":1,"a":2}', b'{"x":1e309}', b'{"x":NaN}', b'{"x":9007199254740992}',
                                   b'{"x":9007199254740992.0}', b'\xff', b'[' * 17 + b'0' + b']' * 17, b'{'])
def test_controls_reject_ambiguous_or_unbounded_json(value):
    with pytest.raises(ProtocolError):
        strict_json(value)


def test_negative_depths_and_escaped_strings_remain_valid_metadata():
    assert strict_json(b'{"top":-10,"bottom":0}') == {'top': -10, 'bottom': 0}
    text = '\u1234' * 1000
    assert strict_json(json.dumps([text]).encode(), metadata=True) == [text]
    with pytest.raises(ProtocolError):
        strict_json(json.dumps(['x' * 4097]).encode(), metadata=True)


@pytest.mark.parametrize('header', [HEADER.pack(b'BAD!', 1, 0, 0, 2), HEADER.pack(b'SCE1', 1, 1, 0, 2),
                                    HEADER.pack(b'SCE1', 2, 0, 1, 2), HEADER.pack(b'SCE1', 3, 0, 0, 2),
                                    HEADER.pack(b'SCE1', 1, 0, 0, MAX_JSON + 1), HEADER.pack(b'SCE1', 2, 0, 0, MAX_CHUNK + 1),
                                    HEADER.pack(b'SCE1', 1, 0, 0, 0), b'SCE'])
def test_frame_headers_fail_before_reading_payload(header):
    with pytest.raises(ProtocolError):
        read_frame(io.BytesIO(header))


def test_framing_round_trip_and_truncated_payload():
    stream = io.BytesIO()
    write_json(stream, {'top': -1, 'message': 'synthetic'})
    assert strict_json(read_frame(io.BytesIO(stream.getvalue()))[1])['top'] == -1
    assert read_frame(io.BytesIO()) is None
    with pytest.raises(ProtocolError):
        read_frame(io.BytesIO(stream.getvalue()[:-1]))


def test_commit_is_immutable_and_release_preserves_only_pinned_snapshots():
    store = BufferStore()
    try:
        handle = committed(store)
        value = store.get(handle, committed=True)
        with pytest.raises(RequestError):
            store.append({'handle': handle, 'offset': 0, 'byte_length': 1}, b'x')
        value.pins += 1
        store.release(handle)
        assert value.path.exists()
        with pytest.raises(RequestError):
            store.get(handle)
        store.unpin(handle)
        assert not value.path.exists()
        assert store.reserved == TRANSIENT_RESERVE
        store.release(handle)
    finally:
        directory = Path(store.directory.name)
        store.close()
    assert not directory.exists()


def test_invalid_shape_budget_offset_and_hash_never_commit():
    store = BufferStore(budget=TRANSIENT_RESERVE + 4)
    descriptor = {'dtype': 'u8', 'shape': [4], 'byte_length': 4, 'sha256': '0' * 64}
    try:
        for update in ({'shape': [2]}, {'shape': [True, 4]}, {'dtype': []}, {'shape': [2**53, 2**53]}):
            with pytest.raises(RequestError):
                store.begin({**descriptor, **update})
        handle = store.begin(descriptor)['handle']
        with pytest.raises(RequestError, match='LIMIT_EXCEEDED'):
            store.begin(descriptor)
        with pytest.raises(RequestError):
            store.append({'handle': handle, 'offset': 1, 'byte_length': 4}, b'abcd')
        with pytest.raises(RequestError):
            store.commit({'handle': handle})
        store.append({'handle': handle, 'offset': 0, 'byte_length': 4}, b'abcd')
        with pytest.raises(RequestError):
            store.commit({'handle': handle})
        assert not store.get(handle).committed
    finally:
        store.close()


def test_small_buffers_cannot_bypass_the_live_handle_limit():
    store = BufferStore()
    descriptor = {'dtype': 'u8', 'shape': [1], 'byte_length': 1, 'sha256': hashlib.sha256(b'a').hexdigest()}
    try:
        for _ in range(MAX_HANDLES):
            store.begin(descriptor)
        with pytest.raises(RequestError, match='LIMIT_EXCEEDED'):
            store.begin(descriptor)
        store.release(next(iter(store.buffers)))
        store.begin(descriptor)
        assert len(store.buffers) == MAX_HANDLES == 256
    finally:
        store.close()


@pytest.mark.parametrize('data,dtype,shape', [(b'{"a":1,"a":2}', 'utf8json', None),
                                            (struct.pack('<d', float('nan')), 'f64le', [1]),
                                            (struct.pack('<d', float('inf')), 'f64le', [1])])
def test_invalid_metadata_and_nonfinite_numeric_buffers_remain_staged(data, dtype, shape):
    store = BufferStore()
    try:
        handle = store.begin({'dtype': dtype, 'shape': shape or [len(data)], 'byte_length': len(data),
                              'sha256': hashlib.sha256(data).hexdigest()})['handle']
        store.append({'handle': handle, 'offset': 0, 'byte_length': len(data)}, data)
        with pytest.raises(RequestError):
            store.commit({'handle': handle})
        assert not store.get(handle).committed
    finally:
        store.close()


def request(session, operation, payload):
    return {'v': 1, 'kind': 'request', 'session': session, 'id': str(uuid4()), 'op': operation, 'payload': payload}


def responses(coordinator):
    stream = io.BytesIO(coordinator.output.getvalue())
    values = []
    while frame := read_frame(stream):
        values.append(strict_json(frame[1]))
    assert len({value['id'] for value in values}) == len(values), 'a request received more than one terminal response'
    return {value['id']: value for value in values}


def coordinator_fixture(worker_script):
    coordinator = Coordinator(io.BytesIO(), version='test', runtime_id='0' * 64, worker_script=worker_script)
    session = str(uuid4())
    coordinator.receive(request(session, 'hello', {'protocol': 1}))
    return coordinator, session, committed(coordinator.store)


def poll_until_idle(coordinator):
    deadline = time.monotonic() + 4
    while coordinator.active and time.monotonic() < deadline:
        coordinator.poll()
        time.sleep(0.01)
    assert coordinator.active is None


def test_queue_limits_cancel_and_release_are_independent_of_a_noncooperative_worker(tmp_path):
    worker = tmp_path / 'noncooperative.py'
    worker.write_text('import time\ntime.sleep(30)\n', encoding='utf-8')
    coordinator, session, handle = coordinator_fixture(worker)
    try:
        active = request(session, 'buffer.digest', {'handle': handle})
        coordinator.receive(active)
        queued = [request(session, 'buffer.digest', {'handle': handle}) for _ in range(4)]
        for item in queued:
            coordinator.receive(item)
        refused = request(session, 'buffer.digest', {'handle': handle})
        coordinator.receive(refused)
        assert responses(coordinator)[refused['id']]['error']['code'] == 'BUSY'
        cancel = request(session, 'job.cancel', {'request_id': queued[0]['id']})
        coordinator.receive(cancel)
        assert responses(coordinator)[queued[0]['id']]['status'] == 'cancelled'
        coordinator.receive(request(session, 'buffer.release', {'handles': [handle]}))
        assert coordinator.store.buffers[handle].pins == 4
        started = time.monotonic()
        coordinator.receive(request(session, 'job.cancel', {'request_id': active['id']}))
        while coordinator.active and coordinator.active['request']['id'] == active['id']:
            coordinator.poll()
            assert time.monotonic() - started < 3
            time.sleep(0.01)
        assert responses(coordinator)[active['id']]['status'] == 'cancelled'
        # A released handle is still valid for work admitted before release.
        assert coordinator.active is not None
        coordinator.cancel_all()
        assert handle not in coordinator.store.buffers
        assert all(responses(coordinator)[job['id']]['status'] == 'cancelled' for job in [active, *queued])
    finally:
        coordinator.close()


def test_worker_failure_is_terminal_and_the_coordinator_still_answers(tmp_path):
    worker = tmp_path / 'failed.py'
    worker.write_text('raise SystemExit(1)\n', encoding='utf-8')
    coordinator, session, handle = coordinator_fixture(worker)
    try:
        job = request(session, 'buffer.digest', {'handle': handle})
        coordinator.receive(job)
        poll_until_idle(coordinator)
        assert responses(coordinator)[job['id']]['error']['code'] == 'INTERNAL'
        after = request(session, 'job.cancel', {'request_id': job['id']})
        coordinator.receive(after)
        assert responses(coordinator)[after['id']]['result']['state'] == 'already_terminal'
        stale = request(str(uuid4()), 'buffer.release', {'handles': [handle]})
        with pytest.raises(ProtocolError):
            coordinator.receive(stale)
    finally:
        coordinator.close()


def test_lost_output_pipe_does_not_prevent_worker_and_snapshot_cleanup(tmp_path):
    worker = tmp_path / 'waiting.py'
    worker.write_text('import time\ntime.sleep(30)\n', encoding='utf-8')
    coordinator, session, handle = coordinator_fixture(worker)
    for _ in range(3):
        coordinator.receive(request(session, 'buffer.digest', {'handle': handle}))
    process = coordinator.active['worker'].process
    directory = Path(coordinator.store.directory.name)
    coordinator.output.close()
    coordinator.close()
    assert process.returncode is not None
    assert not directory.exists()


def test_worker_liveness_pipe_stops_orphaned_work_when_coordinator_disappears(tmp_path):
    source = tmp_path / 'public.bin'
    source.write_bytes(b'synthetic')
    script = tmp_path / 'waiting.py'
    engine_directory = Path(__file__).resolve().parents[1] / 'src/sedcoretool/engine'
    script.write_text(
        f'import sys, threading, time\nsys.path.insert(0, {str(engine_directory)!r})\n'
        'from worker import watch_coordinator\n'
        'threading.Thread(target=watch_coordinator, daemon=True).start()\ntime.sleep(30)\n', encoding='utf-8')
    job = DigestJob(source, script=script)
    try:
        job.process.stdin.close()
        assert job.process.wait(timeout=2) == 1
        job.reader.join(timeout=1)
        assert job.finished()
    finally:
        job.close()
