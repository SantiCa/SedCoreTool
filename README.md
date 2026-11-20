# SedCoreTool

[![Tests](https://github.com/SantiCa/SedCoreTool/actions/workflows/tests.yml/badge.svg)](https://github.com/SantiCa/SedCoreTool/actions/workflows/tests.yml)
[![License: GPL-3.0-or-later](https://img.shields.io/badge/license-GPL--3.0--or--later-blue.svg)](LICENSE)

**SedCoreTool** (*Sediment Core Tool*) quantifies bioturbation and ichnotaxa in sediment-core images and combines them
with any other down-core record — geochemistry, foraminifera, TOC, colour, magnetic susceptibility — and with
described intervals, on a common depth or age axis.

It runs on Windows, macOS and Linux, or in a web browser, and keeps all data on the user's computer. A Python package
with the same analysis definitions is available for scripting and batch processing.

> **Status:** version 0.x, in active development. Version 1.0 will be released when the program is considered
> complete. See the [changelog](CHANGELOG.md).

---

## Features

- **Bioturbation from core images.** Percentage of bioturbated area and of each ichnotaxon per depth interval, with
  the Bioturbation Index (BI) and the ichnofabric index (ii) derived automatically or entered manually.
- **High-resolution TIFF.** Import tiled or stripped TIFF and BigTIFF in supported grayscale or RGB formats.
  Enhancement uses native 16-bit samples for levels and gamma, and the project keeps the original image.
  Images larger than the **maximum size when adding images** (Settings) are reduced to work fluidly; each section's
  resolution can be changed later, and sizes that would not fit in memory are not offered.
  See [working resolution and TIFF limits](docs/TECHNICAL_DOCUMENTATION.md#61-working-resolution).
- **Assisted segmentation.** Image enhancement (including published protocols), automatic detection of candidate
  traces, drawing and editing tools, an exclusion layer for cracks, voids and samples, and optional learned
  segmentation (U-Net).
- **Ichnotaxa identification.** A classifier learns from the traces you label and suggests the ichnotaxon of the
  rest, rejecting shapes unlike any example; you review every suggestion.
- **Core column.** All sections of a core on one depth or age axis, with images, traces, indices and external records.
- **Multiproxy analysis.** Numerical records and described intervals of many cores; user-defined classifiers
  (random forest, neural network, k-nearest neighbours, naive Bayes, k-means) validated by leaving whole cores out;
  maps by age window with several interpolation methods and projections.
- **Publication figures.** Core column, ichnotaxa distribution, representative traces, core sections and core
  location maps, as SVG, PNG or JPEG, with editable colours, axes and labels.
  Whole-core, core-column and ichnotaxa distribution plots can combine separate, stacked or overlaid abundances,
  symmetric curves, adjustable opacity, percentage labels and symbols or names at manual presence marks.
- **Reproducible and shareable.** Every parameter is stored in the project together with the original images;
  exported tables record the version and settings used. Projects can be shared as a single file or through a shared
  folder, with comments.

## Installation

### The program

Download the installer for your system from the [latest release](../../releases/latest):

| System | File |
|---|---|
| Windows 10/11 (x64) | `SedCoreTool-V0.<n>-windows-setup.exe`, or `…-windows-portable.zip` (no installation: unzip to a folder and run `SedCoreTool.exe`) |
| macOS 13 or later (Intel and Apple Silicon) | `SedCoreTool-V0.<n>-mac-universal.dmg` |
| Linux (x64) | `SedCoreTool-V0.<n>-linux-x86_64.AppImage` or `…-linux-amd64.deb` |
| Any system, in a browser | `SedCoreTool_V0.<n>.html` — a single file that opens with a double click, offline |

The installers are not code-signed: on Windows choose *More info → Run anyway* if SmartScreen appears; on macOS open
the program the first time with right-click → *Open*. To update, install the new version over the old one; projects
are kept. Each release includes `SHA256SUMS.txt` and `RELEASE_MANIFEST.json` to verify the downloads.

The program can also be run from a copy of this repository: start a local server (`python3 -m http.server`) and
open `http://localhost:8000/app/`.

### The Python package

```bash
pip install "sedcoretool @ git+https://github.com/SantiCa/SedCoreTool.git"
# optional extras: excel (Excel export), plot (matplotlib), unet (U-Net training)
pip install "sedcoretool[excel,plot] @ git+https://github.com/SantiCa/SedCoreTool.git"
```

Requires Python 3.10 or later. The package is not on PyPI yet.

## Which part do I need?

| | **The program** | **The Python package `sedcoretool`** |
|---|---|---|
| Starts from | Your core photographs | A **mask**: an image in which bioturbation is already marked (painted, colour-coded per ichnotaxon, exported from the program, or predicted by a U-Net) |
| Does | Everything listed under *Features* | Turns masks into depth or age series of bioturbation %, % per ichnotaxon, BI and ii; trains and evaluates U-Net models |
| For | Anyone analysing cores | Scripted and batch processing |

Most users only need the program. The desktop program uses the Python package behind the scenes when it trains a
U-Net on the computer.

## Quick start (program)

1. **Create a project** and add the images of a core, one per section, with the top and bottom depth of each.
   Large images are reduced for working; the original file is always kept. If an opened section shows a depth
   warning, correct its depth values or unit before using its interval results.
2. **Mark the bioturbation:** enhance the image, detect candidate traces or draw them, and exclude zones that must not
   be counted. Intervals with too few valid pixels are reported as *no data*, never as 0.
   Use **Undo** (Ctrl+Z or ⌘Z) and **Redo** (Ctrl+Y, Ctrl+Shift+Z or ⌘Shift+Z) in the image toolbar.
   Making a new edit after undoing clears Redo. Reopening a project starts with an empty editing history.
3. **Assign ichnotaxa** to some traces; the program suggests the rest, and you accept or correct the suggestions.
4. **Read the results** per interval (thickness in cm): bioturbation %, % per ichnotaxon, BI and ii. Add an age model
   to work in age.
5. **Combine and interpret** in the *Core column*, *Data* and *Multiproxy* modes, and prepare figures in *Figures*.
   In the Data sheet, **Visible rows only** limits rendering while you scroll. It is on by default
   and the checkbox applies only to the current session. Turn it off to return to the previous table; CSV exports always include
   every selected row. Active text selections retain their rows until the selection is cleared.
   In Multiproxy, collapse *Numeric variables used* to free space, drag the edge of the name column in
   *Interval families* to resize it, and use *Column order and visibility* in *Curves* to reorder or hide tracks.
   Double-click the name column handle to restore the automatic width. Each multiproxy log
   figure can choose its own proxies. In *Across projects*, select entire projects for an analysis and set
   site map colours and symbols by project or core.
   For a proxy map, choose *Map* → *Value of a proxy*, expand *Interpolation and colour scale* and click
   **Cover visible sea (IDW)**. Adjust the map frame to include the sea area you want to show. Values outside
   the core perimeter are extrapolated; the frame does not define a geological basin boundary. Tick
   **Only inside the outline of the cores** to restrict the map again. The same control is available in
   *Across projects*.
6. **Save and share:** projects are saved automatically on your computer. *Export this project (with images)* creates
   a `.sedcoretool` file that opens on any system; an automatic copy can be kept in a synchronised folder.
   If saving fails, the last complete save is preserved and your pending changes stay open. Use **Retry save**
   before opening another project, or export the current project to keep a separate copy. If the folder copy fails,
   use **Reactivate automatic backup** to retry it.
   If permission cannot be restored, use **Choose automatic backup folder…** to select the folder again.
   In the desktop program, choose a dedicated subfolder if a system folder is rejected. Slow folder copies
   run in the background after the local save, so you can continue navigating or export a project.
   In the desktop program with the scientific engine on, the folder copy also holds the masks of large (tiled) sections;
   opening the project folder on another computer restores them, with the image when the project keeps its own copy (otherwise locate the
   image there). When the folder keeps a history, **Open project folder** asks whether to open the last save or a given day.
   With the engine on, an exported `.sedcoretool` package also carries large sections (and, if you agree, the original images the project
   keeps); it may exceed 4 GB.
   A project with an invalid analysis region or broken mask references opens for inspection, with a warning in
   the affected section. Edits are temporary and a project export keeps the original data.

The built-in help and guided tour explain each step. The downloads contain no sample data.

To investigate a desktop failure, open the project screen and expand **Temporary diagnostics**. Enable
**Record actions and failures for seven days**, then work normally. If the program hangs, restart it and
use **Export diagnostic log…** to save a `.jsonl` file for inspection. Recording is off by default, has a
visible indicator when active and stops after seven days. Untick the option to stop sooner, or use
**Stop and delete log**. The log stays on your computer, retains at most 4 MiB of recent events and excludes
typed text, names, paths, images and project contents. No automatic upload occurs. See the
[diagnostic scope and limits](docs/TECHNICAL_DOCUMENTATION.md#261-temporary-operating-diagnostics).

In the **Sections** panel, **Optimised navigation preview** starts enabled and uses a separate thumbnail
cache for the section navigator. Disable it to use the previous renderer for the current session; reloading
enables it again. This display choice is not saved in projects. See the
[promotion checks and limits](docs/benchmarks/M2.2.4.md).

In **Figures**, use **Ichnotaxa in the charts** to choose abundance shapes and occurrences independently.
For names at manually identified positions, select **Names only** and **Manual marks only**; add bars or
symmetric curves and percentage labels as needed. Opacity 100% is opaque. Figure tabs keep their own choices.
The same controls are available in the core-column style panel; presence marks retain their depth or age and
do not supply a measured abundance. See the [figure presentation methods](docs/TECHNICAL_DOCUMENTATION.md#2031-ichnotaxon-presentation).

For a **Multiproxy log** figure, select the core, numeric variables and core tracks, then add ichnotaxa with
the same presentation controls. Use **Column order and visibility** to mix taxon, proxy, index and interval
tracks in the desired order. Height, window, widths, scales and colours belong to that figure tab. Reset the
composition to follow the Multiproxy view again; the analysis settings and other figures remain unchanged.
Use the figure's **Vertical axis** and image controls to select depth or age, panels, overlays and excluded
zones independently of Multiproxy and the core column. Age images require the selected core's age model.

In **Multiproxy log**, **Core column** and **Whole interpreted core** figures, open **Event shading in proxy
tracks** and enable shading. Expand each family or computed classification and select **Use this family or
classification**; you can combine more than two sources. Set each source's opacity and class colours, then
choose **Whole track background** or **Only the area under the curve**. Multiple sources can blend or use
separate strips. These choices belong to that figure type and tab; the original classes and measurements stay
unchanged. **Restore original colours** resets a source's colour overrides. Hide the separate event columns
with **Column order and visibility** if you want to show events only in the proxies. SVG/PNG keep the shading
and its legend. See the [event shading methods](docs/TECHNICAL_DOCUMENTATION.md#2061-event-shading-in-proxy-tracks).

**Whole interpreted core** and **Core column** figures also keep their own tracks, records, axes, colours,
widths and image options. Distribution and section figures keep their own style and depth window. Settings
are independent for each figure type and tab; **Restore inherited presentation** removes that type's
presentation override. Existing projects inherit their previous presentation until you edit these controls.
Malformed numeric map appearance settings fall back to their defaults when drawing or exporting figures;
the project's measurements are preserved.

## Quick start (Python package)

```bash
# image with bioturbation painted black; top and bottom of the image at 0 and 500 cm
sedcoretool analyze core.png --top 0 --bottom 500 --units cm --bin-px 100 -o core.csv

# colour-coded mask, e.g. the *_mask.png and *_palette.json exported by the program
sedcoretool analyze core_mask.png --top 0 --bottom 500 --palette palette.json --bin-cm 1 -o core.xlsx

# several sections and cores: list the images, fill in top/bottom, then run them all (CSV, Excel or LAS)
sedcoretool manifest scans/ -o scans/sections.csv
sedcoretool batch scans/sections.csv --palette palette.json --bin-cm 1 -o results.las
```

An exclusion image of the same size (white = excluded: cracks, gaps, samples) can be given with `--exclude`, or as
the `exclude` column of the manifest. The CLI accepts finite `--min-valid` fractions from 0 to 1, inclusive.
When filling in a generated manifest, keep its text cells and any `__sedcoretool_csv_escape__` column intact;
edit `top` and `bottom` as numbers. If using a spreadsheet, import identifier/path columns as literal text
and check that saving preserves the leading apostrophes and the comma-separated UTF-8 CSV. Literal names such
as `NA` and `NULL` stay text; empty optional cells use the documented defaults. To change names or paths in a
marked row, follow the [manifest editing rules](docs/TECHNICAL_DOCUMENTATION.md#2561-manifest-text-encoding-and-editing).
Multi-core LAS exports require distinct filenames and unused destinations. If core names collide after
normalisation, rename the cores or export them separately. Use a different output prefix if a destination exists.

```python
from sedcoretool import analyze_mask, load_image, mask_from_palette

mask, names = mask_from_palette(load_image("core_mask.png", "RGB"), {"Zoophycos": "#ff0000", "Chondrites": "#0000ff"})
section = analyze_mask(mask, top=0, bottom=500, units="cm", bin_cm=1, class_names=names)
section.add_age(model_depth=[0, 500], model_age=[0, 40_000])     # optional age model
section.data.to_csv("core.csv", index=False)                     # depth, bioturbation_pct, <class>_pct, BI, ii, age
```

Python palettes and `--palette` JSON files accept short colours such as `#f00`, full colours such as `#ff0000`,
and RGB triplets such as `[255, 0, 0]`. Hexadecimal strings may omit `#` and include surrounding whitespace;
malformed strings report the class to correct. See the [palette input contract](docs/TECHNICAL_DOCUMENTATION.md#palette-colour-inputs).

CSV and Excel results escape text that spreadsheet programs could interpret as formulas. Project and U-Net ZIP
imports apply the [project ZIP limits](docs/TECHNICAL_DOCUMENTATION.md#231-project-packages-sedcoretool) and [U-Net ZIP limits](docs/TECHNICAL_DOCUMENTATION.md#92-training-data-and-training-python-package).
If a project package reports a CRC mismatch, use an intact copy of the package.

Centimetre intervals use the same row boundaries in Python and the application. When updating Python from
V0.120 or earlier, rerun analyses with fractional pixel intervals: corrected half-row boundaries can change
percentages and indices. See the [interval definition](docs/TECHNICAL_DOCUMENTATION.md#32-per-interval).

Use lossless formats (PNG, TIFF) for masks. The complete API, command line and U-Net commands are described in the
[technical documentation](docs/TECHNICAL_DOCUMENTATION.md#25-the-sedcoretool-python-package).
Python image and mask loading reports an error before decoding if a file exceeds its estimated 768 MiB
[per-load memory budget](docs/TECHNICAL_DOCUMENTATION.md#image-loading-budget).
Python analysis accepts integer label IDs from 0 to 255 and up to 255 classes. Use `--exclude-value` to
mark an ignore value in a CLI label mask.

**Learned segmentation (experimental).** A U-Net can be trained on the traces reviewed in the program — from the
desktop program (*Detection → U-Net → Train on this computer…*) or with `sedcoretool unet` — and then used as a
detection method. No model trained on real cores is distributed yet.

Desktop retraining keeps the last working model available until training and any required test-core evaluation
finish successfully. **Resume** continues the pending checkpoint; starting a fresh run replaces that pending
attempt. Use the model list to load the active version. See [desktop model storage and recovery](docs/TECHNICAL_DOCUMENTATION.md#93-training-on-the-computer-desktop-program).

Training checks GPU memory and continues on CPU if the accelerator is unavailable or runs out of memory.
Use `sedcoretool unet train DATA OUT --cpu-only` or `train(..., cpu_only=True)` to train on CPU without
probing CUDA or Metal. The `predict` and `evaluate` subcommands also accept `--cpu-only`.

When preparing training data from the command line, choose a new or empty output directory for each preparation.
Preparation assigns portable tile filenames and requires unique core/section identifier pairs. If a duplicate
is reported, correct the identifiers before retrying. Linked paths inside the output folder are refused.
Existing prepared datasets remain usable; keep the same prepared folder when resuming a training run.
While any core is reserved for a final test, the ichnotaxon classifier excludes all library and other-project
examples, whose independence cannot be established for older model files.

## Privacy

Images and data never leave the computer. The program connects to the internet only for optional downloads: map
backgrounds (Esri, GEBCO; only after you allow it, since the map extent is sent), the vision model (Hugging Face) and,
in the browser version, a few libraries. See [SECURITY.md](SECURITY.md).

## Documentation

| Document | Content |
|----------|---------|
| [docs/TECHNICAL_DOCUMENTATION.md](docs/TECHNICAL_DOCUMENTATION.md) | How every part works: methods, formulas, default values, file formats, validation and limitations |
| [CHANGELOG.md](CHANGELOG.md) | Changes in each version |
| [docs/roadmap.md](docs/roadmap.md) | Current status and next tasks ([later milestones](docs/roadmap-future.md), [finished tasks](docs/roadmap-history.md)) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Structure of the code: layers, what may import what, how a scientific method is added |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Commands to set up, run, test, package and measure |
| [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md) | How to contribute; working rules for contributors and AI coding assistants |
| [paper/](paper/) | Software paper (in preparation) |

For reproducible measurements of large-image opening and navigation, see the
[benchmark command, results and limits](docs/benchmarks/M2.2.md). It uses public and deterministic synthetic
projects and verifies edits, saved reloads and every pixel of the exported mask.

## Repository layout

```
app/              the program (HTML and JavaScript ES modules; vendor/ = bundled libraries and fonts)
desktop/          desktop packaging (Electron) for Windows, macOS and Linux
src/sedcoretool/  Python package (src/ichantool/ is an alias for the former name)
tests/            Python, program and end-to-end tests, including the regression against version 2.1
examples/         public example data: IODP U1385I-1H core, idealised core, multiproxy demo, training project
tools/            offline build, version sync, release and synthetic-data scripts
docs/             technical documentation, architecture, development guide, roadmap, measured evidence
paper/            software paper
legacy/           original version 2.1 (2019), unchanged
```

### Experimental local engine (developers)

The engine experiment is desktop-only and off by default. It currently runs a buffer-digest diagnostic;
application scientific calculations still follow the current path. Desktop builds include a verified Python
runtime. For development, prepare the native runtime once with a build-time Python 3.12 and pip:

```powershell
cd desktop
npm.cmd run prepare-runtime
$env:SEDCORETOOL_ENGINE_EXPERIMENT = '1'
npm.cmd start
```

Preparation downloads only the pinned interpreter/wheels; `npm.cmd run prepare-runtime -- --offline` rebuilds
from the verified cache. Installed-program startup performs no runtime download or training install and uses
the included interpreter. Inspect `await window.corantoolDesktop.engine.status()` in the developer console.
To return to normal launch, close the program and remove `SEDCORETOOL_ENGINE_EXPERIMENT`. An absolute
`SEDCORETOOL_ENGINE_PYTHON` override remains available only for unverified source-development experiments;
packaged applications ignore it. Clean-machine and other-platform acceptance remain pending. See
[implementation and limits](docs/TECHNICAL_DOCUMENTATION.md#263-bundled-scientific-runtime).

## History and earlier names

SedCoreTool started in 2019 as **IchAnTool**, a script that turned hand-segmented core images into bioturbation series.
It was renamed **CorAnTool** in 2026 and **SedCoreTool** from version 0.52. Files and code written under the earlier
names keep working: older `.corantool` project packages open, and the Python package can still be imported as
`ichantool`. Version 2.1 is kept unchanged in [`legacy/`](legacy/), archived in Zenodo
([doi:10.5281/zenodo.3518837](https://doi.org/10.5281/zenodo.3518837)) and tagged `v2.1` in this repository. The former
repository addresses redirect here.

## Citing

If you use SedCoreTool, please cite the version you used; GitHub shows the citation under *Cite this repository*
(from [CITATION.cff](CITATION.cff)).

## License

GPL-3.0-or-later — see [LICENSE](LICENSE). Bundled libraries and fonts keep their own licences; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The Python package counts pixels with bounded multi-row histograms (`sedcoretool.kernels`), which met the measured
performance targets on the public and synthetic reference cores with exact scientific results. The former opt-in
variable `SEDCORETOOL_EXPERIMENTAL_COUNTS` is still accepted and has no effect.
See the [measurements and limitations](docs/benchmarks/M3.1.5.md).
