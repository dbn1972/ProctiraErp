/**
 * W1-DATA-11 — runtime role must not see or mutate global control ledgers.
 *
 * After 072: proctira_app has no privileges on schema_migrations /
 * _prisma_migrations (SELECT and DML denied). Migrator retains ownership.
 */
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = requireLiveDatabaseUrl({
  suite: 'control-ledger-privileges.live.test',
});

const CONTROL_LEDGERS = ['schema_migrations', '_prisma_migrations'] as const;

describe.skipIf(!DATABASE_URL)('W1-DATA-11 control ledger privileges (live)', () => {
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

  it('catalog privileges deny SELECT/INSERT/UPDATE/DELETE on control ledgers', async () => {
    for (const table of CONTROL_LEDGERS) {
      const { rows: existsRows } = await pool.query<{ exists: boolean }>(
        `SELECT to_regclass($1) IS NOT NULL AS exists`,
        [`public.${table}`],
      );
      if (!existsRows[0]?.exists) {
        // Prisma ledger may be absent if only domain SQL was applied.
        continue;
      }

      const { rows } = await pool.query<{
        can_select: boolean;
        can_insert: boolean;
        can_update: boolean;
        can_delete: boolean;
      }>(
        `
        SELECT
          has_table_privilege(current_user, $1, 'SELECT') AS can_select,
          has_table_privilege(current_user, $1, 'INSERT') AS can_insert,
          has_table_privilege(current_user, $1, 'UPDATE') AS can_update,
          has_table_privilege(current_user, $1, 'DELETE') AS can_delete
        `,
        [`public.${table}`],
      );

      const row = rows[0]!;
      expect(row.can_select, `${table} SELECT`).toBe(false);
      expect(row.can_insert, `${table} INSERT`).toBe(false);
      expect(row.can_update, `${table} UPDATE`).toBe(false);
      expect(row.can_delete, `${table} DELETE`).toBe(false);
    }
  });

  it('runtime SELECT/INSERT on schema_migrations are denied', async () => {
    const { rows: existsRows } = await pool.query<{ exists: boolean }>(
      `SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists`,
    );
    expect(existsRows[0]?.exists, 'schema_migrations must exist after apply-sql').toBe(
      true,
    );

    await expect(pool.query(`SELECT count(*) FROM schema_migrations`)).rejects.toThrow(
      /permission denied/i,
    );
    await expect(
      pool.query(
        `INSERT INTO schema_migrations (filename) VALUES ('w1-data-11-should-fail.sql')`,
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});
