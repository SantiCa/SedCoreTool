// @ts-check
// The ichnotaxa (classes) of a project (card Q1): deleting one reaches the traces of every core, not only the open one, and can be undone in
// the same session; a project whose traces name a class that no longer exists is repaired when it opens. No DOM: tested in Node.

/**
 * @typedef {{cls: string | null, pred: string | null, nt?: boolean}} LabelledTrace
 * @typedef {{objects: Map<number, LabelledTrace>}} TraceSection
 * @typedef {{sections: TraceSection[]}} TraceCore
 * @typedef {{id: string, name: string}} ClassLike
 * @typedef {{cls: ClassLike, index: number, labels: {section: TraceSection, id: number, field: 'cls' | 'pred'}[]}} DeletedClass
 */

/**
 * How much of the project uses a class: traces labelled with it (`examples`: those that are training examples), traces it was predicted for,
 * the cores where any of them lie.
 * @param {TraceCore[]} cores @param {string} id
 */
export function classUse(cores, id) {
  let traces = 0, examples = 0, predictions = 0, inCores = 0;
  for (const core of cores) {
    let here = false;
    for (const section of core.sections) for (const o of section.objects.values()) {
      if (o.cls === id) { traces++; if (!o.nt) examples++; here = true; }
      if (o.pred === id) { predictions++; here = true; }
    }
    if (here) inCores++;
  }
  return { traces, examples, predictions, cores: inCores };
}

/**
 * Delete a class from the project: it leaves the class list and every trace of every core that was labelled or predicted with it becomes
 * unlabelled. Returns what `restoreClass` needs to undo it.
 * @param {{classes: ClassLike[], cores: TraceCore[]}} project @param {string} id
 * @returns {DeletedClass | null} null when there is no such class
 */
export function deleteClass(project, id) {
  const index = project.classes.findIndex((c) => c.id === id);
  if (index < 0) return null;
  const cls = project.classes[index], labels = /** @type {DeletedClass['labels']} */ ([]);
  for (const core of project.cores) for (const section of core.sections) for (const [key, o] of section.objects) {
    if (o.cls === id) { o.cls = null; labels.push({ section, id: key, field: 'cls' }); }
    if (o.pred === id) { o.pred = null; labels.push({ section, id: key, field: 'pred' }); }
  }
  project.classes.splice(index, 1);
  return { cls, index, labels };
}

/**
 * Undo `deleteClass`: the class goes back to its place and the traces that still exist and were not labelled again get it back.
 * @param {{classes: ClassLike[]}} project @param {DeletedClass} deleted
 * @returns {{restored: number, skipped: number}} labels given back, and those left alone (trace gone or labelled again)
 */
export function restoreClass(project, deleted) {
  if (!project.classes.some((c) => c.id === deleted.cls.id)) project.classes.splice(Math.min(deleted.index, project.classes.length), 0, deleted.cls);
  let restored = 0, skipped = 0;
  for (const { section, id, field } of deleted.labels) {
    const o = section.objects.get(id);
    if (o && o[field] == null) { o[field] = deleted.cls.id; restored++; } else skipped++;
  }
  return { restored, skipped };
}

/**
 * Traces whose label or prediction names a class the project does not have become unlabelled (a project saved after a deletion that only
 * reached the open core, before card Q1).
 * @param {TraceCore[]} cores @param {ClassLike[]} classes
 * @returns {{traces: number, predictions: number, sections: Set<TraceSection>}}
 */
export function repairOrphanLabels(cores, classes) {
  const known = new Set(classes.map((c) => c.id)), sections = new Set();
  let traces = 0, predictions = 0;
  for (const core of cores) for (const section of core.sections) for (const o of section.objects.values()) {
    if (o.cls != null && !known.has(o.cls)) { o.cls = null; traces++; sections.add(section); }
    if (o.pred != null && !known.has(o.pred)) { o.pred = null; predictions++; sections.add(section); }
  }
  return { traces, predictions, sections };
}
