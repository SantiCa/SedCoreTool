import test from 'node:test';
import assert from 'node:assert/strict';
import { toCSV } from '../../app/js/core.js';

// Frozen formatter: the V0.110 text rules with the number rule of card Q4 (decision N: 15 significant digits, a value that is not a finite
// number is an empty cell); exact file equivalence is the contract.
function referenceCSV(rows) {
  const number = (value) => (!Number.isFinite(value) ? '' : String(Number.isInteger(value) ? value : +value.toPrecision(15)));
  const quote = (value) => {
    if (value == null) return '';
    let text = typeof value === 'number' ? number(value) : String(value);
    if (typeof value !== 'number' && (/^[ \u00a0]*[\t\r\n]/.test(text) || /^[\s\u0000-\u001f]*[=+@\-＝＋－＠]/u.test(text))) text = "'" + text;
    return /[",;|\t\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return rows.map((row) => row.map(quote).join(',')).join('\n') + '\n';
}

test('CSV writes 15 significant digits, keeps small values and leaves values that are not finite numbers empty (card Q4)', () => {
  assert.equal(toCSV([
    [0, -0, 42, -42, 1.2345678, -1.2345678, 0.0000004, -0.0000004],
    [1e-7, 1e21, -1e21, Number.MIN_VALUE, Number.MAX_VALUE, NaN, Infinity, -Infinity],
    [Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, 1000000000000000128],
    [1.234e-8, 0.1 + 0.2, 1234.5678901234567, 2 / 3],
  ]), '0,0,42,-42,1.2345678,-1.2345678,4e-7,-4e-7\n'
    + '1e-7,1e+21,-1e+21,5e-324,1.7976931348623157e+308,,,\n'
    + '9007199254740991,-9007199254740991,1000000000000000100\n'
    + '1.234e-8,0.3,1234.56789012346,0.666666666666667\n');
});

test('CSV retains text escaping, empty fields and row boundaries', () => {
  assert.equal(toCSV([
    ['-42', -42, '＝1+1', ' \u0000@cmd', ' \tcmd', 'a"b', 'a,b', 'a;b', 'a|b'],
    [null, undefined, '', true, false, 'a\nb', 'a\rb', 'a\tb'],
    [], new Array(3),
  ]), '\'-42,-42,\'＝1+1,\' \u0000@cmd,"\' \tcmd","a""b","a,b","a;b","a|b"\n'
    + ',,,true,false,"a\nb","a\rb","a\tb"\n\n,,\n');
  assert.equal(toCSV([]), '\n');
});

test('CSV matches the reference exactly for deterministic numbers and mixed text', () => {
  const bytes = new DataView(new ArrayBuffer(8));
  let state = 211110;
  const nextWord = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
  const texts = ['plain', '=SUM(A1)', '+1', '-1', '@cmd', '＋1', '－1', '＠cmd',
    '\u00a0=1', '\u2003=1', '\r=1', '\n=1', '"quoted"', 'a,b;c|d', 'å岩🐚'];
  const rows = [];
  for (let index = 0; index < 10000; index++) {
    bytes.setUint32(0, nextWord()); bytes.setUint32(4, nextWord());
    const number = bytes.getFloat64(0);
    rows.push([number, Math.trunc(number), (nextWord() | 0) / 1e7,
      texts[index % texts.length], null, index % 2 === 0]);
  }
  assert.equal(toCSV(rows), referenceCSV(rows));
});
