"""Name -> method module. The engine advertises exactly these names in its handshake."""

from . import core_ages, section_intervals
from .errors import MethodError

METHODS = {section_intervals.NAME: section_intervals, core_ages.NAME: core_ages}


def get(name: str):
    """The method module for ``name`` (for example ``"section.intervals/1"``); unknown names are unsupported."""
    try:
        return METHODS[name]
    except (KeyError, TypeError):
        raise MethodError("UNSUPPORTED_METHOD", "method") from None
