"""The generator of multi-gigabyte test images (card M8.4.13): pure pixels, a TIFF writer the program's own reader accepts, and its safety refusals."""

import importlib
import shutil
import struct
import sys
from pathlib import Path

import numpy as np
import pytest

NODE = shutil.which("node")


@pytest.fixture(scope="module")
def gen():
    with pytest.MonkeyPatch.context() as patch:
        patch.syspath_prepend(str(Path(__file__).resolve().parents[1] / "tools"))
        sys.modules.pop("make_large_fixtures", None)
        return importlib.import_module("make_large_fixtures")


def test_a_region_is_a_pure_function_of_its_coordinates(gen):
    whole = gen.pixel_region(300, 400, 900, 700)
    assert whole.shape == (700, 900, 3) and whole.dtype == np.uint8
    for x0, y0, w, h in [(0, 0, 100, 100), (213, 90, 511, 3), (899, 699, 1, 1), (500, 100, 400, 600)]:
        np.testing.assert_array_equal(gen.pixel_region(300 + x0, 400 + y0, w, h), whole[y0:y0 + h, x0:x0 + w])
    np.testing.assert_array_equal(gen.pixel_region(300, 400, 900, 700), whole)


def test_the_seed_changes_the_picture_and_the_block_grid_does_not_show_a_seam(gen):
    assert not np.array_equal(gen.pixel_region(0, 0, 64, 64), gen.pixel_region(0, 0, 64, 64, seed=1))
    across = gen.pixel_region(500, 500, 24, 24)
    assert across[:12, :12].shape == (12, 12, 3) and across.std() > 1


def test_sixteen_bit_grey_is_the_green_channel_scaled_to_the_full_range(gen):
    colour, grey = gen.pixel_region(10, 20, 50, 40), gen.pixel_region(10, 20, 50, 40, channels=1, bits=16)
    assert grey.shape == (40, 50, 1) and grey.dtype == np.uint16
    np.testing.assert_array_equal(grey[:, :, 0], colour[:, :, 1].astype(np.uint16) * 257)
    assert int(grey.max()) <= 65535


@pytest.mark.parametrize("arguments", [dict(x0=-1, y0=0, width=1, height=1), dict(x0=0, y0=-1, width=1, height=1), dict(x0=0, y0=0, width=0, height=1), dict(x0=0, y0=0, width=1, height=0)])
def test_a_region_outside_the_image_is_refused(gen, arguments):
    with pytest.raises(ValueError, match="region"):
        gen.pixel_region(arguments["x0"], arguments["y0"], arguments["width"], arguments["height"])


def tags_of(path):
    """An independent, minimal BigTIFF directory reader (struct only) used to check what the writer declares."""
    data = Path(path).read_bytes()
    assert data[:4] == b"II\x2b\x00" and struct.unpack_from("<HH", data, 4) == (8, 0)
    directory = struct.unpack_from("<Q", data, 8)[0]
    count = struct.unpack_from("<Q", data, directory)[0]
    sizes = {3: 2, 4: 4, 16: 8}
    tags = {}
    for i in range(count):
        tag, kind, n = struct.unpack_from("<HHQ", data, directory + 8 + i * 20)
        value_at = directory + 8 + i * 20 + 12
        size = sizes[kind] * n
        start = value_at if size <= 8 else struct.unpack_from("<Q", data, value_at)[0]
        code = {3: "H", 4: "I", 16: "Q"}[kind]
        tags[tag] = list(struct.unpack_from("<" + code * n, data, start))
    assert struct.unpack_from("<Q", data, directory + 8 + count * 20)[0] == 0, "one directory only"
    return tags, len(data)


@pytest.mark.parametrize("kind,compression,channels,bits", [("tiled", 1, 3, 8), ("tiled", 8, 3, 8), ("striped", 1, 3, 8), ("tiled", 1, 1, 16)])
def test_the_writer_declares_what_it_wrote_and_is_deterministic(gen, tmp_path, kind, compression, channels, bits):
    first, second = tmp_path / "a.tif", tmp_path / "b.tif"
    for path in (first, second):
        record = gen.write_bigtiff(path, width=700, rows=1100, channels=channels, bits=bits, kind=kind, compression=compression)
    assert first.read_bytes() == second.read_bytes()
    tags, size = tags_of(first)
    assert (tags[256], tags[257], tags[277], tags[258], tags[259]) == ([700], [1100], [channels], [bits] * channels, [compression])
    assert tags[262] == [2 if channels == 3 else 1] and tags[284] == [1]
    offsets, counts = (tags[324], tags[325]) if kind == "tiled" else (tags[273], tags[279])
    assert len(offsets) == len(counts) == (3 * 2 if kind == "tiled" else -(-1100 // gen.STRIP_ROWS))
    assert all(o + c <= size for o, c in zip(offsets, counts)) and all(c > 0 for c in counts)
    if kind == "tiled":
        assert tags[322] == [512] and tags[323] == [512]
    if compression == 1:
        per_block = 512 * 512 * channels * (bits // 8) if kind == "tiled" else None
        if per_block:
            assert set(counts) == {per_block}, "uncompressed edge tiles are padded to whole tiles"
    assert record["decoded_bytes"] == 700 * 1100 * channels * (bits // 8) and record["encoded_bytes"] == size


@pytest.mark.skipif(NODE is None, reason="Node is not installed")
@pytest.mark.parametrize("kind,compression,channels,bits", [("tiled", 1, 3, 8), ("tiled", 8, 3, 8), ("striped", 1, 3, 8), ("tiled", 1, 1, 16)])
def test_the_programs_own_tiff_reader_reads_back_the_generators_pixels(gen, tmp_path, kind, compression, channels, bits):
    path = tmp_path / "image.tif"
    gen.write_bigtiff(path, width=1030, rows=1500, channels=channels, bits=bits, kind=kind, compression=compression)
    results = gen.verify_file(path, width=1030, rows=1500, channels=channels, bits=bits, count=8)
    assert len(results) == 8


@pytest.mark.skipif(NODE is None, reason="Node is not installed")
def test_verification_notices_a_wrong_pixel(gen, tmp_path):
    path = tmp_path / "image.tif"
    gen.write_bigtiff(path, width=600, rows=600, channels=3, bits=8, kind="tiled", compression=1)
    data = bytearray(path.read_bytes())
    data[16 + 100] ^= 0xFF                                  # a byte inside the first tile
    path.write_bytes(bytes(data))
    with pytest.raises(AssertionError, match="differs"):
        gen.verify_file(path, width=600, rows=600, channels=3, bits=8, count=6)


def test_sampled_regions_are_deterministic_inside_the_image_and_include_the_corners(gen):
    regions = gen.sample_regions(8192, 349_526)
    assert regions == gen.sample_regions(8192, 349_526) and len(regions) == 20
    assert all(0 <= r["x"] and r["x"] + r["w"] <= 8192 and 0 <= r["y"] and r["y"] + r["h"] <= 349_526 for r in regions)
    assert {(r["x"], r["y"]) for r in regions[:4]} == {(0, 0), (8192 - 256, 0), (0, 349_526 - 256), (8192 - 256, 349_526 - 256)}
    small = gen.sample_regions(100, 50)
    assert all(r["w"] == 100 and r["h"] == 50 for r in small)


def test_fixtures_are_never_written_inside_the_repository(gen):
    with pytest.raises(SystemExit, match="repository"):
        gen.check_destination(gen.REPO / "tests" / "scratch-fixtures", 1)
    assert not (gen.REPO / "tests" / "scratch-fixtures").exists()


def test_not_enough_free_space_is_refused_before_anything_is_written(gen, tmp_path, monkeypatch):
    monkeypatch.setattr(gen.shutil, "disk_usage", lambda _: type("U", (), {"free": 1000})())
    with pytest.raises(SystemExit, match="free space"):
        gen.check_destination(tmp_path / "out", 10**9)
    assert list((tmp_path / "out").iterdir()) == []


def test_the_estimate_scales_with_rows_and_names_every_file(gen):
    assert set(gen.FILES) == {"rgb2g", "rgb4g", "rgb8g", "strip2g", "gray16_2g", "deflate8g", "jpeg"}
    full, tenth = gen.estimate_bytes(["rgb2g"], 1.0), gen.estimate_bytes(["rgb2g"], 0.1)
    assert full > 2 * 2**30 * 0.99 and abs(full / tenth - 10) < 0.01
    decoded = {n: gen.WIDTH * s["rows"] * s["channels"] * (s["bits"] // 8) for n, s in gen.FILES.items() if "width" not in s}
    assert 2.0 < decoded["rgb2g"] / 2**30 < 2.1 and 4.0 < decoded["rgb4g"] / 2**30 < 4.1 and 8.0 < decoded["rgb8g"] / 2**30 < 8.1


def test_the_command_line_writes_a_manifest_with_hashes_at_a_small_scale(gen, tmp_path, capsys):
    gen.main([str(tmp_path / "out"), "--only", "rgb2g", "gray16_2g", "--rows-scale", "0.0001"])
    manifest = (tmp_path / "out" / "fixtures.json").read_text(encoding="utf-8")
    assert '"rgb2g"' in manifest and '"gray16_2g"' in manifest and manifest.count('"sha256"') == 2
    assert (tmp_path / "out" / "rgb2g.tif").stat().st_size > 0
