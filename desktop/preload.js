// Narrow bridges for local training and opt-in technical diagnostics; no arbitrary filesystem access.
const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('corantoolDesktop', {
  // Section analysis (M8.3.6). Arguments are validated again in the main process; the page only holds opaque tokens.
  engine: {
    // True only when the experiment is switched on for this run; read once, synchronously, so the page decides its calculation path at startup.
    enabled: ipcRenderer.sendSync('engine:enabled') === true,
    status: () => ipcRenderer.invoke('engine:status'),
    beginBuffer: (descriptor) => ipcRenderer.invoke('engine:beginBuffer', descriptor),
    deriveBuffer: (baseToken, descriptor) => ipcRenderer.invoke('engine:deriveBuffer', baseToken, descriptor),
    appendBuffer: (token, offset, bytes) => ipcRenderer.invoke('engine:appendBuffer', token, offset, bytes),
    commitBuffer: (token) => ipcRenderer.invoke('engine:commitBuffer', token),
    analyzeSection: (request) => ipcRenderer.invoke('engine:analyzeSection', request),
    cancel: (requestKey) => ipcRenderer.invoke('engine:cancel', requestKey),
    readBuffer: (token, offset, length) => ipcRenderer.invoke('engine:readBuffer', token, offset, length),
    release: (tokens) => ipcRenderer.invoke('engine:release', tokens),
    restart: (options) => ipcRenderer.invoke('engine:restart', options),
  },
  // Tiled sections (M8.4.15, contract §8). `register` takes a File the user chose and sends only its path to the main process, which
  // answers with an opaque token; the page never sees the path. A File made by code has no path and is refused.
  tiles: {
    enabled: ipcRenderer.sendSync('tiles:enabled') === true,
    register: (file) => ipcRenderer.invoke('tiles:register', webUtils.getPathForFile(file)),
    build: (token, key) => ipcRenderer.invoke('tiles:build', token, key),
    onProgress: (cb) => { const f = (_e, key, progress) => cb(key, progress); ipcRenderer.on('tiles:progress', f); return () => ipcRenderer.removeListener('tiles:progress', f); },
    cancel: (key) => ipcRenderer.invoke('tiles:cancel', key),
    info: (pyramid) => ipcRenderer.invoke('tiles:info', pyramid),
    read: (pyramid, level, positions) => ipcRenderer.invoke('tiles:read', pyramid, level, positions),
    // Masks of tiled sections (contract §8.7, card M8.4.16): identifiers and tile bytes only, never a path.
    maskBegin: (project, section, width, height, base) => ipcRenderer.invoke('tiles:maskBegin', project, section, width, height, base),
    maskPut: (staged, layer, row, col, sha256, bytes) => ipcRenderer.invoke('tiles:maskPut', staged, layer, row, col, sha256, bytes),
    maskCommit: (staged, tables) => ipcRenderer.invoke('tiles:maskCommit', staged, tables),
    maskDiscard: (staged) => ipcRenderer.invoke('tiles:maskDiscard', staged),
    maskRead: (project, manifest, layer, positions) => ipcRenderer.invoke('tiles:maskRead', project, manifest, layer, positions),
    // Saving and reopening tiled sections (card M8.4.18a): identifiers only; the main process keeps the source's path.
    maskRetain: (project, keep) => ipcRenderer.invoke('tiles:maskRetain', project, keep),
    maskInfo: (project, manifest, start) => ipcRenderer.invoke('tiles:maskInfo', project, manifest, start),
    // Card M8.4.29: a cache of what the page derived from a stored version (a file the engine keeps next to it).
    derivedPut: (project, manifest, kind, bytes) => ipcRenderer.invoke('tiles:derivedPut', project, manifest, kind, bytes),
    derivedGet: (project, manifest, kind) => ipcRenderer.invoke('tiles:derivedGet', project, manifest, kind),
    // Card M8.4.18c: the files of a stored version for a backup folder, and back into a store at a restore (verified by the engine).
    maskExport: (project, manifest, blobs) => ipcRenderer.invoke('tiles:maskExport', project, manifest, blobs),
    maskImport: (project, kind, files) => ipcRenderer.invoke('tiles:maskImport', project, kind, files),
    // Card M8.4.18c step 3: the project's copy of a source to the backup folder (read in pieces) and back (written in pieces, kept only when whole).
    sourceCopyRead: (project, pyramid, offset) => ipcRenderer.invoke('tiles:sourceCopyRead', project, pyramid, offset),
    sourceImportBegin: (project, pyramid, name, size) => ipcRenderer.invoke('tiles:sourceImportBegin', project, pyramid, name, size),
    sourceImportChunk: (token, offset, bytes) => ipcRenderer.invoke('tiles:sourceImportChunk', token, offset, bytes),
    sourceImportEnd: (token) => ipcRenderer.invoke('tiles:sourceImportEnd', token),
    sourceImportAbort: (token) => ipcRenderer.invoke('tiles:sourceImportAbort', token),
    rememberSource: (project, pyramid) => ipcRenderer.invoke('tiles:rememberSource', project, pyramid),
    reopen: (project, pyramid, key) => ipcRenderer.invoke('tiles:reopen', project, pyramid, key),
    // Card M8.4.18b: a moved source located again (a File the user chose, sent as its path), and a copy of the source into the project.
    sourceInfo: (project, pyramid) => ipcRenderer.invoke('tiles:sourceInfo', project, pyramid),
    locate: (project, pyramid, size, token, key) => ipcRenderer.invoke('tiles:locate', project, pyramid, size, token, key),
    copySource: (project, pyramid, key) => ipcRenderer.invoke('tiles:copySource', project, pyramid, key),
    // Card M8.4.27: the store folder follows its project (deleted with it; copied when the project is saved under a new identifier).
    deleteProjectStore: (project) => ipcRenderer.invoke('tiles:deleteProjectStore', project),
    announceProjects: (ids) => ipcRenderer.invoke('tiles:announceProjects', ids),   // card M8.4.34
    copyProjectStore: (from, to, manifests, sources, key) => ipcRenderer.invoke('tiles:copyProjectStore', from, to, manifests, sources, key),
  },
  diagnostics: {
    status: () => ipcRenderer.invoke('diagnostics:status'),
    setEnabled: (enabled) => ipcRenderer.invoke('diagnostics:setEnabled', enabled),
    record: (event) => ipcRenderer.send('diagnostics:event', event),
    export: () => ipcRenderer.invoke('diagnostics:export'),
    clear: () => ipcRenderer.invoke('diagnostics:clear'),
    onStatus: (callback) => { const listener = (_event, status) => callback(status); ipcRenderer.on('diagnostics:statusChanged', listener); return () => ipcRenderer.removeListener('diagnostics:statusChanged', listener); },
  },
  trainer: {
    status: () => ipcRenderer.invoke('trainer:status'),
    install: () => ipcRenderer.invoke('trainer:install'),
    train: (opt) => ipcRenderer.invoke('trainer:train', opt),
    cancel: () => ipcRenderer.invoke('trainer:cancel'),
    readModel: (name) => ipcRenderer.invoke('trainer:readModel', name),
    unfinished: (name) => ipcRenderer.invoke('trainer:unfinished', name),
    openFolder: () => ipcRenderer.invoke('trainer:openFolder'),
    onEvent: (cb) => { const f = (_e, type, data) => cb(type, data); ipcRenderer.on('trainer:event', f); return () => ipcRenderer.removeListener('trainer:event', f); },
  },
});
