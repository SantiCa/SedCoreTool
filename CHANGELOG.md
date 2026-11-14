# Changelog

All notable changes to SedCoreTool are listed here, newest first.

**Versioning.** Each delivery has a number `V0.<n>`, shown in the program and used as the version `0.<n>.0` of the
program, the Python package and the desktop installers. Version 1.0 will be released when the program is considered
complete. Before 5 November 2026, development builds were numbered V1–V33; V33 became V0.1.

Technical details of every method are in [docs/TECHNICAL_DOCUMENTATION.md](docs/TECHNICAL_DOCUMENTATION.md).

---

## Unreleased

### For users

- The core image strip (Core column, Multiproxy) no longer freezes the page for tens of seconds while the pictures of some sections are still being read from disk. It asked for a new full-size grey canvas once per output row; it now reuses one while the section stays pending. The picture produced is unchanged.

### Internal

- Engine: one long-lived method worker replaces one process per analysis. Cold analysis of the six public sections takes 1.6 s instead of 4.2 s and of the generated eight-section project 3.4-3.9 s instead of 6.9 s (JavaScript: 0.03 s and 0.11 s); cancellation reaches its final state in 38 ms instead of 533 ms. The coordinator still verifies every answer, kills the worker on an unacknowledged cancellation, an abandoned job, a bad answer or the deadline, starts a new one after any anomaly and stops an idle one after 30 s. A bug found by the new tests (an answer the coordinator does not approve left the job waiting) is fixed. The engine contract is amended accordingly.
- Measurement tool: the process-tree memory sampler (`tools/process_tree_sampler.py`) reaches the contract's 25 ms cadence (it was 900 ms). With it the ten-cycle memory gate passes (four runs); evidence in `docs/validation/M8.3.8-engine-analysis-windows-corrected.json` and the summary next to it.
- The GitHub `e2e` job is green again (it failed from 10 to 14 November 2026). The navigation preview now stretches the strip at the offset where the view draws it, because Chrome's software renderer (SwiftShader, Linux) rounds a stretch differently at different destination positions; exact pixel equality with the previous renderer is unchanged. The interrupted-saves test fixes the interface language, since two of its checks read Spanish messages and the Linux runner's browser is English.
- Smoke test: any page call that takes more than 5 s is named in the log, and a new check asserts that a section with an unloaded picture answers every strip request with one canvas. This was the cause of the local timeouts (a 25-45 s freeze in the multiproxy step and in the wait for the 16-bit TIFF; Puppeteer's 180 s limit was reached on slower runs).
- Design review before M8.4 (documents only). A third acceptance level, the milestone gate, closes every milestone with the GitHub workflows on Windows, macOS and Linux (AGENTS.md §6; first one: card M8.3.9, since the engine has never been built on macOS or Linux). Two verdicts of the M8.3.8 evidence are corrected: matched timing is a gate of contract §7 and fails (about 392 ms against 17 ms for one large section, most of it moving the label image), and the memory-peak gate was not evaluated. M8.4 is redesigned around section inputs kept resident in the engine, with five decisions for the maintainer; stale statements in ARCHITECTURE.md and the contract are corrected.
- Card M8.4.4 (engine experiment only): after an edit, undo or redo the desktop program sends the engine only the rows of the masks that changed (the engine checks that the result has the hash of the real mask, so a missed change is a full upload, never a wrong result). Edit, undo and redo take 0.15 s (public example) and 0.22 s (generated project), from 0.36 s and 0.57 s before M8.4.1; still above the limit of contract §7 (about 0.06 s). The engine has a new operation `buffer.derive`.
- Card M8.4.3 (engine experiment only): the engine's worker remembers the validation and the row counts of the masks it has seen (by the SHA-256 of their buffers) and the decoded tables, so a change of the interval size no longer recounts the image; a result is one buffer with a layout instead of about 35, and the coordinator looks for finished jobs every 2 ms instead of 20. Interval-size changes now take 0.2 s (public example) and 0.3 s (generated project), from 1.8 s and 3.7 s before M8.4.2; still above the limit of contract §7 (about 0.05 s), which the next cards address.
- Card M8.4.2 (engine experiment only): the desktop program keeps each section's masks and tables in the engine between analyses and uploads only what changed; changing the interval size no longer sends any image. Interval-size changes analyse in 0.8 s (public example) and 1.5 s (generated project) instead of 1.8 s and 3.7 s; still above the limit of contract §7. The engine accepts 256 live buffers instead of 128.
- Card M8.4.1: the measuring tool has a `scenarios` phase (interval change, edit/undo/redo, unchanged re-analysis, memory peak, flag off against flag on) whose pass/fail rules of contract §7 live in `tools/engine_gates.mjs`. Baseline: the engine path fails the timing gate for the first two scenarios (about 1.8-3.7 s against a limit of 51 ms; about 0.4-0.6 s against 59-68 ms); the unchanged re-analysis, the memory peak and the parity pass.
- Desktop end-to-end test: with the engine experiment on it now also undoes and redoes an edit, compares each result with the JavaScript reference, and opens the data, figures, map, log and section tabs without a page error (items M8.3.7 had left unchecked).
- TypeScript configuration: `moduleResolution` is now `bundler`, which TypeScript 5.9 (the project's) and 6 (the editor's) both accept; the editor no longer reports the deprecation of `node10`. The type-check result is unchanged.
- Plan: the maintainer answered the five decisions of M8.4 (14 November 2026): the renderer keeps ownership of live edits under explicit guarantees, multi-gigabyte images are required for 1.0 and become part C of M8.4, V0.151 goes to `master` after the speed work (part A).
- *Desktop builds* workflow (card M8.3.9): it also runs on every push of a `work/**` branch (build and test only, never a release), runs the desktop end-to-end test with the engine experiment off as well as on, and keeps running its later checks after a failure so that one run reports everything.
- Milestone gate of M8.2-M8.3 passed on Windows, macOS and Linux (card M8.3.9). The first cross-platform run found and fixed four faults: the packaged-program check still expected only the digest method (all systems), the macOS universal build rejected the native libraries in `PIL/.dylibs` because the `x64ArchFiles` pattern skipped folders starting with a dot, the macOS universal bundle came out with an empty `app.asar` after merging the two architectures (the merge is now off; the cause is not known), and the desktop backup test read Spanish messages in windows that were already open on an English-language host.

## V0.150 — 2026-11-14

### For users

- Python package: pixel counting per row now uses bounded multi-row histograms (`sedcoretool.kernels`) for every call. Results are identical to before; on the 6400 × 960 reference mask an analysis took 32 ms instead of 40 ms and allocated 12 MiB instead of 18 MiB. The former opt-in variable `SEDCORETOOL_EXPERIMENTAL_COUNTS` is still accepted and has no effect.

- Desktop program, experimental engine (off by default, `SEDCORETOOL_ENGINE_EXPERIMENT=1`): the interval table of every section can now be calculated by the Python engine instead of the JavaScript code. While a section waits it shows "Calculating with the scientific engine…"; an old result is never shown as current; if the engine fails the section shows a translated error and the other calculation is not used. Results equal the JavaScript ones (checked on the six sections of the public example). Without the experiment nothing changes.

### Internal

- Reference fixtures for the planned engine method `section.intervals/1`: 44 synthetic cases (about 1.2 MB, `tests/fixtures/section-intervals/`) with the contract's inputs and the result of the current JavaScript calculation, generated by `tools/make_interval_fixtures.mjs`, and a test that each committed file equals a regeneration. `sectionanalysis.js` gains `buildIntervalSnapshot` and `referenceColumns`.
- New package `src/sedcoretool/kernels/` with the pure array primitives of interval analysis (`binning`, `counting`, `classification`, `ages`); `pipeline.py`, `indices.py` and `depth.py` call them and keep their public functions and the private names that tests use. `kernels.counting.object_row_counts` counts from object labels, an object-to-class table and overlap stacks (the desktop program's representation) for the coming engine method; `kernels.classification` offers first-match as well as last-match tier precedence. All 357 earlier Python tests pass unchanged; 86 new tests include the 44 JavaScript reference fixtures and slow reference implementations.
- Python method `section.intervals/1` (`src/sedcoretool/methods/`, with a registry and strict input validation that names the field at fault) reproduces all 44 JavaScript reference fixtures: counts, row bounds, indices, no-data flags and missing-value patterns exactly, floating-point columns within 1e-9. It is not yet connected to the desktop program. Four fixtures were added (prediction confidence equal to the threshold, no-data padding in mm and in m, an interval thinner than one row) after mutation testing showed those behaviours were uncovered. 109 tests; twelve deliberate faults were each caught.
- Card M8.3.8: acceptance measurements of the first engine slice (`tools/measure_engine_analysis.mjs`, evidence in `docs/validation/M8.3.8-*`). On Windows the engine matches the JavaScript calculation on 14,082 intervals, keeps the interface responsive (input-to-frame p95 17 ms) and cancels in under 7 ms, and recovers from killed workers; it is 60 to 160 times slower than JavaScript on these inputs and does not meet the ten-cycle memory gate (+110 MiB against +64). The experiment stays off by default. The measurement found and fixed a real bug: a section whose inputs changed while its analysis waited was dropped and stayed pending (`engineanalysis.js` now asks again by itself).
- Card M8.3.7: `app/js/engineclient.js` (upload, analyse, download, release), `app/js/engineanalysis.js` (per-section revision, pending/ready/error state, one analysis at a time, stale results discarded, no fallback) and `analysisRevision`/`resultToBins` in `sectionanalysis.js`; `app.js::analyze` delegates to them when `window.corantoolDesktop.engine.enabled` (a boolean the preload reads once). The CSV export waits for `analyzeSections`. Tests: `tests/app/engine-analysis.test.mjs` (17, including a conversion check against the JavaScript calculation on 24 seeded sections) and a parity check of the six public-example sections in `tests/e2e/desktop.mjs` with the engine on and off.
- Desktop engine bridge (experimental, off by default; card M8.3.6): the page can now upload buffers in bounded chunks, start and cancel a section analysis and read result columns through eight validated calls in `window.corantoolDesktop.engine` (`desktop/engine-ipc.js`). Tokens replace engine handles, belong to one page and are released when it reloads or closes; failures reach the page as a code and a field, never a message. The engine client reads the binary frame that follows a `buffer.read` response and ends the session on any mismatch. The interface does not call the bridge yet. Tests: `tests/app/engine-ipc.test.mjs` (fake engine, real engine and bundled runtime), new cases in `tests/app/engine.test.mjs`, a round trip through the preload bridge in `tests/e2e/desktop.mjs`.
- Engine process (experimental, off by default): new operation `section.analyze` runs the Python method `section.intervals/1` in its own worker process (`engine/method_worker.py`, NumPy only), adopts its result columns as committed buffers after re-checking size, shape, hash and finite data, and `buffer.read` downloads them in ranges of at most 1 MiB. The handshake now lists both methods and the Electron client accepts them. A misbehaving worker (crash, error exit, wrong hash or size, a column named as a path, non-finite data, over-budget results) is an internal error and adopts nothing; 30 new engine tests, and sixteen deliberate faults in the coordinator were each caught. The interface does not call the method yet.
- Continuous integration: the Python test jobs failed on GitHub because `psutil` (used by the benchmark tools that tests import) was missing from the `dev` extras of `pyproject.toml`; added. The browser smoke test no longer measures the multiproxy name column before it is laid out (a race that already failed 1 run in 4 on V0.148) and prints elapsed time on every line.
- Engine worker (found by the GitHub Windows runner): `method_worker.py` now imports NumPy and the methods before its liveness watcher starts. In a clean Windows environment the watcher, blocked reading the stdin pipe, made `import numpy` hang, so every analysis timed out; it passed locally only because Anaconda's NumPy is unaffected. A test guards the order, and the smoke test now emits GitHub `::error::` annotations on failure.
- `tests/test_architecture.py` enforces the import rules of the Python layers (kernels, methods, engine, public API) by reading the source with `ast`.

## V0.149 — 2026-11-13

### For users

- The Windows portable version is now a ZIP archive of the program folder instead of a single self-extracting executable: unzip it once and run `SedCoreTool.exe`. The previous single file unpacked 150 MB on every launch and took about 50 seconds to open.
- The desktop download is smaller: the bundled scientific runtime no longer ships files the program never uses (pip, test suites, Tcl/Tk data, development folders): 3,552 files instead of 7,326 and about 205 MB instead of 249 MB.

### Internal

Development tools, tests and documents; the experimental engine is off by default, so none of this changes what the program calculates.

- Engine start-up: after one successful integrity check of the bundled runtime, later launches recheck only file identity (size, times, inode) instead of reading every file again; any changed, added, missing or replaced file, a different build, or a missing or damaged record triggers the full check. With the smaller runtime a full check takes about 1.2 s and a recorded one about 0.1 s on the maintainer's Windows computer; the first launch after extracting the portable ZIP reaches engine ready in 3.7–3.9 s (11–25 s before).
- Engine shutdown: a forced stop ends the engine and its workers almost instantly on Windows (5 ms instead of about 1.7 s), by tying worker processes to the engine's lifetime in the operating system.
- Measuring tools: `tools/measure_engine_lifecycle.mjs` (verification, start-up, shutdown, forced stop, leftovers), `tools/measure_engine_cancellation.mjs` (transfer speed, cancellation latency, engine memory) and `tools/measure_packaged_startup.mjs` (packaged program: time to window and to engine ready, closing, leftover processes, whole-program memory and idle CPU; `--keep-profile`, `--wait-ms`, failure-stage diagnostics).
- Documents restructured for task-card work: `AGENTS.md` now holds only stable rules; `docs/ARCHITECTURE.md` (layers, import rules, path of a scientific request, recipes, recorded decisions) and `docs/DEVELOPMENT.md` (commands, packaging, measuring tools, known problems) are new; `docs/roadmap.md` holds the status, two acceptance levels, the flag table and ordered task cards for the first scientific slice; later milestones moved to `docs/roadmap-future.md` and finished tasks to `docs/roadmap-history.md`.
- Section analysis moved out of `app.js` into the pure module `app/js/sectionanalysis.js` (effective class of each object, row counts and their cache, interval bins, no-data padding, ages and manual indices). The code was moved without changing any formula; `app.js` keeps one-line wrappers. A new test file checks hand-computed cases and compares the module with a literal copy of the previous calculation on 40 generated sections.
- Repository clean-up: obsolete audit snapshots, a scratch note and an unused GitHub Pages theme file were removed from the repository root.

## V0.148 — 2026-11-12

- Development work now accumulates on a branch and becomes a numbered version only when the maintainer decides, so versions mark meaningful steps rather than every individual change. Application behaviour and calculations are unchanged.

## V0.147 — 2026-11-12

- Record the direction for the desktop program: Electron remains the interface during the scientific engine migration, a more fluid interface may be evaluated afterwards, and the program is delivered as portable and installed packages for each system.
- Keep the scientific engine independent of the interface so that a later interface change does not alter calculations or stored projects, and add per-package startup, size and integrity-check measurements to the planned acceptance work.
- Update the contributor guide and the source-code map with the engine files. Application behaviour and calculations are unchanged.

## V0.146 — 2026-11-12

- Keep AGENTS.md as the single shared instruction source for all assistants. Reduce both compatibility entry files to the same import line, with no model-specific instructions to maintain.
- Preserve the common migration handoff and roadmap order. Application behaviour and calculations are unchanged.

## V0.145 — 2026-11-12

- Add modularity, understandable code and easy editing as continuing project objectives, with focused contracts and reviews that reduce repeated reading and assistant context/token costs.
- Link these objectives to incremental roadmap work and preserve scientific validation. Application behaviour and calculations are unchanged.

## V0.144 — 2026-11-12

- Document the current single-engine migration handoff in AGENTS.md: settled decisions, delivered work, validation limits, environment reconstruction and the next acceptance phase.
- Add a Gemini entry file importing the same shared guide already used by Claude. Application behaviour and scientific calculations are unchanged.
- Preserve process timing failures observed during concurrent runtime reconstruction as an open acceptance check; subsequent serial tests passed without changing engine code or deadlines.

## V0.143 — 2026-11-12

- Include a hash-locked portable CPython runtime and minimal scientific dependencies in desktop builds, selected by operating system and architecture, with separate Intel and Apple Silicon resources in the universal macOS layout.
- Verify the runtime, dependency inventory and application sources before starting the experimental engine; reject damaged or mismatched resources without using another Python installation.
- Add offline runtime reconstruction, native scientific/image checks and packaged-resource startup checks. The engine experiment remains disabled by default; scientific UI migration and clean-machine/platform acceptance are still pending.

## V0.142 — 2026-11-12

- Add the first experimental desktop engine process boundary, disabled by default, with bounded binary transfers, verified immutable buffers, cancellation and process-failure recovery.
- Keep the interface and project saving independent of the experimental process; provide a narrow status bridge without exposing commands or filesystem paths to the page.
- Begin M8.2 with a development-only transport diagnostic. Scientific calculations are unchanged; a bundled interpreter and clean-machine/platform validation remain pending.

## V0.141 — 2026-11-12

- Define the single scientific engine migration contract: current method coverage, data ownership, a bounded local process protocol and versioned section inputs/results.
- Record compatibility gaps, including object overlaps, manual intervals and custom index precedence, with numerical, responsiveness and whole-process memory gates before implementation.
- Complete roadmap M8.1 and prepare M8.2 for runtime packaging and process isolation. Current calculations, files and application behaviour are unchanged.

## V0.140 — 2026-11-12

- Reorder the roadmap around a desktop application with one local Python/NumPy scientific engine and the existing Electron/JavaScript interface.
- Put engine contracts, packaged runtime, a verified section-analysis prototype and bounded image/data services before remaining method migration, advanced statistics and radiographs.
- Plan removal of duplicate calculations and a documented final-HTML migration path after validation. Defer Rust/Wasm, GPU and interface replacement experiments; current application behaviour and compatibility are unchanged.

## V0.139 — 2026-11-12

- Accept short and full hexadecimal palette colours in Python and the command line, including either case and surrounding whitespace; preserve RGB inputs and hexadecimal colours without `#`.
- Reject malformed hexadecimal colours with the affected class name instead of truncating extra digits or producing an unclear error. Preserve exact masks, class order, tolerance and scientific results for equivalent colours.

## V0.138 — 2026-11-12

- Expand the roadmap with staged development for multi-gigabyte images, responsive calculations, conditional Rust/Wasm/GPU acceleration, an advanced-statistics module and radiograph integration.
- Define proposed performance targets, scientific validation, storage/recovery requirements and dependencies. These are planned capabilities; the current application behaviour is unchanged.

## V0.137 — 2026-11-12

- Preserve literal names and paths such as `NA`, `NULL` and `N/A` when reading batch manifests; only empty fields trigger missing-value handling and defaults.
- Document how to edit generated CSV manifests while keeping formula protection, original apostrophes and mixed text values intact. Keep the existing `apostrophe-v1` format compatible.

## V0.136 — 2026-11-12

- Restore event shading controls in multiproxy log, core-column and whole-core figures. Select multiple interval families or automatic classifications, with independent opacity and class colours in each figure.
- Choose shading behind the whole proxy track or only under its curve, and overlay sources or display them in separate strips. Keep settings per figure type and tab, include a source-qualified legend and preserve them in SVG/PNG exports.
- Preserve the original event definitions, classifier results, measurements and inherited shading of existing projects.

## V0.135 — 2026-11-11

- Add **Cover visible sea (IDW)** to project and across-project proxy maps: estimate values throughout the visible marine area, beyond the core perimeter, while masking land.
- Label extrapolated maps in the view and SVG/PNG exports. Keep existing saved settings and the default core-perimeter restriction; the new coverage is activated explicitly.

## V0.134 — 2026-11-11

- Add optional temporary desktop diagnostics for control use, save/backup operations, error locations, memory samples and unresponsive or failed windows, with a visible recording indicator.
- Keep the bounded log locally across restarts, expire recording after seven days, and provide export, stop and clear controls. Exclude typed text, project contents, images, names, paths and raw error messages; nothing is uploaded automatically.

## V0.133 — 2026-11-11

- Keep slow automatic folder copies from blocking project navigation, exports or closing after the local project has saved; serialize backup attempts and retain edits made during a running copy.
- Explain backup failures and permission recovery, allow folder reselection, and copy all saved projects to a newly selected destination. Reject restricted desktop folder requests promptly so the picker can recover.
- Extend interrupted-save verification to the desktop runtime, including delayed writes, retry coordination and backup permission failures.
- Stop a folder copy or export if an original image is missing instead of publishing an empty substitute; preserve the last complete folder manifest.

## V0.132 — 2026-11-11

- Repair the technical reference's source-code table and place experimental Python counting with the library API, linking it from the contents and its validation evidence from the validation section.

## V0.131 — 2026-11-11

- Correct the technical reference and paper to describe existing Python exclusion support in the API, command line and batch processing, distinguishing interactive drawing and no-data expansion and linking the validation evidence.

## V0.130 — 2026-11-11

- Keep the last working desktop U-Net model available while retraining, including after preparation, training, evaluation, cancellation or publication failures.
- Publish the ONNX, metadata and test evaluation together only after the complete run succeeds; resume pending checkpoints independently of the active model and keep older model files readable.

## V0.129 — 2026-11-11

- Reject malformed numeric map presentation values before drawing or exporting SVG, restoring each field's default while preserving valid numeric settings and scientific measurements.
- Verify each completed figure and its exported SVG against injected elements and event attributes, including multiproxy and location maps in browser and offline use.

## V0.128 — 2026-11-11

- Validate no-data (`ndColor`, `ndLine`) and presentation colours against hexadecimal notation (`#rgb` and `#rrggbb`) across column logs, distribution charts, composite figures, location maps and multiproxy views, falling back to each style's defaults (`#f2f2f0` and `#b9bdbb` for no-data fill and hatching) when project values are malformed.
- Escape interpolated style, record, class and control attributes in column, figure and map forms and exported SVGs while preserving valid colours, legacy project files and scientific arrays.

## V0.127 — 2026-11-11

- Confine desktop `app://corantool` requests to files inside the packaged web root, rejecting sibling-prefix traversal, encoded path separators, Windows drive or UNC paths and malformed URL escapes while preserving normal application assets and floating windows.

## V0.126 — 2026-11-11

- Separate shared depth and pixel-scale calculations from the interface, preserving existing exports, fractional interval boundaries and project measurements.
- Keep standalone HTML compatible with local named export lists and reject unsupported lists during construction.

## V0.125 — 2026-11-11

- Incorporate the technical audit into the roadmap with prioritised safety, data-integrity, documentation and modularity tasks, distinguishing confirmed source observations from findings requiring reproduction.
- Reuse existing trainer tasks and record verified action tags and the U-Net extraction already delivered; application behaviour is unchanged.

## V0.124 — 2026-11-11

- Separate U-Net model sessions and probability caching from the interface, preserving file loading, detection and desktop-trained model use.
- Add strict controller contracts and regression checks for loading errors, cache invalidation and identical inference in the browser and offline HTML.

## V0.123 — 2026-11-11

- Improve the opt-in Python counting experiment with bounded multi-row histograms; reduce median API time by about 60% on the public reference core and 30% on the synthetic core in an alternating comparison, with less than 1% higher median worker peak memory.
- Preserve exact scientific results and retain the established calculation as the default; no additional dependencies are required.

## V0.122 — 2026-11-11

- Add an opt-in bounded Python counting experiment with exact reference results; retain the established default because the synthetic workload misses the performance target.
- Publish baseline and experimental measurements on the public and synthetic cores.

## V0.121 — 2026-11-11

- Align Python's centimetre-to-row conversion with the application so fractional intervals use identical row boundaries and indices, with matching percentages within the documented numerical tolerance.
- Verify public and synthetic reference cores at 2 and 1.37 cm, half-row boundaries and neighbouring floating-point values, while preserving the historical regression and explicit pixel intervals.

## V0.120 — 2026-11-10

- Publish reproducible interval-analysis profiles on the public and synthetic reference cores, distinguishing fresh pixel counts from reused browser counts and measuring the public Python API.
- Document a fractional-interval boundary disagreement between Python and JavaScript, including its effect on percentages and indices; retain the existing analysis while recording the correction needed before optimisation.

## V0.119 — 2026-11-10

- Enable the optimised navigation preview at startup, with a session control to restore the previous renderer.
- Keep older projects, exported figures and scientific results compatible, and use the existing renderer for unsupported preview dimensions or invalid analysis regions.

## V0.118 — 2026-11-10

- Add an optional, session-only navigation-preview experiment with exact display pixels and a bounded thumbnail cache. Keep the current navigation renderer as the default.
- Reduce first-visit navigation time by 33.7% on the measured 122.9-million-pixel synthetic core, with 4.8% higher median whole-trial peak memory; publish the matched comparison and correctness checks.

## V0.117 — 2026-11-10

- Add reproducible large-image diagnostics for project opening, section navigation, zoom/pan, cache residency and memory, with exact edit/reload and full-resolution mask-export checks.
- Publish measurements on public and synthetic cores, identifying navigation-thumbnail preparation as the next optimisation target.

## V0.116 — 2026-11-10

- Fix creating or importing the first project in an empty library when startup preferences have marked the uninitialised workspace as changed. Keep failed-save protection for existing projects.

## V0.115 — 2026-11-10

- Give core-column and whole-core figures independent tracks, records, axes, widths, colours, visibility and image presentation; keep distribution/section styles and depth windows separate by figure type and tab.
- Choose a multiproxy figure's own depth/age axis and image treatment without changing the analysis view. Map age image panels and classification bands through the selected core's depth–age relation.
- Preserve inherited presentation and custom column labels in existing projects, save independent settings with figure tabs, and restore inherited presentation per figure type.

## V0.114 — 2026-11-10

- Add ichnotaxon abundance, symmetric curves, presence names/symbols, opacity and percentage labels to multiproxy figures.
- Compose each multiproxy figure independently: select core and proxy tracks, reorder or hide tracks, and adjust the window, height, widths, scales and colours. Save the composition in figure tabs and restore inherited settings when needed.
- Align image-derived tracks and manual occurrences with the selected core's units and age model, including cores other than the one open in the image editor.

## V0.113 — 2026-11-10

- Customise ichnotaxon abundance and presence in whole-core, core-column and distribution figures: separate, overlaid or stacked plots, curves, filled areas and symmetric curves with adjustable opacity.
- Add symbols or names at identified traces or manual marks, together with percentage scales and labels; retain independent figure settings when saving or switching tabs.

## V0.112 — 2026-11-10

- Add an optional visible-row Data table experiment with bounded rendering, keyboard navigation and complete CSV exports; keep the current table as the default.

## V0.111 — 2026-11-10

- Export large Data tables faster while preserving every row, numeric rounding and spreadsheet text escaping.

## V0.110 — 2026-11-10

- Export large Data tables faster by indexing non-overlapping interval labels; retain existing boundary and overlap behaviour.
- Verify cumulative table expansion, native text selection and complete exports with reproducible measurements.

## V0.109 — 2026-11-10

- Open and rebuild large Data tables faster by preparing the displayed rows on demand; CSV export retains every row.
- Keep text selection, editing/restoration, interval labels and core selection covered by browser regression tests.

## V0.108 — 2026-11-10

- Keep prepared U-Net images and masks inside the chosen output folder, including when identifiers contain Windows paths.
- Give distinct core/section pairs distinct portable filenames; reject duplicate pairs before replacing a dataset.
- Refuse linked output paths and preserve files that appear during tile creation instead of overwriting them.

## V0.107 — 2026-11-10

- Publish the independent performance-baseline review, with matching source, input and result fingerprints and verified measurement boundaries.
- Accept the reproducible baseline for future performance comparisons, with raw measurements and documented limits.

## V0.106 — 2026-11-10

- Document a complete performance benchmark repetition from a clean V0.94 checkout, with matching input and result fingerprints.
- Clarify the original baseline's source provenance and the independent review still required before its acceptance.

## V0.105 — 2026-11-10

- Preserve the last complete project when a save fails while queuing section data.
- Keep unsaved changes open when switching projects fails, and offer a Retry save button.
- Allow folder backups to be reactivated after a failure and release failed file writers before retrying.
- Keep the previous folder copy's original images intact if a replacement image is saved before a later failure.

## V0.104 — 2026-11-09

- Redo trace and exclusion edits from the image toolbar or with Ctrl+Y, Ctrl+Shift+Z or ⌘Shift+Z.
- Undo and Redo keep a class assignment and the merges it triggers together, including when the history reaches its limit.

## V0.103 — 2026-11-09

- Undo now stores only changed traces, reducing memory use when editing densely annotated sections.

## V0.102 — 2026-11-09
- Reject invalid Python valid-area thresholds and report the actual dimensions of mismatched exclusion images.

## V0.101 — 2026-11-09
- Reject conflicting filenames and existing destinations before exporting a multi-core LAS batch.

## V0.100 — 2026-11-09
- Reject out-of-range Python mask labels before allocating class results. Supported labels retain their class names and interval values.

## V0.99 — 2026-11-09
- Reject Python image and mask loads that exceed the estimated memory budget before decoding their pixels.

## V0.98 — 2026-11-09
- Detect corrupt project ZIP members, including stored images, before replacing an existing project.

## V0.97 — 2026-11-09
- Add a reproducible editing-history benchmark for long sessions with different trace counts.

## V0.96 — 2026-11-09
- Flag invalid analysis regions and broken mask references when opening a project, with an inspection mode that preserves the original data.

## V0.95 — 2026-11-09
- Warn in the section editor when an opened project has invalid depths or units.

## V0.94 — 2026-11-09
- Add a reproducible browser and Python performance baseline for the public IODP example and a larger synthetic core.

## V0.93 — 2026-11-09
- Clarify contributor rules for scoped performance work, incremental rollouts, dependency review and numerical regression tests.

## V0.92 — 2026-11-09
- Check JavaScript type regressions in CI, with strict JSDoc contracts for analysis, image processing and shared state.

## V0.91 — 2026-11-09
- Escape formula-like text in CSV and Excel exports while preserving numeric measurements.
- Reject oversized or malformed ZIP project and U-Net training imports before unsafe expansion.
- Read only documented manifest columns using fixed text and depth types.

## V0.90 — 2026-11-09
- U-Net training switches to CPU if GPU memory is insufficient and resumes from the last completed checkpoint. Use `--cpu-only` to force CPU execution in the Python CLI.

## V0.89 — 2026-11-09
- Classify large multidimensional arrays of BI and ii faster in Python with the same interval results.

## V0.88 — 2026-11-09
- Reclaim unused overlap stacks during long editing sessions while preserving undo and trace order.

## V0.87 — 2026-11-09
- Open supported large TIFF and BigTIFF images by strip or tile, and retain 16-bit samples for levels and gamma.
- Save original images in bounded writes so project saving does not require loading each entire file into memory.

## V0.86 — 2026-11-08
- Verify both architectures of the universal macOS package when their application archives are separate.

## V0.85 — 2026-11-08
- Desktop builds load the sample core for Electron testing and verify that installers contain only the coastline from the examples directory.

## V0.84 — 2026-11-08
- Drag the name column edge in Multiproxy interval families to resize it within the side panel.

## V0.83 — 2026-11-08
- Collapse the numeric variable list in Multiproxy and read interval class names in fields that use the available panel width.
- Reorder and hide tracks, including automatic classifications, directly from the Multiproxy curves toolbar.
- Choose which proxies to show in each multiproxy log figure independently of the analysis.
- Select entire projects for a cross-project analysis and customise site map colours and symbols by project or core.

## V0.82 — 2026-11-07
- Preserve imported series when combining age-only and depth-based tables using a suitable age model; report imports that cannot be converted safely.

## V0.81 — 2026-11-07
- Ignore invalid geographic coordinates in multiproxy maps and interpolation.
- Prevent exporting an earlier figure when drawing the current figure fails.

## V0.80 — 2026-11-07
- Multiproxy resampling preserves measured values beside large gaps and applies the automatic gap limit when the field is blank.

## V0.79 — 2026-11-07
- Preserve age-only series when importing additional variables into an existing core.

## V0.78 — 2026-11-07
- New optional column «Sections» (Core column and the «Core column» figure): an empty column with one box per section
  showing its name or number, vertical or horizontal (Scales and style → row «Sections»). It can be shown, hidden and
  reordered like any other column; off by default.

## V0.77 — 2026-11-07
- "Open idealised example" on the home screen no longer appears (and fails silently) when the program has no sample
  data; `npm start` in `desktop/` now copies the sample data so the example buttons work when developing. Errors
  loading the example are logged in the console.

## V0.76 — 2026-11-07
- Language: the parts that stayed in Spanish in English now follow the language: formula errors (Data tab and computed
  columns), the test core (name, age-model note, magnetic susceptibility record), the map background credits and the
  moving-average fit label (now `movavg(n)`).

## V0.75 — 2026-11-07
- Core column: the title and the shape of the bioturbation column and the title of the ichnotaxa column move into their
  rows of the table of columns (width, limits, divisions), and the separate "Divisions of % axes" field is gone: the
  Div. cell of each percentage column now shows the default (4) and replaces it when filled in.

## V0.74 — 2026-11-07
- Depth scale: a "Ruler scale" button fills in the intervals from one value (short tick every n, medium every 5n, number
  and long tick every 10n, lengths 3, 5 and 8 px). It is available in the Core column panel and in the figure panel.

## V0.73 — 2026-11-07
- Figures: several versions of a figure can be kept in the project as tabs above the figure. `+` makes a new tab as a copy
  of the current figure; double-click renames it; `×` deletes it. Each tab keeps its own type, title, orientation,
  columns and series, and edits are saved in the active tab. Projects saved before open with a single tab.

## V0.72 — 2026-11-07
- Figures: vertical or horizontal orientation is now set separately for each figure type, instead of applying to all of
  them. Projects saved before keep their single orientation for the types you do not change.

## V0.71 — 2026-11-07
- No visible change: the save indicator keeps its internal state "saved" (used by the end-to-end test); the warning
  colour for "no folder backup" is a separate attribute.

## V0.70 — 2026-11-07
- Figures: the hatched or solid fill of intervals without data was blank in the preview of "Core column (current window)"
  (and of the multiproxy log) when that view had been opened before, because both copies of the drawing shared the same
  internal names. Each figure now has its own names.

## V0.69 — 2026-11-07
- Depth scale of the core column and of the figures: besides the numbered ticks, the long and the short ticks there is now
  a medium tick, each level with its own interval and its own length, so a ruler-style scale is possible (for example
  short every 1, medium every 5, long and number every 10). The same form is used in the column panel and in the figures.
- The section figure now respects the length of the numbered ticks.

## V0.68 — 2026-11-07
- Section figure: intervals without data now show the chosen fill (hatched or solid) over the image, not just the "No data"
  text on a blank background.

## V0.67 — 2026-11-07
- The save indicator no longer says just "Saved" when no backup folder is chosen: it reads "Saved on this computer · no folder
  backup" (or "folder backup pending" when the folder needs permission again) in the warning colour, and "Saved" only
  once the automatic folder backup is active.

## V0.66 — 2026-11-07
- No visible change: the multiproxy tool (records, layers, classifiers, maps) moves out of `app.js` into its own file.

## V0.65 — 2026-11-07
- No visible change: the composite log, the side panels and the Data tab move out of `app.js` into their own files.

## V0.64 — 2026-11-07
- No visible change: the interface code is split into smaller files (shared state and the figures panel now have
  their own modules), a first step towards dividing `app.js`.

## V0.63 — 2026-11-07
- Security: the build tool electron-builder pulled `minimatch` 9.0.9 and 10.2.6 (Dependabot alert #64, pattern
  amplification when parsing glob patterns). `desktop/package.json` now forces `minimatch` 11.0.1 for those two
  branches (`overrides`); `npm audit` reports 0 vulnerabilities and the Linux installers still build. The alert only
  affected the build tooling, not the installed program.

## V0.62 — 2026-11-07
- Column headers stay visible while scrolling in the data tables, the spreadsheet view, the results and comparison tables.

## V0.61 — 2026-11-07
- Release notes brought up to date; `tools/sync_version.py` now also writes the version into
  `desktop/RELEASE_NOTES.md` and `--check` fails if it differs, so a release can no longer carry old file names.

## V0.60 — 2026-11-07
- Python package: exclusion layer (`exclude=` in `analyze_mask`, `--exclude` image or `--exclude-value` on the command
  line); intervals with too few valid pixels have no data (`min_valid`, 20 % as in the program). Percentages are now
  computed as the ratio of sums, as in the program (identical results without exclusions).
- New `sedcoretool batch` and `sedcoretool manifest`: analyse many section images and several cores from one CSV
  manifest; sections are joined by depth with gaps kept and a choice for overlaps (keep, upper, error).
- LAS 2.0 export (`-o file.las`, `export.to_las`), one file per core.
- `--bin-cm` on the command line; output tables gain `depth_top`, `depth_bottom` and `valid_pct`; BI and ii are empty
  (not −1) where there is no data.

## V0.59 — 2026-11-07
- Text, subtitle and background colours can also be changed in the multiproxy map and the location map; the
  sections figure, the trace gallery and figure titles and captions follow the core-column colours.
- Colours stored in a project are checked before drawing; invalid values fall back to the defaults.
- `sedcoretool unet prepare --overwrite` replaces a previous dataset; other non-empty folders are still refused.

## V0.58 — 2026-11-07
- Reserving cores for the final test now excludes only the library and other-project examples that may come from
  them (same core identifier or name, or identical trace descriptors), and shows how many were excluded.
- Age models: repeated identical rows are merged; a depth with two different ages is reported by depth; an
  incomplete age range is ignored with a warning instead of rejecting the whole model.

## V0.57 — 2026-11-07
- When the desktop program cannot save on closing, a dialog offers to retry, export the project or close without
  saving, instead of silently refusing to close.
- Repository links point to the renamed repository `SantiCa/SedCoreTool`.

## V0.56 — 2026-11-07
- Customise figure colours for core columns, ichnotaxon distributions and multiproxy columns, or restore defaults.
- Show or hide hand-placed identification marks in core columns and whole-core figures without deleting them.
- Legends of the core column and whole-core figure list only the ichnotaxa present in the displayed interval.

## V0.55 — 2026-11-07
- Keep the desktop window open when saving fails, including when a save is already in progress.
- Reject duplicate age depths and invalid named age ranges; blank age cells are ignored instead of read as zero.
- Prevent U-Net preparation from mixing existing tiles and reject overlapping validation and test core lists.
- Exclude external ichnotaxon examples while cores are reserved and retain source keys in exported models.
- Fit multiproxy scaling and missing-value imputation on training samples only, and exclude reserved cores from k-means fitting.

## V0.54 — 2026-11-07
- Documentation reorganised for public readers: everything in English, no duplicated content, one guide for
  contributors and AI coding assistants (`AGENTS.md`, also read by Claude through `CLAUDE.md`), and this changelog as
  the single version history. The software paper moved to `paper/`; internal planning notes left the repository.

## V0.53 — 2026-11-07
- Technical documentation rewritten in English for any reader (`docs/TECHNICAL_DOCUMENTATION.md`): organised by the
  program and the Python package, describing current behaviour, with the full Python API and command line.
- README explains which part — the program or the Python package — each user needs.

## V0.52 — 2026-11-07
- Renamed **SedCoreTool** (formerly CorAnTool and IchAnTool). The Python package and command are now `sedcoretool`;
  `ichantool` keeps working as a deprecated alias.
- Shareable project packages use the extension `.sedcoretool`; `.corantool` packages and projects saved under older
  names still open. Saved data are kept: browser storage, the IndexedDB database and the desktop data folder are
  reused.
- `.zenodo.json` describes the software and links it to the archive of version 2.1 (Zenodo 3518837).

## V0.51 — 2026-11-07
- Ichnotaxa distribution figure: choose the ichnotaxa shown and the column width; abundance as symmetric (kite)
  curves, with or without symbols.
- Horizontal orientation for every figure except maps.
- Excluded zones can be hidden in every figure that shows core images.

## V0.50 — 2026-11-07
- Installers and the offline file carry no sample data, only the public-domain Natural Earth coastline; example
  buttons appear only when the program runs from a copy of the repository.

## V0.49 — 2026-11-07
- Final test on reserved cores: reserved cores never train nor take part in model selection (ichnotaxa and
  multiproxy); a logged final test reports accuracy, balanced accuracy and the confusion matrix.
- Automatic comparison with version 2.1: exact with the same mask (unit test) and within 0.6 percentage points with
  the browser's JPEG decoder (end-to-end test); the small difference was traced to the decoder, not the method.

## V0.48 — 2026-11-07
- Desktop builds run an Electron start/close/restart test before packaging, with optional checks of the vision model
  and map backgrounds.
- Manual builds can prepare an unpublished release draft with the five installers, the offline file, a manifest and
  SHA-256 checksums.

## V0.47 — 2026-11-06
- Electron 45.2.1 and electron-builder 26.18.0. macOS 13 or later is now required.

## V0.46 — 2026-11-06
- Continuous-integration workflow maintenance; component versions synchronised.

## V0.45 — 2026-11-06
- SheetJS updated to the official 0.20.3 build with its licence (fixes CVE-2023-30533 and CVE-2024-22363), with an
  SRI-checked online fallback.
- The DINOv2 vision model is pinned to a verified Hugging Face commit and SHA-256.

## V0.44 — 2026-11-06
- Projects are saved section by section: only changed sections are rewritten (IndexedDB version 5).
- Faster trace deletion; enhancement computed in the background when a section is opened.
- Exported tables and record import moved to a tested module (`exportio.js`).

## V0.43 — 2026-11-06
- New figure: core location map with base layers (blank, vector, Esri imagery), zoom and pan, WGS 84 / Web Mercator /
  UTM, graticule or metric grid, coordinates on any side in DD, DMS or metres, scale bar and north arrow (with UTM
  convergence), and SVG/PNG/JPEG output.

## V0.42 — 2026-11-06
- Editing algorithms (scissors, merge, undo, project migration) moved to a tested pure module (`edit.js`).
- End-to-end test in headless Chrome (open, detect, delete and undo, save, reload, compare) in continuous
  integration.

## V0.41 — 2026-11-06
- Performance: enhancement and detection run in a background worker; images are reduced directly to their output size;
  a separate memory budget for undo; kriging solves one linear system per map (O(n) per cell).

## V0.40 — 2026-11-06
- Single version number across the program, the Python package and the installers, checked by a test.
- Continuous integration on Windows, macOS and Linux with coverage, linters (ruff, ESLint) and the offline build;
  release script; Content-Security-Policy and SRI; security policy, code of conduct, issue and pull-request
  templates, and third-party notices.

## V0.39 — 2026-11-06
- Accessibility (WCAG 2.1 AA): accessible names for all sliders, keyboard-operable tabs, live status regions,
  optional single-key shortcuts, AA colour contrast in both themes, larger touch targets.

## V0.38 — 2026-11-06
- Table import handles quoted fields, thousands separators and Windows-1252 files, and reports cells read as empty.
- Consent before map backgrounds send the study area to Esri or GEBCO.
- The SHA-256 of the vision model is stored in the project.
- The automatic folder copy covers every modified project, retries on failure and warns when it is out of date.

## V0.37 — 2026-11-06
- Age model: decimal commas, columns chosen by header, warning for pasted Bacon tables.
- Ichnotaxa evaluation always leaves whole sections (or cores) out and reports the validation scheme.
- Multiproxy classifiers exclude the parent and child layers of the target, rescale per fold and leave a gap between
  validation blocks.
- Automatic choice of enhancement without identified traces uses a contrast-invariant, spatially coherent criterion.
- Corrected variogram weighting reference.

## V0.36 — 2026-11-06
- Safer data: project format 5; files from newer versions open read-only; masks validated on import and opening; a
  failed load saves nothing; pending changes saved when the page is hidden or closed.
- Provenance header (version, settings) in every exported CSV.
- Replacing a project on import keeps the local copy; rotated daily backup history; storage quota warning;
  uncaught errors shown to the user.

## V0.35 — 2026-11-06
- The Data tab is a spreadsheet: values can be edited (flagged, with original value and date, restorable and listed in
  the CSV); computed columns with interpolation between records measured at different depths; manual columns.

## V0.34 — 2026-11-06
- Multiproxy: colour records by one or several interval layers.
- Intervals of a layer never overlap within a core; touching intervals of the same class are joined.

## V0.33 — 2026-11-06
- All charts: reorder and hide columns without deleting data.

## V0.32 — 2026-11-06
- Ichnotaxa distribution figure: one symbol per identified trace or hand-placed mark, with its own depth or age axis.

## V0.31 — 2026-11-05
- Charts: choose which ichnotaxa are drawn, stacked or each in its own column with its own scale.

## V0.30 — 2026-11-05
- Traces overlap only when their ichnotaxa differ; the brush extends a trace of the active ichnotaxon.

## V0.29 — 2026-11-05
- Overlapping traces enabled by default (remembered, key S).

## V0.28 — 2026-11-05
- Age model with an age range; import of Bacon (rbacon) `*_ages.txt` tables; `age_min`/`age_max` in the CSV and an
  age-uncertainty track.
- Automatic choice of enhancement measures how well identified traces separate from the matrix, and also tries each
  colour channel.

## V0.27 — 2026-11-05
- Interface review: one-row top bar, bundled IBM Plex fonts, collapsible sections, two-line column titles,
  colour-blind-safe record palette, navigation strip next to the depth ruler.

## V0.26 — 2026-11-05
- Layout: only panels scroll; panel widths adapt to the screen; status bar always visible.
- Navigation strip to move through a section; Show all, Page Up/Down, Home/End.

## V0.25 — 2026-11-05
- Every figure with a core image: width, several versions side by side, and excluded zones shown or hidden.

## V0.24 — 2026-11-05
- Bioturbation side column: each track has its own width and can be hidden.

## V0.23 — 2026-11-05
- Core column: image panels side by side (original, enhanced, traces, arrows…) with true photo proportions.
- Configurable NO DATA style; trace symbol size and border; arrow options.

## V0.22 — 2026-11-05
- Vertical axes with numbered, long and short ticks, each with its own interval and length; editable scales in
  Multiproxy.

## V0.21 — 2026-11-05
- Bioturbation side column: adjustable width, fixed horizontal scales and records from the Data tab.

## V0.20 — 2026-11-05
- Overlapping traces: total bioturbation counts an overlap once, while each ichnotaxon keeps its full area. The Python
  package accepts one mask layer per class.
- Scissors tool to split a trace; Merge for several selected traces.

## V0.19 — 2026-11-05
- Hover help on almost every control (Spanish and English), which can be turned off.

## V0.18 — 2026-11-05
- Desktop program: own application icon.

## V0.17 — 2026-11-05
- Desktop program: train a U-Net on the computer's GPU (one-time training module, validation and test cores,
  progress, stop and resume).
- Ichnotaxa: optional features from a pre-trained vision model (DINOv2) instead of the 12 shape descriptors.

## V0.16 — 2026-11-05
- Documentation of the U-Net training protocol.

## V0.15 — 2026-11-05
- Learned segmentation (U-Net): training-data export from the program; a detection method that runs a trained ONNX
  model (probability threshold, uncertain zones); Python `unet` commands (prepare with split by core, train, evaluate
  on whole images of independent cores, predict) with identical tiling rules in Python and JavaScript.

## V0.14 — 2026-11-05
- TIFF and spreadsheet libraries bundled, so the program works offline; new README.

## V0.13 — 2026-11-05
- Drawing errors are reported with their own message.

## V0.12 — 2026-11-05
- Symbols by default in the ichnotaxa distribution figure (bars optional); one symbol shape per ichnotaxon, shared
  with marks and legends.

## V0.11 — 2026-11-05
- Shared vertical units and ticks across the core column and figures; logarithmic and explicit horizontal axes.
- Editable label text and positions, saved with the project and included in exports.

## V0.10 — 2026-11-05
- List of selected traces; browse all traces of the current image.

## V0.9 — 2026-11-05
- Interface fix in the ichnotaxa list.

## V0.8 — 2026-11-05
- Shareable project package (ZIP) with full-resolution images; automatic copy as project folders (for example in a
  shared Drive folder) and Open project folder; replace-or-copy when the same project is opened again.
- Comments with author, date and replies, linked to a point of a section.

## V0.7 — 2026-11-05
- Representative-traces figure: several versions of each trace side by side and a configurable scale.

## V0.6 — 2026-11-05
- Width and axis format of each column next to the core.

## V0.5 — 2026-11-05
- Style options for the column and its figure; marker styles and label handling in the sections figure.

## V0.4 — 2026-11-05
- Intervals with too few valid pixels (default < 20 %) have no data instead of 0, shown as NO DATA.

## V0.3 — 2026-11-05
- Identification marks can be shown together with quantified tracks.

## V0.2 — 2026-11-05
- Images are added to a core chosen in a dialog; ichnotaxa can be hidden while interpreting.
- Depth window and track selection for all figures; faster row counts and predictions.

## V0.1 — 2026-11-05
- Original images stored once on disk; pixels loaded only for the sections in use.
- Per-section working resolution can be changed later; cropping without re-encoding.
- Analysis interval set in centimetres, with the same rule in the program and the Python package (`bin_cm`).

---

## Development builds (V1–V33)

### V32–V33 — 2026-11-05
- Identification mode (presence of ichnotaxa without quantification), ichnotaxa legends and abbreviations, core
  sections figure and ichnotaxa distribution figure.
- Image cropping with depth recalculation; draggable Start/End markers of the analysis area; clean start without
  preloaded projects.
- Desktop program (Electron) for Windows, macOS and Linux, built and published by GitHub Actions.

### V26–V31 — 2026-11-01 to 2026-11-05
- Multiproxy rebuilt around interval layers and user-defined classifiers; neural network (multilayer perceptron);
  models look up their inputs by name.
- Training progress without freezing the page; version number shown in the program and stored in projects.

### V20–V25 — 2026-10-31
- Maps: seven gridding methods (inverse distance, nearest neighbour, triangulation, minimum curvature, radial basis
  functions, ordinary kriging, moving average), contours, colour scales and projections.
- Data-tab plots: stratigraphic logs and XY plots with fits and statistics.
- Scientific review: grouped validation, interval classifiers scored only on described intervals, maps from real
  samples only, distances in km, no extrapolation by default.
- Generic start screen; cores shared between projects counted once; resizable panels and maps; cross-project
  analyses; reading cursor on logs.

### V14–V19 — 2026-10-31
- Projects with several cores, a Data tab with computed columns and a free sheet, figures, secondary windows.
- Three ichnotaxa models (core, project, all projects); Models and training dialog with k-NN, Random Forest and naive
  Bayes and their evaluation.
- Renamed CorAnTool. Training project with synthetic data and a guided tour.

### V7–V13 — 2026-10-31
- Project library with autosave; core column with external records; working resolution on import.
- Enhancement presets from the literature (Dorador et al., 2014; Miguez-Salas et al., 2019), k-means threshold, hole
  filling, user presets and backups.
- Multiproxy mode: resampling, ratios, z-scores, labels and rules, Random Forest, k-NN, naive Bayes, k-means,
  leave-one-core-out validation, maps by age window; interval layers with hierarchy.
- Multi-selection of traces; light and dark themes.

### V3–V6 — 2026-10-30
- Rewritten as an installable Python package with command line and API: vectorised analysis, PNG/TIFF/JPEG, grey and
  RGB input, per-ichnotaxon percentages from colour-coded images, configurable index schemes, age model, CSV and Excel
  export. Fixes from version 2.1: the last interval is kept; greyscale images no longer fail. Results reproduce
  version 2.1 exactly (regression test). Original code kept in `legacy/`.
- New browser application: depth scale and age model, analysis area, enhancement, automatic detection, editing tools
  and exclusion layer, ichnotaxa labelling with incremental learning, automatic and manual BI and ii, Spanish and
  English interface.
- Offline single-file build; technical documentation.

### V1–V2 — 2019
- IchAnTool 2.1: console script and graphical interface that compute bioturbation percentage and BI/ii from core
  images with bioturbation painted in black.
