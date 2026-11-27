"""Input and output descriptions of the engine's scientific methods (standard library only).

The coordinator checks every request against these tables before it admits a job, without importing NumPy or the method;
``tests/test_engine_methods.py`` and ``tests/test_engine_method_run.py`` check that they agree with the method modules.
"""

from typing import NamedTuple

SECTION_INTERVALS = 'section.intervals/1'
CORE_AGES = 'core.ages/1'
CORE_DEPTHS = 'core.depths/1'
CORE_AGE_MODEL = 'core.age_model/1'
CORE_BACON = 'core.bacon/1'

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
    CORE_AGES: {
        'settings': ('utf8json', 1, True),
        'age_model': ('utf8json', 1, True),
        'age_model_values': ('f64le', 2, True),
        'age_model_valid': ('u8', 2, True),
        'query': ('utf8json', 1, True),
        'query_values': ('f64le', 2, True),
        'query_valid': ('u8', 2, True),
    },
    CORE_DEPTHS: {
        'settings': ('utf8json', 1, True),
        'age_model': ('utf8json', 1, True),
        'age_model_values': ('f64le', 2, True),
        'age_model_valid': ('u8', 2, True),
        'query': ('utf8json', 1, True),
        'query_values': ('f64le', 2, True),
        'query_valid': ('u8', 2, True),
    },
    CORE_AGE_MODEL: {
        'settings': ('utf8json', 1, True),
        'text': ('u8', 1, True),                  # the UTF-8 bytes of the age-model text, 1 byte to 4 MiB (contract §9.11)
    },
    CORE_BACON: {
        'settings': ('utf8json', 1, True),
        'table_text': ('u8', 1, True),            # the UTF-8 bytes of the Bacon table, 1 byte to 4 MiB (contract §9.11)
    },
}
SETTINGS_INPUT = 'settings'     # its buffer hash is the request's settings_hash

NUMPY_DTYPES = {'u8': 'u1', 'u16le': '<u2', 'i32le': '<i4', 'u32le': '<u4', 'u64le': '<u8', 'f64le': '<f8'}
CONTRACT_DTYPES = {'|u1': 'u8', '<u2': 'u16le', '<i4': 'i32le', '<u4': 'u32le', '<u8': 'u64le', '<f8': 'f64le'}

# ---- method table of `method.run` (contract §9.6) ------------------------------------------------------------------------

SCOPES = ('section', 'core', 'project')
PRIORITIES = ('interactive', 'batch')     # a waiting interactive job always starts before a waiting batch job (§9.4)
INTERACTIVE_DEADLINE = 120                # seconds, the job deadline of contract §3

# The buffers of one table (contract §4 "Tables"): suffix -> (dtype, rank). A family member `core<k>` of kind `table` brings all three.
TABLE_BUFFERS = {'': ('utf8json', 1), '_values': ('f64le', 2), '_valid': ('u8', 2)}
FAMILY_KINDS = {'table': TABLE_BUFFERS}
MAX_FAMILY_MEMBERS = 128
MAX_REQUEST_INPUTS = 3 * MAX_FAMILY_MEMBERS + 32     # handles one request may name (contract §9.2)

# Output tables use the limits of input tables (contract §4 "Tables", `methods/validation.py`), except that they may have 0 rows.
MAX_TABLE_COLUMNS = 256
MAX_TABLE_ROWS = 1_048_576
MAX_TABLE_DATA_BYTES = 8 * 1_048_576
MAX_TABLE_NAME_BYTES = 256
MAX_TABLE_UNIT_BYTES = 64
MAX_SUMMARY_BYTES = 8 * 1024              # UTF-8 bytes of the compact JSON of a result's summary (contract §9.3)


class Family(NamedTuple):
    """Inputs named ``<prefix><k>`` (k = 0 … K-1 in decimal without leading zeros, K ≤ ``maximum``), each of ``kind``."""
    prefix: str
    kind: str
    maximum: int


class MethodSpec(NamedTuple):
    """One method as the coordinator knows it (contract §9.6). ``inputs`` maps a fixed name to (dtype, rank, required);
    ``same_shape`` lists pairs of inputs whose shapes must be equal (the second one is named when they are not); ``dimensions`` are
    the names of the result's dimensions and ``tables`` the names of its table outputs; ``deadline`` is in seconds."""
    name: str
    scope: str
    inputs: dict
    families: tuple = ()
    priorities: tuple = ('interactive',)
    dimensions: tuple = ()
    tables: tuple = ()
    deadline: float = INTERACTIVE_DEADLINE
    same_shape: tuple = ()


METHOD_SPECS = {
    SECTION_INTERVALS: MethodSpec(SECTION_INTERVALS, 'section', METHOD_INPUTS[SECTION_INTERVALS],
                                  dimensions=('bins', 'classes', 'schemes'), same_shape=(('labels', 'exclude'),)),
    CORE_AGES: MethodSpec(CORE_AGES, 'core', METHOD_INPUTS[CORE_AGES], dimensions=('rows',), tables=('ages',)),
    CORE_DEPTHS: MethodSpec(CORE_DEPTHS, 'core', METHOD_INPUTS[CORE_DEPTHS], dimensions=('rows',), tables=('depths',)),
    CORE_AGE_MODEL: MethodSpec(CORE_AGE_MODEL, 'core', METHOD_INPUTS[CORE_AGE_MODEL], dimensions=('rows',), tables=('model',)),
    CORE_BACON: MethodSpec(CORE_BACON, 'core', METHOD_INPUTS[CORE_BACON], dimensions=('rows',), tables=('rows',)),
}
