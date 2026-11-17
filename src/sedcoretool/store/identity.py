"""The identity record of the tile store (contract §8.2): which SHA-256 a source file had the last time it was hashed whole.

A pyramid is named by the SHA-256 of its source file. Hashing a file of 8 GiB takes about 7 s, and it used to be done every time the file was
added, even when its pyramid was already on disk (card M8.4.15, step 7). After a full hash the engine remembers the file by its absolute path,
size and modification time (nanoseconds) and by the SHA-256 of three samples of one MiB (start, middle, end); when all of these match again,
the recorded SHA-256 is used to find the existing pyramid without reading the whole file. The record is only a shortcut: it is never used to
build a pyramid (a build always hashes the whole file), and a missing, unreadable or invalid record is ignored and replaced.

Known limit: a file rewritten in place with the same size, the same modification time to the nanosecond and the same sampled MiB, but other
bytes elsewhere, would show its old pyramid. Editing programs and copies change the modification time; the samples catch most other cases.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

from . import format as fmt

RECORD_NAME = 'identities.json'
FORMAT = 'sedcoretool.identities'
VERSION = 1
SAMPLE_BYTES = 2**20
MAX_ENTRIES = 1024
MAX_RECORD_BYTES = 2**20
MAX_PATH = 32767


def file_key(path: Path) -> dict:
    """The absolute, case-normalised path of ``path`` with its size and modification time in nanoseconds."""
    resolved = os.path.normcase(str(Path(path).resolve()))
    status = os.stat(resolved)
    return {'path': resolved, 'size': status.st_size, 'mtime_ns': status.st_mtime_ns}


def sample_digest(path: Path, size: int) -> str:
    """SHA-256 of the file's first, middle and last MiB (the whole file when it is at most three MiB), with the size in front."""
    digest = hashlib.sha256(size.to_bytes(8, 'little'))
    with Path(path).open('rb') as stream:
        if size <= 3 * SAMPLE_BYTES:
            digest.update(stream.read(size))
        else:
            for offset in (0, (size - SAMPLE_BYTES) // 2, size - SAMPLE_BYTES):
                stream.seek(offset)
                digest.update(stream.read(SAMPLE_BYTES))
    return digest.hexdigest()


def _valid_entry(entry) -> bool:
    return (isinstance(entry, dict) and set(entry) == {'path', 'size', 'mtime_ns', 'sample', 'sha256'}
            and isinstance(entry['path'], str) and 0 < len(entry['path']) <= MAX_PATH
            and all(type(entry[name]) is int and entry[name] >= 0 for name in ('size', 'mtime_ns'))
            and all(isinstance(entry[name], str) and fmt.HEX64.fullmatch(entry[name]) for name in ('sample', 'sha256')))


def read_entries(root: Path) -> list[dict]:
    """The recorded entries, oldest first; an empty list when the record is missing, too large or not exactly of this format."""
    record = Path(root) / RECORD_NAME
    try:
        if not record.is_file() or record.stat().st_size > MAX_RECORD_BYTES:
            return []
        value = json.loads(record.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return []
    if not (isinstance(value, dict) and value.get('format') == FORMAT and value.get('version') == VERSION and isinstance(value.get('entries'), list)):
        return []
    entries = value['entries']
    return entries if len(entries) <= MAX_ENTRIES and all(_valid_entry(entry) for entry in entries) else []


def lookup(root: Path, key: dict, sample: str) -> str | None:
    """The SHA-256 recorded for this exact file state, or None."""
    for entry in reversed(read_entries(root)):
        if (entry['path'], entry['size'], entry['mtime_ns'], entry['sample']) == (key['path'], key['size'], key['mtime_ns'], sample):
            return entry['sha256']
    return None


def remember(root: Path, key: dict, sample: str, sha256: str) -> None:
    """Record the full hash of this file state (newest last; at most MAX_ENTRIES, the oldest dropped). Written atomically; a failure to
    write only loses the shortcut, so it is ignored."""
    entries = [entry for entry in read_entries(root) if entry['path'] != key['path']]
    entries.append({'path': key['path'], 'size': key['size'], 'mtime_ns': key['mtime_ns'], 'sample': sample, 'sha256': sha256})
    entries = entries[-MAX_ENTRIES:]
    while len(entries) > 1 and len(json.dumps(entries)) > MAX_RECORD_BYTES - 4096:
        entries.pop(0)
    try:
        fmt.write_json_atomically(Path(root) / RECORD_NAME, {'format': FORMAT, 'version': VERSION, 'entries': entries})
    except OSError:
        pass
