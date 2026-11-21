# Roadmap history

Records of **completed** roadmap tasks, moved verbatim from [roadmap.md](roadmap.md) on 12 November 2026 so
that the live roadmap only lists current and pending work. Task IDs are unchanged. Each record links the
changelog entry and evidence of its delivery. Statements such as "next candidate" or "local on master"
describe the situation **at the time of that delivery**; the live state is in
[roadmap.md § Status and handoff](roadmap.md#status-and-handoff).

Do not edit these records except to fix broken links. A reopened task gets a new entry in the live roadmap.

## M8 - Completed engine-migration tasks

- [x] **M8.1 - Engine inventory and migration contract.** Map current JavaScript/Python calculations,
      callers, caches and image/data ownership. Include interval counts/indices, depth/age mapping, image
      operations/features, classification, interpolation and U-Net. Identify both duplicated methods and
      methods that currently exist only in JavaScript; do not assume the Python package already covers the app.
  - Acceptance: a source-backed ownership/migration matrix, versioned request/result/data contracts and an
    ordered list of independently testable slices. Define identifiers, units, masks/overlaps/exclusions,
    input revisions, seeds, provenance, errors, progress and cancellation. Select a bounded private local
    transport; large pixel buffers must not become JSON arrays copied through every request.
    Establish matched numerical, latency, cancellation and total-process memory gates before implementation.
  - Delivered in [V0.141](../CHANGELOG.md#v0141--2026-11-12): [source inventory and protocol/method contract](roadmap-engine-contract.md).
    Authorised on 12 November 2026 by the maintainer's instruction to continue. Editor: Codex; author-run
    verification, no independent reviewer assigned. The contract records object/class representation gaps,
    custom-tier precedence differences, bounded transport/ownership, ordered slices and predeclared gates.
    Current runtime and calculations are unchanged. M8.2 starts with synthetic protocol/failure fixtures and
    minimal runtime packaging; M8.3 alone connects scientific section results. No benchmark gate is claimed passed.
    Verification: 313 Python tests passed (six optional/permission skips), 218 Node tests, types without new
    diagnostics, Ruff, version consistency, document links, whitespace and standalone build passed. Documentation
    and version metadata only; no new tests or repeated browser E2E required. Local `master` delivery;
    GitHub retrieval requires an authorised push.

    - [x] **M8.2.1 - Experimental process/transport foundation**, [V0.142](../CHANGELOG.md#v0142--2026-11-12):
      bounded private frames, immutable staged buffers, isolated diagnostic worker, bounded queues, cancellation,
      session invalidation/restart, private scratch cleanup and a status-only Electron bridge. Standard library
      only; no scientific method is advertised. Development activation needs an explicitly selected Python;
      packaged activation remains unavailable. See [current implementation](TECHNICAL_DOCUMENTATION.md#262-experimental-engine-process).
      Validation on Windows/Python 3.12.4/Node 22: 341 Python tests passed (six existing optional/permission
      skips), 226 Node tests, types without new diagnostics, Ruff, version/whitespace and standalone build.
      Real Electron E2E passed with the experiment enabled and disabled, including save/reopen, interrupted
      saves, renderer crash recovery and foreign-origin IPC rejection. No cross-platform/clean-machine or
      total-process performance gate is claimed passed. Local `master` commit; an authorised push is needed
      for a GitHub handoff. Next editor starts M8.2.2; large commit-verification scheduling remains a load gate.
    - [x] **M8.2.2 - Reproducible runtime bundle**, [V0.143](../CHANGELOG.md#v0143--2026-11-12). Choose and test 64-bit runtime/minimal dependency
      constraints and checksums under M3.2.4; include them in per-platform desktop resources, support the macOS
      architecture layout, verify runtime identity and eliminate the development-interpreter dependency.
      Authorised by the maintainer's instruction to continue on 12 November 2026. Editor: Codex; author-run
      checks, no independent reviewer assigned. Four target artifact sets are pinned in `desktop/runtime-lock.json`;
      builds stage the runtime, minimal dependencies and full inventories, while launch verifies runtime/source
      identity and ignores system Python in packaged mode. The macOS layout retains separate Intel/ARM resources.
      Native Windows scientific/image checks, repeated offline reconstruction and relocated packaged-resource
      startup/worker checks are recorded in [delivery evidence](validation/M8.2.2-v0.143.json). macOS/Linux runtime
      execution and installer/clean-machine acceptance are not certified by the Windows checks; they stay in
      M8.2.3. The public API and optional trainer environment remain unchanged; base-runtime update policy is
      documented in SECURITY.md and §26.3 of the technical manual. The default-off flag remains in place.
      Delivery checks: 355 Python tests passed (six existing optional/permission skips), 232 Node tests,
      types without new diagnostics, Ruff, version/whitespace and standalone build. Windows unpacked build
      and packaged startup/worker passed; Electron save/recovery E2E passed with the bundled runtime and
      PATH excluding user Python. Runtime reconstruction retained identical manifests from the verified cache.
      The commit is local on `master`; GitHub/CI retrieval requires an authorised push. Next: M8.2.3, including
      native other-platform execution, installers/clean machines and cold verification/startup measurements.

### M8.2.3 - Packaging and lifecycle acceptance (Windows)

- [x] **M8.2.3 - Packaging and lifecycle acceptance (Windows).** Closed on 12 November 2026 by the maintainer's instruction, with the open items listed in M8.2.4. Record as of the closing:
      Verify offline portable/installed startup on clean Windows, macOS and Linux, lifecycle under load,
      CPU/RAM accounting, process-tree cleanup and project preservation. Keep the flag off; do not mark M8.2
      complete from development protocol tests alone.
  - Acceptance (from M8.1's gates): engine ready ≤5 s from spawn through the hello handshake, including
    runtime verification, measured cold and warm with the platform's default malware scanning; cancel
    acknowledgement ≤250 ms; cancelled terminal response and release ≤2 s; no process or temporary folder left
    after close or forced termination; download and installed sizes recorded. Measure each shipped form
    separately. If a form fails, record the measurement and present options to the maintainer; never weaken
    integrity checks silently or widen deadlines without evidence.
  - **Measuring tools** (all write a JSON report with `--out`):
    `tools/measure_engine_lifecycle.mjs` (verification, ready, stop, forced kill, leftovers; optional CPU load),
    `tools/measure_packaged_startup.mjs` (packaged program: time to window and engine ready, close, leftovers),
    `tools/measure_engine_cancellation.mjs` (transfer, cancellation latency, engine memory).
  - **Measured on Windows 11 (Ryzen 7 7700X, 16 logical CPUs):**
    - Lifecycle, development layout ([evidence](validation/M8.2.3-lifecycle-windows-v0.148.json)): idle
      verification 2.1 s + ready 0.31 s (passes); orderly stop 8 ms; no leftovers. With all 16 CPUs saturated,
      verification takes 16 s median (27 s max) and fails the 5 s gate. This explains the V0.144
      [concurrent-run observation](validation/M8.2.3-load-observation-v0.144.json) as CPU contention.
    - Forced termination: was 1.7 s idle and 2.6 s under load (`taskkill /T`). Fixed on this branch: the
      engine joins a kill-on-close Windows Job Object (`src/sedcoretool/engine/lifetime.py`); now 5 ms idle
      and 29 ms under load, no leftovers.
    - Packaged start-up ([evidence](validation/M8.2.3-packaged-startup-windows-v0.148.json)): installed or
      unpacked layout shows the window in 0.4 s; engine ready 2.6–2.95 s warm but 17–20 s on the first launch
      after building or installing. The NSIS installer installs in 56 s (7,428 files, 614 MB) and uninstalls in
      7 s leaving nothing behind. The former self-extracting portable `.exe` needed about 51 s to show the window.
    - Cancellation and memory with the diagnostic job ([evidence](validation/M8.2.3-cancellation-windows-v0.148.json)):
      acknowledgement 0.7 ms; running-job terminal response 170 ms median (200 ms max); queued job under 1 ms;
      engine tree 24 MB idle, 47 MB peak. Passes the gates for this diagnostic method only.
  - **Maintainer decisions of 12 November 2026, implemented on this branch:**
    - The Windows portable is a ZIP of the program folder (electron-builder `zip` target) instead of the
      self-extracting `portable` target. Built once (224 MB); its start-up is measured below.
    - Launch verification keeps a verified-identity record in the user-data folder and skips content hashing
      while file identity is unchanged ([evidence](validation/M8.2.3-verification-record-windows-v0.148.json),
      [technical manual §26.3](TECHNICAL_DOCUMENTATION.md#263-bundled-scientific-runtime)): 4.7 s full,
      0.18 s with the record, warm file cache. The first launch after installation still verifies everything.
  - **Portable ZIP measured on Windows** (`tools/measure_packaged_startup.mjs`, ZIP extracted to a temporary
    folder; evidence: [shared profile](validation/M8.2.3-portable-zip-record-windows-v0.148.json),
    [fresh profile](validation/M8.2.3-portable-zip-fresh-profile-windows-v0.148.json),
    [quiet rerun](validation/M8.2.3-portable-zip-rerun-windows-v0.148.json)):
    - Window visible after about 0.45 s on every launch (the self-extracting build needed 51 s). Close 70–120 ms,
      exit code 0, no leftover process or temporary folder.
    - Engine ready: 11.5 s on the first launch after extraction (cold file cache, full verification);
      0.72–0.79 s on later launches that reuse the verification record; 2.6–3.0 s when every launch verifies
      everything with a warm cache. The 5 s gate therefore passes for warm launches with or without the record
      and fails only for the first cold launch.
    - **Unexplained intermittent failure:** 2 of 12 launches in the first two batches (both the second launch)
      showed no application page within 120 s and were killed; 0 of 3 in a later rerun with the computer
      otherwise idle. Those two batches overlapped with heavy disk activity from other work in the same session,
      which is a possible but unproven cause. The tool now records the stage where waiting fails. Treat this as
      open until reproduced or cleared by more idle-machine runs.
    - Extracting the 224 MB ZIP with PowerShell `Expand-Archive` took 57 s (about 613 MB unpacked); the
      archive has no top-level folder, so users must use "Extract all" into a new folder.
  - **Idle process tree of the packaged ZIP** ([evidence](validation/M8.2.3-process-tree-windows-v0.148.json),
    3 launches, shared profile, no project open, engine experiment on): 5 processes under the program folder
    (Electron processes plus the engine coordinator; the diagnostic worker is not started until a job runs),
    309–370 MiB summed working set (shared pages are counted once per process, so this overstates real
    use) and 0.35–1 % of one core when idle. The first launch of this batch, after the machine had been idle,
    needed 24.7 s to reach engine ready (cold file cache, full verification), against 11.5 s for the first
    launch in the earlier batch: the cold first launch is 11–25 s and fails the 5 s gate; later launches 0.74–0.76 s.
    Memory while a job runs and with a project open is not measured.
  - **Remaining** (see the next steps in the status block):
    - [x] Portable ZIP start-up measurement (above), except the intermittent failure.
    - [x] Packaged start-up with the verification record (above: 11.5 s first launch, then 0.72–0.79 s).
    - [ ] Repeat the ZIP launches several more times on an idle machine to clear or reproduce the intermittent failure.
    - [x] Electron-plus-engine idle process-tree memory and CPU (above). Still open: with a project open and
          while a job runs.
    - [ ] macOS (Intel, Apple Silicon, universal DMG) and Linux (AppImage, DEB) execution.
    - [ ] Clean-machine runs and other antivirus configurations.
    - [ ] First-launch cold start (17–20 s) against the 5 s gate: still failing; needs a measured proposal
          for the maintainer if it remains above the gate after the record is in place.

### M8.2.4 - Follow-up of the Windows acceptance

Done on 12 November 2026 on branch `work/2026-11-12` (released in [V0.149](../CHANGELOG.md#v0149--2026-11-13)). M8.2.4 was opened to carry what M8.2.3 left
open. The items a Windows workstation could settle were settled; the rest became the release checklist of the
live roadmap when the two acceptance levels were adopted the same day.

- **Cold first launch.** Full verification took 11-25 s on a first launch because the runtime had 7,326 files.
  `prune_runtime` (`tools/prepare_engine_runtime.py`) now removes pip, the interpreter's `include`, `libs`, Tcl/Tk
  data, `idlelib`, `lib2to3`, `turtledemo` and test suite, and pandas' `tests` folders: 3,552 files, about 205 MB.
  A first attempt also removed numpy's `tests` folders and the runtime smoke check failed, because `numpy.testing`
  imports `numpy._core.tests._natype`; they are kept. Measured afterwards: full verification 1.2 s warm, 0.10 s
  with the verification record; first launch after extracting the portable ZIP 3.67-3.90 s to engine ready in six
  fresh extractions and 3.99-4.08 s in three more; later launches 0.68-0.81 s with the record and 1.5-2.4 s with a
  full verification each time. Not measured: a first launch after a reboot (empty file cache).
  Evidence: `docs/validation/M8.2.4-pruned-runtime-*.json`, `M8.2.4-zip-fresh-extraction-launches-windows.json`.
- **Intermittent "no window" launches (5 of about 80).** Resolved as a defect of the measuring tool, not of the
  program. With failure diagnostics added, two failures in a 40-launch batch showed a completely loaded page
  (`window.ichantool` present, interface text rendered). The tool waited with Puppeteer's default
  `requestAnimationFrame` polling, and Chromium stops animation frames while the window is covered by another
  one; the failures coincided with the computer being used. The tool now polls with a timer.
  Evidence: `docs/validation/M8.2.4-zip-repeat-40-windows.json` (2 failures with page state),
  `M8.2.4-zip-repeat-launches-windows.json` (15 of 15), `M8.2.4-zip-repeat-30-timer-polling-windows.json`.
- **Idle process tree** of the packaged program: 5 processes, 309-414 MiB summed working set (shared pages counted
  once per process), under 1 % of one core. With a project open and during a job: measured in card M8.3.8.
- **Observation, not investigated:** at start-up the packaged program logs `net::ERR_UNEXPECTED` for three
  optional sample-data requests (maintenance card H2 of the live roadmap).
- **Carried to the release checklist:** macOS and Linux execution, clean machines and other antivirus
  configurations, the cold-cache first launch, start-up with saturated CPUs, package sizes per platform.
- The desktop end-to-end test failed once during the session because `npm run dist` had rebuilt `desktop/web`
  without sample data; it passes after `node desktop/scripts/prepare.js --with-examples` (maintenance card H1).

## M0 - Baseline and project safety

- [x] **M0.1 - Reproducible performance baseline.** Benchmark and original measurements delivered in
      [V0.94](../CHANGELOG.md#v094--2026-11-09); independently reviewed and accepted in
      [V0.107](../CHANGELOG.md#v0107--2026-11-10).
  - Codex verified a source-fingerprint mismatch between the original report and clean V0.94, then repeated both
    cases from the clean delivery with one warm-up and five measurements each. Inputs, interval results and
    the synthetic ZIP fingerprints match the original; all reload and parity checks pass.
    [Clean-checkout evidence and provenance](benchmarks/M0.1.md#clean-checkout-repetition),
    [V0.106](../CHANGELOG.md#v0106--2026-11-10).
  - The maintainer authorised a separate Codex reviewer in place of Claude on 10 November 2026. That reviewer
    independently ran both complete cases, audited measurement boundaries and RSS accounting, recalculated the
    statistics, and verified source/input/result fingerprints, reloads and numerical/categorical parity.
    [Independent review and evidence](benchmarks/M0.1-independent-review-2026-11-10.md).
    The source-provenance finding is resolved by the matching clean-checkout reports; no implementation findings
    remain. Required delivery checks pass. The baseline remains informational, with no CI performance thresholds.
- [x] **M0.2 - Import and export safety.** Bound ZIP expansion and escape formula-like spreadsheet text
      while preserving numeric measurements. [V0.91](../CHANGELOG.md#v091--2026-11-09)
  - [x] **M0.2.1 - Verify stored ZIP member integrity.** Check the CRC in bounded blocks before delivering
        stored members. Verify corruption in project JSON and images and preserve existing projects.
        [V0.98](../CHANGELOG.md#v098--2026-11-09)
  - [x] **M0.2.2 - Budget Python image and mask loading.** Apply a documented per-load estimate before
        pixel decoding, including conversion and mask copies. Verify rejection through both loaders
        and the label-mask CLI. [V0.99](../CHANGELOG.md#v099--2026-11-09)
  - [x] **M0.2.3 - Bound Python mask label expansion.** Validate label IDs and class counts before
        allocating class results. Preserve exact interval results, sparse IDs and CLI exclusions.
        [V0.100](../CHANGELOG.md#v0100--2026-11-09)
  - [x] **M0.2.4 - Prevent batch LAS filename collisions.** Check all multi-core destinations before writing
        and create each output exclusively. Verify collisions, existing files and valid exports.
        [V0.101](../CHANGELOG.md#v0101--2026-11-09)
- [x] **M0.3 - Project validation.** Cover current and legacy projects with diagnostic warnings.
      [V0.96](../CHANGELOG.md#v096--2026-11-09)
  - [x] **M0.3.1 - Format inventory and depth diagnostics.** Document the import and migration paths and warn
        about suspect depth metadata. [V0.95](../CHANGELOG.md#v095--2026-11-09)
  - [x] **M0.3.2 - Mask and region diagnostics.** Flag invalid regions and unresolved trace or overlap
        references, and preserve the original project when opening for inspection. [V0.96](../CHANGELOG.md#v096--2026-11-09)
  - [x] **M0.3.3 - Validate Python analysis inputs.** Validate finite thresholds from 0 to 1 in the API
        and CLI. Report both filenames and dimensions for mismatched exclusion images.
        [V0.102](../CHANGELOG.md#v0102--2026-11-09)

- [x] **M0.4 - Bound desktop protocol paths (AUD-02).** [V0.127](../CHANGELOG.md#v0127--2026-11-11).
      Authorised by the maintainer on 11 November 2026. Replace prefix-only containment with a
      directory-boundary-aware check in `desktop/main.js`, after reproducing URL parsing and decoding.
  - Acceptance: requests resolving outside the web root cannot reach files, including sibling-prefix
    directories, encoded separators/traversal, Windows drive/UNC forms and malformed escapes. Legitimate
    assets and the existing `app://corantool` origin keep working. Cover platform path semantics and
    Electron protocol behaviour; distinguish a rejected request from one already normalised by URL parsing.
  - Reproduced before patching: unencoded `/../` and `/%2e%2e/` at the URL root are clamped to `/` by
    standard URL parsing (`new URL`), mapping inside `desktop/web`; percent-encoded separators (`..%2f`,
    `%2e%2e%2f`, `..%5c`) survive URL parsing and, after `decodeURIComponent`, escaped `desktop/web` into
    sibling-prefix directories (`web-sibling/...`) under the old `file.startsWith(WEB)` check, while
    malformed percent-escapes threw `URIError`.
  - Delivered: `isWithinRoot`, `resolveAppPath` and `handleAppRequest` in `desktop/main.js` validate the
    `app://corantool` origin, decode once with `URIError` handling, reject NUL bytes, encoded/literal
    separators (`%2f`, `%5c`, `\`), colons/Windows drive/UNC/device forms and directory URLs, and enforce
    strict directory containment via `path.resolve` and `path.relative`. Window-open and trainer IPC origin
    checks reuse `resolveAppPath`.
  - Verified across POSIX and Windows path semantics and on a temporary filesystem with sibling-prefix and
    parent sentinels (`tests/app/desktop-protocol.test.mjs`, `tests/e2e/desktop.mjs`). Required Python, Node,
    typecheck, Ruff, version and standalone checks pass. Local delivery on `master`; GitHub handoff requires
    an authorised push. Next candidate in priority order: M0.5.
- [x] **M0.5 - Validate untrusted presentation colours (AUD-03).** [V0.128](../CHANGELOG.md#v0128--2026-11-11).
      Authorised by the maintainer on 11 November 2026. Review no-data colour merging and
      all affected DOM/SVG consumers in `log.js`, `columns.js` and shared figure controls.
  - Acceptance: validate both `ndColor` and `ndLine` against supported hex forms, escape interpolated
    attributes, and test malformed strings/types from saved projects. No injected attribute or element
    appears in controls or exported SVG; invalid values fall back to the actual `ND_STYLE` defaults.
    Preserve valid short/full hex colours, legacy projects, figure settings and scientific arrays.
    The audit's listed default and description of the current colour loop differ from this source;
    derive the patch and tests from actual merge/render paths rather than copying the proposed fix.
  - Audited before patching: `ND_STYLE` defaults in `app/js/log.js` are `ndColor: '#f2f2f0'` and
    `ndLine: '#b9bdbb'`; `noDataDefs` interpolated `q.ndColor` and `q.ndLine` into `<pattern id="nodata">`
    without validation while `mergedStyle` only checked `Object.keys(LOG_STYLE).filter((k) => k.endsWith('Color'))`
    and did not merge `ND_STYLE` or validate `ndLine`, `markStroke`, class/record/band colours or map styles;
    `columns.js`, `figures.js`, `locmap.js`, `geo.js`, `multiproxy.js` and `app.js` also interpolated raw style
    and colour fields into `<input type="color">` and SVG attributes.
  - Delivered: `validHexColor(value, fallback)` (`^#[0-9a-f]{3}([0-9a-f]{3})?$/i`) and `mergedStyle` in
    `app/js/log.js` merge `ND_STYLE` and `LOG_STYLE`, validate all `LOG_STYLE` `*Color` keys, `ndColor`,
    `ndLine` and `markStroke`, normalise `ndFill`, `ndText`, `colOrder`, `colHide` and `speciesHide`, and guard
    non-primitive `fontSize`/`opacity` inputs; `columns.js`, `figures.js`, `locmap.js`, `geo.js`,
    `multiproxy.js` and `app.js` validate presentation, class, record, marker, band and map colours against
    their respective defaults and escape interpolated attributes (`&`, `<`, `>`, `"`, `'`).
  - Verified with unit tests across malformed strings, non-string types, `Object.create(null)`, valid `#rgb`
    and `#rrggbb` colours, form builders and SVG exporters (`tests/app/log.test.mjs`,
    `tests/app/locmap.test.mjs`), plus live DOM/SVG figure-composition checks (`tests/e2e/figure-composition.mjs`).
    Required Python, Node, typecheck, Ruff, version and standalone checks pass. Local delivery on `master`;
    GitHub handoff requires an authorised push. Next candidate in priority order: M3.2.3.

- [x] **M0.5.1 - Numeric map styles and completed figure safety checks.**
      [V0.129](../CHANGELOG.md#v0129--2026-11-11).
      Authorised by the maintainer on 11 November 2026 after review of V0.120–V0.128. Editor: Codex;
      author verification, no independent reviewer assigned. Work on `fix/map-svg-style-safety`, as
      explicitly requested; integrated into master with V0.130 on 11 November 2026.
  - Acceptance: normalise numeric multiproxy/location map presentation values before geometry/SVG output;
    fall back to field defaults for malformed strings, non-finite values and non-primitive inputs while
    retaining finite numeric settings, numeric strings and zero. Preserve saved inputs and exact scientific
    arrays. Wait for each completed figure before inspecting DOM and exported SVG in served/offline builds.
  - Reproduced: `labelSize` and `gridWidth` could inject SVG elements/event handlers. The previous colour
    regression sampled stale output while `busy()` had not started rendering, skipping the six requested
    figure types. Numeric style validation and sequential checks for eight types are delivered. The new
    browser regression fails when either pre-fix map module is served, confirming detection of both cases.
  - Verified: 227 Python tests (six optional/permission skips), 167 Node tests, JavaScript types, Ruff,
    version consistency, whitespace, standalone build and full Chrome smoke (356 traces, identical reload).
    Standalone U-Net and all three figure regressions pass from `file://`, including per-type safety/export
    checks and exact scientific-array preservation. No new dependency or scientific calculation changes.
  - Integrated into local `master` with V0.130 at `46a6dc6` on the maintainer's request of 11 November 2026.
    GitHub retrieval requires an authorised push of master. M3.2.3 is delivered below.

### M0.1 acceptance criteria

- Document one command through `tools/benchmark.py` that exercises the application's normal browser paths
  and the Python package's public analysis API. Use the public U1385I-1H example and one larger deterministic
  synthetic case. Record the fixture inputs, including the seed, image dimensions, section count and analysis settings.
- For both cases, report elapsed times for opening a prepared project, persisting a defined edit through normal
  saving and calculating interval results. Report Python analysis time separately on matching inputs. Report peak
  process memory and identify the processes counted, the sampling method and the units.
- Use at least one warm-up and five measured repetitions per case. Record the commit, runtime versions, operating
  system, hardware, per-run results, median and range. State the timing boundaries and how the fixture is reset
  between repetitions.
- Verify that the saved edit survives reopening and that JavaScript and Python agree on shared interval results
  under the same analysis settings. Document the tolerance for floating-point results and check categorical results
  for exact agreement.
- An independent reviewer reruns both cases and checks the measurement boundaries, memory accounting and result parity.
  The maintainer authorised a separate Codex reviewing agent in place of Claude on 10 November 2026.
  Codex addresses review findings before marking the task complete. Collect an informational baseline before
  proposing CI regression thresholds.

## M1 - Editing and recovery

- [x] **M1.1 - Editing history.** Measure long editing sessions and use overlap, undo and reload tests to guide
      changes to editing history and stack compaction. [V0.104](../CHANGELOG.md#v0104--2026-11-09)
  - [x] **M1.1.1 - Reclaim unused overlap stacks during editing.** Share stack entries with undo and rebuild
        active pixel codes independently. [V0.88](../CHANGELOG.md#v088--2026-11-09)
  - [x] **M1.1.2 - Measure object history costs.** Reproduce long sessions at two trace densities and measure
        retained snapshots, action latency and sampled CPU. [V0.97](../CHANGELOG.md#v097--2026-11-09)
  - [x] **M1.1.3 - Prototype object deltas for undo.** Record changed objects and share immutable descriptors.
        Keep typed image and mask buffers outside immutable state. Check equivalent undo, overlap order and
        reload results, then compare retained heap and action latency with the [M1.1.2 benchmark](benchmarks/M1.1.2.md).
        [Comparison and raw measurements](benchmarks/M1.1.2.md#m113-trace-deltas).
        [V0.103](../CHANGELOG.md#v0103--2026-11-09)
  - [x] **M1.1.4 - Native redo.** Replay the same trace and pixel records in both directions within a
        shared session budget. Evict complete groups and expose Redo through the localised toolbar and shortcuts.
    - Verified trace records, masks, exclusions, interval results and overlap order across Undo, Redo and
      compaction. Verified shortcut isolation in text fields, invalidation after a new edit and reload
      with empty history.
    - Recorded native Undo and Redo latency and combined retained heap at both densities in the
      [editing-history benchmark](benchmarks/M1.1.2.md#m114-native-redo).
      [V0.104](../CHANGELOG.md#v0104--2026-11-09)
- [x] **M1.2 - Interrupted saves.** Preserve the last successful save through IndexedDB and file backup failures.
      [V0.105](../CHANGELOG.md#v0105--2026-11-10). Integrated into `master` through [PR #23](https://github.com/SantiCa/SedCoreTool/pull/23).
  - Verified with synthetic data: synchronous clone failure after queuing metadata/data, transaction abort after
    a section write, interrupted image streaming, image replacement before manifest failure, and backup manifest
    open/write/close failures on real OPFS files.
    Prior metadata, sections, masks and image bytes remain intact; previous and retried saves reopen in a separate page.
  - Verified visible failure states, pending live edits, blocked project switching after a failed save, pending edits
    after a failed replacement import, and user-triggered retry for both storage paths.
  - Required Python, Node, type, version, Ruff and browser checks pass (82 Python tests; two optional U-Net tests
    skipped without ONNX/Torch; 124 Node tests). File tests cover the browser's staged-write contract; physical
    power loss and external folder synchronisation are outside the automated simulation.

  - [x] **M1.2.1 - Desktop backup recovery audit.** [V0.133](../CHANGELOG.md#v0133--2026-11-11).
        Authorised by the maintainer on
        11 November 2026 after repeated hangs and failed backup reactivation when starting from `desktop`.
        Editor: Codex; author verification, no independent reviewer assigned.
    - Scope: reproduce backup coordination, permission recovery and project-navigation waits on synthetic
      data, then verify the normal desktop example/detection/save/restart workflow. No private project access.
    - Acceptance: one folder writer per renderer, local navigation independent of slow external writes,
      pending edits copied after an in-flight run, all stored projects eligible in a new destination,
      actionable missing/denied/failed permission recovery and a settled restricted-folder event.
      Preserve the last good manifest/images and the existing failed-local-save navigation guard.
    - Delivered: coordinated background copies retain in-flight edits and refresh new destinations; recovery
      errors explain folder reselection, missing originals abort instead of producing empty images, and
      restricted Electron requests receive a denial callback. Local failed-save guards remain in place.
    - Verified: 227 Python tests (six optional/permission skips), 199 Node tests, JavaScript types, Ruff,
      version consistency, whitespace, standalone build, full Chrome smoke (356 traces, identical reload),
      offline backup controls and actual Electron backup/detection/save/restart checks. The
      [audit report](diagnostics/desktop-backup-audit-2026-11-11.md) separates reproduced failures, source findings
      and native-picker/cloud/private-project limits. Local commit on master; GitHub handoff needs an
      authorised push. M1.2.2 records remaining hang diagnosis and the unverified local-save concurrency path.

  - [x] **M1.2.3 - Temporary desktop operating diagnostics.** [V0.134](../CHANGELOG.md#v0134--2026-11-11).
        Authorised by the maintainer
        on 11 November 2026 to record application use while investigating failures. Editor: Codex;
        author verification, no independent reviewer assigned.
    - Scope: opt-in, local, bounded diagnostics across renderer failures and application restarts; activation,
      visible state, export, stop and clear controls. No raw messages, typed text, project contents or images.
    - Acceptance: off by default, automatic seven-day expiry, maximum two 2 MiB log files and 256 pending
      events, allowlisted technical fields, non-blocking recording, origin-checked IPC, atomic configuration
      and export replacement. Verify redaction, bounded storms, write/export failure, restart, real renderer
      crash and unchanged saved scientific state. Browser/offline builds keep these desktop controls hidden.
    - Rollback: disable recording or stop and clear it; no project format or storage key changes. Remove the
      instrumentation and controls in a separate delivery after the maintainer accepts the hang diagnosis.
      M1.2.2 remains the follow-up for interpreting the captured failure; adding a recorder does not resolve it.
    - Delivered: desktop controls and active indicator; filtered JSONL records in the application data folder;
      operation/backup stage markers, heartbeat, main-process resource and native failure events. No dependency,
      project format or default analysis change. Startup completion is exposed to automated checks to avoid
      premature clicks and redundant native-window navigation through the close guard.
    - Verified: 227 Python tests (six optional/permission skips), 208 Node tests, strict/all-module types,
      Ruff, version consistency, whitespace and standalone build. Full Chrome smoke passes (356 traces,
      identical reload); offline backup controls keep diagnostics hidden. Actual Electron testing verifies
      opt-in, synthetic private-text redaction, foreign-origin rejection, a real renderer crash, restart,
      export, stop, clear and exact preserved saved scientific state. Required packaging includes both modules.
    - Handoff: local delivery on master; an authorised push is needed for GitHub retrieval. The maintainer
      must enable recording and export the retained log after a real failure so M1.2.2 can identify its cause.

## M2 - Large projects and responsive display

The first-run project-entry blocker found while preparing M2.2 is corrected in
[V0.116](../CHANGELOG.md#v0116--2026-11-10). First creation/import and persisted reload pass in isolated empty
browser libraries, including the standalone HTML. The full interrupted-save/browser regression and required
delivery checks pass. Only a workspace with neither project ID nor cores bypasses the pending-save guard;
existing projects retain failed-save protection. Performance evidence is collected after this correction.

- [x] **M2.1 - Large tables.** Profile large table operations and evaluate visible-row rendering behind
      a default-off flag. Selection, editing, navigation and full exports verified.
      [V0.112](../CHANGELOG.md#v0112--2026-11-10).
  - [x] **M2.1.1 - Bound Data table row preparation.** Measure initial opening and one Show more expansion
        at 2,000, 20,000 and 100,000 rows. Prepare the displayed prefix while retaining full counts and CSV data.
        [V0.109](../CHANGELOG.md#v0109--2026-11-10), [benchmark and raw measurements](benchmarks/M2.1.md).
    - At 100,000 rows, median opening changes from 145.3 to 88.9 ms, edit-mode rebuilding from 96.3 to 52.4 ms,
      and Show more from 183.2 to 133.2 ms on the recorded machine. All full CSV fingerprints match.
    - Browser regression verifies bounded row reads, numbering across cores, text selection, edit/restore,
      complete export, core/layer filters, and empty/age-only cores. Required delivery checks pass.
  - [x] **M2.1.2 - Interval lookup and cumulative expansion.** Interval lookup delivered in
        [V0.110](../CHANGELOG.md#v0110--2026-11-10); CSV formatter follow-up and acceptance completed in
        [V0.111](../CHANGELOG.md#v0111--2026-11-10), [benchmark and raw measurements](benchmarks/M2.1.2.md#csv-formatter-follow-up-results-v0111).
    - The maintainer authorised the formatter follow-up on 10 November 2026; Codex implemented and verified it.
      A fresh isolated V0.109 comparison uses identical benchmark tools, one warm-up and five measured runs per
      size. The 100,000-row full CSV median falls from 169.6 to 66.3 ms (60.9%), exceeding the 25% target.
      All three complete CSV fingerprints match, including the original reports. The fixture uses integer
      measurements; equivalent speedups for decimal-heavy projects are not established.
    - Binary lookup handles finite disjoint intervals; overlapping/irregular inputs retain original first-match
      semantics. Names are resolved once per model call. Exact generated tests and browser table/CSV checks
      cover endpoints, gaps, overlaps, axis conversion, selection and edit/restore. Formatter regressions cover
      decimal rounding, numeric boundaries and spreadsheet escaping. Required delivery checks pass.
    - Ten Show more actions reach 10,400 rows in the medium/large cases. Cumulative rendering remains costly:
      the large-case ten actions total 4,880.9 ms. Whole-trial RSS remains about 2,275 MiB at that size;
      the medium-case median is higher with overlapping ranges. No rendering or memory improvement is claimed.
  - [x] **M2.1.3 - Viewport rendering experiment.** Visible-row rendering delivered behind a session-only,
        default-off checkbox. [V0.112](../CHANGELOG.md#v0112--2026-11-10).
    - Authorised by the maintainer on 10 November 2026. The [predeclared contract and acceptance criteria](benchmarks/M2.1.3.md)
      require bounded rows outside active selections, exact CSV data, cross-window editing/navigation and at least
      50% lower median total expansion latency against V0.111 using identical benchmark tools.
    - The 100,000-row fixture's ten expansions fall from 5,745.6 to 332.9 ms (94.2%). Final mounted rows
      fall from 10,400 to 36; all full CSV fingerprints match. Whole-trial peak RSS falls on the measured
      workloads, without isolating DOM allocations. [Raw reports, validation and limits](benchmarks/M2.1.3.md#recorded-results-v0112).
    - Browser checks cover cross-window/core editing and navigation, pointer selection during scrolling,
      retained selection/release, manual/calculated columns, filters, empty/age-only cores and rollback.
      A separate correctness check reaches the final row of a fully unlocked 100,000-row table, including
      the standalone HTML. Required delivery checks pass.
    - Roll back by disabling the flag. Make the experiment the default and remove the flag only after its
      acceptance criteria pass and the maintainer accepts the transition.
  - The experiment remains opt-in; large selections can retain extra rows and fixed widths can clip displayed
    text. Default promotion requires the maintainer's acceptance. The next performance scope is M2.2 profiling.
- [x] **M2.2 - Large images.** Profile opening and navigation on large cores. Evaluate tiled loading if justified.
      Verify depth mapping, editing and exported images.
      Completed for the public/synthetic workloads through [V0.119](../CHANGELOG.md#v0119--2026-11-10).
      The promoted preview retains session rollback; its measured memory margin is narrow. Tiled loading is
      deferred until full-resolution/16-bit workloads justify a separately authorised phase.
  - [x] **M2.2.1 - TIFF import and original image storage.** Read TIFF and BigTIFF in blocks, retain
        native 16-bit samples for enhancement and save originals in bounded writes.
        [V0.87](../CHANGELOG.md#v087--2026-11-09)
  - [x] **M2.2.2 - Opening and navigation profile.** [V0.117](../CHANGELOG.md#v0117--2026-11-10).
        Authorised by the maintainer on 10 November
        2026; editor: Codex; verification: reproducible benchmark and required checks. Measure M0.1 public and
        synthetic projects plus a synthetic core exceeding the existing cache budgets. The
        [predeclared contract](benchmarks/M2.2.md) defines timing, memory/CPU accounting, provenance and exact
        edit/depth/image-export checks. Choose the next optimisation from the evidence; do not change loading
        or cache defaults in this profiling phase.
    - The [complete report and source audit](benchmarks/M2.2.md#recorded-results) measure V0.116 application
      commit `0ecb5efb7b4fc51c62b6781511a26444fae4f1fb`, with matching application-source provenance and separate
      tool hashes. One warm-up, five measurements and one diagnostic CPU trial per case pass exact navigation,
      interval/mask/image, delete/undo/redo, persisted reload and full-resolution mask-PNG checks (21 trials).
    - Large-case opening through two frames is 1306.0 ms median; ten selections total 4805.4 ms. The first
      evicted return is 281.4 ms, versus 32.3 ms after reloading into memory. Whole-trial peak RSS is 3385.4 MiB
      median, including export/reload verification. Main-thread navigation samples identify the `drawNav` →
      `sectionCanvas` → `reduceRGBA` preview path as the next target. This delivery claims no speedup.
    - Required delivery checks pass: 188 Python tests (six optional/permission skips), 147 Node tests, types,
      Ruff, version consistency, full Chrome smoke test, standalone build and standalone first-run regression.
      The benchmark/report remain local on `master` until an authorised push. Next work is M2.2.3; this phase
      does not change image loading, caches or working resolution.
  - [x] **M2.2.3 - Navigation preview experiment.** [V0.118](../CHANGELOG.md#v0118--2026-11-10).
        Authorised by the maintainer on 10 November
        2026; editor: Codex; verification: unit/browser regression and matched benchmark. The
        [predeclared contract](benchmarks/M2.2.3.md) requires exact visual equality and bounded cache ownership.
        Prototype a separately cached, opt-in preview sized
        for the visible navigation strip; preserve the column/figure image path. Compare with the M2.2.2
        fixture sequence, environment and timing boundaries. Target at least 20% lower median large-case
        `first_visits_total_ms`, no more than 20 ms added median resident-return latency, and no more than 10%
        added median whole-trial peak RSS. Keep the old path as the default and rollback until accepted.
    - Predeclare the visual-equivalence bound against the legacy displayed strip before implementing the
      preview. Verify depth click/drag positions within 1e-9 working pixels, exact unchanged masks/indices,
      saved/reloaded edits and full-resolution exports. Promotion requires the maintainer's acceptance.
      Tiled loading remains deferred pending evidence on workloads that justify it.
    - Delivered behind a default-off, session-only checkbox in the Sections panel. One-pass photo/mask
      preparation retains the legacy reduction/compositing grid temporarily and caches only the displayed
      strip, with weak section ownership and an 8 MiB LRU limit. Disable it to clear the cache and roll back.
    - The [matched reports and author audit](benchmarks/M2.2.3.md#recorded-results) use identical tools on V0.117
      and the fingerprinted V0.118 working tree. Large-case first visits fall from 4407.0 to 2921.3 ms median
      (33.7%); resident returns stay at 32.2/32.3 ms; median whole-trial peak RSS rises 4.8%, within the 10% limit.
      All 45 benchmark trials pass; separate visual trials check 31 complete gutters with zero differing pixels.
      A separate canonical comparison verifies exact public-core scientific state despite random section IDs.
    - Required checks pass: 188 Python tests (six optional/permission skips), 150 Node tests, types, Ruff,
      version consistency, full Chrome smoke test, standalone build and offline navigation regression.
      Browser checks cover cache invalidation/disposal, pointer depth, unchanged column SVG and saved state.
      Delivery remains local on `master`; GitHub handoff requires an authorised push.
  - [x] **M2.2.4 - Accept or revise navigation-preview promotion.** [V0.119](../CHANGELOG.md#v0119--2026-11-10).
        Authorised by the maintainer's
        request to continue on 10 November 2026; editor: Codex; verification: matched benchmark and browser/
        offline regression, with no independent reviewer assigned. The [contract](benchmarks/M2.2.4.md)
        enables the preview at startup while retaining a session rollback control. Verify current/legacy
        project compatibility, fallback dimensions and invalid regions, export/save regressions and the same
        benchmark limits on public and synthetic workloads. Private-project acceptance has not been reported;
        removing the rollback control is outside this phase. Full-resolution and 16-bit TIFF profiling remains
        a separate candidate if real workloads justify tiled loading.
    - Delivered: preview starts enabled, with an explicit session control to restore the previous renderer.
      Invalid saved regions and unsupported/noninteger preview dimensions use the existing path. Saved
      projects and scientific definitions remain unchanged.
    - [Matched reports and author audit](benchmarks/M2.2.4.md#recorded-results) verify identical application/
      tool fingerprints on both paths. Large first visits fall from 5108.6 to 3403.4 ms median (33.4%);
      resident return adds 0.1 ms. Peak RSS rises 9.99948%, formally within 10% but with less than 0.02 MiB
      headroom. No robust memory margin is established; retain rollback and require further representative
      memory evidence before any future removal. All 45 trials and 31 exact gutter comparisons pass.
    - Verified current, IchAnTool v2 and CorAnTool v3 imports with images/masks, session reset and migrated
      reload, fallback/cache lifecycle, pointer depth, unchanged column SVG and full figure/save regressions.
      Checks pass: 188 Python tests (six optional/permission skips), 150 Node tests, types, Ruff, version
      consistency, full Chrome smoke, standalone build and offline current/legacy navigation regression.
    - Local delivery on `master`; GitHub handoff needs an authorised push. The next roadmap phase is M3.1
      analysis profiling; no further workstream is started here.

## M3 - Analysis and learned segmentation

  - [x] **M3.1.1 - Vectorise Python index classification.** Compile interval maps and preserve custom
        scheme precedence. [V0.89](../CHANGELOG.md#v089--2026-11-09)
  - [x] **M3.1.2 - Profile shared interval analysis.** Authorised by the maintainer on
        10 November 2026; editor: Codex; verification: reproducible author measurements and automated checks.
        Measurement/report delivered in [V0.120](../CHANGELOG.md#v0120--2026-11-10), following the
        [contract, diagnostic amendment and evidence](benchmarks/M3.1.2.md). No independent reviewer assigned.
    - Both M0.1 input/2 cm result fingerprints match exactly. Fourteen fresh browser/Python trial pairs
      preserve inputs and repeat their own results exactly; cold/cached/direct browser paths agree.
      Separate CPU profiles identify row/class counting as the subsequent performance candidate.
    - The original 1.37 cm public-case parity criterion fails: conversion operation order moves half-row
      boundaries by one row in sections 2 and 4, affecting 216 intervals, two BI values and one ii value.
      Full arrays and failed parity remain explicit in the original report. Scientific acceptance is resolved
      by M3.1.3 in [V0.121](../CHANGELOG.md#v0121--2026-11-11). The original profiling delivery changed no
      analysis implementation or tolerance.
    - Checks pass: 193 Python tests (six optional/permission skips), 152 Node tests, types, Ruff, version
      consistency and standalone build. The browser driver verifies normal save/reload fixture preparation.
      V0.120 is available on `origin/master` at `33e811d`; its correction follows below.
  - [x] **M3.1.3 - Align fractional interval boundaries.** [V0.121](../CHANGELOG.md#v0121--2026-11-11).
        Authorised by the maintainer on
        11 November 2026; editor: Codex; verification: shared regressions and fixture parity, no independent
        reviewer assigned. Define and document one canonical centimetre-to-row conversion order in Python and
        JavaScript before optimising either path. Keep the documented half-up bin-edge rule.
    - Acceptance: exact cross-language row boundaries at half rows and adjacent floating-point values;
      both M0.1 fixtures pass 2/1.37 cm parity at the unchanged 1e-9 tolerance with exact indices/missing
      values; the legacy reference and unaffected integer/default outputs remain equivalent. Add a
      regression for the measured 7,450-row, 1.49 m sections and record the changed fractional results.
    - After correction, define a separately authorised row/class-count performance experiment using the
      matching inputs, bounded memory, current public API and configurable index schemes. No acceleration
      technology or algorithm replacement is selected in the profiling delivery.
    - Delivered: Python divides rows by centimetre span before multiplying by interval thickness, matching
      the application's existing order. The half-up rule and 1e-9 tolerance are unchanged. Shared fixed tests
      cover measured sections, adjacent floats, units, default/integer bins and hand-computed scientific values.
      [Validation and raw evidence](benchmarks/M3.1.3.md): fourteen browser/Python trial pairs pass both
      2/1.37 cm cases, with exact indices/missing values, M0.1 inputs/results and save/reload checks.
      All application result hashes and three unaffected Python case/interval hashes match V0.120 exactly.
    - Required checks pass: 215 Python tests (six optional/permission skips), 153 Node tests, types, Ruff,
      version consistency and standalone build. Local delivery on `master`; GitHub handoff needs an
      authorised push. Recalculate affected fractional Python results from V0.120 or earlier.
  - [x] **M3.1.4 - row/class-count performance experiment.** Authorised on 11 November 2026;
        editor: Codex; author verification, no independent reviewer. [Contract](benchmarks/M3.1.4.md). Compare bounded counting alternatives with the corrected M3.1.3 inputs and the
        existing public APIs. Predeclare latency and memory targets before implementation; preserve exact
        row boundaries, configurable index precedence, overlap/exclusion behaviour and legacy results.
        Do not select an acceleration technology or promote a replacement without measured acceptance.
    - Completed experiment in [V0.122](../CHANGELOG.md#v0122--2026-11-11): bounded NumPy row histograms
      remain opt-in via `SEDCORETOOL_EXPERIMENTAL_COUNTS=1`. [Evidence and failed acceptance](benchmarks/M3.1.4.md).
      All scientific fingerprints match; synthetic API latency worsens 3.9/5.2%, so no promotion.
      Public timing is confounded by background load. Memory remains within the declared limit.
      Checks: 217 Python tests on both paths (six skips), 153 Node tests, types, Ruff, version, standalone.
      Local delivery on master; authorised push needed for GitHub handoff. A multi-row prototype and
      counterbalanced measurements are a separate candidate requiring authorisation.
  - [x] **M3.1.5 - Multi-row Python counting.** [V0.123](../CHANGELOG.md#v0123--2026-11-11). Authorised on 11 November 2026;
        editor: Codex; author verification, no independent reviewer. [Predeclared contract](benchmarks/M3.1.5.md).
        Evaluate bounded multi-row NumPy histograms with counterbalanced default/experimental process pairs.
        Require >=20% lower median and paired median API latency at both interval sizes in both reference
        fixtures, <=10% whole-worker peak RSS growth, exact scientific fingerprints and regression coverage.
        Keep the current default and rollback flag. If NumPy fails, the maintainer authorises a small Rust
        counting kernel next; stop before Rust if NumPy meets the contract.
    - Delivered: bounded multi-row NumPy histograms pass all four latency targets and both memory targets.
      Counterbalanced API median time falls 59.9–61.5% on public and 29.8–30.2% on synthetic inputs;
      median whole-worker peak RSS rises 0.60/0.75%. Exact scientific fingerprints match throughout.
      The experiment remains opt-in; Rust is not needed under the authorised sequence.
    - Checks: 223 Python tests on both paths (six optional/permission skips), 153 Node tests, types, Ruff,
      version consistency and standalone build. Local delivery on master; GitHub handoff requires an
      authorised push. Next candidate: accept default promotion after reviewing the measured scope and
      broader workload needs; flag removal remains a separate decision.

  - [x] **M3.2.1 - U-Net device selection and CPU fallback.** Probe accelerator memory, retry on CPU
        after a recoverable GPU error and expose an explicit CPU option. [V0.90](../CHANGELOG.md#v090--2026-11-09)
  - [x] **M3.2.2 - Confine U-Net dataset output paths.** Generate portable, bounded tile names from
        display labels and the exact core/section identity; verify resolved destinations and create files
        exclusively. [V0.108](../CHANGELOG.md#v0108--2026-11-10).
    - Reproduced outside-file overwrites and label/boundary/case collisions in Windows from ZIP and folder
      exports. Verified absolute, drive-relative, UNC, slash/backslash, traversal, control, Unicode and long
      identifiers, duplicate rejection before overwrite, stable naming and late file collisions.
    - Verified linked-output rejection, including Windows junctions, preservation of outside sentinels,
      exact image/mask pixels in binary and multiclass preparation, and unchanged train/validation/test cores.
      Regression tests run in the existing Python CI matrix, including Windows; required delivery checks pass.
  - [x] **M3.2.3 - Preserve the last working U-Net model.** [V0.130](../CHANGELOG.md#v0130--2026-11-11).
        Authorised by the maintainer
        on 11 November 2026. Editor: Codex; author verification, no independent reviewer assigned.
        Work on `fix/map-svg-style-safety`; integrated into master on 11 November 2026.
    - **Approach.** Prepare/train in `staging/<name>.pending`. Publish immutable ONNX/JSON/evaluation
      generations through one atomically replaced reference; retain old files and legacy readers.
    - **Acceptance.** Inject failures during preparation, training and publication, and test
      cancellation. The previous ONNX and JSON stay byte-identical and load through the normal
      model reader. A successful run exposes the new matching pair. Exercise the resume path.
    - **Publication/resume decision.** A required test-core evaluation must finish successfully before
      publication, without a new score threshold. Resume uses staged tiles/checkpoints, or copies a legacy
      checkpoint and best/pending-best weights while reusing its original prepared dataset. A new fresh
      run discards only that name's staged attempt. Published generations remain untouched.
    - **Verified.** 198 Node tests, including 32 trainer lifecycle/packaging cases; 227 Python tests (six
      optional/permission skips); JavaScript types, Ruff, version consistency, whitespace and standalone build.
      Real Electron E2E passes for app://, trainer IPC, detection and pending save across process restart.
      Fault injection covers preparation, training, evaluation, partial model/reference writes, flush/replacement
      failure and cancellation. Old ONNX/JSON bytes and matching scores survive through normal/reopened readers;
      successful staged/legacy resumes publish a matching pair. No PyTorch training or real ONNX provider is run
      by the new lifecycle fixtures; scientific Python and web algorithms are unchanged.
    - **Handoff.** Integrated into local `master` at `46a6dc6` on the maintainer's request of 11 November 2026;
      GitHub retrieval requires an authorised push of master. Prior and unreferenced generations are retained
      without automatic cleanup; power-loss durability and cross-process training locks are outside this delivery's guarantees.
      Exclusion-layer documentation follows in M5.2.1.

## M3.3 - Python input and export contracts

- [x] **M3.3.1 - Define palette hex input forms (AUD-04).** [V0.139](../CHANGELOG.md#v0139--2026-11-12). Decide and document support for short
      `#rgb` alongside full `#rrggbb` in `segmentation.py`, including whitespace and invalid-input handling.
  - Acceptance: named palette entries using equivalent supported hex/RGB forms produce exactly the same
    masks and class ordering. Malformed forms raise clear errors; existing valid palette calls remain valid.
  - Authorised by the maintainer on 12 November 2026. Editor: Codex; author verification, no independent
    reviewer assigned.
  - Delivered: 3/6 hexadecimal digits, optional single `#`, either case and surrounding whitespace;
    short digits expand exactly to their RGB values. Invalid lengths/content are rejected with the palette
    class name, retaining the exception cause. Existing valid full/bare hex and RGB calls remain supported;
    tolerance, first-match precedence, class order and scientific calculation are unchanged.
  - Verified: 46 new cases include all 4,096 short triplets, independent exact masks/scientific tables,
    malformed inputs and byte-identical `analyze`/`batch` CSV results. An invalid palette preserves a
    previous result. Checks pass: 313 Python tests (six optional/permission skips), 218 Node tests,
    types, Ruff, version consistency, whitespace and standalone build. Python CLI paths are tested directly;
    the unchanged browser interface/save code does not require a repeated browser E2E run.
  - Local delivery on master; GitHub retrieval requires an authorised push. Next priority candidate:
    M3.2.5 caller random-state isolation. No further phase is started in this delivery.

- [x] **M3.3.3 - Verify manifest escaping and manual editing (AUD-06).** [V0.137](../CHANGELOG.md#v0137--2026-11-12). Reproduce the generated CSV,
      spreadsheet/text-editor edit and `read_manifest` round trip before changing the format.
  - Acceptance: preserve exact paths/names beginning with apostrophes, `-`, `+`, `=`, `@`, whitespace and
    ordinary text, including mixed values in the same marked row and unmarked user manifests. Retain formula
    protection and numeric depths. Document `__sedcoretool_csv_escape__` / `apostrophe-v1` and supported
    editing rules; give existing generated manifests a compatibility path if encoding changes are needed.
    Source review alone does not confirm the audit's double-escape claim; close it with reproduction evidence.
  - Authorised by the maintainer's instruction to continue the next roadmap point on 12 November 2026.
    Editor: Codex; author verification, no independent reviewer assigned.
  - Delivered: generated CSV, marked text edits, unmarked user input and controlled literal-text XLSX
    save/reopen/CSV round trips retain the existing encoding. Reproduced and corrected the reader's loss
    of missing-value-like identifiers (`NA`, `NULL`, etc.); numeric depths, empty-field defaults, exclusions
    and scientific results remain unchanged. No format migration is needed.
  - [Reproduction evidence and limits](diagnostics/manifest-round-trip-2026-11-12.md): 40 new cases include
    110 generated section round trips, mixed rows and exact batch results. Native spreadsheet interfaces
    and locale-dependent CSV conversions remain unverified; the tested XLSX path uses openpyxl.
    Checks pass: 267 Python tests (six optional/permission skips), 218 Node tests, JavaScript types,
    Ruff, version consistency, whitespace and standalone build. The application interface and saving
    implementation are unchanged, so no repeated browser E2E run is required for this delivery.
  - Local commit on master; GitHub retrieval requires an authorised push. Next priority candidate:
    M3.3.1 palette hex input forms; no further phase is started here.

## M5 - Release readiness

  - [x] **M5.2.1 - Correct exclusion-layer claims (AUD-12).** [V0.131](../CHANGELOG.md#v0131--2026-11-11).
        Reconcile technical-documentation
        limitations (§32) and the paper's numerical description with current Python API/CLI/batch support.
    - Authorised by the maintainer's request to integrate V0.130 and continue the roadmap on 11 November
      2026. Editor: Codex; author verification, no independent reviewer assigned.
    - Acceptance: remove the false application-only limitation, use actual API and CLI names
      (`analyze_mask`, `--exclude`, `--exclude-value`), and retain real differences such as absent Python
      `noDataPad`. Link existing validation evidence without claiming parity outside its tested scope.
    - Delivered: §25.5 and §32 describe existing array/image/label exclusions, batch manifests and the
      application-only drawing/noDataPad capabilities. The paper uses the same definition and links §31.1,
      which identifies existing exclusion tests and limits the equivalence claims to their tested scope.
      README guidance already describes exclusions correctly; no user workflow or scientific code changes.
    - Verified: 227 Python tests (six optional/permission skips), 198 Node tests, JavaScript types, Ruff,
      version consistency, whitespace and the added local documentation links. No new tests or E2E run are
      needed for this documentation/version-only delivery. Local commit on master; GitHub retrieval requires
      an authorised push. Next priority candidate: M5.2.2 technical-document navigation.
  - [x] **M5.2.2 - Repair technical-document navigation (AUD-13).** [V0.132](../CHANGELOG.md#v0132--2026-11-11).
        Put the `i18n.js` row inside the
        repository table and move experimental counting out of the References section.
    - Authorised by the maintainer on 11 November 2026. Editor: Codex; author verification, no independent
      reviewer assigned.
    - Acceptance: the repository table renders as one table; algorithm details belong with the Python
      analysis description and verification evidence is linked from §31. Check headings, contents and links;
      preserve formulas, current defaults and the distinction between opt-in and default counting.
    - Delivered: the source-code map contains one table including `i18n.js`; experimental counting is a
      subsection of §25.2, linked from the contents with its existing anchor preserved. §31.1 links the
      counterbalanced evidence and counting regressions. Contents lists have explicit paragraph separation.
      Algorithm text, formulas, bounds, defaults, rollback and bibliography are preserved; counting stays opt-in.
    - Verified: rendered Markdown has one source table with all 28 module rows; the counting subsection is
      inside the library API, and all local manual links/fragments resolve. Compared relocated algorithm text,
      main section headings and bibliography with the previous delivery. Required checks pass: 227 Python
      tests (six optional/permission skips), 198 Node tests, JavaScript types, Ruff, version consistency and
      whitespace. No new tests or E2E run are needed for this documentation/version-only delivery.
    - Handoff: local commit on master; GitHub retrieval requires an authorised push. Next priority candidate:
      M3.3.3 manifest escaping/editing reproduction, requiring separate authorisation.
- [x] **M5.3 - JavaScript type checking.** Check critical modules strictly and detect new diagnostics across
      the application. [V0.92](../CHANGELOG.md#v092--2026-11-09)

## Multiproxy analysis, maps and program features

- [x] **G1 - Extend proxy maps across the visible sea.** [V0.135](../CHANGELOG.md#v0135--2026-11-11).
      Authorised by the maintainer on 11 November 2026, with coverage explicitly defined as the visible marine
      area. Editor: Codex; author verification, no independent reviewer assigned. Add an explicit IDW preset
      without a hull or search-radius cut-off, retain the land mask, preserve existing defaults/saved settings
      and identify extrapolated output. The frame is not a geological basin polygon.
  - Acceptance verified: exact unchanged interior IDW cells at a fixed frame/resolution, constant-field
    preservation, finite extended estimates, land masking, unchanged measurements/analysis state,
    saved coverage, restored hull restriction, both map panels and SVG/PNG export annotations.
  - Delivered: 227 Python tests passed (six optional/permission skips), 212 Node tests, type checks with no new
    diagnostics, Ruff, version consistency, standalone build, full Chrome smoke and the same map regression
    directly from the offline HTML. Visual inspection verifies controls, coast masking and the exported note.
  - Local delivery on `master`; GitHub handoff requires the maintainer's authorised push. Extrapolated values
    remain exploratory; coarse cell edges can cross the shoreline because masking uses each cell centre.

- [x] **F4 - Event shading in proxy figure tracks.** [V0.136](../CHANGELOG.md#v0136--2026-11-12). Authorised by the maintainer on
      11 November 2026; editor: Codex; author verification, no independent reviewer assigned.
      Restore per-figure shading controls for whole-core, core-column and multiproxy-log figures. Select
      interval families and computed classifications, including more than two simultaneous sources;
      choose per-source opacity, per-class colours, whole-panel or under-curve fill, and blended or split layers.
  - Acceptance: preserve original intervals, classes, predictions, measurements and proxy paths; correct depth/
    age mapping for the selected core; independent figure types/tabs; inherited settings, save/reload, reset,
    source-qualified legend and SVG/PNG. No independent analysis or performance work is included.
  - Delivered: 218 Node tests, 227 Python tests (six optional/permission skips), types without new diagnostics,
    Ruff, version consistency, standalone build, full Chrome smoke and the same event regression directly from
    the offline HTML pass. Visual inspection verifies the controls, painted under-curve fill and wrapped legend.
    PNG verification samples an actual shaded pixel, not only the export signature. Malformed saved presentation
    falls back safely; existing class colours and data are preserved.
  - Local delivery on `master`; GitHub handoff requires the maintainer's authorised push. Automatic sources
    require available predictions; the existing retraining workflow remains responsible for model restoration.
- [x] **F2 - Multiproxy figure composition.** [V0.114](../CHANGELOG.md#v0114--2026-11-10). Authorised by the maintainer
      on 10 November 2026. Editor: Codex; verification: automated checks and browser/standalone regression. Add ichnotaxa with the
      shared presentation controls; independently choose, order, hide and scale core, proxy and interval tracks
      per figure tab. Verify selected-core units/age mapping, unchanged measurements and analysis settings,
      saved composition, reset and SVG/PNG.
  - Delivered and verified: 181 Python tests passed (six optional/permission skips), 143 Node tests, types,
    Ruff, version consistency, standalone build, full Chrome smoke test and standalone figure regression.
    Exact measurements and analysis/view settings remain unchanged by figure composition. Mixed units,
    selected-core age coordinates, tab independence, save/reload, reset, SVG/PNG and visual layout pass.
  - Local delivery on `master`; GitHub handoff requires the maintainer's authorised push. Independent axis and
    image controls are delivered in F3.
- [x] **F3 - Extend figure composition across figure types.** [V0.115](../CHANGELOG.md#v0115--2026-11-10). Authorised by the maintainer on
      10 November 2026; editor: Codex; verification: automated checks plus served/standalone browser regression.
      Continue the maintainer's requested freedom of
      composition in a separate phase: independent track/style controls in the remaining core/log figures,
      including image treatment and vertical-axis selection. Preserve their existing defaults and saved projects.
  - Acceptance: independent core/log tracks, records and presentation; per-type distribution/section style and
    depth windows; independent multiproxy axis/image treatment; exact unchanged analysis state and measurements;
    correct nonlinear age image/occurrence mapping and classification endpoints; inherited labels and legacy
    projects; tab isolation, saved profiles, reset and SVG/PNG.
  - Delivered and verified: 181 Python tests passed (six optional/permission skips), 147 Node tests, types,
    Ruff, version consistency, standalone build, full Chrome smoke test and all three figure regressions in
    the offline HTML. New-profile browser checks also verify photo-proportion controls and inherited custom labels.
    Visual inspection passes; presentation leaves the analysis views and measurement arrays exactly unchanged.
  - Local delivery on `master`; GitHub handoff requires the maintainer's authorised push. Section comparison
    panels retain a depth axis; class colours and existing arrow annotation settings remain shared project/figure
    settings. The next performance candidate is M2.2 profiling; no further workstream started in this delivery.
- [x] **F1 - Configurable ichnotaxon figures.** [V0.113](../CHANGELOG.md#v0113--2026-11-10). Authorised by the maintainer on
      10 November 2026, ahead of further performance work. Share abundance/occurrence presentation between the
      whole interpreted core, core column and ichnotaxa distribution, with independent settings for figure tabs.
  - Offer stacked, overlaid or separate abundance tracks; bars, curves, filled areas and symmetric curves;
    opacity; symbols and/or names at observed depths/ages; manual-mark-only source; percentage axes and labels.
  - Preserve existing figure defaults and project readers. Presence-only records must not generate abundance.
    Verify exact unchanged input/CSV values, symmetric geometry and gaps, source/visibility filtering, axis
    conversion, independent tabs, saved settings, SVG/PNG export and the required delivery checks.
  - Delivered and verified: exact unchanged measurements/CSV, shared geometry, independent tabs, depth/age,
    saved settings, SVG/PNG and visual inspection. Required checks pass (181 Python tests with six optional/
    permission skips; 142 Node tests; types, version, Ruff, standalone build and full Chrome smoke test).
    The same figure regression passes against the standalone HTML opened directly from disk.
  - Presentation settings are opt-in; reset restores the inherited/default plot. Dense presence names can
    overlap and may need a taller figure or a narrower window. Further performance work remains at M2.2.

  - [x] **R1 - Extract U-Net session controller.** [V0.124](../CHANGELOG.md#v0124--2026-11-11).
        Authorised on 11 November 2026;
        editor: Codex; automated author verification, no independent reviewer assigned.
        Extract loading, model ownership, probability/cache keys and ONNX tensor adaptation into a DOM-free
        module with injected runtime, section enumeration, scale, identifiers and progress. Keep UI wiring,
        engine loading (shared with DINOv2), desktop training and scientific tiling in their existing layers.
        Acceptance: no imports back to app.js, strict types without new baseline diagnostics, exact probability
        arrays and cache semantics, unchanged current/legacy project workflows, served/standalone inference
        wiring and required delivery checks. This is a small extraction with no default/format change;
        broader lifecycle changes and further module extraction remain separate phases.
    - Delivered: `unetmodel.js` has no DOM/app.js dependency and strict contracts. Scientific tiling,
      cache keys, model failure/replacement and existing file/desktop entry points retain their behaviour.
      Remaining JavaScript diagnostics fall from 894 to 887 without extending the baseline.
    - Verified: 223 Python tests (six optional/permission skips), 157 Node tests, strict/all-module types,
      Ruff, version consistency, standalone build, full Chrome smoke (356 traces and identical saved reload),
      and served/standalone U-Net integration with deterministic injected runtime. No real ONNX provider or
      desktop training run is added to this extraction's verification. Storage-fallback fault injection
      is isolated from concurrent main-page OPFS image reads; console failures now include error stacks.
    - Local delivery on master; GitHub handoff requires authorised push. Further model-lifecycle or
      DINOv2 extraction requires a separate phase.
  - [x] **R2 - Decouple shared depth selectors (AUD-14).** [V0.126](../CHANGELOG.md#v0126--2026-11-11).
        Authorised on 11 November 2026;
        editor: Codex; author verification, no independent reviewer assigned. Inspect consumers of `pxPerCm`, `depthAtRow`
        and `rowAtDepth` before choosing the next small extraction. Avoid moving calculation into a
        DOM-dependent state module merely to shorten app.js. Treat composition/class selectors as later
        candidates after their state dependencies are understood.
    - Acceptance: explicit inputs and checked contracts, preserved existing callers/re-exports where needed,
      exact ROI/depth/unit behaviour, no new import cycle, standalone name/order checks and served/offline
      regressions. Do not claim that this alone removes all current interface import cycles.
    - Delivered: pure `sectiondepth.js` imports only core.js and owns ROI depth/row/physical-scale mapping.
      Columns and figures consume it directly; app.js re-exports the same bindings for compatibility.
      The generic U-Net section contract preserves custom consumers and explicitly types the application
      section metadata. No runtime arithmetic, scientific default or project format changes.
    - Verified: exact shared fractional fixtures, endpoints/units/extrapolation and 1,000 generated inverse
      mappings (1e-9 absolute row tolerance on the bounded test domain, not a changed scientific tolerance).
      227 Python tests (six optional/permission skips), 161 Node tests, strict/all-module types, Ruff,
      version consistency, standalone build and full Chrome smoke pass (356 traces, identical saved reload).
      App export identity is checked in the browser; standalone U-Net wiring and all three figure regressions
      pass directly from file. Local delivery on master; GitHub handoff requires authorised push.
      Composition/class selectors and remaining interface cycles are separate pending candidates.

## Completed backlog items

- [x] Desktop installers for Windows, macOS and Linux, and an offline single-file version
- [x] Single version number across the program, the Python package and the installers

- [x] Installable package with API and command line; regression against version 2.1
- [x] Per-ichnotaxon percentages, overlapping traces, configurable index schemes, age model, CSV and Excel export
- [x] Interval thickness in centimetres on the command line (`--bin-cm`, already available in the API)
- [x] Exclusion layer, as in the program
- [x] Batch processing of folders and of multi-section cores (splices, gaps)
- [x] LAS export for well-log software

- [x] Learned segmentation (U-Net): training-data export, training, evaluation on independent cores, inference in the
      program and in Python
- [x] Ichnotaxa classifier on shape and colour descriptors or on pre-trained vision features

- [x] Final test on cores reserved from training and model selection

- [x] Column headers that stay visible while scrolling

## Audit triage of 11 November 2026

The maintainer requested incorporation of the supplied V0.123 technical audit on 11 November 2026;
the planning update is delivered in [V0.125](../CHANGELOG.md#v0125--2026-11-11).
The findings below were checked against V0.124 source and existing tasks. This is source triage, not
an independent security review or a completed reproduction of every reported defect. The audit's
implementation checklist, suggested dependency versions and agent assignments are not execution authority.
Tasks without a subsequent authorisation recorded below remain pending; incorporation alone assigns no
editor or reviewer and does not authorise implementation.

Historical proposed order, now subordinate to the active M8 sequence: address desktop path containment, untrusted presentation values and preservation of trained
models first (M0.4, M0.5, M3.2.3); correct scientific documentation next (M5.2.1–M5.2.2); then validate manifest,
palette and training reproducibility contracts, build safety and trainer dependencies. Type-only corrections,
further modularisation and LAS metadata policy follow as separate small deliveries. Pending audit tasks remain
tracked below and enter the migration when their contracts are touched; this does not authorise a release.

| Audit ID | Disposition after source review | Roadmap task |
|---|---|---|
| AUD-01 | Retraining is staged and complete model/evaluation generations are published atomically in [V0.130](../CHANGELOG.md#v0130--2026-11-11) | M3.2.3 |
| AUD-02 | Prefix-only containment check replaced with directory-boundary and URL validation in [V0.127](../CHANGELOG.md#v0127--2026-11-11) | M0.4 |
| AUD-03 | No-data and presentation colours validated against `#rgb`/`#rrggbb` with attribute escaping in [V0.128](../CHANGELOG.md#v0128--2026-11-11) | M0.5 |
| AUD-04 | Short/full hexadecimal palette inputs and class-specific errors validated in [V0.139](../CHANGELOG.md#v0139--2026-11-12) | M3.3.1 |
| AUD-05 | Fractional bin size still has an integer annotation | M3.3.2 |
| AUD-06 | Existing escaping verified through CSV/literal-text XLSX round trips; missing-value-like identifiers preserved and editing rules documented in [V0.137](../CHANGELOG.md#v0137--2026-11-12) | M3.3.3 |
| AUD-07 | LAS uses ASCII replacement; choose an explicit metadata policy before changing output | M3.3.4 |
| AUD-08 | Training seeds process-global random generators | M3.2.5 |
| AUD-09 | Managed trainer constraints are already pending; do not adopt untested example version caps | M3.2.4 |
| AUD-10 | Standalone import/export stripping has a restricted syntax contract | M5.5 |
| AUD-11 | Missing-tag allegation not confirmed; currently referenced major tags exist | Verification note below; M5.1 release checks |
| AUD-12 | Python exclusion support and application-only drawing/noDataPad differences documented in [V0.131](../CHANGELOG.md#v0131--2026-11-11) | M5.2.1 |
| AUD-13 | Source-code table and experimental-count navigation repaired in [V0.132](../CHANGELOG.md#v0132--2026-11-11) | M5.2.2 |
| AUD-14 | Addressed incrementally by R1/R2; composition dependencies and further strict modules remain candidates | M5.4 and R2 |

AUD-11 verification used `git ls-remote --tags` against the official `actions/*` repositories on
11 November 2026. The workflow references resolve: checkout v7 `3d3c42e`, setup-python v7 `6d4fd22`,
setup-node v7 `949feb2`, upload-artifact v7 `cf430e0`, download-artifact v8 `9000827`.
Tag existence does not prove runner compatibility or successful workflows. Verify the supported CI/build
matrix before release under M5.1; do not downgrade actions solely on the audit's older version examples.
This delivery changes planning and version metadata only. Required Python/Node/type/Ruff/version checks
and the standalone build pass; the unchanged interface/save implementation does not require a new E2E run.
The planning commit remains local on master until an authorised push. No audit fix is marked complete here.

## Planning and delivery notes

Delivery-check summaries recorded with planning and documentation versions V0.138-V0.148.

[V0.146](../CHANGELOG.md#v0146--2026-11-12). Current state: implementation baseline V0.143; M8.1, M8.2.1 and
M8.2.2 delivered; M8.2.3 is the next implementation candidate and awaits authorisation.
[V0.147](../CHANGELOG.md#v0147--2026-11-12) records the maintainer's interface-shell and distribution guidance
(M8 target architecture, M8.2.3 and M9) without changing application behaviour.
[V0.148](../CHANGELOG.md#v0148--2026-11-12) adopts the [branch workflow](../AGENTS.md#5-delivering-a-change)
and the shared local checkout used by all assistants.

Documentation delivery checks: 355 Python tests passed (six existing skips), 232 Node tests, types without
new diagnostics, Ruff, version/whitespace and standalone build. Checks ran serially; the existing M8.2.3
concurrent-run observation remains open. No implementation behaviour or UI/save flow changes in this delivery.

M8.1's inventory and contract are delivered in [V0.141](../CHANGELOG.md#v0141--2026-11-12).
M8.2 is in progress: V0.142 delivers the process/transport foundation; V0.143 adds locked runtime resources,
integrity verification and native/package checks. Clean-machine/platform acceptance remains pending; the
scientific interface still uses its existing calculations.
The [shared assistant handoff](../AGENTS.md), updated in
[V0.144](../CHANGELOG.md#v0144--2026-11-12), lets Claude/Gemini resume this state without earlier chat history.
It does not start M8.2.3 or certify additional platform/performance gates.
The documentation check also recorded a [concurrent-run timing observation](validation/M8.2.3-load-observation-v0.144.json)
for M8.2.3; keep it distinct from the successful V0.143 evidence and reproduce its idle/load conditions.
The same evidence file records the passing serial follow-up; the concurrent-run observation remains open.
Assign editor/reviewer at each implementation handoff. Fixes required to preserve data or satisfy a phase's
acceptance criteria stay within that phase; unrelated refactors wait. Publication and 1.0 remain owner decisions.

Planning delivery checks: 313 Python tests passed (six optional/permission skips), 218 Node tests,
JavaScript types without new diagnostics, Ruff, version consistency, whitespace and standalone build pass.
The interface/save implementation is unchanged, so no new tests or repeated browser E2E are needed.
Local delivery on `master`; GitHub retrieval requires the maintainer's authorised push.

Planning delivery verification: 267 Python tests passed (six optional/permission skips), 218 Node tests,
JavaScript types, Ruff, version consistency, whitespace and standalone build pass. No analysis, interface or
save implementation changes; no new tests or repeated browser E2E are needed. Local delivery on `master`;
GitHub retrieval requires an authorised push. Earlier audit priority is superseded by the active M8 sequence;
M3.2.5 remains a dependency before the training migration.

## Roadmap wording superseded on 12 November 2026

The entries of M8.3 to M8.6 as they stood before the live roadmap was rewritten as task cards. The cards and the
summaries in [roadmap.md](roadmap.md) replace them; the original wording is kept for whoever writes the cards of
M8.4 to M8.6.

- [ ] **M8.3 - First scientific vertical slice: section counts and indices.** Connect one section's
      current mask, ROI, exclusions, overlaps and class assignments to engine interval analysis, then display
      the returned percentages and BI/ii in the existing interface. Reuse the public Python analysis path;
      evaluate the measured NumPy implementation under M3.1.6 without silently changing its default.
  - Acceptance: exact row/count/index/missing-value equality and the established numerical tolerances on
    M0.1/M3.1.3 fixtures, including fractional boundaries and custom schemes. Verify edits, undo/redo,
    cancellation, failed jobs, CSV output and save/reopen through the actual desktop workflow. Measure engine
    startup, transfers, full job latency and total Electron/engine/worker RSS, not only the counting kernel.
    Keep this experiment default-off until its predeclared gates pass; retain explicit developer rollback.
  - Read first: the contract's representation gaps, no-data/manual/age processing and custom-tier
    precedence differences between existing public interfaces. Preserve supported semantics and test them
    explicitly; do not substitute a library default or delete the reference implementation.
- [ ] **M8.4 - Bounded engine data and image services.** Implement M2.3.1–M2.3.5 through engine-owned
      native data, chunked operations and a bounded tile/cache interface. The renderer receives visible tiles,
      editing updates and result summaries, rather than a second resident copy of every original image.
  - Acceptance: the multi-gigabyte contract covers the complete Electron/engine process tree, disk usage,
    buffer ownership and memory release after project close. Preserve native pixels, editing coordinates,
    masks/history and atomic save/backup recovery. Raising heap or image-load limits alone does not pass.
    Apply bounded CPU concurrency and leave agreed RAM/CPU headroom for the interface and operating system.
- [ ] **M8.5 - Migrate the remaining scientific methods.** Deliver one workflow at a time from M8.1's
      matrix: depth/age and record transformations; image processing and object features; classifiers and
      spatial interpolation; model inference/training integration. Reuse existing Python methods where
      equivalent and implement missing methods once in the engine. Address M3.2.5 before changing training.
  - Acceptance: every slice has independent reference fixtures, explicit provenance and unchanged public
    contracts. Counts/masks/labels are exact where required; other numerical tolerances and decoder differences
    are declared before comparison. Replacing a method with a library's different defaults is not an equivalent
    migration. Match current figure/export behaviour while rendering engine results; test failure, cancellation,
    invalidation and reload. Transitional comparisons use snapshots/reference outputs and are not two promoted engines.
- [ ] **M8.6 - Promote desktop and retire duplicate computation.** After all required slices pass,
      make the local engine authoritative, remove migrated JavaScript calculations from the supported desktop
      runtime, and replace their regression role with versioned reference fixtures and Git provenance.
  - Acceptance: one production implementation per scientific method, identical API/CLI/desktop results,
    complete desktop and interrupted-save regressions, clean-machine/offline packaging and documented runtime
    identity. Retain the desktop origin, storage keys, compatibility alias and old project/package readers.
    Record the last supported HTML delivery and a tested export/import path for its stored projects before
    freezing it; keep that artifact retrievable. Update contributor/user/technical documentation and CI to
    the actual cutover in the same delivery. Remove temporary flags only after acceptance; engine errors must
    remain visible rather than silently choosing another scientific implementation.

## Status log until 21 November 2026

The status block of [roadmap.md](roadmap.md#status-and-handoff) as it stood on 21 November 2026, moved verbatim when the block
was cut to the facts a new session needs (AGENTS.md §1 step 8). Its relative links point into `docs/`, like this file.

Updated 21 November 2026.

- **Third council audit of 21 November 2026 (runtime frontend + backend audit; design session, docs only, commit on `work/2026-11-13`):**
  four expert perspectives (frontend state/lifecycle/memory, frontend UI/security/performance, Electron shell/IPC security, Python engine/tile store)
  audited the live code across `app/js/`, `desktop/` and `src/sedcoretool/` (static code audit, no code changed and no test suite re-run).
  All findings below are code-verified and not covered by earlier cards:
  1. **P0 — Security bypass of M8.4.34 store protection (`desktop/tile-ipc.js:263, 411, 563`):** `reopen()` and `maskBegin()` add any `project`
     to `opened` unconditionally without verifying `known` or the project's existence, allowing an injected script to call
     `tiles.reopen(victim, ...)` followed by `tiles.deleteProjectStore(victim)` or `tiles.maskRetain(victim, [])` with zero main-process
     confirmation; other project-scoped tile-IPC handlers (`maskImport`, `maskExport`, `derivedPut`/`Get`, `source*`, `locate`, `copySource`)
     do not check `opened`. In addition, `trainer:*` IPC (`desktop/main.js:277`) omits `senderFrame === mainFrame`, `desktop/trainer.js:133-141`
     passes CLI options without allowlist/type checks and writes `opt.zip` uncapped, `trainer.js:34-64` runs `spawnSync` up to 120 s (freezing the
     Electron main process), and `cancel()` (`trainer.js:156`) does not kill the process tree. **Card: `M8.4.38`.**
  2. **P0 — Frontend XSS / attribute-breakout surfaces in `innerHTML` (125 sites in `app/js/`):** unescaped imported/user fields in HTML strings:
     `e.thumb` in `<img src="${e.thumb}">` (`app.js:4321, 4337`), imported IDs/units/settings (`app.js:1437, 1441, 2279-2281, 2346, 2354, 2579,
     3003, 3386, 3422, 3976, 4269, 4289, 4335`), `datatab.js:53, 55, 62, 130, 176, 195, 342, 346`, and `multiproxy.js:308, 363, 378, 382-383,
     455, 1611` (`L.name` unescaped in `cl.dragHere`). **Card: `Q9`.**
  3. **P1 — Frontend lifecycle, tiled-viewer stale closure, multi-core save/backup bugs & memory leaks:** `tileSchedulers` (`tiledview.js:32-61`)
     closes over the first `tiled` object (`sec()?.tiled === tiled`), so reopened sections never re-render loaded high-res tiles until manual
     pan/zoom; `resetState()` (`app.js:3222-3237`) leaves `_maskSync`, `_statsRunner`, `_counts.runner`, queued `engineAnalysis` jobs
     (`engineanalysis.js:181`), `editWindow` (up to 120 MiB + pinned `MaskTiles`, `tiledtools.js:21`), `tileCache`, `tileSchedulers`, `lastSec`
     (`storage.js:53`), `lastImported` (`columns.js:591`) and `lmBgCache` (`figures.js:637`, unbounded Esri data URLs) alive across project
     switches; `saveOnce` (`app.js:3285`) and `backupNow` (`app.js:3690`) check `S.sections.length` (active core only) instead of all cores,
     leaving `_savedRecord` stale for `retainStore` or skipping live backup when the active core is empty; `TiledStatsRunner.rgba`
     (`tiledit.js:308`) retains up to 48 MiB per tiled section indefinitely; `secDel` (`app.js:2683`) misses `markDirty()` and runner teardown;
     `ensurePixels` (`app.js:150`) crashes on a missing-source tiled section (`levels === null`); `presetBest`/`presetAll` (`app.js:2564, 2614`)
     do not guard tiled sections; `busy()` (`app.js:4570`) is not re-entrant; `statsWait` (`tiledtools.js:180-195`) leaks across section switches;
     `readReopenCache` (`tiledproject.js:125-128`) misses objects absent from `cache.stats`. **Card: `M8.4.39`.**
  4. **P1 — Python engine 65,536-request session ceiling & blocking store I/O (`src/sedcoretool/engine/server.py`):** `len(self.seen) >= 65_536`
     (`server.py:149-151`) kills long tiled sessions (`ProtocolError`); heavy synchronous store ops (`mask.retain`, `mask.import`, `mask.export`,
     `mask.copy`, `mask.put`, `mask.derived.put`/`.get`, `server.py:313-450`) block the single coordinator loop (stalling `tile.read`, progress
     heartbeats and `job.cancel`); `masks.py:290, 654` lacks Windows `os.replace` retry and `winerror in (39, 112)` disk-full handling;
     `server.py:360, 427` matches open stagings by `MaskStore` object identity (breaks after 64-store LRU eviction); `TileReader` (`tiles.py:34-35`)
     is unbounded and not invalidated on worker eviction (`pyramid.py:84`); `uploadTable` (`tile-ipc.js:150-162`) leaks staged handles on
     chunk/commit error; `source.py:93` misinterprets 4-band CMYK TIFFs as RGBA. **Card: `M8.4.40`.**
  5. **P2 — Frontend Data-tab precision, virtualized table cap, engine-refresh/CSV races & SVG PNG memory:** `datatab.js:176, 266, 325` records
     cell-edit `orig` from 6-decimal `fmt(v, 6)` instead of the stored float (corrupting Restore for small values like `1.23e-8`);
     `datatab.js:222-224` still caps the virtualized table at `dataLimit = 400` and rebuilds `tableModel()` on every scroll frame;
     `datatab.js:346, 365` breaks manual column deletion when the name contains `|`; `engineRefresh` (`app.js:1257`) calls `setMode(mode)`
     mid-edit in Data/Figures/Multiproxy; `logCSVBtn` (`columns.js:555`) exports synchronously while engine analysis is pending; `recList`
     delete (`columns.js:618`) can call `splice(-1, 1)`; `autoPick(..., 'typical')` (`figures.js:124`) crashes on null `o.feat`; PNG exports
     (`figures.js:724, 965`, `datatab.js:108`, `multiproxy.js:1300`) use `encodeURIComponent` data URIs instead of Blob URLs; missing
     `pointercancel` cleanup (`panels.js:44, 75`, `app.js:1662, 1812, 1820, 4521`). **Card: `Q10`.** Remaining 4,664-line `app.js` split tracked
     as **`A4`** (post-M8.4.19).
  - **Decisions U and V (approved by the maintainer on 21 Nov 2026, as recommended):**
    - **U (order before M8.4.19):** run **`M8.4.38`** and **`Q9`** (P0 security), then **`M8.4.39`**, **`M8.4.40`** and **`M8.4.37`** before closing
      the part C milestone gate (`M8.4.19`), and run **`Q10`** before the next public release (`V0.153`).
    - **W (store clean-up and deletion in M8.4.38, approved 21 Nov 2026):** the right to remove stored masks follows what the program session
      wrote; versions stored before the session stay until the project is deleted (details under the card).
  - **Progress of 21 Nov 2026 (afternoon):** `tests` and *Desktop builds* passed on Windows, macOS and Linux on `0f3d25a`, which contains
    M8.4.36 (`864cad1`): M8.4.36 is green on three systems. **M8.4.38 is done at the development gate** (Windows; checks under the card; the
    GitHub run of its commit is pending). **Next card: `Q9`** (escape the `innerHTML` sites; P0).
    - **V (engine request-limit semantics in M8.4.40):** replace the hard 65,536-request session limit (`server.py:149`) with a bounded sliding
      window (last 65,536 request IDs via `OrderedDict`) so sessions can run indefinitely while duplicate recent IDs are still rejected without
      breaking string/UUID request IDs.

- **Released version:** V0.152 (20 November 2026, `master` `8ee9776`, tag `V0.152`, GitHub Release published with 8 files; see below). Earlier: V0.151 (16 November 2026), integrated into `master` on the maintainer's instruction ("haz push de todo y luego publica en
  master"), which overrides the decision of 14 November 2026 that nothing goes to `master` until M8.4 is finished (part A is done; parts C and B are not). It is `master` commit `e59fff4` (pushed; no tag), whose tree is identical to commit `7aca549` of the work branch, on which `tests` and *Desktop builds* passed on Windows, macOS and Linux. It contains the
  visible-row Data table as the default (the release gate of every platform is still required before it is announced to users). V0.150 (14 November 2026) was integrated on the instruction "haz commit y push de todo a
  master con una nueva version 0.150". **No tag and no GitHub Release exist for V0.149, V0.150 or V0.151**: a tag publishes a Release and is the
  owner's decision. The *Desktop builds* workflow is started by hand for the macOS and Linux builds (see the release checklist).
- **Active work branch:** `work/2026-11-13` (pushed). `master` (V0.151, `e59fff4`) is contained in it since the merge of 16 November 2026 (commit `cdc401a`, no file changes),
  so the two histories no longer diverge.
- **Way of working (set on 16 November 2026 at the maintainer's request, rules in [AGENTS.md §5](../AGENTS.md#5-delivering-a-change)):** all work happens on the work branch, which is
  pushed after every finished card (copy outside this computer, and the GitHub checks on three systems); `master` only receives versions, through
  `python tools/integrate_version.py` ([DEVELOPMENT §8](DEVELOPMENT.md#8-versions-ci-and-releases)), which refuses to run if `master` holds anything that the work branch lacks;
  every session starts by checking `git log HEAD..origin/master` and, if it lists something, merging `master` into the work branch.
- **Open pull requests on GitHub (16 November 2026), both from Dependabot against `master`, neither merged:** #25 Electron 45.2.2 -> 45.3.2 (`desktop/package.json` and lock file) and
  #24 `softprops/action-gh-release` 2 -> 3 (release workflow only). They wait for the maintainer (AGENTS §5.1); the natural moment is the preparation of V0.152. If one is merged on
  GitHub by mistake nothing is lost: the next session merges `master` into the work branch.
- **Checks:** see the last line of this block; it is rewritten at the end of every session.
- **Full checks of 16 November 2026 on the V0.151 state (maintainer's Windows computer, run one after another):** `pytest -q` 724 passed / 9 skipped (Python 3.12); `npm test` 361 passed
  (its first run inside the check script returned exit 1 with no output that could be read; four reruns, 361 passed each, so it is recorded as an unexplained, not reproduced incident);
  `npm run typecheck` (no new diagnostics); `sync_version.py --check`; `ruff check src tests tools` (ruff under Python 3.14); runtime rebuilt; `tests/e2e/desktop.mjs`; `tests/e2e/smoke.mjs`.
  The GitHub run on the version commit is recorded below once it has finished.
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
- **Rule D11 settled (16 November 2026, card M8.4.21):** after vectorising the interval kernel the outcome is still D (119.5 ms against 100); accepted for the
  interactive interval table of tiled sections, which stays in JavaScript; the maintainer can overrule it.
- **Progress of 16 November 2026:** M8.4.7, the M8.4.8 measurements, M8.4.12, M8.4.21, M8.4.13 (fixtures
  in `C:\sedcore-large-fixtures`, outside the repository, and the Windows baseline) and M2.1.4 are done. The three-system gate of M8.4.8 passed on
  `f4ec92a`, and `tests` and *Desktop builds* also succeeded on `01d6de7` (includes M8.4.21) on Windows, macOS and Linux (both pushed on the maintainer's request).
  M2.1.4 and the promotion of the visible-row table to the default are in the branch (checks of that change on Windows: `tests/e2e/smoke.mjs` all passed, which includes both table tests; `node --test` 361 passed; typecheck passed; not run: the desktop end-to-end test, macOS, Linux). M2.1.5 (the `coreConvert` defect) is written and Ready. Session checks: `pytest` 724 passed / 9 skipped on M8.4.21; the other checks of DEVELOPMENT §3 were not repeated because only Python, tools and documents changed since `01d6de7`.
- **Findings of M2.1.4 (Windows, [report](benchmarks/M2.1.4.md)) for the design session:** the native Data table fails the 33 ms target while scrolling (about 13 frames per second) and
  the visible-rows rendering passes; both were measured at 10,400 rows (ten clicks of "Show more"), not at 100,000; a scatter of 50,000 points redraws in 156 ms (329 ms at
  100,000); the **first opening of the multiproxy log takes 195 s at 100,000 rows** (7.7 s at 20,000) because `coreConvert` (`app/js/geo.js:103`) is rebuilt for every sample, a defect of
  complexity that is independent of the tile store.
- **Next version (decision of 16 November 2026):** V0.152 does **not** go to `master` until M8.4 is finished (parts A, C and B). The work branch keeps accumulating changes under `## Unreleased`.
- **Next step: Q5** (long series: `extent()` without spreads, decimation on screen, the data record saved in parts; **model: most capable tier,
  effort medium**), then M8.4.29 and the rest of order O; M8.4.30 is done (its size target replaced by the ceiling of decision R, approved 20 Nov 2026); decisions S, T and the four design choices of M8.4.34 were approved the same day; M8.4.33 is done; M8.4.32 is done
  (green on three systems, commit `4a20dfd`); M8.4.29 and M8.4.34 are done at the development gate on 20 Nov 2026 (the GitHub run of their commits is pending); **GitHub on macOS and Linux (read on 20 Nov 2026; fixed by card M8.4.35, green on three systems on `fdf3d4c`): *Desktop builds* failed on `3b0f7dd` (P1), `00ca21b` (M8.4.29) and `12ff7cc` (M8.4.34), always in `tiled-sections.mjs` (`tests` passed on all three, and Windows and Linux passed): (i) twice a 30 s timeout waiting for the mask round to be on its way before the engine is killed (the wait polls with `requestAnimationFrame`, which a window macOS does not show may never run: diagnosis not confirmed); (ii) once `reopen()` found no tiled section after a reload (`grey: null`), the same symptom as the unexplained local failure of M8.4.34 (1 run in 4): the reason the load failed is not recorded by the test. Both block the milestone gate of part C (M8.4.19); a fix needs a card (proposed to the maintainer).** M8.4.18c is done at the development gate on 20 Nov 2026 (the masks of tiled sections and the project's copies of their sources in the folder backup and back; a day of the history can be opened; GitHub green on three systems on `cfd65e4`; M8.4.18d is done (packages carry tiled sections, ZIP64; GitHub green on three systems on `2f6331b`; a synthetic package of 4.97 GB restored exactly through the desktop program on 21 Nov 2026); opening that synthetic section failed: card M8.4.36 fixed it on 21 Nov 2026 (development gate; GitHub pending); card M8.4.37 (a memory bound for the objects' statistics) proposed; then M8.4.19, the milestone gate of part C; Q5 parts 1-2 are done (part 3 changes the saved format: approved on 20 Nov 2026 to wait for a save benchmark of long series, and done only if it shows a slow save; the thinning of core-column curves is decided with P2, approved the same day); P1 is done on 20 Nov 2026 (`figsize.js`, `pngmeta.js`, PNG at 300/600 dpi; `npm test` 507, typecheck and standalone build pass; the 600 dpi check added to `tests/e2e/figure-composition.mjs` (run by `smoke.mjs`) **has not been run**: the permission system refused to start the local server for it, so it runs in the next session or on the maintainer's computer); Q3 is done (units of records, sections and joined projects; development gate); Q2 is done (readers and import report; development gate), then the order O approved on 19 November 2026 (second
  council audit, below). **V0.152** (decision J) was prepared on 20 Nov 2026 at the maintainer's request ("Publica la 0.152 y haz un release"):
  full checks passed on the version commit (Windows: pytest 885 passed / 9 skipped, npm 478, typecheck, sync_version, ruff, standalone build,
  runtime rebuilt, desktop.mjs off and on, tiled-sections.mjs). **Published on 20 Nov 2026:** `master` `8ee9776`, tag `V0.152`, GitHub Release
  with 8 files (Desktop builds run 44644183590: Windows, macOS and Linux built, release job passed). `tools/release.sh` failed to find
  `DELIVERY` (now an export); its steps were run by hand with Python 3.12 and the script is fixed on the work branch. Q4 is done (CSV with 15
  significant digits; the core-column CSV with interval means, a gap limit, reversals marked; development gate), and the retries of card A2
  were brought forward. Q1 is done (deleting an ichnotaxon reaches every core, asks first, can be restored; orphaned labels repaired on opening;
  development gate). Full checks of Q4 and A2 (20 Nov 2026, Windows): `py -3.12 -m pytest -q` 885 passed / 9 skipped; `npm test` 478
  passed; typecheck; `sync_version.py --check`; `ruff check`; standalone build; `desktop.mjs` with the engine off and on; `tiled-sections.mjs`
  passed twice. M8.4.31 is done (a store clean-up keeps every version committed since the one the page names; saves run one at a time; development gate). M8.4.28 is done (an object operation right after reopening waits only for its own tiles: 387-397 ms instead of not finishing; development gate). M8.4.27 is done (the store folder is deleted and copied with its project; a missing stored version locks its section; development gate). M8.4.18b is done (a moved image is located by its SHA-256 and can be copied into the project; development gate). M8.4.18a is done (tiled sections are saved and reopen exactly; development gate). Its three findings have cards, in this order after M8.4.18b: M8.4.27 (the store folder follows its project: delete, copy under a new identifier, a missing stored version; Opus, high), M8.4.28 (object operations right after reopening; Opus, medium), M8.4.29 (reopening from a cache instead of every tile; Opus, high; decision G waits for the maintainer); then M8.4.18c, M8.4.18d, M8.4.19. Card M8.4.17 is done (decision F: the page counts tiled sections; development gate; see its *As built* and two findings to decide: no cancel button for a long recount, and the engine's `INVALID_BUFFER` on a whole section after the M8.4.16 edit script). The four cards added on 18 November 2026 to fix the warnings of M8.4.22 are done: M8.4.23, M8.4.24, M8.4.25 and M8.4.26 (development gate; `tests` and *Desktop builds* passed on each pushed commit). Card M8.4.16 is done (milestone gate passed on `4654ce0`: `tests` and *Desktop builds* on Windows, macOS and Linux).
  [ARCHITECTURE §3.4](ARCHITECTURE.md#34-tile-store-for-large-images-planned-part-c-of-m84), cards M8.4.14-M8.4.19 detailed below; any model may implement them.
  Also open: card H5 (the `e2e` job must pass ten consecutive pushes) and M8.4.20 (engine speed, Ready).
- **Answered by the maintainer on 16 November 2026 (design of part C):** Q1 masks of tiled sections at full resolution: yes; Q2 pyramid cache budget: 50 GiB
  ("lo que tú recomiendes"); Q3 JPEG or PNG above 1 GiB decoded: refused with a message that suggests TIFF. And: **add libraries when they make the program
  faster and more stable** ("no tengas miedo en añadir librerías si eso acelera el programa y da estabilidad"); each one is still recorded with its capability,
  the smallest alternative and its cost (AGENTS §3, item 9). First use: libvips for reading images (decision 4).
- **Reminder for whoever talks to the maintainer:** the maintainer accepted the two acceptance levels on
  13 November 2026 and asked to be **reminded to run the release-gate tests** (the release checklist below:
  macOS and Linux, clean Windows machine, cold-cache first launch, saturated CPUs, package sizes, and the
  numerical/timing/memory/recovery gates). Remind him when a milestone of M8 finishes and before any flag is
  switched on by default or a version with the engine is announced.
- **Audit of 19 November 2026 (design session, at the maintainer's request; only this file and AGENTS.md edited).** Findings and what follows:
  1. **The rule "`app.js` only shrinks" was broken by part C.** `app.js` grew from 4,344 lines (13 Nov 2026) to 5,335 (worktree of M8.4.28):
     +991 lines, about 40 functions of the tiled-section workflow (strokes, wand/lasso/scissors, object operations, statistics runner wiring,
     mask sends and reads, reopening, store copy and delete), 151 lines longer than 200 characters. The pure modules (`tiledit.js`,
     `tiledmasks.js`, `tiledcounts.js`, `tiledsync.js`, `tiledundo.js`) are sound and DOM-free; what is in `app.js` is controller code that no
     card extracted. Cards M8.4.27 and M8.4.28 of this session added to it as well. Answer: card **M8.4.30** (below, before M8.4.29, which would
     add a cache path to `loadTiledSection`) and an enforcement rule in AGENTS §4.
  2. **Scientific code in JavaScript for tiled sections.** Two exceptions exist and are decided: the interval table (rule D11 = D) and the
     per-tile object statistics (`tileStats` reuses today's `objectStats`, card M8.4.16). They conflict with the acceptance of M8.6 ("one
     implementation per method"): decision **H** below.
  3. **Two editing paths.** Every edit, analysis and save exists twice (whole sections in page memory, tiled sections in the store), and part B
     (M8.4.9) would add a third way to hold small sections. Proposal for the design review of M8.4.19, decision **I** below.
  4. **Unreleased user fixes.** The work branch holds 116 commits since V0.151 (16 Nov 2026); among them fixes users need without any flag:
     H6 (blank window at full resolution), H7 (16-bit images above about 28 Mpixel crash), M2.1.5 (multiproxy opening). Decision **J** below.
  5. **This file has grown to about 2,000 lines;** the status block keeps every check of every step since 16 November. Card **H8** (below).
  6. **H5 can close:** the `web-app` job (which runs `tests/e2e/smoke.mjs`) passed on the last 27 pushes of the work branch; the one failed
     run in the last 30 (`b845727`) is a macOS Python job cancelled for want of a runner. Marked done below.
  7. **What is good and stays:** the layer rules hold outside `app.js` (no DOM in pure modules); contracts and file formats are documented
     before the code; failures are visible (no silent fallback); saves are atomic; scientific checks use exact equality or tolerances stated
     first; CI is green on Windows, macOS and Linux. The typecheck baseline still has 870 old diagnostics, almost all in `app.js` (M8.4.30
     reduces them).
  8. **Can we move to the next phases?** No. M8.5 needs the milestone gates of part C (M8.4.19) and part B (M8.4.11). Order recommended:
     M8.4.28 (finishing) → **M8.4.30** → M8.4.29 (needs decision G) → M8.4.18c → M8.4.18d → M8.4.19 (with decision I) → M8.4.20 → part B as
     decided by I → M8.5. Decisions G, H, I and J were approved the same day (below); J publishes V0.152 after M8.4.28.
- **Decision R, approved by the maintainer on 20 Nov 2026 ("apruebo R"), as recommended (card M8.4.30):** the card's target of fewer than 4,344 lines for `app.js` cannot be
  met by moving tiled-section code alone (it is out: 5,390 → 4,666). *Recommended:* accept 4,666 as the ceiling enforced by
  `tests/app/architecture.test.mjs`, lowered by each later card that moves a workflow, rather than a separate move of unrelated code now.
  The ceiling is 4,666 (`APP_JS_CEILING`); card M8.4.30's size target is closed by this decision.
- **Second council audit of 19 November 2026** (the maintainer's prompt: four independent experts, a senior sedimentologist and
  palaeoclimatologist, a scientific-software architect, a UX/UI specialist for complex technical software and a data-integrity and QA engineer,
  read the repository without running anything, then critiqued the others anonymised and argued the trade-offs; the design session checked
  the decisive claims in the code). **Confirmed in the code:** deleting an ichnotaxon (`classList` handler in `app.js`) acts only on the open
  core's sections, with no confirmation and no undo, and leaves the traces of every other core with a class that no longer exists (P0); CSV
  exports round to six decimals (`core.js::toCSV`, `toFixed(6)`: a mass susceptibility of 1e-8 is written as 0); the Excel reader reads only
  the first sheet through `sheet_to_csv` without `rawNumbers` (`multiproxy.js`); missing-value codes (-999, -999.25, -9999) are read as values
  (`log.js::num`); `Math.min(...array)` over whole series in about 30 places (a call-stack limit with long scanner records); changing a
  section's unit relabels its depths without converting them. **Reported and not yet checked here:** joined projects keep the first core's
  units without converting (`buildMultiProject`, `mergeImp`); the core-column CSV interpolates records across gaps of any length and drops
  intervals outside the age model silently (`log.js`); splice overlaps differ between Python (`overlap`) and JavaScript (shared-definition rule);
  rows dropped without a count in several readers; a corrupt `sources.json` replaced by an empty one; `tableview.js` listed as pure but using
  the DOM; `presetAll`, `resAll`, rotation and deleting a data column without confirmation or undo; figures sized only in pixels, no PDF, no
  embedded fonts, provenance without the multiproxy settings. **Debate (trade-offs agreed):** (1) rigour against fluency at import: one import
  panel with a preview and counts that interrupts only for a real ambiguity (decimal separator, unknown units, missing-value codes, several
  sheets) and otherwise leaves a data report with "Undo import"; (2) fidelity against speed in plots: decimate on screen (minimum and maximum
  per pixel, which keeps peaks) and export at full resolution, saying so in the provenance; (3) confirmations against an expert's speed: undo
  by domain and a recoverable deletion first, a dialog only for what cannot be undone or reaches other cores; defaults that change results
  stay until the maintainer decides, and the breakdown of what a number contains is shown meanwhile.
  - *Cards written or changed:* new Q1 (deleting an ichnotaxon, P0), Q2 (import panel and readers), Q3 (units), Q4 (exports keep the data),
    Q5 (long series), Q6 (property tests and a corpus of real files), Q7 (splice overlaps), F1 (figures for publication), F2 (provenance of
    every export), F3 (stratigraphic conventions, later), A1 (engine methods of core or project scope, before M8.5), U6 (detection over several
    cores); changed: M8.4.30 (a JavaScript architecture test), S1 (the breakdown does not wait for decision K), S5, U1 (one long-task
    component), U2 (the bulk actions it found), U3 (scope labels, collapsed steps, shortcut sheet), M8.5 (prerequisite A1, scikit-learn rule).
  - *Order recommended (decision O):* the data-integrity cards affect every user of the current version, flags or not, so they go before the
    rest of part C: **M8.4.31 and Q1 (P0)** → Q4 (with decision N) → Q2 → Q3 → M8.4.32 → M8.4.33 → M8.4.30 → Q5 → M8.4.29 → M8.4.34 →
    M8.4.18c → M8.4.18d → M8.4.19; F1, F2, U1-U3, U6 after M8.4.30; A1 before M8.5; Q6 alongside Q2-Q4 (their tests); Q7 and F3 later.
  - **Approved by the maintainer on 19 November 2026 ("apruebo J, K, L, M, N, O y P"), as recommended:** J (V0.152; the design session
    proposes it after Q1 and Q4, so that those fixes reach users), K, L, M, N, O and P. The text of each proposal stays below for reference.
  - **Decisions (approved, see above):** **M** (card Q2): values below a detection limit (`<0.01`, `bdl`) stay empty, become half the
    limit or the limit (*recommended:* empty by default with a visible count, the other two per column); **N** (card Q4): CSV numbers written
    with 15 significant digits instead of six decimals, a change of export format (*recommended*); **O**: the order above (*recommended*);
    **P** (card Q4): the core-column CSV gets the gap limit of the cursor and an interval-mean mode (*recommended:* both, the mean as the
    default for new exports, recorded in the provenance).
- **Council audit of 19 November 2026** (at the maintainer's request: three independent reviewers, a software engineer, a sedimentologist
  with data-science training and an interface designer, read the repository without running anything, then critiqued each other's reports
  anonymised; the design session checked the disputed points in the code). It replaces the single-view "deep audit" written earlier the same
  day. Agreed by all three: the arithmetic and the architecture on paper are sound; the risks are (1) **user data**: a store clean-up can delete
  a version committed a moment earlier, saves can overlap, backups and packages leave tiled sections out without a word; (2) **evidence**:
  nothing is validated on real cores and the tiled path is not tested on GitHub; (3) **defaults that bias results**: unreviewed candidates
  count as bioturbation, detection sizes are in pixels so results depend on the resolution and on the storage path; (4) **feedback**: progress
  and errors are invisible outside one mode and destructive actions are confirmed in four inconsistent ways. Checked by the design session:
  the retain race (`retainStore` in `app.js` and `MaskStore.retain` delete every manifest not named, protecting only open staged versions),
  the overlapping saves (`saveToDB`: a second waiter starts a save while the first one's is running), the silent omission in
  `projectForExport` (no message), and the missing highlight of the start-screen and model-dialog tabs (`.htabs .btn` set `aria-selected`,
  styled only through `aria-pressed`). Not confirmed: the general tab regression (`.tabs` tabs are styled). Measured the same day: the first
  delete after reopening a 3 % `rgb8g` section had not finished after 18 min (M8.4.28, being fixed).
  - *Cards written from it* (order below): M8.4.31 (store and saves keep every committed version), M8.4.32 (the tiled tests run on GitHub),
    M8.4.33 (backups and packages say what they leave out), M8.4.34 (desktop hardening); in a new section *Council cards*: S1-S6 (science),
    U1-U5 (interface), D2 (documents). Modified: M8.5 (acceptance of slices c and d), M6.5 in roadmap-future.md, M5.2 (dated protocol, S6).
  - *Order recommended:* M8.4.28 → **M8.4.31** → **M8.4.32** → **M8.4.33** → M8.4.30 → M8.4.29 → **M8.4.34** → M8.4.18c → M8.4.18d → M8.4.19;
    S6 (validation protocol) can start at once in parallel, since it is mostly the maintainer's data work; S1 and S2 need decisions K and L
    and then go before M8.4.19, because the tiled path changes the resolution of analyses; U1-U3 after M8.4.30 (they touch the messages and
    dialogs that card moves); U4, U5 and D2 at any time on the fast tier.
  - **Decisions K and L (approved by the maintainer on 19 November 2026):** **K** (card S1): count only reviewed traces by default, with the unreviewed share shown next to
    every result (*recommended*; it changes the default results of new projects, existing projects keep their stored setting); **L** (card S2):
    detection sizes in millimetres (*recommended*; a project keeps its pixel values until the user converts it).
- **Decisions of the audit of 19 November 2026: G, H, I and J approved by the maintainer the same day** ("apruebo G, H, I y J"), as recommended:
  - **G** (card M8.4.29): the reopening cache in the engine's store. *Recommended: approve as proposed;* without it a reopened 10 % section needs
    133 s before every object is current.
  - **H** (M8.6 against D11 and the per-tile statistics): *recommended:* M8.6 accepts, for tiled sections only, the page's interval table and
    per-tile object statistics as the one interactive implementation, with the Python method as the reference checked by parity tests in CI;
    slice (b) of M8.5 moves the object features to Python for every other use. Otherwise M8.6 cannot pass as written.
  - **I** (at the design review of M8.4.19): *recommended:* study whether every new section can use the tile store (a small image is a store of
    few tiles), so that part B's M8.4.9 is replaced and the whole-section editing path is only kept to open old projects; decided with a
    measurement of small-section editing through the tiled path against the targets of contract §7.
  - **J** (version): *recommended:* publish V0.152 now from the work branch with every flag off, so that the H6, H7 and M2.1.5 fixes reach
    users, instead of waiting for the end of M8.4 (decision of 16 November 2026). Needs the full checks and the GitHub checks on the version
    commit, as always.
- **Decisions waiting for the maintainer:** (1) the flags in the table below that need a promote/remove decision. **Decided on 16 November 2026: the visible-row table
  (M2.1.3) is the default** (17 times faster at 100,000 rows; M2.1.4: scrolling passes the 33 ms target where the native table fails); it is in the branch, not in a published
  version, and **the release gate (every platform) is still required before a version with it is published**;
  (2) any change to the interactive targets of contract §7, before M8.4.12 measures. Decided on 15 November 2026: option A and what follows
  from it (item above), which also answers the timing question of 14 November. Decided on 13 November 2026: acceptance levels (accepted),
  scope of 1.0 (below), publication of V0.149. Decided on 14 November 2026: a milestone gate on macOS and Linux closes every milestone; the
  five decisions of M8.4 (answers recorded there, among them **multi-gigabyte images are required for 1.0**).
- **Checks of M8.4.22 (18 November 2026, maintainer's Windows computer):** `pytest -q` 861 passed / 9 skipped; `npm test` 432 passed; `npm run typecheck`; `ruff check src tests tools`; `sync_version.py --check`; standalone build; runtime rebuilt (`npm run prepare-runtime -- --offline`: needed after editing the engine's Python, or the engine stays `unavailable`); `tests/e2e/desktop.mjs` with the engine off and on; `tests/e2e/tiled-sections.mjs` passed twice. Its first run after the rebuild failed once in the M8.4.15 viewer probe ("drawn pixel = source pixel" at screen 230, 570: drawn 106, 79, 35 against 14, 14, 14); not reproduced in the two following runs, recorded as an incident. GitHub on `4654ce0` (M8.4.16 step 8): `tests` and *Desktop builds* passed on Windows, macOS and Linux, the milestone gate of card M8.4.16.
- **Full checks of M8.4.16 closing (18 November 2026, maintainer's Windows computer):** `pytest -q` 848 passed / 9 skipped (Python 3.12, Anaconda); `npm test` 431 passed; `npm run typecheck`; `sync_version.py --check`; `ruff check src tests tools`; standalone build; `tests/e2e/desktop.mjs` with the engine off and on; `tests/e2e/tiled-sections.mjs` including the exact-equality block. Not run: `smoke.mjs`, the viewer measurement after step 6. GitHub: `d3ec007` `tests` passed; *Desktop builds* of `bdd1b14` and `d51a53e` were cancelled by the next push (not failures), so the milestone gate waits for a run that finishes on the closing commit.
- **Checks of M8.4.16 step 7 (18 November 2026, maintainer's Windows computer):** `node tools/measure_mask_tables.mjs` run once (synthetic records, no image); no code of the program changed. GitHub on `bdd1b14` (step 6): `tests` passed; *Desktop builds* see the next line when finished.
- **Checks of M8.4.16 step 6 (18 November 2026, maintainer's Windows computer):** `npm test` 431 passed (4 new in `tests/app/tiledops.test.mjs`);
  `npm run typecheck`; standalone build; `tests/e2e/tiled-sections.mjs` (lasso, scissors, merge, class-change merge, delete with undo and redo,
  the wand and the wait while statistics are computed, all with exact areas against the tiles); `tests/e2e/desktop.mjs` with the engine off and
  on. Not run: pytest and ruff (no Python changed), `smoke.mjs`, the viewer measurement (the stroke path did not change). GitHub on `d407763`
  (step 5): `tests` passed; *Desktop builds* failed on macOS while packaging (a download of a Python wheel for the bundled runtime timed out;
  the desktop end-to-end tests on macOS had passed) and passed on all three systems when the failed job was run again.
- **Checks of M8.4.16 step 5 (18 November 2026, maintainer's Windows computer):** `npm test` 427 passed (5 new in `tests/app/tiledundo.test.mjs`);
  `npm run typecheck`; standalone build; `tests/e2e/tiled-sections.mjs` (the stroke undone while the engine is down and redone after the restart:
  page and store equal to the state before the stroke, then to the stroke; objects and statistics restored); `tests/e2e/desktop.mjs` with the
  engine off and on; `tools/measure_tiled_viewer.mjs` on `rgb8g`: every target met, strokes p95 22.7-31.1 ms against 33 (the 1 : 3 case over dense
  masks has 1.9 ms of margin; [evidence](validation/M8.4.16-step5-viewer-rgb8g-windows.json)). Not run: pytest and ruff (no Python changed),
  `smoke.mjs`. GitHub on `51a49e7` (step 4): `tests` and *Desktop builds* passed on Windows, macOS and Linux. The desktop end-to-end tests run
  the program from `desktop/web`, a copy of `app/` made by `node desktop/scripts/prepare.js --with-examples`: refresh it before running them.
- **Checks of M8.4.16 step 4 (18 November 2026, maintainer's Windows computer):** `npm test` 422 passed (6 new in `tests/app/tiledsync.test.mjs`, one
  through the real engine and bridge in `tests/app/engine.test.mjs`); `npm run typecheck`; standalone build; `tests/e2e/tiled-sections.mjs` (engine
  killed while a stroke's tiles are on their way: page unchanged, store complete after the automatic restart; run three times); `tests/e2e/desktop.mjs`
  with the engine off and on; `tools/measure_tiled_viewer.mjs` on `rgb8g` with sending running: every target met, strokes p95 18.2-32.4 ms against
  33 (the 1 : 3 case over dense masks has 0.6 ms of margin; [evidence](validation/M8.4.16-step4-viewer-rgb8g-windows.json)). Not run: pytest and
  ruff (no Python changed), `smoke.mjs`. GitHub on `26cb1fc` (step 3): `tests` failed once on Windows in `engine.test.mjs` ("actual isolated
  Python transfers multiple bounded chunks…", `ENGINE_UNAVAILABLE` at start-up) and passed when the job was run again; not reproduced, recorded
  as an incident.
- **Checks of M8.4.16 step 3 (18 November 2026, maintainer's Windows computer):** `npm test` 415 passed (5 new in `tests/app/tiledit.test.mjs`);
  `npm run typecheck`; standalone build; `tests/e2e/tiled-sections.mjs` (strokes with the real mouse); `tests/e2e/desktop.mjs` with the engine off and
  on; `tools/measure_tiled_viewer.mjs` on `rgb8g` (every target met; strokes p95 18.4-31.8 ms against 33, the closest at 1 screen pixel per 3
  source pixels over dense masks; process tree 1,800 MiB; [evidence](validation/M8.4.16-step3-viewer-rgb8g-windows.json)) and on `rgb2g`
  (15.8-26.2 ms, not kept). Not run: pytest and ruff (no Python changed), `smoke.mjs`. `tests/e2e/tiled-sections.mjs` is not run by GitHub.
- **Checks of M8.4.16 step 2 (18 November 2026, maintainer's Windows computer):** `npm test` 410 passed (8 new in `tests/app/tiledmasks.test.mjs`);
  `npm run typecheck`; standalone build; `tests/e2e/tiled-sections.mjs` (masks at full resolution and two coarser zooms); `tests/e2e/desktop.mjs`
  (engine off); `tools/measure_tiled_viewer.mjs` on `rgb8g`: every target met, with masks 10.5 ms median / 12.9 ms p95 per frame, process tree
  1,712 MiB ([evidence](validation/M8.4.16-step2-viewer-rgb8g-windows.json)). Not run: pytest and ruff (no Python changed since step 1), `smoke.mjs`.
  Not measured: the mask layer at levels between full resolution and the working image (the pan measured stays at level 0).
- **Checks of M8.4.16 step 1 (17 November 2026, maintainer's Windows computer):** `pytest -q` 848 passed / 9 skipped (Python 3.12), including the new
  `tests/test_store_masks.py` and `tests/test_engine_masks.py`; `ruff check src tests tools`; bundled runtime rebuilt; `tests/e2e/tiled-sections.mjs` and
  `tests/e2e/desktop.mjs` with the engine experiment on. Not repeated: `npm test`, typecheck, the standalone build and the other end-to-end tests (no
  JavaScript changed). The GitHub run of the M8.4.15 closing state (`b2b4cdc`) passed on Windows, macOS and Linux.
- **Last full checks: passed** on 17 November 2026 on the state of the M8.4.15 closing commit (branch `work/2026-11-13`, maintainer's Windows computer, one after another): `pytest -q` 811 passed / 9 skipped (Python 3.12); `npm test` 402 passed; `npm run typecheck` (no new diagnostics); `sync_version.py --check`; `ruff check src tests tools` (ruff under Python 3.14); standalone build; bundled runtime rebuilt; `tests/e2e/desktop.mjs` with the engine experiment off and on; `tests/e2e/tiled-sections.mjs`; `tests/e2e/large-16bit-desktop.mjs`. Not run locally: `tests/e2e/smoke.mjs` (needs the local server; the `e2e` job of GitHub runs it on every push). The GitHub run of that commit is recorded in the next session's first line.
- **Previous checks:** passed** on 14 November 2026 on commit `381f2cf` (review of M8.4, branch `work/2026-11-13`, maintainer's Windows computer):
  `pytest -q` 664 passed / 9 skipped (Python 3.12); `node --test tests/app/*.test.mjs` 343 passed; `npm run typecheck` (no new diagnostics);
  `sync_version.py --check`; `ruff check src tests tools` (ruff 0.17.5 under Python 3.14, the only interpreter on this computer that has it);
  standalone build; `tests/e2e/desktop.mjs` with the engine experiment on and off, bundled runtime rebuilt first. GitHub `tests` (including the
  `e2e` job, which runs `smoke.mjs`) and *Desktop builds* succeeded on `381f2cf` on Windows, macOS and Linux. Not run locally: `tests/e2e/smoke.mjs`
  (starting the local server was refused in that session). The commit of 15 November 2026 after it changes documents only (design of part C);
  no code changed, so no checks were repeated. The scenario measurements of M8.4.1-M8.4.5 are separate evidence (baseline committed; later
  runs summarised in each card).
