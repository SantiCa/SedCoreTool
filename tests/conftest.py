"""Shared helpers of the Python tests."""
import importlib
import os

import pytest


def require_pyvips():
    """pyvips for the tile-store tests: skipped when it is missing, except where ``SEDCORETOOL_REQUIRE_PYVIPS=1`` (the GitHub workflow, card
    M8.4.32), where a missing pyvips fails the run instead of skipping the tests silently."""
    if os.environ.get("SEDCORETOOL_REQUIRE_PYVIPS") == "1":
        return importlib.import_module("pyvips")
    return pytest.importorskip("pyvips")
