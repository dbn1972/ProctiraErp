/**
 * Tenant data snapshots for "no state change" assertions: per tenant table a
 * row count and an order-independent digest of the rows, read as the
 * bootstrap superuser (sees every row regardless of RLS) in a READ ONLY
 * transaction. Volatile bookkeeping tables (audit, logs, outbox, sessions,
 * idempotency, rate limits, denials) are excluded by default.
 */
import { stackDbUrls } from '../stack/state.js';
import type { StackState } from '../stack/types.js';

import { ident, listTenantTables, withPg } from './pg.js';

export interface TableDigest {
  count: number;
  digest: string;
}

export interface TenantSnapshot {
  tenantId: string;
  takenAt: string;
  tables: Record<string, TableDigest>;
}

export const VOLATILE_TABLES: readonly RegExp[] = Object.freeze([
  /^audit/,
  /_audit/,
  /_logs?$/,
  /^logs?_/,
  /outbox/,
  /sessions?$/,
  /idempoten/,
  /rate_limit/,
  /denials?$/,
  /access_log/,
  /^control_plane_documents$/,
  /refresh_tokens?$/,
  /revocations?$/,
]);

export function isVolatile(table: string, exclude: readonly RegExp[] = VOLATILE_TABLES): boolean {
  return exclude.some((re) => re.test(table));
}

export async function snapshotTenant(
  s: StackState,
  tenantId: string,
  o: { tables?: string[]; exclude?: RegExp[] } = {},
): Promise<TenantSnapshot> {
  return withPg(stackDbUrls(s).bootstrap, async (c) => {
    await c.query('BEGIN READ ONLY');
    try {
      const all = o.tables ?? (await listTenantTables(c));
      const exclude = o.exclude ?? VOLATILE_TABLES;
      const tables: Record<string, TableDigest> = {};
      for (const table of all) {
        if (!o.tables && isVolatile(table, exclude)) continue;
        const t = ident(table);
        const r = await c.query<{ n: string; d: string | null }>(
          `SELECT count(*)::text AS n,
                  md5(coalesce(string_agg(h, '' ORDER BY h), '')) AS d
             FROM (SELECT md5(x::text) AS h FROM ${t} x WHERE x.tenant_id::text = $1) rows`,
          [tenantId],
        );
        const row = r.rows[0];
        tables[table] = { count: Number(row?.n ?? 0), digest: row?.d ?? '' };
      }
      return { tenantId, takenAt: new Date().toISOString(), tables };
    } finally {
      await c.query('ROLLBACK');
    }
  });
}

export function diffSnapshots(
  a: TenantSnapshot,
  b: TenantSnapshot,
): Array<{ table: string; before: TableDigest; after: TableDigest }> {
  const out: Array<{ table: string; before: TableDigest; after: TableDigest }> = [];
  const empty: TableDigest = { count: 0, digest: '' };
  for (const table of [...new Set([...Object.keys(a.tables), ...Object.keys(b.tables)])].sort()) {
    const before = a.tables[table] ?? empty;
    const after = b.tables[table] ?? empty;
    if (before.count !== after.count || before.digest !== after.digest)
      out.push({ table, before, after });
  }
  return out;
}
