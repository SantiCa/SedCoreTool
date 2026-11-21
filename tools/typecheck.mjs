import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ts = createRequire(import.meta.url)('typescript');
const root = fileURLToPath(new URL('../', import.meta.url));
const configPath = path.join(root, 'tsconfig.json');
const baselinePath = path.join(root, 'tools/typecheck-baseline.json');
const slash = (text) => text.replaceAll('\\', '/');
const relative = (file) => slash(path.relative(root, file));
const strictFiles = new Set(['app/js/sectiondepth.js', 'app/js/sectionanalysis.js', 'app/js/residentstore.js', 'app/js/sectionpixels.js', 'app/js/engineclient.js', 'app/js/engineanalysis.js', 'app/js/unetmodel.js', 'app/js/core.js', 'app/js/state.js', 'app/js/imageproc.js']);
const host = { getCurrentDirectory: () => root, getCanonicalFileName: (f) => f, getNewLine: () => '\n' };

function diagnosticKey(diagnostic) {
  const { file, start, code, messageText } = diagnostic;
  if (!file || start === undefined) return null;
  const name = relative(file.fileName);
  const { line } = file.getLineAndCharacterOfPosition(start), lines = file.getLineStarts();
  const sourceLine = file.text.slice(lines[line], lines[line + 1]).trim();
  const message = slash(ts.flattenDiagnosticMessageText(messageText, '\n')).replaceAll(slash(root), './');
  const hash = createHash('sha256').update(sourceLine).update('\0').update(message).digest('hex').slice(0, 20);
  return `${name}:${code}:${hash}`;
}

const config = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = config.error ? null : ts.parseJsonConfigFileContent(config.config, ts.sys, root, {}, configPath);
const configErrors = config.error ? [config.error] : parsed.errors;
if (configErrors.length) {
  process.stderr.write(ts.formatDiagnostics(configErrors, host));
  process.exit(1);
}
const program = ts.createProgram(parsed.fileNames, parsed.options);
const diagnostics = ts.getPreEmitDiagnostics(program).filter((d) => d.category === ts.DiagnosticCategory.Error);

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const remaining = new Map(Object.entries(baseline));
const newErrors = diagnostics.filter((d) => {
  const key = diagnosticKey(d), count = remaining.get(key) || 0;
  if (!count || strictFiles.has(relative(d.file.fileName))) return true;
  remaining.set(key, count - 1);
  return false;
});
if (newErrors.length) {
  process.stderr.write(ts.formatDiagnostics(newErrors, host));
  process.exitCode = 1;
} else {
  const unused = [...remaining.values()].reduce((sum, count) => sum + count, 0);
  if (unused && process.argv.includes('--prune-baseline')) {
    const active = Object.fromEntries(Object.entries(baseline)
      .map(([key, count]) => [key, count - remaining.get(key)])
      .filter(([, count]) => count > 0));
    writeFileSync(baselinePath, JSON.stringify(active, null, 2) + '\n');
  }
  console.log(`JavaScript typecheck passed (${diagnostics.length} existing diagnostics; ${unused} resolved baseline entries).`);
}
