"""ECMAScript text and number primitives, so that a Python reader gives exactly what the program's JavaScript gives.

Contract: docs/roadmap-engine-contract.md §9.11 ("Character classes used by both readers" and the conversion rule of
``core.bacon/1``). Standard library only. Every function is linear in the length of its input.

Python's own primitives differ from ECMAScript and are not used on text: ``str.isspace``, ``str.strip()``/``str.split()``
without arguments and ``re`` ``\\s`` also treat U+001C-U+001F and U+0085 as whitespace; ``float()`` accepts ``nan``,
``inf``, ``infinity``, ``1_000`` and non-ASCII digits; ``int()`` accepts ``_``, a sign and surrounding whitespace; Python's
formatting rounds ties to even where ``Number.prototype.toPrecision`` rounds them away from zero. Each is replaced below by
the exact ECMAScript rule, and ``float()``/``int()`` only ever see text that the ECMAScript grammar accepted first.
"""

from __future__ import annotations

import math
import re
from decimal import ROUND_HALF_UP, Context, Decimal

# ECMAScript WhiteSpace and LineTerminator: the set of String.prototype.trim, of the class \s and of StringToNumber.
WHITESPACE = ("\t\n\x0b\x0c\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
              "\u2028\u2029\u202f\u205f\u3000\ufeff")
_WS_CLASS = "[" + "".join(f"\\u{ord(c):04x}" for c in WHITESPACE) + "]"
WHITESPACE_RUN = re.compile(_WS_CLASS + "+")

_DECIMAL = re.compile(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?")
_RADIX = {"x": (16, re.compile(r"[0-9a-fA-F]+")), "b": (2, re.compile(r"[01]+")), "o": (8, re.compile(r"[0-7]+"))}
_INFINITY = {"Infinity": math.inf, "+Infinity": math.inf, "-Infinity": -math.inf}
_ASCII_LOWER = str.maketrans("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz")

# 8 significant digits, rounding half away from zero; the exponent range covers every double (and is not the default context's).
_PRECISION_8 = Context(prec=8, rounding=ROUND_HALF_UP, Emin=-999_999, Emax=999_999)


def iter_lines(text: str):
    """The pieces of ``text.split(/\\r?\\n/)``, in order and one at a time: a line ends at every ``\\n``, and a ``\\r`` just
    before it belongs to the separator. A lone ``\\r``, U+2028 and U+2029 stay inside a line."""
    start = 0
    while True:
        end = text.find("\n", start)
        if end < 0:
            yield text[start:]
            return
        yield text[start:end - 1] if end > start and text[end - 1] == "\r" else text[start:end]
        start = end + 1


def iter_split(text: str, separator):
    """The pieces of ECMAScript ``text.split(separator)``, one at a time, for a compiled ``separator`` that cannot match the
    empty string (then ECMAScript and ``re.split`` agree: leftmost matches, each as long as the expression allows)."""
    start = 0
    for match in separator.finditer(text):
        yield text[start:match.start()]
        start = match.end()
    yield text[start:]


def iter_pieces(text: str, separator: str):
    """``text.split(separator)`` for a plain one-character string, one piece at a time."""
    start = 0
    while True:
        end = text.find(separator, start)
        if end < 0:
            yield text[start:]
            return
        yield text[start:end]
        start = end + 1


def trim(text: str) -> str:
    """``String.prototype.trim``: ECMAScript whitespace removed at both ends."""
    return text.strip(WHITESPACE)


def lower_ascii(text: str) -> str:
    """A-Z mapped to a-z, nothing else. Where the readers compare names or read numbers this equals
    ``String.prototype.toLowerCase`` (contract §9.11: only U+0130 and U+212A lowercase to text with an ASCII letter, and
    neither can complete a compared name)."""
    return text.translate(_ASCII_LOWER)


def string_to_number(text: str) -> float:
    """ECMAScript ``Number(text)`` (``StringToNumber``): NaN for anything outside the grammar.

    Whitespace at both ends is removed; the empty string is 0. Then exactly one of: an optionally signed decimal literal
    (ASCII digits, at most one ``.`` with digits on at least one side, an optional ``e``/``E`` exponent with an optional
    sign), ``Infinity`` with an optional sign, or an unsigned ``0x``/``0b``/``0o`` integer (any case of the letter). Values
    are rounded to the nearest double, ties to even, as CPython's correctly rounded ``float()`` does for decimal text and
    ``float(int)`` for integers; a value beyond the largest double is Infinity."""
    s = trim(text)
    if not s:
        return 0.0
    if s in _INFINITY:
        return _INFINITY[s]
    if len(s) > 2 and s[0] == "0" and s[1] in "xXbBoO":
        base, digits = _RADIX[s[1].lower()]
        if not digits.fullmatch(s, 2):
            return math.nan
        try:
            return float(int(s[2:], base))
        except OverflowError:
            return math.inf
    if not _DECIMAL.fullmatch(s):
        return math.nan
    return float(s)


def to_precision_8_decimal(x: float) -> Decimal:
    """The decimal that ``x.toPrecision(8)`` writes, for finite ``x``: the integer n with 10^7 <= n < 10^8 and the exponent
    that bring n x 10^(e-7) closest to abs(x), taken from the exact binary value of ``x``, a tie taking the larger n; the
    sign set apart, and zero (also -0) written as 0."""
    if x == 0:
        return Decimal(0)
    magnitude = _PRECISION_8.plus(Decimal(abs(x)))      # Decimal(float) is exact
    return -magnitude if x < 0 else magnitude


def to_precision_8(x: float) -> float:
    """``Number(x.toPrecision(8))``: ``x`` rounded to 8 significant digits as ECMAScript does, read back to the nearest
    double (ties to even). Zero, also -0, gives +0; NaN and the infinities are returned unchanged."""
    if not math.isfinite(x):
        return x
    if x == 0:
        return 0.0
    return float(to_precision_8_decimal(x))
