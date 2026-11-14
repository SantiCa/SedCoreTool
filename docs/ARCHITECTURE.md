# Architecture

The designed structure of SedCoreTool: what exists, what is planned, the rules that keep the parts apart and
step-by-step recipes for the common kinds of change. Read the section that matches your task; you do not need
the whole file.

| You need | Read |
|---|---|
| Working rules and the checklist for every session | [AGENTS.md](../AGENTS.md) |
| What to do next and the state of each task | [roadmap.md](roadmap.md) |
| Formulas, defaults, file formats, the file-by-file source map | [TECHNICAL_DOCUMENTATION.md](TECHNICAL_DOCUMENTATION.md) (§1.4 is the source map) |
| Wire protocol, input/result contract of engine methods, acceptance gates | [roadmap-engine-contract.md](roadmap-engine-contract.md) |
| Commands to build, run, package and measure | [DEVELOPMENT.md](DEVELOPMENT.md) |

Words used here: **built** = in the repository and tested; **planned** = designed here, not yet written. Never
describe a planned part as available. When you build a planned part, change its label in this file in the same commit.

## 1. The system in one picture

```
┌─────────────── Renderer: app/js (sandboxed web page, JavaScript ES modules) ──────────────┐
│  views (DOM only)  ◄──►  controllers (app.js and tab modules)  ◄──►  pure modules (no DOM) │
│                                        │                                                   │
│        sectionanalysis.js · engineclient.js · engineanalysis.js (built, all pure)          │
└────────────────────────────────────────┼──────────────────────────────────────────────────┘
              window.corantoolDesktop  (desktop/preload.js: a short allowlist of calls)
┌─────────────── Electron main process: desktop/ (Node.js) ─────────────────────────────────┐
│  main.js (window, app:// protocol, lifecycle)   engine-ipc.js (renderer-facing)           │
│  engine.js (process client)  engine-protocol.js (frames)  engine-runtime.js (integrity)    │
│  trainer.js · model-store.js · diagnostics.js                                              │
└────────────────────────────────────────┼──────────────────────────────────────────────────┘
                    private stdin/stdout pipes, `SCE1` frames, no network port
┌─────────────── Engine process: src/sedcoretool run by the bundled CPython 3.12 ───────────┐
│  engine/    transport only: frames, buffers, coordinator, job runner, method worker script │
│  methods/   one module per versioned scientific method (built: section.intervals/1)        │
│  kernels/   pure NumPy primitives shared by every caller (built)                           │
└────────────────────────────────────────────────────────────────────────────────────────────┘
   Python API and command line (pipeline.py, cli.py, batch.py …) call kernels/methods in-process.
   They never start the engine process.
```

The goal of milestone M8 is **one implementation of each scientific method**, written in Python, used by the
desktop program (through the engine process), by the Python API and by the command line. JavaScript keeps
interaction, drawing, editing and saving. Today, with the engine experiment off (the default), the renderer still
calculates everything itself; with it on, the interval table of each section comes from the engine method
`section.intervals/1` (M8.3) and every other calculation still runs in JavaScript.

## 2. What is built and what is planned

| Part | State | Where |
|---|---|---|
| Renderer with its own JavaScript calculations (the supported path) | built | `app/js/` |
| Offline single HTML file and browser use | built; frozen at the M8.6 cutover | `tools/build_standalone.py` |
| Python package: intervals, indices, age, export, batch, CLI, U-Net | built | `src/sedcoretool/` |
| Engine process: frames, bounded buffers, queue, cancellation, isolated worker | built, off by default | `src/sedcoretool/engine/`, `desktop/engine*.js` |
| Bundled Python runtime, verified at launch | built (Windows measured; macOS/Linux not yet run) | `desktop/runtime-lock.json`, `tools/prepare_engine_runtime.py` |
| Engine methods: `buffer.digest/1` (a transport diagnostic) and `section.intervals/1` (the first scientific method) | built | `engine/worker.py`, `engine/method_worker.py` |
| `kernels/` package: binning, counting, classification, age interpolation; `tests/test_architecture.py` | built (M8.3.3) | §3.1 |
| `methods/` package with the registry and `section.intervals/1`, called directly | built (M8.3.4) | §3.1 |
| Job runner in the engine process: `section.analyze` runs a registered method in the engine's long-lived worker process (one job at a time, replaced after any anomaly), results are adopted as committed buffers and downloaded with `buffer.read` | built (M8.3.5) | §3.1, §4 |
| Renderer-facing engine bridge (`engine-ipc.js`, `engineclient.js`, `engineanalysis.js`) | **built, experimental, off by default** (M8.3.6–M8.3.7) | §3.2, §3.3 |
| Section intervals calculated by the engine (`section.intervals/1`) and shown by the interface | **built, experimental, off by default** (M8.3.7); slower than JavaScript, see the M8.3.8 evidence | contract §4–§5 |
| Section inputs kept resident in the engine between analyses, remaining methods | **planned** (M8.4, M8.5) | roadmap |

The engine experiment is enabled only by the environment variable `SEDCORETOOL_ENGINE_EXPERIMENT=1`. Keep that
default until M8.6.

## 3. Layers and dependency rules

A rule of the form "A may import B" means the reverse import is forbidden. If a change seems to need a forbidden
import, the code is in the wrong layer: move the code, do not break the rule.

### 3.1 Python (`src/sedcoretool/`)

| Layer | Path | Contains | May import | Must not |
|---|---|---|---|---|
| Kernels (built, M8.3.3) | `kernels/` | Pure array functions: bin edges and sums, row/class counts from labels, layers and overlap stacks, tier classification, age interpolation | `numpy`, standard library | pandas, Pillow, file or network IO, environment variables, global state, anything from `engine/` or `methods/` |
| Methods (built, M8.3.4) | `methods/` | One module per versioned method. Each has `NAME` (for example `"section.intervals/1"`), `parse(inputs) -> snapshot` that validates everything, and `run(snapshot, report, cancelled) -> dict` of named NumPy columns. `registry.py` maps names to modules | `kernels`, `numpy`, standard library | pandas, IO, transport details (frames, handles, sessions) |
| Engine transport | `engine/` | `protocol.py` frames and strict JSON, `buffers.py` staged buffers, `server.py` coordinator, `worker.py` process wrappers (`DigestJob`; `MethodRunner`, the long-lived method worker, and `MethodJob`, one job on it) and the digest script, `specs.py` input tables, `method_worker.py` the script that runs a method, `lifetime.py` | Coordinator: standard library only. Only the script `method_worker.py` imports `numpy`, `kernels` and `methods` (it runs in its own process and registers the package without running its `__init__`, so pandas and Pillow are not loaded); nothing else may import it | The coordinator must never import NumPy or a method (start-up stays fast and control requests stay responsive). No scientific formulas in this layer |
| Public API and CLI | `pipeline.py`, `indices.py`, `depth.py`, `io.py`, `segmentation.py`, `export.py`, `batch.py`, `cli.py`, `plotting.py` | The supported functions and commands. Adapters: validate user input, call kernels/methods, shape the output (DataFrame, CSV, LAS) | `kernels`, `methods`, pandas, Pillow | Starting the engine process; a second copy of a formula that exists in `kernels/` |
| U-Net (optional) | `unet/` | Tiling, dataset, training, prediction, evaluation. Unchanged until M8.5 | its own optional dependencies | being imported by the base engine |

How the layers are created without breaking anyone: when a formula moves into `kernels/`, the public module keeps
its function name and signature and delegates to the kernel (`pipeline.bin_edges` keeps working). Existing tests
must pass unchanged; that is the proof that the move preserved behaviour. `tests/test_architecture.py` (built in
M8.3.3) reads the imports of every module with `ast` and fails when a rule in this table is broken.

Public and desktop callers may need different conventions for the same primitive. They are parameters of the
kernel, not two implementations. Known case: with overlapping custom index tiers the desktop uses the **first**
matching tier and the Python API the **last**; the kernel takes `precedence="first" | "last"` (contract §4).

### 3.2 Renderer (`app/js/`)

| Kind | Rule | Examples |
|---|---|---|
| Pure modules | No `document`, `window` or DOM types; state arrives as arguments. Tested with Node in `tests/app/` | `core.js`, `sectiondepth.js`, `sectionanalysis.js`, `engineclient.js`, `engineanalysis.js`, `edit.js`, `imageproc.js`, `learn.js`, `log.js`, `geo.js`, `interp.js`, `locmap.js`, `plot.js`, `sheet.js`, `exportio.js`, `zip.js`, `unet.js`, `unetmodel.js`, `navpreview.js`, `figview.js`, `tableview.js` |
| State | The shared project state `S` and small helpers | `state.js` |
| Controllers and views | Read and change `S`, call pure modules, build DOM/SVG, wire events | `app.js`, `columns.js`, `datatab.js`, `figures.js`, `multiproxy.js`, `panels.js`, `diagnostics.js` |
| Storage | IndexedDB project library | `storage.js` |

Rules:

1. **No new scientific calculation in JavaScript.** New methods are written in Python (§5.1). Existing JavaScript
   calculations change only to fix or preserve current behaviour, until their M8 slice replaces them.
2. **`app.js` only shrinks.** It has about 4,200 lines and mixes many workflows. A task that changes a workflow
   inside `app.js` first moves that workflow's logic into a pure module, without changing behaviour (§5.2), then
   makes its change there. Do not add new logic to `app.js` beyond wiring.
3. A pure module never imports a controller. Controllers may import each other only for names used inside
   functions (see the note on circular imports in the technical manual §1.4).
4. Every module is listed in `ORDER` in `tools/build_standalone.py`, and top-level names must be unique across
   modules, because the offline HTML is built by concatenating them. Modules live flat in `app/js/` (no subfolders).
5. Interface text goes in `i18n.js`, in Spanish and English.

Pure modules for M8.3:

- `sectionanalysis.js` — **built** (M8.3.1, M8.3.2, M8.3.7): everything about analysing one section that does not
  need the DOM: the effective class of each object, the legacy calculation that used to live in `app.js::analyze`
  (moved, not rewritten) and its row-count cache, the revision key of the scientific inputs (`analysisRevision`),
  the engine snapshot of contract §4 (`buildIntervalSnapshot`) and the conversion of an engine result into the
  existing `s.bins` array (`resultToBins`), so that tables, columns, figures and exports do not change.
- `engineclient.js` — uploads typed arrays in chunks of at most 1 MiB, starts and cancels jobs and downloads
  results through an injected bridge object. In the desktop program the bridge is `window.corantoolDesktop.engine`;
  in Node tests it is a fake.
- `engineanalysis.js` — per-section state with the engine on: pending, ready or error. It keys each request on
  `analysisRevision`, empties `s.bins` while a result is awaited, queues one analysis at a time, cancels a request that
  an edit made obsolete and publishes a result only if the revision is still current. It never computes bins and never
  falls back to the JavaScript calculation. `app.js::analyze` delegates to it when `window.corantoolDesktop.engine.enabled`.

### 3.3 Electron main process (`desktop/`)

| File | Responsibility |
|---|---|
| `main.js` | Window, `app://corantool` protocol, lifecycle; creates the services and registers their IPC handlers |
| `preload.js` | Names the calls the page may make and passes their arguments. No logic, no validation |
| `engine.js` | `EngineClient`: spawn, handshake, request queue, timeouts, forced termination, binary reply of `buffer.read`. `createEngineService`: start/stop/status and `request` for `engine-ipc.js` |
| `engine-protocol.js` | Frame encoding and the strict control-frame reader |
| `engine-runtime.js` | Verifies the bundled runtime and sources before Python is executed |
| `engine-ipc.js` (M8.3.6) | The only renderer-facing entry to the engine: checks the sender's origin, argument shapes and sizes; streams buffers in bounded chunks; keeps the table of handles for the session. The page never chooses paths, executables or arbitrary operations |
| `trainer.js`, `model-store.js` | Optional U-Net training environment and published model generations |
| `diagnostics.js` | Opt-in technical diagnostics |

**Shell independence.** Electron may be replaced later (roadmap M9.1). Therefore nothing under `src/sedcoretool/`
and nothing in the wire protocol or the method contracts may mention Electron, IPC channels or the renderer.
Everything Electron-specific stays in `desktop/`.

## 4. Path of one scientific request (built in M8.3)

Example: the user edits a trace and the interval table must update.

1. **Controller** (`app.js`) calls the analysis entry point for the section.
2. **`sectionanalysis.js`** computes the section's *revision* (it changes whenever any scientific input changes:
   mask edits, ROI, calibration, class assignments, counted classes, prediction threshold, interval size, index
   schemes, age model, manual indices) and builds an immutable *snapshot*: typed arrays and small JSON tables
   exactly as contract §4 defines them. Nothing is computed about classes or counts in JavaScript.
3. **`engineclient.js`** hashes and uploads each buffer through the bridge in chunks, then requests
   `section.analyze`.
4. **`engine-ipc.js`** validates the request and forwards it with `EngineClient.request`.
5. **Coordinator** (`engine/server.py`) validates the envelope, pins the input buffers and queues the job. The
   **job runner** sends the long-lived worker (started on the first job, replaced after any anomaly, stopped when idle) a job description (method name, input buffer files with dtype and
   shape, output folder, cancel flag file).
6. **Worker** (`engine/method_worker.py`) loads the method from `methods/registry.py`, calls `parse` (rejects anything
   invalid before computing) and `run`, and writes each result column as a buffer file. It polls the cancel flag
   between bounded work units and never publishes a partial result.
7. The coordinator adopts the worker's single packed result file as one committed buffer and answers with its handle, the
   layout of the columns in it, the dimensions and provenance. The main process downloads it (`buffer.read`) and the page cuts it up
   by the layout; every handle of the job is released afterwards.
8. **`sectionanalysis.js`** validates the result (dimensions, revision, settings hash) and converts it to the
   `s.bins` shape. The controller publishes it **only if the section's revision is still the one requested**, then
   runs the same redraw calls as today. A stale, cancelled or failed job changes nothing.

Rules of this path:

- **No silent fallback.** With the experiment on, a failed job shows an error state; it never recomputes with the
  JavaScript calculation. With the experiment off, only the JavaScript calculation runs. There is no per-job choice.
- **The renderer owns live editing and saved projects** until M8.4. The engine never reads or writes project
  files, and a runtime or engine failure must not change live results or the last good save.
- **Synchronous callers, asynchronous engine.** The seven call sites of `analyze(s)` still call it synchronously.
  With the experiment off it fills `s.bins` before returning. With it on it only requests the analysis and leaves the
  section pending (no bins); `engineanalysis.js` calls the controller's `onChange` when a result is published, which
  redraws, and exports await `analyzeSections(sections)` so they never write a pending section (decided in M8.3.7
  instead of turning every render path asynchronous).
- **Every analysis uploads every input today.** The label image and the exclusion mask (about 30 MB for a
  6-Mpixel section) cross the page, the main process and the engine for every revision, even when only a setting
  changed. This is most of the measured time (M8.3.8); M8.4 keeps them resident in the engine.
- Buffers and metadata never travel as JSON arrays or base64. Missing values travel as a value column plus a
  `<name>_valid` column, never as NaN or a magic number.

## 5. Recipes

### 5.1 Add or migrate a scientific method

Follow the steps in order; each step is one small commit with its own tests.

1. **Contract.** Add the method to [roadmap-engine-contract.md](roadmap-engine-contract.md): name and version,
   inputs, outputs, exact semantics, tolerances. State tolerances before comparing anything.
2. **Reference fixtures from the current implementation.** Write `tools/make_<method>_fixtures.*` that runs the
   existing calculation on small public or generated inputs and saves inputs and outputs under
   `tests/fixtures/<method>/`. Cover the edge cases the contract lists. Never use private data.
3. **Kernels.** Write or move the primitives in `kernels/` with unit tests. Existing public functions delegate.
4. **Method.** Write `methods/<method>.py` (`NAME`, `parse`, `run`), add it to `registry.py`, and add a test that
   runs it directly on every fixture and compares with the reference: exact for counts, row bounds, indices and
   missing-value patterns; the declared tolerance for floating-point values.
5. **Engine.** Advertise the method in `hello`; add a transport test that sends a fixture through the real
   coordinator and worker and gets the same result; test cancellation and an invalid input.
6. **Main process.** Add the narrow call to `engine-ipc.js` and `preload.js`, with origin, shape and size checks and
   Node tests.
7. **Renderer.** Add the snapshot builder and result adapter to a pure module, wire the controller under the
   experiment flag, and extend the desktop end-to-end test.
8. **Documents.** Technical manual (what the method computes and where), changelog, roadmap task card, and the
   built/planned table in §2 of this file.
9. **Only at M8.6:** delete the JavaScript calculation and its duplicate tests, keeping the fixtures.

Replacing a method with a library's different defaults is not a migration: outputs must match the reference, or
the difference must be an explicit, documented decision of the maintainer.

### 5.2 Move a workflow out of `app.js`

1. Pick one workflow (for example "analyse a section"). List the functions and the pieces of `S` they read.
2. Create `app/js/<workflow>.js`. Move the functions; replace reads of `S` and of the DOM by parameters. Do not
   change any formula, default or order of operations.
3. In `app.js`, keep the old names as one-line wrappers that pass the state in. Callers stay unchanged.
4. Add the module to `ORDER` in `tools/build_standalone.py` (before every module that imports it) and to the source
   map in the technical manual §1.4. Add it to `tsconfig.strict.json` if it type-checks without new diagnostics.
5. Tests: a Node test in `tests/app/<workflow>.test.mjs` for the moved functions; `npm test`, `npm run typecheck`
   and `python tools/build_standalone.py` must pass; run the browser smoke test when the workflow is visible.

Earlier examples to imitate: `unetmodel.js` (R1) and `sectiondepth.js` (R2).

### 5.3 Add, promote or remove an experimental flag

A large change runs behind a flag that is off by default. Every flag has a row in the roadmap's flag table with:
the task that owns it, how it is switched, the condition for promotion and the condition for removal. A flag
without a decision is a cost: when its task ends, the task card must say "promote", "remove" or "keep until
\<condition\>". Do not add a flag without adding its row.

## 6. Conventions that apply everywhere

- **Units and coordinates.** Names carry units (`bin_cm`, `depth_top`). Intervals are half-open `[start, end)`.
  Row 0 is the top of the image. Coordinates are original-image pixels; counts are never made on a reduced image.
- **Shared definitions.** While both implementations exist, interval limits, percentages, indices and depth
  mapping must be identical in `app/js/core.js` and in Python; U-Net tiling likewise (`unet/tiling.py`,
  `app/js/unet.js`). The regression against `legacy/v2.1_console/example_output.csv` must keep passing.
- **Errors.** Engine errors use the fixed codes of contract §3 and carry field names and limits only: no file
  paths, image content, table values or tracebacks. The interface shows a translated message from
  `engine.error.<CODE>` keys in `i18n.js`.
- **Bounds first.** Every boundary (file import, IPC call, engine request, buffer) validates sizes and shapes
  before allocating or computing, and has a stated maximum.
- **Determinism.** A method with randomness declares its seed, generator and version in the contract.
- **Saving.** Project saves use transactions (IndexedDB) or a temporary file plus atomic replacement (files). A
  failed write must leave the last good save intact, and a test must show it.
- **Where tests live.** Python: `tests/test_*.py`. Pure JavaScript and main-process modules: `tests/app/*.test.mjs`.
  Real browser or Electron: `tests/e2e/*.mjs`. Fixtures: `tests/fixtures/`. Measurements and their evidence:
  `tools/measure_*.mjs`, `tools/benchmark*.py|mjs` and `docs/validation/`, `docs/benchmarks/`.

## 7. Decisions on record

Do not reopen these without the maintainer; build on them.

| # | Decision | Date |
|---|---|---|
| D1 | One local Python/NumPy scientific engine in a separate process; JavaScript keeps interface, editing and saving | 12 Nov 2026 |
| D2 | Electron is the interface shell for now; protocol and methods stay shell-independent so it can be replaced after M8.6 | 12 Nov 2026 |
| D3 | Private pipes with bounded binary frames; no HTTP server, no listening port | M8.1 |
| D4 | A pinned CPython 3.12 runtime with NumPy, pandas and Pillow ships inside the program; no system Python, no downloads at run time, no silent fallback when it is invalid | M8.2.2 |
| D5 | Every runtime file is verified at launch; a verified-identity record skips re-hashing while files are unchanged; unused files are pruned from the runtime | 12 Nov 2026 |
| D6 | The Windows portable form is a ZIP of the program folder, not a self-extracting executable | 12 Nov 2026 |
| D7 | The Python API and CLI call the same kernels and methods in-process; they are not clients of the engine process | M8.1 |
| D8 | Python layering `kernels/` → `methods/` → `engine/` and public API (§3.1); `app.js` only shrinks (§3.2) | 12 Nov 2026 (design; first applied in M8.3) |
| D9 | Rust kernels, GPU work, WebAssembly, another scientific engine or a UI rewrite are not part of M8; each needs measured need and its own authorised task | 12 Nov 2026 |
