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
