/**
 * Administrative staff assignments (principal, additional charge) carry no subject
 * and no class: db/sql/098_staff_identity_link.sql drops NOT NULL on
 * staff_assignments.subject_id / class_id, and seed 006 inserts such rows. The
 * Prisma model declared both as non-null, so any read returning one of those rows
 * failed with "Error converting field subjectId … found null" — including the
 * PRC-M375 allocation lock that runs on every guarded create/update.
 *
 * The Prisma engine conversion itself is only reproducible against Postgres (see
 * prisma-assignment-nullable.live.test.ts); these tests pin the TypeScript side:
 * null rows map through, count toward the allocation cap, and overlap lookups
 * match IS NULL rather than dropping the filter.
 */
import { BusinessRuleError } from '@proctira/common';
import type { PrismaClient } from '@proctira/database';
import { describe, expect, it, vi } from 'vitest';

import { AllocationExceededError } from './assignment-repository.js';
import { StaffAssignmentService } from './assignment-service.js';
import { InMemoryAssignmentRepository } from './in-memory-assignment-repository.js';
import { PrismaAssignmentRepository } from './prisma-assignment-repository.js';

const TENANT = '550e8400-e29b-41d4-a716-446655440000';
const STAFF = '660e8400-e29b-41d4-a716-446655440001';
const SCHOOL_A = '770e8400-e29b-41d4-a716-446655440002';
const SCHOOL_B = '770e8400-e29b-41d4-a716-446655440003';
const SUBJECT = '880e8400-e29b-41d4-a716-446655440004';
const CLASS = '990e8400-e29b-41d4-a716-446655440005';

/** A row exactly as Postgres returns an administrative posting. */
function adminRow(over: Record<string, unknown> = {}) {
  return {
    id: 'aa0e8400-e29b-41d4-a716-446655440010',
    tenantId: TENANT,
    staffId: STAFF,
    institutionId: SCHOOL_A,
    subjectId: null,
    classId: null,
    role: 'principal',
    allocationPercentage: 70,
    startDate: new Date('2026-04-01T00:00:00.000Z'),
    endDate: null,
    status: 'ACTIVE',
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    updatedAt: new Date('2026-04-01T00:00:00.000Z'),
    ...over,
  };
}

/** Minimal Prisma double: $transaction runs the callback against `tx`. */
function fakePrisma(rows: ReturnType<typeof adminRow>[]) {
  const tx = {
    $executeRawUnsafe: vi.fn(async () => 1),
    $queryRawUnsafe: vi.fn(async () => [{ id: STAFF }]),
    staffAssignment: {
      findMany: vi.fn(async () => rows),
      findFirst: vi.fn(async () => rows[0] ?? null),
      count: vi.fn(async () => rows.length),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        ...adminRow(),
        ...data,
      })),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  } as unknown as PrismaClient;
  return { prisma, tx };
}

describe('PrismaAssignmentRepository with NULL subject/class rows', () => {
  it('maps a NULL subject/class row through findById and list', async () => {
    const { prisma } = fakePrisma([adminRow()]);
    const repo = new PrismaAssignmentRepository(prisma);

    const found = await repo.findById(adminRow().id, TENANT);
    expect(found).toMatchObject({ subjectId: null, classId: null, role: 'principal' });
    expect(found?.startDate).toBe('2026-04-01');

    const page = await repo.list(TENANT, {}, { page: 1, pageSize: 20 });
    expect(page.data).toHaveLength(1);
    expect(page.data[0]).toMatchObject({ subjectId: null, classId: null });
  });

  it('allocation lock counts an administrative assignment toward the cap', async () => {
    const { prisma, tx } = fakePrisma([adminRow({ allocationPercentage: 70 })]);
    const repo = new PrismaAssignmentRepository(prisma);

    await expect(
      repo.create(
        {
          id: 'bb0e8400-e29b-41d4-a716-446655440011',
          tenantId: TENANT,
          staffId: STAFF,
          institutionId: SCHOOL_B,
          subjectId: SUBJECT,
          classId: CLASS,
          role: 'teacher',
          allocationPercentage: 40,
          startDate: '2026-05-01',
          endDate: null,
          status: 'ACTIVE',
        },
        { maxTotalPercentage: 100 },
      ),
    ).rejects.toBeInstanceOf(AllocationExceededError);
    // The staff row was locked before the read, and nothing was written.
    expect(tx.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE'),
      STAFF,
      TENANT,
    );
    expect(tx.staffAssignment.create).not.toHaveBeenCalled();
  });

  it('allocation lock admits a fitting assignment alongside an administrative one', async () => {
    const { prisma, tx } = fakePrisma([adminRow({ allocationPercentage: 60 })]);
    const repo = new PrismaAssignmentRepository(prisma);

    const created = await repo.create(
      {
        id: 'bb0e8400-e29b-41d4-a716-446655440012',
        tenantId: TENANT,
        staffId: STAFF,
        institutionId: SCHOOL_B,
        subjectId: null,
        classId: null,
        role: 'additional_charge',
        allocationPercentage: 40,
        startDate: '2026-05-01',
        endDate: null,
        status: 'ACTIVE',
      },
      { maxTotalPercentage: 100 },
    );
    expect(created).toMatchObject({ subjectId: null, classId: null, allocationPercentage: 40 });
    expect(tx.staffAssignment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ subjectId: null, classId: null }),
    });
  });

  it('findOverlapping with NULL subject/class filters IS NULL instead of dropping the key', async () => {
    const { prisma, tx } = fakePrisma([adminRow()]);
    const repo = new PrismaAssignmentRepository(prisma);

    const overlaps = await repo.findOverlapping(
      TENANT,
      STAFF,
      SCHOOL_A,
      null,
      null,
      '2026-06-01',
      null,
    );
    expect(overlaps).toHaveLength(1);
    const where = tx.staffAssignment.findMany.mock.calls[0]?.[0] as unknown as {
      where: Record<string, unknown>;
    };
    // `null` (IS NULL), not `undefined` (no filter).
    expect(where.where).toHaveProperty('subjectId', null);
    expect(where.where).toHaveProperty('classId', null);
  });
});

describe('StaffAssignmentService with an existing administrative assignment', () => {
  async function seededAdmin() {
    const repo = new InMemoryAssignmentRepository();
    const admin = await repo.create({
      id: 'cc0e8400-e29b-41d4-a716-446655440020',
      tenantId: TENANT,
      staffId: STAFF,
      institutionId: SCHOOL_A,
      subjectId: null,
      classId: null,
      role: 'principal',
      allocationPercentage: 70,
      startDate: '2026-04-01',
      endDate: null,
      status: 'ACTIVE',
    });
    return { repo, admin, service: new StaffAssignmentService(repo) };
  }

  it('re-dating an administrative assignment runs the overlap check with null keys', async () => {
    const { repo, admin, service } = await seededAdmin();
    const spy = vi.spyOn(repo, 'findOverlapping');

    const updated = await service.update(TENANT, admin.id, { endDate: '2027-03-31' });
    expect(updated).toMatchObject({ subjectId: null, classId: null, endDate: '2027-03-31' });
    expect(spy).toHaveBeenCalledWith(
      TENANT,
      STAFF,
      SCHOOL_A,
      null,
      null,
      '2026-04-01',
      '2027-03-31',
      admin.id,
    );
  });

  it('a teaching assignment that would exceed the cap with the admin row is rejected', async () => {
    const { service } = await seededAdmin();
    await expect(
      service.create(TENANT, {
        staffId: STAFF,
        institutionId: SCHOOL_B,
        subjectId: SUBJECT,
        classId: CLASS,
        role: 'teacher',
        allocationPercentage: 40,
        startDate: '2026-05-01',
      }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });
});
