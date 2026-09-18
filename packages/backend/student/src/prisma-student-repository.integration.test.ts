/**
 * Integration test: PrismaStudentRepository under real PostgreSQL Row-Level Security.
 *
 * This is the test the existing suite was missing. Every other "tenant isolation"
 * test in the repo simulates `set_config` against a mock; none prove that isolation
 * actually holds through a *pooled* PrismaClient — which is exactly where the
 * transaction-local `set_config` can silently break (see `withTenantTransaction`).
 *
 * What it proves against a live database:
 *   1. Reads through `withTenantTransaction` see only the bound tenant's rows.
 *   2. The repository's own methods are tenant-scoped (cross-tenant lookups miss).
 *   3. A query that does NOT bind the tenant (i.e. skips the helper) is rejected
 *      by RLS rather than leaking — demonstrating the helper is mandatory.
 *
 * Uses `TEST_DATABASE_URL` when supplied, otherwise CI's `DATABASE_URL`.
 * The schema and production RLS policies must already be migrated; this suite
 * never executes runtime DDL.
 */
import { randomUUID } from 'node:crypto';

import { createPrismaClient, getSharedPgPool, withTenantTransaction } from '@proctira/database';
import type { PrismaClient } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaStudentRepository } from './prisma-student-repository.js';
import type { StudentEntity } from './student-repository.js';

const TEST_DATABASE_URL =
  process.env['TEST_DATABASE_URL']?.trim() || process.env['DATABASE_URL']?.trim();

function sampleStudent(tenantId: string, overrides: Partial<StudentEntity> = {}) {
  return {
    id: randomUUID(),
    tenantId,
    firstName: 'Test',
    lastName: 'Student',
    dateOfBirth: '2010-01-15',
    gender: 'F',
    nationalId: randomUUID().slice(0, 12),
    nationality: 'IN',
    contacts: [],
    guardians: [],
    identityDocuments: [],
    customData: {},
    ...overrides,
  };
}

describe.skipIf(!TEST_DATABASE_URL)('PrismaStudentRepository (RLS integration)', () => {
  let prisma: PrismaClient;
  let repo: PrismaStudentRepository;
  let tenantA: string;
  let tenantB: string;
  let studentA: StudentEntity;
  let studentB: StudentEntity;

  beforeAll(async () => {
    prisma = createPrismaClient({ datasourceUrl: TEST_DATABASE_URL });
    await prisma.$connect();

    tenantA = randomUUID();
    tenantB = randomUUID();
    const fixturePool = getSharedPgPool(TEST_DATABASE_URL!);
    if (!fixturePool) throw new Error('live student RLS test requires PostgreSQL');
    await Promise.all([
      ensurePgTestTenant(fixturePool, tenantA),
      ensurePgTestTenant(fixturePool, tenantB),
    ]);

    repo = new PrismaStudentRepository(prisma);
    // create() binds the tenant via withTenantTransaction, satisfying the
    // INSERT policy — proving writes are tenant-scoped too.
    studentA = await repo.create(sampleStudent(tenantA, { firstName: 'Alice' }));
    studentB = await repo.create(sampleStudent(tenantB, { firstName: 'Bob' }));
  }, 30_000);

  afterAll(async () => {
    if (!prisma) return;
    // Deletes are RLS-scoped, so remove each tenant's rows in its own context.
    for (const t of [tenantA, tenantB]) {
      if (t) {
        await withTenantTransaction(prisma, t, (tx) =>
          tx.student.deleteMany({ where: { tenantId: t } }),
        );
      }
    }
    await prisma.$disconnect();
  });

  it('a tenant-bound transaction sees only its own rows', async () => {
    const rowsA = await withTenantTransaction(prisma, tenantA, (tx) => tx.student.findMany());
    expect(rowsA).toHaveLength(1);
    expect(rowsA[0]?.id).toBe(studentA.id);
    expect(rowsA.every((r) => r.tenantId === tenantA)).toBe(true);

    const rowsB = await withTenantTransaction(prisma, tenantB, (tx) => tx.student.findMany());
    expect(rowsB).toHaveLength(1);
    expect(rowsB[0]?.id).toBe(studentB.id);
  });

  it('repository lookups are tenant-scoped (no cross-tenant access)', async () => {
    // Own tenant: found.
    expect(await repo.findById(studentA.id, tenantA)).not.toBeNull();
    // Other tenant: must not see A's student even with the correct id.
    expect(await repo.findById(studentA.id, tenantB)).toBeNull();
  });

  it('list returns only the requested tenant', async () => {
    const page = await repo.list(tenantB, {}, { page: 1, pageSize: 50 });
    expect(page.meta.totalItems).toBe(1);
    expect(page.data.every((s) => s.tenantId === tenantB)).toBe(true);
  });

  it('soft delete is tenant-scoped and hides the row from reads', async () => {
    const victim = await repo.create(sampleStudent(tenantA, { firstName: 'Carol' }));
    // Wrong tenant cannot delete it.
    expect(await repo.delete(victim.id, tenantB)).toBe(false);
    // Correct tenant can, and it then disappears from reads.
    expect(await repo.delete(victim.id, tenantA)).toBe(true);
    expect(await repo.findById(victim.id, tenantA)).toBeNull();
  });

  it('a query that does NOT bind the tenant returns no rows (helper is mandatory)', async () => {
    // No transaction-local tenant GUC: production RLS must fail closed by
    // returning no tenant rows rather than leaking data from another scope.
    expect(await prisma.student.findMany()).toEqual([]);
  });
});
