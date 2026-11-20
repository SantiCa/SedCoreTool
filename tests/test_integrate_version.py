"""``tools/integrate_version.py``: a version reaches ``master`` as one commit, repeatedly and without conflicts, and nothing merged into ``master`` is lost."""

import importlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="git is not installed")


@pytest.fixture(scope="module")
def tool():
    with pytest.MonkeyPatch.context() as patch:
        patch.syspath_prepend(str(Path(__file__).resolve().parents[1] / "tools"))
        sys.modules.pop("integrate_version", None)
        return importlib.import_module("integrate_version")


def git(root: Path, *args: str) -> str:
    done = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, encoding="utf-8")
    assert done.returncode == 0, f"git {' '.join(args)}: {done.stderr}"
    return done.stdout.strip()


def write_version(root: Path, number: int, *, unreleased: bool = False) -> None:
    (root / "app/js").mkdir(parents=True, exist_ok=True)
    (root / "app/js/app.js").write_text(f"import x from './x.js';\nexport const DELIVERY = 'V0.{number}';\n", encoding="utf-8")
    headings = "".join(f"## V0.{n} — 2026-01-0{n}\n\n- change {n}\n\n" for n in range(number, 0, -1))
    (root / "CHANGELOG.md").write_text("# Changelog\n\n" + ("## Unreleased\n\n- pending\n\n" if unreleased else "") + headings, encoding="utf-8")


def commit_all(root: Path, message: str) -> str:
    git(root, "add", "-A")
    git(root, "commit", "--quiet", "-m", message)
    return git(root, "rev-parse", "HEAD")


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    """``master`` holds V0.1; the branch ``work/a`` (checked out) holds V0.2 with one changed and one new file."""
    root = tmp_path / "repo"
    root.mkdir()
    git(root, "init", "--quiet", "--initial-branch=master")
    for key, value in (("user.name", "Tester"), ("user.email", "tester@example.org"), ("commit.gpgsign", "false"), ("core.autocrlf", "false")):
        git(root, "config", key, value)
    write_version(root, 1)
    (root / "data.txt").write_text("line one\nline two\nline three\n", encoding="utf-8")
    commit_all(root, "V0.1: first version")
    git(root, "checkout", "--quiet", "-b", "work/a")
    (root / "data.txt").write_text("line one\nline two, edited on the branch\nline three\n", encoding="utf-8")
    (root / "new.txt").write_text("new on the branch\n", encoding="utf-8")
    commit_all(root, "work in progress")
    write_version(root, 2)
    commit_all(root, "V0.2 version number and changelog")
    return root


def run(tool, root: Path, summary: str = "what it brings", **options) -> dict:
    return tool.integrate(root, summary, remote=options.pop("remote", None), ci_check=options.pop("ci_check", False), **options)


def test_one_commit_on_master_with_the_files_of_the_branch_and_the_histories_stay_joined(tool, repo):
    branch_tree = git(repo, "rev-parse", "HEAD^{tree}")
    result = run(tool, repo, "second version", footer="Co-Authored-By: Someone <someone@example.org>")
    assert result["version"] == "V0.2" and not result["pushed"]
    assert git(repo, "rev-parse", "--abbrev-ref", "HEAD") == "work/a"                       # back on the work branch
    assert git(repo, "log", "--format=%s", "master").splitlines() == ["V0.2: second version", "V0.1: first version"]
    assert "Co-Authored-By: Someone" in git(repo, "log", "-1", "--format=%B", "master")
    assert git(repo, "rev-parse", "master^{tree}") == branch_tree == git(repo, "rev-parse", "HEAD^{tree}")
    assert subprocess.run(["git", "merge-base", "--is-ancestor", "master", "HEAD"], cwd=repo).returncode == 0
    assert git(repo, "status", "--porcelain") == ""


def test_repeated_versions_never_conflict_even_when_the_same_lines_change_again(tool, repo):
    run(tool, repo)
    for number in (3, 4, 5):
        (repo / "data.txt").write_text(f"line one\nline two, edited again for {number}\nline three\n", encoding="utf-8")   # the line every version touches
        commit_all(repo, f"work for {number}")
        write_version(repo, number)
        commit_all(repo, f"V0.{number} version number and changelog")
        result = run(tool, repo, f"version {number}")
        assert result["version"] == f"V0.{number}"
        assert git(repo, "rev-parse", "master^{tree}") == git(repo, "rev-parse", "HEAD^{tree}")
    assert git(repo, "log", "--first-parent", "--format=%s", "master").splitlines()[:2] == ["V0.5: version 5", "V0.4: version 4"]
    assert git(repo, "rev-list", "--count", "--first-parent", "master") == "5"              # one commit per version


def test_a_change_merged_into_master_elsewhere_stops_the_integration_and_is_kept_once_merged_into_the_branch(tool, repo):
    git(repo, "checkout", "--quiet", "master")                                                 # what a pull request merged on GitHub does
    (repo / "dependency.lock").write_text("library 2.0\n", encoding="utf-8")
    foreign = commit_all(repo, "Bump library from 1.0 to 2.0")
    git(repo, "checkout", "--quiet", "work/a")
    with pytest.raises(SystemExit) as refusal:
        run(tool, repo)
    assert "master has changes that the work branch does not contain" in str(refusal.value) and "Bump library" in str(refusal.value)
    assert git(repo, "rev-parse", "master") == foreign and git(repo, "rev-parse", "--abbrev-ref", "HEAD") == "work/a"   # nothing moved
    git(repo, "merge", "--quiet", "master", "-m", "Merge master into the work branch")
    result = run(tool, repo, "second version with the dependency")
    assert (repo / "dependency.lock").read_text(encoding="utf-8") == "library 2.0\n"
    assert git(repo, "show", "master:dependency.lock") == "library 2.0"
    assert git(repo, "show", "master:new.txt") == "new on the branch"
    assert git(repo, "rev-parse", f"{result['master']}^") == foreign                           # the version commit sits on top of the foreign change


@pytest.mark.parametrize("prepare, expected", [
    (lambda root: (root / "data.txt").write_text("not committed\n", encoding="utf-8"), "uncommitted or untracked"),
    (lambda root: (root / "stray.txt").write_text("untracked\n", encoding="utf-8"), "uncommitted or untracked"),
    (lambda root: git(root, "checkout", "--quiet", "master"), "not a work/... branch"),
    (lambda root: (write_version(root, 2, unreleased=True), commit_all(root, "changelog not prepared")), "still has a '## Unreleased' section"),
    (lambda root: (write_version(root, 9), (root / "CHANGELOG.md").write_text("# Changelog\n\n## V0.2 — x\n", encoding="utf-8"), commit_all(root, "no heading")),
     "has no '## V0.9 ...' heading"),
    (lambda root: ((root / "app/js/app.js").write_text("const OTHER = 1;\n", encoding="utf-8"), commit_all(root, "no delivery")), "DELIVERY was not found"),
])
def test_it_refuses_and_changes_nothing(tool, repo, prepare, expected):
    master_before = git(repo, "rev-parse", "master")
    prepare(repo)
    head_before, branch_before = git(repo, "rev-parse", "HEAD"), git(repo, "rev-parse", "--abbrev-ref", "HEAD")
    with pytest.raises(SystemExit) as refusal:
        run(tool, repo)
    assert expected in str(refusal.value)
    assert git(repo, "rev-parse", "master") == master_before and git(repo, "rev-parse", "HEAD") == head_before
    assert git(repo, "rev-parse", "--abbrev-ref", "HEAD") == branch_before


def test_it_refuses_an_empty_summary_a_version_already_on_master_and_nothing_to_integrate(tool, repo):
    with pytest.raises(SystemExit, match="give --summary"):
        run(tool, repo, "   ")
    run(tool, repo)
    with pytest.raises(SystemExit, match="nothing to integrate"):
        run(tool, repo)
    (repo / "data.txt").write_text("more work, version number not changed\n", encoding="utf-8")
    commit_all(repo, "more work")
    with pytest.raises(SystemExit, match="master already has a commit 'V0.2: ...'"):
        run(tool, repo)


def test_with_a_remote_it_sees_what_was_merged_there_and_pushes_both_branches(tool, repo, tmp_path):
    origin = tmp_path / "origin.git"
    git(tmp_path, "init", "--quiet", "--bare", "--initial-branch=master", str(origin))
    git(repo, "remote", "add", "origin", str(origin))
    git(repo, "push", "--quiet", "origin", "master", "work/a")
    other = tmp_path / "other"                                                              # somebody merges a pull request on the remote
    git(tmp_path, "clone", "--quiet", "--branch", "master", str(origin), str(other))
    for key, value in (("user.name", "Bot"), ("user.email", "bot@example.org"), ("commit.gpgsign", "false")):
        git(other, "config", key, value)
    (other / "workflow.yml").write_text("uses: action@v3\n", encoding="utf-8")
    commit_all(other, "Bump action from 2 to 3")
    git(other, "push", "--quiet", "origin", "master")
    with pytest.raises(SystemExit, match="Bump action from 2 to 3"):                         # the local master did not know yet: the tool fetched it
        run(tool, repo, remote="origin")
    git(repo, "merge", "--quiet", "master", "-m", "Merge master into the work branch")
    git(repo, "push", "--quiet", "origin", "work/a")
    result = run(tool, repo, "second version", remote="origin", push=True)
    assert result["pushed"]
    assert git(origin, "log", "-1", "--format=%s", "master") == "V0.2: second version"
    assert git(origin, "show", "master:workflow.yml") == "uses: action@v3" and git(origin, "show", "master:new.txt") == "new on the branch"
    assert git(origin, "rev-parse", "work/a") == git(repo, "rev-parse", "HEAD")
    assert git(origin, "tag") == ""                                                          # it never creates a tag


def test_the_workflow_check_names_what_is_missing(tool, repo, monkeypatch):
    def fake_gh(runs):
        def call(command, **_):
            assert command[:3] == ["gh", "run", "list"]
            return subprocess.CompletedProcess(command, 0, stdout=json.dumps(runs), stderr="")
        return call
    ok = {"status": "completed", "conclusion": "success"}
    monkeypatch.setattr(tool.subprocess, "run", fake_gh([{"name": "tests", **ok}, {"name": "Desktop builds", **ok}, {"name": "tests", "status": "completed", "conclusion": "failure"}]))
    assert tool.workflows_problem(repo, "a" * 40) is None                                    # the newest run of each workflow counts
    monkeypatch.setattr(tool.subprocess, "run", fake_gh([{"name": "tests", **ok}]))
    assert "'Desktop builds' has not run" in tool.workflows_problem(repo, "a" * 40)
    monkeypatch.setattr(tool.subprocess, "run", fake_gh([{"name": "tests", **ok}, {"name": "Desktop builds", "status": "in_progress", "conclusion": ""}]))
    assert "in_progress" in tool.workflows_problem(repo, "a" * 40)
    monkeypatch.setattr(tool.subprocess, "run", fake_gh([{"name": "tests", "status": "completed", "conclusion": "failure"}, {"name": "Desktop builds", **ok}]))
    assert "completed/failure" in tool.workflows_problem(repo, "a" * 40)
