"""Card M8.5.8e: `kernels/jstext.py`, the port of ECMAScript `StringToNumber`, `trim`, `split` and `toPrecision(8)`, against the
conversions node recorded in `tests/fixtures/age_model/js-numbers.json` (contract §9.11).

Tolerance, stated before any comparison: there is none. Every number is compared as a float64 bit pattern (NaN with NaN, -0 apart
from +0), and the decimal that `toPrecision(8)` writes is compared exactly with the string node wrote.
"""

import json
import math
import random
import re
import time
from decimal import Decimal
from pathlib import Path

import numpy as np
import pytest

from sedcoretool.kernels import jstext

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "age_model" / "js-numbers.json"
SPECIAL = {"NaN": math.nan, "Infinity": math.inf, "-Infinity": -math.inf}


def number(value):
    """A number position of the fixture: the strings NaN, Infinity and -Infinity are those values; JSON integers are doubles."""
    return SPECIAL[value] if isinstance(value, str) else float(value)


def same_bits(a, b):
    return (math.isnan(a) and math.isnan(b)) or np.float64(a).view("<u8") == np.float64(b).view("<u8")


@pytest.fixture(scope="module")
def table():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_the_fixture_has_the_recorded_conversions(table):
    assert table["format"] == "js-numbers-fixture/1" and len(table["number"]) == 289 and len(table["to_precision_8"]) == 925


def test_string_to_number_equals_every_recorded_number_conversion_bit_for_bit(table):
    wrong = [(text, jstext.string_to_number(text), want) for text, want in table["number"]
             if not same_bits(jstext.string_to_number(text), number(want))]
    assert wrong == []


def test_to_precision_8_equals_every_recorded_conversion_bit_for_bit_and_writes_the_same_decimal(table):
    wrong = []
    for x, written, want in table["to_precision_8"]:
        x = number(x)
        if not same_bits(jstext.to_precision_8(x), number(want)):
            wrong.append((x, jstext.to_precision_8(x), want))
        if math.isfinite(x) and jstext.to_precision_8_decimal(x) != Decimal(written):
            wrong.append((x, str(jstext.to_precision_8_decimal(x)), written))
    assert wrong == []


def test_to_precision_8_rounds_exact_ties_away_from_zero_where_python_rounds_to_even():
    assert f"{123456785.0:.7e}" == "1.2345678e+08"                     # Python: ties to even
    assert jstext.to_precision_8(123456785.0) == 123456790.0
    assert jstext.to_precision_8(-123456785.0) == -123456790.0
    assert same_bits(jstext.to_precision_8(-0.0), 0.0) and math.isnan(jstext.to_precision_8(math.nan))
    assert jstext.to_precision_8(math.inf) == math.inf and jstext.to_precision_8(-math.inf) == -math.inf


@pytest.mark.parametrize("text", ["nan", "NaN", "inf", "-inf", "infinity", "1_000", "0x1_0", "١", "１", "+0x1", "-0x1",
                                  " 0x 1", "0x1 2", "1e", "1e+", "e1", ".", "+", "1.2.3", "1,5", "\x1c1", "1\x85", "᠎1", "1\x00"])
def test_what_python_float_would_accept_or_ecmascript_refuses_is_nan(text):
    assert math.isnan(jstext.string_to_number(text))


def test_whitespace_is_the_ecmascript_set_exactly():
    ecmascript = set("\t\n\x0b\x0c\r       　﻿") | {chr(c) for c in range(0x2000, 0x200B)}
    assert set(jstext.WHITESPACE) == ecmascript
    python_only = {c for c in map(chr, range(0x110000)) if c.isspace()} - ecmascript
    assert python_only == {"\x1c", "\x1d", "\x1e", "\x1f", "\x85"}, "the classes Python would have used"
    assert jstext.trim("﻿  a \x85\x1c　") == "a \x85\x1c"


def test_lines_split_at_lf_and_crlf_only():
    assert list(jstext.iter_lines("a\r\nb\rc\nd e\r\r\n\n")) == ["a", "b\rc", "d e\r", "", ""]
    assert list(jstext.iter_lines("")) == [""] and list(jstext.iter_lines("\n")) == ["", ""]


SPLIT_ALPHABET = "a1.,;\t   \x1c\x85\""


@pytest.mark.parametrize("seed", range(20))
def test_iter_split_equals_re_split_for_expressions_that_cannot_match_empty(seed):
    rng = random.Random(seed)
    separator = re.compile(r"[,;\t ]+")
    for _ in range(300):
        text = "".join(rng.choice(SPLIT_ALPHABET) for _ in range(rng.randrange(0, 14)))
        assert list(jstext.iter_split(text, separator)) == separator.split(text)
        assert list(jstext.iter_split(text, jstext.WHITESPACE_RUN)) == jstext.WHITESPACE_RUN.split(text)
        assert list(jstext.iter_pieces(text, ",")) == text.split(",")


def test_long_hostile_numbers_are_read_in_linear_time():
    started = time.perf_counter()
    assert jstext.string_to_number("1" * 4_000_000) == math.inf
    assert math.isnan(jstext.string_to_number("1" * 4_000_000 + "x"))
    assert jstext.string_to_number("0." + "0" * 4_000_000 + "1") == 0.0
    assert jstext.string_to_number("0x" + "f" * 4_000_000) == math.inf
    assert jstext.string_to_number("9007199254740993." + "0" * 4_000_000 + "1") == 9007199254740994.0
    assert jstext.string_to_number(" " * 4_000_000) == 0.0
    assert time.perf_counter() - started < 10, "seconds for six 4 MB numbers; quadratic work would take hours"
