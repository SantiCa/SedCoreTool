# M8.1: single scientific engine migration contract

Design baseline: V0.141, 12 November 2026. Authorised by the maintainer's instruction to continue the
[roadmap](roadmap.md#active-priority-desktop-and-one-scientific-engine). Editor: Codex. Verification:
source inspection and author-run repository checks; no independent reviewer is assigned.

This is a specification for pending M8.2–M8.6 work, not a description of an implemented engine.
The current desktop/browser calculations, Python API, file formats and defaults remain unchanged.
M8.2.1 implements a development-only subset: see [current behaviour and limits](TECHNICAL_DOCUMENTATION.md#262-experimental-engine-process).
The remaining capabilities below are still design requirements, not claims about that transport slice.
Protocol version 1 and method `section.intervals/1` below are separate versioned contracts. Changing
scientific semantics requires a new method version and explicit acceptance, even if the wire format fits.

How the code that implements this contract is layered, and the path of one request through it, are described in
[ARCHITECTURE.md](ARCHITECTURE.md). Amended on 13 November 2026 (card M8.3.5): §3 now defines `buffer.read`, which downloads
committed buffers, and the exact shape of the `section.analyze` response; progress events are not yet sent.

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

M8.4 changes ownership in a separate delivery: engine/native services own source pixels, masks and derived
arrays; the renderer receives tiles and summaries and submits revisioned edit commands. Specify a staged edit
journal and one persistence coordinator before that transition. Do not create two independent writers. Keep
atomic saves, recoverable backup, native samples, history and the compatibility identifiers in AGENTS.md.

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
terminal response; duplicate IDs are rejected without re-executing work. The initiating main process supplies
the new session UUID in `hello`; no other operation is accepted before successful negotiation.
All buffer handles and project/section tokens are also session-local UUIDs. SHA-256 values use 64 lowercase
hexadecimal characters. Requests and metadata records have closed, operation-specific fields; reject unknown
fields rather than silently ignore an unsupported setting. Protocol fixtures in M8.2 must encode these rules.

| Operation | Request payload | Successful result / events |
|---|---|---|
| `hello` | `{protocol:1}` | `{protocol:1, engine_version, runtime_id, methods, limits}`; `runtime_id` is the packaged runtime/constraint manifest SHA-256; methods is the explicit supported method-version list. |
| `buffer.begin` | `{dtype, shape, byte_length, sha256}` | `{handle}`; reserve a staging buffer after checked dimension multiplication and budget admission. |
| `buffer.chunk` | `{handle, offset, byte_length}` immediately followed by one binary frame of that length | `{next_offset}` after accepting that pair; offsets start at zero and must be contiguous. |
| `buffer.commit` | `{handle}` | `{handle, byte_length, sha256}` only after complete size/hash verification; committed buffers are immutable. |
| `buffer.release` | `{handles:[...]}` (at most 64) | `{released:[...]}`; idempotent for previously released handles in this session. Referenced buffers remain pinned until the job ends. |
| `buffer.read` | `{handle, offset, byte_length}`, 1 ≤ byte_length ≤ 1,048,576, offset + byte_length ≤ the buffer's length; the buffer must be committed and not released | `{offset, byte_length}`, immediately followed by exactly one binary frame holding those bytes. Any error response is not followed by a binary frame. |
| `section.analyze` | `{method:"section.intervals/1", project, section, revision, settings_hash, inputs}`: project and section are session-local UUIDs, revision a non-negative integer, `settings_hash` the SHA-256 of the `settings` buffer (the coordinator rejects a different value), and `inputs` maps the names of §4 to committed handles of the matching dtype and rank (`labels` `i32le` 2-D, `exclude` `u8` 2-D of the same shape, `stack_offsets` and `stack_members` `u32le` 1-D, the others `utf8json`); `stack_members` may be omitted when there is no overlap, every other name is required, unknown names are rejected | `{project, section, revision, settings_hash, method, dimensions:{bins,classes,schemes}, outputs, provenance}` echoing the request's identity. `outputs` maps each §5 column name (including each `<name>_valid`) to `{handle, dtype, shape, byte_length, sha256}` of a committed buffer that counts against the session budget until released; download it with `buffer.read`. `provenance` holds `engine_version`, `runtime_id`, `method`, `revision`, `deterministic`, `input_sha256` (hash of every input buffer by name) and `elapsed_ms`. A rejected input is an error response whose `details.field` names the input and member (for example `settings.roi`). Progress events (`{stage, completed, total}`, at most 10 per second) are part of this contract but are not sent yet; the Electron client of card M8.3.6 does not read events. |
| `job.cancel` | `{request_id}` | `{state:"requested"}` or `{state:"already_terminal"}`; the target still gets its own one terminal response. |
| `shutdown` | `{}` | `{}` after cancelling/releasing work; main enforces the shutdown deadline. |

Buffer dtypes are `u8`, `i32le`, `u32le`, `u64le`, `f64le` and `utf8json`. Shape is an array of 1–3 positive
dimensions; numeric buffers are contiguous C order, little-endian, with exact item-size product. `utf8json`
uses shape `[byte_length]` and the same strict JSON rules, maximum nesting 16; this carries bounded metadata
tables without expanding control frames. Numeric masks and pixels never become JSON lists or base64 strings.
Metadata buffers have a stricter 4 MiB byte cap, at most 65,536 records per table and 4,096 UTF-8 bytes per
string. Preflight metadata structure/string sizes before constructing rich objects, reserving parser/object
memory within the session budget; byte length alone is not a sufficient memory estimate.
No compressed input is accepted by this initial transport. Validate finite floating inputs before computing.

**Job execution (implemented in card M8.3.5; amended in the corrections after M8.3.8).** A job runs in a worker process (`engine/method_worker.py`), never in the coordinator. *Amendment of 14 November 2026:* the first version started one process per job; measuring M8.3.8 showed that starting the interpreter and importing NumPy cost about 0.7 s of the 0.9 s a large section needed, so the coordinator now keeps **one long-lived worker, started with `-I -B -u`, that runs one job at a time**. Isolation is unchanged where it matters: the coordinator still never trusts the answer (below), kills the worker on a cancellation that is not acknowledged within 1.5 s, on the 120 s deadline, on an answer it does not approve, on any write failure and when a job is abandoned (a surviving worker could answer an old job to a new one), starts a new worker for the next job after any of these or after an unexpected exit, and stops an idle worker after 30 s. The coordinator writes a job description `{method, cancel_path, output_dir, inputs: {name: {path, dtype, shape}}}` into a private folder of the session scratch directory and sends the absolute path of that file as one line on the worker's stdin; end of input stops the worker at once. The worker maps the numeric inputs read-only and unmaps them before it answers, so the coordinator can delete the buffers. Cancellation is a marker file the method polls between blocks of 256 rows. The worker writes each result column to `<output_dir>/<name>.bin` and answers each job with exactly one JSON frame: `{ok, dimensions, columns:{name:{dtype,shape,byte_length,sha256}}}`, `{error:{code,field}}` for a rejected input, or `{cancelled}`. The coordinator never trusts it: it checks the frame, then moves each file into the buffer store only after re-checking size, shape, SHA-256 and finite float data against the session budget; any mismatch, an unapproved or missing answer, a worker that ends before answering, a crash or the 120 s deadline is `INTERNAL` and nothing is adopted. An answer that passed these checks stands even if the worker dies right after it. Job folders are removed when the job ends. Worker error codes are limited to the stable codes of this section and the field to a plain name.

Serialize each descriptor/binary pair without interleaving frames; allow at most two unacknowledged chunks
per direction. Both ends must continuously drain the opposite pipe, and schedule cancellation/control messages
between pairs. A partial pair, unexpected binary frame, EOF or malformed frame invalidates the session; main
cleans it up and reports failure without touching live data. Main applies the same bounded streaming policy
at the renderer IPC boundary; reading a whole buffer to split it afterwards does not satisfy the contract.

Initial limits: 256 MiB per buffer; 512 MiB per engine session for all staged/committed buffers, queued-job
snapshots, results and admitted scratch arrays together; 1 GiB private scratch-disk cap. Admission uses checked
size estimates including conversion and overlapping class layers; reject before allocation when the estimate
exceeds budget. These are first-slice working-data limits, not a promise to process multi-gigabyte images or
a limit on total process RSS. Runtime/Electron overhead is measured separately in §7. No unbounded queues:
one active calculation, four queued calculations, at most 32 pending control requests. Reject excess with
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
3. **M8.4:** define the M2.3 multi-gigabyte benchmark/ownership contract first; implement native image access,
   bounded tile viewing, revisioned editing, analysis and saving as separate accepted increments.
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
| Matched timing | Same desktop binary, hardware, fixture, settings and decoder output, flag off/on; one warm-up then six alternating AB/BA paired fresh-process runs, record every sample. Report cold startup separately, cold analysis and cached unchanged reanalysis separately. Warm end-to-end median <= max(1.25×legacy median, legacy median +50 ms); empirical nearest-rank p95 <= max(1.5×legacy p95, legacy p95 +100 ms). Small sample p95 is the sample maximum; publish that limitation. |
| Timing boundaries | Full job starts when the analysis snapshot is requested and ends when validated current results are published; include snapshot/hashing, transfers, conversions, queue, computation and return. Report stages separately. Cold engine ready <=5 s from spawn through validated hello, with no dependency/network download. Repeated unchanged analysis must exercise the real cache/publication path. |
| Responsiveness/cancel | During the largest first-slice fixture, injected UI input-to-next-frame p95 <=100 ms. Cancel acknowledgement <=250 ms; target reaches terminal cancelled (or already completed) and releases temporary work within 2 s. Test cancellation during upload, queue, count and result transfer, plus a noncooperative worker; stale results never publish. |
| Whole-process memory | Sample simultaneous RSS sum of the complete Electron + engine + worker tree at the M0.1 25 ms target cadence, excluding harness/server; report cadence gaps, process list, idle RSS and observed peak, including transfer/conversion overlap. Peak <= max(1.10×matched legacy peak, legacy peak +256 MiB). Record shared-page double-counting/sampling limits; kernel-only memory is insufficient. |
| Release/recovery | Ten open/analyse/close cycles release all session project handles; no growth in outstanding buffers/jobs/scratch files. After warm-up, final closed-state RSS <= first closed-state RSS +64 MiB. Kill the worker/coordinator mid-job and interrupt saves; live unsaved edits and the last good save/backup remain recoverable. |

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
