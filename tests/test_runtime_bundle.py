"""Runtime artifact integrity, bounded extraction and preservation of a complete prior bundle."""

import hashlib
import importlib.util
import io
import json
import os
import tarfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('prepare_engine_runtime', ROOT / 'tools/prepare_engine_runtime.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def test_lock_pins_complete_minimal_dependency_sets_for_each_supported_architecture():
    lock = json.loads(builder.LOCK.read_bytes())
    assert set(lock['targets']) == {'win32-x64', 'linux-x64', 'darwin-x64', 'darwin-arm64'}
    assert set(lock['packages']) == {'numpy', 'pandas', 'Pillow', 'python-dateutil', 'pytz', 'tzdata', 'six', 'pyvips', 'pyvips-binary', 'cffi'}
    sources = {source['name']: source['version'] for source in lock['sources']}
    assert sources == {'pyvips': lock['packages']['pyvips']}             # pure Python, published only as a source archive
    for target in lock['targets'].values():
        assert {wheel['name']: wheel['version'] for wheel in target['wheels']} | sources == lock['packages']
        for artifact in [target['archive'], *target['wheels'], *lock['sources']]:
            assert len(artifact['sha256']) == 64
            assert 0 < artifact['size'] < 256 * 1024**2
            assert artifact['url'].startswith('https:')


def test_prune_removes_only_unused_content_in_both_layouts(tmp_path):
    for layout, site_packages in (('windows', 'python/Lib/site-packages'), ('posix', 'python/lib/python3.12/site-packages')):
        staging = tmp_path / layout
        keep = [f'{site_packages}/numpy/__init__.py', f'{site_packages}/numpy/testing/__init__.py',
                f'{site_packages}/numpy/_core/tests/_natype.py',   # imported by numpy.testing
                f'{site_packages}/pandas/__init__.py', f'{site_packages}/pandas/_testing/__init__.py',
                f'{site_packages}/PIL/__init__.py', f'{site_packages}/pip-notes.txt',   # not pip itself
                'python/python.exe', 'python/Lib/os.py', 'python/lib/python3.12/os.py']
        drop = [f'{site_packages}/pip/__init__.py', f'{site_packages}/pip-26.3.dist-info/RECORD',
                f'{site_packages}/pandas/tests/test_x.py', f'{site_packages}/pandas/tests/nested/tests/t.py',
                'python/include/Python.h', 'python/tcl/tcl8.6/init.tcl', 'python/Lib/idlelib/idle.py',
                'python/lib/tcl8.6/init.tcl', 'python/lib/python3.12/lib2to3/main.py']
        for relative in [*keep, *drop]:
            path = staging / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('x')
        assert builder.prune_runtime(staging, {'site_packages': site_packages}) > 0
        assert all((staging / relative).exists() for relative in keep)
        assert not any((staging / relative).exists() for relative in drop)
        assert builder.prune_runtime(staging, {'site_packages': site_packages}) == 0   # idempotent


def test_prune_refuses_to_follow_a_link_out_of_the_staging_directory(tmp_path):
    outside = tmp_path / 'outside'
    outside.mkdir()
    (outside / 'precious.txt').write_text('keep')
    staging = tmp_path / 'staging'
    (staging / 'python/Lib/site-packages').mkdir(parents=True)
    try:
        os.symlink(outside, staging / 'python/include', target_is_directory=True)
    except (OSError, NotImplementedError):
        pytest.skip('symbolic links are not available')
    with pytest.raises(ValueError, match='prune'):
        builder.prune_runtime(staging, {'site_packages': 'python/Lib/site-packages'})
    assert (outside / 'precious.txt').read_text() == 'keep'


def test_offline_download_requires_exact_cached_bytes_and_preserves_a_corrupt_cache(tmp_path):
    data = b'public synthetic archive'
    artifact = {'filename': 'public.tar.gz', 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
                'url': 'https://github.com/astral-sh/python-build-standalone/releases/download/test/public.tar.gz'}
    with pytest.raises(ValueError, match='not cached'):
        builder.download_artifact(artifact, tmp_path, offline=True)
    cached = tmp_path / artifact['filename']
    cached.write_bytes(data)
    assert builder.download_artifact(artifact, tmp_path, offline=True) == cached
    cached.write_bytes(b'x' * len(data))
    with pytest.raises(ValueError, match='verification'):
        builder.download_artifact(artifact, tmp_path, offline=True)
    assert cached.read_bytes() == b'x' * len(data)


@pytest.mark.parametrize('name', ['/absolute', '../escape', 'python/../../escape', 'C:/drive', 'python\\escape', 'python//file'])
def test_resource_paths_reject_cross_platform_escapes(name):
    with pytest.raises(ValueError):
        builder.safe_relative(name)


def make_archive(filename, entries):
    with tarfile.open(filename, 'w:gz') as output:
        for name, data, link in entries:
            info = tarfile.TarInfo(name)
            if link is not None:
                info.type, info.linkname = tarfile.SYMTYPE, link
                output.addfile(info)
            else:
                info.size = len(data)
                output.addfile(info, io.BytesIO(data))


@pytest.mark.parametrize('entries', [[('python/../../escape', b'x', None)], [('python/escape', b'', '/outside')],
                                    [('python/a', b'a', None), ('python/a', b'b', None)], [('other/file', b'x', None)]])
def test_unsafe_archives_cannot_escape_the_staging_directory(tmp_path, entries):
    archive = tmp_path / 'runtime.tar.gz'
    make_archive(archive, entries)
    destination = tmp_path / 'staging'
    destination.mkdir()
    with pytest.raises((ValueError, tarfile.FilterError)):
        builder.extract_runtime(archive, destination)
    assert not (tmp_path / 'escape').exists()


def test_valid_archive_preserves_bytes_and_inventory_hashes(tmp_path):
    archive = tmp_path / 'runtime.tar.gz'
    make_archive(archive, [('python/python.exe', b'public fixture', None)])
    destination = tmp_path / 'staging'
    destination.mkdir()
    builder.extract_runtime(archive, destination)
    assert builder.file_inventory(destination) == [{'path': 'python/python.exe', 'size': 14,
                                                    'sha256': hashlib.sha256(b'public fixture').hexdigest()}]


def test_failed_directory_promotion_restores_last_complete_runtime(tmp_path, monkeypatch):
    target, staging = tmp_path / 'win32-x64', tmp_path / '.ready-win32-x64-fixture'
    target.mkdir(); staging.mkdir()
    (target / 'last-good').write_text('old', encoding='utf-8')
    (staging / 'next').write_text('new', encoding='utf-8')
    original = os.replace

    def fail_promotion(source, destination):
        if source == staging:
            raise OSError('injected promotion failure')
        return original(source, destination)

    monkeypatch.setattr(builder.os, 'replace', fail_promotion)
    with pytest.raises(OSError, match='injected'):
        builder.publish_directory(staging, target)
    assert (target / 'last-good').read_text() == 'old'
    assert (staging / 'next').read_text() == 'new'
    assert not list(tmp_path.glob('.previous-*'))


def source_archive(path, entries):
    """A .tar.gz whose entries are (name, bytes) for files, (name, None) for folders, or (name, 'link') for a symbolic link."""
    with tarfile.open(path, 'w:gz') as archive:
        for name, data in entries:
            info = tarfile.TarInfo(name)
            if data is None:
                info.type = tarfile.DIRTYPE
                archive.addfile(info)
            elif data == 'link':
                info.type, info.linkname = tarfile.SYMTYPE, '../../outside'
                archive.addfile(info)
            else:
                info.size = len(data)
                archive.addfile(info, io.BytesIO(data))
    return path


SOURCE = {'name': 'pyvips', 'version': '3.2.0', 'package': 'pyvips'}


def test_source_packages_copy_only_python_files_and_the_licence_with_metadata(tmp_path):
    archive = source_archive(tmp_path / 'pyvips-3.2.0.tar.gz', [
        ('pyvips-3.2.0', None), ('pyvips-3.2.0/LICENSE.txt', b'MIT'), ('pyvips-3.2.0/setup.py', b'raise SystemExit'),
        ('pyvips-3.2.0/pyvips/__init__.py', b'X = 1'), ('pyvips-3.2.0/pyvips/vimage.pyi', b'x: int'),
        ('pyvips-3.2.0/pyvips/pyvips_build.py', b'import cffi'), ('pyvips-3.2.0/pyvips/data.bin', b'\0'),
        ('pyvips-3.2.0/tests/test_image.py', b'assert 0')])
    site = tmp_path / 'site'
    site.mkdir()
    builder.install_sources([SOURCE], [archive], site)
    assert sorted(p.relative_to(site).as_posix() for p in site.rglob('*') if p.is_file()) == [
        'pyvips-3.2.0.dist-info/INSTALLER', 'pyvips-3.2.0.dist-info/LICENSE.txt', 'pyvips-3.2.0.dist-info/METADATA',
        'pyvips-3.2.0.dist-info/top_level.txt', 'pyvips/__init__.py', 'pyvips/vimage.pyi']
    assert (site / 'pyvips-3.2.0.dist-info/METADATA').read_text(encoding='utf-8') == 'Metadata-Version: 2.1\nName: pyvips\nVersion: 3.2.0\n'
    assert (site / 'pyvips-3.2.0.dist-info/LICENSE.txt').read_bytes() == b'MIT'


@pytest.mark.parametrize('entries, message', [
    ([('pyvips-3.2.0/LICENSE.txt', b'MIT'), ('pyvips-3.2.0/pyvips/__init__.py', b''), ('pyvips-3.2.0/pyvips/x.py', 'link')], 'Unsupported archive member'),
    ([('pyvips-3.2.0/LICENSE.txt', b'MIT'), ('pyvips-3.2.0/pyvips/__init__.py', b''), ('other-1.0/pyvips/x.py', b'')], 'Unexpected source archive layout'),
    ([('pyvips-3.2.0/LICENSE.txt', b'MIT'), ('pyvips-3.2.0/pyvips/../../escape.py', b'')], 'Invalid resource path'),
    ([('pyvips-3.2.0/pyvips/__init__.py', b'')], 'Incomplete source package'),
    ([('pyvips-3.2.0/LICENSE.txt', b'MIT')], 'Incomplete source package'),
    ([('pyvips-3.2.0/LICENSE.txt', b'MIT'), ('pyvips-3.2.0/pyvips/__init__.py', b'x' * (16 * 1024**2 + 1))], 'Source archive too large'),
])
def test_source_packages_refuse_unsafe_or_incomplete_archives(tmp_path, entries, message):
    archive = source_archive(tmp_path / 'pyvips-3.2.0.tar.gz', entries)
    site = tmp_path / 'site'
    site.mkdir()
    with pytest.raises(ValueError, match=message):
        builder.install_sources([SOURCE], [archive], site)
    assert not (tmp_path / 'escape.py').exists() and not (tmp_path / 'outside').exists()
