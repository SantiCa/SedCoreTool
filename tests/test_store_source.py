"""Tile store sources (card M8.4.14, contract §8.3): libvips reads bands exactly, and refuses what the contract refuses.

References: the arrays Pillow wrote, the generator of card M8.4.13 (``pixel_region``) and the program's own TIFF reader (``app/js/tiff.js``)."""

import hashlib
import importlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from conftest import require_pyvips

pyvips = require_pyvips()

from sedcoretool.methods.errors import MethodError  # noqa: E402
from sedcoretool.store import source as src  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


@pytest.fixture(scope="module")
def gen():
    with pytest.MonkeyPatch.context() as patch:
        patch.syspath_prepend(str(ROOT / "tools"))
        sys.modules.pop("make_large_fixtures", None)
        return importlib.import_module("make_large_fixtures")


def bands(source):
    return np.concatenate([source.band(y) for y in range(0, source.info.height, src.TILE)])


def pattern(height, width, channels, bits, seed=0):
    rng = np.random.default_rng(seed)
    top = 256 if bits == 8 else 65536
    shape = (height, width) if channels == 1 else (height, width, channels)
    return rng.integers(0, top, size=shape, dtype=np.uint16 if bits == 16 else np.uint8)


@pytest.mark.parametrize("channels, bits, compression", [
    (3, 8, None), (3, 8, "tiff_lzw"), (3, 8, "packbits"), (3, 8, "tiff_adobe_deflate"),
    (4, 8, "tiff_lzw"), (1, 8, None), (1, 16, None), (1, 16, "tiff_adobe_deflate"),
])
def test_striped_tiff_written_by_pillow_reads_back_exactly(tmp_path, channels, bits, compression):
    array = pattern(1300, 70, channels, bits)          # three bands, the last one partial
    path = tmp_path / "image.tif"
    Image.fromarray(array).save(path, compression=compression) if compression else Image.fromarray(array).save(path)
    source = src.Source(path)
    assert (source.info.kind, source.info.width, source.info.height, source.info.channels, source.info.bits) == ("tiff", 70, 1300, channels, bits)
    assert not source.sequential
    np.testing.assert_array_equal(bands(source), array.reshape(1300, 70, channels))
    np.testing.assert_array_equal(source.band(512), array.reshape(1300, 70, channels)[512:1024])   # random access: any band, any order


@pytest.mark.parametrize("kind, compression, channels, bits", [("tiled", 1, 3, 8), ("tiled", 8, 3, 8), ("striped", 1, 3, 8), ("tiled", 1, 1, 16)])
def test_generator_bigtiffs_equal_the_pure_pixel_function(tmp_path, gen, kind, compression, channels, bits):
    path = tmp_path / "big.tif"
    rows = 1100
    gen.write_bigtiff(path, width=gen.WIDTH, rows=rows, channels=channels, bits=bits, kind=kind, compression=compression)
    source = src.Source(path)
    assert (source.info.width, source.info.height, source.info.channels, source.info.bits) == (gen.WIDTH, rows, channels, bits)
    for y in (0, 512, 1024):
        expected = gen.pixel_region(0, y, gen.WIDTH, min(512, rows - y), channels=channels, bits=bits)
        np.testing.assert_array_equal(source.band(y), expected.reshape(source.band(y).shape))


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_libvips_and_the_programs_tiff_reader_give_the_same_bytes(tmp_path, gen):
    regions = [{"x": 0, "y": 0, "w": 512, "h": 512}, {"x": 300, "y": 400, "w": 700, "h": 300}, {"x": 7680, "y": 900, "w": 512, "h": 200}]
    for channels, bits, compression in ((3, 8, 8), (1, 16, 1)):
        path = tmp_path / f"parity-{bits}.tif"
        gen.write_bigtiff(path, width=gen.WIDTH, rows=1100, channels=channels, bits=bits, kind="tiled", compression=compression)
        lines = subprocess.run([NODE, str(ROOT / "tools/verify_large_fixtures.mjs"), str(path), json.dumps(regions)],
                               capture_output=True, text=True, check=True, timeout=120).stdout.split("\n")
        javascript = [json.loads(line)["sha256"] for line in lines if line.strip()]
        whole = bands(src.Source(path))
        python = [hashlib.sha256(np.ascontiguousarray(whole[r["y"]:r["y"] + r["h"], r["x"]:r["x"] + r["w"], :3]).tobytes()).hexdigest() for r in regions]
        assert python == javascript


def test_jpeg_and_png_are_read_in_order_from_the_top(tmp_path):
    array = pattern(1100, 90, 3, 8)
    png = tmp_path / "image.png"
    Image.fromarray(array).save(png)
    source = src.Source(png)
    assert source.sequential and source.info.kind == "png"
    np.testing.assert_array_equal(bands(source), array)
    reopened = src.Source(png)
    with pytest.raises(ValueError, match="top down"):
        reopened.band(512)
    grey16 = tmp_path / "grey16.png"
    Image.fromarray(pattern(600, 40, 1, 16)).save(grey16)
    assert src.Source(grey16).info.bits == 16
    jpeg = tmp_path / "image.jpg"
    Image.fromarray(array).save(jpeg, quality=95)
    decoded = np.asarray(Image.open(jpeg).convert("RGB"))
    np.testing.assert_array_equal(bands(src.Source(jpeg)), decoded)          # the same libjpeg decoding as Pillow's


def test_a_large_jpeg_or_png_is_refused_with_a_hint_towards_tiff(tmp_path, monkeypatch):
    path = tmp_path / "image.png"
    Image.fromarray(pattern(600, 40, 3, 8)).save(path)
    monkeypatch.setattr(src, "MAX_DECODED_SEQUENTIAL", 600 * 40 * 3 - 1)
    with pytest.raises(MethodError) as refused:
        src.Source(path)
    assert (refused.value.code, refused.value.field) == ("UNSUPPORTED_INPUT", "source.size")
    tiff = tmp_path / "image.tif"
    Image.fromarray(pattern(600, 40, 3, 8)).save(tiff)
    assert src.Source(tiff).info.height == 600                                  # the limit does not apply to TIFF


def test_dimension_and_band_limits_are_checked_on_the_header(tmp_path, monkeypatch):
    path = tmp_path / "image.tif"
    Image.fromarray(pattern(100, 50, 3, 8)).save(path)
    monkeypatch.setattr(src, "MAX_WIDTH", 49)
    with pytest.raises(MethodError, match="source.dimensions"):
        src.Source(path)
    monkeypatch.setattr(src, "MAX_WIDTH", 262_144)
    monkeypatch.setattr(src, "MAX_BAND_BYTES", 50 * 512 * 3 - 1)
    with pytest.raises(MethodError, match="source.dimensions"):
        src.Source(path)


@pytest.mark.parametrize("make", [
    lambda d: (d / "x.txt").write_bytes(b"not an image at all"),
    lambda d: (d / "x.txt").write_bytes(b"GIF89a" + b"\0" * 64),                                           # a format libvips knows but the store does not
    lambda d: Image.new("LA", (8, 8)).save(d / "x.txt", format="PNG"),                                       # grey with alpha: 2 bands
    lambda d: Image.fromarray(np.zeros((8, 8), np.float32)).save(d / "x.txt", format="TIFF"),               # floating-point samples
    lambda d: (d / "x.txt").write_bytes(b"II*\x00" + (8).to_bytes(4, "little") + (5).to_bytes(2, "little") + b"".join(
        tag.to_bytes(2, "little") + (4).to_bytes(2, "little") + (1).to_bytes(4, "little") + value.to_bytes(4, "little")
        for tag, value in ((256, 4_000_000), (257, 4_000_000), (258, 8), (273, 200), (279, 10))) + b"\0" * 68),   # declares 16 Tpixels
])
def test_unsupported_or_hostile_files_are_refused(tmp_path, make):
    make(tmp_path)
    with pytest.raises(MethodError) as refused:
        src.Source(tmp_path / "x.txt")
    assert refused.value.code in ("UNSUPPORTED_INPUT", "LIMIT_EXCEEDED")


@pytest.mark.parametrize("fmt", ["TIFF", "JPEG"])
def test_a_cmyk_image_is_refused_rather_than_read_as_rgba(tmp_path, fmt):
    """Card M8.4.40: CMYK has four bands like RGBA; its samples are ink amounts, so showing them as RGBA would be wrong."""
    path = tmp_path / "cmyk.bin"
    Image.new("CMYK", (40, 30), (10, 20, 30, 40)).save(path, format=fmt)
    with pytest.raises(MethodError) as refused:
        src.Source(path)
    assert (refused.value.code, refused.value.field) == ("UNSUPPORTED_INPUT", "source")
    rgba = tmp_path / "rgba.tif"
    Image.new("RGBA", (40, 30), (10, 20, 30, 40)).save(rgba)
    assert src.Source(rgba).info.channels == 4                                 # four bands that are RGBA stay accepted

def test_a_truncated_tiff_fails_when_the_missing_band_is_read(tmp_path):
    whole = tmp_path / "whole.tif"
    Image.fromarray(pattern(1300, 70, 3, 8)).save(whole)
    data = whole.read_bytes()
    cut = tmp_path / "cut.tif"
    cut.write_bytes(data[: len(data) // 2])
    try:
        source = src.Source(cut)          # the header may still be readable
    except MethodError:
        return
    with pytest.raises(MethodError):
        bands(source)


def test_libvips_caches_and_threads_are_bounded():
    src.configure_libvips(2)
    assert pyvips.cache_get_max_mem() == src.LIBVIPS_CACHE_BYTES
    assert pyvips.cache_get_max_files() == src.LIBVIPS_CACHE_FILES
    assert pyvips.vips_lib.vips_concurrency_get() == 2
