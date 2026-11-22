"""Card M8.4.18d: a synthetic stored version of a tiled section whose files take more than 4 GiB, to check a package above 4 GiB through the desktop
program (`tools/check_large_package.mjs`). Written straight into a project's mask store with the engine's own code (`sedcoretool.store.masks`),
so it is a valid version (contract §8.7). Every labels tile is different and hard to compress: each pixel is one of `--objects` object IDs drawn at
random (with 65,535 objects a tile of 1 MiB compresses to about 692 KB at zlib level 1). No exclusion layer and no overlaps.

    py -3.12 tools/make_large_mask_version.py STORE_FOLDER --cols 64 --rows 112 --objects 65535 [--seed 1]

STORE_FOLDER is `<profile>/projects/<project>/tiles`. Prints one JSON line: manifest, width, height, tiles, objects, stored bytes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from sedcoretool.store import masks  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('store', type=Path)
    parser.add_argument('--cols', type=int, default=64)
    parser.add_argument('--rows', type=int, default=112)
    parser.add_argument('--objects', type=int, default=65535)
    parser.add_argument('--seed', type=int, default=1)
    parser.add_argument('--section', default='synthetic')
    args = parser.parse_args()
    if not 1 <= args.objects <= masks.MAX_OBJECTS:
        parser.error('--objects out of range')
    width, height = args.cols * masks.TILE, args.rows * masks.TILE
    store = masks.MaskStore(args.store, masks.BlobCache(0))
    staging = masks.Staging(store, args.section, width, height, None)
    random = np.random.default_rng(args.seed)
    started = time.monotonic()
    for row in range(args.rows):
        for col in range(args.cols):
            labels = random.integers(1, args.objects + 1, size=(masks.TILE, masks.TILE), dtype=np.int32).astype('<i4').tobytes()
            staging.put('labels', row, col, hashlib.sha256(labels).hexdigest(), labels)
        print(f'row {row + 1}/{args.rows}', file=sys.stderr, flush=True)
    n = args.objects
    tables = {'object_ids': np.arange(1, n + 1, dtype='<u4').tobytes(), 'object_class': np.full(n, -1, dtype='<i4').tobytes(),
              'object_predicted': np.full(n, -1, dtype='<i4').tobytes(), 'object_confidence': np.zeros(n, dtype='<f8').tobytes(),
              'classes': json.dumps([{'id': 'undet', 'name': 'Undetermined', 'counts': True}]).encode(),
              'stack_offsets': np.array([0, 0], dtype='<u4').tobytes(), 'stack_members': None}
    manifest = staging.commit(tables)
    stored = sum(path.stat().st_size for path in (args.store / 'blobs').glob('*/*')) + store.manifest_path(manifest).stat().st_size
    print(json.dumps({'manifest': manifest, 'section': args.section, 'width': width, 'height': height, 'tiles': args.rows * args.cols,
                      'objects': n, 'stored_bytes': stored, 'seconds': round(time.monotonic() - started, 1)}))


if __name__ == '__main__':
    main()
