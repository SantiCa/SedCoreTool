"""Kernels: pure array primitives. Checked against the shared fractional fixtures, the reference fixtures generated from
the JavaScript calculation (tests/fixtures/section-intervals), and slow reference implementations."""

import json
from pathlib import Path

import numpy as np
import pytest

import section_fixtures as fixtures
from sedcoretool import BI_TAYLOR_GOLDRING, IndexScheme
from sedcoretool.kernels.ages import interpolate_age
from sedcoretool.kernels.binning import (
    bin_edge,
    bin_edges,
    enough_valid,
    interval_rows,
    percentage,
    pixels_per_cm,
    sum_by_interval,
    unit_factor,
)
from sedcoretool.kernels.classification import TierTable, classify_tiers
from sedcoretool.kernels.counting import label_row_counts, layer_row_counts, object_row_counts

ROOT = Path(__file__).resolve().parents[1]


# ---- binning ---------------------------------------------------------------------------------------------------------

def test_fractional_boundary_cases_shared_with_javascript():
    cases = json.loads((ROOT / "tests/fixtures/fractional-boundaries.json").read_bytes())
    assert len(cases) == 20
    for c in cases:
        bin_px = interval_rows(c["bin_cm"], pixels_per_cm(c["rows"], c["top"], c["bottom"], c["units"]))
        assert bin_px == c["bin_px"]
        assert [a for a, _ in bin_edges(c["rows"], bin_px)] + [c["rows"]] == c["edges"]


def test_pixels_per_cm_divides_by_the_whole_span_in_centimetres_like_the_program():
    # app/js/sectiondepth.js: span = (bottom - top) * unit_to_cm; rows / span. Dividing in two steps differs in the last
    # bit for some inputs, which can move a half-row boundary. Find such inputs and require the program's order.
    differing = []
    for rows in range(1000, 8000, 37):
        for top, bottom in ((1.5, 2.99), (0.2, 3.7), (10.3, 11.9), (0.0, 1.49)):
            wanted = rows / ((bottom - top) * 100.0)
            if wanted != rows / (bottom - top) / 100.0:
                differing.append((rows, top, bottom, wanted))
    assert len(differing) >= 5, "the search must find inputs that tell the two orders apart"
    for rows, top, bottom, wanted in differing:
        assert pixels_per_cm(rows, top, bottom, "m") == wanted


def test_units_edges_sums_and_the_minimum_valid_rule():
    assert [unit_factor(u) for u in ("mm", "cm", "m")] == [0.1, 1.0, 100.0]
    with pytest.raises(ValueError, match="units must be one of"):
        unit_factor("km")
    assert [bin_edge(j, 12.5) for j in range(4)] == [0, 13, 25, 38]            # half rows round up
    assert bin_edges(100, 30, keep_partial=False) == [(0, 30), (30, 60), (60, 90)]
    sums = sum_by_interval(np.arange(10), bin_edges(10, 4))                       # intervals of 4, 4 and a partial 2
    assert sums.tolist() == [6.0, 22.0, 17.0] and sums.dtype == float
    table = sum_by_interval(np.ones((6, 2), dtype=int), [(0, 3), (3, 6)])
    assert table.tolist() == [[3.0, 3.0], [3.0, 3.0]]
    v, rows = np.array([8.0, 7.0, 0.0]), np.array([4.0, 4.0, 4.0])
    ok = enough_valid(v, rows, 10, 0.2)                                           # 20 % of 40 pixels = 8: equality counts
    assert ok.tolist() == [True, False, False]
    result = percentage(np.array([4.0, 1.0, 0.0]), v, ok)
    assert result[0] == 50.0 and np.isnan(result[1]) and np.isnan(result[2])


def _sum_by_interval_loop(values, edges):
    """The implementation before card M8.4.20: one slice sum per interval."""
    return np.array([values[a:b].sum(axis=0) for a, b in edges], dtype=float).reshape(len(edges), *values.shape[1:])


@pytest.mark.parametrize("dtype", [np.bool_, np.uint8, np.uint16, np.uint32, np.uint64, np.int8, np.int64, np.float32, np.float64])
@pytest.mark.parametrize("trailing", [(), (3,), (2, 2)])
def test_sum_by_interval_equals_the_slice_sums_exactly(dtype, trailing):
    rng = np.random.default_rng(138501)
    for _ in range(25):
        n = int(rng.integers(0, 60))
        values = (rng.integers(0, 200, size=(n, *trailing)) if np.dtype(dtype).kind != "i" else rng.integers(-100, 100, size=(n, *trailing))).astype(dtype)
        edges = [(int(a), int(b)) for a, b in rng.integers(-3, n + 8, size=(int(rng.integers(0, 12)), 2))]    # empty, reversed, overlapping, out of range, negative
        got, want = sum_by_interval(values, edges), _sum_by_interval_loop(values, edges)
        assert got.dtype == float and got.shape == want.shape
        np.testing.assert_array_equal(got, want)
        regular = bin_edges(n, 4)
        np.testing.assert_array_equal(sum_by_interval(values, regular), _sum_by_interval_loop(values, regular))


def _bin_edges_loop(n, bin_px, keep_partial=True):
    """The implementation before card M8.4.20: one ``bin_edge`` call per boundary."""
    out, j = [], 0
    while bin_edge(j, bin_px) < n:
        end = bin_edge(j + 1, bin_px)
        if end > n and not keep_partial:
            break
        out.append((bin_edge(j, bin_px), min(n, end)))
        j += 1
    return out


def test_bin_edges_equal_the_per_boundary_loop_exactly():
    rng = np.random.default_rng(138501)
    sizes = [1.0, 1.5, 2.0, 3.0, 12.5, 30.0, 0.5 + 1e-9, 7.000000000000001, 6.999999999999999, 1e6]
    sizes += [float(x) for x in rng.uniform(1, 200, size=60)] + [float(x) for x in rng.uniform(0.01, 1, size=5)]   # below 1 uses the loop
    counts = [0, 1, 2, 3, 29, 30, 31, 100, 4097, 349_526] + [int(x) for x in rng.integers(0, 20_000, size=15)]
    for bin_px in sizes:
        for n in counts:
            if (bin_px < 1 and n > 200) or (bin_px < 3 and n > 20_000):
                continue                                                           # the reference loop would need millions of steps
            for keep in (True, False):
                assert bin_edges(n, bin_px, keep) == _bin_edges_loop(n, bin_px, keep), (n, bin_px, keep)


def test_sum_by_interval_integer_sums_wrap_like_the_slice_sums():
    values = np.full(4, np.iinfo(np.uint64).max, dtype=np.uint64)                                   # sums overflow: both paths wrap the same way
    edges = [(0, 2), (1, 4), (2, 2)]
    np.testing.assert_array_equal(sum_by_interval(values, edges), _sum_by_interval_loop(values, edges))


# ---- ages ------------------------------------------------------------------------------------------------------------

def test_age_interpolation_ends_gaps_extrapolation_and_degenerate_models():
    md, ma = [0.0, 10.0], [0.0, 100.0]
    out = interpolate_age([-1.0, 0.0, 2.5, 10.0, 10.5], md, ma)
    assert np.isnan(out[0]) and np.isnan(out[4])
    assert out[1:4].tolist() == [0.0, 25.0, 100.0]                                # both ends belong to the model
    assert interpolate_age([-1.0, 11.0], md, ma, extrapolate=True).tolist() == [-10.0, 110.0]
    assert interpolate_age([4.0, 5.0], [5.0], [7.0]).tolist()[1] == 7.0           # one point: only its own depth
    assert np.isnan(interpolate_age([4.0, 5.0], [5.0], [7.0])[0])
    assert np.isnan(interpolate_age([1.0], [], [])).all()
    assert interpolate_age(np.array([]), md, ma).size == 0


# ---- classification --------------------------------------------------------------------------------------------------

def reference_classify(percentages, tiers, precedence):
    """Plain loop: the first (or last) declared tier that contains the value."""
    out = []
    for p in percentages:
        found = -1
        ordered = tiers if precedence == "first" else list(reversed(tiers))
        for lower, upper, value in ordered:
            if lower <= p < upper:
                found = value
                break
        out.append(found)
    return np.array(out)


@pytest.mark.parametrize("precedence", ["first", "last"])
def test_tier_precedence_matches_a_plain_loop_on_overlapping_and_gapped_tiers(precedence):
    tiers = ((3, 8, 4), (-np.inf, 0, 2), (1.5, 4.5, 3), (2.75, 3.25, 9), (20, 10, 5), (50, 60, 1), (55, 70, 8))
    grid = np.concatenate([np.arange(-2, 80, 0.25), [np.inf, -np.inf]])
    expected = reference_classify(grid, tiers, precedence)
    np.testing.assert_array_equal(classify_tiers(grid, tiers, precedence), expected)
    assert classify_tiers(np.array([np.nan]), tiers, precedence).tolist() == [-1]
    assert TierTable((), precedence).classify(grid).tolist() == [-1] * grid.size
    with pytest.raises(ValueError, match="precedence"):
        TierTable(tiers, "middle")


def test_public_scheme_uses_last_match_and_the_desktop_rule_is_first_match():
    tiers = ((0, 100, 1), (30, 60, 7))
    p = np.array([10.0, 30.0, 59.0, 60.0])
    assert IndexScheme("x", tiers).classify(p).tolist() == [1, 7, 7, 1]
    assert classify_tiers(p, tiers, "first").tolist() == [1, 1, 1, 1]
    default = np.arange(0, 101, 0.5)
    np.testing.assert_array_equal(BI_TAYLOR_GOLDRING.classify(default), classify_tiers(default, BI_TAYLOR_GOLDRING.tiers, "first"))


# ---- counting --------------------------------------------------------------------------------------------------------

def naive_object_counts(labels, valid, table, n_classes, stacks):
    rows = labels.shape[0]
    bio, cls = np.zeros(rows, dtype=np.int64), np.zeros((rows, n_classes), dtype=np.int64)
    for r in range(rows):
        for c in range(labels.shape[1]):
            if not valid[r, c]:
                continue
            label = int(labels[r, c])
            classes = {int(table[label])} - {-1} if label > 0 else (
                {int(table[m]) for m in stacks[-label]} - {-1} if label < 0 else set())
            if classes:
                bio[r] += 1
            for k in classes:
                cls[r, k] += 1
    return bio, cls


def csr(stacks):
    members = [m for row in stacks for m in row]
    offsets = np.concatenate([[0], np.cumsum([len(row) for row in stacks])])
    return offsets.astype(np.uint32), np.array(members, dtype=np.uint32)


@pytest.mark.parametrize("seed", range(12))
def test_object_counts_match_a_plain_loop_with_overlaps_and_exclusions(seed):
    rng = np.random.default_rng(138501 + seed)
    rows, width = int(rng.integers(1, 90)), int(rng.integers(1, 40))
    n_objects, n_classes = int(rng.integers(1, 30)), int(rng.integers(1, 6))
    table = np.concatenate([[-1], rng.integers(-1, n_classes, n_objects)])
    stacks = [[]] + [list(rng.integers(1, n_objects + 1, rng.integers(0, 5))) for _ in range(int(rng.integers(0, 8)))]
    labels = rng.integers(0, n_objects + 1, (rows, width)).astype(np.int32)
    if len(stacks) > 1:
        labels = np.where(rng.random((rows, width)) < 0.2, -rng.integers(1, len(stacks), (rows, width)), labels).astype(np.int32)
    valid = rng.random((rows, width)) > 0.2
    offsets, members = csr(stacks)
    result = object_row_counts(labels, valid, table, n_classes, offsets, members if members.size else None)
    bio, cls = naive_object_counts(labels, valid, table, n_classes, stacks)
    np.testing.assert_array_equal(result.valid, valid.sum(axis=1))
    np.testing.assert_array_equal(result.bio, bio)
    np.testing.assert_array_equal(result.cls, cls)
    assert result.bio.dtype == result.cls.dtype == result.valid.dtype == np.int64


def test_object_counts_in_wide_images_strided_views_and_without_modifying_inputs():
    rng = np.random.default_rng(138501)
    labels = rng.integers(0, 4, (3, 70001)).astype(np.int32)[:, ::-1]                 # wider than one column chunk, reversed view
    valid = (rng.random((3, 70001)) > 0.3)[:, ::-1]
    table, saved = np.array([-1, 0, 1, 1]), (labels.copy(), valid.copy())
    result = object_row_counts(labels, valid, table, 2)
    bio, cls = naive_object_counts(labels, valid, table, 2, [[]])
    np.testing.assert_array_equal(result.bio, bio)
    np.testing.assert_array_equal(result.cls, cls)
    np.testing.assert_array_equal(labels, saved[0])
    np.testing.assert_array_equal(valid, saved[1])
    empty = object_row_counts(np.zeros((0, 5), dtype=np.int32), np.zeros((0, 5), dtype=bool), np.array([-1]), 1)
    assert empty.valid.shape == empty.bio.shape == (0,) and empty.cls.shape == (0, 1)


def test_object_counts_reject_labels_and_tables_that_do_not_match():
    labels, valid = np.array([[1, 2]], dtype=np.int32), np.ones((1, 2), dtype=bool)
    with pytest.raises(ValueError, match="not in the class table"):
        object_row_counts(labels, valid, np.array([-1, 0]), 1)                         # object 2 is unknown
    with pytest.raises(ValueError, match="outside the class list"):
        object_row_counts(labels, valid, np.array([-1, 0, 3]), 2)                      # class index 3 of 2 classes
    with pytest.raises(ValueError, match="no stack table"):
        object_row_counts(np.array([[-1]], dtype=np.int32), np.ones((1, 1), dtype=bool), np.array([-1, 0]), 1)
    with pytest.raises(ValueError, match="not in the stack table"):
        object_row_counts(np.array([[-2]], dtype=np.int32), np.ones((1, 1), dtype=bool), np.array([-1, 0]), 1,
                          np.array([0, 0, 1], dtype=np.uint32)[:2], None)               # one stack row only: stack 2 does not exist
    with pytest.raises(ValueError, match="CSR"):
        object_row_counts(np.array([[-1]], dtype=np.int32), np.ones((1, 1), dtype=bool), np.array([-1, 0]), 1,
                          np.array([0, 3], dtype=np.uint32), np.array([1], dtype=np.uint32))
    with pytest.raises(ValueError, match="not in the class table"):
        object_row_counts(np.array([[-1]], dtype=np.int32), np.ones((1, 1), dtype=bool), np.array([-1, 0]), 1,
                          np.array([0, 1], dtype=np.uint32), np.array([5], dtype=np.uint32))


def test_layer_counts_match_a_plain_loop():
    rng = np.random.default_rng(7)
    layers = rng.random((3, 41, 29)) > 0.7
    valid = rng.random((41, 29)) > 0.25
    result = layer_row_counts(layers, valid)
    np.testing.assert_array_equal(result.valid, valid.sum(axis=1))
    np.testing.assert_array_equal(result.bio, (layers.any(axis=0) & valid).sum(axis=1))
    np.testing.assert_array_equal(result.cls, np.stack([(layers[k] & valid).sum(axis=1) for k in range(3)], axis=1))


def test_class_mask_counts_are_the_object_counts_of_a_mask_whose_objects_are_its_classes():
    rng = np.random.default_rng(3)
    mask = rng.integers(0, 5, (70, 33)).astype(np.uint8)
    valid = rng.random((70, 33)) > 0.2
    classic = label_row_counts(mask, valid, 4)
    objects = object_row_counts(mask.astype(np.int32), valid, np.arange(-1, 4), 4)
    np.testing.assert_array_equal(classic[:, 1:], objects.cls)
    np.testing.assert_array_equal(classic[:, 0] + objects.bio, objects.valid)


# ---- the reference fixtures generated from the JavaScript calculation -------------------------------------------------

def kernel_result(inputs):
    """What the kernels alone give for a fixture: counts, intervals, percentages, indices and ages (no padding, no
    manual indices; those belong to the method)."""
    s = inputs["settings"]
    roi, classes = s["roi"], inputs["classes"]
    window = (slice(roi["y0"], roi["y1"]), slice(roi["x0"], roi["x1"]))
    labels, valid = fixtures.array(inputs["labels"])[window], fixtures.array(inputs["exclude"])[window] == 0
    offsets = fixtures.array(inputs["stack_offsets"])
    members = fixtures.array(inputs["stack_members"]) if inputs["stack_members"] else None
    counts = object_row_counts(labels, valid, fixtures.class_of_object(inputs), len(classes), offsets, members)
    rows, columns = roi["y1"] - roi["y0"], roi["x1"] - roi["x0"]
    bin_px = max(1, interval_rows(s["bin_cm"], pixels_per_cm(rows, s["top"], s["bottom"], s["units"])))
    edges = bin_edges(rows, bin_px)
    start, end = np.array([a for a, _ in edges]), np.array([b for _, b in edges])
    valid_sum = sum_by_interval(counts.valid, edges)
    ok = enough_valid(valid_sum, end - start, columns, s["min_valid"])
    pct = percentage(sum_by_interval(counts.bio, edges), valid_sum, ok)
    step = (s["bottom"] - s["top"]) / rows
    depth = s["top"] + (start + end) / 2 * step
    indices = np.stack([classify_tiers(pct, [(t["lower"], t["upper"], t["value"]) for t in scheme["tiers"]], scheme["precedence"])
                        for scheme in s["schemes"]], axis=1)
    model = inputs["age_model"]
    age = interpolate_age(depth, [m["depth"] for m in model], [m["age"] for m in model])
    return {"start": start, "end": end, "counts": counts, "edges": edges, "pct": pct, "depth": depth, "indices": indices, "age": age,
            "class_pct": np.stack([percentage(sum_by_interval(counts.cls[:, k], edges), valid_sum, ok) for k in range(len(classes))], axis=1)}


@pytest.mark.parametrize("name", fixtures.names())
def test_kernels_reproduce_the_reference_fixtures(name):
    fixture = fixtures.load(name)
    inputs, expected = fixture["inputs"], fixture["expected"]["columns"]
    k = kernel_result(inputs)
    # Exact: interval bounds and every raw count (they do not depend on padding or manual indices).
    np.testing.assert_array_equal(k["start"], fixtures.column(expected, "row_start")[0])
    np.testing.assert_array_equal(k["end"], fixtures.column(expected, "row_end")[0])
    edges = k["edges"]
    np.testing.assert_array_equal(sum_by_interval(k["counts"].valid, edges), fixtures.column(expected, "valid_count")[0])
    np.testing.assert_array_equal(sum_by_interval(k["counts"].bio, edges), fixtures.column(expected, "bio_count")[0])
    class_counts = np.stack([sum_by_interval(k["counts"].cls[:, c], edges) for c in range(k["counts"].cls.shape[1])], axis=1)
    np.testing.assert_array_equal(class_counts, fixtures.column(expected, "class_count")[0])
    np.testing.assert_allclose(k["depth"], fixtures.column(expected, "depth")[0], rtol=0, atol=1e-9)
    # Ages: inside the model within 1e-9, missing exactly where the reference is missing.
    ages, age_valid = fixtures.column(expected, "age")
    assert np.array_equal(~np.isnan(k["age"]), age_valid)
    np.testing.assert_allclose(k["age"][age_valid], ages[age_valid], rtol=0, atol=1e-9)
    if inputs["settings"]["no_data_pad_cm"] > 0:
        return    # padding turns more intervals into no data: percentages and indices are checked by the method (M8.3.4)
    pct, pct_valid = fixtures.column(expected, "bioturbation_pct")
    assert np.array_equal(~np.isnan(k["pct"]), pct_valid)
    np.testing.assert_allclose(k["pct"][pct_valid], pct[pct_valid], rtol=0, atol=1e-9)
    class_pct, class_valid = fixtures.column(expected, "class_pct")
    assert np.array_equal(~np.isnan(k["class_pct"]), class_valid)
    np.testing.assert_allclose(k["class_pct"][class_valid], class_pct[class_valid], rtol=0, atol=1e-9)
    indices, index_valid = fixtures.column(expected, "indices")
    assert np.array_equal(k["indices"] >= 0, index_valid)
    np.testing.assert_array_equal(np.where(index_valid, k["indices"], 0), indices)
