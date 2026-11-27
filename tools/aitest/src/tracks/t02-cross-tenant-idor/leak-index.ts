/**
 * Builds the LeakIndex for a victim/attacker pair from the throwaway database
 * (bootstrap superuser, READ ONLY): every victim row id, every attacker row
 * id, and victim person names/emails that do not also occur in attacker data.
 * Also reports which tenant tables hold rows, so the state-change snapshots can
 * skip empty tables. Reads once per run; the suites reuse the result.
 */
import type { Client as PgClient } from 'pg';

import {
  ident,
  listTenantTablesWithId,
  stackDbUrls,
  withPg,
  TENANTS,
  type StackState,
  type TenantKey,
} from '../../foundation/index.js';

import type { LeakIndex } from './leak-detector.js';

const NAME_TABLES = ['students', 'staff', 'guardian_household_members'];
/**
 * A victim string must be distinctive. Single generic tokens (seed data uses
 * names like "Student", "LMS") appear in ordinary API vocabulary and error
 * messages, so we only keep composite "First Last" names (with a space) and
 * email addresses, each at least this long and absent from attacker data.
 */
const MIN_NAME_LEN = 6;

export interface LeakIndexResult {
  index: LeakIndex;
  /** Tenant tables (with an id column) that hold rows for the victim / attacker. */
  victimTables: string[];
  attackerTables: string[];
}

export async function buildLeakIndex(
  s: StackState,
  attacker: TenantKey,
  victim: TenantKey,
): Promise<LeakIndexResult> {
  const victimId = TENANTS[victim].id;
  const attackerId = TENANTS[attacker].id;
  return withPg(stackDbUrls(s).bootstrap, async (c) => {
    await c.query('BEGIN READ ONLY');
    try {
      const tables = await listTenantTablesWithId(c);
      const victimTables = new Set<string>();
      const attackerTables = new Set<string>();
      for (const table of tables) {
        const r = await c.query<{ tenant_id: string; n: number }>(
          `SELECT tenant_id::text, count(*)::int AS n FROM ${ident(table)}
            WHERE tenant_id::text = ANY($1) GROUP BY tenant_id`,
          [[victimId, attackerId]],
        );
        for (const row of r.rows) {
          if (row.n <= 0) continue;
          if (row.tenant_id === victimId) victimTables.add(table);
          else attackerTables.add(table);
        }
      }

      const victimNames = new Set<string>();
      const attackerNames = new Set<string>();
      for (const table of NAME_TABLES) {
        if (!tables.includes(table)) continue;
        const cols = await existingColumns(c, table, [
          'first_name',
          'last_name',
          'email',
          'contact_email',
        ]);
        const hasName = cols.includes('first_name') && cols.includes('last_name');
        const emailCols = cols.filter((x) => x === 'email' || x === 'contact_email');
        if (!hasName && emailCols.length === 0) continue;
        const parts: string[] = ['tenant_id::text AS tenant_id'];
        if (hasName)
          parts.push(`btrim(coalesce(first_name,'')||' '||coalesce(last_name,'')) AS full_name`);
        for (const e of emailCols) parts.push(`${ident(e)}::text AS ${ident(e)}`);
        const r = await c.query<Record<string, string | null>>(
          `SELECT ${parts.join(', ')} FROM ${ident(table)} WHERE tenant_id::text = ANY($1)`,
          [[victimId, attackerId]],
        );
        for (const row of r.rows) {
          const target = row['tenant_id'] === victimId ? victimNames : attackerNames;
          const full = row['full_name'];
          if (full && full.includes(' ') && full.trim().length >= MIN_NAME_LEN)
            target.add(full.trim());
          for (const e of emailCols) {
            const v = row[e];
            if (v && v.includes('@') && v.trim().length >= MIN_NAME_LEN) target.add(v.trim());
          }
        }
      }
      const victimStrings = [...victimNames].filter((n) => !attackerNames.has(n));
      const index: LeakIndex = {
        victimTenantId: victimId,
        victimSlug: TENANTS[victim].slug,
        attackerTenantId: attackerId,
        victimStrings,
      };
      return { index, victimTables: [...victimTables], attackerTables: [...attackerTables] };
    } finally {
      await c.query('ROLLBACK');
    }
  });
}

async function existingColumns(c: PgClient, table: string, cols: string[]): Promise<string[]> {
  const r = await c.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 AND column_name = ANY($2)`,
    [table, cols],
  );
  return r.rows.map((x) => x.column_name);
}
