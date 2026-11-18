// Card M8.4.18b: a copy of a tiled section's source inside the project folder, made only when the user asks (decision D3 of M8.4.18).
// The bytes are hashed as they are written; the copy gets its final name only when its size and SHA-256 are the saved ones, so a failure
// (a full disk, a cancellation, another file at the remembered path) never leaves a file that could be taken for the source.
// No Electron dependency: tested with Node.
const fsp = require('node:fs/promises');
const fs = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');

const COPY_CHUNK = 4 * 2 ** 20;
const DISK_FULL = new Set(['ENOSPC', 'EDQUOT']);
const PROGRESS_EVERY_MS = 100;

class CopyFailed extends Error {
  constructor(code, field = null) { super(code); this.code = code; this.field = field; }
}

/** Bytes free for this user on the disk that holds `folder`, or null when the system does not say. */
function freeBytes(folder) {
  try { const s = fs.statfsSync(folder); return Number(s.bavail) * Number(s.bsize); } catch { return null; }
}

/**
 * Copy `from` to `to` through a temporary file in the same folder, hashing what is written; rename only when `size` and `sha256` match.
 * Returns `{copied: true}` or `{cancelled: true}`; throws `CopyFailed` (`LIMIT_EXCEEDED`/`disk`, `UNSUPPORTED_INPUT`/`source.sha256`,
 * `UNSUPPORTED_INPUT`/`source`). `open` is replaceable so that tests can simulate a full disk.
 */
async function copyVerified({ from, to, sha256, size, onProgress = () => {}, signal = null, open = fsp.open }) {
  const temporary = `${to}.${randomUUID()}.tmp`;
  let input = null, output = null;
  try {
    try { input = await fsp.open(from, 'r'); } catch { throw new CopyFailed('UNSUPPORTED_INPUT', 'source'); }
    output = await open(temporary, 'wx');
    const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(COPY_CHUNK);
    let done = 0, shown = 0;
    for (;;) {
      if (signal?.aborted) return { cancelled: true };
      const { bytesRead } = await input.read(buffer, 0, COPY_CHUNK, done);
      if (!bytesRead) break;
      const part = buffer.subarray(0, bytesRead);
      hash.update(part);
      for (let offset = 0; offset < bytesRead;) offset += (await output.write(part, offset, bytesRead - offset)).bytesWritten;
      done += bytesRead;
      if (done > size) break;                                                      // longer than the saved file: not that file
      if (Date.now() - shown >= PROGRESS_EVERY_MS) { shown = Date.now(); onProgress({ stage: 'copy', completed: done, total: size }); }
    }
    if (done !== size || hash.digest('hex') !== sha256) throw new CopyFailed('UNSUPPORTED_INPUT', 'source.sha256');
    await output.sync();
    await output.close();
    output = null;
    await fsp.rename(temporary, to);
    onProgress({ stage: 'copy', completed: size, total: size });
    return { copied: true };
  } catch (error) {
    if (error instanceof CopyFailed) throw error;
    if (DISK_FULL.has(error?.code)) throw new CopyFailed('LIMIT_EXCEEDED', 'disk');
    throw error;
  } finally {
    if (output) await output.close().catch(() => {});
    await input?.close().catch(() => {});
    await fsp.rm(temporary, { force: true }).catch(() => {});                      // after a rename there is nothing here
  }
}

module.exports = { copyVerified, freeBytes, CopyFailed, COPY_CHUNK };
