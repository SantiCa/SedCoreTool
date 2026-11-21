#!/usr/bin/env python3
"""Run the full checks of docs/DEVELOPMENT.md section 3, one after another, and print one line per check.

The checks run strictly in sequence (the engine tests have timing deadlines and fail under CPU contention).
The full output of every check goes to a log file; the screen shows name, result, count and seconds, and
only the last lines of a failed check. Standard library only.
"""

from __future__ import annotations

import argparse
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
FAILURE_TAIL_LINES = 30
WINDOWS_NODE_DIR = r"C:\Program Files\nodejs"

PASSED, FAILED, SKIPPED = "PASSED", "FAILED", "SKIPPED"

# End-to-end test option -> (check name, script). Order follows DEVELOPMENT section 3.
E2E_SCRIPTS = {
    "desktop": ("e2e-desktop", "tests/e2e/desktop.mjs"),
    "smoke": ("e2e-smoke", "tests/e2e/smoke.mjs"),
    "large16": ("e2e-large16", "tests/e2e/large-16bit-desktop.mjs"),
    "tiled": ("e2e-tiled", "tests/e2e/tiled-sections.mjs"),
}
DESKTOP_WINDOW_E2E = ("desktop", "large16", "tiled")  # these start the desktop program and need desktop/web
# The desktop end-to-end test runs twice: engine experiment off, then on (AGENTS.md section 6, milestone gate).
ENGINE_ON = (("SEDCORETOOL_ENGINE_EXPERIMENT", "1"),)


@dataclass(frozen=True)
class Check:
    """One check. `argv` is None when the tool needed could not be found (`missing_tool` names it)."""

    name: str
    argv: list[str] | None
    count_kind: str | None = None  # "pytest" or "node": how to read a count from the output
    missing_tool: str = ""
    cwd: Path = REPO_ROOT
    extra_env: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True)
class Result:
    name: str
    status: str
    count: str
    seconds: float
    note: str = ""
    log_path: Path | None = None
    tail: str = ""


# ---------------------------------------------------------------- reading output

_PYTEST_SUMMARY = re.compile(r"^=*\s*((?:\d+ \w+(?:, )?)+)\s+in\s+[\d.]+s")
_NODE_COUNT = re.compile(r"^#\s+(pass|fail)\s+(\d+)\s*$", re.MULTILINE)


def parse_count(kind: str | None, output: str) -> str:
    """Return the count the tool reports ("896 passed, 9 skipped", "pass 557, fail 0") or ""."""
    if kind == "pytest":
        for line in reversed(output.splitlines()):
            match = _PYTEST_SUMMARY.match(line.strip())
            if match:
                return match.group(1)
        return ""
    if kind == "node":
        found = {word: number for word, number in _NODE_COUNT.findall(output)}
        return ", ".join(f"{word} {found[word]}" for word in ("pass", "fail") if word in found)
    return ""


def last_lines(text: str, count: int = FAILURE_TAIL_LINES) -> str:
    return "\n".join(text.splitlines()[-count:])


# ---------------------------------------------------------------- finding tools

def _split_command(text: str) -> list[str]:
    return shlex.split(text, posix=os.name != "nt")


def _command_works(argv: list[str], probe: list[str], env: dict[str, str]) -> bool:
    if shutil.which(argv[0], path=env.get("PATH")) is None:
        return False
    try:
        done = subprocess.run([*argv, *probe], capture_output=True, env=env, timeout=60)
    except (OSError, subprocess.SubprocessError):
        return False
    return done.returncode == 0


def tool_environment() -> dict[str, str]:
    """Environment for the checks; on Windows adds the Node folder when `node` is not on PATH."""
    env = dict(os.environ)
    if os.name == "nt" and shutil.which("node", path=env.get("PATH")) is None and Path(WINDOWS_NODE_DIR).is_dir():
        env["PATH"] = env.get("PATH", "") + os.pathsep + WINDOWS_NODE_DIR
    return env


def find_python(requested: str | None, env: dict[str, str]) -> list[str] | None:
    """Python 3.12 (DEVELOPMENT section 1): `--python`, else `py -3.12` on Windows, else python3.12 / python3."""
    if requested:
        return _split_command(requested)
    candidates = [["py", "-3.12"]] if os.name == "nt" else []
    candidates += [["python3.12"], ["python3"], [sys.executable]]
    for candidate in candidates:
        if _command_works(candidate, ["-c", "pass"], env):
            return candidate
    return None


def find_ruff(requested: str | None, python: list[str] | None, env: dict[str, str]) -> list[str] | None:
    """Ruff: `--ruff`, else `ruff`, else `<python> -m ruff`, else `py -3.14 -m ruff` on Windows."""
    if requested:
        return _split_command(requested)
    candidates = [["ruff"]]
    if python:
        candidates.append([*python, "-m", "ruff"])
    if os.name == "nt":
        candidates.append(["py", "-3.14", "-m", "ruff"])
    for candidate in candidates:
        if _command_works(candidate, ["--version"], env):
            return candidate
    return None


def find_node_tools(env: dict[str, str]) -> tuple[list[str] | None, list[str] | None]:
    node = shutil.which("node", path=env.get("PATH"))
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm", path=env.get("PATH"))
    return ([node] if node else None, [npm] if npm else None)


# ---------------------------------------------------------------- the plan

def build_checks(python: list[str] | None, ruff: list[str] | None, node: list[str] | None,
                 npm: list[str] | None, e2e: Sequence[str] = (), prepare: bool = False) -> list[Check]:
    """The checks of DEVELOPMENT section 3, in its order, then the requested end-to-end tests."""

    def tool(prefix: list[str] | None, label: str, *args: str) -> tuple[list[str] | None, str]:
        return ([*prefix, *args] if prefix else None), ("" if prefix else label)

    checks = []
    for name, prefix, label, kind, args in (
        ("pytest", python, "python 3.12", "pytest", ("-m", "pytest", "-q")),
        ("npm-test", npm, "npm", "node", ("test",)),
        ("typecheck", npm, "npm", None, ("run", "typecheck")),
        ("sync-version", python, "python 3.12", None, ("tools/sync_version.py", "--check")),
        ("ruff", ruff, "ruff", None, ("check", "src", "tests", "tools")),
    ):
        argv, missing = tool(prefix, label, *args)
        checks.append(Check(name, argv, kind, missing))
    selected = [key for key in E2E_SCRIPTS if key in e2e]
    if prepare and any(key in DESKTOP_WINDOW_E2E for key in selected):
        argv, missing = tool(node, "node", "desktop/scripts/prepare.js", "--with-examples")
        checks.append(Check("prepare-desktop", argv, None, missing))
    for key in selected:
        name, script = E2E_SCRIPTS[key]
        argv, missing = tool(node, "node", script)
        checks.append(Check(name, argv, None, missing))
        if key == "desktop":
            checks.append(Check("e2e-desktop-engine", argv, None, missing, extra_env=ENGINE_ON))
    return checks


def select_checks(checks: Sequence[Check], only: str | None) -> list[Check]:
    if not only:
        return list(checks)
    wanted = [word.strip() for word in only.split(",") if word.strip()]
    unknown = [word for word in wanted if word not in {check.name for check in checks}]
    if unknown:
        known = ", ".join(check.name for check in checks)
        raise ValueError(f"unknown check(s): {', '.join(unknown)}; known: {known}")
    return [check for check in checks if check.name in wanted]


# ---------------------------------------------------------------- running

def _missing(check: Check, env: dict[str, str]) -> str:
    if check.argv is None:
        return check.missing_tool or "tool"
    if shutil.which(check.argv[0], path=env.get("PATH")) is None:
        return check.argv[0]
    return ""


def run_check(check: Check, log_path: Path, env: dict[str, str] | None = None) -> Result:
    """Run one check with its full output in `log_path`; never raises for a failing command."""
    env = env if env is not None else tool_environment()
    missing = _missing(check, env)
    if missing:
        return Result(check.name, SKIPPED, "", 0.0, note=f"tool missing: {missing}")
    env = {**env, **dict(check.extra_env)}
    started = time.monotonic()
    with open(log_path, "wb") as log:
        prefix = "".join(f"{name}={value} " for name, value in check.extra_env)
        log.write(f"$ {prefix}{' '.join(check.argv)}\n".encode())
        log.flush()
        try:
            code = subprocess.run(check.argv, cwd=check.cwd, env=env, stdout=log, stderr=subprocess.STDOUT).returncode
        except OSError as error:
            log.write(f"could not start: {error}\n".encode())
            code = -1
    seconds = time.monotonic() - started
    output = log_path.read_text(encoding="utf-8", errors="replace")
    status = PASSED if code == 0 else FAILED
    note = "" if code == 0 else f"exit code {code}"
    return Result(check.name, status, parse_count(check.count_kind, output), seconds, note, log_path,
                  last_lines(output) if code != 0 else "")


def format_line(result: Result) -> str:
    detail = result.count or result.note
    return f"{result.name:<20} {result.status:<8} {detail:<28} {result.seconds:7.1f} s"


def exit_code(results: Sequence[Result]) -> int:
    """Non-zero when a check failed or a required tool is missing."""
    return 0 if all(result.status == PASSED for result in results) else 1


def run_all(checks: Sequence[Check], log_dir: Path, out=None, env: dict[str, str] | None = None) -> int:
    out = out if out is not None else sys.stdout
    log_dir.mkdir(parents=True, exist_ok=True)
    env = env if env is not None else tool_environment()
    results = []
    for number, check in enumerate(checks, start=1):
        result = run_check(check, log_dir / f"{number:02d}-{check.name}.log", env)
        results.append(result)
        print(format_line(result), file=out, flush=True)
        if result.status == FAILED:
            print(f"--- last lines of {check.name} (full output: {result.log_path}) ---", file=out)
            print(result.tail, file=out, flush=True)
    failed = [result.name for result in results if result.status != PASSED]
    print(f"{'ALL PASSED' if not failed else 'NOT PASSED: ' + ', '.join(failed)}; logs in {log_dir}", file=out)
    return exit_code(results)


# ---------------------------------------------------------------- command line

def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the full checks of docs/DEVELOPMENT.md section 3, one after another (never in parallel).",
        epilog="End-to-end tests run only when asked. --smoke needs the server of DEVELOPMENT section 2 and Chrome; "
               "the desktop ones check first that desktop/web is current (see DEVELOPMENT section 3).")
    parser.add_argument("--python", help="Python 3.12 command with pytest (default: py -3.12 on Windows, else python3.12/python3)")
    parser.add_argument("--ruff", help="ruff command, e.g. 'py -3.14 -m ruff' (default: ruff, else <python> -m ruff, else py -3.14 -m ruff)")
    parser.add_argument("--log-dir", type=Path, help="folder for one log per check (default: new timestamped folder in the system temp directory)")
    parser.add_argument("--only", help="comma-separated check names to run (see --list)")
    parser.add_argument("--list", action="store_true", help="print the plan and exit")
    parser.add_argument("--desktop", action="store_true",
                        help="also run node tests/e2e/desktop.mjs, with the engine experiment off and then on")
    parser.add_argument("--tiled", action="store_true", help="also run node tests/e2e/tiled-sections.mjs")
    parser.add_argument("--smoke", action="store_true", help="also run node tests/e2e/smoke.mjs")
    parser.add_argument("--large16", action="store_true", help="also run node tests/e2e/large-16bit-desktop.mjs")
    parser.add_argument("--e2e", action="store_true", help="all four end-to-end options")
    parser.add_argument("--prepare", action="store_true",
                        help="before the desktop end-to-end tests run node desktop/scripts/prepare.js --with-examples (refreshes desktop/web)")
    return parser.parse_args(argv)


def default_log_dir() -> Path:
    return Path(tempfile.gettempdir()) / time.strftime("sedcoretool-checks-%Y%m%d-%H%M%S")


def plan_from_args(args: argparse.Namespace, env: dict[str, str]) -> list[Check]:
    python = find_python(args.python, env)
    ruff = find_ruff(args.ruff, python, env)
    node, npm = find_node_tools(env)
    e2e = [key for key in E2E_SCRIPTS if args.e2e or getattr(args, key)]
    return select_checks(build_checks(python, ruff, node, npm, e2e, args.prepare), args.only)


def main(argv: Sequence[str] | None = None, plan: Callable[[argparse.Namespace], list[Check]] | None = None) -> int:
    """`plan` replaces the real list of checks (used by the tests)."""
    args = parse_args(argv)
    env = tool_environment()
    try:
        checks = plan(args) if plan else plan_from_args(args, env)
    except ValueError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    if args.list:
        for check in checks:
            command = " ".join(check.argv) if check.argv else f"(tool missing: {check.missing_tool})"
            command = "".join(f"{name}={value} " for name, value in check.extra_env) + command
            print(f"{check.name:<20} {command}")
        return 0
    return run_all(checks, args.log_dir or default_log_dir(), env=env)


if __name__ == "__main__":
    sys.exit(main())
