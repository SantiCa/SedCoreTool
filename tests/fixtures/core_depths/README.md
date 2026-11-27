# Reference fixtures for `core.depths/1`

Eleven synthetic cases (the large one has 100,000 random ages plus 2,010 fixed ones) with the **inputs** of engine method
`core.depths/1` and the **result** of the current JavaScript calculation (`app/js/log.js`: `invertModel`,
`toAxis(v, 'age', 'depth', model)`). The Python method (roadmap card M8.5.8c) must reproduce them bit for bit.
Contract: [roadmap-engine-contract.md](../../../docs/roadmap-engine-contract.md) §9.10. Do not edit these files by hand.

- **Regenerate** (only when the JavaScript calculation or the case list changes on purpose and is reviewed):
  `node tools/make_core_depths_fixtures.mjs`. Check without writing: `node tools/make_core_depths_fixtures.mjs --check`.
  `tests/app/core-depths-fixtures.test.mjs` fails when a committed file differs from a regeneration. All data comes from
  a seeded generator; a regeneration is byte-identical.
- **Case file** `<name>.json`, one JSON line:

```
{ "format": "core-depths-fixture/1", "name", "description",
  "inputs":   { "settings": {"version": 1},
                "age_model": { depth, age, [age_min, age_max] },        // as parseAgeModelDetailed leaves it; the range is not used
                "query":     { age: [number | null, ...] } },           // null = missing age
  "expected": { "summary": { rows, outside }, "reversals": n, "equal_neighbour_ages": n,   // the last two: informative, not outputs
                "depths": { depth: [number | null, ...] } } }           // null = missing
```

- **Large case** (`rows-1000-random-100000`): `inputs.query` and `expected.depths` name binary files instead of arrays:
  `<name>.query_age.f64le` (`f64le[rows]`), `<name>.query_valid.u8` (`u8[rows]`, 1 present), `<name>.depth.f64le`,
  `<name>.depth_valid.u8`. A missing slot holds 0 in the values file and 0 in the validity file.
- **Models:** 2 and 1,000 rows; with age reversals (the inverse is not a function: the fixtures record what JavaScript gives),
  with equal neighbouring ages (span 0), and with a range (accepted, not used).
- **Queries of every case:** every model age, the midpoint of every pair of neighbouring sorted ages, both ends moved by
  1e-9 inside and outside, one unit and one model span outside, three missing ages, and seeded random ages from 5 % below
  to 5 % above the model's age span.
- **Comparison rule for the Python method (decision Z4):** `depth` bit-identical (`float64` equal), the missing pattern and
  `summary` exactly.
