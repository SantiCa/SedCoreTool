"""Private engine framing, admission, immutable ownership and worker failure regressions."""

import hashlib
import io
import json
import os
import struct
import sys
import threading
import time
from pathlib import Path
from uuid import uuid4

import pytest

from sedcoretool.engine.buffers import MAX_HANDLES, TRANSIENT_RESERVE, BufferStore, all_finite_f64le
from sedcoretool.engine.protocol import (
    BINARY_FRAME,
    HEADER,
    JSON_FRAME,
    MAX_CHUNK,
    MAX_JSON,
    ProtocolError,
    RequestError,
    read_frame,
    strict_json,
    write_binary,
    write_json,
)
from sedcoretool.engine.server import Coordinator, CoordinatorInbox, MaskIO, serve
from sedcoretool.engine.worker import DigestJob, MethodJob, MethodRunner


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
        assert len(store.buffers) == MAX_HANDLES == 1024     # contract §9.7 (card M8.5.2); was 256
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


# ---- one packed result file (card M8.4.3) ----------------------------------------------------------------------------------

DTYPE_NAMES = {"<u4": "u32le", "<f8": "f64le", "|u1": "u8", "<u8": "u64le"}


def packed_file(tmp_path, columns, name="result.bin"):
    """Write columns one after another, each at a multiple of 8, the way the worker does. Returns (path, byte_length, sha256, layout)."""
    layout, chunks, offset = {}, [], 0
    for key, array in columns.items():
        data = array.tobytes()
        layout[key] = {"dtype": DTYPE_NAMES[array.dtype.str], "shape": list(array.shape), "offset": offset, "byte_length": len(data)}
        chunks.append((offset, data))
        offset += -(-len(data) // 8) * 8
    body = bytearray(offset)
    for start, data in chunks:
        body[start:start + len(data)] = data
    path = tmp_path / name
    path.write_bytes(bytes(body))
    return path, offset, hashlib.sha256(bytes(body)).hexdigest(), layout


def test_a_packed_file_becomes_one_buffer_and_keeps_its_layout(tmp_path):
    import numpy as np
    store = BufferStore()
    try:
        a, b, c = np.arange(3, dtype="<u4"), np.array([1.5, -2.0], dtype="<f8"), np.array([[1, 2, 3], [4, 5, 6]], dtype="u1")
        path, length, digest, layout = packed_file(tmp_path, {"a": a, "b": b, "c": c})
        assert (length, layout["b"]["offset"], layout["c"]["offset"]) == (40, 16, 32)
        reserved = store.reserved
        handle, adopted = store.adopt_packed(path, length, digest, layout)
        assert adopted == layout and not path.exists(), "the file moved into the store"
        value = store.buffers[handle]
        assert (value.dtype, value.length, value.shape, value.committed, value.expected_hash) == ("u8", 40, (40,), True, digest)
        assert store.reserved == reserved + 40
        data = value.path.read_bytes()
        np.testing.assert_array_equal(np.frombuffer(data, "<u4", 3, 0), a)
        np.testing.assert_array_equal(np.frombuffer(data, "<f8", 2, 16), b)
        np.testing.assert_array_equal(np.frombuffer(data, "u1", 6, 32).reshape(2, 3), c)
        store.release(handle)
        assert store.reserved == reserved and not store.buffers
    finally:
        store.close()


def test_a_packed_file_is_refused_when_anything_in_it_cannot_be_trusted(tmp_path):
    import copy

    import numpy as np
    store = BufferStore()
    try:
        columns = {"a": np.arange(3, dtype="<u4"), "b": np.array([1.5, 2.5], dtype="<f8")}

        def attempt(mutate, code="INVALID_BUFFER|INVALID_REQUEST", columns=columns):
            path, length, digest, layout = packed_file(tmp_path, columns)
            layout = copy.deepcopy(layout)
            args = mutate(path, length, digest, layout) or (path, length, digest, layout)
            reserved, count = store.reserved, len(store.buffers)
            before = sorted(p.name for p in Path(store.directory.name).iterdir())
            with pytest.raises(RequestError, match=code):
                store.adopt_packed(*args)
            assert store.reserved == reserved and len(store.buffers) == count, "nothing adopted"
            assert sorted(p.name for p in Path(store.directory.name).iterdir()) == before, "no file left behind"

        attempt(lambda p, n, d, lay: (p, n, "0" * 64, lay))                                                  # a hash that is not the file's
        attempt(lambda p, n, d, lay: (p, n, d.upper(), lay))                                                 # a hash that is not lower-case hexadecimal
        attempt(lambda p, n, d, lay: (p, n + 8, d, lay))                                                     # a size that is not the file's
        attempt(lambda p, n, d, lay: (p, n - 8, d, lay))
        attempt(lambda p, n, d, lay: (p, 0, d, lay))
        attempt(lambda p, n, d, lay: (p, n, d, {}))                                                          # no columns
        attempt(lambda p, n, d, lay: lay["b"].update(offset=12))                                             # misaligned
        attempt(lambda p, n, d, lay: lay["b"].update(offset=0))                                              # overlapping
        attempt(lambda p, n, d, lay: lay["b"].update(offset=24))                                             # past the end
        attempt(lambda p, n, d, lay: lay["b"].update(shape=[3]))                                             # shape and length disagree
        attempt(lambda p, n, d, lay: lay["b"].update(shape=[0, 2]))
        attempt(lambda p, n, d, lay: lay["b"].update(shape=[1, 1, 1, 2]))
        attempt(lambda p, n, d, lay: lay["b"].update(dtype="utf8json", shape=[16]))                          # a metadata type with a consistent length
        attempt(lambda p, n, d, lay: lay["b"].update(dtype="f32le"))
        attempt(lambda p, n, d, lay: lay["b"].update(byte_length=0))
        attempt(lambda p, n, d, lay: lay["b"].update(path="/etc/passwd"))                                    # an extra field
        attempt(lambda p, n, d, lay: lay["a"].update(offset=True))                                           # not an integer
        attempt(lambda p, n, d, lay: lay.pop("b"))                                                           # data that no column accounts for
        attempt(lambda p, n, d, lay: (p.with_name("missing.bin"), n, d, lay))
        attempt(lambda p, n, d, lay: (p, n, d, [lay]))                                                       # a layout that is not a mapping
        attempt(lambda p, n, d, lay: (p, True, d, lay))
        bad = {"a": np.arange(3, dtype="<u4"), "b": np.array([1.0, float("nan")], dtype="<f8")}
        attempt(lambda p, n, d, lay: None, columns=bad)                                                      # non-finite float data
        attempt(lambda p, n, d, lay: None, columns={"b": np.array([1.0, float("inf")], dtype="<f8")})
        many = {f"c{i}": np.arange(1, dtype="<u4") for i in range(65)}
        attempt(lambda p, n, d, lay: None, columns=many)                                                     # 65 columns, all valid by themselves
        ok = {f"c{i}": np.arange(1, dtype="<u4") for i in range(64)}
        path, length, digest, layout = packed_file(tmp_path, ok)
        store.release(store.adopt_packed(path, length, digest, layout)[0])                                   # 64 are allowed
        small = BufferStore(budget=TRANSIENT_RESERVE + 20)
        try:
            path, length, digest, layout = packed_file(tmp_path, columns)
            with pytest.raises(RequestError, match="LIMIT_EXCEEDED"):
                small.adopt_packed(path, length, digest, layout)
            assert small.reserved == TRANSIENT_RESERVE and not small.buffers and path.exists()
        finally:
            small.close()
    finally:
        store.close()


def test_a_symbolic_link_is_not_followed(tmp_path):
    import numpy as np
    store = BufferStore()
    try:
        path, length, digest, layout = packed_file(tmp_path, {"a": np.arange(3, dtype="<u4")})
        link = tmp_path / "link.bin"
        try:
            link.symlink_to(path)
        except OSError:
            pytest.skip("this account may not create symbolic links (Windows without developer mode)")
        with pytest.raises(RequestError, match="INVALID_BUFFER"):
            store.adopt_packed(link, length, digest, layout)
        assert not store.buffers
    finally:
        store.close()


def test_a_float_column_is_checked_in_every_part_of_a_large_file(tmp_path):
    import numpy as np
    store = BufferStore()
    try:
        values = np.linspace(0, 1, 300_000)                       # 2.4 MB: the check crosses the 1 MiB read size
        path, length, digest, layout = packed_file(tmp_path, {"x": values})
        handle, _ = store.adopt_packed(path, length, digest, layout)
        store.release(handle)
        values[250_000] = float("nan")
        path, length, digest, layout = packed_file(tmp_path, {"x": values})
        with pytest.raises(RequestError, match="INVALID_BUFFER"):
            store.adopt_packed(path, length, digest, layout)
    finally:
        store.close()


def test_packing_respects_the_handle_limit(tmp_path):
    import numpy as np
    store = BufferStore()
    descriptor = {"dtype": "u8", "shape": [1], "byte_length": 1, "sha256": hashlib.sha256(b"a").hexdigest()}
    try:
        for _ in range(MAX_HANDLES):
            store.begin(descriptor)
        path, length, digest, layout = packed_file(tmp_path, {"a": np.arange(2, dtype="<u4")})
        with pytest.raises(RequestError, match="LIMIT_EXCEEDED"):
            store.adopt_packed(path, length, digest, layout)
    finally:
        store.close()


# ---- buffers derived from a committed one (card M8.4.4) ---------------------------------------------------------------------

def derive_descriptor(base_handle, data, dtype="u8", shape=None):
    return {"base": base_handle, "dtype": dtype, "shape": shape or [len(data)], "byte_length": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def test_a_derived_buffer_is_the_base_with_the_changed_parts_replaced():
    store = BufferStore()
    base = bytes(range(200)) * 5000                                    # 1 MB
    try:
        handle = committed(store, base)
        edited = bytearray(base)
        edited[300_000:300_100] = b"\xff" * 100
        edited[700_000:700_005] = b"\x01" * 5
        derived = store.derive(derive_descriptor(handle, bytes(edited)))["handle"]
        assert store.append({"handle": derived, "offset": 300_000, "byte_length": 100}, b"\xff" * 100) == {"next_offset": 300_100}
        assert store.append({"handle": derived, "offset": 700_000, "byte_length": 5}, b"\x01" * 5) == {"next_offset": 700_005}
        assert store.commit({"handle": derived})["sha256"] == hashlib.sha256(bytes(edited)).hexdigest()
        assert store.buffers[derived].path.read_bytes() == bytes(edited) and store.buffers[derived].committed
        assert store.buffers[handle].path.read_bytes() == base, "the base is untouched"
        assert store.reserved == TRANSIENT_RESERVE + 2 * len(base), "the copy is charged to the session budget"
        with pytest.raises(RequestError):
            store.append({"handle": derived, "offset": 800_000, "byte_length": 1}, b"x")   # immutable once committed
    finally:
        store.close()


def test_a_derived_buffer_with_no_change_commits_and_a_change_that_was_missed_does_not():
    store = BufferStore()
    base = b"0123456789" * 1000
    try:
        handle = committed(store, base)
        same = store.derive(derive_descriptor(handle, base))["handle"]
        assert store.commit({"handle": same})["sha256"] == hashlib.sha256(base).hexdigest()
        edited = bytearray(base)
        edited[10:20] = b"X" * 10
        missed = store.derive(derive_descriptor(handle, bytes(edited)))["handle"]           # the client announces an edit but sends nothing
        with pytest.raises(RequestError) as refusal:
            store.commit({"handle": missed})
        assert (refusal.value.code, refusal.value.field) == ("INVALID_BUFFER", "sha256")
        assert not store.buffers[missed].committed, "a buffer whose content is not the declared one never commits"
        wrong = store.derive(derive_descriptor(handle, bytes(edited)))["handle"]
        store.append({"handle": wrong, "offset": 10, "byte_length": 10}, b"Y" * 10)         # the wrong bytes
        with pytest.raises(RequestError) as refusal:
            store.commit({"handle": wrong})
        assert refusal.value.field == "sha256"
    finally:
        store.close()


def test_chunks_of_a_derived_buffer_must_ascend_and_stay_inside():
    store = BufferStore()
    base = bytes(1000)
    try:
        handle = committed(store, base)
        derived = store.derive(derive_descriptor(handle, base))["handle"]
        store.append({"handle": derived, "offset": 100, "byte_length": 50}, bytes(50))
        for offset, length in ((120, 10), (149, 5), (0, 10), (990, 11), (1000, 1)):          # behind, overlapping, before, past the end
            with pytest.raises(RequestError):
                store.append({"handle": derived, "offset": offset, "byte_length": length}, bytes(length))
        store.append({"handle": derived, "offset": 150, "byte_length": 10}, bytes(10))      # touching is fine
        with pytest.raises(RequestError):
            store.append({"handle": derived, "offset": 200, "byte_length": 10}, bytes(9))    # length and data disagree
        with pytest.raises(RequestError):
            store.append({"handle": derived, "offset": 200, "byte_length": 10}, None)
    finally:
        store.close()


def test_only_a_committed_buffer_of_the_same_kind_can_be_a_base():
    store = BufferStore()
    data = bytes(64)
    try:
        handle = committed(store, data)
        meta = committed(store, b'{"a":1}', "utf8json")
        staged = store.begin({"dtype": "u8", "shape": [64], "byte_length": 64, "sha256": hashlib.sha256(data).hexdigest()})["handle"]
        released = committed(store, b"released bytes!!")
        store.release(released)
        for descriptor in (
                derive_descriptor(staged, data),                                            # not committed
                derive_descriptor(released, b"released bytes!!"),                           # released
                derive_descriptor(str(uuid4()), data),                                      # unknown
                derive_descriptor(meta, b'{"a":1}', "utf8json"),                            # metadata cannot be derived
                {**derive_descriptor(handle, data), "dtype": "i32le", "shape": [16]},        # another type
                {**derive_descriptor(handle, data), "shape": [8, 8]},                        # another shape
                {**derive_descriptor(handle, data), "byte_length": 63},                      # another length
                {**derive_descriptor(handle, data), "sha256": "Z" * 64},
                {**derive_descriptor(handle, data), "base": 5},
        ):
            reserved, count = store.reserved, len(store.buffers)
            with pytest.raises(RequestError):
                store.derive(descriptor)
            assert store.reserved == reserved and len(store.buffers) == count, "a refused derive leaves nothing behind"
        with pytest.raises(RequestError):
            store.derive({key: value for key, value in derive_descriptor(handle, data).items() if key != "sha256"})
    finally:
        store.close()


def test_deriving_respects_the_budget_and_the_handle_limit():
    store = BufferStore(budget=TRANSIENT_RESERVE + 150)
    data = bytes(100)
    try:
        handle = committed(store, data)
        with pytest.raises(RequestError, match="LIMIT_EXCEEDED"):
            store.derive(derive_descriptor(handle, data))
        assert store.reserved == TRANSIENT_RESERVE + 100 and len(store.buffers) == 1 and len(list(Path(store.directory.name).iterdir())) == 1
    finally:
        store.close()
    store = BufferStore()
    try:
        handle = committed(store, data)
        for _ in range(MAX_HANDLES - 1):
            store.begin({"dtype": "u8", "shape": [1], "byte_length": 1, "sha256": hashlib.sha256(b"a").hexdigest()})
        with pytest.raises(RequestError, match="LIMIT_EXCEEDED"):
            store.derive(derive_descriptor(handle, data))
    finally:
        store.close()


def test_a_derived_buffer_works_through_the_coordinator_and_analyses_like_a_buffer_sent_in_full():
    import io
    from uuid import uuid4 as new_id

    coordinator = Coordinator(io.BytesIO(), version="test", runtime_id="0" * 64)
    session = str(new_id())

    def send(operation, payload, data=None):
        message = {"v": 1, "kind": "request", "session": session, "id": str(new_id()), "op": operation, "payload": payload}
        coordinator.receive(message, data)
        stream = io.BytesIO(coordinator.output.getvalue())
        found = None
        while frame := read_frame(stream):
            if frame[0] == JSON_FRAME:
                value = strict_json(frame[1])
                if value["id"] == message["id"]:
                    found = value
        return found

    try:
        assert send("hello", {"protocol": 1})["status"] == "ok"
        base = bytes(range(256)) * 20
        begun = send("buffer.begin", {"dtype": "u8", "shape": [len(base)], "byte_length": len(base), "sha256": hashlib.sha256(base).hexdigest()})
        send("buffer.chunk", {"handle": begun["result"]["handle"], "offset": 0, "byte_length": len(base)}, base)
        send("buffer.commit", {"handle": begun["result"]["handle"]})
        edited = bytearray(base)
        edited[1000:1010] = b"Q" * 10
        derived = send("buffer.derive", {"base": begun["result"]["handle"], "dtype": "u8", "shape": [len(base)], "byte_length": len(base),
                                         "sha256": hashlib.sha256(bytes(edited)).hexdigest()})
        assert derived["status"] == "ok", derived
        assert send("buffer.chunk", {"handle": derived["result"]["handle"], "offset": 1000, "byte_length": 10}, b"Q" * 10)["result"] == {"next_offset": 1010}
        assert send("buffer.commit", {"handle": derived["result"]["handle"]})["status"] == "ok"
        refused = send("buffer.derive", {"base": derived["result"]["handle"], "dtype": "i32le", "shape": [len(base) // 4], "byte_length": len(base),
                                         "sha256": "0" * 64})
        assert refused["status"] == "error" and refused["error"]["code"] == "INVALID_BUFFER"
    finally:
        coordinator.close()


def test_a_session_answers_more_than_65536_requests(tmp_path):
    """Decision V (card M8.4.40): the coordinator remembers a sliding window of request IDs instead of ending the session at 65,536."""
    coordinator = Coordinator(io.BytesIO(), version='test', runtime_id='0' * 64, scratch_directory=str(tmp_path))
    session = str(uuid4())
    try:
        coordinator.receive(request(session, 'hello', {'protocol': 1}))
        for _ in range(65_600):
            coordinator.output = io.BytesIO()               # keep memory flat: only the last answer is read
            item = request(session, 'buffer.release', {'handles': []})
            coordinator.receive(item)
        assert responses(coordinator)[item['id']]['status'] == 'ok'
        assert len(coordinator.seen) == 65_536
    finally:
        coordinator.close()


def test_the_request_window_refuses_recent_duplicates_and_forgets_the_oldest(tmp_path):
    coordinator = Coordinator(io.BytesIO(), version='test', runtime_id='0' * 64, scratch_directory=str(tmp_path))
    coordinator.request_window = 4
    session = str(uuid4())
    try:
        coordinator.receive(request(session, 'hello', {'protocol': 1}))
        items = [request(session, 'buffer.release', {'handles': []}) for _ in range(5)]
        for item in items:
            coordinator.receive(item)
        for item in items[2:]:                               # still in the window: refused without being run again
            coordinator.output = io.BytesIO()
            coordinator.receive(item)
            assert responses(coordinator)[item['id']]['error']['code'] == 'INVALID_REQUEST'
        coordinator.output = io.BytesIO()
        coordinator.receive(items[0])                        # the oldest identifiers left the window
        assert responses(coordinator)[items[0]['id']]['status'] == 'ok'
        assert list(coordinator.seen) == [items[2]['id'], items[3]['id'], items[4]['id'], items[0]['id']]
    finally:
        coordinator.close()


def test_the_operation_table_matches_the_client_allowlist_and_the_contract_kinds():
    """Card M8.5.1 (contract §9.5): the coordinator's table and `desktop/engine.js` `OPERATIONS` name the same operations."""
    import re

    from sedcoretool.engine.server import HANDSHAKE, MASK_OPERATIONS, OPERATION_KINDS, OPERATIONS

    client = (Path(__file__).resolve().parents[1] / 'desktop' / 'engine.js').read_text(encoding='utf-8')
    allowlist = re.search(r'const OPERATIONS = new Set\(\[(.*?)\]\);', client, re.S)
    assert allowlist, 'desktop/engine.js no longer declares OPERATIONS as a Set literal'
    assert set(re.findall(r"'([a-z.]+)'", allowlist.group(1))) == set(OPERATIONS)
    assert HANDSHAKE in OPERATIONS
    assert all(entry.kind in OPERATION_KINDS and callable(entry.handler) for entry in OPERATIONS.values())
    kinds = {kind: {name for name, entry in OPERATIONS.items() if entry.kind == kind} for kind in OPERATION_KINDS}
    assert kinds['job'] == {'section.analyze', 'method.run', 'buffer.digest', 'pyramid.build'}
    assert kinds['mask'] == set(MASK_OPERATIONS)


def test_dispatch_refuses_before_the_handshake_and_unknown_or_unconfigured_operations(tmp_path):
    coordinator = Coordinator(io.BytesIO(), version='test', runtime_id='0' * 64, scratch_directory=str(tmp_path))
    session = str(uuid4())
    try:
        for operation in ('buffer.release', 'no.such.operation'):
            with pytest.raises(ProtocolError, match='handshake required'):
                coordinator.receive(request(session, operation, {'handles': []}))
        coordinator.receive(request(session, 'hello', {'protocol': 1}))
        with pytest.raises(ProtocolError, match='unsupported handshake'):
            coordinator.receive(request(session, 'hello', {'protocol': 1}))
        refused = [request(session, operation, {}) for operation in ('no.such.operation', '__init__', 'mask.info', 'tile.read')]
        for item in refused:                                 # no projects or pyramid folder was given to this coordinator
            coordinator.receive(item)
        answers = responses(coordinator)
        assert [answers[item['id']]['error']['code'] for item in refused] == ['UNSUPPORTED_METHOD'] * len(refused)
    finally:
        coordinator.close()


# ---- fast f64le finiteness & coordinator wakeup (card M8.5.6b) ---------------------------------------------------------------

def test_all_finite_f64le_accepts_finite_values_including_high_byte_boundary_cases():
    assert all_finite_f64le(b'')
    finite_samples = [
        0.0, -0.0, 1.0, -42.5, 5e-324, -5e-324,
        1e305, -1e305, sys.float_info.max, -sys.float_info.max,
    ]
    raw = b''.join(struct.pack('<d', value) for value in finite_samples)
    raw += struct.pack('<QQQQ', 0x7FEFFFFFFFFFFFFF, 0xFFEFFFFFFFFFFFFF, 0x7F00000000000000, 0xFF00000000000000)
    assert all_finite_f64le(raw)

    # Large buffers with and without 0x7F/0xFF high bytes both validate as finite.
    fast_large = struct.pack('<d', 123.456) * 12_000
    assert all_finite_f64le(fast_large)
    mixed_large = bytearray(fast_large)
    mixed_large[8 * 7777:8 * 7778] = struct.pack('<d', sys.float_info.max)
    mixed_large[8 * 11_999:8 * 12_000] = struct.pack('<d', -sys.float_info.max)
    assert all_finite_f64le(bytes(mixed_large))


@pytest.mark.parametrize('pattern', [
    struct.pack('<d', float('inf')),
    struct.pack('<d', float('-inf')),
    struct.pack('<d', float('nan')),
    struct.pack('<Q', 0xFFF8000000000000),   # negative quiet NaN
    struct.pack('<Q', 0x7FF0000000000001),   # positive signaling NaN
    struct.pack('<Q', 0xFFF0000000000001),   # negative signaling NaN
    struct.pack('<Q', 0x7FF7FFFFFFFFFFFF),   # signaling NaN with max payload
])
def test_all_finite_f64le_rejects_nonfinite_patterns_at_every_position(pattern):
    assert not all_finite_f64le(pattern)
    count = 12_000
    base = struct.pack('<d', 1.25) * count
    for index in (0, count // 2, count - 1):
        buf = bytearray(base)
        buf[8 * index:8 * (index + 1)] = pattern
        assert not all_finite_f64le(bytes(buf))


@pytest.mark.parametrize('chunk', [b'\x00', b'\x00' * 7, struct.pack('<d', 1.0) + b'\x00', b'\x00' * 15])
def test_all_finite_f64le_rejects_non_multiple_of_eight_lengths(chunk):
    assert not all_finite_f64le(chunk)


def test_buffer_store_verify_and_adopt_packed_with_boundary_finite_and_tail_nonfinite(tmp_path):
    import numpy as np

    store = BufferStore()
    try:
        count = 12_000
        finite = np.linspace(-100.0, 100.0, count, dtype='<f8')
        finite[0] = sys.float_info.max
        finite[count // 2] = -sys.float_info.max
        finite[-1] = 1e305
        raw = finite.tobytes()

        handle = store.begin({'dtype': 'f64le', 'shape': [count], 'byte_length': len(raw),
                              'sha256': hashlib.sha256(raw).hexdigest()})['handle']
        store.append({'handle': handle, 'offset': 0, 'byte_length': len(raw)}, raw)
        assert store.commit({'handle': handle})['byte_length'] == len(raw)

        path, length, digest, layout = packed_file(tmp_path, {'x': finite}, name='finite.bin')
        adopted_handle, _ = store.adopt_packed(path, length, digest, layout)
        store.release(adopted_handle)

        for bad_bits in (0x7FF8000000000000, 0xFFF0000000000000, 0x7FF0000000000001):
            bad = finite.copy()
            bad.view('<u8')[-1] = bad_bits
            bad_bytes = bad.tobytes()
            staged = store.begin({'dtype': 'f64le', 'shape': [count], 'byte_length': len(bad_bytes),
                                  'sha256': hashlib.sha256(bad_bytes).hexdigest()})['handle']
            store.append({'handle': staged, 'offset': 0, 'byte_length': len(bad_bytes)}, bad_bytes)
            with pytest.raises(RequestError, match='INVALID_BUFFER'):
                store.commit({'handle': staged})
            assert not store.get(staged).committed

            bad_path, bad_len, bad_digest, bad_layout = packed_file(tmp_path, {'x': bad}, name=f'bad_{bad_bits:x}.bin')
            with pytest.raises(RequestError, match='INVALID_BUFFER'):
                store.adopt_packed(bad_path, bad_len, bad_digest, bad_layout)
    finally:
        store.close()


def test_coordinator_inbox_fifo_backpressure_and_wakeups():
    inbox = CoordinatorInbox(maxsize=2)
    inbox.put('first')
    inbox.put('second')

    # Backpressure blocks a 3rd put, and wake() neither blocks nor consumes a request slot.
    third_done = threading.Event()
    third_thread = threading.Thread(target=lambda: (inbox.put('third'), third_done.set()), daemon=True)
    third_thread.start()
    time.sleep(0.03)
    assert not third_done.is_set()

    inbox.wake()
    assert not third_done.is_set()

    assert inbox.get(timeout=0.5) == (True, 'first')
    assert third_done.wait(timeout=1.0)
    third_thread.join(timeout=1.0)
    assert inbox.get(timeout=0.5) == (True, 'second')
    assert inbox.get(timeout=0.5) == (True, 'third')

    # The wakeup raised while items were present is preserved until the queue drains, then cleared.
    started = time.monotonic()
    assert inbox.get(timeout=2.0) == (False, None)
    assert time.monotonic() - started < 0.2

    # wake() called before get() returns immediately without waiting for timeout.
    inbox.wake()
    started = time.monotonic()
    assert inbox.get(timeout=2.0) == (False, None)
    assert time.monotonic() - started < 0.2

    # wake() unblocks a waiting get() promptly instead of waiting for the full timeout.
    got = []
    waiter_started = threading.Event()

    def wait_for_wake():
        waiter_started.set()
        t0 = time.monotonic()
        result = inbox.get(timeout=2.0)
        got.append((result, time.monotonic() - t0))

    waiter = threading.Thread(target=wait_for_wake, daemon=True)
    waiter.start()
    assert waiter_started.wait(timeout=1.0)
    time.sleep(0.02)
    inbox.wake()
    waiter.join(timeout=1.0)
    assert len(got) == 1
    assert got[0][0] == (False, None) and got[0][1] < 0.25

    # None (EOF) and Exception items are distinct from wakeup/timeout.
    err = ProtocolError('bad')
    inbox.put(err)
    inbox.put(None)
    assert inbox.get(timeout=0.1) == (True, err)
    assert inbox.get(timeout=0.1) == (True, None)


def test_on_done_callbacks_fire_on_completion_and_worker_failure(tmp_path):
    mask_woke = threading.Event()
    mask_io = MaskIO(lambda req, data, buffers: ({'ok': True}, []), on_done=mask_woke.set)
    try:
        assert mask_io.offer(({'id': '1'}, None, {}), timeout=1.0)
        assert mask_woke.wait(timeout=2.0)
    finally:
        mask_io.stop()

    failing = tmp_path / 'fail_runner.py'
    failing.write_text('raise SystemExit(2)\n', encoding='utf-8')
    job_file = tmp_path / 'job.json'
    job_file.write_text('{}', encoding='utf-8')
    runner_woke = threading.Event()
    runner = MethodRunner(failing, on_done=runner_woke.set)
    try:
        job = MethodJob(runner, job_file, tmp_path / 'cancel')
        assert runner_woke.wait(timeout=2.0)
        assert job.finished() and job.result is None
    finally:
        runner.close()


def test_serve_executes_core_ages_digest_and_mask_with_immediate_wakeup(tmp_path):
    import numpy as np

    req_r, req_w = os.pipe()
    resp_r, resp_w = os.pipe()
    in_stream = os.fdopen(req_r, 'rb', buffering=0)
    out_stream = os.fdopen(resp_w, 'wb')
    client_in = os.fdopen(req_w, 'wb')
    client_out = os.fdopen(resp_r, 'rb')

    errors = []

    scratch_dir = tmp_path / 'scratch'
    projects_dir = tmp_path / 'projects'
    scratch_dir.mkdir()
    projects_dir.mkdir()

    def run_server():
        try:
            serve(in_stream, out_stream, version='test', runtime_id='0' * 64,
                  scratch_directory=str(scratch_dir), projects_directory=str(projects_dir))
        except BaseException as exc:
            errors.append(exc)
        finally:
            out_stream.close()

    server_thread = threading.Thread(target=run_server, daemon=True)
    server_thread.start()
    session = str(uuid4())

    def rpc(op, payload, binary=None):
        item = request(session, op, payload)
        write_json(client_in, item)
        if binary is not None:
            write_binary(client_in, binary)
        while True:
            frame = read_frame(client_out)
            assert frame is not None and frame[0] == JSON_FRAME
            msg = strict_json(frame[1])
            if msg['kind'] == 'response' and msg['id'] == item['id']:
                assert msg['status'] == 'ok', msg
                data = None
                if op == 'buffer.read':
                    binary_frame = read_frame(client_out)
                    assert binary_frame is not None and binary_frame[0] == BINARY_FRAME
                    data = binary_frame[1]
                return msg['result'], data

    def upload_buffer(data, dtype, shape):
        digest = hashlib.sha256(data).hexdigest()
        handle = rpc('buffer.begin', {'dtype': dtype, 'shape': shape, 'byte_length': len(data), 'sha256': digest})[0]['handle']
        rpc('buffer.chunk', {'handle': handle, 'offset': 0, 'byte_length': len(data)}, data)
        rpc('buffer.commit', {'handle': handle})
        return handle

    try:
        rpc('hello', {'protocol': 1})

        age_meta = json.dumps({'version': 1, 'rows': 2, 'columns': [{'name': 'depth', 'unit': 'cm'}, {'name': 'age', 'unit': 'yr'}]},
                              separators=(',', ':')).encode()
        age_vals = np.array([[0.0, 10.0], [0.0, 100.0]], dtype='<f8')
        age_valid = np.ones((2, 2), dtype='u1')
        query_meta = json.dumps({'version': 1, 'rows': 2, 'columns': [{'name': 'depth', 'unit': 'cm'}]}, separators=(',', ':')).encode()
        query_vals = np.array([[2.5, 7.5]], dtype='<f8')
        query_valid = np.ones((1, 2), dtype='u1')
        settings_bytes = b'{"version":1}'
        settings_hash = hashlib.sha256(settings_bytes).hexdigest()

        inputs = {
            'age_model': upload_buffer(age_meta, 'utf8json', [len(age_meta)]),
            'age_model_values': upload_buffer(age_vals.tobytes(), 'f64le', list(age_vals.shape)),
            'age_model_valid': upload_buffer(age_valid.tobytes(), 'u8', list(age_valid.shape)),
            'query': upload_buffer(query_meta, 'utf8json', [len(query_meta)]),
            'query_values': upload_buffer(query_vals.tobytes(), 'f64le', list(query_vals.shape)),
            'query_valid': upload_buffer(query_valid.tobytes(), 'u8', list(query_valid.shape)),
            'settings': upload_buffer(settings_bytes, 'utf8json', [len(settings_bytes)]),
        }

        result, _ = rpc('method.run', {
            'method': 'core.ages/1', 'scope': 'core', 'target': str(uuid4()), 'revision': 1,
            'priority': 'interactive', 'settings_hash': settings_hash, 'inputs': inputs,
        })
        assert result['summary'] == {'rows': 2, 'outside': 0}
        packed_meta = result['outputs']['result']
        _, raw_result = rpc('buffer.read', {'handle': packed_meta['handle'], 'offset': 0, 'byte_length': packed_meta['byte_length']})
        ages_part = result['layout']['ages_values']
        ages = np.frombuffer(raw_result, dtype='<f8', count=2, offset=ages_part['offset'])
        assert ages.tolist() == [25.0, 75.0]

        digest_result, _ = rpc('buffer.digest', {'handle': inputs['settings']})
        assert digest_result == {'sha256': settings_hash, 'byte_length': len(settings_bytes)}

        mask_result, _ = rpc('mask.retain', {'project': 'p1', 'keep': []})
        assert mask_result == {'removed': {'blobs': 0, 'manifests': 0}}

        assert rpc('shutdown', {})[0] == {}
    finally:
        client_in.close()
        server_thread.join(timeout=15)
        for stream in (in_stream, out_stream, client_out):
            stream.close()
    assert not server_thread.is_alive()
    assert errors == []
