/**
 * W1-DATA-11 — runtime must not see or mutate migration ledgers; platform
 * catalogs are SELECT/INSERT only; catalog sync must not leave unauthorized
 * privileges on classified tables.
 *
 * Requires DATABASE_URL as proctira_app against a DB that applied through 076
 * + apply-runtime-table-privileges sync.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'runtime-global-privs.live.test' });

const GLOBAL_CATALOGS = [
  'insights_ui_templates',
  'insights_ui_indicators',
  'insights_ui_geo_features',
] as const;

const APPEND_ONLY = [
  'fee_ledger_entries',
  'audit_log_entries',
  'workflow_transition_audit',
  'transcript_issuances',
  'audit_log_archive',
  'enrollment_history',
  'grade_change_audit',
] as const;

function loadCatalogClasses(): Record<string, string> {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../../../../');
  const raw = JSON.parse(
    readFileSync(join(root, 'db/runtime-table-privileges.json'), 'utf8'),
  ) as { tables: Record<string, string> };
  return raw.tables;
}

describe.skipIf(!DATABASE_URL)('W1-DATA-11 runtime global privileges (live)', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('DATABASE_URL connects as non-owner proctira_app', async () => {
    const { rows } = await pool.query<{ current_user: string; rolsuper: boolean }>(`
      SELECT
        current_user,
        (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS rolsuper
    `);
    expect(rows[0]!.current_user).toBe('proctira_app');
    expect(rows[0]!.rolsuper).toBe(false);
  });

  it('runtime cannot SELECT or DML schema_migrations', async () => {
    await expect(pool.query(`SELECT filename FROM schema_migrations LIMIT 1`)).rejects.toThrow(
      /permission denied/i,
    );
    await expect(
      pool.query(
        `INSERT INTO schema_migrations (filename) VALUES ('w1-data-11-should-fail.sql')`,
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      pool.query(`UPDATE schema_migrations SET checksum = 'forged' WHERE false`),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      pool.query(`DELETE FROM schema_migrations WHERE false`),
    ).rejects.toThrow(/permission denied/i);
  });

  it('runtime cannot SELECT _prisma_migrations when the table exists', async () => {
    const { rows } = await pool.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = '_prisma_migrations' AND c.relkind = 'r'
      ) AS exists
    `);
    if (!rows[0]!.exists) return;
    await expect(
      pool.query(`SELECT migration_name FROM _prisma_migrations LIMIT 1`),
    ).rejects.toThrow(/permission denied/i);
  });

  it('runtime may SELECT/INSERT platform catalogs but not UPDATE/DELETE', async () => {
    for (const table of GLOBAL_CATALOGS) {
      const { rows: present } = await pool.query<{ exists: boolean }>(
        `SELECT to_regclass($1) IS NOT NULL AS exists`,
        [`public.${table}`],
      );
      if (!present[0]!.exists) continue;

      await expect(pool.query(`SELECT 1 FROM ${table} LIMIT 1`)).resolves.toBeTruthy();

      await expect(
        pool.query(`UPDATE ${table} SET name = name WHERE false`),
      ).rejects.toThrow(/permission denied/i);
      await expect(pool.query(`DELETE FROM ${table} WHERE false`)).rejects.toThrow(
        /permission denied/i,
      );
    }

    // INSERT remains allowed for catalog seed / createTemplate paths.
    // Prove INSERT in a rolled-back transaction so no durable cleanup is needed.
    const id = `w1-data-11-${randomUUID().slice(0, 8)}`;
    const { rows: tplExists } = await pool.query<{ exists: boolean }>(
      `SELECT to_regclass('public.insights_ui_templates') IS NOT NULL AS exists`,
    );
    if (!tplExists[0]!.exists) return;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await expect(
        client.query(
          `INSERT INTO insights_ui_templates (id, name, description, module)
           VALUES ($1, 'W1-DATA-11 probe', '', 'test')`,
          [id],
        ),
      ).resolves.toBeTruthy();
      await expect(
        client.query(`DELETE FROM insights_ui_templates WHERE id = $1`, [id]),
      ).rejects.toThrow(/permission denied/i);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('catalog gate: no unauthorized privilege on denied/select_insert/append_only tables', async () => {
    const classes = loadCatalogClasses();
    const { rows } = await pool.query<{
      table_name: string;
      privilege_type: string;
    }>(`
      SELECT
        c.relname AS table_name,
        acl.privilege_type
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
      JOIN pg_roles r ON r.oid = acl.grantee
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND r.rolname = 'proctira_app'
      ORDER BY 1, 2
    `);

    const allowed = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
    const unauthorized: string[] = [];
    for (const row of rows) {
      const cls = classes[row.table_name];
      if (!cls) {
        unauthorized.push(`${row.table_name}:${row.privilege_type} (unclassified)`);
        continue;
      }
      if (!allowed.has(row.privilege_type)) continue;
      if (cls === 'denied') {
        unauthorized.push(`${row.table_name}:${row.privilege_type} (denied)`);
      } else if (
        (cls === 'select_insert' || cls === 'append_only') &&
        (row.privilege_type === 'UPDATE' || row.privilege_type === 'DELETE')
      ) {
        unauthorized.push(`${row.table_name}:${row.privilege_type} (${cls})`);
      }
    }
    expect(unauthorized, unauthorized.join(', ')).toEqual([]);

    for (const table of [...GLOBAL_CATALOGS, ...APPEND_ONLY]) {
      expect(classes[table] === 'select_insert' || classes[table] === 'append_only').toBe(
        true,
      );
    }
  });
});
