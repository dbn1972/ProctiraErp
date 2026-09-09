/**
 * G-812 — Postgres smoke for institution repository (create → findById → cross-tenant RLS).
 *
 * Skips cleanly when DATABASE_URL is unset. Requires a migrated DB
 * (institutions + tenants + geographic_areas FK).
 */
import { randomUUID } from 'node:crypto';

import { getSharedPgPool, withPgTenant } from '@proctira/database';
import { afterEach, describe, expect, it } from 'vitest';

import { InMemoryInstitutionRepository } from './in-memory-repository.js';
import { PrismaInstitutionRepository } from './prisma-institution-repository.js';
import {
  createInstitutionRepository,
  isPgInstitutionEnabled,
} from './repository-factory.js';

const created: Array<{ id: string; tenantId: string; areaId: string }> = [];

async function seedTenantAndArea(
  tenantId: string,
  areaId: string,
): Promise<void> {
  const pool = getSharedPgPool();
  expect(pool).not.toBeNull();
  await withPgTenant(pool!, tenantId, async (client) => {
    await client.query(
      `INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [tenantId, `inst-${tenantId.slice(0, 8)}`, `inst-${tenantId}`],
    );
    await client.query(
      `INSERT INTO geographic_areas
         (id, tenant_id, name, code, level, parent_id, path, lft, rgt)
       VALUES ($1, $2, $3, $4, 1, NULL, $5, 1, 2)
       ON CONFLICT (id) DO NOTHING`,
      [areaId, tenantId, 'Smoke District', `AREA-${areaId.slice(0, 8)}`, `/${areaId}`],
    );
  });
}

async function cleanupInstitution(row: {
  id: string;
  tenantId: string;
  areaId: string;
}): Promise<void> {
  const pool = getSharedPgPool();
  if (!pool) return;
  await withPgTenant(pool, row.tenantId, async (client) => {
    await client.query(`DELETE FROM institutions WHERE id = $1 AND tenant_id = $2`, [
      row.id,
      row.tenantId,
    ]);
    await client.query(`DELETE FROM geographic_areas WHERE id = $1 AND tenant_id = $2`, [
      row.areaId,
      row.tenantId,
    ]);
  });
}

describe('createInstitutionRepository', () => {
  it('falls back to in-memory when DATABASE_URL is unset', () => {
    const prev = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(isPgInstitutionEnabled()).toBe(false);
      expect(createInstitutionRepository()).toBeInstanceOf(InMemoryInstitutionRepository);
    } finally {
      if (prev !== undefined) process.env.DATABASE_URL = prev;
      else delete process.env.DATABASE_URL;
    }
  });

  it.skipIf(!isPgInstitutionEnabled())(
    'returns PrismaInstitutionRepository when DATABASE_URL is set',
    () => {
      expect(createInstitutionRepository()).toBeInstanceOf(PrismaInstitutionRepository);
    },
  );
});

describe('PgInstitutionRepository', () => {
  afterEach(async () => {
    if (!isPgInstitutionEnabled() || created.length === 0) return;
    while (created.length > 0) {
      await cleanupInstitution(created.pop()!);
    }
  });

  it.skipIf(!isPgInstitutionEnabled())(
    'creates, finds by id in-tenant, and denies cross-tenant reads',
    async () => {
      const repo = createInstitutionRepository();
      const tenantA = randomUUID();
      const tenantB = randomUUID();
      const areaA = randomUUID();
      const areaB = randomUUID();
      await Promise.all([
        seedTenantAndArea(tenantA, areaA),
        seedTenantAndArea(tenantB, areaB),
      ]);

      const institutionId = randomUUID();
      const createdInst = await repo.create({
        id: institutionId,
        tenantId: tenantA,
        name: 'G812 Smoke School',
        code: `SCH-${institutionId.slice(0, 8)}`,
        areaId: areaA,
        typeId: 'primary',
        sectorId: 'public',
        ownershipId: 'government',
        status: 'ACTIVE',
        latitude: null,
        longitude: null,
        address: '1 Smoke Lane',
        contactPhone: null,
        contactEmail: null,
        deactivationReason: null,
      });
      created.push({ id: institutionId, tenantId: tenantA, areaId: areaA });

      expect(createdInst.id).toBe(institutionId);
      expect(createdInst.name).toBe('G812 Smoke School');
      expect(createdInst.address).toBe('1 Smoke Lane');

      const found = await repo.findById(institutionId, tenantA);
      expect(found).not.toBeNull();
      expect(found?.code).toBe(createdInst.code);

      expect(await repo.findById(institutionId, tenantB)).toBeNull();
      const otherList = await repo.list(tenantB, {}, { page: 1, pageSize: 20 });
      expect(otherList.data).toHaveLength(0);
      expect(otherList.meta.totalItems).toBe(0);
    },
  );
});
