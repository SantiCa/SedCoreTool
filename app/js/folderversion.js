// @ts-check
// Card M8.4.18c (decision of 20 Nov 2026): «Open project folder» can open an older state of a project: its `project.json` (the last save) or the
// last state of one day kept in its `historial/`. The folder's tiles, manifests and sources serve every one of them (they are never deleted), so a
// day of the history opens with the masks of that day. `historyDays` reads the folder (no DOM); `chooseFolderVersion` asks the user.
import { t } from './i18n.js';

const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.json$/;

/**
 * The days kept in a project folder's `historial/`, newest first: `[{day, handle}]` (empty when there is no history).
 * @param {any} folder a directory handle of the File System Access API
 */
export async function historyDays(folder) {
  let history;
  try { history = await folder.getDirectoryHandle('historial'); } catch { return []; }
  const days = [];
  for await (const [name, handle] of history.entries()) {
    const match = handle.kind === 'file' ? DAY_FILE.exec(name) : null;
    if (match) days.push({ day: match[1], handle });
  }
  return days.sort((a, b) => b.day.localeCompare(a.day));
}

/**
 * The text of the state of a project folder that the user chooses: `project.json` directly when the folder keeps no history, otherwise after a
 * choice between it and each day of the history. Null when the user cancels.
 * @param {any} folder
 * @returns {Promise<string|null>}
 */
export async function chooseFolderVersion(folder) {
  const current = async () => (await (await folder.getFileHandle('project.json')).getFile()).text();
  const days = await historyDays(folder);
  if (!days.length) return current();
  const choice = await askVersion(days.map((d) => d.day));
  if (choice === null) return null;
  if (choice === '') return current();
  return (await days.find((d) => d.day === choice).handle.getFile()).text();
}

/** A modal dialog with the last save and the days: resolves to '' (last save), a day, or null (cancelled). @param {string[]} days */
function askVersion(days) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog'), title = document.createElement('h2'), note = document.createElement('p');
    const select = document.createElement('select'), row = document.createElement('div'), cancel = document.createElement('button'), open = document.createElement('button');
    title.textContent = t('bk.versionTitle'); note.className = 'note'; note.textContent = t('bk.versionNote');
    select.id = 'folderVersion'; select.setAttribute('aria-label', t('bk.versionTitle'));
    select.append(new Option(t('bk.versionCurrent'), ''), ...days.map((day) => new Option(t('bk.versionDay', { d: day }), day)));
    row.className = 'row'; cancel.className = 'btn'; cancel.textContent = t('confirm.no'); open.className = 'btn primary'; open.textContent = t('bk.versionOpen');
    open.id = 'folderVersionOpen';
    row.append(cancel, open); dlg.append(title, select, note, row); document.body.append(dlg);
    let answer = null;
    open.addEventListener('click', () => { answer = select.value; dlg.close(); });
    cancel.addEventListener('click', () => dlg.close());
    dlg.addEventListener('close', () => { dlg.remove(); resolve(answer); });
    dlg.showModal(); select.focus();
  });
}
