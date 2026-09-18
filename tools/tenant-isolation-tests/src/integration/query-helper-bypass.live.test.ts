/**
 * W1-DATA-13 COMPLETE — live cross-tenant denial backed by RLS + withPgTenant.
 *
 * Proves that tenant-data queries routed through the approved helper
 * (`withPgTenant`) isolate correctly, and that unbound `pool.query` cannot
 * read tenant rows (FORCE RLS deny). Skips when DATABASE_URL is unset.
 */
import { randomUUID } from 'node:crypto';

import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { withPgTenant } from '@proctira/database';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DATABASE_URL = requireLiveDatabaseUrl({
  suite: 'query-helper-bypass.live.test',
});
// APPLY_STRICT_FKS=1 guarantees this parent row through migration 021a/082.
const STRICT_FK_DEMO_TENANT_ID = '00000000-0000-4000-8000-000000000001';

describe.skipIf(!DATABASE_URL)('W1-DATA-13 live cross-tenant denial (query helpers)', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('withPgTenant isolates hostels; unbound pool.query returns zero rows', async () => {
    const tenantA = STRICT_FK_DEMO_TENANT_ID;
    const tenantB = randomUUID();
    const hostelId = randomUUID();
    const code = `w1d13-${hostelId.slice(0, 8)}`;

    await withPgTenant(pool, tenantA, async (client) => {
      await client.query(
        `INSERT INTO hostels (id, tenant_id, name, code, capacity, status)
         VALUES ($1::uuid, $2::uuid, 'DATA-13 A', $3, 10, 'active')`,
        [hostelId, tenantA, code],
      );
    });

    const seenByA = await withPgTenant(pool, tenantA, async (client) => {
      const result = await client.query(`SELECT id::text FROM hostels WHERE id = $1::uuid`, [
        hostelId,
      ]);
      return result.rows as Array<{ id: string }>;
    });
    expect(seenByA).toHaveLength(1);

    const seenByB = await withPgTenant(pool, tenantB, async (client) => {
      const result = await client.query(`SELECT id::text FROM hostels WHERE id = $1::uuid`, [
        hostelId,
      ]);
      return result.rows as Array<{ id: string }>;
    });
    expect(seenByB).toHaveLength(0);

    // Unbound pool.query must not bypass RLS (the residual W1-DATA-13 defect).
    const unscoped = await pool.query(`SELECT id::text FROM hostels WHERE id = $1::uuid`, [
      hostelId,
    ]);
    expect(unscoped.rowCount).toBe(0);

    await withPgTenant(pool, tenantA, async (client) => {
      await client.query(`DELETE FROM hostels WHERE id = $1::uuid`, [hostelId]);
    });
  });

  it('withPgTenant isolates LMS modules; unbound pool.query returns zero rows', async () => {
    const { rows: tableRows } = await pool.query<{ exists: boolean }>(
      `SELECT to_regclass('public.lms_modules') IS NOT NULL AS exists`,
    );
    if (!tableRows[0]?.exists) {
      // Schema not applied in this environment — skip without failing the gate.
      return;
    }

    const tenantA = STRICT_FK_DEMO_TENANT_ID;
    const tenantB = randomUUID();
    const moduleId = randomUUID();

    await withPgTenant(pool, tenantA, async (client) => {
      await client.query(
        `INSERT INTO lms_modules (id, tenant_id, title, position, published)
         VALUES ($1::uuid, $2::uuid, 'DATA-13 module', 0, false)`,
        [moduleId, tenantA],
      );
    });

    const seenByA = await withPgTenant(pool, tenantA, async (client) => {
      const result = await client.query(`SELECT id::text FROM lms_modules WHERE id = $1::uuid`, [
        moduleId,
      ]);
      return result.rows as Array<{ id: string }>;
    });
    expect(seenByA).toHaveLength(1);

    const seenByB = await withPgTenant(pool, tenantB, async (client) => {
      const result = await client.query(`SELECT id::text FROM lms_modules WHERE id = $1::uuid`, [
        moduleId,
      ]);
      return result.rows as Array<{ id: string }>;
    });
    expect(seenByB).toHaveLength(0);

    const unscoped = await pool.query(`SELECT id::text FROM lms_modules WHERE id = $1::uuid`, [
      moduleId,
    ]);
    expect(unscoped.rowCount).toBe(0);

    await withPgTenant(pool, tenantA, async (client) => {
      await client.query(`DELETE FROM lms_modules WHERE id = $1::uuid`, [moduleId]);
    });
  });
});
