"""Pixel pyramids (card M8.4.14, contract §8.2 and §8.4): exact levels, the documented files, and safe failure."""

import errno
import hashlib
import importlib
import json
import os
import sys
import zlib
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

pytest.importorskip("pyvips")

from sedcoretool.methods.errors import Cancelled, MethodError  # noqa: E402
from sedcoretool.store import format as fmt  # noqa: E402
from sedcoretool.store import pyramid as pyr  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
GiB = 2**30


@pytest.fixture(scope="module")
def gen():
    with pytest.MonkeyPatch.context() as patch:
        patch.syspath_prepend(str(ROOT / "tools"))
        sys.modules.pop("make_large_fixtures", None)
        return importlib.import_module("make_large_fixtures")


def slow_halve(a):
    """The rule of contract §8.2 written with loops: per channel, the integer mean of the covered pixels, rounded half up."""
    h, w, c = a.shape
    out = np.zeros(((h + 1) // 2, (w + 1) // 2, c), a.dtype)
    for y in range(out.shape[0]):
        for x in range(out.shape[1]):
            block = a[2 * y:2 * y + 2, 2 * x:2 * x + 2].reshape(-1, c).astype(np.int64)
            n = block.shape[0]
            out[y, x] = (block.sum(axis=0) + n // 2) // n
    return out


@pytest.mark.parametrize("shape, dtype", [((7, 9, 3), np.uint8), ((6, 5, 1), np.uint16), ((1, 1, 4), np.uint8), ((2, 7, 3), np.uint16), ((9, 2, 1), np.uint8)])
def test_halving_is_the_rounded_integer_mean_of_the_covered_pixels(shape, dtype):
    rng = np.random.default_rng(7)
    top = 256 if dtype == np.uint8 else 65536
    for _ in range(20):
        a = rng.integers(0, top, size=shape).astype(dtype)
        np.testing.assert_array_equal(pyr.halve(a), slow_halve(a))
    extreme = np.full(shape, top - 1, dtype)
    np.testing.assert_array_equal(pyr.halve(extreme), extreme[: (shape[0] + 1) // 2, : (shape[1] + 1) // 2])   # no overflow
    assert pyr.halve(np.array([[[1], [2]]], np.uint8))[0, 0, 0] == 2           # (1 + 2 + 1) // 2: half rounds up


def read_level(folder, level, channels, dtype, compressor):
    """Reassemble a level from its tile files, checking each tile against .tiles.sha256."""
    desc = fmt.read_description(folder)
    lv = desc["levels"][level]
    hashes = (folder / str(level) / ".tiles.sha256").read_bytes()
    assert len(hashes) == lv["rows"] * lv["cols"] * 32
    image = np.zeros((lv["rows"] * 512, lv["cols"] * 512, channels), dtype)
    for row in range(lv["rows"]):
        for col in range(lv["cols"]):
            raw = (folder / str(level) / f"{row}.{col}.0").read_bytes()
            data = zlib.decompress(raw) if compressor else raw
            assert len(data) == fmt.tile_bytes(channels, np.dtype(dtype).itemsize * 8)
            index = (row * lv["cols"] + col) * 32
            assert hashlib.sha256(data).digest() == hashes[index:index + 32]
            image[row * 512:(row + 1) * 512, col * 512:(col + 1) * 512] = np.frombuffer(data, dtype).reshape(512, 512, channels)
    assert not image[lv["height"]:].any() and not image[:, lv["width"]:].any()     # edge padding is zero
    return image[: lv["height"], : lv["width"]]


@pytest.mark.parametrize("channels, bits, compressor", [(3, 8, None), (3, 8, fmt.ZLIB), (1, 16, None)])
def test_every_level_of_a_generator_image_is_exact(tmp_path, gen, channels, bits, compressor):
    source = tmp_path / "source.tif"
    gen.write_bigtiff(source, width=gen.WIDTH, rows=1100, channels=channels, bits=bits, kind="tiled", compression=8)
    events = []
    result = pyr.build(source, tmp_path / "root", name="source.tif", budget=50 * GiB, compressor=compressor, progress=lambda *e: events.append(e))
    folder = tmp_path / "root" / result["pyramid"]
    assert result["pyramid"] == hashlib.sha256(source.read_bytes()).hexdigest()
    assert (result["width"], result["height"], result["channels"], result["bits"], result["reused"]) == (gen.WIDTH, 1100, channels, bits, False)
    dtype = np.uint8 if bits == 8 else np.dtype("<u2")
    expected = gen.pixel_region(0, 0, gen.WIDTH, 1100, channels=channels, bits=bits).reshape(1100, gen.WIDTH, channels)
    levels = fmt.levels_for(gen.WIDTH, 1100)
    assert [(lv.width, lv.height) for lv in levels] == [(8192, 1100), (4096, 550), (2048, 275), (1024, 138), (512, 69)]
    for lv in levels:
        np.testing.assert_array_equal(read_level(folder, lv.level, channels, dtype, compressor), expected, err_msg=f"level {lv.level}")
        expected = slow_halve(expected) if lv.width * lv.height < 300_000 else pyr.halve(expected)
    stages = [e[0] for e in events]
    assert stages[0] == "hash" and "level0" in stages and stages[-1] == "levels"
    assert events[-1][1] == events[-1][2] == sum(lv.rows * lv.cols for lv in levels)


def test_the_files_follow_contract_8_2(tmp_path):
    source = tmp_path / "grey.png"
    Image.fromarray(np.arange(700 * 1300, dtype=np.uint32).reshape(700, 1300).astype(np.uint16)).save(source)
    result = pyr.build(source, tmp_path / "root", name="grey.png", budget=50 * GiB, compressor=fmt.ZLIB)
    folder = tmp_path / "root" / result["pyramid"]
    desc = json.loads((folder / "pyramid.json").read_bytes())
    assert desc == {"format": "sedcoretool.pyramid", "version": 1, "complete": True, "tile": 512, "width": 1300, "height": 700, "channels": 1,
                    "bits": 16, "compressor": {"id": "zlib", "level": 1}, "source": {"sha256": result["pyramid"], "size": source.stat().st_size, "name": "grey.png"},
                    "levels": [{"level": 0, "width": 1300, "height": 700, "rows": 2, "cols": 3}, {"level": 1, "width": 650, "height": 350, "rows": 1, "cols": 2},
                               {"level": 2, "width": 325, "height": 175, "rows": 1, "cols": 1}]}
    assert json.loads((folder / ".zgroup").read_bytes()) == {"zarr_format": 2}
    assert json.loads((folder / "1/.zarray").read_bytes()) == {"zarr_format": 2, "shape": [350, 650, 1], "chunks": [512, 512, 1], "dtype": "<u2",
                                                              "compressor": {"id": "zlib", "level": 1}, "fill_value": 0, "order": "C", "filters": None,
                                                              "dimension_separator": "."}
    attrs = json.loads((folder / ".zattrs").read_bytes())["multiscales"][0]
    assert [d["path"] for d in attrs["datasets"]] == ["0", "1", "2"] and attrs["datasets"][2]["coordinateTransformations"][0]["scale"] == [4, 4, 1]
    assert sorted(p.name for p in (folder / "0").iterdir()) == [".tiles.sha256", ".zarray", "0.0.0", "0.1.0", "0.2.0", "1.0.0", "1.1.0", "1.2.0"]
    assert not any(p.name.endswith(".tmp") for p in folder.rglob("*"))


def test_two_builds_are_identical_and_compression_does_not_change_the_tiles(tmp_path):
    source = tmp_path / "image.tif"
    rng = np.random.default_rng(3)
    Image.fromarray(rng.integers(0, 256, size=(900, 1100, 3), dtype=np.uint8)).save(source, compression="tiff_lzw")
    folders = []
    for name, compressor in (("a", None), ("b", None), ("c", fmt.ZLIB)):
        result = pyr.build(source, tmp_path / name, name="image.tif", budget=50 * GiB, compressor=compressor)
        folders.append(tmp_path / name / result["pyramid"])
    files = lambda folder: {p.relative_to(folder).as_posix(): p.read_bytes() for p in folder.rglob("*") if p.is_file()}
    assert files(folders[0]) == files(folders[1])
    for level in range(3):
        assert (folders[0] / str(level) / ".tiles.sha256").read_bytes() == (folders[2] / str(level) / ".tiles.sha256").read_bytes()


def small_source(tmp_path, name="image.png", seed=0, size=(600, 700)):
    path = tmp_path / name
    Image.fromarray(np.random.default_rng(seed).integers(0, 256, size=(*size, 3), dtype=np.uint8)).save(path)
    return path


def test_an_existing_pyramid_is_reused_and_a_changed_source_gets_a_new_one(tmp_path):
    source = small_source(tmp_path)
    first = pyr.build(source, tmp_path / "root", name="image.png", budget=50 * GiB)
    tile = tmp_path / "root" / first["pyramid"] / "0" / "0.0.0"
    stamp = tile.stat().st_mtime_ns
    again = pyr.build(source, tmp_path / "root", name="image.png", budget=50 * GiB)
    assert again == {**first, "reused": True} and tile.stat().st_mtime_ns == stamp
    changed = small_source(tmp_path, seed=1)
    other = pyr.build(changed, tmp_path / "root", name="image.png", budget=50 * GiB)
    assert other["pyramid"] != first["pyramid"] and not other["reused"]
    assert (tmp_path / "root" / first["pyramid"]).is_dir()                      # the old one stays, as a cache entry


def test_a_located_source_with_another_sha256_is_refused_before_anything_is_built(tmp_path):
    """Card M8.4.18b: ``expect`` is the saved SHA-256; another file is refused once hashed, and through the identity record without hashing."""
    root, source = tmp_path / "root", small_source(tmp_path)
    first = pyr.build(source, root, name="image.png", budget=50 * GiB)
    assert pyr.build(source, root, name="image.png", budget=50 * GiB, expect=first["pyramid"])["reused"] is True
    other = small_source(tmp_path, name="other.png", seed=1)
    stages = []
    with pytest.raises(MethodError) as refused:
        pyr.build(other, root, name="image.png", budget=50 * GiB, expect=first["pyramid"], progress=lambda stage, *_: stages.append(stage))
    assert (refused.value.code, refused.value.field) == ("UNSUPPORTED_INPUT", "source.sha256")
    assert set(stages) <= {"hash"} and sorted(item.name for item in pyramid_folders(root)) == [first["pyramid"]]   # nothing built or removed
    stages.clear()
    with pytest.raises(MethodError):                                            # hashed before: refused through the identity record
        pyr.build(other, root, name="image.png", budget=50 * GiB, expect=first["pyramid"], progress=lambda stage, *_: stages.append(stage))
    assert stages == []


def pyramid_folders(folder):
    """What a build leaves in the root besides the identity record of card M8.4.15 (written once the source is hashed)."""
    return [item for item in folder.iterdir() if item.name != "identities.json"]


def empty_soon(folder, seconds=10):
    import time
    until = time.monotonic() + seconds
    while pyramid_folders(folder) and time.monotonic() < until:
        time.sleep(0.02)
    return not pyramid_folders(folder)


def test_cancellation_leaves_no_partial_folder(tmp_path):
    source = small_source(tmp_path, size=(1600, 300))
    for after in (0, 3):                                                       # during the hash, during the bands
        calls = iter(range(10_000))
        with pytest.raises(Cancelled):
            pyr.build(source, tmp_path / "root", name="x", budget=50 * GiB, cancelled=lambda calls=calls, after=after: next(calls) >= after)
        assert empty_soon(tmp_path / "root")                                   # deleted in the background after the answer


def test_a_full_disk_is_reported_and_the_partial_folder_removed(tmp_path, monkeypatch):
    source = small_source(tmp_path)
    original = pyr.LevelWriter.write_band

    def write_band(self, band):
        if self.level.level == 1:
            raise OSError(errno.ENOSPC, "No space left on device")
        return original(self, band)
    monkeypatch.setattr(pyr.LevelWriter, "write_band", write_band)
    with pytest.raises(MethodError) as failure:
        pyr.build(source, tmp_path / "root", name="x", budget=50 * GiB)
    assert (failure.value.code, failure.value.field) == ("LIMIT_EXCEEDED", "disk")
    assert pyramid_folders(tmp_path / "root") == []


def test_the_budget_deletes_least_recently_used_pyramids_but_never_kept_ones(tmp_path):
    root = tmp_path / "root"
    built = [pyr.build(small_source(tmp_path, f"s{i}.png", seed=i), root, name="s", budget=50 * GiB)["pyramid"] for i in range(3)]
    for age, sha in enumerate(built):                                          # s0 oldest, s2 newest
        os.utime(root / sha / "pyramid.json", (1_000_000 + age, 1_000_000 + age))
    one = pyr.folder_bytes(root / built[0])
    need = fmt.estimated_bytes(700, 600, 3, 8)
    deleted = pyr.make_room(root, need, budget=3 * one + need - 1, keep={built[0]})
    assert deleted == [built[1]]                                               # s0 is kept, so the next oldest goes
    with pytest.raises(MethodError, match="disk"):
        pyr.make_room(root, need, budget=one, keep={built[0], built[2]})      # cannot fit without deleting kept ones
    assert (root / built[0]).is_dir() and (root / built[2]).is_dir()


def test_leftovers_of_interrupted_builds_and_invalid_folders_are_cleaned(tmp_path):
    root = tmp_path / "root"
    (root / ".partial-0123").mkdir(parents=True)
    (root / ".partial-0123" / "0").mkdir()
    source = small_source(tmp_path)
    sha = hashlib.sha256(source.read_bytes()).hexdigest()
    (root / sha).mkdir()
    (root / sha / "pyramid.json").write_text('{"complete": false}')           # an incomplete or foreign folder under the right name
    result = pyr.build(source, root, name="image.png", budget=50 * GiB)
    assert not result["reused"] and fmt.read_description(root / sha)["complete"] is True
    assert sorted(p.name for p in pyramid_folders(root)) == [sha]


def test_read_description_refuses_what_readers_cannot_trust(tmp_path):
    source = small_source(tmp_path)
    folder = tmp_path / "root" / pyr.build(source, tmp_path / "root", name="x", budget=50 * GiB)["pyramid"]
    good = json.loads((folder / "pyramid.json").read_bytes())
    for change in ({"version": 2}, {"complete": False}, {"tile": 256}, {"bits": 12}, {"compressor": {"id": "blosc"}},
                   {"width": good["width"] + 1}, {"source": {**good["source"], "sha256": "0" * 64}}):
        (folder / "pyramid.json").write_text(json.dumps({**good, **change}))
        with pytest.raises(fmt.InvalidPyramid):
            fmt.read_description(folder)
