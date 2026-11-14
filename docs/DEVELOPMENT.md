# Development guide

Commands to set up, run, test, package and measure SedCoreTool, and fixes for the problems that have already
cost time. Rules are in [AGENTS.md](../AGENTS.md); structure is in [ARCHITECTURE.md](ARCHITECTURE.md).

## 1. Set-up

```bash
pip install -e ".[dev]"                 # Python package with test dependencies (Python >= 3.10)
npm ci                                  # TypeScript for the type check (Node 22)
cd desktop && npm ci                    # Electron and electron-builder
```

`pytest` finds the package through `pythonpath = ["src"]`, so any Python with the test dependencies works without
an editable install. Do not reinstall dependencies if the environment works.

**Maintainer's Windows workstation** (verified 12 November 2026). A non-interactive shell may not have these on
PATH; call them by full path:

| Tool | Location |
|---|---|
| Python 3.12 with pytest, NumPy, pandas | `C:\Users\Santiago\anaconda3\python.exe` |
| Node 22 and npm | `C:\Program Files\nodejs` — in PowerShell: `$env:Path += ';C:\Program Files\nodejs'`, then use `npm.cmd` |
| Ruff | `.venv\review-tools\bin\ruff.exe` (`.venv/` holds caches and tools; it is not a virtual environment) |

In Git Bash, plain `python` may be a different interpreter without pytest. Use the full path above.

## 2. Run

```bash
python -m http.server 8765              # then open http://localhost:8765/app/  (browser version)
python tools/build_standalone.py        # offline file -> dist/SedCoreTool_V0.<n>.html (dist/ is ignored by Git)
cd desktop && npm start                 # desktop program from source, with the sample data
```

## 3. Checks

**During a session** run only what covers your change:

```bash
node --test tests/app/<file>.test.mjs               # one JavaScript test file
<python> -m pytest -q tests/<file>.py               # one Python test file
<ruff> check src tests tools                        # lint (fast)
npm run typecheck                                   # after changing JavaScript signatures
```

**End of session, once, one after another** (never in parallel: the engine tests have timing deadlines):

```bash
<python> -m pytest -q
npm test
npm run typecheck
<python> tools/sync_version.py --check
<ruff> check src tests tools
node tests/e2e/desktop.mjs                          # when desktop/, saving or the interface changed (see §6)
node tests/e2e/smoke.mjs                            # when the interface changed; needs the server of §2 and Chrome
```

The end-to-end tests need `npm i --no-save puppeteer-core@23` at the repository root. Record the result and the
commit in the [roadmap status](roadmap.md#status-and-handoff). Do not repeat the full run on an unchanged,
already verified commit.

## 4. The engine experiment and the bundled runtime

The engine process is off by default. To try it from source you need the bundled runtime, rebuilt from
`desktop/runtime-lock.json`. In PowerShell at the repository root:

```powershell
$env:Path += ';C:\Program Files\nodejs'
$env:SEDCORETOOL_BUILD_PYTHON = 'C:\Users\Santiago\anaconda3\python.exe'   # any Python 3.12 with pip (build time only)
Push-Location desktop
npm.cmd run prepare-runtime                 # downloads and verifies the pinned artifacts the first time
# when everything is already cached:  npm.cmd run prepare-runtime -- --offline
$env:SEDCORETOOL_ENGINE_EXPERIMENT = '1'
Remove-Item Env:SEDCORETOOL_ENGINE_PYTHON -ErrorAction SilentlyContinue
npm.cmd start
Pop-Location
```

In the program's developer console, `await window.corantoolDesktop.engine.status()` should report
`bundled-verified` and `ready`. Unset the variable and restart for the default path.

- **Prepare the runtime again after a version change or any change under `src/sedcoretool/`.** Its manifest
  records the application version and the hash of every source file; a stale bundle is rejected on purpose and
  the engine reports `unavailable`.
- Preparation runs `tools/check_engine_runtime.py` inside the new runtime (imports, a small analysis, image round
  trips). If you remove files from the runtime (`prune_runtime` in `tools/prepare_engine_runtime.py`) and that
  check fails, the files were needed.
- `desktop/runtime/`, `desktop/python/`, `desktop/web/`, `desktop/dist/` and `dist/` are generated and ignored by
  Git. Another checkout rebuilds them; never copy binaries between machines as a dependency source.

## 5. Packaging (Windows)

```powershell
$env:Path += ';C:\Program Files\nodejs'
$env:SEDCORETOOL_BUILD_PYTHON = 'C:\Users\Santiago\anaconda3\python.exe'
$env:SEDCORETOOL_RUNTIME_OFFLINE = '1'          # use the cached runtime artifacts
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'      # unsigned build
Push-Location desktop; npm.cmd run dist; Pop-Location     # about 5 minutes
```

Output in `desktop/dist/`: `SedCoreTool-V0.<n>-windows-setup.exe` (installer), `…-windows-portable.zip` (program
folder; extract with "Extract all") and `win-unpacked/`. `node desktop/scripts/check-package.js` checks the
packaged resources. macOS and Linux packages are built by the *Desktop builds* GitHub workflow.

## 6. Problems already met

| Symptom | Cause and fix |
|---|---|
| `tests/e2e/desktop.mjs` waits 90 s and fails after clicking `openTest` | `npm run dist` rebuilt `desktop/web` **without** sample data. Run `node desktop/scripts/prepare.js --with-examples` (what `npm start` does), then repeat the test |
| Engine state `unavailable` right after editing Python or changing the version | The runtime manifest no longer matches. Run `npm run prepare-runtime -- --offline` in `desktop/` |
| `No module named pytest` | The shell picked another Python. Use the full path in §1 |
| `npm` is blocked by the PowerShell execution policy | Use `npm.cmd` |
| Engine tests time out when several suites run at once | CPU contention, measured in M8.2.3. Run suites one after another |
| A commit message starts with a strange character, or Git treats the message as file names | Write the message to a file **without BOM** and use `git commit -F <file>`; do not pipe a PowerShell here-string into `git commit -F -` |
| A measurement leaves `SedCoreTool.exe` or `python.exe` running | Close them before the next run: stale processes change timings and lock folders |
| Timings jump between runs | Something else is using the disk or CPU. Measure with the computer otherwise idle and say so in the evidence |

## 7. Measuring tools

Each writes a JSON report with `--out <file>`; store accepted evidence under `docs/validation/` and cite it from
the roadmap. State in the report what was **not** measured.

| Tool | Measures |
|---|---|
| `tools/measure_engine_lifecycle.mjs` | Runtime verification, engine ready, orderly stop, forced kill, leftovers; optional CPU load (`--load N`) |
| `tools/measure_engine_cancellation.mjs` | Buffer upload speed, cancellation latency (running and queued jobs), engine memory |
| `tools/measure_packaged_startup.mjs <exe>` | Packaged program: time to window and to engine ready, close, leftover processes, process-tree memory and idle CPU. `--keep-profile` reuses one user-data folder (verification record present after the first launch); `--wait-ms` shortens the failure timeout |
| `tools/measure_engine_analysis.mjs` | The gates of contract §7 for an engine method run from the desktop program: parity, matched timing, stages per section, responsiveness, cancellation, process-tree memory (through `tools/process_tree_sampler.py`, needs `psutil`), ten open/analyse/close cycles, worker and coordinator kills |
| `tools/benchmark*.py`, `tools/benchmark*.mjs` | Earlier performance baselines (see `docs/benchmarks/*.md` for how each was run) |

## 8. Versions, CI and releases

- A version is created only when the maintainer asks: [AGENTS.md §5](../AGENTS.md#5-delivering-a-change).
  `python tools/sync_version.py` copies the number from `DELIVERY` in `app/js/app.js` to the other files; rebuild
  the runtime afterwards (§4).
- `.github/workflows/tests.yml` runs the test suites on pushes and pull requests; `.github/workflows/desktop.yml`
  builds Windows, macOS and Linux packages on a version tag or on a manual run. A manual run with
  `draft_release=false` produces artifacts without a release. Never push a tag only to get a build: tags publish.
- **Milestone gate** ([AGENTS.md §6](../AGENTS.md#6-working-on-a-task)): push the work branch, then start *Desktop
  builds* by hand on that branch (GitHub web page: Actions → Desktop builds → Run workflow → branch → `draft_release`
  off; the `gh` command is not installed on the maintainer's computer). It prepares the bundled runtime, runs
  `tests/e2e/desktop.mjs` with the engine experiment on (and off once card M8.3.9 adds that step), packages and
  checks the package on Windows, macOS
  (Apple Silicon runner) and Linux. The `tests` workflow must pass on the same commit. Results can be read without
  logging in: `GET https://api.github.com/repos/SantiCa/SedCoreTool/actions/runs/<run id>/jobs` and, for a failed
  job, `GET .../check-runs/<job id>/annotations` (60 unauthenticated requests per hour). Record the run id, commit
  and per-system result in the roadmap status.
- `tools/release.sh` checks branch, clean tree, versions and tests, then pushes the tag. Only the owner decides to
  push, release or request a DOI.
