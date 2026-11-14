# Roadmap: later milestones and backlog

Work that is **not scheduled yet**. The live roadmap, with the current task cards, is [roadmap.md](roadmap.md);
completed tasks are in [roadmap-history.md](roadmap-history.md). Nothing here is authorised: a task moves to the
live roadmap, as a task card, when the maintainer schedules it. Task IDs are stable; keep them when moving a task.

**Required for version 1.0 (decided 13 November 2026): M6 advanced statistics and M7 radiographs.** They are
written as task cards by a design session once M8.4 has passed its milestone gate. Like every milestone, each ends
with a milestone gate on Windows, macOS and Linux ([AGENTS.md §6](../AGENTS.md#6-working-on-a-task)).

The order of the milestones follows the engine migration: M8 (live roadmap) comes first; advanced statistics (M6),
radiographs (M7) and large images (M2.3) build on the engine; acceleration (M4) and a possible new interface
shell (M9) are conditional on measurements.

## Milestones after M8

### M9 - Interface shell evolution (conditional)

The maintainer stated on 12 November 2026 that Electron is the interface shell for now and that a more fluid
system may replace it later. This records a future evaluation; it is not authorised work, selects no candidate
shell and does not change the M8 order.

- [ ] **M9.1 - Evaluate the interface shell after the engine migration.** Start only after M8.6, and after
      M8.4 has moved image ownership and heavy computation out of the renderer, so that remaining slowness is
      attributed to the shell or to application rendering on evidence rather than assumption.
  - Acceptance: first measure the accepted Electron build on M2.3 fixtures (startup, input-to-frame latency
    during pan/zoom/editing, idle and peak process-tree RSS, download and installed size) and identify which
    costs belong to the shell. Compare a candidate only against that baseline, on the same hardware and
    fixtures, and only if shell-bound costs justify it. The candidate reuses the engine protocol, method
    contracts and results unchanged; provides a tested migration of projects stored by the Electron program
    (IndexedDB under `app://corantool`), packages and folder backups; and ships portable and installed forms
    on every supported system. Record build, signing, platform web-view and maintenance costs. Keep Electron
    as the default and rollback until the maintainer accepts the transition.

### Capacity, advanced statistics and radiographs

Planned on 12 November 2026 ([V0.138](../CHANGELOG.md#v0138--2026-11-12)). These capabilities are **not
available** and not started; no editor is assigned. Their order follows the M8 sequence above; the maintainer
chooses which are required for 1.0.

| Goal | Tasks | Dependencies and proposed sequence |
|---|---|---|
| Fluid work with individual images of several gigabytes | M2.3.1–M2.3.5 | Establish real file/decoded-size benchmarks, then bounded tile access, viewing, analysis and saving. |
| Faster calculations with a responsive interface | M3.1.6–M3.1.7, M4.1.1–M4.1.2 | Build on the single engine and bounded scheduling; native Rust/GPU work remains conditional and later. |
| An implemented advanced-statistics module | M6.1–M6.6 | Use the accepted Python engine contract; methods are not reimplemented independently in the interface. |
| Radiographs alongside core photographs and records | M7.1–M7.4 | Use engine image/data services for native samples and measurements, with shared depth coordinates. |

M2.3.1 is the first large-image contract inside M8.4. M6.1 and M7.1 define scientific/input contracts after
the relevant engine/data services are accepted. Large radiographs depend on M2.3's bounded image path. Each
phase must be small enough to review and roll back independently; statistical methods are added one at a time.
Benchmarks use public or generated data; unpublished images are never committed.

### M0 - Baseline and project safety

All M0 tasks are complete: M0.1 baseline ([acceptance criteria](roadmap-history.md#m01-acceptance-criteria)),
M0.2 import/export safety, M0.3 project validation, M0.4 desktop protocol paths, M0.5/M0.5.1 untrusted
presentation values. Records: [history](roadmap-history.md#m0---baseline-and-project-safety).

### M1 - Editing and recovery

M1.1 (editing history), M1.2 (interrupted saves), M1.2.1 and M1.2.3 are complete
([history](roadmap-history.md#m1---editing-and-recovery)).

- [ ] **M1.2.2 - Diagnose remaining desktop hangs if reported.** Capture the triggering action, project
      dimensions, terminal/renderer error and whether the process is busy or waiting. Reproduce with public
      or synthetic data before attributing a memory, GPU or computation cause. The focused backup audit
      does not establish the cause of every hang reported by the maintainer. Reproduce the multiple-waiter
      `saveToDB` path flagged by source review before changing its concurrency controller. The opt-in desktop
      diagnostics of M1.2.3 record the evidence; remove them in a separate delivery once the diagnosis is accepted.

### M2 - Large projects and responsive display

M2.1 (large tables) and M2.2 (large images) are complete ([history](roadmap-history.md#m2---large-projects-and-responsive-display)).

- [ ] **M2.3 - Multi-gigabyte image workflows.** Extend the measured M2.2 scope to individual source files
      of several gigabytes and larger decoded rasters, including native grayscale/16-bit images. Raising
      the current input/memory limits alone is not an implementation of this task. Delivered through M8.4.
  - [ ] **M2.3.1 - Define fixtures, hardware and responsiveness targets.** Build deterministic 2, 4 and 8 GiB
        source-file cases, plus compressed cases whose decoded rasters exceed those sizes. Record dimensions,
        channels, bit depth, compression, tile/strip layout and exact encoded/decoded byte counts separately.
        Compare local-SSD hosts with 16/32 GiB RAM, measuring the complete desktop/engine pipeline. Use the
        current browser path only as a historical reference while it remains in the migration support matrix.
    - Acceptance: reproduce opening, first useful preview, cold/cached pan/zoom, editing, analysis, export and
      save/reopen with process-tree RSS, temporary-disk usage, copies and CPU/I/O attribution. Initial proposed
      targets are cached-navigation p95 frame time <=33 ms, control response <=100 ms and cancellation
      acknowledgement <=250 ms. Ratify achievable targets and an absolute working-memory/cache budget on
      named hardware before implementation; report cold loading and analysis throughput separately.
  - [ ] **M2.3.2 - Bounded image source and multiresolution tiles.** Read supported TIFF/BigTIFF regions on
        demand and generate/reuse a disk-backed pyramid without decoding the full raster into memory. Define
        a cancellable conversion path for non-random-access sources and a source/cache identity contract.
    - Acceptance: sampled native pixels, dimensions and coordinates match independent references exactly;
      peak working memory follows the declared tile budget rather than full raster size. Handle corrupt
      tiles, oversized declarations, interruption and exhausted disk space. Preserve originals and existing
      supported inputs; compare dependency, distribution and offline costs before selecting a decoder.
  - [ ] **M2.3.3 - Responsive tiled viewer and editing.** Load visible tiles with bounded prefetch/cache,
        level-of-detail selection, background decoding and cancellation of obsolete viewport requests.
        Store masks/exclusions and editing history in bounded chunks; keep full-resolution coordinates.
    - Acceptance: meet M2.3.1's agreed responsiveness/RSS targets during repeated pan/zoom and edits; evict
      buffers and worker/GPU resources predictably. Verify depth mapping, overlaps, exclusions, undo/redo,
      invalidation and identical exported masks. A lower-resolution preview must not silently change analysis.
  - [ ] **M2.3.4 - Analysis and export beyond resident memory.** Stream counting, filtering, detection,
        U-Net tiling and exports in independently delivered operations. Define filter halos, border rules
        and cross-tile object merging before replacing a whole-image operation.
    - Acceptance: exact integer masks/counts and reference-equivalent scientific results at predeclared
      tolerances, including objects crossing tile seams, fractional intervals and exclusions. Bound scratch
      memory, expose progress/cancellation and verify that cancellation publishes no partial result as complete.
  - [ ] **M2.3.5 - Large-project storage and recovery.** Stream original-image import, project packaging,
        backup and recovery with bounded buffers; make portable-copy versus external-source references
        explicit, with checksums and missing/moved-source recovery. Treat generated pyramids as disposable caches.
    - Acceptance: reopen multi-gigabyte projects with unchanged source bytes, masks and results; preserve
      the last good save after quota, disk-full, interrupted transfer and partial-cache failures. Verify
      legacy projects and portable desktop exports; validate the transitional HTML export/import route.

### M3 - Analysis and learned segmentation

Complete: M3.1.1–M3.1.5 (interval analysis performance; opt-in NumPy counting via
`SEDCORETOOL_EXPERIMENTAL_COUNTS=1`), M3.2.1–M3.2.3 (U-Net device fallback, safe dataset paths, preserved
models), M3.3.1 and M3.3.3 (palette inputs, manifest escaping). Records:
[M3](roadmap-history.md#m3---analysis-and-learned-segmentation),
[M3.3](roadmap-history.md#m33---python-input-and-export-contracts).

- [ ] **M3.1 - Analysis performance.** Profile Python and JavaScript before optimising shared algorithms.
      Preserve configurable interval boundaries and regression results.
  - [ ] **M3.1.6 - Review promotion of the measured NumPy counting path.** *(Largely overtaken: card M8.3.3 made the
        multi-row kernel the only implementation on 13 November 2026; what remains is the wider coverage below.)* Review M3.1.5's accepted workload
        results and extend coverage to representative overlaps, class counts, strided masks and radiograph-sized
        tiles before proposing a default change. Preserve the current rollback path and scientific contract.
    - Acceptance: matched end-to-end latency/RSS measurements, exact counts/indices and documented numerical
      parity; no universal speed claim from the original two fixtures. Promotion and flag removal remain
      separate maintainer decisions.
  - [ ] **M3.1.7 - Cancellable background calculation and bounded reuse.** Implement scheduling behind the
        M8 engine boundary with explicit buffer ownership, bounded worker concurrency, progress and cancellation.
        Evaluate dependency-aware reuse of counts, derived series and map grids after edits. Renderer workers
        may support presentation; new scientific worker implementations in JavaScript are not a separate backend.
    - Acceptance: the interface meets agreed response/cancellation targets while calculations run; stale jobs
      cannot overwrite newer edits/results. Include worker startup, buffer transfers and cache memory in
      end-to-end comparisons; require identical outputs and correct invalidation on every relevant input.
      Establish the accepted engine baseline before considering M4.1.1.
- [ ] **M3.2 - U-Net reliability.** Exercise representative CPU and GPU workloads. Test device fallback and
      memory failures, and record model identity and checksums for reproducible inference.
  - [ ] **M3.2.4 - Reproduce the managed trainer environment (AUD-09).** The optional desktop installer
        downloads dependencies whose versions can vary between installations. Select constraints from tested
        configurations, not the audit's example caps. Share tested constraints and update policy with the
        packaged base engine of M8.2; the optional trainer/CPU/CUDA matrix stays separate and must not make
        training packages mandatory for ordinary section analysis.
    - **Approach.** Document training-related network access in `SECURITY.md` and define tested
      dependency constraints for the supported Python, CPU and CUDA configurations.
    - **Acceptance.** Document the downloads and when they occur. Verify that two clean installs
      of a supported configuration resolve to the same dependency versions and can run a trainer
      smoke check. Keep coverage for CPU and each supported CUDA configuration.
    - **Likely touchpoints.** `desktop/trainer.js`, the Python U-Net dependency configuration,
      `SECURITY.md` and the trainer installation checks.
    - **Decision before implementation.** Define the supported environment matrix and how its
      constraints are updated and tested.
  - [ ] **M3.2.5 - Isolate caller random state during training (AUD-08).** Review Python, NumPy and
        Torch CPU/device seeding in `unet/train.py`, including model initialisation and data loaders.
    - Acceptance: caller random streams are preserved on success, failure and cancellation, while seeded
      training and checkpoint resume remain reproducible. Use local generators or scoped state restoration
      where framework operations require global generators. Exercise supported CPU/device paths without
      weakening the existing determinism contract or changing scientific defaults silently.

### M3.3 - Python input and export contracts

- [ ] **M3.3.2 - Describe fractional bin sizes accurately (AUD-05).** Align `CoreSection.bin_px`'s
      annotation with the existing float-valued API and documented fractional boundary rules.
  - Acceptance: inspect public annotations/documentation and retain fractional-bin and legacy numerical
    regressions. This is a type correction, not a new conversion or rounding algorithm.
- [ ] **M3.3.4 - Choose LAS ASCII metadata policy (AUD-07).** Decide how non-ASCII names, headers and
      units are represented before replacing the current ASCII substitution in `export.py`.
  - Acceptance: document predictable transliteration/rejection/warning behaviour, test accented and
    non-transliterable text and possible naming collisions, preserve numeric curves and valid LAS 2.0 syntax.
    Avoid silently treating all Unicode symbols as equivalent to accent removal.

### M4 - Optional acceleration

- [ ] **M4.1 - Targeted experiments.** After the M8 engine baseline, evaluate native kernels, GPU rendering
      or alternative tabular storage when a measured bottleneck justifies it. Compare performance,
      compatibility and maintenance costs. Browser/WebAssembly experiments are deferred.
  - [ ] **M4.1.1 - Conditional native Rust image kernel.** After the engine baseline is accepted, select one
        measured hotspot such as preview reduction, mask traversal or connected components. Compare the best
        accepted Python/NumPy/native-library path with a small Rust component called through the same engine API.
    - Acceptance: define the numerical contract and inputs first, count all buffer copies/bridge overhead,
      and preserve the engine API, supported Python callers and legacy scientific references. Initial promotion target:
      >=25% lower end-to-end median latency on each selected representative workload and <=10% peak-RSS growth,
      subject to M2.3's stricter absolute budget where applicable. Record build, portable/installer,
      platform-testing and dependency costs. Keep a default-off experiment and working fallback; stop if the
      target fails. The kernel is internal to the single engine; no broad language migration is selected.
  - [ ] **M4.1.2 - Conditional GPU display or computation.** After separating CPU, I/O and rendering costs,
        evaluate GPU tile display or one suitable numerical operation only where profiling justifies it.
    - Acceptance: compare with the best accepted CPU path, include upload/readback and GPU memory, handle
      device loss with CPU fallback, and validate deterministic/exact outputs or justified tolerances before
      implementation. Training-provider changes and GPU rendering are separate experiments.

### M5 - Release readiness

Complete: M5.2.1, M5.2.2 (documentation corrections) and M5.3 (type checking)
([history](roadmap-history.md#m5---release-readiness)).

- [ ] **M5.1 - Compatibility and reproducibility.** Verify that representative legacy projects open and can be
      recovered, that shared analysis agrees between JavaScript and Python, and that exported tables and figures
      include the information needed to reproduce them. Before a release, verify that the GitHub Actions
      versions used by the workflows run on the supported build matrix (AUD-11; tag existence alone is not proof).
- [ ] **M5.2 - Scientific validation and documentation.** Complete the release requirements in
      [Validation](#validation) and the relevant user guidance. The maintainer decides when to declare 1.0
      and publish it.
- [ ] **M5.4 - Reduce legacy JavaScript type diagnostics (AUD-14).** Replace the baseline entries with checked
      contracts as the corresponding modules are changed.
  - Evaluate `figview.js`, `navpreview.js`, `exportio.js`, `tableview.js` and `edit.js` one at a time
    (`unetmodel.js` and `sectiondepth.js` are already strict). Accept only checked contracts with no new
    diagnostics; prune resolved baseline entries without regenerating a baseline that admits new errors.
  - On the next TypeScript upgrade, migrate the deprecated `moduleResolution: "node"` setting and check
    both typecheck configurations and the diagnostic baseline against the new compiler.
- [ ] **M5.5 - Enforce the standalone module syntax contract (AUD-10).** Make unsupported module syntax
      fail at build time rather than producing an HTML file that fails from disk.
  - Deferred under M8: fix a blocker if the transitional standalone build needs it, otherwise reassess at
    the last-HTML cutover. Keep existing build checks until that documented cutover.
  - Acceptance: fixtures cover supported multiline imports and comments, residual imports/exports,
    export lists/re-exports and relative dynamic imports. Support or explicitly reject each construct with
    actionable diagnostics and no false positives from ordinary strings/comments. Preserve top-level name
    collision checks and dependency order; verify the result from `file://`. Compare standard-library checks
    with a parser only if needed, documenting dependency/offline costs before adding one.
  - Already done (R2, V0.126): local unaliased export lists, with explicit errors for unsupported lists.

### M6 - Advanced-statistics module

- [ ] **M6.1 - Data and method contracts.** Define an analysis dataset from selected cores, proxies,
      ichnological results and event families, with depth/age coordinates, units, missingness, provenance and
      an immutable input snapshot. Specify transformations, compositional variables and independent sampling
      units before selecting methods. Implement methods inside the M8 Python engine; assess required libraries,
      dependency costs and offline desktop packaging without creating another scientific backend.
  - Acceptance: explicit alignment/resampling rules, reproducible filters and transformations, memory limits,
    cancellation and a method registry with assumptions, outputs and predeclared reference tolerances.
- [ ] **M6.2 - Exploratory and association methods.** Implement descriptive/robust summaries, distributions,
      outlier diagnostics and Pearson/Spearman/Kendall association with effective sample counts, missing-data
      handling and uncertainty. Add inspectable plots linked to the selected observations and cores.
  - Acceptance: hand-computed and independent reference fixtures, constants/ties/missingness/unequal units,
    no mutation of measurements and explicit warnings when independence assumptions are unsuitable.
- [ ] **M6.3 - Multivariate analysis.** Implement PCA and hierarchical clustering with explicit scaling,
      distance/linkage choices, explained variance, scores/loadings and sensitivity to variable selection.
      Reuse current clustering/classifier machinery where appropriate instead of duplicating its definitions.
  - Acceptance: reproducible reference results, rank-deficient/collinear and missing-data cases, permutation
    and sign ambiguities handled in validation, and clear separation of exploratory groups from known classes.
- [ ] **M6.4 - Inference and statistical models.** Add regression/GLM and selected group-comparison methods,
      effect sizes, confidence intervals, multiple-testing correction and seeded bootstrap/permutation tests.
      Define blocked or core-level resampling for stratigraphic autocorrelation and repeated observations.
  - Acceptance: assumptions/diagnostics and independent sample counts accompany outputs; synthetic null and
    known-effect tests check calibration. Prevent leakage when choosing variables/scaling and evaluating models;
    document supported designs and validate each method independently before making it available.
- [ ] **M6.5 - Down-core and age-series statistics.** Develop cross-correlation, change-point and spectral
      analyses in separate deliveries, with an explicit treatment of uneven spacing, gaps, detrending,
      autocorrelation and age-model uncertainty. Do not infer causality from correlation or classification.
  - Acceptance: recover known synthetic signals/change depths within declared resolution, test null/aliasing
    cases and report uncertainty/sensitivity to resampling and age models. Define computational limits first.
- [ ] **M6.6 - Program integration and reproducible delivery.** Implement the statistics workspace with
      explicit input selection, transformations, method settings, progress/cancellation and saved analysis runs.
      Export result tables and SVG/PNG figures with input identity, method/version, parameters and random seed.
  - Acceptance: restore the same analysis after project reload, preserve source data and existing workflows,
    invalidate or label outdated results after edits, and verify portable/installed desktop operation offline.
    The interface displays engine results; no standalone-browser scientific implementation is required.
    Deliver validated methods incrementally; do not wait for every proposed method to release the first module.

### M7 - Radiographs and multimodal core images

Use M8's engine-owned source data, calibration and measurements. JavaScript provides the viewer and controls;
it does not implement a second radiograph-analysis path. Large inputs use M8.4/M2.3 services.

- [ ] **M7.1 - Radiograph input and metadata contract.** Inventory public/owner-approved examples and define
      a first 2-D format matrix: native grayscale TIFF/BigTIFF and relevant exported image formats, bit depth,
      intensity polarity, pixel spacing, orientation and depth coverage. Evaluate DICOM only if actual sources
      require it; record decoder, metadata, dependency and offline constraints before implementation.
  - Acceptance: approved fixtures with known raw samples/dimensions and metadata, invalid/unsupported-input
    behaviour, storage estimates and a versioned modality schema. Keep 3-D CT volumes outside this first scope.
- [ ] **M7.2 - Import and radiograph viewer.** Attach radiographs as an additional modality of a core/section,
      retaining the original bytes/native intensities. Provide grayscale window/level, inversion and display
      controls without overwriting calibrated values; use M2.3 for sources beyond resident memory.
  - Acceptance: exact raw sample preservation, high-bit-depth and orientation fixtures, bounded viewing,
    project save/reload and recovery. Previous single-photo projects retain their appearance and results.
- [ ] **M7.3 - Optical/radiograph alignment.** Add physical-scale and depth tie points, side-by-side and
      overlay inspection, cropping/registration controls and explicit handling of unequal resolution, gaps,
      distortion and partial section coverage. Map depth to age through the same selected-core age model.
  - Acceptance: independent known-coordinate fixtures establish alignment error limits before implementation;
    original coordinates remain recoverable and display transforms cannot silently alter analysis depths.
    Persist transformations, calibration provenance and uncertainty independently for each modality.
- [ ] **M7.4 - Radiograph measurements and figures.** Implement reproducible intensity/texture profiles,
      modality-specific annotations and selected analysis-region measurements; integrate them as labelled
      records/image tracks in Data, Multiproxy, statistics and publication figures.
  - Acceptance: reference profiles and region measurements, explicit raw/display/calibrated value distinctions,
    source identity and units in exports, synchronized optical/radiograph depth windows and SVG/PNG output.
    Radiographic contrast must not be treated automatically as density, ichnotaxon identity or bioturbation
    percentage without its own calibration/validation. Validate any such interpretation as a separate method.

## Existing backlog

Unscheduled ideas. None is authorised; each needs scope, acceptance criteria and the maintainer's approval
before work starts. Completed backlog items (F1–F4, G1, R1, R2 and others) are in the
[history](roadmap-history.md#multiproxy-analysis-maps-and-program-features).

### Distribution and publication
- [ ] First public release of the installers
- [ ] Python package on PyPI (`sedcoretool`)
- [ ] Archived release with a DOI (Zenodo)
- [ ] Software paper (`paper/`)
- [ ] Documentation website with example notebooks

### Segmentation and identification
- [ ] U-Net models trained and evaluated on annotated real cores
- [ ] Open dataset of annotated core images and masks, with an annotation protocol and inter-annotator agreement
- [ ] Classical segmentation baselines in Python for comparison
- [ ] Click-assisted segmentation with promptable models
- [ ] Texture descriptors for ichnotaxa

### Validation
- [ ] Automatic versus manual masks versus experts' visual BI/ii estimates
- [ ] Blind comparison of ichnotaxa identification with ichnologists
- [ ] Multiproxy classification on cores with an independent, published interpretation

### Multiproxy analysis and maps
- [ ] Permutation importance of variables (also for the neural network)
- [ ] Kriging variance maps
- [ ] Location map: cores from other projects and an inset location map

### Program
- [ ] Unified data import; age model edited in the core dialog
- [ ] Dedicated horizontal layout for each figure type
- [ ] Simultaneous editing of a shared project
- [ ] Split `app.js` into smaller modules (R1 and R2 done; next candidates: composition and class selectors,
      remaining interface import cycles)

### Further ichnological parameters
- [ ] Ichnodiversity, burrow size, tiering and cross-cutting relationships
- [ ] 3-D CT volumes: scope separately after M7's 2-D input, storage and calibration contracts are evaluated.
