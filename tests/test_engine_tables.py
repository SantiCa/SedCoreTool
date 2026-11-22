"""Card M8.4.10: record tables in the engine, built by ``app/js/tablesnapshot.js`` and decoded by ``methods/validation.py::table``.

Random tables with missing values are built by the program's own JavaScript (Node, fixed seed) and decoded here: every value and every
missing slot must come back exactly. The decoder is then given corrupt and hostile tables, each of which must be refused naming the
input at fault. Last, a probe method that exists only in these tests decodes the tables in the real method-worker process, after the
coordinator committed the buffers through the transport, and returns the sum of every column; it must equal the sums the JavaScript
computed from the interface's arrays. Tolerance: none. Both sides add the same float64 values in the same order (row order, missing
slots skipped, starting from 0): JavaScript with ``+=`` in a loop and NumPy with ``np.add.accumulate``, which is strictly sequential, so
the results are bit-identical IEEE 754 sums.
"""

import base64
import hashlib
import io
import json
import shutil
import subprocess
import time
from pathlib import Path
from uuid import uuid4

import numpy as np
import pytest

from sedcoretool.engine import specs
from sedcoretool.engine.protocol import strict_json
from sedcoretool.engine.server import Coordinator
from sedcoretool.engine.worker import MethodJob, MethodRunner
from sedcoretool.methods import validation
from sedcoretool.methods.errors import MethodError
from test_engine_pixels import ENGINE, request, send

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
PROBE = "test.tables.column_sums/0"

# Builds random tables with the program's module and prints them as JSON: the source columns (null = missing), the three buffers in
# base64, their SHA-256, the identity, and the column sums the interface would compute (row order, missing values skipped).
BUILDER = r'''
import { pathToFileURL } from 'node:url';
const { buildTableSnapshot } = await import(pathToFileURL(process.argv[2]).href);
let state = 20261122;
const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
const NAMES = ['depth', 'age', 'Ca/Ti', 'δ18O', 'Fe (cps)', 'TOC', 'x', 'magnetic susceptibility', 'core 𝛼 ratio', 'Zr'];
const UNITS = ['cm', '', '‰', 'ka BP', 'SI×10⁻⁵'];
function value(kind) {
  if (kind === 0) return Math.floor(random() * 2001) - 1000;                        // integers, as depths often are
  if (kind === 1) return (random() - 0.5) * 10 ** Math.floor(random() * 40 - 20);   // mixed magnitudes
  if (kind === 2) return (random() - 0.5) * 10 ** Math.floor(random() * 600 - 300); // near the ends of the float64 range
  return [5e-324, -5e-324, 1.7976931348623157e308, -1.7976931348623157e308, 2.2250738585072014e-308, 0.1, 1 / 3][Math.floor(random() * 7)];
}
const tables = [];
for (let t = 0; t < 40; t++) {
  const count = t === 0 ? 1 : 1 + Math.floor(random() * 10), rows = t === 1 ? 1 : 1 + Math.floor(random() * (t < 30 ? 300 : 20000));
  const columns = [];
  for (let i = 0; i < count; i++) {
    const missing = [0, 1, random(), 0.05][Math.floor(random() * 4)], kind = Math.floor(random() * 4);
    columns.push({ name: NAMES[i], unit: UNITS[Math.floor(random() * UNITS.length)],
      values: Array.from({ length: rows }, () => (random() < missing ? null : value(kind))) });
  }
  const snapshot = await buildTableSnapshot(columns);
  const sums = columns.map((column) => { let sum = 0, n = 0; for (const v of column.values) if (v !== null) { sum += v; n++; } return [sum, n]; });
  const b64 = (typed) => Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString('base64');
  tables.push({ columns, identity: snapshot.identity, rows: snapshot.rows,
    buffers: Object.fromEntries(Object.entries(snapshot.buffers).map(([k, b]) => [k, { dtype: b.dtype, shape: b.shape, sha256: b.sha256, data: b64(b.data) }])),
    sums: sums.map((s) => s[0]), counts: sums.map((s) => s[1]) });
}
process.stdout.write(JSON.stringify(tables));
'''


@pytest.fixture(scope="module")
def javascript_tables(tmp_path_factory):
    if NODE is None:
        pytest.skip("node is not installed")
    script = tmp_path_factory.mktemp("tables") / "build_tables.mjs"
    script.write_text(BUILDER, encoding="utf-8")
    out = subprocess.run([NODE, str(script), str(ROOT / "app" / "js" / "tablesnapshot.js")], capture_output=True, text=True,
                         encoding="utf-8", check=True, timeout=120).stdout
    return json.loads(out)


def raw(entry):
    """The three buffers of a JavaScript table as bytes."""
    return {key: base64.b64decode(part["data"]) for key, part in entry["buffers"].items()}


def decoded_inputs(entry, name="record"):
    """The inputs the method worker would hand a method: the description decoded with the transport's rules, the rest as arrays."""
    data, shape = raw(entry), tuple(entry["buffers"]["values"]["shape"])
    return {name: strict_json(data["meta"], metadata=True),
            f"{name}_values": np.frombuffer(data["values"], dtype="<f8").reshape(shape),
            f"{name}_valid": np.frombuffer(data["valid"], dtype="u1").reshape(shape)}


# ---- round trip: JavaScript build, Python decode ----------------------------------------------------------------------------

def test_random_tables_with_missing_values_come_back_exactly(javascript_tables):
    missing_seen = present_seen = 0
    for entry in javascript_tables:
        data = raw(entry)
        for key, part in entry["buffers"].items():
            assert hashlib.sha256(data[key]).hexdigest() == part["sha256"], key
        decoded = validation.table(decoded_inputs(entry), "record")
        assert list(decoded) == [column["name"] for column in entry["columns"]]
        for column in entry["columns"]:
            got = decoded[column["name"]]
            assert got.unit == column["unit"] and got.values.shape == got.valid.shape == (entry["rows"],)
            for j, expected in enumerate(column["values"]):
                if expected is None:
                    assert not got.valid[j] and got.values[j] == 0
                    missing_seen += 1
                else:
                    assert got.valid[j] and np.float64(expected).tobytes() == got.values[j].tobytes(), (column["name"], j)
                    present_seen += 1
    assert missing_seen > 10_000 and present_seen > 10_000


def test_the_buffers_have_the_documented_layout(javascript_tables):
    entry = next(e for e in javascript_tables if len(e["columns"]) > 2)
    count, rows = len(entry["columns"]), entry["rows"]
    assert entry["buffers"]["values"]["dtype"] == "f64le" and entry["buffers"]["values"]["shape"] == [count, rows]
    assert entry["buffers"]["valid"]["dtype"] == "u8" and entry["buffers"]["valid"]["shape"] == [count, rows]
    assert entry["buffers"]["meta"]["dtype"] == "utf8json"
    meta = strict_json(raw(entry)["meta"], metadata=True)
    assert meta == {"version": 1, "rows": rows, "columns": [{"name": c["name"], "unit": c["unit"]} for c in entry["columns"]]}


# ---- rejection: the decoder treats every table as hostile ---------------------------------------------------------------------

def small(name="t"):
    meta = {"version": 1, "rows": 3, "columns": [{"name": "depth", "unit": "cm"}, {"name": "Ca", "unit": ""}]}
    values = np.array([[0.0, 1.5, 3.0], [7.0, 0.0, 9.0]], dtype="<f8")
    valid = np.array([[1, 1, 1], [1, 0, 1]], dtype="u1")
    return {name: meta, f"{name}_values": values, f"{name}_valid": valid}


def refused(inputs, code, field, **options):
    with pytest.raises(MethodError) as error:
        validation.table(inputs, "t", **options)
    assert (error.value.code, error.value.field) == (code, field)


def test_a_sound_small_table_is_accepted():
    table = validation.table(small(), "t", ("depth", "Ca", "Fe"), required=("depth",))
    assert list(table) == ["depth", "Ca"]
    np.testing.assert_array_equal(table["Ca"].valid, [True, False, True])
    np.testing.assert_array_equal(table["Ca"].values, [7.0, 0.0, 9.0])


def with_meta(**changes):
    inputs = small()
    inputs["t"] = {**inputs["t"], **changes}
    return inputs


@pytest.mark.parametrize("inputs, code, field", [
    ({}, "INVALID_REQUEST", "t"),
    ({**small(), "t": [1, 2]}, "INVALID_REQUEST", "t"),
    ({**small(), "t": {"version": 1, "rows": 3}}, "INVALID_REQUEST", "t"),
    ({**small(), "t": {**small()["t"], "extra": 1}}, "INVALID_REQUEST", "t"),
    (with_meta(version=2), "UNSUPPORTED_INPUT", "t.version"),
    (with_meta(version=True), "UNSUPPORTED_INPUT", "t.version"),
    (with_meta(rows=0), "INVALID_REQUEST", "t.rows"),
    (with_meta(rows=3.0), "INVALID_REQUEST", "t.rows"),
    (with_meta(rows=True), "INVALID_REQUEST", "t.rows"),
    (with_meta(rows=validation.MAX_TABLE_ROWS + 1), "LIMIT_EXCEEDED", "t.rows"),
    (with_meta(columns=[]), "INVALID_REQUEST", "t.columns"),
    (with_meta(columns={"name": "depth", "unit": ""}), "INVALID_REQUEST", "t.columns"),
    (with_meta(columns=[{"name": "depth"}, {"name": "Ca", "unit": ""}]), "INVALID_REQUEST", "t.columns"),
    (with_meta(columns=[{"name": "depth", "unit": "cm", "scale": 1}, {"name": "Ca", "unit": ""}]), "INVALID_REQUEST", "t.columns"),
    (with_meta(columns=[{"name": "", "unit": "cm"}, {"name": "Ca", "unit": ""}]), "INVALID_REQUEST", "t.columns.name"),
    (with_meta(columns=[{"name": 5, "unit": "cm"}, {"name": "Ca", "unit": ""}]), "INVALID_REQUEST", "t.columns.name"),
    (with_meta(columns=[{"name": "\ud800", "unit": "cm"}, {"name": "Ca", "unit": ""}]), "INVALID_REQUEST", "t.columns.name"),
    (with_meta(columns=[{"name": "depth", "unit": "cm"}, {"name": "depth", "unit": ""}]), "INVALID_REQUEST", "t.columns.name"),
    (with_meta(columns=[{"name": "é" * 129, "unit": "cm"}, {"name": "Ca", "unit": ""}]), "LIMIT_EXCEEDED", "t.columns.name"),
    (with_meta(columns=[{"name": "depth", "unit": None}, {"name": "Ca", "unit": ""}]), "INVALID_REQUEST", "t.columns.unit"),
    (with_meta(columns=[{"name": "depth", "unit": "u" * 65}, {"name": "Ca", "unit": ""}]), "LIMIT_EXCEEDED", "t.columns.unit"),
    ({**small(), "t_values": None}, "INVALID_BUFFER", "t_values"),
    ({**small(), "t_values": small()["t_values"].astype("<f4")}, "INVALID_BUFFER", "t_values"),
    ({**small(), "t_values": small()["t_values"].reshape(-1)}, "INVALID_BUFFER", "t_values"),
    ({**small(), "t_values": small()["t_values"].T.copy()}, "INVALID_BUFFER", "t_values"),
    ({**small(), "t_values": small()["t_values"][:, :2].copy()}, "INVALID_BUFFER", "t_values"),
    ({**small(), "t_valid": small()["t_valid"].astype("<i4")}, "INVALID_BUFFER", "t_valid"),
    ({**small(), "t_valid": small()["t_valid"][:1].copy()}, "INVALID_BUFFER", "t_valid"),
])
def test_a_malformed_table_is_refused_naming_the_field(inputs, code, field):
    refused(inputs, code, field)


def test_a_validity_byte_other_than_0_or_1_is_refused():
    for byte in (2, 255):
        inputs = small()
        inputs["t_valid"] = inputs["t_valid"].copy()
        inputs["t_valid"][1, 1] = byte
        refused(inputs, "INVALID_BUFFER", "t_valid")


@pytest.mark.parametrize("bad", [np.nan, np.inf, -np.inf])
def test_a_present_value_that_is_not_finite_is_refused(bad):
    inputs = small()
    inputs["t_values"] = inputs["t_values"].copy()
    inputs["t_values"][0, 2] = bad
    refused(inputs, "INVALID_BUFFER", "t_values")


@pytest.mark.parametrize("bad", [1.0, np.nan, 5e-324])
def test_a_missing_slot_must_hold_zero(bad):
    inputs = small()
    inputs["t_values"] = inputs["t_values"].copy()
    inputs["t_values"][1, 1] = bad                    # (1, 1) is missing
    refused(inputs, "INVALID_BUFFER", "t_values")


def test_a_column_the_method_does_not_accept_or_a_missing_required_one_is_refused():
    refused(small(), "INVALID_REQUEST", "t.columns.name", columns=("depth",))
    refused(small(), "INVALID_REQUEST", "t.columns", required=("age",))
    assert list(validation.table(small(), "t", None, required=("Ca",))) == ["depth", "Ca"]


def test_the_limits_on_columns_and_cells_are_enforced():
    many = [{"name": f"c{i}", "unit": ""} for i in range(validation.MAX_TABLE_COLUMNS + 1)]
    refused(with_meta(columns=many), "LIMIT_EXCEEDED", "t.columns")
    rows = validation.MAX_TABLE_DATA_BYTES // 9 // 2 + 1             # two columns of this length exceed the data bytes
    refused(with_meta(rows=rows), "LIMIT_EXCEEDED", "t.rows")
    # At the limit itself the size check passes and the buffers are checked next.
    refused(with_meta(rows=validation.MAX_TABLE_DATA_BYTES // 9 // 2), "INVALID_BUFFER", "t_values")


# ---- the probe: column sums in the real method worker ------------------------------------------------------------------------

PROBE_WORKER = '''
import sys, types
sys.path.insert(0, {engine!r})
import method_worker
modules = method_worker.load_modules()
np, registry, Cancelled, MethodError = modules
from sedcoretool.methods import validation

probe = types.ModuleType("probe")
probe.NAME = {name!r}
probe.INPUT_NAMES = ("record", "record_values", "record_valid")

class Result:
    def __init__(self, dimensions, columns):
        self.dimensions, self.columns = dimensions, columns

def parse(inputs, *, hashes=None, memo=None, derived=None):
    return validation.table(inputs, "record")

def run(table, *, cancelled, memo=None):
    sums = [np.add.accumulate(c.values[c.valid])[-1] if c.valid.any() else 0.0 for c in table.values()]
    return Result({{"bins": 1, "classes": 1, "schemes": 1}},
                  {{"sum": np.array(sums, dtype=np.float64), "count": np.array([int(c.valid.sum()) for c in table.values()], dtype=np.uint64)}})

probe.parse, probe.run = parse, run
registry.METHODS[probe.NAME] = probe
method_worker.serve(modules)
'''


def run_probe(coordinator, tmp_path, runner, handles):
    """Run the probe on committed buffers the way the coordinator starts a job; returns the result (columns or the error)."""
    store = coordinator.store
    directory = tmp_path / f"job-{uuid4()}"
    (directory / "out").mkdir(parents=True)
    inputs = {name: {"path": str(store.buffers[h].path), "dtype": store.buffers[h].dtype, "shape": list(store.buffers[h].shape),
                     "sha256": store.buffers[h].expected_hash} for name, h in handles.items()}
    job_file = directory / "job.json"
    job_file.write_text(json.dumps({"method": PROBE, "cancel_path": str(directory / "cancel"), "output_dir": str(directory / "out"), "inputs": inputs}), encoding="utf-8")
    job = MethodJob(runner, job_file, directory / "cancel")
    deadline = time.monotonic() + 60
    while not job.finished() and time.monotonic() < deadline:
        time.sleep(0.01)
    assert job.result is not None
    if not job.result.get("ok"):
        return job.result
    data = (directory / "out" / "result.bin").read_bytes()
    assert hashlib.sha256(data).hexdigest() == job.result["packed"]["sha256"]
    return {name: np.frombuffer(data, dtype=np.dtype(specs.NUMPY_DTYPES[part["dtype"]]), count=int(np.prod(part["shape"])), offset=part["offset"])
            for name, part in job.result["packed"]["layout"].items()}


def send_bytes(coordinator, session, data, dtype, shape):
    if dtype == "utf8json":
        return send(coordinator, session, np.frombuffer(data, dtype="u1"), "utf8json")
    return send(coordinator, session, np.frombuffer(data, dtype=specs.NUMPY_DTYPES[dtype]).reshape(shape), dtype)


def test_the_probe_in_the_real_worker_returns_the_interfaces_column_sums(tmp_path, javascript_tables):
    script = tmp_path / "probe_worker.py"
    script.write_text(PROBE_WORKER.format(engine=str(ENGINE), name=PROBE), encoding="utf-8")
    coordinator = Coordinator(io.BytesIO(), version="test", runtime_id="0" * 64)
    session = str(uuid4())
    coordinator.receive(request(session, "hello", {"protocol": 1}))
    runner = MethodRunner(script)
    try:
        # Sums that overflow to an infinity are not results (the coordinator refuses non-finite float64 results): JSON writes them as null.
        finite = [entry for entry in javascript_tables if None not in entry["sums"]]
        largest = max(finite, key=lambda e: len(e["columns"]) * e["rows"])
        assert len(finite) >= 20 and len(largest["columns"]) * largest["rows"] > 20_000
        for entry in [*finite[:10], largest]:
            data = raw(entry)
            handles = {f"record{suffix}": send_bytes(coordinator, session, data[key], entry["buffers"][key]["dtype"], entry["buffers"][key]["shape"])
                       for key, suffix in (("meta", ""), ("values", "_values"), ("valid", "_valid"))}
            result = run_probe(coordinator, tmp_path, runner, handles)
            assert result["sum"].tobytes() == np.array(entry["sums"], dtype="<f8").tobytes(), "bit-identical sums"
            assert result["count"].tolist() == entry["counts"]
            for handle in handles.values():
                coordinator.store.release(handle)
        # A hostile table reaches the worker as committed buffers (the transport cannot know the table rules): the method refuses it.
        meta = json.dumps({"version": 1, "rows": 2, "columns": [{"name": "a", "unit": ""}]}).encode()
        hostile = {"record": send_bytes(coordinator, session, meta, "utf8json", [len(meta)]),
                   "record_values": send_bytes(coordinator, session, np.array([[1.0, 2.0]]).tobytes(), "f64le", [1, 2]),
                   "record_valid": send_bytes(coordinator, session, bytes([1, 2]), "u8", [1, 2])}
        assert run_probe(coordinator, tmp_path, runner, hostile) == {"error": {"code": "INVALID_BUFFER", "field": "record_valid"}}
    finally:
        runner.close()
        coordinator.close()
