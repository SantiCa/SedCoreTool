"""The timing tool of card M8.4.12 must time remembered counts, not a recount, and report the rule's percentile."""

import importlib
import sys
from pathlib import Path

import pytest


@pytest.fixture(scope="module")
def tool():
    with pytest.MonkeyPatch.context() as patch:
        patch.syspath_prepend(str(Path(__file__).resolve().parents[1] / "tools"))
        sys.modules.pop("measure_interval_table", None)
        return importlib.import_module("measure_interval_table")


def test_nearest_rank_percentile_is_the_rule_of_contract_7(tool):
    assert tool.percentile([5, 1, 3, 2, 4], 0.95) == 5
    assert tool.percentile(list(range(1, 21)), 0.95) == 19
    assert tool.percentile([7], 0.95) == 7


def test_measurement_times_remembered_counts_and_checks_every_call_against_the_first(tool, monkeypatch):
    from sedcoretool.methods import section_intervals

    counted = []
    real = section_intervals.object_row_counts
    monkeypatch.setattr(section_intervals, "object_row_counts", lambda *a, **k: counted.append(1) or real(*a, **k))
    tool.measure(rows=1500, width=12, classes=3, calls=2)
    once = len(counted)
    assert once > 0
    counted.clear()
    report = tool.measure(rows=1500, width=12, classes=3, calls=9)
    assert len(counted) == once, "the masks were counted once however many table updates were timed"
    assert report["calls"] == 9 and len(report["remembered_counts_ms"]) == 9
    assert report["median_ms"] <= report["p95_ms"] <= report["max_ms"]
    assert report["bins"] > 1


def test_inputs_are_deterministic(tool):
    first, second = tool.build_inputs(300, 8, 2), tool.build_inputs(300, 8, 2)
    assert (first["labels"] == second["labels"]).all() and (first["exclude"] == second["exclude"]).all()
    assert tool.hashes_of(first) == tool.hashes_of(second)
