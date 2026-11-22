#!/usr/bin/env bash
# V0.40: publish a delivery as a GitHub Release (desktop builds + Zenodo DOI if the repository is linked to Zenodo).
# Usage: tools/release.sh            (uses DELIVERY from app/js/app.js, e.g. V0.40)
# Checks: on master, clean tree, synced with origin, versions consistent, tests pass, tag not used yet.
# Then creates the annotated tag V0.<n> with the CHANGELOG entry and pushes it; .github/workflows/desktop.yml builds
# Windows/macOS/Linux and creates the Release.
set -euo pipefail
cd "$(dirname "$0")/.."
V=$(sed -n "s/^\(export \)\{0,1\}const DELIVERY = '\(V[0-9.]*\)';.*/\2/p" app/js/app.js)   # V0.152: DELIVERY became an export
[ -n "$V" ] || { echo "DELIVERY not found"; exit 1; }
[ "$(git rev-parse --abbrev-ref HEAD)" = master ] || { echo "not on master"; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "uncommitted changes"; exit 1; }
git fetch -q origin master
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/master)" ] || { echo "master differs from origin/master: push or pull first"; exit 1; }
git rev-parse -q --verify "refs/tags/$V" >/dev/null && { echo "tag $V already exists"; exit 1; }
${PYTHON:-python3} tools/sync_version.py --check
npm test >/dev/null
PYTHONPATH=src ${PYTHON:-python3} -m pytest -q >/dev/null   # PYTHON: an interpreter with the dev extras (e.g. "py -3.12" on Windows)
NOTES=$(awk -v v="## $V " 'index($0, v) == 1 {on = 1; next} /^## / {on = 0} on' CHANGELOG.md)
git tag -a "$V" -m "SedCoreTool $V" -m "${NOTES:-See CHANGELOG.md}"
git push origin "$V"
echo "Tag $V pushed: the 'Desktop builds' workflow will create the Release."
