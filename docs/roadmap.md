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

Updated 22 November 2026. Rules for this block: [AGENTS.md §1 step 8](../AGENTS.md#1-every-session-in-this-order) (about 30 lines, rewritten,
not appended). Earlier status records, check logs and audit texts: [roadmap-history.md § Status log](roadmap-history.md#status-log-until-21-november-2026).

- **Branch:** `work/2026-11-13` (pushed); `master` (V0.152, `8ee9776`) is contained in it.
- **Released:** V0.152 (20 Nov 2026, tag `V0.152`, GitHub Release with 8 files). The next version is V0.153; Q10 must be done before it.
- **Last verified code commit:** M8.4.9 (this commit; see `git log`). Full checks on Windows (`tools/check_all.py --desktop --tiled`):
  `pytest` 932 passed / 9 skipped; `npm test` 632 / 0; typecheck; sync; ruff; `desktop.mjs` engine off and on passed;
  **`tiled-sections.mjs` failed** (line 1464, M8.4.43 split block), as it does on unmodified `956f3e3`: see **Q14**.
- **GitHub:** `f896132` (code of M8.4.37): all green on three systems (milestone gate of part C). `956f3e3` (M8.4.43): `tests` green;
  *Desktop builds* failed in `tiled-sections.mjs` on Windows, macOS and Linux (run `44957994403`). The *As built* of M8.4.43 said it passed
  on Windows; it does not.
- **Checks due:** the GitHub result of this commit (Q14 part b).
- **Q14 in progress:** part (a) fixed (test defect; see the card); part (b), `window: labels` on GitHub Windows and macOS, waits for the
  GitHub run of this commit: cause found (a mode button wrapping when the save state is long) and fixed in `app/index.html`.
- **Found, not done:** **Q16** (canvas taller than its pane; fast, medium), **Q17** (spurious BUSY notices; most capable, medium), **Q15** (the macOS/Linux-only failures of
  `tiled-sections.mjs`; most capable, effort medium), **Q11** (hostile ML settings stop the classifier), **Q12**
  (an evicted placeholder section cannot rebuild its grey image).
- **Decisions of 21 Nov 2026 after M8.4.19:** rule 6 keeps both paths (small sections stay on today's path); the tiled flag stays off until
  the release gate. Decisions X1-X4 (splitting a too-dense section) approved as recommended and delivered (M8.4.41–M8.4.43).
- **Next (order decided by the maintainer, 22 Nov 2026):** **Q14**, then **Q15**, then **M8.4.10** (record tables resident in the
  engine; most capable, effort medium), **M8.4.11** (gate of part B; fast, effort low), then M8.5 (needs A1). `Q10` before V0.153; `A4` open.
- **Where M8 stands:** M8.1-M8.3 done; M8.4 part A done; part C (tile store) done, milestone gate met (M8.4.19); part B: M8.4.9 done
  (22 Nov 2026); M8.5 must not start. The engine path fails the timing gate of
  [contract §7](roadmap-engine-contract.md#7-predeclared-verification-and-performance-gates) for whole sections; the tile store is the
  answer for large images.
- **Decisions waiting for the maintainer:** promote or remove the flags marked so in the [flag table](#flags);
  `Q5` part 3 (saved format of long series) only if a save benchmark shows a slow save. Every lettered decision up to X is approved. M8.4.9 kept
  the 512 MiB session budget by measurement (a third outcome beside the card's two): recorded in contract §3.
- **Open pull requests (Dependabot, against `master`, not merged):** #26 Electron 45.2.2 → 45.3.4, #24 `softprops/action-gh-release` 2 → 3.
  They wait for the maintainer (AGENTS §5.1).
- **Standing reminders:** remind the maintainer to run the release-gate tests (the [release checklist](#release-checklist)) when an M8
  milestone finishes and before any flag is switched on by default or a version with the engine is announced. Libraries that make the
  program faster or more stable may be added (16 Nov 2026), each with its capability, smallest alternative and cost (AGENTS §3.9).

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
| Tiled sections | M8.4.15 | environment variable `SEDCORETOOL_TILED_SECTIONS=1`, with the engine experiment | off | The release gate (milestone gate of part C met; kept off until then, decided by the maintainer on 21 Nov 2026) |
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

- [x] **M8.3.1 - Move the section analysis out of `app.js`** (done 12 Nov 2026; record: [history](roadmap-history.md#m831---move-the-section-analysis-out-of-appjs)).

- [x] **M8.3.2 - Reference fixtures for `section.intervals/1`** (done 13 Nov 2026; record: [history](roadmap-history.md#m832---reference-fixtures-for-sectionintervals1)).

- [x] **M8.3.3 - Python kernels** (done 13 Nov 2026; record: [history](roadmap-history.md#m833---python-kernels)).

- [x] **M8.3.4 - Method `section.intervals/1`, called directly** (done 13 Nov 2026; record: [history](roadmap-history.md#m834---method-sectionintervals1-called-directly)).

- [x] **M8.3.5 - The engine process runs registered methods** (done 13 Nov 2026; record: [history](roadmap-history.md#m835---the-engine-process-runs-registered-methods)).

- [x] **M8.3.6 - Main-process client and renderer bridge** (done 14 November 2026; record: [history](roadmap-history.md#m836---main-process-client-and-renderer-bridge)).

- [x] **M8.3.7 - The interface shows engine results under the flag** (done 14 November 2026; record: [history](roadmap-history.md#m837---the-interface-shows-engine-results-under-the-flag)).

- [x] **M8.3.8 - Acceptance measurements and decision** (record: [history](roadmap-history.md#m838---acceptance-measurements-and-decision)).

- [x] **M8.3.9 - Milestone gate of M8.2 and M8.3 on Windows, macOS and Linux** (done 14 Nov 2026; record: [history](roadmap-history.md#m839---milestone-gate-of-m82-and-m83-on-windows-macos-and-linux)).

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

- [x] **M8.4.1 - Measure the scenarios and give every gate a verdict** (done 14 Nov 2026; record: [history](roadmap-history.md#m841---measure-the-scenarios-and-give-every-gate-a-verdict)).

- [x] **M8.4.2 - Section inputs stay resident in the engine** (done 14 Nov 2026; record: [history](roadmap-history.md#m842---section-inputs-stay-resident-in-the-engine)).

- [x] **M8.4.3 - Row counts reused in the engine; one result buffer per job** (done 14 Nov 2026; record: [history](roadmap-history.md#m843---row-counts-reused-in-the-engine-one-result-buffer-per-job)).

- [x] **M8.4.4 - After an edit, only the changed rows travel** (done 14 Nov 2026; record: [history](roadmap-history.md#m844---after-an-edit-only-the-changed-rows-travel)).

- [x] **M8.4.5 - Recount only the changed rows** (done 14 Nov 2026; record: [history](roadmap-history.md#m845---recount-only-the-changed-rows)).

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

- [x] **M8.4.7 - Restart after a coordinator failure** (done 15 Nov 2026; record: [history](roadmap-history.md#m847---restart-after-a-coordinator-failure)).

- [x] **M8.4.8 - Milestone gate of part A** (done 16 Nov 2026; record: [history](roadmap-history.md#m848---milestone-gate-of-part-a)).

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

- [x] **M8.4.12 - Round trip of a one-tile edit, and rule D11** (done 15 Nov 2026; record: [history](roadmap-history.md#m8412---round-trip-of-a-one-tile-edit-and-rule-d11)).

- [x] **M8.4.21 - Interval sums without a per-interval loop; rule D11 measured again** (done 16 Nov 2026; record: [history](roadmap-history.md#m8421---interval-sums-without-a-per-interval-loop-rule-d11-measured-again)).

- [x] **M8.4.13 - Multi-gigabyte fixtures and the baseline (M2.3.1)** (done 16 Nov 2026; record: [history](roadmap-history.md#m8413---multi-gigabyte-fixtures-and-the-baseline-m231)).

- [x] **M2.1.4 - Tables and figures with 100,000 rows: measure** (done 16 Nov 2026; record: [history](roadmap-history.md#m214---tables-and-figures-with-100000-rows-measure)).

- [x] **M2.1.5 - Multiproxy: build the depth-age relation once per core (found by M2.1.4)** (done 16 Nov 2026; record: [history](roadmap-history.md#m215---multiproxy-build-the-depth-age-relation-once-per-core-found-by-m214)).

- [x] **M2.1.6 - Multiproxy: interval membership with a lookup (proposed by M2.1.5)** (done 16 Nov 2026; record: [history](roadmap-history.md#m216---multiproxy-interval-membership-with-a-lookup-proposed-by-m215)).

##### Design of M8.4.14-M8.4.19 (design session of 16 November 2026)

The decisions are in [ARCHITECTURE §3.4, "Design of part C"](ARCHITECTURE.md#34-tile-store-for-large-images-planned-part-c-of-m84). Three of them are
proposals that the maintainer answered on 16 November 2026 (Q1-Q3 in the roadmap status); decoding uses libvips (decision 4, revised the same day). Every card claims
the development gate; each later card is re-read by its implementing session against what the earlier cards measured, and stops if a number
invalidates a step. Measured inputs used here: M8.4.12/M8.4.21 (one-tile edit p95 85 ms; D11 = D), M8.4.13 (all seven fixtures open today only at
1/6-1/19 of their resolution, peak 1.1-2.8 GiB, 3-61 s to the first frame), M2.1.4-M2.1.6.

- [x] **M8.4.14 - Tile store format and pyramid import (engine only)** (done 17 Nov 2026; record: [history](roadmap-history.md#m8414---tile-store-format-and-pyramid-import-engine-only)).

- [x] **M8.4.15 - Tiled sections in the viewer (behind a flag)** (done 17 Nov 2026; record: [history](roadmap-history.md#m8415---tiled-sections-in-the-viewer-behind-a-flag)).

- [x] **M8.4.16 - Masks of tiled sections: storage, editing and undo** (done 17 Nov 2026; record: [history](roadmap-history.md#m8416---masks-of-tiled-sections-storage-editing-and-undo)).

- [x] **M8.4.17 - Interval table of tiled sections** (done 18 Nov 2026; record: [history](roadmap-history.md#m8417---interval-table-of-tiled-sections)).

- [x] **M8.4.22 - Objects table of tiled sections beyond 4 MiB** (done 18 Nov 2026; record: [history](roadmap-history.md#m8422---objects-table-of-tiled-sections-beyond-4-mib)).

- [x] **M8.4.23 - Desktop tests refuse a stale program copy or engine runtime** (done 18 Nov 2026; record: [history](roadmap-history.md#m8423---desktop-tests-refuse-a-stale-program-copy-or-engine-runtime)).

- [x] **M8.4.24 - The intermittent viewer probe of the tiled-sections test** (done 18 Nov 2026; record: [history](roadmap-history.md#m8424---the-intermittent-viewer-probe-of-the-tiled-sections-test)).

- [x] **M8.4.25 - Sending the tables of a tiled section without a pause** (done 18 Nov 2026; record: [history](roadmap-history.md#m8425---sending-the-tables-of-a-tiled-section-without-a-pause)).

- [x] **M8.4.26 - Two intermittent GitHub failures: runtime downloads and an engine start on Windows** (done 18 Nov 2026; record: [history](roadmap-history.md#m8426---two-intermittent-github-failures-runtime-downloads-and-an-engine-start-on-windows)).

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

- [x] **M8.4.18a - Save and reopen tiled sections on the same computer** (done 18 Nov 2026; record: [history](roadmap-history.md#m8418a---save-and-reopen-tiled-sections-on-the-same-computer)).

- [x] **M8.4.18b - A missing or moved source; copying the source into the project** (done 18 Nov 2026; record: [history](roadmap-history.md#m8418b---a-missing-or-moved-source-copying-the-source-into-the-project)).

- [x] **M8.4.27 - The store folder follows its project** (done 18 Nov 2026; record: [history](roadmap-history.md#m8427---the-store-folder-follows-its-project)).

- [x] **M8.4.28 - Object operations right after reopening a tiled section** (done 19 Nov 2026; record: [history](roadmap-history.md#m8428---object-operations-right-after-reopening-a-tiled-section)).

- [x] **M8.4.31 - The store and the saves keep every committed version** (done 19 Nov 2026; record: [history](roadmap-history.md#m8431---the-store-and-the-saves-keep-every-committed-version)).

- [x] **M8.4.32 - The tiled tests run on GitHub on three systems** (done 20 Nov 2026; record: [history](roadmap-history.md#m8432---the-tiled-tests-run-on-github-on-three-systems)).

- [x] **M8.4.33 - Backups and packages say what they leave out** (done 20 Nov 2026; record: [history](roadmap-history.md#m8433---backups-and-packages-say-what-they-leave-out)).

- [x] **M8.4.30 - The tiled-section controller leaves `app.js`** (done 20 Nov 2026; record: [history](roadmap-history.md#m8430---the-tiled-section-controller-leaves-appjs)).

- [x] **M8.4.29 - Reopening without reading every stored tile** (done 20 Nov 2026; record: [history](roadmap-history.md#m8429---reopening-without-reading-every-stored-tile)).

- [x] **M8.4.35 - Failures of `tiled-sections.mjs` on GitHub** (done 20 Nov 2026; record: [history](roadmap-history.md#m8435---failures-of-tiled-sectionsmjs-on-github)).

- [x] **M8.4.34 - Desktop hardening** (done 20 Nov 2026; record: [history](roadmap-history.md#m8434---desktop-hardening)).

- [x] **M8.4.18c - Folder backup and restore of tiled sections** (done 20 Nov 2026; record: [history](roadmap-history.md#m8418c---folder-backup-and-restore-of-tiled-sections)).

- [x] **M8.4.18d - Packages with tiled sections** (done 20-21 Nov 2026; record: [history](roadmap-history.md#m8418d---packages-with-tiled-sections)).

- [x] **M8.4.36 - Opening a tiled section whose tiles are all masked** (done 21 Nov 2026; record: [history](roadmap-history.md#m8436---opening-a-tiled-section-whose-tiles-are-all-masked)).

- [x] **M8.4.37 - A memory bound for the statistics of the objects of tiled sections** (done 21 Nov 2026, development gate; record: [history](roadmap-history.md#m8437---a-memory-bound-for-the-statistics-of-the-objects-of-tiled-sections)).

- [x] **M8.4.38 - Security hardening: close M8.4.34 store bypass and harden `trainer` IPC** (done 21 Nov 2026; record: [history](roadmap-history.md#m8438---security-hardening-close-m8434-store-bypass-and-harden-trainer-ipc)).

- [x] **M8.4.39 - Frontend lifecycle teardown, tiled-viewer stale closure, multi-core save/backup & memory leaks** (done 21 Nov 2026, development gate; record: [history](roadmap-history.md#m8439---frontend-lifecycle-teardown-tiled-viewer-stale-closure-multi-core-savebackup--memory-leaks)).

- [x] **M8.4.40 - Engine session-request limit, non-blocking store I/O and Windows/handle robustness** (done 21 Nov 2026, development gate; record: [history](roadmap-history.md#m8440---engine-session-request-limit-non-blocking-store-io-and-windowshandle-robustness)).

##### M8.4.19 - Milestone gate of part C — state: Done (milestone gate met, 21 Nov 2026); decisions taken 21 Nov 2026: rule 6 keeps both paths; the tiled flag stays off until the release gate

- **As built (21 Nov 2026):** GitHub on `f896132` (code of M8.4.37): `tests` and *Desktop builds* passed on Windows, macOS and Linux, including
  `desktop.mjs` with the engine experiment off and on, `tiled-sections.mjs` and `large-16bit-desktop.mjs`. Windows (Ryzen 7 7700X, 31 GiB,
  warm disk cache, headless, one run): `tools/measure_tiled_viewer.mjs` on `rgb8g` ([json](validation/M8.4.19-viewer-rgb8g-windows.json)) meets
  every target: first useful view 956 ms (≤ 2 s), cached pan/zoom 4.7 / 6.7 ms median / p95, with masks 10.8 / 13.1, strokes p95 28.0, 20.1 and
  31.4 ms (≤ 33), refusal beyond the edit budget, jumps never blank and complete at 176 ms p95 (≤ 250), process-tree peak 1,851 MiB (≤ 2,048).
  `--small` ([json](validation/M8.4.19-small-windows.json), public 620 x 16,726 example): tiled against today's path, first view 1,394 / 496 ms,
  frame cost 5.6 / 6.7 ms median and 7.5 / 10.0 p95, peak 753 / 813 MiB. **Not measured:** a 16 GiB computer, an Intel Mac, clean machines,
  macOS and Linux timing, a real display, repeated runs, the synthetic section with its image in the program (only extrapolated by M8.4.37).
  The intermittent Linux hang of `tiled-sections.mjs` did not recur on this run. List S2 said "Before M8.4.19"; decision U's order was followed.

- **Model:** fast, effort low (running and recording the gate); the most capable with effort high for the decisions that follow it.
- Windows, macOS and Linux on one commit (`tests` and *Desktop builds*, including the desktop end-to-end test with the engine experiment and the
  tiled flag on and off); the interactive targets measured on the primary host with the M8.4.13 fixtures; listed as not measured: a 16 GiB computer,
  an Intel Mac, clean machines, macOS and Linux timing. Then the decision on rule 6 (move small sections to the tiled path or keep both) and on
  promoting the flag (release gate).

- **Result of the measurements (15 November 2026):** [summary](validation/M8.4.8-final-summary.md). Matched timing still fails for (a) and (b) (public 226 and 166 ms against limits of 51 and 60; synthetic 305 and 271 against 51 and 68); (c), the memory peak and parity pass; the interactive targets are met for (a) on the public example and not for (b); input during a stroke is 15.6 ms p95 with the engine on and off; the desktop end-to-end test survives a coordinator killed during an undo. The three-system milestone gate is the push of the work branch (item 3 above needs the CI runners).

**Splitting a section too dense for its object statistics (requested by the maintainer on 21 Nov 2026, after M8.4.37).** When the statistics
of a tiled section go beyond `STATS_BUDGET_BYTES`, reopening does not help: they trip again at every opening, and delete, merge and cut stay
refused. The program should suggest splitting the section and then do it. Three cards, in this order, after M8.4.19 (not part of its gate).
Decisions **X1-X4** below were **approved by the maintainer on 21 Nov 2026, as recommended** (X1 b, X2 a, X3 a, X4).

- **X1 (number of parts):** (a) always two, as first asked; (b) **recommended:** the number of parts the estimate says each needs to fit with a
  margin (at least 2), offered only up to 8 parts; beyond 8 the message says that splitting would not be enough (masks this dense usually come
  from a detection that marked noise) and suggests reviewing the detection. Two halves fix only a section up to about twice the budget.
- **X2 (how the parts see the image):** (a) **recommended:** each part is a row window over the same stored image (a new optional field of the
  tiled record, no copy of the image); (b) the image is cut into new image files, one per part (no format change, but the image is stored again:
  gigabytes for the sections this concerns).
- **X3 (the original section):** (a) **recommended:** replaced by the parts after a confirmation that names the parts and their depths; the
  original's stored masks stay in the store until the project's next clean-up, and in the folder backup's history; (b) kept next to the parts
  (its statistics keep tripping).
- **X4 (saved format, with X2a):** **recommended:** the window is written only for sections that have one, and a project that has such a section
  is saved with format version 7, so an older SedCoreTool opens it read-only (as for any newer project) instead of showing each part as the
  whole image. Every other project keeps format 6.

- [x] **M8.4.41 - The message of a section too dense for its object statistics suggests splitting it** (done 21 Nov 2026, development gate; record: [history](roadmap-history.md#m8441---the-message-of-a-section-too-dense-for-its-object-statistics-suggests-splitting-it)).

##### M8.4.42 - A tiled section can show a row window of its image — state: Done (21 Nov 2026, development gate)

- **As built (21 Nov 2026):** new pure module `tiledrecord.js` (record written and validated, moved from `app.js` and
  `tiledproject.js`; format 7 and read-only of newer formats; translation of level-0 tile rows, zero rows below the window in its last tile,
  the working image's band); wired in `loadTiledSection`, `level0Rgba`, `tiledWorkingImage` and `drawTiles`. `app.js` 4457 → 4445 lines.
  `MaskSync.lastError` kept for reports. Tests: `tests/app/tiledrecord.test.mjs` (7; they fail with the row translation removed); the new
  block of `tests/e2e/tiled-sections.mjs` (rows 4096-9096 cut from the image and added twice, one record pointed at the whole pyramid with the
  window: identical working image, 2,253 label runs, objects with statistics and 300 bins, exactly; saved as format 7) **passes**. Windows: `npm
  test` 593, typecheck, `pytest -q` 924 / 9 skipped, ruff, `sync_version --check`.
  `tiledrecord.js` reads the record's `window` by destructuring, as the architecture test reserves `window.` for the browser's object.
- **Was blocked by Q13** (found here): with the block, the later step "(3) deleting a project deletes its folder" failed 3 runs of 3
  (`mask.forget` BUSY): two sections' mask rounds had been refused with BUSY by the desktop's limit of requests in flight, and
  `desktop/tile-ipc.js` forgot the staged version when a commit failed before reaching the engine, or when its discard was refused, so the
  engine kept it open. **Q13 done** (21 Nov 2026; Opus sub-agent, high, reviewed line by line): `discardStaged` retries `mask.discard` on
  BUSY; a failed commit closes its staged version; a refused discard keeps the record for a later try. 3 tests in `tests/app/tile-ipc.test.mjs`
  (2 failed before the fix). With it, `tiled-sections.mjs` passes whole on Windows.

- **Goal:** a tiled section can cover only source rows `y0`-`y1` of its stored image (`tiled.window`, X2a): the viewer, the mask tiles, the
  counts, the statistics, the source reads and the depths all work in the window's coordinates; a section without a window is unchanged.
- **Read first:** `serTiledSection` and `sectionRecord` (`app.js`), `loadTiledSection` (`tiledproject.js`), `createTiledView` (`tiledview.js`:
  tile placement and reads), `level0Rgba` and `sourceRoi`, `FORMAT_VERSION_TILED` and `readOnlyProject`; ARCHITECTURE §3.4; the saved-format
  section of `docs/TECHNICAL_DOCUMENTATION.md`.
- **Change:** those files and the technical documentation (format 7 and the window field, X4). The window starts on a multiple of 512 source rows
  (a mask-tile boundary); coarser pyramid levels are drawn with the window's offset in source pixels.
- **Do not touch:** the pyramid and mask-store formats, sections without a window, the interval table's formulas.
- **Model:** most capable, effort high (a saved-format change and every coordinate path of tiled sections).
- **Tests:** a section with a window over rows `[y0, y1)` and a section made from a source holding only those rows give identical masks, objects,
  statistics and interval table (exact equality, Node and `tests/e2e/tiled-sections.mjs`); a format-6 project opens and saves unchanged
  (byte-equal record); a format-7 project opens read-only in a build that knows only format 6 (simulated).
- **Done when:** the tests pass; development gate. Nothing in the interface creates a window yet.

- [x] **M8.4.43 - Split a tiled section into parts** (done 21 Nov 2026, development gate; [CHANGELOG](../CHANGELOG.md#unreleased); record: [history](roadmap-history.md#m8443---split-a-tiled-section-into-parts)).

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

- [x] **M8.4.9 - Section pixels resident in the engine** (done 22 Nov 2026, development gate; [CHANGELOG](../CHANGELOG.md#unreleased); record: [history](roadmap-history.md#m849---section-pixels-resident-in-the-engine)).

#### M8.4.10 - Record tables resident in the engine — state: Ready

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
- **Model:** most capable, effort medium (the engine helper validates tables that may be corrupt or hostile; bounded, exact tests).
- **Tests:** round trip of random tables with missing values, exact for every value and every missing slot; rejection cases for the
  helper; limits; the identity changes with any value, name or unit and with nothing else; a probe method that returns column sums.
- **Done when:** the tests pass and the probe through the real engine equals the interface's own sums.

#### M8.4.11 - Milestone gate of part B — state: after M8.4.10

- **Goal:** the milestone gate (Windows, macOS, Linux on one commit) for part B, and the memory and timing evidence of M8.4.9 (or of its
  replacement) repeated on the final commit. M8.5 may start only after this card and the milestone gate of part C (M8.4.19).
- **Model:** fast, effort low (running and recording the gate).

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

- [x] **Q1 - Deleting an ichnotaxon (P0)** (done 19 Nov 2026; record: [history](roadmap-history.md#q1---deleting-an-ichnotaxon-p0)).
- [x] **Q2 - The import panel and the readers** (done 20 Nov 2026; record: [history](roadmap-history.md#q2---the-import-panel-and-the-readers)).
- [x] **Q3 - Units** (done 20 Nov 2026; record: [history](roadmap-history.md#q3---units)).
- [x] **Q4 - Exports keep the data** (done 20 Nov 2026; record: [history](roadmap-history.md#q4---exports-keep-the-data)).
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
- [x] **P1 - Physical sizes, presets and PNG resolution** (done 20 Nov 2026; record: [history](roadmap-history.md#p1---physical-sizes-presets-and-png-resolution)).
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

### Cards of the third council (21 November 2026)

Runtime frontend + backend audit (status block). Part C / desktop-security / engine cards (`M8.4.38`–`M8.4.40`) sit above under part C;
web/frontend security, UI correctness and architecture cards sit here.

- [x] **Q9 - Sanitize `innerHTML` injection surfaces across project, data, ML and multiproxy views (P0 security)** (done 21 Nov 2026, development gate; record: [history](roadmap-history.md#q9---sanitize-innerhtml-injection-surfaces-across-project-data-ml-and-multiproxy-views-p0-security)).

- [ ] **Q11 - A hostile or old ML setting stops the classifier** (found by Q9, 21 Nov 2026; fast tier, effort medium). A project whose
  `settings.ml.k` is not a number, or whose `settings.ml.method` is unknown, makes the classifier fail with a page error (`learn.js` vote;
  `geo.js` `fitModel` reading `defaults`). *Change:* validate `settings.ml` (and the classifier `params`) where a project is loaded, falling back
  to the defaults with a visible note; *Tests:* Node tests with a non-numeric `k` and an unknown method; *Do not touch:* the classifier's
  results for valid settings. *Done when:* the tests pass and `tests/e2e/html-injection.mjs` can use hostile `k` and `method` too.

- [ ] **Q12 - A placeholder section cannot rebuild its working image after eviction** (found by M8.4.39, 21 Nov 2026; fast tier, effort medium).
  A tiled section kept as a placeholder after a failed engine opening (`placeholderSection` in `app.js`: `frozen: 'engine'`, no `tiled`) holds a
  grey `orig`; when `pxTouch` evicts it, `ensurePixels` calls `decodeWorking`, which throws the "locked" message, so the section shows an
  error instead of its grey image. *Change:* `ensurePixels` regenerates the grey image for a placeholder, as M8.4.39 did for `s.tiled.missing`;
  *Tests:* a desktop e2e step (or a Node test if the branch moves to a module) that evicts a placeholder and reopens it; *Do not touch:* the
  placeholder's saved record. *Done when:* the evicted placeholder reopens grey without an error.

- [ ] **Q14 - `tiled-sections.mjs` fails in the M8.4.43 split block on all three systems** (found by M8.4.9, 22 Nov 2026; most capable,
  effort high: mask syncing of split parts, where a mistake could lose user work). On `956f3e3` (M8.4.43) GitHub *Desktop builds* fails in
  `tiled-sections.mjs` on Windows and macOS (`AssertionError: window: labels`) and on Linux (run `44957994403`: `TimeoutError` waiting 120 s);
  on the maintainer's Windows workstation it times out at line 1464, the wait for every section's `_maskSync` to be settled after the split
  and folder-backup steps, on unmodified `956f3e3` too. The *As built* of M8.4.43 recorded the test as passing on Windows. Earlier commits
  (`89d080b` onwards) failed on macOS and Linux in another step ("reopened, no redraw by hand"). *Change:* diagnose and fix the cause (the
  window block logs `BUSY` as `lastError` on two sections); never widen the wait. *Done when:* `tiled-sections.mjs` passes on Windows locally
  and on the three systems on GitHub on one commit.
  *Progress (22 Nov 2026; Opus sub-agent, high, reviewed line by line):* two causes. (a) The timeout at line 1464 was a test defect: after
  the reopening in step (d), sections whose statistics came from their reopening cache keep `MaskSync` unsettled (tables not yet
  acknowledged) until a round, and only a save or an edit asks for one; the test now calls `saveNow()` before the unchanged wait (it passed
  before only when `writeReopenCaches` had not finished, a race). New Node test in `tests/app/tiledsync.test.mjs` pins that behaviour. The
  `BUSY` in the "Window block" log is a stale `lastError` of a retried round, not a stuck sync. (b) `window: labels` (line 1285, M8.4.42 block,
  GitHub Windows and macOS, also on `4676908`): in the cut section, one brush stroke landed 19 rows higher; the window section is correct.
  Not reproduced locally (4 runs, one at 4x CPU throttling). `draw` now asserts that the view, the canvas box and the layout above it do not
  move during a stroke, so the next CI run names what moved. Checks (Windows): `tiled-sections.mjs` passed twice in a row;
  `check_all --desktop --tiled` all passed (pytest 932 / 9 skipped, npm 633 / 0).
  GitHub run `44966181021` (`f7c1bb9`): on Windows and Linux the new check failed because the **top bar shrank from 66.7 to 48 px during
  the stroke** (canvas top 139.1 → 120.4 px, the 19 rows); macOS failed earlier at "reopened, no redraw by hand" (Q15). Not reproduced on the
  workstation, also with every hidden top-bar button shown and a 60-character save state at 1600 and 1200 px in both languages (new step in
  `tests/e2e/desktop.mjs`, which passes). `tiled-sections.mjs` now names each visible top-bar element with its height and text when the
  view moves, so the next GitHub run identifies the element that grows.
  GitHub run `44967861928` (`736d7af`): the mode buttons (`.seg`) grew from 31 to 50 px when the save state was long ("Saved on this
  computer · no folder backup"): "Core column" wrapped onto two lines; the new `desktop.mjs` step failed the same way on all three systems
  (48 → 66.7 px). **Fix:** `.seg button { white-space: nowrap; }` in `app/index.html`. Checks after the fix (Windows): `check_all --desktop
  --tiled` all passed. Open: the GitHub run of the fix (Windows and Linux expected green; macOS fails in Q15's step).

- [ ] **Q16 - The view canvas is taller than its visible pane and depends on the window's first size** (found by Q14, 22 Nov 2026; fast tier,
  effort medium). At 1600 x 1000 `#view` is 1754 px tall while about 860 px are visible (clipped by `.viewport`): the implicit grid row of
  `.viewport` is sized by the content and `resizeCanvases` copies `clientHeight` back into the canvas, so the height keeps the previous aspect
  ratio; the headless window opens at 884 x 561 before `setViewport`, which differs per system. `visibleSource` (tiles read) and `centerOn`
  (may centre off-screen) follow that height. Probable lead for Q15. *Change:* size the canvas from the visible pane; *Tests:* an e2e or DOM
  check that the canvas height equals the visible pane after resizes; *Done when:* the height follows the pane on every resize.

- [ ] **Q17 - Spurious "masks unsent" notices when three or more tiled sections send at once** (found by Q14, 22 Nov 2026; most capable,
  effort medium: concurrency of the engine bridge). `desktop/engine.js` refuses a third concurrent binary request (`mask.put`,
  `buffer.chunk`) with `BUSY`, for example at the first save after opening a project with several tiled sections; the round is retried and
  succeeds, but the user sees "masks unsent" then "masks sent" and the retry backs off. `lastError` is never cleared after a success.
  *Change:* queue binary requests (or let the page limit its concurrent sends) instead of refusing them, and clear `lastError` on success;
  *Done when:* a test with four tiled sections saving at once shows no refusal and no notice.

- [ ] **Q15 - `tiled-sections.mjs` failures that occur only on macOS and Linux** (asked by the maintainer, 22 Nov 2026; after Q14; most
  capable, effort medium: diagnosis across systems, through GitHub logs). From `89d080b` to `4676908` *Desktop builds* passed on Windows and
  failed in `tiled-sections.mjs` on macOS at "reopened, no redraw by hand: drawn pixel = source pixel" and on Linux (run `44951549785`, not
  diagnosed). *Read first:* the failing logs (`gh run view <id> --log-failed`), the reopened-viewer step of `tests/e2e/tiled-sections.mjs`,
  `.github/workflows/` (the *Desktop builds* job). *Change:* find the cause from the logs; fix the program if it draws wrongly there, or the
  test if it depends on Windows-only timing or colour handling, stating which and why (never widen a tolerance or a wait, AGENTS §3.7).
  *Done when:* after Q14, *Desktop builds* is green on Windows, macOS and Linux on one commit, or each remaining failure is recorded with its
  message and a decision of the maintainer.

- [ ] **Q10 - Data-tab edit precision, virtualized table cap, engine-refresh/CSV races & SVG PNG Blob export.**
  - *Goal:* fix verified runtime, UX and data-accuracy defects across the Data tab, Core log, Figures and pointer interactions.
  - *Read first:* `app/js/datatab.js` (`108, 176, 222-224, 266, 325, 346, 365`); `app/js/columns.js` (`53, 555, 618`); `app/js/app.js`
    (`1257, 1662, 1812, 1820, 4521`); `app/js/figures.js` (`124, 724, 965`); `app/js/multiproxy.js` (`1300`); `app/js/panels.js` (`44, 75`).
  - *Change:*
    1. `datatab.js`: capture `orig` from the raw numeric value in `c.proxies[col][i]` instead of the 6-decimal formatted `td.dataset.before`;
       remove the `dataLimit = 400` cap when virtualized `dataViewportOn` is active and cache `tableModel()` across scroll frames; store
       `data-core` and `data-col` separately so column names containing `|` delete cleanly.
    2. `app.js` & `columns.js`: stop `engineRefresh` (`app.js:1257`) from calling `setMode(mode)` while editing in `data`/`fig`/`geo` (refresh
       only the results/log/figure safely); await `analyzeSections(S.sections)` before exporting `logCSVBtn` (`columns.js:555`); guard
       `recList` deletion (`columns.js:618`) against `findIndex === -1`.
    3. `figures.js`, `datatab.js`, `multiproxy.js`: guard `autoPick(..., 'typical')` against null `o.feat`; replace `data:image/svg+xml` +
       `encodeURIComponent(svg)` PNG export with Blob `ObjectURL` (revoked in `finally`).
    4. `panels.js`, `app.js`: add `pointercancel` cleanup wherever `pointerup` clears drag state/listeners.
  - *Do not touch:* scientific formulas, CSV format (Q4), virtualized-table default flag.
  - *Model:* fast tier, effort medium (bounded fixes with focused unit and smoke tests).
  - *Tests:* Node tests for small-value (`1.23e-8`) edit + restore, column name with `|`, `autoPick` with null `feat`, `recList` missing-id guard;
    smoke/e2e test scrolling a 10,000-row virtualized table without clicking "Show more" and exporting a large PNG via Blob URL.
  - *Done when:* all new tests plus `npm test`, `npm run typecheck` and `tests/e2e/smoke.mjs` pass; development gate.

- [ ] **A4 - Modular decomposition of remaining `app.js` workflows (post-M8.4.19).**
  - *Goal:* reduce `app.js` from 4,664 lines to wiring only by extracting the remaining cohesive controller workflows into dedicated modules, one
    per commit, lowering `APP_JS_CEILING` in `tests/app/architecture.test.mjs` with each step.
  - *Read first:* `docs/ARCHITECTURE.md §3`; `tests/app/architecture.test.mjs`; `tools/build_standalone.py` (`ORDER`); `app/js/app.js`.
  - *Change:* extract (1) `mlpanel.js` (classifiers, evaluation, vision embeddings, trainer dialog), (2) `projectio.js` (library, save/backup/
    package, comments, home, all-projects, multi-project), (3) `viewtools.js` (canvas rendering, pointer tools, crop, overlays), updating `ORDER`
    in `tools/build_standalone.py`, `docs/ARCHITECTURE.md` and `docs/TECHNICAL_DOCUMENTATION.md §1.4`.
  - *Do not touch:* scientific behaviour, saved project format, DOM IDs, test hooks on `window.ichantool`.
  - *Model:* fast tier, effort medium (behaviour-preserving moves, verified one module per commit).
  - *Tests:* `npm test` (including `architecture.test.mjs` with lowered ceiling), `npm run typecheck`, standalone build, `tests/e2e/smoke.mjs`
    and `tests/e2e/desktop.mjs`.
  - *Done when:* `app.js` is under 1,500 lines and only wires modules, with all suites green; development gate.

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
- [x] **H5 - The `e2e` job of the GitHub workflow was red from 10 November 2026 to 14 November 2026; fixed on the work branch** (record: [history](roadmap-history.md#h5---the-e2e-job-of-the-github-workflow-was-red-from-10-november-2026-to-14-november-2026-fixed-on-the-work-branch)).
- [x] **H6 - A working resolution that does not fit in memory made the window go blank** (record: [history](roadmap-history.md#h6---a-working-resolution-that-does-not-fit-in-memory-made-the-window-go-blank)).
- [x] **H7 - A 16-bit image above about 28 megapixels made the page die while it was decoded** (record: [history](roadmap-history.md#h7---a-16-bit-image-above-about-28-megapixels-made-the-page-die-while-it-was-decoded)).
- [x] **H8 - Shorten the roadmap** (record: [history](roadmap-history.md#h8---shorten-the-roadmap)).
- [x] **H9 - One command for the full checks, with a short report** (record: [history](roadmap-history.md#h9---one-command-for-the-full-checks-with-a-short-report)).
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
