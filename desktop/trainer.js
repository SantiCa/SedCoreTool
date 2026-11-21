// V0.17: training of U-Net models on the user's computer, from the desktop program.
// The app sends the training ZIP (same as «U-Net training data»); this module runs the Python package
// (`python -m sedcoretool.cli unet prepare|train`) in a private virtual environment and reports progress.
// The environment (PyTorch + sedcoretool[unet], 2–3 GB) is installed on demand with the system Python ≥ 3.10.
// Plain Node (no Electron imports), so it can be tested on its own.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { ModelStore, safe, isRunId, readRecord, writeJSONAtomic } = require('./model-store');

const WIN = process.platform === 'win32';

// Card M8.4.38: what `train(opt)` accepts from the page, checked before anything is written or started. The page sends name, epochs, pretrained,
// resume and, for a new run, zip, val and test; tile, overlap and encoder keep the command line's defaults unless given within these bounds.
// The size limit of the training ZIP (2 GiB) is a chosen bound, not a measured one.
const TRAIN_OPTIONS = new Set(['zip', 'name', 'val', 'test', 'epochs', 'pretrained', 'tile', 'overlap', 'encoder', 'resume']);
const ENCODERS = new Set(['resnet18', 'resnet34', 'resnet50']);
const MAX_TRAINING_ZIP_BYTES = 2 * 2 ** 30, MAX_CORES = 1024, MAX_CORE_NAME = 200, MAX_NAME = 1024, MAX_EPOCHS = 10000;
const ZIP_SIGNATURES = [[0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06]];   // a local file header, or the end record of an empty archive
const CAPTURE_LIMIT = 1048576;                                             // characters kept of a short command's output

class InvalidOption extends Error {
  constructor(field) { super(`invalid-option: ${field}`); this.code = 'INVALID_OPTION'; this.field = field; }
}
const integerIn = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;
/** A list of core names for `--val` / `--test`: never empty strings, control characters or a leading '-' (which the command line would read as an option). */
const coreList = (value, field) => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_CORES) throw new InvalidOption(field);
  for (const core of value) {
    if (typeof core !== 'string' || !core.length || core.length > MAX_CORE_NAME || core.startsWith('-') || /[\x00-\x1f\x7f]/.test(core)) throw new InvalidOption(field);
  }
  return [...value];
};
/** The bytes of the training ZIP as a Buffer (a view, not a copy), or null. */
const zipBytes = (value) => {
  if (Buffer.isBuffer(value)) return value;
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  return null;
};

/**
 * Card M8.4.38: the options of a training request, checked against strict types and bounds; unknown options are refused. Returns a clean copy
 * `{name, resume, epochs, pretrained, tile, overlap, encoder, val, test, zip}` (zip null when resuming). Throws `InvalidOption` naming the field.
 * `maxZipBytes` exists for tests, which cannot allocate 2 GiB.
 */
function trainingOptions(opt, { maxZipBytes = MAX_TRAINING_ZIP_BYTES } = {}) {
  if (!opt || typeof opt !== 'object' || Array.isArray(opt)) throw new InvalidOption('options');
  for (const key of Object.keys(opt)) if (!TRAIN_OPTIONS.has(key)) throw new InvalidOption(key);
  const bool = (key) => { if (opt[key] !== undefined && typeof opt[key] !== 'boolean') throw new InvalidOption(key); return opt[key]; };
  if (opt.name !== undefined && (typeof opt.name !== 'string' || opt.name.length > MAX_NAME)) throw new InvalidOption('name');
  const resume = bool('resume') === true, pretrained = bool('pretrained') !== false;
  const epochs = opt.epochs ?? 60, tile = opt.tile ?? 512, overlap = opt.overlap ?? 64, encoder = opt.encoder ?? 'resnet34';
  if (!integerIn(epochs, 1, MAX_EPOCHS)) throw new InvalidOption('epochs');
  if (!integerIn(tile, 64, 4096)) throw new InvalidOption('tile');
  if (!integerIn(overlap, 0, 1024) || overlap >= tile) throw new InvalidOption('overlap');
  if (typeof encoder !== 'string' || !ENCODERS.has(encoder)) throw new InvalidOption('encoder');
  const val = coreList(opt.val, 'val'), test = coreList(opt.test, 'test');
  let zip = null;
  if (!resume) {
    zip = zipBytes(opt.zip);
    if (!zip || zip.length < 22 || !ZIP_SIGNATURES.some((signature) => signature.every((byte, k) => zip[k] === byte))) throw new InvalidOption('zip');
    if (zip.length > maxZipBytes) throw new InvalidOption('zip');
  }
  return { name: safe(opt.name), resume, epochs, pretrained, tile, overlap, encoder, val, test, zip };
}

/**
 * Card M8.4.38: stop a command and every process it started. On Windows `taskkill /T` walks the tree from the command (so it runs while the
 * command is still there), then the command itself is ended in case taskkill could not; elsewhere the command leads its own process group.
 */
function terminateTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null || !Number.isInteger(child.pid)) return;
  if (WIN) {
    const killer = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    const fallback = () => { if (child.exitCode === null && child.signalCode === null) child.kill(); };
    killer.on('error', fallback); killer.on('exit', fallback);
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  }
}

/** A short command run without blocking the main process: `{status, stdout, stderr}`; status null when it could not start or ran past `timeoutMs`. */
function capture(cmd, args, { timeoutMs, env = process.env } = {}) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(cmd, args, { env, windowsHide: true, detached: !WIN, stdio: ['ignore', 'pipe', 'pipe'] }); } catch { resolve({ status: null, stdout: '', stderr: '' }); return; }
    let stdout = '', stderr = '', finished = false;
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (text) => { if (stdout.length < CAPTURE_LIMIT) stdout += text; });
    child.stderr.on('data', (text) => { if (stderr.length < CAPTURE_LIMIT) stderr += text; });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; terminateTree(child); }, timeoutMs);
    const finish = (status) => { if (finished) return; finished = true; clearTimeout(timer); resolve({ status: timedOut ? null : status, stdout, stderr }); };
    child.on('error', () => finish(null));
    child.on('close', (code, signal) => finish(signal ? null : code));
  });
}

class Trainer {
  /**
   * root: folder for the environment, runs and models (Electron: userData/trainer).
   * pySrc: folder with the Python package source (pyproject.toml + src/).
   * send(event, data): progress events to the window ('log', 'progress', 'done', 'error', 'state').
   * python: optional interpreter that already has sedcoretool[unet] (skips the private environment; for tests).
   */
  constructor({ root, pySrc, send = () => {}, python = process.env.SEDCORETOOL_PYTHON || process.env.CORANTOOL_PYTHON || null }) {
    Object.assign(this, { root, pySrc, send, fixedPython: python, child: null, busy: null, cancelRequested: false });
    this.modelStore = new ModelStore(root);
    fs.mkdirSync(path.join(root, 'runs'), { recursive: true });
    fs.mkdirSync(path.join(root, 'staging'), { recursive: true });
  }

  get venv() { return path.join(this.root, 'venv'); }
  get venvPython() { return path.join(this.venv, WIN ? 'Scripts/python.exe' : 'bin/python'); }
  python() { return this.fixedPython || (fs.existsSync(this.venvPython) ? this.venvPython : null); }

  /** System Python ≥ 3.10 used to create the environment: { cmd, args, version } or null. */
  async systemPython() {
    const cands = WIN ? [['py', ['-3']], ['python', []], ['python3', []]] : [['python3', []], ['python', []]];
    for (const [cmd, pre] of cands) {
      const r = await capture(cmd, [...pre, '-c', 'import sys;print("%d.%d" % sys.version_info[:2])'], { timeoutMs: 15000 });
      const v = r.stdout.trim(), [a, b] = v.split('.').map(Number);
      if (r.status === 0 && (a > 3 || (a === 3 && b >= 10))) return { cmd, args: pre, version: v };
    }
    return null;
  }

  async hasNvidia() { return (await capture('nvidia-smi', ['-L'], { timeoutMs: 15000 })).status === 0; }

  /** Use the bundled application code with the dependencies from the managed interpreter. */
  pythonEnv(bundled = true) {
    const src = this.pySrc && path.join(this.pySrc, 'src');
    const env = { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' };
    if (bundled && !this.fixedPython && src && fs.existsSync(path.join(src, 'sedcoretool', 'cli.py'))) {
      env.PYTHONPATH = [src, env.PYTHONPATH].filter(Boolean).join(path.delimiter);
    }
    return env;
  }

  /** What the dialog shows: interpreter, whether the module is ready, training hardware, models and an unfinished run. */
  async status() {
    const py = this.python(), out = { python: py, installed: false, device: null, system: null, models: this.models(), busy: this.busy, platform: process.platform };
    if (!py) { out.system = await this.systemPython(); return out; }
    const r = await capture(py, ['-m', 'sedcoretool.cli', 'unet', 'device'], { timeoutMs: 120000, env: this.pythonEnv() });
    if (r.status === 0) { out.installed = true; try { out.device = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { /* keep null */ } }
    else out.error = r.stderr.trim().split('\n').slice(-3).join('\n');
    return out;
  }

  /** Run a command, sending each output line; resolves with the exit code. */
  run(cmd, args, opt = {}) {
    return new Promise((resolve, reject) => {
      const cli = args[0] === '-m' && args[1] === 'sedcoretool.cli';
      const env = this.pythonEnv(cli);
      const p = spawn(cmd, args, { cwd: opt.cwd || this.root, env, windowsHide: true, detached: !WIN });   // its own process group: cancel() ends the tree
      this.child = p;
      const feed = (buf) => {
        for (const line of String(buf).split(/\r?\n/)) {
          if (!line.trim()) continue;
          if (line.startsWith('{"progress"')) { try { this.send('progress', JSON.parse(line).progress); continue; } catch { /* plain line */ } }
          this.send('log', line);
        }
      };
      p.stdout.on('data', feed); p.stderr.on('data', feed);
      p.on('error', (error) => { if (this.child === p) this.child = null; reject(error); });
      p.on('close', (code, signal) => { if (this.child === p) this.child = null; resolve(signal ? -1 : code); });
    });
  }

  async step(label, cmd, args) {
    this.checkCancellation();
    this.send('log', `▸ ${label}`);
    this.checkCancellation();
    const code = await this.run(cmd, args);
    this.checkCancellation();
    if (code !== 0) throw new Error(code === -1 ? 'cancelled' : `${label}: exit code ${code}`);
  }

  /** Private environment: venv + PyTorch (CUDA build on Windows with an NVIDIA card) + sedcoretool[unet] from pySrc. */
  async install() {
    if (this.busy) throw new Error('busy');
    this.busy = 'install';                                                  // taken before the search, which no longer blocks (card M8.4.38)
    let sys;
    try { sys = await this.systemPython(); } catch (error) { this.busy = null; throw error; }
    if (!sys) { this.busy = null; throw new Error('python-missing'); }
    this.cancelRequested = false;
    this.send('state', { busy: this.busy });
    try {
      if (!fs.existsSync(this.venvPython)) await this.step(`Python ${sys.version}: virtual environment`, sys.cmd, [...sys.args, '-m', 'venv', this.venv]);
      const py = this.venvPython;
      await this.step('pip', py, ['-m', 'pip', 'install', '--upgrade', 'pip']);
      const torch = ['-m', 'pip', 'install', 'torch'];
      if (WIN && await this.hasNvidia()) torch.push('--index-url', 'https://download.pytorch.org/whl/cu128');   // PyPI wheels for Windows are CPU-only
      await this.step('PyTorch', py, torch);
      const src = path.join(os.tmpdir(), `sedcoretool-py-${Date.now()}`);   // pip builds in the source folder: use a writable copy
      fs.cpSync(this.pySrc, src, { recursive: true });
      try { await this.step('sedcoretool[unet]', py, ['-m', 'pip', 'install', `${src}[unet]`]); } finally { fs.rmSync(src, { recursive: true, force: true }); }
      this.send('log', '✓');
    } finally { this.busy = null; this.send('state', { busy: null }); }
  }

  /**
   * Train from the app's ZIP. opt = { zip (Uint8Array), name, val: [], test: [], epochs, pretrained, tile, overlap,
   * encoder, resume }. Work stays separate from published models, including when resuming a legacy checkpoint.
   */
  async train(request) {
    if (this.busy) throw new Error('busy');
    const opt = trainingOptions(request);                                   // card M8.4.38: before anything is written or started
    const py = this.python(); if (!py) throw new Error('not-installed');
    const name = opt.name;
    this.cancelRequested = false;
    this.busy = 'train';
    try {
      this.send('state', { busy: this.busy, name });
      this.checkCancellation();
      const resume = opt.resume, run = this.prepareRun(name, resume), { data, model, zip } = run;
      if (!resume) {
        await fs.promises.writeFile(zip, opt.zip);
        this.checkCancellation();
        const a = ['-m', 'sedcoretool.cli', 'unet', 'prepare', zip, data, '--tile', String(opt.tile), '--overlap', String(opt.overlap)];
        if (opt.val.length) a.push('--val', ...opt.val);
        if (opt.test.length) a.push('--test', ...opt.test);
        await this.step('prepare', py, a);
      }
      // A resumed attempt must generate a new pair, never publish stale outputs left by a failed export/evaluation.
      for (const extension of ['.onnx', '.json']) fs.rmSync(model + extension, { force: true });
      const ev = path.join(run.directory, 'evaluation_test.json');
      fs.rmSync(ev, { force: true });
      const a = ['-m', 'sedcoretool.cli', 'unet', 'train', data, model, '--epochs', String(opt.epochs), '--encoder', opt.encoder, '--progress-json'];
      if (!opt.pretrained) a.push('--no-pretrained');
      if (resume) a.push('--resume');
      await this.step(resume ? 'train (resume)' : 'train', py, a);
      const test = JSON.parse(fs.readFileSync(path.join(data, 'dataset.json'), 'utf8')).split.test.cores;
      if (test.length) await this.step('evaluate (test cores)', py, ['-m', 'sedcoretool.cli', 'unet', 'evaluate', zip, model + '.onnx', '--dataset', data, '-o', ev]);
      this.checkCancellation();
      const evaluation = this.modelStore.publish({ name, base: model, runId: run.id, evaluationFile: test.length ? ev : null });
      this.send('done', { name, evaluation });
      return name;
    } finally { this.busy = null; this.send('state', { busy: null }); }
  }

  checkCancellation() { if (this.cancelRequested) throw new Error('cancelled'); }

  /** Card M8.4.38: the running command and every process it started (pip's builds, PyTorch's data workers) are ended. */
  cancel() { if (this.busy) this.cancelRequested = true; if (this.child) terminateTree(this.child); }

  pendingDirectory(name) {
    const parent = path.resolve(this.root, 'staging'), directory = path.resolve(parent, `${safe(name)}.pending`);
    if (path.dirname(directory) !== parent) throw new Error('Training workspace must remain inside staging');
    return directory;
  }

  pendingRun(name) {
    const directory = this.pendingDirectory(name), manifest = path.join(directory, 'run.json');
    if (!fs.existsSync(manifest)) return null;
    const info = readRecord(manifest);
    if (!isRunId(info.id) || typeof info.model !== 'string' || safe(info.model) !== info.model || typeof info.legacy !== 'boolean') {
      throw new Error(`Invalid training workspace: ${manifest}`);
    }
    const source = info.legacy ? path.join(this.root, 'runs', safe(name)) : directory;
    return { directory, manifest, id: info.id, legacy: info.legacy,
      data: path.join(source, 'data'), zip: path.join(source, 'dataset.zip'), model: path.join(directory, info.model) };
  }

  prepareRun(name, resume) {
    const directory = this.pendingDirectory(name), manifest = path.join(directory, 'run.json');
    if (!resume) {
      // pendingDirectory checks the absolute parent before this recursive deletion; published files live elsewhere.
      fs.rmSync(directory, { recursive: true, force: true });
      fs.mkdirSync(directory);
      writeJSONAtomic(manifest, { id: randomUUID(), model: 'model', legacy: false });
    } else {
      if (!this.pendingRun(name)) this.importLegacyRun(name);
      const run = this.pendingRun(name);
      if (!fs.existsSync(path.join(run.data, 'dataset.json')) || !fs.existsSync(run.model + '.ckpt')) throw new Error('No prepared checkpoint to resume');
      // Even an explicit resume of a completed run becomes a separate unpublished attempt.
      writeJSONAtomic(manifest, { id: randomUUID(), model: path.basename(run.model), legacy: run.legacy });
    }
    return this.pendingRun(name);
  }

  importLegacyRun(name) {
    const source = path.join(this.root, 'models', name), data = path.join(this.root, 'runs', name, 'data', 'dataset.json');
    if (!fs.existsSync(source + '.ckpt') || !fs.existsSync(data)) throw new Error('No prepared checkpoint to resume');
    const directory = this.pendingDirectory(name);
    fs.mkdirSync(directory);
    try {
      for (const extension of ['.ckpt', '.pt']) if (fs.existsSync(source + extension)) fs.copyFileSync(source + extension, path.join(directory, name + extension));
      // Preserve Python's pending-best recovery: its checkpoint stores the original weight-file basename.
      for (const file of fs.readdirSync(path.dirname(source))) if (file.startsWith(`.${name}.pt.`) && file.endsWith('.tmp')) {
        fs.copyFileSync(path.join(path.dirname(source), file), path.join(directory, file));
      }
      writeJSONAtomic(path.join(directory, 'run.json'), { id: randomUUID(), model: name, legacy: true });
    } catch (error) {
      fs.rmSync(directory, { recursive: true, force: true });
      throw error;
    }
  }

  /** Trained models: name, validation Dice, best epoch, date and test score if evaluated. */
  models() {
    return this.modelStore.list();
  }

  /** Files of a trained model, for loading it in the app. */
  readModel(name) {
    return this.modelStore.read(name);
  }

  /** A model whose last run stopped before the end (can be resumed). */
  unfinished(name) {
    name = safe(name);
    const run = this.pendingRun(name);
    if (run) return fs.existsSync(path.join(run.data, 'dataset.json')) && fs.existsSync(run.model + '.ckpt')
      && this.modelStore.current(name).runId !== run.id;
    const base = path.join(this.root, 'models', name);
    return fs.existsSync(base + '.ckpt') && !fs.existsSync(base + '.onnx');
  }
}

module.exports = { Trainer, safe, trainingOptions, capture, MAX_TRAINING_ZIP_BYTES };
