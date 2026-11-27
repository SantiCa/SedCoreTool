"""Standalone support for compatibility exports without duplicate global bindings."""
import importlib
from pathlib import Path

import pytest


@pytest.fixture
def strip_module(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1] / "tools"))
    return importlib.import_module("build_standalone").strip_module


def test_local_export_lists_preserve_the_original_binding(strip_module):
    source = "import { value } from './depth.js';\nexport {\n value, other_value, $helper,\n};\nexport const result = value;\n"
    stripped = strip_module(source)
    assert stripped.strip() == "const result = value;"
    assert strip_module("export const text = 'export { value };';") == "const text = 'export { value };';"


def test_several_imports_on_one_line_are_all_removed(strip_module):
    # app.js once held two imports on one line; the single-file build kept the line and could not start offline.
    source = "import { a } from './a.js'; import { b } from './b.js';\nimport {\n c,\n} from './c.js';\nconst x = a + b + c;\n"
    assert strip_module(source).strip() == "const x = a + b + c;"


@pytest.mark.parametrize("source", ["import { a } from './a.js'; const x = a;", "import './side-effect.js'"])
def test_imports_that_cannot_be_removed_fail_explicitly(strip_module, source):
    with pytest.raises(ValueError, match="Unsupported import"):
        strip_module(source)


def test_the_app_modules_strip_without_imports_left():
    import re
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
    build_standalone = importlib.import_module("build_standalone")
    for name in build_standalone.ORDER:
        stripped = build_standalone.strip_module((build_standalone.APP / "js" / name).read_text(encoding="utf-8"))
        assert not re.search(r"^\s*import\s", stripped, flags=re.M), name


@pytest.mark.parametrize("source", ["export { value as alias };", "export { value } from './depth.js';",
                                    "export { value }"])
def test_unsupported_lists_fail_explicitly_instead_of_emitting_broken_html(strip_module, source):
    with pytest.raises(ValueError, match="local unaliased names and a semicolon"):
        strip_module(source)
