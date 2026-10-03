/**
 * PRC-L376: guards for SQL fragments that the pipeline interpolates.
 *
 * `sourceFilter` is spliced verbatim into WHERE clauses across the pipeline, so
 * it is restricted to a static allowlist of reviewed predicates. Table and
 * column names must be plain lower-case identifiers.
 */
import type { TableMapping } from './types.js';

/** Reviewed row-subset predicates used by TABLE_MAPPINGS. Extend deliberately. */
export const ALLOWED_SOURCE_FILTERS: ReadonlySet<string> = new Set([
  'is_student = 1',
  'is_staff = 1',
]);

const IDENTIFIER_RE = /^[a-z_][a-z0-9_]*$/;

export function assertSafeSourceFilter(filter: string | undefined): void {
  if (filter === undefined) return;
  if (!ALLOWED_SOURCE_FILTERS.has(filter)) {
    throw new Error(`sourceFilter is not in the reviewed allowlist: ${JSON.stringify(filter)}`);
  }
}

export function assertSafeIdentifier(name: string, what: string): void {
  if (!IDENTIFIER_RE.test(name)) {
    throw new Error(`${what} is not a safe SQL identifier: ${JSON.stringify(name)}`);
  }
}

/** Validate every interpolated fragment of a mapping; throws on the first violation. */
export function assertSafeTableMapping(mapping: TableMapping): void {
  assertSafeIdentifier(mapping.sourceTable, 'sourceTable');
  assertSafeIdentifier(mapping.targetTable, 'targetTable');
  assertSafeIdentifier(mapping.legacyPkColumn, `${mapping.sourceTable}.legacyPkColumn`);
  assertSafeSourceFilter(mapping.sourceFilter);
  for (const fk of mapping.foreignKeys) {
    assertSafeIdentifier(fk.column, `${mapping.sourceTable} FK column`);
    assertSafeIdentifier(fk.referencesTable, `${mapping.sourceTable} FK referencesTable`);
    assertSafeIdentifier(fk.referencesColumn, `${mapping.sourceTable} FK referencesColumn`);
  }
}
/**
 * PRC-L376 (PRO-S55-14): quote an SQL identifier the way pg-format's %I / libpq
 * PQescapeIdentifier do — wrap in double quotes and double any embedded quote — so a
 * config- or mapping-derived name can never terminate the identifier.
 */
export function quoteIdent(name: string): string {
  if (typeof name !== 'string' || name.length === 0 || name.includes('\u0000')) {
    throw new Error(`invalid SQL identifier: ${JSON.stringify(name)}`);
  }
  return `"${name.replace(/"/g, '""')}"`;
}
/** Quote an SQL string literal (pg-format %L): single quotes doubled, NUL rejected. */
export function quoteLiteral(value: string | number | boolean): string {
  const text = String(value);
  if (text.includes('\u0000')) throw new Error('SQL literal contains NUL');
  if (text.includes('\\')) return `E'${text.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
  return `'${text.replace(/'/g, "''")}'`;
}
const TYPE_NAME_RE = /^[a-z][a-z0-9_]*(\s*\(\s*\d+(\s*,\s*\d+)?\s*\))?(\[\])?$/i;
/** CAST target types are spliced as SQL; only plain type names (optionally sized) pass. */
export function assertSafeTypeName(typeName: string): string {
  if (!TYPE_NAME_RE.test(typeName)) {
    throw new Error(`unsafe SQL type name: ${JSON.stringify(typeName)}`);
  }
  return typeName;
}
