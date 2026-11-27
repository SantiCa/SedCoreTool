"""Name -> method module. The engine advertises exactly these names in its handshake."""

from . import core_age_model, core_ages, core_bacon, core_depths, section_intervals
from .errors import MethodError

METHODS = {section_intervals.NAME: section_intervals, core_ages.NAME: core_ages, core_depths.NAME: core_depths,
           core_age_model.NAME: core_age_model, core_bacon.NAME: core_bacon}


def get(name: str):
    """The method module for ``name`` (for example ``"section.intervals/1"``); unknown names are unsupported."""
    try:
        return METHODS[name]
    except (KeyError, TypeError):
        raise MethodError("UNSUPPORTED_METHOD", "method") from None
