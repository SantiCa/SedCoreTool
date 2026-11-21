"""Input and output descriptions of the engine's scientific methods (standard library only).

The coordinator checks the dtype and rank of every input handle against these tables before it admits a job, without
importing NumPy or the method; ``tests/test_engine_methods.py`` checks that they agree with the method modules.
"""

SECTION_INTERVALS = 'section.intervals/1'

# name -> (dtype, rank, required). utf8json buffers are decoded tables; the numeric ones are C-order little-endian arrays.
METHOD_INPUTS = {
    SECTION_INTERVALS: {
        'labels': ('i32le', 2, True),
        'exclude': ('u8', 2, True),
        'objects': ('utf8json', 1, True),
        'classes': ('utf8json', 1, True),
        'stack_offsets': ('u32le', 1, True),
        'stack_members': ('u32le', 1, False),     # omitted when there is no overlap (an empty buffer cannot be transferred)
        'settings': ('utf8json', 1, True),
        'age_model': ('utf8json', 1, True),
        'manual_indices': ('utf8json', 1, True),
    },
}
SETTINGS_INPUT = 'settings'     # its buffer hash is the request's settings_hash

NUMPY_DTYPES = {'u8': 'u1', 'u16le': '<u2', 'i32le': '<i4', 'u32le': '<u4', 'u64le': '<u8', 'f64le': '<f8'}
CONTRACT_DTYPES = {'|u1': 'u8', '<u2': 'u16le', '<i4': 'i32le', '<u4': 'u32le', '<u8': 'u64le', '<f8': 'f64le'}
