# Reference fixtures for `section.intervals/1`

Forty-seven synthetic cases (about 1.3 MB) with the **inputs** of engine method `section.intervals/1` and the **result** of
the current JavaScript calculation (`app/js/sectionanalysis.js`). The Python method (roadmap card M8.3.4) must
reproduce them. Contract: [roadmap-engine-contract.md](../../../docs/roadmap-engine-contract.md) §4 (inputs) and §5
(results). Do not edit these files by hand.

- **Regenerate** (only when the JavaScript calculation or the case list is changed on purpose and reviewed):
  `node tools/make_interval_fixtures.mjs`. Check without writing: `node tools/make_interval_fixtures.mjs --check`.
  `tests/app/interval-fixtures.test.mjs` fails when a committed file differs from a regeneration.
- **File name** = `<name>.json`; one JSON document per file, on one line.

```
{ "format": "section-intervals-fixture/1", "name", "description",
  "inputs":   { labels, exclude, objects, classes, stack_offsets, stack_members, settings, age_model, manual_indices },
  "expected": { "dimensions": { bins, classes, schemes }, "columns": { <name>: column } } }
```

- **Numeric buffer** `{ dtype, shape, data: [...] }`, or for the large label and exclusion images
  `{ dtype, shape, runs: [[value, count], ...] }`, which expands to `data` in row-major order (row 0 = top of the
  image). `dtype` is one of `u8`, `i32le`, `u32le`, `u64le`, `f64le`.
- `labels` is the whole image (`[height, width]`); `settings.roi` selects the counted rectangle (half-open). Positive
  label = object id, negative = overlap stack index, 0 = matrix. `stack_members` is `null` when there is no overlap.
- **Result column** `{ dtype, shape, data }`; a nullable column also has `valid` (0/1, same length) and holds 0 in
  invalid slots. Columns: `row_start`, `row_end`, `valid_count`, `bio_count`, `class_count [B,C]`, `depth_top`,
  `depth_bottom`, `depth`, `valid_pct`, `bioturbation_pct`*, `class_pct [B,C]`*, `no_data`, `age`*, `age_min`*,
  `age_max`*, `manual_BI`*, `manual_ii`*, `indices [B,2]`* (BI, ii; * = nullable).
- **Comparison rule for the Python method:** exact equality for `row_start`, `row_end`, the counts, `no_data`,
  `indices`, `manual_*` and every `valid` array; absolute error ≤ 1e-9 for the floating-point columns.

Choices made while turning the application's state into contract inputs (the contract does not say):
`confidence` of an object without a prediction is 0; `name` of a class defaults to its id; `age_model` records have
`min` and `max` null unless the model has both; the schemes are the application's BI and ii with `precedence: "first"`;
`valid_pct` (100 · valid pixels / (rows · ROI columns)) is computed from the row counts because the interface does not
show it.

| Group | Fixtures |
|---|---|
| Classes and counting | `basic-four-intervals`, `predictions-and-candidates-counted`, `predictions-and-candidates-ignored`, `prediction-confidence-at-threshold` |
| Overlaps | `overlap-same-and-different-class`, `overlap-with-excluded-pixels` |
| Geometry | `roi-offset`, `units-mm`, `units-cm`, `units-m`, `interval-thinner-than-one-row`, `fractional-00` … `fractional-19` (the 20 shared cases of `tests/fixtures/fractional-boundaries.json`) |
| No data | `no-valid-pixels`, `min-valid-exactly-at-limit`, `min-valid-one-pixel-below`, `no-data-padding-0-cm`, `no-data-padding-2-cm`, `no-data-padding-2-cm-in-mm`, `no-data-padding-2-cm-in-m` |
| Ages and manual indices | `ages-with-range`, `ages-at-model-ends`, `ages-without-range`, `ages-no-model`, `manual-ranges` |
| Size | `large-mixed` (600 × 2000 pixels, 150 objects, 12 stacks, exclusions, a ROI, ages, manual ranges) |
