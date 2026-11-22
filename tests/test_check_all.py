"""Tests for tools/check_all.py with fake checks (the real suite is never run here)."""

from __future__ import annotations

import importlib.util
import io
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent.parent / "tools" / "check_all.py"
spec = importlib.util.spec_from_file_location("check_all", SCRIPT)
check_all = importlib.util.module_from_spec(spec)
sys.modules["check_all"] = check_all
spec.loader.exec_module(check_all)

PASSING = check_all.Check(
    "good", [sys.executable, "-c", "print('3 passed, 1 skipped in 0.10s')"], count_kind="pytest")
FAILING = check_all.Check(
    "bad", [sys.executable, "-c", "print('\\n'.join(f'line {i}' for i in range(1, 201))); raise SystemExit(3)"])
MISSING = check_all.Check("absent", ["no-such-program-for-check-all-tests"])
UNRESOLVED = check_all.Check("unresolved", None, missing_tool="ruff")


def run(checks, tmp_path):
    out = io.StringIO()
    code = check_all.run_all(checks, tmp_path / "logs", out=out)
    return code, out.getvalue()


def test_parse_pytest_count():
    text = "....\n896 passed, 9 skipped in 120.34s (0:02:00)\n"
    assert check_all.parse_count("pytest", text) == "896 passed, 9 skipped"
    assert check_all.parse_count("pytest", "= 2 failed, 5 passed in 1.00s =") == "2 failed, 5 passed"
    assert check_all.parse_count("pytest", "no summary here") == ""


def test_parse_node_count():
    text = "# tests 557\n# pass 557\n# fail 0\n# duration_ms 1200\n"
    assert check_all.parse_count("node", text) == "pass 557, fail 0"
    assert check_all.parse_count(None, text) == ""


def test_passing_check_summary_and_exit_code(tmp_path):
    code, text = run([PASSING], tmp_path)
    assert code == 0
    line = text.splitlines()[0]
    assert line.startswith("good") and "PASSED" in line and "3 passed, 1 skipped" in line and line.endswith(" s")
    assert "ALL PASSED" in text


def test_failing_check_prints_only_the_tail_and_logs_everything(tmp_path):
    code, text = run([FAILING], tmp_path)
    assert code == 1
    assert "FAILED" in text and "exit code 3" in text
    assert "line 200" in text and "line 171" in text
    assert "line 170" not in text and "line 1\n" not in text
    log = (tmp_path / "logs" / "01-bad.log").read_text(encoding="utf-8")
    assert "line 1\n" in log and "line 200" in log


def test_missing_tool_is_skipped_and_fails_the_run(tmp_path):
    code, text = run([MISSING, UNRESOLVED], tmp_path)
    assert code == 1
    assert "SKIPPED" in text and "tool missing: no-such-program-for-check-all-tests" in text
    assert "tool missing: ruff" in text


def test_checks_run_in_order_and_one_failure_does_not_stop_the_rest(tmp_path):
    code, text = run([FAILING, PASSING], tmp_path)
    names = [line.split()[0] for line in text.splitlines() if line.split() and line.split()[0] in ("bad", "good")]
    assert names == ["bad", "good"]
    assert code == 1
    assert (tmp_path / "logs" / "02-good.log").exists()


def test_main_uses_injected_plan_list_and_only(tmp_path, capsys):
    plan = lambda args: check_all.select_checks([PASSING, FAILING], args.only)  # noqa: E731
    assert check_all.main(["--list", "--only", "good"], plan=plan) == 0
    listing = capsys.readouterr().out
    assert "good" in listing and "bad" not in listing
    assert check_all.main(["--only", "good", "--log-dir", str(tmp_path / "l")], plan=plan) == 0
    assert check_all.main(["--only", "nope"], plan=plan) == 2


def test_build_checks_order_and_exact_commands():
    checks = check_all.build_checks(["py", "-3.12"], ["ruff"], ["node"], ["npm"], e2e=["desktop", "smoke"], prepare=True)
    assert [c.name for c in checks] == [
        "pytest", "npm-test", "typecheck", "sync-version", "ruff", "prepare-desktop", "e2e-desktop", "e2e-desktop-engine", "e2e-smoke"]
    by_name = {c.name: c.argv for c in checks}
    assert by_name["pytest"] == ["py", "-3.12", "-m", "pytest", "-q"]
    assert by_name["sync-version"] == ["py", "-3.12", "tools/sync_version.py", "--check"]
    assert by_name["ruff"] == ["ruff", "check", "src", "tests", "tools"]
    assert by_name["typecheck"] == ["npm", "run", "typecheck"]
    assert by_name["e2e-desktop"] == ["node", "tests/e2e/desktop.mjs"]


def test_build_checks_without_e2e_or_tools():
    checks = check_all.build_checks(None, None, None, None)
    assert [c.name for c in checks] == ["pytest", "npm-test", "typecheck", "sync-version", "ruff"]
    assert all(c.argv is None for c in checks)
    assert check_all.build_checks(["p"], ["r"], None, ["npm"], e2e=["tiled"])[-1].missing_tool == "node"


def test_select_checks_rejects_unknown_names():
    with pytest.raises(ValueError):
        check_all.select_checks([PASSING], "good,zzz")


def test_desktop_e2e_runs_with_the_engine_off_then_on(tmp_path):
    checks = check_all.build_checks(["py"], ["ruff"], ["node"], ["npm"], e2e=["desktop"])
    desktop = [check for check in checks if check.name.startswith("e2e-desktop")]
    assert [check.name for check in desktop] == ["e2e-desktop", "e2e-desktop-engine"]
    assert desktop[0].extra_env == () and desktop[1].extra_env == (("SEDCORETOOL_ENGINE_EXPERIMENT", "1"),)
    assert desktop[0].argv == desktop[1].argv
    probe = check_all.Check("engine", [sys.executable, "-c",
                            "import os, sys; sys.exit(0 if os.environ.get('SEDCORETOOL_ENGINE_EXPERIMENT') == '1' else 1)"],
                            extra_env=check_all.ENGINE_ON)
    result = check_all.run_check(probe, tmp_path / "engine.log")
    assert result.status == check_all.PASSED
    assert (tmp_path / "engine.log").read_text().startswith("$ SEDCORETOOL_ENGINE_EXPERIMENT=1 ")
