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
node tests/e2e/large-16bit-desktop.mjs              # when image decoding or the memory of sections changed (card H7)
```

The end-to-end tests that start the desktop program (`desktop.mjs`, `large-16bit-desktop.mjs`, `tiled-sections.mjs`, `working-memory-desktop.mjs`) first check, in under a second (`tests/e2e/preflight.mjs`), that `desktop/web` and `desktop/python` hold the current `app/` and `src/` and that the engine runtime's recorded sources match `src/`; if not, they stop and print the command that fixes it (`node desktop/scripts/prepare.js --with-examples`, `npm run prepare-runtime -- --offline` in `desktop/`).
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
| Engine state `unavailable` right after editing Python or changing the version | The runtime manifest no longer matches. Run `npm run prepare-runtime -- --offline` in `desktop/` (the desktop tests now say this before starting) |
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
| `tools/measure_engine_analysis.mjs` | The gates of contract §7 for an engine method run from the desktop program: parity, matched timing, stages per section, responsiveness, cancellation, process-tree memory (through `tools/process_tree_sampler.py`, needs `psutil`), ten open/analyse/close cycles, worker and coordinator kills. `--only scenarios` runs the three warm scenarios (interval change, edit/undo/redo, unchanged) flag off against flag on in alternating fresh processes and writes a pass/fail verdict per scenario and for the memory peak (rules in `tools/engine_gates.mjs`, tested by `tests/app/engine-gates.test.mjs`); `--synthetic <package>` adds the eight-section project of `tools/benchmark.py::make_synthetic` |
| `tools/measure_interval_table.py` | In-process time to turn remembered row counts into the interval table for a section of any height (default 349,526 rows); card M8.4.12 |
| `tools/make_large_fixtures.py FOLDER [--only ...] [--verify]` | Writes deterministic 2-8 GiB TIFF/BigTIFF images and a JPEG to a folder outside the repository (20-30 GiB for the set); `--verify` reads 20 sampled regions of each TIFF with the program's own reader (`tools/verify_large_fixtures.mjs`) and compares them with the generator's pixel function; card M8.4.13 |
| `<python> tools/integrate_version.py --summary TEXT [--push]` | Integrates the work branch into `master` as one version commit after checking that nothing would be lost (see §8); never creates a tag |
| `<python> tools/measure_tile_store.py FIXTURES --pyramids FOLDER --out FILE --phase compression\|full\|cancel [--compressor none\|zlib] [--only ...]` | Builds pixel pyramids of the M8.4.13 fixtures through the engine's coordinator (in-process) and its method worker: build time, memory, progress, cancellation, tile reads and exactness against the generator; `--pyramids` must be outside the repository; card M8.4.14 |
| `node tools/measure_tile_delivery.mjs FILE.tif --out FILE` | Windows. Runs the desktop program with tiled sections on, builds the pyramid of FILE from the page and times tile reads through the engine and through the main process's own reader; card M8.4.15 step 1 |
| `node tools/measure_large_tables.mjs --chrome PATH --out FILE [--rows 20000,100000] [--reps 3] [--parts table,figures] [--merge] [--profile-first-open]` | Opens the real application from a local static server in headless Chrome and measures the Data table (native and visible-rows rendering), the depth plot, the cross-plot and the multiproxy log on the deterministic M2.1 fixture; needs `puppeteer-core`; card M2.1.4 |
| `node tools/measure_large_images.mjs FOLDER --out FILE [--only ...] [--original NAME]` | Windows only. Imports each generated image into a fresh desktop program, engine off and on, and records outcome, working size, time to first frame, process-tree memory peak, pan/zoom/stroke frame times and the interval-table time; needs `puppeteer-core` and `desktop/scripts/prepare.js --with-examples`; card M8.4.13 |
| `tools/benchmark*.py`, `tools/benchmark*.mjs` | Earlier performance baselines (see `docs/benchmarks/*.md` for how each was run) |

## 8. Versions, CI and releases

- A version is created only when the maintainer asks: [AGENTS.md §5](../AGENTS.md#5-delivering-a-change).
  `python tools/sync_version.py` copies the number from `DELIVERY` in `app/js/app.js` to the other files; rebuild
  the runtime afterwards (§4).
- **Integrating a version into `master`** is one command, run on the work branch after the version commit passed
  the full checks, was pushed, and `tests` and *Desktop builds* succeeded on it:

  ```bash
  <python> tools/integrate_version.py --summary "what the version brings" --push
  ```

  It makes one commit `V0.<n>: <summary>` on `master` with exactly the files of the work branch, merges `master`
  back into the work branch (no file changes: it keeps the histories joined, so the next integration cannot
  conflict) and pushes both. It never creates a tag. It refuses, changing nothing, when: the tree is not clean; the
  branch is not `work/...`; the local `master` differs from `origin/master`; **`master` has changes that the branch
  lacks**; the changelog still has `## Unreleased` or lacks the `## V0.<n>` heading; `master` already has that
  version; or a workflow did not succeed on the commit (`--no-ci-check` skips only this last check, for a machine
  without `gh`; write in the roadmap how the result was verified).
- **If it says that `master` has changes the branch lacks**, somebody merged a pull request on GitHub (for example
  one of Dependabot). Nothing is lost: on the work branch run `git merge master`, resolve any conflict, run the
  checks, push, wait for the workflows and run the tool again. Never copy the files of the branch over `master` by
  hand (`git read-tree`, `git reset`): that erases what was merged there.
- `.github/workflows/tests.yml` runs the test suites on pushes and pull requests; `.github/workflows/desktop.yml`
  builds Windows, macOS and Linux packages on every push of a `work/**` branch (build and test only), on a version
  tag, or on a manual run. A manual run with `draft_release=false` produces artifacts without a release. Never push
  a tag only to get a build: tags publish.
- **Milestone gate** ([AGENTS.md §6](../AGENTS.md#6-working-on-a-task)): push the work branch; *Desktop builds* starts
  by itself (a newer push cancels the older run of the same branch; it can also be started by hand from Actions →
  Desktop builds → Run workflow, `draft_release` off). It prepares the bundled runtime, runs `tests/e2e/desktop.mjs`
  with the engine experiment off and on and `tests/e2e/large-16bit-desktop.mjs`, packages and checks the package on Windows, macOS (Apple Silicon runner)
  and Linux; the later steps run even when an earlier one failed, so one run reports every failure. The `tests`
  workflow must pass on the same commit. Results can be read without
  logging in: `GET https://api.github.com/repos/SantiCa/SedCoreTool/actions/runs/<run id>/jobs` and, for a failed
  job, `GET .../check-runs/<job id>/annotations` (60 unauthenticated requests per hour). Record the run id, commit
  and per-system result in the roadmap status.
- `tools/release.sh` checks branch, clean tree, versions and tests, then pushes the tag. Only the owner decides to
  push, release or request a DOI.
