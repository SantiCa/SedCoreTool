// Narrow bridges for local training and opt-in technical diagnostics; no arbitrary filesystem access.
const { contextBridge, ipcRenderer } = require('electron');
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
