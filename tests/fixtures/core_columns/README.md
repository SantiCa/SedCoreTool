# Reference fixtures for `core.columns/1`

Synthetic cases with the **inputs** of engine method `core.columns/1`, exactly as the page will send them (decision Z12), and
the **result** of the current JavaScript calculation: the formulas of `app/js/sheet.js` (as fixed by card M8.5.8f) evaluated in
the order, with the `interp` and error behaviour, of `app.js::applyComputedColumns`. The Python method (roadmap card M8.5.8h)
must reproduce them within decision Z11 (each output column names its tolerance). Contract:
[roadmap-engine-contract.md](../../../docs/roadmap-engine-contract.md) §9.12. Do not edit these files by hand.

- **Regenerate** (only when the JavaScript calculation or the case list changes on purpose and is reviewed):
  `node tools/make_core_columns_fixtures.mjs`. Check without writing: `node tools/make_core_columns_fixtures.mjs --check`.
  `tests/app/core-columns-fixtures.test.mjs` fails when a committed file differs from a regeneration, and re-checks every
  fixture with `sheet.js` (exactly, `Object.is`) twice: through the contract's rule written on the method's inputs only, and
  through the transcription of `applyComputedColumns`. All data is written in the generator or comes from a seeded generator
  (no real core's data); a regeneration is byte-identical.
- **Transcription of app.js.** `pageRun` in the generator mirrors `app.js::applyComputedColumns` (lines 2915-2928 at commit
  4987da5: the `core` filter, `checkComputedCount`, the `cols` object with `depth` and `age`, `interp` through `formulaRefs`
  and `fillLinear`, `evalColumn`, the result written under the column's name, the error path). Deliberate differences: the
  core's columns are a null-prototype object (app.js looks them up with `c.proxies[r]`, which also finds `constructor`,
  `toString`…; see contract §9.12 "Differences"), errors are kept as key and argument instead of translated text, and the
  results are returned instead of written into the project. `pageRequest` is what the interface card must send (Z12); the
  interface card proves page parity.
- **Encoding.** Every JSON file is one line of printable ASCII JSON: characters outside it are `\u` escapes (a character
  outside the BMP is a surrogate pair; no lone surrogate occurs). `-0.0` is minus zero (compare with `Object.is` /
  `math.copysign`); `null` is a missing slot.
- **Case file** `<name>.json`:

```
{ "format": "core-columns-fixture/1", "name", "description",
  "page_core": { "axis": "depth" | "age", ["id"] },               // informative: x is the depth, or the age of an age-only core
  "inputs":   { "settings": { "version": 1, "formulas": [{name, formula, interp}], "columns": [{name}] },
                "data":     { "version": 1, "rows", "columns": [{name, unit}] },     // x, c0…, [depth], [age]; units ""
                "data_columns": { "x": [...], "c0": [...], ... } },                 // null = missing
  ["page":    { "core_id", "formulas": [{name, formula, [core], [interp]}],         // the page's whole list (only for the
                "sent": [position...], "refused": [{position, key, arg}] }],         // cases where the page refuses or filters)
  "expected": { "dimensions": {rows},
                "tables":   { "columns": { "version": 1, "rows", "columns": [{name: "f0", unit: ""}, ...] } },
                "summary":  { "rows", "errors": [{index, key, arg}] },              // arg: text cut to 128 UTF-8 bytes, or null
                "tolerance": ["exact" | "ulp2" | "rel", ...],                        // per output column (Z11)
                "fragile":  [index...],                                              // see below
                ["full_args": { "<index>": "<argument before the cut>" }],
                "columns":  { "f0": [...], ... } } }                                 // null = missing
```

- **Large case** (`rows-100000`): `inputs.data_values_file` / `inputs.data_valid_file` and `expected.columns_values_file` /
  `expected.columns_valid_file` name binary files instead of `data_columns` and `columns`, laid out exactly as contract §4
  "Tables" lays out `<name>_values` (`f64le[columns, rows]`, column after column in the order of `columns`) and `<name>_valid`
  (`u8[columns, rows]`, 1 present); a missing slot holds 0 in both. It is the timing case of card M8.5.8i.
- **Tolerance (decision Z11).** `exact`: bit-identical, `-0` included. `ulp2`: at most 2 units in the last place (a `log10`,
  `ln`/`log`, `exp`, `pow` or `^` of exact operands, possibly negated or under `abs`). `rel`: |Δ| ≤ 1e-12 · max(1, |reference|)
  (`mean`, `std`, `zscore`, `movavg`, `corr`, and any value computed from a value of the last two groups). The missing pattern,
  `summary` (keys and arguments) and every slot of an `exact` column are exact. `fragile` lists the columns where a comparison,
  a `round` or the condition of an `if` depends on a value that is not exact: Z11 requires their results to agree exactly and a
  difference is shown to the maintainer with its inputs, never accepted. The random cases contain no fragile column.
- **Cases.** Operators on scalars and columns (zero divisors, `-0`, overflow, precedence and associativity); powers with negative
  and zero bases; `round` ties (28 hand-picked values at several digits, 400 seeded values at 0-7, 12 and 17 digits, digits given as text,
  missing or absent); every function with scalars, columns, missing values and missing or extra arguments; `movavg` windows
  (also negative, text and absent `n`); `corr` with fewer than 3 pairs; overflow kept inside computed columns; `if` truthiness;
  chains of formulas (replacing a data column, a failed formula, a name used before it is defined); `interp` on and off across
  gaps; an age-only core; a data column named `depth` and one named `age`; names, identifiers and the text tokens that act as
  operators; every error key with its argument (cut to 128 bytes); every bound of `FORMULA_LIMITS` at and beyond its limit;
  page-side refusals (`tooLong`, `tooManyCols`) and the `core` filter; 40 seeded random cores with 50 random well-formed
  formulas each (2,000 formulas); one core of 100,000 rows.
