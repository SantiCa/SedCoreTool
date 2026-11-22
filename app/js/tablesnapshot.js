// @ts-check
// A record table as the engine receives it (card M8.4.10) and returns it (card M8.5.3): named numeric columns of one length (depth/age
// records, data tables, multiproxy series), with missing values, in one columnar format. Pure: no DOM.
//
// Three buffers carry a table (contract §4, "Tables"): `<name>` (`utf8json`) holds `{version: 1, rows, columns: [{name, unit}]}` in
// column order; `<name>_values` (`f64le[columns, rows]`) holds column i in row i, C order; `<name>_valid` (`u8[columns, rows]`) is 1
// where a value is present and 0 where it is missing, and a missing slot holds the value 0. Missing values never travel as NaN.

/** Version of the table format and of its identity text. */
export const TABLE_FORMAT_VERSION = 1;
/** Limits of one table, enforced here and again by the engine (`methods/validation.py::table`). */
export const MAX_TABLE_COLUMNS = 256;
export const MAX_TABLE_ROWS = 1048576;
/** Bytes of the value and validity buffers together (9 bytes per cell): about 930,000 cells. */
export const MAX_TABLE_DATA_BYTES = 8 * 1048576;
/** Bytes of the `utf8json` description; the engine charges it 64 times (contract §3), so at most 2 MiB of budget. */
export const MAX_TABLE_META_BYTES = 32768;
/** UTF-8 bytes of a column name (non-empty) and of a unit (may be empty). */
export const MAX_TABLE_NAME_BYTES = 256;
export const MAX_TABLE_UNIT_BYTES = 64;
/** The engine charges a metadata buffer this many times its length against the session budget (`engine/buffers.py`). */
export const TABLE_METADATA_CHARGE = 64;

/** A table that cannot be sent: `code` is `INVALID_REQUEST` or `LIMIT_EXCEEDED`, `field` the input at fault (never a value). */
export class TableSnapshotError extends Error {
  /** @param {'INVALID_REQUEST' | 'LIMIT_EXCEEDED'} code @param {string} field */
  constructor(code, field) { super(`${code}: ${field}`); this.name = 'TableSnapshotError'; this.code = code; this.field = field; }
}

/** The engine input names of the table called `name`. @param {string} name */
export function tableInputNames(name) {
  return { meta: name, values: `${name}_values`, valid: `${name}_valid` };
}

/** @param {Uint8Array} bytes @returns {Promise<string>} */
async function tableDigest(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', /** @type {Uint8Array<ArrayBuffer>} */ (bytes)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const TABLE_LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const tableTextBytes = (/** @type {string} */ text) => new TextEncoder().encode(text).length;

/**
 * @typedef {{name: string, unit?: string, values: ArrayLike<number | null>}} TableColumnInput
 * @typedef {{dtype: 'utf8json', shape: [number], data: Uint8Array, sha256: string}} TableMetaBuffer
 * @typedef {{dtype: 'f64le', shape: [number, number], data: Float64Array, sha256: string}} TableValueBuffer
 * @typedef {{dtype: 'u8', shape: [number, number], data: Uint8Array, sha256: string}} TableValidBuffer
 * @typedef {{identity: string, rows: number, columns: {name: string, unit: string}[],
 *   buffers: {meta: TableMetaBuffer, values: TableValueBuffer, valid: TableValidBuffer}, chargedBytes: number}} TableSnapshot
 */

/**
 * The engine buffers of a table and its identity. `columns` are named numeric columns of one length, in the order the method
 * receives them; each value is a finite number or `null` (missing). Anything else (NaN, an infinity, `undefined`, a string) is
 * refused, as are an empty table, columns of different lengths, a repeated or empty name and the limits above. The identity is the
 * SHA-256 of `table/1|<rows>|<JSON of [name, unit, SHA-256 of the column's values, SHA-256 of its validity] per column>`: it changes
 * with any value, missing slot, name, unit or the column order, and with nothing else (an array type or a copy of the same table give
 * the same identity).
 * @param {TableColumnInput[]} columns
 * @returns {Promise<TableSnapshot>}
 */
export async function buildTableSnapshot(columns) {
  if (!Array.isArray(columns) || columns.length < 1) throw new TableSnapshotError('INVALID_REQUEST', 'columns');
  if (columns.length > MAX_TABLE_COLUMNS) throw new TableSnapshotError('LIMIT_EXCEEDED', 'columns');
  const count = columns.length;
  /** @type {{name: string, unit: string}[]} */
  const described = [];
  const names = new Set();
  for (let i = 0; i < count; i++) {
    const column = columns[i];
    if (!column || typeof column !== 'object') throw new TableSnapshotError('INVALID_REQUEST', `columns[${i}]`);
    const { name, unit = '' } = column;
    if (typeof name !== 'string' || !name || TABLE_LONE_SURROGATE.test(name)) throw new TableSnapshotError('INVALID_REQUEST', `columns[${i}].name`);
    if (tableTextBytes(name) > MAX_TABLE_NAME_BYTES) throw new TableSnapshotError('LIMIT_EXCEEDED', `columns[${i}].name`);
    if (names.has(name)) throw new TableSnapshotError('INVALID_REQUEST', `columns[${i}].name`);
    names.add(name);
    if (typeof unit !== 'string' || TABLE_LONE_SURROGATE.test(unit)) throw new TableSnapshotError('INVALID_REQUEST', `columns[${i}].unit`);
    if (tableTextBytes(unit) > MAX_TABLE_UNIT_BYTES) throw new TableSnapshotError('LIMIT_EXCEEDED', `columns[${i}].unit`);
    const values = column.values;
    if (!values || typeof values !== 'object' || !Number.isSafeInteger(values.length)) throw new TableSnapshotError('INVALID_REQUEST', `columns[${i}].values`);
    described.push({ name, unit });
  }
  const rows = columns[0].values.length;
  if (rows < 1) throw new TableSnapshotError('INVALID_REQUEST', 'rows');
  if (rows > MAX_TABLE_ROWS) throw new TableSnapshotError('LIMIT_EXCEEDED', 'rows');
  for (let i = 1; i < count; i++) if (columns[i].values.length !== rows) throw new TableSnapshotError('INVALID_REQUEST', `columns[${i}].values`);
  if (count * rows * 9 > MAX_TABLE_DATA_BYTES) throw new TableSnapshotError('LIMIT_EXCEEDED', 'rows');

  const meta = new TextEncoder().encode(JSON.stringify({ version: TABLE_FORMAT_VERSION, rows, columns: described }));
  if (meta.length > MAX_TABLE_META_BYTES) throw new TableSnapshotError('LIMIT_EXCEEDED', 'columns');
  const values = new Float64Array(count * rows), valid = new Uint8Array(count * rows);
  for (let i = 0; i < count; i++) {
    const source = columns[i].values, start = i * rows;
    for (let j = 0; j < rows; j++) {
      const value = source[j];
      if (value === null) continue;                    // missing: validity 0, value 0
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new TableSnapshotError('INVALID_REQUEST', `columns[${i}].values[${j}]`);
      values[start + j] = value;
      valid[start + j] = 1;
    }
  }
  const valueBytes = new Uint8Array(values.buffer);
  const perColumn = [];
  for (let i = 0; i < count; i++) {
    perColumn.push([described[i].name, described[i].unit,
      await tableDigest(valueBytes.subarray(i * rows * 8, (i + 1) * rows * 8)), await tableDigest(valid.subarray(i * rows, (i + 1) * rows))]);
  }
  const identity = await tableDigest(new TextEncoder().encode(`table/${TABLE_FORMAT_VERSION}|${rows}|${JSON.stringify(perColumn)}`));
  return {
    identity, rows, columns: described,
    buffers: {
      meta: { dtype: 'utf8json', shape: [meta.length], data: meta, sha256: await tableDigest(meta) },
      values: { dtype: 'f64le', shape: [count, rows], data: values, sha256: await tableDigest(valueBytes) },
      valid: { dtype: 'u8', shape: [count, rows], data: valid, sha256: await tableDigest(valid) },
    },
    chargedBytes: values.byteLength + valid.byteLength + TABLE_METADATA_CHARGE * meta.length,
  };
}

/**
 * The columns of a table in the format above, the inverse of `buildTableSnapshot`: a table output of `method.run` (contract §9.3) or the
 * buffers of a snapshot. `description` is the parsed `{version: 1, rows, columns: [{name, unit}]}`; `values` and `valid` hold the cells
 * column after column (`columns.length * rows` each). A value is `null` where its validity is 0. An output table may have 0 rows. Anything
 * else (another version, a count that does not match, a validity other than 0 or 1, a present value that is not finite, a name that is not
 * a non-empty string) is refused with `INVALID_REQUEST` naming the part at fault.
 * @param {any} description @param {ArrayLike<number>} values @param {ArrayLike<number>} valid
 * @returns {{name: string, unit: string, values: (number | null)[]}[]}
 */
export function readTableResult(description, values, valid) {
  if (!description || typeof description !== 'object' || description.version !== TABLE_FORMAT_VERSION) throw new TableSnapshotError('INVALID_REQUEST', 'description');
  const { rows, columns } = description;
  if (!Number.isSafeInteger(rows) || rows < 0 || rows > MAX_TABLE_ROWS) throw new TableSnapshotError('INVALID_REQUEST', 'rows');
  if (!Array.isArray(columns) || columns.length < 1 || columns.length > MAX_TABLE_COLUMNS) throw new TableSnapshotError('INVALID_REQUEST', 'columns');
  const cells = columns.length * rows;
  if (!values || values.length !== cells) throw new TableSnapshotError('INVALID_REQUEST', 'values');
  if (!valid || valid.length !== cells) throw new TableSnapshotError('INVALID_REQUEST', 'valid');
  return columns.map((column, i) => {
    if (!column || typeof column.name !== 'string' || !column.name || typeof column.unit !== 'string') throw new TableSnapshotError('INVALID_REQUEST', `columns[${i}]`);
    /** @type {(number | null)[]} */
    const read = new Array(rows);
    for (let j = 0, k = i * rows; j < rows; j++, k++) {
      if (valid[k] === 0) { read[j] = null; continue; }
      if (valid[k] !== 1 || !Number.isFinite(values[k])) throw new TableSnapshotError('INVALID_REQUEST', `columns[${i}].values[${j}]`);
      read[j] = values[k];
    }
    return { name: column.name, unit: column.unit, values: read };
  });
}
