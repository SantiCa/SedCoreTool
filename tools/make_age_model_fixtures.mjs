// M8.5.8d: reference fixtures for engine methods core.age_model/1 and core.bacon/1 (docs/roadmap-engine-contract.md §9.11).
//
// Each fixture holds an input text and the result of the CURRENT JavaScript calculation: app/js/core.js
// parseAgeModelDetailed (core.age_model/1) and baconToAgeText (core.bacon/1). The Python methods of card M8.5.8e must
// reproduce them exactly (decision Y4): every number bit for bit (-0 included), the missing pattern and `summary`.
// A third file, js-numbers.json, records ECMAScript Number(string) and toPrecision(8) for the engine's text kernel.
// All data is synthetic and seeded (no clock, no Math.random, no real core's data); a regeneration is byte-identical.
//
// Usage (repository root):
//   node tools/make_age_model_fixtures.mjs                write tests/fixtures/age_model/
//   node tools/make_age_model_fixtures.mjs --check        fail if a committed file differs from a regeneration
//   node tools/make_age_model_fixtures.mjs --out <dir>    write somewhere else (used by the test)
//
// File formats: see tests/fixtures/age_model/README.md. Files are pure ASCII JSON: every non-ASCII character and every
// control character of a text is written as a \u escape, so git line-ending handling can never change an input's bytes.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { baconToAgeText, parseAgeModelDetailed } from '../app/js/core.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURE_DIR = path.join(root, 'tests/fixtures/age_model');
export const AGE_FORMAT = 'core-age-model-fixture/1';
export const BACON_FORMAT = 'core-bacon-fixture/1';
export const NUMBERS_FORMAT = 'js-numbers-fixture/1';
export const NUMBERS_FILE = 'js-numbers.json';

/** Deterministic generator (same one as make_core_ages_fixtures.mjs): uniform in [0, 1). */
function seeded(seed) {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

// ---- core.age_model/1 ------------------------------------------------------------------------------------------------

/** The method's output for one text, from the program's own parser: table `model` and `summary` (contract §9.11). */
export function ageModelResult(text) {
  const { model: m, issue } = parseAgeModelDetailed(text);
  const summary = {
    rows: m ? m.depth.length : 0, reversals: m ? m.reversals : 0, range_ignored: m?.rangeIgnored || 0, bacon: !!m?.bacon,
    issue: issue ? issue.kind : null, issue_depth: issue ? issue.depth : null,
  };
  const model = m ? { depth: m.depth, age: m.age, ...(m.min ? { age_min: m.min, age_max: /** @type {number[]} */ (m.max) } : {}) } : { depth: [], age: [] };
  return { summary, model, keys: m ? Object.keys(m).sort() : [] };
}

const NBSP = ' ', BOM = '﻿', LS = ' ', IDEO = '　';

/** A 10,000-row age model with a named range, seeded: depths increase, ages mostly increase. */
function largeAgeText(next) {
  const lines = ['depth,age,age_min,age_max'];
  let d = 0, a = 0.5;
  for (let i = 0; i < 10000; i++) {
    d += 0.5 + Math.round(next() * 300) / 100;
    a += i % 97 === 96 ? -next() * 0.3 : next() * 1.2;
    const lo = a - next() * 0.4, hi = a + next() * 0.4;
    lines.push(`${d.toFixed(2)},${a.toFixed(4)},${lo.toFixed(4)},${hi.toFixed(4)}`);
  }
  return lines.join('\n') + '\n';
}

function ageCases() {
  const next = seeded(858104);
  return [
    ['header-english', 'English header; comma separators; LF.', 'depth,age\n0,0.5\n10,1.25\n20,2\n'],
    ['header-english-spaces', 'English header with units, whitespace separators, upper case and quotes in the header.', '"Depth_cm"  "Age_ka"\n0 0.5\n10   1.25\n20\t2\n'],
    ['header-spanish', 'Spanish header with ";" and decimal commas; accented range names are not recognised (no range).', 'profundidad;edad;mínimo;máximo\n1,5;2,25;2;2,5\n3,5;4,75;4;5\n'],
    ['header-spanish-prof-edad', 'Spanish header "prof edad min max" with ";": range named and kept.', 'prof (cm);edad (ka);min;max\n1,5;2,25;2;2,5\n3,5;4,75;4;5\n'],
    ['no-header', 'No header, whitespace separators.', '0 1\n5 2\n10 3.5\n'],
    ['semicolon-decimal-comma', '";" with decimal commas; spaces inside a cell are removed (thousands); only the first comma of a cell becomes a point.', '10,5;3,2\n1 000,5;4\n2000,25;5,5\n3000;6,1,2\n'],
    ['tab-decimal-comma', 'Tab separators with decimal commas; consecutive tabs and tabs around ";" form one separator; ";;" gives an empty cell.', '1,5\t2,5\n2,5\t\t3,5\n3,5\t;\t4,5\n4,5;;5,5\n'],
    ['mixed-modes', 'Each line chooses its own splitting: whitespace, comma, ";" and tab lines in one text.', '1 10\n2,20\n3;30\n4\t40\n5, 50 \n'],
    ['unicode-spaces', 'U+FEFF at the start, U+00A0, U+3000 and U+2028 as whitespace (U+2028 does not end a line).',
      `${BOM}depth${NBSP}age\n1${NBSP}2\n3${IDEO}4\n5${LS}6\n${LS}7 8${NBSP}\n`],
    ['crlf', 'CRLF line ends; a lone CR does not end a line (it is whitespace inside the line).', 'depth,age\r\n1,2\r\n3,4\r5,6\r\n7,8\r\n'],
    ['comments', 'Lines starting with "#" (also after whitespace) are ignored; a "#" later in a line is just a cell.', '# a comment\n  # indented comment\ndepth,age\n1,2\n# between rows\n3,4 # not a comment\n5,6\n'],
    ['number-forms', 'ECMAScript StringToNumber: hex, binary, octal, exponent, ".5", "5.", signs and -0 are numbers; "Infinity" rows, "1_0", "nan", "inf" and Arabic digits are dropped.',
      'depth,age\n0x1A,1\n0b11111,2\n0o41,3\n1e3,4\n.5,0.25\n5.,5\n+40,6\n-0,0\nInfinity,7\n1_0,8\nnan,9\ninf,10\n١٢,11\n50,-Infinity\n'],
    ['negative-zero-first', 'Rows -0 and 0 with the same age are one depth (merged); the first in the file is kept (-0).', '-0,1\n0,1\n2,3\n'],
    ['negative-zero-second', 'As above with 0 first: 0 is kept.', '0,1\n-0,1\n2,3\n'],
    ['repeated-identical', 'Repeated identical rows (three times one row, twice another) are merged.', '1,2\n3,4\n1,2\n1,2\n3,4\n5,6\n'],
    ['repeated-identical-missing-range', 'Identical rows whose range cells are both missing in the same way are merged.', 'depth,age,min,max\n1,2,,\n1,2,,\n3,4,3,5\n'],
    ['absent-vs-empty-range-cell', 'Quirk: "5,10" (no third cell) and "5,10," (an empty third cell) are different rows, so depth 5 has two rows.', '5,10\n5,10,\n6,11\n'],
    ['dup-depth', 'One depth with two ages: no model, issue dupDepth naming that depth.', 'depth,age\n1,2\n3,4\n3,5\n6,7\n'],
    ['dup-depth-largest', 'Two depths with two ages each: the issue names the largest (merging runs from the end).', '1,2\n1,3\n4,5\n4,6\n7,8\n'],
    ['dup-depth-range', 'Same depth and age with a different range is a depth with two rows.', '1,2,1,3\n1,2,1,4\n5,6,5,7\n'],
    ['range-kept-named', 'Named range columns, consistent in every row: kept.', 'depth,age,min,max\n1,2,1.5,2.5\n3,4,3.5,4.5\n5,6,5,7\n'],
    ['range-kept-named-lower-upper', 'Range named lower/upper and 2.5/97.5.', 'depth;median;2,5;97,5\n1;2;1,5;2,5\n3;4;3,5;4,5\n'],
    ['range-ignored-named', 'Named range with a blank cell and an age outside its range: ignored and counted.', 'depth,age,age_min,age_max\n1,2,1.5,2.5\n3,4,,4.5\n5,6,6.5,7\n7,8,7,9\n'],
    ['range-kept-unnamed', 'No header, four columns, every range contains the age: kept.', '1 2 1.5 2.5\n3 4 3.5 4.5\n5 6 5 7\n'],
    ['range-ignored-unnamed', 'No header, one row whose range does not contain the age: dropped without being counted.', '1 2 1.5 2.5\n3 4 4.5 5.5\n5 6 5 7\n'],
    ['range-named-one-column', 'Only a "min" column is named: the range is never kept and nothing is counted.', 'depth,age,min\n1,2,1\n3,4,3\n'],
    ['range-swapped', 'Minimum and maximum swapped in some rows: accepted, each row reordered.', 'depth,age,min,max\n1,2,2.5,1.5\n3,4,3.5,4.5\n5,6,7,5\n'],
    ['range-infinite', 'A range cell that is Infinity is not finite: the named range is ignored and counted.', 'depth,age,min,max\n1,2,1,3\n3,4,-Infinity,5\n'],
    ['reversals', 'Ages decreasing downwards twice; rows given out of depth order are sorted.', '30,4\n0,1\n10,3\n20,2\n40,3.5\n50,6\n'],
    ['one-row', 'One row: no model and no issue.', 'depth,age\n1,2\n'],
    ['comments-only', 'Only comments and blank lines: no model.', '# nothing\n\n   \n# here\n'],
    ['bacon-pasted', 'A Bacon table pasted as text: flagged; the median is the age and min/max the range.', 'depth min max median mean\n0 10 30 20 21\n5 40 90 60 62\n10 100 200 150 149\n'],
    ['header-infinity', 'Quirk: a first line holding Infinity is taken as a header (not finite) and dropped; no range is read.', 'Infinity,5,1,9\n1,2,1,3\n3,4,3,5\n'],
    ['header-one-cell', 'A one-cell first line is not a header (it is a row and is dropped as not numeric).', 'ages\n1,2\n3,4\n'],
    ['header-age-min-first', 'Quirk: "age_min" before "age" is chosen as the age column (first name that starts with "age").', 'depth,age_min,age,age_max\n1,2,3,4\n3,4,5,6\n'],
    ['header-same-column', 'Quirk: no depth name and "age" first: depth and age are both column 0.', 'age,value\n1,2\n3,4\n'],
    ['header-depth-later', 'Depth named in a later column; age not named: the age is column 0.', 'x,depth_cm\n5,1\n6,2\n'],
    ['quoted-cells', 'Quotes are removed in the header only: quoted data cells are not numbers.', '"depth","age"\n"1","2"\n3,4\n5,6\n'],
    ['quoted-first-line-numeric', 'A quoted numeric first line is not a header (numbers once the quotes are removed) and is then dropped as a row.', '"1","2"\n3,4\n5,6\n'],
    ['nul-and-controls', 'A NUL and other control characters inside cells make them not numbers; U+001C is not whitespace.', 'depth,age\n1,2\n3\u0000,4\n\u001c5,6\n7,8\n9,10\n'],
    ['large-10000', 'A header and 10,000 generated rows with a named range and a reversal every 97th row (timing, M8.5.8i).', largeAgeText(next)],
  ].map(([name, description, text]) => ({ name: `age-${name}`, description, text }));
}

// ---- core.bacon/1 ----------------------------------------------------------------------------------------------------

const DIVISOR = { a: 1, ka: 1000, Ma: 1000000 };

/** The method's output for one table: table `rows`, `summary`, and the text lines the program writes (Z7). */
export function baconResult(text, settings) {
  const lines = baconToAgeText(text, { center: settings.center, depthUnit: settings.depth_unit, ageDiv: settings.age_divisor });
  const cells = (lines || []).map((l) => l.split(', ').map(Number));
  const column = (k) => cells.map((c) => (Number.isFinite(c[k]) ? c[k] : null));
  return { summary: { rows: cells.length }, rows: { depth: column(0), age: column(1), age_min: column(2), age_max: column(3) }, text_lines: lines };
}

/** A generated Bacon table (rbacon *_ages.txt layout: depth min max median mean; depth in cm, ages in cal yr BP). */
function baconTable(next, rows, { sep = ' ', header = 'depth min max median mean', start = 0, digits = null } = {}) {
  const cell = (v) => (digits == null ? String(v) : v.toFixed(digits));
  const out = [header.split(' ').join(sep)];
  let d = start, age = 50 + next() * 200;
  for (let i = 0; i < rows; i++) {
    const median = age, mean = age + (next() - 0.5) * 40, min = age - 20 - next() * 300, max = age + 20 + next() * 300;
    out.push([d, min, max, median, mean].map(cell).join(sep));
    d += 0.5 + Math.round(next() * 20) / 4;
    age += next() * 150;
  }
  return out.join('\n') + '\n';
}

function baconCases() {
  const next = seeded(858105);
  const s = (center, depth_unit, ageUnit) => ({ version: 1, center, depth_unit, age_divisor: DIVISOR[ageUnit] });
  const small = () => baconTable(next, 12);
  return [
    ['median-cm-ka', 'Median, depth in cm, ages in ka.', small(), s('median', 'cm', 'ka')],
    ['mean-cm-ka', 'Mean, depth in cm, ages in ka.', small(), s('mean', 'cm', 'ka')],
    ['median-mm-a', 'Median, depth in mm, ages in years.', small(), s('median', 'mm', 'a')],
    ['mean-m-ma', 'Mean, depth in m, ages in Ma.', small(), s('mean', 'm', 'Ma')],
    ['median-m-a', 'Median, depth in m, ages in years.', small(), s('median', 'm', 'a')],
    ['mean-mm-ma', 'Mean, depth in mm, ages in Ma.', small(), s('mean', 'mm', 'Ma')],
    ['tab-separated', 'Tab separators and a quoted, upper-case header (rbacon writes tabs).', baconTable(next, 6, { sep: '\t', header: '"DEPTH" "min" "max" "Median" "mean"' }), s('median', 'cm', 'ka')],
    ['crlf-semicolon', 'CRLF and ";" separators; blank lines are skipped.', baconTable(next, 6, { sep: ';' }).replace(/\n/g, '\r\n') + '\r\n  \r\n', s('mean', 'cm', 'ka')],
    ['rounding-ties', 'Exact binary ties at the 8th digit: toPrecision(8) rounds them up in magnitude (Python formatting would round to even).',
      'depth min max median mean\n123456785 12345678.5 -123456785 99999999.5 1\n12345678.5 0.5 1.5 2.5 3\n12345678.75 -0.5 0 0 0\n', s('median', 'cm', 'a')],
    ['rounding-ties-mm', 'A depth of 12,345,678.5 cm in mm is exactly 123,456,785 (a tie).', 'depth min max median mean\n12345678.5 1 2 1.5 1.5\n0.05 1 2 1.5 1.5\n', s('median', 'mm', 'a')],
    ['na-row', 'Rows with NA or a missing cell are skipped.', 'depth min max median mean\n0 10 30 20 21\n5 NA 90 60 62\n10 100 200 150 149\n15 120 230\n20 140 260 200 201\n', s('median', 'cm', 'ka')],
    ['no-centre-column', 'No median or mean column: no rows (the program then reads the file as plain text).', 'depth min max\n0 10 30\n5 40 90\n', s('median', 'cm', 'ka')],
    ['no-min-column', 'No min column: no rows.', 'depth max median mean\n0 30 20 21\n5 90 60 62\n', s('median', 'cm', 'ka')],
    ['centre-fallback-median', 'Mean asked for, only a median column: the median is used.', 'depth min max median\n0 10 30 20\n5 40 90 60\n', s('mean', 'cm', 'ka')],
    ['centre-fallback-mean', 'Median asked for, only a mean column: the mean is used.', 'depth min max mean\n0 10 30 21\n5 40 90 62\n', s('median', 'cm', 'ka')],
    ['one-row', 'One valid row: no rows.', 'depth min max median mean\n0 10 30 20 21\n5 NA NA NA NA\n', s('median', 'cm', 'ka')],
    ['comment-first-line', 'A "#" first line is the header (comments are not skipped): no rows.', '# Bacon output\ndepth min max median mean\n0 10 30 20 21\n5 40 90 60 62\n', s('median', 'cm', 'ka')],
    ['comment-between-rows', 'A "#" line among the rows is skipped because its cells are not numbers.', 'depth min max median mean\n0 10 30 20 21\n# note\n5 40 90 60 62\n', s('median', 'cm', 'ka')],
    ['empty-cell-is-zero', 'Quirk: a leading separator or a cell of U+00A0 only reads as 0 (Number of an empty or blank string).',
      `depth min max median mean\n,10,30,20,21\n5 40${'\t'}${NBSP} 60 62\n10 100 200 150 149\n`, s('median', 'cm', 'ka')],
    ['decimal-comma-splits', 'Quirk: a decimal comma is a separator, so "1,5" is two cells.', 'depth;min;max;median;mean\n1,5;10;30;20;21\n5;40;90;60;62\n10;100;200;150;149\n', s('median', 'cm', 'ka')],
    ['quoted-cells', 'Quotes are removed from the header only: a quoted data row is skipped.', '"depth" "min" "max" "median" "mean"\n"0" "10" "30" "20" "21"\n5 40 90 60 62\n10 100 200 150 149\n', s('median', 'cm', 'ka')],
    ['number-forms', 'Cells read by ECMAScript Number: hex, exponent, ".5", U+00A0 around a cell; Infinity rows skipped.',
      `depth min max median mean\n0x10 1e2 3e2 2e2 2e2\n.5 1. 3. 2. 2.\n${NBSP}20${NBSP} 40 90 60 62\nInfinity 1 2 1 1\n30 1 2 1 1\n`, s('median', 'cm', 'ka')],
    ['depth-overflow-mm', 'A depth near the largest double in mm overflows to Infinity: JavaScript writes "Infinity" (the method returns a missing slot).',
      'depth min max median mean\n1e308 1 2 1.5 1.5\n-1e308 1 2 1.5 1.5\n5 1 2 1.5 1.5\n', s('median', 'mm', 'ka')],
    ['large-10000', '10,000 generated rows with four decimals, tab separators (timing, M8.5.8i).', baconTable(next, 10000, { sep: '\t', digits: 4 }), s('median', 'cm', 'ka')],
  ].map(([name, description, text, settings]) => ({ name: `bacon-${name}`, description, text, settings }));
}

// ---- js-numbers.json -------------------------------------------------------------------------------------------------

const NUMBER_STRINGS = [
  '0', '-0', '+0', '1', '-1', '.5', '5.', '+.5', '-.5e1', '1e3', '1E3', '1e+3', '1e-3', '00012', '-00.5', '0.0e0', '0.1',
  '0x1A', '0X1a', '0b101', '0B11', '0o17', '0O7', '-0x1A', '+0x1A', '0x', '0b2', '0o8', '0x1.5', '0x1fffffffffffff', '0x20000000000001',
  '0x20000000000003', `0x${'f'.repeat(300)}`, `0x${'1'.repeat(256)}`,
  'Infinity', '+Infinity', '-Infinity', 'infinity', 'INFINITY', 'inf', 'nan', 'NaN', '1_000', '1,5', '1.5.', '..5', 'e5', '1e', '1e+', '.e1',
  '  12  ', `${NBSP}12${NBSP}`, `${BOM}12`, `${LS}12`, `${IDEO} 1`, '᠎1', '\u00851', '\u001c1', ' 1 ', '\t\n\v\f\r1', '١٢', '１２',
  '9007199254740993', '9007199254740995', '123456789012345678901234567890', '1e400', '-1e400', '1e-400',
  '4.9e-324', '2e-324', '2.4703282292062328e-324', '2.4703282292062327e-324', '1.7976931348623158e308', '1.7976931348623159e308',
  '0.000001', '1e-7', '1e21', '123456785', '12345678.5', '', ' ', '+', '-', '.', '1 2', '1\u00002', '"1"', '+-1', '--1',
];

function numberStrings() {
  const next = seeded(858106);
  const list = [...NUMBER_STRINGS];
  for (let i = 0; i < 200; i++) list.push(`${(next() * 2e6 - 1e6).toFixed(Math.floor(next() * 12))}e${Math.floor(next() * 40) - 20}`);
  return list.map((s) => [s, Number(s)]);
}

function precisionValues() {
  const next = seeded(858107);
  const list = [0, -0, 1, -1, 0.5, 0.1, 1 / 3, 2 / 3, 123456785, -123456785, 12345678.5, -12345678.5, 99999999.5, 999999995, 1.5e300,
    1e-320, 5e-324, 1.7976931348623157e308, -1.7976931348623157e308, 9.99999995e-7, 0.000001, 1e21, 123456789012, 1.00000005, 2 ** 53 + 2];
  for (let i = 0; i < 500; i++) list.push((next() - 0.5) * 10 ** (Math.floor(next() * 61) - 30));
  for (let i = 0; i < 200; i++) list.push((Math.floor(next() * 9e7) + 1e7) * 10 + 5);                  // 9-digit integers ending in 5: ties
  for (let i = 0; i < 200; i++) list.push(((Math.floor(next() * 9e7) + 1e7) * 2 + 1) / 2 ** (1 + Math.floor(next() * 3)));   // halves, quarters, eighths
  return list.map((x) => { const text = x.toPrecision(8); return [x, text, +text]; });
}

// ---- serialisation ---------------------------------------------------------------------------------------------------

const MINUS_ZERO = '\u0000minus-zero\u0000', NOT_A_NUMBER = 'NaN';
/** JSON that keeps -0 (written -0.0) and names NaN/±Infinity as strings; every character outside printable ASCII escaped. */
export function stableJSON(value) {
  const text = JSON.stringify(value, (_k, v) => {
    if (typeof v !== 'number') return v;
    if (Object.is(v, -0)) return MINUS_ZERO;
    if (Number.isNaN(v)) return NOT_A_NUMBER;
    if (!Number.isFinite(v)) return v > 0 ? 'Infinity' : '-Infinity';
    return v;
  });
  return text.replaceAll(JSON.stringify(MINUS_ZERO), '-0.0')
    .replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** @returns {Map<string, string>} file name -> exact file content */
export function buildFixtures() {
  const files = new Map();
  for (const c of ageCases()) {
    const { summary, model } = ageModelResult(c.text);
    files.set(`${c.name}.json`, `${stableJSON({ format: AGE_FORMAT, name: c.name, description: c.description,
      inputs: { settings: { version: 1 }, text: c.text }, expected: { summary, model } })}\n`);
  }
  for (const c of baconCases()) {
    const { summary, rows, text_lines } = baconResult(c.text, c.settings);
    files.set(`${c.name}.json`, `${stableJSON({ format: BACON_FORMAT, name: c.name, description: c.description,
      inputs: { settings: c.settings, table_text: c.text }, expected: { summary, rows, text_lines } })}\n`);
  }
  files.set(NUMBERS_FILE, `${stableJSON({ format: NUMBERS_FORMAT, number: numberStrings(), to_precision_8: precisionValues() })}\n`);
  return files;
}

/** Writes `files` into `dir` (created when missing). */
export function writeFixtures(files, dir) {
  mkdirSync(dir, { recursive: true });
  for (const [file, content] of files) writeFileSync(path.join(dir, file), content);
}

const same = (file, content) => readFileSync(path.join(FIXTURE_DIR, file)).toString('utf8').replace(/\r\n/g, '\n') === content;

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
