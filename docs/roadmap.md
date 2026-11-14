# Roadmap

The current state, the next task cards and the decisions waiting for the maintainer. Working rules are in
[AGENTS.md](../AGENTS.md); the structure that the cards build is in [ARCHITECTURE.md](ARCHITECTURE.md); commands
are in [DEVELOPMENT.md](DEVELOPMENT.md). Later milestones and ideas: [roadmap-future.md](roadmap-future.md).
Finished tasks: [roadmap-history.md](roadmap-history.md).

**How to use it.** Read *Status and handoff*. Do the first step listed there. A task is described by a card
([format and roles: AGENTS.md §6](../AGENTS.md#6-working-on-a-task)); carry out one card at a time, in order, and
only when the maintainer has authorised it. When you stop, update the status block so that a new session can
continue from this file alone. When a card is done, link its changelog entry, move its long record to the history
file and leave one line here.

## Status and handoff

Updated 14 November 2026.

- **Released version:** V0.150 (14 November 2026), integrated into `master` on the maintainer's instruction ("haz commit y push de todo a
  master con una nueva version 0.150"). **No tag and no GitHub Release exist for V0.149 or V0.150**: a tag publishes a Release and is the
  owner's decision. The *Desktop builds* workflow is started by hand for the macOS and Linux builds (see the release checklist).
- **Active work branch:** `work/2026-11-13` (pushed), which `master` now contains. Changes after V0.150 accumulate under `## Unreleased`.
- **Checks:** see the last line of this block; it is rewritten at the end of every session.
- **Where we are:** M8.1 and M8.2 are done at the development gate (Windows). M8.3 is complete: with `SEDCORETOOL_ENGINE_EXPERIMENT=1` the
  desktop program calculates the interval table of every section in the Python engine and shows it, with a pending state, stale-result
  rejection, cancellation and an error state, never falling back to JavaScript. The measurements of card M8.3.8 are recorded in
  [docs/validation/M8.3.8-engine-analysis-summary.md](validation/M8.3.8-engine-analysis-summary.md).
- **Next step:** the maintainer's decision recorded under card M8.3.8: continue to M8.4, or correct first. Recommended: correct first
  (a persistent worker process, cheaper transfer of the label image, a memory sampler at the contract's 25 ms cadence, then re-measure
  the ten-cycle memory gate, which failed by +110 MiB). Also open: card H5 (the `e2e` job on Linux).
- **Reminder for whoever talks to the maintainer:** the maintainer accepted the two acceptance levels on
  13 November 2026 and asked to be **reminded to run the release-gate tests** (the release checklist below:
  macOS and Linux, clean Windows machine, cold-cache first launch, saturated CPUs, package sizes, and the
  numerical/timing/memory/recovery gates). Remind him when a milestone of M8 finishes and before any flag is
  switched on by default or a version with the engine is announced.
- **Decisions waiting for the maintainer:** only the flags in the table below that need a promote/remove decision.
  Decided on 13 November 2026: acceptance levels (accepted), scope of 1.0 (below), publication of V0.149.
- **Last full checks: passed** on 14 November 2026 at the V0.150 state, run one after another on the maintainer's Windows computer:
  `pytest -q` 594 passed / 8 skipped; `npm test` 295 passed; `npm run typecheck` (no new diagnostics); `sync_version.py --check`;
  `ruff check src tests tools`; standalone build; `tests/e2e/desktop.mjs` with the engine experiment on (six sections equal to the JavaScript
  reference before and after an edit) and off, bundled runtime rebuilt first (`prepare.js`, then `prepare_engine_runtime.py`). The
  measurements of card M8.3.8 are separate evidence. **GitHub workflow `tests`** on the commit before V0.150: all Python jobs, `checks` and
  `web-app` pass; the `e2e` job still fails on the Linux navigation-preview check (card H5).

## How work is accepted

Adopted on 12 November 2026 when the maintainer asked for this restructuring; it replaces the earlier rule that
every platform and performance gate had to pass before the next task could start.

| Level | Needed for | What must be true |
|---|---|---|
| **Development gate** | Starting the next card | The card's "Done when" holds; its tests and the session checks pass on the maintainer's Windows workstation; anything unfinished is behind a flag that is off by default; evidence states what was not measured. |
| **Release gate** | Switching a flag on by default, or publishing a version to users | Everything in the [release checklist](#release-checklist): all supported platforms, clean machines, and the numerical, timing, memory and recovery gates of [contract §7](roadmap-engine-contract.md#7-predeclared-verification-and-performance-gates). |

Never report the release gate as met from development evidence. A failed gate is recorded with its measurement;
it is not hidden, and limits are not relaxed to pass it.

### Flags

Every experimental switch, with the decision it is waiting for ([policy: ARCHITECTURE §5.3](ARCHITECTURE.md#53-add-promote-or-remove-an-experimental-flag)).

| Flag | Owner | How it is switched | Default | Waiting for |
|---|---|---|---|---|
| Engine experiment | M8 | environment variable `SEDCORETOOL_ENGINE_EXPERIMENT=1` | off | Removed at M8.6 after the release gate |
| NumPy multi-row counting in the Python API | M3.1.5 / M3.1.6 / M8.3.3 | environment variable `SEDCORETOOL_EXPERIMENTAL_COUNTS=1` | no effect: the multi-row kernel is the only implementation since M8.3.3 | Maintainer: remove the variable and its tests/benchmark in a cleanup |
| Navigation preview rollback | M2.2.4 | session control in the Sections panel | preview on | Maintainer: remove the rollback control, or keep it until more memory evidence exists |
| Visible-row table rendering | M2.1.3 | session-only checkbox in the Data table | off | Maintainer: promote to default or remove |
| Desktop operating diagnostics | M1.2.3 | opt-in control in the desktop program | off | Removed after the hang diagnosis of M1.2.2 is accepted |

## Scope of version 1.0

Decided by the maintainer on 13 November 2026.

- **In:** M8 complete (one scientific engine; desktop packages for Windows, macOS and Linux passing the release
  gate); **advanced statistics (M6.1–M6.6)** and **radiographs (M7.1–M7.4)**, both built on the engine and its
  image/data services (so after M8.4); M5.1 compatibility and reproducibility; M5.2 scientific validation and
  documentation, including a comparison with expert estimates on real cores; software paper and archived release (DOI).
- **Not required:** optional acceleration (M4), a new interface shell (M9), multi-gigabyte images beyond what M8.4
  and M7 need (M2.3 as a whole).
- **Consequence for the order:** after M8.6 the next milestones are M6 and M7, in that order unless the
  maintainer changes it; their cards are written by a design session when M8.4 has passed its development gate,
  because they use the engine's image and data services.

## Active priority: desktop and one scientific engine

Direction approved by the maintainer on 12 November 2026; the design, its rules and the recorded decisions are in
[ARCHITECTURE.md](ARCHITECTURE.md). In one sentence: every scientific method is implemented once in Python and
runs in a local engine process; the Electron/JavaScript interface requests and shows results; the Python API and
command line call the same code directly.

| Order | Milestone | State |
|---|---|---|
| 1 | M8.1 Inventory and engine contract | done ([V0.141](../CHANGELOG.md#v0141--2026-11-12)) |
| 2 | M8.2 Engine process, bundled runtime, packaging | done at the development gate; release items in the checklist |
| 3 | **M8.3 First scientific slice: section intervals** | **next: cards below** |
| 4 | M8.4 Engine-owned images and large files (includes M2.3) | cards written when M8.3 passes its development gate |
| 5 | M8.5 Remaining methods, one slice at a time | idem |
| 6 | M8.6 Release gate, default-on, duplicate JavaScript science removed, HTML version frozen | idem |
| 7 | Statistics (M6) and radiographs (M7), both **required for 1.0**; then validation and publication | [roadmap-future.md](roadmap-future.md) |
| 8 | Conditional: acceleration (M4), interface shell (M9) | [roadmap-future.md](roadmap-future.md) |

### Cross-cutting objective: modularity and reviewability

Requested by the maintainer on 12 November 2026: the program must be modular, easy to understand and easy to
edit, so that a change needs little reading and few review rounds. It is applied through the layer rules of
[ARCHITECTURE §3](ARCHITECTURE.md#3-layers-and-dependency-rules), the recipe for moving a workflow out of
`app.js` (§5.2) and the "Read first / Change / Do not touch" fields of every card. It does not start a
whole-program refactor: each M8 slice moves the workflow it touches.

## M8 - Desktop simplification and a single scientific engine

- [x] **M8.1 - Engine inventory and migration contract.** [V0.141](../CHANGELOG.md#v0141--2026-11-12) ·
      [contract](roadmap-engine-contract.md) · [record](roadmap-history.md#m8---completed-engine-migration-tasks)
- [x] **M8.2 - Local engine process and reproducible packaging** (development gate, Windows).
  - [x] M8.2.1 Process and transport — [V0.142](../CHANGELOG.md#v0142--2026-11-12)
  - [x] M8.2.2 Bundled runtime — [V0.143](../CHANGELOG.md#v0143--2026-11-12)
  - [x] M8.2.3 Windows packaging and lifecycle — [V0.149](../CHANGELOG.md#v0149--2026-11-13), [record](roadmap-history.md#m823---packaging-and-lifecycle-acceptance-windows)
  - [x] M8.2.4 Follow-up of 12 November 2026 — [V0.149](../CHANGELOG.md#v0149--2026-11-13), [record](roadmap-history.md#m824---follow-up-of-the-windows-acceptance)
  - Numbers to remember (Windows 11, Ryzen 7 7700X): window visible 0.45 s; engine ready 0.7–0.8 s with the
    verification record, 1.5–2.0 s with a full verification, 3.7–3.9 s on the first launch after extracting the
    ZIP; forced stop 5 ms; idle process tree 5 processes, about 310–410 MiB summed working set.

### Release checklist

What the development gate does **not** cover. All of it must hold before M8.6 switches the engine on by default
or a version with the engine is published. Tick an item only with recorded evidence.

- [ ] macOS (Intel, Apple Silicon, universal disk image) and Linux (AppImage, DEB): runtime preparation, native
      smoke check, packaged start-up and close. Needs those machines or a run of the *Desktop builds* workflow
      (requires pushing; maintainer's decision).
- [ ] Clean Windows machine (no Python, no Node) and at least one other antivirus configuration.
- [ ] First launch with a cold disk cache (after a reboot) against the 5 s engine-ready gate. Measured so far:
      3.7–3.9 s right after extraction; 11–25 s before the runtime was pruned. Measure once after the next reboot
      with `tools/measure_packaged_startup.mjs <exe> --runs 1`.
- [ ] Whole-process memory, timing, responsiveness, cancellation and recovery gates of contract §7 on the first
      scientific slice (measured in card M8.3.8).
- [ ] Engine start-up with all CPUs saturated: runtime verification took 16 s median before pruning and the
      verification record; repeat `tools/measure_engine_lifecycle.mjs --load 16`.
- [ ] Installer and portable sizes recorded for every platform.

### M8.3 - First scientific slice: section intervals

**Outcome.** With the experiment on, the interval percentages, per-class percentages, BI and ii of a section are
computed by the engine method `section.intervals/1` and shown by the existing interface; with it off, nothing
changes. Inputs and results are defined in [contract §4–§5](roadmap-engine-contract.md#4-scientific-input-contract-sectionintervals1);
the path of a request is [ARCHITECTURE §4](ARCHITECTURE.md#4-path-of-one-scientific-request-target-design-for-m83).
Cards are done in order. Each one claims the development gate only.

#### M8.3.1 - Move the section analysis out of `app.js` — state: Done (12 Nov 2026, [V0.149](../CHANGELOG.md#v0149--2026-11-13))

- **Goal:** the calculation that fills `s.bins` lives in a pure module that Node can test. No behaviour changes.
- **Read first:** [ARCHITECTURE §3.2 and §5.2](ARCHITECTURE.md#32-renderer-appjs); `app/js/app.js` functions
  `effClassId`, `effClassArray`, `analyze`, `binRowsOf`, `manualAt` (search by name; about 45 lines in total);
  `app/js/core.js` functions `rowCounts`, `binRows`, `interpAge`, `interpAgeRange`; `app/js/sectiondepth.js` and
  `tests/app/sectiondepth.test.mjs` as the model of an earlier extraction.
- **Change:** create `app/js/sectionanalysis.js` and `tests/app/sectionanalysis.test.mjs`; edit `app/js/app.js`
  (the five functions become one-line wrappers that pass `S` in), `tools/build_standalone.py` (`ORDER`, after
  `sectiondepth.js`), the source map in `docs/TECHNICAL_DOCUMENTATION.md` §1.4, `CHANGELOG.md` (Internal).
- **Do not touch:** any formula, default, rounding or order of operations; `core.js`; the callers of `analyze`;
  the shape of `S`, of `s.bins` or of saved projects.
- **Steps:**
  1. In the new module write `effectiveClassId(object, settings)`, `effectiveClassIndex(section, classes, settings)`
     and `computeSectionBins(section, project)` where `project = { classes, settings, ageModel }`. Move the bodies
     as they are; replace every read of `S` by a parameter. `computeSectionBins` returns `{ bins, rowCache }`; it
     reuses `section._rc` when its key matches, exactly as today.
  2. Turn the `app.js` functions into wrappers; `analyze(s)` assigns `s.bins` and `s._rc` from the result.
  3. Add the module to `ORDER` and to the source map.
  4. Tests in Node on a small hand-built section: assigned, predicted (above and below the threshold) and candidate
     objects; a class that does not count; an overlap stack with the same and with different classes; excluded
     pixels; a ROI that does not start at 0; `minValid` exactly at the limit; no-data padding; two overlapping
     manual ranges (the last one wins); ages inside and outside the model. Compute the expected values by hand in
     the test, with a comment for each.
- **Tests:** `node --test tests/app/sectionanalysis.test.mjs`; `npm test`; `npm run typecheck`;
  `python tools/build_standalone.py`; browser smoke test `node tests/e2e/smoke.mjs` (results of the public example
  unchanged).
- **Done when:** `app.js` no longer contains the calculation; all commands above pass.
- **Result (12 November 2026):** `app/js/sectionanalysis.js` exports `effectiveClassId(object, settings)`,
  `effectiveClassIndex(section, classes, settings)`, `binRowsOfSection(section, settings)`, `manualRangeAt(section, depth)`
  and `computeSectionBins(section, { classes, settings, ageModel })`, which returns `{ bins, rowCache }` and does not
  assign to the section. `app.js` keeps `effClassId`, `effClassArray`, `binRowsOf` and `analyze` as thin wrappers;
  `manualAt` had no other caller and was removed. 12 tests in `tests/app/sectionanalysis.test.mjs`, including a
  comparison with a literal copy of the previous calculation on 40 seeded sections; three deliberately introduced
  faults were each caught. The module is in the strict type check. Later cards should use these names.

#### M8.3.2 - Reference fixtures for `section.intervals/1` — state: Done (13 Nov 2026, branch `work/2026-11-13`)

- **Goal:** small committed fixtures, each holding the inputs of contract §4 and the results of contract §5,
  produced by the JavaScript calculation. They are the target every later card must reproduce.
- **Read first:** contract §4, §5 and the "Required inputs" row of §7; `app/js/sectionanalysis.js`;
  `tests/fixtures/fractional-boundaries.json`.
- **Change:** add `buildIntervalSnapshot(section, project)` and `referenceColumns(section, project)` to
  `app/js/sectionanalysis.js`; create `tools/make_interval_fixtures.mjs`, `tests/fixtures/section-intervals/*.json`,
  `tests/app/interval-fixtures.test.mjs`.
- **Do not touch:** the calculation moved in M8.3.1; the contract's names, dtypes and units (if one cannot be
  produced, stop and report: the contract is amended by a design session, not silently).
- **Steps:**
  1. `buildIntervalSnapshot` returns the eight inputs with the contract's exact names: `labels`, `exclude`,
     `objects`, `classes`, `stack_offsets`, `stack_members`, `settings`, `age_model`, `manual_indices`. It copies
     data; it does not compute effective classes.
  2. `referenceColumns` returns every output column of §5, including `valid_pct`, the raw counts and each
     `<name>_valid` column, from `rowCounts` and the bins.
  3. The tool builds synthetic sections (seeded, no files read) for: the cases listed in M8.3.1 step 4; units mm,
     cm and m; a section with no valid pixels; the 20 fractional-boundary cases; a section of about 600 × 2,000
     pixels with a few hundred objects. One JSON file per case: `{ name, inputs, expected }`, arrays as lists with
     `dtype` and `shape`. Keep the folder under 2 MB.
  4. The Node test regenerates every fixture in memory and requires byte-identical content to the committed file.
- **Tests:** `node --test tests/app/interval-fixtures.test.mjs`; `npm test`; `npm run typecheck`.
- **Done when:** fixtures are committed and the regeneration test passes.
- **Result (13 November 2026):** 40 fixtures (four more were added in M8.3.4: 44), 1.2 MB, in `tests/fixtures/section-intervals/` (format, groups and the choices made
  where the contract is silent are in its README); generator `tools/make_interval_fixtures.mjs` (`--check` compares without
  writing); `buildIntervalSnapshot` and `referenceColumns` in `sectionanalysis.js`; 6 tests in
  `tests/app/interval-fixtures.test.mjs`. The large images are stored as run-length lists because 1.2 million labels as
  plain lists would be about 5 MB. A deliberately changed bin-edge rounding in `core.js` was caught and reverted. No change to
  the contract was needed. Card M8.3.4 reads the files with a few lines of Python: expand `runs`, reshape by `shape`,
  compare as the README says.

#### M8.3.3 - Python kernels — state: Done (13 Nov 2026, branch `work/2026-11-13`)

- **Goal:** the primitives of interval analysis exist once, in `src/sedcoretool/kernels/`, and the public Python
  functions use them.
- **Read first:** [ARCHITECTURE §3.1](ARCHITECTURE.md#31-python-srcsedcoretool); `src/sedcoretool/pipeline.py`,
  `indices.py`, `depth.py`; `app/js/core.js` (`rowCounts`, `binRows`, `classify`, `interpAge`, `interpAgeRange`);
  contract §4, the paragraphs after the input table.
- **Change:** create `kernels/__init__.py`, `kernels/binning.py` (pixels per centimetre, interval size in rows,
  half-up edges, sums per interval), `kernels/counting.py` (valid, bioturbated and per-class counts per row from
  a label image, an object→class table, CSR overlap stacks, an exclusion mask and a ROI; and from class layers),
  `kernels/classification.py` (tier classification with `precedence="first" | "last"`), `kernels/ages.py`
  (central age and range at a depth, missing outside the model); `tests/test_kernels.py`,
  `tests/test_architecture.py`; edit `pipeline.py`, `indices.py`, `depth.py` to delegate.
- **Do not touch:** public signatures, DataFrame columns, error messages and results of the Python API and CLI;
  `engine/`; JavaScript.
- **Steps:**
  1. Write the kernels. Counting works in bounded blocks of rows and must not allocate a classes × height × width
     array. An overlap pixel counts once in the total if any counted object covers it and once for each distinct
     counted class.
  2. Make the public functions call them. Both counting paths of `pipeline.py` (default and
     `SEDCORETOOL_EXPERIMENTAL_COUNTS=1`) must give identical results through the kernel; then keep one
     implementation, record the measured choice under M3.1.6 in [roadmap-future.md](roadmap-future.md), and tell
     the maintainer the flag can be removed.
  3. `tests/test_architecture.py` parses imports with `ast` and enforces the table of ARCHITECTURE §3.1.
- **Tests:** `pytest -q tests/test_kernels.py tests/test_architecture.py`; then the whole `pytest -q` with no
  existing test modified.
- **Done when:** all Python tests pass unchanged, including the regression against `legacy/`.
- **Result (13 November 2026):** `src/sedcoretool/kernels/` with `binning` (`unit_factor`, `pixels_per_cm`, `interval_rows`,
  `bin_edge`, `bin_edges`, `sum_by_interval`, `enough_valid`, `percentage`), `counting` (`label_row_counts` for class masks,
  `layer_row_counts` for boolean layers, `object_row_counts` for object labels with an object-to-class table and CSR overlap
  stacks, returning `RowCounts(valid, bio, cls)`), `classification` (`TierTable`, `classify_tiers`, precedence `"first"` or
  `"last"`) and `ages` (`interpolate_age`). `pipeline.py`, `indices.py` and `depth.py` delegate; no public signature or
  private name used by tests changed, and the 357 earlier Python tests pass untouched. 86 new tests: kernels against slow
  reference loops, against the 20 shared fractional cases and against all JavaScript reference fixtures (40 at the time, 44 now) (counts, intervals
  and bounds exactly; percentages, depths and ages within 1e-9; indices and missing patterns exactly), and the
  import-rule test. Eight deliberate faults were each caught. Things the method (M8.3.4) still has to add: no-data padding,
  manual indices, the effective-class rule (`tests/section_fixtures.py::class_of_object` is a test-only copy), validation of
  the snapshot, and the clamp of the interval to at least one row.
- **Decision recorded here (flag `SEDCORETOOL_EXPERIMENTAL_COUNTS`):** the bounded multi-row histogram became the only
  counting implementation. On the 6400 × 960 reference mask (3 classes, 5 % excluded; median of 7) an analysis took 32 ms
  (was 40 ms by default and 33 ms with the flag) and allocated 12.2 MiB (was 17.7 MiB by default, 12.1 MiB with the flag),
  with identical results. The variable is still accepted and ignored so that existing scripts and the four older tests
  keep working; the maintainer may remove it, and tests/test_count_experiment.py and tools/benchmark_counts.py with it, in a
  later cleanup.

#### M8.3.4 - Method `section.intervals/1`, called directly — state: Done (13 Nov 2026, branch `work/2026-11-13`)

- **Goal:** `src/sedcoretool/methods/section_intervals.py` reproduces every fixture of M8.3.2.
- **Read first:** contract §4 and §5 (complete); ARCHITECTURE §3.1 and §5.1; the fixtures.
- **Change:** create `methods/__init__.py`, `methods/errors.py` (`MethodError(code, field)` with the contract's
  codes), `methods/registry.py`, `methods/section_intervals.py`, `tests/test_section_intervals.py`.
- **Do not touch:** kernels' behaviour (add parameters only if a fixture needs them, with a kernel test);
  `analyze_mask` and the rest of the public API.
- **Steps:**
  1. `parse(inputs)` validates everything in §4 before computing: shapes and dtypes, ROI inside the image,
     `exclude` only 0/1, unique positive object IDs, class references that exist, stack offsets monotonic with no
     dangling or duplicate members, finite numbers, units, positive interval, thresholds in [0, 1]. Each failure
     raises `MethodError` naming the field. Nothing is repaired or dropped silently.
  2. `run(snapshot, report, cancelled)` follows the order of §4: effective class of each object → counts → interval
     sums → percentages with the minimum-valid rule → no-data padding → indices → ages → manual indices. It calls
     `cancelled()` between row blocks and returns the columns of §5 with their `_valid` columns.
  3. The test runs every fixture: exact equality for row bounds, counts, indices, `no_data` and every `_valid`
     column; absolute error ≤ 1e-9 for depths, percentages and ages. Add one failing-input test per validation rule.
- **Tests:** `pytest -q tests/test_section_intervals.py tests/test_architecture.py`.
- **Done when:** every fixture passes without changing a fixture or a tolerance.
- **Result (13 November 2026):** `src/sedcoretool/methods/` with `errors.py` (`MethodError(code, field)`, `Cancelled`), `validation.py`
  (closed-field checks), `registry.py` (`METHODS`, `get(name)`; unknown name → `UNSUPPORTED_METHOD`) and `section_intervals.py`
  (`NAME`, `parse(inputs) -> Snapshot`, `run(snapshot, report, cancelled) -> Result(dimensions, columns)`; columns are NumPy arrays of
  the contract's dtypes with `<name>_valid` arrays). All 44 fixtures reproduce (exact counts, bounds, indices, no-data and validity
  patterns; floats within 1e-9); 59 rejection cases name the field at fault; cancellation is polled every 256 rows; inputs are never
  modified. Mutation testing of twelve behaviours first left four uncovered; four fixtures were added to the generator (the fixture
  set is now 44) and a direct test of exact-equality padding comparisons, after which all twelve are caught. Three narrowings of the
  contract (non-negative tier values, strictly increasing age depths, ranges on all age records or none) are written into the contract.
  The worker (M8.3.5) loads this module through `registry.get`, calls `parse` then `run`, and writes `Result.columns` to buffers.

#### M8.3.5 - The engine process runs registered methods — state: Done (13 Nov 2026, branch `work/2026-11-13`)

- **Goal:** a client can send a snapshot to the real coordinator, run `section.intervals/1` in the worker and
  download the result columns.
- **Read first:** contract §3; `src/sedcoretool/engine/server.py`, `worker.py`, `buffers.py`;
  `tests/test_engine_transport.py`; technical manual §26.2.
- **Change:** `engine/server.py` (operation `section.analyze`; a generic job runner instead of the digest-only
  one; `hello` lists both methods), `engine/worker.py` (loads the method from the registry, reads input buffer
  files with NumPy, writes output buffer files and a small result description), `engine/buffers.py` (adopt worker
  outputs as committed buffers within the session budget; read a range of a committed buffer);
  `docs/roadmap-engine-contract.md` (add the operation `buffer.read {handle, offset, byte_length}` → response
  followed by one binary frame of at most 1 MiB; describe the job description passed to the worker);
  `docs/TECHNICAL_DOCUMENTATION.md` §26.2; `tests/test_engine_transport.py`.
- **Do not touch:** the frame format, limits and error codes; the coordinator stays standard-library only (the
  architecture test enforces it); `buffer.digest/1` keeps working.
- **Steps:** implement; then prepare the runtime again (DEVELOPMENT §4) because Python sources changed.
- **Tests:** a fixture through the real coordinator and worker returns identical columns; cancellation while
  queued and while running returns `cancelled` and leaves no file or budget charge; an invalid snapshot returns an
  error response and the session stays usable; killing the worker returns `INTERNAL`.
  `pytest -q tests/test_engine_transport.py tests/test_architecture.py`.
- **Done when:** those tests pass and `npm run prepare-runtime -- --offline` succeeds.
- **Result (13 November 2026):** operation `section.analyze` and `buffer.read` in `engine/server.py`; `engine/specs.py` (input names,
  dtypes and ranks, standard library only); `engine/worker.py` now holds the coordinator-side process wrappers (`WorkerJob`,
  `DigestJob`, new `MethodJob`); the new script `engine/method_worker.py` is the only engine file that imports NumPy and the methods
  (it registers the `sedcoretool` package without running its `__init__`, so pandas and Pillow are not loaded); `BufferStore.adopt`
  and `read`, and a stored `shape` per buffer. The 28 earlier transport tests pass untouched. 30 new tests in
  `tests/test_engine_methods.py`: seven reference fixtures through the real coordinator and a real worker with results downloaded in
  100 kB ranges, request validation before admission (13 cases), cancellation of a queued and a running analysis, the queue limit,
  12 misbehaving-worker cases that must adopt nothing, the session budget, `buffer.read` bounds and frame order, the digest still
  working, and agreement between `specs.py` and the method module. Sixteen deliberate faults in coordinator and store were each caught
  (three needed extra cases first). Contract amended: `buffer.read`, exact `section.analyze` response, job execution model;
  progress events are specified but **not sent yet** because the Electron client does not read events (card M8.3.6 decides). Also
  changed: the Electron client accepts the two advertised methods (`desktop/engine.js`, with a new Node test that an unknown method
  makes the engine unavailable), `tests/e2e/desktop.mjs` expects both, and `tools/check_engine_runtime.py` now runs the method with the
  bundled interpreter. The test file is new instead of extending `test_engine_transport.py`.

#### M8.3.6 - Main-process client and renderer bridge — state: Done (development gate, 14 November 2026)

- **Goal:** the page can upload buffers, start and cancel a section analysis and read results through a narrow,
  validated bridge.
- **Read first:** [ARCHITECTURE §3.3](ARCHITECTURE.md#33-electron-main-process-desktop); `desktop/engine.js`,
  `desktop/engine-protocol.js`, `desktop/preload.js`; how `desktop/main.js` checks the sender for `trainer:*` calls;
  `tests/app/engine.test.mjs`.
- **Change:** `desktop/engine.js` and `engine-protocol.js` (accept the two methods in `hello`; operations
  `section.analyze` and `buffer.read`, including a binary frame in a response); create `desktop/engine-ipc.js`;
  `desktop/main.js` (register it); `desktop/preload.js`; `desktop/scripts/build.js` (`files` list);
  `tests/app/engine.test.mjs`, new `tests/app/engine-ipc.test.mjs`.
- **Do not touch:** `engine:status`; trainer and diagnostics bridges; the rule that the page never supplies paths,
  executables or operation names.
- **Steps:** the bridge offers exactly: `status()`, `beginBuffer(descriptor)`, `appendBuffer(token, offset, bytes)`
  (at most 1 MiB), `commitBuffer(token)`, `analyzeSection(request)`, `cancel(requestKey)`,
  `readBuffer(token, offset, length)`, `release(tokens)`. `engine-ipc.js` checks the sender origin as the trainer
  handlers do, validates every argument's type and size, maps page tokens to engine handles and releases all
  handles of a page when it reloads or closes.
- **Tests:** Node tests with a fake `EngineClient` for validation and token ownership; one Node test with the
  bundled runtime that runs a fixture end to end through `engine-ipc.js` functions.
- **Done when:** tests pass; `node desktop/scripts/check-package.js` still passes after `npm run dist`.

- **Result:** `desktop/engine-ipc.js` offers the eight calls of the card to one page at a time; tokens replace engine handles and
  belong to the page that created them, buffers are released when it navigates, reloads, crashes or closes, a result that arrives after
  that is released at once, and a failed call resolves to `{error: {code, field?}}` without any message. `engine.js` reads the binary
  frame that follows a `buffer.read` response (`ControlReader` accepts it only when announced with its exact length) and ends the
  session on any mismatch; analysis requests have a 10 minute backstop deadline. Tests: 19 in `tests/app/engine-ipc.test.mjs` (fake
  engine for validation and ownership, the real engine and the bundled runtime running 8 reference fixtures through the bridge, a
  rejected input naming its field), 3 new reader/client tests and a misbehaving-engine test (5 variants) in `engine.test.mjs`, a round
  trip through the preload bridge in `tests/e2e/desktop.mjs` with the engine on and off. 33 deliberate faults were each caught (two
  needed extra tests first). `check-package.js` and `build.js` list the new file; `npm run dist` was not rerun for this card.

#### M8.3.7 - The interface shows engine results under the flag — state: Done (development gate, 14 November 2026)

- **Goal:** with the experiment on, `s.bins` comes from the engine; with it off, from the JavaScript calculation.
- **Read first:** [ARCHITECTURE §4](ARCHITECTURE.md#4-path-of-one-scientific-request-target-design-for-m83);
  contract §2; `app/js/sectionanalysis.js`; the seven call sites of `analyze` (`app.js`, `columns.js`).
- **Change:** `app/js/sectionanalysis.js` (`analysisRevision(section, project)`, `resultToBins(result)`); create
  `app/js/engineclient.js` and its Node test with a fake bridge; `app/js/app.js` and `columns.js` (callers await
  `analyzeSections(sections)`); `app/js/i18n.js` (pending and error texts, `engine.error.<CODE>`);
  `tools/build_standalone.py` (`ORDER`); `tests/e2e/desktop.mjs`.
- **Do not touch:** the JavaScript calculation (it stays as the default and as the reference); the shape of
  `s.bins`; saving and project files.
- **Steps:** a result is published only if session, section and revision are still current; an older, cancelled
  or failed job changes nothing; while a section waits, its results show a pending state and never an older
  revision as current; a failure shows a translated error and does not fall back to JavaScript.
- **Tests:** Node tests for revision changes, stale-result rejection and `resultToBins` on the fixtures; desktop
  end-to-end with the flag on: the six sections of the public example match the JavaScript reference (exact
  counts and indices, 1e-9 on floats), then edit → undo → redo, CSV export and save → reopen; with the flag off
  the existing end-to-end passes unchanged.
- **Done when:** both end-to-end runs pass and the full session checks pass.

- **Result:** with the experiment on, `app.js::analyze` hands each section to `engineanalysis.js` and the JavaScript calculation does not
  run; with it off nothing changed. Deviation from the card, decided to avoid turning every render path asynchronous: the seven
  call sites still call the synchronous `analyze(s)`, which now only requests the analysis and leaves the section pending; the
  controller re-renders when a result is published (`onChange`), and exports await `analyzeSections` (the CSV export does). Revision
  rules, stale-result rejection, cancellation, queueing and the error state are tested in `tests/app/engine-analysis.test.mjs`
  (17 tests; 23 deliberate faults caught, two needed extra tests first). The six sections of the public example match the JavaScript
  reference (exact counts, indices and nulls, 1e-9 floats) in `tests/e2e/desktop.mjs` with the bundled runtime, before and after an edit;
  with the experiment off the same file passes unchanged. Not done: undo/redo and save → reopen under the flag were not exercised
  separately (the revision key covers them by construction); the figures, data and map tabs refresh through `setMode` after a publish,
  which was not checked visually.

#### M8.3.8 - Acceptance measurements and decision — state: Done (measured 14 November 2026; waiting for the maintainer's decision)

- **Goal:** the gates of contract §7 are measured on the first slice and the maintainer decides what follows.
- **Change:** a measuring tool under `tools/`, evidence under `docs/validation/`, the release checklist above.
- **Steps:** numerical parity on the public six-section example and the generated eight-section M0.1 project at
  2 and 1.37 cm; matched timing (flag off/on, alternating order); interface responsiveness and cancellation during
  the largest case; whole-process memory; ten open/analyse/close cycles; kill the worker and the coordinator
  mid-job and interrupt a save.
- **Done when:** every gate has a recorded pass or a recorded failure with its measurement, and the maintainer
  has chosen: continue to M8.4, or correct first.

- **Result:** every gate has a recorded measurement in [docs/validation/M8.3.8-engine-analysis-summary.md](validation/M8.3.8-engine-analysis-summary.md)
  (raw: `docs/validation/M8.3.8-engine-analysis-windows-v0.150.json`, tool `tools/measure_engine_analysis.mjs`). Pass: numerical parity, responsiveness,
  cancellation, worker and coordinator kills. Fail: the ten-cycle memory gate (+109.7 MiB, gate +64). Not met: the 25 ms memory cadence
  (0.9 s). Timing is reported: the engine is about 60 to 160 times slower than the JavaScript calculation on these inputs (4.2 s against
  27 ms; 6.9 s against 110 ms), mostly per-job overhead. The measurement also exposed a real bug (a section left pending when its inputs
  changed under a waiting job), fixed in the same delivery. **Decision for the maintainer:** continue to M8.4, or correct first
  (recommended: a persistent worker, cheaper transfer, a faster memory sampler, then re-measure). The experiment stays off by default.

### M8.4 to M8.6 - summaries

Cards are written by a design session when the previous milestone passes its development gate.

- [ ] **M8.4 - Bounded engine data and image services.** Engine-owned native images, chunked operations and a
      bounded tile/cache interface; the renderer receives visible tiles, editing updates and result summaries
      instead of holding a second copy of every image. Implements M2.3.1–M2.3.5
      ([roadmap-future.md](roadmap-future.md)).
  - Acceptance: the multi-gigabyte contract covers the complete Electron/engine process tree, disk usage, buffer
    ownership and memory release after closing a project; native pixels, editing coordinates, masks/history and
    atomic save/backup recovery are preserved; raising heap or image limits alone does not pass.
- [ ] **M8.5 - Migrate the remaining scientific methods,** one slice at a time with the recipe of
      [ARCHITECTURE §5.1](ARCHITECTURE.md#51-add-or-migrate-a-scientific-method): (a) depth/age parsing and
      record/formula transformations; (b) image filters, detection and object features; (c) ichnotaxon
      classifiers and embeddings; (d) multiproxy rules, models, interpolation and fitted statistics; (e) U-Net
      inference, then training integration after M3.2.5.
  - Acceptance per slice: independent reference fixtures, explicit provenance, unchanged public contracts; exact
    counts/masks/labels and predeclared tolerances elsewhere; figures and exports unchanged.
- [ ] **M8.6 - Promote desktop and retire duplicate computation.** After the release checklist passes: the engine
      becomes authoritative, migrated JavaScript calculations are removed from the desktop program, their role as
      reference passes to versioned fixtures, and the last supported HTML version is frozen with a tested
      export/import path for its stored projects.
  - Acceptance: one implementation per method; identical API, CLI and desktop results; complete desktop and
    interrupted-save regressions; storage identifiers and old project readers retained; documents and CI updated
    in the same delivery; engine errors stay visible.

## Small maintenance cards

Independent of M8; each can be done in under an hour when the maintainer asks.

- [ ] **H1 - The desktop end-to-end test prepares its own files.** `tests/e2e/desktop.mjs` depends on
      `desktop/web` containing the sample data, which `npm run dist` removes (it failed for that reason on
      12 November 2026). Make the test run `desktop/scripts/prepare.js --with-examples` itself, or fail at once
      with a clear message when the sample is missing. Done when the test passes right after `npm run dist`.
- [ ] **H2 - Check the failed requests for optional sample files in packaged builds.** The packaged program logs
      `net::ERR_UNEXPECTED` for `app://corantool/app/data/idealized_core_0-500cm.jpg`,
      `app/data/land-50m.json` and `examples/data/idealized_core_0-500cm.jpg` at start-up. Find out whether these
      are the intended probes for absent optional files (then answer them with a clean 404) or a wrong path for
      the coastline file. Done when the cause is written here and, if it is a defect, fixed with a test.
- [ ] **H4 - Remove stale engine scratch folders.** When the Electron main process dies abruptly (killed, crash,
      power loss) nobody deletes the engine's private folder `sedcoretool-engine-*` in the system temporary
      directory; twelve were found on 12 November 2026, created at the times of killed launches and of the desktop
      end-to-end test. An orderly or forced stop of the engine alone does clean up (measured in M8.2.3). A stale
      folder can hold staged buffers (up to the 1 GiB scratch limit).
  - Read first: `desktop/engine.js` (`cleanupScratch`, `EngineClient.start`); `tests/app/engine.test.mjs`.
  - Change: at engine start, delete folders that match the exact scratch name pattern, sit directly in the system
    temporary directory, and are older than the running program; never touch anything else. Add a Node test with
    a stale folder, a fresh folder of another live session and a look-alike name that must survive.
  - Done when: the test passes and the desktop end-to-end test leaves no `sedcoretool-engine-*` folder behind.
    The end-to-end test's own `sedcoretool-desktop-test-*` profiles should be removed by the test as well.
- [~] **H5 - The `e2e` job of the GitHub workflow was red from 10 November 2026 to 14 November 2026; fixed on the work branch, watching.** Findings of 13-14 November 2026
      (the CI result and its failure message are readable without logs through the public API: the smoke test now emits `::error::`
      annotations, `GET /repos/SantiCa/SedCoreTool/check-runs/<job id>/annotations`; the unauthenticated API allows 60 requests an hour):
      (1) **Fixed:** the five Python jobs failed because `psutil` (imported by `tools/benchmark.py` through the benchmark tests) was not in
      the `dev` extras. (2) **Fixed:** on Windows the method worker hung in a clean environment (`import numpy` blocked while the liveness
      watcher was reading stdin); found only because the GitHub Windows job failed. With both fixes every Python job (Linux 3.10/3.12/3.13,
      macOS, Windows), `checks` and `web-app` pass. (3) **Fixed:** "name column drag" measured the multiproxy panel before layout (1 run in 4
      even on an untouched V0.148). (4) **Open, not caused by the engine work:** the `e2e` job passed on 10 November 2026 (commit `29d4ecf`)
      and has failed on every run since, i.e. since the navigation-preview tests of V0.117-V0.119 were added. Its latest messages on
      `ubuntu-latest`: `Navigation pixel 128593: expected 143, received 142` (the exact-equality check of the preview against the legacy
      renderer, `compareNavigationPreview`, differs by one level in Chrome on Linux) and, in the previous run, "Navigation click/drag must preserve
      depth mapping". Windows passes. Locally the smoke suite passes most of the time but also fails now and then (a wait for the 16-bit TIFF to be
      decoded again after reopening a project, Puppeteer's 180 s protocol timeout).
  - Evidence of 14 November 2026 (the failing check now reports its own diagnosis; reproducible, identical on four consecutive runs):
    24 values of 257,928 differ (one pixel row, 24 columns, green channel only), by exactly 1 level, at screen row 487 of the 947-row strip
    that stretches 45 source rows. The browser is headless Chrome 157 on Linux using SwiftShader (software Vulkan). In the same browser a
    plain stretch of an identical gradient is bit-identical whether the source canvas is built with `fillRect` or `putImageData` and whether
    the 2-D backend is the default or CPU (`willReadFrequently`), so the stretch itself is deterministic. The differing row samples the
    source at the centre of a texel (no interpolation), not at a rounding tie. Open hypothesis: the legacy path draws straight into the
    `view` canvas at a vertical offset of 14 pixels while the preview draws into a new canvas at the origin and copies, and SwiftShader's
    float arithmetic differs by the offset for this one row. Not tested. Windows (GPU and CPU) is exact.
  - **Cause found and fixed (14 November 2026).** (a) The same stretch drawn at (0,0) and at (6,14) of a canvas differed in 48 values under
    SwiftShader (probe `offset: 48`); the preview drew at the origin of its own canvas, the legacy path at (6,14) of the view. The preview
    now stretches at the offset where the view draws it (`navigationPreviewCanvas(s, w, h, origin)`), exact equality unchanged: the
    check passes on Linux and Windows. It was a rasteriser dependence, not a logic error of the preview. (b) That failure had hidden a second
    one: two checks of `interrupted-saves.mjs` read Spanish messages and the Linux runner's browser is English; the test now fixes the
    interface language. First green run: work branch, commit after `0926bbc`. `master` (V0.150) still has the failing job until the next
    version. (c) The local flakes (the wait for the 16-bit TIFF after reopening, Puppeteer's 180 s protocol timeout) had a product cause, found with the CPU profiler on 14 November 2026: `sectionCanvas` created a new full-strip grey canvas on every call for a section whose picture was not loaded yet, and the image strip asks once per output row (up to 4000), so `toDataURL` took 6-25 s. It now keeps one grey canvas while the section stays pending; the smoke test asserts it (fails without the fix) and names any page call over 5 s. Done when the
    `e2e` job passes ten consecutive pushes.
- [ ] **H3 - Move raw benchmark reports out of the repository.** `docs/benchmarks/*.json` weighs about 10 MB.
      Needs the maintainer's decision on where the raw files go; the `.md` summaries stay.

## Later milestones

Not scheduled. Details, acceptance criteria and the backlog are in [roadmap-future.md](roadmap-future.md).

| Area | Tasks |
|---|---|
| Editing and recovery | M1.2.2 remaining desktop hangs |
| Large images | M2.3.1–M2.3.5 (delivered through M8.4) |
| Analysis and U-Net | M3.1.6, M3.1.7, M3.2.4, M3.2.5, M3.3.2, M3.3.4 |
| Optional acceleration | M4.1.1 Rust kernel, M4.1.2 GPU |
| Release readiness | M5.1, M5.2, M5.4, M5.5 |
| Advanced statistics | M6.1–M6.6 |
| Radiographs | M7.1–M7.4 |
| Interface shell | M9.1 |
| Validation, publication, backlog | scientific validation on real cores, paper, DOI, PyPI, further ideas |
