/**
 * PRC-M101: hasActiveAssignmentAt backs the timetable "staff belongs to this
 * institution" check. Administrative assignments carry NULL subject/class
 * (db/sql/098), which the Prisma model cannot decode, so the Prisma path must
 * count rows rather than materialise them.
 */
import type { PrismaClient } from '@proctira/database';
import { describe, expect, it, vi } from 'vitest';

import { InMemoryAssignmentRepository } from './in-memory-assignment-repository.js';
import { PrismaAssignmentRepository } from './prisma-assignment-repository.js';

const TENANT = '00000000-0000-4000-8000-00000000a501';
const OTHER_TENANT = '00000000-0000-4000-8000-0000000000bb';
const STAFF = '00000000-0000-4000-8000-00000000a593';
const MAYUR = '00000000-0000-4000-8000-00000000a551';
const ROHINI = '00000000-0000-4000-8000-00000000a554';

function assignment(overrides: Partial<{ id: string; status: 'ACTIVE' | 'INACTIVE' }> = {}) {
  return {
    id: overrides.id ?? '00000000-0000-4000-8000-00000000a5a3',
    tenantId: TENANT,
    staffId: STAFF,
    institutionId: MAYUR,
    subjectId: '00000000-0000-4000-8000-00000000a581',
    classId: '00000000-0000-4000-8000-00000000a561',
    role: 'accounts',
    allocationPercentage: 100,
    startDate: '2026-04-01',
    endDate: null,
    status: overrides.status ?? 'ACTIVE',
  };
}

describe('InMemoryAssignmentRepository.hasActiveAssignmentAt', () => {
  it('is true only for an ACTIVE assignment at that institution in that tenant', async () => {
    const repo = new InMemoryAssignmentRepository();
    await repo.create(assignment());
    expect(await repo.hasActiveAssignmentAt(STAFF, TENANT, MAYUR)).toBe(true);
    expect(await repo.hasActiveAssignmentAt(STAFF, TENANT, ROHINI)).toBe(false);
    expect(await repo.hasActiveAssignmentAt(STAFF, OTHER_TENANT, MAYUR)).toBe(false);
  });

  it('ignores INACTIVE assignments', async () => {
    const repo = new InMemoryAssignmentRepository();
    await repo.create(assignment({ status: 'INACTIVE' }));
    expect(await repo.hasActiveAssignmentAt(STAFF, TENANT, MAYUR)).toBe(false);
  });
});

describe('PrismaAssignmentRepository.hasActiveAssignmentAt', () => {
  function prismaWithCount(count: number) {
    const tx = {
      $executeRawUnsafe: vi.fn().mockResolvedValue(1),
      staffAssignment: {
        count: vi.fn().mockResolvedValue(count),
        findMany: vi.fn().mockRejectedValue(new Error('must not materialise rows')),
        findFirst: vi.fn().mockRejectedValue(new Error('must not materialise rows')),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    } as unknown as PrismaClient;
    return { prisma, tx };
  }

  it('counts ACTIVE rows scoped by tenant, staff, and institution under the tenant GUC', async () => {
    const { prisma, tx } = prismaWithCount(1);
    const repo = new PrismaAssignmentRepository(prisma);
    await expect(repo.hasActiveAssignmentAt(STAFF, TENANT, MAYUR)).resolves.toBe(true);
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(expect.any(String), TENANT);
    expect(tx.staffAssignment.count).toHaveBeenCalledWith({
      where: { tenantId: TENANT, staffId: STAFF, institutionId: MAYUR, status: 'ACTIVE' },
    });
    expect(tx.staffAssignment.findMany).not.toHaveBeenCalled();
  });

  it('is false when no matching row exists', async () => {
    const { prisma } = prismaWithCount(0);
    const repo = new PrismaAssignmentRepository(prisma);
    await expect(repo.hasActiveAssignmentAt(STAFF, TENANT, ROHINI)).resolves.toBe(false);
  });
});
