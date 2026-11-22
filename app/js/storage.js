// SedCoreTool web — project library in the browser (IndexedDB). Each project is a "folder" holding its
// images, depths, age model, labels and external records. Data stay on this computer and browser.

const DB_NAME = 'ichantool', DB_VERSION = 6;   // Add bounded image chunk storage
let dbPromise = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('data')) db.createObjectStore('data', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('prefs')) db.createObjectStore('prefs', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'key' }); // V0.1: original image files, written once
      if (!db.objectStoreNames.contains('lite')) db.createObjectStore('lite', { keyPath: 'id' }); // numeric data only, for the all-projects view
      if (!db.objectStoreNames.contains('secs')) db.createObjectStore('secs', { keyPath: 'key' }); // V0.44: sections of a project, saved one by one
      if (!db.objectStoreNames.contains('imageChunks')) db.createObjectStore('imageChunks');
    };
    req.onsuccess = () => { const d = req.result; d.onversionchange = () => { d.close(); dbPromise = null; }; resolve(d); };
    req.onblocked = () => console.warn('IndexedDB upgrade blocked by another tab');
    req.onerror = () => reject(req.error);
  });
}
const db = () => (dbPromise ||= openDB());

function run(stores, mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const tx = d.transaction(stores, mode);
    let req;
    tx.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
    try { req = fn(tx); }
    catch (error) {
      // A synchronous clone/queue error must also roll back requests already queued by fn.
      tx.abort(); reject(error);
    }
  }));
}

export async function storageAvailable() {
  try { await db(); return true; } catch { return false; }
}
export const listProjects = () => run(['meta'], 'readonly', (tx) => tx.objectStore('meta').getAll());
/*
 * V0.44: saving by sections. The project record keeps a stub per section ({$sec, id, name, file}) and each section
 * lives in 'secs' under "<project id>|<section id>". A section is written only when it changed since it was last
 * written or read in this session (same masks and same remaining fields), or when its record is missing.
 * getProject() puts the sections back, so callers always receive the complete project. Records written before
 * V0.44 (sections inside the project) are read as they are.
 */
const lastSec = new Map();
const secSig = (q) => ({ lab: q.labels, ex: q.exclude, rest: JSON.stringify({ ...q, labels: 0, exclude: 0 }) });
const arrEq = (a, b) => { if (a === b) return true; if (!a || !b || a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
const sameSec = (p, c) => p.rest === c.rest && arrEq(p.lab, c.lab) && arrEq(p.ex, c.ex);
const secLists = (d) => (d?.cores ? d.cores.map((c) => c.sections || []) : d?.sections ? [d.sections] : []);
export const getProject = (id) => run(['data', 'secs'], 'readonly', (tx) => {
  const out = { result: null }, r = tx.objectStore('data').get(id);
  r.onsuccess = () => {
    const d = r.result?.data || null; out.result = d; if (!d) return;
    const st = tx.objectStore('secs');
    for (const list of secLists(d)) list.forEach((q, i) => {
      if (!q?.$sec) return;
      const g = st.get(q.$sec);
      g.onsuccess = () => { if (g.result) { list[i] = g.result.q; lastSec.set(q.$sec, secSig(g.result.q)); } else list[i] = { ...q, $missing: true }; };
    });
  };
  return out;
});
export function putProject(meta, data) {
  const id = meta.id, writes = [], checks = [], keep = new Set(), stub = { ...data };
  const conv = (list, ci) => (list || []).map((q, i) => {
    if (!q || q.$sec) { if (q?.$sec) keep.add(q.$sec); return q; }
    const key = `${id}|${q.id ?? `${ci}:${i}`}`, sig = secSig(q), prev = lastSec.get(key); keep.add(key);
    (prev && sameSec(prev, sig) ? checks : writes).push({ key, q, sig });
    return { $sec: key, id: q.id, name: q.name, file: q.file };
  });
  if (data.cores) stub.cores = data.cores.map((c, ci) => ({ ...c, sections: conv(c.sections, ci) }));
  else if (data.sections) stub.sections = conv(data.sections, 0);
  return run(['meta', 'data', 'secs'], 'readwrite', (tx) => {
    const st = tx.objectStore('secs');
    tx.objectStore('meta').put(meta);
    tx.objectStore('data').put({ id, data: stub });
    for (const w of writes) st.put({ key: w.key, q: w.q });
    for (const c of checks) { const k = st.getKey(c.key); k.onsuccess = () => { if (k.result === undefined) st.put({ key: c.key, q: c.q }); }; }   // never trust the cache alone
    const old = st.getAllKeys(IDBKeyRange.bound(id + '|', id + '|\uffff'));
    old.onsuccess = () => { for (const k of old.result) if (!keep.has(k)) st.delete(k); };
  }).then(() => { for (const w of [...writes, ...checks]) lastSec.set(w.key, w.sig); return { written: writes.length, kept: checks.length }; });
}
/** Card M8.4.39: what this session remembers of the sections of project `id` (to skip writing unchanged ones) is dropped: the project was closed or
 *  deleted. Its next save writes every section again. @param {string} id */
export function forgetSections(id) { for (const k of [...lastSec.keys()]) if (k.startsWith(id + '|')) lastSec.delete(k); }
export const putMeta = (meta) => run(['meta'], 'readwrite', (tx) => tx.objectStore('meta').put(meta));
/** Image keys referenced by a stored project (format v4: file.key). */
export function imageKeys(data) {
  const out = [];
  for (const c of data?.cores || [{ sections: data?.sections }]) for (const q of c.sections || []) if (q.file?.key) out.push(q.file.key);
  return out;
}
const IMAGE_CHUNK_BYTES = 4 * 1024 * 1024;
const imageWrites = new Set();

async function imageDirectory() {
  try {
    const root = await globalThis.navigator?.storage?.getDirectory?.();
    const dir = await root?.getDirectoryHandle('sedcoretool-images', { create: true });
    return typeof globalThis.FileSystemFileHandle?.prototype.createWritable === 'function' ? dir : null;
  } catch { return null; }
}

const imageChunkRange = (generation) => IDBKeyRange.bound([generation, 0], [generation, Infinity]);

function removeImageRecord(tx, record, files) {
  if (record.chunks) tx.objectStore('imageChunks').delete(imageChunkRange(record.generation));
  if (record.disk) files.push(record.generation);
  tx.objectStore('images').delete(record.key);
}

async function removeImageFiles(files) {
  if (!files.length) return;
  const dir = await imageDirectory();
  if (dir) for (const file of files) await dir.removeEntry(file).catch(() => {});
}

export async function deleteProject(id) {
  const files = [];
  await run(['meta', 'data', 'lite', 'images', 'secs', 'imageChunks'], 'readwrite', (tx) => {
    const projects = tx.objectStore('data'), r = projects.getAll();
    r.onsuccess = () => {
      const owned = imageKeys(r.result.find((p) => p.id === id)?.data);
      const used = new Set(r.result.filter((p) => p.id !== id).flatMap((p) => imageKeys(p.data)));
      const store = tx.objectStore('images');
      for (const key of owned) {
        if (used.has(key)) continue;
        const req = store.get(key);
        req.onsuccess = () => { if (req.result) removeImageRecord(tx, req.result, files); };
      }
      projects.delete(id);
    };
    tx.objectStore('meta').delete(id);
    tx.objectStore('lite').delete(id);
    tx.objectStore('secs').delete(IDBKeyRange.bound(id + '|', id + '|\uffff'));
  });
  forgetSections(id);
  await removeImageFiles(files);
}

/** Publish the image reference only after its disk file or IndexedDB chunks are complete. */
export async function putImage(key, blob) {
  const generation = 'image-' + Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) => n.toString(16).padStart(8, '0')).join('');
  const dir = await imageDirectory(), type = blob.type, size = blob.size;
  const chunks = Math.ceil(size / IMAGE_CHUNK_BYTES);
  const staged = { key: generation, generation, size, type, t: Date.now(), disk: Boolean(dir), chunks: dir ? 0 : chunks, pending: true };
  const files = [];
  imageWrites.add(generation);
  try {
    await run(['images'], 'readwrite', (tx) => tx.objectStore('images').put(staged));
    if (dir) {
      const handle = await dir.getFileHandle(generation, { create: true });
      await blob.stream().pipeTo(await handle.createWritable());
    } else {
      for (let i = 0; i < chunks; i++) {
        const offset = i * IMAGE_CHUNK_BYTES;
        const bytes = await blob.slice(offset, offset + IMAGE_CHUNK_BYTES).arrayBuffer();
        await run(['imageChunks'], 'readwrite', (tx) => tx.objectStore('imageChunks').put(bytes, [generation, i]));
      }
    }
    await run(['images', 'imageChunks'], 'readwrite', (tx) => {
      const store = tx.objectStore('images'), previous = store.get(key);
      previous.onsuccess = () => {
        if (previous.result) removeImageRecord(tx, previous.result, files);
        store.put({ ...staged, key, pending: false });
        store.delete(generation);
      };
    });
  } catch (err) {
    const abandoned = [];
    await run(['images', 'imageChunks'], 'readwrite', (tx) => removeImageRecord(tx, staged, abandoned)).catch(() => {});
    await removeImageFiles(abandoned);
    throw err;
  } finally {
    imageWrites.delete(generation);
  }
  await removeImageFiles(files);
}

function chunkedImage(record) {
  async function readPart(index) {
    const bytes = await run(['imageChunks'], 'readonly', (tx) => tx.objectStore('imageChunks').get([record.generation, index]));
    const length = Math.min(IMAGE_CHUNK_BYTES, record.size - index * IMAGE_CHUNK_BYTES);
    if (!bytes || bytes.byteLength !== length) throw new Error('Missing stored image chunk');
    return bytes;
  }
  return {
    size: record.size,
    type: record.type,
    slice(start, end) {
      return {
        async arrayBuffer() {
          const out = new Uint8Array(end - start);
          for (let offset = start; offset < end;) {
            const part = await readPart(Math.floor(offset / IMAGE_CHUNK_BYTES)), from = offset % IMAGE_CHUNK_BYTES;
            const count = Math.min(part.byteLength - from, end - offset);
            out.set(new Uint8Array(part, from, count), offset - start);
            offset += count;
          }
          return out.buffer;
        },
      };
    },
    stream() {
      let index = 0;
      return new ReadableStream({
        async pull(controller) {
          if (index === record.chunks) { controller.close(); return; }
          controller.enqueue(new Uint8Array(await readPart(index++)));
        },
      });
    },
  };
}

/** Read legacy records as before. A ranged caller can consume the fallback chunks lazily. */
export async function getImage(key, ranged = false) {
  const record = await run(['images'], 'readonly', (tx) => tx.objectStore('images').get(key));
  if (!record || record.pending) return null;
  if (record.disk) {
    const dir = await imageDirectory();
    if (!dir) throw new Error('Stored image directory unavailable');
    const file = await (await dir.getFileHandle(record.generation)).getFile();
    if (file.size !== record.size) throw new Error('Incomplete stored image');
    return file.slice(0, file.size, record.type);
  }
  if (!record.generation) return record.blob || new Blob([record.bytes], { type: record.type || 'image/jpeg' });
  const source = chunkedImage(record);
  return ranged ? source : new Response(source.stream(), { headers: { 'Content-Type': record.type } }).blob();
}

/** Reclaim unreferenced images and abandoned staged writes after a grace period. */
export async function gcImages() {
  const files = [], now = Date.now(), hour = 3600e3;
  await run(['images', 'imageChunks', 'data'], 'readwrite', (tx) => {
    const projects = tx.objectStore('data').getAll(), store = tx.objectStore('images');
    projects.onsuccess = () => {
      const used = new Set(projects.result.flatMap((p) => imageKeys(p.data)));
      const keys = store.getAllKeys();
      keys.onsuccess = () => {
        for (const key of keys.result) {
          if (used.has(key) || imageWrites.has(key)) continue;
          const req = store.get(key);
          req.onsuccess = () => {
            const record = req.result;
            if (record && record.t < now - (record.pending ? 24 : 1) * hour) removeImageRecord(tx, record, files);
          };
        }
      };
    };
  });
  await removeImageFiles(files);
}
export const putLite = (id, lite) => run(['lite'], 'readwrite', (tx) => tx.objectStore('lite').put({ ...lite, id }));
export const listLite = () => run(['lite'], 'readonly', (tx) => tx.objectStore('lite').getAll());
export const getMeta = (id) => run(['meta'], 'readonly', (tx) => tx.objectStore('meta').get(id));

/** Preferences shared by all projects (user presets, backup folder handle, last backup time). */
export const getPref = (key) => run(['prefs'], 'readonly', (tx) => tx.objectStore('prefs').get(key)).then((r) => r?.value);
export const setPref = (key, value) => run(['prefs'], 'readwrite', (tx) => tx.objectStore('prefs').put({ key, value }));
