"""The engine process runs registered methods: real coordinator, real worker subprocess, results downloaded in ranges."""

import hashlib
import io
import json
import subprocess
import sys
import time
from pathlib import Path
from uuid import uuid4

import numpy as np
import pytest

import section_fixtures as fixtures
from sedcoretool.engine import specs
from sedcoretool.engine.protocol import BINARY_FRAME, JSON_FRAME, MAX_CHUNK, read_frame, strict_json
from sedcoretool.engine.server import Coordinator
from sedcoretool.methods import section_intervals

ENGINE = Path(__file__).resolve().parents[1] / "src" / "sedcoretool" / "engine"
METHOD = "section.intervals/1"
NAMES = ("basic-four-intervals", "overlap-same-and-different-class", "no-data-padding-2-cm", "ages-with-range", "manual-ranges",
         "predictions-and-candidates-counted", "large-mixed")


def request(session, operation, payload):
    return {"v": 1, "kind": "request", "session": session, "id": str(uuid4()), "op": operation, "payload": payload}


def new_coordinator(**options):
    coordinator = Coordinator(io.BytesIO(), version="test", runtime_id="0" * 64, **options)
    session = str(uuid4())
    coordinator.receive(request(session, "hello", {"protocol": 1}))
    return coordinator, session


def frames(coordinator):
    """(responses by request id, binary payloads by request id) from the output stream, in order."""
    stream = io.BytesIO(coordinator.output.getvalue())
    responses, binaries, last = {}, {}, None
    while frame := read_frame(stream):
        if frame[0] == JSON_FRAME:
            value = strict_json(frame[1])
            assert value["id"] not in responses, "a request received more than one terminal response"
            responses[value["id"]], last = value, value
        else:
            assert frame[0] == BINARY_FRAME and last is not None and last["op"] == "buffer.read" and last["status"] == "ok"
            assert last["id"] not in binaries, "a response was followed by two binary frames"
            binaries[last["id"]] = bytes(frame[1])
    return responses, binaries


def run_until_idle(coordinator, timeout=60):
    deadline = time.monotonic() + timeout
    while (coordinator.active or coordinator.jobs) and time.monotonic() < deadline:
        coordinator.poll()
        time.sleep(0.005)
    assert not coordinator.active and not coordinator.jobs, "the job did not finish"


def put(coordinator, data, dtype, shape):
    store = coordinator.store
    handle = store.begin({"dtype": dtype, "shape": shape, "byte_length": len(data), "sha256": hashlib.sha256(data).hexdigest()})["handle"]
    for offset in range(0, len(data), MAX_CHUNK):
        store.append({"handle": handle, "offset": offset, "byte_length": min(MAX_CHUNK, len(data) - offset)}, data[offset:offset + MAX_CHUNK])
    store.commit({"handle": handle})
    return handle


def upload(coordinator, fixture, change=None):
    """Upload the inputs of a fixture. Returns (handles by input name, settings_hash). `change(inputs)` may alter the decoded inputs."""
    raw = fixture["inputs"]
    inputs = {name: raw[name] for name in ("objects", "classes", "settings", "age_model", "manual_indices")}
    inputs = json.loads(json.dumps(inputs))
    if change:
        change(inputs)
    handles = {}
    for name in ("labels", "exclude", "stack_offsets"):
        array = fixtures.array(raw[name])
        handles[name] = put(coordinator, array.tobytes(), {"labels": "i32le", "exclude": "u8", "stack_offsets": "u32le"}[name], list(array.shape))
    if raw["stack_members"]:
        members = fixtures.array(raw["stack_members"])
        handles["stack_members"] = put(coordinator, members.tobytes(), "u32le", list(members.shape))
    for name, value in inputs.items():
        data = json.dumps(value, separators=(",", ":")).encode()
        handles[name] = put(coordinator, data, "utf8json", [len(data)])
    return handles, coordinator.store.buffers[handles["settings"]].expected_hash


def analysis(session, handles, settings_hash, override=None):
    payload = {"method": METHOD, "project": str(uuid4()), "section": str(uuid4()), "revision": 7, "settings_hash": settings_hash, "inputs": handles}
    return request(session, "section.analyze", {**payload, **(override or {})})


def download(coordinator, session, result, chunk=100_000):
    """The result columns: the one packed buffer, read back with buffer.read in ranges of `chunk` bytes, cut up by the layout."""
    assert list(result["outputs"]) == ["result"], "one buffer carries every column"
    item = result["outputs"]["result"]
    assert (item["dtype"], item["shape"]) == ("u8", [item["byte_length"]])
    data = bytearray()
    while len(data) < item["byte_length"]:
        asked = request(session, "buffer.read", {"handle": item["handle"], "offset": len(data), "byte_length": min(chunk, item["byte_length"] - len(data))})
        coordinator.receive(asked)
        responses, binaries = frames(coordinator)
        assert responses[asked["id"]]["status"] == "ok"
        data += binaries[asked["id"]]
    assert hashlib.sha256(data).hexdigest() == item["sha256"]
    columns, end = {}, 0
    for name, part in sorted(result["layout"].items(), key=lambda entry: entry[1]["offset"]):
        dtype = np.dtype(fixtures.DTYPES[part["dtype"]])
        assert part["offset"] % 8 == 0 and part["offset"] >= end, f"{name}: aligned and not overlapping"
        end = part["offset"] + part["byte_length"]
        assert end <= item["byte_length"] and part["byte_length"] == int(np.prod(part["shape"])) * dtype.itemsize
        columns[name] = np.frombuffer(bytes(data), dtype=dtype, count=int(np.prod(part["shape"])), offset=part["offset"]).reshape(part["shape"])
    return columns


@pytest.mark.parametrize("name", NAMES)
def test_real_worker_reproduces_a_reference_fixture_and_results_download_in_ranges(name):
    fixture = fixtures.load(name)
    coordinator, session = new_coordinator()
    try:
        handles, settings_hash = upload(coordinator, fixture)
        baseline = coordinator.store.reserved
        job = analysis(session, handles, settings_hash)
        coordinator.receive(job)
        run_until_idle(coordinator)
        response = frames(coordinator)[0][job["id"]]
        assert response["status"] == "ok", response
        result = response["result"]
        assert {key: result[key] for key in ("project", "section", "revision", "settings_hash", "method")} == {
            **{key: job["payload"][key] for key in ("project", "section", "revision", "settings_hash")}, "method": METHOD}
        assert result["dimensions"] == fixture["expected"]["dimensions"]
        assert result["provenance"]["input_sha256"] == {key: coordinator.store.buffers[h].expected_hash for key, h in handles.items()}
        assert (result["provenance"]["engine_version"], result["provenance"]["method"], result["provenance"]["revision"]) == ("test", METHOD, 7)
        assert all(coordinator.store.buffers[h].pins == 0 for h in handles.values()), "inputs are unpinned after the job"
        columns = download(coordinator, session, result)
        fixtures.assert_columns_match(name, fixture["expected"]["columns"], columns)
        # Results are charged to the session budget and give it back when released.
        assert coordinator.store.reserved == baseline + result["outputs"]["result"]["byte_length"]
        coordinator.receive(request(session, "buffer.release", {"handles": [item["handle"] for item in result["outputs"].values()]}))
        assert coordinator.store.reserved == baseline
        assert not [p for p in Path(coordinator.store.directory.name).iterdir() if p.name.startswith("job-")], "the job directory is removed"
    finally:
        coordinator.close()


def test_buffer_read_answers_with_one_binary_frame_and_rejects_bad_ranges():
    coordinator, session = new_coordinator()
    try:
        data = bytes(range(256)) * 8
        handle = put(coordinator, data, "u8", [len(data)])
        good = request(session, "buffer.read", {"handle": handle, "offset": 10, "byte_length": 100})
        coordinator.receive(good)
        responses, binaries = frames(coordinator)
        assert responses[good["id"]]["result"] == {"offset": 10, "byte_length": 100} and binaries[good["id"]] == data[10:110]
        # The JSON response is immediately followed by its binary frame (checked on the raw frame order).
        stream = io.BytesIO(coordinator.output.getvalue())
        kinds = []
        while frame := read_frame(stream):
            kinds.append(frame[0])
        assert kinds[-2:] == [JSON_FRAME, BINARY_FRAME]
        bad = [({"handle": handle, "offset": len(data), "byte_length": 1}, "INVALID_REQUEST"),
               ({"handle": handle, "offset": 0, "byte_length": len(data) + 1}, "INVALID_REQUEST"),
               ({"handle": handle, "offset": 0, "byte_length": 0}, "INVALID_REQUEST"),
               ({"handle": handle, "offset": 0, "byte_length": MAX_CHUNK + 1}, "INVALID_REQUEST"),
               ({"handle": handle, "offset": -1, "byte_length": 1}, "INVALID_REQUEST"),
               ({"handle": str(uuid4()), "offset": 0, "byte_length": 1}, "INVALID_BUFFER"),
               ({"handle": handle, "offset": 0}, "INVALID_REQUEST")]
        before = len(coordinator.output.getvalue())
        sent = [request(session, "buffer.read", payload) for payload, _ in bad]
        for item in sent:
            coordinator.receive(item)
        responses, binaries = frames(coordinator)
        for item, (_, code) in zip(sent, bad):
            assert responses[item["id"]]["status"] == "error" and responses[item["id"]]["error"]["code"] == code
            assert item["id"] not in binaries
        assert len(coordinator.output.getvalue()) > before
        coordinator.receive(request(session, "buffer.release", {"handles": [handle]}))
        released = request(session, "buffer.read", {"handle": handle, "offset": 0, "byte_length": 1})
        coordinator.receive(released)
        assert frames(coordinator)[0][released["id"]]["error"]["code"] == "INVALID_BUFFER"
    finally:
        coordinator.close()


def test_hello_advertises_both_methods():
    coordinator, session = new_coordinator()
    try:
        hello = next(iter(frames(coordinator)[0].values()))
        assert hello["result"]["methods"] == ["buffer.digest/1", METHOD]
    finally:
        coordinator.close()


def test_a_rejected_snapshot_is_a_field_error_and_the_session_keeps_working():
    fixture = fixtures.load("basic-four-intervals")
    coordinator, session = new_coordinator()
    try:
        handles, settings_hash = upload(coordinator, fixture, change=lambda inputs: inputs["objects"].pop())    # labels now name object 3, which is not listed
        broken = analysis(session, handles, settings_hash)
        coordinator.receive(broken)
        run_until_idle(coordinator)
        error = frames(coordinator)[0][broken["id"]]["error"]
        assert (error["code"], error["details"]) == ("INVALID_BUFFER", {"field": "labels"})
        assert all(coordinator.store.buffers[h].pins == 0 for h in handles.values())
        good_handles, good_hash = upload(coordinator, fixture)
        again = analysis(session, good_handles, good_hash)
        coordinator.receive(again)
        run_until_idle(coordinator)
        assert frames(coordinator)[0][again["id"]]["status"] == "ok"
    finally:
        coordinator.close()


def test_requests_are_validated_before_admission_and_pin_nothing():
    fixture = fixtures.load("overlap-same-and-different-class")
    coordinator, session = new_coordinator()
    try:
        handles, settings_hash = upload(coordinator, fixture)
        missing = {key: value for key, value in handles.items() if key != "classes"}
        swapped = {**handles, "labels": handles["exclude"]}
        shaped = {**handles, "exclude": put(coordinator, bytes(8), "u8", [2, 4])}
        cases = [
            ({"method": "section.intervals/2"}, "UNSUPPORTED_METHOD", "method"),
            ({"project": "not-a-uuid"}, "INVALID_REQUEST", "project"),
            ({"section": 5}, "INVALID_REQUEST", "section"),
            ({"revision": -1}, "INVALID_REQUEST", "revision"),
            ({"revision": "7"}, "INVALID_REQUEST", "revision"),
            ({"settings_hash": "0" * 64}, "INVALID_REQUEST", "settings_hash"),
            ({"settings_hash": "A" * 64}, "INVALID_REQUEST", "settings_hash"),
            ({"inputs": missing}, "INVALID_REQUEST", "inputs"),
            ({"inputs": {**handles, "extra": handles["labels"]}}, "INVALID_REQUEST", "inputs"),
            ({"inputs": "labels"}, "INVALID_REQUEST", "inputs"),
            ({"inputs": swapped}, "INVALID_BUFFER", "labels"),
            ({"inputs": {**handles, "labels": str(uuid4())}}, "INVALID_BUFFER", "labels"),
            ({"inputs": shaped}, "INVALID_BUFFER", "exclude"),
        ]
        sent = [analysis(session, handles, settings_hash, override) for override, _, _ in cases]
        for item in sent:
            coordinator.receive(item)
        responses = frames(coordinator)[0]
        for item, (_, code, field) in zip(sent, cases):
            error = responses[item["id"]]["error"]
            assert (error["code"], error["details"].get("field")) == (code, field), item["payload"]
        assert not coordinator.active and not coordinator.jobs
        assert all(coordinator.store.buffers[h].pins == 0 for h in handles.values())
        unknown_field = request(session, "section.analyze", {**analysis(session, handles, settings_hash)["payload"], "extra": 1})
        coordinator.receive(unknown_field)
        assert frames(coordinator)[0][unknown_field["id"]]["error"]["code"] == "INVALID_REQUEST"
    finally:
        coordinator.close()


def test_cancelling_a_queued_and_a_running_analysis_leaves_no_trace():
    fixture = fixtures.load("large-mixed")
    coordinator, session = new_coordinator()
    try:
        handles, settings_hash = upload(coordinator, fixture)
        baseline = coordinator.store.reserved
        running, queued = analysis(session, handles, settings_hash), analysis(session, handles, settings_hash)
        coordinator.receive(running)
        coordinator.receive(queued)
        assert coordinator.active is not None and len(coordinator.jobs) == 1
        coordinator.receive(request(session, "job.cancel", {"request_id": queued["id"]}))
        coordinator.receive(request(session, "job.cancel", {"request_id": running["id"]}))
        run_until_idle(coordinator)
        responses = frames(coordinator)[0]
        assert responses[queued["id"]]["status"] == "cancelled" and responses[running["id"]]["status"] == "cancelled"
        assert all(coordinator.store.buffers[h].pins == 0 for h in handles.values())
        assert coordinator.store.reserved == baseline
        assert not [p for p in Path(coordinator.store.directory.name).iterdir() if p.name.startswith("job-")]
        after = analysis(session, handles, settings_hash)
        coordinator.receive(after)
        run_until_idle(coordinator)
        assert frames(coordinator)[0][after["id"]]["status"] == "ok"
    finally:
        coordinator.close()


def fake_worker(tmp_path, body):
    script = tmp_path / "fake_method_worker.py"
    script.write_text(body, encoding="utf-8")
    return script


# A stand-in for method_worker.py: the job file path arrives as one line on stdin, the answer is one frame on stdout. These
# scripts answer one job and exit; the coordinator must cope with that as it does with a worker that crashes.
COLUMN_FRAME = (
    "import hashlib, json, struct, sys\nfrom pathlib import Path\nsys.path.insert(0, {engine!r})\nfrom protocol import write_json\n"
    "job = json.loads(Path(sys.stdin.readline().strip()).read_text())\nout = Path(job['output_dir'])\n"
    "ROW = {{'row_start': {{'dtype': 'u32le', 'shape': [1], 'offset': 0, 'byte_length': 4}}}}\n"
    "def packed(data=None, layout=None, length=None, sha=None, dims=(1, 1, 1), write=True):\n"
    "    data = bytes(8) if data is None else data\n"
    "    if write:\n"
    "        out.mkdir(parents=True, exist_ok=True)\n"
    "        (out / 'result.bin').write_bytes(data)\n"
    "    write_json(sys.stdout.buffer, {{'ok': True, 'dimensions': {{'bins': dims[0], 'classes': dims[1], 'schemes': dims[2]}},\n"
    "        'packed': {{'byte_length': len(data) if length is None else length, 'sha256': sha or hashlib.sha256(data).hexdigest(),\n"
    "                   'layout': ROW if layout is None else layout}}}})\n")


def column(dtype="u32le", shape=(1,), offset=0, length=4):
    return repr({"dtype": dtype, "shape": list(shape), "offset": offset, "byte_length": length})


@pytest.mark.parametrize("label,body,code", [
    ("exits with an error", "raise SystemExit(1)\n", "INTERNAL"),
    ("writes nothing", "pass\n", "INTERNAL"),
    ("writes garbage", "sys = __import__('sys'); sys.stdout.buffer.write(b'not a frame')\n", "INTERNAL"),
    ("answers with a shape that is none of the three", "write_json(sys.stdout.buffer, {'foo': 1})\n", "INTERNAL"),
    ("answers twice", "write_json(sys.stdout.buffer, {'cancelled': True})\nwrite_json(sys.stdout.buffer, {'cancelled': True})\n", "INTERNAL"),
    ("reports an unknown error code", "write_json(sys.stdout.buffer, {'error': {'code': 'TEAPOT', 'field': None}})\n", "INTERNAL"),
    ("reports a field that is not a name", "write_json(sys.stdout.buffer, {'error': {'code': 'INVALID_BUFFER', 'field': '../etc'}})\n", "INTERNAL"),
    ("answers in the old one-file-per-column form", "write_json(sys.stdout.buffer, {'ok': True, 'dimensions': {'bins': 1, 'classes': 1, 'schemes': 1},"
                                                    " 'columns': {'row_start': {'dtype': 'u32le', 'shape': [1], 'byte_length': 4, 'sha256': '0' * 64}}})\n", "INTERNAL"),
    ("claims a file that does not exist", "packed(write=False)\n", "INTERNAL"),
    ("declares a wrong hash", "packed(sha='0' * 64)\n", "INTERNAL"),
    ("declares a wrong size", "packed(bytes(16), length=8, sha=hashlib.sha256(bytes(8)).hexdigest())\n", "INTERNAL"),
    ("declares less than the file holds, with the hash of the file", "packed(bytes(16), length=8)\n", "INTERNAL"),
    ("holds data that no column accounts for", "packed(bytes(16))\n", "INTERNAL"),
    ("names a path as a column", "packed(layout={'../x': " + column() + "})\n", "INTERNAL"),
    ("names a column with a space", "packed(layout={'row start': " + column() + "})\n", "INTERNAL"),
    ("starts a column off a multiple of 8", "packed(bytes(16), {'a': " + column(offset=4) + "})\n", "INTERNAL"),
    ("lets two columns overlap", "packed(bytes(8), {'a': " + column() + ", 'b': " + column() + "})\n", "INTERNAL"),
    ("puts a column past the end of the file", "packed(bytes(8), {'a': " + column(offset=8) + "})\n", "INTERNAL"),
    ("gives a column a shape that does not match its length", "packed(bytes(8), {'a': " + column(shape=(2,)) + "})\n", "INTERNAL"),
    ("gives a column a type that does not exist", "packed(bytes(8), {'a': " + column(dtype="f32le") + "})\n", "INTERNAL"),
    ("gives a column a length of zero", "packed(bytes(8), {'a': " + column(length=0) + "})\n", "INTERNAL"),
    ("gives a column an extra field", "packed(bytes(8), {'a': {**" + column() + ", 'path': '/etc'}})\n", "INTERNAL"),
    ("declares more columns than allowed", "packed(bytes(8 * 65), {'c%d' % i: " + column(offset=0) + " for i in range(65)})\n", "INTERNAL"),
    ("returns non-finite float data", "packed(struct.pack('<d', float('nan')), {'depth': " + column("f64le", (1,), 0, 8) + "})\n", "INTERNAL"),
    ("returns infinite float data after finite data", "packed(struct.pack('<2d', 1.0, float('inf')), {'depth': " + column("f64le", (2,), 0, 16) + "})\n", "INTERNAL"),
    ("declares a dimension of zero", "packed(dims=(0, 1, 1))\n", "INTERNAL"),
])
def test_a_misbehaving_worker_is_an_internal_error_and_adopts_nothing(tmp_path, label, body, code):
    coordinator, session = new_coordinator(method_script=fake_worker(tmp_path, COLUMN_FRAME.format(engine=str(ENGINE)) + body))
    try:
        handles, settings_hash = upload(coordinator, fixtures.load("basic-four-intervals"))
        baseline, count = coordinator.store.reserved, len(coordinator.store.buffers)
        job = analysis(session, handles, settings_hash)
        coordinator.receive(job)
        run_until_idle(coordinator)
        error = frames(coordinator)[0][job["id"]]["error"]
        assert error["code"] == code, label
        assert coordinator.store.reserved == baseline and len(coordinator.store.buffers) == count, f"{label}: nothing is adopted"
        assert all(coordinator.store.buffers[h].pins == 0 for h in handles.values())
        assert not [p for p in Path(coordinator.store.directory.name).iterdir() if p.name.startswith("job-")]
        assert sorted(p.name for p in Path(coordinator.store.directory.name).iterdir()) == sorted(coordinator.store.buffers), f"{label}: no file left behind"
    finally:
        coordinator.close()


VALID_ANSWER = "packed()\n"


def test_the_stand_in_worker_of_these_tests_can_succeed(tmp_path):
    # Control for the parametrised test above: without it every case could pass because the stand-in itself is broken.
    coordinator, session = new_coordinator(method_script=fake_worker(tmp_path, COLUMN_FRAME.format(engine=str(ENGINE)) + VALID_ANSWER))
    try:
        handles, settings_hash = upload(coordinator, fixtures.load("basic-four-intervals"))
        job = analysis(session, handles, settings_hash)
        coordinator.receive(job)
        run_until_idle(coordinator)
        assert frames(coordinator)[0][job["id"]]["status"] == "ok"
    finally:
        coordinator.close()


def test_a_worker_that_dies_after_a_checked_answer_is_replaced_for_the_next_job(tmp_path):
    # The answer is verified on its own (frame, sizes, hashes, finite values), so a late crash does not undo it; the damaged
    # process is never given another job.
    coordinator, session = new_coordinator(method_script=fake_worker(tmp_path, COLUMN_FRAME.format(engine=str(ENGINE)) + VALID_ANSWER + "raise SystemExit(3)\n"))
    try:
        handles, settings_hash = upload(coordinator, fixtures.load("basic-four-intervals"))
        pids = []
        for _ in range(2):
            job = analysis(session, handles, settings_hash)
            coordinator.receive(job)
            pids.append(coordinator.runner.process.pid)
            run_until_idle(coordinator)
            assert frames(coordinator)[0][job["id"]]["status"] == "ok"
            coordinator.runner.process.wait(timeout=10)
        assert pids[0] != pids[1]
    finally:
        coordinator.close()


def test_one_worker_process_serves_consecutive_analyses_and_ends_with_the_engine():
    fixture = fixtures.load("basic-four-intervals")
    coordinator, session = new_coordinator()
    try:
        handles, settings_hash = upload(coordinator, fixture)
        pids, answers = [], []
        for _ in range(3):
            job = analysis(session, handles, settings_hash)
            coordinator.receive(job)
            pids.append(coordinator.runner.process.pid)
            run_until_idle(coordinator)
            answers.append(frames(coordinator)[0][job["id"]])
        assert len(set(pids)) == 1 and all(answer["status"] == "ok" for answer in answers)
        assert answers[0]["result"]["outputs"].keys() == answers[2]["result"]["outputs"].keys()
        runner = coordinator.runner
    finally:
        coordinator.close()
    assert coordinator.runner is None and runner.process.poll() is not None


def test_inputs_can_be_deleted_as_soon_as_the_answer_arrives_while_the_worker_lives():
    # The worker maps its inputs; on Windows a file that is still mapped cannot be deleted, so the worker must unmap before it
    # answers (the page releases a section's buffers right after the result arrives).
    coordinator, session = new_coordinator()
    try:
        handles, settings_hash = upload(coordinator, fixtures.load("basic-four-intervals"))
        job = analysis(session, handles, settings_hash)
        coordinator.receive(job)
        run_until_idle(coordinator)
        assert frames(coordinator)[0][job["id"]]["status"] == "ok" and coordinator.runner.alive()
        paths = [coordinator.store.buffers[handle].path for handle in handles.values()]
        for handle in handles.values():
            coordinator.store.release(handle)
        assert not any(path.exists() for path in paths)
    finally:
        coordinator.close()


def test_abandoning_a_running_job_ends_its_worker_so_its_answer_cannot_reach_another_job():
    coordinator, session = new_coordinator()
    try:
        handles, settings_hash = upload(coordinator, fixtures.load("large-mixed"))
        job = analysis(session, handles, settings_hash)
        coordinator.receive(job)
        runner = coordinator.runner
        coordinator.cancel_all()
        assert runner.process.wait(timeout=10) is not None and coordinator.active is None
        assert frames(coordinator)[0][job["id"]]["status"] == "cancelled"
        after = analysis(session, handles, settings_hash)
        coordinator.receive(after)
        run_until_idle(coordinator)
        assert frames(coordinator)[0][after["id"]]["status"] == "ok" and coordinator.runner is not runner
    finally:
        coordinator.close()


def test_a_worker_stuck_inside_an_abandoned_job_is_killed(tmp_path):
    # Only the coordinator can end this worker: it has read its job and then does nothing, so a surviving process would
    # answer an old job later, to whoever is waiting by then.
    script = fake_worker(tmp_path, "import sys, time\nsys.stdin.readline()\ntime.sleep(120)\n")
    coordinator, session = new_coordinator(method_script=script)
    try:
        handles, settings_hash = upload(coordinator, fixtures.load("basic-four-intervals"))
        job = analysis(session, handles, settings_hash)
        coordinator.receive(job)
        runner = coordinator.runner
        time.sleep(0.5)
        coordinator.cancel_all()
        assert runner.process.wait(timeout=10) is not None
    finally:
        coordinator.close()


def test_a_worker_stops_by_itself_when_the_coordinator_is_gone():
    process = subprocess.Popen([sys.executable, "-I", "-B", "-u", str(ENGINE / "method_worker.py")],
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        process.stdin.close()                                       # what the coordinator's death looks like to the worker
        assert process.wait(timeout=60) == 1
    finally:
        process.kill()
        process.stdout.close()


def test_the_idle_clock_restarts_when_a_job_is_answered():
    coordinator, session = new_coordinator()
    try:
        handles, settings_hash = upload(coordinator, fixtures.load("basic-four-intervals"))
        job = analysis(session, handles, settings_hash)
        coordinator.receive(job)
        started = coordinator.runner.idle_since
        run_until_idle(coordinator)
        assert coordinator.runner.idle_since > started
    finally:
        coordinator.close()


def test_a_killed_worker_costs_one_job_and_the_next_gets_a_new_process():
    coordinator, session = new_coordinator()
    try:
        handles, settings_hash = upload(coordinator, fixtures.load("basic-four-intervals"))
        first = analysis(session, handles, settings_hash)
        coordinator.receive(first)
        run_until_idle(coordinator)
        assert frames(coordinator)[0][first["id"]]["status"] == "ok"
        pid = coordinator.runner.process.pid
        coordinator.runner.kill()
        coordinator.runner.process.wait(timeout=10)
        second = analysis(session, handles, settings_hash)
        coordinator.receive(second)
        run_until_idle(coordinator)
        assert frames(coordinator)[0][second["id"]]["status"] == "ok" and coordinator.runner.process.pid != pid
        third = analysis(session, handles, settings_hash)
        coordinator.receive(third)
        coordinator.runner.kill()                                   # killed in the middle of a job
        run_until_idle(coordinator)
        assert frames(coordinator)[0][third["id"]]["error"]["code"] == "INTERNAL"
        assert not [p for p in Path(coordinator.store.directory.name).iterdir() if p.name.startswith("job-")]
        fourth = analysis(session, handles, settings_hash)
        coordinator.receive(fourth)
        run_until_idle(coordinator)
        assert frames(coordinator)[0][fourth["id"]]["status"] == "ok"
    finally:
        coordinator.close()


def test_an_idle_worker_is_stopped_and_started_again_when_needed():
    coordinator, session = new_coordinator()
    try:
        coordinator.runner_idle_seconds = 0.2
        handles, settings_hash = upload(coordinator, fixtures.load("basic-four-intervals"))
        first = analysis(session, handles, settings_hash)
        coordinator.receive(first)
        run_until_idle(coordinator)
        runner = coordinator.runner
        deadline = time.monotonic() + 10
        while coordinator.runner is not None and time.monotonic() < deadline:
            coordinator.poll()
            time.sleep(0.02)
        assert coordinator.runner is None and runner.process.poll() is not None
        second = analysis(session, handles, settings_hash)
        coordinator.receive(second)
        run_until_idle(coordinator)
        assert frames(coordinator)[0][second["id"]]["status"] == "ok"
    finally:
        coordinator.close()


def test_results_that_do_not_fit_the_session_budget_are_refused_and_released():
    fixture = fixtures.load("basic-four-intervals")
    coordinator, session = new_coordinator()
    try:
        handles, settings_hash = upload(coordinator, fixture)
        coordinator.store.budget = coordinator.store.reserved + 100       # room for a few bytes only
        baseline, count = coordinator.store.reserved, len(coordinator.store.buffers)
        job = analysis(session, handles, settings_hash)
        coordinator.receive(job)
        run_until_idle(coordinator)
        error = frames(coordinator)[0][job["id"]]["error"]
        assert error["code"] == "LIMIT_EXCEEDED"
        assert coordinator.store.reserved == baseline and len(coordinator.store.buffers) == count
    finally:
        coordinator.close()


def test_queue_limits_apply_to_analyses_too():
    coordinator, session = new_coordinator(method_script=None)
    try:
        handles, settings_hash = upload(coordinator, fixtures.load("large-mixed"))
        sent = [analysis(session, handles, settings_hash) for _ in range(6)]
        for item in sent:
            coordinator.receive(item)
        responses = frames(coordinator)[0]
        assert responses[sent[5]["id"]]["error"]["code"] == "BUSY"          # one active, four queued, the sixth is refused
        assert coordinator.store.buffers[handles["labels"]].pins == 5
        coordinator.cancel_all()
        assert coordinator.store.buffers[handles["labels"]].pins == 0
    finally:
        coordinator.close()


def test_the_digest_diagnostic_still_works_next_to_the_methods():
    coordinator, session = new_coordinator()
    try:
        data = b"public synthetic bytes"
        handle = put(coordinator, data, "u8", [len(data)])
        job = request(session, "buffer.digest", {"handle": handle})
        coordinator.receive(job)
        run_until_idle(coordinator)
        assert frames(coordinator)[0][job["id"]]["result"] == {"sha256": hashlib.sha256(data).hexdigest(), "byte_length": len(data)}
    finally:
        coordinator.close()


def test_input_tables_of_the_coordinator_agree_with_the_method_module():
    method = specs.METHOD_INPUTS[METHOD]
    assert set(method) == set(section_intervals.INPUT_NAMES)
    assert {name for name, (_, _, needed) in method.items() if not needed} == {"stack_members"}
    expected = {"labels": ("<i4", 2), "exclude": ("u1", 2), "stack_offsets": ("<u4", 1), "stack_members": ("<u4", 1)}
    for name, (dtype, rank) in expected.items():
        assert (specs.NUMPY_DTYPES[method[name][0]], method[name][1]) == (dtype, rank)
    assert all(method[name][0] == "utf8json" for name in ("objects", "classes", "settings", "age_model", "manual_indices"))


def test_a_method_worker_does_not_load_pandas_or_the_public_package():
    code = (f"import sys; sys.path.insert(0, {str(ENGINE)!r}); import method_worker; method_worker.load_registry();"
            " print('pandas' in sys.modules, 'PIL' in sys.modules, 'numpy' in sys.modules)")
    started = time.monotonic()
    out = subprocess.run([sys.executable, "-I", "-c", code], capture_output=True, text=True, check=True, timeout=60).stdout.split()
    assert out == ["False", "False", "True"], "start-up stays light: numpy yes, pandas and Pillow no"
    assert time.monotonic() - started < 10


def test_the_liveness_watcher_starts_only_after_numpy_and_the_methods_are_imported():
    # On Windows a thread blocked reading the stdin pipe made `import numpy` hang in a clean environment (GitHub runner,
    # 13 November 2026), while Anaconda's NumPy was unaffected. The reader thread of the job loop is that thread now: it must
    # be started by `serve`, which the entry point calls only after `load_modules()`, and nothing else may start a thread first.
    import ast

    tree = ast.parse((ENGINE / "method_worker.py").read_text(encoding="utf-8"))
    main = next(node for node in tree.body if isinstance(node, ast.If) and "__main__" in ast.dump(node.test))
    calls = [ast.unparse(statement) for statement in main.body]
    imports = next(i for i, call in enumerate(calls) if "load_modules()" in call)
    serving = next(i for i, call in enumerate(calls) if "serve(" in call)
    assert imports < serving, calls
    serve = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "serve")
    assert any("Thread(" in ast.unparse(statement) for statement in serve.body), "serve starts the reader thread"
    outside = [ast.unparse(node) for node in tree.body if not isinstance(node, ast.FunctionDef) and node is not main and "Thread" in ast.unparse(node)]
    assert not outside, outside


def test_a_second_job_that_changes_only_the_settings_gives_the_result_of_a_fresh_calculation():
    """The worker keeps the counts of masks it has seen (card M8.4.3); the answer must still be the answer of a calculation from nothing."""
    fixture = fixtures.load("large-mixed")
    coordinator, session = new_coordinator()
    try:
        handles, settings_hash = upload(coordinator, fixture)
        for bin_cm in (None, 1.37, 7.5, 0.4):
            current = handles
            if bin_cm is not None:
                settings = {**fixture["inputs"]["settings"], "bin_cm": bin_cm}
                data = json.dumps(settings, separators=(",", ":")).encode()
                current = {**handles, "settings": put(coordinator, data, "utf8json", [len(data)])}
            job = analysis(session, current, coordinator.store.buffers[current["settings"]].expected_hash)
            coordinator.receive(job)
            run_until_idle(coordinator)
            response = frames(coordinator)[0][job["id"]]
            assert response["status"] == "ok", response
            columns = download(coordinator, session, response["result"])
            direct_inputs = {**inputs_from(fixture)}
            if bin_cm is not None:
                direct_inputs["settings"] = {**direct_inputs["settings"], "bin_cm": bin_cm}
            direct = section_intervals.run(section_intervals.parse(direct_inputs))
            assert columns.keys() == direct.columns.keys()
            for key in columns:
                np.testing.assert_array_equal(columns[key], direct.columns[key], err_msg=f"bin_cm {bin_cm}: {key}")
            coordinator.receive(request(session, "buffer.release", {"handles": [item["handle"] for item in response["result"]["outputs"].values()]}))
    finally:
        coordinator.close()


def inputs_from(fixture):
    """The decoded inputs of a fixture as the method takes them."""
    raw = fixture["inputs"]
    out = {name: json.loads(json.dumps(raw[name])) for name in ("objects", "classes", "settings", "age_model", "manual_indices")}
    for name in ("labels", "exclude", "stack_offsets"):
        out[name] = fixtures.array(raw[name])
    out["stack_members"] = fixtures.array(raw["stack_members"]) if raw["stack_members"] else None
    return out


def test_the_job_description_carries_the_verified_hash_of_every_input(tmp_path):
    fixture = fixtures.load("basic-four-intervals")
    coordinator, session = new_coordinator()
    try:
        handles, settings_hash = upload(coordinator, fixture)
        request_ = analysis(session, handles, settings_hash)
        coordinator.receive(request_)
        description = json.loads((coordinator.active["worker"].directory / "job.json").read_text(encoding="utf-8"))
        assert {name: spec["sha256"] for name, spec in description["inputs"].items()} == {name: coordinator.store.buffers[h].expected_hash for name, h in handles.items()}
        run_until_idle(coordinator)
    finally:
        coordinator.close()


def worker_job(tmp_path, fixture, name, settings_change=None, hashes=True):
    """A job.json for the worker function, with input files written the way the coordinator keeps them."""
    raw = fixture["inputs"]
    folder = tmp_path / name
    folder.mkdir()
    specification = {}

    def write(key, data, dtype, shape):
        path = folder / key
        path.write_bytes(data)
        specification[key] = {"path": str(path), "dtype": dtype, "shape": shape, **({"sha256": hashlib.sha256(data).hexdigest()} if hashes else {})}

    for key, dtype in (("labels", "i32le"), ("exclude", "u8"), ("stack_offsets", "u32le")):
        array = fixtures.array(raw[key])
        write(key, array.tobytes(), dtype, list(array.shape))
    if raw["stack_members"]:
        members = fixtures.array(raw["stack_members"])
        write("stack_members", members.tobytes(), "u32le", list(members.shape))
    for key in ("objects", "classes", "settings", "age_model", "manual_indices"):
        value = json.loads(json.dumps(raw[key]))
        if key == "settings" and settings_change:
            value.update(settings_change)
        data = json.dumps(value, separators=(",", ":")).encode()
        write(key, data, "utf8json", [len(data)])
    job = folder / "job.json"
    job.write_text(json.dumps({"method": METHOD, "cancel_path": str(folder / "cancel"), "output_dir": str(folder / "out"), "inputs": specification}))
    return job


@pytest.fixture
def worker_module():
    sys.path.insert(0, str(ENGINE))
    try:
        import method_worker
        yield method_worker, method_worker.load_modules()
    finally:
        sys.path.remove(str(ENGINE))
        sys.modules.pop("method_worker", None)


def test_the_worker_counts_a_mask_once_and_only_while_it_remembers_it(tmp_path, worker_module, monkeypatch):
    worker, modules = worker_module
    calls = []
    real = section_intervals.object_row_counts
    monkeypatch.setattr(section_intervals, "object_row_counts", lambda *a, **k: calls.append(1) or real(*a, **k))
    fixture = fixtures.load("large-mixed")
    memos = {}
    first = worker.run(worker_job(tmp_path, fixture, "a"), modules, memos)
    counted = len(calls)
    assert first["ok"] and counted > 0
    again = worker.run(worker_job(tmp_path, fixture, "b", {"bin_cm": 1.37}), modules, memos)      # same masks, other settings
    assert again["ok"] and len(calls) == counted, "the worker did not count the same masks twice"
    assert set(memos) == {METHOD, "tables"}, "one memory per method, and the decoded tables"
    worker.run(worker_job(tmp_path, fixture, "c"), modules, {})                                   # a worker that remembers nothing counts again
    assert len(calls) == 2 * counted
    worker.run(worker_job(tmp_path, fixture, "d", hashes=False), modules, memos)                  # inputs without a verified hash are never remembered
    assert len(calls) == 3 * counted
    assert len(memos[METHOD]["counts"]) == 1


def test_a_table_with_a_remembered_hash_is_not_read_again(tmp_path, worker_module):
    worker, modules = worker_module
    fixture = fixtures.load("basic-four-intervals")
    memos = {}
    job = worker_job(tmp_path, fixture, "a")
    assert worker.run(job, modules, memos)["ok"]
    description = json.loads(job.read_text())
    for name in ("objects", "classes", "age_model", "manual_indices"):
        Path(description["inputs"][name]["path"]).write_bytes(b"{not json")          # the hash says it is the table decoded before
    assert worker.run(job, modules, memos)["ok"], "the remembered tables were used"
    with pytest.raises(Exception):
        worker.run(job, modules, {})                                                  # a worker that remembers nothing reads the damaged file
    for name in ("objects", "classes", "age_model", "manual_indices"):
        description["inputs"][name].pop("sha256")
    job.write_text(json.dumps(description))
    with pytest.raises(Exception):
        worker.run(job, modules, memos)                                               # no hash, no memory
    assert len(memos["tables"]) <= worker.TABLE_CACHE_ENTRIES


def test_the_table_memory_is_bounded(tmp_path, monkeypatch, worker_module):
    worker, _ = worker_module
    monkeypatch.setattr(worker, "TABLE_CACHE_ENTRIES", 3)
    tables = {}
    for k in range(7):
        path = tmp_path / f"t{k}"
        path.write_bytes(json.dumps({"k": k}).encode())
        assert worker.decoded_table(path, f"{k:064x}", tables) == {"k": k}
    assert list(tables) == [f"{k:064x}" for k in (4, 5, 6)]


def test_a_job_on_a_derived_mask_names_what_was_written_and_gives_the_result_of_a_fresh_calculation():
    fixture = fixtures.load("large-mixed")
    coordinator, session = new_coordinator()
    try:
        handles, settings_hash = upload(coordinator, fixture)
        first = analysis(session, handles, settings_hash)
        coordinator.receive(first)
        run_until_idle(coordinator)
        assert frames(coordinator)[0][first["id"]]["status"] == "ok"
        labels = fixtures.array(fixture["inputs"]["labels"]).copy()
        ids = [o["id"] for o in fixture["inputs"]["objects"]]
        labels[100:110] = np.resize(np.array(ids + [0]), labels[100:110].shape)
        data, row_bytes = labels.tobytes(), labels.shape[1] * 4
        derived = coordinator.store.derive({"base": handles["labels"], "dtype": "i32le", "shape": list(labels.shape), "byte_length": len(data),
                                            "sha256": hashlib.sha256(data).hexdigest()})["handle"]
        coordinator.store.append({"handle": derived, "offset": 100 * row_bytes, "byte_length": 10 * row_bytes}, data[100 * row_bytes:110 * row_bytes])
        coordinator.store.commit({"handle": derived})
        current = {**handles, "labels": derived}
        second = analysis(session, current, settings_hash)
        coordinator.receive(second)
        description = json.loads((coordinator.active["worker"].directory / "job.json").read_text(encoding="utf-8"))
        assert description["inputs"]["labels"]["derived_from"] == {"sha256": coordinator.store.buffers[handles["labels"]].expected_hash,
                                                                   "ranges": [[100 * row_bytes, 110 * row_bytes]]}
        assert all("derived_from" not in spec for name, spec in description["inputs"].items() if name != "labels")
        run_until_idle(coordinator)
        response = frames(coordinator)[0][second["id"]]
        assert response["status"] == "ok", response
        columns = download(coordinator, session, response["result"])
        direct = section_intervals.run(section_intervals.parse({**inputs_from(fixture), "labels": labels}))
        assert columns.keys() == direct.columns.keys()
        for key in columns:
            np.testing.assert_array_equal(columns[key], direct.columns[key], err_msg=key)
    finally:
        coordinator.close()


def test_the_worker_recounts_only_the_rows_it_is_told_were_written(tmp_path, worker_module, monkeypatch):
    worker, modules = worker_module
    fixture = fixtures.load("large-mixed")
    rows = []
    real = section_intervals.object_row_counts
    monkeypatch.setattr(section_intervals, "object_row_counts", lambda labels, *a, **k: rows.append(labels.shape[0]) or real(labels, *a, **k))
    memos = {}
    base_job = worker_job(tmp_path, fixture, "base")
    assert worker.run(base_job, modules, memos)["ok"]
    base_hash = json.loads(base_job.read_text())["inputs"]["labels"]["sha256"]
    roi = fixture["inputs"]["settings"]["roi"]
    rows.clear()

    labels = fixtures.array(fixture["inputs"]["labels"]).copy()
    ids = [o["id"] for o in fixture["inputs"]["objects"]]
    first, end = roi["y0"] + 30, roi["y0"] + 42
    labels[first:end] = np.resize(np.array(ids + [0]), labels[first:end].shape)
    job_file = worker_job(tmp_path, fixture, "edited")
    description = json.loads(job_file.read_text())
    spec = description["inputs"]["labels"]
    Path(spec["path"]).write_bytes(labels.tobytes())
    spec["sha256"] = hashlib.sha256(labels.tobytes()).hexdigest()
    row_bytes = labels.shape[1] * 4
    spec["derived_from"] = {"sha256": base_hash, "ranges": [[first * row_bytes, end * row_bytes]]}
    job_file.write_text(json.dumps(description))

    answer = worker.run(job_file, modules, memos)
    assert answer["ok"]
    assert sum(rows) == end - first, f"counted {sum(rows)} rows for {end - first} written rows"
    description["inputs"]["labels"].pop("derived_from")                         # the same job without the information: everything is counted
    job_file.write_text(json.dumps(description))
    rows.clear()
    worker.run(job_file, modules, {})
    assert sum(rows) == roi["y1"] - roi["y0"]
