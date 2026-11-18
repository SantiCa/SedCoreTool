"""Build hash-locked, relocatable desktop Python resources; never runs in the installed app."""

from __future__ import annotations

import argparse
import csv
import hashlib
import http.client
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path, PurePosixPath
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
LOCK = ROOT / 'desktop/runtime-lock.json'
OUTPUT = ROOT / 'desktop/runtime'
CACHE = ROOT / '.venv/runtime-downloads'
MAX_EXPANDED = 2 * 1024**3
MAX_MEMBERS = 50_000
MAX_SOURCE_BYTES = 16 * 1024**2      # a pure-Python package copied from its source archive
SOURCE_SUFFIXES = ('.py', '.pyi')
# Card M8.4.26: a download that fails in transfer (timeout, dropped connection, truncated body, server error) is tried again after these
# pauses, always into a new temporary file; bytes that arrive whole but do not match the lock are never tried again.
DOWNLOAD_ATTEMPTS = 4
DOWNLOAD_PAUSES_S = (2, 5, 15)
DOWNLOAD_TIMEOUT_S = 30


class TransferError(Exception):
    """A download that ended before every locked byte arrived; worth another attempt."""


def transfer_failed(error):
    """True for failures of the transfer, which another attempt may not repeat; never for a verification failure (ValueError)."""
    if isinstance(error, urllib.error.HTTPError):
        return error.code >= 500 or error.code in (408, 429)
    return isinstance(error, (TransferError, OSError, http.client.HTTPException))


def native_target():
    architecture = {'AMD64': 'x64', 'x86_64': 'x64', 'arm64': 'arm64', 'aarch64': 'arm64'}.get(platform.machine())
    return f'{sys.platform}-{architecture}'


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        while block := stream.read(1024**2):
            digest.update(block)
    return digest.hexdigest()


def safe_relative(value):
    if not isinstance(value, str) or not value or '\\' in value or ':' in value or '\0' in value:
        raise ValueError('Invalid resource path')
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in ('', '.', '..') for part in value.split('/')):
        raise ValueError('Invalid resource path')
    return path


def download_once(artifact, temporary, opener):
    """One attempt: the bytes into `temporary`, then size and SHA-256 checked against the lock."""
    request = urllib.request.Request(artifact['url'], headers={'User-Agent': 'SedCoreTool-runtime-builder'})
    with opener(request, timeout=DOWNLOAD_TIMEOUT_S) as response, temporary.open('xb') as output:
        length = 0
        while block := response.read(1024**2):
            length += len(block)
            if length > artifact['size']:
                raise ValueError('Download exceeds locked size')
            output.write(block)
    if length < artifact['size']:
        raise TransferError(f'connection ended after {length} of {artifact["size"]} bytes')
    if sha256_file(temporary) != artifact['sha256']:
        raise ValueError(f'Download failed verification: {artifact["filename"]}')


def download_artifact(artifact, cache, *, offline=False, opener=urllib.request.urlopen, sleep=time.sleep, log=None):
    filename = artifact['filename']
    if len(safe_relative(filename).parts) != 1 or not re.fullmatch('[0-9a-f]{64}', artifact['sha256']):
        raise ValueError('Invalid artifact descriptor')
    if type(artifact['size']) is not int or not 0 < artifact['size'] <= 256 * 1024**2:
        raise ValueError('Invalid artifact size')
    if not artifact['url'].startswith(('https://github.com/astral-sh/python-build-standalone/releases/download/',
                                       'https://files.pythonhosted.org/')):
        raise ValueError('Untrusted artifact origin')
    cache.mkdir(parents=True, exist_ok=True)
    target = cache / filename
    if target.exists():
        if target.stat().st_size == artifact['size'] and sha256_file(target) == artifact['sha256']:
            return target
        raise ValueError(f'Cached artifact failed verification: {filename}')
    if offline:
        raise ValueError(f'Artifact not cached: {filename}')
    log = log or (lambda message: print(message, file=sys.stderr, flush=True))
    for attempt in range(1, DOWNLOAD_ATTEMPTS + 1):
        temporary = cache / f'.download-{uuid4().hex}'
        try:
            download_once(artifact, temporary, opener)
            os.replace(temporary, target)
            return target
        except Exception as error:
            if not transfer_failed(error):
                raise
            if attempt == DOWNLOAD_ATTEMPTS:
                raise RuntimeError(f'Download of {filename} failed {DOWNLOAD_ATTEMPTS} times; last error: {error!r}') from error
            pause = DOWNLOAD_PAUSES_S[min(attempt - 1, len(DOWNLOAD_PAUSES_S) - 1)]
            log(f'Download of {filename} failed ({error!r}); trying again in {pause} s (attempt {attempt + 1} of {DOWNLOAD_ATTEMPTS})')
            sleep(pause)
        finally:
            temporary.unlink(missing_ok=True)
    raise AssertionError('unreachable')


def extract_runtime(archive, destination):
    """Reject oversized/path-escaping archives before extracting the verified distribution."""
    with tarfile.open(archive, 'r:gz') as source:
        members, expanded, seen = [], 0, set()
        for member in source:
            normalized = member.name.rstrip('/')
            relative = safe_relative(normalized)
            if relative.parts[0] != 'python' or normalized in seen:
                raise ValueError('Unexpected archive member')
            seen.add(normalized)
            expanded += member.size
            if len(members) >= MAX_MEMBERS or expanded > MAX_EXPANDED or member.size > 256 * 1024**2:
                raise ValueError('Expanded runtime limit')
            if not (member.isfile() or member.isdir() or member.issym() or member.islnk()):
                raise ValueError('Unsupported archive member')
            members.append(member)
        # Python 3.12's data filter validates links against the actual extraction root too.
        source.extractall(destination, members=members, filter='data')


def install_wheels(specification, artifacts, destination, *, runner=subprocess.run):
    requirements = destination / 'requirements.lock'
    requirements.write_text(''.join(f"{wheel['name']}=={wheel['version']} --hash=sha256:{wheel['sha256']}\n"
                                    for wheel in specification['wheels']), encoding='utf-8')
    wheels = destination / '.wheels'
    wheels.mkdir()
    for artifact in artifacts:
        shutil.copyfile(artifact, wheels / artifact.name)
    # pip accepts only the exact platform tags it is given on Linux (not older manylinux tags), so a target may list several.
    platforms = specification['wheel_platform']
    platforms = [platforms] if isinstance(platforms, str) else list(platforms)
    if not platforms or not all(isinstance(item, str) and re.fullmatch('[a-z0-9_]+', item) for item in platforms):
        raise ValueError('Invalid wheel platform')
    try:
        runner([sys.executable, '-m', 'pip', 'install', '--isolated', '--disable-pip-version-check', '--no-index',
                '--no-deps', '--only-binary=:all:', '--no-compile', '--require-hashes',
                *(argument for platform_tag in platforms for argument in ('--platform', platform_tag)),
                '--python-version', '3.12', '--implementation', 'cp', '--abi', 'cp312',
                '--target', str(destination / specification['site_packages']), '--find-links', str(wheels), '-r', str(requirements)],
               check=True, timeout=180)
        # Host pip generates launchers with host/staging paths. The desktop imports these packages;
        # their developer command-line launchers are not part of the relocatable engine product.
        site_packages = destination / specification['site_packages']
        for name in ('bin', 'Scripts'):
            scripts = site_packages / name
            if scripts.exists():
                if scripts.is_symlink() or scripts.parent.resolve() != site_packages.resolve():
                    raise ValueError('Invalid generated script directory')
                shutil.rmtree(scripts)
        for record in site_packages.glob('*.dist-info/RECORD'):
            with record.open(encoding='utf-8', newline='') as input_stream:
                rows = list(csv.reader(input_stream))
            rows = [row for row in rows if row and not row[0].startswith(('../../bin/', '../../Scripts/'))]
            with record.open('w', encoding='utf-8', newline='') as output:
                csv.writer(output, lineterminator='\n').writerows(rows)
    finally:
        shutil.rmtree(wheels)


def install_sources(sources, artifacts, site_packages):
    """Pure-Python packages that are published only as source archives (pyvips): copy the package's ``.py``/``.pyi`` files and
    its licence, and write a minimal ``dist-info`` so ``importlib.metadata`` reports the pinned version. Nothing is built and no
    setup code runs; the archive was verified by its SHA-256 when it was downloaded."""
    for source, artifact in zip(sources, artifacts, strict=True):
        name, version, package = source['name'], source['version'], source['package']
        if not re.fullmatch('[A-Za-z0-9_]+', package) or not re.fullmatch('[A-Za-z0-9_.-]+', f'{name}-{version}'):
            raise ValueError('Invalid source package descriptor')
        prefix, target = f'{name}-{version}/', site_packages / package
        if target.exists():
            raise ValueError('Source package already present')
        total, licence = 0, None
        with tarfile.open(artifact, 'r:gz') as archive:
            members = archive.getmembers()
            if len(members) > 2_000:
                raise ValueError('Too many archive members')
            for member in members:
                if not (member.name + '/').startswith(prefix):
                    raise ValueError('Unexpected source archive layout')
                relative = member.name[len(prefix):]
                if member.isdir() or not relative:
                    continue
                if not member.isfile():
                    raise ValueError('Unsupported archive member')
                total += member.size
                if total > MAX_SOURCE_BYTES:
                    raise ValueError('Source archive too large')
                if relative in ('LICENSE', 'LICENSE.txt'):
                    licence = archive.extractfile(member).read()
                elif relative.startswith(package + '/') and relative.endswith(SOURCE_SUFFIXES) and relative != f'{package}/{package}_build.py':
                    destination = site_packages.joinpath(*safe_relative(relative).parts)
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    destination.write_bytes(archive.extractfile(member).read())
        if licence is None or not (target / '__init__.py').is_file():
            raise ValueError('Incomplete source package')
        info = site_packages / f'{package}-{version}.dist-info'
        info.mkdir()
        (info / 'METADATA').write_text(f'Metadata-Version: 2.1\nName: {name}\nVersion: {version}\n', encoding='utf-8')
        (info / 'INSTALLER').write_text('sedcoretool-runtime\n', encoding='utf-8')
        (info / 'top_level.txt').write_text(package + '\n', encoding='utf-8')
        (info / 'LICENSE.txt').write_bytes(licence)


# Content of the upstream interpreter and wheels that the engine never imports. The program verifies every shipped file
# at launch, so each unneeded file costs start-up time (several seconds on a cold first launch) as well as disk space.
# Paths are relative to the staging root; the Windows and POSIX layouts differ, and a path absent from the
# current target is simply skipped.
UNUSED_INTERPRETER_PATHS = (
    'python/include', 'python/libs', 'python/tcl',
    'python/Lib/idlelib', 'python/Lib/lib2to3', 'python/Lib/turtledemo', 'python/Lib/test',
    'python/lib/tcl8.6', 'python/lib/tk8.6',
    'python/lib/python3.12/idlelib', 'python/lib/python3.12/lib2to3',
    'python/lib/python3.12/turtledemo', 'python/lib/python3.12/test',
)
# pandas' `tests` folders are a test suite that is never imported. numpy's are NOT pruned: `numpy.testing`, which the
# runtime smoke check uses, imports `numpy._core.tests._natype` (found by the smoke check when pruning was tried).
TEST_SUITE_PACKAGES = ('pandas',)


def prune_runtime(staging, specification):
    """Delete pip, bundled test suites and interpreter development content; return the number of folders removed."""
    root = staging.resolve()
    site_packages = staging / specification['site_packages']
    doomed = [site_packages / 'pip', *site_packages.glob('pip-*.dist-info'), *(staging / item for item in UNUSED_INTERPRETER_PATHS)]
    for package in TEST_SUITE_PACKAGES:
        doomed.extend(path for path in sorted((site_packages / package).rglob('tests')) if path.is_dir())
    removed = 0
    for path in doomed:
        if not path.exists() and not path.is_symlink():
            continue   # a folder inside an already removed one, or absent in this layout
        if path.is_symlink() or not path.resolve().is_relative_to(root):
            raise ValueError('Invalid runtime prune path')
        shutil.rmtree(path)
        removed += 1
    return removed


def file_inventory(directory):
    entries = []
    total = 0
    for item in sorted(directory.rglob('*')):
        relative = item.relative_to(directory).as_posix()
        if item.is_symlink():
            if not item.resolve().is_relative_to(directory.resolve()):
                raise ValueError('Runtime symlink escapes resource root')
            entries.append({'path': relative, 'link': os.readlink(item)})
        elif item.is_file():
            size = item.stat().st_size
            total += size
            if total > MAX_EXPANDED:
                raise ValueError('Runtime size limit')
            entries.append({'path': relative, 'size': size, 'sha256': sha256_file(item)})
        if len(entries) > MAX_MEMBERS:
            raise ValueError('Runtime inventory limit')
    return entries


def source_inventory(directory):
    return file_inventory(directory)


def publish_directory(staging, target):
    """Recover the previous complete resource if promotion fails; never merge partial builds."""
    if staging.parent.resolve() != target.parent.resolve() or staging.is_symlink() or target.is_symlink():
        raise ValueError('Invalid runtime publication root')
    backup = target.with_name(f'.previous-{target.name}-{uuid4().hex}')
    had_target = target.exists()
    if had_target:
        os.replace(target, backup)
    try:
        os.replace(staging, target)
    except OSError:
        if had_target:
            os.replace(backup, target)
        raise
    if had_target:
        shutil.rmtree(backup)


def prepare(target, *, offline=False, output=OUTPUT, cache=CACHE):
    lock_bytes = LOCK.read_bytes()
    lock = json.loads(lock_bytes)
    specification = lock['targets'][target]
    archive = download_artifact(specification['archive'], cache, offline=offline)
    wheels = [download_artifact(wheel, cache, offline=offline) for wheel in specification['wheels']]
    source_packages = [download_artifact(source, cache, offline=offline) for source in lock.get('sources', [])]
    sources = ROOT / 'desktop/python/src'
    if not (sources / 'sedcoretool/engine/server.py').is_file():
        raise ValueError('Run desktop/scripts/prepare.js before preparing the runtime')
    output.mkdir(parents=True, exist_ok=True)
    guard = output / f'.{target}.lock'
    descriptor = os.open(guard, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        with tempfile.TemporaryDirectory(prefix=f'.stage-{target}-', dir=output) as temporary:
            staging = Path(temporary) / target
            staging.mkdir()
            extract_runtime(archive, staging)
            install_wheels(specification, wheels, staging)
            install_sources(lock.get('sources', []), source_packages, staging / specification['site_packages'])
            prune_runtime(staging, specification)
            native = target == native_target()
            if native:
                environment = os.environ.copy()
                environment['PATH'] = str(Path(environment.get('SystemRoot', 'C:/Windows')) / 'System32') if sys.platform == 'win32' else '/usr/bin:/bin'
                for variable in ('PYTHONHOME', 'PYTHONPATH', 'LD_LIBRARY_PATH', 'LD_PRELOAD', 'DYLD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES'):
                    environment.pop(variable, None)
                subprocess.run([str(staging / specification['executable']), '-I', '-B', str(ROOT / 'tools/check_engine_runtime.py'),
                                '--source', str(sources), '--lock', str(LOCK)], check=True, timeout=60, env=environment)
            manifest = {'schema': 1, 'target': target, 'python_version': lock['python_version'], 'packages': lock['packages'],
                        'lock_sha256': hashlib.sha256(lock_bytes).hexdigest(), 'application_version': json.loads(
                            (ROOT / 'desktop/package.json').read_text(encoding='utf-8'))['version'],
                        'executable': specification['executable'], 'native_check': native,
                        'sources': source_inventory(sources), 'files': file_inventory(staging)}
            (staging / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
            # Publish from a direct sibling so failure recovery cannot cross a filesystem boundary.
            promoted = output / f'.ready-{target}-{uuid4().hex}'
            os.replace(staging, promoted)
            try:
                publish_directory(promoted, output / target)
            finally:
                if promoted.exists():
                    shutil.rmtree(promoted)
    finally:
        os.close(descriptor)
        guard.unlink()
    print(f'Runtime ready: {target}; native check: {native}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', action='append', choices=list(json.loads(LOCK.read_bytes())['targets']))
    parser.add_argument('--offline', action='store_true', help='Use only already verified cached artifacts')
    args = parser.parse_args()
    for target in args.target or [native_target()]:
        prepare(target, offline=args.offline)


if __name__ == '__main__':
    main()
