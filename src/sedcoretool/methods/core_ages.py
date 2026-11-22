"""Engine method ``core.ages/1``: the age model of a core applied to the depths of its rows.

Contract: docs/roadmap-engine-contract.md §9.8. The reference results are the fixtures of ``tests/fixtures/core_ages``, made by the
JavaScript calculation this method replaces (``interpAge`` and ``interpAgeRange`` of ``app/js/core.js``).

``parse(inputs)`` validates everything before any calculation and raises ``MethodError`` naming the field; nothing is repaired. The
model is the one ``parseAgeModelDetailed`` leaves (sorted, depths strictly increasing, nothing missing), so a model that is not is
refused rather than reordered. There is no extrapolation: a query depth outside ``[first depth, last depth]`` has no age.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from ..kernels.ages import interpolate_age
from .errors import Cancelled
from .validation import fail, record, table

NAME = "core.ages/1"
INPUT_NAMES = ("settings", "age_model", "age_model_values", "age_model_valid", "query", "query_values", "query_valid")
MODEL_COLUMNS = (("depth", "age"), ("depth", "age", "age_min", "age_max"))


@dataclass
class Snapshot:
    """Validated inputs. ``model_min`` and ``model_max`` are None when the model has no range."""
    model_depth: np.ndarray
    model_age: np.ndarray
    model_min: np.ndarray | None
    model_max: np.ndarray | None
    units: dict                       # column name -> declared unit of the output columns
    query_depth: np.ndarray           # 0 where missing
    query_present: np.ndarray         # bool


@dataclass
class Result:
    """``dimensions`` = rows. ``columns`` holds the cells of the table ``ages`` (``ages_values`` f64 [columns, rows] and ``ages_valid``
    u8, a missing slot holding 0); ``tables`` describes it (contract §9.3) and ``summary`` is ``{"rows", "outside"}``."""
    dimensions: dict
    columns: dict
    tables: dict
    summary: dict


def _settings(value) -> None:
    record(value, ("version",), "settings")
    if type(value["version"]) is not int or value["version"] != 1:
        fail("UNSUPPORTED_INPUT", "settings")


def _model(inputs: dict):
    columns = table(inputs, "age_model", ("depth", "age", "age_min", "age_max"), required=("depth", "age"))
    names = tuple(columns)
    if names not in MODEL_COLUMNS:
        fail("INVALID_REQUEST", "age_model.columns")          # one range column without the other, or another order
    for name, column in columns.items():
        if not column.valid.all():
            fail("UNSUPPORTED_INPUT", f"age_model.{name}")
    depth, age = columns["depth"].values, columns["age"].values
    if depth.size < 2:
        fail("UNSUPPORTED_INPUT", "age_model.rows")
    if not np.all(np.diff(depth) > 0):
        fail("UNSUPPORTED_INPUT", "age_model.depth")
    low = high = None
    if "age_min" in columns:
        low, high = columns["age_min"].values, columns["age_max"].values
        if not np.all(low <= age):
            fail("UNSUPPORTED_INPUT", "age_model.age_min")
        if not np.all(age <= high):
            fail("UNSUPPORTED_INPUT", "age_model.age_max")
    return depth, age, low, high, {name: column.unit for name, column in columns.items() if name != "depth"}


def parse(inputs: dict, *, hashes: dict | None = None, memo: dict | None = None, derived: dict | None = None) -> Snapshot:
    """Validate ``inputs`` (contract §9.8) and return a ``Snapshot``; raises ``MethodError`` naming the field at fault."""
    if not isinstance(inputs, dict) or set(inputs) != set(INPUT_NAMES):
        fail("INVALID_REQUEST", "inputs")
    _settings(inputs["settings"])
    depth, age, low, high, units = _model(inputs)
    query = table(inputs, "query", ("depth",), required=("depth",))["depth"]
    return Snapshot(depth, age, low, high, units, query.values, query.valid)


def run(snapshot: Snapshot, report=lambda stage, completed, total: None, cancelled=lambda: False, *, memo: dict | None = None) -> Result:
    """Interpolate the ages of the query depths. Cancellation is polled before the calculation, which takes milliseconds even for
    the largest table (1,048,576 rows); no partial result exists."""
    s = snapshot
    if cancelled():
        raise Cancelled()
    inside = s.query_present & (s.query_depth >= s.model_depth[0]) & (s.query_depth <= s.model_depth[-1])
    series = [("age", s.model_age)]
    if s.model_min is not None:
        series += [("age_min", s.model_min), ("age_max", s.model_max)]
    values = np.zeros((len(series), s.query_depth.size), dtype="<f8")
    for k, (_, model) in enumerate(series):
        interpolated = interpolate_age(s.query_depth[inside], s.model_depth, model)
        if not np.all(np.isfinite(interpolated)):
            fail("UNSUPPORTED_INPUT", "age_model")             # an interpolation that overflows has no valid result
        values[k, inside] = interpolated
    valid = np.broadcast_to(inside, values.shape).astype("u1")
    report("interpolating", 1, 1)
    description = {"version": 1, "rows": int(s.query_depth.size), "columns": [{"name": name, "unit": s.units[name]} for name, _ in series]}
    summary = {"rows": int(s.query_depth.size), "outside": int(np.count_nonzero(s.query_present & ~inside))}
    return Result({"rows": int(s.query_depth.size)}, {"ages_values": values, "ages_valid": valid}, {"ages": description}, summary)
