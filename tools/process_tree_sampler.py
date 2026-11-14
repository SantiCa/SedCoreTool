"""Sample the summed working set of a process tree at a fixed cadence: ``python process_tree_sampler.py <root pid> [interval ms]``.

Prints one line per sample, ``<elapsed ms>|<processes>|<bytes>``, until it is killed. The tree is the root process and all its
descendants (for the desktop program: Electron, its helpers, the engine coordinator and the method worker), so the harness and
the file server stay out of the sum. The list of descendants is refreshed every 500 ms in a background thread; each sample reads
only the known processes, which takes well under a millisecond each, so the cadence of the contract (25 ms) is reachable.
Measurement tool of card M8.3.8 (``tools/measure_engine_analysis.mjs``); needs ``psutil`` (a development dependency).
"""

import sys
import threading
import time

import psutil

REFRESH_SECONDS = 0.5


def keep_members_current(root, shared):
    """Rebuild the process list in the background: listing descendants takes about 100 ms on Windows, which would otherwise
    leave a gap in the samples at every refresh."""
    while True:
        try:
            shared['members'] = {process.pid: process for process in [root, *root.children(recursive=True)]}
        except psutil.Error:
            shared['members'] = {}
        time.sleep(REFRESH_SECONDS)


def sample(root_pid, interval_ms):
    root = psutil.Process(root_pid)
    shared = {'members': {root.pid: root}}
    threading.Thread(target=keep_members_current, args=(root, shared), daemon=True).start()
    started = time.perf_counter()
    while True:
        now = time.perf_counter()
        total = count = 0
        for process in list(shared['members'].values()):
            try:
                total += process.memory_info().rss      # the working set on Windows
                count += 1
            except psutil.Error:
                pass                                    # gone; the next refresh drops it
        print(f'{(now - started) * 1000:.1f}|{count}|{total}', flush=True)
        time.sleep(max(0.0, interval_ms / 1000 - (time.perf_counter() - now)))


if __name__ == '__main__':
    try:
        sample(int(sys.argv[1]), float(sys.argv[2]) if len(sys.argv) > 2 else 25.0)
    except (KeyboardInterrupt, BrokenPipeError):
        pass
