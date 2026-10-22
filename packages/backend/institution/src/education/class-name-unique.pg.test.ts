/**
 * PRC-M285 — live-PG failing-first proof for the DB-level duplicate-class
 * guard. The app-level check added to `ClassService.create()` closes the
 * normal path, but a true race (two concurrent inserts that both pass the
 * app-level check before either writes) can still land two rows in the same
 * `(tenant_id, institution_id, grade_id, academic_period_id, name)` slot
 * unless the database itself rejects it. This bypasses the app-level check
 * deliberately (two concurrent raw `tx.class.create()` calls) to prove the
 * partial unique index in `253_institution_class_name_unique.sql` is what
 * actually closes the race, not just the app-level check.
 *
 * Skips cleanly when DATABASE_URL is unset — the migration's effect is
 * unproven until this runs against a real, migrated Postgres instance.
 */
import { randomUUID } from 'node:crypto';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';

import { createPrismaClient, getSharedPgPool, withPgTenant } from '@proctira/database';
import { afterAll, describe, expect, it } from 'vitest';

import { createTenantBoundPrisma } from '../tenant-bound-prisma.js';
import { tenantContext } from '../tenant-context.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'class-name-unique.pg.test' });

describe.skipIf(!DATABASE_URL)('PRC-M285 class-name DB uniqueness (live Postgres)', () => {
  const prisma = DATABASE_URL ? createPrismaClient({ datasourceUrl: DATABASE_URL }) : null;
  const pool = DATABASE_URL ? getSharedPgPool(DATABASE_URL) : null;
  const tenantId = randomUUID();

  function withTenant<T>(fn: () => Promise<T>): Promise<T> {
    return tenantContext.run({ tenantId }, fn);
  }

  afterAll(async () => {
    if (!prisma) return;
    await withTenant(() =>
      createTenantBoundPrisma(prisma).class.deleteMany({ where: { tenantId } }),
    );
    await withPgTenant(pool!, tenantId, async (client) => {
      await client.query(`DELETE FROM institutions WHERE tenant_id = $1`, [tenantId]);
      await client.query(`DELETE FROM geographic_areas WHERE tenant_id = $1`, [tenantId]);
    });
    await prisma.$disconnect();
  });

  it('two concurrent raw creates for the same (institution, grade, period, name) slot: exactly one wins', async () => {
    expect(pool).not.toBeNull();
    await withPgTenant(pool!, tenantId, async (client) => {
      await client.query(
        `INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
        [tenantId, `classdup-${tenantId.slice(0, 8)}`, `classdup-${tenantId}`],
      );
    });

    const tenantBoundPrisma = createTenantBoundPrisma(prisma!);
    const institutionId = randomUUID();
    const areaId = randomUUID();
    await withPgTenant(pool!, tenantId, async (client) => {
      await client.query(
        `INSERT INTO geographic_areas
           (id, tenant_id, name, code, level, parent_id, path, lft, rgt)
         VALUES ($1, $2, $3, $4, 1, NULL, $5, 1, 2)
         ON CONFLICT (id) DO NOTHING`,
        [areaId, tenantId, 'Dup District', `AREA-${areaId.slice(0, 8)}`, `/${areaId}`],
      );
      await client.query(
        `INSERT INTO institutions
           (id, tenant_id, name, code, area_id, type, sector, ownership, status)
         VALUES ($1, $2, $3, $4, $5, 'primary', 'public', 'government', 'active')
         ON CONFLICT (id) DO NOTHING`,
        [institutionId, tenantId, 'Dup School', `DSCH-${institutionId.slice(0, 8)}`, areaId],
      );
    });
    const grade = await withTenant(
      () =>
        tenantBoundPrisma.grade.create({
          data: { tenantId, name: 'Grade 1', code: `G1-${Date.now().toString(36)}`, order: 1 },
        }) as unknown as Promise<{ id: string }>,
    );
    const period = await withTenant(
      () =>
        tenantBoundPrisma.academicPeriod.create({
          data: {
            tenantId,
            name: 'Dup Period',
            code: `DUP-${Date.now().toString(36)}`,
            startDate: new Date('2026-01-01'),
            endDate: new Date('2026-12-31'),
          },
        }) as unknown as Promise<{ id: string }>,
    );

    const createClass = () =>
      withTenant(
        () =>
          tenantBoundPrisma.class.create({
            data: {
              tenantId,
              institutionId,
              gradeId: grade.id,
              academicPeriodId: period.id,
              name: 'Section X',
            },
          }) as unknown as Promise<unknown>,
      );

    // Deliberately bypass the app-level check: two concurrent raw creates
    // for the identical slot. Before the migration both can succeed
    // (bug: DB allows true duplicates); after, exactly one does and the
    // other fails with a unique-violation (P2002 / 23505).
    const results = await Promise.allSettled([createClass(), createClass()]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const rejection = rejected[0] as PromiseRejectedResult;
    const code =
      (rejection.reason as { code?: unknown; meta?: { code?: unknown } } | undefined)?.code ??
      (rejection.reason as { meta?: { code?: unknown } } | undefined)?.meta?.code;
    expect(code === 'P2002' || code === '23505').toBe(true);

    const survivors = await withTenant(
      () =>
        tenantBoundPrisma.class.findMany({
          where: { tenantId, institutionId, gradeId: grade.id, academicPeriodId: period.id },
        }) as unknown as Promise<unknown[]>,
    );
    expect(survivors).toHaveLength(1);
  });
});
