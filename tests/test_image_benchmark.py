"""Reproducibility and failure-preservation boundaries of the large-image benchmark."""

import importlib
import json
from pathlib import Path
from zipfile import ZipFile

import numpy as np
import pytest
from PIL import Image


@pytest.fixture(scope="module")
def image_benchmark():
    with pytest.MonkeyPatch.context() as patch:
        patch.syspath_prepend(str(Path(__file__).resolve().parents[1] / "tools"))
        return importlib.import_module("benchmark_images")


@pytest.mark.parametrize("height", [0, True, "6400", 16001])
def test_synthetic_fixture_rejects_unsupported_dimensions(image_benchmark, tmp_path, height):
    with pytest.raises(ValueError, match="section height"):
        image_benchmark.make_synthetic(tmp_path / "invalid.zip", height=height)
    assert not (tmp_path / "invalid.zip").exists()


def test_synthetic_fixture_is_deterministic_and_preserves_image_mask_geometry(image_benchmark, tmp_path):
    first, second = tmp_path / "first.zip", tmp_path / "second.zip"
    image_benchmark.make_synthetic(first, height=256)
    image_benchmark.make_synthetic(second, height=256)
    assert first.read_bytes() == second.read_bytes()
    with ZipFile(first) as archive:
        project = json.loads(archive.read("project.json"))
        sections = project["cores"][0]["sections"]
        assert len(sections) == 8
        for index, section in enumerate(sections):
            assert (section["w"], section["h"], section["ds"]) == (960, 256, 1)
            assert (section["top"], section["bottom"]) == (index * 128, (index + 1) * 128)
            with archive.open(section["file"]["path"]) as source, Image.open(source) as image:
                assert image.size == (960, 256)
            for name in ("labels", "exclude"):
                runs = np.asarray(section[name]).reshape(-1, 2)
                assert np.all(runs[:, 1] > 0)
                assert runs[:, 1].sum() == 960 * 256
            assert {obj["cls"] for obj in section["objects"]} == {"chondrites", "planolites"}


def test_failed_report_write_preserves_the_last_valid_report(image_benchmark, tmp_path, monkeypatch):
    destination = tmp_path / "report.json"
    image_benchmark.write_report(destination, {"complete": False, "cases": [{"case": "first"}]})
    previous = destination.read_bytes()
    with pytest.raises(ValueError):
        image_benchmark.write_report(destination, {"duration": float("nan")})
    assert destination.read_bytes() == previous

    def fail_replace(self, target):
        raise OSError("Simulated interrupted publication")

    monkeypatch.setattr(Path, "replace", fail_replace)
    with pytest.raises(OSError, match="interrupted"):
        image_benchmark.write_report(destination, {"complete": True})
    assert destination.read_bytes() == previous


def test_provenance_distinguishes_newlines_from_application_edits(image_benchmark, tmp_path, monkeypatch):
    source = tmp_path / "app/js/app.js"
    source.parent.mkdir(parents=True)
    expected = b"export const DELIVERY = 'V0.1';\n"
    source.write_bytes(expected.replace(b"\n", b"\r\n"))
    licence = tmp_path / "app/vendor/LICENSE-library-1.0"
    licence.parent.mkdir(parents=True)
    licence.write_bytes(b"Library licence\r\n")
    for name in (*image_benchmark.SOURCES, "tools/benchmark.py", "tools/benchmark_browser.mjs"):
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"benchmark tool\n")

    def fake_git(*args):
        if args[0] in ("ls-files", "ls-tree"):
            names = b"app/js/app.js\0app/vendor/LICENSE-library-1.0\0"
            if args[0] == "ls-files" and (tmp_path / "app/js/added.js").exists():
                names += b"app/js/added.js\0"
            return names
        if args[0] == "show":
            return expected if args[1] == "HEAD:app/js/app.js" else b"Library licence\n"
        assert args == ("rev-parse", "HEAD")
        return b"a" * 40

    monkeypatch.setattr(image_benchmark, "ROOT", tmp_path)
    monkeypatch.setattr(image_benchmark, "git", fake_git)
    before = image_benchmark.application_provenance()
    assert before["matches_head"] is True
    assert before["modified_files"] == []
    source.write_bytes(expected + b"// changed\n")
    after = image_benchmark.application_provenance()
    assert after["matches_head"] is False
    assert after["modified_files"] == ["app/js/app.js"]
    assert after["files_sha256"] != before["files_sha256"]
    assert after["tool_sha256"] == before["tool_sha256"]
    source.write_bytes(expected)
    (tmp_path / "app/js/added.js").write_text("// new measured module\n", encoding="utf-8")
    added = image_benchmark.application_provenance()
    assert added["modified_files"] == ["app/js/added.js"]
    assert added["files_sha256"] != before["files_sha256"]


@pytest.mark.parametrize("width", [0, True, "960", 255, 4097])
def test_synthetic_fixture_rejects_unsupported_widths(image_benchmark, tmp_path, width):
    with pytest.raises(ValueError, match="section width"):
        image_benchmark.make_synthetic(tmp_path / "invalid.zip", width=width)
    assert not (tmp_path / "invalid.zip").exists()


def test_synthetic_fixture_with_a_width_keeps_every_trace_inside_the_image_and_is_deterministic(image_benchmark, tmp_path):
    first, second = tmp_path / "first.zip", tmp_path / "second.zip"
    image_benchmark.make_synthetic(first, height=512, width=512)
    image_benchmark.make_synthetic(second, height=512, width=512)
    assert first.read_bytes() == second.read_bytes()
    with ZipFile(first) as archive:
        sections = json.loads(archive.read("project.json"))["cores"][0]["sections"]
        assert len(sections) == 8
        for section in sections:
            assert (section["w"], section["h"]) == (512, 512)
            assert section["roi"] == {"x0": 20, "x1": 492, "y0": 0, "y1": 512}
            assert section["objects"]
            for obj in section["objects"]:
                stats = obj["st"]
                assert 0 <= stats["x0"] <= stats["x1"] < 512 and 0 <= stats["y0"] <= stats["y1"] < 512
            with archive.open(section["file"]["path"]) as source, Image.open(source) as image:
                assert image.size == (512, 512)


def test_the_default_synthetic_geometry_did_not_change(image_benchmark, tmp_path):
    """The 960-pixel fixture of M0.1 is referenced by recorded evidence: its traces must stay where they were."""
    image_benchmark.make_synthetic(tmp_path / "default.zip", height=256)
    with ZipFile(tmp_path / "default.zip") as archive:
        first = json.loads(archive.read("project.json"))["cores"][0]["sections"][0]["objects"]
    left, right = first[0]["st"], first[1]["st"]
    assert left["x0"] == 32 and right["x0"] == 480
    assert left["x1"] - 32 < 430 and right["x1"] - 480 < 430
