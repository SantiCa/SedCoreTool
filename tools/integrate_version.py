#!/usr/bin/env python3
"""Integrate the work branch into ``master`` as one version commit, without losing anything (AGENTS.md §5.5).

    python tools/integrate_version.py --summary "what this version brings" [--push] [--footer "Co-Authored-By: ..."]

Run it on the work branch after the version commit (``DELIVERY``, ``tools/sync_version.py``, the ``## V0.<n>`` heading of the changelog) has passed the
full checks and has been pushed. It changes nothing unless every condition holds:

1. the current branch is a ``work/...`` branch and the tree is clean;
2. the local ``master`` equals ``origin/master`` (it is first updated from the remote, forward only);
3. ``master`` is contained in the work branch. If somebody merged a pull request into ``master`` on GitHub, it is not: merge ``master`` into the work branch
   (a normal merge, which brings those changes in), check and push, and run this again. This is what keeps such changes from being lost;
4. ``DELIVERY`` names a version that the changelog has as a heading and ``master`` does not have yet, and no ``## Unreleased`` section is left;
5. the GitHub workflows ``tests`` and *Desktop builds* succeeded on the commit being integrated (asked through ``gh``).

Then it makes one commit ``V0.<n>: <summary>`` on ``master`` whose files are exactly those of the work branch, merges ``master`` back into the work
branch (no file changes; it keeps the two histories joined so the next integration cannot conflict) and, with ``--push``, pushes both. No tag is created:
tags publish a release and are the owner's decision.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REQUIRED_WORKFLOWS = ("tests", "Desktop builds")


class Refused(SystemExit):
    """A condition does not hold; nothing was changed."""

    def __init__(self, message: str):
        super().__init__(f"Not integrated: {message}")


def git(root: Path, *args: str, check: bool = True) -> str:
    done = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if check and done.returncode:
        raise RuntimeError(f"git {' '.join(args)} failed: {done.stderr.strip() or done.stdout.strip()}")
    return done.stdout.strip()


def succeeds(root: Path, *args: str) -> bool:
    return subprocess.run(["git", *args], cwd=root, capture_output=True).returncode == 0


def delivery(root: Path) -> str:
    """The version named by ``DELIVERY`` in ``app/js/app.js``, for example ``V0.151``."""
    found = re.search(r"(?m)^(?:export )?const DELIVERY = '(V\d+\.\d+)';", (root / "app/js/app.js").read_text(encoding="utf-8"))
    if not found:
        raise Refused("DELIVERY was not found in app/js/app.js")
    return found.group(1)


def changelog_problem(root: Path, version: str) -> str | None:
    lines = (root / "CHANGELOG.md").read_text(encoding="utf-8").splitlines()
    if any(line.strip() == "## Unreleased" for line in lines):
        return f"CHANGELOG.md still has a '## Unreleased' section: rename it to the heading of {version} (with the date, like the other versions) in the version commit"
    if not any(line.startswith(f"## {version} ") for line in lines):
        return f"CHANGELOG.md has no '## {version} ...' heading"
    return None


def workflows_problem(root: Path, commit: str) -> str | None:
    """None when every required GitHub workflow succeeded on ``commit``; otherwise what is missing."""
    try:
        done = subprocess.run(["gh", "run", "list", "--commit", commit, "--limit", "40", "--json", "name,status,conclusion"],
                              cwd=root, capture_output=True, text=True, encoding="utf-8", errors="replace")
    except FileNotFoundError:
        return "the GitHub command-line tool 'gh' is not installed, so the workflows cannot be checked"
    if done.returncode:
        return f"'gh run list' failed: {done.stderr.strip()}"
    newest: dict[str, dict] = {}
    for run in json.loads(done.stdout or "[]"):                      # newest first: keep the first run of each workflow
        newest.setdefault(run["name"], run)
    for name in REQUIRED_WORKFLOWS:
        run = newest.get(name)
        if run is None:
            return f"the workflow '{name}' has not run on commit {commit[:7]} (push the work branch and wait for it)"
        if run["status"] != "completed" or run["conclusion"] != "success":
            return f"the workflow '{name}' on commit {commit[:7]} is {run['status']}/{run['conclusion'] or 'no result yet'}"
    return None


def integrate(root: Path, summary: str, *, remote: str | None = "origin", ci_check: bool = True, push: bool = False, footer: str = "") -> dict:
    """Carry out the integration described in the module text. Returns the new commits. Raises ``Refused`` before changing anything."""
    branch = git(root, "rev-parse", "--abbrev-ref", "HEAD")
    if not branch.startswith("work/"):
        raise Refused(f"the current branch is '{branch}', not a work/... branch")
    if git(root, "status", "--porcelain"):
        raise Refused("the tree has uncommitted or untracked files (commit them, or remove what does not belong)")
    if not summary.strip():
        raise Refused("give --summary: one line that says what the version brings")
    if remote:
        git(root, "fetch", "--quiet", remote)
        if not succeeds(root, "fetch", "--quiet", remote, "master:master"):      # forward only: fails if the local master has its own commits
            raise Refused(f"the local master has commits that {remote}/master lacks (or cannot be updated): look at 'git log {remote}/master..master'")
    head, old_master = git(root, "rev-parse", "HEAD"), git(root, "rev-parse", "refs/heads/master")
    if not succeeds(root, "merge-base", "--is-ancestor", old_master, head):
        missing = git(root, "log", "--oneline", f"{head}..{old_master}")
        raise Refused("master has changes that the work branch does not contain (a pull request merged on GitHub?):\n" + missing
                      + f"\nBring them in first: 'git merge master' on {branch}, run the checks, push, wait for the workflows, then run this again.")
    if succeeds(root, "diff", "--quiet", old_master, head):
        raise Refused("the work branch has the same files as master: there is nothing to integrate")
    version = delivery(root)
    problem = changelog_problem(root, version)
    if problem:
        raise Refused(problem)
    if any(subject.startswith(f"{version}:") for subject in git(root, "log", "--format=%s", "-n", "200", old_master).splitlines()):
        raise Refused(f"master already has a commit '{version}: ...': set the next number in DELIVERY and run tools/sync_version.py")
    if ci_check:
        problem = workflows_problem(root, head)
        if problem:
            raise Refused(problem)

    message = [f"{version}: {summary.strip()}", f"Files identical to commit {head[:7]} of {branch}. Details in CHANGELOG.md."] + ([footer] if footer else [])
    git(root, "checkout", "--quiet", "master")
    try:
        git(root, "merge", "--squash", "--quiet", branch)
        git(root, "commit", "--quiet", *[part for text in message for part in ("-m", text)])
        if not succeeds(root, "diff", "--quiet", "HEAD", head):
            raise RuntimeError("the files of the new master commit differ from the work branch")
    except Exception:
        git(root, "reset", "--quiet", "--hard", old_master)                     # master back to where it was; the work branch was never touched
        git(root, "checkout", "--quiet", branch)
        raise
    new_master = git(root, "rev-parse", "HEAD")
    git(root, "checkout", "--quiet", branch)
    back = [f"Merge master ({version}) back into {branch}", "No file changes: it joins the histories so that the next version integrates without conflicts."]
    git(root, "merge", "--quiet", "--no-ff", "master", *[part for text in back + ([footer] if footer else []) for part in ("-m", text)])
    if not succeeds(root, "diff", "--quiet", "HEAD", head):
        raise RuntimeError(f"merging master back changed files on {branch}; look at 'git diff {head[:7]} HEAD' before pushing anything")
    if push and remote:
        git(root, "push", "--quiet", remote, "master", branch)
    return {"version": version, "branch": branch, "integrated": head, "master": new_master, "pushed": bool(push and remote)}


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__.split("\n\n", 1)[1])
    parser.add_argument("--summary", required=True, help="one line: what the version brings (it becomes 'V0.<n>: <summary>')")
    parser.add_argument("--push", action="store_true", help="push master and the work branch afterwards (no tag is ever created)")
    parser.add_argument("--footer", default="", help="a last paragraph for both commit messages, for example a Co-Authored-By line")
    parser.add_argument("--no-ci-check", action="store_true", help="do not ask GitHub for the workflow results (only when they were verified by other means; say so in the roadmap)")
    args = parser.parse_args(argv)
    result = integrate(ROOT, args.summary, ci_check=not args.no_ci_check, push=args.push, footer=args.footer)
    print(f"{result['version']} is on master ({result['master'][:7]}), with the files of {result['integrated'][:7]}; master was merged back into {result['branch']}.")
    print("Pushed." if result["pushed"] else f"Not pushed. When the maintainer asks: git push origin master {result['branch']}")


if __name__ == "__main__":
    try:
        main()
    except Refused as refusal:
        print(refusal, file=sys.stderr)
        sys.exit(1)
