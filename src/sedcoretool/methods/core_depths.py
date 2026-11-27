"""Engine method ``core.depths/1``: the depth of each age through the inverted age model of a core.

Contract: docs/roadmap-engine-contract.md §9.10. The reference results are the fixtures of ``tests/fixtures/core_depths``, made by the
JavaScript calculation this method replaces (``invertModel`` and ``toAxis(v, 'age', 'depth', model)`` of ``app/js/log.js``); the
depths are bit-identical to them (decision Z4). The model and its validation are those of ``core.ages/1`` (§9.8); a range is accepted
and not used. There is no extrapolation: an age outside ``[smallest age, largest age]`` has no depth.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from ..kernels.ages import interpolate_depth
from .core_ages import _model, _settings
from .errors import Cancelled
from .validation import fail, table

NAME = "core.depths/1"
INPUT_NAMES = ("settings", "age_model", "age_model_values", "age_model_valid", "query", "query_values", "query_valid")


@dataclass
class Snapshot:
    """Validated inputs. ``depth_unit`` is the declared unit of the model's ``depth`` column."""
    model_depth: np.ndarray
    model_age: np.ndarray
    depth_unit: str
    query_age: np.ndarray             # 0 where missing
    query_present: np.ndarray         # bool


@dataclass
class Result:
    """``dimensions`` = rows. ``columns`` holds the cells of the table ``depths`` (``depths_values`` f64 [1, rows] and ``depths_valid``
    u8, a missing slot holding 0); ``tables`` describes it (contract §9.3) and ``summary`` is ``{"rows", "outside"}``."""
    dimensions: dict
    columns: dict
    tables: dict
    summary: dict


def parse(inputs: dict, *, hashes: dict | None = None, memo: dict | None = None, derived: dict | None = None) -> Snapshot:
    """Validate ``inputs`` (contract §9.10) and return a ``Snapshot``; raises ``MethodError`` naming the field at fault."""
    if not isinstance(inputs, dict) or set(inputs) != set(INPUT_NAMES):
        fail("INVALID_REQUEST", "inputs")
    _settings(inputs["settings"])
    depth, age, _, _, _ = _model(inputs)
    unit = inputs["age_model"]["columns"][0]["unit"]
    query = table(inputs, "query", ("age",), required=("age",))["age"]
    return Snapshot(depth, age, unit, query.values, query.valid)


def run(snapshot: Snapshot, report=lambda stage, completed, total: None, cancelled=lambda: False, *, memo: dict | None = None) -> Result:
    """Interpolate the depths of the query ages. Cancellation is polled before the calculation, which takes milliseconds even for the
    largest table (1,048,576 rows); no partial result exists."""
    s = snapshot
    if cancelled():
        raise Cancelled()
    low, high = s.model_age.min(), s.model_age.max()
    inside = s.query_present & (s.query_age >= low) & (s.query_age <= high)
    values = np.zeros((1, s.query_age.size), dtype="<f8")
    depths = interpolate_depth(s.query_age[inside], s.model_depth, s.model_age)
    if not np.all(np.isfinite(depths)):
        fail("UNSUPPORTED_INPUT", "age_model")                 # an interpolation that overflows has no valid result
    values[0, inside] = depths
    valid = inside.astype("u1").reshape(1, -1)
    report("interpolating", 1, 1)
    description = {"version": 1, "rows": int(s.query_age.size), "columns": [{"name": "depth", "unit": s.depth_unit}]}
    summary = {"rows": int(s.query_age.size), "outside": int(np.count_nonzero(s.query_present & ~inside))}
    return Result({"rows": int(s.query_age.size)}, {"depths_values": values, "depths_valid": valid}, {"depths": description}, summary)
