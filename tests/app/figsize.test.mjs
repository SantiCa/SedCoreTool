// Card P1: physical sizes and checks of figsize.js, and the PNG chunks of pngmeta.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { PRESETS, OKABE_ITO, mmToPt, ptToMm, widthMm, pixelsFor, pixelsPerMetre, recommendedDpi, effectiveSize, auditText, auditLines, auditRaster, panelLabel, fitWidths } from '../../app/js/figsize.js';
import { withPhys, withText, readPhys } from '../../app/js/pngmeta.js';

test('pixels for a printed width: exact values stated before comparing', () => {
  assert.equal(pixelsFor(170, 600), 4016);   // 170 / 25.4 × 600 = 4015.75
  assert.equal(pixelsFor(84, 600), 1984);    // 1984.25
  assert.equal(pixelsFor(25.4, 300), 300);
  assert.equal(pixelsPerMetre(600), 23622);
  assert.equal(pixelsPerMetre(300), 11811);
});

test('millimetres and points', () => {
  assert.ok(Math.abs(mmToPt(170) - 481.89) <= 0.005);
  assert.ok(Math.abs(ptToMm(mmToPt(84)) - 84) < 1e-12);
});

test('presets: generic is 84 / 129 / 170 and the text minimum is 7 pt (Nature 5 pt)', () => {
  const g = PRESETS.generic;
  assert.deepEqual([g.widths.single, g.widths.mid, g.widths.double, g.widths.page], [84, 129, 170, 170]);
  assert.equal(widthMm('generic', 'single'), 84); assert.equal(widthMm(PRESETS.nature, 'double'), 183); assert.equal(widthMm('generic', 'nonsense'), 170);
  assert.equal(recommendedDpi('generic', 'photo'), 300); assert.equal(recommendedDpi('generic', 'line'), 1200); assert.equal(recommendedDpi('nature', 'combination'), 450);
  assert.equal(PRESETS.nature.hardMinText, 5); assert.equal(PRESETS.elsevier.maxHeightStated, false);
  assert.ok(Object.isFrozen(PRESETS.generic) && Object.isFrozen(OKABE_ITO));
  assert.equal(OKABE_ITO.length, 8);
});

test('effective text size follows the page width', () => {
  assert.ok(Math.abs(effectiveSize(8, 170, mmToPt(170)) - 8) < 1e-12);   // 1 user unit = 1 pt
  assert.ok(Math.abs(effectiveSize(8, 84, mmToPt(170)) - 8 * 84 / 170) < 1e-9);
  assert.throws(() => effectiveSize(8, 170, 0), RangeError);
});

test('auditText flags 6.9 pt for generic and accepts 7.0; below 6 pt is an error (5 for Nature)', () => {
  assert.deepEqual(auditText([6.9], 'generic'), [{ pt: 6.9, level: 'warning' }]);
  assert.deepEqual(auditText([7.0, 7 - 1e-12, 8, 12], 'generic'), []);
  assert.deepEqual(auditText([5.9], 'generic'), [{ pt: 5.9, level: 'error' }]);
  assert.deepEqual(auditText([5.0, 4.9], 'nature'), [{ pt: 4.9, level: 'error' }]);
  assert.deepEqual(auditText([6.2], 'agu'), []);
});

test('auditLines: warning below the preset minimum, error below 0.1 pt', () => {
  assert.deepEqual(auditLines([0.25, 0.5, 2], 'generic'), []);
  assert.deepEqual(auditLines([0.2, 0.05], 'generic'), [{ pt: 0.2, level: 'warning' }, { pt: 0.05, level: 'error' }]);
  assert.deepEqual(auditLines([0.5], 'gsa'), [{ pt: 0.5, level: 'warning' }]);
});

test('auditRaster: a 900 px image at 170 mm is below 300 ppi', () => {
  const found = auditRaster([{ name: 'sections', pixelWidth: 900, widthMm: 170 }, { name: 'ok', pixelWidth: 2100, widthMm: 170 }], 'generic', 'photo');
  assert.equal(found.length, 1); assert.equal(found[0].name, 'sections'); assert.equal(found[0].needed, 300);
  assert.ok(Math.abs(found[0].ppi - 900 / (170 / 25.4)) < 1e-9);
});

test('panelLabel: styles and the sequence after z', () => {
  assert.equal(panelLabel(1, 'paren'), '(b)'); assert.equal(panelLabel(0, 'a'), 'a'); assert.equal(panelLabel(2, 'A'), 'C'); assert.equal(panelLabel(0, '(a)'), '(a)');
  assert.equal(panelLabel(25), 'z'); assert.equal(panelLabel(26), 'aa'); assert.equal(panelLabel(27), 'ab');
  assert.equal(panelLabel(26 + 26 * 26 - 1), 'zz'); assert.equal(panelLabel(26 + 26 * 26), 'aaa');
  assert.throws(() => panelLabel(-1), RangeError); assert.throws(() => panelLabel(1.5), RangeError);
});

test('fitWidths keeps the order and the proportions and sums to the target within 0.01 pt', () => {
  const natural = [40, 120, 80, 33.3, 7], out = fitWidths(natural, 481.89, 6);
  assert.equal(out.length, 5);
  assert.ok(Math.abs(out.reduce((a, b) => a + b, 0) + 6 * 4 - 481.89) < 0.01);
  for (let i = 1; i < out.length - 1; i++) assert.ok(Math.abs(out[i] / out[0] - natural[i] / natural[0]) < 1e-9);
  assert.deepEqual(fitWidths([], 100), []);
  assert.deepEqual(fitWidths([5], 100, 10), [100]);
  assert.throws(() => fitWidths([1, 0], 100), RangeError); assert.throws(() => fitWidths([1, 1, 1], 10, 5), RangeError);
});

// ---- PNG chunks ----
const crc = (buf) => zlib.crc32(buf);   // Node's own CRC-32, independent of zip.js
function minimalPng() {
  const chunk = (type, data) => {
    const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'latin1'); data.copy(b, 8);
    b.writeUInt32BE(crc(b.subarray(4, 8 + data.length)), 8 + data.length); return b;
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.from([0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 0, 255, 255, 255, 0, 0, 0]);
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
const list = (png) => {
  const v = new DataView(png.buffer, png.byteOffset), out = [];
  for (let at = 8; at < png.length; at += 12 + v.getUint32(at)) out.push({ type: Buffer.from(png.subarray(at + 4, at + 8)).toString('latin1'), at, size: v.getUint32(at) });
  return out;
};
const validCrcs = (png) => list(png).every(({ at, size }) => new DataView(png.buffer, png.byteOffset).getUint32(at + 8 + size) === crc(Buffer.from(png.subarray(at + 4, at + 8 + size))));

test('withPhys puts pHYs right after IHDR: 23622 / 23622, unit metre, valid CRC; the image data is untouched', () => {
  const src = minimalPng(), out = withPhys(src, 600);
  assert.deepEqual(list(out).map((c) => c.type), ['IHDR', 'pHYs', 'IDAT', 'IEND']);
  const at = list(out)[1].at, v = new DataView(out.buffer, out.byteOffset);
  assert.equal(v.getUint32(at), 9); assert.equal(v.getUint32(at + 8), 23622); assert.equal(v.getUint32(at + 12), 23622); assert.equal(out[at + 16], 1);
  assert.ok(validCrcs(out));
  const phys = readPhys(out);
  assert.equal(phys.ppmX, 23622); assert.equal(phys.ppmY, 23622); assert.equal(phys.unit, 1); assert.ok(Math.abs(phys.dpiX - 600) < 0.01);
  assert.equal(readPhys(src), null);
  assert.deepEqual(out.subarray(list(out)[2].at), src.subarray(list(src)[1].at));
});

test('withPhys replaces an existing pHYs and withText adds a tEXt before the image data', () => {
  const twice = withPhys(withPhys(minimalPng(), 300), 600);
  assert.equal(list(twice).filter((c) => c.type === 'pHYs').length, 1); assert.equal(readPhys(twice).ppmX, 23622);
  const out = withText(twice, 'Software', 'SedCoreTool — fig');
  assert.deepEqual(list(out).map((c) => c.type), ['IHDR', 'pHYs', 'tEXt', 'IDAT', 'IEND']); assert.ok(validCrcs(out));
  const c = list(out)[2];
  assert.equal(Buffer.from(out.subarray(c.at + 8, c.at + 8 + c.size)).toString('latin1'), 'Software\0SedCoreTool ? fig');   // the dash is not Latin-1
});

test('PNG helpers reject what is not a PNG, a truncated file and bad arguments', () => {
  assert.throws(() => withPhys(new Uint8Array(40), 600), /Not a PNG/);
  assert.throws(() => withPhys(minimalPng().subarray(0, 40), 600), /Truncated/);
  assert.throws(() => withPhys(minimalPng(), 0), RangeError); assert.throws(() => withPhys(minimalPng(), NaN), RangeError);
  assert.throws(() => withText(minimalPng(), '', 'x'), RangeError); assert.throws(() => withText(minimalPng(), 'k'.repeat(80), 'x'), RangeError);
  assert.throws(() => withText(minimalPng(), ' k', 'x'), RangeError);
});
