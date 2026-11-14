import assert from 'node:assert/strict';

/** Exercise real IndexedDB transactions and staged filesystem writes with deterministic failures. */
export async function verifyInterruptedSaves(browser, url, { navigate = true } = {}) {
  const page = await browser.newPage(), errors = [];
  // The checks below read Spanish messages; the browser language is whatever the host has (English on the GitHub runners).
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('ichantool.lang', 'es'); } catch { /* storage blocked */ } });
  let storedLanguage;   // set only for a desktop window, whose stored choice is put back at the end
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.exposeFunction('reopenInterruptedSave', async (source, expected) => {
      const reader = await browser.newPage();
      reader.on('pageerror', (error) => errors.push(error.message));
      try {
        if (navigate) await reader.goto(url, { waitUntil: 'networkidle0' });
        return await reader.evaluate(async (source, expected) => {
          const I = window.ichantool, storage = await import('./js/storage.js');
          let saved, image;
          if (source === 'database') {
            saved = await storage.getProject(expected.id);
            image = await storage.getImage(saved.cores[0].sections[0].file.key);
          } else {
            const root = await navigator.storage.getDirectory();
            const folder = await (await root.getDirectoryHandle('interrupted-saves-test')).getDirectoryHandle(source);
            saved = JSON.parse(await (await (await folder.getFileHandle('project.json')).getFile()).text());
            const section = saved.cores[0].sections[0], images = await folder.getDirectoryHandle('images');
            image = await (await images.getFileHandle(section.file.path.split('/')[1])).getFile();
            section.file = { name: section.file.name, type: section.file.type, blob: image };
          }
          await I.loadProject(saved);
          const reopened = I.serialize(), section = reopened.cores[0].sections[0], previous = expected.cores[0].sections[0];
          return I.S.id === expected.id && I.S.notes === (expected.notes || '') && section.name === previous.name
            && JSON.stringify(section.labels) === JSON.stringify(previous.labels)
            && JSON.stringify(section.exclude) === JSON.stringify(previous.exclude)
            && image.size === previous.file.size;
        }, source, expected);
      } finally { await reader.close(); }
    });
    if (navigate) await page.goto(url, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.ichantool);
    // A desktop window is already loaded when it is handed over (navigating it again would close it), so the line above
    // came too late for it: switch its language now and restore the stored choice afterwards for the later checks.
    if (!navigate) storedLanguage = await page.evaluate(async () => {
      const before = localStorage.getItem('ichantool.lang');
      (await import('./js/i18n.js')).setLang('es');
      return before;
    });
    const results = await page.evaluate(async () => {
      const I = window.ichantool, storage = await import('./js/storage.js');
      const { markDirty } = await import('./js/app.js');
      const { DEFAULT_FILTERS, DEFAULT_DETECT } = await import('./js/imageproc.js');
      const checks = {}, originalPut = IDBObjectStore.prototype.put, logError = console.error;
      let checkpoint = 'initial image and local-save checks';
      console.error = () => {};
      const pause = () => new Promise((resolve) => setTimeout(resolve, 100));
      const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 8;
      const image = await new Promise((resolve) => canvas.toBlob(resolve));
      const imageKey = 'interrupted-save-image';
      await storage.putImage(imageKey, image);
      // A stream failure before publishing a new OPFS image must preserve the old reference and bytes.
      let imageRejected = false;
      await storage.putImage(imageKey, {
        size: image.size, type: image.type,
        stream: () => new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2])); controller.error(new Error('simulated image interruption')); } }),
      }).catch(() => { imageRejected = true; });
      const originalBytes = Array.from(new Uint8Array(await image.arrayBuffer()));
      checks.interruptedImagePreserved = imageRejected
        && JSON.stringify(Array.from(new Uint8Array(await (await storage.getImage(imageKey)).arrayBuffer()))) === JSON.stringify(originalBytes);
      const fixture = {
        app: 'SedCoreTool', kind: 'project', version: 5, id: 'interrupted-save', name: 'Interrupted save',
        cores: [{ id: 'core', name: 'Synthetic core', sections: [{
          id: 'section', name: 'Last good section', w: 8, h: 8, ds: 1,
          file: { name: 'synthetic.png', type: 'image/png', key: imageKey, size: image.size },
          top: 0, bottom: 8, units: 'cm', roi: { x0: 0, y0: 0, x1: 8, y1: 8 },
          filters: DEFAULT_FILTERS, detect: DEFAULT_DETECT, nextId: 1, objects: [], labels: [0, 64], exclude: [0, 64],
        }] }],
      };
      await I.loadProject(fixture); markDirty(); await I.saveToDB();
      const good = await storage.getProject(fixture.id), meta = await storage.getMeta(fixture.id);
      const sameGood = async () => JSON.stringify(await storage.getProject(fixture.id)) === JSON.stringify(good)
        && JSON.stringify(await storage.getMeta(fixture.id)) === JSON.stringify(meta);
      const editPendingInterpretation = () => {
        const section = I.S.sections[0], exclude = section.exclude.slice();
        exclude[7] = 1; section.exclude = exclude;
        section.name = 'Pending section'; I.S.notes = 'Pending interpretation'; markDirty();
      };
      try {
        // A synchronous clone failure occurs after meta and data have already been queued.
        const invalid = structuredClone(good);
        invalid.cores[0].sections[0].name = 'Must not commit';
        invalid.cores[0].sections[0].uncloneable = () => {};
        let rejected = false;
        await storage.putProject({ ...meta, name: 'Must not commit' }, invalid).catch(() => { rejected = true; });
        checks.cloneFailureRollsBack = rejected && await sameGood();
        // Restore the baseline so the remaining cases are independent of this result.
        await storage.putProject(meta, good);

        editPendingInterpretation();
        let aborts = 0;
        IDBObjectStore.prototype.put = function (...args) {
          const request = originalPut.apply(this, args);
          if (this.name === 'secs') request.addEventListener('success', () => { aborts++; this.transaction.abort(); });
          return request;
        };
        await I.saveToDB();
        checks.lateAbortRollsBack = aborts === 1 && await sameGood();
        checks.databaseFailureVisible = document.getElementById('saveState').dataset.state === 'error';
        checks.databaseEditsPending = I.S.notes === 'Pending interpretation' && I.S.sections[0].name === 'Pending section' && I.S.sections[0].exclude[7] === 1;
        checks.lastDatabaseSaveReopens = await window.reopenInterruptedSave('database', good);

        // Creating another project must not discard the failed project's live edits.
        await I.showHome();
        document.getElementById('newProjOpen').click();
        document.getElementById('newProjName').value = 'Must wait for save';
        document.getElementById('newProjBtn').click(); await pause();
        checks.failedSaveBlocksSwitch = I.S.id === fixture.id && I.S.notes === 'Pending interpretation';
        // A failed replacement import must not mark the still-open interpretation as saved.
        const confirm = window.confirm; window.confirm = () => true;
        const input = document.getElementById('impProj'), transfer = new DataTransfer();
        transfer.items.add(new File([JSON.stringify(good)], 'replacement.json', { type: 'application/json' }));
        const oldToast = document.getElementById('toast').textContent;
        input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
        for (let i = 0; i < 200 && document.getElementById('toast').textContent === oldToast; i++) await new Promise((resolve) => setTimeout(resolve, 20));
        const leaving = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(leaving);
        checks.failedImportKeepsPending = leaving.defaultPrevented && I.S.notes === 'Pending interpretation' && I.S.sections[0].exclude[7] === 1;
        window.confirm = confirm;
        IDBObjectStore.prototype.put = originalPut;
        // Keep the other cases runnable on the broken implementation too.
        if (I.S.id !== fixture.id) { await I.loadProject(good); editPendingInterpretation(); }
        document.getElementById('saveRetry').click();
        for (let i = 0; i < 200 && document.getElementById('saveState').dataset.state !== 'saved'; i++) await new Promise((resolve) => setTimeout(resolve, 20));
        const retried = await storage.getProject(fixture.id);
        checks.databaseRetry = retried.notes === 'Pending interpretation' && retried.cores[0].sections[0].name === 'Pending section';
        await I.loadProject(retried);
        checks.databaseReopens = I.S.notes === retried.notes && I.S.sections[0].name === 'Pending section' && I.S.sections[0].exclude[7] === 1;

        checkpoint = 'folder preservation and retry';
        // Real OPFS writes use the same File System Access writable/commit contract as a picked folder.
        const root = await navigator.storage.getDirectory();
        const folderName = 'interrupted-saves-test';
        await root.removeEntry(folderName, { recursive: true }).catch(() => {});
        const folder = await root.getDirectoryHandle(folderName, { create: true });
        let failure = null, aborted = 0, heldWrite = null, heldEntries = 0;
        const streams = [];
        const wrapDirectory = (dir) => ({
          name: dir.name, kind: dir.kind, queryPermission: async () => 'granted', requestPermission: async () => 'granted',
          getDirectoryHandle: async (...args) => wrapDirectory(await dir.getDirectoryHandle(...args)),
          removeEntry: (...args) => dir.removeEntry(...args), entries: () => dir.entries(),
          async getFileHandle(name, options) {
            const handle = await dir.getFileHandle(name, options);
            return {
              getFile: () => handle.getFile(),
              async createWritable() {
                if (name === failure?.name && failure.stage === 'open') throw new Error('simulated open failure');
                const stream = await handle.createWritable(); streams.push(stream);
                const write = stream.write.bind(stream), close = stream.close.bind(stream), abort = stream.abort.bind(stream);
                stream.write = async (chunk) => {
                  if (name === 'project.json' && heldWrite) { heldEntries++; await heldWrite; }
                  await write(chunk);
                  if (name === failure?.name && failure.stage === 'write') throw new Error('simulated write failure');
                };
                stream.close = async () => {
                  if (name === failure?.name && failure.stage === 'close') throw new Error('simulated close failure');
                  await close();
                };
                stream.abort = async (reason) => { aborted++; await abort(reason); };
                return stream;
              },
            };
          },
        });
        const picker = window.showDirectoryPicker;
        window.showDirectoryPicker = async () => wrapDirectory(folder);
        const chooseBackup = async () => {
          document.getElementById('bkStatus').dataset.state = 'running';
          document.getElementById('bkChoose').click();
          for (let i = 0; i < 200; i++) {
            await new Promise((resolve) => setTimeout(resolve, 20));
            if (!document.getElementById('bkChoose').disabled
              && document.getElementById('bkStatus').dataset.state === (failure ? 'error' : 'ok')) return;
          }
          throw new Error('backup status timeout');
        };
        try {
          await chooseBackup();
          const projectDir = (await Array.fromAsync(folder.values())).find((entry) => entry.kind === 'directory' && entry.name.endsWith('__' + fixture.id));
          const readManifest = async () => (await (await projectDir.getFileHandle('project.json')).getFile()).text();
          const manifest = await readManifest();
          const saved = JSON.parse(manifest), path = saved.cores[0].sections[0].file.path;
          const imageDir = await projectDir.getDirectoryHandle('images');
          checks.folderImageReadable = (await (await imageDir.getFileHandle(path.split('/')[1])).getFile()).size === image.size;
          for (const stage of ['open', 'write', 'close']) {
            const previousAborts = aborted;
            I.S.notes = 'Folder pending ' + stage; markDirty(); await I.saveToDB();
            failure = { name: 'project.json', stage };
            await chooseBackup();
            checks['folderPreserved_' + stage] = await readManifest() === manifest;
            checks['folderVisible_' + stage] = document.getElementById('bkStatus').dataset.state === 'error';
            checks['folderPending_' + stage] = I.S.notes === 'Folder pending ' + stage;
            checks['folderRetryOffered_' + stage] = !document.getElementById('bkReactivate').hidden;
            checks['lastFolderSaveReopens_' + stage] = await window.reopenInterruptedSave(projectDir.name, retried);
            if (stage !== 'open') checks['folderWriterAborted_' + stage] = aborted > previousAborts;
          }
          // Replacing an image must not change the image referenced by the last good manifest.
          canvas.getContext('2d').fillRect(0, 0, 4, 4);
          const replacement = await new Promise((resolve) => canvas.toBlob(resolve));
          await storage.putImage('replacement-image', replacement);
          I.S.sections[0].file = { name: 'synthetic.png', type: 'image/png', key: 'replacement-image', size: replacement.size };
          markDirty(); await I.saveToDB();
          await chooseBackup();
          checks.folderPreviousImagePreserved = JSON.stringify(Array.from(new Uint8Array(await (await (await imageDir.getFileHandle(path.split('/')[1])).getFile()).arrayBuffer()))) === JSON.stringify(originalBytes);
          checks.folderPreviousManifestPreserved = await readManifest() === manifest;
          checks.folderReopensAfterImageFailure = await window.reopenInterruptedSave(projectDir.name, retried);
          const latest = await storage.getProject(fixture.id);
          failure = null;
          // Retry through the user-facing control, without another edit or folder selection.
          document.getElementById('bkReactivate').click();
          for (let i = 0; i < 200 && document.getElementById('bkStatus').dataset.state !== 'ok'; i++) await new Promise((resolve) => setTimeout(resolve, 20));
          const recovered = JSON.parse(await readManifest());
          checks.folderRetry = recovered.notes === 'Folder pending close' && document.getElementById('bkStatus').dataset.state === 'ok';
          checks.folderReopens = await window.reopenInterruptedSave(projectDir.name, latest);

          // Missing storage must never be published as an empty original image.
          checkpoint = 'missing original image';
          const goodManifest = await readManifest(), savedFile = I.S.sections[0].file;
          I.S.sections[0].file = { ...savedFile, key: 'missing-backup-image' };
          failure = { name: 'unused', stage: 'missing-image' };
          try {
            await chooseBackup();
            checks.missingImagePreservesManifest = await readManifest() === goodManifest;
            checks.missingImageReported = document.getElementById('bkStatus').textContent.includes(savedFile.name);
          } finally { I.S.sections[0].file = savedFile; failure = null; }
          await chooseBackup();

          // Saving while a copy is in flight must schedule a later snapshot, not mark the edits backed up.
          checkpoint = 'edits during folder I/O';
          const nativeTimeout = window.setTimeout;
          window.setTimeout = (fn, delay, ...args) => nativeTimeout(fn, delay === 20000 ? 25 : delay, ...args);
          let releasePendingCopy;
          heldWrite = new Promise((resolve) => { releasePendingCopy = resolve; });
          try {
            document.getElementById('bkChoose').click();
            for (let i = 0; i < 100 && !heldEntries; i++) await new Promise((resolve) => setTimeout(resolve, 10));
            I.S.notes = 'Saved during folder I/O'; markDirty(); await I.saveToDB();
            checks.inFlightEditShownPending = document.getElementById('saveState').dataset.backup === 'ok';
            heldWrite = null; releasePendingCopy();
            checks.inFlightEditsCopiedAutomatically = false;
            for (let i = 0; i < 200; i++) {
              await new Promise((resolve) => setTimeout(resolve, 10));
              if (document.getElementById('bkStatus').getAttribute('aria-busy') === 'true') continue;
              if (JSON.parse(await readManifest()).notes === 'Saved during folder I/O') {
                checks.inFlightEditsCopiedAutomatically = true; break;
              }
            }
          } finally { heldWrite = null; releasePendingCopy(); window.setTimeout = nativeTimeout; }
          for (let i = 0; i < 200 && document.getElementById('bkChoose').disabled; i++) await new Promise((resolve) => setTimeout(resolve, 10));
          heldEntries = 0;

          // A slow folder must not spawn competing writers or block a locally saved project switch.
          checkpoint = 'slow folder navigation';
          failure = { name: 'project.json', stage: 'write' };
          await chooseBackup(); failure = null;
          let releaseWrite, showHomePromise;
          heldWrite = new Promise((resolve) => { releaseWrite = resolve; });
          try {
            document.getElementById('bkReactivate').click();
            for (let i = 0; i < 100 && !heldEntries; i++) await new Promise((resolve) => setTimeout(resolve, 10));
            checks.slowBackupStarted = heldEntries === 1;
            document.getElementById('bkReactivateTop').click();
            await pause();
            checks.singleFolderWriter = heldEntries === 1;
            showHomePromise = I.showHome(); await pause();
            checks.slowFolderDoesNotBlockHome = !document.getElementById('home').hidden;
            document.getElementById('newProjOpen').click();
            document.getElementById('newProjName').value = 'During slow folder backup';
            document.getElementById('newProjBtn').click();
            for (let i = 0; i < 100 && I.S.id === fixture.id; i++) await new Promise((resolve) => setTimeout(resolve, 10));
            checks.slowFolderDoesNotBlockLocalSwitch = I.S.id !== fixture.id;
          } finally { heldWrite = null; releaseWrite(); }
          await showHomePromise;
          for (let i = 0; i < 200 && I.S.id === fixture.id; i++) await new Promise((resolve) => setTimeout(resolve, 10));
          await I.saveToDB();
          for (let i = 0; i < 200 && document.getElementById('bkReactivate').disabled; i++) await new Promise((resolve) => setTimeout(resolve, 10));

          // A restored handle may no longer expose/request permission; recovery must remain actionable.
          checkpoint = 'permission recovery';
          window.showDirectoryPicker = async () => ({ ...wrapDirectory(folder), requestPermission: undefined });
          await chooseBackup();
          document.getElementById('bkReactivate').click(); await pause();
          checks.missingPermissionMethodReported = document.getElementById('bkStatus').dataset.state === 'needs'
            && document.getElementById('toast').textContent.includes('carpeta');
          window.showDirectoryPicker = async () => ({ ...wrapDirectory(folder), requestPermission() { throw new DOMException('Folder permission expired', 'NotAllowedError'); } });
          await chooseBackup();
          document.getElementById('bkReactivateTop').click(); await pause();
          checks.permissionExceptionReported = document.getElementById('bkStatus').dataset.state === 'needs'
            && document.getElementById('toast').textContent.includes('Folder permission expired');
          window.showDirectoryPicker = async () => ({ ...wrapDirectory(folder), requestPermission: async () => 'denied' });
          await chooseBackup();
          document.getElementById('bkReactivate').click(); await pause();
          checks.deniedPermissionReported = document.getElementById('bkStatus').dataset.state === 'needs'
            && document.getElementById('toast').textContent.includes('carpeta');
          window.showDirectoryPicker = async () => wrapDirectory(folder);
          await chooseBackup();
          checks.folderCanBeSelectedAgain = document.getElementById('bkStatus').dataset.state === 'ok';
          const replacementFolder = await folder.getDirectoryHandle('replacement-destination', { create: true });
          checkpoint = 'new backup destination';
          window.showDirectoryPicker = async () => wrapDirectory(replacementFolder);
          await chooseBackup();
          const copiedProject = await replacementFolder.getDirectoryHandle(projectDir.name);
          const copiedManifest = JSON.parse(await (await (await copiedProject.getFileHandle('project.json')).getFile()).text());
          checks.newDestinationIncludesUnchangedProjects = copiedManifest.notes === 'Saved during folder I/O';
        } finally {
          window.showDirectoryPicker = picker;
          for (const stream of streams) await stream.abort().catch(() => {});
          await root.removeEntry(folderName, { recursive: true });
        }
      } catch (error) { throw new Error(`${checkpoint}: ${error?.stack || error}`); }
      finally { IDBObjectStore.prototype.put = originalPut; console.error = logError; }
      return checks;
    });
    for (const [name, passed] of Object.entries(results)) assert.equal(passed, true, name + ': ' + JSON.stringify(results));
    assert.deepEqual(errors, [], 'interrupted saves produce no uncaught page errors');
    console.log('Interrupted saves: IndexedDB rollback, folder preservation, visible failure and retry verified.');
  } finally {
    if (storedLanguage !== undefined) {
      await page.evaluate((value) => { if (value === null) localStorage.removeItem('ichantool.lang'); else localStorage.setItem('ichantool.lang', value); }, storedLanguage)
        .catch(() => {});
    }
    await page.close();
  }
}
