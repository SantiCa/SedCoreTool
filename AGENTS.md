# Contributor and AI-assistant guide

This file is the **only source of working rules**, shared unchanged by human contributors and every AI assistant.
`CLAUDE.md` and `GEMINI.md` contain only an import of this file; if your client does not expand imports, open
`AGENTS.md` yourself. It holds rules that rarely change. The current state lives in the roadmap, the structure in
the architecture document and the commands in the development guide (§2).

Owner and maintainer: Santiago Casanova-Arenillas. **Reply to the owner in Spanish.** Everything committed to the
repository (code, comments, documents, commit messages) is written in English.

## 1. Every session, in this order

1. **Read the state:** [docs/roadmap.md § Status and handoff](docs/roadmap.md#status-and-handoff). It names the
   branch, the last verified commit, checks still due and the next task card.
2. **Check the checkout:** `git status --short --branch`. On a clean tree, stay on the branch the status names. A
   dirty tree may be someone else's work: do not stash, reset, clean, discard or switch branches; ask.
3. **Run pending checks first** if the status says "checks pending" (§5.4).
4. **Find the task card** for what the maintainer asked (§6). No card and the request is not trivial: write the
   card first, or ask.
5. **Read only what the card lists** under "Read first". You rarely need whole documents.
6. **Make the change** following §3 and §4. Run focused checks as you go.
7. **Document in the same commit** (§5.2) and **commit on the branch** with explicitly named files.
8. **Update the roadmap status** (commit, checks run, next step, open questions).
9. **Report to the maintainer in Spanish** (§7).

## 2. The project and its documents

SedCoreTool quantifies bioturbation and ichnotaxa in sediment-core images and combines them with other down-core
records.

| Part | Path | Language |
|---|---|---|
| The program: interface, editing, saving, and today's calculations | `app/` (web application), `desktop/` (Electron shell and packaging) | JavaScript, no build step |
| The Python package `sedcoretool` (API and command line) | `src/sedcoretool/` (`src/ichantool/` is a compatibility alias) | Python ≥ 3.10 |
| The scientific engine process, experimental and off by default | `src/sedcoretool/engine/`, started by `desktop/engine.js` with a bundled runtime | Python 3.12 |
| Reference version 2.1 (2019) | `legacy/` | never modify |

**Direction (decided by the maintainer, 12 November 2026):** each scientific method is implemented once, in
Python, and runs in a local engine process; the Electron/JavaScript interface requests and displays results. The
migration is milestone M8 and is **not finished**: the interface still calculates in JavaScript.

| Question | Document |
|---|---|
| What is the next task, what is its state, what was decided? | [docs/roadmap.md](docs/roadmap.md) |
| Where does code go, which layer may import which, how do I add a method or split a module? | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Which command builds, runs, tests, packages or measures? What does this error mean? | [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) |
| What exactly does a method compute (formulas, defaults, formats)? Which file holds what? | [docs/TECHNICAL_DOCUMENTATION.md](docs/TECHNICAL_DOCUMENTATION.md) (§1.4 source map) |
| Engine protocol, method inputs and results, acceptance gates | [docs/roadmap-engine-contract.md](docs/roadmap-engine-contract.md) |
| Later milestones and ideas not scheduled yet | [docs/roadmap-future.md](docs/roadmap-future.md) |
| How and when was a finished task delivered? | [docs/roadmap-history.md](docs/roadmap-history.md) (read only when a card asks) |
| What changed in each version | [CHANGELOG.md](CHANGELOG.md) |
| What the software is for and how to use it | [README.md](README.md) |
| Text of the GitHub Release · security policy · software paper | `desktop/RELEASE_NOTES.md` · [SECURITY.md](SECURITY.md) · `paper/` |

Do not repeat content between documents; link. Keep the tone factual: a document states what is true now, what
was measured and what was not.

## 3. Hard limits

Never do any of these without an explicit request from the maintainer in the current conversation.

1. **Push, tag, publish, create a version number or change `master`.** Work stays in local commits on the work
   branch. Never force-push.
2. **Modify `legacy/`.**
3. **Commit unpublished or private data.** The repository holds only public example data.
4. **Rename compatibility identifiers:** browser storage keys `ichantool.*` and `corantool.*`, the IndexedDB
   database `ichantool`, the desktop origin `app://corantool`, `window.corantoolDesktop`, the `ichantool` Python
   alias. Keep reading project files written as `IchAnTool` or `CorAnTool` and `.corantool` packages. Users would
   lose their projects.
5. **Break a public interface** (Python functions, command-line options, file formats, saved-project fields).
   An approved breaking change needs a documented migration path and regression tests for supported inputs.
6. **Enable the engine experiment by default, let it search for a system Python, download dependencies at run
   time, or fall back silently to another scientific implementation.** A failure must be visible.
7. **Make a failing check pass by weakening it:** no relaxed tolerances, widened deadlines, skipped or deleted
   tests, or reduced integrity checks. Record the failure with its measurement and ask.
8. **Start work that was not asked for:** unrelated refactors, audits, dependency upgrades, backlog items,
   sub-agents or automations.
9. **Add a dependency** without stating the capability it adds, the smallest alternative considered and its cost
   for offline and desktop distribution.

## 4. Rules for code

- **Structure.** Follow the layers and import rules of [docs/ARCHITECTURE.md §3](docs/ARCHITECTURE.md#3-layers-and-dependency-rules).
  New scientific methods are written once, in Python; the interface requests and displays their results. Existing
  JavaScript calculations change only to fix or preserve current behaviour until their M8 slice replaces them.
  `app.js` only shrinks. Keep the engine protocol, method contracts and result formats free of Electron and
  renderer details; Electron-specific code stays in `desktop/`.
- **Modularity and review cost.** The maintainer requires a modular, understandable and easily editable program.
  One module, one responsibility, explicit inputs and outputs. A reviewer must be able to find a behaviour and
  understand its contract without reading the whole application. Prefer small, independently verifiable diffs.
- **Clean code.** Names from the domain that reveal intent and carry units. Functions with one level of
  abstraction and visible side effects. The simplest design that supports the behaviour. Comments explain why,
  not what. Validate at boundaries and keep useful error context.
- **Shared definitions.** While both implementations exist, interval limits, percentages, indices and depth
  mapping must be identical in Python and in `app/js/core.js`; U-Net tiling likewise (`unet/tiling.py`,
  `app/js/unet.js`). The regression test against `legacy/v2.1_console/example_output.csv` must keep passing.
- **Pure JavaScript modules** (listed in ARCHITECTURE §3.2) must not use the DOM, so Node can test them. A new
  module is added to `ORDER` in `tools/build_standalone.py`; top-level names must not clash across modules.
- **Tests with every behaviour change.** For scientific code: compare with reference results on representative
  inputs and edge cases; exact equality where the quantity is discrete; any tolerance is stated and justified
  **before** comparing. A requested scientific change is tested against its new expected results and unaffected
  outputs must stay equivalent. Use property-based tests for critical invariants where they fit. Document-only
  edits need no new tests.
- **Safe input and output.** Treat files and messages as corrupt, oversized or hostile until validated; bound
  resource use. Project saves use transactions (IndexedDB) or a temporary file with atomic replacement. Verify that
  a failed write preserves the last good save.
- **Performance claims** need a reproducible benchmark that records inputs, environment and measured quantities.
- **Incremental delivery.** Split broad changes into small, independently testable deliveries. Put a major change
  behind a flag that is off by default, keep the current path as the default until the new one passes its
  criteria, and record the flag in the roadmap's flag table (ARCHITECTURE §5.3).
- **Interface text** goes in `app/js/i18n.js`, in Spanish and English.

## 5. Delivering a change

Session work happens on a branch; a version is created only when the maintainer asks.

1. **Work branch.** Continue the branch named in the roadmap status, or create `work/<YYYY-MM-DD>` from `master`.
   Commit with descriptive messages and explicitly selected files. Do not change the version number on the branch.
2. **Documents in the same commit as the change:**
   - `CHANGELOG.md`, under `## Unreleased`: a short bullet under **"For users"** when what a user sees, does or
     gets changes (say what changed for them, not how the work was organised), or under **"Internal"** for tools,
     tests, refactors and documents.
   - `docs/TECHNICAL_DOCUMENTATION.md` when an algorithm, formula, default, file format or validation result
     changes. Formulas there must match the code exactly. It describes current behaviour: no history, no notes to
     reviewers.
   - `docs/ARCHITECTURE.md` when a layer, boundary or planned part changes state; the technical manual's source
     map (§1.4) when a file is added, removed or changes role.
   - `README.md` when what users see or do changes.
3. **Checks during the session:** quick, focused checks for what changed. Not the full suite after every request.
4. **End of session:** run the full checks once, one after another (commands in
   [docs/DEVELOPMENT.md §3](docs/DEVELOPMENT.md#3-checks)), and record result and commit in the roadmap status. If
   the session ends first, record **checks pending** with branch and commit; the next session runs them first. Do
   not repeat them on an unchanged, verified state.
5. **New version, only when the maintainer asks:** next number `V0.<n>` after the top versioned entry of
   `CHANGELOG.md`. Set `DELIVERY` in `app/js/app.js`, run `python tools/sync_version.py`, rename `## Unreleased`
   to `## V0.<n> — YYYY-MM-DD`, make sure the full checks pass on the final state (and, when the version closes a
   milestone, that its milestone gate passed on that state; §6), and integrate the branch into
   `master` as one commit `V0.<n>: <summary>`. Version 1.0 is reserved for when the owner declares the program
   complete.
6. **Releases** (tags, GitHub Release, DOI) are decided only by the owner; see DEVELOPMENT §8.

## 6. Working on a task

**Task cards.** Work in the roadmap is described by cards with this shape:

```
#### <ID> - <title>            state: Ready | In progress | Blocked | Done
Goal:         one or two sentences: what will be true afterwards.
Read first:   the few files and document sections needed. Nothing else is required reading.
Change:       files to create or modify.
Do not touch: files and behaviours that must stay as they are.
Steps:        ordered, each small enough to verify on its own.
Tests:        the tests to add and the commands that must pass.
Done when:    observable acceptance criteria.
```

- **Two roles.** *Designing* (deciding structure, contracts, acceptance criteria; writing or changing cards) and
  *implementing* (carrying out one card exactly). A design session is run with the most capable model available or
  by the maintainer. An implementing session, with any model, does not redesign: if the card is wrong, incomplete or
  blocked, stop, write the problem under the card ("Blocked: …") and in the status, and report it.
- **One card at a time,** in roadmap order, and only the card the maintainer authorised. Finish or hand over
  before starting another. If a request combines independent workstreams, split it into cards and do the first.
- **Interpret a broad request by intent:** choose the smallest concrete scope that satisfies it, state the
  assumption, continue. Ask only when the goal or a consequential choice cannot be inferred.
- **Stop and ask when:** an acceptance criterion cannot be met; a hard limit (§3) is in the way; the change would
  alter scientific results, a saved-project format or a public interface; a new dependency seems necessary; you
  would have to edit files outside the card; or a test you did not write fails and a focused diagnosis does not
  explain it.
- **Three acceptance levels.** The *development gate* lets work continue to the next card: the card's tests and the
  session checks pass on the maintainer's workstation and the feature stays behind its flag. The *milestone gate*
  closes every milestone (for example M8.3 before the first card of M8.4) and every slice of M8.5: the GitHub
  workflows `tests` and *Desktop builds* (started by hand on the work branch, `draft_release` off) pass on Windows,
  macOS and Linux on the same commit, including the desktop end-to-end test with the engine experiment on and off
  and the package check; each failure is fixed, or recorded with its message and a decision of the maintainer,
  before the next milestone starts. The *release gate* is required before a flag is switched on by default or a
  version is published to users: every supported platform, clean machines, and the performance and recovery gates
  of the engine contract §7. A card states which gate it claims. Never report a release gate as met from
  development or milestone evidence.
- **One editor at a time** on the shared checkout, even for different files. All assistants work in this same
  local folder, so handoffs are local commits plus the roadmap status; nothing is pushed unless asked.

## 7. Handoff and reporting

- At every reviewable checkpoint the work is committed and the roadmap status names the branch, the commit, the
  checks run and the next step. A new session must be able to continue from the repository alone, without any
  chat history.
- When a card is done: mark it, link its changelog entry, move its long record to `docs/roadmap-history.md` and
  leave one line in the roadmap.
- **Report to the maintainer in Spanish, briefly:** the result; how it was checked; branch and commit (or version
  number when one was created); how the change fits into SedCoreTool (which components it touches and how data or
  control passes between them); and what is genuinely pending, including checks not run and things not measured.
- **Be exact about evidence.** Say what was tested, on which platform, and what was not. A configured CI job is not
  a job that ran. A planned part is never described as available.
