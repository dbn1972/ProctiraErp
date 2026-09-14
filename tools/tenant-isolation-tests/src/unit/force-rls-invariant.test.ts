/**
 * W1-DATA-02 (A2) — FORCE RLS invariant recurrence guard.
 *
 * Postgres RLS is bypassable by table owners unless FORCE ROW LEVEL SECURITY is set.
 * `021_wave7_integrity_schema.sql` forced every RLS-enabled table at the time; later
 * migrations (notably `047_academic_rollover_runs_schema.sql`) regressed by enabling
 * RLS without FORCE. `051_force_rls_invariant.sql` re-applies the invariant.
 *
 * Charter: Section 39 (Tenant Isolation Verification)
 */
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const INVARIANT_MIGRATION = '051_force_rls_invariant.sql';
const WAVE7_FORCE_MIGRATION = '021_wave7_integrity_schema.sql';

const REGRESSED_047_TABLES = [
  'academic_rollover_runs',
  'lms_modules',
  'lms_module_items',
] as const;

function sqlDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '../../../../db/sql'),
    join(process.cwd(), 'db/sql'),
    join(process.cwd(), '../../db/sql'),
  ];
  for (const path of candidates) {
    try {
      readdirSync(path);
      return path;
    } catch {
      // try next
    }
  }
  throw new Error('Could not locate db/sql/');
}

function loadSql(file: string): string {
  return readFileSync(join(sqlDir(), file), 'utf8');
}

function listNumberedSqlFiles(): string[] {
  return readdirSync(sqlDir())
    .filter((f) => /^[0-9]+[^b].*\.sql$/.test(f))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

function extractEnabledTables(sql: string): string[] {
  return [
    ...sql.matchAll(/ALTER TABLE\s+(\w+)\s+ENABLE ROW LEVEL SECURITY/gi),
  ].map((m) => m[1]!);
}

function extractForcedTables(sql: string): Set<string> {
  return new Set(
    [...sql.matchAll(/ALTER TABLE\s+(\w+)\s+FORCE ROW LEVEL SECURITY/gi)].map(
      (m) => m[1]!,
    ),
  );
}

/** Matches 021 / 051 style loops over pg_catalog that FORCE all RLS tables. */
function hasForceAllRlsDoBlock(sql: string): boolean {
  return (
    /FORCE ROW LEVEL SECURITY/.test(sql) &&
    /rowsecurity\s*=\s*true/.test(sql) &&
    /(pg_tables|pg_class)/.test(sql)
  );
}

function staticEnableWithoutForceOffenders(): { file: string; table: string }[] {
  const files = listNumberedSqlFiles();
  const invariantPresent = files.includes(INVARIANT_MIGRATION);
  const invariantSql = invariantPresent ? loadSql(INVARIANT_MIGRATION) : '';
  const invariantCoversAll =
    invariantPresent && hasForceAllRlsDoBlock(invariantSql);

  const wave7Idx = files.indexOf(WAVE7_FORCE_MIGRATION);
  if (wave7Idx < 0) {
    throw new Error(`missing ${WAVE7_FORCE_MIGRATION}`);
  }

  const offenders: { file: string; table: string }[] = [];

  for (const file of files.slice(wave7Idx + 1)) {
    if (file === INVARIANT_MIGRATION) continue;
    const sql = loadSql(file);
    if (hasForceAllRlsDoBlock(sql)) continue;

    const enabled = extractEnabledTables(sql);
    const forced = extractForcedTables(sql);
    for (const table of enabled) {
      if (!forced.has(table)) {
        offenders.push({ file, table });
      }
    }
  }

  if (invariantCoversAll) return [];
  return offenders;
}

function queryLiveUnforcedRlsTables(): string[] | null {
  const url = process.env['DATABASE_URL'];
  if (!url) return null;

  const catalogSql =
    "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = true AND NOT c.relforcerowsecurity ORDER BY 1";

  try {
    const out = execSync(`psql "${url}" -v ON_ERROR_STOP=1 -At -c ${JSON.stringify(catalogSql)}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return out
      .trim()
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`live FORCE RLS catalog query failed: ${message}`);
  }
}

describe('W1-DATA-02 FORCE RLS invariant (051_force_rls_invariant.sql)', () => {
  it('047_academic_rollover_runs_schema.sql enables RLS without inline FORCE (regression source)', () => {
    const sql = loadSql('047_academic_rollover_runs_schema.sql');
    for (const table of REGRESSED_047_TABLES) {
      expect(sql, `${table} must ENABLE RLS in 047`).toMatch(
        new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`),
      );
      expect(sql, `${table} must not inline FORCE in 047`).not.toMatch(
        new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`),
      );
    }
  });

  it('051 migration exists and applies FORCE to every RLS-enabled public table', () => {
    const sql = loadSql(INVARIANT_MIGRATION);
    expect(hasForceAllRlsDoBlock(sql)).toBe(true);
    for (const table of REGRESSED_047_TABLES) {
      expect(sql).toMatch(
        new RegExp(
          `(ALTER TABLE ${table} FORCE ROW LEVEL SECURITY|FOR\\s+\\w+\\s+IN[\\s\\S]*FORCE ROW LEVEL SECURITY)`,
        ),
      );
    }
  });

  it('static scan: no numbered migration leaves ENABLE without FORCE unless 051 DO block covers', () => {
    const offenders = staticEnableWithoutForceOffenders();
    expect(
      offenders,
      offenders.length
        ? `tables enabled without inline FORCE and not covered by ${INVARIANT_MIGRATION}: ${offenders.map((o) => `${o.file}:${o.table}`).join(', ')}`
        : undefined,
    ).toEqual([]);
  });

  it('live catalog: every public RLS table has relforcerowsecurity when DATABASE_URL is set', () => {
    const unforced = queryLiveUnforcedRlsTables();
    if (unforced === null) return;

    expect(
      unforced,
      unforced.length
        ? `public tables with RLS enabled but not forced: ${unforced.join(', ')}`
        : undefined,
    ).toEqual([]);
  });
});
