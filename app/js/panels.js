/* Resizable and collapsible side panels, resizable maps. */
import { $, S } from './state.js';
import { mode } from './columns.js';
import { prof, redrawAllMap, resizeCanvases } from './app.js';
import { renderGeoMap } from './multiproxy.js';

/* ───────────── resizable / collapsible side panels and resizable maps (V23) ───────────── */
export let panelPrefs = {};
try { panelPrefs = JSON.parse(localStorage.getItem('ichantool.panels') || '{}'); } catch { panelPrefs = {}; }
/** Card Q10: runs `up` once when the pointer is released or the browser cancels it (lost capture, palm rejection, alert), so drag state never sticks. */
export function onPointerEnd(el, up, capture = false) {
  const end = (ev) => { el.removeEventListener('pointerup', end, capture); el.removeEventListener('pointercancel', end, capture); up(ev); };
  el.addEventListener('pointerup', end, capture); el.addEventListener('pointercancel', end, capture);
}
/** Card Q10: loads an SVG text as an image through a Blob URL (a data: URL of a large figure is slow and can exceed limits) and always revokes the URL. */
export async function withSvgImage(svg, use) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try { const img = new Image(); img.src = url; await img.decode(); return await use(img); } finally { URL.revokeObjectURL(url); }
}
export const savePanels = () => { try { localStorage.setItem('ichantool.panels', JSON.stringify(panelPrefs)); } catch { /* storage blocked */ } };
const panelSides = (m) => (m === 'section' ? ['l', 'r'] : m === 'data' ? [] : ['l']);
const splitL = document.createElement('div'), splitR = document.createElement('div');
splitL.className = 'splitter l'; splitR.className = 'splitter r';
splitL.innerHTML = `<button type="button" data-i18n-title="ui.togglePanel">‹</button>`; splitR.innerHTML = `<button type="button" data-i18n-title="ui.togglePanel">›</button>`;
$('work').append(splitL, splitR);
export function applyPanels() {
  const w = $('work'), p = panelPrefs[mode] || {}, sides = panelSides(mode);
  w.classList.toggle('lcollapsed', sides.includes('l') && !!p.lc); w.classList.toggle('rcollapsed', sides.includes('r') && !!p.rc);
  if (sides.includes('l') && (p.lc || p.l)) w.style.setProperty('--lw', p.lc ? '0px' : p.l + 'px'); else w.style.removeProperty('--lw');
  if (sides.includes('r') && (p.rc || p.r)) w.style.setProperty('--rw', p.rc ? '0px' : p.r + 'px'); else w.style.removeProperty('--rw');
  if (panelPrefs.profW) prof.parentElement.style.setProperty('--pw', panelPrefs.profW + 'px');   // V0.21
  requestAnimationFrame(() => { placeSplitters(); resizeCanvases?.(); });
}
export function placeSplitters() {
  const w = $('work'), sides = panelSides(mode), wide = mode === 'geo' && w.classList.contains('mapwide');
  const left = [...w.querySelectorAll(':scope > aside.side.left')].find((a) => getComputedStyle(a).display !== 'none');
  const right = w.querySelector(':scope > aside.side.right');
  splitL.hidden = !sides.includes('l') || !left || wide || innerWidth <= 860;
  splitR.hidden = !sides.includes('r') || !right || innerWidth <= 860;
  if (!splitL.hidden) { splitL.style.left = `${left.offsetLeft + left.offsetWidth}px`; splitL.querySelector('button').textContent = w.classList.contains('lcollapsed') ? '›' : '‹'; }
  if (!splitR.hidden) { splitR.style.left = `${right.offsetLeft}px`; splitR.querySelector('button').textContent = w.classList.contains('rcollapsed') ? '‹' : '›'; }
}
function dragSplitter(el, side) {
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add('drag');
    const w = $('work'), r = w.getBoundingClientRect(), p = (panelPrefs[mode] ||= {});
    const move = (ev) => {
      const v = side === 'l' ? ev.clientX - r.left : r.right - ev.clientX, px = Math.round(Math.max(170, Math.min(r.width * 0.6, v)));
      p[side] = px; p[side + 'c'] = false; w.classList.remove(side === 'l' ? 'lcollapsed' : 'rcollapsed');
      w.style.setProperty(side === 'l' ? '--lw' : '--rw', px + 'px'); placeSplitters();
    };
    const up = () => { el.classList.remove('drag'); el.removeEventListener('pointermove', move); savePanels(); resizeCanvases?.(); if (mode === 'geo' && S.geo.view.tab === 'map') renderGeoMap(); };
    el.addEventListener('pointermove', move); onPointerEnd(el, up);
  });
  el.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) { const p = (panelPrefs[mode] ||= {}); delete p[side]; p[side + 'c'] = false; savePanels(); applyPanels(); } });
  el.querySelector('button').addEventListener('click', () => { const p = (panelPrefs[mode] ||= {}); p[side + 'c'] = !p[side + 'c']; savePanels(); applyPanels(); });
}
dragSplitter(splitL, 'l'); dragSplitter(splitR, 'r');
window.addEventListener('resize', () => placeSplitters());
try { new ResizeObserver(() => placeSplitters()).observe($('work')); } catch { /* old browsers */ }

// maps: drag the right edge (width) or the bottom edge (height) of the frame; double click restores the default
let frameSizes = {};
try { frameSizes = JSON.parse(localStorage.getItem('ichantool.mapFrames') || '{}'); } catch { frameSizes = {}; }
/** Height/width wanted for the plot area of a map whose frame height was fixed by the user (null = follow the extent). */
export function frameRatio(id) {
  const z = frameSizes[id], f = $(id); if (!z?.h || !f) return null;
  const w = f.clientWidth || z.w || 900, sc = w / 900;
  return Math.max(0.2, (z.h / sc - 44 - 110) / 900);
}
function applyFrame(id) {
  const f = $(id), z = frameSizes[id] || {};
  if (z.w) f.style.setProperty('--fw', z.w + 'px'); else f.style.removeProperty('--fw');
  if (z.h) { f.style.setProperty('--fh', z.h + 'px'); f.classList.add('hfixed'); } else { f.style.removeProperty('--fh'); f.classList.remove('hfixed'); }
}
for (const h of document.querySelectorAll('.rszh, .rszv')) {
  const id = h.dataset.frame, horiz = h.classList.contains('rszh');
  h.addEventListener('pointerdown', (e) => {
    e.preventDefault(); h.setPointerCapture(e.pointerId);
    const f = $(id), r = f.getBoundingClientRect(), z = (frameSizes[id] ||= {});
    const move = (ev) => { if (horiz) z.w = Math.round(Math.max(320, ev.clientX - r.left)); else z.h = Math.round(Math.max(240, ev.clientY - r.top)); applyFrame(id); };
    const up = () => { h.removeEventListener('pointermove', move); f.classList.remove('sizing'); try { localStorage.setItem('ichantool.mapFrames', JSON.stringify(frameSizes)); } catch { /* storage blocked */ } redrawFrame(id); };
    f.classList.add('sizing');
    h.addEventListener('pointermove', move); onPointerEnd(h, up);
  });
  h.addEventListener('dblclick', () => { const z = (frameSizes[id] ||= {}); if (horiz) delete z.w; else delete z.h; applyFrame(id); try { localStorage.setItem('ichantool.mapFrames', JSON.stringify(frameSizes)); } catch { /* storage blocked */ } redrawFrame(id); });
}
function redrawFrame(id) { if (id === 'gmFrame') renderGeoMap(); else redrawAllMap(); }
applyFrame('gmFrame'); applyFrame('amFrame');