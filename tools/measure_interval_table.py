"""Time the part of an interval-table update that does not depend on the image: row counts -> table (card M8.4.12).

The engine method ``section.intervals/1`` remembers the row counts of masks it has already counted. A change that leaves the masks alone (or an
edit whose rows have just been recounted) therefore costs only the conversion of the row counts into bins, percentages and indices. This tool
measures exactly that, in-process and without the transport, for a section as tall as the 8 GiB fixture of card M8.4.13 (349,526 rows) so that
the part C rule of contract §7 (decision D11) can add it to the measured round trip of a one-tile edit.

Usage: python tools/measure_interval_table.py [--rows 349526] [--width 64] [--classes 16] [--calls 20] [--out report.json]
Nothing here copies a formula: the method's own ``parse`` and ``run`` are called with a memo, as the engine's worker does.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import statistics
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from sedcoretool.methods import section_intervals  # noqa: E402  (path set above)

SCHEMES = [
    {"name": "BI", "precedence": "first", "tiers": [{"lower": 0, "upper": 1, "value": 0}, {"lower": 1, "upper": 5, "value": 1}, {"lower": 5, "upper": 31, "value": 2},
                                                    {"lower": 31, "upper": 61, "value": 3}, {"lower": 61, "upper": 91, "value": 4}, {"lower": 91, "upper": 100, "value": 5},
                                                    {"lower": 100, "upper": 101, "value": 6}]},
    {"name": "ii", "precedence": "first", "tiers": [{"lower": 0, "upper": 1, "value": 1}, {"lower": 1, "upper": 10, "value": 2}, {"lower": 10, "upper": 40, "value": 3},
                                                    {"lower": 40, "upper": 60, "value": 4}, {"lower": 60, "upper": 100, "value": 5}, {"lower": 100, "upper": 101, "value": 6}]},
]
PIXELS_PER_CM = 10


def build_inputs(rows: int, width: int, classes: int, seed: int = 138501) -> dict:
    """Inputs of the method for one tall section: ``classes`` classes with one object each, about 40 % of the pixels labelled, no overlaps."""
    rng = np.random.Generator(np.random.PCG64(seed))
    labels = np.where(rng.random((rows, width)) < 0.4, rng.integers(1, classes + 1, size=(rows, width)), 0).astype("<i4")
    exclude = (rng.random((rows, width)) < 0.05).astype("u1")
    ids = [f"c{i}" for i in range(classes)]
    return {
        "labels": labels, "exclude": exclude,
        "objects": [{"id": i + 1, "class_id": ids[i], "predicted_class_id": None, "confidence": 0} for i in range(classes)],
        "classes": [{"id": ids[i], "name": f"Class {i}", "counts": True} for i in range(classes)],
        "stack_offsets": np.zeros(2, dtype="<u4"), "stack_members": None,
        "settings": {"width": width, "height": rows, "roi": {"x0": 0, "y0": 0, "x1": width, "y1": rows}, "top": 0, "bottom": rows / PIXELS_PER_CM, "units": "cm",
                     "bin_cm": 2, "min_valid": 0.2, "no_data_pad_cm": 0, "include_predictions": False, "prediction_threshold": 0.5, "count_candidates": False,
                     "schemes": SCHEMES, "age_units": None},
        "age_model": [], "manual_indices": [],
    }


def hashes_of(inputs: dict) -> dict:
    return {name: hashlib.sha256(np.ascontiguousarray(value).tobytes()).hexdigest() for name, value in inputs.items() if isinstance(value, np.ndarray)}


def percentile(values: list[float], p: float) -> float:
    """Nearest-rank percentile, the rule of contract §7."""
    ordered = sorted(values)
    return ordered[max(0, int(np.ceil(p * len(ordered))) - 1)]


def measure(rows: int, width: int, classes: int, calls: int) -> dict:
    inputs = build_inputs(rows, width, classes)
    hashes, memo = hashes_of(inputs), section_intervals.new_memo()
    sizes = (2, 1.37)
    references: dict[float, dict] = {}

    def once(bin_cm: float) -> tuple[float, dict]:
        changed = dict(inputs, settings=dict(inputs["settings"], bin_cm=bin_cm))
        start = time.perf_counter()
        result = section_intervals.run(section_intervals.parse(changed, hashes=hashes, memo=memo), memo=memo)
        return (time.perf_counter() - start) * 1000, result.columns

    cold_ms, columns = once(sizes[0])
    references[sizes[0]] = columns
    _, references[sizes[1]] = once(sizes[1])
    timings = []
    for call in range(calls):
        bin_cm = sizes[call % 2]
        elapsed, columns = once(bin_cm)
        # A call that counted again would be much slower and is not what is being measured: the columns must be the first call's, to the bit.
        assert columns.keys() == references[bin_cm].keys()
        for name, values in columns.items():
            np.testing.assert_array_equal(values, references[bin_cm][name], err_msg=name)
        timings.append(elapsed)
    return {
        "rows": rows, "width": width, "classes": classes, "pixels": rows * width, "calls": calls, "bins": int(len(references[sizes[0]]["row_start"])) if "row_start" in references[sizes[0]] else None,
        "cold_first_call_ms": round(cold_ms, 2), "remembered_counts_ms": [round(t, 3) for t in timings],
        "median_ms": round(statistics.median(timings), 3), "p95_ms": round(percentile(timings, 0.95), 3), "max_ms": round(max(timings), 3),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--rows", type=int, default=349_526)
    parser.add_argument("--width", type=int, default=64)
    parser.add_argument("--classes", type=int, default=16)
    parser.add_argument("--calls", type=int, default=20)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    report = {"tool": "tools/measure_interval_table.py", "python": platform.python_version(), "numpy": np.__version__, "platform": platform.platform(),
              "processor": platform.processor(), **measure(args.rows, args.width, args.classes, args.calls)}
    text = json.dumps(report, indent=2)
    if args.out:
        args.out.write_text(text + "\n", encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
