// M8.5.4: reference fixtures for engine method core.ages/1 (docs/roadmap-engine-contract.md §9.8).
//
// Each fixture holds an age model, the depths asked for and the result of the CURRENT JavaScript calculation
// (app/js/core.js: parseAgeModelDetailed, interpAge, interpAgeRange). The Python method of card M8.5.5 must reproduce
// them: `age`, `age_min`, `age_max` within 1e-9 declared age units, the missing pattern and `summary` exactly.
// All data is synthetic and seeded (no clock, no Math.random); a regeneration is byte-identical.
//
// Usage (repository root):
//   node tools/make_core_ages_fixtures.mjs                write tests/fixtures/core_ages/
//   node tools/make_core_ages_fixtures.mjs --check        fail if a committed file differs from a regeneration
//   node tools/make_core_ages_fixtures.mjs --out <dir>    write somewhere else (used by the test)
//
// File formats: see tests/fixtures/core_ages/README.md.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { interpAge, interpAgeRange, parseAgeModelDetailed } from '../app/js/core.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURE_DIR = path.join(root, 'tests/fixtures/core_ages');
export const FORMAT = 'core-ages-fixture/1';

/** Deterministic generator (same one as make_interval_fixtures.mjs): uniform in [0, 1). */
function seeded(seed) {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

/**
 * Age-model text as a user would paste it, then parsed by the program's own parser, so that the model of a fixture is exactly
 * what `parseAgeModelDetailed` leaves (sorted, merged, range kept only when consistent).
 * @param {number[]} depth strictly increasing
 * @param {number[]} age
 * @param {{min: number[], max: number[]} | null} range
 */
function parsedModel(depth, age, range) {
  const lines = [range ? 'depth,age,age_min,age_max' : 'depth,age'];
  depth.forEach((d, i) => lines.push(range ? `${d},${age[i]},${range.min[i]},${range.max[i]}` : `${d},${age[i]}`));
  const { model, issue } = parseAgeModelDetailed(lines.join('\n'));
  if (!model || issue || model.depth.length !== depth.length) throw new Error('generated age model was not accepted as written');
  if (!!range !== !!model.min) throw new Error('generated age range was not accepted as written');
  return model;
}

/** Depths 0, 1.5 .. with random steps; ages increase except at the reversals (every `reversalEvery`-th step goes back). */
function makeModel(rows, next, { range, reversalEvery = 0, firstDepth = 0, firstAge = 0 }) {
  const depth = [], age = [];
  let d = firstDepth, a = firstAge;
  for (let i = 0; i < rows; i++) {
    depth.push(d); age.push(a);
    d += 0.25 + next() * 3.75;
    a += reversalEvery && (i + 1) % reversalEvery === 0 ? -(0.1 + next() * 1.5) : 0.05 + next() * 2.5;
  }
  const bounds = range ? { min: age.map((v) => v - next() * 0.4), max: age.map((v) => v + next() * 0.4) } : null;
  return parsedModel(depth, age, bounds);
}

const just = 1e-9;
/** Queries at every knot, between knots, at both ends, just outside, far outside and missing, then `random` seeded depths. */
function makeQueries(model, next, random) {
  const { depth } = model, first = depth[0], last = depth[depth.length - 1], span = last - first;
  const q = [];
  for (const d of depth) q.push(d);                                              // every knot
  for (let i = 1; i < depth.length; i++) q.push((depth[i - 1] + depth[i]) / 2);  // every midpoint
  q.push(first - just, first - 1, last + just, last + 1, first - span, last + span);   // outside: no extrapolation
  q.push(first + just, last - just);                                             // just inside
  q.push(null, null, null);                                                      // a missing depth
  for (let i = 0; i < random; i++) q.push(first - 0.05 * span + next() * 1.1 * span);   // 5 % beyond each end
  return q;
}

/** The current JavaScript result for one depth; a missing depth is missing. */
function answer(model, d) {
  if (d == null) return { age: null, min: null, max: null };
  const age = interpAge(model, d), range = interpAgeRange(model, d);
  return { age, min: range ? range.min : null, max: range ? range.max : null };
}

function build({ name, description, model, queries }) {
  const rows = queries.map((d) => answer(model, d));
  const first = model.depth[0], last = model.depth[model.depth.length - 1];
  const outside = queries.filter((d) => d != null && (d < first || d > last)).length;
  const reversals = model.age.reduce((n, a, i) => n + (i && a < model.age[i - 1] ? 1 : 0), 0);
  return { name, description, model, reversals, queries, rows, outside };
}

/** @returns {{name: string, description: string, model: any, reversals: number, queries: (number|null)[], rows: any[], outside: number}[]} */
export function allCases() {
  const next = seeded(851104);
  const two = (name, description, range, ages) => {
    const model = parsedModel([2, 12], ages, range);
    return build({ name, description, model, queries: makeQueries(model, next, 20) });
  };
  const big = (name, description, opts, random) => {
    const model = makeModel(1000, next, opts);
    return build({ name, description, model, queries: makeQueries(model, next, random) });
  };
  return [
    two('two-rows', 'The smallest model, without range.', null, [5, 25]),
    two('two-rows-with-range', 'The smallest model, with a range.', { min: [4, 22], max: [6, 27] }, [5, 25]),
    two('two-rows-reversal', 'Two rows whose age decreases downwards (a reversal).', null, [30, 10]),
    big('rows-1000', '1,000 rows, ages increasing, without range.', { range: false }, 2000),
    big('rows-1000-with-range', '1,000 rows, ages increasing, with a range around every age.', { range: true }, 2000),
    big('rows-1000-reversals', '1,000 rows with an age reversal every 37th step, without range.', { range: false, reversalEvery: 37 }, 2000),
    big('rows-1000-reversals-with-range', '1,000 rows with an age reversal every 37th step, with a range.', { range: true, reversalEvery: 37 }, 2000),
    big('rows-1000-random-100000', '1,000 rows with reversals, without range; 100,000 random depths (binary columns, see README).',
      { range: false, reversalEvery: 53, firstDepth: 100, firstAge: 3 }, 100000),
  ];
}

// ---- serialisation ---------------------------------------------------------------------------------------------------

/** Number column of a result with missing slots as null. */
const column = (rows, key) => rows.map((r) => r[key]);

function f64le(values) {
  const buffer = Buffer.alloc(values.length * 8);
  values.forEach((v, i) => buffer.writeDoubleLE(v == null ? 0 : v, i * 8));
  return buffer;
}
const u8 = (values) => Buffer.from(values.map((v) => (v == null ? 0 : 1)));

const BINARY_THRESHOLD = 10000;

/** @returns {Map<string, string | Buffer>} file name -> exact file content */
export function buildFixtures() {
  const files = new Map();
  for (const c of allCases()) {
    const hasRange = !!c.model.min;
    const document = {
      format: FORMAT, name: c.name, description: c.description,
      inputs: { settings: { version: 1 }, age_model: { depth: c.model.depth, age: c.model.age, ...(hasRange ? { age_min: c.model.min, age_max: c.model.max } : {}) } },
      expected: { summary: { rows: c.queries.length, outside: c.outside }, reversals: c.reversals },
    };
    if (c.queries.length >= BINARY_THRESHOLD) {
      // Large case: query and result columns are binary files next to the JSON (missing slot: value 0, validity 0).
      const stem = c.name;
      document.inputs.query = { rows: c.queries.length, depth_file: `${stem}.query_depth.f64le`, valid_file: `${stem}.query_valid.u8` };
      document.expected.ages = { age_file: `${stem}.age.f64le`, valid_file: `${stem}.age_valid.u8` };
      files.set(document.inputs.query.depth_file, f64le(c.queries));
      files.set(document.inputs.query.valid_file, u8(c.queries));
      files.set(document.expected.ages.age_file, f64le(column(c.rows, 'age')));
      files.set(document.expected.ages.valid_file, u8(column(c.rows, 'age')));
      if (hasRange) throw new Error('large cases carry no range');
    } else {
      document.inputs.query = { depth: c.queries };
      document.expected.ages = { age: column(c.rows, 'age'), ...(hasRange ? { age_min: column(c.rows, 'min'), age_max: column(c.rows, 'max') } : {}) };
    }
    files.set(`${c.name}.json`, `${JSON.stringify(document)}\n`);
  }
  return files;
}

/** Writes `files` into `dir` (created when missing). */
export function writeFixtures(files, dir) {
  mkdirSync(dir, { recursive: true });
  for (const [file, content] of files) writeFileSync(path.join(dir, file), content);
}

const same = (file, content) => {
  const text = readFileSync(path.join(FIXTURE_DIR, file));
  return typeof content === 'string' ? text.toString('utf8').replace(/\r\n/g, '\n') === content : text.equals(content);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = buildFixtures();
  const out = process.argv.indexOf('--out');
  if (process.argv.includes('--check')) {
    const committed = existsSync(FIXTURE_DIR) ? readdirSync(FIXTURE_DIR).filter((f) => f !== 'README.md') : [];
    const problems = [...files.keys()].filter((f) => !committed.includes(f) || !same(f, files.get(f))).concat(committed.filter((f) => !files.has(f)));
    if (problems.length) { console.error(`Fixtures differ from a regeneration: ${problems.join(', ')}`); process.exit(1); }
    console.log(`${files.size} fixture files match a regeneration`);
  } else {
    const dir = out > 0 ? path.resolve(process.argv[out + 1]) : FIXTURE_DIR;
    writeFixtures(files, dir);
    const bytes = [...files.values()].reduce((sum, c) => sum + Buffer.byteLength(c), 0);
    console.log(`${files.size} fixture files written to ${dir} (${(bytes / 1024).toFixed(0)} KiB)`);
  }
}
