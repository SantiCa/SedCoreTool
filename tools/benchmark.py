"""Measure browser project open/save and shared interval analysis on public fixtures."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import platform
import shutil
import statistics
import subprocess
import sys
import tempfile
import threading
from collections import Counter
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from time import perf_counter
from zipfile import ZipFile, ZipInfo

import numpy as np
import pandas as pd
import psutil
from PIL import Image
from PIL import __version__ as pillow_version

import sedcoretool
from sedcoretool import analyze_mask

ROOT = Path(__file__).resolve().parents[1]
DRIVER = ROOT / "tools" / "benchmark_browser.mjs"
CASES = ("u1385", "synthetic")
SEED = 138501
ABS_TOL = 1e-9
SAMPLE_SECONDS = 0.025
TIMEOUT = 240
MIB = 1024**2


def rle(mask):
    flat = mask.ravel()
    edges = np.r_[0, np.flatnonzero(flat[1:] != flat[:-1]) + 1, flat.size]
    return np.column_stack((flat[edges[:-1]], np.diff(edges))).ravel().tolist()


def make_synthetic(path, *, height=6400, width=960):
    """Write a deterministic normal project package with precomputed nonoverlapping traces.

    The default 960 x 6400 package is the fixture of M0.1 and must stay byte-identical; ``width`` only changes the geometry
    (card M8.4.12 uses 512 x 512 sections, one tile each).
    """
    if not isinstance(height, int) or not 256 <= height <= 16000:
        raise ValueError("Synthetic section height must be an integer from 256 to 16000 pixels")
    if not isinstance(width, int) or not 256 <= width <= 4096:
        raise ValueError("Synthetic section width must be an integer from 256 to 4096 pixels")
    rng = np.random.Generator(np.random.PCG64(SEED))
    w, h, depth_cm = width, height, 128
    column_width = (w - 100) // 2          # 430 for the default width: two columns of traces, 32 pixels from the left edge and 18 apart
    filters = dict(channel="rgb", blackPoint=0, whitePoint=255, gamma=1, brightness=0, contrast=0, saturation=100)
    classes = [
        dict(id="undet", name="Undetermined", color="#d9a441", counts=True, fixed=True, plain=True),
        dict(id="chondrites", name="Chondrites", color="#4c8dff", counts=True),
        dict(id="planolites", name="Planolites", color="#ef5b3b", counts=True),
        dict(id="artifact", name="Artifact", color="#8c8c8c", counts=False, fixed=True, plain=True),
    ]
    sections = []
    with ZipFile(path, "w") as archive:
        for section in range(8):
            name = f"synthetic-{section + 1:02d}"
            mask = np.zeros((h, w), dtype=np.uint16)
            pixels = rng.integers(165, 201, size=(h, w), dtype=np.uint8)
            objects = []
            for y0 in range(16, h - 100, 128):
                for x0, max_width, cls in [(32, column_width, "chondrites"), (32 + column_width + 18, column_width, "planolites")]:
                    x1 = x0 + int(rng.integers(40, max_width))
                    y1 = y0 + int(rng.integers(28, 101))
                    ident = len(objects) + 1
                    mask[y0:y1, x0:x1] = ident
                    shade = int(rng.integers(65, 136))
                    pixels[y0:y1, x0:x1] = shade
                    xx, yy = np.arange(x0, x1), np.arange(y0, y1)
                    dx, dy = len(xx), len(yy)
                    n = dx * dy
                    stats = dict(n=n, sx=int(xx.sum()) * dy, sy=int(yy.sum()) * dx,
                                 sxx=int((xx**2).sum()) * dy, syy=int((yy**2).sum()) * dx,
                                 sxy=int(xx.sum()) * int(yy.sum()), x0=x0, x1=x1 - 1, y0=y0, y1=y1 - 1,
                                 per=2 * (dx + dy) - 4, sL=n * shade, sLL=n * shade**2, sA=0, sB=0, rL=0, rN=0)
                    objects.append(dict(id=ident, cls=cls, src="draw", st=stats))
            excluded = np.zeros((h, w), dtype=np.uint8)
            excluded[2000:2125] = 1
            excluded[3100:3500, 260:520] = 1
            image_path = f"images/{name}.jpg"
            image = io.BytesIO()
            Image.fromarray(pixels).save(image, format="JPEG", quality=85)
            archive.writestr(ZipInfo(image_path), image.getvalue())
            sections.append(dict(
                id=name, name=name, w=w, h=h, full=dict(w=w, h=h), ds=1, rot=0,
                file=dict(path=image_path, name=f"{name}.jpg", type="image/jpeg"),
                top=section * depth_cm, bottom=(section + 1) * depth_cm, units="cm",
                roi=dict(x0=20, x1=w - 20, y0=0, y1=h), filters=filters, preset="none",
                detect=dict(method="adaptive", polarity="dark"), nextId=len(objects) + 1,
                labels=rle(mask), exclude=rle(excluded), objects=objects,
            ))
        project = dict(app="SedCoreTool", kind="project", version=5, id="benchmark-synthetic", name="Benchmark synthetic",
                       classes=classes, settings=dict(binCm=2, minValid=20, noDataPad=0),
                       cores=[dict(id="synthetic", name="Synthetic", units="cm", sections=sections)])
        archive.writestr(ZipInfo("project.json"), json.dumps(project, separators=(",", ":")))


def unpack(runs, section):
    pairs = np.asarray(runs, dtype=np.int32).reshape(-1, 2)
    height, width = section["h"], section["w"]
    if np.any(pairs[:, 1] <= 0) or pairs[:, 1].sum() != height * width:
        raise ValueError(f"Invalid mask length in {section['name']}")
    roi = section["roi"]
    return np.repeat(pairs[:, 0], pairs[:, 1]).reshape(height, width)[roi["y0"]:roi["y1"], roi["x0"]:roi["x1"]]


def python_trial(snapshot_file):
    snapshot = json.loads(snapshot_file.read_text(encoding="utf-8"))
    classes, settings = snapshot["classes"], snapshot["settings"]
    inputs = []
    for section in snapshot["sections"]:
        ids = unpack(section["labels"], section)
        if ids.min() < 0:
            raise ValueError("These benchmark fixtures must have nonoverlapping labels")
        lookup = np.asarray(section["eff"], dtype=np.int32) + 1
        exclude = unpack(section["exclude"], section).astype(bool)
        inputs.append((lookup[ids], exclude, section))
    start = perf_counter()
    results = [
        analyze_mask(mask, section["top"], section["bottom"], units=section["units"],
                     bin_cm=settings["binCm"], min_valid=settings["minValid"], keep_partial=True,
                     class_names=classes, exclude=exclude, name=section["name"])
        for mask, exclude, section in inputs
    ]
    elapsed = (perf_counter() - start) * 1000
    columns = ["depth_top", "depth_bottom", "depth", "valid_pct", "bioturbation_pct",
               *(f"{cls}_pct" for cls in classes), "BI", "ii"]
    bins = [json.loads(result.data[columns].to_json(orient="values", double_precision=15)) for result in results]
    print(json.dumps({"analysisMs": elapsed, "bins": bins, "workerPid": os.getpid()}))


def verify_bins(browser, python):
    if len(browser) != len(python):
        raise ValueError("Section count differs between JavaScript and Python")
    max_depth, max_pct = 0.0, 0.0
    for section, (js_rows, py_rows) in enumerate(zip(browser, python, strict=True), start=1):
        if len(js_rows) != len(py_rows):
            raise ValueError(f"Interval count differs in section {section}")
        for row, (js, py) in enumerate(zip(js_rows, py_rows, strict=True), start=1):
            if len(js) != len(py) or js[-2:] != py[-2:]:
                raise ValueError(f"Class columns or BI/ii differ in section {section}, interval {row}")
            for col, (a, b) in enumerate(zip(js[:-2], py[:-2], strict=True)):
                if a is None or b is None:
                    if a is not b:
                        raise ValueError(f"Missing value differs in section {section}, interval {row}, column {col + 1}")
                    continue
                error = abs(a - b)
                if not error <= ABS_TOL:
                    raise ValueError(f"Numerical mismatch in section {section}, interval {row}, column {col + 1}: {a} vs {b}")
                if col < 3:
                    max_depth = max(max_depth, error)
                else:
                    max_pct = max(max_pct, error)
    return {"max_depth_error": max_depth, "max_percentage_point_error": max_pct}


def run_sample(command, *, browser_tree=False):
    peaks, samples = Counter(), Counter()
    with tempfile.TemporaryFile() as output, subprocess.Popen(command, cwd=ROOT, stdout=output) as child:
        root = psutil.Process(child.pid)
        start = perf_counter()
        try:
            while child.poll() is None:
                resident = {}
                try:
                    descendants = root.children(recursive=True)
                    processes = descendants if browser_tree else [root, *descendants]
                    for process in processes:
                        try:
                            rss = process.memory_info().rss
                            if rss:
                                resident[process.pid] = rss
                        except psutil.NoSuchProcess:
                            pass
                except psutil.NoSuchProcess:
                    pass
                if browser_tree and resident:
                    resident = {0: sum(resident.values())}
                for pid, rss in resident.items():
                    peaks[pid] = max(peaks[pid], rss)
                    samples[pid] += 1
                try:
                    child.wait(timeout=SAMPLE_SECONDS)
                except subprocess.TimeoutExpired:
                    if perf_counter() - start >= TIMEOUT:
                        raise TimeoutError(f"Benchmark process exceeded {TIMEOUT} seconds") from None
        finally:
            if child.poll() is None:
                for process in reversed(root.children(recursive=True)):
                    try:
                        process.kill()
                    except psutil.NoSuchProcess:
                        pass
                child.kill()
        if child.returncode:
            raise subprocess.CalledProcessError(child.returncode, command)
        output.seek(0)
        result = json.load(output)
        # A Windows virtualenv can launch the real Python worker as a child of its executable shim.
        pid = 0 if browser_tree else result.pop("workerPid")
        if not samples[pid]:
            raise RuntimeError("No RSS samples were captured for the benchmark worker")
        return result, peaks[pid] / MIB, samples[pid]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def source_metadata(extra_files=()):
    files = set(git("ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "app", "src/sedcoretool", "examples/U1385I-1H").decode().split("\0")) - {""}
    files.update(["tools/benchmark.py", "tools/benchmark_browser.mjs"])
    files.update(extra_files)
    hashes = hashlib.sha256()
    for name in sorted(files):
        data = (ROOT / name).read_bytes()
        if Path(name).suffix in {".css", ".csv", ".html", ".js", ".json", ".md", ".mjs", ".py", ".svg", ".txt"}:
            data = data.replace(b"\r\n", b"\n")
        hashes.update(name.encode() + b"\0" + hashlib.sha256(data).digest())
    return {
        "commit": git("rev-parse", "HEAD").decode().strip(),
        "dirty": bool(git("status", "--porcelain")),
        "input_files_sha256": hashes.hexdigest(),
    }


def describe_environment():
    cpu = platform.processor()
    if sys.platform == "win32":
        import winreg

        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0") as key:
            cpu = winreg.QueryValueEx(key, "ProcessorNameString")[0].strip()
    elif sys.platform == "linux":
        for line in Path("/proc/cpuinfo").read_text().splitlines():
            if line.startswith("model name"):
                cpu = line.split(":", 1)[1].strip()
                break
    elif sys.platform == "darwin":
        cpu = subprocess.check_output(["sysctl", "-n", "machdep.cpu.brand_string"], text=True).strip()
    return {
        "os": platform.platform(), "architecture": platform.machine(), "cpu": cpu,
        "logical_cpus": psutil.cpu_count(), "physical_cores": psutil.cpu_count(logical=False),
        "ram_mib": round(psutil.virtual_memory().total / MIB),
        "python": platform.python_version(), "sedcoretool": sedcoretool.__version__,
        "numpy": np.__version__, "pandas": pd.__version__, "pillow": pillow_version, "psutil": psutil.__version__,
    }


class QuietHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *_):
        pass


def browser_args(action, url, profile, chrome, case, extra):
    return ["node", str(DRIVER), action, url, str(profile), chrome, case, str(extra)]


def benchmark_case(case, args, url, workspace):
    case_dir = workspace / case
    case_dir.mkdir()
    profile, fixture = case_dir / "seed", case_dir / "synthetic.sedcoretool"
    print(f"Preparing {case}", file=sys.stderr, flush=True)
    if case == "synthetic":
        make_synthetic(fixture)
    prepare = browser_args("prepare", url, profile, args.chrome, case, fixture)
    runtimes = json.loads(subprocess.check_output(prepare, cwd=ROOT, timeout=TIMEOUT))
    snapshot_file = case_dir / "analysis-input.json"
    runs, reference_bins, reference_edit, snapshot = [], None, None, None
    for i in range(args.warmups + args.repetitions):
        with tempfile.TemporaryDirectory(prefix="trial-", dir=case_dir) as trial_dir:
            trial_profile = Path(trial_dir) / "profile"
            shutil.copytree(profile, trial_profile)
            browser, browser_peak, browser_samples = run_sample(
                browser_args("measure", url, trial_profile, args.chrome, case, "snapshot" if i == 0 else "verify"),
                browser_tree=True,
            )
        edit = {key: browser[key] for key in ("id", "bbox", "count")}
        if i == 0:
            snapshot = browser.pop("snapshot")
            reference_bins = browser["bins"]
            reference_edit = edit
            snapshot_file.write_text(json.dumps(snapshot, separators=(",", ":")), encoding="utf-8")
        elif edit != reference_edit or browser["bins"] != reference_bins:
            raise ValueError(f"{case} did not reproduce its browser edit and interval results on repetition {i + 1}")
        python, python_peak, python_samples = run_sample([sys.executable, __file__, "--python-worker", str(snapshot_file)])
        parity = verify_bins(browser["bins"], python["bins"])
        entry = {
            "kind": "warmup" if i < args.warmups else "measurement", "open_ms": browser["openMs"],
            "autosave_ms": browser["saveMs"], "javascript_analysis_ms": browser["analysisMs"],
            "python_analysis_ms": python["analysisMs"], "browser_peak_rss_mib": browser_peak,
            "python_peak_rss_mib": python_peak, "browser_rss_samples": browser_samples, "python_rss_samples": python_samples,
            "parity": parity,
        }
        runs.append(entry)
        print(f"{case} {entry['kind']} {i + 1}: open {entry['open_ms']:.1f} ms, save {entry['autosave_ms']:.1f} ms, "
              f"JS {entry['javascript_analysis_ms']:.1f} ms, Python {entry['python_analysis_ms']:.1f} ms", file=sys.stderr)
    measurements = [run for run in runs if run["kind"] == "measurement"]
    summary = {}
    for metric in ("open_ms", "autosave_ms", "javascript_analysis_ms", "python_analysis_ms",
                   "browser_peak_rss_mib", "python_peak_rss_mib"):
        values = [run[metric] for run in measurements]
        summary[metric] = {"median": statistics.median(values), "min": min(values), "max": max(values)}
    sections = [{k: v for k, v in section.items() if k not in {"labels", "exclude", "stacks", "eff"}}
                for section in snapshot["sections"]]
    return {
        "case": case, "runtimes": runtimes, "seed": SEED if case == "synthetic" else None,
        "synthetic_package_sha256": digest(fixture.read_bytes()) if case == "synthetic" else None,
        "analysis_input_sha256": digest(snapshot_file.read_bytes()),
        "browser_intervals_sha256": digest(json.dumps(reference_bins, separators=(",", ":")).encode()),
        "classes": snapshot["classes"], "settings": snapshot["settings"], "sections": sections,
        "pixels": sum(s["w"] * s["h"] for s in sections),
        "intervals": sum(map(len, reference_bins)),
        "no_data_intervals": sum(row[-2:] == [None, None] for rows in reference_bins for row in rows),
        "deleted_trace": reference_edit,
        "reload_verified_runs": len(runs), "runs": runs, "summary": summary,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--chrome", default=os.getenv("CHROME"), help="Chrome or Chromium executable (or set CHROME)")
    parser.add_argument("--case", choices=("all", *CASES), default="all")
    parser.add_argument("--warmups", type=int, default=1)
    parser.add_argument("--repetitions", type=int, default=5)
    parser.add_argument("--output", type=Path, help="Write the JSON report here instead of stdout")
    args = parser.parse_args()
    if min(args.warmups, args.repetitions) < 1:
        parser.error("warmups and repetitions must be positive")
    args.chrome = args.chrome or next((path for name in ("google-chrome", "chromium", "chrome") if (path := shutil.which(name))), None)
    if not args.chrome:
        parser.error("Set --chrome to a Chrome or Chromium executable")
    args.chrome = str(Path(args.chrome).resolve(strict=True))
    if Path(sedcoretool.__file__).resolve().parent != ROOT / "src" / "sedcoretool":
        parser.error('Install this checkout with python -m pip install -e "."')
    report = {
        "started_utc": datetime.now(timezone.utc).isoformat(), "source": source_metadata(),
        "environment": describe_environment(), "warmups": args.warmups, "repetitions": args.repetitions,
        "absolute_tolerance": ABS_TOL, "rss_poll_target_ms": SAMPLE_SECONDS * 1000,
    }
    with tempfile.TemporaryDirectory(prefix="sedcoretool-benchmark-") as tmp:
        with ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler) as server:
            server_thread = threading.Thread(target=server.serve_forever, daemon=True)
            server_thread.start()
            try:
                url = f"http://127.0.0.1:{server.server_port}/app/index.html"
                cases = CASES if args.case == "all" else (args.case,)
                report["cases"] = [benchmark_case(case, args, url, Path(tmp)) for case in cases]
            finally:
                server.shutdown()
                server_thread.join()
    output = json.dumps(report, indent=2, allow_nan=False) + "\n"
    if args.output:
        args.output.write_text(output, encoding="utf-8")
    else:
        print(output, end="")


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--python-worker":
        python_trial(Path(sys.argv[2]))
    else:
        main()
