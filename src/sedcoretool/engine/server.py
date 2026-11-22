"""Private desktop coordinator. Run this fixed script with Python -I -u."""

import argparse
import hashlib
import json
import os
import queue
import re
import shutil
import sys
import threading
import time
from collections import OrderedDict, deque
from pathlib import Path
from typing import Callable, NamedTuple
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
    from .worker import DigestJob, MethodJob, MethodRunner, PyramidJob
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
    from worker import DigestJob, MethodJob, MethodRunner, PyramidJob

METHODS = ('buffer.digest/1', SECTION_INTERVALS)
WORKER_ERROR_CODES = ('INVALID_REQUEST', 'UNSUPPORTED_METHOD', 'UNSUPPORTED_INPUT', 'INVALID_BUFFER', 'LIMIT_EXCEEDED', 'INTERNAL')
FIELD_NAME = re.compile(r'[A-Za-z0-9_.\[\]]{1,128}')
COLUMN_NAME = re.compile(r'[A-Za-z][A-Za-z_]{0,63}')
HEX64 = re.compile('[0-9a-f]{64}')
RUNNER_IDLE_SECONDS = 30         # an idle method worker holds memory (NumPy, the last job's arrays); it is started again when needed
PROGRESS_EVENT_SECONDS = 0.1     # at most ten progress events per second (§3)
PYRAMID_NAME = re.compile(r'[^/\\:\x00-\x1f]{1,255}')   # a file name for display: no folder separators or control characters
MAX_PATH = 4096
MASK_OPERATIONS = ('mask.begin', 'mask.put', 'mask.commit', 'mask.discard', 'mask.read', 'mask.retain', 'mask.info', 'mask.copy', 'mask.slice', 'mask.forget', 'mask.derived.put', 'mask.derived.get',
                   'mask.export', 'mask.import')
MAX_STAGINGS = 16                # staged mask versions per session (contract §8.7)
REQUEST_WINDOW = 65_536          # decision V (card M8.4.40): the most recent request IDs remembered to refuse a duplicate; older ones are forgotten
MAX_PENDING_MASK_REQUESTS = 16   # mask requests waiting behind the running one (card M8.4.40); while this many wait, no request is read


def load_store():
    """The tile store's standard-library modules, without running ``sedcoretool/__init__.py`` (it imports pandas and Pillow)."""
    import types
    if 'sedcoretool' not in sys.modules:
        parent = types.ModuleType('sedcoretool')
        parent.__path__ = [str(Path(__file__).resolve().parent.parent)]
        sys.modules['sedcoretool'] = parent
    from sedcoretool.store import format as store_format
    from sedcoretool.store import masks as store_masks
    from sedcoretool.store import tiles as store_tiles
    return store_format, store_tiles, store_masks


class MaskIO:
    """One thread that runs the mask requests (contract §8.7) one at a time, in the order they arrived (card M8.4.40).

    Mask requests read, verify, compress and write files and can take seconds; on this thread they no longer hold up ``tile.read``, the
    progress events of a build or ``job.cancel``, which the coordinator's thread keeps serving. Only this thread touches the mask store's
    state (staged versions, open stores, the session's commits, the blob cache). It never writes to the transport and never waits for the
    coordinator: ``run`` returns ``(result, binary frames)`` or raises, and the outcome goes to ``done`` for the coordinator to answer."""

    def __init__(self, run):
        self.run = run
        self.requests = queue.Queue(maxsize=MAX_PENDING_MASK_REQUESTS)
        self.done = queue.Queue()                 # never full: at most MAX_PENDING_MASK_REQUESTS + 1 outcomes wait in it
        self.pending = 0                          # given and not answered yet; changed only by the coordinator's thread
        self.thread = threading.Thread(target=self.loop, name='mask-io', daemon=True)
        self.thread.start()

    def loop(self):
        while (item := self.requests.get()) is not None:
            request, data, buffers = item
            try:
                outcome = ('ok', self.run(request, data, buffers))
            except BaseException as error:        # answered, or raised again, by the coordinator's thread as before card M8.4.40
                outcome = ('raised', error)
            self.done.put((request, buffers, outcome))

    def offer(self, item, timeout) -> bool:
        try:
            self.requests.put(item, timeout=timeout)
        except queue.Full:
            return False
        self.pending += 1
        return True

    def stop(self):
        """Finish every request already given (their answers are dropped: the session is over), then end the thread."""
        self.requests.put(None)
        self.thread.join()


class Coordinator:
    def __init__(self, output, *, version, runtime_id, worker_script=None, method_script=None, scratch_directory=None,
                 pyramid_directory=None, pyramid_budget=None, projects_directory=None):
        self.output = output
        self.version = version
        self.runtime_id = runtime_id
        self.worker_script = worker_script
        self.method_script = method_script
        self.attachment = None
        self.session = None
        self.seen = OrderedDict()                 # request ID -> None, oldest first (decision V)
        self.request_window = REQUEST_WINDOW
        self.store = BufferStore(scratch_directory=scratch_directory)
        self.jobs = deque()
        self.active = None
        self.runner = None
        self.runner_idle_seconds = RUNNER_IDLE_SECONDS
        self.closing = False
        self.attachments = []
        # Tile store (contract §8): only when the main process named a pyramid folder. Pyramids used in this session are never evicted.
        self.pyramid_root = Path(pyramid_directory) if pyramid_directory else None
        self.pyramid_budget = pyramid_budget
        self.pyramids_used = set()
        self.pyramid_compressor = None    # contract §8.2: no compressor in format version 1 (rule of card M8.4.14, 17 Nov 2026: zlib was 2.5 times slower)
        self.store_format = self.tile_reader = None
        if self.pyramid_root is not None:
            self.store_format, store_tiles, _ = load_store()
            self.pyramid_root.mkdir(parents=True, exist_ok=True)
            self.store_format.remove_partials(self.pyramid_root)
            self.tile_reader = store_tiles.TileReader(self.pyramid_root)
        # Mask store (contract §8.7): only when the main process named the projects folder. Staged versions live in memory only.
        self.projects_root = Path(projects_directory) if projects_directory else None
        self.masks = self.mask_cache = None
        self.mask_io = None                       # started with the first mask request
        self.mask_stores = {}
        self.stagings = {}
        # Card M8.4.31: per store folder and section, the manifests committed by this process in order. `mask.retain` keeps those after the
        # newest one its request names: the page may not have received a commit's answer yet when it asks for a clean-up.
        self.session_commits = {}
        if self.projects_root is not None:
            self.masks = load_store()[2]
            self.projects_root.mkdir(parents=True, exist_ok=True)
            self.mask_cache = self.masks.BlobCache()

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
        # Decision V (card M8.4.40): a sliding window of the last REQUEST_WINDOW identifiers, so a session runs for as long as it is used.
        self.seen[request['id']] = None
        if len(self.seen) > self.request_window:
            self.seen.popitem(last=False)
        try:
            result = self.dispatch(request, data)
            if result is not None:
                self.response(request, result=result)
                if self.attachment is not None:
                    write_binary(self.output, self.attachment)   # the response announced exactly one binary frame
                for part in self.attachments:                    # tile.read: the response announced these frames
                    write_binary(self.output, part)
        except RequestError as error:
            self.response(request, 'error', error=error)
        except OSError:
            self.response(request, 'error', error=RequestError('INTERNAL'))
        finally:
            self.attachment = None
            self.attachments = []

    def dispatch(self, request, data):
        """Contract §9.5: the handshake check, then the operation table. A handler returns the result to answer now, or None when the
        request is answered later (a queued job, a mask request)."""
        operation = request['op']
        if self.session is None and operation != HANDSHAKE:
            raise ProtocolError('handshake required')
        entry = OPERATIONS.get(operation)
        if entry is None:
            raise RequestError('UNSUPPORTED_METHOD')
        return entry.handler(self, request, data)

    # ---- handlers of the operation table (OPERATIONS, after this class) --------------------------------------------

    def hello(self, request, data):
        payload = request['payload']
        require_fields(payload, ('protocol',))
        if self.session is not None or type(payload['protocol']) is not int or payload['protocol'] != 1:
            raise ProtocolError('unsupported handshake')
        self.session = request['session']
        return {'protocol': 1, 'engine_version': self.version, 'runtime_id': self.runtime_id,
                'methods': list(METHODS), 'limits': {'json_bytes': MAX_JSON, 'chunk_bytes': MAX_CHUNK,
                'buffer_bytes': MAX_BUFFER, 'session_bytes': SESSION_BUDGET, 'active_jobs': 1, 'queued_jobs': 4}}

    def buffer_begin(self, request, data):
        return self.store.begin(request['payload'])

    def buffer_derive(self, request, data):
        return self.store.derive(request['payload'])

    def buffer_chunk(self, request, data):
        return self.store.append(request['payload'], data)

    def buffer_commit(self, request, data):
        return self.store.commit(request['payload'])

    def buffer_release(self, request, data):
        payload = request['payload']
        require_fields(payload, ('handles',))
        handles = payload['handles']
        if not isinstance(handles, list) or len(handles) > 64 or not all(is_uuid(handle) for handle in handles):
            raise RequestError('INVALID_REQUEST', 'handles')
        for handle in handles:
            self.store.release(handle)
        return {'released': handles}

    def buffer_read(self, request, data):
        result, self.attachment = self.store.read(request['payload'])
        return result

    def section_analyze(self, request, data):
        self.admit_analysis(request)
        return None

    def buffer_digest(self, request, data):
        payload = request['payload']
        require_fields(payload, ('handle',))
        value = self.store.get(payload['handle'], committed=True)
        if self.active is not None and len(self.jobs) >= 4:
            raise RequestError('BUSY')
        value.pins += 1
        self.jobs.append(request)
        self.start_next()
        return None

    def pyramid_request(self, request, data):
        return self.store_operation(request)

    def mask_submission(self, request, data):
        if self.projects_root is None:
            raise RequestError('UNSUPPORTED_METHOD')
        self.submit_mask(request, data)
        return None

    def job_cancel(self, request, data):
        payload = request['payload']
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

    def shutdown(self, request, data):
        require_fields(request['payload'], ())
        self.answer_masks(wait=True)                 # the mask requests received before it are answered before it
        self.closing = True
        self.cancel_all()
        return {}

    # ---- tile store (contract §8) --------------------------------------------------------------------------------

    def store_operation(self, request):
        operation, payload = request['op'], request['payload']
        if self.pyramid_root is None:
            raise RequestError('UNSUPPORTED_METHOD')
        if operation == 'pyramid.build':
            require_fields(payload, ('path', 'name', 'expect') if 'expect' in payload else ('path', 'name'))
            path, name = payload['path'], payload['name']
            if (not isinstance(path, str) or not 0 < len(path) <= MAX_PATH or '\x00' in path or not Path(path).is_absolute()):
                raise RequestError('INVALID_REQUEST', 'path')
            if not isinstance(name, str) or not PYRAMID_NAME.fullmatch(name):
                raise RequestError('INVALID_REQUEST', 'name')
            expect = payload.get('expect')                       # card M8.4.18b: the SHA-256 a located source must have
            if expect is not None and (not isinstance(expect, str) or not HEX64.fullmatch(expect)):
                raise RequestError('INVALID_REQUEST', 'expect')
            if not Path(path).is_file():
                raise RequestError('UNSUPPORTED_INPUT', 'source')
            if self.active is not None and len(self.jobs) >= 4:
                raise RequestError('BUSY')
            self.jobs.append(request)
            self.start_next()
            return None
        require_fields(payload, ('pyramid',) if operation == 'pyramid.info' else ('pyramid', 'level', 'positions'))
        try:
            description = self.tile_reader.describe(payload['pyramid'])
        except self.store_format.InvalidPyramid:
            raise RequestError('INVALID_REQUEST', 'pyramid') from None
        self.pyramids_used.add(payload['pyramid'])
        if operation == 'pyramid.info':
            os.utime(self.pyramid_root / payload['pyramid'] / 'pyramid.json')     # least-recently-used order of the budget
            return description
        try:
            tiles = self.tile_reader.read(payload['pyramid'], payload['level'], payload['positions'])
        except Exception as error:          # TileError: a missing, unreadable or altered tile is never served
            field = getattr(error, 'field', None)
            if field in ('level', 'positions'):
                raise RequestError('INVALID_REQUEST', field) from None
            if field == 'tile':
                raise RequestError('INVALID_BUFFER', 'tile') from None
            raise
        joined = b''.join(tiles)
        self.attachments = [joined[start:start + MAX_CHUNK] for start in range(0, len(joined), MAX_CHUNK)]
        return {'tiles': [{'row': row, 'col': col, 'byte_length': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
                          for (row, col), data in zip(payload['positions'], tiles)],
                'frames': [len(part) for part in self.attachments]}

    # ---- mask store (contract §8.7) -------------------------------------------------------------------------------

    def mask_store(self, project):
        if not self.masks.valid_project(project):
            raise RequestError('INVALID_REQUEST', 'project')
        if project not in self.mask_stores:
            if len(self.mask_stores) >= 64:
                self.mask_stores.pop(next(iter(self.mask_stores)))
            self.mask_stores[project] = self.masks.MaskStore(self.projects_root / project / 'tiles', self.mask_cache)
        return self.mask_stores[project]

    def staging(self, staged):
        if not is_uuid(staged) or staged not in self.stagings:
            raise RequestError('INVALID_REQUEST', 'staged')
        return self.stagings[staged]

    def recent_commits(self, store, keep) -> list:
        """The manifests of this store committed in this session after the newest one ``keep`` names, section by section (all of a section's
        when ``keep`` names none of them); each section's record is shortened to its newest named manifest and what follows."""
        named = set(keep) if isinstance(keep, list) and all(isinstance(name, str) for name in keep) else set()
        recent = []
        for section, chain in self.session_commits.get(store.folder, {}).items():
            positions = [k for k, name in enumerate(chain) if name in named]
            start = positions[-1] + 1 if positions else 0
            recent.extend(chain[start:])
            if positions:
                self.session_commits[store.folder][section] = chain[positions[-1]:]
        return recent

    # Card M8.4.40: mask requests run on the MaskIO thread, in arrival order. The coordinator's thread admits them (submit_mask), pins the
    # buffers they name, and answers them when they are done (answer_masks); everything between runs on the MaskIO thread (mask_operation).

    def submit_mask(self, request, data):
        """Give a mask request to the MaskIO thread. While MAX_PENDING_MASK_REQUESTS wait, finished ones are answered and jobs kept going,
        and no other request is read: the transport slows down instead of memory growing."""
        if self.mask_io is None:
            self.mask_io = MaskIO(self.mask_operation)
        item = (request, data, self.mask_buffers(request))
        while not self.mask_io.offer(item, timeout=0.002):
            self.poll()

    def mask_buffers(self, request) -> dict:
        """The committed buffers a mask request names, as they are when it arrives, each pinned until the request is answered: a
        ``buffer.release`` sent after it can no longer remove a file the MaskIO thread is about to read."""
        payload, named = request['payload'], []
        if isinstance(payload, dict):
            if request['op'] == 'mask.commit' and isinstance(payload.get('tables'), dict):
                named = list(payload['tables'].values())
            elif request['op'] in ('mask.derived.put', 'mask.import'):
                named = [payload.get('handle')]
        buffers = {}
        for handle in named:
            if isinstance(handle, str) and handle not in buffers:
                try:
                    value = self.store.get(handle, committed=True)
                except RequestError:
                    continue                                    # refused, as before, when the request reaches it (`committed_buffer`)
                value.pins += 1
                buffers[handle] = value
        return buffers

    @staticmethod
    def committed_buffer(buffers, handle):
        """MaskIO thread: a buffer `mask_buffers` resolved; the same refusal as ``BufferStore.get`` otherwise."""
        value = buffers.get(handle) if isinstance(handle, str) else None
        if value is None:
            raise RequestError('INVALID_BUFFER', 'handle')
        return value

    def answer_masks(self, *, wait=False):
        """Answer the mask requests the MaskIO thread has finished; with ``wait``, until every one given to it is answered. An error it raised
        is answered as `receive` answers one (a ProtocolError or an unexpected error ends the session, as before card M8.4.40)."""
        worker = self.mask_io
        while worker is not None and worker.pending:
            try:
                request, buffers, (kind, value) = worker.done.get(block=wait)
            except queue.Empty:
                return
            worker.pending -= 1
            for handle in buffers:
                self.store.unpin(handle)
            if kind == 'ok':
                result, parts = value
                self.response(request, result=result)
                for part in parts:                                  # the response announced these frames
                    write_binary(self.output, part)
            elif isinstance(value, RequestError):
                self.response(request, 'error', error=value)
            elif isinstance(value, OSError):
                self.response(request, 'error', error=RequestError('INTERNAL'))
            else:
                raise value

    @property
    def mask_pending(self) -> bool:
        return self.mask_io is not None and self.mask_io.pending > 0

    def mask_operation(self, request, data, buffers):
        """MaskIO thread: ``(result, binary frames)`` of one mask request."""
        try:
            value = self.mask_request(request['op'], request['payload'], data, buffers)
        except self.masks.MaskError as error:
            raise RequestError(error.code, error.field) from None
        return value if isinstance(value, tuple) else (value, [])

    @staticmethod
    def framed(result, joined):
        """``(result with its frame sizes, frames)``: bytes sent after a response in binary frames of at most MAX_CHUNK."""
        parts = [joined[start:start + MAX_CHUNK] for start in range(0, len(joined), MAX_CHUNK)]
        return {**result, 'frames': [len(part) for part in parts]}, parts

    def mask_request(self, operation, payload, data, buffers):
        if operation == 'mask.begin':
            require_fields(payload, ('project', 'section', 'width', 'height', 'base'))
            if len(self.stagings) >= MAX_STAGINGS:
                raise RequestError('LIMIT_EXCEEDED', 'staged')
            staging = self.masks.Staging(self.mask_store(payload['project']), payload['section'], payload['width'], payload['height'],
                                         payload['base'])
            staged = str(uuid4())
            self.stagings[staged] = staging
            return {'staged': staged, 'rows': staging.rows, 'cols': staging.cols}
        if operation == 'mask.put':
            require_fields(payload, ('staged', 'layer', 'row', 'col', 'sha256'))
            if data is None:
                raise ProtocolError('missing binary frame')
            stored = self.staging(payload['staged']).put(payload['layer'], payload['row'], payload['col'], payload['sha256'], data)
            return {'stored': stored}
        if operation == 'mask.commit':
            require_fields(payload, ('staged', 'tables'))
            staging = self.staging(payload['staged'])
            try:
                manifest = staging.commit(self.mask_tables(payload['tables'], buffers))
            finally:
                del self.stagings[payload['staged']]          # closed also when the commit fails (contract §8.7)
            chain = self.session_commits.setdefault(staging.store.folder, {}).setdefault(staging.section, [])
            if manifest in chain:
                chain.remove(manifest)                            # the same masks committed again: it is the newest now
            chain.append(manifest)
            return {'manifest': manifest}
        if operation == 'mask.discard':
            require_fields(payload, ('staged',))
            if not is_uuid(payload['staged']):
                raise RequestError('INVALID_REQUEST', 'staged')
            self.stagings.pop(payload['staged'], None)
            return {}
        if operation == 'mask.retain':
            require_fields(payload, ('project', 'keep'))
            store = self.mask_store(payload['project'])
            protected = set()
            for staging in self.stagings.values():                              # an open staged version keeps every blob it holds
                if staging.store.folder == store.folder:                        # by folder: its MaskStore may have left `mask_stores` since
                    protected |= {name for entry in staging.tiles.values() for name in (entry['labels'], entry['exclude']) if name}
                    protected |= {table['sha256'] for table in (staging.tables or {}).values() if table}
            return {'removed': self.masks.write_or_disk_error(store.retain, payload['keep'], protected, self.recent_commits(store, payload['keep']))}
        if operation == 'mask.info':
            require_fields(payload, ('project', 'manifest', 'start'))
            return self.mask_store(payload['project']).info(payload['manifest'], payload['start'])
        if operation == 'mask.copy':                                            # card M8.4.27: a project saved under a new identifier
            require_fields(payload, ('from', 'to', 'manifest', 'start'))
            if payload['from'] == payload['to']:
                raise RequestError('INVALID_REQUEST', 'to')
            source, target = self.mask_store(payload['from']), self.mask_store(payload['to'])
            return self.masks.write_or_disk_error(target.copy_from, source, payload['manifest'], payload['start'])
        if operation == 'mask.slice':                                           # card M8.4.43: new version from tile rows [row0, row1), reusing blobs
            require_fields(payload, ('project', 'manifest', 'section', 'row0', 'row1'))
            store = self.mask_store(payload['project'])
            result, joined = self.masks.write_or_disk_error(store.slice_rows, payload['manifest'], payload['section'], payload['row0'], payload['row1'])
            chain = self.session_commits.setdefault(store.folder, {}).setdefault(payload['section'], [])
            if result['manifest'] in chain:
                chain.remove(result['manifest'])
            chain.append(result['manifest'])
            return self.framed(result, joined)
        if operation == 'mask.derived.put':                                     # card M8.4.29: a cache the page derived from a stored version
            require_fields(payload, ('project', 'manifest', 'kind', 'handle'))
            value = self.committed_buffer(buffers, payload['handle'])
            if value.dtype != 'u8' or len(value.shape) != 1:
                raise RequestError('INVALID_BUFFER', 'derived')
            if value.length > self.masks.MAX_DERIVED_BYTES:
                raise RequestError('LIMIT_EXCEEDED', 'derived')
            data = value.path.read_bytes()
            if len(data) != value.length or hashlib.sha256(data).hexdigest() != value.expected_hash:
                raise RequestError('INTERNAL')
            store = self.mask_store(payload['project'])
            return {'byte_length': self.masks.write_or_disk_error(store.put_derived, payload['manifest'], payload['kind'], data)}
        if operation == 'mask.derived.get':
            require_fields(payload, ('project', 'manifest', 'kind'))
            data = self.mask_store(payload['project']).get_derived(payload['manifest'], payload['kind'])
            if data is None:
                return {'found': False}
            return self.framed({'found': True, 'byte_length': len(data), 'sha256': hashlib.sha256(data).hexdigest()}, data)
        if operation == 'mask.export':                                          # card M8.4.18c: files of a stored version, for a backup folder
            require_fields(payload, ('project', 'manifest', 'blobs'))
            store = self.mask_store(payload['project'])
            names = [payload['manifest']] if payload['blobs'] is None else payload['blobs']
            files = [store.export_manifest(payload['manifest'])] if payload['blobs'] is None else store.export_blobs(payload['manifest'], payload['blobs'])
            return self.framed({'files': [{'name': name, 'byte_length': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
                                          for name, data in zip(names, files)]}, b''.join(files))
        if operation == 'mask.import':                                          # card M8.4.18c: files of a backup folder, verified, into the store
            require_fields(payload, ('project', 'kind', 'handle', 'files'))
            kind, files = payload['kind'], payload['files']
            if kind not in ('blobs', 'manifest'):
                raise RequestError('INVALID_REQUEST', 'kind')
            if (not isinstance(files, list) or not 1 <= len(files) <= (self.masks.EXPORT_PAGE if kind == 'blobs' else 1)
                    or not all(isinstance(item, dict) and set(item) == {'name', 'byte_length'} and isinstance(item['name'], str)
                               and self.masks.HEX64.fullmatch(item['name']) and type(item['byte_length']) is int and item['byte_length'] > 0
                               for item in files)):
                raise RequestError('INVALID_REQUEST', 'files')
            value = self.committed_buffer(buffers, payload['handle'])
            if value.dtype != 'u8' or len(value.shape) != 1 or value.length != sum(item['byte_length'] for item in files):
                raise RequestError('INVALID_BUFFER', 'files')
            data = value.path.read_bytes()
            if len(data) != value.length or hashlib.sha256(data).hexdigest() != value.expected_hash:
                raise RequestError('INTERNAL')
            store, parts, offset = self.mask_store(payload['project']), [], 0
            for item in files:
                parts.append((item['name'], data[offset:offset + item['byte_length']]))
                offset += item['byte_length']
            if kind == 'manifest':
                return {'manifest': self.masks.write_or_disk_error(store.import_manifest, parts[0][0], parts[0][1])}
            return {'accepted': self.masks.write_or_disk_error(store.import_blobs, parts)}
        if operation == 'mask.forget':                                          # card M8.4.27: the project's folder is about to be deleted
            require_fields(payload, ('project',))
            store = self.mask_store(payload['project'])
            if any(staging.store.folder == store.folder for staging in self.stagings.values()):
                raise RequestError('BUSY')
            store.forget()
            self.mask_stores.pop(payload['project'], None)
            self.session_commits.pop(store.folder, None)
            return {}
        require_fields(payload, ('project', 'manifest', 'layer', 'positions'))      # mask.read
        store, layer, positions = self.mask_store(payload['project']), payload['layer'], payload['positions']
        manifest, _ = store.read_manifest(payload['manifest'])
        if layer not in self.masks.SAMPLE_BYTES:
            raise RequestError('INVALID_REQUEST', 'layer')
        rows, cols = self.masks.grid(manifest['width'], manifest['height'])
        if not isinstance(positions, list) or not 1 <= len(positions) <= 16:
            raise RequestError('INVALID_REQUEST', 'positions')
        for position in positions:
            if (not isinstance(position, list) or len(position) != 2 or not all(type(value) is int for value in position)
                    or not 0 <= position[0] < rows or not 0 <= position[1] < cols):
                raise RequestError('INVALID_REQUEST', 'positions')
        tiles = [store.read_tile(payload['manifest'], layer, row, col) for row, col in positions]
        return self.framed({'tiles': [{'row': row, 'col': col, 'sha256': None if tile is None else hashlib.sha256(tile).hexdigest(),
                                       'byte_length': 0 if tile is None else len(tile)} for (row, col), tile in zip(positions, tiles)]},
                           b''.join(tile for tile in tiles if tile is not None))

    def mask_tables(self, tables, buffers):
        """The bytes of the committed buffers named in ``mask.commit`` (None for a nullable table: no objects, no overlap), checked against
        their dtypes and limits (contract §8.7)."""
        if not isinstance(tables, dict) or not set(tables) <= set(self.masks.TABLES):
            raise RequestError('INVALID_REQUEST', 'tables')
        out = {}
        for name, handle in tables.items():
            if handle is None and name in self.masks.NULLABLE_TABLES:
                out[name] = None
                continue
            value = self.committed_buffer(buffers, handle)
            if value.dtype != self.masks.TABLE_DTYPES[name] or len(value.shape) != 1:
                raise RequestError('INVALID_BUFFER', f'tables.{name}')
            if value.length > self.masks.TABLE_LIMITS[name]:
                raise RequestError('LIMIT_EXCEEDED', f'tables.{name}')
            data = value.path.read_bytes()
            if len(data) != value.length or hashlib.sha256(data).hexdigest() != value.expected_hash:
                raise RequestError('INTERNAL')
            out[name] = data
        return out

    def start_pyramid(self, request):
        directory = Path(self.store.directory.name) / f'job-{uuid4()}'
        directory.mkdir(parents=True)
        payload = request['payload']
        job_file = directory / 'job.json'
        job_file.write_text(json.dumps({'kind': 'pyramid.build', 'path': payload['path'], 'name': payload['name'], 'expect': payload.get('expect'),
                                        'root': str(self.pyramid_root), 'budget': self.pyramid_budget, 'compressor': self.pyramid_compressor,
                                        'keep': sorted(self.pyramids_used), 'cancel_path': str(directory / 'cancel'),
                                        'progress_path': str(directory / 'progress')}), encoding='utf-8')
        worker = PyramidJob(self.method_runner(), job_file, directory / 'cancel')
        worker.directory = directory
        worker.progress_path = directory / 'progress'
        worker.progress_seen = None
        worker.progress_at = time.monotonic()
        worker.event_at = 0.0
        return worker

    def pyramid_progress(self, active):
        """Send a progress event when the worker's progress file changed (at most ten per second); return False when it has stalled."""
        worker, now = active['worker'], time.monotonic()
        try:
            stamp = worker.progress_path.stat().st_mtime_ns
        except OSError:
            stamp = None
        if stamp is not None and stamp != worker.progress_seen:
            worker.progress_at = now
            if now - worker.event_at >= PROGRESS_EVENT_SECONDS:
                try:
                    value = json.loads(worker.progress_path.read_text(encoding='utf-8'))
                except (OSError, ValueError):
                    value = None                                       # being replaced: read it on the next poll
                if (isinstance(value, dict) and set(value) == {'stage', 'completed', 'total'} and value['stage'] in ('hash', 'level0', 'levels')
                        and all(type(value[key]) is int and value[key] >= 0 for key in ('completed', 'total'))):
                    worker.progress_seen, worker.event_at = stamp, now
                    request = active['request']
                    write_json(self.output, {'v': 1, 'kind': 'event', 'session': request['session'], 'id': request['id'], 'op': request['op'],
                                             'payload': value})
        return now - worker.progress_at < worker.stall_seconds

    def complete_pyramid(self, active, result, worker):
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
            value = result['pyramid']
            expected = {'pyramid', 'width', 'height', 'channels', 'bits', 'levels', 'reused', 'disk_bytes'}
            if (set(value) != expected or not isinstance(value['pyramid'], str) or not HEX64.fullmatch(value['pyramid'])
                    or type(value['reused']) is not bool
                    or not all(type(value[key]) is int and value[key] >= 0 for key in expected - {'pyramid', 'reused'})):
                raise RequestError('INTERNAL')
            self.tile_reader.forget(value['pyramid'])
            try:
                description = self.tile_reader.describe(value['pyramid'])  # the coordinator checks the folder itself
            except self.store_format.InvalidPyramid:
                raise RequestError('INTERNAL') from None
            if (description['width'], description['height'], description['channels'], description['bits'], len(description['levels'])) != (
                    value['width'], value['height'], value['channels'], value['bits'], value['levels']):
                raise RequestError('INTERNAL')
            self.pyramids_used.add(value['pyramid'])
        except RequestError as error:
            self.finish(request, 'error', error=error)
        else:
            self.finish(request, 'ok', result=value)
        finally:
            self.discard(worker)

    # ---- jobs ----------------------------------------------------------------------------------------------------

    def pinned(self, request):
        """Handles that a queued or running job keeps alive until it ends."""
        payload = request['payload']
        if request['op'] == 'pyramid.build':
            return []
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
        if request['op'] == 'pyramid.build':
            return self.start_pyramid(request)
        if request['op'] == 'buffer.digest':
            return DigestJob(self.store.buffers[payload['handle']].path, script=self.worker_script)
        directory = Path(self.store.directory.name) / f'job-{uuid4()}'
        (directory / 'out').mkdir(parents=True)
        buffers = {name: self.store.buffers[handle] for name, handle in payload['inputs'].items()}
        # expected_hash is the SHA-256 the coordinator verified when the buffer was committed (or adopted).
        specification = {name: {'path': str(value.path), 'dtype': value.dtype, 'shape': list(value.shape), 'sha256': value.expected_hash,
                                # What this coordinator itself wrote into a copy of an earlier buffer: every other byte equals the base's.
                                **({'derived_from': {'sha256': value.base_hash, 'ranges': [list(item) for item in value.changes]}} if value.derived else {})}
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
        self.answer_masks()
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
        if active['request']['op'] == 'pyramid.build' and not self.pyramid_progress(active):
            worker.kill()                                              # no progress for stall_seconds (contract §8.4)
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
        elif request['op'] == 'pyramid.build':
            self.complete_pyramid(active, result, worker)
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
            worker, self.mask_io = self.mask_io, None
            if worker is not None:
                worker.stop()                        # before the buffer store goes: it may be reading a pinned buffer
            self.cancel_all(notify=False)
        finally:
            try:
                self.stop_runner()
            finally:
                self.store.close()


class Operation(NamedTuple):
    """One row of the operation table (contract §9.5). ``kind`` says where the request runs: ``control`` is answered on the coordinator's
    thread, ``job`` is queued for a worker, ``mask`` runs on the MaskIO thread (§8.7). ``handler(coordinator, request, data)`` returns the
    result to answer now, or None when the request is answered later."""
    kind: str
    handler: Callable


HANDSHAKE = 'hello'              # the only operation accepted before the handshake
OPERATION_KINDS = ('control', 'job', 'mask')
OPERATIONS = {
    'hello': Operation('control', Coordinator.hello),
    'buffer.begin': Operation('control', Coordinator.buffer_begin),
    'buffer.derive': Operation('control', Coordinator.buffer_derive),
    'buffer.chunk': Operation('control', Coordinator.buffer_chunk),
    'buffer.commit': Operation('control', Coordinator.buffer_commit),
    'buffer.release': Operation('control', Coordinator.buffer_release),
    'buffer.read': Operation('control', Coordinator.buffer_read),
    'section.analyze': Operation('job', Coordinator.section_analyze),
    'buffer.digest': Operation('job', Coordinator.buffer_digest),
    'pyramid.build': Operation('job', Coordinator.pyramid_request),
    'pyramid.info': Operation('control', Coordinator.pyramid_request),
    'tile.read': Operation('control', Coordinator.pyramid_request),
    **{operation: Operation('mask', Coordinator.mask_submission) for operation in MASK_OPERATIONS},
    'job.cancel': Operation('control', Coordinator.job_cancel),
    'shutdown': Operation('control', Coordinator.shutdown),
}


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
            if isinstance(request, dict) and request.get('op') in ('buffer.chunk', 'mask.put'):     # a descriptor/binary pair (§3)
                following = read_frame(stream)
                if following is None or following[0] != BINARY_FRAME:
                    raise ProtocolError('missing binary frame')
                binary = following[1]
            inbox.put((request, binary))
    except (ProtocolError, OSError) as error:
        inbox.put(error)
    finally:
        inbox.put(None)


def serve(input_stream, output_stream, *, version, runtime_id, scratch_directory, pyramid_directory=None, pyramid_budget=None,
          projects_directory=None):
    coordinator = Coordinator(output_stream, version=version, runtime_id=runtime_id, scratch_directory=scratch_directory,
                              pyramid_directory=pyramid_directory, pyramid_budget=pyramid_budget, projects_directory=projects_directory)
    inbox = queue.Queue(maxsize=2)
    threading.Thread(target=read_requests, args=(input_stream, inbox), daemon=True).start()
    try:
        while not coordinator.closing:
            try:
                # While a job or a mask request runs, look again after 2 ms so that its answer is not left waiting (it was up to 20 ms per job).
                item = inbox.get(timeout=0.002 if coordinator.active or coordinator.mask_pending else 0.02)
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
    parser.add_argument('--pyramid-dir')                       # the tile store's pyramid cache (contract §8.1); absent: no store operations
    parser.add_argument('--pyramid-budget-bytes', type=int, default=50 * 2**30)
    parser.add_argument('--projects-dir')                      # project data of the tile store: mask tiles and manifests (contract §8.7)
    args = parser.parse_args()
    if not re.fullmatch('[0-9a-f]{64}', args.runtime_id):
        parser.error('runtime-id must be a SHA-256 digest')
    if args.pyramid_dir is not None and not Path(args.pyramid_dir).is_absolute():
        parser.error('pyramid-dir must be absolute')
    if args.projects_dir is not None and not Path(args.projects_dir).is_absolute():
        parser.error('projects-dir must be absolute')
    if args.pyramid_budget_bytes < 2**30:
        parser.error('pyramid-budget-bytes must be at least 1 GiB')
    bind_to_process_lifetime()  # best effort; workers also watch the liveness pipe
    threads = str(max(1, min(4, (os.cpu_count() or 1) - 1)))
    for variable in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS', 'NUMEXPR_NUM_THREADS', 'VECLIB_MAXIMUM_THREADS'):
        os.environ[variable] = threads
    try:
        # A daemon reader must not hold BufferedReader's lock during interpreter shutdown.
        serve(sys.stdin.buffer.raw, sys.stdout.buffer, version=args.version, runtime_id=args.runtime_id, scratch_directory=args.scratch_dir,
              pyramid_directory=args.pyramid_dir, pyramid_budget=args.pyramid_budget_bytes, projects_directory=args.projects_dir)
    except (ProtocolError, RequestError, OSError):
        # No input content, paths or tracebacks on the public transport/diagnostic boundary.
        print('engine transport closed', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
