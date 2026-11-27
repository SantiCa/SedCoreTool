# M8.1: single scientific engine migration contract

Design baseline: V0.141, 12 November 2026. Authorised by the maintainer's instruction to continue the
[roadmap](roadmap.md#active-priority-desktop-and-one-scientific-engine). Editor: Codex. Verification:
source inspection and author-run repository checks; no independent reviewer is assigned.

This is the specification for M8.2–M8.6. M8.2 and M8.3 implement part of it behind the default-off experiment
flag: the transport, staged buffers, `buffer.read`, `section.analyze` with `section.intervals/1` and the job
execution model of §3 ([current behaviour and limits](TECHNICAL_DOCUMENTATION.md#262-experimental-engine-process)).
**Not implemented yet** (15 November 2026): progress events, the batch request for several sections, engine-held source images and tables, the tile store, and everything after M8.4.7. Implemented in card M8.4.7: a new engine session after `ENGINE_UNAVAILABLE` (one automatic restart per program session, then the user's Retry; all tokens and buffers of the old session are invalid; no wire change). Implemented since M8.3 (cards
M8.4.2-M8.4.5): inputs kept in the engine between analyses, remembered counts, one packed result, `buffer.derive` and the recount of
written rows. The matched-timing gate of §7 still fails for the interval-size change and for edit/undo/redo (see the roadmap); the
memory-peak gate passes. Without the flag, the
desktop/browser calculations, Python API, file formats and defaults are unchanged.
Protocol version 1 and method `section.intervals/1` below are separate versioned contracts. Changing
scientific semantics requires a new method version and explicit acceptance, even if the wire format fits.

How the code that implements this contract is layered, and the path of one request through it, are described in
[ARCHITECTURE.md](ARCHITECTURE.md). Amended on 13 November 2026 (card M8.3.5): §3 now defines `buffer.read`, which downloads
committed buffers, and the exact shape of the `section.analyze` response; progress events are not yet sent. Amended on
15 November 2026 (option A for large images, ARCHITECTURE D10-D12): §2 describes the ownership of tiled sections, §6 the new order
of M8.4, and §7 adds absolute interactive targets and the rule that decides where the interval table of a tiled section is computed. Amended on 16 November 2026 (card M8.4.14, step 1): §8 specifies the tile store's pixel pyramids; not implemented yet. Amended on 22 November 2026 (card A1): §9 designs `method.run`, methods of section, core and project scope with two priorities and an operation table; not implemented.

## 1. Current calculation and ownership inventory

Source links name the implementation to inspect, rather than assuming that similar names imply parity.
“Partial” means shared definitions exist, but representations or workflow coverage still differ.

| Workflow and callers | Current JavaScript source | Current Python source | Ownership, caches and migration boundary |
|---|---|---|---|
| Interval counts, percentages, BI/ii; `app.js::analyze`, results, core records and exports | [core.js](../app/js/core.js): `rowCounts`, `binRows`, index schemes; [app.js](../app/js/app.js): `effClassId`, `effClassArray`, `analyze` | [pipeline.py](../src/sedcoretool/pipeline.py): `analyze_mask`, `bin_edges`; [indices.py](../src/sedcoretool/indices.py) | Partial. Renderer owns object IDs/assignments, signed labels, overlap stacks, exclusions and ROI. `_rc` caches row counts against mask revision, geometry and effective-class signature. Python receives class labels/layers, not objects. Custom overlapping tiers also have different first/last-match precedence. First M8.3 slice; mapping and counts must become engine operations together. |
| Interval postprocessing and manual interpretation | `app.js::analyze`, `manualAt`, `binRowsOf` | No equivalent for no-data padding, age ranges or manual index attachment | JavaScript-only workflow. Settings, class-count flags and ordered manual ranges affect results. Include these in M8.3 completeness; never discard them in an adapter. |
| Depth, units and age | [sectiondepth.js](../app/js/sectiondepth.js): `pxPerCm`, `depthAtRow`, `rowAtDepth`; `core.js::interpAge`, `interpAgeRange`, `parseAgeModelDetailed`, `baconToAgeText` | [depth.py](../src/sedcoretool/depth.py): `pixel_depths`, `depth_to_age`; `CoreSection.add_age` | Partial. Renderer owns section calibration and project age model; Python interpolates central age, with its own validation/optional extrapolation. Age parsing/ranges and outside-model behaviour need fixtures. M8.3 uses validated age arrays; standalone record conversion follows in M8.5. |
| Image decoding, masks, enhancement, detection and connected components | [imageproc.js](../app/js/imageproc.js): `applyFilters`, `detectMask`, `components`, `regionGrow`; [worker.js](../app/js/worker.js) already runs filtering/detection outside the UI thread | [io.py](../src/sedcoretool/io.py), [segmentation.py](../src/sedcoretool/segmentation.py): image IO, palette/threshold masks | Partial, not interchangeable algorithms. Renderer owns `orig`, optional `orig16`, `enh`, canvases and masks; image-cache eviction drops resident copies. Worker transfers are already used. M8.4 moves bounded native image ownership; M8.5 ports each missing method and tests decoder differences separately. |
| Object geometry/features, overlap edits and history | `imageproc.js::objectStats`, `features`, `splitPieces` in [edit.js](../app/js/edit.js); `app.js::refreshObjects`, `beginOp` | No matching object/edit model | Renderer owns objects, label edits, overlap stacks and undo/redo. `_mv` invalidates row-count/packed-mask caches; geometry changes invalidate embeddings. Keep editing commands and display in JS initially; engine resolves scientific features. M8.4 defines transactional edit ownership before removing resident masks. |
| Ichnotaxon classifiers, validation and embeddings | [learn.js](../app/js/learn.js): `Classifier`, `TaxonModel`, folds, `evaluateModels`; [vision.js](../app/js/vision.js): DINO input/embedding | No matching classifier/embedding implementation | JS-only. Object features/embeddings and model/configuration determine caches and results. Port after image features, preserve folds, labels, RNG algorithm and model hashes; do not substitute library defaults. |
| Multiproxy transformations, rules and learned events | [geo.js](../app/js/geo.js): `featureSeries`, `resample`, `buildSamples`, `ruleMatches`, `fitModelSteps`, `crossValidateSteps`; [multiproxy.js](../app/js/multiproxy.js): `geoComputeSamples`, `geoTrain` | No matching engine methods | JS-only. `geoRT` owns derived samples, predictions, runs, layer columns, rule labels and dirty state. Renderer owns source records and settings. Port transformations before fitting/prediction and invalidate from source-record/model revisions. |
| Spatial interpolation and geographic transforms | [interp.js](../app/js/interp.js): IDW, nearest, TIN, minimum curvature, RBF, kriging, moving average, land mask and contours; `geo.js::makeProjection`; [locmap.js](../app/js/locmap.js): `lmCRS` | No matching interpolation/CRS service | JS-only. Proxy-map callers own samples, extent, grid and land/sea selection. Engine owns scientific grids, projection values and contours; JS retains view transforms, SVG construction, colour ramps and interaction. Test marine extrapolation outside the sample hull. |
| Data formulas, joins/axis conversion and fitted statistics | [sheet.js](../app/js/sheet.js): `parseFormula`, `evalCells`, `fillLinear`; [plot.js](../app/js/plot.js): `plotStats`, `pearson`, `fitCurve`; [log.js](../app/js/log.js): `toAxis`, `compositeRows` | No matching application workflow | JS-only. Data controller owns tables, formulas and derived columns. Engine evaluates the existing restricted formula language and statistical definitions; no arbitrary Python expression execution. Figure builders/event shading stay JS and consume engine values. |
| U-Net tiling, inference, evaluation and training | [unet.js](../app/js/unet.js): `tileStarts`, `blendWindow`, `predictProb`, `trainingMask`; [unetmodel.js](../app/js/unetmodel.js) coordinates models and section `_unet` cache | [unet/](../src/sedcoretool/unet/): `tiling.py`, `predict.py`, `train.py`, dataset/evaluation | Tiling definitions are shared; browser ONNX inference and Python inference are separate runtimes. Python already owns training through [desktop/trainer.js](../desktop/trainer.js). Preserve model generations, tiling, probabilities and providers. M3.2.5 precedes training migration; optional training dependencies stay separate. |
| Persistence, backup and figures | [storage.js](../app/js/storage.js), `app.js::serialize`, `backupNow`, figure/export controllers | Python export functions are separate public APIs | Persistence and presentation are not a second scientific engine. IndexedDB transactions, chunked/OPFS images and folder-backup manifest remain their current owners initially. Route accepted engine results to these existing consumers; do not move save ownership implicitly. |

The desktop [preload](../desktop/preload.js) currently exposes training and diagnostics, not general scientific
execution. [main.js](../desktop/main.js) packages application services; the trainer's Python sources are not
a bundled interpreter. M8.2 must supply and test that runtime rather than assume the user's Python exists.

## 2. Ownership and publication rules

During M8.3 the renderer remains authoritative for live editing and saved project state. It creates an immutable
input snapshot; main validates and transfers it; the engine owns that snapshot and its derived results until
release. Edits never mutate a submitted buffer. Every scientific input change advances a monotonic section
analysis revision, including mask/history, ROI/calibration, assignments, class-count flags, prediction threshold,
bin settings, schemes, age model and manual ranges. `_mv` alone is insufficient for this purpose.

Main assigns session-local UUID tokens to existing projects/sections without changing their persisted IDs.
Only a terminal success for the current session, project, section, revision and settings hash may publish.
Validate the complete result before replacing `s.bins` atomically. Obsolete, cancelled or failed jobs cannot
change live results or a saved project. Release obsolete handles. Show an error/status rather than publishing
partial results or silently recomputing with another scientific implementation.

Cache keys include method version, committed input SHA-256 hashes, dimensions, calibration, settings and model
identity. A settings hash is SHA-256 of the exact validated UTF-8 settings-buffer bytes, not an unspecified
JSON canonicalisation. Equal content under a different revision can reuse immutable calculations, but the result
must still carry the requesting revision. Closing a project releases its queued jobs, snapshots and results;
process restart creates a new session and invalidates every old handle.

M8.4 (revised 14 November 2026): the renderer stays the owner of live masks, edit history and saving for sections held in the
page. The engine keeps a verified copy of each section's analysis inputs, updated with the changed rows (card M8.4.4), so that the
edit path never waits for it and an engine failure cannot change an edit or a save.

Tiled sections (decided 15 November 2026, option A; planned, part C of M8.4; design in
[ARCHITECTURE §3.4](ARCHITECTURE.md#34-tile-store-for-large-images-planned-part-c-of-m84)): the pixels (a pyramid built from the
source file) and the saved masks live in a tile store on disk that only the engine writes, on the page's request. The page loads the
tiles it shows and owns the live edits of loaded tiles and the undo history until the store has acknowledged them. A save writes the
new tiles, then the new store version (atomic replacement), then the project record that names it, so a failure at any step leaves
the last good save readable. There is still exactly one writer of each file of a project. Keep atomic saves, recoverable backup,
native samples, history and the compatibility identifiers in AGENTS.md.

## 3. Private transport v1

Use a child process with private stdin/stdout pipes, not a listening HTTP service. Main spawns the fixed packaged
executable with an argument array, `shell: false` and `windowsHide: true`. The existing preload name stays;
add narrow allowlisted operations, sender/origin validation and shape/size checks. Renderer requests cannot
choose executable paths, arbitrary filesystem paths, imports or Python code. Main owns the handle registry and
private scratch directory. Stderr is a bounded diagnostic channel; stdout contains protocol frames only.

Each frame has a 12-byte header: ASCII `SCE1` (4 bytes), kind (`u8`: 1 = UTF-8 JSON, 2 = binary), flags (`u8`,
must be zero), reserved (`u16le`, zero), payload length (`u32le`). Reject an invalid header before allocating
payload storage. Maximum JSON payload is 65,536 bytes; maximum binary payload is 1,048,576 bytes. UTF-8 is
strict; JSON has no duplicate keys, nonfinite numbers, unknown envelope fields or nesting beyond 16 levels.
Integer-valued numbers in JSON are in the safe range -9,007,199,254,740,991..9,007,199,254,740,991 unless a
narrower bound is specified; scientific coordinates may be negative. Lengths, offsets and revisions are nonnegative.
Unknown protocol versions terminate the handshake; unknown operations receive `UNSUPPORTED_METHOD`.

The JSON envelope is `{v:1, kind, session, id, op, payload}`. `session` and `id` are lowercase UUID strings;
`kind` is `request`, `response` or `event`. A response echoes the operation and request ID and has exactly
one of `status:"ok"` plus `result`, `status:"error"` plus `error`, or `status:"cancelled"`, in place of
`payload`. An event retains `payload` and the initiating request ID. Each accepted request gets exactly one
terminal response; duplicate IDs are rejected without re-executing work. The engine remembers the IDs of the last 65,536 requests of the
session (a sliding window, oldest forgotten first; decision V, card M8.4.40): a session has no request limit, and an ID repeated within that
window gets `INVALID_REQUEST` (an ID older than the window would be run again; clients use a new UUID per request). Responses are matched
to requests by ID, not by order: mask operations (§8.7) are answered when they finish, possibly after later requests of other kinds.
The initiating main process supplies the new session UUID in `hello`; no other operation is accepted before successful negotiation.
All buffer handles and project/section tokens are also session-local UUIDs. SHA-256 values use 64 lowercase
hexadecimal characters. Requests and metadata records have closed, operation-specific fields; reject unknown
fields rather than silently ignore an unsupported setting. Protocol fixtures in M8.2 must encode these rules.

| Operation | Request payload | Successful result / events |
|---|---|---|
| `hello` | `{protocol:1}` | `{protocol:1, engine_version, runtime_id, methods, limits}`; `runtime_id` is the packaged runtime/constraint manifest SHA-256; methods is the explicit supported method-version list. |
| `buffer.begin` | `{dtype, shape, byte_length, sha256}` | `{handle}`; reserve a staging buffer after checked dimension multiplication and budget admission. |
| `buffer.chunk` | `{handle, offset, byte_length}` immediately followed by one binary frame of that length | `{next_offset}` after accepting that pair; offsets start at zero and must be contiguous. |
| `buffer.derive` (card M8.4.4) | `{base, dtype, shape, byte_length, sha256}`: `base` a committed, not released, non-metadata buffer whose dtype, shape and length are exactly those given | `{handle}`; a staging buffer that starts as a copy of `base` and is charged to the session budget like any other. `buffer.chunk` to it may use any ascending, non-overlapping offsets inside the buffer (not necessarily contiguous); `buffer.commit` then succeeds only if the whole content has the declared SHA-256 (and, as always, finite float data), so a client that missed a change gets a refused commit and never a wrong buffer. The base is not modified. |
| `buffer.commit` | `{handle}` | `{handle, byte_length, sha256}` only after complete size/hash verification; committed buffers are immutable. |
| `buffer.release` | `{handles:[...]}` (at most 64) | `{released:[...]}`; idempotent for previously released handles in this session. Referenced buffers remain pinned until the job ends. |
| `buffer.read` | `{handle, offset, byte_length}`, 1 ≤ byte_length ≤ 1,048,576, offset + byte_length ≤ the buffer's length; the buffer must be committed and not released | `{offset, byte_length}`, immediately followed by exactly one binary frame holding those bytes. Any error response is not followed by a binary frame. |
| `section.analyze` | `{method:"section.intervals/1", project, section, revision, settings_hash, inputs}`: project and section are session-local UUIDs, revision a non-negative integer, `settings_hash` the SHA-256 of the `settings` buffer (the coordinator rejects a different value), and `inputs` maps the names of §4 to committed handles of the matching dtype and rank (`labels` `i32le` 2-D, `exclude` `u8` 2-D of the same shape, `stack_offsets` and `stack_members` `u32le` 1-D, the others `utf8json`); `stack_members` may be omitted when there is no overlap, every other name is required, unknown names are rejected | `{project, section, revision, settings_hash, method, dimensions:{bins,classes,schemes}, outputs, layout, provenance}` echoing the request's identity. *Amended in card M8.4.3:* `outputs` holds exactly one entry, `result`, `{handle, dtype:"u8", shape:[N], byte_length, sha256}` of a committed buffer that counts against the session budget until released; it contains every §5 column (including each `<name>_valid`) one after another, and `layout` maps each column name to `{dtype, shape, offset, byte_length}` in it (one buffer instead of about 35 handles and reads). Every column starts at a multiple of 8 bytes, columns do not overlap, nothing in the buffer is unaccounted for, and N is a multiple of 8. Download the buffer with `buffer.read`. `provenance` holds `engine_version`, `runtime_id`, `method`, `revision`, `deterministic`, `input_sha256` (hash of every input buffer by name) and `elapsed_ms`. A rejected input is an error response whose `details.field` names the input and member (for example `settings.roi`). Progress events (`{stage, completed, total}`, at most 10 per second) are part of this contract but are not sent yet; the Electron client of card M8.3.6 does not read events. |
| `method.run` (designed by card A1; in the engine since card M8.5.2, client since card M8.5.3; no interface uses it yet) | §9.2 | §9.3 |
| `job.cancel` | `{request_id}` | `{state:"requested"}` or `{state:"already_terminal"}`; the target still gets its own one terminal response. |
| `shutdown` | `{}` | `{}` after cancelling/releasing work; main enforces the shutdown deadline. |

Buffer dtypes are `u8`, `u16le` (added by card M8.4.9 for 16-bit pixels), `i32le`, `u32le`, `u64le`, `f64le` and `utf8json`. Shape is an array of 1–3 positive
dimensions; numeric buffers are contiguous C order, little-endian, with exact item-size product. `utf8json`
uses shape `[byte_length]` and the same strict JSON rules, maximum nesting 16; this carries bounded metadata
tables without expanding control frames. Numeric masks and pixels never become JSON lists or base64 strings.
Metadata buffers have a stricter 4 MiB byte cap, at most 65,536 records per table and 4,096 UTF-8 bytes per
string. Preflight metadata structure/string sizes before constructing rich objects, reserving parser/object
memory within the session budget; byte length alone is not a sufficient memory estimate.
No compressed input is accepted by this initial transport. Validate finite floating inputs before computing.

**Job execution (implemented in card M8.3.5; amended in the corrections after M8.3.8).** A job runs in a worker process (`engine/method_worker.py`), never in the coordinator. *Amendment of 14 November 2026:* the first version started one process per job; measuring M8.3.8 showed that starting the interpreter and importing NumPy cost about 0.7 s of the 0.9 s a large section needed, so the coordinator now keeps **one long-lived worker, started with `-I -B -u`, that runs one job at a time**. Isolation is unchanged where it matters: the coordinator still never trusts the answer (below), kills the worker on a cancellation that is not acknowledged within 1.5 s, on the 120 s deadline, on an answer it does not approve, on any write failure and when a job is abandoned (a surviving worker could answer an old job to a new one), starts a new worker for the next job after any of these or after an unexpected exit, and stops an idle worker after 30 s. The coordinator writes a job description `{method, cancel_path, output_dir, inputs: {name: {path, dtype, shape}}}` into a private folder of the session scratch directory and sends the absolute path of that file as one line on the worker's stdin; end of input stops the worker at once. The worker maps the numeric inputs read-only and unmaps them before it answers, so the coordinator can delete the buffers. Cancellation is a marker file the method polls between blocks of 256 rows. The worker writes all result columns, packed (see "Result buffer" under `section.analyze`), to one file `<output_dir>/result.bin` and answers each job with exactly one JSON frame: `{ok, dimensions, packed:{byte_length, sha256, layout}}`, `{error:{code,field}}` for a rejected input, or `{cancelled}`. The job description also carries the SHA-256 that the coordinator verified for each input (`inputs: {name: {path, dtype, shape, sha256}}`), which lets the worker remember, by those hashes only, the validation and the row counts of masks it has seen and the decoded metadata tables, bounded in size and lost with the worker; a job that changes only the settings then counts nothing. For an input made with `buffer.derive` the description adds `derived_from: {sha256, ranges}`: the hash of the base and the `[start, end)` byte ranges that the coordinator itself wrote into the copy, so every other byte is the base's (card M8.4.5). When the worker holds the base's validation and counts for the same ROI, number of classes and stack tables, and every object listed in both versions has the same effective class, it validates and counts only the image rows those ranges touch (an object listed in only one version cannot occur in the unchanged rows: the whole new label image is validated whenever the list of objects changed, and the base was validated without the new ones); otherwise it does everything, as for any buffer. The coordinator never trusts the answer: it checks the frame and the layout (names, types, shapes against lengths, alignment, no overlap, size of the file), moves the file into the buffer store, then reads it once to check its SHA-256 and that every float64 column is finite, against the session budget; any mismatch, an unapproved or missing answer, a worker that ends before answering, a crash or the 120 s deadline is `INTERNAL` and nothing is adopted. An answer that passed these checks stands even if the worker dies right after it. Job folders are removed when the job ends. Worker error codes are limited to the stable codes of this section and the field to a plain name.

Serialize each descriptor/binary pair without interleaving frames; allow at most two unacknowledged chunks
per direction. Both ends must continuously drain the opposite pipe, and schedule cancellation/control messages
between pairs. A partial pair, unexpected binary frame, EOF or malformed frame invalidates the session; main
cleans it up and reports failure without touching live data. Main applies the same bounded streaming policy
at the renderer IPC boundary; reading a whole buffer to split it afterwards does not satisfy the contract.

Reuse of inputs (card M8.4.2, client side): a client may keep the committed input buffers of a section between analyses and name them in later
`section.analyze` requests, bounded by 16 sections and 256 MiB and valid only for the identity of the data they hold (masks) or the
SHA-256 of their bytes (tables). Because those buffers stay live, the engine admitted 256 handles per session (it was 128; 1,024 since card M8.5.2, §9.7) and the bridge 512
tokens per page (1,024 since card M8.5.3); the byte budget is unchanged.

Working pixels of small sections (card M8.4.9, client side): a client may keep the working image of a section that is not tiled (the
array the interface decoded, after crop, downsampling and rotation) as `rgba` `u8[h,w,4]` and, for a 16-bit source, `rgba16`
`u16le[h,w,4]`, C order, row 0 at the top, valid for one *pixel identity*: the SHA-256 of `pixels/1|w|h|bits|<SHA-256 of rgba>|<SHA-256 of
rgba16 or empty>`. They are bounded separately from the inputs: at most 192 MiB and 16 sections, least recently used first; pixels larger
than 192 MiB are never kept (`LIMIT_EXCEEDED`, field `pixels`; such images belong to the tile store of §8). When the engine reports its
budget full, a client drops the pixels of other sections (and, for an analysis, their inputs too) and tries once more. With the inputs (9
buffers) and the pixels (2) of 16 sections a page holds at most 176 live buffers, within the 1,024 handles.

*Budget decision of card M8.4.9 (measured 22 November 2026, recorded before any bound was changed).* The question was whether masks (256 MiB),
pixels (192 MiB) and the transient reserve fit the 512 MiB session budget together with working copies, or whether the bounds must be lower or
the budget 768 MiB. Measured with `tools/measure_engine_analysis.mjs --only pixels --pixel-pairs 2` on the primary reference host (Windows 11,
Ryzen 7 7700X, 31 GiB, Electron 45.2.2, bundled Python 3.12.16), engine on, every section's pixels made resident through the program's client,
then every mask sent again (a new mask version everywhere) and the interval size changed with the pixels resident
([evidence](validation/M8.4.9-pixels-windows.json), working tree of the card on `956f3e3`). Public six-section example (8-bit, 344-351 x
6,500-7,500): masks 72.6 MiB, tables 0.1 MiB (charged 9.5 MiB at 64 times), pixels 58.1 MiB; engine charge with everything resident 156 MiB,
169 MiB while every mask is sent again. Generated eight-section project (960 x 6,400, 8-bit): masks 234.4 MiB, tables charged 4.1 MiB, pixels
187.5 MiB; charge 442 MiB resident and 464 MiB while every mask is sent again (the client's 256 MiB mask bound already holds the old and the
new copy of a section's masks together, so that bound includes the working copies). In both projects every pixel buffer stayed resident, the
engine never reported its budget full (0 events in 4 runs with the engine on) and every analysis ended `ready`. **Decision:** the session budget
stays 512 MiB and the bounds stay 256 MiB (inputs) and 192 MiB (pixels): their sum with the reserve is 464 MiB, which leaves 48 MiB for the
64-fold charge of metadata tables and for results; a project whose tables need more makes the engine refuse a buffer, and the client then
drops other sections' pixels and inputs and tries once more (counted as `budgetFull` in the client's statistics). The disk cap stays 1 GiB.
Process-tree memory over the same runs (sampler of §7 at 25 ms, from the pixel upload to the end of the analyses; nearest-rank median of two
runs per mode): public 912 MiB engine off, 1,095 MiB engine on with pixels resident (limit 1,168: passes); generated 1,786 and 1,841 MiB
(limit 2,042: passes; highest single run with the engine on 1,987 MiB). Not measured: macOS, Linux, a clean machine, 16-bit sections in
these projects (both are 8-bit; 16-bit transfer is covered by tests, not by this measurement).

Record tables (card M8.4.10, client side): a client may keep record tables (§4, "Tables") between requests, bounded separately: at most
16 MiB as the engine charges them (values and validity once, the `utf8json` description 64 times) and 16 tables (128 since card M8.5.3, §9.7), least recently used first;
a table that does not fit is never kept (`LIMIT_EXCEEDED`, field `table`). With the inputs (256 MiB), the pixels (192 MiB) and the reserve
(16 MiB) this takes 480 MiB of the 512 MiB session budget and leaves 32 MiB for the 64-fold charge of the analyses' metadata tables (at
most 9.5 MiB measured in card M8.4.9) and for results; the budget is not raised. The 3 buffers of 16 tables and the 11 of 16 sections are 224
live buffers, within the 1,024 handles. When the engine reports its budget full while a table is sent, the client drops the other tables and
the resident pixels and tries once more.

Initial limits: 256 MiB per buffer; 512 MiB per engine session for all staged/committed buffers, queued-job
snapshots, results and admitted scratch arrays together; 1 GiB private scratch-disk cap. Admission uses checked
size estimates including conversion and overlapping class layers; reject before allocation when the estimate
exceeds budget. These are first-slice working-data limits, not a promise to process multi-gigabyte images or
a limit on total process RSS. Runtime/Electron overhead is measured separately in §7. No unbounded queues:
one active calculation, four queued calculations per priority (§9.4; jobs other than `method.run` wait as `interactive`), at most 32 pending control requests. Reject excess with
`BUSY`/`LIMIT_EXCEEDED`. Queued jobs pin their buffers and consume the same budget.

The coordinator must service control messages while an isolated CPU worker calculates. Start with one worker;
cap native math thread pools to `max(1, min(4, logical_cpu_count - 1))` before importing scientific libraries.
Acknowledging cancellation and interrupting calculation are separate events. Cooperatively poll cancellation
between bounded work units; begin terminating an unresponsive worker by 1.5 seconds, never publish its partial
output, and leave the coordinator responsive. The result-vs-cancel race is resolved by the target terminal
response; the renderer still applies its revision/cancellation publication check. Main kills/reaps the process
tree on failed shutdown or coordinator failure and preserves unsaved renderer state and the last good save.

Errors have `{code, message_key, retryable, details}`. Stable codes: `INVALID_REQUEST`, `UNSUPPORTED_METHOD`,
`UNSUPPORTED_INPUT`, `INVALID_BUFFER`, `LIMIT_EXCEEDED`, `BUSY`, `INTERNAL`. Details contain allowlisted field
names/limits, not images, table values, local paths or tracebacks. Translate message keys through `i18n.js`.
Diagnostics use the existing opt-in policy and a bounded stderr tail (64 KiB), without recording scientific
content. A killed/failed transport is reported by main as `ENGINE_UNAVAILABLE`; retry creates fresh tokens
and resubmits only a still-current snapshot, never silently selects the JavaScript science path.

## 4. Scientific input contract: section.intervals/1

All entries below are committed buffers. Catalogues preserve source order and original class IDs. Transport
UUIDs are separate from saved identifiers. Coordinates are original-image pixel coordinates, zero-based,
with half-open ROI bounds; row zero is the top. No geometric downsampling is allowed for counts.

| Input | Type and meaning |
|---|---|
| `labels` | `i32le[height,width]`: 0 = matrix, positive = object ID, negative = overlap-stack index. |
| `exclude` | `u8[height,width]`: exactly 0 or 1; 1 excludes a pixel from numerator and denominator. |
| `objects` | `utf8json` ordered records `{id, class_id, predicted_class_id, confidence}`. IDs are unique positive int32; class references are catalogue IDs or null; confidence is finite in [0,1]. No effective-class calculation in JS. |
| `classes` | `utf8json` ordered records `{id, name, counts}`; unique nonempty IDs, boolean counts. Include disabled/non-counted classes and `undet` when used; names/IDs remain literal metadata, not column identifiers to execute. |
| `stack_offsets` / `stack_members` | `u32le[K+1]` CSR offsets and `u32le[N]` object IDs. Row 0 is empty; label `-k` selects row k. Offsets start at zero, are monotonic, end at N; every member resolves to an object. Reject duplicate members or dangling references. With no overlaps use offsets `[0,0]` and omit members (N=0). |
| `settings` | `utf8json` object with `width`, `height`, `roi:{x0,y0,x1,y1}`, `top`, `bottom`, `units`, `bin_cm`, `min_valid`, `no_data_pad_cm`, `include_predictions`, `prediction_threshold`, `count_candidates`, `schemes`, `age_units`. Dimensions match masks; ROI is nonempty and in bounds; finite bottom > top; units `mm`, `cm` or `m`; bin_cm > 0; min_valid and threshold in [0,1]; padding >= 0. Age units are literal project metadata or null. |
| `age_model` | `utf8json` ordered `{depth, age, min, max}` records in the section's depth unit and declared age unit. Empty means no model. min/max are both finite or both null. Reproduce current duplicate-depth/range validation and out-of-range missing values in fixtures before enabling this capability. |
| `manual_indices` | `utf8json` ordered `{from, to, BI, ii}` records, same depth unit; finite from < to, integer or null indices accepted by the current scheme. Last matching half-open range wins; calculated indices remain separate. Empty is allowed. |

For each object: use an assigned class first; otherwise use its prediction only when included and confidence
meets the threshold; otherwise use `undet` if candidates count, or no class. A resulting class contributes
only when its catalogue `counts` is true. A pixel counts once in total if any effective counted object covers
it, once for each distinct effective counted class in an overlap, and never when excluded. Class percentages
can sum above the total. “Hidden” display classes do not change counting. Broken masks/class references fail
before counting; they must not be repaired by silently dropping objects.

Convert units with mm=0.1, cm=1, m=100 centimetres. First multiply `(bottom-top)*unit_factor`, divide ROI row
count by that span, then multiply by bin_cm; clamp the application interval to at least one row. Preserve this
binary64 operation order and half-up edges `floor(j*bin_px+0.5)`, clipping the final interval. Minimum valid
fraction uses interval area and includes equality. No valid pixels or insufficient valid area produces missing
percentages/indices. Apply no-data padding in centimetres converted to the section unit, using the current
strict overlap comparisons with 1e-9 depth-unit epsilon; then attach ages/ranges and manual indices at centres.

`schemes` encodes ordered `{name, precedence, tiers}`; each tier has finite `{lower, upper, value}`, with
lower < upper and an int32 value; precedence is `first` or `last`. Membership is half-open [lower,upper).
The desktop adapter requests `first`, matching `core.js::classify`; the public Python adapter preserves
`last`, matching `IndexScheme.classify`. Non-overlapping default schemes agree. M8.3 must test both policies
through one shared classifier primitive rather than changing either public contract (done: `kernels/classification.py`).
Unmatched tiers produce missing indices. The implemented method (`methods/section_intervals.py`, M8.3.4) narrows three
points of this contract and rejects violations with `UNSUPPORTED_INPUT`: tier values must be non-negative (a negative
value could not be told from a missing index), age-model depths must be strictly increasing, and an age model has a range
on every record or on none. Seeds are absent for this deterministic
method. Future stochastic methods must declare seed, RNG algorithm/version, fold membership, model hash,
backend and settings; an integer seed alone does not establish cross-language equivalence.

Known integration gaps must be addressed explicitly in M8.3: Python's public mask API limits classes to 255,
rejects sub-row pixel intervals instead of clamping, does not accept object IDs/stacks, and omits application
padding/manual/range processing. Its DataFrame omits a single-class percentage column. Reconcile these through
shared engine primitives and public adapters, retaining public callers; do not write another independent
binning algorithm in the bridge. Avoid a full classes × height × width overlap allocation when over budget.
An initial experiment may advertise a narrower capability (e.g. <=255 classes, empty age model); unsupported
snapshots fail visibly under the flag. General promotion requires the full supported application domain, or
an explicitly approved compatibility decision; truncation and silent omissions are never accepted.

**Tables (card M8.4.10).** A method that takes a record table (depth/age records, data tables, multiproxy series) receives it as three
inputs: `<name>` (`utf8json` `{version:1, rows, columns:[{name, unit}]}`, columns in order), `<name>_values` (`f64le[columns, rows]`,
column *i* in row *i*) and `<name>_valid` (`u8[columns, rows]`: 1 present, 0 missing; a missing slot holds 0, never NaN). Valid values are
finite. Limits: 1-256 columns, 1-1,048,576 rows (an empty table cannot be transferred: a method declares it optional instead), at most 8 MiB
for values and validity together, a description of at most 32 KiB, column names non-empty, unique and at most 256 UTF-8 bytes, units at most
64. Column names and units are literal metadata, never identifiers to execute; a method names the columns it accepts. The client builds
the buffers with `tablesnapshot.js::buildTableSnapshot` and a method decodes them with `methods/validation.py::table`, which refuses every
violation naming the input (`<name>`, `<name>.version`, `<name>.rows`, `<name>.columns`, `<name>.columns.name`, `<name>.columns.unit`,
`<name>_values`, `<name>_valid`). The *table identity* is the SHA-256 of `table/1|<rows>|<JSON of [name, unit, SHA-256 of the column's
values, SHA-256 of its validity] per column>`.

## 5. Result contract and provenance

`outputs` contains columnar committed buffers: `row_start`, `row_end` (`u32le[B]`, ROI-relative half-open);
`valid_count`, `bio_count` (`u64le[B]`), `class_count` (`u64le[B,C]` in catalogue order); `depth_top`,
`depth_bottom`, `depth`, `valid_pct`, `bioturbation_pct` (`f64le[B]`); `class_pct` (`f64le[B,C]`);
`no_data` (`u8[B]`); `age`, `age_min`, `age_max` (`f64le[B]`); `manual_BI`, `manual_ii` (`i32le[B]`);
and `indices` (`i32le[B,S]` in scheme order). Counts include all raw valid observations even when a
percentage is suppressed by padding. B, C and S are returned as positive safe integer dimensions in result
metadata. A request with no classes/schemes is unsupported in this first contract, rather than ambiguous
zero-dimension transport. Empty source sections are rejected before analysis.

Each nullable numeric column has a same-shape `<name>_valid` u8 buffer (0/1). Invalid numeric slots are zero;
valid floats must be finite. Counts, row bounds, valid_pct and no_data are non-nullable. Missing scientific
values map to the current UI's null and public Python NaN/nullable indices at adapters. Preserve manual
indices independently even in no-data intervals. No JSON NaN, sentinel index masquerading as a value or
rounding of counts to unsafe JS integers: validate before conversion or keep uint64 buffers.

Provenance includes engine package version, method version, runtime manifest hash, input hashes (including
settings), source revision, class/scheme order, declared units, model/backend identity where relevant,
deterministic/RNG identity, and stage timings. This is scientific provenance, distinct from optional usage
diagnostics. Record it with accepted results in the later versioned project extension; first test old readers,
export/import and saves before adding that extension. No project format changes occur in M8.1.

## 6. Ordered deliveries and rollback

1. **M8.2:** standard-library process coordinator, bounded framing/buffers and synthetic echo/failure fixtures;
   packaged minimal Python/NumPy/pandas/Pillow runtime, constraints/checksums under M3.2.4. No Torch in basic
   startup. API/CLI remain direct calls to engine functions, not subprocess clients. Verify clean machines,
   offline startup, malformed/truncated messages, pressure, cancellation, worker death and main shutdown.
2. **M8.3:** object/overlap resolver and shared count primitives, then complete interval postprocessing and
   actual desktop binding. First parity fixtures, then edit/undo/redo, results, CSV and save/reopen. Evaluate
   the existing opt-in NumPy counting path under M3.1.6; this design does not promote it by assertion.
3. **M8.4** (order decided 15 November 2026): part A (inputs resident in the engine; restart; milestone gate), then part C
   (M2.3: the round-trip measurement of §7, multi-gigabyte fixtures, tile store and pyramid import, tiled viewer, tiled masks and
   editing, analysis on tiles, large-project saving), then part B (engine-held pixels of small sections and record tables for
   M8.5), each as separate accepted increments.
4. **M8.5a:** depth/age parsing and record/formula transformations; **5b:** image filters, detection and object
   features; **5c:** ichnotaxon classifiers/embeddings; **5d:** multiproxy rules/models/interpolation and fitted
   statistics; **5e:** U-Net inference, then training integration after M3.2.5. Each increment has its own
   versioned method, reference outputs, numerical tolerances, cache invalidation and workflow regression.
5. **M8.6:** promote only accepted methods and remove their duplicate desktop implementations; retain versioned
   reference fixtures. Test/export projects from the last supported HTML artifact before freezing it. Publish
   user/contributor/current technical documentation and CI changes at cutover, not as claims in this plan.

Use a maintainer-only, default-off `SEDCORETOOL_ENGINE_EXPERIMENT=1` launch flag beginning in M8.2. M8.2 may
negotiate transport without advertising section analysis. No normal UI toggle offers two engines. For explicit
developer rollback, close the experiment and restart without the flag using the preserved project/snapshot.
Keep the existing path as normal default until acceptance; no automatic per-job fallback. Remove the flag and
duplicate science only at M8.6 after the complete required workflow passes, retaining Git/artifact provenance.

M8.1 delivery verification: 313 Python tests passed (six optional/permission skips), 218 Node tests passed,
JavaScript type checks passed with no new diagnostics (879 existing diagnostics; 205 resolved baseline entries),
Ruff, version consistency, whitespace, local document links and the standalone build passed. Source inspection
verified the first/last custom-tier distinction. No scientific/runtime code, UI or saving changes were made;
no new behaviour tests or repeated browser E2E were needed. The performance gates below remain unmeasured.

## 7. Predeclared verification and performance gates

These are future pass/fail criteria, not measured outcomes or a claim that Python is faster than JavaScript.
Reuse [M0.1](benchmarks/M0.1.md), [M3.1.3](benchmarks/M3.1.3.md) and its
[20 boundary fixtures](../tests/fixtures/fractional-boundaries.json). Historical Python kernel timings exclude
bridge/startup and cannot establish desktop end-to-end performance.

| Area | Gate before enabling the first scientific slice |
|---|---|
| Numerical parity | Exact row bounds, valid/total/class counts, masks, label decisions, BI/ii and missing-value patterns. Absolute error <=1e-9 in declared depth units and percentage points; no tolerance relaxation after seeing results. Ages must match existing interpolation on fixed models within 1e-9 declared age units. Validate adjacent half-row binary64 inputs and custom schemes. |
| Required inputs | Public six-section U1385I-1H and generated eight-section 960×6400 M0.1 project (PCG64 seed 138501), 2 and 1.37 cm. Add small synthetic fixtures for same/different-class overlaps, excluded overlap pixels, non-counted classes, predicted/candidate thresholds, ROI offsets, mm/cm/m, zero valid area, exact min-valid threshold, padding, ordered manual ranges and age boundaries/ranges. Fingerprint bytes and revisions; no private images. |
| Matched timing | Same desktop binary, hardware, fixture, settings and decoder output, flag off/on; one warm-up then six alternating AB/BA paired fresh-process runs, record every sample. Report cold startup separately, cold analysis and cached unchanged reanalysis separately. Warm end-to-end median <= max(1.25×legacy median, legacy median +50 ms); empirical nearest-rank p95 <= max(1.5×legacy p95, legacy p95 +100 ms). Small sample p95 is the sample maximum; publish that limitation. *Warm scenarios (decided 14 November 2026, evaluated by `tools/engine_gates.mjs`):* the formula above is applied separately to (a) the interval size changes on every section with no new mask version; (b) one edit of the largest section (the deletion of the trace whose area is closest to 2,000 pixels, through the interface's own Delete key), its undo and its redo, the three pooled; (c) the same analysis requested again with nothing changed. Each sample runs from the request to the published result of the sections it touches; the 100 ms delay that the interface adds before it analyses after an edit is outside the sample in both modes. Cold opening of a project is reported separately. |
| Timing boundaries | Full job starts when the analysis snapshot is requested and ends when validated current results are published; include snapshot/hashing, transfers, conversions, queue, computation and return. Report stages separately. Cold engine ready <=5 s from spawn through validated hello, with no dependency/network download. Repeated unchanged analysis must exercise the real cache/publication path. |
| Responsiveness/cancel | During the largest first-slice fixture, injected UI input-to-next-frame p95 <=100 ms. Cancel acknowledgement <=250 ms; target reaches terminal cancelled (or already completed) and releases temporary work within 2 s. Test cancellation during upload, queue, count and result transfer, plus a noncooperative worker; stale results never publish. |
| Whole-process memory | Sample simultaneous RSS sum of the complete Electron + engine + worker tree at the M0.1 25 ms target cadence, excluding harness/server; report cadence gaps, process list, idle RSS and observed peak, including transfer/conversion overlap. Peak <= max(1.10×matched legacy peak, legacy peak +256 MiB). Record shared-page double-counting/sampling limits; kernel-only memory is insufficient. |
| Release/recovery | Ten open/analyse/close cycles release all session project handles; no growth in outstanding buffers/jobs/scratch files. After warm-up, final closed-state RSS <= first closed-state RSS +64 MiB. Kill the worker/coordinator mid-job and interrupt saves; live unsaved edits and the last good save/backup remain recoverable. |

**Interactive targets (adopted 15 November 2026 with option A, ARCHITECTURE D10).** The matched-timing limits above compare the
engine with the JavaScript calculation, which runs inside the page in 1-17 ms; no out-of-process design can meet them for an edit,
and they do not describe what the user perceives. From part C of M8.4 on, interactive paths are accepted against the absolute
targets below, on the primary reference host, warm. The matched-timing formula is still computed and reported for scenarios
(a)-(c), and stays the gate for every path that has no target here. The numbers were proposed by the design review of 15 November
2026 and adopted with the maintainer's choice of option A; changing them is a maintainer decision, recorded here before a
validation run.

| Interaction | Target | How it is measured |
|---|---|---|
| Pan and zoom over any image size, tiles already cached | frame interval median <= 17 ms (60 frames per second), p95 <= 33 ms | frame intervals during a scripted 5 s pan and 10 zoom steps |
| Pan and zoom onto tiles not cached | a lower-resolution level is shown in the next frame; full resolution within 250 ms (p95) | from the frame that needs the tile to the frame that shows it |
| Input during a brush stroke or a pan | input-to-next-frame p95 <= 33 ms, with the engine experiment on and off | 60 injected pointer moves (the responsiveness method above) |
| Interval table after an edit that touches at most 4 tiles, any image size | p95 <= 150 ms | as scenario (b): from the analysis request (after the interface's fixed 100 ms grouping delay, which is the same in both modes) to the published table |
| A setting changed for the whole project (interval size) | p95 <= 300 ms for all sections together | scenario (a) |
| First useful view of a multi-gigabyte image whose pyramid exists | <= 2 s | from the open command to the first frame with image content |
| Building the pyramid of a newly imported image | reported (MiB/s); progress at least once a second; cancellation acknowledged <= 250 ms | M8.4.13 fixtures |
| Response of controls (buttons, menus, tabs) while the engine works | p95 <= 100 ms | injected clicks |
| Whole-process-tree memory while viewing, editing and analysing any of the 2, 4 and 8 GiB fixtures | peak <= 2 GiB | the sampler of "Whole-process memory" above |
| Scrolling a table of 100,000 rows; drawing or updating a figure of 50,000 points | frame interval p95 <= 33 ms | card M2.1.4 |

**Interactive-calculation rule (decided 15 November 2026; applied once by card M8.4.12, outcome in ARCHITECTURE D11).** The
interval table of tiled sections is computed by the engine (option A) if one edit of a one-tile section, sent through the real
chain (page, main process, coordinator, worker) and published, takes p95 <= 100 ms on the primary reference host **plus** the
in-process median time to turn the row counts of the tallest fixture section into its interval table. The threshold is stricter
than the 150 ms target to leave room for the tiled viewer. Otherwise the interval table and percentages of the interactive path
stay in JavaScript (option D of the review), with the Python method as the reference and exact parity tests on every fixture, and
every other method still moves to the engine; a design session then revises the part C cards before M8.4.14. macOS and Linux
numbers are not part of the rule (shared CI runners are too noisy for a 100 ms decision); they are measured at the release gate.

Primary reference host: the existing Windows 11/Ryzen 7 7700X/approximately 32 GiB baseline machine. Record
actual OS, RAM, CPU topology, Electron/Node/Python/native library versions, thread limits, power settings,
source commit, runtime manifest and fixture hashes with each run. Re-run matched comparisons on another host
when this one is unavailable; do not compare unmatched historical numbers. Basic startup/correctness/packaging
must pass on every supported desktop platform before promotion. M8.4 predeclares separate multi-gigabyte and
disk/CPU-headroom gates before implementing that path; increasing this prototype's limits does not pass it.

If a gate fails, record the failed measurement and next narrow correction; leave the experiment off. Changing
these gates requires a documented decision before a new validation run. Rust/GPU or a replacement interface
needs separate evidence and authorisation. M8.1 is complete when this source-backed contract and its ordered
gates are delivered; it does not certify M8.2 packaging or M8.3 numerical/performance acceptance.

## 8. Tile store v1: pixel pyramids (card M8.4.14)

Specified on 16 November 2026, before any store file was written. Implemented in the engine on 17 November 2026 (card M8.4.14 steps 3-5:
`src/sedcoretool/store/`, the three operations below); **the interface does not use it yet** (card M8.4.15).
It realises [ARCHITECTURE §3.4](ARCHITECTURE.md#34-tile-store-for-large-images-planned-part-c-of-m84) and its "Design of part C" for
the pixel pyramid. Mask tiles and manifests (decision 6) are §8.7 (card M8.4.16). The format is independent of the browser,
IndexedDB and Electron (D12): a program that reads this section can read and write a store without SedCoreTool.

### 8.1 Roots and ownership

The main process passes the pyramid root when it starts the coordinator (`--pyramid-dir`, an absolute folder under the program's user
data, `pyramids/`). The engine writes nothing outside that root and its scratch folder. The renderer never sees a path: it names a
pyramid by its identifier (below), and a source file only through a token the main process issued for a file the user chose (card M8.4.15).
Only the engine writes the root (ARCHITECTURE §3.4 rule 1).

### 8.2 Identity and layout

A pyramid is identified by the **SHA-256 of the source file's bytes** (64 lowercase hexadecimal characters), computed by the engine while
the build starts. Its folder is `<root>/<sha256>/`. All integers are little-endian; all JSON is UTF-8 with the strict rules of §3.

| Path inside `<root>/<sha256>/` | Content |
|---|---|
| `pyramid.json` | `{format: "sedcoretool.pyramid", version: 1, source: {sha256, size, name}, width, height, channels, bits, tile: 512, levels: [{level, width, height, rows, cols}], compressor, complete: true}`. `name` is the file name without any folder. `channels` is 1 (grey), 3 (RGB) or 4 (RGBA); `bits` 8 or 16. `compressor` is `null` in format version 1: decided by the rule of M8.4.14 on 17 November 2026 ([evidence](validation/M8.4.14-compression-windows.json)): building
`rgb2g` took 20.4 s without a compressor and 51.8 s with zlib level 1 (39 % of the throughput, the rule required 70 %), for 39 % less disk and a tile-read p95 of
8.5 ms against 4.9 ms. Readers also accept `{"id": "zlib", "level": 1}`, which a later format version may adopt. The file is written last, through a temporary file and an atomic rename; a folder without it, or with `complete` other than `true`, is not a pyramid. |
| `.zgroup` | `{"zarr_format": 2}` |
| `.zattrs` | `{"multiscales": [{"version": "0.4", "axes": [{"name": "y", "type": "space"}, {"name": "x", "type": "space"}, {"name": "c", "type": "channel"}], "datasets": [{"path": "<k>", "coordinateTransformations": [{"type": "scale", "scale": [2^k, 2^k, 1]}]} ...]}]}` |
| `<k>/.zarray` | Level `k` as a Zarr version 2 array: `{"zarr_format": 2, "shape": [height_k, width_k, channels], "chunks": [512, 512, channels], "dtype": "\|u1"` or `"<u2", "compressor": <as in pyramid.json>, "fill_value": 0, "order": "C", "filters": null, "dimension_separator": "."}` |
| `<k>/<i>.<j>.0` | The tile in tile row `i`, tile column `j` of level `k`: exactly `512 x 512 x channels` samples in C order (y, x, channel), compressed by `compressor` or raw. Tiles on the right and bottom edges are padded with zeros to the full size, as Zarr requires. |
| `<k>/.tiles.sha256` | `rows_k x cols_k` records of 32 bytes, row-major: the SHA-256 of each tile's **uncompressed** bytes (padding included). Zarr readers ignore this file. |

**Identity record** (card M8.4.15, decided by the maintainer on 17 November 2026): `<root>/identities.json`, written by the engine after it has hashed a
source whole, so that adding the same file again does not read it whole (8 GiB took about 7 s). Content: `{format: "sedcoretool.identities", version: 1,
entries: [{path, size, mtime_ns, sample, sha256}]}`, newest last, at most 1,024 entries and 1 MiB; `path` is the absolute, case-normalised path,
`mtime_ns` the modification time in nanoseconds, `sample` the SHA-256 of the size (8 bytes, little-endian) followed by the first, middle and last MiB of
the file (the whole file when it is at most 3 MiB), `sha256` the SHA-256 of the whole file. It is written atomically; a record that is missing, larger
than 1 MiB or not exactly of this form is ignored and replaced. Readers other than the engine ignore it. **Known limit:** a file rewritten in place with
the same size, the same modification time to the nanosecond and the same sampled MiB, but other bytes elsewhere, is taken for its old state.

Levels: level 0 is the source at full resolution. Level `k + 1` has `ceil(width_k / 2) x ceil(height_k / 2)` pixels; the last level is the
first one whose width and height are both at most 512. A pixel of level `k + 1` is, for each channel, the integer mean of the `n` pixels
(1, 2 or 4) of level `k` that it covers, rounded half up: `(sum + n // 2) // n`, so `(a + b + c + d + 2) // 4` inside the image. Grey stays grey,
RGB stays RGB, RGBA averages alpha like the other channels; 16-bit samples stay 16-bit. No colour management, gamma or orientation tag is
applied: samples are copied as stored (as `app/js/tiff.js` does today).

### 8.3 Sources

The engine opens a source with libvips (ARCHITECTURE §3.4 decision 4) and accepts only these loaders: TIFF (classic and BigTIFF, first page or
image only), JPEG and PNG; anything else is `UNSUPPORTED_INPUT` with `details.field = "source"`. Accepted samples: 8-bit or 16-bit unsigned, 1, 3
or 4 bands (a grey image with alpha, 2 bands, is refused as today; 4 bands must be RGBA: a CMYK image, TIFF or JPEG, is refused with
`details.field = "source"`, card M8.4.40). Limits checked from the header before any pixel is read: width at most
262,144 and height at most 16,777,216 pixels; one band of 512 rows at most 256 MiB (`width x 512 x channels x bytes`); a JPEG or PNG at most
1 GiB decoded (`width x height x channels x bytes`; maintainer, 16 November 2026), refused otherwise with `UNSUPPORTED_INPUT`, `details.field =
"source.size"` and a message that suggests TIFF. TIFF sources are read by region (random access); JPEG and PNG sequentially, in bands.

### 8.4 Building

`pyramid.build` runs in the method worker as a job, so the coordinator stays responsive. Order: (0) if the identity record (§8.2) has an entry with
the source's path, size, modification time and sampled hash, and the pyramid it names is complete with that `source.size`, the job ends at once with
`reused: true` without reading the source whole; the record is never used to build; (1) otherwise compute the source SHA-256 (stage `hash`) and record it;
if `<root>/<sha256>/pyramid.json` is complete and its `source.size` matches, the job ends at once with `reused: true`; (2) estimate the disk need
(all levels, uncompressed, plus 1 %); (3) free space: delete complete pyramids that no session of this coordinator has opened, least recently used
first (the modification time of `pyramid.json`, touched whenever a pyramid is opened), until the root's total plus the need is at most the budget
(50 GiB by default, set by the main process with `--pyramid-budget-bytes`) and the disk keeps at least 1 GiB free; if that is not possible, the job
fails with `LIMIT_EXCEEDED`, `details.field = "disk"`; (4) write everything into `<root>/.partial-<uuid>/`, one band of 512 rows of level 0 at a
time, each band feeding the next levels as soon as they have two rows of tiles' worth of input (stages `level0` and `levels`), so the working
memory stays within 512 MiB; (5) write the `.tiles.sha256` files, then `pyramid.json`, then rename the folder to `<sha256>`. If another build
finished the same pyramid meanwhile, the new folder is removed and the existing one is used. A failure removes the partial folder before the
answer; a cancellation answers at once and the worker deletes the folder in the background (deleting gigabytes before answering took up to 0.66 s);
a killed worker leaves it. Every coordinator deletes `.partial-*` folders when it starts and before each build. A full disk during the build is
`LIMIT_EXCEEDED` with `details.field = "disk"`.

Progress: the worker writes `<job folder>/progress` as JSON `{stage, completed, total}`, through a temporary file and an atomic replacement; when
the replacement fails because the coordinator is reading the file (Windows), that update is skipped. The coordinator reads it at most 10 times
per second and sends events `{stage, completed, total}` (§3) with the build's request ID; the desktop client restarts its idle timeout (90 s) on
each event. A build has no fixed deadline; the coordinator kills it when its progress
has not advanced for 60 s. Cancellation follows §3 (marker file, polled before every tile; acknowledgement within 250 ms, measured 7-15 ms on Windows in M8.4.14; kill after 1.5 s).
libvips' own caches are limited (`cache_set_max_mem` 64 MiB, `cache_set_max_files` 16) and its thread pool uses the engine's thread cap.

### 8.5 Operations

| Operation | Request payload | Successful result |
|---|---|---|
| `pyramid.build` | `{path, name}` or `{path, name, expect}`: `path` absolute, to a regular file; `name` its display name (no separators); `expect` (card M8.4.18b) the SHA-256 the file must have: another one ends the job with `UNSUPPORTED_INPUT`, `details.field = "source.sha256"`, as soon as it is known (from the identity record, or after stage `hash`), before any pyramid is built or removed. **Accepted only from the main process**; the renderer bridge never forwards a path (card M8.4.15 maps tokens to paths). | `{pyramid, width, height, channels, bits, levels, reused, disk_bytes}`; events `{stage: "hash" \| "level0" \| "levels", completed, total}`. |
| `pyramid.info` | `{pyramid}` | the parsed `pyramid.json` (only for a complete pyramid; touches its modification time). |
| `tile.read` | `{pyramid, level, positions: [[row, col], ...]}`, 1 to 16 positions inside the level's grid | `{tiles: [{row, col, byte_length, sha256}, ...], frames: [n1, n2, ...]}` in request order, immediately followed by the uncompressed tile bytes of all tiles, concatenated in that order and cut into binary frames of at most 1,048,576 bytes whose lengths `frames` announces (the client accepts exactly those frames, then checks each tile's SHA-256). Each tile is read, decompressed if needed and checked against `.tiles.sha256` before anything is sent; if any tile fails, the response is an error (`INVALID_BUFFER`, `details.field = "tile"`) and no binary frame follows. |

`tile.read` and `pyramid.info` run in the coordinator (standard library only: file reads, `zlib`, `hashlib`); verified tiles are kept in a
least-recently-used cache of at most 256 MiB; the descriptions of the last 64 pyramids used and their levels' SHA-256 lists (at most 64 MiB)
are kept the same way, and a pyramid whose description leaves keeps nothing in memory (card M8.4.40). Tile bytes are never charged to the session's buffer budget of §3 (they are not buffers).
Error codes are those of §3. A coordinator started without `--pyramid-dir` answers the three operations with `UNSUPPORTED_METHOD`.

The page reaches these operations only through `desktop/tile-ipc.js` (card M8.4.15, behind `SEDCORETOOL_TILED_SECTIONS=1`): a file the user chose becomes an
opaque token (the preload passes its path to the main process; a file made by code has none), a page may build pyramids of its own tokens and read only the
pyramids it built in the session, and every argument is validated again in the main process. Tiles reach the page through `tile.read` (delivery path (a),
chosen by the rule of M8.4.15: one tile p95 7.9 ms, 16 tiles p95 113 ms from the page on Windows).

The method worker reads its command pipe on a private file descriptor; descriptor 0 and the Windows standard input handle point to the null
device. With the pipe on descriptor 0, a thread blocked reading it made libvips crash with an access violation in a stress test (12 processes of 12)
and in about one build in fourteen through the coordinator (found in M8.4.14).

### 8.6 What is checked (M8.4.14)

Exactness against the generator of card M8.4.13 (`tools/make_large_fixtures.py`): sampled level-0 regions equal `pixel_region` byte for byte,
and levels 1-3 equal the same integer mean computed independently with NumPy; two builds of one source give identical tile bytes and hashes.
Hostile sources (huge declared sizes, truncated files, offsets past the end) fail without large allocations. Interrupted builds, a full disk, a
corrupted or missing tile file and a tile-hash file of the wrong length are handled as above.

### 8.7 Mask tiles and manifests (card M8.4.16)

Specified on 17 November 2026, before any mask file was written. It realises decision 6 of
[ARCHITECTURE §3.4](ARCHITECTURE.md#34-tile-store-for-large-images-planned-part-c-of-m84) and decision E of card M8.4.16. The masks of a
tiled section are **project data**, not a cache: nothing here is deleted by a budget.

**Root.** The main process passes the projects folder when it starts the coordinator (`--projects-dir`, an absolute folder under the
program's user data, `projects/`). A project's mask store is `<projects>/<project>/tiles/`, where `<project>` is the project's identifier
(1 to 64 characters `a-z 0-9 _ -`, lower case so that it names one folder on every file system, and never a Windows device name such
as `con` or `lpt1`; the program's project identifiers are already of this form). A section identifier has 1 to 64 characters
`A-Z a-z 0-9 _ -` and is never a path. The renderer names a project and a section only by these identifiers, never by a path; only the
engine writes the folder. A coordinator started without `--projects-dir` answers the operations below with `UNSUPPORTED_METHOD`.

**Layout of `<projects>/<project>/tiles/`.**

| Path | Content |
|---|---|
| `blobs/<aa>/<sha256>` | One stored object: a mask tile or a table. `<sha256>` is the SHA-256 of its **uncompressed** bytes and `<aa>` its first two characters. The file is the zlib stream (RFC 1950, level 1) of those bytes. A blob is written to a temporary file in the same folder, flushed to disk and renamed; an existing blob is rewritten only if it does not decompress to bytes with its name's hash. |
| `manifests/<sha256>.json` | One version of the masks of one section; `<sha256>` is the SHA-256 of the file's bytes, which are the manifest's canonical JSON (below). Written like a blob (temporary file, flushed, renamed); never changed afterwards. |

**Mask tiles.** The grid of a section of `width x height` pixels has `rows = ceil(height / 512)` and `cols = ceil(width / 512)` positions;
the tile at row `i`, column `j` covers pixels `x` in `[512 j, 512 j + 512)` and `y` in `[512 i, 512 i + 512)` of level 0 of the section's pixel
pyramid (coordinates are full-resolution source pixels, ARCHITECTURE §6). A tile has two layers, each exactly 512 x 512 samples in C order (y, x):

| Layer | Samples | Bytes | Values |
|---|---|---|---|
| `labels` | `i32le` | 1,048,576 | as `labels` in §4: 0 matrix, positive object ID, negative overlap-stack index |
| `exclude` | `u8` | 262,144 | 0 or 1, as `exclude` in §4 |

Samples outside the section (tiles on the right and bottom edges) are 0. A layer whose samples are all 0 is **not stored**: the manifest has
no hash for it, and a reader returns zeros.

**Tables** (version 2, card M8.4.22), stored as blobs of their exact bytes, all little-endian:

| Table | Dtype | Rows | Content |
|---|---|---|---|
| `object_ids` | `u32le` | N | object IDs, 1 to 2,147,483,647 (a positive `i32` label), all different, in the page's order of its objects |
| `object_class` | `i32le` | N | index into `classes` of the class given by hand, or -1 |
| `object_predicted` | `i32le` | N | index into `classes` of the predicted class, or -1 |
| `object_confidence` | `f64le` | N | confidence of the prediction, finite, 0 to 1 |
| `classes` | `utf8json` | — | the classes table of §4 (a JSON array of records), at most 4 MiB (the metadata limit of §3) |
| `stack_offsets`, `stack_members` | `u32le` | K + 1, M | the overlap stacks of §4; `stack_members` is `null` when there is no overlap |

N is at most **1,048,576** (2^20). The four object columns have the same N and are all `null` when the section has no object. Unlike
version 1, whose `objects` table was `utf8json` and so limited to about 51,000-56,000 objects by the 4 MiB cap (measured in card M8.4.16
step 7), the columns take 20 bytes per object.

**Manifest.** A JSON object with exactly these members:

```
{"format": "sedcoretool.masks", "version": 2, "section": "<section id>", "width": W, "height": H, "tile": 512,
 "tiles": {"<i>.<j>": {"labels": "<sha256>" | null, "exclude": "<sha256>" | null}, ...},
 "tables": {"object_ids": T | null, "object_class": T | null, "object_predicted": T | null, "object_confidence": T | null,
            "classes": T, "stack_offsets": T, "stack_members": T | null}}                       T = {"sha256": "<sha256>", "byte_length": n}
```

- `section` is a section identifier; `W` from 1 to 262,144 and `H` from 1 to 16,777,216 (the source limits of §8.3), with
  `rows x cols` at most 262,144 positions (68.7 gigapixels; the 8-GiB fixture `rgb8g` has 10,928).
- `tiles` lists only positions with at least one stored layer. Keys are `<i>.<j>` in decimal without leading zeros, inside the grid.
- `byte_length` of a table: `object_ids`, `object_class` and `object_predicted` a positive multiple of 4 up to 4,194,304, `object_confidence`
  a positive multiple of 8 up to 8,388,608, the four giving the same N (or all four `null`); `classes` 1 to 4,194,304; `stack_offsets` a
  multiple of 4, from 8 to 16,777,216; `stack_members` a positive multiple of 4 up to 16,777,216, or `null`.
- **Version 1 manifests** (written only during card M8.4.16, never named by a project) are refused with `UNSUPPORTED_INPUT`,
  `details.field = "manifest.version"`. Any other version is `INVALID_BUFFER`.
- The store checks the object columns when they are committed (below); the classes and stack tables' content is checked by the method that
  uses them (§4).
- **Canonical JSON:** every key and string of a manifest is printable ASCII without `"` or `\`, so the canonical form is simply: keys
  sorted by byte value at every level, no white space, integers in decimal (Python's
  `json.dumps(value, sort_keys=True, separators=(",", ":"))`). A file whose bytes differ from the canonical form of its own content is not a manifest. At most 64 MiB.
- The **identity of a version** is the manifest's SHA-256. Two sections, or two projects, may share blobs.

**Reading.** A manifest is used only if its file's SHA-256 is its name and its content passes every rule above; a blob only if it
decompresses (with a bound of its expected length plus one byte) to exactly its expected length and to bytes with its name's hash. Anything
else is `INVALID_BUFFER` with `details.field = "manifest"` or `"tile"` / `"table"`, and nothing is sent.

**Operations** (in the coordinator, standard library only; they never run in the method worker). They run on one
thread of their own (card M8.4.40), one at a time and in the order they arrived, so a long one (an import, a clean-up, a copy) does not delay `tile.read`,
the progress events of a build or `job.cancel`; each is answered when it finishes. The buffers a mask request names are taken as they are
when it arrives: a `buffer.release` sent after it does not affect it. At most 16 mask requests wait behind the running one; while 16 wait the engine
reads no further request. `shutdown` answers the mask requests received before it first. A blob, manifest or derived file whose rename is
refused by a Windows sharing violation (another program holding the file for a moment) is tried again 5 times within 1.55 s; a full disk is
`LIMIT_EXCEEDED` (`disk`) also when Windows reports it as error 39 or 112.

| Operation | Request payload | Successful result |
|---|---|---|
| `mask.begin` | `{project, section, width, height, base}`: `base` `null` (no masks yet: every tile empty, no tables) or the SHA-256 of a manifest of that project with the same `section`, `width` and `height` | `{staged, rows, cols}`; `staged` a session-local UUID naming a new version in preparation, which starts as a copy of `base`. At most 16 per session. |
| `mask.put` | `{staged, layer, row, col, sha256}` immediately followed by **one binary frame** of exactly the layer's byte length (the descriptor/binary pair of §3) | `{stored}`: `true` when the layer is now stored, `false` when it was all zeros and its entry was removed. The engine checks the length, the SHA-256, the zeros outside the section and, for `exclude`, that every sample is 0 or 1; any failure is `INVALID_BUFFER` (`details.field = "tile"`) and leaves the staged version unchanged. The blob is on disk before the answer. A later `mask.put` of the same layer and position replaces it. |
| `mask.commit` | `{staged, tables}`: `tables` has any of the seven tables above, each the handle of a committed 1-D buffer of §3 with the table's dtype, or `null` for the four object columns together (no object) and for `stack_members` (no overlap); a name left out keeps the base's table. The four object columns and `classes` are given together or not at all; they are checked against each other before anything is written (same N, at most 2^20 rows else `LIMIT_EXCEEDED` `tables.object_ids`; IDs in range and all different; class indices from -1 to the number of `classes` records minus one; confidence finite in [0, 1]; else `INVALID_BUFFER` with `details.field = "tables.<name>"`). With `base: null`, all of them and `stack_offsets` are required. | `{manifest}`: the new version's SHA-256, after every blob and the manifest file are on disk. The staged version is closed (also when the commit fails). Committing the same content twice gives the same manifest. |
| `mask.discard` | `{staged}` | `{}`; closes a staged version without writing a manifest (blobs already written stay, unreferenced). Idempotent. |
| `mask.read` | `{project, manifest, layer, positions}`, 1 to 16 `[row, col]` positions inside the grid | `{tiles: [{row, col, sha256, byte_length}, ...], frames: [n1, n2, ...]}` in request order; an empty layer has `sha256: null` and `byte_length: 0` and sends no bytes; the bytes of the other tiles follow, concatenated and cut into binary frames of at most 1,048,576 bytes, exactly as for `tile.read` (§8.5). Every blob is verified before anything is sent. |
| `mask.retain` | `{project, keep}`: at most 1,024 manifest hashes of the project (card M8.4.18a) | `{removed: {manifests, blobs}}`: every manifest of the project not in `keep` is deleted, then every derived file (`mask.derived.put`) of a manifest that is gone, then every blob that no kept manifest names and no open staged version holds. Every kept manifest must be readable, or nothing is deleted (`INVALID_REQUEST` or `INVALID_BUFFER` with `details.field = "keep"`). The manifests this engine process committed after the newest one `keep` names for the same section (all of a section's when `keep` names none of them) are kept too, with their blobs (card M8.4.31): the page may not have received a commit's answer when it asks for a clean-up. A new engine process has committed nothing, so after a restart only what `keep` names stays. Manifests go first, so a stop half-way leaves only unreferenced blobs, never a manifest without its blobs. The page calls it after a successful save, with the manifests its saved records name and the current acknowledged ones. |
| `mask.info` | `{project, manifest, start}` (card M8.4.18a) | `{section, width, height, tiles, positions, next}`: from position `start` of the manifest's tile list (its order), at most 2,048 tiles as a flat list `[row, col, layers, ...]` with `layers` 1 = labels, 2 = exclusion, 3 = both; `tiles` is the total and `next` the start of the next page, or null. A reopened section learns from it which tiles it must read back. |
| `mask.derived.put` | `{project, manifest, kind, handle}` (card M8.4.29): `manifest` a stored manifest of the project, `kind` `reopen` (the only kind), `handle` a committed 1-D `u8` buffer of §3 of 1 to 134,217,728 bytes (128 MiB) | `{byte_length}`: writes `derived/<manifest>.<kind>` in the project's mask folder, zlib-compressed, through a temporary file that is flushed and renamed; one file per manifest and kind, replaced if present. The engine does not read the body: the page checks its own header and hash (`tiledcache.js`). A manifest that is not stored is `INVALID_REQUEST` (`manifest`), an unknown kind `INVALID_REQUEST` (`kind`), a larger or wrongly typed buffer `LIMIT_EXCEEDED` or `INVALID_BUFFER` (`derived`). |
| `mask.derived.get` | `{project, manifest, kind}` | `{found: false}` when there is no file, else `{found: true, byte_length, sha256, frames: [n1, ...]}` followed by the bytes in binary frames of at most 1,048,576 bytes, as for `mask.read`. The file must decompress, with a bound of the limit plus one byte, to a whole stream; a damaged file is `INVALID_BUFFER` (`derived`) and is left for `mask.retain` or the next `put` to replace. Nothing is cached in memory. |
| `mask.copy` | `{from, to, manifest, start}`: two different projects (card M8.4.27) | `{next, tiles}`: copies a manifest of `from` into `to` in pages of 32 tiles from position `start` of its tile list (the tables with `start` 0): every blob is read and verified from `from` and written to `to` unless a valid one is there. The manifest is written last, only when every blob it names is in `to`; a page skipped is `INVALID_REQUEST` (`start`), a damaged blob `INVALID_BUFFER`. `next` is the start of the next page, or `null` when the manifest has been written. |
| `mask.slice` | `{project, manifest, section, row0, row1}` (card M8.4.43): tile rows `[row0, row1)` with `0 <= row0 < row1 <= rows` of a stored version of `project`, into a new section identifier `section` | `{manifest, width, height, tile_count, object_count, stack_count, sha256, frames: [n1, ...]}` followed by binary frames of at most 1,048,576 bytes holding `object_count` kept object IDs followed by `stack_count` sorted used stack indices, both `u32le` (no frames when both counts are 0). Every tile blob in `[row0, row1)` and every source table is read and verified first (a damaged blob is `INVALID_BUFFER`); tile blobs are reused directly by SHA-256 without re-encoding, with row shifted by `-row0` and `height = min(source.height, row1 * 512) - row0 * 512`. `classes` is reused; the four object columns keep only objects present in `[row0, row1)` in their original order (reusing blobs when all stay, or all `null` when none); overlap stacks keep their original indices for stacks present in `[row0, row1)` (empty spans for unused lower indices, or `[0, 0]` / `null` when none). The new manifest is written last; the source manifest and its blobs are untouched. |
| `mask.export` | `{project, manifest, blobs}` (card M8.4.18c): `blobs` `null` for the manifest's own file, or 1 to 32 (`EXPORT_PAGE`) blob names that the stored manifest uses (else `INVALID_REQUEST`, `blobs`) | `{files: [{name, byte_length, sha256}, ...], frames: [n1, ...]}` in request order, followed by the files' bytes in binary frames of at most 1,048,576 bytes, as for `mask.read`. A file is sent exactly as stored: the manifest's canonical JSON (whose SHA-256 is its name), or a blob's zlib stream (`sha256` is then that of the stream, `name` that of the bytes it decompresses to). Every one is checked first (the manifest as by any reader, each blob decompressed to its expected length and hash); a damaged one is `INVALID_BUFFER` with its field and nothing is sent. |
| `mask.import` | `{project, kind, handle, files}` (card M8.4.18c): `handle` a committed 1-D `u8` buffer holding the files one after the other; `files` `[{name, byte_length}]` (the lengths add up to the buffer's), 1 to 32 for `kind: "blobs"`, exactly one for `kind: "manifest"` | `blobs`: `{accepted: [boolean, ...]}` in order. A blob is accepted, and written as any blob, only if its bytes are one whole zlib stream that decompresses (bounded by the largest blob, 16 MiB, plus one byte) to bytes whose SHA-256 is its name; a refused one is not written and does not stop the others. `manifest`: `{manifest}` after the file passes every check of a stored manifest (its name is its SHA-256) and every blob it names is in the store (else `INVALID_REQUEST`, `blobs`, and nothing is written). A restore therefore sends the blobs first and the manifest last; a restore stopped half-way leaves only blobs that no manifest names. |
| `mask.forget` | `{project}` (card M8.4.27) | `{}`: the coordinator drops the project's store and its cached blobs from memory, before the main process deletes the folder; `BUSY` while a staged version of the project is open (a staged version belongs to the project whose folder it writes to, card M8.4.40). |

**Deadlines of the store operations (card M8.4.34).** The client of the main process (`desktop/engine.js`, `STORE_DEADLINES_MS`) gives each
operation of this section its own deadline instead of the 5 s of an ordinary request, after which it stops the engine: `mask.begin`, `mask.discard`,
`mask.info` 30 s; `mask.put`, `mask.read`, `mask.forget` 60 s; `mask.commit`, `mask.copy`, `mask.derived.put`, `mask.derived.get`, `mask.export`, `mask.import` 120 s; `mask.retain`, `mask.slice`
300 s. They were chosen with a wide margin over the times seen (every one of these operations took well under 2 s on an SSD in the cards
M8.4.29 and M8.4.32 runs); no worst-case measurement on a slow disk was made. A request that exceeds its deadline still ends the session.

**Backup folder (card M8.4.18c).** The folder backup of a project (technical manual §23.2) holds the stored versions of its tiled sections in
two folders next to its `project.json`: `tiles/<sha256>`, one file per blob, exactly as `mask.export` sends it (the zlib stream of the bytes whose
SHA-256 is the name), and `manifests/<sha256>.json`, one file per version (its canonical JSON). Files are written only when missing, by name, and
each is read back and checked after writing; a version's manifest is written after every blob it names, so a manifest in the folder means its
version is whole there. The page never deletes these files, so a `historial/<date>.json` keeps naming versions that are still in the folder. A
restore reads them back through `mask.import`. A copy of a section's source that the project keeps (card M8.4.18b) is in `sources/<sha256>` (the
file's bytes, named by their SHA-256, no extension); it is written once, in pieces of 8 MiB checked against the SHA-256 the main process sends with
each piece and again after writing, and read back into the project only when its size and SHA-256 are right (the main process's `sourceCopyRead`
and `sourceImport*`; the engine is not involved). The format depends on nothing of the browser or Electron: a reader needs only zlib, SHA-256 and
the manifest rules above.

**Derived files (card M8.4.29, decision G).** `<project>/tiles/derived/<manifest>.<kind>` holds what the page derived from the stored version
named by `manifest` and would otherwise read every tile to rebuild (its format is the page's: `docs/TECHNICAL_DOCUMENTATION.md`, reopening
tiled sections). It is a **cache**: the engine neither interprets nor trusts it, nothing refers to it, and a missing, damaged or refused file
only costs time. `mask.retain` removes the files whose manifest it removed (a file whose name is not `<64 hex>.<known kind>` is left alone);
`mask.copy` does not copy them (the new project builds its own after its first save).

Identifiers are checked against the rules above (`INVALID_REQUEST` with the field's name); a staged version of another session does not
exist. A staged version lives only in the coordinator's memory: if the engine stops before `mask.commit` answers, no manifest was written
and the base, and every earlier manifest, stays readable; the client sends its unacknowledged tiles again to a new staged version (card
M8.4.16 step 4). The project record names each section's current manifest (card M8.4.18a); between saves a stroke adds the tiles it
changed (compressed) and one manifest, and after a save `mask.retain` removes what no saved or current version names. The main process
(card M8.4.38) adds to `keep` every version of a store it did not create in this program session that the session did not write, so the
versions stored before the session stay until the project is deleted (`desktop/tile-ipc.js`; technical manual §28). The tables are not read
back: a reopened section takes its objects and stacks from the project record.

**The folder follows its project (card M8.4.27).** When a project is deleted from the library, the page asks the main process to delete
`<user data>/projects/<project>/` (`deleteProjectStore`): the engine first forgets the store (`mask.forget`; a `BUSY` answer is retried by the page
after it stopped and waited for its sends), then the folder is renamed to `.deleting-<uuid>` inside the projects folder and removed; a stop
half-way leaves a folder that no store identifier names, removed when the bridge starts. When a project is kept under a new identifier (the
local version kept on import), `copyProjectStore` copies the manifests its tiled sections name (`mask.copy`, page by page) and their
`sources.json` entries with the project's copies of sources (hard links when the file system allows them, otherwise verified copies); the
project record under the new identifier is written only after this succeeded.

**Source of a saved tiled section (cards M8.4.18a-b).** The main process, not the engine, keeps `<user data>/projects/<project>/sources.json`: `{format: "sedcoretool.sources", version: 1, sources: {<source SHA-256>: {path, size, name?, copy?}}}`, at most 4,096 entries, written through a temporary file and a rename when the page asks it to remember the source of a pyramid it built (`rememberSource`, which also records the file `name` without folders), when a moved source is located (`locate`, which replaces `path` and keeps `name`) and when the source is copied into the project (`copySource`, which records `copy`). `copy` is the name of the project's own copy in `<user data>/projects/<project>/sources/`: the SHA-256 followed by the original name's extension in lower case (`^[0-9a-f]{64}(\.[a-z0-9]{1,8})?$`; any other value is ignored). Readers ignore fields they do not know. The page never sees a path. When a saved section is reopened (`reopen`), the pyramid is used if the engine still has it; otherwise it is built from the copy, else from the remembered path, each only if its size is the saved one, with `expect` set to the saved SHA-256. `locate` takes a token of a file the user chose: a size other than the saved one is refused without reading the file (`{matched: false, size}`); otherwise the file is built with `expect`. `copySource` needs the page to have the pyramid open; it is refused (`LIMIT_EXCEEDED`, `disk`) when the disk would keep less than 1 GiB free, copies through a temporary file in the same folder while hashing what it writes, and renames only when the size and SHA-256 are the saved ones; a full disk, another file or a cancellation leaves no file. `sourceInfo` tells the page, without paths, whether the copy and the remembered original are there with the saved size, and the free space.

**From the page (card M8.4.16 step 4).** The main process passes `--projects-dir <user data>/projects`. The page reaches the five operations
only through `desktop/tile-ipc.js` (`window.corantoolDesktop.tiles.maskBegin`, `maskPut`, `maskCommit`, `maskDiscard`, `maskRead`), which checks
every argument again, lets a page use only the staged versions it began (at most 8 at a time), and for `maskCommit` takes the tables as bytes,
uploads each as a committed buffer (§3), names them in `mask.commit` and releases them. The page sends with `app/js/tiledsync.js` (`MaskSync`;
before a round it checks the limits above with `tableLimit` and, beyond one, sends nothing, says so once and waits for the next change):
after a change, a round begins a staged version on the last acknowledged manifest, sends each dirty tile (both layers, copied just before they
are sent) and the tables whose content changed since the last acknowledged manifest (all of them for the first; card M8.4.25), and commits; a tile is acknowledged only if it did not change after its copy was taken. A failed round
acknowledges nothing, discards its staged version and is tried again (pauses of 1, 2, 5, 15, then 30 s), after asking for the one automatic
restart of the engine (card M8.4.7) when the engine is not ready. Clean tiles the page dropped are read back with `mask.read`
(`MaskLoader`).

## 9. Methods of section, core and project scope: `method.run` (card A1)

**State: designed on 22 November 2026 (card A1). In the engine: §9.5 (card M8.5.1); §9.1-§9.4, §9.6 and the 1,024 handles of §9.7 (card M8.5.2), tested with probe methods only, without the progress events and the 60 s stall of batch methods (§9.4), which come with the first batch method. Client side (card M8.5.3): requests checked against a mirror of the method table, the 1,024 tokens per page and the 128 resident tables of §9.7, decoding of columns and table outputs; no interface sends `method.run` yet, and the publication rule of §9.4 belongs to the interface cards that use it.** Cards M8.5.1-M8.5.3 of the
[roadmap](roadmap.md#m85-cards) build it; the methods of M8.5 then use it. `section.analyze` (§3) stays as it is on the wire. Nothing here
names Electron, IPC channels or the renderer (ARCHITECTURE §3.3); "client" is whatever sends the frames.

### 9.1 Scope, target and inputs

Every method declares exactly one **scope** in the engine's method table (§9.6). The scope says what one result describes, what its
**target** is and which inputs it may name. Every input is a committed buffer named by its handle; its identity is the SHA-256 that the
coordinator verified at commit. Pixel identity (§3, card M8.4.9) and table identity (§4 "Tables") are client-side names for groups of
buffers; the engine itself knows only buffer hashes. The engine never reads project files.

| Scope | One result describes | Inputs it may name | First method |
|---|---|---|---|
| `section` | one section | the section inputs of §4 (resident masks), working pixels `rgba`/`rgba16` (§3), tables, `settings` | `section.intervals/1` (also through `section.analyze`); slices (b), (e) |
| `core` | one core | tables of that core (records, age model, data table), `settings` | `core.ages/1` (card M8.5.4) |
| `project` | the project, or the group of cores a method works on | a **family** of per-core tables `core<k>` (k = 0 … K−1, K ≤ 128), project tables (for example described intervals), `settings` | `multiproxy.samples/1` (card M8.5.10) |

The **target** is a session-local UUID that the client assigns to the section, core or project, as `project` and `section` are for
`section.analyze`; saved identifiers are never sent. A family member that is a table brings the three buffers of §4 "Tables": `core<k>`,
`core<k>_values` and `core<k>_valid`; k is written in decimal without leading zeros and the members are contiguous from 0. Per-core tables,
rather than one long table, let an edit of one core send one table again and keep each table within the §4 limits.

### 9.2 Request

`method.run` payload, closed fields: `{method, scope, target, revision, priority, settings_hash, inputs}`.

| Field | Rule | Refusal |
|---|---|---|
| `method` | a name advertised in `hello` | `UNSUPPORTED_METHOD`, field `method` |
| `scope` | equal to the method's declared scope (stated so that a client that confuses scopes fails visibly) | `INVALID_REQUEST`, `scope` |
| `target` | lowercase UUID | `INVALID_REQUEST`, `target` |
| `revision` | non-negative safe integer: the client's counter of the scientific inputs of (method, target), increased whenever any of them changes; echoed | `INVALID_REQUEST`, `revision` |
| `priority` | `interactive` or `batch`, and one that the method allows | `INVALID_REQUEST`, `priority` |
| `settings_hash` | SHA-256 of the method's `settings` input (`utf8json`; every method has one), checked as for `section.analyze` | `INVALID_REQUEST`, `settings_hash` |
| `inputs` | name → handle: only the method's fixed names and family members; required names present; each family contiguous from 0 and within its maximum | `INVALID_REQUEST`, `inputs`; a wrong dtype or rank is `INVALID_BUFFER` naming the input |

The coordinator checks names, dtypes and ranks (standard library only); the method's `parse` checks content and names the field at fault,
as `section.intervals/1` does. A request names at most 3 × 128 + 32 handles, about 25 KiB of JSON, within the 64 KiB frame. `method.run`
also accepts `section.intervals/1`; `section.analyze` remains its existing entry until a card moves the client.

### 9.3 Response

`{method, scope, target, revision, settings_hash, inputs_key, dimensions, outputs, layout, tables, summary, provenance}`:

- `method`, `scope`, `target`, `revision` and `settings_hash` echo the request.
- `inputs_key`: SHA-256 of the UTF-8 text `method.run/1|<method>|<scope>|` followed by `<name>=<sha256>;` for every input, names in
  ascending byte order, computed by the coordinator from the hashes it verified. Equal inputs give an equal key whatever the revision; a
  client may use it as the key of a cache of results.
- `dimensions`: the names the method declares, each a non-negative safe integer (unlike §5, zero is allowed: a project may give no samples).
- `outputs` and `layout`: one packed `result` buffer, as for `section.analyze` since card M8.4.3 (8-byte aligned columns, no gaps or
  overlaps). When every column is empty, `outputs` is `{}` and every layout entry has offset 0 and length 0; a layout shape may then hold 0.
- `tables`: for every table output `<name>`, its description `{version:1, rows, columns:[{name, unit}]}`; its cells are the layout columns
  `<name>_values` (`f64le[columns, rows]`) and `<name>_valid` (`u8[columns, rows]`, a missing slot holds 0). This is the §4 "Tables" format
  of card M8.4.10 used in the other direction; there is no second format. An output table may have 0 rows.
- `summary`: a closed, method-defined JSON object of at most 8 KiB (counts, flags such as an ignored age range), never cell values; the
  coordinator answers `INTERNAL` to a larger one or one with a non-finite number.
- `provenance`: `engine_version`, `runtime_id`, `method`, `scope`, `revision`, `inputs_key`, `input_sha256` (by name), `deterministic` (and,
  for a stochastic method, seed, generator and version, §4), `queued_ms` and `elapsed_ms`.

### 9.4 Priorities, superseding, cancellation and publication

- **Two priorities.** One waiting queue per priority, at most 4 jobs each (`BUSY` beyond); a waiting `interactive` job always starts
  before a waiting `batch` job; within a priority, order of arrival.
- **Batch yields to interactive, in two stages.** Stage 1 (card M8.5.2): one method worker, as today; a running batch job is not
  interrupted, and every batch method polls cancellation between bounded steps (one fold, one epoch). Stage 2 (card M8.5.14, built with the
  first batch method; decision Y10): a second long-lived worker runs batch jobs only, started on demand and stopped after 30 s idle, at a
  lower operating-system priority (Windows `BELOW_NORMAL_PRIORITY_CLASS` through `subprocess` creation flags, `nice` +10 elsewhere; standard
  library) with native thread pools capped at 1; interactive jobs keep the first worker and never wait for a batch job. Both share the
  session byte budget.
- **Superseding.** A new request with the same (method, target) makes the older ones of that pair obsolete: a waiting one is answered
  `cancelled` at once, a running one is asked to cancel (as by `job.cancel`). Other methods and other targets are never affected.
- **Cancellation.** `job.cancel` by request ID, unchanged (§3), for both priorities.
- **Deadlines.** Interactive methods keep the 120 s job deadline. A batch method sends progress events (`{stage, completed, total}`, at
  most 10 per second) and is stopped when none has arrived for 60 s, as `pyramid.build` is (§8.4).
- **Publication (client).** A result is published only when it is `ok` and its (method, target, revision) is still the client's current
  one. A cancelled, stale or failed job changes nothing; the interface shows its pending or error state with the translated
  `engine.error.<CODE>` message. With the engine experiment on, nothing is recomputed in JavaScript (AGENTS §3.6). No new error codes.

### 9.5 Operation table of the coordinator

`Coordinator.dispatch` (`engine/server.py`) stops being a chain of conditions: a table maps each operation to its kind and handler —
`control` (answered on the coordinator's thread: `hello`, `buffer.*`, `job.cancel`, `shutdown`, `pyramid.info`, `tile.read`), `job`
(queued for a worker: `section.analyze`, `method.run`, `buffer.digest`, `pyramid.build`) or `mask` (the `MaskIO` thread, §8.7). `hello` is
the only operation accepted before the handshake; an unknown name is `UNSUPPORTED_METHOD`, as is an operation whose store folder was not
given. A test compares the table with the client's allowlist (`desktop/engine.js` `OPERATIONS`). No change on the wire.

### 9.6 Method table

`engine/specs.py` (standard library) describes each method once: name, scope, inputs (dtype, rank, required), families (prefix, kind,
maximum), allowed priorities, dimension names, table outputs and deadline. `section.intervals/1` is described there too. A test checks that
each method module agrees with its entry; the main process mirrors the entries and a test compares the two (as for `METHOD_INPUTS` today).

### 9.7 Limits changed by this design

- Handles per engine session 256 → 1,024, and tokens per page in the main process 512 → 1,024: a project request names up to 384 table
  buffers. A handle costs one record; memory stays bounded by the unchanged 512 MiB session budget.
- Tables kept resident by a client: at most 128 (was 16); the 16 MiB bound, as charged, is unchanged. A request whose tables do not all fit
  sends the others for that request only and releases them afterwards. Whether 16 MiB is enough for real multiproxy projects is measured
  by card M8.5.12 (decision Y8).

### 9.8 Method `core.ages/1`

**State: specified on 22 November 2026 (card M8.5.4); implemented in the engine (card M8.5.5), not yet used by the interface.** It applies a core's age model to the depths of a
core's rows, as `core.js::interpAge` and `interpAgeRange` do today. Reference fixtures made by that JavaScript:
`tests/fixtures/core_ages/` (generator `tools/make_core_ages_fixtures.mjs`).

| Item | Rule |
|---|---|
| Name, scope, priority | `core.ages/1`; scope `core` (§9.1); priority `interactive` only (`batch` is refused, §9.2). |
| `settings` | `utf8json` `{"version": 1}`, nothing else. |
| `age_model` (table, §4 "Tables") | Columns `depth` and `age`, and either both `age_min` and `age_max` or neither, in that order of names; no other column. At least 2 rows, nothing missing (every `age_model_valid` slot is 1), `depth` strictly increasing, and `age_min ≤ age ≤ age_max` in every row when the range is present. This is what `parseAgeModelDetailed` leaves: it has sorted the rows, merged identical ones, refused a depth with two ages and dropped an inconsistent range, and the client sends that model. Ages may decrease downwards (a reversal): they are interpolated as given. Units are metadata of the columns and are not converted. |
| `query` (table) | One column `depth`, 1 or more rows; a missing depth (`query_valid` 0) is allowed. |
| Output table `ages` | One row per `query` row, in the same order. Columns `age`, and `age_min`, `age_max` when the model has a range. Linear interpolation between the two model depths around the query depth; the first and the last model depth belong to the model. A slot is missing where the query depth is missing or lies outside `[first depth, last depth]`: there is no extrapolation (the Python kernel's `extrapolate=True` is not used). `age_min` and `age_max` are missing exactly where `age` is. |
| `summary` | `{"rows": <query rows>, "outside": <query depths present and outside the model>}`; a missing depth is not counted in `outside`. |
| Dimensions | `rows` = the number of query rows (at least 1). |
| Tolerance (§7) | `age`, `age_min`, `age_max`: absolute error ≤ 1e-9 in declared age units; the missing pattern and `summary` exactly. |
| Refusals | As §9.2 and §4 "Tables": the field is named. `UNSUPPORTED_INPUT`: `age_model.depth` not strictly increasing; `age_model.<column>` with a missing value; `age_model.rows` fewer than 2; `age_model.age_min` or `age_model.age_max` when the range does not contain the age; `settings` of another version; `age_model` when an interpolation is not finite. `INVALID_REQUEST`: `age_model.columns` (one range column without the other, another order, another column); `query.columns.name` (no `depth` column or another column) and `query.columns` (none); `settings` with another field or not an object. |

Behaviour of `core.js` that the fixtures record, so that the contract and the program agree: `interpAge` returns `null` outside the model
and for a missing depth; `interpAgeRange` interpolates the minimum and the maximum like the age and returns `null` when the model has no
range or the depth is outside it; with age reversals both still interpolate linearly between neighbouring rows. The program leaves a
non-finite depth to the caller (`interpAge(model, NaN)` is `NaN`, not `null`): the client sends a missing depth as missing, and no fixture
asks for `NaN`.

### 9.9 Reserved: `multiproxy.samples/1` (card M8.5.10)

### 9.10 Method `core.depths/1`

**State: specified on 27 November 2026 (card M8.5.8b); implemented in the engine (card M8.5.8c), not used by the interface.** It gives
the depth of each age through the inverted age model, as `log.js::invertModel` and `toAxis(v, 'age', 'depth', model)` do today (used by
`coredata.js::collectCoreParts` for records on the age axis). Reference fixtures made by that JavaScript: `tests/fixtures/core_depths/`
(generator `tools/make_core_depths_fixtures.mjs`).

| Item | Rule |
|---|---|
| Name, scope, priority | `core.depths/1`; scope `core` (§9.1); priority `interactive` only (`batch` is refused, §9.2). |
| `settings` | `utf8json` `{"version": 1}`, nothing else. |
| `age_model` (table) | Exactly as §9.8 (the same resident table that `core.ages/1` uses). Range columns `age_min`, `age_max` are accepted and not used. |
| `query` (table) | One column `age`, 1 or more rows; a missing age (`query_valid` 0) is allowed. |
| The inverse | The pairs (`age`, `depth`) of the model sorted by age with a stable sort: ages that are equal keep the order of their depths (increasing). Ages need not increase downwards; where they do not, the inverse is not a function of the age and the result is what the rules below give, as JavaScript does. |
| Output table `depths` | One row per `query` row, in the same order; one column `depth`. A slot is missing where the age is missing or lies outside `[first, last]` of the inverse ages (the smallest and the largest age of the model): there is no extrapolation. Otherwise `lo` is the last index of the inverse whose age is ≤ the query age, at most n − 2 (n = model rows), `hi` = `lo` + 1, `span` = age[`hi`] − age[`lo`], and `depth` = `span` ? depth[`lo`] + ((a − age[`lo`]) / span) × (depth[`hi`] − depth[`lo`]) : depth[`lo`], evaluated in exactly this order of operations. The largest age itself belongs to the model (`lo` = n − 2). |
| `summary` | `{"rows": <query rows>, "outside": <query ages present and outside the model>}`; a missing age is not counted in `outside`. |
| Dimensions | `rows` = the number of query rows (at least 1). |
| Tolerance (decision Z4) | Exact: `depth` bit-identical to the JavaScript result (same IEEE-754 operations in the same order, no fused multiply-add) and the missing pattern and `summary` exact. |
| Refusals | As §9.8 for `age_model` and `settings`, and §4 "Tables": the field is named. `INVALID_REQUEST`: `query.columns.name` (no `age` column or another column) and `query.columns` (none). |

Behaviour of the JavaScript that the fixtures record: the inverse is built by `Array.prototype.sort` with the comparator `a - b` on the
ages (stable since ES2019); `interpAge` finds `lo` by bisection, which on an inverse sorted by age gives the last index with age ≤ the
query, and `n − 2` for the largest age; with two equal ages around the query `span` is 0 and the depth of `lo` is returned (the deeper
of two equal-age rows is never returned by interpolation). A non-finite age is left to the caller (`NaN` is not treated as outside); the
client sends a missing age as missing and no fixture asks for `NaN`.

### 9.11 Methods `core.age_model/1` and `core.bacon/1`

**State: specified on 27 November 2026 (card M8.5.8d); implemented in the engine (card M8.5.8e), not used by the interface.** They read a
core's age-model text, as `core.js::parseAgeModelDetailed` does today, and convert a Bacon age-depth table into the numbers of the
age-model text, as `core.js::baconToAgeText` does (decisions Z5-Z8). Reference fixtures made by that JavaScript: `tests/fixtures/age_model/`
(generator `tools/make_age_model_fixtures.mjs`), which also record ECMAScript `Number()` and `toPrecision(8)` for the engine's port.

**Text input (decision Z6).** A text reaches a method as an input of dtype `u8`, rank 1: the UTF-8 bytes of the string, 1 byte to
4 MiB (4,194,304 bytes, the metadata cap of §3). It is decoded strictly: an invalid sequence, an encoded surrogate (U+D800-U+DFFF), an
overlong form or a code point above U+10FFFF is refused. A leading U+FEFF is kept as a character, not removed as a byte-order mark (both
readers then treat it as whitespace). The client encodes the string with `TextEncoder`, which writes a lone surrogate as U+FFFD; no rule
below treats either as anything but an ordinary character, so the results are the same. An empty text is not sent (the program has no
model, as today); a text larger than 4 MiB is refused, and the interface shows the refusal.

**Character classes used by both readers.** *Whitespace* is the set of ECMAScript `String.prototype.trim`, of the regular-expression class
`\s` and of `StringToNumber` (the same set): U+0009-U+000D, U+0020, U+00A0, U+1680, U+2000-U+200A, U+2028, U+2029, U+202F, U+205F, U+3000
and U+FEFF; not U+001C-U+001F, U+0085 or U+180E (unlike Python's `str.isspace` and `re` `\s`). *Lower case* is
`String.prototype.toLowerCase`; for every decision below it is equivalent to mapping A-Z to a-z, because no other character lowercases to a
string containing an ASCII letter or digit except U+0130 (to `i` U+0307) and U+212A (to `k`), and neither can form a name that is
compared. *A number* is ECMAScript `StringToNumber` applied to a cell: whitespace at both ends removed, then an optionally signed decimal
literal (ASCII digits with at most one `.` and digits on at least one side of it, then an optional `e`/`E` exponent with an optional
sign), `Infinity` with an optional sign, or an unsigned `0x`/`0X`, `0b`/`0B`, `0o`/`0O` integer; nothing else (no `_`; no `nan`, `inf` or
`infinity`; no non-ASCII digits; no sign before `0x`). The empty string is 0. Literals are rounded to the nearest double (ties to even);
`1e400` is `Infinity`. *Finite* means neither NaN nor ±Infinity.

#### `core.age_model/1`

| Item | Rule |
|---|---|
| Name, scope, priority | `core.age_model/1`; scope `core` (§9.1); priority `interactive` only (`batch` is refused, §9.2). |
| Inputs | `settings` (`utf8json` `{"version": 1}`, nothing else) and `text` (`u8`, rank 1, required: the age-model text, as above). |
| Lines | The text is split at every `\n` and every `\r\n` (a lone `\r`, U+2028 and U+2029 do not end a line; they are whitespace inside it). Each line is trimmed of whitespace; empty lines and lines that then start with `#` are dropped. A `#` later in a line is an ordinary character. |
| Cells | Chosen for each line. If the line contains `;` or a tab: it is split at the matches of the ECMAScript expression `/\s*[;\t]\s*/` found from the left, each as long as possible (so a run of tabs, or whitespace around one `;`, is one separator, while `;;` or `; ;` leaves an empty cell); in each cell every whitespace character is removed and then its first `,` becomes `.` (decimal comma: `1 000,5` is 1000.5; `6,1,2` is not a number). Otherwise, if the line contains `,`: split at the matches of `/\s*,\s*/` (whitespace inside a cell stays: `1 2` is not a number). Otherwise: split at runs of whitespace. |
| Header | The first remaining line is a header when it has at least 2 cells and at least one of its cells, with every `"` removed and lower-cased, is non-empty and not a finite number (so a first line holding `Infinity` or `1e400` is a header). A header line is removed. On those cells (prefix match; the first matching cell wins): depth column `^(depth\|prof\|mcd\|mbsf\|cmcd\|ccsf\|z)`, else column 0; age column `^(age\|edad\|median\|mean\|cal)`, else column 1 when the depth column is 0 and column 0 otherwise; minimum `^(min\|lower\|low\|age_?min\|2\.5)` and maximum `^(max\|upper\|high\|age_?max\|97\.5)`, each absent when no cell matches. Consequences kept as they are: `age_min` before `age` makes `age_min` the age column; a header without a depth name whose column 0 matches the age gives depth = age; `mínimo` is not a minimum. Without a header the columns are 0 (depth), 1 (age), 2 (minimum) and 3 (maximum). The text is a *Bacon table* when the header's cells include exactly `depth`, `min`, `max`, `median` and `mean`. |
| Rows | Each data line's cells are read as numbers, an empty cell being NaN (not 0); quotes are not removed (`"1"` is not a number). A line is a row when its depth and age cells are finite; other lines are dropped. Each row keeps its minimum and maximum cells in one of three states: a number (possibly not finite); *not a number* (the cell exists but is empty or not a number, or the header names no such column); or *absent* (the line has fewer cells than that column's position). |
| Sort and merge | Rows are sorted by depth, then age (a stable sort: equal rows keep their order; `-0` equals `0`). Then, from the last row down to the second, a row whose depth equals the previous row's depth is removed when the two rows are *identical* (depth and age equal; each range cell equal as a number, or both *not a number*, or both *absent*; *not a number* never equals *absent*, so `5,10` and `5,10,` are different rows); otherwise the method stops with issue `dupDepth` and that depth (the largest depth that has two different rows) and gives no model. Of identical rows the one earlier in the sorted order is kept (a `-0` written first stays `-0`). |
| Model | Fewer than 2 rows left: no model and no issue. Otherwise the model is the rows' depths and ages. The range is kept when every row's two range cells are finite and its age lies within [min(minimum, maximum), max(minimum, maximum)]; each row's `age_min` is then that min and `age_max` that max (swapped cells are reordered; `Math.min(-0, 0)` is `-0`). Otherwise the range is dropped, and `range_ignored` is the number of rows that failed the test when there was a header that named both range columns, else 0. `reversals` counts the rows (after the first) whose age is less than the previous row's age. |
| Output table `model` | Columns `depth` and `age`, and `age_min`, `age_max` when the range is kept; units `""` (the text carries none; the client knows the core's units). One row per model row, nothing missing; 0 rows (columns `depth` and `age`) when there is no model. Every value is finite and depth strictly increasing: a valid `age_model` for §9.8 and §9.10. |
| `summary` | `{"rows", "reversals", "range_ignored", "bacon", "issue", "issue_depth"}`: model rows (0 without a model); `reversals`; `range_ignored`; `bacon`, true when a model exists and its header made the text a Bacon table; `issue`, `"dupDepth"` or `null`; `issue_depth`, the depth of the issue or `null`. Without a model `reversals` and `range_ignored` are 0 and `bacon` false. `issue_depth` is the only cell value in the summary (the interface names that depth); a `-0` depth is written `0` there (JSON). |
| Dimensions | `rows` = model rows (0 allowed, §9.3). |

#### `core.bacon/1`

| Item | Rule |
|---|---|
| Name, scope, priority | `core.bacon/1`; scope `core`; priority `interactive` only. |
| Inputs | `settings` (`utf8json` `{"version": 1, "center": "median"\|"mean", "depth_unit": "mm"\|"cm"\|"m", "age_divisor": 1\|1000\|1000000}`, all four fields required, nothing else; `age_divisor` a JSON number) and `table_text` (`u8`, rank 1, required: the table's text, as above). The program sends the core's depth unit and the divisor of its age unit (`a` 1, `ka` 1000, `Ma` 1,000,000). |
| Lines | Split at `\n` and `\r\n`; lines that are empty after trimming whitespace are dropped (`#` lines are not: a `#` first line is the header). No line left: no rows. |
| Header | The first line, trimmed, every `"` removed, lower-cased, split at runs of `,`, `;`, tab and U+0020 (`/[,;\t ]+/`). The column of a name is the first cell exactly equal to it: depth `depth`, minimum `min`, maximum `max`; the centre is the column named by `center`, else `median`, else `mean`. Any of the four missing: no rows. |
| Rows | Every later line, trimmed and split as the header (quotes not removed), each cell read as a number. Unlike the age-model reader an empty cell, or one of whitespace only (for example U+00A0), is **0** (a leading separator gives a depth of 0), and a decimal comma separates cells. A line is kept, in file order, when its depth, centre, minimum and maximum cells are all finite (`NA`, a missing cell or `Infinity` drop it). |
| Conversion (Z7) | depth × f with f = 1 / (cm per unit) evaluated as a double (mm: 1 / 0.1 = 10; cm: 1; m: 1 / 100 = 0.01, so metres are multiplied by the double 0.01, not divided by 100); each age ÷ `age_divisor`. Each result x is rounded as ECMAScript `Number(x.toPrecision(8))`: the sign is set apart, the integer n with 10^7 ≤ n < 10^8 and the exponent e that make n × 10^(e−7) − abs(x) closest to zero are taken from the exact binary value of x, a tie taking the larger n (away from zero: 123,456,785 gives 123,456,790, where Python's formatting rounds to even), and the decimal n × 10^(e−7) is read back to the nearest double; zero, also `-0`, gives `+0`. |
| Output table `rows` | Columns `depth` (unit `depth_unit`), `age`, `age_min`, `age_max` (unit `a`, `ka` or `Ma` from `age_divisor`), in that order, from the centre, minimum and maximum columns without reordering. One row per kept line, in file order. Fewer than 2 kept lines, or a missing column: 0 rows (the program then reads the file as plain age-model text, as today). A converted value that is not finite (only a depth beyond about 1.8e307 mm) is a missing slot (`rows_valid` 0); JavaScript writes `Infinity` or `-Infinity` there. |
| `summary` | `{"rows": <rows of the output table>}`. |
| Dimensions | `rows` = output rows (0 allowed). |
| The page's text (Z7) | The page writes each row as `${depth}, ${age}, ${age_min}, ${age_max}` (ECMAScript `Number::toString` of each double: the shortest form that reads back to it) after its two comment lines, as `app.js` does today; the fixtures record the lines (`text_lines`), so the saved `age.text` stays byte-identical. A missing slot is outside this rule (the sign of the infinity is not returned; the age-model reader drops such a row). |

**Both methods.**

| Item | Rule |
|---|---|
| Tolerance (decision Y4) | Exact: every output value bit-identical to the JavaScript result (`-0` included), the missing pattern and `summary` exactly. |
| Refusals | As §9.2: the field is named. `UNSUPPORTED_INPUT`: `text` or `table_text` not valid UTF-8; `settings` of another version (a `version` that is not the integer 1, a boolean included). `LIMIT_EXCEEDED`: `text` or `table_text` longer than 4 MiB; `text` (`core.age_model/1`) or `table_text` (`core.bacon/1`) when the output table would exceed the §4 table limits (more than 1,048,576 rows, or more than 8 MiB of cells at 9 bytes per cell: at most 233,016 rows with four columns), checked before the result is built, so the coordinator never answers `INTERNAL` for it. `INVALID_REQUEST`: `settings` with another field, without `version`, or not an object; then, for `core.bacon/1` and in this order, `settings.center`, `settings.depth_unit` or `settings.age_divisor` missing or of another value (`age_divisor` a JSON number equal to 1, 1000 or 1000000, an integer or a float; a boolean is refused). A wrong dtype or rank of `text` or `table_text` is `INVALID_BUFFER` naming the input (§9.2); an empty buffer cannot be made (§3: shapes are positive). Malformed lines and cells are never refusals: they are dropped as above, as JavaScript does. |
| Saved fields (decision Z8) | A malformed project can hold a non-text `age.text` or `age.bacon`, or a `center` other than `median`/`mean`; interface card M8.5.8m normalises them on load in both modes, so the methods never receive another `center`. |

Behaviour of `core.js` that the fixtures record, so that the contract and the program agree: `parseAgeModelDetailed` returns
`{model: {depth, age, min?, max?, rangeIgnored?, bacon?, reversals}, issue: null}`, `{model: null, issue: {kind: 'dupDepth', depth}}` or
`{model: null, issue: null}` (`min` and `max` are `age_min` and `age_max`; `rangeIgnored` is `range_ignored`, absent when 0; `bacon` is
absent when false). A short line's range cell is `undefined` and an empty one `NaN`, which is why the two are different rows.
`baconToAgeText` returns the text lines or `null`; its numbers are `+(+v).toPrecision(8)`, so the text is the shortest form of the rounded
double. TECHNICAL_DOCUMENTATION §5 lists the header names in short; the regular expressions above are the complete rule.
