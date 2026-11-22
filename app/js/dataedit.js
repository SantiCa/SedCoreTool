// SedCoreTool web — card Q10: small pure rules of the Data tab and of the record list, kept out of the DOM code so Node can test them.

/**
 * Original numeric value of a cell, read from the stored column and not from the 6-decimal text the table shows.
 * `x` is the depth (or age) of the row as the table writes it in `data-x`; returns null when the row or the value is missing.
 * @param {{ depth?: (number|null)[], age?: (number|null)[], proxies?: Record<string, (number|null)[]> }} core
 * @param {string} col @param {string | number} x
 */
export function originalCellValue(core, col, x) {
  const axis = core.depth || core.age || [], i = axis.findIndex((a) => a != null && String(a) === String(x));
  const v = i < 0 ? null : core.proxies?.[col]?.[i];
  return Number.isFinite(v) ? /** @type {number} */ (v) : null;
}

/** Removes the item with this id from `list`; a missing id changes nothing. @returns {boolean} true when something was removed */
export function removeById(list, id) {
  const at = list.findIndex((item) => item.id === id);
  if (at < 0) return false;
  list.splice(at, 1);
  return true;
}

/** Deletes a manual column of one core. The core id and the column name travel separately, so a name containing `|` is safe. @returns {boolean} */
export function deleteManualColumn(cores, coreId, col) {
  const c = cores.find((x) => x.id === coreId);
  if (!c?.user || !Object.hasOwn(c.user, col)) return false;
  delete c.user[col];
  return true;
}
