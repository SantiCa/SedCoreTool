/* The original image of a tiled section (card M8.4.18b, decision D3 of M8.4.18), in the section form: where it is, "Locate the image" when it
   moved and "Copy the image into the project". Controller (it uses the DOM); the bridge is `window.corantoolDesktop.tiles` and never shows the
   page a path: the main process says only whether the project holds a copy and whether the remembered original is still there. */
import { t } from './i18n.js';
import { $ } from './state.js';

/** A size in bytes for people: "8.0 GB", "512 MB". @param {number | null} bytes */
export function sizeText(bytes) {
  if (!Number.isFinite(bytes) || bytes === null) return '?';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes, unit = 0;
  while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit++; }
  return `${unit ? value.toFixed(value < 10 ? 1 : 0) : value} ${units[unit]}`;
}

/**
 * @param {{bridge: any, project: () => string, toast: (text: string, ms?: number) => void,
 *   progressDialog: (title: string, onCancel: () => void) => {update: (p: any) => void, close: () => void},
 *   onLocated: (s: any) => Promise<void>}} options `onLocated` replaces a locked section by the same section opened with its pixels.
 */
export function createTiledSourcePanel({ bridge, project, toast, progressDialog, onLocated }) {
  let shown = 0;                                          // the latest render: an older answer of the main process is dropped
  const box = $('secSource'), note = $('secSourceNote'), locateLabel = $('secLocateLabel'), locateFile = /** @type {HTMLInputElement} */ ($('secLocate'));
  const copyButton = /** @type {HTMLButtonElement} */ ($('secCopySource'));
  let current = null;

  async function render(s) {
    const turn = ++shown;
    current = s;
    box.hidden = !bridge || !s?.tiled || s.frozen === 'engine';
    if (box.hidden) return;
    note.textContent = '';
    copyButton.hidden = true; locateLabel.hidden = true;
    const info = await bridge.sourceInfo(project(), s.tiled.pyramid).catch(() => null);
    if (turn !== shown) return;
    const size = sizeText(s.tiled.source?.size ?? info?.ok?.size ?? null);
    if (!info?.ok) { note.textContent = t('tiles.source.unknown'); return; }
    const { copied, original } = info.ok;
    note.textContent = copied ? t('tiles.source.copied', { s: size }) : original ? t('tiles.source.original', { s: size })
      : t(s.frozen === 'source' ? 'tiles.source.missing' : 'tiles.source.cached', { s: size });
    locateLabel.hidden = copied || original;
    copyButton.hidden = copied || !original || !!s.frozen;
  }

  /** Run one bridge operation with the progress dialog; its result, or null after telling the user why it failed. */
  async function withProgress(title, run) {
    const key = crypto.randomUUID(), dialog = progressDialog(title, () => { void bridge.cancel(key); });
    const stop = bridge.onProgress((k, progress) => { if (k === key) dialog.update(progress); });
    try {
      const result = await run(key);
      if (result?.error) { toast(t('tiles.err', { code: result.error.code, field: result.error.field || '' }), 9000); return null; }
      return result?.ok ?? null;
    } finally { stop(); dialog.close(); }
  }

  async function locate(file) {
    const s = current;
    if (!s?.tiled || !file) return;
    const registered = await bridge.register(file);
    if (registered.error) { toast(t('tiles.err', { code: registered.error.code, field: registered.error.field || '' }), 9000); return; }
    const saved = s.tiled.source?.size || registered.ok.size;
    const result = await withProgress(t('tiles.locating', { n: registered.ok.name }), (key) => bridge.locate(project(), s.tiled.pyramid, saved, registered.ok.token, key));
    if (!result || result.cancelled) return;
    if (!result.matched) { toast(t('tiles.source.notSame', { a: sizeText(result.size), b: sizeText(saved) }), 12000); return; }
    toast(t('tiles.source.located'), 6000);
    if (s.frozen === 'source') await onLocated(s);
    else void render(s);
  }

  async function copy() {
    const s = current;
    if (!s?.tiled || s.frozen) return;
    const info = await bridge.sourceInfo(project(), s.tiled.pyramid).catch(() => null);
    if (!info?.ok?.original) { void render(s); return; }
    if (!confirm(t('tiles.source.copyAsk', { s: sizeText(info.ok.size), f: sizeText(info.ok.free) }))) return;
    const result = await withProgress(t('tiles.copying', { n: s.tiled.source?.name || s.file.name }), (key) => bridge.copySource(project(), s.tiled.pyramid, key));
    if (result?.copied) toast(t('tiles.source.copyDone'), 6000);
    void render(s);
  }

  locateFile.addEventListener('change', () => { const file = locateFile.files?.[0]; locateFile.value = ''; void locate(file); });
  copyButton.addEventListener('click', () => { void copy(); });
  return { render };
}
