"""Coordinator-side wrappers of isolated worker processes, and the diagnostic digest worker script.

Everything here is standard library only: the coordinator imports this module and must stay light and responsive.
The worker that runs scientific methods is the separate script ``method_worker.py``.
"""

import hashlib
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

if __package__:
    from .protocol import JSON_FRAME, MAX_CHUNK, ProtocolError, read_frame, strict_json, write_json
else:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from protocol import JSON_FRAME, MAX_CHUNK, ProtocolError, read_frame, strict_json, write_json


class WorkerJob:
    """One worker subprocess with a private liveness pipe, a cancellation marker file and one result frame.

    The worker script receives the command arguments; it may write exactly one JSON frame on stdout, which
    ``accepts`` must approve. ``deadline`` is the longest the coordinator lets it run, in seconds."""

    deadline = 30

    def __init__(self, command, cancel_path):
        self.cancel_path = cancel_path
        self.result = None
        self.drained = threading.Event()
        self.process = subprocess.Popen(
            command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0,
        )
        self.reader = threading.Thread(target=self.read_result, daemon=True)
        self.reader.start()

    def accepts(self, result):
        raise NotImplementedError

    def read_result(self):
        try:
            frame = read_frame(self.process.stdout)
            if frame is not None and frame[0] == JSON_FRAME:
                result = strict_json(frame[1])
                if self.accepts(result) and read_frame(self.process.stdout) is None:
                    self.result = result
        except (ProtocolError, OSError):
            self.kill()
        finally:
            self.drained.set()

    def cancel(self):
        self.cancel_path.touch(exist_ok=True)

    def kill(self):
        if self.process.poll() is None:
            self.process.kill()

    def finished(self):
        return self.process.poll() is not None and self.drained.is_set()

    def close(self):
        self.kill()
        self.process.wait(timeout=1)
        self.reader.join(timeout=1)
        self.process.stdin.close()
        self.process.stdout.close()
        self.cancel_path.unlink(missing_ok=True)


class DigestJob(WorkerJob):
    """Diagnostic: SHA-256 of a committed buffer, computed in an isolated process."""

    def __init__(self, source, *, script=None):
        cancel_path = source.with_suffix('.cancel')
        super().__init__([sys.executable, '-I', '-B', '-u', str(script or Path(__file__).resolve()), str(source), str(cancel_path)], cancel_path)

    def accepts(self, result):
        return (isinstance(result, dict) and set(result) == {'sha256', 'byte_length'}
                and isinstance(result['sha256'], str) and len(result['sha256']) == 64
                and type(result['byte_length']) is int and result['byte_length'] >= 0)


class MethodRunner:
    """The long-lived ``method_worker.py`` process. It runs one job at a time and answers each with exactly one JSON frame.

    Starting it costs the interpreter and NumPy (about 0.7 s), which is why it is kept between jobs. Any anomaly (an
    unexpected, unapproved or missing frame, a write failure, a kill) ends the process; the coordinator then starts a new one
    for the next job, so a damaged worker never serves a second job."""

    def __init__(self, script):
        self.process = subprocess.Popen(
            [sys.executable, '-I', '-B', '-u', str(script or Path(__file__).resolve().with_name('method_worker.py'))],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0,
        )
        self.lock = threading.Lock()
        self.waiting = None                    # the job whose answer is expected
        self.idle_since = time.monotonic()
        self.reader = threading.Thread(target=self.read_answers, daemon=True)
        self.reader.start()

    def alive(self):
        return self.process.poll() is None

    def submit(self, job):
        with self.lock:
            self.waiting = job
        try:
            self.process.stdin.write(str(job.job_file).encode('utf-8') + b'\n')
            self.process.stdin.flush()
        except OSError:
            self.kill()                        # the reader then ends the job without a result

    def read_answers(self):
        try:
            while (frame := read_frame(self.process.stdout)) is not None:
                if frame[0] != JSON_FRAME:
                    raise ProtocolError('unexpected binary frame')
                answer = strict_json(frame[1])
                with self.lock:
                    job, self.waiting = self.waiting, None
                if job is None:
                    raise ProtocolError('answer without a job')
                if not job.accepts(answer):
                    job.drained.set()          # the job ends without a result, then the worker is stopped below
                    raise ProtocolError('unapproved answer')
                job.result = answer
                self.idle_since = time.monotonic()
                job.drained.set()
        except (ProtocolError, OSError):
            self.kill()
        finally:
            with self.lock:
                job, self.waiting = self.waiting, None
            if job is not None:
                job.drained.set()              # the process ended without answering

    def kill(self):
        if self.process.poll() is None:
            self.process.kill()

    def close(self):
        self.kill()
        self.process.wait(timeout=1)
        self.reader.join(timeout=1)
        self.process.stdin.close()
        self.process.stdout.close()


class MethodJob:
    """One job on a ``MethodRunner``: the coordinator's handle on it, with the same surface as ``WorkerJob``.

    ``deadline`` is the longest the coordinator lets the job run, in seconds. ``result`` is the approved answer, or ``None``
    when the worker died, sent something else, or was killed."""

    deadline = 120

    def __init__(self, runner, job_file, cancel_path):
        self.runner = runner
        self.job_file = job_file
        self.cancel_path = cancel_path
        self.result = None
        self.drained = threading.Event()
        runner.submit(self)

    def accepts(self, result):
        if not isinstance(result, dict):
            return False
        if set(result) == {'cancelled'}:
            return result['cancelled'] is True
        if set(result) == {'error'}:
            error = result['error']
            return isinstance(error, dict) and set(error) == {'code', 'field'} and isinstance(error['code'], str)
        return set(result) == {'ok', 'dimensions', 'columns'} and result['ok'] is True and isinstance(result['columns'], dict)

    def cancel(self):
        self.cancel_path.touch(exist_ok=True)

    def kill(self):
        self.runner.kill()

    def finished(self):
        return self.drained.is_set()

    def close(self):
        if self.result is None:
            self.runner.kill()                 # an unanswered job leaves no worker behind
        self.cancel_path.unlink(missing_ok=True)


def digest_file(source, cancel_path, output):
    digest, completed = hashlib.sha256(), 0
    with source.open('rb') as stream:
        while not cancel_path.exists():
            chunk = stream.read(MAX_CHUNK)
            if not chunk:
                write_json(output, {'sha256': digest.hexdigest(), 'byte_length': completed})
                return
            digest.update(chunk)
            completed += len(chunk)


def watch_coordinator():
    # The write end belongs only to the coordinator. EOF also detects abrupt coordinator death.
    sys.stdin.buffer.raw.read(1)
    os._exit(1)


if __name__ == '__main__':
    threading.Thread(target=watch_coordinator, daemon=True).start()
    try:
        digest_file(Path(sys.argv[1]), Path(sys.argv[2]), sys.stdout.buffer)
    except (OSError, ProtocolError):
        raise SystemExit(1) from None
