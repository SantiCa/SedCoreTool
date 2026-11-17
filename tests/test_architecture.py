"""Import rules of the Python layers (docs/ARCHITECTURE.md §3.1), read from the source with ``ast``.

kernels  -> numpy and the standard library only; no IO-like modules.
methods  -> kernels, numpy and the standard library; no pandas, Pillow, engine or IO-like modules.
engine   -> the coordinator, transport and process wrappers (server, protocol, buffers, specs, lifetime, worker) use the
          standard library only; only the script method_worker.py may use numpy, kernels and methods, and nothing else imports it.
store    -> the tile store (card M8.4.14): format.py, tiles.py and masks.py use the standard library only (the coordinator imports them);
          source.py and pyramid.py may also use numpy, pyvips and the method errors. The store never imports the engine or the public API.
          The coordinator may import only store.format, store.tiles and store.masks; the method worker may import the whole store.
public   -> pipeline, indices, depth, io, ... never start or import the engine process.
"""

import ast
import sys
from pathlib import Path

import pytest

PACKAGE = Path(__file__).resolve().parents[1] / "src" / "sedcoretool"
STDLIB = set(sys.stdlib_module_names)
IO_LIKE = {"os", "sys", "pathlib", "subprocess", "socket", "shutil", "tempfile", "urllib", "http", "ssl", "glob", "io",
           "ctypes", "multiprocessing", "threading", "importlib"}
ENGINE_SIBLINGS = {"buffers", "lifetime", "protocol", "server", "specs", "worker"}   # imported by bare name when run with python -I
PUBLIC = {"pipeline", "indices", "depth", "io", "segmentation", "export", "batch", "cli", "plotting"}
STORE_FOR_THE_COORDINATOR = {"sedcoretool.store", "sedcoretool.store.format", "sedcoretool.store.tiles", "sedcoretool.store.masks"}
STORE_STANDARD_LIBRARY_ONLY = {"__init__.py", "format.py", "tiles.py", "masks.py"}


def imported_modules(relative_path: str, source: str) -> set[str]:
    """Fully qualified names of every module imported anywhere in ``source`` (nested imports included)."""
    parts = Path(relative_path).with_suffix("").parts
    base = ["sedcoretool", *parts[:-1]]
    found = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            found.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                anchor = base[: len(base) - (node.level - 1)]
                module = ".".join([*anchor, *([node.module] if node.module else [])])
            else:
                module = node.module or ""
            found.add(module)
            if module.startswith("sedcoretool"):      # `from sedcoretool.store import pyramid` imports the submodule pyramid
                found.update(f"{module}.{alias.name}" for alias in node.names)
    return found


def violations(relative_path: str, source: str) -> list[str]:
    """Rules of the layer that ``relative_path`` (below src/sedcoretool) belongs to."""
    parts = Path(relative_path).parts
    layer = parts[0] if len(parts) > 1 else Path(relative_path).stem
    problems = []
    for name in sorted(imported_modules(relative_path, source)):
        top, second = name.split(".")[0], (name.split(".") + [""])[1]
        internal = top == "sedcoretool"
        stdlib = top in STDLIB
        bare_engine_sibling = layer == "engine" and name in ENGINE_SIBLINGS
        if layer in ("kernels", "methods"):
            allowed = (stdlib and top not in IO_LIKE) or top == "numpy" or (internal and second in (layer, "kernels"))
            if layer == "kernels" and internal and second != "kernels":
                allowed = False
            if not allowed:
                problems.append(f"{relative_path}: {layer} may not import {name}")
        elif layer == "store":
            light = parts[-1] in STORE_STANDARD_LIBRARY_ONLY
            allowed = stdlib or (internal and second == "store") or (not light and (top in ("numpy", "pyvips") or (internal and second == "methods")))
            if not allowed:
                problems.append(f"{relative_path}: {'this part of the store uses the standard library only and' if light else 'the store'} may not import {name}")
        elif layer == "engine":
            script = parts[-1] == "method_worker.py"
            allowed = (stdlib or bare_engine_sibling or (internal and second == "engine")
                       or (internal and second == "store" and (script or name in STORE_FOR_THE_COORDINATOR))
                       or (script and (top == "numpy" or (internal and second in ("methods", "kernels")))))
            if name.split(".")[-1] == "method_worker" and not script:
                allowed = False        # the coordinator must never load the NumPy worker
            if not allowed:
                problems.append(f"{relative_path}: {'the method worker' if script else 'the coordinator and transport'} may not import {name}")
        elif layer in PUBLIC and internal and second == "engine":
            problems.append(f"{relative_path}: the public API may not import the engine ({name})")
    return problems


SOURCES = sorted(path.relative_to(PACKAGE).as_posix() for path in PACKAGE.rglob("*.py")
                 if path.relative_to(PACKAGE).parts[0] in {"kernels", "methods", "engine", "store"} or path.parent == PACKAGE)


def test_every_layer_has_files_to_check():
    layers = {Path(name).parts[0] for name in SOURCES}
    assert {"kernels", "engine", "store", "pipeline.py"} <= layers


@pytest.mark.parametrize("relative_path", SOURCES)
def test_modules_respect_the_import_rules_of_their_layer(relative_path):
    source = (PACKAGE / relative_path).read_text(encoding="utf-8")
    assert violations(relative_path, source) == []


def test_the_checker_catches_each_kind_of_violation():
    assert violations("kernels/x.py", "import numpy as np\nfrom math import floor\nfrom .binning import bin_edge\n") == []
    assert violations("kernels/x.py", "import pandas as pd")
    assert violations("kernels/x.py", "from PIL import Image")
    assert violations("kernels/x.py", "import os")
    assert violations("kernels/x.py", "from ..indices import IndexScheme")
    assert violations("kernels/x.py", "def f():\n    import subprocess\n")                       # nested imports count
    assert violations("kernels/x.py", "from ..engine import server")
    assert violations("methods/x.py", "from ..kernels.binning import bin_edges\nimport numpy\n") == []
    assert violations("methods/x.py", "import pandas")
    assert violations("methods/x.py", "from ..engine import protocol")
    assert violations("engine/server.py", "import queue\nfrom .protocol import ProtocolError\nfrom buffers import BufferStore\n") == []
    assert violations("engine/server.py", "import numpy")
    assert violations("engine/server.py", "from ..methods import registry")
    assert violations("engine/buffers.py", "import json\nfrom .protocol import strict_json\n") == []
    assert violations("engine/method_worker.py", "import numpy\nfrom ..methods.registry import METHODS\nfrom .protocol import read_frame\nfrom worker import watch_coordinator\n") == []
    assert violations("engine/method_worker.py", "import pandas")
    assert violations("engine/method_worker.py", "from ..unet import train")
    assert violations("engine/worker.py", "import numpy")                       # the process wrapper is imported by the coordinator
    assert violations("engine/worker.py", "from ..methods.registry import METHODS")
    assert violations("engine/server.py", "from .method_worker import run")      # nothing but the subprocess loads the NumPy worker
    assert violations("engine/server.py", "import method_worker")
    assert violations("engine/server.py", "from specs import METHOD_INPUTS\nfrom .specs import SECTION_INTERVALS\n") == []
    assert violations("engine/server.py", "from sedcoretool.store import format as f\nfrom sedcoretool.store import tiles\n") == []
    assert violations("engine/server.py", "from sedcoretool.store import pyramid")      # the builder imports numpy and libvips
    assert violations("engine/server.py", "from sedcoretool.store.source import Source")
    assert violations("engine/method_worker.py", "from sedcoretool.store import pyramid, source") == []
    assert violations("store/tiles.py", "import hashlib\nimport zlib\nfrom . import format as fmt\n") == []
    assert violations("store/tiles.py", "import numpy")
    assert violations("store/format.py", "from sedcoretool.methods.errors import MethodError")
    assert violations("store/pyramid.py", "import numpy\nfrom sedcoretool.methods.errors import MethodError\nfrom .source import Source\n") == []
    assert violations("store/source.py", "import pyvips") == []
    assert violations("store/pyramid.py", "from ..engine import server")
    assert violations("store/pyramid.py", "import pandas")
    assert violations("pipeline.py", "from .kernels.binning import bin_edges\nimport pandas\n") == []
    assert violations("pipeline.py", "from .engine import server")
    assert violations("cli.py", "import sedcoretool.engine.server")
