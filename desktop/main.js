// SedCoreTool desktop (V31; formerly CorAnTool): the web application in its own window, with more memory and its data on disk.
// - The page is served from the app:// scheme (ES modules, IndexedDB and fetch work as on a web server).
// - The renderer may use up to ~75 % of the computer's RAM for JavaScript (images live outside that limit);
//   beyond physical RAM the operating system pages memory to disk (SSD) as for any program.
// - Projects are stored in IndexedDB inside the user-data folder (on disk), not in a browser profile.
const { Trainer } = require('./trainer');
const { DiagnosticsLog, diagnosticError, safeDiagnosticEvent } = require('./diagnostics');
const { createEngineService } = require('./engine');
const { createEngineIpc } = require('./engine-ipc');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

const APP_HOST = 'corantool';
const WEB = path.join(__dirname, 'web');

function isWithinRoot(webRoot, targetPath, pathMod = path) {
  if (typeof webRoot !== 'string' || typeof targetPath !== 'string' || !webRoot || !targetPath) return false;
  if (webRoot.includes('\0') || targetPath.includes('\0')) return false;
  if (pathMod.sep === '\\' && (/^[a-zA-Z]:(?![\\/])/.test(webRoot) || /^[a-zA-Z]:(?![\\/])/.test(targetPath))) return false;
  const root = pathMod.resolve(webRoot);
  const file = pathMod.resolve(targetPath);
  const rel = pathMod.relative(root, file);
  return Boolean(rel) && rel !== '..' && !rel.startsWith(`..${pathMod.sep}`) && !pathMod.isAbsolute(rel);
}

function resolveAppPath(rawUrl, webRoot = WEB, pathMod = path) {
  if (typeof rawUrl !== 'string' || typeof webRoot !== 'string' || !webRoot) return null;
  let u;
  try { u = new URL(rawUrl); } catch { return null; }
  if (u.protocol !== 'app:' || u.host !== APP_HOST || u.username || u.password) return null;
  if (!u.pathname || !u.pathname.startsWith('/') || u.pathname.startsWith('//')) return null;
  let decoded;
  try { decoded = decodeURIComponent(u.pathname); } catch { return null; }
  if (decoded.includes('\0') || decoded.endsWith('/') || decoded.startsWith('//') || decoded.startsWith('/\\')) return null;
  const rel = decoded.slice(1);
  if (!rel || rel.includes(':')) return null;
  const root = pathMod.resolve(webRoot);
  const normalizedRel = rel.replace(/[\\/]+/g, pathMod.sep);
  const file = pathMod.resolve(root, normalizedRel);
  if (!isWithinRoot(root, file, pathMod)) return null;
  if (/%(?:2f|5c)/i.test(u.pathname) || decoded.includes('\\')) return null;
  return file;
}

function handleAppRequest(req, { webRoot = WEB, pathMod = path, fetchFile } = {}) {
  const file = resolveAppPath(req && req.url, webRoot, pathMod);
  if (!file) return new Response('forbidden', { status: 403 });
  return fetchFile ? fetchFile(file) : require('electron').net.fetch(pathToFileURL(file).toString());
}

function setupSessionPermissions(ses) {
  ses.setPermissionRequestHandler((_wc, perm, cb) => cb(['persistent-storage', 'clipboard-sanitized-write', 'fileSystem'].includes(perm)));
  // Electron leaves a restricted picker pending unless the application answers this event.
  ses.on('file-system-access-restricted', (_event, _details, callback) => callback('deny'));
}

if (process.versions.electron) {
  const { app, BrowserWindow, protocol, net, shell, session, ipcMain, dialog } = require('electron');
  const fromApp = (event) => Boolean(event?.senderFrame && resolveAppPath(event.senderFrame.url));
  const engine = createEngineService({ enabled: process.env.SEDCORETOOL_ENGINE_EXPERIMENT === '1', packaged: app.isPackaged,
    executable: process.env.SEDCORETOOL_ENGINE_PYTHON,
    sourceDirectory: app.isPackaged ? path.join(process.resourcesPath, 'python') : path.join(__dirname, 'python'),
    runtimeDirectory: app.isPackaged ? path.join(process.resourcesPath, 'engine-runtime') : path.join(__dirname, 'runtime'),
    lockPath: path.join(__dirname, 'runtime-lock.json'),
    cacheFile: () => path.join(app.getPath('userData'), 'engine-runtime-verified.json'), version: app.isPackaged ? app.getVersion() : require('./package.json').version,
    pyramidDirectory: () => path.join(app.getPath('userData'), 'pyramids') });   // the tile store's pyramid cache (contract §8.1)

  const heapMB = Math.max(2048, Math.min(32768, Math.floor((os.totalmem() / 2 ** 20) * 0.75)));
  app.commandLine.appendSwitch('js-flags', `--max-old-space-size=${heapMB}`);

  protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
  // V0.52: renamed CorAnTool → SedCoreTool. If only the old data folder exists, keep using it so saved projects stay;
  // the page origin keeps the old host (app://corantool) for the same reason (IndexedDB belongs to the origin).
  { const fs = require('node:fs'), old = path.join(app.getPath('appData'), 'CorAnTool');
    if (fs.existsSync(old) && !fs.existsSync(app.getPath('userData'))) app.setPath('userData', old); }

  function createWindow() {
    const win = new BrowserWindow({
      width: 1500, height: 950, minWidth: 900, minHeight: 600, title: 'SedCoreTool', backgroundColor: '#ecefee',
      icon: path.join(__dirname, 'build', 'icon.png'),
      webPreferences: { contextIsolation: true, sandbox: true, spellcheck: false, preload: path.join(__dirname, 'preload.js') },
    });
    win.removeMenu();
    win.loadURL('app://corantool/app/index.html');
    // external links open in the system browser; the app's own floating windows stay inside
    win.webContents.setWindowOpenHandler(({ url }) => (resolveAppPath(url) ? { action: 'allow', overrideBrowserWindowOptions: { width: 1200, height: 850, autoHideMenuBar: true } } : (String(url || '').startsWith('app:') ? { action: 'deny' } : (shell.openExternal(url), { action: 'deny' }))));
    return win;
  }

  app.whenReady().then(async () => {
    protocol.handle('app', (req) => handleAppRequest(req, { fetchFile: (file) => net.fetch(pathToFileURL(file).toString()) }));
    // keep the project library: ask Chromium to treat the storage as persistent
    setupSessionPermissions(session.defaultSession);
    setupTrainer();
    ipcMain.handle('engine:status', (event) => { if (!fromApp(event)) throw new Error('forbidden'); return engine.status(); });
    ipcMain.on('engine:enabled', (event) => { event.returnValue = fromApp(event) && engine.status().enabled === true; });
    setupEngineBridge();
    void engine.start();
    await setupDiagnostics();
    createWindow();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  let engineStopped = false;
  app.on('before-quit', (event) => {
    if (engineStopped) return;
    event.preventDefault();
    void engine.stop().finally(() => { engineStopped = true; app.quit(); });
  });

  async function setupDiagnostics() {
    const log = new DiagnosticsLog({ directory: path.join(app.getPath('userData'), 'diagnostics'), version: app.getVersion(), runtime: process.versions });
    await log.ready;
    if (log.isEnabled()) log.record({ type: 'session.start' });
    let lastEnabled = log.isEnabled();
    const heartbeats = new Map();
    const publishStatus = async () => {
      const status = await log.status(); lastEnabled = status.enabled;
      for (const win of BrowserWindow.getAllWindows()) {
        try { if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('diagnostics:statusChanged', status); }
        catch { /* A closing window no longer needs the status. */ }
      }
      return status;
    };
    const handle = (channel, work) => ipcMain.handle(channel, (event, ...args) => {
      if (!fromApp(event)) throw new Error('forbidden');
      return work(event, ...args);
    });
    handle('diagnostics:status', () => log.status());
    handle('diagnostics:setEnabled', async (_event, enabled) => { await log.setEnabled(enabled); return publishStatus(); });
    handle('diagnostics:clear', async () => { await log.clear(); return publishStatus(); });
    handle('diagnostics:export', async (event) => {
      const parent = BrowserWindow.fromWebContents(event.sender);
      const chosen = await dialog.showSaveDialog(parent, {
        defaultPath: `SedCoreTool-diagnostics-${new Date().toISOString().slice(0, 10)}.jsonl`,
        filters: [{ name: 'JSON Lines', extensions: ['jsonl'] }],
      });
      if (chosen.canceled || !chosen.filePath) return { saved: false };
      await log.exportTo(chosen.filePath);
      return { saved: true };
    });
    ipcMain.on('diagnostics:event', (event, payload) => {
      if (!fromApp(event) || !log.isEnabled()) return;
      const safe = safeDiagnosticEvent(payload); if (!safe) return;
      if (safe.type === 'renderer.heartbeat') heartbeats.set(event.sender.id, Date.now());
      log.record({ ...safe, windowId: event.sender.id });
    });
    app.on('browser-window-created', (_event, win) => {
      const windowId = win.webContents.id;
      log.record({ type: 'window.open', windowId }); heartbeats.set(windowId, Date.now());
      win.on('unresponsive', () => log.record({ type: 'renderer.unresponsive', windowId }));
      win.on('responsive', () => log.record({ type: 'renderer.responsive', windowId }));
      win.webContents.on('render-process-gone', (_event, details) => log.record({ type: 'renderer.gone', windowId, reason: details.reason, exitCode: details.exitCode }));
      win.webContents.on('did-fail-load', (_event, errorCode) => log.record({ type: 'renderer.loadFailed', windowId, exitCode: errorCode }));
      win.on('closed', () => { heartbeats.delete(windowId); log.record({ type: 'window.closed', windowId }); });
    });
    app.on('child-process-gone', (_event, details) => log.record({ type: 'process.gone', processType: details.type, reason: details.reason, exitCode: details.exitCode }));
    const sampler = setInterval(() => {
      if (lastEnabled !== log.isEnabled()) void publishStatus();
      if (!log.isEnabled()) return;
      try {
        const metrics = app.getAppMetrics();
        log.record({ type: 'process.sample', mainRssBytes: process.memoryUsage().rss,
          workingSetKb: metrics.reduce((sum, metric) => sum + metric.memory.workingSetSize, 0),
          rendererWorkingSetKb: metrics.filter((metric) => metric.type === 'Tab').reduce((sum, metric) => sum + metric.memory.workingSetSize, 0),
          cpuPercent: metrics.reduce((sum, metric) => sum + metric.cpu.percentCPUUsage, 0),
          silenceMs: Math.max(0, ...[...heartbeats.values()].map((last) => Date.now() - last)),
        });
      } catch { /* A diagnostic sample must not stop the program. */ }
    }, 5000);
    sampler.unref();
    process.on('uncaughtExceptionMonitor', (error) => {
      try { log.record({ type: 'process.error', ...diagnosticError(error) }); } catch { /* Preserve the original fatal-error behaviour. */ }
    });
  }

  /* M8.3.6: buffers, section analysis and results for the page. Only the top frame of an app:// page may call; every
     argument is validated and each page owns its tokens (engine-ipc.js). Buffers are released when the page navigates,
     reloads, crashes or closes. */
  function setupEngineBridge() {
    const bridge = createEngineIpc({ engine });
    for (const name of bridge.OPERATIONS) {
      ipcMain.handle(`engine:${name}`, (event, ...args) => {
        if (!fromApp(event) || event.senderFrame !== event.sender.mainFrame) throw new Error('forbidden');
        return bridge.call(event.sender.id, name, ...args);
      });
    }
    app.on('web-contents-created', (_event, contents) => {
      const owner = contents.id, leave = () => bridge.releasePage(owner);
      contents.on('did-start-navigation', (details) => { if (details.isMainFrame && !details.isSameDocument) leave(); });
      contents.on('render-process-gone', leave);
      contents.on('destroyed', leave);
    });
  }

  /* V0.17: U-Net training on this computer (see trainer.js). The Python source travels as an extra resource. */
  function setupTrainer() {
    const pySrc = app.isPackaged ? path.join(process.resourcesPath, 'python') : path.join(__dirname, 'python');
    const send = (type, data) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('trainer:event', type, data); };
    const tr = new Trainer({ root: path.join(app.getPath('userData'), 'trainer'), pySrc, send });
    const handle = (ch, fn) => ipcMain.handle(ch, (e, ...a) => { if (!fromApp(e)) throw new Error('forbidden'); return fn(...a); });
    handle('trainer:status', () => tr.status());
    handle('trainer:install', () => tr.install());
    handle('trainer:train', (opt) => tr.train(opt));
    handle('trainer:cancel', () => tr.cancel());
    handle('trainer:readModel', (name) => tr.readModel(name));
    handle('trainer:unfinished', (name) => tr.unfinished(name));
    handle('trainer:openFolder', () => shell.openPath(tr.root));
  }
}

module.exports = { APP_HOST, WEB, isWithinRoot, resolveAppPath, handleAppRequest, setupSessionPermissions };
