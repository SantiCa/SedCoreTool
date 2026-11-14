"""Private desktop coordinator. Run this fixed script with Python -I -u."""

import argparse
import json
import os
import queue
import re
import shutil
import sys
import threading
import time
from collections import deque
from pathlib import Path
from uuid import uuid4

if __package__:
    from .buffers import MAX_BUFFER, SESSION_BUDGET, BufferStore
    from .lifetime import bind_to_process_lifetime
    from .protocol import (
        BINARY_FRAME,
        JSON_FRAME,
        MAX_CHUNK,
        MAX_JSON,
        ProtocolError,
        RequestError,
        is_uuid,
        read_frame,
        require_fields,
        require_integer,
        write_binary,
        write_json,
    )
    from .specs import METHOD_INPUTS, SECTION_INTERVALS, SETTINGS_INPUT
    from .worker import DigestJob, MethodJob, MethodRunner
else:
    # Isolated Python excludes both PYTHONPATH and the script directory. Only our fixed source is added.
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from buffers import MAX_BUFFER, SESSION_BUDGET, BufferStore
    from lifetime import bind_to_process_lifetime
    from protocol import (
        BINARY_FRAME,
        JSON_FRAME,
        MAX_CHUNK,
        MAX_JSON,
        ProtocolError,
        RequestError,
        is_uuid,
        read_frame,
        require_fields,
        require_integer,
        write_binary,
        write_json,
    )
    from specs import METHOD_INPUTS, SECTION_INTERVALS, SETTINGS_INPUT
    from worker import DigestJob, MethodJob, MethodRunner

METHODS = ('buffer.digest/1', SECTION_INTERVALS)
WORKER_ERROR_CODES = ('INVALID_REQUEST', 'UNSUPPORTED_METHOD', 'UNSUPPORTED_INPUT', 'INVALID_BUFFER', 'LIMIT_EXCEEDED', 'INTERNAL')
FIELD_NAME = re.compile(r'[A-Za-z0-9_.\[\]]{1,128}')
COLUMN_NAME = re.compile(r'[A-Za-z][A-Za-z_]{0,63}')
HEX64 = re.compile('[0-9a-f]{64}')
RUNNER_IDLE_SECONDS = 30         # an idle method worker holds memory (NumPy, the last job's arrays); it is started again when needed


class Coordinator:
    def __init__(self, output, *, version, runtime_id, worker_script=None, method_script=None, scratch_directory=None):
        self.output = output
        self.version = version
        self.runtime_id = runtime_id
        self.worker_script = worker_script
        self.method_script = method_script
        self.attachment = None
        self.session = None
        self.seen = set()
        self.store = BufferStore(scratch_directory=scratch_directory)
        self.jobs = deque()
        self.active = None
        self.runner = None
        self.runner_idle_seconds = RUNNER_IDLE_SECONDS
        self.closing = False

    def response(self, request, status='ok', result=None, error=None):
        value = {key: request[key] for key in ('v', 'session', 'id', 'op')}
        value.update(kind='response', status=status)
        if status == 'ok':
            value['result'] = result
        elif status == 'error':
            value['error'] = {'code': error.code, 'message_key': f'engine.error.{error.code}',
                              'retryable': error.code in ('BUSY', 'INTERNAL'),
                              'details': {'field': error.field} if error.field else {}}
        write_json(self.output, value)

    def receive(self, request, data=None):
        require_fields(request, ('v', 'kind', 'session', 'id', 'op', 'payload'))
        if type(request['v']) is not int or request['v'] != 1 or request['kind'] != 'request':
            raise ProtocolError('invalid envelope')
        if not is_uuid(request['id']) or not is_uuid(request['session']) or not isinstance(request['op'], str):
            raise ProtocolError('invalid identity')
        if self.session is not None and request['session'] != self.session:
            raise ProtocolError('stale session')
        if request['id'] in self.seen:
            self.response(request, 'error', error=RequestError('INVALID_REQUEST'))
            return
        if len(self.seen) >= 65_536:
            raise ProtocolError('session request limit')
        self.seen.add(request['id'])
        try:
            result = self.dispatch(request, data)
            if result is not None:
                self.response(request, result=result)
                if self.attachment is not None:
                    write_binary(self.output, self.attachment)   # the response announced exactly one binary frame
        except RequestError as error:
            self.response(request, 'error', error=error)
        except OSError:
            self.response(request, 'error', error=RequestError('INTERNAL'))
        finally:
            self.attachment = None

    def dispatch(self, request, data):
        operation, payload = request['op'], request['payload']
        if operation == 'hello':
            require_fields(payload, ('protocol',))
            if self.session is not None or type(payload['protocol']) is not int or payload['protocol'] != 1:
                raise ProtocolError('unsupported handshake')
            self.session = request['session']
            return {'protocol': 1, 'engine_version': self.version, 'runtime_id': self.runtime_id,
                    'methods': list(METHODS), 'limits': {'json_bytes': MAX_JSON, 'chunk_bytes': MAX_CHUNK,
                    'buffer_bytes': MAX_BUFFER, 'session_bytes': SESSION_BUDGET, 'active_jobs': 1, 'queued_jobs': 4}}
        if self.session is None:
            raise ProtocolError('handshake required')
        if operation == 'buffer.begin':
            return self.store.begin(payload)
        if operation == 'buffer.derive':
            return self.store.derive(payload)
        if operation == 'buffer.chunk':
            return self.store.append(payload, data)
        if operation == 'buffer.commit':
            return self.store.commit(payload)
        if operation == 'buffer.release':
            require_fields(payload, ('handles',))
            handles = payload['handles']
            if not isinstance(handles, list) or len(handles) > 64 or not all(is_uuid(handle) for handle in handles):
                raise RequestError('INVALID_REQUEST', 'handles')
            for handle in handles:
                self.store.release(handle)
            return {'released': handles}
        if operation == 'buffer.read':
            result, self.attachment = self.store.read(payload)
            return result
        if operation == 'section.analyze':
            self.admit_analysis(request)
            return None
        if operation == 'buffer.digest':
            require_fields(payload, ('handle',))
            value = self.store.get(payload['handle'], committed=True)
            if self.active is not None and len(self.jobs) >= 4:
                raise RequestError('BUSY')
            value.pins += 1
            self.jobs.append(request)
            self.start_next()
            return None
        if operation == 'job.cancel':
            require_fields(payload, ('request_id',))
            if not is_uuid(payload['request_id']):
                raise RequestError('INVALID_REQUEST', 'request_id')
            for job in list(self.jobs):
                if job['id'] == payload['request_id']:
                    self.jobs.remove(job)
                    self.finish(job, 'cancelled')
                    return {'state': 'requested'}
            if self.active and self.active['request']['id'] == payload['request_id']:
                if self.active['cancel_at'] is None:
                    self.active['cancel_at'] = time.monotonic()
                    self.active['worker'].cancel()
                return {'state': 'requested'}
            return {'state': 'already_terminal'}
        if operation == 'shutdown':
            require_fields(payload, ())
            self.closing = True
            self.cancel_all()
            return {}
        raise RequestError('UNSUPPORTED_METHOD')

    # ---- jobs ----------------------------------------------------------------------------------------------------

    def pinned(self, request):
        """Handles that a queued or running job keeps alive until it ends."""
        payload = request['payload']
        return [payload['handle']] if request['op'] == 'buffer.digest' else list(payload['inputs'].values())

    def unpin(self, request):
        for handle in self.pinned(request):
            self.store.unpin(handle)

    def resolve_inputs(self, method, inputs):
        """Committed buffers named by a job's inputs, checked against the method's table of dtypes and ranks."""
        specification = METHOD_INPUTS[method]
        required = {name for name, (_, _, needed) in specification.items() if needed}
        if not isinstance(inputs, dict) or not set(inputs) <= set(specification) or not required <= set(inputs):
            raise RequestError('INVALID_REQUEST', 'inputs')
        buffers = {}
        for name, handle in inputs.items():
            try:
                value = self.store.get(handle, committed=True)
            except RequestError:
                raise RequestError('INVALID_BUFFER', name) from None
            dtype, rank, _ = specification[name]
            if value.dtype != dtype or len(value.shape) != rank:
                raise RequestError('INVALID_BUFFER', name)
            buffers[name] = value
        if buffers['labels'].shape != buffers['exclude'].shape:
            raise RequestError('INVALID_BUFFER', 'exclude')
        return buffers

    def admit_analysis(self, request):
        payload = request['payload']
        require_fields(payload, ('method', 'project', 'section', 'revision', 'settings_hash', 'inputs'))
        if payload['method'] != SECTION_INTERVALS:
            raise RequestError('UNSUPPORTED_METHOD', 'method')
        for field in ('project', 'section'):
            if not is_uuid(payload[field]):
                raise RequestError('INVALID_REQUEST', field)
        require_integer(payload['revision'], 'revision')
        if not isinstance(payload['settings_hash'], str) or not HEX64.fullmatch(payload['settings_hash']):
            raise RequestError('INVALID_REQUEST', 'settings_hash')
        buffers = self.resolve_inputs(payload['method'], payload['inputs'])
        if buffers[SETTINGS_INPUT].expected_hash != payload['settings_hash']:
            raise RequestError('INVALID_REQUEST', 'settings_hash')   # the hash is of the exact settings bytes of this request
        if self.active is not None and len(self.jobs) >= 4:
            raise RequestError('BUSY')
        for value in buffers.values():
            value.pins += 1
        self.jobs.append(request)
        self.start_next()

    def start_worker(self, request):
        """The worker process of a queued job. Input buffers stay pinned while the job waits, so they exist."""
        payload = request['payload']
        if request['op'] == 'buffer.digest':
            return DigestJob(self.store.buffers[payload['handle']].path, script=self.worker_script)
        directory = Path(self.store.directory.name) / f'job-{uuid4()}'
        (directory / 'out').mkdir(parents=True)
        buffers = {name: self.store.buffers[handle] for name, handle in payload['inputs'].items()}
        # expected_hash is the SHA-256 the coordinator verified when the buffer was committed (or adopted).
        specification = {name: {'path': str(value.path), 'dtype': value.dtype, 'shape': list(value.shape), 'sha256': value.expected_hash}
                         for name, value in buffers.items()}
        job_file = directory / 'job.json'
        job_file.write_text(json.dumps({'method': payload['method'], 'cancel_path': str(directory / 'cancel'),
                                        'output_dir': str(directory / 'out'), 'inputs': specification}), encoding='utf-8')
        worker = MethodJob(self.method_runner(), job_file, directory / 'cancel')
        worker.directory = directory
        return worker

    def method_runner(self):
        """The long-lived worker for scientific methods; a new one when there is none yet or the last one ended."""
        if self.runner is not None and not self.runner.alive():
            self.stop_runner()
        if self.runner is None:
            self.runner = MethodRunner(self.method_script)
        return self.runner

    def stop_runner(self):
        runner, self.runner = self.runner, None
        if runner is not None:
            runner.close()

    @staticmethod
    def discard(worker):
        directory = getattr(worker, 'directory', None)
        if directory is not None:
            shutil.rmtree(directory, ignore_errors=True)

    def start_next(self):
        if self.active is not None or not self.jobs or self.closing:
            return
        request = self.jobs.popleft()
        # Queued jobs already pinned an immutable snapshot; release only revokes new access.
        try:
            worker = self.start_worker(request)
        except OSError:
            self.finish(request, 'error', error=RequestError('INTERNAL'))
            return
        self.active = {'request': request, 'worker': worker, 'cancel_at': None, 'started_at': time.monotonic()}

    def finish(self, request, status, *, result=None, error=None):
        self.unpin(request)
        self.response(request, status, result, error)

    def poll(self):
        active = self.active
        if active is None:
            self.start_next()
            if self.active is None and self.runner is not None and time.monotonic() - self.runner.idle_since >= self.runner_idle_seconds:
                self.stop_runner()
            return
        worker = active['worker']
        if active['cancel_at'] is not None and time.monotonic() - active['cancel_at'] >= 1.5:
            worker.kill()
        if time.monotonic() - active['started_at'] >= worker.deadline:
            worker.kill()
        if not worker.finished():
            return
        self.active = None
        result = worker.result
        worker.close()
        request = active['request']
        if request['op'] == 'buffer.digest':
            source = self.store.buffers[request['payload']['handle']]
            if result is not None and (result['sha256'] != source.expected_hash or result['byte_length'] != source.length):
                result = None
            if active['cancel_at'] is not None:
                self.finish(request, 'cancelled')
            elif result is not None and worker.process.returncode == 0:
                self.finish(request, 'ok', result=result)
            else:
                self.finish(request, 'error', error=RequestError('INTERNAL'))
        else:
            self.complete_analysis(active, result, worker)
        self.start_next()

    def complete_analysis(self, active, result, worker):
        request = active['request']
        try:
            if active['cancel_at'] is not None:
                self.finish(request, 'cancelled')
                return
            if result is None or result.get('cancelled'):
                raise RequestError('INTERNAL')
            if 'error' in result:
                code, field = result['error']['code'], result['error']['field']
                if code not in WORKER_ERROR_CODES or (field is not None and not (isinstance(field, str) and FIELD_NAME.fullmatch(field))):
                    raise RequestError('INTERNAL')
                raise RequestError(code, field)
            response = self.adopt_results(request['payload'], result, worker.directory / 'out', active)
        except RequestError as error:
            self.finish(request, 'error', error=error)
        else:
            self.finish(request, 'ok', result=response)
        finally:
            self.discard(worker)

    def adopt_results(self, payload, result, directory, active):
        """Take the worker's output files as committed buffers and describe them; nothing stays adopted on failure."""
        dimensions, packed_spec = result['dimensions'], result['packed']
        if (not isinstance(dimensions, dict) or set(dimensions) != {'bins', 'classes', 'schemes'}
                or not all(type(value) is int and value >= 1 for value in dimensions.values())
                or not isinstance(packed_spec, dict) or set(packed_spec) != {'byte_length', 'sha256', 'layout'} or not isinstance(packed_spec['layout'], dict)
                or not all(isinstance(name, str) and COLUMN_NAME.fullmatch(name) for name in packed_spec['layout'])):
            raise RequestError('INTERNAL')
        try:
            handle, layout = self.store.adopt_packed(directory / 'result.bin', packed_spec['byte_length'], packed_spec['sha256'], packed_spec['layout'])
        except RequestError as error:
            if error.code == 'LIMIT_EXCEEDED':
                raise RequestError('LIMIT_EXCEEDED', error.field) from None
            raise RequestError('INTERNAL') from None
        packed = self.store.buffers[handle]
        outputs = {'result': {'handle': handle, 'dtype': 'u8', 'shape': list(packed.shape), 'byte_length': packed.length, 'sha256': packed.expected_hash}}
        input_hashes = {name: self.store.buffers[handle].expected_hash for name, handle in payload['inputs'].items()}
        return {'project': payload['project'], 'section': payload['section'], 'revision': payload['revision'],
                'settings_hash': payload['settings_hash'], 'method': payload['method'], 'dimensions': dimensions, 'outputs': outputs, 'layout': layout,
                'provenance': {'engine_version': self.version, 'runtime_id': self.runtime_id, 'method': payload['method'],
                               'revision': payload['revision'], 'deterministic': True, 'input_sha256': input_hashes,
                               'elapsed_ms': int((time.monotonic() - active['started_at']) * 1000)}}

    def cancel_all(self, *, notify=True):
        while self.jobs:
            request = self.jobs.popleft()
            self.unpin(request)
            if notify:
                self.response(request, 'cancelled')
        if self.active:
            active = self.active
            active['worker'].close()
            self.discard(active['worker'])
            self.active = None
            self.unpin(active['request'])
            if notify:
                self.response(active['request'], 'cancelled')

    def close(self):
        try:
            self.cancel_all(notify=False)
        finally:
            try:
                self.stop_runner()
            finally:
                self.store.close()


def read_requests(stream, inbox):
    try:
        while (frame := read_frame(stream)) is not None:
            kind, data = frame
            if kind != JSON_FRAME:
                raise ProtocolError('unexpected binary')
            if __package__:
                from .protocol import strict_json
            else:
                from protocol import strict_json
            request = strict_json(data)
            binary = None
            if isinstance(request, dict) and request.get('op') == 'buffer.chunk':
                following = read_frame(stream)
                if following is None or following[0] != BINARY_FRAME:
                    raise ProtocolError('missing binary frame')
                binary = following[1]
            inbox.put((request, binary))
    except (ProtocolError, OSError) as error:
        inbox.put(error)
    finally:
        inbox.put(None)


def serve(input_stream, output_stream, *, version, runtime_id, scratch_directory):
    coordinator = Coordinator(output_stream, version=version, runtime_id=runtime_id, scratch_directory=scratch_directory)
    inbox = queue.Queue(maxsize=2)
    threading.Thread(target=read_requests, args=(input_stream, inbox), daemon=True).start()
    try:
        while not coordinator.closing:
            try:
                # While a job runs, look again after 2 ms so that its answer is not left waiting (it was up to 20 ms per job).
                item = inbox.get(timeout=0.002 if coordinator.active else 0.02)
                if item is None:
                    break
                if isinstance(item, Exception):
                    raise item
                coordinator.receive(*item)
            except queue.Empty:
                pass
            coordinator.poll()
    finally:
        coordinator.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--version', required=True)
    parser.add_argument('--runtime-id', required=True)
    parser.add_argument('--scratch-dir', required=True)
    args = parser.parse_args()
    if not re.fullmatch('[0-9a-f]{64}', args.runtime_id):
        parser.error('runtime-id must be a SHA-256 digest')
    bind_to_process_lifetime()  # best effort; workers also watch the liveness pipe
    threads = str(max(1, min(4, (os.cpu_count() or 1) - 1)))
    for variable in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS', 'NUMEXPR_NUM_THREADS', 'VECLIB_MAXIMUM_THREADS'):
        os.environ[variable] = threads
    try:
        # A daemon reader must not hold BufferedReader's lock during interpreter shutdown.
        serve(sys.stdin.buffer.raw, sys.stdout.buffer, version=args.version, runtime_id=args.runtime_id, scratch_directory=args.scratch_dir)
    except (ProtocolError, RequestError, OSError):
        # No input content, paths or tracebacks on the public transport/diagnostic boundary.
        print('engine transport closed', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
