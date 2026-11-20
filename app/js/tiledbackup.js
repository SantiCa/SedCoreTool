// @ts-check
// Card M8.4.18c: the masks of tiled sections in the folder backup, and back into the store when that folder is restored. The backup folder of a
// project gets `tiles/<sha256>` (a stored blob exactly as the engine keeps it: the zlib stream of the bytes whose SHA-256 is its name) and
// `manifests/<sha256>.json` (a stored version, named by its own SHA-256); contract §8.7, "Backup folder". Files are written only when missing, by
// name, each read back and checked after writing; a version's manifest is written after every blob it names, so a manifest in the folder means
// the whole version is there and a backup stopped half-way leaves the previous one openable. Nothing here deletes from the folder.
// The engine verifies every file it sends and every file it receives; this module only moves them. No DOM: the folder is a File System Access
// directory handle (or, at a restore, a function that reads a file of the folder by its relative path), so Node can test it with fakes.

export const BACKUP_TILES_DIR = 'tiles', BACKUP_MANIFESTS_DIR = 'manifests';
export const EXPORT_PAGE = 32;                                  // files per export or import request (the engine's limit)
export const IMPORT_BATCH_BYTES = 64 * 2 ** 20;                 // bytes per import request (the main process accepts 128 MiB)
const BLOB_NAME = /^[0-9a-f]{64}$/;
const PERMANENT = new Set(['INVALID_REQUEST', 'INVALID_BUFFER', 'UNSUPPORTED_INPUT']);   // the store lacks the version or it is damaged

/** The error of a failed bridge call, with its code and field. */
export class TiledBackupError extends Error {
  /** @param {string} code @param {string} [field] */
  constructor(code, field = '') { super(`${code}${field ? ' ' + field : ''}`); this.name = 'TiledBackupError'; this.code = code; this.field = field; }
}

const answerOf = (result) => {
  if (result?.error) throw new TiledBackupError(String(result.error.code || 'INTERNAL'), String(result.error.field || ''));
  return result.ok;
};

/**
 * Every blob a manifest file names, with where it is used: `"<row>.<col>"` for a mask tile, `"tables.<name>"` for a table. Only what this module
 * needs is checked (the engine checks everything else at the import); a file that is not a manifest's JSON throws.
 * @param {Uint8Array} bytes
 * @returns {Map<string, string>}
 */
export function manifestBlobs(bytes) {
  const value = JSON.parse(new TextDecoder('ascii', { fatal: true }).decode(bytes));
  if (!value || value.format !== 'sedcoretool.masks' || typeof value.tiles !== 'object' || !value.tiles || typeof value.tables !== 'object' || !value.tables) throw new TypeError('not a manifest');
  const named = new Map();
  for (const [where, entry] of Object.entries(value.tiles)) for (const layer of ['labels', 'exclude']) {
    const name = entry?.[layer];
    if (name == null) continue;
    if (typeof name !== 'string' || !BLOB_NAME.test(name)) throw new TypeError('not a manifest');
    if (!named.has(name)) named.set(name, where);
  }
  for (const [table, entry] of Object.entries(value.tables)) {
    if (entry == null) continue;
    if (typeof entry.sha256 !== 'string' || !BLOB_NAME.test(entry.sha256)) throw new TypeError('not a manifest');
    if (!named.has(entry.sha256)) named.set(entry.sha256, `tables.${table}`);
  }
  return named;
}

/** The names of the files in a directory handle. @param {any} dir */
async function fileNames(dir) {
  const names = new Set();
  for await (const [name, handle] of dir.entries()) if (handle.kind === 'file') names.add(name);
  return names;
}

/** Write `bytes` as `name` in `dir`, read the file back and check its SHA-256 against `expected` (a write the disk or the sync tool changed throws). */
async function writeChecked(dir, name, bytes, expected, hexDigest) {
  const handle = await dir.getFileHandle(name, { create: true }), writable = await handle.createWritable();
  try { await writable.write(bytes); await writable.close(); } catch (error) { await writable.abort?.().catch(() => {}); throw error; }
  const back = new Uint8Array(await (await handle.getFile()).arrayBuffer());
  if (back.length !== bytes.length || (await hexDigest(back)) !== expected) throw new TiledBackupError('BACKUP_MISMATCH', name);
}

/**
 * Copy one stored version into a project's backup folder (`folders` = its `tiles` and `manifests` handles with the names they hold), unless its
 * manifest is already there. Returns 'present' or 'copied'; a failed bridge call throws `TiledBackupError`.
 */
async function backupVersion(TILES, project, manifest, folders, hexDigest) {
  const manifestName = `${manifest}.json`;
  if (folders.manifestNames.has(manifestName)) return 'present';
  const [text] = answerOf(await TILES.maskExport(project, manifest, null)).files;
  const missing = [...manifestBlobs(text.bytes).keys()].filter((name) => !folders.tileNames.has(name));
  for (let start = 0; start < missing.length; start += EXPORT_PAGE) {
    const { files } = answerOf(await TILES.maskExport(project, manifest, missing.slice(start, start + EXPORT_PAGE)));
    for (const file of files) { await writeChecked(folders.tiles, file.name, file.bytes, file.sha256, hexDigest); folders.tileNames.add(file.name); }
  }
  await writeChecked(folders.manifests, manifestName, text.bytes, manifest, hexDigest);   // last: the version is whole in the folder
  folders.manifestNames.add(manifestName);
  return 'copied';
}

/**
 * The masks of the tiled sections of `json` (a project as `projectForExport` writes it, tiled sections kept) into the project's backup folder
 * `dir`, before its `project.json` is written. A section whose stored version is missing or damaged in the store is taken out of `json`, named in
 * its `left_out` and returned (the user is told); any other failure (engine stopped or busy, disk, folder) throws, so that the backup is retried and
 * the previous `project.json` stays as it was.
 * @param {any} TILES the page bridge (`maskExport`)
 * @param {any} dir the project's backup folder (a directory handle)
 * @param {string} project the store identifier of the project
 * @param {any} json
 * @param {(bytes: Uint8Array) => Promise<string>} hexDigest
 * @returns {Promise<{core: string|null, section: string}[]>}
 */
export async function backupTiledSections(TILES, dir, project, json, hexDigest) {
  const holders = (json.cores || [json]).filter((c) => Array.isArray(c.sections) && c.sections.some((q) => q.tiled?.manifest));
  if (!holders.length) return [];
  const tiles = await dir.getDirectoryHandle(BACKUP_TILES_DIR, { create: true }), manifests = await dir.getDirectoryHandle(BACKUP_MANIFESTS_DIR, { create: true });
  const folders = { tiles, manifests, tileNames: await fileNames(tiles), manifestNames: await fileNames(manifests) };
  const leftOut = [];
  for (const c of holders) {
    const kept = [];
    for (const q of c.sections) {
      if (!q.tiled?.manifest) { kept.push(q); continue; }
      try { await backupVersion(TILES, project, q.tiled.manifest, folders, hexDigest); kept.push(q); }
      catch (error) {
        if (!(error instanceof TiledBackupError) || !PERMANENT.has(error.code)) throw error;
        leftOut.push({ core: c.name ?? null, section: q.name ?? q.id });
      }
    }
    c.sections = kept;
  }
  if (leftOut.length) json.left_out = [...(json.left_out || []), ...leftOut];
  return leftOut;
}

/**
 * Read the files of one version from a backup folder into the store of `project`, the blobs first and the manifest last, each verified by the
 * engine. `readFile(path)` reads a file of the project's backup folder by its relative path (null, or a throw, when it is not there).
 * Returns null when the version is in the store now, or where it failed (`"manifest"`, `"<row>.<col>"` or `"tables.<name>"`): a missing or
 * damaged file refuses the whole version and its manifest is not written. A failed bridge call other than a refusal throws.
 * @param {any} TILES the page bridge (`maskImport`)
 * @param {string} project
 * @param {string} manifest
 * @param {(path: string) => Promise<Blob|null>} readFile
 * @returns {Promise<string|null>}
 */
export async function restoreVersion(TILES, project, manifest, readFile) {
  const read = async (path) => { try { const blob = await readFile(path); return blob ? new Uint8Array(await blob.arrayBuffer()) : null; } catch { return null; } };
  const text = BLOB_NAME.test(manifest) ? await read(`${BACKUP_MANIFESTS_DIR}/${manifest}.json`) : null;
  if (!text) return 'manifest';
  let named;
  try { named = manifestBlobs(text); } catch { return 'manifest'; }
  const pending = [...named.keys()];
  for (let start = 0; start < pending.length;) {
    const batch = [];
    let bytes = 0;
    while (start < pending.length && batch.length < EXPORT_PAGE && (!batch.length || bytes < IMPORT_BATCH_BYTES)) {
      const name = pending[start++], data = await read(`${BACKUP_TILES_DIR}/${name}`);
      if (!data || !data.length) return named.get(name) || 'manifest';
      batch.push({ name, bytes: data }); bytes += data.length;
    }
    const { accepted } = answerOf(await TILES.maskImport(project, 'blobs', batch));
    const refused = batch.findIndex((_, k) => !accepted[k]);
    if (refused >= 0) return named.get(batch[refused].name) || 'manifest';
  }
  try { answerOf(await TILES.maskImport(project, 'manifest', [{ name: manifest, bytes: text }])); }
  catch (error) { if (error instanceof TiledBackupError && PERMANENT.has(error.code)) return 'manifest'; throw error; }
  return null;
}
