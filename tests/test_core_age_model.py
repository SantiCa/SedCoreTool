"""Card M8.5.8e: methods `core.age_model/1` and `core.bacon/1` (contract §9.11) against the reference fixtures of
`tests/fixtures/age_model`, against plain-Python transcriptions of `core.js::parseAgeModelDetailed` and `baconToAgeText` on seeded
random texts, their refusals, hostile texts, and their transport through the real coordinator and worker (`method.run`).

Tolerance, stated before any comparison (contract §9.11, decision Y4): there is none. Every output value must be bit-identical to the
JavaScript result (float64 bit patterns compared as unsigned integers, so -0 differs from +0), and the missing pattern and the summary
exact. For `core.bacon/1` the numbers are compared; the fixtures' `text_lines` are written by the page, not by the method.
"""

import functools
import json
import math
import random
import re
import time
from pathlib import Path
from uuid import uuid4

import numpy as np
import pytest

from sedcoretool.engine import specs
from sedcoretool.kernels import jstext
from sedcoretool.methods import core_age_model, core_bacon, registry, validation
from sedcoretool.methods.errors import Cancelled, MethodError
from test_engine_method_run import download, put_json, run, unpinned
from test_engine_methods import frames, new_coordinator, put, request, run_until_idle

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "age_model"
AGE_NAMES = sorted(path.name[:-5] for path in FIXTURES.glob("age-*.json"))
BACON_NAMES = sorted(path.name[:-5] for path in FIXTURES.glob("bacon-*.json"))
MiB = 1_048_576
BACON_SETTINGS = {"version": 1, "center": "median", "depth_unit": "cm", "age_divisor": 1000}


def load(name):
    return json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))


def u8(text):
    return np.frombuffer(text.encode("utf-8"), dtype="u1")


def age_model(text, settings=None):
    return core_age_model.run(core_age_model.parse({"settings": settings or {"version": 1}, "text": u8(text) if isinstance(text, str) else text}))


def bacon(text, settings=None):
    data = u8(text) if isinstance(text, str) else text
    return core_bacon.run(core_bacon.parse({"settings": settings or BACON_SETTINGS, "table_text": data}))


def bits(values):
    return np.asarray(values, dtype="<f8").view("<u8")


def column(values):
    """A fixture column as (values with 0 where missing, valid)."""
    return (np.array([0.0 if v is None else float(v) for v in values], dtype="<f8"), np.array([v is not None for v in values], dtype="u1"))


def assert_age_matches(case, dimensions, columns, tables, summary):
    expected = case["expected"]
    names = list(expected["model"])
    rows = len(expected["model"]["depth"])
    assert summary == expected["summary"] and dimensions == {"rows": rows}
    if summary["issue_depth"] is not None:
        assert math.copysign(1, summary["issue_depth"]) == 1, "a -0 depth is written 0 in the summary"
    assert tables["model"] == {"version": 1, "rows": rows, "columns": [{"name": name, "unit": ""} for name in names]}
    values, valid = columns["model_values"], columns["model_valid"]
    assert values.shape == valid.shape == (len(names), rows) and values.dtype == np.dtype("<f8") and valid.dtype == np.dtype("u1")
    assert np.all(valid == 1)
    for k, name in enumerate(names):
        assert np.array_equal(bits(values[k]), bits(column(expected["model"][name])[0])), f"{name} differs from the reference in its bits"
    return values.size


def assert_bacon_matches(case, dimensions, columns, tables, summary):
    expected, settings = case["expected"], case["inputs"]["settings"]
    rows = len(expected["rows"]["depth"])
    assert summary == expected["summary"] == {"rows": rows} and dimensions == {"rows": rows}
    age_unit = {1: "a", 1000: "ka", 1_000_000: "Ma"}[settings["age_divisor"]]
    assert tables["rows"] == {"version": 1, "rows": rows, "columns": [{"name": "depth", "unit": settings["depth_unit"]}] +
                              [{"name": name, "unit": age_unit} for name in ("age", "age_min", "age_max")]}
    values, valid = columns["rows_values"], columns["rows_valid"]
    assert values.shape == valid.shape == (4, rows)
    for k, name in enumerate(("depth", "age", "age_min", "age_max")):
        want_values, want_valid = column(expected["rows"][name])
        assert np.array_equal(valid[k], want_valid), f"the missing pattern of {name} differs"
        assert np.array_equal(bits(values[k]), bits(want_values)), f"{name} differs from the reference in its bits"
    return int(valid.sum())


# ---- every fixture --------------------------------------------------------------------------------------------------------------

def test_the_fixtures_are_the_cases_of_card_m858d():
    assert len(AGE_NAMES) == 41 and len(BACON_NAMES) == 24
    assert "age-large-10000" in AGE_NAMES and "bacon-large-10000" in BACON_NAMES


@pytest.mark.parametrize("name", AGE_NAMES)
def test_age_model_reproduces_every_reference_fixture_bit_for_bit(name):
    case = load(name)
    assert case["inputs"]["settings"] == {"version": 1}
    result = age_model(case["inputs"]["text"])
    compared = assert_age_matches(case, result.dimensions, result.columns, result.tables, result.summary)
    print(f"{name}: {compared} values bit-identical")


@pytest.mark.parametrize("name", BACON_NAMES)
def test_bacon_reproduces_every_reference_fixture_bit_for_bit(name):
    case = load(name)
    result = bacon(case["inputs"]["table_text"], case["inputs"]["settings"])
    compared = assert_bacon_matches(case, result.dimensions, result.columns, result.tables, result.summary)
    print(f"{name}: {compared} values bit-identical")


# ---- plain transcriptions of the JavaScript, on seeded random texts --------------------------------------------------------------

W = "[" + re.escape(jstext.WHITESPACE) + "]"
SEMICOLON, COMMA, RUN = re.compile(f"{W}*[;\\t]{W}*"), re.compile(f"{W}*,{W}*"), re.compile(f"{W}+")
UNDEFINED = object()


def js_split(line):
    """`split` of `parseAgeModelDetailed`, with Python's `re` on the same expressions (whitespace written as ECMAScript's set)."""
    if re.search("[;\t]", line):
        return [RUN.sub("", x).replace(",", ".", 1) for x in SEMICOLON.split(line)]
    return COMMA.split(line) if "," in line else RUN.split(line)


def finite(v):
    return v is not UNDEFINED and math.isfinite(v)


def js_min(a, b):
    return a if a < b else b if b < a else (-0.0 if a == 0 and (math.copysign(1, a) < 0 or math.copysign(1, b) < 0) else a)


def js_max(a, b):
    return a if a > b else b if b > a else (0.0 if a == 0 and (math.copysign(1, a) > 0 or math.copysign(1, b) > 0) else a)


def parse_age_model_js(text):
    """`core.js::parseAgeModelDetailed`, line by line (Python's full `str.lower`, `list.pop` as `splice`)."""
    lines = [jstext.trim(line) for line in re.split("\r?\n", text)]
    lines = [line for line in lines if line and not line.startswith("#")]
    i_d, i_a, i_min, i_max, named, is_bacon = 0, 1, 2, 3, False, False
    first = [x.replace('"', "").lower() for x in js_split(lines[0])] if lines else []
    if len(first) >= 2 and any(x and not math.isfinite(jstext.string_to_number(x)) for x in first):
        def find(pattern):
            return next((i for i, x in enumerate(first) if re.match(pattern, x)), -1)
        is_bacon = all(k in first for k in ("depth", "min", "max", "median", "mean"))
        d, a = find("^(depth|prof|mcd|mbsf|cmcd|ccsf|z)"), find("^(age|edad|median|mean|cal)")
        i_d = d if d >= 0 else 0
        i_a = a if a >= 0 else (1 if i_d == 0 else 0)
        i_min, i_max, named = find(r"^(min|lower|low|age_?min|2\.5)"), find(r"^(max|upper|high|age_?max|97\.5)"), True
        lines.pop(0)
    pts = []
    for line in lines:
        p = [math.nan if v == "" else jstext.string_to_number(v) for v in js_split(line)]

        def at(i, p=p):
            return p[i] if i < len(p) else UNDEFINED
        if finite(at(i_d)) and finite(at(i_a)):
            pts.append([p[i_d], p[i_a], at(i_min) if i_min >= 0 else math.nan, at(i_max) if i_max >= 0 else math.nan])

    def compare(a, b):
        r = (a[0] - b[0]) or (a[1] - b[1])
        return (r > 0) - (r < 0)
    pts.sort(key=functools.cmp_to_key(compare))

    def same_value(v, w):
        if v is UNDEFINED or w is UNDEFINED:
            return v is w
        return v == w or (math.isnan(v) and math.isnan(w))
    for i in range(len(pts) - 1, 0, -1):
        if pts[i][0] == pts[i - 1][0]:
            if all(same_value(v, w) for v, w in zip(pts[i], pts[i - 1])):
                pts.pop(i)
            else:
                return {"rows": 0, "issue": "dupDepth", "issue_depth": pts[i][0]}
    if len(pts) < 2:
        return {"rows": 0, "issue": None}
    bad = sum(1 for p in pts if not finite(p[2]) or not finite(p[3]) or p[1] < js_min(p[2], p[3]) or p[1] > js_max(p[2], p[3]))
    model = {"rows": len(pts), "issue": None, "depth": [p[0] for p in pts], "age": [p[1] for p in pts],
             "reversals": sum(1 for i in range(1, len(pts)) if pts[i][1] < pts[i - 1][1]),
             "range_ignored": bad if (bad and named and i_min >= 0 and i_max >= 0) else 0, "bacon": is_bacon}
    if not bad:
        model["age_min"], model["age_max"] = [js_min(p[2], p[3]) for p in pts], [js_max(p[2], p[3]) for p in pts]
    return model


def bacon_js(text, center, depth_unit, age_divisor):
    """`core.js::baconToAgeText`, as numbers (None for no rows)."""
    lines = [line for line in re.split("\r?\n", text) if jstext.trim(line)]
    if not lines:
        return None
    head = re.split("[,;\t ]+", jstext.trim(lines[0]).replace('"', "").lower())

    def col(k):
        return head.index(k) if k in head else -1
    i_d, i_min, i_max = col("depth"), col("min"), col("max")
    i_c = col(center) if col(center) >= 0 else col("median") if col("median") >= 0 else col("mean")
    if min(i_d, i_min, i_max, i_c) < 0:
        return None
    f, out = 1 / {"mm": 0.1, "cm": 1, "m": 100}[depth_unit], []
    for line in lines[1:]:
        p = [jstext.string_to_number(x) for x in re.split("[,;\t ]+", jstext.trim(line))]
        if any(i >= len(p) or not math.isfinite(p[i]) for i in (i_d, i_min, i_max, i_c)):
            continue
        out.append([jstext.to_precision_8(v) for v in (p[i_d] * f, p[i_c] / age_divisor, p[i_min] / age_divisor, p[i_max] / age_divisor)])
    return out if len(out) >= 2 else None


CELLS = ["1", "2", "3", "10", "2.5", "-0", "0", "1e1", "0x2", ".5", "5.", "Infinity", "-Infinity", "NaN", "1_0", "x", "", "1,5",
         "depth", "Depth", "age", "AGE", "min", "max", "median", "mean", "prof", "edad", "cal", "z", "lower", "upper", "age_min", "agemax",
         "97.5", "2,5", "İ", "K", '"1"', '"depth"', "#", " ", "1 2"]
SEPARATORS = [",", ";", "\t", " ", "  ", ", ", " ; ", ";;", "\t\t", " ", " ", ",,", " \t "]
ENDINGS = ["\n", "\r\n", "\r", "\n\n", "\n#c\n"]


def random_text(rng, header_names=False):
    lines = []
    for _ in range(rng.randrange(1, 9)):
        cells = [rng.choice(CELLS[:16] if not header_names or lines else CELLS) for _ in range(rng.randrange(1, 6))]
        separator = rng.choice(SEPARATORS)
        lines.append(separator.join(cells) + rng.choice(ENDINGS))
    return "".join(lines)


@pytest.mark.parametrize("seed", range(60))
def test_age_model_equals_a_transcription_of_parse_age_model_detailed_on_random_texts(seed):
    rng = random.Random(seed)
    for _ in range(60):
        text = random_text(rng, header_names=rng.random() < 0.6)
        if not text.encode("utf-8"):
            continue
        want, got = parse_age_model_js(text), age_model(text)
        assert got.summary["rows"] == want["rows"] and got.summary["issue"] == want["issue"], ascii(text)
        if want["issue"]:
            assert got.summary["issue_depth"] == want["issue_depth"], ascii(text)
        if not want["rows"]:
            continue
        names = ["depth", "age"] + (["age_min", "age_max"] if "age_min" in want else [])
        assert [c["name"] for c in got.tables["model"]["columns"]] == names, ascii(text)
        for k, name in enumerate(names):
            assert np.array_equal(bits(got.columns["model_values"][k]), bits(want[name])), (ascii(text), name)
        assert (got.summary["reversals"], got.summary["range_ignored"], got.summary["bacon"]) == (want["reversals"], want["range_ignored"], want["bacon"])


@pytest.mark.parametrize("seed", range(30))
def test_bacon_equals_a_transcription_of_bacon_to_age_text_on_random_texts(seed):
    rng = random.Random(seed)
    for _ in range(40):
        header = rng.choice(SEPARATORS).join(rng.sample(["depth", "min", "max", "median", "mean", "Depth", '"min"', "x", "MEAN"], rng.randrange(3, 7)))
        text = header + rng.choice(ENDINGS) + random_text(rng)
        settings = {"version": 1, "center": rng.choice(["median", "mean"]), "depth_unit": rng.choice(["mm", "cm", "m"]),
                    "age_divisor": rng.choice([1, 1000, 1_000_000])}
        want = bacon_js(text, settings["center"], settings["depth_unit"], settings["age_divisor"]) or []
        got = bacon(text, settings)
        assert got.summary == {"rows": len(want)}, ascii(text)
        expected = np.array(want, dtype="<f8").reshape(-1, 4).T
        assert np.array_equal(bits(np.where(np.isfinite(expected), expected, 0.0)), bits(got.columns["rows_values"])), ascii(text)
        assert np.array_equal(np.isfinite(expected).astype("u1"), got.columns["rows_valid"]), ascii(text)


# ---- rules of the contract that the fixtures do not isolate ---------------------------------------------------------------------

def test_a_leading_byte_order_mark_is_a_character_and_whitespace():
    assert age_model("﻿depth,age\n1,2\n3,4\n").summary["rows"] == 2
    assert age_model("﻿1;2\n3;4\n").columns["model_values"].tolist() == [[1.0, 3.0], [2.0, 4.0]]


def test_cells_of_a_semicolon_line_follow_the_ecmascript_split():
    # `;;` and `; ;` leave an empty cell (NaN: not a range); a run of tabs or whitespace around one `;` is one separator
    result = age_model("1\t\t2\t \t1\t3\n5 ; 6 ;\t5;8\n")
    assert result.columns["model_values"].tolist() == [[1.0, 5.0], [2.0, 6.0], [1.0, 5.0], [3.0, 8.0]]
    assert age_model("1;2;;4\n5;6; ;8\n").summary["rows"] == 2 and age_model("1;2;;4\n5;6; ;8\n").tables["model"]["columns"][2:] == []
    assert age_model("1 000,5;2\n3;4\n").columns["model_values"][0].tolist() == [3.0, 1000.5]


def test_an_absent_and_an_empty_range_cell_are_different_rows():
    result = age_model("5,10\n5,10,\n7,8\n")
    assert (result.summary["issue"], result.summary["issue_depth"]) == ("dupDepth", 5.0)


# ---- refusals naming the field ---------------------------------------------------------------------------------------------------

def refused(call, code, field):
    with pytest.raises(MethodError) as caught:
        call()
    assert (caught.value.code, caught.value.field) == (code, field)


@pytest.mark.parametrize("data", [b"\xff", b"1,2\n\x80", b"\xc0\xaf", b"\xe0\x80\x80", b"\xed\xa0\x80", b"\xed\xbf\xbf", b"\xf4\x90\x80\x80",
                                  b"\xf5\x80\x80\x80", b"1,2\n3,\xe2\x82"])
def test_text_that_is_not_strict_utf8_is_unsupported_input(data):
    array = np.frombuffer(data, dtype="u1")
    refused(lambda: age_model(array), "UNSUPPORTED_INPUT", "text")
    refused(lambda: bacon(array), "UNSUPPORTED_INPUT", "table_text")


def test_a_text_of_4_mib_is_read_and_one_byte_more_is_limit_exceeded():
    text = "0 1\n1 2\n" + " " * (4 * MiB - 8)
    assert age_model(text).summary["rows"] == 2
    refused(lambda: age_model(text + " "), "LIMIT_EXCEEDED", "text")
    refused(lambda: bacon(text + " "), "LIMIT_EXCEEDED", "table_text")


@pytest.mark.parametrize("value", [np.zeros((2, 2), dtype="u1"), np.zeros(3, dtype="<f8"), np.zeros(0, dtype="u1"), b"1 2", "1 2", None])
def test_a_text_of_another_dtype_or_rank_is_invalid_buffer(value):
    refused(lambda: core_age_model.parse({"settings": {"version": 1}, "text": value}), "INVALID_BUFFER", "text")
    refused(lambda: core_bacon.parse({"settings": BACON_SETTINGS, "table_text": value}), "INVALID_BUFFER", "table_text")


def test_age_model_settings_are_exactly_version_1_and_the_input_names_are_closed():
    for value, code in (({"version": 2}, "UNSUPPORTED_INPUT"), ({"version": True}, "UNSUPPORTED_INPUT"), ({"version": 1, "extra": 1}, "INVALID_REQUEST"),
                        ({}, "INVALID_REQUEST"), (None, "INVALID_REQUEST"), ([1], "INVALID_REQUEST")):
        refused(lambda value=value: core_age_model.parse({"settings": value, "text": u8("1 2")}), code, "settings")
    refused(lambda: core_age_model.parse({"settings": {"version": 1}}), "INVALID_REQUEST", "inputs")
    refused(lambda: core_age_model.parse({"settings": {"version": 1}, "text": u8("1"), "extra": u8("1")}), "INVALID_REQUEST", "inputs")


def test_bacon_settings_name_the_field_at_fault():
    def parse(settings):
        return lambda: core_bacon.parse({"settings": settings, "table_text": u8("depth min max median mean")})
    for value, code, field in (
            (None, "INVALID_REQUEST", "settings"), ({**BACON_SETTINGS, "extra": 1}, "INVALID_REQUEST", "settings"),
            ({k: v for k, v in BACON_SETTINGS.items() if k != "version"}, "INVALID_REQUEST", "settings"),
            ({**BACON_SETTINGS, "version": 2}, "UNSUPPORTED_INPUT", "settings"), ({**BACON_SETTINGS, "version": True}, "UNSUPPORTED_INPUT", "settings"),
            ({k: v for k, v in BACON_SETTINGS.items() if k != "center"}, "INVALID_REQUEST", "settings.center"),
            ({**BACON_SETTINGS, "center": "Median"}, "INVALID_REQUEST", "settings.center"),
            ({**BACON_SETTINGS, "center": "max"}, "INVALID_REQUEST", "settings.center"),
            ({k: v for k, v in BACON_SETTINGS.items() if k != "depth_unit"}, "INVALID_REQUEST", "settings.depth_unit"),
            ({**BACON_SETTINGS, "depth_unit": "km"}, "INVALID_REQUEST", "settings.depth_unit"),
            ({k: v for k, v in BACON_SETTINGS.items() if k != "age_divisor"}, "INVALID_REQUEST", "settings.age_divisor"),
            ({**BACON_SETTINGS, "age_divisor": 100}, "INVALID_REQUEST", "settings.age_divisor"),
            ({**BACON_SETTINGS, "age_divisor": "1000"}, "INVALID_REQUEST", "settings.age_divisor"),
            ({**BACON_SETTINGS, "age_divisor": True}, "INVALID_REQUEST", "settings.age_divisor")):
        refused(parse(value), code, field)
    assert core_bacon.parse({"settings": {**BACON_SETTINGS, "age_divisor": 1000.0}, "table_text": u8("x")}).age_divisor == 1000
    refused(lambda: core_bacon.parse({"settings": BACON_SETTINGS}), "INVALID_REQUEST", "inputs")


# ---- hostile texts: refused as the contract names, or read within the interactive deadline ----------------------------------------

def timed(call):
    started = time.perf_counter()
    result = call()
    elapsed = time.perf_counter() - started
    assert elapsed < specs.INTERACTIVE_DEADLINE, f"{elapsed:.1f} s is beyond the job deadline"
    return result, elapsed


HOSTILE = {
    "one line of 4 MiB": lambda: "1 " * (2 * MiB),
    "one line of 4 MiB with semicolons": lambda: ";" * (4 * MiB),
    "4 MiB of NUL bytes": lambda: "\x00" * (4 * MiB),
    "100,000 header-like lines": lambda: "depth,age,min,max\n" * 100_000,
    "4 MiB of line ends": lambda: "\n" * (4 * MiB),
}


@pytest.mark.parametrize("name", list(HOSTILE))
def test_hostile_texts_are_read_within_the_interactive_deadline(name):
    text = HOSTILE[name]()
    result, elapsed = timed(lambda: age_model(text))
    assert result.summary == {"rows": 0, "reversals": 0, "range_ignored": 0, "bacon": False, "issue": None, "issue_depth": None}
    result, elapsed_bacon = timed(lambda: bacon(text))
    assert result.summary == {"rows": 0}
    print(f"{name}: age model {elapsed:.2f} s, bacon {elapsed_bacon:.2f} s")


def test_a_nul_inside_a_cell_makes_it_not_a_number_and_does_not_end_the_text():
    assert age_model("1,2\n3\x00,4\n5,6\n").columns["model_values"].tolist() == [[1.0, 5.0], [2.0, 6.0]]


LARGEST_FOUR_COLUMNS = validation.MAX_TABLE_DATA_BYTES // (4 * 9)          # 233,016 rows: 9 bytes per cell (contract §4 "Tables")


def ranged_age_text(rows):
    return "".join(f"{k} 0 0 0\n" for k in range(rows))      # distinct depths, a range that contains the age: four columns kept


def bacon_text(rows):
    return "depth,min,max,median,mean\n" + "0,0,0,0,0\n" * rows


def test_the_largest_output_table_is_read_and_one_row_more_is_limit_exceeded():
    assert LARGEST_FOUR_COLUMNS == 233_016 and specs.MAX_TABLE_DATA_BYTES == validation.MAX_TABLE_DATA_BYTES
    result = age_model(ranged_age_text(LARGEST_FOUR_COLUMNS))
    assert result.summary["rows"] == LARGEST_FOUR_COLUMNS and result.columns["model_values"].shape == (4, LARGEST_FOUR_COLUMNS)
    assert bacon(bacon_text(LARGEST_FOUR_COLUMNS)).summary == {"rows": LARGEST_FOUR_COLUMNS}
    refused(lambda: age_model(ranged_age_text(LARGEST_FOUR_COLUMNS + 1)), "LIMIT_EXCEEDED", "text")
    refused(lambda: bacon(bacon_text(LARGEST_FOUR_COLUMNS + 1)), "LIMIT_EXCEEDED", "table_text")


def test_texts_whose_table_exceeds_the_limits_are_limit_exceeded():
    refused(lambda: age_model(ranged_age_text(300_000)), "LIMIT_EXCEEDED", "text")
    refused(lambda: bacon(bacon_text(400_000)), "LIMIT_EXCEEDED", "table_text")


def test_cancellation_is_polled_while_reading_and_leaves_no_result():
    polls = []

    def cancelled():
        polls.append(1)
        return len(polls) > 2
    with pytest.raises(Cancelled):
        core_age_model.run(core_age_model.parse({"settings": {"version": 1}, "text": u8("1 2\n" * 20_000)}), cancelled=cancelled)
    polls.clear()
    with pytest.raises(Cancelled):
        core_bacon.run(core_bacon.parse({"settings": BACON_SETTINGS, "table_text": u8("depth min max median\n" + "1 2 3 4\n" * 20_000)}),
                       cancelled=cancelled)


def test_the_methods_are_registered_and_agree_with_the_method_table():
    for module, name, text_input, table in ((core_age_model, specs.CORE_AGE_MODEL, "text", "model"), (core_bacon, specs.CORE_BACON, "table_text", "rows")):
        entry = specs.METHOD_SPECS[name]
        assert registry.get(name) is module and module.NAME == name and entry.inputs is specs.METHOD_INPUTS[name]
        assert set(entry.inputs) == set(module.INPUT_NAMES) == {"settings", text_input}
        assert entry.inputs[text_input] == ("u8", 1, True) and entry.inputs["settings"] == ("utf8json", 1, True)
        assert (entry.scope, entry.priorities, entry.families, entry.same_shape, entry.dimensions, entry.tables) == \
            ("core", ("interactive",), (), (), ("rows",), (table,))
    assert core_age_model.MAX_TEXT_BYTES == 4 * MiB


# ---- transport through the real coordinator and worker ---------------------------------------------------------------------------

@pytest.fixture
def engine():
    coordinator, session = new_coordinator()
    try:
        yield coordinator, session
    finally:
        coordinator.close()


def text_job(coordinator, session, method, text, settings=None, *, target=None, revision=1, rank=1):
    data = text.encode("utf-8") if isinstance(text, str) else text
    name = "text" if method == specs.CORE_AGE_MODEL else "table_text"
    settings = settings or ({"version": 1} if method == specs.CORE_AGE_MODEL else BACON_SETTINGS)
    handle = put_json(coordinator, settings)
    shape = [len(data)] if rank == 1 else [1, len(data)]
    inputs = {"settings": handle, name: put(coordinator, data, "u8", shape)}
    return run(session, method, "core", inputs, coordinator.store.buffers[handle].expected_hash, target=target, revision=revision)


def answer(coordinator, job):
    coordinator.receive(job)
    run_until_idle(coordinator)
    return frames(coordinator)[0][job["id"]]


@pytest.mark.parametrize("name", ["age-header-english", "age-range-swapped", "age-negative-zero-first", "age-dup-depth", "age-comments-only",
                                  "age-large-10000"])
def test_age_model_fixtures_through_method_run_of_the_real_coordinator_and_worker(engine, name):
    coordinator, session = engine
    case = load(name)
    response = answer(coordinator, text_job(coordinator, session, specs.CORE_AGE_MODEL, case["inputs"]["text"], revision=5))
    assert response["status"] == "ok", response
    result = response["result"]
    assert (result["method"], result["scope"], result["revision"]) == ("core.age_model/1", "core", 5)
    assert_age_matches(case, result["dimensions"], download(coordinator, session, result) or
                       {"model_values": np.zeros((2, 0)), "model_valid": np.zeros((2, 0), dtype="u1")}, result["tables"], result["summary"])
    assert unpinned(coordinator)


@pytest.mark.parametrize("name", ["bacon-median-cm-ka", "bacon-rounding-ties", "bacon-depth-overflow-mm", "bacon-no-min-column", "bacon-large-10000"])
def test_bacon_fixtures_through_method_run_of_the_real_coordinator_and_worker(engine, name):
    coordinator, session = engine
    case = load(name)
    response = answer(coordinator, text_job(coordinator, session, specs.CORE_BACON, case["inputs"]["table_text"], case["inputs"]["settings"]))
    assert response["status"] == "ok", response
    result = response["result"]
    assert (result["method"], result["scope"]) == ("core.bacon/1", "core")
    assert_bacon_matches(case, result["dimensions"], download(coordinator, session, result) or
                         {"rows_values": np.zeros((4, 0)), "rows_valid": np.zeros((4, 0), dtype="u1")}, result["tables"], result["summary"])
    assert unpinned(coordinator)


@pytest.mark.parametrize("method, size, code, field", [
    (specs.CORE_AGE_MODEL, None, "UNSUPPORTED_INPUT", "text"),
    (specs.CORE_BACON, None, "UNSUPPORTED_INPUT", "table_text"),
    (specs.CORE_AGE_MODEL, 4 * MiB + 1, "LIMIT_EXCEEDED", "text"),
    (specs.CORE_BACON, 4 * MiB + 1, "LIMIT_EXCEEDED", "table_text"),
])
def test_a_refusal_reaches_the_client_naming_the_field(engine, method, size, code, field):
    data = b"1 2\n\xed\xa0\x80" if size is None else b" " * size          # an encoded surrogate, or one byte beyond 4 MiB
    coordinator, session = engine
    error = answer(coordinator, text_job(coordinator, session, method, data))["error"]
    assert (error["code"], error["details"]) == (code, {"field": field}) and unpinned(coordinator)


@pytest.mark.parametrize("method, rows, field", [(specs.CORE_AGE_MODEL, 300_000, "text"), (specs.CORE_BACON, 400_000, "table_text")])
def test_a_table_beyond_the_limits_is_limit_exceeded_through_the_coordinator_not_internal(engine, method, rows, field):
    coordinator, session = engine
    text = ranged_age_text(rows) if method == specs.CORE_AGE_MODEL else bacon_text(rows)
    error = answer(coordinator, text_job(coordinator, session, method, text))["error"]
    assert (error["code"], error["details"]) == ("LIMIT_EXCEEDED", {"field": field}) and unpinned(coordinator)


@pytest.mark.parametrize("method", [specs.CORE_AGE_MODEL, specs.CORE_BACON])
def test_the_largest_table_passes_through_the_coordinator(engine, method):
    coordinator, session = engine
    text = ranged_age_text(LARGEST_FOUR_COLUMNS) if method == specs.CORE_AGE_MODEL else bacon_text(LARGEST_FOUR_COLUMNS)
    response = answer(coordinator, text_job(coordinator, session, method, text))
    assert response["status"] == "ok", response
    assert response["result"]["dimensions"] == {"rows": LARGEST_FOUR_COLUMNS} and response["result"]["tables"][specs.METHOD_SPECS[method].tables[0]]["rows"] == LARGEST_FOUR_COLUMNS
    assert unpinned(coordinator)


def test_a_text_of_rank_2_is_invalid_buffer_at_the_coordinator(engine):
    coordinator, session = engine
    error = answer(coordinator, text_job(coordinator, session, specs.CORE_AGE_MODEL, "1 2\n3 4", rank=2))["error"]
    assert (error["code"], error["details"]) == ("INVALID_BUFFER", {"field": "text"})


def test_a_waiting_job_is_cancelled_and_a_newer_revision_supersedes_the_older_ones(engine):
    coordinator, session = engine
    slow = "x y\n" * MiB                                       # a million lines of 4 MiB: seconds of reading, polled every 4096 lines
    target, other = str(uuid4()), str(uuid4())
    running = text_job(coordinator, session, specs.CORE_AGE_MODEL, slow, target=target, revision=1)
    waiting_cancel = text_job(coordinator, session, specs.CORE_AGE_MODEL, slow, target=other)
    waiting_old = text_job(coordinator, session, specs.CORE_AGE_MODEL, slow, target=target, revision=2)
    newest = text_job(coordinator, session, specs.CORE_AGE_MODEL, "depth;age\n1;2\n3;1\n", target=target, revision=3)
    coordinator.receive(running)
    coordinator.receive(waiting_cancel)
    coordinator.receive(request(session, "job.cancel", {"request_id": waiting_cancel["id"]}))
    assert frames(coordinator)[0][waiting_cancel["id"]]["status"] == "cancelled"
    coordinator.receive(waiting_old)                           # supersedes the running job of the same target
    coordinator.receive(newest)                                # supersedes the waiting job: answered `cancelled` at once
    assert frames(coordinator)[0][waiting_old["id"]]["status"] == "cancelled"
    run_until_idle(coordinator)
    responses = frames(coordinator)[0]
    assert responses[running["id"]]["status"] == "cancelled", "the running job polls the cancellation while it reads"
    result = responses[newest["id"]]["result"]
    assert responses[newest["id"]]["status"] == "ok" and result["revision"] == 3
    assert result["summary"] == {"rows": 2, "reversals": 1, "range_ignored": 0, "bacon": False, "issue": None, "issue_depth": None}
    assert download(coordinator, session, result)["model_values"].tolist() == [[1.0, 3.0], [2.0, 1.0]]
    assert unpinned(coordinator)
