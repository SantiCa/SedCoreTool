"""Native, offline smoke check of a prepared runtime and the existing public analysis API."""

import argparse
import importlib.metadata
import importlib.util
import io
import json
import struct
import sys
from pathlib import Path


def check(source, lock):
    expected = json.loads(lock.read_bytes())
    if '.'.join(map(str, sys.version_info[:3])) != expected['python_version'] or struct.calcsize('P') != 8:
        raise ValueError('Runtime version/architecture mismatch')
    for package, version in expected['packages'].items():
        if importlib.metadata.version(package) != version:
            raise ValueError(f'Runtime dependency mismatch: {package}')
    if any(importlib.util.find_spec(name) is not None for name in ('torch', 'onnxruntime', 'segmentation_models_pytorch')):
        raise ValueError('Optional training dependencies found in the base runtime')
    sys.path.insert(0, str(source.resolve()))
    import numpy as np
    from PIL import Image

    from sedcoretool import analyze_image, analyze_mask
    from sedcoretool.pipeline import bin_edges

    mask = np.zeros((20, 10), dtype=np.uint8)
    mask[:10, :5] = 1
    frame = analyze_mask(mask, 0, 20, bin_px=10).data
    np.testing.assert_array_equal(frame['bioturbation_pct'], [50, 0])
    np.testing.assert_array_equal(frame['BI'], [3, 0])
    np.testing.assert_array_equal(frame['ii'], [4, 1])
    layers = np.zeros((2, 2, 2), dtype=bool)
    layers[0, :, 0] = True
    layers[1, 0, :] = True
    overlap = analyze_mask(layers, 0, 2, bin_px=2, class_names=['a', 'b']).data
    np.testing.assert_array_equal(overlap[['bioturbation_pct', 'a_pct', 'b_pct']], [[75, 50, 50]])
    excluded = analyze_mask(mask, 0, 20, bin_px=10, exclude=mask.astype(bool)).data
    np.testing.assert_array_equal(excluded['bioturbation_pct'], [0, 0])
    root = Path(__file__).resolve().parents[1]
    for case in json.loads((root / 'tests/fixtures/fractional-boundaries.json').read_bytes()):
        section = analyze_mask(np.zeros((case['rows'], 1), dtype=np.uint8), case['top'], case['bottom'],
                               units=case['units'], bin_cm=case['bin_cm'])
        if section.bin_px != case['bin_px'] or bin_edges(case['rows'], section.bin_px) != list(zip(case['edges'], case['edges'][1:])):
            raise ValueError('Fractional boundary regression')
    for extension in ('PNG', 'TIFF'):
        output = io.BytesIO()
        original = np.array([[0, 65535], [256, 32768]], dtype=np.uint16)
        Image.fromarray(original).save(output, format=extension)
        output.seek(0)
        np.testing.assert_array_equal(np.asarray(Image.open(output)), original)
    # libvips (tile store, card M8.4.14): the compiled binding, the pinned version, and exact reads of a TIFF region in 8 and 16 bits.
    import pyvips

    if not pyvips.API_mode or '.'.join(str(pyvips.version(part)) for part in range(3)) != expected['packages']['pyvips-binary']:
        raise ValueError('libvips binding mismatch')
    for original in ((np.arange(48 * 40 * 3) % 251).astype(np.uint8).reshape(48, 40, 3), (np.arange(30 * 20) * 97 % 65536).astype(np.uint16).reshape(30, 20)):
        output = io.BytesIO()
        Image.fromarray(original).save(output, format='TIFF')
        image = pyvips.Image.new_from_buffer(output.getvalue(), '', access='random')
        if image.get('vips-loader') != 'tiffload_buffer':
            raise ValueError('libvips did not use its TIFF loader')
        region = image.crop(3, 5, 11, 7)
        samples = np.frombuffer(region.write_to_memory(), dtype=original.dtype).reshape(7, 11, -1)
        np.testing.assert_array_equal(samples, original[5:12, 3:14].reshape(7, 11, -1))
    # Exercise the public v2.1 reference when run from a source checkout; it is not shipped as user data.
    legacy = root / 'legacy/v2.1_console'
    if (legacy / 'example_output.csv').exists():
        import pandas as pd

        reference = pd.read_csv(legacy / 'example_output.csv')
        result = analyze_image(root / 'examples/data/idealized_core_0-500cm.jpg', 0, 500, bin_px=150).data.iloc[:len(reference)]
        np.testing.assert_allclose(result['depth'], reference['Depth'], atol=1e-9, rtol=0)
        np.testing.assert_allclose(result['bioturbation_pct'], reference['Bioturbation Percentage'], atol=1e-9, rtol=0)
        np.testing.assert_array_equal(result['BI'], reference['BI'])
        np.testing.assert_array_equal(result['ii'], reference['II'])
    # The engine method runs with the bundled interpreter too (reference fixture of the JavaScript calculation).
    fixture = root / 'tests/fixtures/section-intervals/basic-four-intervals.json'
    method_checked = False
    if fixture.exists():
        from sedcoretool.methods import section_intervals

        document = json.loads(fixture.read_bytes())
        dtypes = {'u8': 'u1', 'i32le': '<i4', 'u32le': '<u4'}

        def decode(buffer):
            data = np.repeat([v for v, _ in buffer['runs']], [n for _, n in buffer['runs']]) if 'runs' in buffer else np.asarray(buffer['data'])
            return data.astype(dtypes[buffer['dtype']]).reshape(buffer['shape'])

        raw = document['inputs']
        inputs = {name: raw[name] for name in ('objects', 'classes', 'settings', 'age_model', 'manual_indices')}
        inputs.update({name: decode(raw[name]) for name in ('labels', 'exclude', 'stack_offsets')}, stack_members=None)
        result = section_intervals.run(section_intervals.parse(inputs))
        np.testing.assert_array_equal(result.columns['bio_count'], document['expected']['columns']['bio_count']['data'])
        np.testing.assert_array_equal(result.columns['indices'], np.array(document['expected']['columns']['indices']['data']).reshape(4, 2))
        method_checked = True
    print(json.dumps({'python': expected['python_version'], 'bits': 64, 'packages': expected['packages'],
                      'fractional_fixtures': 20, 'image_roundtrips': ['PNG-u16', 'TIFF-u16'], 'libvips': '.'.join(str(pyvips.version(part)) for part in range(3)),
                      'libvips_regions': ['TIFF-u8-RGB', 'TIFF-u16'], 'scientific_smoke': 'passed',
                      'section_intervals_fixture': 'passed' if method_checked else 'not run (no source checkout)'}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--lock', type=Path, required=True)
    options = parser.parse_args()
    check(options.source, options.lock)
