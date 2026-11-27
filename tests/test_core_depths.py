"""Card M8.5.8c: method `core.depths/1` (contract §9.10) against the reference fixtures of `tests/fixtures/core_depths`, the kernel against a
plain-Python transcription of `core.js::interpAge`, its refusals, and its transport through the real coordinator and worker (`method.run`).

Tolerance, stated before any comparison (contract §9.10, decision Z4): there is none. `depth` must be bit-identical to the JavaScript
result (float64 bit patterns compared as unsigned integers), and the missing pattern and the summary exact.
"""

import json
import random
from pathlib import Path
from uuid import uuid4

import numpy as np
import pytest

from sedcoretool.engine import specs
from sedcoretool.kernels.ages import interpolate_depth
from sedcoretool.methods import core_depths, registry
from sedcoretool.methods.errors import Cancelled, MethodError
from test_engine_method_run import download, put_table, run, settings, unpinned
from test_engine_methods import frames, new_coordinator, request, run_until_idle

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "core_depths"
NAMES = sorted(path.name[:-5] for path in FIXTURES.glob("*.json"))
MODEL_UNITS = {"depth": "cm", "age": "yr", "age_min": "yr", "age_max": "yr"}


def load(name):
    return json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))


def query_column(case):
    """The query ages of a fixture as a list with None for a missing one (the large case keeps them in binary files)."""
    query = case["inputs"]["query"]
    if "age_file" not in query:
        return query["age"]
    values = np.fromfile(FIXTURES / query["age_file"], dtype="<f8")
    valid = np.fromfile(FIXTURES / query["valid_file"], dtype="u1")
    return [float(v) if ok else None for v, ok in zip(values, valid)]


def expected_depths(case):
    """(values, valid) of the reference result, values 0 where missing."""
    depths = case["expected"]["depths"]
    if "depth_file" in depths:
        return np.fromfile(FIXTURES / depths["depth_file"], dtype="<f8"), np.fromfile(FIXTURES / depths["valid_file"], dtype="u1")
    column = depths["depth"]
    return np.array([0.0 if v is None else v for v in column], dtype="<f8"), np.array([0 if v is None else 1 for v in column], dtype="u1")


def columns_of(case):
    model = case["inputs"]["age_model"]
    return {name: list(model[name]) for name in ("depth", "age", "age_min", "age_max") if name in model}


def table_inputs(name, columns, units=MODEL_UNITS):
    """The three entries of a table as the worker hands them to a method: decoded description and two arrays."""
    values = np.array([[0.0 if v is None else v for v in column] for column in columns.values()], dtype="<f8")
    valid = np.array([[0 if v is None else 1 for v in column] for column in columns.values()], dtype="u1")
    meta = {"version": 1, "rows": len(next(iter(columns.values()))), "columns": [{"name": c, "unit": units.get(c, "")} for c in columns]}
    return {name: meta, f"{name}_values": values, f"{name}_valid": valid}


def inputs_of(model, ages, **change):
    return {"settings": {"version": 1}, **table_inputs("age_model", model), **table_inputs("query", {"age": ages}), **change}


def refused(code, field, **kwargs):
    with pytest.raises(MethodError) as caught:
        core_depths.parse(inputs_of(**kwargs))
    assert (caught.value.code, caught.value.field) == (code, field)


def assert_matches(case, dimensions, columns, tables, summary):
    """The comparison rule of the module's docstring; returns the number of present depths compared."""
    want_values, want_valid = expected_depths(case)
    rows = len(query_column(case))
    assert dimensions == {"rows": rows} and summary == case["expected"]["summary"]
    assert [c["name"] for c in tables["depths"]["columns"]] == ["depth"] and tables["depths"]["rows"] == rows and tables["depths"]["version"] == 1
    values, valid = columns["depths_values"], columns["depths_valid"]
    assert values.shape == valid.shape == (1, rows) and values.dtype == np.dtype("<f8") and valid.dtype == np.dtype("u1")
    assert np.array_equal(valid[0], want_valid), "the missing pattern differs"
    assert not np.any(values[0][valid[0] == 0]), "a missing slot holds a value"
    present = want_valid == 1
    assert np.array_equal(values[0][present].view("<u8"), want_values[present].view("<u8")), "a depth differs from the reference in its bits"
    return int(present.sum())


def interp_age_js(depth, age, d):
    """A plain-Python transcription of `core.js::interpAge` on an already inverted model (lists), None outside."""
    if d is None or d < depth[0] or d > depth[-1]:
        return None
    lo, hi = 0, len(depth) - 1
    while hi - lo > 1:
        m = (lo + hi) >> 1
        if depth[m] <= d:
            lo = m
        else:
            hi = m
    span = depth[hi] - depth[lo]
    return age[lo] + ((d - depth[lo]) / span) * (age[hi] - age[lo]) if span else age[lo]


def invert_js(depth, age):
    """`log.js::invertModel`: pairs (age, depth) sorted by age, stable."""
    pairs = sorted(((a, d) for d, a in zip(depth, age)), key=lambda p: p[0])
    return [p[0] for p in pairs], [p[1] for p in pairs]


# ---- the method against every fixture ----------------------------------------------------------------------------------------------

def test_the_fixtures_are_the_eleven_cases_of_the_card():
    assert len(NAMES) == 11 and "rows-1000-random-100000" in NAMES


@pytest.mark.parametrize("name", NAMES)
def test_method_reproduces_every_reference_fixture_bit_for_bit(name):
    case = load(name)
    result = core_depths.run(core_depths.parse(inputs_of(columns_of(case), query_column(case))))
    compared = assert_matches(case, result.dimensions, result.columns, result.tables, result.summary)
    print(f"{name}: {compared} depths bit-identical of {result.dimensions['rows']} rows")


def test_the_unit_of_the_model_depth_is_declared_on_the_output_column():
    result = core_depths.run(core_depths.parse({"settings": {"version": 1}, **table_inputs("age_model", {"depth": [0.0, 1.0], "age": [0.0, 1.0]}, {"depth": "mm"}),
                                                **table_inputs("query", {"age": [0.5]})}))
    assert result.tables["depths"]["columns"] == [{"name": "depth", "unit": "mm"}]


def test_a_range_is_accepted_and_not_used():
    plain = {"depth": [0.0, 10.0], "age": [0.0, 100.0]}
    ranged = {**plain, "age_min": [0.0, 90.0], "age_max": [10.0, 100.0]}
    a = core_depths.run(core_depths.parse(inputs_of(plain, [25.0])))
    b = core_depths.run(core_depths.parse(inputs_of(ranged, [25.0])))
    assert a.columns["depths_values"].tolist() == b.columns["depths_values"].tolist() == [[2.5]]


def test_reversals_and_equal_ages_follow_the_stable_inverse():
    # ages 0, 50, 50, 100 at depths 0, 1, 2, 3: the inverse keeps depths 1 then 2 for age 50; span 0 gives the depth of `lo`
    model = {"depth": [0.0, 1.0, 2.0, 3.0], "age": [0.0, 50.0, 50.0, 100.0]}
    result = core_depths.run(core_depths.parse(inputs_of(model, [25.0, 50.0, 75.0, 100.0, None, 101.0, -1.0])))
    assert result.columns["depths_values"].tolist() == [[0.5, 2.0, 2.5, 3.0, 0.0, 0.0, 0.0]]
    assert result.columns["depths_valid"].tolist() == [[1, 1, 1, 1, 0, 0, 0]]
    assert result.summary == {"rows": 7, "outside": 2}


def test_cancellation_is_polled_and_leaves_no_result():
    case = load("two-rows")
    snapshot = core_depths.parse(inputs_of(columns_of(case), query_column(case)))
    with pytest.raises(Cancelled):
        core_depths.run(snapshot, cancelled=lambda: True)


def test_the_method_is_registered_and_agrees_with_the_method_table():
    entry = specs.METHOD_SPECS[specs.CORE_DEPTHS]
    assert registry.get("core.depths/1") is core_depths and core_depths.NAME == specs.CORE_DEPTHS
    assert set(entry.inputs) == set(core_depths.INPUT_NAMES) and entry.inputs is specs.METHOD_INPUTS[specs.CORE_DEPTHS]
    assert (entry.scope, entry.priorities, entry.families, entry.same_shape) == ("core", ("interactive",), (), ())
    assert all(entry.inputs[name] == ("f64le", 2, True) for name in ("age_model_values", "query_values"))
    assert all(entry.inputs[name] == ("u8", 2, True) for name in ("age_model_valid", "query_valid"))
    assert all(entry.inputs[name] == ("utf8json", 1, True) for name in ("settings", "age_model", "query"))
    result = core_depths.run(core_depths.parse(inputs_of({"depth": [0.0, 1.0], "age": [0.0, 1.0]}, [0.5])))
    assert tuple(result.dimensions) == entry.dimensions and set(result.tables) == set(entry.tables)


# ---- the kernel against a transcription of interpAge ----------------------------------------------------------------------------------

def random_model(rng, rows, equal_share, reversal_share):
    depth = [round(i * 1.37 + rng.random() * 0.5, 6) for i in range(rows)]
    age, current = [], rng.uniform(0, 100)
    for _ in range(rows):
        roll = rng.random()
        if roll < equal_share:
            pass                                                  # an age equal to the previous one
        elif roll < equal_share + reversal_share:
            current -= rng.uniform(0, 30)
        else:
            current += rng.uniform(0, 30)
        age.append(current)
    return depth, age


@pytest.mark.parametrize("seed", range(40))
def test_kernel_is_bit_identical_to_a_transcription_of_interp_age_on_random_models(seed):
    rng = random.Random(seed)
    depth, age = random_model(rng, rng.choice([2, 3, 5, 40, 300]), rng.choice([0.0, 0.3, 0.7]), rng.choice([0.0, 0.2]))
    inverse_age, inverse_depth = invert_js(depth, age)
    low, high = inverse_age[0], inverse_age[-1]
    margin = (high - low) * 0.05 + 1.0
    queries = [rng.uniform(low - margin, high + margin) for _ in range(500)] + inverse_age + [low, high, low - 1e-9, high + 1e-9]
    queries += [(a + b) / 2 for a, b in zip(inverse_age, inverse_age[1:])]
    got = interpolate_depth(np.array(queries), depth, age)
    for q, g in zip(queries, got):
        want = interp_age_js(inverse_age, inverse_depth, q)
        if want is None:
            assert np.isnan(g), (seed, q)
        else:
            assert np.float64(want).view("<u8") == g.view("<u8"), (seed, q, want, g)


def test_kernel_sorts_stably_so_equal_ages_keep_the_order_of_their_input():
    # the kernel sorts stably: for ages 5, 5, 5 at depths 3, 1, 2 the inverse keeps that order, `lo` is the last equal age (depth 2)
    got = interpolate_depth([5.0], [3.0, 1.0, 2.0, 9.0], [5.0, 5.0, 5.0, 7.0])
    assert got.tolist() == [2.0]


# ---- refusals naming the field -----------------------------------------------------------------------------------------------------

GOOD_MODEL = {"depth": [0.0, 10.0], "age": [0.0, 100.0]}


@pytest.mark.parametrize("depths", [[0.0, 10.0, 5.0], [0.0, 5.0, 5.0], [3.0, 2.0]])
def test_a_depth_that_does_not_increase_is_unsupported_input(depths):
    refused("UNSUPPORTED_INPUT", "age_model.depth", model={"depth": depths, "age": [1.0] * len(depths)}, ages=[1.0])


def test_a_missing_model_value_names_its_column():
    for column in ("depth", "age"):
        model = table_inputs("age_model", {"depth": [0.0, 10.0, 20.0], "age": [0.0, 1.0, 2.0]})
        row = 0 if column == "depth" else 1
        model["age_model_valid"][row, 1] = 0
        model["age_model_values"][row, 1] = 0.0
        with pytest.raises(MethodError) as caught:
            core_depths.parse({"settings": {"version": 1}, **model, **table_inputs("query", {"age": [1.0]})})
        assert (caught.value.code, caught.value.field) == ("UNSUPPORTED_INPUT", f"age_model.{column}")


@pytest.mark.parametrize("only", ["age_min", "age_max"])
def test_one_range_column_without_the_other_is_refused(only):
    refused("INVALID_REQUEST", "age_model.columns", model={**GOOD_MODEL, only: [0.0, 100.0]}, ages=[1.0])


def test_a_range_must_contain_the_age():
    refused("UNSUPPORTED_INPUT", "age_model.age_min", model={**GOOD_MODEL, "age_min": [0.0, 101.0], "age_max": [1.0, 120.0]}, ages=[1.0])
    refused("UNSUPPORTED_INPUT", "age_model.age_max", model={**GOOD_MODEL, "age_min": [0.0, 90.0], "age_max": [1.0, 99.0]}, ages=[1.0])


def test_a_model_of_one_row_is_refused():
    refused("UNSUPPORTED_INPUT", "age_model.rows", model={"depth": [1.0], "age": [2.0]}, ages=[1.0])


def test_the_model_columns_are_exactly_depth_and_age_with_an_optional_range_in_order():
    refused("INVALID_REQUEST", "age_model.columns", model={"age": [0.0, 1.0], "depth": [0.0, 1.0]}, ages=[1.0])
    refused("INVALID_REQUEST", "age_model.columns", model={"depth": [0.0, 1.0]}, ages=[1.0])
    refused("INVALID_REQUEST", "age_model.columns.name", model={**GOOD_MODEL, "extra": [0.0, 1.0]}, ages=[1.0])


def test_the_query_has_an_age_column_and_nothing_else():
    base = {"settings": {"version": 1}, **table_inputs("age_model", GOOD_MODEL)}
    for query in ({"depth": [1.0]}, {"age": [1.0], "depth": [1.0]}):
        with pytest.raises(MethodError) as caught:
            core_depths.parse({**base, **table_inputs("query", query)})
        assert (caught.value.code, caught.value.field) == ("INVALID_REQUEST", "query.columns.name")
    absent = {**base, **table_inputs("query", {"age": [1.0]})}
    absent["query"] = {"version": 1, "rows": 1, "columns": []}
    with pytest.raises(MethodError) as caught:
        core_depths.parse(absent)
    assert (caught.value.code, caught.value.field) == ("INVALID_REQUEST", "query.columns")


@pytest.mark.filterwarnings("ignore::RuntimeWarning")
def test_an_interpolation_that_overflows_is_refused_naming_the_model():
    inputs = inputs_of({"depth": [-1e308, 1e308], "age": [0.0, 1.0]}, [0.5])
    with pytest.raises(MethodError) as caught:
        core_depths.run(core_depths.parse(inputs))
    assert (caught.value.code, caught.value.field) == ("UNSUPPORTED_INPUT", "age_model")


def test_settings_are_exactly_version_1_and_the_input_names_are_closed():
    good = inputs_of(GOOD_MODEL, [1.0])
    for value, code in (({"version": 2}, "UNSUPPORTED_INPUT"), ({"version": True}, "UNSUPPORTED_INPUT"), ({"version": 1, "extra": 1}, "INVALID_REQUEST"),
                        ({}, "INVALID_REQUEST"), (None, "INVALID_REQUEST")):
        with pytest.raises(MethodError) as caught:
            core_depths.parse({**good, "settings": value})
        assert (caught.value.code, caught.value.field) == (code, "settings")
    with pytest.raises(MethodError) as caught:
        core_depths.parse({name: v for name, v in good.items() if name != "query_valid"})
    assert (caught.value.code, caught.value.field) == ("INVALID_REQUEST", "inputs")


# ---- transport through the real coordinator and worker ------------------------------------------------------------------------------

@pytest.fixture
def engine():
    coordinator, session = new_coordinator()
    try:
        yield coordinator, session
    finally:
        coordinator.close()


def depths_job(coordinator, session, model, ages, *, target=None, revision=1):
    handle, digest = settings(coordinator)
    inputs = {**put_table(coordinator, "age_model", model), **put_table(coordinator, "query", {"age": ages}), "settings": handle}
    return run(session, "core.depths/1", "core", inputs, digest, target=target, revision=revision)


@pytest.mark.parametrize("name", ["two-rows-with-range", "rows-1000-reversals-equal-ages", "rows-1000-random-100000"])
def test_fixtures_through_method_run_of_the_real_coordinator_and_worker(engine, name):
    coordinator, session = engine
    case = load(name)
    job = depths_job(coordinator, session, columns_of(case), query_column(case), revision=7)
    coordinator.receive(job)
    run_until_idle(coordinator)
    response = frames(coordinator)[0][job["id"]]
    assert response["status"] == "ok", response
    result = response["result"]
    assert (result["method"], result["scope"], result["revision"]) == ("core.depths/1", "core", 7)
    assert_matches(case, result["dimensions"], download(coordinator, session, result), result["tables"], result["summary"])
    assert unpinned(coordinator)


def test_a_refusal_reaches_the_client_naming_the_field(engine):
    coordinator, session = engine
    job = depths_job(coordinator, session, {"depth": [0.0, 10.0, 5.0], "age": [1.0, 2.0, 3.0]}, [1.0])
    coordinator.receive(job)
    run_until_idle(coordinator)
    error = frames(coordinator)[0][job["id"]]["error"]
    assert (error["code"], error["details"]) == ("UNSUPPORTED_INPUT", {"field": "age_model.depth"}) and unpinned(coordinator)


def test_a_waiting_job_is_cancelled_and_a_newer_revision_supersedes_the_older_ones(engine):
    coordinator, session = engine
    case = load("rows-1000-random-100000")
    model, ages = columns_of(case), query_column(case)
    target, other = str(uuid4()), str(uuid4())
    running = depths_job(coordinator, session, model, ages, target=target, revision=1)
    waiting_cancel = depths_job(coordinator, session, model, ages, target=other)
    waiting_old = depths_job(coordinator, session, model, ages, target=target, revision=2)
    newest = depths_job(coordinator, session, {"depth": [0.0, 10.0], "age": [0.0, 100.0]}, [50.0, 101.0], target=target, revision=3)
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
    assert cells["depths_values"].tolist() == [[5.0, 0.0]] and cells["depths_valid"].tolist() == [[1, 0]]
    assert unpinned(coordinator)
