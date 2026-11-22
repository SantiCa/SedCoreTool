"""Card M8.4.9: working pixels of a section in the engine, as `u8[h,w,4]` and `u16le[h,w,4]` buffers.

The type `u16le` is checked like the other numeric types (admission, size, packed results, NumPy mapping). A probe method that
exists only in these tests sums a region of the resident pixels in the real method-worker process, reading the buffers that the
coordinator committed through the transport, and must reproduce the sums of the arrays that were sent.
"""

import hashlib
import io
import json
import time
from pathlib import Path
from uuid import uuid4

import numpy as np
import pytest

from sedcoretool.engine import specs
from sedcoretool.engine.buffers import ITEM_BYTES, BufferStore
from sedcoretool.engine.protocol import JSON_FRAME, MAX_CHUNK, RequestError, read_frame, strict_json
from sedcoretool.engine.server import Coordinator
from sedcoretool.engine.worker import MethodJob, MethodRunner

ENGINE = Path(__file__).resolve().parents[1] / "src" / "sedcoretool" / "engine"
PROBE = "test.pixels.region_sum/0"


def request(session, operation, payload):
    return {"v": 1, "kind": "request", "session": session, "id": str(uuid4()), "op": operation, "payload": payload}


def answers(coordinator):
    stream, out = io.BytesIO(coordinator.output.getvalue()), {}
    while frame := read_frame(stream):
        if frame[0] == JSON_FRAME:
            value = strict_json(frame[1])
            out[value["id"]] = value
    return out


def send(coordinator, session, array, dtype, chunk=MAX_CHUNK):
    """Upload `array` with the protocol operations the bridge forwards (begin, chunks of at most `chunk` bytes, commit)."""
    data = np.ascontiguousarray(array).tobytes()
    begun = request(session, "buffer.begin", {"dtype": dtype, "shape": list(array.shape), "byte_length": len(data), "sha256": hashlib.sha256(data).hexdigest()})
    coordinator.receive(begun)
    reply = answers(coordinator)[begun["id"]]
    assert reply["status"] == "ok", reply
    handle = reply["result"]["handle"]
    for offset in range(0, len(data), chunk):
        part = data[offset:offset + chunk]
        sent = request(session, "buffer.chunk", {"handle": handle, "offset": offset, "byte_length": len(part)})
        coordinator.receive(sent, part)
        assert answers(coordinator)[sent["id"]]["status"] == "ok"
    committed = request(session, "buffer.commit", {"handle": handle})
    coordinator.receive(committed)
    assert answers(coordinator)[committed["id"]]["status"] == "ok"
    return handle


def pixels(seed, h, w, bits):
    rng = np.random.Generator(np.random.PCG64(seed))
    wide = rng.integers(0, 65536, size=(h, w, 4), dtype=np.uint16)
    return (wide >> 8).astype(np.uint8), (wide if bits == 16 else None)


# ---- the type u16le -----------------------------------------------------------------------------------------------------

def test_u16le_is_a_numeric_buffer_type_of_two_bytes_mapped_to_little_endian_uint16():
    assert ITEM_BYTES["u16le"] == 2
    assert specs.NUMPY_DTYPES["u16le"] == "<u2" and specs.CONTRACT_DTYPES[np.dtype("<u2").str] == "u16le"
    # Every numeric type maps to NumPy and back, with the item size of the transport.
    numeric = {name for name in ITEM_BYTES if name != "utf8json"}
    assert set(specs.NUMPY_DTYPES) == numeric
    for name, numpy_type in specs.NUMPY_DTYPES.items():
        assert specs.CONTRACT_DTYPES[np.dtype(numpy_type).str] == name and np.dtype(numpy_type).itemsize == ITEM_BYTES[name], name


def test_a_u16le_buffer_is_admitted_with_its_exact_size_and_committed_after_verification():
    store = BufferStore()
    try:
        values = np.arange(2 * 3 * 4, dtype="<u2").reshape(2, 3, 4) * 2731
        data = values.tobytes()
        descriptor = {"dtype": "u16le", "shape": [2, 3, 4], "byte_length": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        for wrong in ({"byte_length": len(data) // 2}, {"byte_length": len(data) * 2}, {"shape": [2, 3, 8]}, {"shape": [2, 3, 4, 1]}):
            with pytest.raises(RequestError) as refused:
                store.begin({**descriptor, **wrong})
            assert refused.value.code == "INVALID_BUFFER"
        handle = store.begin(descriptor)["handle"]
        store.append({"handle": handle, "offset": 0, "byte_length": len(data)}, data)
        store.commit({"handle": handle})
        value = store.buffers[handle]
        assert (value.dtype, value.shape, value.length, value.committed) == ("u16le", (2, 3, 4), 48, True)
        np.testing.assert_array_equal(np.fromfile(value.path, dtype=specs.NUMPY_DTYPES["u16le"]).reshape(2, 3, 4), values)
        bad = store.begin({**descriptor, "sha256": "0" * 64})["handle"]
        store.append({"handle": bad, "offset": 0, "byte_length": len(data)}, data)
        with pytest.raises(RequestError):
            store.commit({"handle": bad})
    finally:
        store.close()


def test_a_packed_result_may_carry_a_u16le_column(tmp_path):
    store = BufferStore()
    try:
        column, counts = np.array([0, 1, 65535], dtype="<u2"), np.array([7], dtype="<u8")
        body = bytearray(16)
        body[0:6], body[8:16] = column.tobytes(), counts.tobytes()
        path = tmp_path / "result.bin"
        path.write_bytes(bytes(body))
        layout = {"probe": {"dtype": "u16le", "shape": [3], "offset": 0, "byte_length": 6}, "n": {"dtype": "u64le", "shape": [1], "offset": 8, "byte_length": 8}}
        handle, adopted = store.adopt_packed(path, 16, hashlib.sha256(bytes(body)).hexdigest(), layout)
        assert adopted == layout
        np.testing.assert_array_equal(np.frombuffer(store.buffers[handle].path.read_bytes(), "<u2", 3, 0), column)
        wrong = tmp_path / "wrong.bin"
        wrong.write_bytes(bytes(body))
        with pytest.raises(RequestError):     # three u16le values are 6 bytes, not 12
            store.adopt_packed(wrong, 16, hashlib.sha256(bytes(body)).hexdigest(), {"probe": {**layout["probe"], "byte_length": 12}})
    finally:
        store.close()


# ---- the probe: a test-only method that sums a region of resident pixels -------------------------------------------------

# A stand-in for the engine's method worker: the real one (method_worker.py, the same registry, job files, packing and answers) with
# one more method that exists only here. The coordinator never offers it; the test hands the job to the worker as the coordinator does.
PROBE_WORKER = '''
import sys, types
sys.path.insert(0, {engine!r})
import method_worker
modules = method_worker.load_modules()
np, registry, Cancelled, MethodError = modules

probe = types.ModuleType("probe")
probe.NAME = {name!r}
probe.INPUT_NAMES = ("rgba", "rgba16", "region")

class Result:
    def __init__(self, dimensions, columns):
        self.dimensions, self.columns = dimensions, columns

def parse(inputs, *, hashes=None, memo=None, derived=None):
    return inputs

def run(inputs, *, cancelled, memo=None):
    r = inputs["region"]
    window = (slice(r["y0"], r["y1"]), slice(r["x0"], r["x1"]))
    columns = {{"sum8": inputs["rgba"][window].sum(axis=(0, 1), dtype=np.uint64),
                "shape": np.array(inputs["rgba"].shape, dtype=np.uint32)}}
    if inputs["rgba16"] is not None:
        columns["sum16"] = inputs["rgba16"][window].sum(axis=(0, 1), dtype=np.uint64)
        columns["first16"] = np.ascontiguousarray(inputs["rgba16"][r["y0"], r["x0"]])     # uint16: packed as u16le
    return Result({{"bins": 1, "classes": 1, "schemes": 1}}, columns)

probe.parse, probe.run = parse, run
registry.METHODS[probe.NAME] = probe
method_worker.serve(modules)
'''


def probe(coordinator, tmp_path, runner, handles, region):
    """Run the probe on committed buffers the way the coordinator starts a job; returns the result columns."""
    region_bytes = json.dumps(region, separators=(",", ":")).encode()
    store = coordinator.store
    handle = store.begin({"dtype": "utf8json", "shape": [len(region_bytes)], "byte_length": len(region_bytes), "sha256": hashlib.sha256(region_bytes).hexdigest()})["handle"]
    store.append({"handle": handle, "offset": 0, "byte_length": len(region_bytes)}, region_bytes)
    store.commit({"handle": handle})
    directory = tmp_path / f"job-{uuid4()}"
    (directory / "out").mkdir(parents=True)
    inputs = {name: {"path": str(store.buffers[h].path), "dtype": store.buffers[h].dtype, "shape": list(store.buffers[h].shape), "sha256": store.buffers[h].expected_hash}
              for name, h in {**handles, "region": handle}.items()}
    job_file = directory / "job.json"
    job_file.write_text(json.dumps({"method": PROBE, "cancel_path": str(directory / "cancel"), "output_dir": str(directory / "out"), "inputs": inputs}), encoding="utf-8")
    job = MethodJob(runner, job_file, directory / "cancel")
    deadline = time.monotonic() + 60
    while not job.finished() and time.monotonic() < deadline:
        time.sleep(0.01)
    assert job.result and job.result.get("ok"), job.result
    data = (directory / "out" / "result.bin").read_bytes()
    assert hashlib.sha256(data).hexdigest() == job.result["packed"]["sha256"]
    columns = {}
    for name, part in job.result["packed"]["layout"].items():
        dtype = np.dtype(specs.NUMPY_DTYPES[part["dtype"]])
        columns[name] = np.frombuffer(data, dtype=dtype, count=int(np.prod(part["shape"])), offset=part["offset"]).reshape(part["shape"])
    return columns


@pytest.mark.parametrize("bits", [8, 16])
def test_the_probe_reads_in_the_worker_exactly_the_pixels_that_were_sent(tmp_path, bits):
    script = tmp_path / "probe_worker.py"
    script.write_text(PROBE_WORKER.format(engine=str(ENGINE), name=PROBE), encoding="utf-8")
    coordinator = Coordinator(io.BytesIO(), version="test", runtime_id="0" * 64)
    session = str(uuid4())
    coordinator.receive(request(session, "hello", {"protocol": 1}))
    runner = MethodRunner(script)
    try:
        h, w = 700, 480                                     # 1.3 MB of 8-bit and 2.7 MB of 16-bit pixels: several chunks each
        rgba, rgba16 = pixels(138501 + bits, h, w, bits)
        handles = {"rgba": send(coordinator, session, rgba, "u8")}
        if rgba16 is not None:
            handles["rgba16"] = send(coordinator, session, rgba16, "u16le", chunk=MAX_CHUNK - 6)   # chunk edges inside 16-bit values
        for region in ({"x0": 0, "y0": 0, "x1": w, "y1": h}, {"x0": 37, "y0": 101, "x1": 411, "y1": 650}, {"x0": w - 1, "y0": h - 1, "x1": w, "y1": h}):
            columns = probe(coordinator, tmp_path, runner, handles, region)
            window = (slice(region["y0"], region["y1"]), slice(region["x0"], region["x1"]))
            np.testing.assert_array_equal(columns["shape"], [h, w, 4])
            np.testing.assert_array_equal(columns["sum8"], rgba[window].sum(axis=(0, 1), dtype=np.uint64))
            if bits == 16:
                np.testing.assert_array_equal(columns["sum16"], rgba16[window].sum(axis=(0, 1), dtype=np.uint64))
                assert columns["first16"].dtype == np.dtype("<u2")
                np.testing.assert_array_equal(columns["first16"], rgba16[region["y0"], region["x0"]])
            else:
                assert "sum16" not in columns
        # The probe is a test fixture, never an engine method.
        hello = request(str(uuid4()), "hello", {"protocol": 1})
        other = Coordinator(io.BytesIO(), version="test", runtime_id="0" * 64)
        other.receive(hello)
        assert PROBE not in answers(other)[hello["id"]]["result"]["methods"]
        other.close()
    finally:
        runner.close()
        coordinator.close()

