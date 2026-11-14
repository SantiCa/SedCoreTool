"""Engine method section.intervals/1 called directly: every reference fixture, every validation rule, cancellation."""

import copy

import numpy as np
import pytest

import section_fixtures as fixtures
from sedcoretool.methods import registry, section_intervals
from sedcoretool.methods.errors import Cancelled, MethodError


def inputs_of(fixture):
    """The method's inputs from a fixture: numeric buffers as arrays, tables as decoded JSON."""
    raw = fixture["inputs"]
    out = {name: copy.deepcopy(raw[name]) for name in ("objects", "classes", "settings", "age_model", "manual_indices")}
    for name in ("labels", "exclude", "stack_offsets"):
        out[name] = fixtures.array(raw[name])
    out["stack_members"] = fixtures.array(raw["stack_members"]) if raw["stack_members"] else None
    return out


@pytest.mark.parametrize("name", fixtures.names())
def test_method_reproduces_every_reference_fixture(name):
    fixture = fixtures.load(name)
    result = section_intervals.run(section_intervals.parse(inputs_of(fixture)))
    assert result.dimensions == fixture["expected"]["dimensions"]
    fixtures.assert_columns_match(name, fixture["expected"]["columns"], result.columns)


def test_inputs_are_never_modified_and_results_repeat():
    inputs = inputs_of(fixtures.load("large-mixed"))
    saved = copy.deepcopy({k: (v.copy() if isinstance(v, np.ndarray) else v) for k, v in inputs.items()})
    first = section_intervals.run(section_intervals.parse(inputs))
    second = section_intervals.run(section_intervals.parse(inputs))
    for key, value in saved.items():
        if isinstance(value, np.ndarray):
            np.testing.assert_array_equal(inputs[key], value)
        else:
            assert inputs[key] == value
    assert first.columns.keys() == second.columns.keys()
    for key in first.columns:
        np.testing.assert_array_equal(first.columns[key], second.columns[key])


def test_progress_is_reported_in_order_and_cancellation_raises_without_a_result():
    parsed = section_intervals.parse(inputs_of(fixtures.load("large-mixed")))      # 1,940 ROI rows: eight blocks
    events = []
    section_intervals.run(parsed, report=lambda stage, done, total: events.append((stage, done, total)))
    counting = [e for e in events if e[0] == "counting"]
    assert [e[1] for e in counting] == sorted(e[1] for e in counting) and counting[-1][1] == counting[-1][2] == 1940
    assert len(counting) == 8 and events[-1][0] == "intervals"
    polls = []
    with pytest.raises(Cancelled):
        section_intervals.run(parsed, cancelled=lambda: polls.append(1) or len(polls) > 3)    # cancel during the third block
    assert len(polls) == 4
    with pytest.raises(Cancelled):
        section_intervals.run(parsed, cancelled=lambda: True)


def test_registry_lists_the_method_and_rejects_unknown_names():
    assert registry.get("section.intervals/1") is section_intervals
    for name in ("section.intervals/2", "buffer.digest/1", None):
        with pytest.raises(MethodError) as caught:
            registry.get(name)
        assert caught.value.code == "UNSUPPORTED_METHOD"


# ---- one rejection per validation rule ---------------------------------------------------------------------------------

def base():
    return inputs_of(fixtures.load("overlap-same-and-different-class"))    # classes, objects 1, 2 and 4, two stacks


def s(**changes):
    def apply(inputs):
        inputs["settings"].update(changes)
    return apply


def roi(**changes):
    def apply(inputs):
        inputs["settings"]["roi"].update(changes)
    return apply


def scheme(**changes):
    def apply(inputs):
        inputs["settings"]["schemes"][0].update(changes)
    return apply


def tier(**changes):
    def apply(inputs):
        inputs["settings"]["schemes"][0]["tiers"][0].update(changes)
    return apply


def obj(**changes):
    def apply(inputs):
        inputs["objects"][0].update(changes)
    return apply


def drop(key):
    return lambda inputs: inputs["settings"].pop(key)


def put(key, value):
    return lambda inputs: inputs.__setitem__(key, value)


def label(row, col, value):
    def apply(inputs):
        inputs["labels"] = inputs["labels"].copy()
        inputs["labels"][row, col] = value
    return apply


def age_model(records):
    return put("age_model", records)


RECORD = {"depth": 0.0, "age": 1.0, "min": None, "max": None}
REJECTED = [
    ("inputs missing a name", lambda i: i.pop("age_model"), "INVALID_REQUEST", "inputs"),
    ("inputs with an extra name", put("extra", 1), "INVALID_REQUEST", "inputs"),
    ("labels of another dtype", lambda i: i.update(labels=i["labels"].astype("<i8")), "INVALID_BUFFER", "labels"),
    ("labels with one dimension", lambda i: i.update(labels=i["labels"].reshape(-1)), "INVALID_BUFFER", "labels"),
    ("labels naming an unlisted object", label(3, 3, 9), "INVALID_BUFFER", "labels"),
    ("labels naming a missing stack", label(3, 3, -3), "INVALID_BUFFER", "labels"),
    ("exclusion of another shape", lambda i: i.update(exclude=i["exclude"][:2]), "INVALID_BUFFER", "exclude"),
    ("exclusion with a value of 2", lambda i: i.update(exclude=np.full_like(i["exclude"], 2)), "INVALID_BUFFER", "exclude"),
    ("exclusion that is boolean", lambda i: i.update(exclude=i["exclude"].astype(bool)), "INVALID_BUFFER", "exclude"),
    ("unknown setting", s(extra=1), "INVALID_REQUEST", "settings"),
    ("missing setting", drop("min_valid"), "INVALID_REQUEST", "settings"),
    ("width that differs from the labels", s(width=5), "INVALID_REQUEST", "settings.width"),
    ("height that differs from the labels", s(height=5), "INVALID_REQUEST", "settings.height"),
    ("width that is a float", s(width=4.0), "INVALID_REQUEST", "settings.width"),
    ("ROI beyond the image", roi(x1=99), "INVALID_REQUEST", "settings.roi"),
    ("empty ROI", roi(x1=0), "INVALID_REQUEST", "settings.roi"),
    ("negative ROI origin", roi(y0=-1), "INVALID_REQUEST", "settings.roi"),
    ("bottom not below top", s(bottom=0), "INVALID_REQUEST", "settings.bottom"),
    ("non-finite top", s(top=float("nan")), "INVALID_REQUEST", "settings.top"),
    ("unknown units", s(units="km"), "INVALID_REQUEST", "settings.units"),
    ("zero interval", s(bin_cm=0), "INVALID_REQUEST", "settings.bin_cm"),
    ("non-finite interval", s(bin_cm=float("inf")), "INVALID_REQUEST", "settings.bin_cm"),
    ("minimum valid above 1", s(min_valid=1.5), "INVALID_REQUEST", "settings.min_valid"),
    ("negative padding", s(no_data_pad_cm=-1), "INVALID_REQUEST", "settings.no_data_pad_cm"),
    ("threshold above 1", s(prediction_threshold=2), "INVALID_REQUEST", "settings.prediction_threshold"),
    ("flag that is a number", s(include_predictions=1), "INVALID_REQUEST", "settings.include_predictions"),
    ("flag that is text", s(count_candidates="yes"), "INVALID_REQUEST", "settings.count_candidates"),
    ("age units that are not text", s(age_units=5), "INVALID_REQUEST", "settings.age_units"),
    ("no schemes", s(schemes=[]), "UNSUPPORTED_INPUT", "settings.schemes"),
    ("unknown precedence", scheme(precedence="middle"), "INVALID_REQUEST", "settings.schemes[0].precedence"),
    ("scheme without a name", scheme(name=""), "INVALID_REQUEST", "settings.schemes[0].name"),
    ("tier with lower not below upper", tier(lower=5, upper=5), "INVALID_REQUEST", "settings.schemes[0].tiers"),
    ("tier value outside int32", tier(value=2 ** 31), "INVALID_REQUEST", "settings.schemes[0].tiers"),
    ("negative tier value", tier(value=-1), "UNSUPPORTED_INPUT", "settings.schemes[0].tiers"),
    ("unknown tier member", tier(extra=1), "INVALID_REQUEST", "settings.schemes[0].tiers"),
    ("no classes", put("classes", []), "UNSUPPORTED_INPUT", "classes"),
    ("duplicate class id", lambda i: i["classes"].append(dict(i["classes"][0])), "INVALID_REQUEST", "classes.id"),
    ("class counts that is not a boolean", lambda i: i["classes"][0].update(counts=1), "INVALID_REQUEST", "classes.counts"),
    ("duplicate object id", lambda i: i["objects"].append(dict(i["objects"][0])), "INVALID_REQUEST", "objects.id"),
    ("object id zero", obj(id=0), "INVALID_REQUEST", "objects.id"),
    ("object with an unknown class", obj(class_id="zzz"), "INVALID_REQUEST", "objects.class_id"),
    ("object with an unknown prediction", obj(predicted_class_id="zzz"), "INVALID_REQUEST", "objects.predicted_class_id"),
    ("confidence above 1", obj(confidence=1.5), "INVALID_REQUEST", "objects.confidence"),
    ("unknown object member", obj(extra=1), "INVALID_REQUEST", "objects"),
    ("offsets not starting at 0", put("stack_offsets", np.array([1, 1, 3, 4], dtype="<u4")), "INVALID_BUFFER", "stack_offsets"),
    ("offsets with a non-empty row 0", put("stack_offsets", np.array([0, 1, 3, 4], dtype="<u4")), "INVALID_BUFFER", "stack_offsets"),
    ("offsets that decrease", put("stack_offsets", np.array([0, 0, 3, 2], dtype="<u4")), "INVALID_BUFFER", "stack_offsets"),
    ("offsets of another dtype", put("stack_offsets", np.array([0, 0, 2, 4], dtype="<i4")), "INVALID_BUFFER", "stack_offsets"),
    ("members shorter than the offsets say", put("stack_members", np.array([1, 2, 1], dtype="<u4")), "INVALID_BUFFER", "stack_members"),
    ("members missing", put("stack_members", None), "INVALID_BUFFER", "stack_members"),
    ("member that is not an object", put("stack_members", np.array([1, 2, 1, 99], dtype="<u4")), "INVALID_BUFFER", "stack_members"),
    ("object twice in one stack", put("stack_members", np.array([1, 2, 1, 1], dtype="<u4")), "INVALID_BUFFER", "stack_members"),
    ("age depths not increasing", age_model([{**RECORD, "depth": 5.0}, {**RECORD, "depth": 5.0}]), "UNSUPPORTED_INPUT", "age_model.depth"),
    ("age model with only a minimum", age_model([{**RECORD, "min": 0.5}]), "INVALID_REQUEST", "age_model.min"),
    ("age ranges on some records only", age_model([{**RECORD, "min": 0.0, "max": 1.0}, {**RECORD, "depth": 1.0}]), "UNSUPPORTED_INPUT", "age_model.min"),
    ("non-finite age", age_model([{**RECORD, "age": float("nan")}]), "INVALID_REQUEST", "age_model.age"),
    ("manual range with from not below to", put("manual_indices", [{"from": 3.0, "to": 3.0, "BI": 1, "ii": 1}]), "INVALID_REQUEST", "manual_indices.to"),
    ("manual index that is a float", put("manual_indices", [{"from": 0.0, "to": 3.0, "BI": 1.5, "ii": 1}]), "INVALID_REQUEST", "manual_indices.BI"),
    ("manual record with an unknown member", put("manual_indices", [{"from": 0.0, "to": 3.0, "BI": 1, "ii": 1, "x": 1}]), "INVALID_REQUEST", "manual_indices"),
]


@pytest.mark.parametrize("mutate,code,field", [r[1:] for r in REJECTED], ids=[r[0] for r in REJECTED])
def test_invalid_input_is_rejected_with_the_field_named(mutate, code, field):
    inputs = base()
    mutate(inputs)
    with pytest.raises(MethodError) as caught:
        section_intervals.parse(inputs)
    assert (caught.value.code, caught.value.field) == (code, field)


def test_a_result_larger_than_the_class_count_budget_is_refused_before_counting():
    inputs = base()
    rows = 120_000
    inputs.update(labels=np.zeros((rows, 1), dtype="<i4"), exclude=np.zeros((rows, 1), dtype="u1"), objects=[],
                  classes=[{"id": f"c{k}", "name": f"c{k}", "counts": True} for k in range(300)],
                  stack_offsets=np.array([0, 0], dtype="<u4"), stack_members=None)
    inputs["settings"].update(width=1, height=rows, roi={"x0": 0, "y0": 0, "x1": 1, "y1": rows}, bottom=float(rows))
    with pytest.raises(MethodError) as caught:
        section_intervals.parse(inputs)
    assert (caught.value.code, caught.value.field) == ("LIMIT_EXCEEDED", "classes")


def test_every_valid_fixture_input_is_accepted_without_changing_its_meaning():
    # parse() must accept every reference input (checked above through run) and keep the effective-class rule of §4.
    inputs = inputs_of(fixtures.load("predictions-and-candidates-counted"))
    parsed = section_intervals.parse(inputs)
    assert parsed.class_of_object.tolist() == fixtures.class_of_object(fixtures.load("predictions-and-candidates-counted")["inputs"]).tolist()


def test_padding_comparisons_are_strict_at_exact_float_equality():
    # The program pads an interval when bottom > gap_start + 1e-9 and top < gap_end - 1e-9 (strict). Equality of the
    # floating-point numbers themselves is not reachable through a section, so the helper is tested directly.
    pad = 2.0
    top = np.array([0.0, 2.0, 4.0, 6.0, 8.0])
    bottom = top + 2
    no_data = np.array([False, False, True, False, False])          # the gap [4, 6] widens to [2 + 1e-9, 8 - 1e-9]
    assert section_intervals._pad_no_data(no_data, top, bottom, pad).tolist() == [False, True, False, True, False]
    start, end = (4.0 - pad) + 1e-9, (6.0 + pad) - 1e-9
    just_below = lambda x: np.nextafter(x, -np.inf)                 # noqa: E731
    just_above = lambda x: np.nextafter(x, np.inf)                  # noqa: E731
    for bottom_of_first, expected in ((start, False), (just_above(start), True)):
        b = bottom.copy()
        b[0] = bottom_of_first
        assert section_intervals._pad_no_data(no_data, top, b, pad)[0] == expected
    for top_of_last, expected in ((end, False), (just_below(end), True)):
        t = top.copy()
        t[4] = top_of_last
        assert section_intervals._pad_no_data(no_data, t, bottom, pad)[4] == expected
    assert not section_intervals._pad_no_data(no_data, top, bottom, 0.0).any()                   # no padding
    assert not section_intervals._pad_no_data(np.zeros(5, dtype=bool), top, bottom, pad).any()   # no gap to widen


# ---- what a long-lived caller may remember between jobs (card M8.4.3) ------------------------------------------------------

def hashes_of(inputs):
    """Stand-ins for the SHA-256 the coordinator verified: any stable digest of the bytes serves for the test."""
    import hashlib
    return {name: hashlib.sha256(np.ascontiguousarray(value).tobytes()).hexdigest() for name, value in inputs.items()
            if isinstance(value, np.ndarray)}


@pytest.fixture
def counting_spy(monkeypatch):
    calls = []
    real = section_intervals.object_row_counts

    def spy(*args, **kwargs):
        calls.append(1)
        return real(*args, **kwargs)

    monkeypatch.setattr(section_intervals, "object_row_counts", spy)
    return calls


def memo_run(inputs, memo, hashes=None):
    snapshot = section_intervals.parse(inputs, hashes=hashes or hashes_of(inputs), memo=memo)
    return section_intervals.run(snapshot, memo=memo)


def same(a, b):
    assert a.dimensions == b.dimensions and a.columns.keys() == b.columns.keys()
    for key in a.columns:
        np.testing.assert_array_equal(a.columns[key], b.columns[key], err_msg=key)


def test_a_second_job_on_the_same_masks_does_not_count_again_and_gives_the_same_result(counting_spy):
    inputs, memo = inputs_of(fixtures.load("large-mixed")), section_intervals.new_memo()
    first = memo_run(inputs, memo)
    blocks = len(counting_spy)
    assert blocks > 0
    second = memo_run(inputs, memo)
    assert len(counting_spy) == blocks, "the second job counted nothing"
    same(first, second)
    same(first, section_intervals.run(section_intervals.parse(inputs)))      # and it is the result of the call without any memory


def test_changing_only_the_settings_reuses_the_counts_and_matches_a_fresh_calculation(counting_spy):
    inputs, memo = inputs_of(fixtures.load("large-mixed")), section_intervals.new_memo()
    memo_run(inputs, memo)
    blocks = len(counting_spy)
    for bin_cm in (1.37, 5.0, 0.2):
        changed = {**inputs, "settings": {**inputs["settings"], "bin_cm": bin_cm}}
        expected = section_intervals.run(section_intervals.parse(changed))       # without any memory (the spy counts it too)
        blocks += len(counting_spy) - blocks
        got = memo_run(changed, memo)
        assert len(counting_spy) == blocks, f"bin_cm {bin_cm}: counts reused"
        same(got, expected)


def altered(inputs, how):
    out = {name: (value.copy() if isinstance(value, np.ndarray) else copy.deepcopy(value)) for name, value in inputs.items()}
    how(out)
    return out


def test_every_component_of_the_count_key_forces_a_new_count(counting_spy):
    base = inputs_of(fixtures.load("large-mixed"))
    memo = section_intervals.new_memo()
    memo_run(base, memo)
    blocks = len(counting_spy)

    def move_roi(i):
        i["settings"]["roi"]["y0"] += 1

    def other_label(i):
        flat = i["labels"].reshape(-1)
        k = int(np.flatnonzero(flat == 0)[0])
        flat[k] = int(flat[flat > 0][0])

    def other_exclusion(i):
        flat = i["exclude"].reshape(-1)
        k = int(np.flatnonzero(flat == 0)[0])
        flat[k] = 1

    def other_class_of_an_object(i):
        i["objects"][0]["class_id"] = next(c["id"] for c in i["classes"] if c["id"] != i["objects"][0]["class_id"] and c["counts"])

    def other_counted_class(i):
        i["classes"][0]["counts"] = not i["classes"][0]["counts"]

    def prediction_now_counts(i):
        i["settings"]["include_predictions"] = not i["settings"]["include_predictions"]
        i["settings"]["count_candidates"] = not i["settings"]["count_candidates"]

    def one_more_class(i):
        i["classes"].append({"id": "extra", "name": "Extra", "counts": True})        # the table of objects is the same; only the width of the counts changes

    tested = []
    cases = {"roi": move_roi, "labels": other_label, "exclusion": other_exclusion, "class of an object": other_class_of_an_object,
             "which classes count": other_counted_class, "how objects get a class": prediction_now_counts, "number of classes": one_more_class}
    for label, change in cases.items():
        before = len(counting_spy)
        changed = altered(base, change)
        if label == "number of classes":
            assert np.array_equal(section_intervals.parse(changed).class_of_object, section_intervals.parse(base).class_of_object)
        if label in ("which classes count", "how objects get a class"):
            assert not np.array_equal(section_intervals.parse(changed).class_of_object, section_intervals.parse(base).class_of_object), (
                f"{label}: the change must alter the object-to-class table, or it tests nothing")
        got = memo_run(changed, memo)
        assert len(counting_spy) > before, f"{label}: counted again"
        same(got, section_intervals.run(section_intervals.parse(changed)))
        tested.append(label)
    assert len(counting_spy) > blocks
    assert tested == list(cases), tested


def test_a_changed_stack_table_forces_a_new_count(counting_spy):
    base = inputs_of(fixtures.load("overlap-same-and-different-class"))
    memo = section_intervals.new_memo()
    memo_run(base, memo)
    before = len(counting_spy)
    other = altered(base, lambda i: i["stack_members"].__setitem__(slice(None), i["stack_members"][::-1]))
    if not np.array_equal(other["stack_members"], base["stack_members"]):
        got = memo_run(other, memo)
        assert len(counting_spy) > before, "stack members"
        same(got, section_intervals.run(section_intervals.parse(other)))
    before = len(counting_spy)
    memo_run(base, memo, {**hashes_of(base), "stack_offsets": "0" * 64})       # the offsets are identified by their hash
    assert len(counting_spy) > before, "stack offsets"


def test_without_hashes_or_a_memo_nothing_is_remembered(counting_spy):
    inputs = inputs_of(fixtures.load("basic-four-intervals"))
    section_intervals.run(section_intervals.parse(inputs))
    first = len(counting_spy)
    section_intervals.run(section_intervals.parse(inputs))
    assert len(counting_spy) == 2 * first
    memo = section_intervals.new_memo()
    snapshot = section_intervals.parse(inputs, memo=memo)                 # a memo but no hashes: no key
    assert snapshot.count_key is None
    section_intervals.run(snapshot, memo=memo)
    section_intervals.run(snapshot, memo=memo)
    assert len(counting_spy) == 4 * first and not memo["counts"] and not memo["exclude_ok"] and not memo["labels_ok"]


def test_an_invalid_mask_is_rejected_on_first_sight_and_a_remembered_one_is_not_rechecked():
    inputs = inputs_of(fixtures.load("basic-four-intervals"))
    memo = section_intervals.new_memo()
    memo_run(inputs, memo)
    bad_exclusion = altered(inputs, lambda i: i["exclude"].reshape(-1).__setitem__(0, 2))
    with pytest.raises(MethodError) as error:
        memo_run(bad_exclusion, memo)                                     # other bytes, other hash: the rule is applied
    assert (error.value.code, error.value.field) == ("INVALID_BUFFER", "exclude")
    assert memo["exclude_ok"] == {hashes_of(inputs)["exclude"]}, "a rejected mask is never remembered"
    bad_label = altered(inputs, lambda i: i["labels"].reshape(-1).__setitem__(0, 9999))
    with pytest.raises(MethodError) as error:
        memo_run(bad_label, memo)
    assert (error.value.code, error.value.field) == ("INVALID_BUFFER", "labels")
    assert len(memo["labels_ok"]) == 1


def test_masks_validated_against_one_object_list_are_checked_again_for_another():
    inputs = inputs_of(fixtures.load("basic-four-intervals"))
    memo = section_intervals.new_memo()
    memo_run(inputs, memo)
    fewer = altered(inputs, lambda i: i["objects"].pop())                 # the last object disappears from the table, its pixels stay
    used = {int(v) for v in np.unique(inputs["labels"]) if v > 0}
    if int(inputs["objects"][-1]["id"]) in used:
        with pytest.raises(MethodError) as error:
            memo_run(fewer, memo)
        assert (error.value.code, error.value.field) == ("INVALID_BUFFER", "labels")


def test_the_memory_of_counts_is_bounded_and_its_arrays_are_read_only(monkeypatch):
    inputs, memo = inputs_of(fixtures.load("basic-four-intervals")), section_intervals.new_memo()
    monkeypatch.setattr(section_intervals, "MEMO_COUNT_ENTRIES", 3)
    for k in range(8):
        hashes = {**hashes_of(inputs), "labels": f"{k:064x}"}
        memo_run(inputs, memo, hashes)
    assert len(memo["counts"]) == 3
    assert list(memo["counts"])[-1][0] == f"{7:064x}", "the oldest entries went first"
    for entry in memo["counts"].values():
        assert all(not array.flags.writeable for array in entry)
    monkeypatch.setattr(section_intervals, "MEMO_COUNT_BYTES", 1)
    memo_run(inputs, memo, {**hashes_of(inputs), "labels": "f" * 64})
    assert not memo["counts"], "an entry larger than the bound is not kept"
    monkeypatch.setattr(section_intervals, "MEMO_CHECKS", 2)
    for k in range(5):
        memo_run(inputs, memo, {**hashes_of(inputs), "exclude": f"{k:064x}"})
    assert len(memo["exclude_ok"]) <= 2


def test_a_cancelled_count_is_not_remembered():
    inputs, memo = inputs_of(fixtures.load("large-mixed")), section_intervals.new_memo()
    snapshot = section_intervals.parse(inputs, hashes=hashes_of(inputs), memo=memo)
    with pytest.raises(Cancelled):
        section_intervals.run(snapshot, cancelled=lambda: True, memo=memo)
    assert not memo["counts"]


def test_the_least_recently_used_counts_are_dropped_first(monkeypatch):
    inputs, memo = inputs_of(fixtures.load("basic-four-intervals")), section_intervals.new_memo()
    monkeypatch.setattr(section_intervals, "MEMO_COUNT_ENTRIES", 2)

    def key(k):
        return {**hashes_of(inputs), "labels": f"{k:064x}"}

    memo_run(inputs, memo, key(1))
    memo_run(inputs, memo, key(2))
    memo_run(inputs, memo, key(1))                                                 # 1 is used again: 2 is now the oldest
    memo_run(inputs, memo, key(3))
    assert sorted(entry[0] for entry in memo["counts"]) == [f"{1:064x}", f"{3:064x}"]
