// M8.5.8b: reference fixtures for engine method core.depths/1 (docs/roadmap-engine-contract.md §9.10).
//
// Each fixture holds an age model, the ages asked for and the result of the CURRENT JavaScript calculation
// (app/js/log.js: invertModel, toAxis(v, 'age', 'depth', model)). The Python method of card M8.5.8c must reproduce them
// bit for bit (decision Z4): `depth`, the missing pattern and `summary` exactly.
// All data is synthetic and seeded (no clock, no Math.random); a regeneration is byte-identical.
//
// Usage (repository root):
//   node tools/make_core_depths_fixtures.mjs                write tests/fixtures/core_depths/
//   node tools/make_core_depths_fixtures.mjs --check        fail if a committed file differs from a regeneration
//   node tools/make_core_depths_fixtures.mjs --out <dir>    write somewhere else (used by the test)
//
// File formats: see tests/fixtures/core_depths/README.md.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAgeModelDetailed } from '../app/js/core.js';
import { invertModel, toAxis } from '../app/js/log.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURE_DIR = path.join(root, 'tests/fixtures/core_depths');
export const FORMAT = 'core-depths-fixture/1';

/** Deterministic generator (same one as make_core_ages_fixtures.mjs): uniform in [0, 1). */
function seeded(seed) {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

/** Age model parsed by the program's own parser, so that it is exactly what the client would send. */
function parsedModel(depth, age, range) {
  const lines = [range ? 'depth,age,age_min,age_max' : 'depth,age'];
  depth.forEach((d, i) => lines.push(range ? `${d},${age[i]},${range.min[i]},${range.max[i]}` : `${d},${age[i]}`));
  const { model, issue } = parseAgeModelDetailed(lines.join('\n'));
  if (!model || issue || model.depth.length !== depth.length) throw new Error('generated age model was not accepted as written');
  if (!!range !== !!model.min) throw new Error('generated age range was not accepted as written');
  return model;
}

/** Ages increase except at every `reversalEvery`-th step (goes back) and every `equalEvery`-th step (stays equal: span 0 in the inverse). */
function makeModel(rows, next, { range, reversalEvery = 0, equalEvery = 0, firstDepth = 0, firstAge = 0 }) {
  const depth = [], age = [];
  let d = firstDepth, a = firstAge;
  for (let i = 0; i < rows; i++) {
    depth.push(d); age.push(a);
    d += 0.25 + next() * 3.75;
    const step = i + 1;
    if (reversalEvery && step % reversalEvery === 0) a -= 0.1 + next() * 1.5;
    else if (equalEvery && step % equalEvery === 0) a += 0;
    else a += 0.05 + next() * 2.5;
  }
  const bounds = range ? { min: age.map((v) => v - next() * 0.4), max: age.map((v) => v + next() * 0.4) } : null;
  return parsedModel(depth, age, bounds);
}

const just = 1e-9;
/** Queries at every model age, between sorted ages, at both ends, just outside, far outside and missing, then `random` seeded ages. */
function makeQueries(model, next, random) {
  const sorted = invertModel(model).depth;     // the inverse's ages, sorted
  const first = sorted[0], last = sorted[sorted.length - 1], span = last - first;
  const q = [];
  for (const a of model.age) q.push(a);                                              // every age, in the model's own order
  for (let i = 1; i < sorted.length; i++) q.push((sorted[i - 1] + sorted[i]) / 2);   // every midpoint (equal neighbours give the age itself)
  q.push(first - just, first - 1, last + just, last + 1, first - (span || 1), last + (span || 1));   // outside: no extrapolation
  q.push(first + just, last - just);                                                 // just inside
  q.push(null, null, null);                                                          // a missing age
  for (let i = 0; i < random; i++) q.push(first - 0.05 * span + next() * 1.1 * span);   // 5 % beyond each end
  return q;
}

/** The current JavaScript result for one age; a missing age is missing. */
const answer = (model, inverse, a) => (a == null ? null : toAxis(a, 'age', 'depth', model, inverse));

function build({ name, description, model, queries }) {
  const inverse = invertModel(model);
  const depths = queries.map((a) => answer(model, inverse, a));
  const first = inverse.depth[0], last = inverse.depth[inverse.depth.length - 1];
  const outside = queries.filter((a) => a != null && (a < first || a > last)).length;
  const reversals = model.age.reduce((n, a, i) => n + (i && a < model.age[i - 1] ? 1 : 0), 0);
  const ties = inverse.depth.reduce((n, a, i) => n + (i && a === inverse.depth[i - 1] ? 1 : 0), 0);
  return { name, description, model, reversals, ties, queries, depths, outside };
}

/** @returns {{name: string, description: string, model: any, reversals: number, ties: number, queries: (number|null)[], depths: (number|null)[], outside: number}[]} */
export function allCases() {
  const next = seeded(851108);
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
    two('two-rows-with-range', 'The smallest model, with a range (accepted and not used).', { min: [4, 22], max: [6, 27] }, [5, 25]),
    two('two-rows-reversal', 'Two rows whose age decreases downwards: the inverse swaps them.', null, [30, 10]),
    two('two-rows-equal-ages', 'Two rows with the same age: the inverse has a single age and span 0.', null, [8, 8]),
    big('rows-1000', '1,000 rows, ages increasing, without range.', { range: false }, 2000),
    big('rows-1000-with-range', '1,000 rows, ages increasing, with a range around every age.', { range: true }, 2000),
    big('rows-1000-reversals', '1,000 rows with an age reversal every 37th step: the inverse is not a function.', { range: false, reversalEvery: 37 }, 2000),
    big('rows-1000-reversals-with-range', '1,000 rows with an age reversal every 37th step, with a range.', { range: true, reversalEvery: 37 }, 2000),
    big('rows-1000-equal-ages', '1,000 rows where every 11th step keeps the age (equal neighbouring ages, span 0).', { range: false, equalEvery: 11 }, 2000),
    big('rows-1000-reversals-equal-ages', '1,000 rows with reversals every 37th step and equal ages every 11th step, with a range.', { range: true, reversalEvery: 37, equalEvery: 11 }, 2000),
    big('rows-1000-random-100000', '1,000 rows with reversals and equal ages; 100,000 random ages (binary columns, see README).',
      { range: false, reversalEvery: 53, equalEvery: 17, firstDepth: 100, firstAge: 3 }, 100000),
  ];
}

// ---- serialisation ---------------------------------------------------------------------------------------------------

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
      expected: { summary: { rows: c.queries.length, outside: c.outside }, reversals: c.reversals, equal_neighbour_ages: c.ties },
    };
    if (c.queries.length >= BINARY_THRESHOLD) {
      // Large case: query and result columns are binary files next to the JSON (missing slot: value 0, validity 0).
      const stem = c.name;
      document.inputs.query = { rows: c.queries.length, age_file: `${stem}.query_age.f64le`, valid_file: `${stem}.query_valid.u8` };
      document.expected.depths = { depth_file: `${stem}.depth.f64le`, valid_file: `${stem}.depth_valid.u8` };
      files.set(document.inputs.query.age_file, f64le(c.queries));
      files.set(document.inputs.query.valid_file, u8(c.queries));
      files.set(document.expected.depths.depth_file, f64le(c.depths));
      files.set(document.expected.depths.valid_file, u8(c.depths));
    } else {
      document.inputs.query = { age: c.queries };
      document.expected.depths = { depth: c.depths };
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
