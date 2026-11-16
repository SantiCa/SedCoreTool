"""Depth intervals: pixels per centimetre, interval edges and sums, the minimum-valid rule and percentages.

The operation order matches ``app/js/core.js`` (``binRows``, ``binEdge``) and ``app/js/sectiondepth.js``: rows are
divided by the span in centimetres *before* they are multiplied by the interval thickness, because reassociating the
product can move a half-row boundary and change percentages and indices.
"""

from __future__ import annotations

import numpy as np

UNIT_TO_CM = {"mm": 0.1, "cm": 1.0, "m": 100.0}


def unit_factor(units: str) -> float:
    """Centimetres per depth unit."""
    try:
        return UNIT_TO_CM[units]
    except KeyError:
        raise ValueError(f"units must be one of {sorted(UNIT_TO_CM)}, not {units!r}") from None


def pixels_per_cm(rows: int, top: float, bottom: float, units: str) -> float:
    """Pixel rows per centimetre of a section: ``rows / ((bottom - top) * units_to_cm)``."""
    return rows / ((bottom - top) * unit_factor(units))


def interval_rows(bin_cm: float, px_per_cm: float) -> float:
    """Rows per interval (may be fractional): the thickness in cm times rows per cm, in this order.

    The result is not clamped. The public Python API rejects fewer than one row; the engine method clamps to one.
    """
    return bin_cm * px_per_cm


def bin_edge(j: int, bin_px: float) -> int:
    """First row of interval ``j``: ``floor(j * bin_px + 0.5)`` (half rows round up)."""
    return int(np.floor(j * bin_px + 0.5))


def bin_edges(n: int, bin_px: float, keep_partial: bool = True) -> list[tuple[int, int]]:
    """Row ranges of the intervals: interval j spans ``[bin_edge(j), bin_edge(j + 1))``, clipped at ``n`` rows.

    A fractional ``bin_px`` never drifts; an integer one gives fixed-size intervals. The last interval is dropped when
    it is partial and ``keep_partial`` is False.
    """
    if bin_px >= 1:
        # The same arithmetic as ``bin_edge`` on all indices at once (``j * bin_px`` is one float64 product, ``floor`` is exact); the edges never decrease.
        wanted = np.floor(np.arange(int(n / bin_px) + 3, dtype=float) * bin_px + 0.5).astype(np.int64)
        count = int(np.searchsorted(wanted, n, side="left"))                       # intervals whose first row is inside the image
        while count == len(wanted):                                                 # (never reached for the estimate above; kept for safety)
            wanted = np.floor(np.arange(2 * len(wanted), dtype=float) * bin_px + 0.5).astype(np.int64)
            count = int(np.searchsorted(wanted, n, side="left"))
        ends = wanted[1:count + 1]
        if not keep_partial and count and ends[-1] > n:
            count -= 1
        return list(zip(wanted[:count].tolist(), np.minimum(ends[:count], n).tolist()))
    out, j = [], 0
    while bin_edge(j, bin_px) < n:
        end = bin_edge(j + 1, bin_px)
        if end > n and not keep_partial:
            break
        out.append((bin_edge(j, bin_px), min(n, end)))
        j += 1
    return out


def sum_by_interval(values: np.ndarray, edges: list[tuple[int, int]]) -> np.ndarray:
    """Sum ``values`` (per row, optionally with trailing axes) over each interval; the result is float64.

    Integer and boolean values (the row counts) are summed exactly from one cumulative sum, so the cost does not grow with the number of
    intervals; the result equals the sum of each slice (``values[a:b].sum(axis=0)``) because integer addition is exact and wraps the same way.
    Float values keep the per-interval loop: a difference of running sums rounds differently from NumPy's pairwise sum of the slice.
    """
    bounds = np.asarray(edges, dtype=np.intp).reshape(-1, 2)
    if values.dtype.kind not in "biu" or (bounds.size and bounds.min() < 0):              # a negative index counts from the end of a slice
        return np.array([values[a:b].sum(axis=0) for a, b in edges], dtype=float).reshape(len(edges), *values.shape[1:])
    n = values.shape[0]
    first = np.minimum(bounds[:, 0], n)
    last = np.minimum(bounds[:, 1], n)
    last = np.maximum(first, last)                                                # a reversed range is an empty slice
    wide = np.uint64 if values.dtype.kind == "u" else np.int64
    if len(first) and (first < last).all() and (first[1:] == last[:-1]).all():            # consecutive non-empty intervals: one pass, no temporary
        return np.add.reduceat(values[:last[-1]], first, axis=0, dtype=wide).astype(float)
    running = np.zeros((n + 1, *values.shape[1:]), dtype=wide)
    np.cumsum(values, axis=0, dtype=wide, out=running[1:])
    return (running[last] - running[first]).astype(float)


def enough_valid(valid_sum: np.ndarray, rows: np.ndarray, columns: int, min_valid: float) -> np.ndarray:
    """Intervals with data: some valid pixel and at least ``min_valid`` of the interval's area valid (equality counts)."""
    return (valid_sum > 0) & (valid_sum >= min_valid * rows * columns)


def percentage(count: np.ndarray, valid_sum: np.ndarray, has_data: np.ndarray) -> np.ndarray:
    """``100 * count / valid`` where the interval has data, NaN elsewhere."""
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(has_data, 100 * count / valid_sum, np.nan)
