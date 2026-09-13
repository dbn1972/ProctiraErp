/**
 * W1-DATA-01 — runtime must not connect as the table-owning role.
 *
 * PostgreSQL table owners bypass RLS unless FORCE ROW LEVEL SECURITY is set.
 * Connecting the app as the migrator/owner therefore fails open on any table
 * that has ENABLE RLS but not FORCE (e.g. academic_rollover_runs from 047).
 *
 * Production posture: migrator owns tables; DATABASE_URL uses proctira_app
 * (NOSUPERUSER NOBYPASSRLS, non-owner) so ENABLE RLS alone constrains reads.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = process.env['DATABASE_URL'];

describe.skipIf(!DATABASE_URL)('W1-DATA-01 app runtime role (live)', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('DATABASE_URL role is NOSUPERUSER NOBYPASSRLS and does not own academic_rollover_runs', async () => {
    const { rows } = await pool.query<{
      current_user: string;
      table_owner: string | null;
      rolsuper: boolean;
      rolbypassrls: boolean;
      table_exists: boolean;
    }>(`
      SELECT
        current_user,
        (SELECT r.rolsuper FROM pg_roles r WHERE r.rolname = current_user) AS rolsuper,
        (SELECT r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user) AS rolbypassrls,
        EXISTS (
          SELECT 1 FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = 'academic_rollover_runs' AND c.relkind = 'r'
        ) AS table_exists,
        (
          SELECT pg_get_userbyid(c.relowner)
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = 'academic_rollover_runs' AND c.relkind = 'r'
        ) AS table_owner
    `);

    const row = rows[0]!;
    expect(row.table_exists, 'academic_rollover_runs must exist (apply db/sql through 047+)').toBe(
      true,
    );
    expect(row.rolsuper).toBe(false);
    expect(row.rolbypassrls).toBe(false);
    expect(row.table_owner).toBeTruthy();
    expect(row.current_user).not.toBe(row.table_owner);
    expect(row.current_user).toBe('proctira_app');
  });

  it('ENABLE-without-FORCE tenant table hides cross-tenant rows for the runtime role', async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const idA = randomUUID();
    const idB = randomUUID();
    const period = randomUUID();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA]);
      await client.query(
        `INSERT INTO academic_rollover_runs (
           id, tenant_id, source_period_id, target_period_id, actor_id, status
         ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'w1-data-01', 'completed')`,
        [idA, tenantA, period, period],
      );

      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantB]);
      await client.query(
        `INSERT INTO academic_rollover_runs (
           id, tenant_id, source_period_id, target_period_id, actor_id, status
         ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'w1-data-01', 'completed')`,
        [idB, tenantB, period, period],
      );

      // Still bound to B: owner-without-FORCE would see both rows (count=2).
      const visible = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM academic_rollover_runs WHERE actor_id = 'w1-data-01'`,
      );
      expect(visible.rows[0]!.n).toBe('1');

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
