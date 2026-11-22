# Reference fixtures for `core.ages/1`

Eight synthetic cases (the large one has 100,000 random depths plus 2,010 fixed ones) (about 2.9 MB, of which 2.0 MB is the 100,000-depth case) with the **inputs** of engine method
`core.ages/1` and the **result** of the current JavaScript calculation (`app/js/core.js`: `parseAgeModelDetailed`,
`interpAge`, `interpAgeRange`). The Python method (roadmap card M8.5.5) must reproduce them. Contract:
[roadmap-engine-contract.md](../../../docs/roadmap-engine-contract.md) §9.8. Do not edit these files by hand.

- **Regenerate** (only when the JavaScript calculation or the case list changes on purpose and is reviewed):
  `node tools/make_core_ages_fixtures.mjs`. Check without writing: `node tools/make_core_ages_fixtures.mjs --check`.
  `tests/app/core-ages-fixtures.test.mjs` fails when a committed file differs from a regeneration. All data comes from
  a seeded generator; a regeneration is byte-identical.
- **Case file** `<name>.json`, one JSON line:

```
{ "format": "core-ages-fixture/1", "name", "description",
  "inputs":   { "settings": {"version": 1},
                "age_model": { depth, age, [age_min, age_max] },        // as parseAgeModelDetailed leaves it
                "query":     { depth: [number | null, ...] } },         // null = missing depth
  "expected": { "summary": { rows, outside }, "reversals": n,           // reversals: informative, not an output
                "ages": { age: [number | null, ...], [age_min, age_max] } } }   // null = missing
```

- **Large case** (`rows-1000-random-100000`): `inputs.query` and `expected.ages` name binary files instead of arrays:
  `<name>.query_depth.f64le` (`f64le[rows]`), `<name>.query_valid.u8` (`u8[rows]`, 1 present), `<name>.age.f64le`,
  `<name>.age_valid.u8`. A missing slot holds 0 in the values file and 0 in the validity file.
- **Queries of every case:** every model depth, the midpoint of every pair of neighbouring depths, both ends moved by
  1e-9 inside and outside, one unit and one model span outside, three missing depths, and seeded random depths
  from 5 % above to 5 % below the model.
- **Comparison rule for the Python method:** the missing pattern and `summary` exactly; `age`, `age_min`, `age_max`
  within 1e-9 declared age units.
