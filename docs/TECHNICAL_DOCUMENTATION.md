# SedCoreTool — Technical documentation

This document explains how SedCoreTool works: what each part does, the formulas it uses and its default values,
exactly as they are in the code. Each section names the file (and usually the function) where the method is
implemented, written as `file::function`, so that every statement can be checked against the source. Where a
choice needs a reason, or a method has limits that affect how results should be read, the explanation is given in
the same place.

The document describes the current version; the history of changes is in [`CHANGELOG.md`](../CHANGELOG.md).

## Contents

**Part I — Overview**

1. What SedCoreTool is: the program and the Python package

**Part II — Core definitions (shared by the program and the Python package)**

2. Conventions: orientation, analysis area and depth scale
3. Bioturbation percentage per interval
4. Bioturbation indices (BI and ii)
5. Age model

**Part III — The program: working with core images**

6. Importing images: working resolution and cropping
7. Image enhancement
8. Automatic trace detection
9. Learned segmentation (U-Net)
10. Editing tools and the exclusion layer
11. Object descriptors
12. Identifying ichnotaxa
13. What counts as bioturbation
14. Identification mode (presence only)

**Part IV — The program: core column, data and multiproxy analysis**

15. Core column
16. External records
17. Data tab
18. Multiproxy analysis
19. Maps of the multiproxy analysis

**Part V — The program: figures**

20. Figures

**Part VI — The program: projects, storage and sharing**

21. How a project is organised
22. Storage, automatic saving and memory
23. Sharing, backups and settings
24. Exported files and file formats

**Part VII — The Python package**

25. [The `sedcoretool` Python package](#25-the-sedcoretool-python-package)
    - [Python row counts and kernels (library API, §25.2)](#python-row-counts-and-kernels)

**Part VIII — Desktop program, distribution and engineering**

26. Desktop program
27. Offline single file
28. Repository engineering and security
29. Accessibility
30. Training project, help cards and guided tour

**Part IX — Validation and limits**

31. Validation
32. Known limitations
33. Reproducibility

References

---

# Part I — Overview

## 1. What SedCoreTool is: the program and the Python package

SedCoreTool (*Sediment Core Tool*) quantifies bioturbation and ichnotaxa in images of sediment cores and combines
them with any other down-core record (geochemistry, micropalaeontology, TOC, colour, magnetic susceptibility…) and
with described intervals (lithology, events…). It has two parts that share the same analysis definitions:

| Part | What it is | Who it is for | Code |
|------|-----------|---------------|------|
| **The program** | An interactive application with windows, tools and figures. It is the same code whether it runs as the **desktop program** (Windows, macOS, Linux) or in a **web browser**. | Anyone analysing cores: image work, interpretation, multiproxy analysis, figures | `app/` (JavaScript), packaged by `desktop/` |
| **The Python package `sedcoretool`** | A library and a command (`sedcoretool`) without a graphical interface | Users who write scripts or process many images, and the U-Net training | `src/sedcoretool/` (Python) |
| Reference version 2.1 | The original 2019 script (IchAnTool v2.1), kept unchanged | Regression tests | `legacy/` |

### 1.1 The program

The program is a web application written in JavaScript (ES modules, no build step). It never sends images or data
to a server: everything is computed on the user's computer. It can be used in three equivalent ways:

- **Desktop program** — installers for Windows, macOS and Linux (§26). It runs the same `app/` code in its own
  window (Electron), with more memory, its data stored in a folder on disk, and the option to train U-Net models
  on the computer's graphics card.
- **Offline single file** — `SedCoreTool_V0.<n>.html`, one HTML file with all the code inside, which opens with a
  double click in Chrome, Edge or Firefox (§27).
- **From a copy of the repository** — served by any local web server (`python3 -m http.server`, then open
  `http://localhost:8000/app/`). This is how it is developed and tested.

The program has five working modes, chosen at the top of the window: **Bioturbation** (image work, §6–§14),
**Core column** (§15–§16), **Data** (§17), **Multiproxy** (§18–§19) and **Figures** (§20). The start screen
(**Projects**, **Across projects**) manages projects (§21–§23).

### 1.2 The Python package

`sedcoretool` is installed with `pip` (§25). It does **not** have the program's image tools: it does not enhance,
detect, edit or classify traces. It starts from a **mask** — an image in which bioturbation has already been
marked, either painted on the photograph (the original 2019 workflow), colour-coded per ichnotaxon, exported
from the program, or predicted by a U-Net — and turns it into depth (or age) series of bioturbation percentage,
per-ichnotaxon percentage and BI/ii indices. It also contains the whole U-Net workflow (prepare, train, evaluate,
predict), which the desktop program calls when the user trains a model (§9).

| Task | Program | Python package |
|------|:-------:|:--------------:|
| Bioturbation %, per-class %, BI, ii, depth and age per interval | ✓ | ✓ (same definitions) |
| Image enhancement, automatic detection, drawing and editing traces | ✓ | — |
| Exclusion layer (cracks, gaps, samples) | ✓ (drawn) | ✓ (exclusion image or mask value) |
| Identifying ichnotaxa (k-NN, Random Forest, Bayes, vision features) | ✓ | — |
| U-Net: run a trained model | ✓ | ✓ |
| U-Net: prepare data, train, evaluate | desktop program (it calls the Python package) | ✓ |
| Core column, external records, Data tab, multiproxy analysis, maps, figures | ✓ | — |
| Batch processing from scripts and the command line, multi-section cores, LAS export | — | ✓ |

The analysis definitions shared by both — interval limits, percentages, indices, depth mapping and the U-Net
tiling — are implemented twice (`src/sedcoretool/` and `app/js/core.js`, `app/js/unet.js`) and the tests check that
both give identical numbers (§31).

The planned desktop single-engine migration, including representation gaps and interface-specific custom-tier
precedence, is specified separately in the [M8.1 roadmap contract](roadmap-engine-contract.md). That design
does not change the current implementations described here.

### 1.3 Common workflow

```
core image
   → (enhancement)                  program only; changes what is seen and detected, not the calculation
   → label mask                     each pixel: 0 = matrix, n = object or class
   → percentage per pixel row
   → intervals of a set thickness   centre depth, %, % per class
   → BI and ii indices
   → (age)                          interpolation of the age model
   → CSV / Excel / PNG / project
```

On top of the mask, the program keeps a layer of **objects** (traces): each object is a connected set of pixels
with an identifier, a class and shape and colour descriptors. Objects are what the user edits and what the
ichnotaxa classifier learns from.

### 1.4 Source code map

Program (`app/js/`). The modules marked "pure" do not use the browser (no DOM) and are tested with Node.

| File | Content | Pure |
|------|---------|:----:|
| `core.js` | Intervals, indices, age model, CSV, RLE encoding, overlapping-trace stacks | ✓ |
| `sectiondepth.js` | Pure ROI depth/row conversion and pixels per centimetre; independent of interface/state | Yes |
| `sectionanalysis.js` | Analysis of one section without the DOM: effective class of each object, class-index table, row counts (cached per section), interval bins with no-data padding, ages and manual indices (§3.2), plus the builders of the engine method's input snapshot and reference result columns (`buildIntervalSnapshot`, `referenceColumns`), the revision key of a section's calculation (`analysisRevision`) and the conversion of engine result columns to `s.bins` (`resultToBins`). `app.js::analyze` passes the project state in | Yes |
| `imageproc.js` | Enhancement, detection, connected components, magic wand, lasso, descriptors, rotation, downsampling | ✓ |
| `edit.js` | Editing algorithms: scissors, merging, undo records, project migration | ✓ |
| `learn.js` | Ichnotaxa classifier (k-NN with novelty rejection; Random Forest and Bayes wrappers), evaluation, final-test metrics | ✓ |
| `log.js` | Core column: table parsing, axes, ticks, SVG and CSV of a window, distribution figure | ✓ |
| `geo.js` | Multiproxy: samples, interval layers, labels, Random Forest, k-NN, Bayes, neural network, k-means, cross-validation, maps | ✓ |
| `interp.js` | Gridding of scattered values for maps (inverse distance, triangulation, splines, kriging…) and map projections | ✓ |
| `locmap.js` | Core location map: coordinate reference systems, frame, grid, scale | ✓ |
| `plot.js` | Plots of the Data tab (stratigraphic log, XY, fits) | ✓ |
| `sheet.js` | Formulas of the Data tab (own parser, no `eval`) | ✓ |
| `exportio.js` | Tables written to files and records read from tables | ✓ |
| `zip.js` | Minimal ZIP writer and reader for project packages | ✓ |
| `unet.js` | U-Net tiling, normalisation, blending and resampling (same rules as the Python package) | ✓ |
| `unetmodel.js` | U-Net session ownership, model loading and probability-cache orchestration with injected runtime services | Yes (no DOM) |
| `vision.js` | Pre-trained vision model (DINOv2): input window and embedding | partly |
| `worker.js` | Background worker that runs enhancement and detection off the interface thread | — |
| `storage.js` | Project library in IndexedDB | — |
| `state.js` | Shared program state (`S`) and small helpers used by the interface modules | — |
| `columns.js` | Composite log of a core: column view, records, order and visibility of chart columns | — |
| `navpreview.js` | Navigation-only photo/mask reduction and bounded preview ownership | ✓ |
| `figview.js` | Serializable figure presentation, inherited defaults and independent overrides | ✓ |
| `panels.js` | Resizable and collapsible side panels, resizable maps | — |
| `datatab.js` | Data tab: all data of the project, Grapher-like plots and the spreadsheet view | — |
| `multiproxy.js` | Multiproxy tool: numeric records, interval layers, classifiers, composite-log readout, manual classification, maps | — |
| `figures.js` | Figures panel: representative traces, interpreted core, logs, sections, range chart, location map | — |
| `app.js` | Interface, tools, drawing, files | — |
| `i18n.js` | Interface texts in Spanish and English | — |
| `diagnostics.js` | Optional desktop diagnostic controls, static control IDs and technical operation events | — |

The interface modules (`state.js`, `columns.js`, `panels.js`, `datatab.js`, `figures.js`, `multiproxy.js`, `app.js`) import from each other; circular imports are safe because
the imported names are only used inside functions, never while a module is being loaded. A top-level `let` is assigned
only in the module that declares it. Event wiring that must run in a fixed order is wrapped in an `init…()` function
(for example `initMultiproxy`) that `app.js` calls where that code used to run.

`unetmodel.js` imports only the scientific `unet.js` module. `app.js` creates one controller and injects
ONNX runtime acquisition, section enumeration, pixels per centimetre, model identifiers and progress.
The controller owns the loaded model and creates WASM sessions; successful replacement invalidates the
probability cache of every project section. Load failure clears the active model. Cache keys
combine model identity, ROI, image dimensions and four-decimal pixel scale; inference writes a new cache
only after completion. The interface retains file picking, translated messages, busy state, detection,
rendering and desktop training. Runtime loading stays shared with DINOv2. ONNX input/output names and
float32 NCHW tensors adapt to the existing tiling engine. The module has strict checked contracts and no
import of app.js or access to browser globals; it is included after unet.js in the standalone build.

Python package (`src/sedcoretool/`): `io.py` (images and masks), `segmentation.py` (masks from a threshold, a
colour palette or a U-Net), `kernels/` (pure array primitives: intervals, counting, index tiers, age interpolation; §25.2),
`methods/` (versioned scientific methods for the engine, for now `section.intervals/1`; §25.2),
`pipeline.py` (intervals, percentages, indices), `indices.py` (BI and ii schemes),
`depth.py` (depth and age), `export.py` (CSV and Excel), `plotting.py` (matplotlib figure), `cli.py` (command line),
`unet/` (U-Net dataset, training, evaluation, prediction, tiling and metrics), `engine/` (experimental desktop
engine process: framing, staged buffers, coordinator and isolated worker; §26.2).

Desktop program (`desktop/`): `main.js` (window, `app://` protocol and IPC), `preload.js` (narrow
`window.corantoolDesktop` bridge), `engine.js`, `engine-ipc.js`, `engine-protocol.js` and `engine-runtime.js` (engine process
client, page bridge, framing and bundled-runtime verification; §26.2–§26.3), `runtime-lock.json` (pinned runtime artifacts;
§26.3), `trainer.js` and `model-store.js` (U-Net training and model generations; §9.3), `diagnostics.js` (§26.1)
and `scripts/` (preparation, build and package checks).

### 1.5 Names and compatibility

The software started in 2019 as **IchAnTool** and was called **CorAnTool** in 2026 before taking its current name.
Files and data written under the old names keep working:

- The Python package is imported as `sedcoretool` and run as `sedcoretool`. The old name `ichantool` still works,
  as a module (`import ichantool`, `import ichantool.cli`…) and as a command, with a deprecation warning.
- New project files say `app: 'SedCoreTool'`; files with `app: 'CorAnTool'` or `app: 'IchAnTool'` are read as well.
  Shareable project packages use the extension `.sedcoretool`; older `.corantool` packages open too.
- Some internal names keep the old spelling on purpose, because changing them would make previously saved data
  disappear: the browser storage keys (`ichantool.*`, `corantool.author`), the IndexedDB database `ichantool`, the
  vision-model cache `corantool-models`, the desktop page origin `app://corantool` and the desktop bridge
  `window.corantoolDesktop`. The desktop program keeps using an existing `CorAnTool` data folder if the new
  `SedCoreTool` folder does not exist yet.
- Environment variables: `SEDCORETOOL_PYTHON` (also read as `CORANTOOL_PYTHON`), `SEDCORETOOL_TEST_PROFILE`,
  `SEDCORETOOL_VISION_MODEL` and `SEDCORETOOL_NETWORK_SMOKE`.

---

# Part II — Core definitions (shared by the program and the Python package)

## 2. Conventions: orientation, analysis area and depth scale

### 2.1 Orientation
Row 0 of the image is the **top** of the section. A photograph taken horizontally is rotated by 90° in the program
(`imageproc.js::rotate90`).

### 2.2 Analysis area
A rectangle `[x0, x1) × [y0, y1)` in pixels; by default the whole image. It leaves out the ruler, the colour chart
and the edges of the core. Only pixels inside the analysis area are counted. In the program it is drawn on the
image, and its upper and lower limits can also be dragged with the **Start** and **End** markers to the left of
the image (minimum 4 px apart); the top and bottom depths then refer to the new rows.

### 2.3 Depth scale
The user gives the depth of the **upper edge** (top) and of the **lower edge** (bottom) of the analysis area. The
scale is assumed linear within a section (no expansion, compression or gaps inside it).

With `R = y1 − y0` rows and `Δz = (bottom − top) / R` depth units per row, the depth of the centre of row `r`
(counted from `y0`) is:

    z(r) = top + (r + 0.5) · Δz

The resolution in pixels per centimetre, needed for physical sizes, is:

    ppcm = R / ((bottom − top) · f)      with f = 0.1 (mm), 1 (cm) or 100 (m)

Implementation: `depth.py::pixel_depths` and `sectiondepth.js::depthAtRow`, `rowAtDepth`, `pxPerCm`.
The selectors receive section depth endpoints, units and ROI explicitly; they import only `core.js`.
Columns and figures import the selectors directly. `app.js` imports and re-exports the same function
bindings to preserve existing module callers. `depthAtRow(s, row)` takes an absolute working-image row
coordinate (a pixel centre is `y0 + r + 0.5`), while its inverse returns that same coordinate:

    depthAtRow(s, row) = top + ((row - y0) / R) * (bottom - top)
    rowAtDepth(s, z)   = y0 + ((z - top) / (bottom - top)) * R

Coordinates outside the ROI extrapolate linearly. `pxPerCm` returns 1 when its evaluated centimetre span
is not positive; the coordinate conversions use ordinary JavaScript division for degenerate geometry,
which can yield non-finite values. These selectors do not validate or repair saved geometry. Their strict
contracts also supply the application's pixel scale to the generic U-Net controller; cache enumeration
accepts unloaded sections, and the existing pixel-loading service makes pixels resident before inference.

Pixels are assumed square (same scale horizontally and vertically), which holds for photographs and corrected line
scans. If they were not, physical areas would carry a constant factor, but percentages would not change, because
they are proportions of pixels.

---

## 3. Bioturbation percentage per interval

Implementation: `pipeline.py::analyze_mask` (Python) and `core.js::rowCounts` + `binRows` (program).

### 3.1 Per row
For each row `r` of the analysis area:
- `V_r` = **valid** pixels: inside the analysis area and not excluded (§10);
- `B_r` = valid pixels that are bioturbation (§13);
- `C_r,k` = valid pixels of class `k`.

### 3.2 Per interval
The user sets the **interval thickness in centimetres** (`binCm`, 1 cm by default; `bin_cm` in Python). In each
section it becomes a number of rows per interval:

    N = max(1, binCm · ppcm)          (ppcm = rows per cm of the analysis area, §2.3)

Both runtimes evaluate `span_cm = (bottom - top) * f`, then `ppcm = R / span_cm`, then
`bin_cm * ppcm`, in this order with binary64 arithmetic. Multiplying `bin_cm * R` before dividing
is not equivalent at half-row boundaries. No decimal rounding or epsilon is applied before binning.
Python rejects intervals below one row instead of clamping them; explicit `bin_px` bypasses the conversion.

`N` may be fractional. Interval `j` spans the rows

    [⌊j·N + ½⌋, min(⌊(j+1)·N + ½⌋, R))

so the limits do not drift along the section (the error of each limit is below half a row). With an integer `N`
this gives the classic fixed bins `[jN, (j+1)N)` (parameter `bin_px` in Python). **The last interval may be
incomplete and is kept**; in Python it can be dropped with `keep_partial=False`. Implementation:
`core.js::binRows`/`binEdge`, `app.js::binRowsOf`, `pipeline.py::bin_edges`.

    bioturbation%_j = 100 · Σ B_r / Σ V_r
    class%_k,j      = 100 · Σ C_r,k / Σ V_r
    depth_j         = top + ((r0 + r1) / 2) · Δz       (centre of the interval)

Summing pixels before dividing gives every valid pixel the same weight, which is the correct estimator when some
rows have excluded pixels.

**Overlapping traces.** A pixel may belong to several traces, for example *Chondrites* inside *Thalassinoides*.
Only traces of different ichnotaxa overlap: when the user draws a trace over one of the same ichnotaxon, the
pixels go to the new trace, and if two overlapping traces end up with the same ichnotaxon they are merged into
one. An overlapped pixel counts **once** in `B_r` (if at least one of its traces counts) and once **for each
distinct class** present in `C_r,k`. Therefore `bioturbation%_j ≤ 100`, while `Σ_k class%_k,j` may exceed
`bioturbation%_j` (and 100): each ichnotaxon keeps its full area. Without overlaps both definitions coincide.
Implementation: `core.js::rowCounts` (parameter `stacks`); in Python, `analyze_mask` with a 3-D mask
`(classes, rows, columns)` of boolean layers.

**How overlaps are stored.** In the label array, `labels[i] > 0` is an object, `0` is matrix and `labels[i] < 0`
points to the stack `stacks[−labels[i]]`, the list of objects in that pixel from bottom to top
(`core.js::idsAt, withId, withoutId, renameId`). The stack table is compacted when the project opens, on a copy when saved, and between overlap-changing edits.
During editing, a pass runs when the table reaches 64 entries or twice its size after the previous pass, whichever
is larger, or after 32 overlap-changing edits or undo steps. Cropping and resolution changes also run a pass.
Compaction rewrites negative pixel codes in place and invalidates the stack index. Undo keeps references to ordered
object lists, so the active table only needs entries used by the current mask after compaction. Object descriptors
(§11) use all the pixels of the object, including overlapped ones. Whatever needs a single object per pixel (the
PNG mask, U-Net training data, trace figures, clicking on a trace) uses the uppermost trace.

**Intervals without data (program).** If an interval has less than `minValid` (20 % by default) of its pixels
valid — that is, `Σ V_r < minValid · N · width` — it has no data: percentages, BI and ii are empty (never 0) and
the column draws it as NO DATA. In Python the same rule applies (`min_valid=0.2`): percentages are `NaN` and BI/ii
empty. Optionally, in the program only (`noDataPad`, cm; 0 by default), the intervals of the same section that
overlap `[top − pad, bottom + pad]` of an interval without data are also marked as without data.

### 3.3 Equivalence with the reference version 2.1
Version 2.1 computed the percentage of every row and then the **mean** of the rows of each interval. When every row
has the same number of valid pixels (no exclusions), the mean of the row percentages equals the ratio of sums of
§3.2, so both give identical results. The program and the Python package both use the ratio of sums.

The depth assigned by version 2.1, `(i − N/2) · Δz + top` with `i = (j+1)N`, is the same as in §3.2. The two
differences are that version 2.1 lost the last interval (it is now kept) and had no exclusion layer.

### 3.4 Grey conversion of painted images
In the original workflow — an image in which the bioturbation has been painted black — the mask is obtained with
a threshold on grey:
- Python: `grey = 0.30 R + 0.56 G + 0.11 B` (the weights of version 2.1); bioturbation if `grey ≤ 5`
  (`io.py::to_gray`, `segmentation.py::mask_from_threshold`).
- Program: `L = 0.299 R + 0.587 G + 0.114 B` (ITU-R BT.601), with the global threshold `L < 6` for this kind of
  image.

On the reference image both criteria mark exactly the same pixels (1,795,647 px with either criterion when the JPEG
is decoded with Pillow; 1,809,490 px with either when it is decoded by Chrome). The small difference between the
program and version 2.1 on that image (at most 0.56 percentage points, mean 0.13) therefore does **not** come from
the grey weights but from the **JPEG decoder**: the browser reconstructs the edges of the painted patches
differently from Pillow (the library used by version 2.1 and by the Python package) and leaves 13,843 more pixels
(0.13 % of the image) below the threshold. With the same mask, the program reproduces version 2.1 exactly (§31.1).
BI and ii are identical in every interval in both cases. This is why lossless formats (PNG, TIFF) are recommended
for masks.

---

## 4. Bioturbation indices (BI and ii)

### 4.1 Bioturbation Index (Reineck, 1963; Taylor and Goldring, 1993)

| BI | % range |
|----|---------|
| 0 | [0, 1) |
| 1 | [1, 5) |
| 2 | [5, 31) |
| 3 | [31, 61) |
| 4 | [61, 91) |
| 5 | [91, 100) |
| 6 | 100 |

### 4.2 Ichnofabric index (Droser and Bottjer, 1986)

| ii | % range |
|----|---------|
| 1 | [0, 1) |
| 2 | [1, 10) |
| 3 | [10, 40) |
| 4 | [40, 60) |
| 5 | [60, 100) |
| 6 | 100 |

These are the same tiers as in version 2.1. In Python, other schemes can be defined as data with `IndexScheme`
(`indices.py`) without changing the code. `IndexScheme.classify` compiles each scheme once into disjoint intervals,
with the last declared tier taking precedence when tiers overlap (`kernels.classification.TierTable`, which also offers the first-match rule that the desktop program uses). It preserves the shape of an input array of any
dimension. For nonnegative integer boundaries up to 256 it looks up the class of each percentage's integer part.
Other schemes use right-sided `numpy.searchsorted` on the sorted boundaries. Values outside all tiers return `-1`.

**No value.** For an interval without valid pixels, or a percentage that is not a number, Python returns `−1`
(NumPy integer arrays, as in version 2.1) and the program returns an empty value, exported as an empty cell. Both
mean the same thing; when comparing outputs, treat `−1` as empty. An age outside the age model is `NaN` in Python
and empty in the program.

### 4.3 Manual indices (program)
In the results table the user can enter their own visual BI and ii for each interval. The value is stored as a
depth range `[from, to)`. If the interval thickness changes, each new interval takes the manual value of the range
that contains its centre. Manual values are exported in the columns `BI_manual` and `ii_manual`.

BI and ii are semi-quantitative scales designed for visual estimation. The ichnofabric index of Droser and Bottjer
also considers whether the original sedimentary structure is preserved (ii 6 = complete homogenisation). SedCoreTool
computes only their **percentage** component: an automatic, reproducible conversion, not a substitute for
describing the ichnofabric. This is why the program also stores the manual index, so that both can be compared.

---

## 5. Age model

Empty depth or age cells are ignored rather than converted to zero. Repeated identical rows are merged; a depth with
two different ages invalidates the model and the program names that depth (a hiatus is written as two depths a small
distance apart, so that depth → age stays a function). The age range (minimum and maximum columns) is used only if
every row has both values and they contain the central age; otherwise the model is kept without range and the number
of offending rows is reported. The Python API (`depth_to_age`) applies the same rules and requires at least two
finite pairs. Age reversals remain flagged by the program rather than silently corrected.

Implementation: `depth.py::depth_to_age` (Python) and `core.js::parseAgeModel, interpAge, interpAgeRange,
baconToAgeText` (program).

- **Input:** pairs `(depth, age)`, sorted by depth. Separators may be comma, semicolon, tab or space; lines that
  are not numeric and lines starting with `#` are ignored. If a line uses `;` or tab, the comma is the decimal
  separator (`10,5;3,2`). If the first line is a header, columns are chosen by name (depth: `depth`, `prof…`,
  `mcd`, `mbsf`, `ccsf`; age: `age`, `edad`, `median`, `mean`, `cal…`; range: `min`/`lower`/`2.5` and
  `max`/`upper`/`97.5`).
- **Age range (program):** each line may carry two more columns, minimum and maximum age (for example the 95 %
  range of Bacon). They are used only if every line has them. Without a header, the third and fourth columns are
  taken as a range only if, in every row, they contain the age. They are interpolated like the central age, exported
  as `age_min` and `age_max`, and drawn as an "Age uncertainty" column (max − min) in the core column and figures. The
  central age (median or mean) is the one used for the age axis.
- **Bacon output (program):** the `*_ages.txt` table of rbacon (`depth min max median mean`; depth in cm, age in
  cal yr BP) is converted to the depth units of the core (÷ cm per unit) and to the chosen age units (÷ 1, 1000 or
  10⁶), with the median (or the mean) as the central age. The program does not run Bacon and does not use the MCMC
  iterations: age and range at each depth are **interpolated linearly between the rows** of the Bacon table, so
  between rows the range is an approximation. If a pasted table has the Bacon header, the program says it must be
  opened with the file button so that units are converted. The Python package does not read range columns.
- **Age of each interval:** **linear interpolation** between the two model points around the centre depth of the
  interval.
- **Outside the model range:** no value in the program; in Python `NaN`, or linear extrapolation with the slope of
  the first or last segment if `extrapolate=True`.
- **Age reversals** (age decreasing downwards) are flagged in the interface, because converting age back to depth is
  then ambiguous.

This is the usual linear interpolation between age control points. The uncertainty of the age model is not
propagated into the results; that would have to be done separately.

---

# Part III — The program: working with core images

## 6. Importing images: working resolution and cropping

Implementation: `imageproc.js::downsampleRGBA`, `app.js::decodeBytes, changeResolution`.

Supported images are JPEG, PNG and TIFF. `tiff.js::decodeTiffBlocks` reads the first image of classic TIFF
and BigTIFF using byte ranges. It supports tiled and stripped grayscale or interleaved RGB(A), with unsigned
8- or 16-bit samples, and signed 16-bit grayscale. Supported compression is uncompressed, LZW, Deflate and
PackBits. Horizontal prediction is reversed before block averaging. Other classic TIFF layouts can use UTIF
when the original file and estimated decoded buffers total at most 64 MiB.

### 6.1 Working resolution
Core scanner images can exceed 40 million pixels per section, which do not fit comfortably in memory (the program
uses about 13 bytes per pixel across its layers, plus 8 bytes for native 16-bit RGBA). On import, if `width × height > M` megapixels (M = "Working resolution on
import", 8 MP by default), the image is reduced by an integer factor:

    k = ⌈ √(width · height / (M · 10⁶)) ⌉

Each new pixel is the **arithmetic mean** of a `k × k` block of original pixels (in R, G and B). The last
`width mod k` columns and `height mod k` rows are dropped, that is, fewer than `k` original pixels along the right
and bottom edges. For browser-decoded formats, the canvas is read in strips whose height is a multiple of `k`. The decoder may
retain the full raster. The range decoder reads only the TIFF strips or tiles intersecting the retained crop.
Uncompressed blocks are read in batches of up to 4 MiB or one row when a row is wider. A compressed strip or
tile is capped at 64 MiB in both encoded and decoded size. Averaging uses native samples and allocates a sum
array proportional to the working image. Signed grayscale samples are offset by 32768 for enhancement.

- The **original file** is stored unchanged (full resolution) in the project, together with `k` (`ds`). When the
  project is reopened the same `k` is applied, so the masks match pixel by pixel.
- The depth scale (§2.3) is computed on the working image, so percentages do not depend on `k`. What `k` changes is
  the smallest trace that can be distinguished. The working resolution in px/cm is shown next to the analysis area
  and is worth reporting in a methods section.

Block averaging is a low-pass filter followed by subsampling: it avoids the aliasing of direct subsampling, and it
is reproducible because `k` is recorded.

### 6.2 Changing the resolution of a section
The working image is recomputed from the original with a new factor `k₂`. Masks (traces and exclusions) are
carried to the new size by **nearest neighbour** in the unrotated frame: new pixel `(x, y)` takes the value of old
pixel `(⌊(x+½)·k₂/k₁⌋, ⌊(y+½)·k₂/k₁⌋)`. The analysis area and the marks are scaled in the same way (edges rounded to
the pixel). Object statistics are recomputed. When reducing, traces smaller than one new pixel can disappear; when
enlarging, the edges of traces drawn earlier stay stepped (they keep the resolution of the old mask). "Set all sections to this
resolution (px/cm)" chooses, in each section, `k = max(1, round(ppcm_original / ppcm_target))`.

### 6.3 Cropping
A crop is stored as a rectangle `crop = [x0, x1) × [y0, y1)` in pixels of the original, unrotated file; the file is
not re-encoded. The working image is `rotate(average(crop(original), k), rot)`. Crops are made in multiples of `k`,
so they match the cropped masks exactly.

The **Crop** tool of a section (also offered when a single image is imported) uses two lines, "Crop top" and
"Crop bottom" (rows `y0 < y1`, at least 10 px apart). Rows outside `[y0, y1)` are removed from the image, the traces
and the exclusion layer; objects are recomputed and the undo history is cleared. Depths can be:
- **recalculated** (default; use when the depths referred to the whole image): with `r0 = max(roi.y0, y0)` and
  `r1 = min(roi.y1, y1)`, the new top is `depth(r0)` and the new bottom `depth(r1)` (depth = the current linear
  mapping from `roi.y0 → top` to `roi.y1 → bottom`), and the analysis area becomes `[r0 − y0, r1 − y0]` vertically;
  if the analysis area was already inside the crop nothing changes;
- **kept** (use when the depths already referred to the core): top and bottom stay the same and the analysis area
  becomes the whole cropped image.

The cropped image is stored again in the project (JPEG at quality 0.95 if the original was JPEG, otherwise PNG)
with rotation 0 and reduction 1, so that the stored file matches what was analysed.

---

## 7. Image enhancement

Implementation: `imageproc.js::applyFilters, filterImageChunks`. **Enhancement only changes what is seen and what automatic detection
uses.** It does not take part in the percentage, which depends only on the mask, nor in the colour descriptors used
for learning, which are computed on the original image (§11).

The worker handles one enhancement job at a time. It receives one transferable RGBA chunk of at most 1 MiB per request and applies the pointwise colour
operations directly to the destination. The global histogram is computed across the working image. CLAHE caches
two rows of tile mappings. The local contrast pass retains a rolling window of up to `2r + 2` rows of input
luminance and horizontal means. The working source and the RGBA destination still occupy one image each.

The luminance function retains native units in Float32 for unsigned 16-bit RGBA. With 16-bit TIFF, the
application keeps those samples through working-resolution reduction, crop, rotation, automatic levels and the
pointwise colour operations. The automatic-levels histogram has 65,536 bins. The colour lookup uses all 16 bits,
with levels expressed on a 0–255 scale after division by 257. The enhanced image is quantized to 8 bits for the
histogram equalisation, local contrast and display stages. Existing tools that consume the unenhanced image use
an 8-bit proxy derived from the high byte of each working sample.

### 7.1 Operations
Order of the operations on each pixel `(R, G, B)`, with values from 0 to 255:

1. **Channel:** colour, grey (BT.601), or a single channel R, G or B copied to all three.
2. **Levels:** `v₁ = clamp((v − black) / (white − black), 0, 1)`. With **automatic levels**, black and white are the
   0.5 % and 99.5 % percentiles of luminance (BT.601, rounded) inside the analysis area (`autoLevels`).
3. **Gamma:** `v₂ = v₁^(1/γ) · 255`. With **automatic gamma** (`gammaForMedian`, own adaptation),
   `γ = ln(m) / ln(0.5)`, where `m` is the normalised median after levels, limited to [0.01, 0.99]; the median
   becomes mid-grey. γ is limited to the range 0.19–1 published by Dorador et al. (2014).
4. **Contrast and brightness:** `v₃ = (v₂ − 128) · F + 128 + 2.55 · brightness`, with
   `F = 259 (C + 255) / (255 (259 − C))` and `C = 2.55 · contrast` (contrast from −100 to 100).
   Steps 2 to 4 are precomputed in a 256-value table.
5. **Saturation:** `v₄ = l + (v₃ − l) · s`, with `l` = BT.601 luminance and `s` = saturation / 100.
6. **Vibrance:** like saturation but with the factor `f = 1 + (vibrance/100) · (1 − sᵥ)`, where `sᵥ = (max − min)/255`
   is the saturation of the pixel, so it affects unsaturated pixels more. It approximates Photoshop's "Vibrance",
   whose exact algorithm is not public.
7. **Histogram equalisation** (optional), on luminance, with the cumulative distribution function:
   `T = (CDF(L) − CDF_min) / (n − CDF_min) · 255`.
8. **CLAHE** (optional; Zuiderveld, 1994; `clahe`), on luminance:
   - the image is divided into `nx × ny` tiles of about `block` px (`nx = round(width/block)`);
   - in each tile a 256-level histogram is computed and each level is clipped at `slope × n/256`;
   - the excess is spread evenly over the 256 levels, and the normalised cumulative function (×255) is the
     transform of the tile;
   - each pixel is transformed by **bilinear interpolation** of the transforms of the four nearest tile centres.
9. **Local contrast** (unsharp mask), on luminance: `T' = T + a · (T − mean_r(T))`, with `a = amount / 25` and
   `mean_r` = mean in a square window of side `2r + 1` (separable box blur, cost proportional to the number of
   pixels).
10. Steps 7–9 are applied as a **luminance shift** equal in R, G and B (`R += T' − L`, etc.), which approximately
    preserves hue.
11. **Inversion** (optional): `v = 255 − v`.

Interactive enhancement (moving the sliders) and the enhancement applied when a section is opened run in a
background worker (`worker.js`) with the same functions, so the results are identical and the interface does not
freeze; only the latest request of each section is applied. Where workers are not available (the offline file
opened as `file://`) the same code runs on the main thread.

### 7.2 Presets (`FILTER_PRESETS`)

| Preset | Values | Source |
|--------|--------|--------|
| No enhancement | all neutral | — |
| **Dorador et al. (2014)** | automatic levels, automatic gamma (0.19–1), contrast 20, brightness −3, vibrance −31, saturation 34 % | Dorador, Rodríguez-Tovar and IODP Exp. 339 Scientists (2014) |
| **CLAHE (Miguez-Salas et al., 2019)** | block 127 px, slope 3 | Miguez-Salas et al. (2019); Fiji defaults |
| Levels and contrast (generic) | black 40, white 215, contrast 25, saturation 140 % | own starting point |
| Local contrast | amount 60, radius 25 px, contrast 15 | own starting point |
| Equalised + local contrast | grey, equalise, amount 40, radius 20 px | own starting point |

**How the published protocols were translated.**

- **Dorador et al. (2014)** describe three steps in Photoshop CS6, with values chosen for each image (38 cores and
  10 intervals): (1) Levels: minimum and maximum input values with means 54.3 and 100, and mid-grey 0.76 (range
  0.19–1); (2) Brightness and contrast: mean contrast 70 (scale −50 to 100) and mean brightness −8 (scale −150 to
  150); (3) Vibrance and saturation: means −31 and −66. Because levels depend on each image (on other images, 54–100
  can turn almost everything white), here they are computed from percentiles, and gamma is fitted to the median
  within the published range. Vibrance and saturation use the published means. Photoshop's contrast and brightness
  scales are neither linear nor equivalent to the ones used here, so 20 and −3 are approximate equivalents chosen
  visually; the user can refine them.
- **Miguez-Salas et al. (2019)** apply Fiji's "Enhance Local Contrast (CLAHE)", adjusting block size and histogram
  bins without giving values. Fiji's defaults are used (block 127, 256 bins, slope 3). The Fiji plugin computes the
  histogram in a sliding window around each pixel; here the tiled version with interpolation (Zuiderveld, 1994) is
  used. The effect is equivalent but not identical pixel by pixel.

These are standard image-processing operations (Gonzalez and Woods, 2018). The presets without a published source
are starting points and are labelled as such in the interface. The effective enhancement parameters of each section
are stored in the project, so the procedure can be reproduced. Saved settings are described in §23.4.

### 7.3 Choosing a preset automatically
Implementation: `imageproc.js::traceSeparation, localSeparability`, `app.js::rankPresets`. This is SedCoreTool's own
procedure, not a published one. Each preset (built-in presets and saved settings; for built-in presets also each single
channel R, G, B) is applied to a reduced copy of the image (side ÷ k, with k such that about 0.4 MP remain; block
averaging), and scored:

1. **If the section has traces identified by hand** (at least 50 pixels of the reduced copy belonging to a class
   that counts), each preset is scored by how well it separates those traces from the matrix (pixels without a trace
   or of the class Artefact, outside exclusions), using the variable the detection uses: luminance minus its local
   mean of radius `radius/k` (adaptive threshold) or luminance (global threshold). Score = `2·AUC − 1` in the
   direction of "Traces are" (darker, lighter or both: `max(AUC, 1 − AUC)`), with
   `AUC = P(matrix > trace) + ½ P(equal)` computed from histograms. In the reduced copy each block takes the
   majority label (mixed blocks are not used); the local mean is used only with the adaptive threshold (not with
   k-means or U-Net).
2. **Without identified traces**, local separability: in squares of about 96 px of the full image with a standard
   deviation of at least 4 grey levels, pixels are split at the Otsu (1979) threshold and the Fisher ratio
   `J = (μ₁ − μ₂)² / (σ₁² + σ₂²)` is computed; it does not change under a linear contrast stretch and equals 6 for a
   uniform histogram. Each square scores `J/(J + 6) · κ`, with `κ = max(0, (A − E)/(1 − E))`, where `A` is the
   fraction of horizontal and vertical neighbour pairs on the same side of the threshold and `E = p₀² + p₁²` its
   expected value if pixels were placed at random. The score is the mean over squares. κ removes the reward that
   unstructured noise would otherwise get: on noise κ ≈ 0 whatever the enhancement (0.003–0.005 on 400 × 300
   synthetic images), while compact traces give a high κ. Without identified traces, if the best preset does not
   beat "No enhancement" by at least `max(0.005, 5 %)`, "No enhancement" is proposed.

The best preset is applied and the four best are shown. A clear separation of two grey populations (burrow fill
and matrix) is in line with the pixel-value comparison of Rodríguez-Tovar and Dorador (2015); still, the ranking is
a starting proposal that the user reviews.

No published work after Miguez-Salas et al. (2019) was found that proposes how to preselect enhancement parameters
for core images. Recent work uses computed tomography (*Scientific Reports*, 2020, doi:10.1038/s41598-019-57028-z),
laminography (*Marine Geology*, 2024) or neural networks trained directly on unenhanced images (Di Martino et al.,
2023; Kikuchi and Naruse, 2024).

---

## 8. Automatic trace detection

Implementation: `imageproc.js::detectMask, components, kmeansThreshold, fillHoles` and `app.js::runDetection`.
Detection runs in the background worker, like enhancement.

### 8.1 Threshold
Detection works on the luminance `L` (BT.601) of the **enhanced** image, only inside the analysis area and outside
excluded zones. Four methods are available:

- **Adaptive (local)**, the default. The local mean `μ` is computed in a square window of side `2r + 1` (box blur).
  A pixel is a candidate if:
  - darker traces: `L < μ − δ`
  - lighter traces: `L > μ + δ`
  - both: `|L − μ| > δ`

  This is the "mean minus constant" (mean-C) threshold, which compensates changes in lighting and background colour
  along the core.
- **Global:** candidate if `L < t` (dark) or `L > t` (light); "both" is treated as "dark" in this mode.
- **Two-class k-means** (`kmeansThreshold`), like the K-Means option of ICY used by Miguez-Salas et al. (2019):
  initial centres at the 10th and 90th percentiles of `L` inside the area; assignment and mean are iterated until
  the centres move less than 0.001 (at most 50 iterations); the threshold is the midpoint between the two centres
  and is applied like the global threshold.
- **U-Net** (learned segmentation), described in §9.

**Fill holes** (optional): after morphology, background pixels that cannot be reached from the edge of the area
(4-connected flood fill) become trace. It is equivalent to the binary "Fill holes" of Fiji used in the same study.

### 8.2 Morphological cleaning
An **opening** (erosion then dilation) is repeated `s` times (the "smoothing" parameter) to remove isolated points,
then a **closing** (dilation then erosion) is repeated `s` times to fill small gaps. The structuring element is a
3 × 3 square applied separably (horizontal then vertical). At the image edges the edge pixel is repeated.

### 8.3 Objects
**8-connected components** are found (breadth-first search) and those smaller than `A_min` pixels are removed.
Each remaining component is a candidate object.

### 8.4 Detecting again
When detection is repeated:
1. only automatic candidates **without an assigned class** are deleted;
2. new candidates only take free pixels: they never overwrite objects identified or drawn by the user;
3. a candidate that falls below `A_min` after that clipping is removed.

### 8.5 Default values
`DEFAULT_DETECT` (`imageproc.js`): adaptive, dark traces, `δ = 12`, `r = 40 px`, `t = 80`, `A_min = 40 px`, `s = 1`,
fill holes off, U-Net minimum probability `0.5`.

Detection **proposes candidates; the user reviews them**. It is not presented as a validated automatic
segmentation. Its quality depends on the contrast between burrow fill and matrix and has not yet been measured on
real core photographs (§31.3). The parameters used are stored in the project. The adaptive threshold and
mathematical morphology are classical methods (Serra, 1982; Gonzalez and Woods, 2018), chosen because they are
fast, deterministic and easy to explain.

---

## 9. Learned segmentation (U-Net)

### 9.1 Running a model in the program
With the detection method **U-Net**, a U-Net trained outside the interactive tools (with the Python package or the
desktop training module, §9.2–9.3) gives, for every pixel, the probability of bioturbation `P`. The program runs it
with ONNX Runtime Web (WebAssembly, one thread, no GPU); Python uses ONNX Runtime's CPU provider. Both follow
the same rules (`app/js/unet.js` and `src/sedcoretool/unet/tiling.py`), checked against the same reference file
(`tests/fixtures/unet_parity.json`).

1. **Input:** the **original** image (not enhanced) of the analysis area. Enhancement is not used because it
   changes with the user's settings, while the network must see what it saw during training.
2. **Scale:** if the model states its training resolution `ρ_m` (px/cm) and the section has
   `ρ_s = (y₁ − y₀) / (bottom − top)` (in cm), the image is rescaled by `f = ρ_m / ρ_s` when `|f − 1| > 0.02`.
   New size: `W' = round(W·f)`, `H' = round(H·f)`. Bilinear interpolation with aligned pixel centres:
   `x_s = clamp((x + 0.5)·(W/W') − 0.5, 0, W − 1)` (same for `y`); for 8-bit images the result is rounded to the
   nearest integer (ties to even). The probability is brought back to the section's resolution with the same
   interpolation.
3. **Tiles:** side `T` and overlap `o` of the model (512 and 64 px by default). Starts along each axis:
   `0, T − o, 2(T − o), …` while `start + T < L`, plus a last tile at `L − T`; if `L ≤ T`, a single tile. Outside the
   image the edge is repeated.
4. **Normalisation:** `x_c = (v_c / 255 − μ_c) / σ_c` with `μ = (0.485, 0.456, 0.406)` and `σ = (0.229, 0.224, 0.225)`
   (ImageNet), or the values in the model's JSON.
5. **Output:** logits `z`. With one channel, `P = 1 / (1 + e^(−z))`. With `C > 1` channels (channel 0 = matrix),
   softmax `p_k = e^(z_k) / Σ e^(z_j)`, `P = 1 − p_0` and class = `argmax_{k ≥ 1} p_k`.
6. **Blending tiles:** weighted mean with weight `w(i) = min(1, (i + 0.5)/o, (T − i − 0.5)/o)` along each axis and
   `w(x, y) = w(x)·w(y)`, which avoids visible seams between tiles.
7. **Mask:** a pixel is a candidate if `P ≥ p_min` ("Minimum probability" slider, 0.5 by default), inside the
   analysis area and outside exclusions; then the same cleaning (§8.2) and objects (§8.3) as the other methods.
   Changing `p_min` does not run the network again: the probability is kept in memory until the model, the area,
   the size or the scale change. It is not stored in the project.
8. **Uncertain zones:** an option marks in magenta the pixels with `|P − 0.5| < 0.2`.
9. **Model files:** the user loads `model.onnx` and `model.json` (tile side, overlap, normalisation, px/cm, classes,
   output type). Without the JSON the defaults are used. The model is not stored in the project; the chosen method
   and `p_min` are.

With a multi-class model the program currently uses only `P` (bioturbation yes/no); the class predicted by the
network is not assigned to the objects (that is the job of the ichnotaxa classifier, §12).

The desktop program bundles ONNX Runtime Web; the browser and the offline file download it from jsDelivr the first
time.

### 9.2 Training data and training (Python package)

Dataset preparation requires an empty output directory and rejects validation and test core lists that overlap.
Choose a new output directory for each preparation so stale tiles cannot contaminate the split.
Python accepts classic stored or Deflate training ZIPs up to 2 GiB on disk. It checks a central directory of at
most 16 MiB before parsing it, limits declared and requested expanded bytes to 1 GiB, individual members to
256 MiB and `manifest.json` to 16 MiB. The unpacked-folder path uses the same member and read limits and accepts
only files within the export directory. The final RGB and mask arrays are limited to 256 MiB per image pair and
1 GiB per dataset before decoding.

The data come from the program: **Results → U-Net training data (ZIP)** exports every image of the project that has
at least one reviewed trace (§24). The Python package then provides four commands (`sedcoretool unet …`, §25.4):

- **`prepare`** reads the ZIP, rescales each image to a common resolution (by default the median px/cm; masks by
  nearest neighbour with the same centre rule), cuts tiles with the rules of §9.1 and discards tiles with less than
  50 % valid pixels. Parts of a tile outside the image are marked "ignore". **Split by core:** all tiles of a core go
  to the same set (training, validation or test). Cores can be chosen; otherwise they are assigned at random with a
  seed (20 % test and 20 % validation, at least one of each when there are 3 or more cores). Binary by default (all
  classes → 1); `--multiclass` keeps ichnotaxa as classes. The output directory must be empty, so that tiles of two
  datasets are never mixed; `--overwrite` replaces a previous dataset (a directory containing `dataset.json`) and
  refuses any other non-empty directory. Validation and test core lists must not overlap.

  Prepared image and mask tiles have matching names:
  `<core-label>__<section-label>__<identity-sha256>__y<row>_x<column>.png`. Each display label replaces runs outside
  ASCII letters, digits, `_` and `-` with `_`, then retains at most 32 characters. The full 64-digit SHA-256 is
  calculated from the ASCII encoding of `json.dumps([core, section], ensure_ascii=True, separators=(",", ":"))`.
  Thus source identifiers remain unchanged in the core split, while separators, drive prefixes, case variants,
  ambiguous `__` boundaries and truncated labels cannot silently merge output filenames. Core and section
  identifiers must be non-empty strings. Duplicate identifier pairs are rejected before output creation or
  replacement, including with `--overwrite`.

  The chosen output root is resolved first. Partition directories, image/mask directories and `dataset.json`
  are checked before replacement; every tile destination is checked before writing. A path must resolve to
  itself below that root, so symbolic links and Windows junctions inside the output tree are refused. Tiles
  and metadata are created exclusively, rejecting an existing file instead of silently replacing it. Image
  and mask pixels, tile geometry and the core split use the same preparation rules. Existing prepared folders
  remain compatible with training and evaluation. Newly generated names can change the lexicographic order
  used by the training loader; resume a checkpoint with its original prepared folder.
- **`train`**: U-Net (Ronneberger et al., 2015) with a ResNet-34 encoder pre-trained on ImageNet
  (`segmentation-models-pytorch`). Loss = cross-entropy (binary: BCE with logits) + soft Dice
  `1 − (2Σpt + 1)/(Σp + Σt + 1)` (multi-class: mean over classes ≥ 1), ignoring pixels marked 255. Augmentations:
  horizontal and vertical flips, contrast ×U(0.85, 1.15), brightness +U(−0.08, 0.08) and gamma U(0.8, 1.25). **No
  90° rotations**, because the orientation of a trace relative to bedding is diagnostic. AdamW (lr 3·10⁻⁴, weight
  decay 10⁻⁴), cosine schedule, at most 60 epochs and early stopping after 12 epochs without improving validation
  Dice. It exports ONNX (opset 17, input `image` 1×3×T×T, output `logits`) and the JSON description.
  PyTorch checks global free CUDA memory or the Metal recommended working set minus allocations by this process.
  Training requires at least the larger of 256 MiB and `batch × tile² × 20` bytes of headroom for the input and
  target. CUDA takes precedence when available. A failed probe or insufficient headroom selects CPU. If a
  recoverable accelerator error occurs while training, the program releases GPU allocations and retries once on
  CPU from the last complete checkpoint of this run, or from its starting state if no epoch was saved.
  `cpu_only=True` or `--cpu-only` bypasses the probes and takes precedence over the requested training device.
- **`evaluate`** predicts each **whole** image of the test cores (as the program does) and compares it with the
  expert mask, ignoring pixels marked 255. Bioturbation = any class > 0. IoU = TP/(TP+FP+FN);
  Dice = 2TP/(2TP+FP+FN); precision = TP/(TP+FP); recall = TP/(TP+FN). Per interval of `b` cm (`b·ρ` rows, same
  limits as §3.2): `%` = 100·positives/valid; mean absolute error and bias in percentage points, and the proportion of
  intervals with the same BI and ii. Pooled scores sum TP, FP and FN over all images before computing IoU and Dice.
- **`predict`** and `mask_from_unet`: the mask of one image, with the same contract as the other mask functions
  (§25.2).

### 9.3 Training on the computer (desktop program)
The button **Train on this computer…** of the U-Net method (`desktop/trainer.js`, `preload.js`, `main.js`) trains a
model without leaving the program. It exists only in the desktop program: a browser cannot run PyTorch or use the
graphics card.

1. **Training module:** a private virtual environment in `<user data>/trainer/venv`, created with the system's
   Python ≥ 3.10 (`py -3`, `python` or `python3`). It installs PyTorch (on Windows with an NVIDIA card, detected with
   `nvidia-smi -L`, from `https://download.pytorch.org/whl/cu128`, because PyPI only has the CPU build; on Linux and
   macOS from PyPI) and `sedcoretool[unet]` from the copy of the package shipped with the program
   (`resources/python`). It is installed once, when the user asks (2–3 GB). The desktop runs the CLI code from
   its bundled Python source with the dependencies from this environment, including on app upgrades.
2. **Hardware:** `sedcoretool unet device` reports the accelerator that passes the memory probe or `cpu`. Each
   training run probes again using its tile and batch size. Progress reports the device used for each epoch.
3. **Data:** the same ZIP as "U-Net training data", built in memory. The user marks each core as Auto, Validation or
   Test (`--val`, `--test` of `prepare`); Auto follows the rule of `prepare`.
4. **Run:** `prepare` → `train --progress-json` (one JSON line per epoch: epoch, loss, validation Dice, best Dice and
   its epoch, device) → `evaluate` on the test cores if there are any. Fresh attempts write ZIP, prepared tiles,
   checkpoint, weights, candidate ONNX/JSON and evaluation into
   `<user data>/trainer/staging/<name>.pending`. The suffix-free Python output prefix is `model`, independently
   of dots in the user-facing model name. The previously published model stays available throughout the run.
5. **Stop and resume:** after every epoch `model.ckpt` is atomically replaced (network, optimiser, scheduler,
   epoch, best Dice, history and patience). The best weights for that checkpoint can be recovered if writing
   stops between committing the checkpoint and publishing the best weights. Resume continues from the checkpoint
   with the same tiles (`train --resume`). The result is not
   bit-identical to an uninterrupted run (the random order of augmentations is not saved); this is recorded in the
   model's history. Cancellation stops the child and prevents subsequent steps or publication. A failed attempt
   with a checkpoint remains resumable even if candidate ONNX/JSON files already exist. Resume clears those
   candidate outputs and regenerates them from the checkpoint. Starting fresh discards only that name's staged
   attempt, including its checkpoint; published generations and legacy files are preserved.
6. **Publication:** successful training, a nonempty ONNX, object-valued JSON metadata and, when test cores exist,
   successful evaluation are required. Evaluation has no additional minimum-score gate. ONNX, JSON and optional
   test evaluation are copied into a new `trainer/models/<name>.versions/<generation UUID>/` directory as
   `model.onnx`, `model.json` and `evaluation_test.json`. Only then is `<name>.current` replaced: it contains
   `{"version":1,"generation":"<UUID>","runId":"<UUID>"}`. The JSON is written to an exclusive temporary file
   in the same directory, flushed and renamed over the reference without deleting the previous reference first.
   A failed copy, write or replacement leaves the old reference active. Readers resolve it once and use the
   immutable generation for both model files and the displayed test score, so they cannot see mixed versions.
7. **When it finishes:** the model is loaded in Detection through the same `readModel(name)` IPC contract.
   The model list shows the validation Dice and, if there were test cores, that generation's test Dice. A run
   without test cores has no inherited test score. Its staged run UUID matches the active reference and is
   no longer shown as unfinished. An explicit API resume starts a new attempt UUID using the same checkpoint.

**Compatibility and recovery.** Models without a `.current` reference still use `models/<name>.onnx` and
`.json`, with any evaluation in `runs/<name>/evaluation_test.json`. Legacy checkpoints and best weights are
copied into staging for resume, retaining their original basenames and Python pending-best recovery files;
the original `runs/<name>/data` and ZIP are reused. The old files remain byte-identical. Published-reference
UUIDs and staged model basenames are validated before resolving paths. Workspaces have their own `run.json`
with `id`, `model` and `legacy`; filesystem locations are derived by the trainer, not taken from that JSON.
An absent checkpoint cannot silently turn a Resume request into a fresh run.

To use the current model outside the desktop program, copy both files from the generation selected by
`<name>.current`; their ONNX/JSON format is unchanged. Previous generations, original legacy files and
unreferenced copies from failed publications are retained, without automatic garbage collection. Reference
replacement provides a single commit point on filesystems supporting atomic rename; this does not guarantee
durability after power loss or coordinate simultaneous trainers in separate application processes.

Security: the page can reach only six functions (`status`, `install`, `train`, `cancel`, `readModel`, `openFolder`)
through `window.corantoolDesktop.trainer`, and the main process answers only calls that come from the program's own
pages (`app://`).

---

## 10. Editing tools and the exclusion layer

Implementation: `imageproc.js::regionGrow, polygonPixels`, `edit.js` and `app.js` (tools).

| Tool | Algorithm |
|------|-----------|
| **Magic wand** | 4-neighbour flood fill from the clicked pixel. It includes pixels whose Euclidean RGB distance to the colour of the seed pixel is ≤ tolerance. It uses the image being shown (enhanced or original), limited to the analysis area and outside exclusions. Limit: 4 million pixels. |
| **Lasso** | The user draws a polygon; pixels whose centre lies inside are filled (even–odd rule, row scan). |
| **Brush** | Disc of radius `r` px; the stroke is interpolated every `r/3` px. Starting on an object enlarges it; starting outside creates a new object with the active class. |
| **Eraser** | Disc of radius `r` px that removes the pixels of any object. With Shift it erases only the selected trace. |
| **Exclude / Restore** | A brush (or, with the shape "Rectangle" or Shift + drag, a rectangle) that sets or clears a separate **exclusion** layer. |
| **Scissors** | The user draws a line (3 px wide) across a trace: the selected one if the line crosses it, otherwise the first trace the line meets. Without the line's pixels the trace splits into connected pieces (4 neighbours); the line's pixels go to the neighbouring piece. The largest piece keeps the identifier and the others become new objects with the same class, suggestion and origin. If the line does not split the trace nothing changes. |
| **Merge** | With several traces selected, merges them into one, keeping the largest with a class assigned by hand (or, if none, the largest). Overlaps are respected. |

Modifiers: Shift adds to the selected object and Alt subtracts (wand and lasso).

**Overlay** (brush, wand and lasso; on by default, remembered by the browser, key S). When on, a new trace is added
on top of the existing ones in those pixels and all of them count (§3.2, overlapping traces); with the brush,
starting on a trace of another ichnotaxon creates a new trace instead of enlarging it, while starting on a trace of
the active ichnotaxon enlarges it (Shift enlarges the selected one). When off, the new trace replaces those below.
Subtracting (Alt) removes only the selected trace. Clicking again on an overlap selects the trace below.

**Selecting several traces.** With the selection tool, dragging draws a box and selects the traces whose bounding-box
centre falls inside (replacing the selection; with Shift or Ctrl, adding to it). Shift or Ctrl + click adds or
removes a trace. All traces suggested as the active class, or all unreviewed traces, can also be selected. Keys 1–9
(and 0), "Assign to all", "Accept their suggestions" and "Delete all" act on the whole selection in a single undo
step, for detected and hand-drawn traces alike. The view does not move when assigning; "Jump to the next after
assigning" is off by default (remembered by the browser) and, when on, centres the next trace without changing the
zoom. The view is moved with the hand tool, the space bar or the middle mouse button.

**Exclusion layer.** Excluded pixels leave both the numerator **and** the denominator of the percentage (§3). It is
meant for cracks, voids, sampled zones, labels or drilling disturbance, so that "no bioturbation" is never confused
with "no data".

**Undo and Redo.** Each operation stores changed label and exclusion pixels with their previous values and a
delta keyed by trace ID. The delta holds the first previous record of each modified or deleted trace and a
marker for each new trace that remains after the edit. Shallow copies share geometry and descriptor values
that the editor replaces on change. Undo swaps the saved and live values and moves the step to Redo.
Redo swaps them back and returns the step to Undo. Undo walks repeated pixel writes in reverse order and
Redo walks them in edit order. A saved overlap holds its ordered list of trace IDs and is interned in the
current stack table when restored. Trace order is assigned in memory when a section opens and as traces
are added, so restored records rejoin the section at their previous positions.

Both directions share a limit of 30 steps and an estimated 200 MB of changed pixel entries. Related steps
such as a class assignment and its automatic merges replay and expire together. The latest action stays
intact if it alone exceeds a limit. A new recorded edit discards Redo. Cropping, rotation, changing working
resolution and deleting a section discard its history in both directions. Deleting a class clears both
directions for the active core because saved trace records may refer to that class. The history is kept
in the active core session and never written to the project file.

After each edit, descriptors (§11) are recomputed only for the affected objects, inside the rectangle that contains
them. Deleting traces only scans the union of their bounding rectangles (the whole image if one has no rectangle).

---

## 11. Object descriptors

Implementation: `imageproc.js::objectStats, features`. They are computed on the **original image** (not enhanced)
so that learning does not depend on display settings.

Let `n` be the number of pixels of the object, `(x, y)` its coordinates, `ppcm` the resolution (§2.3) and
`(R, G, B)` the original colour.

Second-order moments: `cxx = var(x) + 1/12`, `cyy = var(y) + 1/12`, `cxy = cov(x, y)`. The term 1/12 is the variance
of a square pixel of side 1 and avoids zero values for objects one row or one column thick. Eigenvalues: `λ₁ ≥ λ₂`.
Angle of the major axis from the horizontal: `θ = ½ · atan2(2 cxy, cxx − cyy)`.

| Descriptor | Formula | What it measures |
|------------|---------|------------------|
| `logArea` | log₁₀(n / ppcm²), area in cm² | Size |
| `logMajor` | log₁₀(4 √λ₁ / ppcm) | Length: major axis of the ellipse with the same moments, in cm |
| `logMinor` | log₁₀(4 √λ₂ / ppcm) | Width, in cm |
| `elong` | √(λ₁ / λ₂) | Elongation (1 = round) |
| `vert` | \|sin θ\| | Verticality (1 = major axis vertical, 0 = horizontal) |
| `compact` | min(1, 4π n / P²), P = boundary pixels | Compactness (1 = disc) |
| `fill` | n / area of the bounding rectangle | Fill of the bounding rectangle |
| `meanL` | mean of L (BT.601) | Brightness of the fill |
| `stdL` | standard deviation of L | Texture of the fill |
| `meanA` | mean of (R − G) | Red–green colour axis |
| `meanB` | mean of ((R + G)/2 − B) | Yellow–blue colour axis |
| `contrast` | meanL − mean of L in an outer ring | Contrast with the matrix |

The outer ring is sampled 3 pixels away from each boundary pixel, in the four directions, where that point does not
belong to the object. Sizes are expressed in **centimetres**, not pixels, so that examples from images with
different resolutions are comparable.

These are classical shape descriptors (image moments; Hu, 1962) and colour descriptors. `meanA` and `meanB` are a
fast approximation of the opponent axes of CIELAB, not a colorimetric conversion. `compact` uses the number of
boundary pixels as the perimeter, which underestimates the true perimeter of diagonal outlines; the approximation is
consistent between objects, which is what matters for comparing them. Colour descriptors depend on the camera and
the lighting (§32).

---

## 12. Identifying ichnotaxa

Implementation: `learn.js::Classifier, TaxonModel, evaluateModels` and `app.js::learnNow`. The classifier suggests
the ichnotaxon of each trace from the examples the user has labelled. It is independent of the multiproxy interval
classifier (§18), which uses other code, other variables and another goal.

### 12.1 Examples
Each object with a class assigned by the user is an example `(x, y)`: `x` is the vector of the 12 descriptors of
§11 (or, optionally, a vision-model vector, §12.6) and `y` the ichnotaxon. Examples come from the traces of the
project and from a **library** of examples imported into the project (from a model file or from other projects,
§12.5). Traces of cores reserved for the final test are never examples (§18.10).

### 12.2 k-nearest-neighbour classifier (default)
1. **Standardisation:** each descriptor becomes `z = (x − mean) / standard deviation`, with the mean and standard
   deviation of the examples; a standard deviation of 0 is replaced by 1.
2. **Distance:** Euclidean in the standardised space.
3. **Vote:** the `k = 5` nearest neighbours vote with weight `w = 1 / (d + 0.05)` (or 1 with uniform weights).
4. **Probability of each ichnotaxon:** `p(class) = Σ w of the neighbours of that class / Σ w of the k neighbours`.
   The **confidence** of a suggestion is the `p` of the winning class (0 to 1).

### 12.3 Rejecting unknown shapes (novelty)
`m` is the median distance from each example to its nearest neighbour (leaving it out). If the distance from an
object to its nearest example is greater than `ν · m`, the object **is not labelled** and is marked as "does not
look like anything known". `ν` is the "Tolerance to new shapes" (3 by default, adjustable from 1 to 8).

### 12.4 Confidence threshold, accuracy and updating
- A suggestion counts as an **automatic identification** only if its confidence is ≥ 0.70 ("Minimum confidence",
  adjustable from 0.30 to 0.99). Below that, the object remains an unreviewed candidate.
- **Estimated accuracy:** with at least two classes, leave-one-out cross-validation: each example is classified with
  the others and the percentage of correct answers is reported. When the examples come from two or more sections,
  the whole section of the example is left out (neighbouring traces of the same image look alike and would
  inflate the accuracy); the novelty scale still uses the nearest neighbour from any section. At most
  `LOO_MAX = 1500` evenly spaced examples are used for this estimate (the rest of the calculation uses all).
- The model is recomputed automatically 60 ms after each change. k-NN needs no training: the cost is proportional to
  examples × objects. **Accept suggestions** turns automatic identifications into labels, which then become
  examples.

### 12.5 Three models, methods, evaluation and examples
**Three scopes**, fitted together with the same method after each change:
- **Core:** examples (labelled traces) of the open core + the project library.
- **Project:** examples of all the cores of the project + the library.
- **All projects:** those of the project + the library + the examples of the other projects (a light copy
  `examples: [{name, x}]` that each project keeps in the `lite` index when it is saved; cross-project analyses are
  left out to avoid duplicates). An example from another project is skipped if its descriptor vector, rounded to 3
  decimals, matches one already present.

Classes are matched **by name**, because identifiers differ between projects. The object panel shows, for the 4
classes with the highest summed `p`, the probability under each model, and warns if any model considers the object a
new shape. **Model that suggests** (`settings.clfScope`, `project` by default) decides which model provides the
suggestion, the confidence and the automatic identifications.

**Methods** (dialog *Models and training*, settings in `settings.ml`, defaults in brackets):
- **k-NN** (§12.2): `k` (5), vote weight `distance` = `1/(d + 0.05)` or `uniform` = 1.
- **Random Forest** (`geo.js::fitModel('rf')`, same algorithm as §18.4) on the standardised descriptors `z`: trees
  (100), maximum depth (12), minimum examples per leaf (2), class balancing (yes); other parameters as in §18.4;
  seed 42.
- **Gaussian naive Bayes** (`fitModel('nb')`) on `z`: uniform prior (default) or empirical.

With every method the k-NN is also fitted, because it provides the standardisation, the novelty test and, for k-NN,
the leave-one-out accuracy. With Random Forest or Bayes the probability of each class is the method's; the suggested
class is the most probable unless the k-NN marks the object as a new shape. The estimated accuracy of Random Forest
and Bayes is the balanced accuracy of the last evaluation.

**Evaluation** (`evaluateModels`). Test set: the labelled traces of the open core if there are ≥ 10 of ≥ 2 taxa;
otherwise those of the project. Traces are split into 5 folds **by group**, where the group is the section (image) or
the core ("Leave out", `settings.ml.cvGroup`): all traces of a group go to the same fold (groups shuffled with seed
42 and assigned to the fold with fewest traces of their main taxon; `groupedFolds`). With 2–4 groups there is one
fold per group (leave one group out); only with a single group are folds stratified by taxon
(`stratifiedFolds`), with a warning that accuracy will be very optimistic. The scheme (`groups`, `logo`,
`examples`), the number of groups and folds are shown, with the note that accuracy is optimistic because the same
evaluation chooses the method. For each fold and each model (core, project, all), the model is trained with its
examples **without the traces of that fold** (and without the other traces of test groups present in that set) and
predicts them, without the novelty test. The 9 combinations (3 methods × 3 models) are judged on the same traces.
The results are overall accuracy, balanced accuracy (mean of the recall of each taxon) and confusion matrix.
Predictions of a taxon absent from the test set count as errors (column "other"); denominators are all the test
traces of each taxon, and n = number of test traces.

**Recommendation:** the combination with the highest balanced accuracy; if others are within 3 points, the simplest
is chosen (k-NN, then Bayes, then Random Forest; and core, then project, then all).

**Examples used:** thumbnails (crop of the bounding rectangle with outline, 64 px, JPEG 0.7) grouped by taxon.
Unticking "use" on a trace of the project sets `o.nt = true` (saved as `nt: 1`): it stays labelled and counts as
bioturbation, but is not an example for any model. For traces of other projects an exclusion list is kept in the
browser (`ml.excluded`). Library examples can be removed.

**Examples from other projects:** the `lite` index stores, for each labelled trace, `{key, name, x, core, thumb}`
(`key = project|core|section|object`). They can be added to the project library (`library: {key, name, x, thumb,
from}`); if the taxon does not exist, it is created with that name.

**Stored weights** (`Classifier.toJSON`): `k`, `ν`, mean and standard deviation of each descriptor, novelty scale `m`,
accuracy, counts and the examples (descriptors rounded to 5 decimals). The project file stores `models.project` and
`models.cores[id]`; the all-projects model is stored in the browser preferences (`model.all`).
`Classifier.fromJSON` rebuilds it without refitting.

### 12.6 Features from a pre-trained vision model
An alternative to the 12 descriptors as classifier input (`settings.ml.features`: `'shape'` or `'vision'`; dialog
*Models and training*, Training tab). Implementation: `vision.js`.

1. **Model:** DINOv2 ViT-S/14 (Oquab et al., 2024), a vision network trained without labels on 142 million images, in
   ONNX format (`onnx-community/dinov2-small`, 88 MB). It is not trained in SedCoreTool: it only turns each image into
   a vector. It is downloaded once and kept in the browser or program cache (`caches`, key = URL); a user `.onnx` with
   the same interface can be loaded instead. The download is pinned to the Hugging Face commit
   `8b1f705a3a7f6f062f6bdd21986c1583d3ef105d` (`VISION_MODEL.rev`); the expected SHA-256 of `onnx/model.onnx`
   (88,532,934 bytes) is `f22797eabf810a75e41de68d378541ebea372122b25c4ce3ef25ff618250c20a`. The program computes the
   SHA-256 of the file actually used, stores it in the project (`settings.ml.visionSha`), warns if the downloaded hash
   does not match (without blocking) and warns if a different file is loaded later, because its vectors would not be
   comparable.
2. **Window:** a square centred on the trace's rectangle `[x₀, y₀, x₁, y₁]`, of side
   `L = max(16, round(max(width, height)·(1 + 2·0.25)))` and centre `((x₀ + x₁ + 1)/2, (y₀ + y₁ + 1)/2)`. It includes
   25 % of surrounding sediment on each side (context). Outside the image the edge is repeated.
3. **Input:** the **original** image (not enhanced), bilinear resampling to 224 × 224 px
   (`x_s = x_v + (x + 0.5)·L/224 − 0.5`), `(v/255 − μ_c)/σ_c` with the ImageNet mean and standard deviation (§9.1).
4. **Vector:** the `pooler_output` (normalised class token) or, if absent, the first token of the first output;
   384 values, normalised to length 1 (`v/‖v‖`) and rounded to 4 decimals. It is stored in the object (`emb`; `em` in
   the project) and deleted if the area or rectangle of the trace changes.
5. **Classifier:** the same as §12.2–12.5 (k-NN, Random Forest or Bayes; per-dimension standardisation, novelty
   rejection, three scopes, evaluation). The vector length is taken from the examples. The feature set is stored with
   the model (`features`: the 12 descriptor names or `["vision:dinov2-small:384"]`) and vectors of different sets are
   **never mixed**: the library and the examples from other projects keep both (`x` and `xv`) and the one of the active
   mode is used.
6. **Computation:** the button "Compute descriptors" processes all pending traces; in vision mode, new or edited traces
   of the open image are processed automatically 0.7 s after the change.

The vision model was trained on general photographs, not on cores: its vectors describe shape and texture
generically. Whether it identifies ichnotaxa better than the 12 descriptors is a hypothesis to be measured with the
evaluation above and, for any published claim, on independent cores. The vectors cannot be interpreted one by one;
the explanation of a suggestion remains "it looks like these examples". A technical check (pinned model run with
ONNX Runtime Web inside the desktop program, from `app://` and under the program's content security policy, on a
32 × 32 synthetic input: 384 finite values, norm 0.999998554998956 after rounding) confirms that weights and
inference work; it says nothing about identification accuracy.

### 12.7 Why k-NN is the default, and what limits the suggestions
- **Few examples:** it works from the second example; a user labels tens of objects, not thousands.
- **Incremental:** each correction applies at once, without retraining.
- **Transparent:** a suggestion is explained by the similar examples.
- **Explicit rejection:** it is easy to say "I don't know" by distance.
- **No trained parameters:** reproducible and deterministic.

Random Forest and Bayes are offered as alternatives, compared with the same evaluation.

What limits the suggestions:
- Accuracy estimated from the same core or from neighbouring traces is **optimistic** (spatial autocorrelation).
  Grouped folds reduce this; a sound validation needs cores not used for labelling, which is what the final test on
  reserved cores provides (§18.10).
- Unbalanced classes (many *Chondrites*, few *Zoophycos*) bias the vote towards the frequent class. Distance weights
  and class balancing reduce it but do not remove it.
- Accepting suggestions is self-training: accepted errors are reinforced. This is why there is a confidence
  threshold and object-by-object review.
- A detected object may contain several traces joined together, or one trace cut into several objects;
  classification inherits detection errors.

---

## 13. What counts as bioturbation

Implementation: `app.js::effClassId, effClassArray`. For each object an **effective class** is decided in this order:

1. the class assigned by the user, if any;
2. otherwise the automatic suggestion, if "Count automatic identifications" is on and its confidence ≥ the threshold;
3. otherwise "Undetermined bioturbation", if "Count unreviewed candidates as bioturbation" is on;
4. otherwise the object does not count.

The class **Artefact** never counts (`counts: false`). It marks false positives (shells, clasts, detected cracks),
which also teach the model what is not bioturbation. Excluded zones never count either. The active settings are
stored in the project, so any result can be reproduced.

---

## 14. Identification mode (presence only)

Hand-placed marks can be hidden in the core column and the whole-core figure without deleting them. When hidden,
their triangles and mark-only legend entries are omitted; the identified-ichnotaxa list remains in identification mode.
The legend of the core column and of the whole-core figure lists the ichnotaxa with a non-zero percentage in the
displayed interval and those identified by hand marks that are shown.

For cores where bioturbation cannot be quantified but ichnotaxa can be recognised, **Identification mode**
(`settings.idMode`, a checkbox in the section bar) records presence instead of area.

- **Mark identified trace** tool (key M): a click places a mark `{id, x, y, cls}` of the active ichnotaxon in `s.marks` (image
  coordinates; stored with the section and cropped and rotated with it). A click within 9 screen pixels of a mark,
  or Alt + click, removes it.
- In the core column (and the whole-core figure) bioturbation, ichnotaxa (%), BI, ii and manual indices are hidden.
  Each mark inside the analysis area is drawn as a triangle on the image at its depth (or age) and relative
  horizontal position, and a column "Identified ichnotaxa" lists, per analysis interval, the ichnotaxa with marks
  (consecutive intervals with the same set are merged; full names, or abbreviations if they do not fit). Outside this
  mode marks are still shown if they exist.
- **Abbreviations** (`abbrevs`): the first 2 letters (Ch, Pl, Th, Zo…); if two coincide, 1st + 3rd letter, then 3
  and 4 letters.
- **Symbols:** each class has a `symbol` — `triDown` (default), `tri`, `circle`, `square`, `diamond`, `star` or
  `cross` — used in the distribution figure, the marks on the image and column, and the column legends
  (`log.js::traceSymbolPath` shares the geometry between SVG and the canvas).

---

# Part IV — The program: core column, data and multiproxy analysis

## 15. Core column

The hand-placed marks track is visible by default and can be turned off independently of the recorded marks.

Implementation: `log.js::compositeRows, buildLogSVG, windowCSV, orderCols, verticalTicks` and
`app.js::renderLog`. The core column shows the whole core: images, interpreted traces, bioturbation, indices,
external records and interval bands, in depth or age.

### 15.1 Joining sections
- Sections are sorted by top depth.
- All depths are converted to the units of the first section (mm, cm or m).
- The intervals of each section (§3) are joined into a single series. **They are not recomputed:** each interval
  keeps its percentage, BI, ii, per-class percentages and manual indices.

### 15.2 Depth or age axis
- **Depth:** each interval occupies `[top, bottom)`.
- **Age:** top and bottom are converted with the age model (§5). If either falls outside the model, the interval is
  not drawn.
- To go from age to depth the inverted model is used (age→depth pairs sorted by age), which **assumes that age
  increases with depth**.

### 15.3 Window
The user chooses from–to on the active axis. Intervals overlapping the window are drawn and everything is clipped
to the window's rectangle.

### 15.4 Image adapted to the axis
The image column is built row by row, with `2 × plot height` rows (at most 4,000):
1. Each output row `r` corresponds to an axis value `v = from + (r + 0.5)/N · (to − from)`.
2. On the age axis, `v` is converted to depth with the inverted model.
3. The section containing that depth and its image row (§2.3) are found.
4. That row is copied, inside the analysis area, scaled to the column width.

The image is therefore stretched or compressed by the age model: slowly deposited parts take more height in age.
The enhanced or original image is used and, if chosen, the counted bioturbation is overlaid in the colour of its
class. It is a **nearest-row sampling**, without interpolation between rows. Each section keeps a reduced copy
(≤ 512 px wide) for the column, so changing colours or thresholds only needs the masks. With **Hide excluded
zones** (`logView.hideExcl`), excluded pixels are drawn white. The image can also be drawn as separate panels per
section (`logView.imgPanels`), with a width in the real proportion of the core photograph by default
(`style.imgAspect = 'keep'`: width = plot height / (height/width of the core), median of the sections; ×
`imgStretch`) or a fixed width (`imgW`).

**Section navigation preview.** The session-only **Optimised navigation preview** checkbox starts enabled
and is not serialised. Disabling it restores the previous renderer until reload, which enables it again.
When enabled, `app.js::drawNav` requests `columns.js::navigationPreviewCanvas` for the
visible strip; column and figure rendering still use `sectionCanvas`. Preview dimensions outside 1–24 pixels
wide or 1–4096 pixels high, noninteger dimensions, invalid saved analysis regions or unavailable source/enhanced
pixels fall back to `sectionCanvas`. Region validity uses the shared `edit.js::validSavedRegion` contract,
preserving the existing inspection path for suspect projects.

`navpreview.js::buildNavigationLayers` visits the source once, accumulating both the photo and mask into the
same grid as the column reducer: scale `min(1, 512 / width)`, with rounded output dimensions. Each output
bucket visits source coordinates from `ceil(output * sourceSize / outputSize)` to the next boundary, exclusively.
RGB uses premultiplied alpha, with an opaque photo, effective countable trace classes and optional white
exclusions. Overlay alpha is `round(255 * max(0.35, min(1, opacity)))`. Integer channel sums for at most 258
pixels are exactly representable in Float32 (`258 * 255 * 255 < 2^24`); larger buckets, or non-byte colours,
round every addition with `Math.fround`, preserving the legacy Float32 reducer. Uint8Clamped conversion and
native canvas composition retain its rounding, followed by the same fractional ROI crop and downscale.
The temporary grid arrays/canvases are not cached; temporary canvases are zero-sized after use.

Only the final displayed strip is cached, with an 8 MiB LRU limit. Weak section lookups and entries without
owner references avoid retaining a closed project. Eviction, disabling the flag and project reset zero-size
the cached canvases. Cache keys include section revision, dimensions/resolution, rotation/crop/ROI, filters,
image/overlay/exclusion settings, opacity, class colours, prediction policy and preview dimensions. Existing
edit paths update the section revision. Pixel and mask cache budgets, working images, scientific arrays,
pointer/depth mapping and export renderers retain their existing contracts. The
[promotion report](benchmarks/M2.2.4.md) defines exact visual comparison and matched performance acceptance.

### 15.5 Columns and scales

Colours can be edited and restored to defaults: bioturbation bars `#e7c9a5` and line `#a85f1c`, BI and ii bars
`#c98a4b`, manual indices and text `#1c2422`, subtitle and section boundaries `#5b6763`, frames `#9aa5a1`,
grid `#e3e8e6`, background `#ffffff`, and no-data fill `#f2f2f0` and hatching `#b9bdbb`. Ichnotaxon, record and
interval category colours remain data-specific. The text, subtitle and background colours of the core-column style also
apply to the sections figure, the trace gallery and the title and caption added around any exported figure. The
multiproxy map (`MAP_STYLE`) and the location map (`LOCMAP_DEFAULTS`) have their own text (`#1c2422`), subtitle
(`#5b6763`), background (`#ffffff`), land, sea and point colours. Presentation, no-data (`ndColor`, `ndLine`), marker
stroke, class, record, interval-band and map colours read from a project are validated against 3- or 6-digit hexadecimal
notation (`^#[0-9a-f]{3}([0-9a-f]{3})?$/i`, `log.js::validHexColor, mergedStyle`) before rendering DOM controls or
exported SVGs; any other value falls back to its respective style default, and interpolated control, label and track
attributes are escaped.

Map renderers normalise numeric presentation fields with `log.js::finiteStyleNumber` before geometry or
SVG interpolation. Finite numbers and nonempty strings that convert to finite numbers retain their numeric
value, including zero; empty strings, non-finite values, booleans, objects and other types use the field's
default without object coercion. Multiproxy maps check `bgOpacity`, `size` and `labelSize`. Location maps
check `margin`, `width`, `baseOpacity`, `gridWidth`, `labelSize`, `northSize`, `pointSize` and `coreLabelSize`.
Normalisation uses a local style copy and leaves saved inputs and scientific arrays unchanged. It does not
change UI ranges, analysis settings, coordinate projections or depth/age calculations.

| Column | Content | Horizontal scale |
|--------|---------|------------------|
| Bioturbation (%) | bar per interval and stepped outline | 0–100 % fixed |
| Per ichnotaxon (%) | stacked bars per counted class, or one column per ichnotaxon with its own scale (`style.speciesMode` = `stack` / `separate`) | 0 to the maximum in the window, rounded ("nice range") |
| BI / ii | bar per interval; manual index as a black line | 0–6 |
| External record | line joining the points in depth or age order | minimum–maximum of the points in the window, rounded; can be reversed or logarithmic |
| Interval bands | one band per layer of described intervals, and the automatic classification (§18) | — |

Dashed lines mark the top of each section. NO DATA intervals (§3.2) are drawn with a configurable style (`ndShow`,
`ndFill` = `hatch` / `solid` / `none`, `ndColor` `#f2f2f0`, `ndLine` `#b9bdbb`, `ndLabel`, `ndText`, `ndImage` = also
over the images; `log.js::ND_STYLE, noDataDefs, noDataGaps, noDataRect`). The order and visibility of columns are set
with `style.colOrder` and `style.colHide` (nothing is deleted; `log.js::orderCols`). Figures inherit the column settings
until a presentation override is edited (§20.1.1). Ichnotaxa can be hidden from drawing (`style.speciesHide`). Axes,
ticks and labels are edited as described in §20.8.

### 15.6 Reading values with the cursor, column widths and pop-up help
- **Reading cursor** (core column and multiproxy curves): moving the mouse over the plot draws a line at that height;
  `a = from + (y − top)/height × (to − from)`. The value of each record at `a` (`recordAt`) is the linear interpolation
  between the nearest non-empty points above and below; "—" is shown if there is no point on one side or if they are
  more than 3 × the median spacing of the record apart (`medianGap`). Bands show the class of the range containing
  `a`. In the core column the readout also gives the bioturbation %, BI, ii and the 4 ichnotaxa with the highest
  percentage; in Multiproxy, the nearest resampled sample (if `|x − a| ≤ step`) with its described or rule label and
  its predicted class and probability.
- **Column names:** `wrapTitle(text, width)` splits a name into up to 2 lines of `⌊(width − 4) / 5.6⌋` characters
  (10 px font); if it does not fit, the second ends with "…". The full name appears when hovering over the header.
- **Widths:** `buildLogSVG` accepts `colWidths` (`{'rec:<name>' | 'band:<layer>' | 'total' | 'species': px}`, limits
  30–600 px) and `recWidth` (default width of variables, 120 px). They are changed by dragging the right edge of the
  header; a double click restores them. They are stored in the project (`logView.colW`, `geo.view.colW`,
  `geo.view.trackW`). The plot scrolls inside its frame (at most the window height − 170 px) in both directions.
- **Clicking on the curves** (when not marking intervals) selects in the list the interval at that height (of the
  layer of the clicked band or, otherwise, of the active layer).
- **Pop-up help:** every element with `title` or `data-tip` shows the program's own tooltip after 350 ms (also with
  the keyboard); `title` is moved to `data-tip` to avoid duplicate browser tooltips. Hover help can be turned off in
  Help.

### 15.7 Export
- **SVG:** the same SVG as on screen (vector; images embedded as JPEG).
- **CSV:** one row per interval in the window, with section, depths, age, percentages, BI, ii, manual indices and,
  for each visible external series, its value **interpolated linearly** at the centre of the interval. Interpolation
  is done on the record's own axis (depth or age) and is empty outside its range.

The core column changes no calculation: it shows the intervals of §3 on a common axis. The CSV with the records
interpolated to the same intervals allows correlations to be computed elsewhere. Linear interpolation assumes that the
external record varies smoothly between two measurements, so its resolution should be equal to or finer than the
intervals.

---

## 16. External records

When two imported tables for the same core contain ages but no depths, matching age rows retain both sets of variables. If their age axes differ, their rows are combined in age order, with missing values for variables absent from each source.
When an age-only table is combined with a depth-based table, the core's age model (or the paired ages and depths in the tables) converts the age-only rows to depth. The relation must be strictly increasing and cover every age to be converted; otherwise the import for that core is refused and its existing data are kept. Values are not extrapolated.

Implementation: `log.js::parseTable, decodeText, guessAxisColumn`, `exportio.js::recordSeries` and `app.js` (records
dialog). External records are any measured down-core series added to a core (XRF, colour, susceptibility…).

- **Formats:** CSV, TXT, TSV or DAT, and spreadsheets (`.xlsx`, `.xls`, `.ods`; first sheet) read with SheetJS
  0.20.3, bundled from `cdn.sheetjs.com/xlsx-0.20.3` with its Apache-2.0 licence (SHA-256 of the bundled file
  `cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41`; the online fallback uses the same version
  with an SRI SHA-384 check). This version fixes CVE-2023-30533 and CVE-2024-22363.
- **Text encoding:** UTF-8 and, if the file is not valid UTF-8 (CSV files saved by Excel on Windows), Windows-1252.
- **Reading** (`parseTable`):
  - the separator is detected among tab, semicolon, comma or vertical bar: the first one that splits the first line
    and all but one of the other first 6 lines; otherwise spaces;
  - fields in double quotes may contain the separator and `""`;
  - decimal comma if the separator is not the comma and a cell like `1,5` or `1.234,5` appears, and none like
    `1,234.5`;
  - thousands separators: `1.234,5` with decimal comma, `1,234.5` without it, and `1 234,5`;
  - header if the first row contains any non-numeric text;
  - lines starting with `#` are ignored;
  - non-numeric cells are treated as empty; they are counted (`dropped`, in mostly numeric columns) together with
    rows shorter than the header (`short`), and the user is warned on import.
- **Axis column:** the first header that looks like depth (depth, prof, mbsf, CSF, CCSF, mcd, m, cm) is proposed or,
  if none, age (age, edad, ka, Ma, yr, cal). The user can change it and say whether it is depth or age.
- **Series:** each chosen column is a series of (axis, value) pairs without empty values, sorted by axis. Each series
  has a colour, visibility and an option to reverse its axis.
- **Units:** a depth column must be in the same units as the core and an age column in the units of the age model.
  External records are not converted.

---

## 17. Data tab

Implementation: `sheet.js::parseFormula, evalColumn, evalCells, fillLinear`, `plot.js` and `app.js`.

### 17.1 The data of a core
All the data of a core are joined into one table, sorted by depth (`refreshCoreData`): (1) the bioturbation of the
images per interval (%, BI, ii, % per ichnotaxon; in the units of the core), (2) external records (those in age are
converted to depth with the inverted age model), (3) imported data and (4) manual columns; then computed columns are
applied. Each row carries the depth of its value; the age is that of the imported data if present, otherwise that
of the age model. A core without any depth (age only) is stored by age only. Each column remembers its origin (`src`:
imported, record, from images, manual, computed), which the Data tab shows as a coloured tag.

### 17.2 Table and editing
The table shows the active core or all cores: depth, age, columns ordered by origin and, if asked, the category of
each interval layer at that row; it exports to CSV. Manual columns (`core.user`) are edited directly. With **Allow
editing values**, any value that is not in a computed column can be changed; the change is stored apart from the
original in `core.edits[column][depth] = {v, o, at}` (new value, original value, date), applied to the combined data
before computed columns (`applyCellEdits`), marked in the table and listed in the CSV header (`# edited by hand: …`).

`datatab.js::tableModel(limit)` prepares numeric row values and interval labels only for the displayed prefix,
initially 400 rows across the selected cores. **Show more** raises the limit by 1,000. The total count still
includes all selected rows, and columns are collected from all selected cores, including those beyond the
display limit. CSV calls the same model without a limit and exports every row. The native HTML table remains
in use, preserving text selection and the existing editing handlers. Repeated expansion still grows the DOM.
The [Data table benchmark](benchmarks/M2.1.md) records the measured improvement, exact CSV checks and limits.

For each core/layer, `geo.js::createIntervalLookup` indexes the axis-converted intervals once per model call.
Finite, nonempty, nonoverlapping intervals are searched by binary search on a sorted copy; source arrays and
interval objects are preserved. Matches use `from <= x < to`, including touching endpoints and gaps. Overlapping
or irregular bounds use the original linear first-match predicate; nonfinite or nonnumeric query values also
retain its coercion behaviour. Interval category names are resolved once for that model call, including generated
groups and validation categories, and rebuilt with each render/export. The same lookup serves the displayed
prefix and full CSV. [Cumulative expansion and CSV measurements](benchmarks/M2.1.2.md) describe the validation
and the remaining cost of the growing DOM.

The session-only **Visible rows only (experimental)** checkbox enables a separate rendering path; the native
table remains the default. The initial 400-row limit and 1,000-row **Show more** increment still determine how
many rows are available to scroll. `tableModel(limit, offset)` prepares the requested range across core
boundaries, retaining the same column/layer discovery and interval matching. Full CSV export calls it without
a limit or offset and therefore includes every selected source row.

`tableview.js::mountTableViewport` uses fixed 28 px rows, fixed column widths and top/bottom spacer rows. It
renders the visible range plus 12 rows of overscan on each side, scheduled through one animation-frame callback
for scroll/resize/selection changes. Existing row nodes are retained where the old and new windows overlap.
Native text selections retain their contiguous selected range and the viewport between them, which can exceed
the usual window budget; clearing the selection releases those rows. A selection intersecting the table with
an endpoint outside its data rows retains the whole available prefix. This preserves selection at the cost of
rendering more rows. Long cell text can be clipped by the experiment's fixed widths; the underlying text and
CSV remain complete.

An edited cell is blurred and committed through the existing edit handler before leaving the retained range.
Enter and vertical arrows move within the available rows. Tab/Shift+Tab cross editable columns and row/core
boundaries, skipping calculated columns; PageUp/PageDown move by the window height; Ctrl/Cmd+Home/End move to
the first/last editable cell of the available prefix. Escape restores the cell's pre-edit text. Text-selection
modifiers and horizontal arrows keep native editing behaviour. The controller cancels callbacks and removes
listeners/observers when the table is rebuilt or the Data mode is left. Disabling the checkbox restores native
rendering; the flag is neither saved in projects nor persisted between app sessions. Rich pasted markup in
editable cells is flattened to its text so that block elements cannot change the fixed row height; numeric
validation and Escape restoration use the same text as the native path.

The [viewport experiment](benchmarks/M2.1.3.md) records its interaction contract, measured acceptance criteria
and validation. Changing the default and removing the flag requires the maintainer's acceptance.

### 17.3 Computed columns
One formula per column (`sheet.js::evalColumn`), evaluated row by row over the core. Operators `+ − * / ^` and
comparisons (`< > <= >= == !=`, giving 1/0); names without spaces or in brackets (`[XRF Ba/Ti]`), `depth`, `age`.
Functions: `log10, ln, exp, sqrt, abs, round, pow, min, max` (element-wise with two columns), `mean, std` (sample
standard deviation, n − 1), `median, sum, count, zscore` ((x − mean) / sample standard deviation), `norm01`,
`movavg(x, n)` (centred mean of n rows), `diff, cumsum, if(c, a, b)`, `corr`. A missing value gives a missing
result; so does division by 0. By default (`interp`), each column used is interpolated linearly to the depth of each
row between its neighbouring values, without extrapolating (`sheet.js::fillLinear`), because each record is measured
at its own depths. Computed columns can apply to all cores or to one, are recalculated automatically and are
available as variables in Multiproxy.

### 17.4 Free sheet
`sheet.js::evalCells`: cells A1… with a number, text or a formula starting with `=`; references, ranges `A1:B5`, the
same functions and `COL("column", "core")`, which returns a column of a core (by default the active one); a cell
receiving a column shows its mean. Circular references give an error.

### 17.5 Plots
The **Plots** view of the Data tab (`plot.js`, pure) keeps a list of plots per project (`plots`, `plotCur`).
- **Stratigraphic log:** one panel per variable with a common vertical axis (depth or age, downwards unless
  reversed); several cores = one coloured line per core; each panel can be logarithmic or reversed.
- **XY:** any column (or depth/age) on X against one or several on Y; secondary Y axis; logarithmic axes (1-2-5
  ticks) or reversed; manual minimum and maximum, otherwise the data range ± 4 %.
- **Series types:** line (broken where the gap between samples exceeds 5 × the median spacing), points, line and
  points, step, area (down to 0) and bars.
- **Fits** (least squares): linear and polynomial of degree 2–6 (normal equations), exponential `y = a·e^(bx)` (on
  ln y, y > 0), power `y = a·x^b` (on ln x and ln y), logarithmic `y = a + b·ln x`, and a centred moving average of
  `w` points; `R² = 1 − SS_res / SS_tot` in the original scale. A table gives the equation, R² and n.
- **Statistics per series:** n, mean, standard deviation (n − 1), minimum, median, maximum and, in XY, Pearson's r.
- Export to SVG, PNG (×3) and CSV (core, axis, variable, value).

---

## 18. Multiproxy analysis

The **Multiproxy** mode combines **numerical records** of any kind (geochemistry, foraminifera, TOC, grain size,
colour…) and **layers of described intervals** (lithology, turbidites, events…), which can be nested inside one
another. With them it trains **automatic interval classifiers** that are applied to all cores, and draws maps by age
window. It is stored in the same project (field `geo` of the project file). Code: `app/js/geo.js` (pure, tested in
`tests/app/geo.test.mjs`) and the "multiproxy tool" block of `app/js/app.js` (interface).

### 18.1 Data input
**Numerical records:**
- **Long table:** one row per sample with a core column (`coresFromLongTable`); latitude and longitude are taken from
  the first row of the core that has them.
- **One file per core:** the file name (without extension) is the core name (`coreFromRows`).
- **Catalogue:** assigns latitude, longitude and water depth by core name, case-insensitive (`applyCatalogue`).
- Multiproxy maps and interpolation use only finite coordinates in decimal degrees, with latitude in [−90, 90] and longitude in [−180, 180].
- Formats: CSV/TXT (same reader as §16) and spreadsheets (SheetJS, first sheet).
- The user chooses which column is the core, latitude, longitude, depth, age, and which variables to import. Depth or
  age is required; non-numeric values are ignored. If the core already exists, new variables are added to it.

**Described intervals** (`intervalsFromTable`): one row per interval with top and base (in depth or age, in the
units of the core's records) and:
- **wide format:** each marked text column is a layer (for example `Lithology`, `Turbidite`) and the text of the row
  is the category; empty cells create no interval;
- **long format:** one column gives the layer and another the category.

The core comes from a column, from the file name or from the user's choice. Missing layers, categories and cores are
created (case-insensitive matching). An interval identical to an existing one (same core, layer, axis, category, top
and base) is not duplicated. Rows of each core are sorted by depth (or by age if there is no depth).

**The image core** (`mainCoreFromImages`): the cores with images enter the multiproxy analysis like any other core.
Their variables are, per interval of the core column (§15), the bioturbation percentage, BI, ii, the percentage of
each counted ichnotaxon and the external records interpolated linearly to the interval's depth (or age); their age
comes from the age model. In this way the ichnological interpretation becomes data for the multiproxy analysis.

### 18.2 Samples: resampling, transformation and scaling
`buildSamples(cores, cfg)`:
1. **Axis** (`axis`): age or depth. The age of a core is its age column or, if there is none, its age model applied to
   depth (`coreAges`).
2. **Common grid** per core: from `ceil(min/step)·step` to the maximum, every `step` (1 by default).
3. **Linear resampling** (`resample`): interpolation between the two neighbouring samples; empty outside the core's
   range (no extrapolation) or if the two neighbours are farther apart than `maxGap` (by default `autoGap` =
   3 × the median spacing of the real samples of that series, also used when the interface field is blank). Exact
   observations are retained even when an adjacent gap exceeds that limit.
4. **Ratios** A/B created by the user are computed row by row on the original data (empty if the divisor is 0 or
   missing) before resampling.
5. **Logarithm**, optional per variable: `t = log10(v)` if `v > 0`; otherwise empty.
6. **Missing values** (`cfg.missing`): with `drop` (default) a sample enters only if **all** chosen variables have a
   value, so a core lacking one variable contributes no samples. With `mean`, one variable is enough; missing ones
   take the mean, that is 0 in `zc`, and in `f` with global or per-core scaling (the global mean of unscaled `t`).
   Means and standard deviations are computed without missing values (`colStats`). Rules are never met on a missing
   value. This allows cores with different variables to be combined, at the cost that the model sees a neutral value
   where there is no data.
7. **z-score within the core** (always computed; used by rules and maps):
   `zc_j = (t_j − μ_j,core) / σ_j,core`, with the population σ (divisor n; if σ = 0, 1 is used).
8. **Model variables** (`scaling`):
   - `global` (default): `f_j = (t_j − μ_j) / σ_j` with μ and σ of all samples of all cores (population σ). Keeps
     level differences between cores.
   - `core`: `f = zc`. Removes level differences between cores (useful when calibration or background lithology
     change).
   - `none`: `f = t`.
9. **Interval layers as variables:** for each layer used and each of its categories a column `"Layer: category"` is
   added, equal to 1 if the sample lies inside an interval of that category (`from ≤ x < to`, converting the interval
   to the axis if needed) and 0 otherwise. These columns come **after** the numerical ones and are **neither
   transformed nor scaled** (0/1 in `raw`, `t`, `zc` and `f`). A sample without an interval of that layer is 0 in all
   its categories (also if the core has no description of that layer). Automatic intervals (§18.3) are never used as
   variables.

### 18.3 Interval layers, hierarchy and labels

The class-name column fills the available space by default. A manual width is stored in the browser's panel
preferences and applies to every interval family. When the column exceeds the panel width, the list scrolls
horizontally.
- **Layer** ("family" in the interface): `{id, name, parent, cats:[{id, name, color}]}`. A layer "Events" with four
  categories exists by default. The user creates, renames and deletes layers and defines categories.
- **Hierarchy:** `parent` makes a layer a subdivision of another (for example Turbidite inside Lithology). Cycles are
  prevented. An interval drawn in a child layer is clipped to the parent interval where the drag starts. Child
  intervals that do not fit entirely inside a parent interval of the same core are flagged with ⚠
  (`orphanIntervals`) but kept.
- **Intervals:** `{id, core, layer, axis, from, to, cat, auto?}`. They are created by dragging on a core's column,
  by importing or by accepting a classification; they are edited in the list (category, top, base) and exported to
  CSV. Within a core, layer, axis and type (manual or automatic) intervals do not overlap, and adjacent or overlapping
  intervals of the same class are merged (`geo.js::tidyIntervals`); the interval just drawn or edited wins, and those
  it overlaps are clipped or split. This is applied to every edit, to imports and when older projects are opened
  (with a warning if anything changes).
- Converting an interval between depth and age uses the core's depth–age relationship (`coreConvert`, linear
  interpolation); an end outside the core's data range is set to the first or last value; an interval entirely
  outside is dropped. There is no extrapolation.
- **Manual classification:** each layer is a column in every core (also when empty); dragging in it creates an
  interval with the last class used in that layer; clicking edits the class or deletes it.

**Labels for training** (`labelSamples`, for each target layer):
- **Described intervals:** a sample lies in an interval if `from ≤ x < to`.
- **Rules** (associations of variables): `{layer, cat, enabled, conds:[{feature, op, value}]}`. Conditions can use
  numerical variables or the 0/1 columns of other layers; a rule is met if **all** its conditions are met. `op`: `z>`
  / `z<` compare `zc` (z-score within the core); `>` / `<` compare the original resampled value (without log).
- Priority: manual interval → first active rule that is met (if "Also use the rules" is on) → no label.
- **Automatic** intervals (`auto: true`) are never training labels.

### 18.4 Learning methods
All methods use a seeded pseudo-random generator (mulberry32, `seededRandom`; seed 42 by default): the same project
gives the same result. Default parameters in `METHODS`:

| Method | Default parameters | Description |
|--------|--------------------|-------------|
| Random Forest (`rf`, recommended) | `trees` 100, `maxDepth` 12, `minLeaf` 3, `mtry` √d, `bins` 32, `bootstrap` yes, `balanced` yes | CART trees with Gini impurity. Candidate thresholds of each variable: the quantiles `b/bins` (b = 1…bins−1) of the training data. At each node `mtry` random variables are tried. With `balanced`, each sample weighs `n / (K · n_class)`. Leaf: weighted class proportions. Probability = mean over the leaves of all trees. Importance: Gini decrease weighted by node weight, summed per variable and normalised to 1 (MDI). |
| k nearest neighbours (`knn`) | `k` 7, `weights` distance | Euclidean distance on the scaled variables. Vote `1/(d + 0.05)` (distance) or 1 (uniform), normalised. The constant 0.05 avoids near-certain votes next to almost identical resampled points. |
| Gaussian naive Bayes (`nb`) | `smoothing` 10⁻⁶, `priors` uniform | Population mean and variance per class and variable; `max(smoothing, 10⁻⁹) · max_j var_j` is added to each variance. Uniform or frequency-based prior. Log-likelihood normalised with softmax. |
| Neural network, multilayer perceptron (`mlp`) | `hidden` '16', `activation` relu, `epochs` 200, `lr` 0.01, `l2` 10⁻⁴, `batch` 32, `balanced` yes, `patience` 25 | See §18.5. |
| k-means (`kmeans`, unsupervised) | `k` 4, `restarts` 5, `maxIter` 100 | k-means++ initialisation, Lloyd iterations until assignments stop changing or `maxIter`; the restart with the lowest inertia is kept. Groups `G1…Gk`, which the user can name. |

- **Training** uses the labelled samples (intervals and rules of the target layer); k-means uses all samples. At least
  two different labels are needed (except for k-means).
- **Classification:** each sample receives the most probable class if its probability is ≥ the minimum probability
  (0.5 by default); otherwise it stays unclassified.
- **New cores:** the model is applied to all samples, including those of cores added after training. With global
  scaling, the means and standard deviations of the numerical variables **frozen at training** are used, so that
  adding cores does not change the model's scale.
- **Accepting as intervals:** contiguous samples of the same predicted class in a core become intervals of the target
  layer with `auto: true` (shown pale and in italics), replacing earlier automatic ones of that core and layer. The ✓
  button confirms them (they stop being automatic and count for training). Copying from an automatic column works the
  same way: one range → a confirmed interval; the whole column → `auto: true` intervals pending review.
- The trained model is not stored in the project file (only the classifier definition and the date). When the
  project is opened it is retrained with the same seed, so the result is the same if the data have not changed.

### 18.5 Neural network (multilayer perceptron)
`mlpFit` / `mlpProba` in `geo.js`:
- **Inputs** standardised inside the model with the mean and population standard deviation of each column of the
  training set (standard deviation 0 → 1).
- **Architecture:** d inputs → hidden layers (`hidden`, for example "32,16") → K outputs with softmax. ReLU
  (max(0, z)) or tanh in the hidden layers.
- **Initialisation:** weights ~ N(0, σ²) with σ = √(2/a) (He, ReLU) or √(1/a) (Xavier, tanh and output layer), a =
  neurons of the previous layer; biases 0. Normal values by Box–Muller with the seeded generator.
- **Loss:** cross-entropy −w_c · ln p_c per sample, with w_c = n / (K · n_c) if `balanced` (otherwise 1), plus an L2
  penalty (`l2` · W) in the gradient of the weights (not the biases).
- **Optimisation:** Adam on mini-batches (`batch`), β1 = 0.9, β2 = 0.999, ε = 10⁻⁸, learning rate `lr`; the order is
  shuffled every epoch with the seeded generator.
- **Early stopping:** if n ≥ 40, 15 % of the samples of each class (classes with ≥ 4) are held out for validation;
  after each epoch their mean loss is computed and the weights with the lowest loss are kept; training stops after
  `patience` epochs without improvement or at `epochs`.
- Deterministic for a given seed and class order.

### 18.6 User-defined classifiers
- `geo.classifiers = [{id, name, targets: [layers], features: null | [variables], layers: null | [input layers],
  method, params: {method: {…}}, minProb, seed, useRules, trained}]`. `features` null = all variables; `layers` null =
  all other layers with described intervals. Target layers are never inputs, and neither are their ancestors or
  descendants (`relatedLayers`), because that would leak the answer into the input.
- Samples are built once with all variables and one 0/1 column per category of **every** layer with described
  intervals (`featLayers`); each classifier uses its own subset of columns (`clfCols`).
- **Training** (`trainClassifier`): one model per target layer, with the labels of that layer (described intervals and,
  if `useRules`, rules), and its cross-validation (§18.8). At least 2 classes are needed (except for k-means).
- **Prediction** (`predictRun`): the model stores the names of its columns (`colNames`) and, with global scaling, the
  means and standard deviations of its numerical variables at training; at prediction time columns are looked up by
  name, so adding variables, layers or cores does not invalidate the model. If a column is missing, or the axis or the
  scaling change, the automatic column is hidden until the classifier is retrained.
- **Automatic columns:** one per classifier and target layer, next to the layer's column, with the predicted class of
  each sample; opacity = 0.3 + 0.7 · probability.

### 18.7 Training progress
Training advances in steps: for each classifier and layer, 1 model fit + 1 step per cross-validation fold
(`crossValidateSteps`, a generator that yields before each fold); the neural network also yields after each epoch
(`fitModelSteps` / `mlpFitSteps`). Progress = (finished steps + fraction of epochs of the current step) / total
steps; remaining time ≈ elapsed / progress × (1 − progress), shown after 1.5 s. The page regains control at least
every 60 ms. "Cancel" stops training and keeps the previous models of the interrupted classifier.

### 18.8 Cross-validation
`crossValidate`:
- With labelled samples in **two or more cores: leave one core out** (each core is predicted by a model trained
  without it).
- With a single core: **5 contiguous blocks** along the axis; training samples closer than `gap` to the test block
  are removed (5 % of the labelled range by default; `cv.gap`).
- With global scaling, numerical columns are standardised in each fold with the training mean and standard deviation
  (`opt.rescale`), so that the test core does not influence the scale. With per-core scaling each core uses its own
  statistics (which use no labels).
- Both schemes limit the presence of neighbouring (autocorrelated) samples in both training and test, which would
  inflate accuracy; with a single core, autocorrelation reaching farther than the gap may still inflate it.
- Reported: confusion matrix, accuracy, **balanced accuracy** (mean recall over classes, not fooled by a majority
  class such as the background), precision, recall and F1 per class, balanced accuracy per left-out core (mean ±
  standard deviation) and, with the minimum probability in use, the coverage (fraction classified) and its accuracy.
  Validation uses minimum probability 0.
- **Only samples labelled by described intervals are scored.** Labels from rules (z thresholds on the same
  variables) are used for training but not for evaluation; otherwise the evaluation would be circular.

### 18.9 Testing the classification on one core
`geoTestCore` ("Test automatic classification on this core"), with the chosen method and parameters (k-means is
replaced by Random Forest):
- if the labelled samples of **other cores** cover at least two classes, the model is trained with them and predicts
  the current core;
- otherwise the core is divided into **5 contiguous blocks** along the axis and each block is predicted by a model
  trained without that block's labels.

Bands "Test" and "Match" are shown (green where the prediction matches the label, red where it does not) with the
percentage of agreement on the labelled samples of the core. It is a visual check of the cross-validation on one
particular core; it does not change the trained model. **Colour records by class** (`geo.view.shadeBy`: layer ids or
`target`; `shadeMode` = `mix`, colours overlaid with opacity 0.34/n, or `split`, one stripe per layer) fills the
background of each record column with the class of the test if there is one, otherwise of the classification,
otherwise of the labels.

### 18.10 Reserved cores and the final test
Choosing a model by looking at its cross-validation makes that cross-validation optimistic. For an unbiased estimate,
cores can be **reserved** for a final test (`core.holdout`, stored in the project):

- **Ichnotaxa:** traces of reserved cores never enter any set of examples. While any core is reserved, a library or
  other-project example is excluded if it may come from a reserved core: its key has the identifier of a reserved core
  (copies of a project keep core identifiers), its source core has the same name (case-insensitive), or its descriptor
  vector, rounded to 3 decimals, equals that of a trace of a reserved core (catches copies of unknown origin, such as
  older imported models). The number of excluded examples is shown with the reserved cores.
  Exported new model examples retain their source keys; old models remain importable.
- **Multiproxy:** reserved samples are excluded from fitting, including k-means. Global scaling and missing-value
  imputation are fitted on training samples and reused for prediction; cross-validation fits them per fold. Per-core
  scaling uses each core's own distribution and is therefore transductive. The labels of reserved intervals are hidden
  for training and cross-validation (`labels`); the full
  labels are kept apart (`all`). Each training run records the reservation it was made with (`run.held`); if it
  changes later, the final test asks for retraining.
- **Final test** (button in *Models and training* → Train, and in Multiproxy → Classifiers, with confirmation): for
  ichnotaxa, the model in use (refitted at that moment) predicts the identified traces of the reserved cores; for
  multiproxy, the trained classifier predicts their described intervals (not those labelled by rules). Metrics
  (`learn.js::finalTestMetrics`): accuracy = correct / total (no prediction counts as a failure), balanced accuracy =
  mean recall of each true class, and confusion matrix.
- Each test is logged in `S.finalTests` (date, version, target, method, scope or classifier, cores, number of
  training examples, metrics) with its repetition number. Repetitions are flagged, because a test stops being
  independent if the model was changed after seeing the previous result.

### 18.11 Overlay with the core column and export
- In Multiproxy, the column of each core shows its numerical variables and one band per interval layer in
  hierarchical order (children marked "↳"); in the target layer the samples labelled by rules are added in a pale
  shade. At the end comes the **automatic classification** band (prediction).
- If the cores with images are included, the core column (§15) adds their interval and classification bands next to
  the image and the bioturbation, in depth or age.
- Classification export (`*_clasificacion_intervalos.csv`): core, axis, depth, age, variables, label, origin of the
  label, predicted class and probability.
- Interval export (`*_intervalos.csv`): core, layer, parent layer, category, axis, top, base, automatic, and outside
  the parent layer. It can be imported again.

### 18.12 Synthetic demonstration data
`tools/make_geochem_demo.py` (seed 397) generates 15 **fictitious** cores in the Mediterranean (0–150 ka every 0.5 ka,
4,515 samples) with known events (column `event_true`): low oxygenation at 6–10, 79–86, 100–105 and 122–128 ka only
east of ~11° E (high Ba/Al and TOC, low Mn/Al, stronger eastwards); detrital input at 14–29, 57–71 and 130–150 ka (high
Ti/Al, low Ca); current pulses west of 10° E (high Zr/Rb). Multiplicative AR(1) noise. In addition, `intervals.csv`
(separate random generator, seed 398, so that the numerical records do not change): a layer **Litologia** ("Arcilla
limosa" in the detrital windows with limits shifted by ±1 ka; "Marga nanofosilifera" elsewhere) and a layer
**Turbidita**, with 0 to 3 thin beds (0.3–1.2 ka) per core, always inside the silty clay (subdivision). Files:
`examples/geochem_demo/` in the repository (long table, catalogue, one file per core and intervals in depth). They
are not included in the downloads.

The "Demo data (synthetic)" button labels intervals from the synthetic truth in two cores per event (DEMO-02 and DEMO-12
detrital; DEMO-09 and DEMO-14 low oxygenation; DEMO-01 and DEMO-04 current) plus the background of those cores,
imports `intervals.csv` (Turbidita as a subdivision of Litologia), adds an example rule (Ba/Al z > 1.5 and Mn/Al
z < −0.5 → low oxygenation) and trains a Random Forest with target layer "Events" and 9 variables (6 numerical and 3
from layers).

With these data the classifier reaches 98.4 % accuracy and 96.7 % balanced accuracy, leaving one core out, on 1,730
labelled samples. This **only shows that the implementation works**: the synthetic events are well separated and do
not represent the difficulty of real data. Its validity for interpreting real events has to be measured on cores with
an independent, published interpretation, leaving whole cores out. Three further cautions apply to real data:
labels from rules make the model relearn the rules, so their accuracy measures consistency, not truth; MDI importance
distributes merit unevenly among correlated proxies (for example Ba/Al and TOC), so permutation importance is
preferable for interpretation; and a described layer that is built very close to the target (as the demo lithology is
to "detrital input") can make the model depend on the description rather than on the records.

---

## 19. Maps of the multiproxy analysis

Implementation: `geo.js::mapSummary, buildMapSVG`, `interp.js` and `app.js`.

### 19.1 What a map shows
- **Age window** `[a0, a1)` (6–10 ka by default); the ◀ ▶ buttons shift it by its own width.
- **Dominant class** (`mapSummary`, mode `class`): per core, the fraction of samples of each predicted class (or of
  the labels if there is no model) in the window; the point takes the colour of the dominant class and its radius is
  `5 + 5 · fraction` px.
- **Value of a proxy** (mode `value`): mean `zc` of the variable in the window, using **only samples with a real
  value** of that variable (not the values filled with the mean); optionally minus its mean in a reference window
  (anomaly). A core without real data in the window is drawn as "no data".
- **Cores on the map:** a list with a checkbox per core; unticked cores are neither drawn nor interpolated
  (`geo.map.off`).
- Each core carries a tooltip (name, project, dominant class with % or value, number of samples and coordinates).
- Coastline: Natural Earth 1:50 m (public domain), 1,223 rings in `examples/data/land-50m.json` — the only data file
  included in the downloads.
- Export to SVG, PNG and CSV (`core, lat, lon, n_samples, dominant_class, fraction, value`).

### 19.2 Style
- **Style** (`MAP_STYLE`, defaults): `bg='vector'`, `bgOpacity=1`, `coast=true`, `symbol='circle'`, `size=1`,
  `sizeByFraction=true`, `labels=true`, `labelSize=11`, `labelColor='#1c2422'`, `halo=true`, `labelValue=true`,
  `pointColor='#ffffff'`, `stroke='#1c2422'`, `land='#e6e6dc'`, `sea='#f4f8f9'`, `graticule=true`, `scaleBar=true`,
  `north=false`. Stored in `geo.map.style`.
- **Symbol radius:** class mode `r = (sizeByFraction ? 5 + 5·fraction : 7) · size`; value mode `6 · size`; no data
  `4 · size`. Symbols: circle, square (side 1.78 r), triangle, diamond, star (10 vertices, inner radius 0.45), hexagon
  and cross.
- **Scale bar:** km per pixel = `Δlon · 111.32 · cos(central lat) / 900`; the largest value 1, 2 or 5 × 10ⁿ km that
  fits in 160 px, measured at the centre of the map.

### 19.3 Background images and privacy
- **Backgrounds** (`MAP_BG`): one image per map requested in EPSG:4326 for the exact extent, with square pixels in
  degrees (width 1,600 px, height `1600·Δlat/Δlon`, at most 3,000) stretched over the map area; since the map is
  equirectangular with longitude scaled by a constant, the match is exact. Services: Esri ArcGIS `MapServer/export`
  (World_Physical_Map, World_Shaded_Relief, World_Topo_Map, Ocean/World_Ocean_Base, World_Imagery) and GEBCO WMS
  1.1.1 (layer `GEBCO_LATEST`). "Aerial photo + bathymetry" = GEBCO underneath and World_Imagery clipped with the
  Natural Earth land polygons. With an image background the vector land is drawn only as a coastline and the
  interpolation with opacity 0.55. Images are stored as data URLs, so the exported SVG is self-contained. If a
  download fails the plain map is drawn.
- **Privacy:** the default background is the vector one (no network). Before the first download of a background the
  program asks for permission, warning that the map extent (the study area) is sent to Esri or GEBCO; the answer is
  remembered (`localStorage ichantool.mapNet`). Core data never leave the computer.

### 19.4 Zoom and frames
- **Zoom** (`zoomBBox(bbox, f, lon, lat, dlon, dlat)`): `x0' = lon − (lon − x0)/f + dlon`, likewise for `x1`, `y0`,
  `y1`; maximum width 360°, latitudes limited to ±85°. Mouse wheel: f = 1.2 per step; double click: f = 2; buttons:
  f = 1.5. Dragging: `dlon = −dx/(k·900)·Δlon`, `dlat = dy/(k·H)·Δlat`, with `k` the screen scale of the SVG.
- The chosen extent is stored in `geo.map.view` (`null` = fitted to the cores with a 3° margin plus 3° more to the
  east for labels).
- **Map frames:** `--fw` (width, at least 320 px) and `--fh` (height, at least 240 px), stored in
  `localStorage['ichantool.mapFrames']`. With a fixed height, the height/width ratio of the map area is
  `r = (fh / s − 44 − 110) / 900`, with `s` = frame width / 900 (at least 0.2); the extent is enlarged with
  `fitBBoxAspect(bbox, r, projection)`: up to 12 iterations that widen latitude (if the map is wider than asked) or
  longitude (if taller), around the centre, stopping when `|ln(H/W ÷ r)| < 0.01` or when it stops improving. The
  extent is never cut.
- **Size:** the map takes the full width; "⤢" hides the side panel and "⛶" makes it full screen. PNG export from
  1,800 to 7,200 px wide; the raster background is downloaded again at that width (at most 4,096 px, a limit of the
  services) before rasterising.

### 19.5 Interpolation
Module `interp.js` (pure). Distances are in **km** on a Lambert azimuthal equal-area projection centred on the map
(`makeProjection('laea')` × 6371 km). Cores less than 10 m apart are averaged before interpolating (this avoids
singular systems). The grid has `res` cells across (90 by default, 10–400) and `ny = res · H / W` rows; each cell takes
the value interpolated at its centre. Interpolation is offered only in value mode and with ≥ 3 cores with data.

- **Inverse distance:** `v = Σ wᵢvᵢ / Σ wᵢ`, `wᵢ = 1/dᵢ^p` (p = 2); optional search radius and maximum number of cores
  (the nearest).
- **Nearest neighbour:** the value of the closest core (within the radius, if given).
- **Linear triangulation:** Delaunay (Bowyer–Watson) and barycentric interpolation; empty outside the triangles.
- **Minimum curvature:** thin-plate spline `φ(r) = r² ln r` with a linear term `a + b·x + c·y` — the minimum-bending
  surface through the data, the same criterion as Surfer's minimum curvature, solved exactly instead of iteratively;
  the "smoothing" λ is added to the diagonal.
- **Radial basis functions:** multiquadric `√(r² + c²)`, Gaussian `exp(−(r/c)²)` or thin plate; `c` = shape (200 km by
  default); same system `[Φ + λI, P; Pᵀ, 0]`.
- **Ordinary kriging:** system `[Γ, 1; 1ᵀ, 0]` with `Γᵢⱼ = γ(dᵢⱼ)`. The weights of each cell would be
  `λ = A⁻¹·[γ(dᵢ), 1]` and the estimate `λᵀv`; since A is symmetric, the program solves once `A·u = [v; 0]` and computes
  `ẑ = Σ uᵢγ(dᵢ) + uₙ` (the same value, O(n) per cell). Variograms: spherical, exponential (`1 − e^(−3h/a)`), Gaussian
  (`1 − e^(−3(h/a)²)`) and linear, with nugget and sill. Automatic fit: empirical semivariogram in 8 distance classes
  up to half the maximum distance; sill = variance of the values; range (30 values up to the maximum distance) and
  nugget (0–50 % of the sill) by least squares weighted by `n_h / h²` (gstat's `fit.method = 7`, Pebesma, 2004;
  Cressie, 1985, proposed `n_h / γ(h)²`). Manual range 500 km by default. With fewer than 15 cores the program warns that
  the variogram is unreliable. The minimum pivot of the Gaussian elimination is relative: `10⁻¹² · max|A|`.
- **Moving average:** the mean of the cores within the radius (500 km if not given).
- If a system cannot be solved, inverse distance is used and the user is warned.
- **Options:** only inside the convex hull of the cores (default), fill sea and land, sea only (default) or land only
  (cell centre inside or outside the Natural Earth polygons), opacity, and contour lines by marching squares at `n`
  "round" levels between the minimum and maximum of the colour scale, with labels. The defaults (hull and sea only)
  avoid extrapolating.

**Cover visible sea (IDW)** explicitly enables inverse-distance interpolation with no search-radius cut-off,
disables the convex-hull restriction and selects the sea-only mask. It preserves power, maximum core count,
grid resolution and colour/presentation options. The preset is shared by project and across-project maps;
project settings are saved with the project and across-project settings in `ichantool.allInterp`. Existing
projects and defaults remain restricted unless the preset is activated. The coastline must load before the
preset is applied; otherwise the previous settings are retained and the panel shows a retry message.
The visible map extent determines coverage, not a geological basin polygon. The Natural Earth cell-centre
mask excludes land; coastal cell edges can cross the shoreline at coarse grid resolutions. Rechecking the
convex-hull option restores the spatial restriction. Linear triangulation remains empty outside its triangles.

Maps computed without the hull restriction, except linear triangulation, include an extrapolation note below
the map in the view and SVG/PNG exports. A separate line preserves any basemap attribution.
Regression checks require exact equality of previously computed interior IDW cells at a fixed extent and
resolution, finite estimates throughout the enlarged grid, constant-field preservation and exact unchanged
unmasked values after applying the land mask. Browser regressions verify both map panels, saved settings,
restored hull restriction, SVG/PNG exports and unchanged core measurements and analysis state.

Interpolated maps are exploratory: with few, irregularly spaced cores the surface between them reflects the method
more than the data. Outside the core perimeter the values are extrapolated and are less constrained by observations.

### 19.6 Colour and projections
- **Colour:** 8 scales (soft diverging, blue–red, viridis, magma, terrain, ocean, greys, rainbow), reversible; range
  −2…2 (z), minimum–maximum, symmetric ±max or manual; continuous or in `n` classes. A colour bar is drawn under the
  map, and the points of value mode use the same scale. Without interpolation, value mode uses a diverging
  blue–beige–red scale saturated at ±2.
- **Projections:** equirectangular with scale cos φ₀ (default), Mercator (`y = ln tan(π/4 + φ/2)`) and Lambert
  azimuthal equal-area centred on the map. The frame is computed by sampling the edges of the extent; the graticule is
  drawn as curves; cells are rectangles (equirectangular, Mercator) or projected quadrilaterals. Raster backgrounds are
  only used in equirectangular (EPSG:4326) and Mercator (EPSG:3857; for GEBCO the extent is given in metres,
  R = 6,378,137 m); in Lambert the vector map is drawn.

---

# Part V — The program: figures

## 20. Figures

The **Figures** mode prepares publication figures from the active core or project. All figures have an optional title
and caption and are exported as SVG (images embedded) and PNG (×2); the location map also exports JPEG.

**Saved figures (tabs).** The project keeps a list of figures, shown as tabs above the figure (project fields `figTabs`,
`[{ id, name, fig }]`, and `figTab`, the active one; `fig` repeats the active figure for files read by older versions).
Each tab holds the complete setting of one figure — type, title, caption, orientation per type, window, columns and
series — so versions of the same type with different series can be kept. A new tab is a copy of the current figure; an
empty name shows the figure type. Core/log figures can inherit the current view or store independent presentation
settings per type and tab (§20.1.1). The multiproxy map follows its analysis view.

### 20.1 Common options
- **Depth window** (core units; empty = the whole core) for every figure; in age it is converted with the age model.
- **Keep the photo proportions:** height = width · L / A (L = length of the window in cm, A = median width in cm of the analysis
  areas of the sections in the window); at most 6,000 px for the column and 4,000 px for section panels (beyond that,
  the width is reduced).
- Hiding ichnotaxa (👁 button) only changes what is shown on the working image.
- **Orientation** (`fig.orient`: `v` or `h`), see §20.9; **excluded zones** can be hidden in every figure that shows
  core images (§20.9).

#### 20.1.1 Independent figure presentation

`figview.js::figureViewOf` reads presentation without adding saved state. `editFigureView` snapshots inherited
settings on the first edit into `fig.views[type]` for `core`, `log`, `range` and `sections`. Multiproxy compositions
retain `fig.geoView`. Missing overrides continue to read the current core-column/Multiproxy presentation and
legacy figure fields (`tracks`, `recs`, `rangeAxis`, `secFrom`, `secTo`, `corePanels`, `coreHideExcl`, `keepRatio`).
Saved profiles are ordinary project data and survive figure-tab duplication and project save/reload.

Core and column figures expose independent tracks, external-record selection, widths, scales, colours,
visibility/order, and depth/age axes. Distribution and section figures have independent style and depth
windows. `depthFrom`/`depthTo` remain in the section base depth units; core/range windows are converted to age
with the age model. Column and multiproxy `from`/`to` use the selected axis; changing that axis clears both
limits. Heights are bounded to 200–6000 px in column/multiproxy controls. Photo-proportion choices are per type.
Reset removes only the current type's presentation and taxon override; legacy figure fields and other types/tabs
are retained. Core selection, title/caption and the existing size-specific controls are separate from this reset.

`columns.js::buildColumnLog` builds the column SVG from an explicit view; `renderLog` adds the analysis-view DOM
and interaction. Figure rendering does not activate the analysis view or replace its state. Existing column
label edits are applied to inherited column figures and copied into their profile. Scientific measurements and
tabular exports are unaffected by presentation changes.

Column and multiproxy image controls store image mode, panels, overlay, hidden exclusions, fixed width/aspect,
stretch and opacity in the profile. Plain image overlay opacity retains its 0.35 minimum; alpha panels accept
0–1. Whole-core image panels and exclusions likewise use that figure's profile. On an age axis, figure image
panels resample each displayed row at `depth = interpAge(invertModel(model), age)`; trace arrows and occurrence
names/symbols use the forward age mapping. The inherited image path stays available for existing projects;
independent age panels are enabled by editing a presentation override. Section comparison panels keep a depth
axis. Class colours and interpretation settings still belong to the project, and arrow annotation controls
retain their existing figure settings.

Unit checks verify unchanged legacy reads, nested-state isolation, per-type/tab copying, saved overrides and
exact interval conversion. Browser checks verify unchanged analysis state and measurement arrays, inherited
label edits, nonlinear age image pixels and manual occurrences, type/tab isolation, saved profiles, reset and
SVG/PNG export in the served and standalone applications.

### 20.2 Representative traces
For each ichnotaxon of the active core the user ticks which traces to use (thumbnails) or asks for an automatic choice
of N per ichnotaxon: the largest; the "most typical" (smallest Euclidean distance, in descriptors standardised by the
class standard deviation, to the class median, §11); or spread in depth (N traces evenly spaced in depth order). Each
example is a crop of the bounding rectangle with a 15 % margin, scaled to a fixed size, with an optional outline in
the class colour, a scale bar (0.05–10 cm, the largest that fits in 45 % of the box) and section and depth. Several
versions of each trace can be shown side by side (treated, original, trace only, silhouette, outline…).

### 20.3 Whole interpreted core
The core column from top to bottom with image, traces, chosen tracks, records and the core's interval and
classification bands. In identification mode it shows the marks and the "Identified ichnotaxa" column (§14).

#### 20.3.1 Ichnotaxon presentation

**Ichnotaxa in the charts** controls the whole interpreted core, core column and ichnotaxa distribution through
shared DOM-free rendering in `log.js`. Options are stored per figure type in `fig.taxaStyles[type]`, within
each figure tab, and per core column in `logView.style.taxa`. Without a whole-core override the figure inherits
the core-column presentation. Distribution has its own settings; without an override it reads `rangeDisplay`
and `rangeSrc`. Existing projects retain their original rendering until presentation settings are changed.
**Reset presentation** removes the override and restores that inherited/default representation.

- **Layout:** one column per ichnotaxon, overlays sharing an axis, or stacked abundances. Bars, curves and
  filled areas can be stacked; symmetric curves and presence/label-only tracks use separate or overlaid columns.
  Selecting a symmetric curve or hiding abundance while stacked switches to separate columns.
- **Abundance:** bars per measured interval, linear curves through interval centres with endpoint values
  extended to the interval bounds, filled areas, symmetric curves, or no abundance shape. A line/area is split
  at missing measurements or a gap between intervals (`|next.a0 - previous.a1| > 1e-9` in the current axis units,
  matching the existing continuity comparison). Zero is a measured value; missing values do not become zero.
- **Symmetric curves:** for every continuous measured run, draw points at
  `(centre ± |sx(p) - sx(base)|/2, interval centre)` and close the shape at the central axis at the run's top and
  bottom. The half-width is clipped to half the track width. On a linear 0–100% axis it is `width × p / 200`.
  These are mirrored measured percentages, without density estimation or new abundance calculations.
- **Scales:** automatic maxima use the visible measurements (summed for stacks, otherwise individual values),
  with the existing rounded range and a minimum automatic maximum of 1%. In separate columns each taxon has
  its own range. Automatic mode honours custom horizontal bounds, reverse, log, step, divisions and decimals.
  **0–100%** fixes a linear 0–100% range, overriding inherited bounds/log settings while retaining reversal and
  tick formatting. Axis labels include `%`; mirrored axes place the baseline in the centre and magnitudes on
  both sides. Stacks can exceed 100% when the underlying overlapping-taxon percentages do; choosing a fixed
  axis clips the drawing and leaves all measurements intact.
- **Opacity:** 0–100% applies to the abundance fill/curve; 100% is opaque. Presence symbols, names and numeric
  percentage labels retain full opacity. Percentage labels can accompany symbols with no abundance shape;
  they appear at measured interval centres when the interval occupies at least 10 px vertically.
- **Occurrences:** symbols, names, both, or none, sourced from classified traces, hand-placed marks, or both.
  `app.js::compositeTaxonPoints` uses the existing effective class and object centroid or the recorded mark
  coordinates, with the same section-depth/age mapping. Names-only plus manual-marks-only places the taxon's
  name at each recorded manual presence. Equal-depth duplicates of the same taxon/source are suppressed.
  Endpoint names stay inside the clipping rectangle; the point itself retains its exact depth/age. Closely
  spaced names can overlap: use a taller figure or a narrower window. Mark-only taxa can be displayed, but
  a presence record never creates or increases a percentage. The interval-based identification list is omitted
  when the explicit occurrence track is shown, avoiding duplicate listings.

Taxon visibility is stored in the presentation override, independently per figure tab. A new override inherits
existing taxon visibility and can then show/hide those taxa without changing the measurements. SVG and PNG use
the same drawing and saved options; orientation, colours, symbols, window and track-width controls remain
available. Long names may require wider columns. No analysis definitions or tabular-export values change.

Regression checks cover unchanged measurement arrays/CSV, exact percentage widths and stacking, mirrored
geometry, missing/gapped/single-interval runs, source filtering, marker-only taxa, escaping and bounded settings.
Mirrored coordinates permit 0.01 px solely for the renderer's two-decimal coordinate rounding; scientific values
use exact equality. Browser checks exercise per-tab/per-type choices, depth/age conversion, save/reload and
decoded SVG/PNG exports, both when served and in the standalone HTML.

### 20.4 Core sections
The same depth range `[from, to)` in several versions side by side: original, treated, coloured traces (opaque),
traces with transparency (chosen opacity), outlines, traces only in colour on white, traces in black, and arrows with
abbreviations (at the centroid of each classified trace with area ≥ a minimum, and at the marks). Each section is
drawn in the requested style reduced to ≤ 900 px wide and resampled row by row (resolution ×2 of the panel); panels
carry letters (a, b, c…), a depth axis, a note of the range and a legend with abbreviations. Excluded zones can be
hidden. Arrows (`fig.arrowSrc` = all / hand marks only / traces only, `arrowExcl` excluded groups, `objScale` size of
those of each trace, `markScale`, `markStroke(W)`, `labelSize`, `labelColor`, `labelHalo`) are shared by the sections
figure and the core column.

### 20.5 Ichnotaxa distribution
`log.js::buildRangeSVG`. One column per ichnotaxon present in the window by default, with an optional
bioturbation (%) column. The shared [presentation controls](#2031-ichnotaxon-presentation) add overlays, stacks,
names, opacity and percentage labels. Without a presentation override, the stored settings below apply:
- **Source of presence** (`fig.rangeSrc` = `all` / `objects` / `marks`): a symbol for each identified trace (object
  centroid, with its effective class) and for each mark placed by hand, at its depth or age (`app.js::compositeTaxonPoints`);
  `fig.rangeHollow` draws hollow marks; `fig.rangeAxis` gives the figure its own axis (depth or age, independent of
  the core column).
- **Display** (`fig.rangeDisplay`): `symbols` (default; one symbol per identified trace or manual mark at its
  depth/age; the pure builder also accepts interval-centred presence when no point list is supplied), `bars` (width
  proportional to the ichnotaxon's percentage in each interval divided by its maximum in the window; keeps relative
  abundance), `both`, `kite` and `kiteSymbols`.
- **Symmetric curves** (`kite`, `kiteSymbols`): the abundance of each ichnotaxon is drawn as two curves symmetric about
  the axis of its column. For each continuous run of intervals with data a closed outline passes through
  `(axis ± a/2, mean depth of the interval)`, with `a = (p / pₘₐₓ) · (columnWidth − 6)` (p = % of the ichnotaxon in the
  interval, pₘₐₓ = its maximum in the window) or, with its own horizontal axis, `a = |sx(p) − sx(min)|`; it starts and
  ends on the axis at the top of the first interval and the bottom of the last. Intervals without data break the
  outline. `kiteSymbols` adds the symbols.
- The list **Ichnotaxa shown** selects the columns (it writes `style.colHide` with ids `sp:<name>`, the same list as
  the column order); column width `fig.rangeColW` (16–200 px, 30 by default). In identification mode, triangles mark
  the intervals with marks.

Changing the representation changes neither results nor stored data.

### 20.6 Core column, multiproxy column and map
The current views of those modes, with the figure options (title, caption, window, orientation).
The multiproxy log can store its own core (`geoCore`) and list of displayed variables (`geoFeatures`) in each
figure tab. Without these settings it follows the core and visible numeric records of the Multiproxy curves.
An explicit empty list omits all numeric records. The available variables have data on the current axis of the
selected core.

The multiproxy figure accepts an optional composition override in `fig.geoView`. Before the first edit it
inherits `geo.view`, its axis from Multiproxy and image settings from the core column; the first edit copies
those presentation settings. Its `tracks` select image,
bioturbation, ichnotaxa, BI, ii, manual indices, section labels and presence marks. The shared ichnotaxon
renderer uses `fig.taxaStyles.geolog` ([presentation methods](#2031-ichnotaxon-presentation)); editing that
panel also enables the ichnotaxon track. `style.colOrder` and `style.colHide` order and hide numeric records,
taxa, indices and interval/classification bands together, without changing their measurements. Hidden taxon
columns remain available in the composition list and are omitted from its legend. Explicit taxon filtering
(`taxa.hidden`) and column visibility are independent. `colW` and `style.axes` set track widths and scales;
`height` is bounded to 200–6000 px. Nullable `from`/`to` delimit the current axis window, which must increase.
The automatic window spans the numeric/interval coordinates and available section rows. Resetting composition
removes `geoView` and `taxaStyles.geolog`; the core and numeric-variable selections have separate controls.

`buildGeoLog(core, features, options)` keeps its two-argument analysis-view contract. Figure options use
`compositeData(axis, core)` to combine the selected core's sections in `core.units`, including a different
core from the one open in the image editor. Section depths are multiplied by
`UNIT_TO_CM[section.units] / UNIT_TO_CM[core.units]`; both bin limits and occurrence positions use this factor.
Age coordinates use that core's age model, without activating it or replacing global analysis settings.
The figure may select its own vertical axis and image treatment. Interval definitions and classification
remain those of Multiproxy. Classification runs are first built on the analysis axis; `geo.js::segmentsOnAxis`
converts both endpoints of each complete run with `intervalsOnAxis`, retaining labels, colours and opacity and
clamping to the core's depth–age data without extrapolation. The analysis-axis run is unchanged. No image-derived tracks are created without sections, or on an
age axis without that core's age model. Presence marks still do not imply percentage abundance.

### 20.6.1 Event shading in proxy tracks

The whole interpreted core, core-column and multiproxy-log figures share an optional `eventShade` presentation
object. It is stored in `fig.views.core`, `fig.views.log` or `fig.geoView`, respectively, independently in each
figure tab. Fields are `on`, ordered `sources`, `mode` (`mix` or `split`), `area` (`panel` or `curve`) and `styles`.
Sources use the existing band identifiers: `fam:<layer>` for described/rule intervals, `auto:<classifier>:<layer>`
for a computed classifier, `test` for an available core test and `target` for the current test, prediction or
target labels, in that order of precedence. Automatic sources require available predictions; the normal project
retraining workflow restores trained models. Unavailable sources are omitted without dropping their saved styles.

Each `styles[source]` holds an optional finite numeric `opacity`, clamped to [0, 1] (default 0.22), and a `colors`
map from class ID to `#rgb`/`#rrggbb`. Invalid colours fall back to the original class colour, then `#999999`.
`eventShadeOptions` normalises saved settings before editing or rendering: malformed objects, source lists,
styles and colours fall back safely, and nested overrides are copied before editing. Three-digit class colours
are expanded to six digits for the browser colour picker without modifying the original definitions.
These are figure-only overrides: the interval categories, class definitions, model predictions, probabilities,
record values and analysis-view settings remain unchanged. Shading opacity is independent of prediction
confidence; the separate classification band retains its confidence presentation. Source/class names and the
chosen colours are shown in a separate shading legend, with wrapped labels. Hiding a classification band does
not hide its selected shading or its legend.

`log.js::eventShading` resolves selected sources without mutating them. Duplicate and unavailable IDs are ignored.
In `mix` mode, every source spans the proxy track and is drawn in selection order using normal SVG alpha
compositing. In `split` mode, the track is divided into equal-width strips, one per available selected source.
Both modes are drawn behind the existing proxy curve and clipped to the figure's vertical window and track.
No fixed two-family limit applies. Event endpoints use the same depth/age conversion as their bands, including
the selected core's units and nonlinear age model.

With `area=curve`, an additional SVG clip encloses the displayed polyline and its horizontal-axis baseline:
zero when the linear range includes zero, otherwise the nearest range endpoint to zero; logarithmic axes use
the positive axis minimum. Axis reversal applies to both curve and baseline. The fill uses the same non-null
samples and straight-line connections as the existing record curve; logarithmic curves break at nonpositive
values, so the fill breaks there too. The underlying record coordinates and curve geometry are unchanged.
`area=panel` keeps full-width event rectangles behind the curve. SVG and PNG use the same geometry, colours
and opacity; scoped clip IDs prevent interference with hidden views of the same log.

Without `eventShade`, existing Multiproxy `shade`, `shadeBy` and `shadeMode` settings retain their previous
rendering. The first edit of the new figure controls creates an independent override; disabling it removes
figure shading without changing the analysis view. Restoring a figure's inherited presentation removes its
override; restoring a source's colours preserves its opacity and selection.

Validation covers four overlapping sources including a trained k-NN classification, exact unchanged core/
analysis data and proxy paths, split lanes, colour/opacity bounds, nonlinear age endpoints, another numeric-only
core with different units, independent figure types/tabs, existing inherited shading, save/reload and reset.
Pure regressions cover signed/reversed and logarithmic baselines. Browser checks inspect SVG geometry and
an actual painted PNG pixel, and run against both the served program and the offline HTML.

Browser regression checks cover mixed section/core units, the selected core's own age model, exact unchanged
analysis arrays, independent figure composition and tabs, numeric-only cores, saved settings, resets and
SVG/PNG export. The same regression runs against the standalone HTML. Unit checks cover taxon/proxy ordering,
hidden-column recovery and legend visibility.

### 20.7 Core location map
Module `locmap.js` (pure); settings in `fig.loc` (defaults `LOCMAP_DEFAULTS`). Points: the cores of the project with
latitude and longitude.
- **Coordinate reference systems** (`lmCRS`): EPSG:4326 (X = lon, Y = lat, in degrees, unscaled); EPSG:3857
  (`X = a·λ`, `Y = a·ln tan(π/4 + φ/2)`, a = 6,378,137 m, φ limited to ±85.0511°); UTM WGS 84 (EPSG 326zz north,
  327zz south): transverse Mercator with the Krüger series up to n⁴ (k₀ = 0.9996, E₀ = 500,000 m, N₀ = 0 or 10⁷ m,
  λ₀ = 6·zone − 183°; sub-millimetre error within the zone). Zone and hemisphere automatic (centre of the frame) or
  chosen. Test: N(45°, central meridian) = 4,982,950.4 m and round trip < 10⁻⁹°.
- **Frame** (`lmFrame`): `bbox = [W, S, E, N]` in degrees (by default the cores ± 25 % and at least 0.2°); 33 points
  per side are projected and their envelope taken; with a fixed proportion (4:3 by default, 1:1, 3:2, 16:9, A4) the
  envelope is widened. Zoom in/out ×1.5 and pan by 25 %.
- **Grid:** in geographic coordinates, or if "lat/lon" is asked for, meridians and parallels (curved in UTM) every 1,
  2, 5 × 10ᵏ degrees in DD, or sexagesimal steps (1″…45°) in DMS; in projected coordinates, a metric grid of 1, 2, 5 ×
  10ᵏ m. Automatic step (~5 lines) or fixed.
- **Labels** on the chosen sides (top, bottom, left, right, combinable): meridians or X at top and bottom, parallels
  or Y at the sides, where each line crosses the frame (240 samples per side and interpolation). Formats: DD
  (`37.5°N`, decimals according to the step), DMS (`37°30′N`, seconds only if the step has them) or metres with a thin
  thousands space (or km).
- **Scale bar:** metres per pixel at the centre of the map by great-circle distance (R = 6,371,008.8 m) over ±10 px;
  length 1, 2, 5 × 10ᵏ m fitting in `min(220, 0.28·width)` px; 4 alternating segments; position selectable.
- **North arrow:** points to geographic north; in UTM it is rotated by the convergence angle (angle between the pixel
  and the same point 0.01° further north); position selectable.
- **Backgrounds:** blank, vector (Natural Earth, no network) or an Esri image (satellite, topographic, relief,
  physical, street, ocean) requested with `bbox`, `bboxSR` and `imageSR` equal to the map's CRS and the same size as the
  frame (×2, at most 4,096 px), so it matches without distortion in the three systems; it needs the permission of
  §19.3.
- **Output:** SVG, PNG or JPEG at ×1–×6 (≈ 96–576 dpi).

### 20.8 Axes, ticks and editing labels

The editable colours affect drawing and exported figures, not the underlying measurements or annotations.
- `log.js::verticalTicks` shares the vertical ticks between the core column, the sections figure and the distribution
  figure. Data coordinates stay in the original unit; labels show `v · yFactor`, with
  `yFactor = UNIT_TO_CM[original unit] / UNIT_TO_CM[shown unit]` for depth.
- `yStep` is the distance between numbered ticks in the shown unit and has priority over `yDiv`. Three more levels
  without numbers can be added (`log.js::extraTicks`): `yMajor` long ticks, `yMedium` medium ticks and `yMinor` short
  ticks. Where several levels coincide the highest wins (numbered > long > medium > short), so a ruler-style scale is
  `yMinor` 1, `yMedium` 5, `yMajor` 10, `yStep` 10. Their lengths in px are `yLabelLen`, `yMajorLen`, `yMediumLen` and
  `yMinorLen` (6, 6, 4.5 and 3 by default). An explicit step is limited to 400 ticks (4 000 for the unnumbered levels)
  so that the program cannot freeze.
- Each horizontal axis (`logView.style.axes[id]`) accepts `min`, `max`, `div`, `dec`, `rev`, `log` and `step`. `step`
  has priority over `div` on linear axes. Logarithmic axes draw powers of ten; limits must be positive and the maximum
  greater than the minimum; if the automatic minimum is not positive, maximum/1000 is proposed. Plotting uses log10 and
  is clipped with a clipPath per track; non-positive values break record curves without joining across the gap.
  Multiproxy has its own scales (`geo.view.style`).
- **Editing labels:** the label editor stores changes in `logView.textEdits` (core column) and `fig.textEdits[type]`
  (figures). Each key combines the original SVG text and its occurrence number; the value holds an optional new text
  and offsets `x`, `y` in the parent's SVG coordinates. A translation is applied before the original transformation
  (including rotations); dragging converts screen coordinates with the parent's inverse matrix. The project keeps the
  edits and SVG/PNG exports include them. Changing the content or order of labels may require repositioning them, so
  scales and content are best set before the final manual layout.
- Trace symbol size and outline: `markSize`, `markStroke`, `markStrokeW`.

These settings only affect the drawing, never the result tables or the indices.

### 20.9 Horizontal orientation and excluded zones
- **Orientation** (`fig.orient`: `v` or `h`; every figure except maps): `orientSVG` rotates the drawing 90°
  anticlockwise (`rotate(-90)`: depth or age runs left to right and the first column ends up at the bottom; images
  rotate with it). Each text is wrapped in `rotate(c, ax, ay)` about its anchor point (`ax, ay` = its own transform
  applied to `x, y`), with `c = desired + 90 − own`: texts keep their reading angle and vertical ones (±90°) become
  horizontal. Anchors: texts from the original top margin (top 12 %) end at their point, those from the bottom margin
  (bottom 12 %) start at it, and those that ended at it (scale labels) are centred. Title and subtitle (top left) do
  not rotate. The page is fitted to what is drawn (`getBBox` of the SVG in a hidden copy) plus 6 px. Very dense legends
  and labels may overlap; they can be moved or edited (§20.8).
- **Excluded zones:** every figure with core images can hide them (whole core and sections, with their own option;
  core column and multiproxy column, with the column's option `logView.hideExcl`, also available in the figure panel).

---

# Part VI — The program: projects, storage and sharing

## 21. How a project is organised

### 21.1 Structure
- **Start screen.** Tab **Projects**: project cards (open, rename, delete, create, import, backups), with a search box
  over project and core names. Tab **Across projects**: a table of the cores of all projects, a multi-project map and
  the cross-project analyses (§23.5). A project checkbox selects all its cores for an analysis, including those
  filtered out by search. On the site map, marker colours and symbols are stored in browser preferences.
  A core override takes precedence over the project style. A core shared across projects uses the style of
  the first project by name that has valid coordinates for it.
- **Project → cores.** Each core (`makeCore`) has: name, latitude, longitude, water depth, depth units, notes, image
  sections with their bioturbation, external records, imported data (`imp`), manual columns (`user`), hand edits
  (`edits`), age model, column view and the reserved flag (`holdout`). Intervals, layers, rules, multiproxy settings,
  computed columns, the free sheet and figures belong to the project and refer to cores by identifier.
- **Active core.** Image tools and the core column work on the core chosen in the header: `S.sections`, `S.records`,
  `S.age` and `S.logView` point to those of the core (`activateCore`).
- **Clean start:** no project is preloaded; nothing is saved until a project is created, imported or opened. The
  repository's examples (the public core U1385I-1H, an idealised core, the multiproxy demo and the training project)
  are available only when the program runs from a copy of the repository; the example buttons check whether their file
  exists (`assetExists`, a HEAD request or an embedded resource) and hide themselves if not.

### 21.2 Cores shared between projects
- **Core key:** `coreKey(name)` = lower case, without accents (NFD) and only letters a–z and digits (any other
  character is removed). `sharedCores(lites)` → `Map(coreKey → Map(projectId → projectName))` over projects that are not
  cross-project analyses. A core is shared when it is present in ≥ 2 projects.
- **Map of all cores:** points with the same key are merged; in value mode, the arithmetic mean of the values of the
  projects with data in the window, `n` = sum of samples.

### 21.3 Windows and floating panel
- "Open in new window" opens the same program with `#win=map|geologs|corelog&project=…&core=…`. That window is
  **read-only** (it does not save) and reloads when the main window saves: message `BroadcastChannel('ichantool')`
  and, as a fallback, a check of the project's save date every 4 s. Map and multiproxy columns are built from the
  light copy; the core column loads the full project.
- With the local file (`file://`) some browsers isolate tabs; that is why there is also the **floating panel**,
  inside the same window, redrawn 0.5 s after each change.

### 21.4 Panels
The work area has three columns: `var(--lw, 280px) minmax(0,1fr) var(--rw, 320px)`; the dividers allow widths
between 170 px and 60 % of the work area; side panels can be hidden (classes `lcollapsed` / `rcollapsed`).
Preferences in `localStorage['ichantool.panels']`.

---

## 22. Storage, automatic saving and memory

The original image is streamed to the browser's origin-private file system when available. IndexedDB holds
its reference and publishes it only after the write succeeds. Where that file system is unavailable, new
images are saved as sequential IndexedDB records of at most 4 MiB, with a manifest published after all chunks
are written. Existing single-record originals remain readable. The TIFF decoder can read ranges from either
storage path. Folder backups stream the original, and ZIP packages compute each CRC in bounded reads. ZIP
download still uses the existing non-ZIP64 format with a 4 GiB limit. A browser without private file storage
may assemble chunked originals into blobs when preparing a ZIP download.

Implementation: `storage.js` and the *projects* block of `app.js`.

### 22.1 Where projects live
- Projects are stored in **IndexedDB** (database `ichantool`, version 6): in the browser profile, or, in the desktop
  program, in the program's data folder on disk. Stores: `meta` (light list), `data` (the project without images),
  `secs` (one record per section), `images` (original image references and legacy files), `imageChunks` (fallback image
  chunks), `lite` (light copy of each project) and `prefs` (preferences). The program asks the browser to mark the storage as persistent and shows whether it was granted.
- **Images:** the section keeps only `file.key`. Automatic saving writes each original once. Deleting a project
  deletes its unshared images. Start-up reclaims unreferenced originals older than one hour and incomplete staged
  writes older than 24 hours.
- **Section-level saving:** the project record (`data`) keeps of each section only `{$sec, id, name, file}`, and the
  full section goes to `secs` with the key `<project>|<section>`. A section is written only if it changed since it was
  last written or read in the session (same RLE masks and same other fields), or if its record is missing; sections
  that no longer exist are deleted. `getProject` rebuilds the full project, so exporting, copying and restoring are
  unaffected; older records (sections inside the project) are read as well. A section without a record prevents the
  project from opening (it is never saved empty). For example, changing one trace in a six-section core rewrites one
  section.
- **Light copy (`lite`):** written at every save; it holds the derived numerical data of each core, layers, intervals,
  multiproxy settings and the examples used by the all-projects model. The start screen and secondary windows use it
  so that they never have to decode images.
- If the browser does not allow storage (private window or blocked data), the program says so and the project has to
  be exported by hand.

### 22.2 Automatic saving and its safety
- Saving runs **1.5 s after any change**; the state is shown next to the project name. When the program opens, the
  last project used is opened.
- Project metadata, project data and section updates/deletions share one IndexedDB read-write transaction.
  `storage.js::run` explicitly aborts it if queuing a request throws synchronously, including a structured-clone
  error after earlier requests were queued. Request failures and transaction aborts also reject the save; the
  section comparison cache advances only after the transaction completes successfully.
- A failed save leaves the last complete project available for reopening and keeps live edits pending. The
  **Retry save** button appears beside the save status. Actions that replace the open project first flush its
  pending save and stop if changes remain unsaved (`app.js::canLeaveProject`). An uninitialised workspace with
  neither a project ID nor any cores is not an open project to preserve, so startup preferences do not block
  creating/importing the first project. Exporting the current project
  remains available during a storage failure. A failed replacement import also leaves live edits pending.
- Saving never runs during a load or on a read-only project, and opening another project cancels the pending save of
  the previous one. If loading fails halfway, the state is cleared, nothing is saved and the user is warned. The
  initial state (before any project) is never saved.
- When the page is hidden or closed, pending changes are saved (`visibilitychange`, `pagehide`); in the desktop
  program, closing with unsaved changes waits for the save to finish. If it fails (or the storage is unavailable),
  the window remains open and a dialog offers to retry, export the project as a `.sedcoretool` package or close
  without saving; changes made during a save are also kept pending.
- Project navigation, exports and desktop closing wait for the internal save, then request the folder copy in
  the background. They do not wait for external folder I/O. Closing may interrupt an unfinished folder copy;
  completed file replacements and the last complete manifest remain available, and an authorised folder copy
  is scheduled again at startup. The save indicator distinguishes pending folder work from a completed copy.
- Every 10 saves the storage quota is checked (`navigator.storage.estimate`) and the user is warned above 80 %.
- Errors that are not caught, and those of long operations, are shown in a notice (at most one every 5 s) instead of
  being lost in the console.

### 22.3 Memory and performance
- Opening a project decodes no image. Pixels (original and enhanced, 8 bytes/px) are read from disk when a section is
  used, and the least recently used sections are released above about 0.9 GB (the active section is always kept). The
  pixel budget also counts native 16-bit RGBA, U-Net probabilities and cached canvases. Masks (5 bytes/px) are kept compressed (RLE, §24)
  for sections not in use and decompressed on access (limit about 0.5 GB).
- Object statistics (`st`) and example thumbnails are stored in the project, so classification, indices and the core
  column do not need the images. Figures that need pixels read sections two at a time.
- Enhancement and detection run in a background worker (§7.1). The side column and section figures are reduced
  directly to their output size (`reduceRGBA`: box filter with premultiplied alpha, as canvas scaling) without
  full-resolution canvases. Detection morphology reuses three buffers. Overlap stacks are compacted on a copy when saving. Side-column series are cached per section.

---

## 23. Sharing, backups and settings

### 23.1 Project packages (`.sedcoretool`)
**Export this project (with images)** creates a `.sedcoretool` file: an uncompressed ZIP with `project.json` (where
each section's `file.path = images/<section id><ext>`) and the original images at full resolution. Anyone can open it
with **Import file…** on another computer. **Download full backup (all projects)** writes one package with all projects and the user settings
(`settings.json`), named `sedcoretool_copia_<date>.sedcoretool`. Older `.corantool` packages and older JSON project
files (with inline images) are still imported. Project identifiers are preserved on import unless the user chooses
to restore a separate copy after an identifier conflict (§23.3). The library stores images separately from project metadata.

Project ZIP import accepts classic stored and Deflate archives. It checks paths, directory and local headers,
and declared uncompressed sizes before reading entries. Limits are 16 MiB for the central directory, 128 MiB
per project or settings JSON, 256 MiB per Deflate member, 1 GiB for Deflate data and less than 4 GiB for all
members. Each member read is charged to the aggregate limits. Deflate output is checked against the declared size
and CRC during extraction. For a stored member, the reader computes CRC-32 in blocks of at most 4 MiB on each
read and compares it with the directory before returning the original Blob slice. Stored images retain range
access. The importer reads the project JSON and ingests its referenced images before entering the replacement
flow for an existing project, so a CRC failure surfaces as an import error before the existing project is changed.

### 23.2 Project folder and automatic copy
The automatic copy writes, in a folder chosen by the user (ideally synchronised with OneDrive, Google Drive or
Dropbox; Chrome and Edge, and the desktop program), one folder per project:

- `<name>__<id>/project.json` — current state of the project;
- `<name>__<id>/images/` — original images, each stored image key written once;
- `<name>__<id>/historial/<YYYY-MM-DD>.json` — the last version of each day. The 30 most recent daily copies are kept
  and, of older ones, the first of each month for 12 months; the rest are deleted;
- `sedcoretool_ajustes.json` — the user settings.

A copy is requested 20 s after each change and in the background when switching projects; each copy also writes
every other project modified since the previous copy. Attempts share one in-flight promise per renderer:
timers, retries and manual actions cannot start competing writers in that renderer. The run captures its current
project and destination before yielding. Its completion watermark is its start time, and projects updated at
that time are eligible again; saves during I/O leave another copy pending. Selecting a destination resets the
watermark so all stored projects are eligible, even if they have not changed since the previous folder copy.
Read failures in the library propagate as backup failures rather than silently omitting projects.
If it fails it is retried after 1, 2 and 3 minutes. At start-up the program warns if
there are changes and the copy has not run for more than 7 days or needs reactivating. The folder handle is stored in
IndexedDB; the browser may ask to confirm permission again (**Reactivate automatic backup**). An already
authorised folder is scheduled at startup so changes left pending by closing can be copied without a new edit.
Backup errors retain their reason in the status. Missing permission methods, denied permission and thrown or
rejected permission requests leave recovery controls available and explain how to select the folder again.
Overlapping activation or picker actions are suppressed until that action finishes.

Electron answers `file-system-access-restricted` with `deny`. This settles a restricted directory request
without granting access to the protected location; choose a dedicated subfolder instead. Electron requires
the application to answer this event ([session API](https://www.electronjs.org/docs/latest/api/session#event-file-system-access-restricted),
[permission-context implementation](https://github.com/electron/electron/blob/v45.2.2/shell/browser/file_system_access/file_system_access_permission_context.cc)).

Folder images use `<section id>__<image key><ext>` names. When an original image is replaced, the new stored key
gets a different file; earlier manifests and daily history keep referencing the previous image. Originals still
only in memory get a fresh identifier for each backup attempt. Existing folder copies with `<section id><ext>`
image names remain readable. Old image files are retained because daily history may reference them. Project ZIP
exports continue to use `images/<section id><ext>`.
If a referenced original cannot be found in memory or image storage, copying/exporting fails with the image's
name instead of substituting an empty file. A failed folder copy does not publish its new project manifest.

File System Access `createWritable()` stages a replacement and publishes it when `close()` succeeds; the existing
file remains readable before that commit. `app.js::writeText` aborts the writable on a write or close failure and
reports the original error. Original images are streamed before `project.json` is written. Each JSON file is
committed separately: an error writing daily history or settings after the project commits can leave a newer,
complete `project.json` alongside an older history or settings file. The backup status is then an error, its last
successful completion time is unchanged, and work remains pending for retry. **Reactivate automatic backup** is
available after an error as well as after a permission lapse; further successful library saves also schedule a
new attempt.

The browser smoke test includes `tests/e2e/interrupted-saves.mjs`. It uses an 8 × 8 synthetic PNG and real
IndexedDB/OPFS handles, injecting synchronous clone errors, aborts after a section request succeeds, an interrupted
image stream, replacement of an original before a manifest failure, and failures opening, writing and closing
the backup manifest. It checks exact preservation of the previous project and metadata, error indicators,
pending edits, blocked project switching, failed import
replacement, user-triggered retries, and reopening the previous and retried saves in a separate page with their
images. OPFS exercises the native writable commit contract without requiring an interactive folder picker;
these checks do not simulate physical power loss or synchronisation-provider behaviour.

The same interrupted-save regression runs in hidden Electron windows with an isolated profile. Delayed manifest
writes verify single-writer retry coordination and local navigation while the copy is blocked. Saves during a
copy must reach a later automatic pass; a new destination must include unchanged projects. Missing/throwing and
denied permission requests must show recovery guidance without an uncaught error. The Electron bootstrap also
injects the restricted-directory event and requires its callback to settle. This tests event wiring, not an
interactive native picker or a real cloud/network failure. See the
[desktop backup audit](diagnostics/desktop-backup-audit-2026-11-11.md) for reproduction scope and remaining limits.
The [backup-control regression](../tests/e2e/backup-controls.mjs) also checks the served and standalone builds
without module imports, using an injected folder implementation for failed writes and permission recovery.

**Open project folder…** opens a project folder (or a parent folder with several projects), so another computer can
work on a project kept in a shared folder.

### 23.3 Three layers of protection

| Layer | Where | When | Protects against |
|-------|-------|------|------------------|
| 1. Library | IndexedDB, marked persistent if the browser allows | 1.5 s after each change | closing, reloading, power cuts |
| 2. Automatic copy | folder chosen by the user, ideally synchronised | 20 s after each change and on switching project | failure or loss of the computer, clearing browser data |
| 3. Full backup | file downloaded by the user | on demand | all of the above; an independent file to keep elsewhere |

Each project copy includes the original images, depths and age model, masks, objects and the classes assigned by the
user (the interpretation), the imported learning examples, external records, multiproxy data and the column view.

**Restoring:** **Import file…** accepts several project files, full copies or settings files. If a project with the same
identifier already exists, the program asks whether to replace it or import it as a copy ("restored"); when replacing,
the local version is first kept as a copy "<name> (previous <date>)".

### 23.4 Saved settings (presets)
**Save settings** stores, with a name, the enhancement and detection parameters of the active section. Presets are
common to all projects: they are stored in the IndexedDB `prefs` store, with a copy in `localStorage`, and are included
in backups. **Apply these settings to all sections** copies enhancement and detection of the active section to the others.
Each section stores the effective values in the project, so an analysis stays reproducible even if the saved settings
are later deleted.

### 23.5 Cross-project analyses
- Cores of different projects are ticked and a project of kind `multi` is created (`projectKind: 'multi'`,
  `multiSource.keys = ['project|core', …]`). Each core is a copy of its combined data (depth, age and columns from the
  `lite` index, as an imported table; no images) with `origin = {project, core}`. Layers and categories are joined
  **by name** (also the parent layer); intervals are copied with new identifiers. If two cores have the same name, the
  project name is added.
- Ticked cores with the same key (§21.2) become a single core (`origin` = list of `{project, core}`). Tables are joined
  with `mergeImp`: rows sorted by depth if all have it, otherwise by age if all have it, otherwise one series after
  another; rows with `|Δ| < 1e-6` on the sorting axis are merged (per column, first non-empty value). Repeated
  intervals (same core, layer, class, axis and limits with `|Δ| < 1e-9`) are removed.
- Default variables: the columns present in at least two cores (up to 12, the most frequent); if missing values were
  being dropped, they are filled with the mean instead. Target layer: the same if it exists; otherwise the first with
  intervals.
- Multiproxy, Data and Figures work there. **Update from the projects** copies the data again, keeping settings,
  figures and sheet. Creating an analysis with a name already in use updates it.
- Cross-project analyses are listed, opened, updated, renamed and deleted in the **Across projects** tab, not in the
  project list; with one open the header says "Analysis". They do not appear in the table or map of all projects and
  do not contribute examples to the all-projects ichnotaxa model.

---

## 24. Exported files and file formats

### 24.1 Exported files

| File | Content |
|------|---------|
| `*_bioturbation.csv` | One row per interval and section: `section, depth_top, depth_bottom, depth, units, age, [age_min, age_max,] age_units, valid_pixels, bioturbation_pct, <class>_pct…, BI, ii, BI_manual, ii_manual` (`age_min`, `age_max` only when the age model has a range) |
| `*_objects.csv` | One row per object: section, id, class, state, suggestion, confidence, depths, area (cm²), length and width (cm), elongation, verticality, compactness, luminance, contrast, whether it counts |
| `*_mask.png` | Full-size mask: black background and every counted pixel in the colour of its class. Compatible with `sedcoretool analyze --palette` (§25.3) |
| `*_palette.json` | `{class name: "#rrggbb"}` |
| `*_segmentation_dataset.zip` | U-Net training data (§9.2), for every image of the project with at least one reviewed trace: `images/<core>__<section>.png` (original analysis area, working resolution), `masks/…png` (8-bit grey: 0 = matrix or a class that does not count, k = counted class k, 255 = ignore: excluded zone or trace without a confirmed class; classifier suggestions do not count as reviewed) and `manifest.json` (`kind: "segmentation-dataset"`, classes with their index and, per image, core, section, top, bottom, units, px/cm, size, reduction factor and number of reviewed and unreviewed objects) |
| `sedcoretool_model.json` | Ichnotaxa model: list of features, classes and examples `{name, x}`; with vision features, `features: ["vision:dinov2-small:384"]` and 384-value examples. When imported, its examples go to the library |
| `model.onnx` + `model.json` | U-Net trained with `sedcoretool unet train`: ONNX network and its description (`tile`, `overlap`, `mean`, `std`, `pxPerCm`, `classes`, `output`, training history and the cores of each set) |
| `*_registro.svg` / `*_registro.csv` | Core column of the chosen window (§15.7) |
| `*_mapa_<a0>-<a1>.svg` / `.csv` | Map of an age window (§19) |
| `sedcoretool_mapa_proyectos.png` / `.svg` | Map of all projects |
| `*_clasificacion_intervalos.csv` | Samples with label and predicted class (§18.11) |
| `*_intervalos.csv` | Intervals of all layers (§18.11) |
| `<name>.sedcoretool` | Project package (§23.1) |

**Provenance of CSV files.** Every exported CSV (bioturbation, objects, column, intervals, map, classification,
figures, data) starts with `#` lines:
`# SedCoreTool <version> (format 5) · <ISO date> · <project>` and
`# settings: binCm=…; minValid=…; includePred=…; predThr=…; countCandidates=…; detection=…; age model=…`.
The program ignores these `#` lines on table import. User-supplied delimiters and line breaks in those comments
are escaped so they cannot open another field or row. CSV and Excel exporters prepend an apostrophe to text
that starts with spreadsheet formula characters (`=`, `+`, `-`, `@`, including full-width equivalents), even after
leading whitespace. Leading tabs and line breaks also trigger the escape. Numeric cells retain their numeric
values. `core.js::toCSV` rounds noninteger numbers to six decimal places with `toFixed(6)`, converts the result
back to a number and then to text, removing trailing zeroes. Integer numbers go directly to their string
representation; numeric cells bypass text escaping and delimiter checks. Null and undefined cells are empty.
Text fields with delimiters or line breaks are quoted in CSV. Excel section sheet names are normalised and
made unique within the workbook. Tables are produced by the pure
module `exportio.js` (`bioturbationTable`, `objectsTable`, `provenanceLines`/`withProvenance`, `ageModelText`,
`recordSeries`), so the content of each file is tested.

### 24.2 Project file
The project file (`project.json` inside a package or project folder) has the structure
`{app, kind: 'project', version: 5, appVersion, delivery, saved, id, name, notes, comments, classes, active,
settings, library, projectKind, multiSource, models, finalTests, geo, sheet, fig, curCore, plots, plotCur, cores: [{id,
name, lat, lon, waterDepth, units, source, notes, holdout, imp, user, edits, records, logView, age: {text, units, …},
sections: [...]}]}`. `comments` holds the project's comment threads (with replies and author), used for team work.

- Each **section** holds the reference to its original image (`file`), the reduction factor (`ds`), crop, rotation,
  top, bottom, units, analysis area, enhancement, detection, manual indices, marks, objects (with their statistics
  `st`, class, origin, suggestion and, if computed, vision vector `em`) and the label and exclusion layers compressed
  with RLE; `stacks` holds the overlap stacks (§3.2), and `labels` may then contain negative values.
- `geo` holds the multiproxy part: cores' numerical data are in each core (`imp`); `geo` keeps ratios, layers with
  their hierarchy and categories, intervals, rules, preparation and classifier settings, the map and group names. The
  trained models are not stored (they are retrained with their seed).
- **RLE** (run-length encoding): `[value, count, value, count, …]`. It greatly reduces the size of masks, which have
  large uniform areas. Each supplied RLE must have even length and non-negative integer counts that add up to
  `w × h` (`core.js::rleValid`). Imports check this before writing the project when its dimensions are available.
  The loader also checks after deriving any missing dimensions. A failed load disables autosave for that session.
- Browser preferences (`localStorage`): `ichantool.theme`, `ichantool.panels`, `ichantool.mapFrames`,
  `ichantool.mapNet`, `ichantool.keys`, `ichantool.hoverHelp`, `ichantool.overlap`, `ichantool.autoNext`,
  `ichantool.presets`, `ichantool.homeTab`, `ichantool.last` and others of the same form.

#### Project compatibility

The app identifiers `IchAnTool`, `CorAnTool` and `SedCoreTool` are accepted on import. A ZIP package or a shared
folder resolves image paths relative to its own `project.json`. Standalone JSON projects and JSON backups can use
inline images (base64 or byte arrays). In the library the loader resolves image keys and reassembles separately
stored section records before opening. Older library records can still carry the sections inline.

| Project version | Open and migration path |
| --- | --- |
| 1–2 | `upgradeProject` maps top-level sections, records and the age model to a main core when needed. Other legacy multiproxy cores become cores with imported records. |
| 3–4 | Read the core-based layout directly. The loader accepts image references and legacy inline images. Where needed it decodes the image for dimensions and recomputes missing trace statistics. |
| 5 | The current format supports overlap stacks and editable cells. Imports and library opens use the same section loader. |
| Greater than 5 | The app attempts to open the familiar fields for consultation and warns that edits will not autosave. The import step can still store the file in the library. |

The loader converts an old interval thickness in rows (`binPx`) to centimetres when `binCm` is absent, dividing
by the first section's pixels per centimetre or using 1 cm if there are no sections. The section editor shows a
non-blocking warning when the selected section has a non-finite or non-numeric depth, its bottom is not greater
than its top, or its unit is outside `mm`, `cm` and `m`. The warning is recalculated when selecting a section or
editing the depths and units. Opening the project leaves those values as stored.

#### Region and mask diagnostics

After resolving the working image dimensions and validating RLE lengths, the section loader checks the saved
analysis region. Its edges must be integers and satisfy `0 ≤ x0 < x1 ≤ w` and `0 ≤ y0 < y1 ≤ h`. It also checks
occupied label runs directly in the compressed mask. A positive code must resolve to a trace. A negative code
must resolve to a nonempty overlap stack whose members all resolve to traces. Label codes must fit signed
32-bit integers. The check reads only occupied runs and referenced stack entries.

A project with either diagnostic opens for inspection. The section editor identifies the issue, shows the full
working image when the region is invalid, and omits trace overlays and interval results for affected sections. The
application suspends project autosave and the active project's automatic folder backup during inspection.
Project export uses the original project data captured on opening.

---

# Part VII — The Python package

## 25. The `sedcoretool` Python package

The package turns masks into depth or age series (§1.2) with exactly the definitions of Part II, and contains the
U-Net workflow. It needs Python ≥ 3.10 and depends only on NumPy, Pillow and pandas.

### 25.1 Installation
The package is not yet on PyPI; it is installed from the repository:

```bash
pip install "sedcoretool @ git+https://github.com/SantiCa/SedCoreTool.git"
# optional extras: excel (openpyxl), plot (matplotlib), unet (onnxruntime, torch, segmentation-models-pytorch, onnx)
pip install "sedcoretool[excel,plot] @ git+https://github.com/SantiCa/SedCoreTool.git"
pip install "sedcoretool[unet] @ git+https://github.com/SantiCa/SedCoreTool.git"
```

From a copy of the repository: `pip install -e ".[dev]"`. Installing gives the module `sedcoretool`, the command
`sedcoretool` and, for compatibility, the module and command `ichantool` (§1.5). The `unet` extra installs PyTorch,
which takes several GB; running an already trained model only needs `onnxruntime`.

### 25.2 Library (API)
Python analysis takes a 2-D integer or boolean mask, with `0` for matrix and IDs `1…255` for classes. The
class name at position `i - 1` corresponds to label `i`. Gaps between IDs retain their positions and
columns. Overlapping traces can be given as a 3-D boolean array `(classes, rows, columns)` (§3.2).
The analysis checks label values, the number of class names and the number of overlap layers before
allocating per-class results, with a limit of 255 classes. This covers the full positive label range of
the 8-bit masks used by the training export (§9.2) and bounds the raw per-class percentage values to
2,040 bytes per interval (255 float64 values). The analysis applies the label range independently
of the file's sample depth. The CLI replaces an explicitly selected `--exclude-value` with background
and marks those pixels as excluded before analysis.

The Python analysis API requires `min_valid` to be a finite fraction in the inclusive range 0–1. At 0,
any interval with at least one valid pixel is eligible. At 1, every pixel in the interval must be valid.

| Function or object | Module | What it does |
|--------------------|--------|--------------|
| `load_image(path, mode=None)` | `io.py` | Reads PNG, TIFF, JPEG or BMP as a NumPy array (`mode` "L" grey or "RGB"). JPEG is accepted but discouraged for masks, because compression changes pixel values. |
| `load_mask(path)` | `io.py` | Reads a single-channel label mask (PNG/TIFF) as `int32`. |
| `to_gray(img)` | `io.py` | Grey with the weights of version 2.1: 0.30 R + 0.56 G + 0.11 B. |
| `mask_from_threshold(img, threshold=5, class_name="bioturbation")` | `segmentation.py` | Binary mask: grey ≤ threshold is bioturbation (bioturbation painted black, as in version 2.1). |
| `mask_from_palette(img, palette, tolerance=10)` | `segmentation.py` | Multi-class mask from a colour-coded image using hexadecimal or RGB palette entries ([input contract](#palette-colour-inputs)); a pixel belongs to a class when each RGB channel is within `tolerance` of the class colour (the first matching class wins). The `*_mask.png` and `*_palette.json` exported by the program are read this way. |
| `mask_from_unet(img, model, px_per_cm=None, threshold=0.5, *, cpu_only=False)` | `segmentation.py` | Mask from a trained U-Net (`.onnx` with its `.json` next to it), with the rules of §9.1. |
| `analyze_mask(mask, top, bottom, *, units="cm", bin_px=1, bin_cm=None, class_names=None, schemes=(BI, ii), exclude=None, min_valid=0.2, keep_partial=True, name="section_1")` | `pipeline.py` | Intervals, percentages and indices (§3–§4). `bin_cm` sets the interval thickness in cm (as in the program); otherwise `bin_px` rows per interval (may be fractional, ≥ 1). `exclude`: boolean array of the mask's size, `True` = excluded pixel (§3.2); intervals with less than `min_valid` of their pixels valid have no data. `units`: mm, cm or m. |
| `analyze_image(path, top, bottom, *, threshold=5, **kwargs)` | `pipeline.py` | Version 2.1-compatible entry point: painted image → `mask_from_threshold` → `analyze_mask`. |
| `CoreSection` | `pipeline.py` | Result of one section: `name, top, bottom, units, bin_px, class_names, data` (pandas DataFrame) and `metadata` (`image_rows`, `image_cols`, `px_per_unit`, `excluded_pct`). `add_age(model_depth, model_age, extrapolate=False)` adds an `age` column (§5). |
| `IndexScheme(name, tiers, reference)` | `indices.py` | An index defined as data: tiers `(lower, upper, value)`, half-open `[lower, upper)`. `BI_TAYLOR_GOLDRING` and `II_DROSER_BOTTJER` are the defaults. |
| `pixel_depths(n_rows, top, bottom)`, `depth_to_age(depth, model_depth, model_age, extrapolate=False)` | `depth.py` | Depth of each row centre (§2.3) and linear age model (§5). |
| `to_csv(sections, path)`, `to_excel(sections, path)` | `export.py` | All sections in one table; Excel adds one sheet per section (needs `openpyxl`). |
| `join_sections(sections, units=None, overlap="keep")` | `export.py` | Sections of one core as one series sorted by depth (§25.6). |
| `to_las(sections, path, well="", units=None, overlap="upper", *, overwrite=True)` | `export.py` | LAS 2.0 file of one core (§25.6). Use `overwrite=False` for exclusive creation. |
| `read_manifest(path)`, `run_manifest(path, to_mask=None, **analysis)`, `write_manifest_template(folder, out=None)`, `load_exclusion(path)` | `batch.py` | Batch processing from a manifest (§25.6); `run_manifest` returns `{core: [sections, top to bottom]}`. |
| `plot_section(section, ax=None, show_indices=True)` | `plotting.py` | Quick-look figure of bioturbation %, BI and ii against depth (needs `matplotlib`). |

The output table (`CoreSection.data`) has one row per interval with the columns `section`, `depth_top`,
`depth_bottom`, `depth` (centre of the interval), `valid_pct` (percentage of the interval's pixels not excluded),
`bioturbation_pct`, one `<class>_pct` per class when there is more than one class, and one column per index scheme
(`BI`, `ii`, nullable integers); `add_age` adds `age`. Intervals without data have `NaN` percentages and empty indices;
ages outside the model are `NaN` (§4). Batch processing adds a first column `core`.

Example:

```python
import numpy as np
from sedcoretool import analyze_mask, load_image, mask_from_palette
from sedcoretool.export import to_csv

img = load_image("section_1_mask.png", "RGB")                     # exported by the program
mask, names = mask_from_palette(img, {"Planolites": "#d62728", "Zoophycos": "#1f77b4"})
section = analyze_mask(mask, top=0, bottom=150, units="cm", bin_cm=1, class_names=names, name="S1")
section.add_age(model_depth=[0, 150], model_age=[0, 12.5])
to_csv([section], "S1_bioturbation.csv")
```

#### Palette colour inputs

`mask_from_palette` accepts named entries with 3- or 6-digit ASCII hexadecimal strings, with an optional
single leading `#`, in either case. Surrounding whitespace is stripped; internal whitespace is rejected.
Short form repeats each digit: `#abc` is exactly `[170, 187, 204]`, the same as `#aabbcc`. Bare hexadecimal
strings remain supported. RGB integer sequences keep their existing first-three-channel interpretation,
including an ignored fourth channel; JSON palettes use arrays for these entries. Named colours, CSS
`rgb(...)`, extra `#` characters, other lengths and hexadecimal alpha forms are not accepted. Invalid
hexadecimal input raises `ValueError` identifying the palette class and the supported forms; it is not truncated.

Matching uses the original rule on each RGB channel: `abs(pixel[channel] - colour[channel]) <= tolerance`,
with default tolerance 10. The first matching entry in palette insertion order assigns the positive label;
unmatched pixels retain label 0. Returned names keep that same order, including classes with no matched pixels.
Equivalent hexadecimal/RGB entries therefore produce exactly the same `int32` mask, interval percentages,
BI and ii. The image and palette inputs are unchanged.

`tests/test_palette_contract.py` checks all 4,096 short hexadecimal triplets against independent RGB values,
equivalent full/bare/mixed-case/whitespace/RGB inputs, exact masks and scientific tables at tolerance 0 and
10, duplicate-colour precedence, class order, malformed forms and byte-identical command-line CSV results
through both `analyze` and `batch`. An invalid palette leaves an existing result file unchanged.

#### Python row counts and kernels

The arithmetic of interval analysis lives in `src/sedcoretool/kernels/` (pure NumPy functions shared by the library, the
command line and the desktop engine; rules in [ARCHITECTURE.md](ARCHITECTURE.md#31-python-srcsedcoretool), enforced
by `tests/test_architecture.py`): `binning` (pixels per centimetre, interval edges and sums, the minimum-valid rule,
percentages), `counting` (per-row valid, bioturbated and per-class counts), `classification` (index tiers with
first-match or last-match precedence) and `ages` (linear interpolation of an age model). `pipeline.py`, `indices.py`
and `depth.py` validate input, call the kernels and shape results; their public functions and the private names that
tests use (`_edge`, `_bin_sums`, `_label_row_counts`) are unchanged.

`analyze_mask` counts with bounded multi-row label histograms (since card M8.3.3, after V0.149; before that it was
opt-in through `SEDCORETOOL_EXPERIMENTAL_COUNTS=1`, which is still accepted and has no effect). Blocks contain at most
64 rows and 65,536 pixels; very wide images use column chunks. Each pixel's integer key is
`local_row * (classes + 1) + label`; valid keys enter `numpy.bincount`, whose output reshapes into row/class counts and
accumulates across column chunks. Total bioturbation sums the class columns; class counts use the corresponding
column. Overlapping boolean layers use `layer_row_counts` (a pixel is bioturbated once if any layer is set and counts
for every class whose layer is set). Interval sums, division order, boundaries, exclusions and configurable index
schemes follow the same path. Integer scratch scales with the bounded block, not the full image; the retained
histogram requires `8 * rows * (classes + 1)` bytes. Inputs are only read, and reverse-strided inputs are copied only per
block. `object_row_counts` serves the engine's object-label representation (positive = object, negative = overlap
stack, an object-to-class table, CSR stacks) with the same counting rule. No Rust or additional runtime dependency is
needed. See [validation and measured scope](#311-automated-tests).

`methods/section_intervals.py` implements engine method `section.intervals/1` (inputs and results: [engine contract](roadmap-engine-contract.md) §4–§5) on the kernels: `parse` validates every input, naming the field, before any calculation; `run` counts in blocks of 256 rows (checking for cancellation between blocks), forms the intervals, applies the minimum-valid rule and the no-data padding (strict comparisons with a 1e-9 depth tolerance, as in the program), classifies the indices, interpolates ages and attaches manual indices. It reproduces all 44 reference fixtures of the JavaScript calculation: row bounds, counts, indices, no-data flags and every missing-value pattern exactly, floating-point columns within 1e-9. It is not yet reachable from the desktop program; the engine process does not advertise it.

#### Image loading budget

`load_image` and `load_mask` use a fixed budget of **768 MiB** for estimated pixel buffers per load. They
check it from the image dimensions and output mode after opening the header and before loading, converting or
materialising pixels. An estimate above the budget raises `ValueError` with the filename, dimensions and sizes.
The CLI and batch workflows inherit the check through these loaders.

For width `w` and height `h`, let `P = w × h`, `R = 4P + 64h` bytes for a Pillow raster with row overhead,
and `B = P × output bands × bytes per output sample` for the packed array. The estimate adds
`max(PIL.ImageFile.MAXBLOCK, 4w)` bytes for an encoder block to the largest applicable stage:

| Stage | Estimated bytes |
| --- | ---: |
| Decoding, including a codec staging allowance | `2R` |
| Colour conversion, when requested or needed by the default mode selection | `3R` |
| NumPy materialisation, including raw byte chunks and their joined buffer | `R + 2B`, or `2R + 2B` with conversion |
| Mask conversion to `int32` after the Pillow image is closed | `B + 4P` |

The budget covers the documented [full-resolution IODP sections](../examples/U1385I-1H/README.md) at
1,380 × 29,880 pixels (41.2 million). The formula estimates about 633 MiB for an explicit conversion to
four-byte RGBA at those dimensions. The 768 MiB ceiling gives about 135 MiB of additional capacity for
larger sections and accommodates roughly 50 million pixels at similar aspect ratios. The policy estimates
loading buffers. Process RSS also depends on decoder internals, memory already in use and later analysis
allocations. Pillow applies its own configurable checks independently, and may raise an earlier error.
Direct Pillow reads in U-Net training follow their own input paths.
[Pillow image loading](https://pillow.readthedocs.io/en/stable/reference/Image.html#PIL.Image.open)

### 25.3 Command line: `sedcoretool analyze`

```bash
sedcoretool analyze IMAGE --top 0 --bottom 500 [--units cm|mm|m] [--bin-cm 1 | --bin-px 1] [--name NAME]
                    [--threshold 5 | --palette palette.json | --label-mask [--exclude-value 255]] [--tolerance 10]
                    [--exclude excl.png] [--min-valid 0.2] [-o out.csv|out.xlsx|out.las]
```

- `--threshold` (default 5): grey ≤ threshold is bioturbation (painted images, version 2.1 behaviour).
- `--palette`: colour-coded image with a JSON mapping from class name to `"#rgb"`, `"#rrggbb"` or `[r,g,b]`
  (for example the program's `*_mask.png` and `*_palette.json`); hexadecimal forms follow the
  [palette input contract](#palette-colour-inputs). `--tolerance` applies per RGB channel.
- `--label-mask`: the image is already an integer label mask.
- `--bin-cm`: interval thickness in cm, as in the program; or `--bin-px`: pixel rows per interval (default 1).
- `--exclude`: exclusion image of the same size, white (grey > 127) = excluded. `--exclude-value`: with
  `--label-mask`, pixels with this value are excluded (255 in the U-Net datasets of §9.2). Both can be combined.
- `--min-valid` (default 0.2): minimum fraction of valid pixels per interval (§3.2). Both `analyze`
  and `batch` check the inclusive range 0–1 and finiteness while parsing arguments.
- Output: CSV, Excel if the name ends in `.xlsx`, LAS 2.0 if it ends in `.las` (§25.6); by default
  `<image>_sedcoretool.csv`.

`sedcoretool --version` prints the version.

### 25.4 Command line: `sedcoretool unet`
The U-Net workflow (§9.2), with its defaults:

| Command | Arguments and options |
|---------|----------------------|
| `prepare EXPORT OUT` | `EXPORT` = the ZIP exported by the program; `--tile 512`, `--overlap 64`, `--px-per-cm` (default: median of the export), `--multiclass`, `--val CORE…`, `--test CORE…` (never used for training), `--seed 42`, `--overwrite` (replace a previous dataset in `OUT`). Prints the tiles and cores of each set and warns if there are no test cores. |
| `train DATA OUT` | `DATA` = folder made by `prepare`; `OUT` = output name (e.g. `models/unet_v1` → `.onnx`, `.json`, `.ckpt`); `--encoder resnet34`, `--no-pretrained`, `--epochs 60`, `--batch 8`, `--lr 3e-4`, `--patience 12`, `--seed 42`, `--device cuda|mps|cpu` (default: probe the available hardware), `--cpu-only`, `--resume`, `--progress-json`. |
| `device` | Prints the training device selected by the PyTorch probe as JSON. `--cpu-only` reports CPU without probing. |
| `evaluate EXPORT MODEL` | `--dataset` (use the test cores of a prepared folder) or `--cores CORE…`, `--threshold 0.5`, `--bin-cm 1.0`, `--cpu-only`, `-o scores.json`. Prints pooled IoU and Dice. |
| `predict IMAGE MODEL` | `--px-per-cm`, `--threshold 0.5`, `--cpu-only`, `-o mask.png` (default `<image>_unet_mask.png`). |

### 25.5 Differences from the program
- The package starts from a mask: it has no enhancement, detection, editing tools or ichnotaxa classifier.
- Exclusions are supplied to `analyze_mask(..., exclude=...)` as a boolean array, to `sedcoretool analyze`
  with `--exclude` as an image, or to batch processing through the manifest's `exclude` column. With
  `--label-mask`, `--exclude-value` marks an ignored label in both `analyze` and `batch`; it can be combined
  with an exclusion image. The package has no interactive exclusion drawing or `noDataPad` expansion (§3.2).
- Its CSV files have no `#` provenance lines.
- It does not read project files.

The shared definitions apply to the same mask, exclusions, interval limits, depth scale and minimum valid
fraction, with the program's `noDataPad` set to zero. The fixtures and reference workloads in §31.1 establish
equivalence within their stated numerical tolerances; they do not validate every possible input or option.

### 25.6 Batch processing, multi-section cores and LAS
Implementation: `batch.py`, `export.py::join_sections, to_las`.

**Manifest.** A CSV with one row per section image and the columns `image`, `top`, `bottom` (required) and `core`
(default: the manifest's file name), `units` (default cm), `name` (default: the image's file stem), `exclude`
(exclusion image). Relative paths are read from the manifest's folder. `sedcoretool manifest FOLDER [-o
sections.csv]` lists the images of a folder with empty depths (and `<stem>_excl.png` as exclusion when it exists);
the depths are filled in by hand. `read_manifest` recognises documented headers without case sensitivity,
loads depth columns as float64 and the identifiers and paths as strings. It skips extra columns and reads plain CSV.
Only empty CSV fields are missing: identifiers such as `NA`, `N/A`, `NULL`, `NaN` and `None` remain literal
text in string columns. Empty required fields are rejected; empty optional fields retain the defaults above.
Whitespace-only `name` and `exclude` cells also use their existing fallback/absent behaviour.
Templates containing formula-like names include an escape marker so the manifest reader can recover the original
paths and labels. See the [encoding and editing rules](#2561-manifest-text-encoding-and-editing).

```bash
sedcoretool batch sections.csv [--bin-cm 1 | --bin-px N] [--threshold 5 | --palette p.json | --label-mask
                  [--exclude-value 255]] [--min-valid 0.2] [--overlap keep|upper|error] -o out.csv|out.xlsx|out.las
```

Every section is analysed as in §3 with the same options. CSV and Excel hold all cores and sections (Excel adds one
sheet per section); with `.las`, one file per core (`<name>_<core>.las` when there are several).
An exclusion image supplied with `--exclude` or in a manifest must match the analysed section's
width and height. If the sizes differ, the diagnostic identifies both files and their dimensions
before the file's exclusion mask is combined with other exclusions.

For a multi-core LAS batch, the filename component for each core retains alphanumeric characters, hyphens
and underscores, and replaces other characters with underscores. Before writing, the CLI compares all
proposed filenames and existing directory entries using Unicode NFC and case folding. A collision within
the batch reports both core names and the conflicting filename. An occupied destination also stops the
batch before the first write. Files are opened for exclusive creation to protect destinations that appear
after the initial check.

**Joining sections** (as §15.1): sections are sorted by top depth, depths are converted to the units of the
uppermost section and intervals are joined **without recomputing them**. Gaps between sections are kept as they are.
Where sections overlap (a splice), `--overlap keep` (default for CSV/Excel) keeps every interval, `upper` keeps the
upper section and drops the intervals of a lower section whose centre lies strictly inside a section above, and
`error` stops. With `upper` or `error`, CSV and Excel are written as one joined table.

**LAS 2.0.** One core per file, depth = interval centre, `WRAP NO`, `NULL −999.25` for no data. `STEP` is the spacing
between interval centres when it is constant (relative tolerance 10⁻⁶) and 0 otherwise (gaps, mixed thicknesses).
Curves: `DEPT`, `DTOP`, `DBOT`, `AGE` (if present), `VALID` (%), `BIOT` (%), one `<CLASS>_PCT` per class, and one
curve per index (`BI`, `II`). Mnemonics are upper case, with characters other than letters, digits and `_` replaced
by `_`, at most 24 characters and made unique; the original class name is in the curve description. Overlapping
sections are joined with `overlap="upper"` by default, because depth must increase strictly. The `~Parameter`
section lists the number of sections and their names.

### 25.6.1 Manifest text encoding and editing

Generated manifests use the existing `__sedcoretool_csv_escape__` column with the per-row value
`apostrophe-v1`. It is an encoding marker, not a data column. A row is marked if any original cell needs
spreadsheet formula protection. For its string fields (`image`, `core`, `name`, `exclude`, `units`), the
writer prefixes formula-like text with one ASCII apostrophe; a literal leading apostrophe is doubled in
that marked row. Other text stays unchanged. The general CSV writer leaves these already-prefixed values
unchanged. When reading a marked row, exactly one leading apostrophe is removed from each string field.
Numeric depth fields are never decoded this way. CSV quoting around cells is separate from this encoding.

| Original string | CSV cell content in a marked row | Decoded string |
|---|---|---|
| `'section.png` | `''section.png` | `'section.png` |
| `''section.png` | `'''section.png` | `''section.png` |
| `-section.png` | `'-section.png` | `-section.png` |
| `=Core` | `'=Core` | `=Core` |
| ` ordinary` | ` ordinary` | ` ordinary` |
| `NA` | `NA` | `NA` |

The marker applies to each row, including rows that mix ordinary strings, protected strings and original
apostrophes. In a row without `apostrophe-v1`, all text is read literally: an original leading apostrophe
is preserved. Previously generated manifests use the same encoding and require no migration.

The simplest supported edit is to fill in `top` and `bottom`, preserving every text cell and marker. Import
text columns literally in a spreadsheet; automatic formula, date or numeric conversion must not rewrite
them. Save as comma-separated UTF-8 CSV with a dot decimal separator. Do not remove the marker or strip
leading apostrophes from an existing generated row. If changing a string in a marked row with a text editor,
encode the new value according to the same rule: double an original first apostrophe, prefix formula-like
text with one apostrophe, and leave ordinary text alone. Newly authored, unmarked manifests contain raw
strings and are not automatically protected for spreadsheet opening. Do not copy a marker onto raw text.

`tests/test_manifest_contract.py` verifies generated mixed rows through CSV depth edits and a controlled
literal-text XLSX save/reopen/CSV round trip using openpyxl. It also covers marked-row name edits,
unmarked user input, exact paths/names with whitespace and apostrophes, missing-value-like literals,
numeric depths, defaults, exclusion paths and unchanged mask/BI/ii results. Existing spreadsheet-export
regressions retain formula protection. These checks validate the file-level contract; native spreadsheet
import/export interfaces and their locale-dependent automatic conversions are not covered. The
[reproduction evidence](diagnostics/manifest-round-trip-2026-11-12.md) records that scope and the reader correction.

---

# Part VIII — Desktop program, distribution and engineering

## 26. Desktop program

Code: `desktop/` (Electron 45.2.2, packaged with electron-builder 26.18.0).

- **What it runs:** the `app/` code, served through the private scheme `app://` (so ES modules, IndexedDB and fetch
  work as on a web server), plus the Natural Earth coastline used by maps. Downloads contain no sample data.
  `desktop/main.js::resolveAppPath` and `isWithinRoot` require the `app://corantool` origin, decode the URL path once,
  reject malformed percent-escapes, NUL bytes, encoded or literal backslashes, encoded slashes (`%2f`, `%5c`), colons
  (Windows drive and stream forms) and directory URLs, and verify with `path.relative` that the resolved target lies
  strictly inside `desktop/web` rather than matching by string prefix alone. Unencoded `/../` and `/%2e%2e/` segments
  at the URL root are clamped to `/` by standard URL parsing before reaching filesystem resolution and therefore map
  inside `desktop/web`.
- **Memory:** the JavaScript memory limit is 75 % of the computer's RAM, between 2 and 32 GB
  (`--max-old-space-size`), although Electron limits each window to about 4 GB of JavaScript objects (pointer
  compression). Images (ArrayBuffers) are outside that limit; beyond physical RAM the operating system pages memory to
  disk.
- **Data:** projects are stored in IndexedDB inside the program's data folder, with persistent storage. On first run
  after the rename, an existing `CorAnTool` data folder is kept in use (§1.5).
- **Desktop bridges:** the page reaches the trainer (§9.3) and temporary diagnostics (§26.1) through narrow
  `window.corantoolDesktop` methods. Main-process IPC accepts calls only from validated application asset URLs.
  External links open in the system browser.
- **Closing:** closing the window with pending changes waits for the save to finish (§22.2).
- **Platforms:** Windows 10/11 x64 (NSIS installer, and a portable ZIP of the program folder to unzip and run), macOS 13 or later (universal dmg for Intel and Apple
  Silicon; Electron dropped macOS 12) and Linux x64 (AppImage and deb). Builds are not code-signed, so the operating
  system may ask for confirmation the first time. Building needs Node ≥ 22.12.
- **Version and file names:** the executable's version is `0.<n>.0` and files are named
  `SedCoreTool-V0.<n>-<system>-<architecture>.<ext>`; the offline file is `SedCoreTool_V0.<n>.html`.

### 26.1 Temporary operating diagnostics

Implementation: `desktop/diagnostics.js` (bounded local log and field filtering), `desktop/main.js` (IPC and
native lifecycle/resource events), `desktop/preload.js` (narrow bridge), `app/js/diagnostics.js` (controls,
static control IDs, heartbeats and operation callbacks). This facility is desktop-only and off by default.
The browser and standalone HTML contain the shared interface module but keep its controls hidden without
the diagnostics bridge. No telemetry service, crash uploader, screen recording or extra dependency is used.

**Activation and retention.** Explicit activation stores an expiry seven days after that action in
`userData/diagnostics/state.json`. Only schema 1 and an unexpired timestamp no more than seven days ahead
are accepted. State parsing reads at most 4,097 bytes and rejects oversized input. Restarting continues an
unexpired activation; it does not extend the expiry. Stopping persists expiry zero. Clearing stops recording
and removes only `state.json`, `current.jsonl` and `previous.jsonl`; projects and separately exported logs stay.
A visible header indicator opens the diagnostic controls from other working modes.

`current.jsonl` rotates into `previous.jsonl` before an append would exceed 2 MiB. Each file stays within
that limit, retaining at most 4 MiB of recent event data in addition to the small activation state. A queue
of at most 256 events feeds one asynchronous append loop; overflow is counted as `log.dropped`. A diagnostic
write failure disables recording for the running process and is shown independently of project saving.
Configuration and explicit exports use uniquely named temporary files and atomic replacement; failed
replacement preserves the last good destination. Reads for export are capped at each log's size limit.

**Recorded fields.** Entries contain a main-process timestamp, sequence, random session identifier, program
version and an allowlisted event type. Session starts also record numeric Node/Electron/Chromium versions.
The renderer reports only control IDs present before saved projects load, fixed shortcut names outside text
fields, working mode/tool, section dimensions and counts, save/backup states, and operation start/end/error
markers with identifiers and elapsed milliseconds. Save, load, detection, generic busy work, folder selection,
permission recovery and backup stages are instrumented. Error records retain a recognised error class and up
to eight known JavaScript module basenames with line/column numbers. Raw error messages and full stacks,
URLs, directory paths, project IDs/names, selected files, labels, notes, field values, pointer coordinates,
images, masks and measurements are excluded. The main process applies its own allowlist to renderer payloads.

Every five seconds an active renderer sends a heartbeat with visibility and timer delay. The main process
independently samples its RSS in bytes and process working sets in Electron-reported kilobytes, summed CPU percentages and
time since the oldest open window heartbeat. Hidden-window throttling can also delay a heartbeat: silence is
not proof of a hang. Native unresponsive/responsive, renderer termination, child-process failure and failed
load events are recorded without URLs. Main uncaught exceptions are observed without replacing the existing
fatal-error handling. These are diagnostic samples, not M0.1 performance benchmarks; instrumentation can
affect timings. See the [Electron metrics API](https://www.electronjs.org/docs/latest/api/app#appgetappmetrics),
[memory units](https://www.electronjs.org/docs/latest/api/structures/memory-info)
and [Node exception monitor](https://nodejs.org/api/process.html#event-uncaughtexceptionmonitor).

**Recovery and export.** The log is outside the renderer, so a renderer crash does not clear already written
events. After restarting, export produces JSON Lines with a format/runtime header and the retained events
from the previous and current files. The native save dialog chooses the only export destination; renderer IPC
cannot supply arbitrary filesystem paths. There is no automatic network transfer. Events still queued at
abrupt process termination and data not flushed by the operating system may be lost. A fully unresponsive
main process or exhausted disk can prevent further recording. The recorder does not alter save/recovery
decisions or scientific results, and it does not automatically diagnose the cause of a failure.

**Lifecycle.** Untick recording for rollback, or stop and clear it. This temporary facility remains behind
the explicit opt-in until the maintainer accepts the failure diagnosis, after which its removal is a separate
delivery. `window.ichantool.ready` exposes the existing startup promise to automated checks so native test
windows can finish loading without a redundant navigation through the desktop close guard.

### 26.2 Experimental engine process

Implementation: `desktop/engine.js` (main-process lifecycle/client), `desktop/engine-ipc.js` (the page bridge: `status`, `beginBuffer`, `appendBuffer` (at most 1 MiB, contiguous offsets), `commitBuffer`, `analyzeSection`, `cancel`, `readBuffer`, `release`; only the top frame of an `app://` page may call; at most 256 buffers and 5 running analyses per page; tokens are released when the page navigates, reloads, crashes or closes; a failed call resolves to `{error: {code, field?}}`), `desktop/engine-protocol.js` (framing),
`src/sedcoretool/engine/{protocol,buffers,specs,server,worker}.py` (standard-library coordinator, staged data, input tables and
worker-process wrappers) and `method_worker.py` (the long-lived script that runs scientific methods, one job at a time, in its own process). This experiment is disabled unless `SEDCORETOOL_ENGINE_EXPERIMENT=1`.
It uses the verified bundled runtime (§26.3), or an explicitly selected absolute `SEDCORETOOL_ENGINE_PYTHON`
path in source development only. A missing or invalid bundle reports unavailable; packaged applications never
use that override or search for a user's interpreter. The browser and standalone file do not launch a process. With the experiment on, the interval table of every section is calculated by the engine's `section.intervals/1` (below) and the
JavaScript calculation does not run; with it off only the JavaScript calculation runs, and a failed engine is shown as an error, never
replaced by the other calculation. Everything else (editing, saving, exports) is unchanged and stays in the interface. The page reads
`window.corantoolDesktop.engine.enabled` once at startup. For each section `app/js/engineanalysis.js` derives a revision
(`analysisRevision`: mask version, geometry, depth range, manual indices, counted classes, the settings the method reads, the age model
and the effective class of every object), empties `s.bins` and shows a pending note while the result is awaited, uploads the inputs
(`engineclient.js`, chunks of at most 1 MiB, SHA-256 per buffer), downloads the result columns and converts them with `resultToBins`.
Sections are analysed one at a time; a request made obsolete by an edit is cancelled; a result is published only if the section's
revision is still the requested one. A failure sets the section's `analysis` state to an error with the engine's code, shown through
the texts `engine.error.<CODE>`; the same revision is not retried on every redraw, an edit retries. A section whose labels exceed the
256 MiB buffer limit fails with `LIMIT_EXCEEDED`.

Main launches the fixed prepared server script with `-I -B -u`, an argument array and private pipes, with no shell
or listening service. `window.corantoolDesktop.engine.status()` exposes only enablement, state, protocol,
method names and runtime status. IPC validates the application origin; the page cannot supply
commands, paths or raw operations. Disabled mode creates no process. Main starts the experiment independently
of window loading, reports failure through status and waits for shutdown before quitting.

Frames use the M8.1 `SCE1` 12-byte header, strict UTF-8 JSON controls <=64 KiB, binary chunks <=1 MiB and
duplicate-key/depth/finite-number checks. At most 32 requests and two binary chunks are outstanding in main;
descriptor/binary pairs cannot interleave. Partial/malformed frames, unknown sessions, process exit or request
timeout invalidate the session. Each fresh start assigns a new UUID; previous handles cannot be reused.
Two methods are advertised. `buffer.digest/1` (`buffer.digest {handle}`) recomputes a committed buffer's SHA-256 in an
isolated subprocess and returns `{sha256,byte_length}`; it tests transport and worker ownership. `section.intervals/1`
(`section.analyze`, inputs and results in the [engine contract](roadmap-engine-contract.md) §3–§5) calculates the interval
table of a section from nine input buffers: the coordinator checks the request's identity fields, that the `settings` buffer's
SHA-256 equals `settings_hash`, and every handle's dtype and rank, pins the inputs, and queues the job. The job runs in
`method_worker.py` (NumPy only; the public package and pandas are not loaded), a worker the coordinator starts with the first job
and keeps for the next ones (starting it costs about 0.7 s): the coordinator sends it the path of a job description on stdin and it
answers each job with one frame. The worker validates every input and writes the
result columns, one after another and each starting at a multiple of 8 bytes, to a single file with a layout (name, type, shape,
offset, length); the coordinator checks the layout, moves the file into the store, reads it once to check its SHA-256 and that every
float64 column is finite, and adopts it as one committed `u8` buffer charged to the session budget, then answers with its handle and
the layout (one file because every file open costs about 2 ms on Windows; the first version wrote and re-read about 35).
The worker also remembers, indexed by the SHA-256 that the coordinator verified for each input buffer, the masks it has validated, the
row counts of masks it has counted (16 entries and 64 MiB at most) and up to 64 decoded metadata tables; a job that changes only the
settings (the interval size) therefore skips validation, counting and decoding, and the memory is lost with the worker. `buffer.read {handle, offset, byte_length}` downloads any
committed buffer in ranges of at most 1 MiB: the JSON response is followed by exactly one binary frame. A rejected input is an
error response naming the field; a worker that crashes, ends before answering, sends an answer the coordinator does not approve,
lies about its files or exceeds 120 s is `INTERNAL` and nothing is adopted, and the next job gets a new worker. A cancellation
that the worker does not acknowledge within 1.5 s, an abandoned job and the end of the engine kill the worker; an idle worker stops
after 30 s. Progress events are not sent yet.

`buffer.begin`, `chunk`, `commit` and `release` stage data in private temporary files. Validate shape/dtype/
declared size before allocation; enforce exact offsets, length, SHA-256, finite f64 data and strict metadata
before commit. Buffers are immutable after commit; releasing a queued/active snapshot revokes new access but
keeps its file pinned until admitted work finishes. Limits: 256 live handles, 256 MiB per numeric buffer,
4 MiB per metadata buffer, 512 MiB admitted session budget with a 16 MiB transient reserve. Metadata reserves
64 times its byte length for parsing/object overhead. The session's staged bytes fit below the planned 1 GiB
scratch-disk cap; this does not claim total RSS or multi-gigabyte support. Main owns the temporary root and
attempts bounded cleanup after child close, including coordinator failure, checking the absolute target before
recursive removal. External locks can prevent cleanup; abrupt main-process termination can leave an empty
temporary root after server cleanup.

One job (a digest or an analysis) runs and at most four wait; excess receives BUSY. A worker polls a private cancellation
marker between reads or blocks of rows; the coordinator starts forced termination after 1.5 s if needed. A worker deadline (30 s for the digest, 120 s for a method)
prevents unbounded execution. Cancellation has its own acknowledgement and the target's terminal response;
queued cancellation releases its pin. EOF on a private worker liveness pipe aborts orphaned work. Windows
workers use CREATE_NO_WINDOW. The coordinator stays responsive to control requests; workers do not access
project databases or save files. Engine failure never selects another scientific algorithm.

Main's handshake/control deadline is 5 s; shutdown requests have a 1.5 s deadline and main forces termination
if exit does not follow within a further 1.5 s. Forced termination ends the coordinator immediately. On Windows
the coordinator belongs to a kill-on-close Job Object (`engine/lifetime.py`), so the operating system ends its
workers with it; workers also stop when their private liveness pipe closes, and `taskkill /T` remains as a
backstop. On other systems main signals the coordinator's process group. Errors exposed by the client are fixed codes;
input data, paths and tracebacks are not forwarded. Stderr capture is off in the desktop service; test-only
clients may retain a bounded 64 KiB tail. Native math thread environment limits are set before worker startup
to max(1,min(4,logical CPUs−1)); the digest imports no numerical library and a method worker imports NumPy only, never
training libraries. Runtime identity
distinguishes `bundled-verified` from `unverified-development`; only the former uses the resource manifest.

**Inputs kept between analyses (card M8.4.2).** `app/js/engineclient.js` keeps the committed input buffers of a section in the engine after a
successful analysis, for up to 16 sections and 256 MiB (least recently used first; a section larger than the bound is released
after each analysis). The four masks (`labels`, `exclude`, `stack_offsets`, `stack_members`) are valid for one *mask identity*
(`sectionanalysis.js::maskIdentity`: mask version, size and the number and members of the overlap stacks, i.e. the invariant of the
JavaScript row-count cache); each table is valid for the SHA-256 of its bytes. An analysis whose masks are resident leaves them out
of the snapshot and uploads only the tables whose bytes changed (an interval-size change sends the settings table alone); a changed
mask identity uploads the four masks and releases the ones they replace. Buffers that the engine no longer knows (it restarted) give
`RESIDENT_LOST` and the controller uploads a full snapshot once. A failed or cancelled analysis leaves the resident buffers as they
were and releases what it uploaded. The engine accepts 256 live buffers; the bridge 512 tokens per page.

The [M8.1 contract](roadmap-engine-contract.md) specifies later scientific inputs/results and predeclared
acceptance gates. Current transport/worker regression tests exercise corruption, admission, cancellation,
failure, cleanup and restart. Complete process-tree memory/latency measurements and clean-machine
platform acceptance remain roadmap work, not passed performance gates.
Commit verification currently runs in the coordinator over bounded files; cancellation responsiveness during
large-file hashing/metadata validation still needs the M8.2.3 load checks and any required scheduling changes.

### 26.3 Bundled scientific runtime

Implementation: `desktop/runtime-lock.json`, `tools/prepare_engine_runtime.py`,
`tools/check_engine_runtime.py`, `desktop/engine-runtime.js`, and desktop prepare/build/package-check scripts.
The base is CPython **3.12.16**, Astral python-build-standalone release **20261110**, using `install_only`
archives. Pinned wheels: NumPy 2.2.6, pandas 2.2.3, Pillow 11.3.0, python-dateutil 2.9.0.post0, pytz 2025.2,
tzdata 2025.2 and six 1.17.0. These packaging constraints do not narrow the public package's declared version
ranges or alter the optional trainer environment. Torch, ONNX Runtime and segmentation-models-pytorch are
absent from the base. NumPy/pandas/Pillow already provide the scientific package dependencies;
no new numerical framework or installer dependency is added to the program.
The upstream interpreter retains its own pip (26.3 in this build); the application does not invoke it to
install or update packages. Because every shipped file is verified at launch, preparation deletes content the
engine never imports (`prune_runtime` in `tools/prepare_engine_runtime.py`): the interpreter's own pip, the
`include`, `libs` and Tcl/Tk data folders, `idlelib`, `lib2to3`, `turtledemo` and the interpreter test suite, and
pandas' `tests` folders (numpy's `tests` folders stay: `numpy.testing` imports one of them). The Windows runtime
inventories 3,552 files totalling about 205 MB (excluding the manifest, application and filesystem allocation),
down from 7,326 files and 249 MB before pruning. This is a distribution-size measurement, not a RAM/performance
result; the manifest hash and reproduction checks of the unpruned bundle are in the V0.143 evidence below.

The selected distribution supplies a relocatable interpreter/standard library across the four target triples;
the [upstream documentation](https://docs.astral.sh/python-build-standalone/running/) describes its runtime
requirements and included notices. A system-Python dependency fails the portable requirement; the official
Windows embeddable archive alone does not supply matching Linux/macOS resources. Freezing the engine into a
new executable would add a packager and its native-extension hooks. This approach reuses the process boundary
and standard wheels, retaining upstream runtime files/notices. It increases download/disk size; it does not
imply that all libraries are loaded into RAM at startup or claim a speedup.

**Launch verification.** Before spawning the interpreter, `loadRuntime()` checks that the runtime and source folders
hold exactly the listed files, that links stay inside the root and that sizes match, and computes a *fingerprint*:
the SHA-256 of the sorted lines `path, size, modification time (ns), change time (ns), inode, device, expected digest`
for every file. If the fingerprint equals the one stored after the last full verification of the same manifest
(`engine-runtime-verified.json` in the user-data folder: schema, manifest hash, two fingerprints), content hashing is
skipped. Otherwise every file is hashed with SHA-256 (two files at a time) and, only if all match, a new record is
written atomically. A missing, oversized (over 4 KiB), malformed or foreign record, or a failed write, means a full
verification; it never prevents or weakens one. The change time cannot be set by ordinary file APIs, so restoring a
modification time after editing a file still changes the fingerprint. The record guards against corruption and
accidental change, not against someone who can write to the program folder and the user-data folder (they could replace the program itself).
The first launch after installing or updating always performs the full verification.

| Resource directory | Interpreter | Distribution |
|---|---|---|
| `engine-runtime/win32-x64` | `python/python.exe` | x86_64-pc-windows-msvc |
| `engine-runtime/linux-x64` | `python/bin/python3.12` | x86_64-unknown-linux-gnu |
| `engine-runtime/darwin-x64` | `python/bin/python3.12` | x86_64-apple-darwin |
| `engine-runtime/darwin-arm64` | `python/bin/python3.12` | aarch64-apple-darwin |

Windows/Linux builds include their x64 directory. The universal macOS layout includes both interpreter trees
unchanged; `process.arch` selects the matching one, including Intel execution under Rosetta. The narrow
`x64ArchFiles` rule preserves identical Mach-O resources across the two app halves rather than merging the
fixed interpreters with lipo. Native execution of the other architecture and minimum supported OS versions
still require platform acceptance; a cross-assembled resource is not a native validation result.

**Preparation.** `npm run prepare-runtime` copies the current application sources and runs the build-only
Python tool. `npm run dist` prepares the required target(s) automatically; `node scripts/build.js --dir`
builds an unpacked application for checking. Builders need Python 3.12/pip; installed users do not. Build-time
downloads use only locked HTTPS URLs and exact sizes/SHA-256 hashes. Verified files are cached under
`.venv/runtime-downloads`; `--offline` (or `SEDCORETOOL_RUNTIME_OFFLINE=1` for a desktop build) forbids downloads.
Corrupt cached bytes cause failure without being silently replaced. No “latest” lookup occurs during builds.

Extraction preflights paths, member types, <=50,000 members, <=256 MiB per file and <=2 GiB expanded bytes,
then uses Python's data extraction filter to constrain links. Pip installs exact local wheels with
`--no-index --no-deps --require-hashes --no-compile` and explicit platform/ABI tags, including cross-architecture
macOS assembly. Generated package CLI launchers with host-specific interpreter paths and their RECORD rows
are removed. Upstream interpreter and wheel licence notices are retained. Staging is private and guarded
per target; a failed replacement restores the previous complete resource directory rather than merging partial
files. Successful preparation writes an inventory manifest and moves the complete directory into place.
Runtime binaries/cache are ignored by Git.

**Identity and launch.** Each manifest binds target, application/Python/dependency versions, exact lock hash,
whether a native check ran, and SHA-256/size inventories of runtime files and prepared Python sources.
Relative symlinks must resolve inside the runtime. Main validates the selected manifest (<=8 MiB), versions,
all listed bytes and the absence of extra files before launching. Verification streams file hashes with at
most two concurrent readers; traversal is capped at 50,000 entries and 2 GiB of file data. The SHA-256 of
manifest bytes is the protocol runtime ID. Missing files, modified sources, extra `.pth` files, wrong versions
or unsupported targets fail closed. These checks detect mismatches against trusted application resources;
they are not a signing or hostile-OS guarantee.

Main reads the packaged lock from the application archive and uses `resources/python/src` for engine source.
Interpreter and worker run with `-I -B`, preventing user-site/PYTHONPATH injection and bytecode writes into
immutable resources. Main removes external native-library preload/search overrides. Resource verification
runs asynchronously without holding window creation; quitting during verification prevents a later spawn.
Launch/retry never install packages, download data or fall back to a system interpreter. The experiment stays
off by default and still advertises only `buffer.digest/1`.

**Validation and updates.** Native preparation checks 64-bit/version/dependency identity, absence of training
libraries, interval percentages/indices, overlaps, exclusions, 20 fixed fractional-boundary cases, the v2.1
reference result (1e-9 absolute depth/percentage tolerance and exact indices), and exact PNG/TIFF uint16 round
trips. The check removes Python/native-library overrides and restricts PATH. Package inspection rechecks
archived client/lock bytes, resource/source inventories and native engine startup with a restricted PATH.
This verifies resource relocation without claiming a clean machine. CI prepares native resources and checks
Electron/packages on its configured platforms; local Windows results do not certify unexecuted macOS/Linux
jobs. See [recorded delivery evidence](validation/M8.2.2-v0.143.json).

Updates require an explicit lock change, upstream hashes, rebuilt native resources and scientific/image/
lifecycle/package checks on each target. There is no automatic update. Follow the
[runtime update policy](../SECURITY.md#desktop-scientific-runtime); keep optional trainer constraints separate
under M3.2.4. M8.2.3 retains clean-machine/installer and cross-platform acceptance, resource measurements and
large commit-verification scheduling gates.

## 27. Offline single file

`python tools/build_standalone.py` writes `dist/SedCoreTool_V0.<n>.html`: the modules of `app/js/` concatenated in a
fixed order (`ORDER`; top-level names must not clash between modules) together with the HTML, the styles and the
coastline, with no change to the calculations. It opens with a double click, without a server or internet. It
contains no sample data. Background workers are not available from `file://`, so enhancement and detection run on the
main thread (identical results). Because some browsers isolate `file://` tabs, the floating panel (§21.3) replaces
separate windows where needed.

### Standalone compatibility exports

The standalone generator strips local, unaliased named export lists terminated by semicolons, including
multiline lists. The original declarations remain once in the concatenated scope. Aliased lists, export-from
lists and unterminated lists are rejected with an actionable error; this limited support does not implement
a full JavaScript module parser. Existing import stripping and top-level name/dependency-order checks
still apply. `sectiondepth.js` follows `core.js`, `sectionanalysis.js` follows `sectiondepth.js`, and both precede their consumers in `ORDER`.


## 28. Repository engineering and security

**Performance baseline.** The [M0.1 benchmark](benchmarks/M0.1.md) measures browser project opening, IndexedDB
autosave and interval analysis, and verifies the shared interval results against the public Python API.
Its [independent validation](benchmarks/M0.1-independent-review-2026-11-10.md) confirms source and fixture
fingerprints, measurement boundaries, sampled memory accounting, numerical parity and save/reopen checks.
The measurements are informational and do not impose CI performance thresholds.
The [shared-analysis profile](benchmarks/M3.1.2.md), run with `tools/benchmark_analysis.py`, reuses both edited
M0.1 fixtures, measures resident-mask analysis with cleared/reusable browser row counts and the public Python
API, and records separate CDP/cProfile diagnostics. Exact repeatability, input preservation and accepted 2 cm
baseline results pass. Fractional 1.37 cm intervals expose the boundary disagreement described in §31.1;
measurement completion and scientific parity have separate report flags. The profile changes no algorithms.
The [M1.1.2 benchmark](benchmarks/M1.1.2.md) measures editing history with two trace densities and verifies
undo, overlapping trace order and persistence.
The [large-image profile](benchmarks/M2.2.md), run with `tools/benchmark_images.py`, measures prepared-project
opening, section navigation, resident/evicted returns and zoom/pan. It reuses M0.1 preparation and RSS sampling,
adds separate main-thread/worker CPU profiles and checks exact image/mask/interval preservation through edits,
full-resolution PNG export and reload. Application provenance is checked separately from benchmark-tool hashes;
text line endings are normalised, including bundled licences. The report records the measured application
commit, environment, every trial, median/range and limitations. Profiling does not change cache budgets or loaders.
The [navigation-preview comparison](benchmarks/M2.2.3.md) and
[startup-default verification](benchmarks/M2.2.4.md) use identical benchmark-tool fingerprints on each pair of
paths. Separate visual trials compare every displayed gutter pixel;
reference preparation is excluded from timing/RSS trials. Provenance includes untracked, non-ignored source
files and records additions relative to the application commit. `--nav-default` requires the preview to start
enabled without changing the checkbox; the legacy benchmark explicitly disables it before timed opening.
Current fixture/scientific hashes identify sections by source-order index, excluding random storage IDs
while retaining masks, assignments and interval arrays. This canonicalisation changes no project data.

**JavaScript type checks.** Run `npm ci` and `npm run typecheck` with Node 22. The first pass uses TypeScript
in strict mode on `core.js`, `state.js`, `imageproc.js`, `unetmodel.js`, `sectiondepth.js` and `sectionanalysis.js`. JSDoc describes the shared contracts, and consumers
such as `columns.js` use those types through ordinary JavaScript imports. The second pass checks all application
modules with ES2022, `allowJs`, `checkJs` and `noEmit`. The `checks` CI job runs both passes on pushes and
pull requests.

The second pass compares diagnostics against `tools/typecheck-baseline.json`. Entries are keyed by file,
diagnostic code, source line and message fingerprint. A new diagnostic fails the check even in a file with
existing entries. After fixing existing diagnostics, `npm run typecheck -- --prune-baseline` removes only
entries that no longer occur. TypeScript is a pinned development dependency and the application ships JavaScript.

- **Single version:** `DELIVERY = 'V0.<n>'` in `app/js/app.js` is shown in the program (header, start screen, help and
  window title), stored in every project (`delivery`) and used for file names. `tools/sync_version.py` writes
  `0.<n>.0` to `pyproject.toml`, `src/sedcoretool/__init__.py` (`__version__`), `CITATION.cff` and
  `desktop/package.json`; `--check` runs in CI and the test `tests/app/version.test.mjs` checks the same thing.
- **Tests in CI** (`.github/workflows/tests.yml`): Python 3.10, 3.12 and 3.13 on Ubuntu and 3.12 on Windows and macOS,
  with coverage (`pytest-cov`); program tests on the three systems (coverage on Ubuntu); the browser end-to-end test;
  version check, `ruff`, ESLint (`eslint.config.js`, correctness rules only) and the build of the offline file.
  Dependabot runs weekly.
- **Desktop builds** (`.github/workflows/desktop.yml`): pushing a tag `V*` builds Windows, macOS and Linux and
  publishes a GitHub Release. Before packaging, `tests/e2e/desktop.mjs` starts the real Electron entry point with a
  temporary profile and hidden windows and checks `app://`, the content security policy, the local ONNX Runtime, the
  trainer's status call, detection on the public example and that a pending deletion survives closing and restarting
  the process (with Xvfb on Linux). The workflow prepares the examples for the test. The installer build then
  recreates the web directory without them, and checks that the packaged application archives contain only the
  coastline under `web/examples` before uploading installers. A split universal macOS bundle is checked for both
  Intel and Apple Silicon. Optional checks: `SEDCORETOOL_VISION_MODEL` (real DINOv2 inference) and
  `SEDCORETOOL_NETWORK_SMOKE=1` (six Esri backgrounds for a fixed public extent, 0°–5° E / 35°–40° N). A manual run
  on `master` (`workflow_dispatch`) builds test artefacts (`sedcoretool-windows-latest`, `sedcoretool-macos-latest`,
  `sedcoretool-ubuntu-latest`) and, with `draft_release`, prepares an unpublished release draft:
  `tools/prepare_release.py` requires the five installers, adds the offline HTML and writes `RELEASE_MANIFEST.json`
  (version, commit, sizes, SHA-256) and `SHA256SUMS.txt`; it rejects missing, empty or extra files. Everything is
  attached to the draft and to the artefact `sedcoretool-release-bundle`. The draft is tied to the built commit; no tag
  is created until the draft is published, and a version that already has a tag is rejected. `tools/release.sh`
  checks branch, clean tree, versions and tests, and pushes the tag. Workflows run with minimal permissions.
- **Archiving:** `.zenodo.json` describes the software for Zenodo and links it to the archive of version 2.1
  (Zenodo 3518837) as a newer version.
- **Content security policy** in `index.html`: scripts only from the program itself and from jsDelivr/SheetJS,
  WebAssembly, and images and connections only to Esri, GEBCO, Hugging Face and jsDelivr (the offline file allows
  inline scripts). Libraries loaded from the internet as a fallback carry SRI hashes (`sha384`).
- **Bundled libraries** (`app/vendor/`): UTIF 3.1.0 and pako 2.1.0 (TIFF), SheetJS 0.20.3 (§16) and the IBM Plex
  fonts, each with its licence; the desktop build adds ONNX Runtime Web (`desktop/scripts/prepare.js`).
  `tools/update_vendor.sh` downloads the libraries with their licences; hashes and this document must be updated with them. `.gitattributes` keeps the
  bytes of vendored files unchanged on Windows. Licences of third-party components are listed in
  `THIRD_PARTY_NOTICES.md`.
- **Community files:** `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue and pull-request templates, `CONTRIBUTING.md`.

## 29. Accessibility

- Target: WCAG 2.1 AA.
- Every slider has an accessible name (`aria-labelledby` in forms, `aria-label` with the visible text elsewhere:
  `nameSliders`).
- Tab bars (`[role=tablist]`: side panel, multiproxy, start screen, models): `aria-selected`, roving tab index (only the
  active tab receives focus with Tab) and ←/→/Home/End to change tab (`tabsA11y`); side panels are `tabpanel` with
  `aria-labelledby`/`aria-controls`.
- Notices (`#toast`) and the saving and detection status are `role=status` regions (`aria-live=polite`).
- Tooltips (`title`) are used as accessible names only for buttons without text (icons, ☾, ✕); elsewhere the name is
  the visible text (criterion 2.5.3).
- Single-key shortcuts can be turned off in Help (`localStorage ichantool.keys`, criterion 2.1.4); Ctrl/⌘+Z, Esc,
  Delete and the arrows stay active.
- Colours have contrast ≥ 4.5:1 for text and ≥ 3:1 for control borders in both themes (light and dark).
- Touch screens (`pointer: coarse`): buttons and tabs ≥ 36 px, checkboxes 20 px.
- The interface is available in Spanish and English.

## 30. Training project, help cards and guided tour

- **Synthetic training project** (`tools/make_tutorial.py`, seed 2026; `examples/tutorial/`, available from a copy of
  the repository): 7 fictitious cores placed at random (±0.8°) around 7 marine areas of the Mediterranean; positions on
  land are rejected with the Natural Earth polygons (point-in-polygon test). Sedimentation rate 12–30 cm/ka; age model
  of 6 points with rate ±25 %; length = min(900, 40 · rate) cm; sampling every 2 cm (TOC, CaCO3, SST, δ18O and
  low-O2 benthic foraminifera every 10 cm). **These are not geological data.**
- **Common signal:** a cold index `c` (0 warm – 1 cold): Holocene 0.05; YD 0.75; B-A 0.3; HS1 0.95; LGM 0.85; HS2 1.0;
  HS3 0.95; otherwise 0.55. Organic layer `o` = 1 (east, lon > 15°, 6–10 ka) or 0.6 (west, 8–14 ka). Turbidites (2–4
  beds of 4–20 cm, `u`) and tephras (3.6 and 39 ka in the Tyrrhenian, Ionian and Aegean, 3 cm, `f`). Normal noise ε.
  Examples: Ti/Ca = 0.08 + 0.10c + 0.25u + 0.15f + ε(0.012); Ba/Ti = 0.6 + 2.2o − 0.2u + ε(0.08);
  TOC = 0.4 + (3.0 east | 1.5 west)·o·U(0.8–1.1) + ε(0.08); SST = (21 | 18) − 7c + ε(0.5); bioturbation =
  70 − 50o + ε(6). (Full formulas in the script.)
- **Intervals:** the organic layer is described only in ENT-01, -03, -04 and -07 (the classifier must find it in the
  other three); climatic periods; turbidites and tephras in depth.
- **Synthetic image** of ENT-03 (0–150 cm, 25 px/cm, 200 × 3750 px): matrix with smoothed noise, a dark band at
  60–78 cm and 122 dark traces drawn: *Thalassinoides* (Y-shaped tubes), *Zoophycos* (elongated lenses), *Planolites*
  (small ellipses) and *Chondrites* (dots, mostly at 50–90 cm). Detection: global threshold 105, dark traces, minimum
  area 12 px. When the project is created **one in two** true traces is labelled (the object containing its centre);
  the rest is left for the suggestions.
- **Help cards:** a fixed card at the bottom left with the tip for the current tab (Bioturbation by sub-tab, Core
  column, Data, Multiproxy by sub-tab, Figures). On by default in the training project (`settings.tips`); they are
  turned on or off in Help.
- **Guided tour:** 25 steps; each changes tab if needed, highlights an element (frame and darkened background) and
  shows an explanation with Previous/Next/Exit (also ← → Esc). It starts when the training project is opened, from
  Help, or from a help card (at the corresponding part).

---

# Part IX — Validation and limits

## 31. Validation

### 31.1 Automated tests

**Section-interval reference fixtures.** `tests/fixtures/section-intervals/` holds 44 synthetic cases with the inputs of the
planned engine method `section.intervals/1` and the result of the current JavaScript calculation (format and
comparison rule in its README). `tests/app/interval-fixtures.test.mjs` requires each committed file to be
byte-identical to a regeneration by `tools/make_interval_fixtures.mjs`, checks every file against the input and
result contracts (shapes, contiguous intervals, counts consistent with percentages, no-data rules), and compares
the 20 fractional-boundary cases with `tests/fixtures/fractional-boundaries.json`. They are the target of the Python
implementation; they say nothing about the engine, which does not calculate sections yet.

**Temporary diagnostics.** Node tests cover default-off activation, persisted expiry, redaction, two-file
rotation, queue overflow, independent write failure, bounded reads and atomic export failure. The real
Electron test enables recording through the interface, uses synthetic private-text canaries, rejects foreign
origin control, deliberately crashes a renderer, restarts the process and exports the recovered log. It checks
that error/operation/UI events survive without the canary text or paths, and that stopping/clearing works while
the saved public-core state remains unchanged. Browser/offline backup controls verify that diagnostics stay
hidden without the desktop bridge. Physical power loss and exhaustive native crash coverage are not simulated.

**Desktop model preservation.** Trainer regressions inject preparation/training/evaluation failures, partial
generation copies, partial reference writes and failed reference replacement. Normal `readModel` and model-list
calls, including reopened trainer instances, must retain byte-identical previous ONNX/JSON and matching scores.
Tests cover successful replacement, no-test score reset, cancellation in each phase and between steps, actual
child-process termination, staged/legacy checkpoint resume with pending-best weights, malformed candidates,
path-containing manifests, dotted names and packaging of the model-store module. Training/evaluation subprocess
outputs in these lifecycle tests are deterministic fixtures; they do not run PyTorch or validate ONNX predictions.

**Map and figure presentation validation.** Node regressions compare malformed numeric map fields with
the default SVG exactly, cover injection strings, non-finite values and non-primitive inputs, and verify
numeric strings, zero values and input preservation. The browser composition regression checks the core
column and each of eight figure types sequentially. It waits until the current drawing replaces a sentinel
and requires an SVG before inspecting controls and output for injected elements or event attributes.
Each exported SVG is also parsed and checked, with exact scientific-array preservation. The same regression
runs against the served application and standalone HTML; it does not rely on CSP blocking script execution.

**Shared-analysis validation.** The [fractional-boundary validation](benchmarks/M3.1.3.md) checks both
M0.1 reference cases at 2 and 1.37 cm with an absolute tolerance of 1e-9 and exact BI/ii/missing values.
Shared fixed fixtures cover the 7,450-row public sections, all supported depth units, adjacent representable
interval thicknesses, and default/integer intervals. Row boundaries must match exactly; the half-up rule
is also checked against integer-arithmetic edges at 68.5 rows. Python's explicit `bin_px` path and partial-bin
handling remain covered. Tests of the profiling harness verify cropped/remapped labels, exclusions,
partial bins, disagreement reporting and weighted CPU-sample attribution.

**Experimental Python counting.** The [counterbalanced comparison](benchmarks/M3.1.5.md) records exact
numerical equivalence and measured performance acceptance on the reference workloads for the
[row-counting algorithm](#python-row-counts-and-kernels), now the only one. The
[counting regression tests](../tests/test_count_experiment.py) compare complete results with and without the former variable exactly, including exclusions, absent classes, custom index schemes, fractional/partial bins,
and overlapping-layer fallback. Separate histogram checks cover noncontiguous inputs and bounded scratch.
Performance acceptance is limited to the measured reference workloads; the established per-class
reductions remain the default.

**Exclusion support.** [Python exclusion and batch tests](../tests/test_batch.py) verify the ratio of summed
bioturbated to valid pixels, the minimum-valid no-data rule, exclusion dimensions, manifest exclusions,
`analyze --exclude` and `--label-mask --exclude-value`. [API boundary tests](../tests/test_core.py) also cover
fully excluded intervals, minimum-valid endpoints and exact sparse-class results. The
[program core tests](../tests/app/core.test.mjs) verify that excluded pixels leave the denominator, and the
[shared fractional-boundary fixtures](../tests/fixtures/fractional-boundaries.json) exercise matching Python
and JavaScript boundaries; Python also checks those boundaries with excluded rows. These checks cover the
listed cases; Python has no equivalent of the program's optional `noDataPad` expansion.

**U-Net controller validation.** Node tests check loading defaults and failure semantics, exact binary/scaled
and multiclass probabilities against the scientific tiling engine, tensor input/output names and dimensions,
progress, cache reuse and invalidation across model/ROI/dimensions/scale changes. Browser tests drive normal
file selection and detection in both served and standalone HTML with an injected deterministic ONNX runtime;
they verify exact probability values, unchanged masks/results, replacement and load failure. These tests
verify runtime adaptation and interface wiring, not a trained model's accuracy or a real provider's execution.
The full browser smoke suite also checks current/legacy projects, image storage, saving and figure export.
Storage fallback fault injection uses an isolated empty browser context so it cannot disable OPFS during
the main page's pending image reads.

The program and Python suites are complemented by a browser end-to-end test in the tests workflow and a
desktop end-to-end test in the desktop build workflow (§28). Optional dependency and filesystem-permission
checks may be skipped when the required capability is unavailable; delivery reports record these separately.

- **Python** (`tests/test_core.py`, `tests/test_unet.py`): index tiers, percentages and intervals on hand-computed
  cases, incomplete last interval, multi-class by colour, grey and RGB input, depth and age, the reference image, the
  command line, the old import name `ichantool`, the U-Net (dataset, splitting by core, scores, ONNX prediction and a
  tiny interrupted and resumed training), and the **regression against the reference CSV of version 2.1** (exact match
  of depth, percentage, BI and ii).
- **Program** (`tests/app/*.test.mjs`, Node 22): `core` 13 (the same index and interval cases as in Python,
  exclusions, age model with decimal comma and columns by header, RLE and its validation, CSV), `log` 17 (table
  reading, axes, SVG and CSV of the column, distribution figure), `geo` 15 (multiproxy: catalogues, resampling, rules,
  classifiers, leave-one-core-out and block validation with gap and per-fold scaling, k-means, map), `enhance` 9,
  `unet` 6, `learn` 5 (ichnotaxa, grouped folds, validation scheme, final-test metrics), `vision` 4, `edit` 4
  (scissors, merging of the same ichnotaxon, undo and migration with synthetic overlapping masks), `locmap` 4,
  `overlap` 3 (overlapping traces), `sheet` 3, `interp` 3, `exportio` 3, `plot` 2, `zip` 1, `version` 1 (single
  version) and `v2` 1.
- **Program against version 2.1** (`tests/app/v2.test.mjs`): the program's `rowCounts` and `binRows` are applied to
  the mask of the idealised image decoded with Pillow (`tests/app/fixtures/v2_idealized_masks.json`, a 247 kB RLE
  generated by `tools/make_v2_fixture.py`, which also checks that both grey criteria give the same mask) and must match
  the reference CSV exactly (110 intervals: depth and percentage with a difference < 10⁻⁹, identical BI and ii).
- **Python–program parity of the U-Net rules** through the shared file `tests/fixtures/unet_parity.json`.
- **Browser end-to-end** (`tests/e2e/smoke.mjs`, `npm run e2e`): in headless Chrome it opens the public test core,
  repeats detection (same number of traces), deletes and undoes a trace, saves, reloads and compares traces and pixels
  per section, and repeats the comparison with version 2.1 using Chrome's JPEG decoder (threshold `L < 6`): identical
  BI and ii in every interval and a maximum percentage difference ≤ 0.6 points (0.56 measured). It fails on any page
  error.
- **Desktop end-to-end** (`tests/e2e/desktop.mjs`), described in §28.

### 31.2 Comparison of the program with version 2.1
Idealised reference image (620 × 16,726 px, 0–500 cm), intervals of 150 px, 110 intervals compared.

| Measure | Result |
|---------|--------|
| Depth | identical (difference < 10⁻¹³ cm) |
| BI | 100 % of intervals equal |
| ii | 100 % of intervals equal |
| Percentage | 0 difference with the Pillow-decoded mask; with Chrome's JPEG decoder, maximum 0.56 points and mean 0.13 points |

The percentage difference comes from the JPEG decoder (§3.4), not from the method.

### 31.3 What is not yet validated
- Quality of automatic detection on real core photographs.
- The U-Net: the code is tested (Python/program parity, synthetic data, ONNX Runtime in Python and in the program),
  but **no model has yet been trained on real cores**, so there are no accuracy results.
- Accuracy of the ichnotaxa classifier with real ichnotaxa on independent cores; the final test on reserved cores
  (§18.10) is the tool for measuring it.
- Agreement between users (two people analysing the same core).
- Agreement between automatic indices and experts' visual estimates.
- Multiproxy classification on real cores with an independent, published interpretation.

## 32. Known limitations

1. **2-D:** the exposed surface is measured, not the volume.
2. **Depends on the mask:** the calculation is exact, but the mask is decided by the user or by automatic detection.
3. **Threshold detection** fails when burrow fill and matrix have similar brightness, with very uneven lighting
   (partly corrected by the adaptive threshold) or with traces with diffuse edges.
4. **Colour depends on the camera:** colour descriptors change with lighting and equipment; a model imported from
   another laboratory may perform worse.
5. **Linear scale per section:** expansion or compression of the core within a section is not corrected.
6. **Memory:** about 13 bytes per pixel across layers while a section is in use, plus 8 bytes for native 16-bit RGBA; images of more than about 50 million
   pixels are slow, which is why images are reduced on import (§6.1).
7. **Python exclusions are supplied, not drawn:** boolean arrays, exclusion images and ignored mask labels
   are supported; interactive drawing and `noDataPad` expansion are available only in the program (§25.5).
8. **Local projects:** in the browser, projects live in the browser profile of each computer; clearing browser data
   deletes them. The automatic copy and exported packages protect against this (§23).
9. **Age axis:** the image and series depend on the age model, assumed monotonic; its uncertainty is not propagated.
10. **Multiproxy:** the methods do not account for the autocorrelation of the series nor for the uncertainty of each
    core's age model; interpolated maps are exploratory; k-NN compares each sample with all training samples (slow
    with hundreds of thousands of samples); MDI importance is biased among correlated proxies; everything is computed
    on the user's computer.

## 33. Reproducibility

- Image analysis and the ichnotaxa k-NN are **deterministic**. Every method that uses random numbers (Random Forest,
  neural network, k-means, fold assignment, U-Net data split and training) uses a stored seed, so the same project
  gives the same result; the only exception is a U-Net training that was stopped and resumed (§9.3). Internal
  identifiers of sections and classes are random, but they do not affect any result.
- The project file stores the original images and every parameter used (enhancement, detection, counting options,
  interval thickness, age model, classifier definitions and seeds), so opening it gives the same results. Multiproxy
  models are retrained with their seed when the project opens.
- Every exported CSV starts with lines recording the program version, the project and the settings (§24.1).
- The vision model is pinned to a commit and a SHA-256, and the hash of the file actually used is stored (§12.6).
- Running the tests:

```bash
pip install -e ".[dev]" && pytest      # Python package
npm test                               # program (Node 22)
python3 -m http.server 8765 &          # then, with puppeteer-core installed:
node tests/e2e/smoke.mjs               # browser end-to-end test
```

---

## References

- Cressie, N. (1985). Fitting variogram models by weighted least squares. *Mathematical Geology* 17, 563–586.
- Di Martino, A., Carlini, G., Castellani, G., Remondini, D., Amorosi, A. (2023). Sediment core analysis using
  artificial intelligence. *Scientific Reports* 13, 20409.
- Dorador, J., Rodríguez-Tovar, F.J. (2014). Quantitative estimation of bioturbation based on digital image analysis.
  *Marine Geology* 349, 55–60.
- Dorador, J., Rodríguez-Tovar, F.J. (2018). High-resolution image treatment in ichnological core analysis: Initial
  steps, advances and prospects. *Earth-Science Reviews* 177, 226–237.
- Dorador, J., Rodríguez-Tovar, F.J., IODP Expedition 339 Scientists (2014). Digital image treatment applied to
  ichnological analysis of marine core sediments. *Facies* 60, 39–44. https://doi.org/10.1007/s10347-013-0383-z
- Droser, M.L., Bottjer, D.J. (1986). A semiquantitative field classification of ichnofabric. *Journal of
  Sedimentary Petrology* 56, 558–559.
- Gonzalez, R.C., Woods, R.E. (2018). *Digital Image Processing*, 4th ed. Pearson.
- Hu, M.-K. (1962). Visual pattern recognition by moment invariants. *IRE Transactions on Information Theory* 8,
  179–187.
- Kikuchi, K., Naruse, H. (2024). Abundance of trace fossil *Phycosiphon incertum* in core sections measured using a
  convolutional neural network. *Sedimentary Geology* 461, 106570. https://doi.org/10.1016/j.sedgeo.2023.106570
- Martrat, B., et al. (2004). Abrupt temperature changes in the Western Mediterranean over the past 250,000 years.
  *Science* 306, 1762–1765.
- Miguez-Salas, O., Dorador, J., Rodríguez-Tovar, F.J. (2019). Introducing Fiji and ICY image processing techniques in
  ichnological research as a tool for sedimentary basin analysis. *Marine Geology* 413, 1–9.
  https://doi.org/10.1016/j.margeo.2019.03.013
- Oquab, M., et al. (2024). DINOv2: Learning robust visual features without supervision. *Transactions on Machine
  Learning Research*.
- Otsu, N. (1979). A threshold selection method from gray-level histograms. *IEEE Transactions on Systems, Man, and
  Cybernetics* 9, 62–66.
- Pebesma, E.J. (2004). Multivariable geostatistics in S: the gstat package. *Computers & Geosciences* 30, 683–691.
- Reineck, H.-E. (1963). Sedimentgefüge im Bereich der südlichen Nordsee. *Abhandlungen der Senckenbergischen
  Naturforschenden Gesellschaft* 505, 1–138.
- Rodríguez-Tovar, F.J., Dorador, J. (2015). Ichnofabric characterization in cores: a method of digital image
  treatment. *Annales Societatis Geologorum Poloniae* 85. https://doi.org/10.14241/asgp.2015.010
- Rodríguez-Tovar, F.J., Miguez-Salas, O., Dorador, J. (2020). Image processing techniques to improve characterization
  of composite ichnofabrics. *Ichnos*. https://doi.org/10.1080/10420940.2020.1744579
- Ronneberger, O., Fischer, P., Brox, T. (2015). U-Net: Convolutional networks for biomedical image segmentation. In:
  *MICCAI 2015*, LNCS 9351, 234–241.
- Serra, J. (1982). *Image Analysis and Mathematical Morphology*. Academic Press.
- Taylor, A.M., Goldring, R. (1993). Description and analysis of bioturbation and ichnofabric. *Journal of the
  Geological Society* 150, 141–148.
- Zuiderveld, K. (1994). Contrast limited adaptive histogram equalization. In: Heckbert, P. (ed.), *Graphics Gems IV*,
  Academic Press, 474–485.
