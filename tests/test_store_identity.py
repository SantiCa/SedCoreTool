"""The identity record of the tile store (card M8.4.15, contract §8.2): a file hashed before in the same state finds its pyramid without being
read whole; any change of path, size, modification time or sampled bytes falls back to the full hash; a bad record is ignored."""

import json
import os
import shutil
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from conftest import require_pyvips

require_pyvips()

from sedcoretool.store import identity  # noqa: E402
from sedcoretool.store import pyramid as pyr  # noqa: E402

GiB = 2**30


def image(path: Path, seed=0, size=(600, 700)) -> Path:
    Image.fromarray(np.random.default_rng(seed).integers(0, 256, size=(*size, 3), dtype=np.uint8)).save(path)
    return path


def build(source, root, progress=None):
    stages = progress if progress is not None else []
    return pyr.build(source, root, name=source.name, budget=50 * GiB, progress=lambda stage, *_: stages.append(stage))


def no_full_hash(monkeypatch):
    def refuse(*_args, **_kwargs):
        raise AssertionError("the whole file was hashed")
    monkeypatch.setattr(pyr, "source_digest", refuse)


def test_a_file_hashed_before_finds_its_pyramid_without_being_read_whole(tmp_path, monkeypatch):
    source, root = image(tmp_path / "core.png"), tmp_path / "root"
    first = build(source, root)
    record = json.loads((root / identity.RECORD_NAME).read_text(encoding="utf-8"))
    assert record["format"] == "sedcoretool.identities" and record["version"] == 1
    assert [entry["sha256"] for entry in record["entries"]] == [first["pyramid"]]
    no_full_hash(monkeypatch)
    stages = []
    again = build(source, root, stages)
    assert again == {**first, "reused": True}
    assert "hash" not in stages


def test_a_changed_file_is_hashed_again_even_with_the_same_size_and_time(tmp_path):
    pixels = np.random.default_rng(0).integers(0, 256, size=(600, 700, 3), dtype=np.uint8)
    source, root = tmp_path / "core.tif", tmp_path / "root"
    Image.fromarray(pixels).save(source)                               # uncompressed: one changed pixel keeps the size
    first = build(source, root)
    status = source.stat()
    pixels[300, 350] ^= 0xFF
    Image.fromarray(pixels).save(source)
    os.utime(source, ns=(status.st_atime_ns, status.st_mtime_ns))
    assert source.stat().st_size == status.st_size and source.stat().st_mtime_ns == status.st_mtime_ns
    stages = []
    other = build(source, root, stages)                                # small file: the sample is the whole file, so the change is seen
    assert "hash" in stages and other["pyramid"] != first["pyramid"] and not other["reused"]


def test_a_touched_or_renamed_file_is_hashed_again_and_reuses_the_same_pyramid(tmp_path):
    source, root = image(tmp_path / "core.png"), tmp_path / "root"
    first = build(source, root)
    os.utime(source, ns=(source.stat().st_atime_ns, source.stat().st_mtime_ns + 10**9))
    stages = []
    assert build(source, root, stages) == {**first, "reused": True} and "hash" in stages
    moved = tmp_path / "elsewhere.png"
    shutil.copy2(source, moved)
    stages = []
    assert build(moved, root, stages)["pyramid"] == first["pyramid"] and "hash" in stages
    paths = [entry["path"] for entry in identity.read_entries(root)]
    assert len(paths) == 2 and len(set(paths)) == 2                    # one entry per path, the newest state of each


def test_a_record_pointing_to_a_deleted_pyramid_builds_it_again(tmp_path):
    source, root = image(tmp_path / "core.png"), tmp_path / "root"
    first = build(source, root)
    shutil.rmtree(root / first["pyramid"])                             # evicted by the budget, for example
    stages = []
    again = build(source, root, stages)
    assert again["pyramid"] == first["pyramid"] and not again["reused"] and "hash" in stages


@pytest.mark.parametrize("content", [
    b"not json",
    json.dumps({"format": "sedcoretool.identities", "version": 2, "entries": []}).encode(),
    json.dumps({"format": "sedcoretool.identities", "version": 1, "entries": [{"path": "x", "size": -1, "mtime_ns": 0, "sample": "0" * 64, "sha256": "0" * 64}]}).encode(),
    json.dumps({"format": "sedcoretool.identities", "version": 1, "entries": [{"path": "x", "size": 1, "mtime_ns": 0, "sample": "0" * 64, "sha256": "../../x"}]}).encode(),
    json.dumps({"format": "sedcoretool.identities", "version": 1, "entries": [{"path": "x", "size": True, "mtime_ns": 0, "sample": "0" * 64, "sha256": "0" * 64}]}).encode(),
    b" " * (identity.MAX_RECORD_BYTES + 1),
], ids=["not-json", "other-version", "negative-size", "path-as-hash", "boolean-size", "oversized"])
def test_a_bad_record_is_ignored_and_replaced(tmp_path, content):
    source, root = image(tmp_path / "core.png"), tmp_path / "root"
    root.mkdir()
    (root / identity.RECORD_NAME).write_bytes(content)
    assert identity.read_entries(root) == []
    first = build(source, root)
    assert [entry["sha256"] for entry in identity.read_entries(root)] == [first["pyramid"]]


def test_a_forged_record_cannot_point_outside_the_root(tmp_path):
    source, root = image(tmp_path / "core.png"), tmp_path / "root"
    first = build(source, root)
    entries = identity.read_entries(root)
    entries[0]["sha256"] = "f" * 64                                    # a well-formed hash of no pyramid: ignored, full hash
    (root / identity.RECORD_NAME).write_text(json.dumps({"format": identity.FORMAT, "version": 1, "entries": entries}), encoding="utf-8")
    stages = []
    assert build(source, root, stages) == {**first, "reused": True} and "hash" in stages


def test_the_record_keeps_at_most_its_bounded_number_of_entries(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    for i in range(identity.MAX_ENTRIES + 5):
        identity.remember(root, {"path": f"C:/data/file{i}.tif", "size": i, "mtime_ns": i}, "a" * 64, "b" * 64)
    entries = identity.read_entries(root)
    assert len(entries) == identity.MAX_ENTRIES and entries[-1]["path"] == f"C:/data/file{identity.MAX_ENTRIES + 4}.tif"
    assert (root / identity.RECORD_NAME).stat().st_size <= identity.MAX_RECORD_BYTES


def test_known_limit_a_change_between_the_samples_with_the_same_time_is_not_seen(tmp_path):
    """Documents the limit stated in identity.py: bytes changed between the sampled MiB, with size and modification time restored."""
    source, root = tmp_path / "big.bin", tmp_path / "root"
    data = bytearray(np.random.default_rng(5).integers(0, 256, size=5 * identity.SAMPLE_BYTES, dtype=np.uint8).tobytes())
    source.write_bytes(bytes(data))
    key = identity.file_key(source)
    identity.remember(root.mkdir() or root, key, identity.sample_digest(source, key["size"]), "c" * 64)
    data[identity.SAMPLE_BYTES + 10] ^= 0xFF                           # between the first and the middle sample
    source.write_bytes(bytes(data))
    os.utime(source, ns=(key["mtime_ns"], key["mtime_ns"]))
    again = identity.file_key(source)
    assert identity.lookup(root, again, identity.sample_digest(source, again["size"])) == "c" * 64
    data[len(data) // 2] ^= 0xFF                                       # inside the middle sample: seen
    source.write_bytes(bytes(data))
    os.utime(source, ns=(key["mtime_ns"], key["mtime_ns"]))
    assert identity.lookup(root, again, identity.sample_digest(source, again["size"])) is None
