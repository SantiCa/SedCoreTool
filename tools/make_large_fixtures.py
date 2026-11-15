"""Deterministic multi-gigabyte test images for part C of M8.4 (card M8.4.13). Fixtures are never committed.

Every pixel is a pure function of its coordinates and the seed (``pixel_region``), so any region of any file can be regenerated exactly and used as
the independent reference by later cards. The TIFF/BigTIFF writer is minimal and written here (standard library + NumPy; no new dependency).

    python tools/make_large_fixtures.py OUTPUT_FOLDER [--only NAME ...] [--rows-scale 1]   (needs about 20-30 GiB for the whole set)

Files (all RGB 8-bit, 8,192 pixels wide, unless stated):
  rgb2g       uncompressed tiled BigTIFF, 87,382 rows (about 2 GiB decoded)
  rgb4g       the same with 174,763 rows (about 4 GiB)
  rgb8g       the same with 349,526 rows (about 8 GiB)
  strip2g     the 2 GiB image as an uncompressed striped BigTIFF (64 rows per strip)
  gray16_2g   16-bit grey tiled BigTIFF, 131,072 rows (2 GiB), pixel value = the green-like channel scaled to 16 bits
  deflate8g   the 8 GiB image as a deflate-compressed tiled BigTIFF
  jpeg        baseline JPEG, 4,096 x 65,535 pixels (the format's largest height; needs about 2 GiB of memory while writing)
``--rows-scale`` (for tests and trials) multiplies every row count, for example 0.001.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import struct
import sys
import time
import zlib
from pathlib import Path

import numpy as np

SEED = 138501
BLOCK = 512                     # the generator's own grid; independent of any file's tile size
WIDTH = 8192
TILE = 512
STRIP_ROWS = 64
REPO = Path(__file__).resolve().parents[1]

FILES = {
    "rgb2g": dict(rows=87_382, kind="tiled", compression=1, channels=3, bits=8),
    "rgb4g": dict(rows=174_763, kind="tiled", compression=1, channels=3, bits=8),
    "rgb8g": dict(rows=349_526, kind="tiled", compression=1, channels=3, bits=8),
    "strip2g": dict(rows=87_382, kind="striped", compression=1, channels=3, bits=8),
    "gray16_2g": dict(rows=131_072, kind="tiled", compression=1, channels=1, bits=16),
    "deflate8g": dict(rows=349_526, kind="tiled", compression=8, channels=3, bits=8),
    "jpeg": dict(rows=65_535, kind="jpeg", compression=None, channels=3, bits=8, width=4096),
}


# ---- the image: a pure function of coordinates and seed ---------------------------------------------------------------------------------------

def _block(by: int, bx: int, seed: int) -> np.ndarray:
    """One 512 x 512 x 3 block: horizontal layers (a function of the row only), grain, and two dark burrow-like ellipses placed by the block's own stream."""
    rng = np.random.Generator(np.random.PCG64(np.random.SeedSequence([seed, by, bx])))
    rows = by * BLOCK + np.arange(BLOCK, dtype=np.float64)
    layers = 135 + 38 * np.sin(rows / 211.0) + 14 * np.sin(rows / 37.0 + 1.3)
    image = np.repeat(layers[:, None, None], BLOCK, axis=1) * np.array([1.0, 0.92, 0.78])[None, None, :]
    image = image + rng.integers(-9, 10, size=(BLOCK, BLOCK, 1)) + rng.integers(-3, 4, size=(BLOCK, BLOCK, 3))
    yy, xx = np.mgrid[0:BLOCK, 0:BLOCK]
    for _ in range(2):
        cy, cx = rng.integers(40, BLOCK - 40, size=2)
        ry, rx = rng.integers(8, 36), rng.integers(10, 60)
        inside = ((yy - cy) / ry) ** 2 + ((xx - cx) / rx) ** 2 <= 1.0
        image[inside] = image[inside] * 0.45
    return np.clip(np.rint(image), 0, 255).astype(np.uint8)


def pixel_region(x0: int, y0: int, width: int, height: int, *, channels: int = 3, bits: int = 8, seed: int = SEED) -> np.ndarray:
    """The pixels [y0, y0+height) x [x0, x0+width) of the image, shape (height, width, channels), uint8 or uint16 (grey: channels == 1)."""
    if min(x0, y0) < 0 or width < 1 or height < 1:
        raise ValueError("The region must lie at non-negative coordinates and have a positive size")
    out = np.empty((height, width, 3), dtype=np.uint8)
    for by in range(y0 // BLOCK, (y0 + height - 1) // BLOCK + 1):
        for bx in range(x0 // BLOCK, (x0 + width - 1) // BLOCK + 1):
            top, left = max(y0, by * BLOCK), max(x0, bx * BLOCK)
            bottom, right = min(y0 + height, (by + 1) * BLOCK), min(x0 + width, (bx + 1) * BLOCK)
            out[top - y0:bottom - y0, left - x0:right - x0] = _block(by, bx, seed)[top - by * BLOCK:bottom - by * BLOCK, left - bx * BLOCK:right - bx * BLOCK]
    if channels == 3 and bits == 8:
        return out
    grey = out[:, :, 1:2].astype(np.uint16)
    if channels != 1:
        raise ValueError("Only 3-channel 8-bit and 1-channel images exist")
    return grey * 257 if bits == 16 else grey.astype(np.uint8)


# ---- TIFF / BigTIFF writer ---------------------------------------------------------------------------------------------------------------------

SHORT, LONG, LONG8 = 3, 4, 16
_TYPE = {SHORT: ("H", 2), LONG: ("I", 4), LONG8: ("Q", 8)}


class _Entry:
    def __init__(self, tag: int, kind: int, values: list[int]):
        self.tag, self.kind, self.values = tag, kind, values


def _inline(entry: _Entry) -> bytes | None:
    code, size = _TYPE[entry.kind]
    if len(entry.values) * size > 8:
        return None
    return struct.pack("<" + code * len(entry.values), *entry.values).ljust(8, b"\0")


def write_bigtiff(path: Path, *, width: int, rows: int, channels: int, bits: int, kind: str, compression: int, seed: int = SEED, progress=None) -> dict:
    """Write the image as a BigTIFF (little-endian, one directory). ``kind`` is ``tiled`` (512 x 512 tiles) or ``striped`` (64 rows per strip).
    Memory stays near one row of tiles. Returns the facts a fixture record needs."""
    if kind not in ("tiled", "striped") or compression not in (1, 8):
        raise ValueError("kind is tiled or striped; compression 1 (none) or 8 (deflate)")
    offsets: list[int] = []
    counts: list[int] = []
    started = time.perf_counter()
    dtype = np.uint16 if bits == 16 else np.uint8
    with open(path, "wb") as out:
        out.write(b"II" + struct.pack("<HHHQ", 43, 8, 0, 0))             # header; the offset of the directory is patched at the end

        def put(block: np.ndarray) -> None:
            data = np.ascontiguousarray(block.astype(dtype, copy=False)).tobytes()
            if compression == 8:
                data = zlib.compress(data, 1)
            offsets.append(out.tell())
            counts.append(len(data))
            out.write(data)

        if kind == "tiled":
            for ty in range(-(-rows // TILE)):
                band = pixel_region(0, ty * TILE, width, min(TILE, rows - ty * TILE), channels=channels, bits=bits, seed=seed)
                padded_width = -(-width // TILE) * TILE
                if band.shape[0] < TILE or band.shape[1] < padded_width:     # edge tiles are padded with zeros to a whole tile, as the format requires
                    full = np.zeros((TILE, padded_width, channels), dtype=band.dtype)
                    full[:band.shape[0], :band.shape[1]] = band
                    band = full
                for tx in range(-(-width // TILE)):
                    put(band[:, tx * TILE:(tx + 1) * TILE])
                if progress:
                    progress((ty + 1) * TILE / rows)
        else:
            for first in range(0, rows, STRIP_ROWS):
                put(pixel_region(0, first, width, min(STRIP_ROWS, rows - first), channels=channels, bits=bits, seed=seed))
                if progress and first % (STRIP_ROWS * 256) == 0:
                    progress(first / rows)
        tag_offsets, tag_counts = (324, 325) if kind == "tiled" else (273, 279)
        entries = [
            _Entry(256, LONG, [width]), _Entry(257, LONG, [rows]), _Entry(258, SHORT, [bits] * channels), _Entry(259, SHORT, [compression]),
            _Entry(262, SHORT, [2 if channels == 3 else 1]), _Entry(277, SHORT, [channels]), _Entry(284, SHORT, [1]),
        ]
        if kind == "tiled":
            entries += [_Entry(322, LONG, [TILE]), _Entry(323, LONG, [TILE])]
        else:
            entries += [_Entry(278, LONG, [STRIP_ROWS])]
        entries += [_Entry(tag_offsets, LONG8, offsets), _Entry(tag_counts, LONG8, counts)]
        entries.sort(key=lambda e: e.tag)
        out_of_line: dict[int, int] = {}
        for entry in entries:                                              # arrays that do not fit in the entry go after the data
            if _inline(entry) is None:
                code, _ = _TYPE[entry.kind]
                out_of_line[entry.tag] = out.tell()
                for start in range(0, len(entry.values), 1 << 16):
                    chunk = entry.values[start:start + (1 << 16)]
                    out.write(struct.pack("<" + code * len(chunk), *chunk))
        directory = out.tell()
        out.write(struct.pack("<Q", len(entries)))
        for entry in entries:
            inline = _inline(entry)
            out.write(struct.pack("<HHQ", entry.tag, entry.kind, len(entry.values)) + (inline if inline is not None else struct.pack("<Q", out_of_line[entry.tag])))
        out.write(struct.pack("<Q", 0))
        out.seek(8)
        out.write(struct.pack("<Q", directory))
    encoded = Path(path).stat().st_size
    return dict(width=width, rows=rows, channels=channels, bits=bits, layout=kind, compression="deflate" if compression == 8 else "none",
                tile=[TILE, TILE] if kind == "tiled" else None, rows_per_strip=STRIP_ROWS if kind == "striped" else None,
                encoded_bytes=encoded, decoded_bytes=width * rows * channels * (bits // 8), seconds=round(time.perf_counter() - started, 1))


def write_jpeg(path: Path, *, width: int, rows: int, seed: int = SEED) -> dict:
    from PIL import Image
    started = time.perf_counter()
    image = np.empty((rows, width, 3), dtype=np.uint8)
    for first in range(0, rows, BLOCK):
        image[first:first + BLOCK] = pixel_region(0, first, width, min(BLOCK, rows - first), seed=seed)
    Image.fromarray(image).save(path, format="JPEG", quality=85)
    return dict(width=width, rows=rows, channels=3, bits=8, layout="baseline", compression="jpeg", tile=None, rows_per_strip=None,
                encoded_bytes=Path(path).stat().st_size, decoded_bytes=width * rows * 3, seconds=round(time.perf_counter() - started, 1))


# ---- checking a file against the pure function ----------------------------------------------------------------------------------------------

def sample_regions(width: int, rows: int, count: int = 20, size: int = 256, seed: int = SEED) -> list[dict]:
    """``count`` regions of at most ``size`` x ``size`` pixels: the four corners, one that crosses a tile corner, the rest drawn from a fixed stream."""
    w, h = min(size, width), min(size, rows)
    fixed = [(0, 0), (width - w, 0), (0, rows - h), (width - w, rows - h), (max(0, min(TILE - w // 2, width - w)), max(0, min(TILE - h // 2, rows - h)))]
    rng = np.random.Generator(np.random.PCG64(seed + 1))
    drawn = [(int(rng.integers(0, width - w + 1)), int(rng.integers(0, rows - h + 1))) for _ in range(max(0, count - len(fixed)))]
    return [dict(x=x, y=y, w=w, h=h) for x, y in (fixed + drawn)[:count]]


def verify_file(path: Path, *, width: int, rows: int, channels: int, bits: int, seed: int = SEED, count: int = 20) -> list[dict]:
    """Reads sampled regions of ``path`` with the program's own TIFF reader (Node) and compares each, byte for byte, with ``pixel_region``.
    Returns one record per region; raises ``AssertionError`` on the first difference."""
    import subprocess
    regions = sample_regions(width, rows, count)
    run = subprocess.run(["node", str(REPO / "tools" / "verify_large_fixtures.mjs"), str(path), json.dumps(regions)], capture_output=True, text=True, check=True)
    results = [json.loads(line) for line in run.stdout.splitlines() if line.strip()]
    assert len(results) == len(regions), f"{path.name}: {len(results)} regions read, {len(regions)} asked"
    for region, result in zip(regions, results):
        reference = pixel_region(region["x"], region["y"], region["w"], region["h"], channels=channels, bits=bits, seed=seed)
        assert hashlib.sha256(reference.tobytes()).hexdigest() == result["sha256"], f"{path.name}: region {region} differs from the generator's function"
    return results


# ---- the command line ------------------------------------------------------------------------------------------------------------------------

def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(8 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def estimate_bytes(names: list[str], scale: float) -> int:
    total = 0
    for name in names:
        spec = FILES[name]
        decoded = spec.get("width", WIDTH) * max(1, int(spec["rows"] * scale)) * spec["channels"] * (spec["bits"] // 8)
        total += decoded // (6 if spec["compression"] == 8 or spec["kind"] == "jpeg" else 1)   # deflate and JPEG shrink the data; a guess for the free-space check
    return total


def check_destination(folder: Path, needed: int) -> None:
    resolved = folder.resolve()
    if resolved == REPO or REPO in resolved.parents:
        raise SystemExit(f"Refusing to write fixtures inside the repository ({resolved}): they are gigabytes and are never committed")
    folder.mkdir(parents=True, exist_ok=True)
    free = shutil.disk_usage(folder).free
    if free < needed * 1.1:
        raise SystemExit(f"Not enough free space in {folder}: about {needed / 2**30:.1f} GiB needed, {free / 2**30:.1f} GiB free")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__.split("\n\n", 1)[1])
    parser.add_argument("folder", type=Path)
    parser.add_argument("--only", nargs="+", choices=sorted(FILES), default=sorted(FILES))
    parser.add_argument("--rows-scale", type=float, default=1.0)
    parser.add_argument("--verify", action="store_true", help="after writing, read 20 sampled regions of each TIFF with the program's own reader and compare them with the generator's function")
    args = parser.parse_args(argv)
    needed = estimate_bytes(args.only, args.rows_scale)
    print(f"Estimated disk use: {needed / 2**30:.1f} GiB", file=sys.stderr)
    check_destination(args.folder, needed)
    records = {}
    for name in args.only:
        spec = FILES[name]
        rows = max(1, int(spec["rows"] * args.rows_scale))
        extension = "jpg" if spec["kind"] == "jpeg" else "tif"
        path = args.folder / f"{name}.{extension}"
        print(f"writing {path.name} ({rows} rows)", file=sys.stderr)
        if spec["kind"] == "jpeg":
            record = write_jpeg(path, width=spec["width"], rows=min(rows, 65_535))
        else:
            record = write_bigtiff(path, width=WIDTH, rows=rows, channels=spec["channels"], bits=spec["bits"], kind=spec["kind"], compression=spec["compression"])
        if args.verify and spec["kind"] != "jpeg":
            record["verified_regions"] = len(verify_file(path, width=WIDTH, rows=rows, channels=spec["channels"], bits=spec["bits"]))
        record["sha256"] = sha256_file(path)
        record["file"] = path.name
        records[name] = record
    (args.folder / "fixtures.json").write_text(json.dumps({"seed": SEED, "generator_block": BLOCK, "files": records}, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(records, indent=2))


if __name__ == "__main__":
    main()
