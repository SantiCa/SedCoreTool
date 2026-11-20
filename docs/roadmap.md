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

Updated 18 November 2026.

- **Released version:** V0.151 (16 November 2026), integrated into `master` on the maintainer's instruction ("haz push de todo y luego publica en
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
  (green on three systems, commit `4a20dfd`); M8.4.29 and M8.4.34 are done at the development gate on 20 Nov 2026 (the GitHub run of their commits is pending); **GitHub on macOS (read on 20 Nov 2026): *Desktop builds* failed on `3b0f7dd` (P1), `00ca21b` (M8.4.29) and `12ff7cc` (M8.4.34), always in `tiled-sections.mjs` (`tests` passed on all three, and Windows and Linux passed): (i) twice a 30 s timeout waiting for the mask round to be on its way before the engine is killed (the wait polls with `requestAnimationFrame`, which a window macOS does not show may never run: diagnosis not confirmed); (ii) once `reopen()` found no tiled section after a reload (`grey: null`), the same symptom as the unexplained local failure of M8.4.34 (1 run in 4): the reason the load failed is not recorded by the test. Both block the milestone gate of part C (M8.4.19); a fix needs a card (proposed to the maintainer).** M8.4.18c is in progress (steps 1-2, the masks of tiled sections in the folder backup and their restore, done at the development gate on 20 Nov 2026; step 3, the source copy, and three questions open: see the card); Q5 parts 1-2 are done (part 3 changes the saved format: approved on 20 Nov 2026 to wait for a save benchmark of long series, and done only if it shows a slow save; the thinning of core-column curves is decided with P2, approved the same day); P1 is done on 20 Nov 2026 (`figsize.js`, `pngmeta.js`, PNG at 300/600 dpi; `npm test` 507, typecheck and standalone build pass; the 600 dpi check added to `tests/e2e/figure-composition.mjs` (run by `smoke.mjs`) **has not been run**: the permission system refused to start the local server for it, so it runs in the next session or on the maintainer's computer); Q3 is done (units of records, sections and joined projects; development gate); Q2 is done (readers and import report; development gate), then the order O approved on 19 November 2026 (second
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
| Tiled sections | M8.4.15 | environment variable `SEDCORETOOL_TILED_SECTIONS=1`, with the engine experiment | off | The milestone gate of part C (M8.4.19), then the release gate |
| Visible-row table rendering | M2.1.3 | session-only checkbox in the Data table (turns it off for the session) | **on** (since 16 Nov 2026) | Release gate before publishing; then the maintainer decides whether to remove the checkbox and the native path |
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
- [ ] `tools/release.sh` cannot run as it is: it looks for `const DELIVERY` at the start of a line and the code says `export const DELIVERY`, so it stops with
      "DELIVERY not found" (found on 16 November 2026; it fails before doing anything). It also calls `python3`, which this Windows computer does not have. Fix and try it
      when the owner decides the first tagged release; it was not changed now because it cannot be tried without pushing a tag.
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
- [ ] Deadlines of the mask-store operations (`STORE_DEADLINES_MS`, card M8.4.34; 30-300 s, chosen with a margin, not measured): measure
      `mask.commit`, `mask.copy`, `mask.retain` and `mask.derived.put` of a 10 % `rgb8g` section on a slow disk (USB or network folder) and
      keep each deadline above the measured time with a stated margin (approved as built on 20 Nov 2026, on condition of this measurement).
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

#### M8.4.8 - Milestone gate of part A — state: Done (16 Nov 2026): measurements 15 Nov; `tests` and *Desktop builds* succeeded on Windows, macOS and Linux on commit `f4ec92a` (all jobs, including `e2e`; the `release` job was skipped, as designed). Still pending from the card: item 3's local run of `smoke.mjs` (the `e2e` job ran it). V0.151 only when the maintainer asks

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
Cards M8.4.12, M8.4.13 and M2.1.4 are detailed below and only measure; **M8.4.14-M8.4.19 were detailed by the design session of
16 November 2026 with those measurements** (decisions in ARCHITECTURE §3.4, questions Q1-Q3 in the status). Every card claims the development gate; M8.4.19 is the milestone gate. Not in part C:
filtering, detection, object features and U-Net on tiles, which are M8.5 slices (b) and (e) working on regions of the store. Known trap for
any card that moves float data: the coordinator checks float64 buffers in pure Python (63 ns per value, about 1 s per 128 MiB); large float
data must be checked in the worker with NumPy.

##### M8.4.12 - Round trip of a one-tile edit, and rule D11 — state: Done (15 Nov 2026); outcome D by the rule; confirmed after M8.4.21 (16 Nov 2026), see below

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

##### M8.4.21 - Interval sums without a per-interval loop; rule D11 measured again — state: Done (16 Nov 2026), development gate

- **Numbering:** this card was first called M8.4.20 by mistake (the commits `7a6aed4` and `01d6de7` and the first run say so); M8.4.20 is the engine-speed card below. Evidence files carry the number M8.4.21.

- **Goal and origin:** M8.4.12 gave D, but 225 of the 238 ms of the table came from a per-interval Python loop. The kernel was vectorised with exact
  results and the measurement repeated with 20 pairs instead of 6.
- **Change:** `kernels/binning.py` (`sum_by_interval`, `bin_edges`), `methods/section_intervals.py` (one sum instead of two), `tests/test_kernels.py`.
- **Result:** [summary](validation/M8.4.21-vectorised-kernel-summary.md). Table 238 -> 35 ms; one-tile edit p95 84.7 ms (60 samples, no stall); 84.7 + 34.8 = 119.5 ms
  > 100: **still D**. D accepted for the interactive interval table only, on the maintainer's delegation; the rule is unchanged. Cards M8.4.14-M8.4.19 may now be detailed with D as given.

##### M8.4.13 - Multi-gigabyte fixtures and the baseline (M2.3.1) — state: Done (16 Nov 2026), development gate; [summary](validation/M8.4.13-large-baseline-summary.md)

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
     (d) the 8 GiB image as a deflate-compressed tiled BigTIFF; (e) a baseline JPEG of 65,500 rows (the most that Pillow's libjpeg writes; the format allows 65,535).
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

##### M2.1.4 - Tables and figures with 100,000 rows: measure — state: Done (16 Nov 2026), development gate; [report](benchmarks/M2.1.4.md)

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

##### M2.1.5 - Multiproxy: build the depth-age relation once per core (found by M2.1.4) — state: Done (16 Nov 2026) with the 2 s target **not met** (2.4-2.6 s); [report](benchmarks/M2.1.5.md)

- **Goal:** the first opening of the multiproxy log of a core with 100,000 rows takes at most 2 s (195 s today, 7.7 s at 20,000 rows), with
  bit-identical results. The target was proposed by this card from the contract's "first useful view <= 2 s" and may be changed by the maintainer before the measurement.
- **Cause (measured, [report](benchmarks/M2.1.4.md)):** `coreConvert` (`app/js/geo.js:103`) also calls `coreAges(core)` on each call (for a core without an age column it parses the age-model text and walks all depths), builds, filters and sorts every depth-age pair of the core on each call, and
  `buildSamples` (`geo.js:170-171`) calls it twice for every sample of the grid: the work grows with the square of the rows. The profile of the cold opening puts about 129 s in
  `coreConvert` itself and about 180 s with the functions inside it, plus 13 s of garbage collection.
- **Read first:** `app/js/geo.js` (`coreAges`, `coreConvert`, `buildSamples`, `intervalsOnAxis`, `interpAge`/`lerp`); `tests/app/geo.test.mjs`; `docs/benchmarks/M2.1.4.md`
  (the profile and the tool); the technical manual's section on depth-age conversion (formulas must still match the code).
- **Change:** `app/js/geo.js`: a function that prepares the relation of one core for one direction (the ages from `coreAges`, then the sorted source and destination arrays, all built once) and returns a function that
  converts a value; `coreConvert` keeps its signature and result and becomes a wrapper (it is also used by `intervalsOnAxis`, a few calls); `buildSamples` prepares the two directions once
  per core before the grid loop. No cache that outlives a call (the core's arrays can be edited), so there is nothing to invalidate. `tests/app/geo.test.mjs`; `CHANGELOG.md`
  ("For users": opening the multiproxy log of a long core is much faster; "Internal" for the tool measurements).
- **Do not touch:** the interpolation formula and its edge behaviour (clamping, missing values, unsorted input, equal depths), the result of any function, the saved-project format,
  other modules. If `interpAge` itself is linear in the number of pairs per call, say so under the card instead of redesigning it: measure first.
- **Steps:**
  1. *(Done in the session of 16 November 2026, file `tests/app/geo-convert.test.mjs`, 7 tests that pass on the current code and keep a copy of it as the exact reference.)* Before changing code, write tests against the **current** `coreConvert` and `buildSamples` on small deterministic cores (with `null` depths and ages, unsorted rows, repeated
     values, one pair, none, `clamp` on and off, both directions) and record their results as expectations. They must pass on the old code.
  2. Implement the preparation function; make `coreConvert` a wrapper; make `buildSamples` use the prepared converters.
  3. The same tests pass unchanged, and a randomised test compares old and new results on cores of up to 500 rows with exact equality (keep the old implementation inside the test).
  4. Measure: `node tools/measure_large_tables.mjs --chrome PATH --out docs/benchmarks/M2.1.5-windows.json --parts figures --rows 20000,100000 --reps 3` and compare the multiproxy
     rows of the table in M2.1.4.
- **Tests:** `node --test tests/app/geo.test.mjs`, then the whole `node --test tests/app/*.test.mjs`; `npm run typecheck`; the regression against
  `legacy/v2.1_console/example_output.csv` is not affected (Python) but `pytest` is run once at the end of the session.
- **Result (16 November 2026):** first opening at 100,000 rows 195 s -> 2.45 s (80 times), at 20,000 rows 7.7 s -> 0.24 s; results exactly equal to the previous code on the tests. The target is missed by 0.4-0.6 s; the profile puts the rest
  in `buildSamples` (`geo.js:188`, a scan of all intervals for every sample and category, 1.15 s) and the per-sample interval `find` of the labelling (`geo.js:319`, 0.25 s). **Proposed next card (for the maintainer to authorise, not started):** M2.1.6, answer the interval membership with `createIntervalLookup` (half-open boundaries, same results), then repeat this measurement.
- **Done when:** the old and new results are exactly equal on the tests; the first opening at 100,000 rows is <= 2 s (or the measured value and the reason are recorded and the
  maintainer decides); `docs/benchmarks/M2.1.5.md` gives the before and after numbers; the report names what was not measured.

##### M2.1.6 - Multiproxy: interval membership with a lookup (proposed by M2.1.5) — state: Done (16 Nov 2026), development gate; [report](benchmarks/M2.1.6.md)

- **Goal and authorisation:** the 2 s target of M2.1.5 is met. Authorised by the maintainer on 16 November 2026 ("autoriza M2.1.6").
- **Change:** `app/js/geo.js` (`buildSamples`, `labelSamples`); `tests/app/geo-intervals.test.mjs`. Tests written first against the old code, with copies of it kept as exact references.
- **Result:** first opening of the multiproxy log at 100,000 rows 2.45 s -> **0.58 s** (0.54-0.62 s), 20,000 rows 0.24 s -> 0.16 s; the log drawn is identical. `node --test` 373 passed; typecheck passed; `smoke.mjs` passed.
  Not measured: macOS, Linux, other interval counts, a profile of the remaining time.

##### Design of M8.4.14-M8.4.19 (design session of 16 November 2026)

The decisions are in [ARCHITECTURE §3.4, "Design of part C"](ARCHITECTURE.md#34-tile-store-for-large-images-planned-part-c-of-m84). Three of them are
proposals that the maintainer answered on 16 November 2026 (Q1-Q3 in the roadmap status); decoding uses libvips (decision 4, revised the same day). Every card claims
the development gate; each later card is re-read by its implementing session against what the earlier cards measured, and stops if a number
invalidates a step. Measured inputs used here: M8.4.12/M8.4.21 (one-tile edit p95 85 ms; D11 = D), M8.4.13 (all seven fixtures open today only at
1/6-1/19 of their resolution, peak 1.1-2.8 GiB, 3-61 s to the first frame), M2.1.4-M2.1.6.

##### M8.4.14 - Tile store format and pyramid import (engine only) — state: Done (17 Nov 2026), development gate; [summary](validation/M8.4.14-summary.md)

- **Goal:** the engine imports a supported source image into a pixel pyramid in the store, with progress, cancellation and bounded memory and
  disk, and serves verified tiles by level and position. The format is documented before the first file is written. No interface change.
- **Read first:** ARCHITECTURE §3.4 (rules and "Design of part C"); contract §3 (transport, limits, errors) and §7 (interactive targets, memory
  sampler); [M8.4.13 summary](validation/M8.4.13-large-baseline-summary.md); `tools/make_large_fixtures.py` (`pixel_region`, the reference);
  `app/js/tiff.js` (the scope of formats supported today); `src/sedcoretool/engine/server.py`, `buffers.py`, `method_worker.py` (operations,
  budgets, job isolation); `desktop/engine.js`, `desktop/engine-ipc.js` (what the main process supplies and allows).
- **Change:** `desktop/runtime-lock.json` and the runtime preparation (add `pyvips`, `pyvips-binary`, `cffi`, `pycparser` with hashes for every
  platform; licence texts in the package); new package `src/sedcoretool/store/` (`format.py`: paths, Zarr v2 metadata, tile-hash files; `source.py`: reading sources with libvips;
  `pyramid.py`: the build job; `tiles.py`: verified reads and the engine tile cache); `engine/server.py` (operations `store.open`, `pyramid.build`,
  `tile.read`); `desktop/engine.js` (the main process passes the two store roots, never the renderer); new contract §8 "Tile store v1" and a
  technical-manual section; new `tools/measure_tile_store.py`; tests; `docs/TECHNICAL_DOCUMENTATION.md` §1.4; `CHANGELOG.md` (Internal).
- **Do not touch:** the interface, `section.analyze`, the project format, today's whole-image path.
- **Model:** most capable, effort high (a permanent file format, a new dependency in three installers, hostile input).
- **Steps:**
  1. Write contract §8 and the manual section first: folder layout of both roots, Zarr v2 metadata of each level, chunk naming, the tile-hash
     file (`<level>/.tiles.sha256`: `rows x cols` records of 32 bytes, row-major), source identity (SHA-256 and size of the source file, computed
     while reading it), a `pyramid.json` with format version 1 and a `complete` field written last, the three operations with closed payloads,
     limits (tile cache 256 MiB, build working memory 512 MiB) and error codes (reuse §3's; disk full is `LIMIT_EXCEEDED` with `details.field = "disk"`).
  2. Add libvips to the bundled runtime (decision 4): pin the four packages for every platform, rebuild the runtime, record the change of the
     installed size and of each installer, check that `tools/check_engine_runtime.py` imports `pyvips` and reads a small TIFF on the packaged
     runtime, and ship the licence texts. `source.py` opens a source with libvips, reads bands of 512 rows (random access for TIFF, sequential for
     JPEG and PNG), refuses JPEG or PNG above 1 GiB decoded with a message key that suggests TIFF, and checks declared dimensions against limits before
     reading. Tests: the same files decoded by `tiff.js` and by `source.py` give identical bytes (the test images of `tests/app/tiff.test.mjs` and small
     outputs of the generator: tiled, striped, deflate, LZW, 16-bit, BigTIFF); hostile files (huge declared dimensions, truncated files, offsets past
     the end) fail with an error and without large allocations; libvips' own caches are bounded (`pyvips.cache_set_max_mem`) and counted in the budget.
  3. `pyramid.build` runs in the worker process: it reads the source in bands of 512 rows, writes level 0 tiles, and builds each next level from the
     previous band with the integer mean of decision 5, so memory stays near two bands per level; progress events at most 10 per second;
     cancellation polled per tile row; output written into `<sha256>.partial/` and renamed when `complete` is written. Before starting, the estimated
     size is compared with the free space and the budget of Q2; a full disk during the build removes the partial folder and returns the error.
  4. **Compression, decided by a rule stated now:** build `rgb2g` with no compressor and with `zlib` level 1; choose `zlib` if its build throughput
     is at least 70 % of the uncompressed one **and** the p95 of reading one level-0 tile from disk (read, inflate, verify) is at most 10 ms;
     otherwise no compressor. Record both measurements and the outcome in contract §8.
  5. `tile.read {store, level, positions: [[row, col], ...]}` with at most 16 positions; every tile is verified against `.tiles.sha256` before it is
     sent (a mismatch is an error for that tile and the tile is never served); bytes follow in binary frames of at most 1 MiB (a 16-bit RGB tile
     needs two); an engine LRU cache of verified tiles within its budget.
  6. Robustness tests: a corrupted tile file, a missing tile file, a tile-hash file of the wrong length, an interrupted build (worker killed: the
     partial folder is ignored and removed, a new build starts clean), a full disk (simulated), a source changed after its pyramid was built (new
     SHA-256, so a new pyramid; the old one is only a cache entry).
  7. Measure with `tools/measure_tile_store.py` on all seven M8.4.13 fixtures (Windows, primary host): build time and throughput (MiB/s of source),
     disk used, process-tree memory peak during the build (sampler of §7), cancellation acknowledgement (<= 250 ms), progress interval
     (<= 1 s), tile read latency p50/p95 (one tile, a batch of 16; cold disk cache not claimed), and exactness: 20 regions per file, crossing tile
     seams, compared byte for byte at level 0 with `pixel_region` and at levels 1-3 with the same integer mean computed by NumPy from `pixel_region`.
- **Tests:** `pytest` for the reader, the pyramid (determinism: two builds give identical bytes and hashes), the operations (protocol fixtures for
  the three new operations, closed payloads, limits), robustness (step 6); `node --test` for the main-process allowlist of the new operations.
- **Done when:** contract §8 and the manual describe the format; every fixture accepted by decision 4 builds and reads back exactly; the
  memory and cancellation targets hold or are recorded as failed with numbers (then stop and ask); evidence committed.
- **Result (17 November 2026):** [summary](validation/M8.4.14-summary.md). Contract §8 and technical manual §26.4 describe the format; libvips in the runtime (+19 MiB on Windows; CI green on Windows, macOS and Linux); all seven fixtures build and read back exactly (80 regions per TIFF at levels 0-3); about 100 MiB/s, 8 GiB in 81 s, memory below 320 MiB, disk 1.33 times the decoded image; **no compressor** by the rule (zlib: 39 % of the throughput). The cancellation target failed first (297-658 ms, the partial folder was deleted before answering) and was fixed in the card (7-15 ms). Two Windows faults found and fixed: libvips crashed while a thread read the worker's stdin pipe; replacing the progress file failed while the coordinator read it. Not measured: macOS/Linux timing, cold cache, a 16 GiB computer.

##### M8.4.15 - Tiled sections in the viewer (behind a flag) — state: Done (17 Nov 2026), development gate; [summary](validation/M8.4.15-summary.md)

- **Goal:** with `SEDCORETOOL_TILED_SECTIONS=1` and the engine experiment on, importing an image above the threshold of decision 1 builds its pyramid
  (progress and cancel shown) and shows the section from tiles: pan, zoom, navigation strip, depth ruler and depth readout, with full-resolution
  coordinates. Tools of decision 8 are disabled with a message. With the flag off nothing changes.
- **Read first:** contract §8 and §7; ARCHITECTURE §3.4; `app/js/app.js` (`render`, `drawNav`, `drawRuler`, the import of `#addImg`);
  `app/js/navpreview.js`; `app/js/sectiondepth.js`; `app/js/engineclient.js`; `desktop/engine-ipc.js`, `desktop/preload.js`; `app/js/i18n.js`.
- **Change:** new pure module `app/js/tilecache.js` (which tiles are visible, level choice, page cache with a 256 MiB budget, prefetch ring,
  cancellation of obsolete requests, fallback to a coarser cached level; no DOM, tested in Node; added to `ORDER` in `tools/build_standalone.py`);
  small hooks in `app.js`; bridge operations for import and tile fetch; flag row in the roadmap's flag table; i18n keys.
- **Do not touch:** sections below the threshold; saving (a tiled section is not saved yet: the interface says so, and the project's other
  sections keep saving normally, until M8.4.18); scientific code.
- **Model:** either tier, effort medium; the most capable with effort high if step 1 or step 7 calls for a decision (a target missed, path (b) chosen).
- **Steps:**
  1. **Delivery path, decided by a rule stated now:** measure on `rgb8g` (a) `tile.read` through the main process and (b) the main process reading
     tile files itself and verifying their hashes (a Node reader of contract §8). Use (a) if a batch of 16 uncached level-0 tiles arrives with p95
     <= 150 ms and a single tile with p95 <= 40 ms; otherwise (b), with format tests shared by both readers. Record the numbers.
     *Result (17 November 2026, [evidence](validation/M8.4.15-delivery-windows.json), `tools/measure_tile_delivery.mjs`):* from the page, on `rgb8g`, (a) one tile p95
     7.9 ms and 16 tiles p95 113 ms; (b) 2.2 ms and 29 ms. (a) meets the rule, so **tiles go through the engine**; (b) stays only as a measurement option
     (`SEDCORETOOL_TILE_DELIVERY=direct`). Both delivered identical bytes. The page bridge is `desktop/tile-ipc.js` (a chosen file becomes a token; a page reads only
     the pyramids it built); `desktop/tile-reader.js` is reader (b). The disk cache was warm; not measured cold.
  2. The tiled section record in memory: full-resolution `w`, `h`, the source identity and the pyramid id; no `orig`, no `labels` arrays.
     *Amended and done (17 November 2026):* the section keeps a small working image from one pyramid level (ARCHITECTURE §3.4 design item 9), so the rest
     of the interface works unchanged; `s.tiled` holds the pyramid, the level and the level sizes; `app/js/tiledsection.js` (pure) reads image sizes from
     headers, picks the level and assembles its tiles; the import asks the engine for the pyramid with a progress dialog and Cancel; the section is not
     saved (`serialize` leaves it out), has no interval table, is read again from the pyramid when its pixels were released, and tools that decode the
     source refuse with a message. Checked with `tests/e2e/tiled-sections.mjs` on the public example (10.4 MP) and on `rgb2g` (level 4, 512 x 5,462).
  3. `tilecache.js`: level = the finest level with at most 1 source pixel per screen pixel at the current zoom; visible tiles plus one ring;
     a request for tiles no longer visible is cancelled; a missing tile is drawn from the nearest cached coarser level, never left blank.
     *Done (17 November 2026):* `app/js/tilecache.js` (pure, `tests/app/tilecache.test.mjs`, 7 tests). The level rule is read as "the coarsest level that
     still has at least one level pixel per screen pixel" (2^k <= 1/zoom), so nothing is magnified beyond the source; requests already sent finish and
     their tiles are cached; evicted tiles are closed (bitmap memory released).
  4. Drawing with `drawImage` of `ImageBitmap`s created from tile bytes; 16-bit tiles mapped to 8 bits for display with the rule of today's 16-bit path.
     *Done (17 November 2026):* `drawTiles` in `app.js` draws the level the zoom needs over the working image, inside the analysis area, nearest pixel,
     edges rounded to whole screen pixels; one page cache (keys per pyramid). Tiles are drawn only while the working image shows source pixels (no
     filter, objects or exclusion; masks are M8.4.16), and tiled sections keep the default filters (decision 8). The end-to-end test compares 40 screen
     pixels where full resolution differs from the working image with the level-0 tile bytes: equal on the public example and on `rgb2g`.
     16-bit drawing is covered by a Node test of `tileRgba` only; `gray16_2g` is drawn in step 7.
  5. *Done (17 November 2026):* the strip and the ruler needed no new code: they are drawn from the working image and its rows, which a tiled
     section has (ARCHITECTURE §3.4 item 9), and the depth of a row is linear over the analysis area. The status bar now gives the **source**
     pixel of a tiled section (`x`, `y` times the factor) instead of the working pixel. `tests/e2e/tiled-sections.mjs` moves the pointer and
     checks the readout of the source pixel, the depth of the source row (against `top + row / full height * (bottom - top)`, tolerance one working
     row, because the working image has `ceil(full height / factor)` rows; this tolerance was fixed before comparing) and that the strip shows
     the image: passes on the public example (factor 2) and on `rgb2g` (factor 16). The ruler's tick labels are the same function of the same
     rows; they were not read back by the test.
  6. *Done (17 November 2026):* tools of the Section mode on a tiled section. **Available:** select, pan, mark (depth marks) and the analysis area
     (none uses a full-size pixel or mask array). **Refused with the one message `tiles.unavailable`:** wand, brush, lasso, cut, erase, exclude,
     include (mask editing, M8.4.16); detection, crop, rotation 90 degrees, the resolution of the section and all filter controls (whole-image
     tools, M8.5; a filter change is undone and the controls return to their defaults). "Same resolution for all sections" skips tiled sections.
     A blocked tool chosen on another section becomes Pan when a tiled section is shown. `tests/e2e/tiled-sections.mjs` clicks every tool and
     action and checks the state and the message (public example and `rgb2g`). Not covered: keyboard shortcuts of the tools (they go through the
     same `setTool` check), the U-Net loader and the batch actions of other tabs.
  7. *Measured (17 November 2026, [summary](validation/M8.4.15-summary.md), `tools/measure_tiled_viewer.mjs`); first a target was missed and the card stopped.* Cached pan and
     zoom: frame median 6.7-7.1 ms, p95 8.8-11.0 ms (targets 17 and 33); uncached jump: the first frame always shows image, full resolution within 182-207 ms
     p95 on three files and 78-89 ms on `gray16_2g` (one first run gave 336 ms with a cold disk cache); process-tree peak 1.3-1.5 GiB (target 2 GiB); a small
     section costs the same tiled or not (6.2 against 6.1 ms median). **Missed: first useful view <= 2 s** - 2.16 s (`rgb2g`), 2.03-2.14 s (`gray16_2g`),
     6.7 s (`rgb8g`), 6.5 s (`deflate8g`). The cause is `pyramid.build` hashing the whole source file on every import to find the cached pyramid (1.85 s for
     2 GiB), not the viewer. Options and the recommendation (remember the hash of a file by path, size and modification time) are in the summary; they change
     the store and contract §8.1, so they need the maintainer's decision.
     *Decision and result (17 November 2026):* the maintainer chose option 1. `src/sedcoretool/store/identity.py` keeps `<root>/identities.json` (contract §8.2,
     §8.4): path, size, modification time, the hash of three sampled MiB and the full SHA-256 of each file hashed; a match finds the existing pyramid without
     reading the file whole; the record is never used to build; the known limit (a file rewritten in place keeping size, time and the sampled MiB) is stated in
     the contract and documented by a test (`tests/test_store_identity.py`, 13 tests). Re-measured on all four files with the final code: **every target met** -
     first view 809-920 ms, cached frame median 5.8-6.3 ms and p95 7.9-8.4 ms, uncached jump p95 76-193 ms, process-tree peak 1.30-1.59 GiB. Gate claimed:
     development (Windows); the flag stays off by default.
  5. Navigation strip and ruler from the coarsest level that fits; depth readout and ruler identical to today's for the same full-resolution row.
  6. Tool gating: list every tool of the Section mode and its state on a tiled section; disabled ones show one message key.
  7. Measure against §7 on `rgb2g`, `rgb8g`, `deflate8g`, `gray16_2g` (pyramids already built): first useful view <= 2 s; cached pan/zoom frame
     median <= 17 ms and p95 <= 33 ms; uncached: a coarser level in the next frame and full resolution within 250 ms p95; process-tree peak <= 2 GiB;
     and the same pan/zoom on a small section shown tiled versus today's path (evidence for rule 6).
- **Tests:** `node --test` for `tilecache.js` (budget, eviction order, cancellation, level choice, coordinates at every level); a desktop end-to-end
  test with a small generated image forced through the tiled path (pixels drawn at known positions equal the generator's); flag off: the existing
  end-to-end tests unchanged.
- **Done when:** the targets of step 7 are measured (a failure is recorded with numbers and the card stops for a decision); the flag is off by
  default and in the flag table.

##### M8.4.16 - Masks of tiled sections: storage, editing and undo — state: Done; decisions A-E approved by the maintainer on 17 Nov 2026 as written; steps 1-8 done; closed at the development gate on 18 Nov 2026, milestone gate passed on `4654ce0`

- **Goal:** labels and exclusion of a tiled section live as mask tiles in the store (decision 6); every editing tool works on loaded tiles; undo and
  redo are per tile and bounded; changed tiles are sent in the background and sent again after an engine failure.
- **Read first:** `app/js/edit.js`, `app/js/maskchanges.js` and the editing handlers in `app.js`; the M8.4.4 guarantees (roadmap history); contract §3
  and §8; ARCHITECTURE §3.4 rules 3-4.
- **Change:** `src/sedcoretool/store/masks.py` (content-addressed tiles, manifests, tables); engine operations `mask.put` (tiles and tables of one
  edit, against a base manifest) and `mask.commit` (returns the new manifest hash); the page's tile-level mask cache, dirty tracking, undo stack
  with its own budget (64 MiB by default) and resend queue; contract §8 extended.
- **Model:** most capable, effort high (editing that could lose user work).
- **What the steps had to solve (found while writing them, 17 November 2026).** Every editing path of today works on one flat array per section
  (`s.labels[y * w + x]`, `s.exclude`, `s.orig`): painting (`setLabel`, `addPx`, `dropIds`), object statistics (`objectStats`), overlap stacks
  (`compactStacks` scans the whole mask), wand (`regionGrow`), lasso, scissors (`splitPieces`) and the pixel logs of undo. At full resolution such an
  array does not fit (`rgb8g`: 8,192 x 349,526 x 4 bytes = 11 GiB). The pure functions already take a width, a height and a region, so they can run
  on a smaller array.
- **Decisions proposed (the maintainer approves or changes them before step 1):**
  - **A. Edit window.** An edit runs on a rectangle of whole level-0 tiles copied into flat arrays (labels `i32`, exclusion `u8`, pixels RGBA): the
    visible tiles for strokes, the tiles of the object boxes for object operations. Today's editing code runs on that window unchanged (a window
    has its own width, height and origin; coordinates are translated at its edges in one new module), and the changed tiles are cut out again.
  - **B. Editing needs enough zoom.** On a tiled section the editing tools work only when the visible tiles fit the window budget (default
    96 level-0 tiles, about 120 MiB with pixels; at 1,440 x 900 that is any zoom of at least one screen pixel per 3 source pixels); further out
    they refuse with one message ("zoom in to edit"). An object operation (split, merge, delete, reclassify) loads the tiles of the object's bounding box (`o.bbox`, kept today); one whose box
    needs more tiles than the budget refuses visibly.
  - **C. Undo by tile copies.** Undo keeps, for each step, a copy of the tiles it changed as they were before (copy on first write), within its own
    budget of 64 MiB; beyond it the oldest steps are dropped with a message. Pixel logs of today's path are not used for tiled sections (a large
    brush at full resolution writes millions of pixels).
  - **D. The overview keeps a reduced mask.** The section's working image keeps a reduced copy of the masks (the label of the source pixel at
    the top-left of each working pixel), updated for the tiles of every edit, so the coarse view, the navigation strip, the Core log and the
    figures keep working; nothing counts from it (counting is M8.4.17, at full resolution). At fine zoom the viewer draws each tile's mask over its
    pixel tile.
  - **E. Where the masks live.** In the project's folder of the store (ARCHITECTURE §3.4 item 3, `<user data>/projects/<project id>/tiles/`), written
    only by the engine. Until M8.4.18 the project record does not name them, so closing the program still loses a tiled section (as today); the
    store keeps the last acknowledged manifest, which M8.4.18 will name.
- **Steps (each one a checkpoint with its own tests; the model of each step is in brackets):**
  1. **Done 17 Nov 2026.** **Store format and engine operations** [most capable, high]: `store/masks.py` (a mask tile is `512 x 512` labels `i32` or exclusion `u8`, stored as
     `<root>/tiles/<sha256>` of its raw little-endian bytes, all-zero tiles not stored; a manifest `{format: "sedcoretool.masks", version: 1, section,
     width, height, tiles: {"<row>.<col>": {labels, exclude}}, tables: {objects, classes, stacks}}`, canonical JSON, named by its SHA-256);
     operations `mask.put {base, tiles, tables}` (tiles as verified binary frames), `mask.commit {staged}` -> `{manifest}`, `mask.read {manifest,
     positions}`; contract §8.7 written before the first file. Python tests: exactness, verification, a killed engine between put and commit leaves
     the last manifest readable, hostile manifests and tiles refused.
     *As built* (contract §8.7 is the reference): `mask.begin` opens a staged version on a base, `mask.put` carries **one tile** per descriptor
     and binary frame (a labels tile is exactly the 1 MiB frame limit), `mask.commit` takes the tables as committed buffers named like the §4
     inputs (`objects`, `classes`, `stack_offsets`, `stack_members`), `mask.discard` closes a staged version; blobs (tiles and tables) are stored
     zlib-compressed in `blobs/<aa>/<sha256>` under `<projects>/<project>/tiles/` (uncompressed, a densely labelled 8 GiB section would take
     about 11 GiB per version). Project identifiers are lower case (one folder on every file system). The coordinator gets the folder with
     `--projects-dir`; the desktop program passes it in step 4. Tests: `tests/test_store_masks.py` (29) and `tests/test_engine_masks.py` (7).
  2. **Done 18 Nov 2026.** **Page mask cache and display** [most capable, medium]: pure module `app/js/tiledmasks.js` (tile cache with dirty, pinned and acknowledged states;
     dirty tiles are never evicted), the reduced mask of decision D, and the overlay drawn per tile at fine zoom; read-only (masks start empty).
     Node tests; desktop test: an injected mask appears at known positions at every level.
     *As built:* the overlay is one screen layer for the visible analysis area (`overlayLayout`, `paintOverlay`) rather than one image per tile, so
     edges across tile seams need no special case; at levels between full resolution and the working image it is painted from the reduced copy,
     and `render()` skips its own mask mixing where the layer covers it. Clean mask tiles are kept up to 128 MiB per section. Tests put tiles in
     the page through `window.ichantool.putMaskTile`. Pixel tiles are now drawn over objects and exclusion too.
  3. **Done 18 Nov 2026.** **Strokes in the edit window** [most capable, high]: brush, erase, exclude, include on the window of decision A, with the zoom rule of B;
     writes cut back into tiles; objects' statistics from the window (pixels of level 0). Input-to-next-frame p95 <= 33 ms during strokes, measured on
     `rgb8g`.
     *As built:* statistics are not taken from the window but kept per tile and summed per object (`tileStats`, `TiledObjectStats`), so a stroke on
     an object larger than the window still gives its exact statistics; they are recomputed after the stroke from the level-0 pixels of the tiles
     within 3 pixels of the change. The window has a margin of `ceil(radius / 512)` tiles. Strokes keep no pixel log and have no undo until step 5.
     For step 8 (exact equality): `TiledObjectStats` sums the luminance sums in another order than `objectStats` (equal within a relative 1e-12),
     so objects compare exactly on every integer field and with that tolerance on `sL`, `sLL`, `rL` and the features computed from them.
     `window.ichantool.putMaskTile` (a test hook) shows tiles without computing statistics. Measured on `rgb8g`: p95 18.4-31.8 ms; the closest
     case (1 screen pixel per 3 source pixels, brush radius 320 source pixels, over dense masks) has 1.2 ms of margin.
  4. **Done 18 Nov 2026.** **Background send and recovery** [most capable, high]: dirty tiles go out with `mask.put` after the stroke (never blocking it; a newer edit of a
     tile replaces a pending send); a tile is acknowledged only after `mask.commit`; after an engine failure the unacknowledged tiles
     are sent again once M8.4.7 has restarted it. Test: the engine killed during a send; the masks in the page and, after the resend, in the store
     are unchanged and complete.
     *As built:* also `MaskLoader`, which reads back clean tiles the page dropped (needed as soon as tiles can be acknowledged: the viewer, the
     edit window and the statistics would otherwise have taken them for empty); the edit window pins its tiles. Tables go with every round. The
     engine's automatic restart is the one of card M8.4.7 (once per program session); after it is used up, unsent tiles stay in the page and
     rounds keep trying every 30 s until the user's Retry of the analysis restarts the engine or the program is closed (then they are lost, as
     every tiled section is until M8.4.18).
  5. **Done 18 Nov 2026.** **Undo and redo** [most capable, high]: decision C, swapping tile copies; history per section; the budget and its message. Node tests and the
     desktop test of step 4 with undo across the failure.
     *As built* (`app/js/tiledundo.js`): tiled steps live in the page's one Undo/Redo history (as every section's steps do), so "history per
     section" means each step names its section and undo selects it. The edit window calls `TileChanges.capture` before it writes a tile; a step
     counts the larger of its two states, so the budget holds whatever is undone; the newest step is kept even beyond 64 MiB (at most the 96 tiles
     of a window); the message is shown once per section. A step whose tiles the page dropped asks to try again while they are read back.
     Stacks of tiled sections are never compacted, so a restored tile's stack codes stay valid. Strokes on `rgb8g` with the copies: p95
     22.7-31.1 ms against 33 (the 1 : 3 case over dense masks has 1.9 ms of margin).
  6. **Done 18 Nov 2026.** **Wand, lasso, scissors and object operations** [most capable, medium]: on the window of the object boxes (decision B); brushes and fills that
     cross a tile seam write each tile; stacks stay one table per section; refusal when a box exceeds the budget.
     *As built:* one window per object (not one for the union of the boxes), so an operation on objects far apart works; every window is planned
     and pinned before anything is written. The lasso uses the window of its box, the wand the window of the visible area (its region stops at
     that window's edge; on the whole-image path it may grow over the whole analysis area). Operations that read `sbox` wait until the
     statistics are current. The wand, the lasso and the scissors left the refused list here rather than in step 8 (they work now); detection,
     crop, rotation, resolution and filters stay refused. Also fixed: the object panel read the box of a tiled object before its statistics
     arrived. Not covered by a desktop test: the refusal of a box over 96 tiles (the public example has 66 tiles in all; `planWindows` is tested
     in Node).
  7. **Done 18 Nov 2026.** **Metadata limits** [fast, medium]: measure the objects and stacks tables of a dense synthetic `rgb8g` annotation against 65,536 records and
     4 MiB (contract §3); change the contract only with that number.
     *Measured* (`tools/measure_mask_tables.mjs`, the page's own `maskTables`; [evidence](validation/M8.4.16-step7-mask-tables.json)): a record of the
     `objects` table takes about 75 bytes (a hand-classified object with a 7-character class id), so the **4 MiB byte cap binds before the
     65,536-record cap: 56,072 objects when all are classified, 51,356 when all are only predicted**. The stack tables bind at 1,398,101 stacks of
     3 members (the 16 MiB cap of `stack_members`; offsets would allow 4,194,303). The contract is not changed: no real annotation of that size
     exists yet to justify a larger cap, and the same 4 MiB cap protects the analysis path. **Open (maintainer):** a tiled section with more than
     about 51,000-56,000 objects cannot commit its tables; the page would show "did not reach the store" and retry every 30 s without end. A
     later card must either raise the cap for `objects` in §8.7 or make the page say that the limit was reached; the number to decide with is above.
     Card M8.4.22 (added 18 November 2026 at the maintainer's request) does both; done the same day.
  8. **Done 18 Nov 2026.** **Exact equality and closing** [fast, medium]: a small image opened both ways (whole, and forced tiled with a section factor of 1) with the same
     scripted edit sequence gives identical labels, exclusion, objects and stacks; tool gating of M8.4.15 updated (the editing tools leave the refused
     list); documents.
     *As built:* `tests/e2e/tiled-sections.mjs` opens the 620 x 16726 example both ways (maximum size raised to 12 Mpixel for the whole path;
     the page hook `forceTiledSections` makes the second copy a tiled section at factor 1) and makes the same scripted edits with the real mouse
     (two overlapping brushes of different classes, erase, exclude, include, lasso, scissors, merge, class change, wand, delete, undo, redo, undo,
     with the analysis area fixed so the wand and lasso are bounded alike). Labels (overlap codes as sets of ids), exclusion, ids, classes, areas,
     boxes, the overlapping sets and every integer statistic are identical; `sL`, `sLL` and `rL` are compared within a relative 1e-12 (the
     tolerance was fixed before comparing; they passed). **Found:** the browser's JPEG decoder and libvips differ by up to 9 levels on about 1 %
     of the samples, so a JPEG opened whole and tiled does not give equal pixel statistics; the test therefore compares a lossless copy written by
     the page. A user who opens the same JPEG whole and as a tiled section gets statistics that differ slightly for that reason, not because of
     editing. The tool gating of M8.4.15 was already updated in step 6.
- **Tests and acceptance:** input-to-next-frame p95 <= 33 ms during strokes; the M8.4.4 guarantees at tile granularity (an edit is never lost or
  applied twice across an engine failure); **exact equality**: a small image opened both ways (whole and forced tiled) with the same scripted edit
  sequence gives identical labels, exclusion, objects and stacks.

##### M8.4.17 - Interval table of tiled sections — state: Done (18 Nov 2026, development gate; card rewritten by the design session of the same day, decision F approved by the maintainer)

- **Goal:** a tiled section has its interval table, counted on the full-resolution mask tiles, equal to what `section.intervals/1` gives on the
  same masks assembled whole, and fast enough for the targets of contract §7.
- **Decision F (design session of 18 Nov 2026; approved by the maintainer the same day, written into ARCHITECTURE §3.4).** *The page counts
  tiled sections, tile by tile, into row histograms that do not depend on classes; the engine does not count.* This revises ARCHITECTURE §3.4
  decision 7 ("the engine counts the rows of each tile") and the line "row counts per tile" of the store's contents; rule D11 = D and rule 8
  (the interval table may stay in JavaScript, with the Python method as the reference) are kept. Why, from the code as it is after M8.4.16-M8.4.26:
  1. *The engine cannot meet the edit target.* It would count the stored version, and the page stores an edit in a round that starts 300 ms
     after it (`MaskSync.delayMs`) and then sends tiles and commits; contract §7 asks p95 <= 150 ms from the analysis request to the table.
     In the page, every tile an edit changes is already in memory (dirty tiles are never dropped).
  2. *Class changes need no tile at all.* A histogram per tile row of `(label, pixels)` pairs (label = object id, or a negative overlap-stack
     code) plus the valid pixels of the row is independent of classes, predictions and settings. A change of effective classes (a
     reclassification, a new prediction, include predictions, the threshold, candidate counting, a class that stops counting) is a new
     aggregation of the histograms, with no read and no recount; the old acceptance line "recounts every tile" becomes "re-aggregates".
  3. *Nothing new crosses a process boundary.* No engine method, no change of `ADVERTISED_METHODS`, `OPERATIONS`, the IPC files or contract §3-§8,
     no cache in the replaceable worker; the seven points of the earlier "Blocked" note are answered by not needing them (inputs, the cache's owner,
     protocol, progress of an engine job) or below (the page, the fixtures).
  4. *The same pattern already runs:* `TiledObjectStats` keeps per-tile contributions of every object and `TiledStatsRunner` recomputes queued
     tiles between frames and reads dropped tiles back (`loadMasks`); the histograms follow it.
  *Alternatives considered:* (A) the card as first written: the engine counts tiles from the store and caches per tile; fails reason 1 and needs
  a new method, protocol and a cache that survives worker replacement. (B) The page sends the touched tiles with an engine request: the round trip
  alone measured p95 85 ms (M8.4.21) before any counting or binning, and the tiles would cross the process boundary twice.
  *What stays Python:* the reference. Every tiled fixture below is checked by the existing Python test of `section.intervals/1`, and the Python
  API and command line are unchanged.
- **Definitions (to be written in TECHNICAL_DOCUMENTATION with the code):**
  - *Analysis area in source pixels:* `sourceRoi(s)` as `app.js` already defines it: `x0 * ds`, `y0 * ds`, `min(x1 * ds, width)`, `min(y1 * ds, height)`
    (half-open). For `ds = 1` it is the ROI itself.
  - *Rows per centimetre for the bins:* `pxPerCm` of `sectiondepth.js` applied to the source area (`(y1 - y0)` of the source area over the depth span),
    so `binRows` gets source rows and `top`/`bottom` unchanged. Ages, manual indices and no-data padding work on depths as today.
  - *Histogram of tile (row, col):* for each source row of the tile inside the source area, the valid pixels (not excluded) among the tile's
    columns inside the area, and the `(label, count)` pairs of nonzero labels among those valid pixels. Rows outside the area are not kept.
  - *Aggregation:* for each row, `bio` adds `count` for an object label whose effective class counts, and for a stack code whose members include at
    least one counted class; `cls[c]` adds `count` once for each distinct counted class (the rule of `core.js rowCounts`, V0.20). Sums over the
    tiles of a row give exactly `rowCounts` of the assembled masks; integers only, so equality is exact.
- **Read first:** this card; ARCHITECTURE §3.4 (rules 4, 5, 8 and decisions 7 and 9); `app/js/core.js` (`rowCounts`, `binRows`, `binEdge`);
  `app/js/sectionanalysis.js` (`computeSectionBins`, `effectiveClassIndex`); `app/js/sectiondepth.js`; `app/js/tiledit.js` (`TiledObjectStats`,
  `TiledStatsRunner`, `affectedTiles`); `app/js/tiledmasks.js` (`MaskTiles`: states, dirty and dropped tiles); in `app/js/app.js`: `sourceRoi`,
  `analyze`/`analyzeAll` (the two `s.tiled` lines that leave the table empty), `tiledStatsRunner`, `finishTiledStroke`, `finishTiledOp`,
  `tiledExcludeRect`, `swapTiledStep`, `compactSectionStacks`; `tools/make_interval_fixtures.mjs` and its README; `tests/e2e/tiled-sections.mjs`
  (the exact-equality block of M8.4.16 step 8); contract §7 (the interactive targets and scenarios (a) and (b)).
- **Change:** new pure module `app/js/tiledcounts.js` (no DOM; added to `ORDER` in `tools/build_standalone.py` after `tiledit.js`);
  `app/js/sectionanalysis.js` (the binning half of `computeSectionBins` as a function of row counts, shared by both paths); the small part of
  `app/js/app.js` that queues tiles and publishes the table; `app/js/i18n.js` (ES/EN) for the messages; `tools/make_interval_fixtures.mjs` and the new
  fixtures; new `tools/measure_tiled_counts.mjs`; tests;
  TECHNICAL_DOCUMENTATION (the definitions above, and §1.4 for the new file); CHANGELOG.
- **Do not touch:** the engine, the IPC files and contract §3-§8; `core.js rowCounts`/`binRows` and the whole-image path (the 44 committed fixtures
  must regenerate unchanged with `--check`); the stored format; the undo, sending and loading of mask tiles; `legacy/`.
- **Model:** fast tier (Sonnet), effort medium: bounded, every step checked by exact equality or a measurement. Stop and ask if a target of step 8
  is missed.
- **Steps:**
  1. *Stack codes must never be renumbered on a tiled section.* `compactSectionStacks` rewrites `s.labels` and renumbers the stack table; on a tiled
     section the tiles would keep the old codes. Check whether any tiled path reaches it (the four call sites); if one can, skip compaction for tiled
     sections (the stack tables are bounded by `MAX_STACK_BYTES`, card M8.4.22) and add a test that a tiled overlap edit leaves `s.stacks` entries
     unchanged. Histograms rely on a stack code meaning the same members for the life of the section.
  2. `tiledcounts.js`: `tileRowHistogram(entry, row, col, area, width, height)` (an empty or never-written tile is computed from the area alone,
     without reading anything) returning typed arrays (rows, valid per row, CSR of `(label, count)` per row); class `TiledRowCounts` with
     `replaceTile(tile, histogram)`, `drop(tile)`, `bytes`, and `rowCounts({effClass, nClasses, stacks, area})` returning the `RowCounts` shape of
     `core.js` for the source area. Keep section totals by row up to date when a tile is replaced (subtract the old contribution, add the new; exact
     integers) for the current effective classes, and aggregate from all histograms only when the effective classes, the stack table or the area's rows
     change. Budget `COUNT_HISTOGRAM_BYTES` = 64 MiB; beyond it the table is not computed and the page says so once (`tiles.countLimit`), never a
     partial table.
  3. `sectionanalysis.js`: split `computeSectionBins` into the row counts and `binsFromRowCounts(s, counts, project, depthSection)`; the whole-image
     path calls it with today's arguments (fixtures `--check` unchanged).
  4. `app.js`: one `TiledRowCounts` per tiled section. Queue the tiles an edit changed with the same positions given to the statistics runner (strokes,
     wand, lasso, scissors, object operations, exclusion rectangle, undo and redo) and count them when the analysis runs (after the existing 100 ms
     grouping), reading the tiles from `MaskTiles` (they are in memory). A change of the analysis area's columns re-counts only the tile columns its
     old and new edges cross and the columns entering it; tiles the page dropped are read back with `MaskLoader` first, between frames, with progress in
     the status line and a cancel that leaves the previous table marked as stale. Until every tile of the area has a histogram the table shows its
     pending state, never a partial one. Replace the two lines that set `s.bins = []` for tiled sections.
  5. Fixtures: add tiled cases to `tools/make_interval_fixtures.mjs`, built on images larger than one tile (for example 1,300 x 1,100 and 600 x 2,100)
     whose `expected` comes from the tiled path and whose `inputs` are the assembled masks: objects and overlaps crossing tile seams (both directions),
     exclusion crossing seams, an area not aligned with tiles, an empty tile inside the area, fractional intervals, predictions included and not. A
     Node test asserts that each tiled `expected` equals the whole-image calculation on the same inputs; the existing Python test then checks them.
  6. Property test (Node): random masks with stacks and exclusion on random sizes across seams and random areas: the tiled aggregation equals
     `rowCounts` exactly; after random tile edits with incremental totals it still does; after a change of effective classes too.
  7. Desktop: in `tests/e2e/tiled-sections.mjs`, the exact-equality block of M8.4.16 step 8 also compares the interval table (every column of the
     published bins) of the whole section and of the tiled section at factor 1, after edits that cross seams, an exclusion and a class change.
  8. Measure (`tools/measure_tiled_counts.mjs` in Node on a synthetic section of `rgb8g`'s size, 8,192 x 349,526 = 10,928 tiles, with masks in a
     stated fraction of the tiles; and in the desktop on the `rgb8g` fixture when it is present): interval table after an edit touching at most 4
     tiles p95 <= 150 ms (scenario (b) of contract §7: from the analysis request to the published table, 60 edits); interval-size change for all
     sections p95 <= 300 ms (scenario (a)); a change of effective classes (re-aggregation) and a change of the area's columns that reads tiles back:
     reported, with the progress and cancel of step 4; memory of the histograms for the measured masks, and the worst case of the budget.
- **Tests:** `tests/app/tiledcounts.test.mjs` (steps 2, 5, 6), the stack test of step 1, `node tools/make_interval_fixtures.mjs --check`, the Python
  test of `section.intervals/1` on the new fixtures, `npm test`, typecheck, pytest, `tests/e2e/tiled-sections.mjs`, `tests/e2e/desktop.mjs` with the
  engine experiment off and on.
- **Done when:** the tiled table equals the whole one on every new fixture and in the desktop
  block; the two targets of step 8 are met and recorded with the reported numbers; development gate on Windows, and `tests` and *Desktop builds*
  passed on the pushed commit.
- *As built (18 Nov 2026):* `app/js/tiledcounts.js` (`tileHistogram`, `TiledRowCounts`, `TiledCountsRunner`), `binsFromRowCounts` split out of
  `computeSectionBins`, `analyzeTiled` and the queue of changed tiles in `app.js` (`commitTiledOp`, `swapTiledStep`, the test hook `putMaskTile`),
  `compactSectionStacks` does nothing for a tiled section (step 1: no tiled path reached it except that guard's case, and the stack table of a tiled
  section only grows), two new strings in `i18n.js`. Differences from the text above, each for a reason found while building:
  - *Rows are not clipped when counting a tile; only columns are.* A change of the area's rows then counts no tile; a change of its columns counts the
    non-empty tiles of the tile columns whose span changed (reading back the dropped ones). A tile with nothing in it has no histogram (it is empty),
    so only tiles with a label or an exclusion cost memory.
  - *Excluded pixels are stored per row, valid pixels are derived* (area columns minus excluded), which keeps empty tiles free.
  - *The old effective classes are kept with the totals.* A new object (a stroke) only appends to the classes array, so the totals are updated by the
    edited tiles alone; a change of the class of an object that existed re-aggregates every histogram (measured below), reading nothing.
  Tests: `tests/app/tiledcounts.test.mjs` (7: seams, 12 random masks with stacks and exclusion on random areas, edits with growing classes, class changes
  and area moves with exact equality at every step, dropped tiles read back only when the area's columns change, stack codes keep their members, and every
  one of the 47 fixture cases counted tile by tile equals `computeSectionBins`); three new fixtures that cross the tile borders (the Python test of
  `section.intervals/1` passes on them); `tests/e2e/tiled-sections.mjs` compares the 300 bins of the whole and the tiled section after the 17-step script
  of M8.4.16 and again after a class change. The assertion "no interval table from empty masks" became "bins without any bioturbation": the table now
  comes from the full-resolution masks, which are empty. **Measured** (`tools/measure_tiled_counts.mjs`, Windows, Ryzen 7 7700X, Node 22; a section of
  the size of `rgb8g`, 8,192 x 349,526 = 10,928 tiles): [3 % of the tiles with content](validation/M8.4.17-tiled-counts.json) and
  [10 %](validation/M8.4.17-tiled-counts-dense.json) (13,272 objects): an edit of 4 tiles p95 8.0-8.5 ms (target 150), an interval-size change p95
  15.6-29.6 ms over 10 changes (target 300; one section), first count of all tiles 0.19-0.64 s, a reclassification (re-aggregation) median 9.8-11.0 ms,
  a move of the area's columns median 11-16 ms and at most 105 ms; histograms 2.2-5.8 MiB of the 64 MiB budget; the incremental totals equal a fresh
  count at the end of each run. Not measured: more than one section together for scenario (a), the interface's 100 ms grouping delay (outside the
  target by contract), the desktop chain with real tile reads from the engine for an area change, macOS and Linux.
  **Findings:** (1) *Cancellation:* `TiledCountsRunner.cancel()` exists and is tested by construction, but no button calls it; reading back many tiles
  after a change of the area's columns can only be waited for (progress is not shown either, only the empty table until it is ready); decide whether
  that needs an interface control. (2) *Engine path, whole section:* with the engine experiment on, `section.intervals/1` answered `INVALID_BUFFER`
  (`stack_members`) for a whole section after the M8.4.16 step 8 edit script (overlaps, a deleted object, undo and redo); the e2e therefore compares the
  tiled table with `referenceBins` (the JavaScript calculation), and the cause was not investigated. (3) The second section of a core continues the
  first one's depths, so the comparison aligns `top`, `bottom` and `units` first.

##### M8.4.22 - Objects table of tiled sections beyond 4 MiB — state: Done (18 Nov 2026, development gate); decision approved by the maintainer on 18 Nov 2026 as written

- **Goal:** a tiled section keeps up to 1,048,576 objects in the store (today about 51,000-56,000: the 4 MiB cap of `utf8json` metadata binds
  first, measured in M8.4.16 step 7, [evidence](validation/M8.4.16-step7-mask-tables.json)); when a limit is reached anyway the page says so once
  and stops retrying, instead of "did not reach the store" every 30 s.
- **Read first:** contract §3 (metadata limits) and §8.7 (mask tiles and tables); `src/sedcoretool/store/masks.py` (`TABLES`, `TABLE_DTYPES`,
  `table_length_ok`); `app/js/tiledsync.js` (`maskTables`, `MaskSync.round`); `app/js/sectionanalysis.js` (`objectRecords`, `classRecords`); the
  step 7 record of M8.4.16.
- **Change:** contract §8.7 written first; `store/masks.py`; `src/sedcoretool/engine/server.py` (`mask.commit` table names); `app/js/tiledsync.js`;
  `desktop/tile-ipc.js` (table names it uploads); `app/js/i18n.js` (one message); tests.
- **Do not touch:** the `utf8json` cap of §3 and the objects input of `section.intervals/1` (§4; the analysis of tiled sections is M8.4.17, which
  reads the same columns if this card is done first); `legacy/`; whole-image sections.
- **Model:** most capable, effort high (a permanent file format, written before M8.4.18 makes it part of saved projects).
- **Decision proposed (the maintainer approves or changes it before step 1):** the store keeps the objects as **binary columns** instead of JSON:
  `object_ids` `u32le[N]`, `object_class` and `object_predicted` `i32le[N]` (index into the `classes` table, -1 for none), `object_confidence`
  `f64le[N]`; 20 bytes per object, each column within the 16 MiB cap of the stack tables, so 1,048,576 objects (2^20) is the stated limit.
  `classes` stays `utf8json` (a few hundred bytes). The manifest becomes **version 2**; version 1 manifests are refused with a clear code (none is
  named by any project yet, because saving tiled sections is M8.4.18, so no user data is lost). Alternative considered: raise the `utf8json`
  cap for store tables only to 64 MiB; rejected because a JSON table of a million records costs about ten times its bytes in parser memory in
  the coordinator (§3 asks to bound that) and stays slower to hash and read.
- **Steps:**
  1. Contract §8.7 v2: table names, dtypes, shapes, the 2^20 limit, the refusal of v1; Python store and `mask.commit` with tests (exact round
     trip, hostile columns: wrong length, unknown class index, duplicate or zero ids, more than 2^20 rows).
  2. Page: `maskTables` builds the columns; before a round the page checks every limit; beyond one it shows "This large section has more
     objects than the store accepts (limit …)" once, keeps the masks in the page and stops the rounds until the count drops. Node tests at the
     limits (2^20 objects pass, 2^20 + 1 refuse without a request to the engine).
  3. Measure again with `tools/measure_mask_tables.mjs` (columns) and run the step-4 desktop test of M8.4.16 unchanged.
- *As built (18 November 2026):* steps 1-3 in one commit. Contract §8.7 version 2; `store/masks.py` (`OBJECT_COLUMNS`, `check_objects`,
  `TABLE_LIMITS`, `NULLABLE_TABLES`), `engine/server.py`, `desktop/tile-ipc.js`, `app/js/tiledsync.js` (`maskTables`, `tableLimit`, state
  `limit`), `app/js/app.js` (the message), `tools/measure_mask_tables.mjs`. The page maps a class identifier the classes table does not hold to
  -1 rather than failing every round. **Measured** ([evidence](validation/M8.4.22-mask-tables.json)): 20 bytes per object; 2^20 objects pass
  the page's check and 2^20 + 1 are refused without a request; building the tables takes 9 ms for 65,536 objects and 0.24 s for 2^20 on the
  page's thread, once per round, so a section near the limit has a visible pause of that length every time its masks are sent (not optimised
  here). M8.4.17 reads the same columns. Tests: `tests/test_store_masks.py` (42), `tests/test_engine_masks.py`, `tests/app/tiledsync.test.mjs`
  (7), `tests/app/engine.test.mjs`.
- **Tests and acceptance:** Python and Node tests above; `tests/e2e/tiled-sections.mjs` passes; contract, technical manual and changelog
  updated in the same commit; development gate on Windows.

##### M8.4.23 - Desktop tests refuse a stale program copy or engine runtime — state: Done (18 Nov 2026, development gate; added at the maintainer's request)

- **Goal:** a desktop end-to-end test run after editing `app/` or the engine's Python fails within seconds with the command that fixes it,
  instead of testing an old copy (`desktop/web`, seen in M8.4.16 step 5) or waiting 90 s for an engine that stays `unavailable` because the
  runtime manifest no longer matches its files (seen in M8.4.22).
- **Read first:** `desktop/scripts/prepare.js`; `desktop/scripts/prepare-runtime.js` and how the runtime manifest records the engine files;
  `desktop/engine.js` (the state `unavailable` and its reason); `tests/e2e/desktop-bootstrap.cjs`; DEVELOPMENT §3 and the troubleshooting table.
- **Change:** one small shared module for the desktop tests (for example `tests/e2e/preflight.mjs`) called at the start of every test that
  starts the desktop program (`desktop.mjs`, `tiled-sections.mjs`, `large-16bit-desktop.mjs`, `working-memory-desktop.mjs` and the others that
  use `desktop-bootstrap.cjs`); DEVELOPMENT §3.
- **Do not touch:** what the program does at run time (the engine still refuses a runtime that does not match: hard limit 6 of AGENTS §3); the
  GitHub workflows' order of steps (they prepare both before testing).
- **Model:** fast, effort low (test tooling, checked by exact comparisons).
- **Steps:** (1) `desktop/web` is current: every file `prepare.js` copies has the same bytes as its source (or a stamp written by `prepare.js`
  with a hash of the sources matches); otherwise stop with "desktop/web is older than app/: run `node desktop/scripts/prepare.js
  --with-examples`". (2) The runtime matches: the same check the program makes on start, run directly; otherwise stop with "the engine runtime
  does not match src/: run `npm run prepare-runtime -- --offline` in desktop/". (3) DEVELOPMENT §3 says it.
- **Tests:** Node test of the preflight on a temporary folder (current, one file changed, one file missing); each desktop test still passes
  when both are current.
- **Done when:** editing one file of `app/js` or `src/sedcoretool/engine` and running a desktop test fails in under 10 s with the right
  command; development gate on Windows.
- *As built:* `tests/e2e/preflight.mjs` (`stale`, `requireFresh`) compares byte by byte `app/` with `desktop/web/app` (ignoring `README.md` and
  the ONNX files `prepare.js` adds), `src/` with `desktop/python/src`, and `src/` with the sources recorded in the runtime manifest of this
  platform (including new `.py` files); it is called at the top of the four tests that start the desktop program. Proof: appending one line
  to `app/js/i18n.js` stops `tiled-sections.mjs` in 0.4 s with `differs js/i18n.js` and the `prepare.js` command. `tests/app/preflight.test.mjs`
  (4 tests on temporary folders). It does not replace the program's own runtime check, which is unchanged.

##### M8.4.24 - The intermittent viewer probe of the tiled-sections test — state: Done (18 Nov 2026, development gate; added at the maintainer's request)

- **Goal:** the failure seen once on 18 November 2026 in `tests/e2e/tiled-sections.mjs` ("drawn pixel = source pixel" at screen 230, 570:
  drawn 106, 79, 35 against source 14, 14, 14, just after the runtime was rebuilt; the next two runs passed) is explained and fixed, in the
  test or in the program, or shown to be harmless with evidence.
- **Read first:** the probe block of `tests/e2e/tiled-sections.mjs` (card M8.4.15); `drawTiles` and `drawMaskOverlay` in `app/js/app.js`;
  `app/js/tilecache.js`; the roadmap record of the incident (checks of M8.4.22).
- **Change:** `tests/e2e/tiled-sections.mjs` (on failure: a screenshot and the tile cache state, level, view and the mask tiles at the probe);
  the program only if the cause is there.
- **Do not touch:** the tolerances of the probe (hard limit 7 of AGENTS §3).
- **Model:** most capable, effort medium (a diagnosis of a rare failure; a wrong guess hides a real drawing fault).
- **Steps:** (1) add the evidence capture; (2) run the probe block repeatedly (at least 30 times, also right after a cold start of the
  engine and with the machine loaded) and record how often it fails; (3) from the captured state, find the cause (for example a tile of
  another position or level drawn while the cache fills, a mask overlay left from an earlier probe, a frame read before the tiles were drawn);
  (4) fix it and run the block again as many times with no failure.
- **Tests:** the repeated runs of step 2 and 4, recorded with their counts; `npm test`.
- **Done when:** the cause is named in the roadmap and the block passes every repeated run after the fix; development gate on Windows.
- *As built — causes found:* (1) **A test fault (reproduced):** the probe took source pixels up to the last column of the analysis area, where
  the viewer draws its dashed border (`#e0995a`, dashes 6 and gaps 4) over the image; a probe on a dash failed. Repetition 3 of the first run
  failed with screen 224, 153, 90, exactly `#e0995a`, on the last column; the probe now stays one pixel inside every edge of the area. The colour
  of the incident of 18 November (106, 79, 35 at screen 230, 570) is not exactly that colour and its view could not be reconstructed, so it is
  not proven to be the same cause; the repetitions found no other. (2) **A program fault (found while making the failure visible):** after a
  failed tile read the scheduler was *idle* with the tile still missing and nothing asked again, so the viewer showed a coarser tile until the
  user moved, and the test, which waited for *idle*, read that stand-in. Now `TileScheduler` stays busy and calls `onRetry` after growing pauses
  (0.5, 1, 2, then 5 s) until the tile arrives. (3) **A program fault (found by killing the engine during the repetitions):** tile reads never
  asked for the one automatic restart of the engine (card M8.4.7), which only the mask sends and the analysis did; with only the viewer using
  the engine it stayed down. Now a failed tile read calls the same `recoverEngine` as the mask sends.
  The test now fails explicitly when the visible tiles are not loaded within 30 s (before, it went on after 10 s without saying so), keeps a
  screenshot and the tile's state when a probe fails, and can repeat the probe (`SEDCORETOOL_PROBE_REPEAT=n`, with the tile cache emptied each
  time; `SEDCORETOOL_PROBE_LOAD=1` keeps every CPU core busy; `SEDCORETOOL_PROBE_KILL=1` kills the coordinator before the fifth repetition and
  then stops the test, because the rest needs the one restart).
  **Runs after the fix (Windows):** 30 repetitions with a kill (all passed; tiles loaded in 60-151 ms, 626 ms after the kill), 10 more with a
  kill (all passed; 584 ms after it), 30 under full CPU load (all passed; 48-163 ms) followed by the whole test (passed). Not repeated: a cold
  start right after rebuilding the runtime, on GitHub.

##### M8.4.25 - Sending the tables of a tiled section without a pause — state: Done (18 Nov 2026, development gate; added at the maintainer's request)

- **Goal:** the masks of a tiled section with many objects are sent without a visible pause: today every round builds all tables on the page's
  thread (9 ms for 65,536 objects, 0.24 s for 1,048,576; [measurement](validation/M8.4.22-mask-tables.json)), even when only tiles changed.
- **Read first:** `app/js/tiledsync.js` (`maskTables`, `tableLimit`, `MaskSync.round`); contract §8.7 (`mask.commit`: a table left out keeps
  the base's); `afterChange` and the stats runner's `onUpdate` in `app/js/app.js`; the M8.4.22 card.
- **Change:** `app/js/tiledsync.js`, the small part of `app/js/app.js` that tells the sync what changed; tests; `tools/measure_mask_tables.mjs`.
- **Do not touch:** the stored format (contract §8.7 version 2); the rule that a tile is acknowledged only after `mask.commit`.
- **Model:** most capable, effort medium (sending path of user edits; a table left out by mistake would store stale objects).
- **Steps:** (1) the sync keeps a version of each table group (object columns with classes; stack tables) that changes only when their content
  can have changed (objects added, removed, reclassified, predicted; classes edited; stacks changed), and leaves unchanged groups out of
  `mask.commit` (the base's are kept); statistics alone do not touch the object columns. (2) When a group did change, build it without
  blocking the page for more than one frame: either in steps between frames or in a worker (choose by measurement; a worker must not copy the
  whole object map each time). (3) Measure on 2^20 synthetic objects: a round after a stroke that changed no object adds under 5 ms to the
  page's thread; a round after a class change keeps every page task under 16 ms.
- **Tests:** Node: a round with only tile changes sends no table; a class change sends the object columns and classes; a stack change sends the
  stack tables; after a failed round everything that was not acknowledged is sent again (tables included); the M8.4.16 tests unchanged.
  Desktop: `tests/e2e/tiled-sections.mjs` unchanged.
- **Done when:** the measurements of step 3 are met and recorded; development gate on Windows.
- *As built:* `MaskSync` keeps a version per group (`objects`: the four columns with `classes`; `stacks`: `stack_offsets` and `stack_members`)
  and the version the store acknowledged; a round sends only the groups not acknowledged (all of them while there is no stored version), and a
  failed round acknowledges none. `request(groups)` raises the versions it names (all by default, so every edit not marked otherwise still sends
  every table); app.js marks only three edits as "tiles only": brush and eraser strokes, the exclusion rectangle and the statistics updates.
  What those may still carry is found at the start of every round by cheap checks (`changed`): a different count of objects or `nextId` (a new
  or removed trace), a different `s.stacks` array or length (a new overlap stack or a compaction), and a different classes text (class edits,
  which do not always ask for a round). Predictions changed by the classifier (`learnNow`, which never asked for a round) now ask for the
  objects group. Step 2: building in slices between macrotasks (`buildMaskTables`, about `SLICE_MS` = 8 ms each) was chosen over a worker,
  because the measured build is 31 ms and a worker would need a copy of the objects; a slice that finds its group changed starts again before
  anything is sent. **Measured** ([evidence](validation/M8.4.25-mask-rounds.json), Windows, Node 22, 2^20 objects): after a stroke that changed
  no object the round's table part takes 0.01 ms of the page's thread (target under 5 ms); after a class change the longest task is 8.2 ms
  (target under 16 ms; 25-33 ms of thread time in 4-5 tasks). The 0.24 s of the M8.4.22 record included creating the synthetic objects; the
  build alone takes 31 ms for 2^20 objects (the tool now times only the build). Node: 5 new tests in `tests/app/tiledsync.test.mjs`, the 7 of
  M8.4.16 and M8.4.22 unchanged.

##### M8.4.26 - Two intermittent GitHub failures: runtime downloads and an engine start on Windows — state: Done (18 Nov 2026, development gate; deadline decision (b) of the maintainer)

- **Goal:** the two failures seen once each on GitHub stop costing reruns, without weakening any check: (a) *Desktop builds* on macOS,
  commit `d407763`: `npm run dist` failed because `tools/prepare_engine_runtime.py` lost a download of a pinned wheel (`TimeoutError: The read
  operation timed out` in `response.read`, timeout 30 s, no retry); the rerun passed. (b) `tests` on Windows, commit `26cb1fc`:
  `tests/app/engine.test.mjs` "actual isolated Python transfers multiple bounded chunks and runs the diagnostic" got `ENGINE_UNAVAILABLE` at
  start-up; the rerun passed and it was not reproduced.
- **Read first:** `tools/prepare_engine_runtime.py` (`download_artifact`); the workflow files under `.github/workflows/` (how the runtime is
  prepared and whether its download cache is kept between runs); `tests/app/engine.test.mjs` (the test and its start-up deadline);
  `desktop/engine.js` (what `ENGINE_UNAVAILABLE` at start means: the handshake, the runtime check, the deadline); the roadmap records of both
  incidents.
- **Change:** (a) `tools/prepare_engine_runtime.py` and, if useful, the workflows; (b) `tests/app/engine.test.mjs` and, only if the cause is
  there, `desktop/engine.js`; tests of both; DEVELOPMENT where the behaviour is described.
- **Do not touch:** the pinned artifacts, their sizes, hashes and trusted origins (every download is still verified before use); the program
  never downloads anything at run time (hard limit 6 of AGENTS §3: this card is about building the runtime, not running it); the engine's
  start-up deadline and every tolerance (hard limit 7: if the measurements show the deadline itself is too short on GitHub's Windows machines,
  record them and ask the maintainer).
- **Model:** most capable, effort medium (packaging on three systems and a diagnosis of a rare start-up failure).
- **Steps:**
  1. (a) Downloads: retry a failed or timed-out download a bounded number of times (for example 4) with growing pauses, always into a new
     temporary file and always verifying size and SHA-256 before keeping it; a verification failure is never retried silently (it stops with
     its message). If the workflows do not keep the download cache between runs, keep it (keyed by the lock file), so most runs download
     nothing. Python test with a fake server: a dropped connection then a good answer succeeds; a wrong hash stops at once; four failures stop
     with a clear message.
  2. (b) Engine start: make the test record, when the engine is unavailable at start, the reason the client knows (handshake not received,
     runtime check, process exit code and the last lines of the engine's standard error) and the time from spawn to failure, so the next
     occurrence explains itself. Run the test repeatedly on GitHub's Windows runner (a manual workflow run of the test file alone, at least
     20 times) and locally under load; record the counts and times.
  3. Fix what the evidence of step 2 shows, or, if it never fails again, leave the recording in place and say so in the roadmap.
- **Tests:** the Python tests of step 1; `npm test`; one *Desktop builds* run on three systems with the cache cold and one with it warm.
- **Done when:** step 1 is in place and tested; step 2 has run with its counts recorded; any fix of step 3 has its own test; development gate,
  plus the GitHub runs of the last test line.
- *As built so far (18 Nov 2026):* (1) `download_artifact` tries a failed transfer again (`DOWNLOAD_ATTEMPTS` = 4, pauses 2, 5, 15 s; a
  timeout, dropped connection, truncated body or HTTP 5xx/408/429), each into a new temporary file; bytes that arrive whole but differ from
  the lock stop at once. Python tests with a local HTTP server: a dropped connection or a 503 then a good answer succeeds (one pause of 2 s);
  wrong bytes stop after one request; four dropped connections stop with "failed 4 times; last error: TransferError…". *Desktop builds*
  keeps `.venv/runtime-downloads` with `actions/cache@v6` (GitHub's own action; capability: most runs download nothing; alternative
  considered: retries alone, which still download about 60 MB per system per run; cost for offline and desktop distribution: none, it
  runs only on GitHub). (2) The engine tests' `clientFixture` now records, when a start fails, the reason (process could not start /
  exited before its handshake / no handshake within the request deadline / handshake refused), time to failure against the deadline, exit
  code and the last 20 lines of standard error, and with `SEDCORETOOL_ENGINE_START_LOG` every start; a new test provokes the first two
  reasons. The workflow `engine-start.yml` runs the test file 20 times on `windows-latest` (on a push that changes it, or by hand).
  **Measured locally (Windows, Ryzen 7 7700X):** idle, 20 runs of the file, 240 starts, none failed, 111-178 ms (median 137). With every
  core busy (one Node loop per core), 32 runs, 384 starts: **one failed with "no handshake within the request deadline" after 5046 ms**
  (deadline 5000, empty standard error), successful starts 248-4677 ms (median 559-720, 95th percentile 1228-1830). The same evidence fits
  the GitHub incident: a slow Python start on a busy runner against the 5 s deadline of the first request. Also under load, the test "a
  buffer.read answer that does not match its request…" failed in 9 of 12 runs, because it starts its fixture engines with its own 1.5 s
  deadline. Neither deadline is changed (AGENTS §3.7): **question for the maintainer** below.
  **On GitHub (commit `0fdd7bb`):** *engine start repetitions* on `windows-latest`: 20 runs of the file, 220 starts, none failed, 82-867 ms
  (median 88, 95th percentile 109); `tests` passed; *Desktop builds* passed on Windows, macOS and Linux with the download cache cold (not
  found, then saved). The run with the cache warm is the next push.
- **Question for the maintainer (M8.4.26):** the engine start in the tests uses the client's 5 s request deadline for the handshake (1.5 s
  in the `buffer.read` fixture test); under full CPU load starts took up to 4.7 s and one exceeded 5 s. Options: (a) keep the deadlines and
  accept a rare rerun; (b) give the handshake its own, longer deadline in `desktop/engine.js` (also in the program, where a slow first start
  today shows the engine as unavailable and uses the one automatic restart); (c) lengthen only the tests' deadlines. Recommendation: (b),
  for example 20 s for the handshake only, because the program meets the same slow start on a busy computer.
  **Answered by the maintainer on 18 November 2026: (b).** `EngineClient` has `startTimeoutMs` (default `START_TIMEOUT_MS` = 20 s) for the
  handshake only; every other request keeps its deadline (5 s by default). New test: a fake engine that answers its handshake after 0.8 s
  starts with ordinary requests limited to 0.3 s, and fails with "no handshake within the start deadline" when the start deadline is 0.3 s.
  The `buffer.read` fixture test no longer depends on how fast Python starts, because its 1.5 s now applies only to its requests.
  **After the fix (Windows, every core busy):** 20 runs of the engine tests, 280 starts, none failed, 202-1141 ms; `buffer.read` test passed
  every time. *Desktop builds* with the download cache warm (commit `184ea3f`): cache hit on Windows, macOS and Linux, all passed. Full
  checks on Windows: `npm test` 444 passed, typecheck, pytest 865 passed (9 skipped), `tests/e2e/desktop.mjs` with the engine experiment
  off and on. Not run again on GitHub: the 20 Windows repetitions after the deadline change (the workflow runs by hand or when it changes).

##### M8.4.18 - Saving, reopening, backup and export of tiled sections — split into M8.4.18a-d by the design session of 18 Nov 2026

The summary written on 16 November (record naming the store version, the manifest and the source; save order of rule 4; incremental folder backup;
the source by path, size and SHA-256 with an option to copy it; a missing source located by the user; streamed export; failure tests) is four
deliveries, each with its own failure tests. Facts from the code that shape them: (1) the mask store **never deletes anything** today: every
background round of `MaskSync` writes a manifest, and old manifests and tiles stay forever (`store/masks.py` has no removal); (2) the renderer never
sees a path (contract §8.1), so the source's path must be remembered by the main process, not by the project record; (3) `zip.js` has no ZIP64 and
refuses packages above 4 GiB, while the masks of one `rgb8g`-sized section can exceed that; (4) after reopening, the interval table of M8.4.17 needs
every non-empty tile counted once, which means reading them back. **Decisions D1-D4 below were answered by the maintainer on 18 November 2026: each as
  proposed (the first option).**

- **D1, saving while the engine cannot take the edits:** the save writes everything else and keeps, for that section, the last manifest the store
  acknowledged *with all its edits* (never a newer one that misses some); the section shows "unsaved changes" and the save is retried; closing the
  program warns, as today for a failed save. *Alternative:* the whole save fails.
- **D2, a project with tiled sections opened without the engine** (browser build, standalone file, engine experiment off): the section is shown as
  a placeholder that says what it needs, its record is kept byte for byte on every later save, and nothing that would change it is allowed.
  *Alternative:* the project does not open.
- **D3, copying the source into the project:** not by default; an action per section copies it into `<user data>/projects/<project>/sources/` (with
  the size shown first); the copy is used when the original is missing. *Alternatives:* always copy; never copy.
- **D4, packages (`.sedcoretool`) with tiled sections:** the package holds the masks (tiles and manifest) and the source's identity, and the source
  itself only when the user ticks it; this needs ZIP64 in `zip.js` (own code, no dependency). *Alternative:* packages refuse tiled sections and only
  the folder backup carries them.

##### M8.4.18a - Save and reopen tiled sections on the same computer — state: Done (18 Nov 2026, development gate)

- **Goal:** a tiled section survives closing and reopening the program, with exactly the masks, objects and interval table it had, and the store
  does not grow without bound; no failure loses the last good save.
- **Read first:** this card and D1-D2; ARCHITECTURE §3.4 rule 4 and decisions 3, 7, 9; contract §8.7; `app/js/storage.js` (`putProject`,
  `getProject`); in `app.js`: `serSection`, `serialize` (the line that leaves tiled sections out), `loadSection`, `saveToDB`, `flushSave`,
  `addTiledSection`, `maskSync`, `maskLoader`, `tiledCounts`; `app/js/tiledsync.js`; `src/sedcoretool/store/masks.py`; `desktop/tile-ipc.js`.
- **Change:** `app.js` (a `tiled` part in the section record; save and load paths), `tiledsync.js` (a way to wait until the store holds every
  edit), `store/masks.py` and `engine/server.py` (operation `mask.retain`), `desktop/tile-ipc.js` and `preload.js` (the new operation; the
  source path remembered by the main process), contract §8.7, TECHNICAL_DOCUMENTATION (the record), tests.
- **Do not touch:** the record of every other section (old projects open and save byte for byte as before); the stored format of tiles and
  manifests (version 2); the pyramid format; `legacy/`.
- **Model:** most capable, effort high (saving and recovery, a versioned extension of the project format).
- **Steps:**
  1. *The record.* A tiled section is saved like any section, without `labels`, `exclude` and `stacks` arrays (they are in the store), plus
     `tiled: {version: 1, store: 2, manifest, width, height, source: {sha256, size, name}, level}`; `stacks` is saved as its table (the store's
     `stack_offsets`/`stack_members` already hold it) and objects as today (with `st`). The project format version is raised only if an older build
     would misread the record; an older build that does not know `tiled` must refuse the section visibly (check what V0.151 does with it and record it).
  2. *Saving.* `saveToDB` first asks every tiled section's `MaskSync` for a settled state (all edits acknowledged) with a deadline; the record names
     that manifest. If a section cannot settle (D1), its previous record is kept, the section is marked unsaved and the save of everything else
     goes on; the save state shows it. The store already writes tiles, then the manifest atomically (contract §8.7), so rule 4's order holds: the
     record is written last.
  3. *Retention.* New engine operation `mask.retain {project, keep: [manifest, ...]}` deletes every manifest of the project not listed and every tile
     no remaining manifest uses, and never one a staged version uses. The page calls it after a successful save, with the manifests of the saved
     records plus the current acknowledged ones. Interrupted half-way it leaves only unreferenced files behind (tested by killing the engine).
  4. *The source path.* The main process keeps `<user data>/projects/<project>/sources.json` ({sha256 -> last path, size}), written atomically when a
     tiled section is added; the renderer still never sees it.
  5. *Reopening.* `loadSection` of a tiled section: the pyramid by its SHA-256 if it is in the cache; otherwise built again from the remembered path
     after checking size and SHA-256 (the identity record avoids rereading an unchanged file); if neither is available, the section opens with its
     masks, objects and table and a grey image that says the picture is missing (located by M8.4.18b). The masks come from the manifest (`MaskLoader`),
     the counts of M8.4.17 are rebuilt by reading the non-empty tiles back once, with progress, and the table appears when they are all counted.
  6. *Without the engine (D2):* the section is a placeholder and its record is written back unchanged.
- **Tests:** Node: record round trip (all fields); an old project with no tiled section saves byte for byte as before; a save while `MaskSync` cannot
  settle keeps the previous record (D1); `mask.retain` (Python): keeps listed manifests and their tiles, removes the rest, never a staged version's
  tiles, interrupted retention leaves a readable store. Desktop: add a tiled section, edit, save, close, reopen: identical masks (as the M8.4.16 step 8
  block compares them), objects and interval table; kill the engine before a save: the previous save opens; delete the pyramid cache: rebuilt from
  the source; move the source and delete the cache: grey image, masks and table intact. Measure the reopening of an `rgb8g`-sized section with 3 % and
  10 % of its tiles holding masks (time to the first frame and to the table).
- **Done when:** the desktop round trip is exact; every failure case keeps the last good save; the store holds only retained manifests after a save;
  the reopening times are recorded; development gate.
- *As built (18 Nov 2026):* engine `mask.retain` and `mask.info` (contract §8.7); the main process's `sources.json` and `reopen` (`tile-ipc.js`);
  in `app.js` the record (`serTiledSection`, format version 6 only for projects with a tiled section), the save (`settleTiledSections`, D1;
  `retainStore` after a successful save), the reopening (`loadTiledSection`: pyramid from the cache or rebuilt from the remembered file, tiles listed and
  read back once for the reduced copy and the row counts, statistics recomputed in the background) and two locks: a section whose source and pyramid are
  missing (`frozen: 'source'`, grey, masks and table kept, no edit) and the placeholder of D2 (`frozen: 'engine'`, record written back unchanged).
  An older build (V0.151) does not open a version 6 project: decoding the tiled record's missing image throws and the load fails without writing (read
  from its code, not run). Tests: Python 5 (retain keeps the listed versions and an open staging's tiles; a missing kept version removes nothing; a
  removed blob is written again rather than taken from the cache; a retain stopped half-way leaves every kept version readable; `mask.info` pages);
  Node 2 (`tile-ipc.js`: remembered sources, reopening only from a file with the saved SHA-256, checks of retain and info); desktop
  (`tests/e2e/tiled-sections.mjs`): after a save the store holds only the saved versions; reopened from the library, the edited section has identical
  labels, exclusion, overlaps, objects (statistics recomputed: exact, three float sums within 1e-12) and interval table; the same after deleting the
  pyramid (rebuilt from the source) and with the source moved too (grey, locked: a brush stroke creates nothing); D1 by stopping the section's sync:
  the rest saved (the renamed project), the section's record names the previous version, the user told, and the reopened section is the saved one; D2
  in the program without the flag: placeholder, no table, the record saved back byte for byte, the rest saved; a project without tiled sections stays
  version 5. **Measured** (`tools/measure_tiled_reopen.mjs`, Windows, Ryzen 7 7700X, the `rgb8g` fixture with its pyramid in the cache):
  [3 % of the tiles with masks](validation/M8.4.18a-reopen-3pct.json) (364 tiles, 4,368 objects): project open with its interval table in 4.6 s,
  statistics recomputed in the background after 41 s; [10 %](validation/M8.4.18a-reopen-10pct.json) (1,126 tiles, 13,512 objects): 10.8 s, 133 s.
  Not done or not measured: the engine process killed during a save (D1 was tested by stopping the sync, the store's own crash safety by the Python tests
  of M8.4.16); reopening with the pyramid rebuilt from an 8 GiB source (about 95 s to build, measured when the section was added); macOS and Linux.
  **Findings:** (1) while the statistics are recomputed after a reopening (41-133 s above), object operations that read boxes say "try again in a
  moment", and a stroke updates an object spanning several tiles correctly only once all its tiles are done (card M8.4.28); (2) a project deleted from
  the library leaves its folder in the store (`<user data>/projects/<id>/`) (card M8.4.27); (3) the reopening reads every stored tile through the
  engine once, which is most of the 4.6-10.8 s (card M8.4.29).

##### M8.4.18b - A missing or moved source; copying the source into the project — state: Done (18 Nov 2026, development gate; D3 answered: copy only on request)

- **Goal:** a tiled section whose source moved can be pointed at the file again, accepted only when its SHA-256 matches; and the user can copy the
  source into the project so it no longer depends on the original.
- **Read first:** M8.4.18a as built; D3; contract §8.1-§8.3 (sources, identity record); `desktop/tile-ipc.js` (`register`), `desktop/main.js` (file dialogs).
- **Change:** `desktop/main.js`, `tile-ipc.js`, `preload.js` (locate and copy operations), `app.js` and `i18n.js` (the grey image's button and the
  per-section copy action), contract §8, tests.
- **Do not touch:** the record of M8.4.18a; the pyramid and mask formats.
- **Model:** most capable, effort medium (verified file identity; disk space).
- **Steps:** (1) "Locate the image": a file dialog in the main process; the engine hashes the chosen file (progress, cancel); a different SHA-256 is
  refused with a message that shows both sizes; a match updates `sources.json` and rebuilds the pyramid if needed. (2) "Copy the image into the project":
  shows the size and the free space first; copies to `sources/<sha256>` through a temporary file, verifies the SHA-256, then renames; a full disk
  leaves no partial file. The copy is preferred to the original when both exist. (Deleting a project's copies is part of M8.4.27, which owns the
  whole project folder.)
- **Tests:** a moved file is accepted; another file of the same size is refused; a copy interrupted by a full disk (simulated) leaves nothing; the
  copy is used when the original is deleted; desktop end-to-end of both actions.
- **Done when:** both actions work in the desktop with verified identity, and every failure leaves the previous state; development gate.
- *As built (18 Nov 2026):* `pyramid.build` takes `expect` (contract §8.5): a file with another SHA-256 is refused once it is known (from the
  identity record or after hashing), before any pyramid is built or removed to make room. The main process (`desktop/tile-ipc.js`) has `locate`
  (another size is refused without reading the file), `copySource` (`desktop/source-copy.js`: temporary file, hashed while written, renamed only
  with the saved size and SHA-256; refused when less than 1 GiB would stay free) and `sourceInfo`; `reopen` tries the project's copy before the
  remembered original, both with `expect`; `sources.json` entries gain `name` and `copy` (contract §8.7). The page's panel is a new controller,
  `app/js/tiledsource.js`; `app.js` only wires it and opens a located section again from its saved record (`reopenLocated`). Differences from the
  text above: (1) the file is chosen with the page's file input, as when adding an image (the preload passes its path to the main process, which
  issues a token), not with a dialog of the main process: the same path and the same checks; (2) the copy is hashed as it is written, not read
  back after writing; (3) a section locked because its image is missing now also locks its name, depths, analysis area and resolution (before, a
  rename was accepted and then lost, because a save writes the saved record of a locked section); (4) step 3 (deleting copies with the project)
  moved to M8.4.27. Tests: Python 2 (`expect` refused through the identity record and after hashing, with nothing built or removed; the request
  through the coordinator) plus a validation case; Node 4 (`tests/app/source-copy.test.mjs`: the verified copy, a full disk simulated after the
  first 4 MiB and a cancellation leave no file, another or a longer file is refused; locate refuses another size unread and another SHA-256 before
  building, accepts the moved file and remembers its place; the copy is used when the original and the cache are gone, an altered copy is not;
  the 1 GiB reserve); desktop (`tests/e2e/tiled-sections.mjs`): on the locked section the form offers "Locate", a file of the same size with
  other bytes is refused and nothing is built, the moved file unlocks the section identical to the saved one (masks, objects with statistics,
  table), "Copy" asks with size and free space, the copy is the image byte for byte, and with the original and the pyramid gone the section
  reopens from the copy, identical. Not done: the time to hash and copy an 8 GiB source (the hashing is the build's stage `hash`, about 7 s for
  8 GiB in M8.4.15); a real full disk; macOS and Linux. **Finding:** deleting a class sets `cls` to null in the sections of the open core, but a locked section
  saves its saved record, so the deleted class's id stays in that record until the section is opened with its image and saved again.
  Checks on Windows (18 Nov 2026): `pytest` 878 passed, 9 skipped; `npm test` 457 passed (the packaging test first failed: the new module was missing from the installer's file list and the package check, both fixed); typecheck, `sync_version --check` and Ruff passed; `tests/e2e/desktop.mjs` with the engine experiment off and on and `tests/e2e/tiled-sections.mjs` passed.

##### M8.4.27 - The store folder follows its project — state: Done (18 Nov 2026, development gate; written the same day for finding 2 of M8.4.18a)

- **Goal:** the folder `<user data>/projects/<store id>/` (mask tiles and manifests, `sources.json`, the copies of M8.4.18b) lives and dies with its
  project: deleting the project removes it; a project copied under a new identifier gets the stored versions its tiled sections name; and a tiled
  section whose stored version is missing opens locked instead of making the whole project fail to open.
- **Why, from the code (18 Nov 2026):** (1) the library's delete (`deleteProject` in the projects list of `app.js`) removes only the IndexedDB records,
  so the folder stays forever (finding 2); (2) importing a package or backup of a project that already exists keeps the local version as a copy under a
  new identifier (`id2` in the import path, "previous version"); a tiled section of that copy names manifests that are in the old identifier's folder,
  so the copy fails to open (`mask.info` answers that the manifest is missing and `loadTiledSection` throws, which stops `loadProject`), and the next
  save of the original with a tiled section lets `mask.retain` delete those manifests for good; (3) the same throw happens for any missing manifest.
- **Read first:** this card; M8.4.18a as built; contract §8.7 (`mask.retain`, `sources.json`); in `app.js`: the `del` action of the projects list,
  the import path that creates `id2`, `loadTiledSection`, `retainStore`, `storeProject`; `desktop/tile-ipc.js` (`projectsRoot`, `readSources`);
  `src/sedcoretool/store/masks.py`.
- **Change:** contract §8.7 first (two operations); `desktop/tile-ipc.js`, `preload.js` (`deleteProjectStore`, `copyProjectStore`); `engine/server.py`
  and `store/masks.py` if the copy goes through the engine (it must, if the engine keeps the store open: close or forget its `MaskStore` first);
  `app.js` (the delete action, the import copy, a third lock `frozen: 'store'` in `loadTiledSection`); `i18n.js`; TECHNICAL_DOCUMENTATION; tests.
- **Do not touch:** the record and format version of M8.4.18a; the store format; projects without tiled sections (their delete and import stay as
  they are); `legacy/`.
- **Model:** most capable, effort high (deletes user data; a wrong copy loses masks).
- **Steps:**
  1. *Delete.* After the IndexedDB delete succeeds, the page asks the main process to delete the project's folder. The main process refuses any
     identifier that is not exactly a store identifier (`storeProject` rules, contract §8.7) and resolves the path inside `projectsRoot` only; the
     engine forgets the project's open store and cached blobs first. The folder is renamed to a `.deleting-<random>` name, then removed, so a crash
     half-way leaves a folder nothing opens, removed at the next start. A project that is open is reset first (as today).
  2. *Copy under a new identifier.* Where the page saves a project under a new identifier that keeps tiled sections (the `id2` copy today, and any
     later "save as"), it first asks for a copy of the named manifests and their tiles into the new identifier's folder (hard links where the file
     system allows them, otherwise copies, verified by SHA-256), plus `sources.json`; the IndexedDB record is written only after the copy succeeded.
     If it fails, the copy is not made and the user is told; the original is untouched.
  3. *Missing stored version.* `loadTiledSection` catches a missing manifest or tile: the section opens grey (or with its image if the pyramid is
     there), with no masks and an empty table, locked as `frozen: 'store'` with a message that names the section; its record is saved back byte
     for byte (as D2), and `mask.retain` never runs for a project with such a section, so nothing else is deleted while it is broken.
- **Tests:** Node (`tile-ipc.js`): delete removes the folder and refuses `..`, absolute paths, device names and identifiers of another shape; an
  interrupted delete leaves a `.deleting-*` folder that the next start removes; copy duplicates the named manifests and tiles and verifies them; a
  failed copy writes nothing. Python if the engine takes part (forgetting a project's store and cache). Desktop (`tests/e2e/tiled-sections.mjs`):
  delete a project with a tiled section from the library: its folder is gone and other projects' folders are untouched; import a package of a project
  that exists locally with a tiled section and keep both: the "previous version" opens with identical masks, and saving the other one does not
  remove them; delete one manifest by hand: the project opens, that section is locked and says so, the rest edits and saves.
- **Done when:** the three cases work as above in the desktop with their failure cases; development gate.
- *As built (18 Nov 2026):* engine `mask.copy` (`MaskStore.copy_from`: pages of 32 tiles, so that no request comes near the client's 5 s
  deadline; blobs read verified and written durably; the manifest last, only when every blob is there) and `mask.forget` (contract §8.7);
  `desktop/tile-ipc.js`: `deleteProjectStore` (forget, rename to `.deleting-<uuid>`, remove; leftovers removed when the bridge starts) and
  `copyProjectStore` (the manifests page by page, then the `sources.json` entries of the sections' sources with the project's copies, hard-linked
  when possible); `app.js`: `deleteStoreOf` (stops the sends of the open project's sections, waits up to 3 s, retries a `BUSY` answer for 5 s, tells
  the user if the folder stayed), `copyTiledStore` before the "previous version" copy of the import (a failure throws, so that project is not
  imported and the local version is untouched; without the engine too), and `storeLocked` (`frozen: 'store'`: no masks, no table, the saved
  record written back, `retainStore` skipped while such a section is open). Differences from the text above: (1) step 2's "later save as" does not
  exist in the program today; the import copy is the only place a project gets a new identifier with its sections; (2) the engine keeps the eight
  most recent manifests and 64 MiB of blobs in memory, so a version removed from the disk is noticed only after the engine restarts (the usual case:
  a new start or another computer); the desktop test restarts it. Tests: Python 3 (`mask.copy` in pages with the manifest last, the copy untouched
  by a retain of the first project, a skipped page and a damaged blob refused with nothing written; `mask.forget` drops the store and its cached
  blobs and answers `BUSY` while a version is open); Node 5 (`tests/app/project-store.test.mjs`: delete removes only that folder and refuses
  `..`, absolute names, device names and other shapes; `BUSY` keeps the folder, a stopped engine does not; a delete stopped after the rename is
  finished at the next start; copy pages each version once, copies the sources record and the project's copy of the source, which survives the
  first project's deletion; a failed copy writes no record); desktop (`tests/e2e/tiled-sections.mjs`): a manifest moved away and the engine
  restarted: the section opens locked with the message, no table, its record saved back byte for byte while another section's rename is saved;
  with the manifest back it is identical to the saved one; the same project imported as a file and both versions kept: the kept copy has its own
  stored version and opens unlocked and identical after a save of the imported one; deleting that copy from the library removes its folder,
  leaves the other project's folder and no `.deleting-*` folder. Not done: a delete or copy interrupted by killing the program (the rename-then-
  remove order and the manifest-last order are tested in Node and Python, not by a kill); the time to copy the versions of an `rgb8g`-sized
  section; macOS and Linux.
  Checks on Windows (18 Nov 2026): `pytest` 881 passed, 9 skipped; `npm test` 462 passed; typecheck, `sync_version --check` and Ruff passed; `tests/e2e/desktop.mjs` with the engine experiment off and on and `tests/e2e/tiled-sections.mjs` passed. GitHub, earlier commits: `b3a80f2` (M8.4.18b) passed `tests` and *Desktop builds* on Windows, macOS and Linux; two runs of 18 Nov were cancelled because no macOS runner was available (nothing ran), and the rerun of `efc1ac4` passed.

##### M8.4.28 - Object operations right after reopening a tiled section — state: Done (19 Nov 2026, development gate; written 18 Nov 2026 for finding 1 of M8.4.18a)

- **Goal:** after a tiled section is reopened, an object operation (delete, merge, scissors, same-ichnotaxon groups) on an object waits only for
  that object's tiles instead of every tile of the section, and the statistics shown for an object are never a partial sum of its tiles.
- **Why, from the code (18 Nov 2026):** `tiledPlan` refuses with "try again in a moment" while the section's `TiledStatsRunner` has anything pending,
  and after a reopening every stored tile is pending (41 s at 3 %, 133 s at 10 % of the `rgb8g` tiles, about 0.11 s per tile: nine level-0 pixel tiles
  are read per tile). Meanwhile `onUpdate` publishes `TiledObjectStats.total(id)` as soon as one tile of the object is computed, so an object that spans
  several tiles shows (and a save would write) the sum of the computed tiles only. The saved statistics are correct; only the per-tile parts are missing.
- **Read first:** this card; `app/js/tiledit.js` (`TiledObjectStats`, `TiledStatsRunner`); in `app.js`: `tiledStatsRunner`, `tiledPlan`,
  `eachObjectWindow`, `splitTiled`, `tiledSameTaxonGroups`, `finishTiledStroke`, `loadTiledSection`; M8.4.16 step 3 (decision of per-tile statistics).
- **Change:** `tiledit.js` (`TiledStatsRunner.prioritise(positions)` and `pendingIn(positions)`), `app.js` (readiness per object; the operations
  wait for their objects' tiles), `i18n.js` if a message changes, TECHNICAL_DOCUMENTATION (the statistics paragraph), tests.
- **Do not touch:** `tileStats` and `objectStats` (the numbers); the saved record; the order-independence of `total` (it sums in tile order).
- **Model:** most capable, effort medium (editing that could leave wrong statistics; checked by exact tests).
- **Steps:**
  1. *An object is current when none of the tiles under its source box (`o.sbox`, the saved one until it is recomputed, joined with every box it had
     since) is pending in the runner.* `onUpdate` writes `o.stats`, `o.area`, the boxes and `o.feat` only for current objects; the others keep their
     saved values and are reported again when their last tile is done.
  2. *Priority.* `prioritise(positions)` moves those tiles to the front of the pending set. An operation that reads boxes asks for its objects'
     tiles first and, instead of refusing, waits for them with the busy indicator (cancellable with Escape; a failed tile still refuses with today's
     message); then it runs as it would have. A stroke prioritises the tiles of the objects it touched.
  3. *Saving* writes, for an object that is not current, its last current statistics (the saved ones after a reopening), never a partial sum.
- **Tests:** Node (`tests/app/tiledit.test.mjs`): with a queue of many tiles, an object spanning 4 tiles is current right after its 4 tiles, whatever
  their place in the queue; `onUpdate` never publishes a total that differs from the total over all of the object's tiles (property test over random
  queues and objects spanning 1-9 tiles, exact equality); a prioritised operation runs after its tiles and before the rest. Desktop
  (`tests/e2e/tiled-sections.mjs`): reopen, at once delete an object spanning two tiles: it is deleted, without "try again", and the table and
  objects then equal those of a section where the deletion happened before saving. Measure with `tools/measure_tiled_reopen.mjs` (new field): time from
  the reopening to a finished delete of one object spanning 2-4 tiles, at 3 % and 10 %. **Target, stated before measuring:** under 2 s in both cases
  (about 18 pixel tiles read); if missed, record it and ask.
- **Done when:** the tests pass, the measurement is recorded against the target; development gate.
- *As built (19 Nov 2026):* `tiledit.js`: `TiledStatsRunner` reports an object only when it is current (`isCurrent`: no tile under its box,
  `tilesOf` given by the page from `o.sbox`, nor queued for it since its last report, `waitsFor`, is waiting, being computed or failed; an
  object whose box is unknown is current only when nothing waits), keeps the others in `deferred`, and `prioritise(positions)` moves tiles to
  the front and resolves after reporting; `tilesUnder`. `app.js`: `objectsReady` (delete, clearing candidates, merge, class change with the
  merge of V0.30, scissors) and `waitThenRun` (busy indicator "Computing the objects concerned…", Escape cancels, the operation runs again if
  the same section is open), `prioritiseObjects` after strokes and operations; `tiledPlan` checks only the objects' own tiles. **Found by the
  measurement and fixed in the card:** with the statistics current, the delete was still refused with "Loading the masks of this area; try
  again" because the page had dropped mask tiles under the object, and nothing ran it again (first run: not done after 18 min); `objectsReady`
  now reads those tiles back in the same wait. Measured (`tools/measure_tiled_reopen.mjs`, field `deleteAtOnce`, an object over four tiles
  deleted as soon as the project is open, `rgb8g`, Windows): **387 ms at 3 % (367 tiles waiting) and 397 ms at 10 % (1,129 waiting), target
  under 2 s: met** ([3 %](validation/M8.4.28-reopen-3pct.json), [10 %](validation/M8.4.28-reopen-10pct.json)); the tool now saves the project
  after the first reopening, because its painting hook (`putMaskTile`) does not compute statistics and objects saved without a box wait for
  every tile. Tests: Node 6 (`tilesUnder`; an object over 4 tiles current right after them wherever they are queued; property test over 8
  random queues and objects of 1-9 tiles: every published total equals the total over all tiles, exactly; prioritised tiles first; an
  unknown box waits for everything; an edit beyond the box waits for its tiles); the same tests fail when every object counts as current.
  Desktop (`tiled-sections.mjs`): a delete waits for its object's tiles and then runs by itself (it used to refuse); reopened, an object over
  two tiles deleted at once while 7 tiles wait, masks, objects and table equal to the same deletion with every statistic current; the same
  after the page dropped the clean mask tiles; never "try again". `app.js`: 5,301 lines before, 5,347 after (+46: wiring and the two wait
  functions; they move out with M8.4.30). Full checks (Windows): `py -3.12 -m pytest -q` 881 passed / 9 skipped; `npm test` 467 passed;
  typecheck (no new diagnostics); `sync_version.py --check`; `ruff check`; `desktop.mjs` with the engine off and on; `tiled-sections.mjs`. Incident: one run of `tiled-sections.mjs` failed at its first save (the tiled section left out by
  the settle deadline, D1) while four review agents were reading the repository; the rerun passed; not reproduced. Not done: macOS, Linux.

##### M8.4.31 - The store and the saves keep every committed version — state: Done (19 Nov 2026, development gate; council audit of 19 Nov 2026)

- **Goal:** a clean-up of the mask store can never delete a version the page committed, whatever the timing, and two saves never run at once.
- **Why (checked in the code):** `saveToDB` starts `retainStore()` without waiting; `retainStore` names the saved version and
  `MaskSync.manifest` as they are at that moment, and `MaskStore.retain` deletes every other manifest, protecting only open staged versions.
  A commit the engine has already processed, whose answer the page has not received yet, is therefore deleted; the next save names it and
  the reopened section is locked without its last edits (ARCHITECTURE §3.4: "the last good save stays readable"). Separately, `saveToDB`
  lets a second waiter start a save while the first waiter's save is running (`if (!dirty && !savePromise)` after `await savePromise`), and
  `settleTiledSections` sets `_tiledRecord = null` under the other save.
- **Read first:** `saveToDB`, `settleTiledSections`, `retainStore` in `app.js`; `tiledsync.js` (`MaskSync`); `store/masks.py` (`retain`,
  `commit`); `engine/server.py` (mask operations); contract §8.7.
- **Change:** engine: `mask.retain` also keeps every manifest committed by this engine process after the newest version the request names
  (the coordinator keeps, per project, the manifests it committed in order; a retain keeps those after the most recent one named in `keep`),
  documented in contract §8.7; page: `saveToDB` as a single-flight loop (one save at a time; a request during a save makes exactly one more
  save afterwards). Tests and documents.
- **Do not touch:** the store format; what a save writes; the retention of M8.4.18a otherwise (older versions are still deleted).
- **Model:** most capable, effort high (saving and recovery; a mistake loses user work).
- **Tests:** Python: a commit processed before a retain that names only its parent: the new manifest and its blobs survive; a retain naming
  the newest one deletes the older ones as before; an engine restart (no session record) keeps today's behaviour. Node: concurrent calls of
  the single-flight save run one after another and end with the last state saved (a stub store that records overlapping calls). Desktop
  (`tiled-sections.mjs`): continuous edits with a save every 200 ms for 20 s, then reopen: identical to the last saved state, the store
  holds only the saved versions after a final save.
- **Done when:** the tests pass; development gate.
- *As built (19 Nov 2026):* engine: the coordinator records, per store folder and section, the manifests it commits in order
  (`session_commits`); `mask.retain` keeps those after the newest one its `keep` names (all of a section's when it names none) and shortens
  each record to the newest named one (`recent_commits`; `MaskStore.retain(keep, protected, recent)`, a recent manifest already gone is
  skipped); `mask.forget` drops the project's record; contract §8.7. Page: `singleflight.js` (one run at a time; a request made during a run
  waits and runs again only if a revision changed after that run started) used by `saveToDB` with a change counter incremented by
  `markDirty`. The revision, not `dirty`, decides because the desktop test showed that a save which cannot store a tiled section leaves the
  project dirty and every waiting request repeated it until its 15 s deadline (88 queued requests: one save every 15 s). Tests: Python 4 (a
  commit before a retain naming its parent survives with its tiles, and goes once named; two sections interleaved, each followed on its own;
  after an engine restart only what is named stays; `mask.forget` clears the record); the M8.4.27 copy test now runs its retain of the first
  project from a new engine process, which keeps its purpose (the copy is untouched). Node 5 (`tests/app/singleflight.test.mjs`: requests
  during a save give one more save, never two at once, ending with the last state; nothing changed: no further save; 20 random interleavings;
  a failed save is reported and the next one runs; a stuck save is not repeated by 20 waiting requests); two of them fail with the previous
  algorithm. Desktop (`tiled-sections.mjs`): edits and saves overlapping for 20 s (176 edits, 88 saves requested, none awaited): after a final
  save the store holds exactly the saved versions and the reopened masks are the last saved ones. **Test fixed on the way:** the engine-kill
  step of card M8.4.16 failed four times in a row on this computer, also on the unchanged previous commit (`f3fa8ce`): a save started by the
  earlier edits committed a round during the stroke (measured: two manifests during a 1.7 s stroke), depending on how long the process lookup
  before it took; the step now saves and waits for the masks to settle right before the stroke and compares with the version from just before
  it (the assertion is unchanged, its precondition is now deterministic). **Incident:** one run failed afterwards at the M8.4.27 step "the
  deleted project's folder is gone" right after the new 20 s block; the next run passed whole; not diagnosed (the most likely cause is a
  rename of the project folder refused for a moment on Windows after hundreds of files were written, for which card A2 adds a retry; the
  program then shows "the folder was not deleted", no data is lost). `app.js`: 5,347 lines before, 5,352 after (the import, the counter and
  the wiring). Full checks (Windows): `py -3.12 -m pytest -q` 885 passed / 9 skipped; `npm test` 472 passed; typecheck; `sync_version.py
  --check`; `ruff check`; standalone build; `desktop.mjs` with the engine off and on; `tiled-sections.mjs` passed (after the fixes above).
  Not done: macOS, Linux; a measured interleaving of a real commit and a real retain in the desktop program (the Python tests drive the
  coordinator in that order deterministically).

##### M8.4.32 - The tiled tests run on GitHub on three systems — state: Done (20 Nov 2026, development gate; Desktop builds run 44741543925)

- **Goal:** the milestone gate covers the tile store: `tests/e2e/tiled-sections.mjs` and `tests/e2e/interrupted-saves.mjs` run in the
  *Desktop builds* workflow on Windows, macOS and Linux, on a fixture generated in the job, and the Python tests of the store cannot skip
  silently there.
- **Why:** both tests run only on the maintainer's computer today; the "milestone gate passed on three systems" says nothing about saving
  and reopening tiled sections, the riskiest code of part C. The Python store tests use `importorskip('pyvips')`.
- **Read first:** `.github/workflows/desktop*.yml`, `tests.yml`; the start of `tests/e2e/tiled-sections.mjs` (its image and fixtures);
  DEVELOPMENT §3 and §8.
- **Change:** a small generator of the test image (a few thousand pixels on a side, written by the test itself or a script in `tools/`);
  the two tests in *Desktop builds*; `SEDCORETOOL_REQUIRE_PYVIPS=1` in CI turns the skip into a failure; DEVELOPMENT.
- **Model:** most capable, effort medium (CI on three systems; a broken workflow blocks every gate).
- **Before it:** done on 20 Nov 2026 (the retries of card A2 and the race in the folder-deletion step of `tiled-sections.mjs`; two
  consecutive runs passed after the fix).
- **Tests:** the workflows themselves: one green run on three systems, and one deliberately failing run (a broken assertion on a scratch
  branch) that shows red.
- **Done when:** both workflows pass on three systems with the two tests in them; development gate (it changes what the milestone gate means).
- *As built so far (20 Nov 2026):* `tests/e2e/interrupted-saves.mjs` already runs inside `tests/e2e/desktop.mjs` (`verifyInterruptedSaves`),
  so only `tests/e2e/tiled-sections.mjs` was missing: it is now a step of *Desktop builds* on Windows, macOS and Linux (under `xvfb-run` on
  Linux). Its image is the public example `examples/data/idealized_core_0-500cm.jpg`, so no fixture is generated; its only Windows-only part,
  the lookup of the engine's process before it is killed, is `findCoordinator` (PowerShell on Windows, `ps` elsewhere). `tests/conftest.py`
  `require_pyvips()` replaces `pytest.importorskip("pyvips")` in the four tile-store test files; the tests workflow sets
  `SEDCORETOOL_REQUIRE_PYVIPS=1`, so a missing pyvips fails there instead of skipping. Local check: the four files pass in strict mode (63),
  `tiled-sections.mjs` passes on Windows with the helper. **First run on GitHub (`5ee27c1`, run 44649801733): failed on all three systems,
  in the test, not the program:** on macOS and Linux the first save left the new tiled section out (D1: its first mask round needs more than the
  save's deadline on those machines); on Windows the scissors cut one piece where two were expected (an object operation now waits for its
  objects' statistics and runs by itself afterwards, card M8.4.28, and the test's idle wait did not include that wait). Fixed in the test: the
  first save waits for the masks to settle; the idle wait includes the page hook `objectsWaiting`. Found locally the same day and fixed in
  the program (`deleteStoreOf`): a send round on its way after many edits could outlast the 3 s the delete gave it, so the project folder
  stayed («the folder was not deleted»); the delete now lets it finish, up to 60 s, and the test's wait follows that bound. Pending: a green run
  on three systems, and the deliberately failing run.
- *GitHub runs of 20 Nov 2026 (`tiled-sections.mjs`, Desktop builds):* (1) macOS and Linux: the first save happened while the test project
  was still loading (`saveBlockers().loading`); fixed, the test waits for the load. (2) Windows, every run: the scissors do not cut, with the
  message "The line does not split the trace: it must cross it from side to side." (lasso at the same screen positions correct, area 6000;
  canvas 862 × 1665). A fixed window of 884 × 561 did not change it and was removed. Locally a window of 884 × 1700 lets the scissors pass
  (and then fails the final comparison of labels, line 667), so the window height alone is not the cause; not diagnosed. (3) macOS and Linux,
  after the load fix: the pixel probe draws [106,79,35] where the source is [14,14,14] (sx 230, sy 570), tile state not cached, not in
  flight; first time the probe runs on those systems; not diagnosed. Next: record the scissors' input polyline and the section under the
  pointer on Windows, and a screenshot of the probe on macOS/Linux as a workflow artifact.
- *Diagnosis and result (20 Nov 2026):* screenshots of failed steps, uploaded as the artifact `tiled-shots-<os>`, showed three causes, all
  in the test: (a) the test project's load ended after the large image was added and selected its first section, so the probe and the strokes
  met another image (the test now waits for the load after the six sections appear and checks that the tiled section is current); (b) on
  GitHub's taller windows the canvas pane scrolled by about 29 px between the lasso and the scissors, so a canvas position measured once put
  the cut inside the trace (measured before every stroke now); (c) the idle wait did not include a tiled wand still reading pixels, so the
  next step could run first (`objectsWaiting` in `tiledtools.js` now includes it; found locally once the timing changed). On macOS, 100 ms
  timers took about 135 ms, so the 20 s edit-and-save race gave 148 edits: it now counts 150 edits and 75 saves, thresholds unchanged.
  **Result:** `tests` and *Desktop builds* green on Windows, macOS and Linux on commit `4a20dfd` (runs of 20 Nov 2026). The failing runs of
  the same day (44725565822 and four more) showed red at this step, which stands for the deliberately failing run of the card.

##### M8.4.33 - Backups and packages say what they leave out — state: Done (20 Nov 2026, development gate; council audit of 19 Nov 2026)

- **Goal:** until M8.4.18c and M8.4.18d carry tiled sections, a folder backup, a full backup or an exported package of a project with tiled
  sections tells the user, before writing, which sections it leaves out, and records them in the package.
- **Why (checked):** `projectForExport` drops tiled sections with no message; the backup state then reads as done.
- **Change:** `app.js` wiring (or the module of M8.4.30 if it is done first), `i18n.js` (Spanish and English), a `left_out` list in the
  package's project record (documented in TECHNICAL_DOCUMENTATION §23-24; readers ignore unknown fields), tests.
- **Model:** fast tier, effort medium (bounded; checked by exact tests).
- **Tests:** desktop: a project with one tiled and one ordinary section: the backup and the package show the message, contain the ordinary
  section and name the tiled one in `left_out`; a project without tiled sections is byte-for-byte as today.
- **Done when:** the tests pass; development gate.
- *As built (20 Nov 2026):* `projectForExport` names the tiled sections it leaves out (`left_out: [{core, section}]`, only when there are
  some) and returns them; `tellLeftOut` shows the message before a package is written (every time) and before the automatic folder copy
  (once per project in a session, because that copy runs after every save). Tests: desktop (`tiled-sections.mjs`: the packaged project has the
  six ordinary sections, no tiled one, one `left_out` entry, and the message is shown; `desktop.mjs`: a project without tiled sections has no
  `left_out`). Two page hooks for the tests (`exportedProject`, `packageNow`). The full backup of every project uses the same function.

##### M8.4.30 - The tiled-section controller leaves `app.js` — state: Done (20 Nov 2026, development gate; size target replaced by decision R, approved)

- **Goal:** the tiled-section workflow lives in its own controller modules, `app.js` only wires them, and `app.js` is back below its size of
  13 November 2026 (4,344 lines); no behaviour changes.
- **Why:** part C added about 40 functions and 991 lines to `app.js` against AGENTS §4 ("`app.js` only shrinks"); M8.4.29, M8.4.18c and
  M8.4.18d would add more. A reviewer must find the tiled behaviour without reading 5,000 lines.
- **Read first:** ARCHITECTURE §3.2 and §5.2 (moving a workflow out of `app.js`); in `app.js` every function from `startTiledStroke` to
  `level0Rgba`, `tiledStatsRunner`, `tiledCounts`, `analyzeTiled`, `maskSync`, `maskLoader`, `loadTiledSection`, `storeLocked`,
  `deleteStoreOf`, `copyTiledStore`, `reopenLocated`, `objectsReady`, `prioritiseObjects`; `tools/build_standalone.py` (`ORDER`).
- **Change:** new controller modules (proposed split: `tiledtools.js` strokes, wand, lasso, scissors and object operations; `tiledstate.js`
  runners, sends, reads and analysis of one section; `tiledproject.js` reopening, locks, store copy and delete), each receiving what it needs
  from `app.js` through one explicit context object (state, `toast`, `afterChange`, `requestRender`, the bridge); `app.js` wiring;
  `ORDER`; ARCHITECTURE §3.2 (the controller table and the stale "about 4,200 lines") and the source map; a check that fails when `app.js`
  grows beyond a recorded ceiling (`tests/app/app-size.test.mjs`, ceiling lowered by each card that shrinks it); second council: the same
  test file checks the layer rules of ARCHITECTURE §3.2 for JavaScript as `tests/test_architecture.py` does for Python (no DOM globals in
  the pure modules, no pure module importing a controller; `tableview.js` moves to the controllers' list or loses its DOM use) and reports
  the import cycles between controllers.
- **Do not touch:** any behaviour, message, saved field or test expectation; the pure modules; the whole-section path.
- **Model:** most capable, effort medium (a large move through editing and saving code, where a wiring mistake could lose user work; checked
  by the existing exact tests).
- **Steps:** one module per commit, each with the full desktop test passing: (1) `tiledproject.js`; (2) `tiledstate.js`; (3) `tiledtools.js`;
  (4) the size check and the documents. Names are moved, not rewritten; a function that needs a change to move stops the card (ask).
- **Tests:** unchanged `npm test`, `npm run typecheck` (no new diagnostics), `tests/e2e/tiled-sections.mjs`, `tests/e2e/desktop.mjs` with
  the engine off and on; the new size check.
- **Done when:** `app.js` has fewer than 4,344 lines, every test passes unchanged, the standalone build works; development gate.
- *As built (20 Nov 2026):* four controller modules, each receiving what it needs from `app.js` in one context object (getters for values
  that change, such as the drag in progress, the view and the save deadline): `tiledproject.js` (reopening, locks, store folder, the store's
  part of a save), `tiledstate.js` (statistics runner, row counts, pixel and mask reads, mask sends), `tiledtools.js` (strokes, undo and redo of
  tiled edits, wand, lasso, scissors, object operations), `tiledview.js` (working image, tile cache and schedulers, mask overlay, build
  dialog). Code moved, not rewritten; `sourceBox` and `sourceRoi` stay in `app.js` because two modules use them. `app.js`: 5,390 → 4,666 lines.
  `tests/app/architecture.test.mjs`: the lists of ARCHITECTURE §3.2 name existing files; pure modules use no DOM and import no controller
  (`tableview.js`, which uses the DOM, moved to the controllers); `app.js` at or below 4,666 lines. Checks: after each step `desktop.mjs` with
  the engine off and on and `tiled-sections.mjs` passed (Windows); full checks in the status. **Not met: fewer than 4,344 lines.** The
  tiled-section code that remained in `app.js` was about 770 lines; the rest of part C's growth (saving, tests hooks, the import, unit and
  class changes of cards Q1-Q4) is not tiled-section code. Decision R (proposed): accept 4,666 as the new ceiling, lowered by each later card
  that moves a workflow (U1-U3 move dialogs and messages; A2 moves runtime caches), instead of a further move now.

##### M8.4.29 - Reopening without reading every stored tile — state: Done at the development gate (20 Nov 2026, Windows); decision G approved by the maintainer on 19 Nov 2026 (written 18 Nov 2026 for finding 3 of M8.4.18a)

- **As built (20 Nov 2026).** `tiledcache.js` (format, encode, decode with every check, `statsCover`), `mask.derived.put` / `mask.derived.get` in
  `masks.py` and `server.py` (limit 128 MiB, stated before measuring), `mask.retain` removes the files of removed manifests, `engine.js`,
  `tile-ipc.js`, `preload.js`, `TiledRowCounts.snapshot` / `restore`, writing after a save (`writeReopenCaches`) and reading in `loadTiledSection`
  (`tiledproject.js`). `app.js` stays at 4,666 lines (one test hook added on an existing line). Format and checks: TECHNICAL_DOCUMENTATION
  («Reopening cache»); operations: contract §8.7. Two rules beyond the card: a cache is also refused when the totals of its statistics disagree
  with the record's objects, and none is written (or accepted) when a labelled tile has no statistics, so that a section saved without statistics is
  still rebuilt once.
- **Measured** (Windows, Ryzen 7 7700X, `rgb8g`, `tools/measure_tiled_reopen.mjs`; records `docs/validation/M8.4.29-reopen-3pct.json` and `-10pct.json`):

  | Fill | Open + table without cache | Open + table from cache | Statistics current without / from cache | Cache on disk / unpacked |
  |---|---|---|---|---|
  | 3 % (368 tiles, 4,369 objects) | 5.1 s | **0.53 s** | 37.8 s / 0.53 s | 0.6 MB / 2.4 MB |
  | 10 % (1,130 tiles, 13,513 objects) | 11.7 s | **1.43 s** | 92.7 s / 1.43 s | 1.8 MB / 7.3 MB |

  Targets stated in the card (under 3 s at 10 %, statistics current when the project opens): **met**. The 128 MiB limit is about 17 times the 10 % cache.
- **Checks:** `npm test` 521, `pytest` 891 passed / 9 skipped, typecheck, standalone build, `desktop.mjs` engine off and on, `tiled-sections.mjs` with
  the cache written, used, damaged (refused, rebuilt) and absent. Not run: `smoke.mjs` (needs a local server, refused by the permission system);
  macOS and Linux (milestone gate, GitHub); `ruff` (not installed on this computer).

- **Goal:** reopening a saved tiled section does not read its stored tiles to rebuild what the page derived from them: the row histograms of
  M8.4.17, the reduced copy of the masks and the per-tile object statistics come back from a cache saved with the stored version, and are rebuilt
  from the tiles only when that cache is missing, stale or does not pass its checks.
- **Why:** M8.4.18a reads every stored tile once on reopening; that is most of the 4.6 s (3 %) and 10.8 s (10 %) to open the `rgb8g` section, and the
  object statistics then need 41-133 s more (M8.4.28 makes that wait local; this card removes it in the common case).
- **Decision G (proposed by the design session; approved by the maintainer on 19 Nov 2026):** the cache is an extra file per stored version in the engine's mask store
  (`derived/<manifest>.<kind>`), written by the page through two new operations (`mask.derived.put`, `mask.derived.get`, contract §8.7) and removed
  by `mask.retain` together with its manifest. It is a cache, not part of the project: its absence or rejection only costs time. *Alternatives:* in the
  IndexedDB record of the project (tens of MiB per section in the record, read on every library listing that loads the project, and outside the store
  that the backups of M8.4.18c copy); in a separate IndexedDB store (bound to the browser, ARCHITECTURE §3.4, and not removed by `mask.retain`).
- **Read first:** this card and G; M8.4.18a as built (`loadTiledSection`); `app/js/tiledcounts.js` (`TiledRowCounts` histograms); `app/js/tiledmasks.js`
  (`reduceTile`); `app/js/tiledit.js` (`TiledObjectStats`); contract §3 (buffers) and §8.7; `store/masks.py`.
- **Change:** contract §8.7 first; `store/masks.py`, `engine/server.py` (the two operations; `retain` and the size limits); `desktop/engine.js`,
  `tile-ipc.js`, `preload.js`; a new pure module `app/js/tiledcache.js` (encode and decode, no DOM, in `ORDER` of `tools/build_standalone.py`);
  `app.js` (write the cache when a save has settled, read it in `loadTiledSection`); TECHNICAL_DOCUMENTATION (the cache format); tests.
- **Do not touch:** the record of M8.4.18a; the tile and manifest format; the numbers (histograms, statistics, reduced masks must be identical to
  the ones rebuilt from the tiles).
- **Model:** most capable, effort high (new stored data read back as untrusted input; an engine contract change).
- **Steps:**
  1. *Format* (documented, versioned, little-endian): a header with the format version, the manifest's SHA-256, the source's SHA-256, the working
     factor `ds`, the analysis area's columns the histograms were clipped to, and the SHA-256 of the body; then three parts: histograms by tile,
     reduced copy (labels and exclusion at the working size), per-tile statistics by tile and id. Any mismatch with the section being opened (manifest,
     source, `ds`, sizes, version, hash, a count or offset outside the body) rejects the whole cache, never part of it.
  2. *Writing:* after `settleTiledSections` has settled a section and the record names its manifest, the page writes the cache for that manifest
     unless one exists; a failure is logged and ignored (the save itself already succeeded).
  3. *Reading:* `loadTiledSection` asks for the cache first; if accepted, it fills the reduced copy, `TiledRowCounts` and `TiledObjectStats` from it
     and lists the stored tiles without reading them; if the analysis area's columns differ, only the tiles of the changed columns are read (as
     `setArea` does today). If rejected or missing: today's path, and the cache is written after the next save.
  4. *Limits:* `mask.derived.put` refuses a body above a stated size (from the measured size of the 10 % case, with margin) and unknown kinds.
- **Tests:** Node: encode and decode round trip; every rejection case (wrong manifest, source, `ds`, version, hash, truncated, an offset past the end,
  counts that do not add up) falls back to the tiles with identical results; a property test that histograms, reduced copy and statistics from the cache
  equal those rebuilt from the tiles over random masks. Python: put, get, retain removes the cache with its manifest, size limit. Desktop: reopen with
  the cache equals reopen without it (masks, objects with statistics, table), and a corrupted cache file falls back. **Measure** with
  `tools/measure_tiled_reopen.mjs` at 3 % and 10 %: the time to open with the table and the cache's size. **Targets, stated before measuring:** open
  with the table under 3 s at 10 %, and object statistics current when the project opens; if missed, record and ask.
- **Done when:** decision G is answered, the round trip is identical with and without the cache, the rejections are tested, and the times are recorded
  against the targets; development gate.

##### M8.4.35 - Failures of `tiled-sections.mjs` on GitHub — state: In progress (20 Nov 2026)

- **Goal:** `tiled-sections.mjs` passes on GitHub's Windows, macOS and Linux runners on one commit, so that the milestone gate of part C can be run.
- **Origin:** *Desktop builds* failed on `3b0f7dd`, `00ca21b` and `12ff7cc` (macOS) and `f063434` (Linux): (i) a 30 s timeout waiting, by animation
  frames, for the mask round to be on its way before the engine is killed (a hidden window may not run frames, and the round may commit before the
  wait sees it); (ii) `reopen()` found no tiled section after a reload (`grey: null`, the same reopen after "reopened from the copy" every time,
  and once in four local runs on Windows).
- **Read first:** `tests/e2e/tiled-sections.mjs` (the engine kill of card M8.4.16 step 5; `reopen()`); `app/js/tiledsync.js` (`round`);
  `loadProject` and `loadTiledSection`.
- **Change:** `tests/e2e/tiled-sections.mjs`; a test-only hook `beforeCommit` in `tiledsync.js` (null in the program); the cause of (ii) once known.
- **Do not touch:** the thresholds and the scenarios of the test (AGENTS §3 item 7).
- **Model:** most capable, effort medium (an intermittent failure whose cause is not known).
- **Steps:** (1) hold the round before its commit with the hook, then kill the engine: no race; (2) make `reopen()` report why the section is not
  there (load result, console errors, toast, what the stored project holds); (3) find and fix the cause of (ii) from that evidence; (4) GitHub
  green on the three systems.
- **Tests:** a unit test of the hook (`tests/app/tiledsync.test.mjs`); the end-to-end test itself.
- **Done when:** *Desktop builds* passes on Windows, macOS and Linux on one commit with this card's changes.

##### M8.4.34 - Desktop hardening — state: Done at the development gate (20 Nov 2026, Windows; council audit of 19 Nov 2026)

- **As built.** `main.js`: `safeExternalUrl`, `isAppNavigation`, a `Content-Security-Policy: script-src 'self' 'wasm-unsafe-eval'` header on every `.html`
  of `app:` (added to the page's `<meta>` policy, which keeps the two CDNs for the browser build, so the browser build is unchanged), navigation
  guards on every window, `confirm` message box. `tile-ipc.js`: `opened` / `known` sets, `announceProjects`, the guards of delete, copy and retain.
  `engine.js`: `STORE_DEADLINES_MS`. `app.js` stays at 4,666 lines. Documented in SECURITY.md, technical manual §28 and contract §8.7.
- **Decisions of the design that the card left open, approved by the maintainer on 20 Nov 2026 ("apruebo … lo de M8.4.34"), as built:** (1) the main process cannot read the page's library, so the
  page announces its listing (`announceProjects`); a script could announce too, which is why a store that was only announced needs the user's
  answer in a window of the main process (default Cancel) and an unknown identifier is refused; (2) deleting a project from the library that was not
  opened in this session therefore shows that window once (the page's own confirmation comes first); (3) `mask.retain` is limited to projects
  opened in the session; (4) the deadlines (30-300 s) were chosen with a margin, not measured on a slow disk (stated in the contract).
- **Checks:** `npm test` 529, `pytest` 891 / 9 skipped, typecheck, standalone build, `desktop.mjs` engine off and on (with the new block: a remote script
  is blocked by the policy, `location.href = 'https://…'` does not navigate, `window.open` of `file:`, `javascript:`, `data:` and another `app:` host
  opens nothing), `tiled-sections.mjs` passed in 3 of 4 runs; the failing run stopped in a reopening with the section not found afterwards
  (`grey: null`), was not reproduced in the next three runs and is not explained. Not run: `smoke.mjs` (local server refused), macOS and Linux (GitHub),
  `ruff` (not installed). Not tested: that `shell.openExternal` is not called (it cannot be observed from the page); the unit tests cover the filter.

- **Goal:** a script injected into the page could not load remote code, open arbitrary programs or delete another project's store, and a
  slow disk does not kill the engine in the middle of a commit.
- **Why:** the page's content security policy allows any script from `cdn.jsdelivr.net` and `cdn.sheetjs.com` (the desktop build already
  carries its libraries); `setWindowOpenHandler` passes any non-app URL to `shell.openExternal` whatever its scheme (`desktop/main.js`); there
  is no `will-navigate` guard; `deleteProjectStore` and `copyProjectStore` accept any well-formed project identifier; every store operation
  has the 5 s default deadline, after which the engine is stopped (`desktop/engine.js`). About 120 `innerHTML` sites make an injection
  plausible enough to close these doors.
- **Read first:** `desktop/main.js`, `desktop/tile-ipc.js`, `desktop/engine.js` (deadlines), `app/index.html` (policy), SECURITY.md,
  TECHNICAL_DOCUMENTATION §28.
- **Change:** a desktop policy without remote script origins (the browser build keeps its own, with SRI); `openExternal` for `https:`,
  `http:` and `mailto:` only; `will-navigate` and `will-redirect` denied outside the app origin; the project-wide store operations accept
  only identifiers of projects the main process has seen in this session's library listing or that the page created, and ask the user before
  deleting a store the page did not open; per-operation deadlines for store operations (measured, stated in the contract) instead of the
  general 5 s; SECURITY.md and §28.
- **Do not touch:** compatibility identifiers (AGENTS §3 item 4); the engine protocol's messages.
- **Model:** most capable, effort high (security against hostile input).
- **Tests:** Node tests of the scheme filter, the navigation guard and the identifier check; the desktop test opens a `file:` and a
  `javascript:` link and nothing happens; a store operation slowed by a test hook past 5 s completes without an engine restart.
- **Done when:** the tests pass; development gate.

##### M8.4.18c - Folder backup and restore of tiled sections — state: In progress (steps 1-2 done at the development gate, 20 Nov 2026, Windows; step 3 open)

- **Goal:** the folder backup (`writeProjectFolder`) carries tiled sections incrementally, and a project restored from it on another computer opens
  with identical masks.
- **Read first:** `writeProjectFolder`, `openProjectFolder` and the backup scheduling in `app.js`; M8.4.18a as built; contract §8.7.
- **Change:** `app.js` (backup and restore), `desktop/tile-ipc.js`, `preload.js`, `engine/server.py`, `store/masks.py` (operations to export a
  manifest's files into a folder the user chose and to import them with verification), contract §8.7, tests.
- **Do not touch:** the backup of other sections and its history rotation; the store format.
- **Model:** most capable, effort high (backup and recovery).
- **Steps:** (1) The backup folder of a project gets `tiles/<sha256>` files and `manifests/<sha256>.json`, copied only when missing (by name, which is
  the hash) and verified after writing; the history files of the backup keep naming their manifests, so an old `historial/<date>.json` still opens.
  (2) Restoring imports the tiles of the named manifest into the store, verifying every SHA-256 before use; a missing or corrupt tile refuses the
  section with its position, never a partial section. (3) The source follows D3: a copy in the project is backed up; otherwise only its identity.
- **Tests:** incremental backup copies only new tiles; a corrupt tile in the backup is refused at restore; a restore on an empty store (another
  computer, simulated by another user-data folder) opens identically; an interrupted backup leaves the previous backup openable.
- **Done when:** backup and restore round trip exactly on the desktop, with the failure cases above; development gate.
- **As built (steps 1-2, 20 Nov 2026).** The main process does not know where the folder the page chose is (a File System Access handle has no
  path), so the files travel through the page and the engine checks them at both ends: `mask.export` (a stored version's files exactly as stored,
  each verified first) and `mask.import` (each blob accepted only if it decompresses to bytes with its name's hash; the manifest only when every
  blob it names is stored), contract §8.7 with a "Backup folder" paragraph; `maskExport` / `maskImport` in `tile-ipc.js` and `preload.js`
  (deadlines 120 s); pure module `tiledbackup.js` (`backupTiledSections`, `restoreVersion`, `manifestBlobs`); `backupTiledOf` and `restoreTiledOf`
  in `tiledproject.js`; `projectForExport` keeps tiled sections for the folder copy only. `app.js` 4,666 lines before and after (two test hooks on
  an existing line).
- **Choices made in this card, for the maintainer to review:** (1) the files of the folder are the store's own zlib streams, in a flat `tiles/`
  folder; (2) the unit of "already copied" is the version: a manifest in the folder means its version is whole there (written last); (3) a version
  missing or damaged in the store is left out of that copy and named (`left_out`, told once); any other failure fails the copy, which is retried,
  and the previous `project.json` stays; (4) a version that cannot be restored leaves its section's record in the project, locked (card M8.4.27),
  and the message names the file; (5) nothing is ever deleted from `tiles/` and `manifests/` of the folder.
- **Answered by the maintainer on 20 Nov 2026 ("apruebo lo que recomiendas"):** (a) no clean-up of the folder for now; (b) «Open project folder»
  gets a choice of date (the current state or a day of `historial/`), restored with that folder's tiles and manifests; (c) step 3 is done: the
  automatic copy includes a source image kept in the project, written once, with its size told to the user before the first time.
- **Open (as asked before the answers):** (a) the folder grows with every version copied, because history files may name old versions: a
  clean-up of files that neither `project.json` nor any kept history file names is possible but deletes in the user's folder; (b) an old
  `historial/<date>.json` names versions that are in the folder, but «Open project folder» restores only `project.json`, and a history file
  imported on its own cannot read the folder: opening an older day needs a choice of date in «Open project folder» (small interface change);
  (c) step 3, the copy of a source image kept in the project (D3): it may be several GB, so it would travel from the main process to the page in
  pieces and be written by the page; on another computer it would be located (card M8.4.18b, verified by its SHA-256) and copied into the project.
- **Checks (steps 1-2, Windows):** `npm test` 537; `pytest` 896 passed / 9 skipped; typecheck; standalone build; `sync_version --check`;
  `desktop.mjs` with the engine off and on; `tiled-sections.mjs` passed (first run) with the new block: a backup into a folder of the origin's
  private file system holds the tiled versions (33 files), a second backup rewrites none of them, a restore in a second program with an empty
  profile opens the section with identical masks and objects (grey, the image is not there), a damaged tile refuses the section (locked, user
  told, no manifest in the store). Not run: macOS and Linux (GitHub), `ruff` (not installed), `smoke.mjs`.

##### M8.4.18d - Packages with tiled sections — state: after M8.4.18c (D4 answered: packages carry tiled sections, with ZIP64)

- **Goal:** a `.sedcoretool` package can carry tiled sections as D4 decides, streamed, without loading a whole image or mask into memory.
- **Read first:** `app/js/zip.js`; `projectForExport`, the package import path in `app.js`; M8.4.18c as built.
- **Change:** `zip.js` (ZIP64 writer and reader), the export and import of packages in `app.js`, tests.
- **Do not touch:** packages without tiled sections (byte for byte as today, so older builds keep reading them).
- **Model:** most capable, effort high (a file format read by other builds, hostile input).
- **Steps:** (1) ZIP64 in `zip.js` only when a size or offset needs it, with streaming CRC as today; reading checks every size and offset against the
  file and the import limits. (2) Export writes the tiles and manifest of each tiled section from the store, streamed, and the source when D4 says so.
  (3) Import goes through the restore of M8.4.18c.
- **Tests:** a package above 4 GiB written and read back (generated, streamed, in a temporary folder); a package without tiled sections is byte for
  byte unchanged; truncated and hostile ZIP64 records are refused without large allocations; desktop round trip.
- **Done when:** the round trip is exact for a section whose masks exceed 4 GiB in the package; development gate.

##### M8.4.19 - Milestone gate of part C — state: after M8.4.18d

- **Model:** fast, effort low (running and recording the gate); the most capable with effort high for the decisions that follow it.
- Windows, macOS and Linux on one commit (`tests` and *Desktop builds*, including the desktop end-to-end test with the engine experiment and the
  tiled flag on and off); the interactive targets measured on the primary host with the M8.4.13 fixtures; listed as not measured: a 16 GiB computer,
  an Intel Mac, clean machines, macOS and Linux timing. Then the decision on rule 6 (move small sections to the tiled path or keep both) and on
  promoting the flag (release gate).

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
- **Model:** fast, effort medium (measurements); the hash question goes to the maintainer.
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
  - Second council of 19 November 2026: card A1 (engine methods of core or project scope) is a prerequisite of slices (a) and (d).
  - Council audit of 19 November 2026 (card S5): slice (c) uses an established library (scikit-learn) as the implementation or as the
    reference (AGENTS §3 item 9), standardises inside each fold, groups by core by default and selects the method with nested cross-validation;
    slice (d) averages over intervals when the grid step is coarser than a record's spacing, reports the effective sample size and adds
    event-level and boundary-position errors to the multiproxy evaluation. Decision H applies to the JavaScript exceptions of tiled sections.
  - Acceptance per slice: independent reference fixtures, explicit provenance, unchanged public contracts; exact
    counts/masks/labels and predeclared tolerances elsewhere; figures and exports unchanged.
- [ ] **M8.6 - Promote desktop and retire duplicate computation.** After the release checklist passes: the engine
      becomes authoritative, migrated JavaScript calculations are removed from the desktop program, their role as
      reference passes to versioned fixtures, and the last supported HTML version is frozen with a tested
      export/import path for its stored projects.
  - Acceptance: one implementation per method; identical API, CLI and desktop results; complete desktop and
    interrupted-save regressions; storage identifiers and old project readers retained; documents and CI updated
    in the same delivery; engine errors stay visible; every earlier milestone gate passed.

## Council cards (audit of 19 November 2026)

Written from the council audit (status block). Each card names its model; the science cards change results only where a decision says so.

- [ ] **S1 - Unreviewed traces and the published numbers** (decision K, approved 19 Nov 2026). Default `countCandidates` and `includePred` off for new projects
      (existing projects keep their stored settings); the results table, the core column and every export show the share of the counted
      area that nobody reviewed, per interval and in total; the provenance lines of the CSV say both settings. *Model:* most capable, effort
      medium (changes default results). *Tests:* Node: a project with reviewed and unreviewed traces gives the unreviewed share exactly; an
      old project's stored settings are kept; Python parity of the counting with both settings. *Second council:* the breakdown
      (reviewed / predicted / unreviewed) is shown and exported whatever decision K says; only the change of defaults waits for K.
- [ ] **S2 - Detection in physical units and resolution in the provenance** (decision L, approved 19 Nov 2026). `minArea`, the adaptive window radius and the
      contrast ring of the descriptors in millimetres (converted with each section's px/cm); the smallest resolvable trace diameter shown per
      section; a warning when it exceeds a user-set target; each section's working resolution (px/cm) and factor `k` in the exported provenance.
      First a measurement: bioturbation percentage against px/cm (k = 1-6) on the public U1385 images and on a tiled section, reported before
      the change. *Model:* most capable, effort high (scientific defaults; results change). Before M8.4.19.
- [ ] **S3 - The adaptive threshold at high coverage.** Synthetic images with known coverage 0-100 % (burrows of several sizes, fills of
      several contrasts) measure the bias of the default detection; the result goes into TECHNICAL_DOCUMENTATION §8 and §32; a manual flag
      "homogenised interval" gives ii 6 and BI 6 regardless of the percentage, stored with the manual indices. *Model:* most capable, effort
      medium. *Tests:* the synthetic series as a fixed fixture with its measured bias recorded.
- [ ] **S4 - Uncertainty of a percentage.** A per-interval uncertainty for the bioturbation percentage (block resampling of columns of the
      core face, with the Delesse principle stated), written once in Python (engine) and shown and exported by the page; advice on interval
      thickness for large ichnotaxa. Belongs to M6 (M6.2) but may be brought forward. *Model:* most capable, effort high (new method).
- [ ] **S5 - Evaluation and resampling when the methods move to Python** (recorded in the M8.5 summary): classifier evaluation without
      leakage (fold-internal standardisation, grouping by core, nested selection), multiproxy resampling by interval averaging, effective n,
      event-level metrics; age-model ensembles in M6.5. No separate implementation before then; until then TECHNICAL_DOCUMENTATION §12.4 and
      §18 state the optimism.
- [ ] **S6 - Validation protocol on real cores** (M5.2, dated now). A design session with the maintainer writes the protocol: public cores
      (IODP U1385 first), two or more observers making expert masks, automatic against manual against visual BI/ii (error in percentage
      points, weighted kappa per interval), sensitivity to detection parameters and resolution, the classifier on reserved cores; and the U-Net
      training data rule (unannotated areas marked "ignore", to be checked in the export code). The measurements follow when the masks exist.
      *Model:* most capable, effort high (design). Can start at once; independent of M8.
- [ ] **U1 - One status layer in every mode.** One busy and progress region (`role=status`, above the start screen), visible in every mode,
      with Cancel where the operation allows it, the starting button disabled while it runs, and a list of notices that keeps warnings and
      errors until read (today one toast, replaced by the next, 3-12 s). *Second council:* one long-task component replaces `busy()`
      (progress, Escape to cancel, no second start while one runs; heavy work off the page's thread where it can be, as the filters' worker
      already is), used by detection, a change of resolution, "Apply to all sections" and PNG export; the multiproxy progress bar is the model.
      *Model:* most capable, effort medium (error visibility of saving and backups). After M8.4.30.
- [ ] **U2 - Destructive actions.** One accessible confirmation dialog that names what is lost (with counts) and defaults to the safe button,
      used for: deleting a project (which also deletes its masks on disk), records, manual data columns, "Apply to all sections"; the import of
      a project that already exists offers Replace, Keep both and Cancel (today OK replaces and Cancel imports a copy); a recoverable deletion
      (a trash or "undo the last deletion") for projects, records and columns. *Second council:* also "Apply to all sections" (which
      overwrites enhancement and detection), a change of resolution of all sections and rotation (both discard the undo history today) and
      deleting a column of the data sheet; undo by domain (a command and its inverse) for data cells, interval layers and figure settings, so
      that most actions need no dialog. *Model:* most capable, effort high (editing that could lose user work). After M8.4.30.
- [ ] **U3 - Keyboard, focus and the accessibility claim.** The start screen as a real modal layer (workspace inert, focus moved and
      restored); the selected tab highlighted in the start-screen and model-dialog tab bars (`.htabs .btn[aria-selected=true]`, checked
      missing); control borders and the dark error colour at their contrast targets; a name for the image canvas; tab roles in multiproxy and
      figures; the guided tour as a dialog; an automated accessibility check (axe) in the browser test; TECHNICAL_DOCUMENTATION §29 rewritten
      to state only what is measured; a colour-blind-safe default palette for classes or patterns. *Model:* fast tier, effort medium.
- [ ] **U4 - One definition per interface text.** `i18n.js` built from 192 layers has 85 keys defined twice (the last wins): one definition
      per key; a Node test that fails on a duplicate key or on a key missing in Spanish or English; stale texts corrected ("Pixels per bin",
      ".corantool.json", the brand tooltip, the Spanish-only backup file name); the shortcut list generated from the table that maps keys to
      tools. *Model:* fast tier, effort medium.
- [ ] **U5 - Styles out of the page.** The 680-line stylesheet of `index.html` into its own file with named colour tokens, without the
      duplicate declarations, `!important` utility classes `u1`-`u29` and literal colours; no visual change (screenshots compared in the browser
      test). Then a task-based usability test with three to five sedimentologists (import, detect, edit, classify, export; time and errors),
      run by the maintainer, before any redesign. *Model:* fast tier, effort low for the move.
- [ ] **D2 - Documents agree with the code.** TECHNICAL_DOCUMENTATION §3.2 says the no-data rule uses `N · width`; the code uses the
      interval's actual rows (`(r1 − r0) · width`): correct the text; a last interval of fewer than half `N` rows is flagged in the results and
      exports; §4 labels the BI 0 and ii 5-6 limits as operational conventions; ARCHITECTURE no longer calls the tile store "planned" where it is
      built (with M8.4.30, which updates the `app.js` size). *Model:* fast tier, effort low (the flag of the last interval is a small code change
      with a test).

### Cards of the second council (19 November 2026)

- [x] **Q1 - Deleting an ichnotaxon (P0).** Done 19 Nov 2026 (development gate); *As built* below. Today the ✕ of a class acts on the open core's sections only, with no confirmation and no undo,
      and discards the undo history; the traces of the other cores keep the deleted class's id. Change: the deletion reaches every core of the
      project (`S.cores`), the confirmation names the number of labelled traces and examples in the whole project, the class is kept in a
      recoverable list (or the deletion is one undo step); opening a project reports and repairs traces whose class does not exist (they
      become unlabelled, counted in a message). The logic goes in a module (AGENTS §4), `app.js` wires it. *Model:* most capable, effort medium
      (it can lose expert work). *Tests:* Node: two cores, delete a class used in both: no trace keeps its id; undo or restore brings every
      label back; a saved project with orphaned ids opens repaired with the count.
      *As built (19 Nov 2026):* `app/js/taxa.js` (`classUse`, `deleteClass`, `restoreClass`, `repairOrphanLabels`); `app.js` wires it
      (`deleteClassAsked`, `restoreDeletedClass`, `labelsChanged`; the repair at the end of `loadProject`, with a message and a save) and a
      «Restore» button under the class list (`#clsRestore`, the last deletion first; cleared when another project is opened). Recovery is a
      list kept while the project is open, not an undo step: the undo history is still discarded, because its steps hold traces labelled with
      the deleted class (the question says so). The old deletion did not mark the project changed nor send the objects table of tiled sections;
      it does now. Native `confirm()` until card U2 brings one confirmation dialog. Tests: Node 4 (`tests/app/taxa.test.mjs`: use counted over
      every core; deleting a class used in two cores leaves no trace with its id and restoring gives back every label and prediction; a trace
      labelled again or gone is left alone; orphaned labels repaired with their count, a second pass finds nothing). Checked once in the
      desktop program with a script not kept (the test project split into two cores, a new class labelled in both): the question named 2
      traces, 7 predictions and 2 cores, no trace kept the class, «Restore» brought back both labels and hid itself. `app.js`: 5,352 lines
      before, 5,383 after (the three wiring functions and the button). Full checks (Windows): `py -3.12 -m pytest -q` 885 passed / 9 skipped;
      `npm test` 476 passed; typecheck (one old diagnostic fewer); `sync_version.py --check`; `ruff check`; standalone build; `desktop.mjs`
      with the engine off and on. `tiled-sections.mjs` failed at the M8.4.27 step "nothing left half-deleted": the incident of M8.4.31 again
      (second time in three runs since its 20 s block of edits and saves runs just before), now with its cause visible: the folder was renamed to
      `.deleting-*` and its removal failed (`deleteProjectStore` calls `fs.rmSync` without retries, `fs.renameSync` without retries; a file still
      held for a moment on Windows makes them fail). Nothing of Q1 runs in that step. No data is lost (the program says the folder was not
      deleted, and removes the remainder at its next start). The retries are part of card A2; bringing them forward is proposed to the maintainer.
- [x] **Q2 - The import panel and the readers.** Done 20 Nov 2026 (development gate). *First delivery (the readers):* `parseTable` with
      missing-value codes, censored values (decision M: empty by default; `half` and `limit` available to callers), decimal separators per
      column with ambiguous columns reported, preamble, repeated names, longer rows, all counted; `decodeText` with UTF-16; spreadsheets with
      `rawNumbers`; one message on import listing every change. Tests: Node (`tests/app/log.test.mjs`, each case above; the V0.38 test now
      counts "n.d." as below the detection limit instead of as text). *Second delivery (the import report):* the two dialogs that already open on
      import (external record, multiproxy table) show what was changed with counts, the sheet of a workbook, the rule for values below a
      detection limit (one rule per file, not per column: a simplification of the card), the first five rows as read; a change reads the file
      again; nothing else interrupts the user (those dialogs were already the step that asks). «Undo import» exists for external records only
      (a multiproxy import adds cores and data; its undo belongs to card U2's undo by domain). Checked once in the desktop program with a
      script not kept (a CSV with a title, -999, «<0.02» and «bdl»: report, preview, the rule changed to half the limit, record added and
      removed with «Undo import»). `app.js` unchanged.
      Full checks of the first delivery (20 Nov 2026, Windows): pytest 885 passed / 9 skipped, npm 479, typecheck, sync_version, ruff, standalone
      build, runtime rebuilt (it no longer matched `src/` after the release steps on `master`), desktop.mjs off and on, tiled-sections.mjs. One import panel with a preview of the first rows as read and counts: missing-value codes
      (a configurable list, by default -999, -999.25, -9999), censored values (decision M), rows dropped and why (`parseAgeModelDetailed`,
      `coreFromRows`, `coresFromLongTable`, `intervalsFromTable`, which also reverses from > to silently, `buildSamples` with log of v ≤ 0),
      decimal separator decided per column (decision M approved: censored values empty by default with a visible count, half the limit or the
      limit per column); (today `1,250` in a tab-separated file reads as 1.25 and `0.500` with a decimal comma as 500),
      UTF-16 byte-order marks, a preamble before the header, repeated header names, rows longer than the header; Excel: the sheet chosen and
      raw numbers (`rawNumbers: true`). It interrupts only when something is ambiguous; otherwise a data report remains with "Undo import".
      *Model:* most capable, effort medium (data correctness). *Tests:* Q6 corpus and property tests.
- [x] **Q3 - Units.** Done 20 Nov 2026 (development gate); *As built* at the end of this card. External records declare their depth or age unit on import (proposed from the header, `mbsf` → m, confirmed with one
      click), are converted with `UNIT_TO_CM`, and a record whose range does not overlap its core's is reported; joining projects converts
      units and refuses or reports different age units and counts value conflicts (`mergeImp` and `buildMultiProject` move to a pure module
      with tests; cores are matched by identifier where they have one, not only by name); changing a section's unit asks whether to convert its
      depths or only correct the label. *Model:* most capable, effort medium (silent 10-100× errors). *Tests:* Node, per case.
      *As built (20 Nov 2026):* records: a unit selector in the record dialog proposed from the header (`guessRecordUnit`), conversion on
      adding (`recordSeries` with `unitFactor`) to the unit of the open core's uppermost section or of the age model, the unit kept as
      `record.unit`, a record wholly outside the core reported (`rangeOverlaps`). Sections: changing the unit asks (OK converts, Cancel only
      relabels; native `confirm` until U2). Joined projects: `coremerge.js` (`mergeImp` moved out of `app.js` with a count of disagreeing
      values; `joinCoreTables` converts depths and ages to the first project's units); the light copy keeps `ageUnits` (older light copies
      have none: their ages are not converted). Cores are still matched by name (`coreKey`); matching by identifier is left out (light copies
      have no shared identifier across projects). Tests: Node (`tests/app/units.test.mjs` 3, `tests/app/coremerge.test.mjs` 4: units proposed
      from headers, factors, a metre record stored in centimetres and its range, the merge as before without conversion, metres and years
      converted, a disagreement counted). `app.js`: 5,383 lines before, 5,377 after.
      Full checks (20 Nov 2026, Windows): pytest 885 passed / 9 skipped, npm 486, typecheck, sync_version, ruff, standalone build (after
      renaming two functions that clashed with `multiproxy.js`), desktop.mjs off and on, tiled-sections.mjs.
- [x] **Q4 - Exports keep the data** (decisions N and P, approved 19 Nov 2026). Done 20 Nov 2026 (development gate); *As built* below. Numbers in CSV with 15 significant digits, non-finite values as empty cells, the
      Python export the same (shared-definition rule); the core-column CSV (`windowCSV`) with the gap limit of the cursor and an interval-mean
      mode with the number of samples per cell, intervals outside the age model or reversed marked instead of dropped. *Model:* most capable,
      effort medium (export format and exported values change). *Tests:* exact expected files; the regression against version 2.1 stated before
      the change with its tolerance.
      *As built (20 Nov 2026):* `core.js::toCSV` writes 15 significant digits (`+v.toPrecision(15)`) and an empty cell for a value that is
      not a finite number; `seriesGap` (the 3 × median-spacing rule, now also behind `geo.js::autoGap`) and `seriesSampler` (sorted once:
      value at a point with the gap limit, mean and count over `[lo, hi)`) in `core.js`; `windowCSV` with `recordMode` (`mean` by default:
      `<name> (mean)` and `<name> (n)`; `point`: `<name> (interp.)`) and `model` (ages of an interval's bounds for records on the age axis), a
      `note` column (`age reversal`); `compositeRows` marks `reversed` and counts `outside`, which the CSV states in a last `#` line (intervals
      outside the age model cannot be placed on the age axis, so they are counted rather than listed); a selector beside the CSV button. The
      Python package already wrote full precision (pandas) and is unchanged. Tests: the frozen CSV reference follows the new number rule (a
      requested format change); a new expected file for small values, binary noise, NaN and infinities; `windowCSV` mean, count, centre value,
      a gap, a sample at the centre, a reversal and an interval outside the model; the comparison with version 2.1 passes unchanged.
- [ ] **Q5 - Long series.** A loop-based `extent()` in `core.js` instead of `Math.min(...array)` and `Math.max(...array)` (about 30 places;
      behaviour-preserving, exact equality, a test with 10^6 values); plots and core-column curves decimated per pixel (minimum and maximum)
      on screen, full resolution on export; the project's data record saved in parts with their own revision, so that a column width does
      not rewrite every table (a reproducible save benchmark first, AGENTS §4). *Model:* most capable, effort medium.
      *Part 1 done (20 Nov 2026, development gate):* `minOf`/`maxOf` in `core.js` replace the 68 spread calls (`Math.min(...x)`,
      `Math.max(c, ...x)`) in 11 modules, exact by construction (`Math.min` applied pairwise); `tests/app/extent.test.mjs`. Checks: npm 493,
      typecheck, standalone build, `desktop.mjs` engine off and on (Windows). *Part 2 done for the Data-tab plots (20 Nov 2026):* `plot.js::decimatePerPixel` (first, lowest, highest
      and last point per pixel column), on screen only; SVG and PNG exports build the plot again with every point; tests in
      `tests/app/plot.test.mjs`; npm 495, typecheck, standalone build, `desktop.mjs` (Windows). The Data-tab plot is not exercised by an
      end-to-end test. *Remaining:* the record curves of the core column (`log.js`, column `rec`) are not thinned, because the figure tabs
      save and export the same SVG that the screen shows: thinning them needs a screen-only build of figures (design question, to settle
      with card P2's publication mode); part 3, the data record saved in parts, after its save benchmark.
- [ ] **Q6 - Tests that find what examples miss.** Property-based tests (a test-only dependency, AGENTS §3 item 9: fast-check for Node,
      Hypothesis for Python) for `parseTable`, `parseAgeModel`, `interpAge` against `interpolate_age`, `binRows` against `bin_edges`; a corpus
      of 10-15 real laboratory files (scanner XRF, MSCL, IODP LIMS, Bacon output; public or anonymised); project files saved by old versions
      (v1-v5) opened in a test; a corrupt `sources.json` set aside as `.corrupt-<date>` instead of being overwritten (`tile-ipc.js`).
      *Model:* fast tier, effort medium.
- [ ] **Q7 - Splice overlaps in both implementations.** The `overlap` option of the Python export (`keep`, `upper`, `error`) as a shared
      definition in `core.js`, used by the core column and its CSV, with a parity test; today JavaScript keeps every overlapping interval.
      *Model:* fast tier, effort medium (results of overlapping sections change only when the user picks another option).
- [ ] **F1 - Figures for publication.** *Replaced on 20 Nov 2026 by cards P1-P5 (publication layout, below), designed from the journals' artwork rules at the maintainer's request.* A pure `figsize.js`: journal widths in millimetres (about 84, 129, 174 mm and A4), font sizes in
      points with a warning below 6 pt, PNG with a chosen resolution (300 or 600 dpi) and its `pHYs` chunk, overlays in PNG instead of JPEG,
      an "original resolution" option; a PDF export designed so that it does not tie figures to Electron (ARCHITECTURE §3.3), fonts embedded
      or text as paths for the final export; Okabe-Ito as the default categorical palette and a note against `rainbow`. *Model:* most capable,
      effort medium. After M8.4.30.
- **Publication layout of figures (cards P1-P5).** The maintainer asked on 20 November 2026 that figures can be chosen to come out "with
  publication structure", laid out for an A4 scientific journal page. Design, journal comparison with sources, presets, interface and
  architecture: [design-publication-figures.md](design-publication-figures.md). **Decisions approved by the maintainer on 20 Nov 2026
  ("apruebo S, T"), as recommended:** **S** the font of publication figures (*amended by the maintainer on 20 Nov 2026:* the user chooses the font among common ones, at least
  Arial, Helvetica, Calibri and Times New Roman. The figure names the chosen font; a font installed on the computer is used for PNG/PDF, and when it
  is missing a bundled metric-compatible font with a free licence stands in, with the same text widths (Liberation Sans for Arial and Helvetica,
  Carlito for Calibri, Liberation Serif for Times New Roman; a few MB in the program), and the checks list says that it stood in. Arial, Helvetica and
  Calibri themselves cannot be bundled (their licences forbid it). The first recommendation, one bundled font only, is replaced); **T**
  the new optional saved fields `fig.publish` and `fig.plate` (a saved-format change, AGENTS §3 item 5; older versions ignore them; approved,
  with save-and-reopen tests in P2 and P5; the font is a bundled dependency recorded by the card that adds it). Order:
  P1 at any time (pure, no saved field); P2-P5 after M8.4.30 and U1-U3, which move the dialogs and messages they use.
- [x] **P1 - Physical sizes, presets and PNG resolution** (done 20 Nov 2026, development gate; see CHANGELOG, card P1; the e2e check is pending, see the status). Pure `figsize.js` (journal presets, `mmToPt`, `widthMm`, `pixelsFor`, the text,
      line and raster audits, `panelLabel`, `fitWidths`, `OKABE_ITO`) and `pngmeta.js` (`crc32`, `withPhys`, `withText`); the PNG export can
      save at a chosen DPI with its `pHYs` chunk. *Do not touch:* the builders, the default ×2 PNG, saved fields. *Model:* fast tier, effort
      medium. *Tests:* `pixelsFor(170, 600) === 4016`, `pixelsFor(84, 600) === 1984`; `mmToPt(170)` = 481.89 ± 0.005; the PNG has `pHYs`
      right after `IHDR` with 23622/23622, unit 1 and a valid CRC; `auditText` flags 6.9 pt for `generic` and accepts 7.0;
      `panelLabel(1, 'paren') === '(b)'`. *Done when:* a PNG saved at 600 dpi reports 600 dpi in an image viewer.
- [ ] **P2 - Publication mode: page frame, true-size preview and checks** (decision T). The switch Screen | Publication behind the flag
      `figPublication`: journal preset, width, a white A4 page with column guides, the checks list. New controller `figpublish.js`. *Do not
      touch:* screen-mode output (byte-identical SVG). *Model:* most capable, effort medium (new saved field). *Tests:* the exported SVG root
      has `width="170mm"` and the matching viewBox; after "fit for print" every text measures ≥ 7 pt at 170 mm; a 900 px sections panel at
      170 mm is reported below 300 ppi; screen SVG unchanged; `fig.publish` survives saving and reopening; served and standalone builds, flag
      off and on.
- [ ] **P3 - Print typography in the builders.** `log.js` (column, distribution), `plot.js`, `locmap.js`, `geo.js` maps and `figures.js` take
      a `print` style in pt; their fixed sizes become relative to the body size; one builder per commit. *Do not touch:* measurements, CSV,
      screen defaults. *Model:* fast tier, effort medium. *Tests:* with `print.body = 8` no `font-size` below 7; `fitWidths` keeps the order
      and sums to the target within 0.01 pt; screen output byte-identical. *Done when:* every figure type passes P2's text check at 84 and
      170 mm with the default preset.
- [ ] **P4 - PDF, TIFF and provenance** (after decision S). Desktop PDF through an offscreen window and `printToPDF` (no new dependency;
      origin-checked IPC with a size cap; the web build says it needs the desktop program); a TIFF writer with resolution tags; provenance in
      every export (shared with F2); embedded images at their original resolution, as PNG. *Model:* most capable, effort high (IPC with
      external input, packaging on three systems, a font asset). *Tests:* PDF MediaBox width 481.89 pt ± 0.5 (tolerance stated now because
      Chromium rounds page sizes), every `/Font` embedded (`FontFile2`/`FontFile3`), a label's text extractable; TIFF tags 256 = 4016,
      282/283 = 600/1, 296 = 2, decoding back to the same RGB in Node; SVG `<metadata>` with preset, width, DPI and version; an oversized SVG
      refused visibly. *Done when:* the desktop end-to-end passes on three systems (milestone gate).
- [ ] **P5 - Plates: several figures as the panels of one** (decision T). A "Plate" tab placing figure tabs in a grid with labels in the
      preset's style, shared depth axes where they align and one caption; pure `figlayout.js`. *Model:* most capable, effort high (saved
      format and layout contract). *Tests:* cells inside the frame with gaps ≥ 3 mm; unique ids after `scopeIds`; labels `A` for GSA, `(a)`
      for Copernicus; the plate survives saving and reopening, a deleted child tab reported. *Done when:* a location map + core column +
      distribution plate exports at 170 × 225 mm with every check green.
- [ ] **F2 - Provenance of every export.** `provenanceLines(kind, settings)` per kind of export: the multiproxy settings (step, gap limit,
      logarithms, scaling, missing values, classifier, seed), map interpolation, enhancement and `noDataPad`, SHA-256 of the age-model text
      and of each record file; a `<metadata>` block in every SVG; a reference epoch for ages (`ageRef`: BP 1950, b2k, CE) in the age model,
      its labels and exports. Long settings may go to a sibling `*_provenance.json` referenced by its hash. *Model:* fast tier, effort medium.
- [ ] **F3 - Stratigraphic conventions (later; after M8.5 slice d).** Lithology patterns (FGDC 2006) for interval categories, a grain-size
      column, a secondary non-linear age axis beside depth, a track of dated levels with their errors, BI and ii per described layer as well as
      per interval; a moving average with a window in axis units that stops at gaps (`plot.js`). Presentation in JavaScript; any new
      calculation in Python (AGENTS §4). *Model:* most capable, effort high (design).
- [ ] **A1 - Engine methods of core or project scope (before M8.5).** A design card: an operation `method.run` with a declared scope
      (section, core, project), a revision key and two priorities (interactive, batch), operations registered in a table instead of the chain
      of conditions in `engine/server.py`; the columnar `f64le` series format of the contract for tables; slices (d) and (a) first, because their
      results end in publications and are not reproducible by script today. *Model:* most capable, effort high (design).
- [ ] **U6 - Detection over several cores.** A "Detect in…" dialog with cores and sections to tick, processed one after another within the
      memory budget of §22.3, cancellable (U1); the section selector shows each section's state (detected, traces to review, depth range).
      *Model:* fast tier, effort medium. After U1.
- [ ] **Q8 - Data-sheet edits and small divergences.** Cell edits keyed by depth (`applyCellEdits`): edits left without a row after a new
      import are counted and listed, duplicated depths are reported on import and an edit names its row unambiguously; the age model treats a
      non-finite value the same in Python and JavaScript (today Python raises and JavaScript skips; shared-definition rule); a text cell that
      starts with "-" is exported without a leading apostrophe when it is a number written as text, and the rule for formula-like cells is
      documented. *Model:* fast tier, effort medium. *Tests:* Node and Python per case.
- [ ] **A2 - What the program runs is kept apart from what it saves.** *Brought forward on 20 Nov 2026 at the maintainer's request:* the
      retries of a refused rename and removal (`desktop/tile-ipc.js`: `renameRetrying` on EPERM, EBUSY, EACCES, ENOTEMPTY with pauses of
      50-1600 ms; `fs.rmSync` with `maxRetries`; `sweepDeleted` no longer stops at a folder it cannot remove yet), with a Node test (two
      refusals then the rename; a lasting refusal reported and the folder left as it was). The repeated failure of the folder-deletion step of
      `tiled-sections.mjs` was not caused by locks: the test checked for a `.deleting-*` folder between the rename and the end of the removal
      (seen in one of three diagnostic runs); it now waits, within the same 10 s, until both are finished. The rest of A2 remains. Runtime caches (`_lc`, `_lb`, `_counts`, `_maskSync`, `_maskLoader`,
      `_statsRunner`, `_unet`, `_tiledRecord`, `_savedRecord`) move out of the section record into a `WeakMap` per section, so that a
      serialiser can never write them; `settleTiledSections` waits for a promise from `MaskSync` instead of checking every 50 ms; one seeded
      random generator instead of two (`learn.js` and `geo.js`, with the existing seeds giving the same sequences); renames in the main process
      retry a transient `EPERM`/`EBUSY` on Windows (antivirus, cloud folders) before failing. *Model:* most capable, effort medium (saving).
      After M8.4.30.
- [ ] **A3 - Heavy work off the page's thread.** A job runner in a worker for the calculations that today block the page (multiproxy
      classifiers, map interpolation, `buildSamples`, detection where it can be moved), cancellable, giving progress to U1's component; only
      until each calculation moves to the engine (M8.5), then removed with it. *Model:* most capable, effort medium. After U1.
- [ ] **F4 - Figures reproducible by script (later; with M8.5 slice d and M6.6).** The publication figures (core column, multiproxy,
      sections, maps) produced from a project file or from exported data plus a style file by the Python package, with the same layout rules
      as the program, so that a figure in a paper can be rebuilt without the interface. *Model:* most capable, effort high (design).
- [ ] **U3 addition (second council):** labels of scope on settings (section, core, project), completed steps of the left panel folded, expert
      settings under "More options", the summaries of multiproxy's step headers copied to the other panels, a shortcut sheet opened with `?`,
      depths validated as typed with a message (today an invalid bottom reverts without explanation), buttons that a tiled section refuses
      disabled with the reason instead of refusing after the click.

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
- [x] **H5 - The `e2e` job of the GitHub workflow was red from 10 November 2026 to 14 November 2026; fixed on the work branch.** Closed by the audit of
      19 November 2026: the `web-app` job (smoke test) passed on the last 27 pushes of `work/2026-11-13`. Record kept below. Findings of 13-14 November 2026
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
- [x] **H6 - A working resolution that does not fit in memory made the window go blank** (reported by the maintainer, 16 November 2026;
      done the same day). Choosing "Full" for a section of a 2 GiB image, or adding it with "No reduction", needed about 8.7 GiB of page
      memory and the renderer died. Now `factorThatFits` (`app/js/imageproc.js`) keeps every working image within 1.5 GiB estimated (13 bytes
      per pixel, 21 for 16-bit); larger factors are chosen on import with a message, and the section form disables and refuses the rest. The
      maintainer found the two controls confusing: they are now "Maximum size when adding images" and "Resolution of this section", with notes
      that point to each other. Checked: `tests/app/working-memory.test.mjs`, a TIFF reader test, and on Windows
      `tests/e2e/working-memory-desktop.mjs` with `rgb2g.tif` (added at 1/3 with the message, full resolution disabled and refused, the window
      alive). Not measured: the exact memory at which the renderer dies (the limit is a conservative estimate), macOS and Linux.
- [x] **H7 - A 16-bit image above about 28 megapixels made the page die while it was decoded** (found 17 November 2026 while measuring a delay
      the maintainer reported between Bioturbation and Multiproxy; authorised and done the same day). The switches themselves were not slower
      than in V0.140 (35-116 ms; the first entry into Multiproxy about 1 s). But in the maintainer's project "EasterMediterranean" (private, kept
      out of the repository; a 2,249 x 14,020 16-bit section at full resolution) opening the Core log decoded that section again and the renderer
      ended with reason `oom` (code 0xE0000008) at about 1.5 GB, also in V0.140. Cause: `tiff.js` made the 8-bit display copy with
      `Uint8ClampedArray.from(output, mapFn)`, which builds a temporary array on the JavaScript heap: 5.2 s for 100 million samples and a fatal,
      uncatchable out-of-memory error from 112 million (Node 22; a 28-megapixel image as RGBA). The H6 limit (1.5 GiB) allows 16-bit sections up
      to about 76 megapixels, so it did not protect against this. Fix: `tiff.js::highBytes`, a plain loop (0.09 s for 126 million samples), also
      used by `tiledsection.js`. Checked: `tests/e2e/large-16bit-desktop.mjs` died without the fix (while adding the image) and passes with it
      (three Core log openings, each decoding again in 1.2-1.5 s), a Node test at 120 million samples, and on a copy of the maintainer's project
      four rounds of six mode switches without a failure (Windows). Not changed: `Array.from(lab)` in the save path of sections with overlapping
      traces is slow at the largest sizes (2.1 s and about 1 GB for 123 million pixels in Node) but does not fail.
- [ ] **H8 - Shorten the roadmap** (audit of 19 November 2026, finding 5; documents only; fast tier, effort low). The status block keeps only
      what a new session needs (branch, last verified commit, checks due, next card, open decisions); the per-step check records of M8.4.14-M8.4.28
      and the long *As built* texts of done cards move to `roadmap-history.md`, leaving one line each with a link. Done when no fact is lost
      (every moved paragraph is findable from its card line) and this file is under about 1,000 lines.
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
