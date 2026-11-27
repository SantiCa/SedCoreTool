# Reference fixtures for `core.age_model/1` and `core.bacon/1`

Synthetic cases with the **inputs** of engine methods `core.age_model/1` and `core.bacon/1` and the **result** of the
current JavaScript calculation (`app/js/core.js`: `parseAgeModelDetailed` and `baconToAgeText`), plus a table of ECMAScript
number conversions. The Python methods (roadmap card M8.5.8e) must reproduce them exactly.
Contract: [roadmap-engine-contract.md](../../../docs/roadmap-engine-contract.md) §9.11. Do not edit these files by hand.

- **Regenerate** (only when the JavaScript calculation or the case list changes on purpose and is reviewed):
  `node tools/make_age_model_fixtures.mjs`. Check without writing: `node tools/make_age_model_fixtures.mjs --check`.
  `tests/app/age-model-fixtures.test.mjs` fails when a committed file differs from a regeneration. All data is written
  in the generator or comes from a seeded generator (no real core's data); a regeneration is byte-identical.
- **Encoding.** Every file is one line of printable ASCII JSON: control characters and every character outside ASCII in
  an input text are `\u` escapes (`\r\n`, ` `, `﻿`, ` `), so git's line-ending handling can never change
  an input. The bytes a method receives are the UTF-8 encoding of the decoded string (no lone surrogates occur; a leading
  U+FEFF is part of the text). Numbers: `-0.0` is minus zero (compare with `Object.is` / `math.copysign`); `null` is a
  missing slot; in `js-numbers.json` the strings `"NaN"`, `"Infinity"` and `"-Infinity"` in a number position are those values.
- **`age-<case>.json`** (`core.age_model/1`, 41 cases):

```
{ "format": "core-age-model-fixture/1", "name", "description",
  "inputs":   { "settings": {"version": 1}, "text": "<age-model text>" },
  "expected": { "summary": { rows, reversals, range_ignored, bacon, issue, issue_depth },
                "model":   { depth, age, [age_min, age_max] } } }        // 0 rows: depth and age empty
```

- **`bacon-<case>.json`** (`core.bacon/1`, 24 cases):

```
{ "format": "core-bacon-fixture/1", "name", "description",
  "inputs":   { "settings": {"version": 1, "center", "depth_unit", "age_divisor"}, "table_text": "<Bacon table>" },
  "expected": { "summary": { rows },
                "rows": { depth, age, age_min, age_max },                // null = missing (a converted value that is not finite)
                "text_lines": [ "<depth>, <age>, <min>, <max>", ... ] | null } }   // baconToAgeText's return value
```

- **`js-numbers.json`**: `number` lists `[string, Number(string)]` and `to_precision_8` lists `[x, x.toPrecision(8),
  +x.toPrecision(8)]`, for the engine's port of ECMAScript `StringToNumber` and `toPrecision` (card M8.5.8e).
- **Cases.** Age model: headers in English and Spanish, no header, `;` and tab with decimal commas, lines of different
  modes, Unicode spaces, CRLF and a lone CR, comments, number forms (`0x1A`, `0b`, `0o`, `1e3`, `.5`, `5.`, `-0`,
  `Infinity`, `1_0`, `nan`), repeated identical rows, a depth with two rows, ranges kept and ignored (named and unnamed),
  swapped minimum and maximum, reversals, one row, a pasted Bacon table, header quirks, quotes, NUL, and 10,000 rows.
  Bacon: median and mean, each depth unit and age divisor, exact rounding ties (123456785), `NA` rows, no centre or `min`
  column, the centre fallback, a `#` first line, empty cells read as 0, decimal commas, quotes, number forms, a depth
  that overflows in mm, and 10,000 rows.
- **Comparison rule for the Python methods (decision Y4):** every number bit-identical (`-0` included), the missing
  pattern and `summary` exactly.
