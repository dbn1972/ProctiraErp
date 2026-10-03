/**
 * PRC-H105: owner-supplied OpenEMIS code tables for map_enum columns.
 *
 * Defaulted decision: an OpenEMIS code with no mapping fails the transform step (the
 * pre-flight reports every unmapped code with its row count) — no row is migrated with a
 * guessed or NULL value, so target columns keep their NOT NULL / CHECK constraints.
 * Owners extend the built-in mappings with the customer's own code export via
 * OPENEMIS_ENUM_OVERRIDES=/path/to/overrides.json:
 *
 *   { "students.gender": { "3": "other" }, "enrollments.status": { "5": "PROMOTED" } }
 *
 * Keys are `<targetTable>.<targetColumn>` of an existing map_enum column. Codes and values
 * are validated (no quotes or SQL) before they reach the generated CASE expression.
 */
import { readFileSync } from 'node:fs';
import type { TableMapping } from './types.js';

export type EnumOverrides = Record<string, Record<string, string>>;

const CODE_RE = /^[0-9A-Za-z_-]{1,32}$/;
const VALUE_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

export function parseEnumOverrides(raw: unknown): EnumOverrides {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('OPENEMIS_ENUM_OVERRIDES must be a JSON object');
  }
  const out: EnumOverrides = {};
  for (const [key, table] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(key)) {
      throw new Error(`enum override key must be <table>.<column>: ${JSON.stringify(key)}`);
    }
    if (typeof table !== 'object' || table === null || Array.isArray(table)) {
      throw new Error(`enum override ${key} must map codes to values`);
    }
    out[key] = {};
    for (const [code, value] of Object.entries(table as Record<string, unknown>)) {
      if (!CODE_RE.test(code) || typeof value !== 'string' || !VALUE_RE.test(value)) {
        throw new Error(`invalid enum override ${key}[${JSON.stringify(code)}]`);
      }
      out[key][code] = value;
    }
  }
  return out;
}

export function loadEnumOverrides(env: NodeJS.ProcessEnv = process.env): EnumOverrides {
  const path = env['OPENEMIS_ENUM_OVERRIDES']?.trim();
  if (!path) return {};
  return parseEnumOverrides(JSON.parse(readFileSync(path, 'utf8')));
}

/** Returns copies of `mappings` with overrides merged into their map_enum columns. */
export function applyEnumOverrides(
  mappings: readonly TableMapping[],
  overrides: EnumOverrides,
): TableMapping[] {
  const used = new Set<string>();
  const result = mappings.map((mapping) => ({
    ...mapping,
    columns: mapping.columns.map((col) => {
      const key = `${mapping.targetTable}.${col.target}`;
      const extra = overrides[key];
      if (!extra || col.transform?.type !== 'map_enum') return col;
      used.add(key);
      return { ...col, transform: { ...col.transform, mapping: { ...col.transform.mapping, ...extra } } };
    }),
  }));
  const unknown = Object.keys(overrides).filter((k) => !used.has(k));
  if (unknown.length > 0) {
    throw new Error(`enum overrides target no map_enum column: ${unknown.join(', ')}`);
  }
  return result;
}
