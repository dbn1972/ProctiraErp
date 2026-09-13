/**
 * W1-OPS-06 — live Postgres RLS release gate.
 *
 * Static raw-SQL contract tests (src/unit/raw-sql-rls.test.ts) read migration
 * files from disk; this suite proves RLS is enforced by the engine against a
 * migrated database. Skips locally when DATABASE_URL is unset; CI must
 * provision Postgres and set DATABASE_URL (see ci.yml → tenant-isolation).
 */
import { randomUUID } from 'node:crypto';

import { withPgTenant } from '@proctira/database';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DATABASE_URL = process.env['DATABASE_URL']?.trim();

describe.skipIf(!DATABASE_URL)('Live Postgres RLS (W1-OPS-06 release gate)', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('connects as NOSUPERUSER NOBYPASSRLS (production RLS posture)', async () => {
    const { rows } = await pool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(`
      SELECT rolsuper, rolbypassrls
      FROM pg_roles
      WHERE rolname = current_user
    `);
    const role = rows[0]!;
    expect(role.rolsuper, 'CI must not connect as a superuser').toBe(false);
    expect(role.rolbypassrls, 'CI must not connect with BYPASSRLS').toBe(false);
  });

  it('every public tenant_id table has ENABLE + FORCE RLS and at least one policy', async () => {
    const { rows } = await pool.query<{ table_name: string }>(`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND EXISTS (
          SELECT 1
          FROM pg_attribute a
          WHERE a.attrelid = c.oid
            AND a.attname = 'tenant_id'
            AND NOT a.attisdropped
        )
        AND (
          NOT c.relrowsecurity
          OR NOT c.relforcerowsecurity
          OR NOT EXISTS (
            SELECT 1
            FROM pg_policies p
            WHERE p.schemaname = n.nspname
              AND p.tablename = c.relname
          )
        )
      ORDER BY 1
    `);
    expect(
      rows,
      rows.length > 0
        ? `RLS catalog offenders (missing ENABLE/FORCE/policy): ${rows.map((r) => r.table_name).join(', ')}`
        : undefined,
    ).toHaveLength(0);
  });

  it('cross-tenant rows are invisible when app.tenant_id is bound (hostels smoke)', async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const hostelId = randomUUID();
    const code = `w1ops06-${hostelId.slice(0, 8)}`;

    await withPgTenant(pool, tenantA, async (client) => {
      await client.query(
        `INSERT INTO hostels (id, tenant_id, name, code, capacity, status)
         VALUES ($1::uuid, $2::uuid, 'Gate A', $3, 10, 'active')`,
        [hostelId, tenantA, code],
      );
    });

    const seenByA = await withPgTenant(pool, tenantA, async (client) => {
      const result = await client.query<{ id: string }>(
        `SELECT id::text FROM hostels WHERE id = $1::uuid`,
        [hostelId],
      );
      return result.rows;
    });
    expect(seenByA).toHaveLength(1);

    const seenByB = await withPgTenant(pool, tenantB, async (client) => {
      const result = await client.query<{ id: string }>(
        `SELECT id::text FROM hostels WHERE id = $1::uuid`,
        [hostelId],
      );
      return result.rows;
    });
    expect(seenByB).toHaveLength(0);

    const unscoped = await pool.query(`SELECT id::text FROM hostels WHERE id = $1::uuid`, [
      hostelId,
    ]);
    expect(unscoped.rowCount).toBe(0);

    await withPgTenant(pool, tenantA, async (client) => {
      await client.query(`DELETE FROM hostels WHERE id = $1::uuid`, [hostelId]);
    });
  });
});
