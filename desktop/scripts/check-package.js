// Check the application archives produced by electron-builder before uploading installers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { listPackage, extractFile } = require('@electron/asar');
const { loadRuntime } = require('../engine-runtime');
const { EngineClient, ADVERTISED_METHODS } = require('../engine');

const dist = path.resolve(__dirname, '..', 'dist');
const files = fs.readdirSync(dist, { recursive: true });
const archives = files.filter((file) => path.basename(file) === 'app.asar');
assert.ok(archives.length, 'No packaged application archive found');

const coastline = ['web/examples', 'web/examples/data', 'web/examples/data/land-50m.json'];
function checkExamples(archive, expected) {
  const examples = listPackage(path.join(dist, archive))
    .map((file) => file.replaceAll('\\', '/').replace(/^\/+/, ''))
    .filter((file) => file === 'web/examples' || file.startsWith('web/examples/'))
    .sort();
  assert.deepEqual(examples, expected, `Only the coastline may be packaged as example data in ${archive}`);
  console.log(`Packaged data verified: ${archive}`);
}

async function checkRuntime(archive, codeArchive = archive) {
  const resources = path.dirname(path.join(dist, archive));
  const packaged = path.join(dist, codeArchive);
  const lockPath = path.resolve(__dirname, '..', 'runtime-lock.json');
  assert.deepEqual(extractFile(packaged, 'runtime-lock.json'), fs.readFileSync(lockPath), 'packaged runtime lock');
  for (const filename of ['main.js', 'preload.js', 'engine.js', 'engine-ipc.js', 'engine-runtime.js', 'engine-protocol.js']) {
    assert.deepEqual(extractFile(packaged, filename), fs.readFileSync(path.resolve(__dirname, '..', filename)), `packaged ${filename}`);
  }
  const version = JSON.parse(extractFile(packaged, 'package.json')).version;
  for (const arch of process.platform === 'darwin' ? ['x64', 'arm64'] : ['x64']) {
    const options = await loadRuntime({ runtimeDirectory: path.join(resources, 'engine-runtime'),
      sourceDirectory: path.join(resources, 'python', 'src'), lockPath, version, arch });
    if (arch !== process.arch) continue;
    const client = new EngineClient({ ...options, version });
    const previousPath = process.env.PATH;
    try {
      process.env.PATH = process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32') : '/usr/bin:/bin';
      const hello = await client.start();
      assert.equal(hello.runtime_id, options.runtimeId);
      // The packaged engine offers exactly the methods the packaged client accepts (this list was left at the digest
      // alone when section.intervals/1 was added, and only the cross-platform build noticed).
      assert.deepEqual([...hello.methods].sort(), [...ADVERTISED_METHODS].sort());
      const data = Buffer.from('public packaged-runtime fixture');
      const sha256 = createHash('sha256').update(data).digest('hex');
      const { handle } = await client.request('buffer.begin', { dtype: 'u8', shape: [data.length], byte_length: data.length, sha256 });
      await client.request('buffer.chunk', { handle, offset: 0, byte_length: data.length }, data);
      await client.request('buffer.commit', { handle });
      assert.deepEqual(await client.request('buffer.digest', { handle }), { sha256, byte_length: data.length });
      await client.request('buffer.release', { handles: [handle] });
    } finally { process.env.PATH = previousPath; await client.stop(); }
  }
  console.log(`Packaged runtime and isolated startup verified: ${archive}`);
}

async function checkPackages() {
  for (const archive of archives) {
    // A split macOS universal bundle uses app.asar as a launcher for both architecture archives.
    const split = ['x64', 'arm64'].map((arch) => path.join(path.dirname(archive), `app-${arch}.asar`))
      .filter((file) => files.includes(file));
    assert.ok(split.length === 0 || split.length === 2, `Incomplete universal application next to ${archive}`);
    checkExamples(archive, split.length ? [] : coastline);
    for (const part of split) checkExamples(part, coastline);
    await checkRuntime(archive, split[0] || archive);
  }
}
checkPackages().catch((error) => { console.error(error); process.exitCode = 1; });
