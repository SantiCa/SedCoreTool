# Changelog

All notable changes to SedCoreTool are listed here, newest first.

**Versioning.** Each delivery has a number `V0.<n>`, shown in the program and used as the version `0.<n>.0` of the
program, the Python package and the desktop installers. Version 1.0 will be released when the program is considered
complete. Before 5 November 2026, development builds were numbered V1–V33; V33 became V0.1.

Technical details of every method are in [docs/TECHNICAL_DOCUMENTATION.md](docs/TECHNICAL_DOCUMENTATION.md).

---

## Unreleased

### For users

- Fixed: «Multiproxy log of a core» (and the Multiproxy Logs tab) now shows the core image reliably on both Depth and Age axes, including cores with imported ages, cores whose section and age-model units differ from core units, non-active cores with photos, and after re-enabling the image track.
- Fixed: laying out figures (such as «Whole interpreted core») or the core column on a core with many high-resolution sections no longer makes the core photos appear and disappear continuously.

### Internal

- Card M8.5.6b: sped up coordinator `f64le` finiteness verification and replaced polling waits with immediate worker/mask wakeup without changing the wire protocol or validation; all `core.ages/1` matched-timing cases up to 100,000 rows now meet the 150 ms Y9 target on Windows (`docs/validation/M8.5.6b-ages-windows.json`), unblocking M8.5.8.
- Card M8.5.7: moved a core's table merge (`coreImageParts` and `refreshCoreData`) out of `app/js/app.js` into the pure module `app/js/coredata.js`, with unit tests and `APP_JS_CEILING` lowered to 4,607 lines.
- Card M8.5.6: added the `ages` matched-timing benchmark for `core.ages/1` and recorded its Windows evidence (`docs/validation/M8.5.6-ages-windows.json`); parity is exact, while the 100,000-row first and one-depth-changed cases exceed the 150 ms Y9 target, so M8.5.8 waits for a maintainer decision.
- Card Q20 written (not done): the start-failure test of the engine client can classify a failure before the exit event arrives.

## V0.153 — 2026-11-22

### For users

- Data tab (card Q10): editing a very small value no longer rounds it to 6 decimals, long tables scroll to the end without "Show more", and a manual column whose name contains `|` deletes cleanly. An engine refresh no longer interrupts a cell being edited, the log CSV waits for pending analyses, a missing record is never deleted in its place, large PNG figure exports are more robust, and a drag interrupted by the system no longer stays stuck.
- Fixed: while you drew on a section, the image could jump about 19 pixels when the save message at the top changed length, because a mode button's name wrapped onto two lines; the top bar now keeps its height.
- Large (tiled) sections can now be split into parts along mask-tile boundaries, either from the section panel or directly from the warning shown when a section is too dense for its objects' measurements. After a confirmation listing each part and its depth range, the parts replace the original without copying the image and keep every object (with its class and pixels), continuous depths, marks and interval counts; if a split fails half-way, the original section and its saved version stay intact.
- The message shown when a large (tiled) section is too dense for its objects' measurements no longer says that opening it again helps: it says into how many parts the section would have to be split for the measurements to fit, or, when even 8 parts would not be enough, that the masks are probably noise from the detection.
- Large (tiled) sections whose masks hold an extreme number of objects in every tile no longer fill the memory with the objects' measurements: beyond 256 MiB the measurements (size, area, shape, depth) say «not available», the objects table keeps their rows with empty cells, and deleting, merging or cutting objects in that section is refused with the reason (opening the section again computes the measurements again, and with the same masks they go beyond the limit again). The interval table is not affected. Real core images stay far below this limit.
- Desktop program with the engine on: very long editing sessions of large (tiled) sections no longer stop the engine after 65,536 requests. Saving, cleaning up, importing or exporting stored masks no longer holds up the display of tiles or a cancel. On Windows, writing a stored mask now waits briefly when an antivirus or the search indexer holds the file, instead of failing, and a full disk is reported as such. A CMYK image (TIFF or JPEG) is now refused with a message instead of being shown with wrong colours.
- Fixed, when a project has several cores: a save made while the core on screen had no sections now also records the saved state of the large (tiled) sections of the other cores, and the automatic copy in a project folder is no longer skipped. Deleting a section now marks the project as unsaved. A large section opened again repaints its sharp tiles by itself, without moving the view. Closing or switching projects now stops the background work of the old project (mask sends, statistics, engine analyses waiting their turn) and frees its tiles and caches. «Best preset» and «Apply to all» no longer change large sections, whose tiles show the original pixels. The busy sign stays visible while any operation still runs.
- Opening a project or a table from someone else is safer: names, identifiers, units, settings, plot colours and example images in the file can no longer add elements to the program's pages or run code; they are shown as plain text, and an example image that is not a PNG, JPEG or WebP picture is left out.
- Desktop program, safer stored masks of large (tiled) sections: a save no longer removes the versions stored before the program was started (they go when the project is deleted), and deleting a project saved in an earlier session asks for confirmation in the program's own window, also when it was opened in this session. Starting, checking and cancelling a U-Net training no longer freeze the program, and cancelling stops every process the training started.
- Fixed: opening a large (tiled) section whose masks hold very many objects in every row could fill the memory of the program for minutes and then fail. The interval table of such a section is not computed (as before, and the program says so), and its counts no longer take memory.
- «Export this project» and the full backup now include large (tiled) sections in the desktop program with the engine on: their masks go into the `.sedcoretool` package, and the program asks whether to add the original images the project keeps, telling you their size. Opening the package on another computer restores them exactly. Packages can now exceed 4 GB (ZIP64); a package that fitted before is written exactly as before.
- Fixed: opening a project while the previous save was still waiting for a large (tiled) section could write the half-opened project over the saved one, leaving it with missing sections. Such a save is now dropped; the last complete save stays.
- The automatic copy in a project folder now includes the masks of large (tiled) sections, in the desktop program with the engine on: each piece is written once and checked after writing, so later copies only add what changed. Opening that folder on another computer restores the masks exactly; a missing or damaged piece is named and that section opens locked instead of with part of its masks. If the project keeps its own copy of the image, that copy is saved in the folder once (you are told its size first) and restored with the project, so the section opens with its image on the other computer; otherwise it is shown grey until you locate the image.
- «Open project folder» can open an older day: when the folder keeps a history, it asks whether to open the last save or the last state of a given day, with the masks of large sections as they were that day.
- Reopening a saved large (tiled) section no longer reads all its stored tiles when the project was saved by this version: the overview, the interval table and the statistics of the objects are read from a small file kept next to the saved masks. If that file is missing or does not pass its checks, the section opens as before, only slower.
- Figures: the PNG export can save at 300 or 600 dpi (new «PNG resolution» selector); the file then declares that resolution, so an image viewer or a journal's upload check reads it. «×2 (screen)» is the same export as before.
- Plots of the Data tab with very long series draw quickly: the screen shows the first, lowest, highest and last point of each pixel column, which looks the same; SVG and PNG exports keep every point.
- Very long series (more than about 100,000 values in a record, an age model, a chart or a spreadsheet column) no longer stop a chart, a map or a figure with an error: their lowest and highest values are now found without the limit on function arguments of the browser.
- A backup or a package of a project with large "tiled" sections now says, before it is written, which of them it leaves out (their masks are only on this computer for now), and names them in the file.
- Units: adding an external record now asks the unit of its depth or age column (proposed from the header, such as "mbsf" for metres) and converts it to the core's unit; a record that then lies wholly outside the core is reported. Changing a section's unit now asks whether to convert its depths (100–200 cm become 1–2 m) or only correct the label. Joining the same core from several projects converts their depths and ages to the units of the first one and says how many values disagreed.
- Importing a table now shows «How the file was read» in the import dialog: what was changed, with counts, the first rows as read, the choice of sheet in a workbook and of how values below a detection limit are read (empty, half the limit or the limit). An external record just imported can be removed with «Undo import».
- Tables of records read more of what laboratories write: -999, -999.25 and -9999 are now empty instead of values; values below a detection limit ("<0.01", "bdl", "n.d.") are empty and counted; a title or notes before the table are skipped; "0.500" in a file with decimal commas is no longer read as 500, and a column where "1,250" could be 1.25 or 1250 is named in the message; repeated column names are kept apart; files saved as "Unicode text" open; spreadsheets give their stored numbers instead of the rounded text a cell shows. One message after import says what was changed, with counts.

### Internal

- Card M8.5.5: the engine computes `core.ages/1` (ages of a core's depths from its age model) through `method.run`; the interface does not use it yet.
- Card M8.5.4: contract §9.8 specifies the engine method `core.ages/1`, with reference fixtures made by today's JavaScript.
- Card M8.5.3: the page can request `method.run` through the desktop bridge and decode its columns and table outputs; no interface uses it yet.
- Card M8.5.2: the engine runs `method.run` (contract §9: scopes, priorities, superseding, table outputs, summary), tested with probe methods only; no production method or client uses it yet.
- Card M8.5.1: the engine coordinator finds each request's operation in a table instead of a chain of conditions; nothing changes on the wire.
- Card A1 (design): methods of section, core and project scope through one engine operation `method.run` (contract §9), with the implementing cards M8.5.1-M8.5.15 and decisions Y1-Y11 for the maintainer; no code changes.
- Card M8.4.11: milestone gate of part B of M8.4 met on GitHub (Windows, macOS, Linux); the memory and timing of resident section pixels repeated on the final commit and stored in `docs/validation/M8.4.11-pixels-windows.json`.
- Card M8.4.10: record tables (named numeric columns with missing values) can be kept in the engine in one columnar format, built by the new pure module `tablesnapshot.js`, sent with `engineclient.js::ensureTable` under a table budget of their own and checked by `methods/validation.py::table`; no scientific method changes. Details in the card's *As built*.
- Card Q15: the tiled-sections desktop test waits for a section's first view before probing it and checks that the view was kept, which removes a timing failure seen on macOS.
- Card Q14: `tiled-sections.mjs` no longer waits forever after reopening the split parts (it saves first, as closing the project would) and now reports a view that moves during a scripted stroke; a Node test pins down when a reopened tiled section counts as sent.
- Card M8.4.9: the engine can keep the working pixels of small sections (8-bit, and 16-bit through the new `u16le` buffer type) under a pixel identity, with a 192 MiB budget of its own, through a shared registry of resident buffers (`residentstore.js`, `sectionpixels.js`); no method uses them yet. The 512 MiB session budget stays, by measurement. Details in the card's *As built*.
- Card M8.4.43: splitting a tiled section into row-windowed parts (`MaskStore.slice_rows`, `mask.slice`, `tiledsplit.js`, `tiledsplitui.js`), reusing tile blobs without re-encoding, filtering object and stack tables, and replacing the section atomically after confirmation (X1–X4); new Python, Node and desktop E2E tests. Details in the card's *As built*.
- Card Q13: a mask round of a large section refused because the engine was busy no longer leaves a half-sent version in the engine (which made deleting the project leave its folder behind); `desktop/tile-ipc.js`, tests in `tests/app/tile-ipc.test.mjs`.
- Card M8.4.42: a tiled section can cover a row window of its stored image (`tiled.window`; a project with one is saved as format 7, which older builds open read-only); new pure module `tiledrecord.js`; nothing in the interface creates a window yet. Details in the card's *As built*.
- Card M8.4.41: estimate of a tiled section's object statistics at the budget trip and the number of parts to split it into (`estimateSectionStatsBytes`, `partsToFitStats` in `tiledit.js`, `MaskTiles.labelledTileCount`); new tests in `tests/app/tiledstatsbudget.test.mjs` and the M8.4.37 block of `tests/e2e/tiled-sections.mjs`. Details in the card's *As built*.
- Card M8.4.19: milestone gate of part C (tile store) met: GitHub checks on Windows, macOS and Linux and the interactive targets of the tiled viewer on Windows (`docs/validation/M8.4.19-*.json`). Details in the card's *As built*.
- Card M8.4.37: memory budget of `TiledObjectStats` (`STATS_BUDGET_BYTES`, 256 MiB) measured with `tools/measure_tiled_stats_memory.mjs` (records in `docs/validation/M8.4.37-*.json`); new tests in `tests/app/tiledstatsbudget.test.mjs` and `tests/e2e/tiled-sections.mjs`. Details in the card's *As built*.
- Card M8.4.40 (decision V): sliding window of request IDs in the engine, mask operations on their own thread, Windows rename retry and disk-full mapping, open staged versions matched by folder, bounded `TileReader` caches, `uploadTable` releases a failed buffer; new `tests/test_store_tiles.py` and tests in the engine and store suites. Details in the card's *As built*.
- Card M8.4.39: the teardown of a closed project, the multi-core save and backup guards, and bounded caches of tiled editing; new tests in `tests/app/lifecycle.test.mjs` and checks in `tests/e2e/tiled-sections.mjs`. Details in the card's *As built*.
- Card Q9: text from projects and tables is escaped wherever it becomes HTML, image URLs of a project are checked (`safeImageURL`, `sanitizeThumbs` in `core.js`), plot colours and sizes are validated in `plot.js`; new tests `tests/app/html-safety.test.mjs` (with a static check of attribute interpolations) and `tests/e2e/html-injection.mjs` (in the smoke test). Details in the card's *As built*.
- Card H9: `tools/check_all.py` runs the full checks one after another and prints one line each (result, count, seconds), with only the tail of a failure and the full output in a log file; the end-to-end tests are options (`--desktop`, `--tiled`, `--smoke`, `--large16`, `--e2e`).
- Card M8.4.38 (decision W): the desktop's store and training channels check who calls them and what they may remove or run; details in the card's *As built*.
- `AGENTS.md`: *Director mode* (21 Nov 2026), the same for every assistant: a session on the most capable model delegates bounded work to smaller models at a stated effort, only when it pays, with one writer at a time. Also: one card per session, a roadmap status of about 30 lines, each fact written once (short changelog bullets, details in the card), authorised runs of several cards with a fresh sub-agent per card, the next card's brief prepared while one is written, decisions asked together, short fixed reports, card references by name rather than line, and two cards in parallel worktrees only with the maintainer's permission for that pair; review in proportion to the risk (every line on critical cards, sampled with an optional fast-tier pre-review otherwise), and broad audits only at milestone gates. The old status block of `docs/roadmap.md` moved verbatim to `docs/roadmap-history.md`; new card H9 (one command for the full checks). Card H8: the records of 54 finished cards moved verbatim from `docs/roadmap.md` to `docs/roadmap-history.md`, one line with a link left in their place (2,693 → 838 lines).
- Third council audit (21 Nov 2026, documents only): runtime frontend and backend code audit added to `docs/roadmap.md` with six new task cards (`M8.4.38` M8.4.34 store-protection bypass and `trainer` IPC hardening, `M8.4.39` frontend project-switch teardown / tiled stale closure / multi-core save-backup & memory leaks, `M8.4.40` engine 65,536-request ceiling / non-blocking store I/O / Windows retry & CMYK guard, `Q9` `innerHTML` XSS sanitization, `Q10` Data-tab edit precision / virtualized table cap / engine-refresh & CSV races / Blob PNG export / `pointercancel`, and `A4` remaining `app.js` decomposition) and decisions U and V waiting for the maintainer.
- Card M8.4.35: a save compares a counter of project replacements (`projectGeneration`, incremented by `resetState`) after waiting for tiled sections and after `putProject`, and writes or cleans up nothing when the project was replaced; a block of `tiled-sections.mjs` opens a project while a save waits and checks the stored project is unchanged. `tiled-sections.mjs` also holds the mask round before its commit with a test-only hook (`beforeCommit` in `tiledsync.js`, null in the program) before it kills the engine, instead of racing it; `reopen()` reports why a section is missing after a reload.
- Card M8.4.36: `TiledRowCounts` drops every histogram and keeps none once they exceed `COUNT_HISTOGRAM_BYTES` (`exceeded`; `markChanged`, `setArea`, `commit` do nothing, `snapshot` is null, `restore` starts again); test in `tests/app/tiledcounts.test.mjs`. The synthetic section of M8.4.18d (7,168 tiles) now opens with the page at about 1 GiB instead of failing at 9.5 GiB.
- Card M8.4.18d, package above 4 GiB: `tools/make_large_mask_version.py` (a synthetic stored version of 7,168 tiles, 4.96 GB) and `tools/check_large_package.mjs` (packaged by the desktop program, 4.97 GB with ZIP64, imported into an empty store identically); `packageBlob` test hook takes a record; evidence `docs/validation/M8.4.18d-large-package-*`. Opening that section fails (card M8.4.36).
- Card M8.4.18d: ZIP64 writer and reader in `zip.js` (`zipParts`; ZIP64 only when a size, offset or count needs it; every 64-bit field checked against the file); `packageTiledSections` and `keptSourceBytes` in `tiledbackup.js`, `packageTiledPlan` in `tiledproject.js`, `packageProjects` carries tiled sections; test hooks `packageBlob`, `restoreFiles`. Tests: `tests/app/zip.test.mjs` (byte-identical classic archive, forced ZIP64, 65,536 members, ten hostile ZIP64 records, a package of 4 GiB + 12 KB written to disk and read back), `tests/app/tiledbackup.test.mjs`, the package round trip in `tests/e2e/tiled-sections.mjs` (and the package made without the engine leaving the section out). `app.js` 4,664 lines before and after.
- Card M8.4.18c step 3: the project's copy of a source in the folder backup (`sourceCopyRead`, `sourceImportBegin`/`Chunk`/`End`/`Abort` in `tile-ipc.js`, pieces of 8 MiB, kept only with its SHA-256; leftover pieces removed at start), `backupSource` and `restoreSource` in `tiledbackup.js`; `folderversion.js` (the day of the history to open); `app.js` 4,666 → 4,664 lines (ceiling lowered). Tests in `tests/app/tile-ipc.test.mjs`, `tests/app/tiledbackup.test.mjs` and the backup block of `tests/e2e/tiled-sections.mjs`.
- Card M8.4.18c (steps 1-2): tiled sections in the folder backup. Engine operations `mask.export` (a stored version's files exactly as stored, each verified) and `mask.import` (blobs verified by decompressing to their name's hash, then the manifest only when every blob it names is stored); `maskExport` and `maskImport` in `tile-ipc.js` and `preload.js`; pure module `tiledbackup.js`; `backupTiledOf` and `restoreTiledOf` in `tiledproject.js`; contract §8.7 ("Backup folder"). Tests: `tests/app/tiledbackup.test.mjs`, `tests/test_engine_masks.py`, `tests/app/engine.test.mjs` (real client), a backup and restore in another profile in `tests/e2e/tiled-sections.mjs`. `app.js` stays at 4,666 lines.
- Card M8.4.34: desktop hardening. Pages of the program carry a script policy without remote origins; navigation and redirects outside the app origin are refused; only `https:`, `http:` and `mailto:` links open outside the program; a project's stored masks are deleted only for a project the page opened, or after the user agrees in a window of the main process for one it only listed; copying never overwrites another project's folder; each mask-store operation has its own engine deadline (30-300 s). Tests: `tests/app/desktop-hardening.test.mjs`, a block in `tests/e2e/desktop.mjs`; SECURITY.md and technical manual §28.
- Card M8.4.29: reopening cache of tiled sections (`tiledcache.js`: format, encode, decode with every check; `mask.derived.put` and `mask.derived.get` in the engine, `mask.retain` removes the files of removed versions; `tile-ipc.js`, `preload.js`, `engine.js`; `TiledRowCounts.snapshot` and `restore`; written after a save and read in `loadTiledSection`); tests `tests/app/tiledcache.test.mjs`, `tests/test_engine_masks.py`, `tests/app/tile-ipc.test.mjs`, the cache scenarios of `tests/e2e/tiled-sections.mjs`; the times in `docs/validation/M8.4.29-reopen-*.json`.
- Card P1: pure modules `figsize.js` (journal presets, `mmToPt`, `pixelsFor`, text/line/raster checks, `panelLabel`, `fitWidths`, Okabe-Ito) and `pngmeta.js` (`withPhys`, `withText`, `readPhys`; CRC from `zip.js`); tests in `tests/app/figsize.test.mjs` and a 600 dpi check in `tests/e2e/figure-composition.mjs`. The figure builders, the default ×2 PNG and the saved fields are unchanged.
- Card M8.4.32: `tests/e2e/tiled-sections.mjs` on GitHub's machines. It waits for the test project to finish loading before adding the large image (the end of the load selected another section, so the pixel probe read a different image), measures the canvas before every stroke (its pane scrolled by about 29 px there, which put the scissors' line inside the trace), and its idle wait includes a wand still reading pixels (`objectsWaiting` in `tiledtools.js`). Failed steps save screenshots, uploaded as a workflow artifact.
- Card Q5 part 2: `plot.js::decimatePerPixel` and `spec.decimate` for the plots of the Data tab (screen only; the exports build the plot again without it); tests in `tests/app/plot.test.mjs` (10^5 points: at most four per pixel column, the same vertical extent as the full drawing, short series unchanged).
- Card Q5 part 1: `minOf` and `maxOf` in `core.js` (exactly `Math.min(...values)` and `Math.max(...values)`, including empty, NaN and -0, for any length) replace the 68 spread calls in 11 modules; `tests/app/extent.test.mjs` compares them with the spread on edge cases and checks a series of 10^6 values, where the spread throws.
- Card M8.4.30 step 4 and checks: `tiledview.js` (`createTiledView`) moved out of `app.js` (4,787 -> 4,666 lines); `tests/app/architecture.test.mjs` checks the pure modules of ARCHITECTURE §3.2 for DOM use and imports of controllers and holds `app.js` at or below 4,666 lines; `tableview.js` is listed as a controller (it uses the DOM).
- Card M8.4.30 step 3: `tiledtools.js` (`createTiledTools`: strokes, undo and redo of tiled edits, wand, lasso, scissors, object operations) moved out of `app.js`.
- Card M8.4.30 step 2: `tiledstate.js` (`createTiledState`: statistics runner, row counts, pixel and mask reads, mask sends) moved out of `app.js`.
- Card M8.4.30 step 1: `tiledproject.js` (`createTiledProject`: reopening, locks, store folder, the store's part of a save) moved out of `app.js` without changing behaviour.
- Card M8.4.33: `projectForExport` returns and writes `left_out`; `tellLeftOut`; page test hooks `exportedProject` and `packageNow`.
- Card M8.4.32: `tiled-sections.mjs` in the Desktop builds workflow on three systems (`findCoordinator` with `ps` outside Windows); `tests/conftest.py::require_pyvips` and `SEDCORETOOL_REQUIRE_PYVIPS=1` in the tests workflow.
- Card Q3: `guessRecordUnit`, `unitFactor`, `rangeOverlaps` and `AGE_YEARS` in `core.js`; `recordSeries` takes a factor; `coremerge.js` (`mergeImp` moved out of `app.js`, with a count of disagreeing values, and `joinCoreTables`); the light copy of a project keeps `ageUnits`.
- Card Q2 (second delivery, the import report): `readTableFile` returns a table that can be read again (`read({sheet, censored})`), `importNotes` and `renderImportReport` in `multiproxy.js`, used by the records and multiproxy import dialogs; «Undo import» for records.
- Card Q2 (first delivery, the readers): `parseTable(text, {missing, censored})` with per-column decimal separators, preamble, missing-value codes, censored values, repeated names and counts; `decodeText` reads UTF-16 with its byte-order mark; `readTableFile` reads spreadsheets with `rawNumbers` and lists every change; `tools/release.sh` finds `export const DELIVERY` and takes `PYTHON` for an interpreter with the test extras.

## V0.152 — 2026-11-20

### For users

- Exported CSV files now keep 15 significant digits: small values such as a mass susceptibility of 1e-8 were written as 0 (numbers were rounded to six decimals); a value that is not a number is now an empty cell instead of the text NaN or Infinity.
- The CSV of the core column now writes each external record as the mean of its samples inside each interval, with their number (a new selector beside the button offers the previous value at the interval centre, which now stays empty across gaps wider than three times the record's usual spacing instead of inventing values). On the age axis it marks intervals where the age model is reversed and says how many intervals lie outside the model (before, they were left out silently).
- Deleting an ichnotaxon now asks first, saying how many traces and predictions in how many cores will become unclassified, and acts on every core of the project (before, only on the open core: the traces of the other cores kept a class that no longer existed). «Restore» under the class list brings it back while the project is open. A project saved with such traces is repaired when it opens, and the program says how many there were.
- Two saves of a project can no longer run at the same time (a save requested during another now waits for it). With large "tiled" sections, a clean-up after a save could delete the masks the program had just stored, if editing and saving overlapped; the edits of that moment could then be missing after reopening. Fixed: the store keeps every version committed since the one the program knows.
- Right after a large "tiled" section is opened, deleting, merging, cutting or reclassifying an object no longer asks you to try again in a minute or two: the program computes that object's part of the section first (the busy indicator shows; Esc cancels) and then does it. An object's area and statistics are no longer shown, or saved, half-computed while the section is being opened.
- Deleting a project now also deletes, on this computer, the stored masks of its large "tiled" sections and the copies of their images. When a project is imported over a local version that has large sections and you keep both, the kept copy now has its own masks and opens as before (before, it could not be opened, and later saves could remove its masks). A large section whose stored masks are missing or damaged now opens locked, without them, instead of preventing the whole project from opening; the rest of the project can be edited and saved.
- A large "tiled" section whose original image was moved can be pointed at the image again ("Locate the image…" in the section's form); only the same image is accepted, checked by its size and SHA-256. The original image can also be copied into the project ("Copy the image into the project", which shows the size and the free space first), so that the project no longer depends on where the file is; the copy is used when the views stored on this computer are gone. While the image is missing, the section's name and depths cannot be changed either.
- Large images opened as "tiled" sections (desktop program, engine experiment) are now saved with the project and reopen with the same masks, objects and interval table. If the engine cannot take the last edits of such a section when the project is saved, the rest of the project is saved, the section keeps its last saved state and you are told. If the original image has been moved and its cached views are gone, the section opens grey, with its masks and table, and cannot be edited (locating the image comes next). Opened without the engine, such a section is shown as a placeholder and kept unchanged. Folder backups and packages do not include them yet.
- A large image opened as a "tiled" section now has its interval table: bioturbation, class percentages and the indices are counted on the full-resolution masks, tile by tile, and equal what the same masks give on an image held whole. In the measurements an edit updates the table in under 10 ms and changing the interval size in about 20 ms, on an image as tall as 349,526 rows; changing a class or the interval size reads no tile. Before, such a section showed no table.
- **Fixed:** a 16-bit TIFF image larger than about 28 megapixels (for example 2,249 × 14,020 at full resolution) made the window stop answering as soon as it was decoded: when it was added, or when the Core log or another view needed it again. Such images now open, and 16-bit images of any size decode several times faster (126 million samples converted in 0.09 s instead of about 6 s).
- **Fixed:** choosing full resolution for a very large image (or adding it with "No reduction") could make the window go blank because it needed more memory than the program has. Sizes that do not fit are now disabled in "Resolution of this section" and refused with a message, and a new image is reduced just enough to fit, with a message that says so. The two resolution controls have clearer names: **Maximum size when adding images** (Settings) and **Resolution of this section**, and each note points to the other.
- Opening the Multiproxy log of a long core is much faster: with 100,000 rows the first opening took 3 minutes 15 seconds and now takes about 0.6 seconds (7.7 seconds became 0.16 s at 20,000 rows). Results are identical.

### Internal

- Card Q4: `core.js::toCSV` with 15 significant digits; `seriesGap` and `seriesSampler` in `core.js` (`geo.js::autoGap` uses `seriesGap`); `windowCSV` with `recordMode` and `model`, `compositeRows` marks `reversed` and counts `outside`; the frozen CSV reference test follows the new number rule.
- Card A2 (brought forward): the main process tries a refused rename and removal of a project folder again (`deleteProjectStore`, `sweepDeleted`).
- Card Q1: `app/js/taxa.js` (`classUse`, `deleteClass`, `restoreClass`, `repairOrphanLabels`) with Node tests; the class deletion of `app.js` uses it and now marks the project changed and sends the objects table of tiled sections.
- Card M8.4.31: `mask.retain` keeps the manifests the engine committed in this session after the newest one named, section by section (`Coordinator.recent_commits`, `MaskStore.retain(recent=...)`); project saves through `singleflight.js` with a revision counter; the desktop test edits and saves overlapping for 20 s, and its engine-kill step saves and settles right before the stroke (a save landing during the stroke made it fail on this computer, also on the previous commit).
- Card M8.4.26: building the engine runtime tries a failed download again (up to 4 attempts, pauses of 2, 5 and 15 s; a file that does not
  match the lock still stops the build at once), and *Desktop builds* keeps the verified downloads between runs. An engine test whose engine
  does not start now says why (time against the deadline, exit code, last error lines), and a new manual workflow repeats the engine tests
  on GitHub's Windows runner.
- Card M8.4.28: `TiledStatsRunner` reports an object only when it is current (`isCurrent`, `tilesFor`, `pendingIn`, `failedIn`, `publish`) and moves an operation's tiles to the front (`prioritise`); `tilesUnder`; `objectsReady` and `prioritiseObjects` in `app.js`; `tools/measure_tiled_reopen.mjs` measures a delete at once after a reopening (`deleteAtOnce`).
- Card M8.4.27: engine operations `mask.copy` (a stored version copied into another project, page by page, verified) and `mask.forget`; the main process's `deleteProjectStore` (renamed to `.deleting-*`, removed; leftovers removed at start) and `copyProjectStore`; the lock `frozen: 'store'`.
- Card M8.4.18b: `pyramid.build` takes `expect` (a file with another SHA-256 is refused before anything is built); the main process's `locate`, `copySource` and `sourceInfo` (`desktop/tile-ipc.js`) and the verified copy (`desktop/source-copy.js`); the section form's panel (`app/js/tiledsource.js`). Card M8.4.18b's deletion of copies moved to card M8.4.27.
- Card M8.4.18a: engine operations `mask.retain` (after a save the store keeps only the versions the project names) and `mask.info` (the tiles of a version, in pages); the main process remembers each project's sources (`sources.json`) and rebuilds a pyramid only from a file with the saved SHA-256; projects with a tiled section are format version 6, all others stay version 5. `tools/measure_tiled_reopen.mjs` measures the reopening.
- Card M8.4.17 (decision F of ARCHITECTURE §3.4, approved on 18 November 2026): the interval table of tiled sections is counted in the page (`app/js/tiledcounts.js`), not by the engine, because the engine would count the stored version and an edit is stored 300 ms after it. The binning half of `computeSectionBins` is now `binsFromRowCounts`, shared by both paths. Three new fixtures cross the tile borders, and a test counts every fixture case tile by tile. `tools/measure_tiled_counts.mjs` measures it ([sparse](docs/validation/M8.4.17-tiled-counts.json), [dense](docs/validation/M8.4.17-tiled-counts-dense.json)).
- **Fixed (card M8.4.26):** on a very busy computer the engine experiment could be marked unavailable at start, and spend its one
  automatic restart, because starting Python took longer than the 5 s allowed for an ordinary request; the first contact with the engine now
  has its own limit of 20 s.
- Card M8.4.25: the background sending of a large section's masks now sends only the tables that changed (objects with classes, or overlap
  stacks); a stroke that changed no object sends none, and when the tables are needed they are built in slices of about 8 ms, so the window
  does not pause (2^20 objects: 0.01 ms after such a stroke, longest task 8.2 ms after a class change;
  [measurement](docs/validation/M8.4.25-mask-rounds.json)). Predictions changed by the classifier are now sent as well.
- Card M8.4.24: the intermittent failure of the viewer probe in `tests/e2e/tiled-sections.mjs` came from probes on the dashed border of the
  analysis area (the test now stays inside it). Two faults of the large-section viewer found on the way are fixed: after a failed tile read it
  now asks again with growing pauses instead of leaving a coarser tile on screen until the view moves, and a failed tile read now asks for the
  automatic engine restart, as saving the masks already did. The test fails explicitly when tiles never load, keeps a screenshot when a probe
  fails, and can repeat the probe under load or with the engine killed (`SEDCORETOOL_PROBE_REPEAT`, `..._LOAD`, `..._KILL`).
- Card M8.4.23: the desktop end-to-end tests stop within a second, with the fixing command, when `desktop/web`, `desktop/python` or the engine runtime are older than `app/` and `src/` (`tests/e2e/preflight.mjs`, `tests/app/preflight.test.mjs`).
- Roadmap: cards M8.4.23 (desktop tests refuse a stale program copy or engine runtime), M8.4.24 (the intermittent viewer probe of the tiled-sections test) and M8.4.25 (sending the tables of a tiled section without a pause) added before M8.4.17, and M8.4.26 (retries for the runtime downloads of the desktop build, and a diagnosis of the engine start-up failure seen once on Windows).
- Card M8.4.22: the store keeps the objects of a tiled section as four binary columns (contract §8.7, manifest version 2), so a tiled section
  can hold up to 1,048,576 objects instead of about 51,000-56,000; the engine checks the columns against each other and the classes before
  writing anything, and refuses version 1 manifests with its own code. Beyond a limit the page now says so once and stops sending until the
  count drops, instead of retrying every 30 s. Python tests (exact round trip of 2^20 objects, eight hostile columns, version 1), Node tests
  (columns, limits, a round beyond a limit sends nothing) and the bridge test through the real engine
  ([measurement](docs/validation/M8.4.22-mask-tables.json)).
- Card M8.4.16, step 8: `tests/e2e/tiled-sections.mjs` opens the same image whole and as a tiled section at factor 1 and makes the same scripted edits on both with the real mouse: labels, exclusion, objects, overlapping sets and statistics are identical (sums of luminance within a relative 1e-12). The test found that the browser's JPEG decoder and libvips differ slightly, so it compares a lossless copy; the program has a test hook `forceTiledSections`. Card M8.4.16 is closed at the development gate.
- Roadmap: card M8.4.22 (objects table of tiled sections beyond 4 MiB, as binary columns, up to 1,048,576 objects) added before M8.4.18.
- Card M8.4.16, step 7: the metadata limits measured with the page's own table builders (`tools/measure_mask_tables.mjs`): the 4 MiB cap of the objects table binds at about 51,000-56,000 objects, before the 65,536-record cap ([evidence](docs/validation/M8.4.16-step7-mask-tables.json)); the contract is unchanged.
- Card M8.4.16, step 6: wand, lasso, scissors, delete, clear candidates, merge and the merge of overlapping objects of one ichnotaxon after a
  class change work on tiled sections at full resolution, each on edit windows of the object boxes (or of the lasso's box, or of the visible
  area for the wand) and as one undo step; an object whose box covers more than 96 mask tiles refuses with a message. The object panel no longer
  fails while a new tiled object's statistics are on their way. `tests/e2e/tiled-sections.mjs` checks each operation with the real mouse
  against the labels in the tiles (exact areas for lasso, scissors, merge and the class-change merge), and undo and redo of a delete; Node
  tests that the window gives the whole image's result for lasso, wand and scissors (`tests/app/tiledops.test.mjs`).
- Card M8.4.16, step 5: strokes and exclusion rectangles on tiled sections can be undone and redone; each step keeps the mask tiles it changed
  as they were before (copied on the first write) and undo and redo swap them, within 64 MiB for the whole history (the oldest steps are dropped
  beyond it, with a message) (`app/js/tiledundo.js`). `tests/e2e/tiled-sections.mjs` now undoes the stroke while the engine is down and redoes it
  after the restart: the page and the store hold exactly the state before the stroke, then exactly the stroke, and the objects and their
  statistics come back as they were; Node tests for the copies, the swap, reading back dropped tiles and the budget. Strokes on the 8 GiB fixture
  with the copies: input to next frame p95 22.7-31.1 ms against 33 ms ([evidence](docs/validation/M8.4.16-step5-viewer-rgb8g-windows.json)).
- Card M8.4.16, step 4: the masks of tiled sections are sent to the engine's store in the background after each change and kept in the page
  until the store acknowledges them; if the engine dies on the way they are sent again after its automatic restart (`app/js/tiledsync.js`; the
  page reaches the store through `desktop/tile-ipc.js`; the program starts the engine with `--projects-dir`). Tiles the page dropped to save
  memory are read back from the store. `tests/e2e/tiled-sections.mjs` kills the engine while a stroke's tiles are on their way and checks that
  the page's masks are unchanged and that the store then holds exactly them; Node tests for the rounds, failures at each step and reading back,
  and one through the real engine and bridge. Strokes on the 8 GiB fixture with sending running: input to next frame p95 18.2-32.4 ms against
  33 ms ([evidence](docs/validation/M8.4.16-step4-viewer-rgb8g-windows.json)).
- Card M8.4.16, step 3: on tiled sections (behind the flag) brush, erase, exclude and include now edit the masks at full resolution, on an edit
  window of whole mask tiles around the visible area (`app/js/tiledit.js`); zoomed out beyond 96 tiles they ask to zoom in. Object statistics are
  kept per tile and summed, exactly equal to those of the whole image (`objectStats` takes the image's edges as an optional argument; default
  unchanged). No undo for these strokes yet (step 5). Measured on the 8 GiB fixture: input to next frame p95 18.4-31.8 ms against 33 ms
  ([evidence](docs/validation/M8.4.16-step3-viewer-rgb8g-windows.json); `tools/measure_tiled_viewer.mjs` measures strokes with the real mouse).
  `tests/e2e/tiled-sections.mjs` paints, erases, excludes and includes with the mouse and checks the tiles, the reduced copy and the object's
  area and bounding box. Fixed: with the engine experiment on, analysing all sections (exports) sent tiled sections to the engine with the
  working image's masks; tiled sections now get no table until card M8.4.17.
- Card M8.4.16, step 2: `app/js/tiledmasks.js` (pure, tested in Node) keeps the page's full-resolution mask tiles of a tiled section (tiles not yet
  acknowledged by the engine are never dropped), writes their reduced copy into the working image for the overview, and paints the masks over the
  pixel tiles at fine zoom with the viewer's colours, edges and exclusion hatching (checked against a copy of `render()`'s formulas over tile seams).
  Masks start empty: editing comes in the next steps. Pixel tiles are now also drawn when the section has objects or exclusion. Measured with dense
  masks on the 8 GiB fixture: 10.5 ms per frame (median), 12.9 ms (p95) ([evidence](docs/validation/M8.4.16-step2-viewer-rgb8g-windows.json);
  `tools/measure_tiled_viewer.mjs` now measures the same pan and zoom with masks). `tests/e2e/tiled-sections.mjs` puts a mask tile in the page and
  checks the fill, edge, exclusion and unchanged pixels at full resolution and at two coarser zooms.
- Card M8.4.16, step 1: the engine stores the masks of tiled sections (contract §8.7, written before the code): `src/sedcoretool/store/masks.py`
  (standard library only) keeps every mask tile (labels `i32`, exclusion `u8`, 512 x 512) and table as a zlib-compressed blob named by the SHA-256 of
  its bytes, skips all-zero tiles, and names each version of a section by the SHA-256 of a canonical JSON manifest; files are written to a
  temporary file, flushed and renamed, and read only when their bytes match their names. The coordinator answers `mask.begin`, `mask.put` (one
  tile per descriptor and binary frame), `mask.commit` (tables from committed buffers), `mask.discard` and `mask.read` when started with
  `--projects-dir` (the desktop program does not pass it yet). Tests: `tests/test_store_masks.py` (29: exact round trips, unchanged bases,
  hostile manifests and blobs, a failed write, a full disk) and `tests/test_engine_masks.py` (7, including a real engine process killed between
  `mask.put` and `mask.commit`: the last version stays readable and the tiles are sent again).
- Card H7: `tiff.js::highBytes` makes the 8-bit display copy of 16-bit samples with a plain loop (also used by `tiledsection.js`); the mapped `Uint8ClampedArray.from` it replaces built a temporary array on the JavaScript heap and ended the renderer with a fatal out-of-memory error from about 112 million samples (measured in Node 22: 100 million took 5.2 s, 112 million died). New `tests/e2e/large-16bit-desktop.mjs` (generates a 6,000 × 5,000 16-bit TIFF, adds it without reduction and opens the Core log three times with the pixels released in between), run by the *Desktop builds* workflow on the three systems; a Node test of `highBytes` at 120 million samples.
- Card M8.4.15 done: the tile store keeps an identity record (`src/sedcoretool/store/identity.py`, `<pyramids>/identities.json`, contract §8.2 and §8.4): a file added again in the same state (path, size, modification time and three sampled MiB) finds its pyramid without being read whole, so the first view of an 8 GiB file whose pyramid exists went from 6.5-6.7 s to 0.9 s; every target of the card is met ([summary](docs/validation/M8.4.15-summary.md)). `tests/test_store_identity.py` (13 tests, including the documented limit).
- Card M8.4.15, step 7: `tools/measure_tiled_viewer.mjs` measures the viewer of tiled sections against contract §7 on the four large fixtures ([summary](docs/validation/M8.4.15-summary.md)): panning and zooming over loaded tiles take 6.7-7.1 ms per frame (median), jumps to unloaded areas show an image at once and reach full resolution in 78-207 ms, and the whole program stays under 1.6 GiB. The first view of a file whose pyramid already exists takes 2.0-2.2 s (2 GiB) and 6.5-6.7 s (8 GiB), above the 2 s target, because the engine hashes the source file again; the card waits for a decision.
- Card M8.4.15, step 6: on a tiled section the editing tools, detection, crop, rotation, resolution and filters answer with one message ("does not work with large tiled sections yet") instead of failing or changing nothing; select, pan, marks and the analysis area work. `tests/e2e/tiled-sections.mjs` clicks each of them.
- Card M8.4.15, step 5: the status bar of a tiled section shows the source's own pixel (full resolution) while the depth readout, the ruler and the navigation strip keep working on the section's working rows; `tests/e2e/tiled-sections.mjs` checks the readout, the depth of a source row (tolerance one working row) and the strip.
- Card M8.4.15, step 4: the viewer draws the full-resolution tiles of a tiled section over its working image when zooming in (`drawTiles` in `app.js`; `tilePlacement` in `tilecache.js`, `tileRgba` in `tiledsection.js`, 16-bit shown by the high byte), from one page cache of 256 MiB, with a coarser cached tile or the working image while a tile loads. `tests/e2e/tiled-sections.mjs` checks 40 screen pixels where full resolution differs from the working image against the source. Tiled sections keep the default filters, and tiles are drawn only while the working image has no filter, objects or exclusion (masks come with M8.4.16).
- Card M8.4.15, step 3: `app/js/tilecache.js` (pure, tested in Node) decides which tiles the viewer needs (level for the zoom, visible tiles plus a ring, nearest the centre first), keeps them in a 256 MiB cache that never drops the tiles on screen, requests them 16 at a time with at most two requests in flight, drops requests the view no longer needs, and finds a coarser cached tile to show while one is missing. `tiledsection.js` and `tilecache.js` join the list of pure modules (ARCHITECTURE §3.2).
- Card M8.4.15, step 2: an image above the maximum size when adding images becomes a tiled section (pyramid built with a progress dialog and Cancel, working image from one pyramid level; `app/js/tiledsection.js`); it is not saved yet, has no interval table yet, is read again from the pyramid when released, and tools that would decode its source refuse. `tests/e2e/tiled-sections.mjs` checks it in the desktop program with the flag on and off.
- Card M8.4.15 (in progress, behind `SEDCORETOOL_TILED_SECTIONS=1`): the page's bridge to the tile store (`desktop/tile-ipc.js`: a chosen file becomes a token, the page builds pyramids with progress and cancellation and reads verified tiles of its own pyramids, never seeing a path) and a main-process reader of the store (`desktop/tile-reader.js`). Step 1 measured how tiles should reach the page ([evidence](docs/validation/M8.4.15-delivery-windows.json)): through the engine, one tile p95 7.9 ms and 16 tiles p95 113 ms on the 8 GiB fixture, within the rule, so the engine path is used. Both modules are now in the desktop package list (a packaging test caught their absence).
- Card H6: `factorThatFits` and `workingBytes` in `app/js/imageproc.js` (limit 1.5 GiB of page memory per section); the TIFF reader tells the factor callback the sample depth; tests in `tests/app/working-memory.test.mjs` and a Windows desktop check with the 2 GiB fixture (`tests/e2e/working-memory-desktop.mjs`).
- Runtime preparation: a target may list several wheel platform tags (`pip` accepts only the exact tags given on Linux; NumPy, pandas and Pillow publish `manylinux_2_17` wheels and libvips `manylinux_2_28`). Found by the Linux build of GitHub on commit `e65f6e2`.
- Card M8.4.14 (done): measured on the seven multi-gigabyte fixtures with `tools/measure_tile_store.py` ([summary](docs/validation/M8.4.14-summary.md)): every pyramid exact, about 100 MiB/s (8 GiB in 81 s), memory below 320 MiB; tiles stored uncompressed (zlib was 2.5 times slower for 39 % less disk). Cancellation now answers in 7-15 ms (it deleted gigabytes of written tiles before answering, up to 0.66 s; now the deletion follows in the background) and is checked before every tile. The engine answers `pyramid.build` (a worker job with progress events and a 60 s stall watchdog), `pyramid.info` and `tile.read` (tiles verified against their SHA-256, sent in several binary frames that the desktop client accepts only as announced); only the main process can use them, the page bridge does not forward them. The method worker now reads its command pipe on a private descriptor: on Windows a thread blocked on the stdin pipe made libvips crash (an access violation in about one build in fourteen). A layer `store` joins the architecture rules (`tests/test_architecture.py`). `sedcoretool.store.pyramid` builds the pixel pyramid of contract §8 band by band (memory near one band per level), writing into a partial folder renamed at the end; `store.format` (standard library only) holds the layout and validates `pyramid.json`. Tests: every level exact (level 0 against the generator, the rounded integer mean against a loop implementation), identical bytes on rebuild, the same tiles with and without zlib, reuse, cancellation, a full disk, the 50 GiB budget with least-recently-used deletion, leftovers of interrupted builds. `sedcoretool.store.source` reads TIFF/BigTIFF, JPEG and PNG in bands of 512 rows with libvips, chosen by the file's first bytes (no other libvips loader is used), with the limits of contract §8.3 checked on the header; tests compare it byte for byte with Pillow, the generator and the program's own `tiff.js`. `pyvips[binary]` joins the `dev` extras and a new `large-images` extra (not a requirement of the public package). The bundled engine runtime now includes libvips 8.18.7 (`pyvips-binary`, `pyvips`, `cffi`) for reading large images; `pyvips`, published only as source, is copied from its hash-verified archive without running setup code. The runtime smoke check reads 8- and 16-bit TIFF regions with it. Linux now needs glibc 2.28 or newer. Contract §8 specifies the tile store's pixel pyramids.
- Way of working: every card has a `Model:` field (most capable or fast tier, and effort low, medium or high) and every assistant (Claude, ChatGPT/Codex, Gemini) tells the maintainer which tier and effort a card needs before starting it (`AGENTS.md` §6).
- Design of part C of M8.4 (documents only, 16 November 2026): decisions for the tile store in `docs/ARCHITECTURE.md` §3.4 (which sections are tiled, masks at full resolution, a pyramid cache and a project mask store in two folders, TIFF read by a minimal Python reader without a new dependency, a Zarr-version-2 pyramid layout, content-addressed mask tiles, rule D11 = D) and cards M8.4.14-M8.4.19 detailed in the roadmap; the maintainer answered the three questions (masks at full resolution, a 50 GiB pyramid cache, JPEG/PNG up to 1 GiB) and asked to add libraries that make the program faster and more stable: images will be read with libvips (`pyvips`), which read every M8.4.13 TIFF fixture exactly in a probe.
- Way of working (16 November 2026): the work branch is pushed after every finished card; `master` only receives versions, through the new `tools/integrate_version.py`, which makes the one version commit with exactly the files of the work branch, merges `master` back so the histories stay joined, and refuses to run when `master` holds a change the branch lacks (for example a pull request merged on GitHub), so that nothing can be overwritten. Rules in `AGENTS.md` §1, §3 and §5; commands in `docs/DEVELOPMENT.md` §8. The histories of `master` and the work branch were joined (no file changes).
- Card M2.1.5: `coreConverter` in `app/js/geo.js` builds the depth-age relation of a core once instead of once per sample (`coreConvert` keeps its signature and results; checked for exact equality against the previous implementation on 300 random cores). [Report](docs/benchmarks/M2.1.5.md): 195 s -> 2.45 s at 100,000 rows.
- Card M2.1.6: `buildSamples` and `labelSamples` find the intervals that contain a sample with `createIntervalLookup` instead of scanning all intervals per sample (checked for exact equality against copies of the previous code, including overlaps, shared boundaries, non-finite ends and both axes). First opening of the multiproxy log at 100,000 rows: 2.45 s -> 0.58 s, below the 2 s target; [report](docs/benchmarks/M2.1.6.md).

## V0.151 — 2026-11-16

### For users

- The Data sheet now draws only the rows you can see while you scroll, by default: scrolling a long table no longer stutters (in a test with 10,400 rows the time between frames fell from about 80 ms to under 9 ms) and showing more rows is about 50 times faster (six seconds became a tenth of a second for ten expansions). The checkbox **Visible rows only** turns it off for the session to return to the previous table; CSV exports always include every selected row.
- The core image strip (Core column, Multiproxy) no longer freezes the page for tens of seconds while the pictures of some sections are still being read from disk. It asked for a new full-size grey canvas once per output row; it now reuses one while the section stays pending. The picture produced is unchanged.

### Internal

- Card M8.4.12: measurement of the round trip of a one-tile edit (`docs/validation/M8.4.12-round-trip-summary.md`): median 72 ms, p95 794 ms (one stall), plus 238 ms to rebuild the interval table of a very tall section from remembered counts; by the predeclared rule the interval table of large images would stay in JavaScript, but most of those 238 ms are an avoidable loop in `kernels/binning.py`; a design session decides. New tool `tools/measure_interval_table.py`; `make_synthetic` takes a `width` (default package unchanged).
- Card M2.1.4: `tools/measure_large_tables.mjs` and the [report](docs/benchmarks/M2.1.4.md) on tables and figures with 20,000 and 100,000 rows (Windows, headless Chrome). Scrolling the Data table: the native table fails the 33 ms target (about 13 frames per second), the visible-rows rendering passes (both measured at 10,400 rows, ten clicks of "Show more"). A scatter of 50,000 points takes 156 ms to redraw (329 ms at 100,000). The first opening of the multiproxy log takes 7.7 s at 20,000 rows and **195 s at 100,000**, because `coreConvert` is rebuilt for every sample. Nothing was changed in the program.
- Card M8.4.21: the interval sums of the Python method no longer loop over intervals (integer counts are summed in one pass, with identical results, tested for exact equality against the previous code), and the boundaries of the intervals are computed at once; turning remembered row counts into the table of a 349,526-row section takes 35 ms instead of 238 ms, which also speeds up the Python API and the command line. Rule D11 measured again with 60 samples: still D (119.5 ms against 100), accepted for the interactive interval table; [summary](docs/validation/M8.4.21-vectorised-kernel-summary.md).
- Card M8.4.13: `tools/make_large_fixtures.py` writes deterministic 2, 4 and 8 GiB TIFF/BigTIFF images (tiled, striped, deflate, 16-bit grey) and a JPEG of 65,500 rows (the most Pillow writes), every region reproducible from a pure function, outside the repository; `tools/verify_large_fixtures.mjs` reads regions with the program's own TIFF reader to check them (by file handle, because Node's `openAsBlob` reports the wrong size above 4 GiB on Windows). `tools/measure_large_images.mjs` imports each file through the desktop program with the engine off and on; the [baseline](docs/validation/M8.4.13-large-baseline-summary.md) on Windows: all seven files are added at 1/6-1/19 of their resolution, 2.6-61 s to the first frame, memory peak below 2.9 GiB; no image was shown at full resolution.
- Card M8.4.8: final measurements of part A (`docs/validation/M8.4.8-final-summary.md`): matched timing still fails for the interval change and the edit (0.17-0.31 s against limits of 0.05-0.07 s), the memory peak and parity pass, and input during a brush stroke is the same with the engine on and off (15.6 ms p95). The measuring tool gains the stroke measurement and the desktop test kills the engine while an undo is being sent. New roadmap card M8.4.21 for what is left of the maintainer's engine-speed list.
- Card M8.4.7 (engine experiment only): when the scientific engine stops, the program starts a new one by itself once and says so, then recalculates; a second failure shows the error with a **Retry** button that starts a new engine and recalculates the sections that failed. The JavaScript calculation is never used. Bridge operation `restart`; `createEngineService.restart`.
- Plan (documents only, 15 November 2026): the maintainer chose option A for fluidity with very large images: the engine will keep a tile store on disk (a pixel pyramid and versioned mask tiles) and the page will show tiles and edit the loaded ones (ARCHITECTURE §3.4, decisions D10-D12). Part C of M8.4 (multi-gigabyte images) now comes before part B; its first cards measure the round trip of a one-tile edit (which decides, by a predeclared rule, whether the interval table is computed by the engine or stays in JavaScript), build 2-8 GiB generated fixtures with a baseline, and measure tables and figures with 100,000 rows. The engine contract gains absolute interactive targets (frame time, edit-to-table time, first view, memory); the JavaScript-relative timing limits are still reported. M8.4.6 is deferred. To keep a later Rust core or native interface possible, the store format must be documented and independent of the browser and Electron (AGENTS.md §4).
- Engine: one long-lived method worker replaces one process per analysis. Cold analysis of the six public sections takes 1.6 s instead of 4.2 s and of the generated eight-section project 3.4-3.9 s instead of 6.9 s (JavaScript: 0.03 s and 0.11 s); cancellation reaches its final state in 38 ms instead of 533 ms. The coordinator still verifies every answer, kills the worker on an unacknowledged cancellation, an abandoned job, a bad answer or the deadline, starts a new one after any anomaly and stops an idle one after 30 s. A bug found by the new tests (an answer the coordinator does not approve left the job waiting) is fixed. The engine contract is amended accordingly.
- Measurement tool: the process-tree memory sampler (`tools/process_tree_sampler.py`) reaches the contract's 25 ms cadence (it was 900 ms). With it the ten-cycle memory gate passes (four runs); evidence in `docs/validation/M8.3.8-engine-analysis-windows-corrected.json` and the summary next to it.
- The GitHub `e2e` job is green again (it failed from 10 to 14 November 2026). The navigation preview now stretches the strip at the offset where the view draws it, because Chrome's software renderer (SwiftShader, Linux) rounds a stretch differently at different destination positions; exact pixel equality with the previous renderer is unchanged. The interrupted-saves test fixes the interface language, since two of its checks read Spanish messages and the Linux runner's browser is English.
- Smoke test: any page call that takes more than 5 s is named in the log, and a new check asserts that a section with an unloaded picture answers every strip request with one canvas. This was the cause of the local timeouts (a 25-45 s freeze in the multiproxy step and in the wait for the 16-bit TIFF; Puppeteer's 180 s limit was reached on slower runs).
- Design review before M8.4 (documents only). A third acceptance level, the milestone gate, closes every milestone with the GitHub workflows on Windows, macOS and Linux (AGENTS.md §6; first one: card M8.3.9, since the engine has never been built on macOS or Linux). Two verdicts of the M8.3.8 evidence are corrected: matched timing is a gate of contract §7 and fails (about 392 ms against 17 ms for one large section, most of it moving the label image), and the memory-peak gate was not evaluated. M8.4 is redesigned around section inputs kept resident in the engine, with five decisions for the maintainer; stale statements in ARCHITECTURE.md and the contract are corrected.
- Card M8.4.5 (engine experiment only): after an edit the engine counts only the rows that were written, from the counts of the masks it held, when the classes of the objects in both versions agree (deleting or adding a trace; a class reassignment recounts everything). Edit, undo and redo take 0.15 s (public example) and 0.21 s (generated project); still above the limit of contract §7.
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
