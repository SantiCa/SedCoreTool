"""Long-lived worker that runs scientific methods, one job at a time: ``python -I -B -u method_worker.py``.

Start-up (the interpreter and NumPy) costs about 0.7 s, so the coordinator keeps one worker and sends it jobs. Each job is the
absolute path of a ``job.json`` ({method, cancel_path, output_dir, inputs: {name: {path, dtype, shape, sha256[, derived_from]}}}) written on one line
to stdin; the coordinator never imports NumPy. Numeric inputs are mapped read-only and released before the answer is sent, so
the coordinator can delete them; metadata tables are decoded with the same strict JSON rules the transport uses. Results are
written, packed one after another, to ONE file ``<output_dir>/result.bin`` (little-endian, C order, each column starting at a multiple
of 8 bytes, the total a multiple of 8) and each job is answered by exactly one JSON frame on stdout:
``{"ok": true, "dimensions": {...}, "packed": {byte_length, sha256, layout: {name: {dtype, shape, offset, byte_length}}}}``, or
``{"error": {"code", "field"}}`` for a rejected input, or ``{"cancelled": true}``. One file instead of one per column matters: every file
open costs about 2 ms on Windows. Anything else (a crash, a killed process, an unexpected exception)
ends the process; the coordinator reports the job as an internal error and starts a new worker for the next one. End of input
(the coordinator is gone) ends the process at once, even in the middle of a job.
"""

import gc
import hashlib
import json
import os
import queue
import sys
import threading
import types
from pathlib import Path

ENGINE = Path(__file__).resolve().parent
PACKAGE = ENGINE.parent                                    # .../sedcoretool

if __package__:
    from .protocol import strict_json, write_json
    from .specs import CONTRACT_DTYPES, NUMPY_DTYPES
else:
    # Isolated Python excludes PYTHONPATH and the script directory; add only the engine folder (bare module names).
    sys.path.insert(0, str(ENGINE))
    from protocol import strict_json, write_json
    from specs import CONTRACT_DTYPES, NUMPY_DTYPES


def load_registry():
    """The method registry, without running ``sedcoretool/__init__.py``.

    That module imports pandas and Pillow (about 0.4 s) for the public API; a method worker needs only NumPy and
    the ``kernels`` and ``methods`` packages, so register the package as an empty parent when it is not loaded yet."""
    if 'sedcoretool' not in sys.modules:
        parent = types.ModuleType('sedcoretool')
        parent.__path__ = [str(PACKAGE)]
        sys.modules['sedcoretool'] = parent
    from sedcoretool.methods import registry
    return registry


def load_modules():
    """Import everything the worker needs. This must finish BEFORE the liveness watcher starts: on Windows a thread
    blocked in a synchronous read of the stdin pipe makes other calls on that handle wait, and importing NumPy in a
    clean environment then never returns (found by the GitHub Windows runner; invisible with Anaconda's NumPy)."""
    import numpy as np

    registry = load_registry()                                  # must come first: it makes ``sedcoretool.methods`` importable
    from sedcoretool.methods.errors import Cancelled, MethodError
    return np, registry, Cancelled, MethodError


TABLE_CACHE_ENTRIES = 64


def decoded_table(path, sha256, tables):
    """A metadata table, decoded with the transport's strict rules. A table whose verified hash was decoded before comes from
    `tables` (hash -> value; methods only read their inputs): reading a file costs about 2 ms on Windows."""
    if tables is not None and sha256 in tables:
        return tables[sha256]
    value = strict_json(path.read_bytes(), metadata=True)
    if tables is not None and sha256:
        if len(tables) >= TABLE_CACHE_ENTRIES:
            tables.pop(next(iter(tables)))
        tables[sha256] = value
    return value


def run(job_file, modules, memos=None):
    """Run one job and return the frame that answers it. Every mapping of an input is gone when this returns.

    ``memos`` (method name -> the method's ``new_memo()``, plus the decoded tables under ``'tables'``) belongs to the worker process.
    It remembers, by the SHA-256 of the input buffers (which the coordinator verified when it committed them), the masks that were
    validated and counted before and the tables that were decoded before, so a job that changes only the settings skips all three."""
    np, registry, Cancelled, MethodError = modules

    job = json.loads(Path(job_file).read_text(encoding='utf-8'))
    cancel_path, output = Path(job['cancel_path']), Path(job['output_dir'])
    method = registry.get(job['method'])
    memo = None
    if memos is not None and hasattr(method, 'new_memo'):
        memo = memos.setdefault(job['method'], method.new_memo())
    tables = memos.setdefault('tables', {}) if memos is not None else None
    inputs = {name: None for name in method.INPUT_NAMES}        # an optional input that was not supplied stays None
    hashes = {name: spec.get('sha256') for name, spec in job['inputs'].items()}
    derived = {name: spec['derived_from'] for name, spec in job['inputs'].items() if spec.get('derived_from')}
    for name, spec in job['inputs'].items():
        path = Path(spec['path'])
        if spec['dtype'] == 'utf8json':
            inputs[name] = decoded_table(path, spec.get('sha256'), tables)
        else:
            inputs[name] = np.memmap(path, dtype=NUMPY_DTYPES[spec['dtype']], mode='r', shape=tuple(spec['shape']))
    try:
        result = method.run(method.parse(inputs, hashes=hashes, memo=memo, derived=derived), cancelled=cancel_path.exists, memo=memo)
    except Cancelled:
        return {'cancelled': True}
    except MethodError as error:
        return {'error': {'code': error.code, 'field': error.field}}
    layout, offset, parts = {}, 0, []
    for name, array in result.columns.items():
        array = np.ascontiguousarray(array)
        layout[name] = {'dtype': CONTRACT_DTYPES[array.dtype.str], 'shape': list(array.shape), 'offset': offset, 'byte_length': int(array.nbytes)}
        parts.append((offset, array))
        offset += -(-int(array.nbytes) // 8) * 8
    packed = np.zeros(offset, dtype='u1')
    for start, array in parts:
        packed[start:start + array.nbytes] = array.reshape(-1).view('u1')
    output.mkdir(parents=True, exist_ok=True)
    packed.tofile(output / 'result.bin')
    return {'ok': True, 'dimensions': result.dimensions,
            'packed': {'byte_length': offset, 'sha256': hashlib.sha256(packed.data).hexdigest(), 'layout': layout}}


def read_commands(commands):
    """Queue the job paths the coordinator sends. End of input means the coordinator is gone: stop at once, as the one-job
    workers did when the liveness pipe closed (the Windows Job Object normally ends the whole tree first)."""
    stream = sys.stdin.buffer
    while (line := stream.readline()):
        commands.put(line.decode('utf-8').strip())
    os._exit(1)


def serve(modules):
    """Answer jobs until the process is killed. The reader thread starts only after the imports (see ``load_modules``)."""
    commands = queue.Queue()
    threading.Thread(target=read_commands, args=(commands,), daemon=True).start()
    memos = {}                                                  # per-method memory; lives and dies with this process
    while True:
        job_file = commands.get()
        frame = run(job_file, modules, memos)
        gc.collect()                                            # unmap the inputs before the coordinator may delete them
        write_json(sys.stdout.buffer, frame)


if __name__ == '__main__':
    loaded = load_modules()
    serve(loaded)
