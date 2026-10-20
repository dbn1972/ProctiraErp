/**
 * PRC-M172 (Charter §32 relocation): listActiveStaffIdsForClass resolves
 * `principalIds` (`staff.user_id`) to staff ids holding an ACTIVE, unexpired
 * `staff_assignments` row for `classId`. Backs attendance-service's
 * teacher-to-class ownership check — this query used to run as a raw
 * cross-service SQL join inside the attendance package (`packages/backend/attendance`);
 * it is tested here because it now lives in the service that owns both tables.
 */
import type { PrismaClient } from '@proctira/database';
import { describe, expect, it, vi } from 'vitest';

import { InMemoryAssignmentRepository } from './in-memory-assignment-repository.js';
import { PrismaAssignmentRepository } from './prisma-assignment-repository.js';

const TENANT = '00000000-0000-4000-8000-00000000a501';
const CLASS_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLASS_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STAFF = '00000000-0000-4000-8000-00000000a593';
const PRINCIPAL = 'teacher-a-sub-id';
const MAYUR = '00000000-0000-4000-8000-00000000a551';

function assignment(
  overrides: Partial<{
    id: string;
    classId: string;
    status: 'ACTIVE' | 'INACTIVE';
    endDate: string | null;
  }> = {},
) {
  return {
    id: overrides.id ?? '00000000-0000-4000-8000-00000000a5a3',
    tenantId: TENANT,
    staffId: STAFF,
    institutionId: MAYUR,
    subjectId: null,
    classId: overrides.classId ?? CLASS_A,
    role: 'teacher',
    allocationPercentage: 100,
    startDate: '2024-01-01',
    endDate: overrides.endDate === undefined ? null : overrides.endDate,
    status: overrides.status ?? 'ACTIVE',
  };
}

describe('InMemoryAssignmentRepository.listActiveStaffIdsForClass', () => {
  it('returns the staff id when the linked principal has an ACTIVE assignment to classId', async () => {
    const repo = new InMemoryAssignmentRepository();
    await repo.create(assignment());
    repo.linkPrincipalToStaff(PRINCIPAL, STAFF);
    await expect(repo.listActiveStaffIdsForClass(TENANT, CLASS_A, [PRINCIPAL])).resolves.toEqual([
      STAFF,
    ]);
  });

  it('does not return a staff id assigned to a different class', async () => {
    const repo = new InMemoryAssignmentRepository();
    await repo.create(assignment({ classId: CLASS_A }));
    repo.linkPrincipalToStaff(PRINCIPAL, STAFF);
    await expect(repo.listActiveStaffIdsForClass(TENANT, CLASS_B, [PRINCIPAL])).resolves.toEqual(
      [],
    );
  });

  it('excludes an INACTIVE assignment', async () => {
    const repo = new InMemoryAssignmentRepository();
    await repo.create(assignment({ status: 'INACTIVE' }));
    repo.linkPrincipalToStaff(PRINCIPAL, STAFF);
    await expect(repo.listActiveStaffIdsForClass(TENANT, CLASS_A, [PRINCIPAL])).resolves.toEqual(
      [],
    );
  });

  it('excludes an assignment end-dated in the past', async () => {
    const repo = new InMemoryAssignmentRepository();
    await repo.create(assignment({ endDate: '2000-01-01' }));
    repo.linkPrincipalToStaff(PRINCIPAL, STAFF);
    await expect(repo.listActiveStaffIdsForClass(TENANT, CLASS_A, [PRINCIPAL])).resolves.toEqual(
      [],
    );
  });

  it('returns empty for an unknown principalId', async () => {
    const repo = new InMemoryAssignmentRepository();
    await repo.create(assignment());
    repo.linkPrincipalToStaff(PRINCIPAL, STAFF);
    await expect(
      repo.listActiveStaffIdsForClass(TENANT, CLASS_A, ['someone-else']),
    ).resolves.toEqual([]);
  });
});

describe('PrismaAssignmentRepository.listActiveStaffIdsForClass', () => {
  function prismaWith(
    staffRows: Array<{ id: string }>,
    assignmentRows: Array<{ staffId: string }>,
  ) {
    const tx = {
      $executeRawUnsafe: vi.fn().mockResolvedValue(1),
      $queryRaw: vi.fn().mockRejectedValue(new Error('must not run raw SQL')),
      $queryRawUnsafe: vi.fn().mockRejectedValue(new Error('must not run raw SQL')),
      staff: {
        findMany: vi.fn().mockResolvedValue(staffRows),
      },
      staffAssignment: {
        findMany: vi.fn().mockResolvedValue(assignmentRows),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    } as unknown as PrismaClient;
    return { prisma, tx };
  }

  it('resolves principalIds -> staff -> active assignment via Prisma-model calls only', async () => {
    const { prisma, tx } = prismaWith([{ id: STAFF }], [{ staffId: STAFF }]);
    const repo = new PrismaAssignmentRepository(prisma);
    await expect(repo.listActiveStaffIdsForClass(TENANT, CLASS_A, [PRINCIPAL])).resolves.toEqual([
      STAFF,
    ]);
    expect(tx.staff.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT, userId: { in: [PRINCIPAL] }, deletedAt: null },
      select: { id: true },
    });
    expect(tx.staffAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: TENANT,
          classId: CLASS_A,
          status: 'ACTIVE',
          staffId: { in: [STAFF] },
        }),
      }),
    );
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('returns empty and skips the assignment query when no staff resolves from principalIds', async () => {
    const { prisma, tx } = prismaWith([], []);
    const repo = new PrismaAssignmentRepository(prisma);
    await expect(repo.listActiveStaffIdsForClass(TENANT, CLASS_A, ['unknown'])).resolves.toEqual(
      [],
    );
    expect(tx.staffAssignment.findMany).not.toHaveBeenCalled();
  });

  it('returns empty for an empty principalIds list without hitting the database', async () => {
    const { prisma, tx } = prismaWith([], []);
    const repo = new PrismaAssignmentRepository(prisma);
    await expect(repo.listActiveStaffIdsForClass(TENANT, CLASS_A, [])).resolves.toEqual([]);
    expect(tx.staff.findMany).not.toHaveBeenCalled();
  });
});
