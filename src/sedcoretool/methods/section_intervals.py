"""Engine method ``section.intervals/1``: counts, percentages, indices, ages and manual indices per depth interval.

Inputs and results are defined in docs/roadmap-engine-contract.md §4 and §5; the reference result for every case in
``tests/fixtures/section-intervals`` is produced by the JavaScript calculation this method replaces.

``parse(inputs)`` validates *everything* before any calculation and raises ``MethodError`` naming the field. Nothing
is repaired or dropped. ``run(snapshot, report, cancelled)`` follows the order of §4: effective class of each object,
counts, interval sums, percentages with the minimum-valid rule, no-data padding, indices, ages, manual indices.

Narrowings of the contract made here (each is rejected with ``UNSUPPORTED_INPUT``): tier values must be non-negative
(-1 marks a missing index in the kernels), age-model depths must be strictly increasing, and an age model has a range
on every record or on none.
"""

from __future__ import annotations

import hashlib
from collections import OrderedDict
from dataclasses import dataclass

import numpy as np

from ..kernels.ages import interpolate_age
from ..kernels.binning import (
    bin_edges,
    enough_valid,
    interval_rows,
    percentage,
    pixels_per_cm,
    sum_by_interval,
    unit_factor,
)
from ..kernels.classification import PRECEDENCE, classify_tiers
from ..kernels.counting import object_row_counts
from .errors import Cancelled
from .validation import INT32, boolean, buffer, fail, integer, number, record, records, text

NAME = "section.intervals/1"
INPUT_NAMES = ("labels", "exclude", "objects", "classes", "stack_offsets", "stack_members", "settings", "age_model", "manual_indices")
SETTING_FIELDS = ("width", "height", "roi", "top", "bottom", "units", "bin_cm", "min_valid", "no_data_pad_cm",
                  "include_predictions", "prediction_threshold", "count_candidates", "schemes", "age_units")
UNITS = ("mm", "cm", "m")
CHUNK_ROWS = 256                          # rows counted between cancellation checks
MAX_COUNT_BYTES = 256 * 1024 ** 2         # rows * classes * 8 bytes of per-row class counts
MAX_OBJECT_ID = 64 * 1024 ** 2            # the object-to-class table has one entry per id up to the largest
EPSILON = 1e-9                            # depth tolerance of the no-data padding, as in the program
MEMO_COUNT_BYTES = 64 * 1024 ** 2         # row counts a caller-owned memo may hold
MEMO_COUNT_ENTRIES = 16
MEMO_CHECKS = 64                          # remembered validations of masks


def new_memo() -> dict:
    """What a long-lived caller (the engine worker) keeps between jobs: validations that passed and the row counts of masks it has
    seen. Every entry is indexed by the SHA-256 of the buffers it came from, so nothing stale can be used. Pass it to `parse` and `run`."""
    return {"exclude_ok": set(), "labels_ok": set(), "counts": OrderedDict(), "count_tables": {}}


def changed_rows(specs, shapes_row_bytes, height: int) -> list:
    """The image rows [first, end), merged and sorted, that a derived buffer had written into it after it was copied from its base.

    `specs` are the `derived_from` descriptions of the masks (`{sha256, ranges: [[start, end) bytes]}`) and `shapes_row_bytes` the bytes per
    image row of each. Every byte outside these ranges is the base's, because the coordinator wrote the ranges itself."""
    rows = []
    for spec, row_bytes in zip(specs, shapes_row_bytes):
        for start, end in spec["ranges"]:
            rows.append((start // row_bytes, min(height, (end - 1) // row_bytes + 1)))
    merged = []
    for first, end in sorted(rows):
        if merged and first <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((first, end))
    return merged


def _remember(checks: set, key) -> None:
    if len(checks) >= MEMO_CHECKS:
        checks.clear()
    checks.add(key)


@dataclass
class Snapshot:
    """Validated inputs. Arrays are the caller's (read only); everything else is plain Python."""
    labels: np.ndarray
    exclude: np.ndarray
    roi: tuple[int, int, int, int]                  # x0, y0, x1, y1 (half-open)
    top: float
    bottom: float
    units: str
    bin_cm: float
    min_valid: float
    no_data_pad_cm: float
    n_classes: int
    class_of_object: np.ndarray                     # counted class index of each object id (0 unused), -1 = none
    stack_offsets: np.ndarray                       # int64, K + 1 entries
    stack_members: np.ndarray                       # int64
    schemes: list[tuple[str, str, list[tuple[float, float, int]]]]
    age_model: tuple[np.ndarray, np.ndarray, np.ndarray | None, np.ndarray | None]   # depth, age, min, max
    manual: list[tuple[float, float, int | None, int | None]]
    count_key: tuple | None = None                  # identity of everything the row counts depend on; None = not cacheable
    base_count_key: tuple | None = None             # labels, exclusion, stacks, ROI and number of classes of the masks these were copied from
    present: np.ndarray | None = None               # which object ids are listed
    changed_rows: list | None = None                # image rows [first, end) written after that copy


@dataclass
class Result:
    """``dimensions`` = bins, classes, schemes. ``columns`` maps the contract's column names to NumPy arrays; each
    nullable column ``x`` has a ``x_valid`` uint8 array of the same shape and holds 0 in invalid slots."""
    dimensions: dict
    columns: dict


# ---- parse -----------------------------------------------------------------------------------------------------------

def _settings(value, labels: np.ndarray) -> dict:
    s = dict(record(value, SETTING_FIELDS, "settings"))
    height, width = labels.shape
    if integer(s["width"], "settings.width", 1) != width:
        fail("INVALID_REQUEST", "settings.width")
    if integer(s["height"], "settings.height", 1) != height:
        fail("INVALID_REQUEST", "settings.height")
    roi = record(s["roi"], ("x0", "y0", "x1", "y1"), "settings.roi")
    x0, y0, x1, y1 = (integer(roi[k], "settings.roi", 0) for k in ("x0", "y0", "x1", "y1"))
    if not (x0 < x1 <= width and y0 < y1 <= height):
        fail("INVALID_REQUEST", "settings.roi")
    s["roi"] = (x0, y0, x1, y1)
    s["top"] = number(s["top"], "settings.top")
    s["bottom"] = number(s["bottom"], "settings.bottom")
    if s["bottom"] <= s["top"]:
        fail("INVALID_REQUEST", "settings.bottom")
    if s["units"] not in UNITS:
        fail("INVALID_REQUEST", "settings.units")
    s["bin_cm"] = number(s["bin_cm"], "settings.bin_cm", 0, strict_low=True)
    s["min_valid"] = number(s["min_valid"], "settings.min_valid", 0, 1)
    s["no_data_pad_cm"] = number(s["no_data_pad_cm"], "settings.no_data_pad_cm", 0)
    s["include_predictions"] = boolean(s["include_predictions"], "settings.include_predictions")
    s["count_candidates"] = boolean(s["count_candidates"], "settings.count_candidates")
    s["prediction_threshold"] = number(s["prediction_threshold"], "settings.prediction_threshold", 0, 1)
    if s["age_units"] is not None:
        text(s["age_units"], "settings.age_units")
    schemes = records(s["schemes"], "settings.schemes")
    if not schemes:
        fail("UNSUPPORTED_INPUT", "settings.schemes")
    parsed = []
    for k, item in enumerate(schemes):
        where = f"settings.schemes[{k}]"
        item = record(item, ("name", "precedence", "tiers"), where)
        name = text(item["name"], f"{where}.name")
        if item["precedence"] not in PRECEDENCE:
            fail("INVALID_REQUEST", f"{where}.precedence")
        tiers = []
        for t in records(item["tiers"], f"{where}.tiers"):
            t = record(t, ("lower", "upper", "value"), f"{where}.tiers")
            lower, upper = number(t["lower"], f"{where}.tiers"), number(t["upper"], f"{where}.tiers")
            value = integer(t["value"], f"{where}.tiers", *INT32)
            if not lower < upper:
                fail("INVALID_REQUEST", f"{where}.tiers")
            if value < 0:
                fail("UNSUPPORTED_INPUT", f"{where}.tiers")
            tiers.append((lower, upper, value))
        parsed.append((name, item["precedence"], tiers))
    s["schemes"] = parsed
    return s


def _classes(value) -> tuple[list[str], list[bool]]:
    items = records(value, "classes")
    if not items:
        fail("UNSUPPORTED_INPUT", "classes")
    ids, counts = [], []
    for item in items:
        item = record(item, ("id", "name", "counts"), "classes")
        ids.append(text(item["id"], "classes.id"))
        text(item["name"], "classes.name", empty=True)
        counts.append(boolean(item["counts"], "classes.counts"))
    if len(set(ids)) != len(ids):
        fail("INVALID_REQUEST", "classes.id")
    return ids, counts


def _objects(value, class_ids: list[str], counts: list[bool], settings: dict) -> tuple[np.ndarray, np.ndarray]:
    """The counted class index of every object id (-1 = none) and a presence table of the ids."""
    index = {c: k for k, c in enumerate(class_ids)}
    parsed = []
    for item in records(value, "objects"):
        item = record(item, ("id", "class_id", "predicted_class_id", "confidence"), "objects")
        identifier = integer(item["id"], "objects.id", 1, INT32[1])
        for member in ("class_id", "predicted_class_id"):
            if item[member] is not None and (not isinstance(item[member], str) or item[member] not in index):
                fail("INVALID_REQUEST", f"objects.{member}")
        parsed.append((identifier, item["class_id"], item["predicted_class_id"], number(item["confidence"], "objects.confidence", 0, 1)))
    ids = [p[0] for p in parsed]
    if len(set(ids)) != len(ids):
        fail("INVALID_REQUEST", "objects.id")
    largest = max(ids, default=0)
    if largest > MAX_OBJECT_ID:
        fail("LIMIT_EXCEEDED", "objects.id")
    table = np.full(largest + 1, -1, dtype=np.intp)
    present = np.zeros(largest + 1, dtype=bool)
    for identifier, assigned, predicted, confidence in parsed:
        present[identifier] = True
        # An assigned class always wins; a prediction counts only when included and at or above the threshold;
        # otherwise a candidate counts as "undet" when the setting says so.
        if assigned:
            effective = assigned
        elif settings["include_predictions"] and predicted and confidence >= settings["prediction_threshold"]:
            effective = predicted
        else:
            effective = "undet" if settings["count_candidates"] else None
        k = index.get(effective, -1)
        table[identifier] = k if k >= 0 and counts[k] else -1
    return table, present


def _stacks(offsets, members, present: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    offsets = buffer(offsets, "stack_offsets", "<u4", 1).astype(np.int64)
    if offsets.size < 2 or offsets[0] != 0 or offsets[1] != 0 or np.any(np.diff(offsets) < 0):
        fail("INVALID_BUFFER", "stack_offsets")       # row 0 of the stack table is unused and empty
    total = int(offsets[-1])
    if members is None:
        if total:
            fail("INVALID_BUFFER", "stack_members")
        return offsets, np.zeros(0, dtype=np.int64)
    members = buffer(members, "stack_members", "<u4", 1).astype(np.int64)
    if members.size != total:
        fail("INVALID_BUFFER", "stack_members")
    if members.max() >= present.size or not present[members].all():
        fail("INVALID_BUFFER", "stack_members")        # a member that is not a listed object
    owner = np.repeat(np.arange(offsets.size - 1, dtype=np.int64), np.diff(offsets))
    keys = owner * present.size + members
    if np.unique(keys).size != keys.size:
        fail("INVALID_BUFFER", "stack_members")        # the same object twice in one stack
    return offsets, members


def _check_labels(labels: np.ndarray, present: np.ndarray, stack_rows: int, rows: list | None = None) -> None:
    """Every positive label must be a listed object and every negative one a listed stack (whole image, not only the ROI).
    With `rows` only those image rows [first, end) are looked at: the caller knows that the others were checked before."""
    seen = np.zeros(present.size, dtype=bool)
    for first, last in [(0, labels.shape[0])] if rows is None else rows:
        for start in range(first, last, CHUNK_ROWS):
            block = labels[start:min(last, start + CHUNK_ROWS)]
            if block.min() <= -stack_rows:
                fail("INVALID_BUFFER", "labels")
            positive = block[block > 0]
            if positive.size:
                if positive.max() >= present.size:
                    fail("INVALID_BUFFER", "labels")
                seen[positive] = True
    if np.any(seen & ~present):
        fail("INVALID_BUFFER", "labels")


def _age_model(value):
    items = records(value, "age_model")
    if not items:
        return np.zeros(0), np.zeros(0), None, None
    depth, age, low, high = [], [], [], []
    for item in items:
        item = record(item, ("depth", "age", "min", "max"), "age_model")
        depth.append(number(item["depth"], "age_model.depth"))
        age.append(number(item["age"], "age_model.age"))
        if (item["min"] is None) != (item["max"] is None):
            fail("INVALID_REQUEST", "age_model.min")
        low.append(None if item["min"] is None else number(item["min"], "age_model.min"))
        high.append(None if item["max"] is None else number(item["max"], "age_model.max"))
    if any(b <= a for a, b in zip(depth, depth[1:])):
        fail("UNSUPPORTED_INPUT", "age_model.depth")
    ranged = [v is not None for v in low]
    if any(ranged) and not all(ranged):
        fail("UNSUPPORTED_INPUT", "age_model.min")
    return np.array(depth), np.array(age), (np.array(low) if all(ranged) else None), (np.array(high) if all(ranged) else None)


def _manual(value):
    parsed = []
    for item in records(value, "manual_indices"):
        item = record(item, ("from", "to", "BI", "ii"), "manual_indices")
        start, end = number(item["from"], "manual_indices.from"), number(item["to"], "manual_indices.to")
        if not start < end:
            fail("INVALID_REQUEST", "manual_indices.to")
        values = [None if item[k] is None else integer(item[k], f"manual_indices.{k}", *INT32) for k in ("BI", "ii")]
        parsed.append((start, end, *values))
    return parsed


def parse(inputs: dict, *, hashes: dict | None = None, memo: dict | None = None, derived: dict | None = None) -> Snapshot:
    """Validate ``inputs`` (contract §4) and return a ``Snapshot``; raises ``MethodError`` naming the field at fault.

    ``hashes`` (input name -> SHA-256 of its buffer, already verified by the caller) and ``memo`` (``new_memo()``) let a long-lived
    caller skip, for masks it has validated before, the full-image checks and, in ``run``, the counting. Every rule is still applied
    to a mask the memo has not seen; the tables are always validated.

    ``derived`` (input name -> ``{sha256, ranges}``, from the coordinator) says that a mask was made by copying an earlier buffer and writing
    the given byte ranges: if the memo holds the earlier buffer's checks and counts, only those rows are checked and counted again.

    Numeric inputs are NumPy arrays of the contract's dtypes (``labels`` ``<i4`` [height, width], ``exclude`` ``u1``,
    ``stack_offsets`` and ``stack_members`` ``<u4``; ``stack_members`` may be None when there is no overlap); the
    others are the decoded JSON tables."""
    if not isinstance(inputs, dict) or set(inputs) != set(INPUT_NAMES):
        fail("INVALID_REQUEST", "inputs")
    labels = buffer(inputs["labels"], "labels", "<i4", 2)
    exclude = buffer(inputs["exclude"], "exclude", "u1", 2)
    if exclude.shape != labels.shape:
        fail("INVALID_BUFFER", "exclude")
    exclude_key = hashes.get("exclude") if hashes and memo is not None else None
    derived = (derived or {}) if memo is not None else {}
    width = labels.shape[1]
    height = labels.shape[0]
    rows_of = {name: changed_rows([derived[name]], [width * (4 if name == "labels" else 1)], height) for name in ("labels", "exclude") if name in derived}
    if exclude_key is None or exclude_key not in memo["exclude_ok"]:
        base_checked = memo is not None and "exclude" in derived and derived["exclude"]["sha256"] in memo["exclude_ok"]
        if any(exclude[first:end].max() > 1 for first, end in rows_of["exclude"]) if base_checked else exclude.max() > 1:
            fail("INVALID_BUFFER", "exclude")
        if exclude_key is not None:
            _remember(memo["exclude_ok"], exclude_key)
    settings = _settings(inputs["settings"], labels)
    class_ids, counts = _classes(inputs["classes"])
    table, present = _objects(inputs["objects"], class_ids, counts, settings)
    offsets, members = _stacks(inputs["stack_offsets"], inputs["stack_members"], present)
    labels_key = None
    if hashes and memo is not None and hashes.get("labels"):
        labels_key = (hashes["labels"], hashes.get("stack_offsets"), hashes.get("stack_members"), hashlib.sha256(present.tobytes()).hexdigest())
    if labels_key is None or labels_key not in memo["labels_ok"]:
        base_key = (derived["labels"]["sha256"], *labels_key[1:]) if labels_key is not None and "labels" in derived else None
        _check_labels(labels, present, offsets.size - 1, rows_of["labels"] if base_key is not None and base_key in memo["labels_ok"] else None)
        if labels_key is not None:
            _remember(memo["labels_ok"], labels_key)
    x0, y0, x1, y1 = settings["roi"]
    if (y1 - y0) * len(class_ids) * 8 > MAX_COUNT_BYTES:
        fail("LIMIT_EXCEEDED", "classes")
    count_key = None
    if hashes and memo is not None and hashes.get("labels") and hashes.get("exclude") and hashes.get("stack_offsets"):
        count_key = (hashes["labels"], hashes["exclude"], hashes["stack_offsets"], hashes.get("stack_members"), settings["roi"], len(class_ids),
                     hashlib.sha256(table.tobytes()).hexdigest())
    base_count_key, rows = None, None
    if count_key is not None and rows_of:
        base_count_key = (derived["labels"]["sha256"] if "labels" in derived else count_key[0],
                          derived["exclude"]["sha256"] if "exclude" in derived else count_key[1], *count_key[2:6])
        rows = changed_rows([derived[name] for name in rows_of], [width * (4 if name == "labels" else 1) for name in rows_of], height)
    return Snapshot(labels=labels, exclude=exclude, roi=settings["roi"], top=settings["top"], bottom=settings["bottom"],
                    units=settings["units"], bin_cm=settings["bin_cm"], min_valid=settings["min_valid"],
                    no_data_pad_cm=settings["no_data_pad_cm"], n_classes=len(class_ids), class_of_object=table,
                    stack_offsets=offsets, stack_members=members, schemes=settings["schemes"],
                    age_model=_age_model(inputs["age_model"]), manual=_manual(inputs["manual_indices"]), count_key=count_key,
                    base_count_key=base_count_key, changed_rows=rows, present=present)


# ---- run -------------------------------------------------------------------------------------------------------------

def _count_rows(s: Snapshot, first: int, end: int):
    """Counts of the ROI rows [first, end) (relative to the ROI's first row)."""
    x0, y0, x1, y1 = s.roi
    window = (slice(y0 + first, y0 + end), slice(x0, x1))
    return object_row_counts(s.labels[window], s.exclude[window] == 0, s.class_of_object, s.n_classes, s.stack_offsets, s.stack_members)


def _count(s: Snapshot, report, cancelled):
    x0, y0, x1, y1 = s.roi
    valid, bio, cls = [], [], []
    for start in range(0, y1 - y0, CHUNK_ROWS):
        if cancelled():
            raise Cancelled()
        end = min(y1 - y0, start + CHUNK_ROWS)
        part = _count_rows(s, start, end)
        valid.append(part.valid)
        bio.append(part.bio)
        cls.append(part.cls)
        report("counting", end, y1 - y0)
    return np.concatenate(valid), np.concatenate(bio), np.concatenate(cls)


def _compatible_base(s: Snapshot, memo: dict):
    """Counts of the base masks that the rows outside `s.changed_rows` can keep, or None.

    The base must have the same labels and exclusion it was derived from, the same stack tables, ROI and number of classes, and the same
    effective class for every object listed in both. An object listed only in the base (deleted) cannot occur in the unchanged rows,
    because `parse` validates the whole new label image whenever the list of objects changed; an object listed only now (added) cannot
    occur there either, because the base image was validated without it. A class reassigned to an object listed in both changes rows
    anywhere, so it needs a full count."""
    for key in reversed(memo["counts"]):
        if key[:6] != s.base_count_key or key not in memo["count_tables"]:
            continue
        table, present = memo["count_tables"][key]
        size = max(table.size, s.class_of_object.size)
        both = np.zeros(size, dtype=bool)
        both[:min(present.size, s.present.size)] = present[:min(present.size, s.present.size)] & s.present[:min(present.size, s.present.size)]
        old, new = np.full(size, -1, dtype=np.intp), np.full(size, -1, dtype=np.intp)
        old[:table.size], new[:s.class_of_object.size] = table, s.class_of_object
        if np.array_equal(old[both], new[both]):
            return memo["counts"][key]
    return None


def _count_from_base(s: Snapshot, base, cancelled):
    """The counts of the base masks with the rows written since recounted; identical to counting everything, much cheaper for a small edit."""
    x0, y0, x1, y1 = s.roi
    valid, bio, cls = (array.copy() for array in base)
    for first, end in s.changed_rows:
        first, end = max(first, y0) - y0, min(end, y1) - y0                  # image rows -> ROI rows, clipped
        for start in range(max(first, 0), end, CHUNK_ROWS):
            if cancelled():
                raise Cancelled()
            stop = min(end, start + CHUNK_ROWS)
            part = _count_rows(s, start, stop)
            valid[start:stop], bio[start:stop], cls[start:stop] = part.valid, part.bio, part.cls
    return valid, bio, cls


def _pad_no_data(no_data: np.ndarray, depth_top: np.ndarray, depth_bottom: np.ndarray, pad: float) -> np.ndarray:
    """Intervals that overlap a no-data interval widened by ``pad`` on each side (strict comparisons with a 1e-9
    tolerance, as in the program). Both bounds are ordered, so two binary searches replace the pairwise test."""
    gaps = np.flatnonzero(no_data)
    if pad <= 0 or gaps.size == 0:
        return np.zeros(no_data.shape, dtype=bool)
    starts = (depth_top[gaps] - pad) + EPSILON         # a gap reaches an interval whose bottom is below this ...
    ends = (depth_bottom[gaps] + pad) - EPSILON        # ... and whose top is above this
    first_end_above_top = np.searchsorted(ends, depth_top, side="right")
    starts_below_bottom = np.searchsorted(starts, depth_bottom, side="left")
    return ~no_data & (first_end_above_top < starts_below_bottom)


def _counts(s: Snapshot, report, cancelled, memo: dict | None):
    """Row counts of the snapshot: from the memo when the same masks, ROI and class table were counted before."""
    cache = memo["counts"] if memo is not None and s.count_key is not None else None
    x0, y0, x1, y1 = s.roi
    if cache is not None and s.count_key in cache:
        cache.move_to_end(s.count_key)
        report("counting", y1 - y0, y1 - y0)
        return cache[s.count_key]
    base = _compatible_base(s, memo) if cache is not None and s.base_count_key is not None and s.changed_rows is not None else None
    counted = _count_from_base(s, base, cancelled) if base is not None else _count(s, report, cancelled)
    if base is not None:
        report("counting", y1 - y0, y1 - y0)
    if cache is not None:
        for array in counted:
            array.flags.writeable = False      # shared between jobs from now on
        cache[s.count_key] = counted
        memo["count_tables"][s.count_key] = (s.class_of_object, s.present)
        while len(cache) > MEMO_COUNT_ENTRIES or sum(a.nbytes for entry in cache.values() for a in entry) > MEMO_COUNT_BYTES:
            if len(cache) == 1:
                cache.clear()               # a single entry larger than the bound is not kept
                memo["count_tables"].clear()
                break
            memo["count_tables"].pop(cache.popitem(last=False)[0], None)
    return counted


def run(snapshot: Snapshot, report=lambda stage, completed, total: None, cancelled=lambda: False, *, memo: dict | None = None) -> Result:
    """Calculate the contract's result columns. ``report(stage, completed, total)`` receives progress in work units;
    ``cancelled()`` is polled between blocks of rows and raises ``Cancelled`` (no partial result exists)."""
    s = snapshot
    x0, y0, x1, y1 = s.roi
    rows, columns = y1 - y0, x1 - x0
    valid_rows, bio_rows, class_rows = _counts(s, report, cancelled, memo)
    if cancelled():
        raise Cancelled()
    bin_px = max(1.0, interval_rows(s.bin_cm, pixels_per_cm(rows, s.top, s.bottom, s.units)))
    edges = bin_edges(rows, bin_px)
    start, end = np.array([a for a, _ in edges]), np.array([b for _, b in edges])
    step = (s.bottom - s.top) / rows
    depth_top, depth_bottom = s.top + start * step, s.top + end * step
    depth = s.top + (start + end) / 2 * step
    valid_sum = sum_by_interval(valid_rows, edges)
    has_data = enough_valid(valid_sum, end - start, columns, s.min_valid)
    pct = percentage(sum_by_interval(bio_rows, edges), valid_sum, has_data)
    class_pct = percentage(sum_by_interval(class_rows, edges), valid_sum[:, None], has_data[:, None])
    no_data = ~has_data
    padded = _pad_no_data(no_data, depth_top, depth_bottom, s.no_data_pad_cm / unit_factor(s.units))
    pct[padded] = np.nan
    class_pct[padded] = np.nan
    no_data = no_data | padded
    report("intervals", 1, 1)

    out: dict[str, np.ndarray] = {}

    def plain(name, values, dtype):
        out[name] = np.asarray(values).astype(dtype)

    def nullable(name, values, valid, dtype):
        valid = np.asarray(valid, dtype=bool)
        out[name] = np.where(valid, np.asarray(values), 0).astype(dtype)
        out[f"{name}_valid"] = valid.astype("u1")

    index_values = np.zeros((len(edges), len(s.schemes)), dtype=np.int64)
    for k, (_, precedence, tiers) in enumerate(s.schemes):
        index_values[:, k] = classify_tiers(pct, tiers, precedence)      # -1 = no index (NaN, gap or no data)
    model_depth, model_age, model_min, model_max = s.age_model
    age = interpolate_age(depth, model_depth, model_age)
    age_range = (interpolate_age(depth, model_depth, model_min), interpolate_age(depth, model_depth, model_max)) if model_min is not None else None
    chosen = np.full(len(edges), -1)
    for k, (first, last, _, _) in enumerate(s.manual):
        chosen[(depth >= first) & (depth < last)] = k            # the last matching range wins
    manual = {name: np.array([m[2 + i] if m[2 + i] is not None else 0 for m in s.manual] or [0]) for i, name in enumerate(("BI", "ii"))}
    manual_valid = {name: np.array([m[2 + i] is not None for m in s.manual] or [False]) for i, name in enumerate(("BI", "ii"))}

    plain("row_start", start, "<u4")
    plain("row_end", end, "<u4")
    plain("valid_count", valid_sum, "<u8")
    plain("bio_count", sum_by_interval(bio_rows, edges), "<u8")
    plain("class_count", sum_by_interval(class_rows, edges), "<u8")
    plain("depth_top", depth_top, "<f8")
    plain("depth_bottom", depth_bottom, "<f8")
    plain("depth", depth, "<f8")
    plain("valid_pct", 100 * valid_sum / ((end - start) * columns), "<f8")
    nullable("bioturbation_pct", pct, ~np.isnan(pct), "<f8")
    nullable("class_pct", class_pct, ~np.isnan(class_pct), "<f8")
    plain("no_data", no_data, "u1")
    nullable("age", age, ~np.isnan(age), "<f8")
    for name, values in zip(("age_min", "age_max"), age_range or (np.zeros(depth.shape), np.zeros(depth.shape))):
        nullable(name, values, ~np.isnan(values) if age_range else np.zeros(depth.shape, dtype=bool), "<f8")
    for name in ("BI", "ii"):
        picked = chosen >= 0
        nullable(f"manual_{name}", manual[name][np.maximum(chosen, 0)], picked & manual_valid[name][np.maximum(chosen, 0)], "<i4")
    nullable("indices", index_values, index_values >= 0, "<i4")
    return Result({"bins": len(edges), "classes": s.n_classes, "schemes": len(s.schemes)}, out)
