"""Linear interpolation of an age model."""

from __future__ import annotations

import numpy as np


def interpolate_age(depth, model_depth, model_age, extrapolate: bool = False) -> np.ndarray:
    """Age at each depth by linear interpolation; NaN outside the model unless ``extrapolate`` is True.

    ``model_depth`` must be finite and strictly increasing and ``model_age`` finite and as long; callers validate and
    sort (``depth.depth_to_age`` does for the public API). Both ends of the model belong to it. A model with one point
    gives its age at exactly that depth; an empty model gives NaN everywhere. Extrapolation continues the first and
    last segment and needs at least two points.
    """
    d = np.asarray(depth, dtype=float)
    md = np.asarray(model_depth, dtype=float)
    ma = np.asarray(model_age, dtype=float)
    if md.size == 0:
        return np.full(d.shape, np.nan)
    if md.size == 1:
        return np.where(d == md[0], ma[0], np.nan)
    age = np.interp(d, md, ma)
    if extrapolate:
        lo = (ma[1] - ma[0]) / (md[1] - md[0])
        hi = (ma[-1] - ma[-2]) / (md[-1] - md[-2])
        age = np.where(d < md[0], ma[0] + (d - md[0]) * lo, age)
        return np.where(d > md[-1], ma[-1] + (d - md[-1]) * hi, age)
    return np.where((d < md[0]) | (d > md[-1]), np.nan, age)


def interpolate_depth(age, model_depth, model_age) -> np.ndarray:
    """Depth at each age through the inverted age model, with the lookup and operation order of ``core.js::interpAge`` (bit-identical).

    The inverse pairs (age, depth) are sorted by age with a STABLE sort, so equal ages keep their depths in increasing order; ages
    need not increase downwards. ``lo`` is the last index whose age is <= the query, at most n - 2; ``span`` = age[hi] - age[lo];
    depth = depth[lo] + ((a - age[lo]) / span) * (depth[hi] - depth[lo]), or depth[lo] when ``span`` is 0. ``np.interp`` is not
    used: it is undefined for equal knots. NaN where the query is NaN or outside [smallest age, largest age]. The model needs at
    least two finite rows (callers validate).
    """
    a = np.asarray(age, dtype=float)
    order = np.argsort(np.asarray(model_age, dtype=float), kind="stable")
    x = np.asarray(model_age, dtype=float)[order]
    y = np.asarray(model_depth, dtype=float)[order]
    lo = np.clip(np.searchsorted(x, a, side="right") - 1, 0, x.size - 2)
    hi = lo + 1
    x_lo, y_lo = x[lo], y[lo]
    span = x[hi] - x_lo
    safe = np.where(span != 0, span, 1.0)
    # Separate temporaries keep the IEEE operation order (no fused multiply-add in NumPy elementwise arithmetic).
    fraction = (a - x_lo) / safe
    moved = fraction * (y[hi] - y_lo)
    depth = np.where(span != 0, y_lo + moved, y_lo)
    return np.where((a < x[0]) | (a > x[-1]) | np.isnan(a), np.nan, depth)
