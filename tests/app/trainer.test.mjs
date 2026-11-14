import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtempSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { Trainer, safe } from '../../desktop/trainer.js';

test('the managed trainer resolves current bundled Python code before its installed copy', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sedcoretool-trainer-'));
  const pySrc = fileURLToPath(new URL('../../', import.meta.url));
  try {
    const managed = new Trainer({ root, pySrc, python: null });
    assert.equal(managed.pythonEnv().PYTHONPATH.split(path.delimiter)[0], path.join(pySrc, 'src'));
    const external = new Trainer({ root, pySrc, python: 'external-python' });
    assert.equal(external.pythonEnv().PYTHONPATH, process.env.PYTHONPATH);
  } finally {
    rmdirSync(path.join(root, 'models'));
    rmdirSync(path.join(root, 'runs'));
    rmdirSync(path.join(root, 'staging'));
    rmdirSync(root);
  }
});

function trainerFixture(t, name = 'core') {
  const root = mkdtempSync(path.join(tmpdir(), 'sedcoretool-model-save-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const fixture = { root, name, calls: [], events: [], revision: 'replacement', fail: null, cancelAt: null };
  const trainer = new Trainer({ root, python: 'fake-python', send: (event, data) => {
    fixture.events.push([event, data]); fixture.onEvent?.(event, data);
  } });
  fixture.trainer = trainer;
  fixture.options = { name, zip: new Uint8Array([1, 2, 3]), epochs: 4, pretrained: false };
  fixture.dataset = { split: { train: { cores: ['train'] }, val: { cores: ['validation'] }, test: { cores: ['test'] } } };
  const legacy = path.join(root, 'models', safe(name)), legacyRun = path.join(root, 'runs', safe(name));
  fs.mkdirSync(path.join(legacyRun, 'data'), { recursive: true });
  fs.writeFileSync(path.join(legacyRun, 'data', 'dataset.json'), JSON.stringify(fixture.dataset));
  fs.writeFileSync(path.join(legacyRun, 'dataset.zip'), 'LEGACY DATA');
  fs.writeFileSync(legacy + '.onnx', 'LAST VALID ONNX');
  fs.writeFileSync(legacy + '.json', JSON.stringify({ tile: 4, overlap: 1, valDice: .7, bestEpoch: 2, split: fixture.dataset.split }));
  fs.writeFileSync(legacy + '.ckpt', 'LAST CHECKPOINT');
  fs.writeFileSync(legacy + '.pt', 'LAST BEST WEIGHTS');
  fs.writeFileSync(path.join(legacyRun, 'evaluation_test.json'), JSON.stringify({ cores: ['test'], pooled: { dice: .6 } }));
  fixture.legacy = legacy;
  fixture.original = trainer.readModel(name);
  fixture.originalList = trainer.models();
  trainer.run = async (_command, args) => {
    const phase = args[3]; fixture.calls.push([...args]);
    fixture.beforePhase?.(phase, args);
    if (phase === 'prepare') {
      fs.mkdirSync(args[5], { recursive: true });
      fs.writeFileSync(path.join(args[5], 'dataset.json'), JSON.stringify(fixture.dataset));
      fs.writeFileSync(path.join(args[5], 'tiles'), 'PREPARED TILES');
    } else if (phase === 'train') {
      const model = args[5];
      fs.writeFileSync(model + '.ckpt', fixture.revision + ' CHECKPOINT');
      fs.writeFileSync(model + '.pt', fixture.revision + ' WEIGHTS');
      fs.writeFileSync(model + '.onnx', fixture.revision + ' ONNX');
      if (fixture.fail !== 'train') fs.writeFileSync(model + '.json', JSON.stringify({ tile: 4, overlap: 1,
        valDice: .8, bestEpoch: 4, revision: fixture.revision, split: fixture.dataset.split }));
    } else if (phase === 'evaluate') {
      fs.writeFileSync(args.at(-1), JSON.stringify({ cores: ['test'], pooled: { dice: .75 }, revision: fixture.revision }));
    } else throw new Error('Unexpected phase: ' + phase);
    fixture.afterPhase?.(phase, args);
    if (fixture.cancelAt === phase) trainer.cancel();
    return fixture.fail === phase ? 2 : 0;
  };
  return fixture;
}

function assertLegacyPreserved(fixture) {
  const { trainer, name, original, originalList, legacy } = fixture;
  assert.deepEqual(trainer.readModel(name), original);
  assert.deepEqual(trainer.models(), originalList);
  assert.deepEqual(fs.readFileSync(legacy + '.onnx'), original.onnx);
  assert.equal(fs.readFileSync(legacy + '.json', 'utf8'), original.json);
  assert.equal(trainer.busy, null);
  assert.equal(fixture.events.some(([event]) => event === 'done'), false);
}

test('preparation, training and evaluation failures preserve the last published model and scores', async (t) => {
  for (const phase of ['prepare', 'train', 'evaluate']) await t.test(phase, async (t) => {
    const fixture = trainerFixture(t); fixture.fail = phase;
    fixture.beforePhase = () => assert.deepEqual(fixture.trainer.readModel(fixture.name), fixture.original);
    await assert.rejects(fixture.trainer.train(fixture.options), /exit code 2/);
    assertLegacyPreserved(fixture);
    assert.equal(fixture.trainer.unfinished(fixture.name), phase !== 'prepare');
    const reopened = new Trainer({ root: fixture.root, python: 'fake-python' });
    assert.deepEqual(reopened.readModel(fixture.name), fixture.original);
    assert.equal(reopened.unfinished(fixture.name), phase !== 'prepare');
  });
});

test('publication switches the matching pair and evaluation together while retaining legacy and prior generation bytes', async (t) => {
  const fixture = trainerFixture(t), { trainer, name } = fixture;
  await trainer.train(fixture.options);
  assert.equal(trainer.readModel(name).onnx.toString(), 'replacement ONNX');
  assert.equal(JSON.parse(trainer.readModel(name).json).revision, 'replacement');
  assert.equal(trainer.models().length, 1);
  assert.equal(trainer.models()[0].test.dice, .75);
  assert.equal(trainer.unfinished(name), false);
  const previous = trainer.modelStore.current(name);
  const oldFiles = ['.onnx', '.json'].map((extension) => fs.readFileSync(previous.base + extension));
  const oldEvaluation = fs.readFileSync(previous.evaluation);
  const rename = fs.renameSync, observed = [];
  t.mock.method(fs, 'renameSync', (source, destination) => {
    if (destination.endsWith('.current')) observed.push(trainer.readModel(name).onnx.toString());
    rename(source, destination);
    if (destination.endsWith('.current')) observed.push(trainer.readModel(name).onnx.toString());
  });
  fixture.revision = 'next'; fixture.dataset.split.test.cores = [];
  await trainer.train(fixture.options);
  assert.deepEqual(observed, ['replacement ONNX', 'next ONNX']);
  assert.equal(trainer.models()[0].test, null, 'a run without test cores cannot inherit the previous score');
  for (const [index, extension] of ['.onnx', '.json'].entries()) assert.deepEqual(fs.readFileSync(previous.base + extension), oldFiles[index]);
  assert.deepEqual(fs.readFileSync(previous.evaluation), oldEvaluation);
  assert.deepEqual(fs.readFileSync(fixture.legacy + '.onnx'), fixture.original.onnx);
  assert.equal(fs.readFileSync(fixture.legacy + '.json', 'utf8'), fixture.original.json);
});

test('failed model copies and reference writes leave the previous generation active and resumable', async (t) => {
  for (const fault of ['onnx copy', 'json copy', 'evaluation copy', 'reference write', 'reference rename']) await t.test(fault, async (t) => {
    const fixture = trainerFixture(t), { trainer, name } = fixture;
    await trainer.train(fixture.options);
    const previous = trainer.readModel(name), previousList = trainer.models();
    const reference = trainer.modelStore.referenceFile(name), referenceBytes = fs.readFileSync(reference);
    fixture.events.length = 0; fixture.revision = 'next';
    const copy = fs.copyFileSync, write = fs.writeFileSync, rename = fs.renameSync;
    t.mock.method(fs, 'copyFileSync', (source, destination, flags) => {
      const failedFile = { 'onnx copy': 'model.onnx', 'json copy': 'model.json', 'evaluation copy': 'evaluation_test.json' }[fault];
      if (path.basename(destination) === failedFile) {
        write(destination, 'INCOMPLETE COPY'); throw new Error('simulated publication failure');
      }
      return copy(source, destination, flags);
    });
    t.mock.method(fs, 'writeFileSync', (file, ...args) => {
      if (fault === 'reference write' && String(file).startsWith(reference + '.')) {
        write(file, '{'); throw new Error('simulated publication failure');
      }
      return write(file, ...args);
    });
    t.mock.method(fs, 'renameSync', (source, destination) => {
      if (fault === 'reference rename' && destination === reference) throw new Error('simulated publication failure');
      return rename(source, destination);
    });
    await assert.rejects(trainer.train(fixture.options), /simulated publication failure/);
    assert.deepEqual(trainer.readModel(name), previous);
    assert.deepEqual(trainer.models(), previousList);
    assert.deepEqual(fs.readFileSync(reference), referenceBytes);
    assert.equal(trainer.unfinished(name), true);
    assert.equal(fixture.events.some(([event]) => event === 'done'), false);
    const reopened = new Trainer({ root: fixture.root, python: 'fake-python' });
    assert.deepEqual(reopened.readModel(name), previous);
    assert.equal(reopened.unfinished(name), true);
    t.mock.restoreAll();
    fixture.calls.length = 0;
    await trainer.train({ name, resume: true });
    assert.deepEqual(fixture.calls.map((args) => args[3]), ['train', 'evaluate']);
    assert.equal(trainer.readModel(name).onnx.toString(), 'next ONNX');
    assert.equal(trainer.unfinished(name), false);
  });
});

test('cancellation during any phase preserves the previous pair and keeps available checkpoints', async (t) => {
  for (const phase of ['prepare', 'train', 'evaluate']) await t.test(phase, async (t) => {
    const fixture = trainerFixture(t); fixture.cancelAt = phase;
    await assert.rejects(fixture.trainer.train(fixture.options), /cancelled/);
    assertLegacyPreserved(fixture);
    assert.equal(fixture.trainer.unfinished(fixture.name), phase !== 'prepare');
  });
});

test('cancellation between steps prevents launching the next subprocess', async (t) => {
  const fixture = trainerFixture(t);
  fixture.onEvent = (event, message) => { if (event === 'log' && message === '▸ train') fixture.trainer.cancel(); };
  await assert.rejects(fixture.trainer.train(fixture.options), /cancelled/);
  assert.deepEqual(fixture.calls.map((args) => args[3]), ['prepare']);
  assertLegacyPreserved(fixture);
});

test('a real subprocess can be cancelled and its checkpoint resumed without touching the loaded model', async (t) => {
  const fixture = trainerFixture(t), { trainer } = fixture, simulate = trainer.run;
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  trainer.run = async (command, args) => {
    await simulate(command, args);
    if (args[3] !== 'train') return 0;
    const completion = Trainer.prototype.run.call(trainer, process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    started();
    return completion;
  };
  const training = trainer.train(fixture.options);
  await ready; trainer.cancel();
  await assert.rejects(training, /cancelled/);
  assert.equal(trainer.child, null);
  assert.equal(trainer.unfinished(fixture.name), true);
  assertLegacyPreserved(fixture);
  trainer.run = simulate;
  await trainer.train({ name: fixture.name, resume: true });
  assert.equal(trainer.unfinished(fixture.name), false);
});

test('resume reuses staged tiles and checkpoint after an evaluation failure and regenerates its pair', async (t) => {
  const fixture = trainerFixture(t), { trainer, name } = fixture;
  fixture.fail = 'evaluate';
  await assert.rejects(trainer.train(fixture.options));
  const run = trainer.pendingRun(name), tiles = fs.readFileSync(path.join(run.data, 'tiles'));
  assert.equal(trainer.unfinished(name), true, 'exported candidate files are still unpublished');
  fixture.fail = null; fixture.calls.length = 0;
  fixture.beforePhase = (phase, args) => {
    if (phase === 'train') {
      assert.ok(args.includes('--resume'));
      assert.equal(fs.readFileSync(args[5] + '.ckpt', 'utf8'), 'replacement CHECKPOINT');
      assert.equal(fs.existsSync(args[5] + '.onnx'), false);
      assert.equal(fs.existsSync(args[5] + '.json'), false);
    }
  };
  await trainer.train({ name, resume: true });
  assert.deepEqual(fixture.calls.map((args) => args[3]), ['train', 'evaluate']);
  assert.deepEqual(fs.readFileSync(path.join(run.data, 'tiles')), tiles);
  assert.equal(trainer.unfinished(name), false);
});

test('legacy resume copies weights, checkpoint and pending-best files without modifying their originals', async (t) => {
  const fixture = trainerFixture(t), { trainer, name, legacy } = fixture;
  fs.unlinkSync(legacy + '.onnx');
  const pendingBest = `.${name}.pt.1234.tmp`;
  fs.writeFileSync(path.join(path.dirname(legacy), pendingBest), 'PENDING BEST WEIGHTS');
  assert.equal(trainer.unfinished(name), true);
  fixture.beforePhase = (phase, args) => {
    assert.equal(phase === 'prepare', false);
    if (phase === 'train') {
      assert.equal(args[4], path.join(fixture.root, 'runs', name, 'data'));
      assert.equal(fs.readFileSync(args[5] + '.ckpt', 'utf8'), 'LAST CHECKPOINT');
      assert.equal(fs.readFileSync(args[5] + '.pt', 'utf8'), 'LAST BEST WEIGHTS');
      assert.equal(fs.readFileSync(path.join(path.dirname(args[5]), pendingBest), 'utf8'), 'PENDING BEST WEIGHTS');
    }
  };
  await trainer.train({ name, resume: true });
  assert.equal(fs.readFileSync(legacy + '.ckpt', 'utf8'), 'LAST CHECKPOINT');
  assert.equal(fs.readFileSync(legacy + '.pt', 'utf8'), 'LAST BEST WEIGHTS');
  assert.equal(trainer.unfinished(name), false);
  assert.equal(trainer.readModel(name).onnx.toString(), 'replacement ONNX');
});

test('missing or malformed candidate files never become published models', async (t) => {
  for (const fault of ['missing json', 'invalid json', 'null json', 'empty onnx', 'invalid evaluation']) await t.test(fault, async (t) => {
    const fixture = trainerFixture(t);
    fixture.afterPhase = (phase, args) => {
      if (phase === 'train') {
        if (fault === 'missing json') fs.unlinkSync(args[5] + '.json');
        if (fault === 'invalid json') fs.writeFileSync(args[5] + '.json', '{');
        if (fault === 'null json') fs.writeFileSync(args[5] + '.json', 'null');
        if (fault === 'empty onnx') fs.writeFileSync(args[5] + '.onnx', '');
      }
      if (phase === 'evaluate' && fault === 'invalid evaluation') fs.writeFileSync(args.at(-1), '{');
    };
    await assert.rejects(fixture.trainer.train(fixture.options));
    assertLegacyPreserved(fixture);
  });
});

test('fresh runs stay separate from legacy run names and dotted model names use a suffix-free Python output', async (t) => {
  const fixture = trainerFixture(t, 'core.v1');
  const otherRun = path.join(fixture.root, 'runs', 'core.v1.pending');
  fs.mkdirSync(otherRun); fs.writeFileSync(path.join(otherRun, 'keep'), 'OTHER RUN');
  await fixture.trainer.train(fixture.options);
  assert.equal(fs.readFileSync(path.join(otherRun, 'keep'), 'utf8'), 'OTHER RUN');
  assert.equal(path.basename(fixture.calls.find((args) => args[3] === 'train')[5]), 'model');
  assert.equal(safe('..'), 'model'); assert.equal(safe('.'), 'model');
  assert.equal(path.dirname(fixture.trainer.pendingDirectory('../outside')), path.join(fixture.root, 'staging'));
});

test('missing resume state and invalid publication references fail without falling back to fresh training', async (t) => {
  const fixture = trainerFixture(t);
  await assert.rejects(fixture.trainer.train({ name: 'absent', resume: true }), /No prepared checkpoint/);
  assert.equal(fixture.calls.length, 0);
  assertLegacyPreserved(fixture);
  fs.writeFileSync(fixture.trainer.modelStore.referenceFile(fixture.name), JSON.stringify({ version: 1, generation: '../outside', runId: '../outside' }));
  assert.throws(() => fixture.trainer.readModel(fixture.name), /Invalid published model reference/);
  assert.deepEqual(fs.readFileSync(fixture.legacy + '.onnx'), fixture.original.onnx);
});

test('workspace manifests cannot override filesystem locations or escape their model basename', async (t) => {
  const fixture = trainerFixture(t); fixture.fail = 'train';
  await assert.rejects(fixture.trainer.train(fixture.options));
  const run = fixture.trainer.pendingRun(fixture.name), info = JSON.parse(fs.readFileSync(run.manifest, 'utf8'));
  fs.writeFileSync(run.manifest, JSON.stringify({ ...info, directory: '../outside', manifest: '../outside', data: '../outside', zip: '../outside' }));
  assert.deepEqual(fixture.trainer.pendingRun(fixture.name), run);
  fs.writeFileSync(run.manifest, JSON.stringify({ ...info, model: '../outside' }));
  await assert.rejects(fixture.trainer.train({ name: fixture.name, resume: true }), /Invalid training workspace/);
  assertLegacyPreserved(fixture);
});

test('a failed first training run exposes no model until a complete resumed generation is published', async (t) => {
  const fixture = trainerFixture(t), { trainer, name, legacy } = fixture;
  for (const extension of ['.onnx', '.json', '.ckpt', '.pt']) fs.unlinkSync(legacy + extension);
  fixture.fail = 'evaluate';
  await assert.rejects(trainer.train(fixture.options));
  assert.deepEqual(trainer.models(), []);
  assert.throws(() => trainer.readModel(name), /ENOENT/);
  assert.equal(trainer.unfinished(name), true);
  fixture.fail = null;
  await trainer.train({ name, resume: true });
  assert.equal(trainer.models().length, 1);
  assert.equal(trainer.readModel(name).onnx.toString(), 'replacement ONNX');
  assert.equal(trainer.unfinished(name), false);
});

test('failed reference flushing leaves the last complete reference active', async (t) => {
  const fixture = trainerFixture(t), { trainer, name } = fixture;
  await trainer.train(fixture.options);
  const previous = trainer.readModel(name), reference = trainer.modelStore.referenceFile(name);
  const write = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', (file, ...args) => {
    const result = write(file, ...args);
    if (String(file).startsWith(reference + '.')) throw new Error('simulated flush failure');
    return result;
  });
  fixture.revision = 'next';
  await assert.rejects(trainer.train(fixture.options), /simulated flush failure/);
  assert.deepEqual(trainer.readModel(name), previous);
  assert.equal(trainer.unfinished(name), true);
});

function desktopBuildConfig(platform) {
  const desktop = fileURLToPath(new URL('../../desktop/', import.meta.url));
  let config;
  vm.runInNewContext(fs.readFileSync(path.join(desktop, 'scripts', 'build.js'), 'utf8'), {
    __dirname: path.join(desktop, 'scripts'), console: { log() {}, error() {} },
    process: { platform, execPath: process.execPath, env: {}, argv: [] },
    require: (name) => {
      if (name === 'node:child_process') return { execFileSync() {} };
      if (name === 'node:fs') return { readFileSync: () => 'V0.130' };
      if (name === 'node:path') return path;
      if (name === 'electron-builder') return { build(options) { config = options.config; return Promise.resolve([]); } };
      throw new Error('Unexpected build dependency: ' + name);
    },
  });
  return { config, desktop };
}

test('desktop packaging includes every module needed to load its entry point', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'sedcoretool-packaging-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const { config, desktop } = desktopBuildConfig('win32');
  for (const file of config.files.filter((file) => file.endsWith('.js') || file === 'package.json')) {
    fs.copyFileSync(path.join(desktop, file), path.join(directory, file));
  }
  const packaged = createRequire(import.meta.url)(path.join(directory, 'main.js'));
  assert.equal(typeof packaged.handleAppRequest, 'function');
});

test('desktop resources select one native x64 runtime or both fixed macOS architectures', () => {
  for (const [platform, targets] of [['win32', ['win32-x64']], ['linux', ['linux-x64']], ['darwin', ['darwin-x64', 'darwin-arm64']]]) {
    const { config } = desktopBuildConfig(platform);
    assert.deepEqual(Array.from(config.extraResources.filter((entry) => entry.to.startsWith('engine-runtime/')), (entry) => entry.to),
      targets.map((target) => `engine-runtime/${target}`));
  }
  // The second alternative covers the wheels' `.dylibs` folders, which `**` skips (macOS build of 14 November 2026).
  assert.equal(desktopBuildConfig('darwin').config.mac.x64ArchFiles,
    '{Contents/Resources/engine-runtime/**,Contents/Resources/engine-runtime/**/.*/**}');
});
