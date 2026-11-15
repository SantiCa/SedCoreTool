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

Updated 15 November 2026.

- **Released version:** V0.150 (14 November 2026), integrated into `master` on the maintainer's instruction ("haz commit y push de todo a
  master con una nueva version 0.150"). **No tag and no GitHub Release exist for V0.149 or V0.150**: a tag publishes a Release and is the
  owner's decision. The *Desktop builds* workflow is started by hand for the macOS and Linux builds (see the release checklist).
- **Active work branch:** `work/2026-11-13` (pushed), which `master` now contains. Changes after V0.150 accumulate under `## Unreleased`.
  The maintainer decided on 14 November 2026 that nothing goes to `master` until M8.4 is finished; that delivery will be V0.151.
- **Checks:** see the last line of this block; it is rewritten at the end of every session.
- **Where we are:** M8.1 and M8.2 are done at the development gate (Windows). M8.3 is complete at the development gate: with
  `SEDCORETOOL_ENGINE_EXPERIMENT=1` the desktop program calculates the interval table of every section in the Python engine and shows it,
  with a pending state, stale-result rejection, cancellation and an error state, never falling back to JavaScript. Measurements of card
  M8.3.8: [summary](validation/M8.3.8-engine-analysis-summary.md). **The engine path is 30-60 times slower than JavaScript and fails the
  matched-timing gate of contract §7**; about 90 % of the time is moving the label image on every analysis (design review of 14 November 2026).
- **Milestone gate of M8.2-M8.3 (card M8.3.9): passed on 14 November 2026**, commit `89512c1`: `tests` and *Desktop builds* succeeded on Windows,
  macOS and Linux (the desktop end-to-end test with the engine experiment off and on, the package check and the packaged-runtime start). It was
  the first time the engine work was built on macOS and Linux; it found three faults, all fixed (see the card). Still not covered, and on the
  release checklist: launching the *packaged* program on macOS and Linux, Intel Macs, clean machines.
- **Where M8.4 stands (14 November 2026):** cards M8.4.1-M8.4.5 are done and pushed. Measured on Windows (3 pairs, warm, flag off against
  flag on), from the baseline before M8.4.1 to now: interval-size change on all sections 1,779 -> 229 ms (public) and 3,730 -> 259 ms (synthetic),
  limit about 51 ms; edit, undo, redo 358 -> 147 ms and 569 -> 211 ms, limit 59-68 ms; unchanged re-analysis, memory peak and parity pass. **The
  timing gate of contract §7 still fails for (a) and (b).** What remains in (b), measured through the interface on a 2.6-Mpixel section: about
  35 ms are the interface's own redraw after the edit (it runs on the page's thread; with JavaScript it happens after the measured result, with
  the engine it falls inside the chain of calls), 10 ms the snapshot and full hash in the page, about 50 ms the upload (the objects table and
  both masks are derived and fully re-hashed by the engine), about 20 ms the engine. With the full-content hash that the maintainer's condition
  of decision 1 requires and the page thread shared with drawing, this design cannot reach about 60 ms; the decision of 15 November 2026
  (next item) moves the fix to part C.
- **Decision of 15 November 2026 - direction for fluidity: option A.** The maintainer wants the program to stay very fluid with very heavy
  images and with tables of tens of thousands of rows. Chosen: the engine owns a **tile store** on disk (a pixel pyramid and versioned mask
  tiles); the page shows tiles and edits the loaded ones ([ARCHITECTURE §3.4, D10-D12](ARCHITECTURE.md#34-tile-store-for-large-images-planned-part-c-of-m84)).
  What it changes:
  1. **Order:** part A closes with M8.4.7 and M8.4.8 (V0.151 when the maintainer asks), then **part C** (tiles), then part B, then M8.5.
     M8.4.6 is deferred.
  2. **The timing question of 14 November is answered:** absolute interactive targets in [contract §7](roadmap-engine-contract.md#7-predeclared-verification-and-performance-gates)
     are the gate for interactive paths from part C on; the JavaScript-relative verdicts are still measured and reported. The numbers were
     proposed by the design session and adopted with the choice; the maintainer may change them before M8.4.12 measures.
  3. **Measure before committing (rule D11):** card M8.4.12 decides with one measurement whether the interval table of tiled sections is
     computed by the engine (A) or stays in JavaScript (D).
  4. **Doors kept open** for a later Rust core (option B) or a native interface (option C): the store format is documented and independent
     of the browser and Electron, and no new scientific method is written in JavaScript (AGENTS.md §4).
- **Review of M8.4.1-M8.4.5 (14 November 2026, second design session):** no scientific or safety fault found in the code; two defects fixed
  (the change record cost about 8 ns for every pixel written, also with the engine off, and the engine's copies of the old project were not
  released when a project was replaced); documents that still said "every analysis uploads every input" corrected; the guarantee about an
  engine dying mid-transfer got its test; **M8.4 is not finished and M8.5 must not start**: M8.4.6-M8.4.8 (part A), M8.4.9-M8.4.11 (part B,
  the cards were written in this review) and part C remain, plus the timing decision (answered on 15 November 2026, above). The browser test `smoke.mjs` could not be run locally in
  the review (starting the local server was refused); the `e2e` job of GitHub runs it on every push.
- **Next step:** M8.4.7 (restart, Ready), then M8.4.8 (milestone gate of part A; V0.151 only when the maintainer asks), then the first
  cards of part C in this order: M8.4.12 (the round-trip measurement and rule D11), M8.4.13 (multi-gigabyte fixtures and the baseline),
  M2.1.4 (tables and figures with 100,000 rows: measurement). These five cards are detailed and can be implemented by any model. **After
  them a design session** (the most capable model, or the maintainer) details M8.4.14-M8.4.19 with the measured numbers; an implementing
  session must not start M8.4.14 from its summary. Also open: card H5 (the `e2e` job must pass ten consecutive pushes).
- **Reminder for whoever talks to the maintainer:** the maintainer accepted the two acceptance levels on
  13 November 2026 and asked to be **reminded to run the release-gate tests** (the release checklist below:
  macOS and Linux, clean Windows machine, cold-cache first launch, saturated CPUs, package sizes, and the
  numerical/timing/memory/recovery gates). Remind him when a milestone of M8 finishes and before any flag is
  switched on by default or a version with the engine is announced.
- **Decisions waiting for the maintainer:** (1) the flags in the table below that need a promote/remove decision, in particular the
  **visible-row table (M2.1.3)**: 17 times faster at 100,000 rows (5,746 -> 333 ms for ten expansions); the design review of 15 November 2026
  proposed making it the default (it changes the default for users, so it needs the release gate of its own scope: every platform);
  (2) any change to the interactive targets of contract §7, before M8.4.12 measures. Decided on 15 November 2026: option A and what follows
  from it (item above), which also answers the timing question of 14 November. Decided on 13 November 2026: acceptance levels (accepted),
  scope of 1.0 (below), publication of V0.149. Decided on 14 November 2026: a milestone gate on macOS and Linux closes every milestone; the
  five decisions of M8.4 (answers recorded there, among them **multi-gigabyte images are required for 1.0**).
- **Last checks: passed** on 14 November 2026 on commit `381f2cf` (review of M8.4, branch `work/2026-11-13`, maintainer's Windows computer):
  `pytest -q` 664 passed / 9 skipped (Python 3.12); `node --test tests/app/*.test.mjs` 343 passed; `npm run typecheck` (no new diagnostics);
  `sync_version.py --check`; `ruff check src tests tools` (ruff 0.17.5 under Python 3.14, the only interpreter on this computer that has it);
  standalone build; `tests/e2e/desktop.mjs` with the engine experiment on and off, bundled runtime rebuilt first. GitHub `tests` (including the
  `e2e` job, which runs `smoke.mjs`) and *Desktop builds* succeeded on `381f2cf` on Windows, macOS and Linux. Not run locally: `tests/e2e/smoke.mjs`
  (starting the local server was refused in that session). The commit of 15 November 2026 after it changes documents only (design of part C);
  no code changed, so no checks were repeated. The scenario measurements of M8.4.1-M8.4.5 are separate evidence (baseline committed; later
  runs summarised in each card).

## How work is accepted

Adopted on 12 November 2026 when the maintainer asked for this restructuring; it replaces the earlier rule that
every platform and performance gate had to pass before the next task could start.

| Level | Needed for | What must be true |
|---|---|---|
| **Development gate** | Starting the next card | The card's "Done when" holds; its tests and the session checks pass on the maintainer's Windows workstation; anything unfinished is behind a flag that is off by default; evidence states what was not measured. |
| **Milestone gate** (added 14 November 2026) | Starting the next milestone or M8.5 slice; integrating a version into `master` | On one commit of the work branch: the `tests` and *Desktop builds* workflows (both run on every push of a `work/**` branch) pass on Windows, macOS (Apple Silicon runner) and Linux, including `tests/e2e/desktop.mjs` with the engine experiment on and off and the package check ([how: DEVELOPMENT §8](DEVELOPMENT.md#8-versions-ci-and-releases)). Each failure is fixed, or recorded with its message and a decision of the maintainer. It is the last card of every milestone. |
| **Release gate** | Switching a flag on by default, or publishing a version to users | Everything in the [release checklist](#release-checklist): all supported platforms, clean machines, and the numerical, timing, memory and recovery gates of [contract §7](roadmap-engine-contract.md#7-predeclared-verification-and-performance-gates). |

Never report the release gate as met from development or milestone evidence. A failed gate is recorded with its
measurement; it is not hidden, and limits are not relaxed to pass it.

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
  image/data services (so after M8.4 parts A, C and B); M5.1 compatibility and reproducibility; M5.2 scientific validation and
  documentation, including a comparison with expert estimates on real cores; software paper and archived release (DOI).
- **Also in (decided 14 November 2026):** individual images of several gigabytes (M2.3.1–M2.3.5), delivered as part C of M8.4.
- **Not required:** optional acceleration (M4), a new interface shell (M9).
- **Consequence for the order:** after M8.6 the next milestones are M6 and M7, in that order unless the
  maintainer changes it; their cards are written by a design session when M8.4 has passed its milestone gate,
  because they use the engine's image and data services.

## Active priority: desktop and one scientific engine

Direction approved by the maintainer on 12 November 2026; the design, its rules and the recorded decisions are in
[ARCHITECTURE.md](ARCHITECTURE.md). In one sentence: every scientific method is implemented once in Python and
runs in a local engine process; the Electron/JavaScript interface requests and shows results; the Python API and
command line call the same code directly.

| Order | Milestone | State |
|---|---|---|
| 1 | M8.1 Inventory and engine contract | done ([V0.141](../CHANGELOG.md#v0141--2026-11-12)) |
| 2 | M8.2 Engine process, bundled runtime, packaging | done at the development gate; milestone gate in card M8.3.9; release items in the checklist |
| 3 | **M8.3 First scientific slice: section intervals** | **done; milestone gate M8.3.9 passed (14 Nov 2026)** |
| 4 | M8.4 Engine-resident section data and fast analysis | part A done up to M8.4.5 (M8.4.7, M8.4.8 left); then part C (tiles, option A of 15 Nov 2026); then part B |
| 5 | M8.5 Remaining methods, one slice at a time | cards written when M8.4 passes its milestone gate |
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
      smoke check, packaged start-up and close. The milestone gates cover runtime preparation, the desktop end-to-end
      test from source and packaging on the Apple Silicon and Linux x64 runners; still needed for the release gate:
      launching the packaged program (not only building it) on each system, and an Intel Mac (GitHub's Intel macOS
      runners are being retired; check what is offered before relying on them).
- [ ] Clean Windows machine (no Python, no Node) and at least one other antivirus configuration.
- [ ] First launch with a cold disk cache (after a reboot) against the 5 s engine-ready gate. Measured so far:
      3.7–3.9 s right after extraction; 11–25 s before the runtime was pruned. Measure once after the next reboot
      with `tools/measure_packaged_startup.mjs <exe> --runs 1`.
- [ ] Whole-process memory, timing, responsiveness, cancellation and recovery gates of contract §7 on the first
      scientific slice. Measured in card M8.3.8 on Windows: responsiveness, cancellation and recovery pass; **matched
      timing fails** and the memory peak was not evaluated. Measured again in card M8.4.1 and after each M8.4 card.
- [ ] Engine start-up with all CPUs saturated: runtime verification took 16 s median before pruning and the
      verification record; repeat `tools/measure_engine_lifecycle.mjs --load 16`.
- [ ] Installer and portable sizes recorded for every platform.
- [ ] Interactive targets of contract §7 (part C) on macOS and Linux hardware and on a computer with 16 GiB of memory; the targets are
      decided on the primary reference host only, and shared CI runners cannot measure them reliably.

### M8.3 - First scientific slice: section intervals

**Outcome.** With the experiment on, the interval percentages, per-class percentages, BI and ii of a section are
computed by the engine method `section.intervals/1` and shown by the existing interface; with it off, nothing
changes. Inputs and results are defined in [contract §4–§5](roadmap-engine-contract.md#4-scientific-input-contract-sectionintervals1);
the path of a request is [ARCHITECTURE §4](ARCHITECTURE.md#4-path-of-one-scientific-request-built-in-m83).
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
- **Read first:** [ARCHITECTURE §4](ARCHITECTURE.md#4-path-of-one-scientific-request-built-in-m83);
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
  with the experiment off the same file passes unchanged. Closed on 14 November 2026 (closing M8.3): the desktop end-to-end test now also undoes and
  redoes the deletion and compares every result with the reference after each step, then opens the data, figures, map, log and section tabs and requires
  no page error; save → reopen was already covered by the restart steps of the same test. Limits: the tab check confirms that each tab opens without an
  error, it does not compare their content, and the new assertions were not mutation-tested; run on Windows locally and not yet by the workflows.

#### M8.3.8 - Acceptance measurements and decision — state: Done (measured and corrected 14 November 2026)

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
  changed under a waiting job), fixed in the same delivery. **Corrections (14 November 2026, on the maintainer's instruction to fix errors before M8.4):**
  one long-lived method worker (contract amended), a psutil memory sampler at 25 ms (median 25.4 ms), then the whole measurement was repeated
  ([corrected evidence](validation/M8.3.8-engine-analysis-windows-corrected.json)): cold analysis is 1.6 s (public) and 3.4-3.9 s (synthetic)
  against 0.03 s and 0.11 s in JavaScript, the ten-cycle memory gate passed in four of four runs. **Verdicts corrected by the design review of the same
  day:** matched timing is a gate of contract §7 and fails (the tool had reported it as "not a gate"), and the memory-peak gate was not evaluated
  (no flag-off sample of the Electron tree); parity, responsiveness, cancellation, cycles and kills pass. The cost is data movement (M8.4).
  The experiment stays off by default.

#### M8.3.9 - Milestone gate of M8.2 and M8.3 on Windows, macOS and Linux — state: Done (14 Nov 2026, branch `work/2026-11-13`)

- **Goal:** the engine work of M8.2-M8.3 is built and tested on the three systems before M8.4 builds on it. Today it
  has run only on Windows: *Desktop builds* last ran on 8 November 2026 (V0.84, failed).
- **Read first:** [AGENTS.md §6](../AGENTS.md#6-working-on-a-task) (milestone gate);
  [DEVELOPMENT §8](DEVELOPMENT.md#8-versions-ci-and-releases); `.github/workflows/desktop.yml`; card H5 (how CI
  failures were read and fixed without logs).
- **Change:** `.github/workflows/desktop.yml` (add a run of `tests/e2e/desktop.mjs` with the experiment off, next to
  the existing run with it on, on every system; run on every push of a `work/**` branch, because the maintainer asked
  the assistant to start the build and only the maintainer can start a manual run; later steps run even after an
  earlier failure); whatever a failure shows to be broken, each fix with its own test; this card's result; the
  status block; the release checklist.
- **Do not touch:** the `release` job and its conditions (no tag, no draft, no Release); `master`; the experiment
  default; tolerances and deadlines of the tests (a failure is fixed or recorded, never relaxed).
- **Steps:**
  1. Make the workflow changes; commit; push the work branch (allowed). Both workflows start by themselves.
  2. Confirm the `tests` workflow passes on that commit.
  3. Read the *Desktop builds* result through the public API. For each failing system: find the cause from the annotations or by
     reproducing it, fix it on the branch with a test, push (which starts a new run). Separate failures of the program
     from failures of the runner (for example a missing system library on Linux) and record which is which.
  4. Record the run id, commit, per-system result, the duration of the runtime preparation and the size of every
     artifact (partial evidence for the "package sizes" item of the release checklist; the CI artifact is not the
     signed product).
- **Tests:** the two workflows themselves.
- **Done when:** one *Desktop builds* run on the branch head passes on Windows, macOS and Linux and `tests` passes on
  the same commit, or each remaining failure is recorded here with its message and the maintainer has decided what
  to do. Claims the milestone gate only: packaged start-up on macOS/Linux, Intel Macs and clean machines stay on the
  release checklist.
- **Result (14 November 2026):** run on commit `89512c1` succeeded on Windows (5 min 37 s), Linux (2 min 44 s) and macOS (6 min 2 s) including
  runtime preparation, both desktop end-to-end runs and the package check; `tests` succeeded on the same commit. CI artifact sizes (unsigned,
  not the product): Windows 376 MiB, macOS 320 MiB, Linux 388 MiB. The first run found three faults, none in the engine's behaviour: (1) `check-package.js`
  still expected only `buffer.digest/1` from the packaged engine (all systems); (2) the macOS universal build refused the native libraries in
  `PIL/.dylibs`, because the `x64ArchFiles` glob does not enter dot folders; (3) after (2), the merged `app.asar` of the universal bundle was empty (28 bytes),
  so the package check failed; `mergeASARs: false` fixed it, but **the reason the merge emptied the archive is not known** (the registers show the merge
  running for 0.1 s). The check now also names what an archive contains when it fails. Also: the interrupted-saves test read Spanish
  messages in windows that were already open on an English host (all systems). Not covered: the packaged program was built and its runtime started
  by the check, but not launched with a window on macOS or Linux.

### M8.4 - Engine-resident section data and fast analysis

Proposed by the design review of 14 November 2026; replaces the earlier summary ("bounded engine data and image
services, implements M2.3.1-M2.3.5"). Every card claims the development gate; M8.4.8 is the milestone gate.

**Why the plan changed.** Measured on one 6.1-Mpixel section with the worker already running: snapshot 56 ms,
upload 195 ms (24 round trips of 1 MiB through page, main process and engine, written to the scratch disk and
hashed in the page and again in the engine), engine 132 ms, download 9 ms (about 35 result buffers, one read
each): about 392 ms. JavaScript takes 17 ms, and under 1 ms when only the interval size changes, because it keeps
its row counts. The NumPy method itself takes about 50 ms in-process (parse 8 ms, run 41 ms). So the engine path is
slow because it moves the whole label image for every analysis, even when only a setting changed; copying and
hashing in the page are not the main cost (6 ms and 15 ms in Node 22). Moving image ownership to the engine, as the
earlier summary proposed, would not remove that cost for editing: every brush stroke would then cross two processes.

**Decisions of the maintainer (14 November 2026, all five answered):**

1. **Who owns live masks: the renderer**, on the condition that the program stays as fast, fluid and protected against errors as
   possible. The renderer keeps live editing, undo/redo and saving (decision D1); the engine holds a verified copy of each
   section's analysis inputs, which the renderer updates with the changed rows. This withdraws the last paragraph of contract §2
   (engine-owned masks, edit commands sent to the engine, tiles sent back). The condition becomes acceptance criteria (card M8.4.4):
   the edit path never waits for the engine; the renderer's data is always authoritative and a failure of the engine, of a transfer
   or of the copy never loses or changes an edit or a saved project; a copy that is not proven identical (full SHA-256) is never
   used; input-to-next-frame during an edit is not worse with the engine on than off.
2. **Multi-gigabyte images are required for 1.0** (the maintainer rejected moving them after 1.0). M2.3.1–M2.3.5 are delivered as
   **part C of M8.4** (since 15 November 2026 part C comes before part B and builds its own image access, the tile store); V0.151
   does not wait for them. They also constrain M8.5:
   from slice (b) on, an image method works on regions of an engine-held image, never on a whole decoded raster.
3. **Timing scenarios: accepted.** Contract §7's "warm end-to-end median" is evaluated on three named warm scenarios: (a) the
   interval size changes on all sections, (b) one edit, its undo and its redo on the largest section, (c) an unchanged re-analysis.
   Cold opening of a project is reported separately, as §7 already allows. The limits do not change.
4. **V0.151 goes to `master` after part A** (M8.4.1–M8.4.8), not after part B.
5. **Engine restart: accepted.** The error state of a section offers "Retry", which starts a new engine session and resubmits
   only the current snapshots (contract §3 already requires fresh tokens), plus at most one automatic restart per program session,
   announced to the user.

**Decision of 15 November 2026 (option A; roadmap status and [ARCHITECTURE D10-D12](ARCHITECTURE.md#7-decisions-on-record)).** The
whole-image path cannot reach the JavaScript-relative limits; the fluid path for every image size is the tile store of part C. So:
part A closes with M8.4.7 and M8.4.8; part C follows (cards below, its first card measures and applies rule D11); part B comes after
part C and is reviewed then; M8.4.6 is deferred. Interactive paths are accepted from part C on against the absolute targets of
[contract §7](roadmap-engine-contract.md#7-predeclared-verification-and-performance-gates).

**Outcome of part A.** With the experiment on, changing a setting re-analyses without uploading any image, and an
edit uploads only the changed rows; scenarios (a)-(c), the memory peak and parity have verdicts on the maintainer's Windows computer.
Nothing changes with the experiment off; no fallback to JavaScript. The maintainer wants an efficient program (14 November 2026): part A
was not to be accepted while a scenario still failed, and a design session was to add the next card. That session (15 November 2026)
chose part C as the fix: part A closes with the matched-timing failure of (a) and (b) **recorded, not hidden**, and the engine
experiment stays off by default.

#### M8.4.1 - Measure the scenarios and give every gate a verdict — state: Done (14 Nov 2026, branch `work/2026-11-13`)

- **Goal:** `tools/measure_engine_analysis.mjs` reports pass or fail for matched timing on scenarios (a)-(c) and for
  the memory peak, and records a baseline before any optimisation.
- **Read first:** contract §7; [M8.3.8 summary](validation/M8.3.8-engine-analysis-summary.md) including its
  correction; the tool.
- **Change:** contract §7 (the scenarios, as decided); the tool; new evidence `docs/validation/M8.4-baseline-windows.json`
  and a short summary next to it; this card's result.
- **Do not touch:** the limits of §7; engine, bridge and interface code.
- **Steps:**
  1. Write the decided scenarios into §7.
  2. Scenario (a): set the interval size from 2 to 1.37 cm and back; there is no new mask version, so the JavaScript
     reference uses its cached row counts. Scenario (b): one edit through the interface's own edit path on the largest
     section (a stroke of about 20 x 100 pixels), then undo, then redo, each timed to the published result.
     Scenario (c): no change. Cold opening: reported only.
  3. Sample the Electron process tree with the experiment off as well, so the memory-peak gate has its comparison.
  4. Replace `timing_not_a_gate` by verdicts computed from the formula of §7, written as a pure helper.
- **Tests:** `node --test` on the verdict helper with hand-computed limits on both sides of each boundary; one full run.
- **Done when:** the baseline is committed with a verdict for every gate and scenario. Expected today: (a) and (b) fail.
- **Result (14 November 2026):** [baseline](validation/M8.4-baseline-summary.md). (a) fails (public 1,779 ms against a limit of 51 ms; synthetic 3,730 ms), (b) fails (358 ms against 59; 569 against 68), (c) passes, the memory peak passes (880 MiB against 1,052; 1,010 against 1,092) and parity passes. New: `tools/engine_gates.mjs` (the rules of §7 as pure functions, 7 tests) and the `scenarios` phase of the measuring tool, which now also samples the memory of the flag-off run. The edit is the deletion of a trace, not a paint stroke (the contract text says so).

#### M8.4.2 - Section inputs stay resident in the engine — state: Done (14 Nov 2026, branch `work/2026-11-13`)

- **Goal:** when the mask did not change, an analysis uploads only the five JSON tables; labels, exclusion and
  overlap stacks already in the engine are reused.
- **Read first:** `app/js/engineclient.js`, `engineanalysis.js`; `sectionanalysis.js` (`analysisRevision`,
  `buildIntervalSnapshot`); `desktop/engine-ipc.js` (token ownership, `MAX_TOKENS_PER_PAGE`);
  `src/sedcoretool/engine/buffers.py` (session budget, the 128-buffer cap); contract §3 limits; in `app.js`,
  `lazyMask`, `beginOp` and `afterChange` (where the mask version `_mv` changes).
- **Change:** `engineclient.js` (a per-section table of resident input tokens and the mask version they hold,
  least-recently-used, bounded at 256 MiB); `engineanalysis.js` (drop a section's resident inputs when the section or
  the project closes); `buffers.py` and `engine-ipc.js` (buffer and token count caps sized for resident inputs; the
  512 MiB byte budget does not change); contract §3 (the reuse rule and the caps); tests.
- **Do not touch:** the method, the result contract, `s.bins`, saving; the rule that the page never sees engine handles.
- **Steps:**
  1. Reuse only when the section's `_mv`, width, height and a signature of `s.stacks` (length and number of members)
     all equal those of the upload: the invariant the JavaScript row-count cache `_rc` already relies on. Otherwise
     upload again.
  2. `LIMIT_EXCEEDED` when beginning a buffer: release the least recently used resident inputs of other sections and
     try once more; a second failure is the section's error state.
  3. A token the bridge no longer knows (the engine restarted) makes the section upload again once.
- **Tests:** Node with the fake bridge: after an interval-size change only the JSON tables are uploaded; after an
  edit everything is; eviction order and byte bound; release on close; a restarted engine. Python: the new caps.
  Desktop end-to-end: an interval-size change with the experiment on matches the JavaScript reference. Measure (a).
- **Done when:** the tests pass and scenario (a) is measured and recorded (it may still fail until M8.4.3).
- **Result (14 November 2026):** `engineclient.js` keeps each section's four masks (valid for one `maskIdentity`) and five tables (valid for their SHA-256) in the engine; an interval-size change uploads only the settings table. 14 new tests in `engine-analysis.test.mjs` (reuse, replacement, eviction by bytes and by section count, a section too large to keep, restart of the engine, abort, full engine budget) and 12 deliberate faults, all caught; one existing queue test waited on the wrong promise and now waits on the current request's. Caps raised: 256 live handles in the engine (`MAX_HANDLES`, was 128), 512 tokens per page. Measured (2 pairs, development evidence): interval change 782 ms public (was 1,779) and 1,452 ms synthetic (was 3,730); edit/undo/redo 363 and 620 ms (unchanged); still failing, as the card allowed. The memory peak passes but the synthetic margin is small (1,075 MiB against a limit of 1,081). The remaining cost per section (about 130-180 ms) is the engine's recount and the 35 result buffers: card M8.4.3.

#### M8.4.3 - Row counts reused in the engine; one result buffer per job — state: Done (14 Nov 2026, branch `work/2026-11-13`)

- **Goal:** an analysis whose mask inputs and effective classes did not change skips counting, and its result
  travels as one buffer instead of about 35.
- **Read first:** `methods/section_intervals.py` (`parse`, `_count`, `run`); `engine/method_worker.py`, `worker.py`,
  `server.py` (`complete_analysis`), `buffers.py` (`adopt`); contract §2 (cache keys), §3 (`section.analyze` result), §5.
- **Change:** `methods/section_intervals.py` (split `run` into pure `count(snapshot, cancelled)` and
  `intervals(snapshot, counts)`); `engine/method_worker.py` (row counts cached in the worker, bounded at 64 MiB; the
  coordinator passes the verified SHA-256 of every input in the job description); one packed result file with a
  layout table, verified as a whole by the coordinator; `desktop/engine-ipc.js` and `app/js/engineclient.js` (one
  read, split by the layout); contract §2, §3, §5 (columns and dtypes unchanged, only their transport); tests.
- **Do not touch:** formulas, fixtures, and the method name and version (results are identical).
- **Steps:**
  1. Cache key: SHA-256 of `labels`, `exclude`, `stack_offsets` and `stack_members`, the bytes of the object-to-class
     table that `parse` derives, the set of listed object IDs, and the ROI. Nothing outside the key may influence
     `count`. The label check of `parse` is skipped only on a hit.
  2. Layout `{name: {dtype, shape, offset, byte_length}}`: offsets aligned to 8 bytes, inside the buffer, no overlap,
     exactly the columns of §5; anything else is `INTERNAL` and nothing is adopted.
  3. The cache lives and dies with the worker, which is replaced after any anomaly and stopped after 30 s idle.
- **Tests:** a hit and a miss for every key component, mutation-tested (dropping any component must fail a test); the
  byte bound; no entry survives a replaced worker; every fixture through the real coordinator unchanged; layout
  attacks (overlap, out of range, wrong dtype, missing or extra column).
- **Done when:** the tests pass; scenario (a) is measured with its stage breakdown and verdict.
- **Result (14 November 2026):** (1) the worker remembers, by the SHA-256 of the inputs that the coordinator verified, the masks it validated and counted (16 entries, 64 MiB), and up to 64 decoded tables; (2) the worker writes ONE packed result file with a layout and the coordinator verifies it in one pass and moves it (`BufferStore.adopt_packed`; the first version packed in the coordinator and spent 99 ms of 125 ms opening 55 files, found by profiling), so a result is one handle, one download; (3) three latency fixes: the coordinator looks for a finished job every 2 ms instead of every 20, a metadata buffer is read once to verify, and the client no longer waits for buffers to be released. Contract §3/§5 amended (`outputs.result` + `layout`). Tests: 32 for the memory (every part of the key, bounds, rejections), 9 for the packing (25 refusals), 25 misbehaving-worker cases rewritten, a worker-level test that counting really happens once; 45 deliberate faults, all caught (the symbolic-link refusal can only be exercised on Linux and macOS: it is skipped on this Windows account). Measured (3 pairs; before M8.4.1 / now): interval change 1,779 -> 198 ms (public) and 3,730 -> 285 ms (synthetic), limit 52; edit, undo, redo 358 -> 227 ms and 569 -> 381 ms, limit 58-68. Per section the interval change now costs 33-36 ms (about 15 ms engine, 15 ms of bridge calls, the rest dispatch), so eight sections cannot reach 51 ms one request at a time: see the new card M8.4.6.

#### M8.4.4 - After an edit, only the changed rows travel — state: Done (14 Nov 2026, branch `work/2026-11-13`)

- **Goal:** an edit, undo or redo uploads only the changed rows of labels and exclusion onto the resident copy; the
  engine verifies the complete result before using it.
- **Read first:** in `app.js`, `beginOp`, `commitOp`, `swapEditStep`, `compactSectionStacks`, `lazyMask`;
  `app/js/engineclient.js`; `engine/buffers.py`; contract §3 (`buffer.begin`, `buffer.chunk`, `buffer.commit`).
- **Change:** contract §3: new `buffer.derive {base, byte_length, sha256}`, a staging buffer that starts as a copy of
  the committed `base` (same dtype and shape), whose chunks may come at ascending, non-overlapping offsets; commit
  verifies the SHA-256 of the whole result as today; the full length is charged to the budget.
  `engine/buffers.py`, `server.py`; `desktop/engine-ipc.js`, `preload.js` (`deriveBuffer`); new pure module
  `app/js/maskchanges.js` (changed row ranges since a mask version); `app.js`, wiring only (`commitOp` and
  `swapEditStep` report the rows of `op.lm` and `op.ex`; the mask setter and stack compaction, which renumbers
  overlap codes everywhere, report all rows); `engineclient.js`; `tools/build_standalone.py` (`ORDER`); tests.
- **Do not touch:** the editing tools, edit history and saving; the rule that a buffer is committed only when its full
  SHA-256 matches.
- **Guarantees (maintainer's condition for decision 1):** (1) the edit path never waits for the engine: the changed rows are sent
  afterwards, in the background, and a newer edit replaces a pending send; (2) the renderer's data is the only source of truth: any
  engine, transfer or copy failure leaves the edit, the undo history and the last good save exactly as they were and shows an error
  state (no JavaScript fallback); (3) a derived copy is used only after its full SHA-256 equals the renderer's; (4) input-to-next-frame
  p95 during a stroke with the engine on is not worse than with it off (measured by `tools/measure_engine_analysis.mjs`); (5) a test
  kills the engine in the middle of a send and requires an unchanged project and a successful save.
- **Steps:**
  1. The page hashes the current labels and exclusion in full (15 ms for 24.6 MB in Node 22) and sends only the changed
     row ranges; unknown ranges mean a full upload.
  2. A hash mismatch at commit means a change was missed: drop the resident copy, upload in full, and count the event
     in the opt-in diagnostics; the end-to-end test requires the count to stay at 0.
- **Tests:** Node: row ranges from edits, undo and redo, and their merging; the mismatch path. Python: derive from a
  staging or released base; chunks out of order, overlapping or out of range; a mismatched hash commits nothing and
  restores the budget. Desktop end-to-end: paint, undo and redo with the experiment on match the JavaScript reference,
  and a small stroke uploads less than 5 % of the mask bytes. Measure (b).
- **Done when:** the tests pass; scenario (b) is measured with its verdict.
- **Result (14 November 2026):** `buffer.derive` in the store, the coordinator, the main-process allowlist, the bridge (`deriveBuffer`; parts at ascending offsets) and the client; `app/js/maskchanges.js` (new, pure, strict type check) records the rows the editing code writes (`setLabel`, `setEx`, undo/redo through the history pairs, whole-mask replacement and stack renumbering as "all"); the page hashes the whole current array and the engine accepts the derived buffer only on that hash. The guarantees of the card hold by construction and by test: the edit path never waits for the engine (it is requested in the background as before); a failed or cancelled transfer puts the change back; a missed pixel is a refused commit, then a full upload, counted (`deriveFallbacks`, visible as `window.ichantool.engineStats()`); the renderer's arrays are never touched. The desktop end-to-end test with the engine on asserts that a deletion, its undo and its redo travelled as rows (3 derivations, 0 fallbacks). Tests: 7 for the record, 11 for the client flow (rows only, unreported write, whole-mask changes, undelivered change, restarted engine, abort), 3 IPC, 6 store, 1 coordinator, 1 with the real client and engine; 22 deliberate faults, all caught (one equivalent mutant: an incomplete ordinary buffer is refused with another error field either way). Found by the end-to-end test only: the main-process client has its own allowlist of operations and did not know `buffer.derive`. Measured (3 pairs; before M8.4.1 / after M8.4.3 / now): edit, undo, redo 358 / 227 / 149 ms (public) and 569 / 381 / 224 ms (synthetic), limit 56-67 ms: still failing; what is left is the page's hash of the masks (about 20 ms), the engine's copy and verification of two buffers (about 30 ms), the count (about 40 ms) and the bridge: card M8.4.5.

#### M8.4.5 - Recount only the changed rows — state: Done (14 Nov 2026, branch `work/2026-11-13`)

- **Goal:** after an edit, the worker counts only the rows that changed. Measured before this card (M8.4.3): counting a
  6.1-Mpixel section takes about 40 ms and a whole edit about 230-380 ms; with M8.4.4 the upload disappears, and what
  remains is the page's hash of the masks (15 ms), the engine's verification (about 15 ms), this count and the bridge.
- **Read first:** `methods/section_intervals.py` (`_counts`, `new_memo`); `engine/method_worker.py`; `engine/buffers.py`
  (`derive`, from M8.4.4); contract §3 (job description).
- **Change:** `buffer.derive` records, on the derived buffer, the SHA-256 of its base and the merged row ranges that
  differ; the job description gives the worker, for each mask, `derived_from: {sha256, rows: [[first, last), ...]}`;
  `section_intervals.run` takes a `base_counts` (the counts memo of the base masks, same ROI, class table and stacks):
  it copies them and recounts only the rows of the ranges inside the ROI. Contract §3 and the technical manual.
- **Do not touch:** the result, its layout or the full-count path (a missing base, another class table or another ROI counts
  everything, as now).
- **Tests:** an edited section counted from its base equals the full count, exactly, for random edits including rows at
  the ROI edges, overlaps and exclusions; a base that is not in the memo, a class table that changed or a range that is
  not what the hashes imply falls back to a full count and never to a partial one; mutation tests for the ranges.
- **Done when:** the tests pass and scenario (b) is measured with its verdict.
- **Result (14 November 2026):** the coordinator records, for a buffer made with `buffer.derive`, the hash of its base and the byte ranges it wrote, and passes them to the worker (`derived_from`); the worker validates and counts only those rows when it remembers the base and every object listed in both versions has the same effective class (deleting or adding a trace qualifies; reassigning a class, other stack tables, another ROI or number of classes count everything), and the whole label image is still validated whenever the list of objects changed. The first version required an identical object-to-class table and so never applied to a deletion: the measurement showed no gain and a check confirmed it. Tests: 12 random edits (rows at the ROI edges, several ranges, whole image) equal to a full count with exactly the written rows counted; deletion, addition, reassignment; a deletion whose pixels remain outside the written rows is refused; label and exclusion checks limited to written rows only when the base is known; a worker-level test that counts the rows. 21 deliberate faults, all caught. Measured (3 pairs): edit, undo, redo 147 ms (public) and 211 ms (synthetic), from 149 and 224 after M8.4.4; limit 59-68 ms, still failing. A breakdown of a deletion through the interface on the largest public section (2.6 Mpixel): snapshot about 10 ms, upload about 53 ms (the objects table changes with every deletion; both masks are derived even when only the labels changed, and each derived mask is copied and fully re-hashed by the engine), engine 18-40 ms, download 1 ms, and 30-50 ms between the action and the job. The full-content hash that the maintainer's condition requires costs about 15 ms per 6 Mpixel on each side.

#### M8.4.6 - Several sections in one request — state: Deferred (15 November 2026)

- **Deferred** by the decision of 15 November 2026: a whole-project setting change already measures 229-259 ms (M8.4.5), within the
  300 ms interactive target of contract §7, and the whole-image path is not where the fluidity work goes. Resumed only if a part C
  measurement shows that the fixed cost of one request per section (about 15 ms of bridge calls) makes a tiled project miss that target.
  The design below stays valid.
- **Why:** an interval-size change touches every section of a project. Measured after M8.4.3, one request per section costs
  33-36 ms of which about 15 ms is the engine (starting the job, reading the settings, computing from remembered counts, writing
  the result) and about 15 ms is six calls through the page, the main process and the engine. Eight sections one after another
  cannot meet the limit of about 51 ms for all of them, whatever is tuned inside one request.
- **Goal:** the sections that need an analysis are sent in ONE request, computed one after another from remembered counts
  and returned in ONE packed result; scenario (a) meets §7.
- **Design:**
  1. New operation `section.analyze_batch`: `{method, items: [{project, section, revision, settings_hash, inputs}, ...]}`,
     at most 16 items; each item has the inputs and checks of `section.analyze`; the settings of an item may travel in the
     request as an object (at most 8 KiB each, 64 KiB the frame) instead of as an uploaded buffer, and the coordinator writes
     them as the `settings` input and derives the hash itself, so nothing is uploaded per item.
  2. One job: the description lists the items; the worker runs them in order with its memories, polls the cancellation marker
     between items and between blocks, and writes ONE packed file whose layout has one section per item. An item with a
     rejected input returns `{error}` for that item only. The answer lists `items: [{section, revision, settings_hash,
     dimensions, layout | error}]` and the one `outputs.result`.
  3. The page asks for the batch from `analyzeSections(sections)` (and from a project load); `engineanalysis.js` keeps its
     per-section revisions, cancellation and stale-result rules: a result is published per item and only if its revision is
     still current.
  4. Limits: the packed result obeys the 256 MiB buffer limit; a batch whose estimated result would exceed it is split.
- **Do not touch:** `section.analyze` (kept for a single section), the method, the columns and their formulas.
- **Tests:** a batch equals the same sections analysed one by one, for every fixture and for mixed valid and invalid items;
  cancellation during a batch; a stale item is not published while its neighbours are; a batch with 17 items, an item whose
  inputs are not resident, and the result-size split; a misbehaving worker for the batch frame; mutation tests.
- **Done when:** the tests pass and scenario (a) is measured with its verdict. If it still fails, record the stage breakdown
  and stop: the next change would be to run the interval table of resident sections inside the engine without a request per
  change, which needs a decision of the maintainer.

#### M8.4.7 - Restart after a coordinator failure — state: Done (15 Nov 2026, branch `work/2026-11-13`)

- **Goal:** the behaviour chosen in decision 5: a section in the error state offers "Retry", which starts a new engine
  session and resubmits only the current snapshots (contract §3 already requires fresh tokens); at most one automatic
  restart per program session, announced with a notice. The JavaScript calculation is never used.
- **Read first:** `desktop/engine.js` (`createEngineService`: start, stop, status); `desktop/engine-ipc.js` (tokens belong to
  a session); `app/js/engineanalysis.js` (`retry`, error state); `app/js/i18n.js` (`engine.error.*`); the kill phase of
  `tools/measure_engine_analysis.mjs`.
- **Change:** `desktop/engine.js` (a `restart()` that stops what is left, starts a new coordinator and handshake, refuses
  to run twice at once and counts automatic restarts); `desktop/preload.js` and `engine-ipc.js` (the call `restart`, with
  the sender check; it drops the page's tokens: they belong to the old session); `engineclient.js` (forget all resident
  buffers when the session changes); `engineanalysis.js` and the interface (a "Retry" control in the error state of a section;
  one automatic attempt per session when the engine is unavailable, with a notice); texts in Spanish and English.
- **Do not touch:** the rule that a failed engine shows an error and never falls back to JavaScript; the experiment flag.
- **Tests:** Node: restart after the coordinator dies, a second restart request while one runs, the automatic attempt is made
  once and announced, tokens of the old session are refused, resident buffers are re-uploaded; the kill case of the
  measuring tool now ends with every section analysed again; desktop end-to-end with a killed coordinator.
- **Done when:** the tests pass and the kill measurement shows the engine `ready` again and parity with the reference.
- **Result (15 November 2026):** `createEngineService.restart({automatic})` (desktop/engine.js) ends the old process tree, starts a new coordinator and shakes hands; two requests at once share one restart, a disabled service or one that is closing refuses it, and an automatic request after the first is refused with `LIMIT_EXCEEDED` (field `automatic`). The bridge operation `restart` (engine-ipc.js, preload) validates its options (only a boolean `automatic`) and drops the tokens of every page. `engineclient.js::restart` forgets every resident input without releasing it into the new session. `engineanalysis.js`: an analysis that fails with `ENGINE_UNAVAILABLE` asks for the one automatic restart (not if it was cancelled meanwhile), announces it with a notice and sends everything whole; if refused or failed the section keeps the error. `restartAndRetry(sections)` is the user's Retry (button `#engineRetry` in the error state of the results panel): new session, then only the sections in error are analysed again. The JavaScript calculation is never used. Tests: 8 in `engine-analysis.test.mjs`, 4 in `engine-ipc.test.mjs`, 5 with the real engine in `engine.test.mjs`; 14 deliberate faults, all caught (one of them, removing the guard against repeated restarts, loops forever and is caught by the time-out). Desktop end-to-end (engine on): the coordinator killed twice, the first loss repaired by itself with results equal to the reference, the second shows `ENGINE_UNAVAILABLE` on all six sections, Retry brings them back equal to the reference, the project unchanged; engine off unchanged. Kill phase of the measuring tool: after the coordinator is killed the engine is `ready` again and all six sections `ready`. **Not working any more:** the worker-kill part of that phase (it kills a worker while a job runs) found no worker to kill in three attempts, because jobs now last about 150 ms; its verdict `kill_recovery` therefore reads `pass: false`. Not part of this card; a design session should redo that check with a job held in the worker (a test hook) instead of a race.

#### M8.4.8 - Milestone gate of part A — state: measurements done (15 Nov 2026); three-system gate pending the push

- **Goal:** the measurement of M8.4.1 repeated on the final state, with a verdict for every gate and scenario, and the
  milestone gate on Windows, macOS and Linux. V0.151 follows when the maintainer asks for it (decision 4: after part A).
- **Also measured here (review of 14 November 2026, items the earlier cards promised and did not measure):**
  1. Guarantee (4) of M8.4.4: input-to-next-frame p95 during a paint stroke with the engine on is not worse than with it off
     (the `responsiveness` phase of the tool measures an interval-size change; add a stroke: 60 injected pointer moves while
     the brush writes and the previous edit's analysis is in flight).
  2. A coordinator killed in the middle of a derived transfer (desktop end-to-end, not only the Node test): the section shows
     the error, the project is unchanged, and the save that follows succeeds and reopens.
  3. The `smoke.mjs` browser test run locally (it needs the server of DEVELOPMENT §2), and the three-system *Desktop builds*
     on the final commit.
  4. The verdicts of contract §7 for the whole-image path: matched timing for (a)-(c) (expected to fail for (a) and (b): record it with
     the stage breakdown, it is not a reason to stop) and, for information, the interactive targets that already apply to it ((a) p95 <= 300 ms,
     (b) p95 <= 150 ms). Neither blocks the milestone gate: by the decision of 15 November 2026 the timing fix is part C, and the engine
     experiment stays off by default.

#### Part C - Multi-gigabyte images and fluidity (option A)

Decided on 15 November 2026 and done **before part B**; required for 1.0 (decision 2 above). It delivers M2.3.1-M2.3.5 of
[roadmap-future.md](roadmap-future.md#m2---large-projects-and-responsive-display) on the tile store of
[ARCHITECTURE §3.4](ARCHITECTURE.md#34-tile-store-for-large-images-planned-part-c-of-m84), whose rules every card follows. Acceptance is
measured against the interactive targets of [contract §7](roadmap-engine-contract.md#7-predeclared-verification-and-performance-gates).
Cards M8.4.12, M8.4.13 and M2.1.4 are detailed below and only measure; **M8.4.14-M8.4.19 are summaries that a design session details with
those measurements before any of them starts.** Every card claims the development gate; M8.4.19 is the milestone gate. Not in part C:
filtering, detection, object features and U-Net on tiles, which are M8.5 slices (b) and (e) working on regions of the store. Known trap for
any card that moves float data: the coordinator checks float64 buffers in pure Python (63 ns per value, about 1 s per 128 MiB); large float
data must be checked in the worker with NumPy.

##### M8.4.12 - Round trip of a one-tile edit, and rule D11 — state: Done (15 Nov 2026); outcome D by the rule, design session to confirm

- **Goal:** the interactive-calculation rule of contract §7 is applied once, with a measurement through the real chain, and its outcome is
  written into ARCHITECTURE D11. No product code changes.
- **Why a stand-in is enough:** the tile store does not exist yet, but the chain that an edit of a tiled section will use (page, main
  process, coordinator, worker, result, page) exists. In a project whose sections are exactly one tile (512 x 512 pixels), an edit makes
  that chain carry about the bytes and hashes of one edited tile, so scenario (b) on such a project measures the fixed cost of the chain
  plus one tile. The rest of a large section (turning its row counts into the interval table) is measured in-process and added.
- **Read first:** contract §7 (matched timing, the scenarios, the interactive targets and the rule); `tools/measure_engine_analysis.mjs`
  (`scenarioRun`, option `--synthetic`); `tools/benchmark.py` (`make_synthetic`, which has a `height` option and a fixed width of 960);
  `src/sedcoretool/methods/section_intervals.py` (`run`, `_counts`: a call whose counts are remembered goes straight from row counts to
  the table); `tests/test_section_intervals.py` (how inputs are built for `parse`); the [M8.4 baseline summary](validation/M8.4-baseline-summary.md)
  as the model of the evidence; DEVELOPMENT §4 (rebuild the bundled runtime and `desktop/web` before measuring).
- **Change:** `tools/benchmark.py` (a `width` option for `make_synthetic`, default 960; traces placed inside the width; the default package
  must stay byte-identical, shown by its SHA-256 before and after); new `tools/measure_interval_table.py`; evidence
  `docs/validation/M8.4.12-round-trip-windows.json` and `docs/validation/M8.4.12-round-trip-summary.md`; ARCHITECTURE D11 (the outcome);
  this card's result; `docs/TECHNICAL_DOCUMENTATION.md` §1.4 (the new tool); `CHANGELOG.md` (Internal).
- **Do not touch:** engine, bridge and interface code; the targets and the rule in contract §7 (changing them is a maintainer decision).
- **Steps:**
  1. Generate the stand-in project: eight sections of 512 x 512 pixels (`make_synthetic(path, width=512, height=512)`), seed unchanged;
     record its SHA-256 and the area of the trace that scenario (b) deletes (the one closest to 2,000 pixels, as today).
  2. On the primary reference host (the maintainer's Windows computer), with runtime and `desktop/web` rebuilt:
     `node tools/measure_engine_analysis.mjs --only scenarios --pairs 6 --synthetic <stand-in>`. Keep the raw JSON. The number used is
     the p95 of scenario (b) with the engine on, edit, undo and redo pooled (18 samples: the p95 is close to the maximum; say so).
  3. `tools/measure_interval_table.py`: build inputs for `parse` of one section of **349,526 rows** (the height of the 8 GiB fixture planned
     in M8.4.13) and 16 classes, 64 columns wide (a remembered count does not depend on the width), call `run` once with a memo to fill it,
     then time 20 more calls with the same memo (all remembered). Report median and p95. Use the method's own functions; copy no formula.
  4. Apply the rule: **A** if p95(step 2) + median(step 3) <= 100 ms, otherwise **D**. Write both numbers, the computer and the outcome into
     ARCHITECTURE D11 and into this card's result. If the outcome is D, stop: a design session revises cards M8.4.14-M8.4.19 first.
- **Tests:** `make_synthetic` with a width option: dimensions, determinism, traces inside the image, and the default package unchanged
  (hash); `tools/measure_interval_table.py` checks that every timed call returned the same columns as the first (a memo hit, not a recount).
  `pytest` on the touched tests; one full measurement run.
- **Done when:** the evidence is committed, D11 states its outcome, and the roadmap status names the next card.
- **Result (15 November 2026):** [summary](validation/M8.4.12-round-trip-summary.md). One-tile edit through the whole chain: median 71.9 ms, p95 793.8 ms (18 samples, one stall of 794 ms, the other 17 between 70 and 117 ms); the row counts of a 349,526-row section take 237.7 ms median to become their table. 794 + 238 > 100: **the rule's outcome is D**. But 225 of those 310 ms are a per-interval Python loop (`sum_by_interval`), which makes the outcome depend on an implementation detail; the card stopped as it prescribes for D. `make_synthetic` gained a `width` option (the default package is byte-identical, checked by hash and test); `tools/measure_interval_table.py` is new. **Needed from a design session before M8.4.14:** accept D, or add a card that vectorises the kernel (exact integer sums, same fixtures) and repeat the measurement, or change the rule.

##### M8.4.13 - Multi-gigabyte fixtures and the baseline (M2.3.1) — state: In progress (generator done 15 Nov 2026; the files and the baseline measurement are not made yet)

- **Goal:** deterministic generated images of 2, 4 and 8 GiB (and a compressed file whose decoded size is 8 GiB) can be produced on demand,
  and what the current program does with them is measured. This gives part C its test material and its starting point. No product
  code changes.
- **Read first:** M2.3.1 in [roadmap-future.md](roadmap-future.md#m2---large-projects-and-responsive-display) (what to record); contract §7
  (interactive targets, memory sampler); `app/js/tiff.js` (`decodeTiffBlocks`: the program already reads TIFF and BigTIFF in blocks) and
  `app/js/app.js` `decodeBytes` (how the working downsampling factor is chosen); `tools/benchmark.py` (generator conventions, seed);
  `tools/measure_engine_analysis.mjs` (how a desktop measurement drives the program and samples memory).
- **Change:** new `tools/make_large_fixtures.py`; new `tools/measure_large_images.mjs`; evidence `docs/validation/M8.4.13-large-baseline-windows.json`
  and its summary; `docs/TECHNICAL_DOCUMENTATION.md` §1.4 (the two tools); `CHANGELOG.md` (Internal).
- **Do not touch:** the program. **No fixture is ever committed** (they are gigabytes): the generator writes to a folder given on the command
  line, refuses a folder inside the repository, and checks the free disk space before writing.
- **Steps:**
  1. Generator, standard library + NumPy only (no new dependency). Pixel content is a pure function of the coordinates and the seed
     (138501): every 512 x 512 block gets its own PCG64 stream seeded with (seed, block row, block column), drawn over a structure of
     horizontal layers and burrow-like blobs that depends only on the row and column. So any region can be regenerated exactly, which later
     cards use as the independent reference. Files, all 8,192 pixels wide (16 tiles):
     (a) uncompressed tiled BigTIFF, RGB 8-bit, 87,382 / 174,763 / 349,526 rows (about 2, 4 and 8 GiB decoded);
     (b) the 2 GiB image as striped BigTIFF; (c) a grey 16-bit tiled BigTIFF of 131,072 rows (2 GiB);
     (d) the 8 GiB image as a deflate-compressed tiled BigTIFF; (e) a baseline JPEG of 65,535 rows (the format's maximum).
     TIFF files are written by the generator's own minimal writer (`struct`, `zlib`); write in blocks so memory stays below 1 GiB. Option
     `--only` selects files. The whole set needs about 20-30 GiB (it depends on how well (d) compresses): print the estimate in the help
     text and before writing.
  2. Independent check of every file: Pillow on the small sizes used by the unit tests; for the large files the program's own block reader
     (`tiff.js`, loaded in Node with `fs.openAsBlob`) on 20 sampled regions per file, compared byte for byte with the generator's function.
     Record per file: dimensions, channels, bit depth, compression, tile or strip layout, encoded and decoded bytes, SHA-256, generation time.
  3. Baseline on the primary reference host, engine experiment off and on: import each file through the interface, record what happens
     (refusal and its message, the downsampling factor chosen, or the failure), the time to the first frame with image content, the
     process-tree memory peak (the sampler of §7), and whether pan, zoom, one brush stroke and the interval table work. Failures are results
     here, not defects to fix.
  4. Record the hardware. A 16 GiB computer is listed as not measured unless one is available.
  5. From the baseline, propose (do not decide) the size above which a section should be tiled, for the design session.
- **Tests:** the generator on small sizes: determinism (same bytes twice), header fields read back by Pillow, region equality with the pure
  function, refusal of an output folder inside the repository and of a disk without room (simulated). `pytest` and `node --test` for the
  touched tools.
- **Done when:** the generator and the baseline evidence are committed, and the summary lists, per file, what works today and what does not.

##### M2.1.4 - Tables and figures with 100,000 rows: measure — state: Ready after M8.4.13

- **Goal:** know where the program stops being fluid with tens of thousands of data rows: the Data table (with and without the visible-row
  rendering of M2.1.3), the figures and the multiproxy charts. Measure only; the fixes become cards of the design session.
- **Read first:** [M2.1.3 benchmark](benchmarks/M2.1.3.md) (its fixtures and tool); contract §7, last row of the interactive targets;
  `app/js/tableview.js`; `app/js/plot.js`, `figures.js`, `multiproxy.js` (how a figure is drawn: one SVG element per point or not).
- **Change:** extend the M2.1 measuring tool or add `tools/measure_large_tables.mjs`; evidence `docs/benchmarks/M2.1.4.md` (raw JSON small, or
  outside the repository: card H3); `docs/TECHNICAL_DOCUMENTATION.md` §1.4 if a tool is added; `CHANGELOG.md` (Internal).
- **Do not touch:** the program.
- **Steps:**
  1. Reuse the generated M2.1 projects at 20,000 and 100,000 rows (public or generated data only).
  2. Measure: frame intervals while scrolling the Data table for 5 s, visible-row rendering off and on; opening the table; drawing a depth
     plot and a cross-plot of 50,000 and 100,000 points, and redrawing them after one setting change; the multiproxy chart with the same
     series; the response to hovering and selecting a point. Count the DOM and SVG elements each view creates.
  3. Report each case against the target (frame interval p95 <= 33 ms) and, for each failing case, the slowest step from a CPU profile.
- **Tests:** the tool's own checks (it measures).
- **Done when:** the evidence is committed with a verdict per case.

##### M8.4.14 to M8.4.19 - summaries (detailed by a design session after M2.1.4)

- [ ] **M8.4.14 - Tile store and pyramid import (M2.3.2).** The store format of §3.4 specified in the engine contract (a new section) and the
      technical manual before any file is written; the engine imports a source file into a pixel pyramid in the background, with progress,
      cancellation and a bounded memory budget, and reads tiles by level and position; the main process names the store folder. Includes the
      decoder choice for TIFF/BigTIFF (tiled, striped, deflate, 16-bit) and JPEG, comparing Pillow, a minimal own TIFF reader and other
      libraries on capability, packaging size and offline cost: **a new dependency needs the maintainer's approval** (AGENTS §3.9). Acceptance:
      sampled pixels equal the generator's function exactly; corrupt tiles, oversized declarations, interruption and a full disk are handled;
      pyramid-building throughput reported.
- [ ] **M8.4.15 - Tiled viewer (M2.3.3, display).** The section view, the navigation strip and the depth mapping show a tiled section from a
      bounded page cache (visible tiles and a margin, prefetch, obsolete requests cancelled, a lower level shown while the full level
      arrives), with full-resolution coordinates and depth positions identical to today's. Behind a new flag (its row added to the flag table
      when built). Acceptance: the pan, zoom, first-view and memory targets on the M8.4.13 fixtures. Also measures the tiled path on small
      sections, for rule 6 of §3.4.
- [ ] **M8.4.16 - Tiled masks, editing and undo (M2.3.3, editing).** Mask tiles in the store (content-addressed, versioned); every editing
      tool works on loaded tiles; undo and redo bounded and per tile; changed tiles sent in the background and sent again after an engine
      failure. Acceptance: the input-to-next-frame target during strokes; the guarantees of M8.4.4 at tile granularity; exported masks
      identical to the whole-image path on fixtures that fit in memory.
- [ ] **M8.4.17 - Interval table of tiled sections (M2.3.4, counting).** Per D11: row counts per tile and the interval table in the engine
      (A) or in the page (D). Acceptance: exact equality with `section.intervals/1` on whole images that fit in memory, including objects and
      overlaps that cross tile seams, exclusions and fractional intervals; the 150 ms and 300 ms targets.
- [ ] **M8.4.18 - Saving, reopening, backup and export of large projects (M2.3.5 and the export part of M2.3.4).** The save order of §3.4
      rule 4; the project record names the store version (a versioned extension of the project format, with old projects opening unchanged);
      folder backup; a portable copy versus a reference to an external source file, with checksums and recovery of a missing or moved source;
      streamed export of masks and images. Acceptance: failure tests (disk full, interrupted save, partial cache, killed engine) that keep the
      last good save; multi-gigabyte projects reopen with unchanged source bytes, masks and results.
- [ ] **M8.4.19 - Milestone gate of part C.** Windows, macOS and Linux on one commit; the interactive targets measured on the primary
      reference host with the fixtures; what was not measured listed (16 GiB computer, Intel Mac, clean machines, macOS and Linux timing).

- **Result of the measurements (15 November 2026):** [summary](validation/M8.4.8-final-summary.md). Matched timing still fails for (a) and (b) (public 226 and 166 ms against limits of 51 and 60; synthetic 305 and 271 against 51 and 68); (c), the memory peak and parity pass; the interactive targets are met for (a) on the public example and not for (b); input during a stroke is 15.6 ms p95 with the engine on and off; the desktop end-to-end test survives a coordinator killed during an undo. The three-system milestone gate is the push of the work branch (item 3 above needs the CI runners).

#### M8.4.20 - Engine speed: what is left of the "velocidad del motor" list — state: Ready after M8.4.8 (placed here at the maintainer's request, 15 November 2026)

- **Origin:** the maintainer asked for a card "Velocidad del motor" with six items: a persistent worker, uploading each label image once and reusing it by hash, shared memory instead of IPC chunks, a faster hash, several sections in parallel or in one job, and the 25 ms memory sampler with the M8.3.8 measurements repeated; approved or failed by the timing comparison. Four of the six exist (persistent worker: corrections after M8.3.8; label image uploaded once and reused: M8.4.2; only changed rows travel: M8.4.4; sampler at 25 ms and the repeated measurements: M8.3.8, M8.4.1, M8.4.8). The number M8.3.9 of the request was already the cross-platform gate.
- **Goal:** evaluate, with measurements, the three items that are not done, and decide for each: adopt, reject, or ask the maintainer.
- **Read first:** [M8.4.8 summary](validation/M8.4.8-final-summary.md) (where the time goes: upload about 50 ms per edit, engine about 20 ms, bridge about 15 ms per request); M8.4.6 (batch design, deferred); contract section 3 (SHA-256 in `buffer.begin` and `buffer.commit`, 1 MiB frames).
- **Change:** evidence only unless a measurement justifies a change; any change is its own card. Items:
  1. **Shared memory instead of 1 MiB chunks** for large buffers: measure the copy and framing cost of one 25 MB upload (page, main process, engine) against a memory-mapped file in the scratch folder written by the main process. The page still never names paths; the file is in the engine's private scratch folder; the same hash check applies.
  2. **A faster hash** (xxHash, BLAKE3): the contract requires SHA-256 for identity (cache keys, settings hash, verified copies). **A change of hash is a decision for the maintainer, not an implementation detail**: report the measured saving first (the page hashes about 15 ms per 24 MB and the engine verifies again).
  3. **Several sections in one job**: resume the design of M8.4.6 only if a measurement shows that the per-request cost (about 33 ms per section) matters for the interactive targets of contract section 7.
- **Acceptance (as the maintainer stated it; measured, not argued):** (i) analysis of one large section <= 100 ms with a cold cache and the worker already running; (ii) the whole public example <= 2x the JavaScript time; (iii) the ten-cycle memory test within +64 MiB; (iv) identical results on the fixtures. Measured today: (i) not met (a cold analysis of the six public sections took 1.6 s in M8.3.8, about 0.6 s with resident inputs); (ii) not met (226 ms against 2 x 1.4 ms); (iii) met (M8.3.8, corrected); (iv) met. **Criteria (i) and (ii) cannot be met by the whole-image path** with a separate process that verifies every image by its full hash; the design session of 15 November 2026 chose the tile store of part C for that reason. This card therefore reports the verdicts and **does not block part C** unless the maintainer declares it blocking.
- **Do not touch:** the hash in the contract, the transport and the method, without a decision.
- **Done when:** the three evaluations are recorded with numbers, the four criteria have a verdict, and the maintainer has been asked about the hash if its saving is worth a change.

**Part B - what M8.5 needs from the engine (cards written in the design review of 14 November 2026).**

**Order (15 November 2026): part B comes after part C** and the design session that closes part C reviews these cards: if every section
moves to the tile store ([ARCHITECTURE §3.4](ARCHITECTURE.md#34-tile-store-for-large-images-planned-part-c-of-m84) rule 6), M8.4.9 is
replaced by reading tiles from the store; M8.4.10 does not depend on images and stays as written.

Why part B exists: the image methods of M8.5b/e and the table methods of M8.5a/d would otherwise upload their inputs on every
call, which is exactly what made the first slice 30-60 times slower than JavaScript. Design choice recorded here: **in part B the
engine receives the pixels the interface has already decoded** (the working array after downsampling, crop and rotation), once per
section, and does not decode image files itself. Reason: the renderer's decoders (browser decoding, `tiff.js`, the downsampling
factor) are the authority for what a section's pixels are; a second decoder in the engine would need its own proof of identity
for every format and would still disagree on JPEG. The engine decodes files only in part C, where a multi-gigabyte file cannot
be decoded by the interface at all, and that card will carry the parity evidence.

#### M8.4.9 - Section pixels resident in the engine — state: after part C (reviewed then; may be replaced)

- **Goal:** a section's working pixels (8-bit RGBA `orig` and, when present, 16-bit `orig16`) are in the engine under an identity,
  so that a method takes handles instead of an upload. No scientific method changes.
- **Read first:** `app/js/engineclient.js` (the resident-input code of M8.4.2); `app/js/app.js` where pixels are created or replaced
  (`newSection`, the loader near `s.orig = r.rgba`, `cut` at crop, `rotate90`, the downsample reload near `s.ds = k2`); contract §3
  (limits) and §4; `src/sedcoretool/engine/buffers.py`, `specs.py`.
- **Change:**
  1. Extract the resident-input registry of `engineclient.js` (owner, name, identity, token, bytes, least-recently-used, bounds,
     eviction, `keep`, `forget`) into a pure module `app/js/residentstore.js` with its own tests; `engineclient.js` uses it. No behaviour
     change: the existing 47 tests pass unchanged (this is the review's request for modularity: masks, pixels and tables will share it).
  2. Add the type `u16le` end to end (`buffers.py` `ITEM_BYTES`, `specs.py` `NUMPY_DTYPES`/`CONTRACT_DTYPES`, `engine-ipc.js` `DTYPES`,
     `engineclient.js` `OUTPUT_TYPES`, contract §3), with the same tests the other types have.
  3. `sectionanalysis.js` (or a new pure module `sectionpixels.js`): `pixelIdentity(section)`, the SHA-256 of the working array bytes
     plus its width, height and bit depth, computed when the pixels are loaded or replaced and stored on the section (`s._pxid`), never
     per analysis (hashing 24 MB costs about 15 ms); `buildPixelBuffers(section)` returns `{rgba: u8[h,w,4], rgba16?: u16le[h,w,4]}` as views.
  4. `engineclient.js`: `ensurePixels(owner, section)` uploads those buffers when the resident identity differs and returns their tokens;
     they count against a pixel budget of their own in the registry. A section whose pixels do not fit is not resident (part C).
  5. Budgets: the engine's session budget is 512 MiB. Masks (up to 256 MiB), pixels (up to 192 MiB) and the transient reserve do not
     fit together with working copies. Decide with a measurement of the public example and the generated project, then record in
     contract §3 either lower resident bounds or a session budget of 768 MiB (the disk cap stays 1 GiB). Do not raise it without the
     measurement.
- **Do not touch:** the interface's own use of `orig`/`orig16` and its memory management (`MEM`, `pxTouch`): the renderer still holds
  its copy until part C; the saved project; any method.
- **Tests:** registry unit tests (eviction order, bounds, identity change replaces and releases, forget); identity changes on
  crop, rotation, downsampling and reload, and not on a settings change; upload of a 16-bit section end to end through the real
  engine (bytes read back equal); a section that does not fit is not kept; release on project replacement; mutation tests; the
  desktop end-to-end with the experiment on and off; memory peak measured with pixels resident (record it, compare with §7).
- **Done when:** the tests pass, the memory peak is recorded against the §7 limit, and a probe method (a test-only method that
  sums a region of the resident pixels) reads the same bytes as the interface holds.

#### M8.4.10 - Record tables resident in the engine — state: Ready after M8.4.9

- **Goal:** the tables that M8.5a, M8.5d and M6 consume (depth/age records, data tables, multiproxy series) can be held in the engine
  in one columnar format, so those methods take handles. No scientific method changes.
- **Read first:** M8.4.9 (the registry); contract §4-§5 (the convention for missing values: a value column and a `<name>_valid`
  column, never NaN); `app/js/log.js`, `geo.js` (`featureSeries`, `buildSamples`), `sheet.js` for the shapes of the tables.
- **Change:** a pure module `app/js/tablesnapshot.js`: `buildTableSnapshot(columns)` takes named numeric columns (plain arrays,
  null for missing) and returns `f64le` value columns, `u8` validity columns, the names and units as a small `utf8json` table and an
  identity; limits (columns, rows, bytes) stated and enforced; decoding on the engine side in a helper of `methods/validation.py`
  (`table(inputs, name, columns)`) that rejects a shape, a non-finite valid value or a name that is not allowed, naming the field. Contract
  §4 gets a "tables" paragraph. Resident through `residentstore.js`.
- **Do not touch:** the interface's tables and formulas; saved projects.
- **Tests:** round trip of random tables with missing values, exact for every value and every missing slot; rejection cases for the
  helper; limits; the identity changes with any value, name or unit and with nothing else; a probe method that returns column sums.
- **Done when:** the tests pass and the probe through the real engine equals the interface's own sums.

#### M8.4.11 - Milestone gate of part B — state: after M8.4.10

- **Goal:** the milestone gate (Windows, macOS, Linux on one commit) for part B, and the memory and timing evidence of M8.4.9 (or of its
  replacement) repeated on the final commit. M8.5 may start only after this card and the milestone gate of part C (M8.4.19).

### M8.5 and M8.6 - summaries

Cards are written by a design session when the previous milestone passes its milestone gate. **Prerequisites of M8.5:** the milestone gates of
M8.4 part C (card M8.4.19: the tile store) and part B (card M8.4.11: pixels of small sections and tables). From slice (b) on, an image
method works on regions of the tile store, never on a whole decoded raster.

- [ ] **M8.5 - Migrate the remaining scientific methods,** one slice at a time with the recipe of
      [ARCHITECTURE §5.1](ARCHITECTURE.md#51-add-or-migrate-a-scientific-method): (a) depth/age parsing and
      record/formula transformations; (b) image filters, detection and object features; (c) ichnotaxon
      classifiers and embeddings; (d) multiproxy rules, models, interpolation and fitted statistics; (e) U-Net
      inference, then training integration after M3.2.5. Slices (a) and (d) use M8.4.10, (b) and (e) use the tile store
      (and M8.4.9 for small sections if it is kept), (c) follows (b).
  - Lessons of M8.3, for every slice: the inputs are resident in the engine from the start (M8.4 services); the
    second card measures the matched timing of the first end-to-end path with the M8.4 tool, before any interface
    card (M8.3 found its 30-60 times slowdown only at its last card); each slice ends with a milestone gate.
  - Acceptance per slice: independent reference fixtures, explicit provenance, unchanged public contracts; exact
    counts/masks/labels and predeclared tolerances elsewhere; figures and exports unchanged.
- [ ] **M8.6 - Promote desktop and retire duplicate computation.** After the release checklist passes: the engine
      becomes authoritative, migrated JavaScript calculations are removed from the desktop program, their role as
      reference passes to versioned fixtures, and the last supported HTML version is frozen with a tested
      export/import path for its stored projects.
  - Acceptance: one implementation per method; identical API, CLI and desktop results; complete desktop and
    interrupted-save regressions; storage identifiers and old project readers retained; documents and CI updated
    in the same delivery; engine errors stay visible; every earlier milestone gate passed.

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
| Large images | M2.3.1–M2.3.5 (required for 1.0; scheduled as part C of M8.4, cards M8.4.12-M8.4.19) |
| Analysis and U-Net | M3.1.6, M3.1.7, M3.2.4, M3.2.5, M3.3.2, M3.3.4 |
| Optional acceleration | M4.1.1 Rust kernel, M4.1.2 GPU |
| Release readiness | M5.1, M5.2, M5.4, M5.5 |
| Advanced statistics | M6.1–M6.6 |
| Radiographs | M7.1–M7.4 |
| Interface shell | M9.1 |
| Validation, publication, backlog | scientific validation on real cores, paper, DOI, PyPI, further ideas |
