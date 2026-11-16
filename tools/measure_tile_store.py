"""Measurements of card M8.4.14: building pixel pyramids from the multi-gigabyte fixtures of M8.4.13, and reading their tiles.

    python tools/measure_tile_store.py FIXTURES --pyramids FOLDER --out FILE --phase compression
    python tools/measure_tile_store.py FIXTURES --pyramids FOLDER --out FILE --phase full --compressor none|zlib [--only rgb2g,jpeg]

The engine's coordinator runs in this process (as in the tests) and the build runs in its real method worker, so the memory sampled
(``tools/process_tree_sampler.py``, 25 ms, this process and its children) is the coordinator's and the worker's. Pyramids are written
to ``--pyramids`` (outside the repository) and deleted after each file.

compression: builds ``rgb2g`` without a compressor and with zlib level 1 and applies the rule of the card, stated before measuring:
zlib if its build throughput is at least 70 % of the uncompressed one AND the p95 of reading one level-0 tile (read, inflate, verify,
fresh tile cache) is at most 10 ms; otherwise none.
full: for each fixture, the build (time, MiB/s of source, disk, memory peak, progress-event gaps), tile reads through the coordinator
(one tile and batches of 16, fresh cache), and exactness: 20 regions per file at levels 0-3 against the generator's pixels (level 0)
and an independent NumPy integer mean (levels 1-3). ``rgb2g`` is also built once more and cancelled at about 30 % of level 0.
The OS disk cache is warm (the files were just written or read); cold-cache numbers are not claimed.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import platform
import shutil
import subprocess
import sys
import time
from pathlib import Path
from uuid import uuid4

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "tools"))

import make_large_fixtures as gen  # noqa: E402

from sedcoretool.engine import server as engine_server  # noqa: E402
from sedcoretool.engine.protocol import BINARY_FRAME, read_frame, strict_json  # noqa: E402
from sedcoretool.store import format as fmt  # noqa: E402
from sedcoretool.store.tiles import TileReader  # noqa: E402

GiB, MiB = 2**30, 2**20
RECORDED: list[tuple[float, dict]] = []
_write_json = engine_server.write_json


def recording_write_json(stream, value):
    RECORDED.append((time.perf_counter(), value))
    _write_json(stream, value)


engine_server.write_json = recording_write_json


def percentile(values, p):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, int(np.ceil(p * len(ordered))) - 1))] if ordered else None


def round_(value, digits=1):
    return None if value is None else round(float(value), digits)


class Sampler:
    def __init__(self):
        self.process = subprocess.Popen([sys.executable, str(ROOT / "tools/process_tree_sampler.py"), str(os.getpid()), "25"],
                                        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        self.samples = []

    def stop(self):
        self.process.kill()
        out, _ = self.process.communicate()
        for line in out.splitlines():
            parts = line.split("|")
            if len(parts) == 3:
                self.samples.append((float(parts[0]), int(parts[2]) / MiB))
        return self.samples


class Engine:
    def __init__(self, pyramids: Path, compressor):
        self.scratch = pyramids.parent / f"scratch-{uuid4().hex[:8]}"
        self.scratch.mkdir()
        self.coordinator = engine_server.Coordinator(io.BytesIO(), version="measure", runtime_id="0" * 64, scratch_directory=str(self.scratch),
                                                     pyramid_directory=str(pyramids), pyramid_budget=50 * GiB)
        self.coordinator.pyramid_compressor = compressor
        self.session = str(uuid4())
        self.send("hello", {"protocol": 1})

    def send(self, operation, payload):
        request = {"v": 1, "kind": "request", "session": self.session, "id": str(uuid4()), "op": operation, "payload": payload}
        self.coordinator.receive(request)
        return request["id"]

    def wait(self, request_id, seconds=3600, on_event=None):
        deadline = time.monotonic() + seconds
        seen = 0
        while time.monotonic() < deadline:
            self.coordinator.poll()
            for when, value in RECORDED[seen:]:
                if value.get("id") == request_id and value.get("kind") == "event" and on_event:
                    on_event(when, value["payload"])
                if value.get("id") == request_id and value.get("kind") == "response" and self.coordinator.active is None:
                    return when, value
            seen = len(RECORDED)
            time.sleep(0.002)
        raise TimeoutError(request_id)

    def binary_after(self, request_id):
        stream, found, collecting = io.BytesIO(self.coordinator.output.getvalue()), [], False
        while frame := read_frame(stream):
            if frame[0] == BINARY_FRAME:
                if collecting:
                    found.append(frame[1])
                continue
            value = strict_json(frame[1])
            collecting = value.get("id") == request_id and value.get("kind") == "response"
        return b"".join(found)

    def close(self):
        self.coordinator.close()
        shutil.rmtree(self.scratch, ignore_errors=True)


def build(pyramids: Path, source: Path, compressor, *, cancel_at=None, cancel_stage="level0"):
    """One build through the coordinator. Returns its record (and the engine, still open, for reads)."""
    engine = Engine(pyramids, compressor)
    events, cancel = [], {}
    sampler = Sampler()
    started = time.perf_counter()
    request_id = engine.send("pyramid.build", {"path": str(source), "name": source.name})

    def on_event(when, payload):
        events.append((when, payload))
        if cancel_at is not None and not cancel and payload["stage"] == cancel_stage and payload["completed"] >= cancel_at * payload["total"]:
            cancel["sent"] = time.perf_counter()
            engine.send("job.cancel", {"request_id": request_id})
    finished, response = engine.wait(request_id, on_event=on_event)
    samples = sampler.stop()
    record = {"status": response["status"], "seconds": round_(finished - started, 2)}
    if response["status"] == "ok":
        result = response["result"]
        record.update(result=result, source_mib_per_s=round_(source.stat().st_size / MiB / (finished - started)), disk_gib=round_(result["disk_bytes"] / GiB, 3))
    elif response["status"] == "error":
        record["error"] = response["error"]
    gaps = [b[0] - a[0] for a, b in zip(events, events[1:])]
    stage_times = {}
    for when, payload in events:
        stage_times.setdefault(payload["stage"], round_(when - started, 2))
    record.update(events=len(events), event_gap_max_s=round_(max(gaps), 3) if gaps else None, first_event_s=round_(events[0][0] - started, 3) if events else None,
                  stage_start_s=stage_times, memory_peak_mib=round_(max((m for _, m in samples), default=0)), memory_samples=len(samples))
    if cancel:
        record["cancel_ack_ms"] = round_((finished - cancel["sent"]) * 1000)
        # The worker deletes the partial folder in the background after answering: wait for it (up to 60 s) and record how long it took.
        until = time.monotonic() + 60
        while any(pyramids.iterdir()) and time.monotonic() < until:
            time.sleep(0.05)
        record["cleanup_s"] = round_(time.perf_counter() - finished, 2)
        record["leftovers"] = sorted(p.name for p in pyramids.iterdir())
    return record, engine


def read_latency(pyramids: Path, pyramid: str, description: dict, rng):
    """Tile reads through the coordinator with a fresh tile cache: one tile (40 reads) and batches of 16 (10 reads)."""
    level = description["levels"][0]
    engine = Engine(pyramids, None)
    try:
        single, batch = [], []
        for _ in range(40):
            position = [int(rng.integers(level["rows"])), int(rng.integers(level["cols"]))]
            t0 = time.perf_counter()
            engine.send("tile.read", {"pyramid": pyramid, "level": 0, "positions": [position]})
            single.append((time.perf_counter() - t0) * 1000)
        for _ in range(10):
            row = int(rng.integers(level["rows"]))
            positions = [[min(level["rows"] - 1, row + i // level["cols"]), i % level["cols"]] for i in range(min(16, level["rows"] * level["cols"]))]
            t0 = time.perf_counter()
            engine.send("tile.read", {"pyramid": pyramid, "level": 0, "positions": positions})
            batch.append((time.perf_counter() - t0) * 1000)
        return {"single_ms": {"p50": round_(percentile(single, 0.5), 2), "p95": round_(percentile(single, 0.95), 2)},
                "batch16_ms": {"p50": round_(percentile(batch, 0.5), 2), "p95": round_(percentile(batch, 0.95), 2)}}
    finally:
        engine.close()


def reference_halve(a):
    """An independent form of contract §8.2's rule: zero-pad to even sizes, sum 2 x 2 blocks and count the real pixels."""
    h, w, c = a.shape
    padded = np.zeros((h + h % 2, w + w % 2, c), np.int64)
    padded[:h, :w] = a
    mask = np.zeros((h + h % 2, w + w % 2), np.int64)
    mask[:h, :w] = 1
    total = padded.reshape(padded.shape[0] // 2, 2, padded.shape[1] // 2, 2, c).sum(axis=(1, 3))
    count = mask.reshape(mask.shape[0] // 2, 2, mask.shape[1] // 2, 2).sum(axis=(1, 3))[..., None]
    return ((total + count // 2) // count).astype(a.dtype)


def pyramid_region(reader: TileReader, pyramid: str, description: dict, level: int, x: int, y: int, w: int, h: int):
    channels, bits = description["channels"], description["bits"]
    dtype = np.dtype("u1") if bits == 8 else np.dtype("<u2")
    rows, cols = range(y // 512, (y + h - 1) // 512 + 1), range(x // 512, (x + w - 1) // 512 + 1)
    tiles = reader.read(pyramid, level, [[r, c] for r in rows for c in cols])
    block = np.zeros((len(rows) * 512, len(cols) * 512, channels), dtype)
    for index, data in enumerate(tiles):
        r, c = divmod(index, len(cols))
        block[r * 512:(r + 1) * 512, c * 512:(c + 1) * 512] = np.frombuffer(data, dtype).reshape(512, 512, channels)
    return block[y - rows[0] * 512:y - rows[0] * 512 + h, x - cols[0] * 512:x - cols[0] * 512 + w]


def exactness(pyramids: Path, pyramid: str, description: dict, spec: dict):
    """20 regions per level (0-3) compared byte for byte. JPEG sources are lossy: level 0 is compared with libvips' own decoding instead."""
    reader = TileReader(pyramids, cache_bytes=64 * MiB)
    channels, bits = description["channels"], description["bits"]
    checked, mismatches = 0, []
    jpeg = spec.get("compression") == "jpeg"
    for level in range(min(4, len(description["levels"]))):
        info = description["levels"][level]
        for region in gen.sample_regions(info["width"], info["height"], count=20, size=256):
            x, y, w, h = region["x"], region["y"], region["w"], region["h"]
            got = pyramid_region(reader, pyramid, description, level, x, y, w, h)
            if jpeg:
                if level:
                    continue                 # lossy source: only level 0, against libvips' own decoding (it checks the tiling, not the decoder)
                expected = jpeg_region(spec["path"], x, y, w, h)
            else:
                scale = 2**level
                x0, y0 = x * scale, y * scale
                w0 = min(description["width"] - x0, w * scale)
                h0 = min(description["height"] - y0, h * scale)
                expected = gen.pixel_region(x0, y0, w0, h0, channels=channels, bits=bits).reshape(h0, w0, channels)
                for _ in range(level):
                    expected = reference_halve(expected)
                expected = expected[:h, :w]
            checked += 1
            if not np.array_equal(got, expected):
                mismatches.append({"level": level, **region})
    return {"regions_checked": checked, "mismatches": mismatches[:5], "mismatch_count": len(mismatches)}


def jpeg_region(path, x, y, w, h):
    import pyvips
    image = pyvips.Image.jpegload(str(path), access="random", fail_on="error")
    return np.frombuffer(image.crop(x, y, w, h).write_to_memory(), np.uint8).reshape(h, w, image.bands)


def environment():
    import pyvips
    return {"os": platform.platform(), "cpu": platform.processor(), "logical_cpus": os.cpu_count(), "python": platform.python_version(),
            "numpy": np.__version__, "libvips": ".".join(str(pyvips.version(i)) for i in range(3)),
            "commit": subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip(),
            "threads": os.environ.get("OMP_NUM_THREADS")}


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("fixtures", type=Path)
    parser.add_argument("--pyramids", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--phase", choices=("compression", "full", "cancel"), required=True)
    parser.add_argument("--compressor", choices=("none", "zlib"), default="none")
    parser.add_argument("--only", default=None)
    args = parser.parse_args()
    if (ROOT in args.pyramids.resolve().parents) or args.pyramids.resolve() == ROOT:
        parser.error("--pyramids must be outside the repository")
    # The engine caps native thread pools like the desktop program does (server.main); the worker inherits it.
    os.environ.setdefault("OMP_NUM_THREADS", str(max(1, min(4, (os.cpu_count() or 1) - 1))))
    manifest = json.loads((args.fixtures / "fixtures.json").read_text(encoding="utf-8"))
    report = {"tool": "tools/measure_tile_store.py", "card": "M8.4.14", "phase": args.phase, "environment": environment(), "results": {}}
    rng = np.random.default_rng(138501)

    def fresh_root():
        if args.pyramids.exists():
            shutil.rmtree(args.pyramids)
        args.pyramids.mkdir(parents=True)
        return args.pyramids

    def save():
        args.out.write_text(json.dumps(report, indent=1), encoding="utf-8")

    if args.phase == "compression":
        source = args.fixtures / manifest["files"]["rgb2g"]["file"]
        for name, compressor in (("none", None), ("zlib", fmt.ZLIB)):
            print(time.strftime("%H:%M:%S"), "rgb2g", name, file=sys.stderr)
            record, engine = build(fresh_root(), source, compressor)
            engine.close()
            reader, description = TileReader(args.pyramids, cache_bytes=0), None
            pyramid = record["result"]["pyramid"]
            description = reader.describe(pyramid)
            level = description["levels"][0]
            times = []
            for _ in range(200):
                position = [int(rng.integers(level["rows"])), int(rng.integers(level["cols"]))]
                t0 = time.perf_counter()
                reader.read(pyramid, 0, [position])
                times.append((time.perf_counter() - t0) * 1000)
            record["tile_read_ms"] = {"p50": round_(percentile(times, 0.5), 2), "p95": round_(percentile(times, 0.95), 2), "reads": len(times)}
            report["results"][name] = record
            save()
        none, zlib = report["results"]["none"], report["results"]["zlib"]
        ratio = zlib["source_mib_per_s"] / none["source_mib_per_s"]
        chosen = "zlib" if ratio >= 0.70 and zlib["tile_read_ms"]["p95"] <= 10 else "none"
        report["decision"] = {"throughput_ratio_zlib_over_none": round_(ratio, 3), "zlib_tile_read_p95_ms": zlib["tile_read_ms"]["p95"],
                              "disk_ratio_zlib_over_none": round_(zlib["disk_gib"] / none["disk_gib"], 3), "chosen": chosen,
                              "rule": "zlib if throughput ratio >= 0.70 and zlib tile-read p95 <= 10 ms"}
        save()
        shutil.rmtree(args.pyramids, ignore_errors=True)
        print(json.dumps(report["decision"]), file=sys.stderr)
        return
    compressor = fmt.ZLIB if args.compressor == "zlib" else None
    if args.phase == "cancel":
        # Cancellation of rgb2g at ten points of level 0 and two of the hash stage: the time from job.cancel to the terminal "cancelled".
        source = args.fixtures / manifest["files"]["rgb2g"]["file"]
        points = [("level0", 0.05 + 0.9 * i / 9) for i in range(10)] + [("hash", 0.3), ("hash", 0.7)]
        runs = []
        for stage, at in points:
            print(time.strftime("%H:%M:%S"), "cancel", stage, round(at, 2), file=sys.stderr)
            record, engine = build(fresh_root(), source, compressor, cancel_at=at, cancel_stage=stage)
            engine.close()
            runs.append({"stage": stage, "at": round(at, 2), "status": record["status"], "ack_ms": record.get("cancel_ack_ms"), "cleanup_s": record.get("cleanup_s"), "leftovers": record.get("leftovers")})
            report["results"]["runs"] = runs
            save()
        acks = [run["ack_ms"] for run in runs if run["ack_ms"] is not None]
        report["summary"] = {"runs": len(runs), "cancelled": sum(run["status"] == "cancelled" for run in runs), "ack_ms_p50": round_(percentile(acks, 0.5)),
                             "ack_ms_p95": round_(percentile(acks, 0.95)), "ack_ms_max": round_(max(acks)), "leftovers": sum(bool(run["leftovers"]) for run in runs)}
        save()
        shutil.rmtree(args.pyramids, ignore_errors=True)
        print(json.dumps(report["summary"]), file=sys.stderr)
        return
    names = args.only.split(",") if args.only else list(manifest["files"])
    for name in names:
        spec = dict(manifest["files"][name])
        spec["path"] = str(args.fixtures / spec["file"])
        print(time.strftime("%H:%M:%S"), name, file=sys.stderr)
        record, engine = build(fresh_root(), Path(spec["path"]), compressor)
        engine.close()
        if record["status"] == "ok":
            pyramid = record["result"]["pyramid"]
            description = TileReader(args.pyramids).describe(pyramid)
            record["levels"] = [{k: v for k, v in level.items() if k != "level"} for level in description["levels"]]
            record["reads"] = read_latency(args.pyramids, pyramid, description, rng)
            record["exactness"] = exactness(args.pyramids, pyramid, description, spec)
        report["results"][name] = record
        save()
        if name == "rgb2g":
            print(time.strftime("%H:%M:%S"), name, "cancelled at 30 %", file=sys.stderr)
            cancelled, engine = build(fresh_root(), Path(spec["path"]), compressor, cancel_at=0.3)
            engine.close()
            report["results"]["rgb2g_cancelled"] = cancelled
            save()
    shutil.rmtree(args.pyramids, ignore_errors=True)


if __name__ == "__main__":
    main()
