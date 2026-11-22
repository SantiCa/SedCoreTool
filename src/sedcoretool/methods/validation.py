"""Strict, closed-field checks shared by method ``parse`` functions. Every failure raises ``MethodError`` naming the field."""

from __future__ import annotations

import math
from typing import NamedTuple

import numpy as np

from .errors import MethodError

MAX_RECORDS = 65536
MAX_TEXT = 4096
INT32 = (-(2 ** 31), 2 ** 31 - 1)


def fail(code: str, field: str):
    raise MethodError(code, field)


def integer(value, field: str, low: int | None = None, high: int | None = None, code: str = "INVALID_REQUEST") -> int:
    """An int (not a bool) within ``[low, high]``."""
    if type(value) is not int or (low is not None and value < low) or (high is not None and value > high):
        fail(code, field)
    return value


def number(value, field: str, low: float | None = None, high: float | None = None, *, strict_low: bool = False) -> float:
    """A finite int or float (not a bool); ``strict_low`` excludes the lower bound itself."""
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        fail("INVALID_REQUEST", field)
    if (low is not None and (value <= low if strict_low else value < low)) or (high is not None and value > high):
        fail("INVALID_REQUEST", field)
    return value


def boolean(value, field: str) -> bool:
    if type(value) is not bool:
        fail("INVALID_REQUEST", field)
    return value


def text(value, field: str, *, empty: bool = False) -> str:
    if not isinstance(value, str) or (not empty and not value) or len(value.encode("utf-8", "surrogatepass")) > MAX_TEXT:
        fail("INVALID_REQUEST", field)
    return value


def record(value, fields: tuple[str, ...], field: str) -> dict:
    """A dict with exactly ``fields``: an unknown or missing member is rejected, never ignored."""
    if not isinstance(value, dict) or set(value) != set(fields):
        fail("INVALID_REQUEST", field)
    return value


def records(value, field: str) -> list:
    if not isinstance(value, list) or len(value) > MAX_RECORDS:
        fail("INVALID_REQUEST", field)
    return value


def buffer(value, field: str, dtype: str, ndim: int) -> np.ndarray:
    """A NumPy array of exactly ``dtype`` (for example ``"<i4"``) and ``ndim`` dimensions, all of positive length."""
    if not isinstance(value, np.ndarray) or value.dtype != np.dtype(dtype) or value.ndim != ndim or 0 in value.shape:
        fail("INVALID_BUFFER", field)
    return value


# ---- record tables (card M8.4.10; contract §4, "Tables") ------------------------------------------------------------------
# A table named ``name`` arrives as three inputs: ``name`` (utf8json ``{version, rows, columns: [{name, unit}]}``), ``name_values``
# (``f64le[columns, rows]``) and ``name_valid`` (``u8[columns, rows]``, 1 = present, 0 = missing, and a missing slot holds 0). The
# limits are those of ``app/js/tablesnapshot.js``, which builds the buffers.

TABLE_VERSION = 1
MAX_TABLE_COLUMNS = 256
MAX_TABLE_ROWS = 1_048_576
MAX_TABLE_DATA_BYTES = 8 * 1_048_576          # values and validity together, 9 bytes per cell
MAX_TABLE_NAME_BYTES = 256
MAX_TABLE_UNIT_BYTES = 64


class TableColumn(NamedTuple):
    """One column of a decoded table: ``values`` (float64, read-only, 0 where missing), ``valid`` (bool) and the declared ``unit``."""

    values: np.ndarray
    valid: np.ndarray
    unit: str


def _bounded_text(value, field: str, limit: int, *, empty: bool) -> str:
    if not isinstance(value, str) or (not empty and not value):
        fail("INVALID_REQUEST", field)
    try:
        size = len(value.encode("utf-8"))
    except UnicodeEncodeError:                 # a lone surrogate: not text the client could have sent
        fail("INVALID_REQUEST", field)
    if size > limit:
        fail("LIMIT_EXCEEDED", field)
    return value


def table(inputs: dict, name: str, columns=None, *, required=()) -> dict[str, TableColumn]:
    """The table ``name`` of ``inputs`` as ``{column name: TableColumn}`` in the order it was sent.

    ``columns`` is the collection of column names the method accepts (``None``: any name); ``required`` the names that must be
    present. Everything is checked before a value is used, and every failure names the input at fault: a missing or malformed
    description, an unknown version, a limit, a repeated, empty or not accepted name, a missing required column, a value buffer that is not
    ``float64[columns, rows]`` or a validity buffer that is not ``uint8[columns, rows]``, a validity byte other than 0 or 1, a present
    value that is not finite and a missing slot whose value is not 0."""
    meta = inputs.get(name)
    if not isinstance(meta, dict):
        fail("INVALID_REQUEST", name)
    record(meta, ("version", "rows", "columns"), name)
    if type(meta["version"]) is not int or meta["version"] != TABLE_VERSION:
        fail("UNSUPPORTED_INPUT", f"{name}.version")
    rows = integer(meta["rows"], f"{name}.rows", 1)
    if rows > MAX_TABLE_ROWS:
        fail("LIMIT_EXCEEDED", f"{name}.rows")
    described = meta["columns"]
    if not isinstance(described, list) or not described:
        fail("INVALID_REQUEST", f"{name}.columns")
    if len(described) > MAX_TABLE_COLUMNS:
        fail("LIMIT_EXCEEDED", f"{name}.columns")
    if len(described) * rows * 9 > MAX_TABLE_DATA_BYTES:
        fail("LIMIT_EXCEEDED", f"{name}.rows")
    accepted = None if columns is None else frozenset(columns)
    names, units = [], []
    for column in described:
        record(column, ("name", "unit"), f"{name}.columns")
        column_name = _bounded_text(column["name"], f"{name}.columns.name", MAX_TABLE_NAME_BYTES, empty=False)
        if column_name in names or (accepted is not None and column_name not in accepted):
            fail("INVALID_REQUEST", f"{name}.columns.name")
        names.append(column_name)
        units.append(_bounded_text(column["unit"], f"{name}.columns.unit", MAX_TABLE_UNIT_BYTES, empty=True))
    if not set(required) <= set(names):
        fail("INVALID_REQUEST", f"{name}.columns")
    shape = (len(names), rows)
    values = buffer(inputs.get(f"{name}_values"), f"{name}_values", "<f8", 2)
    valid = buffer(inputs.get(f"{name}_valid"), f"{name}_valid", "u1", 2)
    if values.shape != shape:
        fail("INVALID_BUFFER", f"{name}_values")
    if valid.shape != shape:
        fail("INVALID_BUFFER", f"{name}_valid")
    if np.any(valid > 1):
        fail("INVALID_BUFFER", f"{name}_valid")
    present = valid == 1
    if not np.all(np.isfinite(values[present])):
        fail("INVALID_BUFFER", f"{name}_values")
    if np.any(values[~present] != 0):
        fail("INVALID_BUFFER", f"{name}_values")
    return {column_name: TableColumn(values[i], present[i], units[i]) for i, column_name in enumerate(names)}
