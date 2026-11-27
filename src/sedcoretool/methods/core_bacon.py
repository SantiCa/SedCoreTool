"""Engine method ``core.bacon/1``: the numbers of the age-model text that a Bacon age-depth table becomes.

Contract: docs/roadmap-engine-contract.md §9.11. The reference results are the fixtures of ``tests/fixtures/age_model`` (``bacon-*.json``),
made by the JavaScript calculation this method replaces (``baconToAgeText`` of ``app/js/core.js``); every value is bit-identical to
it (decision Y4). The page writes the text lines from these numbers (``Number::toString`` of each); that is not this method's job.

The reader is linear in the length of the text: lines and cells are produced one at a time, a data line is split only as far as
the columns it needs, numbers are read with ``kernels/jstext.py`` (ECMAScript ``StringToNumber``) and rounded with its
``to_precision_8`` (``Number(x.toPrecision(8))``, ties away from zero).
"""

from __future__ import annotations

import math
import re
from array import array
from dataclasses import dataclass
from itertools import islice

import numpy as np

from ..kernels.jstext import iter_lines, iter_split, lower_ascii, string_to_number, to_precision_8, trim
from .core_age_model import CANCEL_EVERY, decoded_text, output_within_limits
from .errors import Cancelled
from .validation import fail

NAME = "core.bacon/1"
INPUT_NAMES = ("settings", "table_text")
SETTINGS_FIELDS = ("version", "center", "depth_unit", "age_divisor")
CENTERS = ("median", "mean")
UNIT_TO_CM = {"mm": 0.1, "cm": 1.0, "m": 100.0}           # core.js::UNIT_TO_CM
AGE_UNITS = {1: "a", 1000: "ka", 1_000_000: "Ma"}           # age divisor -> unit of the age columns
SEPARATORS = re.compile(r"[,;\t ]+")
COLUMNS = ("depth", "age", "age_min", "age_max")
HEADER_NAMES = frozenset(("depth", "min", "max", "median", "mean"))


@dataclass
class Snapshot:
    """Validated inputs."""
    text: str
    center: str
    depth_unit: str
    age_divisor: int


@dataclass
class Result:
    """``dimensions`` = rows. ``columns`` holds the cells of the table ``rows`` (``rows_values`` f64 [4, rows] and ``rows_valid`` u8,
    0 where a converted value is not finite); ``tables`` describes it (contract §9.3) and ``summary`` is ``{"rows"}``."""
    dimensions: dict
    columns: dict
    tables: dict
    summary: dict


def _settings(value) -> tuple[str, str, int]:
    if not isinstance(value, dict) or not set(value) <= set(SETTINGS_FIELDS) or "version" not in value:
        fail("INVALID_REQUEST", "settings")
    if type(value["version"]) is not int or value["version"] != 1:
        fail("UNSUPPORTED_INPUT", "settings")
    center, unit, divisor = value.get("center"), value.get("depth_unit"), value.get("age_divisor")
    if type(center) is not str or center not in CENTERS:
        fail("INVALID_REQUEST", "settings.center")
    if type(unit) is not str or unit not in UNIT_TO_CM:
        fail("INVALID_REQUEST", "settings.depth_unit")
    if type(divisor) not in (int, float) or divisor not in AGE_UNITS:      # a JSON number: 1, 1000 or 1000000 (bool is refused)
        fail("INVALID_REQUEST", "settings.age_divisor")
    return center, unit, int(divisor)


def parse(inputs: dict, *, hashes: dict | None = None, memo: dict | None = None, derived: dict | None = None) -> Snapshot:
    """Validate ``inputs`` (contract §9.11) and return a ``Snapshot``; raises ``MethodError`` naming the field at fault."""
    if not isinstance(inputs, dict) or set(inputs) != set(INPUT_NAMES):
        fail("INVALID_REQUEST", "inputs")
    center, unit, divisor = _settings(inputs["settings"])
    return Snapshot(decoded_text(inputs["table_text"], "table_text"), center, unit, divisor)


def _cells(line: str, wanted: int) -> list[str]:
    """The first ``wanted`` cells of ``line.trim().split(/[,;\\t ]+/)``."""
    return list(islice(iter_split(trim(line), SEPARATORS), wanted))


def read_bacon(text: str, center: str, depth_unit: str, age_divisor: int, cancelled=lambda: False) -> np.ndarray:
    """``baconToAgeText`` as numbers: float64 [4, rows] (depth, age, age_min, age_max), rows in file order; 0 rows when the header
    lacks a column or fewer than 2 lines are kept. A value that is not finite after conversion stays as it is (±Infinity)."""
    empty = np.zeros((4, 0), dtype="<f8")
    lines = (line for line in iter_lines(text) if trim(line))
    header = next(lines, None)
    if header is None:
        return empty
    positions = {}                                            # the first position of each name the reader looks for
    for index, name in enumerate(iter_split(lower_ascii(trim(header).replace('"', "")), SEPARATORS)):
        if name in HEADER_NAMES and name not in positions:
            positions[name] = index
    i_depth, i_min, i_max = positions.get("depth", -1), positions.get("min", -1), positions.get("max", -1)
    i_center = positions.get(center, positions.get("median", positions.get("mean", -1)))
    if min(i_depth, i_min, i_max, i_center) < 0:
        return empty
    factor = 1 / UNIT_TO_CM[depth_unit]
    divisor = float(age_divisor)
    wanted = max(i_depth, i_min, i_max, i_center) + 1
    out = [array("d") for _ in COLUMNS]
    for count, line in enumerate(lines):
        if count % CANCEL_EVERY == 0 and cancelled():
            raise Cancelled()
        cells = _cells(line, wanted)
        if len(cells) < wanted:
            continue                                          # a missing cell is undefined: not finite
        d, c, lo, hi = (string_to_number(cells[i]) for i in (i_depth, i_center, i_min, i_max))
        if not all(math.isfinite(v) for v in (d, c, lo, hi)):
            continue
        for column, value in zip(out, (d * factor, c / divisor, lo / divisor, hi / divisor)):
            column.append(to_precision_8(value))
    if len(out[0]) < 2:
        return empty
    return np.array([np.frombuffer(column, dtype="<f8") for column in out], dtype="<f8")


def run(snapshot: Snapshot, report=lambda stage, completed, total: None, cancelled=lambda: False, *, memo: dict | None = None) -> Result:
    """Convert the table. Cancellation is polled every ``CANCEL_EVERY`` lines; no partial result exists."""
    s = snapshot
    if cancelled():
        raise Cancelled()
    converted = read_bacon(s.text, s.center, s.depth_unit, s.age_divisor, cancelled)
    output_within_limits(len(COLUMNS), int(converted.shape[1]), "table_text")
    finite = np.isfinite(converted)
    values = np.where(finite, converted, 0.0).astype("<f8")
    valid = finite.astype("u1")
    rows = int(converted.shape[1])
    report("converting", 1, 1)
    age_unit = AGE_UNITS[s.age_divisor]
    units = {"depth": s.depth_unit, "age": age_unit, "age_min": age_unit, "age_max": age_unit}
    description = {"version": 1, "rows": rows, "columns": [{"name": name, "unit": units[name]} for name in COLUMNS]}
    return Result({"rows": rows}, {"rows_values": values, "rows_valid": valid}, {"rows": description}, {"rows": rows})
