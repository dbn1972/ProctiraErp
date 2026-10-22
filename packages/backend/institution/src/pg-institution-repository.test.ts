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
import { createInstitutionRepository, isPgInstitutionEnabled } from './repository-factory.js';

const created: Array<{ id: string; tenantId: string; areaId: string }> = [];

async function seedTenantAndArea(tenantId: string, areaId: string): Promise<void> {
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
      await Promise.all([seedTenantAndArea(tenantA, areaA), seedTenantAndArea(tenantB, areaB)]);

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

  // PRC-M288: update() must preserve non-profile custom_data keys (e.g. a
  // tenant-set `boardCode`) instead of clobbering them with only the profile
  // envelope. Failing-first: the raw-SQL-set key disappears before the fix.
  it.skipIf(!isPgInstitutionEnabled())(
    'preserves non-profile custom_data keys across update (PRC-M288)',
    async () => {
      const repo = createInstitutionRepository();
      const tenantId = randomUUID();
      const areaId = randomUUID();
      await seedTenantAndArea(tenantId, areaId);

      const institutionId = randomUUID();
      await repo.create({
        id: institutionId,
        tenantId,
        name: 'M288 School',
        code: `SCH-${institutionId.slice(0, 8)}`,
        areaId,
        typeId: 'primary',
        sectorId: 'public',
        ownershipId: 'government',
        status: 'ACTIVE',
        latitude: null,
        longitude: null,
        address: null,
        contactPhone: null,
        contactEmail: null,
        deactivationReason: null,
      });
      created.push({ id: institutionId, tenantId, areaId });

      const pool = getSharedPgPool();
      expect(pool).not.toBeNull();
      // Simulate a tenant-set custom_data key alongside the existing profile
      // envelope (as a tenant-specific extension would write it).
      await withPgTenant(pool!, tenantId, async (client) => {
        await client.query(
          `UPDATE institutions
             SET custom_data = custom_data || '{"boardCode": "ICSE"}'::jsonb
           WHERE id = $1 AND tenant_id = $2`,
          [institutionId, tenantId],
        );
      });

      await repo.update(institutionId, tenantId, { name: 'M288 School Renamed' });

      const { rows } = await withPgTenant(pool!, tenantId, (client) =>
        client.query(`SELECT custom_data FROM institutions WHERE id = $1 AND tenant_id = $2`, [
          institutionId,
          tenantId,
        ]),
      );
      const customData = rows[0]?.custom_data as Record<string, unknown>;
      expect(customData?.boardCode).toBe('ICSE');
    },
  );

  // PRC-L127: once a row is soft-deleted (deleted_at set), its (tenant_id,
  // code) slot must free up for re-use — a plain unique constraint on
  // (tenant_id, code) blocks a legitimate re-create with the same code even
  // though the old row is no longer "live". No app path sets deleted_at on
  // institutions today, so this simulates a future soft-delete directly via
  // raw SQL to prove the DB-level guard.
  it.skipIf(!isPgInstitutionEnabled())(
    'allows re-using a code after the prior row is soft-deleted (PRC-L127)',
    async () => {
      const repo = createInstitutionRepository();
      const tenantId = randomUUID();
      const areaId = randomUUID();
      await seedTenantAndArea(tenantId, areaId);
      const code = `SOFT-DEL-${randomUUID().slice(0, 8)}`;

      const firstId = randomUUID();
      await repo.create({
        id: firstId,
        tenantId,
        name: 'First Institution',
        code,
        areaId,
        typeId: 'primary',
        sectorId: 'public',
        ownershipId: 'government',
        status: 'ACTIVE',
        latitude: null,
        longitude: null,
        address: null,
        contactPhone: null,
        contactEmail: null,
        deactivationReason: null,
      });
      created.push({ id: firstId, tenantId, areaId });

      const pool = getSharedPgPool();
      expect(pool).not.toBeNull();
      // Simulate a future soft-delete directly (no app path does this yet).
      await withPgTenant(pool!, tenantId, async (client) => {
        await client.query(
          `UPDATE institutions SET deleted_at = now() WHERE id = $1 AND tenant_id = $2`,
          [firstId, tenantId],
        );
      });

      // A separate area so this row's cleanup (which deletes its own
      // geographic_areas row) cannot race the still-physically-present
      // (soft-deleted, not hard-deleted) first row's FK to the shared area.
      const secondAreaId = randomUUID();
      await seedTenantAndArea(tenantId, secondAreaId);
      const secondId = randomUUID();
      // Before the migration: this throws P2002/23505 (blocked — the plain
      // unique constraint still occupies the (tenant_id, code) slot). After
      // the migration: it succeeds (the partial unique index excludes the
      // soft-deleted row).
      await repo.create({
        id: secondId,
        tenantId,
        name: 'Second Institution (same code, reused after soft-delete)',
        code,
        areaId: secondAreaId,
        typeId: 'primary',
        sectorId: 'public',
        ownershipId: 'government',
        status: 'ACTIVE',
        latitude: null,
        longitude: null,
        address: null,
        contactPhone: null,
        contactEmail: null,
        deactivationReason: null,
      });
      created.push({ id: secondId, tenantId, areaId: secondAreaId });

      const found = await repo.findById(secondId, tenantId);
      expect(found?.code).toBe(code);
    },
  );
});
