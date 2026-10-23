/**
 * PRC-M525 — live-PG failing-first proof. Two real concurrent
 * `AcademicCalendarService.rollover()` calls (no idempotency key) against
 * the same source/target period must not both create the same class row.
 * Before the fix (writes outside a transaction) a race can duplicate rows;
 * after the fix (writes inside one Serializable transaction with
 * retry-on-conflict), exactly one survives per classKey and any serialization
 * failure the loser hits is retried until it succeeds.
 *
 * Skips cleanly when DATABASE_URL is unset — the concurrency guarantee is
 * unproven until this runs against a real, migrated Postgres instance.
 */
import { randomUUID } from 'node:crypto';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';

import { createPrismaClient, getSharedPgPool, withPgTenant } from '@proctira/database';
import { afterAll, describe, expect, it } from 'vitest';

import { AcademicPeriodService } from '../academic-period/academic-period-service.js';
import { createTenantBoundPrisma } from '../tenant-bound-prisma.js';
import { tenantContext } from '../tenant-context.js';

import { AcademicCalendarService } from './calendar-service.js';
import { PgCalendarStore } from './calendar-store.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'rollover-concurrency.pg.test' });

describe.skipIf(!DATABASE_URL)('PRC-M525 rollover concurrency (live Postgres)', () => {
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
    await withTenant(() =>
      createTenantBoundPrisma(prisma).academicPeriod.deleteMany({ where: { tenantId } }),
    );
    await withPgTenant(pool!, tenantId, async (client) => {
      await client.query(`DELETE FROM institutions WHERE tenant_id = $1`, [tenantId]);
      await client.query(`DELETE FROM geographic_areas WHERE tenant_id = $1`, [tenantId]);
    });
    await prisma.$disconnect();
  });

  it('two concurrent rollover() calls create exactly one class per classKey', async () => {
    expect(pool).not.toBeNull();
    await withPgTenant(pool!, tenantId, async (client) => {
      await client.query(
        `INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
        [tenantId, `rollover-${tenantId.slice(0, 8)}`, `rollover-${tenantId}`],
      );
    });

    const tenantBoundPrisma = createTenantBoundPrisma(prisma!);
    const periodService = new AcademicPeriodService({ prisma: tenantBoundPrisma });
    const institutionId = randomUUID();
    const areaId = randomUUID();
    await withPgTenant(pool!, tenantId, async (client) => {
      await client.query(
        `INSERT INTO geographic_areas
           (id, tenant_id, name, code, level, parent_id, path, lft, rgt)
         VALUES ($1, $2, $3, $4, 1, NULL, $5, 1, 2)
         ON CONFLICT (id) DO NOTHING`,
        [areaId, tenantId, 'Rollover District', `AREA-${areaId.slice(0, 8)}`, `/${areaId}`],
      );
      await client.query(
        `INSERT INTO institutions
           (id, tenant_id, name, code, area_id, type, sector, ownership, status)
         VALUES ($1, $2, $3, $4, $5, 'primary', 'public', 'government', 'active')
         ON CONFLICT (id) DO NOTHING`,
        [institutionId, tenantId, 'Rollover School', `RSCH-${institutionId.slice(0, 8)}`, areaId],
      );
    });

    const source = await withTenant(() =>
      periodService.create(tenantId, {
        name: 'Rollover Source',
        code: `RSRC-${Date.now().toString(36)}`,
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      }),
    );
    const target = await withTenant(() =>
      periodService.create(tenantId, {
        name: 'Rollover Target',
        code: `RTGT-${Date.now().toString(36)}`,
        startDate: '2027-01-01',
        endDate: '2027-12-31',
      }),
    );
    const grade = await withTenant(
      () =>
        tenantBoundPrisma.grade.create({
          data: { tenantId, name: 'Grade 1', code: `G1-${Date.now().toString(36)}`, order: 1 },
        }) as unknown as Promise<{ id: string }>,
    );
    await withTenant(
      () =>
        tenantBoundPrisma.class.create({
          data: {
            tenantId,
            institutionId,
            gradeId: grade.id,
            academicPeriodId: source.id,
            name: '1-A',
          },
        }) as unknown as Promise<unknown>,
    );

    // Two independent service instances (own tenant-bound Prisma client),
    // each running its own serializable transaction, racing the same
    // source→target rollover concurrently.
    const serviceA = new AcademicCalendarService({
      prisma: createTenantBoundPrisma(createPrismaClient({ datasourceUrl: DATABASE_URL })),
      store: new PgCalendarStore(pool! as never),
    });
    const serviceB = new AcademicCalendarService({
      prisma: createTenantBoundPrisma(createPrismaClient({ datasourceUrl: DATABASE_URL })),
      store: new PgCalendarStore(pool! as never),
    });

    const runRollover = (service: AcademicCalendarService) =>
      withTenant(() =>
        service.rollover(
          tenantId,
          source.id,
          { targetPeriodId: target.id, dryRun: false },
          'actor-race',
        ),
      );

    const results = await Promise.allSettled([runRollover(serviceA), runRollover(serviceB)]);
    // At least one of the two concurrent runs must succeed (the other may
    // retry-and-succeed too, since both reconcile via the same classKey
    // dedup check inside the transaction, or may legitimately see 0 new
    // classes to create on its own serialized view).
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected.length).toBeLessThan(2);

    const survivingClasses = await withTenant(
      () =>
        tenantBoundPrisma.class.findMany({
          where: { tenantId, academicPeriodId: target.id, name: '1-A' },
        }) as unknown as Promise<unknown[]>,
    );
    // Exactly one '1-A' class survives in the target period — the race did
    // not duplicate it.
    expect(survivingClasses).toHaveLength(1);
  });
});
