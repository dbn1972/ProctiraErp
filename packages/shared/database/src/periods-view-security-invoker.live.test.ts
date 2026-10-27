/**
 * PRC-L557 — the `periods` compatibility view (db/sql/003, over bell_periods) evaluates RLS
 * as the caller, on a real, migrated Postgres (runtime app role, RLS enforced).
 *
 * Without security_invoker a view reads its base table with the view OWNER's rights. With
 * the CI/production roles the owner (migrator) is NOBYPASSRLS and bell_periods is FORCE RLS,
 * so the tenant policy still applied; but any owner with BYPASSRLS (superuser restore, a
 * managed-service admin role) turned the view into a cross-tenant read. db/sql/273 sets
 * security_invoker = true so the view always applies the invoker's tenant policy.
 * (The BYPASSRLS-owner leak itself is shown manually in the lane verification note.)
 *
 * Fails closed when CI=true or REQUIRE_LIVE_TESTS=1 and DATABASE_URL is unset (W3-TEST-03).
 */
import { randomUUID } from 'node:crypto';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withPgTenant } from './pg-tenant.js';
import { ensurePgTestTenant } from './test-fixtures.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'periods-view-security-invoker.live.test' });

describe.skipIf(!DATABASE_URL)('PRC-L557 periods view security_invoker (live)', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  /** tenant -> area -> institution -> academic period -> bell schedule -> one bell period. */
  async function tenantWithPeriod(): Promise<{ tenantId: string; periodId: string }> {
    const tenantId = randomUUID();
    await ensurePgTestTenant(pool, tenantId);
    const areaId = randomUUID();
    const institutionId = randomUUID();
    const academicPeriodId = randomUUID();
    const scheduleId = randomUUID();
    const periodId = randomUUID();
    const suffix = tenantId.slice(0, 8);
    await withPgTenant(pool, tenantId, async (client) => {
      await client.query(
        `INSERT INTO geographic_areas (id, tenant_id, name, code, level, parent_id, path, lft, rgt)
         VALUES ($1, $2, 'Root', 'ROOT', 0, NULL, '/', 1, 2)`,
        [areaId, tenantId],
      );
      await client.query(
        `INSERT INTO institutions (id, tenant_id, name, code, area_id, type, sector, ownership)
         VALUES ($1, $2, 'Bell School', $3, $4, 'SCHOOL', 'PUBLIC', 'GOVERNMENT')`,
        [institutionId, tenantId, `BS-${suffix}`, areaId],
      );
      await client.query(
        `INSERT INTO academic_periods (id, tenant_id, name, code, start_date, end_date)
         VALUES ($1, $2, 'AY', $3, '2026-04-01', '2027-03-31')`,
        [academicPeriodId, tenantId, `AY-${suffix}`],
      );
      await client.query(
        `INSERT INTO bell_schedules (id, tenant_id, institution_id, academic_period_id, code, name)
         VALUES ($1, $2, $3, $4, 'STD', 'Standard')`,
        [scheduleId, tenantId, institutionId, academicPeriodId],
      );
      await client.query(
        `INSERT INTO bell_periods
           (id, tenant_id, bell_schedule_id, code, name, period_order, start_time, end_time)
         VALUES ($1, $2, $3, 'P1', 'Period 1', 1, '08:00', '08:45')`,
        [periodId, tenantId, scheduleId],
      );
    });
    return { tenantId, periodId };
  }

  it('the periods view is security_invoker', async () => {
    const res = await pool.query(
      `SELECT c.reloptions FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'periods' AND c.relkind = 'v'`,
    );
    expect(res.rows).toHaveLength(1);
    expect((res.rows[0] as { reloptions: string[] | null }).reloptions ?? []).toContain(
      'security_invoker=true',
    );
  });

  it('a tenant-bound runtime session sees only its own rows through the view', async () => {
    const a = await tenantWithPeriod();
    const b = await tenantWithPeriod();
    const seen = await withPgTenant(pool, a.tenantId, (client) =>
      client.query(`SELECT id, tenant_id FROM periods WHERE id = ANY($1::uuid[])`, [
        [a.periodId, b.periodId],
      ]),
    );
    expect(seen.rows).toEqual([{ id: a.periodId, tenant_id: a.tenantId }]);
  });
});
