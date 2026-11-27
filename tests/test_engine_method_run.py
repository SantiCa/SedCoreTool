"""Card M8.5.2: `method.run` in the engine (contract §9).

Three probe methods exist only in these tests: their worker script registers them in the real method worker and the coordinator is
given their method-table entries (`extra_methods`), so the production engine advertises none of them. One probe per scope:
`probe.section/1` sums a mask, `probe.core/1` returns a table's column sums as a table output, `probe.project/1` sums every table of a
family of up to 128 tables. Every value they handle is an integer below 2**53, so float64 sums are exact in any order and every
comparison is exact (no tolerance). Settings options make a probe slow (polling cancellation), give it an oversized summary or make it
return a malformed table output, for the queue, superseding and adoption tests.
"""

import hashlib
import io
import json
from pathlib import Path
from uuid import uuid4

import numpy as np
import pytest

import section_fixtures as fixtures
from sedcoretool.engine import specs
from sedcoretool.engine.buffers import MAX_HANDLES
from sedcoretool.engine.protocol import JSON_FRAME, read_frame, strict_json
from sedcoretool.engine.server import MAX_WAITING_JOBS, inputs_key
from sedcoretool.methods import registry, section_intervals, validation
from test_engine_methods import ENGINE, frames, new_coordinator, put, request, run_until_idle
from test_section_intervals import inputs_of

SETTINGS = ("settings", "utf8json", 1, True)
PROBES = {
    "probe.section/1": specs.MethodSpec("probe.section/1", "section", {"mask": ("u8", 2, True), "settings": ("utf8json", 1, True)},
                                        priorities=("interactive", "batch"), dimensions=("rows", "cols")),
    "probe.core/1": specs.MethodSpec("probe.core/1", "core", {"record": ("utf8json", 1, True), "record_values": ("f64le", 2, True),
                                                              "record_valid": ("u8", 2, True), "settings": ("utf8json", 1, True)},
                                     dimensions=("columns",), tables=("sums",)),
    "probe.project/1": specs.MethodSpec("probe.project/1", "project", {"settings": ("utf8json", 1, True)},
                                        families=(specs.Family("core", "table", 128),), priorities=("interactive", "batch"),
                                        dimensions=("tables",), tables=("totals",)),
}

PROBE_WORKER = r'''
import re, sys, time, types
sys.path.insert(0, ENGINE)
import method_worker
modules = method_worker.load_modules()
np, registry, Cancelled, MethodError = modules
from sedcoretool.methods import validation


class Result:
    def __init__(self, dimensions, columns, tables=None, summary=None):
        self.dimensions, self.columns, self.tables, self.summary = dimensions, columns, tables or {}, summary or {}


def options(inputs):
    settings = inputs["settings"]
    if not isinstance(settings, dict) or settings.get("version") != 1:
        raise MethodError("UNSUPPORTED_INPUT", "settings")
    return settings


def wait(settings, cancelled):
    end = time.monotonic() + settings.get("delay", 0)
    while time.monotonic() < end:
        if cancelled():
            raise Cancelled()
        time.sleep(0.005)


def module(name, input_names, parse, run):
    probe = types.ModuleType(name)
    probe.NAME, probe.INPUT_NAMES, probe.parse, probe.run = name, input_names, parse, run
    registry.METHODS[name] = probe


def section_run(inputs, *, cancelled, memo=None):
    settings, mask = options(inputs), np.asarray(inputs["mask"])
    wait(settings, cancelled)
    summary = {"padding": "x" * settings["summary_bytes"]} if "summary_bytes" in settings else {"nonzero": int(np.count_nonzero(mask))}
    return Result({"rows": int(mask.shape[0]), "cols": int(mask.shape[1])}, {"total": np.array([mask.sum(dtype=np.uint64)], dtype=np.uint64)},
                  summary=summary)


def core_run(inputs, *, cancelled, memo=None):
    settings, table = options(inputs), validation.table(inputs, "record")
    wait(settings, cancelled)
    values = np.array([[column.values[column.valid].sum()] for column in table.values()], dtype=np.float64)
    valid = np.array([[1 if column.valid.any() else 0] for column in table.values()], dtype=np.uint8)
    description = {"version": 1, "rows": 1, "columns": [{"name": name, "unit": column.unit} for name, column in table.items()]}
    tables = {"sums": description}
    fault = settings.get("fault")
    if fault == "rows":
        description["rows"] = 2
    elif fault == "valid":
        valid[0, 0] = 2
    elif fault == "missing":
        valid[0, 0], values[0, 0] = 0, 5.0
    elif fault == "extra_table":
        tables["other"] = description
    return Result({"columns": len(table)}, {"sums_values": values, "sums_valid": valid}, tables=tables,
                  summary={"rows": int(inputs["record"]["rows"])})


def project_run(inputs, *, cancelled, memo=None):
    settings = options(inputs)
    wait(settings, cancelled)
    count = sum(1 for name in inputs if re.fullmatch(r"core[0-9]+", name))
    totals = np.zeros((2, count), dtype=np.float64)
    for k in range(count):
        table = validation.table(inputs, f"core{k}")
        totals[0, k] = sum(column.values[column.valid].sum() for column in table.values())
        totals[1, k] = sum(int(column.valid.sum()) for column in table.values())
    description = {"version": 1, "rows": count, "columns": [{"name": "sum", "unit": ""}, {"name": "cells", "unit": ""}]}
    return Result({"tables": count}, {"totals_values": totals, "totals_valid": np.ones((2, count), dtype=np.uint8)},
                  tables={"totals": description}, summary={"tables": count})


module("probe.section/1", ("mask", "settings"), lambda inputs, **_: inputs, section_run)
module("probe.core/1", ("record", "record_values", "record_valid", "settings"), lambda inputs, **_: inputs, core_run)
module("probe.project/1", ("settings",), lambda inputs, **_: inputs, project_run)
method_worker.serve(modules)
'''


@pytest.fixture
def probes(tmp_path):
    """A coordinator whose method worker knows the probes, and its session."""
    script = tmp_path / "probe_worker.py"
    script.write_text(PROBE_WORKER.replace("ENGINE", repr(str(ENGINE)), 1), encoding="utf-8")
    coordinator, session = new_coordinator(method_script=script, extra_methods=PROBES)
    try:
        yield coordinator, session
    finally:
        coordinator.close()


def put_json(coordinator, value):
    data = json.dumps(value, separators=(",", ":")).encode()
    return put(coordinator, data, "utf8json", [len(data)])


def put_table(coordinator, name, columns):
    """The three buffers of a table (contract §4 "Tables"); `columns` maps a column name to its values, None for a missing one."""
    rows = len(next(iter(columns.values())))
    values = np.array([[0.0 if v is None else v for v in column] for column in columns.values()], dtype="<f8")
    valid = np.array([[0 if v is None else 1 for v in column] for column in columns.values()], dtype="u1")
    meta = {"version": 1, "rows": rows, "columns": [{"name": column, "unit": "cm" if i == 0 else ""} for i, column in enumerate(columns)]}
    return {name: put_json(coordinator, meta), f"{name}_values": put(coordinator, values.tobytes(), "f64le", list(values.shape)),
            f"{name}_valid": put(coordinator, valid.tobytes(), "u8", list(valid.shape))}


def settings(coordinator, **options):
    handle = put_json(coordinator, {"version": 1, **options})
    return handle, coordinator.store.buffers[handle].expected_hash


def run(session, method, scope, inputs, settings_hash, *, target=None, revision=1, priority="interactive"):
    return request(session, "method.run", {"method": method, "scope": scope, "target": target or str(uuid4()), "revision": revision,
                                           "priority": priority, "settings_hash": settings_hash, "inputs": inputs})


def section_job(coordinator, session, mask=None, *, target=None, priority="interactive", **options):
    mask = np.ones((2, 3), dtype="u1") if mask is None else mask
    handle, digest = settings(coordinator, **options)
    inputs = {"mask": put(coordinator, mask.tobytes(), "u8", list(mask.shape)), "settings": handle}
    return run(session, "probe.section/1", "section", inputs, digest, target=target, priority=priority)


def answered(coordinator):
    """Terminal responses in the order they were written: (request id, status)."""
    stream, out = io.BytesIO(coordinator.output.getvalue()), []
    while frame := read_frame(stream):
        if frame[0] == JSON_FRAME:
            value = strict_json(frame[1])
            if value.get("kind") == "response" and value["op"] == "method.run":
                out.append((value["id"], value["status"]))
    return out


def download(coordinator, session, result):
    """The result's columns, read with `buffer.read` and cut up by the layout; {} for an empty result."""
    if not result["outputs"]:
        return {}
    item = result["outputs"]["result"]
    asked = request(session, "buffer.read", {"handle": item["handle"], "offset": 0, "byte_length": item["byte_length"]})
    coordinator.receive(asked)
    data = frames(coordinator)[1][asked["id"]]
    assert hashlib.sha256(data).hexdigest() == item["sha256"]
    return {name: np.frombuffer(data, dtype=fixtures.DTYPES[part["dtype"]], count=int(np.prod(part["shape"])), offset=part["offset"]).reshape(part["shape"])
            for name, part in result["layout"].items()}


def unpinned(coordinator):
    return all(value.pins == 0 for value in coordinator.store.buffers.values())


# ---- the method table ---------------------------------------------------------------------------------------------------------

def test_each_method_module_agrees_with_its_method_table_entry():
    assert set(specs.METHOD_SPECS) == set(registry.METHODS) == {specs.SECTION_INTERVALS, specs.CORE_AGES, specs.CORE_DEPTHS}
    for name, spec in specs.METHOD_SPECS.items():
        method = registry.METHODS[name]
        assert spec.name == name == method.NAME
        assert set(spec.inputs) == set(method.INPUT_NAMES)
        assert spec.inputs[specs.SETTINGS_INPUT] == ("utf8json", 1, True), "every method has a settings input (§9.2)"
        assert spec.scope in specs.SCOPES and spec.priorities and set(spec.priorities) <= set(specs.PRIORITIES)
        assert all(kind in specs.FAMILY_KINDS and 1 <= maximum <= specs.MAX_FAMILY_MEMBERS for _, kind, maximum in spec.families)
        assert 0 < spec.deadline <= specs.INTERACTIVE_DEADLINE
    entry = specs.METHOD_SPECS[specs.SECTION_INTERVALS]
    assert entry.inputs is specs.METHOD_INPUTS[specs.SECTION_INTERVALS], "the mirror in desktop/engine-ipc.js compares with METHOD_INPUTS"
    assert (entry.scope, entry.priorities, entry.families, entry.tables, entry.same_shape) == ("section", ("interactive",), (), (), (("labels", "exclude"),))
    result = section_intervals.run(section_intervals.parse(inputs_of(fixtures.load("basic-four-intervals"))))
    assert tuple(result.dimensions) == entry.dimensions and not getattr(result, "tables", None) and not getattr(result, "summary", None)
    ages = specs.METHOD_SPECS[specs.CORE_AGES]
    assert ages.inputs is specs.METHOD_INPUTS[specs.CORE_AGES] and (ages.scope, ages.priorities, ages.families, ages.same_shape) == ("core", ("interactive",), (), ())
    assert (ages.dimensions, ages.tables) == (("rows",), ("ages",)) and not ages.deadline > specs.INTERACTIVE_DEADLINE
    # Output tables have the limits of input tables (§4 "Tables"); specs.py restates them without NumPy.
    for limit in ("MAX_TABLE_COLUMNS", "MAX_TABLE_ROWS", "MAX_TABLE_DATA_BYTES", "MAX_TABLE_NAME_BYTES", "MAX_TABLE_UNIT_BYTES"):
        assert getattr(specs, limit) == getattr(validation, limit), limit
    assert specs.MAX_REQUEST_INPUTS == 3 * 128 + 32 and MAX_HANDLES == 1024


def test_hello_advertises_the_methods_of_the_method_table_only(probes):
    coordinator, session = probes
    production, other = new_coordinator()
    try:
        hello = [value for value in frames(production)[0].values() if value["op"] == "hello"][0]
        assert hello["result"]["methods"] == ["buffer.digest/1", "section.intervals/1", "core.ages/1", "core.depths/1"]
    finally:
        production.close()
    hello = [value for value in frames(coordinator)[0].values() if value["op"] == "hello"][0]
    assert hello["result"]["methods"] == ["buffer.digest/1", "section.intervals/1", "core.ages/1", "core.depths/1", *PROBES]


# ---- one probe per scope, through the real coordinator and worker --------------------------------------------------------------

def test_probe_section_sums_a_mask(probes):
    coordinator, session = probes
    mask = np.random.default_rng(7).integers(0, 256, size=(37, 53), dtype=np.uint8)
    job = section_job(coordinator, session, mask)
    coordinator.receive(job)
    run_until_idle(coordinator)
    response = frames(coordinator)[0][job["id"]]
    assert response["status"] == "ok", response
    result, payload = response["result"], job["payload"]
    assert set(result) == {"method", "scope", "target", "revision", "settings_hash", "inputs_key", "dimensions", "outputs", "layout", "tables",
                           "summary", "provenance"}
    assert [result[key] for key in ("method", "scope", "target", "revision", "settings_hash")] == [
        payload[key] for key in ("method", "scope", "target", "revision", "settings_hash")]
    assert result["dimensions"] == {"rows": 37, "cols": 53} and result["tables"] == {}
    assert result["summary"] == {"nonzero": int(np.count_nonzero(mask))}
    assert download(coordinator, session, result)["total"].tolist() == [int(mask.sum(dtype=np.uint64))]
    hashes = {name: coordinator.store.buffers[handle].expected_hash for name, handle in payload["inputs"].items()}
    provenance = result["provenance"]
    assert set(provenance) == {"engine_version", "runtime_id", "method", "scope", "revision", "inputs_key", "input_sha256", "deterministic",
                               "queued_ms", "elapsed_ms"}
    assert provenance["input_sha256"] == hashes and provenance["inputs_key"] == result["inputs_key"] == inputs_key("probe.section/1", "section", hashes)
    assert (provenance["method"], provenance["scope"], provenance["revision"], provenance["deterministic"]) == ("probe.section/1", "section", 1, True)
    assert unpinned(coordinator)


def test_probe_core_returns_a_tables_column_sums_as_a_table_output(probes):
    coordinator, session = probes
    columns = {"depth": [0.0, 1.0, 2.0, 3.0, 4.0], "Ca": [7.0, None, -9.0, 2.0**52, None], "empty": [None] * 5}
    handle, digest = settings(coordinator)
    job = run(session, "probe.core/1", "core", {**put_table(coordinator, "record", columns), "settings": handle}, digest, revision=12)
    coordinator.receive(job)
    run_until_idle(coordinator)
    result = frames(coordinator)[0][job["id"]]["result"]
    assert result["dimensions"] == {"columns": 3} and result["summary"] == {"rows": 5} and result["revision"] == 12
    assert result["tables"] == {"sums": {"version": 1, "rows": 1, "columns": [{"name": "depth", "unit": "cm"}, {"name": "Ca", "unit": ""},
                                                                             {"name": "empty", "unit": ""}]}}
    cells = download(coordinator, session, result)
    assert set(cells) == {"sums_values", "sums_valid"}
    assert cells["sums_values"].tolist() == [[10.0], [7.0 - 9.0 + 2.0**52], [0.0]] and cells["sums_valid"].tolist() == [[1], [1], [0]]
    assert result["layout"]["sums_values"]["shape"] == [3, 1] and result["layout"]["sums_valid"]["dtype"] == "u8"


def test_probe_project_sums_a_family_of_128_tables_beyond_the_former_256_handles(probes):
    coordinator, session = probes
    inputs, expected = {}, []
    for k in range(128):
        columns = {"depth": [float(k), float(k + 1), None], "Fe": [float(3 * k), None, 1.0]}
        inputs.update(put_table(coordinator, f"core{k}", columns))
        expected.append((k + k + 1 + 3 * k + 1.0, 4.0))
    handle, digest = settings(coordinator)
    inputs["settings"] = handle
    assert len(inputs) == 385 and len(coordinator.store.buffers) > 256
    job = run(session, "probe.project/1", "project", inputs, digest, priority="batch")
    coordinator.receive(job)
    run_until_idle(coordinator)
    response = frames(coordinator)[0][job["id"]]
    assert response["status"] == "ok", response
    result = response["result"]
    assert result["dimensions"] == {"tables": 128} and result["summary"] == {"tables": 128}
    assert result["tables"]["totals"]["rows"] == 128
    cells = download(coordinator, session, result)
    assert cells["totals_values"].T.tolist() == [list(pair) for pair in expected] and cells["totals_valid"].all()
    assert len(result["provenance"]["input_sha256"]) == 385 and unpinned(coordinator)


def test_an_empty_result_has_no_buffer_and_zero_length_columns(probes):
    coordinator, session = probes
    handle, digest = settings(coordinator)
    count = len(coordinator.store.buffers)
    job = run(session, "probe.project/1", "project", {"settings": handle}, digest)
    coordinator.receive(job)
    run_until_idle(coordinator)
    result = frames(coordinator)[0][job["id"]]["result"]
    assert result["dimensions"] == {"tables": 0} and result["outputs"] == {}
    assert result["layout"] == {"totals_values": {"dtype": "f64le", "shape": [2, 0], "offset": 0, "byte_length": 0},
                                "totals_valid": {"dtype": "u8", "shape": [2, 0], "offset": 0, "byte_length": 0}}
    assert result["tables"]["totals"]["rows"] == 0 and len(coordinator.store.buffers) == count


def test_equal_bytes_give_an_equal_inputs_key_under_different_revisions(probes):
    coordinator, session = probes
    columns = {"depth": [1.0, 2.0], "Ca": [None, 4.0]}
    handle, digest = settings(coordinator)
    first = run(session, "probe.core/1", "core", {**put_table(coordinator, "record", columns), "settings": handle}, digest, revision=1)
    second_inputs = {**put_table(coordinator, "record", columns), "settings": put_json(coordinator, {"version": 1})}
    assert set(second_inputs.values()).isdisjoint(first["payload"]["inputs"].values()), "the same bytes under other handles"
    second = run(session, "probe.core/1", "core", second_inputs, digest, target=first["payload"]["target"], revision=2)
    third = run(session, "probe.core/1", "core", {**put_table(coordinator, "record", {**columns, "Ca": [None, 5.0]}), "settings": handle}, digest)
    for job in (first, second, third):
        coordinator.receive(job)
        run_until_idle(coordinator)
    responses = frames(coordinator)[0]
    keys = [responses[job["id"]]["result"]["inputs_key"] for job in (first, second, third)]
    assert keys[0] == keys[1] != keys[2]
    hashes = responses[first["id"]]["result"]["provenance"]["input_sha256"]
    text = "method.run/1|probe.core/1|core|" + "".join(f"{name}={hashes[name]};" for name in ("record", "record_valid", "record_values", "settings"))
    assert keys[0] == hashlib.sha256(text.encode()).hexdigest()


# ---- refusals (contract §9.2) -----------------------------------------------------------------------------------------------

def test_every_field_is_refused_in_the_order_of_the_contract(probes):
    coordinator, session = probes
    handle, digest = settings(coordinator)
    mask = put(coordinator, bytes(6), "u8", [2, 3])
    good = {"method": "probe.section/1", "scope": "section", "target": str(uuid4()), "revision": 0, "priority": "batch", "settings_hash": digest,
            "inputs": {"mask": mask, "settings": handle}}
    bad = {"method": "probe.none/1", "scope": "core", "target": "T", "revision": -1, "priority": "urgent", "settings_hash": "A" * 64,
           "inputs": {"mask": mask}}
    payload = dict(bad)
    for field in ("method", "scope", "target", "revision", "priority", "settings_hash", "inputs"):
        sent = request(session, "method.run", payload)
        coordinator.receive(sent)
        error = frames(coordinator)[0][sent["id"]]["error"]
        assert error["details"] == {"field": field}, (field, error)
        payload[field] = good[field]
    assert not coordinator.active and not coordinator.jobs and unpinned(coordinator)


def test_each_row_of_the_request_table_is_refused_naming_its_field(probes):
    coordinator, session = probes
    handle, digest = settings(coordinator)
    other_settings, _ = settings(coordinator, other=True)
    mask = put(coordinator, bytes(6), "u8", [2, 3])
    wide = put(coordinator, bytes(48), "f64le", [2, 3])
    flat = put(coordinator, bytes(6), "u8", [6])
    table = put_table(coordinator, "core0", {"depth": [1.0]})
    member = {f"core{{}}{suffix}": table[f"core0{suffix}"] for suffix in ("", "_values", "_valid")}

    def family(*indices, drop=None):
        names = {name.format(k): value for k in indices for name, value in member.items()}
        names.pop(drop, None)
        return {**names, "settings": handle}

    section = {"mask": mask, "settings": handle}
    cases = [
        ("probe.section/1", "section", {"method": "probe.none/1"}, "UNSUPPORTED_METHOD", "method"),
        ("probe.section/1", "section", {"method": 5}, "UNSUPPORTED_METHOD", "method"),
        ("probe.section/1", "section", {"method": "buffer.digest/1"}, "UNSUPPORTED_METHOD", "method"),
        ("probe.section/1", "section", {"scope": "core"}, "INVALID_REQUEST", "scope"),
        ("probe.project/1", "project", {"scope": "section"}, "INVALID_REQUEST", "scope"),
        ("probe.section/1", "section", {"scope": None}, "INVALID_REQUEST", "scope"),
        ("probe.section/1", "section", {"target": "not-a-uuid"}, "INVALID_REQUEST", "target"),
        ("probe.section/1", "section", {"target": str(uuid4()).upper()}, "INVALID_REQUEST", "target"),
        ("probe.section/1", "section", {"revision": -1}, "INVALID_REQUEST", "revision"),
        ("probe.section/1", "section", {"revision": "7"}, "INVALID_REQUEST", "revision"),
        ("probe.section/1", "section", {"revision": 1.5}, "INVALID_REQUEST", "revision"),
        ("probe.section/1", "section", {"revision": True}, "INVALID_REQUEST", "revision"),
        ("probe.section/1", "section", {"revision": 2**53}, "INVALID_REQUEST", "revision"),
        ("probe.section/1", "section", {"priority": "urgent"}, "INVALID_REQUEST", "priority"),
        ("probe.section/1", "section", {"priority": None}, "INVALID_REQUEST", "priority"),
        ("probe.core/1", "core", {"priority": "batch"}, "INVALID_REQUEST", "priority"),
        ("probe.section/1", "section", {"settings_hash": "A" * 64}, "INVALID_REQUEST", "settings_hash"),
        ("probe.section/1", "section", {"settings_hash": "0" * 64}, "INVALID_REQUEST", "settings_hash"),
        ("probe.section/1", "section", {"inputs": {**section, "settings": other_settings}}, "INVALID_REQUEST", "settings_hash"),
        ("probe.section/1", "section", {"inputs": "mask"}, "INVALID_REQUEST", "inputs"),
        ("probe.section/1", "section", {"inputs": {"mask": mask}}, "INVALID_REQUEST", "inputs"),
        ("probe.section/1", "section", {"inputs": {**section, "extra": mask}}, "INVALID_REQUEST", "inputs"),
        ("probe.section/1", "section", {"inputs": {**section, "core0": table["core0"]}}, "INVALID_REQUEST", "inputs"),
        ("probe.section/1", "section", {"inputs": {**section, "mask": wide}}, "INVALID_BUFFER", "mask"),
        ("probe.section/1", "section", {"inputs": {**section, "mask": flat}}, "INVALID_BUFFER", "mask"),
        ("probe.section/1", "section", {"inputs": {**section, "mask": str(uuid4())}}, "INVALID_BUFFER", "mask"),
        ("probe.project/1", "project", {"inputs": family(0, 2)}, "INVALID_REQUEST", "inputs"),                    # a gap
        ("probe.project/1", "project", {"inputs": family(1)}, "INVALID_REQUEST", "inputs"),                       # not from 0
        ("probe.project/1", "project", {"inputs": family(*range(129))}, "INVALID_REQUEST", "inputs"),              # 129 members
        ("probe.project/1", "project", {"inputs": family(0, drop="core0_valid")}, "INVALID_REQUEST", "inputs"),   # incomplete member
        ("probe.project/1", "project", {"inputs": {**family(0), "core00": table["core0"]}}, "INVALID_REQUEST", "inputs"),
        ("probe.project/1", "project", {"inputs": {**family(0), "core1000": table["core0"]}}, "INVALID_REQUEST", "inputs"),
        ("probe.project/1", "project", {"inputs": {**family(0), "core0_values": flat}}, "INVALID_BUFFER", "core0_values"),
        ("probe.project/1", "project", {"inputs": {**family(0), "core0": mask}}, "INVALID_BUFFER", "core0"),
        ("probe.project/1", "project", {"inputs": {**family(0), "settings": mask}}, "INVALID_BUFFER", "settings"),
    ]
    sent = []
    for method, scope, override, _, _ in cases:
        inputs = section if method == "probe.section/1" else {**put_table(coordinator, "record", {"a": [1.0]}), "settings": handle} if method == "probe.core/1" else family(0)
        sent.append(request(session, "method.run", {**run(session, method, scope, inputs, digest)["payload"], **override}))
    sent.append(request(session, "method.run", {**sent[0]["payload"], "method": "probe.section/1", "extra": 1}))
    missing = dict(sent[0]["payload"], method="probe.section/1")
    del missing["priority"]
    sent.append(request(session, "method.run", missing))
    for item in sent:
        coordinator.receive(item)
    responses = frames(coordinator)[0]
    for item, (_, _, override, code, field) in zip(sent, cases):
        error = responses[item["id"]]["error"]
        assert (error["code"], error["details"].get("field")) == (code, field), override
    for item in sent[len(cases):]:                           # closed fields: unknown or missing
        assert responses[item["id"]]["error"]["code"] == "INVALID_REQUEST"
    assert not coordinator.active and not coordinator.jobs and unpinned(coordinator)
    assert coordinator.runner is None, "nothing reached a worker"


# ---- queues, priorities and superseding (contract §9.4) ------------------------------------------------------------------------

def test_a_waiting_interactive_job_starts_before_an_earlier_waiting_batch_job(probes):
    coordinator, session = probes
    blocker = section_job(coordinator, session, delay=60)
    batch = section_job(coordinator, session, priority="batch")
    handle, digest = settings(coordinator)
    interactive = run(session, "probe.core/1", "core", {**put_table(coordinator, "record", {"a": [1.0]}), "settings": handle}, digest)
    for job in (blocker, batch, interactive):
        coordinator.receive(job)
    assert coordinator.active["request"] is blocker and len(coordinator.jobs) == 2
    coordinator.receive(request(session, "job.cancel", {"request_id": blocker["id"]}))
    run_until_idle(coordinator)
    assert answered(coordinator) == [(blocker["id"], "cancelled"), (interactive["id"], "ok"), (batch["id"], "ok")]
    responses = frames(coordinator)[0]
    assert responses[batch["id"]]["result"]["provenance"]["queued_ms"] >= responses[interactive["id"]]["result"]["provenance"]["queued_ms"]
    assert unpinned(coordinator)


def test_busy_at_the_fifth_waiting_job_of_one_priority(probes):
    coordinator, session = probes
    blocker = section_job(coordinator, session, delay=60)
    coordinator.receive(blocker)
    admitted = {}
    for priority in ("batch", "interactive"):
        jobs = [section_job(coordinator, session, priority=priority) for _ in range(MAX_WAITING_JOBS + 1)]
        for job in jobs:
            coordinator.receive(job)
        responses = frames(coordinator)[0]
        assert [job["id"] in responses for job in jobs] == [False] * MAX_WAITING_JOBS + [True], priority
        assert responses[jobs[-1]["id"]]["error"]["code"] == "BUSY"
        assert coordinator.jobs.count(priority) == MAX_WAITING_JOBS
        admitted[priority] = jobs[:-1]
        refused = jobs[-1]["payload"]["inputs"]["mask"]
        assert coordinator.store.buffers[refused].pins == 0, "a refused request pins nothing"
    coordinator.receive(request(session, "job.cancel", {"request_id": blocker["id"]}))
    run_until_idle(coordinator)
    order = [identifier for identifier, _ in answered(coordinator) if identifier != blocker["id"]]
    expected = [job["id"] for job in admitted["interactive"] + admitted["batch"]]
    assert [identifier for identifier in order if identifier in expected] == expected
    responses = frames(coordinator)[0]
    assert all(responses[identifier]["status"] == "ok" for identifier in expected) and unpinned(coordinator)


def test_a_newer_request_supersedes_the_older_ones_of_its_method_and_target_only(probes):
    coordinator, session = probes
    target, other = str(uuid4()), str(uuid4())
    running = section_job(coordinator, session, target=target, delay=60)
    elsewhere = section_job(coordinator, session, target=other)
    handle, digest = settings(coordinator)
    other_method = run(session, "probe.core/1", "core", {**put_table(coordinator, "record", {"a": [1.0]}), "settings": handle}, digest, target=target)
    waiting = section_job(coordinator, session, target=target, delay=60)
    newest = section_job(coordinator, session, target=target)
    for job in (running, elsewhere, other_method):
        coordinator.receive(job)
    coordinator.receive(waiting)                              # supersedes the running job: asked to cancel, answered when it ends
    assert coordinator.active["request"] is running and coordinator.active["cancel_at"] is not None
    assert running["id"] not in frames(coordinator)[0]
    coordinator.receive(newest)                               # supersedes the waiting job: answered `cancelled` at once
    assert frames(coordinator)[0][waiting["id"]]["status"] == "cancelled"
    assert coordinator.store.buffers[waiting["payload"]["inputs"]["mask"]].pins == 0
    run_until_idle(coordinator)
    responses = frames(coordinator)[0]
    assert responses[running["id"]]["status"] == "cancelled"
    assert [responses[job["id"]]["status"] for job in (elsewhere, other_method, newest)] == ["ok", "ok", "ok"]
    assert unpinned(coordinator)


def test_job_cancel_ends_a_waiting_batch_job(probes):
    coordinator, session = probes
    blocker, batch = section_job(coordinator, session, delay=60), section_job(coordinator, session, priority="batch")
    coordinator.receive(blocker)
    coordinator.receive(batch)
    cancel = request(session, "job.cancel", {"request_id": batch["id"]})
    coordinator.receive(cancel)
    assert frames(coordinator)[0][cancel["id"]]["result"] == {"state": "requested"}
    assert frames(coordinator)[0][batch["id"]]["status"] == "cancelled" and not coordinator.jobs
    coordinator.receive(request(session, "job.cancel", {"request_id": blocker["id"]}))
    run_until_idle(coordinator)
    assert unpinned(coordinator)


# ---- adoption of the worker's answer (contract §9.3) ----------------------------------------------------------------------------

def test_a_summary_of_8_kib_is_accepted_and_one_byte_more_is_internal(probes):
    coordinator, session = probes
    overhead = len('{"padding":""}')
    fits, oversized = (section_job(coordinator, session, summary_bytes=specs.MAX_SUMMARY_BYTES - overhead + extra) for extra in (0, 1))
    count = len(coordinator.store.buffers)
    for job in (fits, oversized):
        coordinator.receive(job)
        run_until_idle(coordinator)
    responses = frames(coordinator)[0]
    assert len(json.dumps(responses[fits["id"]]["result"]["summary"], separators=(",", ":")).encode()) == specs.MAX_SUMMARY_BYTES
    assert responses[oversized["id"]]["error"]["code"] == "INTERNAL"
    assert len(coordinator.store.buffers) == count + 1, "only the accepted result was adopted"


@pytest.mark.parametrize("fault", ["rows", "valid", "missing", "extra_table"])
def test_a_malformed_table_output_is_internal_and_adopts_nothing(probes, fault):
    coordinator, session = probes
    handle, digest = settings(coordinator, fault=fault)
    job = run(session, "probe.core/1", "core", {**put_table(coordinator, "record", {"a": [1.0, None], "b": [2.0, 3.0]}), "settings": handle}, digest)
    count = len(coordinator.store.buffers)
    coordinator.receive(job)
    run_until_idle(coordinator)
    assert frames(coordinator)[0][job["id"]]["error"]["code"] == "INTERNAL"
    assert len(coordinator.store.buffers) == count and unpinned(coordinator)
    assert not [p for p in Path(coordinator.store.directory.name).iterdir() if p.name.startswith("job-")]


def test_a_method_error_names_its_field_through_method_run(probes):
    coordinator, session = probes
    handle = put_json(coordinator, {"version": 2})
    job = run(session, "probe.section/1", "section", {"mask": put(coordinator, bytes(6), "u8", [2, 3]), "settings": handle},
              coordinator.store.buffers[handle].expected_hash)
    coordinator.receive(job)
    run_until_idle(coordinator)
    error = frames(coordinator)[0][job["id"]]["error"]
    assert (error["code"], error["details"]) == ("UNSUPPORTED_INPUT", {"field": "settings"}) and unpinned(coordinator)
