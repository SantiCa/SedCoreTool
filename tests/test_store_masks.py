"""Mask tiles and manifests of tiled sections (card M8.4.16 step 1, contract §8.7): exact round trips, content addressing, immutable versions,
and refusal of damaged or hostile tiles, blobs and manifests."""

import hashlib
import json
import os
import zlib

import numpy as np
import pytest

from sedcoretool.store import masks

W, H = 1300, 1100           # a 3 x 3 grid whose right and bottom tiles are partly outside the section


def layer_tiles(array, layer):
    """The 512 x 512 tiles of a full-resolution mask, zero-padded, as the page will cut them: {(row, col): bytes}."""
    dtype = '<i4' if layer == 'labels' else 'u1'
    rows, cols = masks.grid(array.shape[1], array.shape[0])
    out = {}
    for row in range(rows):
        for col in range(cols):
            tile = np.zeros((512, 512), dtype=dtype)
            part = array[row * 512:(row + 1) * 512, col * 512:(col + 1) * 512]
            tile[:part.shape[0], :part.shape[1]] = part
            out[(row, col)] = tile.tobytes()
    return out


def sample_masks(seed=0):
    rng = np.random.default_rng(seed)
    labels = np.zeros((H, W), dtype='<i4')
    labels[100:400, 50:1250] = rng.integers(-3, 40, size=(300, 1200))     # tiles of row 0 only; row 1 and 2 stay empty
    labels[1050:1100, 1200:1300] = 7                                       # the bottom-right corner tile, up to the section's edge
    exclude = np.zeros((H, W), dtype='u1')
    exclude[600:700, :] = 1
    return labels, exclude


def object_columns(ids, cls, pred, conf):
    return {'object_ids': np.array(ids, dtype='<u4').tobytes(), 'object_class': np.array(cls, dtype='<i4').tobytes(),
            'object_predicted': np.array(pred, dtype='<i4').tobytes(), 'object_confidence': np.array(conf, dtype='<f8').tobytes()}


CLASSES = json.dumps([{'id': 'a', 'name': 'Burrow', 'counts': True}, {'id': 'b', 'name': 'Other', 'counts': False}]).encode()
TABLES = {**object_columns([7, 8], [0, -1], [-1, 1], [0.0, 0.75]), 'classes': CLASSES,
          'stack_offsets': np.array([0, 0, 2], dtype='<u4').tobytes(), 'stack_members': np.array([7, 8], dtype='<u4').tobytes()}


def put_all(staging, labels, exclude):
    stored = {}
    for layer, array in (('labels', labels), ('exclude', exclude)):
        for (row, col), data in layer_tiles(array, layer).items():
            stored[(layer, row, col)] = staging.put(layer, row, col, hashlib.sha256(data).hexdigest(), data)
    return stored


def store(tmp_path):
    return masks.MaskStore(tmp_path / 'projects' / 'p1' / 'tiles')


def committed_version(tmp_path, seed=0):
    labels, exclude = sample_masks(seed)
    target = store(tmp_path)
    staging = masks.Staging(target, 's1', W, H, None)
    stored = put_all(staging, labels, exclude)
    return target, staging.commit(TABLES), labels, exclude, stored


def read_back(target, manifest, layer):
    """The full-resolution mask of a stored version, rebuilt from its tiles."""
    value, _ = target.read_manifest(manifest)
    rows, cols = masks.grid(value['width'], value['height'])
    dtype = '<i4' if layer == 'labels' else 'u1'
    full = np.zeros((rows * 512, cols * 512), dtype=dtype)
    for row in range(rows):
        for col in range(cols):
            data = target.read_tile(manifest, layer, row, col)
            if data is not None:
                full[row * 512:(row + 1) * 512, col * 512:(col + 1) * 512] = np.frombuffer(data, dtype=dtype).reshape(512, 512)
    return full[:value['height'], :value['width']]


def test_a_version_reads_back_exactly_and_empty_tiles_are_not_stored(tmp_path):
    target, manifest, labels, exclude, stored = committed_version(tmp_path)
    assert np.array_equal(read_back(target, manifest, 'labels'), labels)
    assert np.array_equal(read_back(target, manifest, 'exclude'), exclude)
    value, tiles = target.read_manifest(manifest)
    assert sorted(tiles) == [(0, 0), (0, 1), (0, 2), (1, 0), (1, 1), (1, 2), (2, 2)]
    assert tiles[(2, 2)] == {'labels': tiles[(2, 2)]['labels'], 'exclude': None} and tiles[(0, 0)]['exclude'] is None
    assert stored[('labels', 2, 0)] is False and stored[('exclude', 1, 0)] is True
    assert value['tables']['stack_members'] == {'sha256': hashlib.sha256(TABLES['stack_members']).hexdigest(), 'byte_length': 8}
    for name, data in TABLES.items():                                      # tables are blobs of their exact bytes
        entry = value['tables'][name]
        assert target.read_blob(entry['sha256'], entry['byte_length'], 'table') == data


def test_the_manifest_is_canonical_json_named_by_its_hash_and_blobs_are_compressed(tmp_path):
    target, manifest, _, _, _ = committed_version(tmp_path)
    data = target.manifest_path(manifest).read_bytes()
    assert hashlib.sha256(data).hexdigest() == manifest
    assert data == json.dumps(json.loads(data), sort_keys=True, separators=(',', ':')).encode()
    value = json.loads(data)
    assert (value['format'], value['version'], value['tile'], value['section'], value['width'], value['height']) == ('sedcoretool.masks', 2, 512, 's1', W, H)
    sha = value['tiles']['0.0']['labels']
    blob = target.blob_path(sha)
    assert blob.parent.name == sha[:2] and len(zlib.decompress(blob.read_bytes())) == masks.LAYER_BYTES['labels']
    assert blob.stat().st_size < masks.LAYER_BYTES['labels']
    assert not list(target.folder.rglob('*.tmp'))


def test_the_same_content_gives_the_same_version_and_a_new_version_leaves_the_base_unchanged(tmp_path):
    target, first, labels, exclude, _ = committed_version(tmp_path)
    again = masks.Staging(target, 's1', W, H, None)
    put_all(again, labels, exclude)
    assert again.commit(TABLES) == first
    edit = masks.Staging(target, 's1', W, H, first)
    changed = labels.copy()
    changed[1000:1010, 0:10] = 99                                          # one tile of row 1 that was empty
    data = layer_tiles(changed, 'labels')[(1, 0)]
    assert edit.put('labels', 1, 0, hashlib.sha256(data).hexdigest(), data) is True
    erased = bytes(masks.LAYER_BYTES['exclude'])
    assert edit.put('exclude', 1, 1, hashlib.sha256(erased).hexdigest(), erased) is False   # erasing a layer removes its entry
    second = edit.commit({})                                               # no table given: the base's tables are kept
    assert second != first
    changed_exclude = exclude.copy()
    changed_exclude[600:700, 512:1024] = 0
    assert np.array_equal(read_back(target, second, 'labels'), changed)
    assert np.array_equal(read_back(target, second, 'exclude'), changed_exclude)
    assert np.array_equal(read_back(target, first, 'labels'), labels) and np.array_equal(read_back(target, first, 'exclude'), exclude)
    assert target.read_manifest(second)[0]['tables'] == target.read_manifest(first)[0]['tables']


def test_tables_kept_replaced_or_required(tmp_path):
    target, base, _, _, _ = committed_version(tmp_path)
    staging = masks.Staging(target, 's1', W, H, base)
    no_overlap = np.array([0, 0], dtype='<u4').tobytes()
    version = staging.commit({'stack_offsets': no_overlap, 'stack_members': None})
    tables = target.read_manifest(version)[0]['tables']
    assert tables['stack_members'] is None and tables['stack_offsets']['byte_length'] == 8
    assert tables['object_ids'] == target.read_manifest(base)[0]['tables']['object_ids']
    fresh = masks.Staging(target, 's2', W, H, None)
    with pytest.raises(masks.MaskError) as error:
        fresh.commit({name: TABLES[name] for name in (*masks.OBJECT_COLUMNS, 'classes')})
    assert (error.value.code, error.value.field) == ('INVALID_REQUEST', 'tables.stack_offsets')
    for bad, code in (({'classes': None}, 'INVALID_REQUEST'), ({'stack_offsets': b'\0' * 6}, 'INVALID_BUFFER'),
                      ({'classes': b' ' * (masks.MAX_METADATA_BYTES + 1)}, 'LIMIT_EXCEEDED'), ({'other': b'[]'}, 'INVALID_REQUEST'),
                      ({'object_ids': TABLES['object_ids']}, 'INVALID_REQUEST')):          # the object columns and classes go together
        with pytest.raises(masks.MaskError) as error:
            masks.Staging(target, 's1', W, H, base).commit(bad)
        assert error.value.code == code


def test_a_section_without_objects_stores_null_columns(tmp_path):
    target = store(tmp_path)
    staging = masks.Staging(target, 's1', W, H, None)
    version = staging.commit({**{name: None for name in masks.OBJECT_COLUMNS}, 'classes': CLASSES,
                              'stack_offsets': np.array([0, 0], dtype='<u4').tobytes()})
    tables = target.read_manifest(version)[0]['tables']
    assert all(tables[name] is None for name in masks.OBJECT_COLUMNS)


def test_the_object_columns_round_trip_exactly_up_to_two_to_the_twentieth_objects(tmp_path):
    n = masks.MAX_OBJECTS
    ids = np.arange(1, n + 1, dtype='<u4')[::-1].copy()                     # any order; it is kept
    columns = object_columns(ids, np.where(ids % 3 == 0, 1, -1), np.zeros(n, dtype='<i4'), np.linspace(0, 1, n))
    target = store(tmp_path)
    version = masks.Staging(target, 's1', W, H, None).commit({**columns, 'classes': CLASSES, 'stack_offsets': np.zeros(2, dtype='<u4').tobytes()})
    tables = target.read_manifest(version)[0]['tables']
    for name, data in columns.items():
        assert tables[name]['byte_length'] == len(data) and target.read_blob(tables[name]['sha256'], len(data), 'table') == data
    over = object_columns(np.arange(1, n + 2), np.zeros(n + 1), np.zeros(n + 1), np.zeros(n + 1))
    with pytest.raises(masks.MaskError) as error:
        masks.Staging(target, 's1', W, H, None).commit({**over, 'classes': CLASSES, 'stack_offsets': np.zeros(2, dtype='<u4').tobytes()})
    assert (error.value.code, error.value.field) == ('LIMIT_EXCEEDED', 'tables.object_ids')


@pytest.mark.parametrize('columns, field', [
    (object_columns([7, 8], [0], [-1, -1], [0, 0]), 'tables.object_class'),                    # wrong length
    (object_columns([7, 7], [0, 0], [-1, -1], [0, 0]), 'tables.object_ids'),                   # duplicate id
    (object_columns([0, 8], [0, 0], [-1, -1], [0, 0]), 'tables.object_ids'),                   # zero is the matrix, not an object
    (object_columns([7, 2**31], [0, 0], [-1, -1], [0, 0]), 'tables.object_ids'),               # not a positive i32 label
    (object_columns([7, 8], [0, 2], [-1, -1], [0, 0]), 'tables.object_class'),                 # unknown class index (two classes)
    (object_columns([7, 8], [0, 0], [-1, -2], [0, 0]), 'tables.object_predicted'),
    (object_columns([7, 8], [0, 0], [-1, -1], [0, 1.5]), 'tables.object_confidence'),
    (object_columns([7, 8], [0, 0], [-1, -1], [0, float('nan')]), 'tables.object_confidence'),
], ids=['length', 'duplicate', 'zero', 'too-large-id', 'class-index', 'predicted-index', 'confidence-range', 'confidence-nan'])
def test_hostile_object_columns_are_refused_before_anything_is_written(tmp_path, columns, field):
    target, base, _, _, _ = committed_version(tmp_path)
    blobs = sorted(path.name for path in (target.folder / 'blobs').rglob('*'))
    with pytest.raises(masks.MaskError) as error:
        masks.Staging(target, 's1', W, H, base).commit({**columns, 'classes': CLASSES})
    assert (error.value.code, error.value.field) == ('INVALID_BUFFER', field)
    assert sorted(path.name for path in (target.folder / 'blobs').rglob('*')) == blobs


def test_a_version_1_manifest_is_refused_with_its_own_code(tmp_path):
    target, base, _, _, _ = committed_version(tmp_path)
    old = valid_manifest(target, base)
    old['version'] = 1
    name = write_manifest_file(target, canonical(old))
    with pytest.raises(masks.MaskError) as error:
        target.read_manifest(name)
    assert (error.value.code, error.value.field) == ('UNSUPPORTED_INPUT', 'manifest.version')


def tile_with(layer, setter):
    tile = np.zeros((512, 512), dtype='<i4' if layer == 'labels' else 'u1')
    setter(tile)
    data = tile.tobytes()
    return data, hashlib.sha256(data).hexdigest()


@pytest.mark.parametrize('layer,row,col,setter', [
    ('labels', 0, 2, lambda t: t.__setitem__((5, 1300 - 1024), 3)),       # right edge: column 276 of the last tile column is outside
    ('labels', 2, 0, lambda t: t.__setitem__((1100 - 1024, 5), 3)),       # bottom edge: row 76 of the last tile row is outside
    ('exclude', 0, 0, lambda t: t.__setitem__((5, 5), 2)),                # exclusion is 0 or 1
], ids=['right-margin', 'bottom-margin', 'exclusion-value'])
def test_a_tile_with_samples_outside_the_section_or_bad_values_is_refused(tmp_path, layer, row, col, setter):
    staging = masks.Staging(store(tmp_path), 's1', W, H, None)
    data, sha = tile_with(layer, setter)
    with pytest.raises(masks.MaskError) as error:
        staging.put(layer, row, col, sha, data)
    assert (error.value.code, error.value.field) == ('INVALID_BUFFER', 'tile') and staging.tiles == {}
    assert not (staging.store.folder / 'blobs').exists()


def test_a_tile_of_the_wrong_length_hash_layer_or_position_is_refused(tmp_path):
    staging = masks.Staging(store(tmp_path), 's1', W, H, None)
    data, sha = tile_with('labels', lambda t: t.__setitem__((0, 0), 1))
    for arguments, expected in ((('labels', 0, 0, sha, data[:-4]), ('INVALID_BUFFER', 'tile')),
                                (('labels', 0, 0, '0' * 64, data), ('INVALID_BUFFER', 'tile')),
                                (('exclude', 0, 0, sha, data), ('INVALID_BUFFER', 'tile')),
                                (('other', 0, 0, sha, data), ('INVALID_REQUEST', 'layer')),
                                (('labels', 3, 0, sha, data), ('INVALID_REQUEST', 'row')),
                                (('labels', 0, -1, sha, data), ('INVALID_REQUEST', 'col')),
                                (('labels', True, 0, sha, data), ('INVALID_REQUEST', 'row')),
                                (('labels', 0, 0, sha.upper(), data), ('INVALID_REQUEST', 'sha256'))):
        with pytest.raises(masks.MaskError) as error:
            staging.put(*arguments)
        assert (error.value.code, error.value.field) == expected
    assert staging.tiles == {}


def test_identifiers_and_sizes_are_checked():
    assert masks.valid_project('k3x9a2b') and masks.valid_project('a_b-1')
    for project in ('', 'Abc', '../x', 'a/b', 'a.b', 'con', 'lpt1', 'x' * 65, 7, None):
        assert not masks.valid_project(project)
    for section in ('', 'a/b', 'a b', '..', 'x' * 65):
        assert not masks.valid_section(section)
    assert masks.grid(8192, 349_526) == (683, 16)
    for width, height, field in ((0, 10, 'width'), (262_145, 10, 'width'), (10, 16_777_217, 'height'), (True, 10, 'width')):
        with pytest.raises(masks.MaskError) as error:
            masks.grid(width, height)
        assert error.value.field == field
    with pytest.raises(masks.MaskError) as error:
        masks.grid(262_144, 16_777_216)
    assert (error.value.code, error.value.field) == ('LIMIT_EXCEEDED', 'section.size')


def test_a_base_must_be_a_version_of_the_same_section_and_size(tmp_path):
    target, base, _, _, _ = committed_version(tmp_path)
    for section, width, height in (('s2', W, H), ('s1', W + 1, H), ('s1', W, H - 1)):
        with pytest.raises(masks.MaskError) as error:
            masks.Staging(target, section, width, height, base)
        assert (error.value.code, error.value.field) == ('INVALID_REQUEST', 'base')
    with pytest.raises(masks.MaskError) as error:
        masks.Staging(target, 's1', W, H, 'f' * 64)
    assert (error.value.code, error.value.field) == ('INVALID_REQUEST', 'manifest')


def write_manifest_file(target, data: bytes) -> str:
    name = hashlib.sha256(data).hexdigest()
    target.manifest_path(name).parent.mkdir(parents=True, exist_ok=True)
    target.manifest_path(name).write_bytes(data)
    return name


def valid_manifest(target, base):
    return json.loads(target.manifest_path(base).read_bytes())


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


@pytest.mark.parametrize('mutate', [
    lambda m: canonical(m).replace(b',', b', ', 1),                                       # not canonical
    lambda m: canonical(m)[:-1] + b',"tile":512}',                                        # duplicate key
    lambda m: canonical({**m, 'extra': 1}),
    lambda m: canonical({**m, 'version': 3}),
    lambda m: canonical({**m, 'width': 262_145}),
    lambda m: canonical({**m, 'section': '../x'}),
    lambda m: canonical({**m, 'tiles': {**m['tiles'], '3.0': m['tiles']['0.0']}}),        # outside the grid
    lambda m: canonical({**m, 'tiles': {**m['tiles'], '01.0': m['tiles']['0.0']}}),       # leading zero
    lambda m: canonical({**m, 'tiles': {**m['tiles'], '2.0': {'labels': None, 'exclude': None}}}),
    lambda m: canonical({**m, 'tiles': {**m['tiles'], '2.0': {'labels': '../../x', 'exclude': None}}}),
    lambda m: canonical({**m, 'tables': {**m['tables'], 'classes': None}}),
    lambda m: canonical({**m, 'tables': {**m['tables'], 'object_class': None}}),                 # the object columns are null together
    lambda m: canonical({**m, 'tables': {**m['tables'], 'object_confidence': {**m['tables']['object_confidence'], 'byte_length': 8}}}),
    lambda m: canonical({**m, 'tables': {**m['tables'], 'stack_offsets': {**m['tables']['stack_offsets'], 'byte_length': 6}}}),
    lambda m: canonical({**m, 'tables': {**m['tables'], 'object_ids': {**m['tables']['object_ids'], 'byte_length': True}}}),
    lambda m: canonical(m).replace(b'"height":1100', b'"height":NaN'),
    lambda m: b'[' * 100_000,
], ids=['not-canonical', 'duplicate-key', 'extra-member', 'other-version', 'too-wide', 'section-path', 'outside-grid', 'leading-zero',
        'empty-entry', 'hash-as-path', 'missing-table', 'one-null-column', 'unequal-columns', 'offsets-length', 'boolean-length', 'nan', 'deep-nesting'])
def test_a_hostile_manifest_is_refused(tmp_path, mutate):
    target, base, _, _, _ = committed_version(tmp_path)
    name = write_manifest_file(target, mutate(valid_manifest(target, base)))
    with pytest.raises(masks.MaskError) as error:
        target.read_manifest(name)
    assert (error.value.code, error.value.field) == ('INVALID_BUFFER', 'manifest')


def test_a_manifest_that_does_not_match_its_name_is_refused(tmp_path):
    target, base, _, _, _ = committed_version(tmp_path)
    path = target.manifest_path(base)
    path.write_bytes(path.read_bytes().replace(b'"height":1100', b'"height":1101'))
    fresh = masks.MaskStore(target.folder)                                 # nothing remembered from the first read
    with pytest.raises(masks.MaskError) as error:
        fresh.read_manifest(base)
    assert error.value.code == 'INVALID_BUFFER'


def test_a_damaged_blob_is_never_served_and_is_repaired_by_the_next_write_of_the_same_tile(tmp_path):
    target, manifest, labels, _, _ = committed_version(tmp_path)
    sha = target.read_manifest(manifest)[0]['tiles']['0.0']['labels']
    path = target.blob_path(sha)
    good = path.read_bytes()
    damaged = zlib.compress(bytes(masks.LAYER_BYTES['labels']), 1)        # a valid zlib stream of other bytes
    for content in (damaged, good[:-10], b'not zlib', zlib.compress(bytes(masks.LAYER_BYTES['labels'] + 1)),
                    b'\0' * (masks.LAYER_BYTES['labels'] * 2)):
        path.write_bytes(content)
        fresh = masks.MaskStore(target.folder)
        with pytest.raises(masks.MaskError) as error:
            fresh.read_tile(manifest, 'labels', 0, 0)
        assert (error.value.code, error.value.field) == ('INVALID_BUFFER', 'tile')
    data = layer_tiles(labels, 'labels')[(0, 0)]
    masks.Staging(fresh, 's1', W, H, manifest).put('labels', 0, 0, sha, data)
    assert masks.MaskStore(target.folder).read_tile(manifest, 'labels', 0, 0) == data


def test_a_failed_manifest_write_leaves_every_earlier_version_readable(tmp_path, monkeypatch):
    target, base, labels, _, _ = committed_version(tmp_path)
    staging = masks.Staging(target, 's1', W, H, base)
    data, sha = tile_with('labels', lambda t: t.__setitem__((0, 0), 5))
    staging.put('labels', 1, 1, sha, data)
    real_replace = os.replace

    def failing_replace(source, destination):
        if str(destination).endswith('.json'):
            raise OSError('disk gone')
        return real_replace(source, destination)
    monkeypatch.setattr(masks.os, 'replace', failing_replace)
    with pytest.raises(OSError):
        staging.commit({})
    monkeypatch.setattr(masks.os, 'replace', real_replace)
    assert [path.name for path in (target.folder / 'manifests').iterdir()] == [f'{base}.json']     # no partial or temporary file
    assert np.array_equal(read_back(masks.MaskStore(target.folder), base, 'labels'), labels)


def test_a_full_disk_is_a_limit(tmp_path, monkeypatch):
    staging = masks.Staging(store(tmp_path), 's1', W, H, None)

    def full(*_arguments):
        raise OSError(28, 'No space left on device')
    monkeypatch.setattr(masks, '_write_durably', full)
    data, sha = tile_with('labels', lambda t: t.__setitem__((0, 0), 5))
    with pytest.raises(masks.MaskError) as error:
        staging.put('labels', 0, 0, sha, data)
    assert (error.value.code, error.value.field) == ('LIMIT_EXCEEDED', 'disk') and staging.tiles == {}


class WinError(OSError):
    """An OSError as Python raises it on Windows, with its Windows error number (``winerror``) on every platform."""

    def __init__(self, winerror, code):
        super().__init__(code, os.strerror(code))
        self.windows_code = winerror

    @property
    def winerror(self):
        return self.windows_code


def test_a_rename_held_for_a_moment_by_another_program_is_tried_again(tmp_path, monkeypatch):
    """Card M8.4.40: on Windows an antivirus or the indexer can hold a file just written; the rename is tried again a few times."""
    monkeypatch.setattr(masks, 'REPLACE_RETRY_SECONDS', (0, 0, 0, 0, 0))
    target = store(tmp_path)
    real_replace, calls = os.replace, []

    def held_twice(source, destination):
        calls.append(destination)
        if len(calls) <= 2:
            raise WinError(32 if len(calls) == 1 else 5, 13)      # ERROR_SHARING_VIOLATION, then ERROR_ACCESS_DENIED
        return real_replace(source, destination)
    monkeypatch.setattr(masks.os, 'replace', held_twice)
    data, sha = tile_with('labels', lambda t: t.__setitem__((0, 0), 5))
    target.write_blob(data, sha, 'tile')
    assert len(calls) == 3
    assert masks.MaskStore(target.folder).read_blob(sha, len(data), 'tile') == data
    assert not list(target.folder.rglob('*.tmp'))


def test_a_rename_is_tried_again_only_for_a_transient_lock_and_then_fails_cleanly(tmp_path, monkeypatch):
    monkeypatch.setattr(masks, 'REPLACE_RETRY_SECONDS', (0, 0, 0, 0, 0))
    target = store(tmp_path)
    data, sha = tile_with('labels', lambda t: t.__setitem__((0, 0), 5))
    for error, attempts in ((WinError(32, 13), 6), (WinError(3, 2), 1), (OSError(5, 'Input/output error'), 1)):
        calls = []

        def failing(source, destination, error=error, calls=calls):
            calls.append(destination)
            raise error
        monkeypatch.setattr(masks.os, 'replace', failing)
        with pytest.raises(OSError) as raised:
            target.write_blob(data, sha, 'tile')
        assert raised.value is error and len(calls) == attempts       # the last error, after 5 more tries only for a sharing violation
        assert not list(target.folder.rglob('*.tmp')), 'the temporary file is removed'


@pytest.mark.parametrize('winerror', [39, 112])
def test_a_full_windows_disk_is_a_limit_whatever_errno_python_derives(winerror):
    def full(*_arguments):
        raise WinError(winerror, 22)                              # EINVAL: what errno says is not used
    with pytest.raises(masks.MaskError) as error:
        masks.write_or_disk_error(full)
    assert (error.value.code, error.value.field) == ('LIMIT_EXCEEDED', 'disk')
    with pytest.raises(OSError):
        masks.write_or_disk_error(lambda: (_ for _ in ()).throw(WinError(5, 13)))


def test_slice_rows_reuses_tile_blobs_filters_objects_and_stacks_and_preserves_masks(tmp_path, monkeypatch):
    """Card M8.4.43: slicing a stored version by tile rows reuses every tile blob without re-encoding, filters objects and stacks to those present,
    keeps stack indices intact, and leaves the source version untouched."""
    target = store(tmp_path)
    width, height = 700, 1700                                     # 4 tile rows (0..3), 2 tile cols; bottom row has 164 rows inside
    labels = np.zeros((height, width), dtype='<i4')
    exclude = np.zeros((height, width), dtype='u1')
    labels[20:120, 10:150] = 1                                    # top half only
    labels[300:700, 50:120] = 2                                   # crosses cut between row 0 and row 1 (y = 512)
    labels[600:900, 200:350] = -1                                 # stack 1 = [2, 3], in row 1 (top half [0, 2))
    labels[1200:1500, 500:680] = -2                               # stack 2 = [4, 5], in row 2 (bottom half [2, 4))
    labels[1600:1700, 10:60] = 6                                  # bottom row (partial tile)
    exclude[100:200, 600:700] = 1
    exclude[1100:1400, 0:400] = 1
    tables = {**object_columns([1, 2, 3, 4, 5, 6, 9], [0, 1, 0, 1, -1, 0, 1], [-1, 0, 1, -1, 0, 1, 0], [0.0, 0.2, 0.4, 0.6, 0.8, 0.9, 1.0]),
              'classes': CLASSES,
              'stack_offsets': np.array([0, 0, 2, 4], dtype='<u4').tobytes(),
              'stack_members': np.array([2, 3, 4, 5], dtype='<u4').tobytes()}
    staging = masks.Staging(target, 'orig', width, height, None)
    put_all(staging, labels, exclude)
    source_manifest = staging.commit(tables)
    source_meta, source_tiles = target.read_manifest(source_manifest)

    written_blobs = []
    real_write_blob = target.write_blob

    def spy_write(data, sha256, field):
        written_blobs.append((sha256, field))
        return real_write_blob(data, sha256, field)
    monkeypatch.setattr(target, 'write_blob', spy_write)

    top_res, top_bin = target.slice_rows(source_manifest, 'part1', 0, 2)
    bot_res, bot_bin = target.slice_rows(source_manifest, 'part2', 2, 4)

    assert all(field != 'tile' for _, field in written_blobs), 'tile blobs are reused directly, never rewritten'
    assert (top_res['width'], top_res['height']) == (width, 1024)
    assert (bot_res['width'], bot_res['height']) == (width, height - 1024)
    assert top_res['sha256'] == hashlib.sha256(top_bin).hexdigest()
    assert bot_res['sha256'] == hashlib.sha256(bot_bin).hexdigest()

    top_ids = np.frombuffer(top_bin[:top_res['object_count'] * 4], dtype='<u4').tolist()
    top_stacks = np.frombuffer(top_bin[top_res['object_count'] * 4:], dtype='<u4').tolist()
    bot_ids = np.frombuffer(bot_bin[:bot_res['object_count'] * 4], dtype='<u4').tolist()
    bot_stacks = np.frombuffer(bot_bin[bot_res['object_count'] * 4:], dtype='<u4').tolist()
    assert top_ids == [1, 2, 3] and top_stacks == [1]
    assert bot_ids == [4, 5, 6] and bot_stacks == [2]

    top_meta, top_tiles = target.read_manifest(top_res['manifest'])
    bot_meta, bot_tiles = target.read_manifest(bot_res['manifest'])
    assert top_meta['tables']['classes'] == source_meta['tables']['classes']
    assert bot_meta['tables']['classes'] == source_meta['tables']['classes']
    for (row, col), entry in source_tiles.items():
        if row < 2:
            assert top_tiles[(row, col)] == entry
        else:
            assert bot_tiles[(row - 2, col)] == entry

    # Stack 2 in the bottom half keeps index 2 with an empty slot at index 1 so tile blobs need no re-encoding.
    bot_off = np.frombuffer(target.read_blob(bot_meta['tables']['stack_offsets']['sha256'], bot_meta['tables']['stack_offsets']['byte_length'], 'tables.stack_offsets'), dtype='<u4').tolist()
    bot_mem = np.frombuffer(target.read_blob(bot_meta['tables']['stack_members']['sha256'], bot_meta['tables']['stack_members']['byte_length'], 'tables.stack_members'), dtype='<u4').tolist()
    assert bot_off == [0, 0, 0, 2] and bot_mem == [4, 5]

    # Object metadata matches the original for every kept object.
    top_cls = np.frombuffer(target.read_blob(top_meta['tables']['object_class']['sha256'], top_meta['tables']['object_class']['byte_length'], 'tables.object_class'), dtype='<i4').tolist()
    top_conf = np.frombuffer(target.read_blob(top_meta['tables']['object_confidence']['sha256'], top_meta['tables']['object_confidence']['byte_length'], 'tables.object_confidence'), dtype='<f8').tolist()
    assert top_cls == [0, 1, 0] and top_conf == [0.0, 0.2, 0.4]

    # Reassembling the two parts reproduces the original masks pixel for pixel.
    fresh = masks.MaskStore(target.folder)
    assert np.array_equal(np.vstack([read_back(fresh, top_res['manifest'], 'labels'), read_back(fresh, bot_res['manifest'], 'labels')]), labels)
    assert np.array_equal(np.vstack([read_back(fresh, top_res['manifest'], 'exclude'), read_back(fresh, bot_res['manifest'], 'exclude')]), exclude)
    assert np.array_equal(read_back(fresh, source_manifest, 'labels'), labels), 'original manifest untouched'

    # Empty slice (no objects or stacks in row 3 if we slice an empty-labels row): all four object columns are None and stack_members is None.
    empty_staging = masks.Staging(target, 'empty', 512, 1024, None)
    ex_tile, ex_sha = tile_with('exclude', lambda t: t.__setitem__((10, 10), 1))
    empty_staging.put('exclude', 1, 0, ex_sha, ex_tile)
    empty_src = empty_staging.commit({**object_columns([1], [0], [-1], [0.5]), 'classes': CLASSES,
                                      'stack_offsets': np.array([0, 0], dtype='<u4').tobytes(), 'stack_members': None})
    empty_res, empty_bin = target.slice_rows(empty_src, 'empty_p2', 1, 2)
    assert empty_res['object_count'] == 0 and empty_res['stack_count'] == 0 and empty_bin == b''
    empty_meta, _ = target.read_manifest(empty_res['manifest'])
    assert all(empty_meta['tables'][name] is None for name in masks.OBJECT_COLUMNS) and empty_meta['tables']['stack_members'] is None


def test_slice_rows_refuses_damaged_blobs_bad_ranges_and_disk_full(tmp_path, monkeypatch):
    """Card M8.4.43: a damaged tile or table blob is refused with INVALID_BUFFER; bad bounds with INVALID_REQUEST; disk full leaves the original intact."""
    target, manifest, labels, _, _ = committed_version(tmp_path)
    meta, tiles = target.read_manifest(manifest)

    # Validation errors
    for bad in (('bad/sec', 0, 1, 'section'), ('p1', -1, 1, 'rows'), ('p1', 1, 1, 'rows'), ('p1', 2, 1, 'rows'), ('p1', 0, 4, 'rows'), ('p1', True, 2, 'rows')):
        with pytest.raises(masks.MaskError) as error:
            target.slice_rows(manifest, bad[0], bad[1], bad[2])
        assert (error.value.code, error.value.field) == ('INVALID_REQUEST', bad[3])

    # Damaged tile blob inside the sliced range is refused
    tile_sha = tiles[(0, 0)]['labels']
    tile_path = target.blob_path(tile_sha)
    good_tile = tile_path.read_bytes()
    tile_path.write_bytes(zlib.compress(bytes(masks.LAYER_BYTES['labels']), 1))
    fresh = masks.MaskStore(target.folder)
    with pytest.raises(masks.MaskError) as error:
        fresh.slice_rows(manifest, 'p1', 0, 1)
    assert (error.value.code, error.value.field) == ('INVALID_BUFFER', 'tile')
    tile_path.write_bytes(good_tile)

    # Damaged exclude blob inside the sliced range is refused
    ex_sha = tiles[(1, 0)]['exclude']
    ex_path = target.blob_path(ex_sha)
    good_ex = ex_path.read_bytes()
    ex_path.write_bytes(b'corrupt')
    fresh = masks.MaskStore(target.folder)
    with pytest.raises(masks.MaskError) as error:
        fresh.slice_rows(manifest, 'p2', 1, 2)
    assert (error.value.code, error.value.field) == ('INVALID_BUFFER', 'tile')
    ex_path.write_bytes(good_ex)

    # Damaged table blob is refused
    cls_sha = meta['tables']['classes']['sha256']
    cls_path = target.blob_path(cls_sha)
    good_cls = cls_path.read_bytes()
    cls_path.write_bytes(b'corrupt')
    fresh = masks.MaskStore(target.folder)
    with pytest.raises(masks.MaskError) as error:
        fresh.slice_rows(manifest, 'p1', 0, 1)
    assert (error.value.code, error.value.field) == ('INVALID_BUFFER', 'tables.classes')
    cls_path.write_bytes(good_cls)

    # Disk full during write leaves only the original manifest on disk and readable
    def full(*_args):
        raise OSError(28, 'No space left on device')
    monkeypatch.setattr(masks, '_write_durably', full)
    with pytest.raises(masks.MaskError) as error:
        masks.MaskStore(target.folder).slice_rows(manifest, 'p3', 2, 3)
    assert (error.value.code, error.value.field) == ('LIMIT_EXCEEDED', 'disk')
    assert [p.name for p in (target.folder / 'manifests').iterdir()] == [f'{manifest}.json']
    assert np.array_equal(read_back(masks.MaskStore(target.folder), manifest, 'labels'), labels)
