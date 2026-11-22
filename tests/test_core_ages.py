"""Card M8.5.5: method `core.ages/1` (contract §9.8) against the reference fixtures of `tests/fixtures/core_ages`, its refusals, and its
transport through the real coordinator and worker (`method.run`).

Tolerance, stated before any comparison (contract §9.8, §7): `age`, `age_min` and `age_max` agree with the JavaScript reference within an
absolute 1e-9 in declared age units (the fixtures hold ages below 1e6, where float64 spacing is about 1e-10 and the two implementations
differ by a few ulp at most); the missing pattern and the summary are compared exactly.
"""

import json
from pathlib import Path
from uuid import uuid4

import numpy as np
import pytest

from sedcoretool.engine import specs
from sedcoretool.methods import core_ages, registry
from sedcoretool.methods.errors import Cancelled, MethodError
from test_engine_method_run import download, put_table, run, settings, unpinned
from test_engine_methods import frames, new_coordinator, request, run_until_idle

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "core_ages"
NAMES = sorted(path.name[:-5] for path in FIXTURES.glob("*.json"))
TOLERANCE = 1e-9
MODEL_UNITS = {"depth": "cm", "age": "yr", "age_min": "yr", "age_max": "yr"}


def load(name):
    return json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))


def query_column(case):
    """The query depths of a fixture as a list with None for a missing one (the large case keeps them in binary files)."""
    query = case["inputs"]["query"]
    if "depth_file" not in query:
        return query["depth"]
    values = np.fromfile(FIXTURES / query["depth_file"], dtype="<f8")
    valid = np.fromfile(FIXTURES / query["valid_file"], dtype="u1")
    return [float(v) if ok else None for v, ok in zip(values, valid)]


def expected_ages(case):
    """{column: (values, valid)} of the reference result, values 0 where missing."""
    ages = case["expected"]["ages"]
    if "age_file" in ages:
        values = np.fromfile(FIXTURES / ages["age_file"], dtype="<f8")
        valid = np.fromfile(FIXTURES / ages["valid_file"], dtype="u1")
        return {"age": (values, valid)}
    return {name: (np.array([0.0 if v is None else v for v in column]), np.array([0 if v is None else 1 for v in column], dtype="u1"))
            for name, column in ages.items()}


def columns_of(case):
    model = case["inputs"]["age_model"]
    return {name: list(model[name]) for name in ("depth", "age", "age_min", "age_max") if name in model}


def table_inputs(name, columns, units=MODEL_UNITS):
    """The three entries of a table as the worker hands them to a method: decoded description and two arrays."""
    values = np.array([[0.0 if v is None else v for v in column] for column in columns.values()], dtype="<f8")
    valid = np.array([[0 if v is None else 1 for v in column] for column in columns.values()], dtype="u1")
    meta = {"version": 1, "rows": len(next(iter(columns.values()))), "columns": [{"name": c, "unit": units.get(c, "")} for c in columns]}
    return {name: meta, f"{name}_values": values, f"{name}_valid": valid}


def inputs_of(model, depths, **change):
    return {"settings": {"version": 1}, **table_inputs("age_model", model), **table_inputs("query", {"depth": depths}), **change}


def refused(code, field, **kwargs):
    with pytest.raises(MethodError) as caught:
        core_ages.parse(inputs_of(**kwargs))
    assert (caught.value.code, caught.value.field) == (code, field)


def assert_matches(case, dimensions, columns, tables, summary):
    """The comparison rule of the module's docstring; returns the largest absolute age error."""
    expected = expected_ages(case)
    rows = len(query_column(case))
    assert dimensions == {"rows": rows} and summary == case["expected"]["summary"]
    names = list(expected)
    assert [c["name"] for c in tables["ages"]["columns"]] == names and tables["ages"]["rows"] == rows and tables["ages"]["version"] == 1
    values, valid = columns["ages_values"], columns["ages_valid"]
    assert values.shape == valid.shape == (len(names), rows) and values.dtype == np.dtype("<f8") and valid.dtype == np.dtype("u1")
    worst = 0.0
    for k, name in enumerate(names):
        want_values, want_valid = expected[name]
        assert np.array_equal(valid[k], want_valid), f"{name}: the missing pattern differs"
        assert not np.any(values[k][valid[k] == 0]), f"{name}: a missing slot holds a value"
        present = want_valid == 1
        if present.any():
            worst = max(worst, float(np.max(np.abs(values[k][present] - want_values[present]))))
    assert worst <= TOLERANCE, f"largest age error {worst}"
    return worst


# ---- the method against every fixture ----------------------------------------------------------------------------------------------

def test_the_fixtures_are_the_eight_cases_of_the_card():
    assert len(NAMES) == 8 and "rows-1000-random-100000" in NAMES


@pytest.mark.parametrize("name", NAMES)
def test_method_reproduces_every_reference_fixture(name):
    case = load(name)
    snapshot = core_ages.parse(inputs_of(columns_of(case), query_column(case)))
    result = core_ages.run(snapshot)
    worst = assert_matches(case, result.dimensions, result.columns, result.tables, result.summary)
    print(f"{name}: largest age error {worst:.3e}")


def test_units_of_the_model_columns_are_declared_on_the_output_columns():
    case = load("two-rows-with-range")
    units = {"depth": "mm", "age": "ka", "age_min": "ka BP", "age_max": ""}
    result = core_ages.run(core_ages.parse({"settings": {"version": 1}, **table_inputs("age_model", columns_of(case), units),
                                            **table_inputs("query", {"depth": [2.0]})}))
    assert result.tables["ages"]["columns"] == [{"name": "age", "unit": "ka"}, {"name": "age_min", "unit": "ka BP"}, {"name": "age_max", "unit": ""}]


def test_a_reversal_is_interpolated_as_given_and_a_missing_depth_is_not_outside():
    result = core_ages.run(core_ages.parse(inputs_of({"depth": [0.0, 10.0, 20.0], "age": [100.0, 50.0, 80.0]}, [5.0, None, 15.0, 25.0, -1.0])))
    assert result.columns["ages_values"].tolist() == [[75.0, 0.0, 65.0, 0.0, 0.0]] and result.columns["ages_valid"].tolist() == [[1, 0, 1, 0, 0]]
    assert result.summary == {"rows": 5, "outside": 2}


def test_cancellation_is_polled_and_leaves_no_result():
    case = load("two-rows")
    snapshot = core_ages.parse(inputs_of(columns_of(case), query_column(case)))
    with pytest.raises(Cancelled):
        core_ages.run(snapshot, cancelled=lambda: True)


def test_the_method_is_registered_and_agrees_with_the_method_table():
    entry = specs.METHOD_SPECS[specs.CORE_AGES]
    assert registry.get("core.ages/1") is core_ages and core_ages.NAME == specs.CORE_AGES
    assert set(entry.inputs) == set(core_ages.INPUT_NAMES)
    assert all(entry.inputs[name] == ("f64le", 2, True) for name in ("age_model_values", "query_values"))
    assert all(entry.inputs[name] == ("u8", 2, True) for name in ("age_model_valid", "query_valid"))
    assert all(entry.inputs[name] == ("utf8json", 1, True) for name in ("settings", "age_model", "query"))
    result = core_ages.run(core_ages.parse(inputs_of({"depth": [0.0, 1.0], "age": [0.0, 1.0]}, [0.5])))
    assert tuple(result.dimensions) == entry.dimensions and set(result.tables) == set(entry.tables)


# ---- refusals naming the field -----------------------------------------------------------------------------------------------------

GOOD_MODEL = {"depth": [0.0, 10.0], "age": [0.0, 100.0]}


@pytest.mark.parametrize("depths", [[0.0, 10.0, 5.0], [0.0, 5.0, 5.0], [3.0, 2.0]])
def test_a_depth_that_does_not_increase_is_unsupported_input(depths):
    refused("UNSUPPORTED_INPUT", "age_model.depth", model={"depth": depths, "age": [1.0] * len(depths)}, depths=[1.0])


def test_a_missing_model_value_names_its_column():
    for column in ("depth", "age"):
        model = table_inputs("age_model", {**GOOD_MODEL, "depth": [0.0, 10.0, 20.0], "age": [0.0, 1.0, 2.0]})
        model["age_model_valid"][0 if column == "depth" else 1, 1] = 0
        model["age_model_values"][0 if column == "depth" else 1, 1] = 0.0
        with pytest.raises(MethodError) as caught:
            core_ages.parse({"settings": {"version": 1}, **model, **table_inputs("query", {"depth": [1.0]})})
        assert (caught.value.code, caught.value.field) == ("UNSUPPORTED_INPUT", f"age_model.{column}")
    ranged = {"depth": [0.0, 1.0], "age": [0.0, 1.0], "age_min": [0.0, None], "age_max": [0.0, 1.0]}
    refused("UNSUPPORTED_INPUT", "age_model.age_min", model=ranged, depths=[0.5])


@pytest.mark.parametrize("only", ["age_min", "age_max"])
def test_one_range_column_without_the_other_is_refused(only):
    refused("INVALID_REQUEST", "age_model.columns", model={**GOOD_MODEL, only: [0.0, 100.0]}, depths=[1.0])


def test_a_range_must_contain_the_age():
    refused("UNSUPPORTED_INPUT", "age_model.age_min", model={**GOOD_MODEL, "age_min": [0.0, 101.0], "age_max": [1.0, 120.0]}, depths=[1.0])
    refused("UNSUPPORTED_INPUT", "age_model.age_max", model={**GOOD_MODEL, "age_min": [0.0, 90.0], "age_max": [1.0, 99.0]}, depths=[1.0])


def test_a_model_of_one_row_is_refused():
    refused("UNSUPPORTED_INPUT", "age_model.rows", model={"depth": [1.0], "age": [2.0]}, depths=[1.0])


def test_the_model_columns_are_exactly_depth_and_age_with_an_optional_range_in_order():
    refused("INVALID_REQUEST", "age_model.columns", model={"age": [0.0, 1.0], "depth": [0.0, 1.0]}, depths=[1.0])
    refused("INVALID_REQUEST", "age_model.columns", model={"depth": [0.0, 1.0]}, depths=[1.0])
    refused("INVALID_REQUEST", "age_model.columns.name", model={**GOOD_MODEL, "extra": [0.0, 1.0]}, depths=[1.0])
    refused("INVALID_REQUEST", "age_model.columns", model={**GOOD_MODEL, "age_max": [1.0, 101.0], "age_min": [0.0, 99.0]}, depths=[1.0])


def test_the_query_has_a_depth_column_and_nothing_else():
    base = {"settings": {"version": 1}, **table_inputs("age_model", GOOD_MODEL)}
    for query, field in (({"age": [1.0]}, "query.columns.name"), ({"depth": [1.0], "age": [1.0]}, "query.columns.name")):
        with pytest.raises(MethodError) as caught:
            core_ages.parse({**base, **table_inputs("query", query)})
        assert (caught.value.code, caught.value.field) == ("INVALID_REQUEST", field)
    absent = {**base, **table_inputs("query", {"depth": [1.0]})}
    absent["query"] = {"version": 1, "rows": 1, "columns": []}
    with pytest.raises(MethodError) as caught:
        core_ages.parse(absent)
    assert (caught.value.code, caught.value.field) == ("INVALID_REQUEST", "query.columns")
    empty = {**base, "query": {"version": 1, "rows": 0, "columns": [{"name": "depth", "unit": ""}]}, "query_values": np.zeros((1, 0)), "query_valid": np.zeros((1, 0), "u1")}
    with pytest.raises(MethodError) as caught:
        core_ages.parse(empty)
    assert caught.value.field == "query.rows"


def test_settings_are_exactly_version_1_and_the_input_names_are_closed():
    good = inputs_of(GOOD_MODEL, [1.0])
    for value, code in (({"version": 2}, "UNSUPPORTED_INPUT"), ({"version": True}, "UNSUPPORTED_INPUT"), ({"version": 1, "extra": 1}, "INVALID_REQUEST"),
                        ({}, "INVALID_REQUEST"), (None, "INVALID_REQUEST")):
        with pytest.raises(MethodError) as caught:
            core_ages.parse({**good, "settings": value})
        assert (caught.value.code, caught.value.field) == (code, "settings")
    with pytest.raises(MethodError) as caught:
        core_ages.parse({name: v for name, v in good.items() if name != "query_valid"})
    assert (caught.value.code, caught.value.field) == ("INVALID_REQUEST", "inputs")


# ---- transport through the real coordinator and worker ------------------------------------------------------------------------------

@pytest.fixture
def engine():
    coordinator, session = new_coordinator()
    try:
        yield coordinator, session
    finally:
        coordinator.close()


def ages_job(coordinator, session, model, depths, *, target=None, revision=1):
    handle, digest = settings(coordinator)
    inputs = {**put_table(coordinator, "age_model", model), **put_table(coordinator, "query", {"depth": depths}), "settings": handle}
    return run(session, "core.ages/1", "core", inputs, digest, target=target, revision=revision)


@pytest.mark.parametrize("name", ["two-rows-with-range", "rows-1000-reversals-with-range", "rows-1000-random-100000"])
def test_fixtures_through_method_run_of_the_real_coordinator_and_worker(engine, name):
    coordinator, session = engine
    case = load(name)
    job = ages_job(coordinator, session, columns_of(case), query_column(case), revision=7)
    coordinator.receive(job)
    run_until_idle(coordinator)
    response = frames(coordinator)[0][job["id"]]
    assert response["status"] == "ok", response
    result = response["result"]
    assert (result["method"], result["scope"], result["revision"]) == ("core.ages/1", "core", 7)
    assert_matches(case, result["dimensions"], download(coordinator, session, result), result["tables"], result["summary"])
    assert unpinned(coordinator)


def test_a_refusal_reaches_the_client_naming_the_field(engine):
    coordinator, session = engine
    job = ages_job(coordinator, session, {"depth": [0.0, 10.0, 5.0], "age": [1.0, 2.0, 3.0]}, [1.0])
    coordinator.receive(job)
    run_until_idle(coordinator)
    error = frames(coordinator)[0][job["id"]]["error"]
    assert (error["code"], error["details"]) == ("UNSUPPORTED_INPUT", {"field": "age_model.depth"}) and unpinned(coordinator)


def test_a_waiting_job_is_cancelled_and_a_newer_revision_supersedes_the_older_ones(engine):
    coordinator, session = engine
    case = load("rows-1000-random-100000")
    model, depths = columns_of(case), query_column(case)
    target, other = str(uuid4()), str(uuid4())
    running = ages_job(coordinator, session, model, depths, target=target, revision=1)
    waiting_cancel = ages_job(coordinator, session, model, depths, target=other)
    waiting_old = ages_job(coordinator, session, model, depths, target=target, revision=2)
    newest = ages_job(coordinator, session, {"depth": [0.0, 10.0], "age": [0.0, 100.0]}, [5.0, 11.0], target=target, revision=3)
    coordinator.receive(running)
    coordinator.receive(waiting_cancel)
    coordinator.receive(request(session, "job.cancel", {"request_id": waiting_cancel["id"]}))
    assert frames(coordinator)[0][waiting_cancel["id"]]["status"] == "cancelled"
    coordinator.receive(waiting_old)                           # supersedes the running job of the same target
    coordinator.receive(newest)                                # supersedes the waiting job: answered `cancelled` at once
    assert frames(coordinator)[0][waiting_old["id"]]["status"] == "cancelled"
    run_until_idle(coordinator)
    responses = frames(coordinator)[0]
    assert responses[running["id"]]["status"] in ("cancelled", "ok"), "a job the worker had finished before the cancellation reached it is still answered"
    result = responses[newest["id"]]["result"]
    assert responses[newest["id"]]["status"] == "ok" and result["revision"] == 3 and result["summary"] == {"rows": 2, "outside": 1}
    cells = download(coordinator, session, result)
    assert cells["ages_values"].tolist() == [[50.0, 0.0]] and cells["ages_valid"].tolist() == [[1, 0]]
    assert unpinned(coordinator)
