// Card M8.4.23: a desktop end-to-end test refuses to start on an old copy of the program (`desktop/web`, `desktop/python`) or on an engine
// runtime whose recorded sources differ from `src/`, and says the command that fixes it. It only reads files; the program itself is unchanged.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Relative paths (with /) of the files under `directory` that `keep` accepts. */
function list(directory, keep = () => true, prefix = '') {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) return list(path.join(directory, entry.name), keep, relative + '/');
    return keep(relative) ? [relative] : [];
  });
}

/** Files of `source` that are missing or different in `copy`, and files only in `copy` (unless `ignoreExtra` accepts them). */
function differences(source, copy, keep, ignoreExtra = () => false) {
  const wanted = list(source, keep), found = new Set(list(copy, () => true)), out = [];
  for (const file of wanted) {
    if (!found.has(file)) out.push('missing ' + file);
    else if (sha(path.join(source, file)) !== sha(path.join(copy, file))) out.push('differs ' + file);
  }
  const have = new Set(wanted);
  for (const file of found) if (!have.has(file) && !ignoreExtra(file)) out.push('extra ' + file);
  return out;
}

/** The problems found, as `{what, fix, files}`; empty when the program copy and the runtime are current. */
export function stale(root, platform = `${process.platform}-${process.arch}`) {
  const desktop = path.join(root, 'desktop'), problems = [];
  const webFiles = differences(path.join(root, 'app'), path.join(desktop, 'web', 'app'), (f) => !/(^|\/)README\.md$/.test(f),
    (f) => f.startsWith('vendor/'));                       // the ONNX files are added by prepare.js
  if (webFiles.length) problems.push({ what: 'desktop/web is older than app/', fix: 'node desktop/scripts/prepare.js --with-examples', files: webFiles });
  const generated = (f) => /__pycache__|\.egg-info|\.pyc$/.test(f);
  const pythonFiles = differences(path.join(root, 'src'), path.join(desktop, 'python', 'src'), (f) => !generated(f), generated);
  if (pythonFiles.length) problems.push({ what: 'desktop/python is older than src/', fix: 'node desktop/scripts/prepare.js --with-examples', files: pythonFiles });
  const manifest = path.join(desktop, 'runtime', platform, 'manifest.json');
  if (!fs.existsSync(manifest)) {
    problems.push({ what: `no engine runtime for ${platform}`, fix: 'npm run prepare-runtime   (in desktop/)', files: [] });
  } else {
    const recorded = JSON.parse(fs.readFileSync(manifest, 'utf8')).sources || [], files = [];
    for (const entry of recorded) {
      const file = path.join(root, 'src', entry.path);
      if (!fs.existsSync(file)) files.push('missing ' + entry.path);
      else if (sha(file) !== entry.sha256) files.push('differs ' + entry.path);
    }
    const known = new Set(recorded.map((entry) => entry.path));
    for (const file of list(path.join(root, 'src'), (f) => f.endsWith('.py') && !generated(f))) if (!known.has(file)) files.push('new ' + file);
    if (files.length) problems.push({ what: 'the engine runtime does not match src/', fix: 'npm run prepare-runtime -- --offline   (in desktop/)', files });
  }
  return problems;
}

/** Throws one error naming every problem and its command; call it first in a desktop test. */
export function requireFresh(root) {
  const problems = stale(root);
  if (!problems.length) return;
  throw new Error(problems.map((p) => `${p.what}. Run: ${p.fix}\n    ${p.files.slice(0, 5).join('\n    ')}${p.files.length > 5 ? `\n    ... ${p.files.length - 5} more` : ''}`).join('\n'));
}
