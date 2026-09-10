/**
 * G-901 follow-up — live Postgres smoke proving the academics services write
 * under FORCE ROW LEVEL SECURITY through the tenant-bound Prisma client
 * (`POST /academic-periods` used to fail with 42501 because the services
 * never bound `app.tenant_id`; substituting the raw client here reproduces it).
 *
 * Skips cleanly when DATABASE_URL is unset.
 */
import { randomUUID } from 'node:crypto';

import { createPrismaClient, getSharedPgPool, withPgTenant } from '@proctira/database';
import { afterAll, describe, expect, it } from 'vitest';

import { AcademicPeriodService } from './academic-period/academic-period-service.js';
import { createTenantBoundPrisma } from './tenant-bound-prisma.js';
import { tenantContext } from './tenant-context.js';

const DATABASE_URL = process.env['DATABASE_URL']?.trim();

async function seedTenant(tenantId: string): Promise<void> {
  const pool = getSharedPgPool(DATABASE_URL);
  expect(pool).not.toBeNull();
  await withPgTenant(pool!, tenantId, async (client) => {
    await client.query(
      `INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [tenantId, `acad-${tenantId.slice(0, 8)}`, `acad-${tenantId}`],
    );
  });
}

describe.skipIf(!DATABASE_URL)('academics services under FORCE RLS (live Postgres)', () => {
  const prisma = DATABASE_URL ? createPrismaClient({ datasourceUrl: DATABASE_URL }) : null;
  const tenantA = randomUUID();
  const tenantB = randomUUID();

  function withTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return tenantContext.run({ tenantId }, fn);
  }

  afterAll(async () => {
    if (!prisma) return;
    await withTenant(tenantA, () =>
      createTenantBoundPrisma(prisma).academicPeriod.deleteMany({ where: { tenantId: tenantA } }),
    );
    await prisma.$disconnect();
  });

  it('creates and lists a period for the request tenant; other tenant sees nothing', async () => {
    await seedTenant(tenantA);
    await seedTenant(tenantB);
    const service = new AcademicPeriodService({ prisma: createTenantBoundPrisma(prisma!) });
    const code = `AY-${Date.now().toString(36)}`;

    const created = await withTenant(tenantA, () =>
      service.create(tenantA, {
        name: `Live ${code}`,
        code,
        startDate: '2026-04-01',
        endDate: '2027-03-31',
      }),
    );
    expect(created.code).toBe(code);

    const seenByA = await withTenant(tenantA, () => service.list(tenantA));
    expect(seenByA.map((p) => p.id)).toContain(created.id);

    const seenByB = await withTenant(tenantB, () => service.list(tenantB));
    expect(seenByB.map((p) => p.id)).not.toContain(created.id);
  });
});
