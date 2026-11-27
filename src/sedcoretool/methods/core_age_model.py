"""Engine method ``core.age_model/1``: a core's age model read from its age-model text.

Contract: docs/roadmap-engine-contract.md §9.11. The reference results are the fixtures of ``tests/fixtures/age_model`` (``age-*.json``),
made by the JavaScript calculation this method replaces (``parseAgeModelDetailed`` of ``app/js/core.js``); every value is
bit-identical to it (decision Y4), ``-0`` included. Malformed lines and cells are never refusals: they are dropped as JavaScript
drops them. Only the text itself is refused (not UTF-8, longer than 4 MiB) and the settings.

The reader is linear in the length of the text: lines and cells are produced one at a time, a data line is split only as far as
the columns it needs, and numbers are read with ``kernels/jstext.py`` (ECMAScript ``StringToNumber``), never with ``float()``.
"""

from __future__ import annotations

import re
from array import array
from dataclasses import dataclass
from itertools import islice

import numpy as np

from ..kernels.jstext import WHITESPACE_RUN, iter_lines, iter_pieces, iter_split, lower_ascii, string_to_number, trim
from .core_ages import _settings
from .errors import Cancelled
from .validation import MAX_TABLE_DATA_BYTES, MAX_TABLE_ROWS, buffer, fail

NAME = "core.age_model/1"
INPUT_NAMES = ("settings", "text")
MAX_TEXT_BYTES = 4 * 1_048_576          # the metadata cap of contract §3
CANCEL_EVERY = 4096                     # lines read between two polls of the cancellation

DEPTH_NAME = re.compile(r"(depth|prof|mcd|mbsf|cmcd|ccsf|z)")
AGE_NAME = re.compile(r"(age|edad|median|mean|cal)")
MIN_NAME = re.compile(r"(min|lower|low|age_?min|2\.5)")
MAX_NAME = re.compile(r"(max|upper|high|age_?max|97\.5)")
BACON_NAMES = frozenset(("depth", "min", "max", "median", "mean"))


@dataclass
class Snapshot:
    """Validated inputs: the decoded text."""
    text: str


@dataclass
class Result:
    """``dimensions`` = rows. ``columns`` holds the cells of the table ``model`` (``model_values`` f64 [columns, rows] and
    ``model_valid`` u8, all 1); ``tables`` describes it (contract §9.3) and ``summary`` is ``{"rows", "reversals", "range_ignored",
    "bacon", "issue", "issue_depth"}``."""
    dimensions: dict
    columns: dict
    tables: dict
    summary: dict


def decoded_text(value, field: str) -> str:
    """A text input (contract §9.11): ``u8`` rank 1, 1 byte to 4 MiB, strict UTF-8. A leading U+FEFF stays a character."""
    data = buffer(value, field, "u1", 1)
    if data.size > MAX_TEXT_BYTES:
        fail("LIMIT_EXCEEDED", field)
    try:
        return data.tobytes().decode("utf-8", "strict")     # refuses surrogates, overlong forms and code points above U+10FFFF
    except UnicodeDecodeError:
        fail("UNSUPPORTED_INPUT", field)


def output_within_limits(columns: int, rows: int, field: str) -> None:
    """Refuse, naming the text input, a result table beyond the limits of contract §4 "Tables" (the constants of
    ``validation.py``, which ``tests/test_engine_method_run.py`` keeps equal to those the coordinator checks in ``specs.py``), so that
    a long text is a visible ``LIMIT_EXCEEDED`` rather than an ``INTERNAL`` answer to an output the coordinator would not accept."""
    if rows > MAX_TABLE_ROWS or columns * rows * 9 > MAX_TABLE_DATA_BYTES:
        fail("LIMIT_EXCEEDED", field)


def parse(inputs: dict, *, hashes: dict | None = None, memo: dict | None = None, derived: dict | None = None) -> Snapshot:
    """Validate ``inputs`` (contract §9.11) and return a ``Snapshot``; raises ``MethodError`` naming the field at fault."""
    if not isinstance(inputs, dict) or set(inputs) != set(INPUT_NAMES):
        fail("INVALID_REQUEST", "inputs")
    _settings(inputs["settings"])
    return Snapshot(decoded_text(inputs["text"], "text"))


# ---- cells of one line ------------------------------------------------------------------------------------------------------

def _semicolon_cells(line: str):
    """``line.split(/\\s*[;\\t]\\s*/)`` with every whitespace character removed from each cell and its first ``,`` made ``.``.

    In that split every ``;`` is one separator and takes the whitespace on both sides of it; a run of whitespace that touches no
    ``;`` is one separator when it holds a tab and otherwise lies inside a cell, whose whitespace is removed anyway. So each run
    of whitespace becomes ``;`` (a run with a tab touching no ``;``) or nothing, and the result is split at ``;``."""
    size = len(line)

    def run(match):
        start, end = match.span()
        if (start > 0 and line[start - 1] == ";") or (end < size and line[end] == ";"):
            return ""
        return ";" if "\t" in match.group() else ""

    for cell in iter_pieces(WHITESPACE_RUN.sub(run, line), ";"):
        yield cell.replace(",", ".", 1)


def iter_cells(line: str):
    """The cells of a trimmed line, as ``core.js::parseAgeModelDetailed``'s ``split`` makes them, one at a time."""
    if ";" in line or "\t" in line:
        return _semicolon_cells(line)
    if "," in line:
        return (trim(cell) for cell in iter_pieces(line, ","))      # /\s*,\s*/: the whitespace next to each comma is the separator's
    return iter_split(line, WHITESPACE_RUN)


def _number(cell: str) -> float:
    return float("nan") if cell == "" else string_to_number(cell)


def _finite(value) -> bool:
    return value is not None and value - value == 0


def _header(line: str):
    """The column positions of a header line, or None when the line is not a header (contract §9.11, "Header")."""
    count, text_cell, bacon = 0, False, set()
    found = {DEPTH_NAME: -1, AGE_NAME: -1, MIN_NAME: -1, MAX_NAME: -1}
    for index, raw in enumerate(iter_cells(line)):
        cell = lower_ascii(raw.replace('"', ""))
        count += 1
        if not text_cell and cell and not _finite(string_to_number(cell)):
            text_cell = True
        for name, position in found.items():
            if position < 0 and name.match(cell):
                found[name] = index
        if cell in BACON_NAMES:
            bacon.add(cell)
    if count < 2 or not text_cell:
        return None
    depth = found[DEPTH_NAME] if found[DEPTH_NAME] >= 0 else 0
    age = found[AGE_NAME] if found[AGE_NAME] >= 0 else (1 if depth == 0 else 0)
    return depth, age, found[MIN_NAME], found[MAX_NAME], bacon == BACON_NAMES


# ---- the reader --------------------------------------------------------------------------------------------------------------

def _js_min(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """``Math.min`` of finite values element by element: -0 is less than +0."""
    equal = np.where(np.signbit(a) | np.signbit(b), -np.abs(a), a)
    return np.where(a < b, a, np.where(b < a, b, equal))


def _js_max(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """``Math.max`` of finite values element by element: +0 is greater than -0."""
    equal = np.where(np.signbit(a) & np.signbit(b), a, np.abs(a))
    return np.where(a > b, a, np.where(b > a, b, equal))


def _same_cells(values: np.ndarray, absent: np.ndarray) -> np.ndarray:
    """For each row after the first, whether its range cell equals the previous row's: equal numbers, both not a number, or both
    absent (``v === w || both NaN``, where an absent cell is ``undefined``)."""
    v, w = values[1:], values[:-1]
    both_absent, one_absent = absent[1:] & absent[:-1], absent[1:] != absent[:-1]
    return both_absent | (~one_absent & ((v == w) | (np.isnan(v) & np.isnan(w))))


def read_age_model(text: str, cancelled=lambda: False) -> dict:
    """``parseAgeModelDetailed(text)`` as arrays: ``{"depth", "age", "age_min", "age_max"}`` (the range None when it is not kept) and
    the summary fields. Raises ``Cancelled`` when ``cancelled()`` turns true between blocks of lines."""
    depth, age, low, high = array("d"), array("d"), array("d"), array("d")
    low_absent, high_absent = bytearray(), bytearray()
    columns = (0, 1, 2, 3)
    named = bacon = False
    first = True
    for count, raw in enumerate(iter_lines(text)):
        if count % CANCEL_EVERY == 0 and cancelled():
            raise Cancelled()
        line = trim(raw)
        if not line or line[0] == "#":
            continue
        if first:
            first = False
            header = _header(line)
            if header is not None:
                columns, bacon, named = header[:4], header[4], True
                continue
        i_depth, i_age, i_min, i_max = columns
        cells = list(islice(iter_cells(line), max(columns) + 1))
        d = _number(cells[i_depth]) if i_depth < len(cells) else None
        a = _number(cells[i_age]) if i_age < len(cells) else None
        if not (_finite(d) and _finite(a)):
            continue
        depth.append(d)
        age.append(a)
        for index, values, absent in ((i_min, low, low_absent), (i_max, high, high_absent)):
            if index < 0:
                values.append(float("nan"))                   # no such column: not a number
                absent.append(0)
            elif index < len(cells):
                values.append(_number(cells[index]))
                absent.append(0)
            else:
                values.append(float("nan"))                   # a short line: undefined
                absent.append(1)
    return _model(np.frombuffer(depth, dtype="<f8"), np.frombuffer(age, dtype="<f8"), np.frombuffer(low, dtype="<f8"),
                  np.frombuffer(high, dtype="<f8"), np.frombuffer(bytes(low_absent), dtype="u1").astype(bool),
                  np.frombuffer(bytes(high_absent), dtype="u1").astype(bool), named=named and columns[2] >= 0 and columns[3] >= 0, bacon=bacon)


def _model(depth, age, low, high, low_absent, high_absent, *, named: bool, bacon: bool) -> dict:
    """Sort, merge identical rows, find a depth with two different rows, then keep or drop the range (contract §9.11)."""
    none = {"depth": depth[:0], "age": age[:0], "age_min": None, "age_max": None, "reversals": 0, "range_ignored": 0, "bacon": False}
    order = np.lexsort((age, depth))                          # stable: depth, then age; -0 equals 0
    depth, age, low, high = depth[order], age[order], low[order], high[order]
    low_absent, high_absent = low_absent[order], high_absent[order]
    equal_depth = depth[1:] == depth[:-1]
    same = (age[1:] == age[:-1]) & _same_cells(low, low_absent) & _same_cells(high, high_absent)
    different = np.flatnonzero(equal_depth & ~same)
    if different.size:
        issue_depth = float(depth[different[-1] + 1])          # the largest depth with two different rows
        return {**none, "issue": "dupDepth", "issue_depth": issue_depth + 0.0}     # -0 is written 0
    keep = np.concatenate(([True], ~equal_depth)) if depth.size else np.zeros(0, dtype=bool)
    depth, age, low, high = depth[keep], age[keep], low[keep], high[keep]
    if depth.size < 2:
        return {**none, "issue": None, "issue_depth": None}
    with np.errstate(invalid="ignore"):
        finite = np.isfinite(low) & np.isfinite(high)
        lo, hi = _js_min(low, high), _js_max(low, high)
        bad = int(np.count_nonzero(~finite | (age < lo) | (age > hi)))
    model = {"depth": depth, "age": age, "age_min": None, "age_max": None, "issue": None, "issue_depth": None,
             "reversals": int(np.count_nonzero(age[1:] < age[:-1])), "range_ignored": bad if (bad and named) else 0, "bacon": bacon}
    if not bad:
        model["age_min"], model["age_max"] = lo, hi
    return model


def run(snapshot: Snapshot, report=lambda stage, completed, total: None, cancelled=lambda: False, *, memo: dict | None = None) -> Result:
    """Read the age model. Cancellation is polled every ``CANCEL_EVERY`` lines; no partial result exists."""
    if cancelled():
        raise Cancelled()
    model = read_age_model(snapshot.text, cancelled)
    series = [("depth", model["depth"]), ("age", model["age"])]
    if model["age_min"] is not None:
        series += [("age_min", model["age_min"]), ("age_max", model["age_max"])]
    rows = int(model["depth"].size)
    output_within_limits(len(series), rows, "text")
    values = np.zeros((len(series), rows), dtype="<f8")
    for k, (_, column) in enumerate(series):
        values[k] = column
    valid = np.ones(values.shape, dtype="u1")
    report("reading", 1, 1)
    description = {"version": 1, "rows": rows, "columns": [{"name": name, "unit": ""} for name, _ in series]}
    summary = {"rows": rows, "reversals": model["reversals"], "range_ignored": model["range_ignored"], "bacon": bool(model["bacon"]),
               "issue": model["issue"], "issue_depth": model["issue_depth"]}
    return Result({"rows": rows}, {"model_values": values, "model_valid": valid}, {"model": description}, summary)
