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
| Section inputs kept in the engine between analyses; edits sent as changed rows (`buffer.derive`); remembered counts; one packed result | **built, experimental, off by default** (M8.4.2-M8.4.5); timing gate of contract §7 not met | §4, contract §3 |
| Engine restart after a failure (once by itself, then the user's Retry): **built, experimental** (M8.4.7). Working pixels of small sections (`u16le` buffers, `ensurePixels`, M8.4.9) and record tables (`ensureTable`, M8.4.10) held by the engine: **built, experimental, used by no method yet**; gate of part B met (M8.4.11). Several sections in one request (M8.4.6, deferred); remaining methods (M8.5) | **planned** | roadmap |
| `method.run`: methods of section, core and project scope, two priorities, superseding by target, table outputs; operation table in the coordinator instead of a chain of conditions | **planned** (designed by card A1, 22 Nov 2026; cards M8.5.1-M8.5.3) | [contract §9](roadmap-engine-contract.md#9-methods-of-section-core-and-project-scope-methodrun-card-a1) |
| Tile store for large images (pixel pyramid, versioned mask tiles), tiled viewer and editing, analysis on tiles, saving of large projects | **planned** (part C of M8.4, cards M8.4.12-M8.4.19; chosen 15 Nov 2026) | §3.4 |

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
| Tile store (pixel pyramids built, M8.4.14; mask tiles stored, M8.4.16) | `store/` | `format.py` (layout, Zarr v2 metadata, `pyramid.json`), `tiles.py` (verified tile reads, cache) and `masks.py` (mask tiles, tables and manifests of tiled sections, contract §8.7), standard library only; `source.py` (sources read in bands with libvips) and `pyramid.py` (the band-by-band build); `identity.py` (the record that finds an existing pyramid without hashing its source again; standard library) | `format`/`tiles`/`masks`/`identity`: the standard library; `source`/`pyramid`: also `numpy`, `pyvips`, `methods.errors` | importing the engine or the public API; the coordinator imports only `format`, `tiles` and `masks`, the method worker the whole store |
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
| Pure modules | No `document`, `window` or DOM types; state arrives as arguments. Tested with Node in `tests/app/` | `core.js`, `sectiondepth.js`, `sectionanalysis.js`, `maskchanges.js`, `tiledsection.js`, `tiledrecord.js`, `tiledsplit.js`, `tilecache.js`, `tiledmasks.js`, `tiledit.js`, `tiledcounts.js`, `tiledcache.js`, `tiledbackup.js`, `tiledsync.js`, `tiledundo.js`, `singleflight.js`, `taxa.js`, `coremerge.js`, `residentstore.js`, `sectionpixels.js`, `tablesnapshot.js`, `engineclient.js`, `engineanalysis.js`, `edit.js`, `imageproc.js`, `learn.js`, `log.js`, `geo.js`, `interp.js`, `locmap.js`, `plot.js`, `sheet.js`, `exportio.js`, `zip.js`, `figsize.js`, `pngmeta.js`, `unet.js`, `unetmodel.js`, `navpreview.js`, `figview.js` |
| State | The shared project state `S` and small helpers | `state.js` |
| Controllers and views | Read and change `S`, call pure modules, build DOM/SVG, wire events | `app.js`, `columns.js`, `datatab.js`, `figures.js`, `multiproxy.js`, `panels.js`, `diagnostics.js`, `folderversion.js`, `tiledproject.js`, `tiledsplitui.js`, `tiledstate.js`, `tiledtools.js`, `tiledview.js`, `tableview.js` |
| Storage | IndexedDB project library | `storage.js` |

Rules:

1. **No new scientific calculation in JavaScript.** New methods are written in Python (§5.1). Existing JavaScript
   calculations change only to fix or preserve current behaviour, until their M8 slice replaces them.
2. **`app.js` only shrinks.** It has 4,666 lines (20 Nov 2026, after card M8.4.30); `tests/app/architecture.test.mjs` fails when it grows beyond that ceiling, which each card that shortens it lowers, and checks this table's pure modules for DOM use and imports of controllers. It still mixes many workflows. A task that changes a workflow
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
  in Node tests it is a fake. What the engine keeps between requests is recorded in three `residentstore.js` registries with
  their own bounds: the inputs of analyses (M8.4.2), the working pixels of sections (M8.4.9, described by `sectionpixels.js`) and
  record tables (M8.4.10, built by `tablesnapshot.js`).
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

### 3.4 Tile store for large images (planned, part C of M8.4)

Chosen by the maintainer on 15 November 2026 (option A, decision D10) so that the program stays fluid with images of several
gigabytes. **Pixel pyramids are built** by the engine since card M8.4.14 (contract §8: `pyramid.build`, `pyramid.info`, `tile.read`; not used by the
interface yet); **mask tiles are stored** by the engine since card M8.4.16 (contract §8.7: `mask.begin`, `mask.put`, `mask.commit`,
`mask.discard`, `mask.read`; not used by the interface yet); editing on tiles, counting and saving are not. Cards M8.4.12-M8.4.19 of the roadmap build it; every one of them follows these rules, and a card that
needs to break one stops and asks.

For each tiled section, the engine keeps on disk:

- a **pixel pyramid**: the source image at full resolution and at reduced levels (each half the size of the previous one), cut into
  tiles of 512 x 512 pixels (unless card M8.4.13 measures a better size), at the source's own bit depth. It never changes once built and
  can be rebuilt from the source file, so it is a cache, not project data (M2.3.5);
- **mask tiles**: labels (`i32`) and exclusion (`u8`) at full resolution on the same tile grid, each stored under the SHA-256 of its
  bytes, and one **manifest** per saved version that lists the hashes for every tile position (no entry = an empty tile). The identity
  of a version is the SHA-256 of its manifest;
No row counts are stored: the page counts tiled sections itself (decision 7).

Rules:

1. **One writer.** Only the engine writes the store, on requests that pass through the main process. The page never sees or chooses a
   path (contract §3); the main process tells the engine which folder belongs to the project.
2. **A documented format that does not depend on the interface** (D12). JSON metadata and raw little-endian, C-order tile files,
   specified in the engine contract and the technical manual before the first file is written; nothing in it depends on the browser,
   IndexedDB or Electron. The pyramid uses a layout compatible with Zarr version 2 (an open format that other programs read) when that
   needs no new dependency; card M8.4.14 records the choice. A later Rust kernel (option B, roadmap-future M4.1.1) or a native interface
   (option C, M9.1) must be able to read and write the store from the specification alone.
3. **Verified, tile by tile.** A tile is used only if its bytes have the SHA-256 that names it. This keeps the condition of M8.4
   decision 1 (a copy not proven identical is never used), and the cost of hashing follows the size of the edit, not of the image.
4. **Who owns what.** The page shows tiles from a bounded cache and owns the live edits of loaded tiles and the undo history until the
   store acknowledges them; if the engine fails, those edits stay in the page and are sent again. Saved state is the store's. A save
   writes the new tiles, then the new manifest (temporary file and atomic replacement), then the project record that names the
   manifest's hash. The manifest of the last good save and its tiles are deleted only after a newer save has been committed, so a
   failure at any step leaves the last good save readable.
5. **Bounded memory.** The page and the engine each have a declared tile-cache budget; no code decodes a whole multi-gigabyte raster.
   Coordinates are always full-resolution pixels (§6); a reduced level is only for display and never feeds a count.
6. **Small sections keep today's path** (pixels and masks in the page) until a measurement shows that the tiled path is at least as
   fast for them; then one card moves them and part B's M8.4.9 is dropped. Until M8.6 the tiled path needs the engine experiment.
7. **Drawing** uses 2-D canvas drawing of tile images first. WebGL is used only if the viewer misses the frame target, and only by a
   decision of the maintainer (D9).
8. **No scientific calculation is written in JavaScript for tiled sections**, except the interval table if rule D11 chose option D.

**Design of part C (design session of 16 November 2026).** Detailed in roadmap cards M8.4.14-M8.4.19. Items marked *(maintainer)*
are proposals with a default that the maintainer confirms or changes before the card that depends on them starts.

1. **Which sections are tiled.** A section is tiled when its source has more pixels than the working-resolution limit
   (`maxMP`, 8 megapixels by default: the point where today's path starts discarding detail, M8.4.13), the engine is available and the
   flag of M8.4.15 is on. Every other section keeps today's path (rule 6; both paths kept, decided by the maintainer on 21 November 2026
   after the milestone gate of part C).
2. **Masks of a tiled section are at full resolution** (confirmed by the maintainer, 16 November 2026): labels and exclusion on level 0 of the pyramid, so the interval
   table counts the source pixels. The resolution selector of today's path (`RES_FACTORS`) does not apply to tiled sections.
3. **Two folders, chosen by the main process.** The pyramid is a cache keyed by the SHA-256 of the source file
   (`<user data>/pyramids/<sha256>/`), shared by projects and deleted least-recently-used beyond a disk budget of 50 GiB (the default the maintainer
   accepted on 16 November 2026); the pyramid of an open project is never deleted. Mask tiles, manifests and tables are **project data**
   (`<user data>/projects/<project id>/tiles/`), never deleted by a budget, and included in backups (M8.4.18).
4. **Decoding with libvips** (revised on 16 November 2026: the maintainer asked to add libraries when they make the program faster
   and more stable). The engine reads source images with libvips through `pyvips` and `pyvips-binary` (libvips 8.18.7), which reads
   regions of TIFF and BigTIFF (tiled, striped, all the usual compressions including JPEG-in-TIFF), streams JPEG and PNG in bands
   without decoding them whole, and shrinks images fast. *Capability added:* region and band reads of every format the program accepts,
   with bounded memory. *Smallest alternative considered:* a minimal TIFF reader written here with the scope of `app/js/tiff.js` (no
   dependency, but no JPEG-in-TIFF, slower and new code to secure against hostile files); `tifffile` (0.3 MB) plus `imagecodecs` (19 MB).
   *Cost:* about 8-9 MB per platform wheel (Windows x64, macOS arm64 and x86_64 from 10.15, Linux x86_64 with glibc 2.28 or newer, and
   musl), plus `cffi` (`pycparser` turned out not to be needed); pinned with hashes in `desktop/runtime-lock.json` like the other packages,
   so offline packaging is unchanged; the prepared Windows runtime grew by 19 MiB (measured in M8.4.14); libvips is LGPL-2.1-or-later (dynamically linked; licence texts shipped with the package). *Probe on the M8.4.13 fixtures
   (16 November 2026, Windows, outside the program):* `rgb8g`, `deflate8g`, `strip2g` and `gray16_2g` opened in 6 ms, 512 x 512 regions
   read in a median of 1.3-6.1 ms and **equal byte for byte to the generator's pixels** (8 regions each; one first read of the striped file
   took 0.84 s); the 4,096 x 65,500 JPEG was streamed whole in 1.0 s. JPEG and PNG larger than 1 GiB decoded are refused with a message that
   suggests TIFF (the maintainer's choice, 16 November 2026), although libvips could stream them.
5. **Pyramid layout:** Zarr version 2 (one array per level, chunks of 512 x 512 x channels, C order, chunk keys `i.j.0`), compressor
   either none or `zlib` level 1, chosen by a predeclared measurement in M8.4.14; levels are 2 x 2 integer means with round-half-up,
   `(a + b + c + d + 2) // 4`; one extra file per level lists the SHA-256 of every tile (rule 3), which Zarr readers ignore.
6. **Mask tiles** are stored under the SHA-256 of their uncompressed little-endian bytes (the file itself may be zlib-compressed);
   all-zero tiles have no entry. A manifest (canonical JSON) lists the tile hashes and the hashes of the objects, classes and overlap
   tables; its SHA-256 is the version identity.
7. **Rule D11 = D, counted in the page (decision F of card M8.4.17, approved by the maintainer on 18 November 2026; it replaces "the engine
   counts the rows of each tile"):** the page counts each tile it holds into a row histogram of `(label, pixels)` pairs and valid pixels, which does
   not depend on classes; the interval table is the aggregation of the histograms under the current effective classes, binned with `core.js` as
   today. An edit counts only the tiles it touched (they are in the page); a change of classes, predictions or settings only aggregates again; tiles
   the page dropped keep their histograms and are read back only when the analysis area's columns change. The engine does not count tiled
   sections: from the stored version it could not meet the 150 ms edit target of contract §7, because the page stores an edit in a round that starts
   300 ms after it. The Python method `section.intervals/1` stays the reference through tiled parity fixtures.
9. **A tiled section keeps a small working image** (decided while implementing M8.4.15, 17 November 2026): the finest pyramid level within the
   maximum size when adding images, read through the engine. The rest of the program treats the section like a reduced section of today's path
   (navigation, ruler, depth); the viewer draws full-resolution tiles over it when the zoom needs them. This replaces "no pixel or mask arrays in the
   page" of the first design: about 130 places of the interface read a section's image or masks, and adapting all of them was not needed to show
   tiles. Full-resolution masks (M8.4.16) and counting (M8.4.17) do not use the working image. Until M8.4.18 a tiled section is not saved, and
   tools that would decode the source refuse with a message.
8. **Tiled sections are a desktop feature.** The browser build and the standalone file show a visible message for them and never
   open them partially. Until M8.5, tools that need the whole image (detection, filters, U-Net, enhancement that changes pixels,
   rotation, cropping, change of working resolution) are disabled on tiled sections with a message; display contrast is allowed.

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
- **The renderer owns live editing and saved projects.** The engine never reads or writes project files, and a runtime or engine
  failure must not change live results or the last good save. The one planned exception is the tile store of tiled sections (§3.4),
  which the engine writes only on the page's request and with the same last-good-save guarantee.
- **Synchronous callers, asynchronous engine.** The seven call sites of `analyze(s)` still call it synchronously.
  With the experiment off it fills `s.bins` before returning. With it on it only requests the analysis and leaves the
  section pending (no bins); `engineanalysis.js` calls the controller's `onChange` when a result is published, which
  redraws, and exports await `analyzeSections(sections)` so they never write a pending section (decided in M8.3.7
  instead of turning every render path asynchronous).
- **Inputs stay in the engine (M8.4.2-M8.4.5).** The masks of a section (about 30 MB for 6 Mpixel) are sent once; a change of a
  setting sends only the settings table, and an edit sends only the rows that changed, which the engine applies to a copy and accepts
  only if the whole result has the page's SHA-256 (`maskchanges.js`, `buffer.derive`). The renderer stays the owner of the masks,
  the edit history and the saves; the engine's copy is a verified cache and its failure never changes an edit or a save.
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
5. **Engine.** Advertise the method in `hello` (once `method.run` is built: describe its scope, inputs, priorities and outputs in
   `engine/specs.py`, [contract §9.6](roadmap-engine-contract.md#96-method-table)); add a transport test that sends a fixture through the real
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
| D4 | A pinned CPython 3.12 runtime with NumPy, pandas and Pillow (and libvips through `pyvips`, added by card M8.4.14: §3.4 decision 4) ships inside the program; no system Python, no downloads at run time, no silent fallback when it is invalid | M8.2.2 |
| D5 | Every runtime file is verified at launch; a verified-identity record skips re-hashing while files are unchanged; unused files are pruned from the runtime | 12 Nov 2026 |
| D6 | The Windows portable form is a ZIP of the program folder, not a self-extracting executable | 12 Nov 2026 |
| D7 | The Python API and CLI call the same kernels and methods in-process; they are not clients of the engine process | M8.1 |
| D8 | Python layering `kernels/` → `methods/` → `engine/` and public API (§3.1); `app.js` only shrinks (§3.2) | 12 Nov 2026 (design; first applied in M8.3) |
| D9 | Rust kernels, GPU work, WebAssembly, another scientific engine or a UI rewrite are not part of M8; each needs measured need and its own authorised task | 12 Nov 2026 |
| D10 | Large images and fluidity follow **option A**: the engine owns a tile store on disk (pixel pyramid, versioned mask tiles); the page shows tiles and edits the loaded ones (§3.4). Options considered and not chosen: B, one Rust core compiled for the engine and to WebAssembly for the page; C, a native Python and Qt interface; D, light interactive calculations kept in JavaScript. B and C stay possible later because of D12 | 15 Nov 2026 |
| D11 | Where the interval table of a tiled section is computed is decided once by a measurement (card M8.4.12) against the rule in contract §7: the engine (A) if one tile's edit round trip plus the table's recomputation is p95 <= 100 ms, otherwise the page (D) with the Python method as reference and parity tests. **Outcome (card M8.4.12, 15 Nov 2026): D by the rule as measured** (one-tile edit p95 794 ms, median 72 ms, plus 238 ms to turn the row counts of a 349,526-row section into its table; the table time is a per-interval Python loop in `kernels/binning.sum_by_interval` that can be vectorised, which would change the outcome). See the [summary](validation/M8.4.12-round-trip-summary.md). **Measured again after vectorising the kernel (card M8.4.21, 16 Nov 2026): still D** (one-tile edit p95 84.7 ms over 60 samples, median 71.0 ms, no stall; table 34.8 ms; 84.7 + 34.8 = 119.5 ms > 100). D is accepted, on the maintainer's delegation, for the interactive interval table only; the rule was not changed; see the [summary](validation/M8.4.21-vectorised-kernel-summary.md) | 16 Nov 2026 |
| D12 | Data that may outlive the interface (the tile store, method inputs and results) uses documented, versioned formats that do not depend on the browser, IndexedDB or Electron; new scientific methods are written only in Python (§3.2 rule 1) | 15 Nov 2026 |
